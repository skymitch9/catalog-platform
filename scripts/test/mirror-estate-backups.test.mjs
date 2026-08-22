/**
 * The mirror's two decisions that can silently mirror the WRONG thing.
 *
 * ⚠️ Both failures below are real runs, not hypotheticals:
 *
 *   1. **Parsing the wrong lines.** A workflow log contains both the rendered
 *      annotation (`##[notice]Wrote estate-backups/<key>`) AND the shell source
 *      of the step that produced it (`echo "::notice::Wrote
 *      estate-backups/$KEY"`). A grep for "Wrote estate-backups" matches both,
 *      and the mirror would try to fetch an object literally named `$KEY`.
 *
 *   2. **Mirroring an incomplete generation.** Runs 32111218016 and
 *      32112007920 (2026-08-18) each lost `audiobook-covers` — one to a
 *      transient Cloudflare 500 mid-download, one to wrangler's 300 MiB upload
 *      cap. A split archive missing any part cannot be untarred AT ALL
 *      (`lib/backup-keys.mjs`'s header), so a mirror that took "the newest
 *      generation" blindly would hold an unrestorable backup and report
 *      success — the worst available outcome for a disaster-recovery copy.
 *
 * The fixtures are the literal shapes taken from run 32123529431's log.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { completeGenerations, parseRunLog } from '../mirror-estate-backups.mjs';
import { readWorkflowPrefixes } from '../lib/backup-keys.mjs';
import { readFile } from 'node:fs/promises';

test('parseRunLog reads the rendered annotations and ignores the shell that printed them', () => {
  const log = [
    '2026-08-18T09:48:50.9267270Z [36;1mecho "::notice::Wrote estate-backups/$KEY"[0m',
    '2026-08-18T09:48:52.7776073Z ##[notice]Wrote estate-backups/d1/library-catalog/20260818T094846Z.sql',
    '2026-08-18T09:48:44.7714413Z [36;1m    echo "::notice::Wrote estate-backups/$BASE.$suffix"[0m',
    '2026-08-18T09:50:48.7293909Z ##[notice]Wrote estate-backups/r2/audiobook-covers/20260818T094846Z.tar.gz.part-aa',
    '2026-08-18T09:50:54.8817618Z ##[notice]Wrote estate-backups/r2/audiobook-covers/20260818T094846Z.tar.gz.part-ab',
    '2026-08-18T09:50:54.8820968Z ##[notice]r2/audiobook-covers/20260818T094846Z.tar.gz was written as 2 part(s).',
  ].join('\r\n');

  const { keys, declaredParts } = parseRunLog(log);

  assert.deepEqual(keys, [
    'd1/library-catalog/20260818T094846Z.sql',
    'r2/audiobook-covers/20260818T094846Z.tar.gz.part-aa',
    'r2/audiobook-covers/20260818T094846Z.tar.gz.part-ab',
  ]);
  // ⚠️ The bug this pins: `$KEY` / `$BASE.$suffix` must NEVER appear as keys.
  assert.ok(!keys.some((k) => k.includes('$')), 'a shell variable was parsed as an object key');
  assert.equal(declaredParts.get('r2/audiobook-covers/20260818T094846Z.tar.gz'), 2);
});

test('parseRunLog tolerates a log that wrote nothing (a failed run)', () => {
  const { keys, declaredParts } = parseRunLog('2026-08-18T07:29:00Z ##[error]Process completed with exit code 1.');
  assert.deepEqual(keys, []);
  assert.equal(declaredParts.size, 0);
});

test('an unsplit generation is complete by construction', () => {
  const keys = ['d1/estate_auth/20260818T094855Z.sql', 'd1/estate_auth/20260816T084920Z.sql'];
  const complete = completeGenerations(keys, new Map());
  assert.deepEqual(complete.map((g) => g.stamp), ['20260818T094855Z', '20260816T084920Z']);
});

test('a split generation is complete only when every declared part is present', () => {
  const base = 'r2/audiobook-covers/20260818T094846Z.tar.gz';
  const declared = new Map([[base, 2]]);

  const both = completeGenerations([`${base}.part-aa`, `${base}.part-ab`], declared);
  assert.deepEqual(both.map((g) => g.stamp), ['20260818T094846Z']);

  // ⚠️ THE DATA-LOSS CASE: one part landed, the run then died. Unrestorable.
  const one = completeGenerations([`${base}.part-aa`], declared);
  assert.deepEqual(one, [], 'a half-uploaded split archive was accepted as a complete generation');
});

test('⚠️ an undeclared part count is treated as INCOMPLETE, not as "probably fine"', () => {
  const base = 'r2/game-covers/20260818T094845Z.tar.gz';
  // Parts logged, but the run never printed "was written as N part(s)" — so we
  // cannot tell 2-of-2 from 2-of-5. "I cannot tell" resolves to "don't trust it".
  const result = completeGenerations([`${base}.part-aa`, `${base}.part-ab`], new Map());
  assert.deepEqual(result, []);
});

test('the newest COMPLETE generation is picked over a newer broken one', () => {
  const base = 'r2/audiobook-covers';
  const keys = [
    `${base}/20260816T084920Z.tar.gz`, // older, whole
    `${base}/20260818T073345Z.tar.gz.part-aa`, // newer, half — run 32112007920's shape
  ];
  const declared = new Map([[`${base}/20260818T073345Z.tar.gz`, 2]]);
  const complete = completeGenerations(keys, declared);
  assert.equal(complete[0].stamp, '20260816T084920Z');
});

/**
 * ⚠️ The mirror derives its store list from backup.yml rather than keeping a
 * fourth copy of it (see `readWorkflowPrefixes`'s header). This pins that the
 * derivation still works against the REAL workflow — a reformat of that step
 * that broke the parse would otherwise mirror nothing, quietly.
 */
test('the mirror derives its store list from the real backup.yml', async () => {
  const yml = await readFile(new URL('../../.github/workflows/backup.yml', import.meta.url), 'utf8');
  const { prefixes, keep } = readWorkflowPrefixes(yml);

  assert.ok(prefixes.length >= 11, `expected at least the 11 known stores, got ${prefixes.length}`);
  assert.ok(prefixes.includes('d1/estate_auth'));
  assert.ok(prefixes.includes('r2/audiobook-covers'));
  assert.ok(prefixes.includes('firestore/audiobook-catalog'));
  // Every prefix is `<kind>/<store>` — nothing else may slip through the filter.
  // ⚠️ `docs` joined the kinds with the gitignored-docs backup (db5b4aa,
  // 2026-08-2x) and this guard was not widened with it, so it failed for every
  // run afterwards. That matters more than a red test: `deploy:home` runs
  // `npm test` first, so a stale guard here has been BLOCKING the home-site
  // deploy. Same shape as the audiobook promote gate on 2026-08-22 — a new
  // kind added to one list and not to the guard. If you add a kind, add it in
  // BOTH places in the same commit.
  for (const p of prefixes) assert.match(p, /^(d1|r2|firestore|docs)\/[A-Za-z0-9_-]+$/);
  assert.equal(keep, 8, 'the mirror inherits the bucket’s retention depth; this changed');
});

test('readWorkflowPrefixes refuses a workflow it cannot parse rather than mirroring nothing', () => {
  assert.throws(() => readWorkflowPrefixes('name: something else\n'), /Could not find the prune-r2-backups/);
});
