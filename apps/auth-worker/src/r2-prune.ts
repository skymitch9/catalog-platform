/**
 * Estate backup RETENTION, as a Worker cron — `scripts/prune-r2-backups.mjs`'s
 * decision, run on a clock instead of on somebody remembering.
 *
 * Owner ask 2026-09-05 16:50 Phoenix (*"Should we make all the scripts routes?
 * Or at least the ones we use a lot"*), candidate #3 of
 * `docs/info/scripts-inventory-2026-09-05.md` §7: *"Pure R2 list+delete, no
 * disk, no local key. Retention that depends on somebody remembering is not
 * retention."*
 *
 * ## ⚠️ THE DECISION IS NOT WRITTEN HERE
 *
 * `planRetention()` lives in `scripts/lib/backup-keys.mjs` and is imported by
 * BOTH this module and the script. That is the inventory's own §6 rule — *"A
 * route and its script share ONE implementation … or the conversion has made
 * the estate worse"* — and retention is the case where it bites hardest: a
 * drifted matcher mismatches a game, a drifted retention rule DELETES A BACKUP.
 * The same import also retired `backups.ts`'s duplicate `generationOf`, whose
 * header had said a copy was unavoidable "because there is no shared module
 * between a Node script and this Worker". That was only ever true of `tsc`,
 * never of the bundler; `backup-keys.d.mts` is the four lines that answer tsc.
 *
 * ## ⚠️ THE PREFIX LIST AND THE DEPTH ARE NOT WRITTEN HERE EITHER
 *
 * `KNOWN_BACKUP_PREFIXES` (backups.ts) is already pinned to
 * `.github/workflows/backup.yml`'s retention invocation by `backups.test.ts`,
 * which PARSES that invocation rather than trusting a comment — the guard that
 * exists because `library-catalog-2nd` once went missing from all three copies
 * at once (RECOVERY.md §1b hole #1). This cron reuses that list, so the guard
 * covers it too, and `R2_PRUNE_KEEP` below is asserted against the same parsed
 * `--keep N`. Adding a store is still ONE edit in backup.yml plus one in
 * backups.ts, exactly as before.
 *
 * ## ⚠️ IT SHIPS IN SHADOW, AND THE POSTURE IS THE WHOLE SAFETY MODEL
 *
 * `R2_PRUNE_MODE` is `off | shadow | enforce`, shipped `shadow`:
 *
 *   off      the handler returns immediately; no list, no log, no cost
 *   shadow   lists, PLANS, logs every would-delete key — and deletes NOTHING
 *   enforce  the plan is executed
 *
 * The estate's standing rule is that enforcement rolls out off -> shadow ->
 * enforce and is flipped only on measured zero false denials, never as a side
 * effect of an unrelated deploy. Here the measurement is sharper than "no false
 * denials" because there is an independent oracle: the script's `--dry-run`
 * prints the same `dropKeys` array over the same listing, so a shadow run and a
 * dry run taken minutes apart must AGREE KEY FOR KEY. The gate, and the number
 * N, are written in `docs/access/backup-restore.md` §3.1 and `docs/TODO.md`.
 *
 * ⚠️ CI'S `retention` JOB STILL RUNS AND IS STILL THE PRIMARY. This cron is a
 * BACKSTOP, and the failure it is aimed at is named in backup.yml's own header:
 * *"GitHub DISABLES scheduled workflows on a repo with 60 days of no activity"*.
 * A retention job that stops with the workflow it lives in cannot report that
 * it stopped. That is also why enforce must not be rushed: today nothing is
 * unpruned, so the cost of shadow is zero and the cost of a wrong enforce is a
 * deleted backup.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { requireDevops } from './middleware/auth.js';
import { KNOWN_BACKUP_PREFIXES } from './backups.js';
import { planRetention } from '../../../scripts/lib/backup-keys.mjs';

/**
 * How many GENERATIONS survive per `<kind>/<store>` prefix.
 *
 * ⚠️ MUST EQUAL `--keep N` in `.github/workflows/backup.yml`'s retention step,
 * and `test/r2-prune.test.ts` parses that file and asserts it. Two retention
 * depths against one bucket is not "belt and braces" — it is whichever ran last
 * winning, silently.
 */
export const R2_PRUNE_KEEP = 8;

