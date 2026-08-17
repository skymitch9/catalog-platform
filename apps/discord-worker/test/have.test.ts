/**
 * `/have` — the scope default (design §4 decision 4), the wording rules, and
 * the full-request shape.
 *
 * The one test that matters most is `lookupHave sends NO Authorization
 * header`: that absence IS the privacy decision, and it is the kind of thing a
 * well-meaning refactor "fixes" by adding a credential.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildHaveAnswer,
  DEFAULT_INDEX_BASE,
  HAVE_MSG,
  HAVE_SOURCE,
  indexBase,
  lookupHave,
  MAX_HITS,
  processHave,
  renderHit,
  searchUrl,
} from '../src/have.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, HAVE_COMMAND_NAME, routeInteraction } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

// ---------------------------------------------------------------------------
// A fetch stand-in. Every test that would otherwise reach the network installs
// one; a test that forgets fails loudly rather than quietly hitting the live
// index.
// ---------------------------------------------------------------------------

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
  query: 'dungeon born',
  scope: ['audiobook'],
  books: [
    {
      title: 'Dungeon Born',
      creator: 'Dakota Krout',
      entries: [
        { source: 'audiobook', format: 'audiobook', detail_url: 'https://audiobooks.heygabi.ai/#q=Dungeon+Born' },
        { source: 'audiobook', format: 'ebook', detail_url: 'https://ebooks.heygabi.ai/#b-154d33f4af2c' },
      ],
    },
  ],
  games: [],
};

// ===========================================================================
// The scope — the whole design of this command
// ===========================================================================

test('searchUrl narrows to the audiobook source EXPLICITLY, and carries the query', () => {
  const url = new URL(searchUrl('https://index.heygabi.ai', 'dungeon born'));
  assert.equal(url.origin + url.pathname, 'https://index.heygabi.ai/api/search');
  assert.equal(url.searchParams.get('q'), 'dungeon born');
  // ⚠️ Not redundant: `source` can only NARROW (index search-route.ts), so if
  // the index's anonymous default ever widened, /have would not widen with it.
  assert.equal(url.searchParams.get('source'), HAVE_SOURCE);
  assert.equal(HAVE_SOURCE, 'audiobook');
});

test('lookupHave sends NO Authorization header — the absence IS the scope decision', async () => {
  const stub = stubFetch(() => json(ANSWER));
  try {
    const result = await lookupHave('https://index.heygabi.ai', 'dungeon born');
    assert.ok(result.ok);
    assert.equal(stub.calls.length, 1);
    const headers = new Headers((stub.calls[0]!.init?.headers ?? {}) as HeadersInit);
    assert.equal(headers.get('authorization'), null);
    assert.equal(headers.get('cookie'), null);
  } finally {
    stub.restore();
  }
});

test('indexBase: the live host by default, overridable by a var', () => {
  assert.equal(indexBase({}), DEFAULT_INDEX_BASE);
  assert.equal(indexBase({ INDEX_BASE_URL: '  ' }), DEFAULT_INDEX_BASE);
  assert.equal(indexBase({ INDEX_BASE_URL: 'https://example.test' }), 'https://example.test');
});

test('lookupHave: a 422 is the too-short answer, other failures are named, none throws', async () => {
  for (const [status, reason] of [
    [422, 'too_short'],
    [500, 'refused'],
    [404, 'refused'],
  ] as const) {
    const stub = stubFetch(() => new Response('', { status }));
    try {
      const result = await lookupHave('https://index.heygabi.ai', 'x');
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.reason, reason);
    } finally {
      stub.restore();
    }
  }
  const dead = stubFetch(() => { throw new Error('network down'); });
  try {
    const result = await lookupHave('https://index.heygabi.ai', 'x');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'unreachable');
  } finally {
    dead.restore();
  }
});

// ===========================================================================
// The words
// ===========================================================================

test('a no-match NEVER says "you don\'t own it" — it says the catalogue does not have it', () => {
  const payload = buildHaveAnswer('brandon sanderson', { books: [] }, { linked: false });
  const embed = payload.embeds[0] as { title: string; description: string };
  assert.match(embed.description, /Nothing in the estate's shelves matches/);
  // The catalogue-is-not-an-inventory caveat: ~100 books are unscanned at any
  // time, so absence means unscanned, never unowned.
  assert.match(embed.description, /catalogue/i);
  assert.match(embed.description, /scanned/i);
  for (const forbidden of [/you do ?n[o']t own/i, /don't have it/i, /not owned/i]) {
    assert.ok(!forbidden.test(embed.description), String(forbidden));
  }
});

test('a match lists title, creator, every format, and a detail link', () => {
  const line = renderHit(ANSWER.books[0]!);
  assert.match(line, /\*\*Dungeon Born\*\*/);
  assert.match(line, /Dakota Krout/);
  assert.match(line, /audiobook, ebook/);
  assert.match(line, /\[details\]\(https:\/\/audiobooks\.heygabi\.ai/);
});

