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
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

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
for (const t of targets) console.error(`  ${t.path}`);

if (!commit) {
  console.error('\nDry run only. Re-run with --commit to actually write. Nothing was touched.');
  process.exit(0);
}

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const BATCH_SIZE = 450;

for (const t of targets) {
  const docs = JSON.parse(readFileSync(join(dir, t.file), 'utf8'));
  const col = db.collection(t.path);
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const slice = docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { id, data } of slice) {
      batch.set(col.doc(id), data);
    }
    await batch.commit();
    written += slice.length;
  }
  console.error(`  ${t.path}: restored ${written} docs`);
}

console.error('\nDone.');