/**
 * ⚠️ MUST MATCH `[triggers] crons` in `wrangler.toml` CHARACTER FOR CHARACTER —
 * `test/crons.test.ts` reads the toml and asserts it. Both catalog repos carry
 * the same guard because the failure mode is silent: a dispatch string that
 * drifts from its trigger runs NOTHING for ever, while the trigger still shows
 * as installed in the dashboard.
 *
 * ## Why DAILY at 10:41 UTC
 *
 * Retention is a daily question because every WRITER is daily: `backup.yml`'s
 * cron is `12 9 * * *` and `scripts/backup-docs.mjs` runs from the owner's
 * machine at 03:00 local (task `EstateDocsBackupR2`). One new generation per
 * store per day means at most one generation to retire per store per day, so
 * running more often costs list calls for nothing, and running weekly would let
 * the bucket sit six generations over depth if CI stopped.
 *
 * 10:41 UTC specifically:
 *
 * - **After the CI run has finished**, not during it. `backup.yml` writes from
 *   09:12 and the whole workflow was measured at 144 s wall clock; ~89 minutes
 *   of slack absorbs a queued scheduled run (GitHub's own header warns that a
 *   `:00` schedule can be delayed by tens of minutes) without ever racing CI's
 *   own `retention` job for the same keys.
 * - **Off the hour and off the half hour** — `:00` is where every scheduler
 *   queues its burst, and the estate's other crons sit at `:07`, `:19`
 *   (the probe suite, in this same Worker) and every-2-minutes. `:41` collides with
 *   nothing.
 * - **A backstop, not the primary.** CI still prunes on every run. This exists
 *   for the failure backup.yml's own header names: *"GitHub DISABLES scheduled
 *   workflows on a repo with 60 days of no activity"* — a retention job that
 *   dies with the workflow it lives in cannot report that it died.
 */
export const R2_PRUNE_CRON = '41 10 * * *';

export type R2PruneMode = 'off' | 'shadow' | 'enforce';

/**
 * The posture, parsed. ⚠️ ANYTHING UNRECOGNISED IS `off`, NOT `enforce` — an
 * env var with a typo in it must not be able to start deleting backups. `off`
 * is also the answer when the var is absent, so a Worker deployed without the
 * var prunes nothing rather than inheriting a default nobody chose.
 */
export function parseR2PruneMode(value: string | undefined): R2PruneMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'shadow') return 'shadow';
  if (v === 'enforce') return 'enforce';
  return 'off';
}

/**
 * The minimal surface this module needs off `R2Bucket` — narrow on purpose so a
 * fake in tests never has to implement more than these two, and so the one
 * DESTRUCTIVE call in the whole Worker is visible in a five-line interface.
 */
export interface PrunableBucket {
  list(options: {
    prefix: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(key: string): Promise<void>;
}

export interface PrunePrefixResult {
  prefix: string;
  /** Generations found (never objects — a split night is ONE). */
  generations: number;
  /** Objects found, >= generations. */
  objects: number;
  /** Generations that survive. */
  kept: number;
  /**
   * The plan, in delete order. ⚠️ POPULATED IN EVERY MODE — in `shadow` this is
   * what is logged and compared against the script's `--dry-run`; in `enforce`
   * it is what was actually deleted (minus anything in `failed`).
   */
  wouldDelete: string[];
  /** Objects actually deleted. Always 0 unless mode is `enforce`. */
  deleted: number;
  /** Keys the delete refused, with the reason. Never silently dropped. */
  failed: { key: string; error: string }[];
  /** A listing failure for this prefix — the plan is then empty and untrusted. */
  error: string | null;
}

export interface PruneRunResult {
  mode: R2PruneMode;
  keep: number;
  started_at: string;
  finished_at: string;
  prefixes: PrunePrefixResult[];
  would_delete_total: number;
  deleted_total: number;
  /** Prefixes whose LISTING failed. ⚠️ Distinct from a failed delete. */
  listing_errors: number;
  delete_errors: number;
}

/**
 * Every object under one prefix, following the cursor.
 *
 * ⚠️ IT PAGINATES, unlike `summarizeBackups()` in backups.ts, and the
 * difference is not an oversight in either. That function reads a bucket
 * retention has already trimmed to 8 generations, so one page always sees
 * everything. THIS function is the thing that does the trimming, and it runs
 * precisely when the bucket is over depth — the case where assuming one page
 * would make it plan against a partial listing and keep the wrong eight.
 */
async function listAll(bucket: PrunableBucket, prefix: string): Promise<{ key: string }[]> {
  const all: { key: string }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    all.push(...page.objects);
    if (!page.truncated || !page.cursor) break;
    cursor = page.cursor;
  }
  return all;
}

export interface PruneOptions {
  mode: R2PruneMode;
  keep?: number;
  prefixes?: readonly string[];
  /** Injected in tests; the clock is never read twice for one run. */
  now?: () => number;
  log?: (line: string) => void;
}

/**
 * One retention pass across every known prefix.
 *
 * ⚠️ IT NEVER THROWS. A cron handler that throws halfway leaves the remaining
 * prefixes unexamined and reports one error instead of ten results; a listing
 * that fails for `r2/game-covers` says nothing about `d1/estate_auth`. Every
 * per-prefix failure is caught, recorded on that prefix's row, and the pass
 * continues — the run result then carries `listing_errors`/`delete_errors` so
 * a partial pass is legible as partial rather than as clean.
 *
 * ⚠️ AND A LISTING FAILURE PLANS NOTHING. `planRetention` over a partial or
 * empty listing would "keep the newest 8 of what came back" and delete real
 * backups on the strength of a network error. The catch below sets `error` and
 * leaves `wouldDelete` empty, deliberately.
 */
export async function runR2Prune(
  bucket: PrunableBucket,
  opts: PruneOptions,
): Promise<PruneRunResult> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  const keep = opts.keep ?? R2_PRUNE_KEEP;
  const prefixes = opts.prefixes ?? KNOWN_BACKUP_PREFIXES;
  const startedMs = now();

