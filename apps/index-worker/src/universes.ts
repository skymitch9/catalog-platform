/**
 * The universe lookup — THIRD implementation, fixtures-pinned like the others.
 *
 * ⚠️ The other two are `library_catalog/packages/universes/src/lookup.ts` and
 * `audiobook_catalog/app/core/universes.py`. All three must give the same
 * answer, because all three describe the same books; there is no shared
 * runtime, so there is no shared implementation, and
 * `data/universes.fixtures.json` (this repo's own file — the index Worker is
 * the one consumer that reads it from home) is what keeps them honest. This
 * repo's `test/universes.test.ts` runs every fixture case; so do the other two
 * repos' suites.
 *
 * The resolution order is fixed by `_lookup.order` in `data/universes.json`:
 * (1) exclusion match → no universe, stop; (2) override title match; (3)
 * series match; (4) nothing. Exclusions first so the answer never depends on
 * which rule fires — The Frugal Wizard’s Handbook sits beside titles that
 * would otherwise sweep it in.
 *
 * ⚠️ `normaliseUniverseText` is NOT the join-key fold in `fold.ts` and they
 * are not interchangeable. This one keeps leading articles ("The Cosmere" and
 * "Cosmere" are deliberately different strings in the data file), folds curly
 * apostrophes, and writes nothing. `normaliseTitle` strips articles and
 * produces STORED keys. Reusing either for the other's job is a bug — the
 * library documents the same split.
 *
 * Resolved ON WRITE (design §9 Q2, accepted): a `universes.json` edit
 * propagates on the next push, and every source pushes at least daily once
 * wired. The file changes "maybe monthly".
 */

export interface UniverseBook {
  title: string;
  why: string;
  series?: string;
  volume?: number;
}

export interface Universe {
  name: string;
  decidedHow: 'seed' | 'llm' | 'human';
  series?: string[];
  notSeries?: string[];
  bookOverrides?: UniverseBook[];
  bookExclusions?: UniverseBook[];
  penNames?: string[];
  notes?: string;
  confirmed?: string;
  evidence?: string;
}

export interface UniversesDocument {
  schemaVersion: number;
  universes: Universe[];
  canonicalNames: Record<string, string>;
}

export interface UniverseIndex {
  readonly series: ReadonlyMap<string, string>;
  readonly overrideTitles: ReadonlyMap<string, string>;
  readonly excludedTitles: ReadonlyMap<string, string>;
  readonly canonicalNames: ReadonlyMap<string, string>;
  readonly names: readonly string[];
}

/** Lowercase, fold curly quotes to straight, collapse whitespace, trim. Compares; never stores. */
export function normaliseUniverseText(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Six universes and ~50 keys — a few Maps, built once at module load. */
export function buildUniverseIndex(doc: UniversesDocument): UniverseIndex {
  const series = new Map<string, string>();
  const overrideTitles = new Map<string, string>();
  const excludedTitles = new Map<string, string>();
  const canonicalNames = new Map<string, string>();

  for (const u of doc.universes ?? []) {
    for (const s of u.series ?? []) series.set(normaliseUniverseText(s), u.name);
    for (const b of u.bookOverrides ?? []) overrideTitles.set(normaliseUniverseText(b.title), u.name);
    for (const b of u.bookExclusions ?? []) excludedTitles.set(normaliseUniverseText(b.title), u.name);
  }
  for (const [alias, target] of Object.entries(doc.canonicalNames ?? {})) {
    if (alias.startsWith('_')) continue; // `_note` / `_namespace` are prose
    canonicalNames.set(alias, target);
  }

  return {
    series,
    overrideTitles,
    excludedTitles,
    canonicalNames,
    names: (doc.universes ?? []).map((u) => u.name),
  };
}

export interface UniverseQuery {
  title?: string | null;
  series?: string | null;
}

/**
 * Resolve one row to a universe name, or null. Null is the ordinary answer,
 * not an error — most things are in no universe, and a guess is the one
 * outcome the shared list exists to prevent. Titles match EXACTLY after
 * normalising, never prefix or substring.
 */
export function universeFor(index: UniverseIndex, query: UniverseQuery): string | null {
  const title = normaliseUniverseText(query.title);
  if (title && index.excludedTitles.has(title)) return null;
  if (title) {
    const hit = index.overrideTitles.get(title);
    if (hit !== undefined) return hit;
  }
  const series = normaliseUniverseText(query.series);
  if (series) {
    const hit = index.series.get(series);
    if (hit !== undefined) return hit;
  }
  return null;
}

/**
 * A name a caller typed, folded onto the owner's spelling — or null, meaning
 * "no such universe". The fallback past the alias map exists so a canonical
 * name nobody wrote an alias for still resolves to itself.
 */
export function resolveUniverseName(index: UniverseIndex, asked: string | null | undefined): string | null {
  const wanted = normaliseUniverseText(asked);
  if (!wanted) return null;
  const alias = index.canonicalNames.get(wanted);
  if (alias !== undefined) return alias;
  return index.names.find((n) => normaliseUniverseText(n) === wanted) ?? null;
}
