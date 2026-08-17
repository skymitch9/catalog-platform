/**
 * GET /api/estate/me — the answer about the caller's OWN membership, shaped
 * for a browser consumer and computed the same way /estate/seen computes its
 * answer (visibility.ts rules + the §4.3 OWNER_EMAILS break-glass):
 *
 *   status       'pending' | 'approved' | 'revoked' | null — null means "not
 *                in the directory", which is a legitimate answer, NEVER an
 *                error. /me enrols nobody (unlike /seen) and gates nothing
 *                (unlike the admin API).
 *   is_approver  the directory flag (or true for OWNER_EMAILS).
 *   visibility   the EFFECTIVE set (§4.5). A not-in-directory caller gets
 *                the public slice — the same thing the anonymous internet
 *                sees, so the answer never claims more than is already true.
 *
 * Pure — the route resolves the identity and fetches the row; this computes.
 */

import type { EstateUserRow } from './env.js';
import type { Catalog } from './visibility.js';
import { CATALOGS, PUBLIC_CATALOGS, effectiveVisibility } from './visibility.js';

export interface MeAnswer {
  status: 'pending' | 'approved' | 'revoked' | null;
  is_approver: boolean;
  /**
   * The estate DEVOPS capability (0003) as requireDevops() would honour it:
   * the raw flag OR'd with is_approver, because approvers hold every devops
   * surface implicitly. Reported EFFECTIVE (unlike is_approver, which is
   * raw) so browser consumers — the status page's Operations section, the
   * front door's Admin card — never re-derive the implication and drift.
   */
  is_devops: boolean;
  visibility: Catalog[];
}

export function meAnswer(row: EstateUserRow | null, isOwner: boolean): MeAnswer {
  if (isOwner) {
    // §4.3: OWNER_EMAILS is approved + approver REGARDLESS of table state,
    // and sees every catalog (`library2`'s DEFAULT 0 included — the owner is
    // that instance's operator) — break-glass cannot be narrowed into lockout.
    return { status: 'approved', is_approver: true, is_devops: true, visibility: [...CATALOGS] };
  }
  if (!row) {
    return { status: null, is_approver: false, is_devops: false, visibility: [...PUBLIC_CATALOGS] };
  }
  return {
    status: row.status,
    // The raw flag, deliberately not gated on status — requireApprover reads
    // the same flag, so /me reports exactly what the admin gate would honour.
    is_approver: row.is_approver === 1,
    is_devops: row.is_devops === 1 || row.is_approver === 1,
    visibility: effectiveVisibility(row.status, row),
  };
}
