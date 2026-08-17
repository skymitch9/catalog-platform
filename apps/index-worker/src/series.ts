/**
 * The series registry's resolver — pure, no I/O. Schema and the whole argument
 * for it: migrations/0004_series_registry.sql.
 *
 * The owner's order (2026-08-16): "I don't want duplicate series." An m4b tag
 * says "The Stormlight Archive", a library row says "Stormlight Archive", and
 * anything grouping by the free-text `entry.series` sees two. This module
 * gives a series the same thing `work_fold` gave a book — a KEY — so grouping
 * stops depending on spelling.
 *
 * ⚠️ NO NEW NORMALISER LIVES HERE. Every function below is a wrapper over
 * `normaliseTitle` from fold.ts (the pinned port, fixture-locked across three
 * repos), in the same house style as `titleFoldOrNull`/`creatorFoldOrNull`.
 * That fold strips a leading article, so the owner's own example merges with
 * no judgement call at all. `normaliseUniverseText` is deliberately NOT used:
 * it KEEPS leading articles on purpose ("The Cosmere" and "Cosmere" are two
 * different strings in universes.json by design), which is the exact opposite
 * of what a de-duplicating key needs — universes.ts's header names that split
 * and this is the other side of it.
 *
 * ⚠️ THE SPLIT THE OWNER APPROVED:
 *   EXACT fold equality → AUTO-MERGE. No score, no threshold, no judgement.
 *   NEAR (folds differ) → NEVER merged. The candidate registers as its OWN
 *                         slug and a human gets a queue row.
 * `seriesNearKey` is therefore a DISCOVERY tool and nothing else — it gates no
 * write, ranks nothing, and its only consumer is the confirm queue. That is
 * design §8's "no second matcher" intact: §8 forbids a second IDENTITY
 * function feeding an auto-acting join, and the one thing this near rule can
 * never do is act. The rule itself is not invented here either: it is the
 * decoration fold `data/series-canon.json`'s `_measured` used to FIND the
 * estate's three real drift groups, which that file states plainly is "a
 * DISCOVERY tool only, never a runtime rule". It is reused as one.
 */

import { normaliseTitle } from './fold.js';

/** A source's spelling of a series, folded — or null when the fold is empty.
 *
 * ⚠️ The empty-fold refusal, same rule and same reason as `titleFoldOrNull`:
 * a wholly non-Latin series name folds to `''` (measured live 2026-08-16: two
 * Korean series in the audiobook catalog), and a registry keyed on that would
 * make every such series the same series as every other. NULL instead: the row
 * keeps its display spelling, joins no registry entry, and says so.
 */
export function seriesFoldOrNull(series: string | null | undefined): string | null {
  if (series === null || series === undefined) return null;
  const fold = normaliseTitle(series);
  return fold === '' ? null : fold;
}

/**
 * The canonical key. `normaliseTitle` has already reduced everything to
 * lowercase alphanumerics separated by single spaces, so hyphenating the
 * spaces is a bijection — the slug and the fold are the same fact in two
 * spellings, and nothing has to store both.
 */
export function slugForFold(fold: string): string {
  return fold.replace(/ /g, '-');
}

/**
 * ⚠️ DISCOVERY ONLY — the key that decides whether two DIFFERENT folds are
 * worth ASKING a human about. Never a merge, never a match.
 *
 * Strip the decorations Audible-style naming adds ("[publication order]",
 * "(Full-Cast Editions)", a trailing "Series"), fold what is left, then drop
 * the spaces (the `_measured` file's second, looser pass — it catches
 * "Storm Light" against "Stormlight"). Two names sharing this key and NOT
 * sharing a fold are a near miss.
 *
 * The stripping happens BEFORE the fold on purpose: `normaliseTitle` reduces
 * brackets and parentheses to spaces, so after folding there is no decoration
 * left to recognise.
 */
export function seriesNearKey(display: string): string {
  return normaliseTitle(undecorate(display)).replace(/ /g, '');
}

/** Peel trailing `[...]` / `(...)` / ` Series`, repeatedly. Never to nothing. */
function undecorate(raw: string): string {
  let s = raw.trim();
  for (;;) {
    const next = s
      .replace(/\s*[[(][^\])]*[\])]\s*$/, '')
      .replace(/\s+series$/i, '')
      .trim();
    if (next === s || next === '') return s;
    s = next;
  }
}

