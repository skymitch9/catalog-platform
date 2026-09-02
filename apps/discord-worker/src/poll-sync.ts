/**
 * PHASE 3 — bot-posted poll messages, their tally refresh, and close
 * propagation (design §2a / §3 phase 3; mechanics research §6 "Close/freeze
 * propagation").
 *
 * Phase 2 made a Discord click become a vote. Nothing, until this file,
 * POSTED the thing to click: a club could opt in, the bot could sit in the
 * server, and the channel would stay empty. This is the other half.
 *
 * ## Who triggers it, and why not a cron
 *
 * `audiobook_catalog/app/club_announcements.py` already runs on the pipeline's
 * ~8-hour cadence, already knows which clubs exist, which have polls, and
 * which have Discord configured — the research doc's own recommendation (§6:
 * "piggyback on the existing club_announcements.py cadence"). So the trigger
 * is a POST from that script to `POST /polls/sync`, gated by a shared secret
 * (`POLL_SYNC_TOKEN`).
 *
 * ⚠️ The script sends NO club data — only the lane. Every fact this tick acts
 * on is read by the Worker with its own service account. A trigger that
 * carried club ids, webhook URLs or vote counts would make the announcements
 * script a second source of truth for things Firestore already holds, and
 * would put a webhook capability on the wire for no reason.
 *
 * ## Independent failure domains
 *
 * The announcements script never fails because this endpoint is down, and
 * this endpoint never posts an announcement embed. They share a cadence and
 * nothing else — the webhook announcements are permanent and unchanged
 * (design §0), and this is additive on top.
 *
 * ## State — `discord_poll_messages/{clubCol}__{clubId}__{pollId}`
 *
 * A TOP-LEVEL collection this Worker owns outright:
 *
 *   { clubCol, clubId, pollId, channelId, messageId,
 *     renderedStatus: 'open' | 'closed', postedAt, updatedAt }
 *
 * Three deliberate choices:
 *
 *  1. **Not beside the poll.** `clubs/{id}/polls/{pollId}` is browser-writable
 *     under `firestore.rules` and is edited by the club page's own manager UI.
 *     A Worker-owned bookkeeping field living in a doc a browser can rewrite
 *     is a collision waiting to happen; a separate collection cannot be
 *     clobbered by the club page, by `club_announcements.py` (which writes
 *     only `settings/announceState`), or by the vote path (which writes only
 *     `polls/{id}/votes/{slug}`).
 *  2. **Composite id, not the bare `pollId`.** Poll ids are Firestore auto-ids
 *     and effectively unique — but "effectively" is not a contract, and the
 *     prod and dev lanes (`clubs` / `clubs_dev`) are two separate universes
 *     that could legitimately hold the same id. The key states all three
 *     facts, so the doc can never address the wrong poll.
 *  3. **No rules change.** Nothing grants a browser access to this collection
 *     and `firestore.rules` has no catch-all, so browsers are denied by
 *     default; the service account bypasses rules. Same posture as
 *     `discord_links/*` (access/discord-bot.md §6).
 *
 * ## Idempotence
 *
 * A tick is safe to run twice, and safe to run beside itself. The stored
 * `messageId` is the key: present ⇒ EDIT, absent ⇒ POST. A closed poll whose
 * record already reads `renderedStatus: 'closed'` is skipped entirely, so
 * close propagation happens exactly once. A closed poll with NO record is
 * never posted at all — the bot does not introduce a poll nobody could vote
 * in.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import {
  buildPollMessage,
  clubPollAnnouncementsEnabled,
  clubVotingEnabled,
  listVoteIndices,
  pollFromDoc,
  tallyVotes,
  type ClubCollection,
  type PollDoc,
  type PollVoteRef,
} from './poll-vote.js';
import {
  createChannelMessage,
  editChannelMessage,
  getWebhookChannelId,
  type Sleeper,
} from './discord-api.js';
import {
  firestoreRequest,
  mintAccessToken,
  parseServiceAccount,
  type ServiceAccount,
} from './firebase-sa.js';

/** Firestore doc id for a poll's message record — states all three facts. */
export function messageRecordKey(clubCol: string, clubId: string, pollId: string): string {
  return `${clubCol}__${clubId}__${pollId}`;
}

export const MESSAGE_COLLECTION = 'discord_poll_messages';

