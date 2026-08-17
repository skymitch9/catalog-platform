/**
 * POST /api/gate/shadow — the Phase 1 SERVER half (migration design §4):
 * the receiver for the client's fire-and-forget would-deny reports.
 *
 * The worker runs the FULL future gate — verify token → estate check →
 * resolve ladder role → capability + club managerUids — and logs ONE JSON
 * line in the estate shadow vocabulary, ACTING ON NOTHING. `wrangler tail |
 * grep ab_gate_shadow` is the whole read path; nothing is stored in D1 or
 * Firestore, per the design (§4 names logging only, and the flip criterion
 * reads the tail).
 *
 * ## The three iron rules, in order of importance
 *
 * 1. ⚠️ NEVER an error the client would notice — 204 always: mode off,
 *    malformed body, missing token, Firestore down, a bug in this file.
 *    The reporter on the site is called after the real write and must never
 *    be able to alter anything; a non-204 here could only tempt a future
 *    client to care about it.
 * 2. ⚠️ Shadow data must never be droppable by an auth bug — nothing beyond
 *    basic shape is verified before logging. A tokenless report, an unknown
 *    action, a garbage body: each still produces its line (`tokened:false`
 *    IS measurement #2; a malformed report is logged as such).
 * 3. Mode-gated: inert (204, no processing, no logging) unless ESTATE_CHECK
 *    ∈ {shadow, enforce}. Rate-limited QUIETLY beyond a per-isolate budget —
 *    shed reports still get their 204, and the shedding itself is logged
 *    once per window so a flood is visible without becoming a log flood.
 */

import { Hono } from 'hono';
import { resolveIdentity, type EstateStatus } from '@platform/estate-auth';
import { parseServiceAccount, type ServiceAccount } from '@platform/firebase-sa';
import { effectiveLadderRole, type LadderRole } from '../../auth-worker/src/role-ladder.js';
import { can, canClaimManager, clubCan, type Capability } from './capabilities.js';
import { estateCheckMode, parseOwnerEmails, type Env } from './env.js';
import { estateStatusFor } from './estate-status.js';
import { cachedStoredRole, clubCollectionFor, clubManagerState } from './roles.js';

/* ────────────────────────────────────────────────────────────────────────
 * The action vocabulary — §1's "worker" rows plus review create/update
 * (wired to measure Phase 5's tokenless population). The CLIENT half of
 * Phase 1 (a separate later build) follows THIS list; an action it sends
 * that is not here still logs, as `unknown_action` — rule 2 above.
 * ──────────────────────────────────────────────────────────────────────── */

export type GateRule =
  /** The future gate is a capability check (+ the club island where flagged). */
  | { kind: 'capability'; capability: Capability; clubManagerMayHold: boolean }
  /** The future gate is only "a live session exists" (Phase 5's measure). */
  | { kind: 'signedIn' }
  /**
   * The future gate is the CLAIM gate — the one rule whose answer turns on
   * the club's own state rather than the caller's rank alone
   * (capabilities.ts `canClaimManager`). Never club-island-held.
   */
  | { kind: 'claimManager' };

const cap = (capability: Capability, clubManagerMayHold: boolean): GateRule => ({
  kind: 'capability',
  capability,
  clubManagerMayHold,
});

export const ACTION_GATES: Readonly<Record<string, GateRule>> = {
  // reviews (§1 index.html table)
  'review.submit': { kind: 'signedIn' },
  'review.update': { kind: 'signedIn' },
  'review.delete': cap('removeAnyReview', false),
  // Reader content notes, SPLIT 2026-08-17 (owner-approved) after the
  // 2026-08-16 soak audit's blocker 3: one action could not describe both
  // halves of this surface, and a moderator floor on the wrong half denies
  // every member removing their OWN note. Now the floors are separate:
  //   selfDelete — your own note. Member floor: a live session, nothing more.
  //   modDelete  — anyone else's. Moderator floor, site-wide (not a club
  //                surface), so the club island never holds it.
  // firestore.rules enforces the same split today: authorUid == uid, or
  // site_roles moderator+ (audiobook_catalog canDeleteUserWarning()).
  'warning.selfDelete': { kind: 'signedIn' },
  'warning.modDelete': cap('operateClub', false),
  // club management (§1 club.html table)
  'club.updateStructural': cap('manageClub', true),
  'club.delete': cap('manageClub', true),
  'club.setNextMeeting': cap('operateClub', true),
  'club.setMemberRole': cap('operateClub', true),
  'club.removeMember': cap('operateClub', true),
  'club.acceptRequest': cap('operateClub', true),
  'club.rejectRequest': cap('operateClub', true),
  'club.inviteMember': cap('operateClub', true),
  // The CLUB MANAGER package, 2026-08-17 (owner-approved) — the RESTRICTED
  // tier splits, because its two halves were never the same kind of thing
  // (capabilities.ts module doc has the whole argument):
  //   setWebhook/clearWebhook — a club's own settings. administerClub, and
  //     the island now HOLDS it: a bound manager runs their own club's
  //     webhook without site-wide rank. Moderator+ overrides everywhere.
  //   claimManager — writing managerUids, the roster itself. Its OWN rule
  //     (`claimManager`), never island-held: unclaimed is
  //     first-come-first-served to any live session, claimed is moderator+.
  //     An admin floor here is what made the whole surface self-blocking —
  //     claiming is how one BECOMES a manager (soak blocker 4).
  'club.setWebhook': cap('administerClub', true),
  'club.clearWebhook': cap('administerClub', true),
  'club.claimManager': { kind: 'claimManager' },
  // reads + discussion (§1 club-read.html table); the schedule name is the
  // design's own example line ("club.setSchedule")
  'club.setSchedule': cap('operateClub', true),
  'read.finish': cap('manageClub', true),
  'read.remove': cap('manageClub', true),
  'read.setSlot': cap('manageClub', true),
  'read.revealRatings': cap('manageClub', true),
  'poll.create': cap('operateClub', true),
  'poll.setStatus': cap('operateClub', true),
  'poll.delete': cap('operateClub', true),
  'comment.modDelete': cap('operateClub', true),
  'quote.modDelete': cap('operateClub', true),
};

