/**
 * THE PROBE LIST — the one place the estate says which probes exist and in what
 * order, consumed by BOTH runners.
 *
 * ## Why this file exists (2026-09-05)
 *
 * Owner ask 2026-09-05 16:50 Phoenix, candidate #4 of
 * `docs/info/scripts-inventory-2026-09-05.md` §7: *"Pure HTTP against live
 * hosts. This is the suite that catches an authorised-domain change BEFORE
 * somebody quotes a 40-minute-old reading as current."* The suite gained an
 * hourly Worker cron (`apps/auth-worker/src/estate-probes.ts`), and the
 * inventory's §6 rule about a second caller is absolute: *"A route and its
 * script share ONE implementation … or the conversion has made the estate
 * worse."*
 *
 * So the list of areas, their order, and the two discipline audits moved OUT of
 * `../run.mjs` and into here. `run.mjs` is now what a thin entrypoint should
 * be: argument-free, it calls `runProbeSuite()`, prints the table and sets an
 * exit code. The Worker calls the same function and writes the summary to D1.
 * **Adding a probe area is one edit, in this file, and both runners get it.**
 *
 * ## ⚠️ WHAT A WORKER CANNOT DO, AND WHAT THEREFORE STAYS CLI-ONLY
 *
 * Nothing in `probes/` needed porting — the whole tree is `fetch`, `Headers`,
 * `AbortController` and `setTimeout`, with no `node:` import, no `process` and
 * no disk anywhere. That is not luck; it is the read-only, unauthenticated-edge
 * contract in `../README.md` holding.
 *
 * What is deliberately NOT in this function, and must never be added to it:
 *
 * | Stays CLI-only | Why |
 * |---|---|
 * | `../authorized-domains.mjs` | Reads a local credential to ask the Firebase Admin API; a Worker holding that is a wider door than the whole suite |
 * | `printTable()` in `kit.mjs` | 100-column console formatting for a terminal nobody is watching in a cron |
 * | `process.exitCode` | There is no exit code in a scheduled handler; the Worker records `failed > 0` in D1 instead |
 *
 * ⚠️ If a probe ever genuinely needs a local resource, it does NOT go in
 * `probes/`. Put it beside `authorized-domains.mjs` and list it in the table
 * above — a CLI-only probe silently imported here breaks the cron at runtime
 * while the bundle builds perfectly.
 */

import { check, configure, counts, resetRun, results } from './kit.mjs';
import { probeHealth } from '../probes/health.mjs';
import { probeAuthWorker } from '../probes/auth-worker.mjs';
import { probeIndexWorker } from '../probes/index-worker.mjs';
import { probeLibraryWorker } from '../probes/library-worker.mjs';
import { probeLibrary2Worker } from '../probes/library2-worker.mjs';
import { probeAudiobookWorker } from '../probes/audiobook-worker.mjs';
import { probeDiscordWorker } from '../probes/discord-worker.mjs';
import { probeAudiobooks } from '../probes/audiobooks.mjs';
import { probeFirestore } from '../probes/firestore.mjs';

/**
 * ⚠️ The read-only discipline, as a MECHANICAL GUARD rather than prose
 * (an earlier probe list once triggered a REAL pipeline run — this audit
 * exists so that class of mistake fails the suite instead of production).
 *
 * Every probe must be GET, OPTIONS, or PARSE — except the rows named here,
 * each of which is a non-GET request the README documents as safe:
 * either a write-shaped route probed TOKENLESS where the auth gate refuses
 * before any handler runs (the 401s), an idempotent no-cookie no-op
 * (auth:A17's DELETE), or the one by-design 204 fire-and-forget telemetry
 * POST (ab-worker:AB12 — stores nothing, verified in gate-shadow.ts).
 *
 * Adding a new non-GET probe REQUIRES adding its `area:id:METHOD` row here,
 * on purpose, in the same commit — that edit is the deliberate escape
 * hatch. An unlisted non-GET row fails the whole suite.
 *
 * ⚠️ It matters MORE now that the suite runs on a clock. A probe list a human
 * runs occasionally can get away with a mistake somebody notices; the same
 * mistake on an hourly cron is 24 unintended writes a day, unattended.
 */
export const NON_GET_ALLOWLIST = new Set([
  'auth:A2:POST', // /api/estate/hello — tokenless, gate refuses first
  'auth:A5:POST', // /api/estate/users — tokenless, gate refuses first
  'auth:A14:POST', // /api/session — tokenless, canonical verifier 401
  'auth:A15:POST', // /api/session/token — no cookie, 401 no_session
  'auth:A16:POST', // /api/session/token — unknown cookie, 401 no_session
  'auth:A17:DELETE', // /api/session — no cookie, idempotent 200 no-op
  'auth:A27:POST', // /api/estate/facts/:slug — tokenless, gate refuses first
  'auth:A30:POST', // /api/estate/ops/pipeline/step — tokenless, gate refuses first
  'auth:A31:POST', // /api/estate/ops/pipeline/force-upload — tokenless, gate refuses first
  'index:I6:POST', // /api/scan/shelf — tokenless, gate refuses before money is spent
  'library:L1:POST', // /api/scan-jobs/barcode — tokenless, gate refuses first
  'ab-worker:AB12:POST', // /api/gate/shadow — 204 by design, logs only, stores nothing
]);

function auditMethodDiscipline() {
  const violations = results
    .filter((r) => !['GET', 'OPTIONS', 'PARSE'].includes(r.method))
    .filter((r) => !NON_GET_ALLOWLIST.has(`${r.area}:${r.id}:${r.method}`))
    .map((r) => `${r.area}:${r.id} ${r.method} ${r.endpoint}`);
  check(
    'discipline',
    'RO1',
    'PARSE',
    '(the probe list itself)',
    'every probe is GET/OPTIONS or an explicitly allowlisted, documented non-GET',
    violations.length === 0,
    violations.join('; '),
  );
}

