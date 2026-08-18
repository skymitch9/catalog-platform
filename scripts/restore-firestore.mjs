#!/usr/bin/env node
/**
 * Estate Firestore restore — writes a backup-firestore.mjs dump tree back
 * into Firestore. The companion to scripts/backup-firestore.mjs; read
 * docs/access/backup-restore.md §5 before running this against anything but
 * a throwaway test collection.
 *
 * ## What it does
 *
 * For each `<collection-path>.json` file in the backup directory (the same
 * files backup-firestore.mjs wrote, `__` standing in for `/`), it recreates
 * every document at that collection path with `set()` (full overwrite of
 * each document's fields — not a merge). Firestore natively accepts a
 * slash-joined string as a collection path (`db.collection('clubs/ID/reads')`
 * works exactly like nested `.collection().doc().collection()` calls), so the
 * decoded filename IS the collection reference; no manual path-walking.
 *
 * Batches at 450 writes (Firestore's hard cap is 500 per batch — this stays
 * under it) and commits sequentially per collection, cheapest safe choice at
 * household data volumes (thousands of docs, not millions).
 *
 * ## Timestamps are revived on the way in (drill fix, 2026-08-18)
 *
 * The dump stores a Firestore `Timestamp` as the plain object
 * `{_seconds,_nanoseconds}` that `JSON.stringify` produces. Until 2026-08-18
 * this script handed that straight to `batch.set()`, which wrote it back as a
 * **map, not a timestamp** — 2,139 fields across the 56 collections of the
 * 2026-08-16 dump (docs/access/RECOVERY.md §4.2). Every document now goes
 * through `reviveTimestamps()` first, and the count converted is PRINTED per
 * collection in both dry-run and commit mode, so the scope is never silent.
 * See `scripts/lib/firestore-timestamps.mjs` for the one ambiguity this
 * accepts, and `scripts/test/firestore-timestamps.test.mjs` for the offline
 * round-trip proof (dump → revive → the SDK's own serializer → an identical
 * `timestampValue`).
 *
 * ## ⚠️ This OVERWRITES. It does not merge, and it does not delete first.
 *
 * `set()` replaces every field of a restored document with exactly what the
 * backup captured — a field added to that document AFTER the backup and
 * still present in it today is wiped by design (undoing corruption after the
 * backup point is the whole reason to restore). It does **not** delete
 * documents that exist now but did not exist in the backup — a partial
 * restore of one club after some other club was created since is safe: this
 * script never touches paths outside the ones you point it at.
 *
 * ## Usage — DRY RUN IS THE DEFAULT
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat sa.json)" \
 *     node scripts/restore-firestore.mjs --dir backups/firestore-2026...Z
 *
 *   # narrow to one collection path (recommended for anything but a full
 *   # disaster recovery — the runbook's targeted-restore recipe):
 *   node scripts/restore-firestore.mjs --dir <dir> --only reviews
 *   node scripts/restore-firestore.mjs --dir <dir> --only "clubs/ID/reads/ID/comments"
 *
 *   # nothing is written until --commit is also passed:
 *   node scripts/restore-firestore.mjs --dir <dir> --only reviews --commit
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { reviveTimestamps, countSerializedTimestamps } from './lib/firestore-timestamps.mjs';

const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const dir = dirIdx >= 0 ? args[dirIdx + 1] : null;
const onlyIdx = args.indexOf('--only');
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const commit = args.includes('--commit');

if (!dir) {
  console.error('Usage: node scripts/restore-firestore.mjs --dir <backup-dir> [--only <collection-path>] [--commit]');
  process.exit(2);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON is not set — see docs/access/backup-restore.md §3.');
  process.exit(2);
}
let serviceAccount;
try {
  serviceAccount = JSON.parse(raw);
} catch {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON does not parse as JSON — refusing.');
  process.exit(2);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== '_summary.json');
if (files.length === 0) {
  console.error(`No collection JSON files found in ${dir} — wrong directory?`);
  process.exit(2);
}

const targets = files
  .map((f) => ({ file: f, path: basename(f, '.json').replace(/__/g, '/') }))
  .filter((t) => !only || t.path === only);

if (targets.length === 0) {
  console.error(`--only ${only} matched nothing in ${dir}. Files present decode to:`);
  for (const f of files) console.error(`  ${basename(f, '.json').replace(/__/g, '/')}`);
  process.exit(2);
}

console.error(`Project: ${serviceAccount.project_id ?? '(unknown)'}`);
console.error(`Mode: ${commit ? '⚠️  LIVE — writing for real' : 'DRY RUN — pass --commit to write'}`);
console.error(`Targets (${targets.length}):`);

// Read each target once up front, so the dry run reports the SAME numbers the
// commit path will act on — docs, timestamps, and (RECOVERY.md §4.2) how many
// `{_seconds,_nanoseconds}` values will be converted back to real Timestamps.
let totalTimestamps = 0;
for (const t of targets) {
  t.docs = JSON.parse(readFileSync(join(dir, t.file), 'utf8'));
  t.timestamps = t.docs.reduce((n, d) => n + countSerializedTimestamps(d.data), 0);
  totalTimestamps += t.timestamps;
  console.error(`  ${t.path}  (${t.docs.length} docs, ${t.timestamps} timestamps to revive)`);
}
console.error(
  `\n${totalTimestamps} serialized timestamp(s) will be written back as real Firestore ` +
    'Timestamps, not maps (scripts/lib/firestore-timestamps.mjs — RECOVERY.md §4.2).',
);

if (!commit) {
  console.error('\nDry run only. Re-run with --commit to actually write. Nothing was touched.');
  process.exit(0);
}

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const BATCH_SIZE = 450;

const toTimestamp = (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds);

for (const t of targets) {
  const docs = t.docs;
  const col = db.collection(t.path);
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const slice = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { id, data } of slice) {
      // ⚠️ reviveTimestamps, not `data` — see this file's header and
      // RECOVERY.md §4.2. Writing `data` raw stores every timestamp as a map.
      batch.set(col.doc(id), reviveTimestamps(data, toTimestamp));
    }
    await batch.commit();
    written += slice.length;
  }
  console.error(`  ${t.path}: restored ${written} docs (${t.timestamps} timestamps revived)`);
}

console.error('\nDone.');
