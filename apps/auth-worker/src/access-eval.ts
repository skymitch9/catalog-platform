/**
 * SHELF ACCESS — Cloudflare Access EXTERNAL EVALUATION for the audiobook shelf.
 *
 *   POST /api/access/shelf/evaluate   ← Cloudflare Access, at every shelf login
 *   GET  /api/access/shelf/keys       ← Cloudflare Access, to verify our answer
 *
 * Owner, 2026-10-15: *"Add anyone with access to audiobook catalog"* then
 * *"Let's do the auto update todo now"*. Design: bookbuddy/audiobook_catalog
 * docs/info/ROLES.md §3b — Access asks the estate directory at login, so the
 * shelf allowlist can never drift from `estate_user` again. Operator runbook:
 * docs/access/shelf-access-eval.md.
 *
 * ── THE PROTOCOL (Cloudflare docs + cloudflare/workers-access-external-auth-example,
 *    both read 2026-10-15) ───────────────────────────────────────────────────
 *
 *   1. Access POSTs `{"token":"<JWT>"}`. The JWT is RS256, signed by the TEAM's
 *      keys (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, matched
 *      on `kid`), and carries `identity.email` and a per-request `nonce`.
 *   2. We answer 200 `{"token":"<JWT>"}` — RS256, signed with OUR key, header
 *      `kid`, payload `{ success, nonce, iat, exp }`.
 *   3. Access fetches our JWKS from the keys URL and checks: our signature,
 *      `exp` not elapsed, `success === true`, `nonce` unchanged. Any failure —
 *      including a non-200 — evaluates the rule to false.
 *
 * ── WHY THESE ROUTES HAVE NO CORS AND NO SESSION/FIREBASE AUTH ──────────────
 *
 * ⚠️ UNAUTHENTICATED BY DESIGN, NOT BY OMISSION. Cloudflare's servers call
 * them, never a browser, so there is no CORS mount in index.ts (a mount would
 * only widen who can read the answer). The incoming JWT's signature against
 * the team's Access certs IS the authentication; the keys route serves only a
 * PUBLIC key. They sit under /api so the per-IP rate limiter covers them.
 *
 * ── THE DECISION, AND WHY IT FAILS CLOSED ───────────────────────────────────
 *
 * `success` is true iff the verified, lowercased email has an `estate_user`
 * row with status 'approved' AND the audiobook grant — computed through
 * visibility.ts's `effectiveVisibility`, the ONE canonical implementation.
 * ⚠️ `effectiveVisibility` gives a PENDING member the public slice
 * {audiobook}; the public slice is about the public catalogue site, not the
 * private shelf, so this file ALSO requires status === 'approved'. Dropping
 * that clause would let every pending sign-up onto the shelf.
 *
 * Everything else is false: pending, revoked, unknown, D1 error. An
 * unverifiable token gets a 403 (there is no trustworthy nonce to echo, so a
 * signed answer could not be accepted anyway — the example repo does the
 * same). A MISSING signing key gets a 503: we cannot sign, Access reads any
 * non-200 as deny. Failing closed cannot lock the owner out because a static
 * break-glass policy holding only his email sits beside this rule.
 *
 * ── THE SIGNING KEY ─────────────────────────────────────────────────────────
 *
 * `ACCESS_EVAL_SIGNING_JWK` — a Worker secret, the RSA-2048 PRIVATE key as a
 * JWK with its `kid`. The PUBLIC JWK is derived from it at runtime (n, e, kid)
 * rather than stored as a second var: one value, so the served public key can
 * never disagree with the key that signs. Rotation = new keypair + secret put;
 * Access re-reads the keys URL.
 *
 * ── THE DECISION LOG (shadow phase) ─────────────────────────────────────────
 *
 * Every decision lands in the worker-event ring under its OWN worker name
 * (`EVAL_EVENT_WORKER`) so a busy login day evicts only its own rows, never
 * estate-auth's error history. Allow → info, deny → warn. Fields: email,
 * success, reason. ⚠️ The token is NEVER logged.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings } from './env.js';
import { getUserByEmail, normalizeEmail } from './estate-db.js';
import { b64url, b64urlOfJson } from './firebase-sa.js';
import { effectiveVisibility } from './visibility.js';
import { recordOwnEvent } from './worker-events.js';

/** The estate's Zero Trust team domain — the issuer of the tokens we accept. */
export const ACCESS_TEAM_DOMAIN = 'wispy-snowflake-2801.cloudflareaccess.com';
export const ACCESS_CERTS_URL = `https://${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

/** Lifetime of OUR answer. Access consumes it immediately; short is the point. */
export const EVAL_RESPONSE_TTL_SECONDS = 60;

/** Own ring name, so the decision log cannot evict estate-auth's errors. */
export const EVAL_EVENT_WORKER = 'estate-auth/shelf-eval';

/** Leeway on the incoming token's exp/nbf, for clock skew between edges. */
const CLOCK_SKEW_SECONDS = 30;

/** How long the team's certs are trusted before re-fetching (and on an unknown kid). */
const CERTS_TTL_MS = 5 * 60 * 1000;

export type EvalReason = 'approved' | 'not-approved' | 'revoked' | 'pending' | 'unknown' | 'bad-token' | 'error';

const RSA = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

// ---------------------------------------------------------------------------
// base64url / JWT plumbing
// ---------------------------------------------------------------------------

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJsonPart(part: string): Record<string, unknown> {
  const v = JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('jwt part is not an object');
  return v as Record<string, unknown>;
}

interface Jwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  d?: string;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// The team's certs (verification side)
// ---------------------------------------------------------------------------

let certsCache: { at: number; keys: Jwk[] } | null = null;

/** Test hook: forget cached certs between cases. */
export function _resetCertsCache(): void {
  certsCache = null;
}

async function fetchCerts(): Promise<Jwk[]> {
  const res = await fetch(ACCESS_CERTS_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`access certs answered ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  if (!Array.isArray(body.keys)) throw new Error('access certs had no keys array');
  certsCache = { at: Date.now(), keys: body.keys };
  return body.keys;
}

