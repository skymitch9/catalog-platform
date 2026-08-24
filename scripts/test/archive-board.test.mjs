/**
 * archive-board.test.mjs — the archive row's numbers.
 *
 * Owner, on the first storage panel: "it doesnt say anything useful... I want it
 * to have %s, last run, etc." Every fixture below is the real shape of the
 * artefacts the archiver writes, measured 2026-08-18 mid-seed.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HEARTBEAT_STALE_MS,
  buildArchiveBlock,
  lastUploadAt,
  parseLogTotals,
  totalFromLog,
  transferState,
} from '../lib/archive-board.mjs';

const NOW = Date.parse('2026-08-18T21:35:00Z');

/** Real shapes, measured off the home machine mid-seed. */
const MANIFEST = {
  bucket: 'estate-audio',
  prefix: 'archive/',
  generated: '2026-08-18T21:33:27Z',
  count: 816,
  total_bytes: 258_845_752_210,
  failure_count: 1,
  files: {
    'A/one.m4b': { size: 289_439_814, sha256: 'b389', key: 'archive/A/one.m4b', uploaded_at: '2026-08-18T20:08:46Z' },
    'B/two.m4b': { size: 300_000_000, sha256: 'c111', key: 'archive/B/two.m4b', uploaded_at: '2026-08-18T21:33:01Z' },
  },
  failures: {
    'KindleForPC-installer.exe': {
      attempts: 1,
      error: 'upload failed: FileNotFoundError: [WinError 2] The system cannot find the file specified',
      last_try: '2026-08-18T20:10:59Z',
      size: 298_583_688,
    },
  },
};

const LOCK = {
  pid: 70736,
  host: 'SKYFI-ELIZA',
  started_at: '2026-08-18T19:50:00Z',
  current_file: 'Daniel Schinhofen/Heavenly Chaos.m4b',
  done_this_run: 812,
  bytes_this_run: 257_817_427_976,
  heartbeat_at: '2026-08-18T21:33:03Z',
};

const LOG = '  [814/1257] x.m4b (672 MB) …\n  [ok] archive/x.m4b\n  [815/1257] y.m4b (675 MB) …\n';

/**
 * The steady-state summary the archiver prints on EVERY run — the real sample
 * off the home machine, 2026-08-24 00:05 (six identical hourly runs in a row),
 * from docs/info/backup-100-investigation-2026-08-24.md. There is NO `[i/N]`
 * line here: the archive is caught up, which is exactly the state that made the
 * old parser return "total unknown".
 */
const IDLE_LOG = [
  'On disk  : 1253 files, 686.53 GB (author folders only; zzzz_Books_to_be_Converted excluded)',
  'Recorded : 1267 files, 686.66 GB',
  'To upload: 0 files, 0.00 GB',
  '',
  'Uploaded 0 / 0 (0.00 GB) in 0.0 min at 0.0 MB/s; 0 failed.',
  'Archive now holds 1267 objects, 686.66 GB (100.0% of the library).',
].join('\n');

/**
 * A run mid-upload: the steady-state header has printed (so `On disk` is the
 * denominator) and files are streaming (so `[i/N]` lines exist too) but the
 * final `(Z% of the library)` summary line has NOT been written yet.
 */
const MIDRUN_LOG = [
  'On disk  : 1257 files, 690.10 GB (author folders only; zzzz_Books_to_be_Converted excluded)',
  'Recorded : 816 files, 258.85 GB',
  'To upload: 441 files, 431.25 GB',
  '  [814/441] x.m4b (672 MB) …',
  '  [ok] archive/x.m4b',
  '  [815/441] y.m4b (675 MB) …',
].join('\n');

// ---------------------------------------------------------------------------
// The denominator
// ---------------------------------------------------------------------------

test('⚠️ the TOTAL comes from the log — it exists nowhere else', () => {
  assert.equal(totalFromLog(LOG), 1257);
  // The last line wins: the library is re-counted between runs.
  assert.equal(totalFromLog('[1/10] a\n[2/900] b\n'), 900);
});

