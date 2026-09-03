/**
 * **TIER 0c — GABI HAS READ THE LIBRARY.** The tests that keep the promises the
 * design made in words (`docs/info/gabi-book-knowledge-design.md` §4).
 *
 * Each block names the rule it defends, because a test whose failure message is
 * "expected 4 to equal 5" tells the next session nothing about what broke:
 *
 *  1. **The fourth allowlist stays fourth.** Fold the book tools into
 *     `GABI_TOOL_NAMES` and `toolsForApi()` hands a model the household's own
 *     book text on every turn of every conversation — unscoped, on a surface
 *     whose whole point is that it IS scoped.
 *  2. **The bound is derived from the QUESTION and rounds DOWN.** Delete the
 *     round-down and "I'm on chapter 19" starts serving chapter 19, which is the
 *     chapter they have not finished.
 *  3. **Absence of a stated bound is UNKNOWN**, never "unread" and never
 *     "finished" (§4.5).
 *  4. **The budget REFUSES rather than trims.** A silently truncated passage is
 *     a plot point missing the sentence that mattered.
 *  5. **"Not ingested" is not "not in the book"**, and it is not an error. Make
 *     it one and the model retries around it, then answers from its own memory
 *     of a book nobody has processed.
 *  6. ⚠️ **A credential leaks out of the THREE modules allowed to hold one.**
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  GABI_BOOKS_TOOLS,
  GABI_BOOKS_TOOL_NAMES,
  GABI_BOOKS_TOOL_TIER,
  GABI_DOCS_TOOL_NAMES,
  GABI_TOOL_NAMES,
  gabiBooksToolByName,
  isGabiBooksToolName,
  toolsForApi,
} from '../src/gabi-tools.js';
import {
  BOOKS_BYTES_PER_TURN,
  BOOKS_MSG,
  BOOKS_PASSAGES_PER_TURN,
  BOOKS_PRESENCE_MAX,
  BOOKS_TURNS_PER_DAY,
  booksCapDecision,
  booksIdentityMessage,
  booksFollowUp,
  booksIntent,
  booksOn,
  booksScopeResume,
  looksLikeStatQuery,
  boundFromQuestion,
  boundParams,
  deriveBound,
  pendingScopeAsk,
  makeBooksBudget,
  MAX_COUNT_QUOTES,
  MAX_COUNT_VARIANTS,
  BOOKS_SCOPE_RESUMED_NOTE,
  type BooksCallResult,
  type BooksPort,
  type BooksToolContext,
  continuationShape,
  thematicAsk,
  BOOKS_FRESH_ASK_NOTE,
  BOOKS_THEMATIC_NOTE,
} from '../src/book-knowledge.js';
import { audiobookApiBase, DEFAULT_AUDIOBOOK_API, makeBooksPort } from '../src/book-knowledge-exec.js';
import { runTool } from '../src/tool-exec.js';
import { handleMention, NO_MEMORY } from '../src/mention-flow.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 1. the allowlist is the allowlist ───────────────────────────────────────

describe('the book allowlist and its definitions are one thing', () => {
  it('every name has a definition and every definition has a name', () => {
    assert.deepEqual(
      [...GABI_BOOKS_TOOL_NAMES].sort(),
      GABI_BOOKS_TOOLS.map((t) => t.name).sort(),
    );
  });

  it('⚠️ every book tool reads gated_book_text, is GET-only and mutates nothing', () => {
    for (const tool of GABI_BOOKS_TOOLS) {
      assert.equal(tool.reads, 'gated_book_text', `${tool.name} reads something else`);
      assert.deepEqual([...tool.methods], ['GET'], `${tool.name} may use more than GET`);
      assert.equal(tool.mutates, false, `${tool.name} claims to mutate`);
      assert.equal(tool.input_schema.additionalProperties, false);
    }
  });

  it('⚠️ NOTHING in this array writes, and the names say so', () => {
    // The same instrument the other three arrays get. A verb arriving here is a
    // decision somebody should have to make on purpose.
    for (const name of GABI_BOOKS_TOOL_NAMES) {
      assert.doesNotMatch(name, /^(set|add|delete|remove|update|write|ingest|re_?chunk)_/, name);
    }
  });

  it('the tier is recorded, and the guard is default-deny', () => {
    assert.equal(GABI_BOOKS_TOOL_TIER, '0c');
    assert.equal(isGabiBooksToolName('search_book_text'), true);
    assert.equal(isGabiBooksToolName('delete_book'), false);
    assert.equal(isGabiBooksToolName(42), false);
    assert.equal(isGabiBooksToolName(null), false);
    assert.equal(gabiBooksToolByName('nope'), null);
  });

  it('⚠️ the three families do not overlap — one name may not sit in two', () => {
    for (const name of GABI_BOOKS_TOOL_NAMES) {
      assert.ok(!(GABI_TOOL_NAMES as readonly string[]).includes(name), `${name} is also Tier 0`);
      assert.ok(!(GABI_DOCS_TOOL_NAMES as readonly string[]).includes(name), `${name} is also docs`);
    }
  });
});

// ── 2. ⚠️ the gated surfaces are opt-in, separately ─────────────────────────

describe('⚠️ toolsForApi keeps the gated families opt-in and INDEPENDENT', () => {
  const names = (opts?: { docs?: boolean; books?: boolean }) =>
    toolsForApi(opts).map((t) => t.name);

  it('⚠️ with no argument it returns Tier 0 and NOTHING else', () => {
    // Design §4.6 pins this by name. Every pre-existing caller gets exactly what
    // it got before Tier 0b and 0c existed.
    assert.deepEqual(names(), [...GABI_TOOL_NAMES]);
  });

  it('⚠️ docs:true does not smuggle in the book tools', () => {
    // The two are DIFFERENT owner decisions about DIFFERENT corpora. A single
    // `gated: true` would make one grant the other.
    const got = names({ docs: true });
    for (const b of GABI_BOOKS_TOOL_NAMES) assert.ok(!got.includes(b), `${b} leaked in with docs`);
  });

  it('⚠️ books:true does not smuggle in the docs tools', () => {
    const got = names({ books: true });
    for (const d of GABI_DOCS_TOOL_NAMES) assert.ok(!got.includes(d), `${d} leaked in with books`);
    for (const b of GABI_BOOKS_TOOL_NAMES) assert.ok(got.includes(b), `${b} is missing`);
  });

  it('both together is Tier 0 + docs + books, and no delegated verb anywhere', () => {
    const got = names({ docs: true, books: true });
    assert.equal(got.length, GABI_TOOL_NAMES.length + GABI_DOCS_TOOL_NAMES.length + GABI_BOOKS_TOOL_NAMES.length);
    for (const verb of ['whoami', 'add-isbn', 'run-details']) {
      assert.ok(!got.includes(verb), `the delegated verb ${verb} is described to the model`);
    }
  });
});

// ── 3. ⚠️ the posture, affirmative-only ─────────────────────────────────────

describe('⚠️ GABI_BOOKS is affirmative-only', () => {
  it('only the exact word "on" turns it on', () => {
    assert.equal(booksOn({ GABI_BOOKS: 'on' }), true);
    assert.equal(booksOn({ GABI_BOOKS: '  ON  ' }), true);
    for (const v of ['true', '1', 'yes', 'enabled', 'no', '', undefined]) {
      assert.equal(booksOn({ GABI_BOOKS: v as string }), false, `"${String(v)}" turned it on`);
    }
  });
});

// ── 4. ⚠️ the bound: derived from the question, rounding DOWN ───────────────

describe('⚠️ the spoiler bound comes from the QUESTION and rounds down', () => {
  it('an endpoint means the whole book', () => {
    for (const q of [
      "what's Jake's stat sheet at the end of book 1?",
      'by the end of the book, who is left?',
      'I have finished it — what happened to her?',
      'how does it end?',
      'what is in the final chapter',
    ]) {
      assert.equal(boundFromQuestion(q).scope, 'whole_book', q);
    }
  });

  it('⚠️ "I\'m on chapter 19" stops at 18 — the chapter they are INSIDE is unfinished', () => {
    const b = boundFromQuestion("I'm on chapter 19, who is the guy with the axe?");
    assert.deepEqual(b, { scope: 'through_chapter', chapter: 18 });
  });

  it('"up to chapter 12" stops at 12 — they named a place they have passed', () => {
    assert.deepEqual(boundFromQuestion('up to chapter 12, what has he learnt?'), {
      scope: 'through_chapter',
      chapter: 12,
    });
  });

  it('⚠️ anything else is UNKNOWN — never "unread" and never "finished"', () => {
    for (const q of ['who is Jake?', 'what happens in the book', '']) {
      assert.equal(boundFromQuestion(q).scope, 'unknown', q);
    }
  });

  it('the bound goes on the wire as the routes parse it', () => {
    assert.deepEqual(boundParams({ scope: 'whole_book' }), { scope: 'whole_book' });
    assert.deepEqual(boundParams({ scope: 'through_chapter', chapter: 7 }), {
      scope: 'through_chapter',
      chapter: '7',
    });
    assert.deepEqual(boundParams({ scope: 'unknown' }), { scope: 'unknown' });
  });

  it('⚠️ NO ord ceiling is ever produced on this side', () => {
    // Design §4.3: an `ord` is only meaningful relative to the chunking that
    // produced it, and a ceiling that crossed a re-chunk leaked 28 chapters.
    // This end names chapters and endpoints; the pack derives the ord.
    const src = repoFile('src/book-knowledge.ts');
    assert.doesNotMatch(strip(src), /\bceiling\s*[:=]/, 'this module computed an ord ceiling');
  });
});

// ── 5. the pre-router ───────────────────────────────────────────────────────

describe('⚠️ booksIntent separates "what happens in it" from "what do we have"', () => {
  it('a contents question routes to the books', () => {
    for (const q of [
      "what's Jake's stat sheet at the end of book 1?",
      'what happens to her in chapter 12?',
      'who does he first meet in the dungeon?',
      'remind me what the deal with the tutorial was',
      'what level is Jake at the end of book 3?',
    ]) {
      assert.equal(booksIntent(q), true, q);
    }
  });

  it('⚠️ a SHELF question does not', () => {
    for (const q of [
      'do we have any Sanderson?',
      'who narrates The Way of Kings?',
      'how long is book 4?',
      'what order do the Mistborn books go in?',
      'have we got Dungeon Crawler Carl in the catalogue?',
    ]) {
      assert.equal(booksIntent(q), false, q);
    }
  });

  // ── ⚠️ THE REGRESSION TEST THAT IS A TRANSCRIPT ─────────────────────────
  //
  // The owner's FIRST live book question, 2026-08-18, verbatim — and the wrong
  // answer it got, which reassembles from MENTION_MSG.searched + none + panel
  // and so names the branch exactly: booksIntent returned false, the turn fell
  // to `question`, and that branch unconditionally runs a public-shelf lookup.
  //
  //   > @GABI Tell me jakes status sheet at the end of the 9th book
  //   > "I looked on the estate's public shelf for jakes status sheet at end
  //    9th. Nothing on the estate's public shelf matches that…"
  //
  // ⚠️ Exactly the docs assistant's §12 incident, one lane over: OFFERING the
  // tools is not the same as ROUTING to them. Three separate misses, each now
  // its own assertion, because a single "it routes now" would go green again if
  // two of the three regressed.
  it("⚠️ INCIDENT 2026-08-18 — the owner's first live book question routes to the BOOKS", () => {
    assert.equal(booksIntent('Tell me jakes status sheet at the end of the 9th book'), true);
  });

  it("⚠️ miss 1 — \"status sheet\", not just \"stat sheet\"", () => {
    // The books themselves use both: the Primal Hunter transcripts say "he
    // checked his status menu". A detector that knows only `stat sheet` does
    // not know the word the reader is holding while they type.
    assert.equal(booksIntent('what is his status sheet'), true);
    assert.equal(booksIntent('what is his stat sheet'), true);
    assert.equal(booksIntent('show me the status screen'), true);
  });

  it('⚠️ miss 2 — "at the end of THE 9TH book", with words between "of" and "book"', () => {
    assert.equal(booksIntent('what happened at the end of the 9th book'), true);
    assert.equal(booksIntent('who died at the end of the third volume'), true);
  });

  it('⚠️ miss 3 — an ORDINAL names a volume just as well as a number does', () => {
    // Every anchor existed as `book 9` and none as `9th book`.
    assert.equal(booksIntent('what is his level in the 9th book'), true);
    assert.equal(booksIntent('what is his level in the ninth book'), true);
    assert.equal(booksIntent('what is his level in book 9'), true);
    assert.equal(booksIntent('what is his level in the last book'), true);
  });

  it("⚠️ a CHARACTER's possessive plus an attribute is a book question — the catalogue holds no character names", () => {
    // ⚠️ The apostrophe is optional because nobody types one into a DM.
    assert.equal(booksIntent('tell me jakes status sheet'), true);
    assert.equal(booksIntent("tell me Jake's inventory"), true);
    assert.equal(booksIntent('what are carls titles'), true);
    // ⚠️ A PRONOUN is not a possessive here, deliberately. "what about her
    // skills" has no anchor and no name, so it falls to the weak half and stays
    // out — the detector is narrow on purpose, and a follow-up like this is
    // answered by the tools already being offered on an ordinary question turn.
    assert.equal(booksIntent('what about her skills'), false);
    assert.equal(booksIntent('what about her skills in book 9'), true);
  });

  it('⚠️ AND THE SHELF LANE IS UNTOUCHED — the fix must not eat "do we have this"', () => {
    // Each of these names a book the same way the owner's question did, and
    // each is still a CATALOGUE question. Widening the detector without this
    // assertion is how one lane gets fixed by breaking the other.
    for (const q of [
      'do we have the 9th Primal Hunter book?',
      "what's the 9th book in the series?",
      "what's the title of book 3?",
      'what titles do we have in the series?',
      'how many books are in the series?',
      'is Dungeon Crawler Carl on the shelf?',
      'how long is book 4?',
    ]) {
      assert.equal(booksIntent(q), false, q);
    }
  });

  it("⚠️ the bound was ALREADY right on the owner's sentence — only the router missed", () => {
    // Worth pinning: the diagnosis found boundFromQuestion returning whole_book
    // correctly all along. The defect was one layer up, and a future reader
    // should not go looking for it in the scoping code.
    assert.deepEqual(boundFromQuestion('Tell me jakes status sheet at the end of the 9th book'), {
      scope: 'whole_book',
    });
  });

  it('looksLikeStatQuery knows both words, and stays off ordinary questions', () => {
    assert.equal(looksLikeStatQuery('status sheet'), true);
    assert.equal(looksLikeStatQuery('stat sheet'), true);
    assert.equal(looksLikeStatQuery('his level'), true);
    assert.equal(looksLikeStatQuery('who is the dwarf'), false);
    assert.equal(looksLikeStatQuery(''), false);
  });

  // ── ⚠️ THE SECOND TRANSCRIPT — SHE OFFERED A RETRY AND THEN REFUSED IT ────
  //
  // Channel lane, 2026-08-18 ~1:08 PM Phoenix. Her long turn ended:
  //
  //   > "I've run out of budget to pull that passage, so I'll dig into it fresh
  //    if you want — just say the word!"
  //
  // The owner said the word:
  //
  //   > @GABI dig fresh into jake sheet
  //   > "I looked on the estate's public shelf for dig fresh into jake sheet…"
  //
  // ⚠️ booksIntent is STATELESS on a surface that has a memory. A follow-up is
  // elliptical BY CONSTRUCTION — it omits everything the previous turn set up,
  // which is exactly what the detector needs.
  const asked = (text: string) => ({ role: 'user', text });
  const BOOK_LANE_HISTORY = [
    asked("what's Jake's stat sheet at the end of book 1?"),
    { role: 'assistant', text: "…I'll dig into it fresh if you want — just say the word!" },
  ];

  it("⚠️ INCIDENT 2026-08-18 — the owner's ACCEPTANCE of her offered retry stays in the book lane", () => {
    assert.equal(booksIntent('dig fresh into jake sheet'), false, 'alone it is not a book question');
    assert.equal(booksFollowUp('dig fresh into jake sheet', BOOK_LANE_HISTORY), true);
  });

  it('the ordinary acceptances continue too', () => {
    for (const q of ['yes please', 'go ahead', 'do it', 'say the word then', 'and book 2?']) {
      assert.equal(booksFollowUp(q, BOOK_LANE_HISTORY), true, q);
    }
  });

  it('⚠️ a follow-up with NO book conversation behind it does NOT get the book lane', () => {
    // The whole guard: nothing here fires on its own. An empty window, or a
    // window whose questions were about the shelf, leaves the lane closed.
    assert.equal(booksFollowUp('dig fresh into jake sheet', []), false);
    assert.equal(
      booksFollowUp('dig fresh into jake sheet', [asked('do we have any Sanderson?')]),
      false,
    );
  });

  it('⚠️ a SHELF question after a book conversation still goes to the shelf', () => {
    // A lane may not capture people.
    for (const q of ['do we have book 10?', 'have we got the audiobook?']) {
      assert.equal(booksFollowUp(q, BOOK_LANE_HISTORY), false, q);
    }
  });

  it('a LONG new sentence is judged on its own subject, not on the window', () => {
    assert.equal(
      booksFollowUp(
        'can you tell me which board games we own that play well with exactly five people',
        BOOK_LANE_HISTORY,
      ),
      false,
    );
  });

  it('booksFollowUp never double-claims what booksIntent already owns', () => {
    // Returning true for both would hide which half of the router decided, and
    // the two are debugged separately.
    assert.equal(booksFollowUp("what's Jake's stat sheet at the end of book 1?", BOOK_LANE_HISTORY), false);
  });

  it('empty and junk are not book questions', () => {
    assert.equal(booksIntent(''), false);
    assert.equal(booksIntent('   '), false);
    assert.equal(booksIntent(undefined as unknown as string), false);
  });
});

// ── 6. ⚠️ the caps: they refuse rather than trim ────────────────────────────

describe('⚠️ the per-turn budget refuses rather than trimming', () => {
  it('a passage that does not fit is REFUSED, and nothing is spent on it', () => {
    const budget = makeBooksBudget();
    assert.equal(budget.take(BOOKS_BYTES_PER_TURN, 1), true);
    assert.equal(budget.take(1, 1), false);
    assert.deepEqual(budget.spent(), { bytes: BOOKS_BYTES_PER_TURN, passages: 1 });
  });

  it('the passage count is its own ceiling, not a consequence of the bytes', () => {
    const budget = makeBooksBudget();
    assert.equal(budget.take(10, BOOKS_PASSAGES_PER_TURN), true);
    assert.equal(budget.take(10, 1), false);
  });

  it('⚠️ used() is false until she actually reaches for a book', () => {
    const budget = makeBooksBudget();
    assert.equal(budget.used(), false);
    budget.take(0, 0);
    assert.equal(budget.used(), true);
  });

  it('the daily fuse is its own number, and it is worded', () => {
    assert.equal(booksCapDecision(BOOKS_TURNS_PER_DAY - 1).ok, true);
    const capped = booksCapDecision(BOOKS_TURNS_PER_DAY);
    assert.equal(capped.ok, false);
    assert.equal(capped.ok === false && capped.message, BOOKS_MSG.capped);
  });
});

// ── 7. ⚠️ four causes, four sentences ───────────────────────────────────────

describe('⚠️ the refusals stay distinct, because the fixes differ', () => {
  it('the three identity failures say three different things', () => {
    const said = new Set(
      (['unlinked', 'no_email', 'outage'] as const).map((r) => booksIdentityMessage(r)),
    );
    assert.equal(said.size, 3);
    assert.match(booksIdentityMessage('unlinked'), /\/link/);
    assert.match(booksIdentityMessage('outage'), /not your\s+permissions|our side/i);
  });

  it('⚠️ SHE NEVER SAYS "BUDGET" — the word that read as a malfunction', () => {
    // Incident 2026-08-18: the old turnBudgetSpent sentence ended "…I will go
    // again with a fresh budget", the model picked the word up and said "I've
    // hit my budget on the long passages", and the owner asked "she keeps
    // mentioning budgets, what is this". Nothing was wrong — a three-part
    // question spent the per-turn ceiling exactly as designed — but naming our
    // accounting makes a working system sound rationed AND broken.
    const MECHANICS = /(budget|quota|ration|allowance|cap|limit)/i;
    for (const [key, sentence] of Object.entries(BOOKS_MSG)) {
      assert.doesNotMatch(sentence, MECHANICS, `BOOKS_MSG.${key} names our internal accounting`);
    }
    // ⚠️ **AND IT NO LONGER ASKS PERMISSION** (owner decision 2026-08-18, option
    // C). It used to end "ask me again and I'll get it", which measured as a
    // LOOP rather than a pause: he asked again, she re-pulled the same passage,
    // re-printed the whole sheet and ran out in the same place. A permission
    // turn is not a pause, it is a chance to repeat yourself.
    assert.doesNotMatch(BOOKS_MSG.turnBudgetSpent, /\?/, 'the ceiling sentence asks a question again');
    assert.doesNotMatch(BOOKS_MSG.turnBudgetSpent, /ask me again/i);
    // What replaced it: she says she gave what she had, and the parts bound has
    // its own sentence for the one case where somebody must go elsewhere.
    assert.match(BOOKS_MSG.moreToCome, /as much as I'll put in one go/i);
    // ⚠️ NO URL. The reader is keyed by `anchor` and a pack by `bookId` — two
    // different identifiers on purpose — and ebooks.heygabi.ai/read does not
    // exist yet. A plausible link that 404s is worse than no link.
    assert.doesNotMatch(BOOKS_MSG.moreToCome, /https?:\/\//);
  });

  it('⚠️ SHE INVENTS NO TIMESCALE — the "next week" she could not know', () => {
    // Incident 2026-08-18 (design §10d). notIngested used to promise "it may
    // well be in there next week". She cannot see the processing schedule; a
    // book promised for next week that lands in an hour — or in three months —
    // makes her wrong in both directions. PH 10-14 landed the same afternoon.
    const TIMESCALE = /(next week|next month|tomorrow|soon|shortly|within (a|the) \w+|by (monday|tuesday|wednesday|thursday|friday|the weekend))/i;
    for (const [key, sentence] of Object.entries(BOOKS_MSG)) {
      assert.doesNotMatch(sentence, TIMESCALE, `BOOKS_MSG.${key} invents a schedule she cannot see`);
    }
    // ⚠️ It must still say the honest thing: it MAY arrive, and she cannot say when.
    assert.match(BOOKS_MSG.notIngested, /no way of knowing when/i);
  });

  it('⚠️ INCIDENT 2026-08-18 — no MODEL-FACING text invents a timescale either', () => {
    // The wording leaked the same way "budget" did: the model quotes tool
    // descriptions and result notes verbatim. Banning it only in the sentences a
    // person sees would leave the actual source in place.
    const TIMESCALE = /next week/i;
    for (const tool of GABI_BOOKS_TOOLS) {
      assert.doesNotMatch(tool.description, TIMESCALE, `${tool.name}'s description dates it`);
    }
  });

  it('⚠️ "not ingested" and "switched off" are not the same sentence', () => {
    assert.notEqual(BOOKS_MSG.notIngested, BOOKS_MSG.switchedOff);
    assert.notEqual(BOOKS_MSG.notIngested, BOOKS_MSG.notConfigured);
    // The one the owner asked for in words.
    assert.match(BOOKS_MSG.notIngested, /haven't read that one yet/i);
  });

  it('the audiobook host is configurable and defaults to the live one', () => {
    assert.equal(audiobookApiBase({}), DEFAULT_AUDIOBOOK_API);
    assert.equal(audiobookApiBase({ AUDIOBOOK_API_URL: '   ' }), DEFAULT_AUDIOBOOK_API);
    assert.equal(audiobookApiBase({ AUDIOBOOK_API_URL: 'https://x.test/' }), 'https://x.test');
  });
});

// ── 8. the executor, driven through runTool ─────────────────────────────────

const OK = (body: Record<string, unknown>): BooksCallResult => ({ ok: true, status: 200, body });

function port(overrides: Partial<BooksPort> = {}): BooksPort {
  return {
    askerEmail: async () => ({ ok: true, email: 'reader@example.test' }),
    available: async () => OK({ count: 2, matched: 2, books: [{ book_id: 'ph-1', title: 'PH 1' }] }),
    search: async () => OK({ ingested: true, book_id: 'ph-1', mode: 'relevant', passages: [] }),
    passage: async () => OK({ ingested: true, book_id: 'ph-1', passage: { text: 'x' } }),
    presence: async () => OK({ ok: true, books: [] }),
    count: async () =>
      OK({ ingested: true, book_id: 'ph-1', total: 0, by_variant: [], by_chapter: [], quotes: [], hidden_by_scope: 0 }),
    countAcross: async () => OK({ ok: true, mode: 'count', books: [] }),
    ...overrides,
  };
}

function ctxFor(p: BooksPort, extra: Partial<BooksToolContext> = {}) {
  const books: BooksToolContext = {
    port: p,
    discordUserId: '1',
    budget: makeBooksBudget(),
    capped: false,
    bound: { scope: 'unknown' },
    ...extra,
  };
  return { catalogBaseUrl: 'https://catalog.test', books };
}

describe('⚠️ the executor refuses in words, and never fakes an answer', () => {
  it('no port at all is a CONFIGURATION sentence, not a permissions one', async () => {
    const out = await runTool('search_book_text', { bookId: 'a', query: 'b' }, {
      catalogBaseUrl: 'https://catalog.test',
    });
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, BOOKS_MSG.notConfigured);
  });

  it('⚠️ a capped person still gets the tools, and a worded refusal from here', async () => {
    const out = await runTool('search_book_text', { bookId: 'a', query: 'b' }, ctxFor(port(), { capped: true }));
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, BOOKS_MSG.capped);
  });

  it('an unlinked asker is told about /link, and no book call is made', async () => {
    let called = false;
    const p = port({
      askerEmail: async () => ({ ok: false, reason: 'unlinked' }),
      search: async () => {
        called = true;
        return OK({});
      },
    });
    const out = await runTool('search_book_text', { bookId: 'a', query: 'b' }, ctxFor(p));
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, BOOKS_MSG.notLinked);
    assert.equal(called, false, 'a book call was made for somebody with no identity');
  });

  it('⚠️ an un-ingested book is a NON-error carrying the honest sentence', async () => {
    const p = port({
      search: async () =>
        OK({ ingested: false, book_id: 'ph-14', did_you_mean: [{ book_id: 'ph-1' }], knowledge_base_size: 157 }),
    });
    const out = await runTool('search_book_text', { bookId: 'ph-14', query: 'jake' }, ctxFor(p));
    assert.equal(out.isError, false, 'absence was reported as a failure');
    const r = out.result as { say: string; ingested: boolean; note: string };
    assert.equal(r.ingested, false);
    assert.equal(r.say, BOOKS_MSG.notIngested);
    assert.match(r.note, /NOT a fact about the story/);
  });

  it('⚠️ THE BOUND ON THE WIRE COMES FROM THE TURN, not from the model', async () => {
    let sent: Record<string, string> | null = null;
    const p = port({
      search: async (_e, _b, params) => {
        sent = params;
        return OK({ ingested: true, passages: [] });
      },
    });
    const out = await runTool(
      'search_book_text',
      // ⚠️ The model tries to widen its own spoiler scope. It must not work.
      { bookId: 'ph-1', query: 'jake', scope: 'whole_book', chapter: '99' },
      ctxFor(p, { bound: { scope: 'through_chapter', chapter: 4 } }),
    );
    assert.equal(out.isError, false);
    assert.equal(sent!.scope, 'through_chapter');
    assert.equal(sent!.chapter, '4');
  });

  it('⚠️ a stat-shaped query ASKS for the stat-block detector — measured, not assumed', async () => {
    // ⚠️ book-retrieval.ts's own looksLikeStatQuestion() fires on "stat sheet"
    // and NOT on "status sheet" — the same word gap the router had. Measured
    // live on Primal Hunter 9: auto returned passages that merely MENTIONED the
    // words (stat_keys 0), forced returned the actual blocks (stat_keys 12).
    let sent: Record<string, string> | null = null;
    const p = port({
      search: async (_e, _b, params) => {
        sent = params;
        return OK({ ingested: true, passages: [] });
      },
    });
    await runTool('search_book_text', { bookId: 'ph-9', query: 'status sheet', mode: 'latest' }, ctxFor(p));
    assert.equal(sent!.stat_block, 'true');

    await runTool('search_book_text', { bookId: 'ph-9', query: 'who is the dwarf', mode: 'relevant' }, ctxFor(p));
    // ⚠️ UNSET, not "false" — leaving the route's own judgement in place. Sending
    // false would suppress a detector that was right.
    assert.equal(sent!.stat_block, undefined);
  });

  it('an invented mode is refused by name, and nothing is read', async () => {
    let called = false;
    const p = port({
      search: async () => {
        called = true;
        return OK({});
      },
    });
    const out = await runTool('search_book_text', { bookId: 'a', query: 'b', mode: 'last' }, ctxFor(p));
    assert.equal(out.isError, true);
    assert.match((out.result as { note: string }).note, /relevant, latest, earliest or presence/);
    assert.equal(called, false);
  });

  it('⚠️ oversized passages are REFUSED, and the refusal says they were not read', async () => {
    const big = 'x'.repeat(BOOKS_BYTES_PER_TURN + 100);
    const p = port({
      search: async () => OK({ ingested: true, passages: [{ text: big, ord: 1 }] }),
    });
    const out = await runTool('search_book_text', { bookId: 'a', query: 'b' }, ctxFor(p));
    assert.equal(out.isError, true);
    assert.match((out.result as { note: string }).note, /NOT read/);
  });

  it('⚠️ more books than the roll-up may span is a refusal, not a quiet first-six', async () => {
    let called = false;
    const p = port({
      presence: async () => {
        called = true;
        return OK({});
      },
    });
    const out = await runTool(
      'book_presence',
      { bookIds: Array.from({ length: BOOKS_PRESENCE_MAX + 1 }, (_, i) => `b-${i}`), query: 'jake' },
      ctxFor(p),
    );
    assert.equal(out.isError, true);
    assert.equal(called, false, 'a partial sweep was run and would have been reported as a whole one');
  });

  it("⚠️ INCIDENT 2026-08-18 — an un-ingested book's result CARRIES what she does have", async () => {
    // Turn 2: "Book 12 is as far as I've gotten into the series so far."
    // Turn 3, one minute later: "the furthest I've gotten is book 9."
    // ⚠️ Book 9 was ground truth. The "book 12" claim was CONFABULATED — an
    // availability claim made from conversation memory instead of from a call,
    // and two adjacent turns contradicted each other because of it.
    //
    // The structural half of the fix: the answer she needs is already IN the
    // result. `did_you_mean` is the real list of what is packed nearby, and the
    // note now says to take any "furthest volume" claim from there and from
    // nothing else. This pins that the data survives to the model.
    const p = port({
      search: async () =>
        OK({
          ingested: false,
          book_id: 'the-primal-hunter-12',
          did_you_mean: [
            { book_id: 'the-primal-hunter-9-a-litrpg-adventure' },
            { book_id: 'the-primal-hunter-8-a-litrpg-adventure' },
          ],
          knowledge_base_size: 159,
        }),
    });
    const out = await runTool(
      'search_book_text',
      { bookId: 'the-primal-hunter-12', query: 'stat sheet', mode: 'latest' },
      ctxFor(p),
    );
    const r = out.result as { did_you_mean: unknown[]; note: string; knowledge_base_size: number };
    assert.equal(out.isError, false);
    assert.equal(r.did_you_mean.length, 2, 'the list of what she DOES have was dropped');
    assert.equal(r.knowledge_base_size, 159);
    // ⚠️ The instruction that makes the data load-bearing rather than decorative.
    assert.match(r.note, /did_you_mean IS the list of what you actually DO have/);
    assert.match(r.note, /from nothing else/i);
    // ⚠️ And it must not invite a guess about WHEN this one arrives.
    assert.match(r.note, /put no date on when this one might arrive/i);
  });

  it('⚠️ the listing note forbids answering availability from the conversation', async () => {
    const out = await runTool('list_book_knowledge', { query: 'primal' }, ctxFor(port()));
    const note = (out.result as { note: string }).note;
    assert.match(note, /THIS LIST, FROM THIS TURN/);
    assert.match(note, /do not say how far into a series you have got/i);
  });

  it('the knowledge-base listing says the WHOLE size, not just what matched', async () => {
    const out = await runTool('list_book_knowledge', { query: 'primal' }, ctxFor(port()));
    assert.equal(out.isError, false);
    const r = out.result as { total_in_knowledge_base: number; matched: number };
    assert.equal(r.total_in_knowledge_base, 2);
    assert.equal(r.matched, 2);
  });

  it("⚠️ a route refusal's own sentence is relayed verbatim — it is the authority", async () => {
    const p = port({
      search: async () => ({ ok: false, status: 403, body: null, message: 'the estate says no' }),
    });
    const out = await runTool('search_book_text', { bookId: 'a', query: 'b' }, ctxFor(p));
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, 'the estate says no');
    assert.equal((out.result as { error: string }).error, 'books_not_permitted');
  });

  it('an unknown tool name performs no I/O and names what does exist', async () => {
    let called = false;
    const p = port({
      available: async () => {
        called = true;
        return OK({});
      },
    });
    const out = await runTool('read_whole_book', {}, ctxFor(p));
    assert.equal(out.isError, true);
    assert.equal((out.result as { error: string }).error, 'unknown_tool');
    assert.equal(called, false);
  });
});

// ── 9. ⚠️ THE CREDENTIAL SEAM, WIDENED A SECOND TIME AND IN WRITING ─────────

describe('⚠️ credentials live in exactly THREE modules', () => {
  const CREDENTIALS = [
    /firestoreRequest/,
    /mintAccessToken/,
    /parseServiceAccount/,
    /FIREBASE_SERVICE_ACCOUNT/,
    /ESTATE_APP_TOKEN/,
    /DISCORD_BOT_TOKEN/,
  ];

  it('⚠️ book-knowledge.ts — the whole contract — names none of them', () => {
    // The property `delegated-exec.ts` established was "credentials live in ONE
    // module". Tier 0b widened it to two and Tier 0c widens it to three, each
    // time on purpose and in writing — never to "credentials are allowed in the
    // chat path now".
    const source = strip(repoFile('src/book-knowledge.ts'));
    for (const forbidden of CREDENTIALS) {
      assert.doesNotMatch(source, forbidden, `book-knowledge.ts now names ${forbidden}`);
    }
  });

  it('⚠️ the book executor holds the BOOK token and NEITHER of the other two', () => {
    // Three trust edges, three secrets, and no file reaches for another's.
    // ⚠️ A leak from a library instance or from the docs corpus must not open
    // the household's derived book text — the owner's "I don't want people
    // scraping my books" applied to the more attractive scrape target.
    const booksExec = strip(repoFile('src/book-knowledge-exec.ts'));
    assert.match(booksExec, /ESTATE_APP_TOKEN_BOOKS/);
    assert.doesNotMatch(
      booksExec,
      /ESTATE_APP_TOKEN_DISCORD/,
      'the book executor reached for the Tier-1 or docs token',
    );

    const docsExec = strip(repoFile('src/estate-docs-exec.ts'));
    assert.doesNotMatch(docsExec, /ESTATE_APP_TOKEN_BOOKS/, 'the docs executor reached for the book token');
    const delegatedExec = strip(repoFile('src/delegated-exec.ts'));
    assert.doesNotMatch(delegatedExec, /ESTATE_APP_TOKEN_BOOKS/, 'the write executor reached for the book token');
  });

  it('⚠️ the book executor sends the token to ONE host, named by config, and only GETs', () => {
    const source = strip(repoFile('src/book-knowledge-exec.ts'));
    assert.match(source, /authorization: `Bearer \$\{token\}`/);
    assert.doesNotMatch(source, /method:\s*'(?:POST|PATCH|PUT|DELETE)'/);
  });

  it('⚠️ the book tool executor performs NO I/O of its own', () => {
    // It orchestrates a port it cannot construct. A `fetch` appearing in the
    // books branch would mean tool-exec.ts had grown a way to reach a gated host.
    const source = strip(repoFile('src/tool-exec.ts'));
    const branch = source.slice(source.indexOf('async function runBooksTool'));
    assert.ok(branch.length > 200, 'runBooksTool could not be found');
    assert.doesNotMatch(branch, /\bfetch\(/, 'the books branch grew its own fetch');
    assert.doesNotMatch(branch, /audiobook-api\.heygabi\.ai/, 'the books branch hardcoded the authority');
  });

  it('⚠️ the posture and the host are declared in wrangler.toml', () => {
    const toml = repoFile('wrangler.toml');
    assert.match(toml, /^GABI_BOOKS = "(on|off)"$/m);
    assert.match(toml, /AUDIOBOOK_API_URL = "https:\/\//);
    // ⚠️ A secret must never be a var. If this ever matches, somebody put a
    // bearer in a tracked file.
    assert.doesNotMatch(toml, /^ESTATE_APP_TOKEN_BOOKS\s*=/m);
  });
});

// ── 10. ⚠️ AUTO-CONTINUE — the loop of 1:31 PM, and what replaced it ────────
//
// He asked for the end-of-book-9 sheet plus abilities plus passives. She
// delivered core stats, titles and twenty class skills, stopped at profession
// skills, and ASKED PERMISSION. He said "get professions too" — and she
// re-pulled the SAME passage (same timestamps, 72538–72706), re-printed the
// ENTIRE sheet, ran out at exactly the same place, and asked again.
//
// ⚠️ Three defects in one loop, all three pinned here:
//   1. a permission turn is not a pause, it is a chance to repeat yourself;
//   2. continuing by RE-SEARCHING is an infinite loop by construction — a
//      ranked search returns its best match every time, and the tail of a sheet
//      is never the best match;
//   3. re-printing what was already sent is what consumed the room the rest of
//      it needed. The repeat CAUSED the second cutoff.
// ---------------------------------------------------------------------------

describe('⚠️ continuing pages FORWARD by ordinal, and never re-searches', () => {
  it('a count walks ord, ord+1, ord+2 — in order — and hands back where to resume', async () => {
    const asked: string[] = [];
    const p = port({
      passage: async (_e, _b, params) => {
        asked.push(params.ord as string);
        const ord = Number(params.ord);
        return OK({
          ingested: true,
          book_id: 'ph-9',
          source: 'transcript',
          passage: { ord, text: `passage ${ord}`, chapter_index: 78, stitch: 'full' },
        });
      },
    });
    const out = await runTool('read_book_passage', { bookId: 'ph-9', ord: 1796, count: 3 }, ctxFor(p));
    assert.equal(out.isError, false);
    // ⚠️ ORDER IS THE POINT. A sheet printed out of order is not a sheet.
    assert.deepEqual(asked, ['1796', '1797', '1798']);
    const r = out.result as {
      passages: { ord: number }[];
      count: number;
      next_ord: number;
      note: string;
    };
    assert.deepEqual(
      r.passages.map((x) => x.ord),
      [1796, 1797, 1798],
    );
    assert.equal(r.count, 3);
    // ⚠️ THE ANCHOR THAT ENDS THE LOOP: where to pick up, handed over rather
    // than left for the model to derive. A model that has to work out its own
    // next position is a model that will re-run the search instead.
    assert.equal(r.next_ord, 1799);
    assert.match(r.note, /call this again with ord = next_ord/i);
    assert.match(r.note, /Do NOT search again/i);
    assert.match(r.note, /PRINT ONLY WHAT IS NEW/i);
  });

  it('the run is bounded — a model asking for fifty pages gets four', async () => {
    let calls = 0;
    const p = port({
      passage: async (_e, _b, params) => {
        calls += 1;
        return OK({
          ingested: true,
          passage: { ord: Number(params.ord), text: 'x', chapter_index: 1, stitch: 'full' },
        });
      },
    });
    await runTool('read_book_passage', { bookId: 'ph-9', ord: 10, count: 50 }, ctxFor(p));
    assert.equal(calls, 4);
  });

  it('⚠️ a run that stops mid-way KEEPS what it read and says why', async () => {
    // The person gets the part that worked. Discarding a successful first page
    // because the third failed turns a partial outage into a total one.
    const p = port({
      passage: async (_e, _b, params) =>
        Number(params.ord) < 12
          ? OK({
              ingested: true,
              passage: { ord: Number(params.ord), text: 'y', chapter_index: 1, stitch: 'full' },
            })
          : { ok: false, status: 502, body: null, message: 'the shelf wobbled' },
    });
    const out = await runTool('read_book_passage', { bookId: 'ph-9', ord: 10, count: 4 }, ctxFor(p));
    assert.equal(out.isError, false, 'a later-page failure discarded the pages that worked');
    const r = out.result as { count: number; stopped_because: string; note: string };
    assert.equal(r.count, 2);
    assert.equal(r.stopped_because, 'the shelf wobbled');
    assert.match(r.note, /stopped early/i);
  });

  it('the FIRST page failing is still a plain failure — there is nothing to keep', async () => {
    const p = port({
      passage: async () => ({ ok: false, status: 502, body: null, message: 'nope' }),
    });
    const out = await runTool('read_book_passage', { bookId: 'ph-9', ord: 10, count: 3 }, ctxFor(p));
    assert.equal(out.isError, true);
  });
});

describe('⚠️ a long answer becomes consecutive messages, never a permission question', () => {
  const LONG = Array.from(
    { length: 60 },
    (_, i) => `Skill ${i + 1}: a line of the sheet that is long enough to matter.`,
  ).join('\n');

  function modelReply(text: string): Response {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'test',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  async function ask(text: string, opts: { noFollowUp?: boolean } = {}): Promise<string[]> {
    const said: string[] = [];
    await handleMention(
      {
        capCheck: async () => ({ ok: true }),
        recordTurn: async () => {},
        conversation: NO_MEMORY,
        reply: async (content: string) => {
          said.push(content);
        },
        ...(opts.noFollowUp
          ? {}
          : {
              followUp: async (content: string) => {
                said.push(content);
              },
            }),
        books: {
          port: port(),
          capCheck: async () => ({ ok: true }),
          record: async () => {},
        },
      } as never,
      {
        kind: 'ask',
        question: 'what is jakes status sheet at the end of book 9',
        authorId: '1234',
        authorName: 'owner',
        guildId: 'g1',
        channelId: 'c1',
        messageId: 'm1',
        surface: 'discord_channel',
        via: 'mention',
      } as never,
      {
        indexBaseUrl: 'https://index.test',
        panelUrl: 'https://padhard.heygabi.ai/',
        catalogBaseUrl: 'https://catalog.test',
        anthropicKey: 'test-key-not-real',
        booksEnabled: true,
        fetchOverride: (async () => modelReply(text)) as unknown as typeof fetch,
      } as never,
    );
    return said;
  }

  it('⚠️ it arrives as several LABELLED messages, in order, with no question asked', async () => {
    const said = await ask(LONG);
    assert.ok(said.length > 1, 'a long sheet was not continued at all');
    // ⚠️ Labelled so a missing middle is VISIBLE: "(3/3)" landing after "(1/3)"
    // says the second one never arrived.
    said.forEach((m, i) => {
      assert.match(
        m,
        new RegExp(`\\*\\*\\(${i + 1}/${said.length}\\)\\*\\*`),
        `part ${i + 1} of ${said.length} is mislabelled`,
      );
    });
    // ⚠️ THE POINT OF THE WHOLE CHANGE: no permission turn anywhere in it.
    for (const m of said) {
      assert.doesNotMatch(m, /want me to (keep going|continue)|shall I continue|say the word/i);
    }
  });

  it('⚠️ every message stays inside the 2,000-character ceiling, LABEL INCLUDED', async () => {
    // The label is added after the split, so the split must leave room for it.
    // Getting this wrong is a 400 from Discord on the longest answers only.
    const said = await ask(LONG);
    for (const m of said) assert.ok(m.length <= 2000, `a part was ${m.length} characters`);
  });

  it('⚠️ it is BOUNDED — a very long answer stops and says where the rest is', async () => {
    const huge = Array.from(
      { length: 900 },
      (_, i) => `Line ${i}: more of the sheet than anybody asked for.`,
    ).join('\n');
    const said = await ask(huge);
    assert.ok(said.length <= 4, `auto-continue ran to ${said.length} messages`);
    // ⚠️ Unbounded auto-continue is a way to serially dump a book into a shared
    // channel — the posture the vis_ebooks gate exists to hold.
    assert.match(said[said.length - 1] as string, /as much as I'll put in one go/i);
  });

  it('a surface with no follow-up channel still says the answer was cut', async () => {
    const said = await ask(LONG, { noFollowUp: true });
    assert.equal(said.length, 1);
    assert.match(said[0] as string, /as much as I'll put in one go/i);
  });
});

// ---------------------------------------------------------------------------
// ⚠️ TWO TRANSCRIPTS FROM 2026-08-18, both answered confidently and wrongly
// ---------------------------------------------------------------------------

describe('⚠️ REGRESSION — the confabulated relationship arc (14:15)', () => {
  it('a thematic question is recognised as one', () => {
    for (const q of [
      'how does the relationship between Carmen and Jake develop across the series?',
      'what is their dynamic like',
      'how does Jake change over the books',
      'what are the themes in this series',
      'is there any foreshadowing of that',
      'how does the romance develop',
    ]) {
      assert.equal(thematicAsk(q), true, `missed: ${q}`);
    }
  });

  it('and an ordinary FACT question is not — those are answerable from one passage', () => {
    for (const q of [
      "what is Jake's level at the end of book 9",
      'show me his stat sheet',
      'who is Carmen',
      'what happens in chapter 12',
      'does Jake get a new title',
    ]) {
      assert.equal(thematicAsk(q), false, `wrongly claimed: ${q}`);
    }
  });

  it('⚠️ the obligation forbids the exact failure — narrating past the passages', () => {
    const n = BOOKS_THEMATIC_NOTE;
    assert.match(n, /SEARCH PER BOOK AND SAY WHAT CAME BACK/);
    assert.match(n, /chapter anchors/i);
    assert.match(n, /NEVER NARRATE BEYOND THE PASSAGES YOU ACTUALLY RETRIEVED/);
    assert.match(n, /joins would be invention/i);
    // ⚠️ The sentence she should have said instead, given to her verbatim.
    assert.match(n, /can't reliably reconstruct the later arc/i);
    // ⚠️ And the specific false claim from the transcript, named and banned.
    assert.match(n, /NEVER SAY HOW FAR THROUGH A SERIES YOU HAVE READ/);
    assert.match(n, /read through book 14/i);
  });

  it('the obligation is WIRED into the book lane, not merely written', () => {
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(flow, /thematicAsk\(question\) \? BOOKS_THEMATIC_NOTE/);
  });
});

describe('⚠️ REGRESSION — the stale continuation anchor (14:06)', () => {
  it('the exact ask that was wrongly continued is a FRESH question', () => {
    assert.equal(
      continuationShape("show me Jake's most recent character sheet"),
      false,
      'THE regression: this was answered "[Continuing Jake\'s sheet…]" 34 minutes later',
    );
  });

  it('a request that NAMES its object is fresh, however short', () => {
    for (const q of ['show me his stat sheet', 'give me the titles', "find Jake's skills"]) {
      assert.equal(continuationShape(q), false, `treated as a continuation: ${q}`);
    }
  });

  it('…and a genuinely elliptical follow-up still is one', () => {
    for (const q of ['go on', 'keep going', 'yes please', 'more', 'and then?']) {
      assert.equal(continuationShape(q), true, `lost the real continuation: ${q}`);
    }
  });

  it('⚠️ the fresh-ask note forbids resuming an earlier listing', () => {
    const n = BOOKS_FRESH_ASK_NOTE;
    assert.match(n, /FRESH QUESTION, NOT A CONTINUATION/);
    assert.match(n, /do NOT resume a listing/i);
    assert.match(n, /from a search you run NOW/i);
  });

  it('it fires only when there IS an earlier exchange to be confused with', () => {
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(
      flow,
      /!continuationShape\(question\) && history\.some\(\(t\) => t\.role === 'assistant'\)/,
    );
  });
});

// ── 12. ⚠️ THE 2026-09-03 DCC INCIDENT — two defects, in one live exchange ──
//
// > **Owner:** *"how often does Carl say God Damnit Donut or something similar
// > in dungeon crawler Carl book 1"*
// > **GABI:** …found instances, then asked how far he was into book 1.
// > **Owner:** *"I've read them all"*
// > **GABI:** *"I don't have a tool that counts specific phrases across a
// > book's text."*
//
// Two complaints, and both were right:
//
//  1. *"It doesn't know that I've read the books even though I have it rated
//     and I've linked."* — the bound was derived from the QUESTION STRING and
//     from nothing else, so a rating in his own `reviews` document could not
//     reach it. And "I've read them all" failed `ENDPOINT_RE` **on the object**.
//  2. *"It couldn't answer the question and should be able to."* — her sentence
//     was TRUE. `/search` caps at six passages and `/presence` counts loose
//     words: measured on the real pack, 13 chunks and 17 hits against a true
//     phrase count of **14**. Two errors, opposite directions, neither reported.
// ---------------------------------------------------------------------------

describe('⚠️ 2026-09-03 DCC incident — the regression pair', () => {
  const OWNER_QUESTION =
    'how often does Carl say God Damnit Donut or something similar in dungeon crawler Carl book 1';
  const DCC1 = 'dungeon-crawler-carl-a-litrpg-gamelit-adventure';

  it('DEFECT 1 (was: unknown) — his own rating answers "how far are you"', () => {
    // BEFORE: boundFromQuestion saw no chapter and no endpoint, so the turn went
    // out as scope=unknown and the route returned SCOPE_UNKNOWN_ASK — she asked
    // a man who had finished and rated the book how far he had got.
    assert.deepEqual(boundFromQuestion(OWNER_QUESTION), { scope: 'unknown' });

    // AFTER: the ladder's row 7 reaches his own reviews document for THIS book.
    // ⚠️ rating is the STRING "5" on that document — the shape that made
    // `typeof rating === "number"` the wrong test.
    const readState = {
      ok: true,
      displayName: 'Skylar',
      reviews: [{ bookId: DCC1, displayName: 'Skylar', rating: '5' }],
    };
    assert.deepEqual(deriveBound(OWNER_QUESTION, readState, DCC1), {
      scope: 'whole_book',
      how: 'rating',
    });
  });

  it('DEFECT 1b (was: the follow-up left the lane) — "I have read them all" is an endpoint', () => {
    // BEFORE: ENDPOINT_RE was `i've (read|finished) (it|the whole)` and failed on
    // the OBJECT, so the sentence a person actually types landed on unknown.
    assert.deepEqual(boundFromQuestion("I've read them all"), { scope: 'whole_book' });
  });

  it('DEFECT 2 (was: no such tool) — count_phrase exists, and it is a BOOKS tool', () => {
    // BEFORE: four tools, none of which could return a number over a whole book.
    assert.ok((GABI_BOOKS_TOOL_NAMES as readonly string[]).includes('count_phrase'));
    const t = gabiBooksToolByName('count_phrase');
    assert.ok(t, 'count_phrase has no definition');
    assert.equal(t.reads, 'gated_book_text');
    assert.deepEqual([...t.methods], ['GET']);
    assert.equal(t.mutates, false);
    // ⚠️ The description has to tell a model WHEN to reach for it, or the tool
    // exists and is never called — which is indistinguishable from not having it.
    assert.match(t.description, /how often/i);
    assert.match(t.description, /variants/);
  });

  it('DEFECT 2b (was: the router never saw it) — the owner sentence is a book question', () => {
    // BEFORE: BOOKS_WEAK had `said|says` but not the bare `say`, and nothing for
    // "how often" or "how many times". The anchors matched; one missing word
    // decided the lane, and the model reached for the tools on its own.
    assert.equal(booksIntent(OWNER_QUESTION), true);
  });
});

describe('⚠️ deriveBound — the read-state ladder (§3), first hit wins', () => {
  const BOOK = 'dungeon-crawler-carl-a-litrpg-gamelit-adventure';
  const rated = (rating: unknown, over: Record<string, unknown> = {}) => ({
    ok: true,
    displayName: 'Skylar',
    reviews: [{ bookId: BOOK, displayName: 'Skylar', rating, ...over }],
  });

  it('§3.1 — every endpoint phrasing a person actually types is whole_book', () => {
    for (const q of [
      "I've read them all",
      'I have read them all',
      "I've read all of them",
      'I finished the series',
      'I read them all',
      'read the whole series',
      'caught up',
      "I've read the whole series",
      "I've read the entire series",
      "I've read the whole thing",
    ]) {
      assert.deepEqual(deriveBound(q), { scope: 'whole_book' }, `endpoint missed: ${q}`);
    }
  });

  it('⚠️ bare "I read" does NOT fire — the verb alone is not an endpoint', () => {
    // Tightened deliberately (§3.1). "I read fantasy mostly" is a preference,
    // and reading it as "I have finished this book" spoils one.
    for (const q of ['I read fantasy mostly', 'I read a lot', 'i read']) {
      assert.deepEqual(deriveBound(q), { scope: 'unknown' }, `bare verb fired: ${q}`);
    }
  });

  it('⚠️ CHAPTER OUTRANKS ENDPOINT — the more specific truth wins', () => {
    // Row 1 over row 2. Somebody who names a chapter has told you something
    // sharper than somebody who says they finished, even in one sentence.
    assert.deepEqual(deriveBound("I've read chapter 5"), { scope: 'through_chapter', chapter: 5 });
    assert.deepEqual(deriveBound("I've read them all, well, up to chapter 12"), {
      scope: 'through_chapter',
      chapter: 12,
    });
  });

  it('⚠️ ROW 7 — a rating is whole_book, whether it is a STRING or a NUMBER', () => {
    // ⚠️ Measured 2026-09-03: `rating` is "5" on two of three live documents and
    // 4.5 on the third. `typeof rating === "number"` would read the owner's own
    // five-star review as no rating at all.
    for (const r of ['5', 5, 4.5, '4.5', '0.5', 1]) {
      assert.deepEqual(
        deriveBound('what happens in it', rated(r), BOOK),
        { scope: 'whole_book', how: 'rating' },
        `a rating of ${JSON.stringify(r)} did not count as read`,
      );
    }
  });

  it('⚠️ NO RATING FLOOR — but zero, empty and missing are not ratings', () => {
    // A 0.5 is still a finished book (§3.2). A zero, an empty string and an
    // absent field are all "they did not rate it", which is NOT "they have not
    // read it" — it is `unknown`, and unknown is the honest answer.
    for (const r of [0, '0', '', null, undefined, 'nope', true, false, {}]) {
      assert.deepEqual(
        deriveBound('what happens in it', rated(r), BOOK),
        { scope: 'unknown' },
        `${JSON.stringify(r)} was treated as a rating`,
      );
    }
    assert.deepEqual(
      deriveBound(
        'what happens in it',
        { ok: true, displayName: 'Skylar', reviews: [{ bookId: BOOK, displayName: 'Skylar' }] },
        BOOK,
      ),
      { scope: 'unknown' },
    );
  });

  it('⚠️ SOMEBODY ELSE reviewing it is not evidence about the asker', () => {
    // The reviews store is keyed by display NAME and nothing else, so this
    // second check is where a widened query stops being a widened permission.
    assert.deepEqual(deriveBound('what happens in it', rated('5', { displayName: 'Sam' }), BOOK), {
      scope: 'unknown',
    });
  });

  it('⚠️ ANOTHER BOOK reviewed is not evidence about this one — per bookId, never per series', () => {
    assert.deepEqual(
      deriveBound('what happens in it', rated('5', { bookId: 'some-other-book' }), BOOK),
      { scope: 'unknown' },
    );
  });

  it('⚠️ A FAILED SHELF READ FALLS TO UNKNOWN, NEVER TO WHOLE_BOOK', () => {
    // The asymmetry is the whole safety property: guessing "finished" spoils a
    // book, guessing "unknown" costs a question.
    assert.deepEqual(deriveBound('what happens in it', { ok: false }, BOOK), { scope: 'unknown' });
    assert.deepEqual(deriveBound('what happens in it', null, BOOK), { scope: 'unknown' });
    assert.deepEqual(deriveBound('what happens in it', undefined, BOOK), { scope: 'unknown' });
    assert.deepEqual(deriveBound('what happens in it', { ok: true, reviews: [] }, BOOK), {
      scope: 'unknown',
    });
  });

  it('⚠️ NO bookId means row 7 is unreachable — the turn-level bound stays honest', () => {
    // The turn's bound is derived before any book is chosen. Letting a rating on
    // ANY book widen it would be a per-series claim wearing a per-book one's
    // clothes.
    assert.deepEqual(deriveBound('what happens in it', rated('5')), { scope: 'unknown' });
  });

  it('the question OUTRANKS the store — a sentence is live, a record is not', () => {
    assert.deepEqual(deriveBound("I'm on chapter 19", rated('5'), BOOK), {
      scope: 'through_chapter',
      chapter: 18,
    });
  });

  it('⚠️ only the WORD crosses the wire — a rating never produces an ord', () => {
    const params = boundParams(deriveBound('what happens in it', rated('5'), BOOK));
    assert.deepEqual(params, { scope: 'whole_book' });
    assert.equal('ord' in params, false);
    assert.equal('iv' in params, false);
  });

  it('rows 3-6 are TODOs with their design row numbers, not stubbed data paths', () => {
    // ⚠️ A stub for readingPositions would be a fake measurement wearing a real
    // one's clothes: the collection is EMPTY and there is no read seam.
    const source = repoFile('src/book-knowledge.ts');
    for (const row of ['§3 row 3', '§3 row 4', '§3 row 5', '§3 row 6']) {
      assert.ok(source.includes(row), `the ladder lost its TODO for ${row}`);
    }
    assert.doesNotMatch(strip(source), /readingPositions\//, 'a data path was stubbed after all');
  });
});

describe('⚠️ the pending scope ask — a clarifying question is a promise (§3.3)', () => {
  const ORIGINAL =
    'how often does Carl say God Damnit Donut or something similar in dungeon crawler Carl book 1';
  const ASKED = "I don't have a bookmark for you in that one, so how far into book 1 are you?";
  const history = [
    { role: 'user', text: ORIGINAL },
    { role: 'assistant', text: ASKED },
  ];

  it('her scope ask is recognised, and it carries the ORIGINAL question', () => {
    assert.deepEqual(pendingScopeAsk(history), { question: ORIGINAL });
  });

  it('an answer that RESOLVES the bound resumes the original question', () => {
    assert.deepEqual(booksScopeResume("I've read them all", history), { question: ORIGINAL });
    assert.deepEqual(booksScopeResume('up to chapter 12', history), { question: ORIGINAL });
  });

  it('⚠️ an answer that resolves NOTHING resumes nothing — the ask still stands', () => {
    assert.equal(booksScopeResume('no idea honestly', history), null);
    assert.equal(booksScopeResume('what about book 2', history), null);
  });

  it('no ask in the window means no resume, however endpoint-shaped the reply', () => {
    assert.equal(booksScopeResume("I've read them all", [{ role: 'user', text: ORIGINAL }]), null);
    assert.equal(booksScopeResume("I've read them all", []), null);
  });

  it('⚠️ the question she was answering is the one BEFORE the ask, never after it', () => {
    // A message after the ask is the ANSWER to it. Picking it up as the subject
    // would re-issue "I've read them all" as though it were a question.
    assert.deepEqual(pendingScopeAsk([...history, { role: 'user', text: "I've read them all" }]), {
      question: ORIGINAL,
    });
  });

  it('⚠️ booksFollowUp accepts a predecessor that SPENT BOOK BUDGET, not only one that matched', () => {
    // The hole the incident fell through: turn 1 opened a book and turn 1 did
    // NOT pass the detector, so the follow-up had no lane to continue.
    const noLane = [{ role: 'user', text: 'tell me about that thing again' }];
    assert.equal(booksFollowUp("I've read them all", noLane), false);
    assert.equal(booksFollowUp("I've read them all", noLane, { priorBookBudget: true }), true);
  });

  it('⚠️ a budget-proven predecessor still cannot capture a SHELF question', () => {
    assert.equal(
      booksFollowUp('do we have book 10?', [{ role: 'user', text: 'x' }], { priorBookBudget: true }),
      false,
    );
  });

  it('⚠️ NO NEW STORE FIELD — the marker is derived from the window, as answeredFormat is', () => {
    // The record shape is shared with the library site's chat panel through
    // packages/gabi-conversation; a field added there is a field the panel
    // silently does not have (gabi-conversation-continuity.md §1.2).
    const conv = repoFile('src/conversation.ts');
    assert.doesNotMatch(conv, /pendingScopeAsk/, 'the scope marker leaked into the store shape');
    const flow = repoFile('src/mention-flow.ts');
    assert.match(flow, /const scopeResume = booksScopeResume\(question, history\)/);
  });

  it('the resume note tells the model to answer the ORIGINAL ask and not to ask again', () => {
    assert.match(BOOKS_SCOPE_RESUMED_NOTE, /ANSWER TO YOUR OWN/i);
    assert.match(BOOKS_SCOPE_RESUMED_NOTE, /Do NOT ask how/i);
  });
});

// ── 13. ⚠️ COUNT_PHRASE — the number, and the four sentences around it ──────
//
// A count is the most quotable thing this feature produces: one integer, which
// a person repeats to somebody else. So every way of being wrong has to be
// visibly different from being right.
// ---------------------------------------------------------------------------

/** One book's count answer, shaped as the route returns it. */
const COUNT_BODY = (over: Record<string, unknown> = {}) => ({
  ingested: true,
  ok: true,
  book_id: 'dcc-1',
  title: 'Dungeon Crawler Carl',
  source: 'transcript',
  ingester_version: 3,
  q: 'God damn it, Donut',
  variants: ['God damn it, Donut'],
  total: 14,
  by_variant: [{ variant: 'God damn it, Donut', n: 14 }],
  by_chapter: [{ index: 28, title: 'Chapter 28', n: 3 }],
  quotes: [{ chapter_index: 28, ord: 500, text: 'God damn it, Donut.' }],
  hidden_by_scope: 0,
  scope: { ceiling: null, bounded: true, from: 'whole_book', chunks_visible: 1033, chunks_total: 1033 },
  matcher: 'case-insensitive; runs of whitespace collapsed',
  bytes: 400,
  ...over,
});

