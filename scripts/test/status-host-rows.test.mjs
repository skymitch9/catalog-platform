/**
 * status-host-rows.test.mjs — /status's SITE row set, planned from the estate
 * catalog registry (`sites/heygabi-home/public/status/lib/host-rows.js`).
 *
 * The item: `docs/TODO.md` / survey §3.1 — *"/status's nine hand-written host
 * rows and five per-host health fetches are still hand-written … the row SET is
 * what a `library3` would still need an edit for."* The sites half of that is
 * what this file pins.
 *
 * ⚠️ BEHAVIOURAL, not source-shaped, unlike `apex-registry-consumers.test.mjs`.
 * `host-rows.js` is pure — no DOM, no fetch, no imports — precisely so the
 * question *"which rows does this registry produce"* can be ASKED rather than
 * inferred from the presence of an identifier.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  DEV_LANE_ROW_ID,
  SITE_REGISTRY_ROW_ID,
  SITE_REGISTRY_UNKNOWN_DETAIL,
  SITE_ROW_PREFIX,
  siteRowPlan,
} from '../../sites/heygabi-home/public/status/lib/host-rows.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public');
const STATUS = readFileSync(resolve(PUBLIC, 'status', 'status.js'), 'utf8');
/** Live code only — a comment may (and should) still name what was removed. */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const AUDIO_ORIGIN = 'https://audiobooks.heygabi.ai';

/**
 * The five rows `GET https://index.heygabi.ai/api/catalogs` actually answered on
 * 2026-09-06, trimmed to the fields the plan reads. Measured, not invented — a
 * fixture that guessed at the registry would pin this page to a registry that
 * does not exist.
 */
const LIVE_REGISTRY = [
  { id: 'audiobook', label: 'Shared audiobooks', host: 'audiobooks.heygabi.ai' },
  { id: 'library', label: "Skylar's library", host: 'library.heygabi.ai' },
  { id: 'games', label: "Skylar's board games", host: 'boardgames.heygabi.ai' },
  { id: 'library2', label: "Samantha's library", host: 'padhard.heygabi.ai' },
  { id: 'ebooks', label: 'Shared ebooks', host: 'ebooks.heygabi.ai' },
];

const plan = (catalogs = LIVE_REGISTRY) => siteRowPlan(catalogs, { audioOrigin: AUDIO_ORIGIN });

describe('siteRowPlan — the row SET is the registry', () => {
  it('gives every catalog a row, in the registry’s own order', () => {
    const ids = plan().filter((r) => r.catalogId).map((r) => r.catalogId);
    assert.deepEqual(ids, ['audiobook', 'library', 'games', 'library2', 'ebooks']);
  });

  it('🔴 a catalog the page has never heard of gets a row and a probe with NO edit here', () => {
    // The whole point of the item. `library3` is what a provisioning run
    // produces (catalog-registry.md §7), and nothing in this repo names it.
    const rows = plan([...LIVE_REGISTRY, { id: 'library3', label: "Jordan's library", host: 'jordan.heygabi.ai' }]);
    const row = rows.find((r) => r.catalogId === 'library3');
    assert.ok(row, 'a provisioned catalog must get a site row from the registry alone');
    assert.equal(row.id, 'site-library3');
    assert.equal(row.url, 'https://jordan.heygabi.ai/');
    assert.equal(row.name, "Jordan's library site — jordan.heygabi.ai");
  });

  it('does NOT re-sort — a page that ordered the catalogs would be a second opinion', () => {
    const reversed = [...LIVE_REGISTRY].reverse();
    const ids = plan(reversed).filter((r) => r.catalogId).map((r) => r.catalogId);
    assert.deepEqual(ids, ['ebooks', 'library2', 'games', 'library', 'audiobook']);
  });

  it('names each row exactly as the hand-written rows did — "<label> site — <host>"', () => {
    const rows = plan();
    assert.equal(rows.find((r) => r.catalogId === 'library').name, "Skylar's library site — library.heygabi.ai");
    assert.equal(rows.find((r) => r.catalogId === 'games').name, "Skylar's board games site — boardgames.heygabi.ai");
    // ⚠️ This row read "Sam's library" until 2026-09-05 — one of the seven
    // disagreeing spellings the registry exists to delete.
    assert.equal(rows.find((r) => r.catalogId === 'library2').name, "Samantha's library site — padhard.heygabi.ai");
  });

  it('probes each catalog’s OWN host root, so rows and fetches cannot drift apart', () => {
    const urls = plan().filter((r) => r.catalogId).map((r) => r.url);
    assert.deepEqual(urls, [
      'https://audiobooks.heygabi.ai/',
      'https://library.heygabi.ai/',
      'https://boardgames.heygabi.ai/',
      'https://padhard.heygabi.ai/',
      'https://ebooks.heygabi.ai/',
    ]);
  });

  it('every row id is prefixed and unique', () => {
    const ids = plan().map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, 'two rows sharing an id would silently overwrite each other');
    for (const id of ids) assert.ok(id.startsWith(SITE_ROW_PREFIX), `${id} is not a site row id`);
  });

  it('skips a malformed entry rather than rendering a row with no host', () => {
    const rows = plan([...LIVE_REGISTRY, { id: 'broken', label: 'Broken', host: '' }, null]);
    assert.ok(!rows.some((r) => r.catalogId === 'broken'));
    assert.equal(rows.filter((r) => r.catalogId).length, 5);
  });
});

