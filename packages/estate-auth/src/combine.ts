/**
 * The §3.1 combination table — the one sentence that defines the semantics:
 *
 * > The estate gates newcomers and enforces revocations; it never overrules a
 * > standing local approval except by explicit revocation.
 *
 * Every row fails in the direction design §2.2 chose: CLOSED for strangers
 * and the revoked, OPEN for the already-admitted household.
 */

export type EstateStatus = 'pending' | 'approved' | 'revoked';

export function isEstateStatus(v: unknown): v is EstateStatus {
  return v === 'pending' || v === 'approved' || v === 'revoked';
}

/** What the app's OWN user row says — the authorization layer, untouched. */
export interface LocalStanding {
  /** True when the local row carries an active role (anything beyond `pending`). */
  active: boolean;
  /**
   * True when a local decision was ever stamped (`approved_at IS NOT NULL`).
   * A local owner's explicit demotion is a standing decision the estate does
   * not overrule (§3.1 row 4).
   */
  locallyDecided: boolean;
}

export type EstateVerdict =
  /** Serve the request; local capabilities govern, as today. */
  | 'proceed'
  /**
   * Estate `approved`, local `pending` never locally decided: assign the
   * app's configured default role (config.defaultRole — the mapping the APP
   * owns, e.g. library `reader`, games `viewer`) and proceed. This is what
   * makes one approval estate-wide (§5.4).
   */
  | 'default_grant'
  /** Signed in, not admitted here: show the request screen, as today. */
  | 'request_screen'
  /**
   * 403, always — even for a local `owner`. Computed, never stored: the local
   * role is left intact so a later re-approval restores the person exactly.
   */
  | 'revoked'
  /**
   * Estate unreachable AND no admission to stand on: refused, fail closed,
   * with this NAMED verdict so an outage is distinguishable from a denial.
   */
  | 'estate_unreachable';

/**
 * Combine the estate's answer with the local row, per the §3.1 table.
 *
 * `estate` is the status from the cache or a fresh `/seen` call — a STALE
 * cached value is passed as-is (fail-open-on-stale-cache for the
 * already-admitted, §6 row 1). Pass `null` only when there is no answer at
 * all: the estate was unreachable and no cache exists.
 */
export function combineEstateAndLocal(
  estate: EstateStatus | null,
  local: LocalStanding,
): EstateVerdict {
  if (estate === 'revoked') return 'revoked';

  if (estate === 'approved') {
    if (local.active) return 'proceed';
    return local.locallyDecided ? 'request_screen' : 'default_grant';
  }

  if (estate === 'pending') {
    // Local wins: a standing local approval must not be locked out by
    // directory lag; the /seen call has already queued them estate-side.
    return local.active ? 'proceed' : 'request_screen';
  }

  // estate === null — unreachable, no cache. Open only for the admitted.
  return local.active ? 'proceed' : 'estate_unreachable';
}
