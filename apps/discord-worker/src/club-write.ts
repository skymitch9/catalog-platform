/**
 * `/rsvp` and `/progress` — the two per-member club writes from Discord
 * (design §2d and §2e), built to `poll-vote.ts`'s shape exactly.
 *
 * ⚠️ **THEY SHIP OFF, BEHIND `GABI_CLUB_WRITES`, AND THAT IS THE WHOLE HEADER.**
 * Read the next section before flipping it.
 *
 * ## ⚠️ WHY DARK: THE DOCUMENT SHAPES ARE NOT MEASURED, AND A GUESS HERE
 * ## SUCCEEDS RATHER THAN FAILING
 *
 * `poll-vote.ts` could be built confidently because its shapes were **read off
 * `firestore.rules` and verified** (its header says so, and dates it). This
 * build was directed not to read the `bookbuddy` repos, so the same
 * verification was not available, and what IS known from this repo is only
 * half of what a write needs:
 *
 * | Fact | Status |
 * |---|---|
 * | `clubs/{id}/reads/{readId}/progress` exists as a subcollection | ⚠️ **MEASURED** — `apps/audiobook-worker/src/enforce-routes.ts:857` sweeps it on read delete |
 * | RSVPs exist and are `meetingAt`-stamped | ⚠️ **MEASURED** — `docs/info/audiobook-auth-migration.md:103` |
 * | Per-member club subdocs are keyed by **member slug** | ⚠️ **MEASURED** — `votes/{slug}` (poll-vote.ts), `members/:slug`, `requests/:slug` (enforce-routes.ts), and `slugifyName = displayName.toLowerCase()` |
 * | Both writes are gated `open` in rules, not by a capability | ⚠️ **MEASURED** — the migration doc's table: *setProgress / setChapterProgress: open, browser-direct*; *RSVP: open, browser-direct* |
 * | The **field names** inside those documents | 🔴 **NOT MEASURED** — they live in `audiobook_catalog/site/`, which this build did not read |
 * | The **rsvps collection path** (club-level vs meeting-level) | 🔴 **NOT MEASURED** |
 *
 * ⚠️ **This Worker's service account BYPASSES `firestore.rules`.** So a write in
 * a wrong shape is not refused — it **succeeds**, and the club page then shows
 * a member who has not RSVP'd, or a progress bar that never moves, with no
 * error anywhere. That failure is silent, it is on somebody else's surface, and
 * it looks exactly like a bug in their code.
 *
 * The estate's own rule settles it: *a number in a doc is either measured or
 * labelled a guess*, and *functions that produce persisted keys are migrations
 * to change, not edits*. So the code is complete, tested and wired — and the
 * posture ships `off`, exactly as `MODERATION_ENABLED` and `GABI_CONFIRM_T2`
 * do. ⚠️ **The flip is not a deploy step. It is: measure the four constants
 * below against `audiobook_catalog/site/`, correct them if they are wrong, then
 * flip.** `docs/access/discord-bot.md` §15 carries the checklist.
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
 * ⚠️ **EVERY NAME IN THIS BLOCK IS INFERRED, NOT MEASURED.** They are gathered
 * in one place so that verifying them is one diff rather than a hunt, and so
 * that a reader meets the warning before the code that uses them.
 *
 * Verify each against `audiobook_catalog/site/` (`club-meetings.js` /
 * `club-reads.js` and `firestore.rules`) BEFORE flipping `GABI_CLUB_WRITES`.
 */
export const CLUB_WRITE_SHAPES = {
  /** Where a club's RSVPs live, relative to the club document. */
  rsvpCollection: 'rsvps',
  /** The field holding `yes` / `no` / `maybe`. */
  rsvpStatusField: 'status',
  /** The field the migration doc calls "meetingAt-stamped". */
  rsvpMeetingField: 'meetingAt',
  /** The club document field naming the next meeting instant. */
  clubMeetingField: 'meetingAt',
  /** The reads subcollection, and the two fields a member's progress carries. */
  progressCollection: 'progress',
  progressPercentField: 'percent',
  progressChapterField: 'chapter',
  /** Carried on both, matching every other per-member club doc in this Worker
   *  (`voteDocFields` writes exactly this pair). */
  displayNameField: 'displayName',
  updatedAtField: 'updatedAt',
} as const;

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
  | { ok: true; percent?: number; chapter?: string }
  | { ok: false; message: string };

