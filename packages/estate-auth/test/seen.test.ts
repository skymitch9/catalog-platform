import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REVOCATION_DELAY_MS,
  cacheIsFresh,
  estateCheck,
  postSeen,
} from '../src/seen.js';

const NOW = Date.parse('2026-08-13T12:00:00.000Z');
const opts = (fetchImpl: typeof fetch) => ({
  baseUrl: 'https://auth.example',
  appToken: 'tok',
  fetchImpl,
});
const me = { email: 'a@b.c' };

const okFetch =
  (status: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify({ status }), { status: 200 });

const failFetch: typeof fetch = async () => {
  throw new Error('network down');
};

test('the TTL is 10 minutes and is named as the revocation delay', () => {
  assert.equal(REVOCATION_DELAY_MS, 10 * 60 * 1000);
});

test('cacheIsFresh: boundary at exactly the TTL is stale', () => {
  const at = new Date(NOW - REVOCATION_DELAY_MS).toISOString();
  assert.equal(cacheIsFresh(at, NOW), false);
  const justInside = new Date(NOW - REVOCATION_DELAY_MS + 1000).toISOString();
  assert.equal(cacheIsFresh(justInside, NOW), true);
  assert.equal(cacheIsFresh(null, NOW), false);
  assert.equal(cacheIsFresh('not a date', NOW), false);
});

test('fresh cache short-circuits — no network call at all', async () => {
  let called = 0;
  const spy: typeof fetch = async () => {
    called += 1;
    return new Response('{}');
  };
  const r = await estateCheck(
    { status: 'approved', checkedAt: new Date(NOW - 1000).toISOString() },
    me,
    opts(spy),
    NOW,
  );
  assert.equal(r.status, 'approved');
  assert.equal(r.refresh, null);
  assert.equal(called, 0, 'the whole point of the cache is not calling');
});

test('stale cache + reachable estate refreshes and says to persist', async () => {
  const r = await estateCheck(
    { status: 'approved', checkedAt: new Date(NOW - REVOCATION_DELAY_MS - 1).toISOString() },
    me,
    opts(okFetch('revoked')),
    NOW,
  );
  assert.equal(r.status, 'revoked', 'a revocation lands at the first check past the TTL');
  assert.deepEqual(r.refresh, { status: 'revoked', checkedAt: new Date(NOW).toISOString() });
});

test('stale cache + unreachable estate keeps the stale value, flagged stale', async () => {
  const r = await estateCheck(
    { status: 'approved', checkedAt: new Date(NOW - REVOCATION_DELAY_MS * 3).toISOString() },
    me,
    opts(failFetch),
    NOW,
  );
  assert.equal(r.status, 'approved', 'fail-open on stale cache for the already-admitted');
  assert.equal(r.stale, true, 'staleness must be visible so the log line can count it');
  assert.equal(r.refresh, null);
});

test('no cache + unreachable estate = null — the caller fails closed for non-standing users', async () => {
  const r = await estateCheck({ status: null, checkedAt: null }, me, opts(failFetch), NOW);
  assert.equal(r.status, null);
  assert.equal(r.stale, false);
});

test('postSeen refuses garbage answers rather than caching them', async () => {
  assert.equal(await postSeen(opts(okFetch('banana')), me), null);
  assert.equal(await postSeen(opts(okFetch(undefined)), me), null);
  const err500: typeof fetch = async () => new Response('boom', { status: 500 });
  assert.equal(await postSeen(opts(err500), me), null);
  const denied: typeof fetch = async () => new Response('{}', { status: 401 });
  assert.equal(await postSeen(opts(denied), me), null, 'a 401 (bad app token) is a failure, not a status');
});

test('postSeen sends the bearer and the snake_case body the Worker expects', async () => {
  let seen: { url: string; auth: string | null; body: unknown } | null = null;
  const spy: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    seen = {
      url: String(input),
      auth: headers.get('Authorization'),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({ status: 'pending' }), { status: 200 });
  };
  const status = await postSeen(opts(spy), {
    email: 'x@y.z',
    firebaseUid: 'u1',
    displayName: 'X',
  });
  assert.equal(status, 'pending');
  assert.ok(seen !== null);
  const got = seen as { url: string; auth: string | null; body: unknown };
  assert.equal(got.url, 'https://auth.example/api/estate/seen');
  assert.equal(got.auth, 'Bearer tok');
  assert.deepEqual(got.body, { email: 'x@y.z', firebase_uid: 'u1', display_name: 'X' });
});