test('⚠️ the steady-state total comes from the ALWAYS-printed lines, idle or not', () => {
  // The idle archive: no `[i/N]` line anywhere, yet the total and percent are
  // both knowable — this is the whole bug the old totalFromLog() had.
  assert.equal(totalFromLog(IDLE_LOG), null, 'no transient marker on a caught-up run');
  const t = parseLogTotals(IDLE_LOG);
  assert.equal(t.on_disk, 1253, 'the live library scan');
  assert.equal(t.recorded, 1267, 'the cumulative manifest holdings');
  assert.equal(t.files_total, 1253, 'files_total is the On disk denominator the archiver divides by');
  assert.equal(t.printed_percent, 100, "the archiver's own printed (Z% of the library)");
});

test('parseLogTotals: mid-run prefers On disk over the transient [i/N] queue size', () => {
  const t = parseLogTotals(MIDRUN_LOG);
  // 441 is this run's QUEUE size (len(pending)), never the library total.
  assert.equal(totalFromLog(MIDRUN_LOG), 441, 'the [i/N] N is the run queue, not the library');
  assert.equal(t.on_disk, 1257, 'the library size is the real denominator');
  assert.equal(t.files_total, 1257);
  assert.equal(t.printed_percent, null, 'no summary line yet mid-run');
});

