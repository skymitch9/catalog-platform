/**
 * The LISTENING budget — audio player phase 1, 2026-08-18.
 *
 * ⚠️ **A SIBLING OF `read-budget.ts`, NOT A REUSE OF IT, AND THAT IS FORCED
 * RATHER THAN PREFERRED.** `read-budget.ts` keeps its counters in a
 * module-level `Map`. Calling `chargeRead()` from an audio route would put
 * hours of range requests into the same buckets an EPUB's page turns use, so
 * a long listen would exhaust the reader's budget and a heavy reading session
 * would stall the player — two features with different sizings sharing one
 * counter. The estate's rule is one canonical implementation of anything that
 * makes a decision; this makes a DIFFERENT decision, on different numbers, so
 * it is a different module with its own state.
 *
 * The design flagged this in advance (`docs/info/audio-player-design.md` §7.5):
 * *"`read-budget.ts` allows 12 anchors / 600 requests per 5 minutes, sized on
 * ~15 range GETs per open. That sizing is wrong for audio in both directions…
 * a per-request cap here would throttle listening."*
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ARITHMETIC — every input MEASURED, the conclusion REASONED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **Inputs (MEASURED 2026-08-17, design §1.3 + §13's filesystem sweep):**
 *
 * | | |
 * |---|---|
 * | Mean book runtime | **13.72 h** (1,079 catalog rows, `duration_hhmm` parsed) |
 * | Mean file size | **601 MB** (1,073 files on disk, 630 GB total) |
 * | Bitrate | **bimodal** — roughly half at ~64 kbps, half at ~127 kbps |
 *
 * **Step 1 — bytes per window.** 601 MB over 13.72 h is
 * `601e6 / (13.72 × 3600)` = **12,168 B/s** (~97 kbps), which agrees with the
 * bimodal ffprobe sample and so is a real cross-check rather than a
 * restatement. A 5-minute window (300 s) of continuous playback is therefore:
 *
 *   - mean book, 1×:                    3.65 MB
 *   - the HIGH-bitrate half, 1×:        4.76 MB  (127 kbps = 15,875 B/s)
 *   - the high half at **3×** speed:   14.29 MB  (the owner's top speed, §6)
 *
 * **Step 2 — requests per window.** A media element fetches in chunks. The
 * chunk size is the browser's business and was NOT measured here, so the
 * arithmetic uses a deliberately PESSIMISTIC **256 KiB** — smaller than any
 * media chunk observed in the wild, chosen to over-count requests:
 *
 *   14.29 MB ÷ 256 KiB = **≈ 55 requests** per window of worst-case playback.
 *
 * **Step 3 — seeks, which dominate.** Every seek is a fresh range request and
 * some browsers issue two (a probe, then the stream). ⚠️ This feature INVITES
 * seeking: a chapter-relative scrub bar, ±15 s buttons, a chapter list and
 * lock-screen `seekto` are six seek paths (design §8). A person jabbing one
 * every 3 seconds for a whole window is **100 seeks ⇒ 200 requests** — absurd
 * for a human, which is the point of sizing against it.
 *
 * **Step 4 — the total, doubled for two devices.** 55 + 200 = 255 per tab;
 * a phone and a laptop signed in as the same person = **≈ 510**.
 *
 * **Step 5 — the number.** Round 510 up to **1,200**, i.e. 4 requests/second
 * sustained for five minutes.
 *
 * ⚠️ **WHY A CAP AT ALL, GIVEN A LISTENER CANNOT REACH IT.** It is a
 * runaway-LOOP guard, not a scraper deterrent (that is the anchor axis below).
 * `range.ts` answers a MALFORMED `Range` with a 200 — correct HTTP, and here
 * it means one client off-by-one is a **601 MB** download (3.92 GB on the
 * largest book). A retry loop does hundreds of requests a second; 1,200 stops
 * it inside ~3 seconds while a real listener never comes within 2×.
 *
 * ⚠️ **Failure-mode direction, inherited verbatim from the ebook budget:**
 * a too-tight request cap presents as *"the audio stalls in the middle of a
 * chapter"*, which reads as a broken player rather than as a limit. **Raise
 * this before ever lowering it.**
 *
 * ⏳ **NOT YET MEASURED, and design §7.5 asks for it:** no real listening
 * session has been observed through this route. Phase 2 must count the actual
 * requests one hour of playback makes, on Safari and on Chrome, and re-derive
 * both numbers from that. Until then every figure above is arithmetic over
 * measured inputs — which is not the same as a measurement.
 *
 * ## Per ISOLATE, in memory — the same deliberate trade `read-budget.ts` makes
 *
 * This Worker has no database. A caller spread across N isolates gets up to N
 * budgets. That is fine for the threat and it is stated rather than hidden:
 * ⚠️ **never make this the security story.** The security story is the estate
 * grant, checked on every single range.
 */

