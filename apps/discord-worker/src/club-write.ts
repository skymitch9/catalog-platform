/**
 * `/rsvp` and `/progress` — the two per-member club writes from Discord
 * (design §2d and §2e), built to `poll-vote.ts`'s shape exactly.
 *
 * ⚠️ **THEY SHIPPED OFF BEHIND `GABI_CLUB_WRITES`, AND THE POSTURE WAS FLIPPED
 * ON 2026-09-05.** Read the next two sections before touching anything here: the
 * switch is what protected a live club page for three days, and the only reason
 * it is safe to have moved is that both halves it was protecting against — an
 * unmeasured shape and an input with no destination — were closed first.
 *
 * ## ⚠️ THE SHAPES ARE NOW MEASURED — AND FOUR OF THE SEVEN GUESSES WERE WRONG
 *
 * This shipped dark because the shapes were inferred: the build that wrote it
 * was directed not to read the `bookbuddy` repos, and its own header said the
 * field names were **NOT MEASURED**. They were read on **2026-09-02**, from
 * `audiobook_catalog/site/club-reads.js`, `site/clubs.js` and `firestore.rules`
 * (read-only; nothing in that repo was touched). The corrections are in
 * `CLUB_WRITE_SHAPES` below with per-line evidence. The three that matter:
 *
 *  1. the RSVP answer lives in **`response`**, not `status`, and its values are
 *     **`going` / `maybe` / `cant`**, not `yes` / `no` / `maybe`;
 *  2. **`meetingAt` is a NUMBER** and the club's own field is **`nextMeetingAt`**,
 *     also a number — and every reader compares them with `===`, so a string
 *     would have produced an RSVP that stored fine and was counted by nothing;
 *  3. **`percent` does not exist.** The page tracks `milestonePosition` or
 *     `chapterIndex`, both numbers.
 *
 * ⚠️ **This Worker's service account BYPASSES `firestore.rules`.** So none of
 * those would have been refused — they would have **succeeded**, and the club
 * page would have shown a member who had not RSVP'd and a progress bar that
 * never moved, with no error anywhere. That failure is silent, it is on somebody
 * else's surface, and it looks exactly like a bug in their code. The old header
 * predicted this exactly; the measurement found it in four places.
 *
 * ## ✅ THE LAST BLOCKER WAS AN OWNER DECISION, AND HE ANSWERED IT (2026-09-05)
 *
 * `/progress percent` had **no destination field**. Correcting a constant could
 * not fix that, because a percentage is not a milestone index and not a chapter
 * number: converting one to the other would be inventing a value.
 *
 * ⚠️ **Owner decision, 2026-09-05: option (a) — `/progress` DROPS `percent` and
 * takes a CHAPTER only.** (The alternative, (b), was to also learn
 * `milestonePosition`, which needs the read's milestone list to mean anything
 * and is the larger build.) So:
 *
 *  - `commands.ts` no longer declares a `percent` option, and `chapter` is now
 *    REQUIRED — it is the only thing this command records;
 *  - a chapter LABEL becomes the `chapterIndex` NUMBER the club page reads
 *    (`"ch. 14"` → `14`), and a label with no number in it is refused in words;
 *  - ⚠️ **the `percent` REFUSAL PATH STAYS**, because dropping the option is a
 *    command re-registration and a global command's old shape can linger in a
 *    Discord client for up to an hour. A person who still has the old form gets
 *    `PROGRESS_PERCENT_UNSUPPORTED` — a sentence saying what to type instead —
 *    never a bare error and never a write into a document nothing reads.
 *
 * `docs/access/discord-bot.md` §15.3 carries the flip checklist. ⚠️ It has NO
 * shadow rung: `clubWritesOn` is affirmative-only `"on"`, there is no third
 * value, and a "shadow" club write is a contradiction — the whole risk is the
 * WRITE, so a mode that wrote-but-pretended would be the very thing being
 * guarded against. Off → on, with the two halves above closed first.
 *
 * ## What IS enforced, and is not affected by any of the above
 *
 * The Worker bypasses rules, so — exactly as `poll-vote.ts` does — it
 * re-enforces server-side what a browser would be held to:
 *
 *  1. **Identity.** `discord_links/{discordUserId}` or a worded refusal. Never a
 *     name-matching guess; the pseudo-member fallback is deliberately not built.
 *  2. **The club's own opt-in.** `features.meetingRsvp` for `/rsvp` — the club
 *     feature key `apps/audiobook-worker/src/enforce-routes.ts:126` already
 *     names, so this honours a switch that exists rather than inventing one.
 *  3. **The club exists, and the read is real.** A 404 is answered as a 404, in
 *     words.
 *  4. **The input is REJECTED, never stripped.** A percentage outside 0–100, an
 *     unknown RSVP status, an over-long chapter label: each gets its own
 *     sentence naming what it needed.
 */

import { firestoreRequest, mintAccessToken, type ServiceAccount } from './firebase-sa.js';
import { editOriginalMessage, followupEphemeral } from './discord-api.js';
import { isSafeSlug, slugPathSegment } from './slug.js';
import { CLUB_COLLECTIONS, type ClubCollection } from './poll-vote.js';
import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// ⚠️ THE FOUR UNVERIFIED CONSTANTS — isolated here on purpose
// ---------------------------------------------------------------------------

