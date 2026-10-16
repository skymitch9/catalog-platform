/**
 * access-eval.test.ts — the shelf's Cloudflare Access External Evaluation.
 *
 * Drives the REAL routes with real WebCrypto: a throwaway "Access team"
 * keypair signs the incoming tokens (served through a stubbed fetch of the
 * team certs URL), and a throwaway signing key stands in for
 * ACCESS_EVAL_SIGNING_JWK. Every answer is verified against the JWKS the
 * keys route serves — the same check Access performs.
 *
 * What it does NOT prove: that Cloudflare's real tokens carry exactly these
 * claim names (the conductor's real login is that test), or live D1.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Hono } from 'hono';
import {
  ACCESS_CERTS_URL,
  EVAL_EVENT_WORKER,
  _resetCertsCache,
  accessEvalRoutes,
  decideShelf,
} from '../src/access-eval.js';
import { b64url, b64urlOfJson } from '../src/firebase-sa.js';
import type { AppBindings, Env, EstateUserRow } from '../src/env.js';

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const GEN = { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

async function keypair() {
  return (await crypto.subtle.generateKey(GEN, true, ['sign', 'verify'])) as CryptoKeyPair;
}

const team = await keypair();
const teamPub = { ...(await crypto.subtle.exportKey('jwk', team.publicKey)), kid: 'team-kid-1', alg: 'RS256', use: 'sig' };
const rogue = await keypair();

const ours = await keypair();
const OUR_KID = 'shelf-eval-test';
const SIGNING_JWK = JSON.stringify({ ...(await crypto.subtle.exportKey('jwk', ours.privateKey)), kid: OUR_KID });

async function sign(priv: CryptoKey, header: object, payload: object): Promise<string> {
  const enc = `${b64urlOfJson(header)}.${b64urlOfJson(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign(RSA, priv, new TextEncoder().encode(enc)));
  return `${enc}.${b64url(sig)}`;
}

const now = () => Math.floor(Date.now() / 1000);

function accessToken(over: { email?: string; nonce?: string; exp?: number; kid?: string; key?: CryptoKey } = {}) {
  return sign(
    over.key ?? team.privateKey,
    { alg: 'RS256', kid: over.kid ?? 'team-kid-1' },
    {
      identity: { email: over.email ?? 'Member@Example.Test' },
      nonce: over.nonce ?? 'nonce-abc-123',
      iat: now(),
      exp: over.exp ?? now() + 60,
    },
  );
}

function row(over: Partial<EstateUserRow> = {}): EstateUserRow {
  return {
    id: 1, email: 'member@example.test', firebase_uid: null, display_name: null, status: 'approved',
    is_approver: 0, is_devops: 0, dev_access: 0, origin: 'manual', note: null,
    first_seen_at: '2026-10-15 00:00:00', decided_at: null, decided_by: null,
    vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 0, vis_ebooks: 0, ...over,
  };
}

/** D1 stub: answers getUserByEmail from a map; records the event-ring inserts. */
function stubDb(users: Record<string, EstateUserRow>, opts: { throwOnUser?: boolean } = {}) {
  const events: unknown[][] = [];
  const emailsAsked: string[] = [];
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { args = a; return stmt; },
        async first() {
          if (/FROM estate_user WHERE email = \?/.test(sql)) {
            if (opts.throwOnUser) throw new Error('D1 down');
            emailsAsked.push(String(args[0]));
            return users[String(args[0])] ?? null;
          }
          return null;
        },
        async run() { if (/INSERT INTO worker_events/.test(sql)) events.push(args); return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, events, emailsAsked };
}

function app() {
  const a = new Hono<AppBindings>();
  a.route('/api', accessEvalRoutes);
  return a;
}

