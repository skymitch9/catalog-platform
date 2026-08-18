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
import { historyCost, modelMessages, type ConversationTurn } from './conversation.js';

/**
 * ⚠️ **MOVED, not deleted (2026-08-18).** `ModelMessage`, `modelMessages()` and
 * `historyCost()` now live in `@platform/gabi-conversation`: the alternation
 * rule ("drop leading assistant turns, merge consecutive same-role turns") and
 * the history accounting are the site panel's problem too, and a second copy of
 * either is exactly the duplication that package exists to prevent. They are
 * re-exported from here so every existing importer and test is unchanged.
 */
export { modelMessages, historyCost, type ModelMessage } from './conversation.js';
import {
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_ITERATIONS,
  toolsForApi,
} from './gabi-tools.js';
import { runTool, type ToolContext } from './tool-exec.js';

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

/**
 * ⚠️ **THE TOOL LOOP GETS A HIGHER CEILING, AND 400 WAS A LATENT BUG.**
 *
 * `CHAT_MAX_TOKENS` bounds what a person READS, and 400 tokens ≈ 1,600
 * characters is the right size for a Discord message. But `max_tokens` bounds
 * everything the model EMITS, and in a tool loop most of that is `tool_use`
 * blocks the person never sees — schemas echoed back as JSON arguments.
 *
 * ⚠️ Found while diagnosing the 2026-08-18 live failure. Adding the two docs
 * tools took the offered set from two tools to four and the system prompt from
 * one block to two, which makes a longer `tool_use` emission likelier — and a
 * turn that runs out of tokens **mid-`tool_use`** comes back with
 * `stop_reason: 'max_tokens'`, no text block, and therefore no answer at all.
 * The loop then returned `null` and the caller fell through to its fallback.
 *
 * The reply is still truncated to Discord's ceiling by `mention-flow.ts`, so
 * raising this changes what she can THINK, never what she can SAY.
 */
export const CHAT_TOOL_MAX_TOKENS = 1024;

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
  purpose: 'classify' | 'converse' | 'converse_tools';
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
  /**
   * ⚠️ TOOL ACCOUNTING, added with the Tier-0 catalogue tools (2026-08-18).
   * Two raw columns rather than one derived "used tools" boolean, for the same
   * reason the token counts are raw: a tool loop's cost is *how many* calls it
   * made and *which*, and a stored summary computed by a wrong function is
   * wrong forever. `tools` is the ordered list of names actually executed, so
   * `wrangler tail | jq` can answer "how often does she reach for
   * series_volumes" without a second instrument.
   */
  toolCalls?: number;
  tools?: readonly string[];
  /** How many times the turn went round the tool loop, against
   * `MAX_TOOL_ITERATIONS`. A turn that keeps hitting the ceiling is a prompt
   * problem, and this is how it becomes visible rather than merely expensive. */
  toolIterations?: number;
  /**
   * ⚠️ **DOCS ACCOUNTING (design §5.5), added 2026-08-18 with Tier 0b.** Two raw
   * columns, for the same reason every other pair here is raw: a docs turn is
   * roughly an order of magnitude heavier than an ordinary one, and its cost is
   * *how many sections* and *how many bytes* came back. A derived "used docs"
   * boolean would answer none of the questions anybody will actually ask.
   *
   * ⚠️ **THE RETRIEVED TEXT IS NEVER LOGGED — only how much of it there was.**
   * The corpus's audience is the estate's devops; this log stream's audience is
   * anyone who can run `wrangler tail`. Logging the text would put runbook
   * content, secret names and household emails into a second place with a wider
   * gate than the one the whole feature is built around.
   */
  docsSections?: number;
  docsBytes?: number;
  /**
   * ⚠️ **BOOK ACCOUNTING (design §4.6), added 2026-08-18 with Tier 0c.** Two raw
   * columns again, and the pair is deliberately NOT folded into the docs pair:
   * a docs turn carries ~6k tokens of runbook and a book turn carries ~6k tokens
   * of somebody's NOVEL. They cost the same and they mean nothing alike, and one
   * shared column would make neither answerable.
   *
   * ⚠️ **THE RETRIEVED PASSAGES ARE NEVER LOGGED — only how much came back**
   * (design §8). That protects the household's privacy and the copyright posture
   * at once, and it is why this is a byte count rather than an excerpt. A log
   * stream naming who asked what about which novel is a second copy of the thing
   * the `vis_ebooks` gate protects.
   */
  booksPassages?: number;
  booksBytes?: number;
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
      tool_calls: entry.toolCalls ?? 0,
      tools: entry.tools ?? [],
      tool_iterations: entry.toolIterations ?? 0,
      docs_sections: entry.docsSections ?? 0,
      docs_bytes: entry.docsBytes ?? 0,
      books_passages: entry.booksPassages ?? 0,
      books_bytes: entry.booksBytes ?? 0,
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

