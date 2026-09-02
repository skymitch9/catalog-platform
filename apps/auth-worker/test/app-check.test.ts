/**
 * app-check.test.ts — `GET /api/estate/app-check`, the handshake probe.
 *
 * ⚠️ **This route's whole reason for existing is that a token rotation has to
 * be OBSERVABLE.** `scripts/op-rotate-pair.mjs` refuses to mint a value for a
 * pair it cannot prove, because a half-applied pair does not raise an error
 * anywhere — the verifier just stops recognising the presenter, and the result
 * is a silent 401 on a route nobody watches. So the failures that matter here
 * are the ones that would make a rotation script believe the wrong thing:
 *
 *   · a 200 that does not name the app (a value set on the WRONG secret would
 *     pass a status-only check and the script would go on to set the presenter);
 *   · a refusal that carries `ok` or `app` (one careless `if (body.ok)` and a
 *     401 reads as a success);
 *   · "no token was ever set" wearing the same clothes as "wrong token" (the
 *     two have different fixes, and on rotation day guessing wrong means
 *     re-minting a value that was fine).
 *
 * Every test is behaviour-failing: the named mutation in each comment turns it
 * red.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { appCheckRoutes, APP_TOKEN_SECRET_NAMES } from '../src/app-check.js';
import { CONSUMER_APPS } from '../src/env.js';

// ---------------------------------------------------------------------------
// ⚠️ The same Workers-runtime shim `billing-routes.test.ts` carries, for the
// same reason: `crypto.subtle.timingSafeEqual` is a Cloudflare EXTENSION and
// does not exist in Node, so `tokenMatches()` throws a TypeError and Hono turns
// it into a bare 500 — every assertion below would then pass or fail for a
// reason unrelated to the route. Restores the FUNCTION, not the guarantee.
// ---------------------------------------------------------------------------
const webcrypto = (globalThis as unknown as { crypto: Crypto }).crypto;
if (typeof (webcrypto.subtle as { timingSafeEqual?: unknown }).timingSafeEqual !== 'function') {
  (webcrypto.subtle as unknown as Record<string, unknown>).timingSafeEqual = (
    a: ArrayBufferView,
    b: ArrayBufferView,
  ): boolean => {
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    if (x.byteLength !== y.byteLength) return false;
    let diff = 0;
    for (let i = 0; i < x.byteLength; i += 1) diff |= (x[i] as number) ^ (y[i] as number);
    return diff === 0;
  };
}

const LIBRARY2 = 'l2-' + 'a'.repeat(61);
const AUDIOBOOK = 'ab-' + 'b'.repeat(61);

/**
 * ⚠️ No `DB` binding anywhere in this file, and that is an ASSERTION rather
 * than an omission: the route must answer without touching D1, so that a
 * database outage on rotation day cannot make a working token look broken.
 * Every test here would 500 if a handler reached for `c.env.DB`.
 */
function env(over: Record<string, string> = {}) {
  return {
    ESTATE_APP_TOKEN_LIBRARY2: LIBRARY2,
    ESTATE_APP_TOKEN_AUDIOBOOK: AUDIOBOOK,
    ...over,
  } as never;
}

/**
 * ⚠️ The SUB-APP's own path, not the mounted one. `appCheckRoutes` declares
 * `/estate/app-check` and `index.ts` mounts it at `/api` — the same split
 * every route file in this Worker has, and the same one `billing-routes.test.ts`
 * exercises. The `/api` half (and the mount ORDER that keeps this route ahead
 * of `/estate/users/:id`) is proved by the live probe `auth:A36`, which asks
 * production for the full path.
 */
const URL_ = '/estate/app-check';

function withToken(value: string) {
  return { headers: { Authorization: `Bearer ${value}` } };
}

test('the right value → 200 naming the APP, not merely ok', async () => {
  // 🔴 THE ASSERTION THE ROTATION DEPENDS ON. A value pushed to the wrong
  // ESTATE_APP_TOKEN_* secret still authenticates — as the wrong app — so a
  // probe that checked only the status would call that a success and go on to
  // set the presenter. Mutation that turns this red: dropping `app` from the body.
  const res = await appCheckRoutes.request(URL_, withToken(LIBRARY2), env());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal(body.app, 'library2');
  assert.equal(body.verifier, 'estate-auth');
  assert.equal(body.secret_name, 'ESTATE_APP_TOKEN_LIBRARY2');
});

