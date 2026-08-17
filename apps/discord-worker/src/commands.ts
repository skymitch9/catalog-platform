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
import { LINK_COMMAND_NAME } from './interactions.js';
import type { Env } from './env.js';

const DISCORD_API = 'https://discord.com/api/v10';

/** Discord application-command type 1 = CHAT_INPUT (a slash command). */
const CHAT_INPUT = 1;

/**
 * The whole registry. `/link` is the first and, in this phase, the only
 * entry — the ceremony every write-capable command in design §2 reuses.
 */
export const ESTATE_COMMANDS = [
  {
    name: LINK_COMMAND_NAME,
    type: CHAT_INPUT,
    description: 'Connect your Discord account to your estate club member entry (opt-in, revocable)',
    // No options: the whole flow is a link the person follows in a browser.
    // `dm_permission` left at Discord's default (allowed) — linking is a
    // personal act and is entirely reasonable to start from a DM.
  },
] as const;

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
