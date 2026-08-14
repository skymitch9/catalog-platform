/**
 * The read-surface gate: estate members only (estate-auth-design.md §7.1,
 * closing index-worker-design.md §9 Q3 — the lookup surface aggregates titles
 * across all three catalogs including the two private ones).
 *
 * This Worker is the estate's FIRST consumer of the canonical module (§9 step
 * 3 — adopted first deliberately, because it has zero users and nobody can be
 * locked out while the protocol is proven). The flow is the §5.2 protocol
 * verbatim: verify the Firebase ID token LOCALLY → membership via the cached
 * /seen call (estate_cache, migration 0002) → the §3.1 combination table.
 *
 * ⚠️ The index has NO local roles — no app_user, no capability matrix.
 * Membership IS the authorization here, which gives two of the §3.1 verdicts
 * an index-specific reading:
 *
 *   - `default_grant` (estate approved, never locally decided): the apps
 *     assign their configured default role; the index has nothing to assign
 *     (posture declares `defaultRole: null`), so an approved member simply
 *     proceeds. Granting nothing IS the grant.
 *   - "local standing" is OWNER_EMAILS membership and nothing else — the §6
 *     row 4 break-glass, so the owner is served even with the estate down.
 */

import type { MiddlewareHandler } from 'hono';
import {
  CATALOGS,
  combineEstateAndLocal,
  declareAuthPosture,
  estateCheck,
  resolveIdentity,
} from '@platform/estate-auth';
import type { Env } from '../env.js';
import { parseOwnerEmails } from '../env.js';
import { readEstateCache, writeEstateCache } from '../estate-cache.js';
import { scopeFromAnswer, type ScopeVariables } from './scope.js';

/**
 * The per-surface posture declaration (owner decision #1): reads are gated,
 * on the record. Grep `public:` across the estate for the audit.
 */
export const AUTH_POSTURE = declareAuthPosture({
  public: false,
  app: 'index',
  defaultRole: null, // no local role table — membership is the authorization
});

export function requireEstateMember(): MiddlewareHandler<{ Bindings: Env; Variables: ScopeVariables }> {
  return async (c, next) => {
    // 1. Identity — verified locally, no central call (design §5.1).
    let identity;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch (err) {
      // FIREBASE_PROJECT_ID unset: OUR config error, not the caller's 401.
      return c.json({ error: 'misconfigured', detail: (err as Error).message }, 500);
    }
    if (!identity) return c.json({ error: 'unauthenticated' }, 401);

    const email = identity.email.trim().toLowerCase();
    const isOwner = parseOwnerEmails(c.env.OWNER_EMAILS).includes(email);

    // 2. Estate config. A missing var/secret is named as such (the
    //    push_token_unset pattern) — except for OWNER_EMAILS, who must get in
    //    precisely when the estate wiring is broken (§6 row 4).
    const baseUrl = c.env.ESTATE_AUTH_URL;
    const appToken = c.env.ESTATE_APP_TOKEN_INDEX;
    if (!baseUrl || !appToken) {
      if (isOwner) {
        c.set('visibility', [...CATALOGS]); // §4.5: owner's set is computed, never stored
        await next();
        return;
      }
      return c.json(
        {
          error: 'estate_config_unset',
          fix: 'set ESTATE_AUTH_URL in wrangler.toml [vars] and `wrangler secret put ESTATE_APP_TOKEN_INDEX`',
        },
        503,
      );
    }

    // 3. Membership — cache while fresh, /seen otherwise, stale on failure.
    //    Since §4.5 the answer is status + visibility, cached WHOLE
    //    (requireVisibility heals pre-0003 rows with one /seen call).
    const cache = await readEstateCache(c.env.DB, email);
    const result = await estateCheck(cache, {
      email,
      firebaseUid: identity.uid,
      displayName: identity.name,
    }, { baseUrl, appToken, requireVisibility: true });

    if (result.refresh) {
      await writeEstateCache(c.env.DB, {
        email,
        firebaseUid: identity.uid,
        status: result.refresh.status,
        checkedAt: result.refresh.checkedAt,
        visibility: result.refresh.visibility,
      });
    }
    if (result.stale) {
      console.warn(`estate check: serving stale cache for ${email} (auth Worker unreachable)`);
    }

    // 4. The §3.1 table. Local standing = OWNER_EMAILS only (see header).
    const verdict = combineEstateAndLocal(result.status, {
      active: isOwner,
      locallyDecided: false,
    });

    switch (verdict) {
      case 'proceed':
      case 'default_grant': // nothing to grant here — membership is the authorization
        // The member's effective visibility travels with the request so the
        // scoped reads (/api/universe) show only in-scope rows (§4.5). The
        // owner's set is computed, never stored — break-glass must not be
        // narrowable into lockout (§4.3).
        c.set(
          'visibility',
          isOwner ? [...CATALOGS] : scopeFromAnswer(result.status, result.visibility),
        );
        await next();
        return;
      case 'request_screen':
        return c.json(
          { error: 'estate_pending', detail: 'your account is awaiting approval' },
          403,
        );
      case 'revoked':
        return c.json({ error: 'estate_revoked' }, 403);
      case 'estate_unreachable':
        // Named so an outage is distinguishable from a denial (§6 row 1).
        return c.json(
          {
            error: 'estate_unreachable',
            detail: 'the estate directory did not answer and no admission stands; try again shortly',
          },
          503,
        );
    }
  };
}
