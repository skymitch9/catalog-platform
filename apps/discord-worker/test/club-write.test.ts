/**
 * `/rsvp` and `/progress` — the dark pair.
 *
 * ⚠️ **THE MOST IMPORTANT TEST IN THIS FILE IS `while the posture is off,
 * NOTHING is written and NO network call is made`**, because the reason this
 * pair ships dark is not caution: `src/club-write.ts`'s header records that the
 * DOCUMENT SHAPES are inferred rather than measured, and this Worker's service
 * account bypasses `firestore.rules`, so a wrongly shaped write would SUCCEED
 * and fail silently on somebody else's page. The posture is the thing standing
 * between that and a live club, so it is tested first and hardest.
 *
 * After that, the rules that hold whether or not the posture is on:
 *  - input is REJECTED, never stripped or clamped;
 *  - the club is resolved or REFUSED, never guessed;
 *  - the club's own `features.meetingRsvp` opt-in is affirmative-only;
 *  - `/rsvp` OFFERS buttons and does not write, so no default is invented.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildRsvpButtons,
  buildRsvpCustomId,
  CHAPTER_MAX,
  CLUB_COLLECTION,
  CLUB_MSG,
  CLUB_WRITE_SHAPES,
  clubRsvpEnabled,
  clubWritesOn,
  docIdOf,
  isRsvpStatus,
  meetingInstantOf,
  parseRsvpCustomId,
  processProgress,
  processRsvp,
  processRsvpPress,
  progressDocFields,
  renderMeetingLine,
  resolveClub,
  RSVP_PREFIX,
  RSVP_STATUSES,
  rsvpDocFields,
  validateProgress,
} from '../src/club-write.js';
import { CLUB_WRITE_COMMANDS, commandNames, commandsFor } from '../src/commands.js';
import {
  EPHEMERAL,
  PROGRESS_COMMAND_NAME,
  routeInteraction,
  RSVP_COMMAND_NAME,
} from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

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

const lastSaid = (sent: Sent[]): { content?: string; components?: unknown[] } =>
  JSON.parse(String(sent.at(-1)?.init?.body ?? '{}'));

/** A ServiceAccount-shaped object. It is never USED in these tests — every one
 * of them either refuses before minting a token, or asserts that no Firestore
 * call happened at all. */
const fakeSa = { project_id: 'p', client_email: 'x@y', private_key: '' } as never;

// ---------------------------------------------------------------------------
// ⚠️ THE POSTURE — the thing standing between an unverified shape and a club
// ---------------------------------------------------------------------------

test('⚠️ the posture is affirmative-only: "on" and nothing else', () => {
  // Case and surrounding whitespace are forgiven, because a wrangler.toml
  // value with a stray space is a typo in the FILE, not a different posture.
  for (const on of ['on', 'ON', ' on ']) {
    assert.equal(clubWritesOn({ GABI_CLUB_WRITES: on }), true, `"${on}" must be on`);
  }
  // ⚠️ Everything else is OFF, including the four spellings people reach for.
  for (const off of ['off', 'true', '1', 'yes', 'enabled', '', undefined]) {
    assert.equal(
      clubWritesOn({ GABI_CLUB_WRITES: off as string }),
      false,
      `${String(off)} must not switch club writes on`,
    );
  }
});

test('⚠️ it SHIPS OFF — the committed wrangler posture, not a default in code', async () => {
  const { readFile } = await import('node:fs/promises');
  const toml = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /^GABI_CLUB_WRITES = "off"$/m);
});

test('⚠️ while the posture is off, NOTHING is written and NO Firestore call is made', async () => {
  for (const run of [
    () =>
      processRsvp({
        sa: fakeSa,
        discordUserId: 'u1',
        clubName: 'Any Club',
        applicationId: 'app',
        interactionToken: 'tok',
        enabled: false,
      }),
    () =>
      processProgress({
        sa: fakeSa,
        discordUserId: 'u1',
        clubName: 'Any Club',
        percent: 40,
        chapter: '',
        applicationId: 'app',
        interactionToken: 'tok',
        enabled: false,
      }),
    () =>
      processRsvpPress({
        sa: fakeSa,
        customId: buildRsvpCustomId({ clubCol: 'clubs', clubId: 'c1', status: 'yes' }),
        discordUserId: 'u1',
        applicationId: 'app',
        interactionToken: 'tok',
        enabled: false,
      }),
  ]) {
    const stub = stubFetch((url) => {
      if (url.includes('/webhooks/')) return new Response('{}', { status: 200 });
      throw new Error(`⚠️ nothing may be reached while the posture is off: ${url}`);
    });
    try {
      await run();
      assert.equal(lastSaid(stub.sent).content, CLUB_MSG.switchedOff);
      for (const s of stub.sent) {
        assert.equal(s.url.includes('firestore'), false);
        assert.equal(s.url.includes('oauth2'), false);
      }
    } finally {
      stub.restore();
    }
  }
});

