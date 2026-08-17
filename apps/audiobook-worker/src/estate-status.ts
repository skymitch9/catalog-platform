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
  type Catalog,
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
 * The WHOLE §4.5 answer — status plus the two facts that ride with it. The
 * ebook gate (src/ebooks.ts) needs all three, and they must share ONE age: a
 * visibility fact re-fetched separately from its status is exactly the
 * split-brain §4.5's one-answer rule exists to forbid.
 */
export interface EstateFullAnswer extends EstateAnswer {
  /** The EFFECTIVE visibility set. ⚠️ null = "we do not know", never "no limits". */
  visibility: Catalog[] | null;
  /** The effective ebook download capability (0009). null = the directory did not say. */
  downloadEbooks: boolean | null;
}

/**
 * One person's estate answer, cached per the §5.2 protocol. Unconfigured
 * wiring is reported as such — never invented as 'approved' or refused as
 * an error; callers decide what an unconfigured estate means per mode.
 *
 * ⚠️ `requireVisibility: true` — this Worker's ebook gate is a VISIBILITY
 * decision, so a cache holding a fresh status with no visibility half is not
 * fresh ENOUGH. One /seen call heals it into a whole answer; without the flag
 * the gate would fall back to "we do not know" (and so refuse) for up to ten
 * minutes after every cold isolate, which reads exactly like a revoked grant.
 */
export async function estateAnswerFor(
  env: Env,
  identity: SeenIdentity,
  nowMs: number = Date.now(),
): Promise<EstateFullAnswer> {
  const baseUrl = env.ESTATE_AUTH_URL;
  const appToken = env.ESTATE_APP_TOKEN_AUDIOBOOK;
  if (!baseUrl || !appToken) {
    return { status: null, stale: false, configured: false, visibility: null, downloadEbooks: null };
  }

  const email = identity.email.trim().toLowerCase();
  const cached = cache.get(email) ?? { status: null, checkedAt: null, visibility: null };
  const result = await estateCheck(
    cached,
    { ...identity, email },
    { baseUrl, appToken, requireVisibility: true },
    nowMs,
  );
  if (result.refresh) {
    cache.set(email, {
      status: result.refresh.status,
      checkedAt: result.refresh.checkedAt,
      visibility: result.refresh.visibility,
      downloadEbooks: result.refresh.downloadEbooks,
    });
  }
  return {
    status: result.status,
    stale: result.stale,
    configured: true,
    visibility: result.visibility,
    downloadEbooks: result.downloadEbooks,
  };
}

/**
 * The status-only view, for callers that gate on membership alone (/api/me).
 * Kept as its own export so nothing which needs only a status is quietly
 * rewritten into something that reads a visibility answer it will not use.
 */
export async function estateStatusFor(
  env: Env,
  identity: SeenIdentity,
  nowMs: number = Date.now(),
): Promise<EstateAnswer> {
  const { status, stale, configured } = await estateAnswerFor(env, identity, nowMs);
  return { status, stale, configured };
}
