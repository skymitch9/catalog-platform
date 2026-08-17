/**
 * The estate series canon, read from this repo's own `data/` at build time and
 * folded once at module load — same mechanism and same reasoning as
 * universes-data.ts (this Worker is the one consumer that reads the shared
 * data files from home; the two book catalogs materialise copies because a
 * bundler needs a static path across repos).
 *
 * ⚠️ NOTHING HERE WRITES TO THE FILE. The editor is still
 * `node tools/series-canon.mjs add --canonical … --variant … --why …`, which
 * is where a fold's EVIDENCE lands in git. This module only reads.
 *
 * Why the registry consults it at all: the canon is the estate's existing
 * record of series-spelling merges a human already decided, with evidence
 * (three entries as of 2026-08-16 — Ascend Online, Harry Potter, Fae &
 * Alchemy). The registry's confirm queue exists to PRODUCE exactly that kind
 * of decision; re-asking for one already on record would be the queue asking a
 * question it has the answer to. So a canon fold merges, and the alias row it
 * writes carries `decided_how = 'canon'` so the provenance is never lost.
 *
 * ⚠️ The canon's own `normText` (tools/lib/series-canon.mjs) is NOT the fold
 * used here. That one keeps leading articles; the registry's key deliberately
 * strips them (series.ts's header). Folding the canon's spellings through
 * `normaliseTitle` is therefore a WIDENING of what the canon matches, never a
 * narrowing: every pair the canon folds still folds, and a pair the canon
 * lists that the registry's fold already merges on its own is dropped here as
 * redundant rather than stored twice.
 */

import canonDocument from '../../../data/series-canon.json' with { type: 'json' };
import { normaliseTitle } from './fold.js';

/** ⚠️ Bump in lockstep with `schemaVersion` in the data file. */
export const EXPECTED_CANON_SCHEMA_VERSION = 1;

interface SeriesCanonEntry {
  canonical: string;
  variants?: string[];
}

interface SeriesCanonDocument {
  schemaVersion: number;
  entries: SeriesCanonEntry[];
}

const document = canonDocument as unknown as SeriesCanonDocument;

if (document.schemaVersion !== EXPECTED_CANON_SCHEMA_VERSION) {
  throw new Error(
    `data/series-canon.json is schemaVersion ${document.schemaVersion}, this Worker expects ${EXPECTED_CANON_SCHEMA_VERSION}`,
  );
}

/**
 * variant fold → canonical DISPLAY spelling, for the variants whose fold
 * differs from the canonical's. A variant that folds the same as its canonical
 * is left out: the fold already merges it, and an entry here would be a second
 * mechanism for a match that needs none.
 */
export function buildCanonIndex(doc: { entries?: SeriesCanonEntry[] }): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of doc.entries ?? []) {
    if (!entry?.canonical) continue;
    const canonFold = normaliseTitle(entry.canonical);
    if (canonFold === '') continue;
    for (const variant of entry.variants ?? []) {
      const fold = normaliseTitle(variant);
      if (fold === '' || fold === canonFold) continue;
      map.set(fold, entry.canonical);
    }
  }
  return map;
}

export const seriesCanonIndex: ReadonlyMap<string, string> = buildCanonIndex(document);
