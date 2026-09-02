/**
 * universe-names-generated-parity.test.mjs — the auth Worker's projected copy
 * of the universe list must equal data/universes.json.
 *
 * ⚠️ WHY THIS EXISTS. `apps/auth-worker/src/universe-names.generated.ts` is a
 * CHECKED-IN generated file (see scripts/gen-universe-names.mjs for why it is
 * generated rather than JSON-imported, and why it is committed rather than
 * gitignored). A checked-in generated file is a hand-kept copy the moment
 * nothing proves it is current — which is exactly how the /universes page went
 * a full day one universe short (DotHack, 2026-08-25 → 2026-08-26) with
 * nothing anywhere going red.
 *
 * ⚠️ IT REGENERATES RATHER THAN RE-PARSING. The sibling parity test
 * (universe-names-parity.test.mjs) has to pull an array literal out of a page
 * script with a regex, and carries a warning about vacuous passes. This one has
 * no such risk available to it: it imports the SAME `renderModule()` the
 * generator uses and compares whole strings, so there is no second
 * implementation of "what the Worker needs" to drift.
 *
 * On failure: `node scripts/gen-universe-names.mjs`, then commit the result.
 * Never edit the generated file by hand — the next regeneration silently
 * reverts it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadData, renderModule } from '../gen-universe-names.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);
const OUT_PATH = new URL('apps/auth-worker/src/universe-names.generated.ts', REPO_ROOT);

test('the auth Worker’s generated universe names match data/universes.json', () => {
  const onDisk = readFileSync(OUT_PATH, 'utf8');
  const fresh = renderModule(loadData());
  assert.equal(
    onDisk,
    fresh,
    'apps/auth-worker/src/universe-names.generated.ts is stale. Run ' +
      '`node scripts/gen-universe-names.mjs` and commit the result. ' +
      '(data/universes.json is the ONE copy and always wins.)',
  );
});

test('⚠️ the generated file actually carries names — a vacuous pass is caught', () => {
  // Two empty projections compare equal, so the string diff above would pass on
  // a generator that had quietly stopped emitting anything.
  const src = readFileSync(OUT_PATH, 'utf8');
  const names = [...src.matchAll(/^\s{2}"(.+?)",?$/gm)].map((m) => m[1]);
  assert.ok(names.length >= 10, `expected the generated file to list every universe, parsed ${names.length}`);
  const data = loadData();
  for (const u of data.universes) {
    assert.ok(src.includes(JSON.stringify(u.name)), `${u.name} is missing from the generated module`);
  }
});

test('every universe name folds onto itself in the generated alias map', () => {
  // The same invariant `validate()` asserts on the source file, re-asserted on
  // the projection: if a canonical name is not registered under its own
  // normalised spelling, the Worker's alias check can never fold anything onto
  // it and a duplicate request would sail through.
  const src = readFileSync(OUT_PATH, 'utf8');
  const data = loadData();
  const canon = data.canonicalNames ?? {};
  for (const u of data.universes) {
    const key = String(u.name)
      .replace(/[‘’ʼ′]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    assert.equal(canon[key], u.name, `canonicalNames["${key}"] should be "${u.name}"`);
  }
  assert.ok(src.includes('CANONICAL_NAMES'), 'the generated module no longer exports CANONICAL_NAMES');
});
