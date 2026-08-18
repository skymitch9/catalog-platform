/**
 * Firestore timestamp revival for restores — the fix for the restore drill's
 * hole #2 (docs/access/RECOVERY.md §4.2, measured 2026-08-17/18).
 *
 * ## The bug this exists for — MEASURED, not theorised
 *
 * `scripts/backup-firestore.mjs` writes `JSON.stringify(doc.data())`. The
 * Firestore Admin SDK's `Timestamp` class carries its state in two own
 * enumerable fields, so `JSON.stringify` flattens a real timestamp to a plain
 * object with no type marker at all:
 *
 *     "createdAt": {"_seconds":1782327950,"_nanoseconds":558000000}
 *
 * `scripts/restore-firestore.mjs` used to hand that parsed object straight to
 * `batch.set()`, which wrote it back as a **map, not a timestamp**. Proven
 * offline on the drill with the SDK's own serializer, no network, no writes:
 *
 *     encode(real Timestamp)    -> {"timestampValue":{"seconds":"1782327950","nanos":558000000}}
 *     encode(backup round-trip) -> {"mapValue":{"fields":{"_seconds":{…},"_nanoseconds":{…}}}}
 *
 * Scope on the 2026-08-16 dump: **2,139 timestamp-valued fields across all 56
 * collections** — every `createdAt`, `updatedAt`, `addedAt`. A restore would
 * have left every `orderBy('createdAt')`, every date rendering and every
 * timestamp-based security rule looking at a map.
 *
 * ⚠️ **The DUMP is not the problem and must not be "fixed".** It is lossless —
 * both numbers survive the round trip exactly. It is merely not
 * self-describing, so the type has to be re-attached on the way IN. Changing
 * the dump format would invalidate every backup already in `estate-backups`.
 *
 * ## The one ambiguity, stated plainly
 *
 * A genuine Firestore MAP field whose only two keys happen to be `_seconds`
 * and `_nanoseconds`, both numeric, is indistinguishable from a serialized
 * Timestamp in this format — the dump records no type marker for either. Such
 * a map would be revived into a Timestamp by this module. That is accepted:
 * the drill inventoried all 56 collections and found timestamps to be the only
 * non-primitive type present (no `GeoPoint`, no `DocumentReference`, no
 * `Bytes`), the field names are SDK-private and would be a bizarre thing to
 * author by hand, and the alternative — corrupting 2,139 real timestamps to
 * protect a hypothetical map — is strictly worse. `countSerializedTimestamps`
 * exists so a restore always PRINTS how many values it is about to convert,
 * making the decision visible per collection instead of silent.
 *
 * ## Why the Timestamp constructor is injected
 *
 * `toTimestamp` is a parameter, not an import, so this module has zero
 * dependencies and its tests can round-trip through the real
 * `firebase-admin/firestore` Timestamp + serializer without this file ever
 * importing the SDK. `scripts/test/firestore-timestamps.test.mjs` is that
 * proof: dump → revive → SDK encode → identical `timestampValue`.
 */

/**
 * Is this parsed JSON value a `JSON.stringify`'d Firestore Timestamp?
 *
 * Deliberately strict: a plain object with EXACTLY the two keys, both finite
 * numbers. An object carrying a third field is a map that merely contains
 * those names and is left alone.
 */
export function isSerializedTimestamp(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 2) return false;
  if (!keys.includes('_seconds') || !keys.includes('_nanoseconds')) return false;
  return Number.isFinite(value._seconds) && Number.isFinite(value._nanoseconds);
}

/**
 * Recursively replace every serialized timestamp with `toTimestamp(seconds,
 * nanoseconds)`. Everything else — primitives, arrays, nested maps — is
 * rebuilt structurally unchanged.
 *
 * @param {unknown} value parsed JSON from a backup-firestore.mjs collection file
 * @param {(seconds: number, nanoseconds: number) => unknown} toTimestamp
 *        e.g. `(s, n) => new Timestamp(s, n)` from `firebase-admin/firestore`
 */
export function reviveTimestamps(value, toTimestamp) {
  if (typeof toTimestamp !== 'function') {
    throw new TypeError('reviveTimestamps needs a toTimestamp(seconds, nanoseconds) factory');
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => reviveTimestamps(v, toTimestamp));
  if (isSerializedTimestamp(value)) return toTimestamp(value._seconds, value._nanoseconds);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = reviveTimestamps(v, toTimestamp);
  return out;
}

/**
 * How many serialized timestamps are in this value, at any depth. Used to
 * PRINT the conversion count before a restore writes anything — the scope of
 * the change is never silent.
 */
export function countSerializedTimestamps(value) {
  if (value === null || typeof value !== 'object') return 0;
  if (Array.isArray(value)) return value.reduce((n, v) => n + countSerializedTimestamps(v), 0);
  if (isSerializedTimestamp(value)) return 1;
  let n = 0;
  for (const v of Object.values(value)) n += countSerializedTimestamps(v);
  return n;
}
