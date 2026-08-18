/**
 * GET|HEAD /api/audio/:anchor/file + GET /api/audio/status — the audiobook
 * player's phase-1 surface (2026-08-18).
 *
 * Exercised through the REAL exported Hono app, with the estate directory
 * stubbed at `globalThis.fetch` and fake R2 buckets — the `ebook-file.test.ts`
 * idiom, deliberately, because the route is a deliberate near-copy and its
 * tests should be too.
 *
 * ⚠️ Stated plainly: these prove the DECISIONS and the header contract. They
 * do NOT prove that a 601 MB m4b streams through Cloudflare unbuffered, that
 * Safari plays it, or that a real member holds the grant. Nothing in the
 * handler awaits a body, which makes the no-buffering claim architectural
 * rather than tested; everything else on that list is on the NOT-VERIFIED
 * ledger until a signed-in listen happens live.
 *
 * Every test is behaviour-failing: the named mutation in each comment turns it
 * red.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetAudioManifestIndex } from '../src/audio-manifest.js';
import { resetManifestIndex } from '../src/ebook-manifest.js';
import {
  resetListenBudget,
  LISTEN_DISTINCT_BOOKS_PER_WINDOW,
  LISTEN_REQUESTS_PER_WINDOW,
} from '../src/listen-budget.js';
import { resetReadBudget, DISTINCT_BOOKS_PER_WINDOW, REQUESTS_PER_WINDOW } from '../src/read-budget.js';
import type { Env } from '../src/env.js';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const UP_ANCHOR = 'b-aud0001';
/** Recorded but `streamable: false` — an EVICTED book, the "request it" path. */
const EVICTED_ANCHOR = 'b-aud0002';
/** Streamable in the record, absent from the bucket — the DRIFT path. */
const DRIFT_ANCHOR = 'b-aud0003';
/** Uploaded by path with no `--title`: streamable, but invisible to the shelf. */
const UNTITLED_ANCHOR = 'b-aud0004';

const AUDIO_MANIFEST = {
  bucket: 'estate-audio',
  generated: '2026-08-18T02:00:00Z',
  count: 4,
  streamable: 3,
  files: {
    'Brandon Sanderson/Skyward.m4b': {
      anchor: UP_ANCHOR,
      title: 'Skyward',
      bookId: 'skyward',
      size: 40,
      sha256: null,
      streamable: true,
      since: '2026-08-18T01:00:00Z',
      uploaded_at: '2026-08-18T01:00:00Z',
      last_stream_at: null,
      last_position_at: null,
    },
    'Someone Else/Evicted Book.m4b': {
      anchor: EVICTED_ANCHOR,
      title: 'Evicted Book',
      bookId: 'evicted-book',
      size: 40,
      streamable: false,
      since: '2026-07-01T01:00:00Z',
      evicted_at: '2026-08-10T01:00:00Z',
    },
    'Someone Else/Drifted.m4b': {
      anchor: DRIFT_ANCHOR,
      title: 'Drifted',
      bookId: 'drifted',
      size: 40,
      streamable: true,
      since: '2026-08-01T01:00:00Z',
    },
    'Loose/Untitled.m4b': {
      anchor: UNTITLED_ANCHOR,
      title: null,
      bookId: null,
      size: 40,
      streamable: true,
      since: '2026-08-02T01:00:00Z',
    },
  },
};

/** 40 bytes of known content, so a range's BYTES can be checked, not its length. */
const FILE_BODY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
const FILE_SIZE = FILE_BODY.length; // 40

/**
 * The gated-manifest bucket. ⚠️ It answers BOTH keys, exactly as production
 * does — `ebooks.json` for the shelf and `audio_manifest.json` for the player.
 * Sharing one bucket is a decision (audio-manifest.ts's header); a fixture
 * that only knew one key would hide a collision if one ever appeared.
 */
function fakeGatedBucket(audio: unknown | null, ebooks: unknown | null = { ebooks: [] }) {
  return {
    async get(key: string) {
      if (key === 'audio_manifest.json') {
        return audio === null ? null : { async json() { return audio; } };
      }
      if (key === 'ebooks.json') {
        return ebooks === null ? null : { async json() { return ebooks; } };
      }
      return null;
    },
  } as unknown as R2Bucket;
}

