#!/usr/bin/env node
/**
 * Estate backup MIRROR — a copy of `estate-backups` that does not live in
 * Cloudflare.
 *
 * Closes the restore drill's owner step #7 (`docs/access/RECOVERY.md` §9.7:
 * *"Get a copy of `estate-backups` off Cloudflare. Everything protected and
 * everything protecting it live in one account."*). Owner decision 2026-08-18,
 * verbatim: *"Do a and b, don't store in GABI tho store in a new folder called
 * GABI_backup on drive"* — BOTH a nightly local-PC mirror AND a Google Drive
 * mirror, the Drive copy in a new top-level `GABI_backup` folder deliberately
 * outside the estate's book folder tree.
 *
 * ## ⚠️ THIS SCRIPT LIVES HERE BUT DOES NOT RUN HERE
 *
 * It sits beside `backup-r2.mjs` / `prune-r2-backups.mjs` because it speaks the
 * same key grammar and shares `lib/backup-keys.mjs` with them. It is NOT wired
 * into `.github/workflows/backup.yml` and must not be: a mirror that runs
 * inside the same Cloudflare-adjacent CI, writing to the same account's
 * credentials, is not an off-Cloudflare copy — it is the same egg in the same
 * basket with an extra step. It runs on the OWNER'S MACHINE, hung off the one
 * unattended job that already runs there (`audiobook_catalog`'s
 * `scripts/sync_to_drive.py`, STEP 10).
 *
 * ## Two halves, and this is the first
 *
 *   1. **THIS SCRIPT** — `estate-backups` → a local OneDrive-synced folder.
 *      The OneDrive sync is the free second cloud: the bytes ride to Microsoft
 *      with no code of ours involved.
 *   2. `audiobook_catalog/scripts/mirror_to_drive.py` — that local folder →
 *      Google Drive `GABI_backup`. It lives there because the estate's Drive
 *      OAuth token lives there (`scripts/token.json`), the same reason
 *      `publish_docs_snapshot.py` lives there rather than in this repo.
 *
 * So a total Cloudflare account loss leaves the backups in **three** places
 * that are not Cloudflare: this PC's disk, OneDrive, and Google Drive.
 *
 * ## ⚠️ HOW IT ENUMERATES THE BUCKET, AND WHY IT IS NOT A LISTING
 *
 * `wrangler r2 object` still has no `list` (4.123.0, confirmed 2026-08-18), and
 * the plain Cloudflare REST list endpoint that `backup-r2.mjs` uses needs
 * `CLOUDFLARE_API_TOKEN`, which is a GitHub repo secret and **is not on this
 * machine** (RECOVERY.md §2/§7 — the interactive `wrangler login` OAuth session
 * this machine does have covers `r2 object get` but NOT that REST endpoint).
 *
 * So the mirror learns the keys the same way the restore drill did — RECOVERY.md
 * §2 method A, the workflow log:
 *
 *     gh run view <run-id> --log | grep "Wrote estate-backups"
 *
 * Every `::notice::Wrote estate-backups/<key>` line is a literal key, and every
 * `::notice::<base> was written as N part(s).` line declares a split archive's
 * part count. Those two together are what make "the latest COMPLETE generation"
 * decidable without a listing — see `completeGenerations()`.
 *
 * ⚠️ The consequence, stated plainly: **the mirror sees what the workflow
 * LOGGED, not what the bucket HOLDS.** If an object were deleted out of band,
 * the mirror would not notice. That is an accepted limitation of not having the
 * REST token here, not an oversight; the day a `CLOUDFLARE_API_TOKEN` lands on
 * this machine, swapping the discovery step for a real listing is a small edit
 * and the rest of this script is unchanged.
 *
 * ## Retention: the mirror FOLLOWS the bucket, it is not an archive
 *
 * ⚠️ **This is a MIRROR of the bucket's current retention, not an infinite
 * archive.** It keeps the newest N GENERATIONS per store — N read out of
 * backup.yml's own `--keep` argument, so the mirror's depth cannot drift from
 * the bucket's — and deletes older local generations. A generation pruned
 * upstream ages out of the mirror too. If you want a copy that outlives the
 * bucket's retention, take one deliberately and put it somewhere this script
 * does not manage; anything inside the mirror root is subject to deletion.
 *
 * Generations are deleted WHOLE, parts together, for the same reason retention
 * does it upstream: half a split archive cannot be reassembled and must never
 * exist (`lib/backup-keys.mjs`'s header).
 *
 * ## Incremental
 *
 * A key already on disk at the size recorded in `mirror-manifest.json` is
 * skipped. First download records `bytes` + `sha256`, so the manifest doubles
 * as the verification source of truth (and as the Drive half's skip index).
 * ⚠️ A file present on disk but ABSENT from the manifest, or present at a
 * different size, is re-downloaded — a half-written file from a killed run must
 * not be mistaken for a mirrored one.
 *
 * ## Usage
 *
 *   node scripts/mirror-estate-backups.mjs                 # mirror, default dir
 *   node scripts/mirror-estate-backups.mjs --dry-run       # plan only, no writes
 *   node scripts/mirror-estate-backups.mjs --keep 4        # override retention depth
 *   node scripts/mirror-estate-backups.mjs --runs 20       # scan more workflow runs
 *   ESTATE_MIRROR_DIR=D:\somewhere node scripts/mirror-estate-backups.mjs
 *
 * Exit 0 = every expected store has a complete generation mirrored.
 * Exit 1 = a store could not be mirrored (loud, named, per store).
 *
 * Credentials: `gh` (repo scope) for discovery, an interactive `wrangler login`
 * OAuth session for the fetch. Both were already on this machine and proven by
 * the restore drill. No secret is read, printed or written by this script.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { groupByGeneration, readWorkflowPrefixes } from './lib/backup-keys.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BUCKET = 'estate-backups';
const GH_REPO = process.env.ESTATE_BACKUP_REPO || 'skymitch9/catalog-platform';

/**
 * ⚠️ The default target is deliberately INSIDE OneDrive and deliberately
 * OUTSIDE every repo. Inside OneDrive because the sync to Microsoft's cloud is
 * the second off-Cloudflare home and costs us nothing; outside every repo
 * because these are ~600 MB of database dumps and cover tarballs that must
 * never become a commit — there is nothing here for `_ALLOWLIST` to stage.
 */