// ---------------------------------------------------------------------------
// 3. Conversation WITH the Tier-0 catalogue tools
// ---------------------------------------------------------------------------

/**
 * ⚠️ The tool-using persona. It is `CHAT_SYSTEM` plus the three sentences that
 * make a tool loop honest, and every one of them was earned by a failure this
 * estate has actually seen:
 *
 *  1. **Look it up, never remember it.** Haiku 4.5 knows perfectly well who
 *     narrates The Way of Kings and will happily say so without calling
 *     anything — and then it is answering about the *world*, not about the
 *     *estate*, which is the entire point of the feature.
 *  2. **Name the book you matched.** A fielded answer with no title is
 *     unfalsifiable; naming it makes a wrong match visible in one line.
 *  3. **Keep the coverage sentence.** Every tool result carries `coverage`
 *     saying which shelf was searched and which two are unreachable. A count
 *     that drops it is a wrong answer wearing a number.
 */
const CHAT_TOOLS_SYSTEM = `${CHAT_SYSTEM}

You have two tools that read the estate's own audiobook catalogue. Use them:

- Look things up rather than remembering them. You may know who narrates a famous book; you do not know what THIS house has catalogued, and that is the only question you are being asked. Anything factual about a book — narrator, running time, year, series position, how many of something there are — comes from a tool call or it does not get said.
- Always name the book you matched, so somebody can tell you picked the wrong one.
- If the catalogue does not record a field, say that. Never fill it in, never guess a narrator, never round a count.
- When a tool result carries a "coverage" sentence, keep what it says: you are counting ONE shelf, and the library and board-game catalogues are not reachable from Discord. Give the breakdown, never a bare number.
- A question that names several authors or universes is several lookups. Make them all in one go rather than asking the person to repeat themselves.`;

/**
 * ⚠️ **THE DOCS ADDENDUM — appended ONLY on a turn where the docs tools are
 * actually offered** (design phase 4).
 *
 * Kept out of `CHAT_TOOLS_SYSTEM` rather than folded into it, for two reasons.
 * It is input tokens on every turn that carries it, and the overwhelming
 * majority of turns are about books; and describing a capability the model does
 * not have on this turn is how a model ends up apologising for not doing
 * something nobody offered it.
 *
 * Every line is a failure this estate has either seen or designed against:
 *
 *  1. **Look it up, never remember it.** A model knows how software generally
 *     works and will happily explain a "typical" deploy — which is an answer
 *     about the WORLD, not about this house, and the whole feature exists to
 *     answer the second question.
 *  2. **Say the date.** The publisher rides an 8-hourly pipeline that can pause;
 *     a stale snapshot is only visible in the reply (design §6).
 *  3. **Name the file.** A runbook answer with no source is unfalsifiable, and
 *     these answers get acted on — somebody runs the command.
 *  4. **Absence is an answer.** The one rule `/have` already carries about the
 *     catalogue, applied to docs: "not in the snapshot" is never "not true".
 *  5. **Never invent a command.** A plausible command that is not in the runbook
 *     is worse than no command, because it will be run.
 */