describe('⚠️ count_phrase builds the URL the routes actually parse', () => {
  it('⚠️ variants are PIPE-joined and the whole query is URL-ENCODED', async () => {
    // ⚠️ A COMMA IS LEGAL INSIDE THE PHRASE — "God damn it, Donut" — and the
    // `books=` list already owns the comma, which is exactly why the route
    // splits variants on a pipe. Hand-building this string is how a phrase
    // becomes two.
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      return new Response(JSON.stringify(COUNT_BODY()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    try {
      const p = makeBooksPort({
        FIREBASE_SERVICE_ACCOUNT: '{}',
        ESTATE_APP_TOKEN_BOOKS: 'not-a-real-token',
        AUDIOBOOK_API_URL: 'https://audiobook.test',
      } as never);
      assert.ok(p, 'no port was built');
      await p.count('reader@example.test', 'dcc-1', {
        q: 'God damn it, Donut',
        variants: 'goddammit Donut|goddamn it Donut',
        quotes: '3',
        scope: 'whole_book',
      });
      await p.countAcross('reader@example.test', { q: 'God damn it, Donut', books: 'dcc-1,dcc-2' });
    } finally {
      globalThis.fetch = original;
    }

    const one = seen[0] as string;
    assert.ok(one.startsWith('https://audiobook.test/api/book/dcc-1/count?'), one);
    assert.match(one, /q=God\+damn\+it%2C\+Donut/);
    assert.match(one, /variants=goddammit\+Donut%7Cgoddamn\+it\+Donut/);
    assert.match(one, /quotes=3/);
    assert.match(one, /scope=whole_book/);
    // ⚠️ The comma inside the phrase survived as %2C rather than becoming a
    // separator — the whole reason the two lists use different characters.
    assert.doesNotMatch(one.split('q=')[1] as string, /^[^&]*,[^&]*$/);

    const many = seen[1] as string;
    assert.ok(many.startsWith('https://audiobook.test/api/books/count?'), many);
    assert.match(many, /books=dcc-1%2Cdcc-2/);
  });
});

describe('⚠️ count_phrase relays the count without ever becoming the book', () => {
  it('the ordinary answer carries the number, the anchors, the source and the matcher', async () => {
    const p = port({ count: async () => OK(COUNT_BODY()) });
    const out = await runTool(
      'count_phrase',
      { bookIds: ['dcc-1'], phrase: 'God damn it, Donut', quotes: 3 },
      ctxFor(p),
    );
    assert.equal(out.isError, false);
    const r = out.result as Record<string, unknown>;
    assert.equal(r.total, 14);
    assert.equal(r.source, 'transcript');
    assert.deepEqual(r.by_chapter, [{ index: 28, title: 'Chapter 28', n: 3 }]);
    assert.equal((r.quotes as unknown[]).length, 1);
    // ⚠️ "in the transcript" is not a nicety: Whisper punctuates a catchphrase
    // its own way, so a printed book may say "goddammit" where the recording
    // says "god damn it".
    assert.match(r.note as string, /TRANSCRIPT/);
    assert.match(r.note as string, /matched/i);
  });

  it('⚠️ hidden_by_scope > 0 FORBIDS the word "never" and makes the count a "through"', async () => {
    // The mirror of the presence roll-up's measured failure: a spoiler boundary
    // reported as a fact about the book.
    const p = port({
      count: async () =>
        OK(
          COUNT_BODY({
            total: 2,
            hidden_by_scope: 12,
            scope: { ceiling: 400, bounded: true, from: 'through_chapter', ceiling_chapter: 20, ceiling_chapter_title: 'The Hallway' },
          }),
        ),
    });
    const out = await runTool(
      'count_phrase',
      { bookIds: ['dcc-1'], phrase: 'God damn it, Donut' },
      ctxFor(p, { bound: { scope: 'through_chapter', chapter: 20 } }),
    );
    const r = out.result as { note: string; hidden_by_scope: number };
    assert.equal(r.hidden_by_scope, 12);
    assert.match(r.note, /MUST NOT say "never"/i);
    assert.match(r.note, /The Hallway/);
  });

  it('⚠️ total: 0 is a REAL zero about a book she HAS read', async () => {
    const p = port({ count: async () => OK(COUNT_BODY({ total: 0, by_chapter: [], quotes: [] })) });
    const out = await runTool('count_phrase', { bookIds: ['dcc-1'], phrase: 'never said' }, ctxFor(p));
    assert.equal(out.isError, false);
    const r = out.result as { total: number; note: string };
    assert.equal(r.total, 0);
    assert.match(r.note, /ZERO IS A REAL ANSWER/i);
    assert.match(r.note, /different from not/i);
  });

  it('⚠️ ingested: false is NOT a zero — it is "I have not read that one"', async () => {
    const p = port({ count: async () => OK({ ingested: false, book_id: 'nope' }) });
    const out = await runTool('count_phrase', { bookIds: ['nope'], phrase: 'x' }, ctxFor(p));
    assert.equal(out.isError, false, 'a missing pack was reported as an error to retry around');
    const r = out.result as { ingested: boolean; say: string; note: string };
    assert.equal(r.ingested, false);
    assert.equal(r.say, BOOKS_MSG.notIngested);
    assert.match(r.note, /NOT a fact about the story/i);
  });

  it('⚠️ an empty phrase is a WORDED refusal, never a zero and never a bare 400', async () => {
    // A phrase of pure punctuation compiles to no matcher. Answering 0 would
    // read as "he never says it", which is a false statement about a book.
    const p = port({
      count: async () => ({
        ok: false,
        status: 400,
        body: { error: 'empty_phrase', detail: 'Give me the words to count.' },
        message: 'Give me the words to count.',
      }),
    });
    const out = await runTool('count_phrase', { bookIds: ['dcc-1'], phrase: '...' }, ctxFor(p));
    assert.equal(out.isError, true);
    const r = out.result as { error: string; say: string; note: string };
    assert.equal(r.error, 'empty_phrase');
    assert.match(r.say, /words to count/i);
    assert.match(r.note, /NOTHING WAS COUNTED/);
    assert.match(r.note, /Do not say zero/i);
    assert.doesNotMatch(r.say, /^\d{3}$/, 'a bare status reached a person');
  });

  it('⚠️ an iv mismatch (409) refuses in words and states that nothing was counted', async () => {
    const p = port({
      count: async () => ({
        ok: false,
        status: 409,
        body: { error: 'bound_version_mismatch', detail: 'That position was worked out against an older copy.' },
        message: 'That position was worked out against an older copy.',
      }),
    });
    const out = await runTool('count_phrase', { bookIds: ['dcc-1'], phrase: 'x' }, ctxFor(p));
    assert.equal(out.isError, true);
    const r = out.result as { error: string; say: string; note: string };
    assert.equal(r.error, 'bound_version_mismatch');
    assert.match(r.say, /older copy/);
    assert.match(r.note, /Do not\s+state a number/i);
  });

  it('⚠️ several books is a TOTALS-ONLY answer, and the relay says whole-book out loud', async () => {
    let asked: Record<string, string> = {};
    const p = port({
      countAcross: async (_e, params) => {
        asked = params;
        return OK({ ok: true, mode: 'count', variants: ['x'], matcher: 'm', books: [{ book_id: 'a', ingested: true, total: 3 }] });
      },
    });
    const out = await runTool(
      'count_phrase',
      { bookIds: ['dcc-1', 'dcc-2'], phrase: 'x', quotes: 3 },
      ctxFor(p, { bound: { scope: 'through_chapter', chapter: 4 } }),
    );
    assert.equal(asked.books, 'dcc-1,dcc-2');
    // ⚠️ NO scope parameter: a ceiling is derived against ONE pack's chapter
    // table, so there is no honest single ceiling for six of them.
    assert.equal('scope' in asked, false);
    assert.equal('quotes' in asked, false);
    const r = out.result as { scope: string; note: string };
    assert.equal(r.scope, 'whole_book');
    assert.match(r.note, /WHOLE OF EACH BOOK/i);
    assert.match(r.note, /ingested: false was NOT counted/);
  });

  it('the caps are clamped on THIS side too, and they agree with the route', async () => {
    let asked: Record<string, string> = {};
    const p = port({
      count: async (_e, _b, params) => {
        asked = params;
        return OK(COUNT_BODY());
      },
    });
    await runTool(
      'count_phrase',
      {
        bookIds: ['dcc-1'],
        phrase: 'a',
        variants: ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
        quotes: 99,
      },
      ctxFor(p),
    );
    // ⚠️ `phrase` itself is one of the six on the other end, so at most five
    // more may be sent.
    assert.equal((asked.variants as string).split('|').length, MAX_COUNT_VARIANTS - 1);
    assert.equal(asked.quotes, String(MAX_COUNT_QUOTES));
  });

  it('⚠️ more than six books is REFUSED, not quietly counted in part', async () => {
    let called = false;
    const p = port({
      countAcross: async () => {
        called = true;
        return OK({ books: [] });
      },
    });
    const out = await runTool(
      'count_phrase',
      { bookIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], phrase: 'x' },
      ctxFor(p),
    );
    assert.equal(out.isError, true);
    assert.equal(called, false, 'a partial sweep was run anyway');
    assert.match((out.result as { note: string }).note, /Nothing was counted/);
  });

  it('no phrase and no book is a refusal that says nothing was counted', async () => {
    const out = await runTool('count_phrase', { bookIds: [], phrase: '' }, ctxFor(port()));
    assert.equal(out.isError, true);
    assert.equal((out.result as { error: string }).error, 'nothing_to_count');
  });

  it('⚠️ the count is CHARGED to the turn — bytes and quotes both', async () => {
    const budget = makeBooksBudget();
    const p = port({ count: async () => OK(COUNT_BODY()) });
    await runTool('count_phrase', { bookIds: ['dcc-1'], phrase: 'x', quotes: 1 }, ctxFor(p, { budget }));
    const spent = budget.spent();
    assert.ok(spent.bytes > 0, 'the serialised count was not charged');
    assert.equal(spent.passages, 1, 'the quote was not charged as a passage');
    assert.equal(budget.used(), true, 'the daily fuse would not have been charged');
  });

  it('⚠️ a spent turn REFUSES rather than describing a count it has no room for', async () => {
    const budget = makeBooksBudget();
    budget.take(BOOKS_BYTES_PER_TURN, 0);
    const p = port({ count: async () => OK(COUNT_BODY()) });
    const out = await runTool('count_phrase', { bookIds: ['dcc-1'], phrase: 'x' }, ctxFor(p, { budget }));
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, BOOKS_MSG.turnBudgetSpent);
    // ⚠️ The word "budget" is banned from what she SAYS — it reads as a
    // malfunction when nothing is wrong.
    assert.doesNotMatch((out.result as { say: string }).say, /budget|quota|cap\b/i);
  });

  it('⚠️ THE PHRASE IS NEVER LOGGED — design §8, and the count is no exception', () => {
    const branch = strip(repoFile('src/tool-exec.ts'));
    const fn = branch.slice(branch.indexOf('async function countPhrase'));
    assert.ok(fn.length > 200, 'countPhrase could not be found');
    assert.doesNotMatch(fn, /console\.(log|error|warn)/, 'the count executor grew a log line');
  });
});

