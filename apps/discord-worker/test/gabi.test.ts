/**
 * `/gabi` — the fixer's Discord surface, shape (b) propose-and-deep-link.
 *
 * Three of these tests exist to stop a well-meaning future change rather than
 * to check today's behaviour, and they are the ones worth keeping:
 *
 *   - **the bot writes NOTHING and calls NO model.** Every request the flow
 *     makes is asserted, by method and host. Shape (b)'s entire justification
 *     is "zero new custody"; a POST to Anthropic or a Firestore write would
 *     erase it while every other test still passed.
 *   - **the deep link's prefill argument is OPTIONAL.** ⚠️ Superseded
 *     2026-08-18: this used to read "carries no query string", on a measurement
 *     that the panel parsed no URL parameter. The panel half landed
 *     (`library_catalog` 8745191) and the link now carries `?gabi=<question>`.
 *     What still has to hold is that `GET /api/health`, which has no question,
 *     keeps producing a working link. The prefill and the asker-aware
 *     destination are pinned in `panel.test.ts`.
 *   - **the answer NEVER claims the panel will open.** The bot cannot resolve
 *     a library role from a Discord id (design §10.2 blocker 1), and the one
 *     failure mode of a propose-and-link surface is promising a door that is
 *     locked.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildGabiAnswer,
  DEFAULT_PANEL_BASE,
  GABI_MSG,
  MAX_GABI_HITS,
  nibbleFrom,
  panelBase,
  panelDeepLink,
  processGabi,
  readLinkState,
  searchTermFor,
  stripFormatWords,
} from '../src/gabi.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, GABI_COMMAND_NAME, routeInteraction } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

// The same fetch stand-in shape have.test.ts uses: a test that forgets to
// install one fails loudly rather than quietly hitting the live index.
interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  calls: Call[];
  restore(): void;
} {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ANSWER = {
  query: 'mistborn',
  scope: ['audiobook'],
  books: [
    {
      title: 'Mistborn: The Final Empire',
      creator: 'Brandon Sanderson',
      entries: [
        { source: 'audiobook', format: 'audiobook', detail_url: 'https://audiobooks.heygabi.ai/#q=Mistborn' },
      ],
    },
  ],
  games: [],
};

const PANEL = panelDeepLink(DEFAULT_PANEL_BASE);

// ===========================================================================
// The deep link — the half of the answer that is always correct
// ===========================================================================

test('the BARE deep link still works — /api/health has no question to give it', () => {
  assert.equal(panelDeepLink(DEFAULT_PANEL_BASE), 'https://padhard.heygabi.ai/');
  assert.equal(DEFAULT_PANEL_BASE, 'https://padhard.heygabi.ai');
  // ⚠️ SUPERSEDED 2026-08-18 — this assertion used to be "no query string, and
  // that is measured". The panel half landed; the property that survived is
  // that the argument is OPTIONAL, because the health row calls this with no
  // question and a crash or a `?gabi=` with nothing after it would both be
  // worse than the constant it replaced.
  const url = new URL(panelDeepLink(DEFAULT_PANEL_BASE));
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  // Whitespace-only is the same as absent — never a dangling `?gabi=`.
  assert.equal(new URL(panelDeepLink(DEFAULT_PANEL_BASE, '  \n  ')).search, '');
  // Trailing slashes normalise rather than doubling.
  assert.equal(panelDeepLink('https://example.test///'), 'https://example.test/');
});

test('panelBase: the panel host by default, overridable by a var', () => {
  assert.equal(panelBase({}), DEFAULT_PANEL_BASE);
  assert.equal(panelBase({ GABI_PANEL_URL: '   ' }), DEFAULT_PANEL_BASE);
  assert.equal(panelBase({ GABI_PANEL_URL: 'https://example.test' }), 'https://example.test');
});

test('the link is offered in EVERY state — hit, miss, and outage', () => {
  const states = [
    nibbleFrom('mistborn', { ok: true, answer: ANSWER }),
    nibbleFrom('mistborn', { ok: true, answer: { books: [] } }),
    nibbleFrom('mistborn', { ok: false, reason: 'unreachable', status: 0 }),
    nibbleFrom('mistborn', { ok: false, reason: 'refused', status: 502 }),
  ];
  for (const nibble of states) {
    const embed = buildGabiAnswer('do you have mistborn?', nibble, {
      link: 'unknown',
      panelUrl: PANEL,
    }).embeds[0] as { description: string };
    assert.ok(embed.description.includes(PANEL), `${nibble.kind} still offers the link`);
    assert.match(embed.description, /dig deeper and propose fixes on the site/);
  }
});

// ===========================================================================
// The question → a term the index can match
// ===========================================================================

test('searchTermFor strips the spoken scaffolding but keeps the subject', () => {
  assert.equal(searchTermFor('do you have anything by Brandon Sanderson?'), 'by Brandon Sanderson');
  assert.equal(searchTermFor('Does the estate have Dungeon Born?'), 'Dungeon Born');
  assert.equal(searchTermFor('  Mistborn  '), 'Mistborn');
});

test('searchTermFor never returns empty — an all-stopword question is searched as typed', () => {
  // Better a useless search than a silent no-op: the answer states the term it
  // used, so a bad reduction is visible rather than mysterious.
  assert.equal(searchTermFor('do you have any books?'), 'do you have any books');
  assert.equal(searchTermFor('   '), '');
});

// ── ⚠️ THE FORMAT WORD, and the live answer it cost ────────────────────────
//
// Measured 2026-09-02 in #gabi-test: *"do we have Jake's Magical Market on
// audio?"* → "Catalog's got nothing on that one yet." About a series with THREE
// volumes on the shelf.
//
// `on` was a stopword and `audio` was not, so the reduction was
// `Jake's Magical Market audio`, and the have lane sends the reduction to the
// index VERBATIM. Both halves measured live the same day, 17:54 UTC:
//
//   /api/search?q=Jake's Magical Market&source=audiobook        → 3 books
//   /api/search?q=Jake's Magical Market audio&source=audiobook  → 0 books

test("⚠️ THE LIVE MISS: a trailing format word is decoration, not a title", () => {
  assert.equal(searchTermFor("do we have Jake's Magical Market on audio?"), "Jake's Magical Market");
  assert.equal(searchTermFor('do we have Dungeon Born as an ebook'), 'Dungeon Born');
  assert.equal(searchTermFor('is Mistborn on audiobook'), 'Mistborn');
});

test('⚠️ only the TAIL — a LEADING strip was measured and rejected', () => {
  // It would have helped "is the audiobook of X any good" and it BROKE "The
  // Audio Vault Chronicles", because `The` is already a stopword, which makes
  // a title's own first word leading. Trading a measured miss for an
  // unmeasured one is not a fix. Same rule `searchCatalog`'s trailing
  // genre-word strip keeps, whose test is titled "only at the tail".
  assert.equal(searchTermFor('The Audio Vault Chronicles'), 'Audio Vault Chronicles');
  assert.equal(searchTermFor('is the audiobook of Dungeon Born any good'), 'audiobook Dungeon Born good');
});

test('⚠️ the strip NEVER empties the term — a book called Print is still findable', () => {
  // A term reduced to nothing is a search for everything, which is worse than
  // the decoration it was trying to remove.
  assert.equal(searchTermFor('do we have Print'), 'Print');
  assert.equal(searchTermFor('audiobook'), 'audiobook');
  assert.deepEqual(stripFormatWords(['audio']), ['audio']);
  assert.deepEqual(stripFormatWords(['audio', 'print']), ['audio']);
});

test('a format word in the MIDDLE is left alone — only the tail is decoration', () => {
  assert.equal(searchTermFor('The Audio Vault Chronicles are great'), 'Audio Vault Chronicles great');
});

// ===========================================================================
// The words — the two inherited wording rules, and the one new one
// ===========================================================================

test('a no-match NEVER says "you don\'t own it" — it says the catalogue does not have it', () => {
  const embed = buildGabiAnswer('anything by Sanderson?', nibbleFrom('by Sanderson', { ok: true, answer: { books: [] } }), {
    link: 'not_linked',
    panelUrl: PANEL,
  }).embeds[0] as { description: string };
  assert.match(embed.description, /catalogue/i);
  assert.match(embed.description, /scanned/i);
  for (const forbidden of [/you do ?n[o']t own/i, /don't have it/i, /not owned/i]) {
    assert.ok(!forbidden.test(embed.description), String(forbidden));
  }
});

test('an outage is a SERVICE problem, never an answer about the book', () => {
  for (const msg of [GABI_MSG.unreachable, GABI_MSG.refused(502)]) {
    assert.match(msg, /service problem/i);
    assert.match(msg, /NOT an answer about the book/);
  }
});

test('the answer NEVER promises the panel will open — it names what it cannot see', () => {
  for (const state of ['linked', 'not_linked', 'unknown'] as const) {
    const note = GABI_MSG.identity(state);
    // Design §10.2 blocker 1: the link lives in Firestore, the roles live in
    // the library's own database, and this bot has no path between them.
    assert.match(note, /runResearch/);
    assert.match(note, /cannot see|no path between them/);
    assert.ok(!/you (can|will be able to) open the panel/i.test(note), state);
  }
});

// ===========================================================================
// Linked, unlinked, and the third state that stops a false nudge
// ===========================================================================

test('an UNLINKED caller gets the /link nudge; a LINKED one is not told to link again', () => {
  const unlinked = GABI_MSG.identity('not_linked');
  assert.match(unlinked, /`\/link`/);
  assert.match(unlinked, /opt-in, revocable/);

  const linked = GABI_MSG.identity('linked');
  assert.match(linked, /linked to an estate identity/);
  assert.ok(!/`\/link` connects them/.test(linked), 'a linked person is not nudged to link');
});

test('⚠️ a FAILED link read says nothing about linking — it is not evidence of "unlinked"', () => {
  // The whole reason this does not reuse /have's boolean isLinked(): there,
  // a failure changes a scope footnote; here it would tell an already-linked
  // person to run /link. An unperformed read is not a negative answer.
  const unknown = GABI_MSG.identity('unknown');
  assert.ok(!/`\/link`/.test(unknown));
  assert.ok(!/not linked/i.test(unknown));
  assert.match(unknown, /runResearch/);
});

test('readLinkState: no user, no service account, and a broken one all answer "unknown"', async () => {
  assert.equal(await readLinkState(undefined, null), 'unknown');
  assert.equal(await readLinkState(undefined, 'u1'), 'unknown');
  assert.equal(await readLinkState('{not json', 'u1'), 'unknown');
});

// ===========================================================================
// The nibble
// ===========================================================================

test('a match is rendered with title, creator and a link, beside the term searched', () => {
  const embed = buildGabiAnswer('the mistborn one', nibbleFrom('mistborn one', { ok: true, answer: ANSWER }), {
    link: 'linked',
    panelUrl: PANEL,
  }).embeds[0] as { title: string; description: string };
  assert.match(embed.description, /\*\*Mistborn: The Final Empire\*\*/);
  assert.match(embed.description, /Brandon Sanderson/);
  // The term actually searched is stated, so a bad reduction is visible.
  assert.match(embed.description, /Looked on the estate's public shelf for \*\*mistborn one\*\*/);
  // The question is quoted back, because the link cannot carry it.
  assert.match(embed.description, /> the mistborn one/);
  assert.match(embed.title, /GABI/);
});

