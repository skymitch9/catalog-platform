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

/**
 * The build this Worker is running, reported on /api/health.
 *
 * ⚠️ ADDED 2026-08-18 because the Health page said so. Its "Deployed versions"
 * section renders each Worker's own `version` — the build actually executing,
 * read from the thing executing it — and this Worker reported none, so its row
 * sat permanently AMBER saying "Healthy, but reports no version." The owner
 * pasted that row and asked for it fixed. A row that is amber forever is a row
 * people learn to ignore, which costs more than the fact it was withholding.
 *
 * ⚠️ IT MUST TRACK package.json's `version` BY HAND. A Worker bundle cannot
 * read package.json at runtime, and the two catalog Workers that already answer
 * this field (library-catalog, board-game-catalog — both "0.1.0", measured live
 * 2026-08-18) carry the same hand-kept constant. Bump them together or this
 * reports a build that is not the one running, which is worse than reporting
 * nothing at all.
 */
export const WORKER_VERSION = '0.1.0';

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
  const legacy = { ok: true, version: WORKER_VERSION, sources };

  return c.json({
    ...legacy,
    service: 'catalog-index',
    time: new Date().toISOString(),
    detail: legacy,
  });
});
