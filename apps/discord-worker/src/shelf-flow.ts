/**
 * **THE NOT-REVIEWED ARITHMETIC, DONE BEFORE THE MODEL IS CONSULTED.**
 *
 * ⚠️ **THIS FILE EXISTS BECAUSE OF ONE LIVE ANSWER** (`shelf.ts` §`unreadAsk`
 * carries the transcript). The pre-router fix made the lane reachable, the model
 * entered it, and then — handed four working tools and a large question — it
 * asked the owner *"have you worked through The Stormlight Archive and
 * Mistborn?"* instead of calling `my_reviews`, which answers exactly that.
 *
 * > **Offering a tool is not routing to it. Entering the lane is not calling the
 * > tool.**
 *
 * The fix is not a sterner prompt. `tool_exec.ts`'s `my_unread` already computes
 * the right answer perfectly; nothing was wrong with the arithmetic, only with
 * whether it ran. So the arithmetic is lifted **ahead of the model**, exactly as
 * `suggest-flow.ts` composes its candidates: hand her the finished result and
 * there is nothing left to interview anybody about.
 *
 * ⚠️ **It holds no credential.** The shelf port arrives injected, as it does
 * everywhere else on this surface, and the catalogue is the public CSV.
 *
 * ## ⚠️ Why it GROUPS rather than lists
 *
 * Her instinct was **half right**: thirty-eight titles in a Discord message is a
 * wall, and she was right to balk at it. The half she got wrong was concluding
 * that the alternative was a question. The alternative is a grouped summary with
 * counts — shorter than the wall, and more useful than the interview.
 */

import { filterCatalog, loadCatalog, type CatalogRow } from './catalog-data.js';
import {
  bookIdFromTitle,
  SHELF_UNREAD_ROWS,
  type ShelfAsker,
  type ShelfPort,
  type UnreadAsk,
} from './shelf.js';

/** One series, as the answer should present it. */
export interface NotReviewedGroup {
  series: string;
  /** Owned on the audiobook shelf, within the subject asked about. */
  owned: number;
  notReviewed: number;
  /** ⚠️ **THE PROOF SHE LOOKED.** Naming what they HAVE reviewed is the fact
   *  they cannot get anywhere else, and it is what makes the count credible
   *  rather than assertive. */
  reviewedTitles: string[];
  /** A bounded sample of what is left — never the whole wall. */
  notReviewedTitles: string[];
  /** ⚠️ They have reviewed at least one volume, so this is a series they have
   *  actually STARTED. The answer leads with these. */
  started: boolean;
}

export interface NotReviewedResult {
  /** What was asked about — an author, a series, or nothing at all. */
  subject: string | null;
  field: 'author' | 'series' | 'everything';
  owned: number;
  reviewedHere: number;
  notReviewed: number;
  groups: NotReviewedGroup[];
  /** ⚠️ Their WHOLE review count, so an empty `reviewedHere` can be told apart
   *  from an empty shelf history. "You have reviewed nothing by Sanderson" and
   *  "you have reviewed nothing at all" are different sentences. */
  reviewsTotal: number;
  /** ⚠️ True when the reviews read FAILED. The counts are then about the shelf
   *  alone and must not be presented as personal. */
  reviewsUnavailable: boolean;
}

/** ⚠️ How many series get their own line. Beyond this the answer says how many
 *  more there are — a summary that hides its own size is the wall in disguise. */
export const NOT_REVIEWED_GROUPS = 8;
/** Titles sampled per series. The rest ride the auto-continue on request. */
export const NOT_REVIEWED_TITLES_PER_GROUP = 4;

/** Books with no series of their own, gathered under one heading. */
export const STANDALONE_GROUP = 'Standalone';

/**
 * Compute *"what have I not reviewed by X"*, grouped.
 *
 * ⚠️ **THE REVIEWS READ IS ALLOWED TO FAIL AND THE CATALOGUE READ IS NOT** — the
 * same split `suggest-flow.ts` makes. Without the catalogue there is no answer;
 * without the reviews there is still an honest, less personal one, and
 * `reviewsUnavailable` makes the caller say which it gave.
 *
 * Returns `null` only when the catalogue itself could not be read.
 */
