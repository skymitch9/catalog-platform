/**
 * The offline round-trip proof for the restore drill's hole #2
 * (docs/access/RECOVERY.md §4.2): a Firestore Timestamp survives
 * backup → JSON → restore-reviver → the SDK's own wire serializer and comes
 * out as a `timestampValue`, not a `mapValue`.
 *
 * ⚠️ NO NETWORK, NO CREDENTIAL, NO FIRESTORE WRITE. The drill's charter
 * forbade production writes and this test keeps that: `Serializer.encodeValue`
 * is the pure function the SDK uses to turn a JS value into the protobuf shape
 * it would PUT on the wire, so encoding a value proves what a write would
 * store without performing one. That is the same instrument the drill used to
 * find the bug.
 *
 * ⚠️ `Serializer` is reached by absolute path on purpose — it is not in
 * `@google-cloud/firestore`'s `exports` map, so a bare specifier throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED. If a future SDK upgrade moves
 * `build/src/serializer.js`, this test fails LOUDLY with the path in the
 * message rather than skipping: the round trip is the whole point of the file
 * and a silently-skipped proof is worse than none. Fix the path, don't delete
 * the test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

import { Timestamp } from 'firebase-admin/firestore';
import {
  reviveTimestamps,
  countSerializedTimestamps,
  isSerializedTimestamp,
} from '../lib/firestore-timestamps.mjs';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERIALIZER_PATH = join(repoRoot, 'node_modules', '@google-cloud', 'firestore', 'build', 'src', 'serializer.js');

assert.ok(
  existsSync(SERIALIZER_PATH),
  `The Firestore SDK's internal serializer is not at ${SERIALIZER_PATH} — the SDK moved it. ` +
    'Update this path; do not delete this test (RECOVERY.md §4.2 is what it proves).',
);
const { Serializer } = require(SERIALIZER_PATH);
// The Serializer only reads `_settings` off the object it is handed; a bare
// stub is enough and keeps the SDK uninitialised (no app, no credential).
const serializer = new Serializer({ _settings: {} });
const encode = (v) => serializer.encodeValue(v);

/** What backup-firestore.mjs actually writes: JSON.stringify(doc.data()). */
const throughBackup = (data) => JSON.parse(JSON.stringify(data));
const toTimestamp = (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds);

test('the drill\'s bug still reproduces: a raw round-trip encodes as a MAP', () => {
  const ts = new Timestamp(1782327950, 558000000);
  const raw = throughBackup(ts);

  assert.deepEqual(raw, { _seconds: 1782327950, _nanoseconds: 558000000 });
  // This is the measured defect from RECOVERY.md §4.2, pinned so nobody can
  // "simplify" the reviver away without this failing first.
  assert.deepEqual(encode(raw), {
    mapValue: {
      fields: {
        _seconds: { integerValue: 1782327950 },
        _nanoseconds: { integerValue: 558000000 },
      },
    },
  });
});

test('dump -> reviver -> serializer produces an IDENTICAL timestampValue', () => {
  const original = new Timestamp(1782327950, 558000000);
  const expected = encode(original);

  const restored = reviveTimestamps(throughBackup(original), toTimestamp);
  assert.deepEqual(encode(restored), expected);
  assert.deepEqual(encode(restored), { timestampValue: { seconds: '1782327950', nanos: 558000000 } });
});

test('round trip holds for a realistic document, at depth and inside arrays', () => {
  // The shapes the drill actually found in the dump: top-level createdAt /
  // updatedAt / addedAt, plus nested and array-held timestamps.
  const doc = {
    title: 'a review',
    rating: 4,
    finished: false,
    tags: ['fantasy', 'reread'],
    missing: null,
    createdAt: new Timestamp(1782327950, 558000000),
    updatedAt: new Timestamp(1782500000, 0),
    meta: { addedAt: new Timestamp(1700000000, 123456000), source: 'import' },
    history: [
      { at: new Timestamp(1690000000, 1), note: 'first' },
      { at: new Timestamp(1691000000, 999999000), note: 'second' },
    ],
  };

  const expected = encode(doc);
  const restored = reviveTimestamps(throughBackup(doc), toTimestamp);

  assert.deepEqual(encode(restored), expected);
  assert.equal(countSerializedTimestamps(throughBackup(doc)), 5);
});

test('epoch and nanosecond edge values survive exactly', () => {
  for (const ts of [new Timestamp(0, 0), new Timestamp(1, 999999999), new Timestamp(4102444800, 1)]) {
    const restored = reviveTimestamps(throughBackup(ts), toTimestamp);
    assert.deepEqual(encode(restored), encode(ts), `failed for ${ts.toDate().toISOString()}`);
  }
});

test('non-timestamp values are left structurally identical', () => {
  const notTimestamps = {
    // three keys — a map that merely CONTAINS the two names
    decoy: { _seconds: 1, _nanoseconds: 2, _extra: 3 },
    // right keys, wrong types
    stringy: { _seconds: '1', _nanoseconds: 2 },
    // one key only
    partial: { _seconds: 1 },
    empty: {},
    list: [1, 'two', null, true],
    nested: { deep: { deeper: { value: 7 } } },
  };
  const revived = reviveTimestamps(notTimestamps, toTimestamp);
  assert.deepEqual(revived, notTimestamps);
  assert.equal(countSerializedTimestamps(notTimestamps), 0);
});

test('isSerializedTimestamp is strict about shape', () => {
  assert.equal(isSerializedTimestamp({ _seconds: 1, _nanoseconds: 0 }), true);
  assert.equal(isSerializedTimestamp({ _nanoseconds: 0, _seconds: 1 }), true, 'key order is irrelevant');
  assert.equal(isSerializedTimestamp({ _seconds: 1, _nanoseconds: 0, x: 1 }), false);
  assert.equal(isSerializedTimestamp({ _seconds: 1 }), false);
  assert.equal(isSerializedTimestamp([1, 2]), false);
  assert.equal(isSerializedTimestamp(null), false);
  assert.equal(isSerializedTimestamp('nope'), false);
  assert.equal(isSerializedTimestamp({ _seconds: NaN, _nanoseconds: 0 }), false);
});

test('the reviver refuses to run without a Timestamp factory', () => {
  assert.throws(() => reviveTimestamps({ a: 1 }), TypeError);
});
