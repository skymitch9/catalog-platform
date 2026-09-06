/**
 * ebooks-door — the whole Worker, which is one `fetch` handler and about six
 * lines of decision.
 *
 * ⚠️ WHY THIS FILE EXISTS. Until 2026-09-05 this workspace had NO `"test"` key
 * at all, so `npm test --workspaces --if-present` skipped it in silence — not
 * "decided it needs none", just invisible
 * (`docs/info/test-inventory-2026-09-05.md` §5.4).
 *
 * ⚠️ AND WHY IT IS SHORT, WHICH IS THE HONEST PART. **This door has no
 * auth path and no refusal path of its own, deliberately.** Its own header is
 * emphatic: *"THIS DOOR IS NOT THE LOCK, AND MUST NEVER BE TREATED AS ONE."*
 * The gate is server-side in `apps/audiobook-worker`'s
 * `GET /api/ebooks/manifest`, which verifies a Firebase ID token and requires
 * the estate's `ebooks` visibility grant on every request; that gate is tested
 * there, and no rule added here would protect anything. So the refusal tests
 * below assert the only refusal behaviour a pass-through proxy can get wrong:
 * that it relays the origin's WORDED refusal untouched instead of replacing it
 * with a bare status of its own invention.
 *
 * What the door genuinely decides, and therefore what is pinned here:
 *
 *   1. **`/` asks the origin for `/ebooks`, NOT `/ebooks.html`** — measured
 *      2026-08-17, and it is the only bug this Worker has ever had. Cloudflare
 *      Pages 308s the `.html` form to the extensionless one; this door passes
 *      responses through VERBATIM, so the redirect escaped with a `Location`
 *      on the audiobook host and **every visitor to ebooks.heygabi.ai was
 *      bounced to audiobooks.heygabi.ai/ebooks** — the pool never appeared on
 *      its own address at all.
 *   2. **The origin is the PROD host, never a `/dev/` lane.** A lane is not a
 *      hostname, and this door must never quietly serve dev as the product.
 *   3. **Verbatim pass-through** of status, headers and body, in both
 *      directions — which is what keeps the page's relative fetches
 *      (`fb-env.js`, `identity.js`, `account-modal.js`, `static/js/theme.js`)
 *      same-origin and in lockstep with every promote.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import door from '../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, '../src/index.ts');

const ORIGIN = 'https://audiobooks.heygabi.ai';
const DOOR = 'https://ebooks.heygabi.ai';

interface Upstream {
  requests: Request[];
  urls: string[];
}

let upstream: Upstream;
let realFetch: typeof globalThis.fetch;
let answer: (req: Request) => Response;

beforeEach(() => {
  upstream = { requests: [], urls: [] };
  answer = () => new Response('<!doctype html><title>ebooks</title>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const req = input as Request;
    upstream.requests.push(req);
    upstream.urls.push(req.url);
    return answer(req);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (path: string, init?: RequestInit) =>
  (door as { fetch(r: Request): Promise<Response> }).fetch(new Request(DOOR + path, init));

// ── 1. the one bug this Worker has ever had ────────────────────────────────

describe('⚠️ the 2026-08-17 redirect escape — `/` must ask for /ebooks', () => {
  it('the root asks the origin for the CANONICAL extensionless path', async () => {
    await get('/');
    assert.equal(upstream.urls[0], `${ORIGIN}/ebooks`);
  });

  it('⚠️ it must NOT ask for /ebooks.html — that is what escaped', async () => {
    // Pages 308s `.html` → extensionless. Because this door relays responses
    // verbatim, that redirect left with a Location on the audiobook host and
    // every visitor was bounced off ebooks.heygabi.ai entirely. Asking for the
    // canonical path in the first place was the whole fix; nothing about the
    // pass-through changed.
    await get('/');
    assert.ok(!upstream.urls[0]!.endsWith('.html'), upstream.urls[0]);
  });

  it('a 308 from the origin still travels through untouched — the door never absorbs one', async () => {
    // The fix is at the REQUEST path, not the response. If a future origin
    // change reintroduces a redirect on some other path, it will escape the
    // same way, and this test records that the door is not the place that
    // would stop it.
    answer = () =>
      new Response(null, { status: 308, headers: { location: `${ORIGIN}/somewhere` } });
    const res = await get('/other');
    assert.equal(res.status, 308);
    assert.equal(res.headers.get('location'), `${ORIGIN}/somewhere`);
  });
});

// ── 2. the origin ──────────────────────────────────────────────────────────

describe('⚠️ the origin is the PROD host — a lane is not a hostname', () => {
  it('every proxied request goes to audiobooks.heygabi.ai', async () => {
    for (const path of ['/', '/identity.js', '/static/js/theme.js', '/anything']) {
      await get(path);
    }
    for (const url of upstream.urls) {
      assert.equal(new URL(url).origin, ORIGIN, url);
    }
  });

  it('nothing is ever routed at the /dev/ lane', async () => {
    await get('/');
    await get('/account-modal.js');
    for (const url of upstream.urls) {
      assert.ok(!new URL(url).pathname.startsWith('/dev/'), url);
    }
    // …and the constant itself, so a lane cannot be introduced by editing one
    // string without this file going red.
    assert.match(readFileSync(SOURCE, 'utf8'), /const ORIGIN = 'https:\/\/audiobooks\.heygabi\.ai'/);
  });
});

// ── 3. pass-through, in both directions ────────────────────────────────────

describe('the path and query reach the origin unchanged', () => {
  it('a non-root path is proxied as itself', async () => {
    await get('/static/js/theme.js');
    assert.equal(upstream.urls[0], `${ORIGIN}/static/js/theme.js`);
  });

  it('the query string rides along', async () => {
    await get('/fb-env.js?v=7&x=a%20b');
    assert.equal(upstream.urls[0], `${ORIGIN}/fb-env.js?v=7&x=a%20b`);
  });

  it('only the exact root is rewritten — /ebooks and /ebooks.html pass as typed', async () => {
    await get('/ebooks');
    await get('/ebooks.html');
    assert.deepEqual(upstream.urls, [`${ORIGIN}/ebooks`, `${ORIGIN}/ebooks.html`]);
  });

  it('the request method and headers survive the hop', async () => {
    await get('/identity.js', { method: 'HEAD', headers: { 'x-probe': 'yes' } });
    const sent = upstream.requests[0]!;
    assert.equal(sent.method, 'HEAD');
    assert.equal(sent.headers.get('x-probe'), 'yes');
  });

  it('⚠️ ebooks.json is not special-cased — it is proxied like anything else', async () => {
    // The header's alarm: "If a request for it ever starts succeeding through
    // this door, the manifest is back in the public deployment and the gate has
    // been undone." That is a fact about the ORIGIN's deployment, not about
    // this file — the door has no opinion, and this records that it has none,
    // so nobody mistakes an absent rule here for a gate.
    answer = () => new Response('not found', { status: 404 });
    const res = await get('/ebooks.json');
    assert.equal(upstream.urls[0], `${ORIGIN}/ebooks.json`);
    assert.equal(res.status, 404);
  });
});

describe('the origin’s response comes back verbatim — status, headers and body', () => {
  it('a 200 keeps its body and its content type', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(await res.text(), /<title>ebooks<\/title>/);
  });

  it('the origin’s caching and CSP decisions stay the origin’s', async () => {
    answer = () =>
      new Response('x', {
        status: 200,
        headers: {
          'cache-control': 'public, max-age=60',
          'content-security-policy': "default-src 'self'",
        },
      });
    const res = await get('/');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
    assert.equal(res.headers.get('content-security-policy'), "default-src 'self'");
  });

  it('⚠️ a refusal arrives with the origin’s WORDS, not a bare status', async () => {
    // The estate rule is that a person must never meet a naked HTTP status.
    // This door cannot satisfy that rule by itself — it has no refusal of its
    // own to word — but it CAN break it, by swallowing the origin's worded
    // refusal. This is that assertion: whatever the gate says, the person gets.
    answer = () =>
      new Response(
        JSON.stringify({
          error: 'ebooks_not_granted',
          message: "You're signed in, but the ebook shelf hasn't been shared with you yet. Ask the owner for the ebooks grant.",
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      );
    const res = await get('/api/ebooks/manifest');
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string; message: string };
    assert.equal(body.error, 'ebooks_not_granted');
    assert.match(body.message, /ebooks grant/);
  });

  it('a 401 and a 500 are relayed as themselves, not collapsed into one', async () => {
    // The four causes of a refusal must stay distinguishable end to end: a
    // server failure is NOT a permission failure, and a door that normalised
    // them would send people asking for access they already have.
    for (const status of [401, 500, 503]) {
      upstream = { requests: [], urls: [] };
      answer = () => new Response(`upstream said ${status}`, { status });
      const res = await get('/');
      assert.equal(res.status, status);
      assert.equal(await res.text(), `upstream said ${status}`);
    }
  });

  it('an empty-bodied response stays empty rather than becoming a page', async () => {
    answer = () => new Response(null, { status: 204 });
    const res = await get('/');
    assert.equal(res.status, 204);
    assert.equal(await res.text(), '');
  });
});
