/**
 * RESPONSE CONTRACT TEST — GET /api/search rows (2026-08-24).
 *
 * The apex search box, /universes, and every site that embeds `<estate-search>`
 * render each result row by reading a fixed set of columns off it —
 * `row.cover_url`, `e.detail_url`, `row.year`, and so on. Two independent moves
 * silently break that: the route's SELECT (`ENTRY_COLS` in search-route.ts)
 * stops fetching a column, or `searchIndex()` stops copying one onto the rows
 * it emits. Either way the field arrives `undefined`, a cover vanishes or a
 * link dead-ends, and nothing on the worker side is red — the break lands in a
 * browser. This pins the row contract so it goes RED here instead.
 *
 * DERIVED, NOT HAND-MAINTAINED. The required column set is read out of the
 * consumer itself — the property accesses inside `<estate-search>`'s four hit
 * renderers (`_metaBits`, `_coverFor`, `_rowCard`, `_workCard`), the only scope
 * where `row`/`e`/`hit` are unambiguously search entries. It is then pinned to
 * BOTH producers:
 *   • every read column must appear in ENTRY_COLS (the route actually SELECTs it);
 *   • every read column must be an own-property of a row `searchIndex()` emits
 *     (the ranking/grouping pipeline actually PRESERVES it).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { searchIndex, type SearchRow } from '../src/search.js';
import { buildUniverseIndex, type UniversesDocument } from '../src/universes.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const CONSUMER = resolve(REPO, 'sites/heygabi-home/public/assets/estate-search.js');
const ROUTE = resolve(HERE, '../src/search-route.ts');

/** Brace-match the body of a function whose signature `sigRe` matches, so the
 * derivation reads ONLY the four hit renderers, where row/e/hit are entries. */
function bodyOf(src: string, sigRe: RegExp): string {
  const m = sigRe.exec(src);
  if (!m) throw new Error(`hit renderer not found (${sigRe}) — estate-search.js changed shape; update this contract`);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces reading ${sigRe}`);
}

/** The columns the CONSUMER reads off each row/entry, and the fields it reads
 * off a book-hit group — extracted from the four renderers only. */
function consumerReads(): { rowCols: string[]; bookHitFields: string[] } {
  const src = readFileSync(CONSUMER, 'utf8');
  const bodies = [
    bodyOf(src, /_metaBits\s*\(/),
    bodyOf(src, /_coverFor\s*\(/),
    bodyOf(src, /_rowCard\s*\(/),
    bodyOf(src, /_workCard\s*\(/),
  ].join('\n');
  // Entry vars: a hit's entry (e), a game/entry row (row), the two finds.
  // Negative lookahead drops method calls (e.preventDefault(), row.append…) —
  // only real property reads survive.
  const rowCols = new Set<string>();
  for (const m of bodies.matchAll(/\b(?:row|e|first|withUniverse)\.([a-z_][a-z0-9_]*)\b(?!\s*\()/g)) {
    if (m[1]) rowCols.add(m[1]);
  }
  const bookHitFields = new Set<string>();
  for (const m of bodies.matchAll(/\bhit\.([a-z_][a-z0-9_]*)\b(?!\s*\()/g)) {
    if (m[1]) bookHitFields.add(m[1]);
  }
  return { rowCols: [...rowCols], bookHitFields: [...bookHitFields] };
}

/** The column list the route's SELECT fetches — parsed from ENTRY_COLS. */
function entryCols(): Set<string> {
  const src = readFileSync(ROUTE, 'utf8');
  const m = /const ENTRY_COLS\s*=\s*\n?\s*'([^']+)'/.exec(src);
  if (!m) throw new Error('ENTRY_COLS not found in search-route.ts — update this contract');
  return new Set((m[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
}

let seq = 0;
function row(over: Partial<SearchRow> & { title: string }): SearchRow {
  seq += 1;
  const fold = over.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return {
    source: 'library',
    source_id: String(seq),
    creator: 'An Author',
    title_fold: fold || null,
    work_fold: null,
    universe: null,
    series: 'A Series',
    series_index: 1,
    year: 2020,
    publisher: 'A Publisher',
    format: 'hardcover',
    kind: null,
    parent_source_id: null,
    cover_url: 'https://example/cover.jpg',
    detail_url: 'https://example/detail',
    ...over,
  };
}

test('the <estate-search> renderers read a non-empty, sane set of row columns', () => {
  const { rowCols, bookHitFields } = consumerReads();
  assert.ok(rowCols.length >= 6, `derived too few row columns: ${rowCols.join(', ')}`);
  // Anchors: the two that render a cover and a working link — if the scope ever
  // silently narrows, these disappear and the whole contract goes vacuous.
  for (const anchor of ['cover_url', 'detail_url', 'title', 'source']) {
    assert.ok(rowCols.includes(anchor), `derivation missed row.${anchor}`);
  }
  for (const anchor of ['title', 'entries']) {
    assert.ok(bookHitFields.includes(anchor), `derivation missed hit.${anchor}`);
  }
});

test('the route SELECTs every column the consumer reads (ENTRY_COLS ⊇ reads)', () => {
  const cols = entryCols();
  const { rowCols } = consumerReads();
  for (const col of rowCols) {
    assert.ok(
      cols.has(col),
      `<estate-search> reads row.${col}, but search-route.ts's ENTRY_COLS does not SELECT it. ` +
        `The column would arrive undefined and the row would render wrong. Add "${col}" to ENTRY_COLS ` +
        `(or stop the consumer reading it).`,
    );
  }
});

test('searchIndex() PRESERVES every consumer-read column on the rows it emits', () => {
  const { rowCols, bookHitFields } = consumerReads();
  const universes = buildUniverseIndex({ universes: [] } as unknown as UniversesDocument);
  const rows: SearchRow[] = [
    row({ title: 'Zzytestbook', source: 'library', universe: 'Zzyuniverse' }),
    row({ title: 'Zzytestgame', source: 'game', kind: 'base' }),
  ];
  const r = searchIndex('zzytest', rows, universes);

  assert.ok(r.books.length >= 1, 'fixture book did not rank — cannot check the entry contract');
  assert.ok(r.games.length >= 1, 'fixture game did not rank — cannot check the game-row contract');

  const bookEntry = r.books[0]!.entries[0]!;
  const gameHit = r.games[0]!;
  for (const col of rowCols) {
    assert.ok(Object.hasOwn(bookEntry as object, col), `a book entry emitted by searchIndex() is MISSING "${col}"`);
    assert.ok(Object.hasOwn(gameHit as object, col), `a game hit emitted by searchIndex() is MISSING "${col}"`);
  }
  for (const f of bookHitFields) {
    assert.ok(Object.hasOwn(r.books[0]! as object, f), `a book-hit group emitted by searchIndex() is MISSING "${f}"`);
  }

  // The universe groups the client renders carry name + count.
  const uni = r.universeSuggestions[0] ?? r.universes[0];
  assert.ok(uni, 'no universe hit produced — cannot check its {name,count} contract');
  assert.ok(Object.hasOwn(uni, 'name') && Object.hasOwn(uni, 'count'), 'a universe hit is missing name/count');
});