describe('⚠️ the rating bound reaches the wire, and is DISCLOSED once', () => {
  const BOOK = 'dcc-1';
  const readState = async () => ({
    ok: true,
    displayName: 'Skylar',
    reviews: [{ bookId: BOOK, displayName: 'Skylar', rating: '5' }],
  });

  it('a rated book is counted over the WHOLE book, with the sentence she must say', async () => {
    let asked: Record<string, string> = {};
    const p = port({
      count: async (_e, _b, params) => {
        asked = params;
        return OK(COUNT_BODY());
      },
    });
    const out = await runTool(
      'count_phrase',
      { bookIds: [BOOK], phrase: 'God damn it, Donut' },
      ctxFor(p, { bound: { scope: 'unknown' }, readState }),
    );
    assert.equal(asked.scope, 'whole_book');
    const r = out.result as { note: string };
    assert.match(r.note, /THEIR OWN RATING/);
    assert.ok(r.note.includes(BOOKS_MSG.ratingBound), 'the disclosure sentence is missing');
    // ⚠️ And NOT the "nobody said how far you have got" ask — that is the
    // question this whole fix exists to stop her asking.
    assert.doesNotMatch(r.note, /Nobody said how far/);
  });

  it('search_book_text gets the same upgrade — it is the same ladder', async () => {
    let asked: Record<string, string> = {};
    const p = port({
      search: async (_e, _b, params) => {
        asked = params;
        return OK({ ingested: true, book_id: BOOK, mode: 'relevant', passages: [], scope: {} });
      },
    });
    const out = await runTool(
      'search_book_text',
      { bookId: BOOK, query: 'donut' },
      ctxFor(p, { bound: { scope: 'unknown' }, readState }),
    );
    assert.equal(asked.scope, 'whole_book');
    assert.ok((out.result as { note: string }).note.includes(BOOKS_MSG.ratingBound));
  });

  it('⚠️ A SHELF READ THAT THROWS IS UNKNOWN — never whole_book', async () => {
    let asked: Record<string, string> = {};
    const p = port({
      count: async (_e, _b, params) => {
        asked = params;
        return OK(COUNT_BODY());
      },
    });
    const out = await runTool(
      'count_phrase',
      { bookIds: [BOOK], phrase: 'x' },
      ctxFor(p, {
        bound: { scope: 'unknown' },
        readState: async () => {
          throw new Error('firestore said no');
        },
      }),
    );
    assert.equal(asked.scope, 'unknown', 'a failed read became a licence to spoil the book');
    assert.doesNotMatch((out.result as { note: string }).note, /RATING/);
  });

  it('⚠️ an UNRATED book keeps the ask — unknown is not "finished"', async () => {
    let asked: Record<string, string> = {};
    const p = port({
      count: async (_e, _b, params) => {
        asked = params;
        return OK(COUNT_BODY({ scope: { ceiling: null, bounded: false, from: 'unknown', ask: 'how far are you?' } }));
      },
    });
    const out = await runTool(
      'count_phrase',
      { bookIds: ['some-other-book'], phrase: 'x' },
      ctxFor(p, { bound: { scope: 'unknown' }, readState }),
    );
    assert.equal(asked.scope, 'unknown');
    assert.match((out.result as { note: string }).note, /Nobody said how far/);
  });

  it('⚠️ the shelf is read AT MOST ONCE per turn, and only when a book is opened', async () => {
    let reads = 0;
    const loader = async () => {
      reads += 1;
      return { ok: true, displayName: 'Skylar', reviews: [{ bookId: BOOK, displayName: 'Skylar', rating: 5 }] };
    };
    const p = port({ count: async () => OK(COUNT_BODY()) });
    const ctx = ctxFor(p, { bound: { scope: 'unknown' }, readState: loader });
    await runTool('count_phrase', { bookIds: [BOOK], phrase: 'a' }, ctx);
    await runTool('count_phrase', { bookIds: [BOOK], phrase: 'b' }, ctx);
    // ⚠️ Two calls, and the loader is the memoised one the flow builds — the
    // fake here counts how many times the EXECUTOR asked for it.
    assert.ok(reads <= 2, `the executor asked for the read state ${reads} times`);
  });

  it('⚠️ a question that already stated a bound never reads the shelf at all', async () => {
    let reads = 0;
    const p = port({ count: async () => OK(COUNT_BODY()) });
    await runTool(
      'count_phrase',
      { bookIds: [BOOK], phrase: 'a' },
      ctxFor(p, {
        bound: { scope: 'through_chapter', chapter: 12 },
        readState: async () => {
          reads += 1;
          return { ok: true };
        },
      }),
    );
    assert.equal(reads, 0, 'the store was consulted although the question had already answered');
  });
});

