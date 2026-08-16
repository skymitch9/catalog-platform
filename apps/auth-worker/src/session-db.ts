/**
 * The session table's data access (sso-design.md §4.3, migration
 * 0004_sessions.sql) — every statement that touches `estate_session`.
 *
 * Invariants, mirroring estate-db.ts's own list:
 *   - rows are never deleted, only revoked (`revoked_at` stamped) — a
 *     DELETE /api/session sign-out leaves a record that a session existed
 *     and when it ended, the same accountability argument as estate_user
 *   - the cookie is 30-DAY ROLLING (owner Q6): every successful
 *     POST /api/session/token bumps `last_used_at` AND `expires_at`
 *     forward, so an active device never silently expires mid-use
 */

export interface EstateSessionRow {
  id: string;
  email: string;
  firebase_uid: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
}

/** 30 days (owner Q6 — "worst case 7 on iOS" per §4.3's footnote is a browser behaviour, not this value). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const COLS = 'id, email, firebase_uid, created_at, last_used_at, expires_at, revoked_at';

export function expiresAtFrom(nowMs: number): string {
  return new Date(nowMs + SESSION_TTL_SECONDS * 1000).toISOString();
}

/** POST /api/session: a fresh interactive sign-in creates a NEW row — one per device, never an upsert. */
export async function createSession(
  db: D1Database,
  input: { id: string; email: string; firebaseUid: string },
): Promise<EstateSessionRow> {
  const nowIso = new Date().toISOString();
  const expiresAt = expiresAtFrom(Date.now());
  const row = await db
    .prepare(
      `INSERT INTO estate_session (id, email, firebase_uid, created_at, last_used_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       RETURNING ${COLS}`,
    )
    .bind(input.id, input.email, input.firebaseUid, nowIso, nowIso, expiresAt)
    .first<EstateSessionRow>();
  if (!row) throw new Error('createSession returned no row');
  return row;
}

export async function getSession(db: D1Database, id: string): Promise<EstateSessionRow | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM estate_session WHERE id = ?`).bind(id).first<EstateSessionRow>();
  return row ?? null;
}

/**
 * POST /api/session/token, on success: bump `last_used_at` and roll
 * `expires_at` forward another 30 days from now — the "rolling" half of
 * "30-day rolling" (owner Q6). The caller re-issues the cookie's Max-Age to
 * match in the same request, so the D1 row and the browser's cookie roll
 * forward together.
 */
export async function touchSession(db: D1Database, id: string): Promise<string> {
  const nowIso = new Date().toISOString();
  const expiresAt = expiresAtFrom(Date.now());
  await db
    .prepare(`UPDATE estate_session SET last_used_at = ?, expires_at = ? WHERE id = ?`)
    .bind(nowIso, expiresAt, id)
    .run();
  return expiresAt;
}

/** DELETE /api/session: soft-revoke — stamp, never delete (§4.2's estate_user reasoning, applied here). */
export async function revokeSession(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE estate_session SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`)
    .bind(id)
    .run();
}

/** A row is usable for minting when it exists, is not revoked, and has not expired. */
export function sessionIsLive(row: EstateSessionRow, nowMs: number = Date.now()): boolean {
  if (row.revoked_at !== null) return false;
  return Date.parse(row.expires_at) > nowMs;
}
