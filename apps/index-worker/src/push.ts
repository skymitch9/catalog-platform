/**
 * PUT /api/push/:source — full-snapshot replace, per source.
 *
 * Snapshot-replace is what makes the re-run-drift class structurally
 * impossible: there is no incremental state to fall behind, no cache a
 * forgotten re-run leaves stale (the failure both existing bridges have,
 * design §1). The whole replace runs as ONE `db.batch`, which D1 executes
 * transactionally — a push that dies mid-way leaves the previous snapshot
 * intact, never a half-replaced source.
 */

import { Hono } from 'hono';
import { tokenMatches } from './bearer.js';
import type { Env } from './env.js';
import { pushTokenFor } from './env.js';
import type { EntryRow } from './rows.js';
import { entryFor, isSource, pushBodySchema, snapshotProblems } from './rows.js';
import { universeIndex } from './universes-data.js';
import { universeFor, type UniverseIndex } from './universes.js';
import { seriesCanonIndex } from './series-canon-data.js';
import { planSeries, type SeriesPlan } from './series.js';
import { loadRegistry, planStatements } from './series-store.js';

// The bearer check moved to `bearer.ts` (2026-08-23) so the machine READ
// surface uses THIS comparison rather than a second copy of it.

export const pushRoutes = new Hono<{ Bindings: Env }>();

pushRoutes.put('/:source', async (c) => {
  const sourceParam = c.req.param('source');
  if (!isSource(sourceParam)) {
    return c.json({ error: 'unknown_source', source: sourceParam, known: ['game', 'library', 'audiobook'] }, 404);
  }
  const source = sourceParam;

  // A missing secret is a configuration error, not an auth failure — say
  // which, so "the token is wrong" and "nobody ever set a token" cannot be
  // mistaken for each other.
  const expected = pushTokenFor(c.env, source);
  if (!expected) {
    return c.json({ error: 'push_token_unset', source, fix: `wrangler secret put INDEX_PUSH_TOKEN_${source.toUpperCase()}` }, 503);
  }
  if (!(await tokenMatches(c.req.header('authorization'), expected))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = pushBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_snapshot', issues: parsed.error.issues.slice(0, 20) }, 422);
  }

  const problems = snapshotProblems(source, parsed.data);
  if (problems.length > 0) {
    return c.json({ error: 'refused_snapshot', problems: problems.slice(0, 20) }, 422);
  }

  const pushedAt = new Date().toISOString();
  const entries = parsed.data.map((row) => entryFor(source, row, universeIndex, pushedAt));

  // The series registry (migration 0004). Resolution happens HERE, on write,
  // for the same reason the folds and the universe do (design §6): the sources
  // push raw display strings and contain no fold code at all. One read of the
  // registry (a few hundred rows), one pure plan, and the writes ride the same
  // batch as the snapshot.
  //
  // Since 2026-08-17 the same pass also re-points the UNIVERSE join at the
  // canonical spelling — see `applySeriesPlan`, and design §8.5.
  const registry = await loadRegistry(c.env.DB);
  const plan = planSeries(registry, entries, seriesCanonIndex);
  const universe = applySeriesPlan(entries, plan, universeIndex);

  await replaceSource(c.env.DB, source, entries, plan, pushedAt);

  return c.json({
    ok: true,
    source,
    rows: entries.length,
    pushed_at: pushedAt,
    // Refusals surfaced per push, so a source can see its own degenerate rows
    // without querying — matched_via-style honesty about what will not join.
    unfoldable_titles: entries.filter((e) => e.title_fold === null).length,
    series: {
      registered: plan.newSeries.length,
      merged_spellings: plan.mergedSpellings,
      pending_added: plan.newPending.length,
      unfoldable: plan.unfoldable,
    },
    // The universe join's own honesty channel: how many rows in THIS snapshot
    // carry a universe, how many of them owe it to a SIBLING spelling of their
    // series rather than to their own, and how many rows are told two
    // different things by two spellings of one series (a `universes.json`
    // fault, reported rather than resolved).
    universe: {
      rows: universe.rows,
      gained_from_registry: universe.gainedFromRegistry,
      conflicts: universe.conflicts,
      ...(universe.conflicts > 0
        ? {
            conflict_detail:
              'two spellings of one series map to different universes in data/universes.json; the row’s own spelling was kept and nothing was guessed — fix the list with `node tools/universes.mjs`',
            conflict_samples: universe.conflictSamples,
          }
        : {}),
    },
  });
});

/** What the universe re-point did — the "before/after" the follow-up asked for. */
export interface UniverseRepoint {
  /** Rows carrying a universe once the pass is done (the "after" count). */
  rows: number;
  /** Rows that had NO universe from their own spelling and gained one from a sibling spelling. */
  gainedFromRegistry: number;
  /** Rows where two spellings of ONE series answer with DIFFERENT universes. Never resolved here. */
  conflicts: number;
  /** Up to three of those, so the fault is findable without a query. */
  conflictSamples: { title: string; pushed_series: string; other_series: string; kept: string; other_says: string }[];
}

const MAX_CONFLICT_SAMPLES = 3;