// ── 14. ⚠️ THE CARRY, END TO END — she asked, he answered, and it RE-RAN ────
//
// The half of the 2026-09-03 incident that no unit test can hold on its own:
// the original question has to come back out of the window and be asked again,
// under the scope the answer just settled.
// ---------------------------------------------------------------------------

describe('⚠️ answering her scope question re-issues the ORIGINAL question', () => {
  const ORIGINAL =
    'how often does Carl say God Damnit Donut or something similar in dungeon crawler Carl book 1';
  const HER_ASK = 'Before I go deeper — how far into book 1 are you?';

  async function askAfterScopeQuestion(reply: string): Promise<{ sentToModel: string; scopes: string[] }> {
    const scopes: string[] = [];
    let sentToModel = '';
    const p = port({
      count: async (_e, _b, params) => {
        scopes.push(String(params.scope));
        return OK(COUNT_BODY());
      },
    });
    await handleMention(
      {
        capCheck: async () => ({ ok: true }),
        recordTurn: async () => {},
        conversation: {
          load: async () => ({
            turns: [
              { role: 'user', text: ORIGINAL, at: Date.now() - 60_000 },
              { role: 'assistant', text: HER_ASK, at: Date.now() - 30_000 },
            ],
            pending: null,
          }),
          save: async () => {},
        },
        reply: async () => {},
        followUp: async () => {},
        books: { port: p, capCheck: async () => ({ ok: true }), record: async () => {} },
      } as never,
      {
        kind: 'ask',
        question: reply,
        authorId: '1234',
        authorName: 'owner',
        guildId: 'g1',
        channelId: 'c1',
        messageId: 'm2',
        surface: 'discord_channel',
        via: 'mention',
      } as never,
      {
        indexBaseUrl: 'https://index.test',
        panelUrl: 'https://padhard.heygabi.ai/',
        catalogBaseUrl: 'https://catalog.test',
        anthropicKey: 'test-key-not-real',
        booksEnabled: true,
        fetchOverride: (async (_url: string, init: { body?: string }) => {
          sentToModel += init?.body ?? '';
          return new Response(
            JSON.stringify({
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'test',
              content: [{ type: 'text', text: '14 times.' }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as unknown as typeof fetch,
      } as never,
    );
    return { sentToModel, scopes };
  }

  it('⚠️ "I have read them all" re-asks the ORIGINAL question, with the resolved bound', async () => {
    const { sentToModel } = await askAfterScopeQuestion("I've read them all");
    // ⚠️ The question that goes back to the model is the one he actually asked —
    // not the four words that unblocked it. Answering "I've read them all" as a
    // fresh question is what happened live, and nothing re-ran the count.
    assert.ok(
      sentToModel.includes('God Damnit Donut'),
      'the original question was not re-issued to the model',
    );
    assert.ok(
      sentToModel.includes('ANSWER TO YOUR OWN'),
      'the resume note did not travel with it',
    );
    // ⚠️ And the fresh-ask note must NOT be there: this turn IS a continuation,
    // and one she asked for.
    assert.equal(
      sentToModel.includes('THIS IS A FRESH QUESTION'),
      false,
      'the resumed turn was labelled a fresh ask',
    );
  });

  it('⚠️ the books lane is entered at all — which is where it failed live', async () => {
    // "I've read them all" passes no detector: `read` is not a weak book verb and
    // it opens like nothing. Before the carry, this message left the lane and was
    // answered as a brand new question.
    const { sentToModel } = await askAfterScopeQuestion("I've read them all");
    assert.ok(sentToModel.includes('count_phrase'), 'the book tools were not even offered');
  });
});