const realFetch = globalThis.fetch;
let certFetches = 0;
beforeEach(() => {
  _resetCertsCache();
  certFetches = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === ACCESS_CERTS_URL) {
      certFetches++;
      return new Response(JSON.stringify({ keys: [teamPub] }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

async function evaluate(body: unknown, users: Record<string, EstateUserRow> = {}, envOver: Partial<Env> = {}, dbOpts = {}) {
  const stub = stubDb(users, dbOpts);
  const env = { DB: stub.db, ACCESS_EVAL_SIGNING_JWK: SIGNING_JWK, ...envOver } as unknown as Env;
  const res = await app().request('/api/access/shelf/evaluate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, env);
  await new Promise((r) => setTimeout(r, 5)); // let the un-awaited event write land
  return { res, json: (await res.json()) as Record<string, unknown>, ...stub };
}

/** Verify our answer exactly as Access would: against the served JWKS. */
async function verifyAnswer(token: string) {
  const env = { ACCESS_EVAL_SIGNING_JWK: SIGNING_JWK } as unknown as Env;
  const jwks = (await (await app().request('/api/access/shelf/keys', {}, env)).json()) as { keys: (JsonWebKey & { kid: string })[] };
  const [h, p, s] = token.split('.') as [string, string, string];
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  assert.ok(jwk, 'answer kid is in the served JWKS');
  const key = await crypto.subtle.importKey('jwk', jwk as JsonWebKey, RSA, false, ['verify']);
  const ok = await crypto.subtle.verify(RSA, key, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(ok, 'answer signature verifies against our JWKS');
  return { header, payload: JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown> };
}

// ── keys ────────────────────────────────────────────────────────────────────

test('keys serves a JWKS with ONLY the public half, kid/alg/use set', async () => {
  const env = { ACCESS_EVAL_SIGNING_JWK: SIGNING_JWK } as unknown as Env;
  const res = await app().request('/api/access/shelf/keys', {}, env);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { keys: Record<string, unknown>[] };
  assert.equal(body.keys.length, 1);
  const k = body.keys[0]!;
  assert.deepEqual(Object.keys(k).sort(), ['alg', 'e', 'kid', 'kty', 'n', 'use']);
  assert.equal(k.kid, OUR_KID);
  assert.equal(k.alg, 'RS256');
  assert.equal(k.use, 'sig');
  for (const priv of ['d', 'p', 'q', 'dp', 'dq', 'qi']) assert.equal(k[priv], undefined, `${priv} must never be served`);
});

test('keys and evaluate answer 503 when the signing key is unset', async () => {
  const env = {} as unknown as Env;
  assert.equal((await app().request('/api/access/shelf/keys', {}, env)).status, 503);
  const { res } = await evaluate({ token: await accessToken() }, {}, { ACCESS_EVAL_SIGNING_JWK: undefined });
  assert.equal(res.status, 503);
});

// ── evaluate: the decision ─────────────────────────────────────────────────

test('approved + audiobook grant → signed success:true, nonce echoed, short exp', async () => {
  const { res, json, events, emailsAsked } = await evaluate(
    { token: await accessToken({ nonce: 'n-42' }) },
    { 'member@example.test': row() },
  );
  assert.equal(res.status, 200);
  assert.deepEqual(emailsAsked, ['member@example.test'], 'email is lowercased before lookup');
  const { header, payload } = await verifyAnswer(String(json.token));
  assert.equal(header.alg, 'RS256');
  assert.equal(header.kid, OUR_KID);
  assert.equal(payload.success, true);
  assert.equal(payload.nonce, 'n-42');
  assert.ok((payload.exp as number) - (payload.iat as number) <= 60);
  assert.equal(events.length, 1);
  assert.equal(events[0]![0], EVAL_EVENT_WORKER);
  assert.equal(events[0]![1], 'info');
});

for (const [name, users, reason] of [
  ['pending', { 'member@example.test': row({ status: 'pending' }) }, 'pending'],
  ['revoked', { 'member@example.test': row({ status: 'revoked' }) }, 'revoked'],
  ['approved WITHOUT the audiobook grant', { 'member@example.test': row({ vis_audiobook: 0 }) }, 'not-approved'],
  ['unknown', {}, 'unknown'],
] as const) {
  test(`${name} → signed success:false (nonce still echoed), logged as ${reason}`, async () => {
    const { res, json, events } = await evaluate({ token: await accessToken({ nonce: 'n-7' }) }, users);
    assert.equal(res.status, 200);
    const { payload } = await verifyAnswer(String(json.token));
    assert.equal(payload.success, false);
    assert.equal(payload.nonce, 'n-7');
    assert.equal(events[0]![1], 'warn');
    assert.match(String(events[0]![7]), new RegExp(`"reason":"${reason}"`));
  });
}

test('a D1 failure fails CLOSED: signed success:false, reason error', async () => {
  const { res, json, events } = await evaluate(
    { token: await accessToken() }, { 'member@example.test': row() }, {}, { throwOnUser: true },
  );
  assert.equal(res.status, 200);
  assert.equal((await verifyAnswer(String(json.token))).payload.success, false);
  assert.match(String(events[0]![7]), /"reason":"error"/);
});

// ── evaluate: unverifiable tokens ──────────────────────────────────────────

for (const [name, make] of [
  ['bad signature (wrong key, right kid)', () => accessToken({ key: rogue.privateKey })],
  ['expired', () => accessToken({ exp: now() - 3600 })],
  ['unknown kid', () => accessToken({ kid: 'nope' })],
  ['garbage', async () => 'not.a.jwt'],
  ['missing', async () => undefined],
] as const) {
  test(`${name} token → 403, no signed answer, logged bad-token`, async () => {
    const { res, json, events } = await evaluate(
      { token: await make() }, { 'member@example.test': row() },
    );
    assert.equal(res.status, 403);
    assert.equal(json.token, undefined);
    assert.equal(json.success, false);
    assert.match(String(events[0]![7]), /"reason":"bad-token"/);
  });
}

test('⚠️ the token is never written to the decision log', async () => {
  const tok = await accessToken();
  const { events } = await evaluate({ token: tok }, { 'member@example.test': row() });
  const sig = tok.split('.')[2]!;
  for (const e of events) assert.ok(!JSON.stringify(e).includes(sig));
});

test('team certs are cached across requests', async () => {
  const users = { 'member@example.test': row() };
  await evaluate({ token: await accessToken() }, users);
  await evaluate({ token: await accessToken() }, users);
  assert.equal(certFetches, 1);
});

// ── the pure decision ──────────────────────────────────────────────────────

test('⚠️ decideShelf: a PENDING member is denied even though effectiveVisibility gives them {audiobook}', () => {
  assert.deepEqual(decideShelf(row({ status: 'pending' })), { success: false, reason: 'pending' });
  assert.deepEqual(decideShelf(row()), { success: true, reason: 'approved' });
  assert.deepEqual(decideShelf(null), { success: false, reason: 'unknown' });
  assert.deepEqual(decideShelf(row({ status: 'revoked', vis_audiobook: 1 })), { success: false, reason: 'revoked' });
});
