/**
 * **GABI KNOWS YOUR SHELF — the contract** (`docs/info/gabi-personal-shelf-design.md`).
 *
 * Owner ask, verbatim (2026-08-18): *"We need GABI to know the tbr, reviews, and
 * unread about a user if they're /linked."*
 *
 * This file is the whole contract and **holds no credential** — the fifth
 * application of the seam `delegated.ts`, `estate-docs.ts`, `book-knowledge.ts`
 * and `memory.ts` established. `shelf-exec.ts` is the only module here that
 * touches a secret, and it arrives as an injected port this file cannot build.
 *
 * ## ⚠️ THE THREE RULES THIS SURFACE EXISTS UNDER
 *
 *  1. **The uid never comes from the model.** It is read from the link document
 *     server-side. There is no tool parameter that could carry somebody else's
 *     identity, which is what makes *"the asker's own shelf"* enforceable rather
 *     than merely instructed.
 *  2. ⚠️ **"Unread" is a PROXY on the audiobook side and must say so.** There is
 *     no read-state store there; *owned and not reviewed* is the honest answer to
 *     a different question, and a count that masquerades as "books you have not
 *     read" overcounts enormously in the direction that sounds authoritative.
 *  3. ⚠️ **A review belongs to whoever wrote it.** Other people's reviews are
 *     public site content and may be quoted — attributed, never absorbed into
 *     her own claim.
 */

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ Affirmative-only `"on"`, the house idiom. **Ships off** — this reaches a
 * named person's own shelf, so it follows the `GABI_BOOKS` precedent rather than
 * the personality one.
 */
