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
  DEPLOY_REGISTRY_ROW_ID,
  DEPLOY_REGISTRY_UNKNOWN_DETAIL,
  DEPLOY_ROW_PREFIX,
  DEV_LANE_ROW_ID,
  NOT_PROBEABLE_API_NOTE,
  NOT_PROBEABLE_DETAIL,
  NOT_PROBEABLE_NOTE,
  PROBEABLE_ORIGINS,
  SERVICE_UNRECORDED,
  SITE_REGISTRY_ROW_ID,
  SITE_REGISTRY_UNKNOWN_DETAIL,
  SITE_ROW_PREFIX,
  WORKER_REGISTRY_ROW_ID,
  WORKER_REGISTRY_UNKNOWN_DETAIL,
  WORKER_ROW_PREFIX,
  apiCatalogs,
  appDisagreement,
  deployRowPlan,
  siteRowPlan,
  workerRowPlan,
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
  { id: 'audiobook', label: 'Shared audiobooks', host: 'audiobooks.heygabi.ai', api_host: 'audiobook-api.heygabi.ai', service: 'audiobook-worker' },
  { id: 'library', label: "Skylar's library", host: 'library.heygabi.ai', api_host: 'library.heygabi.ai', service: 'library-catalog' },
  { id: 'games', label: "Skylar's board games", host: 'boardgames.heygabi.ai', api_host: 'boardgames.heygabi.ai', service: 'board-game-catalog' },
  { id: 'library2', label: "Samantha's library", host: 'padhard.heygabi.ai', api_host: 'padhard.heygabi.ai', service: 'library-catalog-friend' },
  // 🔴 THE ROW THAT MAKES THE WHOLE MECHANISM VISIBLE: `ebooks` has a site and
  // NO estate API of its own, so it is rowed in Sites and absent from Workers
  // and Deployed versions. Measured — ebooks.heygabi.ai answers /api/health
  // with the site's HTML.
  { id: 'ebooks', label: 'Shared ebooks', host: 'ebooks.heygabi.ai', api_host: null, service: null },
];

const plan = (catalogs = LIVE_REGISTRY) => siteRowPlan(catalogs, { audioOrigin: AUDIO_ORIGIN });

