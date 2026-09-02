/**
 * `/suggest` — the slash surface over the already-built suggestion lane.
 *
 * The tests that matter most, and each is a rule from
 * `gabi-suggestions-design.md` rather than a preference:
 *  - `the gate is asked BEFORE anything is gathered` (§3) — somebody who may
 *    not be suggested a physical book must not have their reading list read in
 *    order to be told so;
 *  - `a MOOD can never open a shelf` (§10f) — the mood improves the picks and
 *    is never consulted by the format gate;
 *  - `an unstated format answers from the PUBLIC shelf and says so` (§10f's
 *    third finding) — one refining question is welcome after a real answer,
 *    never instead of one;
 *  - `no model is called` — this surface renders the composer's own `why`
 *    clauses, so it is not a new money path.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSuggestAnswer,
  isSuggestFormat,
  processSuggestCommand,
  renderCandidate,
  SUGGEST_CMD_MSG,
  SUGGEST_FORMAT_CHOICES,
} from '../src/suggest-command.js';
import { SUGGEST_MSG, type SuggestCandidate } from '../src/suggest.js';
import { resetCatalogCache } from '../src/catalog-data.js';
import type { ShelfPort } from '../src/shelf.js';
import type { BooksPort } from '../src/book-knowledge.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, routeInteraction, SUGGEST_COMMAND_NAME } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

const CSV = [
  'title,series,series_index_display,series_index_sort,author,narrator,year,genre,duration_hhmm,library_formats,universe,series_gap',
  'The Way of Kings,The Stormlight Archive,1,1,Brandon Sanderson,Kate Reading,2010,Fantasy,45:30,,The Cosmere,',
  'Words of Radiance,The Stormlight Archive,2,2,Brandon Sanderson,Kate Reading,2014,Fantasy,48:00,,The Cosmere,',
  'Mistborn,The Mistborn Saga,1,1,Brandon Sanderson,Michael Kramer,2006,Fantasy,24:00,,The Cosmere,',
].join('\n');

interface Sent {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string) => Response): { sent: Sent[]; restore: () => void } {
  const real = globalThis.fetch;
  const sent: Sent[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init });
    return handler(String(input));
  }) as typeof fetch;
  return { sent, restore: () => { globalThis.fetch = real; } };
}

const catalogStub = () =>
  stubFetch((url) => {
    if (url.includes('/webhooks/')) return new Response('{}', { status: 200 });
    if (url.includes('catalog.csv')) {
      return new Response(CSV, { status: 200, headers: { 'content-type': 'text/csv' } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });

const lastSaid = (sent: Sent[]): { content?: string; embeds?: { description: string }[] } =>
  JSON.parse(String(sent.at(-1)?.init?.body ?? '{}'));

/** A shelf port that answers "not linked" — the ordinary state for a stranger,
 * and NOT an error for an audio suggestion. */
const unlinkedShelf: ShelfPort = {
  asker: async () => ({ ok: false, reason: 'unlinked' }),
  myTbr: async () => ({ ok: true, rows: [], total: 0 }),
  myReviews: async () => ({ ok: true, rows: [], total: 0, allBookIds: [] }),
  bookReviews: async () => ({ ok: true, rows: [], total: 0, allBookIds: [] }),
};

const base = {
  applicationId: 'app',
  interactionToken: 'tok',
  catalogBaseUrl: 'https://audiobooks.example',
  discordUserId: 'u1',
  suggestOn: true,
  shelf: unlinkedShelf,
  books: null,
  delegated: null,
};

// ---------------------------------------------------------------------------
// The format option IS the permission model
// ---------------------------------------------------------------------------

test('the three choice values are the SAME three strings SuggestFormat uses', () => {
  assert.deepEqual([...SUGGEST_FORMAT_CHOICES], ['audio', 'ebook', 'physical']);
  for (const v of SUGGEST_FORMAT_CHOICES) assert.equal(isSuggestFormat(v), true);
  assert.equal(isSuggestFormat('paperback'), false);
});

test('⚠️ a format Discord never offered is REFUSED, never coerced to audio', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/webhooks/')) return new Response('{}', { status: 200 });
    throw new Error('nothing should be fetched for an invalid format');
  });
  try {
    await processSuggestCommand({ ...base, format: 'hardback', mood: '' });
    assert.equal(lastSaid(stub.sent).content, SUGGEST_CMD_MSG.badFormat('hardback'));
  } finally {
    stub.restore();
  }
});

