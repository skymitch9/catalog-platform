/**
 * GET|HEAD /api/ebook/:anchor/file — the viewer's gated byte stream
 * (viewer phase 1a, 2026-08-17).
 *
 * Exercised through the REAL exported Hono app, with the estate directory
 * stubbed at `globalThis.fetch` and fake R2 buckets — the ebooks.test.ts
 * idiom. ⚠️ Stated plainly: these prove the DECISIONS and the header contract,
 * not that the Worker can reach a real directory, a real bucket, or that a
 * 393 MiB object streams through Cloudflare without buffering. That last one
 * is architecturally guaranteed here (nothing in the handler awaits a body)
 * and is on the NOT-VERIFIED list until a signed-in read happens live.
 *
 * Every test is behaviour-failing: the named mutation in each comment turns
 * that test red.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetManifestIndex } from '../src/ebook-manifest.js';
import { resetReadBudget, DISTINCT_BOOKS_PER_WINDOW } from '../src/read-budget.js';
import type { Env } from '../src/env.js';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const PDF_ANCHOR = 'b-bbbb';
const EPUB_ANCHOR = 'b-aaaa';
/** The one book whose file is knowingly NOT in the bucket (the 300 MiB wall). */
const OMNIBUS_ANCHOR = 'b-cccc';

const MANIFEST = {
  generated_at: '2026-08-17T02:00:00Z',
  count: 3,
  ebooks: [
    { path: 'A/one.epub', anchor: EPUB_ANCHOR, title: 'One', format: 'epub', size_bytes: 40 },
    { path: 'B/two.pdf', anchor: PDF_ANCHOR, title: 'Two', format: 'pdf', size_bytes: 40 },
    {
      // Not in the file bucket below — the White Sand Omnibus's stand-in.
      path: 'Brandon Sanderson/White Sand Omnibus.epub',
      anchor: OMNIBUS_ANCHOR,
      title: 'White Sand Omnibus',
      format: 'epub',
      size_bytes: 412_436_591,
    },
  ],
};

/** 40 bytes of known content, so a range's BYTES can be checked, not just its length. */
const FILE_BODY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd';
const FILE_SIZE = FILE_BODY.length; // 40

function fakeGatedBucket(body: unknown | null) {
  return {
    async get(key: string) {
      if (key !== 'ebooks.json' || body === null) return null;
      return { async json() { return body; } };
    },
  } as unknown as R2Bucket;
}

