/**
 * The `/seen` client and its TTL cache logic — design §5.2.
 *
 * One call inside `requireAuth`, AFTER local token verification and the local
 * user upsert. The cache lives on the app's own user row (two nullable
 * columns), so it rides for free on a row already loaded every request.
 */

import { isEstateStatus, type EstateStatus } from './combine.js';

/**
 * ⚠️ The TTL IS the revocation delay — chosen out loud (§5.3, owner-confirmed
 * 2026-08-13). A just-revoked person keeps at most this much residual access
 * per app; the request cost at household scale rounds to zero. The two
 * instant kill paths (local demotion; Firebase account disable) exist
 * independently of this number.
 */
export const REVOCATION_DELAY_MS = 10 * 60 * 1000;

/** The two cache columns as the app stores them (both nullable). */
export interface SeenCache {
  status: EstateStatus | null;
  /** ISO timestamp of the last successful /seen answer, or null. */
  checkedAt: string | null;
}

export function cacheIsFresh(
  checkedAt: string | null,
  nowMs: number = Date.now(),
  ttlMs: number = REVOCATION_DELAY_MS,
): boolean {
  if (!checkedAt) return false;
  const t = Date.parse(checkedAt);
  if (Number.isNaN(t)) return false;
  return nowMs - t < ttlMs;
}

export interface SeenClientOptions {
  /** e.g. https://auth.heygabi.ai — no trailing slash needed. */
  baseUrl: string;
  /** This consumer's own ESTATE_APP_TOKEN_* secret. */
  appToken: string;
  fetchImpl?: typeof fetch;
}

export interface SeenIdentity {
  email: string;
  firebaseUid?: string | null;
  displayName?: string | null;
}

/**
 * POST /api/estate/seen. Returns the estate status, or null on ANY failure —
 * network, non-2xx, unparseable body. The caller keeps its stale cache on
 * null (§5.2: "on failure: keep the stale values; count the failure").
 */
export async function postSeen(
  opts: SeenClientOptions,
  identity: SeenIdentity,
): Promise<EstateStatus | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const resp = await doFetch(`${opts.baseUrl.replace(/\/+$/, '')}/api/estate/seen`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.appToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: identity.email,
        firebase_uid: identity.firebaseUid ?? null,
        display_name: identity.displayName ?? null,
      }),
    });
    if (!resp.ok) return null;
    const body: unknown = await resp.json();
    const status = (body as { status?: unknown } | null)?.status;
    return isEstateStatus(status) ? status : null;
  } catch {
    return null;
  }
}

export interface EstateCheckResult {
  /**
   * The status to feed `combineEstateAndLocal`. May be a stale cached value
   * (deliberate — §6 row 1); null means no answer exists at all.
   */
  status: EstateStatus | null;
  /** True when `status` came from a cache older than the TTL (log it). */
  stale: boolean;
  /**
   * Non-null when a fresh answer arrived: persist these onto the app's cache
   * columns (`estate_status`, `estate_checked_at`).
   */
  refresh: { status: EstateStatus; checkedAt: string } | null;
}

/**
 * The §5.2 protocol: use the cache while fresh; otherwise call `/seen`; on
 * failure fall back to the stale cache (or null when there is none).
 */
export async function estateCheck(
  cache: SeenCache,
  identity: SeenIdentity,
  opts: SeenClientOptions,
  nowMs: number = Date.now(),
): Promise<EstateCheckResult> {
  if (cache.status !== null && cacheIsFresh(cache.checkedAt, nowMs)) {
    return { status: cache.status, stale: false, refresh: null };
  }

  const fresh = await postSeen(opts, identity);
  if (fresh !== null) {
    return {
      status: fresh,
      stale: false,
      refresh: { status: fresh, checkedAt: new Date(nowMs).toISOString() },
    };
  }

  // Estate unreachable (or answered garbage): keep the stale values.
  return { status: cache.status, stale: cache.status !== null, refresh: null };
}
