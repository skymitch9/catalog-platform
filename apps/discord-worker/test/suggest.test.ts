/**
 * **BOOK SUGGESTIONS, FORMAT-AWARE.** The tests that keep the owner's own
 * sentence true.
 *
 * > *"I also need Gabi to give book suggestions and clarify if I want audio
 * > physical or ebook. For physical I only want her to suggest a physical book
 * > to a linked person who can view a book from the table she's suggesting"*
 *
 *  1. ⚠️ **The three formats are THREE DIFFERENT GATES**, and each is asserted
 *     BOTH ways — the pass and the refusal.
 *  2. ⚠️ **A refusal is never a bare status**, and an OUTAGE is never worded as a
 *     permission problem.
 *  3. ⚠️ **Nothing already reviewed is ever suggested back.**
 *  4. ⚠️ **The series continuation is the star move and fires FIRST.**
 *  5. ⚠️ **Every candidate came from data read this turn**, and the note says so.
 *  6. **The clarifying question is asked ONCE and skipped when it is known.**
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { resetCatalogCache, type CatalogRow } from '../src/catalog-data.js';
import {
  buildSuggestions,
  formatAsked,
  formatFromProfileNotes,
  PHYSICAL_SOURCE_INSTANCE,
  PHYSICAL_FORMAT_TOKENS,
  physicalFormatsOf,
  renderSuggestions,
  rowHasFormat,
  suggestFollowUp,
  suggestIntent,
  suggestMoodHints,
  suggestOfferAccepted,
  suggestOn,
  SUGGEST_MSG,
  SUGGEST_NO_FABRICATION_NOTE,
  SUGGEST_NOTE,
} from '../src/suggest.js';
import { gatherSuggestions, suggestGate } from '../src/suggest-flow.js';
import { MENTION_MSG } from '../src/mentions.js';
import { DONT_KNOW_NOTE, quotableTerm, titleShaped } from '../src/mention-flow.js';
import type { BooksPort } from '../src/book-knowledge.js';
import type { DelegatePort, LibraryInstance, WhoAmI } from '../src/delegated.js';
import type { ReviewRow, TbrRow } from '../src/shelf.js';

// ── fixtures ───────────────────────────────────────────────────────────────

function row(over: Partial<CatalogRow> & { title: string }): CatalogRow {
  return {
    author: 'Brandon Sanderson',
    narrator: 'Michael Kramer',
    year: '2010',
    genre: 'Fantasy',
    duration: '45:30',
    series: '',
    seriesIndex: '',
    seriesSort: null,
    universe: '',
    libraryFormats: [],
    seriesGap: '',
    ...over,
  };
}

const INSTANCES: LibraryInstance[] = [
  { app: 'library', label: 'the main library', baseUrl: 'https://library.heygabi.ai' },
  { app: 'library2', label: 'your own shelf', baseUrl: 'https://padhard.heygabi.ai' },
];

function delegatePort(over: Partial<DelegatePort> = {}): DelegatePort {
  return {
    linkedUid: async () => ({ ok: true, uid: 'u-1' }),
    // ⚠️ Defaults to the EMPTY shelf so a gate test proves the GATE and nothing
    // else; the physical-source tests override it explicitly.
    browseWorks: async () => ({ app: 'library', site: 'x', total: 0, rows: [] }),
    fixField: async () => ({ kind: 'unreachable' as const }),
    whoami: async (): Promise<WhoAmI | null> => ({ app: 'library', site: 'x', known: true }),
    call: async () => ({ ok: true, status: 200, message: 'done', instance: INSTANCES[0] as LibraryInstance }),
    ...over,
  };
}

function booksPort(over: Partial<BooksPort> = {}): BooksPort {
  return {
    askerEmail: async () => ({ ok: true, email: 'a@b.c' }),
    available: async () => ({ ok: true, status: 200, body: {} }),
    search: async () => ({ ok: true, status: 200, body: {} }),
    passage: async () => ({ ok: true, status: 200, body: {} }),
    presence: async () => ({ ok: true, status: 200, body: {} }),
    count: async () => ({ ok: true, status: 200, body: {} }),
    countAcross: async () => ({ ok: true, status: 200, body: {} }),
    ...over,
  };
}

// ── 1. the posture and the router ──────────────────────────────────────────

describe('the suggestion posture and its router', () => {
  it('GABI_SUGGEST is affirmative-only and ships ON', () => {
    assert.equal(suggestOn({ GABI_SUGGEST: 'on' }), true);
    for (const v of ['true', '1', 'yes', '', undefined]) {
      assert.equal(suggestOn({ GABI_SUGGEST: v as string }), false);
    }
  });

  it('a request for a recommendation is claimed', () => {
    for (const line of [
      'what should I read next',
      'recommend me something',
      'got any suggestions?',
      'what do you recommend',
      'give me a book',
      'pick me something',
    ]) {
      assert.equal(suggestIntent(line), true, `not routed to suggestions: ${line}`);
    }
  });

  it('⚠️ a catalogue or shelf question is NOT a suggestion', () => {
    for (const line of [
      'do we have Mistborn',
      'who narrates The Way of Kings',
      "what's on my TBR",
      'what did I think of Dune',
    ]) {
      assert.equal(suggestIntent(line), false, `stolen by the suggestion lane: ${line}`);
    }
  });
});

// ── 2. ⚠️ THE CLARIFYING QUESTION — asked once, skipped when known ─────────

describe('⚠️ she clarifies the format — once', () => {
  it('an explicitly named format is taken', () => {
    assert.equal(formatAsked('recommend me an audiobook'), 'audio');
    assert.equal(formatAsked('something for my kindle'), 'ebook');
    assert.equal(formatAsked('suggest me a physical book'), 'physical');
    assert.equal(formatAsked('a paperback please'), 'physical');
  });

  it('⚠️ TWO named formats is a COMPARISON, not a preference', () => {
    // Answering "audiobook or paperback?" by silently picking the first is how a
    // gate gets applied to a shelf nobody chose.
    assert.equal(formatAsked('audiobook or paperback?'), null);
  });

  it('an unstated format is null, so the ONE question gets asked', () => {
    assert.equal(formatAsked('what should I read next'), null);
    assert.match(SUGGEST_MSG.clarify, /audiobook/i);
    assert.match(SUGGEST_MSG.clarify, /ebook/i);
    assert.match(SUGGEST_MSG.clarify, /physical/i);
  });

  it('⚠️ a REGULAR stops being asked — the profile carries the preference', () => {
    assert.equal(formatFromProfileNotes(['Prefers audiobooks for the commute']), 'audio');
    assert.equal(formatFromProfileNotes(['Always reads on the kindle']), 'ebook');
  });

  it('⚠️ a READING CLAIM is not a standing preference', () => {
    // "listened to PH 9 last night" says what they did once, not what they want
    // every time — treating it as a preference silently stops asking somebody
    // who never chose.
    assert.equal(formatFromProfileNotes(['Listened to Primal Hunter 9 last night']), null);
    assert.equal(formatFromProfileNotes([]), null);
    assert.equal(formatFromProfileNotes(undefined), null);
  });
});

// ── 3. ⚠️ THE THREE GATES, BOTH WAYS ──────────────────────────────────────

describe('⚠️ AUDIO is ungated — the public slice', () => {
  it('anybody, linked or not', async () => {
    const gate = await suggestGate('audio', { discordUserId: '1' });
    assert.equal(gate.ok, true, 'the public audiobook slice must not be gated');
  });
});

describe('⚠️ EBOOK is the estate\'s existing vis_ebooks gate, asked not copied', () => {
  it('a granted asker passes', async () => {
    const gate = await suggestGate('ebook', { discordUserId: '1', books: booksPort() });
    assert.equal(gate.ok, true);
  });

  it('⚠️ a 403 is a REFUSAL, and it relays the estate\'s own sentence', async () => {
    const gate = await suggestGate('ebook', {
      discordUserId: '1',
      books: booksPort({
        available: async () => ({ ok: false, status: 403, body: null, message: 'the estate says no' }),
      }),
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false && gate.message, 'the estate says no');
  });

  it('⚠️ a 500 is an OUTAGE, never a permission failure', async () => {
    const gate = await suggestGate('ebook', {
      discordUserId: '1',
      books: booksPort({ available: async () => ({ ok: false, status: 500, body: null }) }),
    });
    assert.equal(gate.ok, false);
    assert.equal(gate.ok === false && gate.message, SUGGEST_MSG.estateUnreachable);
    assert.doesNotMatch(SUGGEST_MSG.estateUnreachable, /permission|not allowed|admin/i);
  });

  it('an unlinked asker is told to /link, and offered the audio shelf instead', async () => {
    const gate = await suggestGate('ebook', {
      discordUserId: '1',
      books: booksPort({ askerEmail: async () => ({ ok: false, reason: 'unlinked' }) }),
    });
    assert.equal(gate.ok === false && gate.message, SUGGEST_MSG.ebookNotLinked);
    assert.match(SUGGEST_MSG.ebookNotLinked, /\/link/);
    assert.match(SUGGEST_MSG.ebookNotLinked, /audiobook/i);
  });

  it('⚠️ no books port means a SETUP gap, never a permissions one', async () => {
    const gate = await suggestGate('ebook', { discordUserId: '1' });
    assert.equal(gate.ok === false && gate.message, SUGGEST_MSG.notConfigured);
    assert.match(SUGGEST_MSG.notConfigured, /setup step/i);
  });
});

describe("⚠️ PHYSICAL — the owner's own sentence, enforced", () => {
  it('the source instance is the MAIN library, which the measurement names', () => {
    assert.equal(PHYSICAL_SOURCE_INSTANCE, 'library');
  });

  it('somebody KNOWN on the main library passes', async () => {
    const gate = await suggestGate('physical', {
      discordUserId: '1',
      delegated: { port: delegatePort(), instances: INSTANCES },
    });
    assert.equal(gate.ok, true);
  });

  it('⚠️ THE REFUSAL SHAPE: not known on that shelf names the shelf AND the fix', async () => {
    const gate = await suggestGate('physical', {
      discordUserId: '1',
      delegated: {
        port: delegatePort({ whoami: async () => ({ app: 'library', site: 'x', known: false }) }),
        instances: INSTANCES,
      },
    });
    assert.equal(gate.ok, false);
    const said = gate.ok === false ? gate.message : '';
    assert.match(said, /the main library/, 'the refusal must name the shelf');
    assert.match(said, /library\.heygabi\.ai/, 'the refusal must carry the fix');
    assert.match(said, /audiobook/i, 'it must offer the shelf they CAN see');
    // ⚠️ Never a bare status, never a raw "denied".
    assert.doesNotMatch(said, /\b403\b|\bdenied\b/i);
  });

  it('⚠️ THE REFUSAL SHAPE: unlinked is a different sentence with a different fix', async () => {
    const gate = await suggestGate('physical', {
      discordUserId: '1',
      delegated: {
        port: delegatePort({ linkedUid: async () => ({ ok: false, reason: 'unlinked' }) }),
        instances: INSTANCES,
      },
    });
    assert.equal(gate.ok === false && gate.message, SUGGEST_MSG.physicalNotLinked);
    assert.match(SUGGEST_MSG.physicalNotLinked, /\/link/);
    // ⚠️ The four causes stay apart, because the fixes differ.
    assert.notEqual(SUGGEST_MSG.physicalNotLinked, SUGGEST_MSG.physicalNotShared('x', 'y'));
  });

  it('⚠️ UNREACHABLE ≠ UNKNOWN — an outage is worded as ours', async () => {
    const gate = await suggestGate('physical', {
      discordUserId: '1',
      delegated: { port: delegatePort({ whoami: async () => null }), instances: INSTANCES },
    });
    assert.equal(gate.ok, false);
    const said = gate.ok === false ? gate.message : '';
    assert.match(said, /outage on our side/i);
    assert.doesNotMatch(said, /account.*(?:isn'?t|not)\s+(?:known|there)/i);
  });

  it('⚠️ no delegated port at all refuses rather than guessing yes', async () => {
    const gate = await suggestGate('physical', { discordUserId: '1' });
    assert.equal(gate.ok === false && gate.message, SUGGEST_MSG.physicalNotConfigured);
  });
});

// ── 4. ⚠️ THE FORMAT FILTER — measured tokens, not invented ones ──────────

describe('⚠️ the format filter uses the tokens the CSV actually carries', () => {
  it('pipe-separated Hardcover|Paperback|Ebook, case-insensitively', () => {
    const both = row({ title: 'A', libraryFormats: ['Hardcover|Ebook'] });
    assert.equal(rowHasFormat(both, 'physical'), true);
    assert.equal(rowHasFormat(both, 'ebook'), true);
    const ebookOnly = row({ title: 'B', libraryFormats: ['Ebook'] });
    assert.equal(rowHasFormat(ebookOnly, 'physical'), false);
    assert.equal(rowHasFormat(ebookOnly, 'ebook'), true);
    const none = row({ title: 'C' });
    assert.equal(rowHasFormat(none, 'physical'), false);
    assert.equal(rowHasFormat(none, 'ebook'), false);
    // ⚠️ Every row of catalog.csv IS an audiobook the house holds.
    assert.equal(rowHasFormat(none, 'audio'), true);
  });

  it('the WHY names the actual print format, not "print"', () => {
    assert.deepEqual(physicalFormatsOf(row({ title: 'A', libraryFormats: ['Hardcover|Paperback'] })), [
      'hardcover',
      'paperback',
    ]);
  });
});

// ── 5. ⚠️ THE LADDER — exclusion, the star move, and the WHY ──────────────

const ROWS: CatalogRow[] = [
  row({ title: 'The Way of Kings', series: 'The Stormlight Archive', seriesIndex: '1', universe: 'The Cosmere' }),
  row({ title: 'Words of Radiance', series: 'The Stormlight Archive', seriesIndex: '2', universe: 'The Cosmere' }),
  row({ title: 'Oathbringer', series: 'The Stormlight Archive', seriesIndex: '3', universe: 'The Cosmere' }),
  row({ title: 'Mistborn', series: 'Mistborn', seriesIndex: '1', universe: 'The Cosmere' }),
  row({ title: 'Project Hail Mary', author: 'Andy Weir', libraryFormats: ['Hardcover'] }),
];

describe('⚠️ nothing already reviewed is ever suggested back', () => {
  it('a reviewed book is excluded, whatever tier would have produced it', () => {
    const reviews: ReviewRow[] = [
      { bookId: 'the-way-of-kings', displayName: 'Sky', rating: 5 },
      { bookId: 'words-of-radiance', displayName: 'Sky', rating: 5 },
    ];
    const out = buildSuggestions({ rows: ROWS, reviews, tbr: [], format: 'audio' });
    const ids = out.map((c) => c.bookId);
    assert.ok(!ids.includes('the-way-of-kings'), 'a reviewed book was suggested back');
    assert.ok(!ids.includes('words-of-radiance'), 'a reviewed book was suggested back');
  });
});

describe('⚠️ the SERIES CONTINUATION is the star move, and it fires first', () => {
  it('a well-rated volume 2 produces volume 3, with the rating as the reason', () => {
    const reviews: ReviewRow[] = [{ bookId: 'words-of-radiance', displayName: 'Sky', rating: 5 }];
    const out = buildSuggestions({ rows: ROWS, reviews, tbr: [], format: 'audio' });
    const first = out[0];
    assert.ok(first, 'no suggestion at all');
    assert.equal(first.bookId, 'oathbringer');
    assert.equal(first.basis, 'series_next');
    assert.match(first.why, /Words of Radiance/);
    assert.match(first.why, /5 stars/);
    // ⚠️ It must NOT go backwards to volume 1.
    assert.ok(!out.some((c) => c.bookId === 'the-way-of-kings' && c.basis === 'series_next'));
  });

  it('⚠️ THREE STARS IS NOT A LIKE — the ladder does not build on politeness', () => {
    const reviews: ReviewRow[] = [{ bookId: 'words-of-radiance', displayName: 'Sky', rating: 3 }];
    const out = buildSuggestions({ rows: ROWS, reviews, tbr: [], format: 'audio' });
    assert.ok(!out.some((c) => c.basis === 'series_next'), 'a 3-star rating drove a continuation');
  });

  it("⚠️ their OWN reading list outranks even the star move", () => {
    const reviews: ReviewRow[] = [{ bookId: 'words-of-radiance', displayName: 'Sky', rating: 5 }];
    const tbr: TbrRow[] = [
      { bookId: 'mistborn', title: 'Mistborn', shelf: 'audiobooks', matchedBy: 'uid' },
    ];
    const out = buildSuggestions({ rows: ROWS, reviews, tbr, format: 'audio' });
    assert.equal(out[0]?.bookId, 'mistborn');
    assert.equal(out[0]?.basis, 'tbr');
    assert.match(out[0]?.why ?? '', /your own reading list/i);
  });
});

describe('⚠️ with NO signal she says so rather than implying a personalisation', () => {
  it('the fallback WHY admits it has nothing to go on', () => {
    const out = buildSuggestions({ rows: ROWS, reviews: [], tbr: [], format: 'audio' });
    assert.ok(out.length > 0);
    assert.equal(out[0]?.basis, 'shelf');
    assert.match(out[0]?.why ?? '', /nothing else to go on/i);
    // ⚠️ AND IT NEVER SAYS UNREAD. The estate records what was REVIEWED.
    for (const c of out) assert.doesNotMatch(c.why, /\bunread\b|\bnot read\b/i);
  });

  it('the physical filter narrows to the rows that carry a print format', () => {
    const out = buildSuggestions({ rows: ROWS, reviews: [], tbr: [], format: 'physical' });
    assert.deepEqual(out.map((c) => c.bookId), ['project-hail-mary']);
    assert.match(out[0]?.shelf ?? '', /hardcover/);
  });
});

// ── 6. ⚠️ GROUNDING — every row came from a lookup made THIS turn ─────────

describe('⚠️ the grounding contract is enforced in the DATA', () => {
  it('the note forbids inventing a book and demands a reason per row', () => {
    assert.match(SUGGEST_NOTE, /SUGGEST ONLY FROM THE ROWS BELOW/);
    assert.match(SUGGEST_NOTE, /THIS turn/);
    assert.match(SUGGEST_NOTE, /GIVE EACH ONE A REASON/);
  });

  it('⚠️ the note carries the shelf lane\'s honesty rule intact', () => {
    // "not reviewed" is not "unread" — the estate has no read-state store on the
    // audiobook side, and a suggestion is exactly where that would get blurred.
    assert.match(SUGGEST_NOTE, /NEVER SAY THEY HAVE NOT READ SOMETHING/);
    assert.match(SUGGEST_NOTE, /backlog/);
  });

  it('the rendered block says how many rows and where they came from', () => {
    const out = buildSuggestions({ rows: ROWS, reviews: [], tbr: [], format: 'audio' });
    const rendered = renderSuggestions(out, 'audio');
    assert.match(rendered, /looked up this turn/);
    assert.match(rendered, /why:/);
    // ⚠️ Absent fields are OMITTED rather than nulled — a model shown
    // `narrator: null` will sometimes fill it in.
    assert.doesNotMatch(rendered, /null|undefined/);
  });
});

// ── 7. ⚠️ WIRED, NOT MERELY WRITTEN ───────────────────────────────────────

/**
 * ⚠️ **THE LESSON OF THE DAY THIS SHIPPED, APPLIED TO ITSELF.** Three features
 * in one day had a detector or a tool that existed, worked, and was never
 * reached — the docs lane, the book follow-up, and the shelf tools. Every one of
 * them passed its own unit tests while being unreachable in production.
 *
 * So "is it wired" is asserted as a property of the FLOW's source, exactly as the
 * credential guards are, and the ORDER is asserted with it — because on this
 * surface the order is the behaviour.
 */
