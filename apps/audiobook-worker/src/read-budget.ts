/**
 * The reading budget — viewer design §3.5, sized against MEASURED reader
 * traffic rather than a guessed number.
 *
 * ## The threat, stated honestly
 *
 * It is **not** a stranger: nobody reaches this code without a verified
 * Firebase token AND the estate's `vis_ebooks` grant. It is **a household
 * member scripting all 168 books**. That is not a security breach — they are
 * entitled to the bytes — it is a bandwidth and R2 Class-B event, and the
 * design says to price it as one.
 *
 * ## So the limit is on BOOKS, not on requests
 *
 * ⚠️ This is the whole design decision and it is easy to get backwards. A
 * naive per-request cap would throttle READING, because reading is request-
 * heavy by construction:
 *
 *   - foliate-js + zip.js opened the 393 MiB omnibus in **15 range GETs**
 *     (measured 2026-08-17, epub-streaming-findings), and every chapter turn
 *     adds more;
 *   - pdf.js issues several ranges per page turn.
 *
 * A scraper, by contrast, is cheap in requests and expensive in *distinct
 * books*: it wants 168 whole files exactly once each. So:
 *
 * | Axis | Limit | What it is sized against |
 * |---|---|---|
 * | distinct anchors opened | `DISTINCT_BOOKS_PER_WINDOW` in `WINDOW_MS` | a scraper needs 168; a reader opens one or two |
 * | requests total | `REQUESTS_PER_WINDOW` in `WINDOW_MS` | ~15 range GETs per open × generous headroom |
 *
 * Ranges WITHIN an already-opened book are uncapped by the first axis, exactly
 * as §3.5 asks: "one distinct book opened per N seconds, ranges uncapped
 * within a book".
 *
 * ## Per ISOLATE, in memory, and that is a deliberate trade
 *
 * Same reasoning as `estate-status.ts`'s /seen cache, which this file sits
 * beside: this Worker has no database, and standing up D1 (or a Durable
 * Object) for a household's read budget would be infrastructure the design
 * never asked for. The consequence is stated rather than hidden: **a caller
 * spread across N isolates gets up to N budgets.** That is fine for the threat
 * — it raises a scraper's floor without ever being the only thing between the
 * corpus and the internet, which is the estate ladder and the estate grant.
 *
 * ⚠️ **Never make this the security story.** If it ever needs to be a real
 * quota, that is a Durable Object and a design decision, not a bigger `Map`.
 */

/** The window every counter rolls over on. */
export const WINDOW_MS = 5 * 60 * 1000;

/**
 * Distinct books one caller may OPEN in a window.
 *
 * 12 in five minutes is ~144/hour, so the whole 168-file corpus takes over an
 * hour of sustained effort — enough that a scrape is a decision rather than an
 * accident — while a person who genuinely flicks through a dozen books in five
 * minutes is browsing, not reading, and is asked to slow down rather than
 * refused.
 */
export const DISTINCT_BOOKS_PER_WINDOW = 12;

/**
 * Total byte requests one caller may make in a window, across all books.
 *
 * 600 is 40 book-opens' worth of the measured 15-ranges-per-open, which leaves
 * a deep reading session (page turns, images, a re-seek to the appendix) an
 * order of magnitude of headroom. ⚠️ Raise this before ever lowering it: the
 * failure mode of a too-tight request cap is "the reader stalls halfway
 * through a chapter", which reads as a broken viewer, not as a limit.
 */
export const REQUESTS_PER_WINDOW = 600;

interface Bucket {
  /** Epoch ms at which this window opened. */
  openedAt: number;
  requests: number;
  books: Set<string>;
}

const buckets = new Map<string, Bucket>();

/** Tests only — per-isolate state the suite must be able to drop. */
export function resetReadBudget(): void {
  buckets.clear();
}

export type BudgetVerdict =
  | { ok: true }
  /** `retryAfterSec` is what the 429's `Retry-After` header must carry. */
  | { ok: false; reason: 'too_many_books' | 'too_many_requests'; retryAfterSec: number };

/**
 * Charge one byte request to `key` (the caller's verified email) for `anchor`.
 *
 * ⚠️ Charging happens on the way IN, before the bytes are read, so a caller
 * who hammers a 404 or a 416 still pays. A budget that only counted successes
 * would be a free probe of which anchors exist.
 */
export function chargeRead(
  key: string,
  anchor: string,
  nowMs: number = Date.now(),
): BudgetVerdict {
  const existing = buckets.get(key);
  const bucket =
    existing && nowMs - existing.openedAt < WINDOW_MS
      ? existing
      : { openedAt: nowMs, requests: 0, books: new Set<string>() };
  buckets.set(key, bucket);

  const retryAfterSec = Math.max(
    1,
    Math.ceil((bucket.openedAt + WINDOW_MS - nowMs) / 1000),
  );

  if (bucket.requests >= REQUESTS_PER_WINDOW) {
    return { ok: false, reason: 'too_many_requests', retryAfterSec };
  }
  // ⚠️ A book ALREADY in the set is free on this axis — that is the "ranges
  // uncapped within a book" half of §3.5, and removing it turns every long
  // read into a refusal.
  if (!bucket.books.has(anchor) && bucket.books.size >= DISTINCT_BOOKS_PER_WINDOW) {
    return { ok: false, reason: 'too_many_books', retryAfterSec };
  }

  bucket.requests += 1;
  bucket.books.add(anchor);
  return { ok: true };
}
