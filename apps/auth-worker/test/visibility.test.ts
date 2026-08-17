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

const ALL = { vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 1, vis_ebooks: 1 };
const NONE = { vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 0, vis_ebooks: 0 };
/** What a fresh row actually holds: the 0002 DEFAULT 1s, and the DEFAULT 0 of 0007 and 0008. */
const DB_DEFAULTS = { vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 0, vis_ebooks: 0 };

test('CATALOGS is the canonical order the whole contract speaks — ebooks appended LAST', () => {
  assert.deepEqual([...CATALOGS], ['audiobook', 'library', 'games', 'library2', 'ebooks']);
  // The public slice did NOT grow — twice over now. Neither the second
  // library instance nor the ebook shelf is world-readable, whatever the
  // catalog list says; `ebooks` in particular exists BECAUSE it must not be.
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
  assert.deepEqual(storedVisibility(ALL), ['audiobook', 'library', 'games', 'library2', 'ebooks']);
  assert.deepEqual(storedVisibility(NONE), []);
  assert.deepEqual(storedVisibility({ vis_audiobook: 0, vis_library: 1, vis_games: 0, vis_library2: 0, vis_ebooks: 0 }), ['library']);
  assert.deepEqual(storedVisibility({ vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 1, vis_ebooks: 0 }), ['library2']);
  assert.deepEqual(storedVisibility({ vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 0, vis_ebooks: 1 }), ['ebooks']);
  for (const set of [
    [],
    ['audiobook'],
    ['library', 'games'],
    ['audiobook', 'library', 'games'],
    ['library2'],
    ['audiobook', 'library2'],
    ['audiobook', 'library', 'games', 'library2'],
    ['ebooks'],
    ['audiobook', 'ebooks'],
    ['audiobook', 'library', 'games', 'library2', 'ebooks'],
  ] as const) {
    assert.deepEqual(storedVisibility(visibilityToFlags(set as never)), set);
  }
});

test('a fresh row (DB defaults) holds the household three and NOT library2/ebooks — both are DEFAULT 0', () => {
  assert.deepEqual(storedVisibility(DB_DEFAULTS), ['audiobook', 'library', 'games']);
  assert.equal(visibilityToFlags(['audiobook', 'library', 'games']).vis_library2, 0);
  assert.equal(visibilityToFlags(['audiobook', 'library', 'games']).vis_ebooks, 0);
});

test('⚠️ approval alone NEVER grants the ebook shelf, and pending/revoked never hold it', () => {
  // The whole owner directive in one assertion: an approved household member
  // with every 0002 default set still cannot see the shelf. It takes the
  // deliberate flag — nothing about "approved" implies it.
  assert.equal(storedVisibility(DB_DEFAULTS).includes('ebooks'), false);
  // And no status shortcut exists either: `ebooks` is not in the public
  // slice, so pending answers {audiobook} and revoked answers {} — a person
  // whose flag IS set gets nothing until they are approved.
  const granted = { ...DB_DEFAULTS, vis_ebooks: 1 };
  assert.deepEqual(effectiveVisibility('pending', granted), ['audiobook']);
  assert.deepEqual(effectiveVisibility('revoked', granted), []);
  assert.deepEqual(effectiveVisibility('approved', granted), ['audiobook', 'library', 'games', 'ebooks']);
});

test('effectiveVisibility: approved → stored set', () => {
  assert.deepEqual(effectiveVisibility('approved', ALL), ['audiobook', 'library', 'games', 'library2', 'ebooks']);
  assert.deepEqual(
    effectiveVisibility('approved', { vis_audiobook: 1, vis_library: 0, vis_games: 1, vis_library2: 0, vis_ebooks: 0 }),
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

test('isCatalog admits exactly the five names', () => {
  assert.equal(isCatalog('audiobook'), true);
  assert.equal(isCatalog('library'), true);
  assert.equal(isCatalog('games'), true);
  assert.equal(isCatalog('library2'), true);
  assert.equal(isCatalog('ebooks'), true);
  // Near-misses that a hand-typed grant could plausibly send.
  assert.equal(isCatalog('ebook'), false);
  assert.equal(isCatalog('index'), false);
  assert.equal(isCatalog('library3'), false);
  assert.equal(isCatalog(''), false);
  assert.equal(isCatalog(1), false);
});
