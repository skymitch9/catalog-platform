/**
 * POST /api/scan/shelf — the shelf/cover-photo identify endpoint
 * (docs/info/estate-scan-adoption.md, the barcode build's deliberately
 * deferred second deploy).
 *
 * ⚠️ AUTH DOES NOT LIVE IN THIS FILE, AND THAT IS DELIBERATE — same rule as
 * read.ts: this route is estate-members-only, enforced by the
 * `requireEstateMember()` blanket in index.ts mounted BEFORE this router.
 * That gate matters MORE here than on any other route in this Worker — this
 * is the one endpoint that spends real money per call (vision.ts's own
 * header), so an anonymous caller must get the sign-in prompt, never a free
 * shot at the model.
 *
 * This is deliberately a thin route: validate the body, call readShelf(),
 * translate a VisionError to the right status. No D1 read, no D1 write — the
 * estate apex has no per-catalog work table to match a spine against, so
 * matching is the CLIENT's job (it re-runs <estate-search>'s own
 * `_runSearch()` once per identified title through this Worker's existing
 * /api/search). See vision.ts's own header for the full list of deltas from
 * library_catalog's version.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { billingRefusal } from './billing-gate.js';
import type { ScopeVariables } from './middleware/scope.js';
import { isPhotoMediaType, readShelf, VisionError, type Photo } from './vision.js';

export const scanRoutes = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

/**
 * Base64 byte ceiling on the wire. Matches library_catalog's own
 * MAX_PHOTO_BYTES (packages/core/src/scan.ts) — 5MB of DECODED image, so the
 * base64 string (≈4/3 the decoded size) is capped a third higher. The client
 * (estate-scan.js's captureFrame) already downscales to ~1600px before
 * upload; this is a server-side guard against a caller that skips the
 * client, not the primary size control.
 */
const MAX_DECODED_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_DECODED_PHOTO_BYTES * 4) / 3);

interface ScanShelfBody {
  data?: unknown;
  mediaType?: unknown;
  kind?: unknown;
}

scanRoutes.post('/scan/shelf', async (c) => {
  let body: ScanShelfBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', detail: 'expected a JSON body with data, mediaType, kind' }, 400);
  }

  const { data, mediaType, kind } = body;
  if (typeof data !== 'string' || data.length === 0) {
    return c.json({ error: 'missing_photo', detail: 'body.data must be a non-empty base64 string (no data: prefix)' }, 400);
  }
  if (data.length > MAX_BASE64_LENGTH) {
    return c.json(
      {
        error: 'photo_too_large',
        detail: 'That photo is too large. The scanner already downscales before upload — try again, or a closer/lower-resolution shot.',
      },
      413,
    );
  }
  if (typeof mediaType !== 'string' || !isPhotoMediaType(mediaType)) {
    return c.json({ error: 'bad_media_type', detail: 'body.mediaType must be image/jpeg, image/png or image/webp' }, 400);
  }
  if (kind !== undefined && kind !== 'shelf' && kind !== 'cover') {
    return c.json({ error: 'bad_kind', detail: 'body.kind must be "shelf" or "cover" (defaults to "shelf")' }, 400);
  }

  const photo: Photo = { data, mediaType };

  // ⚠️ BILLING POLICY (E6 / `scan.photo`), and it is ANDed IN FRONT OF NOTHING
  // THAT WAS REMOVED: `requireEstateMember()` is still mounted on /api/* in
  // index.ts and still runs before this handler. Policy can only DENY — it has
  // never opened this route and must never start.
  //
  // ⚠️ Placed AFTER the body validation and BEFORE readShelf(), deliberately.
  // A malformed request should get its own 400 rather than a policy refusal it
  // would still meet after fixing the body; and the refusal must land before
  // the one call in this Worker that costs money.
  //
  // Ships inert: BILLING_POLICY is "off" in wrangler.toml.
  const refusal = billingRefusal(c, 'scan.photo', 'The photo scanner', '$5/$25 per MTok');
  if (refusal) return c.json(refusal.body, refusal.status);

  try {
    const reading = await readShelf(c.env.ANTHROPIC_API_KEY, photo, kind === 'cover' ? 'cover' : 'shelf');
    // Deliberately NOT forwarding inputTokens/outputTokens/estimatedCents —
    // that is operator telemetry (worth a server log), not something a
    // scanning member's browser needs to render. identifyPhoto() in
    // estate-scan.js only reads `books` and `unreadable`.
    console.log(
      `scan/shelf: kind=${kind === 'cover' ? 'cover' : 'shelf'} books=${reading.books.length} unreadable=${reading.unreadable} est=${reading.estimatedCents.toFixed(3)}c`,
    );
    return c.json({ books: reading.books, unreadable: reading.unreadable });
  } catch (err) {
    if (err instanceof VisionError) {
      // VisionError.status is already the right HTTP status for the failure
      // (503 misconfigured/rejected key, 422 refusal, 502 truncated/bad
      // parse, 429 rate limited, 413 too large for the model).
      return c.json({ error: 'vision_failed', detail: err.message, retryable: err.retryable }, err.status as 400 | 401 | 403 | 413 | 422 | 429 | 502 | 503);
    }
    console.error('scan/shelf unhandled', err);
    return c.json({ error: 'internal', detail: err instanceof Error ? err.message : String(err) }, 500);
  }
});
