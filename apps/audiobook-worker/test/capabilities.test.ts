/**
 * The §6 capability matrix, pinned rung by rung — the role-ladder.test.ts
 * idiom: the WHOLE row asserted, so a floor moved by accident fails a test
 * naming the rung it broke.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLE_LADDER } from '../../auth-worker/src/role-ladder.js';
import {
  CAPABILITIES,
  CAPABILITY_FLOORS,
  can,
  capabilitiesFor,
  clubCan,
  CLUB_MANAGER_CAPABILITIES,
} from '../src/capabilities.js';

test('every capability names a floor that is a real ladder rung', () => {
  for (const cap of CAPABILITIES) {
    assert.ok(
      (ROLE_LADDER as readonly string[]).includes(CAPABILITY_FLOORS[cap]),
      `${cap} floor '${CAPABILITY_FLOORS[cap]}' is not on the ladder`,
    );
  }
});

test('the §6 matrix, whole rows: what each rung holds', () => {
  assert.deepEqual(capabilitiesFor('guest'), ['read', 'rate']);
  assert.deepEqual(capabilitiesFor('member'), ['read', 'rate', 'download']);
  assert.deepEqual(capabilitiesFor('contributor'), ['read', 'rate', 'download', 'upload']);
  assert.deepEqual(capabilitiesFor('moderator'), [
    'read',
    'rate',
    'download',
    'upload',
    'operateClub',
    'manageUsers',
  ]);
  // admin and owner hold everything — including the §6 row that admin does
  // NOT get anything beyond owner's set except grant-admin, which is not a
  // capability of THIS worker (auth-worker's canGrant owns granting).
  assert.deepEqual(capabilitiesFor('admin'), [...CAPABILITIES]);
  assert.deepEqual(capabilitiesFor('owner'), [...CAPABILITIES]);
});

test('the ladder is cumulative: each rung keeps everything beneath it', () => {
  for (let i = 1; i < ROLE_LADDER.length; i++) {
    const below = capabilitiesFor(ROLE_LADDER[i - 1]!);
    const here = capabilitiesFor(ROLE_LADDER[i]!);
    for (const cap of below) {
      assert.ok(here.includes(cap), `${ROLE_LADDER[i]} lost '${cap}' held by ${ROLE_LADDER[i - 1]}`);
    }
  }
});

test('operateClub is moderator+, manageClub/administerClub/removeAnyReview are admin+', () => {
  assert.equal(can('moderator', 'operateClub'), true);
  assert.equal(can('contributor', 'operateClub'), false);
  assert.equal(can('moderator', 'manageClub'), false);
  assert.equal(can('admin', 'manageClub'), true);
  assert.equal(can('moderator', 'administerClub'), false);
  assert.equal(can('admin', 'administerClub'), true);
  assert.equal(can('moderator', 'removeAnyReview'), false);
  assert.equal(can('admin', 'removeAnyReview'), true);
});

test('club managers: operate + manage on their OWN club, regardless of ladder rank', () => {
  assert.deepEqual(CLUB_MANAGER_CAPABILITIES, ['operateClub', 'manageClub']);
  // A guest who is a club's bound manager runs and manages that club…
  assert.equal(clubCan('guest', 'operateClub', true), true);
  assert.equal(clubCan('guest', 'manageClub', true), true);
  // …but managership grants nothing off the club axis…
  assert.equal(clubCan('guest', 'removeAnyReview', true), false);
  assert.equal(clubCan('guest', 'download', true), false);
  // …and NEVER the restricted tier (the 2026-08-16 tightening).
  assert.equal(clubCan('guest', 'administerClub', true), false);
  assert.equal(clubCan('moderator', 'administerClub', true), false);
});

test('clubCan without managership is exactly the ladder answer', () => {
  assert.equal(clubCan('moderator', 'operateClub', false), true);
  assert.equal(clubCan('moderator', 'manageClub', false), false);
  assert.equal(clubCan('admin', 'manageClub', false), true);
});
