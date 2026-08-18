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

// ---------------------------------------------------------------------------
// The denominator
// ---------------------------------------------------------------------------

test('⚠️ the TOTAL comes from the log — it exists nowhere else', () => {
  assert.equal(totalFromLog(LOG), 1257);
  // The last line wins: the library is re-counted between runs.
  assert.equal(totalFromLog('[1/10] a\n[2/900] b\n'), 900);
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
