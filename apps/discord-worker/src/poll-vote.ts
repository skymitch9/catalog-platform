/**
 * Two-way club poll voting — the Discord half (design doc §2a; full
 * mechanics in audiobook_catalog docs/info/discord-poll-sync-research.md).
 *
 * The Firestore shapes are the audiobook catalog's EXISTING ones, verified
 * against firestore.rules 2026-08-16 — nothing downstream (tally code, the
 * club page, club_announcements.py) needs to know a vote came from Discord:
 *
 *   {clubs|clubs_dev}/{clubId}/polls/{pollId}
 *       question: string, status: 'open'|'closed',
 *       options: (string | {title, author?, coverHref?})[]   (2..10)
 *   .../polls/{pollId}/votes/{slug}
 *       { optionIndex: int >= 0, displayName: string }        (validPollVote)
 *       doc id = member slug; last write wins — same "you can change your
 *       vote" behavior the app already has, now reachable from two surfaces.
 *
 * Identity (§1.6 stance, followed exactly): ONE link ceremony, resolved via
 *   discord_links/{discordUserId} → { slug, displayName?, linkedAt? }
 * a top-level collection READ ONLY by this Worker (service account bypasses
 * rules; no rules change needed). An unlinked Discord user gets a WORDED
 * ephemeral rejection — never a silent failure, never a name-matching guess
 * (research doc §5 option 1; the pseudo-member fallback is deliberately not
 * built). The ceremony that WRITES link docs is phase 2 — BUILT 2026-08-17,
 * see link.ts — and this module stays its only reader.
 *
 * Response discipline (§1.7): ALWAYS-DEFERRED — the route answers
 * DEFERRED_UPDATE_MESSAGE (type 6, no loading flicker for components)
 * inside the 3-second window, and this module does the Firestore round
 * trips in waitUntil under the 15-minute interaction token. The research
 * doc's synchronous-with-fallback default needs a real latency measurement
 * (its own §7 caveat) which cannot be taken before the app exists; deferred
 * is the safe start and flipping later is a small change.
 *
 * The Worker bypasses firestore.rules, so it re-enforces server-side what
 * the rules enforce for browsers: poll exists AND status == 'open', option
 * index in range — plus the per-club opt-in flag features.discordPollVoting
 * (default OFF, research doc phase 2).
 */

import {
  firestoreRequest,
  mintAccessToken,
  type ServiceAccount,
} from './firebase-sa.js';
import { editOriginalMessage, followupEphemeral } from './discord-api.js';
import { isSafeSlug, slugPathSegment } from './slug.js';

// ---------------------------------------------------------------------------
// custom_id — the vote button's routing key: `pv|clubCol|clubId|pollId|idx`
// ---------------------------------------------------------------------------

export const POLL_VOTE_PREFIX = 'pv';

/** Both lanes exist in firestore.rules; anything else is refused. */
export const CLUB_COLLECTIONS = ['clubs', 'clubs_dev'] as const;
export type ClubCollection = (typeof CLUB_COLLECTIONS)[number];

export interface PollVoteRef {
  clubCol: ClubCollection;
  clubId: string;
  pollId: string;
  optionIndex: number;
}

/**
 * Firestore auto-ids (clubId, pollId) — and ONLY those.
 *
 * ⚠️ CORRECTED 2026-08-17. This pattern also guarded the link doc's `slug`,
 * which was wrong: a member slug is `displayName.toLowerCase()` (see slug.ts
 * for the measurement), so almost every real slug contains a space and this
 * regex refused it. The effect would have been silent and cruel — phase 2
 * writes a link, phase 1 declines to read it, and the voter is told they are
 * "not linked" while their link doc sits right there. Slugs now go through
 * `isSafeSlug()`, and the two halves are pinned together by the contract test
 * in test/link.test.ts.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function buildPollCustomId(ref: PollVoteRef): string {
  return [POLL_VOTE_PREFIX, ref.clubCol, ref.clubId, ref.pollId, String(ref.optionIndex)].join('|');
}

/** Strict parse — null on anything that isn't exactly the shape above. */
export function parsePollCustomId(customId: string): PollVoteRef | null {
  const parts = customId.split('|');
  if (parts.length !== 5) return null;
  const [prefix, clubCol, clubId, pollId, idxRaw] = parts as [string, string, string, string, string];
  if (prefix !== POLL_VOTE_PREFIX) return null;
  if (!(CLUB_COLLECTIONS as readonly string[]).includes(clubCol)) return null;
  if (!SAFE_ID.test(clubId) || !SAFE_ID.test(pollId)) return null;
  if (!/^\d{1,2}$/.test(idxRaw)) return null;
  const optionIndex = Number(idxRaw);
  if (optionIndex > 9) return null; // MAX_POLL_OPTIONS is 10
  return { clubCol: clubCol as ClubCollection, clubId, pollId, optionIndex };
}