describe('siteRowPlan — the row SET is the registry', () => {
  it('gives every catalog a row, in the registry’s own order', () => {
    const ids = plan().filter((r) => r.catalogId).map((r) => r.catalogId);
    assert.deepEqual(ids, ['audiobook', 'library', 'games', 'library2', 'ebooks']);
  });

  it('🔴 a catalog the page has never heard of gets a ROW with NO edit here', () => {
    // The whole point of the item. `library3` is what a provisioning run
    // produces (catalog-registry.md §7), and nothing in this repo names it.
    const rows = plan([...LIVE_REGISTRY, { id: 'library3', label: "Jordan's library", host: 'jordan.heygabi.ai' }]);
    const row = rows.find((r) => r.catalogId === 'library3');
    assert.ok(row, 'a provisioned catalog must get a site row from the registry alone');
    assert.equal(row.id, 'site-library3');
    assert.equal(row.name, "Jordan's library site — jordan.heygabi.ai");
  });

  it('⚠️ …but NOT a probe, because a CSP is served before the registry is read', () => {
    // The honest half, and it is a limit worth stating rather than a bug: the
    // row set is a runtime fact, `connect-src` is a deploy-time header, and no
    // page can widen its own CSP by learning something later. So a new catalog
    // is ROWED for free and PROBED only once _headers names it.
    const rows = plan([...LIVE_REGISTRY, { id: 'library3', label: "Jordan's library", host: 'jordan.heygabi.ai' }]);
    const row = rows.find((r) => r.catalogId === 'library3');
    assert.equal(row.blocked, true);
    assert.equal(row.url, null, 'a probe this page may not make must never be attempted');
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
      // ⚠️ ebooks.heygabi.ai is ROWED and NOT PROBED — this page's CSP does not
      // name it. Measured live 2026-09-06; see the CSP suite below.
      null,
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

describe('🔴 a host this page may not reach is NOT PROBED, and never reads DOWN', () => {
  it('the ebooks row exists, carries no probe, and is flagged blocked', () => {
    const row = plan().find((r) => r.catalogId === 'ebooks');
    assert.ok(row, 'the catalog is real and belongs on the page — only the probe is withheld');
    assert.equal(row.blocked, true);
    assert.equal(row.url, null);
  });

  it('every other catalog row is probed, so the block is exactly one host', () => {
    const blocked = plan().filter((r) => r.blocked).map((r) => r.catalogId ?? r.id);
    assert.deepEqual(blocked, ['ebooks']);
  });

  it('the sentence says "not checked", not "did not answer", and shows no status code', () => {
    // The incident: probeReachable() cannot tell a refused fetch from a dead
    // host, so the row said DOWN about a site answering HEAD / with 200. A
    // permission failure must never be worded as an outage.
    assert.ok(/[Nn]ot checked/.test(NOT_PROBEABLE_DETAIL));
    assert.ok(!/did not answer/i.test(NOT_PROBEABLE_DETAIL));
    assert.ok(!/\b[45]\d\d\b/.test(NOT_PROBEABLE_DETAIL), 'a person must never see a bare HTTP status');
    // …and it must say the site may be fine, and name the one-line fix.
    assert.ok(/may be perfectly healthy/.test(NOT_PROBEABLE_NOTE));
    assert.ok(/_headers/.test(NOT_PROBEABLE_NOTE) && /connect-src/.test(NOT_PROBEABLE_NOTE));
  });

  it('🔴 PROBEABLE_ORIGINS matches the CSP actually served — parsed from _headers, not copied', () => {
    // Same discipline as apps/index-worker/test/read-origins.test.ts parsing
    // wrangler.toml: a hard-coded list nothing checks is how two sources
    // survive. Both path forms are checked, per the trailing-slash 308 trap
    // _headers' own header warns about.
    const headers = readFileSync(resolve(PUBLIC, '_headers'), 'utf8');
    const rules = headers.split(/\r?\n/);
    const found = [];
    for (let i = 0; i < rules.length; i += 1) {
      if (rules[i].trim() !== '/status' && rules[i].trim() !== '/status/') continue;
      for (let j = i + 1; j < rules.length && /^\s+\S/.test(rules[j]); j += 1) {
        const m = /connect-src ([^;]+);/.exec(rules[j]);
        if (m) found.push({ path: rules[i].trim(), origins: m[1].trim().split(/\s+/) });
      }
    }
    assert.equal(found.length, 2, 'both /status and /status/ must carry a CSP — the 308 trap');
    for (const rule of found) {
      const estate = rule.origins.filter((o) => o.endsWith('.heygabi.ai'));
      assert.deepEqual(
        [...PROBEABLE_ORIGINS].sort(), [...estate].sort(),
        `${rule.path}'s connect-src estate hosts and PROBEABLE_ORIGINS have drifted`,
      );
    }
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

  it('renders a blocked row as a worded grey state, never as DOWN', () => {
    assert.ok(live.includes('if (row.blocked) {'));
    assert.ok(live.includes("updateRow(row.id, 'nodata', NOT_PROBEABLE_DETAIL, NOT_PROBEABLE_NOTE, t);"));
  });

  it('🔴 the Workers and Deployed-versions row sets are planned too — no id is spelled here', () => {
    // ⚠️ THE EXPECTATION THIS REPLACES SAID THE OPPOSITE, deliberately: it
    // pinned the honest caveat "STILL HAND-WRITTEN" while the registry could
    // not say which catalogs run an API. Migration 0022 added `api_host` and
    // `service` and this is the check that the caveat went with them.
    assert.ok(!live.includes('STILL HAND-WRITTEN'), 'the caveat must go when the thing it describes does');
    for (const dead of ["'wk-library'", "'wk-games'", "'wk-library2'", "'dep-library'", "'dep-games'", "'dep-library2'"]) {
      assert.ok(!live.includes(dead), `status.js still hand-writes ${dead}`);
    }
    // The lookups-by-hard-coded-id are the subtler half: they LOOK
    // registry-driven (the label comes from the directory) while the page still
    // chooses which three ids to ask about.
    for (const dead of ['catRow(', 'catLabel(', 'catHost(']) {
      assert.ok(!live.includes(dead), `status.js still looks a catalog up by hard-coded id: ${dead}`);
    }
    assert.ok(live.includes('workerRowPlan(') && live.includes('deployRowPlan(') && live.includes('apiCatalogs('));
  });

  it('fetches each catalog API ONCE and renders it in both sections', () => {
    // Two independently-built fetch lists is how the Workers section and the
    // versions section end up disagreeing about which catalogs exist.
    assert.ok(live.includes('apiTargets.map((row) => (row.url ? fetchJSON(row.url) : null))'));
    assert.ok(live.includes('renderDeployRows({ indexHealth, authHealth, apiTargets, apiResults }, t)'));
    for (const dead of ['fetchJSON(`${LIBRARY_ORIGIN}', 'fetchJSON(`${GAMES_ORIGIN}', 'fetchJSON(`${LIBRARY2_ORIGIN}']) {
      assert.ok(!live.includes(dead), `status.js still hand-writes the health fetch ${dead}`);
    }
  });

  it('renders a blocked API row as a worded grey state, never as DOWN', () => {
    assert.ok(live.includes("updateRow(id, 'nodata', NOT_PROBEABLE_DETAIL, NOT_PROBEABLE_API_NOTE, now);"));
  });
});

// ---------------------------------------------------------------------------
// 🔴 The Workers and Deployed-versions row sets (migration 0022)
// ---------------------------------------------------------------------------

const workers = (catalogs = LIVE_REGISTRY) => workerRowPlan(catalogs);
const deploys = (catalogs = LIVE_REGISTRY) => deployRowPlan(catalogs);

describe('apiCatalogs — `api_host` decides who has a Worker row at all', () => {
  it('🔴 a catalog with NO api_host is ABSENT from both sections, not grey', () => {
    // "This shelf runs no API of its own" is a settled fact about the estate,
    // not something we failed to check — and a permanently grey row saying so
    // would be noise on a page whose whole job is that grey means UNKNOWN.
    assert.ok(!workers().some((r) => r.catalogId === 'ebooks'));
    assert.ok(!deploys().some((r) => r.catalogId === 'ebooks'));
    // …and it still has its SITE row, which is the distinction the field draws.
    assert.ok(siteRowPlan(LIVE_REGISTRY, { audioOrigin: AUDIO_ORIGIN }).some((r) => r.catalogId === 'ebooks'));
  });

  it('🔴 asks the API HOST, not the site host — the row `host` could never have produced', () => {
    // The measurement that made 0022 necessary: audiobooks.heygabi.ai answers
    // /api/health with the site's HTML, and the audiobook API is a different
    // machine the registry did not carry at all.
    const row = workers().find((r) => r.catalogId === 'audiobook');
    assert.ok(row, 'the shared audio pool DOES run an estate API and must be rowed');
    assert.equal(row.apiHost, 'audiobook-api.heygabi.ai');
    assert.ok(!row.name.includes('audiobooks.heygabi.ai'), 'the row must not name the Pages site');
  });

  it('⚠️ `holding` would have selected the right three by coincidence — and this is the counter-example', () => {
    // catalog-registry.md §5's vocabulary conflation, made concrete: audiobook
    // is shared AND digital AND Worker-backed, so the shortcut is already wrong.
    const audiobook = apiCatalogs(LIVE_REGISTRY).find((c) => c.catalogId === 'audiobook');
    assert.ok(audiobook, 'a shared digital pool can and does run a Worker');
  });

  it('keeps the registry’s own order and never re-sorts', () => {
    assert.deepEqual(workers().map((r) => r.catalogId), ['audiobook', 'library', 'games', 'library2']);
    const reversed = [...LIVE_REGISTRY].reverse();
    assert.deepEqual(workers(reversed).map((r) => r.catalogId), ['library2', 'games', 'library', 'audiobook']);
  });

  it('🔴 a catalog the page has never heard of gets BOTH rows with no edit here', () => {
    const grown = [...LIVE_REGISTRY, {
      id: 'library3', label: "Jordan's library", host: 'jordan.heygabi.ai',
      api_host: 'jordan.heygabi.ai', service: 'library-catalog-jordan',
    }];
    const wk = workers(grown).find((r) => r.catalogId === 'library3');
    const dep = deploys(grown).find((r) => r.catalogId === 'library3');
    assert.equal(wk.id, 'wk-library3');
    assert.equal(wk.name, "Jordan's library API — jordan.heygabi.ai");
    assert.equal(dep.id, 'dep-library3');
    assert.equal(dep.name, "Jordan's library (library-catalog-jordan)");
    // …and NOT a probe, for the same CSP reason the site rows have.
    assert.equal(wk.blocked, true);
    assert.equal(wk.url, null);
  });

  it('every row id is prefixed and unique across both sections', () => {
    for (const r of workers()) assert.ok(r.id.startsWith(WORKER_ROW_PREFIX), r.id);
    for (const r of deploys()) assert.ok(r.id.startsWith(DEPLOY_ROW_PREFIX), r.id);
    const ids = [...workers(), ...deploys()].map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('skips a malformed entry rather than rowing an API with no host', () => {
    const rows = workers([...LIVE_REGISTRY, { id: 'broken', label: 'Broken', api_host: '' }, null, { api_host: 'x.y' }]);
    assert.deepEqual(rows.map((r) => r.catalogId), ['audiobook', 'library', 'games', 'library2']);
  });
});

describe('the Deployed-versions parenthetical is the DEPLOYED name', () => {
  it('🔴 library2 reads `library-catalog-friend`, which its own Worker does NOT report', () => {
    // Measured 2026-09-07: padhard.heygabi.ai answers `service:
    // "library-catalog"` — the CODE's name. A Worker cannot tell you which
    // deploy it is, which is the whole reason `service` is a registry column.
    assert.equal(deploys().find((r) => r.catalogId === 'library2').name, "Samantha's library (library-catalog-friend)");
  });

  it('names every row in ONE vocabulary — deploys, not repos', () => {
    // It used to mix them: "(library_catalog worker)" and
    // "(Board_Game_Catalog worker)" are REPOS, "(library-catalog-friend)" is a
    // DEPLOY, in the same list.
    assert.deepEqual(deploys().map((r) => r.name), [
      'Shared audiobooks (audiobook-worker)',
      "Skylar's library (library-catalog)",
      "Skylar's board games (board-game-catalog)",
      "Samantha's library (library-catalog-friend)",
    ]);
  });

  it('⚠️ says the name is NOT RECORDED rather than guessing one', () => {
    const rows = deployRowPlan([{ id: 'x', label: 'A shelf', api_host: 'x.heygabi.ai', service: null }]);
    assert.equal(rows[0].name, `A shelf (${SERVICE_UNRECORDED})`);
    assert.ok(/not recorded/.test(SERVICE_UNRECORDED));
  });
});

describe('🔴 the registry↔Worker join is VERIFIED, not assumed', () => {
  it('a Worker claiming a different catalog is reported, not rendered', () => {
    const said = appDisagreement('library2', { estate: { app: 'library' } });
    assert.ok(said, 'a mismatch must produce a sentence');
    assert.ok(said.includes('library2') && said.includes('library'));
    assert.ok(!/\b[45]\d\d\b/.test(said), 'a person must never see a bare HTTP status');
    assert.ok(/Nothing is broken for anybody/.test(said), 'it must say who is affected — nobody');
  });

  it('agreement is silence', () => {
    assert.equal(appDisagreement('library', { estate: { app: 'library' } }), null);
  });

  it('⚠️ ABSENCE IS NOT DISAGREEMENT — audiobook-worker carries no estate.app', () => {
    // Measured 2026-09-07: {"ok":true,"service":"audiobook-worker","time":…,
    // "estate_check":"enforce"} — no `estate` object at all. A Worker that does
    // not claim an app has not contradicted anything.
    assert.equal(appDisagreement('audiobook', { ok: true, service: 'audiobook-worker' }), null);
    assert.equal(appDisagreement('library', {}), null);
    assert.equal(appDisagreement('library', null), null);
    assert.equal(appDisagreement('library', { estate: {} }), null);
  });
});

describe('an unreadable directory — NEVER a silently shorter panel', () => {
  for (const [what, value] of [['empty', []], ['missing', undefined], ['not an array', null]]) {
    it(`both sections say so in words when the registry is ${what}`, () => {
      const wk = workerRowPlan(value);
      const dep = deployRowPlan(value);
      assert.deepEqual(wk.map((r) => [r.id, r.notice, r.url]), [[WORKER_REGISTRY_ROW_ID, true, null]]);
      assert.deepEqual(dep.map((r) => [r.id, r.notice, r.url]), [[DEPLOY_REGISTRY_ROW_ID, true, null]]);
      assert.ok(!wk.some((r) => r.catalogId), 'never guess at what the estate runs');
    });
  }

  it('the sentences name an OUTAGE, show no status code, and say the estate’s own Workers were checked', () => {
    for (const s of [WORKER_REGISTRY_UNKNOWN_DETAIL, DEPLOY_REGISTRY_UNKNOWN_DETAIL]) {
      assert.ok(/could not be read/.test(s));
      assert.ok(!/\b[45]\d\d\b/.test(s), 'a person must never see a bare HTTP status');
      // ⚠️ The half a reader needs: index and auth ARE still checked, so an
      // unreadable directory must not read as "the whole page gave up".
      assert.ok(/unaffected/.test(s));
    }
  });
});

describe('🔴 a SECOND host this page may not reach — the same rule, a new row', () => {
  it('audiobook-api.heygabi.ai is rowed in both sections and probed in neither', () => {
    // Found by building it, 2026-09-07: the moment `api_host` reached the page,
    // the audiobook Worker arrived in the row set and this page's CSP does not
    // name its host. The 2026-09-06 incident, one host further on.
    for (const rows of [workers(), deploys()]) {
      const row = rows.find((r) => r.catalogId === 'audiobook');
      assert.equal(row.blocked, true);
      assert.equal(row.url, null, 'a fetch this page may not make must never be attempted');
    }
    assert.ok(!PROBEABLE_ORIGINS.includes('https://audiobook-api.heygabi.ai'));
  });

  it('every OTHER catalog API is fetched, so the block is exactly one host', () => {
    assert.deepEqual(workers().filter((r) => r.blocked).map((r) => r.catalogId), ['audiobook']);
    assert.deepEqual(
      workers().filter((r) => !r.blocked).map((r) => r.url),
      [
        'https://library.heygabi.ai/api/health',
        'https://boardgames.heygabi.ai/api/health',
        'https://padhard.heygabi.ai/api/health',
      ],
    );
  });

  it('the Worker note is worded for a WORKER, and still says not-checked rather than down', () => {
    assert.ok(/[Nn]ot checked/.test(NOT_PROBEABLE_DETAIL));
    assert.ok(/The Worker may be perfectly healthy/.test(NOT_PROBEABLE_API_NOTE));
    assert.ok(!/did not answer/i.test(NOT_PROBEABLE_API_NOTE));
    assert.ok(/_headers/.test(NOT_PROBEABLE_API_NOTE) && /connect-src/.test(NOT_PROBEABLE_API_NOTE));
    assert.ok(!/\b[45]\d\d\b/.test(NOT_PROBEABLE_API_NOTE), 'a person must never see a bare HTTP status');
  });
});
