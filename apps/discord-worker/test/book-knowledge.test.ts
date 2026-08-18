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
  looksLikeStatQuery,
  boundFromQuestion,
  boundParams,
  makeBooksBudget,
  type BooksCallResult,
  type BooksPort,
  type BooksToolContext,
} from '../src/book-knowledge.js';
import { audiobookApiBase, DEFAULT_AUDIOBOOK_API } from '../src/book-knowledge-exec.js';
import { runTool } from '../src/tool-exec.js';

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
    // ⚠️ And it still has to MEAN something to the person: it promises a retry.
    assert.match(BOOKS_MSG.turnBudgetSpent, /ask me again/i);
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
