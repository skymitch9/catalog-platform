/**
 * What happens between "somebody spoke to GABI" and "GABI replied" — for all
 * four ways that can now happen: an `@mention`, a `reply` to one of her
 * messages, a `DM`, and a **click on a component she attached to an earlier
 * answer**.
 *
 * Split out of `gateway.ts` on purpose: the Durable Object's job is holding a
 * WebSocket open and healthy, and that job is untestable without a socket. This
 * one is a function of its inputs with every side effect injected, so the
 * ladder — with a key and without, with a memory and without — is exercised by
 * `test/mentions.test.ts` rather than reasoned about.
 *
 * ## ⚠️ CONTINUITY, AND WHY THE STORE IS A DEPENDENCY RATHER THAN AN IMPORT
 *
 * The owner: *"I don't want to message GABI and then message her again and she
 * has no recollection."* The memory itself lives in the gateway Durable
 * Object's storage (`gateway.ts`), which is the only always-on thing on this
 * account — but this file must never know that. Two callers reach it from
 * completely different places:
 *
 *  - the **gateway**, holding the object's storage directly, and
 *  - the **HTTP interactions endpoint**, which reaches the same object over a
 *    stub `fetch` after somebody pressed a button.
 *
 * Injecting `ConversationDeps` is what lets one implementation of the answer
 * serve both, and it is what lets a test drive a whole ten-turn conversation
 * with an in-memory Map and no Durable Object at all.
 *
 * ## ⚠️ THE SUBREQUEST BUDGET, RECOUNTED WITH CONTINUITY
 *
 * A Worker invocation got **50 subrequests on Workers Free, and going over
 * TERMINATES the invocation rather than throwing** — the failure mode the
 * library's design calls out twice and this estate has been bitten by.
 * ⚠️ `docs/TODO.md` records the account moving to **Workers Paid 2026-08-17**,
 * which raises that to 10,000; this build did not measure it and did not spend
 * it. Bounded steps remain the design either way, because the number that
 * matters is "does this loop" and the answer must stay no.
 *
 * One turn spends **at most four**, unchanged by the memory:
 *
 *   1. the classifier (skipped entirely with no key),
 *   2. the public-shelf lookup (skipped for `smalltalk`),
 *   3. the conversational turn (skipped with no key, and for `have_lookup` /
 *      `fix_request`, which are worded from templates),
 *   4. the reply.
 *
 * ⚠️ **The conversation load and save are NOT subrequests on the gateway path**
 * — they are direct Durable Object storage reads inside the object that already
 * holds them. On the *component* path they are two stub fetches, and that path
 * makes no reply subrequest of its own (it edits the deferred interaction
 * response instead), so it lands in the same place. Nothing here loops, so
 * there is no path where either number grows.
 *
 * ## What it can do, and the shape of the proof
 *
 * Exactly `GABI_MENTION_ACTIONS` (`mentions.ts`) — eight entries now, four of
 * them added deliberately with continuity. ⚠️ **No write path to the estate
 * exists to be guarded**: there is no Firestore write, no catalogue call, no
 * moderation verb and no admin verb anywhere in this file, and a test pins the
 * allowlist so one cannot arrive quietly. The one thing this file persists is a
 * half-hour of chat text in the bot's own storage, and it deletes it.
 * A fix request is still answered the way `/gabi` answers one: say plainly that
 * she cannot change it from here, and hand over the deep link.
 */

import { lookupHave, renderHit, truncate, type SearchBookHit } from './have.js';
import { searchTermFor } from './gabi.js';
import { classifyIntent, converse } from './gabi-chat.js';
import {
  buildChoiceComponents,
  CONV_MSG,
  MAX_CHOICE_OPTIONS,
  newNonce,
  type ConversationTurn,
  type PendingChoice,
  type PendingOption,
} from './conversation.js';
import {
  capDecision,
  classifyByKeyword,
  MENTION_MSG,
  type CapVerdict,
  type MentionIntent,
  type MentionTrigger,
  type MentionVia,
} from './mentions.js';

/** Discord's own ceiling on a message body. Truncating here rather than
 * discovering it as a 400 that loses the whole answer. */
