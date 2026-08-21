#!/usr/bin/env node
/**
 * BACK UP THE ESTATE'S `docs/` TREES — the ones git does not carry.
 *
 * Owner, 2026-08-21: *"for our docs folders we don't want those on git but
 * they're so important to our work. Can we get those into blob and or Google
 * Drive? Do this task now regardless of usage."*
 *
 * ── ⚠️ WHY THE EXISTING R2 SNAPSHOT IS NOT THIS ─────────────────────────────
 *
 * `audiobook_catalog/scripts/publish_docs_snapshot.py` already puts docs into
 * R2 — and it is **not a backup**, by design, in four ways that each remove
 * exactly the files a restore would most need:
 *
 *   1. `.md` ONLY. That excludes `DRIVE_AUDIT_REPORT.csv`,
 *      `drive-exceptions.json`, `permission-snapshot-*.json`, the
 *      `SHELF_*.fragment.html` pair and both `deploys.log`.
 *   2. ⚠️ It permanently DENYLISTS `access/CREDENTIALS.md` — the estate-wide
 *      credential catalogue, and the single least reproducible document here.
 *   3. Three repos, not four (`Board_Game_Catalog` is absent).
 *   4. Its scanner may REFUSE a file, which is right for a corpus GABI reads
 *      aloud and wrong for an archive: an archive that drops what it dislikes
 *      is an archive that lies about being complete.
 *
 * Both are correct for their own job. The failure to avoid is assuming one is
 * the other — a snapshot restored in a disaster would look complete and be
 * missing the credential catalogue. So this script takes **everything**.
 *
 * 🔴 AND "EVERYTHING" IS MORE THAN IT SOUNDS — MEASURED ON THE FIRST REAL RUN,
 * 2026-08-21. `audiobook_catalog/docs/access/keys/` holds RAW SECRET VALUES,
 * not names: service-account JSON for Firebase and the restore-drill project,
 * and the shelf parity token. So these archives are not "documentation with a
 * sensitive file in them" — they are **key material**, and they are the most
 * sensitive objects in `estate-backups`.
 *
 * That is deliberate, and it is what RECOVERY.md asks for: a secret with no
 * reachable copy is a named gap at the top of that document. But it sets the
 * handling rule, and the rule is not negotiable: this bucket stays bound to no
 * Worker, these objects are never copied anywhere that serves bytes to a
 * person, and a restore lands in a scratch directory that then gets deleted —
 * never straight into a shared tree.
 *
 * ── WHERE IT GOES, AND WHY THERE ────────────────────────────────────────────
 *
 * `estate-backups`, the private bucket that already holds every D1 export, the
 * Firestore dump and the R2 object dumps, under the same
 * `<kind>/<store>/<UTC-timestamp>.<ext>` shape:
 *
 *     estate-backups/docs/<repo>/<UTC>.json.gz
 *
 * ⚠️ NOT `estate-docs-gated`. That bucket is BOUND TO A WORKER and served,
 * gated, to people; putting an unfiltered archive containing CREDENTIALS.md
 * into it would put that file one routing mistake away from a reader.
 * `estate-backups` is bound to nothing and read only by a human with wrangler.
 * The guard below refuses any other bucket for exactly this reason.
 *
 * ── WHY IT RUNS HERE AND NOT IN CI ──────────────────────────────────────────
 *
 * Same reason the snapshot publisher does: ⚠️ **these trees exist on this
 * machine and nowhere else.** A CI job would produce a cheerful archive of the
 * one docs tree that IS committed and silently omit the rest.
 *
 * ## Usage
 *
 *   node scripts/backup-docs.mjs --dry-run     # inventory only, uploads nothing
 *   node scripts/backup-docs.mjs               # build + upload every repo
 *   node scripts/backup-docs.mjs --out ./tmp   # keep the bundles on disk too
 *
 * Restore: `docs/access/backup-restore.md` §6b.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const outFlag = argv.indexOf('--out');
const OUT_DIR = outFlag === -1 ? null : argv[outFlag + 1];

/**
 * ⚠️ HARD-PINNED. A bucket name passed in on the command line is how an
 * archive holding the credential catalogue ends up in a bucket something
 * serves. If this ever needs to change it should be a commit with an argument
 * attached, not a flag somebody typed in a hurry.
 */
const BUCKET = 'estate-backups';

/**
 * ⚠️ AN EXPLICIT LIST, DEFAULT DENY — never a walk of the parent directory.
 * The parent holds eight other repos (a Ruby mod, a WoW recorder, scraping
 * tools); a walk would sweep whatever `docs/` any of them grows, into the
 * estate's private bucket, with nobody deciding that.
 *
 * A repo joins by being added HERE, with its docs tree named.
 */
const REPO_ROOT = resolve(process.cwd(), '..');
const REPOS = [
  { name: 'catalog-platform', docs: join(REPO_ROOT, 'catalog-platform', 'docs') },
  { name: 'audiobook_catalog', docs: join(REPO_ROOT, 'bookbuddy', 'audiobook_catalog', 'docs') },
  { name: 'library_catalog', docs: join(REPO_ROOT, 'bookbuddy', 'library_catalog', 'docs') },
  { name: 'board_game_catalog', docs: join(REPO_ROOT, 'boardbuddy', 'Board_Game_Catalog', 'docs') },
];

