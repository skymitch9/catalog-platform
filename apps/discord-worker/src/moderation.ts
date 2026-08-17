/**
 * MODERATION — the decisions. `/timeout` and `/cleanup`, built **DARK**.
 *
 * Scope was settled by the owner (2026-08-16, TODO §0 item 4): **timeouts and
 * message cleanup, nothing else.** No auto-responses, no scheduled sweeps —
 * not declined forever, just not in scope.
 *
 * ## The kill switch is a CONTRACT, not a nicety
 *
 * `MODERATION_ENABLED = "off"` was declared in `wrangler.toml` **before this
 * code existed**, with the required behaviour written into the comment beside
 * it: *"every mod code path must check this var and answer a worded
 * 'moderation is switched off' ephemeral while it is anything but 'on'"*. That
 * is deployed configuration this build inherits, so it is honoured literally:
 *
 *  - `moderationOn()` is affirmative — `"on"` and nothing else. Absent,
 *    empty, `"true"`, `"1"`, `"ON "`… only the last of those passes, and only
 *    because it trims. A typo fails CLOSED.
 *  - The check is FIRST, before permissions, before parsing, before any
 *    Discord read. An off bot therefore leaks nothing about who has what
 *    permission, and performs no I/O at all.
 *  - ⚠️ The flip is the OWNER's evidence-gated step. Nothing in this build,
 *    this repo's scripts, or any deploy may set it to `"on"`.
 *
 * ## Mirroring the caller's authority (owner's words: never amplify a non-mod)
 *
 * GABI was invited with a moderator bundle, so the BOT can time people out.
 * That is exactly why the caller is checked: a bot that acted on any member's
 * `/timeout` would hand every member the moderator powers the server gave the
 * bot. So `/timeout` requires the CALLER to hold `MODERATE_MEMBERS` and
 * `/cleanup` requires `MANAGE_MESSAGES`, read from the interaction payload's
 * own `member.permissions` — Discord's computed value for that member in that
 * channel, which the Ed25519 signature already proves came from Discord.
 *
 * A caller who lacks it gets a worded refusal that NAMES the permission, per
 * the estate's no-bare-status rule. Never "403", never a silent no-op.
 *
 * ## Why the confirm button is signed
 *
 * `/cleanup` previews first and deletes only on a button press. That button
 * lives in an ephemeral message which can sit in someone's client for hours,
 * so its `custom_id` carries an expiry and a MAC: a stale confirm cannot fire
 * later, and a hand-typed one cannot fire at all. The MAC also covers the
 * INVOKER and the CHANNEL without transmitting them — they are associated
 * data, recomputed at verify time from the pressing interaction — so the
 * signature binds "this person, this channel" for free, inside Discord's
 * 100-character `custom_id` ceiling.
 */

import { b64url, b64urlDecode, timingSafeEqual } from './link-token.js';
import type { Env } from './env.js';

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

