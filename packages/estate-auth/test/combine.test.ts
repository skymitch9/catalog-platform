/**
 * The §3.1 combination table, row by row. These tests ARE the table — a
 * change that flips any row is a change to the estate's semantics and must
 * read as one.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { combineEstateAndLocal } from '../src/combine.js';

const active = { active: true, locallyDecided: true };
const activeUndecided = { active: true, locallyDecided: false };
const pendingNeverDecided = { active: false, locallyDecided: false };
const pendingDemoted = { active: false, locallyDecided: true };

test('row 1: revoked beats anything, even a local owner', () => {
  assert.equal(combineEstateAndLocal('revoked', active), 'revoked');
  assert.equal(combineEstateAndLocal('revoked', activeUndecided), 'revoked');
  assert.equal(combineEstateAndLocal('revoked', pendingNeverDecided), 'revoked');
  assert.equal(combineEstateAndLocal('revoked', pendingDemoted), 'revoked');
});

test('row 2: approved + active role proceeds; local capabilities govern', () => {
  assert.equal(combineEstateAndLocal('approved', active), 'proceed');
  assert.equal(combineEstateAndLocal('approved', activeUndecided), 'proceed');
});

test('row 3: approved + never-locally-decided pending = the default grant', () => {
  assert.equal(combineEstateAndLocal('approved', pendingNeverDecided), 'default_grant');
});

test('row 4: approved + locally DEMOTED pending stays pending — the estate does not overrule a standing local decision', () => {
  assert.equal(combineEstateAndLocal('approved', pendingDemoted), 'request_screen');
});

test('row 5: estate pending + active local role — local wins, the seed gap must not lock out the household', () => {
  assert.equal(combineEstateAndLocal('pending', active), 'proceed');
});

test('row 6: pending + pending = request screen, as today', () => {
  assert.equal(combineEstateAndLocal('pending', pendingNeverDecided), 'request_screen');
  assert.equal(combineEstateAndLocal('pending', pendingDemoted), 'request_screen');
});

test('row 7: unreachable (null, no cache) + active role proceeds — availability for the household', () => {
  assert.equal(combineEstateAndLocal(null, active), 'proceed');
});

test('row 8: unreachable + pending/unknown fails CLOSED with the named verdict', () => {
  assert.equal(
    combineEstateAndLocal(null, pendingNeverDecided),
    'estate_unreachable',
    'an outage must be distinguishable from a denial — named, not a bare 403',
  );
  assert.equal(combineEstateAndLocal(null, pendingDemoted), 'estate_unreachable');
});
