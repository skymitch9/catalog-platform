/**
 * Generation grammar for `estate-backups` keys — the guard on retention.
 *
 * ⚠️ The bug this prevents is a DATA-LOSS bug, not a cosmetic one. Retention
 * keeps "the newest 8"; once an oversized bucket dump is split into
 * `<STAMP>.tar.gz.part-aa`, `.part-ab`, … counting KEYS instead of
 * GENERATIONS means one night's parts can fill the whole allowance and every
 * older backup behind them gets deleted. These tests pin the grouping that
 * makes "8" mean eight nights.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generationOf, groupByGeneration } from '../lib/backup-keys.mjs';

test('generationOf reads the stamp off every key shape the estate writes', () => {
  assert.equal(generationOf('d1/estate_auth/20260818T072356Z.sql'), '20260818T072356Z');
  assert.equal(generationOf('d1/library-catalog-2nd/20260818T072359Z.sql'), '20260818T072359Z');
  assert.equal(generationOf('firestore/audiobook-catalog/20260818T072358Z.tar.gz'), '20260818T072358Z');
  assert.equal(generationOf('r2/game-covers/20260818T072355Z.tar.gz'), '20260818T072355Z');
  assert.equal(generationOf('r2/audiobook-covers/20260818T073345Z.tar.gz.part-aa'), '20260818T073345Z');
  assert.equal(generationOf('r2/audiobook-covers/20260818T073345Z.tar.gz.part-ab'), '20260818T073345Z');
  // A key with no suffix at all is still its own generation, not a crash.
  assert.equal(generationOf('r2/x/20260818T073345Z'), '20260818T073345Z');
});

test('one object per generation — the shape every store had before splitting', () => {
  const objects = [
    { key: 'd1/estate_auth/20260816T084920Z.sql' },
    { key: 'd1/estate_auth/20260818T072356Z.sql' },
    { key: 'd1/estate_auth/20260815T191634Z.sql' },
  ];
  const gens = groupByGeneration(objects);
  assert.equal(gens.length, 3);
  // Newest first.
  assert.deepEqual(gens.map((g) => g.stamp), ['20260818T072356Z', '20260816T084920Z', '20260815T191634Z']);
  for (const g of gens) assert.equal(g.objects.length, 1);
});

test('⚠️ a split generation counts ONCE, and its parts stay together and in order', () => {
  const objects = [
    // deliberately shuffled — R2's listing order is not guaranteed
    { key: 'r2/audiobook-covers/20260818T073345Z.tar.gz.part-ab' },
    { key: 'r2/audiobook-covers/20260816T084918Z.tar.gz' },
    { key: 'r2/audiobook-covers/20260818T073345Z.tar.gz.part-aa' },
    { key: 'r2/audiobook-covers/20260818T073345Z.tar.gz.part-ac' },
  ];
  const gens = groupByGeneration(objects);

  assert.equal(gens.length, 2, 'three parts of one night must be ONE generation');
  assert.equal(gens[0].stamp, '20260818T073345Z');
  assert.deepEqual(
    gens[0].objects.map((o) => o.key.slice(-7)),
    ['part-aa', 'part-ab', 'part-ac'],
    'parts must come back in cat order',
  );
  assert.equal(gens[1].objects.length, 1);
});

test('⚠️ THE DATA-LOSS CASE: keeping 8 keys would delete real backups; 8 generations does not', () => {
  // One split night (9 parts) plus eight earlier single-object nights.
  const objects = [];
  for (let i = 0; i < 9; i++) {
    objects.push({ key: `r2/audiobook-covers/20260818T073345Z.tar.gz.part-a${String.fromCharCode(97 + i)}` });
  }
  const older = [];
  for (let d = 10; d <= 17; d++) {
    const key = `r2/audiobook-covers/202608${d}T090000Z.tar.gz`;
    objects.push({ key });
    older.push(key);
  }

  // The OLD behaviour, reconstructed: newest 8 keys, deleting the rest.
  const byKeyDesc = [...objects].sort((a, b) => (a.key < b.key ? 1 : -1));
  const oldWouldDelete = byKeyDesc.slice(8);
  assert.ok(
    oldWouldDelete.some((o) => older.includes(o.key)),
    'the fixture must actually demonstrate the old bug',
  );

  // The NEW behaviour: nine generations, keep eight, lose only the oldest night.
  const gens = groupByGeneration(objects);
  assert.equal(gens.length, 9, 'one split night + eight whole nights');
  const keep = gens.slice(0, 8);
  const drop = gens.slice(8);
  assert.equal(drop.length, 1);
  assert.equal(drop[0].stamp, '20260810T090000Z', 'only the OLDEST night is dropped');

  // The split night survives with all nine parts — a partial generation
  // cannot be reassembled and must never exist.
  assert.equal(keep[0].stamp, '20260818T073345Z');
  assert.equal(keep[0].objects.length, 9);
});

test('an empty prefix groups to nothing rather than throwing', () => {
  assert.deepEqual(groupByGeneration([]), []);
});
