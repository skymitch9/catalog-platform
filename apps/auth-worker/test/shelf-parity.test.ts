/**
 * shelf-parity.test.ts — the shelf ↔ Drive parity report.
 *
 * ⚠️ THE FAILURE THIS SURFACE CAN CAUSE IS A FALSE ALL-CLEAR, and it has two
 * shapes. One: a report that stopped arriving three weeks ago still rendering
 * its last cheerful "100%". Two: an `rclone check` that CRASHED being read as
 * "nothing is missing", because a crashed check reports zero missing files.
 * Both put a green bar in front of someone whose library is not actually safe.
 *
 * So these tests care most about the states that must NOT be green, and about
 * the validator refusing rather than storing something that renders wrongly.
 *
 * This estate published a wrong conclusion about this very server on the day
 * this was written, from two correct numbers and one wrong operation. The
 * cross-field check below is the mechanical version of the lesson.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STALE_AFTER_MS, deriveState, parityRefusal, validateReport, type ParityReport } from '../src/shelf-parity.js';

const good: ParityReport = {
  rc: 0,
  total: 1080,
  matched: 1080,
  missing: 0,
  extra: 0,
  differing: 0,
  free_kb: 269_000_000,
  used_kb: 684_000_000,
};

const NOW = Date.parse('2026-08-20T14:00:00.000Z');
const stamp = (r: Partial<ParityReport>, agoMs = 0) => ({
  ...good,
  ...r,
  received_at: new Date(NOW - agoMs).toISOString(),
});

// ── validation ─────────────────────────────────────────────────────────────

test('accepts a well-formed report', () => {
  const v = validateReport({ ...good });
  assert.equal(v.ok, true);
});

test('rejects a report whose parts do not add up to its total', () => {
  // The denominator of the progress bar. Wrong here means a bar that renders
  // confidently and means nothing.
  const v = validateReport({ ...good, total: 1080, matched: 500, missing: 0, differing: 0 });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /internally inconsistent/);
});

test('rejects non-integer, negative and absurd counts', () => {
  for (const bad of [{ total: -1 }, { matched: 1.5 }, { missing: '3' }, { total: 99_999_999_999 }]) {
    assert.equal(validateReport({ ...good, ...bad }).ok, false, JSON.stringify(bad));
  }
});

test('rejects a non-object body', () => {
  for (const bad of [null, 'nope', 42, undefined]) {
    assert.equal(validateReport(bad).ok, false, String(bad));
  }
});

test('accepts a FAILED rclone exit code — it must be storable to be renderable', () => {
  // rc>1 means the check itself failed. Rejecting it would leave the previous
  // good report standing as though nothing had gone wrong.
  const v = validateReport({ ...good, rc: 7 });
  assert.equal(v.ok, true);
});

test('containers is optional, bounded, and strings only', () => {
  assert.equal(validateReport({ ...good, containers: ['abs|Up 3 days'] }).ok, true);
  assert.equal(validateReport({ ...good, containers: 'abs' }).ok, false);
  assert.equal(validateReport({ ...good, containers: [1, 2] }).ok, false);
  assert.equal(validateReport({ ...good, containers: new Array(51).fill('x') }).ok, false);
});

test('shadow_missing is optional, bounded, and stored when valid', () => {
  // Absent → valid (back-compat with reporters that predate the field).
  assert.equal(validateReport({ ...good }).ok, true);
  // Present and valid → accepted AND flows through to the stored report.
  const v = validateReport({ ...good, shadow_missing: 2 });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.report.shadow_missing, 2);
  // Negative, fractional, string, or absurd → rejected.
  for (const bad of [{ shadow_missing: -1 }, { shadow_missing: 1.5 }, { shadow_missing: '2' }, { shadow_missing: 99_999_999_999 }]) {
    assert.equal(validateReport({ ...good, ...bad }).ok, false, JSON.stringify(bad));
  }
});

// ── states ─────────────────────────────────────────────────────────────────

test('a fresh, complete report is in_parity', () => {
  assert.equal(deriveState(stamp({}), NOW).state, 'in_parity');
});

test('never_reported when nothing has ever arrived', () => {
  assert.equal(deriveState(null, NOW).state, 'never_reported');
});

test('⚠️ a STALE report is unknown, never its old green result', () => {
  const s = deriveState(stamp({}), NOW);
  assert.equal(s.state, 'in_parity', 'precondition: identical report, fresh');

  const stale = deriveState(stamp({}, STALE_AFTER_MS + 1000), NOW);
  assert.equal(stale.state, 'unknown');
  assert.match(stale.detail, /not current/);
});

test('one missed 12-hourly run is tolerated; two are not', () => {
  assert.equal(deriveState(stamp({}, 13 * 60 * 60 * 1000), NOW).state, 'in_parity');
  assert.equal(deriveState(stamp({}, 27 * 60 * 60 * 1000), NOW).state, 'unknown');
});

test('⚠️ a FAILED check is unknown, not "0 missing"', () => {
  // rc>1 with zero missing is exactly what a crashed check looks like.
  const s = deriveState(stamp({ rc: 7 }), NOW);
  assert.equal(s.state, 'unknown');
  assert.match(s.detail, /not the same as/);
});

test('staleness is judged before parity, so a stale perfect report cannot be green', () => {
  const s = deriveState(stamp({ rc: 0, missing: 0, differing: 0 }, STALE_AFTER_MS * 10), NOW);
  assert.equal(s.state, 'unknown');
});

test('an unparseable received_at is unknown, not a crash and not green', () => {
  const s = deriveState({ ...good, received_at: 'not-a-date' }, NOW);
  assert.equal(s.state, 'unknown');
});

test('missing files with room to copy them reads as behind', () => {
  const s = deriveState(stamp({ total: 1080, matched: 1000, missing: 80, differing: 0 }), NOW);
  assert.equal(s.state, 'behind');
});

test('differing sizes count as not-in-parity even with nothing missing', () => {
  // A truncated transfer is the failure --size-only exists to catch.
  const s = deriveState(stamp({ total: 1080, matched: 1079, missing: 0, differing: 1 }), NOW);
  assert.equal(s.state, 'behind');
});

test('cannot_fit when what is missing exceeds the free space', () => {
  const s = deriveState(
    stamp({ total: 1000, matched: 100, missing: 900, differing: 0, used_kb: 100_000_000, free_kb: 1_000 }),
    NOW,
  );
  assert.equal(s.state, 'cannot_fit');
});

test('cannot_fit never fires when nothing is missing', () => {
  // Guards the divide-by-total and the "0 missing on a full disk" case: a full
  // disk with a complete library is FINE, and was briefly misread as a blocker.
  const s = deriveState(stamp({ missing: 0, differing: 0, free_kb: 0 }), NOW);
  assert.equal(s.state, 'in_parity');
});

// ── shadow-tree drift (books on disk, missing from Audiobookshelf) ──────────

test('⚠️ shadow_missing>0 on an otherwise-perfect fresh report is shelf_behind, not green', () => {
  // The live failure: rclone reads 100% (missing 0, differing 0) yet books are
  // not hardlinked into ABS's shadow tree, so ABS shows them Missing. This must
  // NOT render as in_parity.
  const s = deriveState(stamp({ shadow_missing: 2 }), NOW);
  assert.equal(s.state, 'shelf_behind');
  assert.match(s.detail, /shadow tree/);
  assert.match(s.detail, /^2 book/); // uses the actual count
});

test('shadow_missing===0 leaves an otherwise-perfect report in_parity', () => {
  assert.equal(deriveState(stamp({ shadow_missing: 0 }), NOW).state, 'in_parity');
});

test('shadow_missing absent behaves exactly as before (back-compat)', () => {
  assert.equal(deriveState(stamp({}), NOW).state, 'in_parity');
});

test('⚠️ staleness beats shadow_missing — a stale report is unknown even with drift', () => {
  const s = deriveState(stamp({ shadow_missing: 2 }, STALE_AFTER_MS + 1000), NOW);
  assert.equal(s.state, 'unknown');
});

test('a failed check (rc>1) beats shadow_missing — still unknown, not shelf_behind', () => {
  const s = deriveState(stamp({ rc: 7, shadow_missing: 2 }), NOW);
  assert.equal(s.state, 'unknown');
});

// ── refusals ───────────────────────────────────────────────────────────────

test('⚠️ refusals name THIS route\'s token, never the conductor token', () => {
  // Regression: borrowing conductorRefusal made a bad bearer here answer "that
  // is not the conductor token… see docs/access/agent-board.md" — a credential
  // this route does not accept, and a document the shelf's owner has never
  // read. Caught by probing the live endpoint, not by the type checker.
  for (const kind of ['secret_unset', 'no_header', 'bad_token'] as const) {
    const r = parityRefusal(kind);
    const text = JSON.stringify(r.body);
    assert.doesNotMatch(text, /conductor token this Worker holds/i, kind);
    assert.doesNotMatch(text, /agent-board/i, kind);
    assert.match(text, /parity/i, kind);
  }
});

test('each refusal cause gets its own status and its own fix', () => {
  assert.equal(parityRefusal('secret_unset').status, 503);
  assert.equal(parityRefusal('no_header').status, 401);
  assert.equal(parityRefusal('bad_token').status, 401);
  for (const kind of ['secret_unset', 'no_header', 'bad_token'] as const) {
    assert.ok(parityRefusal(kind).body.fix, `${kind} must say how to fix it`);
  }
});
