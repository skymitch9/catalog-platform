/**
 * `GET /api/download/:anchor` — the attachment route (Phase 4b, 2026-09-06).
 *
 * Exercised through the REAL exported Hono app, with the estate directory, the
 * OAuth token exchange and the Firestore role read all stubbed at
 * `globalThis.fetch`, and fake R2 buckets — the ebook-file.test.ts idiom
 * crossed with enforce-routes.test.ts's real-key-pair service account.
 *
 * ⚠️ Stated plainly, because a green suite is not a live verification: these
 * prove the DECISIONS and the header contract. They do NOT prove that the
 * Worker can reach a real directory, that a real R2 object streams through
 * Cloudflare unbuffered, or that a browser saves the file with the name we
 * sent. Those are on the NOT-VERIFIED list until a signed-in download happens
 * against the deployed Worker.
 *
 * Every test is behaviour-failing: the named mutation in each comment turns
 * that test red.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { attachmentDisposition } from '../src/ebook-download.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetManifestIndex } from '../src/ebook-manifest.js';
import { resetReadBudget, DISTINCT_BOOKS_PER_WINDOW } from '../src/read-budget.js';
import { resetRoleCache } from '../src/roles.js';
import type { Env } from '../src/env.js';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const PDF_ANCHOR = 'b-bbbb';
const EPUB_ANCHOR = 'b-aaaa';
/** The book whose file is knowingly NOT in the bucket — the 300 MiB wall. */
const OMNIBUS_ANCHOR = 'b-cccc';
/** A row whose filename is non-ASCII, so both `filename` forms are exercised. */
const ACCENT_ANCHOR = 'b-dddd';

const MANIFEST = {
  generated_at: '2026-09-06T02:00:00Z',
  count: 4,
  ebooks: [
    { path: 'A/one.epub', anchor: EPUB_ANCHOR, title: 'One', format: 'epub', size_bytes: 40 },
    { path: 'B/two.pdf', anchor: PDF_ANCHOR, title: 'Two', format: 'pdf', size_bytes: 40 },
    {
      path: 'Brandon Sanderson/White Sand Omnibus.epub',
      anchor: OMNIBUS_ANCHOR,
      title: 'White Sand Omnibus',
      format: 'epub',
      size_bytes: 412_436_591,
    },
    {
      // `Brené Brown` is in the real corpus — measured at ingest.
      path: 'Brené Brown/Atlas of the Heart.epub',
      anchor: ACCENT_ANCHOR,
      title: 'Atlas of the Heart',
      format: 'epub',
      size_bytes: 40,
    },
  ],
};

const FILE_BODY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
const FILES: Record<string, string> = {
  'A/one.epub': FILE_BODY,
  'B/two.pdf': FILE_BODY,
  'Brené Brown/Atlas of the Heart.epub': FILE_BODY,
};

function fakeGatedBucket(body: unknown | null) {
  return {
    async get(key: string) {
      if (key !== 'ebooks.json' || body === null) return null;
      return { async json() { return body; } };
    },
  } as unknown as R2Bucket;
}

/** The FILES bucket. Records every key it was asked for. */
function fakeFileBucket(present: Record<string, string>, log: string[] = []) {
  const enc = new TextEncoder();
  const meta = (key: string) => ({
    contentType: key.endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip',
  });
  return {
    async head(key: string) {
      log.push('head ' + key);
      const v = present[key];
      if (v === undefined) return null;
      return { size: v.length, httpEtag: '"etag-' + key.length + '"', httpMetadata: meta(key) };
    },
    async get(key: string) {
      log.push('get ' + key);
      const v = present[key];
      if (v === undefined) return null;
      return {
        size: v.length,
        httpEtag: '"etag-' + key.length + '"',
        httpMetadata: meta(key),
        body: new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(enc.encode(v));
            ctrl.close();
          },
        }),
      };
    },
  } as unknown as R2Bucket;
}

/* ── the service account (enforce-routes.test.ts idiom: a REAL key pair, so
      mintAccessToken's WebCrypto import parses before fetch is stubbed) ──── */

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

interface Script {
  /** The estate's /seen answer, or 'error' for a 500. */
  seen: { status: string; visibility?: unknown } | 'error';
  /** The stored site_roles role string; null = no doc (guest); 'boom' = a 500. */
  storedRole?: string | null | 'boom';
}

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
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
  return { calls, restore: () => void (globalThis.fetch = original) };
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
    SITE_ORIGINS: 'https://audiobooks.heygabi.ai,https://ebooks.heygabi.ai',
    EBOOKS_GATED: fakeGatedBucket(MANIFEST),
    EBOOKS: fakeFileBucket(FILES),
    ...over,
  };
}

