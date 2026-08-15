/**
 * estate-scan.js — the ONE canonical scanning module for the estate:
 * barcode detection, camera capture, ISBN resolution, and shelf/cover photo
 * capture + identification. Framework-agnostic, no build step, no component
 * dependency — <estate-search> (assets/estate-search.js) imports this for its
 * 📷 barcode button and its "scan a shelf" photo button rather than owning
 * any of the scanning logic itself.
 *
 * ⚠️ THE CONTRACT: change scanning HERE and nowhere else. Every export below
 * is independently usable — a future consumer that wants only ISBN
 * resolution, or only the camera helper, imports just that piece. Nothing
 * here reaches into the DOM outside of the <video>/<canvas> elements handed
 * to it, and nothing here is Shadow-DOM- or estate-search-specific.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SHAPE (owner: "make sure this feature is normalized — so if we
 * ever need to change scanning again we don't need to rebuild it")
 * ---------------------------------------------------------------------------
 * The proven approach — barcode detection that actually works on the owner's
 * iPhone — lives in the sibling `library_catalog` repo
 * (apps/web/src/lib/scanner.ts + camera.ts, apps/worker/src/lib/vision.ts,
 * packages/core/src/{isbn,vision}.ts). It is PORTED HERE, not re-derived, and
 * this file is now the canonical home going forward: library_catalog (and
 * the board-game catalog, if it grows a scanner) are expected to eventually
 * retire their own copies onto this one via the sync-module mechanism that
 * already carries assets/estate-theme.css and assets/estate-search.js's
 * groupBySeries() to those repos (scripts/sync-estate-*.mjs precedent). See
 * docs/info/estate-scan-adoption.md for the sized adoption plan — not done in
 * this pass; the bookstore deadline ruled it out.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PONYFILL AND NOT `window.BarcodeDetector`
 * ---------------------------------------------------------------------------
 * `BarcodeDetector` is not usable on iOS: it has been flag-only since Safari
 * 17, the flag has been broken since iOS 18, and neither Safari 26 nor the 27
 * beta ship it (verified against library_catalog's scanner.ts, which carries
 * the same finding and the same citation). Every browser on iOS is WebKit, so
 * Chrome and Firefox on an iPhone fail identically. This module therefore
 * NEVER feature-detects `window.BarcodeDetector` — it always loads the
 * zxing-wasm ponyfill, on every platform, so behaviour is identical
 * everywhere and the one path that has been proven on the owner's phone (in
 * library_catalog's real shelf-scanning sessions) is the only path that ever
 * runs.
 *
 * The ponyfill + its wasm are VENDORED under assets/scanner/ (MIT-licensed,
 * see the LICENSE-*.txt files there) rather than fetched from a CDN — the
 * estate's CSP is `script-src 'self'` and `connect-src` is an explicit
 * allow-list, so a jsDelivr fetch (the package's own default `locateFile`)
 * would be silently blocked. `_loadDetector()` below overrides `locateFile`
 * to point at the co-located wasm file instead, exactly as library_catalog's
 * scanner.ts does.
 *
 * WebAssembly compilation itself additionally needs `'wasm-unsafe-eval'` in
 * script-src under a CSP this strict (default-src 'none') — see _headers.
 *
 * ---------------------------------------------------------------------------
 * EXPORTS
 * ---------------------------------------------------------------------------
 * Camera:
 *   cameraPlausible()            → bool, check before showing a camera button
 *   CameraError                  → class, .reason is one of the CameraFailure
 *                                   strings below
 *   openRearCamera()             → Promise<MediaStream>, MUST be called from
 *                                   a user gesture
 *   closeCamera(stream)          → stop every track (iOS keeps the light on
 *                                   otherwise)
 *   captureFrame(video, longEdge)→ Promise<CapturedPhoto>, downscaled JPEG as
 *                                   base64 (no data: prefix), from a LIVE
 *                                   <video> frame
 *   downscaleImagePhoto(file, longEdge) → Promise<CapturedPhoto>, same shape
 *                                   as captureFrame's, from a picked/dropped
 *                                   image File/Blob instead of a live video
 *                                   frame — the shelf-scan "photo/upload"
 *                                   path (a native file input, capture=
 *                                   "environment", opens the camera directly
 *                                   on mobile and a picker on desktop, so no
 *                                   second camera-stream UI is needed here).
 *
 * Barcode:
 *   preloadBarcodeDetector()     → warm the wasm while the user points the
 *                                   camera; fire-and-forget
 *   startBarcodeScanLoop(opts)   → run a decode loop against a live <video>;
 *                                   returns a stop function. opts:
 *                                     { video, onScan({code,format}), onError,
 *                                       confirmations = 2, ignore(code) }
 *                                   onScan only fires for a checksum-valid
 *                                   978/979 Bookland EAN-13 — a price add-on
 *                                   or a retail UPC is skipped silently and
 *                                   scanning continues (see classifyBarcode).
 *   classifyBarcode(raw)         → { kind: 'isbn13', isbn13 } |
 *                                   { kind: 'ignore', reason }. SCANNER-only:
 *                                   EAN-13/Bookland, silent on anything else
 *                                   (the scan loop's contract is "keep
 *                                   scanning", never a UI complaint).
 *   parseIsbnQuery(raw)          → what a TYPED/pasted search-box string
 *                                   looks like as an ISBN, if anything —
 *                                   the search-bar ISBN upgrade (owner: "why
 *                                   can we not just search an isbn?"),
 *                                   distinct from classifyBarcode because a
 *                                   person typing gets to see WHY a clearly
 *                                   ISBN-shaped string didn't resolve.
 *                                   Accepts ISBN-10 too (ported from
 *                                   library_catalog packages/core/src/
 *                                   isbn.ts's isValidIsbn10/toIsbn13), not
 *                                   just EAN-13. Returns:
 *                                     { kind: 'isbn13', isbn13 }   — complete,
 *                                       checksum-valid (10 upconverted to 13)
 *                                     { kind: 'invalid' }          — clearly
 *                                       ISBN-shaped (13 digits, 978/979
 *                                       prefix) but the checksum fails —
 *                                       worth a quiet hint, not a lookup
 *                                     { kind: 'not_isbn' }         — anything
 *                                       else, including a bare 10-digit
 *                                       string (phone numbers, IDs) and any
 *                                       partial/incomplete digit run — plain
 *                                       text search, unchanged, and NEVER an
 *                                       Open Library call.
 *
 * ISBN resolution:
 *   resolveIsbn(isbn, opts?)     → Promise<{title, author} | null>. Exactly
 *                                   two fetches (openlibrary.org/isbn/{isbn}
 *                                   .json, then the first author's record) —
 *                                   never more. Returns null on an unknown
 *                                   ISBN or a network failure; never throws
 *                                   for that case.
 *
 * Shelf/cover photo identification:
 *   identifyPhoto(photo, opts)   → Promise<ShelfReading>. POSTs a captured
 *                                   photo to a members-only vision endpoint
 *                                   (opts.endpoint, opts.idToken) and returns
 *                                   the books it read. Throws IdentifyError on
 *                                   a non-2xx response — callers render
 *                                   .message.
 *
 * Add to catalog:
 *   addToCatalog(isbn13, opts)   → Promise<{job,index,line,duplicate}>. POSTs
 *                                   to the library app's OWN barcode-intake
 *                                   endpoint (opts.endpoint, opts.idToken) —
 *                                   queues the ISBN for review rather than
 *                                   guessing at a direct catalog-write
 *                                   payload. Throws IdentifyError on a
 *                                   non-2xx response.
 */