/**
 * ⚠️ **MEASURED 2026-09-02 — AND FOUR OF THE SEVEN GUESSES WERE WRONG.**
 *
 * They were inferred when this shipped, gathered here so verifying them would be
 * one diff rather than a hunt. They have now been read off the audiobook site
 * itself (read-only; nothing in that repo was changed):
 *
 * | what | the guess | ⚠️ the MEASURED truth | evidence |
 * |---|---|---|---|
 * | RSVP collection | `rsvps` | ✅ `rsvps`, doc id = member slug | `site/club-reads.js:1961` |
 * | RSVP answer field | `status` | 🔴 **`response`** | `site/club-reads.js:1961-1966`, `firestore.rules:626` |
 * | RSVP answer VALUES | `yes`/`no`/`maybe` | 🔴 **`going`/`maybe`/`cant`** | `RSVP_RESPONSES`, `site/club-reads.js:1895` |
 * | RSVP `meetingAt` | a string/timestamp | 🔴 **a NUMBER** (epoch ms) | `firestore.rules:628`, `isRsvpCurrent` |
 * | club's meeting field | `meetingAt` | 🔴 **`nextMeetingAt`**, also a number | `site/clubs.js:263,565`, `firestore.rules:456` |
 * | progress collection | `progress` | ✅ `clubs/{id}/reads/{readId}/progress/{slug}` | `site/club-reads.js:971` |
 * | progress fields | `percent`, `chapter` | 🔴 **`milestonePosition`** or **`chapterIndex`**, both NUMBERS, plus `finished` (bool) and `history` (array) | `site/club-reads.js:976-981, 1007-1012`; `firestore.rules:1143` |
 * | `displayName` / `updatedAt` | both | ✅ both, on both documents | `site/club-reads.js:1962, 1975` |
 *
 * ⚠️ **THE `meetingAt` ONE IS THE SILENT KILLER, and it is worth reading twice.**
 * Every reader on the site filters RSVPs with `rsvp.meetingAt === club.nextMeetingAt`
 * (`isRsvpCurrent`) to drop answers to a rescheduled meeting. A string `meetingAt`
 * never equals a number, so an RSVP written in the old shape would be accepted by
 * Firestore, stored, and then **filtered out of every tally for ever** — a write
 * that succeeds and shows nothing. Exactly the failure this file's header
 * predicted, arriving through the field it did not name.
 *
 * ⚠️ **`percent` HAS NO DESTINATION AT ALL.** The site tracks a milestone
 * POSITION or a chapter INDEX, both numbers; there is no percentage anywhere in
 * the club page, and `firestore.rules` requires one of those two to be a number
 * before it will accept a browser write. This Worker's service account bypasses
 * rules, so the old shape would have written `percent: 40` into a document
 * nothing reads and reported success. See `PROGRESS_PERCENT_UNSUPPORTED`.
 */
export const CLUB_WRITE_SHAPES = {
  /** Where a club's RSVPs live, relative to the club document. Doc id = slug. */
  rsvpCollection: 'rsvps',
  /** ⚠️ `response`, not `status` — and its values are the site's, not ours. */
  rsvpStatusField: 'response',
  /** ⚠️ A NUMBER (epoch ms) that must EQUAL the club's `nextMeetingAt`, or every
   *  reader treats the answer as stale and it is never counted. */
  rsvpMeetingField: 'meetingAt',
  /** ⚠️ The club document field naming the next meeting instant — `nextMeetingAt`,
   *  an epoch-ms number (`site/clubs.js:565` validates `Number.isFinite`). */
  clubMeetingField: 'nextMeetingAt',
  /** The reads subcollection, and the two fields a member's progress may carry.
   *  ⚠️ Both are NUMBERS and `firestore.rules:1143` accepts a write only when one
   *  of them is. */
  progressCollection: 'progress',
  progressMilestoneField: 'milestonePosition',
  progressChapterField: 'chapterIndex',
  /** Carried on a progress doc beside the position. Not written by this Worker
   *  today — `/progress` has no "I finished it" input — but named so a reader
   *  can see the document's real shape rather than a subset of it. */
  progressFinishedField: 'finished',
  /** ⚠️ The pace-graph history the site appends to with a read-modify-write.
   *  This Worker must NEVER write it, and its PATCH `updateMask` is what makes
   *  that safe: a field not named in the mask is left exactly as it was. */
  progressHistoryField: 'history',
  /** Carried on both, matching every other per-member club doc in this Worker
   *  (`voteDocFields` writes exactly this pair). */
  displayNameField: 'displayName',
  updatedAtField: 'updatedAt',
} as const;

/**
 * ⚠️ **THE FROZEN RECORD OF WHAT WAS ACTUALLY READ, on the day it was read.**
 *
 * `CLUB_WRITE_SHAPES` above is the LIVE constant every write is built from. This
 * is a second, deliberately separate copy: the names as they were **measured**
 * on 2026-09-02, off the sources named below. They are not redundant — one is
 * what the code does, the other is what somebody verified, and
 * `clubWriteShapesVerified()` is the claim that the two still agree.
 *
 * ⚠️ **Editing `CLUB_WRITE_SHAPES` without editing this drops
 * `club_write_shapes_verified` to `false` in `/api/health`, which is the point.**
 * A field name on somebody else's page is a persisted key: changing one is a
 * migration, not an edit, and the health row should stop claiming "verified" the
 * moment the code stops matching the measurement. Re-measure, then move both.
 */
export const CLUB_WRITE_SHAPES_MEASUREMENT = {
  /** ⚠️ A promise about MEASUREMENT, not a save date. */
  measuredOn: '2026-09-02',
  sources: [
    'audiobook_catalog/site/club-reads.js',
    'audiobook_catalog/site/clubs.js',
    'audiobook_catalog/firestore.rules',
  ],
  shapes: {
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
  },
} as const;

/**
 * ⚠️ Every option `/progress` may publish, and the ONLY ones with a measured
 * destination: `club` picks the document's path, `chapter` becomes
 * `chapterIndex`. ⚠️ **`percent` is deliberately absent** — that is what made
 * the command incoherent until 2026-09-05, and listing it here would let the
 * health flag call a percentage "verified".
 */
export const PROGRESS_OPTIONS_WITH_A_DESTINATION = ['club', 'chapter'] as const;