const CHAT_DOCS_SYSTEM = `
You can also read the estate's own internal documentation — the runbooks, access references, design docs and work log the household keeps. Two tools: search_estate_docs, then read_estate_doc for the section that looks right.

- Use them for any question about how THIS estate works or how to do something operational here: deploys, promotions, rollbacks, which secret a thing needs, where something lives, why a decision was made. You know how software works in general; you do not know how this house does it, and that is the only question being asked.
- Search first, then read the one or two sections that actually matter. There is a strict budget per answer — spending it on near-misses leaves nothing for the real one.
- ⚠️ Say the snapshot's publish date in your answer, and name the file you are quoting so somebody can check you. If the result carries a staleness warning, say that out loud instead of presenting the answer as current.
- ⚠️ Never state a command, a path, a flag or a step that did not come back from these tools. If the docs do not give it, say the docs do not give it. A plausible-looking command that is not in the runbook is worse than no command, because somebody will run it.
- If nothing matches, say the docs do not cover it. That is a real answer and it is never the same as the thing not being true.
- If a tool refuses, relay its sentence as it is. Do not soften it, do not apologise for the estate, and do not offer to look it up another way.`;

/**
 * ⚠️ **THE BOOK ADDENDUM — appended ONLY on a turn where the book tools are
 * actually offered** (design phase 4), and kept out of `CHAT_TOOLS_SYSTEM` for
 * the same two reasons the docs addendum is: it is input tokens on every turn
 * that carries it, and describing a capability the model does not have this turn
 * is how a model ends up apologising for not doing something nobody offered it.
 *
 * Every line is a failure this design measured or argued against:
 *
 *  1. **The knowledge base is a SUBSET of the shelf, and it grows.** The owner's
 *     requirement in his own words: *"I don't want to wait until every book is
 *     processed to use Gabi's knowledge."* 157 packs against 1,079 catalogued
 *     audiobooks means most questions land on a book she has not read, so the
 *     honest sentence has to be the easy path.
 *  2. **She has read these books in TRAINING too, and that is the trap.** A
 *     model asked about a famous novel will answer fluently from memory and cite
 *     nothing — an answer about the WORLD's copy, not the household's, and
 *     indistinguishable from a real one until it is wrong.
 *  3. **The four modes are four questions.** Measured: `relevant` and `latest`
 *     alone answered 10/12 pilot questions; all four answered 12/12, and the
 *     misses were not close — a true first-appearance passage ranked 34th–60th
 *     of 200, because a first appearance is by construction the least dense
 *     mention.
 *  4. **Say the scope out loud.** The spoiler bound is derived per turn and the
 *     only way anybody can check it is if the answer states it.
 *  5. **A transcript is not the book.** Letter grades are measurably unreliable
 *     from speech (design §6.4) — `Human (D)` transcribes as *"human, G"*.
 */