export const DISCORD_CONTENT_MAX = 2000;

/** Fewer than `/have`'s five: a chat reply that is mostly list is a reply
 * nobody reads. Overflow is COUNTED and stated, never dropped silently. */
export const MAX_MENTION_HITS = 3;

// ---------------------------------------------------------------------------
// The injected world
// ---------------------------------------------------------------------------

/** What she remembers, and where it is written back. ⚠️ `load()` must NEVER
 * write — it is called on every turn including the ones the cap refuses. */
export interface ConversationDeps {
  load(): Promise<{ turns: ConversationTurn[]; pending: PendingChoice | null }>;
  save(entry: {
    user: string;
    assistant: string;
    /** `null` CLEARS a pending clarifying question. Passing it explicitly on
     * every save is what stops a stale menu outliving the answer it belonged
     * to — an omitted field would have meant "leave it", which is the bug. */
    pending: PendingChoice | null;
    ref?: Record<string, string>;
  }): Promise<void>;
}

export interface MentionDeps {
  /** Rolling caps, read from wherever they live (the DO's storage, in production). */
  capCheck(userId: string): Promise<CapVerdict>;
  /** Called once, only when an answer was actually produced. */
  recordTurn(userId: string): Promise<void>;
  /** Post the reply. Returns nothing useful — a failed post is logged, not retried. */
  reply(content: string, extra?: { components?: unknown[] }): Promise<void>;
  /** ⚠️ REQUIRED, not optional. A memoryless surface is a real thing (a test,
   * a future one-shot lane) but it must be an explicit no-op that somebody
   * wrote down, never a dependency somebody forgot to pass. */
  conversation: ConversationDeps;
}

export interface MentionConfig {
  indexBaseUrl: string;
  panelUrl: string;
  anthropicKey?: string;
  /** Test seam: counts the model calls without spending. */
  fetchOverride?: typeof fetch;
}

// ---------------------------------------------------------------------------
// The shelf, and the clarifying question it sometimes produces
// ---------------------------------------------------------------------------

/** The nibble, worded. Shared by the lookup and fix paths so one wrong-term
 * rendering cannot drift between them. */
function shelfAnswer(
  term: string,
  books: SearchBookHit[] | null,
  failure: string | null,
  limit = MAX_MENTION_HITS,
): string {
  if (failure) return failure;
  const hits = books ?? [];
  if (hits.length === 0) return `${MENTION_MSG.searched(truncate(term, 80))}\n${MENTION_MSG.none}`;
  const shown = hits.slice(0, limit);
  return (
    `${MENTION_MSG.searched(truncate(term, 80))}\n` +
    shown.map(renderHit).join('\n') +
    (hits.length > shown.length ? MENTION_MSG.overflow(shown.length, hits.length) : '')
  );
}

/** One credential-free GET against the index's PUBLIC slice — `/have`'s own
 * lookup, reused rather than reimplemented, so the scope decision is inherited
 * rather than re-made here. */
async function shelf(
  indexBaseUrl: string,
  question: string,
): Promise<{ term: string; books: SearchBookHit[] | null; failure: string | null }> {
  const term = searchTermFor(question);
  const lookup = await lookupHave(indexBaseUrl, term);
  if (!lookup.ok) {
    return {
      term,
      books: null,
      failure:
        lookup.reason === 'unreachable'
          ? MENTION_MSG.unreachable
          : lookup.reason === 'too_short'
            ? null
            : MENTION_MSG.refused(lookup.status),
    };
  }
  return { term, books: Array.isArray(lookup.answer.books) ? lookup.answer.books : [], failure: null };
}

/** A menu row's label: the title and creator, which is what tells two editions
 * of the same book apart in a dropdown. */
export function choiceOptionFor(hit: SearchBookHit): PendingOption {
  const title = (hit.title ?? '').trim() || 'Untitled';
  const creator = (hit.creator ?? '').trim();
  return {
    label: creator ? `${title} — ${creator}` : title,
    detail: renderHit(hit),
  };
}