  const rows: PrunePrefixResult[] = [];
  for (const prefix of prefixes) {
    const row: PrunePrefixResult = {
      prefix,
      generations: 0,
      objects: 0,
      kept: 0,
      wouldDelete: [],
      deleted: 0,
      failed: [],
      error: null,
    };
    rows.push(row);

    let objects: { key: string }[];
    try {
      objects = await listAll(bucket, `${prefix}/`);
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
      log(`r2-prune: ${prefix} — LISTING FAILED (${row.error}); planned nothing for this prefix`);
      continue;
    }

    const plan = planRetention(objects, keep);
    row.generations = plan.generations;
    row.objects = plan.objects;
    row.kept = plan.keep.length;
    row.wouldDelete = plan.dropKeys;

    // ⚠️ Logged in EVERY mode, including when there is nothing to do. A prefix
    // that plans zero deletions and a prefix that was never examined look
    // identical in a silent log, and only one of them is fine — the same
    // reasoning the script's header gives for logging an empty prefix.
    log(
      `r2-prune[${opts.mode}]: ${prefix} — ${plan.generations} generation(s) / ${plan.objects} ` +
        `object(s), keeping ${plan.keep.length}, ` +
        `${opts.mode === 'enforce' ? 'deleting' : 'would delete'} ${plan.dropKeys.length}`,
    );
    for (const key of plan.dropKeys) {
      if (opts.mode !== 'enforce') {
        log(`r2-prune[${opts.mode}]:   would-delete: ${key}`);
        continue;
      }
      try {
        await bucket.delete(key);
        row.deleted += 1;
        log(`r2-prune[enforce]:   delete: ${key}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        row.failed.push({ key, error: message });
        log(`r2-prune[enforce]:   DELETE FAILED ${key} — ${message}`);
      }
    }
  }

  return {
    mode: opts.mode,
    keep,
    started_at: new Date(startedMs).toISOString(),
    finished_at: new Date(now()).toISOString(),
    prefixes: rows,
    would_delete_total: rows.reduce((n, r) => n + r.wouldDelete.length, 0),
    deleted_total: rows.reduce((n, r) => n + r.deleted, 0),
    listing_errors: rows.filter((r) => r.error !== null).length,
    delete_errors: rows.reduce((n, r) => n + r.failed.length, 0),
  };
}

// ---------------------------------------------------------------------------
// The cron
// ---------------------------------------------------------------------------

/** The narrow `Env` slice the cron needs — never the whole Bindings type. */
export interface R2PruneEnv {
  ESTATE_BACKUPS?: R2Bucket;
  R2_PRUNE_MODE?: string;
}

/**
 * The daily retention pass.
 *
 * ⚠️ IT NEVER THROWS, for the same reason the probe cron never does: a
 * scheduled handler that rejects records a failed invocation and nothing else,
 * and "retention did not run" is a fact nobody would learn until the bucket had
 * grown for weeks. Every failure is logged with what it was trying to do.
 *
 * ⚠️ `off` RETURNS BEFORE THE FIRST `list()`. A dark posture must cost nothing
 * — no subrequest, no log noise — or "turn it off" becomes something people are
 * reluctant to do.
 */
export async function scheduledR2Prune(env: R2PruneEnv): Promise<void> {
  const mode = parseR2PruneMode(env.R2_PRUNE_MODE);
  if (mode === 'off') {
    console.log('r2-prune[off]: posture is off — nothing listed, nothing deleted.');
    return;
  }

  const bucket = env.ESTATE_BACKUPS as unknown as PrunableBucket | undefined;
  if (!bucket) {
    // ⚠️ Loud, and specific about which of the two causes it is. "The binding
    // is missing" and "the bucket is empty" produce the same silence otherwise,
    // and only one of them is a deploy mistake.
    console.error(
      'r2-prune: posture is "' +
        mode +
        '" but this Worker has no ESTATE_BACKUPS binding, so retention did NOT run. ' +
        'Add the r2_buckets binding in apps/auth-worker/wrangler.toml.',
    );
    return;
  }

  try {
    const result = await runR2Prune(bucket, { mode, keep: R2_PRUNE_KEEP });
    console.log(
      `r2-prune[${mode}]: done — ${result.would_delete_total} object(s) ` +
        `${mode === 'enforce' ? 'planned' : 'would be deleted'}, ${result.deleted_total} deleted, ` +
        `${result.listing_errors} listing error(s), ${result.delete_errors} delete error(s), ` +
        `across ${result.prefixes.length} prefix(es), keeping ${result.keep} generation(s) each.`,
    );
  } catch (err) {
    // runR2Prune already catches per-prefix; this is the belt for anything
    // structural (a malformed prefix list, a binding that is not a bucket).
    console.error('r2-prune: the pass itself threw —', err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// The admin door
// ---------------------------------------------------------------------------

export const r2PruneRoutes = new Hono<AppBindings>();

/**
 * `POST /api/estate/backups/prune?dryRun=1` — the retention pass, on demand.
 *
 * ⚠️ NAMED FOR THIS WORKER'S CONVENTION, NOT `/admin/r2-prune`. Every route in
 * this Worker lives under `/api/estate/...`; a lone `/admin` prefix would be
 * the only one of its kind and would sit outside the `/api/*` rate-limit mount
 * in index.ts, which is a real difference and not a cosmetic one. It is
 * mounted next to `GET /api/estate/backups`, behind the same `requireDevops()`
 * gate, because it answers a question about the same bucket.
 *
 * ⚠️ `dryRun` DEFAULTS TO TRUE. A POST with no query string plans and deletes
 * nothing. Only an explicit `dryRun=0` asks for a real pass, and even that is
 * refused unless the posture is already `enforce` — so today, in shadow, this
 * route CANNOT delete an object no matter what it is sent. That is the shadow
 * gate expressed mechanically rather than as a promise.
 *
 * ⚠️ Every refusal is in words and names its own fix. Nobody meets a bare
 * status here: `requireDevops()` answers the four sign-in causes distinctly,
 * an unbound bucket says which binding is missing, and a `dryRun=0` in shadow
 * says which var to change and where the gate is written down.
 */
r2PruneRoutes.post('/estate/backups/prune', requireDevops(), async (c: Context<AppBindings>) => {
  const bucket = c.env.ESTATE_BACKUPS as unknown as PrunableBucket | undefined;
  if (!bucket) {
    // Same idiom as GET /api/estate/backups — "binding absent" must never be
    // confused with "bucket empty", and a 503 with a fix beats a 500.
    return c.json(
      {
        error: 'backups_bucket_unbound',
        detail:
          'This Worker has no ESTATE_BACKUPS binding, so it cannot see the backup bucket at all. ' +
          'Nothing was listed and nothing was deleted.',
        fix: 'Add the ESTATE_BACKUPS r2_buckets binding in apps/auth-worker/wrangler.toml and redeploy.',
      },
      503,
    );
  }

  const mode = parseR2PruneMode(c.env.R2_PRUNE_MODE);
  const dryRunParam = c.req.query('dryRun');
  // Absent -> dry run. Only the literal "0"/"false" asks for a real pass.
  const dryRun = !(dryRunParam === '0' || dryRunParam?.toLowerCase() === 'false');

  if (!dryRun && mode !== 'enforce') {
    return c.json(
      {
        error: 'r2_prune_not_enforcing',
        detail:
          `Retention is in "${mode}" posture, so a real prune is refused — nothing was deleted. ` +
          'A dry run works right now: POST the same URL with ?dryRun=1 (or with no query at all).',
        fix:
          'Flipping to enforce is a deliberate act with a written gate: see docs/access/backup-restore.md ' +
          '§3.1 and the shadow-gate box in docs/TODO.md. It is the R2_PRUNE_MODE var in ' +
          'apps/auth-worker/wrangler.toml, changed on its own and never as a side effect of another deploy.',
        mode,
      },
      409,
    );
  }

  const result = await runR2Prune(bucket, {
    // ⚠️ A dry run is a `shadow` pass whatever the posture says — the mode
    // decides what the CRON does; `dryRun` decides what THIS request does, and
    // the narrower of the two always wins.
    mode: dryRun ? 'shadow' : 'enforce',
    keep: R2_PRUNE_KEEP,
  });

  return c.json({
    ok: true,
    dry_run: dryRun,
    /** The Worker's standing posture, which a dry run does not change. */
    posture: mode,
    ...result,
  });
});
