#!/usr/bin/env node
/**
 * Estate R2 backup — full object dump of one or more R2 buckets via the
 * Cloudflare REST API (docs/access/backup-restore.md §8 is the runbook; this
 * closes the "library-covers has no backup path" gap recorded there
 * 2026-08-14).
 *
 * ## Why the plain REST API and not `wrangler` or the S3-compatible API
 *
 * As of wrangler 4.123.0 (checked 2026-08-15), `wrangler r2 object` still
 * has only `get` / `put` / `delete` — no `list` (tracked upstream as
 * cloudflare/workers-sdk#13008, open since March 2026). That is what the
 * runbook's gap was really about: there was no way to enumerate a bucket's
 * keys without minting new S3-compatible credentials.
 *
 * But the plain Cloudflare REST API (the one behind api.cloudflare.com,
 * NOT the S3-compatible endpoint) has carried object list/get/put/delete
 * for R2 the whole time:
 *
 *   GET /accounts/{account_id}/r2/buckets/{bucket}/objects            (list, paginated via `cursor`)
 *   GET /accounts/{account_id}/r2/buckets/{bucket}/objects/{key}      (get — object body + metadata)
 *
 * authenticated with a normal `Authorization: Bearer <token>` header — the
 * same style of token `CLOUDFLARE_API_TOKEN` already is, no S3 access
 * key/secret pair required. The only catch: the token needs the
 * account-level **"Workers R2 Storage Read"** permission group, which is
 * NOT part of the "Edit Cloudflare Workers" template this estate's existing
 * token was created from (verified against developers.cloudflare.com/r2/api/tokens/,
 * 2026-08-15 — "Object Read only" in the dashboard's own token wizard is
 * explicitly scoped to the S3-compatible API only; the REST API's own read
 * permission is the separate "Workers R2 Storage Read" group). If the guard
 * step in backup.yml fails with a 9109/403 from this script, that is the
 * fix: dash.cloudflare.com → My Profile → API Tokens → edit
 * CLOUDFLARE_API_TOKEN → add "Workers R2 Storage Read" (Account) — no new
 * token, no S3 keys, just one more permission group on the token that
 * already exists.
 *
 * Proven locally 2026-08-15 before this script was written: listed
 * `library-covers` (208 objects) and `audiobook-covers` (1000+, paginated)
 * via this exact endpoint, downloaded a sample object both via this REST
 * `get` and via `wrangler r2 object get --remote`, and diffed the bytes —
 * identical.
 *
 * ## What it does
 *
 * For each bucket named on the command line: paginates the full object
 * listing, writes `manifest.json` (key/etag/size/last_modified/contentType
 * for every object — the restore/verification source of truth), then
 * downloads every object's bytes into `objects/<key>`, verifying each
 * download's byte length against the listing's reported size as it goes.
 * Refuses to report success if a listed object failed to download, or if
 * the listing came back empty for a bucket expected to hold data (pass
 * `--allow-empty` to permit a genuinely-empty bucket, e.g. `bgc-photos`,
 * which is unbound and holds 0 objects as of 2026-08-15).
 *
 * ## Usage
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     BACKUP_OUT_DIR=./backups/r2-library-covers-manual \
 *     node scripts/backup-r2.mjs library-covers
 *
 *   node scripts/backup-r2.mjs library-covers audiobook-covers   # BACKUP_OUT_DIR per bucket, auto-named
 *
 * `.github/workflows/backup.yml`'s `r2` job sets CLOUDFLARE_API_TOKEN /
 * CLOUDFLARE_ACCOUNT_ID from repo secrets, then tars BACKUP_OUT_DIR and writes
 * it into the private `estate-backups` R2 bucket, one object per bucket, same
 * shape as the D1/Firestore jobs. (It used to upload a workflow artifact;
 * retired 2026-08-15 — artifacts on a public repo are one anonymous login away
 * from anyone.)
 *
 * ⚠️ WHICH buckets that job dumps, and which it deliberately skips and why, is
 * argued in backup.yml's own header beside the matrix it explains — not
 * repeated here, so the two cannot drift. As of 2026-08-18 the matrix is
 * library-covers, audiobook-covers, game-covers, ebooks-gated,
 * estate-docs-gated.
 *
 * 🔴 ONE bucket is refused MECHANICALLY here, not merely left out of the
 * matrix: `estate-audio`. See REFUSED_BUCKETS below — it holds ~685 GB of
 * disaster-recovery archive and is itself the backup copy.
 */

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ALLOW_EMPTY = process.argv.includes('--allow-empty');
const buckets = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (!API_TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is not set. See docs/access/backup-restore.md §3/§8.');
  process.exit(1);
}
if (!ACCOUNT_ID) {
  console.error('CLOUDFLARE_ACCOUNT_ID is not set.');
  process.exit(1);
}
if (buckets.length === 0) {
  console.error('Usage: node scripts/backup-r2.mjs <bucket> [<bucket> ...] [--allow-empty]');
  process.exit(1);
}

