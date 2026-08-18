/**
 * **TIER 0d — the asker's own shelf.** The tests that keep the design's promises.
 *
 *  1. ⚠️ **An empty reviews result is NOT proof somebody wrote none** — the join
 *     is by display NAME and the name on file is a snapshot taken at `/link`.
 *  2. ⚠️ **"Not reviewed" must never masquerade as "not read".**
 *  3. ⚠️ **The uid never comes from the model** — no argument could widen a query.
 *  4. **Another person's TBR is never offered; their reviews are public.**
 *  5. ⚠️ **A credential leaks out of the FIVE modules allowed to hold one.**
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  bookIdFromTitle,
  SHELF_MSG,
  SHELF_UNREAD_ROWS,
  shelfFollowUp,
  shelfIdentityMessage,
  shelfIntent,
  shelfLaneIntent,
  shelfOn,
  shelfPublicIntent,
  SHELF_DELIVER_NOTE,
  SHELF_NO_INTERVIEW_NOTE,
  unreadAsk,
  UNREAD_NOTE,
  type ShelfPort,
} from '../src/shelf.js';
import {
  GABI_SHELF_TOOLS,
  GABI_SHELF_TOOL_NAMES,
  GABI_TOOL_NAMES,
  isGabiShelfToolName,
  toolsForApi,
} from '../src/gabi-tools.js';
import { runTool } from '../src/tool-exec.js';
import {
  gatherNotReviewed,
  renderNotReviewed,
  NOT_REVIEWED_GROUPS,
  STANDALONE_GROUP,
} from '../src/shelf-flow.js';
import { resetCatalogCache } from '../src/catalog-data.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ASKER = { uid: 'u-1', displayName: 'Sky' };

/** ⚠️ A catalogue row fixture for the 16:25 regression below. Kept local: the
 *  suite's other sections test the TOOLS, which take rows from the executor. */
function row(over: { title: string; series?: string; author?: string; narrator?: string }): {
  title: string; series: string; author: string; narrator: string;
} {
  return {
    series: '',
    author: 'Brandon Sanderson',
    narrator: 'Michael Kramer',
    ...over,
  };
}

function port(over: Partial<ShelfPort> = {}): ShelfPort {
  return {
    asker: async () => ({ ok: true, asker: ASKER }),
    myTbr: async () => ({ ok: true, rows: [], total: 0 }),
    myReviews: async () => ({ ok: true, rows: [], total: 0 }),
    bookReviews: async () => ({ ok: true, rows: [], total: 0 }),
    ...over,
  };
}
const ctxFor = (p: ShelfPort) => ({
  catalogBaseUrl: 'https://catalog.test',
  shelf: { port: p, discordUserId: '1' },
});

// ── 1. the allowlist ───────────────────────────────────────────────────────

describe('the shelf allowlist is its own, and nothing in it writes', () => {
  it('every name has a definition, all GET, none mutating', () => {
    assert.deepEqual([...GABI_SHELF_TOOL_NAMES].sort(), GABI_SHELF_TOOLS.map((t) => t.name).sort());
    for (const t of GABI_SHELF_TOOLS) {
      assert.deepEqual([...t.methods], ['GET']);
      assert.equal(t.mutates, false, `${t.name} claims to mutate`);
    }
  });

  it('⚠️ book_reviews is marked PUBLIC and the other three are not', () => {
    // One of these four is not personal data, and a reviewer should see that at
    // a glance rather than inferring it.
    const byName = Object.fromEntries(GABI_SHELF_TOOLS.map((t) => [t.name, t.reads]));
    assert.equal(byName.book_reviews, 'public_reviews');
    for (const n of ['my_tbr', 'my_reviews', 'my_unread']) {
      assert.equal(byName[n], 'gated_personal_shelf', `${n} is mis-categorised`);
    }
  });

  it('⚠️ toolsForApi() with no argument still returns Tier 0 and nothing else', () => {
    assert.deepEqual(toolsForApi().map((t) => t.name), [...GABI_TOOL_NAMES]);
    const withShelf = toolsForApi({ shelf: true }).map((t) => t.name);
    for (const n of GABI_SHELF_TOOL_NAMES) assert.ok(withShelf.includes(n));
  });

  it('the guard is default-deny', () => {
    assert.equal(isGabiShelfToolName('my_tbr'), true);
    assert.equal(isGabiShelfToolName('their_tbr'), false);
    assert.equal(isGabiShelfToolName(null), false);
  });
});

