/**
 * `GET|HEAD /api/ebook/:anchor/file` — the gated byte stream the in-browser
 * reader reads through. **Viewer phase 1a**, built 2026-08-17.
 *
 * Design: `library_catalog/docs/info/ebook-viewer-design.md` §2.3 (the stream
 * contract), §3 (the gate), §3.5 (the budget); measurements:
 * `epub-streaming-findings-2026-08-17.md`; the bucket and its key scheme:
 * `audiobook_catalog/docs/info/ebooks-r2-ingest.md`.
 *
 * ## The three laws of this handler
 *
 * 1. ⚠️ **NEVER buffer.** `R2ObjectBody.body` is a `ReadableStream` and is
 *    passed through untouched. `await object.arrayBuffer()` here would be an
 *    OOM, not a slow request: three files exceed the Workers 128 MiB isolate
 *    memory limit outright and the White Sand Omnibus (412,436,591 B) exceeds
 *    it more than threefold. The biggest book in the house is the reason this
 *    rule exists, so it is the one to test with.
 * 2. ⚠️ **NEVER cacheable.** Cloudflare's edge cache is keyed on URL and knows
 *    nothing about an `Authorization` header, so an authenticated response
 *    left cacheable IS a public download endpoint with extra steps — the exact
 *    outcome this design exists to prevent, arriving disguised as a
 *    performance win. Hence `Cache-Control: private, max-age=0, no-store` and
 *    `Vary: Authorization` on every answer, and never a `cf: { cacheEverything }`
 *    option on the R2 read.
 * 3. ⚠️ **NEVER a URL that works on its own.** The credential is a bearer
 *    header on every request, including every range. Copy a working reader's
 *    URL and you get a 401. A signed URL would be the credential — surviving in
 *    history, referrers, screenshots and logs — and could not be revoked
 *    mid-session, which is precisely the estate's revocation promise.
 *
 * ## The gate is the READ grant, and this is the sharpest edge in the file
 *
 * ⚠️ **This route gates on the estate's `vis_ebooks` grant (ebook-gate.ts) and
 * MUST NOT gate on the ladder's `download` capability.** `download` floors at
 * `admin` (capabilities.ts, owner directive 2026-08-17). Adding
 * `can(role, 'download')` here would lock every ordinary household member out
 * of READING books they have explicitly been granted — the exact inversion
 * viewer design §6.x was written to stop. Reading in the viewer and taking a
 * file away are two capabilities on purpose; a download surface, when one
 * exists, is a DIFFERENT route with `Content-Disposition: attachment` and its
 * own `can(role, 'download')` check. `test/ebook-file.test.ts` pins this: a
 * granted member with no ladder rung must get bytes.
 *
 * ## Range behaviour
 *
 * `Accept-Ranges: bytes` is MANDATORY and is advertised on every answer,
 * including the 404s' siblings — pdf.js probes for it before enabling range
 * mode, and foliate-js + zip.js opened the 393 MiB omnibus in 15 ranges
 * totalling 76.9 KiB because of it. The parsing table lives in `range.ts`.
 *
 * ⚠️ The size is read with `bucket.head()` FIRST and the range is validated
 * against it here, rather than handing R2 a range and hoping. That costs one
 * extra Class-B op per request and buys three things worth far more: a
 * deterministic `416` with a correct `Content-Range: bytes * /<size>`, a
 * `Content-Range` on the 206 computed from the size we actually validated
 * against, and a missing object detected as a NAMED 404 instead of surfacing
 * as an R2 exception.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { resolveEbookAccess } from './ebook-gate.js';
import { ebookIndex, type EbookEntry } from './ebook-manifest.js';
import { chargeRead } from './read-budget.js';
import { contentRange, parseRange, unsatisfiedContentRange } from './range.js';

export const ebookFileRoutes = new Hono<{ Bindings: Env }>();

/** The cache posture, in one place so the two laws above cannot drift apart. */
const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, max-age=0, no-store',
  Vary: 'Authorization',
};

/**
 * `Accept-Ranges: bytes` rides on EVERY answer this route gives, refusals
 * included. ⚠️ pdf.js decides whether to range-stream from the headers of the
 * FIRST response it sees; a 401 or 429 that omitted it, retried after sign-in,
 * has already taught some clients to download the whole 181 MiB handbook.
 */
const ACCEPT_RANGES: Record<string, string> = { 'Accept-Ranges': 'bytes' };

