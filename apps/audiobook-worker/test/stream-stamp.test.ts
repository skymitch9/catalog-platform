/**
 * The eviction access stamp — `audio_streams/{anchor}` (audio phase 2's
 * platform half, 2026-09-02). Design: `docs/info/audio-player-design.md`
 * §10.1; the reader is `audiobook_catalog`'s `app/tools/fulfill_audio_requests.py`.
 *
 * ⚠️ **These tests exist because the contract is CROSS-REPO and the failure is
 * SILENT.** A stamp in the wrong units, under the wrong field name, or in the
 * wrong collection is not an error anywhere — it is a book that looks
 * abandoned to `evict_candidates()`, which deletes on that reading. So the
 * shape is pinned on the WIRE (the actual PATCH body and URL a stubbed
 * `globalThis.fetch` sees), never on the function that produced it.
 *
 * What they do NOT prove: that a real Firestore accepts the write, or that the
 * evictor then reads it. That needs one real playback and
 * `python -m app.tools.fulfill_audio_requests --status` — it is on the
 * NOT-VERIFIED ledger in `docs/TODO.md`.
 *
 * Every test is behaviour-failing: the named mutation in each comment turns it
 * red.
 */

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { before, beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetAudioManifestIndex } from '../src/audio-manifest.js';
import { resetManifestIndex } from '../src/ebook-manifest.js';
import { resetListenBudget } from '../src/listen-budget.js';
import {
  claimStreamStamp,
  resetStreamStamps,
  stampStream,
  streamStampFields,
  STREAM_STAMP_COLLECTION,
  STREAM_STAMP_THROTTLE_MS,
} from '../src/stream-stamp.js';
import type { Env } from '../src/env.js';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const UP_ANCHOR = 'b-aud0001';
const FILE_BODY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';

const AUDIO_MANIFEST = {
  bucket: 'estate-audio',
  generated: '2026-09-02T02:00:00Z',
  count: 1,
  streamable: 1,
  files: {
    'Brandon Sanderson/Skyward.m4b': {
      anchor: UP_ANCHOR,
      title: 'Skyward',
      bookId: 'skyward',
      size: FILE_BODY.length,
      streamable: true,
      since: '2026-08-23T05:39:21Z',
    },
  },
};

function fakeGatedBucket() {
  return {
    async get(key: string) {
      if (key === 'audio_manifest.json') return { async json() { return AUDIO_MANIFEST; } };
      if (key === 'ebooks.json') return { async json() { return { ebooks: [] }; } };
      return null;
    },
  } as unknown as R2Bucket;
}

function fakeAudioBucket() {
  const enc = new TextEncoder();
  const meta = { size: FILE_BODY.length, httpEtag: '"e"', httpMetadata: { contentType: 'audio/mp4' } };
  const KEY = 'Brandon Sanderson/Skyward.m4b';
  return {
    async head(key: string) {
      return key === KEY ? meta : null;
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      if (key !== KEY) return null;
      const slice = opts?.range
        ? FILE_BODY.slice(opts.range.offset, opts.range.offset + opts.range.length)
        : FILE_BODY;
      return {
        ...meta,
        body: new ReadableStream({
          start(ctrl) { ctrl.enqueue(enc.encode(slice)); ctrl.close(); },
        }),
      };
    },
  } as unknown as R2Bucket;
}

/**
 * A service account with a REAL, freshly generated RSA key.
 *
 * ⚠️ It has to be real: `mintAccessToken` imports the PEM through WebCrypto
 * BEFORE it makes any request, so a fake key throws there and every write test
 * lands on `failed` — which looks exactly like the stamp being broken. The
 * key is generated here, used once, and never leaves the process; nothing in
 * this file is a credential.
 */
let FAKE_SA = '';

before(() => {
  // ⚠️ `node:crypto` rather than WebCrypto: the PKCS#8 PEM comes out directly,
  // and this file's tsconfig types `crypto.subtle` from @cloudflare/workers-types
  // where the export overloads do not line up with Node's runtime object.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  FAKE_SA = JSON.stringify({
    client_email: 'sa@audiobook-catalog.iam.gserviceaccount.com',
    private_key: privateKey,
    project_id: 'audiobook-catalog',
  });
});

interface Captured {
  url: string;
  body: unknown;
  method: string;
}

