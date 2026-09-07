/**
 * `GET /api/download/:anchor` — the ONE surface that hands a whole ebook file
 * over as an attachment. **Phase 4b**, built 2026-09-06.
 *
 * ⚠️ **THE ROUTE THE REST OF THE EBOOK CODE HAS BEEN POINTING AT FOR THREE
 * WEEKS.** `ebook-file.ts`'s header, `ebook-gate.ts`'s header, `ebooks.ts`'s
 * `can_download` comment and `capabilities.ts`'s `download` row all say the
 * same thing in different words: *"a download surface, when one exists, is a
 * DIFFERENT route with `Content-Disposition: attachment` and its own
 * `can(role, 'download')` check."* This is that route, and nothing about the
 * viewer's route changed to make it exist.
 *
 * The TODO writes this item as `GET /api/download/:bookId`. The parameter is
 * named `:anchor` here because the identifier IS the manifest anchor — the
 * same string `/api/ebook/:anchor/file` takes, produced in exactly one place
 * (`audiobook_catalog/scripts/build_ebook_manifest.ebook_anchor()`). A second
 * name for one identifier is how a shelf link and a download link start
 * disagreeing about which book they mean.
 *
 * ## TWO gates, both required, in this order — and the order is the product
 *
 *   1. `resolveEbookAccess` — the estate's `vis_ebooks` READ grant, the SAME
 *      function the shelf and the viewer ask. Refusals returned unchanged.
 *   2. `can(role, 'download')` — this site's LADDER, floor **`admin`**
 *      (capabilities.ts, owner directive 2026-08-17: *"For ebooks I don't want
 *      a download check box, I want to use roles we have. Set up the roles to
 *      match library."*).
 *
 * ⚠️ **Neither implies the other and the route needs both.** capabilities.ts
 * states the two failure shapes plainly: *"A rankless person with `vis_ebooks`
 * browses and reads and cannot take a file; an admin without `vis_ebooks`
 * never reaches a shelf to download from."* Dropping gate 1 would hand files
 * to an admin the estate has revoked; dropping gate 2 would make this route a
 * duplicate of the viewer's byte stream with a worse `Content-Disposition`.
 *
 * ⚠️ **The order matters for what a person is TOLD.** The estate gate runs
 * first, so somebody who is not signed in, not approved, revoked, or without
 * the shelf grant hears about THAT — never "you need to be an admin", which
 * would send them asking for a promotion when what they actually lack is the
 * shelf. Only a caller who could already read the book in the viewer is ever
 * told they cannot download it.
 *
 * ⚠️ **An unresolvable rung is an OUTAGE, not a refusal.** `resolveLadderRole`
 * answers `null` for "the role store did not answer" as well as for "no uid",
 * and ebook-gate.ts is explicit that a silent `false` meaning both is the
 * indistinguishable failure the estate's rules forbid. So `null` here is a
 * worded 502 that says the check could not be MADE — never a 403 that says the
 * caller was weighed and found wanting. Mislabelling an outage as a permission
 * failure sends people asking for access they may already hold (§1e).
 *
 * ## The three laws of `ebook-file.ts` still apply, minus one
 *
 * 1. ⚠️ **NEVER buffer** — `R2ObjectBody.body` straight through. The corpus
 *    contains files past the 128 MiB isolate limit; `arrayBuffer()` here is an
 *    OOM, not a slow request.
 * 2. ⚠️ **NEVER cacheable** — the edge cache is keyed on URL and knows nothing
 *    about an `Authorization` header, so an authenticated response left
 *    cacheable IS a public download endpoint. `private, max-age=0, no-store`
 *    plus `Vary: Authorization` on every answer, refusals included. This
 *    matters MORE here than on the viewer's route: the thing being cached
 *    would be a whole DRM-stripped file.
 * 3. ⚠️ **NEVER a URL that works on its own** — the credential is a bearer
 *    header, there is no signed URL, and a copied link is a 401.
 *
 * The one law that does NOT carry over is `Accept-Ranges: bytes`. This route
 * does not serve ranges and therefore does not advertise them: pdf.js and
 * foliate-js decide how to fetch from that header, and claiming range support
 * we do not honour would be a worse bug than not having it. ⚠️ **The
 * consequence is stated rather than hidden: a download that drops restarts
 * from zero.** For the 168-file corpus (mean ~11 MB) that is a non-event;
 * if it ever stops being one, add ranges HERE — never by pointing a download
 * button at the viewer's route, which is deliberately `inline`.
 *
 * ## No budget charge, deliberately
 *
 * `read-budget.ts` exists to price *"a household member scripting all 168
 * books"* — someone who holds `vis_ebooks` and no rung. This route floors at
 * `admin`, a rung granted only by the owner's own promotion, so the population
 * it could rate-limit is the population that administers the site. Worse,
 * charging `read-budget` here would let one download eat the same person's
 * page turns in the viewer — precisely the cross-contamination
 * `listen-budget.ts` was split out to prevent. If downloads ever need pacing
 * they get their OWN counter, sized against downloads.
 */

import { Hono } from 'hono';
import { can } from './capabilities.js';
import { resolveEbookAccess, resolveLadderRole } from './ebook-gate.js';
import { ebookIndex, type EbookEntry } from './ebook-manifest.js';
import type { Env } from './env.js';

export const ebookDownloadRoutes = new Hono<{ Bindings: Env }>();

/** Law 2, in one place so the refusals and the bytes cannot drift apart. */
const NO_STORE: Record<string, string> = {
  'Cache-Control': 'private, max-age=0, no-store',
  Vary: 'Authorization',
};

function refuse(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { ...NO_STORE } });
}