/**
 * Stamp each row with its slug, REWRITE the display to the canonical one, and
 * re-point the universe join at the SERIES rather than at one spelling of it.
 *
 * The rewrite is the half that fixes what the owner actually sees: a consumer
 * grouping by the free-text `series` (the library's ladders, the search
 * results, anything not yet slug-aware) sees one spelling instead of two,
 * without having to learn about the registry at all.
 *
 * ⚠️ A UNIVERSE IS A PROPERTY OF THE SERIES, NOT OF A SPELLING — that is the
 * whole re-point. `universes.json` lists each series in ONE spelling ("The
 * Stormlight Archive"), and `normaliseUniverseText` keeps leading articles on
 * purpose, so any source pushing another spelling of the same series missed
 * the join outright. The registry knows those spellings are one series, so a
 * row with no universe of its own is asked again with every OTHER spelling of
 * its series in this snapshot, canonical first.
 *
 * ⚠️ ASKING WITH THE CANONICAL SPELLING ALONE IS NOT ENOUGH, and the live
 * probe proved it rather than the design predicting it: the canonical display
 * is "first writer wins" in fold order, so it is just as likely to BE the
 * unlisted spelling ("Stormlight Archive" sorts before "The Stormlight
 * Archive"). When it is, a canonical-only attempt gains nothing and leaves one
 * series holding rows with two different answers.
 *
 * ⚠️ STRICTLY ADDITIVE, AND STILL EXACT. The pushed spelling is asked first
 * and is never overridden, so no row can LOSE a universe here; every extra
 * attempt is the same EXACT `universeFor` lookup on a string a source really
 * pushed. Nothing is folded and nothing is guessed — the registry supplies
 * more strings to try, it does not make the universe matcher fuzzy, and
 * `normaliseUniverseText`'s deliberate "The Cosmere" ≠ "Cosmere" split is
 * untouched.
 *
 * ⚠️ A NEAR MISS CONTRIBUTES NOTHING. Only spellings that RESOLVED to the same
 * slug are tried, and a near miss registers as its own slug — so the confirm
 * queue's "never merged, only asked" rule holds here too: an unresolved near
 * miss cannot lend its neighbour a universe.
 *
 * ⚠️ Exclusions cannot be smuggled past. `universeFor` checks `bookExclusions`
 * by TITLE before it looks at any series, so every attempt refuses an excluded
 * title identically; The Frugal Wizard's Handbook stays out of the Cosmere
 * however its series is spelled.
 *
 * ⚠️ A DISAGREEMENT IS REPORTED, NEVER RESOLVED. If two spellings of one
 * series answer with different universes, the row's own spelling wins and the
 * row is counted as a conflict: one series in two universes is a fault in
 * `data/universes.json`, and picking a winner here would hide it behind a
 * guess.
 */
export function applySeriesPlan(entries: EntryRow[], plan: SeriesPlan, universes: UniverseIndex): UniverseRepoint {
  const out: UniverseRepoint = { rows: 0, gainedFromRegistry: 0, conflicts: 0, conflictSamples: [] };
  const spellings = spellingsBySlug(plan);

  for (const e of entries) {
    if (e.series !== null) {
      const pushedSeries = e.series.trim();
      const resolved = plan.resolutions.get(pushedSeries);
      // `!resolved` = unfoldable, or no series — leave the row exactly as pushed.
      if (resolved) {
        e.series_slug = resolved.slug;
        e.series = resolved.display;

        for (const other of spellings.get(resolved.slug) ?? []) {
          if (other === pushedSeries) continue;
          const says = universeFor(universes, { title: e.title, series: other });
          if (says === null) continue;
          if (e.universe === null) {
            e.universe = says;
            out.gainedFromRegistry += 1;
          } else if (says !== e.universe) {
            out.conflicts += 1;
            if (out.conflictSamples.length < MAX_CONFLICT_SAMPLES) {
              out.conflictSamples.push({
                title: e.title,
                pushed_series: pushedSeries,
                other_series: other,
                kept: e.universe,
                other_says: says,
              });
            }
          }
        }
      }
    }
    if (e.universe !== null) out.rows += 1;
  }

  return out;
}

/**
 * slug → every spelling of that series in this snapshot, CANONICAL FIRST and
 * the rest sorted. Deterministic on purpose: which spelling answers first
 * decides which universe a conflicting row keeps, and that must not depend on
 * the order a source happened to list its rows in (`planSeries`'s own rule).
 */
function spellingsBySlug(plan: SeriesPlan): Map<string, string[]> {
  const bySlug = new Map<string, { display: string; raws: Set<string> }>();
  for (const [raw, res] of plan.resolutions) {
    if (!res) continue;
    const group = bySlug.get(res.slug);
    if (group) group.raws.add(raw);
    else bySlug.set(res.slug, { display: res.display, raws: new Set([raw]) });
  }

  const out = new Map<string, string[]>();
  for (const [slug, group] of bySlug) {
    out.set(slug, [group.display, ...[...group.raws].filter((s) => s !== group.display).sort()]);
  }
  return out;
}

const INSERT_ENTRY = `INSERT INTO entry (
  source, source_id, title, creator, title_fold, work_fold, universe,
  series, series_slug, series_index, year, publisher, format, kind, parent_source_id,
  cover_url, detail_url, pushed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function replaceSource(
  db: D1Database,
  source: string,
  entries: readonly EntryRow[],
  plan: SeriesPlan,
  now: string,
): Promise<void> {
  const statements = [
    db.prepare('DELETE FROM entry WHERE source = ?').bind(source),
    // Registry rows FIRST: no moment exists at which an inserted entry names a
    // slug the `series` table does not hold.
    ...planStatements(db, plan, now),
    ...entries.map((e) =>
      db
        .prepare(INSERT_ENTRY)
        .bind(
          e.source,
          e.source_id,
          e.title,
          e.creator,
          e.title_fold,
          e.work_fold,
          e.universe,
          e.series,
          e.series_slug,
          e.series_index,
          e.year,
          e.publisher,
          e.format,
          e.kind,
          e.parent_source_id,
          e.cover_url,
          e.detail_url,
          e.pushed_at,
        ),
    ),
  ];
  await db.batch(statements);
}
