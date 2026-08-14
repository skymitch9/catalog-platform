/**
 * The `/seen` client and its TTL cache logic — design §5.2.
 *
 * One call inside `requireAuth`, AFTER local token verification and the local
 * user upsert. The cache lives on the app's own user row (two nullable
 * columns), so it rides for free on a row already loaded every request.
 */

import { isEstateStatus, type EstateStatus } from './combine.js';
import { parseVisibility, type Catalog } from './visibility.js';

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
  /**
   * The EFFECTIVE visibility set cached WITH the status — §4.5's one-answer
   * rule: the two are one answer and must not age separately. Optional so a
   * consumer that only gates (status is all it reads) keeps compiling and
   * behaving exactly as before; null/absent means "no visibility fact cached"
   * (a pre-visibility row, or a consumer that does not store it).
   */
  visibility?: Catalog[] | null;
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
  /**
   * When true, a fresh cache WITHOUT a visibility fact does not short-circuit
   * — `/seen` is called so the answer (status + visibility, §4.5) can be
   * cached whole. For consumers whose scope decisions ride on visibility (the
   * index's search). Default false: status-only consumers keep the plain TTL
   * behavior and never pay an extra call.
   */
  requireVisibility?: boolean;
}

export interface SeenIdentity {
  email: string;
  firebaseUid?: string | null;
  displayName?: string | null;
}

/**
 * The whole `/seen` answer (§4.5): status plus the EFFECTIVE visibility set,
 * already combined server-side — consumers apply it verbatim and never
 * recompute it from status. `visibility` is null only when the server's
 * answer lacked a clean array (a pre-§4.5 server) — callers then fall back
 * per §4.5's fail-closed rules, they do not guess.
 */
export interface SeenAnswer {
  status: EstateStatus;
  visibility: Catalog[] | null;
}

/**
 * POST /api/estate/seen. Returns the full answer, or null on ANY failure —
 * network, non-2xx, unparseable body, garbage status. The caller keeps its
 * stale cache on null (§5.2: "on failure: keep the stale values; count the
 * failure"). A missing/garbage `visibility` alone is NOT a failure: the
 * status half is still the status the directory holds.
 */
export async function postSeenAnswer(
  opts: SeenClientOptions,
  identity: SeenIdentity,
): Promise<SeenAnswer | null> {
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
    if (!isEstateStatus(status)) return null;
    const visibility = parseVisibility((body as { visibility?: unknown }).visibility);
    return { status, visibility };
  } catch {
    return null;
  }
}

/**
 * Status-only `/seen` — the original client, kept verbatim for consumers that
 * only gate (§4.5: "a consumer that reads only status is untouched").
 */
export async function postSeen(
  opts: SeenClientOptions,
  identity: SeenIdentity,
): Promise<EstateStatus | null> {
  const answer = await postSeenAnswer(opts, identity);
  return answer?.status ?? null;
}

export interface EstateCheckResult {
  /**
   * The status to feed `combineEstateAndLocal`. May be a stale cached value
   * (deliberate — §6 row 1); null means no answer exists at all.
   */
  status: EstateStatus | null;
  /**
   * The EFFECTIVE visibility riding with that status (§4.5's one-answer rule
   * — a cached status brings ITS cached visibility, never a fresher or staler
   * one). Null when no visibility fact exists for the answer used.
   */
  visibility: Catalog[] | null;
  /** True when `status` came from a cache older than the TTL (log it). */
  stale: boolean;
  /**
   * Non-null when a fresh answer arrived: persist these onto the app's cache
   * columns — visibility WITH status, the two never age separately.
   */
  refresh: { status: EstateStatus; visibility: Catalog[] | null; checkedAt: string } | null;
}

/**
 * The §5.2 protocol: use the cache while fresh; otherwise call `/seen`; on
 * failure fall back to the stale cache (or null when there is none). With
 * `opts.requireVisibility`, a fresh cache missing its visibility half is
 * treated as not-fresh-enough — one `/seen` call heals it into a whole
 * answer.
 */
export async function estateCheck(
  cache: SeenCache,
  identity: SeenIdentity,
  opts: SeenClientOptions,
  nowMs: number = Date.now(),
): Promise<EstateCheckResult> {
  const cachedVisibility = cache.visibility ?? null;
  const usableFresh =
    cache.status !== null &&
    cacheIsFresh(cache.checkedAt, nowMs) &&
    (!opts.requireVisibility || cachedVisibility !== null);
  if (usableFresh) {
    return { status: cache.status, visibility: cachedVisibility, stale: false, refresh: null };
  }

  const fresh = await postSeenAnswer(opts, identity);
  if (fresh !== null) {
    return {
      status: fresh.status,
      visibility: fresh.visibility,
      stale: false,
      refresh: { status: fresh.status, visibility: fresh.visibility, checkedAt: new Date(nowMs).toISOString() },
    };
  }

  // Estate unreachable (or answered garbage): keep the stale values —
  // visibility rides with its cached status (§4.5), never reconstructed.
  return {
    status: cache.status,
    visibility: cache.status !== null ? cachedVisibility : null,
    stale: cache.status !== null,
    refresh: null,
  };
}
