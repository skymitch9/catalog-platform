/**
 * GABI's book-club discussion questions — the sync tick's rules, its rails,
 * and the route's gate.
 *
 * What these tests protect, in order of how expensive the bug would be:
 *
 *  1. ⚠️ **Baseline-first silence.** This is the rail that decides whether the
 *     feature is usable at all. A club switching it on has a GABI question per
 *     SECTION per book already sitting on the site; if the first tick posted
 *     them, the channel gets a wall of history and somebody switches it off
 *     and never switches it back. Pinned from both directions: the first tick
 *     posts NOTHING and records an instant, and the second tick posts only
 *     what was created after that instant.
 *  2. **Idempotence.** A tick runs on the pipeline's cadence and can be run by
 *     hand at any time. If "already posted" were ever mis-decided, the channel
 *     fills with duplicate questions. The per-question record is the whole
 *     defence.
 *  3. **The opt-in fails closed.** No `features.discordQuestions`, no channel,
 *     no post — and each refusal is a SENTENCE a person can act on, never a
 *     bare status.
 *  4. **What actually gets posted.** No components (these are discussion
 *     prompts, not polls), the section named in the title, and a deep link
 *     that lands on the question itself.
 *
 * The Discord and Firestore halves are injected (`QuestionSyncDeps`), so every
 * test runs with no network at all; a stub accidentally reached over the wire
 * would fail loudly rather than write production data.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { app } from '../src/index.js';
import {
  buildQuestionMessage,
  clubQuestionsEnabled,
  GENERAL_MILESTONE,
  MAX_QUESTIONS_PER_TICK,
  questionFromDoc,
  questionPageUrl,
  questionRecordFromDoc,
  questionRecordKey,
  questionStateKey,
  readFromDoc,
  runQuestionSync,
  sectionLabel,
  timestampMs,
  type QuestionClubRow,
  type QuestionRecord,
  type QuestionRow,
  type QuestionSyncDeps,
  type ReadRow,
} from '../src/question-sync.js';

const SITE = 'https://audiobooks.heygabi.ai';

// ---------------------------------------------------------------------------
// A recording stub of everything the tick touches
// ---------------------------------------------------------------------------

interface Fake {
  deps: QuestionSyncDeps;
  posts: Array<{ channelId: string; payload: any }>;
  records: Map<string, QuestionRecord>;
  baselines: Map<string, number>;
}

function fake(opts: {
  clubs: QuestionClubRow[];
  reads?: Record<string, ReadRow[]>;
  questions?: Record<string, QuestionRow[]>; // keyed `clubId/readId`
  baselines?: Record<string, number>;
  records?: Record<string, QuestionRecord>;
  settings?: { webhookUrl?: string; discordChannelId?: string } | null;
  postStatus?: number;
  webhookChannel?: string | null;
  now?: number;
}): Fake {
  const posts: Fake['posts'] = [];
  const records = new Map<string, QuestionRecord>(Object.entries(opts.records ?? {}));
  const baselines = new Map<string, number>(Object.entries(opts.baselines ?? {}));
  let nextMessageId = 5000;

  const deps: QuestionSyncDeps = {
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
    async listActiveReads(clubId) {
      return opts.reads?.[clubId] ?? [];
    },
    async listQuestions(clubId, readId) {
      return opts.questions?.[`${clubId}/${readId}`] ?? [];
    },
    async readBaseline(key) {
      return baselines.has(key) ? baselines.get(key)! : null;
    },
    async writeBaseline(key, _clubCol, _clubId, baselinedAt) {
      baselines.set(key, baselinedAt);
    },
    async readRecord(key) {
      return records.get(key) ?? null;
    },
    async writeRecord(key, record) {
      records.set(key, { channelId: record.channelId, messageId: record.messageId });
    },
    async postMessage(channelId, payload) {
      posts.push({ channelId, payload });
      const status = opts.postStatus ?? 200;
      if (status >= 400) return { ok: false, status };
      nextMessageId += 1;
      return { ok: true, status, messageId: String(nextMessageId) };
    },
    async resolveWebhookChannel() {
      return opts.webhookChannel ?? null;
    },
    now() {
      return opts.now ?? 1_700_000_000_000;
    },
  };
  return { deps, posts, records, baselines };
}

const CLUB: QuestionClubRow = { id: 'club1', name: 'Night Watch', questionsEnabled: true };
const READ: ReadRow = {
  id: 'read1',
  bookTitle: 'Lessons in Chemistry',
  milestones: [
    { id: 'm0', label: 'Part 1' },
    { id: 'm1', label: 'Part 2' },
  ],
};
const T0 = 1_600_000_000_000; // before any baseline used here
const T2 = 1_800_000_000_000; // after every baseline used here

const question = (over: Partial<QuestionRow> = {}): QuestionRow => ({
  id: 'q1',
  text: 'How does Garmus use the 1950s lab to critique institutional barriers?',
  milestoneId: 'm1',
  partIndex: null,
  createdAtMs: T2,
  ...over,
});

const BASELINED = { [questionStateKey('clubs', 'club1')]: 1_700_000_000_000 };

// ---------------------------------------------------------------------------
// 1. Baseline-first silence — the rail that makes the feature switch-on-able
// ---------------------------------------------------------------------------

test('a club seen for the FIRST time posts nothing at all and records the instant', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    // Ten questions already on the site. Every one of them is history.
    questions: {
      'club1/read1': Array.from({ length: 10 }, (_, i) =>
        question({ id: `q${i}`, createdAtMs: T0 + i }),
      ),
    },
    settings: { discordChannelId: 'chan-1' },
    now: 1_700_000_000_000,
  });

  const stats = await runQuestionSync(f.deps, 'clubs', SITE);

  assert.equal(f.posts.length, 0, 'history must never flood the channel');
  assert.equal(stats.posted, 0);
  assert.equal(stats.baselined, 1);
  assert.equal(f.baselines.get(questionStateKey('clubs', 'club1')), 1_700_000_000_000);
  // And it SAYS so, in a sentence, rather than looking like a silent failure.
  assert.match(stats.notes.join(' '), /first time this club has been seen/i);
  assert.match(stats.notes.join(' '), /stay where they are rather than flooding/i);
});

test('the first tick does not even resolve a channel — nothing is decided before the baseline', async () => {
  // A club with no channel at all would otherwise report "no channel could be
  // worked out" on its very first tick, which reads as a fault when in fact
  // the correct answer is "nothing was due to post anyway".
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question({ createdAtMs: T0 })] },
    settings: null,
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.baselined, 1);
  assert.equal(stats.skipped, 0);
  assert.doesNotMatch(stats.notes.join(' '), /no channel could be worked out/i);
});

test('after the baseline, only questions created AFTER it are posted', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: {
      'club1/read1': [
        question({ id: 'old', createdAtMs: T0 }), //  before the baseline
        question({ id: 'same', createdAtMs: 1_700_000_000_000 }), // exactly ON it
        question({ id: 'new', createdAtMs: T2 }), //  after it
      ],
    },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });

  const stats = await runQuestionSync(f.deps, 'clubs', SITE);

  assert.equal(stats.posted, 1);
  assert.equal(f.posts.length, 1);
  // The boundary is exclusive: a question stamped at exactly the baseline
  // instant is history, not news. Inclusive here would re-post the question
  // whose creation triggered the baseline in a racier world.
  assert.ok(f.records.has(questionRecordKey('clubs', 'club1', 'read1', 'new')));
  assert.ok(!f.records.has(questionRecordKey('clubs', 'club1', 'read1', 'same')));
  assert.ok(!f.records.has(questionRecordKey('clubs', 'club1', 'read1', 'old')));
});

test('an unresolved serverTimestamp is skipped this tick, never posted and never lost', async () => {
  // addComment() writes createdAt as a serverTimestamp; a doc read before it
  // resolves has no timestamp at all. Treating that as 0 would bury it behind
  // the baseline forever; treating it as "now" would post the history the
  // baseline exists to hold back. Waiting one tick costs nothing.
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question({ createdAtMs: null })] },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.posted, 0);
  assert.equal(f.posts.length, 0);
  assert.equal(f.records.size, 0, 'nothing recorded, so the next tick still sees it');
});

// ---------------------------------------------------------------------------
// 2. Idempotence
// ---------------------------------------------------------------------------

test('a question already recorded is never posted again', async () => {
  const key = questionRecordKey('clubs', 'club1', 'read1', 'q1');
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    records: { [key]: { channelId: 'chan-1', messageId: '77' } },
    settings: { discordChannelId: 'chan-1' },
  });

  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(f.posts.length, 0);
  assert.equal(stats.posted, 0);
  assert.equal(stats.skipped, 1);
});

test('running the SAME tick twice posts exactly once — the whole idempotence claim', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });

  const first = await runQuestionSync(f.deps, 'clubs', SITE);
  const second = await runQuestionSync(f.deps, 'clubs', SITE);

  assert.equal(first.posted, 1);
  assert.equal(second.posted, 0);
  assert.equal(f.posts.length, 1, 'a second tick must not duplicate the message');
  assert.equal(second.skipped, 1);
});

test('a post whose message id cannot be read is NOT recorded — better a retry than a duplicate', async () => {
  // The dep contract: ok:false with no messageId. Recording a post we cannot
  // address would strand the message; refusing to record it means the next
  // tick tries again, which is the recoverable failure of the two.
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
    postStatus: 500,
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.posted, 0);
  assert.equal(f.records.size, 0);
  assert.match(stats.notes.join(' '), /Discord refused to post a question \(HTTP 500\)/);
  assert.match(stats.notes.join(' '), /the tick will try again/i);
});

test('the record is written per question, so a mid-run failure keeps what it sent', async () => {
  // Post 1 succeeds, post 2 explodes inside writeRecord. The first question
  // must still be recorded — batching the writes at the end would make the
  // next tick re-post it.
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: {
      'club1/read1': [
        question({ id: 'a', createdAtMs: T2 }),
        question({ id: 'b', createdAtMs: T2 + 1 }),
      ],
    },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  let writes = 0;
  const realWrite = f.deps.writeRecord.bind(f.deps);
  f.deps.writeRecord = async (key, record) => {
    writes += 1;
    if (writes === 2) throw new Error('firestore blew up');
    return realWrite(key, record);
  };

  const stats = await runQuestionSync(f.deps, 'clubs', SITE);

  assert.ok(f.records.has(questionRecordKey('clubs', 'club1', 'read1', 'a')));
  assert.equal(stats.posted, 1);
  // The club is a NAMED skip, not a crash, and every other club still syncs.
  assert.match(stats.notes.join(' '), /this club was skipped because something went wrong/i);
});

// ---------------------------------------------------------------------------
// 3. The opt-in and the channel — both fail closed, in sentences
// ---------------------------------------------------------------------------

test('a club that never opted in is not an event: no post, no note, no noise', async () => {
  const f = fake({
    clubs: [{ id: 'club1', name: 'Night Watch', questionsEnabled: false }],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    settings: { discordChannelId: 'chan-1' },
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.clubs_considered, 1);
  assert.equal(stats.clubs_opted_in, 0);
  assert.equal(f.posts.length, 0);
  assert.deepEqual(stats.notes, [], 'the normal case must not be reported as an event');
  // Not even baselined: an opted-out club costs this tick zero Firestore
  // writes, and it gets its baseline on the tick it actually opts in — which
  // is what makes "switching it on is quiet" true however long it was off.
  assert.equal(f.baselines.size, 0);
});

test('opted in but no channel anywhere: a sentence naming both ways to fix it', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    settings: null,
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(f.posts.length, 0);
  assert.match(stats.notes.join(' '), /no channel could be worked out/i);
  assert.match(stats.notes.join(' '), /discordChannelId/);
  assert.match(stats.notes.join(' '), /webhook URL/);
  assert.match(stats.notes.join(' '), /Nothing was posted/);
});

test('with no explicit channel the webhook names one — the club already agreed to it', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    settings: { webhookUrl: 'https://discord.com/api/webhooks/1/tok' },
    webhookChannel: 'chan-from-webhook',
  });
  await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0]!.channelId, 'chan-from-webhook');
});

test('an explicit discordChannelId beats the webhook, so a club can split the two', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    settings: {
      webhookUrl: 'https://discord.com/api/webhooks/1/tok',
      discordChannelId: 'chan-explicit',
    },
    webhookChannel: 'chan-from-webhook',
  });
  await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(f.posts[0]!.channelId, 'chan-explicit');
});

test('one club blowing up is a named skip; every other club still syncs', async () => {
  const f = fake({
    clubs: [
      { id: 'bad', name: 'Broken', questionsEnabled: true },
      { id: 'club1', name: 'Night Watch', questionsEnabled: true },
    ],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: {
      ...BASELINED,
      [questionStateKey('clubs', 'bad')]: 1,
    },
    settings: { discordChannelId: 'chan-1' },
  });
  const realReads = f.deps.listActiveReads.bind(f.deps);
  f.deps.listActiveReads = async (clubId) => {
    if (clubId === 'bad') throw new Error('firestore hiccup');
    return realReads(clubId);
  };

  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.posted, 1, 'the healthy club still posted');
  assert.match(stats.notes.join(' '), /Broken/);
  assert.match(stats.notes.join(' '), /firestore hiccup/);
  assert.match(stats.notes.join(' '), /Every other club was unaffected/);
});

test('no clubs listable at all is reported as a service problem, not a permissions one', async () => {
  const f = fake({ clubs: [] });
  f.deps.listClubs = async () => {
    throw new Error('firestore unreachable');
  };
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.posted, 0);
  assert.match(stats.notes.join(' '), /not a permissions one/i);
  assert.match(stats.notes.join(' '), /firestore unreachable/);
});

// ---------------------------------------------------------------------------
// 4. Rails: the per-tick cap, and ordering
// ---------------------------------------------------------------------------

test('more new questions than the cap posts the cap and SAYS the rest are waiting', async () => {
  const many = Array.from({ length: MAX_QUESTIONS_PER_TICK + 3 }, (_, i) =>
    question({ id: `q${i}`, createdAtMs: T2 + i }),
  );
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': many },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);

  assert.equal(stats.posted, MAX_QUESTIONS_PER_TICK);
  assert.match(stats.notes.join(' '), /more than one tick posts/i);
  assert.match(stats.notes.join(' '), /rather than dropped/i);

  // And the NEXT tick picks up exactly the remainder, in order.
  const second = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(second.posted, 3);
  assert.equal(f.posts.length, MAX_QUESTIONS_PER_TICK + 3);
});

test('questions go out oldest-first, across every active read', async () => {
  const readB: ReadRow = { id: 'read2', bookTitle: 'ReDawn', milestones: [{ id: 'm0', label: 'Part 1' }] };
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ, readB] },
    questions: {
      'club1/read1': [question({ id: 'late', text: 'later one', createdAtMs: T2 + 100 })],
      'club1/read2': [question({ id: 'early', text: 'earlier one', milestoneId: 'm0', createdAtMs: T2 })],
    },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  await runQuestionSync(f.deps, 'clubs', SITE);

  assert.equal(f.posts.length, 2);
  // A channel that got a book's questions out of order would read as nonsense.
  assert.match(f.posts[0]!.payload.embeds[0].description, /earlier one/);
  assert.match(f.posts[1]!.payload.embeds[0].description, /later one/);
});

test('a question with only whitespace is never posted', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question({ text: '   \n ' })] },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  const stats = await runQuestionSync(f.deps, 'clubs', SITE);
  assert.equal(stats.posted, 0);
  assert.equal(f.posts.length, 0);
});

// ---------------------------------------------------------------------------
// 5. What a posted question actually looks like
// ---------------------------------------------------------------------------

test('the posted message carries NO components — a question is not a poll', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  await runQuestionSync(f.deps, 'clubs', SITE);

  const payload = f.posts[0]!.payload;
  assert.ok(Array.isArray(payload.embeds));
  assert.equal(
    payload.components,
    undefined,
    'buttons would imply a vote that has nowhere to be recorded',
  );
});

test('the embed names the book and section, quotes the question, and links to it', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question({ milestoneId: 'm1' })] },
    baselines: BASELINED,
    settings: { discordChannelId: 'chan-1' },
  });
  await runQuestionSync(f.deps, 'clubs', SITE);

  const embed = f.posts[0]!.payload.embeds[0];
  // The section is in the TITLE, prominently, so somebody behind can skip it.
  assert.equal(embed.title, 'Lessons in Chemistry — Part 2');
  assert.match(embed.description, /^> How does Garmus/);
  assert.match(
    embed.description,
    /\(https:\/\/audiobooks\.heygabi\.ai\/club-read\.html\?club=club1&read=read1#c-q1\)/,
  );
  assert.match(embed.footer.text, /Night Watch · a question from GABI/);
});

test('a dev-lane club links into /dev/, never at the prod site', async () => {
  const f = fake({
    clubs: [CLUB],
    reads: { club1: [READ] },
    questions: { 'club1/read1': [question()] },
    baselines: { [questionStateKey('clubs_dev', 'club1')]: 1_700_000_000_000 },
    settings: { discordChannelId: 'chan-1' },
  });
  await runQuestionSync(f.deps, 'clubs_dev', SITE);
  assert.match(f.posts[0]!.payload.embeds[0].description, /audiobooks\.heygabi\.ai\/dev\/club-read\.html/);
});

test('the deep link targets the COMMENT anchor the read page actually handles', () => {
  // club-read.html reads `#c-<commentId>`, finds that comment, opens its
  // section and scrolls to it. A link to the bare page would land people in a
  // collapsed accordion with no idea which section was meant.
  const url = questionPageUrl(SITE, 'clubs', 'c 1', 'r/1', 'q1');
  assert.match(url, /#c-q1$/);
  assert.match(url, /club=c%201/, 'ids are encoded, so a stray space cannot break the link');
  assert.match(url, /read=r%2F1/);
});

test('a trailing slash on the site base does not produce a doubled slash', () => {
  assert.match(questionPageUrl(`${SITE}/`, 'clubs', 'c', 'r', 'q'), /ai\/club-read\.html/);
});

// ---------------------------------------------------------------------------
// 6. Section naming — the three cases, including the one that returns null
// ---------------------------------------------------------------------------

test('a milestone id resolves to the read`s own label', () => {
  assert.equal(sectionLabel(READ, question({ milestoneId: 'm0' })), 'Part 1');
  assert.equal(sectionLabel(READ, question({ milestoneId: 'm1' })), 'Part 2');
});

test('a general-milestone comment falls back to its partIndex, one-based', () => {
  const q = question({ milestoneId: GENERAL_MILESTONE, partIndex: 2 });
  assert.equal(sectionLabel(READ, q), 'Part 3');
});

test('an unnameable section is null, never a guess', () => {
  // The site derives a chapter-group label client-side from chapterTitles.
  // This Worker deliberately does not reimplement that; an unknown milestone
  // with no partIndex drops out of the title rather than appearing as
  // something wrong.
  assert.equal(sectionLabel(READ, question({ milestoneId: 'm-nope', partIndex: null })), null);
  assert.equal(
    sectionLabel(READ, question({ milestoneId: GENERAL_MILESTONE, partIndex: -1 })),
    null,
  );
});

test('with no section the embed still reads as a sentence', () => {
  const msg = buildQuestionMessage({
    clubName: 'Night Watch',
    bookTitle: 'Jingo',
    section: null,
    question: 'Whose war is this?',
    url: 'https://example.test/x',
  });
  const embed = (msg.embeds[0] as any);
  assert.equal(embed.title, 'Jingo');
  assert.match(embed.description, /Something to chew on for this one\./);
  assert.doesNotMatch(embed.description, /undefined|null/);
});

test('an over-long question is truncated rather than refused by Discord', () => {
  const embed = buildQuestionMessage({
    clubName: 'c',
    bookTitle: 'b',
    section: 's',
    question: 'x'.repeat(6000),
    url: 'https://example.test/x',
  }).embeds[0] as any;
  assert.ok(embed.description.length <= 4096, 'Discord refuses a description over 4096');
  assert.ok(embed.title.length <= 256);
});

// ---------------------------------------------------------------------------
// 7. Firestore decoding — the shapes the audiobook site actually writes
// ---------------------------------------------------------------------------

test('clubQuestionsEnabled is AFFIRMATIVE: absent, false and non-boolean all mean OFF', () => {
  const withFeatures = (fields: any) => ({ fields: { features: { mapValue: { fields } } } });
  assert.equal(clubQuestionsEnabled(withFeatures({ discordQuestions: { booleanValue: true } })), true);
  assert.equal(clubQuestionsEnabled(withFeatures({ discordQuestions: { booleanValue: false } })), false);
  assert.equal(clubQuestionsEnabled(withFeatures({ discordQuestions: { stringValue: 'true' } })), false);
  assert.equal(clubQuestionsEnabled(withFeatures({ polls: { booleanValue: true } })), false);
  assert.equal(clubQuestionsEnabled({ fields: {} }), false);
  assert.equal(clubQuestionsEnabled({}), false);
});

test('discordQuestions is a SEPARATE key from discordPollVoting', async () => {
  // A club can want GABI's questions without wiring up votable polls, and the
  // reverse. Reusing one flag for both would make switching on questions also
  // switch on a bot-posted voting surface nobody asked for.
  const votingOnly = {
    fields: { features: { mapValue: { fields: { discordPollVoting: { booleanValue: true } } } } },
  };
  assert.equal(clubQuestionsEnabled(votingOnly), false);
  const { clubVotingEnabled } = await import('../src/poll-vote.js');
  const questionsOnly = {
    fields: { features: { mapValue: { fields: { discordQuestions: { booleanValue: true } } } } },
  };
  assert.equal(clubVotingEnabled(questionsOnly), false);
});

test('questionFromDoc only accepts GABI`s own comments', () => {
  const base = {
    name: 'projects/p/databases/(default)/documents/clubs/c/reads/r/comments/abc',
    fields: {
      isBot: { booleanValue: true },
      text: { stringValue: 'A question?' },
      milestoneId: { stringValue: 'm2' },
      partIndex: { integerValue: '4' },
      createdAt: { timestampValue: '2026-08-18T10:00:00Z' },
    },
  };
  const q = questionFromDoc(base)!;
  assert.equal(q.id, 'abc');
  assert.equal(q.milestoneId, 'm2');
  assert.equal(q.partIndex, 4);
  assert.equal(q.createdAtMs, Date.parse('2026-08-18T10:00:00Z'));

  // A member's comment is not a question, and must never be republished into
  // a channel — that would be broadcasting somebody's words without consent.
  assert.equal(questionFromDoc({ ...base, fields: { ...base.fields, isBot: { booleanValue: false } } }), null);
  const { isBot, ...noFlag } = base.fields;
  assert.equal(questionFromDoc({ ...base, fields: noFlag as any }), null);
  assert.equal(questionFromDoc({ ...base, fields: { ...base.fields, isBot: { stringValue: 'true' } } }), null);
});

test('a bot comment with no text or no id decodes to null rather than a blank post', () => {
  const name = 'projects/p/databases/(default)/documents/clubs/c/reads/r/comments/abc';
  assert.equal(questionFromDoc({ name, fields: { isBot: { booleanValue: true } } }), null);
  assert.equal(
    questionFromDoc({ fields: { isBot: { booleanValue: true }, text: { stringValue: 'q' } } }),
    null,
  );
});

test('a missing partIndex is null, and a null-shaped one does not become 0', () => {
  const name = 'projects/p/databases/(default)/documents/clubs/c/reads/r/comments/abc';
  const q = questionFromDoc({
    name,
    fields: { isBot: { booleanValue: true }, text: { stringValue: 'q' } },
  })!;
  assert.equal(q.partIndex, null);
  // `partIndex: 0` is a REAL section (Part 1) and must survive.
  const zero = questionFromDoc({
    name,
    fields: {
      isBot: { booleanValue: true },
      text: { stringValue: 'q' },
      partIndex: { integerValue: '0' },
    },
  })!;
  assert.equal(zero.partIndex, 0);
  assert.equal(sectionLabel(READ, zero), 'Part 1');
});

test('an absent milestoneId defaults to the site`s own `general` constant', () => {
  const q = questionFromDoc({
    name: 'x/abc',
    fields: { isBot: { booleanValue: true }, text: { stringValue: 'q' } },
  })!;
  assert.equal(q.milestoneId, GENERAL_MILESTONE);
  assert.equal(GENERAL_MILESTONE, 'general', 'pinned to club-reads.js GENERAL_MILESTONE');
});

test('readFromDoc pulls the title and the milestone labels it needs', () => {
  const read = readFromDoc({
    name: 'projects/p/databases/(default)/documents/clubs/c/reads/r7',
    fields: {
      bookTitle: { stringValue: 'Rhythm of War' },
      milestones: {
        arrayValue: {
          values: [
            { mapValue: { fields: { id: { stringValue: 'm0' }, label: { stringValue: 'Part One' } } } },
            { mapValue: { fields: { id: { stringValue: 'm1' } } } }, // label absent
            { mapValue: { fields: { label: { stringValue: 'orphan' } } } }, // id absent → dropped
          ],
        },
      },
    },
  })!;
  assert.equal(read.id, 'r7');
  assert.equal(read.bookTitle, 'Rhythm of War');
  assert.deepEqual(read.milestones, [
    { id: 'm0', label: 'Part One' },
    { id: 'm1', label: '' },
  ]);
  // A milestone with an empty label is unnameable, not blank-named.
  assert.equal(sectionLabel(read, question({ milestoneId: 'm1', partIndex: null })), null);
});

test('timestampMs parses a real Firestore timestamp and refuses everything else', () => {
  // The literal is computed independently (Python `datetime(2026,8,18,10,0,0,
  // tzinfo=utc).timestamp()*1000`), not copied from what the code returned —
  // a self-referential expectation would pass against any parser at all.
  assert.equal(timestampMs({ timestampValue: '2026-08-18T10:00:00Z' }), 1787047200000);
  assert.equal(timestampMs({ timestampValue: 'not a date' }), null);
  assert.equal(timestampMs({ stringValue: '2026-08-18T10:00:00Z' }), null);
  assert.equal(timestampMs(undefined), null);
});

test('a record needs BOTH ids to count as posted', () => {
  assert.deepEqual(
    questionRecordFromDoc({ fields: { channelId: { stringValue: 'c' }, messageId: { stringValue: 'm' } } }),
    { channelId: 'c', messageId: 'm' },
  );
  assert.equal(questionRecordFromDoc({ fields: { channelId: { stringValue: 'c' } } }), null);
  assert.equal(
    questionRecordFromDoc({ fields: { channelId: { stringValue: '' }, messageId: { stringValue: 'm' } } }),
    null,
  );
  assert.equal(questionRecordFromDoc({}), null);
});

test('the record key states all four facts, so it cannot address the wrong question', () => {
  assert.equal(questionRecordKey('clubs', 'c1', 'r1', 'q1'), 'clubs__c1__r1__q1');
  // The two lanes are separate universes that could legitimately hold the
  // same auto-id; the key keeps them apart.
  assert.notEqual(
    questionRecordKey('clubs', 'c1', 'r1', 'q1'),
    questionRecordKey('clubs_dev', 'c1', 'r1', 'q1'),
  );
  assert.equal(questionStateKey('clubs_dev', 'c1'), 'clubs_dev__c1');
});

// ---------------------------------------------------------------------------
// 8. The route gate
// ---------------------------------------------------------------------------

const syncRequest = (env: Record<string, string>, headers: Record<string, string> = {}) =>
  app.request(
    'https://discord.heygabi.ai/questions/sync',
    { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' },
    env,
  );

test('the question route ships DARK: no POLL_SYNC_TOKEN answers a worded 503', async () => {
  const res = await syncRequest({ DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { ok: boolean; message: string };
  assert.equal(body.ok, false);
  assert.match(body.message, /not switched on yet/);
  assert.match(body.message, /POLL_SYNC_TOKEN/);
  assert.match(body.message, /Nothing was posted/);
});

test('the dark answer comes BEFORE the auth refusal, even for a signed caller', async () => {
  const res = await syncRequest({}, { authorization: 'Bearer anything' });
  assert.equal(res.status, 503);
});

test('the gate fails CLOSED: wrong or absent token gets a worded 401 and posts nothing', async () => {
  const env = { POLL_SYNC_TOKEN: 'right', DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' };
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: 'right' }]) {
    const res = await syncRequest(env, headers);
    assert.equal(res.status, 401);
    const body = (await res.json()) as { ok: boolean; message: string };
    assert.equal(body.ok, false);
    assert.match(body.message, /no questions were posted/i);
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

test('an unknown lane is refused in words rather than silently treated as prod', async () => {
  const res = await app.request(
    'https://discord.heygabi.ai/questions/sync',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer right' },
      body: JSON.stringify({ lane: 'staging' }),
    },
    { POLL_SYNC_TOKEN: 'right', DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' },
  );
  assert.equal(res.status, 400);
  assert.match((await res.json() as { message: string }).message, /Unknown lane/);
});

test('the poll sync route is untouched by all of this', async () => {
  // Two routes, one secret, independent failure domains — but the poll tick's
  // own gate must still answer exactly as it did before.
  const res = await app.request(
    'https://discord.heygabi.ai/polls/sync',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
    { DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' },
  );
  assert.equal(res.status, 503);
  assert.match((await res.json() as { message: string }).message, /Poll message syncing/);
});

test('/api/health names the feature and reports readiness honestly', async () => {
  const dark = await app.request('https://discord.heygabi.ai/api/health', {}, {});
  const darkBody = (await dark.json()) as any;
  assert.ok(darkBody.features.includes('club_question_sync'));
  assert.equal(darkBody.question_sync_ready, false, 'an honest false while the secrets are unset');

  const lit = await app.request(
    'https://discord.heygabi.ai/api/health',
    {},
    { POLL_SYNC_TOKEN: 't', DISCORD_BOT_TOKEN: 'b', FIREBASE_SERVICE_ACCOUNT: '{}' },
  );
  const litBody = (await lit.json()) as any;
  assert.equal(litBody.question_sync_ready, true);
  // ⚠️ Ready is about the WORKER, not the clubs: with no club opted in this
  // reads true while nothing posts anywhere. Pinned so nobody later reads it
  // as "questions are live".
  assert.equal(litBody.poll_sync_ready, true, 'identical by construction today');
});