const CHAT_BOOKS_SYSTEM = `
You can also read the actual TEXT of some of the household's books. Four tools: list_book_knowledge (always first — it is where book ids come from), then search_book_text, read_book_passage, and book_presence for one term across several books.

- ⚠️ WHEN THEY NAME A CHARACTER AND NOT A BOOK — "Jake's status sheet at the end of the 9th book" — that is still a book question and it is answerable. Work out which series they mean from the conversation, or from what you know of the books; look that SERIES up with list_book_knowledge to get its ids; pick the volume they named (a "9th book" is the id ending in 9); then search. Guessing where to LOOK is fine and expected. Guessing the ANSWER is not. If you genuinely cannot tell which series, ask them — never answer from the catalogue instead, and never say nothing matched.
- ⚠️ Your knowledge base is a SUBSET of the shelf and it grows as books finish processing. If a book is not in list_book_knowledge, you have not read it: say so, and offer what the catalogue knows. Never answer from your own memory of a book you have not opened here — you may well have read it in training, and that answer is about the world's copy rather than this household's.
- ⚠️ EVERY CLAIM ABOUT WHAT YOU HAVE OR HAVE NOT READ MUST COME FROM A TOOL CALL IN **THIS** TURN. That includes "I haven't read that one", "that's not in my knowledge base", "the furthest I've got is book N", and any offer of a different volume instead. ⚠️ YOUR OWN EARLIER MESSAGES ARE NOT EVIDENCE — you have already contradicted yourself across two turns this way, naming two different "furthest" books minutes apart. If you are about to say how far you have got and you have not called list_book_knowledge this turn, call it first or do not say it.
- ⚠️ NEVER put a date on when a book might arrive. Not "next week", not "soon", not "as we scan more". Books join as they finish processing and you genuinely cannot see that schedule — say that plainly instead. A promise you cannot keep is worse than an honest "I don't know when".
- ⚠️ "I haven't read that one yet" and "that doesn't happen in the book" are completely different answers. Never say the second when the first is true.
- Pick the mode deliberately. "latest" for anything about the END or the current state of something — a stat sheet, a level, a total — because the best-scoring passage is almost never the last one. "earliest" for a first appearance. "book_presence" for "which book does X first show up in", across several books at once.
- Quote and cite: name the book and the chapter, and give the timestamp when there is one. Never add a detail the passages do not contain.
- ⚠️ search_book_text already returns each hit STITCHED with the passage either side of it, so it is usually the whole answer on its own. You have room for about three tool calls in a turn — spend them on list_book_knowledge then search, and reach for read_book_passage only when a passage visibly stops mid-thing you need.
- ⚠️ WHEN AN ANSWER IS LONGER THAN ONE MESSAGE, JUST KEEP GOING. Do not stop and ask whether to continue — the reply is delivered as consecutive messages automatically, and you do not have to manage that. Asking permission does not pause an answer; it gives you a chance to repeat yourself, and that is exactly what went wrong: asked for the professions, you re-pulled and re-printed the entire sheet and ran out in the same place, twice.
- ⚠️ TO CONTINUE A LIST OR A SHEET, PAGE FORWARD — call read_book_passage with ord = the next_ord the last result gave you, and a count. NEVER re-run the search. A ranked search returns its best match every time and the tail of a sheet is never the best match, so searching again prints the same thing again, for ever.
- ⚠️ WHEN YOU CONTINUE, PRINT ONLY WHAT IS NEW. One short orienting line is fine ("continuing Jake's book-9 sheet — profession skills:") and then straight into the new material. Do not re-print the stats, the titles or the class skills you already sent. Repeating them is what consumed the room the rest of it needed.
- ⚠️ NEVER say "budget", "cap", "quota", "limit" or "allowance" to anybody. Those are our internal accounting and they read as a malfunction when nothing is wrong. If a read comes back refused, say it plainly in their terms — "that one's a longer pull than fits in this reply, ask me again and I'll get it" — and then MEAN it: the next turn starts fresh and will get it.
- ⚠️ If somebody asked you three things and you only got two, say which one you did not get and offer it — do not bury it, and do not explain the machinery.
- ⚠️ Say the scope. If a result says you are reading only up to a chapter, tell them that. If nobody said where they are, ask before going deep rather than assuming they have finished — and never assume they have not.
- ⚠️ If the text came from a TRANSCRIPT of the audiobook rather than the written book, say so when you quote it. Numbers are reliable; single letters and unusual names are not.
- If a tool refuses, relay its sentence as it is, and do not answer the question from memory instead.`;

/**
 * ⚠️ **THE KILLER OF 2026-08-18, AND THE ONE-LINE VERSION OF IT.**
 *
 * The owner asked *"how do I promote the audiobook site?"*, GABI posted
 *
 * > Perfect — found it. Let me read the promoting section:
 *
 * and then **nothing, ever**. No follow-up, no error, no wobble sentence.
 *
 * `mention-flow.ts` posts exactly ONCE, at the end of the turn — it never
 * streams intermediate blocks — so that announcement WAS the turn's final
 * answer. It got there through this branch:
 *
 * ```
 * if (res.stop_reason !== 'tool_use' || calls.length === 0) return finish(textOf(blocks), …)
 * ```
 *
 * Two ways in, and both were live:
 *
 *  1. **`stop_reason: 'end_turn'` with no `tool_use`** — the model narrated the
 *     step it was about to take and simply ended its turn. Haiku does this.
 *  2. **`stop_reason: 'max_tokens'` reached MID-`tool_use`** — the text block
 *     was emitted, the tool call was cut off, and because the stop reason is
 *     then not `'tool_use'` the guard short-circuits and returns the narration
 *     as though it were the answer.
 *
 * ⚠️ **Neither throws**, which is why the wobble fallback never fired: that
 * fallback only covers a `null` text, and this path returns a perfectly
 * well-formed string that happens not to be an answer. The earlier failure
 * (empty text → `null` → wobble) was the SAME bug with the truncation landing a
 * few tokens earlier.
 *
 * So: an answer that trails off mid-thought is not an answer, and must never be
 * delivered as one.
 */
