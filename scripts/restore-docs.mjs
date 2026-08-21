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
 */

import { gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

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
  for (const f of payload.files) console.log(`  ${f.path}  (${f.bytes} B, ${f.mtime})`);
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

for (const f of payload.files) {
  const out = join(dest, f.path);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(f.b64, 'base64'));
}
console.log(`Restored ${payload.files.length} file(s) into ${dest}.`);
