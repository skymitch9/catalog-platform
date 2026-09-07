/**
 * `GET /api/ebooks/reconcile` — the ebook **bucket ⇄ manifest** reconciler.
 * Admin+, and ⚠️ **REPORT-ONLY: there is not one write in this file.**
 *
 * ## What it answers, and why it exists
 *
 * The shelf's manifest (`ebooks-gated/ebooks.json`) and the file store
 * (`estate-ebooks`) are published by two different steps of the pipeline, and
 * nothing has ever compared them. The consequences are already live and
 * already named in this Worker's own error text:
 *
 *   - **In the manifest, missing from the bucket.** `wrangler r2 object put`
 *     refuses anything over 300 MiB (measured twice, `--pipe` included), so
 *     the 393 MiB White Sand Omnibus is on the shelf and not in the store.
 *     `ebook-file.ts` and `ebook-download.ts` both carry a worded
 *     `file_absent` 404 for exactly this — which means **today the gap is
 *     discovered one disappointed reader at a time.** This route is the
 *     instrument that finds the rest before anybody opens one.
 *   - **In the bucket, absent from the manifest.** An object nothing lists is
 *     unreachable by construction (`ebook-manifest.ts`: the anchor→key mapping
 *     is a LOOKUP, never a construction), so it is billed storage that no
 *     route can serve — a renamed book's orphan, or an ingest that uploaded
 *     before the manifest was rebuilt.
 *   - **Size disagreements.** The manifest's `size_bytes` is what the pipeline
 *     measured on the local disk; R2's `size` is what actually arrived. A
 *     mismatch is a truncated upload — the failure mode this estate has
 *     already eaten once, when a 430 MB truncated `.m4b` sat in place of an
 *     844 MB book and read as valid until something tried to parse it.
 *
 * ## ⚠️ IT WRITES NOTHING, AND THAT IS THE DESIGN, NOT A FIRST STEP
 *
 * Every plausible "fix" this report could apply is destructive in a way the
 * report is not: deleting an unlisted object destroys the only copy of
 * something whose manifest row may simply not have been rebuilt yet, and
 * re-uploading from R2 is not something a Worker can do at all (the master is
 * a disk in the owner's house, via `scripts/upload_ebooks_r2.py`). The estate
 * already learned this shape on the Drive parity reconciler, whose Drive→role
 * direction is **report-only, forever**, for the same reason: one direction is
 * a machine's job and the other is a person's.
 *
 * ## The gate: admin+, and deliberately NOT a §6 capability
 *
 * This report NAMES every object key in the bucket and every path in the
 * manifest. `ebooks.ts` says the quiet part about exactly this kind of
 * payload: *"a list of paths is a scrape with fewer steps."* So it sits at
 * `admin`, the same floor as `download` — but it asks `roleAtLeast(role,
 * 'admin')` directly rather than borrowing `can(role, 'download')`, because
 * borrowing would tie an operator report's floor to a capability's, and a
 * later change to one would move the other silently. It adds no row to
 * CAPABILITIES either: the §6 matrix names things a PERSON is granted, and
 * nobody is granted "may read an operations report" — they are an admin or
 * they are not.
 *
 * The estate gate (`vis_ebooks`) runs FIRST, as on every other ebook route, so
 * a caller who lacks the shelf hears about the shelf rather than about ranks.
 *
 * ## What it CANNOT check, said out loud
 *
 * ⚠️ **ETags/checksums are not comparable and the report says so rather than
 * omitting the question.** The manifest carries `size_bytes` and no digest of
 * any kind (`build_ebook_manifest.py`'s row shape: path, anchor, filename,
 * format, title, author, source, size_bytes, modified, cover…). Even if it
 * did, an R2 etag is only an MD5 for a single-part upload — multipart objects
 * carry a `-N` suffixed etag that is a digest of digests, so an etag column
 * would disagree with a correct file and look like corruption. Adding a real
 * integrity check means putting a digest in the manifest at ingest time; that
 * is a pipeline change, not a Worker one.
 *
 * ⚠️ **A truncated listing is reported as INCOMPLETE, never as findings.** If
 * the bucket ever outgrows the page ceiling below, "in the manifest, missing
 * from the bucket" would fill with objects that exist and simply were not
 * listed. So the report carries `complete: false` and a caveat, and the reader
 * is told the comparison did not finish rather than handed false positives.
 */

