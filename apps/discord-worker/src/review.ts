/**
 * `/review` — "what did the house think of this book?" (design proposal P2),
 * plus the one-click way to add your own.
 *
 * ## The read half — and P2's own open question, now answered
 *
 * P2 shipped with a caveat: *"Did not verify whether the reviews collection is
 * readable by an unauthenticated caller … confirm the exact read path before
 * build."* It is confirmed, and the answer is neither of the two P2 imagined:
 * **this Worker already reads `reviews` with the service account it already
 * holds**, through `ShelfPort.bookReviews()` (`shelf-exec.ts`), which was built
 * for the shelf lane on 2026-08-18. Its own comment records the scope decision
 * verbatim — *"PUBLIC content — the sites show these to anybody. No asker
 * filter, and that absence is deliberate rather than forgotten."*
 *
 * So `/review` adds **no new credential, no new trust edge and no sixth
 * credential-holding module**. It is a Discord surface over a read the estate
 * already performs.
 *
 * ## ⚠️ THE WRITE HALF IS A DEEP LINK, AND THAT IS A MEASURED DECISION
 *
 * `/review` does NOT write a review, and this is the sharpest call in the fun
 * menu. What was measured (2026-09-02):
 *
 *  - The review doc's FIELDS are known — `bookId`, `displayName`, `rating`,
 *    `text`, `updatedAt` — because `shelf-exec.ts` reads them.
 *  - The review doc's **ID convention is NOT known here.** It is decided by
 *    `audiobook_catalog/site/reviews.js`'s `submitReview`, in a repo this build
 *    was directed not to read, and nothing in this repo records it.
 *  - This Worker's service account **bypasses `firestore.rules`**. So a write
 *    under a guessed id would not be refused — it would SUCCEED, and the site
 *    would then show one person two reviews of one book, or none.
 *
 * ⚠️ A doc id is a persisted key, and the estate's own rule is that changing
 * one is *a migration, not an edit* (`shelf.ts`'s `bookIdFromTitle` header).
 * **Inventing one is worse than changing one.** So the write half is what
 * `/gabi` already established as this Worker's honest shape when it cannot act
 * directly: **propose and deep-link** — the answer carries the book's own page,
 * where the site's own form writes the review its own way.
 *
 * ⚠️ **What would change this:** the id convention, measured from
 * `submitReview` and written down in `docs/info/`. Then this becomes an upsert
 * in the exact shape of `poll-vote.ts`'s, and the deep link becomes the
 * fallback rather than the path.
 *
 * ## The join, and its one fragility
 *
 * A review is filed under `bookIdFromTitle(title)` — the mirrored slug function
 * in `shelf.ts`. The title is resolved through the index's public
 * `/api/search`, exactly as `/have` resolves one, so a person can type "way of
 * kings" and get the catalogue's own spelling. ⚠️ **If the audiobook site ever
 * files reviews under a different title spelling than the index returns, this
 * join silently finds nothing** — which is why an empty result says "no reviews
 * recorded under this title" and names the title it looked under, rather than
 * "nobody has reviewed it".
 */

import { INDEX_LOOKUP_MS } from './deadline.js';
import { editOriginalMessage } from './discord-api.js';
import { EMBED_COLOR, truncate, type SearchAnswer, type SearchBookHit } from './have.js';
import { bookIdFromTitle, shelfIdentityMessage, type ShelfPort } from './shelf.js';

/** Same narrowing `/have` sends, and for the same reason: the scope this
 * command answers at is stated HERE, never inherited from somebody else's
 * default. */
export const REVIEW_SOURCE = 'audiobook';

/** The index refuses a one-character query; refuse it here with words. */
export const MIN_BOOK_QUERY = 2;

/** How many reviews one answer shows. More is a wall of text; the overflow is
 * COUNTED and stated, never dropped silently. */
export const MAX_REVIEWS_SHOWN = 5;

/** How much of one review's text is quoted. ⚠️ A review is somebody's writing:
 * an elision is marked, and the answer always points at the page where the
 * whole thing is. */
export const REVIEW_SNIPPET = 400;