function fakeAudioBucket(present: Record<string, string>) {
  const enc = new TextEncoder();
  const meta = (key: string, v: string) => ({
    size: v.length,
    httpEtag: '"etag-' + key.length + '"',
    httpMetadata: { contentType: 'audio/mp4' },
  });
  return {
    async head(key: string) {
      const v = present[key];
      return v === undefined ? null : meta(key, v);
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const v = present[key];
      if (v === undefined) return null;
      const slice = opts?.range
        ? v.slice(opts.range.offset, opts.range.offset + opts.range.length)
        : v;
      return {
        ...meta(key, v),
        body: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(enc.encode(slice));
            ctrl.close();
          },
        }),
      };
    },
  } as unknown as R2Bucket;
}

/** ⚠️ `Drifted.m4b` is deliberately absent — the record/bucket drift case. */
const AUDIO_FILES = {
  'Brandon Sanderson/Skyward.m4b': FILE_BODY,
  'Loose/Untitled.m4b': FILE_BODY,
};

interface Script {
  seen: { status: string; visibility?: unknown } | 'error';
}

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/estate/seen')) {
      if (script.seen === 'error') return new Response('boom', { status: 500 });
      return Response.json(script.seen);
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'member@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'enforce',
    SITE_ORIGINS: 'https://audiobooks.heygabi.ai,https://ebooks.heygabi.ai',
    EBOOKS_GATED: fakeGatedBucket(AUDIO_MANIFEST),
    AUDIO: fakeAudioBucket(AUDIO_FILES),
    ...over,
  };
}

/** The grant that admits: `ebooks` in the visibility list. */
const GRANTED: Script = { seen: { status: 'approved', visibility: ['audiobook', 'ebooks'] } };
/** Approved, sees the audiobook SITE, holds no book-files grant. */
const SITE_ONLY: Script = { seen: { status: 'approved', visibility: ['audiobook'] } };

const fileUrl = (anchor: string) => `/api/audio/${anchor}/file`;

beforeEach(() => {
  resetEstateCache();
  resetAudioManifestIndex();
  resetManifestIndex();
  resetListenBudget();
  resetReadBudget();
});

/* ── the gate ───────────────────────────────────────────────────────────── */

test('⚠️ no token → 401, in words, and NOT ONE BYTE', async () => {
  // Law 3 in executable form: the URL alone carries no credential and can
  // never be one. ENVIRONMENT 'production' turns the dev bypass off.
  const res = await app.request(fileUrl(UP_ANCHOR), {}, envWith({ ENVIRONMENT: 'production' }));
  assert.equal(res.status, 401);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, 'unauthenticated');
  assert.match(String(body.detail), /[Ss]ign in/);
  // ⚠️ Nothing about the library leaks through a refusal.
  assert.equal(JSON.stringify(body).includes('Skyward'), false);
  assert.equal(JSON.stringify(body).includes('.m4b'), false);
});

test('⚠️ approved WITHOUT the ebooks grant → 403, and it names the fix', async () => {
  // Owner decision 1: the BYTES ride `vis_ebooks`. Someone who can see the
  // audiobook site (vis_audiobook, default 1) still cannot listen.
  // Mutation that turns this red: gating on `audiobook` instead.
  const f = stubFetch(SITE_ONLY);
  try {
    const res = await app.request(fileUrl(UP_ANCHOR), {}, envWith());
    assert.equal(res.status, 403);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'no_ebooks_grant');
    assert.match(String(body.detail), /Ebooks/);
  } finally {
    f.restore();
  }
});

test('⚠️ a granted member with NO ladder rung gets bytes', async () => {
  // The capability inversion this route must never ship: `download` floors at
  // admin, and gating listening on it would lock every ordinary member out of
  // the thing the grant was given for. No service account is configured in
  // this env, so any `download` check would have to fail — and it does not,
  // because there is no such check.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(fileUrl(UP_ANCHOR), {}, envWith());
    assert.equal(res.status, 200);
    assert.equal(await res.text(), FILE_BODY);
  } finally {
    f.restore();
  }
});

/* ── the three distinct "not here" facts ───────────────────────────────── */

test('⚠️ an unknown anchor is a 404 about the LINK, never a 403', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(fileUrl('b-nope'), {}, envWith());
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as Record<string, unknown>).error, 'unknown_book');
  } finally {
    f.restore();
  }
});