/** Blast rail: one club cannot make a tick unbounded. Polls beyond this are
 * left for the next tick and SAID SO, never dropped silently. */
export const MAX_POLLS_PER_CLUB = 10;
/** Blast rail: the note list is for a human to read, not a log drain. */
const MAX_NOTES = 60;

// ---------------------------------------------------------------------------
// The shapes the tick works in
// ---------------------------------------------------------------------------

export interface ClubRow {
  id: string;
  name: string;
  votingEnabled: boolean;
  /** ⚠️ `features.discordPollAnnouncements`, read with the OPPOSITE default to
   *  `votingEnabled`: ABSENT MEANS YES. See `clubPollAnnouncementsEnabled` in
   *  poll-vote.ts for why — the affirmative form would have silently switched
   *  off every club that already announces, because no club doc carries the key
   *  yet. Optional on the interface so an existing test fixture that predates
   *  the toggle still describes a club that announces. */
  announcementsEnabled?: boolean;
}

export interface PollRow {
  id: string;
  poll: PollDoc;
}

export interface MessageRecord {
  channelId: string;
  messageId: string;
  renderedStatus: 'open' | 'closed';
}

export interface DiscordResult {
  ok: boolean;
  status: number;
  messageId?: string;
}

/**
 * Everything the tick touches that is not pure. Injected so the orchestration
 * — which is the part with the idempotence rules in it — is testable without
 * a network, and so a test that accidentally reached Firestore would fail
 * loudly rather than quietly write production data.
 */
export interface SyncDeps {
  listClubs(): Promise<ClubRow[]>;
  /** `clubs/{id}/settings/discord` → the club's Discord config, or null. */
  discordSettings(clubId: string): Promise<{ webhookUrl: string; discordChannelId: string } | null>;
  listPolls(clubId: string): Promise<PollRow[]>;
  tallies(clubId: string, pollId: string, optionCount: number): Promise<number[]>;
  readRecord(key: string): Promise<MessageRecord | null>;
  writeRecord(key: string, record: MessageRecord & { clubCol: string; clubId: string; pollId: string }): Promise<void>;
  postMessage(channelId: string, payload: unknown): Promise<DiscordResult>;
  editMessage(channelId: string, messageId: string, payload: unknown): Promise<DiscordResult>;
  resolveWebhookChannel(webhookUrl: string): Promise<string | null>;
}

export interface SyncStats {
  clubs_considered: number;
  clubs_opted_in: number;
  posted: number;
  edited: number;
  closed: number;
  skipped: number;
  notes: string[];
}

const emptyStats = (): SyncStats => ({
  clubs_considered: 0,
  clubs_opted_in: 0,
  posted: 0,
  edited: 0,
  closed: 0,
  skipped: 0,
  notes: [],
});

/**
 * Every skip is a sentence, never a status code — the estate's no-bare-status
 * rule applies to machine-read reports too, because the human reading the
 * pipeline log is the one who has to fix it.
 */
export const SYNC_MSG = {
  noChannel: (label: string) =>
    `${label}: Discord voting is on, but no channel could be worked out. The club has neither a ` +
    '`discordChannelId` on `settings/discord` nor a webhook URL whose channel Discord would name. ' +
    'Nothing was posted — add either one and it will post on the next tick.',
  postRefused: (label: string, status: number) =>
    `${label}: Discord refused to post the poll message (HTTP ${status}) — most often the bot is ` +
    'not in that server, or lacks Send Messages / Embed Links in that channel. Nothing was posted; ' +
    'the tick will try again.',
  editRefused: (label: string, status: number) =>
    `${label}: Discord refused to update the poll message (HTTP ${status}). The vote tallies on the ` +
    'club page are unaffected and correct; only the Discord copy is stale, and the next tick retries.',
  reposted: (label: string) =>
    `${label}: the poll message had been deleted in Discord, so a fresh one was posted and the ` +
    'record repointed at it.',
  clubFailed: (label: string, detail: string) =>
    `${label}: this club was skipped because something went wrong reading or posting it (${detail}). ` +
    'Every other club was unaffected, and the tick will retry this one next time.',
  /** ⚠️ Not a fault, and said so: the club chose this. The sentence names the
   *  toggle and where it lives, so nobody goes looking for a bug in the tick. */
  announcementsOff: (label: string) =>
    `${label}: Discord voting is on, but this club has poll ANNOUNCEMENTS switched off, so nothing ` +
    'was posted. That is the club’s own choice (Edit Club → Discord poll announcements), not a ' +
    'fault — votes on any poll message that is already in Discord still count.',
  capped: (label: string, total: number) =>
    `${label}: ${total} polls is more than one tick handles (cap ${MAX_POLLS_PER_CLUB}); the rest ` +
    'are left for the next tick rather than dropped.',
} as const;

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

