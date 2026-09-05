import type { MiddlewareHandler } from 'hono';
import { resolveIdentity } from '@platform/estate-auth';
import type { AppBindings, EstateUserRow } from '../env.js';
import { parseOwnerEmails } from '../env.js';
import { getUserByEmail, materializeOwnerRow } from '../estate-db.js';

/**
 * The admin gate: a verified Firebase ID token (the same canonical verifier
 * every consumer uses — this Worker eats its own dog food, design §4.4)
 * PLUS `is_approver` on the directory row or membership of `OWNER_EMAILS`.
 *
 * ⚠️ No first-sign-in-claims bootstrap, deliberately unlike the apps
 * (design §4.3): an empty table admits NOBODY except `OWNER_EMAILS`. The
 * way in never depends on the thing being changed.
 */
/**
 * The devops gate (0003, owner order 2026-08-15): a verified Firebase ID
 * token PLUS `is_devops` OR `is_approver` on the directory row, or
 * membership of `OWNER_EMAILS`. Approvers qualify implicitly — the devops
 * flag exists to let someone read runbooks and drive the status page's
 * Operations WITHOUT holding the directory's keys, never to fence approvers
 * out. Gates: GET /api/estate/docs/:slug, POST /api/estate/ops/pipeline.
 * Same no-bootstrap stance as requireApprover: an empty table admits nobody
 * but OWNER_EMAILS. ⚠️ Requires status 'approved' when the answer comes from
 * the row: a revoked person's leftover flag must not keep a door open.
 */
/**
 * The two gate decisions, extracted as PURE predicates 2026-08-16 — and the
 * extraction is the point, not tidiness.
 *
 * ⚠️ These lived inline inside the middleware closures, where nothing could
 * reach them, and a mutation audit proved the consequence: `requireDevops()`
 * was rewritten to admit anyone not banned and **the whole 126-test suite
 * still passed**. A gate with no test is a gate that silently opens.
 *
 * ⚠️ Extracting them immediately exposed a REAL, LIVE privilege-retention
 * bug in the approver gate, which is why they are now written side by side:
 * `requireDevops` required `status === 'approved'`, and `requireApprover` —
 * the strictly MORE powerful gate, the one that grants and revokes everyone
 * else — checked only `is_approver` with no status check at all. Revoking
 * someone (`decideStatus`) sets `status = 'revoked'` and deliberately leaves
 * `is_approver` alone, so a revoked approver kept passing the approver gate
 * and could re-approve themselves. The newer gate got the check; the older
 * and more dangerous one never did.
 *
 * Both now answer the same question the same way: **owner always, otherwise
 * an APPROVED row carrying the right flag.** Keep them adjacent, and keep
 * them pure — a security decision that cannot be called from a test will not
 * be tested.
 *
 * Defence in depth still owed (filed on the platform TODO): revocation should
 * ALSO clear `is_approver` / `is_devops`, so the flag never outlives the
 * status. That is a data change and a migration; this is the gate fix, and
 * the gate is what actually admits people.
 */
export function approverAllows(row: EstateUserRow | null, isOwner: boolean): boolean {
  if (isOwner) return true;
  return row?.status === 'approved' && row.is_approver === 1;
}

export function devopsAllows(row: EstateUserRow | null, isOwner: boolean): boolean {
  if (isOwner) return true;
  // Approvers qualify implicitly: the devops flag exists to let someone read
  // runbooks without holding the directory's keys, never to fence approvers out.
  return row?.status === 'approved' && (row.is_devops === 1 || row.is_approver === 1);
}