/**
 * ⚠️ **THE DETERMINISTIC USE OF COMPONENTS, and it is deliberately not a model
 * decision.** More than one book matched, so she genuinely does not know which
 * one was meant — that is a clarifying question with a *closed* answer set, and
 * a closed set is what a select menu is for. No model is consulted about
 * whether to offer it, which means this path is exercised end to end by tests
 * that supply no Anthropic key at all.
 *
 * A model-chosen component offer is a later phase and a bigger question (it
 * would need the model to emit a structured choice, which is a different call
 * shape from the one-short-string turn this surface uses).
 */
export function choiceFor(question: string, books: SearchBookHit[], now: number): PendingChoice | null {
  if (books.length < 2) return null;
  return {
    kind: 'book_pick',
    nonce: newNonce(),
    question: truncate(question, 200),
    options: books.slice(0, MAX_CHOICE_OPTIONS).map(choiceOptionFor),
    at: now,
  };
}

// ---------------------------------------------------------------------------
// The one answer engine, shared by every door
// ---------------------------------------------------------------------------

export interface AnsweredQuestion {
  content: string;
  pending: PendingChoice | null;
  intent: MentionIntent;
  components: unknown[] | null;
}

/**
 * Turn a question plus a remembered conversation into what she says next.
 *
 * Pure of the STORE — it reads history and returns what should be remembered,
 * but writes nothing. Every caller (mention, reply, DM, modal submit) goes
 * through here, so the ladder cannot drift between the doors.
 */
async function answerQuestion(
  question: string,
  history: readonly ConversationTurn[],
  who: { discordUserId: string; guildId: string | null; authorName: string; via: MentionVia | 'component' },
  cfg: MentionConfig,
  now: number,
): Promise<AnsweredQuestion> {
  const overrides = cfg.fetchOverride ? { fetch: cfg.fetchOverride } : undefined;

  const intent =
    (await classifyIntent(cfg.anthropicKey, question, who, overrides, history)) ??
    classifyByKeyword(question);

  if (intent === 'have_lookup') {
    const found = await shelf(cfg.indexBaseUrl, question);
    const books = found.books ?? [];
    const pending = found.failure ? null : choiceFor(question, books, now);
    if (pending) {
      const body =
        shelfAnswer(found.term, books, found.failure, MAX_CHOICE_OPTIONS) +
        CONV_MSG.chooseOne(pending.options.length, books.length);
      return { content: body, pending, intent, components: buildChoiceComponents(pending) };
    }
    return {
      content: shelfAnswer(found.term, books, found.failure),
      pending: null,
      intent,
      components: null,
    };
  }

  if (intent === 'fix_request') {
    // ⚠️ Propose-and-deep-link, `/gabi`'s shape (b) verbatim: she reads, she
    // says what she found, and the change happens where her authority is.
    // Phase B is where a write path could exist; this build has none.
    const found = await shelf(cfg.indexBaseUrl, question);
    return {
      content:
        `${MENTION_MSG.cannotChange}\n\n` +
        `${shelfAnswer(found.term, found.books, found.failure)}\n\n` +
        MENTION_MSG.panel(cfg.panelUrl),
      pending: null,
      intent,
      components: null,
    };
  }

  // question / smalltalk. A question may be about a book, so it is grounded
  // with a lookup; small talk is not — nobody saying "morning!" wants a
  // catalogue search, and skipping it saves a subrequest.
  let grounding: string | null = null;
  let fallbackBody = MENTION_MSG.noKeyFallback;
  if (intent === 'question') {
    const found = await shelf(cfg.indexBaseUrl, question);
    grounding = shelfAnswer(found.term, found.books, found.failure);
    fallbackBody = `${grounding}\n\n${MENTION_MSG.panel(cfg.panelUrl)}`;
  }

  const spoken = await converse(cfg.anthropicKey, question, grounding, who, overrides, history);

  // ⚠️ No key, or a turn that failed: she still says something useful. The
  // person asked a question; a silence would be the bot looking broken.
  return { content: spoken ?? fallbackBody, pending: null, intent, components: null };
}

// ---------------------------------------------------------------------------
// Door 1/2/3 — a message (mention, reply, or DM)
// ---------------------------------------------------------------------------

