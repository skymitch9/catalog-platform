/**
 * GABI's book-club DISCUSSION QUESTIONS, posted into each club's own Discord
 * channel (owner's ask, 2026-08-18: "you know how for bookclub gabi can post
 * questions in each book club? lets add that feature to the discord bot").
 *
 * ## What the site's feature actually is — measured, not assumed
 *
 * The thing the owner is pointing at is NOT a poll. Measured 2026-08-18
 * against `audiobook_catalog/site/club-read.html` + `site/club-reads.js`:
 *
 *  - `site/discussion_prompts.json` holds AI-written starter questions per
 *    book — `{ "<Book Title>": { prompts: [{ chapter_index, question }] } }`,
 *    generated offline by `app/tools/generate_prompts.py`. It is a static
 *    site asset; nothing about it is per-club or live.
 *  - On the read page, `starterQuestionHtml()` shows ONE matching prompt for a
 *    section — to hosts/mods only, and only while `club.promptsEnabled !== false`
 *    — behind a **"Post as GABI"** button.
 *  - Pressing it calls `addComment(..., { asBot: true })`, which writes an
 *    ORDINARY COMMENT into `clubs/{id}/reads/{readId}/comments/{commentId}`
 *    carrying `isBot: true`, `slug: 'gabi'`, `displayName: 'GABI'`, the
 *    section's `milestoneId` (or `'general'` + a `partIndex`), and the
 *    question as its `text`.
 *
 * So: **the questions are open discussion prompts, not votable polls, and the
 * site's own trigger is a human pressing a button.** That decides this whole
 * module. There is no tally, no option list, nothing to click — so this posts
 * a plain embed with NO components, deliberately, and never touches the
 * button/`custom_id` machinery `poll-vote.ts` owns. A question that arrived as
 * a comment goes out as a message people can simply reply to.
 *
 * ⚠️ Corollary worth stating because it is easy to get backwards: there is
 * nothing to sync BACK. A poll has a vote that belongs in Firestore; a
 * discussion question's replies are Discord's own conversation. This is a
 * one-way publisher, and pretending otherwise would mean inventing a
 * comment-writing path with no identity behind it.
 *
 * ## Who triggers it, and why not a cron
 *
 * The same place `poll-sync.ts` is triggered from, for the same reasons:
 * `audiobook_catalog/app/club_announcements.py` already runs on the pipeline's
 * ~8-hour cadence and already pokes `POST /polls/sync`. It now pokes
 * `POST /questions/sync` beside it, gated by the SAME `POLL_SYNC_TOKEN` — no
 * new secret, no new schedule, no new always-on anything.
 *
 * A SEPARATE ROUTE rather than more work inside the poll tick, deliberately:
 * the two features share a cadence and nothing else, and a question sweep that
 * threw would otherwise take the poll tick's tallies down with it. Independent
 * failure domains is the same value `club_announcements.py` states about its
 * own relationship to the sync endpoint.
 *
 * ## The two state collections, both owned outright by this Worker
 *
 *   `discord_question_messages/{clubCol}__{clubId}__{readId}__{commentId}`
 *       { clubCol, clubId, readId, commentId, channelId, messageId,
 *         postedAt, updatedAt }
 *
 *   `discord_question_state/{clubCol}__{clubId}`
 *       { clubCol, clubId, baselinedAt (ms), updatedAt }
 *
 * Neither lives beside the club, for `poll-sync.ts`'s reason 1: a comment doc
 * is browser-writable under `firestore.rules`, and Worker bookkeeping inside a
 * doc a browser can rewrite is a collision waiting to happen. Neither needs a
 * rules change: `firestore.rules` has no catch-all, so browsers are denied by
 * default and the service account bypasses rules — the same posture as
 * `discord_links/*` and `discord_poll_messages/*`.
 *
 * ## ⚠️ Baseline-first silence — the rail that matters most here
 *
 * This is the one place the design departs from `poll-sync.ts`, and it has to.
 * A club has a handful of polls; it accumulates a GABI question per SECTION
 * per book, so a club switching the feature on could have thirty already
 * sitting there. Posting history into a channel is the failure mode that would
 * make somebody turn it straight back off.
 *
 * So the FIRST tick a club is ever seen on writes `baselinedAt = now` and
 * posts NOTHING, in words, exactly the discipline `club_announcements.py`
 * already uses for its own first run. Only questions created AFTER that
 * instant are ever posted. Turning the feature on is therefore quiet by
 * construction, and it starts working the moment somebody presses "Post as
 * GABI" again.
 *
 * ## Idempotence
 *
 * A tick is safe to run twice and safe to run beside itself. The per-question
 * record is the key: PRESENT ⇒ this question is already in the channel and is
 * skipped outright; ABSENT ⇒ post it and write the record. A question's text
 * never changes on the site (there is no edit affordance on a bot comment), so
 * unlike a poll there is no re-render pass at all — a posted question is
 * finished business forever.
 *
 * ⚠️ Deletion is deliberately NOT propagated. A host can delete a GABI comment
 * on the site; the Discord message stays. By the time a tick could notice, the
 * message may already carry a conversation, and deleting somebody's discussion
 * out from under them to mirror a site-side tidy-up is worse than a stale
 * prompt. Stated here because "we could have and chose not to" is a different
 * fact from "nobody thought of it".
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { createChannelMessage, getWebhookChannelId, type Sleeper } from './discord-api.js';
import { EMBED_COLOR } from './have.js';
import { DEFAULT_CATALOG_BASE } from './catalog-data.js';
import {
  bearerToken,
  docIdFromName,
  laneCollection,
  listAll,
  secretsMatch,
  type DiscordResult,
  type FsDoc,
  type FsValue,
} from './poll-sync.js';
import type { ClubCollection } from './poll-vote.js';
import {
  firestoreRequest,
  mintAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from './firebase-sa.js';

export const QUESTION_COLLECTION = 'discord_question_messages';
export const QUESTION_STATE_COLLECTION = 'discord_question_state';

/** Firestore doc id for one posted question — states all four facts, so the
 * record can never address the wrong question across lanes or reads. */