describe('⚠️ the suggestion lane is REACHABLE, and in the right place', () => {
  const flow = readFileSync(
    fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
    'utf8',
  );

  it('the pre-router is called and the lane has an answer function', () => {
    // ⚠️ ALL THREE HALVES of the router, and the guard is written so a FOURTH
    // does not break it. `suggestOfferAccepted` was added after she offered to
    // pick a book and the acceptance went to a grep; `suggestFollowUp` after she
    // asked "audiobook, ebook, or physical?" and could not hear "physical
    // please". Each is an elliptical message that carries none of the words that
    // made it a suggestion — so the list grows, and matching the WHOLE
    // expression made this guard fail twice for being right.
    assert.match(flow, /if \(suggestIntent\(question\)\s*\|\|/, 'the suggestion pre-router is not wired');
    assert.match(flow, /suggestOfferAccepted\(question, history\)/, 'the accepted-offer half is gone');
    assert.match(flow, /const answeredFormat = suggestFollowUp\(question, history\)/, 'the answered-format half is gone');
    assert.match(flow, /await suggestAnswer\(/, 'the suggestion lane has no answer function');
  });

  it('⚠️ ORDER: docs → SUGGEST → shelf → books', () => {
    // An operational question that happens to say "recommend" is still
    // operational; a first-person "what should I read next" is a recommendation
    // rather than a reading list. Both halves are decisions, so both are pinned.
    const at = (needle: string) => flow.indexOf(needle);
    const docs = at('if (docsIntent(question))');
    const suggest = at('if (suggestIntent(question) ||');
    const shelf = at('if (shelfLaneIntent(question))');
    // ⚠️ The needle is the CONDITION'S FIRST CLAUSE, not the whole line: the book
    // router's condition grew a third half on 2026-09-03 (the answer to her own
    // scope question) and became multi-line. What this test defends is the
    // ORDER of the four lanes, and pinning it to a formatting accident made it
    // fail for being right — the same trap the suggestion guard above records.
    const books = at('booksIntent(question) ||');
    for (const [name, i] of Object.entries({ docs, suggest, shelf, books })) {
      assert.ok(i > 0, `${name} router not found in the flow`);
    }
    assert.ok(docs < suggest, 'the suggestion lane must not outrank the docs lane');
    assert.ok(suggest < shelf, 'the shelf lane would answer a recommendation with a reading list');
    assert.ok(shelf < books, 'a first-person question must not be claimed by the book lane');
  });

  it('⚠️ the gate is asked BEFORE the gathering', () => {
    // Somebody who may not be suggested a physical book must not have their
    // reading list read in order to be told so.
    const lane = flow.slice(flow.indexOf('async function suggestAnswer'));
    const gate = lane.indexOf('await suggestGate(');
    const gather = lane.indexOf('await gatherSuggestions(');
    assert.ok(gate > 0 && gather > 0);
    assert.ok(gate < gather, 'the shelf is read before the gate refuses');
  });

  it('⚠️ the lane names NO credential — the five-module guard is untouched', () => {
    const strip = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['../src/suggest.ts', '../src/suggest-flow.ts', '../src/devops-gate.ts']) {
      const source = strip(
        readFileSync(fileURLToPath(new URL(f, import.meta.url).href), 'utf8'),
      );
      for (const forbidden of [/firestoreRequest/, /mintAccessToken/, /parseServiceAccount/, /FIREBASE_SERVICE_ACCOUNT/, /ESTATE_APP_TOKEN/, /DISCORD_BOT_TOKEN/]) {
        assert.doesNotMatch(source, forbidden, `${f} now names ${forbidden}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE FIRST REAL NON-OWNER USER — 2026-08-18, 7:26 PM Phoenix
//
// Every assertion below is one sentence a real person typed into a real
// channel, and the answer he actually got. He is not a tester and he did not
// file a bug; he said "Gabi sucks what the heck" and stopped. That transcript
// is the specification now.
// ---------------------------------------------------------------------------

describe('⚠️ REGRESSION — the first stranger: "Find me something entertaining"', () => {
  /** Verbatim, both sentences, exactly as Discord delivered them. */
  const CHEETAH =
    "I can't sit and read a book it makes me fall asleep. Find me something entertaining";

  it('⚠️ the transcript that produced "Gabi sucks" now REACHES the suggestion lane', () => {
    assert.equal(
      suggestIntent(CHEETAH),
      true,
      'the sentence that broke the lane must route to it — this is THE regression test',
    );
  });

  it('⚠️ the second half alone is enough — "find me something" needs no library word', () => {
    // The defect in one line: every pre-existing pattern needed "book", "read",
    // "listen", "recommend" or "suggest". Nobody says those.
    for (const q of [
      'Find me something entertaining',
      'find me something good',
      'give me something fun',
      'pick me something short',
      'show me something new',
      'surprise me',
      'entertain me',
      "I'm bored",
      'got anything good?',
      'any good ones?',
      "what should I listen to",
      "what should I put on",
      "I'm looking for something gripping",
      "I'm in the mood for something dark",
      'something that won’t put me to sleep',
      'what would I enjoy?',
    ]) {
      assert.equal(suggestIntent(q), true, `still misses: ${q}`);
    }
  });

  it('⚠️ and it still does NOT claim turns that belong to other lanes', () => {
    // A router that catches everything is not a router. These four are the
    // lanes it sits between, and each has its own regression suite.
    for (const q of [
      'do we have The Way of Kings?',
      'who narrates Mistborn?',
      'what is the fourth book in the Dungeon Crawler Carl series?',
      "what haven't I read by Sanderson?",
      'how do I promote the audiobook site?',
      'what happens at the end of book 9?',
      'what did I think of Skyward?',
      'thanks!',
      'morning',
    ]) {
      assert.equal(suggestIntent(q), false, `wrongly claimed: ${q}`);
    }
  });

  it('⚠️ the MOOD is read as a requirement, not discarded as small talk', () => {
    const hints = suggestMoodHints(CHEETAH);
    assert.ok(hints.length > 0, 'the sentence carries preferences and they were dropped');
    const joined = hints.join(' ');
    assert.match(joined, /AUDIO/, 'falling asleep over a page names the shelf');
    assert.match(joined, /ENTERTAINING/, '"entertaining" is what he asked for');
  });

  it('⚠️ a mood hint can NEVER open a gated shelf — it is not a format', () => {
    // The separation that makes the hints safe: `formatAsked` drives the ebook
    // and physical PERMISSION gates and still requires an explicit word.
    assert.equal(formatAsked(CHEETAH), null);
    assert.equal(formatAsked('find me something entertaining'), null);
    // And an explicit word still works, unchanged.
    assert.equal(formatAsked('any audiobooks worth a listen?'), 'audio');
    assert.equal(formatAsked('something in paperback'), 'physical');
  });

  it('⚠️ an ordinary sentence yields NO hints — nothing is invented', () => {
    assert.deepEqual(suggestMoodHints('what should I read next?'), []);
    assert.deepEqual(suggestMoodHints(''), []);
  });

  it('⚠️ an unstated format DELIVERS AUDIO PICKS and asks AFTER — never instead', () => {
    const lane = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    const body = lane.slice(lane.indexOf('async function suggestAnswer'));
    const end = body.indexOf('\nconst SUGGEST_MSG_MORE');
    const fn = body.slice(0, end > 0 ? end : body.length);
    // The old shape — a bare `return` of the clarify sentence before anything
    // was read — is what handed a stranger a question and no books.
    assert.doesNotMatch(
      fn,
      /return\s*\{\s*content:\s*SUGGEST_MSG\.clarify/,
      'the clarify question is back to REPLACING the answer',
    );
    assert.match(fn, /chosen\s*\?\?\s*'audio'/, 'an unstated format must fall back to the public tier');
    assert.match(fn, /assumedPublic/, 'the answer has to know it assumed, so it can say so');
  });

  it('⚠️ the audio fallback opens NO gate the person did not name', () => {
    // `suggestGate('audio', …)` needs no port and no identity: it is the public
    // slice, the same scope `/have` answers at. Proven by calling it with an
    // empty world — an ebook or physical default would need a port and would
    // refuse here.
    return suggestGate('audio', { discordUserId: 'u1' }).then((v) => {
      assert.equal(v.ok, true, 'audio must stay ungated — it is the published catalogue');
    });
  });
});

describe('⚠️ REGRESSION — she must not quote a mangled version of your sentence back', () => {
  it('⚠️ a REDUCTION is never quotable, at any length', () => {
    // Cheetah11's soup — seven words.
    assert.equal(
      quotableTerm(
        "I can't sit and read a book it makes me fall asleep. Find me something entertaining",
        "can't sit read makes fall asleep something entertaining",
      ),
      null,
    );
    // ⚠️ AND Sky's, which is FOUR words and passed the first version of this
    // rule. Length was never the property that mattered.
    // ⚠️ Four words — it PASSED the first version of this rule and shipped as
    // soup the same night. What she may quote now is his own sentence, never
    // the reduction of it.
    assert.notEqual(
      quotableTerm('soemthing good to read i suppose', 'soemthing good read suppose'),
      'soemthing good read suppose',
      'the reduction must never be what she quotes',
    );
    assert.equal(
      quotableTerm('soemthing good to read i suppose', 'soemthing good read suppose'),
      'soemthing good to read i suppose',
      'his own words, verbatim, are the honest thing to show',
    );
  });

  it('an UNREDUCED term is quotable — it is literally what they typed', () => {
    assert.equal(quotableTerm('The Way of Kings', 'The Way of Kings'), 'The Way of Kings');
    // Punctuation and case are not a reduction.
    assert.equal(quotableTerm('Mistborn?', 'Mistborn'), 'Mistborn');
  });

  it('a SHORT question that was reduced is quoted VERBATIM instead', () => {
    assert.equal(
      quotableTerm('do we have The Way of Kings?', 'way Kings'),
      'do we have The Way of Kings?',
      'their own words beat a machine paraphrase of them',
    );
  });

  it('a LONG reduced question is described, never quoted', () => {
    assert.equal(
      quotableTerm(
        'what is the fourth book in the Dungeon Crawler Carl series that we own on audio',
        'fourth Dungeon Crawler Carl series own audio',
      ),
      null,
    );
    assert.equal(quotableTerm('', ''), null);
  });

  it('⚠️ the unsure sentence says what she CAN do, and claims nothing about the catalogue', () => {
    const m = MENTION_MSG.unsureWhatToSearch;
    assert.match(m, /not sure what to look up/i);
    assert.match(m, /title, an author or a series/i, 'it has to say what would work');
    assert.match(m, /mood for/i, 'and it has to offer the lane that actually fits');
    assert.doesNotMatch(m, /Nothing on the estate/i, 'an unbuilt search is not evidence of absence');
  });
});

describe('⚠️ REGRESSION — she offered, he accepted, she searched the shelf for it', () => {
  const OFFER = 'That sounds rough. Would you rather I dig up something good to read?';
  const hist = (assistantText: string) => [
    { role: 'user', text: 'rough day today' },
    { role: 'assistant', text: assistantText },
  ];

  it('the exact acceptance that broke — typo and all — now routes to suggestions', () => {
    assert.equal(
      suggestOfferAccepted('soemthing good to read i suppose', hist(OFFER)),
      true,
      'THE regression: an acceptance carries none of the words that made the offer',
    );
  });

  it('⚠️ and the typo needed no fuzzy matcher — the OFFER carried the lane', () => {
    // The same sentence with no offer in front of it stays unclaimed, which is
    // what proves the fix is contextual rather than a spelling hack.
    assert.equal(suggestOfferAccepted('soemthing good to read i suppose', []), false);
    assert.equal(suggestIntent('soemthing good to read i suppose'), false);
  });

  it('bare content-free acceptances work, which is the whole point', () => {
    for (const q of ['yes please', 'sure', 'go on', 'ok', 'why not', 'i suppose', 'go for it']) {
      assert.equal(suggestOfferAccepted(q, hist(OFFER)), true, `missed: ${q}`);
    }
  });

  it('⚠️ no offer means no claim — a stale invitation cannot hijack a new question', () => {
    for (const q of ['yes please', 'sure', 'go on']) {
      assert.equal(suggestOfferAccepted(q, hist('Here is what the catalogue says.')), false, q);
    }
    // …and only her MOST RECENT turn counts.
    const stale = [
      { role: 'assistant', text: OFFER },
      { role: 'user', text: 'actually who narrates Mistborn' },
      { role: 'assistant', text: 'Michael Kramer narrates it.' },
    ];
    assert.equal(suggestOfferAccepted('sure', stale), false, 'an overtaken offer is not live');
  });

  it('a new QUESTION after an offer is not an acceptance of it', () => {
    assert.equal(suggestOfferAccepted('actually who narrates The Way of Kings?', hist(OFFER)), false);
    assert.equal(
      suggestOfferAccepted(
        'no thanks, what is the fourth Dungeon Crawler Carl book we own',
        hist(OFFER),
      ),
      false,
      'too long to be an acceptance, and it names a different lane',
    );
  });

  it('the acceptance router is WIRED into the suggestion lane', () => {
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(flow, /suggestIntent\(question\) \|\| suggestOfferAccepted\(question, history\)/);
  });
});

describe('⚠️ she answers when she does not know — the soup-search default dies', () => {
  it('a question that NAMES something findable is still looked up', () => {
    for (const q of [
      'do we have The Way of Kings?',
      'mistborn?',
      'who narrates Skyward',
      'anything by Brandon Sanderson on the shelf',
      'is "The Final Empire" here',
    ]) {
      assert.equal(titleShaped(q), true, `stopped searching for: ${q}`);
    }
  });

  it('⚠️ and a sentence that names nothing findable is NOT', () => {
    // Every one of these was answered with "nothing on the estate's public
    // shelf matches that" by the ladder this replaces.
    for (const q of [
      'how do i promote the audiobook site to production again',
      'i had a really rough day at work today and i am tired',
      'what can you actually do for me around here',
      'i cannot sit and read a book it makes me fall asleep',
    ]) {
      assert.equal(titleShaped(q), false, `still soup-searching: ${q}`);
    }
  });

  it('⚠️ the fallback tells her to answer, not to apologise or interrogate', () => {
    assert.match(DONT_KNOW_NOTE, /NOTHING TO LOOK UP HERE/);
    assert.match(DONT_KNOW_NOTE, /acknowledge what they actually said/i);
    assert.match(DONT_KNOW_NOTE, /two or three things you CAN do/i);
    // The three behaviours it exists to prevent, each named.
    assert.match(DONT_KNOW_NOTE, /Do NOT say that nothing on the shelf matches/);
    assert.match(DONT_KNOW_NOTE, /invent a search you did not run/i);
    assert.match(DONT_KNOW_NOTE, /NOT ask a question instead of giving them something/i);
  });

  it('the lookup is gated on it in the flow, and the fallback is wired', () => {
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(flow, /const shouldLookUp = intent === 'question' && titleShaped\(question\)/);
    assert.match(flow, /grounding = DONT_KNOW_NOTE/);
  });
});

// ── 8. ⚠️ THE 2026-08-19 PHYSICAL DEFECT — both halves ────────────────────

/**
 * ⚠️ **THE ARCHIVE TRANSCRIPT IS THE TEST.**
 *
 * > **GABI:** *"audiobook, ebook, or a physical copy?"*
 * > **User:** `physical please`
 * > **GABI:** *"Fair point — I suppose I can actually look at what's physically
 * > here… Nothing's come through the scanner yet in that direction, so the
 * > catalogue won't show me what you've got on the shelves. You'd have to browse
 * > them yourself…"*
 *
 * ⚠️ **TWO failures with ONE cause.** `suggestIntent('physical please')` is
 * false and `suggestOfferAccepted` does not catch it either — that one looks for
 * HER OFFER being accepted, this is her QUESTION being answered. So the lane was
 * never re-entered, no source was ever consulted, and the "empty data" was a
 * turn that never ran. The fabrication was a model filling the gap that left.
 */
describe('⚠️ she asked the format question and could not hear the answer', () => {
  const asked = [
    { role: 'user', text: 'recommend me something' },
    { role: 'assistant', text: SUGGEST_MSG.clarify },
  ];

  it("⚠️ THE LIVE LINE: 'physical please' re-enters the lane", () => {
    assert.equal(suggestIntent('physical please'), false, 'precondition: it is not a strong ask');
    assert.equal(suggestFollowUp('physical please', asked), 'physical');
  });

  it('every plain answer to her own question is heard', () => {
    for (const [line, want] of [
      ['physical', 'physical'],
      ['physical please', 'physical'],
      ['ebook please', 'ebook'],
      ['audiobook', 'audio'],
      ['just the audiobook', 'audio'],
      ['paperback', 'physical'],
    ] as const) {
      assert.equal(suggestFollowUp(line, asked), want, `unheard: ${line}`);
    }
  });

  it('⚠️ it needs a PRIOR suggestion turn — it cannot capture a stray word', () => {
    assert.equal(suggestFollowUp('physical please', []), null);
    assert.equal(
      suggestFollowUp('physical please', [{ role: 'user', text: 'do we have Mistborn' }]),
      null,
    );
  });

  it('⚠️ TWO formats is the question asked BACK, and re-enters on neither', () => {
    assert.equal(suggestFollowUp('audiobook or paperback?', asked), null);
  });

  it('a long message carries its own subject and is judged on that', () => {
    assert.equal(
      suggestFollowUp('actually never mind the physical, what time does the library shut', asked),
      null,
    );
  });

  it('⚠️ the router is WIRED to it, and the format is PASSED DOWN', () => {
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(flow, /const answeredFormat = suggestFollowUp\(question, history\)/);
    assert.match(flow, /\|\| answeredFormat\) \{/, 'the router does not admit the answered format');
    // ⚠️ And it must not ask the same question twice.
    assert.match(flow, /ctx\.answeredFormat/);
  });
});

/**
 * ⚠️ **THE FABRICATION — availability-grounding on a new lane.**
 *
 * She said *"nothing's come through the scanner yet"* having read nothing about
 * a scanner, an ingestion queue, or the state of the physical catalogue — which
 * in fact holds 448 works. An empty lookup is a fact about the LOOKUP.
 */
describe('⚠️ an empty lookup may not become a claim about the world', () => {
  it('⚠️ NO EMPTY PATH CLAIMS SCANNING OR CATALOGUING STATE', () => {
    const forbidden =
      /scann?(?:er|ed|ing)|come through|ingest|catalogued yet|not been (?:added|processed|entered)|nothing.*(?:owned|on your shelves)/i;
    for (const format of ['audio', 'ebook', 'physical'] as const) {
      const said = SUGGEST_MSG.nothingLeft(format);
      assert.doesNotMatch(said, forbidden, `${format} empty path invents a state-of-the-world claim`);
    }
  });

  it('⚠️ it says MY LOOKUP, not YOUR SHELVES', () => {
    const said = SUGGEST_MSG.nothingLeft('physical');
    assert.match(said, /my (?:physical )?lookup came back empty/i);
    assert.match(said, /my limit rather than your shelves/i);
  });

  it('and it says what she CAN do', () => {
    assert.match(SUGGEST_MSG.nothingLeft('physical'), /library\.heygabi\.ai/);
    assert.match(SUGGEST_MSG.nothingLeft('physical'), /audiobook/i);
    assert.match(SUGGEST_MSG.nothingLeft('ebook'), /audiobook/i);
    assert.match(SUGGEST_MSG.nothingLeft('audio'), /look again/i);
  });

  it('⚠️ the empty path is a CONSTANT — a sentence the model never writes', () => {
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(flow, /candidates\.length === 0\) return done\(SUGGEST_MSG\.nothingLeft\(format\)/);
  });

  it('⚠️ and the grounded turn carries the no-fabrication rule too', () => {
    assert.match(SUGGEST_NO_FABRICATION_NOTE, /SAY WHAT YOU LOOKED AT AND WHAT CAME BACK/);
    assert.match(SUGGEST_NO_FABRICATION_NOTE, /You may NOT explain WHY it is empty/i);
    assert.match(SUGGEST_NO_FABRICATION_NOTE, /Nothing has been scanned yet/i);
    const flow = readFileSync(
      fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href),
      'utf8',
    );
    assert.match(flow, /SUGGEST_NO_FABRICATION_NOTE/);
  });

  it('⚠️ THE PHYSICAL LIMIT IS NAMED HONESTLY, not explained away', () => {
    // What she can actually see from Discord is the audiobook catalogue's
    // cross-linked print rows — a small slice. Saying so is honest; inventing a
    // scanner backlog is not.
    assert.match(SUGGEST_MSG.nothingLeft('physical'), /cross-linked/i);
    assert.match(SUGGEST_MSG.nothingLeft('physical'), /small slice/i);
  });
});

/** ⚠️ A catalogue with a header and NO rows: these tests exercise the LIBRARY
 *  source, so the audiobook CSV must contribute nothing. */
const CSV_HEADER_ONLY =
  'title,series,series_index_display,series_index_sort,author,narrator,year,genre,' +
  'duration_hhmm,cover_href,companion_files,desc,library_work_id,library_formats,universe,series_gap' +
  String.fromCharCode(10);

// ── 9. ⚠️ THE PHYSICAL SOURCE — the library's own shelf ───────────────────

/**
 * ⚠️ **THE SOURCE THAT TOLD THE OWNER HIS SHELVES WERE EMPTY IS GONE.** Until
 * 2026-08-19 physical drew from `catalog.csv`'s cross-linked print rows — 64 of
 * 1,079, a slice of the AUDIOBOOK catalogue's join. The print catalogue holds
 * **448 works, 341 with a held physical copy**, and none were reachable.
 *
 * ⚠️ The vis/known gate is UNCHANGED and still sits in front. This is only what
 * the ALLOWED path reads.
 */
describe("⚠️ physical is sourced from the library's own shelf", () => {
  const shelfRows = [
    { id: '1', title: 'Project Hail Mary', authors: 'Andy Weir', formats: ['Hardcover'], url: 'https://library.heygabi.ai/work/1' },
    { id: '2', title: 'Piranesi', authors: null, formats: [], url: 'https://library.heygabi.ai/work/2' },
    { id: '3', title: 'Dune', authors: 'Frank Herbert', formats: ['Mass market'], url: 'https://library.heygabi.ai/work/3' },
  ];

  it('⚠️ MASS MARKET IS MATCHED — it silently dropped before today', () => {
    assert.ok(
      (PHYSICAL_FORMAT_TOKENS as readonly string[]).includes('mass market'),
      'a mass-market paperback would be dropped from every physical suggestion',
    );
    const r = row({ title: 'Dune', libraryFormats: ['Mass market'] });
    assert.equal(rowHasFormat(r, 'physical'), true);
    // ⚠️ And it is NOT renamed to "paperback" in her own sentence.
    assert.deepEqual(physicalFormatsOf(r), ['mass market']);
  });

  it("the library rows become suggestions, with the site's own URL", async () => {
    resetCatalogCache();
    const got = await gatherSuggestions({
      catalogBaseUrl: 'https://example.test',
      format: 'physical',
      browsed: { rows: shelfRows, total: 341 },
      fetchOverride: (async () =>
        new Response(CSV_HEADER_ONLY, {
          status: 200, headers: { 'content-type': 'text/csv' },
        })) as unknown as typeof fetch,
    });
    assert.ok(got);
    assert.equal(got.candidates.length, 3);
    // ⚠️ VERBATIM. Assembling a URL here would be a second implementation of
    // that site's routing, in a repo that does not deploy it.
    assert.equal(got.candidates[0]?.url, 'https://library.heygabi.ai/work/1');
  });

  it('⚠️ formats:[] IS SUGGESTIBLE — "held, printing not typed in yet"', async () => {
    resetCatalogCache();
    const got = await gatherSuggestions({
      catalogBaseUrl: 'https://example.test',
      format: 'physical',
      browsed: { rows: [shelfRows[1]!], total: 341 },
      fetchOverride: (async () =>
        new Response(CSV_HEADER_ONLY, {
          status: 200, headers: { 'content-type': 'text/csv' },
        })) as unknown as typeof fetch,
    });
    const c = got!.candidates[0]!;
    // Never dropped, and never called "not physical".
    assert.match(c.shelf, /copy is held/i);
    assert.match(c.why, /edition is not recorded yet, but the book is there/i);
    // ⚠️ A null author is OMITTED, never printed as a sentinel.
    assert.equal(c.author, '');
    assert.doesNotMatch(renderSuggestions([c], 'physical'), /—\s*$|Unknown/m);
  });

  it('⚠️ A REFUSED OR UNREACHABLE VERB IS AN EMPTY LIST, never a claim', async () => {
    resetCatalogCache();
    const got = await gatherSuggestions({
      catalogBaseUrl: 'https://example.test',
      format: 'physical',
      browsed: null,
      fetchOverride: (async () =>
        new Response(CSV_HEADER_ONLY, {
          status: 200, headers: { 'content-type': 'text/csv' },
        })) as unknown as typeof fetch,
    });
    assert.deepEqual(got?.candidates, []);
    // …which the lane renders as the honest-limit constant, still free of any
    // scanning/cataloguing claim.
    assert.doesNotMatch(SUGGEST_MSG.nothingLeft('physical'), /scann?(er|ed|ing)|come through/i);
  });

  it('⚠️ the verb is a READ, declared as one, and wired to the lane', () => {
    const flow = readFileSync(fileURLToPath(new URL('../src/mention-flow.ts', import.meta.url).href), 'utf8');
    assert.match(flow, /port\.browseWorks\(instance, link\.uid\)/, 'the library shelf is not read');
    // ⚠️ The GATE still runs first — this changed what the allowed path reads,
    // never who is allowed.
    const lane = flow.slice(flow.indexOf('async function suggestAnswer'));
    assert.ok(lane.indexOf('await suggestGate(') < lane.indexOf('browseWorks'),
      'the library shelf is read before the gate decides');
  });
});
