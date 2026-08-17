/**
 * The Phase 3 enforcement gate (migration design §5 Phase 3, prebuilt while
 * the Phase 1 shadow soaks) — DORMANT BY CONSTRUCTION.
 *
 * ## ⚠️ The dormancy rule, pinned here and in the tests
 *
 * Every write route sits behind `requireEnforceMode`: unless ESTATE_CHECK is
 * exactly 'enforce', the answer is `503 not_enabled` and the request touches
 * NOTHING — no Firestore, no estate call, no token verification. In 'off'
 * and 'shadow' the routes are inert wiring. A route that writes in shadow
 * mode is the failure this gate exists to prevent; the dormancy tests pin it
 * per route, and mutating this gate must make them fail.
 *
 * ## The gate itself IS the shadow gate
 *
 * In enforce mode the decision is `gateDecision` from gate-shadow.ts — the
 * exact function the Phase 1 soak has been logging. That identity is what
 * makes the soak evidence valid: the flip criterion ("zero would_deny lines")
 * guarantees a break-free flip ONLY if enforce refuses precisely what shadow
 * said it would. Nothing here re-derives capability logic.
 *
 * Deliberate consequence, documented rather than hidden: firestore.rules'
 * `!clubClaimed(club)` transition-open arms (canManageClub etc.) are NOT
 * mirrored — the worker gate is the FUTURE gate the shadow measures, so an
 * unclaimed club's manager actions read as would_deny in the soak and would
 * refuse here. That is design-intended: those lines are exactly what the
 * owner reviews (claim the club, grant a role, or waive) before any flip.
 *
 * ⚠️ ONE arm IS now mirrored, since the 2026-08-17 CLUB MANAGER package:
 * `club.claimManager` on an UNCLAIMED club. It had to be — claiming is the
 * only door onto the club island, so a strict gate there is self-blocking
 * (soak enforce-blocker 4) and would make an enforce flip freeze the roster
 * of every club forever at whoever holds it today. The mirror is narrow:
 * unclaimed → any live session may stamp their OWN uid; claimed → moderator+
 * only, never the club's own managers. See capabilities.ts `canClaimManager`.
 *
 * ## Refusals — ROLES.md §1e verbatim, four causes kept distinct
 *
 * Never a bare status: what happened / what it needs / how to get it. Not
 * signed in ≠ revoked ≠ insufficient role ≠ an outage (a Firestore or
 * verifier failure is an OUTAGE answer, never a permission decision).
 */

import type { Context } from 'hono';
import { resolveIdentity, type EstateStatus } from '@platform/estate-auth';
import { mintAccessToken, parseServiceAccount, type ServiceAccount } from '@platform/firebase-sa';
import { effectiveLadderRole, type LadderRole } from '../../auth-worker/src/role-ladder.js';
import { CAPABILITY_FLOORS, CLUB_MANAGER_CAPABILITIES, type Capability } from './capabilities.js';
import { estateCheckMode, parseOwnerEmails, type Env } from './env.js';
import { estateStatusFor } from './estate-status.js';
import { ACTION_GATES, gateDecision } from './gate-shadow.js';
import { laneFrom, type Lane } from './fs-docs.js';
import { identityClass, identityHash } from './pseudonym.js';
import { cachedStoredRole, clubCollectionFor, clubManagerState, SA_SCOPES } from './roles.js';

/** The §1e-worded dormant answer (the brief's exact contract: 503 not_enabled). */
export const NOT_ENABLED = {
  error: 'not_enabled',
  detail:
    'This write route is prebuilt for the enforcement phase of the auth migration, ' +
    'and enforcement has not begun — the site still performs this action directly ' +
    'in your browser, so nothing is missing and nothing was changed. If the site ' +
    'itself sent you here, its rollout flag ran ahead of the worker — tell the owner.',
} as const;

/**
 * The dormancy middleware. Mounted on every Phase 3 write route BEFORE the
 * handler; only ESTATE_CHECK === 'enforce' (parsed affirmatively — a typo
 * reads as 'off') lets a request through to code that can touch Firestore.
 */
export async function requireEnforceMode(
  c: Context<{ Bindings: Env }>,
  next: () => Promise<void>,
): Promise<Response | void> {
  if (estateCheckMode(c.env.ESTATE_CHECK) !== 'enforce') {
    return c.json(NOT_ENABLED, 503);
  }
  await next();
}

/** Everything a handler needs once the gate has passed. */
export interface GateContext {
  email: string;
  uid: string;
  role: LadderRole;
  estateStatus: EstateStatus | null;
  clubManager: boolean;
  lane: Lane;
  sa: ServiceAccount;
  saToken: string;
}