// ---------------------------------------------------------------------------
// The registry as the resolver sees it — three maps, loaded once per push.
// ---------------------------------------------------------------------------

export interface SeriesEntry {
  slug: string;
  display_name: string;
}

export interface SeriesRegistry {
  /** slug → the canonical entry. */
  readonly series: Map<string, SeriesEntry>;
  /** alias_fold → slug (canon + human merges; never a fold that resolves itself). */
  readonly aliases: Map<string, string>;
  /** Every candidate_fold ever queued, OPEN OR RESOLVED — see `newPending`. */
  readonly queued: ReadonlySet<string>;
}

export function emptyRegistry(): SeriesRegistry {
  return { series: new Map(), aliases: new Map(), queued: new Set() };
}

/** One row being resolved: what it says its series is, and what it is. */
export interface SeriesRowInput {
  source: string;
  title: string;
  series: string | null;
}

export interface NewSeries {
  slug: string;
  display_name: string;
  first_source: string;
}

export interface NewAlias {
  alias_fold: string;
  slug: string;
  alias_display: string;
  decided_how: 'canon' | 'human';
}

export interface NewPending {
  candidate_fold: string;
  candidate_display: string;
  candidate_slug: string;
  closest_slug: string;
  closest_display: string;
  near_key: string;
  sample_titles: { source: string; title: string }[];
  sources: string[];
}

/** What one raw spelling resolved to. `null` = unfoldable; the row is left alone. */
export interface SeriesResolution {
  slug: string;
  display: string;
  /** How the raw spelling reached that slug — the honesty channel, matched_via-style. */
  via: 'new' | 'exact' | 'alias' | 'canon' | 'pending';
}

export interface SeriesPlan {
  /** raw pushed spelling → resolution, or null for an unfoldable one. */
  resolutions: Map<string, SeriesResolution | null>;
  newSeries: NewSeries[];
  newAliases: NewAlias[];
  newPending: NewPending[];
  /** Raw spellings that folded onto a DIFFERENT canonical display — the merges. */
  mergedSpellings: number;
  /** Raw spellings whose fold came back empty (the refusal). */
  unfoldable: number;
}

const MAX_SAMPLES = 3;

/**
 * Resolve every distinct series spelling in a batch of rows against the
 * registry, and say what the registry must gain.
 *
 * ⚠️ Deterministic by construction: candidates are processed in sorted fold
 * order, never in the order the source happened to list them. "First writer
 * wins" then means something reproducible — re-running the same snapshot
 * against an empty registry produces the same canonical displays, which is
 * what makes the backfill script and the push agree.
 *
 * The plan is applied inside the push's single `db.batch` (push.ts), so a
 * failed push leaves neither entries nor registry rows half-written.
 */