// ===========================================================================
// Barcode classification — ported from library_catalog packages/core/src/isbn.ts
// (the "book gate": accept nothing but a checksum-valid 978/979 EAN-13, keep
// scanning on anything else — a price add-on or a retail UPC must never be
// looked up).
// ===========================================================================

function digitsOnly(raw) {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function ean13CheckDigit(first12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = first12.charCodeAt(i) - 48;
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
}

function isValidIsbn13(raw) {
  const s = digitsOnly(raw);
  if (!/^\d{13}$/.test(s)) return false;
  return ean13CheckDigit(s.slice(0, 12)) === s.charCodeAt(12) - 48;
}

function isBooklandEan13(raw) {
  const s = digitsOnly(raw);
  return /^97[89]\d{10}$/.test(s) && isValidIsbn13(s);
}

/**
 * ISBN-10 check: weights 10..1, modulo 11, with X standing for 10. Ported
 * from library_catalog packages/core/src/isbn.ts::isValidIsbn10 — needed
 * because pre-2007 books print only this, and the search-bar ISBN upgrade
 * (below) has to accept them too, not just Bookland EAN-13.
 */
function isValidIsbn10(raw) {
  const s = digitsOnly(raw);
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (s.charCodeAt(i) - 48) * (10 - i);
  const last = s[9] === 'X' ? 10 : s.charCodeAt(9) - 48;
  return (sum + last) % 11 === 0;
}

/** ISBN-10 → ISBN-13: prefix 978, drop the old check digit, recompute. Caller must have already validated the ISBN-10. */
function isbn10ToIsbn13(isbn10) {
  const body = '978' + digitsOnly(isbn10).slice(0, 9);
  return body + String(ean13CheckDigit(body));
}

/**
 * What a scanned code actually is. One function so the camera loop cannot
 * disagree with itself about whether a code is worth a lookup.
 */
export function classifyBarcode(raw) {
  const trimmed = String(raw).trim();
  const s = digitsOnly(trimmed);

  // The price add-on: five digits, printed beside the real barcode, and the
  // single most common thing a sweep locks onto by mistake.
  if (/^\d{5}$/.test(s)) return { kind: 'ignore', reason: 'price_addon' };

  if (isBooklandEan13(s)) return { kind: 'isbn13', isbn13: s };

  // A well-formed EAN-13 that is not 978/979 is a retail UPC — a real code
  // for a real product, which is exactly why it must not be looked up.
  if (/^\d{13}$/.test(s) && isValidIsbn13(s)) return { kind: 'ignore', reason: 'not_bookland' };

  return { kind: 'ignore', reason: 'unrecognised' };
}

/**
 * What a TYPED/pasted search-box string looks like as an ISBN, if anything.
 * See the module header for the three-way result — this is the search-bar
 * ISBN upgrade, not the scanner: a person typing gets to see WHY a clearly
 * ISBN-shaped string didn't resolve, which classifyBarcode's silent-ignore
 * contract deliberately does not offer (a scan loop cannot pop up a message
 * mid-sweep; a search box can).
 */
export function parseIsbnQuery(raw) {
  const trimmed = String(raw).trim();
  const s = digitsOnly(trimmed);

  if (s.length === 13) {
    if (isBooklandEan13(s)) return { kind: 'isbn13', isbn13: s };
    // "Clearly ISBN-shaped": 13 digits, 978/979 prefix, but the checksum is
    // wrong — worth a quiet hint. Any OTHER 13-digit number (a phone number,
    // a random count) says nothing on its own and falls through silently.
    if (/^97[89]\d{10}$/.test(s)) return { kind: 'invalid' };
    return { kind: 'not_isbn' };
  }

  if (s.length === 10) {
    if (isValidIsbn10(s)) return { kind: 'isbn13', isbn13: isbn10ToIsbn13(s) };
    // A bare 10-digit string is common on its own (IDs, phone numbers) and
    // is not "clearly ISBN-shaped" the way a 978/979-prefixed 13-digit run
    // is — stay quiet, fall through to an ordinary text search.
    return { kind: 'not_isbn' };
  }

  // Any other length, including every partial digit run mid-type: plain
  // text search, and — the load-bearing rule — NEVER an Open Library call.
  return { kind: 'not_isbn' };
}

// ===========================================================================
// Camera — ported from library_catalog apps/web/src/lib/camera.ts, trimmed to
// what a live barcode scan and a shelf-photo capture both need.
// ===========================================================================

export class CameraError extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

/** True when getUserMedia can even exist here. Check before showing a button. */
export function cameraPlausible() {
  return window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function explainCameraError(err) {
  const name = err?.name || '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError('denied', 'Camera access was blocked. Allow it for this site, then try again.');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('no-camera', 'No rear camera was available on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('in-use', 'The camera is busy. Close other apps or tabs using it, then try again.');
    default:
      return new CameraError('unknown', `Could not start the camera: ${String(err)}`);
  }
}

/**
 * Open the rear camera. MUST be called from a user gesture.
 *
 * `exact` on facingMode is tried first so we never end up on the selfie
 * camera, then relaxed — some devices refuse `exact`.
 */
export async function openRearCamera() {
  if (!window.isSecureContext) {
    throw new CameraError('insecure-context', 'The camera needs a secure (https) connection.');
  }
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
    throw new CameraError('unsupported', 'This browser does not support camera capture.');
  }
  const wide = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: 'environment' }, ...wide },
      audio: false,
    });
  } catch (err) {
    if (err?.name !== 'OverconstrainedError') throw explainCameraError(err);
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', ...wide },
        audio: false,
      });
    } catch (relaxed) {
      throw explainCameraError(relaxed);
    }
  }
}