test('🔴 a NOT-YET-INGESTED book says "request it", and says how long', async () => {
  // THE sentence this phase exists for. On-demand ingest (owner decision 3)
  // means "absent" is the normal state, so the refusal has to carry the next
  // action and an HONEST wait — the pipeline runs every 8 hours, so "within
  // the hour" (the design's original draft wording) would be a lie.
  //
  // Mutation that turns this red: collapsing not_streamable into unknown_book,
  // or into a 403, or dropping the eight-hour sentence.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(fileUrl(EVICTED_ANCHOR), {}, envWith());
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'not_streamable');
    assert.match(String(body.detail), /not streamable yet/i);
    assert.match(String(body.detail), /request it/i);
    assert.match(String(body.detail), /eight hours/i);
  } finally {
    f.restore();
  }
});

test('⚠️ record says streamable, bucket disagrees → its OWN sentence', async () => {
  // A third fact, not a variant of the second: this one is our bug, and the
  // person is told so rather than being told to press a button that will look
  // like it did nothing.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(fileUrl(DRIFT_ANCHOR), {}, envWith());
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'file_absent');
    assert.match(String(body.detail), /tell Mitch/);
  } finally {
    f.restore();
  }
});

/* ── Range, 206, and the header contract ───────────────────────────────── */

test('⚠️ EVERY answer carries Accept-Ranges — refusals included', async () => {
  // Safari decides whether a media element can play AT ALL from this header,
  // and the response it learns from may be the 401 it got before sign-in.
  // Mutation: drop ACCEPT_RANGES from refuse()/dress() and this goes red on
  // the first case.
  const cases: Array<[Env, string, Script | null]> = [
    [envWith({ ENVIRONMENT: 'production' }), UP_ANCHOR, null],
    [envWith(), UP_ANCHOR, { seen: { status: 'revoked', visibility: [] } }],
    [envWith(), UP_ANCHOR, SITE_ONLY],
    [envWith(), 'b-nope', GRANTED],
    [envWith(), EVICTED_ANCHOR, GRANTED],
    [envWith(), DRIFT_ANCHOR, GRANTED],
    [envWith({ AUDIO: undefined }), UP_ANCHOR, GRANTED],
    [envWith({ EBOOKS_GATED: undefined }), UP_ANCHOR, GRANTED],
    [envWith({ EBOOKS_GATED: fakeGatedBucket(null) }), UP_ANCHOR, GRANTED],
  ];
  for (const [env, anchor, script] of cases) {
    resetEstateCache();
    resetAudioManifestIndex();
    resetListenBudget();
    const f = script ? stubFetch(script) : null;
    try {
      const res = await app.request(fileUrl(anchor), {}, env);
      assert.ok(res.status >= 400, `expected a refusal, got ${res.status}`);
      assert.equal(res.headers.get('accept-ranges'), 'bytes', `status ${res.status}`);
      assert.equal(
        res.headers.get('cache-control'),
        'private, max-age=0, no-store',
        `status ${res.status}`,
      );
      // ⚠️ `includes`, not `equals`: hono's cors() middleware APPENDS `Origin`
      // to whatever Vary the handler set, so the live header reads
      // "Authorization, Origin". Asserting equality here passes in a unit
      // fixture with no middleware and fails against the real app — which is
      // exactly what it did when this file was written. Both values are
      // wanted; what matters is that Authorization is one of them.
      assert.match(String(res.headers.get('vary')), /Authorization/, `status ${res.status}`);
    } finally {
      f?.restore();
    }
  }
});

