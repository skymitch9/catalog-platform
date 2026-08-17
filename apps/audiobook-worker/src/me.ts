/**
 * GET /api/me — the read-only answer about the CALLER (migration design
 * Phase 0): `{role, capabilities, estate}`, computed server-side so the
 * client renders exactly the controls the caller can use (§1e: controls the
 * role cannot use are not rendered) instead of re-deriving ladder logic.
 *
 * Pure — the route (index.ts) resolves identity, estate status and the
 * stored role; this composes the answer. That split is what makes every
 * decision path testable without a service account or a live directory.
 */

import { effectiveLadderRole, type LadderRole } from '../../auth-worker/src/role-ladder.js';
import type { EstateStatus } from '@platform/estate-auth';
import { capabilitiesFor, type Capability } from './capabilities.js';
import type { EstateCheckMode } from './env.js';

export interface MeAnswer {
  signedIn: true;
  email: string;
  /** The EFFECTIVE ladder role — after the enforce-mode revocation demotion. */
  role: LadderRole;
  capabilities: Capability[];
  estate: {
    mode: EstateCheckMode;
    /** null = not in the directory / estate not consulted (mode 'off' or unconfigured). */
    status: EstateStatus | null;
    /** True when the status came from a cache older than the TTL. */
    stale: boolean;
  };
}

/**
 * The §3 combination, verbatim from the design:
 *
 *   effectiveRole = estate revoked → guest; else ladder(site_roles doc)
 *
 * with two deliberate qualifications:
 *  - The demotion applies in ENFORCE mode only. Shadow must change no
 *    behaviour by construction (§4), and Phase 2 renders UI from this
 *    answer — a shadow-mode demotion would BE a behaviour change.
 *  - 'owner' is never demoted (OWNER_EMAILS or a stray stored doc): the
 *    break-glass cannot be revoked into a lockout, the same rule
 *    clearSiteRoleOnRevocation enforces on the grant side.
 *
 * The estate status is reported alongside either way, so the client and the
 * owner can SEE a revocation the current mode does not yet act on.
 */
export function meAnswer(input: {
  email: string;
  ownerEmails: readonly string[];
  /** The raw stored site_roles role string, or null (no doc = guest). */
  storedRole: string | null;
  mode: EstateCheckMode;
  estateStatus: EstateStatus | null;
  estateStale: boolean;
}): MeAnswer {
  const ladder = effectiveLadderRole({
    email: input.email,
    ownerEmails: input.ownerEmails,
    storedRole: input.storedRole,
  });
  const role: LadderRole =
    input.mode === 'enforce' && input.estateStatus === 'revoked' && ladder !== 'owner'
      ? 'guest'
      : ladder;
  return {
    signedIn: true,
    email: input.email,
    role,
    capabilities: capabilitiesFor(role),
    estate: { mode: input.mode, status: input.estateStatus, stale: input.estateStale },
  };
}
