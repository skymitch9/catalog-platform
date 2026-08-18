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
import { describe, it } from 'node:test';

import type { CatalogRow } from '../src/catalog-data.js';
import {
  buildSuggestions,
  formatAsked,
  formatFromProfileNotes,
  PHYSICAL_SOURCE_INSTANCE,
  physicalFormatsOf,
  renderSuggestions,
  rowHasFormat,
  suggestIntent,
  suggestOn,
  SUGGEST_MSG,
  SUGGEST_NOTE,
} from '../src/suggest.js';
import { suggestGate } from '../src/suggest-flow.js';
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