/**
 * Stub the estate directory, Google's token endpoint and Firestore. Every
 * Firestore PATCH is captured so the wire shape can be asserted.
 *
 * ⚠️ `mintAccessToken` caches per isolate keyed `client_email|scope`, so a
 * later test can get a token without hitting the stub. That is fine — what is
 * asserted is the PATCH.
 */
function stubFetch(opts: { firestoreStatus?: number } = {}) {
  const original = globalThis.fetch;
  const captured: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/estate/seen')) {
      return Response.json({ status: 'approved', visibility: ['audiobook', 'ebooks'] });
    }
    if (url.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'stub-token', expires_in: 3600 });
    }
    if (url.includes('firestore.googleapis.com')) {
      captured.push({
        url,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response('{}', { status: opts.firestoreStatus ?? 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { captured, restore: () => void (globalThis.fetch = original) };
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
    SITE_ORIGINS: 'https://audiobooks.heygabi.ai',
    EBOOKS_GATED: fakeGatedBucket(),
    AUDIO: fakeAudioBucket(),
    FIREBASE_SERVICE_ACCOUNT: FAKE_SA,
    ...over,
  } as Env;
}

/** A minimal ExecutionContext, so waitUntil'd work can be AWAITED in a test. */
function waitUntilCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException() {} },
    settle: () => Promise.allSettled(pending),
  };
}

beforeEach(() => {
  resetEstateCache();
  resetAudioManifestIndex();
  resetManifestIndex();
  resetListenBudget();
  resetStreamStamps();
});

/* ── the wire contract ──────────────────────────────────────────────────── */

test('🔴 THE CROSS-REPO CONTRACT: `{ anchor, lastStreamAt }`, lastStreamAt in epoch MILLISECONDS', () => {
  // parse_stream_doc's docstring, verbatim. Mutation that turns this red:
  // stamping `Math.floor(Date.now()/1000)`, or a `timestampValue`.
  //
  // ⚠️ The reader's `_parse_stamp` divides by 1000 only ABOVE 1e11, so a
  // seconds stamp is silently read as a date in 1970 — a book that is being
  // listened to looks two generations idle, and the evictor deletes on that.
  const now = 1_772_000_000_000;
  const fields = streamStampFields(UP_ANCHOR, now);
  assert.deepEqual(Object.keys(fields).sort(), ['anchor', 'lastStreamAt']);
  assert.deepEqual(fields['anchor'], { stringValue: UP_ANCHOR });
  assert.deepEqual(fields['lastStreamAt'], { integerValue: String(now) });
  // The reader's threshold, stated as an assertion rather than a comment.
  assert.ok(now > 1e11, 'a stamp below 1e11 is read as SECONDS by the evictor');
});

test('the collection is `audio_streams` — the PROD lane, which both site lanes land in', () => {
  // The reader unions audio_streams + audio_streams_dev and takes the newest;
  // nothing in a request can tell the lanes apart (the /dev/ lane is a PATH on
  // the same host), so a guess would be wrong half the time.
  assert.equal(STREAM_STAMP_COLLECTION, 'audio_streams');
});

test('the throttle is ONE HOUR per anchor per isolate, and it claims on success', () => {
  // Design §10.1's number. Mutation that turns this red: the deleted ping
  // route's ten minutes.
  assert.equal(STREAM_STAMP_THROTTLE_MS, 60 * 60 * 1000);
  const t0 = 1_772_000_000_000;
  assert.equal(claimStreamStamp('a', t0), true);
  assert.equal(claimStreamStamp('a', t0 + 59 * 60 * 1000), false);
  assert.equal(claimStreamStamp('a', t0 + 60 * 60 * 1000), true);
  // ⚠️ Per ANCHOR, not global — one popular book must not silence the rest.
  assert.equal(claimStreamStamp('b', t0), true);
});

/* ── stampStream itself ─────────────────────────────────────────────────── */

test('a stamp PATCHes audio_streams/{anchor} with an updateMask, never a full replace', async () => {
  // Mutation that turns this red: dropping `fieldPaths`, which makes the PATCH
  // a whole-document replace and deletes any field phase 3 adds.
  const f = stubFetch();
  try {
    const outcome = await stampStream(envWith(), UP_ANCHOR, 1_772_000_000_000);
    assert.equal(outcome, 'written');
    assert.equal(f.captured.length, 1);
    const call = f.captured[0] as Captured;
    assert.equal(call.method, 'PATCH');
    assert.ok(call.url.includes(`/documents/audio_streams/${UP_ANCHOR}?`), call.url);
    assert.ok(call.url.includes('updateMask.fieldPaths=anchor'), call.url);
    assert.ok(call.url.includes('updateMask.fieldPaths=lastStreamAt'), call.url);
    assert.deepEqual(call.body, {
      fields: {
        anchor: { stringValue: UP_ANCHOR },
        lastStreamAt: { integerValue: '1772000000000' },
      },
    });
  } finally {
    f.restore();
  }
});