/**
 * ⚠️ NO EXTENSION FILTER AND NO DENYLIST. Stated as a decision rather than
 * left to be inferred from an absence: this is the half of the docs story that
 * takes everything, and the snapshot publisher is the half that is careful.
 * A single file skipped here is a file that does not come back.
 *
 * The one thing excluded is a directory that is not documentation at all.
 */
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__']);
/** A single file this large is not a doc; flag it rather than silently ship it. */
const WARN_FILE_BYTES = 5 * 1024 * 1024;

function walk(dir, base, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, base, out);
    } else if (e.isFile()) {
      out.push(full);
    }
    // Symlinks are deliberately NOT followed: a link out of the docs tree
    // would pull in whatever it points at, which is precisely the "walk the
    // parent" failure wearing a different hat.
  }
  return out;
}

function bundleRepo(repo) {
  const files = walk(repo.docs, repo.docs);
  const entries = [];
  let bytes = 0;
  for (const full of files) {
    const buf = readFileSync(full);
    // POSIX separators in the archive so a restore is not Windows-shaped.
    const rel = relative(repo.docs, full).split(sep).join('/');
    if (buf.length > WARN_FILE_BYTES) {
      console.log(`  ⚠️ large: ${rel} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
    }
    entries.push({
      path: rel,
      bytes: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      // base64 so binary files (the JSON/CSV/HTML fragments, and anything
      // added later) round-trip byte-exact rather than through a text decode.
      b64: buf.toString('base64'),
      mtime: statSync(full).mtime.toISOString(),
    });
    bytes += buf.length;
  }
  return { entries, bytes };
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-(\d{3})Z$/, 'Z');
const results = [];

for (const repo of REPOS) {
  console.log(`\n=== ${repo.name} — ${repo.docs} ===`);
  const { entries, bytes } = bundleRepo(repo);

  // ⚠️ A REPO THAT YIELDS ZERO FILES IS A FAILURE, NOT AN EMPTY BACKUP. Same
  // rule as backup-r2.mjs's zero-object listing and backup-firestore.mjs's:
  // the overwhelmingly likely cause is a moved directory or a typo in REPOS,
  // and quietly writing an empty archive over a good one is how a backup
  // becomes worse than none.
  if (entries.length === 0) {
    console.error(
      `REFUSING: ${repo.name} produced 0 files from ${repo.docs}. That is a missing or moved docs ` +
        `tree, not an empty one — fix the path in REPOS rather than shipping an empty archive.`,
    );
    process.exit(1);
  }

  const payload = {
    repo: repo.name,
    source: repo.docs,
    backed_up_at: new Date().toISOString(),
    // Said IN THE ARCHIVE, not only in this file, because the person opening
    // it in a disaster is not reading the script that made it.
    contains:
      'EVERY file under this docs tree, unfiltered — including access/CREDENTIALS.md AND access/keys/, ' +
      'which holds RAW SECRET VALUES (service-account JSON, bearer tokens). Treat this archive as key material.',
    file_count: entries.length,
    total_bytes: bytes,
    files: entries,
  };
  const gz = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 });
  console.log(
    `  ${entries.length} file(s), ${(bytes / 1024).toFixed(0)} KB raw -> ${(gz.length / 1024).toFixed(0)} KB gzipped`,
  );

  const key = `docs/${repo.name}/${stamp}.json.gz`;
  let localPath = null;
  if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    localPath = join(OUT_DIR, `docs-${repo.name}-${stamp}.json.gz`);
    writeFileSync(localPath, gz);
  }

  if (DRY) {
    console.log(`  DRY RUN — would write ${BUCKET}/${key}`);
    results.push({ repo: repo.name, key, count: entries.length, bytes: gz.length, uploaded: false });
    continue;
  }

  // wrangler needs a file on disk. Write a temp copy when --out was not given.
  const tmpDir = OUT_DIR || join(process.cwd(), '.docs-backup-tmp');
  if (!OUT_DIR) mkdirSync(tmpDir, { recursive: true });
  const filePath = localPath || join(tmpDir, `docs-${repo.name}-${stamp}.json.gz`);
  if (!localPath) writeFileSync(filePath, gz);

  // ⚠️ `--remote` is not optional. Without it wrangler writes to the LOCAL
  // simulated bucket and reports success — a backup that exists only in a
  // .wrangler directory on the machine whose loss it is supposed to survive.
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', filePath, '--remote', '-y'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  console.log(`  wrote ${BUCKET}/${key}`);
  results.push({ repo: repo.name, key, count: entries.length, bytes: gz.length, uploaded: true });
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(`${r.repo}: ${r.count} files, ${(r.bytes / 1024).toFixed(0)} KB -> ${r.key}${r.uploaded ? '' : ' (dry run)'}`);
}
console.log(
  `\n🔴 These archives are UNFILTERED. They include access/CREDENTIALS.md AND access/keys/ — ` +
    `i.e. RAW SECRET VALUES (service-account JSON, bearer tokens), not merely their names. ` +
    `${BUCKET} is bound to no Worker and served to nobody: keep it that way, and restore into a ` +
    `scratch directory you then delete. Restore: docs/access/backup-restore.md §6b.`,
);
