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
import { resolveIdentity } from '@platform/estate-auth';
import { estateCheckMode, parseOwnerEmails, type Env } from './env.js';
import { estateAnswerFor } from './estate-status.js';

/** The one object key the pipeline writes and this route reads. */
export const MANIFEST_KEY = 'ebooks.json';

/** The catalog name (estate_auth 0008) that admits a person to the shelf. */
export const EBOOKS_CATALOG = 'ebooks';

export const ebookRoutes = new Hono<{ Bindings: Env }>();

ebookRoutes.get('/api/ebooks/manifest', async (c) => {
  const mode = estateCheckMode(c.env.ESTATE_CHECK);

  // 1. Identity, verified LOCALLY (the canonical verifier). A verifier
  //    misconfiguration is OUR 500, never the caller's 401.
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
  }
  if (!identity) {
    return c.json(
      {
        error: 'unauthenticated',
        detail:
          'The ebook shelf is for the household. Sign in with Google to see it — signed-out visitors get no list at all.',
      },
      401,
    );
  }

  const email = identity.email.trim().toLowerCase();
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const isOwner = owners.includes(email);

  // 2. The estate answer — status AND visibility, one answer, one age (§4.5).
  //    ⚠️ The owner short-circuits BEFORE the round-trip, the same break-glass
  //    every consumer honours: the estate being wrong (or down) about its own
  //    owner must never lock the owner out of his own shelf.
  let grant: { visible: boolean; canDownload: boolean; stale: boolean; status: string | null };
  if (isOwner) {
    grant = { visible: true, canDownload: true, stale: false, status: 'approved' };
  } else {
    const answer = await estateAnswerFor(c.env, {
      email,
      firebaseUid: identity.uid,
      displayName: identity.name,
    });

    if (!answer.configured) {
      // Fail CLOSED and say which: "the estate was never wired up" is a
      // different problem from "you were refused", and telling someone to ask
      // for access they may already hold is the mislabelled-outage failure
      // §1e names explicitly.
      return c.json(
        {
          error: 'estate_unconfigured',
          detail:
            'The shelf cannot check who you are right now because its membership directory is not configured. This is a setup problem on our side, not a decision about you — tell Mitch.',
          fix: 'set ESTATE_AUTH_URL and the ESTATE_APP_TOKEN_AUDIOBOOK secret on audiobook-worker',
        },
        503,
      );
    }

    if (answer.status === null) {
      return c.json(
        {
          error: 'estate_unreachable',
          detail:
            'The membership directory did not answer, so the shelf cannot tell whether you may see it. This is an outage, not a permission decision — try again shortly.',
        },
        502,
      );
    }

    if (answer.status === 'pending') {
      return c.json(
        {
          error: 'awaiting_approval',
          detail:
            'You are signed in and in the queue, but nobody has approved you yet. The ebook shelf opens once an approver says so — ask Mitch, and it will be waiting here.',
        },
        403,
      );
    }

    if (answer.status === 'revoked') {
      return c.json(
        {
          error: 'access_revoked',
          detail:
            'Your access to the household sites was removed, so the ebook shelf is closed to this account. If that is a mistake, ask Mitch to restore it.',
        },
        403,
      );
    }

    // Approved. ⚠️ `visibility` null means the directory answered a status
    // without a visibility fact (a pre-§4.5 server, or a garbage field). That
    // is NOT "no restrictions" — it is "we do not know", and this shelf fails
    // closed on not-knowing.
    const visible = (answer.visibility ?? []).includes(EBOOKS_CATALOG);
    if (!visible) {
      return c.json(
        {
          error: 'no_ebooks_grant',
          detail:
            'You are an approved member, but the ebook shelf is a separate grant and you do not hold it yet. Ask Mitch to switch on "Ebooks" for your account and this page will fill in.',
        },
        403,
      );
    }

    grant = {
      visible: true,
      // ⚠️ Two ladders, one meaning of "admin+": the estate's answer already
      // ORs in its own approver rule; this ORs in THIS site's rung. Null (the
      // directory did not say) reads as false — fail closed.
      canDownload: answer.downloadEbooks === true,
      stale: answer.stale,
      status: answer.status,
    };
  }

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
  // nothing to download from this route: it serves a list, not a file. When
  // the reader's file-stream route lands it must make its OWN server-side
  // check — a client that hides a button is not a gate.
  return c.json(
    {
      ...(manifest as Record<string, unknown>),
      can_download: grant.canDownload,
      estate: { mode, status: grant.status, stale: grant.stale },
    },
    200,
    {
      // Never a shared cache: the answer is per-person by construction.
      'Cache-Control': 'private, no-store',
    },
  );
});
