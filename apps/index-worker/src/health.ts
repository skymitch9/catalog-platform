/**
 * GET /api/health — open by design (conformance §8.2 #3's named exception,
 * same stance as the auth Worker's health route). Counts and timestamps only;
 * no titles, no emails — nothing here is worth gating.
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

  return c.json({ ok: true, sources });
});
