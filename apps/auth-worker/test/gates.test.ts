/**
 * The two estate gates — written 2026-08-16, after a mutation audit found
 * they had NO coverage at all.
 *
 * ⚠️ How the gap was proved, because "we have 126 tests" is not evidence:
 * `requireDevops()` was deliberately rewritten to admit **anyone not banned**
 * and the entire suite still passed. A gate nothing tests is a gate that can
 * silently open, and these two decide who reaches the runbooks, the backups,
 * the pipeline controls and the member directory itself.
 *
 * ⚠️ Writing these immediately surfaced a real, live privilege-retention bug:
 * `requireApprover` checked only `is_approver`, with no status check, while
 * the strictly less powerful devops gate required `status === 'approved'`.
 * `decideStatus()` revokes by setting `status = 'revoked'` and deliberately
 * leaves the flag alone — so a revoked approver kept passing the gate that
 * grants and revokes everyone else, and could re-approve themselves. The
 * `revoked` cases below are that bug, pinned so it cannot come back.
 *
 * Each test is written to FAIL if the behaviour breaks — the standard the
 * owner asked for ("useful test not just bulk"). No test here asserts that a
 * function merely returns something.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approverAllows, devopsAllows } from '../src/middleware/auth.js';
import type { EstateUserRow } from '../src/env.js';

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: 'bob@example.com',
    firebase_uid: 'uid-bob',
    display_name: 'Bob',
    status: 'approved',
    is_approver: 0,
    is_devops: 0,
    dev_access: 0, // the 0011 DB default — granted by hand, never by approval
    origin: 'seen:library',
    note: null,
    first_seen_at: '2026-08-14 00:00:00',
    decided_at: null,
    decided_by: null,
    vis_audiobook: 1,
    vis_library: 1,
    vis_games: 1,
    vis_library2: 0, // the 0007 DB default
    vis_ebooks: 0, // the 0008 DB default
    // ⚠️ no dl_ebooks — 0009's column left the row shape on 2026-08-17 when
    // downloads became a role floor. The column survives in D1, unread.
    ...over,
  };
}

/* ── the approver gate — the directory's own keys ──────────────────────── */

test('approver: an approved approver is let in', () => {
  assert.equal(approverAllows(row({ is_approver: 1 }), false), true);
});

test('approver: ⚠️ a REVOKED approver is refused, flag or no flag', () => {
  // The live bug. decideStatus() sets status='revoked' and does NOT clear
  // is_approver, so this row exists in production the moment anyone is
  // revoked. Before the fix this returned true — a revoked person could
  // re-approve themselves through the gate that had just shut on them.
  assert.equal(approverAllows(row({ status: 'revoked', is_approver: 1 }), false), false);
});

test('approver: a PENDING approver is refused — approval precedes power', () => {
  assert.equal(approverAllows(row({ status: 'pending', is_approver: 1 }), false), false);
});

test('approver: an approved NON-approver is refused', () => {
  assert.equal(approverAllows(row({ is_approver: 0 }), false), false);
});

test('approver: no directory row is refused — an empty table admits nobody', () => {
  // The no-bootstrap stance: the way in never depends on the thing being
  // changed. Only OWNER_EMAILS may enter a directory with no rows.
  assert.equal(approverAllows(null, false), false);
});

test('approver: OWNER_EMAILS is the break-glass path and needs no row at all', () => {
  assert.equal(approverAllows(null, true), true);
  // ...and outranks even a revoked row, or an incident could lock the owner out.
  assert.equal(approverAllows(row({ status: 'revoked', is_approver: 0 }), true), true);
});

/* ── the devops gate — runbooks, backups, pipeline controls ────────────── */

test('devops: an approved devops account is let in', () => {
  assert.equal(devopsAllows(row({ is_devops: 1 }), false), true);
});

test('devops: an approver qualifies implicitly, without the devops flag', () => {
  // Deliberate: the devops flag exists to let someone read runbooks WITHOUT
  // holding the directory's keys, never to fence approvers out.
  assert.equal(devopsAllows(row({ is_approver: 1, is_devops: 0 }), false), true);
});

test('devops: ⚠️ a REVOKED devops account is refused', () => {
  assert.equal(devopsAllows(row({ status: 'revoked', is_devops: 1 }), false), false);
});

test('devops: a revoked APPROVER is refused here too', () => {
  assert.equal(devopsAllows(row({ status: 'revoked', is_approver: 1 }), false), false);
});

test('devops: an approved account with neither flag is refused', () => {
  assert.equal(devopsAllows(row(), false), false);
});

test('devops: no row is refused; owner still gets in', () => {
  assert.equal(devopsAllows(null, false), false);
  assert.equal(devopsAllows(null, true), true);
});

/* ── the relationship between the two gates ───────────────────────────── */

test('every account the approver gate admits, the devops gate admits too', () => {
  // The ladder has to hold in one direction only. If this ever inverts, the
  // more powerful gate has become the looser one — which is precisely the
  // shape of the bug these tests were written for.
  const cases: EstateUserRow[] = [
    row({ is_approver: 1 }),
    row({ is_approver: 1, is_devops: 1 }),
    row({ status: 'revoked', is_approver: 1 }),
    row({ status: 'pending', is_approver: 1 }),
    row(),
  ];
  for (const r of cases) {
    if (approverAllows(r, false)) {
      assert.equal(devopsAllows(r, false), true, `devops gate refused an approver: ${JSON.stringify(r)}`);
    }
  }
});

test('neither gate is satisfied by status alone', () => {
  // An approved member with no flags reaches neither surface. Guards against
  // a future refactor that checks status and forgets the flag.
  assert.equal(approverAllows(row({ status: 'approved' }), false), false);
  assert.equal(devopsAllows(row({ status: 'approved' }), false), false);
});
