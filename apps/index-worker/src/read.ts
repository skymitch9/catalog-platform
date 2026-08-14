/**
 * The read surface: lookup, universe, health.
 *
 * ⚠️ NO AUTH HERE YET, AND THAT IS NOT A DECISION — design §9 Q3 (the lookup
 * surface leaks which titles the household owns) is an OWNER call, open on
 * purpose. This Worker is deliberately not deployed until it is answered; do
 * not deploy it, and do not "helpfully" pick public-or-tokened here on the
 * owner's behalf.
 *
 * These routes never auto-act. Title-only matching is safe HERE AND ONLY HERE
 * because the reader is a human looking at a result list with covers and
 * publishers (design §3.3); the 0.34/0.7 threshold lessons apply to
 * auto-acting matchers, of which this surface contains none. No fuzzy
 * matching either — exact fold-joins only; containment and thresholds stay in
 * the catalogs' own matching code, where their gates live.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { titleFoldOrNull } from './fold.js';
import { resolveUniverseName } from './universes.js';
import { universeIndex } from './universes-data.js';
import { SOURCES } from './rows.js';

export const readRoutes = new Hono<{ Bindings: Env }>();

/** The columns a reader gets back — everything in `entry`; it is all display data. */
const ENTRY_COLS =
  'source, source_id, title, creator, title_fold, work_fold, universe, series, series_index, year, publisher, format, kind, parent_source_id, cover_url, detail_url, pushed_at';

/**
 * GET /api/lookup?title=… — "do I own this in any format?", at the store.
 *
 * Folds the query ONCE (the same fold the write side used) and returns every
 * row whose `title_fold` matches, across all sources — games included,
 * matched on title alone. Work-tier rows are a subset of these (work_fold
 * shares its title half), so one indexed equality answers both tiers.
 */
readRoutes.get('/lookup', async (c) => {
  const title = c.req.query('title');
  if (!title || !title.trim()) {
    return c.json({ error: 'missing_title', usage: '/api/lookup?title=…' }, 400);
  }

  const fold = titleFoldOrNull(title);
  if (fold === null) {
    // The query itself folds to nothing (wholly non-Latin, or punctuation
    // only). A key match is impossible and pretending otherwise would be the
    // `|samg` bug from the read side — refuse, and say why.
    return c.json(
      { error: 'unfoldable_query', detail: 'this title folds to the empty string, so a key match is impossible; browse the owning catalog instead' },
      422,
    );
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${ENTRY_COLS} FROM entry WHERE title_fold = ? ORDER BY source, format, title`,
  )
    .bind(fold)
    .all();

  return c.json({ query: title, title_fold: fold, matches: results });
});

/**
 * GET /api/universe/:name — everything in one fiction, across every catalog.
 * The only cross-format join games participate in (design §3.2): the DCC
 * board game beside the DCC books, joined where the shared fact actually
 * exists.
 */
readRoutes.get('/universe/:name', async (c) => {
  const asked = c.req.param('name');
  const canonical = resolveUniverseName(universeIndex, asked);
  if (canonical === null) {
    return c.json({ error: 'unknown_universe', asked, known: [...universeIndex.names] }, 404);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${ENTRY_COLS} FROM entry WHERE universe = ? ORDER BY source, series, series_index, title`,
  )
    .bind(canonical)
    .all();

  return c.json({ universe: canonical, matches: results });
});

/**
 * GET /api/health — rows and MAX(pushed_at) per source, every source always
 * listed. A source that has never pushed shows rows 0 / pushed_at null
 * instead of being absent, so staleness is visible rather than silent —
 * "zero rows from a source means the push failed, never that the collection
 * is empty" (design §1).
 */
readRoutes.get('/health', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT source, COUNT(*) AS rows, MAX(pushed_at) AS pushed_at FROM entry GROUP BY source',
  ).all<{ source: string; rows: number; pushed_at: string | null }>();

  const bySource = new Map(results.map((r) => [r.source, r]));
  const sources = Object.fromEntries(
    SOURCES.map((s) => [s, { rows: bySource.get(s)?.rows ?? 0, pushed_at: bySource.get(s)?.pushed_at ?? null }]),
  );

  return c.json({ ok: true, sources });
});
