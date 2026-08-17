/**
 * GET /api/ebooks/manifest — the household ebook shelf, behind the estate.
 *
 * Owner directive 2026-08-17: *"ebooks should be like the other site where we
 * grant permission to view it. I don't want people scraping my books."*
 * Before this route the shelf's data (`ebooks.json`) was a file in the public
 * Pages deployment AND a file in a PUBLIC GitHub repo, so "gating the page"
 * would have moved a door in front of an open window. The manifest therefore
 * left both: the pipeline now publishes it to a PRIVATE R2 bucket
 * (`ebooks-gated`, no public dev URL, no custom domain) and this is the only
 * way to read it.
 *
 * The gate, in order, each refusal distinct and each one saying how to get in
 * (ROLES.md §1e — never a bare status, never a raw body, never a dead button):
 *
 *   no/invalid token            401 unauthenticated   "sign in"
 *   estate says pending         403 awaiting_approval "ask Mitch to approve"
 *   estate says revoked         403 access_revoked    "your access was removed"
 *   approved, no `ebooks` grant 403 no_ebooks_grant   "ask for the ebook shelf"
 *   approved WITH the grant     200 the manifest
 *
 * ⚠️ SEEING the shelf and DOWNLOADING from it are two capabilities with two
 * different grant mechanisms, and only the first is an estate question:
 *
 *   see the shelf + read in the viewer  →  estate `vis_ebooks` (a checkbox on
 *                                          the admin page's Ebooks row)
 *   take the file away                  →  the LADDER: `download`, floor
 *                                          `admin` (capabilities.ts), granted
 *                                          by PROMOTION, no checkbox anywhere
 *
 * The second replaced a per-person `dl_ebooks` toggle on 2026-08-17, the day
 * after that toggle shipped — owner directive: *"For ebooks I don't want a
 * download check box, I want to use roles we have. Set up the roles to match
 * library."* Download never implies the shelf and the shelf never implies
 * download; this route decides the first and merely REPORTS the second.
 *
 * ⚠️ NOT GATED ON `ESTATE_CHECK`, and that is deliberate rather than an
 * oversight. The mode exists so an EXISTING behaviour can be shadowed before
 * it starts refusing people; this route has no existing behaviour to shadow —
 * it did not exist, and a shelf that serves in shadow mode is simply an
 * ungated shelf. So the estate is consulted unconditionally here, and an
 * UNCONFIGURED estate is a refusal (503), never an invented approval. The
 * mode is still reported in the answer so an operator can see it.
 *
 * ⚠️ `needs_human_cover` rides INSIDE the gate, on purpose. It is metadata
 * about the estate's gaps rather than book content, but it NAMES every file
 * it lists (`{path,title,format,reason}`) — a list of paths is a scrape with
 * fewer steps. It is served whole, with the rest of the manifest, to callers
 * who already hold the shelf, and to nobody else.
 *
 * ⚠️ The bearer is per-request and there is no signed URL anywhere. A copied
 * URL must be a 401, and a presigned URL cannot be revoked mid-session.
 */

import { Hono } from 'hono';
import { can } from './capabilities.js';
import { resolveEbookAccess, resolveLadderRole } from './ebook-gate.js';
import { MANIFEST_KEY } from './ebook-manifest.js';
import { estateCheckMode, type Env } from './env.js';

// Re-exported from their new homes: the gate this route shares with the
// viewer's byte stream (ebook-gate.ts) and the manifest key it shares with the
// anchor index (ebook-manifest.ts). ⚠️ One implementation each — a second copy
// of either is how a shelf and a reader start disagreeing about a book.
export { MANIFEST_KEY };
export { EBOOKS_CATALOG } from './ebook-gate.js';

export const ebookRoutes = new Hono<{ Bindings: Env }>();

