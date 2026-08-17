/**
 * The directory's data access — every statement that touches `estate_user`.
 *
 * The invariants live here so no route can miss one:
 *   - emails are lowercased before any read or write (design §1.4)
 *   - `/seen`'s upsert NEVER changes `status` (§4.4)
 *   - rows are never deleted (§4.2 — revocation must survive re-sign-in)
 *   - every status change stamps decided_at / decided_by
 */

import type { EstateUserRow } from './env.js';
import type { Catalog } from './visibility.js';
import { visibilityToFlags } from './visibility.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const COLS =
  'id, email, firebase_uid, display_name, status, is_approver, is_devops, origin, note, first_seen_at, decided_at, decided_by, ' +
  'vis_audiobook, vis_library, vis_games, vis_library2, vis_ebooks, dl_ebooks';

export async function getUserByEmail(db: D1Database, email: string): Promise<EstateUserRow | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM estate_user WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<EstateUserRow>();
  return row ?? null;
}

export async function getUserById(db: D1Database, id: number): Promise<EstateUserRow | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM estate_user WHERE id = ?`).bind(id).first<EstateUserRow>();
  return row ?? null;
}

/**
 * The `/seen` upsert (§4.4): unknown email → create `pending` with
 * origin 'seen:<app>'; known → refresh uid/name only. ⚠️ NEVER touches
 * `status` — one statement, so there is no code path that could.
 */
export async function seenUpsert(
  db: D1Database,
  input: {
    email: string;
    firebaseUid: string | null;
    displayName: string | null;
    app: string;
  },
): Promise<EstateUserRow> {
  const email = normalizeEmail(input.email);
  const upsert = `INSERT INTO estate_user (email, firebase_uid, display_name, origin)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       firebase_uid = COALESCE(excluded.firebase_uid, estate_user.firebase_uid),
       display_name = COALESCE(excluded.display_name, estate_user.display_name)
     RETURNING ${COLS}`;
  try {
    const row = await db
      .prepare(upsert)
      .bind(email, input.firebaseUid, input.displayName, `seen:${input.app}`)
      .first<EstateUserRow>();
    if (!row) throw new Error('upsert returned no row');
    return row;
  } catch (err) {
    // The one conflict ON CONFLICT(email) cannot absorb: a NEW email arriving
    // with a firebase_uid already recorded on another row (an account's email
    // changed). Record the new email without the contested uid rather than
    // failing the sign-in; the old row keeps the uid, nothing joins on it.
    if (input.firebaseUid && /UNIQUE/i.test((err as Error).message)) {
      const row = await db
        .prepare(upsert)
        .bind(email, null, input.displayName, `seen:${input.app}`)
        .first<EstateUserRow>();
      if (!row) throw new Error('upsert returned no row');
      return row;
    }
    throw err;
  }
}

/** Admin list: pending first (the queue), then approved, then revoked. */
export async function listUsers(db: D1Database): Promise<EstateUserRow[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM estate_user
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
                first_seen_at DESC, id DESC`,
    )
    .all<EstateUserRow>();
  return results;
}

/**
 * Approve / revoke. Stamps decided_at / decided_by; status only, never a role.
 * `visibility`, when given (approval-time narrowing, §4.5), sets the stored
 * set in the same statement — one decision, one write.
 */
