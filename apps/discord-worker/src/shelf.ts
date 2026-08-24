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
// ⚠️ THE SHELF INTENT ROUTER — deterministic, and NEVER a model's decision
// ---------------------------------------------------------------------------

/**
 * ⚠️ **WHY THIS EXISTS: the acceptance test it was written against, live.**
 *
 * Minutes after `GABI_SHELF` was flipped on (2026-08-18), the owner asked in the
 * channel the exact question `my_unread`'s own description prescribes — and got,
 * verbatim:
 *
 * > **User:** `@GABI what haven't I read by Sanderson?`
 * > **GABI:** I looked on the estate's public shelf for **not read by
 * > Sanderson**. Nothing on the estate's public shelf matches that. ⚠️ That's a
 * > statement about the catalogue, not about the house…
 *
 * ⚠️ **THE SHELF LANE WAS NEVER ENTERED.** Not an identity failure — an unlinked
 * asker would have got `SHELF_MSG.notLinked`, and that sentence never appeared.
 * The four tools shipped with an allowlist, an executor and a port, and were
 * *offered* on `question` turns via `toolsForApi({ shelf: true })` — but the
 * intent classifier read the sentence as `have_lookup`, and that branch is a
 * pure public-index lookup that never calls a model at all. So the tools were on
 * the table in a room the turn never walked into.
 *
 * ⚠️ **THIS IS THE THIRD OF THE SAME CLASS IN ONE DAY**, and the two before it
 * are the pattern this deliberately EXTENDS rather than rivals:
 *
 * | | The miss | The fix |
 * |---|---|---|
 * | docs §12 | "how do I promote the audiobook site?" answered from the book shelf | `docsIntent` + a pre-router above every intent branch |
 * | books §10b/§10c | a plot question answered with a narrator; then an invited follow-up sent to the catalogue | `booksIntent` + `booksFollowUp`, same pre-router shape |
 * | **shelf (here)** | **a first-person question answered from the public catalogue** | **`shelfIntent` + `shelfFollowUp`, the same shape again** |
 *
 * > **The lesson all three teach in the same words: OFFERING A TOOL IS NOT
 * > ROUTING TO IT.** A model that is handed a shelf tool on a turn the router
 * > already sent somewhere else never sees it.
 *
 * ## The shape of the rule: FIRST PERSON is the whole signal
 *
 * The catalogue answers questions about the HOUSE. This lane answers questions
 * about the PERSON — and the grammar that separates them is possessive and
 * experiential: *my* list, *I* have read, *I* rated, what did *I* think.
 *
 * ⚠️ **`what haven't I read by Sanderson` and `what Sanderson do we have` differ
 * by exactly one pronoun**, and that one pronoun is the difference between a
 * reading list and a catalogue row. Nothing subtler is needed and nothing
 * subtler would be safe.
 *
 * ⚠️ **The public-review shapes are a SECOND, SEPARATE detector** (`shelfPublicIntent`)
 * and not a row of this list, because they differ in the one way that matters:
 * *"what did Sam think of X?"* needs **no identity at all** — reviews are public
 * site content the websites show anonymous visitors. Folding them together would
 * make the router demand a `/link` for a question the web answers to strangers.
 */

