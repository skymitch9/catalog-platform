#!/usr/bin/env node
/**
 * Estate backup retention — keeps only the newest N objects per
 * "<kind>/<store>/" prefix in the private `estate-backups` R2 bucket,
 * deleting the rest (docs/access/backup-restore.md is the runbook).
 *
 * ## Why this shape
 *
 * backup.yml writes one object per job-run per store, named
 * `estate-backups/<kind>/<store>/<UTC-timestamp>.<ext>` — the timestamp is
 * an ISO-8601-ish string (`20260815T191234Z`) with no separators other than
 * `T`/`Z`, which sorts lexicographically identically to chronologically. So
 * "keep the newest N" is exactly "keep the N keys that sort last" within
 * each prefix — no need to parse the timestamp out of the key at all.
 *
 * Uses the same plain Cloudflare REST API `scripts/backup-r2.mjs` already
 * uses (list + delete, Bearer-token auth, no S3-compatible credentials) —
 * see that script's header comment for why REST and not `wrangler`/S3
 * (`wrangler r2 object` still has no `list` as of 4.123.0).
 *
 * ## Usage
 *
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
 *     node scripts/prune-r2-backups.mjs estate-backups d1/library-catalog d1/board-game-catalog ... --keep 8
 *
 * Each positional argument after the bucket name is a "<kind>/<store>"
 * prefix to prune independently. `--keep N` defaults to 8. Logs every key
 * kept and every key deleted; never touches a prefix with N or fewer
 * objects (nothing to delete, but still logged so a silent zero-object
 * prefix is visible, not silently "nothing happened").
 */

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;

const args = process.argv.slice(2);
const keepIdx = args.indexOf('--keep');
const KEEP = keepIdx >= 0 ? Number(args[keepIdx + 1]) : 8;
const positional = args.filter((a, i) => a !== '--keep' && i !== keepIdx + 1);
const [bucket, ...prefixes] = positional;

if (!API_TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN is not set.');
  process.exit(1);
}
if (!ACCOUNT_ID) {
  console.error('CLOUDFLARE_ACCOUNT_ID is not set.');
  process.exit(1);
}
if (!bucket || prefixes.length === 0) {
  console.error('Usage: node scripts/prune-r2-backups.mjs <bucket> <kind/store> [<kind/store> ...] [--keep N]');
  process.exit(1);
}
if (!Number.isInteger(KEEP) || KEEP < 1) {
  console.error(`--keep must be a positive integer, got: ${args[keepIdx + 1]}`);
  process.exit(1);
}

const API_BASE = 'https://api.cloudflare.com/client/v4';

async function cfFetch(path, opts = {}) {
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${API_TOKEN}`, ...(opts.headers || {}) },
  });
}

async function listAllObjects(bucket, prefix) {
  const all = [];
  let cursor;
  for (;;) {
    const qs = new URLSearchParams({ per_page: '1000', prefix });
    if (cursor) qs.set('cursor', cursor);
    const res = await cfFetch(`/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects?${qs}`);
    const body = await res.json();
    if (!res.ok || !body.success) {
      throw new Error(`Listing ${bucket}/${prefix} failed (HTTP ${res.status}): ${JSON.stringify(body.errors ?? body)}`);
    }
    all.push(...body.result);
    if (!body.result_info?.is_truncated) break;
    cursor = body.result_info.cursor;
  }
  return all;
}

async function deleteObject(bucket, key) {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const res = await cfFetch(`/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${encodedKey}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${bucket}/${key} failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }
}

let totalDeleted = 0;
for (const prefix of prefixes) {
  const objects = await listAllObjects(bucket, `${prefix}/`);
  // Lexicographic sort == chronological sort for the UTC-timestamp keys
  // backup.yml writes (see header comment). Newest last -> newest first.
  const sorted = [...objects].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  const keep = sorted.slice(0, KEEP);
  const drop = sorted.slice(KEEP);

  console.log(`\n=== ${prefix} — ${objects.length} object(s), keeping ${keep.length}, deleting ${drop.length} ===`);
  for (const o of keep) console.log(`  keep:   ${o.key}`);
  for (const o of drop) {
    await deleteObject(bucket, o.key);
    console.log(`  delete: ${o.key}`);
    totalDeleted += 1;
  }
}

console.log(`\nDone. Deleted ${totalDeleted} object(s) total across ${prefixes.length} prefix(es), keeping up to ${KEEP} each.`);
