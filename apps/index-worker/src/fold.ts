/**
 * The join-key fold — ported from library_catalog, pinned by fixtures.
 *
 * ⚠️ `normaliseTitle`, `splitAuthors` and `primaryAuthor` are PORTS of
 * `library_catalog/packages/core/src/titles.ts`, character for character in
 * behaviour. They must stay that way: the index's `work_fold` replicates what
 * the library's `work_key` means (`normaliseTitle(title)|normaliseTitle(
 * primaryAuthor(authors))`, the join to ~870 cross-catalog reviews), and a
 * divergent fold here would make "same book" mean two different things in the
 * estate. There is no shared runtime between this Worker and that repo, so
 * there is no shared implementation; `data/match-fold.fixtures.json` is what
 * keeps the two honest — this repo's tests and the library's CI both run every
 * case. Change the fold there and the fixture breaks HERE, loudly, which is
 * the design (index-worker-design.md §6).
 *
 * The refusal wrappers at the bottom are INDEX-ONLY and are wrappers, not a
 * second fold: sources push raw display strings, the index folds once on
 * write, and a fold that comes back empty is stored as NULL — a row that can
 * never match by key. That is the design's answer to the `|samg` production
 * bug (two Korean titles folding to nothing, keyed on author alone): the fix
 * is NOT JOINING, never joining on the author alone.
 */

/**
 * The library's authorless-book sentinel (`@lc/core` UNKNOWN_AUTHOR).
 *
 * ⚠️ Folding it would yield plain 'unknown' — indistinguishable from a real
 * "Author Unknown" credit, which is the exact collision the library's
 * `workKeyFor` bypass exists to prevent. The index's answer is stronger than a
 * bypass: a provisional author is no author, so `creatorFoldOrNull` refuses it
 * outright and the row gets `work_fold = NULL`. A book that does not know its
 * author yet cannot claim to be the same work as anything.
 */
export const UNKNOWN_AUTHOR_SENTINEL = '?unknown';

/**
 * Fold a title down to something comparable. Port of the library's
 * `normaliseTitle` — see the module header before touching a character.
 */
export function normaliseTitle(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // Café -> Cafe
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Split an author field into names. Port of the library's `splitAuthors`:
 * the audiobook catalog's display rule, `- Translator`-type suffixes dropped
 * because a translator is not who wrote it.
 */
export function splitAuthors(raw: string): string[] {
  return raw
    .split(/[;,/&]|\sand\s/i)
    .map((a) => a.replace(/\s*-\s*(Translator|Narrator|Editor)\s*$/i, '').trim())
    .filter(Boolean);
}

/** The name a work is filed under: first listed. Port of the library's `primaryAuthor`. */
export function primaryAuthor(raw: string): string {
  return splitAuthors(raw)[0] ?? raw.trim();
}

/**
 * ⚠️ THE EMPTY-FOLD REFUSAL — index-only, a wrapper and not a second fold.
 *
 * A wholly non-Latin title folds to `''` under `normaliseTitle`. Storing that
 * as a key would make every such row join every other such row; the index
 * stores NULL instead, and the partial indexes in migration 0001 keep NULL
 * rows out of the join indexes entirely. Reachable only via
 * `(source, source_id)` or display-title search — an honest refusal in the
 * house style (`cover_status`, `openEnded`, `'at least N'`).
 */
export function titleFoldOrNull(title: string): string | null {
  const fold = normaliseTitle(title);
  return fold === '' ? null : fold;
}

/**
 * The creator half of `work_fold`, or null. Refuses the `?unknown` sentinel
 * before folding (see UNKNOWN_AUTHOR_SENTINEL) and refuses an empty fold after.
 */
export function creatorFoldOrNull(creator: string | null | undefined): string | null {
  if (creator === null || creator === undefined) return null;
  if (creator.trim() === UNKNOWN_AUTHOR_SENTINEL) return null;
  const fold = normaliseTitle(primaryAuthor(creator));
  return fold === '' ? null : fold;
}

/**
 * The work-tier key: `title_fold|creator_fold` — BOOKS ONLY, and only when
 * both halves survived their folds. Games never call this: a board game is
 * never the same *work* as a book, so games rows carry `work_fold = NULL`
 * permanently (the design refusing to invent an identity games do not have,
 * not a limitation to fix later).
 *
 * The pipe is unambiguous because `normaliseTitle` reduces every
 * non-alphanumeric run to a space — a pipe cannot occur inside either half.
 */
export function workFoldOrNull(titleFold: string | null, creatorFold: string | null): string | null {
  if (titleFold === null || creatorFold === null) return null;
  return `${titleFold}|${creatorFold}`;
}