const GRANTED: Script = { seen: { status: 'approved', visibility: ['audiobook', 'ebooks'] } };
const ADMIN: Script = { ...GRANTED, storedRole: 'admin' };

function url(anchor: string) {
  return `/api/download/${anchor}`;
}

async function download(env: Env, anchor: string, script: Script = ADMIN) {
  const stub = stubFetch(script);
  try {
    const res = await app.fetch(new Request('https://audiobook-api.heygabi.ai' + url(anchor)), env);
    return { res, stub };
  } finally {
    stub.restore();
  }
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  resetEstateCache();
  resetManifestIndex();
  resetReadBudget();
  resetRoleCache();
});

/* ── gate 1: the estate's `vis_ebooks` READ grant, and it runs FIRST ────── */

test('signed out → 401, worded, and the bytes bucket is never touched', async () => {
  // Mutation that reddens: dropping resolveEbookAccess, or running the ladder
  // check first — an anonymous caller would then hear about ADMIN roles.
  const log: string[] = [];
  const env = envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined, EBOOKS: fakeFileBucket(FILES, log) });
  const { res } = await download(env, PDF_ANCHOR);
  assert.equal(res.status, 401);
  const body = await json(res);
  assert.equal(body.error, 'unauthenticated');
  assert.match(String(body.detail), /sign in/i);
  assert.equal(log.length, 0, 'a signed-out caller must not be able to probe the bucket');
});

test('⚠️ AN ADMIN WITHOUT THE SHELF GRANT hears about the SHELF, not about roles', async () => {
  // The order of the two gates IS the product. Mutation that reddens: moving
  // the ladder check above resolveEbookAccess — this caller would then be told
  // they may download, and only later that they cannot see the shelf.
  const { res } = await download(envWith(), PDF_ANCHOR, {
    seen: { status: 'approved', visibility: ['audiobook'] },
    storedRole: 'admin',
  });
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal(body.error, 'no_ebooks_grant');
  assert.match(String(body.detail), /Ebooks/);
  assert.doesNotMatch(String(body.detail), /admin/i, 'never send a shelf problem to a role conversation');
});

test('revoked → the estate sentence, not a download refusal', async () => {
  const { res } = await download(envWith(), PDF_ANCHOR, {
    seen: { status: 'revoked' },
    storedRole: 'admin',
  });
  assert.equal(res.status, 403);
  assert.equal((await json(res)).error, 'access_revoked');
});

/* ── gate 2: the ladder's `download`, floor admin ───────────────────────── */

test('🔴 a granted MEMBER is refused — worded, naming the role it needs', async () => {
  // The whole point of the route. Mutation that reddens: removing the
  // can(role,'download') check, or lowering the floor in capabilities.ts.
  const log: string[] = [];
  const { res } = await download(envWith({ EBOOKS: fakeFileBucket(FILES, log) }), PDF_ANCHOR, {
    ...GRANTED,
    storedRole: 'member',
  });
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal(body.error, 'no_download_capability');
  assert.equal(body.needs_role, 'admin');
  assert.equal(body.your_role, 'member');
  // §1e: what happened, what it needs, how to get it — and what they CAN do,
  // because this refusal is only ever read by somebody who holds the shelf.
  assert.match(String(body.detail), /admin/i);
  assert.match(String(body.detail), /Mitch/);
  assert.match(String(body.detail), /read it in the browser/i);
  assert.equal(log.length, 0, 'a refused caller must not reach the file bucket');
});

test('a rankless guest with the shelf grant is refused the file, and told their role', async () => {
  const { res } = await download(envWith(), PDF_ANCHOR, { ...GRANTED, storedRole: null });
  assert.equal(res.status, 403);
  const body = await json(res);
  assert.equal(body.error, 'no_download_capability');
  assert.equal(body.your_role, 'guest');
});

test('a MODERATOR is refused too — the floor is admin, not "some rank"', async () => {
  const { res } = await download(envWith(), PDF_ANCHOR, { ...GRANTED, storedRole: 'moderator' });
  assert.equal(res.status, 403);
  assert.equal((await json(res)).your_role, 'moderator');
});

