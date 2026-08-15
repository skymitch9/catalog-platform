/**
 * The ranked search — the pure ranker pinned case by case, then the route
 * exercised through the REAL exported app (blanket order included). The §8
 * carve-out these tests protect: search claims resemblance, never identity —
 * so the assertions here are about ORDER and REASONS, and /api/lookup's
 * exactness is asserted untouched by its own existing tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../src/index.js';
import { MAX_RESULTS, scoreRow, searchIndex, tierFor, type SearchRow } from '../src/search.js';
import { buildUniverseIndex, type UniversesDocument } from '../src/universes.js';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');
const universes = buildUniverseIndex(
  JSON.parse(readFileSync(join(dataDir, 'universes.json'), 'utf8')) as UniversesDocument,
);

/** A row factory: books by default; override for games/edge cases. */
let seq = 0;
function row(over: Partial<SearchRow> & { title: string }): SearchRow {
  seq += 1;
  const foldish = over.title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const titleFold = foldish === '' ? null : foldish;
  return {
    source: 'library',
    source_id: String(seq),
    creator: null,
    title_fold: titleFold,
    work_fold: null,
    universe: null,
    series: null,
    series_index: null,
    year: null,
    publisher: null,
    format: 'hardcover',
    kind: null,
    parent_source_id: null,
    cover_url: null,
    detail_url: null,
    ...over,
  };
}

// --- tierFor: the tier ladder itself. --------------------------------------

test('tier ladder: exact > prefix > tokens > substring, checked strongest-first', () => {
  const q = 'dungeon crawler';
  const t = q.split(' ');
  assert.equal(tierFor(q, t, 'dungeon crawler'), 'exact');
  assert.equal(tierFor(q, t, 'dungeon crawler carl'), 'prefix');
  assert.equal(tierFor(q, t, 'crawler of the dungeon deep'), 'tokens'); // both tokens prefix-match somewhere
  assert.equal(tierFor('crawler', ['crawler'], 'dungeon crawler carl'), 'tokens'); // token, not leading
  assert.equal(tierFor('ngeon craw', ['ngeon', 'craw'], 'dungeon crawler'), 'substring'); // mid-word only
  assert.equal(tierFor(q, t, 'space knight'), null);
  assert.equal(tierFor('', [], 'anything'), null, 'an empty folded query matches nothing in the folded lane');
});

// --- scoreRow: field weighting and the special lanes. -----------------------

test('title beats creator beats series at the same tier; exact creator beats title prefix', () => {
  const q = 'brandon sanderson';
  const t = q.split(' ');
  const titlePrefix = scoreRow(q, t, q, row({ title: 'Brandon Sanderson Explains the Cosmere' }))!;
  const creatorExact = scoreRow(q, t, q, row({ title: 'The Way of Kings', creator: 'Brandon Sanderson' }))!;
  const seriesHit = scoreRow(q, t, q, row({ title: 'Elantris', series: 'Brandon Sanderson Collections' }))!;
  assert.equal(titlePrefix.reason, 'title-prefix');
  assert.equal(creatorExact.reason, 'creator-exact');
  assert.equal(seriesHit.reason, 'series-prefix');
  assert.ok(creatorExact.score > titlePrefix.score, 'a full author name should find the author first');
  assert.ok(titlePrefix.score > seriesHit.score);
});

test('the & fold: searching "and" spellings finds "&" titles and vice versa', () => {
  const q = 'taverns and dragons';
  const hit = scoreRow(q, q.split(' '), q, row({ title: 'Taverns & Dragons', format: 'boardgame', source: 'game' }))!;
  assert.equal(hit.reason, 'title-exact');
});

test('a NULL-fold (Korean) row is reachable by raw display-title substring — §3.1 display-title search', () => {
  const korean = row({ title: '드래곤 사냥꾼' });
  assert.equal(korean.title_fold, null, 'precondition: the title folds to nothing');
  const hit = scoreRow('', [], '드래곤', korean);
  assert.equal(hit?.reason, 'title-substring');
  const exact = scoreRow('', [], '드래곤 사냥꾼', korean);
  assert.equal(exact?.reason, 'title-exact');
});

test('the ?unknown sentinel never matches a search for "unknown"', () => {
  const hit = scoreRow('unknown', ['unknown'], 'unknown', row({ title: 'Some Orphan Book', creator: '?unknown' }));
  assert.equal(hit, null);
});

// --- searchIndex: ordering, grouping, capping, universes. -------------------