import { Hono } from 'hono';
import { roleAtLeast, type LadderRole } from '../../auth-worker/src/role-ladder.js';
import { resolveEbookAccess, resolveLadderRole } from './ebook-gate.js';
import { ebookIndex, INDEX_TTL_MS, MANIFEST_KEY, type EbookEntry } from './ebook-manifest.js';
import type { Env } from './env.js';

export const ebookReconcileRoutes = new Hono<{ Bindings: Env }>();

/**
 * The floor, named once. ⚠️ Not `CAPABILITY_FLOORS.download` — see the module
 * doc. Moving this is an operator decision, not a side effect of a matrix edit.
 */
export const RECONCILE_FLOOR: LadderRole = 'admin';

/**
 * How many pages of 1,000 keys the listing will walk before giving up.
 *
 * 168 objects today against a 1,079-book ceiling, so ten pages is ~60× the
 * corpus. ⚠️ Bounded rather than `while (truncated)`: an unbounded loop
 * against a paginating API is how one request becomes a bill.
 */
export const MAX_LIST_PAGES = 10;

/** How many rows any one finding list will carry before it is cut. */
export const MAX_ROWS = 500;

interface BucketObject {
  key: string;
  size: number;
  uploaded: string;
}

export interface ListResult {
  objects: Map<string, BucketObject>;
  /** False when the page ceiling was hit — findings are then unsafe. */
  complete: boolean;
  pages: number;
}

/**
 * Walk the whole file bucket. Pure-ish: takes a bucket, returns a map.
 * Exported so the suite can pin pagination without going through the route.
 */
export async function listAllObjects(bucket: R2Bucket): Promise<ListResult> {
  const objects = new Map<string, BucketObject>();
  let cursor: string | undefined;
  let pages = 0;
  for (; pages < MAX_LIST_PAGES; pages += 1) {
    const listed = await bucket.list({ limit: 1000, cursor });
    for (const obj of listed.objects) {
      objects.set(obj.key, {
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded instanceof Date ? obj.uploaded.toISOString() : String(obj.uploaded),
      });
    }
    if (!listed.truncated) return { objects, complete: true, pages: pages + 1 };
    cursor = listed.cursor;
  }
  return { objects, complete: false, pages };
}

export interface ReconcileReport {
  checked_at: string;
  complete: boolean;
  manifest: { key: string; entries: number; may_be_cached_for_seconds: number };
  bucket: { objects: number; pages_listed: number; complete: boolean };
  counts: {
    missing_from_bucket: number;
    unlisted_in_manifest: number;
    size_mismatches: number;
  };
  missing_from_bucket: Array<{ anchor: string; title: string; path: string; manifest_size_bytes: number | null }>;
  unlisted_in_manifest: Array<{ key: string; size_bytes: number; uploaded: string }>;
  size_mismatches: Array<{
    anchor: string;
    path: string;
    manifest_size_bytes: number;
    bucket_size_bytes: number;
    delta_bytes: number;
  }>;
  /** ⚠️ Always null today — see the module doc. Present so the ABSENCE of an
   *  integrity check is visible in the answer rather than merely unmentioned. */
  checksum_mismatches: null;
  /** Every honest qualification on the numbers above, in words. */
  caveats: string[];
  /** ⚠️ Stated in the payload so nobody has to trust a route name. */
  writes_performed: 0;
}

/**
 * The comparison itself — pure, so every rule is testable without a bucket.
 */
