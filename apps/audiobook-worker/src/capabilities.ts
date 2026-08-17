/**
 * The audiobook capability matrix — migration design §6, committed in the
 * role-ladder.ts idiom: pure data + pure decisions, no I/O, so every gate
 * this Worker will ever enforce is unit-testable without a service account.
 *
 * The ladder itself is IMPORTED from auth-worker's role-ladder.ts — same
 * repo, one implementation, per the design ("imported directly"). This
 * module adds only what the ladder deliberately does not know: which
 * CAPABILITY each rung holds on THIS site.
 *
 * ## The two axes (ROLES.md keeps them orthogonal on purpose)
 *
 * 1. The estate-wide LADDER (guest < member < contributor < moderator <
 *    admin < owner) — cumulative; `can()` below is a floor check.
 * 2. The per-club "club island": a club doc's `managerUids`. Club managers
 *    hold `operateClub`, `manageClub` and — since the 2026-08-17 CLUB
 *    MANAGER package — `administerClub` ON THEIR OWN CLUB without any
 *    ladder rank. `clubCan()` combines both axes; it is the one function
 *    club-scoped gates route through.
 *
 * ## ⚠️ The 2026-08-17 club-island flip (owner-approved: "Yes I'm good with
 *    your club logic"), and what it did NOT open
 *
 * The 2026-08-16 tightening put webhook AND the manager roster into one
 * `administerClub` capability held by site admins only. The soak then found
 * (catalog-platform `docs/TODO.md`, enforce-blockers item 4) that this makes
 * the whole surface unexercisable and, worse, SELF-BLOCKING: `claimManager`
 * is how one *becomes* a club manager, so an admin floor on it means nobody
 * below admin can ever reach the island at all.
 *
 * The fix splits the one capability in two, because the two fields it
 * guarded are not the same kind of thing:
 *
 *   - `administerClub` — the club's OWN settings, chiefly the Discord
 *     webhook. It is club-scoped power over a club you already run, so the
 *     island holds it: a bound manager may set/clear THEIR club's webhook.
 *   - `claimClub` — writing `managerUids`, the roster itself. Island OFF,
 *     deliberately and permanently: letting a manager write the roster is
 *     PEER-ESCALATION (appointing co-managers), the move ROLES.md outlaws
 *     with "grant only strictly beneath your own role". Claiming an
 *     already-claimed club is moderator+, the override path.
 *     `canClaimManager()` below adds the one narrow open arm: an UNCLAIMED
 *     club is first-come-first-served to any live session.
 *
 * So a club manager gains their own club's settings and gains NO power to
 * choose who else manages it. That is the whole of the flip.
 */

import { roleAtLeast, type LadderRole } from '../../auth-worker/src/role-ladder.js';

export type { LadderRole };