/** Affirmative, trimmed, case-insensitive — `"on"` or it is off. */
export function moderationOn(env: Pick<Env, 'MODERATION_ENABLED'>): boolean {
  return (env.MODERATION_ENABLED ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// Permissions — the caller's own authority, mirrored
// ---------------------------------------------------------------------------

/** The three bits this file reasons about (Discord's permission bitfield). */
export const PERMISSION = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_MESSAGES: 1n << 13n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

/**
 * The caller's computed permissions, or null when Discord sent none — which is
 * the normal DM case, and is answered as "this only works in a server" rather
 * than as a permissions refusal, because they are different problems.
 */
export function parsePermissions(raw: unknown): bigint | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  try {
    return BigInt(raw.trim());
  } catch {
    return null;
  }
}

/** ADMINISTRATOR implies everything — Discord's own rule, restated so a server
 * owner is never told they lack a permission they structurally hold. */
export function hasPermission(bits: bigint | null, needed: bigint): boolean {
  if (bits === null) return false;
  if ((bits & PERMISSION.ADMINISTRATOR) !== 0n) return true;
  return (bits & needed) === needed;
}

// ---------------------------------------------------------------------------
// Duration parsing — `10m`, `1h`, `1d`, `1h30m`
// ---------------------------------------------------------------------------

/** Discord's own ceiling for a communication timeout. */
export const MAX_TIMEOUT_SECONDS = 28 * 24 * 60 * 60;

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

export type DurationParse =
  | { ok: true; seconds: number; label: string }
  | { ok: false; message: string };

/** "1 hour 30 minutes" — worded, because a confirmation reading `5400s` is a
 * number, not an answer. */
export function humanizeSeconds(total: number): string {
  const parts: Array<[number, string]> = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
    [1, 'second'],
  ];
  let left = total;
  const out: string[] = [];
  for (const [size, name] of parts) {
    const n = Math.floor(left / size);
    if (n > 0) {
      out.push(`${n} ${name}${n === 1 ? '' : 's'}`);
      left -= n * size;
    }
  }
  return out.join(' ') || '0 seconds';
}

/**
 * Parse `10m` / `1h` / `1d` / `1h30m`. Every refusal says what shapes work and
 * what the ceiling is — a bare "invalid duration" would make the person guess.
 */
export function parseDuration(raw: string): DurationParse {
  const text = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (text.length === 0) {
    return {
      ok: false,
      message:
        'No duration was given, so nobody was timed out. Say how long, like `10m`, `1h` or `1d` ' +
        `(the longest Discord allows is 28 days).`,
    };
  }
  if (/^\d+$/.test(text)) {
    return {
      ok: false,
      message:
        `\`${raw}\` has no unit, so nobody was timed out — GABI will not guess between minutes and ` +
        'days. Write `10m`, `1h`, `1d` (s, m, h, d and w all work).',
    };
  }
  const matches = [...text.matchAll(/(\d+)([smhdw])/g)];
  const consumed = matches.reduce((n, m) => n + m[0].length, 0);
  if (matches.length === 0 || consumed !== text.length) {
    return {
      ok: false,
      message:
        `\`${raw}\` is not a duration GABI understands, so nobody was timed out. Use a number and a ` +
        'unit — `30s`, `10m`, `1h`, `1d`, `1w` — and you can join them, like `1h30m`. The longest ' +
        'Discord allows is 28 days.',
    };
  }
  let seconds = 0;
  for (const m of matches) {
    seconds += Number(m[1]) * (UNIT_SECONDS[m[2] as string] ?? 0);
    if (!Number.isFinite(seconds)) break;
  }
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return {
      ok: false,
      message:
        `\`${raw}\` works out as no time at all, so nobody was timed out. Give at least one second — ` +
        'and to LIFT a timeout, use Discord\'s own "Remove timeout" on the member.',
    };
  }
  if (seconds > MAX_TIMEOUT_SECONDS) {
    return {
      ok: false,
      message:
        `\`${raw}\` is ${humanizeSeconds(seconds)}, and Discord's own ceiling for a timeout is ` +
        '**28 days** — so nobody was timed out. Ask for 28 days or less; for anything longer, a ' +
        'timeout is the wrong tool and a ban or a role change is the right one.',
    };
  }
  return { ok: true, seconds, label: humanizeSeconds(seconds) };
}

// ---------------------------------------------------------------------------
// Cleanup rails
// ---------------------------------------------------------------------------

/** ⚠️ The hard cap per invocation. Fifty is deliberately well under Discord's
 * own bulk-delete ceiling of 100: a mis-typed `/cleanup 100` in the wrong
 * channel is an unrecoverable event, and nothing about tidying a channel is
 * urgent enough to justify the bigger number. Running it twice is cheap. */
export const CLEANUP_MAX = 50;