export async function gatherNotReviewed(opts: {
  catalogBaseUrl: string;
  ask: UnreadAsk;
  port: ShelfPort;
  asker: ShelfAsker;
  fetchOverride?: typeof fetch;
}): Promise<NotReviewedResult | null> {
  const overrides = opts.fetchOverride ? { fetch: opts.fetchOverride } : undefined;

  // ⚠️ Together, not in sequence. Nothing here depends on anything else here.
  const [load, reviews] = await Promise.all([
    loadCatalog(opts.catalogBaseUrl, overrides),
    opts.port.myReviews(opts.asker),
  ]);
  if (!load.ok) return null;

  // ⚠️ THE WHOLE REVIEW SET, not the capped display slice. A cap meant for a
  // readable message must never decide which books count as reviewed — the same
  // rule `tool_exec.ts`'s `my_unread` states. `allBookIds` is that uncapped set
  // (audit F7); `rows` is only the 15-row slice shown to a reader. Fall back to
  // the row ids only when a caller/stub predates `allBookIds`.
  const reviewed = new Set(
    reviews.ok ? (reviews.allBookIds ?? reviews.rows.map((r) => r.bookId)).filter(Boolean) : [],
  );

  const subject = opts.ask.author ?? opts.ask.series ?? null;
  const field: NotReviewedResult['field'] = opts.ask.author
    ? 'author'
    : opts.ask.series
      ? 'series'
      : 'everything';

  const matches: readonly CatalogRow[] = subject
    ? filterCatalog(load.rows, { query: subject, field: field === 'author' ? 'author' : 'series' })
    : load.rows;

  const byGroup = new Map<string, { rows: CatalogRow[]; reviewed: string[]; notReviewed: string[] }>();
  let notReviewed = 0;
  let reviewedHere = 0;

  for (const row of matches) {
    const key = (row.series ?? '').trim() || STANDALONE_GROUP;
    let g = byGroup.get(key);
    if (!g) {
      g = { rows: [], reviewed: [], notReviewed: [] };
      byGroup.set(key, g);
    }
    g.rows.push(row);
    if (reviewed.has(bookIdFromTitle(row.title))) {
      g.reviewed.push(row.title);
      reviewedHere += 1;
    } else {
      g.notReviewed.push(row.title);
      notReviewed += 1;
    }
  }

  const groups: NotReviewedGroup[] = [...byGroup.entries()]
    .map(([series, g]) => ({
      series,
      owned: g.rows.length,
      notReviewed: g.notReviewed.length,
      reviewedTitles: g.reviewed.slice(0, NOT_REVIEWED_TITLES_PER_GROUP),
      notReviewedTitles: g.notReviewed.slice(0, NOT_REVIEWED_TITLES_PER_GROUP),
      started: g.reviewed.length > 0,
    }))
    // ⚠️ A series with nothing left is dropped: "0 of 5 not reviewed" is noise in
    // an answer about what is LEFT.
    .filter((g) => g.notReviewed > 0)
    // ⚠️ STARTED SERIES FIRST — that is what somebody asking this most likely
    // meant, and it is exactly what she tried to extract by interviewing.
    .sort((a, b) => {
      const started = Number(b.started) - Number(a.started);
      if (started !== 0) return started;
      const size = b.notReviewed - a.notReviewed;
      if (size !== 0) return size;
      return a.series.localeCompare(b.series);
    });

  return {
    subject,
    field,
    owned: matches.length,
    reviewedHere,
    notReviewed,
    groups,
    reviewsTotal: reviews.ok ? reviews.total : 0,
    reviewsUnavailable: !reviews.ok,
  };
}

/**
 * The result, as the model receives it.
 *
 * ⚠️ **EVERY NUMBER HERE IS CALLED WHAT IT IS.** `not_reviewed`, never `unread`
 * — a field name is the first thing a model reproduces, and this whole feature's
 * honesty rests on the two not being confused. The delivery and honesty notes are
 * appended by the caller so this stays a renderer.
 */
export function renderNotReviewed(result: NotReviewedResult): string {
  const who = result.subject ? ` by ${result.subject}` : ' on the audiobook shelf';
  const head =
    `Worked out this turn from the catalogue and this person's own reviews:\n` +
    `- owned${who}: ${result.owned}\n` +
    `- of those, they have REVIEWED: ${result.reviewedHere}\n` +
    `- NOT REVIEWED (this is the answer): ${result.notReviewed}\n` +
    `- their reviews in total, across everything: ${result.reviewsTotal}`;

  if (result.reviewsUnavailable) {
    return (
      `${head}\n⚠️ THEIR REVIEWS COULD NOT BE READ THIS TURN, so the "not reviewed" number above is ` +
      'the whole owned count and is NOT personal to them. Say so plainly rather than presenting it ' +
      'as what they have not got to.'
    );
  }

  if (result.groups.length === 0) {
    return (
      `${head}\n⚠️ Nothing is left unreviewed${who}. Say that, and say it as "you have reviewed all ` +
      `of them" — never as "you have read all of them".`
    );
  }

  const shown = result.groups.slice(0, NOT_REVIEWED_GROUPS);
  const lines = shown.map((g) => {
    const bits = [`- **${g.series}** — ${g.notReviewed} of ${g.owned} not reviewed`];
    if (g.reviewedTitles.length > 0) {
      bits.push(`  (they reviewed: ${g.reviewedTitles.join('; ')})`);
    }
    if (g.notReviewedTitles.length > 0) {
      const more = g.notReviewed - g.notReviewedTitles.length;
      bits.push(
        `  left: ${g.notReviewedTitles.join('; ')}${more > 0 ? ` — and ${more} more` : ''}`,
      );
    }
    if (g.started) bits.push('  ⚠️ STARTED — lead with this one.');
    return bits.join('\n');
  });

  const hidden = result.groups.length - shown.length;
  const tail =
    hidden > 0
      ? `\n- …and ${hidden} more series/groups not listed here. SAY there are ${hidden} more rather ` +
        'than implying this is all of them.'
      : '';

  return `${head}\n\nBy series, started first:\n${lines.join('\n')}${tail}`;
}

/** ⚠️ Exported so a test can assert the display cap never hides the true size. */
export const NOT_REVIEWED_ROW_CAP = SHELF_UNREAD_ROWS;
