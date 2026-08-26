/**
 * universe-names-parity.test.mjs — the /universes page's hardcoded list must
 * equal data/universes.json.
 *
 * ⚠️ WHY THIS EXISTS. `sites/heygabi-home/public/universes/universes.js`
 * hardcodes UNIVERSE_NAMES because read.ts exposes no public "list universe
 * names" route, and the page is a plain directory upload with no build step —
 * so there is nowhere to read the data file at publish time. The file's own
 * header used to say "keep it in sync by hand; a periodic check is enough".
 * It was not enough: `DotHack` was added to data/universes.json on 2026-08-25
 * and the page stayed one universe short until 2026-08-26, silently. Nothing
 * failed. The page served a 200 with 16 rows for a data file holding 17.
 *
 * This is the mechanical guard that replaces the note, per the estate's
 * "mechanical guards beat written advice" rule. `npm run deploy:home` runs
 * `npm test` before it uploads anything, so a divergence cannot ship.
 *
 * ⚠️ It asserts the EXTRACTION worked before it asserts the names, because the
 * failure mode of a regex-based tripwire is passing vacuously: rename the
 * const, reshape the array onto one line, or switch to double quotes and a
 * naive matcher finds nothing and cheerfully reports agreement between two
 * empty sets. A tripwire that cannot fail is worse than no tripwire.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const REPO_ROOT = new URL('../../', import.meta.url);
const PAGE_PATH = new URL('sites/heygabi-home/public/universes/universes.js', REPO_ROOT);
const DATA_PATH = new URL('data/universes.json', REPO_ROOT);

/** Pull the UNIVERSE_NAMES array literal out of the page script. */
function pageNames() {
  const src = readFileSync(PAGE_PATH, 'utf8');
  const block = src.match(/const UNIVERSE_NAMES\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(
    block,
    'Could not find `const UNIVERSE_NAMES = [...]` in universes.js. If the page was ' +
      'refactored, update this test — do NOT delete it; the hardcoded list is still the ' +
      'only thing the page renders from.',
  );
  const names = [...block[1].matchAll(/(['"])(.*?)\1/g)].map((m) => m[2]);
  assert.ok(names.length > 0, 'UNIVERSE_NAMES was found but parsed as empty — the matcher is stale.');
  return names;
}

function dataNames() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  assert.ok(Array.isArray(data.universes), 'data/universes.json has no `universes` array');
  return data.universes.map((u) => u.name);
}

test('the /universes page lists exactly the universes in data/universes.json', () => {
  const page = pageNames();
  const data = dataNames();

  const missingFromPage = data.filter((n) => !page.includes(n));
  const strayOnPage = page.filter((n) => !data.includes(n));

  assert.deepEqual(
    { missingFromPage, strayOnPage },
    { missingFromPage: [], strayOnPage: [] },
    'sites/heygabi-home/public/universes/universes.js UNIVERSE_NAMES has drifted from ' +
      'data/universes.json. Add or remove the name in the page script (data/universes.json ' +
      'is the ONE copy and always wins), then re-run.',
  );

  // Count is asserted separately so a duplicated entry on either side is caught
  // too — the set comparison above would not see it.
  assert.equal(page.length, data.length, 'same names, different counts — something is listed twice');
});

test('no duplicate names on either side', () => {
  for (const [label, names] of [['universes.js', pageNames()], ['universes.json', dataNames()]]) {
    assert.equal(new Set(names).size, names.length, `${label} lists a universe name twice`);
  }
});
