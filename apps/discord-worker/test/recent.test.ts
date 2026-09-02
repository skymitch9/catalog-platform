/**
 * `/recent` — the source, the sort, the rails, and the full request shape.
 *
 * The two tests that matter most:
 *  - `loadAdditions sends NO Authorization header` — that absence IS the scope
 *    decision (design §4 decision 4), and it is exactly the kind of thing a
 *    well-meaning refactor "fixes" by adding a credential.
 *  - `an out-of-range count is REFUSED, never clamped` — the repo's rule is
 *    reject-never-strip, and a silently clamped number answers a question
 *    nobody asked.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADDITIONS_PATH,
  additionsUrl,
  buildRecentAnswer,
  loadAdditions,
  MAX_ADDITIONS_BYTES,
  newestFirst,
  parseAdditions,
  processRecent,
  RECENT_DEFAULT,
  RECENT_MAX,
  RECENT_MSG,
  renderAddition,
} from '../src/recent.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, RECENT_COMMAND_NAME, routeInteraction } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response): {
  calls: Call[];
  restore: () => void;
} {
  const real = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}

const LOG = {
  entries: [
    { key: 'B|Someone', title: 'Newest Book', author: 'Someone', added: '2026-09-01', source: 'pipeline' },
    { key: 'A|Another', title: 'Older Book', author: 'Another', added: '2026-08-25', source: 'pipeline' },
    { key: 'C|Third', title: 'Middle Book', author: 'Third', added: '2026-08-27', source: 'pipeline' },
  ],
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

test('the log is read from the audiobook site, beside catalog.csv', () => {
  assert.equal(ADDITIONS_PATH, '/additions_log.json');
  assert.equal(
    additionsUrl('https://audiobooks.heygabi.ai'),
    'https://audiobooks.heygabi.ai/additions_log.json',
  );
});

test('⚠️ loadAdditions sends NO Authorization header — that absence IS the scope decision', async () => {
  const stub = stubFetch(() => json(LOG));
  try {
    await loadAdditions('https://example.invalid');
    const headers = (stub.calls[0]?.init?.headers ?? {}) as Record<string, string>;
    assert.equal(Object.keys(headers).some((k) => k.toLowerCase() === 'authorization'), false);
  } finally {
    stub.restore();
  }
});

test('parseAdditions keeps title/author/added and DROPS a row with no title', () => {
  const rows = parseAdditions({
    entries: [
      { title: 'Kept', author: 'A', added: '2026-01-01' },
      { title: '   ', author: 'B', added: '2026-01-02' },
      { author: 'C', added: '2026-01-03' },
      'not an object',
    ],
  });
  assert.deepEqual(rows, [{ title: 'Kept', author: 'A', added: '2026-01-01' }]);
});

test('a body that is not the expected shape yields no rows rather than throwing', () => {
  assert.deepEqual(parseAdditions(null), []);
  assert.deepEqual(parseAdditions({ entries: 'nope' }), []);
  assert.deepEqual(parseAdditions([]), []);
});

// ---------------------------------------------------------------------------
// The sort — the file's own order is NOT trusted
// ---------------------------------------------------------------------------

test('⚠️ rows are sorted newest-first HERE, never trusted from the file', () => {
  const rows = parseAdditions(LOG);
  assert.deepEqual(
    newestFirst(rows, 3).map((r) => r.title),
    ['Newest Book', 'Middle Book', 'Older Book'],
  );
});

test('⚠️ an undated row sorts to the BOTTOM, never presented as the newest thing', () => {
  const rows = parseAdditions({
    entries: [
      { title: 'Undated', author: '', added: '' },
      { title: 'Odd spelling', author: '', added: 'last tuesday' },
      { title: 'Real', author: '', added: '2026-08-01' },
    ],
  });
  assert.equal(newestFirst(rows, 3)[0]?.title, 'Real');
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test('an empty log is a statement about the LOG, never about the house', () => {
  const answer = buildRecentAnswer([], RECENT_DEFAULT) as { embeds: { description: string }[] };
  assert.match(answer.embeds[0]!.description, /statement about the \*\*log\*\*/);
  assert.doesNotMatch(answer.embeds[0]!.description, /do(es)? not own|no books/i);
});

test('an undated row says so rather than borrowing the date above it', () => {
  assert.match(renderAddition({ title: 'X', author: '', added: '' }), /date not recorded/);
  assert.match(renderAddition({ title: 'X', author: 'Y', added: '2026-01-01' }), /2026-01-01/);
});

