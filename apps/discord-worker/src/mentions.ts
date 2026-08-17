/**
 * Conversational GABI in Discord — **phase A: @mention triggers only.**
 *
 * The owner's ask was *"I want to use heygabi and similar forms like Hey Gabi,
 * hey @Gabi, heyGabi etc to kick her off for a question and then she responds."*
 * This file is the half of that which needs no network: deciding **whether a
 * message is for her**, **what she was asked**, **which shape of answer it
 * wants**, and **whether she is allowed to spend anything answering it**.
 *
 * ## ⚠️ WHY @MENTION ONLY, AND WHY THAT IS NOT A SHORTCUT
 *
 * A bare-text trigger — someone typing `heygabi do we have Mistborn?` with no
 * mention — requires reading the text of messages the bot was not addressed in,
 * and that is **Discord's Message Content privileged intent**, which
 * `discord-bot-design.md` §1.5 says is **never requested**. Phase A therefore
 * fires on a genuine `@GABI` mention and nothing else.
 *
 * ⚠️ **MEASURED 2026-08-17, not assumed** — the whole design rests on this, so
 * it was read off Discord's own documentation rather than inferred:
 *
 * > *"Content in messages that an app sends / Content in DMs with the app /
 * > Content in which the app is mentioned / Content of the message a message
 * > context menu command is used on"*
 * > — <https://docs.discord.com/developers/events/gateway>, the four exceptions
 * > to the `MESSAGE_CONTENT` intent's blanking of content fields.
 *
 * So a `MESSAGE_CREATE` for a message that mentions the app arrives **with its
 * `content` populated** on the unprivileged `GUILDS` + `GUILD_MESSAGES`
 * intents. Every other message arrives with `content: ""`, which this file
 * treats as "not for her" — and that is the mechanism, not a promise.
 *
 * ## The mention test is deliberately strict
 *
 * `mentionTrigger()` requires the app's id in **BOTH** the `mentions` array AND
 * the raw `<@id>` / `<@!id>` token in the text. Three things that look like a
 * mention and are not:
 *
 *  - **`@everyone` / `@here`** — carried by `mention_everyone`, which adds
 *    nobody to `mentions`. A bot that answered every `@everyone` would be a
 *    bot nobody keeps in their server.
 *  - **A role the bot holds** — `mention_roles`, ignored here for the same
 *    reason.
 *  - **A reply to one of her messages** — Discord adds the replied-to author to
 *    `mentions` automatically. Requiring the literal `<@id>` in the text is
 *    what separates "she is being talked TO" from "she is being talked ABOUT".
 *
 * And bots never trigger her (`author.bot`, or a `webhook_id`): two bots that
 * mention each other are an infinite loop that spends real money.
 *
 * ## What she is allowed to do — the allowlist, as an explicit array
 *
 * `GABI_MENTION_ACTIONS` is the whole surface. It is an **array, not a
 * subtraction**, mirroring `@lc/core`'s `GABI_TOOLS` and pinned by a test that
 * fails the build if anything is added: phase A reads and talks, and every
 * write, moderation and admin verb is absent by construction rather than by a
 * guard somebody could forget.
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
  guild_id?: unknown;
  content?: unknown;
  author?: GatewayUser;
  mentions?: unknown;
  webhook_id?: unknown;
  /** 0 = DEFAULT, 19 = REPLY. Everything else (joins, pins, threads…) is noise. */
  type?: unknown;
}

/** Discord message types this build will answer. A system message ("X pinned a
 * message") can carry a mention and is never a question. */
const ANSWERABLE_TYPES = new Set([0, 19]);

export type MentionTrigger =
  | { kind: 'ignore'; why: string }
  | {
      kind: 'ask';
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

/** A one-word "?" is not a question. Same reasoning as `/gabi`'s own floor. */
export const MIN_MENTION_QUESTION = 3;

/**
 * Is this message a question FOR her? Pure, and every rejection is named — a
 * bot that ignores things silently is a bot nobody can debug.
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

  // ⚠️ BOTH halves. The array alone catches replies and @everyone-adjacent
  // cases; the token alone could be typed by someone quoting an id. Together
  // they mean "this person addressed her, on purpose".
  const mentioned = Array.isArray(msg.mentions)
    ? msg.mentions.some((m) => str((m as GatewayUser | null)?.id) === appId)
    : false;
  if (!mentioned) return { kind: 'ignore', why: 'not_mentioned' };

  const content = str(msg.content);
  if (!mentionTokens(appId).test(content)) return { kind: 'ignore', why: 'no_mention_token' };

  const channelId = str(msg.channel_id);
  const messageId = str(msg.id);
  if (!channelId || !messageId) return { kind: 'ignore', why: 'no_channel_or_message_id' };

  const question = questionFrom(content, appId);
  if (question.length < MIN_MENTION_QUESTION) return { kind: 'ignore', why: 'empty_question' };

  return {
    kind: 'ask',
    question,
    messageId,
    channelId,
    guildId: str(msg.guild_id) || null,
    authorId,
    authorName: str(author.global_name) || str(author.username) || 'there',
  };
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
  /** Addressed by mention, as the brief asks — "Hey @Sam — …". */
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
