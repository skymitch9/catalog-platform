/**
 * Interaction routing — pure decisions, no I/O. The entrypoint verifies the
 * signature first (verify.ts), hands the parsed body here, and maps the
 * returned decision to a response; the poll-vote flow's network work lives
 * in poll-vote.ts. Keeping the router pure is what makes it testable the
 * way this repo tests everything else (node:test over exported functions).
 */

import { parsePollCustomId, POLL_VOTE_PREFIX, type PollVoteRef } from './poll-vote.js';

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

export interface DiscordUser {
  id: string;
  username?: string;
}

/** The subset of an interaction payload this Worker reads. */
export interface Interaction {
  type: number;
  token?: string;
  application_id?: string;
  data?: { name?: string; custom_id?: string };
  /** Guild interactions carry member.user; DM interactions carry user. */
  member?: { user?: DiscordUser };
  user?: DiscordUser;
}

/** Who clicked/typed — guild shape first, DM shape second, null if absent. */
export function interactionUser(i: Interaction): DiscordUser | null {
  const u = i.member?.user ?? i.user ?? null;
  return u && typeof u.id === 'string' && u.id.length > 0 ? u : null;
}

export type RouterDecision =
  | { kind: 'pong' }
  | { kind: 'link_command' }
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
      return { kind: 'unknown_command', name };
    }

    case InteractionType.MESSAGE_COMPONENT: {
      const customId = i.data?.custom_id ?? '';
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