// 🔴 MECHANICAL GUARD — REFUSED_BUCKETS, added 2026-08-18.
//
// `estate-audio` now holds the DISASTER-RECOVERY ARCHIVE of the audiobook
// library: 1,260 objects / ~685 GB under the `archive/` prefix, written by
// audiobook_catalog/scripts/archive_audio_r2.py on the owner's order ("we lose
// this data we lose it all and the server isnt ready yet").
//
// This script downloads EVERY OBJECT'S BYTES to local disk, and backup.yml then
// tars the result. On a GitHub runner (14 GB of free disk) that is not a slow
// backup, it is a full disk, a failed job, and — because the retention job runs
// on every dispatch regardless of outcome — a red X across the whole nightly
// run. It also would not be a backup: this bucket IS the off-site copy, whose
// master is the owner's local library. A backup of a backup, eight generations
// deep, at 685 GB a generation.
//
// The written rule lived in backup.yml's header and in backup-restore.md and
// said, for months, "add estate-audio the day it holds anything" — which is
// exactly the sentence that would have caused this. Prose lost; this is the
// guard that does not.
//
// The escape hatch is deliberately awkward (an env var, never a flag), because
// anyone who genuinely means it should have to say so in a way nobody types by
// accident: BACKUP_R2_ALLOW_REFUSED=estate-audio.
const REFUSED_BUCKETS = {
  'estate-audio':
    'holds the ~685 GB disaster-recovery ARCHIVE of the audiobook library ' +
    '(archive/ prefix). It is itself the off-site backup copy — tarring it ' +
    'nightly onto a 14 GB runner is an outage, not a backup. See ' +
    'backup.yml\'s header and audiobook_catalog docs/access/AUDIO_ARCHIVE.md.',
};
const allowedRefusals = (process.env.BACKUP_R2_ALLOW_REFUSED || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
for (const b of buckets) {
  if (REFUSED_BUCKETS[b] && !allowedRefusals.includes(b)) {
    console.error(
      `REFUSING to back up "${b}": ${REFUSED_BUCKETS[b]}\n` +
        `If you truly mean it, set BACKUP_R2_ALLOW_REFUSED=${b} and re-run — and ` +
        `check the runner has the disk for it first.`
    );
    process.exit(1);
  }
}

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${API_TOKEN}`, ...(opts.headers || {}) },
  });
  return res;
}

/** Paginate GET .../objects, return the full array of object metadata. */
async function listAllObjects(bucket) {
  const all = [];
  let cursor;
  for (;;) {
    const qs = new URLSearchParams({ per_page: '1000' });
    if (cursor) qs.set('cursor', cursor);
    const res = await cfFetch(`/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects?${qs}`);
    const body = await res.json();
    if (!res.ok || !body.success) {
      const detail = JSON.stringify(body.errors ?? body);
      throw new Error(
        `Listing ${bucket} failed (HTTP ${res.status}): ${detail}\n` +
          `If this is a 9109/403/"not authorized": the token needs the account-level ` +
          `"Workers R2 Storage Read" permission group — see this script's header comment.`
      );
    }
    all.push(...body.result);
    if (!body.result_info?.is_truncated) break;
    cursor = body.result_info.cursor;
  }
  return all;
}