export function needsFinishing(text: string, stopReason: string | null | undefined): boolean {
  // ⚠️ A truncated turn is unfinished BY DEFINITION, whatever it managed to say.
  if (stopReason === 'max_tokens') return true;
  const t = (text ?? '').trimEnd();
  if (t.length === 0) return false; // empty is a different failure, handled by the caller
  // ⚠️ Deliberately narrow: a trailing colon or semicolon is a promise of more.
  // Broader heuristics ("starts with Let me…") would eat legitimate answers that
  // merely open with a narration, which is a normal and fine way to answer.
  return /[:;]$/.test(t);
}

/**
 * What we say to a model that announced a step instead of taking it. ⚠️ It does
 * NOT name a tool: on the last permitted pass no tools are sent, and telling it
 * to call something it cannot see is how a loop ends narrating a second time.
 */
const FINISH_NUDGE =
  'You stopped mid-thought. If you still need to look something up, do it now; otherwise answer the ' +
  'question in full from what you already have. Do not describe what you are about to do — just give ' +
  'the answer, and say plainly if the documentation does not cover it.';

/** ⚠️ The last-resort sentence. If a turn is STILL unfinished after its final
 *  tools-free pass, the person gets a complete thought rather than a dangling
 *  colon — the failure is admitted rather than posted as an answer. */
export const CHAT_CUT_SHORT =
  '…sorry — I ran out of room mid-thought there. Ask me again and I will go straight to the answer.';

/** Text blocks only. ⚠️ Pushing a `tool_use` block back without its matching
 *  `tool_result` is a 400, so a dangling call is dropped rather than echoed. */
function textBlocksOnly(blocks: readonly unknown[]): unknown[] {
  return blocks.filter((b) => (b as { type?: unknown })?.type === 'text');
}

export interface ToolTurnResult {
  text: string | null;
  toolCalls: number;
  tools: string[];
  iterations: number;
  /** ⚠️ What the docs budget actually spent this turn. `sections > 0` is what
   *  makes this a DOCS turn for the daily fuse — a turn where she never reached
   *  for the corpus must not be charged one, or the fuse lies. */
  docsSections: number;
  docsBytes: number;
  docsUsed: boolean;
  /** ⚠️ What the BOOK budget actually spent this turn. `booksUsed` is what makes
   *  this a book turn for the fourth daily fuse — a turn where she never opened
   *  a book must not be charged one, or the fuse lies about what it protects. */
  booksPassages: number;
  booksBytes: number;
  booksUsed: boolean;
}

/** Text blocks plus a note when the loop ran out of iterations. */
function content(res: { content: readonly unknown[] }): unknown[] {
  return res.content as unknown[];
}

function toolUseBlocks(blocks: readonly unknown[]): { id: string; name: string; input: unknown }[] {
  const out: { id: string; name: string; input: unknown }[] = [];
  for (const b of blocks) {
    const block = b as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (block?.type === 'tool_use' && typeof block.id === 'string') {
      out.push({ id: block.id, name: String(block.name ?? ''), input: block.input });
    }
  }
  return out;
}

/**
 * One conversational turn that may call the Tier-0 tools.
 *
 * ⚠️ **A HAND-WRITTEN LOOP, DELIBERATELY, AND IT IS BOUNDED TWICE.** The SDK's
 * `tool_runner` helper is beta and takes its own dependency; this loop is
 * twenty lines and the two things that matter about it — that it terminates and
 * that every executed name went through the allowlist — are visible in one
 * screen. `MAX_TOOL_ITERATIONS` bounds the round trips and
 * `MAX_TOOL_CALLS_PER_TURN` bounds the parallel calls inside them, because a
 * cap on iterations alone is not a cap on work: one assistant turn may emit
 * several `tool_use` blocks at once.
 *
 * ⚠️ **Every `tool_result` for one assistant turn goes back in ONE user
 * message.** Splitting them across messages is a documented way to train the
 * model out of making parallel calls, and parallel calls are exactly what the
 * owner's four-part question needs.
 *
 * ⚠️ **A tool that failed comes back with `is_error: true`, never dropped.** A
 * missing `tool_result` for an emitted `tool_use` is a 400 that would eat the
 * person's answer; a silently-empty one teaches the model that an outage and an
 * absence are the same thing.
 *
 * Every model call in the loop is accounted separately, so the log line count
 * IS the round-trip count and a runaway is visible in `wrangler tail` rather
 * than only on an invoice.
 */