test('⚠️ NOTHING PERSONAL is written — the collection is world-readable by design', async () => {
  // firestore.rules gives audio_streams `allow read: if true` (the evictor
  // lists it with the PUBLIC web API key). The route this replaced wrote
  // `updatedBy: <caller email>` into it. Mutation that turns this red: putting
  // any identity field back.
  const f = stubFetch();
  try {
    assert.equal(await stampStream(envWith(), UP_ANCHOR, 1_772_000_000_000), 'written');
    assert.equal(f.captured.length, 1, 'nothing was written — this test would pass vacuously');
    const serialised = JSON.stringify((f.captured[0] as Captured).body);
    assert.equal(serialised.includes('@'), false, serialised);
    assert.equal(serialised.includes('updatedBy'), false, serialised);
    assert.equal(serialised.includes('email'), false, serialised);
  } finally {
    f.restore();
  }
});

test('the second stamp inside the hour is `throttled` and makes NO request', async () => {
  const f = stubFetch();
  try {
    const t0 = 1_772_000_000_000;
    assert.equal(await stampStream(envWith(), UP_ANCHOR, t0), 'written');
    assert.equal(await stampStream(envWith(), UP_ANCHOR, t0 + 60_000), 'throttled');
    assert.equal(f.captured.length, 1);
    assert.equal(await stampStream(envWith(), UP_ANCHOR, t0 + STREAM_STAMP_THROTTLE_MS), 'written');
    assert.equal(f.captured.length, 2);
  } finally {
    f.restore();
  }
});

test('⚠️ a Firestore FAILURE still burns the hour — one attempt an hour, not one per range', async () => {
  // Audit finding L9 on the deleted route: it recorded the throttle key only
  // on success, so a persistent Firestore failure re-did the whole
  // mint-and-write on EVERY request. Mutation that turns this red: moving the
  // `claimedAt.set` after the PATCH.
  const f = stubFetch({ firestoreStatus: 500 });
  try {
    const t0 = 1_772_000_000_000;
    assert.equal(await stampStream(envWith(), UP_ANCHOR, t0), 'failed');
    assert.equal(await stampStream(envWith(), UP_ANCHOR, t0 + 1000), 'throttled');
    assert.equal(f.captured.length, 1);
  } finally {
    f.restore();
  }
});

test('no service account → `unconfigured`, never a throw', async () => {
  const f = stubFetch();
  try {
    const outcome = await stampStream(envWith({ FIREBASE_SERVICE_ACCOUNT: undefined }), UP_ANCHOR);
    assert.equal(outcome, 'unconfigured');
    assert.equal(f.captured.length, 0);
  } finally {
    f.restore();
  }
});

test('a MALFORMED service account → `unconfigured`, and the secret VALUE never reaches the message', async () => {
  const f = stubFetch();
  try {
    const bad = JSON.stringify({ client_email: 'x@y', project_id: 'p' }); // no private_key
    assert.equal(await stampStream(envWith({ FIREBASE_SERVICE_ACCOUNT: bad }), UP_ANCHOR), 'unconfigured');
    assert.equal(f.captured.length, 0);
  } finally {
    f.restore();
  }
});

/* ── through the real byte route ────────────────────────────────────────── */

test('🔴 SERVING A BYTE STAMPS THE BOOK — the whole point, through the real app', async () => {
  // Mutation that turns this red: deleting the stampStreamInBackground call in
  // audio-file.ts. Without it `evict_candidates()` never learns anything and
  // R2 grows for ever.
  const f = stubFetch();
  const w = waitUntilCtx();
  try {
    const res = await app.request(
      `/api/audio/${UP_ANCHOR}/file`,
      { headers: { Range: 'bytes=0-9' } },
      envWith(),
      w.ctx as unknown as ExecutionContext,
    );
    assert.equal(res.status, 206);
    await w.settle();
    assert.equal(f.captured.length, 1);
    assert.ok((f.captured[0] as Captured).url.includes('audio_streams/' + UP_ANCHOR));
  } finally {
    f.restore();
  }
});

