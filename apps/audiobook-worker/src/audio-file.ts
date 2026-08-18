/**
 * `GET|HEAD /api/audio/:anchor/file` — the gated audiobook byte stream.
 * **Audio player phase 1**, built 2026-08-18.
 *
 * Design: `docs/info/audio-player-design.md` — §7.2 (this route), §3.5 + §12
 * decision 1 (the gate), §7.5 (the budget, re-derived in `listen-budget.ts`),
 * §12 decision 3 (on-demand ingest, which is where the "request it" refusal
 * comes from). Ingest as-built: `audiobook_catalog/docs/info/audio-ingest.md`.
 *
 * ## A near-COPY of `ebook-file.ts`, and the duplication is deliberate
 *
 * Design §7.2, verbatim: *"should be written as a near-copy of `ebook-file.ts`,
 * not as a refactor of it into a shared handler. Reasons: the gate differs, the
 * budget differs, the content types differ, and the ebook route is live,
 * verified and load-bearing."* The estate has already paid for the general
 * version of this lesson — `ebook-viewer-phase1.md` §4: *"when a shared helper
 * writes a response, the CALLER's header contract is not inherited."*
 *
 * So: `range.ts` is SHARED (pure, table-tested, owns no response contract) and
 * `ebook-gate.ts` is SHARED (it is a decision, and there must be one of those).
 * Everything else is copied. ⚠️ A future session tempted to fold these two
 * routes into one handler should read §7.2 first, then this paragraph.
 *
 * ## The three laws — unchanged from `ebook-file.ts`, and law 1 bites harder
 *
 * 1. ⚠️ **NEVER buffer.** `R2ObjectBody.body` passes through untouched. The
 *    mean audiobook is **601 MB** and the largest is **3.92 GB** (MEASURED
 *    2026-08-17) against a 128 MiB isolate. Where the ebook route's worst case
 *    exceeded the limit threefold, this one exceeds it **thirtyfold**.
 * 2. ⚠️ **NEVER cacheable.** `Cache-Control: private, max-age=0, no-store` +
 *    `Vary: Authorization` on every answer. Cloudflare's edge is keyed on URL
 *    and knows nothing about a bearer; a cacheable authenticated response IS a
 *    public download endpoint with extra steps.
 * 3. ⚠️ **NEVER a URL that works on its own.** Re-ratified as owner policy on
 *    2026-08-17 (design §12 decision 5, *"5 yyes do it as you suggest"*):
 *    service-worker bearer injection first, a session cookie if that proves
 *    untenable on iOS, **a signed URL under no circumstances**. A 13.7-hour
 *    mean listen outlives any TTL short enough to be safe anyway.
 *
 * ## The gate is `vis_ebooks` — ⚠️ NOT a new `vis_audio` column
 *
 * Owner decision 1 (design §12, 2026-08-17), verbatim: *"MIRROR EBOOK if they
 * can read an ebook they can listen to an audio."* One grant means **"may
 * consume the estate's book files"**, reading or listening. The design's own
 * recommendation had been a sixth `vis_audio` column and the owner declined it,
 * so everywhere that document says `vis_audio`, read `vis_ebooks`.
 *
 * ⚠️ Seeing the audiobook SITE is still `vis_audiobook` (default 1, in the
 * public slice) and is untouched. This gate is on the BYTES.
 *
 * ⚠️ And, exactly as on the ebook route: gate on the VISIBILITY grant, **never
 * on the ladder's `download`** (floor `admin`, capabilities.ts). Listening and
 * taking the file away are two capabilities on purpose.
 *
 * ## `Accept-Ranges: bytes` — more load-bearing here than it was for PDF
 *
 * ⚠️ **Safari decides whether a media element can play AT ALL from this
 * header** (design §1.1). It rides on every answer including refusals, for the
 * same reason pdf.js needed it: a client that learns "no ranges" from the first
 * response it sees — a 401 before sign-in — has been taught to pull the whole
 * 601 MB file when it retries.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { resolveEbookAccess } from './ebook-gate.js';
import { audioIndex, type AudioEntry } from './audio-manifest.js';
import { chargeListen } from './listen-budget.js';
import { contentRange, parseRange, unsatisfiedContentRange } from './range.js';

export const audioFileRoutes = new Hono<{ Bindings: Env }>();

/** The cache posture, in one place so laws 2 and 3 cannot drift apart. */
const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, max-age=0, no-store',
  Vary: 'Authorization',
};

/** Rides on EVERY answer this route gives, refusals included. See the header. */
const ACCEPT_RANGES: Record<string, string> = { 'Accept-Ranges': 'bytes' };

/**
 * ⚠️ `audio/mp4`, never `audio/x-m4b` and never `application/octet-stream`.
 * An `.m4b` is structurally an `.m4a` — AAC in an MPEG-4 container — and
 * browsers key playback behaviour off the type. A wrong type is a player that
 * offers to download the book instead of playing it. The ingest already stores
 * this exact value on every object (`upload_audio_r2.py` CONTENT_TYPE); this
 * is the fallback for an object that somehow lacks it.
 */
