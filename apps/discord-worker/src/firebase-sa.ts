/**
 * Firebase service-account plumbing — WebCrypto RS256 JWT-bearer → Google
 * OAuth2 access token → Firestore REST, no firebase-admin.
 *
 * ⚠️ PROVENANCE, NOT-INTERCHANGEABLE NOTE: this is a deliberate copy of
 * `apps/auth-worker/src/firebase-sa.ts` (canonical there, built 2026-08-14),
 * taken 2026-08-16 while auth-worker was frozen (a concurrent agent owned
 * it, so extracting the shared module was not possible in this build). Two
 * intentional divergences, so the copies are NOT drop-in interchangeable:
 *   1. SA_SCOPES here is `datastore` ONLY — this Worker writes poll votes
 *      and reads link docs; it has no business holding the identitytoolkit
 *      (Firebase Auth admin) scope auth-worker's copy carries.
 *   2. `lookupUidByEmail` is omitted for the same reason.
 * Recorded follow-up: hoist the common core into `packages/` (the estate's
 * shared-canonical-module convention) once auth-worker is unfrozen; until
 * then treat auth-worker's file as canonical and do not let these drift
 * silently.
 *
 * The key arrives as the FIREBASE_SERVICE_ACCOUNT secret (the whole
 * service-account JSON, piped in via `wrangler secret put` — never logged,
 * never echoed; parseServiceAccount deliberately reports WHICH field is
 * missing, never a value).
 */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

/** OAuth scope this Worker needs: Firestore only (divergence #1 above). */
export const SA_SCOPES = 'https://www.googleapis.com/auth/datastore';

/**
 * Parse the secret. Returns null when unset (routes answer with a worded
 * "not configured" message); throws on a present but malformed value,
 * because that is a configuration bug worth a loud failure.
 */
export function parseServiceAccount(raw: string | undefined): ServiceAccount | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON');
  }
  const sa = parsed as Partial<ServiceAccount>;
  for (const field of ['client_email', 'private_key', 'project_id'] as const) {
    if (typeof sa[field] !== 'string' || sa[field].length === 0) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is missing "${field}"`);
    }
  }
  return sa as ServiceAccount;
}

/** Base64url, unpadded — the JWT segment encoding. */
export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const b64urlOfJson = (obj: unknown): string =>
  b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** PEM (PKCS#8) → CryptoKey for RSASSA-PKCS1-v1_5/SHA-256 signing. */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * The JWT claim set for the OAuth2 jwt-bearer grant. Pure, so the shape is
 * testable without a key: iss = the SA email, aud = the token endpoint,
 * exp ≤ iat+3600 (Google's cap).
 */
export function oauthJwtClaims(sa: ServiceAccount, nowSeconds: number) {
  return {
    iss: sa.client_email,
    scope: SA_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

/** Per-isolate token cache — a token is good for an hour; refresh at 55 min. */
let cached: { token: string; expiresAt: number } | null = null;

/** Mint (or reuse) a Google OAuth2 access token for the service account. */
export async function mintAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 60) return cached.token;

  const header = b64urlOfJson({ alg: 'RS256', typ: 'JWT' });
  const claims = b64urlOfJson(oauthJwtClaims(sa, now));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    // Google's error body names the grant problem, never the key material.
    throw new Error(`OAuth token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

const firestoreBase = (sa: ServiceAccount): string =>
  `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

/** One Firestore REST call with the admin token. Returns the raw Response. */
export async function firestoreRequest(
  sa: ServiceAccount,
  accessToken: string,
  method: string,
  pathAndQuery: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${firestoreBase(sa)}/${pathAndQuery}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