export const REVIEW_MSG = {
  tooShort:
    'That is too short to look up — give GABI at least two characters of a title and she will find ' +
    'the book. Nothing went wrong.',
  unreachable:
    "GABI could not reach the estate's catalogue just now, so this is a service problem on the " +
    'estate side and NOT an answer about the book — try again in a minute. Nothing was searched.',
  refused: (status: number) =>
    `The estate's catalogue refused the search (HTTP ${status}) — a service problem on the estate ` +
    'side, NOT an answer about the book. Try again shortly.',
  noBook: (query: string) =>
    `Nothing on the estate's public audiobook shelf matches **${query}**, so there is no book to ` +
    'show reviews for.\n\n' +
    '⚠️ That is a statement about the **catalogue**, not about the house — a real book that has not ' +
    'been scanned yet looks exactly like this.',
  /** ⚠️ NEVER "nobody has reviewed it". The join is by title slug, and a
   * spelling mismatch looks identical to an absence — so the sentence says what
   * was actually looked under. */
  noReviews: (title: string, url: string | null) =>
    `No reviews are recorded under **${title}**.\n\n` +
    'That is what the estate has filed under this title — reviews are joined by the slug of the ' +
    'title, so a book catalogued under a different spelling would look exactly like this.' +
    (url ? `\n\n**Be the first:** write one on [the book's page](${url}).` : ''),
  reviewsOff:
    'Reading the estate\'s reviews is switched off at the moment — that is a lever on our side ' +
    'rather than anything to do with your account.',
  notConfigured:
    "GABI is not wired up to read the estate's reviews yet — that is a setup step on our side, not " +
    'a permissions problem.',
  /** ⚠️ The write half, stated in every answer so nobody has to ask how. */
  writeYours: (url: string | null) =>
    url
      ? `\n\n_Write your own on [the book's page](${url}) — GABI shows reviews here, the site takes ` +
        'them._'
      : '\n\n_Write your own on the book\'s page at audiobooks.heygabi.ai — GABI shows reviews ' +
        'here, the site takes them._',
  overflow: (shown: number, total: number) => `\n\n_Showing ${shown} of ${total} reviews._`,
} as const;

// ---------------------------------------------------------------------------
// Finding the book
// ---------------------------------------------------------------------------

export function reviewSearchUrl(base: string, query: string): string {
  const url = new URL('/api/search', base);
  url.searchParams.set('q', query);
  url.searchParams.set('source', REVIEW_SOURCE);
  return url.toString();
}

export interface ResolvedBook {
  title: string;
  creator: string;
  /** The book's own page on the audiobook site, when the index recorded one. */
  url: string | null;
}

export type BookLookup =
  | { ok: true; book: ResolvedBook | null }
  | { ok: false; reason: 'refused' | 'unreachable'; status: number };

/** ⚠️ The FIRST hit and nothing cleverer. The index already ranks; picking a
 * different one here would be a second, disagreeing ranking. */
export function firstBook(answer: SearchAnswer): ResolvedBook | null {
  const hit: SearchBookHit | undefined = Array.isArray(answer.books) ? answer.books[0] : undefined;
  if (!hit) return null;
  const title = (hit.title ?? '').trim();
  if (!title) return null;
  const entries = Array.isArray(hit.entries) ? hit.entries : [];
  const url = entries.map((e) => (e.detail_url ?? '').trim()).find((u) => u.length > 0) ?? null;
  return { title, creator: (hit.creator ?? '').trim(), url };
}

/** Ask the index. NO Authorization header — the same scope decision `/have`
 * records, stated here rather than inherited. */
