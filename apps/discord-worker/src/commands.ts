/**
 * SLASH COMMANDS — the registry, and the one route that publishes it.
 *
 * Discord does not discover commands; an application PUTs its command list to
 * the API and Discord shows exactly that. So the list has to live somewhere,
 * and publishing it has to be triggerable by someone. Both are here.
 *
 * ## Why a route and not a script
 *
 * The obvious shape is a Node script — but the two credentials it needs
 * (`DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`) are wrangler secrets, which
 * exist inside the Worker and nowhere else. A script could only work by the
 * owner pasting the bot token onto a command line, which the custody rule in
 * docs/access/discord-bot.md §2 forbids in as many words ("never paste into a
 * terminal line, never echo"). The Worker already holds both, so the Worker
 * publishes.
 *
 * ## The gate
 *
 * `POST /admin/commands/register` requires a verified estate Firebase ID
 * token AND ladder rank `admin` or above — resolved the same way auth-worker
 * resolves it (`OWNER_EMAILS` short-circuits; otherwise `site_roles/{uid}`,
 * the very doc firestore.rules consults). The blast radius of the route is
 * small by construction — the command list is a constant in this file, so the
 * worst a caller can do is republish the same list — but "small" is not a
 * reason to leave a write route open, and an unauthenticated one would be a
 * free rate-limit burner.
 *
 * ## Global, not per-guild
 *
 * GLOBAL registration (design §1.4: any server's own admin invites GABI, and
 * the estate never enumerates the servers it is in — a per-guild registration
 * would require exactly that enumeration). Global commands propagate within
 * about an hour on first publish and near-instantly on update.
 */

import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';
import {
  CLEANUP_COMMAND_NAME,
  GABI_COMMAND_NAME,
  GUESSGAME_COMMAND_NAME,
  HAVE_COMMAND_NAME,
  LINK_COMMAND_NAME,
  PROGRESS_COMMAND_NAME,
  RECENT_COMMAND_NAME,
  REVIEW_COMMAND_NAME,
  RSVP_COMMAND_NAME,
  SUGGEST_COMMAND_NAME,
  TIMEOUT_COMMAND_NAME,
  UNIVERSE_COMMAND_NAME,
} from './interactions.js';
import { clubWritesOn } from './club-write.js';
import { RECENT_MAX } from './recent.js';
import { SUGGEST_FORMAT_CHOICES } from './suggest-command.js';
import { CHAPTER_MAX } from './club-write.js';
import { CLEANUP_CONTAINS_MAX, CLEANUP_MAX, moderationOn, PERMISSION } from './moderation.js';
import type { Env } from './env.js';

const DISCORD_API = 'https://discord.com/api/v10';

/** Discord application-command type 1 = CHAT_INPUT (a slash command). */
const CHAT_INPUT = 1;

/** Command-option types (Discord's own numbering). */
const OPTION = { STRING: 3, INTEGER: 4, USER: 6 } as const;

/**
 * The always-published registry: the three commands that are on.
 *
 * `/link` is phase 2's ceremony; `/have` is design §2b, answering at the
 * public audiobook scope (§4 decision 4) for everyone, which is why it needs
 * no credential and no gate. `/gabi` is the fixer's surface in shape (b) —
 * propose-and-deep-link — and is ungated for the same reason: it reads the
 * same public slice and answers with a link to a site that does its own
 * sign-in. Neither spends money nor writes anything.
 */