export function shelfOn(env: Pick<Env, 'GABI_SHELF'>): boolean {
  return (env.GABI_SHELF ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The caps — sized to the data (design §3)
// ---------------------------------------------------------------------------

/** A TBR is small. Forty is generous rather than a trim. */
export const SHELF_TBR_ROWS = 40;
/** ⚠️ Review text runs to 1,000 characters, so fifteen is already a long
 *  message. The auto-continue machinery carries the overflow. */
export const SHELF_REVIEW_ROWS = 15;
/** With the TOTAL always stated beside it — a truncated list that hides its own
 *  size is how "you have three unread" gets said about three hundred. */
export const SHELF_UNREAD_ROWS = 30;

// ---------------------------------------------------------------------------
// ⚠️ Who is asking — resolved server-side, never from the model
// ---------------------------------------------------------------------------

/** Why an asker has no usable shelf identity. ⚠️ Four reasons, four sentences,
 *  because the fixes differ — and the fourth is this feature's own. */
export type ShelfIdentityFailure = 'unlinked' | 'no_uid' | 'no_name' | 'outage';

/**
 * The asker, as the link document knows them.
 *
 * ⚠️ **`displayName` IS A SNAPSHOT taken at `/link` time, not a live read** — and
 * that is the sharpest edge in this design. The sites read the live Firebase
 * profile; GABI reads this copy. So the name she joins reviews on can be stale
 * *even when the person sees nothing wrong on the site*, and a "you have no
 * reviews" answer would be a lie told confidently.
 *
 * Two consequences, both load-bearing:
 *  - every reviews result states which name it joined on, so a mismatch is
 *    visible rather than silent;
 *  - a person whose reviews vanish is told to re-run `/link`, which refreshes the
 *    snapshot. ⚠️ That is a real fix they can perform themselves.
 */
export interface ShelfAsker {
  uid: string;
  displayName: string;
  email?: string;
}

export interface ShelfCallResult<T> {
  ok: boolean;
  rows: T[];
  /** ⚠️ The TRUE total before capping. Never omitted — see `SHELF_UNREAD_ROWS`. */
  total: number;
  message?: string;
}

/** One TBR intention. ⚠️ `shelf` is never dropped: the estate has TWO TBRs and
 *  they are different lists, not two copies of one. */
export interface TbrRow {
  bookId: string;
  title: string;
  shelf: 'audiobooks' | 'library';
  addedAt?: string;
  /** ⚠️ `name` means it was found only through the legacy display-name key, so
   *  the answer must not imply more certainty than the join had. */
  matchedBy: 'uid' | 'name';
}

export interface ReviewRow {
  bookId: string;
  title?: string;
  displayName: string;
  rating?: number;
  text?: string;
  updatedAt?: string;
}

/**
 * Everything the shelf tools need from the outside world.
 *
 * ⚠️ **An interface rather than an import, and that is the credential seam** —
 * the fifth application of it.
 */
export interface ShelfPort {
  /** ⚠️ Memoised per turn, like every other identity read on this surface. */
  asker(discordUserId: string): Promise<
    { ok: true; asker: ShelfAsker } | { ok: false; reason: ShelfIdentityFailure }
  >;
  myTbr(asker: ShelfAsker): Promise<ShelfCallResult<TbrRow>>;
  myReviews(asker: ShelfAsker): Promise<ShelfCallResult<ReviewRow>>;
  /** ⚠️ PUBLIC content — reviews of one book by anybody. Attributed, never
   *  absorbed. */
  bookReviews(bookId: string): Promise<ShelfCallResult<ReviewRow>>;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const SHELF_MSG = {
  /** ⚠️ REUSED wording, not a new sentence. Somebody who has met "run /link" once
   *  should meet the same words again rather than wondering if this is a
   *  different problem. */
  notLinked:
    "I can't tell who you are on the estate yet, so I can't see your shelf. Run /link once and ask " +
    'me again.',

  linkIncomplete:
    'Your link was made before I could read your estate profile. Re-run /link once and I will be ' +
    'able to find your shelf.',

  /**
   * ⚠️ **THE STALE-SNAPSHOT SENTENCE, and it is the one this design exists to get
   * right.** Reviews are keyed by display name, and the name GABI holds was
   * copied at link time. So "nothing found" has two very different causes and
   * only one of them is "you have not written any".
   */
  reviewsNotFound: (name: string) =>
    `I could not find any reviews under the name I have for you (${name}). If you have renamed ` +
    'yourself on the estate since you linked, re-run /link and I will pick up your current name — ' +
    'your reviews are filed under whatever name you wrote them with.',

  estateUnreachable:
    "I couldn't reach the estate to look at your shelf — that's a problem on our side, not your " +
    'account. Try again in a minute.',

  notConfigured:
    "I'm not wired up to read shelves yet — that's a setup step on our side, not a permissions " +
    'problem.',

  switchedOff:
    'Looking at your own shelf is switched off at the moment — that is a lever on our side rather ' +
    'than anything to do with your account.',

  /**
   * ⚠️ **ANOTHER PERSON'S TBR IS NEVER OFFERED, in any surface.** Their reviews
   * are public site content; their intentions are not published anywhere, and a
   * reading list is a statement about somebody's plans rather than their
   * opinions.
   */
  notYourTbr:
    "Somebody else's reading list isn't mine to share — it isn't public anywhere on the sites, " +
    "unlike reviews. I can tell you what they've reviewed if that helps.",

  emptyTbr:
    "There's nothing on your reading list at the moment. Add something from either site and it will " +
    'show up here.',
} as const;

export function shelfIdentityMessage(reason: ShelfIdentityFailure): string {
  switch (reason) {
    case 'unlinked':
      return SHELF_MSG.notLinked;
    case 'no_uid':
    case 'no_name':
      return SHELF_MSG.linkIncomplete;
    case 'outage':
      return SHELF_MSG.estateUnreachable;
  }
}

// ---------------------------------------------------------------------------
// ⚠️ "UNREAD" — the definition is the whole risk
// ---------------------------------------------------------------------------

/**
 * ⚠️ **WHAT PRODUCED THIS ROW**, carried on every one of them.
 *
 * `no_review` is a PROXY: the estate has no read-state store on the audiobook
 * side (reading positions are phase 3 of the book design and unbuilt), so
 * *owned and not reviewed* is the honest answer to a **different question** from
 * the one asked.
 *
 * ⚠️ Most people review a small fraction of what they read, so this proxy
 * overcounts enormously — and in the direction that sounds most authoritative.
 * `UNREAD_NOTE` is what stops the number masquerading.
 */
export type UnreadBasis = 'no_review' | 'read_state';

export const UNREAD_NOTE =
  '⚠️ THESE ARE BOOKS YOU HAVE NOT REVIEWED, which is NOT the same as books you have not read — the ' +
  'estate has no record of what has been finished on the audiobook side. SAY THAT PLAINLY when you ' +
  'give the number: call it "not reviewed", never "unread", and never imply the count is a reading ' +
  'backlog. If a row says read_state it came from an explicit human-set read state on the library ' +
  'side and that one IS real.';

/** ⚠️ Said whenever a suggestion or a count could be mistaken for a fact about
 *  what somebody has finished. */
export const SHELF_SOFT_CLAIM_NOTE =
  '⚠️ If they have told you in conversation that they finished something, that is a remembered ' +
  'CLAIM and not a record — mention it if useful, but never let it change a count or override what ' +
  'the shelf actually says.';

// ---------------------------------------------------------------------------
// ⚠️ A PERSISTED-KEY FUNCTION, MIRRORED — change it and you have a migration
// ---------------------------------------------------------------------------

/**
 * ⚠️ **A DELIBERATE MIRROR of `audiobook_catalog/site/reviews.js`'s
 * `bookIdFromTitle()`, and the two must agree exactly.**
 *
 * That function produces the id every review and every reading-list row is
 * FILED UNDER, and the chunk packs use the same slug. So this is a persisted-key
 * function by the estate's own rule: **changing it is a migration, not an edit**,
 * and changing it on one side only silently orphans every join that crosses.
 *
 * It is copied rather than imported because the two live in different repos with
 * no shared package between them. ⚠️ If a `packages/` home is ever made for it,
 * both sides should move there together — a third copy would be worse than these
 * two.
 *
 * The rule, verbatim from the source: lowercase, every run of non-alphanumerics
 * becomes one hyphen, collapse repeats, trim the ends.
 */
export function bookIdFromTitle(title: string): string {
  return (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}