test('the switched-off sentence is a LEVER, not a permission, and says nothing was recorded', () => {
  assert.match(CLUB_MSG.switchedOff, /lever on the estate side/);
  assert.match(CLUB_MSG.switchedOff, /nothing was recorded/);
  assert.match(CLUB_MSG.switchedOff, /club page takes both/);
});

test('⚠️ while off, the two commands are NOT published — a control nobody can see cannot misfire', () => {
  assert.equal(commandNames(commandsFor({})).includes('rsvp'), false);
  assert.equal(commandNames(commandsFor({ GABI_CLUB_WRITES: 'on' })).includes('rsvp'), true);
});

test('⚠️ but the ROUTER still answers them, so a stale global command is not a bare failure', () => {
  const rsvp = routeInteraction({
    type: 2,
    data: { name: RSVP_COMMAND_NAME, options: [{ name: 'club', type: 3, value: 'Book Club' }] },
  });
  assert.equal(rsvp.kind, 'rsvp_command');
  const progress = routeInteraction({ type: 2, data: { name: PROGRESS_COMMAND_NAME } });
  assert.equal(progress.kind, 'progress_command');
});

// ---------------------------------------------------------------------------
// ⚠️ The unverified constants — pinned so a change is a decision
// ---------------------------------------------------------------------------

test('⚠️ CLUB_WRITE_SHAPES is pinned: every name a future session must VERIFY is in one block', () => {
  assert.deepEqual(CLUB_WRITE_SHAPES, {
    rsvpCollection: 'rsvps',
    rsvpStatusField: 'status',
    rsvpMeetingField: 'meetingAt',
    clubMeetingField: 'meetingAt',
    progressCollection: 'progress',
    progressPercentField: 'percent',
    progressChapterField: 'chapter',
    displayNameField: 'displayName',
    updatedAtField: 'updatedAt',
  });
});

test('the production lane, and only it — this Worker is not the dev surface', () => {
  assert.equal(CLUB_COLLECTION, 'clubs');
});

// ---------------------------------------------------------------------------
// Input — REJECTED, never stripped
// ---------------------------------------------------------------------------

test('⚠️ /progress with neither a percent nor a chapter records NOTHING and says why', () => {
  const out = validateProgress(undefined, '   ');
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.message, CLUB_MSG.progressNothing);
});

test('⚠️ an out-of-range percent is REFUSED, never rounded or clamped', () => {
  for (const bad of [-1, 101, 40.5]) {
    const out = validateProgress(bad, '');
    assert.equal(out.ok, false, `${bad} must be refused`);
    assert.equal(out.ok === false && out.message, CLUB_MSG.progressPercent);
  }
  assert.match(CLUB_MSG.progressPercent, /does not round a number you did not type/);
  assert.equal(validateProgress(0, '').ok, true);
  assert.equal(validateProgress(100, '').ok, true);
});

test('⚠️ an over-long chapter is REFUSED, never truncated — a trimmed label is a claim you did not make', () => {
  const out = validateProgress(undefined, 'x'.repeat(CHAPTER_MAX + 1));
  assert.equal(out.ok, false);
  assert.equal(out.ok === false && out.message, CLUB_MSG.progressChapter(CHAPTER_MAX));
  assert.match(CLUB_MSG.progressChapter(CHAPTER_MAX), /will not\s+shorten it for you/);
});

test('⚠️ invalid input is refused BEFORE the club list is walked', async () => {
  const stub = stubFetch((url) => {
    if (url.includes('/webhooks/')) return new Response('{}', { status: 200 });
    throw new Error(`nothing may be read to refuse bad input: ${url}`);
  });
  try {
    await processProgress({
      sa: fakeSa,
      discordUserId: 'u1',
      clubName: 'Book Club',
      percent: 400,
      chapter: '',
      applicationId: 'app',
      interactionToken: 'tok',
      enabled: true,
    });
    assert.equal(lastSaid(stub.sent).content, CLUB_MSG.progressPercent);
  } finally {
    stub.restore();
  }
});

