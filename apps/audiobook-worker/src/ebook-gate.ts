/**
 * The ONE ebook gate — extracted 2026-08-17 when the viewer's byte stream
 * (`ebook-file.ts`) became the second route that has to ask exactly the same
 * question as `GET /api/ebooks/manifest` (`ebooks.ts`).
 *
 * ⚠️ THE POINT OF THE EXTRACTION IS THAT THERE IS ONE ANSWER, NOT TWO. A shelf
 * that admits someone the reader refuses (or worse, the reverse) is a
 * split-brain gate, and the estate's rule is explicit: one canonical
 * implementation of anything that makes a decision. Copying this logic into a
 * third route is the failure this module exists to prevent — call it instead.
 *
 * The order, and each refusal distinct and each one saying how to get in
 * (ROLES.md §1e — never a bare status, never a raw body, never a dead button):
 *
 *   no/invalid token            401 unauthenticated   "sign in"
 *   estate not wired up         503 estate_unconfigured  our setup, not you
 *   estate did not answer       502 estate_unreachable   an outage, not a verdict
 *   estate says pending         403 awaiting_approval "ask Mitch to approve"
 *   estate says revoked         403 access_revoked    "your access was removed"
 *   approved, no `ebooks` grant 403 no_ebooks_grant   "ask for the ebook shelf"
 *   approved WITH the grant     → the caller is let through
 *
 * ⚠️ `vis_ebooks` — the estate's `ebooks` visibility catalog — IS THE READ
 * GRANT, and it gates BOTH the shelf and the viewer's bytes. It is emphatically
 * **not** the ladder's `download` capability, whose floor is `admin`
 * (capabilities.ts). Gating the byte stream on `download` would lock every
 * ordinary household member out of READING the books they were granted, which
 * is the exact inversion `library_catalog/docs/info/ebook-viewer-design.md`
 * §6.x was written to stop. Seeing/reading and taking-a-file-away are two
 * capabilities on purpose; this module answers only the first.
 *
 * ⚠️ NOT GATED ON `ESTATE_CHECK`, deliberately — the reasoning is ebooks.ts's
 * and it carries over verbatim: the mode exists so an EXISTING behaviour can be
 * shadowed before it starts refusing people, and neither of these routes had an
 * existing behaviour. A shelf that serves in shadow mode is an ungated shelf,
 * and a byte stream that serves in shadow mode is a public download endpoint.
 */

import type { Context } from 'hono';
import { resolveIdentity } from '@platform/estate-auth';
import { parseServiceAccount } from '@platform/firebase-sa';
import { effectiveLadderRole, type LadderRole } from '../../auth-worker/src/role-ladder.js';
import { parseOwnerEmails, type Env } from './env.js';
import { estateAnswerFor } from './estate-status.js';
import { cachedStoredRole } from './roles.js';

/** The catalog name (estate_auth 0008) that admits a person to the shelf. */
export const EBOOKS_CATALOG = 'ebooks';

export interface EbookAccess {
  /** Verified, trimmed, lowercased — safe as a rate-limit key. */
  email: string;
  /** The Firebase uid, when the token carried one. */
  uid: string | null;
  /** OWNER_EMAILS break-glass: no directory round-trip was made. */
  isOwner: boolean;
  /** The estate answer that let them in, for the response's `estate` block. */
  grant: { visible: true; stale: boolean; status: string | null };
}

export type EbookGateResult =
  | { ok: true; access: EbookAccess }
  /** The finished refusal — return it unchanged; do not re-word it. */
  | { ok: false; response: Response };

type Ctx = Context<{ Bindings: Env }>;

/**
 * Decide whether this request may see ebook data at all.
 *
 * ⚠️ Every `detail` sentence below is load-bearing and is asserted by
 * `test/ebooks.test.ts`. They are the words a person actually reads when they
 * are turned away; changing one changes the product, not just a string.
 */
