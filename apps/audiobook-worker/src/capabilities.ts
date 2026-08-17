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
 *    hold `operateClub` and `manageClub` ON THEIR OWN CLUB without any
 *    ladder rank — and NEVER `administerClub` (the 2026-08-16 tightening:
 *    webhook + managerUids stay above even a club's own bound host).
 *    `clubCan()` combines both axes; it is the one function club-scoped
 *    gates route through.
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
 */
export const CAPABILITY_FLOORS: Record<Capability, LadderRole> = {
  read: 'guest',
  rate: 'guest',
  download: 'member',
  upload: 'contributor',
  operateClub: 'moderator',
  manageClub: 'admin',
  administerClub: 'admin',
  removeAnyReview: 'admin',
  manageUsers: 'moderator',
};

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
 * that club regardless of ladder rank. `administerClub` is deliberately
 * absent — see the module doc.
 */
export const CLUB_MANAGER_CAPABILITIES: readonly Capability[] = ['operateClub', 'manageClub'];

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