/** Stop every track. iOS keeps the camera light on until you do. */
export function closeCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function fit(width, height, longEdge) {
  const longest = Math.max(width, height);
  if (longest <= longEdge) return { w: width, h: height };
  const scale = longEdge / longest;
  return { w: Math.round(width * scale), h: Math.round(height * scale) };
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new CameraError('unknown', 'Could not read the captured photo.'));
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1)); // strip "data:image/jpeg;base64,"
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Grab the current video frame, downscale it, and encode it once as JPEG.
 * Used by the shelf/cover photo path — a live frame grab, never the photo
 * library, so nothing this module does ever writes to the device.
 */
export async function captureFrame(video, longEdge, quality = 0.85) {
  const sw = video.videoWidth;
  const sh = video.videoHeight;
  if (!sw || !sh) throw new CameraError('unknown', 'The camera has not produced a frame yet.');

  const { w, h } = fit(sw, sh, longEdge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CameraError('unknown', 'Could not get a drawing context.');

  try {
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new CameraError('unknown', 'Could not encode the photo.');
    return { data: await toBase64(blob), mediaType: 'image/jpeg', width: w, height: h, bytes: blob.size };
  } finally {
    // iOS does not reliably garbage-collect canvases; shrink before dropping.
    canvas.width = 1;
    canvas.height = 1;
  }
}

/**
 * Same shape as captureFrame's result, from a picked/dropped image File/Blob
 * instead of a live video frame — the shelf-scan "photo/upload" path. A
 * `<input type="file" accept="image/*" capture="environment">` opens the
 * camera directly on mobile (or the gallery/file picker, OS-dependent) and a
 * plain file picker on desktop, so this is the ONE path that covers both
 * without a second camera-stream UI.
 */
export async function downscaleImagePhoto(file, longEdge, quality = 0.85) {
  if (!(file instanceof Blob)) throw new CameraError('unknown', 'That is not an image file.');

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CameraError('unknown', 'Could not read that photo.');
  }

  try {
    const { w, h } = fit(bitmap.width, bitmap.height, longEdge);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new CameraError('unknown', 'Could not get a drawing context.');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new CameraError('unknown', 'Could not encode the photo.');
    return { data: await toBase64(blob), mediaType: 'image/jpeg', width: w, height: h, bytes: blob.size };
  } finally {
    bitmap.close?.();
  }
}

