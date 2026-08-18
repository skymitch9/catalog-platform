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
  shelfIdentityMessage,
  shelfOn,
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

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ASKER = { uid: 'u-1', displayName: 'Sky' };

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
  it('GABI_SHELF is affirmative-only and ships off', () => {
    assert.equal(shelfOn({ GABI_SHELF: 'on' }), true);
    for (const v of ['true', '1', '', undefined]) assert.equal(shelfOn({ GABI_SHELF: v as string }), false);
    assert.match(repoFile('wrangler.toml'), /^GABI_SHELF = "off"$/m);
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
