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

// --- The route, through the real app (auth blanket included). ---------------

class SearchFakeDB {
  constructor(private rows: SearchRow[]) {}
  prepare(sql: string) {
    const self = this;
    const result = {
      async first() { return null; },
      async run() { return { success: true }; },
      async all() {
        return { results: sql.includes('FROM entry') ? self.rows : [] };
      },
    };
    return { bind: () => result, ...result };
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

test('tokenless GET /api/search → 401: the new route sits behind the blanket automatically', async () => {
  const res = await app.request('/api/search?q=dune', {}, {
    ...env(new SearchFakeDB([])),
    ENVIRONMENT: 'production',
    DEV_EMAIL: undefined,
  });
  assert.equal(res.status, 401);
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

test('an unfoldable query is NOT refused by /api/search (unlike /api/lookup): raw lane still answers', async () => {
  const db = new SearchFakeDB([row({ title: '드래곤 사냥꾼' })]);
  const res = await app.request(`/api/search?q=${encodeURIComponent('드래곤')}`, {}, env(db));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.books.length, 1);
  assert.equal(body.books[0].reason, 'title-substring');
});