export const BASE_COMMANDS = [
  {
    name: LINK_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Connect your Discord account to your estate club member entry (opt-in, revocable)',
    // No options: the whole flow is a link the person follows in a browser.
    // `dm_permission` left at Discord's default (allowed) — linking is a
    // personal act and is entirely reasonable to start from a DM.
  },
  {
    name: HAVE_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Ask whether a book is on the estate’s shelves',
    options: [
      {
        name: 'title',
        type: OPTION.STRING,
        description: 'A title, author or series to look for',
        required: true,
      },
    ],
  },
  {
    name: GABI_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Ask GABI about the estate’s books — she answers here and links you to the full panel',
    options: [
      {
        name: 'question',
        type: OPTION.STRING,
        description: 'What you want to know or fix — in your own words',
        required: true,
      },
    ],
  },
  // ── ⚠️ THE FUN MENU (2026-09-02) ────────────────────────────────────────
  // Five read-shaped commands, always published, for the same reason `/have`
  // and `/gabi` are: each answers from the PUBLIC audiobook slice or from the
  // asker's OWN estate record, none needs a credential a person could be
  // refused for, and none spends money. The two WRITING commands (`/rsvp`,
  // `/progress`) are NOT here — see `commandsFor()` below.
  {
    name: RECENT_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'See what has arrived on the estate’s shelves lately',
    options: [
      {
        name: 'count',
        type: OPTION.INTEGER,
        description: `How many recent arrivals to list (1–${RECENT_MAX})`,
        required: false,
        // ⚠️ A SECOND rail beside the runtime check in recent.ts. Discord
        // refuses an out-of-range number before it ever reaches the Worker;
        // the runtime check is what catches a hand-crafted interaction.
        min_value: 1,
        max_value: RECENT_MAX,
      },
    ],
  },
  {
    name: UNIVERSE_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Browse a fictional universe the estate records — or list them all',
    options: [
      {
        name: 'name',
        type: OPTION.STRING,
        // ⚠️ OPTIONAL on purpose: a bare `/universe` answers "which universes
        // are there", which is the question somebody has before they can ask
        // the other one.
        description: 'A universe name, e.g. “The Cosmere”. Leave blank to list them all',
        required: false,
      },
    ],
  },
  {
    name: REVIEW_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'See what the house thought of a book — and where to add your own',
    options: [
      {
        name: 'book',
        type: OPTION.STRING,
        description: 'The book’s title (GABI will find the catalogue’s spelling)',
        required: true,
      },
    ],
  },
  {
    name: SUGGEST_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Get a few book picks built on your own ratings and reading list',
    options: [
      {
        name: 'format',
        type: OPTION.STRING,
        // ⚠️ CHOICES, not free text — and that is the permission model, not a
        // convenience: design §4's rule is that a format must be an EXPLICIT
        // word, because ebook and physical each open a gate. A chosen value is
        // as explicit as it gets; a blank one falls back to the public
        // audiobook shelf and says so.
        description: 'Which shelf — audiobook, ebook, or a physical copy (blank = audiobook)',
        required: false,
        choices: SUGGEST_FORMAT_CHOICES.map((value) => ({
          name: value === 'audio' ? 'audiobook' : value === 'ebook' ? 'ebook' : 'physical',
          value,
        })),
      },
      {
        name: 'mood',
        type: OPTION.STRING,
        // ⚠️ A MOOD CAN NEVER OPEN A SHELF (design §10f). It improves the
        // picks and is never consulted by the format gate.
        description: 'What you are in the mood for — “short”, “funny”, “nothing worthy”',
        required: false,
      },
    ],
  },
  {
    name: GUESSGAME_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Guess the book from its facts — four titles, one right answer',
    // No options: a round is a round.
  },
] as const;

/**
 * ⚠️ **THE FUN MENU'S WRITING PAIR — published ONLY while `GABI_CLUB_WRITES` is
 * `"on"`**, exactly as the moderation pair is published only while
 * `MODERATION_ENABLED` is.
 *
 * The reasoning is the one recorded below for `/timeout` and `/cleanup`, and it
 * applies with more force here: `src/club-write.ts` records that the DOCUMENT
 * SHAPES these two write are inferred rather than measured, so until somebody
 * checks them against the site's own writers a person pressing "Coming" would
 * be told their RSVP was recorded while the club page showed nothing. A command
 * that is not published cannot be pressed by accident.
 */
