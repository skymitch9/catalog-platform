/**
 * The ranked human search — pure functions, no I/O. Route in read.ts.
 *
 * ⚠️ THE "NO SECOND MATCHER" CARVE-OUT (design §8), stated where it is used:
 * §8's rule — "the index does exact fold-joins only; fuzzy matching stays in
 * the catalogs' own matching.ts" — exists so the estate never grows a second
 * IDENTITY matcher: a second similarity function whose thresholds could
 * disagree with the catalogs' about what is the same work, feeding an
 * auto-acting join. THIS MODULE IS NOT THAT. It is a ranked partial-match
 * search for a human typing into a box: it claims "these rows resemble what
 * you typed, in this order", never "these rows ARE the thing you typed".
 * Nothing machine-actionable hangs off a search result (design §3.3's own
 * test), no threshold here gates a write anywhere, and `/api/lookup` remains
 * the exact-identity endpoint, untouched, for anything that needs a key
 * claim. If a future caller starts treating search order as identity, that
 * caller is the bug — point it at /api/lookup.
 *
 * Ranking, as implemented (tier within field, field below field):
 *   tier   exact fold match  >  fold prefix  >  all-tokens-prefix  >  substring
 *   field  title  >  creator  >  series
 * scored as TIER + FIELD so an exact creator match outranks a mere title
 * prefix (searching an author's name in full should find their books first),
 * while any title tier beats the same tier on creator or series.
 *
 * Unfoldable titles (the Korean rows, title_fold NULL) are reachable here by
 * RAW display-title substring — design §3.1 names "display-title search" as
 * exactly how a NULL-fold row is allowed to be found. The refusal was about
 * KEY joins, not about being findable by a human.
 */

import { normaliseTitle, UNKNOWN_AUTHOR_SENTINEL } from './fold.js';
import type { UniverseIndex } from './universes.js';
import { resolveUniverseName } from './universes.js';

/** The columns the search reads — EntryRow minus nothing; it is all display data. */
export interface SearchRow {
  source: string;
  source_id: string;
  title: string;
  creator: string | null;
  title_fold: string | null;
  work_fold: string | null;
  universe: string | null;
  series: string | null;
  /**
   * The series registry key (migration 0004). Optional on the type so every
   * existing SearchRow constructor keeps compiling; present on the wire
   * because a search hit is exactly where a reader wants to jump to the whole
   * series — and a client holding only the display name would have to fold it
   * ITSELF to build that link, which is the second normaliser this estate
   * keeps refusing to grow.
   */
  series_slug?: string | null;
  series_index: number | null;
  year: number | null;
  publisher: string | null;
  format: string;
  kind: string | null;
  parent_source_id: string | null;
  cover_url: string | null;
  detail_url: string | null;
}

export type MatchTier = 'exact' | 'prefix' | 'tokens' | 'substring';
export type MatchField = 'title' | 'creator' | 'series';
/** e.g. 'title-exact', 'creator-tokens' — the honesty channel, matched_via-style. */
export type MatchReason = `${MatchField}-${MatchTier}`;

const TIER_SCORE: Record<MatchTier, number> = { exact: 400, prefix: 300, tokens: 200, substring: 100 };
const FIELD_SCORE: Record<MatchField, number> = { title: 50, creator: 20, series: 10 };

export interface ScoredRow {
  row: SearchRow;
  score: number;
  reason: MatchReason;
}

/** One same-work group on the books tier (design §3.1): every format of one work. */
export interface BookHit {
  title: string;
  creator: string | null;
  score: number;
  reason: MatchReason;
  entries: SearchRow[];
}

export interface GameHit extends SearchRow {
  score: number;
  reason: MatchReason;
}

export interface UniverseHit {
  name: string;
  count: number;
}

export interface SearchResults {
  books: BookHit[];
  games: GameHit[];
  /** Universe NAMES the query matched — their own group (design §3.2's tier),
   * counts only; the rows live behind /api/universe/:name. */
  universes: UniverseHit[];
  /**
   * MEMBER-IMPLIED UNIVERSE AUTOFILL (owner: "if I search mistborn have it
   * show cosmere as the search autofill") — additive to `universes`: the
   * distinct universes the MATCHED ROWS belong to, even when the query text
   * never named the universe itself. Excludes anything already in
   * `universes` (never duplicate the same name across both groups), capped
   * at MAX_SUGGESTED_UNIVERSES by matched-row count so autofill stays clean.
   */
  universeSuggestions: UniverseHit[];
}

/** How many ranked units (book works + game rows) a response carries. */
export const MAX_RESULTS = 20;
const MAX_UNIVERSES = 5;
/** Cap for member-implied universe autofill (task 4) — "sensibly", per the
 * owner's own word: the top 2 universes by matched-row count, not a flood. */
const MAX_SUGGESTED_UNIVERSES = 2;