/**
 * ⚠️ RETRY EXISTS BECAUSE ONE TRANSIENT 500 KILLED A WHOLE BUCKET — MEASURED.
 *
 * Run 32111218016 (2026-08-18): `audiobook-covers` listed 1,972 objects, got
 * roughly three minutes into downloading them, and died on ONE object with
 *
 *     GET audiobook-covers/<key> failed (HTTP 500):
 *     {"code":10001,"message":"We encountered an internal error. Please try again."}
 *
 * Cloudflare's own error text says *"please try again"* and this script did
 * not. That was survivable while backups were a manual button-press somebody
 * watched; it is not survivable now the workflow runs DAILY AND UNATTENDED,
 * where the failure mode is a bucket quietly missing from a night's backup.
 *
 * Retries are deliberately narrow:
 *   - only 5xx and 429 (server-side and rate-limit). A 401/403/404 is a real
 *     answer about permissions or a vanished key and retrying it just turns a
 *     clear failure into a slow one;
 *   - 4 attempts, exponential backoff with jitter (~0.5s, 1s, 2s);
 *   - every retry is LOGGED, so a bucket that only succeeds by retrying looks
 *     different in the log from one that succeeded first time. A silent retry
 *     would hide a degrading bucket, which is its own kind of dishonesty;
 *   - after the last attempt it throws exactly as before. A backup that cannot
 *     read an object still FAILS — the size check below and the zero-object
 *     rule above are unchanged. This makes the job survive a blip, not
 *     tolerate a broken bucket.
 */
const GET_ATTEMPTS = 4;
const isRetryable = (status) => status >= 500 || status === 429;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getObjectBytes(bucket, key) {
  // Object keys can contain characters that need escaping per path segment,
  // but literal '/' must stay unescaped (Cloudflare's own docs: send slashes
  // literally, do not percent-encode them).
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const path = `/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${encodedKey}`;

  let lastError = null;
  for (let attempt = 1; attempt <= GET_ATTEMPTS; attempt++) {
    let res;
    try {
      res = await cfFetch(path);
    } catch (err) {
      // A dropped socket / DNS blip is the same class of problem as a 500.
      lastError = new Error(`GET ${bucket}/${key} failed (network): ${err.message}`);
      if (attempt === GET_ATTEMPTS) break;
      const wait = Math.round(250 * 2 ** attempt * (1 + Math.random()));
      console.log(`  retry ${attempt}/${GET_ATTEMPTS - 1} for ${key} after ${wait}ms — ${err.message}`);
      await sleep(wait);
      continue;
    }

    if (res.ok) return Buffer.from(await res.arrayBuffer());

    const text = await res.text();
    lastError = new Error(`GET ${bucket}/${key} failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
    if (!isRetryable(res.status) || attempt === GET_ATTEMPTS) break;

    const wait = Math.round(250 * 2 ** attempt * (1 + Math.random()));
    console.log(`  retry ${attempt}/${GET_ATTEMPTS - 1} for ${key} after ${wait}ms — HTTP ${res.status}`);
    await sleep(wait);
  }
  throw lastError;
}

async function backupBucket(bucket) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = process.env.BACKUP_OUT_DIR || `backups/r2-${bucket}-${stamp}`;
  console.log(`\n=== ${bucket} → ${outDir} ===`);

  const objects = await listAllObjects(bucket);
  console.log(`Listed ${objects.length} object(s) in ${bucket}.`);

  if (objects.length === 0 && !ALLOW_EMPTY) {
    throw new Error(
      `${bucket} listed 0 objects. Treating a zero-object listing as a failed backup, ` +
        `not an empty bucket (same rule as seed-estate.mjs/backup-firestore.mjs) — ` +
        `pass --allow-empty if this bucket is genuinely expected to be empty right now.`
    );
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ bucket, backed_up_at: new Date().toISOString(), objects }, null, 2));

  let totalBytes = 0;
  for (const obj of objects) {
    const bytes = await getObjectBytes(bucket, obj.key);
    if (bytes.length !== obj.size) {
      throw new Error(`${bucket}/${obj.key}: downloaded ${bytes.length} bytes, listing said ${obj.size}. Treating as a failed backup.`);
    }
    const dest = join(outDir, 'objects', obj.key);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    totalBytes += bytes.length;
  }

  console.log(`${bucket}: downloaded ${objects.length} object(s), ${totalBytes} bytes total, into ${outDir}/objects/`);
  return { bucket, outDir, count: objects.length, totalBytes };
}

const results = [];
for (const bucket of buckets) {
  results.push(await backupBucket(bucket));
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(`${r.bucket}: ${r.count} objects, ${r.totalBytes} bytes → ${r.outDir}`);
}
