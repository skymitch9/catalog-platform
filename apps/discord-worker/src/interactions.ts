/**
 * Interaction routing — pure decisions, no I/O. The entrypoint verifies the
 * signature first (verify.ts), hands the parsed body here, and maps the
 * returned decision to a response; the poll-vote flow's network work lives
 * in poll-vote.ts. Keeping the router pure is what makes it testable the
 * way this repo tests everything else (node:test over exported functions).
 */

import { parsePollCustomId, POLL_VOTE_PREFIX, type PollVoteRef } from './poll-vote.js';
import { GUESS_PREFIX, parseGuessCustomId } from './guessgame.js';
import { RSVP_PREFIX } from './club-write.js';
import { MOD_CONFIRM_PREFIX } from './moderation.js';
import {
  CONFIRM_PREFIX,
  GABI_CONV_PREFIX,
  modalInputValue,
  parseConvCustomId,
  parseModalCustomId,
  type ConvAction,
} from './conversation.js';

/** Discord interaction request types (the ones this Worker handles). */
export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  /** ⚠️ ADDED 2026-08-17 with the continuity layer. A modal submit is a
   * DIFFERENT interaction type from the click that opened it, arriving on the
   * same already-live, Ed25519-verified endpoint. Until now this Worker
   * answered type 5 with `unsupported`. */
  MODAL_SUBMIT: 5,
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
  /** ⚠️ A modal must be the IMMEDIATE response to a component click — it cannot
   * be sent as a followup, and Discord's own table says it is *"Not available
   * for `MODAL_SUBMIT` and `PING` interactions"*. So the button that opens one
   * is answered synchronously, and only the submit is deferred. */
  MODAL: 9,
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

/**
 * ⚠️ THE FUN MENU (2026-09-02) — design §2c.2, §2d, §2e, §2h, P1, P2 and P3,
 * built together because they share one router, one deferral discipline and one
 * scope decision. Same rule as every name above: **the ROUTER owns the
 * vocabulary and `commands.ts` imports it**, so a registered command the router
 * would not recognise cannot exist.
 *
 * Read-only, public slice, no credential: `/recent`, `/universe`, `/guessgame`.
 * Reads the asker's own estate identity: `/suggest`, `/review`.
 * WRITES per-user club state, behind its own posture: `/rsvp`, `/progress`.
 */
