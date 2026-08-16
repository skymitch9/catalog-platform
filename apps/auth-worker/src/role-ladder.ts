/**
 * The estate role ladder for the AUDIOBOOK site-roles federation
 * (ROLES.md §1 in the audiobook_catalog repo — READ-ONLY reference, local
 * only there on purpose; nothing from it is copied here beyond the shape of
 * the ladder itself, which carries no names or emails).
 *
 * Pure logic only — no Firestore, no D1, no env. site-roles.ts does the I/O
 * (resolving a uid, reading/writing the Firestore doc) and calls into this
 * module for every DECISION: what rank a role holds, whether an actor may
 * grant/revoke a given role, and what the whole ladder looks like for the
 * capability-map endpoint. Keeping the decisions here, pure, is what makes
 * them unit-testable without a service account or a live Firestore.
 *
 * ## The ladder (cumulative — each role includes everything beneath it)
 *
 *   viewer < reader < contributor < moderator < admin < owner
 *
 * - `viewer` is NEVER stored. No `site_roles/{uid}` doc = viewer. It is
 *   still a first-class entry in ROLE_CAPABILITIES below (its permissions
 *   are edited/read in the one place the whole ladder lives), just never a
 *   value the grant API accepts or the Firestore doc ever carries.
 * - `owner` is DB-only. There is no API path and no UI path that can grant,
 *   revoke, or otherwise modify a row at 'owner' — not for an owner, not
 *   for anyone (SITE_ROLES below excludes it from what the grant endpoint
 *   accepts, and canGrant() refuses to touch it even when the ACTOR is
 *   themselves an owner: see the "no path for owner to touch owner" test).
 *   The only way in or out is direct D1/Firestore access.
 * - `club mod` is NOT on this ladder — deliberately. It lives in a club's
 *   own `managerUids` (per-club, orthogonal to the estate-wide ladder) and
 *   this module has no opinion about it.
 *
 * ## The granting rule
 *
 * An actor may grant or revoke a role strictly BENEATH their own — no
 * self-escalation, no peer-promotion. Additionally (ROLES.md's own answer
 * to "can contributor grant reader?" — "no, moderator+"): granting/revoking
 * ANYTHING on this ladder requires holding at least `moderator` yourself.
 * `reader` and `contributor` are cumulative capability tiers, not
 * management tiers — they hold zero grant power, even over roles below
 * them. canGrant() below encodes both halves of the rule in one function.
 */

/** The full ladder, lowest to highest. Index = rank. */
export const ROLE_LADDER = ['viewer', 'reader', 'contributor', 'moderator', 'admin', 'owner'] as const;
export type LadderRole = (typeof ROLE_LADDER)[number];

/**
 * The roles the grant API will ever accept or write to a Firestore
 * `site_roles/{uid}.role` field. Deliberately excludes:
 *   - 'viewer'  — never stored (absence of a doc IS viewer)
 *   - 'owner'   — DB-only, no API path, ever (see module doc)
 * This is what `roleBodySchema` (site-roles.ts) validates the POST body's
 * `role` field against — the vocabulary IS the contract, same as before
 * this ladder existed (site-roles.ts's original header comment).
 */
export const SITE_ROLES = ['reader', 'contributor', 'moderator', 'admin'] as const;
export type SiteRole = (typeof SITE_ROLES)[number];

/** The minimum ladder rank required to grant or revoke ANYTHING here. */
export const GRANT_FLOOR: LadderRole = 'moderator';

export function isLadderRole(x: unknown): x is LadderRole {
  return typeof x === 'string' && (ROLE_LADDER as readonly string[]).includes(x);
}

export function isSiteRole(x: unknown): x is SiteRole {
  return typeof x === 'string' && (SITE_ROLES as readonly string[]).includes(x);
}

/** Rank of a role — higher outranks lower. Throws on an invalid role (a
 * programmer error, never a value that reached here from user input). */