test('a Range yields 206 with the RIGHT BYTES and a correct Content-Range', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(
      fileUrl(UP_ANCHOR),
      { headers: { Range: 'bytes=5-9' } },
      envWith(),
    );
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 5-9/${FILE_SIZE}`);
    assert.equal(res.headers.get('content-length'), '5');
    assert.equal(await res.text(), 'FGHIJ');
  } finally {
    f.restore();
  }
});

test('an unsatisfiable Range is a 416 carrying `bytes */size`', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(
      fileUrl(UP_ANCHOR),
      { headers: { Range: 'bytes=9999-' } },
      envWith(),
    );
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), `bytes */${FILE_SIZE}`);
  } finally {
    f.restore();
  }
});

test('⚠️ HEAD answers the same headers with no body — the auth-seam probe', async () => {
  // Design §3.2 item 5: the page issues its own HEAD with a real bearer before
  // setting <audio src>, because an <audio> element reports a 401 as a bare
  // `error` event with no status and the person sees a dead play button.
  // Deleting the HEAD route re-opens that hole.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(fileUrl(UP_ANCHOR), { method: 'HEAD' }, envWith());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('content-type'), 'audio/mp4');
    assert.equal(await res.text(), '');
  } finally {
    f.restore();
  }
});

test('⚠️ Content-Type is audio/mp4 and Content-Disposition is INLINE', async () => {
  // Never audio/x-m4b, never application/octet-stream — browsers key playback
  // behaviour off the type. And `inline`, because this is a player: the
  // download affordance is a different route with an admin floor.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(fileUrl(UP_ANCHOR), {}, envWith());
    assert.equal(res.headers.get('content-type'), 'audio/mp4');
    assert.match(String(res.headers.get('content-disposition')), /^inline;/);
    assert.match(String(res.headers.get('content-disposition')), /Skyward\.m4b/);
  } finally {
    f.restore();
  }
});

/* ── the budget ─────────────────────────────────────────────────────────── */

test('🔴 the LISTENING budget is its own, and it is NOT the reading one', async () => {
  // The whole point of listen-budget.ts. Sharing read-budget.ts's Map would
  // let a 13-hour listen exhaust a reader's page turns and vice versa; sharing
  // its NUMBERS would throttle listening, which design §7.5 names as the exact
  // failure to avoid. Both must differ, in both directions.
  assert.notEqual(LISTEN_REQUESTS_PER_WINDOW, REQUESTS_PER_WINDOW);
  assert.notEqual(LISTEN_DISTINCT_BOOKS_PER_WINDOW, DISTINCT_BOOKS_PER_WINDOW);
  // Sized UP on requests (hours of ranges) and DOWN on books (a listener opens
  // one). Getting either direction backwards is the bug this pins.
  assert.ok(LISTEN_REQUESTS_PER_WINDOW > REQUESTS_PER_WINDOW);
  assert.ok(LISTEN_DISTINCT_BOOKS_PER_WINDOW < DISTINCT_BOOKS_PER_WINDOW);
});

test('⚠️ ranges within ONE book are free on the book axis', async () => {
  // Remove this clause and every long listen becomes a refusal. Far more
  // requests than the book limit, all on one anchor, all served.
  const f = stubFetch(GRANTED);
  try {
    for (let i = 0; i < LISTEN_DISTINCT_BOOKS_PER_WINDOW * 4; i++) {
      const res = await app.request(
        fileUrl(UP_ANCHOR),
        { headers: { Range: `bytes=${i}-${i + 1}` } },
        envWith(),
      );
      assert.equal(res.status, 206, `range #${i}`);
    }
  } finally {
    f.restore();
  }
});

test('the book axis refuses the (N+1)th DISTINCT anchor, in words, with Retry-After', async () => {
  const f = stubFetch(GRANTED);
  try {
    const env = envWith();
    for (let i = 0; i < LISTEN_DISTINCT_BOOKS_PER_WINDOW; i++) {
      // Unknown anchors still charge — a 404 must not be a free probe.
      await app.request(fileUrl(`b-x${i}`), {}, env);
    }
    const res = await app.request(fileUrl(UP_ANCHOR), {}, env);
    assert.equal(res.status, 429);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'rate_limited');
    assert.match(String(body.detail), /pacing you/);
    assert.ok(Number(res.headers.get('retry-after')) > 0);
  } finally {
    f.restore();
  }
});

test('⚠️ the OWNER is exempt — a break-glass that can be rate-limited is not one', async () => {
  // No estate stub at all: OWNER_EMAILS short-circuits before the round trip.
  const env = envWith({ DEV_EMAIL: 'owner@example.com' });
  for (let i = 0; i < LISTEN_DISTINCT_BOOKS_PER_WINDOW + 3; i++) {
    const res = await app.request(fileUrl(`b-x${i}`), {}, env);
    assert.notEqual(res.status, 429);
  }
});

/* ── GET /api/audio/status ─────────────────────────────────────────────── */

