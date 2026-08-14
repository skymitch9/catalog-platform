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
import type { Env } from './env.js';
import { pushTokenFor } from './env.js';
import type { EntryRow } from './rows.js';
import { entryFor, isSource, pushBodySchema, snapshotProblems } from './rows.js';
import { universeIndex } from './universes-data.js';

/**
 * Bearer-token check. Length-gated `crypto.subtle.timingSafeEqual` — the
 * length itself is not a secret worth hiding, the token bytes are.
 */
async function tokenMatches(header: string | undefined, expected: string): Promise<boolean> {
  if (!header?.startsWith('Bearer ')) return false;
  const given = new TextEncoder().encode(header.slice('Bearer '.length));
  const want = new TextEncoder().encode(expected);
  if (given.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(given, want);
}

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

  await replaceSource(c.env.DB, source, entries);

  return c.json({
    ok: true,
    source,
    rows: entries.length,
    pushed_at: pushedAt,
    // Refusals surfaced per push, so a source can see its own degenerate rows
    // without querying — matched_via-style honesty about what will not join.
    unfoldable_titles: entries.filter((e) => e.title_fold === null).length,
  });
});

const INSERT_ENTRY = `INSERT INTO entry (
  source, source_id, title, creator, title_fold, work_fold, universe,
  series, series_index, year, publisher, format, kind, parent_source_id,
  cover_url, detail_url, pushed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function replaceSource(db: D1Database, source: string, entries: readonly EntryRow[]): Promise<void> {
  const statements = [
    db.prepare('DELETE FROM entry WHERE source = ?').bind(source),
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
