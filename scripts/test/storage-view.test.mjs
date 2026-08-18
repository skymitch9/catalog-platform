/**
 * storage-view.test.mjs — how the blob-storage panel words itself.
 *
 * The projection is tested in storage-board.test.mjs; this is the half a reader
 * actually sees, and it is where the estate's "an absence is never a zero" rule
 * has to hold or the panel becomes a confident liar about backups.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  describeBucket,
  describeTotals,
  formatBytes,
  formatCost,
} from '../../sites/heygabi-home/public/status/lib/storage-view.js';

test('formatBytes: decimal units, matching how Cloudflare bills', () => {
  assert.equal(formatBytes(79_100_000_000), '79.1 GB');
  assert.equal(formatBytes(2_940_000_000), '2.94 GB');
  assert.equal(formatBytes(331_000_000), '331 MB');
  assert.equal(formatBytes(1_550_000), '1.55 MB');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(0), '0 B', 'a real zero is a measurement and renders as one');
});

test('⚠️ formatBytes: an unknown size is NULL, so the caller must decide the words', () => {
  assert.equal(formatBytes(null), null);
  assert.equal(formatBytes(undefined), null);
  assert.equal(formatBytes(NaN), null);
});

test('⚠️ a sub-cent cost is "<$0.01", never "$0.00"', () => {
  // Three of the estate's buckets cost under a cent a month. Rendering them as
  // $0.00 reads as free, which invites "not worth watching".
  assert.equal(formatCost(0.0002), '<$0.01');
  assert.equal(formatCost(0.009), '<$0.01');
  assert.equal(formatCost(0), '$0.00', 'an exact zero is different from a rounded one');
  assert.equal(formatCost(1.1865), '$1.19');
  assert.equal(formatCost(null), null);
});

test('describeBucket: a measured bucket says size, objects, cost and last write', () => {
  const d = describeBucket(
    { name: 'estate-audio', objects: 477, bytes: 79_100_000_000, cost_usd_month: 1.1865, holds: 'the m4b files' },
    'last write 2h ago',
  );
  assert.equal(d.tone, 'ok');
  assert.equal(d.size, '79.1 GB');
  assert.match(d.detail, /477 objects/);
  assert.match(d.detail, /\$1\.19\/mo/);
  assert.match(d.detail, /last write 2h ago/);
  assert.equal(d.sub, 'the m4b files');
});

test('⚠️ an unreported last write SAYS SO rather than being left blank', () => {
  const d = describeBucket({ objects: 2, bytes: 1_550_000, cost_usd_month: 0.00002325 }, null);
  assert.match(d.detail, /last write not reported/);
  // ...and a sub-cent cost still shows as sub-cent, not as free.
  assert.match(d.detail, /<\$0\.01/);
});

test('⚠️ A FAILED BUCKET KEEPS ITS ROW — it must never silently vanish', () => {
  const d = describeBucket(
    { name: 'game-covers', error: 'wrangler exited 1', holds: 'box art', reachable_from: 'Board_Game_Catalog repo' },
    null,
  );
  assert.equal(d.tone, 'nodata');
  assert.equal(d.size, '—', 'not 0 B');
  assert.match(d.detail, /Could not be measured: wrangler exited 1/);
  assert.match(d.sub, /box art/);
  assert.match(d.sub, /Board_Game_Catalog repo/, 'says where it is bound, so the reader knows why');
});

test('⚠️ a missing object count is "unknown", not zero', () => {
  const d = describeBucket({ bytes: 1000, cost_usd_month: 0 }, null);
  assert.match(d.detail, /object count unknown/);
  assert.doesNotMatch(d.detail, /0 objects/);
});

test('a bucket measured at zero objects is a MEASUREMENT and reads as one', () => {
  const d = describeBucket({ objects: 0, bytes: 0, cost_usd_month: 0 }, null);
  assert.match(d.detail, /0 objects/);
  assert.equal(d.size, '0 B');
  assert.equal(d.tone, 'ok');
});

test('describeTotals: everything measured', () => {
  const t = describeTotals({
    total_bytes: 84_423_150_000, total_objects: 4183, total_cost_usd_month: 1.2663, measured: 8, of: 8,
  });
  assert.equal(t.tone, 'ok');
  assert.equal(t.headline, '84.4 GB');
  assert.match(t.detail, /4,183 objects/);
  assert.match(t.detail, /\$1\.27 a month/);
  assert.match(t.detail, /all 8 buckets measured/);
});

test('⚠️ A PARTIAL TOTAL SAYS SO, and says the rest are not counted as empty', () => {
  const t = describeTotals({
    total_bytes: 5_000_000_000, total_objects: 500, total_cost_usd_month: 0.075, measured: 6, of: 8,
  });
  assert.equal(t.tone, 'warn');
  assert.match(t.detail, /covers only 6 of 8 buckets/);
  assert.match(t.detail, /NOT counted as empty/);
});

test('⚠️ nothing measurable -> the size is UNKNOWN, explicitly not zero', () => {
  const t = describeTotals({ total_bytes: null, total_objects: null, total_cost_usd_month: null, measured: 0, of: 8 });
  assert.equal(t.tone, 'nodata');
  assert.equal(t.headline, '—');
  assert.match(t.detail, /unknown from here — not zero/);
});

test('describeTotals/describeBucket survive a board shape nobody has invented yet', () => {
  assert.equal(describeTotals(null).tone, 'nodata');
  assert.equal(describeTotals(undefined).headline, '—');
  assert.equal(describeBucket(null, null).tone, 'nodata');
  assert.equal(describeBucket('nonsense', null).tone, 'nodata');
});