test('the player\'s mandatory HEAD probe stamps too — a listen BEGINS with a HEAD', async () => {
  // Design §3.2 item 5 makes the HEAD probe mandatory, so it is the first
  // thing a real listen does. Stamping eagerly only DELAYS an eviction;
  // missing one deletes a book somebody is halfway through.
  const f = stubFetch();
  const w = waitUntilCtx();
  try {
    const res = await app.request(
      `/api/audio/${UP_ANCHOR}/file`,
      { method: 'HEAD' },
      envWith(),
      w.ctx as unknown as ExecutionContext,
    );
    assert.equal(res.status, 200);
    await w.settle();
    assert.equal(f.captured.length, 1);
  } finally {
    f.restore();
  }
});

test('⚠️ A REFUSED CALLER STAMPS NOTHING — the stamp sits behind the gate', async () => {
  // Mutation that turns this red: moving the stamp above `resolveEbookAccess`.
  // A stamp is what keeps a file alive, so an unauthenticated caller able to
  // set one could pin the household's bucket at full size for ever.
  const f = stubFetch();
  const w = waitUntilCtx();
  try {
    const res = await app.request(
      `/api/audio/${UP_ANCHOR}/file`,
      {},
      envWith({ ENVIRONMENT: 'production' }),
      w.ctx as unknown as ExecutionContext,
    );
    assert.equal(res.status, 401);
    await w.settle();
    assert.equal(f.captured.length, 0);
  } finally {
    f.restore();
  }
});

test('🔴 AN UNKNOWN ANCHOR NEVER REACHES FIRESTORE — F3, kept alive past the ping route', async () => {
  // Audit finding F3 lived on the deleted stream-ping route: a client-supplied
  // anchor interpolated into a document path lets an admitted caller choose
  // which document a RULES-BYPASSING service account writes (`..%2Fsite_roles%2F<uid>%23`
  // escapes the collection and drops the update mask). The byte route's
  // manifest LOOKUP is what closes it, and the stamp sits downstream of that
  // lookup — this test is what keeps the two in that order.
  const f = stubFetch();
  const w = waitUntilCtx();
  try {
    const res = await app.request(
      '/api/audio/..%2Fsite_roles%2Fvictim%23/file',
      {},
      envWith(),
      w.ctx as unknown as ExecutionContext,
    );
    assert.equal(res.status, 404);
    await w.settle();
    assert.equal(f.captured.length, 0);
  } finally {
    f.restore();
  }
});

test('a stamp failure NEVER breaks playback — the bytes still arrive', async () => {
  // The asymmetry that decides this: a growing bucket costs money, a broken
  // player costs the feature.
  const f = stubFetch({ firestoreStatus: 503 });
  const w = waitUntilCtx();
  try {
    const res = await app.request(
      `/api/audio/${UP_ANCHOR}/file`,
      { headers: { Range: 'bytes=0-4' } },
      envWith(),
      w.ctx as unknown as ExecutionContext,
    );
    assert.equal(res.status, 206);
    assert.equal(await res.text(), FILE_BODY.slice(0, 5));
    await w.settle();
  } finally {
    f.restore();
  }
});

test('the byte route works with NO ExecutionContext at all — waitUntil is read defensively', async () => {
  // ⚠️ Hono THROWS on `c.executionCtx` when the app was invoked without one,
  // which is exactly how every other test in this suite calls it. A bare read
  // would turn every audio request in those tests into a 500.
  const f = stubFetch();
  try {
    const res = await app.request(`/api/audio/${UP_ANCHOR}/file`, { headers: { Range: 'bytes=0-1' } }, envWith());
    assert.equal(res.status, 206);
  } finally {
    f.restore();
  }
});

/* ── the route that is deliberately GONE ────────────────────────────────── */

test('🔴 POST /api/audio/:anchor/stream-ping IS GONE, and its absence is the design', async () => {
  // §10.1 puts the stamp on the byte route "never a client-driven ping, which
  // is both spoofable and one request per listener". audiobook_catalog's
  // tests/test_listen_page.py asserts no site JS mentions it, so it had no
  // caller. Mutation that turns this red: re-mounting streamPingRoutes.
  const f = stubFetch();
  try {
    const res = await app.request(
      `/api/audio/${UP_ANCHOR}/stream-ping`,
      { method: 'POST' },
      envWith(),
    );
    assert.equal(res.status, 404);
  } finally {
    f.restore();
  }
});
