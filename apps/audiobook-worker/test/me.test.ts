/**
 * /api/me — the Phase 0 decision paths (migration design §5 Phase 0's
 * verify list: owner, a moderator, a guest — plus the revocation and
 * refusal paths the §3 formula defines).
 *
 * The pure composer (meAnswer) is tested directly; the ROUTE is exercised
 * through the real exported Hono app with the dev-bypass identity and the
 * network stubbed at `globalThis.fetch` (the revoke-clears-site-role.test.ts
 * idiom). ⚠️ Stated plainly: these prove the DECISIONS, not that this Worker
 * can authenticate to live Firebase — nothing here touches a real Firestore
 * or a real estate directory.
 */

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import app from '../src/index.js';
import { meAnswer } from '../src/me.js';
import { resetEstateCache } from '../src/estate-status.js';
import { resetRoleCache } from '../src/roles.js';
import type { Env } from '../src/env.js';

/* ── a real RSA key, because mintAccessToken really signs ───────────────── */

const keyPair = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const pkcs8 = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
const PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(new Uint8Array(pkcs8)).toString('base64')}\n-----END PRIVATE KEY-----\n`;

const SA_JSON = JSON.stringify({
  client_email: 'estate@audiobook-catalog.iam.gserviceaccount.com',
  private_key: PEM,
  project_id: 'audiobook-catalog',
});

/* ── stubs ─────────────────────────────────────────────────────────────── */

interface Script {
  /** GET site_roles/{uid}: role string, null → 404, or an error status. */
  storedRole?: string | null;
  roleReadStatus?: number;
  /** The /seen answer's status; undefined → /seen answers 500. */
  seenStatus?: string;
}

function stubFetch(script: Script) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 'stub-access-token', expires_in: 3600 });
    }
    if (url.includes('/api/estate/seen')) {
      if (script.seenStatus === undefined) return new Response('boom', { status: 500 });
      return Response.json({ status: script.seenStatus, visibility: ['audiobook'] });
    }
    if (url.includes('firestore.googleapis.com')) {
      if (script.roleReadStatus) return new Response('boom', { status: script.roleReadStatus });
      const role = script.storedRole === undefined ? null : script.storedRole;
      if (role === null) return new Response('', { status: 404 });
      return Response.json({
        name: 'projects/p/databases/(default)/documents/site_roles/dev-uid',
        fields: { role: { stringValue: role } },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

/** Dev-bypass env: identity resolves to mod@example.com / uid 'dev-uid'. */
function envWith(over: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'development',
    DEV_EMAIL: 'mod@example.com',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: 'owner@example.com',
    FIREBASE_SERVICE_ACCOUNT: SA_JSON,
    ESTATE_AUTH_URL: 'https://auth.example',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'ab-token',
    ESTATE_CHECK: 'shadow',
    ...over,
  };
}

beforeEach(() => {
  resetEstateCache();
  resetRoleCache();
});

/* ── the pure composer ─────────────────────────────────────────────────── */

test('meAnswer: the §3 formula — ladder role from the stored doc', () => {
  const a = meAnswer({
    email: 'mod@example.com', ownerEmails: [], storedRole: 'moderator',
    mode: 'shadow', estateStatus: 'approved', estateStale: false,
  });
  assert.equal(a.role, 'moderator');
  assert.ok(a.capabilities.includes('operateClub'));
  assert.ok(!a.capabilities.includes('manageClub'));
  assert.deepEqual(a.estate, { mode: 'shadow', status: 'approved', stale: false });
});

test('meAnswer: revoked demotes to guest in ENFORCE mode only (shadow changes no behaviour)', () => {
  const base = {
    email: 'adm@example.com', ownerEmails: [], storedRole: 'admin' as string | null,
    estateStatus: 'revoked' as const, estateStale: false,
  };
  // Shadow: the role stands; the revocation is REPORTED, not acted on.
  assert.equal(meAnswer({ ...base, mode: 'shadow' }).role, 'admin');
  // Enforce: the live estate check refuses — the structural fix for the
  // revoked-admin incident, even while the Firestore doc still says 'admin'.
  const enforced = meAnswer({ ...base, mode: 'enforce' });
  assert.equal(enforced.role, 'guest');
  assert.deepEqual(enforced.capabilities, ['read', 'rate']);
  assert.equal(enforced.estate.status, 'revoked');
});

test('meAnswer: an owner is NEVER demoted — break-glass beats a revocation', () => {
  const a = meAnswer({
    email: 'owner@example.com', ownerEmails: ['owner@example.com'], storedRole: null,
    mode: 'enforce', estateStatus: 'revoked', estateStale: false,
  });
  assert.equal(a.role, 'owner');
  // A stray stored 'owner' doc gets the same protection.
  const stray = meAnswer({
    email: 'x@example.com', ownerEmails: [], storedRole: 'owner',
    mode: 'enforce', estateStatus: 'revoked', estateStale: false,
  });
  assert.equal(stray.role, 'owner');
});

test('meAnswer: unrecognized stored roles resolve to guest, never invented upward', () => {
  const a = meAnswer({
    email: 'x@example.com', ownerEmails: [], storedRole: 'super-admin',
    mode: 'off', estateStatus: null, estateStale: false,
  });
  assert.equal(a.role, 'guest');
});

/* ── the route ─────────────────────────────────────────────────────────── */

test('GET /api/me: signed out → 401 with a worded refusal, never a bare status', async () => {
  const stub = stubFetch({});
  try {
    // Production-shaped env: no dev bypass, no token on the request.
    const res = await app.request('/api/me', {}, envWith({ ENVIRONMENT: 'production', DEV_EMAIL: undefined }));
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error: string; detail: string };
    assert.equal(body.error, 'unauthenticated');
    assert.match(body.detail, /not signed in/i);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('GET /api/me: approved + stored moderator → moderator with its §6 row', async () => {
  const stub = stubFetch({ storedRole: 'moderator', seenStatus: 'approved' });
  try {
    const res = await app.request('/api/me', {}, envWith());
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReturnType<typeof meAnswer>;
    assert.equal(body.signedIn, true);
    assert.equal(body.role, 'moderator');
    assert.ok(body.capabilities.includes('operateClub'));
    assert.ok(!body.capabilities.includes('removeAnyReview'));
    assert.deepEqual(body.estate, { mode: 'shadow', status: 'approved', stale: false });
  } finally {
    stub.restore();
  }
});

test('GET /api/me: approved + NO role doc → guest (absence of a doc IS guest)', async () => {
  const stub = stubFetch({ storedRole: null, seenStatus: 'approved' });
  try {
    const res = await app.request('/api/me', {}, envWith());
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReturnType<typeof meAnswer>;
    assert.equal(body.role, 'guest');
    assert.deepEqual(body.capabilities, ['read', 'rate']);
    assert.equal(body.estate.status, 'approved');
  } finally {
    stub.restore();
  }
});

test('GET /api/me: revoked → reported in shadow, DEMOTED in enforce (§3)', async () => {
  let stub = stubFetch({ storedRole: 'admin', seenStatus: 'revoked' });
  try {
    const shadow = (await (await app.request('/api/me', {}, envWith())).json()) as ReturnType<typeof meAnswer>;
    assert.equal(shadow.role, 'admin'); // shadow acts on nothing
    assert.equal(shadow.estate.status, 'revoked'); // …but says what it sees
  } finally {
    stub.restore();
  }
  resetEstateCache();
  resetRoleCache();
  stub = stubFetch({ storedRole: 'admin', seenStatus: 'revoked' });
  try {
    const res = await app.request('/api/me', {}, envWith({ ESTATE_CHECK: 'enforce' }));
    const body = (await res.json()) as ReturnType<typeof meAnswer>;
    assert.equal(body.role, 'guest'); // the live check refuses a standing doc
    assert.deepEqual(body.capabilities, ['read', 'rate']);
  } finally {
    stub.restore();
  }
});

test('GET /api/me: an owner needs NO service account round-trip (break-glass first)', async () => {
  const stub = stubFetch({ seenStatus: 'approved' });
  try {
    const res = await app.request(
      '/api/me',
      {},
      envWith({ DEV_EMAIL: 'owner@example.com', FIREBASE_SERVICE_ACCOUNT: undefined, ESTATE_CHECK: 'off' }),
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as ReturnType<typeof meAnswer>;
    assert.equal(body.role, 'owner');
    // mode off: the estate is honestly "not consulted", never invented.
    assert.deepEqual(body.estate, { mode: 'off', status: null, stale: false });
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test('GET /api/me: a missing service account is a NAMED config error (503), not an auth failure', async () => {
  const stub = stubFetch({ seenStatus: 'approved' });
  try {
    const res = await app.request('/api/me', {}, envWith({ FIREBASE_SERVICE_ACCOUNT: undefined, ESTATE_CHECK: 'off' }));
    assert.equal(res.status, 503);
    const body = (await res.json()) as { error: string; fix: string };
    assert.equal(body.error, 'service_account_unset');
    assert.match(body.fix, /wrangler secret put/);
  } finally {
    stub.restore();
  }
});

test('GET /api/me: a role-store outage is a 502 with a sentence — an outage, not a denial', async () => {
  const stub = stubFetch({ roleReadStatus: 500, seenStatus: 'approved' });
  try {
    const res = await app.request('/api/me', {}, envWith({ ESTATE_CHECK: 'off' }));
    assert.equal(res.status, 502);
    const body = (await res.json()) as { error: string; detail: string };
    assert.equal(body.error, 'firestore_error');
    assert.match(body.detail, /outage, not a permission decision/);
  } finally {
    stub.restore();
  }
});

test('GET /api/me: mode off never calls /seen; shadow does (and caches it)', async () => {
  let stub = stubFetch({ storedRole: null });
  try {
    const res = await app.request('/api/me', {}, envWith({ ESTATE_CHECK: 'off' }));
    assert.equal(res.status, 200);
    assert.ok(!stub.calls.some((c) => c.includes('/api/estate/seen')));
  } finally {
    stub.restore();
  }
  resetEstateCache();
  resetRoleCache();
  stub = stubFetch({ storedRole: null, seenStatus: 'approved' });
  try {
    await app.request('/api/me', {}, envWith());
    await app.request('/api/me', {}, envWith());
    const seenCalls = stub.calls.filter((c) => c.includes('/api/estate/seen'));
    assert.equal(seenCalls.length, 1); // second answer rode the 10-min cache
  } finally {
    stub.restore();
  }
});