const AUDIO_CONTENT_TYPE = 'audio/mp4';

function refuse(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...NO_STORE, ...ACCEPT_RANGES, ...extra },
  });
}

/**
 * Put this route's headers on a refusal the SHARED gate wrote.
 *
 * ⚠️ The ebook route learned this LIVE, minutes after its first deploy: the
 * gate writes plain JSON responses for a route (the shelf) that needs neither
 * `Accept-Ranges` nor `Cache-Control`, and its 401 went out without them. Both
 * matter here and the 401 is where they matter most — it is the first response
 * a signed-out listener's browser sees, and Safari decides whether it can play
 * a media URL at all from the first response it sees.
 */
function dress(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries({ ...NO_STORE, ...ACCEPT_RANGES })) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const handler = async (c: {
  env: Env;
  req: { raw: Request; param: (k: string) => string | undefined };
}) => {
  const method = c.req.raw.method.toUpperCase();

  // 1. The gate — identity + the estate's `ebooks` visibility grant (owner
  //    decision 1: one grant for reading AND listening). Its refusals are
  //    already worded; they are returned unchanged, only re-dressed.
  //    ⚠️ Runs BEFORE anything touches a bucket, so an unauthenticated caller
  //    cannot use this route to probe which books the household holds.
  const gate = await resolveEbookAccess(c as never);
  if (!gate.ok) return dress(gate.response);
  const { access } = gate;

  const anchor = (c.req.param('anchor') ?? '').trim();
  if (!anchor) {
    return refuse(
      {
        error: 'no_anchor',
        detail:
          'That link does not name a book. Open the book from the catalogue and the player will fill it in.',
      },
      404,
    );
  }

  // 2. The LISTENING budget (listen-budget.ts — re-derived for hours of
  //    ranges, NOT inherited from the reader's). ⚠️ Charged AFTER identity, so
  //    the key is a verified email rather than a spoofable header, and BEFORE
  //    the bytes, so a caller hammering 404s or 416s still pays. The owner is
  //    exempt: a break-glass that can be rate-limited is not a break-glass.
  if (!access.isOwner) {
    const verdict = chargeListen(access.email, anchor);
    if (!verdict.ok) {
      return refuse(
        {
          error: 'rate_limited',
          detail:
            verdict.reason === 'too_many_books'
              ? 'You have opened a lot of different audiobooks very quickly, so the shelf is pacing you. Nothing is wrong with your account — carry on with the book you are listening to, and the rest unlock again shortly.'
              : 'That is a lot of requests in a short time, so the shelf is pacing you. Nothing is wrong with your account — wait a moment and playback will carry on.',
          retry_after_seconds: verdict.retryAfterSec,
        },
        429,
        { 'Retry-After': String(verdict.retryAfterSec) },
      );
    }
  }

  // 3. `anchor → path`, a LOOKUP in the gated manifest, never a construction.
  //    The manifest shares the ebook shelf's private bucket under a second key
  //    — see audio-manifest.ts's header for why that is a decision, not a slip.
  const gatedBucket = c.env.EBOOKS_GATED;
  if (!gatedBucket) {
    return refuse(
      {
        error: 'manifest_store_unbound',
        detail:
          'You may listen to this book, but the shelf’s catalogue is not attached to this Worker, so it cannot look the file up. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS_GATED binding (bucket ebooks-gated) and redeploy',
      },
      503,
    );
  }

  const idx = await audioIndex(gatedBucket);
  if (!idx.ok) {
    return refuse(
      {
        error: idx.reason === 'absent' ? 'manifest_absent' : 'manifest_unreadable',
        detail:
          idx.reason === 'absent'
            ? 'You may listen, but no audio catalogue has been published yet, so nothing can be located. Audiobooks are uploaded on request — if nobody has requested one yet this is the expected answer, not a fault.'
            : 'The audio catalogue could not be read, so the file cannot be located. This is a publishing problem, not a permission one — tell Mitch.',
        ...(idx.reason === 'absent'
          ? { fix: 'run scripts/publish_audio_manifest.py in audiobook_catalog (it runs itself after every ingest)' }
          : {}),
      },
      503,
    );
  }

  const entry: AudioEntry | undefined = idx.index.get(anchor);
  if (!entry) {
    // ⚠️ 404, never 403. An anchor that is not in the audio manifest is a fact
    // about the LINK, not about the caller — and this caller has already been
    // admitted, so a permission-shaped refusal would send them asking for
    // access they already hold.
    return refuse(
      {
        error: 'unknown_book',
        detail:
          'No audiobook matches that link. It may have been re-filed since the link was made — open the book from the catalogue instead.',
      },
      404,
    );
  }

  // ⚠️ THE NAMED "REQUEST IT" REFUSAL — the one this whole phase is shaped
  // around. Ingest is ON-DEMAND (owner decision 3): the bucket starts empty
  // and a book arrives only because somebody pressed request. A recorded row
  // with `streamable: false` is an EVICTED book (the 30-day idle pass), which
  // is a different fact from "never uploaded" — but it is the same sentence to
  // the person, because the same one press fixes both.
  //
  // ⚠️ Never a 403 (reads as "you are not allowed", sending them to ask for
  // access they hold) and never a 500 (reads as "it is broken", sending them
  // nowhere). It is a 404 with a next action.
  if (!entry.streamable) {
    return refuse(
      {
        error: 'not_streamable',
        detail:
          'This audiobook is not streamable yet — audiobooks are uploaded on request rather than all at once. Press “request it” on the book and the library machine will upload it on its next run; that usually means a few hours, because the pipeline runs every eight hours.',
      },
      404,
    );
  }

  // 4. The bytes' own bucket. ⚠️ A DIFFERENT bucket from the manifest's, and
  //    that separation is the one carrying a security property: object keys
  //    here are library paths verbatim, so a public URL on this bucket would
  //    be a guessable, world-readable warehouse of the household's audio.
  const files = c.env.AUDIO;
  if (!files) {
    return refuse(
      {
        error: 'file_store_unbound',
        detail:
          'You may listen to this book, but the store its files live in is not attached to this Worker. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] AUDIO binding (bucket estate-audio) and redeploy',
      },
      503,
    );
  }

  const head = await files.head(entry.path);
  if (!head) {
    // The record says streamable and the bucket disagrees — a DRIFT, and a
    // third distinct fact from the two above. It happens if an eviction
    // deleted an object without updating the record, or an upload half
    // succeeded. Worth its own sentence because the fix is ours, not theirs.
    return refuse(
      {
        error: 'file_absent',
        detail:
          'The catalogue says this audiobook is uploaded and its file is not there. That is a gap on our side, not a permission problem — tell Mitch, and requesting the book again will re-upload it.',
      },
      404,
    );
  }

  const size = head.size;
  const intent = parseRange(c.req.raw.headers.get('Range'), size);

  const baseHeaders: Record<string, string> = {
    ...NO_STORE,
    ...ACCEPT_RANGES,
    'Content-Type': head.httpMetadata?.contentType || AUDIO_CONTENT_TYPE,
    // ⚠️ `inline`, never `attachment`. This is a player, not a download button;
    // a download surface, when one exists, is a DIFFERENT route with its own
    // `can(role, 'download')` check (admin+).
    'Content-Disposition': contentDisposition(entry.path),
    ETag: head.httpEtag,
  };

  if (intent.kind === 'unsatisfiable') {
    return refuse(
      {
        error: 'range_not_satisfiable',
        detail:
          'The player asked for a part of this file that does not exist. Reload the page; if it keeps happening tell Mitch.',
      },
      416,
      { 'Content-Range': unsatisfiedContentRange(size) },
    );
  }

  // 5. HEAD — same headers, no body, no second R2 read.
  //
  // ⚠️ THIS VERB IS NOT OPTIONAL HERE, unlike on the ebook route where it was
  // a courtesy to probing clients. Design §3.2 item 5 makes a page-level HEAD
  // with a real bearer the MANDATORY mitigation for the auth seam's silent
  // failure: an `<audio>` element reports a 401 to the page as a bare `error`
  // event with no status, so the person sees a play button that does nothing.
  // The page must be able to ask this question itself and read the worded
  // answer. Deleting HEAD support re-opens that hole.
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
      return refuse(
        {
          error: 'file_absent',
          detail:
            'This audiobook’s file disappeared while it was playing. Try again; if it keeps happening tell Mitch.',
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

  // ⚠️ The no-Range 200. `range.ts` answers a MALFORMED Range header by
  // IGNORING it and falling here — correct HTTP, and here it means a client
  // off-by-one becomes a 601 MB (worst case 3.92 GB) download. The player must
  // therefore never fetch without a Range, and must treat a 200 as a NAMED
  // failure whose body is CANCELLED rather than read — the guard
  // `epub-range.js` already models. Phase 2 owns that half.
  const obj = await files.get(entry.path);
  if (!obj) {
    return refuse(
      {
        error: 'file_absent',
        detail:
          'This audiobook’s file disappeared while it was playing. Try again; if it keeps happening tell Mitch.',
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
audioFileRoutes.get('/api/audio/:anchor/file', handler as never);
audioFileRoutes.on('HEAD', '/api/audio/:anchor/file', handler as never);

/**
 * `inline` plus a filename, both forms.
 *
 * The plain `filename=` is ASCII-safe and quote-escaped; `filename*=` carries
 * the real one. The audio corpus has the same accented-name problem the ebook
 * one did, and a header with a raw non-ASCII byte or an unescaped quote is a
 * malformed response that some clients drop entirely.
 */
function contentDisposition(path: string): string {
  const name = path.split('/').pop() || 'audiobook';
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
