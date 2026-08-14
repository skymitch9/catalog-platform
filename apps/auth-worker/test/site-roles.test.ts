import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  b64urlOfJson,
  oauthJwtClaims,
  parseServiceAccount,
  SA_SCOPES,
} from '../src/firebase-sa.js';
import { roleBodySchema, rowFromDoc, siteRoleDocFields, SITE_ROLES } from '../src/site-roles.js';

// ---------------------------------------------------------------------------
// parseServiceAccount — unset is a 503-shaped null; malformed is a loud throw
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// oauthJwtClaims — the §3.3-verified JWT shape
// ---------------------------------------------------------------------------

test('oauthJwtClaims: iss = SA email, aud = token endpoint, exp = iat+3600 (the cap)', () => {
  const sa = { client_email: 'sa@p.iam.gserviceaccount.com', private_key: 'x', project_id: 'p' };
  const claims = oauthJwtClaims(sa, 1_000_000);
  assert.deepEqual(claims, {
    iss: 'sa@p.iam.gserviceaccount.com',
    scope: SA_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_000_000,
    exp: 1_003_600,
  });
  // Firestore + identitytoolkit — both halves of the grant path.
  assert.ok(SA_SCOPES.includes('auth/datastore'));
  assert.ok(SA_SCOPES.includes('auth/identitytoolkit'));
});

test('b64urlOfJson: URL-safe, unpadded (JWT segment rules)', () => {
  const seg = b64urlOfJson({ alg: 'RS256', typ: 'JWT' });
  assert.ok(!seg.includes('+') && !seg.includes('/') && !seg.includes('='));
  assert.equal(JSON.parse(Buffer.from(seg, 'base64url').toString()).alg, 'RS256');
});

// ---------------------------------------------------------------------------
// roleBodySchema — the vocabulary IS the rules contract
// ---------------------------------------------------------------------------

test('roleBodySchema: accepts admin/moderator/null and lowercases the email', () => {
  for (const role of [...SITE_ROLES, null]) {
    const r = roleBodySchema.safeParse({ email: 'Person@Example.COM', role });
    assert.ok(r.success, JSON.stringify(r));
    assert.equal(r.data.email, 'person@example.com');
    assert.equal(r.data.role, role);
  }
});

test('roleBodySchema: refuses unknown roles, malformed emails, extra keys', () => {
  assert.ok(!roleBodySchema.safeParse({ email: 'a@b.c', role: 'overlord' }).success);
  assert.ok(!roleBodySchema.safeParse({ email: 'not-an-email', role: 'admin' }).success);
  assert.ok(!roleBodySchema.safeParse({ email: 'a@b.c', role: 'admin', extra: 1 }).success);
  assert.ok(!roleBodySchema.safeParse({ email: 'a@b.c' }).success); // role is required
});

// ---------------------------------------------------------------------------
// Firestore doc mapping — grant shape matches seed_site_admin.py's
// ---------------------------------------------------------------------------

test('siteRoleDocFields: writes the same shape the break-glass seed script writes', () => {
  const fields = siteRoleDocFields({
    role: 'moderator',
    email: 'mod@example.com',
    displayName: 'Mod Person',
    actorEmail: 'owner@example.com',
    nowIso: '2026-08-14T12:00:00.000Z',
  });
  assert.deepEqual(fields, {
    role: { stringValue: 'moderator' },
    email: { stringValue: 'mod@example.com' },
    displayName: { stringValue: 'Mod Person' },
    grantedAt: { timestampValue: '2026-08-14T12:00:00.000Z' },
    grantedBy: { stringValue: 'estate-admin:owner@example.com' },
  });
});

test('rowFromDoc: maps a Firestore REST document to the admin-page row', () => {
  const row = rowFromDoc({
    name: 'projects/audiobook-catalog/databases/(default)/documents/site_roles/uid123',
    fields: {
      role: { stringValue: 'admin' },
      email: { stringValue: 'owner@example.com' },
      displayName: { stringValue: 'Owner' },
      grantedAt: { timestampValue: '2026-08-14T00:00:00Z' },
      grantedBy: { stringValue: 'scripts/seed_site_admin.py' },
    },
  });
  assert.deepEqual(row, {
    uid: 'uid123',
    email: 'owner@example.com',
    role: 'admin',
    displayName: 'Owner',
    grantedAt: '2026-08-14T00:00:00Z',
    grantedBy: 'scripts/seed_site_admin.py',
  });
});

test('rowFromDoc: tolerates sparse docs (seeded by other writers)', () => {
  const row = rowFromDoc({ name: 'x/site_roles/uid9', fields: { role: { stringValue: 'moderator' } } });
  assert.equal(row.uid, 'uid9');
  assert.equal(row.role, 'moderator');
  assert.equal(row.email, '');
  assert.equal(row.grantedAt, null);
  assert.equal(row.grantedBy, null);
});