/**
 * ⚠️ **AT LEAST ONE OF THE TWO, AND BOTH ARE OPTIONAL SEPARATELY.** A
 * `/progress` with neither is a person asking to record nothing, and answering
 * "done" to it would be a lie with a tick beside it.
 */
export function validateProgress(percent: number | undefined, chapter: string): ProgressInput {
  const label = (chapter ?? '').trim();
  if (percent === undefined && label.length === 0) {
    return { ok: false, message: CLUB_MSG.progressNothing };
  }
  if (percent !== undefined) {
    if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
      return { ok: false, message: CLUB_MSG.progressPercent };
    }
  }
  if (label.length > CHAPTER_MAX) {
    return { ok: false, message: CLUB_MSG.progressChapter(CHAPTER_MAX) };
  }
  return {
    ok: true,
    ...(percent !== undefined ? { percent } : {}),
    ...(label ? { chapter: label } : {}),
  };
}

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
  progressNothing:
    'Tell GABI where you are — a percentage (`percent:40`) or a chapter (`chapter:ch. 14`), or ' +
    'both. Nothing was recorded, because there was nothing to record.',
  progressPercent:
    'A percentage has to be a whole number between 0 and 100. Nothing was recorded — GABI does not ' +
    'round a number you did not type.',
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
  progressDone: (club: string, percent?: number, chapter?: string) => {
    const bits: string[] = [];
    if (percent !== undefined) bits.push(`**${percent}%**`);
    if (chapter) bits.push(`**${chapter}**`);
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
  booleanValue?: boolean;
  timestampValue?: string;
  mapValue?: { fields?: Record<string, FsValue> };
};
type FsDoc = { name?: string; fields?: Record<string, FsValue> };

const fsString = (v: FsValue | undefined): string | null =>
  typeof v?.stringValue === 'string' ? v.stringValue : null;

/** ⚠️ A meeting instant may be stored as a Firestore timestamp OR as an ISO
 * string; both are read, and neither is invented. `null` means "no meeting
 * scheduled", which is a real and common state. */
export function meetingInstantOf(doc: FsDoc): string | null {
  const v = doc.fields?.[CLUB_WRITE_SHAPES.clubMeetingField];
  if (typeof v?.timestampValue === 'string') return v.timestampValue;
  const s = fsString(v);
  return s && s.trim() ? s : null;
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

export function rsvpDocFields(status: RsvpStatus, actor: ClubActor, meetingAt: string) {
  return {
    [CLUB_WRITE_SHAPES.rsvpStatusField]: { stringValue: status },
    [CLUB_WRITE_SHAPES.displayNameField]: { stringValue: actor.displayName },
    [CLUB_WRITE_SHAPES.rsvpMeetingField]: { stringValue: meetingAt },
  };
}

export function progressDocFields(
  input: { percent?: number; chapter?: string },
  actor: ClubActor,
  nowIso: string,
) {
  return {
    ...(input.percent !== undefined
      ? { [CLUB_WRITE_SHAPES.progressPercentField]: { integerValue: String(input.percent) } }
      : {}),
    ...(input.chapter
      ? { [CLUB_WRITE_SHAPES.progressChapterField]: { stringValue: input.chapter } }
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
  meetingAt: string,
): { content: string; components: unknown[] } {
  return {
    // ⚠️ The instant is printed as the store holds it, and Discord's own
    // `<t:...:F>` renderer is used only when it is a parseable date — inventing
    // a format for an unparseable value would print a wrong time confidently.
    content: renderMeetingLine(club.name, meetingAt),
    components: buildRsvpButtons(CLUB_COLLECTION, club.id),
  };
}

export function renderMeetingLine(clubName: string, meetingAt: string): string {
  const parsed = Date.parse(meetingAt);
  const when = Number.isFinite(parsed)
    ? `<t:${Math.floor(parsed / 1000)}:F>`
    : `\`${meetingAt}\` (GABI could not read that as a date — the club page shows it properly)`;
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
  percent: number | undefined;
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
    const input = validateProgress(ctx.percent, ctx.chapter);
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
        input.percent,
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
