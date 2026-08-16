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

import { counts, printTable } from './lib/kit.mjs';
import { probeHealth } from './probes/health.mjs';
import { probeAuthWorker } from './probes/auth-worker.mjs';
import { probeIndexWorker } from './probes/index-worker.mjs';
import { probeLibraryWorker } from './probes/library-worker.mjs';
import { probeAudiobooks } from './probes/audiobooks.mjs';
import { probeFirestore } from './probes/firestore.mjs';

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

  console.log('\n— audiobooks.heygabi.ai —');
  await probeAudiobooks();

  console.log('\n— Firestore: pipeline_status/current —');
  await probeFirestore();

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