export const RECENT_COMMAND_NAME = 'recent';
export const UNIVERSE_COMMAND_NAME = 'universe';
export const GUESSGAME_COMMAND_NAME = 'guessgame';
export const SUGGEST_COMMAND_NAME = 'suggest';
export const REVIEW_COMMAND_NAME = 'review';
export const RSVP_COMMAND_NAME = 'rsvp';
export const PROGRESS_COMMAND_NAME = 'progress';

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
  /** ⚠️ ABSENT in a DM, and that absence is how the conversation SURFACE is
   * decided for a component click — the same test `mentions.ts` applies to a
   * gateway message, so a button pressed in a DM resumes the DM's memory. */
  guild_id?: string;
  channel_id?: string;
  /** Discord's newer channel object. Read as a fallback for `channel_id`,
   * which it is gradually replacing; the conversation key needs the channel and
   * a missing one would silently split a conversation in two. */
  channel?: { id?: string };
  data?: {
    name?: string;
    custom_id?: string;
    options?: CommandOption[];
    resolved?: { users?: Record<string, DiscordUser> };
    /** Select menus: the chosen option values. */
    values?: unknown;
    /** Modal submits: the action rows / labels wrapping the text inputs. */
    components?: unknown;
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
  /** ⚠️ T2 CONFIRM LANE. A press on a `gc2|` confirm button. The MAC is verified
   * downstream (the id itself is a capability here), so the router only routes. */
  | { kind: 'gabi_confirm'; customId: string; actor: InteractionActor }
  /** ⚠️ CONTINUITY. A click on something GABI attached to an earlier answer:
   * `pick` chose from her select menu, `more` asks for the free-text modal. */
  | { kind: 'gabi_component'; action: ConvAction; nonce: string; choice: string; actor: InteractionActor }
  /** ⚠️ CONTINUITY. The modal came back with typed text. */
  | { kind: 'gabi_modal'; nonce: string; text: string; actor: InteractionActor }
  /** ⚠️ FUN MENU. Read-only, public slice, no credential — the same scope
   *  `/have` records (design §4 decision 4). */
  | { kind: 'recent_command'; count: number | undefined; actor: InteractionActor }
  | { kind: 'universe_command'; name: string; actor: InteractionActor }
  | { kind: 'guessgame_command'; actor: InteractionActor }
  /** A press on a `gg|` guess button. */
  | { kind: 'guess_answer'; chosen: number; correct: number; actor: InteractionActor }
  /** ⚠️ FUN MENU. Reads the asker's OWN estate identity, never anybody else's. */
  | { kind: 'suggest_command'; format: string; mood: string; actor: InteractionActor }
  | { kind: 'review_command'; book: string; actor: InteractionActor }
  /** ⚠️ FUN MENU, THE WRITING HALF. Per-user club state, behind its own posture. */
  | { kind: 'rsvp_command'; club: string; actor: InteractionActor }
  | { kind: 'rsvp_answer'; customId: string; actor: InteractionActor }
  | {
      kind: 'progress_command';
      club: string;
      /** ⚠️ The option was DROPPED on 2026-09-05 (owner decision (a)); this is
       *  read only so a stale global command lands on a worded refusal. */
      legacyPercent: number | undefined;
      chapter: string;
      actor: InteractionActor;
    }
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
    // `channel_id` first, `channel.id` as the fallback — the newer object form
    // is what Discord is moving to, and the conversation key cannot be built
    // without one of them.
    channelId: i.channel_id ?? i.channel?.id ?? '',
    token: i.token ?? '',
    applicationId: i.application_id ?? '',
  };
}

/** The single chosen value of a string select, or `''`. Only one is ever
 * offered (`min_values`/`max_values` are both 1), so anything else is a payload
 * this build did not produce and does not act on. */
