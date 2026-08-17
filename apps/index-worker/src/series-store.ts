/**
 * The series registry's D1 side: load it, and turn a plan into statements.
 *
 * Kept apart from series.ts so the resolver stays pure (and testable without a
 * database, the way rows.ts and fold.ts are). The statements this builds are
 * appended to the PUSH'S OWN `db.batch` — D1 runs a batch transactionally, so
 * a push that dies mid-way leaves neither the snapshot nor the registry
 * half-written. The registry never gets its own transaction, deliberately:
 * there is no moment at which `entry.series_slug` may name a slug that does
 * not exist.
 *
 * ⚠️ Every insert is OR IGNORE, and that is load-bearing rather than defensive
 * habit. `series_pending` rows are kept AFTER they are resolved (0004's
 * header), so OR IGNORE is what makes "keep separate" stick: the next push
 * re-proposes the same candidate, the insert is ignored, and the human is not
 * asked a question they have already answered.
 */

import type { NewAlias, NewPending, NewSeries, SeriesPlan, SeriesRegistry } from './series.js';

export async function loadRegistry(db: D1Database): Promise<SeriesRegistry> {
  const [seriesRows, aliasRows, pendingRows] = await Promise.all([
    db.prepare('SELECT slug, display_name FROM series').all<{ slug: string; display_name: string }>(),
    db.prepare('SELECT alias_fold, slug FROM series_alias').all<{ alias_fold: string; slug: string }>(),
    db.prepare('SELECT candidate_fold FROM series_pending').all<{ candidate_fold: string }>(),
  ]);

  const series = new Map<string, { slug: string; display_name: string }>();
  for (const r of seriesRows.results ?? []) series.set(r.slug, { slug: r.slug, display_name: r.display_name });

  const aliases = new Map<string, string>();
  for (const r of aliasRows.results ?? []) aliases.set(r.alias_fold, r.slug);

  // OPEN AND RESOLVED alike — a resolved candidate must never be re-queued.
  const queued = new Set<string>();
  for (const r of pendingRows.results ?? []) queued.add(r.candidate_fold);

  return { series, aliases, queued };
}

const INSERT_SERIES = `INSERT OR IGNORE INTO series (slug, display_name, first_source, created_at) VALUES (?, ?, ?, ?)`;
const INSERT_ALIAS = `INSERT OR IGNORE INTO series_alias (alias_fold, slug, alias_display, decided_how, created_at) VALUES (?, ?, ?, ?, ?)`;
const INSERT_PENDING = `INSERT OR IGNORE INTO series_pending (
  candidate_fold, candidate_display, candidate_slug, closest_slug, closest_display,
  near_key, sample_titles, sources, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function seriesStatement(db: D1Database, s: NewSeries, now: string): D1PreparedStatement {
  return db.prepare(INSERT_SERIES).bind(s.slug, s.display_name, s.first_source, now);
}

export function aliasStatement(db: D1Database, a: NewAlias, now: string): D1PreparedStatement {
  return db.prepare(INSERT_ALIAS).bind(a.alias_fold, a.slug, a.alias_display, a.decided_how, now);
}

export function pendingStatement(db: D1Database, p: NewPending, now: string): D1PreparedStatement {
  return db
    .prepare(INSERT_PENDING)
    .bind(
      p.candidate_fold,
      p.candidate_display,
      p.candidate_slug,
      p.closest_slug,
      p.closest_display,
      p.near_key,
      JSON.stringify(p.sample_titles),
      JSON.stringify(p.sources),
      now,
    );
}

/** Every registry write a plan implies, in dependency order: series, then the rows that point at them. */
export function planStatements(db: D1Database, plan: SeriesPlan, now: string): D1PreparedStatement[] {
  return [
    ...plan.newSeries.map((s) => seriesStatement(db, s, now)),
    ...plan.newAliases.map((a) => aliasStatement(db, a, now)),
    ...plan.newPending.map((p) => pendingStatement(db, p, now)),
  ];
}