test('more matches than fit are COUNTED and stated, never silently dropped', () => {
  const many = Array.from({ length: MAX_GABI_HITS + 3 }, (_, i) => ({
    title: `Book ${i}`,
    creator: 'Someone',
    entries: [{ format: 'audiobook', detail_url: 'https://audiobooks.heygabi.ai/#x' }],
  }));
  const embed = buildGabiAnswer('book', nibbleFrom('book', { ok: true, answer: { books: many } }), {
    link: 'unknown',
    panelUrl: PANEL,
  }).embeds[0] as { description: string };
  assert.match(embed.description, new RegExp(`Showing the closest ${MAX_GABI_HITS} of ${many.length}`));
});

// ===========================================================================
// The flow — and the promise that gives shape (b) its whole justification
// ===========================================================================

test('⚠️ processGabi WRITES NOTHING and calls NO model — every request is accounted for', async () => {
  const stub = stubFetch((url) => (url.includes('/api/search') ? json(ANSWER) : json({ id: 'm1' })));
  try {
    await processGabi({
      question: 'do you have anything by Brandon Sanderson?',
      applicationId: 'app-1',
      interactionToken: 'tok-1',
      indexBaseUrl: 'https://index.test',
      panelUrl: PANEL,
      serviceAccountJson: undefined,
      discordUserId: 'u1',
    });

    // Exactly two things happen: a GET to the index, and the edit of the
    // deferred ephemeral. Nothing else, from anywhere.
    assert.equal(stub.calls.length, 2);
    const search = stub.calls.find((c) => c.url.includes('/api/search'))!;
    const edit = stub.calls.find((c) => c.url.includes('/messages/@original'))!;
    assert.ok(search && edit);
    assert.ok(!search.init?.method || search.init.method === 'GET', 'the index is only READ');
    assert.equal(edit.init?.method, 'PATCH');

    // No model call, ever — this Worker holds no Anthropic key and adds none.
    assert.ok(!stub.calls.some((c) => /anthropic|claude/i.test(c.url)), 'no model call');
    // No Firestore write: the only Firestore access this command can make is a
    // GET of the caller's own link doc, and none happened here at all.
    assert.ok(!stub.calls.some((c) => /firestore|googleapis/i.test(c.url)), 'no Firestore write');
    // The index call still carries no credential — /have's scope decision,
    // inherited unchanged because this reuses lookupHave rather than copying it.
    const headers = new Headers((search.init?.headers ?? {}) as HeadersInit);
    assert.equal(headers.get('authorization'), null);

    const body = JSON.parse(String(edit.init?.body)) as { embeds: Array<{ description: string }> };
    assert.match(body.embeds[0]!.description, /Mistborn/);
    assert.ok(body.embeds[0]!.description.includes(PANEL));
  } finally {
    stub.restore();
  }
});

