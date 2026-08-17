/**
 * Interaction routing — pure decisions, no I/O. The entrypoint verifies the
 * signature first (verify.ts), hands the parsed body here, and maps the
 * returned decision to a response; the poll-vote flow's network work lives
 * in poll-vote.ts. Keeping the router pure is what makes it testable the
 * way this repo tests everything else (node:test over exported functions).
 */

import { parsePollCustomId, POLL_VOTE_PREFIX, type PollVoteRef } from './poll-vote.js';
import { MOD_CONFIRM_PREFIX } from './moderation.js';

/** Discord interaction request types (the ones this Worker handles). */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const;

/** Discord interaction response types. */
export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  /** "Thinking…" — buys 15 minutes for a command whose answer needs a round
   * trip (design §1.7: build the deferred path from day one, never bolt it on
   * after the synchronous one is observed flaky). */
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;

/** Message flag: visible only to the interacting user. */
export const EPHEMERAL = 64;

/** The identity-link ceremony's slash command. Named here rather than in
 * commands.ts so the ROUTER owns the vocabulary and the registry imports it —
 * a command that Discord could send but the router would not recognise is
 * exactly the drift this one constant prevents. */
export const LINK_COMMAND_NAME = 'link';

/** `/have` — design §2b. Same rule as LINK_COMMAND_NAME: the ROUTER owns the
 * vocabulary and commands.ts imports it, so a registered command the router
 * would not recognise cannot exist. */
export const HAVE_COMMAND_NAME = 'have';

/** `/gabi` — the fixer's Discord surface, shape (b) propose-and-deep-link
 * (gabi-fixer-design.md §10.2). Same rule again: the ROUTER owns the
 * vocabulary. ⚠️ It answers from the PUBLIC index slice and a link to the site
 * panel — it runs no tool loop and calls no model, which is exactly why it
 * needs none of §10.2's four blockers solved. */
export const GABI_COMMAND_NAME = 'gabi';

/** The two moderation commands (TODO §0 item 4's decided scope). Named here
 * for the same reason, and answered by the switched-off ephemeral while
 * MODERATION_ENABLED is anything but "on". */
export const TIMEOUT_COMMAND_NAME = 'timeout';
export const CLEANUP_COMMAND_NAME = 'cleanup';

export interface DiscordUser {
  id: string;
  username?: string;
  global_name?: string;
}

/** One slash-command option as Discord sends it. */
export interface CommandOption {
  name?: string;
  type?: number;
  value?: string | number | boolean;
}

/** The subset of an interaction payload this Worker reads. */
export interface Interaction {
  type: number;
  token?: string;
  application_id?: string;
  guild_id?: string;
  channel_id?: string;
  data?: {
    name?: string;
    custom_id?: string;
    options?: CommandOption[];
    resolved?: { users?: Record<string, DiscordUser> };
  };
  /** Guild interactions carry member.user AND the member's computed
   * permissions for this channel — the value `/timeout` and `/cleanup` mirror.
   * Discord sends it as a decimal STRING (the bitfield exceeds 2^53). */
  member?: { user?: DiscordUser; permissions?: string };
  user?: DiscordUser;
}

/** A named option's raw value, or undefined. */
export function optionValue(i: Interaction, name: string): string | number | boolean | undefined {
  return i.data?.options?.find((o) => o.name === name)?.value;
}

export function stringOption(i: Interaction, name: string): string {
  const v = optionValue(i, name);
  return typeof v === 'string' ? v : '';
}

export function numberOption(i: Interaction, name: string): number | undefined {
  const v = optionValue(i, name);
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return undefined;
}

/** A USER-type option arrives as an id string; the display name (if Discord
 * resolved one) comes from `data.resolved.users`. */
export function userOption(i: Interaction, name: string): { id: string; name: string } {
  const id = stringOption(i, name);
  if (!id) return { id: '', name: '' };
  const resolved = i.data?.resolved?.users?.[id];
  return { id, name: resolved?.global_name || resolved?.username || '' };
}

/** The display name for whoever is acting — for the audit line and the words. */
export function displayNameOf(u: DiscordUser | null): string {
  return u?.global_name || u?.username || 'someone';
}

/** Who clicked/typed — guild shape first, DM shape second, null if absent. */
export function interactionUser(i: Interaction): DiscordUser | null {
  const u = i.member?.user ?? i.user ?? null;
  return u && typeof u.id === 'string' && u.id.length > 0 ? u : null;
}

/** What every command/component decision carries about WHO and WHERE — the
 * facts the moderation gate mirrors and the audit line records. Assembled once
 * so no handler has to remember where Discord hides the permissions. */
export interface InteractionActor {
  user: DiscordUser | null;
  /** Discord's computed permission bits for this member, as sent (a decimal
   * string) — absent in DMs, which is a different answer from "no permission". */
  permissions: unknown;
  guildId: string;
  channelId: string;
  token: string;
  applicationId: string;
}