ebookRoutes.get('/api/ebooks/manifest', async (c) => {
  const mode = estateCheckMode(c.env.ESTATE_CHECK);

  // 1+2. Identity and the estate's `ebooks` visibility grant — the SHARED
  //       gate (ebook-gate.ts), which the viewer's byte stream asks too, so a
  //       shelf and a reader can never disagree about who is admitted. Every
  //       refusal sentence lives there and is returned unchanged.
  const gate = await resolveEbookAccess(c);
  if (!gate.ok) return gate.response;
  const grant = gate.access.grant;

  // 2b. The DOWNLOAD capability — this site's own LADDER, not the estate.
  //
  // Owner directive 2026-08-17: *"For ebooks I don't want a download check
  // box, I want to use roles we have. Set up the roles to match library."*
  // So the question "may you take the file away" is answered exactly where
  // every other DO-question on this site is answered: the caller's
  // `site_roles/{uid}` rung against capabilities.ts, where `download` floors
  // at `admin`. There is no per-person estate flag any more.
  //
  // ⚠️ Failure to RESOLVE a role is not a 502 here, unlike /api/me. The shelf
  // is the `vis_ebooks` grant and it has already been decided above; a role
  // store outage must not close a shelf the caller is entitled to. It fails
  // CLOSED on the download half only, and says so: `role: null` alongside
  // `can_download: false` is "we could not resolve your rung", which a reader
  // can tell apart from `role: 'member'` — "we resolved it, and it is not
  // enough". A silent false that meant both would be the indistinguishable
  // failure the estate's rules forbid.
  const role = await resolveLadderRole(c.env, gate.access);
  const canDownload = role !== null && can(role, 'download');

  // 3. The bytes, from the private bucket. A missing binding is a
  //    configuration error and a missing object is a pipeline problem — two
  //    different sentences, because the fixes are nothing alike.
  const bucket = c.env.EBOOKS_GATED;
  if (!bucket) {
    return c.json(
      {
        error: 'manifest_store_unbound',
        detail:
          'The shelf is readable to you, but its data store is not attached to this Worker. That is a deployment problem on our side — tell Mitch.',
        fix: 'add the [[r2_buckets]] EBOOKS_GATED binding (bucket ebooks-gated) and redeploy',
      },
      503,
    );
  }

  const obj = await bucket.get(MANIFEST_KEY);
  if (!obj) {
    return c.json(
      {
        error: 'manifest_absent',
        detail:
          'The shelf is readable to you, but no manifest has been published yet. The library pipeline writes it three times a day — if this persists, tell Mitch.',
        fix: 'run scripts/publish_ebooks_manifest.py in audiobook_catalog (sync step 5.8)',
      },
      503,
    );
  }

  let manifest: unknown;
  try {
    manifest = await obj.json();
  } catch {
    return c.json(
      {
        error: 'manifest_unreadable',
        detail:
          'The shelf data could not be read. This is a publishing problem, not a permission one — tell Mitch.',
      },
      502,
    );
  }

  // The manifest verbatim, plus the capability answer the page renders from.
  // ⚠️ `can_download` is reported and NOT enforced here, because there is
  // nothing to download from this route: it serves a list, not a file.
  //
  // ⚠️ AND IT IS NOT THE READER'S GATE EITHER — corrected 2026-08-17 when the
  // viewer's byte stream landed. An earlier draft of this comment told the
  // next agent that the file route "must ask the SAME question this does:
  // `can(role, 'download')`". That was wrong by exactly one capability and
  // would have shipped a viewer nobody below `admin` could use. Reading is the
  // estate's `vis_ebooks` grant (ebook-gate.ts, shared by both routes);
  // `download` gates only taking a whole file away, on a route that does not
  // exist yet. See viewer design §6.x and ebook-file.ts's header.
  //
  // `role` rides alongside so the page can say WHY the button is absent, and
  // so an unresolved rung (null) is distinguishable from an insufficient one.
  return c.json(
    {
      ...(manifest as Record<string, unknown>),
      can_download: canDownload,
      role,
      estate: { mode, status: grant.status, stale: grant.stale },
    },
    200,
    {
      // Never a shared cache: the answer is per-person by construction.
      'Cache-Control': 'private, no-store',
    },
  );
});
