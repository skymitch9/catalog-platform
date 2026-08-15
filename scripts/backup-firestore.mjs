#!/usr/bin/env node
/**
 * Estate Firestore backup — recursive per-collection JSON dump via a service
 * account (docs/access/backup-restore.md is the runbook; this is the tool it
 * calls).
 *
 * ## Why a script and not `gcloud firestore export`
 *
 * The managed export/import service (the thing `gcloud firestore export`
 * drives) needs a GCS bucket in the same GCP project, Storage Admin granted
 * to the Firestore service agent, and — for anything beyond the interactive
 * `gcloud` path — a service account with Cloud Datastore Import Export Admin.
 * None of that exists for `audiobook-catalog` today, and standing this up
 * (a paid-tier GCS bucket, IAM bindings, a second credential) is real new
 * infrastructure for a household backup. The Admin SDK this script already
 * uses can read every document today with the same credential the pipeline
 * already trusts (`scripts/firebase_service_account.json` in
 * audiobook_catalog — see FIREBASE.md). So: build the pragmatic path now,
 * document the gcloud path as the future upgrade if the estate ever needs
 * point-in-time GCS-native restore. See docs/access/backup-restore.md §3.
 *
 * ## Why this does NOT run inside a Cloudflare Worker
 *
 * `estate-auth-design.md` §4.1 is a standing refusal: no Firestore service
 * account in any Worker — "the most powerful credential in the household
 * behind the least important endpoint". A GitHub Actions job dispatched by
 * hand, gated behind repo write access, with the secret never printed to a
 * log, is a different trust boundary — the same one the existing pipeline
 * already uses this exact credential under (PIPELINE_REMOTE.md). This script
 * does not change that decision; it runs alongside it, not inside a Worker.
 *
 * ## What it does
 *
 * Walks EVERY root collection and recurses into EVERY subcollection of every
 * document (`doc.ref.listCollections()`), so a new collection or a new club
 * subcollection needs no edit here — unlike a hardcoded list, this cannot go
 * stale the way FIREBASE.md's collection table can. One JSON file per
 * collection PATH (slashes become `__`), plus `_summary.json` with counts.
 *
 * Mirrors seed-estate.mjs's rule: **a zero-collection read is a failed read,
 * not an empty project** — refuses to write a backup that looks complete but
 * silently caught nothing (wrong project, mis-scoped credential, expired key).
 *
 * ## Usage
 *
 *   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat path/to/firebase_service_account.json)" \
 *     node scripts/backup-firestore.mjs
 *
 *   BACKUP_OUT_DIR=./backups/firestore-manual node scripts/backup-firestore.mjs
 *
 * The GitHub Actions workflow (`.github/workflows/backup.yml`) sets
 * FIREBASE_SERVICE_ACCOUNT_JSON from the repo secret of the same name and
 * uploads BACKUP_OUT_DIR as a private artifact. The credential is never
 * written to disk here — `cert()` takes the parsed object directly, so there
 * is no temp file to forget to clean up.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!raw) {
  console.error(
    'FIREBASE_SERVICE_ACCOUNT_JSON is not set. Pass the full JSON content of a Firebase ' +
      'service account key (Firebase console → Project settings → Service accounts → ' +
      'Generate new private key) as this env var. See docs/access/backup-restore.md §3.',
  );
  process.exit(2);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(raw);
} catch {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON does not parse as JSON — refusing.');
  process.exit(2);
}

const app = initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = process.env.BACKUP_OUT_DIR ?? join('backups', `firestore-${stamp}`);
mkdirSync(outDir, { recursive: true });

let totalDocs = 0;
let totalCollections = 0;
const summary = [];

async function dumpCollection(colRef, pathLabel) {
  const snap = await colRef.get();
  const docs = snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));

  const fileName = `${pathLabel.replace(/\//g, '__')}.json`;
  writeFileSync(join(outDir, fileName), JSON.stringify(docs, null, 2));

  totalDocs += docs.length;
  totalCollections += 1;
  summary.push({ path: pathLabel, docs: docs.length });
  console.error(`  ${pathLabel}: ${docs.length} docs`);

  for (const doc of snap.docs) {
    const subcols = await doc.ref.listCollections();
    for (const sub of subcols) {
      await dumpCollection(sub, `${pathLabel}/${doc.id}/${sub.id}`);
    }
  }
}

console.error(`Project: ${serviceAccount.project_id ?? '(unknown)'}`);
console.error('Walking root collections...');

const roots = await db.listCollections();
if (roots.length === 0) {
  console.error(
    'ZERO root collections returned — a zero-collection read is a failed read, not an empty ' +
      'project (wrong project_id in the key? a scoped-down service account?). Refusing to write ' +
      'a backup that would look complete and be empty.',
  );
  process.exit(2);
}

for (const root of roots) {
  await dumpCollection(root, root.id);
}

writeFileSync(
  join(outDir, '_summary.json'),
  JSON.stringify(
    {
      project: serviceAccount.project_id ?? null,
      generatedAt: new Date().toISOString(),
      totalCollections,
      totalDocs,
      collections: summary,
    },
    null,
    2,
  ),
);

console.error(`\nDone: ${totalCollections} collections, ${totalDocs} documents -> ${outDir}`);
