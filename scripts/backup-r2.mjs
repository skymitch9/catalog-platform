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
 *
 * 🔴 ONE PREFIX is excluded inside a bucket that is otherwise fully backed up:
 * `ebooks-gated/transcripts/` (owner decision 2026-08-19). That is a DIFFERENT
 * mechanism from the refusal above — see `scripts/lib/backup-exclusions.mjs`,
 * which explains why, logs every rule on every run, and writes the same
 * statement into each dump's own manifest. ⚠️ A restore of `ebooks-gated` from
 * these dumps therefore does NOT contain transcripts; where they DO come from
 * in a disaster is in docs/access/backup-restore.md §6 and RECOVERY.md §5.
 *
 * 🔴 THE API IS RATE-LIMITED AND THIS SCRIPT PACES ITSELF (2026-08-26). Run
 * 32955691152 lost `ebooks-gated` — 1,324 objects, ~4 minutes in — to
 * api.cloudflare.com answering "too many requests" (HTTP 429) on every
 * remaining GET. The retry policy below now treats 429 as its own thing (a
 * request to slow down for MINUTES, not a request to try again in half a
 * second), honours `Retry-After`, and paces every call so the limit is mostly
 * not reached. See the long comment on the retry block, and
 * docs/access/backup-restore.md §3.2c.
 */

import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { applyExclusions, exclusionLogLines } from './lib/backup-exclusions.mjs';

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const ALLOW_EMPTY = process.argv.includes('--allow-empty');
/**
 * List, apply the exclusions, print the accounting — and download nothing.
 *
 * Added 2026-08-19 alongside the prefix exclusions, because "verify the dump
 * has the right shape" previously meant downloading the whole bucket. It needs
 * the same `CLOUDFLARE_API_TOKEN` a real run does (the `wrangler login` OAuth
 * session does NOT cover the REST `objects` endpoint — RECOVERY.md §7), but it
 * costs one listing call instead of a full byte-for-byte dump.
 */
const DRY_RUN = process.argv.includes('--dry-run');
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
  console.error('Usage: node scripts/backup-r2.mjs <bucket> [<bucket> ...] [--allow-empty] [--dry-run]');
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

// ⚠️ `CLOUDFLARE_API_BASE` exists ONLY so the offline test can point this
// script at a local stand-in for the Cloudflare API and exercise the real code
// path end-to-end (scripts/test/backup-r2-exclusions.test.mjs). Nothing sets it
// in CI or in any runbook; it defaults to the real API and a run that overrides
// it says so in its own environment.
const API_BASE = process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';

