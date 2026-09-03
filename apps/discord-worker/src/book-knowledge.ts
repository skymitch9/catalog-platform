/**
 * **GABI HAS READ THE LIBRARY — the Discord half's contract** (design phase 4,
 * `catalog-platform/docs/info/gabi-book-knowledge-design.md` §4.6).
 *
 * Owner brief, verbatim (2026-08-18): *"I want to be able to ask clarifying
 * questions like what's Jake's current stat sheet at the end of book 12 of
 * Primal Hunter and she has that knowledge cataloged in her memory"*.
 *
 * This file is the whole contract and **holds no credential** — the seam
 * `delegated.ts`/`delegated-exec.ts` established for Tier 1 and
 * `estate-docs.ts`/`estate-docs-exec.ts` widened for the docs corpus, applied a
 * third time. `book-knowledge-exec.ts` is the only module here that touches a
 * secret, and it arrives as an injected port this file cannot construct.
 *
 * ## ⚠️ GABI HOLDS NO PERMISSION OF HER OWN
 *
 * She asserts an **identity** — the email on the `discord_links/{id}` document
 * the person created themselves — and the **audiobook Worker** decides whether
 * that identity may read the household's book text, against the estate
 * directory's `vis_ebooks` grant, using the same `resolveEbookAccessForEmail()`
 * the ebook shelf and the byte streams use. This end relays; it never decides.
 *
 * ## ⚠️ WHY THE CAPS ARE THEIR OWN, AND HEAVIER THAN A CATALOGUE TURN
 *
 * A book turn carries retrieved *prose* — up to 24 KB of somebody's novel.
 * Reusing the existing 20/hour + 200/day fuses unchanged would let this feature
 * quietly cost several times the whole rest of GABI, exactly as the docs build
 * found. A book turn burns one of each existing fuse **and** one of this one.
 *
 * ## ⚠️ WHAT SHE MUST NEVER DO WITH WHAT COMES BACK
 *
 * Retrieved passages are **never** written to the conversation window and never
 * logged — only *how much* was retrieved (design §8). That protects the
 * household's privacy and the copyright posture at once, and it is why
 * `gabi_turn` gains byte counts rather than text.
 */

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AFFIRMATIVE-ONLY**, the exact idiom of `mentionsOn`, `moderationOn`,
 * `delegatedWritesOn` and `docsOn`. `"on"` and nothing else; `"true"`, `"1"`,
 * `"yes"` and every typo mean OFF.
 *
 * ⚠️ **IT SHIPS OFF.** Design §4.6 pins this: *"Posture `GABI_BOOKS`,
 * affirmative-only `on` — ships dark."* Flipping it is the owner's own
 * deliberate act (design §9, owner step 2), never a side effect of a deploy.
 *
 * ⚠️ OFF does not mean silent. With this off she still says, in words, that her
 * reading is switched off — a question about a book's contents must never fall
 * through to a catalogue lookup that returns a narrator and reads as an answer.
 */