/** ⚠️ Fires ALONE. Each names the asker's own record explicitly. */
const SHELF_STRONG = [
  // "my TBR", "my reading list", "my reviews", "my ratings", "my shelf"
  /\bmy\s+(?:tbr|t\.b\.r\.?|to[-\s]?be[-\s]?read(?:\s+list)?|reading\s+list|read\s+list|want[-\s]?to[-\s]?read|reviews?|ratings?|shelf)\b/i,
  /\bon\s+my\s+(?:list|shelf|tbr|pile)\b/i,
  // ⚠️ THE OWNER'S OWN LIVE LINE. The apostrophe is optional and may be curly —
  // Discord's clients substitute ’ for ' as you type, and a detector that only
  // knows the straight one misses every message typed on a phone.
  /\bwhat\s+(?:have|has)\s+i\s+(?:not\s+)?(?:read|reviewed|rated|finished|got(?:ten)?\s+to)\b/i,
  /\bwhat\s+haven[’']?t\s+i\s+(?:read|reviewed|rated|finished|got(?:ten)?\s+(?:round\s+)?to)\b/i,
  /\bhave\s+i\s+(?:read|reviewed|rated|finished)\b/i,
  /\bhaven[’']?t\s+i\s+(?:read|reviewed)\b/i,
  /\bdid\s+i\s+(?:read|review|rate|like|finish|enjoy)\b/i,
  /\bwhat\s+did\s+i\s+(?:say|think|rate|make)\b/i,
  /\bwhat\s+do\s+i\s+think\s+(?:of|about)\b/i,
  /\bwhat\s+i\s+(?:have\s+)?(?:not\s+)?(?:read|reviewed)\b/i,
  // "what else is there by X" — my_unread's own prescribed line. It is
  // first-person by implication rather than by pronoun, so it is listed rather
  // than derived.
  /\bwhat\s+else\s+(?:is\s+there|have\s+we\s+got|do\s+we\s+have)\s+by\b/i,
];

/**
 * ⚠️ **PUBLIC REVIEWS — a different question with a different gate.** These
 * reach `book_reviews`, which reads content the estate sites publish to anybody,
 * so this half must NEVER be made to wait behind an identity check.
 */
const SHELF_PUBLIC = [
  // ⚠️ `(?!i\b)` keeps "what did I think of X" out of the public half — that one
  // is the asker's OWN review and belongs above, behind the identity check.
  /\bwhat\s+did\s+(?!i\b)[\w<@!>’'.-]+\s+(?:think|say)\s+(?:of|about)\b/i,
  /\bhow\s+did\s+(?!i\b)[\w<@!>’'.-]+\s+(?:rate|find)\b/i,
  /\bwho\s+(?:has\s+|\'?s\s+)?reviewed\b/i,
  /\b(?:any|the|what)\s+reviews?\s+(?:of|for|on)\b/i,
  /\bwhat\s+(?:does|did)\s+(?:anyone|anybody|everyone|the\s+household|the\s+family)\s+(?:think|say)\b/i,
];

/** The weaker half — a shelf noun that only counts in a first-person sentence. */
const SHELF_WEAK = [
  /\btbr\b/i,
  /\breading\s+list\b/i,
  /\bunread\b/i,
  /\bnot\s+reviewed\b/i,
  /\breviews?\b/i,
  /\brate[ds]?\b/i,
  /\bfinished\b/i,
];

/** ⚠️ The pronoun that turns a shelf noun into somebody's own shelf. */
const SHELF_FIRST_PERSON = /\b(?:i|i[’']ve|i[’']m|my|mine|me)\b/i;

/**
 * Does this message ask about the ASKER'S OWN record — their list, their
 * reviews, what they have and have not got to?
 *
 * ⚠️ **Narrow on purpose**, exactly as `docsIntent` and `booksIntent` are. A
 * false positive answers *"what have we got by Sanderson"* out of somebody's
 * reading list; a false negative merely leaves the model to reach for the tools
 * itself, which is the behaviour that was already there — and which is precisely
 * what proved insufficient.
 */
export function shelfIntent(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  if (SHELF_STRONG.some((re) => re.test(q))) return true;
  return SHELF_WEAK.some((re) => re.test(q)) && SHELF_FIRST_PERSON.test(q);
}

/** ⚠️ The public half, kept separate because it needs NO identity. */
export function shelfPublicIntent(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  return SHELF_PUBLIC.some((re) => re.test(q));
}

/** Either half. The router uses this to claim the turn and `shelfPublicIntent`
 *  to decide whether an identity is needed first. */
export function shelfLaneIntent(text: string): boolean {
  return shelfIntent(text) || shelfPublicIntent(text);
}

// ---------------------------------------------------------------------------
// ⚠️ THE NOT-REVIEWED ASK — entering the lane is not the same as CALLING a tool
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE SECOND LIVE FAILURE OF THE SAME QUESTION — 2026-08-18, 16:25.**
 *
 * The pre-router fix landed and worked: she engaged the question instead of
 * searching the public catalogue. And the answer was still wrong, in a new way:
 *
 * > **User:** `What have I not read by Sanderson`
 * > **GABI:** *"We've got 38 Sanderson audiobooks on the shelf. But I'm going to
 * > need a bit more from you — have you worked through The Stormlight Archive and
 * > Mistborn series? Because that's a lot of books and I'd rather not just rattle
 * > off a wall of titles. What's the Cosmere stuff you have tackled?"*
 *
 * ⚠️ **SHE INTERVIEWED THE ASKER FOR DATA HER OWN TOOLS ALREADY HELD**, and the
 * evidence that no shelf tool ran is inside the sentence: "38 Sanderson
 * audiobooks" is a CATALOGUE count, there is no *"you have reviewed N of them"*
 * fact anywhere in it, and every question she asked — *"have you worked through
 * Stormlight?"* — is one `my_reviews` answers exactly.
 *
 * ## ⚠️ THE LESSON, ONE LAYER DEEPER THAN THE MORNING'S
 *
 * | | The miss | The lesson |
 * |---|---|---|
 * | 15:40 | the lane was never entered | **offering a tool is not routing to it** |
 * | 16:25 | the lane was entered, the tool was never called | ⚠️ **ENTERING THE LANE IS NOT CALLING THE TOOL** |
 *
 * A model handed tools and a large question will sometimes ask the person
 * instead, because it is the cheapest move available to it. That is the
 * **ask-instead-of-deliver** class, and it is a cousin of the permission turn the
 * book lane retired in §10e: both replace an answer she could give with a
 * question she does not need to ask.
 *
 * ## ⚠️ AND THE FIX IS NOT A STERNER PROMPT
 *
 * *"You must call the tool"* is the same category of hope as *"be honest"*, and
 * this file's own header says why that is not enough. So the arithmetic is
 * **done before the model is consulted**, exactly as the suggestion lane composes
 * its candidates: she is handed the finished result — owned-by-subject, minus
 * reviewed-by-asker, grouped by series — and there is then nothing left to
 * interview anybody about.
 *
 * ⚠️ Her wall-of-titles instinct was **HALF RIGHT, and that half is kept**: the
 * delivery shape is a grouped summary with counts, not thirty-eight titles. See
 * `SHELF_DELIVER_NOTE`.
 */
export interface UnreadAsk {
  /** The author named after "by", if any. */
  author?: string;
  /** The series named, if any. */
  series?: string;
}

/** ⚠️ The shapes meaning *"what have I not got to"* — a superset of `my_unread`'s
 *  own prescribed lines, because the tool is no longer what decides whether the
 *  arithmetic happens. */
const UNREAD_SHAPES = [
  /\bwhat\s+(?:have|has)\s+i\s+not\s+(?:read|reviewed|got(?:ten)?\s+to|finished)\b/i,
  /\bwhat\s+haven[’']?t\s+i\s+(?:read|reviewed|got(?:ten)?\s+(?:round\s+)?to|finished)\b/i,
  /\bwhat\s+i\s+(?:have\s+)?not\s+(?:read|reviewed)\b/i,
  /\bwhat[’']?s?\s+left\s+(?:for me\s+)?to\s+read\b/i,
  /\bwhat\s+else\s+(?:is\s+there|have\s+we\s+got|do\s+we\s+have)\s+by\b/i,
  /\bwhat\s+have\s+i\s+(?:still\s+)?got\s+(?:left\s+)?to\s+read\b/i,
];

/**
 * ⚠️ **THE SUBJECT, EXTRACTED — and a MISSING one is NOT a reason to ask.**
 *
 * *"What have I not read"* with no author named is the case most likely to
 * produce an interview, because the honest full answer is enormous. It is
 * answered anyway: the grouping leads with the series they have actually
 * STARTED, which is both the most useful slice and precisely the thing she was
 * trying to extract by asking.
 */
export function unreadAsk(text: string): UnreadAsk | null {
  const q = (text ?? '').trim();
  if (!q) return null;
  if (!UNREAD_SHAPES.some((re) => re.test(q))) return null;

  const out: UnreadAsk = {};
  // ⚠️ Everything after "by", to the end or the next clause boundary, TAKEN AS
  // TYPED. `searchCatalog` folds and scores, so "sanderson", "Brandon Sanderson"
  // and a near-miss spelling are its problem rather than this regex's — and a
  // stricter pattern here would simply lose the askers who cannot spell it.
  const author = q.match(/\bby\s+([^?,.;!]{2,60})/i);
  if (author?.[1]) out.author = author[1].trim();

  const series =
    q.match(/\bin\s+(?:the\s+)?([^?,.;!]{2,60}?)\s+series\b/i) ??
    q.match(/\bfrom\s+(?:the\s+)?([^?,.;!]{2,60})$/i);
  if (!out.author && series?.[1]) out.series = series[1].trim();

  return out;
}

/**
 * Is this short message a continuation of a shelf conversation?
 *
 * ⚠️ **The same three narrowings `booksFollowUp` uses, and deliberately the same
 * shape** — a prior shelf-lane USER turn inside the remembered window, a SHORT
 * message, and either a continuation opener or a reused content word. A follow-up
 * is elliptical by construction, so judging it alone judges it without the half
 * that carries the meaning.
 *
 * ⚠️ **It runs AFTER the book lane's own follow-up router**, and that ordering is
 * a decision rather than an accident: an elliptical message is genuinely
 * ambiguous, the book lane's follow-up router shipped first with its own
 * regression tests, and a new lane must not quietly re-route traffic those tests
 * already pinned. This one claims only what the book lane declined.
 */
const SHELF_FOLLOW_UP_MAX_WORDS = 12;

const SHELF_CONTINUATION_OPENER =
  /^(?:@?[\w-]+[,:]?\s+)?(?:yes|yeah|yep|sure|please|ok|okay|do it|go|go on|go ahead|keep|continue|carry on|again|more|and|also|what about|how about|then|now|list|show|tell|give|what else)\b/i;

const SHELF_FOLLOW_UP_STOPWORDS = new Set([
  'this', 'that', 'they', 'them', 'then', 'there', 'here', 'with', 'from', 'into', 'what', 'when',
  'were', 'will', 'your', 'yours', 'mine', 'have', 'been', 'about', 'would', 'could', 'should',
  'just', 'like', 'know', 'tell', 'want', 'need', 'give', 'make', 'does', 'done', 'said', 'says',
  'more', 'over', 'some', 'only', 'also', 'again', 'please',
]);

function shelfContentWords(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 4 && !SHELF_FOLLOW_UP_STOPWORDS.has(w)),
  );
}

export function shelfFollowUp(
  text: string,
  history: readonly { role: string; text: string }[],
): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  // ⚠️ Already unambiguous alone. Returning true would hide which half of the
  // router decided, and the two are debugged separately.
  if (shelfLaneIntent(q)) return false;
  if (q.split(/\s+/).filter(Boolean).length > SHELF_FOLLOW_UP_MAX_WORDS) return false;

  // ⚠️ Only USER messages are consulted. Her own replies are model prose with no
  // reliable marker, and matching on her wording would make the router depend on
  // what a model happened to say that turn.
  const priorShelfLane = (history ?? []).filter((t) => t.role === 'user' && shelfLaneIntent(t.text));
  if (priorShelfLane.length === 0) return false;

  if (SHELF_CONTINUATION_OPENER.test(q)) return true;

  const mine = shelfContentWords(q);
  return priorShelfLane.some((t) => {
    for (const w of shelfContentWords(t.text)) if (mine.has(w)) return true;
    return false;
  });
}

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
  /**
   * ⚠️ **For REVIEW results: the FULL, UNCAPPED set of reviewed bookIds** — the
   * one thing an exclusion set (was-this-reviewed?) must key off, so a cap meant
   * for a readable MESSAGE never decides which books count as reviewed. Before
   * audit F7 every "not reviewed" / suggestion exclusion was built from the
   * capped 15-row display slice (`rows`), so anyone with >15 reviews had their
   * older-reviewed books counted as unread and suggested back. Undefined for
   * non-review results (TBR) and on a failure.
   */
  allBookIds?: string[];
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

  /**
   * ⚠️ **A SHELF QUESTION THAT GOES WRONG FAILS AS A SHELF QUESTION.** The
   * sentence this replaces was a public-catalogue miss — *"nothing on the
   * estate's public shelf matches that"* — which is a statement about the house
   * offered in reply to a question about the person. It is never phrased as
   * "you have nothing", because a wobble on our side says nothing at all about
   * what is on somebody's list.
   */
  noAnswer:
    "I had a look at your shelf and then lost my thread — that's a wobble on my side rather than an " +
    'answer about your list. Ask me again and I will go back to it.',

  /** ⚠️ The auto-continue sentence, REUSED machinery rather than a second
   *  implementation (design §3): a long list becomes labelled consecutive
   *  messages instead of a permission question. */
  moreToCome:
    "There's more of it than fits here — say the word and I'll carry on from where I stopped.",
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

/**
 * ⚠️ **THE ANTI-INTERVIEW RULE — the 16:25 defect, written where the model will
 * meet it.**
 *
 * She opened a not-read answer by asking the person *"have you worked through
 * Stormlight?"* — a question `my_reviews` answers. Asking somebody for data you
 * already hold is not thoroughness; it is the cheapest move available to a model
 * facing a large question, and it costs the person the answer they asked for.
 *
 * ⚠️ It rides EVERY shelf answer, not just the not-read one, because the same
 * move is available on every question this lane takes.
 */
export const SHELF_NO_INTERVIEW_NOTE =
  '⚠️ DELIVER FIRST, ASK SECOND — NEVER THE OTHER WAY ROUND. Everything about this person\'s shelf ' +
  'that you need is either in the result above or one tool call away, so NEVER open by asking them ' +
  'what they have read, reviewed, started or finished. If a question feels too big to answer, that ' +
  'is a reason to SUMMARISE it, not a reason to interview them. One refining question AFTER a real ' +
  'answer is welcome; a question INSTEAD of one is the failure this note exists to stop.';

/**
 * ⚠️ **THE DELIVERY SHAPE FOR A BIG LIST**, and it exists because her instinct
 * was **half right**: she balked at "a wall of titles", and thirty-eight titles
 * in a Discord message genuinely is one. The half she got wrong was concluding
 * that the alternative was to ask.
 *
 * The alternative is to **group and count**, which is shorter than the wall AND
 * more useful than the interview.
 */
export const SHELF_DELIVER_NOTE =
  '⚠️ HOW TO DELIVER THIS: group by SERIES with counts rather than listing every title — ' +
  '"Stormlight: 4 of 5 not reviewed (you reviewed The Way of Kings)" beats thirty-eight titles and ' +
  'beats a question. LEAD with the series they have actually started, because that is what they ' +
  'most likely meant. Name what they HAVE reviewed as you go: it is the proof you looked, and it is ' +
  'the fact they cannot get anywhere else. Then offer the full list — say you can reel off the rest ' +
  'if they want it — and only THEN, if it is genuinely useful, ask ONE refining question.';

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