/**
 * ⚠️ **`club_write_shapes_verified` in `/api/health`, DERIVED rather than
 * asserted** — it was a hard-coded `false` from 2026-09-02 to 2026-09-05.
 *
 * It answers ONE question honestly: *does every club write this Worker can make
 * land in a field somebody actually measured?* That needs two things, and it is
 * `false` unless both hold:
 *
 *  1. **the shapes still match the measurement** — `CLUB_WRITE_SHAPES` is
 *     compared, key by key, against `CLUB_WRITE_SHAPES_MEASUREMENT.shapes`, the
 *     frozen record of the 2026-09-02 read. This is exactly the assertion
 *     `test/club-write.test.ts`'s pin makes, evaluated at runtime instead of in
 *     CI, so an edited constant turns the row off in the deployed Worker and not
 *     only on a test runner;
 *  2. **every option the command publishes has one of those fields to land in**
 *     — the half that was missing. From 2026-09-02 the shapes were right and the
 *     row was still `false` **on purpose**, because `/progress percent` had
 *     nowhere to go and one flag claiming both would have been a half-truth. The
 *     owner's 2026-09-05 decision removed the option; passing the command's own
 *     option list in is what makes the row notice if it ever comes back.
 *
 * ⚠️ It is NOT a claim that anything has been written to a real club — that is
 * the checklist's step 7, which only a person looking at the club PAGE can
 * close.
 */
export function clubWriteShapesVerified(progressOptionNames: readonly string[]): boolean {
  const measured: Record<string, string> = CLUB_WRITE_SHAPES_MEASUREMENT.shapes;
  const live: Record<string, string> = CLUB_WRITE_SHAPES;
  const measuredKeys = Object.keys(measured);
  if (Object.keys(live).length !== measuredKeys.length) return false;
  for (const key of measuredKeys) {
    if (live[key] !== measured[key]) return false;
  }
  const allowed = PROGRESS_OPTIONS_WITH_A_DESTINATION as readonly string[];
  return progressOptionNames.every((name) => allowed.includes(name));
}

/**
 * ⚠️ **OUR WORD → THEIRS, at the write boundary and nowhere else.**
 *
 * The site's vocabulary is `going` / `maybe` / `cant` (`RSVP_RESPONSES`,
 * `site/club-reads.js:1895`) and Discord's is `yes` / `no` / `maybe` — the words
 * a person actually picks off a button. Mapping here rather than renaming the
 * command keeps the person-facing vocabulary the one a person would choose,
 * keeps every existing button `custom_id` valid, and puts the translation in the
 * one place a reader checking the wire shape will look.
 */
export const SITE_RSVP_RESPONSE: Record<RsvpStatus, 'going' | 'maybe' | 'cant'> = {
  yes: 'going',
  no: 'cant',
  maybe: 'maybe',
};

/** ⚠️ Affirmative-only `"on"`, the exact idiom of `MODERATION_ENABLED`,
 * `GABI_MENTIONS`, `GABI_DELEGATED_WRITES` and `GABI_CONFIRM_T2`: `"on"` and
 * nothing else; absent, empty, `"true"`, `"1"`, `"yes"` and every typo mean
 * OFF. */
