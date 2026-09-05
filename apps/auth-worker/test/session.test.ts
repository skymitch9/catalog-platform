/**
 * The Phase 2 session routes, exercised against the REAL exported
 * `sessionRoutes` (not a reconstruction) — same idiom as test/health.test.ts
 * and test/env.test.ts. Identity comes from the canonical module's OWN dev
 * bypass (ENVIRONMENT === 'development' + DEV_EMAIL — the same mechanism
 * live-probes.ts's phase A/C/D use), never a re-implementation of JWT
 * verification. D1 is a minimal in-memory fake implementing exactly the
 * statements session-db.ts issues.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ServiceAccount } from '../src/firebase-sa.js';
import { sessionRoutes, SESSION_COOKIE, SESSION_NO_UID_DETAIL } from '../src/session.js';
import type { EstateSessionRow } from '../src/session-db.js';

class FakeSessionDB {
  rows = new Map<string, EstateSessionRow>();

  /**
   * The estate directory, as far as these tests are concerned: email →
   * status. Added 2026-08-18 with the estate-revocation check on
   * POST /session/token (session.ts, design §4.3's "estate_user.status ≠
   * revoked?" step). Empty by default, which is the "directory has never
   * met this person" case the route deliberately treats as NOT a
   * revocation — so every pre-existing test keeps exercising exactly the
   * path it was written for.
   */
  members = new Map<string, { status: 'pending' | 'approved' | 'revoked' }>();

  prepare(sql: string) {
    const self = this;
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>(): Promise<T | null> {
            if (sql.includes('FROM estate_user WHERE email')) {
              const [email] = args as [string];
              const member = self.members.get(email);
              return (member ? ({ email, ...member } as unknown as T) : null);
            }
            if (sql.startsWith('INSERT INTO estate_session')) {
              const [id, email, firebase_uid, created_at, last_used_at, expires_at] = args as [
                string,
                string,
                string,
                string,
                string,
                string,
              ];
              const row: EstateSessionRow = { id, email, firebase_uid, created_at, last_used_at, expires_at, revoked_at: null };
              self.rows.set(id, row);
              return row as unknown as T;
            }
            if (sql.includes('FROM estate_session WHERE id')) {
              const [id] = args as [string];
              return (self.rows.get(id) ?? null) as unknown as T;
            }
            return null;
          },
          async run() {
            if (sql.startsWith('UPDATE estate_session SET last_used_at')) {
              const [last_used_at, expires_at, id] = args as [string, string, string];
              const row = self.rows.get(id);
              if (row) {
                row.last_used_at = last_used_at;
                row.expires_at = expires_at;
              }
              return { success: true };
            }
            if (sql.startsWith('UPDATE estate_session SET revoked_at')) {
              const [id] = args as [string];
              const row = self.rows.get(id);
              if (row && row.revoked_at === null) row.revoked_at = new Date().toISOString();
              return { success: true };
            }
            return { success: true };
          },
          async all() {
            return { results: [] };
          },
        };
      },
    };
  }

  async batch() {
    return [];
  }
}

const OWNER = 'owner@example.com';

function baseEnv(db: FakeSessionDB, over: Record<string, unknown> = {}) {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: 'production',
    FIREBASE_PROJECT_ID: 'audiobook-catalog',
    OWNER_EMAILS: OWNER,
    SESSION_ORIGINS: 'https://heygabi.ai,https://audiobooks.heygabi.ai,https://library.heygabi.ai,https://boardgames.heygabi.ai',
    COOKIE_DOMAIN: 'heygabi.local.test', // never .heygabi.ai in a test — see env.ts's doc
    ...over,
  };
}

function devEnv(db: FakeSessionDB, email: string, over: Record<string, unknown> = {}) {
  return baseEnv(db, { ENVIRONMENT: 'development', DEV_EMAIL: email, ...over });
}

async function generateTestServiceAccountJson(): Promise<string> {
  const { privateKey } = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey('pkcs8', privateKey)) as ArrayBuffer;
  const b64 = Buffer.from(pkcs8).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${(b64.match(/.{1,64}/g) ?? []).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const sa: ServiceAccount = {
    client_email: 'estate-token-minter@audiobook-catalog.iam.gserviceaccount.com',
    private_key: pem,
    project_id: 'audiobook-catalog',
  };
  return JSON.stringify(sa);
}

function cookieValueOf(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(setCookieHeader);
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// POST /session — ID token -> cookie
// ---------------------------------------------------------------------------

test('POST /session: tokenless in real-auth mode → 401 unauthenticated, no row created', async () => {
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request('/session', { method: 'POST' }, baseEnv(db));
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'unauthenticated');
  assert.equal(db.rows.size, 0);
});