async function certForKid(kid: string): Promise<Jwk | null> {
  const fresh = certsCache && Date.now() - certsCache.at < CERTS_TTL_MS;
  let keys = fresh ? certsCache!.keys : await fetchCerts();
  let jwk = keys.find((k) => k.kid === kid);
  // A rotated team key appears before our cache expires — re-fetch once.
  if (!jwk && fresh) {
    keys = await fetchCerts();
    jwk = keys.find((k) => k.kid === kid);
  }
  return jwk ?? null;
}

/**
 * Verify an incoming Access token. Returns its claims, or throws with a short
 * reason (never containing the token). Signature, RS256, kid, exp and nbf are
 * all checked; anything unverifiable is a throw.
 */
export async function verifyAccessToken(token: unknown, nowSeconds: number): Promise<Record<string, unknown>> {
  if (typeof token !== 'string' || !token) throw new Error('no token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('token must have 3 parts');
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  try {
    header = decodeJsonPart(h);
  } catch {
    throw new Error('token is malformed');
  }
  if (header.alg !== 'RS256') throw new Error('token alg is not RS256');
  if (typeof header.kid !== 'string' || !header.kid) throw new Error('token has no kid');

  const jwk = await certForKid(header.kid);
  if (!jwk) throw new Error('token kid matches no Access cert');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, RSA, false, ['verify']);
  const ok = await crypto.subtle.verify(RSA, key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('token signature invalid');

  let claims: Record<string, unknown>;
  try {
    claims = decodeJsonPart(p);
  } catch {
    throw new Error('token payload is malformed');
  }
  if (typeof claims.exp !== 'number') throw new Error('token has no exp');
  if (claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) throw new Error('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) throw new Error('token not yet valid');
  return claims;
}

// ---------------------------------------------------------------------------
// Our key (signing side)
// ---------------------------------------------------------------------------

export interface SigningKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: { kty: 'RSA'; kid: string; alg: 'RS256'; use: 'sig'; n: string; e: string };
}

/** Parse + import the secret. Null when unset or malformed (caller answers 503). */
export async function loadSigningKey(raw: string | undefined): Promise<SigningKey | null> {
  if (!raw) return null;
  let jwk: Jwk;
  try {
    jwk = JSON.parse(raw) as Jwk;
  } catch {
    return null;
  }
  if (jwk.kty !== 'RSA' || !jwk.d || !jwk.n || !jwk.e || typeof jwk.kid !== 'string' || !jwk.kid) return null;
  try {
    const { kid, alg: _alg, use: _use, key_ops: _ops, ...material } = jwk;
    const privateKey = await crypto.subtle.importKey('jwk', material as JsonWebKey, RSA, false, ['sign']);
    return { kid, privateKey, publicJwk: { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e } };
  } catch {
    return null;
  }
}

export async function signJwt(key: SigningKey, payload: Record<string, unknown>): Promise<string> {
  const encoded = `${b64urlOfJson({ alg: 'RS256', typ: 'JWT', kid: key.kid })}.${b64urlOfJson(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign(RSA, key.privateKey, new TextEncoder().encode(encoded)));
  return `${encoded}.${b64url(sig)}`;
}

// ---------------------------------------------------------------------------
// The decision — pure over the row, so every case is a unit test
// ---------------------------------------------------------------------------

export function decideShelf(
  row: Parameters<typeof effectiveVisibility>[1] & { status: 'pending' | 'approved' | 'revoked' } | null,
): { success: boolean; reason: EvalReason } {
  if (!row) return { success: false, reason: 'unknown' };
  if (row.status === 'revoked') return { success: false, reason: 'revoked' };
  // ⚠️ status === 'approved' is REQUIRED: effectiveVisibility hands a pending
  // member the public slice {audiobook}, which is not a shelf grant.
  if (row.status !== 'approved') return { success: false, reason: 'pending' };
  return effectiveVisibility(row.status, row).includes('audiobook')
    ? { success: true, reason: 'approved' }
    : { success: false, reason: 'not-approved' };
}

function logDecision(c: Context<AppBindings>, email: string | null, success: boolean, reason: EvalReason, why?: string) {
  const who = email ?? '(no verified email)';
  const message = `shelf ${success ? 'ALLOW' : 'DENY'} ${who} — ${reason}`;
  console.log(JSON.stringify({ event: 'shelf_eval', email, success, reason, why: why ?? null }));
  recordOwnEvent(c, {
    worker: EVAL_EVENT_WORKER,
    level: success ? 'info' : 'warn',
    message,
    route: '/api/access/shelf/evaluate',
    detail: JSON.stringify({ email, success, reason, why: why ?? null }),
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const accessEvalRoutes = new Hono<AppBindings>();

accessEvalRoutes.get('/access/shelf/keys', async (c) => {
  const key = await loadSigningKey(c.env.ACCESS_EVAL_SIGNING_JWK);
  if (!key) {
    return c.json(
      {
        error: 'signing_key_unset',
        detail: 'ACCESS_EVAL_SIGNING_JWK is not set (or unreadable) on estate-auth, so there is no public key to publish. See docs/access/shelf-access-eval.md.',
      },
      503,
    );
  }
  c.header('cache-control', 'public, max-age=300');
  return c.json({ keys: [key.publicJwk] });
});

accessEvalRoutes.post('/access/shelf/evaluate', async (c) => {
  const key = await loadSigningKey(c.env.ACCESS_EVAL_SIGNING_JWK);
  if (!key) {
    logDecision(c, null, false, 'error', 'signing key unset');
    return c.json(
      {
        error: 'signing_key_unset',
        detail: 'ACCESS_EVAL_SIGNING_JWK is not set on estate-auth, so no answer can be signed. Access treats this as deny.',
      },
      503,
    );
  }

  const now = Math.floor(Date.now() / 1000);
  let claims: Record<string, unknown>;
  try {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    claims = await verifyAccessToken(body?.token, now);
  } catch (err) {
    const why = (err as Error).message || 'unverifiable';
    logDecision(c, null, false, 'bad-token', why);
    return c.json({ success: false, error: 'bad_token', detail: `The Access token could not be verified (${why}).` }, 403);
  }

  const nonce = claims.nonce;
  const identity = claims.identity as { email?: unknown } | undefined;
  const rawEmail = typeof identity?.email === 'string' ? identity.email : typeof claims.email === 'string' ? claims.email : '';
  const email = rawEmail ? normalizeEmail(rawEmail) : null;

  let decision: { success: boolean; reason: EvalReason };
  let why: string | undefined;
  if (!email) {
    decision = { success: false, reason: 'unknown' };
    why = 'verified token carried no email';
  } else {
    try {
      decision = decideShelf(await getUserByEmail(c.env.DB, email));
    } catch (err) {
      decision = { success: false, reason: 'error' };
      why = `directory read failed: ${(err as Error).message || 'unknown'}`.slice(0, 300);
    }
  }

  logDecision(c, email, decision.success, decision.reason, why);
  const token = await signJwt(key, {
    success: decision.success,
    nonce,
    iat: now,
    exp: now + EVAL_RESPONSE_TTL_SECONDS,
  });
  return c.json({ token });
});