export function questionRecordKey(
  clubCol: string,
  clubId: string,
  readId: string,
  commentId: string,
): string {
  return `${clubCol}__${clubId}__${readId}__${commentId}`;
}

/** Firestore doc id for one club's baseline. */
export function questionStateKey(clubCol: string, clubId: string): string {
  return `${clubCol}__${clubId}`;
}

/**
 * Blast rails.
 *
 * `MAX_READS_PER_CLUB` is generous rather than tight because the SITE already
 * bounds this: `MAX_ACTIVE_READS` is 2 in `club-reads.js`, and only active
 * reads are considered at all. The cap exists so a corrupted `status` field
 * cannot make one club's tick unbounded.
 *
 * `MAX_QUESTIONS_PER_TICK` is the one a person will actually meet: a host who
 * sits down and posts a question into every section of a book would otherwise
 * dump ten messages into the channel at once. The rest are left for the next
 * tick and SAID SO, never dropped silently.
 */
export const MAX_READS_PER_CLUB = 8;
export const MAX_QUESTIONS_PER_TICK = 5;
/** The note list is for a human to read, not a log drain. */
const MAX_NOTES = 60;

// ---------------------------------------------------------------------------
// The shapes the tick works in
// ---------------------------------------------------------------------------

export interface QuestionClubRow {
  id: string;
  name: string;
  questionsEnabled: boolean;
}

/** One active read, with just enough of it to name a section. */
export interface ReadRow {
  id: string;
  bookTitle: string;
  /** `{ id, label, position }` — the site's milestone vocabulary. */
  milestones: Array<{ id: string; label: string }>;
}

/** One GABI-authored comment: a question waiting to be published. */
export interface QuestionRow {
  id: string;
  text: string;
  milestoneId: string;
  partIndex: number | null;
  /** Epoch ms. `null` when the serverTimestamp has not resolved yet. */
  createdAtMs: number | null;
}

export interface QuestionRecord {
  channelId: string;
  messageId: string;
}