export function clubWritesOn(env: Pick<Env, 'GABI_CLUB_WRITES'>): boolean {
  return (env.GABI_CLUB_WRITES ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The RSVP button's routing key: `rv|<clubCol>|<clubId>|<status>`
// ---------------------------------------------------------------------------

export const RSVP_PREFIX = 'rv';

/** The only three answers. ⚠️ A fourth would be a new column on somebody
 * else's page. */
export const RSVP_STATUSES = ['yes', 'no', 'maybe'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export function isRsvpStatus(v: string): v is RsvpStatus {
  return (RSVP_STATUSES as readonly string[]).includes(v);
}

/** Firestore auto-ids and nothing else — `poll-vote.ts`'s `SAFE_ID`, and the
 * same reasoning: a member SLUG goes through `isSafeSlug` instead, because
 * almost every real slug contains a space. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface RsvpRef {
  clubCol: ClubCollection;
  clubId: string;
  status: RsvpStatus;
}

export function buildRsvpCustomId(ref: RsvpRef): string {
  return [RSVP_PREFIX, ref.clubCol, ref.clubId, ref.status].join('|');
}

/** Strict parse — null on anything that is not exactly the shape above. */
export function parseRsvpCustomId(customId: string): RsvpRef | null {
  const parts = customId.split('|');
  if (parts.length !== 4) return null;
  const [prefix, clubCol, clubId, status] = parts as [string, string, string, string];
  if (prefix !== RSVP_PREFIX) return null;
  if (!(CLUB_COLLECTIONS as readonly string[]).includes(clubCol)) return null;
  if (!SAFE_ID.test(clubId)) return null;
  if (!isRsvpStatus(status)) return null;
  return { clubCol: clubCol as ClubCollection, clubId, status };
}

// ---------------------------------------------------------------------------
// Input rails — REJECT, never strip
// ---------------------------------------------------------------------------

/** A chapter label is a person's own words about where they are ("ch. 14",
 * "part two"). ⚠️ Capped and REFUSED past the cap rather than truncated: a
 * silently shortened label is a claim they did not make. */
export const CHAPTER_MAX = 60;

export type ProgressInput =
  /** ⚠️ `chapterIndex` is REQUIRED on the ok branch since 2026-09-02: it is the
   *  only thing the club page can actually store, so a validated input that
   *  does not carry one is a validated input with nowhere to go. `chapter` rides
   *  along only so the confirmation can quote the person's own words back. */
  | { ok: true; chapterIndex: number; chapter?: string }
  | { ok: false; message: string };

/**
 * ⚠️ **A CHAPTER, AND NOTHING ELSE — owner decision 2026-09-05.** A `/progress`
 * with no chapter is a person asking to record nothing, and answering "done" to
 * it would be a lie with a tick beside it. Discord now refuses that case itself
 * (`chapter` is a required option); this is the second rail, for the stale
 * global command and the hand-crafted interaction.
 *
 * ⚠️ `legacyPercent` is what a client with the OLD command shape may still send.
 * It is never written and never converted — it is answered in words. **There is
 * no range check on it any more, and its absence is deliberate:** while the
 * option existed, "40.5 is not a whole number" and "percentages have nowhere to
 * go" were two different fixes and deserved two different sentences. Now that
 * the option is gone, EVERY percentage has the same one answer, and telling
 * somebody their number was out of range would imply an in-range one would work.
 */
export function validateProgress(
  legacyPercent: number | undefined,
  chapter: string,
): ProgressInput {
  const label = (chapter ?? '').trim();
  if (legacyPercent === undefined && label.length === 0) {
    return { ok: false, message: CLUB_MSG.progressNothing };
  }
  if (label.length > CHAPTER_MAX) {
    return { ok: false, message: CLUB_MSG.progressChapter(CHAPTER_MAX) };
  }
  // ⚠️ **THE INPUT IS REJECTED, NEVER STRIPPED** — this file's own rule, applied
  // to what the 2026-09-02 measurement found. A chapter label with no number in
  // it cannot become a `chapterIndex`, and a percentage has no field on the club
  // page at all. Both were previously written into the document anyway, and
  // because this Worker's service account BYPASSES `firestore.rules` they would
  // have been accepted, stored, and read by nothing.
  //
  // ⚠️ A chapter BESIDE a stale percentage is still fine: the chapter is what
  // gets written, so nothing is lost and nothing is invented.
  const index = label ? chapterIndexOf(label) : null;
  if (label && index === null) {
    return { ok: false, message: CLUB_MSG.progressChapterNumber };
  }
  if (index === null) {
    return { ok: false, message: PROGRESS_PERCENT_UNSUPPORTED };
  }
  return { ok: true, chapterIndex: index, ...(label ? { chapter: label } : {}) };
}

/**
 * ⚠️ **A PERCENTAGE HAS NOWHERE TO GO, and saying so is the whole of the fix.**
 *
 * Measured 2026-09-02: the club page tracks a milestone POSITION or a chapter
 * INDEX, both numbers, and `firestore.rules:1143` will not accept a browser
 * write without one of them. There is no percentage field anywhere in it. The
 * old code wrote `percent` regardless — and because this Worker bypasses rules,
 * that write would have SUCCEEDED and shown nothing, on somebody else's page,
 * looking exactly like a bug in their code.
 *
 * ⚠️ Worded for the person, per the estate's no-bare-status rule: what happened,
 * what it needs, and how to get it — and never a hint that they did something
 * wrong. ⚠️ **The option was REMOVED from the command on 2026-09-05** (owner
 * decision (a)), so nobody should meet this sentence any more — but a global
 * command's old shape can sit in a Discord client for up to an hour after the
 * re-registration, and this is what those people get instead of a bare failure.
 * ⚠️ **Do not delete it when the hour is up.** A stale client is not the only
 * way in: a hand-crafted interaction can carry any option it likes, and this is
 * the sentence standing between that and a `percent` field nothing reads.
 */
export const PROGRESS_PERCENT_UNSUPPORTED =
  'The club page tracks progress by CHAPTER, not by percentage — so a percentage has nowhere to go ' +
  'and nothing was recorded. Tell GABI the chapter instead (`chapter:ch. 14`) and it will land ' +
  'exactly where the club page reads it. (If Discord still offers you a `percent` box, it is showing ' +
  'you an old copy of the command — it will catch up on its own within the hour.)';

// ---------------------------------------------------------------------------
// The words — every refusal says what happened, what it needs, and how to fix it
// ---------------------------------------------------------------------------

export const CLUB_MSG = {
  /** ⚠️ A SWITCH, not a permission, and it says so — the estate's four causes
   *  stay distinct because their fixes differ. */
  switchedOff:
    'Recording club RSVPs and reading progress from Discord is not switched on yet — that is a ' +
    'lever on the estate side, not anything to do with your account, and nothing was recorded. ' +
    'The club page takes both right now, exactly as it always has.',
  notConfigured:
    'GABI is not wired up to reach the club records yet — that is a setup step on our side, not a ' +
    'permissions problem. Nothing was recorded; the club page still works.',
  unlinked:
    "Your Discord account isn't linked to a club member, so nothing was recorded. GABI never " +
    'guesses who somebody is from a username — run **/link** once (about twenty seconds, and you ' +
    'can unlink whenever you like), or use the club page instead.',
  linkIncomplete:
    'Your link was made before GABI could read your estate profile, so she has no member name to ' +
    'file this under and nothing was recorded. Re-run **/link** once and try again.',
  noClubNamed:
    'Name which club this is for — `/rsvp club:<name>` or `/progress club:<name>`. GABI will not ' +
    'guess when you are in more than one, because filing your progress against the wrong book is ' +
    'worse than asking.',
  clubNotFound: (asked: string, known: string[]) =>
    `GABI could not find a club called **${asked}**. ` +
    (known.length > 0
      ? `The ones she can see are: ${known.map((n) => `**${n}**`).join(', ')}.`
      : 'She could not list any clubs either, which is more likely a wobble on our side than an ' +
        'empty estate — try again in a minute.'),
  clubAmbiguous: (asked: string, matches: string[]) =>
    `**${asked}** matches more than one club (${matches.map((n) => `**${n}**`).join(', ')}), so ` +
    'GABI did not guess. Type more of the name and she will find the right one.',
  rsvpOff:
    "RSVPs from Discord aren't switched on for this club, so nothing was recorded. A club manager " +
    "can enable them in the club's settings — until then, RSVP on the club page.",
  noMeeting:
    'This club has no meeting scheduled at the moment, so there is nothing to RSVP to yet. Nothing ' +
    'was recorded — GABI will have something to answer once a manager schedules one.',
  noActiveRead:
    'This club has no active read at the moment, so there is nowhere to file your progress. Nothing ' +
    'was recorded.',
  /** ⚠️ Chapter-only since the owner's 2026-09-05 decision. Discord asks for it
   *  as a required option now, so this answers the stale command and the
   *  hand-crafted interaction rather than an ordinary mistake. */
  progressNothing:
    'Tell GABI which chapter you are on — `chapter:ch. 14`, or just `chapter:14`. Nothing was ' +
    'recorded, because there was nothing to record.',
  /** ⚠️ Measured 2026-09-02: the club page stores `chapterIndex`, a NUMBER. A
   *  label with no number in it cannot become one, and this Worker bypasses
   *  `firestore.rules`, so writing the prose anyway would succeed and be read by
   *  nothing. Rejected, never stripped — the rule this file already keeps. */
  progressChapterNumber:
    'GABI needs a chapter NUMBER to file this against — the club page tracks which chapter you are ' +
    "on, so “ch. 14” or just “14” lands, and a label with no number in it has nowhere to go. " +
    'Nothing was recorded.',
  progressChapter: (max: number) =>
    `That chapter label is longer than ${max} characters, so nothing was recorded. GABI will not ` +
    'shorten it for you — a trimmed label is a claim you did not make. Send a shorter one.',
  rsvpDone: (status: RsvpStatus, club: string) =>
    status === 'yes'
      ? `✅ You're down as **coming** to **${club}**'s next meeting. Change it any time — here or on ` +
        'the club page, they are the same record.'
      : status === 'no'
        ? `✅ You're down as **not coming** to **${club}**'s next meeting. Change it any time — here ` +
          'or on the club page, they are the same record.'
        : `✅ You're down as a **maybe** for **${club}**'s next meeting. Change it any time — here or ` +
          'on the club page, they are the same record.',
  /** ⚠️ Quotes the person's OWN label when they gave one and falls back to the
   *  number that was actually stored — never a percentage, which is not a thing
   *  the club page has (measured 2026-09-02). */
  progressDone: (club: string, chapterIndex: number, chapter?: string) => {
    const bits: string[] = [chapter ? `**${chapter}**` : `**chapter ${chapterIndex}**`];
    return (
      `✅ Recorded on **${club}**'s current read: ${bits.join(' · ')}. It shows on the club page ` +
      'alongside everybody else\'s — the same record, reached from two places.'
    );
  },
  outage:
    "Something went wrong on the estate's side (a service problem, NOT a permissions one) and " +
    'nothing was recorded. Try again in a minute, or use the club page.',
} as const;

// ---------------------------------------------------------------------------
// Firestore shapes read here
// ---------------------------------------------------------------------------

type FsValue = {
  stringValue?: string;
  integerValue?: string | number;
  /** ⚠️ Firestore's REST encoding for a JS number that is not an integer — and
   *  `nextMeetingAt` arrives as whichever of the two the writer produced. */
  doubleValue?: string | number;
  booleanValue?: boolean;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, FsValue> };
};
type FsDoc = { name?: string; fields?: Record<string, FsValue> };

const fsString = (v: FsValue | undefined): string | null =>
  typeof v?.stringValue === 'string' ? v.stringValue : null;

/**
 * ⚠️ **THE MEETING INSTANT IS A NUMBER — measured 2026-09-02, and it decides
 * whether an RSVP is ever counted.**
 *
 * `site/clubs.js:565` validates `nextMeetingAt` with `Number.isFinite` and
 * `firestore.rules:628` requires `meetingAt is number` on the RSVP. Every reader
 * then filters `rsvp.meetingAt === club.nextMeetingAt` — a strict equality, in
 * JavaScript, so a string never matches. Writing the instant in any other form
 * produces an RSVP that is stored, accepted, and silently absent from every
 * tally.
 *
 * The timestamp and ISO-string branches are kept because reading them costs
 * nothing and a club created by some older path may still carry one — but the
 * value returned is always **epoch milliseconds**, because that is what the
 * comparison on the other side is made of. `null` means "no meeting scheduled",
 * which is a real and common state.
 */
export function meetingInstantOf(doc: FsDoc): number | null {
  const v = doc.fields?.[CLUB_WRITE_SHAPES.clubMeetingField];
  const numeric = v?.integerValue ?? v?.doubleValue;
  if (numeric !== undefined && numeric !== null) {
    const n = Number(numeric);
    return Number.isFinite(n) ? n : null;
  }
  const raw = typeof v?.timestampValue === 'string' ? v.timestampValue : fsString(v);
  if (!raw || !raw.trim()) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** club doc → is `features.meetingRsvp` affirmatively true? ⚠️ Affirmative
 * only: an absent flag is OFF, which is the same default `discordPollVoting`
 * keeps. */
export function clubRsvpEnabled(doc: FsDoc): boolean {
  return doc.fields?.features?.mapValue?.fields?.meetingRsvp?.booleanValue === true;
}

export interface ClubSummary {
  id: string;
  name: string;
}

/** The last path segment of a Firestore document name. */
export function docIdOf(name: string | undefined): string {
  const parts = (name ?? '').split('/');
  return parts[parts.length - 1] ?? '';
}

/**
 * Which club did they mean?
 *
 * ⚠️ **EXACT NAME FIRST, THEN A UNIQUE PREFIX, AND AMBIGUITY IS REFUSED** —
 * never resolved by picking the first. Design §2e names club resolution as the
 * size driver of this feature, and its own recommendation is *"a required
 * command argument, or an explicit error if the server maps to more than one
 * club"*. This is that error, with the candidate names in it so the next
 * attempt succeeds.
 */
export type ClubResolution =
  | { ok: true; club: ClubSummary }
  | { ok: false; message: string };

export function resolveClub(clubs: readonly ClubSummary[], asked: string): ClubResolution {
  const wanted = (asked ?? '').trim().toLowerCase();
  if (!wanted) return { ok: false, message: CLUB_MSG.noClubNamed };
  const exact = clubs.filter((c) => c.name.trim().toLowerCase() === wanted);
  if (exact.length === 1) return { ok: true, club: exact[0] as ClubSummary };
  if (exact.length > 1) {
    return { ok: false, message: CLUB_MSG.clubAmbiguous(asked, exact.map((c) => c.name)) };
  }
  const partial = clubs.filter((c) => c.name.trim().toLowerCase().includes(wanted));
  if (partial.length === 1) return { ok: true, club: partial[0] as ClubSummary };
  if (partial.length > 1) {
    return { ok: false, message: CLUB_MSG.clubAmbiguous(asked, partial.map((c) => c.name)) };
  }
  return { ok: false, message: CLUB_MSG.clubNotFound(asked, clubs.map((c) => c.name)) };
}

// ---------------------------------------------------------------------------
// The deferred flows
// ---------------------------------------------------------------------------

/** ⚠️ PRODUCTION LANE ONLY. `clubs_dev` exists in rules and is reachable by the
 * poll path's custom ids, but this Worker is the production surface (the same
 * decision `shelf-exec.ts` records for `reviews_dev`), so a command resolves
 * clubs from `clubs` and nothing else. */
export const CLUB_COLLECTION: ClubCollection = 'clubs';

export interface ClubWriteDeps {
  sa: ServiceAccount;
  accessToken: string;
}

/** Every club the estate has, id and name. Pages until exhausted — a household
 * has a handful, and a silent cap would make a club unreachable by name. */
export async function listClubs(deps: ClubWriteDeps): Promise<ClubSummary[]> {
  const out: ClubSummary[] = [];
  let pageToken: string | undefined;
  do {
    const query = `pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await firestoreRequest(deps.sa, deps.accessToken, 'GET', `${CLUB_COLLECTION}?${query}`);
    if (!res.ok) throw new Error(`club list failed (${res.status})`);
    const data = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    for (const doc of data.documents ?? []) {
      const id = docIdOf(doc.name);
      const name = fsString(doc.fields?.name) ?? '';
      if (id && name) out.push({ id, name });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

export interface ClubActor {
  slug: string;
  displayName: string;
}

/** `discord_links/{id}` → who this is, or a worded refusal. The same document
 * `poll-vote.ts` reads, read the same way. */
export async function resolveActor(
  deps: ClubWriteDeps,
  discordUserId: string,
): Promise<{ ok: true; actor: ClubActor } | { ok: false; message: string }> {
  const res = await firestoreRequest(
    deps.sa,
    deps.accessToken,
    'GET',
    `discord_links/${encodeURIComponent(discordUserId)}`,
  );
  if (res.status === 404) return { ok: false, message: CLUB_MSG.unlinked };
  if (!res.ok) throw new Error(`link read failed (${res.status})`);
  const doc = (await res.json()) as FsDoc;
  const slug = fsString(doc.fields?.slug);
  const displayName = fsString(doc.fields?.displayName);
  if (slug === null || !isSafeSlug(slug)) return { ok: false, message: CLUB_MSG.unlinked };
  if (!displayName) return { ok: false, message: CLUB_MSG.linkIncomplete };
  return { ok: true, actor: { slug, displayName } };
}

/**
 * ⚠️ The RSVP document, in the SITE'S vocabulary and the SITE'S types. Our
 * `yes`/`no`/`maybe` becomes their `going`/`cant`/`maybe`, and the instant goes
 * out as an integer so `rsvp.meetingAt === club.nextMeetingAt` can be true.
 */
export function rsvpDocFields(status: RsvpStatus, actor: ClubActor, meetingAt: number) {
  return {
    [CLUB_WRITE_SHAPES.rsvpStatusField]: { stringValue: SITE_RSVP_RESPONSE[status] },
    [CLUB_WRITE_SHAPES.displayNameField]: { stringValue: actor.displayName },
    [CLUB_WRITE_SHAPES.rsvpMeetingField]: { integerValue: String(Math.trunc(meetingAt)) },
  };
}

/**
 * ⚠️ **A CHAPTER LABEL IS PROSE; `chapterIndex` IS A NUMBER.** "ch. 14" is what
 * a person types and `14` is what the club page stores and draws with, so the
 * number is taken out of the label. A label with no number in it has nowhere to
 * go — see `validateProgress`, which refuses it before anything is read.
 */
export function chapterIndexOf(label: string): number | null {
  const m = /\d+/.exec(label);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

/**
 * ⚠️ **THE PROGRESS DOCUMENT, and note what is NOT in it.**
 *
 * `history` is never written: the site appends to it with a read-modify-write
 * and this Worker's PATCH names its fields in an `updateMask`, so an untouched
 * field survives untouched. Writing it would clobber the pace graph.
 *
 * `percent` is never written either, because there is no such field — see
 * `PROGRESS_PERCENT_UNSUPPORTED`.
 */
export function progressDocFields(
  input: { chapterIndex?: number },
  actor: ClubActor,
  nowIso: string,
) {
  return {
    ...(input.chapterIndex !== undefined
      ? { [CLUB_WRITE_SHAPES.progressChapterField]: { integerValue: String(input.chapterIndex) } }
      : {}),
    [CLUB_WRITE_SHAPES.displayNameField]: { stringValue: actor.displayName },
    [CLUB_WRITE_SHAPES.updatedAtField]: { timestampValue: nowIso },
  };
}

/** ⚠️ An `updateMask` naming exactly the fields written, so an upsert never
 * blanks a field the site wrote and this Worker does not know about — the same
 * discipline `poll-vote.ts` keeps on its vote upsert. */
function maskFor(fields: Record<string, unknown>): string {
  return Object.keys(fields)
    .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
    .join('&');
}

export interface RsvpContext {
  sa: ServiceAccount | null;
  discordUserId: string | null;
  clubName: string;
  applicationId: string;
  interactionToken: string;
  /** `GABI_CLUB_WRITES`. */
  enabled: boolean;
}

/** The RSVP card: which meeting, and the three buttons. */
export function buildRsvpCard(
  club: ClubSummary,
  meetingAt: number,
): { content: string; components: unknown[] } {
  return {
    // ⚠️ The instant is printed as the store holds it, and Discord's own
    // `<t:...:F>` renderer is used only when it is a parseable date — inventing
    // a format for an unparseable value would print a wrong time confidently.
    content: renderMeetingLine(club.name, meetingAt),
    components: buildRsvpButtons(CLUB_COLLECTION, club.id),
  };
}

export function renderMeetingLine(clubName: string, meetingAt: number): string {
  // ⚠️ EPOCH MILLISECONDS since 2026-09-02 — `nextMeetingAt` is a number on the
  // club document (`site/clubs.js:565` validates `Number.isFinite`), and
  // `meetingInstantOf` normalises every stored form to that one. Discord's own
  // `<t:...:F>` renderer takes SECONDS, so the division stays.
  const when = Number.isFinite(meetingAt)
    ? `<t:${Math.floor(meetingAt / 1000)}:F>`
    : `\`${String(meetingAt)}\` (GABI could not read that as a date — the club page shows it properly)`;
  return (
    `**${clubName}** meets ${when}. Are you coming?\n\n` +
    '_Whatever you press is the same record the club page keeps — change it as often as you like._'
  );
}

/**
 * `/rsvp` OFFERS the buttons; it does not write.
 *
 * ⚠️ That split is design §2d's own shape (*"RSVP as Discord buttons on the
 * meeting-announcement embed"*) and it is also what keeps the command honest: a
 * command that both asked and answered would have to invent a default, and
 * "GABI put you down as coming because you ran /rsvp" is a claim nobody made.
 * Never throws.
 */
export async function processRsvp(ctx: RsvpContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    if (!ctx.enabled) return say({ content: CLUB_MSG.switchedOff });
    if (!ctx.sa) return say({ content: CLUB_MSG.notConfigured });
    if (!ctx.discordUserId) return say({ content: CLUB_MSG.unlinked });
    const accessToken = await mintAccessToken(ctx.sa);
    const deps: ClubWriteDeps = { sa: ctx.sa, accessToken };

    // ⚠️ Identity FIRST: somebody who cannot be recorded should be told before
    // they are shown three buttons that would refuse them.
    const who = await resolveActor(deps, ctx.discordUserId);
    if (!who.ok) return say({ content: who.message });

    const resolution = resolveClub(await listClubs(deps), ctx.clubName);
    if (!resolution.ok) return say({ content: resolution.message });
    const club = resolution.club;

    const clubRes = await firestoreRequest(
      deps.sa,
      accessToken,
      'GET',
      `${CLUB_COLLECTION}/${encodeURIComponent(club.id)}`,
    );
    if (!clubRes.ok) throw new Error(`club read failed (${clubRes.status})`);
    const clubDoc = (await clubRes.json()) as FsDoc;

    // ⚠️ The club's own opt-in, default OFF — the same posture the poll path
    // keeps, and the same feature key the audiobook Worker already allows.
    if (!clubRsvpEnabled(clubDoc)) return say({ content: CLUB_MSG.rsvpOff });

    const meetingAt = meetingInstantOf(clubDoc);
    if (!meetingAt) return say({ content: CLUB_MSG.noMeeting });

    await say(buildRsvpCard(club, meetingAt));
  } catch (err) {
    console.error('/rsvp failed:', err instanceof Error ? err.message : err);
    try {
      await say({ content: CLUB_MSG.outage });
    } catch {
      // The interaction token itself failed — nothing left to answer with.
    }
  }
}

export interface ProgressContext {
  sa: ServiceAccount | null;
  discordUserId: string | null;
  clubName: string;
  /** ⚠️ NOT an input any more — the option was dropped on 2026-09-05. It is
   *  still carried because a stale global command (or a hand-crafted
   *  interaction) can send one, and it is answered in words rather than
   *  ignored. Never written. */
  legacyPercent: number | undefined;
  chapter: string;
  applicationId: string;
  interactionToken: string;
  enabled: boolean;
  /** Injected so a test pins the stamp instead of asserting "some ISO string". */
  now?: () => Date;
}

/** ⚠️ The club's ACTIVE read — the one a bare `/progress` applies to. A club
 * with none is told so; a club with several active slots takes the first by
 * `slot`, which is the club page's own ordering. */
export async function activeReadId(
  deps: ClubWriteDeps,
  clubId: string,
): Promise<string | null> {
  const res = await firestoreRequest(
    deps.sa,
    deps.accessToken,
    'GET',
    `${CLUB_COLLECTION}/${encodeURIComponent(clubId)}/reads?pageSize=100`,
  );
  if (!res.ok) throw new Error(`reads list failed (${res.status})`);
  const data = (await res.json()) as { documents?: FsDoc[] };
  const active = (data.documents ?? []).filter((d) => fsString(d.fields?.status) === 'active');
  if (active.length === 0) return null;
  active.sort((a, b) => {
    const av = a.fields?.slot?.integerValue ?? a.fields?.slot?.stringValue ?? '';
    const bv = b.fields?.slot?.integerValue ?? b.fields?.slot?.stringValue ?? '';
    return String(av).localeCompare(String(bv));
  });
  return docIdOf(active[0]?.name);
}

/** The whole Discord→Firestore progress path. Never throws. */
export async function processProgress(ctx: ProgressContext): Promise<void> {
  const say = async (content: string) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, { content });
  };
  try {
    if (!ctx.enabled) return say(CLUB_MSG.switchedOff);

    // ⚠️ VALIDATED BEFORE ANYTHING IS READ. A person whose input cannot be
    // recorded should not have the club list walked in order to be told so.
    const input = validateProgress(ctx.legacyPercent, ctx.chapter);
    if (!input.ok) return say(input.message);

    if (!ctx.sa) return say(CLUB_MSG.notConfigured);
    if (!ctx.discordUserId) return say(CLUB_MSG.unlinked);
    const accessToken = await mintAccessToken(ctx.sa);
    const deps: ClubWriteDeps = { sa: ctx.sa, accessToken };

    const who = await resolveActor(deps, ctx.discordUserId);
    if (!who.ok) return say(who.message);

    const resolution = resolveClub(await listClubs(deps), ctx.clubName);
    if (!resolution.ok) return say(resolution.message);
    const club = resolution.club;

    const readId = await activeReadId(deps, club.id);
    if (!readId) return say(CLUB_MSG.noActiveRead);

    const nowIso = (ctx.now ? ctx.now() : new Date()).toISOString();
    const fields = progressDocFields(input, who.actor, nowIso);
    const writeRes = await firestoreRequest(
      deps.sa,
      accessToken,
      'PATCH',
      `${CLUB_COLLECTION}/${encodeURIComponent(club.id)}/reads/${encodeURIComponent(readId)}/` +
        `${CLUB_WRITE_SHAPES.progressCollection}/${slugPathSegment(who.actor.slug)}?${maskFor(fields)}`,
      { fields },
    );
    if (!writeRes.ok) throw new Error(`progress write failed (${writeRes.status})`);
    await say(
      CLUB_MSG.progressDone(
        club.name,
        input.chapterIndex,
        input.chapter,
      ),
    );
  } catch (err) {
    console.error('/progress failed:', err instanceof Error ? err.message : err);
    try {
      await say(CLUB_MSG.outage);
    } catch {
      // Nothing left to answer with.
    }
  }
}

/**
 * A press on an RSVP button. The same path as `/rsvp`, reached from a component
 * instead of a command — so it answers with an ephemeral FOLLOWUP rather than
 * an edit, leaving whatever message carried the buttons intact.
 */
export async function processRsvpPress(ctx: {
  sa: ServiceAccount | null;
  customId: string;
  discordUserId: string | null;
  applicationId: string;
  interactionToken: string;
  enabled: boolean;
}): Promise<void> {
  const say = async (content: string) => {
    await followupEphemeral(ctx.applicationId, ctx.interactionToken, content);
  };
  try {
    if (!ctx.enabled) return say(CLUB_MSG.switchedOff);
    if (!ctx.sa) return say(CLUB_MSG.notConfigured);
    if (!ctx.discordUserId) return say(CLUB_MSG.unlinked);
    const ref = parseRsvpCustomId(ctx.customId);
    if (!ref) return say(CLUB_MSG.outage);

    const accessToken = await mintAccessToken(ctx.sa);
    const deps: ClubWriteDeps = { sa: ctx.sa, accessToken };
    const who = await resolveActor(deps, ctx.discordUserId);
    if (!who.ok) return say(who.message);

    const clubRes = await firestoreRequest(
      deps.sa,
      accessToken,
      'GET',
      `${ref.clubCol}/${encodeURIComponent(ref.clubId)}`,
    );
    if (clubRes.status === 404) return say(CLUB_MSG.clubNotFound(ref.clubId, []));
    if (!clubRes.ok) throw new Error(`club read failed (${clubRes.status})`);
    const clubDoc = (await clubRes.json()) as FsDoc;
    if (!clubRsvpEnabled(clubDoc)) return say(CLUB_MSG.rsvpOff);
    const meetingAt = meetingInstantOf(clubDoc);
    if (!meetingAt) return say(CLUB_MSG.noMeeting);

    const fields = rsvpDocFields(ref.status, who.actor, meetingAt);
    const writeRes = await firestoreRequest(
      deps.sa,
      accessToken,
      'PATCH',
      `${ref.clubCol}/${encodeURIComponent(ref.clubId)}/${CLUB_WRITE_SHAPES.rsvpCollection}/` +
        `${slugPathSegment(who.actor.slug)}?${maskFor(fields)}`,
      { fields },
    );
    if (!writeRes.ok) throw new Error(`rsvp write failed (${writeRes.status})`);
    await say(CLUB_MSG.rsvpDone(ref.status, fsString(clubDoc.fields?.name) ?? 'this club'));
  } catch (err) {
    console.error('RSVP press failed:', err instanceof Error ? err.message : err);
    try {
      await say(CLUB_MSG.outage);
    } catch {
      // Nothing left to answer with.
    }
  }
}

/** The three RSVP buttons, for a message that offers them. */
export function buildRsvpButtons(clubCol: ClubCollection, clubId: string): unknown[] {
  return [
    {
      type: 1,
      components: RSVP_STATUSES.map((status) => ({
        type: 2,
        style: status === 'yes' ? 3 : status === 'no' ? 4 : 2,
        label: status === 'yes' ? 'Coming' : status === 'no' ? 'Not coming' : 'Maybe',
        custom_id: buildRsvpCustomId({ clubCol, clubId, status }),
      })),
    },
  ];
}
