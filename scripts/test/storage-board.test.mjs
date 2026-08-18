/**
 * storage-board.test.mjs — the blob-storage panel's projection.
 *
 * ⚠️ THE ONE FRAGILE THING HERE IS parseSize(), and it is fragile by necessity:
 * `wrangler r2 bucket info --json` reports `bucket_size` as an ALREADY-FORMATTED
 * human string ("79.1 GB"), with no raw-bytes field to prefer. Every figure and
 * every cost estimate on the panel is downstream of parsing that string, so it
 * is tested against the exact strings the live buckets returned on 2026-08-18.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  R2_USD_PER_GB_MONTH,
  STORAGE_BUCKETS,
  bucketRow,
  buildStorageSection,
  monthlyCostUsd,
  parseCount,
  parseSize,
} from '../lib/storage-board.mjs';

/** Measured live 2026-08-18, `wrangler r2 bucket info <name> --json`. */
const LIVE = {
  'estate-audio': { object_count: '477', bucket_size: '79.1 GB', created: '2026-08-18T00:43:33.912Z', location: 'WNAM' },
  'ebooks-gated': { object_count: '162', bucket_size: '38.4 MB', created: '2026-08-17T00:00:00.000Z', location: 'WNAM' },
  'estate-ebooks': { object_count: '168', bucket_size: '1.81 GB', created: '2026-08-17T00:00:00.000Z', location: 'WNAM' },
  'estate-backups': { object_count: '60', bucket_size: '2.94 GB', created: '2026-08-15T19:09:37.291Z', location: 'WNAM' },
  'estate-docs-gated': { object_count: '2', bucket_size: '1.55 MB', created: '2026-08-17T00:00:00.000Z', location: 'WNAM' },
  'audiobook-covers': { object_count: '1,972', bucket_size: '331 MB', created: '2026-08-10T00:00:00.000Z', location: 'WNAM' },
  'library-covers': { object_count: '217', bucket_size: '22.2 MB', created: '2026-08-10T00:00:00.000Z', location: 'WNAM' },
  'game-covers': { object_count: '1,125', bucket_size: '180 MB', created: '2026-08-10T00:00:00.000Z', location: 'WNAM' },
};

// ---------------------------------------------------------------------------
// parseSize — the weak point, tested hardest
// ---------------------------------------------------------------------------

test('parseSize: the exact strings the live buckets returned', () => {
  assert.equal(parseSize('79.1 GB'), 79_100_000_000);
  assert.equal(parseSize('2.94 GB'), 2_940_000_000);
  assert.equal(parseSize('1.81 GB'), 1_810_000_000);
  assert.equal(parseSize('331 MB'), 331_000_000);
  assert.equal(parseSize('38.4 MB'), 38_400_000);
  assert.equal(parseSize('1.55 MB'), 1_550_000);
});

test('⚠️ units are DECIMAL, because that is how Cloudflare bills and displays', () => {
  // 1024-based parsing would inflate every GB figure by 2.4% and push the cost
  // estimate wrong in the same direction, silently.
  assert.equal(parseSize('1 GB'), 1_000_000_000);
  assert.equal(parseSize('1 KB'), 1_000);
  assert.equal(parseSize('1 TB'), 1_000_000_000_000);
  assert.notEqual(parseSize('1 GB'), 1024 ** 3);
});

test('parseSize: tolerates spacing, case and thousands separators', () => {
  assert.equal(parseSize('  79.1GB '), 79_100_000_000);
  assert.equal(parseSize('79.1 gb'), 79_100_000_000);
  assert.equal(parseSize('1,024 MB'), 1_024_000_000);
  assert.equal(parseSize('512 B'), 512);
});