export interface QuestionSyncDeps {
  listClubs(): Promise<QuestionClubRow[]>;
  /** `clubs/{id}/settings/discord` → the club's Discord config, or null. */
  discordSettings(clubId: string): Promise<{ webhookUrl: string; discordChannelId: string } | null>;
  /** Active reads only — the site caps a club at two of them. */
  listActiveReads(clubId: string): Promise<ReadRow[]>;
  /** Every `isBot: true` comment on one read. */
  listQuestions(clubId: string, readId: string): Promise<QuestionRow[]>;
  readBaseline(key: string): Promise<number | null>;
  writeBaseline(key: string, clubCol: string, clubId: string, baselinedAt: number): Promise<void>;
  readRecord(key: string): Promise<QuestionRecord | null>;
  writeRecord(
    key: string,
    record: QuestionRecord & {
      clubCol: string;
      clubId: string;
      readId: string;
      commentId: string;
    },
  ): Promise<void>;
  postMessage(channelId: string, payload: unknown): Promise<DiscordResult>;
  resolveWebhookChannel(webhookUrl: string): Promise<string | null>;
  /** Injected so the baseline instant is deterministic in tests. */
  now(): number;
}

export interface QuestionSyncStats {
  clubs_considered: number;
  clubs_opted_in: number;
  baselined: number;
  posted: number;
  skipped: number;
  notes: string[];
}

const emptyStats = (): QuestionSyncStats => ({
  clubs_considered: 0,
  clubs_opted_in: 0,
  baselined: 0,
  posted: 0,
  skipped: 0,
  notes: [],
});

/** Every skip is a sentence, never a status code — the estate's
 * no-bare-status rule applies to machine-read reports too, because the human
 * reading the pipeline log is the one who has to fix it. */
export const QUESTION_MSG = {
  baselined: (label: string) =>
    `${label}: first time this club has been seen for question posting, so nothing was posted — ` +
    'the questions already on the site stay where they are rather than flooding the channel. ' +
    'Questions posted from here on will appear.',
  noChannel: (label: string) =>
    `${label}: GABI's questions are switched on, but no channel could be worked out. The club has ` +
    'neither a `discordChannelId` on `settings/discord` nor a webhook URL whose channel Discord ' +
    'would name. Nothing was posted — add either one and it will post on the next tick.',
  postRefused: (label: string, status: number) =>
    `${label}: Discord refused to post a question (HTTP ${status}) — most often the bot is not in ` +
    'that server, or lacks Send Messages / Embed Links in that channel. Nothing was posted; the ' +
    'tick will try again.',
  capped: (label: string, total: number) =>
    `${label}: ${total} new questions is more than one tick posts (cap ${MAX_QUESTIONS_PER_TICK}); ` +
    'the rest are left for the next tick rather than dropped.',
  cappedReads: (label: string, total: number) =>
    `${label}: ${total} active reads is more than one tick sweeps (cap ${MAX_READS_PER_CLUB}); the ` +
    'rest are left for the next tick rather than dropped.',
  clubFailed: (label: string, detail: string) =>
    `${label}: this club was skipped because something went wrong reading or posting it (${detail}). ` +
    'Every other club was unaffected, and the tick will retry this one next time.',
} as const;

// ---------------------------------------------------------------------------
// Pure rendering — what a posted question actually looks like
// ---------------------------------------------------------------------------

/** The site's own constant (`club-reads.js`): a comment not tied to a named
 * milestone carries this id and leans on `partIndex` instead. */
export const GENERAL_MILESTONE = 'general';

/**
 * Name the section a question belongs to, or `null` when it cannot be named
 * honestly.
 *
 * ⚠️ Three cases, and the third is why this returns `null` rather than
 * guessing. A milestone-shaped read resolves its label by id. A
 * chapter-grouped read posts under `'general'` with a `partIndex`, and the
 * site computes that group's label CLIENT-SIDE from `chapterTitles` — this
 * Worker does not reimplement that derivation (two implementations of one
 * label is exactly the "canonical implementation" trap), so it says
 * `Part <n>` from the index it does have. Anything else is unnamed, and an
 * unnamed section simply drops out of the title rather than appearing as
 * something wrong.
 */
export function sectionLabel(read: ReadRow, question: QuestionRow): string | null {
  if (question.milestoneId && question.milestoneId !== GENERAL_MILESTONE) {
    const found = read.milestones.find((m) => m.id === question.milestoneId);
    if (found && found.label) return found.label;
  }
  if (typeof question.partIndex === 'number' && question.partIndex >= 0) {
    return `Part ${question.partIndex + 1}`;
  }
  return null;
}

