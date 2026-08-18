/**
 * Conversational GABI in Discord — **three intent-free ways to reach her.**
 *
 * The owner's ask was *"I want to use heygabi and similar forms like Hey Gabi,
 * hey @Gabi, heyGabi etc to kick her off for a question and then she responds"*,
 * and then, once she could be reached at all, *"I don't want to message GABI and
 * then message her again and she has no recollection."* This file is the half of
 * that which needs no network: deciding **whether a message is for her**, **what
 * she was asked**, **which shape of answer it wants**, and **whether she is
 * allowed to spend anything answering it**.
 *
 * ## ⚠️ THE THREE DOORS, AND THE DOCUMENTATION THAT OPENS EACH OF THEM
 *
 * Everything here rests on one measurement, so it was **read off Discord's own
 * documentation rather than assumed** (2026-08-17,
 * <https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent>,
 * *"Exceptions: when you get message content without the privileged intent"*):
 *
 * > - **Messages your app sends**
 * > - **Direct Messages sent to your app**
 * > - **Messages that @mention your app**
 * > - **Replies to your app's messages.** Note: this applies to replies sent
 * >   using Discord's reply feature to a regular bot message (not an interaction
 * >   response) and the user has "ping on reply" enabled. It does not apply to
 * >   replies to slash command responses.
 *
 * The same four exceptions appear on
 * <https://docs.discord.com/developers/events/gateway> §Message Content Intent,
 * where "mentioned" links to the `<@USER_ID>` message-formatting format.
 *
 * So this file answers exactly three shapes, one per intent-free exception, and
 * **`MESSAGE_CONTENT` (1 << 15) is still never requested**:
 *
 *  1. **`mention`** — a genuine `<@GABI>` in a guild channel.
 *  2. **`reply`** — a Discord *reply* to one of GABI's own **regular** messages
 *     with **ping-on-reply left ON**. ⚠️ The ping is what delivers the content;
 *     a reply with the ping switched off arrives with `content: ""` and she is
 *     **blind to it**. That is documented honestly in the runbook rather than
 *     presented as a quirk, because there is no way for her to know it happened.
 *     ⚠️ It also does NOT cover replies to `/have`, `/gabi` or any other slash
 *     command answer — those are *interaction responses*, explicitly excluded by
 *     the sentence above, and the exclusion is Discord's, not this build's.
 *  3. **`dm`** — a direct message to the app. In a DM **every** user message is
 *     addressed to her, so no mention is needed and none is looked for. This
 *     needs `DIRECT_MESSAGES` (1 << 12), which is **UNPRIVILEGED** (same page's
 *     intent table: it is not in the `GUILD_PRESENCES` / `GUILD_MEMBERS` /
 *     `MESSAGE_CONTENT` privileged list).
 *
 * ⚠️ **Still NOT built, and still an owner decision: bare text.** `heygabi …`
 * with no mention, no reply and not in a DM needs `MESSAGE_CONTENT`, which
 * `discord-bot-design.md` §1.5 refuses. None of the three doors above moves that
 * line by a millimetre — each one is a message somebody deliberately addressed
 * to her.
 *
 * ## The mention test is deliberately strict
 *
 * In a guild, `mentionTrigger()` requires the app's id in the `mentions` array
 * **AND** either the raw `<@id>` / `<@!id>` token in the text **or** proof that
 * the message is a reply to one of her own. Things that look like a mention and
 * are not:
 *
 *  - **`@everyone` / `@here`** — carried by `mention_everyone`, which adds
 *    nobody to `mentions`. A bot that answered every `@everyone` would be a
 *    bot nobody keeps in their server.
 *  - **A role the bot holds** — `mention_roles`, ignored here for the same
 *    reason.
 *  - **A reply to somebody ELSE's message that happens to list her** — the
 *    reply arm requires `referenced_message.author.id` to be her own id, so
 *    "talked TO" and "talked ABOUT" stay separate. ⚠️ A reply whose original was
 *    deleted arrives with no `referenced_message` and is **ignored**: she cannot
 *    prove the message was hers, and guessing is how a bot answers a
 *    conversation it was never in.
 *
 * And bots never trigger her (`author.bot`, or a `webhook_id`): two bots that
 * mention each other are an infinite loop that spends real money.
 *
 * ## What she is allowed to do — the allowlist, as an explicit array
 *
 * `GABI_MENTION_ACTIONS` is the whole surface. It is an **array, not a
 * subtraction**, mirroring `@lc/core`'s `GABI_TOOLS` and pinned by a test that
 * fails the build if anything is added: this phase reads, remembers and talks,
 * and every write, moderation and admin verb is absent by construction rather
 * than by a guard somebody could forget.
 */

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AFFIRMATIVE-ONLY, exactly like `MODERATION_ENABLED` and the library's
 * `GABI_PANEL`.** `"on"` and nothing else. Absent, empty, `"true"`, `"1"`,
 * `"yes"` and every typo all mean OFF — and OFF means the gateway **never
 * opens a connection**, so an off bot is not merely silent, it is not there.
 *
 * Flipping it is an owner/conductor decision, never a side effect of a deploy.
 * `test/mentions.test.ts` pins it both ways so a drift in either direction is a
 * failing build rather than a surprise in a channel.
 */