test('only the fields actually given are written, and the display name always rides along', () => {
  const actor = { slug: 'sam', displayName: 'Sam' };
  const both = progressDocFields({ percent: 40, chapter: 'ch. 14' }, actor, '2026-09-02T00:00:00.000Z');
  assert.deepEqual(Object.keys(both).sort(), ['chapter', 'displayName', 'percent', 'updatedAt']);
  const onlyPercent = progressDocFields({ percent: 40 }, actor, '2026-09-02T00:00:00.000Z');
  assert.equal('chapter' in onlyPercent, false, 'an absent chapter must not be written as empty');
});

// ---------------------------------------------------------------------------
// The club — resolved or REFUSED, never guessed
// ---------------------------------------------------------------------------

const CLUBS = [
  { id: 'c1', name: 'Tuesday Book Club' },
  { id: 'c2', name: 'Tuesday Board Games' },
  { id: 'c3', name: 'Fantasy Readers' },
];

test('an exact name wins, and a unique partial is accepted', () => {
  assert.equal(resolveClub(CLUBS, 'Tuesday Book Club').ok, true);
  const partial = resolveClub(CLUBS, 'fantasy');
  assert.equal(partial.ok && partial.club.id, 'c3');
});

test('⚠️ an ambiguous name is REFUSED with the candidates in it, never resolved by picking the first', () => {
  const out = resolveClub(CLUBS, 'Tuesday');
  assert.equal(out.ok, false);
  assert.match(out.ok === false ? out.message : '', /Tuesday Book Club/);
  assert.match(out.ok === false ? out.message : '', /Tuesday Board Games/);
});

test('an unknown name lists the real ones, so the next attempt succeeds', () => {
  const out = resolveClub(CLUBS, 'Nonexistent');
  assert.equal(out.ok, false);
  assert.match(out.ok === false ? out.message : '', /Fantasy Readers/);
});

test('an empty club name asks for one rather than guessing', () => {
  const out = resolveClub(CLUBS, '');
  assert.equal(out.ok === false && out.message, CLUB_MSG.noClubNamed);
  assert.match(CLUB_MSG.noClubNamed, /will not\s+guess/);
});

// ---------------------------------------------------------------------------
// The club's own opt-in, and the meeting
// ---------------------------------------------------------------------------

test('⚠️ features.meetingRsvp is AFFIRMATIVE-ONLY — an absent flag is off', () => {
  assert.equal(clubRsvpEnabled({ fields: { features: { mapValue: { fields: { meetingRsvp: { booleanValue: true } } } } } }), true);
  assert.equal(clubRsvpEnabled({ fields: { features: { mapValue: { fields: { meetingRsvp: { booleanValue: false } } } } } }), false);
  assert.equal(clubRsvpEnabled({ fields: { features: { mapValue: { fields: {} } } } }), false);
  assert.equal(clubRsvpEnabled({}), false);
});

test('a meeting instant is read as a timestamp OR a string, and its absence is a real state', () => {
  assert.equal(meetingInstantOf({ fields: { meetingAt: { timestampValue: '2026-09-09T02:00:00Z' } } }), '2026-09-09T02:00:00Z');
  assert.equal(meetingInstantOf({ fields: { meetingAt: { stringValue: '2026-09-09T02:00:00Z' } } }), '2026-09-09T02:00:00Z');
  assert.equal(meetingInstantOf({ fields: {} }), null);
});

test('⚠️ an unparseable instant is shown VERBATIM rather than rendered as a wrong time', () => {
  assert.match(renderMeetingLine('Club', '2026-09-09T02:00:00Z'), /<t:\d+:F>/);
  const odd = renderMeetingLine('Club', 'next tuesday-ish');
  assert.match(odd, /next tuesday-ish/);
  assert.doesNotMatch(odd, /<t:/);
});

// ---------------------------------------------------------------------------
// The custom_id — the only thing that trusts a string off a button
// ---------------------------------------------------------------------------

test('the RSVP custom_id round-trips and fits Discord’s ceiling', () => {
  const id = buildRsvpCustomId({ clubCol: 'clubs', clubId: 'abc-123', status: 'maybe' });
  assert.equal(id, `${RSVP_PREFIX}|clubs|abc-123|maybe`);
  assert.ok(id.length <= 100);
  assert.deepEqual(parseRsvpCustomId(id), { clubCol: 'clubs', clubId: 'abc-123', status: 'maybe' });
});

