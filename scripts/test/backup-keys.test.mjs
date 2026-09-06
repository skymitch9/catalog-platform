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
import { generationOf, groupByGeneration, planRetention } from '../lib/backup-keys.mjs';

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

// ---------------------------------------------------------------------------
// planRetention — THE decision, shared by scripts/prune-r2-backups.mjs and
// apps/auth-worker/src/r2-prune.ts (2026-09-05). These tests are the reason a
// second caller was allowed to exist at all: the rule has one implementation,
// so it has one set of tests, and a change that would delete a backup fails
// here rather than in the bucket.
// ---------------------------------------------------------------------------

const nights = (prefix, stamps) => stamps.map((s) => ({ key: `${prefix}/${s}.tar.gz` }));

test('planRetention keeps the newest N generations and drops the rest, newest first', () => {
  const objects = nights('d1/estate_auth', [
    '20260901T090000Z',
    '20260902T090000Z',
    '20260903T090000Z',
    '20260904T090000Z',
  ]);
  const plan = planRetention(objects, 2);

  assert.equal(plan.generations, 4);
  assert.equal(plan.objects, 4);
  assert.deepEqual(plan.keep.map((g) => g.stamp), ['20260904T090000Z', '20260903T090000Z']);
  assert.deepEqual(plan.drop.map((g) => g.stamp), ['20260902T090000Z', '20260901T090000Z']);
  assert.deepEqual(plan.dropKeys, [
    'd1/estate_auth/20260902T090000Z.tar.gz',
    'd1/estate_auth/20260901T090000Z.tar.gz',
  ]);
});

test('planRetention deletes NOTHING when the prefix is at or under depth', () => {
  const atDepth = planRetention(nights('d1/estate_auth', ['20260901T090000Z', '20260902T090000Z']), 2);
  assert.deepEqual(atDepth.dropKeys, []);
  assert.equal(atDepth.keep.length, 2);

  const under = planRetention(nights('d1/estate_auth', ['20260901T090000Z']), 8);
  assert.deepEqual(under.dropKeys, []);
  assert.equal(under.keep.length, 1);
});

test('planRetention on an empty prefix plans nothing — a zero-object store is not a deletion', () => {
  const plan = planRetention([], 8);
  assert.deepEqual(plan.dropKeys, []);
  assert.deepEqual(plan.keep, []);
  assert.equal(plan.generations, 0);
  assert.equal(plan.objects, 0);
});

test('⚠️ planRetention drops a split generation WHOLE — every part or none', () => {
  const parts = ['aa', 'ab', 'ac'].map((p) => ({
    key: `r2/audiobook-covers/20260810T090000Z.tar.gz.part-${p}`,
  }));
  const objects = [
    ...parts,
    ...nights('r2/audiobook-covers', ['20260811T090000Z', '20260812T090000Z']),
  ];
  const plan = planRetention(objects, 2);

  assert.equal(plan.generations, 3, 'three nights, one of them split into three objects');
  assert.equal(plan.objects, 5);
  assert.equal(plan.drop.length, 1);
  assert.equal(plan.drop[0].stamp, '20260810T090000Z');
  // All three parts, in order — a half-deleted generation cannot be
  // reassembled and must never exist.
  assert.deepEqual(plan.dropKeys, [
    'r2/audiobook-covers/20260810T090000Z.tar.gz.part-aa',
    'r2/audiobook-covers/20260810T090000Z.tar.gz.part-ab',
    'r2/audiobook-covers/20260810T090000Z.tar.gz.part-ac',
  ]);
});

test('⚠️ planRetention keeps a split generation WHOLE when it is the newest', () => {
  const parts = ['aa', 'ab'].map((p) => ({
    key: `r2/audiobook-covers/20260818T073345Z.tar.gz.part-${p}`,
  }));
  const plan = planRetention([...parts, ...nights('r2/audiobook-covers', ['20260817T090000Z'])], 1);
  assert.equal(plan.keep.length, 1);
  assert.equal(plan.keep[0].objects.length, 2, 'both parts survive together');
  assert.deepEqual(plan.dropKeys, ['r2/audiobook-covers/20260817T090000Z.tar.gz']);
});

test('planRetention refuses a keep of 0 or a non-integer — never "keep nothing" by accident', () => {
  const objects = nights('d1/estate_auth', ['20260901T090000Z']);
  assert.throws(() => planRetention(objects, 0), /positive integer/);
  assert.throws(() => planRetention(objects, -1), /positive integer/);
  assert.throws(() => planRetention(objects, 2.5), /positive integer/);
  assert.throws(() => planRetention(objects, Number.NaN), /positive integer/);
});