test('ranked order: exact > prefix > tokens > substring across a small estate', () => {
  const rows = [
    row({ title: 'Dungeon Crawler Carl Goes Shopping' }), // prefix
    row({ title: 'The Dungeon Anarchist Cookbook', series: 'Dungeon Crawler Carl' }), // series-EXACT: the series' own books
    row({ title: 'Dungeon Crawler Carl' }), // exact
    row({ title: 'My Dungeon Crawler Carl Companion' }), // tokens (not leading)
  ];
  const r = searchIndex('dungeon crawler carl', rows, universes);
  // A full series name typed out ranks the series' books right under the
  // exact title — exact-on-a-lesser-field beats prefix-on-title by design.
  assert.deepEqual(
    r.books.map((b) => b.reason),
    ['title-exact', 'series-exact', 'title-prefix', 'title-tokens'],
  );
  assert.equal(r.books[0]!.title, 'Dungeon Crawler Carl');
});

test('books tier joins same-work: one hit, every format as entries', () => {
  const rows = [
    row({ title: 'Project Hail Mary', creator: 'Andy Weir', work_fold: 'project hail mary|andy weir', source: 'library', format: 'hardcover' }),
    row({ title: 'Project Hail Mary', creator: 'Andy Weir', work_fold: 'project hail mary|andy weir', source: 'audiobook', format: 'audiobook' }),
  ];
  const r = searchIndex('project hail', rows, universes);
  assert.equal(r.books.length, 1, 'same work_fold is ONE result');
  assert.equal(r.books[0]!.entries.length, 2);
  assert.deepEqual(r.books[0]!.entries.map((e) => e.source), ['audiobook', 'library']);
});

test('games stay individual and carry kind/parent_source_id through', () => {
  const rows = [
    row({ title: 'Space Base', source: 'game', format: 'boardgame', kind: 'base', source_id: 'g1' }),
    row({ title: 'Space Base: Shy Pluto', source: 'game', format: 'boardgame', kind: 'promo', parent_source_id: 'g1' }),
  ];
  const r = searchIndex('space base', rows, universes);
  assert.equal(r.games.length, 2);
  assert.equal(r.games[0]!.reason, 'title-exact');
  const promo = r.games.find((g) => g.kind === 'promo')!;
  assert.equal(promo.parent_source_id, 'g1');
  assert.equal(r.books.length, 0);
});

test('at equal score the base game outranks its satellites (the real-data Art Print case)', () => {
  const rows = [
    row({ title: 'Dungeon Crawler Carl: Art Print #1', source: 'game', format: 'boardgame', kind: 'accessory', parent_source_id: 'g1' }),
    row({ title: 'Dungeon Crawler Carl: Solo Mode', source: 'game', format: 'boardgame', kind: 'expansion', parent_source_id: 'g1' }),
    row({ title: 'Dungeon Crawler Carl: The Board Game', source: 'game', format: 'boardgame', kind: 'base', source_id: 'g1' }),
  ];
  const r = searchIndex('dungeon crawler carl', rows, universes);
  assert.deepEqual(r.games.map((g) => g.kind), ['base', 'expansion', 'accessory'],
    'same tier, but base > expansion > accessory');
});

// --- Accessories de-clutter (task 1): the ranking half. ---------------------

test('an accessory/promo ranks BELOW a base/expansion game even with a strictly HIGHER match score', () => {
  const rows = [
    // Exact title match — the highest score the ranker gives — but it is an accessory.
    row({ title: 'Widget', source: 'game', format: 'boardgame', kind: 'accessory', parent_source_id: 'g1' }),
    // Merely a prefix match, lower score, but it is the base game.
    row({ title: 'Widget Deluxe Edition', source: 'game', format: 'boardgame', kind: 'base', source_id: 'g1' }),
  ];
  const r = searchIndex('widget', rows, universes);
  assert.deepEqual(r.games.map((g) => g.kind), ['base', 'accessory'],
    'demotion beats raw score — an exact-match accessory still sorts after a prefix-match base game');
});

test('a promo ranks below books too, not just other games, even outscoring them', () => {
  const rows = [
    row({ title: 'Widget', source: 'game', format: 'boardgame', kind: 'promo', parent_source_id: 'g1' }), // exact
    row({ title: 'Widget Handbook' }), // book, prefix — lower score
  ];
  const r = searchIndex('widget', rows, universes);
  assert.equal(r.books.length, 1, 'the book unit is never bumped from the cap by a higher-scoring promo');
  assert.equal(r.games.length, 1);
  assert.equal(r.games[0]!.kind, 'promo');
});