/** ⚠️ The `contains` filter's ceiling, and it is a MECHANICAL one: the confirm
 * button has to carry the filter inside Discord's 100-character `custom_id`,
 * and 32 is what fits alongside the expiry, the count, the target and the MAC.
 * Stated in words when exceeded — never silently truncated, which would delete
 * a different set of messages than the one previewed.
 *
 * Declared to Discord as the option's `max_length` (which counts CHARACTERS). */
export const CLEANUP_CONTAINS_MAX = 32;

/**
 * ⚠️ …and the check that actually holds, because the custom_id carries the
 * filter base64-encoded, and base64 grows by BYTES, not characters. Caught by
 * `test/moderation.test.ts`'s worst-case test, which built a 32-CHARACTER
 * accented filter and produced a **115-character** custom_id — 15 over
 * Discord's ceiling, i.e. a confirm button that would simply have failed to
 * render, for exactly the people whose language uses accents.
 *
 * 32 UTF-8 bytes → 44 base64url characters → a 97-character custom_id at the
 * absolute worst case. ASCII filters are unaffected: 32 characters still fit.
 */
export const CLEANUP_CONTAINS_MAX_BYTES = 32;

/** Discord refuses to bulk-delete anything older than this. Surfaced in words,
 * never as a silent partial. */
export const BULK_DELETE_MAX_AGE_DAYS = 14;
export const BULK_DELETE_MAX_AGE_MS = BULK_DELETE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

export interface CleanupPlan {
  /** How many recent messages to look at — the scan window, capped. */
  count: number;
  /** Only this author's messages, or '' for everyone's. */
  targetUserId: string;
  /** Only messages containing this text (case-insensitive), or ''. */
  contains: string;
}

export type CleanupParse = { ok: true; plan: CleanupPlan } | { ok: false; message: string };

export function parseCleanupArgs(args: {
  count: unknown;
  user?: unknown;
  contains?: unknown;
}): CleanupParse {
  const count = typeof args.count === 'number' ? args.count : Number(args.count);
  if (!Number.isInteger(count) || count < 1) {
    return {
      ok: false,
      message:
        'Nothing was deleted: `count` has to be a whole number of recent messages to look at, at ' +
        `least 1 and at most ${CLEANUP_MAX}.`,
    };
  }
  if (count > CLEANUP_MAX) {
    return {
      ok: false,
      message:
        `Nothing was deleted: ${count} is over GABI's per-run cap of **${CLEANUP_MAX}** messages. ` +
        'The cap is deliberate — a mis-typed cleanup cannot be undone — so run it again rather ' +
        'than raising it.',
    };
  }
  const targetUserId = typeof args.user === 'string' ? args.user.trim() : '';
  if (targetUserId !== '' && !/^\d{1,20}$/.test(targetUserId)) {
    return {
      ok: false,
      message: 'Nothing was deleted: that user could not be read from the command. Pick them from ' +
        "Discord's own autocomplete rather than typing an id.",
    };
  }
  const contains = typeof args.contains === 'string' ? args.contains.trim() : '';
  if (enc.encode(contains).length > CLEANUP_CONTAINS_MAX_BYTES) {
    return {
      ok: false,
      message:
        `Nothing was deleted: the text filter can be at most ${CLEANUP_CONTAINS_MAX} characters — ` +
        'and fewer if it contains emoji or accented letters, which take more room. That is a real ' +
        'limit, not a preference: the confirm button has to carry the filter, and Discord caps what ' +
        'a button can carry. Use a shorter distinctive phrase.',
    };
  }
  return { ok: true, plan: { count, targetUserId, contains } };
}

export interface ChannelMessage {
  id: string;
  content?: string;
  timestampMs: number;
  authorId: string;
  authorName: string;
  pinned?: boolean;
}

export interface CleanupSelection {
  /** Matched AND young enough for Discord to delete. */
  deletable: ChannelMessage[];
  /** Matched but older than 14 days — Discord refuses these; SAID, not dropped. */
  tooOld: ChannelMessage[];
  /** Matched but pinned — never deleted; a pin is somebody's deliberate act. */
  pinned: ChannelMessage[];
}

