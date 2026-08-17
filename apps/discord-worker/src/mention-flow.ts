/**
 * What happens between "somebody @mentioned GABI" and "GABI replied".
 *
 * Split out of `gateway.ts` on purpose: the Durable Object's job is holding a
 * WebSocket open and healthy, and that job is untestable without a socket. This
 * one is a function of its inputs with every side effect injected, so the
 * ladder — with a key and without — is exercised by `test/mentions.test.ts`
 * rather than reasoned about.
 *
 * ## ⚠️ THE SUBREQUEST BUDGET, COUNTED
 *
 * A Worker invocation gets **50 subrequests, and going over TERMINATES the
 * invocation rather than throwing** — the failure mode the library's design
 * calls out twice and this estate has been bitten by. One mention spends **at
 * most four**:
 *
 *   1. the classifier (skipped entirely with no key),
 *   2. the public-shelf lookup (skipped for `smalltalk`),
 *   3. the conversational turn (skipped with no key, and for `have_lookup` /
 *      `fix_request`, which are worded from templates),
 *   4. the reply.
 *
 * The cheapest real path — no key, a `have_lookup` — is **two**. The most
 * expensive is four. Nothing here loops, so there is no path where that grows.
 *
 * ## What it can do, and the shape of the proof
 *
 * Exactly `GABI_MENTION_ACTIONS` (`mentions.ts`): look up the public shelf,
 * classify, converse, reply. ⚠️ **No write path exists to be guarded** — there
 * is no Firestore write, no catalogue call, no moderation verb and no admin
 * verb anywhere in this file, and a test pins the allowlist so one cannot
 * arrive quietly. A fix request is answered the way `/gabi` answers one: say
 * plainly that she cannot change it from here, and hand over the deep link.
 */

import { lookupHave, renderHit, truncate, type SearchBookHit } from './have.js';
import { searchTermFor } from './gabi.js';
import { classifyIntent, converse } from './gabi-chat.js';
import {
  capDecision,
  classifyByKeyword,
  MENTION_MSG,
  type CapVerdict,
  type MentionIntent,
  type MentionTrigger,
} from './mentions.js';

/** Discord's own ceiling on a message body. Truncating here rather than
 * discovering it as a 400 that loses the whole answer. */
export const DISCORD_CONTENT_MAX = 2000;

/** Fewer than `/have`'s five: a chat reply that is mostly list is a reply
 * nobody reads. Overflow is COUNTED and stated, never dropped silently. */
export const MAX_MENTION_HITS = 3;

export interface MentionDeps {
  /** Rolling caps, read from wherever they live (the DO's storage, in production). */
  capCheck(userId: string): Promise<CapVerdict>;
  /** Called once, only when an answer was actually produced. */
  recordTurn(userId: string): Promise<void>;
  /** Post the reply. Returns nothing useful — a failed post is logged, not retried. */
  reply(content: string): Promise<void>;
}

export interface MentionConfig {
  indexBaseUrl: string;
  panelUrl: string;
  anthropicKey?: string;
  /** Test seam: counts the model calls without spending. */
  fetchOverride?: typeof fetch;
}

/** The nibble, worded. Shared by the lookup and fix paths so one wrong-term
 * rendering cannot drift between them. */
function shelfAnswer(term: string, books: SearchBookHit[] | null, failure: string | null): string {
  if (failure) return failure;
  const hits = books ?? [];
  if (hits.length === 0) return `${MENTION_MSG.searched(truncate(term, 80))}\n${MENTION_MSG.none}`;
  const shown = hits.slice(0, MAX_MENTION_HITS);
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

/**
 * Answer one mention. Never throws: an unhandled rejection inside a Durable
 * Object's socket handler is a silent nothing, which is the worst possible
 * failure for a bot somebody just spoke to.
 */
export async function handleMention(
  deps: MentionDeps,
  trigger: Extract<MentionTrigger, { kind: 'ask' }>,
  cfg: MentionConfig,
): Promise<{ answered: boolean; intent: MentionIntent | 'capped' | 'error' }> {
  const who = { discordUserId: trigger.authorId, guildId: trigger.guildId };
  const greet = MENTION_MSG.greet(trigger.authorId);
  const say = async (body: string) => {
    await deps.reply(truncate(`${greet} ${body}`.trim(), DISCORD_CONTENT_MAX));
  };

  try {
    // 1. The fuse, before anything that costs. ⚠️ A capped person is TOLD, in
    //    words, that it is a cap on GABI's side and not something they did.
    const verdict = await deps.capCheck(trigger.authorId);
    if (!verdict.ok) {
      await say(verdict.message);
      return { answered: true, intent: 'capped' };
    }

    // 2. The ladder. With a key, one cheap classification turn; without one,
    //    the keyword router — and NEVER an error message in the channel.
    const intent =
      (await classifyIntent(cfg.anthropicKey, trigger.question, who, {
        ...(cfg.fetchOverride ? { fetch: cfg.fetchOverride } : {}),
      })) ?? classifyByKeyword(trigger.question);

    if (intent === 'have_lookup') {
      const found = await shelf(cfg.indexBaseUrl, trigger.question);
      await say(shelfAnswer(found.term, found.books, found.failure));
      await deps.recordTurn(trigger.authorId);
      return { answered: true, intent };
    }

    if (intent === 'fix_request') {
      // ⚠️ Propose-and-deep-link, `/gabi`'s shape (b) verbatim: she reads, she
      // says what she found, and the change happens where her authority is.
      // Phase B is where a write path could exist; this build has none.
      const found = await shelf(cfg.indexBaseUrl, trigger.question);
      await say(
        `${MENTION_MSG.cannotChange}\n\n` +
          `${shelfAnswer(found.term, found.books, found.failure)}\n\n` +
          MENTION_MSG.panel(cfg.panelUrl),
      );
      await deps.recordTurn(trigger.authorId);
      return { answered: true, intent };
    }

    // 3. question / smalltalk. A question may be about a book, so it is
    //    grounded with a lookup; small talk is not — nobody saying "morning!"
    //    wants a catalogue search, and skipping it saves a subrequest.
    let grounding: string | null = null;
    let fallbackBody = MENTION_MSG.noKeyFallback;
    if (intent === 'question') {
      const found = await shelf(cfg.indexBaseUrl, trigger.question);
      grounding = shelfAnswer(found.term, found.books, found.failure);
      fallbackBody = `${grounding}\n\n${MENTION_MSG.panel(cfg.panelUrl)}`;
    }

    const spoken = await converse(cfg.anthropicKey, trigger.question, grounding, {
      ...who,
      authorName: trigger.authorName,
    }, { ...(cfg.fetchOverride ? { fetch: cfg.fetchOverride } : {}) });

    // ⚠️ No key, or a turn that failed: she still says something useful. The
    // person asked a question; a silence would be the bot looking broken.
    await say(spoken ?? fallbackBody);
    await deps.recordTurn(trigger.authorId);
    return { answered: true, intent };
  } catch (err) {
    console.error('GABI mentions: handling failed:', err instanceof Error ? err.message : err);
    try {
      await say(MENTION_MSG.unreachable);
    } catch {
      // Discord is unreachable too. Nothing further is possible and no estate
      // state changed — there is nothing to roll back.
    }
    return { answered: false, intent: 'error' };
  }
}

export { capDecision };
