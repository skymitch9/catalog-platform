/**
 * The hardened dev-bypass shape (§1.1's drift, closed here once for all
 * consumers) and the no-network refusal paths. Paths that would reach
 * Google's JWKS are exercised live against the auth Worker, not here —
 * these tests must run offline.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readBearer, resolveIdentity } from '../src/verify.js';

const req = (auth?: string) =>
  new Request('https://x.example/api/anything', {
    headers: auth ? { Authorization: auth } : {},
  });

test("dev bypass fires ONLY on the affirmative ENVIRONMENT === 'development'", async () => {
  const id = await resolveIdentity(req(), {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'dev@local.test',
  });
  assert.equal(id?.email, 'dev@local.test');
  assert.equal(id?.uid, 'dev-uid');
});

test('the old !== production hole is closed: unrecognised environments get REAL auth', async () => {
  // Each of these used to silently enable the bypass under `!== 'production'`.
  for (const environment of ['staging', 'preview', 'developmnet', '', undefined]) {
    const id = await resolveIdentity(req(), {
      ENVIRONMENT: environment,
      DEV_EMAIL: 'dev@local.test',
      FIREBASE_PROJECT_ID: 'audiobook-catalog',
    });
    assert.equal(id, null, `ENVIRONMENT=${JSON.stringify(environment)} must NOT bypass`);
  }
});

test('production + DEV_EMAIL set does not bypass', async () => {
  const id = await resolveIdentity(req(), {
    ENVIRONMENT: 'production',
    DEV_EMAIL: 'dev@local.test',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
  });
  assert.equal(id, null);
});

test('development WITHOUT DEV_EMAIL falls through to real auth', async () => {
  const id = await resolveIdentity(req(), {
    ENVIRONMENT: 'development',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
  });
  assert.equal(id, null);
});

test('missing FIREBASE_PROJECT_ID throws (misconfiguration, not a 401)', async () => {
  await assert.rejects(
    () => resolveIdentity(req('Bearer x'), { ENVIRONMENT: 'production' }),
    /FIREBASE_PROJECT_ID/,
  );
});

test('no Authorization header → null before any network is touched', async () => {
  const id = await resolveIdentity(req(), {
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
  });
  assert.equal(id, null);
});

test('readBearer parses the header shape and nothing else', () => {
  assert.equal(readBearer(req('Bearer abc.def.ghi')), 'abc.def.ghi');
  assert.equal(readBearer(req('bearer lower')), 'lower');
  assert.equal(readBearer(req('Basic dXNlcjpwdw==')), null);
  assert.equal(readBearer(req()), null);
});