test('🔴 POST /session: the 401 carries a SENTENCE, never a bare status', async () => {
  // The first of the three bare-401 siblings fixed 2026-09-05 (the others are
  // pinned in me-contract.test.ts and catalog-requests.test.ts). Whoever meets
  // this one is a BROWSER MID-SIGN-IN — the ID-token → cookie exchange is the
  // step right after Google hands the page an identity — so the sentence has to
  // say where to start the sign-in again, not name a header they cannot set.
  //
  // ⚠️ The `error` CODE must stay exactly `unauthenticated`: tools/estate-probes
  // asserts it across this Worker's whole unauthenticated edge and every page's
  // failure wording branches on it. Only the `detail` is new — which is why the
  // test above is left standing rather than folded into this one.
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request('/session', { method: 'POST' }, baseEnv(db));
  const body = (await res.json()) as { error: string; detail?: string };
  assert.equal(body.error, 'unauthenticated');
  assert.equal(typeof body.detail, 'string', 'a bare {error} is what this test exists to prevent');
  assert.ok(body.detail!.length > 0, 'an empty detail is a bare status wearing a field name');
  assert.match(body.detail!, /sign in again/i);
  assert.match(body.detail!, /heygabi\.ai/);
});

test('🔴 POST /session: the SECOND 401 on this route — a verified token naming no account — is a sentence too', async () => {
  // The sibling of the test above, and the one the 2026-09-05 bare-status sweep
  // did not reach: `if (!identity.uid)`. Its detail read `'token carries no uid'`
  // until 2026-09-05 — a sentence written for whoever wrote the file.
  //
  // ⚠️ WHAT THIS DOES NOT DO, said plainly: it does not drive the route. Getting
  // there needs a Firebase ID token that passes a real JWKS verification and yet
  // carries no `sub`, and this suite holds no token and will not mint one — the
  // dev bypass always answers `uid: 'dev-uid'` (packages/estate-auth/src/verify.ts).
  // So the BRANCH is unexercised and the WORDING is pinned, which is why the
  // string is a named export rather than an inline literal. A test that pretended
  // otherwise would be worse than this one.
  assert.equal(typeof SESSION_NO_UID_DETAIL, 'string');
  assert.ok(SESSION_NO_UID_DETAIL.length > 0, 'an empty detail is a bare status wearing a field name');

  // What happened / what it needs / how to get it — the estate's three clauses.
  assert.match(SESSION_NO_UID_DETAIL, /no estate session was created/i, 'clause 1: what happened');
  assert.match(SESSION_NO_UID_DETAIL, /needs a Google account/i, 'clause 2: what it needs');
  assert.match(SESSION_NO_UID_DETAIL, /heygabi\.ai/, 'clause 3: how to get it — somewhere to go');
  assert.match(SESSION_NO_UID_DETAIL, /estate owner/i, 'clause 3: and who to ask when going there twice fails');

  // ⚠️ The vocabulary a person can do nothing with must stay OUT. This is the
  // same assertion shape the machine-vs-person split uses elsewhere in this
  // Worker: naming `uid`/`sub`/`token` sends somebody hunting for a thing they
  // cannot see, which is the failure the worded-refusal rule exists to prevent.
  for (const jargon of [/\buid\b/i, /\bsub\b/i, /\btoken\b/i, /\bJWT\b/i, /\bclaim\b/i]) {
    assert.doesNotMatch(SESSION_NO_UID_DETAIL, jargon, `${jargon} is developer vocabulary, not a person's`);
  }
});

test('POST /session: dev-bypass identity → 200, creates a row, sets the cookie with the §4.3 attributes', async () => {
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request('/session', { method: 'POST' }, devEnv(db, 'Member@Example.COM'));
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.ok, true);
  assert.ok(typeof body.expires_at === 'string' && !Number.isNaN(Date.parse(body.expires_at)));

  assert.equal(db.rows.size, 1);
  const row = [...db.rows.values()][0]!;
  assert.equal(row.email, 'member@example.com'); // lowercased
  assert.equal(row.firebase_uid, 'dev-uid'); // the canonical module's fixed dev-bypass uid
  assert.equal(row.revoked_at, null);

  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'Set-Cookie header present');
  assert.equal(cookieValueOf(setCookie, SESSION_COOKIE), row.id);
  const lower = (setCookie ?? '').toLowerCase();
  assert.ok(lower.includes('domain=heygabi.local.test'), setCookie ?? '');
  assert.ok(lower.includes('secure'), setCookie ?? '');
  assert.ok(lower.includes('httponly'), setCookie ?? '');
  assert.ok(lower.includes('samesite=lax'), setCookie ?? '');
  assert.ok(lower.includes('max-age=2592000'), setCookie ?? ''); // 30 days, in seconds
  assert.ok(lower.includes('path=/'), setCookie ?? '');
});