export async function converseWithTools(
  apiKey: string | undefined,
  question: string,
  grounding: string | null,
  who: { discordUserId: string; guildId: string | null; authorName: string; via?: string },
  toolCtx: ToolContext,
  overrides?: { fetch?: typeof fetch },
  history: readonly ConversationTurn[] = [],
): Promise<ToolTurnResult> {
  // ⚠️ The docs surface is decided ONCE, here, from whether the caller handed us
  // a docs context at all. `mention-flow.ts` builds that context only when the
  // `GABI_DOCS` posture is on AND a port is configured, so this file never has
  // to know about either — and the gated tools are never described to a model on
  // a turn that could not have used them.
  const docsOffered = Boolean(toolCtx.docs);
  const docsSpend = () => toolCtx.docs?.budget.spent() ?? { bytes: 0, sections: 0 };
  // ⚠️ The book surface is decided the same way and SEPARATELY. Two postures,
  // two ports, two owner decisions — a turn may legitimately have one and not
  // the other, and folding them into one flag would make either decision grant
  // the other silently.
  const booksOffered = Boolean(toolCtx.books);
  const booksSpend = () => toolCtx.books?.budget.spent() ?? { bytes: 0, passages: 0 };
  const finish = (text: string | null, toolCalls: number, tools: string[], iterationCount: number): ToolTurnResult => {
    const spent = docsSpend();
    const booksSpent = booksSpend();
    // ⚠️ THE LAST-RESORT NET. The nudge above gets one shot per remaining
    // iteration, and the final pass sends no tools so it normally produces
    // prose — but if a turn STILL ends on a dangling colon, the person gets a
    // complete thought rather than a promise nobody kept. This is the invariant
    // the 2026-08-18 silent partial violated: nothing that trails off
    // mid-sentence may ever be posted as an answer.
    const safe =
      text !== null && needsFinishing(text, null)
        ? `${text.trimEnd()}

${CHAT_CUT_SHORT}`
        : text;
    return {
      text: safe,
      toolCalls,
      tools,
      iterations: iterationCount,
      docsSections: spent.sections,
      docsBytes: spent.bytes,
      docsUsed: toolCtx.docs?.budget.used() ?? false,
      booksPassages: booksSpent.passages,
      booksBytes: booksSpent.bytes,
      booksUsed: toolCtx.books?.budget.used() ?? false,
    };
  };

  if (!apiKey) {
    logNoKey('the conversational reply');
    return finish(null, 0, [], 0);
  }

  const user = grounding
    ? `${question}\n\n(What a first look at the estate's public shelf turned up, for context — check it with a tool before stating anything as fact: ${grounding})`
    : question;
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = modelMessages(history, user);

  const client = chatClient(apiKey, overrides);
  const tools = toolsForApi({ docs: docsOffered, books: booksOffered });
  const executed: string[] = [];
  let iterations = 0;

  try {
    for (let i = 0; i <= MAX_TOOL_ITERATIONS; i++) {
      // ⚠️ The LAST permitted request drops `tools` entirely. Offering them on
      // a turn whose results could never be executed is how a loop ends with an
      // unanswered `tool_use` block and no text at all — the person gets
      // silence because the bot ran out of budget mid-thought.
      const last = i === MAX_TOOL_ITERATIONS;
      const res = await client.messages.create({
        model: GABI_CHAT_MODEL,
        max_tokens: CHAT_TOOL_MAX_TOKENS,
        // ⚠️ Each addendum rides ONLY the turn its tools are offered on, and the
        // two are independent: a book turn on a surface with docs switched off
        // describes books and not docs, and vice versa.
        system: [CHAT_TOOLS_SYSTEM, ...(docsOffered ? [CHAT_DOCS_SYSTEM] : []), ...(booksOffered ? [CHAT_BOOKS_SYSTEM] : [])].join('\n'),
        messages: messages as never,
        ...(last ? {} : { tools: tools as never }),
      });
      iterations += 1;
      accountTurn({
        purpose: 'converse_tools',
        usage: usageOf(res.usage),
        discordUserId: who.discordUserId,
        guildId: who.guildId,
        ...(who.via ? { via: who.via } : {}),
        ...historyCost(history),
        toolCalls: executed.length,
        tools: [...executed],
        toolIterations: iterations,
        ...(docsOffered ? { docsSections: docsSpend().sections, docsBytes: docsSpend().bytes } : {}),
        ...(booksOffered
          ? { booksPassages: booksSpend().passages, booksBytes: booksSpend().bytes }
          : {}),
      });

      const blocks = content(res);
      const calls = toolUseBlocks(blocks);
      if (res.stop_reason !== 'tool_use' || calls.length === 0) {
        const text = textOf(blocks);

        // ⚠️ THE FIX FOR THE SILENT PARTIAL. A turn that trails off mid-thought
        // is not an answer. Give it one more pass rather than posting the
        // narration — WITH tools still available while iterations remain, so it
        // can actually take the step it announced. The loop's own bound stops
        // this running away, and the final pass sends no tools at all, so the
        // model must produce prose there.
        if (!last && needsFinishing(text, res.stop_reason)) {
          console.error(
            `GABI mentions: the turn stopped mid-thought (stop_reason=${String(res.stop_reason)}, ` +
              `iterations=${iterations}, docs=${docsOffered}, books=${booksOffered}); nudging it to finish rather than ` +
              'posting the narration.',
          );
          const echoed = textBlocksOnly(blocks);
          messages.push({
            role: 'assistant',
            // ⚠️ A dangling tool_use is dropped (see textBlocksOnly), and an
            // assistant turn with no content at all is itself a 400 — so an
            // empty echo becomes a placeholder rather than nothing.
            content: echoed.length > 0 ? echoed : [{ type: 'text', text: '(cut off)' }],
          });
          messages.push({ role: 'user', content: FINISH_NUDGE });
          continue;
        }

        if (text.length === 0) {
          // ⚠️ THE SILENT PATH THAT LET THE 2026-08-18 FAILURE SHIP. A turn can
          // end with no text and no exception — most often `stop_reason:
          // 'max_tokens'` reached mid-`tool_use` — and the caller then falls
          // through to a fallback that may have nothing to do with the
          // question. It used to log NOTHING, so the reply was the only
          // evidence it had happened. Now it is one greppable line.
          console.error(
            `GABI mentions: the tool-using turn produced no text (stop_reason=${String(res.stop_reason)}, ` +
              `iterations=${iterations}, tool_calls=${executed.length}, docs=${docsOffered}, books=${booksOffered}). ` +
              'The caller will use its fallback.',
          );
        }
        return finish(text.length > 0 ? text : null, executed.length, executed, iterations);
      }

      // ⚠️ Truncated rather than refused: the calls beyond the cap come back as
      // worded errors so the model still gets a `tool_result` for every id it
      // emitted, which is what keeps the next request valid.
      const permitted = calls.slice(0, MAX_TOOL_CALLS_PER_TURN);
      const refused = calls.slice(MAX_TOOL_CALLS_PER_TURN);

      const outcomes = await Promise.all(
        permitted.map(async (call) => {
          const outcome = await runTool(call.name, call.input, toolCtx);
          executed.push(outcome.name);
          return { call, outcome };
        }),
      );

      messages.push({ role: 'assistant', content: blocks });
      messages.push({
        role: 'user',
        content: [
          ...outcomes.map(({ call, outcome }) => ({
            type: 'tool_result',
            tool_use_id: call.id,
            content: JSON.stringify(outcome.result),
            ...(outcome.isError ? { is_error: true } : {}),
          })),
          ...refused.map((call) => ({
            type: 'tool_result',
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({
              error: 'too_many_tool_calls',
              note: `Only ${MAX_TOOL_CALLS_PER_TURN} lookups run per turn. Answer with what came back and say what you did not get to.`,
            }),
          })),
        ],
      });
    }

    // Unreachable: the `last` iteration above sends no tools, so it always
    // returns. Kept as a named outcome rather than a fallthrough, because a
    // loop that can end without a value is a loop that will one day go silent.
    return finish(null, executed.length, executed, iterations);
  } catch (err) {
    console.error(
      'GABI mentions: the tool-using turn failed:',
      err instanceof Error ? err.message : err,
    );
    return finish(null, executed.length, executed, iterations);
  }
}
