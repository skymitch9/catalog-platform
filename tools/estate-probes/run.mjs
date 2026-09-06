#!/usr/bin/env node
/**
 * The estate API testing suite — CLI entrypoint.
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
 *
 * ## ⚠️ THE PROBE LIST IS NOT IN THIS FILE ANY MORE — 2026-09-05
 *
 * The areas, their order, the `NON_GET_ALLOWLIST` and the two discipline audits
 * moved to `lib/suite.mjs`, because this suite gained a SECOND runner: an
 * hourly Worker cron in `apps/auth-worker/src/estate-probes.ts`, per the owner
 * ask of 2026-09-05 and candidate #4 of
 * `docs/info/scripts-inventory-2026-09-05.md` §7. One list, two runners — the
 * inventory's §6 rule. **To add or reorder a probe area, edit `lib/suite.mjs`.**
 *
 * What is left here is what genuinely belongs to a terminal and cannot exist in
 * a scheduled handler: the table, the exit code, and the sentence about what a
 * failure means. That is the thin-entrypoint rule doing its job.
 */

import { printTable } from './lib/kit.mjs';
import { runProbeSuite } from './lib/suite.mjs';

async function main() {
  console.log('estate-probes: read-only checks against LIVE production. No writes, no tokens minted.\n');

  // No deadline: a human at a terminal can wait, and truncating a run somebody
  // is watching would hide the very outage that made it slow. The Worker sets
  // one; see runProbeSuite()'s header for why the two differ.
  const { passed, failed } = await runProbeSuite();

  printTable();

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
