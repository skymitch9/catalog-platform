/**
 * Revoking must clear the POWERS, not just the status.
 *
 * ⚠️ Written 2026-08-16 alongside the fix, because this exact behaviour is
 * what a mutation audit caught missing. `decideStatus()` set `status` alone and
 * left `is_approver` / `is_devops` intact, and `requireApprover()` checked only
 * the flag — so a revoked approver kept passing the gate that grants and
 * revokes everyone else, and could re-approve themselves. Both halves are now
 * fixed; test/gates.test.ts pins the gate, this pins the write.
 *
 * Owner decisions this encodes (2026-08-16):
 *   1. revoking clears the powers, the row survives
 *   2. re-approval restores MEMBERSHIP, never powers — *"they need to reearn
 *      all rights"* — which works precisely BECAUSE approving is not special
 *      cased. It restores nothing because revoking left nothing to restore.
 *
 * A stub D1 captures the SQL rather than running it. That is deliberate: the
 * thing worth pinning is the DECISION (does the revoke path clear the flags,
 * does the approve path leave them alone), and a stub proves that without a
 * live database, in a suite that runs in a second.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideStatus } from '../src/estate-db.js';

/** Captures every statement prepared, and answers `first()` with a fake row. */
function stubDb() {
  const statements: string[] = [];
  const bindings: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(...args: unknown[]) {
          bindings.push(args);
          return { first: async () => ({ id: 1, email: 'x@y.z' }) };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, statements, bindings };
}

const sqlOf = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').toLowerCase();

/**
 * ⚠️ Only the SET clause counts. `RETURNING ${COLS}` names every column
 * including is_approver/is_devops, so a bare /is_approver/ match is true on
 * EVERY statement and proves nothing — the first draft of these tests asserted
 * exactly that and failed on the approve path, correctly.
 */
const setClause = (s: string | undefined) => sqlOf(s).split(' where ')[0] ?? '';

test('revoke clears is_approver and is_devops in the same statement', () => {
  const { db, statements } = stubDb();
  return decideStatus(db, { id: 7, status: 'revoked', actorId: 1 }).then(() => {
    const sql = setClause(statements[0]);
    assert.match(sql, /is_approver = 0/, 'revoke must clear is_approver');
    assert.match(sql, /is_devops = 0/, 'revoke must clear is_devops');
    // One decision, one write — never a second UPDATE that could half-land.
    assert.equal(statements.length, 1);
  });
});

test('⚠️ approve does NOT restore any power — the owner re-earns them', () => {
  const { db, statements } = stubDb();
  return decideStatus(db, { id: 7, status: 'approved', actorId: 1 }).then(() => {
    const sql = setClause(statements[0]);
    assert.doesNotMatch(sql, /is_approver\s*=/, 'approving must not touch is_approver');
    assert.doesNotMatch(sql, /is_devops\s*=/, 'approving must not touch is_devops');
  });
});

test('revoke clears the powers on the visibility path too', () => {
  // Two code paths write this row; a fix applied to only one is the classic
  // way a hole survives a fix.
  const { db, statements } = stubDb();
  return decideStatus(db, {
    id: 7, status: 'revoked', actorId: 1, visibility: ['audiobook'],
  }).then(() => {
    const sql = setClause(statements[0]);
    assert.match(sql, /is_approver = 0/);
    assert.match(sql, /is_devops = 0/);
    assert.match(sql, /vis_audiobook/, 'and still writes the visibility it was given');
  });
});

test('approve does not touch powers on the visibility path either', () => {
  const { db, statements } = stubDb();
  return decideStatus(db, {
    id: 7, status: 'approved', actorId: 1, visibility: ['audiobook', 'library'],
  }).then(() => {
    const sql = setClause(statements[0]);
    assert.doesNotMatch(sql, /is_approver\s*=/);
    assert.doesNotMatch(sql, /is_devops\s*=/);
  });
});

test('the row is updated, never deleted', () => {
  // 0001's standing rule: a revoked person who returns meets their
  // revocation, not a fresh queue entry. Pinned so no future "cleanup"
  // quietly turns revocation into deletion.
  const { db, statements } = stubDb();
  return decideStatus(db, { id: 7, status: 'revoked', actorId: 1 }).then(() => {
    assert.match(sqlOf(statements[0]).trim(), /^update estate_user/);
    assert.doesNotMatch(sqlOf(statements[0]), /delete/);
  });
});