test('⚠️ an unstated format answers from the PUBLIC shelf and SAYS so — a question never replaces an answer', async () => {
  resetCatalogCache();
  const stub = catalogStub();
  try {
    await processSuggestCommand({ ...base, format: '', mood: '' });
    const said = lastSaid(stub.sent);
    assert.ok(said.embeds, 'it must answer with picks, not with a question');
    assert.match(said.embeds![0]!.description, /audiobook/);
    assert.match(said.embeds![0]!.description, /Ask for `ebook` or `physical`/);
    // ⚠️ And it must NOT be the clarify sentence, which is the defect §10f names.
    assert.notEqual(said.content, SUGGEST_MSG.clarify);
  } finally {
    stub.restore();
    resetCatalogCache();
  }
});

// ---------------------------------------------------------------------------
// ⚠️ The gate, before the gathering (§3)
// ---------------------------------------------------------------------------

test('⚠️ an EBOOK ask with no books port is a SETUP gap, and no shelf is read to discover it', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/webhooks/')) return new Response('{}', { status: 200 });
    throw new Error('the gate must refuse before anything is gathered');
  });
  const shelf: ShelfPort = {
    ...unlinkedShelf,
    asker: async () => {
      throw new Error('⚠️ the asker’s shelf must NOT be read in order to refuse them');
    },
  };
  try {
    await processSuggestCommand({ ...base, shelf, format: 'ebook', mood: '' });
    assert.equal(lastSaid(stub.sent).content, SUGGEST_MSG.notConfigured);
  } finally {
    stub.restore();
  }
});

test('⚠️ the estate’s OWN 403 sentence is relayed, and a 500 is an OUTAGE rather than a refusal', async () => {
  for (const [probe, expected] of [
    [{ ok: false as const, status: 403, message: 'The household has not opened the ebooks to you.' }, 'The household has not opened the ebooks to you.'],
    [{ ok: false as const, status: 500 }, SUGGEST_MSG.estateUnreachable],
  ] as const) {
    const stub = stubFetch((url) =>
      url.includes('/webhooks/') ? new Response('{}', { status: 200 }) : (() => {
        throw new Error('no gathering before the gate');
      })(),
    );
    const books = {
      askerEmail: async () => ({ ok: true as const, email: 'a@example.com' }),
      available: async () => probe,
    } as unknown as BooksPort;
    try {
      await processSuggestCommand({ ...base, books, format: 'ebook', mood: '' });
      assert.equal(lastSaid(stub.sent).content, expected);
    } finally {
      stub.restore();
    }
  }
});

// ---------------------------------------------------------------------------
// ⚠️ A mood improves the PICKS and can never open a shelf (§10f)
// ---------------------------------------------------------------------------