const DEFAULT_MIRROR_DIR = 'C:\\Users\\nbasl\\OneDrive\\Documents\\estate-backups-mirror';
const MIRROR_DIR = process.env.ESTATE_MIRROR_DIR || DEFAULT_MIRROR_DIR;
const MANIFEST_PATH = join(MIRROR_DIR, 'mirror-manifest.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : fallback;
};
const MAX_RUNS = flagValue('--runs', 10);

// ---------------------------------------------------------------------------
// Discovery — the workflow log, not a bucket listing (see header).
// ---------------------------------------------------------------------------

/** Runs of backup.yml, newest first. */
function listBackupRuns(limit) {
  const out = execFileSync(
    'gh',
    ['run', 'list', '--repo', GH_REPO, '--workflow=backup.yml', '--limit', String(limit), '--json', 'databaseId,conclusion,createdAt'],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

/**
 * Parse one run's log into the keys it wrote and the part counts it declared.
 *
 * ⚠️ Anchored on `##[notice]`, not on the word "Wrote". The log ALSO contains
 * the shell source of the step (`echo "::notice::Wrote estate-backups/$KEY"`),
 * which matches a naive grep and would mirror a key literally named `$KEY`.
 * Only the rendered annotation carries `##[notice]`.
 */
export function parseRunLog(log) {
  const keys = [];
  for (const m of log.matchAll(/##\[notice\]Wrote estate-backups\/(\S+)/g)) keys.push(m[1]);

  const declaredParts = new Map();
  for (const m of log.matchAll(/##\[notice\](\S+) was written as (\d+) part\(s\)\./g)) {
    declaredParts.set(m[1], Number(m[2]));
  }
  return { keys, declaredParts };
}

const PART_SUFFIX = /\.part-[a-z]+$/;

/**
 * Of one prefix's generations, the ones that are COMPLETE — newest first.
 *
 * ⚠️ Completeness is the whole point of this function, and it is not academic:
 * run 32111218016 lost `audiobook-covers` to a transient 500 mid-download, and
 * run 32112007920 lost it to the 300 MiB upload cap. A mirror that took "the
 * newest generation" blindly would have mirrored a generation that cannot be
 * untarred, and reported success.
 *
 *   - a single-object generation is complete by construction;
 *   - a split generation is complete only when the run DECLARED a part count
 *     and that many parts were logged. No declaration ⇒ treated as incomplete,
 *     because a missing part is indistinguishable from a part that was never
 *     announced, and the safe reading of "I cannot tell" is "don't trust it".
 */
export function completeGenerations(keys, declaredParts) {
  return groupByGeneration(keys.map((key) => ({ key }))).filter((g) => {
    const parts = g.objects.filter((o) => PART_SUFFIX.test(o.key));
    if (parts.length === 0) return true;
    if (parts.length !== g.objects.length) return false; // split and unsplit mixed — incoherent
    const base = parts[0].key.replace(PART_SUFFIX, '');
    return declaredParts.get(base) === parts.length;
  });
}

/**
 * The newest complete generation per expected prefix.
 *
 * Walks runs newest-first and stops as soon as every expected store is
 * satisfied — the common case is that the newest run alone answers everything,
 * one log fetch. Older runs are only read on behalf of stores whose newest run
 * failed, which is exactly the case the drill's two failed runs produced.
 */
function discoverLatest(prefixes, runs) {
  const found = new Map(); // prefix -> {stamp, keys[], runId}
  let scanned = 0;

  for (const run of runs) {
    if (found.size === prefixes.length) break;
    scanned += 1;
    process.stdout.write(`  reading run ${run.databaseId} (${run.createdAt}, ${run.conclusion})...`);
    let log;
    try {
      log = execFileSync('gh', ['run', 'view', String(run.databaseId), '--repo', GH_REPO, '--log'], {
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
      });
    } catch (err) {
      // A log can expire or a run can be too large to fetch. Named, not fatal:
      // an older run may still satisfy the stores this one would have.
      console.log(` [WARN] log unavailable: ${err.message.split('\n')[0]}`);
      continue;
    }

    const { keys, declaredParts } = parseRunLog(log);
    let added = 0;
    for (const prefix of prefixes) {
      if (found.has(prefix)) continue;
      const mine = keys.filter((k) => k.startsWith(`${prefix}/`));
      const complete = completeGenerations(mine, declaredParts);
      if (complete.length > 0) {
        found.set(prefix, {
          stamp: complete[0].stamp,
          keys: complete[0].objects.map((o) => o.key),
          runId: run.databaseId,
        });
        added += 1;
      }
    }
    console.log(` ${keys.length} key(s), satisfied ${added} more store(s) (${found.size}/${prefixes.length})`);
  }

  return { found, scanned };
}

// ---------------------------------------------------------------------------
// Fetch — `wrangler r2 object get`, the OAuth path the drill proved.
// ---------------------------------------------------------------------------

// Invoked as `node .../wrangler.js` rather than through the `.bin` shim: on
// Windows the shim is a `.cmd`, which Node refuses to spawn without `shell:
// true`, and a shell in the loop is a quoting bug waiting for a key with an
// odd character in it.
const WRANGLER_JS = join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function fetchObject(key, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const args = existsSync(WRANGLER_JS)
    ? [WRANGLER_JS, 'r2', 'object', 'get', `${BUCKET}/${key}`, '--file', dest, '--remote']
    : null;
  const res = args
    ? spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8' })
    : spawnSync('npx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--file', dest, '--remote'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        shell: true,
      });

  if (res.status !== 0) {
    throw new Error(`wrangler r2 object get ${key} exited ${res.status}: ${(res.stderr || res.stdout || '').slice(0, 400)}`);
  }
  if (!existsSync(dest) || statSync(dest).size === 0) {
    // ⚠️ wrangler exits 0 having written nothing if `--remote` is dropped (it
    // reads an empty local simulator instead). A zero-byte "success" is the
    // exact shape of that bug, so it is a failure here.
    throw new Error(`wrangler reported success for ${key} but wrote no bytes to ${dest}`);
  }
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return { mirror_of: BUCKET, files: {} };
  try {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return { ...m, files: m.files || {} };
  } catch (err) {
    console.log(`  [WARN] mirror-manifest.json is unreadable (${err.message}); rebuilding it. Every key will be re-verified.`);
    return { mirror_of: BUCKET, files: {} };
  }
}

async function main() {
  const yml = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'backup.yml'), 'utf8');
  const { prefixes, keep: workflowKeep } = readWorkflowPrefixes(yml);
  const KEEP = flagValue('--keep', workflowKeep);

  console.log(`=== Mirroring ${BUCKET} → ${MIRROR_DIR} ===`);
  console.log(`${prefixes.length} store(s) from backup.yml, keeping ${KEEP} generation(s) each${DRY_RUN ? ' (DRY RUN)' : ''}.`);

  console.log('\n--- Discovering the newest complete generation per store ---');
  const runs = listBackupRuns(MAX_RUNS);
  const { found, scanned } = discoverLatest(prefixes, runs);
  console.log(`Scanned ${scanned} run(s) of ${runs.length} available.`);

  const missing = prefixes.filter((p) => !found.has(p));
  for (const p of missing) {
    console.log(`  [WARN] ${p}: NO complete generation in the ${scanned} run(s) scanned. Not mirrored this cycle.`);
  }

  const manifest = loadManifest();
  let downloaded = 0;
  let skipped = 0;
  let bytes = 0;
  const failures = [];

  console.log('\n--- Fetching ---');
  for (const prefix of prefixes) {
    const gen = found.get(prefix);
    if (!gen) continue;
    for (const key of gen.keys) {
      const dest = join(MIRROR_DIR, ...key.split('/'));
      const recorded = manifest.files[key];
      if (recorded && existsSync(dest) && statSync(dest).size === recorded.bytes) {
        skipped += 1;
        bytes += recorded.bytes;
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [DRY-RUN] would fetch ${key}`);
        downloaded += 1;
        continue;
      }
      try {
        process.stdout.write(`  fetch ${key} ...`);
        fetchObject(key, dest);
        const size = statSync(dest).size;
        manifest.files[key] = { bytes: size, sha256: sha256(dest), mirrored_at: new Date().toISOString() };
        downloaded += 1;
        bytes += size;
        console.log(` ${size} bytes`);
      } catch (err) {
        console.log(` [FAIL] ${err.message}`);
        failures.push(`${key}: ${err.message}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Retention — the mirror follows the bucket. Whole generations only.
  // -------------------------------------------------------------------------
  console.log('\n--- Retention (mirror follows the bucket, it is not an archive) ---');
  let pruned = 0;
  for (const prefix of prefixes) {
    const dir = join(MIRROR_DIR, ...prefix.split('/'));
    if (!existsSync(dir)) continue;
    const local = readdirSync(dir).map((name) => ({ key: `${prefix}/${name}`, name }));
    const generations = groupByGeneration(local);
    const drop = generations.slice(KEEP);
    if (drop.length === 0) {
      console.log(`  ${prefix}: ${generations.length} generation(s), nothing to prune.`);
      continue;
    }
    for (const g of drop) {
      for (const o of g.objects) {
        if (DRY_RUN) {
          console.log(`  [DRY-RUN] would prune ${o.key}`);
        } else {
          rmSync(join(dir, o.name));
          delete manifest.files[o.key];
          console.log(`  prune ${o.key}`);
        }
        pruned += 1;
      }
    }
  }

  if (!DRY_RUN) {
    manifest.mirror_of = BUCKET;
    manifest.source_repo = GH_REPO;
    manifest.keep_generations = KEEP;
    manifest.updated_at = new Date().toISOString();
    mkdirSync(MIRROR_DIR, { recursive: true });
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  }

  const totalBytes = Object.values(manifest.files).reduce((n, f) => n + f.bytes, 0);
  console.log('\n=== Summary ===');
  console.log(`stores mirrored:   ${found.size}/${prefixes.length}`);
  console.log(`objects fetched:   ${downloaded}`);
  console.log(`objects skipped:   ${skipped} (already mirrored at the recorded size)`);
  console.log(`objects pruned:    ${pruned}`);
  console.log(`mirror holds:      ${Object.keys(manifest.files).length} object(s), ${totalBytes} bytes`);
  console.log(`mirror root:       ${MIRROR_DIR}`);
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    for (const f of failures) console.log(`  ${f}`);
  }

  if (failures.length || missing.length) {
    console.log('\n⚠️ The mirror is INCOMPLETE for the stores named above. The previously mirrored generation (if any) still stands.');
    process.exitCode = 1;
  }
}

// Importable for tests without running the mirror.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
