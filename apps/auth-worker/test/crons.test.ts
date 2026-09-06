/**
 * ⚠️ THE CRON STRINGS, PINNED TO `wrangler.toml` — the guard both catalog repos
 * already carry, arriving here with this Worker's first `[triggers]` block
 * (2026-09-05).
 *
 * **The failure it prevents is silent, which is why prose was never enough.**
 * `scheduled()` dispatches on `event.cron`, comparing against a constant in the
 * source. If the toml says `"41 10 * * *"` and the constant says `"40 10 * * *"`,
 * nothing errors: Cloudflare wakes the Worker on time, the dispatch matches
 * nothing, the unrecognised-cron branch fires, and the job never runs again —
 * while the trigger still shows as installed in the dashboard and the toml still
 * looks right. `docs/info/scripts-inventory-2026-09-05.md` §2 states it as rule
 * 1 for every `scheduled()` in the estate.
 *
 * This file READS THE TOML rather than restating the strings, for the same
 * reason `backups.test.ts` parses `backup.yml` rather than copying the prefix
 * list: a second hand-maintained copy is the drift it is trying to catch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { R2_PRUNE_CRON, R2_PRUNE_KEEP } from '../src/r2-prune.js';
import { ESTATE_PROBES_CRON } from '../src/estate-probes.js';

const tomlUrl = new URL('../wrangler.toml', import.meta.url);

/**
 * The `crons = [...]` array under `[triggers]`, as written.
 *
 * ⚠️ It matches the ARRAY, not any single string, so a trigger added to the
 * toml with no dispatch in index.ts fails this file — which is the other half
 * of the drift and the easier half to introduce.
 */
async function readCrons(): Promise<string[]> {
  const toml = await readFile(tomlUrl, 'utf8');
  const block = toml.match(/^\[triggers\]\s*[\r\n]+crons\s*=\s*\[([^\]]*)\]/m);
  assert.ok(
    block,
    'could not find a `[triggers]` block with a `crons = [...]` array in wrangler.toml. ' +
      'If the crons were removed on purpose, remove the dispatch in src/index.ts in the same change.',
  );
  return [...block[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

test('⚠️ every cron in wrangler.toml has a dispatch in scheduled(), and vice versa', async () => {
  const crons = await readCrons();
  // Order is part of the assertion: it is how a reader of the toml maps a
  // string to a job without opening index.ts.
  assert.deepEqual(
    crons,
    [R2_PRUNE_CRON, ESTATE_PROBES_CRON],
    'wrangler.toml\'s [triggers] crons must equal exactly [R2_PRUNE_CRON, ESTATE_PROBES_CRON]. ' +
      'A string here with no dispatch runs NOTHING for ever; a dispatch with no string never fires.',
  );
});

test('the two crons are distinct — one string cannot serve two jobs', () => {
  // ⚠️ Cloudflare fires `scheduled()` once per matching trigger, and the
  // dispatch is an if/else chain on `event.cron`: two identical strings would
  // silently give the SECOND job zero runs, for ever.
  assert.notEqual(R2_PRUNE_CRON, ESTATE_PROBES_CRON);
});

test('neither cron sits on :00, where every scheduler queues its burst', () => {
  for (const cron of [R2_PRUNE_CRON, ESTATE_PROBES_CRON]) {
    const minute = cron.split(' ')[0];
    assert.notEqual(
      minute,
      '0',
      `${cron} fires on the hour. The estate staggers deliberately (inventory §5.1, the games ` +
        'Worker\'s "41 5 * * 1" rather than :00) so two invocations never compete for the same ' +
        'subrequest budget, and because platform schedulers queue a burst at :00.',
    );
  }
});

/**
 * ⚠️ TWO RETENTION DEPTHS AGAINST ONE BUCKET IS NOT BELT-AND-BRACES — it is
 * whichever ran last winning, silently. CI's `retention` job passes `--keep 8`;
 * the Worker cron uses `R2_PRUNE_KEEP`. If they disagree, the bucket oscillates
 * between depths and "8 generations of history" stops being true without
 * anything failing.
 *
 * Parsed out of `backup.yml`, deliberately in the same shape `backups.test.ts`
 * and `scripts/lib/backup-keys.mjs`'s `readWorkflowPrefixes` already use.
 */
test('⚠️ R2_PRUNE_KEEP equals backup.yml\'s `--keep N` — one retention depth, not two', async () => {
  const yml = await readFile(new URL('../../../.github/workflows/backup.yml', import.meta.url), 'utf8');
  const invocation = yml.match(/node scripts\/prune-r2-backups\.mjs([\s\S]*?)--keep\s+(\d+)/);
  assert.ok(invocation, 'could not find the prune-r2-backups.mjs invocation in backup.yml');
  assert.equal(
    R2_PRUNE_KEEP,
    Number(invocation[2]),
    'The Worker cron and the CI retention job must keep the same number of generations.',
  );
});
