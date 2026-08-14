/**
 * The estate_cache table (migration 0002) — the index's stand-in for the
 * apps' two cache columns on app_user (estate-auth-design.md §5.2). Read
 * before every gated request; written only when a fresh /seen answer arrives.
 */

import { isEstateStatus, type SeenCache } from '@platform/estate-auth';

export async function readEstateCache(db: D1Database, email: string): Promise<SeenCache> {
  const row = await db
    .prepare('SELECT status, checked_at FROM estate_cache WHERE email = ?')
    .bind(email)
    .first<{ status: string; checked_at: string }>();
  if (!row || !isEstateStatus(row.status)) return { status: null, checkedAt: null };
  return { status: row.status, checkedAt: row.checked_at };
}

/**
 * Upsert the fresh answer. `firebase_uid` is COALESCEd so a later token
 * without a uid (the dev bypass mints a fake one; a real token always carries
 * `sub`) cannot erase a recorded fact — the auth Worker's own /seen rule.
 */
export async function writeEstateCache(
  db: D1Database,
  entry: { email: string; firebaseUid: string | null; status: string; checkedAt: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO estate_cache (email, firebase_uid, status, checked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         status       = excluded.status,
         checked_at   = excluded.checked_at,
         firebase_uid = COALESCE(excluded.firebase_uid, estate_cache.firebase_uid)`,
    )
    .bind(entry.email, entry.firebaseUid, entry.status, entry.checkedAt)
    .run();
}