/**
 * DEV-LANE ACCESS (0011, owner 2026-08-17: *"a way in the estate to manage dev
 * access for ebook, add a button for give dev access also make devops always
 * able to see dev envs"*). The third predicate, deliberately written here
 * rather than in me.ts or estate.ts, because the header above is the whole
 * argument: a capability decision that is not in this file has already
 * drifted from the two beside it.
 *
 * ⚠️ THE OR IS THE OWNER'S SECOND SENTENCE, COMPUTED AND NEVER STORED. A
 * devops row answers `true` with `dev_access = 0`, so removing devops removes
 * the implied dev access in the same act — the failure mode 0009's per-person
 * download grant had, and 0006 ("revoke clears powers") exists to prevent.
 * `is_approver` rides in for 0003's own reason: approvers hold every devops
 * surface implicitly and are never fenced out of one.
 *
 * ⚠️ `status === 'approved'` is required, matching devopsAllows() — a revoked
 * person's leftover flag must not keep a door open. (decideStatus() clears the
 * stored flag at revocation too; two independent barriers, as ever.)
 *
 * ⚠️ CURTAIN, NOT LOCK. Nothing in THIS Worker is gated on this predicate —
 * it is an ANSWER (/me, /seen, the admin listing), consumed by the /dev/ lane's
 * pages to decide whether to draw themselves or a worded curtain. The ebook
 * bytes are locked by `vis_ebooks` (0008) in apps/audiobook-worker, on both
 * lanes, and must stay that way.
 */
export function devAccessAllows(row: EstateUserRow | null, isOwner: boolean): boolean {
  if (isOwner) return true;
  return row?.status === 'approved' && (row.dev_access === 1 || devopsAllows(row, false));
}

/**
 * THE MEMBER PREDICATE (2026-09-02, the "+ add a verse" build — design
 * docs/info/universe-add-verse-design.md §3.1). The widest of the four, and it
 * lives here for the header's stated reason: a capability decision written
 * anywhere else has already drifted from the three above it.
 *
 * ⚠️ IT IS DELIBERATELY WIDER THAN `approverAllows`, AND THAT IS THE DESIGN'S
 * ARGUMENT, NOT AN OVERSIGHT. Requesting a universe spends nothing, writes one
 * row and grants nobody anything; the access-INCREASING step — the one that
 * actually changes the estate — is APPROVAL, which stays on `requireApprover()`.
 * Gating the request behind approver would leave the owner talking to himself.
 *
 * ⚠️ `status === 'approved'` is the whole test. A `pending` person is not a
 * member yet and a `revoked` one stopped being one; neither may write to a
 * queue an approver has to read. The two get DIFFERENT wording at the door
 * (`requireApprovedMember` below), because "wait" and "ask the owner" are
 * different instructions.
 */
export function memberAllows(row: EstateUserRow | null, isOwner: boolean): boolean {
  if (isOwner) return true;
  return row?.status === 'approved';
}

/**
 * The member gate: a verified Firebase ID token PLUS an APPROVED directory row
 * (or OWNER_EMAILS). Same no-bootstrap stance as its neighbours — an empty
 * table admits nobody but the owner.
 *
 * ⚠️ FOUR CAUSES, FOUR SENTENCES. The estate's standing rule is that a person
 * never meets a bare status: not signed in / no record yet / awaiting approval /
 * revoked have four different fixes, and a single "forbidden" would send three
 * of those four people to the wrong place. The `error` CODES are the ones every
 * page already branches on (`unauthenticated`, `estate_pending`,
 * `estate_revoked`), so no consumer needs a new vocabulary.
 */
export function requireApprovedMember(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }
    if (!identity)
      return c.json(
        {
          error: 'unauthenticated',
          detail: 'You are not signed in. Sign in with your estate account and try again.',
        },
        401,
      );

    const email = identity.email.trim().toLowerCase();
    const ownerEmails = parseOwnerEmails(c.env.OWNER_EMAILS);
    const isOwner = ownerEmails.includes(email);

    let row: EstateUserRow | null = await getUserByEmail(c.env.DB, email);

    if (!memberAllows(row, isOwner)) {
      if (!row) {
        return c.json(
          {
            error: 'estate_unknown',
            detail:
              'The estate directory has no record of this account yet. Open heygabi.ai once while ' +
              'signed in — that enrols you — and the owner will see your name waiting on /admin.',
          },
          403,
        );
      }
      if (row.status === 'revoked') {
        return c.json(
          { error: 'estate_revoked', detail: 'Your estate access was revoked. Ask the owner.' },
          403,
        );
      }
      return c.json(
        {
          error: 'estate_pending',
          detail:
            'Your estate membership is still awaiting approval, so this is closed for now. ' +
            'The owner sees your name on /admin; there is nothing more for you to do.',
        },
        403,
      );
    }

    // An OWNER_EMAILS actor may have no row yet (fresh directory, or the
    // break-glass path). Materialize one so `requested_by` has an id to stamp —
    // the same reasoning requireApprover() gives for `decided_by`.
    if (!row) {
      row = await materializeOwnerRow(c.env.DB, {
        email,
        firebaseUid: identity.uid,
        displayName: identity.name,
      });
    }

    c.set('actor', row);
    await next();
  };
}

