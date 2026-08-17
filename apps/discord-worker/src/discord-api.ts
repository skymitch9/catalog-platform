/**
 * Every Discord REST call this Worker makes, in two clearly separated
 * families — because they authenticate differently and the difference is the
 * whole blast-radius story:
 *
 *  1. **Interaction-token calls** (the deferred vote flow). They ride the
 *     15-minute INTERACTION token and need no Authorization header at all,
 *     which is what keeps `DISCORD_BOT_TOKEN` entirely out of the poll-vote
 *     path. Unchanged since phase 2.
 *  2. **Bot-token calls** (phase 3: the sync tick posts and edits a real
 *     channel message). These carry `Authorization: Bot <token>` — the one
 *     credential shared across every opted-in club (design §1.2's named and
 *     accepted regression). They exist ONLY for `poll-sync.ts`.
 *
 * Plus one oddity that belongs to neither: `getWebhookChannelId()` reads a
 * webhook object using the webhook's OWN token, which is embedded in the URL
 * the club already saved. No bot token, no bot permissions — it is how a
 * club that pasted a webhook URL gets a bot-postable channel id for free
 * (see poll-sync.ts's channel-resolution note).
 */

const DISCORD_API = 'https://discord.com/api/v10';

/** Bounded 429 handling. Discord answers rate limits with a JSON body
 * carrying `retry_after` in SECONDS; honouring it is the documented contract
 * and ignoring it is how an app earns a cloudflare-level ban. Bounded,
 * because a sync tick that retried forever would hold a Worker invocation
 * open and starve the run it belongs to. */
const MAX_RATE_LIMIT_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 5_000;

export type Sleeper = (ms: number) => Promise<void>;

const realSleep: Sleeper = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Perform a Discord REST request, retrying ONLY on 429 and only as many
 * times as `MAX_RATE_LIMIT_ATTEMPTS` allows. Every other status — including
 * 403 (the bot is not in that channel) and 404 (the message was deleted) —
 * is returned to the caller untouched, because those are decisions, not
 * transients, and poll-sync.ts words each one differently.
 *
 * `sleep` is injectable so tests can prove the retry happened without
 * actually waiting; production always gets the real timer.
 */
export async function discordFetch(
  url: string,
  init: RequestInit,
  sleep: Sleeper = realSleep,
): Promise<Response> {
  let res = await fetch(url, init);
  for (let attempt = 1; attempt < MAX_RATE_LIMIT_ATTEMPTS && res.status === 429; attempt += 1) {
    let waitMs = 1_000;
    try {
      const body = (await res.clone().json()) as { retry_after?: unknown };
      if (typeof body.retry_after === 'number' && Number.isFinite(body.retry_after)) {
        waitMs = Math.max(0, body.retry_after) * 1000;
      }
    } catch {
      // A 429 without a readable body still gets the conservative default
      // wait — a rate limit is real whether or not its body parsed.
    }
    await sleep(Math.min(waitMs, MAX_RETRY_WAIT_MS));
    res = await fetch(url, init);
  }
  return res;
}

/** Discord message flag: visible only to the interacting user. */
export const EPHEMERAL_FLAG = 64;

/** Post an ephemeral followup — the worded rejection/outage channel. */
export async function followupEphemeral(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<Response> {
  return fetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content, flags: EPHEMERAL_FLAG }),
  });
}

/** Edit the message the interaction came from (fresh tally + buttons). */
export async function editOriginalMessage(
  applicationId: string,
  interactionToken: string,
  payload: unknown,
): Promise<Response> {
  return fetch(`${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Bot-token calls — phase 3 only (poll-sync.ts)
// ---------------------------------------------------------------------------

const botHeaders = (botToken: string) => ({
  authorization: `Bot ${botToken}`,
  'content-type': 'application/json',
});

/** POST a new message to a channel. The bot must be in that guild and hold
 * Send Messages + Embed Links there; if it does not, Discord answers 403 and
 * the caller turns that into a NAMED skip rather than a crash. */
export async function createChannelMessage(
  botToken: string,
  channelId: string,
  payload: unknown,
  sleep?: Sleeper,
): Promise<Response> {
  return discordFetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`,
    { method: 'POST', headers: botHeaders(botToken), body: JSON.stringify(payload) },
    sleep,
  );
}

/** PATCH an existing message the bot posted (fresh tally, or the closed
 * rendering). 404 means somebody deleted it — a fact, not a failure. */
