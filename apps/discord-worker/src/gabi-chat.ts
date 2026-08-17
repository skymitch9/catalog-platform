/**
 * The only two places a Discord mention can spend money, and the accounting
 * that makes the spend visible.
 *
 * ## ⚠️ THE LADDER — she works with or without a key, and the difference is
 * quality, never an error
 *
 * `ANTHROPIC_API_KEY_GABI` is a NEW secret, held nowhere else. When it is set,
 * `classifyIntent()` decides what a message wants and `converse()` answers the
 * chatty ones. When it is **not** set, both functions return `null` having made
 * no request at all, the caller falls back to `classifyByKeyword()`
 * (`mentions.ts`), and the person in the channel sees a slightly duller GABI
 * rather than a stack trace.
 *
 * ⚠️ **A missing key is logged, never spoken.** `logNoKey()` writes one worded
 * line to the Worker log; nothing about a configuration gap reaches a channel.
 * That is the estate's no-bare-status rule applied to an absence: the person
 * asking about a book did not misconfigure anything and should not be told
 * about it.
 *
 * ## Why Haiku here, when the library's own loop refuses it
 *
 * `gabi-fixer-design.md` §7.2 rejects Haiku for the *panel's* loop, and the
 * reasoning is sound there: that loop's ~1.8k cached prefix sits **below
 * Haiku's 4096-token cache minimum**, so the cheap model would pay full input
 * price on every turn while Opus 5 pays 0.1×, and tool-selection accuracy is
 * what decides whether the wrong value gets written.
 *
 * ⚠️ **Neither half of that argument applies to this file, and the difference is
 * the point.** There are no tools here — nothing can be written, so there is no
 * tool-selection accuracy to lose. And these prompts are a few hundred tokens,
 * far below *any* model's cache minimum, so nobody is caching and Opus 5's
 * advantage evaporates: the comparison is full-price $5/MTok against full-price
 * $1/MTok for a four-way classification. This is the "cheap tier for glue" the
 * owner asked for, and it is a different job from the panel's.
 *
 * ## ⚠️ NO `output_config.effort`, DELIBERATELY
 *
 * `effort` **errors on Haiku 4.5** — it arrived with Opus 4.5 and the Sonnet/
 * Opus 4.6 family. Passing it here would turn every conversational reply into a
 * 400. Likewise no `thinking` block: on this model class thinking is off unless
 * asked for, which is what a one-word classifier wants.
 *
 * ## The classifier reads a bare word, not a schema
 *
 * Haiku 4.5 does support structured outputs, and a `json_schema` would be the
 * textbook answer. It is not used because **the fallback already exists**: an
 * unrecognised answer routes through `classifyByKeyword()`, which is a real
 * router rather than an error path. A schema would buy a guarantee this code
 * does not need, at the cost of first-request schema compilation on a call
 * whose whole reason for existing is being cheap and fast.
 */

import Anthropic from '@anthropic-ai/sdk';
import { classifyByKeyword, isMentionIntent, type MentionIntent } from './mentions.js';
import { conversationChars, type ConversationTurn } from './conversation.js';

/**
 * ⚠️ Pinned, not aliased. `claude-haiku-4-5` is the moving alias for this
 * snapshot; the pin is deliberate on a spend-capped surface that nobody watches
 * — a model that changes under a fixed cap changes the cap's meaning. Recorded
 * on every accounting line so a later comparison has both halves.
 */
export const GABI_CHAT_MODEL = 'claude-haiku-4-5-20251001';

/** $ per million tokens, from the published price table (Haiku 4.5, 2026-08-17).
 * Arithmetic, not an invoice — `estimateCents` says so in its own name. */
export const HAIKU_IN_PER_MTOK = 1.0;
export const HAIKU_OUT_PER_MTOK = 5.0;

/** A classification is one word. 24 leaves room for the model to be chatty and
 * still be parsed; it never leaves room for it to be expensive. */
export const CLASSIFY_MAX_TOKENS = 24;

/** ⚠️ Chat output is CAPPED for a channel, not for a document. Discord's own
 * ceiling is 2000 characters and a wall of text from a bot is a bot people mute. */
export const CHAT_MAX_TOKENS = 400;

