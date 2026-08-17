/**
 * The estate membership check — the §5.2 protocol via the canonical
 * `estateCheck()` (cache while fresh; /seen otherwise; stale cache on
 * failure), with the cache held PER ISOLATE in memory rather than in a
 * database.
 *
 * ⚠️ Deliberately no D1. The index Worker persists its cache because its
 * whole data plane already lives in D1; this Worker has no database in
 * Phase 0–1 and creating one for a 10-minute TTL cache would be
 * infrastructure the design never asked for. The trade is honest: a cold
 * isolate pays one /seen round-trip (~the same cost the index pays for a
 * cache MISS), and a just-revoked person's residual access still respects
 * REVOCATION_DELAY_MS because the TTL rides estate-auth's own constant.
 */

import {
  estateCheck,
  type EstateStatus,
  type SeenCache,
  type SeenIdentity,
} from '@platform/estate-auth';
import type { Env } from './env.js';

const cache = new Map<string, SeenCache>();

/** Tests only — per-isolate state the suite must be able to drop. */
export function resetEstateCache(): void {
  cache.clear();
}

export interface EstateAnswer {
  /** The status used (possibly stale); null = no answer exists at all. */
  status: EstateStatus | null;
  /** True when the answer came from a cache older than the TTL. */
  stale: boolean;
  /** False when the estate wiring (URL/token) is not configured. */
  configured: boolean;
}

/**
 * One person's estate status, cached per the §5.2 protocol. Unconfigured
 * wiring is reported as such — never invented as 'approved' or refused as
 * an error; callers decide what an unconfigured estate means per mode.
 */
export async function estateStatusFor(
  env: Env,
  identity: SeenIdentity,
  nowMs: number = Date.now(),
): Promise<EstateAnswer> {
  const baseUrl = env.ESTATE_AUTH_URL;
  const appToken = env.ESTATE_APP_TOKEN_AUDIOBOOK;
  if (!baseUrl || !appToken) return { status: null, stale: false, configured: false };

  const email = identity.email.trim().toLowerCase();
  const cached = cache.get(email) ?? { status: null, checkedAt: null, visibility: null };
  const result = await estateCheck(cached, { ...identity, email }, { baseUrl, appToken }, nowMs);
  if (result.refresh) {
    cache.set(email, {
      status: result.refresh.status,
      checkedAt: result.refresh.checkedAt,
      visibility: result.refresh.visibility,
    });
  }
  return { status: result.status, stale: result.stale, configured: true };
}
