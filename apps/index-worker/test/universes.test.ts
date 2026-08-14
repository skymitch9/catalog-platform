/**
 * The universe lookup, pinned to data/universes.fixtures.json — the same
 * cases library_catalog and audiobook_catalog run against THEIR
 * implementations. Three implementations, one fixture file, no drift.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '../../../data/universes.fixtures.json' with { type: 'json' };
import { resolveUniverseName, universeFor } from '../src/universes.js';
import { universeIndex } from '../src/universes-data.js';

interface FixtureCase {
  name: string;
  title: string;
  series: string;
  expect: string | null;
}

test('every shared lookup fixture answers identically here', () => {
  const cases = (fixtures as { cases: FixtureCase[] }).cases;
  assert.ok(cases.length > 0, 'no fixture cases found');
  for (const c of cases) {
    assert.equal(
      universeFor(universeIndex, { title: c.title, series: c.series }),
      c.expect,
      `case: ${c.name}`,
    );
  }
});

test('canonical name resolution: aliases, own names, unknowns', () => {
  assert.equal(resolveUniverseName(universeIndex, 'cosmere'), 'The Cosmere');
  assert.equal(resolveUniverseName(universeIndex, 'The Cosmere'), 'The Cosmere');
  assert.equal(resolveUniverseName(universeIndex, 'arand multiverse'), 'Runnerverse');
  assert.equal(resolveUniverseName(universeIndex, 'no such fiction'), null, 'unknown names are null, never a guess');
  assert.equal(resolveUniverseName(universeIndex, ''), null);
  assert.equal(resolveUniverseName(universeIndex, null), null);
});