/** The window every counter rolls over on. */
export const LISTEN_WINDOW_MS = 5 * 60 * 1000;

/**
 * Distinct books one caller may OPEN in a window.
 *
 * ⚠️ **6, not the ebook route's 12, and the reasoning does not carry over.**
 * The ebook number was sized to make a 168-file scrape take over an hour. That
 * argument is void here: the audio corpus is 630 GB, so a scraper's wall is
 * bandwidth, not request count — 12 books × a 601 MB mean is 7.2 GB per five
 * minutes, which nothing about a smaller number makes meaningfully harder.
 *
 * So this axis is sized against the LISTENER instead. A listener opens **one**
 * book and stays in it for hours; sampling three or four in a sitting is the
 * widest honest use of this site. 6 leaves a 50–100% margin over that, and
 * refusing the seventh is a worded 429 with a `Retry-After`, never a silence.
 *
 * ⚠️ Ranges WITHIN an already-opened book are free on this axis. That clause
 * is what makes a 13.7-hour listen possible at all — removing it turns every
 * long book into a refusal.
 */
export const LISTEN_DISTINCT_BOOKS_PER_WINDOW = 6;

/** Total byte requests one caller may make in a window. See the arithmetic. */
export const LISTEN_REQUESTS_PER_WINDOW = 1200;

interface ListenBucket {
  /** Epoch ms at which this window opened. */
  openedAt: number;
  requests: number;
  books: Set<string>;
}

const buckets = new Map<string, ListenBucket>();

/** Tests only — per-isolate state the suite must be able to drop. */
export function resetListenBudget(): void {
  buckets.clear();
}

export type ListenVerdict =
  | { ok: true }
  /** `retryAfterSec` is what the 429's `Retry-After` header must carry. */
  | { ok: false; reason: 'too_many_books' | 'too_many_requests'; retryAfterSec: number };

/**
 * Charge one byte request to `key` (the caller's verified email) for `anchor`.
 *
 * ⚠️ Charged on the way IN, before the bytes are read, so a caller hammering a
 * 404 or a 416 still pays. A budget that only counted successes would be a
 * free probe of which books the household holds.
 */
export function chargeListen(
  key: string,
  anchor: string,
  nowMs: number = Date.now(),
): ListenVerdict {
  const existing = buckets.get(key);
  const bucket =
    existing && nowMs - existing.openedAt < LISTEN_WINDOW_MS
      ? existing
      : { openedAt: nowMs, requests: 0, books: new Set<string>() };
  buckets.set(key, bucket);

  const retryAfterSec = Math.max(
    1,
    Math.ceil((bucket.openedAt + LISTEN_WINDOW_MS - nowMs) / 1000),
  );

  if (bucket.requests >= LISTEN_REQUESTS_PER_WINDOW) {
    return { ok: false, reason: 'too_many_requests', retryAfterSec };
  }
  if (
    !bucket.books.has(anchor) &&
    bucket.books.size >= LISTEN_DISTINCT_BOOKS_PER_WINDOW
  ) {
    return { ok: false, reason: 'too_many_books', retryAfterSec };
  }

  bucket.requests += 1;
  bucket.books.add(anchor);
  return { ok: true };
}