export async function decideStatus(
  db: D1Database,
  input: { id: number; status: 'approved' | 'revoked'; actorId: number; visibility?: Catalog[] },
): Promise<EstateUserRow | null> {
  // ⚠️ REVOKING CLEARS THE POWERS, NOT JUST THE STATUS (owner decision
  // 2026-08-16 — the demotion/revocation design, decisions 1 and 2).
  //
  // This UPDATE used to set `status` alone and leave `is_approver` /
  // `is_devops` untouched. A testing audit found the consequence:
  // `requireApprover()` checked only the flag, so a REVOKED approver kept
  // passing the very gate that had just shut on them, and could re-approve
  // themselves. That gate now checks status too (middleware/auth.ts); this is
  // the other half, so the flag never outlives the status in the first place.
  // Two independent barriers, deliberately — the audit showed what one is
  // worth when nobody tests it.
  //
  // The deeper reason is the owner's own rule that access-REDUCING acts
  // immediately while access-INCREASING is confirmed. A revoked row that keeps
  // its flags means the NEXT approval silently hands power back that nobody
  // consciously granted. Owner, asked directly: *"they need to reearn all
  // rights."* So re-approval restores MEMBERSHIP, never powers — achieved not
  // by special-casing approval, but by there being nothing left to restore.
  //
  // The row is still never deleted (0001's stance): a revoked person who comes
  // back meets their revocation, not a fresh queue entry.
  //
  // ⚠️ D1 ONLY. The ladder role lives in Firestore `site_roles/{uid}` and
  // cannot be cleared in this statement. D1 is the gate that actually admits
  // people, so it is cleared FIRST and does not depend on the Firestore half
  // landing; the route follows up separately and logs either way.
  const clearPowers = input.status === 'revoked' ? ', is_approver = 0, is_devops = 0' : '';

  if (input.visibility) {
    const f = visibilityToFlags(input.visibility);
    const row = await db
      .prepare(
        `UPDATE estate_user
         SET status = ?, vis_audiobook = ?, vis_library = ?, vis_games = ?, vis_library2 = ?, vis_ebooks = ?,
             decided_at = datetime('now'), decided_by = ?${clearPowers}
         WHERE id = ?
         RETURNING ${COLS}`,
      )
      .bind(
        input.status,
        f.vis_audiobook,
        f.vis_library,
        f.vis_games,
        f.vis_library2,
        f.vis_ebooks,
        input.actorId,
        input.id,
      )
      .first<EstateUserRow>();
    return row ?? null;
  }
  const row = await db
    .prepare(
      `UPDATE estate_user
       SET status = ?, decided_at = datetime('now'), decided_by = ?${clearPowers}
       WHERE id = ?
       RETURNING ${COLS}`,
    )
    .bind(input.status, input.actorId, input.id)
    .first<EstateUserRow>();
  return row ?? null;
}

/**
 * Set the STORED visibility set (§4.5) — narrowing or re-widening after
 * approval. Stamped like a status decision: who changed what a member can
 * see, and when, must be reconstructible. Never touches status.
 */
export async function setVisibility(
  db: D1Database,
  input: { id: number; visibility: Catalog[]; actorId: number },
): Promise<EstateUserRow | null> {
  const f = visibilityToFlags(input.visibility);
  const row = await db
    .prepare(
      `UPDATE estate_user
       SET vis_audiobook = ?, vis_library = ?, vis_games = ?, vis_library2 = ?, vis_ebooks = ?,
           decided_at = datetime('now'), decided_by = ?
       WHERE id = ?
       RETURNING ${COLS}`,
    )
    .bind(
      f.vis_audiobook,
      f.vis_library,
      f.vis_games,
      f.vis_library2,
      f.vis_ebooks,
      input.actorId,
      input.id,
    )
    .first<EstateUserRow>();
  return row ?? null;
}

/**
 * Flip `dl_ebooks` (0009) — the per-person ebook DOWNLOAD grant. Deliberately
 * its OWN statement rather than a field on setVisibility(): the two answer
 * different questions ("may you see the shelf" / "may you take the file"), and
 * a combined write would make it impossible to change one without restating
 * the other. Stamped like every decision; never touches status or visibility.
 *
 * ⚠️ This writes only the HAND-GRANTED half. The admin+ half of the owner's
 * model is computed at read time (me.ts's downloadEbooks) and must never be
 * materialised here — 0009's header argues why storing it would survive a
 * demotion, which is exactly what 0006 exists to prevent.
 */
export async function setDownloadEbooks(
  db: D1Database,
  input: { id: number; downloadEbooks: boolean; actorId: number },
): Promise<EstateUserRow | null> {
  const row = await db
    .prepare(
      `UPDATE estate_user
       SET dl_ebooks = ?, decided_at = datetime('now'), decided_by = ?
       WHERE id = ?
       RETURNING ${COLS}`,
    )
    .bind(input.downloadEbooks ? 1 : 0, input.actorId, input.id)
    .first<EstateUserRow>();
  return row ?? null;
}

/**
 * Flip `is_approver` — the admin-API promotion path (owner decision #4:
 * no redeploy to add an approver). Stamped like a status decision: who
 * granted approval rights, and when, must be reconstructible.
 */
export async function setApprover(
  db: D1Database,
  input: { id: number; isApprover: boolean; actorId: number },
): Promise<EstateUserRow | null> {
  const row = await db
    .prepare(
      `UPDATE estate_user
       SET is_approver = ?, decided_at = datetime('now'), decided_by = ?
       WHERE id = ?
       RETURNING ${COLS}`,
    )
    .bind(input.isApprover ? 1 : 0, input.actorId, input.id)
    .first<EstateUserRow>();
  return row ?? null;
}

