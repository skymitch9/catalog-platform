#!/usr/bin/env node
/**
 * BACK UP THE ESTATE'S `docs/` AND `.claude/` TREES — the ones git does not carry.
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
 * ── 🔴 THE `.claude/` FOLDERS JOINED ON 2026-09-06, AFTER LOSING SIX OF THEM ─
 *
 * Owner, 2026-09-06 00:5x Phoenix, item 1 of the sixteen: *"Yes."*
 *
 * `KNOWN_ISSUES.md` KI-14: an `rm -rf /c/lcw` destroyed six `.claude/` project
 * folders across the estate. Nothing TRACKED was lost, and that is the whole
 * problem — `.claude/` is gitignored everywhere, so the deletion left no trace
 * in git and no copy anywhere else. The folders held permission allowlists and
 * project-local agents and skills, and `scripts/onedrive-exclude.ps1` had
 * deliberately moved them OUT of the syncing folder, so OneDrive had no copy
 * either. This script archived **4 docs trees and 0 `.claude` trees**; that is
 * the number the owner's "Yes" changes.
 *
 * ⚠️ **KI-2 — the repos are PUBLIC, so this must never become a tracked file.**
 * A `settings.local.json` can name hosts, paths and machine layout. The archive
 * goes to the private `estate-backups` bucket and nowhere else; nothing here
 * stages anything into git, and `.claude/` stays gitignored.
 *
 * ⚠️ **A missing or EMPTY `.claude` is a logged no-op, never a failure.**
 * `library_catalog` has none at all, and after KI-14 the other three are
 * junctions to empty targets. Making the new tree required would mean the
 * incident that motivated the feature also broke the backup that answers it.
 * The `docs` tree keeps the old refusal; see `lib/backup-docs-trees.mjs`.
 *
 * ── WHERE IT GOES, AND WHY THERE ────────────────────────────────────────────
 *
 * `estate-backups`, the private bucket that already holds every D1 export, the
 * Firestore dump and the R2 object dumps, under the same
 * `<kind>/<store>/<UTC-timestamp>.<ext>` shape:
 *
 *     estate-backups/docs/<repo>/<UTC>.json.gz
 *
 * ⚠️ ONE OBJECT PER REPO, STILL — the `.claude` files ride INSIDE it, tagged
 * `tree: "claude"`, rather than getting a `claude/<repo>` prefix of their own.
 * A new `<kind>/<store>` prefix is a three-place registration pinned by a test
 * that parses the workflow (`KNOWN_BACKUP_PREFIXES` in
 * `apps/auth-worker/src/backups.ts`, the retention invocation in
 * `.github/workflows/backup.yml`, `prune-r2-backups.mjs`'s arguments) AND a new
 * graded row on the live `/status` page needing an auth-worker deploy. Keeping
 * one object leaves retention, grading and the drilled restore recipe untouched,
 * and pairs each `.claude` snapshot with the `docs` snapshot of the same second.
 * Reasoning in full: `lib/backup-docs-trees.mjs`.
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
 * ⚠️ `--dry-run` still WALKS AND READS every file — it is a real inventory, not
 * a path check — so it is the way to exercise a change to this script without
 * touching the bucket.
 *
 * Restore: `docs/access/backup-restore.md` §6b.
 */

import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleRepo, refusalFor, treeLogLine } from './lib/backup-docs-trees.mjs';

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
 *
 * ⚠️ `claude` is the repo's `.claude/` PROJECT folder and is OPTIONAL. In three
 * of the four it is a JUNCTION to `C:\lcw\onedrive-excluded\<repo>\.claude`
 * (`scripts/onedrive-exclude.ps1` puts it there); `library_catalog` has none.
 * Node's `readdir`/`stat` follow junctions, and the walker resolves the tree
 * root before its containment check, so a junctioned folder archives normally.
 * A missing or empty one is a logged no-op.
 */
const REPO_ROOT = resolve(process.cwd(), '..');
const REPOS = [
  {
    name: 'catalog-platform',
    docs: join(REPO_ROOT, 'catalog-platform', 'docs'),
    claude: join(REPO_ROOT, 'catalog-platform', '.claude'),
  },
  {
    name: 'audiobook_catalog',
    docs: join(REPO_ROOT, 'bookbuddy', 'audiobook_catalog', 'docs'),
    claude: join(REPO_ROOT, 'bookbuddy', 'audiobook_catalog', '.claude'),
  },
  {
    name: 'library_catalog',
    docs: join(REPO_ROOT, 'bookbuddy', 'library_catalog', 'docs'),
    claude: join(REPO_ROOT, 'bookbuddy', 'library_catalog', '.claude'),
  },
  {
    name: 'board_game_catalog',
    docs: join(REPO_ROOT, 'boardbuddy', 'Board_Game_Catalog', 'docs'),
    claude: join(REPO_ROOT, 'boardbuddy', 'Board_Game_Catalog', '.claude'),
  },
];