export type RouterDecision =
  | { kind: 'pong' }
  | { kind: 'link_command' }
  | { kind: 'have_command'; query: string; actor: InteractionActor }
  | { kind: 'gabi_command'; question: string; actor: InteractionActor }
  | {
      kind: 'timeout_command';
      actor: InteractionActor;
      target: { id: string; name: string };
      duration: string;
      reason: string;
    }
  | {
      kind: 'cleanup_command';
      actor: InteractionActor;
      count: number | undefined;
      userId: string;
      contains: string;
    }
  | { kind: 'mod_confirm'; customId: string; actor: InteractionActor }
  | { kind: 'unknown_command'; name: string }
  | {
      kind: 'poll_vote';
      ref: PollVoteRef;
      user: DiscordUser | null;
      token: string;
      applicationId: string;
    }
  | { kind: 'bad_component'; customId: string }
  | { kind: 'unsupported'; type: number };

export function interactionActor(i: Interaction): InteractionActor {
  return {
    user: interactionUser(i),
    permissions: i.member?.permissions,
    guildId: i.guild_id ?? '',
    channelId: i.channel_id ?? '',
    token: i.token ?? '',
    applicationId: i.application_id ?? '',
  };
}

/** Type guard for a JSON body that is at least interaction-shaped. */
export function isInteraction(body: unknown): body is Interaction {
  return typeof body === 'object' && body !== null && typeof (body as Interaction).type === 'number';
}

/**
 * Decide what an already-signature-verified interaction is.
 *
 * Slash commands: the registry is `commands.ts`'s ESTATE_COMMANDS, and
 * `/link` (phase 2 — the identity-link ceremony) is its first and currently
 * only entry. The router remains the FOUNDATION for §2's option space
 * ((b) /have, (c.2) /recent, …), and an UNregistered command still gets a
 * worded ephemeral answer rather than Discord's bare "This interaction
 * failed" — which is also what a stale, since-removed command gets.
 */
export function routeInteraction(i: Interaction): RouterDecision {
  switch (i.type) {
    case InteractionType.PING:
      return { kind: 'pong' };

    case InteractionType.APPLICATION_COMMAND: {
      const name = i.data?.name ?? 'unknown';
      if (name === LINK_COMMAND_NAME) return { kind: 'link_command' };
      if (name === HAVE_COMMAND_NAME) {
        return { kind: 'have_command', query: stringOption(i, 'title'), actor: interactionActor(i) };
      }
      if (name === GABI_COMMAND_NAME) {
        return {
          kind: 'gabi_command',
          question: stringOption(i, 'question'),
          actor: interactionActor(i),
        };
      }
      // ⚠️ The two moderation commands are ROUTED even though they are not
      // published while the switch is off (commands.ts's registry is a
      // function of MODERATION_ENABLED). A stale global command, a
      // hand-crafted interaction, or the minutes after a flip must all land on
      // the switched-off answer rather than on "nothing answers /timeout" —
      // the kill-switch contract is about behaviour, not about visibility.
      if (name === TIMEOUT_COMMAND_NAME) {
        return {
          kind: 'timeout_command',
          actor: interactionActor(i),
          target: userOption(i, 'user'),
          duration: stringOption(i, 'duration'),
          reason: stringOption(i, 'reason'),
        };
      }
      if (name === CLEANUP_COMMAND_NAME) {
        return {
          kind: 'cleanup_command',
          actor: interactionActor(i),
          count: numberOption(i, 'count'),
          userId: userOption(i, 'user').id,
          contains: stringOption(i, 'contains'),
        };
      }
      return { kind: 'unknown_command', name };
    }

    case InteractionType.MESSAGE_COMPONENT: {
      const customId = i.data?.custom_id ?? '';
      if (customId.startsWith(`${MOD_CONFIRM_PREFIX}|`)) {
        return { kind: 'mod_confirm', customId, actor: interactionActor(i) };
      }
      if (customId.startsWith(`${POLL_VOTE_PREFIX}|`)) {
        const ref = parsePollCustomId(customId);
        if (ref && typeof i.token === 'string' && i.token.length > 0) {
          return {
            kind: 'poll_vote',
            ref,
            user: interactionUser(i),
            token: i.token,
            applicationId: i.application_id ?? '',
          };
        }
      }
      return { kind: 'bad_component', customId };
    }

    default:
      return { kind: 'unsupported', type: i.type };
  }
}

/** A type-4 ephemeral message — the worded-rejection response shape. */
export function ephemeralMessage(content: string) {
  return {
    type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  };
}

/**
 * "GABI is thinking…", privately. The ack that buys 15 minutes for a command
 * that has to ask something else (the index, Discord, Firestore) before it can
 * answer. ⚠️ The ephemeral flag has to be set HERE — a followup cannot make a
 * public deferral private afterwards.
 */
export function deferredEphemeral() {
  return {
    type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: EPHEMERAL },
  };
}
