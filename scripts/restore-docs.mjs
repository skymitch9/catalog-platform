#!/usr/bin/env node
/**
 * RESTORE a `docs/` archive written by scripts/backup-docs.mjs.
 *
 * ⚠️ IT SHIPS IN THE SAME COMMIT AS THE BACKUP, ON PURPOSE. The estate's
 * recovery rule is that a restore claim is either DRILLED or labelled a guess;
 * a backup whose restore path is "write a script on the day" is aspirational,
 * and recovery day is the worst possible day to discover that.
 *
 * ## Usage
 *
 *   # 1. Fetch an archive out of the private bucket (wrangler, authenticated):
 *   npx wrangler r2 object get estate-backups/docs/audiobook_catalog/<UTC>.json.gz \
 *     --file ./docs.json.gz --remote
 *
 *   # 2. See what is in it WITHOUT writing anything — always do this first:
 *   node scripts/restore-docs.mjs ./docs.json.gz --list
 *
 *   # 3. Put it back somewhere. --into is REQUIRED and is never the live tree
 *   #    by default:
 *   node scripts/restore-docs.mjs ./docs.json.gz --into ./restored-docs
 *
 * ⚠️ `--into` REFUSES A NON-EMPTY DIRECTORY unless `--force` is given. The
 * failure this prevents is a restore run over a live `docs/` that is NEWER
 * than the archive, silently reverting work — the estate has already destroyed
 * live pipeline output once by assuming a dirty tree was its own mess.
 *
 * ── TWO TREES PER ARCHIVE SINCE 2026-09-06 ──────────────────────────────────
 *
 * Each file entry names its `tree`: `docs` or `claude`. They land in different
 * places under `--into`, and the docs layout is deliberately UNCHANGED so the
 * drilled `diff -r` recipe in backup-restore.md §6b still works:
 *
 *   tree "docs"    -> <into>/<path>          (exactly as before)
 *   tree "claude"  -> <into>/.claude/<path>
 *   no `tree` field-> treated as "docs"      (a pre-2026-09-06 archive)
 *
 * 🔴 THE `.claude` HALF MUST NOT BE PUT BACK BY STAGING IT. The estate repos
 * are PUBLIC (`KNOWN_ISSUES.md` KI-2) and `.claude/settings.local.json` can
 * name hosts, paths and machine layout. It is gitignored everywhere and stays
 * that way: copy the restored folder into the repo by hand, and never
 * `git add` anything from inside it.
 */

import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
// ⚠️ In the LIB, not here: this file is a top-level program, so a test that
// imported it to check the mapping would run a restore instead.
import { destPathFor, treeOf } from './lib/backup-docs-trees.mjs';

const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith('--'));
const LIST = argv.includes('--list');
const FORCE = argv.includes('--force');
const intoIdx = argv.indexOf('--into');
const INTO = intoIdx === -1 ? null : argv[intoIdx + 1];

if (!src) {
  console.error('Usage: node scripts/restore-docs.mjs <archive.json.gz> (--list | --into <dir> [--force])');
  process.exit(2);
}

const payload = JSON.parse(gunzipSync(readFileSync(src)).toString('utf8'));
console.log(
  `${payload.repo} — ${payload.file_count} file(s), ${(payload.total_bytes / 1024).toFixed(0)} KB, ` +
    `taken ${payload.backed_up_at} from ${payload.source}`,
);
if (payload.contains) console.log(`⚠️ ${payload.contains}`);

// The per-tree ledger, when the archive carries one (2026-09-06 and later).
// ⚠️ `missing` and `empty` are printed as they were recorded: a reader has to be
// able to tell "the folder was never there" from "it was there and held
// nothing", and after KI-14 the second is the state of three `.claude` folders.
if (Array.isArray(payload.trees)) {
  for (const t of payload.trees) {
    console.log(`  tree ${t.tree}: ${t.status} — ${t.file_count} file(s), ${(t.bytes / 1024).toFixed(0)} KB (${t.root})`);
  }
}

// ⚠️ VERIFY BEFORE OFFERING TO RESTORE. Every entry carries a sha256; checking
// them costs milliseconds and is the difference between "the archive exists"
// and "the archive is intact". A corrupt archive discovered during a restore
// is discovered at the worst moment.
let bad = 0;
for (const f of payload.files) {
  const buf = Buffer.from(f.b64, 'base64');
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== f.sha256 || buf.length !== f.bytes) {
    console.error(`  ✗ CORRUPT: ${f.path}`);
    bad++;
  }
}
console.log(bad === 0 ? '✓ every file matches its recorded sha256 and length.' : `✗ ${bad} file(s) failed verification.`);
if (bad > 0) process.exit(1);

if (LIST || !INTO) {
  for (const f of payload.files) console.log(`  [${treeOf(f)}] ${f.path}  (${f.bytes} B, ${f.mtime})`);
  if (!INTO && !LIST) console.log('\nNothing written — pass --into <dir> to restore.');
  process.exit(0);
}

const dest = resolve(INTO);
if (existsSync(dest) && readdirSync(dest).length > 0 && !FORCE) {
  console.error(
    `REFUSING: ${dest} is not empty. A restore over a live docs tree can silently revert work that is ` +
      `newer than this archive. Restore into a fresh directory and diff, or pass --force if you mean it.`,
  );
  process.exit(1);
}

let claudeCount = 0;
for (const f of payload.files) {
  const out = destPathFor(f, dest);
  if (treeOf(f) === 'claude') claudeCount++;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(f.b64, 'base64'));
}
console.log(`Restored ${payload.files.length} file(s) into ${dest}.`);
if (claudeCount > 0) {
  console.log(
    `⚠️ ${claudeCount} of those are the repo's .claude/ project folder, restored to ${join(dest, '.claude')}. ` +
      `Copy it back into the repo by hand if you want it — and NEVER stage it: the estate repos are PUBLIC ` +
      `(KNOWN_ISSUES.md KI-2) and .claude/settings.local.json can name hosts, paths and machine layout.`,
  );
}
