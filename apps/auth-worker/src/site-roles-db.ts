/**
 * D1 audit trail for the audiobook site-roles ladder (0005) — every
 * grant/revoke this Worker's POST /api/estate/site-roles ATTEMPTS, allowed
 * or refused. Separate concern from estate-db.ts on purpose (that file's
 * own header scopes it to "every statement that touches `estate_user`" —
 * this table is a different one).
 *
 * WHY THIS EXISTS: the Firestore `site_roles/{uid}` doc (site-roles.ts)
 * only ever holds the CURRENT grant's who/when (`grantedAt`/`grantedBy`) —
 * a PATCH overwrites the previous grant's stamp with no history. This table
 * is the durable, queryable history Firestore doesn't keep: who tried to
 * change whose role, from what to what, when, and whether it landed — the
 * same "3am rollback source of truth" instinct as `deploys.log`, and the
 * one place a denied escalation ATTEMPT (not just a successful grant) is
 * ever recorded.
 *
 * Best-effort, never load-bearing: a write here failing must never fail the
 * real request. The caller (site-roles.ts) wraps every call in try/catch
 * and logs to console.error on failure — Firestore remains the one source
 * of truth for CURRENT role state; this table only ever supplements it.
 */

export type GrantOutcome = 'granted' | 'revoked' | 'denied';

export interface GrantLogInput {
  actorEmail: string;
  actorRole: string;
  targetEmail: string;
  targetUid: string | null;
  /** The role the target held before this call, or null (guest/no doc). */
  previousRole: string | null;
  /** The role requested — null for a revoke. */
  requestedRole: string | null;
  outcome: GrantOutcome;
  /** Populated on 'denied' — the same detail string the 403 response carries. */
  reason?: string | null;
}

export async function logSiteRoleGrant(db: D1Database, input: GrantLogInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO site_role_grant_log
         (actor_email, actor_role, target_email, target_uid, previous_role, requested_role, outcome, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.actorEmail,
      input.actorRole,
      input.targetEmail,
      input.targetUid,
      input.previousRole,
      input.requestedRole,
      input.outcome,
      input.reason ?? null,
    )
    .run();
}
