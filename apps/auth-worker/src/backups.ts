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
 * sends back carries counts/timestamps scoped strictly to the fixed prefix
 * list, never a raw key list.
 *
 * The route also GRADES what it found (`gradeBackups()` below) rather than
 * shipping raw numbers for the page to judge: the thresholds then have exactly
 * one home and are unit-tested here. ⚠️ Read that function's header before
 * touching a threshold — they are deliberately calendar/exposure-based, never
 * cadence-based, because backup.yml has no cron.
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
  // The second library instance (the `padhard.heygabi.ai` shelf). Added
  // 2026-08-18: the restore drill found it live with 6 works / 34 change_log
  // rows / 32 migrations and NO backup anywhere (RECOVERY.md §1b hole #1) —
  // absent from all three of the places a store has to be listed.
  'd1/library-catalog-2nd',
  'd1/board-game-catalog',
  'd1/index_catalog',
  'd1/estate_auth',
  'firestore/audiobook-catalog',
  'r2/library-covers',
  'r2/audiobook-covers',
  'r2/game-covers',
  // The two gated manifest/doc buckets, added 2026-08-18 (RECOVERY.md §1b
  // holes #5/#6). Tiny — 107 kB and 1.27 MB — and both are republished by a
  // publisher that runs on the OWNER'S MACHINE, which is the whole reason
  // they are worth a copy that does not depend on that machine.
  // ⚠️ `estate-ebooks` (1.81 GB) and `estate-audio` are deliberately NOT here
  // — see .github/workflows/backup.yml's `r2` job for that reasoning.
  'r2/ebooks-gated',
  'r2/estate-docs-gated',
] as const;

export interface BackupPrefixSummary {
  newest: string | null; // ISO 8601, or null when the prefix has never been written
  /**
   * ⚠️ GENERATIONS, not objects. An oversized bucket dump is split into
   * `<STAMP>.tar.gz.part-aa`, `.part-ab`, … (measured 2026-08-18: the
   * `audiobook-covers` tarball hit 313.5 MiB against `wrangler r2 object
   * put`'s 300 MiB hard cap), so one night can be several keys. Counting
   * objects would report "9 backups" for a single split night and read
   * healthier than the estate is. `scripts/prune-r2-backups.mjs` groups the
   * same way, for the harsher reason that counting keys there DELETES real
   * backups.
   */
  count: number;
}

/**
 * The generation stamp a key belongs to — everything up to the first `.` of
 * the basename. ⚠️ Deliberately a second copy of
 * `scripts/lib/backup-keys.mjs`'s `generationOf`, for the same reason
 * KNOWN_BACKUP_PREFIXES is a literal copy: there is no shared module between a
 * Node script and this Worker. If the key grammar ever changes, change both —
 * the test file asserts this function against the same cases.
 */
