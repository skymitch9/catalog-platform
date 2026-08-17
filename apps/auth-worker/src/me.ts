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
  /**
   * The EFFECTIVE ebook DOWNLOAD capability (0009) — `downloadEbooks()` below
   * is its ONE implementation. Reported effective (like is_devops, not like
   * is_approver) so no consumer re-derives the admin+ half and drifts.
   *
   * ⚠️ Download presupposes the `ebooks` grant and never substitutes for it:
   * a person can answer true here and still have no `ebooks` in `visibility`,
   * in which case the shelf refuses them and there is nothing to download.
   * Consumers check visibility FIRST, always.
   */
  download_ebooks: boolean;
}

/**
 * The owner's download model (2026-08-17), in one place:
 *
 *   "downloadEbook is a SIDE permission — admin+ hold it by default, and it
 *    is individually grantable to any person at any ladder level."
 *
 * So: the hand-granted column OR the estate's own admin+ notion. `is_approver`
 * IS the estate's admin (requireApprover gates every grant surface) and
 * OWNER_EMAILS sits above it. A consumer with its own ladder — the audiobook
 * Worker's 'admin'/'owner' rungs — ORs its rung in on top of this answer, for
 * the same reason: "admin+" means admin on EITHER ladder.
 *
 * ⚠️ Deliberately NOT gated on status. The visibility gate is what a revoked
 * or pending person hits (their effective set holds no `ebooks`); mixing the
 * two here would produce a capability answer that silently means two things.
 */
export function downloadEbooks(row: EstateUserRow | null, isOwner: boolean): boolean {
  if (isOwner) return true;
  if (!row) return false;
  return row.dl_ebooks === 1 || row.is_approver === 1;
}

export function meAnswer(row: EstateUserRow | null, isOwner: boolean): MeAnswer {
  if (isOwner) {
    // §4.3: OWNER_EMAILS is approved + approver REGARDLESS of table state,
    // and sees every catalog (`library2`'s and `ebooks`' DEFAULT 0 included —
    // the owner is the estate's operator) — the break-glass cannot be narrowed
    // into a lockout, and that now includes the ebook shelf and its downloads.
    return {
      status: 'approved',
      is_approver: true,
      is_devops: true,
      visibility: [...CATALOGS],
      download_ebooks: true,
    };
  }
  if (!row) {
    return {
      status: null,
      is_approver: false,
      is_devops: false,
      visibility: [...PUBLIC_CATALOGS],
      download_ebooks: false,
    };
  }
  return {
    status: row.status,
    // The raw flag, deliberately not gated on status — requireApprover reads
    // the same flag, so /me reports exactly what the admin gate would honour.
    is_approver: row.is_approver === 1,
    is_devops: row.is_devops === 1 || row.is_approver === 1,
    visibility: effectiveVisibility(row.status, row),
    download_ebooks: downloadEbooks(row, false),
  };
}