/**
 * ⚠️ **NO TWO PROBES IN ONE AREA MAY SHARE AN ID**, and this is a guard rather
 * than prose because the failure is invisible: a duplicate id passes, counts
 * twice, and prints twice — the run still says "133 passed, 0 failed".
 *
 * MEASURED 2026-09-02, which is why it exists: the two new `app-check` rows
 * were written as `auth:A36`/`A37` because a grep of the file's tail found
 * `A35` as the highest number. `A36`–`A39` were declared **earlier in the same
 * file** (the docs-corpus block), so the suite ran four rows under two ids and
 * reported nothing. The README has always said ids are "unique within `area`";
 * saying it did not enforce it.
 *
 * ⚠️ It also breaks the thing ids are FOR. `deploys.log`, `DONE.md` and this
 * suite's own README refer to probes by id — `A39`, `AB22`, `D5` — so a
 * duplicate makes those references ambiguous forever, including in entries
 * already written.
 */
function auditUniqueIds() {
  const seen = new Map();
  const duplicates = [];
  for (const r of results) {
    const key = `${r.area}:${r.id}`;
    if (seen.has(key)) duplicates.push(`${key} (${seen.get(key)} AND ${r.endpoint})`);
    else seen.set(key, r.endpoint);
  }
  check(
    'discipline',
    'RO2',
    'PARSE',
    '(the probe list itself)',
    'no two probes in one area share an id — ids are how deploys.log and DONE.md refer to a row',
    duplicates.length === 0,
    duplicates.join('; '),
  );
}

/**
 * THE ORDER, and the only declaration of it.
 *
 * ⚠️ The banner is part of the row: `run.mjs` prints it, and the Worker logs it
 * so a `wrangler tail` reads like the terminal does. Keeping the two in one
 * array is what stops the CLI growing an area the cron does not run.
 */
const AREAS = [
  ['— /api/health, all five Workers —', probeHealth],
  ['— auth.heygabi.ai —', probeAuthWorker],
  ['— index.heygabi.ai —', probeIndexWorker],
  ['— library.heygabi.ai (scan-jobs intake) —', probeLibraryWorker],
  ["— padhard.heygabi.ai (Sam's library — the federated role surface) —", probeLibrary2Worker],
  ['— audiobook-api.heygabi.ai (audiobook-worker) —', probeAudiobookWorker],
  ['— discord-worker —', probeDiscordWorker],
  ['— audiobooks.heygabi.ai —', probeAudiobooks],
  ['— Firestore: pipeline_status/current —', probeFirestore],
];

/**
 * Run every probe, in order, and report.
 *
 * @param {{timeoutMs?: number, deadlineMs?: number,
 *          log?: (line: string) => void, logFailure?: (line: string) => void,
 *          now?: () => number}} opts
 * @returns {Promise<{passed: number, failed: number, total: number,
 *                    results: object[], truncated: boolean,
 *                    startedAt: string, finishedAt: string,
 *                    areasRun: number, areasTotal: number}>}
 *
 * ## ⚠️ `deadlineMs` — why a wall-clock budget exists at all
 *
 * The CLI can take as long as it likes; a scheduled handler cannot. Each probe
 * carries a per-request timeout (15 s by default, and the Worker sets it far
 * lower), but 145 requests × a timeout is not a bound anyone should rely on —
 * a widespread outage would multiply out to over half an hour and Cloudflare
 * would kill the invocation with NOTHING recorded. A killed run and a green run
 * are indistinguishable from D1, which is the worst possible failure for a
 * surface whose whole job is to notice.
 *
 * So the budget is checked BETWEEN AREAS (never mid-area — a half-run area
 * would report failures that are really "not asked"), and a run that hits it
 * returns `truncated: true` with everything it did manage. `truncated` is
 * carried all the way to `/status`, because "9 of 145 checks, ran out of time"
 * must never render as "9 passed".
 *
 * ⚠️ It is DISABLED by default (`deadlineMs` absent = no limit), so the CLI's
 * behaviour is byte-for-byte what it was.
 */
export async function runProbeSuite(opts = {}) {
  const now = opts.now ?? Date.now;
  const startedMs = now();
  const log = opts.log ?? ((line) => console.log(line));

  resetRun();
  configure({ timeoutMs: opts.timeoutMs, log: opts.log, logFailure: opts.logFailure });

  let areasRun = 0;
  let truncated = false;
  for (const [banner, run] of AREAS) {
    if (opts.deadlineMs !== undefined && now() - startedMs >= opts.deadlineMs) {
      truncated = true;
      log(
        `estate-probes: DEADLINE (${opts.deadlineMs} ms) reached after ${areasRun} of ` +
          `${AREAS.length} areas — the rest were NOT asked. This is a truncated run, not a clean one.`,
      );
      break;
    }
    log(`\n${banner}`);
    await run();
    areasRun += 1;
  }

  // ⚠️ The audits run even on a truncated pass. They assert things about the
  // rows that DID run — a duplicate id or an unlisted non-GET among the first
  // three areas is still a real finding, and skipping them would trade one
  // silence for another.
  log('\n— read-only discipline audit —');
  auditMethodDiscipline();
  auditUniqueIds();

  const { passed, failed } = counts();
  return {
    passed,
    failed,
    total: passed + failed,
    results: [...results],
    truncated,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(now()).toISOString(),
    areasRun,
    areasTotal: AREAS.length,
  };
}

/** How many areas the suite knows about — read by tests, never by a probe. */
export const AREA_COUNT = AREAS.length;