test('parseLogTotals: falls back to [i/N] only when no On disk line is present', () => {
  assert.equal(parseLogTotals(LOG).files_total, 1257, 'legacy log with only [i/N] still yields a total');
  assert.equal(parseLogTotals(LOG).printed_percent, null);
  // Junk and non-strings never invent a total.
  for (const bad of ['', 'nothing here', null, undefined, 42]) {
    assert.equal(parseLogTotals(bad).files_total, null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('parseLogTotals: the LAST run in a multi-run tail wins', () => {
  const tail = [
    'On disk  : 100 files, 1.00 GB',
    'Archive now holds 90 objects, 0.90 GB (90.0% of the library).',
    'On disk  : 1253 files, 686.53 GB',
    'Recorded : 1267 files, 686.66 GB',
    'Archive now holds 1267 objects, 686.66 GB (100.0% of the library).',
  ].join('\n');
  const t = parseLogTotals(tail);
  assert.equal(t.files_total, 1253);
  assert.equal(t.printed_percent, 100);
});

// ---------------------------------------------------------------------------
// The whole point: an idle, caught-up archive reads 100%, not "unknown"
// ---------------------------------------------------------------------------

test('⚠️ a CAUGHT-UP archive reads 100% off the every-run summary, not "unknown"', () => {
  // count = 1267 (Recorded/manifest holdings); no lock (idle); the log is the
  // real idle sample. Before the fix this showed files_total=null, percent=null.
  const b = buildArchiveBlock({
    manifest: { ...MANIFEST, count: 1267 },
    lock: null,
    logText: IDLE_LOG,
    nowMs: NOW,
  });
  assert.equal(b.available, true);
  assert.equal(b.transfer, 'idle');
  assert.equal(b.files_total, 1253, 'the library denominator, present on every run');
  assert.equal(b.percent, 100, "matches the archiver's printed 100.0% of the library");
});

test('⚠️ mid-run shows a REAL partial percent, computed from the library total', () => {
  const b = buildArchiveBlock({
    manifest: { ...MANIFEST, count: 816 },
    lock: LOCK,
    logText: MIDRUN_LOG,
    nowMs: NOW,
  });
  assert.equal(b.files_total, 1257);
  // 816 / 1257 = 64.9% — a genuine fraction of the library, not the run queue.
  assert.ok(Math.abs(b.percent - 64.916) < 0.01, `percent was ${b.percent}`);
  assert.equal(b.transfer, 'running');
});

test('⚠️ NO DENOMINATOR MEANS NO PERCENTAGE — not 100%, not 0%', () => {
  for (const bad of ['', 'no progress lines here', null, undefined, 42]) {
    assert.equal(totalFromLog(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
  const b = buildArchiveBlock({ manifest: MANIFEST, lock: LOCK, logText: 'nothing', nowMs: NOW });
  assert.equal(b.percent, null);
  // ...and the count it DOES know still shows.
  assert.equal(b.files_done, 816);
});

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

test('transferState: a fresh heartbeat is RUNNING', () => {
  const s = transferState(LOCK, NOW);
  assert.equal(s.state, 'running');
});

test('⚠️ A LOCK IS NOT A RUNNING JOB — a dead heartbeat is STALLED', () => {
  // The process can die and leave the lock behind; on disk that looks identical
  // to a healthy run, and it is the one state worth waking someone for.
  const dead = { ...LOCK, heartbeat_at: new Date(NOW - HEARTBEAT_STALE_MS - 60_000).toISOString() };
  const s = transferState(dead, NOW);
  assert.equal(s.state, 'stalled');
  assert.match(s.detail, /probably died/);
});

test('transferState: no lock is IDLE, an unreadable heartbeat is UNKNOWN', () => {
  assert.equal(transferState(null, NOW).state, 'idle');
  assert.equal(transferState({ ...LOCK, heartbeat_at: 'nonsense' }, NOW).state, 'unknown');
  assert.match(transferState({ ...LOCK, heartbeat_at: undefined }, NOW).detail, /cannot be said/);
});

// ---------------------------------------------------------------------------
// The block
// ---------------------------------------------------------------------------

test('buildArchiveBlock: the real mid-seed state, end to end', () => {
  const b = buildArchiveBlock({ manifest: MANIFEST, lock: LOCK, logText: LOG, nowMs: NOW });
  assert.equal(b.available, true);
  assert.equal(b.files_done, 816);
  assert.equal(b.files_total, 1257);
  assert.ok(Math.abs(b.percent - 64.916) < 0.01, `percent was ${b.percent}`);
  assert.equal(b.bytes_done, 258_845_752_210);
  assert.equal(b.transfer, 'running');
  assert.equal(b.current_file, 'Daniel Schinhofen/Heavenly Chaos.m4b');
  assert.equal(b.run_files, 812);
  // The newest upload wins, not the first in the map.
  // toISOString() normalises to milliseconds — the newest upload wins, not the
  // first in the map, which is the property under test.
  assert.equal(b.last_upload_at, '2026-08-18T21:33:01.000Z');
});

test('failures are NAMED and carry their reason', () => {
  const b = buildArchiveBlock({ manifest: MANIFEST, lock: LOCK, logText: LOG, nowMs: NOW });
  assert.equal(b.failure_count, 1);
  assert.equal(b.failures.length, 1);
  assert.match(b.failures[0].name, /Kindle/);
  assert.match(b.failures[0].error, /cannot find the file/);
  // A count with no names is un-actionable; the whole point is knowing WHICH.
  assert.equal(b.failures[0].attempts, 1);
});

test('⚠️ "integrity" and "restore_test" are DIFFERENT CLAIMS and stay apart', () => {
  const b = buildArchiveBlock({ manifest: MANIFEST, lock: LOCK, logText: LOG, nowMs: NOW });
  // The archiver hashes every file it uploads — that is a claim about METHOD.
  assert.match(b.integrity, /sha256/);
  // It is NOT a claim that anything was ever read back OUT of the bucket.
  // Conflating them is the "shipped is not verified" error, on the one surface
  // where being wrong means the library is gone.
  assert.equal(b.restore_test, null, 'no proof recorded yet means NOT PROVEN');
});

test('a recorded restore proof rides through untouched', () => {
  const restore = { at: '2026-08-18T21:40:00Z', verdict: 'pass', detail: 'sha256 matched disk', file: 'archive/A/one.m4b' };
  const b = buildArchiveBlock({ manifest: MANIFEST, lock: LOCK, logText: LOG, restore, nowMs: NOW });
  assert.deepEqual(b.restore_test, restore);
});

test('⚠️ AN UNREADABLE MANIFEST IS NOT 0% — it is unknown, and says so', () => {
  const b = buildArchiveBlock({ manifest: null, lock: LOCK, logText: LOG, nowMs: NOW });
  assert.equal(b.available, false);
  assert.equal(b.percent, undefined);
  assert.match(b.note, /not a measurement of zero/);
});

test('a finished archive with no lock reads idle, not broken', () => {
  const b = buildArchiveBlock({ manifest: { ...MANIFEST, count: 1257 }, lock: null, logText: LOG, nowMs: NOW });
  assert.equal(b.transfer, 'idle');
  assert.equal(b.percent, 100);
});

test('lastUploadAt: null when nothing is readable, never "now"', () => {
  assert.equal(lastUploadAt(null), null);
  assert.equal(lastUploadAt({}), null);
  assert.equal(lastUploadAt({ a: { uploaded_at: 'nonsense' } }), null);
});
