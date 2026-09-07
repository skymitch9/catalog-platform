/**
 * admin-catalogs-generated-parity.test.mjs — `/admin`'s catalog vocabulary must
 * equal `packages/estate-auth`'s canonical array.
 *
 * ⚠️ WHY THIS EXISTS. `sites/heygabi-home/public/admin/catalogs.generated.js`
 * is a CHECKED-IN generated file (see `scripts/gen-admin-catalogs.mjs` for why
 * it is generated at build time rather than fetched from `GET /api/catalogs`,
 * and why it is committed rather than gitignored). **A checked-in generated
 * file is a hand-kept copy the moment nothing proves it is current** — which is
 * exactly how the `/universes` page went a full day one universe short
 * (DotHack, 2026-08-25 → 2026-08-26) with nothing anywhere going red. This is
 * the thing that goes red.
 *
 * ⚠️ AND THE STAKES ARE HIGHER HERE THAN ON A NAME LIST. This array is a
 * PERMISSIONS vocabulary: it decides which visibility grants `/admin` renders.
 * A missing entry is not a cosmetic gap — it is a catalog an admin cannot grant
 * or revoke, on a page that looks complete.
 *
 * It REGENERATES rather than re-parsing the page: it imports the same
 * `renderModule()` and `parseCatalogs()` the generator uses and compares whole
 * strings, so there is no second implementation of the projection to drift.
 *
 * On failure: `node scripts/gen-admin-catalogs.mjs`, then commit the result.
 * Never edit the generated file by hand — the next regeneration silently
 * reverts it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { loadSource, parseCatalogs, renderModule } from '../gen-admin-catalogs.mjs';

const REPO_ROOT = new URL('../../', import.meta.url);
const OUT_PATH = new URL('sites/heygabi-home/public/admin/catalogs.generated.js', REPO_ROOT);
const ADMIN_JS = new URL('sites/heygabi-home/public/admin/admin.js', REPO_ROOT);
const VISIBILITY_TS = new URL('packages/estate-auth/src/visibility.ts', REPO_ROOT);

test('/admin’s generated catalog vocabulary matches packages/estate-auth', () => {
  const onDisk = readFileSync(OUT_PATH, 'utf8');
  const fresh = renderModule(parseCatalogs(loadSource()));
  assert.equal(
    onDisk,
    fresh,
    'sites/heygabi-home/public/admin/catalogs.generated.js is stale. Run ' +
      '`node scripts/gen-admin-catalogs.mjs` and commit the result. ' +
      '(packages/estate-auth/src/visibility.ts is the ONE copy and always wins.)',
  );
});

test('⚠️ a vacuous pass is caught — the generated file actually carries the catalogs', () => {
  // Two empty projections compare equal, so the string diff above would pass on
  // a generator that had quietly stopped emitting anything. Assert against the
  // SOURCE independently of renderModule().
  const src = readFileSync(OUT_PATH, 'utf8');
  const ids = parseCatalogs(readFileSync(VISIBILITY_TS, 'utf8'));
  assert.ok(ids.length >= 5, `expected the canonical array to hold every catalog, parsed ${ids.length}`);
  for (const id of ids) {
    assert.ok(src.includes(`'${id}'`), `${id} is missing from the generated module`);
  }
});

test('🔴 ORDER is preserved exactly — it is what the visibility array is POSTED in', () => {
  // §4.5's canonical order is load-bearing twice over: it is the order the
  // checkboxes render in AND the order admin.js rebuilds the posted array in
  // (`CATALOGS.filter(...)`). A re-sorted copy would post a differently-ordered
  // array while every test that only checks membership stayed green.
  const src = readFileSync(OUT_PATH, 'utf8');
  const wanted = parseCatalogs(readFileSync(VISIBILITY_TS, 'utf8'));
  const got = [...src.matchAll(/^\s{2}'([^']+)',$/gm)].map((m) => m[1]);
  assert.deepEqual(got, wanted, 'the generated order must equal the canonical order, entry for entry');
});

test('🔴 admin.js has no second, hand-written CATALOGS array', () => {
  // The whole point of the item: this was the THIRD in-repo copy. If somebody
  // re-adds a literal alongside the import, the import silently loses to it (or
  // the module throws on a duplicate binding) — either way the drift is back.
  const src = readFileSync(ADMIN_JS, 'utf8');
  assert.ok(
    /import\s*\{[^}]*\bCATALOGS\b[^}]*\}\s*from\s*'\.\/catalogs\.generated\.js'/.test(src),
    'admin.js must import CATALOGS from ./catalogs.generated.js',
  );
  assert.ok(
    !/^\s*(?:const|let|var)\s+CATALOGS\s*=/m.test(src),
    'admin.js declares its own CATALOGS again — that is the hand-kept third copy this item removed',
  );
});

test('the LABELS stay hand-kept and registry-overwritten — this did not consolidate them too', () => {
  // Deliberate scope line, asserted so a later pass does not "finish the job"
  // by generating labels as well: a label is a NAME, and a name is exactly what
  // the registry is safe for. `CATALOG_LABELS` is overwritten in place from
  // GET /api/catalogs before the first render, and must keep being able to.
  const src = readFileSync(ADMIN_JS, 'utf8');
  assert.ok(/const CATALOG_LABELS = \{/.test(src), 'CATALOG_LABELS should still be declared in admin.js');
  assert.ok(
    /loadCatalogs\(\)/.test(src),
    'admin.js should still read the registry for its display names',
  );
});