/* ────────────────────────────────────────────────────────────────────────
 * The decision — pure, so every would_deny path is a unit test
 * ──────────────────────────────────────────────────────────────────────── */

export interface GateInput {
  action: string | null;
  /** A VERIFIED identity existed (an invalid token is as tokenless as none). */
  tokened: boolean;
  /** The effective ladder role ('guest' when unresolved/tokenless). */
  role: LadderRole;
  estateStatus: EstateStatus | null;
  clubManager: boolean;
  /**
   * Does the named club already have a manager roster? Only the claim rule
   * reads it, and only an explicit `false` opens the first-come arm —
   * omitted or unknown is treated as CLAIMED (the strict direction; see
   * gateDecision). Every other rule ignores this field entirely.
   */
  clubClaimed?: boolean;
}

export interface GateVerdict {
  /** null = the gate could not be evaluated (unknown action, malformed report). */
  wouldDeny: boolean | null;
  reason: string | null;
}

export function gateDecision(g: GateInput): GateVerdict {
  if (g.action === null) return { wouldDeny: null, reason: 'malformed_report' };
  const rule = ACTION_GATES[g.action];
  if (!rule) return { wouldDeny: null, reason: 'unknown_action' };

  if (!g.tokened) return { wouldDeny: true, reason: 'no_live_session' };
  if (rule.kind === 'signedIn') return { wouldDeny: false, reason: null };

  // The §3 formula: estate revoked → guest — a live refusal even where the
  // Firestore role doc still stands. 'owner' is the one break-glass exception.
  if (g.estateStatus === 'revoked' && g.role !== 'owner') {
    return { wouldDeny: true, reason: 'estate_revoked' };
  }

  if (rule.kind === 'claimManager') {
    // ⚠️ UNKNOWN reads as CLAIMED (only an explicit `false` opens the
    // first-come arm). A claim report that named no club, or whose roster
    // read failed, must never be scored as "that club is free" — that is the
    // one direction where a wrong guess in the soak green-lights a flip that
    // then hands a club away.
    const claimed = g.clubClaimed !== false;
    if (canClaimManager(g.role, claimed)) return { wouldDeny: false, reason: null };
    // Two different denials, kept apart on purpose: the soak must be able to
    // tell "this club is already someone's" from "there is no live session
    // behind this claim" — they need different answers from the site.
    return {
      wouldDeny: true,
      reason: claimed ? 'club_already_claimed' : 'lacks_claim_floor',
    };
  }

  const allowed = rule.clubManagerMayHold
    ? clubCan(g.role, rule.capability, g.clubManager)
    : can(g.role, rule.capability);
  return allowed
    ? { wouldDeny: false, reason: null }
    : { wouldDeny: true, reason: `lacks_${rule.capability}` };
}

/* ────────────────────────────────────────────────────────────────────────
 * The quiet per-isolate rate limit (rule 3)
 * ──────────────────────────────────────────────────────────────────────── */

export const GATE_REPORTS_PER_MINUTE = 240;

let window = { startMs: 0, count: 0, shedLogged: false };

/** Tests only. */
export function resetGateLimiter(): void {
  window = { startMs: 0, count: 0, shedLogged: false };
}

function admitReport(nowMs: number): boolean {
  if (nowMs - window.startMs >= 60_000) {
    window = { startMs: nowMs, count: 0, shedLogged: false };
  }
  window.count += 1;
  if (window.count <= GATE_REPORTS_PER_MINUTE) return true;
  if (!window.shedLogged) {
    window.shedLogged = true;
    console.warn(JSON.stringify({ tag: 'ab_gate_shadow_shed', limit: GATE_REPORTS_PER_MINUTE }));
  }
  return false;
}

/* ────────────────────────────────────────────────────────────────────────
 * The route
 * ──────────────────────────────────────────────────────────────────────── */