/** A turn that runs away must fail, not vanish — the same rule the panel's loop
 * applies, at a length appropriate to a chat reply. */
export const CHAT_TIMEOUT_MS = 20_000;

/** ⚠️ No retries, exactly as `researchDetails` and the panel's turn decide: a
 * retried turn is double spend on an answer that may already have landed. */
const NO_RETRIES = 0;

// ---------------------------------------------------------------------------
// Accounting
// ---------------------------------------------------------------------------

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * ⚠️ Arithmetic over the published table, and it prices **all four input
 * classes** the way `gabiCents` in the library had to be corrected to
 * (`gabi-fixer-design.md` §7.4): `usage.input_tokens` EXCLUDES cache reads, so
 * summing only the two obvious fields errs LOW. Nothing here caches — the
 * prompts are far under any minimum — so the cached fields are zero in
 * practice, and they are read anyway rather than assumed.
 */
export function estimateCents(usage: TurnUsage): number {
  const dollars =
    (usage.inputTokens / 1_000_000) * HAIKU_IN_PER_MTOK +
    (usage.outputTokens / 1_000_000) * HAIKU_OUT_PER_MTOK;
  return Math.round(dollars * 100 * 10_000) / 10_000;
}

/**
 * One structured line per model turn, mirroring the library's `gabi_turn` row.
 *
 * ⚠️ **A LOG LINE, NOT A TABLE, and that is a recorded compromise rather than an
 * oversight.** This Worker has no D1 binding, and adding one for four columns
 * would be new infrastructure on the credential-lightest Worker in the estate.
 * The line is JSON on one line so `wrangler tail | jq` aggregates it, and it
 * carries the RAW token counts beside the derived cents for the same reason
 * `gabi_turn` stores columns rather than a total: a stored total computed by a
 * wrong function is wrong forever. Promoting this to D1 is in the tech-debt
 * section of `docs/TODO.md`.
 */
export function accountTurn(entry: {
  purpose: 'classify' | 'converse';
  usage: TurnUsage;
  discordUserId: string;
  guildId: string | null;
  /** Which door this turn came through — `mention` / `reply` / `dm` /
   * `component`. Defaults to the pre-continuity value so an old dashboard
   * query does not silently start missing rows. */
  via?: string;
  /**
   * ⚠️ CONTINUITY'S SHARE OF THE SPEND, MEASURED RATHER THAN ASSUMED. Context
   * tokens are charged on every turn, so a conversation that grows makes the
   * SAME question cost more the tenth time it is asked. `input_tokens` already
   * contains that cost; these two columns are what make it attributable — how
   * many remembered turns went in, and how many characters they were. Raw
   * columns rather than a derived share, for `gabi-fixer-design.md` §7.4's
   * reason: a stored total computed by a wrong function is wrong forever.
   */
  historyTurns?: number;
  historyChars?: number;
}): void {
  console.log(
    JSON.stringify({
      evt: 'gabi_turn',
      surface: 'discord_mention',
      via: entry.via ?? 'mention',
      purpose: entry.purpose,
      model: GABI_CHAT_MODEL,
      input_tokens: entry.usage.inputTokens,
      output_tokens: entry.usage.outputTokens,
      est_cents: estimateCents(entry.usage),
      history_turns: entry.historyTurns ?? 0,
      history_chars: entry.historyChars ?? 0,
      // Discord snowflakes, not names or message text. The same no-PII line
      // /api/health draws. ⚠️ The remembered TEXT is never logged — only how
      // much of it there was.
      discord_user_id: entry.discordUserId,
      guild_id: entry.guildId,
      at: new Date().toISOString(),
    }),
  );
}

/** ⚠️ The worded line that a missing key produces INSTEAD of a channel message. */
export function logNoKey(purpose: string): void {
  console.log(
    `GABI mentions: ANTHROPIC_API_KEY_GABI is not set, so ${purpose} fell back to the keyword ` +
      'router. This is the designed ships-dark state, not a fault — set the secret with ' +
      '`wrangler secret put ANTHROPIC_API_KEY_GABI` to give her the conversational half.',
  );
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** `overrides.fetch` exists so a test can assert **how many** model calls a
 * mention makes without spending money — the same instrument the panel's turn
 * route uses, for the same reason. */
export function chatClient(apiKey: string, overrides?: { fetch?: typeof fetch }): Anthropic {
  return new Anthropic({
    apiKey,
    maxRetries: NO_RETRIES,
    timeout: CHAT_TIMEOUT_MS,
    ...(overrides?.fetch ? { fetch: overrides.fetch } : {}),
  });
}

function textOf(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown };
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('').trim();
}