async function syncClub(
  deps: SyncDeps,
  clubCol: ClubCollection,
  club: ClubRow,
  stats: SyncStats,
): Promise<void> {
  const label = `${clubCol}/${club.id} (${club.name || '?'})`;
  const note = (line: string) => {
    if (stats.notes.length < MAX_NOTES) stats.notes.push(line);
  };

  // Channel resolution is LAZY and memoized: a club whose polls are all
  // already posted never needs it, and resolving it costs a Discord call.
  let channelId: string | null | undefined;
  const channel = async (): Promise<string | null> => {
    if (channelId !== undefined) return channelId;
    const settings = await deps.discordSettings(club.id);
    // The explicit field wins. It exists so a club can point the bot at a
    // DIFFERENT channel from the one its announcement webhook posts to —
    // absent, the bot simply posts where the club's announcements already go,
    // which is the channel that club already agreed to.
    if (settings?.discordChannelId) {
      channelId = settings.discordChannelId;
    } else if (settings?.webhookUrl) {
      channelId = await deps.resolveWebhookChannel(settings.webhookUrl);
    } else {
      channelId = null;
    }
    return channelId;
  };

  const polls = await deps.listPolls(club.id);
  if (polls.length > MAX_POLLS_PER_CLUB) note(SYNC_MSG.capped(label, polls.length));

  for (const { id: pollId, poll } of polls.slice(0, MAX_POLLS_PER_CLUB)) {
    const key = messageRecordKey(clubCol, club.id, pollId);
    const record = await deps.readRecord(key);
    const ref: Pick<PollVoteRef, 'clubCol' | 'clubId' | 'pollId'> = {
      clubCol,
      clubId: club.id,
      pollId,
    };
    const isOpen = poll.status === 'open';

    // A closed poll that was never posted stays unposted — the bot does not
    // introduce a vote nobody can cast. A closed poll already rendered closed
    // is finished business. Both are the "nothing to do" branch, and both
    // must come before any Discord call.
    if (!isOpen && (!record || record.renderedStatus === 'closed')) {
      stats.skipped += 1;
      continue;
    }

    const tallies = await deps.tallies(club.id, pollId, poll.options.length);
    const payload = buildPollMessage(ref, poll, tallies, { closed: !isOpen });

    if (record) {
      const edit = await deps.editMessage(record.channelId, record.messageId, payload);
      if (edit.ok) {
        await deps.writeRecord(key, {
          ...record,
          renderedStatus: isOpen ? 'open' : 'closed',
          clubCol,
          clubId: club.id,
          pollId,
        });
        if (isOpen) stats.edited += 1;
        else stats.closed += 1;
        continue;
      }
      // 404 is not a failure: somebody deleted the message. Reposting an OPEN
      // poll restores it; a CLOSED poll whose message is gone is left gone —
      // resurrecting a finished poll as a fresh channel message would be
      // noise, and the record is marked closed so it is never retried.
      if (edit.status === 404 && isOpen) {
        const target = record.channelId;
        const repost = await deps.postMessage(target, payload);
        if (!repost.ok || !repost.messageId) {
          note(SYNC_MSG.postRefused(label, repost.status));
          stats.skipped += 1;
          continue;
        }
        await deps.writeRecord(key, {
          channelId: target,
          messageId: repost.messageId,
          renderedStatus: 'open',
          clubCol,
          clubId: club.id,
          pollId,
        });
        note(SYNC_MSG.reposted(label));
        stats.posted += 1;
        continue;
      }
      if (edit.status === 404 && !isOpen) {
        await deps.writeRecord(key, {
          ...record,
          renderedStatus: 'closed',
          clubCol,
          clubId: club.id,
          pollId,
        });
        stats.skipped += 1;
        continue;
      }
      note(SYNC_MSG.editRefused(label, edit.status));
      stats.skipped += 1;
      continue;
    }

    // No record: this open poll has never been posted. THE one place a new
    // message is created, and it is reached only when `readRecord` said no —
    // which is what makes a double-run harmless.
    const target = await channel();
    if (!target) {
      note(SYNC_MSG.noChannel(label));
      stats.skipped += 1;
      continue;
    }
    const post = await deps.postMessage(target, payload);
    if (!post.ok || !post.messageId) {
      note(SYNC_MSG.postRefused(label, post.status));
      stats.skipped += 1;
      continue;
    }
    await deps.writeRecord(key, {
      channelId: target,
      messageId: post.messageId,
      renderedStatus: 'open',
      clubCol,
      clubId: club.id,
      pollId,
    });
    stats.posted += 1;
  }
}

