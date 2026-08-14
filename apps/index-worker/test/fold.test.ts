/**
 * The fold, pinned to data/match-fold.fixtures.json — the index side of the
 * two-repo contract. library_catalog runs the SAME file against its
 * normaliseTitle/primaryAuthor in its own CI. If a case fails here, the port
 * in src/fold.ts has drifted from the library's implementation; fix the port,
 * never the fixture (the fixture records what stored work_key rows already
 * mean).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '../../../data/match-fold.fixtures.json' with { type: 'json' };
import {
  UNKNOWN_AUTHOR_SENTINEL,
  creatorFoldOrNull,
  normaliseTitle,
  primaryAuthor,
  titleFoldOrNull,
  workFoldOrNull,
} from '../src/fold.js';

test('every title fixture reproduces', () => {
  for (const { raw, fold } of fixtures.titles) {
    assert.equal(normaliseTitle(raw), fold, `normaliseTitle(${JSON.stringify(raw)})`);
  }
});

test('every author fixture reproduces (primary and fold)', () => {
  for (const { raw, primary, fold } of fixtures.authors) {
    assert.equal(primaryAuthor(raw), primary, `primaryAuthor(${JSON.stringify(raw)})`);
    assert.equal(normaliseTitle(primaryAuthor(raw)), fold, `fold of primaryAuthor(${JSON.stringify(raw)})`);
  }
});

test('fixtures actually cover the empty-fold class', () => {
  // Belt and braces: if someone trims the fixture file down, the pin on the
  // one behaviour the whole refusal design rests on must not silently vanish.
  assert.ok(fixtures.titles.some((t) => t.fold === ''), 'no empty-fold title fixture left');
  assert.ok(fixtures.authors.some((a) => a.fold === ''), 'no empty-fold author fixture left');
});

// --- The refusal wrappers: index-only, NOT part of the fixture contract. ---

test('empty-fold titles store NULL, never the empty string', () => {
  for (const { raw, fold } of fixtures.titles) {
    assert.equal(titleFoldOrNull(raw), fold === '' ? null : fold);
  }
});

test('empty-fold creators refuse, and the ?unknown sentinel refuses BEFORE folding', () => {
  assert.equal(creatorFoldOrNull('샘지'), null, 'non-Latin author must refuse');
  assert.equal(creatorFoldOrNull(null), null);
  assert.equal(creatorFoldOrNull(undefined), null);
  // Folding '?unknown' would yield 'unknown' — a real credit ("Author
  // Unknown") produces the same fold, which is the collision the library's
  // workKeyFor bypass exists to prevent. The index must never store it.
  assert.equal(creatorFoldOrNull(UNKNOWN_AUTHOR_SENTINEL), null);
  assert.equal(creatorFoldOrNull('  ?unknown  '), null);
  // A REAL "Unknown" credit still folds — that is a fact about the book.
  assert.equal(creatorFoldOrNull('Unknown'), 'unknown');
});

test('work_fold needs both halves; either refusal makes it NULL', () => {
  assert.equal(workFoldOrNull('hobbit', 'j r r tolkien'), 'hobbit|j r r tolkien');
  assert.equal(workFoldOrNull(null, 'samg'), null, 'the Korean-title case: never key on the author alone');
  assert.equal(workFoldOrNull('hobbit', null), null);
  assert.equal(workFoldOrNull(null, null), null);
});
