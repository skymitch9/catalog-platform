/**
 * Estate backup metadata — GET /api/estate/backups (owner ask 2026-08-16:
 * "the estate backs up to a private R2 bucket... nothing surfaces whether
 * backups are actually still running... add a row showing the age of the
 * most recent backup").
 *
 * The bucket (`estate-backups`, written by .github/workflows/backup.yml) is
 * PRIVATE and MUST STAY PRIVATE — the browser can never read it directly.
 * This route is the one narrow window: it returns AGGREGATE METADATA ONLY
 * (a newest timestamp and an object count per known `<kind>/<store>`
 * prefix) and NEVER object contents, a signed URL, or a full listing a
 * caller could use to enumerate and fetch individual backups. `R2Bucket
 * .list()` in `summarizeBackups()` below reads only `key` and `uploaded` off
 * each `R2Object` — the body is never touched, and the response this route
 * sends back carries counts/timestamps exyed strictly to the fixed prefix
 * scoped strictly to the fixed prefix list, never a raw key list.
 *
 * Gating: requireDevops() (devops OR approver OR owner) — the same tier
 * `/api/estate/docs/:slug` and `POST /api/estate/ops/pipeline` use. Backup
 * health is operational information (the same category as "is the pipeline
 * running"), not membership-directory data, so devops is the right floor:
 * narrower than every signed-in member, no narrower than the other
 * operational surfaces already on this tier. CORS is apex-only (index.ts),
 * mirroring docs.ts and ops.ts.
 *
 * KNOWN_BACKUP_PREFIXES is the same `<kind>/<store>` list
 * scripts/prune-r2-backups.mjs prunes (the retention job's own invocation in
 * .github/workflows/backup.yml) — kept as one literal copy here rather than
 * derived, because there is no shared module between a GitHub Actions shell
 * step and this Worker; if a store is ever added to backup.yml's matrices,
 * add it here too (and to prune-r2-backups.mjs's argument list) in the same
 * change, or the new store's backups will silently not appear in this
 * summary despite being written and pruned correctly.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';

export const KNOWN_BACKUP_PREFIXES = [
  'd1/library-catalog',
  'd1/board-game-catalog',
  'd1/index_catalog',
  'd1/estate_auth',
  'firestore/audiobook-catalog',
  'r2/library-covers',
  'r2/audiobook-covers',
  'r2/game-covers',
] as const;

export interface BackupPrefixSummary {
  newest: string | null; // ISO 8601, or null when the prefix has never been written
  count: number;
}

export interface BackupsSummary {
  prefixes: Record<string, BackupPrefixSummary>;
  newestOverall: string | null;
}

/** The minimal surface this module needs off R2Bucket — narrow on purpose
 *  so a fake in tests never has to implement more than list(). */
export interface ListableBucket {
  list(options: { prefix: string }): Promise<{ objects: { key: string; uploaded: Date }[] }>;
}

/**
 * One `list()` call per known prefix (retention keeps at most 8 objects per
 * prefix, so a single unpaginated call always sees everything — no cursor
 * loop needed). Reads only `key`/`uploaded` off each object; never fetches a
 * body, never returns a key, never returns anything a caller could turn into
 * a `GET` on the bucket.
 */
export async function summarizeBackups(bucket: ListableBucket): Promise<BackupsSummary> {
  const prefixes: Record<string, BackupPrefixSummary> = {};
  let newestOverallMs: number | null = null;

  for (const prefix of KNOWN_BACKUP_PREFIXES) {
    const listed = await bucket.list({ prefix: `${prefix}/` });
    let newestMs: number | null = null;
    for (const obj of listed.objects) {
      const ms = obj.uploaded instanceof Date ? obj.uploaded.getTime() : Date.parse(String(obj.uploaded));
      if (Number.isFinite(ms) && (newestMs === null || ms > newestMs)) newestMs = ms;
    }
    prefixes[prefix] = {
      newest: newestMs === null ? null : new Date(newestMs).toISOString(),
      count: listed.objects.length,
    };
    if (newestMs !== null && (newestOverallMs === null || newestMs > newestOverallMs)) {
      newestOverallMs = newestMs;
    }
  }

  return {
    prefixes,
    newestOverall: newestOverallMs === null ? null : new Date(newestOverallMs).toISOString(),
  };
}

export const backupsRoutes = new Hono<AppBindings>();

backupsRoutes.get('/estate/backups', requireDevops(), async (c) => {
  const bucket = c.env.ESTATE_BACKUPS;
  if (!bucket) {
    // Same app_tokens_unset idiom as every other missing-config path in this
    // Worker — "binding absent" must never be confused with "bucket empty".
    return c.json({ error: 'backups_bucket_unbound', fix: 'add the ESTATE_BACKUPS r2_buckets binding' }, 503);
  }

  const summary = await summarizeBackups(bucket);
  return c.json({
    ok: true,
    time: new Date().toISOString(),
    newest_overall: summary.newestOverall,
    prefixes: summary.prefixes,
  });
});