/** The FILES bucket. Records every call so "never buffered" can be argued. */
function fakeFileBucket(present: Record<string, string>) {
  const enc = new TextEncoder();
  return {
    async head(key: string) {
      const v = present[key];
      if (v === undefined) return null;
      return {
        size: v.length,
        httpEtag: '"etag-' + key.length + '"',
        httpMetadata: { contentType: key.endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip' },
      };
    },
    async get(key: string, opts?: { range?: { offset: number; length: number } }) {
      const v = present[key];
      if (v === undefined) return null;
      const slice = opts?.range
        ? v.slice(opts.range.offset, opts.range.offset + opts.range.length)
        : v;
      return {
        size: v.length,
        httpEtag: '"etag-' + key.length + '"',
        httpMetadata: { contentType: key.endsWith('.pdf') ? 'application/pdf' : 'application/epub+zip' },
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

const FILES = { 'A/one.epub': FILE_BODY, 'B/two.pdf': FILE_BODY };

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
    ESTATE_CHECK: 'shadow',
    // Both site origins, exactly as production carries them — the reader is
    // served from ebooks.heygabi.ai and its fetches are cross-origin.
    SITE_ORIGINS: 'https://audiobooks.heygabi.ai,https://ebooks.heygabi.ai',
    EBOOKS_GATED: fakeGatedBucket(MANIFEST),
    EBOOKS: fakeFileBucket(FILES),
    ...over,
  };
}

const GRANTED: Script = { seen: { status: 'approved', visibility: ['audiobook', 'ebooks'] } };

function url(anchor: string) {
  return `/api/ebook/${anchor}/file`;
}

async function fetchFile(
  env: Env,
  anchor = PDF_ANCHOR,
  init: RequestInit = {},
): Promise<Response> {
  return app.request(url(anchor), init, env);
}

beforeEach(() => {
  resetEstateCache();
  resetManifestIndex();
  resetReadBudget();
});

/* ── the gate: the READ grant, and nothing else ─────────────────────────── */

test('⚠️ no token → 401, in words, and NOT ONE BYTE', async () => {
  // ENVIRONMENT 'production' turns the dev bypass off, which is what makes
  // this the real anonymous path rather than a stubbed one. This is also the
  // "a copied URL is a 401" promise (§3.3) in executable form: the URL alone
  // carries no credential and can never be one.
  const res = await fetchFile(envWith({ ENVIRONMENT: 'production' }));
  assert.equal(res.status, 401);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, 'unauthenticated');
  assert.match(String(body.detail), /[Ss]ign in/);
  assert.equal(JSON.stringify(body).includes('two.pdf'), false);
});

test('the four estate refusals stay four distinct, worded answers', async () => {
  const cases: Array<[Script, number, string, RegExp]> = [
    [{ seen: { status: 'pending', visibility: ['ebooks'] } }, 403, 'awaiting_approval', /approve/i],
    [{ seen: { status: 'revoked', visibility: [] } }, 403, 'access_revoked', /removed|restore/i],
    [
      { seen: { status: 'approved', visibility: ['audiobook', 'library'] } },
      403,
      'no_ebooks_grant',
      /Ebooks/,
    ],
    [{ seen: 'error' }, 502, 'estate_unreachable', /outage/i],
  ];
  for (const [script, status, error, detail] of cases) {
    resetEstateCache();
    resetReadBudget();
    const f = stubFetch(script);
    try {
      const res = await fetchFile(envWith());
      assert.equal(res.status, status, error);
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.error, error);
      assert.match(String(body.detail), detail);
    } finally {
      f.restore();
    }
  }
});

test('an UNCONFIGURED estate is our setup problem, not their permission', async () => {
  const res = await fetchFile(
    envWith({ ESTATE_AUTH_URL: undefined, ESTATE_APP_TOKEN_AUDIOBOOK: undefined }),
  );
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as Record<string, unknown>).error, 'estate_unconfigured');
});

test('⚠️ THE CAPABILITY DISTINCTION: a granted member with NO ladder rung still READS', async () => {
  // This is the single most important test in the file, and it exists because
  // the design got this wrong once in writing (viewer design §6.x). The floor
  // on `download` is `admin`. If a future session "hardens" this route by
  // adding `can(role, 'download')` — or by reading `can_download` from
  // anywhere — every ordinary household member loses the ability to read the
  // books they were explicitly granted, and this test goes red.
  //
  // The env deliberately has NO FIREBASE_SERVICE_ACCOUNT, so no ladder rung is
  // resolvable at all: the caller's `download` answer is unambiguously false.
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith());
    assert.equal(res.status, 200, 'reading is the vis_ebooks grant, never `download`');
    assert.equal(await res.text(), FILE_BODY);
  } finally {
    f.restore();
  }
});

test('the owner is served without a directory round-trip — break-glass', async () => {
  // ⚠️ NO fetch stub: any /seen call would throw "unexpected fetch".
  const res = await fetchFile(envWith({ DEV_EMAIL: 'owner@example.com' }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), FILE_BODY);
});

/* ── the stream contract ────────────────────────────────────────────────── */

test('a whole-file GET: 200, Accept-Ranges, no-store, inline, exact length', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith());
    assert.equal(res.status, 200);
    // ⚠️ pdf.js probes for this before enabling range mode; without it, it
    // falls back to downloading a 181 MiB file whole.
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    // ⚠️ The edge cache is keyed on URL and knows nothing about Authorization.
    // A cacheable authenticated response IS a public download endpoint.
    assert.equal(res.headers.get('cache-control'), 'private, max-age=0, no-store');
    // ⚠️ `Vary: Authorization` is what we set; the CORS middleware appends
    // `Origin` to it. Match rather than compare, or a correct answer fails.
    assert.match(res.headers.get('vary') ?? '', /Authorization/);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    // A viewer, not a download button.
    assert.match(res.headers.get('content-disposition') ?? '', /^inline;/);
    assert.match(res.headers.get('content-disposition') ?? '', /two\.pdf/);
    assert.equal(res.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(await res.text(), FILE_BODY);
  } finally {
    f.restore();
  }
});

