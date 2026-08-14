/**
 * The canonical Firebase ID token verifier — the ONE implementation.
 *
 * Ported from the two apps' `middleware/auth.ts` in the games-HARDENED form
 * (estate-auth-design.md §1.1 is the drift story: games hardened its dev
 * bypass to `ENVIRONMENT === 'development'`, the library's copy never heard
 * about it until 2026-08-13). This module exists so that hardening happens
 * once, here, for every consumer.
 *
 * ## What is verified
 *
 * A Firebase ID token is an RS256 JWT signed by Google:
 *
 *     iss  https://securetoken.google.com/<projectId>
 *     aud  <projectId>
 *     sub  the Firebase uid
 *     keys https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com
 *
 * `jose` handles rotation, expiry and signature. What it cannot check is that
 * the token came from the *right* project — any Firebase project's tokens are
 * validly signed by Google. So `FIREBASE_PROJECT_ID` is asserted as both
 * `issuer` and `audience`, and a token minted by any other project fails
 * closed.
 *
 * ⚠️ Removing either assertion turns this into "any Google user of any
 * Firebase app on the internet", which is not a smaller check — it is no
 * check.
 *
 * ## The email rule
 *
 * Email is the estate's join key (design §1.4). Firebase will mint tokens for
 * unverified addresses, so `email_verified === false` is refused here —
 * the difference between "cannot sign in" and "signed in as somebody else".
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Identity {
  email: string;
  uid: string | null;
  name: string | null;
  picture: string | null;
}

/** The env slice the verifier needs. Consumers' Env types satisfy this. */
export interface VerifierEnv {
  ENVIRONMENT?: string;
  DEV_EMAIL?: string;
  DEV_NAME?: string;
  FIREBASE_PROJECT_ID?: string;
}

// Cached per isolate: the JWKS client refetches on rotation by itself, and
// building one per request would add a round trip to every call.
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwksCache) {
    jwksCache = createRemoteJWKSet(
      new URL(
        'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
      ),
    );
  }
  return jwksCache;
}

export function readBearer(req: Request): string | null {
  const header = req.headers.get('Authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m?.[1] ?? null;
}

/**
 * Verify the request's Firebase ID token LOCALLY (no central call, design
 * §5.1) and return the identity, or null when there is none worth trusting.
 *
 * Throws only on misconfiguration (`FIREBASE_PROJECT_ID` unset) so a consumer
 * can answer 500-misconfigured rather than 401 for what is actually its own
 * config error.
 *
 * ⚠️ The dev bypass is `ENVIRONMENT === 'development'` — the affirmative
 * value, never `!== 'production'`. Any unrecognised environment (a typo, a
 * new preview lane, an unset var) gets REAL authentication, which is the safe
 * direction for a mistake to fall. Production wrangler.toml must set
 * `ENVIRONMENT = "production"` explicitly (conformance item §8.2 #8).
 */
export async function resolveIdentity(req: Request, env: VerifierEnv): Promise<Identity | null> {
  if (env.ENVIRONMENT === 'development' && env.DEV_EMAIL) {
    return {
      email: env.DEV_EMAIL,
      uid: 'dev-uid',
      name: env.DEV_NAME ?? 'Local Dev',
      picture: null,
    };
  }

  const projectId = (env.FIREBASE_PROJECT_ID ?? '').trim();
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID is not set');
  }

  const token = readBearer(req);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    if (!email) return null;

    // Unverified email: refuse. Email is the join key everywhere (§1.4).
    if (payload['email_verified'] === false) return null;

    return {
      email,
      uid: typeof payload.sub === 'string' ? payload.sub : null,
      name: typeof payload['name'] === 'string' ? payload['name'] : null,
      picture: typeof payload['picture'] === 'string' ? payload['picture'] : null,
    };
  } catch {
    // Expired, wrong audience, bad signature, wrong project — all the same here.
    return null;
  }
}