export function reconcile(
  manifest: Map<string, EbookEntry>,
  listing: ListResult,
  nowIso: string,
): ReconcileReport {
  const missing: ReconcileReport['missing_from_bucket'] = [];
  const mismatches: ReconcileReport['size_mismatches'] = [];
  const claimed = new Set<string>();

  for (const [anchor, entry] of manifest) {
    claimed.add(entry.path);
    const obj = listing.objects.get(entry.path);
    if (!obj) {
      // ⚠️ Only a finding when the listing FINISHED. On a truncated listing an
      // object can be present and simply unlisted, and reporting it as missing
      // would send somebody re-uploading a file that is already there.
      if (listing.complete && missing.length < MAX_ROWS) {
        missing.push({
          anchor,
          title: entry.title,
          path: entry.path,
          manifest_size_bytes: entry.sizeBytes,
        });
      }
      continue;
    }
    // ⚠️ A null `size_bytes` is "the pipeline did not measure it", which is not
    // a mismatch. Comparing null to a number would report every unmeasured row
    // as corrupt — a report nobody would read twice.
    if (entry.sizeBytes !== null && entry.sizeBytes !== obj.size && mismatches.length < MAX_ROWS) {
      mismatches.push({
        anchor,
        path: entry.path,
        manifest_size_bytes: entry.sizeBytes,
        bucket_size_bytes: obj.size,
        delta_bytes: obj.size - entry.sizeBytes,
      });
    }
  }

  const unlisted: ReconcileReport['unlisted_in_manifest'] = [];
  for (const obj of listing.objects.values()) {
    if (claimed.has(obj.key)) continue;
    // ⚠️ This direction is SAFE on a truncated listing: everything here was
    // actually seen. It is the other direction that infers from absence.
    if (unlisted.length < MAX_ROWS) {
      unlisted.push({ key: obj.key, size_bytes: obj.size, uploaded: obj.uploaded });
    }
  }

  const caveats: string[] = [];
  if (!listing.complete) {
    caveats.push(
      'The bucket listing did not finish (' +
        MAX_LIST_PAGES +
        ' pages of 1,000 keys were walked and more remained), so "missing from the bucket" was NOT computed — an unlisted object is indistinguishable from an absent one. The objects that were seen are still compared for size, and "not in the manifest" is still trustworthy.',
    );
  }
  caveats.push(
    'No checksum comparison is possible: the manifest carries size_bytes and no digest, and an R2 etag is an MD5 only for single-part uploads. A real integrity check needs a digest written at ingest time — a pipeline change, not a Worker one.',
  );
  caveats.push(
    'The manifest side may be up to ' +
      Math.round(INDEX_TTL_MS / 1000) +
      's stale: this reads the same per-isolate cached index the shelf and the reader read, deliberately, so all three agree about which file an anchor names.',
  );
  if (missing.length >= MAX_ROWS || unlisted.length >= MAX_ROWS || mismatches.length >= MAX_ROWS) {
    caveats.push(
      'At least one finding list hit its ' +
        MAX_ROWS +
        '-row cap and was cut. The counts above are also capped, so treat them as "at least this many".',
    );
  }

  return {
    checked_at: nowIso,
    complete: listing.complete,
    manifest: {
      key: MANIFEST_KEY,
      entries: manifest.size,
      may_be_cached_for_seconds: Math.round(INDEX_TTL_MS / 1000),
    },
    bucket: { objects: listing.objects.size, pages_listed: listing.pages, complete: listing.complete },
    counts: {
      missing_from_bucket: missing.length,
      unlisted_in_manifest: unlisted.length,
      size_mismatches: mismatches.length,
    },
    missing_from_bucket: missing,
    unlisted_in_manifest: unlisted,
    size_mismatches: mismatches,
    checksum_mismatches: null,
    caveats,
    writes_performed: 0,
  };
}

