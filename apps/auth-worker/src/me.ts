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
// ⚠️ The dev-access OR is imported, never re-written here. One implementation
// of a capability decision (0011's header); middleware/auth.ts is where the
// estate's three predicates live side by side so none of them can drift.
import { devAccessAllows } from './middleware/auth.js';
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
  /**
   * DEV-LANE ACCESS (0011, owner 2026-08-17) — the EFFECTIVE answer, computed
   * by the ONE implementation, `devAccessAllows()` in middleware/auth.ts:
   * `approved AND (dev_access OR is_devops OR is_approver)`, or OWNER_EMAILS.
   * Reported effective for the same reason `is_devops` is: a browser consumer
   * that re-derived *"devops implies dev access"* locally would be a second
   * implementation of the owner's rule, free to drift.
   *
   * ⚠️ Note it is STATUS-GATED where `is_devops` above is not. That is not an
   * oversight in either direction: this field answers what a GATE would honour
   * (devopsAllows()'s stance), which is the only useful thing to tell a page
   * deciding whether to draw itself.
   *
   * ⚠️ CURTAIN, NOT LOCK. The /dev/ lane's ebook pages read this to decide
   * between drawing themselves and drawing a worded curtain. The bytes stay
   * locked by `vis_ebooks` on the audiobook Worker's manifest/stream APIs, on
   * both lanes — a `true` here has never opened a file and must never start.
   */
  dev_access: boolean;
  visibility: Catalog[];
  /**
   * BILLING POLICY (0016, 2026-09-02) — the money paths this person may not
   * spend on, PER SITE, already resolved.
   *
   * ⚠️ CURTAIN, NOT LOCK (§3.4). It decides whether a button is DRAWN. It never
   * decides whether a call is served — the Worker resolves that itself off
   * `/seen`, because a check the caller performs is a check the caller can skip.
   *
   * ⚠️ A PER-SITE MAP, where the design's §3.4 says *"the same array"*, and the
   * departure is deliberate: `/me` has no site. Its origins are the apex AND
   * the audiobook site, and "is the cover button drawn" is a different question
   * on library than on games. A flat union would hide a control on a site where
   * it is allowed. Since it is a curtain either way, the extra detail costs
   * nothing and removes a guess.
   *
   * ⚠️ An OWNER's map is empty everywhere, computed and never stored — the same
   * break-glass rule `status` and `visibility` follow.
   */
  billing_denied: Record<string, string[]>;
  /*
   * ⚠️ NO `download_ebooks` FIELD, and no `downloadEbooks()` function beneath
   * this interface. Both existed for one day (2026-08-17) and were removed the
   * same day by owner directive: *"For ebooks I don't want a download check
   * box, I want to use roles we have. Set up the roles to match library."*
   *
   * The estate answers WHO MAY SEE a catalog — `visibility` including
   * `ebooks`, which covers reading in the browser viewer. Whether a person may
   * take the FILE away is now a rung on the audiobook site's own ladder
   * (`apps/audiobook-worker/src/capabilities.ts`: `download` floors at
   * `admin`), resolved by that Worker from its `site_roles` doc. This answer
   * has nothing to say about it, so it says nothing.
   */
}

const NO_DENIALS: Record<string, string[]> = {
  library: [],
  library2: [],
  games: [],
  audiobook: [],
  estate: [],
};

/**
 * ⚠️ `billingDenied` is passed IN, resolved, rather than computed here. This
 * module is pure by design (its header says so) and the resolution needs the
 * rule table; the route reads D1 and hands the answer over, exactly as it
 * already hands over the row.
 */
export function meAnswer(
  row: EstateUserRow | null,
  isOwner: boolean,
  billingDenied: Record<string, string[]> = NO_DENIALS,
): MeAnswer {
  if (isOwner) {
    // §4.3: OWNER_EMAILS is approved + approver REGARDLESS of table state,
    // and sees every catalog (`library2`'s and `ebooks`' DEFAULT 0 included —
    // the owner is the estate's operator) — the break-glass cannot be narrowed
    // into a lockout, and that now includes the ebook shelf. (Downloading FROM
    // that shelf is the audiobook ladder's question since 2026-08-17;
    // OWNER_EMAILS forces `owner` there too, so the break-glass still holds end
    // to end — it just holds in the other system.)
    return {
      status: 'approved',
      is_approver: true,
      is_devops: true,
      dev_access: devAccessAllows(row, true),
      visibility: [...CATALOGS],
      // The break-glass cannot be narrowed into a lockout — not by visibility
      // (above) and not by a spending switch either.
      billing_denied: { ...NO_DENIALS },
    };
  }
  if (!row) {
    return {
      status: null,
      is_approver: false,
      is_devops: false,
      dev_access: devAccessAllows(null, false),
      visibility: [...PUBLIC_CATALOGS],
      // Not in the directory: no row, so no `user` rule can name them and no
      // `role` rule is resolvable. `everyone` rules still reach them, which is
      // what the caller passed in.
      billing_denied: billingDenied,
    };
  }
  return {
    status: row.status,
    // The raw flag, deliberately not gated on status — requireApprover reads
    // the same flag, so /me reports exactly what the admin gate would honour.
    is_approver: row.is_approver === 1,
    is_devops: row.is_devops === 1 || row.is_approver === 1,
    dev_access: devAccessAllows(row, false),
    visibility: effectiveVisibility(row.status, row),
    billing_denied: billingDenied,
  };
}