/** Every capability the §6 matrix names for this site. */
export const CAPABILITIES = [
  'read',
  'rate',
  'download',
  'upload',
  'operateClub',
  'manageClub',
  'administerClub',
  'claimClub',
  'removeAnyReview',
  'manageUsers',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * The minimum ladder rung holding each capability — §6's table, one row per
 * capability, cumulative by construction (roleAtLeast).
 *
 *  - `read`/`rate` floor at 'guest': the site is world-readable and rating a
 *    book was never meant to need a granted role. (Phase 5 narrows `rate` to
 *    "signed in", not to 'member' — a token check, not a ladder check, so
 *    the floor here stays 'guest'.)
 *  - `download`/`upload` are Phase 4 surfaces — the floors are committed now
 *    so /api/me can already answer what the UI should render.
 *  - `manageUsers` ('moderator', per GRANT_FLOOR) is enforced by the AUTH
 *    Worker's canGrant(), never here — carried in this map only so the §6
 *    matrix lives whole in one place and /api/me's answer is complete.
 *  - `administerClub` and `claimClub` floor at 'moderator' as of 2026-08-17
 *    (`administerClub` was 'admin'). The rule the owner approved is
 *    "moderators+ keep override everywhere": the club island must never
 *    out-rank the estate ladder, and a bound club manager can be a rankless
 *    guest, so anything the island confers a site moderator must hold too.
 *    ⚠️ `manageClub` is knowingly NOT changed here — it has been island-held
 *    at an admin floor since the matrix was written, so a site moderator
 *    still cannot toggle a claimed club's features. That inversion PREDATES
 *    this build; it is flagged for the owner in catalog-platform's TODO
 *    rather than fixed silently, because lowering it is a real widening.
 */
export const CAPABILITY_FLOORS: Record<Capability, LadderRole> = {
  read: 'guest',
  rate: 'guest',
  download: 'member',
  upload: 'contributor',
  operateClub: 'moderator',
  manageClub: 'admin',
  administerClub: 'moderator',
  claimClub: 'moderator',
  removeAnyReview: 'admin',
  manageUsers: 'moderator',
};

/**
 * The floor for claiming an UNCLAIMED club — first-come-first-served.
 *
 * ⚠️ 'guest' here means "a live verified session, no granted rung required",
 * and that is deliberate. The owner's approval says "any MEMBER may claim an
 * unclaimed club", and `member` is the single most dangerous word in this
 * system (role-ladder.ts spells out the clash): the ladder's `member` RUNG is
 * a granted role almost nobody in this household holds, while an "estate
 * member" is a person approved in the estate directory. Flooring this at the
 * RUNG would deny every ordinary household member and re-create exactly the
 * self-blocking (enforce-blocker 4) this package exists to remove — and it
 * would diverge from `firestore.rules`, which has no way to test the rung and
 * enforces "signed in" instead. The gate that actually matters here is the
 * one alongside: a live token, plus the estate check (revoked → refused).
 *
 * This is still strictly TIGHTER than production today, where an unclaimed
 * club's `managerUids` is writable by anyone at all, signed in or not.
 *
 * If the owner meant the rung, this constant is the one-line change — and the
 * shadow soak measures which population actually claims before any flip.
 */
export const CLAIM_UNCLAIMED_FLOOR: LadderRole = 'guest';

/** Ladder axis only: does `role` hold `capability` site-wide? */
export function can(role: LadderRole, capability: Capability): boolean {
  return roleAtLeast(role, CAPABILITY_FLOORS[capability]);
}

/**
 * The capabilities a rung holds, in CAPABILITIES order — what /api/me
 * answers so the client renders exactly the controls the caller can use
 * (§1e: controls the role cannot use are not rendered).
 */
export function capabilitiesFor(role: LadderRole): Capability[] {
  return CAPABILITIES.filter((cap) => can(role, cap));
}

/**
 * The club-island grant: which capabilities a club's OWN manager holds on
 * that club regardless of ladder rank. `claimClub` is deliberately absent
 * and must stay absent — it is the peer-escalation tier (see the module
 * doc); `administerClub` joined the list on 2026-08-17.
 */
export const CLUB_MANAGER_CAPABILITIES: readonly Capability[] = [
  'operateClub',
  'manageClub',
  'administerClub',
];

/**
 * Both axes combined — the one check club-scoped gates route through:
 * ladder rank grants it everywhere; club managership grants operate/manage
 * on that club only.
 */
export function clubCan(
  role: LadderRole,
  capability: Capability,
  isClubManager: boolean,
): boolean {
  if (can(role, capability)) return true;
  return isClubManager && CLUB_MANAGER_CAPABILITIES.includes(capability);
}

/**
 * May this caller write a club's `managerUids` roster — the "claim" gate?
 *
 * Two arms, and only two:
 *   - the club is UNCLAIMED (no managers at all): first-come-first-served to
 *     any live session (CLAIM_UNCLAIMED_FLOOR). The caller may only ever
 *     stamp their OWN uid — that is enforced by the route and by
 *     firestore.rules' `hasOnly([request.auth.uid])`, not by this floor.
 *   - the club is CLAIMED: `claimClub`, moderator+. The OVERRIDE path — a
 *     bound manager does NOT hold it (peer-escalation), so a second manager
 *     arrives only by a moderator's hand.
 *
 * Deliberately takes no `isClubManager`: managership is not an input here,
 * and adding one would be the escalation this function exists to refuse.
 */
export function canClaimManager(role: LadderRole, clubClaimed: boolean): boolean {
  if (!clubClaimed) return roleAtLeast(role, CLAIM_UNCLAIMED_FLOOR);
  return can(role, 'claimClub');
}
