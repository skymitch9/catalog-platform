/**
 * POST /api/scan/shelf — gating (tokenless 401, same blanket as every other
 * route mounted below it) plus the route's own validation and translation of
 * VisionError. The Anthropic call itself is stubbed at the fetch layer (the
 * same technique auth.test.ts already uses for the estate /seen call) so
 * these tests cost nothing and run offline — no real API key needed.
 *
 * The owner's OWNER_EMAILS break-glass path (search.test.ts's own `env()`
 * pattern: no ESTATE_AUTH_URL set) is used to reach the route without also
 * having to stub the estate /seen call — requireEstateMember() proceeds on
 * local standing alone, so the ONLY fetch a happy-path test needs to stub is
 * the Anthropic Messages call.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';

const OWNER = 'owner@example.com';

/** Minimal fake D1 — scan.ts touches no table, but the auth blanket does. */
class FakeDB {
  prepare(sql: string) {
    return {
      bind: () => ({
        async first() {
          return null;
        },
        async run() {
          return { success: true };
        },
        async all() {
          return { results: [] };
        },
      }),
      async first() {
        return null;
      },
      async all() {
        return { results: [] };
      },
    };
  }
  async batch() {
    return [];
  }
}

/** Owner break-glass env — no ESTATE_AUTH_URL, so no /seen call is made. */
function ownerEnv(over: Record<string, unknown> = {}) {
  return {
    DB: new FakeDB() as unknown as D1Database,
    ENVIRONMENT: 'development',
    DEV_EMAIL: OWNER,
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    ANTHROPIC_API_KEY: 'sk-ant-test-key',
    ...over,
  };
}

const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

function anthropicMessage(over: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: JSON.stringify({ books: [], unreadable: false }) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 900, output_tokens: 40 },
    ...over,
  };
}

interface FetchStub {
  calls: Array<{ url: string; body: unknown }>;
  restore(): void;
}

/** Stub global fetch for the ONE call this route makes: the Anthropic Messages API. */
function stubAnthropic(answer: { status?: number; body?: unknown } | 'unreachable'): FetchStub {
  const original = globalThis.fetch;
  const calls: FetchStub['calls'] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
    if (answer === 'unreachable') throw new TypeError('fetch failed');
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

// --- Gating: the blanket, unchanged for this route. ------------------------

test('tokenless POST /api/scan/shelf → 401 (blanket before scan.ts, same as every other read)', async () => {
  const res = await app.request(
    '/api/scan/shelf',
    { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }) },
    { DB: new FakeDB() as unknown as D1Database, ENVIRONMENT: 'production', FIREBASE_PROJECT_ID: 'audiobook-catalog' },
  );
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as any).error, 'unauthenticated');
});

// --- Validation, before readShelf() is ever called. -------------------------

test('missing body.data → 400 missing_photo, no Anthropic call made', async () => {
  const f = stubAnthropic('unreachable');
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ mediaType: 'image/jpeg' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).error, 'missing_photo');
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('bad mediaType → 400 bad_media_type', async () => {
  const res = await app.request(
    '/api/scan/shelf',
    { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/gif' }) },
    ownerEnv(),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error, 'bad_media_type');
});

test('an unrecognised kind → 400 bad_kind', async () => {
  const res = await app.request(
    '/api/scan/shelf',
    { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg', kind: 'spine' }) },
    ownerEnv(),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error, 'bad_kind');
});

test('a photo over the size ceiling → 413 photo_too_large, no Anthropic call made', async () => {
  const f = stubAnthropic('unreachable');
  try {
    // Comfortably over the 5MB-decoded / ~6.98M-base64-char ceiling.
    const huge = 'A'.repeat(7_000_000);
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: huge, mediaType: 'image/jpeg' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as any).error, 'photo_too_large');
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('invalid JSON body → 400 invalid_json', async () => {
  const res = await app.request(
    '/api/scan/shelf',
    { method: 'POST', body: 'not json' },
    ownerEnv(),
  );
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error, 'invalid_json');
});

// --- ANTHROPIC_API_KEY unset: a config error, not a photo problem. ---------

test('ANTHROPIC_API_KEY unset → 503 vision_failed naming the fix, no fetch attempted', async () => {
  const f = stubAnthropic('unreachable');
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }) },
      ownerEnv({ ANTHROPIC_API_KEY: undefined }),
    );
    assert.equal(res.status, 503);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'vision_failed');
    assert.match(body.detail, /ANTHROPIC_API_KEY/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

// --- readShelf() failure translation. ---------------------------------------

test('the model refusing the image → 422 vision_failed (refusal checked BEFORE parsing)', async () => {
  const f = stubAnthropic({
    body: anthropicMessage({ stop_reason: 'refusal', stop_details: { category: 'other' }, content: [] }),
  });
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 422);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'vision_failed');
    assert.match(body.detail, /declined to read/);
  } finally {
    f.restore();
  }
});

test('a rejected API key (Anthropic 401) → 503, described as configuration, never as a bad photo', async () => {
  const f = stubAnthropic({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 503);
    const body = (await res.json()) as any;
    assert.equal(body.error, 'vision_failed');
    assert.match(body.detail, /configuration problem, not a problem with your photo/);
  } finally {
    f.restore();
  }
});

// --- The happy path: structured output parsed and forwarded, kind honored. --

test('a shelf read: books + unreadable forwarded, kind defaults to shelf in the request sent upstream', async () => {
  const books = [
    { text: 'Project Hail Mary', author: 'Andy Weir', position: 1, confidence: 'high', note: null },
    { text: 'Mistborn', author: null, position: 2, confidence: 'low', note: 'glare on the spine' },
  ];
  const f = stubAnthropic({ body: anthropicMessage({ content: [{ type: 'text', text: JSON.stringify({ books, unreadable: false }) }] }) });
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.books, books);
    assert.equal(body.unreadable, false);
    assert.equal(f.calls.length, 1);
    const sent = f.calls[0]!.body as any;
    assert.equal(sent.model, 'claude-opus-5');
    assert.match(sent.system, /reading the spines of books on a shelf/);
    assert.equal(sent.output_config.format.schema.properties.books.items.required.includes('series'), false, 'shelf schema, not cover');
  } finally {
    f.restore();
  }
});

test('kind: "cover" selects the cover prompt/schema and is forwarded upstream', async () => {
  const f = stubAnthropic({
    body: anthropicMessage({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            books: [{ text: 'Elantris', author: 'Brandon Sanderson', series: null, volume: null, publisher: 'Tor', position: 1, confidence: 'high', note: null }],
            unreadable: false,
          }),
        },
      ],
    }),
  });
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg', kind: 'cover' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.books.length, 1);
    assert.equal(body.books[0].publisher, 'Tor');
    const sent = f.calls[0]!.body as any;
    assert.match(sent.system, /reading the FRONT COVER/);
    assert.ok(sent.output_config.format.schema.properties.books.items.required.includes('publisher'), 'cover schema, not shelf');
  } finally {
    f.restore();
  }
});

test('unreadable photo: empty books, unreadable true, forwarded as-is', async () => {
  const f = stubAnthropic({ body: anthropicMessage({ content: [{ type: 'text', text: JSON.stringify({ books: [], unreadable: true }) }] }) });
  try {
    const res = await app.request(
      '/api/scan/shelf',
      { method: 'POST', body: JSON.stringify({ data: TINY_JPEG_BASE64, mediaType: 'image/jpeg' }) },
      ownerEnv(),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.books, []);
    assert.equal(body.unreadable, true);
  } finally {
    f.restore();
  }
});
