/**
 * Visibility — which catalogs a member may SEE (design §4.5).
 *
 * ⚠️ NOT a role system — each app still owns what a person may DO there
 * (§1.2/§1.3 stand). Visibility answers estate-level questions only: index
 * search scope, and later a federated admin view.
 *
 * Pure functions, no D1 — the effective-set rules live here so every route
 * (and every test) computes them one way.
 */

/**
 * The estate's catalogs, in canonical order. Adding one = a new vis_ column
 * (an ADD COLUMN migration — see 0002's header for why flags) + a row here.
 */
export const CATALOGS = ['audiobook', 'library', 'games'] as const;
export type Catalog = (typeof CATALOGS)[number];

/**
 * What the anonymous internet sees: the world-readable catalog, per the
 * estate's recorded posture (the audiobook site declares `public: true`).
 */
export const PUBLIC_CATALOGS: readonly Catalog[] = ['audiobook'];

/** The three flag columns as estate_user stores them. */
export interface VisibilityFlags {
  vis_audiobook: number;
  vis_library: number;
  vis_games: number;
}

export function isCatalog(v: unknown): v is Catalog {
  return typeof v === 'string' && (CATALOGS as readonly string[]).includes(v);
}

/** Canonical form: CATALOGS order, no duplicates. */
export function normalizeVisibility(input: readonly Catalog[]): Catalog[] {
  return CATALOGS.filter((c) => input.includes(c));
}

/** The STORED set — the answer only for the approved (see effectiveVisibility). */
export function storedVisibility(row: VisibilityFlags): Catalog[] {
  const out: Catalog[] = [];
  if (row.vis_audiobook === 1) out.push('audiobook');
  if (row.vis_library === 1) out.push('library');
  if (row.vis_games === 1) out.push('games');
  return out;
}

/** The stored set as the three flag values, for writes. */
export function visibilityToFlags(visibility: readonly Catalog[]): VisibilityFlags {
  return {
    vis_audiobook: visibility.includes('audiobook') ? 1 : 0,
    vis_library: visibility.includes('library') ? 1 : 0,
    vis_games: visibility.includes('games') ? 1 : 0,
  };
}

/**
 * The EFFECTIVE set — what `/seen` answers, already combined with status so
 * consumers apply it as-is and never recompute:
 *
 *   approved → the stored set (all three unless an approver narrowed)
 *   pending  → the public slice {audiobook} — a pending member sees what the
 *              anonymous internet sees, nothing more
 *   revoked  → {} — revocation beats the public slice on the estate's own
 *              surfaces
 *
 * The ANONYMOUS rule (absent/invalid token ⇒ {audiobook}) is the consumer's
 * to implement — no token means no /seen call ever happens (§4.5).
 */
export function effectiveVisibility(
  status: 'pending' | 'approved' | 'revoked',
  row: VisibilityFlags,
): Catalog[] {
  switch (status) {
    case 'approved':
      return storedVisibility(row);
    case 'pending':
      return [...PUBLIC_CATALOGS];
    case 'revoked':
      return [];
  }
}