test('a range GET: 206, correct Content-Range, correct Content-Length, correct BYTES', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), PDF_ANCHOR, { headers: { Range: 'bytes=5-9' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 5-9/${FILE_SIZE}`);
    assert.equal(res.headers.get('content-length'), '5');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    // ⚠️ The bytes themselves, not just their count. An off-by-one in the
    // offset corrupts a PDF silently and looks like a bad file.
    assert.equal(await res.text(), 'FGHIJ');
  } finally {
    f.restore();
  }
});

test('⚠️ the zip.js opening probe and the end-of-archive read both work', async () => {
  const f = stubFetch(GRANTED);
  try {
    const probe = await fetchFile(envWith(), EPUB_ANCHOR, { headers: { Range: 'bytes=0-0' } });
    assert.equal(probe.status, 206);
    assert.equal(probe.headers.get('content-length'), '1');
    assert.equal(await probe.text(), 'A');

    const eocd = await fetchFile(envWith(), EPUB_ANCHOR, { headers: { Range: 'bytes=-4' } });
    assert.equal(eocd.status, 206);
    assert.equal(eocd.headers.get('content-range'), `bytes 36-39/${FILE_SIZE}`);
    assert.equal(await eocd.text(), 'abcd');
  } finally {
    f.restore();
  }
});

test('an over-reaching last-byte-pos clamps to a 206, it does not refuse', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), EPUB_ANCHOR, { headers: { Range: 'bytes=35-99999' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 35-39/${FILE_SIZE}`);
    assert.equal(await res.text(), '9abcd');
  } finally {
    f.restore();
  }
});

test('a range past the end → 416 with `Content-Range: bytes * /size`, and words', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), PDF_ANCHOR, { headers: { Range: 'bytes=9999-' } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), `bytes */${FILE_SIZE}`);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'range_not_satisfiable');
    assert.match(String(body.detail), /\w+ \w+/); // a sentence, never a bare status
  } finally {
    f.restore();
  }
});

test('a MALFORMED range is ignored (200 whole), not refused', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), PDF_ANCHOR, { headers: { Range: 'bytes=10-5' } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(res.headers.get('content-range'), null);
  } finally {
    f.restore();
  }
});

test('HEAD answers the same headers with no body, for both full and ranged', async () => {
  const f = stubFetch(GRANTED);
  try {
    const full = await fetchFile(envWith(), PDF_ANCHOR, { method: 'HEAD' });
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-length'), String(FILE_SIZE));
    assert.equal(full.headers.get('cache-control'), 'private, max-age=0, no-store');
    assert.equal(await full.text(), '');

    const ranged = await fetchFile(envWith(), PDF_ANCHOR, {
      method: 'HEAD',
      headers: { Range: 'bytes=0-9' },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get('content-range'), `bytes 0-9/${FILE_SIZE}`);
    assert.equal(ranged.headers.get('content-length'), '10');
    assert.equal(await ranged.text(), '');
  } finally {
    f.restore();
  }
});

test('⚠️ HEAD is gated too — a tokenless HEAD leaks no size', async () => {
  // A HEAD that answered Content-Length before the gate would tell an
  // anonymous caller how big every book in the house is.
  const res = await fetchFile(envWith({ ENVIRONMENT: 'production' }), PDF_ANCHOR, {
    method: 'HEAD',
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('content-length'), null);
});

/* ── the four ways a book can fail to arrive, kept apart ────────────────── */

test('⚠️ an anchor not on the shelf is a 404 about the LINK, never a 403', async () => {
  // This caller has already been admitted, so a permission-shaped refusal here
  // would send them asking for access they already hold (§1e point 5).
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), 'b-nope');
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'unknown_book');
    assert.match(String(body.detail), /renamed|re-filed|shelf/i);
  } finally {
    f.restore();
  }
});