export const CLUB_WRITE_COMMANDS = [
  {
    name: RSVP_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'RSVP to your book club’s next meeting',
    // ⚠️ Guild-only: a club is a group, and an RSVP in a DM has no club.
    dm_permission: false,
    options: [
      {
        name: 'club',
        type: OPTION.STRING,
        // ⚠️ REQUIRED, per design §2e's own recommendation (i). GABI does not
        // guess which club somebody means: filing an RSVP against the wrong
        // one is worse than asking.
        description: 'Which club',
        required: true,
      },
    ],
  },
  {
    name: PROGRESS_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Record where you are in your club’s current read',
    dm_permission: false,
    options: [
      { name: 'club', type: OPTION.STRING, description: 'Which club', required: true },
      {
        name: 'percent',
        type: OPTION.INTEGER,
        description: 'How far through, 0–100',
        required: false,
        min_value: 0,
        max_value: 100,
      },
      {
        name: 'chapter',
        type: OPTION.STRING,
        description: `Where you are in your own words, e.g. “ch. 14” (max ${CHAPTER_MAX} characters)`,
        required: false,
        max_length: CHAPTER_MAX,
      },
    ],
  },
] as const;

/**
 * The moderation pair — TODO §0 item 4's decided scope, and nothing else.
 *
 * ⚠️ `default_member_permissions` is a SECOND, independent rail beside the
 * runtime permission check: Discord itself hides the command from members who
 * lack the bit, so most people never see a control they could not use (the
 * estate's "prefer not rendering a control someone cannot use" rule). It is
 * not a substitute for the runtime check — a server admin can override these
 * per-server, so the interaction's own permissions are still what decides.
 */
export const MODERATION_COMMANDS = [
  {
    name: TIMEOUT_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Time a member out (mirrors your own Moderate Members permission)',
    default_member_permissions: PERMISSION.MODERATE_MEMBERS.toString(),
    dm_permission: false,
    options: [
      { name: 'user', type: OPTION.USER, description: 'Who to time out', required: true },
      {
        name: 'duration',
        type: OPTION.STRING,
        description: 'How long — 10m, 1h, 1d (max 28 days)',
        required: true,
      },
      {
        name: 'reason',
        type: OPTION.STRING,
        description: 'Why (recorded in the estate log and this server’s audit log)',
        required: false,
      },
    ],
  },
  {
    name: CLEANUP_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Preview and delete recent messages (mirrors your own Manage Messages permission)',
    default_member_permissions: PERMISSION.MANAGE_MESSAGES.toString(),
    dm_permission: false,
    options: [
      {
        name: 'count',
        type: OPTION.INTEGER,
        description: `How many recent messages to look at (1–${CLEANUP_MAX})`,
        required: true,
        min_value: 1,
        max_value: CLEANUP_MAX,
      },
      { name: 'user', type: OPTION.USER, description: 'Only this member’s messages', required: false },
      {
        name: 'contains',
        type: OPTION.STRING,
        description: `Only messages containing this text (max ${CLEANUP_CONTAINS_MAX} characters)`,
        required: false,
        max_length: CLEANUP_CONTAINS_MAX,
      },
    ],
  },
] as const;

/**
 * ⚠️ THE REGISTRY IS A FUNCTION OF THE KILL SWITCH — and that is a decision,
 * recorded here because it is the one place a future session will look.
 *
 * Both idioms were on the table and both are defensible. A **visible command
 * answering "switched off"** is honest, and it is what `/link` does today. A
 * **hidden command** is also honest, and it is what was chosen, for one reason
 * the link ceremony does not share:
 *
 *   `/link` being visible-but-off costs a curious person twenty seconds. A
 *   visible `/timeout` costs a moderator the seconds in which they were
 *   dealing with an actual incident — and worse, it advertises, in every
 *   server GABI is ever invited to, a moderation capability the estate has
 *   deliberately not switched on. Commands are GLOBAL (design §1.4): the
 *   estate cannot show it to one server and not another.
 *
 * So while `MODERATION_ENABLED` is anything but `"on"`, Discord is told about
 * `/link` and `/have` only. The handlers still exist, are still wired, and
 * still answer the switched-off ephemeral if an interaction ever arrives —
 * the kill-switch contract is honoured at RUNTIME regardless of what is
 * published, which is what makes hiding them safe rather than merely quiet.
 *
 * ⚠️ Consequence, and it is the reason the register route reports what it
 * published: re-running registration after the owner flips the switch DOES
 * change the list (it is no longer a pure constant). That re-run is the
 * documented second step of the flip — see docs/access/discord-bot.md.
 */
