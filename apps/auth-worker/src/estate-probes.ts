/**
 * The estate probe suite, on a clock — `tools/estate-probes` run hourly inside
 * this Worker, with the last run's summary persisted and surfaced.
 *
 * Owner ask 2026-09-05 16:50 Phoenix (*"Should we make all the scripts routes?
 * Or at least the ones we use a lot"*), candidate #4 of
 * `docs/info/scripts-inventory-2026-09-05.md` §7:
 *
 * > Pure HTTP against live hosts. This is the suite that catches an
 * > authorised-domain change *before* somebody quotes a 40-minute-old reading
 * > as current — the exact 2026-08-16 incident in the global rules.
 *
 * ## ⚠️ THE PROBE LIST IS NOT HERE
 *
 * `tools/estate-probes/lib/suite.mjs` owns the areas, the order, the
 * `NON_GET_ALLOWLIST` and the two discipline audits, and BOTH runners import
 * it — `npm run probe:estate` and this cron. That is the inventory's §6 rule:
 * *"A route and its script share ONE implementation … or the conversion has
 * made the estate worse."* Adding a probe is one edit, in `suite.mjs`, and this
 * file gets it for free. Nothing in `probes/` needed porting: the whole tree is
 * `fetch`/`Headers`/`AbortController`, with no `node:` import, no `process` and
 * no disk. `suite.mjs`'s header carries the table of what stays CLI-only and
 * why.
 *
 * ## Why HOURLY
 *
 * The incident this suite exists for is drift in someone else's console — a
 * Firebase authorised-domain list edited by hand, with no notification anywhere
 * — and the cost of that drift is that sign-in is broken for everybody, with
 * nothing on any dashboard saying so. The measurable question is *how long can
 * the estate be broken before anybody knows?*
 *
 * - **Hourly bounds that window at 60 minutes.** The 2026-08-16 incident
 *   (global rules, "a measurement has an age") went undetected long enough for
 *   a 40-minute-old reading to be quoted as current AGAINST the owner's live
 *   report. An hourly probe would have re-measured before that sentence was
 *   written.
 * - **Daily would bound it at 24 hours**, which for a broken front door is not
 *   a monitor, it is an obituary.
 * - **Sub-hourly buys nothing measurable.** Nobody edits an authorised-domain
 *   list several times an hour, and the cost is real: 145 assertions × 24 runs
 *   is ~3,500 outbound requests a day already, a large fraction of them back
 *   into the estate's own Workers.
 *
 * ⚠️ The minute is `:19` deliberately. The estate's other crons sit at `:07`
 * (both catalog details sweeps), every-2-minutes (the GABI gateway) and
 * every-30-minutes; `:00` is
 * where every scheduler on the platform queues its burst. `:19` collides with
 * nothing and is not on the hour.
 *
 * ## ⚠️ A FAILING PROBE RUN MUST NEVER THROW OUT OF `scheduled()`
 *
 * A probe failing is the suite WORKING — a red row is a finding about the
 * estate, not an error in the runner. If a failure propagated, Cloudflare would
 * record a failed invocation, nothing would be written to D1, and `/status`
 * would keep rendering the last good run for ever: the surface built to notice
 * an outage would go silent precisely during one. So `runScheduledProbes()`
 * catches everything, writes a row either way, and distinguishes "the suite
 * crashed" (`error` set) from "probes failed" (`failed > 0`) because they have
 * different fixes.
 */

import { runProbeSuite } from '../../../tools/estate-probes/lib/suite.mjs';
import type { ProbeResult } from '../../../tools/estate-probes/lib/suite.mjs';

/**
 * ⚠️ MUST MATCH `[triggers] crons` in `wrangler.toml` CHARACTER FOR CHARACTER —
 * `test/crons.test.ts` reads the toml and asserts it. The estate has this guard
 * in both catalog repos for a reason: a cron string that drifts from its
 * dispatch does not error, it silently runs NOTHING, for ever, while the
 * trigger still shows as installed in the dashboard.
 */
export const ESTATE_PROBES_CRON = '19 * * * *';

/**
 * Per-request timeout inside the Worker — far below the CLI's 15 s.
 *
 * ⚠️ A scheduled handler is not a laptop on hotel wifi. 145 requests at 15 s
 * each is 36 minutes of worst case; at 6 s it is under 15, and the deadline
 * below is the real bound anyway. 6 s is also generously above what these
 * endpoints actually take — the whole suite runs in well under a minute from a
 * terminal — so a timeout here means something is genuinely wrong, which is
 * exactly what the probe should report.
 */
export const PROBE_REQUEST_TIMEOUT_MS = 6_000;