async function cfFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${API_TOKEN}`, ...(opts.headers || {}) },
  });
  return res;
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
 *   - plus transport failures, which carry no status at all: a refused/dropped
 *     connection, and — added 2026-08-21 after run 32469907247 killed two
 *     buckets with `TypeError: terminated` — a socket that dies PART WAY
 *     THROUGH THE BODY, after `fetch()` has already resolved OK. See the
 *     comment inside the loop; that one used to bypass this whole mechanism;
 *   - 4 attempts, exponential backoff with jitter (~0.5s, 1s, 2s);
 *   - every retry is LOGGED, so a bucket that only succeeds by retrying looks
 *     different in the log from one that succeeded first time. A silent retry
 *     would hide a degrading bucket, which is its own kind of dishonesty;
 *   - after the last attempt it throws exactly as before. A backup that cannot
 *     read an object still FAILS — the size check below and the zero-object
 *     rule above are unchanged. This makes the job survive a blip, not
 *     tolerate a broken bucket.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * 🔴 …AND THEN A RATE LIMIT ATE `ebooks-gated`, BECAUSE 429 IS NOT A 500 —
 * MEASURED 2026-08-26.
 *
 * Run 32955691152 (the daily schedule): 12 of 13 jobs succeeded and
 * **`r2 (ebooks-gated)` failed**. It listed 1,324 objects, downloaded happily
 * for just under four minutes, and then EVERY request began coming back
 * "too many requests" (HTTP 429) from api.cloudflare.com. It gave up on the
 * first object whose four attempts were all refused:
 *
 *     GET ebooks-gated/text/vigilance-…-book-1.json.gz failed (HTTP 429):
 *
 * ⚠️ THE BUG IS THAT THE RETRY POLICY ABOVE TREATED 429 EXACTLY LIKE A 500.
 * Those two statuses ask for opposite things. A 500 means "that request went
 * wrong, try it again"; a 429 means **"you are going too fast — stop asking for
 * a while"**. Four attempts spaced ~0.5 s / 1 s / 2 s spend under five seconds,
 * and Cloudflare's REST API rate limit is counted over a window of MINUTES
 * (per user, per five minutes). So every "retry" was another request into a
 * bucket that was already empty, which both failed and made the limit worse.
 * The old backoff could not have cleared that window if it had tried all night.
 *
 * ⚠️ It is also not really a per-bucket problem, which is why the fix is not
 * per-bucket. `backup.yml`'s `r2` matrix runs FIVE buckets in parallel, on five
 * runners, all presenting the SAME `CLOUDFLARE_API_TOKEN` — so they share one
 * rate-limit budget, and the aggregate burst is what trips it. `ebooks-gated`
 * was not special; it was the job still downloading when the shared budget ran
 * out. (The earlier failure, run 32469907247, contained no 429s at all and is
 * the separate mid-body-socket bug in §3.2b — do not conflate them.)
 *
 * Two changes, and they do different jobs:
 *
 *  1. **A 429 gets its OWN, much longer backoff, and more attempts.** If the
 *     response carries `Retry-After`, that is Cloudflare telling us the answer
 *     and it is honoured verbatim (seconds or an HTTP-date, capped so a silly
 *     value cannot park the job for an hour). Otherwise: ~15 s, 30 s, 60 s,
 *     then 120 s, jittered, for up to RATE_LIMIT_ATTEMPTS tries — long enough
 *     to actually cross a minutes-long window instead of hammering inside it.
 *  2. **PACING, so we mostly never get there.** Every request now waits for a
 *     minimum interval since the last one, and that interval GROWS each time a
 *     429 is seen and decays slowly on success. Fixed pacing alone cannot be
 *     right (the five jobs cannot see each other), but a limit that everyone
 *     backs off from is one everyone converges below. `BACKUP_R2_MIN_INTERVAL_MS`
 *     overrides the floor if a future bucket needs a different shape; nothing
 *     sets it in CI.
 *
 * Everything else is deliberately unchanged: every wait is still logged, in
 * words as well as the code, and a bucket that genuinely cannot be read still
 * FAILS the backup rather than reporting a short dump as a success.
 */
const GET_ATTEMPTS = 4;
/** A rate limit is worth waiting out for longer than a server error is. */
const RATE_LIMIT_ATTEMPTS = 7;
/**
 * ~15 s / 30 s / 60 s / 120 s / 120 s / 120 s, before jitter.
 *
 * ⚠️ `BACKUP_R2_RATE_LIMIT_BACKOFF_MS` (comma-separated ms) exists ONLY so the
 * offline test can exercise the real 429 path without sleeping for four
 * minutes — the same testing seam, and the same rule, as `CLOUDFLARE_API_BASE`
 * above: nothing sets it in CI or in any runbook, and a run that overrides it
 * has said so in its own environment.
 */
const backoffOverride = (process.env.BACKUP_R2_RATE_LIMIT_BACKOFF_MS || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n >= 0);
const RATE_LIMIT_BACKOFF_MS = backoffOverride.length
  ? backoffOverride
  : [15_000, 30_000, 60_000, 120_000, 120_000, 120_000];
/** Never park on a `Retry-After` longer than this, whatever the header says. */
const RATE_LIMIT_MAX_WAIT_MS = 180_000;
const MAX_ATTEMPTS = Math.max(GET_ATTEMPTS, RATE_LIMIT_ATTEMPTS);

const isRateLimit = (status) => status === 429;
const isRetryable = (status) => status >= 500 || isRateLimit(status);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── PACING ─────────────────────────────────────────────────────────────────
// The floor between two requests from THIS process. 200 ms ≈ 5 requests/second,
// a little under the rate this script was measured downloading at when the
// 2026-08-26 limit hit — the adaptive part below is what closes the rest of the
// gap, because five parallel jobs share one budget and none of them can see the
// others. Set BACKUP_R2_MIN_INTERVAL_MS=0 to turn pacing off (the offline tests
// do; a real run against Cloudflare should not).
const MIN_INTERVAL_MS = Number.isFinite(Number(process.env.BACKUP_R2_MIN_INTERVAL_MS))
  ? Math.max(0, Number(process.env.BACKUP_R2_MIN_INTERVAL_MS))
  : 200;
/** Added to the interval each time a 429 is seen… */
const THROTTLE_STEP_MS = 250;
/** …up to this ceiling… */
const THROTTLE_MAX_MS = 5_000;
/** …and given back this much per clean request, so it recovers but not fast. */
const THROTTLE_DECAY_MS = 10;

let throttleMs = 0;
let lastRequestAt = 0;
let rateLimitHits = 0;

async function paceRequest() {
  const due = lastRequestAt + MIN_INTERVAL_MS + throttleMs;
  const wait = due - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function onRateLimited() {
  rateLimitHits += 1;
  throttleMs = Math.min(THROTTLE_MAX_MS, throttleMs + THROTTLE_STEP_MS);
}

function onCleanRequest() {
  if (throttleMs > 0) throttleMs = Math.max(0, throttleMs - THROTTLE_DECAY_MS);
}

/**
 * How long the server ASKED us to wait, in ms, or null if it did not say.
 * `Retry-After` is either a number of seconds or an HTTP-date; both are legal
 * and Cloudflare has been seen to send either.
 */
function retryAfterMs(res) {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const when = Date.parse(raw);
  if (!Number.isNaN(when)) return Math.max(0, when - Date.now());
  return null;
}

/** The wait before attempt N+1, and the words that explain it in the log. */
function rateLimitWait(res, attempt) {
  const asked = retryAfterMs(res);
  if (asked !== null) {
    const wait = Math.min(asked, RATE_LIMIT_MAX_WAIT_MS);
    return { wait, why: `Cloudflare asked us to wait ${Math.round(asked / 1000)}s (Retry-After)` };
  }
  const base = RATE_LIMIT_BACKOFF_MS[Math.min(attempt - 1, RATE_LIMIT_BACKOFF_MS.length - 1)];
  return { wait: Math.round(base * (0.85 + Math.random() * 0.3)), why: 'no Retry-After header, backing off' };
}

/** A never-a-real-value sentinel, so an empty body is not mistaken for a miss. */
const NOT_READ = Symbol('not-read');

/**
 * ONE Cloudflare request with the whole policy above: pacing, then up to
 * MAX_ATTEMPTS tries, with the budget and the wait chosen by WHAT failed.
 *
 * `readBody(res)` is called INSIDE the try on purpose — see the mid-body socket
 * note below; "the request succeeded" and "the bytes arrived" are two different
 * events and only the first is what `await fetch(...)` reports.
 */
async function requestWithRetry({ path, describe, readBody, statusHint = '' }) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await paceRequest();

    let res;
    let value = NOT_READ;
    let text = null;
    try {
      res = await cfFetch(path);
      // ⚠️ THE BODY IS READ INSIDE THIS `try` ON PURPOSE — MEASURED.
      //
      // Run 32469907247 (2026-08-21, the daily schedule): `library-covers` and
      // `game-covers` BOTH died, not on a status code but on
      //
      //     TypeError: terminated
      //       [cause]: SocketError: other side closed (UND_ERR_SOCKET)
      //
      // thrown from inside undici with no frame of this script in the stack.
      // That is what a mid-body connection drop looks like: `fetch()` resolves
      // (headers arrived, `res.ok` is true), and the failure lands later, when
      // the body is drained. The read used to sit BELOW this block, so it was
      // outside the only `catch` in the retry loop — it bypassed all four
      // attempts, escaped the caller, escaped the top-level `await`, and took
      // the whole process down with an unhandled rejection. The retry logic was
      // correct and simply never ran.
      if (res.ok) value = await readBody(res);
      else text = await res.text();
    } catch (err) {
      // A dropped socket / DNS blip is the same class of problem as a 500.
      lastError = new Error(`${describe} failed (network): ${err.message}`);
      if (attempt >= GET_ATTEMPTS) break;
      const wait = Math.round(250 * 2 ** attempt * (1 + Math.random()));
      console.log(`  retry ${attempt} of ${GET_ATTEMPTS} for ${describe} after ${wait}ms — ${err.message}`);
      await sleep(wait);
      continue;
    }

    // ⚠️ The sentinel, not a truthiness check: a legitimately EMPTY object
    // yields a zero-length Buffer, and `if (value)` would loop on it forever.
    if (value !== NOT_READ) {
      onCleanRequest();
      return value;
    }

    lastError = new Error(`${describe} failed (HTTP ${res.status}): ${text.slice(0, 500)}${statusHint}`);

    if (isRateLimit(res.status)) {
      onRateLimited();
      if (attempt >= RATE_LIMIT_ATTEMPTS) break;
      const { wait, why } = rateLimitWait(res, attempt);
      console.log(
        `  rate-limited by the Cloudflare API (HTTP 429) on ${describe} — ${why}; ` +
          `retry ${attempt} of ${RATE_LIMIT_ATTEMPTS} in ${Math.round(wait / 1000)}s ` +
          `(now pacing +${throttleMs}ms between requests)`
      );
      await sleep(wait);
      continue;
    }

    if (!isRetryable(res.status) || attempt >= GET_ATTEMPTS) break;

    const wait = Math.round(250 * 2 ** attempt * (1 + Math.random()));
    console.log(
      `  retry ${attempt} of ${GET_ATTEMPTS} for ${describe} after ${wait}ms — ` +
        `the Cloudflare API returned a server error (HTTP ${res.status})`
    );
    await sleep(wait);
  }

  throw lastError;
}

/** Paginate GET .../objects, return the full array of object metadata. */
async function listAllObjects(bucket) {
  const all = [];
  let cursor;
  for (;;) {
    const qs = new URLSearchParams({ per_page: '1000' });
    if (cursor) qs.set('cursor', cursor);
    // ⚠️ The listing goes through the SAME retry/pacing policy as the object
    // GETs (2026-08-26). It used to be a bare `cfFetch`, so a rate limit here
    // — the very first call a bucket makes, and the one most likely to land in
    // the burst when five jobs start at once — failed the whole bucket with no
    // retry at all, while a 429 four minutes later got four of them.
    const body = await requestWithRetry({
      path: `/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects?${qs}`,
      describe: `Listing ${bucket}`,
      readBody: (res) => res.json(),
      statusHint:
        `\nIf this is a 9109/403/"not authorized": the token needs the account-level ` +
        `"Workers R2 Storage Read" permission group — see this script's header comment.`,
    });
    if (!body.success) {
      // A 200 that says `success: false` is a real answer, not a blip — the
      // token is wrong, or the bucket is. Retrying it would only be slower.
      throw new Error(
        `Listing ${bucket} failed: ${JSON.stringify(body.errors ?? body)}\n` +
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

async function getObjectBytes(bucket, key) {
  // Object keys can contain characters that need escaping per path segment,
  // but literal '/' must stay unescaped (Cloudflare's own docs: send slashes
  // literally, do not percent-encode them).
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return requestWithRetry({
    path: `/accounts/${ACCOUNT_ID}/r2/buckets/${bucket}/objects/${encodedKey}`,
    describe: `GET ${bucket}/${key}`,
    readBody: async (res) => Buffer.from(await res.arrayBuffer()),
  });
}

async function backupBucket(bucket) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // The counter is process-wide (the rate limit is per TOKEN, not per bucket),
  // so a multi-bucket run reports each bucket's own share of it.
  const rateLimitHitsBefore = rateLimitHits;
  const outDir = process.env.BACKUP_OUT_DIR || `backups/r2-${bucket}-${stamp}`;
  console.log(`\n=== ${bucket} → ${outDir}${DRY_RUN ? ' (DRY RUN — nothing will be downloaded)' : ''} ===`);

  const listed = await listAllObjects(bucket);
  console.log(`Listed ${listed.length} object(s) in ${bucket}.`);

  if (listed.length === 0 && !ALLOW_EMPTY) {
    throw new Error(
      `${bucket} listed 0 objects. Treating a zero-object listing as a failed backup, ` +
        `not an empty bucket (same rule as seed-estate.mjs/backup-firestore.mjs) — ` +
        `pass --allow-empty if this bucket is genuinely expected to be empty right now.`
    );
  }

  // 🔴 PREFIX EXCLUSIONS — applied at LISTING time, before a single byte is
  // downloaded, and announced on every run whether they matched or not.
  // scripts/lib/backup-exclusions.mjs carries the whole argument; the
  // no-silent-caps rule is why this logs unconditionally.
  const { kept: objects, skipped } = applyExclusions(bucket, listed);
  for (const line of exclusionLogLines(bucket, skipped)) console.log(line);

  // ⚠️ An exclusion may never swallow a whole bucket. Without this, a rule that
  // matched everything would produce a cheerful "0 objects backed up" and sail
  // straight past the zero-object rule above — the same lie one layer down.
  if (listed.length > 0 && objects.length === 0) {
    throw new Error(
      `${bucket}: every one of its ${listed.length} listed object(s) was removed by a prefix ` +
        `exclusion, so this backup would contain nothing. Refusing. Fix or remove the rule in ` +
        `scripts/lib/backup-exclusions.mjs — an exclusion is meant to be surgical, and a bucket ` +
        `whose whole contents are excluded belongs in REFUSED_BUCKETS with an argument written ` +
        `beside it, not here.`
    );
  }

  if (DRY_RUN) {
    const keptBytes = objects.reduce((n, o) => n + (o.size ?? 0), 0);
    console.log(
      `${bucket}: DRY RUN — would back up ${objects.length} object(s), ${keptBytes} bytes; ` +
        `${listed.length - objects.length} object(s) excluded. Nothing written.`
    );
    return { bucket, outDir: null, count: objects.length, totalBytes: keptBytes, skipped, dryRun: true };
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(
      {
        bucket,
        backed_up_at: new Date().toISOString(),
        // ⚠️ THE MANIFEST CARRIES THE CAP TOO, not just the run log. The bulk
        // restore in backup-restore.md §6 loops `objects` and puts each file
        // back, so `objects` must list exactly what `objects/` holds — and
        // anyone opening this dump in a disaster must be able to see, from the
        // dump itself, what it deliberately does not contain.
        excluded: skipped,
        objects,
      },
      null,
      2
    )
  );

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
  // ⚠️ Say it out loud even though the run SUCCEEDED. A bucket that only got
  // through by waiting out a rate limit is a bucket heading for the failure of
  // 2026-08-26, and the difference has to be visible before it fails again.
  const bucketRateLimitHits = rateLimitHits - rateLimitHitsBefore;
  if (bucketRateLimitHits > 0) {
    console.log(
      `${bucket}: ⚠️ the Cloudflare API refused ${bucketRateLimitHits} request(s) as too-many-requests ` +
        `(HTTP 429) during this dump and each was retried after a wait. This dump is complete, but ` +
        `the account is close to its API rate limit — see docs/access/backup-restore.md §3.2c.`
    );
  }
  return { bucket, outDir, count: objects.length, totalBytes, skipped, dryRun: false, rateLimitHits: bucketRateLimitHits };
}

const results = [];
for (const bucket of buckets) {
  results.push(await backupBucket(bucket));
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(
    `${r.bucket}: ${r.count} objects, ${r.totalBytes} bytes${r.dryRun ? ' (dry run, nothing written)' : ` → ${r.outDir}`}`
  );
  // ⚠️ Repeated in the summary on purpose. The per-bucket line above scrolls
  // past thousands of retry/download lines in a real run; a cap nobody can see
  // at the bottom of the log is a silent cap.
  for (const line of exclusionLogLines(r.bucket, r.skipped)) console.log(`  ${line}`);
}