function refuse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE, ...ACCEPT_RANGES, ...extra },
  });
}

const handler = async (c: { env: Env; req: { raw: Request; param: (k: string) => string | undefined } }) => {
  const method = c.req.raw.method.toUpperCase();

  // 1. The gate — identity + the estate's `ebooks` visibility grant. Its
  //    refusals are already worded; they are returned unchanged.
  //    ⚠️ Runs BEFORE anything touches a bucket, so an unauthenticated caller
  //    cannot use this route to probe which anchors exist.
  const gate = await resolveEbookAccess(c as never);
  if (!gate.ok) return gate.response;
  const { access } = gate;

  const anchor = (c.req.param('anchor') ?? '').trim();
  if (!anchor) {
    return refuse(
      {
        error: 'no_anchor',
        detail: 'That link does not name a book. Open the book from the shelf and it will fill in.',
      },
      404,
    );
  }

  // 2. The reading budget (§3.5). ⚠️ Charged AFTER identity — so the key is a
  //    verified email rather than a spoofable header — and BEFORE the bytes,
  //    so a caller hammering 404s or 416s still pays. The owner is exempt:
  //    a break-glass that can be rate-limited is not a break-glass.
  if (!access.isOwner) {
    const verdict = chargeRead(access.email, anchor);
    if (!verdict.ok) {
      return refuse(
        {
          error: 'rate_limited',
          detail:
            verdict.reason === 'too_many_books'
              ? 'You have opened a lot of different books very quickly, so the shelf is pacing you. Nothing is wrong with your account — carry on reading the book you have open, and the rest unlock again shortly.'
              : 'That is a lot of requests in a short time, so the shelf is pacing you. Nothing is wrong with your account — wait a moment and the page will carry on.',
          retry_after_seconds: verdict.retryAfterSec,
        },
        429,
        { 'Retry-After': String(verdict.retryAfterSec) },
      );
    }
  }

  // 3. `anchor → path`, a LOOKUP in the gated manifest, never a construction.
  const gatedBucket = c.env.EBOOKS_GATED;
  if (!gatedBucket) {
    return refuse(
      {
        error: 'manifest_store_unbound',
        detail:
          'You may read this book, but the shelf’s catalogue is not attached to this Worker, so it cannot look the file up. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS_GATED binding (bucket ebooks-gated) and redeploy',
      },
      503,
    );
  }

  const idx = await ebookIndex(gatedBucket);
  if (!idx.ok) {
    return refuse(
      {
        error: idx.reason === 'absent' ? 'manifest_absent' : 'manifest_unreadable',
        detail:
          idx.reason === 'absent'
            ? 'You may read this book, but no shelf catalogue has been published yet, so the file cannot be located. The library pipeline writes it three times a day — if this persists, tell Mitch.'
            : 'The shelf’s catalogue could not be read, so the file cannot be located. This is a publishing problem, not a permission one — tell Mitch.',
        ...(idx.reason === 'absent'
          ? { fix: 'run scripts/publish_ebooks_manifest.py in audiobook_catalog (sync step 5.8)' }
          : {}),
      },
      503,
    );
  }

  const entry: EbookEntry | undefined = idx.index.get(anchor);
  if (!entry) {
    // ⚠️ 404, never 403. An anchor that is not on the shelf is a fact about the
    // link, not about the caller — and this caller has already been admitted,
    // so a permission-shaped refusal here would send them asking for access
    // they already hold (§1e point 5).
    return refuse(
      {
        error: 'unknown_book',
        detail:
          'No book on the shelf matches that link. It may have been renamed or re-filed since the link was made — open it from the shelf instead.',
      },
      404,
    );
  }

  // 4. The bytes' own bucket.
  const files = c.env.EBOOKS;
  if (!files) {
    return refuse(
      {
        error: 'file_store_unbound',
        detail:
          'You may read this book, but the store its files live in is not attached to this Worker. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS binding (bucket estate-ebooks) and redeploy',
      },
      503,
    );
  }

  const head = await files.head(entry.path);
  if (!head) {
    // ⚠️ THE NAMED GAP, and it is a real one today: the ingest could not upload
    // the 393 MiB White Sand Omnibus, because `wrangler r2 object put` refuses
    // anything over 300 MiB (measured twice, `--pipe` included). 167 of 168
    // files are in the bucket. A person who opens that book must be told the
    // FILE is missing, in words — never a 403 (which reads as "you are not
    // allowed", sending them to ask for access they hold) and never a 500
    // (which reads as "it is broken", sending them nowhere).
    return refuse(
      {
        error: 'file_absent',
        detail:
          'This book is on the shelf but its file has not been uploaded yet, so there is nothing to read. That is a gap on our side, not a permission problem — tell Mitch and he can push the file up.',
      },
      404,
    );
  }

  const size = head.size;
  const intent = parseRange(c.req.raw.headers.get('Range'), size);

  const baseHeaders: Record<string, string> = {
    ...NO_STORE,
    ...ACCEPT_RANGES,
    'Content-Type': contentTypeFor(head, entry),
    // ⚠️ `inline`, never `attachment`. This is a viewer, not a download button;
    // the download affordance is a separate route gated on `download` (admin+).
    'Content-Disposition': contentDisposition(entry.path),
    ETag: head.httpEtag,
  };

  if (intent.kind === 'unsatisfiable') {
    return refuse(
      {
        error: 'range_not_satisfiable',
        detail:
          'The reader asked for a part of this file that does not exist. Reload the page; if it keeps happening tell Mitch.',
      },
      416,
      { 'Content-Range': unsatisfiedContentRange(size) },
    );
  }

  // 5. HEAD — the same headers, no body, no second R2 read. Some range clients
  //    probe with HEAD before deciding whether to stream at all.
  if (method === 'HEAD') {
    const headers =
      intent.kind === 'range'
        ? {
            ...baseHeaders,
            'Content-Range': contentRange(intent.start, intent.end, size),
            'Content-Length': String(intent.end - intent.start + 1),
          }
        : { ...baseHeaders, 'Content-Length': String(size) };
    return new Response(null, { status: intent.kind === 'range' ? 206 : 200, headers });
  }

  // 6. The stream. ⚠️ `object.body` STRAIGHT through — see law 1.
  if (intent.kind === 'range') {
    const length = intent.end - intent.start + 1;
    const obj = await files.get(entry.path, { range: { offset: intent.start, length } });
    if (!obj) {
      // The object vanished between head() and get() — a genuine race, not a
      // permission fact. Say so rather than serving a truncated body.
      return refuse(
        {
          error: 'file_absent',
          detail:
            'This book’s file disappeared while it was being read. Try again; if it keeps happening tell Mitch.',
        },
        404,
      );
    }
    return new Response(obj.body as unknown as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        'Content-Range': contentRange(intent.start, intent.end, size),
        'Content-Length': String(length),
      },
    });
  }

  const obj = await files.get(entry.path);
  if (!obj) {
    return refuse(
      {
        error: 'file_absent',
        detail:
          'This book’s file disappeared while it was being read. Try again; if it keeps happening tell Mitch.',
      },
      404,
    );
  }
  return new Response(obj.body as unknown as ReadableStream, {
    status: 200,
    headers: { ...baseHeaders, 'Content-Length': String(size) },
  });
};

