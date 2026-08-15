/**
 * GET /api/health — open by design (conformance §8.2 #3's named exception,
 * same stance as the auth Worker's health route). Counts and timestamps only;
 * no titles, no emails — nothing here is worth gating.
 *
 * ⚠️ Envelope normalization (estate item 5, 2026-08-14): every estate health
 * endpoint now ALSO answers `{ ok, service, time, detail }`, `detail` holding
 * this route's own pre-existing shape verbatim. `sources` stays at the top
 * level too — additive only, nothing removed this pass; see
 * docs/info/health-envelope.md for the transition plan and its removal step.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { SOURCES } from './rows.js';

export const healthRoutes = new Hono<{ Bindings: Env }>();

/**
 * Rows and MAX(pushed_at) per source, every source always listed. A source
 * that has never pushed shows rows 0 / pushed_at null instead of being
 * absent, so staleness is visible rather than silent — "zero rows from a
 * source means the push failed, never that the collection is empty" (§1).
 */
healthRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT source, COUNT(*) AS rows, MAX(pushed_at) AS pushed_at FROM entry GROUP BY source',
  ).all<{ source: string; rows: number; pushed_at: string | null }>();

  const bySource = new Map(results.map((r) => [r.source, r]));
  const sources = Object.fromEntries(
    SOURCES.map((s) => [s, { rows: bySource.get(s)?.rows ?? 0, pushed_at: bySource.get(s)?.pushed_at ?? null }]),
  );

  // The pre-envelope shape, unchanged — nested under `detail` AND kept at the
  // top level (additive transition, see file header). Spread FIRST so the
  // explicit envelope fields after it are an intentional override, not a
  // silently-shadowed duplicate (tsc flags the reverse order, TS2783).
  const legacy = { ok: true, sources };

  return c.json({
    ...legacy,
    service: 'catalog-index',
    time: new Date().toISOString(),
    detail: legacy,
  });
});