test('🔴 the status projection NEVER carries a path', async () => {
  // The single most important assertion in this file. `site/audio_manifest.json`
  // is gitignored in a PUBLIC repo precisely because it maps 630 GB of the
  // household's audio filename by filename; serving it through an API would
  // reopen that surface from the other end. Mutation: spread the manifest row
  // instead of the five-field allowlist, and this goes red.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request('/api/audio/status', {}, envWith());
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.equal(raw.includes('Brandon Sanderson/Skyward.m4b'), false);
    assert.equal(raw.includes('path'), false);
    assert.equal(raw.includes('sha256'), false);
    assert.equal(raw.includes('last_stream_at'), false);
    const body = JSON.parse(raw) as { books: Array<Record<string, unknown>> };
    for (const b of body.books) {
      assert.deepEqual(
        Object.keys(b).sort(),
        ['anchor', 'bookId', 'since', 'sizeBytes', 'title'],
      );
    }
  } finally {
    f.restore();
  }
});

test('status lists the streamable books, omits the evicted one, keeps the untitled one', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request('/api/audio/status', {}, envWith());
    const body = (await res.json()) as {
      books: Array<{ bookId: string | null; anchor: string }>;
      count: number;
      player: string;
    };
    assert.equal(body.count, 3);
    const ids = body.books.map((b) => b.bookId);
    assert.ok(ids.includes('skyward'));
    assert.ok(ids.includes('drifted')); // recorded streamable — the bucket's disagreement is the FILE route's problem
    // ⚠️ A book uploaded with no --title is streamable and has a NULL bookId,
    // so the shelf cannot match it. A named gap, not a mystery.
    assert.ok(ids.includes(null));
    // The evicted book is not offered — a play button that 404s is worse than
    // a "request it" button.
    assert.equal(ids.includes('evicted-book'), false);
    // Phase 2 has not shipped; the site renders an honest ladder from this.
    assert.equal(body.player, 'phase2');
  } finally {
    f.restore();
  }
});

test('status is behind the SAME gate as the bytes', async () => {
  const f = stubFetch(SITE_ONLY);
  try {
    const res = await app.request('/api/audio/status', {}, envWith());
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as Record<string, unknown>).error, 'no_ebooks_grant');
  } finally {
    f.restore();
  }
});

test('an empty audio manifest is a 200 with zero books, NOT an error', async () => {
  // On-demand ingest starts with an empty bucket. "Nobody has requested a book
  // yet" is the design working. Mutation: treat an empty `files` map as
  // unreadable and this goes red.
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(
      '/api/audio/status',
      {},
      envWith({ EBOOKS_GATED: fakeGatedBucket({ files: {} }) }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { count: number };
    assert.equal(body.count, 0);
  } finally {
    f.restore();
  }
});

test('a never-published manifest is a 503 that says on-demand is normal', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request(
      '/api/audio/status',
      {},
      envWith({ EBOOKS_GATED: fakeGatedBucket(null) }),
    );
    assert.equal(res.status, 503);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'manifest_absent');
    assert.match(String(body.detail), /on request/);
  } finally {
    f.restore();
  }
});

test('status is never cacheable', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await app.request('/api/audio/status', {}, envWith());
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    // See the note above: cors() appends `Origin`, so this is a containment
    // check rather than an equality one.
    assert.match(String(res.headers.get('vary')), /Authorization/);
  } finally {
    f.restore();
  }
});

/* ── the must-not-regress ──────────────────────────────────────────────── */

test('🔴 the EBOOK routes are untouched by all of this', async () => {
  // The one thing this phase could break that nobody would notice until a
  // reader opened a book. The shelf and the byte route share the gate and the
  // gated bucket with the new routes; a fixture that answers `ebooks.json`
  // proves the second key did not displace the first.
  const f = stubFetch(GRANTED);
  try {
    const env = envWith({
      EBOOKS_GATED: fakeGatedBucket(AUDIO_MANIFEST, {
        generated_at: '2026-08-18T02:00:00Z',
        ebooks: [{ path: 'A/one.epub', anchor: 'b-eb01', title: 'One', format: 'epub' }],
      }),
    });
    const shelf = await app.request('/api/ebooks/manifest', {}, env);
    assert.equal(shelf.status, 200);
    const body = (await shelf.json()) as { ebooks: unknown[] };
    assert.equal(body.ebooks.length, 1);

    // And the ebook byte route still refuses an audio anchor: two manifests,
    // two indexes, no crossing over.
    resetEstateCache();
    const bytes = await app.request(`/api/ebook/${UP_ANCHOR}/file`, {}, env);
    assert.equal(bytes.status, 404);
    assert.equal(((await bytes.json()) as Record<string, unknown>).error, 'unknown_book');
  } finally {
    f.restore();
  }
});