test('POST /session: two sign-ins from the same person create TWO independent rows (one per device)', async () => {
  const db = new FakeSessionDB();
  await sessionRoutes.request('/session', { method: 'POST' }, devEnv(db, 'member@example.com'));
  await sessionRoutes.request('/session', { method: 'POST' }, devEnv(db, 'member@example.com'));
  assert.equal(db.rows.size, 2);
  const ids = [...db.rows.keys()];
  assert.notEqual(ids[0], ids[1]);
});

// ---------------------------------------------------------------------------
// POST /session/token — cookie -> minted custom token
// ---------------------------------------------------------------------------

test('POST /session/token: no cookie → 401 no_session', async () => {
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request('/session/token', { method: 'POST' }, baseEnv(db));
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'no_session');
});

test('POST /session/token: cookie names an unknown id → 401 no_session (never leaks whether an id ever existed)', async () => {
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=does-not-exist` } },
    baseEnv(db),
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'no_session');
});

test('POST /session/token: a revoked session → 401 session_revoked', async () => {
  const db = new FakeSessionDB();
  db.rows.set('sid-revoked', {
    id: 'sid-revoked',
    email: 'member@example.com',
    firebase_uid: 'uid-1',
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    revoked_at: new Date().toISOString(),
  });
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-revoked` } },
    baseEnv(db),
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'session_revoked');
});

test('POST /session/token: an expired session → 401 session_expired', async () => {
  const db = new FakeSessionDB();
  db.rows.set('sid-expired', {
    id: 'sid-expired',
    email: 'member@example.com',
    firebase_uid: 'uid-1',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 40).toISOString(),
    last_used_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 31).toISOString(),
    expires_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // in the past
    revoked_at: null,
  });
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-expired` } },
    baseEnv(db),
  );
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).error, 'session_expired');
});

test('POST /session/token: a LIVE session but TOKEN_SIGNER_KEY unset → 503 token_signer_unset, never 500/401', async () => {
  const db = new FakeSessionDB();
  db.rows.set('sid-live', {
    id: 'sid-live',
    email: 'member@example.com',
    firebase_uid: 'uid-1',
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    revoked_at: null,
  });
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-live` } },
    baseEnv(db), // no TOKEN_SIGNER_KEY
  );
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'token_signer_unset', fix: 'wrangler secret put TOKEN_SIGNER_KEY' });
});

test('POST /session/token: session validity is checked BEFORE the signer key — an invalid session still 401s even with the key unset', async () => {
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=nope` } },
    baseEnv(db), // TOKEN_SIGNER_KEY also unset — 401 must win, not 503
  );
  assert.equal(res.status, 401);
});

test('POST /session/token: a live session + a configured signer → 200 with a real token, rolling renewal applied', async () => {
  const db = new FakeSessionDB();
  const staleExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(); // 2 days left
  db.rows.set('sid-live', {
    id: 'sid-live',
    email: 'member@example.com',
    firebase_uid: 'uid-1',
    created_at: new Date().toISOString(),
    last_used_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 28).toISOString(),
    expires_at: staleExpiry,
    revoked_at: null,
  });
  const tokenSignerKey = await generateTestServiceAccountJson();
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-live` } },
    baseEnv(db, { TOKEN_SIGNER_KEY: tokenSignerKey }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(typeof body.token, 'string');
  assert.equal(body.token.split('.').length, 3);
  assert.equal(body.expires_in, 300);
  assert.ok(typeof body.session_expires_at === 'string');

  // Rolling renewal (owner Q6): expires_at moved forward from the stale value.
  const row = db.rows.get('sid-live')!;
  assert.notEqual(row.expires_at, staleExpiry);
  assert.ok(Date.parse(row.expires_at) > Date.parse(staleExpiry));

  // The cookie is re-issued with a fresh Max-Age too — the browser's own
  // copy rolls forward, not just the D1 row.
  const setCookie = res.headers.get('set-cookie');
  assert.ok((setCookie ?? '').toLowerCase().includes('max-age=2592000'));
  assert.equal(cookieValueOf(setCookie, SESSION_COOKIE), 'sid-live');

  // The minted uid is the SESSION's uid, not anything from the request.
  const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.uid, 'uid-1');
});

// ---------------------------------------------------------------------------
// The estate-revocation check on the mint route (design §4.3, added with
// Phase 3 on 2026-08-18). The estate's promise is that revocation shuts every
// door within minutes; these four tests are what hold this route to it.
// ---------------------------------------------------------------------------

/** A live, unexpired session row for `email` — the starting point for the four below. */
function liveRow(email: string, id = 'sid-est'): EstateSessionRow {
  return {
    id,
    email,
    firebase_uid: 'uid-est',
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString(),
    revoked_at: null,
  };
}