export async function editChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  payload: unknown,
  sleep?: Sleeper,
): Promise<Response> {
  return discordFetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'PATCH', headers: botHeaders(botToken), body: JSON.stringify(payload) },
    sleep,
  );
}

// ---------------------------------------------------------------------------
// Bot-token calls — MODERATION (moderation.ts / mod-actions.ts)
//
// ⚠️ Every function below is reachable ONLY when MODERATION_ENABLED is "on",
// which it is not. They are written, typed and tested; none has ever run
// against Discord. The bot's own server permissions were granted at invite
// time (the moderator bundle) and stay unconsumed while the switch is off.
// ---------------------------------------------------------------------------

/**
 * Discord's own audit log takes a REASON header, and giving it one is the
 * difference between a server admin seeing "GABI timed out X — spam in
 * #general, by @mod" and seeing an unexplained bot action. Header values must
 * be ASCII-safe, so it is percent-encoded (Discord's documented handling).
 */
function auditReasonHeader(reason: string | undefined): Record<string, string> {
  const text = (reason ?? '').trim();
  if (text.length === 0) return {};
  return { 'x-audit-log-reason': encodeURIComponent(text.slice(0, 400)) };
}

/**
 * Time a member out — PATCH the guild member's `communication_disabled_until`.
 * `untilIso` null LIFTS a timeout; this build only ever sets one.
 *
 * 403 here is usually ROLE ORDER, not a missing permission: Discord refuses
 * to let any actor moderate a member whose highest role sits above theirs, and
 * refuses the guild owner outright. The caller words that specifically.
 */
export async function timeoutGuildMember(
  botToken: string,
  guildId: string,
  userId: string,
  untilIso: string | null,
  reason?: string,
  sleep?: Sleeper,
): Promise<Response> {
  return discordFetch(
    `${DISCORD_API}/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { ...botHeaders(botToken), ...auditReasonHeader(reason) },
      body: JSON.stringify({ communication_disabled_until: untilIso }),
    },
    sleep,
  );
}

/** The most recent `limit` messages in a channel (Discord's own ceiling is
 * 100; the cleanup cap keeps this well under it). */
export async function listChannelMessages(
  botToken: string,
  channelId: string,
  limit: number,
  sleep?: Sleeper,
): Promise<Response> {
  const capped = Math.max(1, Math.min(100, Math.floor(limit)));
  return discordFetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages?limit=${capped}`,
    { method: 'GET', headers: botHeaders(botToken) },
    sleep,
  );
}

/**
 * Bulk delete. ⚠️ Discord's endpoint takes **2 to 100** ids and refuses
 * anything older than 14 days — both limits are the caller's to respect, and
 * the caller surfaces them in words rather than discovering them as a 400.
 */
export async function bulkDeleteMessages(
  botToken: string,
  channelId: string,
  messageIds: readonly string[],
  reason?: string,
  sleep?: Sleeper,
): Promise<Response> {
  return discordFetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages/bulk-delete`,
    {
      method: 'POST',
      headers: { ...botHeaders(botToken), ...auditReasonHeader(reason) },
      body: JSON.stringify({ messages: messageIds }),
    },
    sleep,
  );
}

/** The single-message door — bulk-delete refuses a list of one. */
export async function deleteChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  reason?: string,
  sleep?: Sleeper,
): Promise<Response> {
  return discordFetch(
    `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE', headers: { ...botHeaders(botToken), ...auditReasonHeader(reason) } },
    sleep,
  );
}

/**
 * The channel a webhook posts into, read with the webhook's OWN token.
 *
 * `GET /webhooks/{id}/{token}` is Discord's unauthenticated (token-in-URL)
 * webhook fetch; the webhook object it returns carries `channel_id`. That is
 * what lets a club which only ever pasted a webhook URL — the estate's
 * default, zero-permission integration — get a bot-postable channel id
 * without any new configuration.
 *
 * ⚠️ NOT VERIFIED LIVE at build time (no club had opted in yet). If Discord
 * ever omits `channel_id` here, the caller falls back to the explicit
 * `discordChannelId` field and says so in words; it never guesses.
 */
export async function getWebhookChannelId(
  webhookUrl: string,
  sleep?: Sleeper,
): Promise<string | null> {
  const res = await discordFetch(webhookUrl, { method: 'GET' }, sleep);
  if (!res.ok) return null;
  try {
    const body = (await res.json()) as { channel_id?: unknown };
    return typeof body.channel_id === 'string' && body.channel_id.length > 0 ? body.channel_id : null;
  } catch {
    return null;
  }
}