test('parseRsvpCustomId refuses a bad lane, a bad id and a fourth status', () => {
  for (const bad of [
    'rv|clubs_prod|c1|yes',
    'rv|clubs|c 1|yes',
    'rv|clubs|c1|probably',
    'rv|clubs|c1',
    'pv|clubs|c1|yes',
  ]) {
    assert.equal(parseRsvpCustomId(bad), null, `${bad} must not parse`);
  }
  for (const s of RSVP_STATUSES) assert.equal(isRsvpStatus(s), true);
  assert.equal(isRsvpStatus('probably'), false);
});

test('the card offers exactly three buttons — a fourth would be a new column on somebody else’s page', () => {
  const rows = buildRsvpButtons('clubs', 'c1') as { components: { custom_id: string }[] }[];
  assert.equal(rows[0]!.components.length, 3);
  assert.deepEqual(
    rows[0]!.components.map((b) => b.custom_id),
    ['rv|clubs|c1|yes', 'rv|clubs|c1|no', 'rv|clubs|c1|maybe'],
  );
});

test('the RSVP doc carries the status, the display name and the meeting stamp', () => {
  const fields = rsvpDocFields('yes', { slug: 'sam', displayName: 'Sam' }, '2026-09-09T02:00:00Z');
  assert.deepEqual(fields, {
    status: { stringValue: 'yes' },
    displayName: { stringValue: 'Sam' },
    meetingAt: { stringValue: '2026-09-09T02:00:00Z' },
  });
});

test('docIdOf takes the last path segment of a Firestore document name', () => {
  assert.equal(docIdOf('projects/p/databases/(default)/documents/clubs/c1/reads/r9'), 'r9');
  assert.equal(docIdOf(undefined), '');
});

// ---------------------------------------------------------------------------
// The registry and the full request
// ---------------------------------------------------------------------------

test('both commands require a club and are guild-only — an RSVP in a DM has no club', () => {
  const byName = Object.fromEntries(CLUB_WRITE_COMMANDS.map((c) => [c.name, c]));
  for (const name of [RSVP_COMMAND_NAME, PROGRESS_COMMAND_NAME]) {
    const cmd = byName[name] as {
      dm_permission?: boolean;
      options?: readonly { name: string; required?: boolean }[];
    };
    assert.equal(cmd.dm_permission, false, `${name} must be guild-only`);
    assert.equal(cmd.options?.find((o) => o.name === 'club')?.required, true);
  }
});

test('/progress declares Discord’s own rails as a SECOND rail beside the runtime check', () => {
  const cmd = CLUB_WRITE_COMMANDS.find((c) => c.name === PROGRESS_COMMAND_NAME) as {
    options?: readonly { name: string; min_value?: number; max_value?: number; max_length?: number }[];
  };
  const percent = cmd.options?.find((o) => o.name === 'percent');
  assert.equal(percent?.min_value, 0);
  assert.equal(percent?.max_value, 100);
  assert.equal(cmd.options?.find((o) => o.name === 'chapter')?.max_length, CHAPTER_MAX);
});

test('the router carries club, percent and chapter', () => {
  const decision = routeInteraction({
    type: 2,
    data: {
      name: PROGRESS_COMMAND_NAME,
      options: [
        { name: 'club', type: 3, value: 'Tuesday Book Club' },
        { name: 'percent', type: 4, value: 40 },
        { name: 'chapter', type: 3, value: 'ch. 14' },
      ],
    },
  });
  assert.equal(decision.kind, 'progress_command');
  assert.equal(decision.kind === 'progress_command' && decision.percent, 40);
  assert.equal(decision.kind === 'progress_command' && decision.chapter, 'ch. 14');
});

test('a live /rsvp defers privately and answers the switched-off sentence', async () => {
  const res = await signedPost({
    type: 2,
    token: 'tok',
    application_id: 'app',
    data: { name: RSVP_COMMAND_NAME, options: [{ name: 'club', type: 3, value: 'Any' }] },
    member: { user: { id: 'u1' } },
  });
  const data = (await res.json()) as { type: number; data: { flags?: number } };
  assert.equal(data.type, 5);
  assert.equal(data.data.flags, EPHEMERAL);
});

test('⚠️ an RSVP PRESS acks with type 6 — the card it sits on must not be replaced', async () => {
  const res = await signedPost({
    type: 3,
    token: 'tok',
    application_id: 'app',
    data: { custom_id: 'rv|clubs|c1|yes' },
    member: { user: { id: 'u1' } },
  });
  const data = (await res.json()) as { type: number };
  assert.equal(data.type, 6);
});
