/**
 * The write-side rules of design §3, exercised as pure functions: what a
 * pushed row becomes, and which snapshots are refused.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entryFor, pushBodySchema, pushRowSchema, snapshotProblems, type PushRow } from '../src/rows.js';
import { universeIndex } from '../src/universes-data.js';

const AT = '2026-08-13T00:00:00.000Z';

const game = (over: Partial<PushRow> = {}): PushRow =>
  pushRowSchema.parse({
    source_id: '42',
    title: 'Betrayal at House on the Hill',
    format: 'boardgame',
    kind: 'base',
    ...over,
  });

test('a games row folds its title but NEVER gets a work_fold', () => {
  const e = entryFor('game', game(), universeIndex, AT);
  assert.equal(e.title_fold, 'betrayal at house on the hill');
  assert.equal(e.work_fold, null, 'games rows carry work_fold = NULL, by design, always');
  assert.equal(e.creator, null);
  assert.equal(e.pushed_at, AT);
});

test('a book row gets work_fold from title|creator', () => {
  const row = pushRowSchema.parse({ source_id: '7', title: 'The Hobbit', creator: 'J.R.R. Tolkien', format: 'hardcover' });
  const e = entryFor('library', row, universeIndex, AT);
  assert.equal(e.title_fold, 'hobbit');
  assert.equal(e.work_fold, 'hobbit|j r r tolkien');
});

test('the Korean-title case: title_fold NULL, work_fold NULL — never author-only', () => {
  const row = pushRowSchema.parse({ source_id: '9', title: '캐치! 티니핑', creator: 'SAMG Entertainment', format: 'hardcover' });
  const e = entryFor('library', row, universeIndex, AT);
  assert.equal(e.title_fold, null);
  assert.equal(e.work_fold, null, 'the fix for the |samg bug is NOT JOINING, never joining on the author alone');
  assert.equal(e.title, '캐치! 티니핑', 'the display title survives untouched');
});

test('universe resolves on write, from series and from override titles', () => {
  const bySeries = entryFor(
    'library',
    pushRowSchema.parse({ source_id: '1', title: 'The Way of Kings', creator: 'Brandon Sanderson', series: 'The Stormlight Archive', format: 'hardcover' }),
    universeIndex,
    AT,
  );
  assert.equal(bySeries.universe, 'The Cosmere');

  const byTitle = entryFor(
    'audiobook',
    pushRowSchema.parse({ source_id: '2', title: 'Tress of the Emerald Sea', creator: 'Brandon Sanderson', format: 'audiobook' }),
    universeIndex,
    AT,
  );
  assert.equal(byTitle.universe, 'The Cosmere', 'the seriesless override case');

  const excluded = entryFor(
    'audiobook',
    pushRowSchema.parse({ source_id: '3', title: 'The Frugal Wizard’s Handbook for Surviving Medieval England', creator: 'Brandon Sanderson', format: 'audiobook' }),
    universeIndex,
    AT,
  );
  assert.equal(excluded.universe, null, 'exclusions beat every other signal');
});

test('an empty snapshot is refused: zero rows is a failed export', () => {
  const problems = snapshotProblems('game', []);
  assert.equal(problems.length, 1);
  assert.match(problems[0]!, /failed export/);
});

test('duplicate source_ids are refused by name', () => {
  const problems = snapshotProblems('game', [game(), game()]);
  assert.ok(problems.some((p) => p.includes("duplicate source_id '42'")));
});

test('a games row carrying a creator is a projection bug, said out loud', () => {
  const problems = snapshotProblems('game', [game({ creator: 'Somebody' })]);
  assert.ok(problems.some((p) => p.includes('games rows have no creator')));
});

test('unknown keys are refused with their name, never silently stripped', () => {
  const parsed = pushBodySchema.safeParse([{ source_id: '1', title: 'X', format: 'boardgame', price_paid_cents: 1 }]);
  assert.equal(parsed.success, false);
  assert.ok(JSON.stringify(parsed.error?.issues).includes('price_paid_cents'));
});

test('numeric ids are accepted and stored as strings; parent ids too', () => {
  const row = pushRowSchema.parse({ source_id: 42, title: 'X', format: 'boardgame', parent_source_id: 7 });
  assert.equal(row.source_id, '42');
  assert.equal(row.parent_source_id, '7');
});