test('more matches than fit are COUNTED and stated, never silently dropped', () => {
  const many = Array.from({ length: MAX_HITS + 4 }, (_, i) => ({
    title: `Book ${i}`,
    creator: 'Someone',
    entries: [{ format: 'audiobook', detail_url: 'https://audiobooks.heygabi.ai/#x' }],
  }));
  const embed = buildHaveAnswer('book', { books: many }, { linked: false }).embeds[0] as {
    description: string;
  };
  assert.match(embed.description, new RegExp(`Showing the closest ${MAX_HITS} of ${many.length}`));
});

test('the scope footnote is honest in both states, and the linked one names what it waits on', () => {
  const stranger = HAVE_MSG.scopeNote(false);
  const linked = HAVE_MSG.scopeNote(true);
  assert.match(stranger, /public audiobook shelf/);
  assert.match(linked, /public audiobook shelf/);
  // The measured reason wider scope is unavailable: the index only widens for
  // a Firebase sign-in, which Discord cannot produce.
  assert.match(linked, /Firebase/);
  assert.match(linked, /not a permission you are missing/);
  assert.ok(!/coming soon/i.test(linked));
});

test('every outage message says it is a SERVICE problem, not an answer about the book', () => {
  for (const msg of [HAVE_MSG.unreachable, HAVE_MSG.refused(502)]) {
    assert.match(msg, /service problem/i);
    assert.match(msg, /NOT an answer about the book/);
  }
});

// ===========================================================================
// The flow
// ===========================================================================

test('processHave: searches, then edits the deferred message with the answer', async () => {
  const stub = stubFetch((url) => (url.includes('/api/search') ? json(ANSWER) : json({ id: 'm1' })));
  try {
    await processHave({
      query: 'dungeon born',
      applicationId: 'app-1',
      interactionToken: 'tok-1',
      indexBaseUrl: 'https://index.test',
      // No service account: the link read is skipped, and the answer still
      // arrives — the linked/unlinked line must never cost someone their reply.
      serviceAccountJson: undefined,
      discordUserId: 'u1',
    });
    const search = stub.calls.find((c) => c.url.includes('/api/search'));
    const edit = stub.calls.find((c) => c.url.includes('/messages/@original'));
    assert.ok(search, 'the index was queried');
    assert.ok(edit, 'the deferred message was edited');
    assert.equal(edit!.init?.method, 'PATCH');
    const body = JSON.parse(String(edit!.init?.body)) as { embeds: Array<{ description: string }> };
    assert.match(body.embeds[0]!.description, /Dungeon Born/);
  } finally {
    stub.restore();
  }
});

test('processHave: a one-character query is refused in words WITHOUT asking the index', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/api/search')) throw new Error('the index must not be called');
    return json({ id: 'm1' });
  });
  try {
    await processHave({
      query: 'x',
      applicationId: 'app-1',
      interactionToken: 'tok-1',
      indexBaseUrl: 'https://index.test',
      discordUserId: null,
    });
    const edit = stub.calls.find((c) => c.url.includes('/messages/@original'));
    assert.ok(edit);
    assert.equal(JSON.parse(String(edit!.init?.body)).content, HAVE_MSG.tooShort);
  } finally {
    stub.restore();
  }
});

// ===========================================================================
// Registration and routing
// ===========================================================================

test('the registry publishes /have, and the router recognises it', () => {
  const entry = BASE_COMMANDS.find((cmd) => cmd.name === HAVE_COMMAND_NAME);
  assert.ok(entry, '/have is in the always-published registry');
  const decision = routeInteraction({
    type: 2,
    token: 't',
    application_id: 'app',
    data: { name: HAVE_COMMAND_NAME, options: [{ name: 'title', type: 3, value: 'dungeon' }] },
    member: { user: { id: 'u1' } },
  });
  assert.equal(decision.kind, 'have_command');
  if (decision.kind !== 'have_command') return;
  assert.equal(decision.query, 'dungeon');
  assert.equal(decision.actor.user?.id, 'u1');
});

test('a signed /have interaction answers with a DEFERRED EPHEMERAL ack inside the 3s window', async () => {
  const stub = stubFetch(() => json(ANSWER));
  try {
    const res = await signedPost({
      type: 2,
      token: 'tok',
      application_id: 'app',
      data: { name: HAVE_COMMAND_NAME, options: [{ name: 'title', type: 3, value: 'dungeon' }] },
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