test('⚠️ parseSize: anything unreadable is NULL, never 0', () => {
  // A zero renders as "empty", and for a BACKUP bucket that is the most
  // alarming wrong answer this panel could produce.
  for (const bad of ['', '   ', 'unknown', '79.1 XB', 'GB', null, undefined, 42, {}, 'NaN GB']) {
    assert.equal(parseSize(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('parseCount: strings, numbers, separators — and null for the rest', () => {
  assert.equal(parseCount('60'), 60);
  assert.equal(parseCount('1,972'), 1972);
  assert.equal(parseCount(0), 0, 'a real zero object count is a MEASUREMENT and survives');
  assert.equal(parseCount('nope'), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount(undefined), null);
});

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

test('monthlyCostUsd: the published R2 storage rate, and null when size is unknown', () => {
  assert.equal(R2_USD_PER_GB_MONTH, 0.015);
  assert.ok(Math.abs(monthlyCostUsd(1e9) - 0.015) < 1e-12);
  assert.ok(Math.abs(monthlyCostUsd(79_100_000_000) - 1.1865) < 1e-9);
  assert.equal(monthlyCostUsd(null), null);
  assert.equal(monthlyCostUsd(NaN), null);
});

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

test('buildStorageSection: the live estate, end to end', async () => {
  const s = await buildStorageSection(async (name) => LIVE[name]);
  assert.equal(s.buckets.length, STORAGE_BUCKETS.length);
  assert.equal(s.measured, 8);
  assert.equal(s.of, 8);
  assert.equal(s.total_objects, 477 + 162 + 168 + 60 + 2 + 1972 + 217 + 1125);
  // ~84.3 GB across the estate, and the whole thing costs about a dollar
  // twenty-five a month — which is the number the owner actually asked for.
  assert.ok(s.total_bytes > 84e9 && s.total_bytes < 85e9, `total was ${s.total_bytes}`);
  assert.ok(s.total_cost_usd_month > 1.2 && s.total_cost_usd_month < 1.3, `cost was ${s.total_cost_usd_month}`);

  const audio = s.buckets.find((b) => b.name === 'estate-audio');
  assert.equal(audio.objects, 477);
  assert.equal(audio.bytes, 79_100_000_000);
  assert.equal(audio.size_text, '79.1 GB', 'the original string is kept, so the page can show what Cloudflare said');
  assert.equal(audio.error, null);
  assert.ok(audio.holds.length > 0, 'every bucket says what it holds, in words');
});

test('⚠️ ONE BUCKET FAILING COSTS ONE ROW, NOT THE PANEL', async () => {
  const s = await buildStorageSection(async (name) => {
    if (name === 'estate-audio') throw new Error('wrangler exited 1');
    return LIVE[name];
  });
  const audio = s.buckets.find((b) => b.name === 'estate-audio');
  assert.equal(audio.bytes, null);
  assert.equal(audio.objects, null);
  assert.match(audio.error, /wrangler exited 1/);
  // ...and the row is still PRESENT, with its label and what it holds, so the
  // bucket does not silently vanish from the panel.
  assert.equal(audio.label, 'Audiobook masters');
  assert.equal(s.buckets.length, 8);
});

test('⚠️ TOTALS SAY HOW MANY BUCKETS THEY COVER — a partial total is not a total', async () => {
  const s = await buildStorageSection(async (name) => {
    if (name === 'estate-audio' || name === 'game-covers') throw new Error('nope');
    return LIVE[name];
  });
  assert.equal(s.measured, 6);
  assert.equal(s.of, 8);
  // The 79.1 GB bucket is excluded from the byte total rather than counted as 0.
  assert.ok(s.total_bytes < 6e9, `partial total should exclude the failures, got ${s.total_bytes}`);
});

test('every bucket unreadable -> totals are NULL, not zero', async () => {
  const s = await buildStorageSection(async () => { throw new Error('offline'); });
  assert.equal(s.total_bytes, null);
  assert.equal(s.total_cost_usd_month, null);
  assert.equal(s.total_objects, null);
  assert.equal(s.measured, 0);
  assert.equal(s.of, 8);
});

test('the bucket list covers every store the estate actually has, with a reachability note each', () => {
  const names = STORAGE_BUCKETS.map((b) => b.name).sort();
  assert.deepEqual(names, [
    'audiobook-covers', 'ebooks-gated', 'estate-audio', 'estate-backups',
    'estate-docs-gated', 'estate-ebooks', 'game-covers', 'library-covers',
  ]);
  // ⚠️ reachable_from is what records WHY this is a pushed section rather than a
  // Worker route: three of these are bound only in other repos.
  for (const b of STORAGE_BUCKETS) assert.ok(b.reachable_from, `${b.name} must say where it is bound`);
  const foreign = STORAGE_BUCKETS.filter((b) => b.reachable_from.includes('repo'));
  assert.equal(foreign.length, 3, 'the three cover buckets are the ones no Worker here binds');
});

test('bucketRow: a null info yields a fully-formed row of unknowns', () => {
  const row = bucketRow(STORAGE_BUCKETS[0], null, null);
  assert.equal(row.bytes, null);
  assert.equal(row.objects, null);
  assert.equal(row.cost_usd_month, null);
  assert.equal(row.size_text, null);
  assert.equal(row.name, 'estate-audio');
});

// ---------------------------------------------------------------------------
// The success-with-zero trap
// ---------------------------------------------------------------------------

test('⚠️ A ZERO READING IS UNKNOWN, NOT EMPTY — the worst bug this panel could ship', () => {
  // Measured 2026-08-18: Cloudflare's bucket-metrics endpoint intermittently
  // answers a well-formed SUCCESS carrying 0 objects / 0 B for a bucket holding
  // gigabytes. Six of eight came back "empty" in one run — including
  // estate-backups, which holds 2.94 GB — with no error anywhere, while serial
  // calls by hand returned the right figures three times running.
  //
  // null-not-zero does not catch this, because "0" parses perfectly. So a zero
  // is unverified in its own right.
  const row = bucketRow(
    STORAGE_BUCKETS.find((b) => b.name === 'estate-backups'),
    { object_count: '0', bucket_size: '0 B' },
    null,
  );
  assert.equal(row.bytes, null, 'must NOT be 0 — "0 B" on the backup bucket is the alarm that gets ignored');
  assert.equal(row.objects, null);
  assert.equal(row.cost_usd_month, null);
  assert.equal(row.unverified_zero, true);
  assert.match(row.error, /declines to answer/);
  assert.match(row.error, /UNKNOWN rather than empty/);
});

test('a zero that is only in ONE of the two fields is still a real reading', () => {
  // 0 objects but a non-zero size, or vice versa, is not the endpoint's
  // decline-shape — it is something genuinely odd, and hiding it would be worse
  // than showing it.
  const a = bucketRow(STORAGE_BUCKETS[0], { object_count: '0', bucket_size: '1.5 MB' }, null);
  assert.equal(a.unverified_zero, false);
  assert.equal(a.objects, 0);
  assert.equal(a.bytes, 1_500_000);
});

test('an unverified zero is excluded from the totals, and the count says so', async () => {
  const s = await buildStorageSection(async (name) =>
    name === 'estate-audio' ? { object_count: '0', bucket_size: '0 B' } : LIVE[name]);
  assert.equal(s.measured, 7, 'the zero bucket is not counted as measured');
  assert.equal(s.of, 8);
  // 79.1 GB must NOT be silently counted as 0 in a total presented as complete.
  assert.ok(s.total_bytes < 6e9, `the unread bucket must be excluded, got ${s.total_bytes}`);
});