const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1)}…`;

/** Deep link straight to the question where it lives on the site. The read
 * page reads `#c-<commentId>` (`club-read.html`, measured 2026-08-18): it
 * finds that comment, opens its section and scrolls to it — so this is a link
 * to the QUESTION, not merely to the page it is on. */
export function questionPageUrl(
  siteBase: string,
  clubCol: ClubCollection,
  clubId: string,
  readId: string,
  commentId: string,
): string {
  const base = siteBase.replace(/\/+$/, '');
  const lane = clubCol === 'clubs_dev' ? '/dev' : '';
  return (
    `${base}${lane}/club-read.html?club=${encodeURIComponent(clubId)}` +
    `&read=${encodeURIComponent(readId)}#c-${encodeURIComponent(commentId)}`
  );
}

/**
 * The message.
 *
 * ⚠️ No model call, and that is a decision rather than a shortcut. The
 * question TEXT is already written (offline, by `generate_prompts.py`, and
 * then chosen by a human pressing "Post as GABI") — asking a model to
 * paraphrase it would spend money to make the club page and the channel say
 * different things. GABI's voice here is the FRAME around a question she
 * already asked: warm, first-person, short, no preamble, pointing at where the
 * conversation lives. That is her documented register (`gabi-chat.ts`
 * `CHAT_SYSTEM`), rendered deterministically so it is testable and free.
 *
 * ⚠️ Spoilers: the section is named in the TITLE, prominently, so anybody
 * behind can skip the message — and the question text is NOT hidden behind
 * spoiler bars. That matches the site's own posture for comments, which are
 * merely collapsed under a section heading rather than locked; the site locks
 * POLLS by reading position (`isPollLocked`), and deliberately does not lock
 * discussion comments. A channel cannot gate per-reader anyway, so the honest
 * option is to label loudly rather than to imply a protection that is not
 * there.
 */