// ===========================================================================
// Barcode detector — self-hosted zxing-wasm ponyfill (see the module header
// for why never window.BarcodeDetector). Vendored under ./scanner/.
// ===========================================================================

const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let detectorPromise = null;

async function loadDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const scannerBase = new URL('./scanner/', import.meta.url);
      const { BarcodeDetector, prepareZXingModule } = await import(
        /* @vite-ignore */ new URL('barcode-detector.ponyfill.js', scannerBase).href
      );
      const wasmUrl = new URL('zxing_reader.wasm', scannerBase).href;
      prepareZXingModule({
        overrides: { locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) },
        fireImmediately: false,
      });
      return new BarcodeDetector({ formats: BARCODE_FORMATS });
    })().catch((err) => {
      detectorPromise = null; // let the next attempt retry rather than caching a failure forever
      throw err;
    });
  }
  return detectorPromise;
}

/** Warm the wasm while the user is still pointing the camera. Fire-and-forget. */
export function preloadBarcodeDetector() {
  void loadDetector().catch(() => undefined);
}

/**
 * Run a decode loop against a live video element. Returns a stop function.
 *
 * `confirmations` (default 2): how many consecutive identical reads are
 * required before `onScan` fires — costs a few hundred ms and removes almost
 * every misread. `ignore(code)` lets the caller skip a code that is already
 * being handled (e.g. mid-resolve) without breaking its confirmation streak
 * logic for the NEXT code.
 */
