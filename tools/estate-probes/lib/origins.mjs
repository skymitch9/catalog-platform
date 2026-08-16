/**
 * The estate's production hosts and the two probe origins every CORS check
 * uses. Lifted verbatim from `sites/heygabi-home/public/status/status.js`
 * (the status page already names these as the estate's canonical surfaces)
 * so this suite and that page can never quietly drift onto different URLs.
 */

export const AUTH_ORIGIN = 'https://auth.heygabi.ai';
export const INDEX_ORIGIN = 'https://index.heygabi.ai';
export const LIBRARY_ORIGIN = 'https://library.heygabi.ai';
export const GAMES_ORIGIN = 'https://boardgames.heygabi.ai';
export const AUDIO_ORIGIN = 'https://audiobooks.heygabi.ai';

/** The apex — the one origin every estate CORS allow-list admits. */
export const APEX_ORIGIN = 'https://heygabi.ai';
/** The audiobook static site — the ONE deliberately wider surface (ME_ORIGINS). */
export const AUDIOBOOK_SITE_ORIGIN = AUDIO_ORIGIN;
/** Not on any allow-list anywhere in the estate. Used to prove CORS refuses. */
export const FOREIGN_ORIGIN = 'https://evil.example';

export const EBOOKS_MANIFEST_URL = `${AUDIO_ORIGIN}/ebooks.json`;

/**
 * The one public Firestore document (`firestore.rules`: `allow read: if
 * true` on `pipeline_status/current`), read the same way the status page
 * does — a plain signed-out REST GET, no SDK, no key.
 */
export const FIRESTORE_STATUS_URL =
  'https://firestore.googleapis.com/v1/projects/audiobook-catalog/databases/(default)/documents/pipeline_status/current';

/**
 * The shelf-server force-upload's own doc (2026-08-16, `allow read: if
 * true` mirroring pipeline_status/current) — status.js's
 * SHELF_UPLOAD_STATUS_URL. Legitimately 404 until the control has ever run
 * once (the shelf server does not exist yet); the probe checks the READ is
 * permitted, not that a document exists.
 */
export const SHELF_UPLOAD_STATUS_URL =
  'https://firestore.googleapis.com/v1/projects/audiobook-catalog/databases/(default)/documents/shelf_upload_status/current';

/** A token shaped like a bearer but signed by nobody — the garbage-token probe. */
export const GARBAGE_BEARER = 'Bearer garbage-token-not-a-real-jwt-af93k2';