test('⚠️ AN UNRESOLVABLE RUNG IS AN OUTAGE (502), NEVER A PERMISSION REFUSAL', async () => {
  // The estate's rule: a network/server failure is not a permission failure.
  // Mutation that reddens: collapsing role===null into the 403 arm — the
  // caller would be sent asking for a promotion they may already hold.
  const { res } = await download(envWith(), PDF_ANCHOR, { ...GRANTED, storedRole: 'boom' });
  assert.equal(res.status, 502);
  const body = await json(res);
  assert.equal(body.error, 'role_unresolved');
  assert.match(String(body.detail), /outage/i);
  assert.doesNotMatch(String(body.detail), /\b403\b|\b502\b/, 'never a bare status in the sentence');
});

/* ── the happy path ─────────────────────────────────────────────────────── */

test('🔴 an ADMIN gets the bytes, as an ATTACHMENT, correctly typed', async () => {
  const { res } = await download(envWith(), PDF_ANCHOR, ADMIN);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.equal(res.headers.get('Content-Length'), String(FILE_BODY.length));
  const cd = res.headers.get('Content-Disposition') ?? '';
  // ⚠️ The one header that makes this route different from the viewer's.
  assert.match(cd, /^attachment;/);
  assert.doesNotMatch(cd, /inline/);
  assert.match(cd, /filename="two\.pdf"/);
  assert.equal(await res.text(), FILE_BODY);
});

test('the OWNER gets the bytes with no role round-trip at all', async () => {
  // OWNER_EMAILS is the break-glass: a role store outage must not stop the
  // owner downloading his own books.
  const { res, stub } = await download(envWith({ DEV_EMAIL: 'owner@example.com' }), EPUB_ANCHOR, {
    seen: 'error',
    storedRole: 'boom',
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/epub+zip');
  assert.ok(!stub.calls.some((c) => c.includes('/site_roles/')), 'the owner short-circuits');
  assert.ok(!stub.calls.some((c) => c.includes('/api/estate/seen')), 'and skips the directory too');
});

test('a non-ASCII filename ships BOTH forms, the plain one sanitised', async () => {
  const { res } = await download(envWith(), ACCENT_ANCHOR, ADMIN);
  assert.equal(res.status, 200);
  const cd = res.headers.get('Content-Disposition') ?? '';
  assert.match(cd, /filename="Atlas of the Heart\.epub"/);
  assert.match(cd, /filename\*=UTF-8''/);
  // ⚠️ A raw non-ASCII byte in a header is a malformed response some clients
  // drop entirely — here that means the download fails, not that a page looks odd.
  for (const ch of cd) assert.ok(ch.charCodeAt(0) < 128, `non-ASCII byte in header: ${ch}`);
});

test('attachmentDisposition escapes quotes and backslashes, and never says inline', () => {
  const d = attachmentDisposition('Author/He said "hi"\\there.epub');
  assert.match(d, /^attachment; filename="He said _hi__there\.epub"/);
  assert.match(d, /filename\*=UTF-8''/);
});

/* ── the named 404s — a fact about the LINK or the FILE, never about the caller ── */

test('an unknown anchor is a NAMED 404, never a 403', async () => {
  // §1e point 5: this caller has cleared both gates, so a permission-shaped
  // refusal would send an admin asking for access they demonstrably hold.
  const { res } = await download(envWith(), 'b-nope', ADMIN);
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal(body.error, 'unknown_book');
  assert.match(String(body.detail), /open it from the shelf/i);
});

test('🔴 a book on the shelf whose FILE is missing gets its own sentence', async () => {
  // The 300 MiB wall, still real. Never a 403 ("you are not allowed" — they
  // are) and never a 500 ("it is broken" — it is a known, nameable gap).
  const { res } = await download(envWith(), OMNIBUS_ANCHOR, ADMIN);
  assert.equal(res.status, 404);
  const body = await json(res);
  assert.equal(body.error, 'file_absent');
  assert.match(String(body.detail), /not been uploaded/i);
  assert.match(String(body.detail), /not a permission problem/i);
});

/* ── configuration refusals — named, with the fix ───────────────────────── */

test('no EBOOKS_GATED binding → 503 naming the binding and the fix', async () => {
  const { res } = await download(envWith({ EBOOKS_GATED: undefined }), PDF_ANCHOR, ADMIN);
  assert.equal(res.status, 503);
  const body = await json(res);
  assert.equal(body.error, 'manifest_store_unbound');
  assert.match(String(body.fix), /EBOOKS_GATED/);
});

test('no manifest published → 503 manifest_absent, with the publish command', async () => {
  const { res } = await download(envWith({ EBOOKS_GATED: fakeGatedBucket(null) }), PDF_ANCHOR, ADMIN);
  assert.equal(res.status, 503);
  const body = await json(res);
  assert.equal(body.error, 'manifest_absent');
  assert.match(String(body.fix), /publish_ebooks_manifest\.py/);
});

test('no EBOOKS binding → 503 file_store_unbound, a DIFFERENT sentence', async () => {
  const { res } = await download(envWith({ EBOOKS: undefined }), PDF_ANCHOR, ADMIN);
  assert.equal(res.status, 503);
  const body = await json(res);
  assert.equal(body.error, 'file_store_unbound');
  assert.match(String(body.fix), /EBOOKS binding/);
});

/* ── the cache posture — law 2, and it matters most here ────────────────── */

test('🔴 EVERY answer is no-store and Varies on Authorization — bytes AND refusals', async () => {
  // An authenticated response left cacheable IS a public download endpoint,
  // and what would be cached here is a whole DRM-stripped file.
  const cases: Array<[string, Script]> = [
    [PDF_ANCHOR, ADMIN],
    [PDF_ANCHOR, { ...GRANTED, storedRole: 'member' }],
    [PDF_ANCHOR, { ...GRANTED, storedRole: 'boom' }],
    ['b-nope', ADMIN],
    [OMNIBUS_ANCHOR, ADMIN],
  ];
  for (const [anchor, script] of cases) {
    resetEstateCache();
    resetRoleCache();
    const { res } = await download(envWith(), anchor, script);
    assert.equal(res.headers.get('Cache-Control'), 'private, max-age=0, no-store', anchor);
    // ⚠️ `Origin` is appended by the CORS middleware; asserting equality here
    // would pin a header this route does not own and break on a CORS change.
    // What matters is that `Authorization` is IN the list.
    assert.match(res.headers.get('Vary') ?? '', /\bAuthorization\b/, anchor);
    await res.arrayBuffer();
  }
});

test('the SHARED gate’s refusal is dressed with this route’s cache headers', async () => {
  // Measured on the viewer's route 2026-08-17: ebook-gate.ts writes plain JSON
  // for the shelf, which needs neither header. Mutation that reddens: dropping dress().
  const env = envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined });
  const { res } = await download(env, PDF_ANCHOR);
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Cache-Control'), 'private, max-age=0, no-store');
  assert.match(res.headers.get('Vary') ?? '', /\bAuthorization\b/);
});