export function selectedValue(i: Interaction): string {
  const values = i.data?.values;
  if (!Array.isArray(values)) return '';
  const first = values[0];
  return typeof first === 'string' ? first : '';
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
      // ── ⚠️ THE FUN MENU (2026-09-02) ────────────────────────────────────
      // Routed in registry order. Every one of them is answered with a
      // DEFERRED response by `index.ts`, because every one of them asks
      // something else (the additions log, the catalogue, Firestore) before it
      // can answer, and a round trip must never race Discord's 3-second window
      // (design §1.7).
      if (name === RECENT_COMMAND_NAME) {
        return { kind: 'recent_command', count: numberOption(i, 'count'), actor: interactionActor(i) };
      }
      if (name === UNIVERSE_COMMAND_NAME) {
        return { kind: 'universe_command', name: stringOption(i, 'name'), actor: interactionActor(i) };
      }
      if (name === GUESSGAME_COMMAND_NAME) {
        return { kind: 'guessgame_command', actor: interactionActor(i) };
      }
      if (name === SUGGEST_COMMAND_NAME) {
        return {
          kind: 'suggest_command',
          format: stringOption(i, 'format'),
          mood: stringOption(i, 'mood'),
          actor: interactionActor(i),
        };
      }
      if (name === REVIEW_COMMAND_NAME) {
        return { kind: 'review_command', book: stringOption(i, 'book'), actor: interactionActor(i) };
      }
      // ⚠️ `/rsvp` and `/progress` are ROUTED even while `GABI_CLUB_WRITES` is
      // off and they are therefore not PUBLISHED — the same kill-switch
      // contract the moderation pair keeps: a stale global command or a
      // hand-crafted interaction lands on the worded switched-off answer rather
      // than on "nothing answers /rsvp".
      if (name === RSVP_COMMAND_NAME) {
        return { kind: 'rsvp_command', club: stringOption(i, 'club'), actor: interactionActor(i) };
      }
      if (name === PROGRESS_COMMAND_NAME) {
        return {
          kind: 'progress_command',
          club: stringOption(i, 'club'),
          // ⚠️ `percent` is no longer an option on the PUBLISHED command (owner
          // decision 2026-09-05), and it is still read here on purpose: a
          // global command's old shape can linger in a client for up to an hour
          // after re-registration, and a person who sends one must get the
          // worded `PROGRESS_PERCENT_UNSUPPORTED` answer rather than have it
          // silently dropped and be told "recorded".
          legacyPercent: numberOption(i, 'percent'),
          chapter: stringOption(i, 'chapter'),
          actor: interactionActor(i),
        };
      }
      return { kind: 'unknown_command', name };
    }

    case InteractionType.MODAL_SUBMIT: {
      const parsed = parseModalCustomId(i.data?.custom_id ?? '');
      if (!parsed) return { kind: 'bad_component', customId: i.data?.custom_id ?? '' };
      return {
        kind: 'gabi_modal',
        nonce: parsed.nonce,
        text: modalInputValue(i.data),
        actor: interactionActor(i),
      };
    }

    case InteractionType.MESSAGE_COMPONENT: {
      const customId = i.data?.custom_id ?? '';
      if (customId.startsWith(`${MOD_CONFIRM_PREFIX}|`)) {
        return { kind: 'mod_confirm', customId, actor: interactionActor(i) };
      }
      // ⚠️ `gc2|` BEFORE `gc|` — the confirm prefix is a superstring of the
      // continuity prefix, and `startsWith('gc|')` would never match `gc2|`
      // anyway, but ordering the more specific one first keeps the intent plain.
      if (customId.startsWith(`${CONFIRM_PREFIX}|`)) {
        return { kind: 'gabi_confirm', customId, actor: interactionActor(i) };
      }
      if (customId.startsWith(`${GABI_CONV_PREFIX}|`)) {
        const conv = parseConvCustomId(customId);
        if (conv) {
          return {
            kind: 'gabi_component',
            action: conv.action,
            nonce: conv.nonce,
            choice: selectedValue(i),
            actor: interactionActor(i),
          };
        }
      }
      // ⚠️ FUN MENU. `gg|` carries no state and no credential — it is a game
      // round's two indices; `parseGuessCustomId` is the only thing that trusts
      // its shape, and it refuses anything else.
      if (customId.startsWith(`${GUESS_PREFIX}|`)) {
        const guess = parseGuessCustomId(customId);
        if (guess) {
          return {
            kind: 'guess_answer',
            chosen: guess.chosen,
            correct: guess.correct,
            actor: interactionActor(i),
          };
        }
      }
      // ⚠️ FUN MENU. An RSVP press is verified DOWNSTREAM (the club, the
      // opt-in flag and the link are all re-read server-side), so the router
      // only routes — the same division `gabi_confirm` keeps.
      if (customId.startsWith(`${RSVP_PREFIX}|`)) {
        return { kind: 'rsvp_answer', customId, actor: interactionActor(i) };
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

/**
 * "GABI is thinking…", **publicly** — the ack for a continuity component.
 *
 * ⚠️ Deliberately NOT `DEFERRED_UPDATE_MESSAGE` (type 6). Type 6 edits the
 * message the component was attached to, which would REPLACE her earlier answer
 * with her new one and quietly erase the half of the conversation a reader
 * needs to make sense of it. A conversation is a sequence of messages; type 5
 * adds one.
 *
 * ⚠️ And deliberately not ephemeral: an ephemeral answer cannot be REPLIED to
 * with the ping that Discord requires to deliver content, so it would be a dead
 * end in the middle of a continuity feature.
 */
export function deferredPublic() {
  return { type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: {} };
}