/**
 * Which of the scanned messages the plan actually selects. Pure, so the rails
 * are testable without a channel: the 14-day partition, the pinned carve-out
 * and the filters all decide here and nowhere else.
 */
export function selectForCleanup(
  messages: readonly ChannelMessage[],
  plan: CleanupPlan,
  nowMs: number,
): CleanupSelection {
  const needle = plan.contains.toLowerCase();
  const out: CleanupSelection = { deletable: [], tooOld: [], pinned: [] };
  for (const m of messages) {
    if (plan.targetUserId && m.authorId !== plan.targetUserId) continue;
    if (needle && !(m.content ?? '').toLowerCase().includes(needle)) continue;
    if (m.pinned) out.pinned.push(m);
    else if (nowMs - m.timestampMs >= BULK_DELETE_MAX_AGE_MS) out.tooOld.push(m);
    else out.deletable.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The signed, short-lived confirm token
// ---------------------------------------------------------------------------

/** Component prefix — the router's vocabulary, like `pv|` for poll votes. */
export const MOD_CONFIRM_PREFIX = 'mc';

/** ⚠️ Two minutes. A cleanup preview describes a channel as it was AT THAT
 * MOMENT; the longer a confirm stays live, the more it deletes something the
 * person never saw. Short enough that a stale press is answered, not obeyed. */
export const CONFIRM_TTL_MS = 2 * 60 * 1000;

/** Domain separation — this MAC is not the link ceremony's and not the bot
 * token; a third use gets a third label, never one of these two. */
const MOD_KEY_LABEL = 'discord-mod-confirm-v1';

/** 64 bits of MAC, hex. Truncated deliberately and safely: the token is
 * ephemeral-only, two minutes long, bound to one invoker in one channel, and
 * every press is re-checked against the live permission bits before anything
 * is deleted. The full 256 bits would not fit the custom_id budget. */
const SIG_HEX_CHARS = 16;

async function modMacKey(keyMaterial: string): Promise<CryptoKey> {
  const seed = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const derived = await crypto.subtle.sign('HMAC', seed, enc.encode(MOD_KEY_LABEL));
  return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export interface ConfirmBinding {
  /** Who pressed preview — associated data, never transmitted. */
  invokerId: string;
  /** Where the preview happened — associated data, never transmitted. */
  channelId: string;
}

function containsField(contains: string): string {
  return contains.length === 0 ? '' : b64url(enc.encode(contains));
}

async function signParts(
  keyMaterial: string,
  parts: readonly string[],
  binding: ConfirmBinding,
): Promise<string> {
  const key = await modMacKey(keyMaterial);
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      enc.encode([...parts, binding.invokerId, binding.channelId].join('|')),
    ),
  );
  return Array.from(mac.slice(0, SIG_HEX_CHARS / 2), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `mc|<expBase36>|<count>|<targetUserId>|<containsB64>|<sig>` — under
 * Discord's 100-character ceiling for every legal plan, which is exactly why
 * `contains` is capped at 32 characters above.
 */
export async function buildConfirmCustomId(
  keyMaterial: string,
  plan: CleanupPlan,
  binding: ConfirmBinding,
  expiresAtMs: number,
): Promise<string> {
  const parts = [
    Math.floor(expiresAtMs / 1000).toString(36),
    String(plan.count),
    plan.targetUserId,
    containsField(plan.contains),
  ];
  const sig = await signParts(keyMaterial, parts, binding);
  return [MOD_CONFIRM_PREFIX, ...parts, sig].join('|');
}

export type ConfirmParse =
  | { ok: true; plan: CleanupPlan }
  /** ⚠️ `expired` and `invalid` are answered by DIFFERENT words on purpose:
   * an expired confirm is a normal thing that happens to honest people and
   * tells them to run it again, while an invalid one means the id did not come
   * from GABI. Neither reveals which half of a forgery to fix, because a bad
   * MAC and a wrong binding are both `invalid`. */
  | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyConfirmCustomId(
  keyMaterial: string,
  customId: string,
  binding: ConfirmBinding,
  nowMs: number,
): Promise<ConfirmParse> {
  const parts = customId.split('|');
  if (parts.length !== 6 || parts[0] !== MOD_CONFIRM_PREFIX) return { ok: false, reason: 'invalid' };
  const [, expRaw, countRaw, targetUserId, containsB64, sig] = parts as [
    string, string, string, string, string, string,
  ];

  const expSeconds = parseInt(expRaw, 36);
  if (!Number.isFinite(expSeconds)) return { ok: false, reason: 'invalid' };

  const expected = await signParts(keyMaterial, [expRaw, countRaw, targetUserId, containsB64], binding);
  if (!timingSafeEqual(sig, expected)) return { ok: false, reason: 'invalid' };

  // Expiry is checked AFTER the MAC: an unsigned id is never called "expired",
  // which would tell a forger their signature was fine.
  if (expSeconds * 1000 <= nowMs) return { ok: false, reason: 'expired' };

  const count = Number(countRaw);
  if (!Number.isInteger(count) || count < 1 || count > CLEANUP_MAX) return { ok: false, reason: 'invalid' };

  let contains = '';
  if (containsB64.length > 0) {
    const bytes = b64urlDecode(containsB64);
    // Re-checked on the way back in, not merely on the way out: the rails a
    // plan passed at preview time are the rails it must still pass at press
    // time, whatever route the id took to get here.
    if (!bytes || bytes.length > CLEANUP_CONTAINS_MAX_BYTES) return { ok: false, reason: 'invalid' };
    contains = new TextDecoder().decode(bytes);
  }
  if (targetUserId !== '' && !/^\d{1,20}$/.test(targetUserId)) return { ok: false, reason: 'invalid' };
  return { ok: true, plan: { count, targetUserId, contains } };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const MOD_MSG = {
  /** ⚠️ THE KILL-SWITCH ANSWER. wrangler.toml's contract, in words: what is
   * happening, that nothing was done, and whose step turns it on. */
  switchedOff:
    "GABI's moderation is **switched off**, so nothing happened — no one was timed out and no " +
    'message was deleted.\n\n' +
    'This is a deliberate estate setting (`MODERATION_ENABLED`), not a problem with your ' +
    "permissions and not a fault. Discord's own moderation tools work exactly as they always " +
    'have. Turning GABI’s on is the estate owner’s decision, and it is a single configuration ' +
    'change on his side.',
  dmOnly:
    'That only works inside a server: Discord sends no channel or permissions with a direct ' +
    'message, so there is nothing for GABI to check or act on. Nothing happened.',
  needTimeoutPermission:
    'Nothing happened: `/timeout` mirrors **your** authority, and this account does not hold ' +
    '**Moderate Members** in this server. GABI will not time anyone out on behalf of someone who ' +
    'could not do it themselves. Ask a server admin for the Moderate Members permission (or the ' +
    'role that carries it) and try again.',
  needCleanupPermission:
    'Nothing was deleted: `/cleanup` mirrors **your** authority, and this account does not hold ' +
    '**Manage Messages** in this channel. GABI will not delete messages on behalf of someone who ' +
    'could not delete them themselves. Ask a server admin for the Manage Messages permission and ' +
    'try again.',
  noTarget: 'Nothing happened: no member was named. Pick one from Discord’s own autocomplete.',
  selfTarget:
    'Nothing happened: that is you. If you genuinely want to step away, Discord’s own "Do Not ' +
    'Disturb" or leaving the channel does it without a moderation record.',
  botTarget:
    'Nothing happened: GABI will not time herself out. If GABI is misbehaving, the estate owner ' +
    'can switch her off entirely — that is what `MODERATION_ENABLED` is for.',
  botTokenMissing:
    'Nothing happened: GABI has no bot credential configured on the estate side (a configuration ' +
    'gap, NOT a permissions problem). Nobody was timed out and no message was deleted.',
  confirmExpired:
    'That confirmation has expired, so **nothing was deleted** — a cleanup preview only stays ' +
    'valid for two minutes, because the channel moves on. Run `/cleanup` again to see a fresh ' +
    'preview.',
  confirmInvalid:
    'That button is not one GABI can act on, so nothing was deleted. It may belong to someone ' +
    "else's preview, to another channel, or to an older message. Run `/cleanup` again.",
  timeoutRefused: (status: number) =>
    `Discord refused the timeout (HTTP ${status}), so **nobody was timed out**. The usual reason ` +
    'is role order: GABI cannot time out anyone whose highest role sits above hers, and never the ' +
    "server owner. Moving GABI's role above theirs, or using Discord's own timeout, both work.",
  timeoutApplied: (name: string, label: string, reason: string) =>
    `**${name}** is timed out for **${label}**.` +
    (reason ? ` Reason recorded: ${reason}` : ' No reason was given.') +
    '\n\nThey can still read the channel; they cannot send, react or speak until it lifts. Removing ' +
    'it early is Discord’s own "Remove timeout" on the member.',
  outage:
    "Something went wrong on the estate's side (a service problem, NOT a permissions one). As far " +
    'as GABI can tell nothing was changed — check the channel before trying again.',
} as const;

// ---------------------------------------------------------------------------
// The audit line
// ---------------------------------------------------------------------------

/**
 * ⚠️ A top-level collection this Worker owns outright, exactly like
 * `discord_poll_messages`: no `firestore.rules` grant exists and the file has
 * no catch-all, so browsers are denied by default and the service account
 * bypasses. No rules change ships with this build, and none is needed.
 *
 * What is NOT audited, deliberately: the switched-off answer and the
 * permission refusals. Nothing happened in either case, and auditing them
 * would let any member of any server GABI is in fill an estate collection by
 * spamming a command. Those go to the Worker log instead.
 */
export const MOD_AUDIT_COLLECTION = 'discord_mod_audit';

export interface ModAuditEntry {
  action: 'timeout' | 'cleanup';
  outcome: 'applied' | 'refused_by_discord' | 'failed';
  actorId: string;
  actorName: string;
  guildId: string;
  channelId: string;
  targetUserId?: string;
  durationSeconds?: number;
  reason?: string;
  messagesDeleted?: number;
  detail?: string;
  at: string;
}

/** Sortable and collision-resistant: the instant first, then a nonce. */
export function auditDocId(atIso: string, nonce: string): string {
  return `${atIso.replace(/[:.]/g, '-')}__${nonce}`;
}

/** Firestore REST typed fields. One builder, so the contract test can pin the
 * exact shape the way the poll-message record's is pinned. */
export function auditFields(entry: ModAuditEntry): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    action: { stringValue: entry.action },
    outcome: { stringValue: entry.outcome },
    actorId: { stringValue: entry.actorId },
    actorName: { stringValue: entry.actorName },
    guildId: { stringValue: entry.guildId },
    channelId: { stringValue: entry.channelId },
    at: { timestampValue: entry.at },
  };
  if (entry.targetUserId) fields.targetUserId = { stringValue: entry.targetUserId };
  if (typeof entry.durationSeconds === 'number') {
    fields.durationSeconds = { integerValue: String(entry.durationSeconds) };
  }
  if (entry.reason) fields.reason = { stringValue: entry.reason };
  if (typeof entry.messagesDeleted === 'number') {
    fields.messagesDeleted = { integerValue: String(entry.messagesDeleted) };
  }
  if (entry.detail) fields.detail = { stringValue: entry.detail };
  return fields;
}
