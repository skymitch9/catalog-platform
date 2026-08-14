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

const ALL = { vis_audiobook: 1, vis_library: 1, vis_games: 1 };
const NONE = { vis_audiobook: 0, vis_library: 0, vis_games: 0 };

test('CATALOGS is the canonical order the whole contract speaks', () => {
  assert.deepEqual([...CATALOGS], ['audiobook', 'library', 'games']);
  assert.deepEqual([...PUBLIC_CATALOGS], ['audiobook']);
});

test('normalizeVisibility dedupes and imposes canonical order', () => {
  assert.deepEqual(normalizeVisibility(['games', 'audiobook', 'games']), ['audiobook', 'games']);
  assert.deepEqual(normalizeVisibility([]), []);
  assert.deepEqual(normalizeVisibility(['library', 'games', 'audiobook']), ['audiobook', 'library', 'games']);
});

test('storedVisibility reads the flags; visibilityToFlags round-trips', () => {
  assert.deepEqual(storedVisibility(ALL), ['audiobook', 'library', 'games']);
  assert.deepEqual(storedVisibility(NONE), []);
  assert.deepEqual(storedVisibility({ vis_audiobook: 0, vis_library: 1, vis_games: 0 }), ['library']);
  for (const set of [[], ['audiobook'], ['library', 'games'], ['audiobook', 'library', 'games']] as const) {
    assert.deepEqual(storedVisibility(visibilityToFlags(set as never)), set);
  }
});

test('effectiveVisibility: approved → stored set', () => {
  assert.deepEqual(effectiveVisibility('approved', ALL), ['audiobook', 'library', 'games']);
  assert.deepEqual(effectiveVisibility('approved', { vis_audiobook: 1, vis_library: 0, vis_games: 1 }), [
    'audiobook',
    'games',
  ]);
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

test('isCatalog admits exactly the three names', () => {
  assert.equal(isCatalog('audiobook'), true);
  assert.equal(isCatalog('library'), true);
  assert.equal(isCatalog('games'), true);
  assert.equal(isCatalog('index'), false);
  assert.equal(isCatalog(''), false);
  assert.equal(isCatalog(1), false);
});