export function requireDevops(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }
    // ⚠️ The `error` CODE stays exactly `unauthenticated` — tools/estate-probes
    // asserts it across this Worker's whole unauthenticated edge, and every
    // page's failure wording branches on it. The `detail` is ADDITIVE
    // (2026-08-18) and exists because the estate's standing rule is that a
    // person never meets a bare status: the four causes (not signed in /
    // awaiting approval / insufficient role / revoked) have four different
    // fixes, and this line is the first of them said out loud.
    if (!identity)
      return c.json(
        {
          error: 'unauthenticated',
          detail: 'You are not signed in. Sign in with your estate account and try again.',
        },
        401,
      );

    const email = identity.email.trim().toLowerCase();
    const ownerEmails = parseOwnerEmails(c.env.OWNER_EMAILS);
    const isOwner = ownerEmails.includes(email);

    let row: EstateUserRow | null = await getUserByEmail(c.env.DB, email);

    if (!devopsAllows(row, isOwner)) {
      return c.json(
        { error: 'forbidden', detail: 'This surface is for the estate’s devops and admins.' },
        403,
      );
    }

    if (!row) {
      row = await materializeOwnerRow(c.env.DB, {
        email,
        firebaseUid: identity.uid,
        displayName: identity.name,
      });
    }

    c.set('actor', row);
    await next();
  };
}

export function requireApprover(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    let identity;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }
    // ⚠️ The `error` CODE stays exactly `unauthenticated` (same reasoning as
    // requireDevops() above: tools/estate-probes asserts it across this
    // Worker's whole unauthenticated edge and every page's failure wording
    // branches on it). The `detail` is ADDITIVE (2026-09-05) and exists because
    // a PERSON meets this one, on /admin: a bare status told them nothing.
    // Three clauses — what happened, what it needs, how to get it — and it
    // stays the "not signed in" cause, distinct from the `forbidden` sentence
    // below that a signed-in non-approver gets.
    if (!identity)
      return c.json(
        {
          error: 'unauthenticated',
          detail:
            'You are not signed in, and this is an approver-only surface. Sign in with your ' +
            'estate account at https://heygabi.ai — and if approving is still not open to you ' +
            'afterwards, ask the owner to make you an approver on https://heygabi.ai/admin/.',
        },
        401,
      );

    const email = identity.email.trim().toLowerCase();
    const ownerEmails = parseOwnerEmails(c.env.OWNER_EMAILS);
    const isOwner = ownerEmails.includes(email);

    let row: EstateUserRow | null = await getUserByEmail(c.env.DB, email);

    // ⚠️ approverAllows(), not `!row?.is_approver` — the old check ignored
    // status entirely, so a REVOKED approver kept passing this gate.
    if (!approverAllows(row, isOwner)) {
      return c.json(
        {
          error: 'forbidden',
          detail: 'Approving estate members requires an approver account.',
        },
        403,
      );
    }

    // An OWNER_EMAILS actor may have no row yet (fresh directory, or the
    // break-glass path during an incident). Materialize one so decided_by
    // has an id to stamp — the bootstrap becoming a fact in the table.
    if (!row) {
      row = await materializeOwnerRow(c.env.DB, {
        email,
        firebaseUid: identity.uid,
        displayName: identity.name,
      });
    }

    c.set('actor', row);
    await next();
  };
}