export type GateOutcome = { ok: true; ctx: GateContext } | { ok: false; response: Response };

/** One ab_gate line per gated request — the enforce twin of ab_gate_shadow,
 *  so enforce-mode behaviour lands in the same instrument the soak uses.
 *
 *  ⚠️ Identity rides PSEUDONYMISED (`email_hash` + `identity_class`), for the
 *  same reason its shadow twin does: `[observability]` makes these lines a
 *  RETAINED record, and a household address does not belong in one. Async
 *  only because the digest is — see src/pseudonym.ts. */
async function logGateLine(
  env: Env,
  input: {
    action: string;
    lane: Lane;
    clubId: string | null;
    tokened: boolean;
    email: string | null;
    isOwner: boolean;
    role: LadderRole | null;
    estate: EstateStatus | null;
    clubManager: boolean;
    clubClaimed: boolean;
    denied: boolean;
    reason: string | null;
  },
): Promise<void> {
  console.log(
    JSON.stringify({
      tag: 'ab_gate',
      mode: 'enforce',
      action: input.action,
      lane: input.lane,
      club: input.clubId,
      tokened: input.tokened,
      email_hash: await identityHash(input.email, env.GATE_HASH_SALT),
      identity_class: identityClass({
        tokened: input.tokened,
        isOwner: input.isOwner,
        estateStatus: input.estate,
      }),
      ladder_role: input.role,
      estate: input.estate,
      club_manager: input.clubManager,
      club_claimed: input.clubClaimed,
      denied: input.denied,
      reason: input.reason,
    }),
  );
}

/** The §1e wording for a capability refusal: what it needs + how to get it. */
function capabilityRefusalDetail(capability: Capability, clubScoped: boolean): string {
  const floor = CAPABILITY_FLOORS[capability];
  const clubArm =
    clubScoped && CLUB_MANAGER_CAPABILITIES.includes(capability)
      ? ', or be one of this club’s own managers'
      : '';
  return (
    `This action needs the "${capability}" capability, which the ${floor} role ` +
    `(and above) holds${clubArm}. Your signed-in account does not hold it. ` +
    'To get it, ask the site owner to grant your account that role from the ' +
    'estate admin page.'
  );
}

/**
 * The full future gate, run for real: canonical verifier → estate status →
 * ladder role → gateDecision (capability / clubCan). Answers either a ready
 * GateContext or the finished refusal Response. Callers MUST be mounted
 * behind requireEnforceMode — this function assumes enforce mode and is
 * never reached in off/shadow.
 */