export function startBarcodeScanLoop({ video, onScan, onError, confirmations = 2, ignore }) {
  let stopped = false;
  let busy = false;
  let lastCode = '';
  let streak = 0;
  let rafId = 0;
  let lastRun = 0;

  async function tick() {
    if (stopped || busy) return;
    if (video.readyState < 2 || !video.videoWidth) return;

    busy = true;
    try {
      const detector = await loadDetector();
      const results = await detector.detect(video);
      for (const result of results) {
        const classified = classifyBarcode(result.rawValue);
        if (classified.kind !== 'isbn13') continue; // the book gate — keep scanning
        const code = classified.isbn13;
        if (ignore?.(code)) continue;

        if (code === lastCode) streak += 1;
        else {
          lastCode = code;
          streak = 1;
        }

        if (streak >= confirmations) {
          stopped = true;
          onScan({ code, format: result.format });
          return;
        }
      }
    } catch (err) {
      onError?.(err);
    } finally {
      busy = false;
    }
  }

  function scheduleRaf() {
    if (stopped) return;
    rafId = requestAnimationFrame((now) => {
      // ~10 decodes/sec is plenty and keeps older phones responsive.
      if (now - lastRun < 100) {
        scheduleRaf();
        return;
      }
      lastRun = now;
      void tick().finally(scheduleRaf);
    });
  }
  scheduleRaf();

  return () => {
    stopped = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
}

// ===========================================================================
// ISBN resolution — the public Open Library API, two fetches max.
// ===========================================================================

/**
 * Resolve an ISBN to a title/author. Exactly two fetches: the edition, then
 * (only if the edition names one) its first author. Never throws for an
 * unknown ISBN or a network failure — callers render "Not identified — try
 * the title" on a null return, per the estate's fail-politely rule.
 */
export async function resolveIsbn(isbn, { signal } = {}) {
  const clean = digitsOnly(isbn);
  let book;
  try {
    const res = await fetch(`https://openlibrary.org/isbn/${clean}.json`, { signal });
    if (!res.ok) return null;
    book = await res.json();
  } catch {
    return null;
  }
  if (!book || typeof book.title !== 'string') return null;

  let author = null;
  const authorKey = book.authors?.[0]?.key;
  if (authorKey) {
    try {
      const res = await fetch(`https://openlibrary.org${authorKey}.json`, { signal });
      if (res.ok) {
        const authorDoc = await res.json();
        if (typeof authorDoc?.name === 'string') author = authorDoc.name;
      }
    } catch {
      // Second fetch is a bonus, not load-bearing — a title with no author
      // name is still a usable resolve.
    }
  }

  return { title: book.title, author };
}

// ===========================================================================
// Shelf/cover photo identification — the members-only vision endpoint.
//
// ⚠️ The actual reading (Claude vision, structured output, refuse-when-
// unreadable) happens SERVER-SIDE — see catalog-platform apps/index-worker
// /api/scan/shelf, which ports library_catalog apps/worker/src/lib/vision.ts
// + packages/core/src/vision.ts's SHELF_SYSTEM/SHELF_SCHEMA verbatim. This
// function is the client-side call: capture (captureFrame, above) → POST →
// a list of {text, author, confidence, note} per spine/cover the model could
// read. It does no catalog matching — the caller runs its own scoped search
// per identified title (estate-search.js does this via _runSearch), which is
// how the estate's normal own-it/not-owned answer is reused instead of
// re-derived.
// ===========================================================================

export class IdentifyError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * @param photo    {data, mediaType} — from captureFrame(), base64 with no
 *                 data: prefix.
 * @param opts     { endpoint, idToken, kind = 'shelf' | 'cover', signal }
 *                 idToken is required — the endpoint is members-only (vision
 *                 costs money); a caller with no token should not call this,
 *                 and should show a sign-in prompt on the button instead.
 */
export async function identifyPhoto(photo, { endpoint, idToken, kind = 'shelf', signal } = {}) {
  if (!endpoint) throw new IdentifyError('No scan endpoint configured.', 0);
  if (!idToken) throw new IdentifyError('Sign in to read a shelf photo.', 401);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ data: photo.data, mediaType: photo.mediaType, kind }),
      signal,
    });
  } catch {
    throw new IdentifyError('The scan endpoint did not answer (network). Try again shortly.', 0);
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body; the status still speaks
  }

  if (!res.ok) {
    throw new IdentifyError(body?.detail || body?.error || `Scan failed (${res.status}).`, res.status);
  }
  return {
    books: Array.isArray(body?.books) ? body.books : [],
    unreadable: Boolean(body?.unreadable),
  };
}

