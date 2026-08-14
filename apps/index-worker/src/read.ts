/**
 * The read surface: lookup and universe. (Health lives in health.ts — open by
 * design, mounted before the auth blanket. Search lives in search-route.ts —
 * mounted before the blanket TOO, by name, because §4.5's anonymous rule
 * gives a tokenless caller the public slice there; it is the one read that
 * must never 401.)
 *
 * ⚠️ AUTH DOES NOT LIVE IN THIS FILE, AND THAT IS DELIBERATE — these routes
 * are estate-members-only (design §9 Q3, answered by estate-auth-design.md
 * §7.1; the search carve-out is §4.5's anonymous rule), enforced by the
 * `requireEstateMember()` blanket in index.ts mounted BEFORE this router.
 * Adding a route here puts it behind that blanket automatically; an open or
 * machine route belongs in index.ts, named, with a comment (conformance §8.2
 * #3). The blanket also stamps the member's effective VISIBILITY set
 * (§4.5) into the context; scoped routes read it, /api/lookup deliberately
 * does not (owner call: lookup stays membership-gated, unscoped).
 *
 * These routes never auto-act. Title-only matching is safe HERE AND ONLY HERE
 * because the reader is a human looking at a result list with covers and
 * publishers (design §3.3); the 0.34/0.7 threshold lessons apply to
 * auto-acting matchers, of which this surface contains none. /api/lookup is
 * exact fold-joins only and stays that way — it is the exact-IDENTITY
 * endpoint. /api/search is the deliberate carve-out from §8's "no second
 * matcher": a ranked partial-match search for humans typing, which claims
 * resemblance and never identity — the full argument is search.ts's header.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { titleFoldOrNull } from './fold.js';
import type { ScopeVariables } from './middleware/scope.js';
import { sourcesForScope } from './search-route.js';
import { resolveUniverseName } from './universes.js';
import { universeIndex } from './universes-data.js';

export const readRoutes = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

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
 * GET /api/universe/:name — everything in one fiction, across every VISIBLE
 * catalog. The only cross-format join games participate in (design §3.2):
 * the DCC board game beside the DCC books, joined where the shared fact
 * actually exists.
 *
 * Scoped since §4.5: the rows are filtered to the member's effective
 * visibility set (stamped by the blanket) — the search's universe counts
 * only count in-scope rows, and this follow-up must show the same shelves
 * those counts counted, not quietly widen. A member narrowed to {} gets the
 * honest empty list, mirroring the revoked rule.
 */
readRoutes.get('/universe/:name', async (c) => {
  const asked = c.req.param('name');
  const canonical = resolveUniverseName(universeIndex, asked);
  if (canonical === null) {
    return c.json({ error: 'unknown_universe', asked, known: [...universeIndex.names] }, 404);
  }

  const scope = c.get('visibility');
  if (scope.length === 0) {
    return c.json({ universe: canonical, scope, matches: [], reason: 'no_catalogs_visible' });
  }

  const sources = sourcesForScope(scope);
  const placeholders = sources.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT ${ENTRY_COLS} FROM entry WHERE universe = ? AND source IN (${placeholders}) ORDER BY source, series, series_index, title`,
  )
    .bind(canonical, ...sources)
    .all();

  return c.json({ universe: canonical, scope, matches: results });
});

