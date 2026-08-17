import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CATALOGS,
  PUBLIC_CATALOGS,
  effectiveVisibility,
  isCatalog,
  normalizeVisibility,
  storedVisibility,
  visibilityToFlags,
} from '../src/visibility.js';

const ALL = { vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 1 };
const NONE = { vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 0 };
/** What a fresh row actually holds: the 0002 DEFAULT 1s and 0007's DEFAULT 0. */
const DB_DEFAULTS = { vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 0 };

test('CATALOGS is the canonical order the whole contract speaks — library2 appended LAST', () => {
  assert.deepEqual([...CATALOGS], ['audiobook', 'library', 'games', 'library2']);
  // The public slice did NOT grow: the second library instance is never
  // world-readable, whatever the catalog list says.
  assert.deepEqual([...PUBLIC_CATALOGS], ['audiobook']);
});

test('normalizeVisibility dedupes and imposes canonical order', () => {
  assert.deepEqual(normalizeVisibility(['games', 'audiobook', 'games']), ['audiobook', 'games']);
  assert.deepEqual(normalizeVisibility([]), []);
  assert.deepEqual(normalizeVisibility(['library', 'games', 'audiobook']), ['audiobook', 'library', 'games']);
  // library2 sorts last however it arrives — appended to the canon, never re-sorted in.
  assert.deepEqual(normalizeVisibility(['library2', 'audiobook']), ['audiobook', 'library2']);
  assert.deepEqual(normalizeVisibility(['library2', 'games', 'library', 'audiobook']), [
    'audiobook',
    'library',
    'games',
    'library2',
  ]);
});

test('storedVisibility reads the flags; visibilityToFlags round-trips', () => {
  assert.deepEqual(storedVisibility(ALL), ['audiobook', 'library', 'games', 'library2']);
  assert.deepEqual(storedVisibility(NONE), []);
  assert.deepEqual(storedVisibility({ vis_audiobook: 0, vis_library: 1, vis_games: 0, vis_library2: 0 }), ['library']);
  assert.deepEqual(storedVisibility({ vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 1 }), ['library2']);
  for (const set of [
    [],
    ['audiobook'],
    ['library', 'games'],
    ['audiobook', 'library', 'games'],
    ['library2'],
    ['audiobook', 'library2'],
    ['audiobook', 'library', 'games', 'library2'],
  ] as const) {
    assert.deepEqual(storedVisibility(visibilityToFlags(set as never)), set);
  }
});

test('a fresh row (DB defaults) holds the household three and NOT library2 — 0007 is DEFAULT 0', () => {
  assert.deepEqual(storedVisibility(DB_DEFAULTS), ['audiobook', 'library', 'games']);
  assert.equal(visibilityToFlags(['audiobook', 'library', 'games']).vis_library2, 0);
});

test('effectiveVisibility: approved → stored set', () => {
  assert.deepEqual(effectiveVisibility('approved', ALL), ['audiobook', 'library', 'games', 'library2']);
  assert.deepEqual(
    effectiveVisibility('approved', { vis_audiobook: 1, vis_library: 0, vis_games: 1, vis_library2: 0 }),
    ['audiobook', 'games'],
  );
  // The deliberate 0007 default: approval alone never grants library2.
  assert.deepEqual(effectiveVisibility('approved', DB_DEFAULTS), ['audiobook', 'library', 'games']);
  // An approver MAY narrow to nothing — the estate's surfaces then show nothing.
  assert.deepEqual(effectiveVisibility('approved', NONE), []);
});

test('effectiveVisibility: pending → the public slice, whatever the flags say', () => {
  assert.deepEqual(effectiveVisibility('pending', ALL), ['audiobook']);
  assert.deepEqual(effectiveVisibility('pending', NONE), ['audiobook']);
});

test('effectiveVisibility: revoked → {} — revocation beats the public slice', () => {
  assert.deepEqual(effectiveVisibility('revoked', ALL), []);
  assert.deepEqual(effectiveVisibility('revoked', NONE), []);
});

test('isCatalog admits exactly the four names', () => {
  assert.equal(isCatalog('audiobook'), true);
  assert.equal(isCatalog('library'), true);
  assert.equal(isCatalog('games'), true);
  assert.equal(isCatalog('library2'), true);
  assert.equal(isCatalog('index'), false);
  assert.equal(isCatalog('library3'), false);
  assert.equal(isCatalog(''), false);
  assert.equal(isCatalog(1), false);
});