// ── 2. ⚠️ the sentence this feature exists to get right ────────────────────

describe('⚠️ an empty reviews result is NOT "you have written none"', () => {
  it('it names the joined name and offers /link', async () => {
    const out = await runTool('my_reviews', {}, ctxFor(port()));
    assert.equal(out.isError, false);
    const r = out.result as { count: number; joined_on_name: string; say: string; note: string };
    assert.equal(r.count, 0);
    assert.equal(r.joined_on_name, 'Sky');
    assert.match(r.say, /under the name I have for you \(Sky\)/);
    assert.match(r.say, /re-run \/link/i);
    // ⚠️ The instruction that stops the confident wrong answer.
    assert.match(r.note, /DO NOT tell them they have written no reviews/i);
  });

  it('⚠️ the joined name is stated even when reviews WERE found', async () => {
    // A renamed person may have reviews filed under both names, so the join is
    // visible on every answer rather than only on the empty one.
    const p = port({
      myReviews: async () => ({
        ok: true,
        rows: [{ bookId: 'unsouled', displayName: 'Sky', rating: 5, text: 'great' }],
        total: 1,
      }),
    });
    const out = await runTool('my_reviews', {}, ctxFor(p));
    assert.equal((out.result as { joined_on_name: string }).joined_on_name, 'Sky');
  });
});

// ── 3. ⚠️ "not reviewed" may never masquerade as "not read" ────────────────

describe('⚠️ my_unread labels its basis and refuses to be a backlog', () => {
  const catalogue = [
    'title,author,narrator,duration,year,series,seriesIndex,genre,universe,libraryFormats',
    'Unsouled,Will Wight,,,,Cradle,1,,,',
    'Soulsmith,Will Wight,,,,Cradle,2,,,',
    'Blackflame,Will Wight,,,,Cradle,3,,,',
  ].join('\n');

  const fetchCatalogue = (async () =>
    new Response(catalogue, { status: 200, headers: { 'content-type': 'text/csv' } })) as unknown as typeof fetch;

  it('excludes what the asker reviewed, and names the count honestly', async () => {
    const p = port({
      myReviews: async () => ({
        ok: true,
        rows: [{ bookId: bookIdFromTitle('Unsouled'), displayName: 'Sky', rating: 5 }],
        total: 1,
      }),
    });
    const out = await runTool(
      'my_unread',
      { author: 'Will Wight' },
      { ...ctxFor(p), fetchOverride: fetchCatalogue },
    );
    assert.equal(out.isError, false);
    const r = out.result as {
      not_reviewed_count: number;
      books: { title: string; basis: string }[];
      basis_note: string;
      note: string;
    };
    // Unsouled is reviewed; the other two are not.
    assert.equal(r.not_reviewed_count, 2);
    assert.ok(!r.books.some((b) => b.title === 'Unsouled'), 'a reviewed book was listed as unread');
    // ⚠️ EVERY row says what produced it.
    for (const b of r.books) assert.equal(b.basis, 'no_review');
    assert.equal(r.basis_note, UNREAD_NOTE);
  });

  it('⚠️ the FIELD NAME cannot be misread — it is not called unread_count', async () => {
    // A field name is the first thing a model reproduces.
    const out = await runTool('my_unread', {}, { ...ctxFor(port()), fetchOverride: fetchCatalogue });
    const r = out.result as Record<string, unknown>;
    assert.ok('not_reviewed_count' in r, 'the count lost its honest name');
    assert.ok(!('unread_count' in r), 'the count is named as though it were a reading backlog');
  });

  it('⚠️ the note forbids the word "unread" and the word "backlog"', async () => {
    const out = await runTool('my_unread', {}, { ...ctxFor(port()), fetchOverride: fetchCatalogue });
    const note = (out.result as { note: string }).note;
    assert.match(note, /Say "not reviewed", never "unread"/i);
    assert.match(note, /never call this a backlog/i);
    assert.match(UNREAD_NOTE, /NOT the same as books you have not read/i);
  });

  it('⚠️ a remembered claim may never change the count', async () => {
    const out = await runTool('my_unread', {}, { ...ctxFor(port()), fetchOverride: fetchCatalogue });
    assert.match((out.result as { note: string }).note, /remembered CLAIM and not a record/i);
  });

  it('the display cap never hides the true size', async () => {
    assert.ok(SHELF_UNREAD_ROWS > 0);
    const out = await runTool('my_unread', {}, { ...ctxFor(port()), fetchOverride: fetchCatalogue });
    const r = out.result as { not_reviewed_count: number; shown: number };
    assert.ok(r.not_reviewed_count >= r.shown);
  });
});