export function roleRank(role: LadderRole): number {
  const i = ROLE_LADDER.indexOf(role);
  if (i === -1) throw new Error(`not a ladder role: ${role}`);
  return i;
}

/** True when `held` is at or above `required` on the ladder — the one
 * comparison every permission check in this system should route through,
 * never a scattered string equality/inequality. */
export function roleAtLeast(held: LadderRole, required: LadderRole): boolean {
  return roleRank(held) >= roleRank(required);
}

/**
 * May `actorRole` grant or revoke `targetRole`?
 *
 * `targetRole` is whichever role is actually at stake for THIS check — the
 * role being newly granted, OR (for a revoke, or for a grant that would
 * also touch an existing holder) the role currently held. The caller
 * (site-roles.ts) runs this once per role that changes hands: the role
 * being removed and, for a grant, the role being added. Running it against
 * the CURRENT role is what makes an 'owner' row untouchable regardless of
 * what new role was requested — see the module doc.
 *
 * Two independent conditions, both must hold:
 *   1. `actorRole` is at least the GRANT_FLOOR (moderator) — reader and
 *      contributor hold no grant power at all, even over roles beneath them.
 *   2. `targetRole` is STRICTLY beneath `actorRole` — no self-escalation, no
 *      peer-promotion. This alone makes 'owner' as a target always refused:
 *      nothing outranks owner, so `roleAtLeast(targetRole, actorRole)` is
 *      true whenever targetRole is 'owner', for every possible actorRole
 *      including 'owner' itself.
 */
export function canGrant(
  actorRole: LadderRole,
  targetRole: LadderRole,
): { ok: true } | { ok: false; reason: string } {
  if (!roleAtLeast(actorRole, GRANT_FLOOR)) {
    return {
      ok: false,
      reason: `${actorRole} holds no grant power on this ladder — moderator or above is required to grant or revoke any role.`,
    };
  }
  if (roleAtLeast(targetRole, actorRole)) {
    return {
      ok: false,
      reason: `${actorRole} may only grant or revoke roles strictly beneath ${actorRole} — ${targetRole} is not (peer-promotion and self-escalation are both refused).`,
    };
  }
  return { ok: true };
}

/**
 * The ladder role an email actually holds, combining the two sources of
 * truth in priority order:
 *   1. OWNER_EMAILS (env, the estate break-glass) — always wins, 'owner',
 *      regardless of any stored Firestore doc. This is deliberate: an
 *      owner's OWN Firestore doc may still literally say role:'admin' (the
 *      value the audiobook site's firestore.rules understands TODAY — see
 *      site-roles.ts's header for why 'owner' is never written there), but
 *      for THIS Worker's grant decisions they are owner regardless.
 *   2. A recognized stored role ('reader'|'contributor'|'moderator'|'admin',
 *      or a stray 'owner' value seeded by hand outside this API — trusted
 *      on READ even though the API itself can never WRITE it).
 *   3. Otherwise 'viewer' — no doc, or a value this ladder doesn't
 *      recognize (never invented, never silently promoted).
 *
 * Pure: `storedRole` is whatever site-roles.ts already read from Firestore
 * (or null), `ownerEmails` is env.ts's `parseOwnerEmails()` output. No I/O
 * here, so this is fully unit-testable — including the two-owner-accounts
 * case (both must resolve to 'owner', not just the first one).
 */
export function effectiveLadderRole(input: {
  email: string;
  ownerEmails: readonly string[];
  storedRole: string | null;
}): LadderRole {
  const email = input.email.trim().toLowerCase();
  if (input.ownerEmails.includes(email)) return 'owner';
  if (isLadderRole(input.storedRole)) return input.storedRole;
  return 'viewer';
}