test('⚠️ a mood naming a physical book does NOT reach the physical gate', async () => {
  resetCatalogCache();
  const stub = catalogStub();
  try {
    await processSuggestCommand({
      ...base,
      format: '',
      mood: 'a physical hardcover paperback to take on a plane',
    });
    const said = lastSaid(stub.sent);
    // It answered from the AUDIO shelf: the mood never became a format.
    assert.ok(said.embeds);
    assert.match(said.embeds![0]!.description, /audiobook/);
    assert.notEqual(said.content, SUGGEST_MSG.physicalNotConfigured);
  } finally {
    stub.restore();
    resetCatalogCache();
  }
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

const candidate = (over: Partial<SuggestCandidate> = {}): SuggestCandidate => ({
  title: 'Words of Radiance',
  author: 'Brandon Sanderson',
  bookId: 'words-of-radiance',
  shelf: 'the audiobook shelf',
  why: 'you gave The Way of Kings 5 stars and this is the next one',
  basis: 'series_next',
  ...over,
});

test('⚠️ the composer’s OWN why clause is rendered, never re-worded', () => {
  const line = renderCandidate(candidate());
  assert.match(line, /you gave The Way of Kings 5 stars and this is the next one/);
});

test('a failed shelf read CHANGES the answer rather than cancelling it, and says so', () => {
  const answer = buildSuggestAnswer([candidate()], 'audio', {
    shelfUnavailable: true,
    assumedAudio: false,
    mood: [],
  }) as { embeds: { description: string }[] };
  assert.match(answer.embeds[0]!.description, /not\*\* built on your ratings/);
  assert.match(answer.embeds[0]!.description, /wobble on our side, not an empty shelf/);
});

test('the answer points at where her VOICE lives, since this surface is deliberately flat', () => {
  const answer = buildSuggestAnswer([candidate()], 'audio', {
    shelfUnavailable: false,
    assumedAudio: false,
    mood: [],
  }) as { embeds: { description: string }[] };
  assert.match(answer.embeds[0]!.description, /@mention GABI/);
});

test('a switched-off lane says it is a LEVER, not a permission', async () => {
  const stub = stubFetch((url) =>
    url.includes('/webhooks/') ? new Response('{}', { status: 200 }) : (() => {
      throw new Error('nothing should be fetched while the lane is off');
    })(),
  );
  try {
    await processSuggestCommand({ ...base, suggestOn: false, format: '', mood: '' });
    assert.equal(lastSaid(stub.sent).content, SUGGEST_MSG.switchedOff);
    assert.match(SUGGEST_MSG.switchedOff, /lever on our side/);
  } finally {
    stub.restore();
  }
});

test('⚠️ no catalogue means no suggestion, worded as OUR outage', async () => {
  resetCatalogCache();
  const stub = stubFetch((url) =>
    url.includes('/webhooks/') ? new Response('{}', { status: 200 }) : new Response('down', { status: 503 }),
  );
  try {
    await processSuggestCommand({ ...base, format: '', mood: '' });
    assert.equal(lastSaid(stub.sent).content, SUGGEST_MSG.estateUnreachable);
  } finally {
    stub.restore();
    resetCatalogCache();
  }
});

// ---------------------------------------------------------------------------
// ⚠️ It spends nothing
// ---------------------------------------------------------------------------

test('⚠️ no model is called — /suggest is not a new row in the billing inventory', async () => {
  resetCatalogCache();
  const stub = catalogStub();
  try {
    await processSuggestCommand({ ...base, format: '', mood: 'something short' });
    for (const s of stub.sent) {
      assert.equal(/anthropic|groq|openai/i.test(s.url), false, `no model call: ${s.url}`);
    }
  } finally {
    stub.restore();
    resetCatalogCache();
  }
});

// ---------------------------------------------------------------------------
// The registry and the router
// ---------------------------------------------------------------------------

test('/suggest is registered with CHOICES on format — an explicit word, which is the gate’s rule', () => {
  const cmd = BASE_COMMANDS.find((c) => c.name === SUGGEST_COMMAND_NAME) as
    | { options?: { name: string; required?: boolean; choices?: { value: string }[] }[] }
    | undefined;
  assert.ok(cmd);
  const format = cmd!.options?.find((o) => o.name === 'format');
  assert.equal(format?.required, false);
  assert.deepEqual(format?.choices?.map((ch) => ch.value), [...SUGGEST_FORMAT_CHOICES]);
});

test('the router carries format and mood, and tolerates both being absent', () => {
  const full = routeInteraction({
    type: 2,
    data: {
      name: SUGGEST_COMMAND_NAME,
      options: [
        { name: 'format', type: 3, value: 'ebook' },
        { name: 'mood', type: 3, value: 'funny' },
      ],
    },
  });
  assert.equal(full.kind === 'suggest_command' && full.format, 'ebook');
  assert.equal(full.kind === 'suggest_command' && full.mood, 'funny');
  const bare = routeInteraction({ type: 2, data: { name: SUGGEST_COMMAND_NAME } });
  assert.equal(bare.kind === 'suggest_command' && bare.format, '');
});

test('the full request defers privately', async () => {
  const res = await signedPost({
    type: 2,
    token: 'tok',
    application_id: 'app',
    data: { name: SUGGEST_COMMAND_NAME },
    member: { user: { id: 'u1' } },
  });
  const data = (await res.json()) as { type: number; data: { flags?: number } };
  assert.equal(data.type, 5);
  assert.equal(data.data.flags, EPHEMERAL);
});