export function generationOf(key: string): string {
  const base = key.slice(key.lastIndexOf('/') + 1);
  const dot = base.indexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
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
    const generations = new Set<string>();
    for (const obj of listed.objects) {
      generations.add(generationOf(obj.key));
      const ms = obj.uploaded instanceof Date ? obj.uploaded.getTime() : Date.parse(String(obj.uploaded));
      if (Number.isFinite(ms) && (newestMs === null || ms > newestMs)) newestMs = ms;
    }
    prefixes[prefix] = {
      newest: newestMs === null ? null : new Date(newestMs).toISOString(),
      count: generations.size,
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

// ---------------------------------------------------------------------------
// Grading — "when did a backup last land, and is that OK?"
// ---------------------------------------------------------------------------

/**
 * ⚠️ THE THRESHOLDS ARE CALENDAR-BASED, DELIBERATELY, AND MUST STAY THAT WAY.
 *
 * `.github/workflows/backup.yml` is `workflow_dispatch`-only — there is NO
 * cron and therefore NO expected cadence to measure against. A long age here
 * genuinely can mean "nobody pressed the button", NOT "the backup is broken",
 * and every string this module's consumers render says so. What these
 * thresholds measure is EXPOSURE — "how much would the estate lose if disaster
 * struck right now" — which is a real wall-clock question no matter how the
 * last backup was triggered.
 *
 * 14 days amber (worth a glance), 45 days red (six-plus weeks with no fresh
 * copy is a real risk regardless of intent). Both are round numbers chosen for
 * that exposure question, NOT measurements — there is no historical cadence to
 * derive them from, and claiming otherwise would be the exact dishonesty this
 * comment exists to prevent. Changing either is a deliberate act: the tests in
 * test/backups.test.ts assert both to the millisecond and will fail loudly.
 *
 * These live HERE (server-side) rather than in the status page so there is one
 * copy: status.js renders the `state` this module decides and owns no
 * threshold of its own.
 */
export const BACKUP_STALE_AMBER_MS = 14 * 24 * 3600_000;
export const BACKUP_STALE_RED_MS = 45 * 24 * 3600_000;

/**
 * Human labels for the `<kind>` half of each known prefix.
 *
 * ⚠️ REWRITTEN 2026-08-18 on the owner's instruction — "lets also rename all the
 * jobs/checks/workers/etc to be a bit more descriptive. like d1 db export 5
 * stores expand that to make a bit more sense." A row label has to answer WHAT
 * this is and ON WHAT without the reader knowing the codebase. "D1 database
 * exports (5 stores)" told a reader who already knows what D1 is nothing new,
 * and everyone else nothing at all.
 *
 * ⚠️ "Cover buckets" was also WRONG BY DRIFT, which is the sharper reason to
 * rewrite these rather than merely lengthen them. The `r2` group gained
 * `ebooks-gated` and `estate-docs-gated` on 2026-08-18 and neither is a cover
 * bucket, so the label described three fifths of its group and quietly
 * mis-described the rest. A stale label on a backup row is how a store nobody
 * realises is in the group stops getting looked at.
 *
 * ⚠️ THE KEYS (`d1`, `firestore`, `r2`) ARE IDENTITIES AND DO NOT MOVE — they
 * are the first path segment of every stored key and the `kind` the page groups
 * on. Only the display strings changed.
 *
 * ⚠️ AND DELIBERATELY NO COUNTS IN THE WORDS: the row appends the MEASURED
 * "(N stores)" itself, so a label that spelled a number would go stale the day a
 * store is added — which is exactly how the last one went wrong.
 */
export const BACKUP_KIND_LABELS: Record<string, string> = {
  d1: 'Catalog databases — SQL exports',
  firestore: 'Audiobook catalog — Firestore document dump',
  r2: 'Cover images & gated files — R2 bucket archives',
};

export type BackupState = 'ok' | 'warn' | 'danger';

export interface BackupGroupGrade {
  /** `d1` | `firestore` | `r2`, or `all` for the roll-up across every kind. */
  kind: string;
  label: string;
  /** How many `<kind>/<store>` prefixes this group covers. */
  stores: number;
  /** Total objects across the group (retention keeps 8 per store). */
  count: number;
  /** Freshest object anywhere in the group, ISO 8601 or null. */
  newest: string | null;
  /**
   * ⚠️ The STALEST store's newest object — this, not `newest`, is what the
   * group is graded on. `newest` alone masks a dead store: backup.yml takes a
   * `target` input, so an `r2`-only run refreshes three stores and leaves the
   * other five untouched, and a group judged on its freshest member would read
   * green while a database had not been exported in months.
   */
  oldest: string | null;
  /** Which prefix `oldest` belongs to — the one to look at first. */
  oldest_store: string | null;
  /** now - oldest, in ms. Null when some store has never been written. */
  age_ms: number | null;
  /** Prefixes with zero objects: no backup of that store exists AT ALL. */
  never: string[];
  state: BackupState;
}

export interface BackupsGrade {
  kinds: BackupGroupGrade[];
  overall: BackupGroupGrade;
}

/** Age -> state. The only place the thresholds are compared against anything. */
export function gradeBackupAge(ageMs: number): BackupState {
  if (ageMs > BACKUP_STALE_RED_MS) return 'danger';
  if (ageMs > BACKUP_STALE_AMBER_MS) return 'warn';
  return 'ok';
}

function gradeGroup(
  kind: string,
  label: string,
  prefixNames: readonly string[],
  summary: BackupsSummary,
  nowMs: number,
): BackupGroupGrade {
  const never: string[] = [];
  let count = 0;
  let newestMs: number | null = null;
  let oldestMs: number | null = null;
  let oldestStore: string | null = null;

  for (const name of prefixNames) {
    const p = summary.prefixes[name];
    if (!p) continue;
    count += p.count;
    const ms = p.newest ? Date.parse(p.newest) : NaN;
    if (!Number.isFinite(ms)) {
      never.push(name);
      continue;
    }
    if (newestMs === null || ms > newestMs) newestMs = ms;
    if (oldestMs === null || ms < oldestMs) {
      oldestMs = ms;
      oldestStore = name;
    }
  }

  // A store with no object at all is not "stale", it is UNPROTECTED — a
  // wall-clock threshold cannot express that, so it short-circuits to danger.
  // This is not a cadence judgement either: it says a copy does not exist,
  // which is true whoever did or did not press the button.
  const state: BackupState = never.length > 0
    ? 'danger'
    : oldestMs === null
      ? 'danger'
      : gradeBackupAge(nowMs - oldestMs);

  return {
    kind,
    label,
    stores: prefixNames.length,
    count,
    newest: newestMs === null ? null : new Date(newestMs).toISOString(),
    oldest: oldestMs === null ? null : new Date(oldestMs).toISOString(),
    oldest_store: never.length > 0 ? null : oldestStore,
    age_ms: never.length > 0 || oldestMs === null ? null : nowMs - oldestMs,
    never,
    state,
  };
}

/**
 * Per-kind + overall grades from a summary. Pure (summary + clock in, verdict
 * out) so every threshold decision is unit-testable without a bucket, a
 * Worker, or a browser. Kind ORDER follows KNOWN_BACKUP_PREFIXES rather than a
 * second literal list, so adding a store to that array is still the only edit
 * a new store needs here.
 */
export function gradeBackups(summary: BackupsSummary, nowMs: number): BackupsGrade {
  const byKind = new Map<string, string[]>();
  for (const prefix of KNOWN_BACKUP_PREFIXES) {
    const kind = prefix.split('/')[0]!;
    const list = byKind.get(kind);
    if (list) list.push(prefix);
    else byKind.set(kind, [prefix]);
  }

  const kinds = [...byKind.entries()].map(([kind, prefixNames]) =>
    gradeGroup(kind, BACKUP_KIND_LABELS[kind] ?? kind, prefixNames, summary, nowMs),
  );

  const overall = gradeGroup('all', 'Estate backups', KNOWN_BACKUP_PREFIXES, summary, nowMs);

  return { kinds, overall };
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
  const now = Date.now();
  const grade = gradeBackups(summary, now);
  return c.json({
    ok: true,
    time: new Date(now).toISOString(),
    newest_overall: summary.newestOverall,
    prefixes: summary.prefixes,
    // Grades are computed here, not on the page: one copy of the thresholds,
    // unit-tested. Still counts/timestamps/prefix NAMES only — `oldest_store`
    // and `never` carry the same `<kind>/<store>` strings `prefixes` already
    // keys by, never an object key, never anything fetchable.
    kinds: grade.kinds,
    overall: grade.overall,
  });
});
