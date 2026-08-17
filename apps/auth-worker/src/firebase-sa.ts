/**
 * Firebase service-account plumbing — the Worker-side half of the audiobook
 * catalog's site_roles grant path (three-tier model, 2026-08-14).
 *
 * HOISTED 2026-08-16: the implementation now lives in
 * `@platform/firebase-sa` (packages/firebase-sa — the recorded follow-up
 * from discord-worker's copy, done when the audiobook-worker became the
 * third consumer). This file is deliberately kept as THIS Worker's door to
 * it: it pins the scopes this Worker holds and re-exports the rest, so
 * every existing call site and test import keeps working and the Worker's
 * credential power stays declared here, in its own tree, greppable.
 *
 * The pattern is the one docs/info/sso-design.md §3.3 verified: a Google
 * OAuth2 access token is just an RS256 JWT signed with the service
 * account's own private key (WebCrypto `importKey` pkcs8 → `sign`
 * RSASSA-PKCS1-v1_5/SHA-256) exchanged at oauth2.googleapis.com —
 * firebase-admin is not needed and never runs on Workers.
 *
 * The key arrives as the FIREBASE_SERVICE_ACCOUNT secret (the whole
 * service-account JSON, piped in via `wrangler secret put` — never logged,
 * never echoed; parseServiceAccount deliberately reports WHICH field is
 * missing, never a value).
 */

import {
  mintAccessToken as mintScoped,
  oauthJwtClaims as claimsScoped,
  SCOPE_DATASTORE,
  SCOPE_IDENTITYTOOLKIT,
  type ServiceAccount,
} from '@platform/firebase-sa';

export {
  b64url,
  b64urlOfJson,
  firestoreRequest,
  importPrivateKey,
  lookupUidByEmail,
  parseServiceAccount,
  type ServiceAccount,
} from '@platform/firebase-sa';

/**
 * OAuth scopes the site-roles endpoints need: Firestore + Auth lookup
 * (identitytoolkit is what lets grants resolve a uid from an email — the
 * wide half the datastore-only consumers deliberately do not hold).
 */
export const SA_SCOPES = `${SCOPE_DATASTORE} ${SCOPE_IDENTITYTOOLKIT}`;

/** The JWT claim set for the OAuth2 jwt-bearer grant, THIS Worker's scopes. */
export function oauthJwtClaims(sa: ServiceAccount, nowSeconds: number) {
  return claimsScoped(sa, nowSeconds, SA_SCOPES);
}

/** Mint (or reuse) a Google OAuth2 access token, THIS Worker's scopes. */
export async function mintAccessToken(sa: ServiceAccount): Promise<string> {
  return mintScoped(sa, SA_SCOPES);
}