/**
 * One sync tick over one lane. Never throws: a club that blows up is a named
 * skip, and every other club still syncs (the same per-club isolation
 * `club_announcements.py` gives its own sweep).
 */
export async function runPollSync(deps: SyncDeps, clubCol: ClubCollection): Promise<SyncStats> {
  const stats = emptyStats();
  let clubs: ClubRow[];
  try {
    clubs = await deps.listClubs();
  } catch (err) {
    stats.notes.push(
      'No clubs could be listed at all, so nothing was synced this tick (a service problem reaching ' +
        `Firestore, not a permissions one): ${err instanceof Error ? err.message : String(err)}`,
    );
    return stats;
  }

  for (const club of clubs) {
    stats.clubs_considered += 1;
    // Per-club opt-in, default OFF — the same affirmative `=== true` check
    // the vote path re-enforces server-side. A club that never opted in is
    // not an event; it is the normal case, and it makes no note.
    if (!club.votingEnabled) continue;
    stats.clubs_opted_in += 1;
    // ⚠️ THE SECOND TOGGLE (2026-09-02), and it is a real skip rather than a
    // silent one: a club that has deliberately turned poll ANNOUNCEMENTS off
    // still has Discord voting on, so "opted in but nothing posted" would read
    // as the tick being broken. It is NOTED, once, with the reason.
    if (club.announcementsEnabled === false) {
      stats.skipped += 1;
      stats.notes.push(SYNC_MSG.announcementsOff(`${clubCol}/${club.id} (${club.name || '?'})`));
      continue;
    }
    try {
      await syncClub(deps, clubCol, club, stats);
    } catch (err) {
      stats.notes.push(
        SYNC_MSG.clubFailed(
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
// The real dependencies — Firestore REST + the bot token
// ---------------------------------------------------------------------------

/** ⚠️ EXPORTED (2026-08-18) so `question-sync.ts` decodes Firestore REST with
 * the SAME shapes rather than declaring a third near-identical copy. It gained
 * `integerValue` at the same time, for the question baseline's epoch-ms field —
 * nothing in this file reads it, but a type that cannot describe the documents
 * its own collections hold is a type that quietly stops being checked. */
export type FsValue = {
  stringValue?: string;
  integerValue?: string | number;
  booleanValue?: boolean;
  timestampValue?: string;
  arrayValue?: { values?: FsValue[] };
  mapValue?: { fields?: Record<string, FsValue> };
};
export type FsDoc = { name?: string; fields?: Record<string, FsValue> };

/** Firestore REST returns the full resource path; the doc id is its tail. */
export function docIdFromName(name: string | undefined): string | null {
  if (!name) return null;
  const id = name.split('/').pop();
  return id && id.length > 0 ? id : null;
}

export function recordFromDoc(doc: FsDoc): MessageRecord | null {
  const channelId = doc.fields?.channelId?.stringValue;
  const messageId = doc.fields?.messageId?.stringValue;
  if (typeof channelId !== 'string' || typeof messageId !== 'string') return null;
  if (channelId.length === 0 || messageId.length === 0) return null;
  return {
    channelId,
    messageId,
    // Anything that is not affirmatively 'closed' is treated as open, so a
    // record written by an older build re-renders rather than silently
    // counting as already-propagated.
    renderedStatus: doc.fields?.renderedStatus?.stringValue === 'closed' ? 'closed' : 'open',
  };
}

/** Page a Firestore REST collection listing to exhaustion.
 *
 * ⚠️ EXPORTED (2026-08-18) rather than copied into `question-sync.ts`. Both
 * ticks list club collections the same way and both must page the same way; a
 * second implementation that forgot `nextPageToken` would look correct on
 * every small club and silently truncate the first large one. */
export async function listAll(
  sa: ServiceAccount,
  accessToken: string,
  path: string,
  query: string,
): Promise<FsDoc[]> {
  const out: FsDoc[] = [];
  let pageToken: string | undefined;
  do {
    const q = `${query}&pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await firestoreRequest(sa, accessToken, 'GET', `${path}?${q}`);
    if (!res.ok) throw new Error(`list ${path} failed (${res.status})`);
    const data = (await res.json()) as { documents?: FsDoc[]; nextPageToken?: string };
    out.push(...(data.documents ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/** Build the production dependency set: Firestore via the service account,
 * Discord via the bot token. `sleep` is only ever passed by tests. */
export function firestoreDeps(
  sa: ServiceAccount,
  botToken: string,
  clubCol: ClubCollection,
  sleep?: Sleeper,
): SyncDeps {
  // One access token for the whole tick — minting is cached upstream anyway,
  // but a single promise makes the ordering obvious.
  let tokenPromise: Promise<string> | null = null;
  const token = () => (tokenPromise ??= mintAccessToken(sa));

  return {
    async listClubs() {
      const at = await token();
      const docs = await listAll(sa, at, clubCol, 'mask.fieldPaths=name&mask.fieldPaths=features');
      const rows: ClubRow[] = [];
      for (const doc of docs) {
        const id = docIdFromName(doc.name);
        if (!id) continue;
        rows.push({
          id,
          name: doc.fields?.name?.stringValue ?? '',
          votingEnabled: clubVotingEnabled(doc),
          announcementsEnabled: clubPollAnnouncementsEnabled(doc),
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

    async listPolls(clubId) {
      const at = await token();
      const docs = await listAll(sa, at, `${clubCol}/${clubId}/polls`, 'mask.fieldPaths=question&mask.fieldPaths=status&mask.fieldPaths=options');
      const rows: PollRow[] = [];
      for (const doc of docs) {
        const id = docIdFromName(doc.name);
        const poll = pollFromDoc(doc);
        if (id && poll) rows.push({ id, poll });
      }
      return rows;
    },

    async tallies(clubId, pollId, optionCount) {
      const at = await token();
      const indices = await listVoteIndices(sa, at, {
        clubCol,
        clubId,
        pollId,
        optionIndex: 0,
      });
      return tallyVotes(indices, optionCount);
    },

    async readRecord(key) {
      const at = await token();
      const res = await firestoreRequest(sa, at, 'GET', `${MESSAGE_COLLECTION}/${encodeURIComponent(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`message record read failed (${res.status})`);
      return recordFromDoc((await res.json()) as FsDoc);
    },

    async writeRecord(key, record) {
      const at = await token();
      const nowIso = new Date().toISOString();
      const fields: Record<string, FsValue> = {
        clubCol: { stringValue: record.clubCol },
        clubId: { stringValue: record.clubId },
        pollId: { stringValue: record.pollId },
        channelId: { stringValue: record.channelId },
        messageId: { stringValue: record.messageId },
        renderedStatus: { stringValue: record.renderedStatus },
        updatedAt: { timestampValue: nowIso },
      };
      const mask = Object.keys(fields)
        .map((f) => `updateMask.fieldPaths=${f}`)
        .join('&');
      const res = await firestoreRequest(
        sa,
        at,
        'PATCH',
        `${MESSAGE_COLLECTION}/${encodeURIComponent(key)}?${mask}`,
        { fields },
      );
      if (!res.ok) throw new Error(`message record write failed (${res.status})`);
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
        // Fall through: a 2xx whose body we cannot read is NOT a success we
        // can record, because without the message id the next tick would post
        // a duplicate. Reported as a refusal so it is visible.
      }
      return { ok: false, status: res.status };
    },

    async editMessage(channelId, messageId, payload) {
      const res = await editChannelMessage(botToken, channelId, messageId, payload, sleep);
      return { ok: res.ok, status: res.status };
    },

    async resolveWebhookChannel(webhookUrl) {
      return getWebhookChannelId(webhookUrl, sleep);
    },
  };
}

// ---------------------------------------------------------------------------
// The route — POST /polls/sync
// ---------------------------------------------------------------------------

/** Length-independent-ish equality. The tokens are fixed-length secrets, so
 * this is belt-and-braces rather than load-bearing — but a shared secret
 * compared with `===` is exactly the kind of thing that gets copied into a
 * place where the timing does matter. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The bearer token on the request, or '' — never throws on a weird header. */
export function bearerToken(header: string | undefined): string {
  if (!header) return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? '';
}

export const SYNC_ROUTE_MSG = {
  /** SHIPS DARK. The same idiom as the link ceremony and MODERATION_ENABLED:
   * an unset secret is a configuration gap stated in words, never a crash and
   * never the caller's fault. */
  notConfigured:
    'Poll message syncing is not switched on yet: the Worker has no POLL_SYNC_TOKEN, so it cannot ' +
    'tell a real caller from anyone else and refuses to act. Nothing was posted or changed. Set it ' +
    'with `wrangler secret put POLL_SYNC_TOKEN` from apps/discord-worker and give the same value to ' +
    'the pipeline as POLL_SYNC_TOKEN (docs/access/discord-bot.md, the poll-message sync section).',
  unauthorized:
    'This request did not carry the shared pipeline token, so nothing was synced. Send it as ' +
    '`Authorization: Bearer <POLL_SYNC_TOKEN>`. If you are a person who reached this URL in a ' +
    'browser: there is nothing to see here, and nothing was changed.',
  botTokenMissing:
    'Poll messages cannot be posted because the Worker has no DISCORD_BOT_TOKEN (a configuration ' +
    'gap, NOT a permissions problem). Nothing was posted — see docs/access/discord-bot.md §2.',
  serviceAccountMissing:
    'Poll messages cannot be synced because the Worker has no usable FIREBASE_SERVICE_ACCOUNT (a ' +
    'configuration gap, NOT a permissions problem). Nothing was posted or changed.',
  badLane: 'Unknown lane. Send `{"lane":"prod"}` or `{"lane":"dev"}` — nothing was synced.',
} as const;

/** lane → club collection. `prod` and an absent lane both mean `clubs`. */
export function laneCollection(lane: unknown): ClubCollection | null {
  if (lane === undefined || lane === null || lane === '' || lane === 'prod') return 'clubs';
  if (lane === 'dev') return 'clubs_dev';
  return null;
}

export const pollSyncRoutes = new Hono<AppBindings>();

pollSyncRoutes.post('/polls/sync', async (c) => {
  const expected = c.env.POLL_SYNC_TOKEN;
  // Ships-dark check FIRST: with no secret set there is no such thing as an
  // authorised caller, so "unset" is the honest answer to everyone, signed or
  // not, and it names the fix rather than implying the caller did wrong.
  if (!expected) return c.json({ ok: false, message: SYNC_ROUTE_MSG.notConfigured }, 503);

  const presented = bearerToken(c.req.header('authorization'));
  if (!presented || !secretsMatch(presented, expected)) {
    return c.json({ ok: false, message: SYNC_ROUTE_MSG.unauthorized }, 401);
  }

  let lane: unknown;
  try {
    const body = (await c.req.json()) as { lane?: unknown };
    lane = body?.lane;
  } catch {
    lane = c.req.query('lane'); // an empty POST is a perfectly good prod tick
  }
  const clubCol = laneCollection(lane);
  if (!clubCol) return c.json({ ok: false, message: SYNC_ROUTE_MSG.badLane }, 400);

  const botToken = c.env.DISCORD_BOT_TOKEN;
  if (!botToken) return c.json({ ok: false, message: SYNC_ROUTE_MSG.botTokenMissing }, 503);

  let sa: ServiceAccount | null;
  try {
    sa = parseServiceAccount(c.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error('FIREBASE_SERVICE_ACCOUNT malformed:', err instanceof Error ? err.message : err);
    sa = null;
  }
  if (!sa) return c.json({ ok: false, message: SYNC_ROUTE_MSG.serviceAccountMissing }, 503);

  const stats = await runPollSync(firestoreDeps(sa, botToken, clubCol), clubCol);
  return c.json({ ok: true, lane: clubCol, ...stats });
});