// ---------------------------------------------------------------------------
// Continuity — turning a stored transcript into a prompt
// ---------------------------------------------------------------------------

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The stored transcript plus what was just said, as a Messages-API `messages`
 * array.
 *
 * ⚠️ **THE ALTERNATION IS ENFORCED HERE, NOT ASSUMED.** The store appends
 * user-then-assistant pairs, so a healthy record already alternates — but the
 * 30-minute window cuts wherever it lands, which can leave an `assistant` turn
 * first, and a dropped reply (Discord answered 403 for that channel) can leave
 * two `user` turns adjacent. The API requires a `messages` array that starts
 * with `user` and alternates; violating it is a 400 that would eat the person's
 * answer over a bookkeeping detail. So: leading assistant turns are DROPPED,
 * consecutive same-role turns are MERGED, and the current question is always
 * the last thing in the array.
 */
export function modelMessages(
  history: readonly ConversationTurn[],
  current: string,
): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const turn of history) {
    const text = turn.text.trim();
    if (text.length === 0) continue;
    if (out.length === 0 && turn.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${text}`;
    else out.push({ role: turn.role, content: text });
  }
  const last = out[out.length - 1];
  if (last && last.role === 'user') last.content = `${last.content}\n\n${current}`;
  else out.push({ role: 'user', content: current });
  return out;
}

/** How many characters of remembered conversation a turn is about to pay for. */
export function historyCost(history: readonly ConversationTurn[]): {
  historyTurns: number;
  historyChars: number;
} {
  return { historyTurns: history.length, historyChars: conversationChars(history) };
}

function usageOf(u: unknown): TurnUsage {
  const raw = (u ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  return {
    // All four input classes, per this file's §Accounting note.
    inputTokens: n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens'),
    outputTokens: n('output_tokens'),
  };
}

// ---------------------------------------------------------------------------
// 1. Classification
// ---------------------------------------------------------------------------

const CLASSIFY_SYSTEM = `You sort one Discord message into exactly one bucket. Reply with the bucket name and nothing else — no punctuation, no explanation.

have_lookup — they want to know whether a book is in the catalogue, or want you to find one.
fix_request — they want something in the catalogue changed, corrected, added or removed.
question — they are asking you something else: how you work, what you can do, a general books question.
smalltalk — a greeting, a thank-you, a joke, or anything with no task in it.

When a message asks for a change to a specific book, that is fix_request even though a book is named.

If you are shown what was said a moment ago, use it only to understand what the current message refers to. Sort the CURRENT message, not the earlier one.`;

/**
 * ⚠️ How much conversation the CLASSIFIER sees, and why it is not the whole
 * window. A classifier's job is "what does this message want", and a follow-up
 * like *"what about the second one?"* needs exactly one thing to make sense: the
 * last thing she said. Feeding it the full history would roughly quadruple the
 * input tokens of the cheapest call in the build to settle a four-way choice
 * that a fallback router already handles. Two turns, clipped.
 */
export const CLASSIFY_CONTEXT_TURNS = 2;
export const CLASSIFY_CONTEXT_CHARS = 300;

/**
 * One classification turn. Returns `null` when there is no key (the caller
 * falls back to keywords) and falls back internally on anything unexpected — a
 * classifier that throws would cost somebody an answer over a bucket name.
 */
export async function classifyIntent(
  apiKey: string | undefined,
  question: string,
  who: { discordUserId: string; guildId: string | null; via?: string },
  overrides?: { fetch?: typeof fetch },
  history: readonly ConversationTurn[] = [],
): Promise<MentionIntent | null> {
  if (!apiKey) {
    logNoKey('intent classification');
    return null;
  }
  const recent = history.slice(-CLASSIFY_CONTEXT_TURNS);
  const preamble =
    recent.length > 0
      ? `A moment ago in this conversation:\n${recent
          .map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.text.slice(0, CLASSIFY_CONTEXT_CHARS)}`)
          .join('\n')}\n\nTheir message now:\n`
      : '';
  try {
    const res = await chatClient(apiKey, overrides).messages.create({
      model: GABI_CHAT_MODEL,
      max_tokens: CLASSIFY_MAX_TOKENS,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: `${preamble}${question}` }],
    });
    accountTurn({
      purpose: 'classify',
      usage: usageOf(res.usage),
      discordUserId: who.discordUserId,
      guildId: who.guildId,
      ...(who.via ? { via: who.via } : {}),
      ...historyCost(recent),
    });
    const word = textOf(res.content).toLowerCase().replace(/[^a-z_]/g, '');
    if (isMentionIntent(word)) return word;
    // A model that answered something else is not an outage; the keyword router
    // is a real router, so use it rather than reporting a failure.
    console.log(`GABI mentions: classifier returned "${word}", using the keyword router instead.`);
    return classifyByKeyword(question);
  } catch (err) {
    console.error('GABI mentions: classification failed:', err instanceof Error ? err.message : err);
    return classifyByKeyword(question);
  }
}

