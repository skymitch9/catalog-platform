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
export type QuestionBound =
  | { scope: 'whole_book' }
  | { scope: 'through_chapter'; chapter: number }
  | { scope: 'unknown' };

const ENDPOINT_RE =
  /\b(at|by|towards?|near)\s+the\s+end\b|\bend\s+of\s+(the\s+)?book\b|\bwhole\s+book\b|\bentire\s+book\b|\bfinished\s+(it|the\s+book)\b|\bi'?ve\s+(read|finished)\s+(it|the\s+whole)\b|\bfinal\s+chapter\b|\bhow\s+does\s+it\s+end\b/i;

const CHAPTER_RE =
  /\b(?:up\s+to|through|before|by|i'?m\s+(?:on|at|in)|i\s+am\s+(?:on|at|in)|as\s+far\s+as)\s+chapter\s+(\d{1,3})\b/i;

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

/** The bound as the route's query parameters. */
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
  /\b(happens?|happened|said|says|kills?|killed|dies?|died|fights?|meets?|becomes?)\b/i,
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

/** ⚠️ How many books the knowledge-base listing hands a model at once. The
 *  listing is a discovery step, not an answer — a model shown 182 rows spends
 *  its output budget reciting them. */
export const BOOKS_LIST_LIMIT = 25;

/**
 * ⚠️ **THE PER-TURN RETRIEVAL CEILING — 24 KB and at most 6 passages.**
 *
 * ≈6k input tokens at bytes÷4 — the same envelope the docs budget already
 * proved. ⚠️ Counted across the WHOLE turn, not per call: one assistant turn may
 * emit several `tool_use` blocks at once, and a budget that reset between
 * tool-loop iterations would not be a budget.
 *
 * ⚠️ **It REFUSES rather than trims**, and the refusal says the passage was NOT
 * read. A silently truncated passage is a plot point missing the sentence that
 * mattered.
 */
export const BOOKS_BYTES_PER_TURN = 24 * 1024;
export const BOOKS_PASSAGES_PER_TURN = 6;

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

  /** ⚠️ The per-turn ceiling, worded for the MODEL to relay. She must be able to
   *  say she ran out of room rather than implying the book did. */
  turnBudgetSpent:
    'I have already pulled as much of the book as I can carry in one answer. Say what you want me ' +
    'to dig into and I will go again with a fresh budget.',

  /** ⚠️ The sentence that makes incremental knowledge honest, and the owner
   *  asked for this specific behaviour: *"I don't want to wait until every book
   *  is processed to use Gabi's knowledge."* */
  notIngested:
    "I haven't read that one yet — it isn't in my knowledge base. I can still tell you what the " +
    'catalogue knows about it, and it may well be in there next week; books are being added as ' +
    'they finish processing.',

  noAnswer:
    'I went looking through the book and could not put an answer together just then — that is a ' +
    'wobble on my side, not a sign the book lacks it. Ask me again, or narrow it down a bit.',
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
}
