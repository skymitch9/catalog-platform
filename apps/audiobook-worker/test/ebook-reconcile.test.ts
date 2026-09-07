/**
 * `GET /api/ebooks/reconcile` — the bucket ⇄ manifest reconciler (2026-09-06).
 *
 * Two halves, deliberately: the pure `reconcile()` comparison is exercised
 * directly (every rule, no bucket, no gate), and the route is exercised
 * through the REAL exported Hono app with fake buckets and a stubbed
 * directory. The fake FILE bucket's `put`/`delete` THROW, so "report-only" is
 * a property the suite would notice being broken rather than a claim in a
 * comment.
 *
 * ⚠️ NOT proven here: that a real `estate-ebooks` listing paginates the way
 * the fake does, or that the report's numbers match the real bucket. Those
 * need the deployed Worker and a signed-in admin.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import {
  listAllObjects,
  reconcile,
  MAX_LIST_PAGES,
  MAX_ROWS,
  RECONCILE_FLOOR,
  type ListResult,
} from '../src/ebook-reconcile.js';
import { buildIndex, type EbookEntry } from '../src/ebook-manifest.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetManifestIndex } from '../src/ebook-manifest.js';
import { resetRoleCache } from '../src/roles.js';
import type { Env } from '../src/env.js';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const MANIFEST = {
  generated_at: '2026-09-06T02:00:00Z',
  count: 3,
  ebooks: [
    { path: 'A/one.epub', anchor: 'b-aaaa', title: 'One', format: 'epub', size_bytes: 10 },
    { path: 'B/two.pdf', anchor: 'b-bbbb', title: 'Two', format: 'pdf', size_bytes: 20 },
    {
      path: 'Brandon Sanderson/White Sand Omnibus.epub',
      anchor: 'b-cccc',
      title: 'White Sand Omnibus',
      format: 'epub',
      size_bytes: 412_436_591,
    },
  ],
};

/** The bucket: `two.pdf` is the WRONG size, the omnibus is absent, and there
 *  is one orphan nothing lists. */
const BUCKET: Record<string, number> = {
  'A/one.epub': 10,
  'B/two.pdf': 19,
  'C/orphan.epub': 999,
};

function fakeGatedBucket(body: unknown | null) {
  return {
    async get(key: string) {
      if (key !== 'ebooks.json' || body === null) return null;
      return { async json() { return body; } };
    },
  } as unknown as R2Bucket;
}

/**
 * The FILE bucket. ⚠️ `put` and `delete` throw: report-only is enforced by the
 * fixture, not by a promise in a comment.
 */
function fakeFileBucket(sizes: Record<string, number>, opts: { pageSize?: number; fail?: boolean } = {}) {
  const pageSize = opts.pageSize ?? 1000;
  const keys = Object.keys(sizes);
  return {
    async list(o?: { limit?: number; cursor?: string }) {
      if (opts.fail) throw new Error('r2 is down');
      const start = o?.cursor ? Number(o.cursor) : 0;
      const take = Math.min(pageSize, o?.limit ?? pageSize);
      const slice = keys.slice(start, start + take);
      const end = start + slice.length;
      return {
        objects: slice.map((k) => ({
          key: k,
          size: sizes[k] as number,
          uploaded: new Date('2026-09-01T00:00:00Z'),
        })),
        truncated: end < keys.length,
        cursor: String(end),
      };
    },
    async put() {
      throw new Error('🔴 the reconciler must never write to the bucket');
    },
    async delete() {
      throw new Error('🔴 the reconciler must never delete from the bucket');
    },
  } as unknown as R2Bucket;
}

interface Script {
  seen: { status: string; visibility?: unknown } | 'error';
  storedRole?: string | null | 'boom';
}