export async function lookupBook(
  base: string,
  query: string,
  overrides?: { fetch?: typeof fetch },
): Promise<BookLookup> {
  const doFetch = overrides?.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(reviewSearchUrl(base, query), {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(INDEX_LOOKUP_MS),
    });
  } catch {
    return { ok: false, reason: 'unreachable', status: 0 };
  }
  if (!res.ok) return { ok: false, reason: 'refused', status: res.status };
  try {
    return { ok: true, book: firstBook((await res.json()) as SearchAnswer) };
  } catch {
    return { ok: false, reason: 'refused', status: res.status };
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface RenderableReview {
  displayName: string;
  rating?: number;
  text?: string;
  updatedAt?: string;
}

/** One review, attributed. ⚠️ **Attributed, never absorbed** — the shelf lane's
 * rule for public review content, kept verbatim: a person's words are theirs
 * and carry their name. */
export function renderReview(r: RenderableReview): string {
  const stars =
    typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5
      ? ` ${'★'.repeat(Math.round(r.rating))}${'☆'.repeat(5 - Math.round(r.rating))}`
      : '';
  const name = truncate(r.displayName || 'somebody', 60);
  const body = (r.text ?? '').trim();
  // ⚠️ A rating with no words is a real review and is shown as one; printing
  // "(no text)" would read as a fault.
  return body ? `**${name}**${stars}\n> ${truncate(body, REVIEW_SNIPPET)}` : `**${name}**${stars}`;
}

/** The average, to one decimal, over the rows that CARRY a rating. ⚠️ Reviews
 * with no rating are excluded from the average and counted separately —
 * treating a missing rating as a zero would drag every average down. */
export function averageRating(rows: readonly RenderableReview[]): { avg: number; of: number } | null {
  const rated = rows
    .map((r) => r.rating)
    .filter((n): n is number => typeof n === 'number' && n >= 1 && n <= 5);
  if (rated.length === 0) return null;
  return { avg: Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10, of: rated.length };
}

export function buildReviewAnswer(
  book: ResolvedBook,
  rows: readonly RenderableReview[],
  total: number,
): { embeds: unknown[] } {
  const shown = rows.slice(0, MAX_REVIEWS_SHOWN);
  const avg = averageRating(rows);
  const head = avg
    ? `**${avg.avg} / 5** across ${avg.of} rating${avg.of === 1 ? '' : 's'}\n\n`
    : '';
  const description =
    shown.length === 0
      ? REVIEW_MSG.noReviews(truncate(book.title, 120), book.url)
      : head +
        shown.map(renderReview).join('\n\n') +
        (total > shown.length ? REVIEW_MSG.overflow(shown.length, total) : '') +
        REVIEW_MSG.writeYours(book.url);
  return {
    embeds: [
      {
        title: truncate(book.creator ? `${book.title} — ${book.creator}` : book.title, 256),
        description: truncate(description, 4000),
        color: EMBED_COLOR,
        ...(book.url ? { url: book.url } : {}),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export interface ReviewContext {
  book: string;
  applicationId: string;
  interactionToken: string;
  indexBaseUrl: string;
  /** ⚠️ Absent when `FIREBASE_SERVICE_ACCOUNT` is unset — a SETUP gap, worded
   *  as one, never as a permission refusal. */
  shelf: ShelfPort | null;
  /** `GABI_SHELF`'s posture. The reviews read is the SAME read the shelf lane
   *  performs, so it lives behind the SAME lever rather than a second one that
   *  could disagree with it. */
  shelfOn: boolean;
  fetchOverride?: typeof fetch;
}

/** Answer `/review`. Never throws. */
export async function processReview(ctx: ReviewContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    const query = ctx.book.trim();
    if (query.length < MIN_BOOK_QUERY) {
      await say({ content: REVIEW_MSG.tooShort });
      return;
    }
    if (!ctx.shelfOn) {
      await say({ content: REVIEW_MSG.reviewsOff });
      return;
    }
    if (!ctx.shelf) {
      await say({ content: REVIEW_MSG.notConfigured });
      return;
    }

    const lookup = await lookupBook(
      ctx.indexBaseUrl,
      query,
      ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined,
    );
    if (!lookup.ok) {
      await say({
        content:
          lookup.reason === 'unreachable' ? REVIEW_MSG.unreachable : REVIEW_MSG.refused(lookup.status),
      });
      return;
    }
    if (!lookup.book) {
      await say({ content: REVIEW_MSG.noBook(truncate(query, 100)) });
      return;
    }

    const reviews = await ctx.shelf.bookReviews(bookIdFromTitle(lookup.book.title));
    // ⚠️ A failed READ is an outage and is worded as one — never as "no
    // reviews", which is an answer about the book rather than about us.
    if (!reviews.ok) {
      await say({ content: reviews.message ?? shelfIdentityMessage('outage') });
      return;
    }
    await say(buildReviewAnswer(lookup.book, reviews.rows, reviews.total));
  } catch (err) {
    console.error('/review failed:', err instanceof Error ? err.message : err);
    try {
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: REVIEW_MSG.unreachable,
      });
    } catch {
      // Token expired or Discord is down; nothing further is possible.
    }
  }
}