test('⚠️ THE OMNIBUS CASE: on the shelf, absent from the bucket → its OWN 404', async () => {
  // Real today: `wrangler r2 object put` refuses files over 300 MiB, so the
  // 393 MiB White Sand Omnibus is the one of 168 files not in `estate-ebooks`.
  // A person who opens it must be told the FILE is missing — not 403 (which
  // reads as "you are not allowed") and not 500 (which reads as "it is
  // broken"). Four causes, four sentences.
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), OMNIBUS_ANCHOR);
    assert.equal(res.status, 404);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'file_absent');
    assert.match(String(body.detail), /not been uploaded|nothing to read/i);
    // ⚠️ And it must NOT read as a permission decision.
    assert.equal(/not allowed|permission to/i.test(String(body.detail)), false);
    // Distinct from the unknown-anchor answer, which is a different fix.
    assert.notEqual(body.error, 'unknown_book');
  } finally {
    f.restore();
  }
});

test('an unbound FILE store and an unbound CATALOGUE store are different sentences', async () => {
  const f = stubFetch(GRANTED);
  try {
    const noFiles = await fetchFile(envWith({ EBOOKS: undefined }));
    assert.equal(noFiles.status, 503);
    const a = (await noFiles.json()) as Record<string, unknown>;
    assert.equal(a.error, 'file_store_unbound');
    assert.match(String(a.fix), /estate-ebooks/);

    resetEstateCache();
    resetManifestIndex();
    resetReadBudget();
    const noCatalogue = await fetchFile(envWith({ EBOOKS_GATED: undefined }));
    assert.equal(noCatalogue.status, 503);
    const b = (await noCatalogue.json()) as Record<string, unknown>;
    assert.equal(b.error, 'manifest_store_unbound');
    assert.notEqual(a.fix, b.fix);
  } finally {
    f.restore();
  }
});

/* ── the key scheme, pinned from this side ──────────────────────────────── */

test('⚠️ the R2 key is the manifest row\'s `path` VERBATIM — a lookup, never a build', async () => {
  // 1.4 GB of objects are stored under this scheme, so changing it is a
  // migration. A handler that prefixed, hashed, encoded or lower-cased the key
  // finds nothing and this goes red. The mirror of
  // audiobook_catalog's tests/test_upload_ebooks_r2.py::test_key_scheme_mutations_fail.
  const seen: string[] = [];
  const spy = {
    async head(key: string) {
      seen.push(key);
      return { size: FILE_SIZE, httpEtag: '"e"', httpMetadata: { contentType: 'application/pdf' } };
    },
    async get(key: string) {
      seen.push(key);
      return {
        body: new ReadableStream({ start(c) { c.close(); } }),
      };
    },
  } as unknown as R2Bucket;
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith({ EBOOKS: spy }));
    assert.equal(res.status, 200);
    assert.deepEqual(seen, ['B/two.pdf', 'B/two.pdf']);
  } finally {
    f.restore();
  }
});

test('⚠️ a client-supplied anchor NEVER reaches the bucket API', async () => {
  // The path-traversal question wearing a hash. `../` and an absolute key are
  // not "sanitised" — they simply are not in the manifest, so they 404 before
  // any bucket call happens at all.
  const touched: string[] = [];
  const spy = {
    async head(key: string) { touched.push(key); return null; },
    async get(key: string) { touched.push(key); return null; },
  } as unknown as R2Bucket;
  const f = stubFetch(GRANTED);
  try {
    for (const evil of ['..%2F..%2Fetc', 'ebooks.json', 'b-aaaa%00']) {
      resetReadBudget();
      const res = await app.request(`/api/ebook/${evil}/file`, {}, envWith({ EBOOKS: spy }));
      assert.equal(res.status, 404, evil);
    }
    assert.deepEqual(touched, [], 'no client string may reach R2');
  } finally {
    f.restore();
  }
});

/* ── the reading budget (§3.5) ──────────────────────────────────────────── */