test('POST /session/token: a REVOKED estate member → 403 estate_revoked, and the session row is killed so they stop re-asking', async () => {
  const db = new FakeSessionDB();
  db.rows.set('sid-est', liveRow('gone@example.com'));
  db.members.set('gone@example.com', { status: 'revoked' });
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-est` } },
    baseEnv(db, { TOKEN_SIGNER_KEY: await generateTestServiceAccountJson() }),
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json() as any).error, 'estate_revoked');
  // No token was minted, and the row is now revoked — the estate said no once
  // and that answer is durable, not re-litigated on every page load.
  assert.notEqual(db.rows.get('sid-est')!.revoked_at, null);
});

test('POST /session/token: an APPROVED estate member still mints normally — the check refuses only `revoked`', async () => {
  const db = new FakeSessionDB();
  db.rows.set('sid-est', liveRow('member@example.com'));
  db.members.set('member@example.com', { status: 'approved' });
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-est` } },
    baseEnv(db, { TOKEN_SIGNER_KEY: await generateTestServiceAccountJson() }),
  );
  assert.equal(res.status, 200);
  assert.equal(typeof (await res.json() as any).token, 'string');
});

test('POST /session/token: an ABSENT directory row is NOT a revocation — a person the directory has not met still mints', async () => {
  // Failing closed on absence would turn a directory hiccup, or simply a
  // newcomer whose /hello has not landed yet, into an estate-wide sign-out.
  const db = new FakeSessionDB();
  db.rows.set('sid-est', liveRow('newcomer@example.com'));
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-est` } },
    baseEnv(db, { TOKEN_SIGNER_KEY: await generateTestServiceAccountJson() }),
  );
  assert.equal(res.status, 200);
});

test('POST /session/token: the OWNER break-glass survives even a revoked directory row', async () => {
  // An incident that corrupts the directory must never lock the owner out of
  // the admin page he would fix it from — the same break-glass every other
  // gate in this Worker carries.
  const db = new FakeSessionDB();
  db.rows.set('sid-est', liveRow(OWNER));
  db.members.set(OWNER, { status: 'revoked' });
  const res = await sessionRoutes.request(
    '/session/token',
    { method: 'POST', headers: { Cookie: `${SESSION_COOKIE}=sid-est` } },
    baseEnv(db, { TOKEN_SIGNER_KEY: await generateTestServiceAccountJson() }),
  );
  assert.equal(res.status, 200);
  assert.equal(db.rows.get('sid-est')!.revoked_at, null);
});

// ---------------------------------------------------------------------------
// DELETE /session — sign-out
// ---------------------------------------------------------------------------

test('DELETE /session: no cookie → 200 { ok: true }, idempotent, nothing to revoke', async () => {
  const db = new FakeSessionDB();
  const res = await sessionRoutes.request('/session', { method: 'DELETE' }, baseEnv(db));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('DELETE /session: with a cookie → revokes the row (stamped, not deleted) and clears the cookie', async () => {
  const db = new FakeSessionDB();
  db.rows.set('sid-live', {
    id: 'sid-live',
    email: 'member@example.com',
    firebase_uid: 'uid-1',
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    revoked_at: null,
  });
  const res = await sessionRoutes.request(
    '/session',
    { method: 'DELETE', headers: { Cookie: `${SESSION_COOKIE}=sid-live` } },
    baseEnv(db),
  );
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const row = db.rows.get('sid-live')!;
  assert.ok(row.revoked_at !== null, 'stamped, not deleted');
  assert.equal(db.rows.has('sid-live'), true, 'the row still exists — §4.2\'s reasoning, applied to sessions');

  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie);
  const lower = (setCookie ?? '').toLowerCase();
  // deleteCookie() clears via Max-Age=0 (or an expiry in the past) — either
  // is a correct clear; assert the meaningful invariant instead of one exact
  // serialization.
  assert.ok(lower.includes('max-age=0') || /expires=/.test(lower), setCookie ?? '');
});

test('DELETE /session: a session already revoked stays revoked (no re-stamp, no crash)', async () => {
  const db = new FakeSessionDB();
  const firstRevokedAt = new Date(Date.now() - 60_000).toISOString();
  db.rows.set('sid-live', {
    id: 'sid-live',
    email: 'member@example.com',
    firebase_uid: 'uid-1',
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    revoked_at: firstRevokedAt,
  });
  const res = await sessionRoutes.request(
    '/session',
    { method: 'DELETE', headers: { Cookie: `${SESSION_COOKIE}=sid-live` } },
    baseEnv(db),
  );
  assert.equal(res.status, 200);
  assert.equal(db.rows.get('sid-live')!.revoked_at, firstRevokedAt);
});
