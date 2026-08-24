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
  backupLastWriteText,
  describeBucket,
  describeProofAge,
  describeRestore,
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

// ---------------------------------------------------------------------------
// The restore proof — the line whose job is telling him the backups are readable
// ---------------------------------------------------------------------------

test('⚠️ "ok" IS A PASS — the first real proof recorded that word and rendered as a warning', () => {
  // Shipped wrong for exactly one push: the renderer recognised only "pass", so
  // the conductor's verdict "ok" came out as "⚠️ ok" — a warning glyph on a
  // PASSING test, on the one line that exists to say the backups are provably
  // readable. A vocabulary this small has no business being one hardcoded string.
  const v = describeRestore(
    { at: new Date(Date.now() - 300_000).toISOString(), verdict: 'ok', detail: 'sha256-identical round trip' },
    Date.now(),
  );
  assert.match(v, /^✓ passed/);
  assert.doesNotMatch(v, /⚠️/);
  assert.match(v, /sha256-identical/);
});

test('every success word the provers actually use reads as a pass', () => {
  for (const verdict of ['ok', 'OK', 'pass', 'passed', 'success', 'succeeded']) {
    const v = describeRestore({ at: new Date(Date.now() - 60_001).toISOString(), verdict }, Date.now());
    assert.match(v, /^✓ passed/, `"${verdict}" should read as a pass`);
  }
});

test('⚠️ an unrecognised verdict SHOWS THE WORD rather than guessing at it', () => {
  // Same rule the Drive-parity row follows: a new verdict is the prover saying
  // something new, and flattening it is how a page contradicts its own source.
  const v = describeRestore({ at: new Date(Date.now() - 60_001).toISOString(), verdict: 'partial' }, Date.now());
  assert.match(v, /⚠️ partial/);
});

test('⚠️ NEVER PROVEN is the default and says so in words', () => {
  for (const bad of [null, undefined, {}, { verdict: 'ok' }, { at: 'nonsense', verdict: 'ok' }]) {
    const v = describeRestore(bad, Date.now());
    assert.match(v, /never — nothing has been read back out of the bucket/);
  }
});

test('⚠️ a proof stamped in the FUTURE says the clock disagrees, not "unknown"', () => {
  // Measured 2026-08-18: the first proof carried 22:35Z while the page rendered
  // at 21:52Z. Clamping that to "an unknown time" threw away a real fact and
  // made a successful test look unmeasurable.
  const now = Date.now();
  const v = describeRestore({ at: new Date(now + 43 * 60_000).toISOString(), verdict: 'ok' }, now);
  assert.match(v, /^✓ passed/, 'a clock gap must not turn a pass into a failure');
  assert.match(v, /in the FUTURE/);
  assert.match(v, /clock is ahead/);
});

test('a small clock skew reads as "just now" rather than shouting', () => {
  const now = Date.now();
  assert.match(describeProofAge(-30_000), /just now/);
  assert.match(describeProofAge(5_000), /just now/);
  assert.match(describeProofAge(90 * 60_000), /ago/);
  assert.match(describeProofAge(NaN), /unreadable/);
});

test('⚠️ F8: the backups "last write" is the NEWEST timestamp, not a scraped age fragment', () => {
  const now = Date.parse('2026-08-24T12:00:00Z');
  const group = {
    // A multi-store roll-up whose oldest is a TWO-PART age and whose newest is
    // 12 minutes ago — the exact shape the old regex misparsed.
    oldest: '2026-08-21T10:00:00Z', // 3d 2h before `now`
    newest: '2026-08-24T11:48:00Z', // 12 min before `now`
    count: 9,
    stores: 5,
  };
  // The fix uses the group's own numbers → the NEWEST backup, 12 minutes ago.
  assert.equal(backupLastWriteText(group, now), 'newest backup 12 min ago');

  // Documented reproduction of the bug this replaces: the old code scraped the
  // rendered sentence with /(\d+[a-z ]*(?:ago))/i, which on a two-part age
  // matched the SECOND fragment — publishing "2h ago", days too fresh.
  const renderedSentence =
    'Oldest of 5 stores 3d 2h ago (estate-backups) · newest 12m ago · 9 copies kept.';
  const oldScrape = /(\d+[a-z ]*(?:ago))/i.exec(renderedSentence);
  assert.equal(oldScrape[1], '2h ago', 'the old scrape really did understate the age');
});

test('F8: no timestamps → null (last write not reported), never a guess', () => {
  assert.equal(backupLastWriteText({ count: 0 }), null);
  assert.equal(backupLastWriteText(null), null);
  assert.equal(backupLastWriteText({ newest: 'not-a-date' }), null);
});

test('F8: a single-store group with only `oldest` still reports it', () => {
  const now = Date.parse('2026-08-24T12:00:00Z');
  assert.equal(
    backupLastWriteText({ oldest: '2026-08-24T09:00:00Z' }, now),
    'newest backup 3h 0m ago',
  );
});
