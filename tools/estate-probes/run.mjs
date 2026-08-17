#!/usr/bin/env node
/**
 * The estate API testing suite — entrypoint.
 *
 * Owner order 2026-08-15: "Maybe it's time to make an api testing suite" —
 * promoting `apps/auth-worker/test/live-probes.ts`'s idiom (a named `check()`,
 * printed as it runs, exit-coded on any failure) estate-wide, against LIVE
 * PRODUCTION rather than a local `wrangler dev`.
 *
 * ⚠️ STRICTLY READ-ONLY, UNAUTHENTICATED-EDGE. Every probe in `probes/` is a
 * status code, a JSON envelope shape, or a CORS header — never a write, never
 * a minted token, never a secret read or printed. See `README.md` for the
 * full contract and what is deliberately NOT covered.
 *
 * Run: `npm run probe:estate` from the repo root, or `node
 * tools/estate-probes/run.mjs` directly. Exits nonzero on any failure.
 */

import { check, counts, printTable, results } from './lib/kit.mjs';
import { probeHealth } from './probes/health.mjs';
import { probeAuthWorker } from './probes/auth-worker.mjs';
import { probeIndexWorker } from './probes/index-worker.mjs';
import { probeLibraryWorker } from './probes/library-worker.mjs';
import { probeAudiobookWorker } from './probes/audiobook-worker.mjs';
import { probeDiscordWorker } from './probes/discord-worker.mjs';
import { probeAudiobooks } from './probes/audiobooks.mjs';
import { probeFirestore } from './probes/firestore.mjs';

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
 */
const NON_GET_ALLOWLIST = new Set([
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

async function main() {
  console.log('estate-probes: read-only checks against LIVE production. No writes, no tokens minted.\n');

  console.log('— /api/health, all four Workers —');
  await probeHealth();

  console.log('\n— auth.heygabi.ai —');
  await probeAuthWorker();

  console.log('\n— index.heygabi.ai —');
  await probeIndexWorker();

  console.log('\n— library.heygabi.ai (scan-jobs intake) —');
  await probeLibraryWorker();

  console.log('\n— audiobook-api.heygabi.ai (audiobook-worker) —');
  await probeAudiobookWorker();

  console.log('\n— discord-worker —');
  await probeDiscordWorker();

  console.log('\n— audiobooks.heygabi.ai —');
  await probeAudiobooks();

  console.log('\n— Firestore: pipeline_status/current —');
  await probeFirestore();

  console.log('\n— read-only discipline audit —');
  auditMethodDiscipline();

  printTable();

  const { passed, failed } = counts();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nFAILURES ARE FINDINGS, NOT BUGS IN THIS SUITE BY DEFAULT.');
    console.error('Do not "fix" production or loosen an assertion to make it pass —');
    console.error('report what failed and why. See README.md.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('estate-probes crashed:', err);
  process.exitCode = 1;
});