export function planSeries(
  registry: SeriesRegistry,
  rows: readonly SeriesRowInput[],
  canon: ReadonlyMap<string, string>,
): SeriesPlan {
  // Group by the RAW spelling: samples and sources travel with it, because a
  // pending row a human cannot decide from is a pending row nobody resolves.
  const groups = new Map<string, { display: string; sources: Set<string>; samples: { source: string; title: string }[] }>();
  for (const row of rows) {
    const display = row.series?.trim();
    if (!display) continue;
    let g = groups.get(display);
    if (!g) {
      g = { display, sources: new Set(), samples: [] };
      groups.set(display, g);
    }
    g.sources.add(row.source);
    if (g.samples.length < MAX_SAMPLES) g.samples.push({ source: row.source, title: row.title });
  }

  const plan: SeriesPlan = {
    resolutions: new Map(),
    newSeries: [],
    newAliases: [],
    newPending: [],
    mergedSpellings: 0,
    unfoldable: 0,
  };

  // A near key can be shared by several slugs once a human has said "keep
  // separate"; the smallest slug wins as `closest` so the queue row is stable
  // across runs rather than depending on map insertion order.
  const nearIndex = new Map<string, string[]>();
  const noteNear = (display: string, slug: string) => {
    const key = seriesNearKey(display);
    if (key === '') return;
    const bucket = nearIndex.get(key);
    if (bucket) {
      if (!bucket.includes(slug)) bucket.push(slug);
    } else nearIndex.set(key, [slug]);
  };
  for (const entry of registry.series.values()) noteNear(entry.display_name, entry.slug);

  const queued = new Set(registry.queued);
  const ordered = [...groups.values()].sort((a, b) => {
    const fa = normaliseTitle(a.display);
    const fb = normaliseTitle(b.display);
    return fa === fb ? (a.display < b.display ? -1 : 1) : fa < fb ? -1 : 1;
  });

  for (const group of ordered) {
    const fold = seriesFoldOrNull(group.display);
    if (fold === null) {
      plan.resolutions.set(group.display, null);
      plan.unfoldable += 1;
      continue;
    }
    const slug = slugForFold(fold);

    // 1. An alias decided earlier — by the canon or by a human at the queue.
    //    Checked FIRST because it is the only mechanism that can overrule the
    //    fold, and a human's decision outranks a mechanical one.
    const aliasTarget = registry.aliases.get(fold);
    if (aliasTarget !== undefined) {
      const entry = registry.series.get(aliasTarget);
      if (entry) {
        plan.resolutions.set(group.display, { slug: entry.slug, display: entry.display_name, via: 'alias' });
        if (entry.display_name !== group.display) plan.mergedSpellings += 1;
        continue;
      }
      // An alias pointing at a slug that no longer exists is a broken merge,
      // not a licence to guess — fall through and let the fold decide.
    }

    // 2. Exact fold equality → merge. The whole point: "The Stormlight
    //    Archive" and "Stormlight Archive" are one slug, mechanically.
    const existing = registry.series.get(slug);
    if (existing) {
      plan.resolutions.set(group.display, { slug, display: existing.display_name, via: 'exact' });
      if (existing.display_name !== group.display) plan.mergedSpellings += 1;
      continue;
    }

    // 3. The estate canon already recorded this spelling's fold, with
    //    evidence (data/series-canon.json). Honouring a decision a human
    //    already made is not a new judgement, so it merges rather than queues.
    const canonical = canon.get(fold);
    if (canonical !== undefined) {
      const canonFold = normaliseTitle(canonical);
      if (canonFold !== '' && canonFold !== fold) {
        const canonSlug = slugForFold(canonFold);
        let target = registry.series.get(canonSlug);
        if (!target) {
          target = { slug: canonSlug, display_name: canonical };
          registry.series.set(canonSlug, target);
          plan.newSeries.push({ slug: canonSlug, display_name: canonical, first_source: firstSource(group.sources) });
          noteNear(canonical, canonSlug);
        }
        registry.aliases.set(fold, canonSlug);
        plan.newAliases.push({ alias_fold: fold, slug: canonSlug, alias_display: group.display, decided_how: 'canon' });
        plan.resolutions.set(group.display, { slug: canonSlug, display: target.display_name, via: 'canon' });
        if (target.display_name !== group.display) plan.mergedSpellings += 1;
        continue;
      }
    }

    // 4. New to the registry. It ALWAYS registers as its own slug — including
    //    when it is a near miss, which is the confirm-first rule: near never
    //    merges, it only asks.
    const created: SeriesEntry = { slug, display_name: group.display };
    registry.series.set(slug, created);
    plan.newSeries.push({ slug, display_name: group.display, first_source: firstSource(group.sources) });

    const nearKey = seriesNearKey(group.display);
    const neighbours = (nearIndex.get(nearKey) ?? []).filter((s) => s !== slug);
    noteNear(group.display, slug);

    if (neighbours.length > 0 && !queued.has(fold)) {
      const closestSlug = [...neighbours].sort()[0] as string;
      const closest = registry.series.get(closestSlug);
      queued.add(fold);
      plan.newPending.push({
        candidate_fold: fold,
        candidate_display: group.display,
        candidate_slug: slug,
        closest_slug: closestSlug,
        closest_display: closest?.display_name ?? closestSlug,
        near_key: nearKey,
        sample_titles: group.samples,
        sources: [...group.sources].sort(),
      });
      plan.resolutions.set(group.display, { slug, display: group.display, via: 'pending' });
      continue;
    }

    plan.resolutions.set(group.display, { slug, display: group.display, via: 'new' });
  }

  return plan;
}

function firstSource(sources: ReadonlySet<string>): string {
  return [...sources].sort()[0] ?? 'unknown';
}
