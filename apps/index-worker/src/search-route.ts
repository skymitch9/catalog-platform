/**
 * GET /api/search?q=… — the as-you-type search behind the apex's box, now
 * VISIBILITY-SCOPED (estate design §4.5).
 *
 * ⚠️ Mounted BEFORE the requireEstateMember() blanket, BY NAME (conformance
 * §8.2 #3's named-exception rule, the push-routes precedent) — because this
 * is the one read that must answer the ANONYMOUS internet: §4.5's rule gives
 * an absent/invalid token the public slice ({audiobook}), never a 401. The
 * searchScope() middleware resolves EVERY caller to a visibility set (the
 * revoked to {}), and the scan below touches only rows whose source sits in
 * that set — so the SQL is the scope, and out-of-scope titles never reach the
 * ranker, the universe counts, or the wire.
 *
 * Everything else about the search is unchanged from read.ts's original: a
 * scored SCAN of the in-scope rows (~2,300 at full scope — deliberately no
 * FTS, no extra index); ranking and the §8 carve-out argument live in
 * search.ts; an unfoldable QUERY is not refused (the raw display-title lane
 * still finds the Korean rows, §3.1's own path).
 *
 * ⚠️ `source` (added for the search-normalization component, 2026-08-15):
 * an optional NARROWING query param — `library`|`game`|`audiobook`|`all` —
 * for a per-site scope preset (e.g. the library app only ever wants its own
 * shelf). It can only ever narrow the caller's own visibility, never widen
 * it: the requested source is intersected with `scope` from searchScope(),
 * so a stranger who asks for `source=library` gets an honest empty answer,
 * not a peek. `scope` in the response reflects what was ACTUALLY searched
 * after narrowing — the SQL is still the scope, same rule as before.
 */

import { Hono } from 'hono';
import type { Catalog } from '@platform/estate-auth';
import type { Env } from './env.js';
import { searchIndex, type SearchRow } from './search.js';
import { searchScope, type ScopeVariables } from './middleware/scope.js';
import { universeIndex } from './universes-data.js';

/** The same reader columns as read.ts — all display data, default-deny. */
const ENTRY_COLS =
  'source, source_id, title, creator, title_fold, work_fold, universe, series, series_index, year, publisher, format, kind, parent_source_id, cover_url, detail_url, pushed_at';

/**
 * Catalog (visibility vocabulary, §4.5) ↔ entry.source (push vocabulary).
 * They differ in exactly one place — games↔game — and this map is the one
 * spot that knows it.
 */
const SOURCE_FOR_CATALOG: Record<Catalog, string> = {
  audiobook: 'audiobook',
  library: 'library',
  games: 'game',
  // The second library instance (0007). NOT federated yet — its INDEX_URL /
  // INDEX_PUSH_TOKEN are deliberately unset (friend-ingest design §7), so no
  // `library2` rows exist and this scope entry matches nothing: fail-closed
  // by construction until federation day mints the push token.
  library2: 'library2',
};

export function sourcesForScope(scope: readonly Catalog[]): string[] {
  return scope.map((c) => SOURCE_FOR_CATALOG[c]);
}

/** The reverse of SOURCE_FOR_CATALOG — entry.source vocabulary → Catalog. */
const CATALOG_FOR_SOURCE: Record<string, Catalog> = Object.fromEntries(
  (Object.entries(SOURCE_FOR_CATALOG) as [Catalog, string][]).map(([catalog, source]) => [source, catalog]),
);

const VALID_SOURCE_PARAMS = new Set(['audiobook', 'library', 'game', 'all']);

export const searchRoutes = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

searchRoutes.use('*', searchScope());

searchRoutes.get('/', async (c) => {
  const raw = c.req.query('q');
  if (raw === undefined || raw.trim() === '') {
    return c.json({ error: 'missing_query', usage: '/api/search?q=…' }, 400);
  }
  const query = raw.trim();
  if (query.length < 2) {
    // One character ranks half the estate — not a search, a shrug. The
    // client keeps typing; the refusal is polite and named.
    return c.json({ error: 'query_too_short', detail: 'type at least two characters and the search will run' }, 422);
  }

  const scope = c.get('visibility');
  if (scope.length === 0) {
    // The revoked, and the narrowed-to-{} (§4.5 mirrors them deliberately):
    // an honest empty answer with its reason — a 200, not an error, because
    // "you may search, and nothing is visible to you" is a true answer.
    return c.json({
      query,
      scope,
      books: [],
      games: [],
      universes: [],
      reason: 'no_catalogs_visible',
    });
  }

  // The `source` narrowing param — a per-site scope preset. It can only
  // subtract from `scope`, never add: a source outside the caller's own
  // visibility intersects to nothing, answered the same honest-empty way a
  // caller with no matches gets, not an error.
  const sourceParam = c.req.query('source');
  let sources = sourcesForScope(scope);
  let effectiveScope = scope;
  if (sourceParam !== undefined && sourceParam !== '') {
    const requested = sourceParam.trim().toLowerCase();
    if (!VALID_SOURCE_PARAMS.has(requested)) {
      return c.json(
        { error: 'invalid_source', detail: 'source must be one of audiobook, library, game, or "all"' },
        400,
      );
    }
    if (requested !== 'all') {
      sources = sources.filter((s) => s === requested);
      const catalog = CATALOG_FOR_SOURCE[requested];
      effectiveScope = catalog && scope.includes(catalog) ? [catalog] : [];
    }
  }

  if (sources.length === 0) {
    // Not §4.5's "no_catalogs_visible" (that names an account-level state) —
    // this is "you asked for a shelf you cannot see", answered the same
    // shape as a query with no matches: an honest empty, no `reason`.
    return c.json({ query, scope: effectiveScope, books: [], games: [], universes: [] });
  }

  const placeholders = sources.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT ${ENTRY_COLS} FROM entry WHERE source IN (${placeholders})`,
  )
    .bind(...sources)
    .all();

  // Universe counts inherit the scope for free: searchIndex counts from the
  // rows it is handed, and out-of-scope rows were never fetched — a
  // games-only member's "×31" counts 31 game rows, not 25 library ones.
  const found = searchIndex(query, (results ?? []) as unknown as SearchRow[], universeIndex);
  return c.json({ query, scope: effectiveScope, ...found });
});