export const gateShadowRoutes = new Hono<{ Bindings: Env }>();

gateShadowRoutes.post('/gate/shadow', async (c) => {
  const mode = estateCheckMode(c.env.ESTATE_CHECK);
  // Inert outside shadow/enforce — the OFF answer and the reverse lever
  // (design §5 Phase 1: "mode off — the reporter becomes a 204 no-op").
  if (mode !== 'off' && admitReport(Date.now())) {
    let raw: unknown = null;
    try {
      raw = await c.req.json();
    } catch {
      raw = null; // logged as malformed below — never an error to the client
    }
    try {
      await processReport(c.env, c.req.raw, raw);
    } catch (err) {
      // Rule 1: a bug here must not become a client-visible error — but it
      // must not be silent either, or shadow data vanishes undetectably.
      console.error(
        JSON.stringify({ tag: 'ab_gate_shadow', error: (err as Error).message ?? 'unknown' }),
      );
    }
  }
  return c.body(null, 204);
});

async function processReport(env: Env, req: Request, raw: unknown): Promise<void> {
  const body =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null;
  const action =
    body && typeof body['action'] === 'string' && body['action'].length > 0
      ? body['action'].slice(0, 100)
      : null;
  const lane: 'prod' | 'dev' = body?.['lane'] === 'dev' ? 'dev' : 'prod';
  const clubId =
    body && typeof body['clubId'] === 'string' && body['clubId'].length <= 200
      ? body['clubId']
      : null;
  // The token rides the BODY (sendBeacon cannot set headers); a header is
  // accepted too for clients that can send one.
  const headerToken = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  const token =
    body && typeof body['token'] === 'string' && body['token'].length > 0
      ? body['token']
      : (headerToken ?? null);

  // Verify LOCALLY, exactly as the future gate will. Any failure — expired,
  // wrong project, verifier misconfigured — is a tokenless report here:
  // an unverifiable token protects nothing, so it measures as none.
  let identity = null;
  if (token) {
    try {
      identity = await resolveIdentity(
        new Request('http://gate-shadow.internal/', {
          headers: { authorization: `Bearer ${token}` },
        }),
        env,
      );
    } catch {
      identity = null;
    }
  }

  const email = identity ? identity.email.trim().toLowerCase() : null;
  const ownerEmails = parseOwnerEmails(env.OWNER_EMAILS);

  // Estate check — measurement #3 (§4): the status distribution.
  let estateStatus: EstateStatus | null = null;
  if (identity && email) {
    const estate = await estateStatusFor(env, {
      email,
      firebaseUid: identity.uid,
      displayName: identity.name,
    });
    estateStatus = estate.status;
  }

  // Ladder role via the service account. A missing/broken credential means
  // the full gate cannot be evaluated — logged as such (would_deny null),
  // never guessed in either direction.
  let sa: ServiceAccount | null = null;
  let saProblem: string | null = null;
  try {
    sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if (!sa) saProblem = 'service_account_unset';
  } catch {
    saProblem = 'service_account_malformed';
  }

  let ladderRole: LadderRole | null = null;
  if (identity && email) {
    if (ownerEmails.includes(email)) {
      ladderRole = 'owner'; // break-glass needs no Firestore round-trip
    } else if (sa && identity.uid) {
      const read = await cachedStoredRole(sa, identity.uid);
      if (read.ok) {
        ladderRole = effectiveLadderRole({ email, ownerEmails, storedRole: read.role });
      } else {
        saProblem = `firestore_${read.status}`;
      }
    } else if (sa) {
      // A verified identity with no uid cannot hold a role doc: guest.
      ladderRole = effectiveLadderRole({ email, ownerEmails, storedRole: null });
    }
  }

  // The club island — only consulted when the report names a club and the
  // caller resolved. ONE read answers both halves (roles.ts): whether the
  // club has any manager at all (the claim gate's input) and whether it is
  // this caller. Failures read strict on both.
  let clubManager = false;
  let clubClaimed = false;
  if (sa && identity?.uid && clubId) {
    const state = await clubManagerState(sa, clubCollectionFor(lane), clubId, identity.uid);
    clubManager = state.manager;
    clubClaimed = state.claimed;
  }

  const verdict: GateVerdict =
    identity && ladderRole === null
      ? // Tokened but the role could not be resolved: the gate was NOT run.
        { wouldDeny: null, reason: saProblem ?? 'role_unresolved' }
      : gateDecision({
          action,
          tokened: identity !== null,
          role: ladderRole ?? 'guest',
          estateStatus,
          clubManager,
          clubClaimed,
        });

  // ONE line, the §4 vocabulary (+ the club id the payload carried).
  console.log(
    JSON.stringify({
      tag: 'ab_gate_shadow',
      action,
      lane,
      club: clubId,
      tokened: identity !== null,
      email,
      ladder_role: ladderRole,
      estate: estateStatus,
      club_manager: clubManager,
      club_claimed: clubClaimed,
      would_deny: verdict.wouldDeny,
      reason: verdict.reason,
    }),
  );
}
