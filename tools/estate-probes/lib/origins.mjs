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

/**
 * The SECOND library instance — "Sam's library" (`library_catalog`'s
 * `[env.friend]`: Worker `library-catalog-friend`, its own D1
 * `library-catalog-2nd` and bucket `library-2nd-covers`, hostname
 * `padhard.heygabi.ai`). SAME Worker code as LIBRARY_ORIGIN, which is
 * exactly why it earns probes: the code is identical, the DEPLOY is not, so
 * "library.heygabi.ai is healthy" says nothing about hers. Mirrored in
 * `sites/heygabi-home/public/status/status.js` (LIBRARY2_ORIGIN); if the
 * hostname ever moves, both move together.
 */
export const LIBRARY2_ORIGIN = 'https://padhard.heygabi.ai';

/**
 * The audiobook-worker's own hostname (2026-08-16, first deploy) — from
 * `apps/audiobook-worker/wrangler.toml`'s `routes` pattern, the canonical
 * source for that hostname (status.js does not list it yet). The SITE at
 * AUDIO_ORIGIN stays static; this is its API.
 */
export const AUDIOBOOK_API_ORIGIN = 'https://audiobook-api.heygabi.ai';

/**
 * The discord-worker (`apps/discord-worker`), live at `discord.heygabi.ai`.
 *
 * ⚠️ **This was `null` — the documented "one-line change" — for long after
 * the Worker actually deployed**, so the suite printed "not deployed yet
 * (expected)" every run while the Worker was serving GABI in production.
 * Switched on 2026-09-01. The lesson is the skip's own design: a visible SKIP
 * only stays honest if something makes it stop skipping, and nothing did.
 * A skip that has outlived its reason reads exactly like a passing suite.
 */
export const DISCORD_API_ORIGIN = 'https://discord.heygabi.ai';

/** The apex — the one origin every estate CORS allow-list admits. */
export const APEX_ORIGIN = 'https://heygabi.ai';
/** The audiobook static site — the ONE deliberately wider surface (ME_ORIGINS). */
export const AUDIOBOOK_SITE_ORIGIN = AUDIO_ORIGIN;
/** Not on any allow-list anywhere in the estate. Used to prove CORS refuses. */
export const FOREIGN_ORIGIN = 'https://evil.example';

/**
 * ⚠️ THE HEARTBEAT, NOT THE MANIFEST (changed 2026-08-17). `ebooks.json` is
 * gated now — gitignored, stripped from both deploy lanes, and served only via
 * audiobook-api.heygabi.ai behind the estate's `ebooks` grant. What stays
 * public is `ebooks_status.json`: counts and times, no book ever named.
 *
 * ⚠️ The probes that read this were the ones that CAUGHT the change, and they
 * caught it in the worst way — they were still PASSING against a Cloudflare
 * edge-cached copy of the file the deploy had just stripped. A green probe
 * against a stale cache is not evidence.
 */
/**
 * ⚠️ THE /dev/ LANE ON PURPOSE. status.js argues it and the same argument
 * holds here: /dev/ is written by EVERY pipeline run with no human in the
 * loop, so its age is the honest signal for lane health, while the prod copy
 * only moves when someone PROMOTES — its age measures promote cadence. A
 * probe suite that watched prod would go red for a week of un-promoted but
 * perfectly healthy runs.
 */
export const EBOOKS_HEARTBEAT_URL = `${AUDIO_ORIGIN}/dev/ebooks_status.json`;
/** The gated endpoint itself — probed UNAUTHENTICATED, and must refuse. */
export const EBOOKS_MANIFEST_GATED_URL = 'https://audiobook-api.heygabi.ai/api/ebooks/manifest';
/** ⚠️ The url that must NOT answer with a manifest any more. */
export const EBOOKS_MANIFEST_LEGACY_URL = `${AUDIO_ORIGIN}/ebooks.json`;

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
