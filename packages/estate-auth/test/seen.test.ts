import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  REVOCATION_DELAY_MS,
  cacheIsFresh,
  estateCheck,
  postSeen,
  postSeenAnswer,
} from '../src/seen.js';
import { parseVisibility } from '../src/visibility.js';

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
  assert.deepEqual(r.refresh, {
    status: 'revoked',
    visibility: null,
    checkedAt: new Date(NOW).toISOString(),
  });
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

// --- §4.5: visibility rides WITH status, one answer, never aged separately. -

const okFullFetch =
  (status: unknown, visibility: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify({ status, visibility }), { status: 200 });

test('parseVisibility: canonical order enforced, duplicates collapsed, garbage refused', () => {
  assert.deepEqual(parseVisibility(['games', 'audiobook']), ['audiobook', 'games']);
  assert.deepEqual(parseVisibility(['library', 'library']), ['library']);
  assert.deepEqual(parseVisibility([]), []);
  assert.equal(parseVisibility(['audiobook', 'banana']), null);
  assert.equal(parseVisibility('audiobook'), null);
  assert.equal(parseVisibility(undefined), null);
});

test('parseVisibility: library2 (the 4th catalog, 0007) is a known name, canonicalised LAST', () => {
  assert.deepEqual(parseVisibility(['library2']), ['library2']);
  assert.deepEqual(parseVisibility(['library2', 'audiobook']), ['audiobook', 'library2']);
  assert.deepEqual(parseVisibility(['library2', 'games', 'library', 'audiobook']), [
    'audiobook',
    'library',
    'games',
    'library2',
  ]);
  // Only the exact name — near-misses die at the boundary like any garbage.
  assert.equal(parseVisibility(['library-2']), null);
  assert.equal(parseVisibility(['library3']), null);
});

test('postSeenAnswer carries the effective visibility verbatim, canonicalised', async () => {
  const r = await postSeenAnswer(opts(okFullFetch('approved', ['games', 'audiobook'])), me);
  assert.deepEqual(r, { status: 'approved', visibility: ['audiobook', 'games'] });
  const revoked = await postSeenAnswer(opts(okFullFetch('revoked', [])), me);
  assert.deepEqual(
    revoked,
    { status: 'revoked', visibility: [] },
    '[] is an answer, not an absence',
  );
});

test('a missing or garbage visibility field is null, NOT a failed answer — the status half still stands', async () => {
  const noVis = await postSeenAnswer(opts(okFetch('approved')), me);
  assert.deepEqual(noVis, { status: 'approved', visibility: null });
  const garbage = await postSeenAnswer(opts(okFullFetch('approved', 'everything')), me);
  assert.deepEqual(garbage, { status: 'approved', visibility: null });
});

test('estateCheck: a fresh answer refreshes visibility WITH status — one write, one age', async () => {
  const r = await estateCheck(
    { status: null, checkedAt: null },
    me,
    opts(okFullFetch('approved', ['audiobook', 'games'])),
    NOW,
  );
  assert.equal(r.status, 'approved');
  assert.deepEqual(r.visibility, ['audiobook', 'games']);
  assert.deepEqual(r.refresh, {
    status: 'approved',
    visibility: ['audiobook', 'games'],
    checkedAt: new Date(NOW).toISOString(),
  });
});

test('estateCheck: a fresh cache WITH visibility short-circuits; requireVisibility adds nothing', async () => {
  let called = 0;
  const spy: typeof fetch = async () => {
    called += 1;
    return new Response('{}');
  };
  const r = await estateCheck(
    { status: 'approved', checkedAt: new Date(NOW - 1000).toISOString(), visibility: ['games'] },
    me,
    { ...opts(spy), requireVisibility: true },
    NOW,
  );
  assert.deepEqual(r.visibility, ['games']);
  assert.equal(called, 0);
});

