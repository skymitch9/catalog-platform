import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EstateUserRow } from '../src/env.js';
import { meAnswer } from '../src/me.js';

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1,
    email: 'bob@example.com',
    firebase_uid: 'uid-bob',
    display_name: 'Bob',
    status: 'pending',
    is_approver: 0,
    is_devops: 0,
    origin: 'seen:library',
    note: null,
    first_seen_at: '2026-08-14 00:00:00',
    decided_at: null,
    decided_by: null,
    vis_audiobook: 1,
    vis_library: 1,
    vis_games: 1,
    ...over,
  };
}

test('meAnswer: not in the directory → status null, never an error shape', () => {
  assert.deepEqual(meAnswer(null, false), {
    status: null,
    is_approver: false,
    is_devops: false,
    // The public slice — the same thing the anonymous internet sees (§4.5).
    visibility: ['audiobook'],
  });
});

test('meAnswer: pending → the public slice, whatever the stored flags say', () => {
  assert.deepEqual(meAnswer(row({ status: 'pending' }), false), {
    status: 'pending',
    is_approver: false,
    is_devops: false,
    visibility: ['audiobook'],
  });
});

test('meAnswer: approved → the stored set, narrowing included', () => {
  assert.deepEqual(meAnswer(row({ status: 'approved' }), false), {
    status: 'approved',
    is_approver: false,
    is_devops: false,
    visibility: ['audiobook', 'library', 'games'],
  });
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_library: 0, vis_games: 0 }), false).visibility,
    ['audiobook'],
  );
  // An approver may have narrowed to nothing — approved with {} is legal.
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_audiobook: 0, vis_library: 0, vis_games: 0 }), false)
      .visibility,
    [],
  );
});

test('meAnswer: revoked → {} — revocation beats the public slice', () => {
  assert.deepEqual(meAnswer(row({ status: 'revoked' }), false), {
    status: 'revoked',
    is_approver: false,
    is_devops: false,
    visibility: [],
  });
});

test('meAnswer: is_approver mirrors the raw flag requireApprover reads', () => {
  assert.equal(meAnswer(row({ status: 'approved', is_approver: 1 }), false).is_approver, true);
  assert.equal(meAnswer(row({ status: 'approved', is_approver: 0 }), false).is_approver, false);
  // Not gated on status — /me reports exactly what the admin gate would honour.
  assert.equal(meAnswer(row({ status: 'revoked', is_approver: 1 }), false).is_approver, true);
});

test('meAnswer: OWNER_EMAILS break-glass wins over every table state (§4.3)', () => {
  const want = { status: 'approved', is_approver: true, is_devops: true, visibility: ['audiobook', 'library', 'games'] };
  // No row at all — the empty-directory bootstrap.
  assert.deepEqual(meAnswer(null, true), want);
  // A revoked row — the directory being wrong about its own owner.
  assert.deepEqual(meAnswer(row({ status: 'revoked' }), true), want);
  // A narrowed row — the break-glass cannot be narrowed into a lockout.
  assert.deepEqual(
    meAnswer(row({ status: 'approved', vis_audiobook: 0, vis_library: 0, vis_games: 0 }), true),
    want,
  );
});

test('meAnswer: is_devops is EFFECTIVE — raw flag OR approver (0003)', () => {
  assert.equal(meAnswer(row({ status: 'approved', is_devops: 1 }), false).is_devops, true);
  assert.equal(meAnswer(row({ status: 'approved', is_devops: 0 }), false).is_devops, false);
  // Approvers hold every devops surface implicitly — /me must say so, or the
  // status page's Operations section would hide from the people who run it.
  assert.equal(meAnswer(row({ status: 'approved', is_approver: 1, is_devops: 0 }), false).is_devops, true);
});
