/**
 * The series read surface, and the approver's confirm queue.
 *
 *   GET  /api/series                      every series visible to you, per-source counts
 *   GET  /api/series/pending              the confirm queue          (approver)
 *   POST /api/series/pending/:fold        merge, or keep separate    (approver)
 *   GET  /api/series/:slug                one series, grouped by medium
 *
 * ⚠️ MEMBERS-ONLY, AND SCOPED — mounted BELOW `requireEstateMember()` in
 * index.ts, deliberately NOT named above it the way /api/search is. §4.5's
 * anonymous carve-out is search-only and says so; this surface is /api/universe's
 * sibling (a browse of everything the estate holds under one name), so it takes
 * /api/universe's stance: membership to get in, the member's own visibility set
 * to decide what is inside. Widening it to the anonymous internet later is one
 * line and an owner's decision; it is not a side effect of building the page.
 *
 * ⚠️ THE LIST IS DERIVED FROM SCOPED ENTRY ROWS, NEVER FROM THE `series`
 * TABLE, and that is a leak fix rather than an implementation detail. The
 * registry is estate-wide: listing it would tell an audiobook-only member the
 * NAMES of every series in the two private catalogs, which is exactly what
 * §4.5's scoping exists to prevent. Counting from `entry WHERE source IN (…)`
 * makes the SQL the scope here too — a series nobody in your scope holds does
 * not exist as far as this endpoint is concerned. Same reason `/api/series/:slug`
 * answers `unknown_series` for a slug that is real but wholly out of scope:
 * distinguishing "private" from "absent" would leak the fact itself.
 *
 * The counts are computed in JS over a plain row scan, matching search.ts's
 * deliberate no-FTS, no-extra-index scan of the same table (~2,400 rows at
 * full scope). One SELECT, no GROUP BY, no JOIN — which also keeps the shape
 * simple enough that the tests' fake D1 exercises the REAL SQL.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import type { ScopeVariables } from './middleware/scope.js';
import { requireOwnerStanding } from './middleware/auth.js';
import { sourcesForScope } from './search-route.js';
import { slugForFold } from './series.js';

export const seriesRoutes = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

/** What the per-series list needs; deliberately the narrow projection. */
interface CountRow {
  series_slug: string;
  series: string | null;
  source: string;
}

/** What the detail page needs — source + title + index + cover + link, plus the medium. */
const DETAIL_COLS =
  'source, source_id, title, creator, series, series_index, year, publisher, format, kind, cover_url, detail_url';

interface DetailRow {
  source: string;
  source_id: string;
  title: string;
  creator: string | null;
  series: string | null;
  series_index: number | null;
  year: number | null;
  publisher: string | null;
  format: string;
  kind: string | null;
  cover_url: string | null;
  detail_url: string | null;
}

/**
 * GET /api/series — the index behind the apex's series page.
 *
 * Sorted by SLUG, not by display name, and that is a feature: the slug is the
 * fold, which has already dropped the leading article, so "The Stormlight
 * Archive" files under S where a reader looks for it.
 */
