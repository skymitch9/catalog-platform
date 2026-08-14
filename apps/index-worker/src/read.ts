/**
 * The read surface: lookup and universe. (Health lives in health.ts — open by
 * design, mounted before the auth blanket.)
 *
 * ⚠️ AUTH DOES NOT LIVE IN THIS FILE, AND THAT IS DELIBERATE — these routes
 * are estate-members-only (design §9 Q3, answered by estate-auth-design.md
 * §7.1), enforced by the `requireEstateMember()` blanket in index.ts mounted
 * BEFORE this router. Adding a route here puts it behind that blanket
 * automatically; an open or machine route belongs in index.ts, named, with a
 * comment (conformance §8.2 #3).
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