const keyPair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const pkcs8 = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
const PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(new Uint8Array(pkcs8)).toString('base64')}\n-----END PRIVATE KEY-----\n`;
const SA_JSON = JSON.stringify({
  client_email: 'estate@audiobook-catalog.iam.gserviceaccount.com',
  private_key: PEM,
  project_id: 'audiobook-catalog',
});

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/estate/seen')) {
      if (script.seen === 'error') return new Response('boom', { status: 500 });
      return Response.json(script.seen);
    }
    if (url.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'stub-access-token', expires_in: 3600 });
    }
    if (url.includes('/site_roles/')) {
      const role = script.storedRole;
      if (role === 'boom') return new Response('nope', { status: 500 });
      if (role === undefined || role === null) return new Response('{}', { status: 404 });
      return Response.json({ fields: { role: { stringValue: role } } });
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
    FIREBASE_SERVICE_ACCOUNT: SA_JSON,
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'shadow',
    SITE_ORIGINS: 'https://audiobooks.heygabi.ai',
    EBOOKS_GATED: fakeGatedBucket(MANIFEST),
    EBOOKS: fakeFileBucket(BUCKET),
    ...over,
  };
}

const GRANTED: Script = { seen: { status: 'approved', visibility: ['audiobook', 'ebooks'] } };
const ADMIN: Script = { ...GRANTED, storedRole: 'admin' };

async function get(env: Env, script: Script = ADMIN) {
  const stub = stubFetch(script);
  try {
    const res = await app.fetch(
      new Request('https://audiobook-api.heygabi.ai/api/ebooks/reconcile'),
      env,
    );
    const body = (await res.json()) as Record<string, never>;
    return { res, body: body as Record<string, unknown> };
  } finally {
    stub.restore();
  }
}

function indexOf(manifest: unknown): Map<string, EbookEntry> {
  const idx = buildIndex(manifest);
  assert.ok(idx);
  return idx;
}

function listingOf(sizes: Record<string, number>, complete = true): ListResult {
  return {
    objects: new Map(
      Object.entries(sizes).map(([k, size]) => [k, { key: k, size, uploaded: '2026-09-01T00:00:00Z' }]),
    ),
    complete,
    pages: 1,
  };
}

beforeEach(() => {
  resetEstateCache();
  resetManifestIndex();
  resetRoleCache();
});

/* ── the pure comparison ────────────────────────────────────────────────── */

test('🔴 the three findings, each in its own list', async () => {
  const r = reconcile(indexOf(MANIFEST), listingOf(BUCKET), '2026-09-06T00:00:00Z');
  assert.deepEqual(r.counts, {
    missing_from_bucket: 1,
    unlisted_in_manifest: 1,
    size_mismatches: 1,
  });
  assert.equal(r.missing_from_bucket[0]?.anchor, 'b-cccc');
  assert.equal(r.missing_from_bucket[0]?.title, 'White Sand Omnibus');
  assert.equal(r.unlisted_in_manifest[0]?.key, 'C/orphan.epub');
  assert.deepEqual(
    { ...r.size_mismatches[0] },
    {
      anchor: 'b-bbbb',
      path: 'B/two.pdf',
      manifest_size_bytes: 20,
      bucket_size_bytes: 19,
      delta_bytes: -1,
    },
  );
});

test('a clean shelf reports three zeroes, not an empty body', async () => {
  // A reconciler that says nothing when all is well is indistinguishable from
  // one that failed. Zero is a RESULT and is stated.
  const clean = { 'A/one.epub': 10, 'B/two.pdf': 20, 'Brandon Sanderson/White Sand Omnibus.epub': 412_436_591 };
  const r = reconcile(indexOf(MANIFEST), listingOf(clean), '2026-09-06T00:00:00Z');
  assert.deepEqual(r.counts, { missing_from_bucket: 0, unlisted_in_manifest: 0, size_mismatches: 0 });
  assert.equal(r.complete, true);
});

test('⚠️ a null size_bytes is NOT a mismatch — it is an unmeasured row', async () => {
  // Mutation that reddens: comparing without the null guard. Every row the
  // pipeline could not measure would report as corrupt.
  const m = {
    ebooks: [{ path: 'A/one.epub', anchor: 'b-aaaa', title: 'One', format: 'epub' }],
  };
  const r = reconcile(indexOf(m), listingOf({ 'A/one.epub': 10 }), 'now');
  assert.equal(r.counts.size_mismatches, 0);
  assert.equal(r.missing_from_bucket.length, 0);
});

test('🔴 A TRUNCATED LISTING REPORTS INCOMPLETE, AND NAMES NO "MISSING" FILE', async () => {
  // The whole point of the `complete` flag. On a truncated listing an object
  // can exist and simply not have been listed, so "missing from the bucket"
  // would be false positives sending somebody to re-upload files that are
  // already there. The OTHER direction is still safe — everything reported as
  // unlisted was actually seen.
  const r = reconcile(indexOf(MANIFEST), listingOf(BUCKET, false), 'now');
  assert.equal(r.complete, false);
  assert.equal(r.counts.missing_from_bucket, 0, 'no inference from absence on a partial listing');
  assert.equal(r.counts.unlisted_in_manifest, 1, 'but what WAS seen is still reported');
  assert.equal(r.counts.size_mismatches, 1, 'and sizes of seen objects still compare');
  assert.ok(r.caveats.some((c) => /did not finish/i.test(c)), 'and it says so in words');
});

test('the caveats always name what CANNOT be checked', async () => {
  // The absence of an integrity check must be visible in the answer, not
  // merely unmentioned. `checksum_mismatches: null` is the same statement in
  // the payload's shape.
  const r = reconcile(indexOf(MANIFEST), listingOf(BUCKET), 'now');
  assert.equal(r.checksum_mismatches, null);
  assert.ok(r.caveats.some((c) => /checksum/i.test(c) && /digest/i.test(c)));
  assert.ok(r.caveats.some((c) => /stale/i.test(c)), 'the manifest index TTL is disclosed');
});

test('finding lists are capped, and the cap is disclosed rather than silent', async () => {
  const many: Record<string, number> = {};
  for (let i = 0; i < MAX_ROWS + 25; i += 1) many[`orphans/${i}.epub`] = i + 1;
  const r = reconcile(indexOf({ ebooks: [] }), listingOf(many), 'now');
  assert.equal(r.unlisted_in_manifest.length, MAX_ROWS);
  assert.ok(r.caveats.some((c) => c.includes('cap')), 'a cut list must say it was cut');
});

/* ── the listing walk ───────────────────────────────────────────────────── */

test('the listing PAGINATES and reports how many pages it walked', async () => {
  const sizes: Record<string, number> = {};
  for (let i = 0; i < 7; i += 1) sizes[`k${i}`] = i;
  const out = await listAllObjects(fakeFileBucket(sizes, { pageSize: 2 }));
  assert.equal(out.objects.size, 7);
  assert.equal(out.complete, true);
  assert.equal(out.pages, 4, '2+2+2+1');
});

test('⚠️ the page walk is BOUNDED — an endless bucket ends the loop, not the bill', async () => {
  const sizes: Record<string, number> = {};
  for (let i = 0; i < MAX_LIST_PAGES * 2 + 5; i += 1) sizes[`k${i}`] = i;
  const out = await listAllObjects(fakeFileBucket(sizes, { pageSize: 1 }));
  assert.equal(out.complete, false);
  assert.equal(out.pages, MAX_LIST_PAGES);
});

/* ── the route: the gate ────────────────────────────────────────────────── */

test('signed out → the estate’s 401, no bucket touched', async () => {
  const { res, body } = await get(envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined }));
  assert.equal(res.status, 401);
  assert.equal(body.error, 'unauthenticated');
});

test('an ADMIN without the shelf grant hears about the SHELF, not about rank', async () => {
  const { res, body } = await get(envWith(), {
    seen: { status: 'approved', visibility: ['audiobook'] },
    storedRole: 'admin',
  });
  assert.equal(res.status, 403);
  assert.equal(body.error, 'no_ebooks_grant');
});

test('🔴 a MODERATOR is refused — this report names every file on the shelf', async () => {
  const { res, body } = await get(envWith(), { ...GRANTED, storedRole: 'moderator' });
  assert.equal(res.status, 403);
  assert.equal(body.error, 'not_admin');
  assert.equal(body.needs_role, RECONCILE_FLOOR);
  assert.equal(body.your_role, 'moderator');
  assert.match(String(body.detail), /admin-only/i);
  assert.match(String(body.detail), /Nothing is wrong with your account/);
});

test('an unresolvable rung is a worded 502, never a 403', async () => {
  const { res, body } = await get(envWith(), { ...GRANTED, storedRole: 'boom' });
  assert.equal(res.status, 502);
  assert.equal(body.error, 'role_unresolved');
  assert.match(String(body.detail), /outage/i);
});

/* ── the route: the report ──────────────────────────────────────────────── */

test('🔴 an admin gets the whole report, and it says it wrote nothing', async () => {
  const { res, body } = await get(envWith(), ADMIN);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(body.writes_performed, 0);
  assert.deepEqual(body.counts, {
    missing_from_bucket: 1,
    unlisted_in_manifest: 1,
    size_mismatches: 1,
  });
  assert.equal((body.manifest as Record<string, unknown>).entries, 3);
  assert.equal((body.bucket as Record<string, unknown>).objects, 3);
  assert.ok(typeof body.checked_at === 'string' && (body.checked_at as string).endsWith('Z'));
});

test('the OWNER gets it through the break-glass, with no directory round-trip', async () => {
  const { res, body } = await get(envWith({ DEV_EMAIL: 'owner@example.com' }), {
    seen: 'error',
    storedRole: 'boom',
  });
  assert.equal(res.status, 200);
  assert.equal(body.writes_performed, 0);
});

test('🔴 A LISTING FAILURE IS AN OUTAGE, NEVER "EVERY BOOK IS MISSING"', async () => {
  // Mutation that reddens: catching the list error into an empty listing. The
  // report would then name every book on the shelf as absent — an alarm that
  // is entirely false and costs somebody an afternoon.
  const { res, body } = await get(envWith({ EBOOKS: fakeFileBucket(BUCKET, { fail: true }) }), ADMIN);
  assert.equal(res.status, 502);
  assert.equal(body.error, 'listing_failed');
  assert.match(String(body.detail), /nothing is known to be missing/i);
});

test('no manifest published → 503 with the publish command, not an empty report', async () => {
  const { res, body } = await get(envWith({ EBOOKS_GATED: fakeGatedBucket(null) }), ADMIN);
  assert.equal(res.status, 503);
  assert.equal(body.error, 'manifest_absent');
  assert.match(String(body.fix), /publish_ebooks_manifest\.py/);
});

test('an unbound binding is named on either side, with its own fix', async () => {
  const a = await get(envWith({ EBOOKS_GATED: undefined }), ADMIN);
  assert.equal(a.body.error, 'manifest_store_unbound');
  resetEstateCache();
  resetRoleCache();
  const b = await get(envWith({ EBOOKS: undefined }), ADMIN);
  assert.equal(b.body.error, 'file_store_unbound');
  assert.match(String(b.body.fix), /EBOOKS binding/);
});
