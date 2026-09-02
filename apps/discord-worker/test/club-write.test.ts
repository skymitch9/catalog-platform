/**
 * `/rsvp` and `/progress` — the dark pair.
 *
 * ⚠️ **THE MOST IMPORTANT TEST IN THIS FILE IS `while the posture is off,
 * NOTHING is written and NO network call is made`**, because the reason this
 * pair ships dark is not caution: the DOCUMENT SHAPES were inferred rather than
 * measured, and this Worker's service account bypasses `firestore.rules`, so a
 * wrongly shaped write would SUCCEED and fail silently on somebody else's page.
 * The posture is the thing standing between that and a live club, so it is
 * tested first and hardest.
 *
 * ⚠️ **AND THE POSTURE EARNED ITS KEEP ON 2026-09-02.** The shapes were finally
 * read off `audiobook_catalog/site` (read-only) and **four of the seven guesses
 * were wrong** — the RSVP field, its vocabulary, the instant's TYPE, and the
 * club's own meeting field. Every one of them would have been accepted and
 * stored, and counted by nothing. The corrected names are pinned below with
 * their evidence; the posture stays `off` because `/progress percent` still has
 * no destination field and that is an owner decision, not a constant.
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
  chapterIndexOf,
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
  PROGRESS_PERCENT_UNSUPPORTED,
  renderMeetingLine,
  resolveClub,
  RSVP_PREFIX,
  RSVP_STATUSES,
  rsvpDocFields,
  SITE_RSVP_RESPONSE,
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

// ⚠️ THE PIN, AND IT HAS NOW DONE ITS JOB ONCE. It held the INFERRED names
// still so that verifying them would be one diff rather than a hunt. They were
// read off audiobook_catalog/site on 2026-09-02 and FOUR of them were wrong;
// this is the measured set, with the evidence in CLUB_WRITE_SHAPES' own
// docblock. It stays pinned for the same reason: these are persisted keys on
// somebody else's page, and a change to one is a migration, not an edit.
test('⚠️ CLUB_WRITE_SHAPES is pinned to the MEASURED names (2026-09-02)', () => {
  assert.deepEqual(CLUB_WRITE_SHAPES, {
    rsvpCollection: 'rsvps',
    rsvpStatusField: 'response',
    rsvpMeetingField: 'meetingAt',
    clubMeetingField: 'nextMeetingAt',
    progressCollection: 'progress',
    progressMilestoneField: 'milestonePosition',
    progressChapterField: 'chapterIndex',
    progressFinishedField: 'finished',
    progressHistoryField: 'history',
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
  // ⚠️ AND AN IN-RANGE ONE IS REFUSED TOO SINCE 2026-09-02, for a different
  // reason and with a different sentence: the range was never the problem —
  // there is no percentage field on the club page at all. The range check stays
  // FIRST so "40.5 is not a whole number" is still answered as itself rather
  // than as "percentages are not supported", which are two different fixes.
  for (const inRange of [0, 40, 100]) {
    const out = validateProgress(inRange, '');
    assert.equal(out.ok, false, `${inRange} has nowhere to go`);
    assert.equal(out.ok === false && out.message, PROGRESS_PERCENT_UNSUPPORTED);
  }
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

// ⚠️ MEASURED 2026-09-02 against audiobook_catalog/site/club-reads.js:1007-1012
// and firestore.rules:1143 — the club page stores `chapterIndex`, a NUMBER,
// and there is NO percentage field anywhere in it. The old shape wrote
// `percent` and a prose `chapter`; this Worker's service account bypasses
// firestore.rules, so both would have been ACCEPTED, stored, and read by
// nothing, on somebody else's page.
test('⚠️ the progress doc carries chapterIndex as a NUMBER — the measured field', () => {
  const actor = { slug: 'sam', displayName: 'Sam' };
  const fields = progressDocFields({ chapterIndex: 14 }, actor, '2026-09-02T00:00:00.000Z');
  assert.deepEqual(fields, {
    chapterIndex: { integerValue: '14' },
    displayName: { stringValue: 'Sam' },
    updatedAt: { timestampValue: '2026-09-02T00:00:00.000Z' },
  });
  // ⚠️ `history` is the site's pace-graph array, appended with a
  // read-modify-write. This Worker must never write it — the PATCH updateMask
  // is what leaves it alone.
  assert.equal('history' in fields, false);
  assert.equal('percent' in fields, false, 'there is no such field on the club page');
});

test('⚠️ a chapter LABEL becomes an INDEX, and a label with no number is refused', () => {
  assert.equal(chapterIndexOf('ch. 14'), 14);
  assert.equal(chapterIndexOf('14'), 14);
  assert.equal(chapterIndexOf('Chapter 3 — the duel'), 3);
  assert.equal(chapterIndexOf('about halfway'), null);
  const refused = validateProgress(undefined, 'about halfway');
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.message, /chapter NUMBER/);
});

test('⚠️ a PERCENTAGE is refused in words — it has nowhere to go', () => {
  // Rejected, never stripped: this file's own rule, applied to the field that
  // turned out not to exist.
  const out = validateProgress(40, '');
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.message, PROGRESS_PERCENT_UNSUPPORTED);
    assert.match(out.message, /nothing was recorded/i);
    assert.match(out.message, /chapter/i, 'a refusal must say how to get what they wanted');
  }
  // ⚠️ And a percentage BESIDE a usable chapter is fine — the chapter is what
  // gets written, so nothing is lost and nothing is invented.
  const both = validateProgress(40, 'ch. 14');
  assert.equal(both.ok, true);
  if (both.ok) assert.equal(both.chapterIndex, 14);
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

// ⚠️ MEASURED 2026-09-02: the club document's field is `nextMeetingAt`, not
// `meetingAt`, and it is a NUMBER (site/clubs.js:565 validates
// Number.isFinite; firestore.rules:456 lists it). Reading the old name returned
// null for every real club, which would have made /rsvp answer "no meeting
// scheduled" for ever.
const MEETING = Date.parse('2026-09-09T02:00:00Z');

test('⚠️ the meeting instant is read from nextMeetingAt, as EPOCH MILLISECONDS', () => {
  assert.equal(meetingInstantOf({ fields: { nextMeetingAt: { integerValue: String(MEETING) } } }), MEETING);
  assert.equal(meetingInstantOf({ fields: { nextMeetingAt: { doubleValue: MEETING } } }), MEETING);
  // Older stored forms still read, and are NORMALISED to the number — because
  // the site compares `rsvp.meetingAt === club.nextMeetingAt` with ===, and a
  // string never equals a number.
  assert.equal(meetingInstantOf({ fields: { nextMeetingAt: { timestampValue: '2026-09-09T02:00:00Z' } } }), MEETING);
  assert.equal(meetingInstantOf({ fields: { nextMeetingAt: { stringValue: '2026-09-09T02:00:00Z' } } }), MEETING);
  // ⚠️ The OLD guessed name now reads as no meeting, which is the honest
  // state: this Worker has never written one and the site does not keep one
  // there.
  assert.equal(meetingInstantOf({ fields: { meetingAt: { integerValue: String(MEETING) } } }), null);
  assert.equal(meetingInstantOf({ fields: {} }), null);
});

test('⚠️ an unreadable instant is never rendered as a wrong time', () => {
  assert.match(renderMeetingLine('Club', MEETING), /<t:\d+:F>/);
  const odd = renderMeetingLine('Club', Number.NaN);
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

// ⚠️ MEASURED 2026-09-02 against site/club-reads.js:1961-1966 and
// firestore.rules:626-629. Three of the four guesses in this document were
// wrong, and every one of them would have SUCCEEDED — the service account
// bypasses firestore.rules.
test('⚠️ the RSVP doc is written in the SITE vocabulary and the SITE types', () => {
  const fields = rsvpDocFields('yes', { slug: 'sam', displayName: 'Sam' }, MEETING);
  assert.deepEqual(fields, {
    // `response`, not `status`; `going`, not `yes`.
    response: { stringValue: 'going' },
    displayName: { stringValue: 'Sam' },
    // ⚠️ A NUMBER. Every reader filters `rsvp.meetingAt === club.nextMeetingAt`,
    // so a string would store fine and be counted by nothing, for ever.
    meetingAt: { integerValue: String(MEETING) },
  });
});

test('⚠️ our three words map onto the site three, and onto nothing else', () => {
  // The person-facing vocabulary stays what a person would pick off a button;
  // the translation lives at the write boundary and nowhere else.
  assert.deepEqual(SITE_RSVP_RESPONSE, { yes: 'going', no: 'cant', maybe: 'maybe' });
  for (const s of RSVP_STATUSES) {
    assert.ok(['going', 'maybe', 'cant'].includes(SITE_RSVP_RESPONSE[s]), s);
  }
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