export function commandsFor(
  env: Pick<Env, 'MODERATION_ENABLED' | 'GABI_CLUB_WRITES'>,
): readonly unknown[] {
  return [
    ...BASE_COMMANDS,
    // ⚠️ SECOND SWITCH, SAME RULE (2026-09-02). The registry is now a function
    // of TWO postures, so re-running registration after EITHER flip is a real
    // step rather than a no-op — which is why the route reports what it
    // published and what both switches were.
    ...(clubWritesOn(env) ? CLUB_WRITE_COMMANDS : []),
    ...(moderationOn(env) ? MODERATION_COMMANDS : []),
  ];
}

/** The names in a registry — for the route's worded answer. */
export function commandNames(commands: readonly unknown[]): string[] {
  return commands.map((c) => (c as { name?: string }).name ?? '?');
}

/** Where `/link` sends people. Derived from the request, never hardcoded. */
export function linkUrlFor(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/link`;
}

/**
 * The ephemeral answer to `/link`. Ephemeral is not cosmetic: a link ceremony
 * is personal, and a channel-visible message would both spam the channel and
 * invite someone else to press it.
 */
export function linkCommandMessage(origin: string, configured: boolean): string {
  if (!configured) {
    return (
      'Linking is not switched on yet — this is a setup step on the estate side that has not been ' +
      'done, not a problem with your account. Nothing is broken meanwhile: voting on the club page ' +
      'works exactly as it always has.'
    );
  }
  return (
    `Open ${linkUrlFor(origin)} to connect this Discord account to your estate club member entry.\n\n` +
    'GABI asks Discord for **your username only** — no email, no server list, no messages — and ' +
    'you sign in to the estate on the same page so both halves are proven. Votes are never guessed ' +
    'from usernames, and you can unlink at any time from that page.'
  );
}

export type RegisterResult =
  | { ok: true; count: number }
  | { ok: false; status: number; detail: string };

/** PUT the whole registry — an idempotent bulk overwrite, Discord's own idiom. */
export async function putGlobalCommands(
  applicationId: string,
  botToken: string,
  commands: readonly unknown[],
): Promise<RegisterResult> {
  let res: Response;
  try {
    res = await fetch(`${DISCORD_API}/applications/${applicationId}/commands`, {
      method: 'PUT',
      headers: {
        authorization: `Bot ${botToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(commands),
    });
  } catch (err) {
    return { ok: false, status: 0, detail: `Discord was unreachable: ${String(err)}` };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, detail: `Discord refused the registration (${res.status})` };
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: true, count: Array.isArray(body) ? body.length : commands.length };
}

// ---------------------------------------------------------------------------
// The admin gate
// ---------------------------------------------------------------------------

/** Ranks that may publish the command registry. */
const ADMIN_ROLES = new Set(['admin', 'owner']);

export function isOwnerEmail(env: Pick<Env, 'OWNER_EMAILS'>, email: string): boolean {
  const list = (env.OWNER_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export function roleIsAdmin(role: string | null): boolean {
  return role !== null && ADMIN_ROLES.has(role);
}

/**
 * The caller's stored ladder role from `site_roles/{uid}` — null when there
 * is no doc (a legal, common state: nobody has granted this person anything).
 * A real Firestore failure THROWS rather than degrading into "no role", so an
 * outage is never silently reported as a permissions refusal.
 */
export async function readLadderRole(env: Env, uid: string): Promise<string | null> {
  const sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  if (!sa) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const token = await mintAccessToken(sa);
  const res = await firestoreRequest(sa, token, 'GET', `site_roles/${encodeURIComponent(uid)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`site_roles read failed (${res.status})`);
  const doc = (await res.json()) as { fields?: { role?: { stringValue?: string } } };
  return doc.fields?.role?.stringValue ?? null;
}