// ---------------------------------------------------------------------------
// Firestore REST document decoding — the few field shapes this flow reads
// ---------------------------------------------------------------------------

type FsValue = {
  stringValue?: string;
  integerValue?: string | number;
  booleanValue?: boolean;
  /** Not read by anything here — declared so this type can DESCRIBE a real
   * link doc, which carries `linkedAt` (link.ts writes it). A reader type
   * that cannot express the document it reads is a type that quietly stops
   * being checked at the call site. */
  timestampValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};
type FsDoc = { name?: string; fields?: Record<string, FsValue> };

const fsString = (v: FsValue | undefined): string | null =>
  typeof v?.stringValue === 'string' ? v.stringValue : null;

const fsInt = (v: FsValue | undefined): number | null => {
  const raw = v?.integerValue;
  if (raw === undefined) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(n) ? n : null;
};

/** A poll option is a plain string or a book-ref map (backlog #3b). */
export function optionText(v: FsValue): string {
  const plain = fsString(v);
  if (plain !== null) return plain;
  const fields = v.mapValue?.fields;
  const title = fsString(fields?.title);
  if (title !== null) {
    const author = fsString(fields?.author);
    return author ? `${title} — ${author}` : title;
  }
  return '(unreadable option)';
}

export interface PollDoc {
  question: string;
  status: string;
  options: string[]; // rendered text, in order
}

export function pollFromDoc(doc: FsDoc): PollDoc | null {
  const fields = doc.fields;
  if (!fields) return null;
  const question = fsString(fields.question);
  const status = fsString(fields.status);
  const optionValues = fields.options?.arrayValue?.values;
  if (question === null || status === null || !Array.isArray(optionValues)) return null;
  return { question, status, options: optionValues.map(optionText) };
}

export interface DiscordLink {
  slug: string;
  displayName: string;
}

/** discord_links/{discordUserId} → who this Discord account is, or null.
 * The slug rule is slug.ts's, shared with the writer (link.ts). */
export function linkFromDoc(doc: FsDoc): DiscordLink | null {
  const slug = fsString(doc.fields?.slug);
  if (slug === null || !isSafeSlug(slug)) return null;
  const displayName = fsString(doc.fields?.displayName);
  return { slug, displayName: displayName ?? slug };
}

/** club doc → is features.discordPollVoting affirmatively true? */
export function clubVotingEnabled(doc: FsDoc): boolean {
  return doc.fields?.features?.mapValue?.fields?.discordPollVoting?.booleanValue === true;
}

/**
 * club doc → may the sync tick POST this club's polls into Discord?
 *
 * ⚠️ **A SECOND, DIFFERENT TOGGLE FROM `discordPollVoting`, AND IT IS READ WITH
 * THE OPPOSITE DEFAULT — on purpose** (2026-09-02).
 *
 * `features.discordPollAnnouncements` is a club feature key the estate already
 * carries: `apps/audiobook-worker/src/enforce-routes.ts:123` allows it through
 * `updateClubDetails`, and the toggle itself is being built on the audiobook
 * side. This Worker only READS it — it neither writes nor defines it.
 *
 * ⚠️ **ABSENT MEANS YES, and an explicit `false` means no.** That is the
 * `promptsEnabled !== false` idiom the estate already uses for a club-level
 * opt-OUT (design §2, the "Post as GABI" gate), and choosing the affirmative
 * `=== true` form instead would have **silently switched off every club that
 * already announces its polls** the moment this deployed: no club doc carries
 * the key yet, so every one of them would have read as opted out, and the
 * failure would have looked exactly like the sync tick being broken.
 *
 * ⚠️ The two toggles are ORTHOGONAL and both are honoured:
 *   - `discordPollVoting` decides whether Discord may vote at all (this Worker's
 *     own opt-in, default OFF, unchanged);
 *   - `discordPollAnnouncements` decides whether the tick may PUSH a poll into
 *     the channel. A club that wants Discord voting on a message it posts
 *     itself sets voting on and announcements off.
 */
export function clubPollAnnouncementsEnabled(doc: FsDoc): boolean {
  return doc.fields?.features?.mapValue?.fields?.discordPollAnnouncements?.booleanValue !== false;
}