export async function runEnforceGate(
  c: Context<{ Bindings: Env }>,
  action: string,
  clubId: string | null,
): Promise<GateOutcome> {
  const env = c.env;
  const lane = laneFrom(c.req.query('lane'));
  const rule = ACTION_GATES[action];
  if (!rule) {
    // A route naming an action outside the committed vocabulary is a build
    // bug, not a caller problem — refuse loudly, gate nothing silently.
    return {
      ok: false,
      response: c.json(
        { error: 'misconfigured', detail: `route action "${action}" is not in ACTION_GATES` },
        500,
      ),
    };
  }

  // 1. Identity — verified locally. A verifier misconfiguration is OUR 500.
  let identity;
  try {
    identity = await resolveIdentity(c.req.raw, env);
  } catch (err) {
    return {
      ok: false,
      response: c.json({ error: 'misconfigured', detail: (err as Error).message }, 500),
    };
  }
  if (!identity || !identity.uid) {
    await logGateLine(env, {
      action, lane, clubId, tokened: false, email: null, isOwner: false, role: null,
      estate: null, clubManager: false, clubClaimed: false,
      denied: true, reason: 'no_live_session',
    });
    return {
      ok: false,
      response: c.json(
        {
          error: 'unauthenticated',
          detail:
            'You are not signed in. This action is enforced server-side now — sign in ' +
            'with Google on the audiobook site (a legacy passphrase session is not ' +
            'enough) and try again.',
        },
        401,
      ),
    };
  }
  const email = identity.email.trim().toLowerCase();

  // 2. The service account — the write path itself; without it nothing below
  //    can run. Unset/malformed is OUR config problem, never a permission one.
  let sa: ServiceAccount | null;
  try {
    sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    return {
      ok: false,
      response: c.json({ error: 'misconfigured', detail: (err as Error).message }, 500),
    };
  }
  if (!sa) {
    return {
      ok: false,
      response: c.json(
        { error: 'service_account_unset', fix: 'wrangler secret put FIREBASE_SERVICE_ACCOUNT' },
        503,
      ),
    };
  }

  // 3. Ladder role — owners skip the round-trip (break-glass, /api/me idiom);
  //    a role-store outage is an OUTAGE answer, never a silent 'guest'.
  const ownerEmails = parseOwnerEmails(env.OWNER_EMAILS);
  let role: LadderRole;
  if (ownerEmails.includes(email)) {
    role = 'owner';
  } else {
    const read = await cachedStoredRole(sa, identity.uid);
    if (!read.ok) {
      return {
        ok: false,
        response: c.json(
          {
            error: 'firestore_error',
            status: read.status,
            detail:
              'The role store did not answer, so this action cannot be authorized right ' +
              'now. This is an outage, not a permission decision — try again shortly.',
          },
          502,
        ),
      };
    }
    role = effectiveLadderRole({ email, ownerEmails, storedRole: read.role });
  }

  // 4. Estate status — the structural fix for the revoked-admin incident:
  //    even a standing site_roles doc refuses when the household says revoked.
  const estate = await estateStatusFor(env, {
    email,
    firebaseUid: identity.uid,
    displayName: identity.name,
  });

  // 5. The club roster — consulted where the island may hold the capability
  //    (manager?) and for the claim rule (claimed at all?). One read, both
  //    answers, so a claim landing mid-request cannot split them.
  const needsRoster =
    clubId !== null &&
    ((rule.kind === 'capability' && rule.clubManagerMayHold) || rule.kind === 'claimManager');
  const roster = needsRoster
    ? await clubManagerState(sa, clubCollectionFor(lane), clubId as string, identity.uid)
    : { claimed: false, manager: false };
  const clubManager = roster.manager;

  // 6. THE decision — gateDecision, the very function the soak logged.
  const verdict = gateDecision({
    action,
    tokened: true,
    role,
    estateStatus: estate.status,
    clubManager,
    clubClaimed: roster.claimed,
  });
  await logGateLine(env, {
    action, lane, clubId, tokened: true, email, isOwner: ownerEmails.includes(email), role,
    estate: estate.status, clubManager, clubClaimed: roster.claimed,
    denied: verdict.wouldDeny === true,
    reason: verdict.reason,
  });

  if (verdict.wouldDeny) {
    if (verdict.reason === 'estate_revoked') {
      return {
        ok: false,
        response: c.json(
          {
            error: 'estate_revoked',
            detail:
              'Your household access has been revoked, so this action is refused even ' +
              'though your account may still show a site role. If you believe this is ' +
              'a mistake, ask the owner to re-approve you in the estate directory.',
          },
          403,
        ),
      };
    }
    // The claim gate refuses for a reason the capability wording cannot say:
    // the club is already someone's, and the fix is a person, not a role.
    if (verdict.reason === 'club_already_claimed') {
      return {
        ok: false,
        response: c.json(
          {
            error: 'club_already_claimed',
            needs: 'claimClub',
            detail:
              'This club already has at least one manager, so it cannot be claimed ' +
              'again — the first claim is deliberately one-time, and adding a second ' +
              'manager is not something a manager may do for themselves. Ask a site ' +
              'moderator or admin to add your account to this club’s managers.',
          },
          403,
        ),
      };
    }
    if (verdict.reason === 'lacks_claim_floor') {
      return {
        ok: false,
        response: c.json(
          {
            error: 'insufficient_role',
            needs: 'claimClub',
            detail:
              'Claiming an unclaimed club needs a live signed-in session, and yours ' +
              'did not resolve to one the site recognises. Sign in with Google on the ' +
              'audiobook site and try again; if it still refuses, ask the site owner ' +
              'to check your estate access.',
          },
          403,
        ),
      };
    }
    const capability = rule.kind === 'capability' ? rule.capability : null;
    return {
      ok: false,
      response: c.json(
        {
          error: 'insufficient_role',
          needs: capability,
          detail: capability
            ? capabilityRefusalDetail(
                capability,
                rule.kind === 'capability' && rule.clubManagerMayHold && clubId !== null,
              )
            : 'This action needs a role your signed-in account does not hold.',
        },
        403,
      ),
    };
  }

  // 7. Gate passed — mint the write credential once for the handler.
  const saToken = await mintAccessToken(sa, SA_SCOPES);
  return {
    ok: true,
    ctx: { email, uid: identity.uid, role, estateStatus: estate.status, clubManager, lane, sa, saToken },
  };
}