/**
 * Flip `is_devops` (0003, owner order 2026-08-15) — the estate-page
 * capability grant, in setApprover's exact mold: stamped, reconstructible,
 * granted from the /admin UI and nowhere else routine.
 */
export async function setDevops(
  db: D1Database,
  input: { id: number; isDevops: boolean; actorId: number },
): Promise<EstateUserRow | null> {
  const row = await db
    .prepare(
      `UPDATE estate_user
       SET is_devops = ?, decided_at = datetime('now'), decided_by = ?
       WHERE id = ?
       RETURNING ${COLS}`,
    )
    .bind(input.isDevops ? 1 : 0, input.actorId, input.id)
    .first<EstateUserRow>();
  return row ?? null;
}

/**
 * Manual pre-seed (owner UI-first rule, 2026-08-14): an approver adds a
 * person BY EMAIL from the /admin page before their first sign-in, so no
 * people-operation needs a script. Origin 'manual', status pending (the
 * approver then approves them — two visible decisions, like every other
 * admission). Idempotent on conflict: an existing row (any status) is
 * returned untouched — pre-seeding must never resurrect a revocation or
 * demote an approval.
 */
export async function manualCreate(
  db: D1Database,
  input: { email: string; actorId: number },
): Promise<{ row: EstateUserRow; created: boolean }> {
  const email = normalizeEmail(input.email);
  const existing = await getUserByEmail(db, email);
  if (existing) return { row: existing, created: false };
  const row = await db
    .prepare(
      `INSERT INTO estate_user (email, origin, note)
       VALUES (?, 'manual', ?)
       ON CONFLICT(email) DO UPDATE SET email = estate_user.email
       RETURNING ${COLS}`,
    )
    .bind(email, `added by estate admin (actor id ${input.actorId})`)
    .first<EstateUserRow>();
  if (!row) throw new Error('manualCreate returned no row');
  return { row, created: true };
}

/**
 * Materialize a row for an `OWNER_EMAILS` actor acting on a directory that
 * has never seen them (§4.3's bootstrap meeting the table). Approved +
 * approver because OWNER_EMAILS IS that authority; origin 'manual' and the
 * note say exactly where the row came from.
 */
export async function materializeOwnerRow(
  db: D1Database,
  input: { email: string; firebaseUid: string | null; displayName: string | null },
): Promise<EstateUserRow> {
  const insert = `INSERT INTO estate_user
         (email, firebase_uid, display_name, status, is_approver, origin, note, decided_at)
       VALUES (?, ?, ?, 'approved', 1, 'manual', 'auto-created: OWNER_EMAILS actor', datetime('now'))
       ON CONFLICT(email) DO UPDATE SET email = estate_user.email
       RETURNING ${COLS}`;
  try {
    const row = await db
      .prepare(insert)
      .bind(normalizeEmail(input.email), input.firebaseUid, input.displayName)
      .first<EstateUserRow>();
    if (!row) throw new Error('materializeOwnerRow returned no row');
    return row;
  } catch (err) {
    // Same class seenUpsert absorbs: the owner's uid already recorded on
    // ANOTHER row (an account's email changed — or every dev-bypass identity
    // sharing the module's fixed 'dev-uid', which is how this was found:
    // the index Worker's live probes 500'd the BREAK-GLASS path, the worst
    // possible place to 500). Materialize without the contested uid rather
    // than refusing the owner; nothing joins on uid (design §1.4).
    if (input.firebaseUid && /UNIQUE/i.test((err as Error).message)) {
      const row = await db
        .prepare(insert)
        .bind(normalizeEmail(input.email), null, input.displayName)
        .first<EstateUserRow>();
      if (!row) throw new Error('materializeOwnerRow returned no row');
      return row;
    }
    throw err;
  }
}

/** Health: row counts by status, no emails (§4.4). */
export async function statusCounts(
  db: D1Database,
): Promise<{ pending: number; approved: number; revoked: number; approvers: number }> {
  const { results } = await db
    .prepare(
      `SELECT status, COUNT(*) AS n, SUM(is_approver) AS approvers
       FROM estate_user GROUP BY status`,
    )
    .all<{ status: string; n: number; approvers: number | null }>();
  const counts = { pending: 0, approved: 0, revoked: 0, approvers: 0 };
  for (const r of results) {
    if (r.status === 'pending') counts.pending = r.n;
    if (r.status === 'approved') counts.approved = r.n;
    if (r.status === 'revoked') counts.revoked = r.n;
    counts.approvers += r.approvers ?? 0;
  }
  return counts;
}
