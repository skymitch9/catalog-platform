/**
 * The Phase 2 custom-token minter (sso-design.md §3.3/§4.3/§7.2, §8 Phase 2).
 *
 * A Firebase custom token is just an RS256 JWT — no firebase-admin, no IAM
 * permission, signed with a service account's own private key exactly the
 * way firebase-sa.ts already signs the OAuth2 jwt-bearer assertion. This
 * file REUSES that file's idioms (`importPrivateKey`, `b64url`,
 * `b64urlOfJson`, `parseServiceAccount`, the same `ServiceAccount` shape)
 * instead of writing a second signer from scratch — the only thing that
 * differs from firebase-sa.ts's `mintAccessToken` is the claim set.
 *
 * The signing key is a DIFFERENT, dedicated, zero-IAM-role service account
 * from the one behind FIREBASE_SERVICE_ACCOUNT — see env.ts's
 * TOKEN_SIGNER_KEY doc and docs/access/estate-auth.md for what it can and
 * cannot do, and the rotation runbook. Google issues the key; the estate
 * never generates it, and rotation mints a SECOND console key (both valid at
 * once, no outage) before the old one is deleted.
 *
 * ✅ The secret IS SET on `estate-auth` — this comment said "it does not exist
 * yet as of this build (an owner console step)" until 2026-08-26, when
 * `wrangler secret list` said otherwise. `tokenSignerOrUnset` below is
 * unchanged and still correct: it is the 503 idiom for an UNSET key, which
 * every route using this module must go through first — a guard, not a
 * statement about today.
 */

import { b64url, b64urlOfJson, importPrivateKey, parseServiceAccount, type ServiceAccount } from './firebase-sa.js';

/**
 * The fixed `aud` a Firebase custom token must carry — verified against
 * Google's docs, sso-design.md §3.3.
 */
export const CUSTOM_TOKEN_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/**
 * 5 minutes (design §3.3/§4.3: "mint 5 min"). This is the mint-to-exchange
 * window, not a session lifetime — the client calls signInWithCustomToken
 * immediately, so it is single-use in practice. Google's own hard cap on a
 * custom token is 3600s; 300s is the design's deliberately tighter choice.
 */
export const CUSTOM_TOKEN_TTL_SECONDS = 300;

/**
 * The claim set (§3.3): `iss` = `sub` = the signing SA's own email — no
 * IAM permission is needed because the key itself IS the capability.
 * Pure, so the shape is testable without ever touching WebCrypto.
 */
export function customTokenClaims(sa: ServiceAccount, uid: string, nowSeconds: number) {
  return {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: CUSTOM_TOKEN_AUD,
    iat: nowSeconds,
    exp: nowSeconds + CUSTOM_TOKEN_TTL_SECONDS,
    uid,
  };
}

/** Mint a fresh Firebase custom token for `uid`, signed by `sa`'s private key. */
export async function mintCustomToken(sa: ServiceAccount, uid: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlOfJson({ alg: 'RS256', typ: 'JWT' });
  const claims = b64urlOfJson(customTokenClaims(sa, uid, now));
  const signingInput = `${header}.${claims}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

/**
 * 503-or-key for TOKEN_SIGNER_KEY — the SAME idiom as firebase-sa.ts's own
 * `service_account_unset` / estate.ts's `app_tokens_unset`: a missing
 * secret is a configuration error, answered with the exact fix command,
 * NEVER a 500 and never a confusing 401. Reuses parseServiceAccount() as-is
 * (the key is the same JSON shape) — a malformed-but-present value still
 * throws loudly, which is correct: that is a deploy bug, not "unset".
 */
export function tokenSignerOrUnset(raw: string | undefined):
  | { sa: ServiceAccount; unset: null }
  | { sa: null; unset: { error: 'token_signer_unset'; fix: string } } {
  const sa = parseServiceAccount(raw);
  if (!sa) {
    return { sa: null, unset: { error: 'token_signer_unset', fix: 'wrangler secret put TOKEN_SIGNER_KEY' } };
  }
  return { sa, unset: null };
}