// ===========================================================================
// Add to catalog — reuses the library app's OWN barcode-intake endpoint
// (apps/worker/src/routes/scan-jobs.ts `POST /api/scan-jobs/barcode` in
// library_catalog) rather than assembling a `createWork` payload from
// scratch. That endpoint already runs the full, proven ISBN ladder and
// dedup logic library_catalog's own scan tab uses — a barcode alone cannot
// honestly supply the fields (format, publisher, …) a direct catalog-write
// endpoint requires, so reusing the real intake path is the faithful port,
// not a shortcut. The response is a `scan_job` line, not yet a finished
// catalog work — same persistence-first design as the library's own ScanPage
// ("close the phone, come back, the books are still there"), so the honest
// affordance is "queue it", with a link to the library's own Add screen to
// finish the review.
// ===========================================================================

/**
 * @param isbn13   the resolved ISBN (from resolveIsbn / a barcode scan).
 * @param opts     { endpoint = 'https://library.heygabi.ai/api/scan-jobs/barcode',
 *                   idToken, jobId = null, allowDuplicate = false, signal }
 *                 idToken is the SAME Firebase ID token estate-search.js's
 *                 authed mode already mints — the library Worker verifies it
 *                 against the same Firebase project and checks the caller's
 *                 own `scan` capability, same as a signed-in library user.
 * @returns        { job, index, line, duplicate } — the exact shape
 *                  library_catalog's own api.scanBarcode() returns.
 */
export async function addToCatalog(
  isbn13,
  { endpoint = 'https://library.heygabi.ai/api/scan-jobs/barcode', idToken, jobId = null, allowDuplicate = false, signal } = {},
) {
  if (!idToken) throw new IdentifyError('Sign in to add to the catalog.', 401);

  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ code: isbn13, jobId, allowDuplicate }),
      signal,
    });
  } catch {
    throw new IdentifyError('The library did not answer (network). Try again shortly.', 0);
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error body; the status still speaks
  }

  if (!res.ok) {
    throw new IdentifyError(body?.detail || body?.error || `Add failed (${res.status}).`, res.status);
  }
  return body;
}