export function mentionsOn(env: Pick<Env, 'GABI_MENTIONS'>): boolean {
  return (env.GABI_MENTIONS ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/**
 * ⚠️ **EVERYTHING a mention can cause, named.** Adding a row here is a design
 * decision somebody makes on purpose; `test/mentions.test.ts` asserts this
 * exact array, so a write path cannot arrive quietly alongside a feature.
 *
 * Note what is NOT here and cannot be added without failing that test:
 * no catalogue write, no `change_log` row, no Firestore write, no timeout, no
 * message delete, no role change, no command registration, no key rotation.
 */
export const GABI_MENTION_ACTIONS = [
  /** Read the estate index's PUBLIC slice — `/have`'s own credential-free lookup. */
  'lookup_public_shelf',
  /** One classification turn on the cheap tier, when a key is configured. */
  'classify_intent',
  /** One conversational turn on the cheap tier, when a key is configured. */
  'converse',
  /** Post one reply into the channel the mention came from. */
  'reply_in_channel',
  /** ⚠️ ADDED WITH CONTINUITY (2026-08-17). Read back the rolling per-person
   * transcript for this (surface, space, person) — the estate's OWN Durable
   * Object storage, never Firestore and never a catalogue row. */
  'recall_conversation',
  /** ⚠️ ADDED WITH CONTINUITY. Write that transcript back, inside a 30-minute
   * window and a 20-turn cap, and DELETE it when it ages out. This is the only
   * persistent write anywhere in this flow, it stores message text and nothing
   * else, and it is bounded by the same daily cap as the answers themselves. */
  'remember_conversation',
  /** ⚠️ ADDED WITH CONTINUITY. Attach a select menu / button to her own reply so
   * a clarifying question can be answered with a click. Components she posts —
   * it grants her nothing new to read. */
  'offer_choice_components',
  /** ⚠️ ADDED WITH CONTINUITY. Open a modal (one free-text box) when the answer
   * is not on the menu. The typed text arrives on the ALREADY-LIVE, Ed25519-
   * verified interactions endpoint and is treated as an ordinary question. */
  'open_question_modal',
  /** ⚠️ ADDED WITH THE TIER-0 TOOLS (2026-08-18). Read the audiobook site's
   * PUBLIC `catalog.csv` — the one estate surface that records a narrator, a
   * running time or a genre (the index's `entry` table holds none of the three;
   * `catalog-data.ts` carries the measurement). Credential-free, exactly as
   * `lookup_public_shelf` is, and for the same recorded reason: the surface is
   * already published to the open internet. ⚠️ NOT a licence to read a GATED
   * surface — no ebook manifest, no file bytes, no signed URL. */
  'lookup_catalog_metadata',
  /** ⚠️ ADDED WITH THE TIER-0 TOOLS. Let the model call the read-only tools in
   * `gabi-tools.ts` during a turn, bounded by `MAX_TOOL_ITERATIONS` and
   * `MAX_TOOL_CALLS_PER_TURN`. Every name goes through that file's allowlist
   * before dispatch, every tool declares `mutates: false`, and
   * `test/gabi-tools.test.ts` fails the build if either stops being true. */
  'call_catalog_tools',
] as const;

export type GabiMentionAction = (typeof GABI_MENTION_ACTIONS)[number];

// ---------------------------------------------------------------------------
// The wire shape (the subset a MESSAGE_CREATE dispatch is read for)
// ---------------------------------------------------------------------------

export interface GatewayUser {
  id?: unknown;
  bot?: unknown;
  username?: unknown;
  global_name?: unknown;
}

export interface GatewayMessage {
  id?: unknown;
  channel_id?: unknown;
  /** ⚠️ ABSENT in a direct message, and that absence IS the DM test. Discord
   * sends `guild_id` on every guild `MESSAGE_CREATE`, threads included. */
  guild_id?: unknown;
  content?: unknown;
  author?: GatewayUser;
  mentions?: unknown;
  webhook_id?: unknown;
  /** 0 = DEFAULT, 19 = REPLY. Everything else (joins, pins, threads…) is noise. */
  type?: unknown;
  /** Present on a reply (type 19) unless the original was deleted. Its author
   * is what proves the reply is to one of HER messages. */
  referenced_message?: { author?: GatewayUser } | null;
}

/** Discord message types this build will answer. A system message ("X pinned a
 * message") can carry a mention and is never a question. */
const ANSWERABLE_TYPES = new Set([0, 19]);

/** Discord's message type for a reply. */
export const MESSAGE_TYPE_REPLY = 19;

/**
 * ⚠️ WHICH intent-free door this message came through. Recorded on the trigger
 * (and on the accounting line) because the three have genuinely different
 * failure modes and "she didn't answer" is otherwise unanswerable:
 * a `mention` that failed is a routing bug, a `reply` that never arrived is
 * almost always the ping-on-reply toggle, and a missing `dm` is the intent.
 */
export type MentionVia = 'mention' | 'reply' | 'dm';

export type MentionTrigger =
  | { kind: 'ignore'; why: string }
  | {
      kind: 'ask';
      /** How she was reached. */
      via: MentionVia;
      /** The conversation store's surface label (`conversation.ts`). */
      surface: 'discord_channel' | 'discord_dm';
      question: string;
      messageId: string;
      channelId: string;
      guildId: string | null;
      authorId: string;
      authorName: string;
    };

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `<@id>` and the legacy nickname form `<@!id>`, all occurrences. */
function mentionTokens(appId: string): RegExp {
  return new RegExp(`<@!?${appId.replace(/[^0-9]/g, '')}>`, 'g');
}

/**
 * Greeting forms the owner named — `heygabi`, `Hey Gabi`, `heyGabi`, `hey
 * @Gabi` — stripped from the FRONT of what is left after the mention comes out.
 *
 * ⚠️ This is a courtesy, not the trigger. Phase A is mention-driven; these
 * words only stop "hey gabi do we have Mistborn?" from searching the index for
 * the words "hey gabi". A bare-text trigger on the same words is the future
 * owner decision that needs the privileged intent (this file's header).
 */
/**
 * ⚠️ THREE alternatives, and the second one was found by RUNNING this rather
 * than reading it. `hey @GABI, do we have Mistborn?` strips the mention and
 * leaves `hey , do we have…` — a greeting with no "gabi" after it, because the
 * mention **was** the "gabi". A pattern that required both words left the word
 * "hey" in the search term. So: greeting-then-gabi (`heygabi`, `hey gabi`),
 * greeting alone (the mention supplied the name), or a bare `gabi`.
 *
 * The lookahead on the bare-greeting arm keeps `hi-fi audiobooks?` intact — a
 * greeting has to be followed by a separator or the end of the message to count
 * as a greeting.
 */
const GREETING =
  /^[\s,]*(?:(?:hey|hi|hello|yo|ok|okay)\s*gabi\b|(?:hey|hi|hello|yo|ok|okay)(?=[\s,.!:;]|$)|gabi\b)[\s,.!:;—–-]*/i;

/** Trailing address form: "…do we have Mistborn, gabi?" */
const TRAILING_ADDRESS = /[\s,]+(?:hey\s+)?gabi\s*[?.!]*\s*$/i;

export function stripMention(content: string, appId: string): string {
  return content.replace(mentionTokens(appId), ' ');
}

/** What is left once the mention and any greeting are removed. */
export function questionFrom(content: string, appId: string): string {
  let text = stripMention(content, appId);
  text = text.replace(GREETING, '');
  text = text.replace(TRAILING_ADDRESS, '');
  return text.replace(/\s+/g, ' ').trim();
}

/** A one-word "?" is not a question. Same reasoning as `/gabi`'s own floor.
 * ⚠️ Applies to the MENTION door only — see `mentionTrigger`. */
export const MIN_MENTION_QUESTION = 3;

/**
 * ⚠️ The floor for a reply or a DM is ONE character, and that is deliberate
 * rather than sloppy. A bare `@GABI` with nothing after it is somebody's stray
 * ping; a DM that says only `hi` is a person starting a one-to-one conversation,
 * and silence there reads as broken rather than as restraint.
 */
export const MIN_CONTINUATION_QUESTION = 1;

/**
 * Is this a reply to one of HER OWN messages?
 *
 * ⚠️ The proof is `referenced_message.author.id`, never `message_reference`
 * alone: the latter says "this is a reply", not "a reply to her". A reply whose
 * original was deleted carries no `referenced_message` and therefore fails
 * here — she cannot prove the message was hers, and answering anyway would mean
 * joining a conversation she was never in.
 */
export function isReplyToApp(msg: GatewayMessage, appId: string): boolean {
  const type = typeof msg.type === 'number' ? msg.type : 0;
  if (type !== MESSAGE_TYPE_REPLY) return false;
  return str(msg.referenced_message?.author?.id) === appId;
}

/**
 * Is this message a question FOR her, and through which door? Pure, and every
 * rejection is named — a bot that ignores things silently is a bot nobody can
 * debug.
 */
export function mentionTrigger(msg: GatewayMessage, appId: string): MentionTrigger {
  if (!appId) return { kind: 'ignore', why: 'no_application_id' };

  const author = msg.author ?? {};
  const authorId = str(author.id);
  if (!authorId) return { kind: 'ignore', why: 'no_author' };
  if (author.bot === true) return { kind: 'ignore', why: 'author_is_bot' };
  if (str(msg.webhook_id)) return { kind: 'ignore', why: 'webhook_message' };
  if (authorId === appId) return { kind: 'ignore', why: 'own_message' };

  const type = typeof msg.type === 'number' ? msg.type : 0;
  if (!ANSWERABLE_TYPES.has(type)) return { kind: 'ignore', why: `message_type_${type}` };

  const channelId = str(msg.channel_id);
  const messageId = str(msg.id);
  if (!channelId || !messageId) return { kind: 'ignore', why: 'no_channel_or_message_id' };

  const guildId = str(msg.guild_id) || null;
  const content = str(msg.content);
  const who = {
    messageId,
    channelId,
    guildId,
    authorId,
    authorName: str(author.global_name) || str(author.username) || 'there',
  };

  // ── Door 3: a DM. No mention is looked for, because in a one-to-one channel
  // every message is addressed to her by construction. `guild_id` absent is the
  // test; Discord sends it on every guild message, threads included.
  if (!guildId) {
    const question = continuationQuestion(content, appId);
    if (question.length < MIN_CONTINUATION_QUESTION) return { kind: 'ignore', why: 'empty_question' };
    return { kind: 'ask', via: 'dm', surface: 'discord_dm', question, ...who };
  }

  // ⚠️ In a guild, the `mentions` array is the gate for BOTH remaining doors —
  // and for the reply door it is not a formality: it is what proves the person
  // left "ping on reply" ON, which is the documented condition under which
  // Discord delivers the content at all (this file's header). A reply with the
  // ping removed arrives blank AND unlisted, so it fails here rather than
  // failing later with an empty question.
  const mentioned = Array.isArray(msg.mentions)
    ? msg.mentions.some((m) => str((m as GatewayUser | null)?.id) === appId)
    : false;
  if (!mentioned) return { kind: 'ignore', why: 'not_mentioned' };

  // ── Door 1: a literal `<@id>` typed in the text. The token alone could be
  // somebody quoting an id, which is why the array above is checked too.
  if (mentionTokens(appId).test(content)) {
    const question = questionFrom(content, appId);
    if (question.length < MIN_MENTION_QUESTION) return { kind: 'ignore', why: 'empty_question' };
    return { kind: 'ask', via: 'mention', surface: 'discord_channel', question, ...who };
  }

  // ── Door 2: a reply to one of her own messages, ping left on.
  if (isReplyToApp(msg, appId)) {
    const question = continuationQuestion(content, appId);
    if (question.length < MIN_CONTINUATION_QUESTION) return { kind: 'ignore', why: 'empty_question' };
    return { kind: 'ask', via: 'reply', surface: 'discord_channel', question, ...who };
  }

  return { kind: 'ignore', why: 'no_mention_token' };
}

/**
 * What was said, for the two doors where the address is structural rather than
 * typed.
 *
 * ⚠️ Falls back to the RAW text when greeting-stripping empties it. In a
 * mention, `@GABI` with nothing after it is genuinely not a question. In a DM or
 * a reply, "thanks!" and "hi" ARE the message — stripping them to nothing and
 * then ignoring them would make her go silent in exactly the moments a person is
 * most sure she is listening.
 */
function continuationQuestion(content: string, appId: string): string {
  const stripped = questionFrom(content, appId);
  return stripped.length > 0 ? stripped : content.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Intent — the ladder
// ---------------------------------------------------------------------------

/**
 * ⚠️ **Four intents, and the router works WITH OR WITHOUT an Anthropic key.**
 *
 * With `ANTHROPIC_API_KEY_GABI` set, one cheap classification turn decides.
 * Without it, `classifyByKeyword()` below decides — she still answers lookups
 * and still nudges toward the panel for fixes, and she gains a brain the moment
 * the key lands. ⚠️ A missing key NEVER produces an error message in a channel;
 * it produces a worded line in the Worker's log and a slightly duller GABI.
 */
export type MentionIntent = 'have_lookup' | 'fix_request' | 'question' | 'smalltalk';

export const MENTION_INTENTS: readonly MentionIntent[] = [
  'have_lookup',
  'fix_request',
  'question',
  'smalltalk',
] as const;

export function isMentionIntent(v: unknown): v is MentionIntent {
  return typeof v === 'string' && (MENTION_INTENTS as readonly string[]).includes(v);
}

const HAVE_PATTERNS = [
  /\bdo (?:we|you|i) (?:have|own)\b/i,
  /\bhave (?:we|you|i) got\b/i,
  /\bis\b.*\bon the (?:shelf|shelves)\b/i,
  /\b(?:got|have) any\b/i,
  /\bin the (?:catalogue|catalog|library|collection)\b/i,
  /\bcan i (?:read|listen to|borrow)\b/i,
  /\blook(?:ing)? up\b/i,
  /\bsearch for\b/i,
];

const FIX_PATTERNS = [
  /\bfix\b/i,
  /\b(?:can you |please )?(?:change|update|correct|edit|set|add|remove|delete|rename)\b/i,
  /\bwrong\b/i,
  /\bmissing\b/i,
  /\bshould (?:be|say)\b/i,
  /\bis (?:not|n't) right\b/i,
];

const SMALLTALK_PATTERNS = [
  /^(?:hi|hey|hello|yo|sup|howdy|good (?:morning|afternoon|evening))\b/i,
  /^how (?:are|r) (?:you|u)\b/i,
  /^(?:thanks|thank you|ta|cheers|nice one|good bot)\b/i,
  /^(?:who|what) are you\b/i,
];

/**
 * The no-key path. Deliberately dull and deliberately ORDERED: a message that
 * asks for a fix to a book she should look up is a fix request first, because
 * the fix answer carries the lookup's answer with it.
 */
export function classifyByKeyword(question: string): MentionIntent {
  const q = question.trim();
  if (FIX_PATTERNS.some((re) => re.test(q))) return 'fix_request';
  if (HAVE_PATTERNS.some((re) => re.test(q))) return 'have_lookup';
  if (SMALLTALK_PATTERNS.some((re) => re.test(q))) return 'smalltalk';
  // ⚠️ The default is `question`, not `have_lookup`. Guessing "lookup" would
  // make her answer "nothing on the shelf matches that" to *"what can you do?"*
  // — a statement about the catalogue in reply to a question that was not about
  // the catalogue, which is the one wording failure /have exists to prevent.
  return 'question';
}

// ---------------------------------------------------------------------------
// Spend caps
// ---------------------------------------------------------------------------

/** One hour, rolling, per person. */
export const USER_WINDOW_MS = 60 * 60 * 1000;
/** Suggested by the brief and adopted: 20 answered mentions per person per hour. */
export const USER_TURNS_PER_WINDOW = 20;
/** The estate-wide fuse. A runaway channel costs a day, not a month. */
export const GLOBAL_TURNS_PER_DAY = 200;

/** Drop timestamps that have aged out. Pure so the window is testable without a clock. */
export function pruneWindow(times: readonly number[], now: number, windowMs = USER_WINDOW_MS): number[] {
  const floor = now - windowMs;
  return times.filter((t) => Number.isFinite(t) && t > floor);
}

/** UTC day key for the global bucket. UTC, not local: the estate spans nobody's
 * timezone in particular and a DST-shifting reset is a bug waiting to be filed. */
export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type CapVerdict = { ok: true } | { ok: false; scope: 'user' | 'global'; message: string };

export function capDecision(counts: { userInWindow: number; globalToday: number }): CapVerdict {
  if (counts.globalToday >= GLOBAL_TURNS_PER_DAY) {
    return { ok: false, scope: 'global', message: MENTION_MSG.globalCapped };
  }
  if (counts.userInWindow >= USER_TURNS_PER_WINDOW) {
    return { ok: false, scope: 'user', message: MENTION_MSG.userCapped };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/**
 * ⚠️ Every sentence here obeys `/have`'s inherited rules: never "you don't own
 * this" (a catalogue absence is a statement about the CATALOGUE), never an
 * outage phrased as a refusal, and never a bare status.
 */
export const MENTION_MSG = {
  /** Addressed by mention, as the brief asks — "Hey @Sam — …".
   *
   * ⚠️ Used only on the FIRST turn of a conversation, and not in a DM. Once she
   * remembers, re-greeting somebody by ping on every reply is how a bot that
   * gained a memory manages to sound like it lost one — and in a DM there is
   * nobody else in the room to disambiguate. `mention-flow.ts` decides. */
  greet: (userId: string) => `Hey <@${userId}> —`,

  userCapped:
    "I've answered a lot of your questions in the last hour, so I'm going to sit the next few out — " +
    "it's a spending cap on my side, not anything you did. Try me again a bit later, or ask on the site " +
    'where there is no cap.',

  globalCapped:
    "I've hit my answering budget for today across the whole estate — a cap on my side, nothing to do " +
    'with your question. It resets overnight. The site can still help in the meantime.',

  /** What she can and cannot do from Discord, in her own voice. Used by the
   * fix path and available to the conversational one as grounding. */
  cannotChange:
    "I can look things up from here, but I can't actually change anything in Discord yet — " +
    'the editing lives on the site, where I can show you the change and you approve it.',

  unreachable:
    "I couldn't reach the estate's catalogue just then — that's a problem on our side, not an answer " +
    'about the book. Nothing was searched.',

  refused: (status: number) =>
    `The catalogue turned my search down just then (HTTP ${status}) — a problem on our side, not an ` +
    'answer about the book. Nothing was searched.',

  searched: (term: string) => `I looked on the estate's public shelf for **${term}**.`,

  none:
    "Nothing on the estate's public shelf matches that. ⚠️ That's a statement about the **catalogue**, " +
    'not about the house — books get catalogued as they are scanned, and a real book nobody has scanned ' +
    'yet looks exactly like this.',

  overflow: (shown: number, total: number) => `\n_Closest ${shown} of ${total} matches._`,

  panel: (url: string) =>
    `I can dig into the actual rows and put a change in front of you to approve here: ${url}`,

  /** The reply when she genuinely has nothing to say and no key to say it with. */
  noKeyFallback:
    "I'm listening, but from Discord I can only really look books up right now. Ask me *do we have …* " +
    'and I will go and check the shelf.',
} as const;
