/**
 * Search scope — the §4.5 anonymous rule, implemented HERE because the design
 * says it is the index's to implement: an absent token means no /seen call
 * ever happens, so the auth Worker cannot answer for the anonymous.
 *
 * ⚠️ THIS MIDDLEWARE NEVER REFUSES. Where requireEstateMember() answers 401 /
 * 403 / 503, this resolves every caller — stranger, pending, revoked, member,
 * owner — to a VISIBILITY SET and proceeds; the search route then scopes its
 * scan to that set (an empty set scans nothing and says so honestly). The
 * table, verbatim from §4.5:
 *
 *   no token / invalid token   → {audiobook}   (the world-readable catalog)
 *   valid token                → /seen via the §5.2 cache; the answer's
 *                                `visibility` array, VERBATIM — {} included
 *   estate unreachable         → a cached answer's visibility rides with its
 *                                cached status; no cache → {audiobook} —
 *                                fail closed to the public slice, never open
 *   OWNER_EMAILS               → all three, computed not stored (§4.3 —
 *                                break-glass must not be narrowable into
 *                                lockout); this also covers estate config
 *                                unset, mirroring the blanket's owner rule
 *
 * `pending` needs no case here: /seen already answers it {audiobook} — the
 * effective set is computed server-side and never recomputed (§4.5).
 *
 * ⚠️ Search-only. /api/lookup and /api/universe stay behind
 * requireEstateMember() — members-only, untouched. The public slice is a
 * SEARCH surface, not a token-free copy of the whole read surface.
 */

import type { MiddlewareHandler } from 'hono';
import {
  CATALOGS,
  PUBLIC_CATALOGS,
  estateCheck,
  resolveIdentity,
  type Catalog,
  type EstateStatus,
} from '@platform/estate-auth';
import type { Env } from '../env.js';
import { parseOwnerEmails } from '../env.js';
import { readEstateCache, writeEstateCache } from '../estate-cache.js';

/** The context variables both scope-aware middlewares set for the routes. */
export interface ScopeVariables {
  visibility: Catalog[];
  /**
   * The verified caller's lowercased email, or null for the anonymous. Set
   * beside `visibility` by BOTH middlewares, at the same moment and from the
   * same identity — so a route that needs to know WHO is asking (the series
   * confirm queue's approver gate) never re-verifies a token that has already
   * been verified once this request.
   */
  email: string | null;
}

/**
 * The effective set from a check result, applied VERBATIM when the answer
 * carried one. The fallback is for a visibility-less answer only (a pre-0003
 * cache row while the estate is unreachable): revoked stays {} — revocation
 * beats the public slice (§4.5) — and everything else fails closed to the
 * public slice, never open.
 */
export function scopeFromAnswer(
  status: EstateStatus | null,
  visibility: Catalog[] | null,
): Catalog[] {
  if (visibility !== null) return visibility;
  if (status === 'revoked') return [];
  return [...PUBLIC_CATALOGS];
}

export function searchScope(): MiddlewareHandler<{ Bindings: Env; Variables: ScopeVariables }> {
  return async (c, next) => {
    // 1. Identity — verified locally (§5.1). Anything short of a trusted
    //    identity IS the anonymous caller: absent token, invalid token, even
    //    our own FIREBASE_PROJECT_ID unset (fail closed to the public slice
    //    rather than 500 — the anonymous answer is always available).
    let identity = null;
    try {
      identity = await resolveIdentity(c.req.raw, c.env);
    } catch {
      identity = null;
    }
    if (!identity) {
      c.set('email', null);
      c.set('visibility', [...PUBLIC_CATALOGS]);
      await next();
      return;
    }

    const email = identity.email.trim().toLowerCase();
    c.set('email', email);
    if (parseOwnerEmails(c.env.OWNER_EMAILS).includes(email)) {
      c.set('visibility', [...CATALOGS]); // computed, never stored (§4.3)
      await next();
      return;
    }

    // 2. Estate config unset: a member cannot be checked, so they get what
    //    the anonymous internet gets — degraded, never widened.
    const baseUrl = c.env.ESTATE_AUTH_URL;
    const appToken = c.env.ESTATE_APP_TOKEN_INDEX;
    if (!baseUrl || !appToken) {
      c.set('visibility', [...PUBLIC_CATALOGS]);
      await next();
      return;
    }

    // 3. Membership + visibility — one cached answer (§4.5's one-answer
    //    rule; requireVisibility heals pre-0003 rows with one /seen call).
    const cache = await readEstateCache(c.env.DB, email);
    const result = await estateCheck(
      cache,
      { email, firebaseUid: identity.uid, displayName: identity.name },
      { baseUrl, appToken, requireVisibility: true },
    );
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
      console.warn(`search scope: serving stale cache for ${email} (auth Worker unreachable)`);
    }

    c.set('visibility', scopeFromAnswer(result.status, result.visibility));
    await next();
  };
}
