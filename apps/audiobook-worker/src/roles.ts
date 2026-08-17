/**
 * Firestore reads this Worker makes with the service account — the ROLE doc
 * and (for club-scoped gates) a club doc's managerUids. Reads only; Phase 0/1
 * write nothing anywhere (the first worker-owned writes are Phase 3).
 *
 * ## Scope declaration
 * This Worker mints DATASTORE-scoped tokens only. It never resolves uids
 * from emails (the caller's uid arrives inside their verified token), so
 * unlike auth-worker it has no business holding the identitytoolkit scope.
 *
 * ## The role cache
 * `site_roles/{uid}` is cached per-uid for REVOCATION_DELAY_MS (10 min) —
 * the estate's convention: the TTL *is* the revocation delay (migration
 * design §3). Failures are never cached, and a real Firestore failure is
 * never swallowed into "no doc" — it comes back as a discriminated failure
 * so callers answer honestly instead of silently treating an outage as
 * 'guest' (the site-roles.ts rule, kept).
 *
 * ## Lanes
 * `site_roles` is deliberately UNSUFFIXED (design §1: every collection has a
 * `_dev` twin EXCEPT site_roles and pipeline_*). Club docs do have lanes —
 * `clubCollectionFor()` picks `clubs` / `clubs_dev` from the reported lane.
 */

import {
  firestoreRequest,
  mintAccessToken,
  SCOPE_DATASTORE,
  type ServiceAccount,
} from '@platform/firebase-sa';
import { REVOCATION_DELAY_MS } from '@platform/estate-auth';

/** This Worker's whole credential power, declared once, greppable. */
export const SA_SCOPES = SCOPE_DATASTORE;

export type StoredRoleResult =
  | { ok: true; role: string | null }
  | { ok: false; status: number };

/**
 * Read the raw stored `role` string for a uid's site_roles doc — null when
 * there is no doc (a legal, common state: guest). Mirrors auth-worker's
 * readStoredRole verbatim; callers feed the answer to effectiveLadderRole.
 */
export async function readStoredRole(
  sa: ServiceAccount,
  token: string,
  uid: string,
): Promise<StoredRoleResult> {
  const res = await firestoreRequest(sa, token, 'GET', `site_roles/${encodeURIComponent(uid)}`);
  if (res.status === 404) return { ok: true, role: null };
  if (!res.ok) return { ok: false, status: res.status };
  const doc = (await res.json()) as { fields?: { role?: { stringValue?: string } } };
  return { ok: true, role: doc.fields?.role?.stringValue ?? null };
}

/** Per-isolate role cache: uid → stored role string (null = no doc). */
const roleCache = new Map<string, { role: string | null; at: number }>();

/** Tests only — a per-isolate cache is state the suite must be able to drop. */
export function resetRoleCache(): void {
  roleCache.clear();
}

/**
 * readStoredRole through the 10-minute cache. Only SUCCESSFUL answers are
 * cached (an outage must be retried, not remembered); the TTL is
 * REVOCATION_DELAY_MS on purpose — a revoked-then-cleared role doc stops
 * answering within the estate's standing revocation delay.
 */
export async function cachedStoredRole(
  sa: ServiceAccount,
  uid: string,
  nowMs: number = Date.now(),
): Promise<StoredRoleResult> {
  const hit = roleCache.get(uid);
  if (hit && nowMs - hit.at < REVOCATION_DELAY_MS) return { ok: true, role: hit.role };
  const token = await mintAccessToken(sa, SA_SCOPES);
  const read = await readStoredRole(sa, token, uid);
  if (read.ok) roleCache.set(uid, { role: read.role, at: nowMs });
  return read;
}

/** clubs / clubs_dev — from the client-reported lane, never guessed wider. */
export function clubCollectionFor(lane: 'prod' | 'dev'): string {
  return lane === 'dev' ? 'clubs_dev' : 'clubs';
}

/**
 * Is `uid` in the club doc's managerUids? Missing club, missing field, or
 * any Firestore failure all answer FALSE — for the shadow gate this errs
 * toward would_deny:true, which is the honest direction for telemetry (a
 * false "would allow" could green-light an enforce flip that then denies).
 *
 * ⚠️ managerUids is a MAP of uid → {role, displayName, claimedAt} — that is
 * what clubs.js createClub/claimManagerRole write and what firestore.rules
 * checks (`club.managerUids is map`, `request.auth.uid in club.managerUids`;
 * both measured 2026-08-16). The first cut of this function read it as an
 * arrayValue of uid strings, which matches NO production club doc — every
 * real club manager measured as club_manager:false in the shadow tail
 * (over-reporting would_deny, the "honest direction" above, but still
 * wrong). Fixed 2026-08-16 during the Phase 3 prebuild: mapValue keys are
 * the real shape; the arrayValue reading is kept as a fallback so nothing
 * that ever wrote an array shape is silently dropped.
 */
export async function isClubManager(
  sa: ServiceAccount,
  clubCollection: string,
  clubId: string,
  uid: string,
): Promise<boolean> {
  try {
    const token = await mintAccessToken(sa, SA_SCOPES);
    const res = await firestoreRequest(
      sa,
      token,
      'GET',
      `${clubCollection}/${encodeURIComponent(clubId)}`,
    );
    if (!res.ok) return false;
    const doc = (await res.json()) as {
      fields?: {
        managerUids?: {
          mapValue?: { fields?: Record<string, unknown> };
          arrayValue?: { values?: Array<{ stringValue?: string }> };
        };
      };
    };
    const mapFields = doc.fields?.managerUids?.mapValue?.fields;
    if (mapFields && Object.prototype.hasOwnProperty.call(mapFields, uid)) return true;
    const values = doc.fields?.managerUids?.arrayValue?.values ?? [];
    return values.some((v) => v.stringValue === uid);
  } catch {
    return false;
  }
}