export function booksOn(env: Pick<Env, 'GABI_BOOKS'>): boolean {
  return (env.GABI_BOOKS ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// ⚠️ THE SCOPE BOUND — derived from the QUESTION, deterministically, here
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE CEILING COMES FROM THE QUESTION AND IS NEVER STORED** (design §4.3).
 *
 * An `ord` is only meaningful relative to the chunking that produced it: the
 * pilot measured a ceiling carried across a re-chunk **leaking twenty-eight
 * chapters of book 2 past the reader's position**, with no error anywhere and
 * nothing in the answer looking wrong. So the bound is re-derived every turn,
 * and this function is where the *question's* half of that derivation happens.
 *
 * ⚠️ **It is deterministic and it is NOT the model's decision.** A model asked
 * to choose its own spoiler scope will choose the generous one, because the
 * generous one answers the question better. The same reasoning that makes
 * `delegated.ts` fire on a checksummed ISBN rather than on a model's reading.
 *
 * Two outcomes only, because only two are honest:
 *
 * | The question says | Bound | Why |
 * |---|---|---|
 * | an endpoint — "at the end of", "by the end", "in the whole book", "I've finished" | `whole_book` | they asked for the end; §4.3's `whole_book` row |
 * | "up to chapter N", "through chapter N", "I'm on chapter N" | `through_chapter` | the reader named their own place |
 * | anything else | **`unknown`** | ⚠️ absence of a stated bound means UNKNOWN, never "unread" and never "finished" (§4.5) — and the route answers with the sentence she has to say |
 */
/**
 * ⚠️ WHICH RUNG OF THE LADDER (§3) DECIDED THIS BOUND — and **only the rung that
 * needs a SENTENCE is recorded**.
 *
 * `rating` is the one rung derived from a STORE rather than from what the person
 * just typed, so it is the only one they might disagree with and the only one
 * that has to be disclosed (§3.2). A bound that came from their own words needs
 * no `how`: it is already in the conversation, and adding one would have changed
 * a shape three regression tests deep-equal against for no gain.
 */
export type BoundHow = 'rating';

export type QuestionBound =
  | { scope: 'whole_book'; how?: BoundHow }
  | { scope: 'through_chapter'; chapter: number; how?: BoundHow }
  | { scope: 'unknown' };

/**
 * ⚠️ **WIDENED 2026-09-03 (§3.1) AFTER A LIVE MISS.** The owner said *"I've read
 * them all"* and it landed on `unknown`, because the old pattern was
 * `i've (read|finished) (it|the whole)` — **it failed on the OBJECT**. "them
 * all", "all of them", "the series" are how a person in the middle of a series
 * actually says they are finished with it, and none of them were here.
 *
 * ⚠️ **Tightened at the same time so bare *"I read"* does NOT fire.** "I read
 * fantasy" and "I read that in book 3" are not endpoint statements, so the
 * object or the quantifier is REQUIRED — the verb alone never is. And a series
 * statement is `whole_book` for every book of the series, which is safe only
 * because it is re-derived per turn from what they just typed and never stored.
 */
const ENDPOINT_RE =
  /\b(at|by|towards?|near)\s+the\s+end\b|\bend\s+of\s+(the\s+)?book\b|\bwhole\s+book\b|\bentire\s+book\b|\bfinished\s+(it|the\s+book|the\s+series|them|them\s+all)\b|\bfinal\s+chapter\b|\bhow\s+does\s+it\s+end\b|\b(?:i'?ve|i\s+have|i)\s+(?:read|finished)\s+(?:it|this|these|them|the\s+whole|the\s+entire|all\s+of\s+(?:it|them)|the\s+series|the\s+lot)\b|\b(?:i'?ve|i\s+have|i)\s+(?:read|finished)\s+(?:it|them|this|these)\s+all\b|\b(?:read|finished)\s+the\s+(?:whole|entire)\s+(?:series|lot|thing|book)\b|\b(?:the\s+)?(?:whole|entire)\s+(?:series|lot|thing)\b|\bcaught\s+up\b/i;

/** ⚠️ `i've read chapter 5` was ADDED 2026-09-03 alongside the endpoint widening,
 *  and it has to be here rather than there: the two patterns now share the verb,
 *  and a reader who names a CHAPTER has told you something more specific than a
 *  reader who says they finished. Chapter outranks endpoint (§3, row 1 over row
 *  2), so this pattern must claim the sentence FIRST or the widened endpoint
 *  would swallow "I've read chapter 5" and serve the whole book. */
const CHAPTER_RE =
  /\b(?:up\s+to|through|before|by|i'?m\s+(?:on|at|in)|i\s+am\s+(?:on|at|in)|as\s+far\s+as|i'?ve\s+(?:read|finished)|i\s+(?:have\s+)?(?:read|finished))\s+chapter\s+(\d{1,3})\b/i;

export function boundFromQuestion(text: string): QuestionBound {
  const q = (text ?? '').trim();
  const chapter = q.match(CHAPTER_RE);
  if (chapter?.[1]) {
    const n = Number(chapter[1]);
    // ⚠️ Round DOWN to the chapter BEFORE the one they are inside. "I'm on
    // chapter 19" means chapter 19 is unfinished. Design §4.3: an answer that
    // stops one chapter short costs a follow-up question; one that runs one
    // chapter long costs them the book.
    const inside = /\bi'?m\s+(?:on|at|in)|i\s+am\s+(?:on|at|in)/i.test(chapter[0]);
    return { scope: 'through_chapter', chapter: Math.max(0, inside ? n - 1 : n) };
  }
  if (ENDPOINT_RE.test(q)) return { scope: 'whole_book' };
  return { scope: 'unknown' };
}

// ---------------------------------------------------------------------------
// ⚠️ THE READ-STATE LADDER — `deriveBound`, design §3, first hit wins
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE 2026-09-03 DEFECT, IN ONE SENTENCE: the bound was derived from the
 * QUESTION STRING ONLY, so a person who has RATED a book still read as
 * `unknown` and got asked how far he had got.** The owner: *"It doesn't know
 * that I've read the books even though I have it rated and I've linked."*
 *
 * The ladder (§3), first hit wins, and **the question always outranks the
 * store** — a sentence is live, a store is a record:
 *
 * | # | Source | → |
 * |---|---|---|
 * | 1 | the question names a chapter | `through_chapter`, rounded down |
 * | 2 | the question states an endpoint | `whole_book` |
 * | 3–6 | reading positions / club progress | ⚠️ **NOT REACHABLE — see below** |
 * | 7 | the asker's OWN `reviews` doc for THAT `bookId`, with a valid rating | `whole_book`, `how: 'rating'` |
 * | 8 | nothing | `unknown` — never "unread" and never "finished" |
 *
 * ⚠️ **ROWS 3–6 ARE DELIBERATELY ABSENT, NOT FORGOTTEN.** Row 3/4 need
 * `readingPositions/{uid}_{bookId}`, which has **no read seam from this Worker
 * and is an EMPTY collection** (`RECOVERY.md`); rows 5/6 need club progress,
 * which has no read path and whose `/progress` command is dark (KI-13). Stubbing
 * a data path for either would be a fake measurement wearing a real one's
 * clothes. They are TODOs with their design row numbers and nothing else:
 *
 *   TODO(§3 row 3) `readingPositions` progress ≥ 0.98 ⇒ `whole_book`.
 *   TODO(§3 row 4) `readingPositions` progress < 0.98 ⇒ `through_ord`, derived
 *     THIS turn against this pack's chapter table and sent with `iv=` — the
 *     route refuses a version mismatch, and that refusal is the whole guard.
 *   TODO(§3 row 5) club `finished == true` ⇒ `whole_book`.
 *   TODO(§3 row 6) club `chapterIndex` ⇒ `through_chapter`.
 *
 * ⚠️ **A FAILED OR ABSENT SHELF READ FALLS TO `unknown`, NEVER TO
 * `whole_book`** (§3.2). `unknown` is not "no limit": it is "nobody said", and
 * the route answers it with the sentence she has to say. Reading the store
 * wrongly must never be the generous direction.
 */
export interface BooksReadState {
  /** ⚠️ FALSE when the shelf read failed, was never made, or the port is absent.
   *  A false here can only ever produce `unknown`. */
  ok: boolean;
  /** The asker's display name, as `myReviews` matched on. Compared FOLDED. */
  displayName?: string;
  /** The asker's own review rows. ⚠️ `rating` is `unknown` on purpose — see
   *  `validRating`. */
  reviews?: readonly { bookId?: string; displayName?: string; rating?: unknown }[];
}

/** ⚠️ **`rating` IS A STRING ON SOME DOCUMENTS AND A NUMBER ON OTHERS** —
 *  measured 2026-09-03 against the live `reviews` collection: `"5"` on two of
 *  three documents, `4.5` on the third. `typeof rating === 'number'` would have
 *  read the owner's own five-star DCC review as "no rating" and asked him how
 *  far he had got, which is the exact defect this ladder exists to fix.
 *
 *  ⚠️ **NO RATING FLOOR** (§3.2). A 0.5 is still a finished book. Only a rating
 *  that is absent, unparseable or zero is not evidence of having read it. */
export function validRating(rating: unknown): boolean {
  if (rating === null || rating === undefined || rating === '') return false;
  if (typeof rating === 'boolean') return false;
  const n = Number(rating);
  return Number.isFinite(n) && n > 0;
}

/** ⚠️ Folded exactly as the reviews join folds — the store is keyed by display
 *  name and nothing else (`submitReview` writes no uid and no email), so the
 *  comparison has to survive a capital letter and a stray space. */
function foldName(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

/**
 * ⚠️ **ROW 7, APPLIED TO ONE BOOK.** The ladder's store rung is per-`bookId` and
 * never per-series, so it can only be resolved once a specific book is being
 * queried — which is at TOOL-CALL time, not at turn time. This is the function
 * the executor calls with the id it is about to send.
 *
 * ⚠️ The turn's own bound wins whenever it said anything at all: rows 1–6
 * outrank row 7, which is what makes "I DNF'd it at chapter 12 but rated it"
 * come out at chapter 12 rather than at the end.
 */
export function boundForBook(
  bound: QuestionBound,
  readState: BooksReadState | null | undefined,
  bookId: string,
): QuestionBound {
  if (bound.scope !== 'unknown') return bound;
  if (!readState?.ok || !bookId) return bound;
  const me = foldName(readState.displayName);
  if (!me) return bound;
  const rated = (readState.reviews ?? []).some(
    (r) =>
      // ⚠️ THE ASKER'S OWN REVIEW ONLY. The query is already filtered by name;
      // this is the second check, and it is here because a widening of that
      // query must not silently become a widening of whose reading counts.
      foldName(r.displayName) === me &&
      typeof r.bookId === 'string' &&
      r.bookId.trim() === bookId.trim() &&
      validRating(r.rating),
  );
  return rated ? { scope: 'whole_book', how: 'rating' } : bound;
}

/**
 * The whole ladder. `bookId` is optional because the TURN-level bound is derived
 * before any book is chosen — pass it and row 7 becomes reachable; leave it out
 * and this is rows 1, 2 and 8.
 */
export function deriveBound(
  text: string,
  readState?: BooksReadState | null,
  bookId?: string,
): QuestionBound {
  const fromQuestion = boundFromQuestion(text);
  if (fromQuestion.scope !== 'unknown') return fromQuestion;
  return bookId ? boundForBook(fromQuestion, readState, bookId) : fromQuestion;
}

/** The bound as the route's query parameters. ⚠️ Only the WORD crosses this
 *  line — never an `ord` — so the 28-chapter re-chunk leak (design §4.3) cannot
 *  apply to a bound derived from a rating. */
export function boundParams(bound: QuestionBound): Record<string, string> {
  if (bound.scope === 'whole_book') return { scope: 'whole_book' };
  if (bound.scope === 'through_chapter') {
    return { scope: 'through_chapter', chapter: String(bound.chapter) };
  }
  return { scope: 'unknown' };
}

// ---------------------------------------------------------------------------
// ⚠️ THE PRE-ROUTER — "what happens in it" is not "what do we have"
// ---------------------------------------------------------------------------

/**
 * ⚠️ **HOW A BOOK GETS NAMED, INCLUDING WITHOUT ITS TITLE** (incident §12b —
 * the owner's first live book question, 2026-08-18).
 *
 * He asked about *"the **9th book**"*. Every anchor below existed in the form
 * `book 9` and none in the form `9th book`, and that is a third of why the
 * question missed. An ordinal is how people actually refer to a volume in a
 * series they are in the middle of.
 */
const ORDINAL_WORDS =
  'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|last|final';
const NUMBER_WORDS =
  'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen';
/** `book 9`, `book nine`, `vol. 3`. */
const BOOK_N = new RegExp(
  `\\b(?:book|volume|vol\\.?|part|installment)\\s*(?:\\d{1,2}|${NUMBER_WORDS})\\b`,
  'i',
);
/** `9th book`, `the ninth book`, `the last book`. */
const NTH_BOOK = new RegExp(
  `\\b(?:\\d{1,2}(?:st|nd|rd|th)|${ORDINAL_WORDS})\\s+(?:book|volume|part|installment)\\b`,
  'i',
);

/**
 * The nouns a LitRPG question asks for by name.
 *
 * ⚠️ **`status` sits beside `stat`, and that one missing word is what sent the
 * owner's first live question to the catalogue.** The books use both — the
 * Primal Hunter transcripts say *"he checked his **status** menu"* — so a
 * detector that knows only `stat sheet` does not know the word the reader is
 * holding while they type.
 */
const SHEET_NOUNS = 'sheet|block|screen|page|menu|window|panel';
const ATTRIBUTE_NOUNS =
  'stats?|status|level|levels|class|classes|rank|ranks|build|builds|skills?|inventory|titles?|powers?|abilities|profession';
/** The same list minus `title`, for the WEAK half — see the note beside it. */
const WEAK_ATTRIBUTE_NOUNS =
  'stats?|status|level|levels|class|classes|rank|ranks|build|builds|skills?|inventory|powers?|abilities|profession';

/**
 * Questions that are unmistakably about a book's CONTENTS. ⚠️ Each of these is
 * a sentence the catalogue cannot answer at all: it records a narrator, a
 * running time and a series position, and nothing whatsoever about the story.
 */
const BOOKS_STRONG = [
  /\b(what|who|where|when|why|how)\b[^?]*\bin (book|chapter|volume) \d/i,
  // ⚠️ `stat sheet` AND `status sheet` — the 2026-08-18 miss, in one word.
  new RegExp(`\\b(?:stat|status)\\s*(?:${SHEET_NOUNS})\\b`, 'i'),
  // ⚠️ WAS `at the end of (book|the book|chapter)`, which required a book word
  // IMMEDIATELY after `of`. "at the end of **the 9th** book" has two words in
  // between, so it missed. Now the endpoint phrase and the book word merely
  // have to be in that order in the same sentence.
  /\b(?:at|by|towards?|near)\s+the\s+end\s+of\b[^?]*\b(book|volume|part|series|chapter|it)\b/i,
  /\bwhat happens\b/i,
  /\bhow does (it|the book|the series) end\b/i,
  /\b(remind me|refresh my memory)\b[^?]*\b(what|who|where|how)\b/i,
  /\bwho (is|was|are|were)\b[^?]*\b(in|from) (the )?(book|series|chapter)\b/i,
  /\bfirst (appear|appears|appearance|meet|meets|introduced|mentioned)\b/i,
  /\bdoes .* (ever )?(appear|show up|come up|get mentioned)\b/i,
  /\bquote\b[^?]*\bfrom (the )?book\b/i,
  new RegExp(`\\bwhat (?:${ATTRIBUTE_NOUNS}) (?:is|does|did|was|were|are)\\b`, 'i'),
  // ⚠️ **A CHARACTER'S POSSESSIVE PLUS AN ATTRIBUTE — "jakes status sheet".**
  // The apostrophe is optional because nobody types one into a DM. This is the
  // shape that identifies a book by its CHARACTER instead of its title, and the
  // catalogue cannot answer it even in principle: it holds no character names.
  new RegExp(`\\b[a-z][\\w'’-]*'?s\\s+(?:${ATTRIBUTE_NOUNS}|${SHEET_NOUNS})\\b`, 'i'),
];

/** Questions about the SHELF, not the story. ⚠️ Kept local rather than shared
 *  with the docs detector for the reason `estate-docs.ts` gives: a shared list
 *  would make one feature's tuning silently move the other's boundary. */
const BOOKS_SHELF_SHAPED = [
  /\bdo (we|you|i) (have|own)\b/i,
  /\bhave (we|you|i) got\b/i,
  /\bon the (shelf|shelves)\b/i,
  /\bin the (catalogue|catalog|library|collection)\b/i,
  /\bhow (long|many hours)\b/i,
  /\bwho narrat/i,
  /\bwhat (order|number)\b/i,
];

/** The weaker half — a book-ish verb that only counts when something anchors it
 *  to a specific book or chapter. */
const BOOKS_WEAK = [
  /\b(chapter|prologue|epilogue|plot|character|characters|scene|passage|storyline)\b/i,
  // ⚠️ **`say` AND the two counting phrases were ADDED 2026-09-03**, and their
  // absence is measured: *"how often does Carl say God Damnit Donut … in dungeon
  // crawler Carl book 1"* missed this router entirely. `said|says` were here;
  // the bare infinitive `say` — the form every "does X ever say Y" question uses
  // — was not, and neither was any way of asking HOW MANY. The anchors matched;
  // one missing word decided the lane.
  /\b(happens?|happened|say|said|says|kills?|killed|dies?|died|fights?|meets?|becomes?)\b/i,
  /\bhow\s+(?:often|many\s+times)\b/i,
  // ⚠️ The LitRPG nouns, weak on their own and needing an anchor.
  // ⚠️ **`title` is deliberately ABSENT here** while staying in the STRONG
  // possessive pattern above. "Jake's titles" is a LitRPG award; *"what's the
  // title of book 3"* is a CATALOGUE question, and one word decides which lane
  // a reader lands in.
  new RegExp(`\\b(?:${WEAK_ATTRIBUTE_NOUNS})\\b`, 'i'),
];

const BOOKS_ANCHOR = [
  BOOK_N,
  // ⚠️ ADDED after the 2026-08-18 miss. `9th book`, `the ninth book`.
  NTH_BOOK,
  /\bchapter \d/i,
  /\bin ["“][^"”]{3,}["”]/i,
  /\bin (the )?(book|series|story|novel)\b/i,
  /\b(primal hunter|way of kings|stormlight|mistborn|dungeon crawler)\b/i,
];

/**
 * Does this message want the TEXT of a book rather than its catalogue row?
 *
 * ⚠️ **Narrow on purpose**, exactly as `docsIntent` is. A false positive
 * answers *"do we have any Sanderson"* with a spoiler-scoped text search that
 * finds nothing; a false negative merely leaves the model to reach for the
 * tools itself, which is the ordinary behaviour and is still available — the
 * tools stay offered on any `question` turn once the posture is on.
 *
 * ⚠️ **The shelf exclusions win over the weak half but NOT over the strong
 * half.** *"What happens in book 3 of the series we have?"* is a contents
 * question with shelf words in it, and answering it from the catalogue is the
 * exact failure §4.5 row 4 is about.
 */
/**
 * ⚠️ **DOES THIS SEARCH WANT A STAT BLOCK?** — measured 2026-08-18, live.
 *
 * `book-retrieval.ts` has its own `looksLikeStatQuestion()` and it has the SAME
 * blind spot this module's router had: it fires on *"stat sheet"* and not on
 * *"status sheet"*, which is the word the Primal Hunter transcripts actually
 * use. Measured on book 9, `mode=latest`, `q="status sheet"`:
 *
 * | | top hits |
 * |---|---|
 * | detector auto (off) | ord 1800 `stat_keys: 0`, 1795 `12`, 1649 `0` — passages that MENTION the words |
 * | detector forced on | ord 1796 `stat_keys: 12`, 403 `12` — actual stat BLOCKS |
 *
 * The route already accepts `stat_block=true` as an override, so the fix is to
 * ASK for it rather than to reach across into the other Worker's detector. ⚠️
 * Only ever `true`: an unset value leaves the route's own judgement in place,
 * and sending `false` would suppress a detector that was right.
 */
const STAT_QUERY_RE = new RegExp(
  `\\b(?:(?:stat|status)\\s*(?:${SHEET_NOUNS})|${WEAK_ATTRIBUTE_NOUNS})\\b`,
  'i',
);

export function looksLikeStatQuery(query: string): boolean {
  return STAT_QUERY_RE.test((query ?? '').trim());
}

export function booksIntent(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  if (BOOKS_STRONG.some((re) => re.test(q))) return true;
  if (BOOKS_SHELF_SHAPED.some((re) => re.test(q))) return false;
  return BOOKS_WEAK.some((re) => re.test(q)) && BOOKS_ANCHOR.some((re) => re.test(q));
}

// ---------------------------------------------------------------------------
// ⚠️ THE FOLLOW-UP — a lane belongs to the CONVERSATION, not to one sentence
// ---------------------------------------------------------------------------

/**
 * ⚠️ **INCIDENT 2026-08-18 (design §10c): SHE INVITED A FOLLOW-UP AND THEN
 * ROUTED IT TO THE SHELF.**
 *
 * Her own turn ended *"I'll dig into it fresh if you want — just say the
 * word!"*. The owner said the word — *"dig fresh into jake sheet"* — and the
 * per-message detector, seeing five words it had never met, sent it to the
 * catalogue.
 *
 * ⚠️ **The defect is that `booksIntent` is STATELESS on a surface that has a
 * memory.** A follow-up is elliptical BY CONSTRUCTION: it omits everything the
 * previous turn established, which is precisely the material the detector needs.
 * Judging it alone judges it without the half that carries the meaning — and an
 * assistant that offers a retry and then cannot recognise the acceptance is
 * worse than one that never offered.
 *
 * So the lane is a property of the CONVERSATION. Nothing here fires without a
 * prior book-lane turn inside the remembered window (`gabi-conversation`'s 30
 * minutes — the same store and the same window in a channel and in a DM).
 *
 * ⚠️ **Narrow three ways at once**, because a wrong continuation is worse than a
 * missed one — it answers a catalogue question out of a novel:
 *
 *  1. a prior USER message in the window must itself be book-lane;
 *  2. the follow-up must be SHORT — a long sentence carries its own subject and
 *     is judged on that;
 *  3. it must either OPEN like a continuation ("dig…", "yes", "go on") or reuse
 *     a content word from the book-lane turn it continues.
 *
 * ⚠️ And a shelf-shaped follow-up still goes to the shelf: *"do we have book
 * 10?"* after a book conversation is a catalogue question. A lane may not
 * capture people.
 */
const FOLLOW_UP_MAX_WORDS = 12;

const CONTINUATION_OPENER =
  // ⚠️ `say the word` is here because SHE SAYS IT — `BOOKS_MSG.turnBudgetSpent`
  // and her own prose offer the retry in those words, so the acceptance comes
  // back in them too. An opener list that does not contain the phrases the
  // assistant itself uses is a list that cannot hear its own invitations.
  /^(?:@?[\w-]+[,:]?\s+)?(?:yes|yeah|yep|sure|please|ok|okay|do it|go|go on|go ahead|keep|continue|carry on|again|more|and|also|what about|how about|then|now|dig|look|search|check|find|read|pull|get|show|tell|give|try|say the word)\b/i;

/** ⚠️ Glue, not subjects. Matching on these would make every short sentence a
 *  continuation of every other one. */
const FOLLOW_UP_STOPWORDS = new Set([
  'this', 'that', 'they', 'them', 'then', 'there', 'here', 'with', 'from', 'into', 'what', 'when',
  'were', 'will', 'your', 'yours', 'mine', 'have', 'been', 'about', 'would', 'could', 'should',
  'just', 'like', 'know', 'tell', 'want', 'need', 'give', 'make', 'does', 'done', 'said', 'says',
  'more', 'over', 'some', 'only', 'also', 'fresh', 'again', 'please',
]);

/** Words long enough to be a subject rather than glue. */
function contentWords(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .filter((w) => w.length >= 4 && !FOLLOW_UP_STOPWORDS.has(w)),
  );
}

/**
 * Is this short message a continuation of a book conversation?
 *
 * `history` is the remembered window, oldest first. ⚠️ **Only USER messages are
 * consulted.** Her own replies are model prose with no reliable marker, and
 * matching on her wording would make the router depend on what a model happened
 * to say that turn.
 */
export function booksFollowUp(
  text: string,
  history: readonly { role: string; text: string }[],
  opts: {
    /**
     * ⚠️ **THE PREDECESSOR SPENT BOOK BUDGET** (§3.3, item 1). The original rule
     * — *a prior USER turn must itself pass `booksIntent`* — has a hole the
     * 2026-09-03 incident fell straight through: turn 1 opened a book and turn 1
     * did NOT pass the detector (`say` was missing from `BOOKS_WEAK`), so the
     * follow-up had no lane to continue and the whole exchange left the books
     * path.
     *
     * ⚠️ **What a book was actually OPENED for is a fact; what a sentence looked
     * like to a regex is an opinion.** So a turn that spent book budget counts as
     * a book-lane turn whatever its text scored — the fuse is the evidence.
     */
    priorBookBudget?: boolean;
  } = {},
): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  // ⚠️ Already unambiguous alone. Returning true here would hide which half of
  // the router decided, and the two are debugged separately.
  if (booksIntent(q)) return false;
  // ⚠️ A shelf question stays a shelf question, however book-ish the context.
  if (BOOKS_SHELF_SHAPED.some((re) => re.test(q))) return false;

  if (q.split(/\s+/).filter(Boolean).length > FOLLOW_UP_MAX_WORDS) return false;

  const priorBookLane = (history ?? []).filter((t) => t.role === 'user' && booksIntent(t.text));
  if (priorBookLane.length === 0 && !opts.priorBookBudget) return false;

  if (CONTINUATION_OPENER.test(q)) return true;
  // ⚠️ A budget-proven predecessor with no detector-matching text has no content
  // words to compare against, so an elliptical reply is taken on the budget
  // alone. It is still bounded by the two narrowings above — short, and not
  // shelf-shaped — which is what keeps the lane from capturing people.
  if (priorBookLane.length === 0) return true;

  const mine = contentWords(q);
  return priorBookLane.some((t) => {
    for (const w of contentWords(t.text)) if (mine.has(w)) return true;
    return false;
  });
}

// ---------------------------------------------------------------------------
// The caps — design §4.6. Each is its own fuse; none replaces another.
// ---------------------------------------------------------------------------

/** Passages one search may return. */
export const BOOKS_SEARCH_HITS = 6;

/** ⚠️ How many books one presence roll-up may span. Mirrors
 *  `book-routes.ts`'s `MAX_PRESENCE_BOOKS`, and is checked HERE too so an
 *  over-long list is a worded refusal the model can act on rather than a 400 it
 *  has to interpret. Each book is one R2 GET on the other end; a fourteen-book
 *  series asked in one call is how a bounded feature becomes an unbounded one. */
export const BOOKS_PRESENCE_MAX = 6;

/**
 * ⚠️ **THE COUNT CAPS — mirrored from `book-retrieval.ts`'s own
 * `MAX_COUNT_VARIANTS` / `MAX_COUNT_QUOTES`, and clamped HERE as well.**
 *
 * The route clamps rather than refuses (asking for eight spellings is a caller
 * being optimistic, not wrong), and this end clamps too so the model is never
 * handed a silently different answer from the one it asked for. Two ends, same
 * numbers, and the test pins that they agree.
 *
 * Six spellings, because a transcript renders a catchphrase two or three ways
 * and a printed book a fourth. Three quotes, because a count's job is the
 * NUMBER — the quotes are evidence it is real, not the answer.
 */
export const MAX_COUNT_VARIANTS = 6;
export const MAX_COUNT_QUOTES = 3;

/** ⚠️ How many books the knowledge-base listing hands a model at once. The
 *  listing is a discovery step, not an answer — a model shown 182 rows spends
 *  its output budget reciting them. */
export const BOOKS_LIST_LIMIT = 25;

/**
 * ⚠️ **THE PER-TURN RETRIEVAL CEILING — 48 KB and at most 12 passages.**
 *
 * ⚠️ **RAISED FROM 24 KB / 6 ON 2026-08-18 BY OWNER DECISION** (*"I think c"* —
 * both a modest raise and auto-continue). What it was measured against: he asked
 * for the end-of-book-9 sheet **plus abilities plus passives**, she delivered
 * core stats, titles and twenty class skills, and then ran out at profession
 * skills. A late-book abilities list simply spans more chunks than one 24 KB
 * turn holds.
 *
 * ⚠️ **The number is not arbitrary — it is TWICE THE ROUTE'S OWN PER-REQUEST
 * CEILING, and that is why it is clean.** `book-retrieval.ts` caps a single
 * search at `MAX_SEARCH_BYTES` = 24 KB and `MAX_PASSAGES` = 6, and clamps the
 * `limit` parameter to 6 regardless of what is asked. So one search can never
 * exceed half of this, and a turn is exactly *two full searches* — the shape of
 * the question that broke it (the sheet, then the abilities). Picking 10 would
 * have made the second search silently partial.
 *
 * ≈12k input tokens at bytes÷4. Counted across the WHOLE turn, not per call: one
 * assistant turn may emit several `tool_use` blocks at once, and a budget that
 * reset between tool-loop iterations would not be a budget.
 *
 * ⚠️ **It still REFUSES rather than trims**, and the refusal still says the
 * passage was NOT read. A silently truncated passage is a plot point missing the
 * sentence that mattered. What changed is that hitting it no longer asks
 * permission to continue — see `BOOKS_MSG.moreToCome`.
 */
export const BOOKS_BYTES_PER_TURN = 48 * 1024;
export const BOOKS_PASSAGES_PER_TURN = 12;

/**
 * ⚠️ **HOW MANY CONSECUTIVE PASSAGES ONE `read_book_passage` CALL MAY WALK.**
 *
 * This is the mechanism that broke the 1:31 PM loop. He asked *"get professions
 * too"*, she re-ran the same search, the same top hit ranked first again, she
 * re-printed the whole sheet and ran out at the same place. **Re-running a query
 * to continue is an infinite loop by construction** — a ranked search returns
 * its best match forever, and the tail is never the best match.
 *
 * Continuing is a POSITION problem, not a relevance problem, so it is answered
 * by ordinals: read `ord + 1`, `ord + 2`, … from where the last passage stopped.
 * Four at a time is a section of a stat sheet and four subrequests, well inside
 * the Worker's ceiling.
 */
export const BOOKS_PASSAGE_RUN_MAX = 4;

/**
 * ⚠️ **HOW MANY DISCORD MESSAGES ONE ANSWER MAY BECOME.**
 *
 * Auto-continue means she stops asking permission to keep going — but an answer
 * that can become unlimited consecutive messages is a way to serially dump a
 * book into a channel, which is the exact posture the `vis_ebooks` gate exists
 * to hold. Four messages is a long stat sheet with its skills; past that she
 * says where the whole thing lives instead.
 */
export const BOOKS_MAX_REPLY_PARTS = 4;

/**
 * ⚠️ **THE FOURTH FUSE — book turns per person per UTC day** (design §4.6).
 * Its own counter in its own key namespace, exactly as the docs and write caps
 * are. A turn is fractions of a cent; a docs turn is ~6k tokens of runbook; a
 * book turn is ~6k tokens of somebody's novel; a write is a row in a catalog.
 * One shared counter would price all four wrongly.
 */
export const BOOKS_TURNS_PER_DAY = 40;

export type BooksCapVerdict = { ok: true } | { ok: false; message: string };

export function booksCapDecision(turnsToday: number): BooksCapVerdict {
  if (turnsToday >= BOOKS_TURNS_PER_DAY) return { ok: false, message: BOOKS_MSG.capped };
  return { ok: true };
}

export interface BooksBudget {
  /** Ask for room. Returns false when the turn has spent its ceiling. */
  take(bytes: number, passages: number): boolean;
  /** What has been spent — the two numbers `gabi_turn` records. ⚠️ Counts, never
   *  the text: a retrieved passage is never logged and never stored. */
  spent(): { bytes: number; passages: number };
  /** Whether this turn touched a book at all — what decides if the daily fuse is
   *  charged. A turn where she never opened one is not a book turn. */
  used(): boolean;
}

export function makeBooksBudget(): BooksBudget {
  let bytes = 0;
  let passages = 0;
  let calls = 0;
  return {
    take(b, p) {
      if (bytes + b > BOOKS_BYTES_PER_TURN) return false;
      if (passages + p > BOOKS_PASSAGES_PER_TURN) return false;
      bytes += b;
      passages += p;
      calls += 1;
      return true;
    },
    spent: () => ({ bytes, passages }),
    used: () => calls > 0,
  };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * ⚠️ Every sentence here is load-bearing product copy, not a status string. The
 * four causes are kept apart because the FIXES differ, and the last two are the
 * ones this feature exists to get right:
 *
 * - **not ingested** ≠ **not in the book**. One is a gap in what she has read;
 *   the other is a fact about the story. Collapsing them is how "that never
 *   happens" gets said about a book nobody has processed yet.
 * - **past your position** ≠ **not in the book**. One is a spoiler boundary and
 *   the other is a gap on the shelf (design §6.3 criterion 6).
 */
// ---------------------------------------------------------------------------
// ⚠️ A FRESH ASK IS NOT A CONTINUATION — the 14:06 stale anchor
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE 14:06 TRANSCRIPT.** *"Show me Jake's most recent character sheet"* was
 * answered with **"[Continuing Jake's sheet — Profession Skills onwards]"** — a
 * continuation of a listing that had stopped **thirty-four minutes earlier**.
 *
 * ⚠️ **NO DETECTOR DID THIS.** `booksIntent` claims that sentence outright, so
 * `booksFollowUp` never even ran. The continuation came from the MODEL: the
 * conversation window still held the 13:32 partial sheet (the window measures
 * thirty minutes from the LAST word, so an active chat keeps everything in it),
 * and a model that can see where a listing stopped will helpfully resume it.
 *
 * The result is worse than a wrong answer: the person asked for the *most
 * recent* sheet and got the *tail of an old one*, labelled as though they had
 * asked to continue. Nothing in the reply says which sheet it is.
 *
 * ⚠️ **THE FIX IS A DETERMINISTIC SIGNAL, NOT A STERNER PROMPT.** This function
 * decides — in code, from the sentence — whether the turn is elliptical enough
 * to BE a continuation. A self-contained question never is, and the grounding
 * then says so in a line the model cannot miss.
 */
export function continuationShape(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  // A long sentence carries its own subject and is a fresh ask by construction.
  if (q.split(/\s+/).filter(Boolean).length > FOLLOW_UP_MAX_WORDS) return false;
  // ⚠️ An imperative with a real subject — "show me Jake's sheet" — is a fresh
  // ask however short it is. Only an OPENER with nothing much after it, or a
  // bare fragment, is genuinely elliptical.
  if (BOOKS_FRESH_IMPERATIVE.test(q)) return false;
  return CONTINUATION_OPENER.test(q) || q.split(/\s+/).filter(Boolean).length <= 3;
}

/** ⚠️ "show me X", "what is X", "give me X" — a request that NAMES its object is
 *  a new question, even when it is short and even when the object was discussed
 *  before. This is the pattern the 14:06 ask matched and the continuation
 *  reading ignored. */
const BOOKS_FRESH_IMPERATIVE =
  /\b(?:show|give|tell|get|find|pull|fetch|list)\s+(?:me\s+)?(?:the\s+|a\s+|an\s+|his\s+|her\s+|their\s+|my\s+|\w+['’]s\s+)?\w+/i;

/**
 * ⚠️ Appended when the turn is a FRESH ask and the window still holds an earlier
 * book exchange — the exact condition that produced the 14:06 answer.
 */
export const BOOKS_FRESH_ASK_NOTE =
  '⚠️ THIS IS A FRESH QUESTION, NOT A CONTINUATION. There is an earlier book exchange in the ' +
  'conversation above, and it is NOT what was just asked for. Do NOT label your answer as ' +
  '"continuing" anything, do NOT resume a listing that stopped earlier, and do NOT pick up from ' +
  'where a previous sheet left off. Answer THIS question from a search you run NOW, and say which ' +
  'book and chapter the answer came from. ⚠️ If they wanted the rest of an earlier list they will ' +
  'say so in words that only make sense as a continuation — this was not one of those.';

// ---------------------------------------------------------------------------
// ⚠️ THEMATIC QUESTIONS — where passage search stops being enough
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE 14:15 CONFABULATION, AND WHY IT IS A DIFFERENT FAILURE FROM THE
 * OTHERS.**
 *
 * Asked how Carmen and Jake's relationship develops across the series, she said
 * she had *"read through book 14"* and narrated a romance arc spanning books
 * 11–14. The owner corrected her immediately: it did not happen.
 *
 * ⚠️ **NOTHING WAS BROKEN.** The tools ran, the gate held, passages came back.
 * The defect is the shape of the QUESTION against the shape of the INSTRUMENT:
 *
 * | question | why it works, or does not |
 * |---|---|
 * | *"what is Jake's level at the end of book 9"* | one passage contains the answer |
 * | *"how does their relationship develop"* | ⚠️ **no passage contains the answer.** It is distributed across thousands of pages, and top-K search returns a handful of the densest mentions |
 *
 * A model handed six scattered snippets and asked about an ARC does the thing it
 * is best at: **it joins them into a narrative**. The joins are invention, they
 * are fluent, and they are indistinguishable from the retrieved parts — which is
 * worse than saying nothing, because the reader cannot see the seam.
 *
 * ⚠️ **THE FIX IS NOT A STERNER PROMPT ABOUT HONESTY** — that is the category of
 * hope this estate has rejected three times already. It is a **reporting
 * obligation**: on a thematic question she must say, per book, what her searches
 * actually returned, so sparseness becomes part of the answer instead of
 * something the prose papers over. *"Their interactions surface in books 2 and 5
 * and I can't reliably reconstruct the later arc from passage search"* is a good
 * answer. A romance arc that never happened is not.
 */
const THEMATIC_SUBJECT =
  /\b(?:relationship|romance|romantic|arc|dynamic|chemistry|feelings?|develops?|development|evolves?|evolution|character\s+growth|themes?|thematic|parallels?|foreshadow\w*|symbolism|motifs?)\b/i;

/** ⚠️ "how does X change over the books" names no theme word and is still a
 *  distributed question — a CHANGE verb plus a cross-book scope is the same
 *  shape as an arc, and it is the phrasing people reach for most naturally. */
const THEMATIC_CHANGE =
  /\b(?:change[sd]?|grow[sn]?|progress(?:es|ion)?|become[s]?|turn[s]? into|end[s]? up)\b[^.?!]{0,40}\b(?:over|across|through(?:out)?|by the end of|during)\b|\b(?:over|across|through(?:out)?)\s+(?:the\s+)?(?:series|books?|arc)\b/i;

/**
 * True when the question asks about something DISTRIBUTED — an arc, a
 * relationship, a theme — rather than a fact one passage can hold.
 *
 * ⚠️ Deliberately generous, because the two errors are not symmetrical: a false
 * positive costs one honest paragraph about what the searches returned, and a
 * false negative costs a fabricated romance arc that a reader believes.
 */
export function thematicAsk(text: string): boolean {
  const q = (text ?? '').trim();
  if (!q) return false;
  return THEMATIC_SUBJECT.test(q) || THEMATIC_CHANGE.test(q);
}

/**
 * ⚠️ **THE REPORTING OBLIGATION**, appended to the grounding of a thematic turn.
 * Every line of it is the 14:15 transcript turned into an instruction.
 */
export const BOOKS_THEMATIC_NOTE =
  '⚠️ THIS IS A QUESTION ABOUT SOMETHING SPREAD ACROSS A LOT OF PAGES — an arc, a relationship, a ' +
  'theme. No single passage contains the answer, and passage search returns only the densest few ' +
  'mentions. So this turn carries an extra obligation, and it is not optional:\n' +
  '1. SEARCH PER BOOK AND SAY WHAT CAME BACK, book by book, with chapter anchors — "book 2, ' +
  'chapters 14 and 31; book 5, chapter 8; nothing in books 6-9". The coverage IS part of the answer.\n' +
  '2. ⚠️ NEVER NARRATE BEYOND THE PASSAGES YOU ACTUALLY RETRIEVED. Do not join scattered snippets ' +
  'into a story arc: the joins would be invention, they would read exactly like the retrieved parts, ' +
  'and the person cannot see the seam. If you did not read it in a passage this turn, you do not ' +
  'know it.\n' +
  '3. ⚠️ WHERE THE HITS ARE THIN, SAY SO PLAINLY — "my searches surface their interactions in books ' +
  "2 and 5; I can't reliably reconstruct the later arc from passage search alone.\" That is a REAL " +
  'answer and it is the honest one.\n' +
  '4. ⚠️ NEVER SAY HOW FAR THROUGH A SERIES YOU HAVE READ. Report what the listing returned THIS ' +
  'TURN and nothing beyond it — the claim "I\'ve read through book 14" has already been made once ' +
  'and it was false.';

export const BOOKS_MSG = {
  notLinked:
    "I can't tell who you are on the estate yet, and the books are behind the household's own " +
    'grant — so I need the link first. Run /link and try me again.',
  linkHasNoEmail:
    'Your link was made before I could check estate access. Re-run /link once and I will be able ' +
    'to read for you.',
  estateUnreachable:
    "I couldn't reach the estate to check your access — that's a problem on our side, not your " +
    'permissions. Try again in a minute.',

  switchedOff:
    'Reading the actual text of our books is switched off at the moment. That is a lever on our ' +
    'side rather than anything to do with your account — I can still tell you what the catalogue ' +
    'knows about a book (narrator, length, series order), just not what happens in it.',

  notConfigured:
    "I'm not wired up to read our books yet — that's a setup step on our side, not a permissions " +
    'problem. I can still look books up in the catalogue.',

  capped:
    "I've read a lot of book text for you today, so I'm going to stop there — that's a cap on my " +
    'side, not anything you did. It resets overnight.',

  /**
   * ⚠️ The per-turn ceiling, worded for the MODEL to relay — and **the word
   * "budget" is banned from it**, along with "cap", "quota" and "limit".
   *
   * Incident 2026-08-18 (design §10c): the old sentence here ended *"…I will go
   * again with a fresh budget"*, the model picked the word up and told the owner
   * *"I've hit my budget on the long passages"* and *"I've run out of budget"*,
   * and he asked — reasonably — *"she keeps mentioning budgets, what is this"*.
   *
   * ⚠️ **Internal mechanics read as a MALFUNCTION to the person on the other
   * end.** Nothing was wrong: a three-part question spent the per-turn ceiling
   * exactly as designed, and the retry she offered was real. But a sentence that
   * names our accounting makes a working system sound rationed and broken at the
   * same time. She says what it means for THEM — one more ask and she gets it —
   * and never what it is called in here.
   */
  turnBudgetSpent:
    "That is everything I can pull in one go. I've given you what I have rather than stopping " +
    'short of it.',

  /**
   * ⚠️ **THE SENTENCE THAT REPLACED A PERMISSION QUESTION** (owner decision
   * 2026-08-18, option C).
   *
   * She used to stop mid-answer and ask whether to continue. Measured on his
   * transcript, that produced a LOOP: he said *"get professions too"*, she
   * re-pulled the same passage, re-printed the whole sheet, ran out at exactly
   * the same place and asked again. ⚠️ **A permission turn is not a pause, it is
   * a chance to repeat yourself.**
   *
   * So there is no asking any more: she keeps going across consecutive messages
   * up to `BOOKS_MAX_REPLY_PARTS`. This is what she says only when THAT bound is
   * reached — the one case where a person genuinely has to go elsewhere.
   *
   * ⚠️ **NO URL, deliberately.** The reader is keyed by `anchor`
   * (`sha256(path)[:12]`) and a pack is keyed by `bookId`; the two are different
   * identifiers on purpose (design §4.2), so a link cannot be constructed from
   * what this side holds — and `ebooks.heygabi.ai/read` does not exist yet
   * (`ebook-viewer-phase1.md`). A plausible-looking link that 404s is worse than
   * no link.
   */
  moreToCome:
    "That's as much as I'll put in one go — the rest is in the book itself on the shelf. Tell me " +
    'which part you want and I will go straight to it.',

  /**
   * ⚠️ The sentence that makes incremental knowledge honest, and the owner asked
   * for this specific behaviour: *"I don't want to wait until every book is
   * processed to use Gabi's knowledge."*
   *
   * ⚠️ **NO TIMESCALE, EVER** (incident §10d). It used to promise *"it may well
   * be in there next week"* — a date she has no way of knowing. Processing is
   * not on a schedule she can see, and a book she promises for next week that
   * lands in an hour, or in three months, makes her wrong in both directions.
   * Books join her knowledge as they finish processing; **when** is not hers to
   * say, and saying so plainly is more useful than a guess.
   */
  notIngested:
    "I haven't read that one yet — it isn't in my knowledge base. I can still tell you what the " +
    'catalogue knows about it. Books join what I have read as they finish processing, so it may ' +
    'turn up later — I have no way of knowing when.',

  noAnswer:
    'I went looking through the book and could not put an answer together just then — that is a ' +
    'wobble on my side, not a sign the book lacks it. Ask me again, or narrow it down a bit.',

  /**
   * ⚠️ **THE FUSE ON `rated ⇒ read`** (§3.2). Row 7 is the one rung of the ladder
   * derived from a STORE rather than from what the person just typed, so it is
   * the one they might disagree with — a rating left after a DNF, a housemate
   * sharing a display name, a migrated passphrase-era review. Saying which
   * evidence was used, once, turns every one of those residuals from a silent
   * spoiler into a sentence they can correct.
   *
   * ⚠️ ONCE per answer, not once per tool call: she may count in three books on
   * one turn, and three copies of this reads as a malfunction.
   */
  ratingBound:
    "you rated this one, so I'm treating it as finished — say if that's wrong.",
} as const;

// ---------------------------------------------------------------------------
// The wire — an interface, and that is the credential seam
// ---------------------------------------------------------------------------

/** Why a Discord account has no usable estate identity. Three reasons, three
 *  sentences, because the fixes differ. ⚠️ Collapsing them is how "the estate is
 *  down" becomes "you never linked". */
export type BooksIdentityFailure = 'unlinked' | 'no_email' | 'outage';

/** One call's outcome. ⚠️ `ok:false` ALWAYS carries a `message`. `status: 0`
 *  means the audiobook Worker could not be reached at all. */
export interface BooksCallResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown> | null;
  message?: string;
}

/**
 * Everything the book tools need from the outside world.
 *
 * ⚠️ **An interface rather than an import, and that is the credential seam.**
 * `tool-exec.ts`, `gabi-chat.ts` and `mention-flow.ts` can call these; they
 * cannot construct one, cannot reach a service account or an app token through
 * one, and name no secret.
 */
export interface BooksPort {
  /** Who is asking, on the estate. ⚠️ Memoised per port instance (one per
   *  message), so a turn making four book calls reads the link document once. */
  askerEmail(
    discordUserId: string,
  ): Promise<{ ok: true; email: string } | { ok: false; reason: BooksIdentityFailure }>;
  /** What is in the knowledge base right now, optionally filtered. */
  available(email: string, query: string): Promise<BooksCallResult>;
  /** Search one book. `params` carries mode + the derived bound. */
  search(email: string, bookId: string, params: Record<string, string>): Promise<BooksCallResult>;
  /** One passage by ord, within the same bound. */
  passage(email: string, bookId: string, params: Record<string, string>): Promise<BooksCallResult>;
  /** One term rolled up across several books, in reading order. */
  presence(email: string, params: Record<string, string>): Promise<BooksCallResult>;
  /** ⚠️ **COUNT a phrase in ONE book — and get the COUNT, never the book.**
   *  `params` carries `q`, the pipe-joined `variants`, `quotes` and the derived
   *  bound. Spoiler-bounded, because a count is a per-book question. */
  count(email: string, bookId: string, params: Record<string, string>): Promise<BooksCallResult>;
  /** ⚠️ The same phrase across several books — **whole-book scope only**, which
   *  is the route's own narrowing: there is no honest single ceiling for six
   *  different chapter tables, and the shapes that would invent one are the
   *  shapes that leaked twenty-eight chapters (design §4.3). */
  countAcross(email: string, params: Record<string, string>): Promise<BooksCallResult>;
}

/** The identity failure, as the sentence she says. */
export function booksIdentityMessage(reason: BooksIdentityFailure): string {
  switch (reason) {
    case 'unlinked':
      return BOOKS_MSG.notLinked;
    case 'no_email':
      return BOOKS_MSG.linkHasNoEmail;
    case 'outage':
      return BOOKS_MSG.estateUnreachable;
  }
}

/**
 * What the tool layer is handed for one turn. ⚠️ Assembled per turn — the port
 * is shared, the BUDGET is not, and the asker is fixed for the turn so no tool
 * call can read on somebody else's behalf.
 */
export interface BooksToolContext {
  port: BooksPort;
  discordUserId: string;
  budget: BooksBudget;
  /** ⚠️ The daily fuse, read ONCE before the turn rather than per tool call. A
   *  capped person still gets the tools offered and a worded refusal from the
   *  executor — withholding the tools would make her answer a question about a
   *  book's contents from her own memory, which is the one thing this feature
   *  must not do. */
  capped: boolean;
  /** The bound derived from THIS turn's question. ⚠️ Threaded through so the
   *  executor cannot be handed a bound from an earlier turn. */
  bound: QuestionBound;
  /**
   * ⚠️ **THE LADDER'S ROW 7, AS A LAZY READ** (§3, `deriveBound`).
   *
   * Row 7 is per-`bookId`, so it can only be resolved when a specific book is
   * being queried — and it costs a Firestore query, so it must not be paid by
   * every mention. This is therefore a **memoised loader**: called at most once
   * per turn, only by a book call that reached an `unknown` bound, and never at
   * all on a turn that opens no book.
   *
   * ⚠️ It resolves to `{ ok: false }` on any failure. A read-state that could not
   * be read is `unknown`, never `whole_book`.
   */
  readState?: () => Promise<BooksReadState>;
}

// ---------------------------------------------------------------------------
// ⚠️ A CLARIFYING QUESTION IS A PROMISE — carrying the scope ask (§3.3)
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE OTHER HALF OF THE 2026-09-03 INCIDENT.** She answered *"how often
 * does Carl say…"*, then asked how far he was into book 1. He said *"I've read
 * them all"* — and that message left the book lane entirely and was answered as
 * a brand new question. **Nothing re-ran the count.**
 *
 * ⚠️ That is worse than never asking: an assistant that asks a clarifying
 * question has promised that the answer will be understood. The same lesson
 * `suggestFollowUp` learned when she asked "audiobook, ebook or physical?" and
 * then could not hear "physical please" — so this is deliberately the SAME
 * mechanism, read off the remembered window rather than stored.
 *
 * ⚠️ **NO NEW STORE FIELD, and that is a hard constraint rather than a
 * preference.** The conversation record's shape is shared with the library
 * site's chat panel through `packages/gabi-conversation`
 * (`gabi-conversation-continuity.md` §1.2/§1.3), where *"do not add fields"* is
 * the standing rule — a field added there is a field the panel silently does not
 * have. The marker is therefore DERIVED from the window's own text, exactly as
 * `suggestFollowUp` derives the format answer, and it expires with the window.
 */
const SCOPE_ASK_RE =
  /\bhow\s+far\s+(?:in(?:to)?|are\s+you|have\s+you|you'?ve|you\s+have)|\bdon'?t\s+have\s+a\s+bookmark\s+for\s+you\b|\bhow\s+far\s+you'?ve\s+got\b|\bwhere\s+(?:are\s+you|you\s+are)\s+(?:up\s+to|in|at)\b|\bsay\s+if\s+you'?ve\s+finished\b|\bwhich\s+chapter\s+are\s+you\b/i;

/** What her scope question was ABOUT — the question she was in the middle of
 *  answering when she asked it. */
export interface ScopeAskCarry {
  /** ⚠️ The ORIGINAL question, verbatim from the window, so the resolved bound
   *  re-issues what was actually asked rather than a paraphrase of it. */
  question: string;
}

/**
 * Did she ask how far they had got, and what was she answering when she did?
 *
 * `history` is the remembered window, oldest first. Returns the last such ask
 * with the book-lane user turn it interrupted, or `null`.
 */
export function pendingScopeAsk(
  history: readonly { role: string; text: string }[],
): ScopeAskCarry | null {
  const turns = history ?? [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (!t || t.role !== 'assistant' || !SCOPE_ASK_RE.test(t.text ?? '')) continue;
    // The question she was answering: the nearest earlier USER turn that was
    // itself a book question. ⚠️ Never a later one — a message after the ask is
    // the ANSWER to it, not the thing that prompted it.
    for (let j = i - 1; j >= 0; j--) {
      const u = turns[j];
      if (u?.role === 'user' && booksIntent(u.text ?? '')) return { question: u.text };
    }
    return null;
  }
  return null;
}

/**
 * ⚠️ **THE RESUME.** They answered her scope question; the answer resolves the
 * bound; so the turn is a CONTINUATION of the original question and not a new
 * one. Returns the question to re-issue, or `null`.
 *
 * ⚠️ The bound itself is NOT returned — it is derived from this turn's message
 * by `booksContextFor` exactly as every other turn's is, and re-deriving it here
 * would be a second implementation of the one thing design §4.3 insists happens
 * in one place.
 */
export function booksScopeResume(
  text: string,
  history: readonly { role: string; text: string }[],
): ScopeAskCarry | null {
  const carry = pendingScopeAsk(history);
  if (!carry) return null;
  // ⚠️ Only an answer that actually RESOLVES the scope resumes anything. "no
  // idea" is a real reply and it leaves the bound unknown, which is the state
  // the ask already handled.
  return boundFromQuestion(text).scope === 'unknown' ? null : carry;
}

/** ⚠️ Appended to the grounding when a scope answer re-issues its question, so
 *  the model answers the ORIGINAL ask instead of the two words that unblocked
 *  it. */
export const BOOKS_SCOPE_RESUMED_NOTE =
  '⚠️ THEY HAVE JUST TOLD YOU HOW FAR THEY HAVE GOT, and this turn is the ANSWER TO YOUR OWN ' +
  'QUESTION — not a new subject. The question above is the one they actually asked, re-issued now ' +
  'that the scope is settled. Answer THAT question, with the tools, this turn. ⚠️ Do NOT ask how ' +
  'far they have got again: they have told you, and asking twice is how a clarifying question stops ' +
  'being worth answering. Acknowledge what they said in a few words and then give the answer.';