test('⚠️ range support is NOT advertised, because it is not honoured', async () => {
  // Claiming `Accept-Ranges: bytes` we do not serve is worse than not having
  // it: clients decide how to fetch from that header. The consequence — a
  // dropped download restarts — is documented in the module header.
  const { res } = await download(envWith(), PDF_ANCHOR, ADMIN);
  assert.equal(res.headers.get('Accept-Ranges'), null);
  await res.arrayBuffer();
});

/* ── what this route must NOT have changed ──────────────────────────────── */

test('🔴 THE VIEWER STILL SERVES MEMBERS, and still says inline', async () => {
  // The inversion viewer design §6.x exists to stop: gating reading on
  // `download` would show every member a shelf none of them could read.
  const stub = stubFetch({ ...GRANTED, storedRole: 'member' });
  try {
    const res = await app.fetch(
      new Request('https://audiobook-api.heygabi.ai/api/ebook/' + PDF_ANCHOR + '/file'),
      envWith(),
    );
    assert.equal(res.status, 200, 'a granted member with no rung must still get bytes');
    assert.match(res.headers.get('Content-Disposition') ?? '', /^inline;/);
    assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
    await res.arrayBuffer();
  } finally {
    stub.restore();
  }
});

test('⚠️ a download does NOT spend the reader’s book budget', async () => {
  // read-budget.ts is sized against a granted member scripting the corpus;
  // this route floors at admin. Charging it here would let one download eat
  // the same person's page turns — the cross-contamination listen-budget.ts
  // was split out to prevent. Mutation that reddens: adding chargeRead().
  const env = envWith();
  for (let i = 0; i < DISTINCT_BOOKS_PER_WINDOW + 4; i += 1) {
    resetEstateCache();
    resetRoleCache();
    const { res } = await download(env, i % 2 === 0 ? PDF_ANCHOR : EPUB_ANCHOR, ADMIN);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
  }
  const stub = stubFetch({ ...GRANTED, storedRole: 'member' });
  try {
    const res = await app.fetch(
      new Request('https://audiobook-api.heygabi.ai/api/ebook/' + EPUB_ANCHOR + '/file'),
      env,
    );
    assert.equal(res.status, 200, 'the viewer must be unaffected by downloads');
    await res.arrayBuffer();
  } finally {
    stub.restore();
  }
});