test('a DIFFERENT app\'s value is named as that app — the two pairs stay distinguishable', async () => {
  // One route serves both master-less estate pairs. If it could not tell them
  // apart, rotating one would "prove" the other.
  const res = await appCheckRoutes.request(URL_, withToken(AUDIOBOOK), env());
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.app, 'audiobook');
  assert.equal(body.secret_name, 'ESTATE_APP_TOKEN_AUDIOBOOK');
});

test('the answer states its own LIMIT on the wire — the verifier half only', async () => {
  // Worker secrets are write-only, so nothing here can prove the HOLDER sends
  // this value on its own traffic. Saying so in the body rather than only in a
  // doc is what stops a later reader over-claiming from a green probe.
  const res = await appCheckRoutes.request(URL_, withToken(LIBRARY2), env());
  const body = (await res.json()) as Record<string, unknown>;
  assert.match(String(body.proves), /NOT that the holder sends it/);
});

test('⚠️ NO SECRET VALUE IS EVER ECHOED — not the one presented, not any other', async () => {
  // Mutation that turns this red: putting the matched token in the answer "for
  // debugging". This repo is public and probe output gets pasted into commits.
  const res = await appCheckRoutes.request(URL_, withToken(LIBRARY2), env());
  const raw = await res.text();
  assert.equal(raw.includes(LIBRARY2), false, raw);
  assert.equal(raw.includes(AUDIOBOOK), false, raw);
});

test('a wrong value → 401, WORDED, and it names no app', async () => {
  // ⚠️ `ok` and `app` must be ABSENT, not false/null: one careless
  // `if (body.ok)` and a refusal reads as a success to a rotation script that
  // then sets the presenter against a verifier that never took the value.
  const res = await appCheckRoutes.request(URL_, withToken('n' + 'o'.repeat(63)), env());
  assert.equal(res.status, 401);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, 'unrecognised_app_token');
  assert.ok(typeof body.detail === 'string' && (body.detail as string).length > 0);
  assert.equal('app' in body, false);
  assert.equal('ok' in body, false);
});

test('no bearer at all → the same worded 401 — a guess learns nothing from the difference', async () => {
  const res = await appCheckRoutes.request(URL_, {}, env());
  assert.equal(res.status, 401);
  assert.equal(((await res.json()) as Record<string, unknown>).error, 'unrecognised_app_token');
});

test('a refusal is not a LISTING — it names no configured secret', async () => {
  // An anonymous caller must learn only that its value is not one of them.
  // Mutation that turns this red: putting the configured names in the detail
  // "to help", which turns a refusal into a map of the estate's credentials.
  const res = await appCheckRoutes.request(URL_, withToken('x'.repeat(64)), env());
  const raw = await res.text();
  assert.equal(raw.includes('ESTATE_APP_TOKEN_LIBRARY2'), false, raw);
  assert.equal(raw.includes('ESTATE_APP_TOKEN_AUDIOBOOK'), false, raw);
});

test('🔴 NO TOKENS CONFIGURED → 503, NOT 401 — "never set" ≠ "wrong"', async () => {
  // The `/seen` idiom, and on rotation day it is the difference between "I set
  // it wrong" and "I never set it", which have different fixes. Mutation that
  // turns this red: collapsing both into 401 — an operator would then re-mint a
  // value that was fine.
  const res = await appCheckRoutes.request(URL_, withToken(LIBRARY2), {} as never);
  assert.equal(res.status, 503);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, 'app_tokens_unset');
  assert.ok(typeof body.detail === 'string' && (body.detail as string).length > 0);
  assert.match(String(body.fix), /wrangler secret put/);
});

test('an EMPTY string secret is not configured — an empty bearer must not authenticate', async () => {
  // ⚠️ An unset secret arriving as '' rather than undefined is the classic way
  // a "no token" caller becomes an authenticated one. identifyApp skips falsy
  // expectations; this pins that it stays that way.
  const res = await appCheckRoutes.request(
    URL_,
    { headers: { Authorization: 'Bearer ' } },
    { ESTATE_APP_TOKEN_LIBRARY2: '' } as never,
  );
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as Record<string, unknown>).error, 'app_tokens_unset');
});

test('every consumer app has a secret NAME, so no 200 can answer secret_name: null', () => {
  // Mutation that turns this red: adding a sixth app to CONSUMER_APPS without
  // adding its name here — the probe would then report a nameless success and
  // the operator could not tell which registry row was just proved.
  for (const app of CONSUMER_APPS) {
    assert.ok(APP_TOKEN_SECRET_NAMES[app], `no secret name for ${app}`);
    assert.match(APP_TOKEN_SECRET_NAMES[app], /^ESTATE_APP_TOKEN_/);
  }
});
