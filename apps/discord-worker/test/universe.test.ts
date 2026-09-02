/**
 * `/universe` — the coverage sentence, the canonical spelling, and the
 * "that is not a universe" answer.
 *
 * The test that matters most is `every answer says which shelf it counted`: a
 * reader who meets "The Cosmere — 21 works" and is not told it counted ONE
 * catalogue will reasonably assume it counted the house, and that is a wrong
 * answer wearing a number.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetCatalogCache, type CatalogRow } from '../src/catalog-data.js';
import {
  buildUniverseAnswer,
  processUniverse,
  renderUniverseLine,
  renderUniverseWork,
  UNIVERSE_MAX_WORKS,
  UNIVERSE_MSG,
  UNIVERSES_PAGE,
} from '../src/universe.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, routeInteraction, UNIVERSE_COMMAND_NAME } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

const row = (over: Partial<CatalogRow>): CatalogRow => ({
  title: 'A Title',
  author: 'An Author',
  narrator: '',
  year: '',
  genre: '',
  duration: '',
  series: '',
  seriesIndex: '',
  seriesSort: null,
  universe: '',
  libraryFormats: [],
  seriesGap: '',
  ...over,
});

const ROWS: CatalogRow[] = [
  row({ title: 'The Way of Kings', series: 'The Stormlight Archive', seriesIndex: '1', universe: 'The Cosmere', author: 'Brandon Sanderson', libraryFormats: ['Hardcover'] }),
  row({ title: 'Words of Radiance', series: 'The Stormlight Archive', seriesIndex: '2', universe: 'The Cosmere', author: 'Brandon Sanderson' }),
  row({ title: 'Mistborn', series: 'The Mistborn Saga', seriesIndex: '1', universe: 'The Cosmere', author: 'Brandon Sanderson' }),
  row({ title: 'Wild Wastes', universe: 'Runnerverse', author: 'Randi Darren' }),
  row({ title: 'No Universe Here', universe: '' }),
];

const describe = (answer: { embeds: unknown[] }): string =>
  (answer.embeds[0] as { description: string }).description;
const titleOf = (answer: { embeds: unknown[] }): string =>
  (answer.embeds[0] as { title: string }).title;

// ---------------------------------------------------------------------------
// The coverage sentence — it rides EVERY answer
// ---------------------------------------------------------------------------

test('⚠️ every answer says which shelf it counted, and names the cross-catalog page', () => {
  for (const asked of ['', 'The Cosmere', 'Wheel of Time']) {
    const d = describe(buildUniverseAnswer(ROWS, asked));
    assert.match(d, /audiobook/i, `"${asked}" must name the shelf it counted`);
    assert.ok(d.includes(UNIVERSES_PAGE), `"${asked}" must name ${UNIVERSES_PAGE}`);
  }
});

// ---------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------

test('a bare /universe lists what the shelf actually files under, biggest first', () => {
  const answer = buildUniverseAnswer(ROWS, '');
  const d = describe(answer);
  assert.match(d, /\*\*The Cosmere\*\* — 3 works/);
  assert.match(d, /\*\*Runnerverse\*\* — 1 work/);
  // ⚠️ A book with no universe is not a book that is missing one, and it is
  // NOT invented into a "(none)" bucket in the listing.
  assert.doesNotMatch(d, /\(none\)/);
  assert.equal(d.indexOf('The Cosmere') < d.indexOf('Runnerverse'), true);
});

test('one work is singular — a count that says "1 works" reads as a bug', () => {
  assert.match(renderUniverseLine({ universe: 'X', count: 1 }), /1 work$/);
  assert.match(renderUniverseLine({ universe: 'X', count: 2 }), /2 works$/);
});

// ---------------------------------------------------------------------------
// A named universe
// ---------------------------------------------------------------------------

test('the CATALOGUE’s own spelling is the title, never the caller’s typing', () => {
  const answer = buildUniverseAnswer(ROWS, 'cosmere');
  assert.equal(titleOf(answer), 'The Cosmere');
});

test('the facts line carries works, series and authors — and labels the print figure honestly', () => {
  const d = describe(buildUniverseAnswer(ROWS, 'The Cosmere'));
  assert.match(d, /3 works · 2 series · 1 author\b/);
  assert.match(d, /1 also matched to a print or ebook edition/);
});

test('a work line carries the series and volume, which is the question asked next', () => {
  assert.match(
    renderUniverseWork(ROWS[0] as CatalogRow),
    /\*\*The Way of Kings\*\* — Brandon Sanderson · _The Stormlight Archive #1_/,
  );
});

test('the overflow is COUNTED and stated, never dropped silently', () => {
  const many = Array.from({ length: UNIVERSE_MAX_WORKS + 4 }, (_, i) =>
    row({ title: `Book ${i}`, universe: 'Big' }),
  );
  const d = describe(buildUniverseAnswer(many, 'Big'));
  assert.match(d, new RegExp(`Showing ${UNIVERSE_MAX_WORKS} of ${UNIVERSE_MAX_WORKS + 4}`));
});

// ---------------------------------------------------------------------------
// ⚠️ "Not a universe the estate records" — not "0 matches"
// ---------------------------------------------------------------------------

test('⚠️ an unknown name is answered as a NAME the list does not carry, not as a count of zero', () => {
  const d = describe(buildUniverseAnswer(ROWS, 'Wheel of Time'));
  assert.match(d, /is not one of the universes the estate records/);
  assert.match(d, /not a count of zero/);
  // …and the real ones are offered, so the next attempt succeeds.
  assert.match(d, /The Cosmere/);
});

test('an empty shelf says so about the AUDIOBOOK catalogue, not about the estate', () => {
  const d = describe(buildUniverseAnswer([row({ universe: '' })], ''));
  assert.equal(d.startsWith(UNIVERSE_MSG.emptyList.slice(0, 40)), true);
  assert.match(d, /print and board-game catalogues keep their own/);
});

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

test('a catalogue outage is worded as an outage, never as "no universes"', async () => {
  resetCatalogCache();
  const real = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/webhooks/')) {
      sent.push(String(init?.body ?? ''));
      return new Response('{}', { status: 200 });
    }
    return new Response('down', { status: 503 });
  }) as typeof fetch;
  try {
    await processUniverse({
      name: 'The Cosmere',
      applicationId: 'app',
      interactionToken: 'tok',
      catalogBaseUrl: 'https://example.invalid',
    });
    const body = JSON.parse(sent.at(-1) ?? '{}') as { content?: string };
    assert.equal(body.content, UNIVERSE_MSG.unreachable);
    assert.match(body.content!, /service problem/);
  } finally {
    globalThis.fetch = real;
    resetCatalogCache();
  }
});

// ---------------------------------------------------------------------------
// The registry and the router
// ---------------------------------------------------------------------------

test('/universe is registered with an OPTIONAL name — the bare form is a real question', () => {
  const cmd = BASE_COMMANDS.find((c) => c.name === UNIVERSE_COMMAND_NAME) as
    | { options?: { name: string; required?: boolean }[] }
    | undefined;
  assert.ok(cmd);
  assert.equal(cmd!.options?.find((o) => o.name === 'name')?.required, false);
});

test('the router carries the name, and an absent one becomes the empty string', () => {
  const named = routeInteraction({
    type: 2,
    data: { name: UNIVERSE_COMMAND_NAME, options: [{ name: 'name', type: 3, value: 'Runnerverse' }] },
  });
  assert.equal(named.kind === 'universe_command' && named.name, 'Runnerverse');
  const bare = routeInteraction({ type: 2, data: { name: UNIVERSE_COMMAND_NAME } });
  assert.equal(bare.kind === 'universe_command' && bare.name, '');
});

test('the full request defers privately', async () => {
  const res = await signedPost({
    type: 2,
    token: 'tok',
    application_id: 'app',
    data: { name: UNIVERSE_COMMAND_NAME },
    member: { user: { id: 'u1' } },
  });
  const data = (await res.json()) as { type: number; data: { flags?: number } };
  assert.equal(data.type, 5);
  assert.equal(data.data.flags, EPHEMERAL);
});
