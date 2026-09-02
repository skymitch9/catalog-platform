/**
 * PHASE 3 — bot-posted poll messages: the sync tick's orchestration rules and
 * the route's gate.
 *
 * What these tests are actually protecting, in order of how expensive the bug
 * would be if it shipped:
 *
 *  1. **Idempotence.** A tick runs on the pipeline's cadence and can be run by
 *     hand at any time. If "already posted" were ever mis-decided, a club's
 *     channel fills with duplicate poll messages and every duplicate carries
 *     working vote buttons — several messages, one Firestore doc, and members
 *     unable to tell which tally is real. The stored `messageId` is the whole
 *     defence and it is pinned here from both directions.
 *  2. **The custom_id grammar.** The vote path is LIVE. A posted button whose
 *     `custom_id` does not parse back is a button that answers "this button is
 *     not one the estate bot recognises" forever. The test parses what the
 *     poster would actually send with the live parser, not with a copy of it.
 *  3. **The gate fails closed** — and fails DARK before it fails closed, so an
 *     unminted secret reads as "not switched on yet" rather than "you are not
 *     allowed".
 *
 * The Discord and Firestore halves are injected (`SyncDeps`), so every test
 * here runs with no network at all; a stub that was accidentally reached over
 * the wire would fail loudly rather than write production data.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';
import { parsePollCustomId } from '../src/poll-vote.js';
import { discordFetch } from '../src/discord-api.js';
import {
  bearerToken,
  laneCollection,
  messageRecordKey,
  recordFromDoc,
  runPollSync,
  secretsMatch,
  type ClubRow,
  type MessageRecord,
  type PollRow,
  type SyncDeps,
} from '../src/poll-sync.js';

// ---------------------------------------------------------------------------
// A recording stub of everything the tick touches
// ---------------------------------------------------------------------------

interface Fake {
  deps: SyncDeps;
  posts: Array<{ channelId: string; payload: any }>;
  edits: Array<{ channelId: string; messageId: string; payload: any }>;
  records: Map<string, MessageRecord>;
}

function fake(opts: {
  clubs: ClubRow[];
  polls: Record<string, PollRow[]>;
  tallies?: number[];
  settings?: { webhookUrl?: string; discordChannelId?: string } | null;
  records?: Record<string, MessageRecord>;
  postStatus?: number;
  editStatus?: number;
  webhookChannel?: string | null;
}): Fake {
  const posts: Fake['posts'] = [];
  const edits: Fake['edits'] = [];
  const records = new Map<string, MessageRecord>(Object.entries(opts.records ?? {}));
  let nextMessageId = 1000;

  const deps: SyncDeps = {
    async listClubs() {
      return opts.clubs;
    },
    async discordSettings() {
      if (opts.settings === null) return null;
      return {
        webhookUrl: opts.settings?.webhookUrl ?? '',
        discordChannelId: opts.settings?.discordChannelId ?? '',
      };
    },
    async listPolls(clubId) {
      return opts.polls[clubId] ?? [];
    },
    async tallies(_clubId, _pollId, optionCount) {
      return opts.tallies ?? new Array<number>(optionCount).fill(0);
    },
    async readRecord(key) {
      return records.get(key) ?? null;
    },
    async writeRecord(key, record) {
      records.set(key, {
        channelId: record.channelId,
        messageId: record.messageId,
        renderedStatus: record.renderedStatus,
      });
    },
    async postMessage(channelId, payload) {
      posts.push({ channelId, payload });
      const status = opts.postStatus ?? 200;
      if (status >= 400) return { ok: false, status };
      nextMessageId += 1;
      return { ok: true, status, messageId: String(nextMessageId) };
    },
    async editMessage(channelId, messageId, payload) {
      edits.push({ channelId, messageId, payload });
      const status = opts.editStatus ?? 200;
      return { ok: status < 400, status };
    },
    async resolveWebhookChannel() {
      return opts.webhookChannel ?? null;
    },
  };
  return { deps, posts, edits, records };
}

const OPEN_CLUB: ClubRow = { id: 'club1', name: 'Night Watch', votingEnabled: true };
const OPEN_POLL: PollRow = {
  id: 'poll1',
  poll: { question: 'What next?', status: 'open', options: ['Guards! Guards!', 'Jingo'] },
};
const CLOSED_POLL: PollRow = { id: 'poll1', poll: { ...OPEN_POLL.poll, status: 'closed' } };

// ---------------------------------------------------------------------------
// Posting — the payload, and the grammar the LIVE vote path has to parse
// ---------------------------------------------------------------------------

test('an open poll with no record is posted, with buttons carrying the exact pv| grammar', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const stats = await runPollSync(f.deps, 'clubs');

  assert.equal(stats.posted, 1);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0]!.channelId, 'chan-9');

  const rows = f.posts[0]!.payload.components as Array<{ components: Array<{ custom_id: string }> }>;
  const ids = rows.flatMap((row) => row.components.map((b) => b.custom_id));
  assert.equal(ids.length, 2);
  // ⚠️ Parsed with the LIVE parser, not a copy: this is the whole point. A
  // button the poster emits that the vote path cannot route is a dead button.
  ids.forEach((id, i) => {
    assert.deepEqual(parsePollCustomId(id), {
      clubCol: 'clubs',
      clubId: 'club1',
      pollId: 'poll1',
      optionIndex: i,
    });
  });
  assert.match(f.posts[0]!.payload.embeds[0].footer.text, /syncs with the club page/);
});

test('the message record is stored under a key naming lane, club AND poll', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  await runPollSync(f.deps, 'clubs_dev');
  // The composite key is what makes prod and dev incapable of addressing each
  // other's message — a bare pollId could not promise that.
  const key = messageRecordKey('clubs_dev', 'club1', 'poll1');
  assert.equal(key, 'clubs_dev__club1__poll1');
  assert.equal(f.records.get(key)?.channelId, 'chan-9');
  assert.equal(f.records.get(key)?.renderedStatus, 'open');
});

// ---------------------------------------------------------------------------
// Idempotence — the expensive bug
// ---------------------------------------------------------------------------

test('running the tick twice posts ONCE and edits thereafter', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const first = await runPollSync(f.deps, 'clubs');
  const second = await runPollSync(f.deps, 'clubs');

  assert.equal(first.posted, 1);
  assert.equal(second.posted, 0, 'a second tick must never create a second message');
  assert.equal(second.edited, 1);
  assert.equal(f.posts.length, 1);
  assert.equal(f.edits.length, 1);
  assert.equal(f.edits[0]!.messageId, '1001');
});

test('an existing record edits that message and never consults the channel config', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    // No channel resolvable at all: an edit must not need one, because the
    // record already knows where the message lives.
    settings: null,
    records: {
      'clubs__club1__poll1': { channelId: 'chan-old', messageId: 'm-77', renderedStatus: 'open' },
    },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.posted, 0);
  assert.equal(stats.edited, 1);
  assert.equal(f.edits[0]!.channelId, 'chan-old');
  assert.equal(f.edits[0]!.messageId, 'm-77');
});

// ---------------------------------------------------------------------------
// Close propagation
// ---------------------------------------------------------------------------

test('a poll that closed is edited to the closed shape: no buttons, final tally, once', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [CLOSED_POLL] },
    tallies: [3, 1],
    records: {
      'clubs__club1__poll1': { channelId: 'chan-9', messageId: 'm-1', renderedStatus: 'open' },
    },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.closed, 1);
  const payload = f.edits[0]!.payload;
  // ⚠️ `components: []` must be PRESENT — omitting the field leaves Discord's
  // existing buttons in place, which is the failure this asserts against.
  assert.deepEqual(payload.components, []);
  assert.match(payload.embeds[0].footer.text, /final — this poll is closed/);
  assert.match(payload.embeds[0].description, /🏆/);
  assert.equal(f.records.get('clubs__club1__poll1')?.renderedStatus, 'closed');

  // And exactly once: the second tick has nothing left to do.
  const again = await runPollSync(f.deps, 'clubs');
  assert.equal(again.closed, 0);
  assert.equal(f.edits.length, 1);
});

test('a poll that closed without ever being posted is NEVER posted', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [CLOSED_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.posted, 0);
  assert.equal(f.posts.length, 0);
  assert.equal(f.edits.length, 0);
  assert.equal(stats.skipped, 1);
});

test('a deleted OPEN poll message (404) is reposted and the record repointed', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    editStatus: 404,
    records: {
      'clubs__club1__poll1': { channelId: 'chan-9', messageId: 'gone', renderedStatus: 'open' },
    },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.posted, 1);
  assert.equal(f.records.get('clubs__club1__poll1')?.messageId, '1001');
  assert.ok(stats.notes.some((n) => /had been deleted/.test(n)));
});

test('a deleted CLOSED poll message is left gone, not resurrected', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [CLOSED_POLL] },
    editStatus: 404,
    settings: { discordChannelId: 'chan-9' },
    records: {
      'clubs__club1__poll1': { channelId: 'chan-9', messageId: 'gone', renderedStatus: 'open' },
    },
  });
  await runPollSync(f.deps, 'clubs');
  assert.equal(f.posts.length, 0);
  // Marked closed so the next tick does not try again forever.
  assert.equal(f.records.get('clubs__club1__poll1')?.renderedStatus, 'closed');
});

// ---------------------------------------------------------------------------
// Blast rails — opt-in, named skips, per-club isolation
// ---------------------------------------------------------------------------

test('a club that did not opt in is not touched, and is not an event', async () => {
  const f = fake({
    clubs: [{ id: 'club1', name: 'Quiet', votingEnabled: false }],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.clubs_considered, 1);
  assert.equal(stats.clubs_opted_in, 0);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(stats.notes, []);
});

test('no resolvable channel is a NAMED skip that says what to add', async () => {
  const f = fake({ clubs: [OPEN_CLUB], polls: { club1: [OPEN_POLL] }, settings: null });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(f.posts.length, 0);
  assert.equal(stats.skipped, 1);
  assert.match(stats.notes[0]!, /discordChannelId/);
  assert.match(stats.notes[0]!, /Nothing was posted/);
});

test('the webhook URL supplies the channel when no explicit id is set', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    settings: { webhookUrl: 'https://discord.com/api/webhooks/1/tok' },
    webhookChannel: 'chan-from-webhook',
  });
  await runPollSync(f.deps, 'clubs');
  assert.equal(f.posts[0]!.channelId, 'chan-from-webhook');
});

test('Discord refusing a post is a named skip, never a crash', async () => {
  const f = fake({
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
    postStatus: 403,
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.posted, 0);
  assert.match(stats.notes[0]!, /HTTP 403/);
  assert.match(stats.notes[0]!, /Send Messages/);
  // Nothing was recorded, so the next tick genuinely retries.
  assert.equal(f.records.size, 0);
});

test('one club blowing up does not stop the sweep', async () => {
  const f = fake({
    clubs: [
      { id: 'bad', name: 'Broken', votingEnabled: true },
      OPEN_CLUB,
    ],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const listPolls = f.deps.listPolls.bind(f.deps);
  f.deps.listPolls = async (clubId) => {
    if (clubId === 'bad') throw new Error('firestore said no');
    return listPolls(clubId);
  };
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.posted, 1, 'the healthy club still synced');
  assert.ok(stats.notes.some((n) => /firestore said no/.test(n)));
  assert.ok(stats.notes.some((n) => /Every other club was unaffected/.test(n)));
});

test('a total Firestore outage returns a worded tick, not a throw', async () => {
  const f = fake({ clubs: [], polls: {} });
  f.deps.listClubs = async () => {
    throw new Error('no network');
  };
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.clubs_considered, 0);
  assert.match(stats.notes[0]!, /not a permissions one/);
});

// ---------------------------------------------------------------------------
// Rate limits — 429 with Discord's own retry_after, bounded
// ---------------------------------------------------------------------------

test('discordFetch honours retry_after on a 429 and stops after a bounded number of tries', async () => {
  const originalFetch = globalThis.fetch;
  const waits: number[] = [];
  try {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ retry_after: 0.25 }), { status: 429 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const res = await discordFetch('https://example.invalid/x', { method: 'GET' }, async (ms) => {
      waits.push(ms);
    });
    assert.equal(res.status, 200);
    assert.deepEqual(waits, [250], 'waited exactly what Discord asked for, in ms');

    // Bounded: a permanently rate-limited endpoint gives up rather than looping.
    calls = 0;
    waits.length = 0;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ retry_after: 0.1 }), { status: 429 })) as typeof fetch;
    const stuck = await discordFetch('https://example.invalid/x', { method: 'GET' }, async (ms) => {
      waits.push(ms);
    });
    assert.equal(stuck.status, 429);
    assert.equal(waits.length, 2, 'three attempts total, so two waits — then it returns the 429');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// The route gate
// ---------------------------------------------------------------------------

const syncRequest = (env: Record<string, string>, headers: Record<string, string> = {}) =>
  app.request(
    'https://discord.heygabi.ai/polls/sync',
    { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' },
    env,
  );

test('the sync route ships DARK: no POLL_SYNC_TOKEN answers a worded 503', async () => {
  const res = await syncRequest({ DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; message: string };
  assert.equal(body.ok, false);
  assert.match(body.message, /not switched on yet/);
  assert.match(body.message, /POLL_SYNC_TOKEN/);
  assert.match(body.message, /Nothing was posted or changed/);
});

test('the dark answer comes BEFORE the auth refusal, even for a signed caller', async () => {
  // An unset secret means there is no such thing as an authorised caller, so
  // "not configured" is the honest answer to everyone — including someone
  // presenting a token. Answering 401 here would send the pipeline owner
  // hunting a credential mismatch that does not exist.
  const res = await syncRequest({}, { authorization: 'Bearer anything' });
  assert.equal(res.status, 503);
});

test('the gate fails CLOSED: wrong or absent token gets a worded 401 and syncs nothing', async () => {
  const env = { POLL_SYNC_TOKEN: 'right', DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' };
  const cases: Array<Record<string, string>> = [
    {}, //                            no header at all
    { authorization: 'Bearer wrong' }, // a wrong secret
    { authorization: 'right' }, //      the right secret, wrong scheme
  ];
  for (const headers of cases) {
    const res = await syncRequest(env, headers);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; message: string };
    assert.equal(body.ok, false);
    assert.match(body.message, /nothing was synced/i);
  }
});

test('an authorised call with no bot token says so as configuration, not permissions', async () => {
  const res = await syncRequest(
    { POLL_SYNC_TOKEN: 'right', FIREBASE_SERVICE_ACCOUNT: '{}' },
    { authorization: 'Bearer right' },
  );
  assert.equal(res.status, 503);
  const body = (await res.json()) as { message: string };
  assert.match(body.message, /DISCORD_BOT_TOKEN/);
  assert.match(body.message, /NOT a permissions problem/);
});

test('an authorised call with an unusable service account degrades in words', async () => {
  const res = await syncRequest(
    { POLL_SYNC_TOKEN: 'right', DISCORD_BOT_TOKEN: 'b' },
    { authorization: 'Bearer right' },
  );
  assert.equal(res.status, 503);
  assert.match((await res.json() as { message: string }).message, /FIREBASE_SERVICE_ACCOUNT/);
});

// ---------------------------------------------------------------------------
// The small pure pieces
// ---------------------------------------------------------------------------

test('lane maps to a club collection, and an unknown lane is refused', () => {
  assert.equal(laneCollection(undefined), 'clubs');
  assert.equal(laneCollection('prod'), 'clubs');
  assert.equal(laneCollection('dev'), 'clubs_dev');
  assert.equal(laneCollection('staging'), null);
  assert.equal(laneCollection(7), null);
});

test('bearerToken parses only a real Bearer header', () => {
  assert.equal(bearerToken('Bearer abc'), 'abc');
  assert.equal(bearerToken('bearer  abc  '), 'abc');
  assert.equal(bearerToken('abc'), '');
  assert.equal(bearerToken(undefined), '');
});

test('secretsMatch is exact', () => {
  assert.equal(secretsMatch('abc', 'abc'), true);
  assert.equal(secretsMatch('abc', 'abd'), false);
  assert.equal(secretsMatch('abc', 'abcd'), false);
  assert.equal(secretsMatch('', ''), true);
});

test('recordFromDoc refuses a half-written record and defaults status to open', () => {
  assert.equal(recordFromDoc({ fields: { channelId: { stringValue: 'c' } } }), null);
  assert.equal(recordFromDoc({ fields: { messageId: { stringValue: 'm' } } }), null);
  assert.equal(recordFromDoc({}), null);
  // ⚠️ Anything not affirmatively 'closed' reads as open, so a record from an
  // older build re-renders instead of counting as already-propagated.
  assert.deepEqual(
    recordFromDoc({ fields: { channelId: { stringValue: 'c' }, messageId: { stringValue: 'm' } } }),
    { channelId: 'c', messageId: 'm', renderedStatus: 'open' },
  );
  assert.equal(
    recordFromDoc({
      fields: {
        channelId: { stringValue: 'c' },
        messageId: { stringValue: 'm' },
        renderedStatus: { stringValue: 'closed' },
      },
    })?.renderedStatus,
    'closed',
  );
});

// ---------------------------------------------------------------------------
// ⚠️ THE POLL-ANNOUNCEMENT OPT-OUT — read here, defined and written elsewhere
// ---------------------------------------------------------------------------
//
// `features.discordPollAnnouncements` is an existing club feature key
// (`apps/audiobook-worker/src/enforce-routes.ts` allows it through
// `updateClubDetails`); the toggle itself is built on the audiobook side. This
// Worker only READS it, and the DEFAULT is the whole risk — which is why it has
// a test of its own rather than riding along on somebody else's.

test('⚠️ ABSENT means YES — a deployment must not silently mute every club that already announces', async () => {
  const f = fake({
    // ⚠️ No `announcementsEnabled` at all: exactly the shape of every club doc
    // in the estate before the toggle is written to any of them. The
    // affirmative `=== true` form would have skipped every one of them, and the
    // symptom would have looked like the sync tick being broken.
    clubs: [OPEN_CLUB],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(f.posts.length, 1);
  assert.equal(stats.posted, 1);
  assert.equal(stats.skipped, 0);
});

test('an EXPLICIT false opts the club out — nothing is posted, and the skip says WHY', async () => {
  const f = fake({
    clubs: [{ ...OPEN_CLUB, announcementsEnabled: false }],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(f.posts.length, 0, 'an opted-out club must have nothing posted into it');
  assert.equal(stats.posted, 0);
  assert.equal(stats.skipped, 1);
  // ⚠️ NOTED, not silent: this club HAS Discord voting on, so "opted in and
  // nothing posted" without a reason reads as the tick being broken.
  assert.equal(stats.notes.length, 1);
  assert.match(stats.notes[0]!, /ANNOUNCEMENTS switched off/);
  assert.match(stats.notes[0]!, /own choice/);
  assert.doesNotMatch(stats.notes[0]!, /error|failed/i);
});

test('⚠️ the two toggles are orthogonal — voting off still short-circuits first, and silently', async () => {
  const f = fake({
    clubs: [{ id: 'c9', name: 'Quiet', votingEnabled: false, announcementsEnabled: true }],
    polls: { c9: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
  });
  const stats = await runPollSync(f.deps, 'clubs');
  assert.equal(stats.clubs_opted_in, 0);
  assert.equal(stats.skipped, 0);
  // A club that never opted into Discord voting is the NORMAL case and makes
  // no note — that behaviour is unchanged by the announcements toggle.
  assert.deepEqual(stats.notes, []);
});

test('the announcement opt-out does not touch a club that already has a posted message', async () => {
  // ⚠️ The opt-out stops POSTING; it deliberately does not delete or freeze a
  // message already in the channel, whose vote buttons still work. Turning a
  // toggle off must not reach backwards into a live conversation.
  const f = fake({
    clubs: [{ ...OPEN_CLUB, announcementsEnabled: false }],
    polls: { club1: [OPEN_POLL] },
    settings: { discordChannelId: 'chan-9' },
    records: {
      'clubs__club1__poll1': { channelId: 'chan-9', messageId: '55', renderedStatus: 'open' },
    },
  });
  await runPollSync(f.deps, 'clubs');
  assert.equal(f.edits.length, 0);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(f.records.get('clubs__club1__poll1'), {
    channelId: 'chan-9',
    messageId: '55',
    renderedStatus: 'open',
  });
});