/**
 * Put this route's cache posture on a refusal the SHARED gate wrote.
 *
 * ⚠️ Same measured reason as `ebook-file.ts`'s `dress()`: `ebook-gate.ts`
 * writes plain JSON for a route (the shelf) that needs no cache headers, and a
 * refusal naming a person's approval status must never sit in a shared cache.
 * The gate is left alone on purpose — it belongs to four routes now.
 */
function dress(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(NO_STORE)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

ebookDownloadRoutes.get('/api/download/:anchor', async (c) => {
  // 1. The estate gate — identity + `vis_ebooks`. Runs BEFORE anything touches
  //    a bucket, so an unauthenticated caller cannot probe which anchors exist.
  const gate = await resolveEbookAccess(c);
  if (!gate.ok) return dress(gate.response);
  const { access } = gate;

  // 2. The LADDER gate. ⚠️ `null` is "could not resolve", not "insufficient".
  const role = await resolveLadderRole(c.env, access);
  if (role === null) {
    return refuse(
      {
        error: 'role_unresolved',
        detail:
          'Your access to the shelf is fine, but the role store did not answer, so we cannot tell whether you may download files. This is an outage, not a decision about you — try again shortly, and if it keeps happening tell Mitch.',
      },
      502,
    );
  }
  if (!can(role, 'download')) {
    return refuse(
      {
        error: 'no_download_capability',
        // ⚠️ §1e, all three parts: what happened, what it needs (the role
        // NAMED), how to get it. And it says what they CAN still do, because
        // this refusal is only ever read by somebody who already holds the
        // shelf — telling them "no access" would be false.
        detail:
          'You can see this book and read it in the browser, but taking the file away is an admin-only action and your role is "' +
          role +
          '". Nothing is wrong with your account. Ask Mitch if you need the file itself; otherwise open it with Read and it stays on the shelf.',
        needs_role: 'admin',
        your_role: role,
      },
      403,
    );
  }

  const anchor = (c.req.param('anchor') ?? '').trim();
  if (!anchor) {
    return refuse(
      {
        error: 'no_anchor',
        detail:
          'That link does not name a book. Open the book from the shelf and use its Download button, which fills the name in.',
      },
      404,
    );
  }

  // 3. `anchor → path`, a LOOKUP in the gated manifest, never a construction
  //    (ebook-manifest.ts). No client-supplied byte reaches the bucket API.
  const gatedBucket = c.env.EBOOKS_GATED;
  if (!gatedBucket) {
    return refuse(
      {
        error: 'manifest_store_unbound',
        detail:
          'You may download this book, but the shelf’s catalogue is not attached to this Worker, so it cannot look the file up. That is a deployment problem on our side — tell Mitch.',
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
            ? 'You may download this book, but no shelf catalogue has been published yet, so the file cannot be located. The library pipeline writes it three times a day — if this persists, tell Mitch.'
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
    // ⚠️ 404, never 403 — the same rule the viewer's route follows. An anchor
    // that is not on the shelf is a fact about the LINK, and this caller has
    // already cleared both gates, so a permission-shaped refusal here would
    // send an admin asking for access they demonstrably hold (§1e point 5).
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
          'You may download this book, but the store its files live in is not attached to this Worker. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS binding (bucket estate-ebooks) and redeploy',
      },
      503,
    );
  }

  const obj = await files.get(entry.path);
  if (!obj) {
    // ⚠️ THE NAMED GAP, still real: `wrangler r2 object put` refuses anything
    // over 300 MiB, so the 393 MiB White Sand Omnibus is on the shelf and not
    // in the bucket. A person who downloads it must be told the FILE is
    // missing, in words — never a 403 (reads as "you are not allowed", and
    // this caller IS) and never a 500 (reads as "it is broken", sending them
    // nowhere). Phase 4d's reconciler is the instrument that finds the rest.
    return refuse(
      {
        error: 'file_absent',
        detail:
          'This book is on the shelf but its file has not been uploaded yet, so there is nothing to download. That is a gap on our side, not a permission problem — tell Mitch and he can push the file up.',
      },
      404,
    );
  }

  // 5. The stream. ⚠️ `obj.body` STRAIGHT through — law 1.
  //    `obj.size` rather than a second `head()`: the object is already open,
  //    and one read is one Class-B op instead of two.
  return new Response(obj.body as unknown as ReadableStream, {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': contentTypeFor(obj, entry),
      'Content-Disposition': attachmentDisposition(entry.path),
      'Content-Length': String(obj.size),
      ETag: obj.httpEtag,
    },
  });
});

/**
 * The stored `Content-Type` wins; the manifest's `format` is the fallback.
 *
 * ⚠️ Deliberately the SAME rule as the viewer's route rather than a blanket
 * `application/octet-stream`. It is tempting to force octet-stream "because it
 * is a download" — `Content-Disposition: attachment` is already what makes the
 * browser save rather than render, and a correctly typed file is the one the
 * operating system hands to the right reader after it lands.
 */
function contentTypeFor(obj: { httpMetadata?: R2HTTPMetadata }, entry: EbookEntry): string {
  const stored = obj.httpMetadata?.contentType;
  if (stored) return stored;
  if (entry.format === 'pdf') return 'application/pdf';
  if (entry.format === 'epub') return 'application/epub+zip';
  return 'application/octet-stream';
}

/**
 * `attachment` plus a filename, both forms — the one header that makes this
 * route different from the viewer's, which says `inline`.
 *
 * The plain `filename=` is ASCII-safe and quote-escaped; `filename*=` carries
 * the real one (the corpus contains `Brené Brown`, apostrophes and ampersands
 * — measured at ingest). A header with a raw non-ASCII byte or an unescaped
 * quote is a malformed response, which some clients drop entirely — and here
 * "drop" means the download fails rather than a page renders oddly.
 */
export function attachmentDisposition(path: string): string {
  const name = path.split('/').pop() || 'book';
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