ebookReconcileRoutes.get('/api/ebooks/reconcile', async (c) => {
  // 1. The estate gate first — a caller without the shelf hears about the
  //    shelf, never about ranks. Refusals returned unchanged, no-store added.
  const gate = await resolveEbookAccess(c);
  if (!gate.ok) {
    const headers = new Headers(gate.response.headers);
    headers.set('Cache-Control', 'private, no-store');
    return new Response(gate.response.body, { status: gate.response.status, headers });
  }

  // 2. admin+. ⚠️ `null` is an outage, not a verdict — the same distinction
  //    ebook-download.ts makes, for the same reason.
  const role = await resolveLadderRole(c.env, gate.access);
  if (role === null) {
    return c.json(
      {
        error: 'role_unresolved',
        detail:
          'The role store did not answer, so we cannot tell whether you may read this report. This is an outage, not a decision about you — try again shortly.',
      },
      502,
      { 'Cache-Control': 'private, no-store' },
    );
  }
  if (!roleAtLeast(role, RECONCILE_FLOOR)) {
    return c.json(
      {
        error: 'not_admin',
        detail:
          'This is an operations report about the household’s file storage, and it is admin-only — it names every file on the shelf. Your role is "' +
          role +
          '". Nothing is wrong with your account; the shelf and the reader work for you as normal.',
        needs_role: RECONCILE_FLOOR,
        your_role: role,
      },
      403,
      { 'Cache-Control': 'private, no-store' },
    );
  }

  // 3. Both stores. Named refusals, each with its own fix.
  const gatedBucket = c.env.EBOOKS_GATED;
  if (!gatedBucket) {
    return c.json(
      {
        error: 'manifest_store_unbound',
        detail:
          'The shelf’s catalogue is not attached to this Worker, so there is nothing to reconcile against. That is a deployment problem — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS_GATED binding (bucket ebooks-gated) and redeploy',
      },
      503,
      { 'Cache-Control': 'private, no-store' },
    );
  }
  const files = c.env.EBOOKS;
  if (!files) {
    return c.json(
      {
        error: 'file_store_unbound',
        detail:
          'The ebook file store is not attached to this Worker, so its contents cannot be listed. That is a deployment problem — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS binding (bucket estate-ebooks) and redeploy',
      },
      503,
      { 'Cache-Control': 'private, no-store' },
    );
  }

  const idx = await ebookIndex(gatedBucket);
  if (!idx.ok) {
    return c.json(
      {
        error: idx.reason === 'absent' ? 'manifest_absent' : 'manifest_unreadable',
        detail:
          idx.reason === 'absent'
            ? 'No shelf catalogue has been published yet, so there is nothing to reconcile the bucket against. The library pipeline writes it three times a day.'
            : 'The shelf’s catalogue could not be read, so the comparison cannot be made. This is a publishing problem, not a permission one — tell Mitch.',
        ...(idx.reason === 'absent'
          ? { fix: 'run scripts/publish_ebooks_manifest.py in audiobook_catalog (sync step 5.8)' }
          : {}),
      },
      503,
      { 'Cache-Control': 'private, no-store' },
    );
  }

  // 4. The listing. ⚠️ A listing failure is an OUTAGE with its own sentence,
  //    never a report with zero objects — an empty bucket and an unreachable
  //    one would otherwise read identically, and one of them says every book
  //    on the shelf is missing.
  let listing: ListResult;
  try {
    listing = await listAllObjects(files);
  } catch {
    return c.json(
      {
        error: 'listing_failed',
        detail:
          'The file store could not be listed, so no comparison was made. This is an outage, not a finding — nothing is known to be missing. Try again shortly.',
      },
      502,
      { 'Cache-Control': 'private, no-store' },
    );
  }

  return c.json(reconcile(idx.index, listing, new Date().toISOString()), 200, {
    // Per-person by construction and a fresh measurement every time.
    'Cache-Control': 'private, no-store',
  });
});