/** Collapse raw display text for the raw-substring lane: lowercase, one-space. */
function rawFold(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The tier one folded haystack earns against the folded query, or null.
 * Checked strongest-first because exact ⊂ prefix ⊂ substring.
 */
export function tierFor(q: string, qTokens: readonly string[], hay: string): MatchTier | null {
  if (q === '' || hay === '') return null;
  if (hay === q) return 'exact';
  if (hay.startsWith(q)) return 'prefix';
  if (qTokens.length > 0) {
    const hayTokens = hay.split(' ');
    const allPrefix = qTokens.every((qt) => hayTokens.some((ht) => ht.startsWith(qt)));
    if (allPrefix) return 'tokens';
  }
  if (hay.includes(q)) return 'substring';
  return null;
}

/**
 * Score one row against the query, or null when it does not match at all.
 * `q` is the folded query (may be '' for unfoldable queries); `rawQ` is the
 * raw-folded query, always non-empty — the display-title lane.
 */
export function scoreRow(q: string, qTokens: readonly string[], rawQ: string, row: SearchRow): ScoredRow | null {
  let best: ScoredRow | null = null;
  const consider = (field: MatchField, tier: MatchTier | null) => {
    if (tier === null) return;
    const score = TIER_SCORE[tier] + FIELD_SCORE[field];
    if (best === null || score > best.score) best = { row, score, reason: `${field}-${tier}` };
  };

  if (row.title_fold !== null) {
    consider('title', tierFor(q, qTokens, row.title_fold));
  } else {
    // NULL-fold row (wholly non-Latin title): the design's sanctioned path is
    // display-title search (§3.1). Raw substring on the display spelling.
    const hay = rawFold(row.title);
    consider('title', hay === rawQ ? 'exact' : hay.includes(rawQ) ? 'substring' : null);
  }

  // The `?unknown` sentinel is a provisional non-author; matching a person's
  // search for "unknown" against it would be a lie (fold.ts's own stance).
  if (row.creator !== null && row.creator.trim() !== UNKNOWN_AUTHOR_SENTINEL) {
    consider('creator', tierFor(q, qTokens, normaliseTitle(row.creator)));
  }
  if (row.series !== null) {
    consider('series', tierFor(q, qTokens, normaliseTitle(row.series)));
  }
  return best;
}

/** A ranked cap unit: one book work or one game row (searchIndex's `units`). */
type RankedUnit = { score: number; kind: 'book'; key: string } | { score: number; kind: 'game'; hit: ScoredRow };

/** Base games before their satellites at equal score — probed on the real
 * data: 'dungeon craw' put four Art Prints above the board game itself. */
function kindRank(kind: string | null): number {
  if (kind === null || kind === 'base') return 0;
  if (kind === 'expansion') return 1;
  return 2; // accessory / promo / upgrade
}

/**
 * ACCESSORIES DE-CLUTTER, ranking half (owner: "make accessories a sub
 * category in a universe page"): kind='accessory'/'promo' units rank BELOW
 * every book, audiobook and base/expansion game unit — not merely tie-broken
 * against them at equal score (that is kindRank, above, unchanged), but
 * demoted outright regardless of score. A demotion TIER on the unit cap
 * (searchIndex's `units.sort`), not a per-row score penalty, so it survives
 * the MAX_RESULTS cap the same way for every consumer: the component never
 * reorders what the server sends, so this is the one place to implement it.
 */
function unitDemotionTier(u: RankedUnit): number {
  if (u.kind === 'game' && (u.hit.row.kind === 'accessory' || u.hit.row.kind === 'promo')) return 1;
  return 0;
}

/** Stable order: score desc, then base before satellites, then the shorter
 * (closer) title, then A–Z. */
function compareScored(a: ScoredRow, b: ScoredRow): number {
  if (a.score !== b.score) return b.score - a.score;
  const ka = kindRank(a.row.kind);
  const kb = kindRank(b.row.kind);
  if (ka !== kb) return ka - kb;
  const la = (a.row.title_fold ?? a.row.title).length;
  const lb = (b.row.title_fold ?? b.row.title).length;
  if (la !== lb) return la - lb;
  return a.row.title.localeCompare(b.row.title);
}

/**
 * The whole search: scan-score every row, group books by work (same-work
 * rows are ONE hit with N format entries), leave games individual, surface
 * matched universe names as their own group, cap at MAX_RESULTS units.
 *
 * A scored scan over ~2,300 rows is the design here, not a shortcut to
 * apologise for — no FTS index to drift, no second store to migrate.
 */
export function searchIndex(query: string, rows: readonly SearchRow[], universes: UniverseIndex): SearchResults {
  const q = normaliseTitle(query);
  const qTokens = q === '' ? [] : q.split(' ');
  const rawQ = rawFold(query);

  const scored: ScoredRow[] = [];
  for (const row of rows) {
    const hit = scoreRow(q, qTokens, rawQ, row);
    if (hit !== null) scored.push(hit);
  }
  scored.sort(compareScored);

  // Books tier: join same-work. work_fold when it exists; a NULL-fold book
  // row stays its own group (it never claimed to be the same work as anything).
  const bookGroups = new Map<string, { best: ScoredRow; entries: ScoredRow[] }>();
  const gameHits: ScoredRow[] = [];
  const bookOrder: string[] = [];

  for (const s of scored) {
    if (s.row.source === 'game') {
      gameHits.push(s);
      continue;
    }
    const key = s.row.work_fold ?? `solo:${s.row.source}:${s.row.source_id}`;
    const g = bookGroups.get(key);
    if (g) {
      g.entries.push(s);
      if (s.score > g.best.score) g.best = s;
    } else {
      bookGroups.set(key, { best: s, entries: [s] });
      bookOrder.push(key);
    }
  }

  // Rank units (book works + game rows) together, then cap.
  const units: RankedUnit[] = [
    ...bookOrder.map((key) => ({ score: bookGroups.get(key)!.best.score, kind: 'book' as const, key })),
    ...gameHits.map((hit) => ({ score: hit.score, kind: 'game' as const, hit })),
  ];
  units.sort((a, b) => {
    const da = unitDemotionTier(a);
    const db = unitDemotionTier(b);
    if (da !== db) return da - db;
    return b.score - a.score;
  });
  const kept = units.slice(0, MAX_RESULTS);

  const books: BookHit[] = [];
  const games: GameHit[] = [];
  for (const u of kept) {
    if (u.kind === 'book') {
      const g = bookGroups.get(u.key)!;
      books.push({
        title: g.best.row.title,
        creator: g.best.row.creator,
        score: g.best.score,
        reason: g.best.reason,
        entries: g.entries
          .slice()
          .sort((a, b) => a.row.source.localeCompare(b.row.source) || a.row.format.localeCompare(b.row.format))
          .map((s) => s.row),
      });
    } else {
      games.push({ ...u.hit.row, score: u.hit.score, reason: u.hit.reason });
    }
  }

  const namedUniverses = matchUniverses(query, q, qTokens, rows, universes);
  return {
    books,
    games,
    universes: namedUniverses,
    universeSuggestions: suggestUniverses(scored, namedUniverses),
  };
}

/**
 * MEMBER-IMPLIED UNIVERSE AUTOFILL (task 4, owner: "if I search mistborn have
 * it show cosmere as the search autofill"): the distinct universes the
 * MATCHED rows belong to — every row that scored at all against the query,
 * before the MAX_RESULTS cap, so the count reflects the true matched set, not
 * just what fit on screen. Skips any universe already offered by
 * `matchUniverses` (the query NAMED it directly) — the two groups are
 * additive and must never duplicate the same name. Capped at
 * MAX_SUGGESTED_UNIVERSES by matched-row count, ties broken A–Z.
 */
function suggestUniverses(scored: readonly ScoredRow[], named: readonly UniverseHit[]): UniverseHit[] {
  const namedNames = new Set(named.map((u) => u.name));
  const counts = new Map<string, number>();
  for (const s of scored) {
    const universe = s.row.universe;
    if (universe === null || namedNames.has(universe)) continue;
    counts.set(universe, (counts.get(universe) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_SUGGESTED_UNIVERSES)
    .map(([name, count]) => ({ name, count }));
}

/**
 * Universe names the query matches — the §3.2 tier as its own result group.
 * Only universes that actually hold rows are offered (an empty follow-up
 * would be furniture); counts come from the same scan.
 */
function matchUniverses(
  query: string,
  q: string,
  qTokens: readonly string[],
  rows: readonly SearchRow[],
  universes: UniverseIndex,
): UniverseHit[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.universe !== null) counts.set(row.universe, (counts.get(row.universe) ?? 0) + 1);
  }

  const hits: Array<{ name: string; count: number; tier: MatchTier }> = [];
  for (const [name, count] of counts) {
    const tier = tierFor(q, qTokens, normaliseTitle(name));
    if (tier !== null) hits.push({ name, count, tier });
  }

  // A typed alias ("dcc") resolves through the shared canonical-name map too.
  const aliased = resolveUniverseName(universes, query);
  if (aliased !== null && counts.has(aliased) && !hits.some((h) => h.name === aliased)) {
    hits.push({ name: aliased, count: counts.get(aliased)!, tier: 'exact' });
  }

  hits.sort((a, b) => TIER_SCORE[b.tier] - TIER_SCORE[a.tier] || a.name.localeCompare(b.name));
  return hits.slice(0, MAX_UNIVERSES).map(({ name, count }) => ({ name, count }));
}