seriesRoutes.get('/series', async (c) => {
  const scope = c.get('visibility');
  if (scope.length === 0) {
    return c.json({ scope, count: 0, series: [], reason: 'no_catalogs_visible' });
  }

  const sources = sourcesForScope(scope);
  const placeholders = sources.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT series_slug, series, source FROM entry WHERE series_slug IS NOT NULL AND source IN (${placeholders})`,
  )
    .bind(...sources)
    .all<CountRow>();

  const bySlug = new Map<string, { slug: string; display_name: string; total: number; sources: Record<string, number> }>();
  for (const row of results ?? []) {
    let group = bySlug.get(row.series_slug);
    if (!group) {
      group = { slug: row.series_slug, display_name: row.series ?? row.series_slug, total: 0, sources: {} };
      bySlug.set(row.series_slug, group);
    }
    group.total += 1;
    group.sources[row.source] = (group.sources[row.source] ?? 0) + 1;
  }

  const series = [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return c.json({ scope, count: series.length, series });
});

// --- The confirm queue. Approver-gated, and mounted BEFORE /series/:slug so
//     `pending` is never read as a slug. ---------------------------------------

seriesRoutes.use('/series/pending', requireOwnerStanding());
seriesRoutes.use('/series/pending/*', requireOwnerStanding());

interface PendingRow {
  candidate_fold: string;
  candidate_display: string;
  candidate_slug: string;
  closest_slug: string;
  closest_display: string;
  near_key: string;
  sample_titles: string;
  sources: string;
  created_at: string;
  resolved_at: string | null;
  resolved_as: string | null;
  resolved_by: string | null;
}

/**
 * GET /api/series/pending — near misses awaiting a human.
 *
 * Open rows by default; `?include=resolved` also returns what was already
 * decided, because "why are these still two series?" is a question the
 * ANSWERED rows answer.
 */
seriesRoutes.get('/series/pending', async (c) => {
  const includeResolved = c.req.query('include') === 'resolved';
  const sql = includeResolved
    ? 'SELECT * FROM series_pending ORDER BY created_at DESC'
    : 'SELECT * FROM series_pending WHERE resolved_at IS NULL ORDER BY created_at DESC';
  const { results } = await c.env.DB.prepare(sql).all<PendingRow>();

  const pending = (results ?? []).map((r) => ({
    candidate_fold: r.candidate_fold,
    candidate_display: r.candidate_display,
    candidate_slug: r.candidate_slug,
    closest_slug: r.closest_slug,
    closest_display: r.closest_display,
    near_key: r.near_key,
    sample_titles: safeJson(r.sample_titles),
    sources: safeJson(r.sources),
    created_at: r.created_at,
    resolved_at: r.resolved_at,
    resolved_as: r.resolved_as,
    resolved_by: r.resolved_by,
  }));

  return c.json({
    count: pending.length,
    open: pending.filter((p) => p.resolved_at === null).length,
    // Said out loud on every read: an unresolved row is not a pending MERGE.
    // Nothing is waiting to happen; the two series simply stay two.
    meaning: 'these folds differ, so nothing was merged. Resolving one either merges it or records that they are genuinely different.',
    pending,
  });
});

/**
 * POST /api/series/pending/:fold — the decision. `{ "action": "merge",
 * "into": "<slug>" }` or `{ "action": "separate" }`.
 *
 * `into` must be one of the two slugs in the row (default: the closest). The
 * OTHER one is absorbed — so an approver can equally say "the candidate's
 * spelling is the right one" without a second endpoint, and cannot silently
 * fold a third, unrelated series into either.
 */
seriesRoutes.post('/series/pending/:fold', async (c) => {
  const fold = decodeURIComponent(c.req.param('fold'));
  const approver = c.get('email') ?? 'unknown';

  let body: { action?: string; into?: string };
  try {
    body = (await c.req.json()) as { action?: string; into?: string };
  } catch {
    return c.json({ error: 'invalid_json', usage: '{"action":"merge","into":"<slug>"} or {"action":"separate"}' }, 400);
  }

  const row = await c.env.DB.prepare('SELECT * FROM series_pending WHERE candidate_fold = ?')
    .bind(fold)
    .first<PendingRow>();
  if (!row) {
    return c.json({ error: 'unknown_pending', candidate_fold: fold, detail: 'no queue entry has that fold' }, 404);
  }
  if (row.resolved_at !== null) {
    return c.json(
      {
        error: 'already_resolved',
        candidate_fold: fold,
        resolved_as: row.resolved_as,
        resolved_at: row.resolved_at,
        detail: 'this queue entry was already decided; resolved rows are kept so the decision is never re-asked',
      },
      409,
    );
  }

  const now = new Date().toISOString();

  if (body.action === 'separate') {
    await c.env.DB.prepare(
      "UPDATE series_pending SET resolved_at = ?, resolved_as = 'separate', resolved_by = ? WHERE candidate_fold = ?",
    )
      .bind(now, approver, fold)
      .run();
    return c.json({
      ok: true,
      candidate_fold: fold,
      resolved_as: 'separate',
      detail: `"${row.candidate_display}" and "${row.closest_display}" stay two series. Nothing moved; the queue will not ask again.`,
      rows_repointed: 0,
    });
  }

  if (body.action !== 'merge') {
    return c.json(
      { error: 'unknown_action', detail: 'action must be "merge" or "separate"', got: body.action ?? null },
      400,
    );
  }

  const surviving = body.into ?? row.closest_slug;
  const pair = [row.candidate_slug, row.closest_slug];
  if (!pair.includes(surviving)) {
    return c.json(
      {
        error: 'invalid_target',
        detail: 'merge `into` must be one of the two slugs in this queue entry — a merge into anything else is a different decision, made with different evidence',
        choices: pair,
      },
      422,
    );
  }
  const absorbed = surviving === row.candidate_slug ? row.closest_slug : row.candidate_slug;

  const survivingRow = await c.env.DB.prepare('SELECT slug, display_name FROM series WHERE slug = ?')
    .bind(surviving)
    .first<{ slug: string; display_name: string }>();
  if (!survivingRow) {
    return c.json({ error: 'unknown_series', slug: surviving, detail: 'that slug is not in the registry' }, 404);
  }
  const absorbedRow = await c.env.DB.prepare('SELECT slug, display_name FROM series WHERE slug = ?')
    .bind(absorbed)
    .first<{ slug: string; display_name: string }>();

  // One batch: the alias, the repointed rows, the emptied slug, the decision.
  // D1 runs a batch transactionally, so there is no window in which an entry
  // points at a slug the registry has already dropped.
  const absorbedFold = foldForSlug(absorbed);
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT OR REPLACE INTO series_alias (alias_fold, slug, alias_display, decided_how, created_at) VALUES (?, ?, ?, 'human', ?)",
    ).bind(absorbedFold, surviving, absorbedRow?.display_name ?? absorbed, now),
    // Any alias that pointed at the absorbed slug follows it, or it becomes a
    // dangling merge — the one case series.ts refuses to guess its way out of.
    c.env.DB.prepare('UPDATE series_alias SET slug = ? WHERE slug = ?').bind(surviving, absorbed),
    c.env.DB.prepare('UPDATE entry SET series_slug = ?, series = ? WHERE series_slug = ?').bind(
      surviving,
      survivingRow.display_name,
      absorbed,
    ),
    c.env.DB.prepare('DELETE FROM series WHERE slug = ?').bind(absorbed),
    c.env.DB.prepare(
      "UPDATE series_pending SET resolved_at = ?, resolved_as = 'merged', resolved_by = ? WHERE candidate_fold = ?",
    ).bind(now, approver, fold),
  ]);

  const repointed = Number(results[2]?.meta?.changes ?? 0);
  return c.json({
    ok: true,
    candidate_fold: fold,
    resolved_as: 'merged',
    surviving_slug: surviving,
    surviving_display: survivingRow.display_name,
    absorbed_slug: absorbed,
    rows_repointed: repointed,
    detail: `every row under "${absorbedRow?.display_name ?? absorbed}" now reads "${survivingRow.display_name}". Future pushes of either spelling resolve here through the alias.`,
  });
});

/**
 * GET /api/series/:slug — one series, grouped by MEDIUM.
 *
 * "Medium" is the row's own `format` — the estate's four values are already a
 * medium vocabulary (audiobook / ebook / book / boardgame, measured live
 * 2026-08-16). No second taxonomy is invented on top: an unfamiliar format
 * from a future source shows up as its own group under its own name rather
 * than being sorted into a bucket somebody guessed at.
 */
seriesRoutes.get('/series/:slug', async (c) => {
  const slug = c.req.param('slug');
  const scope = c.get('visibility');
  if (scope.length === 0) {
    return c.json({ slug, scope, media: [], total: 0, reason: 'no_catalogs_visible' });
  }

  const sources = sourcesForScope(scope);
  const placeholders = sources.map(() => '?').join(', ');
  const { results } = await c.env.DB.prepare(
    `SELECT ${DETAIL_COLS} FROM entry WHERE series_slug = ? AND source IN (${placeholders}) ORDER BY series_index, title`,
  )
    .bind(slug, ...sources)
    .all<DetailRow>();

  const rows = results ?? [];
  if (rows.length === 0) {
    // Deliberately the same answer for "no such series" and "a real series you
    // cannot see" — see the file header. A 404 that only fires for the former
    // would confirm the latter's existence.
    return c.json(
      { error: 'unknown_series', slug, detail: 'no series with that key is visible to you' },
      404,
    );
  }

  const registry = await c.env.DB.prepare('SELECT display_name FROM series WHERE slug = ?')
    .bind(slug)
    .first<{ display_name: string }>();

  const byMedium = new Map<string, DetailRow[]>();
  for (const row of rows) {
    const bucket = byMedium.get(row.format);
    if (bucket) bucket.push(row);
    else byMedium.set(row.format, [row]);
  }

  const media = [...byMedium.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([medium, entries]) => ({ medium, count: entries.length, entries }));

  return c.json({
    slug,
    display_name: registry?.display_name ?? rows[0]?.series ?? slug,
    scope,
    total: rows.length,
    media,
  });
});

/** The slug back to its fold. A bijection — `normaliseTitle` leaves no hyphens to confuse. */
function foldForSlug(slug: string): string {
  return slug.replace(/-/g, ' ');
}

/** Round-trip guard for the above, exported for the tests to pin. */
export function slugFoldRoundTrips(fold: string): boolean {
  return foldForSlug(slugForFold(fold)) === fold;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // A malformed JSON column is a bug, not a reason to 500 a queue read —
    // hand back the raw text so the reader can see what is actually stored.
    return raw;
  }
}