test('processGabi: a one-word question is refused in words WITHOUT asking the index', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/api/search')) throw new Error('the index must not be called');
    return json({ id: 'm1' });
  });
  try {
    await processGabi({
      question: 'hi',
      applicationId: 'app-1',
      interactionToken: 'tok-1',
      indexBaseUrl: 'https://index.test',
      panelUrl: PANEL,
      discordUserId: null,
    });
    const edit = stub.calls.find((c) => c.url.includes('/messages/@original'))!;
    assert.ok(edit);
    assert.equal(JSON.parse(String(edit.init?.body)).content, GABI_MSG.tooShort);
  } finally {
    stub.restore();
  }
});

test('processGabi: an index outage still answers, and still hands over the link', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/api/search')) return new Response('', { status: 503 });
    return json({ id: 'm1' });
  });
  try {
    await processGabi({
      question: 'is the Sanderson cover wrong?',
      applicationId: 'app-1',
      interactionToken: 'tok-1',
      indexBaseUrl: 'https://index.test',
      panelUrl: PANEL,
      discordUserId: null,
    });
    const edit = stub.calls.find((c) => c.url.includes('/messages/@original'))!;
    const body = JSON.parse(String(edit.init?.body)) as { embeds: Array<{ description: string }> };
    assert.match(body.embeds[0]!.description, /service problem/i);
    assert.ok(body.embeds[0]!.description.includes(PANEL));
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// Registration and routing
// ===========================================================================

test('the registry publishes /gabi with a question option, and the router recognises it', () => {
  const entry = BASE_COMMANDS.find((cmd) => cmd.name === GABI_COMMAND_NAME) as
    | { options?: Array<{ name: string; required?: boolean }> }
    | undefined;
  assert.ok(entry, '/gabi is in the always-published registry');
  assert.equal(entry!.options?.[0]?.name, 'question');
  assert.equal(entry!.options?.[0]?.required, true);

  const decision = routeInteraction({
    type: 2,
    token: 't',
    application_id: 'app',
    data: { name: GABI_COMMAND_NAME, options: [{ name: 'question', type: 3, value: 'fix the cover' }] },
    member: { user: { id: 'u1' } },
  });
  assert.equal(decision.kind, 'gabi_command');
  if (decision.kind !== 'gabi_command') return;
  assert.equal(decision.question, 'fix the cover');
  assert.equal(decision.actor.user?.id, 'u1');
});

test('a signed /gabi interaction answers with a DEFERRED EPHEMERAL ack inside the 3s window', async () => {
  const stub = stubFetch(() => json(ANSWER));
  try {
    const res = await signedPost({
      type: 2,
      token: 'tok',
      application_id: 'app',
      data: { name: GABI_COMMAND_NAME, options: [{ name: 'question', type: 3, value: 'anything by Sanderson?' }] },
      member: { user: { id: 'u1' } },
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { type: number; data: { flags: number } };
    assert.equal(data.type, 5); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    assert.equal(data.data.flags, EPHEMERAL);
  } finally {
    stub.restore();
  }
});

test('/api/health reports the SHAPE and the panel URL, so a misconfigured link is one curl away', async () => {
  const { app } = await import('../src/index.js');
  const res = await app.request('https://discord.heygabi.ai/api/health', {}, {});
  const body = (await res.json()) as { gabi_surface: string; gabi_panel_url: string; features: string[] };
  assert.equal(body.gabi_surface, 'propose_and_deep_link');
  assert.equal(body.gabi_panel_url, PANEL);
  assert.ok(body.features.includes('gabi_command'));
});