/**
 * Wall-clock budget for the whole run, checked between areas.
 *
 * ⚠️ THE POINT IS TO RECORD SOMETHING RATHER THAN BE KILLED RECORDING NOTHING.
 * A Cloudflare-terminated invocation writes no row, and a missing row is
 * indistinguishable from a healthy estate on any surface that renders "the
 * newest run". 120 s is roughly 4× the suite's observed runtime and still far
 * inside the platform's limits, so it fires only in an outage — where a
 * `truncated` row saying "9 of 145 areas, ran out of time" is a far better
 * answer than silence.
 */
export const PROBE_DEADLINE_MS = 120_000;

/**
 * How many failures are stored on a run row.
 *
 * ⚠️ CAPPED BECAUSE THE WORST DAY IS THE BIGGEST WRITE. When every host is
 * down, all 145 probes fail with near-identical text; storing them whole would
 * put ~50 kB of duplicated "did not answer" into D1 every hour, during the
 * incident, when D1 is the thing you least want to be hammering. The first
 * N name the surface that broke, which is what a reader needs; the count is
 * always exact regardless of the cap.
 */
export const PROBE_FAILURES_STORED = 12;

/** How many run rows survive. 48 hourly runs = two days of history. */
export const PROBE_RUNS_KEPT = 48;

/** Truncation for any single stored string — an `observed` can be a whole body. */
const MAX_OBSERVED = 400;

export interface StoredProbeFailure {
  area: string;
  id: string;
  endpoint: string;
  assertion: string;
  observed: string;
}

export interface ProbeRunRow {
  started_at: string;
  finished_at: string;
  passed: number;
  failed: number;
  total: number;
  truncated: number;
  areas_run: number;
  areas_total: number;
  failures: string;
  trigger: string;
  error: string | null;
}

/** The `detail.estateProbes` shape on `/api/health`. */
export interface ProbeHealthDetail {
  started_at: string;
  finished_at: string;
  passed: number;
  failed: number;
  total: number;
  /** ⚠️ True = some areas were never asked. Never render this as green. */
  truncated: boolean;
  areas_run: number;
  areas_total: number;
  trigger: string;
  /** Set only when the RUNNER failed, as opposed to probes failing. */
  error: string | null;
  failures: StoredProbeFailure[];
  /** Age of `finished_at` in ms at the moment /health answered. */
  age_ms: number;
}

/**
 * Trim each failure to what a reader needs and nothing more.
 *
 * ⚠️ `observed` IS THE FIELD MOST LIKELY TO CARRY SOMETHING IT SHOULD NOT. The
 * probes are unauthenticated-edge and mint no tokens, so a body they capture is
 * a refusal envelope — but this row ends up on an open `/api/health`, so the
 * cap is a hard limit rather than a courtesy, and nothing but these five fields
 * is copied out of the result row.
 */
export function summariseFailures(results: ProbeResult[], cap = PROBE_FAILURES_STORED): StoredProbeFailure[] {
  return results
    .filter((r) => !r.ok)
    .slice(0, cap)
    .map((r) => ({
      area: String(r.area),
      id: String(r.id),
      endpoint: String(r.endpoint).slice(0, MAX_OBSERVED),
      assertion: String(r.assertion).slice(0, MAX_OBSERVED),
      observed: String(r.observed ?? '').slice(0, MAX_OBSERVED),
    }));
}

/** The narrow D1 surface this module needs — so a fake in tests stays small. */
export interface ProbeStore {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
      first<T>(): Promise<T | null>;
    };
    run(): Promise<unknown>;
    first<T>(): Promise<T | null>;
  };
}

/**
 * Write one run row and trim the history.
 *
 * ⚠️ NEVER THROWS. A probe run that cannot be recorded is worth a log line, not
 * a failed invocation — see this module's header. The one thing it must not do
 * is swallow the failure so completely that nobody can tell: the catch logs.
 */
