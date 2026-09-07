/**
 * apex-registry-consumers.test.mjs — the apex pages that were rewritten to read
 * the catalog registry, checked at the SOURCE.
 *
 * ⚠️ WHY SOURCE AND NOT BEHAVIOUR, said plainly rather than implied: `series.js`
 * and `universes.js` are page scripts. Both do top-level `getElementById`, both
 * import `estate-auth.js`, which imports the Firebase SDK from `www.gstatic.com`
 * — importing either in Node means standing up a browser and a CDN. The LOGIC
 * they used to carry is no longer in them: it moved into
 * `assets/catalog-registry.js`, which has 23 behavioural tests of its own.
 * What is left in these files is WIRING, and wiring is what this file checks.
 *
 * 🔴 So a green run here says the hand-kept maps are gone and the registry is
 * wired in. It does NOT say either page renders correctly — that is
 * `verify:home` for the chrome and an eyeball, signed in, for the rest.
 *
 * Survey: docs/info/multi-library-survey-2026-09-05.md §2 F2 (seven disagreeing
 * label maps), F3 (the games shelf designated nobody's, and the stale ebook
 * claim), §3.1 and §6.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public');

const read = (p) => readFileSync(resolve(PUBLIC, p), 'utf8');
/** Live code only — a comment may (and should) still name what was removed. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SERIES = read('series/series.js');
const UNIVERSES = read('universes/universes.js');
const STATUS = read('status/status.js');

describe('series.js — three hand-kept maps, and a comment that was measured FALSE', () => {
  const live = code(SERIES);

  it('🔴 SOURCE_LABELS, CATALOG_LABELS and IMPLIED_FORMAT are gone from live code', () => {
    for (const dead of ['SOURCE_LABELS', 'CATALOG_LABELS', 'IMPLIED_FORMAT']) {
      assert.ok(!live.includes(dead), `series.js still declares ${dead}`);
    }
  });

  it('🔴 the stale ebook claim is no longer ASSERTED — it said ebooks ride a LIBRARY source', () => {
    // Measured false 2026-09-05: ebook rows ride PUT /api/push/audiobook with
    // format 'ebook'. The old comment would have had a session "fix" a bug that
    // did not exist — and it described the exact attribution the owner's rule
    // forbids, a shared digital work credited to one person's physical shelf.
    //
    // ⚠️ The claim's WORDS are still in the file, quoted inside the block that
    // says they are false, and that is the point: a correction that deleted
    // what was wrong would leave the next session free to re-derive it. So the
    // check is that it is no longer asserted — the sentences that carried it as
    // fact are gone, and the measurement that overturned it is present.
    assert.ok(
      !SERIES.includes('so an unfamiliar future source degrades to its own name rather than to a'),
      'the old SOURCE_LABELS header is still standing as fact',
    );
    assert.ok(!SERIES.includes('Naming both here'), 'ditto');
    assert.ok(SERIES.includes('Measured false on 2026-09-05'), 'the correction must be recorded where the claim was');
    assert.ok(SERIES.includes("the household's\n * shared pool") || SERIES.includes("household's shared pool"));
  });

  it('reads the registry, and waits for it before drawing a row', () => {
    assert.ok(live.includes("from '../assets/catalog-registry.js'"));
    assert.ok(/async function callIndex\(path\) \{\s*\n(?:.*\n)*?\s*await registryReady;/.test(SERIES),
      'callIndex is the one funnel — a row drawn before the catalogs land would name every shelf "a shelf we cannot name" and never redraw');
  });

  it("bookish() asks the registry for a KIND rather than comparing to 'game'", () => {
    assert.ok(!live.includes("s !== 'game'"), 'a second games shelf would have been treated as bookish');
    assert.ok(live.includes("cat.kind !== 'games'"));
  });

  it('says the directory is unreachable rather than listing shelves it cannot name', () => {
    assert.ok(live.includes('if (!registryOk) return REGISTRY_DOWN_NOTICE;'));
  });
});

describe('universes.js — "his shelf is the default" was the assumption the rule ends', () => {
  const live = code(UNIVERSES);

  it('🔴 HOLDER_LABELS and GAME_SOURCES are gone from live code', () => {
    for (const dead of ['HOLDER_LABELS', 'GAME_SOURCES']) {
      assert.ok(!live.includes(dead), `universes.js still declares ${dead}`);
    }
  });

  it('names a holder for EVERY row, not only for the second library', () => {
    // The old line was `if (HOLDER_LABELS[row.source]) …` — one key, so an
    // unnamed row meant "the owner's", which reads correctly to exactly one
    // person. A digital pool says "shared" rather than an empty name.
    assert.ok(live.includes('const holder = catalogForEntry(CATALOGS, row.source, row.format);'));
    assert.ok(live.includes("holder.shared ? 'shared' :"));
    assert.ok(live.includes('holder.owner ?'));
  });

  it('reads the registry, and waits for it before drawing a row', () => {
    assert.ok(live.includes("from '../assets/catalog-registry.js'"));
    assert.ok(live.includes('await registryReady;'));
  });
});

describe('neither page carries a catalog id of its own any more', () => {
  for (const [name, src] of [['series.js', SERIES], ['universes.js', UNIVERSES]]) {
    it(`${name} names no catalog id, label or holder in live code`, () => {
      const live = code(src);
      for (const forbidden of ["'library2'", '"library2"', "'audiobook'", "'library'", "Samantha", "Skylar"]) {
        assert.ok(!live.includes(forbidden), `${name} still hard-codes ${forbidden} — the registry is the list`);
      }
      // `'games'` is legitimate and stays: it is the registry's own KIND value
      // ("what is on the shelf"), not a catalog id, and asking for a kind is
      // exactly what these two pages now do.
      assert.ok(live.includes("'games'"), `${name} should still compare against the registry's kind`);
    });
  }
});

describe('status.js — the index panel counts sources from the registry', () => {
  const live = code(STATUS);

  it('🔴 INDEX_SOURCE_ORDER is no longer a hand-written array of three', () => {
    assert.ok(!/const INDEX_SOURCE_ORDER = \[/.test(live), 'status.js still hard-codes the index source order');
  });

  it('reads the registry and orders by it', () => {
    assert.ok(live.includes("from '../assets/catalog-registry.js'") || live.includes("from '/assets/catalog-registry.js'"));
    assert.ok(live.includes('indexSourceOrder'));
  });

  it('🔴 the SITES row set comes from the registry too, since 2026-09-06', () => {
    // The behaviour is pinned in scripts/test/status-host-rows.test.mjs, which
    // can ask the plan directly because lib/host-rows.js is pure. What belongs
    // HERE is the wiring, the same way the two page scripts above are checked.
    assert.ok(live.includes("from './lib/host-rows.js'"));
    assert.ok(live.includes('siteRowPlan'));
    for (const dead of ["'site-audio'", "'site-library'", "'site-games'", "'site-library2'"]) {
      assert.ok(!live.includes(dead), `status.js still hand-writes the site row ${dead}`);
    }
  });
});