test('demotion survives the MAX_RESULTS cap: an exact-match accessory never crowds out real matches', () => {
  const rows = Array.from({ length: MAX_RESULTS }, (_, i) => row({ title: `Widget Book ${i}` })); // prefix, lower score
  rows.push(row({ title: 'Widget', source: 'game', format: 'boardgame', kind: 'accessory' })); // exact, higher score
  const r = searchIndex('widget', rows, universes);
  assert.equal(r.books.length, MAX_RESULTS, 'all MAX_RESULTS slots went to the real matches');
  assert.equal(r.games.length, 0, 'the demoted accessory did not take a slot from them');
});

test('the cap: at most MAX_RESULTS units, best first', () => {
  const rows = Array.from({ length: 40 }, (_, i) => row({ title: `Dragon Book ${i}` }));
  rows.push(row({ title: 'Dragon' })); // the exact hit must survive the cap
  const r = searchIndex('dragon', rows, universes);
  assert.equal(r.books.length, MAX_RESULTS);
  assert.equal(r.books[0]!.reason, 'title-exact');
});

test('universe matches surface as their own group, with counts, only when rows exist', () => {
  const rows = [
    row({ title: 'Dungeon Crawler Carl', universe: 'Dungeon Crawler Carl' }),
    row({ title: 'The Butcher’s Masquerade', universe: 'Dungeon Crawler Carl' }),
    row({ title: 'Unrelated Book' }),
  ];
  const r = searchIndex('dungeon crawler', rows, universes);
  assert.deepEqual(r.universes, [{ name: 'Dungeon Crawler Carl', count: 2 }]);
  // An alias resolves through the shared canonical-name map — but only to a
  // universe that actually holds rows here.
  const cosmere = [row({ title: 'Elantris', universe: 'The Cosmere' })];
  const viaAlias = searchIndex('cosmere universe', cosmere, universes);
  assert.deepEqual(viaAlias.universes, [{ name: 'The Cosmere', count: 1 }]);
  const noRows = searchIndex('cosmere universe', rows, universes);
  assert.deepEqual(noRows.universes, [], 'a universe with no rows here is not offered');
});