test('the answer states how many of how many, and which shelf it counted', () => {
  const answer = buildRecentAnswer(parseAdditions(LOG), 2) as { embeds: { description: string }[] };
  assert.match(answer.embeds[0]!.description, /2 newest of 3/);
  assert.match(answer.embeds[0]!.description, /audiobooks\.heygabi\.ai/);
});

// ---------------------------------------------------------------------------
// The rails
// ---------------------------------------------------------------------------

test('⚠️ an out-of-range count is REFUSED, never clamped', async () => {
  const said: unknown[] = [];
  const stub = stubFetch((url) => {
    if (url.includes('/webhooks/')) {
      return json({ ok: true });
    }
    throw new Error('the log must not be read when the input is invalid');
  });
  try {
    for (const bad of [0, -1, RECENT_MAX + 1, 2.5]) {
      const before = stub.calls.length;
      await processRecent({
        count: bad,
        applicationId: 'app',
        interactionToken: 'tok',
        catalogBaseUrl: 'https://example.invalid',
      });
      const body = JSON.parse(String(stub.calls[before]?.init?.body ?? '{}')) as { content?: string };
      said.push(body.content);
      assert.equal(body.content, RECENT_MSG.badCount(RECENT_MAX));
    }
  } finally {
    stub.restore();
  }
  assert.equal(said.length, 4);
});

test('an oversized body is refused rather than parsed', async () => {
  const stub = stubFetch(
    () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json', 'content-length': String(MAX_ADDITIONS_BYTES + 1) },
      }),
  );
  try {
    const load = await loadAdditions('https://example.invalid');
    assert.equal(load.ok, false);
    assert.equal(load.ok === false && load.reason, 'too_big');
  } finally {
    stub.restore();
  }
});

test('an outage is worded as an outage, never as an answer about the shelves', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/webhooks/')) return json({ ok: true });
    return new Response('nope', { status: 503 });
  });
  try {
    await processRecent({
      count: undefined,
      applicationId: 'app',
      interactionToken: 'tok',
      catalogBaseUrl: 'https://example.invalid',
    });
    const body = JSON.parse(String(stub.calls.at(-1)?.init?.body ?? '{}')) as { content?: string };
    assert.equal(body.content, RECENT_MSG.refused(503));
    assert.match(body.content!, /service problem/);
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// The registry and the router
// ---------------------------------------------------------------------------

test('/recent is registered with Discord’s own range rail on `count`', () => {
  const cmd = BASE_COMMANDS.find((c) => c.name === RECENT_COMMAND_NAME) as
    | { options?: { name: string; min_value?: number; max_value?: number; required?: boolean }[] }
    | undefined;
  assert.ok(cmd, '/recent must be in BASE_COMMANDS');
  const count = cmd!.options?.find((o) => o.name === 'count');
  assert.equal(count?.required, false);
  assert.equal(count?.min_value, 1);
  assert.equal(count?.max_value, RECENT_MAX);
});

test('the router carries the count through, and tolerates its absence', () => {
  const withCount = routeInteraction({
    type: 2,
    data: { name: RECENT_COMMAND_NAME, options: [{ name: 'count', type: 4, value: 5 }] },
  });
  assert.equal(withCount.kind, 'recent_command');
  assert.equal(withCount.kind === 'recent_command' && withCount.count, 5);
  const bare = routeInteraction({ type: 2, data: { name: RECENT_COMMAND_NAME } });
  assert.equal(bare.kind === 'recent_command' && bare.count, undefined);
});

test('the full request defers PRIVATELY — a shelf browse is not channel spam', async () => {
  const res = await signedPost({
    type: 2,
    token: 'tok',
    application_id: 'app',
    data: { name: RECENT_COMMAND_NAME },
    member: { user: { id: 'u1' } },
  });
  const data = (await res.json()) as { type: number; data: { flags?: number } };
  assert.equal(data.type, 5);
  assert.equal(data.data.flags, EPHEMERAL);
});

test('no interaction token → a worded ephemeral, never a spinner that never resolves', async () => {
  const res = await signedPost({ type: 2, data: { name: RECENT_COMMAND_NAME } });
  const data = (await res.json()) as { type: number; data: { content: string; flags: number } };
  assert.equal(data.type, 4);
  assert.equal(data.data.flags, EPHEMERAL);
  assert.match(data.data.content, /no way to reply/);
});