export async function resolveEbookAccess(c: Ctx): Promise<EbookGateResult> {
  // 1. Identity, verified LOCALLY (the canonical verifier). A verifier
  //    misconfiguration is OUR 500, never the caller's 401.
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, c.env);
  } catch (err) {
    return {
      ok: false,
      response: Response.json({ error: 'misconfigured', detail: (err as Error).message }, { status: 500 }),
    };
  }
  if (!identity) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'unauthenticated',
          detail:
            'The ebook shelf is for the household. Sign in with Google to see it — signed-out visitors get no list at all.',
        },
        { status: 401 },
      ),
    };
  }

  const email = identity.email.trim().toLowerCase();
  const owners = parseOwnerEmails(c.env.OWNER_EMAILS);
  const isOwner = owners.includes(email);

  // 2. The estate answer — status AND visibility, one answer, one age (§4.5).
  //    ⚠️ The owner short-circuits BEFORE the round-trip, the same break-glass
  //    every consumer honours: the estate being wrong (or down) about its own
  //    owner must never lock the owner out of his own shelf.
  if (isOwner) {
    return {
      ok: true,
      access: {
        email,
        uid: identity.uid ?? null,
        isOwner: true,
        grant: { visible: true, stale: false, status: 'approved' },
      },
    };
  }

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
    return {
      ok: false,
      response: Response.json(
        {
          error: 'estate_unconfigured',
          detail:
            'The shelf cannot check who you are right now because its membership directory is not configured. This is a setup problem on our side, not a decision about you — tell Mitch.',
          fix: 'set ESTATE_AUTH_URL and the ESTATE_APP_TOKEN_AUDIOBOOK secret on audiobook-worker',
        },
        { status: 503 },
      ),
    };
  }

  if (answer.status === null) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'estate_unreachable',
          detail:
            'The membership directory did not answer, so the shelf cannot tell whether you may see it. This is an outage, not a permission decision — try again shortly.',
        },
        { status: 502 },
      ),
    };
  }

  if (answer.status === 'pending') {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'awaiting_approval',
          detail:
            'You are signed in and in the queue, but nobody has approved you yet. The ebook shelf opens once an approver says so — ask Mitch, and it will be waiting here.',
        },
        { status: 403 },
      ),
    };
  }

  if (answer.status === 'revoked') {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'access_revoked',
          detail:
            'Your access to the household sites was removed, so the ebook shelf is closed to this account. If that is a mistake, ask Mitch to restore it.',
        },
        { status: 403 },
      ),
    };
  }

  // Approved. ⚠️ `visibility` null means the directory answered a status
  // without a visibility fact (a pre-§4.5 server, or a garbage field). That
  // is NOT "no restrictions" — it is "we do not know", and this shelf fails
  // closed on not-knowing.
  const visible = (answer.visibility ?? []).includes(EBOOKS_CATALOG);
  if (!visible) {
    return {
      ok: false,
      response: Response.json(
        {
          error: 'no_ebooks_grant',
          detail:
            'You are an approved member, but the ebook shelf is a separate grant and you do not hold it yet. Ask Mitch to switch on "Ebooks" for your account and this page will fill in.',
        },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true,
    access: {
      email,
      uid: identity.uid ?? null,
      isOwner: false,
      grant: { visible: true, stale: answer.stale, status: answer.status },
    },
  };
}

/**
 * The caller's LADDER rung — this site's own axis, not the estate's.
 *
 * ⚠️ Used by the manifest route to REPORT `can_download`, and by nothing that
 * serves bytes to a viewer. Reading is `vis_ebooks` (above); `download` floors
 * at `admin` and governs handing over a whole file as an attachment, a surface
 * that does not exist yet. See capabilities.ts's module doc.
 *
 * Failure to resolve a rung is `null`, never a thrown error and never a 502:
 * the shelf is the `vis_ebooks` grant and has already been decided, so a role
 * store outage must not close a shelf the caller is entitled to. `null` means
 * "we could not resolve your rung", which a reader can tell apart from a
 * resolved-but-insufficient one — a silent `false` meaning both would be the
 * indistinguishable failure the estate's rules forbid.
 */
export async function resolveLadderRole(
  env: Env,
  access: EbookAccess,
): Promise<LadderRole | null> {
  if (access.isOwner) return 'owner';
  if (!access.uid) return null;
  const owners = parseOwnerEmails(env.OWNER_EMAILS);
  const sa = (() => {
    try {
      return parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      return null;
    }
  })();
  if (!sa) return null;
  const read = await cachedStoredRole(sa, access.uid);
  if (!read.ok) return null;
  return effectiveLadderRole({ email: access.email, ownerEmails: owners, storedRole: read.role });
}
