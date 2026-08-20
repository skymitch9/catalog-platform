/**
 * shelf-token.test.ts — the self-service parity key (src/shelf-token.ts).
 *
 * ⚠️ THE FAILURES THIS SURFACE CAN CAUSE ARE BOTH SILENT, which is why the
 * tests below are weighted the way they are:
 *
 *   1. A REVOKE THAT DOES NOT REVOKE. Someone ticks "kill it now" because they
 *      believe the key leaked, the UI says "Rotated", and the old value keeps
 *      working. Nothing on any screen would show that. Several tests exist for
 *      that one branch alone, including the chaining case — rotating twice
 *      must not walk an old key forward into a fresh grace window.
 *   2. A GRACE WINDOW THAT NEVER CLOSES. Expiry is evaluated against the
 *      clock at verification time, not by deleting the record on a timer,
 *      because nothing runs on a timer in a Worker. If that check were wrong,
 *      a superseded key would stay valid forever on a box that stopped
 *      reporting — the precise opposite of the window's purpose.
 *
 * The mint/rotate ROUTES are exercised through the pure helpers rather than a
 * live KV: the decisions worth protecting (what becomes `previous`, what a
 * given bearer matches, what the UI is allowed to see) are all here, and a
 * fake KV would only re-test Hono.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FP_LEN,
  GRACE_MS,
  TOKEN_PREFIX,
  fingerprint,
  mintToken,
  publicView,
  sha256Hex,
  timingSafeEqualHex,
  verifyToken,
  type TokenRecord,
} from '../src/shelf-token.js';

const NOW = Date.parse('2026-08-20T12:00:00.000Z');

async function recordFor(token: string, previous?: { token: string; graceUntil: string }): Promise<TokenRecord> {
  return {
    current: {
      hash: await sha256Hex(token),
      fp: fingerprint(token),
      created_at: new Date(NOW).toISOString(),
      created_by: 'someone@example.com',
      last_used_at: null,
    },
    previous: previous
      ? { hash: await sha256Hex(previous.token), fp: fingerprint(previous.token), grace_until: previous.graceUntil }
      : null,
  };
}

// ── minting ─────────────────────────────────────────────────────────────────

test('minted tokens carry the searchable prefix', () => {
  assert.ok(mintToken().startsWith(TOKEN_PREFIX));
});

test('minted tokens are URL-safe base64 — no +, / or = to mangle in a shell', () => {
  for (let i = 0; i < 50; i++) {
    const body = mintToken().slice(TOKEN_PREFIX.length);
    assert.match(body, /^[A-Za-z0-9_-]+$/, `bad body: ${body}`);
  }
});

test('minted tokens do not repeat', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) seen.add(mintToken());
  assert.equal(seen.size, 200);
});

test('the fingerprint is the prefix plus FP_LEN characters, and nothing more', () => {
  const t = mintToken();
  const fp = fingerprint(t);
  assert.equal(fp.length, TOKEN_PREFIX.length + FP_LEN);
  assert.ok(t.startsWith(fp));
  // ⚠️ The whole safety claim of showing a fingerprint is that it is a strict,
  // short prefix. If this ever equals the token, the UI is printing the secret.
  assert.notEqual(fp, t);
});

// ── verification ────────────────────────────────────────────────────────────

test('the current key verifies', async () => {
  const t = mintToken();
  assert.equal(await verifyToken(await recordFor(t), t, NOW), 'current');
});

test('a wrong bearer matches nothing', async () => {
  const rec = await recordFor(mintToken());
  assert.equal(await verifyToken(rec, mintToken(), NOW), 'no_match');
});

test('an empty bearer matches nothing', async () => {
  const rec = await recordFor(mintToken());
  assert.equal(await verifyToken(rec, '', NOW), 'no_match');
});

test('no record at all matches nothing — never a default-allow', async () => {
  assert.equal(await verifyToken(null, mintToken(), NOW), 'no_match');
});

test('a previous key inside its grace window verifies, and says which it was', async () => {
  const oldT = mintToken();
  const newT = mintToken();
  const rec = await recordFor(newT, { token: oldT, graceUntil: new Date(NOW + GRACE_MS).toISOString() });
  assert.equal(await verifyToken(rec, newT, NOW), 'current');
  // ⚠️ 'previous' must be distinguishable from 'current' — the POST route uses
  // exactly this to tell the caller their new key was never installed.
  assert.equal(await verifyToken(rec, oldT, NOW), 'previous');
});

test('a previous key STOPS working the moment its window closes', async () => {
  const oldT = mintToken();
  const graceUntil = new Date(NOW + GRACE_MS).toISOString();
  const rec = await recordFor(mintToken(), { token: oldT, graceUntil });

  assert.equal(await verifyToken(rec, oldT, NOW + GRACE_MS - 1000), 'previous');
  assert.equal(await verifyToken(rec, oldT, NOW + GRACE_MS + 1000), 'no_match');
});

test('an expired previous key is refused even though the record still names it', async () => {
  // The record is never rewritten on expiry, so "still present" must not read
  // as "still valid" anywhere.
  const oldT = mintToken();
  const rec = await recordFor(mintToken(), {
    token: oldT,
    graceUntil: new Date(NOW - 1).toISOString(),
  });
  assert.notEqual(rec.previous, null);
  assert.equal(await verifyToken(rec, oldT, NOW), 'no_match');
});

test('revoke-now leaves no previous, so the old key dies immediately', async () => {
  const oldT = mintToken();
  const rec = await recordFor(mintToken()); // built with no `previous` — the revoke path
  assert.equal(rec.previous, null);
  assert.equal(await verifyToken(rec, oldT, NOW), 'no_match');
});

test('rotating twice does not walk the oldest key forward', async () => {
  // gen A -> rotate to B (A in grace) -> rotate to C (B in grace).
  // ⚠️ A MUST BE DEAD. The route builds `previous` from the outgoing CURRENT,
  // never from the outgoing previous; if it ever chained, a key could stay
  // alive indefinitely by rotating often enough — a revoke that never lands.
  const a = mintToken();
  const b = mintToken();
  const c = mintToken();
  const afterSecond = await recordFor(c, { token: b, graceUntil: new Date(NOW + GRACE_MS).toISOString() });

  assert.equal(await verifyToken(afterSecond, c, NOW), 'current');
  assert.equal(await verifyToken(afterSecond, b, NOW), 'previous');
  assert.equal(await verifyToken(afterSecond, a, NOW), 'no_match');
});

// ── what the UI may see ─────────────────────────────────────────────────────

test('publicView never exposes a hash or a value', async () => {
  const t = mintToken();
  const rec = await recordFor(t, { token: mintToken(), graceUntil: new Date(NOW + GRACE_MS).toISOString() });
  const view = publicView(rec, NOW);
  const json = JSON.stringify(view);

  assert.ok(!json.includes(rec.current.hash), 'the current hash leaked into the view');
  assert.ok(!json.includes(rec.previous!.hash), 'the previous hash leaked into the view');
  assert.ok(!json.includes(t), 'the token itself leaked into the view');
});

test('publicView hides a previous key whose window has closed', async () => {
  const rec = await recordFor(mintToken(), {
    token: mintToken(),
    graceUntil: new Date(NOW - 1).toISOString(),
  });
  const view = publicView(rec, NOW);
  assert.equal(view.exists && view.previous_valid_until, null);
  assert.equal(view.exists && view.previous_fingerprint, null);
});

test('publicView on no record says so rather than inventing a key', () => {
  // ⚠️ `active` is [] rather than absent, so the UI can iterate it
  // unconditionally. A caller that has to branch on "is there a list at all"
  // before "is the list empty" is a caller that will one day forget to.
  assert.deepEqual(publicView(null, NOW), { exists: false, active: [] });
});

test('publicView surfaces last_used_at — the field that proves an install took', async () => {
  const rec = await recordFor(mintToken());
  rec.current.last_used_at = new Date(NOW).toISOString();
  const view = publicView(rec, NOW);
  assert.equal(view.exists && view.last_used_at, new Date(NOW).toISOString());
});

// ── the compare ─────────────────────────────────────────────────────────────

test('timingSafeEqualHex agrees with === on equal and unequal input', () => {
  assert.equal(timingSafeEqualHex('abc123', 'abc123'), true);
  assert.equal(timingSafeEqualHex('abc123', 'abc124'), false);
  assert.equal(timingSafeEqualHex('abc123', 'abc1234'), false, 'length must not be ignored');
  assert.equal(timingSafeEqualHex('', ''), true);
  assert.equal(timingSafeEqualHex('a', ''), false);
});

test('sha256Hex is 64 lowercase hex characters and stable', async () => {
  const h = await sha256Hex('shelfpar_example');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await sha256Hex('shelfpar_example'));
  assert.notEqual(h, await sha256Hex('shelfpar_examplf'));
});