export function buildQuestionMessage(opts: {
  clubName: string;
  bookTitle: string;
  section: string | null;
  question: string;
  url: string;
}): { embeds: unknown[] } {
  const heading = opts.section
    ? `${opts.bookTitle} — ${opts.section}`
    : opts.bookTitle || 'A question for the club';
  const where = opts.section ? `for ${opts.section}` : 'for this one';
  return {
    embeds: [
      {
        title: truncate(heading, 256),
        description: truncate(
          `> ${opts.question}\n\n` +
            `Something to chew on ${where}. Say it here if you like — or [take it to the club page]` +
            `(${opts.url}), where it sits with the rest of the discussion.`,
          4096,
        ),
        color: EMBED_COLOR,
        footer: { text: truncate(`${opts.clubName || 'Book club'} · a question from GABI`, 2048) },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

async function syncClubQuestions(
  deps: QuestionSyncDeps,
  clubCol: ClubCollection,
  club: QuestionClubRow,
  siteBase: string,
  stats: QuestionSyncStats,
): Promise<void> {
  const label = `${clubCol}/${club.id} (${club.name || '?'})`;
  const note = (line: string) => {
    if (stats.notes.length < MAX_NOTES) stats.notes.push(line);
  };

  // ⚠️ FIRST, before any read is listed or any channel resolved: a club with
  // no baseline is brand new to this feature, and the whole point is that it
  // posts nothing at all on that tick.
  const stateKey = questionStateKey(clubCol, club.id);
  const baseline = await deps.readBaseline(stateKey);
  if (baseline === null) {
    await deps.writeBaseline(stateKey, clubCol, club.id, deps.now());
    stats.baselined += 1;
    note(QUESTION_MSG.baselined(label));
    return;
  }

  // Channel resolution is LAZY and memoized, exactly as poll-sync does it: a
  // club with no new questions never needs it, and resolving it costs a
  // Discord call.
  let channelId: string | null | undefined;
  const channel = async (): Promise<string | null> => {
    if (channelId !== undefined) return channelId;
    const settings = await deps.discordSettings(club.id);
    // The explicit field wins; absent, the bot posts where the club's
    // announcements already go — the channel that club already agreed to.
    if (settings?.discordChannelId) {
      channelId = settings.discordChannelId;
    } else if (settings?.webhookUrl) {
      channelId = await deps.resolveWebhookChannel(settings.webhookUrl);
    } else {
      channelId = null;
    }
    return channelId;
  };

  const reads = await deps.listActiveReads(club.id);
  if (reads.length > MAX_READS_PER_CLUB) note(QUESTION_MSG.cappedReads(label, reads.length));

  // Gather across every active read FIRST, so the per-tick cap applies to the
  // club as a whole and the oldest question always goes out first — a channel
  // that got questions out of order would read as nonsense.
  const pending: Array<{ read: ReadRow; question: QuestionRow }> = [];
  for (const read of reads.slice(0, MAX_READS_PER_CLUB)) {
    for (const question of await deps.listQuestions(club.id, read.id)) {
      // An unresolved serverTimestamp is not "old" — it is not yet knowable.
      // Skipping it costs one tick; treating it as 0 would post it forever
      // after, and treating it as now would post the history it guards.
      if (question.createdAtMs === null) continue;
      if (question.createdAtMs <= baseline) continue;
      if (!question.text.trim()) continue;
      pending.push({ read, question });
    }
  }
  pending.sort((a, b) => (a.question.createdAtMs ?? 0) - (b.question.createdAtMs ?? 0));

  // The record check happens AFTER gathering and BEFORE the cap, so a tick
  // whose questions are all already posted does no Discord work at all and
  // does not report a spurious cap.
  const unposted: Array<{ read: ReadRow; question: QuestionRow }> = [];
  for (const item of pending) {
    const key = questionRecordKey(clubCol, club.id, item.read.id, item.question.id);
    if (await deps.readRecord(key)) {
      stats.skipped += 1;
      continue;
    }
    unposted.push(item);
  }
  if (unposted.length > MAX_QUESTIONS_PER_TICK) note(QUESTION_MSG.capped(label, unposted.length));

  for (const { read, question } of unposted.slice(0, MAX_QUESTIONS_PER_TICK)) {
    const target = await channel();
    if (!target) {
      note(QUESTION_MSG.noChannel(label));
      stats.skipped += 1;
      return; // no channel is a club-wide fact, not a per-question one
    }
    const payload = buildQuestionMessage({
      clubName: club.name,
      bookTitle: read.bookTitle,
      section: sectionLabel(read, question),
      question: question.text.trim(),
      url: questionPageUrl(siteBase, clubCol, club.id, read.id, question.id),
    });
    const post = await deps.postMessage(target, payload);
    if (!post.ok || !post.messageId) {
      note(QUESTION_MSG.postRefused(label, post.status));
      stats.skipped += 1;
      // A refusal is almost always club-wide (bot absent, no permission), so
      // stop rather than earn the same refusal four more times.
      return;
    }
    // ⚠️ The record is written IMMEDIATELY after the post and before the next
    // one, so a tick killed halfway leaves every message it sent recorded.
    // Batching these at the end would make a crash re-post everything.
    await deps.writeRecord(questionRecordKey(clubCol, club.id, read.id, question.id), {
      channelId: target,
      messageId: post.messageId,
      clubCol,
      clubId: club.id,
      readId: read.id,
      commentId: question.id,
    });
    stats.posted += 1;
  }
}

/**
 * One question-sync tick over one lane. Never throws: a club that blows up is
 * a named skip, and every other club still syncs.
 */
export async function runQuestionSync(
  deps: QuestionSyncDeps,
  clubCol: ClubCollection,
  siteBase: string,
): Promise<QuestionSyncStats> {
  const stats = emptyStats();
  let clubs: QuestionClubRow[];
  try {
    clubs = await deps.listClubs();
  } catch (err) {
    stats.notes.push(
      'No clubs could be listed at all, so no questions were posted this tick (a service problem ' +
        `reaching Firestore, not a permissions one): ${err instanceof Error ? err.message : String(err)}`,
    );
    return stats;
  }

  for (const club of clubs) {
    stats.clubs_considered += 1;
    // Per-club opt-in, default OFF. A club that never opted in is not an
    // event; it is the normal case, and it makes no note.
    if (!club.questionsEnabled) continue;
    stats.clubs_opted_in += 1;
    try {
      await syncClubQuestions(deps, clubCol, club, siteBase, stats);
    } catch (err) {
      stats.notes.push(
        QUESTION_MSG.clubFailed(
          `${clubCol}/${club.id} (${club.name || '?'})`,
          err instanceof Error ? err.message : String(err),
        ),
      );
      stats.skipped += 1;
    }
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Firestore decoding
// ---------------------------------------------------------------------------

const fsString = (v: FsValue | undefined): string | null =>
  typeof v?.stringValue === 'string' ? v.stringValue : null;

/** club doc → is `features.discordQuestions` affirmatively true? The same
 * affirmative shape `clubVotingEnabled` uses, and a SEPARATE key from it: a
 * club can want GABI's questions without wiring up votable polls, and the
 * reverse. */
export function clubQuestionsEnabled(doc: FsDoc): boolean {
  return doc.fields?.features?.mapValue?.fields?.discordQuestions?.booleanValue === true;
}

/** Firestore `timestampValue` → epoch ms, or null. A comment whose
 * `serverTimestamp()` has not resolved has no timestamp field at all. */
export function timestampMs(v: FsValue | undefined): number | null {
  const raw = v?.timestampValue;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function readFromDoc(doc: FsDoc): ReadRow | null {
  const id = docIdFromName(doc.name);
  if (!id) return null;
  const milestones: Array<{ id: string; label: string }> = [];
  for (const v of doc.fields?.milestones?.arrayValue?.values ?? []) {
    const f = v.mapValue?.fields;
    const mid = fsString(f?.id);
    if (mid) milestones.push({ id: mid, label: fsString(f?.label) ?? '' });
  }
  return { id, bookTitle: fsString(doc.fields?.bookTitle) ?? '', milestones };
}

/** A comment doc → a question, or null when it is not one of GABI's. */
export function questionFromDoc(doc: FsDoc): QuestionRow | null {
  if (doc.fields?.isBot?.booleanValue !== true) return null;
  const id = docIdFromName(doc.name);
  const text = fsString(doc.fields?.text);
  if (!id || text === null) return null;
  const rawPart = doc.fields?.partIndex?.integerValue;
  const partIndex =
    rawPart === undefined ? null : Number.isInteger(Number(rawPart)) ? Number(rawPart) : null;
  return {
    id,
    text,
    milestoneId: fsString(doc.fields?.milestoneId) ?? GENERAL_MILESTONE,
    partIndex,
    createdAtMs: timestampMs(doc.fields?.createdAt),
  };
}

export function questionRecordFromDoc(doc: FsDoc): QuestionRecord | null {
  const channelId = fsString(doc.fields?.channelId);
  const messageId = fsString(doc.fields?.messageId);
  if (!channelId || !messageId) return null;
  return { channelId, messageId };
}

// ---------------------------------------------------------------------------
// The real dependencies — Firestore REST + the bot token
// ---------------------------------------------------------------------------

export function firestoreQuestionDeps(
  sa: ServiceAccount,
  botToken: string,
  clubCol: ClubCollection,
  sleep?: Sleeper,
): QuestionSyncDeps {
  let tokenPromise: Promise<string> | null = null;
  const token = () => (tokenPromise ??= mintAccessToken(sa));

  return {
    async listClubs() {
      const at = await token();
      const docs = await listAll(sa, at, clubCol, 'mask.fieldPaths=name&mask.fieldPaths=features');
      const rows: QuestionClubRow[] = [];
      for (const doc of docs) {
        const id = docIdFromName(doc.name);
        if (!id) continue;
        rows.push({
          id,
          name: doc.fields?.name?.stringValue ?? '',
          questionsEnabled: clubQuestionsEnabled(doc),
        });
      }
      return rows;
    },

    async discordSettings(clubId) {
      const at = await token();
      const res = await firestoreRequest(
        sa,
        at,
        'GET',
        `${clubCol}/${clubId}/settings/discord?mask.fieldPaths=webhookUrl&mask.fieldPaths=discordChannelId`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`discord settings read failed (${res.status})`);
      const doc = (await res.json()) as FsDoc;
      return {
        webhookUrl: doc.fields?.webhookUrl?.stringValue ?? '',
        discordChannelId: doc.fields?.discordChannelId?.stringValue ?? '',
      };
    },

    async listActiveReads(clubId) {
      const at = await token();
      const docs = await listAll(
        sa,
        at,
        `${clubCol}/${clubId}/reads`,
        'mask.fieldPaths=bookTitle&mask.fieldPaths=status&mask.fieldPaths=milestones',
      );
      const rows: ReadRow[] = [];
      for (const doc of docs) {
        // Active reads only. The site caps a club at two, and a finished
        // book's discussion is over — a question posted onto an archived read
        // stays on the site, which is where it makes sense.
        if (doc.fields?.status?.stringValue !== 'active') continue;
        const row = readFromDoc(doc);
        if (row) rows.push(row);
      }
      return rows;
    },

    async listQuestions(clubId, readId) {
      const at = await token();
      // ⚠️ A masked LIST rather than a `runQuery` with `where isBot == true`.
      // The mask keeps each doc to five small fields, and at estate scale
      // (≤2 active reads per club, tens of comments) that is cheaper than
      // introducing this Worker's first structured query and the index
      // question that comes with it. If a read's comments ever run to
      // thousands, this is the line to revisit — it is the only place in the
      // tick whose cost grows with ordinary member activity.
      const docs = await listAll(
        sa,
        at,
        `${clubCol}/${clubId}/reads/${readId}/comments`,
        'mask.fieldPaths=isBot&mask.fieldPaths=text&mask.fieldPaths=milestoneId' +
          '&mask.fieldPaths=partIndex&mask.fieldPaths=createdAt',
      );
      const rows: QuestionRow[] = [];
      for (const doc of docs) {
        const row = questionFromDoc(doc);
        if (row) rows.push(row);
      }
      return rows;
    },

    async readBaseline(key) {
      const at = await token();
      const res = await firestoreRequest(
        sa,
        at,
        'GET',
        `${QUESTION_STATE_COLLECTION}/${encodeURIComponent(key)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`question baseline read failed (${res.status})`);
      const doc = (await res.json()) as FsDoc;
      const raw = doc.fields?.baselinedAt?.integerValue;
      if (raw === undefined) return null;
      const ms = Number(raw);
      return Number.isFinite(ms) ? ms : null;
    },

    async writeBaseline(key, clubColArg, clubId, baselinedAt) {
      const at = await token();
      const fields: Record<string, FsValue> = {
        clubCol: { stringValue: clubColArg },
        clubId: { stringValue: clubId },
        baselinedAt: { integerValue: String(baselinedAt) },
        updatedAt: { timestampValue: new Date().toISOString() },
      };
      const mask = Object.keys(fields)
        .map((f) => `updateMask.fieldPaths=${f}`)
        .join('&');
      const res = await firestoreRequest(
        sa,
        at,
        'PATCH',
        `${QUESTION_STATE_COLLECTION}/${encodeURIComponent(key)}?${mask}`,
        { fields },
      );
      if (!res.ok) throw new Error(`question baseline write failed (${res.status})`);
    },

    async readRecord(key) {
      const at = await token();
      const res = await firestoreRequest(
        sa,
        at,
        'GET',
        `${QUESTION_COLLECTION}/${encodeURIComponent(key)}`,
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`question record read failed (${res.status})`);
      return questionRecordFromDoc((await res.json()) as FsDoc);
    },

    async writeRecord(key, record) {
      const at = await token();
      const nowIso = new Date().toISOString();
      const fields: Record<string, FsValue> = {
        clubCol: { stringValue: record.clubCol },
        clubId: { stringValue: record.clubId },
        readId: { stringValue: record.readId },
        commentId: { stringValue: record.commentId },
        channelId: { stringValue: record.channelId },
        messageId: { stringValue: record.messageId },
        postedAt: { timestampValue: nowIso },
        updatedAt: { timestampValue: nowIso },
      };
      const mask = Object.keys(fields)
        .map((f) => `updateMask.fieldPaths=${f}`)
        .join('&');
      const res = await firestoreRequest(
        sa,
        at,
        'PATCH',
        `${QUESTION_COLLECTION}/${encodeURIComponent(key)}?${mask}`,
        { fields },
      );
      if (!res.ok) throw new Error(`question record write failed (${res.status})`);
    },

    async postMessage(channelId, payload) {
      const res = await createChannelMessage(botToken, channelId, payload, sleep);
      if (!res.ok) return { ok: false, status: res.status };
      try {
        const body = (await res.json()) as { id?: unknown };
        if (typeof body.id === 'string' && body.id.length > 0) {
          return { ok: true, status: res.status, messageId: body.id };
        }
      } catch {
        // A 2xx whose body we cannot read is NOT a success we can record:
        // without the message id the next tick would post a duplicate.
      }
      return { ok: false, status: res.status };
    },

    async resolveWebhookChannel(webhookUrl) {
      return getWebhookChannelId(webhookUrl, sleep);
    },

    now() {
      return Date.now();
    },
  };
}

// ---------------------------------------------------------------------------
// The route — POST /questions/sync
// ---------------------------------------------------------------------------

export const QUESTION_ROUTE_MSG = {
  /** SHIPS DARK, on the SAME secret the poll sync uses — one shared pipeline
   * token, two routes, because both are "the audiobook pipeline poking this
   * Worker on its own cadence" and neither grants any Discord power. */
  notConfigured:
    'Question posting is not switched on yet: the Worker has no POLL_SYNC_TOKEN, so it cannot tell ' +
    'a real caller from anyone else and refuses to act. Nothing was posted. Set it with ' +
    '`wrangler secret put POLL_SYNC_TOKEN` from apps/discord-worker and give the same value to the ' +
    'pipeline as POLL_SYNC_TOKEN (docs/access/discord-bot.md, the club-question sync section).',
  unauthorized:
    'This request did not carry the shared pipeline token, so no questions were posted. Send it as ' +
    '`Authorization: Bearer <POLL_SYNC_TOKEN>`. If you are a person who reached this URL in a ' +
    'browser: there is nothing to see here, and nothing was changed.',
  botTokenMissing:
    'Questions cannot be posted because the Worker has no DISCORD_BOT_TOKEN (a configuration gap, ' +
    'NOT a permissions problem). Nothing was posted — see docs/access/discord-bot.md §2.',
  serviceAccountMissing:
    'Questions cannot be posted because the Worker has no usable FIREBASE_SERVICE_ACCOUNT (a ' +
    'configuration gap, NOT a permissions problem). Nothing was posted or changed.',
  badLane: 'Unknown lane. Send `{"lane":"prod"}` or `{"lane":"dev"}` — nothing was posted.',
} as const;

export const questionSyncRoutes = new Hono<AppBindings>();

questionSyncRoutes.post('/questions/sync', async (c) => {
  const expected = c.env.POLL_SYNC_TOKEN;
  // Ships-dark check FIRST: with no secret set there is no such thing as an
  // authorised caller, so "unset" is the honest answer to everyone.
  if (!expected) return c.json({ ok: false, message: QUESTION_ROUTE_MSG.notConfigured }, 503);

  const presented = bearerToken(c.req.header('authorization'));
  if (!presented || !secretsMatch(presented, expected)) {
    return c.json({ ok: false, message: QUESTION_ROUTE_MSG.unauthorized }, 401);
  }

  let lane: unknown;
  try {
    const body = (await c.req.json()) as { lane?: unknown };
    lane = body?.lane;
  } catch {
    lane = c.req.query('lane'); // an empty POST is a perfectly good prod tick
  }
  const clubCol = laneCollection(lane);
  if (!clubCol) return c.json({ ok: false, message: QUESTION_ROUTE_MSG.badLane }, 400);

  const botToken = c.env.DISCORD_BOT_TOKEN;
  if (!botToken) return c.json({ ok: false, message: QUESTION_ROUTE_MSG.botTokenMissing }, 503);

  let sa: ServiceAccount | null;
  try {
    sa = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT malformed:', err instanceof Error ? err.message : err);
    sa = null;
  }
  if (!sa) return c.json({ ok: false, message: QUESTION_ROUTE_MSG.serviceAccountMissing }, 503);

  // Reuses the EXISTING audiobook-site var rather than naming a new one: the
  // club pages live on the same host `catalog.csv` is read from.
  const siteBase = c.env.CATALOG_BASE_URL || DEFAULT_CATALOG_BASE;
  const stats = await runQuestionSync(
    firestoreQuestionDeps(sa, botToken, clubCol),
    clubCol,
    siteBase,
  );
  return c.json({ ok: true, lane: clubCol, ...stats });
});
