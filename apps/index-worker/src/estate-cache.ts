/**
 * The estate_cache table (migrations 0002 + 0003) — the index's stand-in for
 * the apps' cache columns on app_user (estate-auth-design.md §5.2). Read
 * before every gated request; written only when a fresh /seen answer arrives.
 *
 * Since 0003 the row carries the visibility set WITH the status — §4.5's
 * one-answer rule: the two share one checked_at and never age separately.
 * `visibility` is stored as the canonical JSON array and parsed defensively
 * on read (garbage → null, which scope logic treats as "no visibility fact").
 */

import { isEstateStatus, parseVisibility, type Catalog, type SeenCache } from '@platform/estate-auth';

export async function readEstateCache(db: D1Database, email: string): Promise<SeenCache> {
  const row = await db
    .prepare('SELECT status, checked_at, visibility FROM estate_cache WHERE email = ?')
    .bind(email)
    .first<{ status: string; checked_at: string; visibility: string | null }>();
  if (!row || !isEstateStatus(row.status)) return { status: null, checkedAt: null, visibility: null };
  return {
    status: row.status,
    checkedAt: row.checked_at,
    visibility: parseVisibilityText(row.visibility),
  };
}

/** The stored JSON array, validated back into a canonical set — or null. */
function parseVisibilityText(text: string | null | undefined): Catalog[] | null {
  if (typeof text !== 'string') return null;
  try {
    return parseVisibility(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Upsert the fresh answer — status and visibility together, one write.
 * `firebase_uid` is COALESCEd so a later token without a uid (the dev bypass
 * mints a fake one; a real token always carries `sub`) cannot erase a
 * recorded fact — the auth Worker's own /seen rule.
 */
export async function writeEstateCache(
  db: D1Database,
  entry: {
    email: string;
    firebaseUid: string | null;
    status: string;
    checkedAt: string;
    visibility: Catalog[] | null;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO estate_cache (email, firebase_uid, status, checked_at, visibility)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         status       = excluded.status,
         checked_at   = excluded.checked_at,
         visibility   = excluded.visibility,
         firebase_uid = COALESCE(excluded.firebase_uid, estate_cache.firebase_uid)`,
    )
    .bind(
      entry.email,
      entry.firebaseUid,
      entry.status,
      entry.checkedAt,
      entry.visibility === null ? null : JSON.stringify(entry.visibility),
    )
    .run();
}