/** One row of the capability map — the "role tree" the owner asked to see. */
export interface RoleCapability {
  role: LadderRole;
  rank: number;
  /** Never true for 'viewer' (never stored) or 'owner' (DB-only, no API path). */
  apiGrantable: boolean;
  /**
   * Does the audiobook site's firestore.rules (a DIFFERENT repo, read-only
   * reference here, never edited by this Worker) currently enforce this
   * role's extra permissions? Only 'moderator' and 'admin' are true today —
   * 'reader' and 'contributor' are additive/presentation-only until rules
   * are extended (see the doc comment on ROLE_CAPABILITIES below and the
   * limitation called out in site-roles.ts).
   */
  rulesEnforced: boolean;
  /** Human answer to "who may grant this role" — mirrors ROLES.md's table. */
  grantedBy: string;
  summary: string;
}

/**
 * THE authoritative role tree / capability map (owner ask: "see a role tree
 * map"). One definition, everything else — the admin UI's dropdowns, this
 * file's own tests, the /estate/site-roles/tree endpoint — reads FROM this,
 * never re-derives it.
 *
 * ⚠️ KNOWN LIMITATION, stated here AND in site-roles.ts's route comment
 * (per the build brief, loudly, twice): the audiobook site's
 * firestore.rules is a DIFFERENT repo and is NOT edited by this build (it
 * is owner-gated and rules deploys are a separate, deliberate act). Today
 * those rules understand exactly two role strings, 'admin' and
 * 'moderator' — so 'reader' and 'contributor', while fully real in THIS
 * ladder (storable, grantable, visible in the admin UI), grant NOTHING
 * beyond what firestore.rules already allows an unlisted visitor. They are
 * UI/permission-map concepts only until a rules change adds:
 *
 *   - a `reader` clause covering: increased read access to whatever
 *     currently requires no role (if anything is gated at all — most reads
 *     are public today) plus the future Drive-parity 'reader' meaning
 *     (ROLES.md §2, out of scope here);
 *   - a `contributor` clause allowing writes to a new "pending upload" /
 *     contribution collection (nothing in firestore.rules today models an
 *     upload at all — this is new surface, not a relaxed existing rule).
 *
 * Until that rules change ships, granting someone 'reader' or 'contributor'
 * here changes what the ESTATE ADMIN UI shows and what THIS API will let a
 * moderator+ do, but changes NOTHING about what Firestore itself will let
 * that person's client do on the audiobook site.
 */
export const ROLE_CAPABILITIES: readonly RoleCapability[] = [
  {
    role: 'viewer',
    rank: 0,
    apiGrantable: false,
    rulesEnforced: false,
    grantedBy: 'nobody — automatic; every account gets it implicitly (no role row)',
    summary: 'See the site. Nothing else.',
  },
  {
    role: 'reader',
    rank: 1,
    apiGrantable: true,
    rulesEnforced: false,
    grantedBy: 'moderator or above',
    summary:
      '+ download books; view access on the GABI Drive folder; download from the shelf server via book URL. No add/delete. NOT YET rules-enforced — see the limitation note on this module.',
  },
  {
    role: 'contributor',
    rank: 2,
    apiGrantable: true,
    rulesEnforced: false,
    grantedBy: 'moderator or above',
    summary:
      '+ upload files to Drive (and, later, the server). NOT YET rules-enforced — see the limitation note on this module.',
  },
  {
    role: 'moderator',
    rank: 3,
    apiGrantable: true,
    rulesEnforced: true,
    grantedBy: 'admin or above',
    summary: "+ today's moderator powers: club ops, ratings/comment removal.",
  },
  {
    role: 'admin',
    rank: 4,
    apiGrantable: true,
    rulesEnforced: true,
    grantedBy: 'owner only',
    summary: "+ today's admin powers, including site-wide review removal. May NOT create other admins.",
  },
  {
    role: 'owner',
    rank: 5,
    apiGrantable: false,
    rulesEnforced: true,
    grantedBy: 'nobody — DB-only, direct D1/Firestore access, no UI or API path ever',
    summary: 'Everything, on every site.',
  },
] as const;