test('estateCheck + requireVisibility: a fresh cache MISSING visibility is healed by one /seen call', async () => {
  const r = await estateCheck(
    { status: 'approved', checkedAt: new Date(NOW - 1000).toISOString() }, // pre-§4.5 row
    me,
    { ...opts(okFullFetch('approved', ['audiobook', 'library', 'games'])), requireVisibility: true },
    NOW,
  );
  assert.deepEqual(r.visibility, ['audiobook', 'library', 'games']);
  assert.ok(r.refresh, 'the whole answer is persisted so the next request short-circuits');
});

test('estateCheck without requireVisibility: the fresh visibility-less cache still short-circuits (status-only consumers untouched)', async () => {
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
  assert.equal(r.visibility, null);
  assert.equal(called, 0);
});

test('estateCheck: unreachable estate — the STALE cached visibility rides with its stale status', async () => {
  const r = await estateCheck(
    {
      status: 'approved',
      checkedAt: new Date(NOW - REVOCATION_DELAY_MS * 3).toISOString(),
      visibility: ['audiobook', 'library'],
    },
    me,
    opts(failFetch),
    NOW,
  );
  assert.equal(r.status, 'approved');
  assert.deepEqual(r.visibility, ['audiobook', 'library'], 'the cached pair travels together');
  assert.equal(r.stale, true);
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

// --- 0008: the ebook catalog on the wire ---
//
// ⚠️ The 0009 download-capability tests that sat beside these were DELETED on
// 2026-08-17, one day after they were written, when the owner superseded the
// mechanism they pinned: *"For ebooks I don't want a download check box, I
// want to use roles we have. Set up the roles to match library."*
// `download_ebooks` is not on this wire at all any more; the replacement test
// at the end of this file pins its ABSENCE, which is the fact worth keeping.

test('parseVisibility: `ebooks` (0008) is a known name, canonicalised LAST of all', () => {
  assert.deepEqual(parseVisibility(['ebooks']), ['ebooks']);
  assert.deepEqual(parseVisibility(['ebooks', 'audiobook']), ['audiobook', 'ebooks']);
  assert.deepEqual(parseVisibility(['ebooks', 'library2', 'games', 'library', 'audiobook']), [
    'audiobook',
    'library',
    'games',
    'library2',
    'ebooks',
  ]);
  // Near-misses die at the boundary — 'ebook' singular is the FORMAT the
  // index rows carry, never a catalog name, and confusing the two would open
  // the shelf by typo.
  assert.equal(parseVisibility(['ebook']), null);
});

test('⚠️ the estate answers NO download fact — a server still sending one is ignored', async () => {
  // The round trip, pinned so it cannot be walked back by accident:
  //   2026-08-16  the ebooks gate ships `download_ebooks` on this wire (0009)
  //   2026-08-17  the owner replaces the per-person grant with a ROLE floor
  //               ("use roles we have… match library"), and the field goes
  //
  // This test is the guard on the SECOND move. An auth-worker mid-deploy (or
  // rolled back) can still put `download_ebooks` on the body; the client must
  // drop it on the floor rather than surface a capability this system no
  // longer honours. Downloading is `can(role, 'download')` on the consumer's
  // own ladder now — see audiobook-worker's capabilities.ts.
  const stillSendsIt: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'approved', visibility: ['ebooks'], download_ebooks: true }), {
      status: 200,
    });
  const answer = await postSeenAnswer(opts(stillSendsIt), me);
  // deepEqual, not a property check: the whole shape must be these two keys.
  assert.deepEqual(answer, { status: 'approved', visibility: ['ebooks'] });
  assert.ok(!('downloadEbooks' in (answer as object)), 'the field must not come back');

  // …and it reaches neither the result nor the cache write.
  const fresh = await estateCheck({ status: null, checkedAt: null }, me, opts(stillSendsIt), NOW);
  assert.deepEqual(Object.keys(fresh.refresh ?? {}).sort(), ['checkedAt', 'status', 'visibility']);
  assert.deepEqual(Object.keys(fresh).sort(), ['refresh', 'stale', 'status', 'visibility']);

  // The visibility half is untouched by the removal: `ebooks` still rides the
  // answer, because SEEING the shelf remains the estate's decision.
  assert.deepEqual(fresh.visibility, ['ebooks']);
});