// ---------------------------------------------------------------------------
// 2. Conversation
// ---------------------------------------------------------------------------

/**
 * ⚠️ The persona, and the honesty clause is load-bearing.
 *
 * She may say what she can do and what she cannot; she may never imply she has
 * changed anything, because from Discord she has no path to. That is the same
 * governing sentence the panel's system prompt carries — *the loop never
 * invents success* — narrowed to a surface where there is no success to invent.
 */
const CHAT_SYSTEM = `You are GABI, the librarian of a family's book estate, answering someone in a Discord channel.

You are a nerdy bookworm: warm, curious, first-person, genuinely delighted by books. You are talking to a person, not filing a ticket.

What is true about you right now, and you say so plainly when it comes up:
- From Discord you can look things up on the estate's public shelf. That is real and you are good at it.
- From Discord you cannot change anything — no edits, no fixes, no adding a book. The editing lives on the estate's website, where you show someone a change and they approve it. Never imply you have changed something. Never say "I've updated" or "that's sorted".
- If somebody asks for a fix, say you cannot do it from here yet and point them at the site.

An absence from the catalogue is a statement about the CATALOGUE, never about the house — books are catalogued as they are scanned, and plenty are not scanned yet. Never tell somebody they do not own a book.

You can see the last half hour of this conversation. Use it: when someone says "that one" or "the second one" or "what about the sequel", they mean what you were both just talking about. Do not make them repeat themselves, and do not pretend to remember anything older than what you can actually see.

Keep it to two or three sentences. This is a chat message, not an essay. No headings, no bullet lists, no preamble like "Great question" — answer the thing.`;

/**
 * One conversational turn, grounded with what the shelf lookup found and with
 * the remembered conversation.
 *
 * ⚠️ The history goes in as real `messages`, not as a summary pasted into the
 * user turn. A summary is a second thing that can be wrong, and it would make
 * the model reason about a transcript instead of continuing one.
 *
 * Returns `null` when there is no key; the caller words something itself.
 */
export async function converse(
  apiKey: string | undefined,
  question: string,
  grounding: string | null,
  who: { discordUserId: string; guildId: string | null; authorName: string; via?: string },
  overrides?: { fetch?: typeof fetch },
  history: readonly ConversationTurn[] = [],
): Promise<string | null> {
  if (!apiKey) {
    logNoKey('the conversational reply');
    return null;
  }
  const user = grounding
    ? `${question}\n\n(What the estate's public shelf says, for your answer — quote it rather than inventing anything: ${grounding})`
    : question;
  try {
    const res = await chatClient(apiKey, overrides).messages.create({
      model: GABI_CHAT_MODEL,
      max_tokens: CHAT_MAX_TOKENS,
      system: CHAT_SYSTEM,
      messages: modelMessages(history, user),
    });
    accountTurn({
      purpose: 'converse',
      usage: usageOf(res.usage),
      discordUserId: who.discordUserId,
      guildId: who.guildId,
      ...(who.via ? { via: who.via } : {}),
      ...historyCost(history),
    });
    const text = textOf(res.content);
    return text.length > 0 ? text : null;
  } catch (err) {
    console.error('GABI mentions: conversational turn failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
