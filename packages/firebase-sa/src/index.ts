/**
 * @platform/firebase-sa — the ONE Firebase service-account implementation
 * for the estate's Workers.
 *
 * WebCrypto RS256 JWT-bearer → Google OAuth2 access token → Firestore /
 * identitytoolkit REST. firebase-admin is not needed and never runs on
 * Workers — the pattern docs/info/sso-design.md §3.3 verified.
 *
 * ## Provenance (hoisted 2026-08-16)
 *
 * Canonical home was `apps/auth-worker/src/firebase-sa.ts` (built
 * 2026-08-14); `apps/discord-worker/src/firebase-sa.ts` was a deliberate
 * copy taken while auth-worker was frozen, carrying a recorded follow-up to
 * hoist the common core into `packages/` — this package is that follow-up,
 * done when the audiobook-worker (the third consumer) arrived rather than
 * minting a third copy. Both apps keep a thin `src/firebase-sa.ts` that
 * pins THEIR scopes and re-exports from here, so call sites and tests are
 * unchanged and each Worker's credential power stays declared in that
 * Worker's own tree.
 *
 * ## Scopes are the caller's declaration, not a default
 *
 * The one intentional divergence between the old copies was scope width:
 * auth-worker holds Firestore + identitytoolkit (it resolves uids from
 * emails for grants); discord-worker holds Firestore ONLY (it has no
 * business with Firebase Auth admin power). So `oauthJwtClaims` and
 * `mintAccessToken` take the scope string as a REQUIRED argument — there is
 * deliberately no default that could silently widen a Worker's credential.
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

/** Firestore REST. Every consumer needs this one. */
export const SCOPE_DATASTORE = 'https://www.googleapis.com/auth/datastore';
/** Firebase Auth admin (accounts:lookup). Only for Workers that resolve uids. */
export const SCOPE_IDENTITYTOOLKIT = 'https://www.googleapis.com/auth/identitytoolkit';

/**
 * Parse the secret. Returns null when unset (the route answers 503 with the
 * fix, mirroring /seen's app_tokens_unset idiom); throws on a present but
 * malformed value, because that is a configuration bug worth a loud 500.
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

/**
 * Base64url, unpadded — the JWT segment encoding. Exported: auth-worker's
 * token-signer.ts (the Phase 2 custom-token minter, sso-design.md §4.3)
 * reuses this exact function rather than re-implementing it, per the
 * design's instruction to share this file's idioms instead of writing a
 * second signer from scratch.
 */
export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const b64urlOfJson = (obj: unknown): string =>
  b64url(new TextEncoder().encode(JSON.stringify(obj)));

/**
 * PEM (PKCS#8) → CryptoKey for RSASSA-PKCS1-v1_5/SHA-256 signing. Exported
 * for the same reason as `b64url` above — token-signer.ts signs a
 * different JWT (a Firebase custom token, not an OAuth2 grant assertion)
 * with the identical WebCrypto mechanics.
 */
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
 * exp ≤ iat+3600 (Google's cap). `scope` is the calling Worker's own
 * declaration — see the module doc.
 */
export function oauthJwtClaims(sa: ServiceAccount, nowSeconds: number, scope: string) {
  return {
    iss: sa.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

/**
 * Per-isolate token cache — a token is good for an hour; refresh at 55 min.
 * Keyed by SA identity + scope so two consumers of this module in one
 * process (tests; a future multi-credential Worker) can never hand each
 * other a token minted for different power.
 */
const cached = new Map<string, { token: string; expiresAt: number }>();

/** Mint (or reuse) a Google OAuth2 access token for the service account. */
export async function mintAccessToken(sa: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = `${sa.client_email}|${scope}`;
  const hit = cached.get(key);
  if (hit && hit.expiresAt > now + 60) return hit.token;

  const header = b64urlOfJson({ alg: 'RS256', typ: 'JWT' });
  const claims = b64urlOfJson(oauthJwtClaims(sa, now, scope));
  const signingInput = `${header}.${claims}`;
  const cryptoKey = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
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
  cached.set(key, { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) });
  return data.access_token;
}

/**
 * Resolve a Firebase Auth uid from an email via the project-scoped
 * identitytoolkit accounts:lookup (admin OAuth credential — the same
 * resolution seed_site_admin.py does, so a typo'd uid cannot be granted).
 * Null when no such user exists. ⚠️ Requires SCOPE_IDENTITYTOOLKIT in the
 * access token — a datastore-only consumer must not call this.
 */
export async function lookupUidByEmail(
  sa: ServiceAccount,
  accessToken: string,
  email: string,
): Promise<{ uid: string; displayName: string } | null> {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}/accounts:lookup`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email: [email] }),
    },
  );
  if (!res.ok) {
    throw new Error(`accounts:lookup failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    users?: Array<{ localId: string; displayName?: string }>;
  };
  const user = data.users?.[0];
  return user ? { uid: user.localId, displayName: user.displayName ?? '' } : null;
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