export async function recordProbeRun(db: ProbeStore, row: ProbeRunRow): Promise<boolean> {
  try {
    await db
      .prepare(
        'INSERT INTO estate_probe_run ' +
          '(started_at, finished_at, passed, failed, total, truncated, areas_run, areas_total, failures, trigger, error) ' +
          'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)',
      )
      .bind(
        row.started_at,
        row.finished_at,
        row.passed,
        row.failed,
        row.total,
        row.truncated,
        row.areas_run,
        row.areas_total,
        row.failures,
        row.trigger,
        row.error,
      )
      .run();
    await db
      .prepare(
        'DELETE FROM estate_probe_run WHERE id NOT IN ' +
          '(SELECT id FROM estate_probe_run ORDER BY id DESC LIMIT ?1)',
      )
      .bind(PROBE_RUNS_KEPT)
      .run();
    return true;
  } catch (err) {
    console.error(
      'estate-probes: could not record the run —',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * The newest run, shaped for `/api/health`'s `detail.estateProbes`.
 *
 * ⚠️ RETURNS `null` — NOT A ZEROED OBJECT — WHEN NOTHING HAS EVER RUN, and the
 * page is required to word that difference. "no probe run has been recorded" and
 * "0 of 145 passed" are opposite sentences, and a zero-filled placeholder would
 * render the second while meaning the first. Same reasoning as the event ring's
 * `since` field (worker-events.ts).
 *
 * ⚠️ A MISSING TABLE ALSO ANSWERS `null`, not an exception. `/api/health` is
 * open by design and is what a deploy is curled against; a Worker deployed
 * ahead of its migration must still answer, minus this key.
 */
export async function readLatestProbeRun(db: ProbeStore, nowMs: number): Promise<ProbeHealthDetail | null> {
  let row: (ProbeRunRow & { id: number }) | null;
  try {
    row = await db
      .prepare(
        'SELECT id, started_at, finished_at, passed, failed, total, truncated, areas_run, areas_total, ' +
          'failures, trigger, error FROM estate_probe_run ORDER BY id DESC LIMIT 1',
      )
      .first<ProbeRunRow & { id: number }>();
  } catch {
    return null;
  }
  if (!row) return null;

  let failures: StoredProbeFailure[] = [];
  try {
    const parsed: unknown = JSON.parse(row.failures);
    if (Array.isArray(parsed)) failures = parsed as StoredProbeFailure[];
  } catch {
    // A malformed blob is not worth a 500 on an open health route; the counts
    // beside it are the load-bearing part and they are columns, not JSON.
    failures = [];
  }

  const finishedMs = Date.parse(row.finished_at);
  return {
    started_at: row.started_at,
    finished_at: row.finished_at,
    passed: row.passed,
    failed: row.failed,
    total: row.total,
    truncated: row.truncated === 1,
    areas_run: row.areas_run,
    areas_total: row.areas_total,
    trigger: row.trigger,
    error: row.error ?? null,
    failures,
    age_ms: Number.isFinite(finishedMs) ? Math.max(0, nowMs - finishedMs) : 0,
  };
}

/**
 * One scheduled probe pass: run, record, log. ⚠️ Resolves even when everything
 * went wrong — see this module's header for why that is the requirement and not
 * a shortcut.
 */
export async function runScheduledProbes(
  db: ProbeStore,
  opts: {
    trigger?: string;
    now?: () => number;
    /**
     * ⚠️ INJECTED ONLY BY TESTS. The real suite makes ~145 live requests to
     * production, so a unit test that called it would be a probe run with a
     * green tick on it — and the branch worth testing hardest is the one where
     * the suite THROWS, which cannot be provoked from outside at all. Production
     * passes nothing and gets the real `runProbeSuite`.
     */
    runSuite?: typeof runProbeSuite;
  } = {},
): Promise<ProbeRunRow> {
  const now = opts.now ?? Date.now;
  const trigger = opts.trigger ?? 'cron';
  const runSuite = opts.runSuite ?? runProbeSuite;
  const startedMs = now();

  try {
    const run = await runSuite({
      timeoutMs: PROBE_REQUEST_TIMEOUT_MS,
      deadlineMs: PROBE_DEADLINE_MS,
      // One prefix so a `wrangler tail` can be filtered to this cron; failures
      // go to console.error so they surface at the log level they deserve.
      log: (line: string) => console.log(`estate-probes ${line}`),
      logFailure: (line: string) => console.error(`estate-probes ${line}`),
      now,
    });

    const row: ProbeRunRow = {
      started_at: run.startedAt,
      finished_at: run.finishedAt,
      passed: run.passed,
      failed: run.failed,
      total: run.total,
      truncated: run.truncated ? 1 : 0,
      areas_run: run.areasRun,
      areas_total: run.areasTotal,
      failures: JSON.stringify(summariseFailures(run.results)),
      trigger,
      error: null,
    };
    console.log(
      `estate-probes: ${run.passed}/${run.total} passed, ${run.failed} failed` +
        `${run.truncated ? ` — TRUNCATED after ${run.areasRun}/${run.areasTotal} areas` : ''}`,
    );
    await recordProbeRun(db, row);
    return row;
  } catch (err) {
    // The RUNNER failed, which is a different animal from probes failing: it
    // means the suite could not ask the question at all. Recorded with `error`
    // set and `total: 0`, so nothing downstream can read it as "0 failures".
    const message = err instanceof Error ? err.message : String(err);
    console.error('estate-probes: the suite itself threw —', message);
    const row: ProbeRunRow = {
      started_at: new Date(startedMs).toISOString(),
      finished_at: new Date(now()).toISOString(),
      passed: 0,
      failed: 0,
      total: 0,
      truncated: 1,
      areas_run: 0,
      areas_total: 0,
      failures: '[]',
      trigger,
      error: message.slice(0, 1000),
    };
    await recordProbeRun(db, row);
    return row;
  }
}