test('⚠️ ranges WITHIN one book are uncapped — reading must never be throttled', async () => {
  // A page turn is several range GETs and opening one EPUB is ~15 of them
  // (measured). If the budget counted books per request instead of distinct
  // books, this loop would 429 and the reader would stall mid-chapter.
  const f = stubFetch(GRANTED);
  try {
    for (let i = 0; i < 40; i += 1) {
      const res = await fetchFile(envWith(), EPUB_ANCHOR, { headers: { Range: 'bytes=0-0' } });
      assert.equal(res.status, 206, `request ${i}`);
    }
  } finally {
    f.restore();
  }
});

test('opening many DISTINCT books trips a quiet 429 with Retry-After', async () => {
  // The scraper axis. The refusal is worded and explicitly says nothing is
  // wrong with the account — a bare 429 would read as a ban.
  const f = stubFetch(GRANTED);
  try {
    const env = envWith();
    for (let i = 0; i < DISTINCT_BOOKS_PER_WINDOW; i += 1) {
      // Unknown anchors still charge — a budget that only counted successes
      // would be a free probe of which anchors exist.
      await app.request(`/api/ebook/b-scrape${i}/file`, {}, env);
    }
    const res = await fetchFile(env, PDF_ANCHOR);
    assert.equal(res.status, 429);
    const retry = Number(res.headers.get('retry-after'));
    assert.ok(retry >= 1 && retry <= 300, `Retry-After was ${retry}`);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.error, 'rate_limited');
    assert.match(String(body.detail), /Nothing is wrong with your account/);
    // ⚠️ Even a refusal advertises ranging: pdf.js decides whether to
    // range-stream from the FIRST response it sees.
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
  } finally {
    f.restore();
  }
});

test('the owner is exempt — a break-glass that can be rate-limited is not one', async () => {
  const env = envWith({ DEV_EMAIL: 'owner@example.com' });
  for (let i = 0; i < DISTINCT_BOOKS_PER_WINDOW + 5; i += 1) {
    await app.request(`/api/ebook/b-many${i}/file`, {}, env);
  }
  const res = await fetchFile(env, PDF_ANCHOR);
  assert.equal(res.status, 200);
});

/* ── CORS: the preflight the reader actually sends ──────────────────────── */

test('⚠️ the ranged preflight from the ebooks origin is allowed, Range included', async () => {
  // A preflight that does not name `Range` fails as an OPAQUE NETWORK ERROR in
  // the browser — indistinguishable from "the Worker is down". Every ranged
  // fetch sends one, because `Range` is not a CORS-safelisted request header.
  const res = await app.request(
    url(PDF_ANCHOR),
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://ebooks.heygabi.ai',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,range',
      },
    },
    envWith(),
  );
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://ebooks.heygabi.ai');
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /Range/i);
  assert.ok(res.status === 204 || res.status === 200, `preflight status ${res.status}`);
});

test('⚠️ the reader can READ Content-Range back — otherwise pdf.js cannot lay out', async () => {
  const f = stubFetch(GRANTED);
  try {
    const res = await fetchFile(envWith(), PDF_ANCHOR, {
      headers: { Range: 'bytes=0-3', Origin: 'https://ebooks.heygabi.ai' },
    });
    assert.equal(res.status, 206);
    const exposed = res.headers.get('access-control-expose-headers') ?? '';
    assert.match(exposed, /Content-Range/i);
    assert.match(exposed, /Accept-Ranges/i);
  } finally {
    f.restore();
  }
});

test('a stranger origin gets no allow-origin header', async () => {
  const res = await app.request(
    url(PDF_ANCHOR),
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization,range',
      },
    },
    envWith(),
  );
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

/* ── the ESTATE_CHECK question, pinned so nobody "fixes" it later ───────── */

test('⚠️ the stream does NOT respect ESTATE_CHECK — a shadowed byte stream is a public one', async () => {
  for (const mode of ['off', 'shadow', 'enforce']) {
    resetEstateCache();
    resetReadBudget();
    const f = stubFetch({ seen: { status: 'approved', visibility: ['audiobook'] } });
    try {
      const res = await fetchFile(envWith({ ESTATE_CHECK: mode }));
      assert.equal(res.status, 403, `mode ${mode} must still refuse`);
      assert.equal(((await res.json()) as Record<string, unknown>).error, 'no_ebooks_grant');
    } finally {
      f.restore();
    }
  }
});