/**
 * Answer one message. Never throws: an unhandled rejection inside a Durable
 * Object's socket handler is a silent nothing, which is the worst possible
 * failure for a bot somebody just spoke to.
 */
export async function handleMention(
  deps: MentionDeps,
  trigger: Extract<MentionTrigger, { kind: 'ask' }>,
  cfg: MentionConfig,
  now: number = Date.now(),
): Promise<{ answered: boolean; intent: MentionIntent | 'capped' | 'error' }> {
  const who = {
    discordUserId: trigger.authorId,
    guildId: trigger.guildId,
    authorName: trigger.authorName,
    via: trigger.via,
  };

  try {
    // 1. The memory, before the fuse — so that even a CAPPED reply knows
    //    whether it is interrupting a conversation or starting one, and so the
    //    load is never skipped on a path that also decides how to greet.
    //    ⚠️ `load()` performs no write; a refused turn costs nothing.
    const memory = await deps.conversation.load();

    // ⚠️ Greet only at the START of a conversation, and never in a DM. Pinging
    // somebody by name on every turn of a chat she can now remember is how a
    // bot that gained a memory manages to sound like it lost one.
    const greeting =
      memory.turns.length === 0 && trigger.surface !== 'discord_dm'
        ? MENTION_MSG.greet(trigger.authorId)
        : '';
    const say = async (body: string, components?: unknown[] | null) => {
      await deps.reply(
        truncate(`${greeting} ${body}`.trim(), DISCORD_CONTENT_MAX),
        components ? { components } : undefined,
      );
    };

    // 2. The fuse, before anything that costs. ⚠️ A capped person is TOLD, in
    //    words, that it is a cap on GABI's side and not something they did.
    const verdict = await deps.capCheck(trigger.authorId);
    if (!verdict.ok) {
      await say(verdict.message);
      return { answered: true, intent: 'capped' };
    }

    const answer = await answerQuestion(trigger.question, memory.turns, who, cfg, now);
    await say(answer.content, answer.components);
    await deps.conversation.save({
      user: trigger.question,
      assistant: answer.content,
      pending: answer.pending,
      // ⚠️ SURFACE-SPECIFIC, and the store treats it as an opaque bag it never
      // reads (`conversation.ts`). It is here so a turn can be traced back to
      // the Discord message that produced it when somebody is debugging.
      ref: { message_id: trigger.messageId, ...(trigger.guildId ? { guild_id: trigger.guildId } : {}) },
    });
    await deps.recordTurn(trigger.authorId);
    return { answered: true, intent: answer.intent };
  } catch (err) {
    console.error('GABI mentions: handling failed:', err instanceof Error ? err.message : err);
    try {
      await deps.reply(MENTION_MSG.unreachable);
    } catch {
      // Discord is unreachable too. Nothing further is possible and no estate
      // state changed — there is nothing to roll back.
    }
    return { answered: false, intent: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Door 4 — a component she attached to an earlier answer
// ---------------------------------------------------------------------------

export type ResumeOutcome =
  | { kind: 'answered'; content: string; intent: MentionIntent | 'pick' }
  | { kind: 'stale'; content: string }
  | { kind: 'capped'; content: string }
  | { kind: 'error'; content: string };

export interface ResumeWho {
  discordUserId: string;
  guildId: string | null;
  authorName: string;
}

/**
 * Somebody chose one of the books she offered.
 *
 * ⚠️ **The nonce is checked against the conversation the PRESSER's own key
 * resolves to**, which is what makes an unsigned `custom_id` safe here: a
 * different person pressing the same menu resolves a different record, finds no
 * such pending question, and gets `stale`. Nothing was transmitted that needed
 * protecting, so nothing is MAC'd — unlike `moderation.ts`'s confirm id, which
 * authorises a deletion.
 */
export async function handlePick(
  deps: Omit<MentionDeps, 'reply'>,
  input: { nonce: string; choice: string },
  who: ResumeWho,
  cfg: MentionConfig,
  now: number = Date.now(),
): Promise<ResumeOutcome> {
  try {
    const memory = await deps.conversation.load();
    const pending = memory.pending;
    if (!pending || pending.nonce !== input.nonce) return { kind: 'stale', content: CONV_MSG.stale };

    const index = /^\d{1,2}$/.test(input.choice) ? Number(input.choice) : -1;
    const option = index >= 0 ? pending.options[index] : undefined;
    if (!option) return { kind: 'stale', content: CONV_MSG.stale };

    const verdict = await deps.capCheck(who.discordUserId);
    if (!verdict.ok) return { kind: 'capped', content: verdict.message };

    // Deterministic first: the chosen row, rendered, plus the deep link. That
    // is a complete, useful answer with NO model call, which is why this whole
    // path is exercised by tests that supply no key.
    const deterministic = `${CONV_MSG.picked(option.label)}\n${option.detail}\n\n${MENTION_MSG.panel(cfg.panelUrl)}`;

    // With a key she also says something about it, in persona, WITH the
    // conversation in front of her — the point of the whole layer.
    const spoken = await converse(
      cfg.anthropicKey,
      `They picked "${option.label}" from the list you offered. Say something useful about it and what they can do next.`,
      option.detail,
      { ...who, via: 'component' },
      cfg.fetchOverride ? { fetch: cfg.fetchOverride } : undefined,
      memory.turns,
    );

    const content = spoken ? `${CONV_MSG.picked(option.label)}\n${spoken}` : deterministic;
    await deps.conversation.save({
      user: `I meant ${option.label}`,
      assistant: content,
      pending: null,
    });
    await deps.recordTurn(who.discordUserId);
    return { kind: 'answered', content: truncate(content, DISCORD_CONTENT_MAX), intent: 'pick' };
  } catch (err) {
    console.error('GABI continuity: resolving a choice failed:', err instanceof Error ? err.message : err);
    return { kind: 'error', content: MENTION_MSG.unreachable };
  }
}

/**
 * Somebody typed free text into the modal instead of picking from the menu.
 *
 * ⚠️ It is treated as **an ordinary question in the same conversation**, not as
 * a special "correction" mode: the whole ladder runs, the memory is in front of
 * her, and the pending menu is cleared because it has been answered — by being
 * declined.
 */
export async function handleTypedQuestion(
  deps: Omit<MentionDeps, 'reply'>,
  input: { nonce: string; text: string },
  who: ResumeWho,
  cfg: MentionConfig,
  now: number = Date.now(),
): Promise<ResumeOutcome> {
  try {
    const question = input.text.trim();
    if (question.length === 0) return { kind: 'stale', content: CONV_MSG.stale };

    const memory = await deps.conversation.load();
    // ⚠️ The nonce still has to match. A modal can only be opened from one of
    // her buttons, so a submit whose nonce is unknown means the conversation
    // aged out while the box was open — and answering it would attach a reply
    // to a thread that no longer exists.
    if (!memory.pending || memory.pending.nonce !== input.nonce) {
      return { kind: 'stale', content: CONV_MSG.stale };
    }

    const verdict = await deps.capCheck(who.discordUserId);
    if (!verdict.ok) return { kind: 'capped', content: verdict.message };

    const answer = await answerQuestion(question, memory.turns, { ...who, via: 'component' }, cfg, now);
    await deps.conversation.save({
      user: question,
      assistant: answer.content,
      pending: answer.pending,
    });
    await deps.recordTurn(who.discordUserId);
    return {
      kind: 'answered',
      content: truncate(answer.content, DISCORD_CONTENT_MAX),
      intent: answer.intent,
    };
  } catch (err) {
    console.error('GABI continuity: a typed follow-up failed:', err instanceof Error ? err.message : err);
    return { kind: 'error', content: MENTION_MSG.unreachable };
  }
}

/** ⚠️ A memoryless store, written down ONCE so nobody re-invents it inline.
 * She answers exactly as she did before continuity existed: correctly, and
 * with no recollection. Used by surfaces that genuinely have nowhere to keep
 * state — never as a fallback for a store that failed, which would turn a
 * storage outage into a silent personality change. */
export const NO_MEMORY: ConversationDeps = {
  load: async () => ({ turns: [], pending: null }),
  save: async () => {},
};

export { capDecision };
