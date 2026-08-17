/**
 * Visibility — the consumer's half of design §4.5.
 *
 * The auth Worker computes the EFFECTIVE set (status already combined in) and
 * `/seen` answers it verbatim; a consumer applies it as-is and never
 * recomputes it from `status`. What a consumer DOES need locally:
 *
 *   - the canonical catalog list and order (the answer's array is canonical —
 *     `audiobook, library, games, library2, ebooks` — and so must every cached
 *     copy be; new catalogs append at the END, the existing entries never
 *     move);
 *   - the PUBLIC slice, because the anonymous rule is the consumer's to
 *     implement: an ABSENT or invalid token means no /seen call ever happens,
 *     and §4.5 says that caller sees `{audiobook}`;
 *   - a validating parser, because the answer crosses a network and a cache
 *     and garbage must die at the boundary, not at query time.
 *
 * ⚠️ NOT a role system — visibility answers "which shelves are in the room"
 * on the ESTATE'S surfaces (index search scope); what a person may DO at any
 * shelf stays app-local forever (§1.2/§1.3).
 */

/**
 * The estate's catalogs, in canonical order (mirrors the auth Worker's list).
 * `library2` (0007) is the second library instance — its visibility column
 * defaults to 0 on the directory, so it appears in answers only when a
 * person was deliberately granted it (or for OWNER_EMAILS, computed).
 * `ebooks` (0008) is the household's shared ebook shelf and follows the same
 * DEFAULT 0 rule — and it is NOT in PUBLIC_CATALOGS, deliberately: the owner
 * directive behind it ("I don't want people scraping my books") means an
 * anonymous or pending caller must never hold it. ⚠️ That grant INCLUDES
 * reading a book in the browser; only DOWNLOAD separates, and download is not
 * a catalog — it rides `download_ebooks` on the /seen and /me answers.
 */
export const CATALOGS = ['audiobook', 'library', 'games', 'library2', 'ebooks'] as const;
export type Catalog = (typeof CATALOGS)[number];

/**
 * What the anonymous internet sees: the world-readable catalog, per the
 * estate's recorded posture (the audiobook surface declares `public: true`).
 * Also the fail-closed answer when no better one exists (§4.5: "fail closed
 * to the public slice, never open").
 */
export const PUBLIC_CATALOGS: readonly Catalog[] = ['audiobook'];

export function isCatalog(v: unknown): v is Catalog {
  return typeof v === 'string' && (CATALOGS as readonly string[]).includes(v);
}

/** Canonical form: CATALOGS order, no duplicates. */
export function normalizeVisibility(input: readonly Catalog[]): Catalog[] {
  return CATALOGS.filter((c) => input.includes(c));
}

/**
 * Parse an untrusted visibility value (a /seen body field, a cached JSON
 * string's parse) into the canonical array, or null when it is not a clean
 * array of known catalog names. Null means "no usable visibility fact" —
 * callers fall back per §4.5, they do not guess.
 */
export function parseVisibility(v: unknown): Catalog[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every(isCatalog)) return null;
  return normalizeVisibility(v);
}
