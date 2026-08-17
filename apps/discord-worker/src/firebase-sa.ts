/**
 * Firebase service-account plumbing — WebCrypto RS256 JWT-bearer → Google
 * OAuth2 access token → Firestore REST, no firebase-admin.
 *
 * HOISTED 2026-08-16: this file was a deliberate copy of auth-worker's
 * `firebase-sa.ts` (taken 2026-08-16 while auth-worker was frozen), with a
 * recorded follow-up to hoist the common core into `packages/` once
 * possible. That follow-up is done — the implementation now lives in
 * `@platform/firebase-sa`, and this file is the thin scope-pinning door the
 * hoist note promised. The two intentional divergences from auth-worker's
 * surface are PRESERVED, because they are this Worker's credential
 * declaration, not drift:
 *   1. SA_SCOPES here is `datastore` ONLY — this Worker writes poll votes
 *      and reads link docs; it has no business holding the identitytoolkit
 *      (Firebase Auth admin) scope auth-worker's shim carries.
 *   2. `lookupUidByEmail` is NOT re-exported, for the same reason.
 */

import {
  mintAccessToken as mintScoped,
  oauthJwtClaims as claimsScoped,
  SCOPE_DATASTORE,
  type ServiceAccount,
} from '@platform/firebase-sa';

export {
  b64url,
  b64urlOfJson,
  firestoreRequest,
  importPrivateKey,
  parseServiceAccount,
  type ServiceAccount,
} from '@platform/firebase-sa';

/** OAuth scope this Worker needs: Firestore only (divergence #1 above). */
export const SA_SCOPES = SCOPE_DATASTORE;

/** The JWT claim set for the OAuth2 jwt-bearer grant, THIS Worker's scope. */
export function oauthJwtClaims(sa: ServiceAccount, nowSeconds: number) {
  return claimsScoped(sa, nowSeconds, SA_SCOPES);
}

/** Mint (or reuse) a Google OAuth2 access token, THIS Worker's scope. */
export async function mintAccessToken(sa: ServiceAccount): Promise<string> {
  return mintScoped(sa, SA_SCOPES);
}
