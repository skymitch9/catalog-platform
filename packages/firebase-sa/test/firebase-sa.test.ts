/**
 * Pure-shape tests for the hoisted service-account module. The consumers'
 * own suites (auth-worker's site-roles/revoke tests, discord-worker's
 * poll-vote tests) keep exercising the full flows through their scope-pinned
 * shims — these pin only the contracts that live HERE.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  b64urlOfJson,
  oauthJwtClaims,
  parseServiceAccount,
  SCOPE_DATASTORE,
  SCOPE_IDENTITYTOOLKIT,
} from '../src/index.js';

test('parseServiceAccount: unset → null (routes answer service_account_unset)', () => {
  assert.equal(parseServiceAccount(undefined), null);
  assert.equal(parseServiceAccount(''), null);
});

test('parseServiceAccount: non-JSON throws, and the message never echoes the value', () => {
  assert.throws(() => parseServiceAccount('not json{'), /not valid JSON/);
  try {
    parseServiceAccount('secret-looking-string');
  } catch (err) {
    assert.ok(!(err as Error).message.includes('secret-looking-string'));
  }
});

test('parseServiceAccount: names the missing field, never a value', () => {
  const partial = JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', project_id: 'p' });
  assert.throws(() => parseServiceAccount(partial), /missing "private_key"/);
  const ok = parseServiceAccount(
    JSON.stringify({ client_email: 'sa@p', private_key: 'PEM', project_id: 'p' }),
  );
  assert.deepEqual(ok, { client_email: 'sa@p', private_key: 'PEM', project_id: 'p' });
});

test('oauthJwtClaims: iss = SA email, aud = token endpoint, exp = iat+3600, scope VERBATIM', () => {
  const sa = { client_email: 'sa@p.iam.gserviceaccount.com', private_key: 'x', project_id: 'p' };
  const claims = oauthJwtClaims(sa, 1_000_000, SCOPE_DATASTORE);
  assert.deepEqual(claims, {
    iss: 'sa@p.iam.gserviceaccount.com',
    scope: SCOPE_DATASTORE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_000_000,
    exp: 1_003_600,
  });
  // The scope is the CALLER's declaration — two scopes stay two answers.
  const wide = oauthJwtClaims(sa, 1_000_000, `${SCOPE_DATASTORE} ${SCOPE_IDENTITYTOOLKIT}`);
  assert.ok(wide.scope.includes('auth/identitytoolkit'));
  assert.ok(!claims.scope.includes('auth/identitytoolkit'));
});

test('b64urlOfJson: URL-safe, unpadded (JWT segment rules)', () => {
  const seg = b64urlOfJson({ alg: 'RS256', typ: 'JWT' });
  assert.ok(!seg.includes('+') && !seg.includes('/') && !seg.includes('='));
  assert.equal(JSON.parse(Buffer.from(seg, 'base64url').toString()).alg, 'RS256');
});