// ── 4. identity, and the refusals ──────────────────────────────────────────

describe('⚠️ the identity is resolved server-side, and the refusals are distinct', () => {
  it('no port at all is a CONFIGURATION sentence', async () => {
    const out = await runTool('my_tbr', {}, { catalogBaseUrl: 'https://catalog.test' });
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, SHELF_MSG.notConfigured);
  });

  it('an unlinked asker is told to /link, and NOTHING is read', async () => {
    let read = false;
    const p = port({
      asker: async () => ({ ok: false, reason: 'unlinked' }),
      myTbr: async () => {
        read = true;
        return { ok: true, rows: [], total: 0 };
      },
    });
    const out = await runTool('my_tbr', {}, ctxFor(p));
    assert.equal(out.isError, true);
    assert.equal((out.result as { say: string }).say, SHELF_MSG.notLinked);
    assert.equal(read, false, 'a shelf was read for somebody with no identity');
  });

  it('⚠️ the four identity failures say four different things', () => {
    const said = new Set(
      (['unlinked', 'no_uid', 'no_name', 'outage'] as const).map((r) => shelfIdentityMessage(r)),
    );
    // no_uid and no_name share a sentence (both fixed by re-linking) — three
    // distinct sentences over four causes, deliberately.
    assert.equal(said.size, 3);
    assert.match(shelfIdentityMessage('outage'), /problem on our side/i);
  });

  it('⚠️ an outage is NOT reported as an empty shelf', async () => {
    const p = port({ myTbr: async () => ({ ok: false, rows: [], total: 0, message: 'nope' }) });
    const out = await runTool('my_tbr', {}, ctxFor(p));
    assert.equal(out.isError, true);
    assert.match((out.result as { say: string }).say, /nope/);
  });

  it('⚠️ NO TOOL TAKES A PERSON ARGUMENT — the query cannot be widened', () => {
    // This is what makes "the asker's own shelf" enforceable rather than
    // instructed. A `user`/`uid`/`person` parameter would be the whole hole.
    for (const t of GABI_SHELF_TOOLS) {
      for (const key of Object.keys(t.input_schema.properties)) {
        assert.ok(
          !/^(user|uid|person|member|who|displayName|email)$/i.test(key),
          `${t.name} takes an identity argument (${key})`,
        );
      }
    }
  });
});

// ── 5. other people: reviews yes, TBR never ────────────────────────────────