describe('the /dev/ lane — a DEPLOY LANE, not a shelf', () => {
  it('sits immediately after the catalog whose site it is a lane of', () => {
    const rows = plan();
    const audioAt = rows.findIndex((r) => r.catalogId === 'audiobook');
    assert.equal(rows[audioAt + 1].id, DEV_LANE_ROW_ID, 'the lane must stay beside its own site row');
  });

  it('takes its NAME from the registry and its URL from this site', () => {
    const lane = plan().find((r) => r.id === DEV_LANE_ROW_ID);
    assert.equal(lane.name, 'Shared audiobooks site, /dev/ preview lane');
    assert.equal(lane.url, 'https://audiobooks.heygabi.ai/dev/');
    assert.equal(lane.catalogId, null, 'the lane is not a catalog and must never claim to be one');
  });

  it('appears exactly once', () => {
    assert.equal(plan().filter((r) => r.id === DEV_LANE_ROW_ID).length, 1);
  });

  it('⚠️ SURVIVES a registry that no longer names its host, still probed, named for what it is', () => {
    const rows = plan(LIVE_REGISTRY.filter((c) => c.id !== 'audiobook'));
    const lane = rows.find((r) => r.id === DEV_LANE_ROW_ID);
    assert.ok(lane, 'the lane exists whether or not the directory names its catalog');
    assert.equal(lane.url, 'https://audiobooks.heygabi.ai/dev/');
    assert.equal(lane.name, 'Preview lane (/dev/) — audiobooks.heygabi.ai');
    assert.equal(rows.filter((r) => r.id === DEV_LANE_ROW_ID).length, 1);
  });
});

describe('an unreadable directory — NEVER an empty panel', () => {
  for (const [what, value] of [['empty', []], ['missing', undefined], ['not an array', null]]) {
    it(`says so in words when the registry is ${what}`, () => {
      const rows = siteRowPlan(value, { audioOrigin: AUDIO_ORIGIN });
      const notice = rows.find((r) => r.notice);
      assert.ok(notice, 'a section with no rows reads as "nothing to report" — a claim we have no basis for');
      assert.equal(notice.id, SITE_REGISTRY_ROW_ID);
      assert.equal(notice.url, null, 'the notice row is not a probe target');
      assert.ok(!rows.some((r) => r.catalogId), 'never guess at what the estate holds');
      // The one thing that can still be measured is still measured.
      assert.ok(rows.some((r) => r.id === DEV_LANE_ROW_ID && r.url));
    });
  }

  it('the sentence names an OUTAGE, not a permissions problem, and shows no status code', () => {
    assert.ok(/could not be read/.test(SITE_REGISTRY_UNKNOWN_DETAIL));
    assert.ok(!/\b[45]\d\d\b/.test(SITE_REGISTRY_UNKNOWN_DETAIL), 'a person must never see a bare HTTP status');
  });
});

describe('status.js — the sites section is wired to the plan and to nothing else', () => {
  const live = code(STATUS);

  it('🔴 the five hand-written site rows and their five probes are gone', () => {
    for (const dead of ["'site-audio'", "'site-library'", "'site-games'", "'site-library2'"]) {
      assert.ok(!live.includes(dead), `status.js still hand-writes the site row ${dead}`);
    }
    for (const dead of ['probeReachable(AUDIO_ORIGIN', 'probeReachable(LIBRARY_ORIGIN', 'probeReachable(GAMES_ORIGIN', 'probeReachable(LIBRARY2_ORIGIN']) {
      assert.ok(!live.includes(dead), `status.js still hand-writes the probe ${dead}`);
    }
  });

  it('builds the rows and the probe list from ONE plan', () => {
    assert.ok(live.includes("from './lib/host-rows.js'"));
    assert.ok(/function sitePlan\(\)/.test(live));
    assert.ok(live.includes('for (const row of sitePlan()) ul.appendChild(makeRow(row.id, row.name));'));
    assert.ok(live.includes('siteTargets.map((row) => (row.url ? probeReachable(row.url) : null))'),
      'the probe list must be derived from the same plan the rows are');
  });

  it('⚠️ the Workers and Deployed-versions row sets are STILL hand-written, and the file says why', () => {
    // Not a failing check — a pin on the honest statement. The registry cannot
    // yet say which catalogs run an estate API (`api_host`) or what the deployed
    // Worker is called (`service`); two of the five hosts answer /api/health with
    // 200 and HTML. If somebody adds those fields and drives these sections from
    // them, this expectation is what tells them to delete the caveat too.
    assert.ok(STATUS.includes('STILL HAND-WRITTEN'), 'the remainder must stay named in status.js');
    assert.ok(STATUS.includes('api_host') && STATUS.includes('service'),
      'the two missing registry fields must be named where the next session reads');
  });
});
