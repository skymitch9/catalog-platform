/**
 * app-check.test.ts — `GET /api/books/app-check`, the `ESTATE_APP_TOKEN_BOOKS`
 * handshake probe.
 *
 * 🔴 **The hardest assertion in this file is that the route REACHES NO BOOK.**
 * The reason `scripts/op-rotate-pair.mjs` refused this pair for a week was that
 * the only way to exercise the token was `/api/books/*`, which needs an
 * `X-Estate-On-Behalf-Of` naming a linked asker — and *"sending a fabricated
 * on-behalf identity to prove a token works would be asserting an identity to a
 * live gate, which is not a probe."* A probe route that quietly became a second,
 * weaker door onto the household's book text would be worse than no probe at
 * all, so the test below drives it through the REAL exported app with a `fetch`
 * that THROWS on any outbound call and a bucket that THROWS on any read.
 *
 * Every test is behaviour-failing: the named mutation in each comment turns it
 * red.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import app from '../src/index.js';
import type { Env } from '../src/env.js';

// ---------------------------------------------------------------------------
// ⚠️ The Workers-runtime shim `book-routes.test.ts` carries, for the same
// reason: `crypto.subtle.timingSafeEqual` is a Cloudflare EXTENSION and does
// not exist in Node, so `bearerMatches` throws a TypeError, Hono's onError
// catches it and then throws AGAIN reading `c.executionCtx` — two unrelated
// failures standing in for the assertion. Restores the FUNCTION, not the
// guarantee (deliberately not constant-time; a test process has no attacker).
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.length !== y.length) return false;
    return x.every((byte, i) => byte === y[i]);
  };
}

const BOOKS_TOKEN = 'bk-' + 'c'.repeat(61);
const URL_ = '/api/books/app-check';

/**
 * ⚠️ A bucket that THROWS on any access. If the route ever reaches R2 this
 * turns into a 500, which is a loud, unmistakable failure — the point being
 * that "it happens not to read anything today" and "it cannot read anything"
 * are different claims, and only the second is worth a probe route.
 */
const explodingBucket = new Proxy(
  {},
  {
    get() {
      throw new Error('app-check must not touch a bucket');
    },
  },
) as unknown as R2Bucket;

function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_APP_TOKEN_BOOKS: BOOKS_TOKEN,
    ESTATE_CHECK: 'enforce',
    EBOOKS_GATED: explodingBucket,
    EBOOKS: explodingBucket,
    AUDIO: explodingBucket,
    ...over,
  } as Env;
}

/** A fetch that THROWS on ANY call — no estate round-trip, no Google, nothing. */
function noNetwork() {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    throw new Error(`app-check must make no outbound request: ${String(input)}`);
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

function withToken(value: string) {
  return { headers: { Authorization: `Bearer ${value}` } };
}

test('🔴 the right value → 200, with NO network call and NO bucket read', async () => {
  // The whole design in one test. Mutation that turns this red: resolving the
  // on-behalf email, consulting the estate directory, or looking a pack up —
  // any of which would make this a second door onto the book text.
  const n = noNetwork();
  try {
    const res = await app.request(URL_, withToken(BOOKS_TOKEN), envWith());
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.app, 'books');
    assert.equal(body.verifier, 'audiobook-worker');
    assert.equal(body.secret_name, 'ESTATE_APP_TOKEN_BOOKS');
  } finally {
    n.restore();
  }
});

test('the answer carries NO book, no pack, no bucket and no prefix', async () => {
  // The derived text is a more attractive scrape target than the files
  // (access doc §5: smaller, cleaner, searchable), so this is asserted rather
  // than assumed — the same reason the live probe AB22 asserts it.
  const n = noNetwork();
  try {
    const raw = await (await app.request(URL_, withToken(BOOKS_TOKEN), envWith())).text();
    for (const forbidden of ['ebooks-gated', 'text/', '.json.gz', 'bookId', 'passage']) {
      assert.equal(raw.includes(forbidden), false, `${forbidden} leaked: ${raw}`);
    }
  } finally {
    n.restore();
  }
});

test('⚠️ THE TOKEN IS NEVER ECHOED', async () => {
  const n = noNetwork();
  try {
    const raw = await (await app.request(URL_, withToken(BOOKS_TOKEN), envWith())).text();
    assert.equal(raw.includes(BOOKS_TOKEN), false, raw);
  } finally {
    n.restore();
  }
});

test('a wrong value → 401, worded, naming no app — and still no network', async () => {
  // ⚠️ `ok` and `app` ABSENT, not false: one careless `if (body.ok)` in a
  // rotation script and a refusal reads as a success, after which it sets the
  // presenter against a verifier that never took the value. That is the
  // half-applied pair the whole guard exists to prevent.
  const n = noNetwork();
  try {
    const res = await app.request(URL_, withToken('w'.repeat(64)), envWith());
    assert.equal(res.status, 401);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'unrecognised_app_token');
    assert.ok(typeof body.detail === 'string' && (body.detail as string).length > 0);
    assert.equal('app' in body, false);
    assert.equal('ok' in body, false);
  } finally {
    n.restore();
  }
});

test('no bearer → the same worded 401 — a guess learns nothing from the difference', async () => {
  const n = noNetwork();
  try {
    const res = await app.request(URL_, {}, envWith());
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as Record<string, unknown>).error, 'unrecognised_app_token');
  } finally {
    n.restore();
  }
});

test('🔴 the secret UNSET → 503 app_token_unset, NOT 401 — the ships-dark posture, in words', async () => {
  // Door B does not exist with the secret unset, which is a correct posture and
  // must not read as a fault. Mutation that turns this red: collapsing it into
  // the 401 — an operator mid-rotation would then re-mint a value that was fine.
  const n = noNetwork();
  try {
    const res = await app.request(
      URL_,
      withToken(BOOKS_TOKEN),
      envWith({ ESTATE_APP_TOKEN_BOOKS: undefined }),
    );
    assert.equal(res.status, 503);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'app_token_unset');
    assert.ok(typeof body.detail === 'string' && (body.detail as string).length > 0);
    assert.match(String(body.fix), /wrangler secret put ESTATE_APP_TOKEN_BOOKS/);
  } finally {
    n.restore();
  }
});

test('an EMPTY bearer against an EMPTY secret does not authenticate', async () => {
  // ⚠️ An unset secret arriving as '' rather than undefined is the classic way
  // a "no token" caller becomes an authenticated one.
  const n = noNetwork();
  try {
    const res = await app.request(
      URL_,
      { headers: { Authorization: 'Bearer ' } },
      envWith({ ESTATE_APP_TOKEN_BOOKS: '' }),
    );
    assert.equal(res.status, 503);
  } finally {
    n.restore();
  }
});

test('🔴 MOUNT ORDER: the probe answers, and is NOT swallowed by booksGate', async () => {
  // bookRoutes puts booksGate() in front of everything it owns, so mounted the
  // other way round a probe with the RIGHT token would get the gate's
  // `no_proven_email` 400 instead of this route's 200 — which reads exactly
  // like "the probe route was never deployed". Mutation that turns this red:
  // moving `app.route('/', appCheckRoutes)` below `app.route('/', bookRoutes)`.
  const n = noNetwork();
  try {
    const res = await app.request(URL_, withToken(BOOKS_TOKEN), envWith());
    assert.notEqual(res.status, 400);
    assert.equal(((await res.json()) as Record<string, unknown>).app, 'books');
  } finally {
    n.restore();
  }
});