/** The exact fields validPollVote() accepts from a browser — same shape. */
export function voteDocFields(optionIndex: number, displayName: string) {
  return {
    optionIndex: { integerValue: String(optionIndex) },
    displayName: { stringValue: displayName },
  };
}

/** Count votes per option; out-of-range/unreadable indices are ignored. */
export function tallyVotes(voteIndices: Array<number | null>, optionCount: number): number[] {
  const tallies = new Array<number>(optionCount).fill(0);
  for (const idx of voteIndices) {
    if (idx !== null && idx >= 0 && idx < optionCount) tallies[idx] = (tallies[idx] ?? 0) + 1;
  }
  return tallies;
}

// ---------------------------------------------------------------------------
// Message rendering — embed + button rows, rebuilt deterministically from
// the poll doc (never from the incoming message)
// ---------------------------------------------------------------------------

/** club_announcements.py's COLOR_PURPLE — polls keep one color everywhere. */
export const POLL_COLOR = 10181046;

const BUTTON_LABEL_MAX = 80; // Discord's button-label ceiling
const BUTTONS_PER_ROW = 5; //   and its action-row ceiling

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

export function buildPollMessage(
  ref: Pick<PollVoteRef, 'clubCol' | 'clubId' | 'pollId'>,
  poll: PollDoc,
  tallies: number[],
  opts: { closed?: boolean } = {},
): { embeds: unknown[]; components: unknown[] } {
  const total = tallies.reduce((a, b) => a + b, 0);
  const closed = opts.closed === true;
  // A winner marker only means something once voting is frozen; while the
  // poll is open a "leader" would flap on every click and read as a result.
  const top = closed && total > 0 ? Math.max(...tallies) : -1;
  const lines = poll.options.map((text, i) => {
    const n = tallies[i] ?? 0;
    const mark = closed && top > 0 && n === top ? '🏆 ' : '';
    return `${mark}**${i + 1}.** ${text} — ${n} vote${n === 1 ? '' : 's'}`;
  });
  const embeds = [
    {
      title: truncate(closed ? `${poll.question} (closed)` : poll.question, 256),
      description: lines.join('\n'),
      color: POLL_COLOR,
      footer: {
        text: closed
          ? `${total} vote${total === 1 ? '' : 's'} · final — this poll is closed`
          : `${total} vote${total === 1 ? '' : 's'} · syncs with the club page`,
      },
    },
  ];
  // ⚠️ A closed poll gets its buttons REMOVED, not merely disabled: an empty
  // `components` array is Discord's own "strip every component" instruction,
  // and a button that cannot be clicked at all cannot race the server-side
  // `status == 'open'` re-check. `components: []` must always be SENT on an
  // edit — omitting the field leaves the old buttons in place.
  if (closed) return { embeds, components: [] };
  const buttons = poll.options.map((text, i) => ({
    type: 2, // button
    style: 2, // secondary
    label: truncate(`${i + 1}. ${text}`, BUTTON_LABEL_MAX),
    custom_id: buildPollCustomId({ ...ref, optionIndex: i }),
  }));
  const components: unknown[] = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    components.push({ type: 1, components: buttons.slice(i, i + BUTTONS_PER_ROW) });
  }
  return { embeds, components };
}

// ---------------------------------------------------------------------------
// The deferred flow — runs in waitUntil after the type-6 ack
// ---------------------------------------------------------------------------

/** Every rejection says what happened, what it needs, and where to go —
 * never a bare status, and an outage is never dressed as a permissions
 * problem (the estate's no-bare-status rule). */
export const MSG = {
  unlinked:
    "Your Discord account isn't linked to a club member, so this vote was NOT counted. " +
    'Votes are never guessed from usernames — run **/link** to connect the two (it takes about ' +
    'twenty seconds and you can unlink whenever you like), or vote on the club page instead.',
  votingOff:
    "Discord voting isn't switched on for this club, so this vote was NOT counted. " +
    "A club manager can enable it in the club's settings — until then, vote on the club page.",
  clubGone: 'This club no longer exists, so the vote could not be recorded.',
  pollGone: 'This poll no longer exists, so the vote could not be recorded.',
  pollClosed: 'This poll is closed — votes are frozen and the tally on the club page is final.',
  optionGone: 'That option no longer exists on this poll, so the vote was NOT counted.',
  outage:
    "Something went wrong on the estate's side (a service problem, NOT a permissions one) " +
    'and your vote was NOT recorded. Try again in a minute, or vote on the club page.',
  editFailed:
    'Your vote WAS counted, but the tally on this message could not refresh — it will catch ' +
    'up the next time anyone votes.',
} as const;