describe("⚠️ another person's reviews are public; their TBR is not", () => {
  it('book_reviews needs no identity at all — the sites show these to anybody', async () => {
    let identityRead = false;
    const p = port({
      asker: async () => {
        identityRead = true;
        return { ok: false, reason: 'unlinked' };
      },
      bookReviews: async () => ({
        ok: true,
        rows: [{ bookId: 'unsouled', displayName: 'Sam', rating: 4, text: 'liked it' }],
        total: 1,
      }),
    });
    const out = await runTool('book_reviews', { title: 'Unsouled' }, ctxFor(p));
    assert.equal(out.isError, false);
    assert.equal(identityRead, false, 'a public lookup demanded a link');
  });

  it('⚠️ ATTRIBUTE, NEVER ABSORB is instructed on every non-empty result', async () => {
    const p = port({
      bookReviews: async () => ({
        ok: true,
        rows: [{ bookId: 'x', displayName: 'Sam', rating: 4 }],
        total: 1,
      }),
    });
    const out = await runTool('book_reviews', { title: 'X' }, ctxFor(p));
    const note = (out.result as { note: string }).note;
    assert.match(note, /ATTRIBUTE, NEVER ABSORB/);
    assert.match(note, /never fold them into your own verdict/i);
    assert.match(note, /average them into a score nobody gave/i);
  });

  it('an unreviewed book is a fact about the REVIEWS, not the book', async () => {
    const out = await runTool('book_reviews', { title: 'Nobody Read This' }, ctxFor(port()));
    assert.match((out.result as { note: string }).note, /statement about the REVIEWS/i);
  });

  it("⚠️ the wording for somebody else's TBR exists and explains why", () => {
    assert.match(SHELF_MSG.notYourTbr, /isn't public anywhere on the sites/i);
    assert.match(SHELF_MSG.notYourTbr, /unlike reviews/i);
  });

  it('the title→bookId slug matches the site that filed the review', () => {
    // ⚠️ A persisted-key function mirrored from reviews.js — the two must agree
    // or every join silently orphans.
    assert.equal(bookIdFromTitle('The Way of Kings'), 'the-way-of-kings');
    assert.equal(bookIdFromTitle("Assassin's Apprentice"), 'assassin-s-apprentice');
    assert.equal(bookIdFromTitle('  Dune  '), 'dune');
  });
});

// ── 6. the posture and ⚠️ the fifth credential module ──────────────────────

describe('⚠️ credentials live in exactly FIVE modules', () => {
  it('GABI_SHELF is affirmative-only, and is now ON by owner order', () => {
    assert.equal(shelfOn({ GABI_SHELF: 'on' }), true);
    for (const v of ['true', '1', '', undefined]) assert.equal(shelfOn({ GABI_SHELF: v as string }), false);
    // ⚠️ **THIS PIN SAID `"off"` UNTIL 2026-08-18, AND THE CHANGE IS
    // DELIBERATE.** It shipped dark on the `GABI_BOOKS` precedent — it reaches a
    // named person's own reading list — and the owner then flipped it (commit
    // f46c115). The assertion MOVES WITH the decision rather than being deleted,
    // so the posture stays something somebody chose on purpose and a silent flip
    // back still fails the build.
    assert.match(repoFile('wrangler.toml'), /^GABI_SHELF = "on"$/m);
  });

  it('⚠️ shelf.ts — the contract — names no credential', () => {
    const source = strip(repoFile('src/shelf.ts'));
    for (const forbidden of [/firestoreRequest/, /mintAccessToken/, /parseServiceAccount/, /FIREBASE_SERVICE_ACCOUNT/, /ESTATE_APP_TOKEN/]) {
      assert.doesNotMatch(source, forbidden, `shelf.ts now names ${forbidden}`);
    }
  });

  it('⚠️ the shelf executor needs NO NEW SECRET, and reaches for no app token', () => {
    const source = strip(repoFile('src/shelf-exec.ts'));
    assert.match(source, /FIREBASE_SERVICE_ACCOUNT/);
    assert.doesNotMatch(source, /ESTATE_APP_TOKEN/, 'the shelf executor grew an app token');
  });

  it('⚠️ every query it builds is scoped by the ASKER, never by an argument', () => {
    const source = strip(repoFile('src/shelf-exec.ts'));
    // The TBR query filters on the asker's uid, and the reviews query on the
    // asker's display name. Both come from the link document.
    assert.match(source, /stringValue: asker\.uid/);
    assert.match(source, /stringValue: asker\.displayName/);
  });
});

// ── 7. ⚠️ THE ROUTING REGRESSION — the miss that shipped, and every line the
//        build itself prescribed ────────────────────────────────────────────

/**
 * ⚠️ **THE TRANSCRIPT IS THE TEST.** Live, minutes after `GABI_SHELF` was
 * flipped on (2026-08-18):
 *
 * > **User:** `@GABI what haven't I read by Sanderson?`
 * > **GABI:** I looked on the estate's public shelf for **not read by
 * > Sanderson**. Nothing on the estate's public shelf matches that…
 *
 * The tools were live, offered and unreachable. ⚠️ **Not an identity failure** —
 * an unlinked asker would have seen `SHELF_MSG.notLinked`, and it never appeared.
 * The intent classifier claimed the turn for the public-index branch, which never
 * calls a model at all, so nothing the model could have chosen ever mattered.
 *
 * ⚠️ **AND EVERY OTHER PRESCRIBED LINE IS TESTED WITH IT**, because the whole
 * point of the discovery is that a build can ship prescribed test lines that are
 * quietly unreachable. These are lifted verbatim from the four tool descriptions
 * in `gabi-tools.ts` — the sentences the build itself told the owner to type.
 */
describe('⚠️ the shelf lane is REACHABLE — the routing regression', () => {
  it('⚠️ THE LIVE MISS: "what haven\'t I read by Sanderson?"', () => {
    assert.equal(shelfIntent("what haven't I read by Sanderson?"), true);
    // ⚠️ Discord clients substitute a curly apostrophe as you type. A detector
    // that knows only the straight one misses every message sent from a phone.
    assert.equal(shelfIntent('what haven’t I read by Sanderson?'), true);
    assert.equal(shelfLaneIntent("@GABI what haven't I read by Sanderson?"), true);
  });

  it('every line my_tbr prescribes routes to the shelf', () => {
    for (const line of [
      "what's on my list?",
      'what is on my TBR',
      'what was I planning to get to on my reading list',
      'show me my reading list',
    ]) {
      assert.equal(shelfIntent(line), true, `my_tbr line unreachable: ${line}`);
    }
  });

  it('every line my_reviews prescribes routes to the shelf', () => {
    for (const line of [
      'what did I think of Mistborn',
      'what have I reviewed',
      'what did I rate that',
      'have I reviewed The Way of Kings',
      'my reviews please',
    ]) {
      assert.equal(shelfIntent(line), true, `my_reviews line unreachable: ${line}`);
    }
  });

  it('every line my_unread prescribes routes to the shelf', () => {
    for (const line of [
      'what have I not got to yet',
      "what haven't I read by Brandon Sanderson",
      'what else is there by Sanderson',
      'what have I not read',
    ]) {
      assert.equal(shelfIntent(line), true, `my_unread line unreachable: ${line}`);
    }
  });

  it('⚠️ book_reviews is the PUBLIC half and needs no link', () => {
    for (const line of [
      'what did Sam think of Project Hail Mary?',
      'what did <@123456789> think about Dune',
      'any reviews of Tress of the Emerald Sea',
      'who has reviewed Mistborn',
      'how did Sam rate it',
    ]) {
      assert.equal(shelfPublicIntent(line), true, `public review line unreachable: ${line}`);
      assert.equal(shelfLaneIntent(line), true);
    }
    // ⚠️ The asker's OWN review is NOT the public half — it waits behind the
    // link document, because it is a query built from their identity.
    assert.equal(shelfPublicIntent('what did I think of Dune'), false);
  });

  it('⚠️ a catalogue question is NOT a shelf question — one pronoun apart', () => {
    for (const line of [
      'what have we got by Sanderson',
      'do we have Mistborn',
      'who narrates The Way of Kings',
      'how many Cosmere books do we have',
      'what order do the Stormlight books go in',
      'how long is Project Hail Mary',
    ]) {
      assert.equal(shelfLaneIntent(line), false, `catalogue question stolen by the shelf: ${line}`);
    }
  });

  it('⚠️ CROSS-LANE: the book lane keeps every line its own tests pin', () => {
    // The shelf router runs BEFORE the book router, so anything the book lane
    // owns must not match this one. These are the shapes `booksIntent` exists
    // for — a plot question, a stat sheet, a first appearance.
    for (const line of [
      "what's Jake's status sheet at the end of book 9",
      'what happens in book 3',
      'who is introduced in the prologue',
      'does Kaladin ever appear in Mistborn',
      'first appearance of Hoid',
    ]) {
      assert.equal(shelfLaneIntent(line), false, `book-lane line stolen by the shelf: ${line}`);
    }
  });

  it('⚠️ a docs question is not a shelf question, however first-person', () => {
    for (const line of ['how do I promote the audiobook site', 'what is my rollback procedure']) {
      assert.equal(shelfIntent(line), false, `docs line stolen by the shelf: ${line}`);
    }
  });

  it('the follow-up needs a prior shelf turn, and stays short', () => {
    const history = [{ role: 'user', text: "what's on my TBR" }, { role: 'assistant', text: '…' }];
    assert.equal(shelfFollowUp('what else?', history), true);
    assert.equal(shelfFollowUp('go on', history), true);
    // ⚠️ No prior shelf turn: an ordinary short message is NOT captured.
    assert.equal(shelfFollowUp('what else?', []), false);
    // ⚠️ Long enough to carry its own subject — judged on that instead.
    assert.equal(
      shelfFollowUp(
        'and while we are at it who narrates the audiobook edition of the third one please',
        history,
      ),
      false,
    );
    // ⚠️ Already unambiguous alone — the strong half decided, not this.
    assert.equal(shelfFollowUp('what have I reviewed', history), false);
  });

  it('⚠️ the pre-router is WIRED, not merely written', () => {
    // The docs lane's own lesson, applied to itself: a detector nothing calls is
    // a detector that cannot route. This reads the flow's source, exactly as the
    // credential guards do, because "is it wired" is a property of the file.
    const flow = repoFile('src/mention-flow.ts');
    assert.match(flow, /if \(shelfLaneIntent\(question\)\)/, 'the shelf pre-router is not wired');
    assert.match(flow, /shelfFollowUp\(question, history\)/, 'the shelf follow-up is not wired');
    assert.match(flow, /personalShelfAnswer/, 'the shelf lane has no answer function');
  });
});

// ── 8. ⚠️ THE 16:25 DEFECT — she INTERVIEWED instead of delivering ────────

/**
 * ⚠️ **THE SECOND LIVE FAILURE OF THE SAME QUESTION, and the transcript is
 * again the test.** 2026-08-18 16:25, after the routing fix shipped and worked:
 *
 * > **User:** `What have I not read by Sanderson`
 * > **GABI:** *"We've got 38 Sanderson audiobooks on the shelf. But I'm going to
 * > need a bit more from you — have you worked through The Stormlight Archive
 * > and Mistborn series? Because that's a lot of books and I'd rather not just
 * > rattle off a wall of titles. What's the Cosmere stuff you have tackled?"*
 *
 * ⚠️ **The evidence no shelf tool ran is inside the sentence**: "38 Sanderson
 * audiobooks" is a CATALOGUE count, there is no "you have reviewed N" fact, and
 * every question she asked is one `my_reviews` answers exactly.
 *
 * | | The miss | The lesson |
 * |---|---|---|
 * | 15:40 | the lane was never entered | offering a tool is not routing to it |
 * | 16:25 | the lane was entered, the tool was never called | ⚠️ **entering the lane is not calling the tool** |
 *
 * The fix is not a sterner prompt — it is doing the arithmetic BEFORE the model
 * is consulted, so there is nothing left to interview anybody about.
 */
describe('⚠️ the ask-instead-of-deliver defect', () => {
  const rows = [
    row({ title: 'The Way of Kings', series: 'The Stormlight Archive' }),
    row({ title: 'Words of Radiance', series: 'The Stormlight Archive' }),
    row({ title: 'Oathbringer', series: 'The Stormlight Archive' }),
    row({ title: 'Rhythm of War', series: 'The Stormlight Archive' }),
    row({ title: 'Mistborn', series: 'Mistborn' }),
    row({ title: 'The Well of Ascension', series: 'Mistborn' }),
    row({ title: 'Elantris', series: '' }),
  ];

  function shelfPort(reviewed: string[], ok = true) {
    return {
      asker: async () => ({ ok: true as const, asker: ASKER }),
      myTbr: async () => ({ ok: true, rows: [], total: 0 }),
      myReviews: async () =>
        ok
          ? {
              ok: true,
              rows: reviewed.map((bookId) => ({ bookId, displayName: 'Sky', rating: 5 })),
              total: reviewed.length,
            }
          : { ok: false, rows: [], total: 0, message: 'down' },
      bookReviews: async () => ({ ok: true, rows: [], total: 0 }),
    } as unknown as ShelfPort;
  }

  const catalogFetch = async (): Promise<Response> =>
    new Response(
      'title,series,series_index_display,series_index_sort,author,narrator,year,genre,duration_hhmm,cover_href,companion_files,desc,library_work_id,library_formats,universe,series_gap\n' +
        rows
          .map((r) => `"${r.title}","${r.series}",,,"${r.author}","${r.narrator}",,,,,,,,,,`)
          .join('\n'),
      { status: 200, headers: { 'content-type': 'text/csv' } },
    );

  it('⚠️ THE ASK IS DETECTED — the owner\'s exact live line', () => {
    const ask = unreadAsk('What have I not read by Sanderson');
    assert.ok(ask, 'the live line no longer produces a not-reviewed ask');
    assert.equal(ask.author, 'Sanderson');
  });

  it('⚠️ A MISSING SUBJECT IS NOT A REASON TO ASK', () => {
    // "what have I not read" with no author is the case most likely to produce
    // an interview, because the honest full answer is enormous. It is answered
    // anyway — led by the series they have actually started.
    const ask = unreadAsk("what haven't I read");
    assert.ok(ask, 'a subject-less ask must still be answered');
    assert.equal(ask.author, undefined);
    assert.equal(ask.series, undefined);
  });

  it('a series can be named instead of an author', () => {
    assert.equal(unreadAsk('what have I not read in the Mistborn series')?.series, 'Mistborn');
  });

  it('⚠️ THE ARITHMETIC IS DONE, not asked about', async () => {
    resetCatalogCache();
    const worked = await gatherNotReviewed({
      catalogBaseUrl: 'https://example.test',
      ask: { author: 'Sanderson' },
      port: shelfPort(['the-way-of-kings', 'mistborn']),
      asker: ASKER,
      fetchOverride: catalogFetch as unknown as typeof fetch,
    });
    assert.ok(worked);
    assert.equal(worked.owned, 7);
    assert.equal(worked.reviewedHere, 2);
    assert.equal(worked.notReviewed, 5);
  });

  it('⚠️ THE ANSWER SHE COULD NOT GIVE IS NOW IN FRONT OF HER', async () => {
    resetCatalogCache();
    const worked = await gatherNotReviewed({
      catalogBaseUrl: 'https://example.test',
      ask: { author: 'Sanderson' },
      port: shelfPort(['the-way-of-kings', 'mistborn']),
      asker: ASKER,
      fetchOverride: catalogFetch as unknown as typeof fetch,
    });
    const rendered = renderNotReviewed(worked!);
    // The two questions she ASKED are the two facts the grounding now states.
    assert.match(rendered, /Stormlight Archive.*3 of 4 not reviewed/);
    assert.match(rendered, /Mistborn.*1 of 2 not reviewed/);
    // ⚠️ AND WHAT THEY DID REVIEW — the proof she looked, and the fact they
    // cannot get anywhere else.
    assert.match(rendered, /they reviewed: The Way of Kings/);
    // ⚠️ STARTED series lead, because that is what the asker most likely meant
    // and exactly what she tried to extract by interviewing.
    assert.match(rendered, /STARTED — lead with this one/);
    const stormlight = rendered.indexOf('The Stormlight Archive');
    const standalone = rendered.indexOf(STANDALONE_GROUP);
    assert.ok(stormlight > 0 && standalone > 0 && stormlight < standalone,
      'an unstarted group was listed above a started one');
  });

  it('⚠️ IT IS GROUPED, NOT A WALL — her instinct was HALF right', () => {
    // She balked at "a wall of titles" and she was right to; the half she got
    // wrong was concluding the alternative was a question.
    assert.match(SHELF_DELIVER_NOTE, /group by SERIES with counts/i);
    assert.match(SHELF_DELIVER_NOTE, /LEAD with the series they have actually started/i);
    assert.match(SHELF_DELIVER_NOTE, /offer the full list/i);
    // ⚠️ And a refining question is welcome only AFTER a real answer.
    assert.match(SHELF_DELIVER_NOTE, /only THEN.*ask ONE refining question/i);
  });

  it('⚠️ THE ANTI-INTERVIEW RULE IS EXPLICIT, and rides EVERY shelf answer', () => {
    assert.match(SHELF_NO_INTERVIEW_NOTE, /DELIVER FIRST, ASK SECOND/);
    assert.match(SHELF_NO_INTERVIEW_NOTE, /NEVER open by asking them/i);
    // ⚠️ The exact wrong move, named: too big is a reason to SUMMARISE.
    assert.match(SHELF_NO_INTERVIEW_NOTE, /reason to SUMMARISE it, not a reason to interview/i);
    // It is not only on the not-read lane — the flow passes it as the floor.
    const flow = repoFile('src/mention-flow.ts');
    assert.match(flow, /unreadGrounding \?\? SHELF_NO_INTERVIEW_NOTE/);
  });

  it('⚠️ THE HONESTY LABEL SURVIVES INTO THIS ANSWER SHAPE', async () => {
    resetCatalogCache();
    const worked = await gatherNotReviewed({
      catalogBaseUrl: 'https://example.test',
      ask: { author: 'Sanderson' },
      port: shelfPort(['the-way-of-kings']),
      asker: ASKER,
      fetchOverride: catalogFetch as unknown as typeof fetch,
    });
    const rendered = renderNotReviewed(worked!);
    // She used "read" and "tackled" in the defect. The grounding says NOT
    // REVIEWED everywhere and never uses the word unread.
    assert.match(rendered, /NOT REVIEWED \(this is the answer\)/);
    assert.doesNotMatch(rendered, /\bunread\b/i);
    assert.doesNotMatch(rendered, /\bbacklog\b/i);
    // And the note that forbids the swap rides with it.
    assert.match(UNREAD_NOTE, /NOT the same as books you have not read/i);
  });

  it('⚠️ A FAILED REVIEWS READ IS SAID, NOT PRESENTED AS PERSONAL', async () => {
    resetCatalogCache();
    const worked = await gatherNotReviewed({
      catalogBaseUrl: 'https://example.test',
      ask: { author: 'Sanderson' },
      port: shelfPort([], false),
      asker: ASKER,
      fetchOverride: catalogFetch as unknown as typeof fetch,
    });
    assert.equal(worked?.reviewsUnavailable, true);
    const rendered = renderNotReviewed(worked!);
    assert.match(rendered, /COULD NOT BE READ THIS TURN/);
    assert.match(rendered, /NOT personal to them/);
  });

  it('⚠️ NOTHING LEFT is "you have REVIEWED all of them", never "read"', async () => {
    resetCatalogCache();
    const worked = await gatherNotReviewed({
      catalogBaseUrl: 'https://example.test',
      ask: { author: 'Sanderson' },
      port: shelfPort([
        'the-way-of-kings', 'words-of-radiance', 'oathbringer', 'rhythm-of-war',
        'mistborn', 'the-well-of-ascension', 'elantris',
      ]),
      asker: ASKER,
      fetchOverride: catalogFetch as unknown as typeof fetch,
    });
    assert.equal(worked?.notReviewed, 0);
    const rendered = renderNotReviewed(worked!);
    assert.match(rendered, /reviewed all of them/i);
    assert.match(rendered, /never as "you have read all of them"/i);
  });

  it('⚠️ A TRUNCATED GROUPING SAYS HOW MANY IT HID', () => {
    const groups = Array.from({ length: NOT_REVIEWED_GROUPS + 3 }, (_, i) => ({
      series: `Series ${i}`,
      owned: 2,
      notReviewed: 2,
      reviewedTitles: [],
      notReviewedTitles: ['a', 'b'],
      started: false,
    }));
    const rendered = renderNotReviewed({
      subject: 'X', field: 'author', owned: 22, reviewedHere: 0, notReviewed: 22,
      groups, reviewsTotal: 0, reviewsUnavailable: false,
    });
    assert.match(rendered, /and 3 more series/);
    assert.match(rendered, /rather than implying this is all of them/);
  });

  it('⚠️ the arithmetic is WIRED into the lane, ahead of the model call', () => {
    const flow = repoFile('src/mention-flow.ts');
    const lane = flow.slice(flow.indexOf('async function personalShelfAnswer'));
    const gather = lane.indexOf('await gatherNotReviewed(');
    const converse = lane.indexOf('await converseWithTools(');
    assert.ok(gather > 0, 'the not-reviewed arithmetic is not wired');
    assert.ok(gather < converse, 'the model is consulted before the arithmetic runs');
  });
});
