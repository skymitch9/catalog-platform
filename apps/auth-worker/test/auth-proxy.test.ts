/**
 * The Phase 1 proxy (sso-design.md §4.1/§8): global fetch is stubbed (the
 * same idiom apps/index-worker/test/auth.test.ts uses for its /seen client)
 * so these tests never touch the network. What is pinned:
 *   - the upstream target: same path + query, on audiobook-catalog.firebaseapp.com
 *   - method, headers (minus hop-by-hop noise) and body pass straight through
 *   - redirect:'manual' — Firebase's own 3xx responses (e.g. bouncing to
 *     accounts.google.com) must reach the BROWSER unresolved, not be
 *     followed and swallowed here
 *   - the upstream response's status/headers/body pass straight back,
 *     UNCHANGED — no rewriting, per the design's ask
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proxyFirebaseAuth } from '../src/auth-proxy.js';

interface FetchCall {
  url: string;
  init: RequestInit & { duplex?: string };
}

function stubFetch(respond: (call: FetchCall) => Response) {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

test('GET: forwards to audiobook-catalog.firebaseapp.com with the same path + query', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    const req = new Request('https://auth.heygabi.ai/__/auth/handler?apiKey=abc&mode=login', {
      headers: { Cookie: 'foo=bar', 'X-Custom': 'kept' },
    });
    await proxyFirebaseAuth(req);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0]!.url, 'https://audiobook-catalog.firebaseapp.com/__/auth/handler?apiKey=abc&mode=login');
    assert.equal(stub.calls[0]!.init.method, 'GET');
  } finally {
    stub.restore();
  }
});

test('redirect: "manual" — Firebase\'s own 3xx bounce is never followed server-side', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    await proxyFirebaseAuth(new Request('https://auth.heygabi.ai/__/auth/handler'));
    assert.equal(stub.calls[0]!.init.redirect, 'manual');
  } finally {
    stub.restore();
  }
});

test('headers: hop-by-hop / Cloudflare-added headers stripped, everything else preserved', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    const req = new Request('https://auth.heygabi.ai/__/auth/iframe', {
      headers: {
        Host: 'auth.heygabi.ai',
        'Content-Length': '0',
        'CF-Connecting-IP': '1.2.3.4',
        'CF-Ray': 'abc123',
        Cookie: 'session=xyz',
        'X-Firebase-Locale': 'en',
      },
    });
    await proxyFirebaseAuth(req);
    const forwarded = stub.calls[0]!.init.headers as Headers;
    assert.equal(forwarded.get('host'), null);
    assert.equal(forwarded.get('content-length'), null);
    assert.equal(forwarded.get('cf-connecting-ip'), null);
    assert.equal(forwarded.get('cf-ray'), null);
    assert.equal(forwarded.get('cookie'), 'session=xyz');
    assert.equal(forwarded.get('x-firebase-locale'), 'en');
  } finally {
    stub.restore();
  }
});

test('POST with a body: the body streams through unchanged, duplex "half" set', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    const req = new Request('https://auth.heygabi.ai/__/auth/handler', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=authorization_code&code=abc123',
    });
    await proxyFirebaseAuth(req);
    const call = stub.calls[0]!;
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.duplex, 'half');
    assert.ok(call.init.body, 'body was forwarded');
    const forwardedText = await new Response(call.init.body as ReadableStream).text();
    assert.equal(forwardedText, 'grant_type=authorization_code&code=abc123');
  } finally {
    stub.restore();
  }
});

test('GET: no body, no duplex option set', async () => {
  const stub = stubFetch(() => new Response('ok', { status: 200 }));
  try {
    await proxyFirebaseAuth(new Request('https://auth.heygabi.ai/__/auth/handler'));
    assert.equal(stub.calls[0]!.init.body, undefined);
    assert.equal(stub.calls[0]!.init.duplex, undefined);
  } finally {
    stub.restore();
  }
});

test('response: status, headers (incl. Location on a 3xx) and body pass back UNCHANGED', async () => {
  const stub = stubFetch(
    () =>
      new Response('<html>bounce</html>', {
        status: 302,
        headers: {
          Location: 'https://accounts.google.com/o/oauth2/auth?client_id=abc',
          'Set-Cookie': 'firebaseauth=1; Path=/',
          'Content-Type': 'text/html',
        },
      }),
  );
  try {
    const res = await proxyFirebaseAuth(new Request('https://auth.heygabi.ai/__/auth/handler'));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), 'https://accounts.google.com/o/oauth2/auth?client_id=abc');
    assert.equal(res.headers.get('content-type'), 'text/html');
    assert.equal(await res.text(), '<html>bounce</html>');
  } finally {
    stub.restore();
  }
});

test('response: a 200 with a body streams through byte-for-byte', async () => {
  const stub = stubFetch(() => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  try {
    const res = await proxyFirebaseAuth(new Request('https://auth.heygabi.ai/__/auth/experiments.js'));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '{"ok":true}');
  } finally {
    stub.restore();
  }
});