// Hono routes both verbs at one path; the handler branches on the method so
// there is exactly ONE gate, one budget charge and one lookup for both.
ebookFileRoutes.get('/api/ebook/:anchor/file', handler as never);
ebookFileRoutes.on('HEAD', '/api/ebook/:anchor/file', handler as never);

/**
 * The stored `Content-Type` wins; the manifest's `format` is the fallback.
 *
 * ⚠️ Never `application/octet-stream` for a file we can name. pdf.js and
 * foliate-js both key behaviour off the type, and a wrong one is a viewer that
 * offers to download the book instead of opening it.
 */
function contentTypeFor(head: R2Object, entry: EbookEntry): string {
  const stored = head.httpMetadata?.contentType;
  if (stored) return stored;
  if (entry.format === 'pdf') return 'application/pdf';
  if (entry.format === 'epub') return 'application/epub+zip';
  return 'application/octet-stream';
}

/**
 * `inline` plus a filename, both forms.
 *
 * The plain `filename=` is ASCII-safe and quote-escaped; `filename*=` carries
 * the real one (the corpus contains `Brené Brown`, apostrophes and ampersands
 * — measured at ingest). A header with a raw non-ASCII byte or an unescaped
 * quote is a malformed response, which some clients drop entirely.
 */
function contentDisposition(path: string): string {
  const name = path.split('/').pop() || 'book';
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