test('universe-name search reaches the real 2026-08-15 universes, not just synthetic ones', () => {
  // Unlike the case above (a made-up universe name, testing the mechanism
  // generically), this one goes through the REAL `universes` index built from
  // data/universes.json at the top of this file — so it breaks the moment a
  // universe is renamed or removed there, the same "an edit in another repo
  // fails HERE" property universes.test.ts's own canary tests carry.
  const rows = [
    row({ title: 'Dice Throne: X-Men', universe: 'Marvel', source: 'game', format: 'boardgame' }),
    row({ title: 'Marvel Dice Throne', universe: 'Marvel', source: 'game', format: 'boardgame' }),
    row({ title: 'Star Wars: Ahsoka', universe: 'Star Wars', source: 'audiobook', format: 'audiobook' }),
    row({ title: "Stan Lee's Alliances: A Trick of Light", universe: 'Alliances', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Shards of Creation', universe: 'The Cosmere', source: 'game', format: 'boardgame' }),
    row({ title: 'Unrelated Book' }),
  ];
  const marvel = searchIndex('marvel', rows, universes);
  assert.deepEqual(marvel.universes, [{ name: 'Marvel', count: 2 }]);
  const starWars = searchIndex('star wars', rows, universes);
  assert.deepEqual(starWars.universes, [{ name: 'Star Wars', count: 1 }]);
  const alliances = searchIndex('alliances', rows, universes);
  assert.deepEqual(alliances.universes, [{ name: 'Alliances', count: 1 }]);
  // The owner-approved alias resolves too, same alias path as 'cosmere universe' above.
  const alliancesAlias = searchIndex("stan lee's alliances", rows, universes);
  assert.deepEqual(alliancesAlias.universes, [{ name: 'Alliances', count: 1 }]);
  // A query that only matches a TITLE inside The Cosmere (not the universe's
  // own name) surfaces the book/game hit, never a phantom universe group —
  // 'shards' is not 'the cosmere' or any of its aliases.
  const shards = searchIndex('shards', rows, universes);
  assert.deepEqual(shards.universes, []);
  assert.equal(shards.games.length, 1);
  assert.equal(shards.games[0]!.title, 'Shards of Creation');
});

// --- Member-implied universe autofill (task 4). ------------------------------

test('owner\'s own example: searching "mistborn" surfaces The Cosmere as a suggestion, though the query never named it', () => {
  const rows = [
    row({ title: 'Mistborn: The Final Empire', creator: 'Brandon Sanderson', universe: 'The Cosmere', source: 'library', format: 'hardcover' }),
    row({ title: 'Mistborn: The Final Empire', creator: 'Brandon Sanderson', universe: 'The Cosmere', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Mistborn: House War', universe: 'The Cosmere', source: 'game', format: 'boardgame', kind: 'base' }),
    row({ title: 'Unrelated Widget' }),
  ];
  const r = searchIndex('mistborn', rows, universes);
  assert.deepEqual(r.universes, [], 'the query text "mistborn" does not name the universe "The Cosmere" itself');
  assert.deepEqual(r.universeSuggestions, [{ name: 'The Cosmere', count: 3 }],
    'all three matched rows carry universe=The Cosmere, so it is offered as an autofill');
});

test('a universe the query DID name directly is never duplicated into universeSuggestions', () => {
  const rows = [
    row({ title: 'Elantris', universe: 'The Cosmere' }),
    row({ title: 'The Cosmere Atlas', universe: 'The Cosmere' }),
  ];
  const r = searchIndex('cosmere', rows, universes);
  assert.deepEqual(r.universes, [{ name: 'The Cosmere', count: 2 }]);
  assert.deepEqual(r.universeSuggestions, [], 'already offered by name — never say it twice');
});

test('universeSuggestions caps at the top 2 universes by matched-row count, ties broken A-Z', () => {
  const rows = [
    ...Array.from({ length: 3 }, (_, i) => row({ title: `Widget Alpha ${i}`, universe: 'Alpha Verse' })),
    ...Array.from({ length: 2 }, (_, i) => row({ title: `Widget Beta ${i}`, universe: 'Beta Verse' })),
    row({ title: 'Widget Gamma', universe: 'Gamma Verse' }),
  ];
  const r = searchIndex('widget', rows, universes);
  assert.deepEqual(r.universeSuggestions, [
    { name: 'Alpha Verse', count: 3 },
    { name: 'Beta Verse', count: 2 },
  ], 'top 2 by count; Gamma Verse (count 1) is capped out');
});

test('universeSuggestions counts matched rows only, not the universe\'s whole catalog', () => {
  const rows = [
    row({ title: 'Mistborn Companion', universe: 'The Cosmere' }), // matches "mistborn"
    row({ title: 'Elantris', universe: 'The Cosmere' }), // same universe, does NOT match "mistborn"
  ];
  const r = searchIndex('mistborn', rows, universes);
  assert.deepEqual(r.universeSuggestions, [{ name: 'The Cosmere', count: 1 }],
    'only the row that actually matched the query counts, not every Cosmere row in scope');
});

// --- The route, through the real app (auth blanket included). ---------------

class SearchFakeDB {
  constructor(private rows: SearchRow[]) {}
  prepare(sql: string) {
    const self = this;
    const make = (args: unknown[]) => ({
      async first() { return null; },
      async run() { return { success: true }; },
      async all() {
        if (!sql.includes('FROM entry')) return { results: [] };
        // The scope IS the SQL (search-route.ts): honor WHERE source IN (…).
        if (sql.includes('WHERE source IN')) {
          const sources = args.map(String);
          return { results: self.rows.filter((r) => sources.includes(r.source)) };
        }
        return { results: self.rows };
      },
    });
    return { bind: (...args: unknown[]) => make(args), ...make([]) };
  }
  async batch() { return []; }
}

const OWNER = 'owner@example.com';
/** Owner + no ESTATE_AUTH_URL = break-glass standing; no fetch stub needed. */
function env(db: SearchFakeDB) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'development',
    DEV_EMAIL: OWNER,
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    ESTATE_APP_TOKEN_INDEX: 'test-index-token',
  };
}

test('tokenless GET /api/search → 200 with the PUBLIC slice — §4.5\'s anonymous rule, never a 401', async () => {
  const db = new SearchFakeDB([
    row({ title: 'Dune', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Dune', source: 'library', format: 'hardcover' }),
  ]);
  const res = await app.request('/api/search?q=dune', {}, {
    ...env(db),
    ENVIRONMENT: 'production',
    DEV_EMAIL: undefined,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.scope, ['audiobook'], 'the world-readable catalog, nothing more');
  assert.equal(body.books.length, 1);
  assert.deepEqual(body.books[0].entries.map((e: any) => e.source), ['audiobook'],
    'the library edition never reaches the wire');
});

test('the mistborn autofill works SIGNED OUT: the anonymous audiobook slice still carries universe, so the route\'s universeSuggestions still fires', async () => {
  const db = new SearchFakeDB([
    row({ title: 'Mistborn: The Final Empire', universe: 'The Cosmere', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Mistborn: The Final Empire', universe: 'The Cosmere', source: 'library', format: 'hardcover' }), // out of anon scope
  ]);
  const res = await app.request('/api/search?q=mistborn', {}, {
    ...env(db),
    ENVIRONMENT: 'production',
    DEV_EMAIL: undefined,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.scope, ['audiobook']);
  assert.deepEqual(body.universeSuggestions, [{ name: 'The Cosmere', count: 1 }],
    'the library row never left the database (scope IS the SQL) — only the one visible audiobook row counts');
});

test('GET /api/search without q → 400 missing_query', async () => {
  const res = await app.request('/api/search', {}, env(new SearchFakeDB([])));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as any).error, 'missing_query');
});

test('GET /api/search with one character → 422 query_too_short, said politely', async () => {
  const res = await app.request('/api/search?q=d', {}, env(new SearchFakeDB([])));
  assert.equal(res.status, 422);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'query_too_short');
  assert.match(body.detail, /two characters/);
});

test('GET /api/search answers ranked groups with reasons', async () => {
  const db = new SearchFakeDB([
    row({ title: 'Dungeon Crawler Carl', creator: 'Matt Dinniman', work_fold: 'dungeon crawler carl|matt dinniman', universe: 'Dungeon Crawler Carl' }),
    row({ title: 'Dungeon Crawler Carl', creator: 'Matt Dinniman', work_fold: 'dungeon crawler carl|matt dinniman', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Dungeon Crawler Carl: The Board Game', source: 'game', format: 'boardgame', kind: 'base' }),
  ]);
  const res = await app.request('/api/search?q=dungeon%20crawler', {}, env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.query, 'dungeon crawler');
  assert.equal(body.books.length, 1);
  assert.equal(body.books[0].entries.length, 2, 'same-work rows joined');
  assert.equal(body.books[0].reason, 'title-prefix');
  assert.equal(body.games.length, 1);
  assert.equal(body.games[0].kind, 'base');
  assert.deepEqual(body.universes, [{ name: 'Dungeon Crawler Carl', count: 1 }]);
});

// --- `source` — the search-normalization narrowing param. -------------------

test('source=library narrows an owner\'s full scope to one shelf', async () => {
  const db = new SearchFakeDB([
    row({ title: 'Dune', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Dune', source: 'library', format: 'hardcover' }),
  ]);
  const res = await app.request('/api/search?q=dune&source=library', {}, env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.scope, ['library'], 'the response scope reflects what was actually searched');
  assert.equal(body.books.length, 1);
  assert.deepEqual(body.books[0].entries.map((e: any) => e.source), ['library']);
});

test('source can only narrow, never widen: a stranger asking for game gets an honest empty, not audiobook leaking through', async () => {
  const db = new SearchFakeDB([
    row({ title: 'Dune', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Catan', source: 'game', format: 'boardgame' }),
  ]);
  const res = await app.request('/api/search?q=dune&source=game', {}, {
    ...env(db),
    ENVIRONMENT: 'production',
    DEV_EMAIL: undefined,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.scope, [], 'anonymous visibility is {audiobook}; game is outside it');
  assert.equal(body.books.length, 0);
  assert.equal(body.games.length, 0);
  assert.equal(body.reason, undefined, 'this is not the account-level no_catalogs_visible case');
});

test('source=all behaves exactly like omitting the param', async () => {
  const db = new SearchFakeDB([
    row({ title: 'Dune', source: 'audiobook', format: 'audiobook' }),
    row({ title: 'Dune', source: 'library', format: 'hardcover' }),
  ]);
  const withAll = await app.request('/api/search?q=dune&source=all', {}, env(db));
  const withoutParam = await app.request('/api/search?q=dune', {}, env(db));
  assert.deepEqual(await withAll.json(), await withoutParam.json());
});

test('an unrecognised source value is a 400, not a silent ignore', async () => {
  const res = await app.request('/api/search?q=dune&source=bogus', {}, env(new SearchFakeDB([])));
  assert.equal(res.status, 400);
  const body = (await res.json()) as any;
  assert.equal(body.error, 'invalid_source');
});

test('an unfoldable query is NOT refused by /api/search (unlike /api/lookup): raw lane still answers', async () => {
  const db = new SearchFakeDB([row({ title: '드래곤 사냥꾼' })]);
  const res = await app.request(`/api/search?q=${encodeURIComponent('드래곤')}`, {}, env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.books.length, 1);
  assert.equal(body.books[0].reason, 'title-substring');
});