/**
 * The walker, the tree list and the refusal rule all live in
 * lib/backup-docs-trees.mjs — a script whose import runs a backup cannot be
 * imported by a test, and those are the decisions worth pinning. Read that
 * file for the OneDrive placeholder incident, the .claude junctions, and why
 * .claude/worktrees and .claude/.wrangler are excluded.
 */

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/-(\d{3})Z$/, 'Z');
const results = [];

for (const repo of REPOS) {
  console.log(`\n=== ${repo.name} — ${repo.docs} ===`);
  const { entries, bytes, trees, skipped } = bundleRepo(repo, { log: (m) => console.log(m) });
  // ⚠️ ALWAYS PRINTED, INCLUDING FOR A MISSING OR EMPTY `.claude`. A no-op that
  // says nothing is indistinguishable from a step that never ran, and after
  // KI-14 "the .claude folder is empty" is the fact somebody most needs to see.
  for (const t of trees) console.log(treeLogLine(t));

  // ⚠️ A REQUIRED TREE THAT YIELDS ZERO FILES IS A FAILURE, NOT AN EMPTY
  // BACKUP. Same rule as backup-r2.mjs's zero-object listing and
  // backup-firestore.mjs's: the overwhelmingly likely cause is a moved
  // directory or a typo in REPOS, and quietly writing an empty archive over a
  // good one is how a backup becomes worse than none.
  //
  // ⚠️ Only `docs` is required. `.claude` missing or empty is an ordinary
  // state (library_catalog has none; KI-14 emptied three) and must not take the
  // docs backup down with it — see lib/backup-docs-trees.mjs `treesFor`.
  const refusal = refusalFor(trees);
  if (refusal) {
    console.error(
      `REFUSING: ${repo.name} produced 0 files from its ${refusal.tree} tree at ${refusal.root}. That is a ` +
        `missing or moved tree, not an empty one — fix the path in REPOS rather than shipping an empty archive.`,
    );
    process.exit(1);
  }

  const claudeTree = trees.find((t) => t.tree === 'claude');
  const payload = {
    repo: repo.name,
    source: repo.docs,
    backed_up_at: new Date().toISOString(),
    // Said IN THE ARCHIVE, not only in this file, because the person opening
    // it in a disaster is not reading the script that made it.
    contains:
      'EVERY file under this docs tree, unfiltered — including access/CREDENTIALS.md AND access/keys/, ' +
      'which holds RAW SECRET VALUES (service-account JSON, bearer tokens). Treat this archive as key material. ' +
      'Since 2026-09-06 it ALSO carries the repo\'s gitignored .claude/ project folder: every file entry names ' +
      'its `tree` ("docs" or "claude"), and an entry with no `tree` is a pre-2026-09-06 archive and means "docs". ' +
      '.claude/ can name hosts, paths and machine layout — the estate repos are PUBLIC (KI-2), so it must never ' +
      'be restored into a tracked path.',
    // The per-tree ledger. ⚠️ `missing` and `empty` are DIFFERENT states and are
    // recorded separately: one says the folder was never there, the other that
    // it was there and held nothing (the post-KI-14 state of three .claude
    // folders). A file count alone cannot tell a reader those apart.
    trees: trees.map(({ tree, root, required, status, file_count, bytes: b }) => ({
      tree,
      root,
      required,
      status,
      file_count,
      bytes: b,
    })),
    file_count: entries.length,
    total_bytes: bytes,
    claude_file_count: claudeTree ? claudeTree.file_count : 0,
    // Carried IN the archive: a disaster-day reader must be able to see from
    // the dump itself what it does not contain.
    skipped,
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
    results.push({ repo: repo.name, key, count: entries.length, claude: payload.claude_file_count, bytes: gz.length, uploaded: false });
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
  results.push({ repo: repo.name, key, count: entries.length, claude: payload.claude_file_count, bytes: gz.length, uploaded: true });
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(
    `${r.repo}: ${r.count} files (${r.claude} from .claude), ${(r.bytes / 1024).toFixed(0)} KB -> ${r.key}${r.uploaded ? '' : ' (dry run)'}`,
  );
}
console.log(
  `\n🔴 These archives are UNFILTERED. They include access/CREDENTIALS.md AND access/keys/ — ` +
    `i.e. RAW SECRET VALUES (service-account JSON, bearer tokens), not merely their names — and, since ` +
    `2026-09-06, each repo's gitignored .claude/ project folder, which can name hosts, paths and machine ` +
    `layout. ${BUCKET} is bound to no Worker and served to nobody: keep it that way, and restore into a ` +
    `scratch directory you then delete. ⚠️ .claude/ stays UNTRACKED (KI-2 — the estate repos are PUBLIC): ` +
    `restore it back into place by hand, never by staging it. Restore: docs/access/backup-restore.md §6b.`,
);