export interface VoteContext {
  sa: ServiceAccount;
  ref: PollVoteRef;
  discordUserId: string;
  applicationId: string;
  interactionToken: string;
}

/** List every vote doc's optionIndex (pages until exhausted). Exported
 * because poll-sync.ts tallies the SAME way on its refresh tick — two
 * tallies of one poll that disagreed would be worse than none. */
export async function listVoteIndices(
  sa: ServiceAccount,
  accessToken: string,
  ref: PollVoteRef,
): Promise<Array<number | null>> {
  const out: Array<number | null> = [];
  let pageToken: string | undefined;
  do {
    const query = `pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await firestoreRequest(
      sa,
      accessToken,
      'GET',
      `${ref.clubCol}/${ref.clubId}/polls/${ref.pollId}/votes?${query}`,
    );
    if (!res.ok) throw new Error(`vote list failed (${res.status})`);
    const data = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    for (const doc of data.documents ?? []) out.push(fsInt(doc.fields?.optionIndex));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * The whole Discord→Firestore vote path. Never throws — every outcome ends
 * as either an edited message or a worded ephemeral followup.
 */
export async function processPollVote(ctx: VoteContext): Promise<void> {
  const { sa, ref } = ctx;
  const say = async (content: string) => {
    await followupEphemeral(ctx.applicationId, ctx.interactionToken, content);
  };
  try {
    const accessToken = await mintAccessToken(sa);

    // 1. Who is this? (§1.6 — reject unlinked, loudly and ephemerally.)
    const linkRes = await firestoreRequest(
      sa,
      accessToken,
      'GET',
      `discord_links/${ctx.discordUserId}`,
    );
    if (linkRes.status === 404) return say(MSG.unlinked);
    if (!linkRes.ok) throw new Error(`link read failed (${linkRes.status})`);
    const link = linkFromDoc((await linkRes.json()) as FsDoc);
    if (!link) return say(MSG.unlinked);

    // 2. Has this club opted in? (features.discordPollVoting, default OFF.)
    const clubRes = await firestoreRequest(
      sa,
      accessToken,
      'GET',
      `${ref.clubCol}/${ref.clubId}?mask.fieldPaths=features`,
    );
    if (clubRes.status === 404) return say(MSG.clubGone);
    if (!clubRes.ok) throw new Error(`club read failed (${clubRes.status})`);
    if (!clubVotingEnabled((await clubRes.json()) as FsDoc)) return say(MSG.votingOff);

    // 3. Is the poll real, open, and does the option still exist? The
    //    Worker bypasses rules, so this mirrors pollIsOpen() server-side.
    const pollRes = await firestoreRequest(
      sa,
      accessToken,
      'GET',
      `${ref.clubCol}/${ref.clubId}/polls/${ref.pollId}`,
    );
    if (pollRes.status === 404) return say(MSG.pollGone);
    if (!pollRes.ok) throw new Error(`poll read failed (${pollRes.status})`);
    const poll = pollFromDoc((await pollRes.json()) as FsDoc);
    if (!poll) return say(MSG.pollGone);
    if (poll.status !== 'open') return say(MSG.pollClosed);
    if (ref.optionIndex >= poll.options.length) return say(MSG.optionGone);

    // 4. Upsert votes/{slug} — the exact shape validPollVote() accepts, so
    //    the app's tallies/announcements pick it up with zero new code.
    //    Last write wins == the existing "change your vote" behavior.
    const writeRes = await firestoreRequest(
      sa,
      accessToken,
      'PATCH',
      `${ref.clubCol}/${ref.clubId}/polls/${ref.pollId}/votes/${slugPathSegment(link.slug)}` +
        `?updateMask.fieldPaths=optionIndex&updateMask.fieldPaths=displayName`,
      { fields: voteDocFields(ref.optionIndex, link.displayName) },
    );
    if (!writeRes.ok) throw new Error(`vote write failed (${writeRes.status})`);

    // 5. Fresh tally → edit the original message (interaction token, 15 min).
    const tallies = tallyVotes(await listVoteIndices(sa, accessToken, ref), poll.options.length);
    const edit = await editOriginalMessage(
      ctx.applicationId,
      ctx.interactionToken,
      buildPollMessage(ref, poll, tallies),
    );
    if (!edit.ok) {
      console.error(`discord message edit failed (${edit.status})`);
      return say(MSG.editFailed);
    }
  } catch (err) {
    console.error('poll vote flow failed:', err instanceof Error ? err.message : err);
    try {
      await say(MSG.outage);
    } catch {
      // The interaction token itself failed — nothing left to answer with.
    }
  }
}
