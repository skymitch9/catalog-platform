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
import { panelLinkFor, type PanelLink } from './panel.js';
import { classifyIntent, converse, converseWithTools } from './gabi-chat.js';
import {
  CATALOG_MSG,
  DEFAULT_CATALOG_BASE,
  genreLeaf,
  loadCatalog,
  metadataAsk,
  renderRow,
  searchCatalog,
  yearOf,
  type CatalogRow,
  type MetadataAsk,
} from './catalog-data.js';
import type { ToolContext } from './tool-exec.js';
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
import { DELEGATE_MSG, delegatedIntent, type LibraryInstance } from './delegated.js';
import {
  DOCS_MSG,
  docsIntent,
  identityMessage,
  makeDocsBudget,
  type DocsCapVerdict,
  type DocsPort,
  type DocsToolContext,
} from './estate-docs.js';
import {
  BOOKS_MAX_REPLY_PARTS,
  BOOKS_MSG,
  booksIdentityMessage,
  booksFollowUp,
  booksIntent,
  boundFromQuestion,
  makeBooksBudget,
  type BooksCapVerdict,
  type BooksPort,
  type BooksToolContext,
} from './book-knowledge.js';
import {
  MEMORY_MSG,
  memoryCommand,
  personKey,
  profileForDisplay,
  profileIsEmpty,
  profilePromptBlock,
  type MemoryPort,
  type MemoryProfile,
} from './memory.js';
import {
  runDelegated,
  resumeDelegated,
  type DelegatedDeps,
  type DelegatedOutcome,
} from './delegated-flow.js';

/** Discord's own ceiling on a message body. Truncating here rather than
 * discovering it as a 400 that loses the whole answer. */
export const DISCORD_CONTENT_MAX = 2000;

/**
 * ⚠️ **DISCORD'S 2,000-CHARACTER CEILING, AND WHAT USED TO HAPPEN AT IT.**
 *
 * Every reply was `truncate(content, 2000)` — a hard cut at 1,999 characters
 * plus an ellipsis. For a book answer that is fine; for a RUNBOOK answer it is
 * not, because the half that gets cut is the half with the last three steps in
 * it, and nothing tells the reader that anything is missing beyond a single `…`.
 *
 * A docs answer legitimately runs long: it quotes commands, paths and tables.
 * So it is SPLIT rather than cut — on paragraph boundaries where possible, then
 * lines, and only as a last resort mid-text.
 *
 * ⚠️ Splitting needs a second channel to post into. Where the surface has none
 * (`followUp` absent — a test, or a lane whose only channel is one interaction
 * response) the first chunk is returned alone and the caller says so IN WORDS,
 * rather than silently dropping the rest.
 */
export function splitForDiscord(content: string, max = DISCORD_CONTENT_MAX): string[] {
  const text = content.trim();
  if (text.length <= max) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    // Prefer a paragraph break, then a line break, then a space — anything
    // rather than guillotining a command in half.
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf('\n\n');
    if (cut < max * 0.5) cut = window.lastIndexOf('\n');
    if (cut < max * 0.5) cut = window.lastIndexOf(' ');
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

/** ⚠️ Said when a long answer cannot be split because the surface has nowhere
 *  to put the rest. Never a bare `…`: the reader is told the answer was cut and
 *  where the whole thing lives. */
/** ⚠️ Room reserved for a `**(2/3)** ` prefix. Twelve characters covers up to
 *  a 99-part answer, and the parts bound is four. */
export const PART_LABEL_ROOM = 12;

export const CUT_FOR_LENGTH =
  '\n\n…that is as much as fits in one Discord message. The whole thing is at ' +
  'https://heygabi.ai/docs/ , or ask me for the part you need.';

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
  /**
   * ⚠️ **TIER 1 (2026-08-18): the write port, and it is OPTIONAL BY DESIGN.**
   *
   * Absent means this surface cannot write at all — which is the state of every
   * caller that has not been given one, and the state of production while the
   * app token is unset. It is an injected port rather than an import so that
   * THIS FILE holds no credential: the implementation
   * (`delegated-exec.ts`) is the only module that names a service account or an
   * app bearer, and `test/delegated.test.ts` reads these sources and fails the
   * build if that changes. See `delegated.ts`'s header for the property this
   * replaced and the owner decision that ended it.
   */
  delegated?: DelegatedDeps;
  /**
   * Post a SECOND, later message — the async report after a sweep. Absent means
   * the surface has no way to speak again (a test, or a lane where the only
   * channel is an interaction response), and the flow then simply does not
   * offer the slow verb's follow-up rather than silently dropping it.
   */
  followUp?(content: string): Promise<void>;
  /**
   * ⚠️ **TIER 0b (2026-08-18): the estate docs corpus, OPTIONAL BY DESIGN.**
   *
   * Absent means this surface cannot read the docs — the state of every caller
   * that has not been given one, and of production while `GABI_DOCS` is off or
   * the app token is unset. Like `delegated`, it is an injected port rather than
   * an import so THIS FILE holds no credential.
   *
   * ⚠️ Its `capCheck`/`record` pair is the THIRD fuse, kept deliberately apart
   * from `capCheck`/`recordTurn` (turns, rolling hour) and the delegated write
   * cap (writes, UTC day). A docs turn is ≈6k input tokens of retrieved runbook;
   * folding it into the turn cap would either make forty answers cost the docs
   * budget or make forty docs questions cheap, and both are wrong.
   */
  docs?: DocsDeps;
  /**
   * ⚠️ **TIER 0c (2026-08-18): the household's own book TEXT, OPTIONAL BY
   * DESIGN.**
   *
   * Absent means this surface cannot read a book's text — the state of every
   * caller that has not been given one, and of production while `GABI_BOOKS` is
   * off or the book app token is unset. Like `delegated` and `docs`, an injected
   * port rather than an import so THIS FILE holds no credential.
   *
   * ⚠️ Its `capCheck`/`record` pair is the FOURTH fuse, kept apart from the other
   * three on purpose. A turn is fractions of a cent; a write is a row in a
   * catalog; a docs turn is ~6k tokens of runbook; a book turn is ~6k tokens of
   * somebody's NOVEL. One shared counter would price all four wrongly, and the
   * cost this one protects is the one the owner's *"I don't want people scraping
   * my books"* is about.
   */
  books?: BooksDeps;
  /**
   * ⚠️ **TIER 2 (2026-08-18): the durable per-person profile, OPTIONAL BY
   * DESIGN.** Absent means she is exactly the bot she was before memory existed
   * — the 30-minute window still works and nothing is written or read. An
   * injected port for the fourth time, so THIS FILE holds no credential.
   *
   * ⚠️ It has NO fuse of its own, and that is deliberate rather than an
   * oversight: a profile read is one Firestore GET and the write happens once
   * per CONVERSATION on the cron, not per turn. There is nothing here for a
   * per-person daily counter to protect.
   */
  memory?: MemoryPort;
}

/** The docs port plus its own fuse. ⚠️ `record()` is called ONLY when a turn
 *  actually reached the corpus — charging a turn that never did would make the
 *  fuse lie about what it is protecting. */
export interface DocsDeps {
  port: DocsPort;
  capCheck(userId: string): Promise<DocsCapVerdict>;
  record(userId: string): Promise<void>;
}

/** The book port plus its own fuse. ⚠️ `record()` is called ONLY when a turn
 *  actually opened a book — most turns in a book channel are about narrators and
 *  running times, and charging those would burn a forty-a-day allowance on
 *  conversations that never touched the text. */
export interface BooksDeps {
  port: BooksPort;
  capCheck(userId: string): Promise<BooksCapVerdict>;
  record(userId: string): Promise<void>;
}

export interface MentionConfig {
  indexBaseUrl: string;
  /**
   * ⚠️ **THE STATIC FALLBACK, no longer the destination.** Until 2026-08-18
   * this was where every fixer link went, which is the bug the owner hit:
   * *"why is it showing padhard and not the generic site"*. It is now used
   * only when the asker cannot be placed — unlinked, or nothing resolved — and
   * `panel.ts` decides the rest from their own `whoami`. It doubles as a base
   * (`panelDeepLink` normalises the trailing slash) so the two cannot drift.
   */
  panelUrl: string;
  /** ⚠️ ADDED 2026-08-18 with the Tier-0 catalogue tools. The audiobook site
   * that publishes `catalog.csv` — the ONLY estate surface that records a
   * narrator, a running time or a genre (`catalog-data.ts` has the measurement
   * and the scope argument). Optional so an older caller cannot be broken by
   * the addition; it defaults to the live public host. */
  catalogBaseUrl?: string;
  anthropicKey?: string;
  /**
   * ⚠️ TIER 1. The catalogs a delegated verb may be routed to, and the
   * affirmative-only kill switch. Both default to "no writes": an empty
   * instance list or `delegatedWrites: false` behaves as the surface did before
   * Tier 1 existed, except that a detected ISBN is answered in words rather
   * than searched for on a shelf.
   */
  instances?: readonly LibraryInstance[];
  delegatedWrites?: boolean;
  /**
   * ⚠️ TIER 0b. The `GABI_DOCS` posture, affirmative-only and read at the
   * composition root. Defaults to FALSE here so a caller that predates the docs
   * feature — or forgets the flag — cannot accidentally offer a model the
   * estate's gated corpus. Both this AND `deps.docs` must be present before a
   * single docs tool is described to the model.
   */
  docsEnabled?: boolean;
  /**
   * ⚠️ TIER 0c. The `GABI_BOOKS` posture, affirmative-only and read at the
   * composition root. Defaults to FALSE here so a caller that predates the book
   * feature — or forgets the flag — cannot accidentally offer a model the
   * household's own book text. Both this AND `deps.books` must be present before
   * a single book tool is described to the model.
   */
  booksEnabled?: boolean;
  /**
   * ⚠️ TIER 2. The `GABI_MEMORY` posture, affirmative-only and read at the
   * composition root. Defaults to FALSE so a caller that predates memory — or
   * forgets the flag — cannot start writing notes about people.
   */
  memoryEnabled?: boolean;
  /** Test seam: counts the model calls without spending. */
  fetchOverride?: typeof fetch;
}

/**
 * ⚠️ **THE ASKER'S OWN PANEL, built once per turn** (2026-08-18, the owner's
 * *"why is it showing padhard and not the generic site"*).
 *
 * It reuses the Tier-1 identity port READ-ONLY — `whoami` mutates nothing and
 * needs no capability — and is therefore **not gated on `delegatedWrites`**:
 * switching writes off must not send everybody back to the pilot host. When
 * this surface has no port at all (a test, or a Worker whose Tier-1 wiring is
 * absent) the returned function is a pure string builder over `cfg.panelUrl`
 * and costs nothing.
 *
 * ⚠️ It is a FUNCTION rather than a resolved string because the resolution
 * costs three subrequests and most turns emit no link at all. Nothing is dialled
 * until a message is actually built, and `panelLinkFor` memoises the base so a
 * turn pays at most once.
 */
function panelFor(
  deps: Pick<MentionDeps, 'delegated'>,
  cfg: MentionConfig,
  discordUserId: string,
): PanelLink {
  return panelLinkFor(
    deps.delegated
      ? { port: deps.delegated.delegate, instances: cfg.instances ?? [], discordUserId }
      : null,
    cfg.panelUrl,
  );
}

/** The executor's world, built from the config in one place so the two callers
 * (gateway message, component press) cannot drift. */
function toolContext(
  cfg: MentionConfig,
  docs?: DocsToolContext,
  books?: BooksToolContext,
): ToolContext {
  return {
    catalogBaseUrl: cfg.catalogBaseUrl ?? DEFAULT_CATALOG_BASE,
    ...(cfg.fetchOverride ? { fetchOverride: cfg.fetchOverride } : {}),
    ...(docs ? { docs } : {}),
    ...(books ? { books } : {}),
  };
}

/**
 * ⚠️ **THE ONE PLACE THAT DECIDES WHETHER THIS TURN MAY TOUCH THE CORPUS, and
 * it needs THREE things to be true.**
 *
 * 1. the `GABI_DOCS` posture is on (an owner decision, never a deploy's side
 *    effect);
 * 2. this surface was actually given a port (so it ships dark on a Worker whose
 *    app token or service account is unset);
 * 3. …and only then is the daily fuse read.
 *
 * Returning `undefined` means the docs tools are not even DESCRIBED to the
 * model this turn — cheaper, and it stops her apologising for not doing
 * something nobody offered her.
 *
 * ⚠️ **A CAPPED PERSON STILL GETS THE TOOLS OFFERED, with `capped: true`.** The
 * executor then refuses in words and the model relays it. Withholding the tools
 * instead would leave a docs question answered from the model's general
 * knowledge — a confident, plausible, unsourced answer about how this estate
 * works, which is the single worst thing this feature could produce.
 *
 * ⚠️ The cap is read ONCE per turn rather than per tool call: it is one storage
 * read, and a fuse that re-read itself mid-loop could refuse the fourth call of
 * a turn it had already admitted.
 */
async function docsContextFor(
  deps: Pick<MentionDeps, 'docs'>,
  cfg: MentionConfig,
  discordUserId: string,
): Promise<DocsToolContext | undefined> {
  if (!cfg.docsEnabled || !deps.docs) return undefined;
  let capped = false;
  try {
    capped = !(await deps.docs.capCheck(discordUserId)).ok;
  } catch (err) {
    // ⚠️ A fuse that cannot be read is treated as BLOWN, not as open. The
    // failure mode of guessing "not capped" is an uncapped spend nobody sees;
    // the failure mode of guessing "capped" is one worded refusal.
    console.error('GABI docs: the daily fuse could not be read:', err instanceof Error ? err.message : err);
    capped = true;
  }
  return { port: deps.docs.port, discordUserId, budget: makeDocsBudget(), capped };
}

/**
 * Charge the daily docs fuse — **only if this turn actually reached the
 * corpus**.
 *
 * ⚠️ `budget.used()` is the discriminator, and it is the whole point. Most
 * turns in a book channel never touch the docs; charging them would burn a
 * forty-a-day allowance on conversations about narrators and make the fuse
 * describe something other than what it protects. Equally, a turn that DID pull
 * runbook text must be charged even if the model's final answer went another
 * way — the tokens were spent either way.
 *
 * ⚠️ Never throws. A fuse that could not be written must not cost somebody the
 * answer they already received; the miscount is logged and the turn stands.
 */
async function chargeDocsTurn(
  deps: Pick<MentionDeps, 'docs'>,
  discordUserId: string,
  docs: DocsToolContext | undefined,
): Promise<void> {
  if (!deps.docs || !docs?.budget.used()) return;
  try {
    await deps.docs.record(discordUserId);
  } catch (err) {
    console.error('GABI docs: the daily fuse could not be charged:', err instanceof Error ? err.message : err);
  }
}

/**
 * ⚠️ **THE ONE PLACE THAT DECIDES WHETHER THIS TURN MAY READ A BOOK'S TEXT, and
 * it needs THREE things to be true** — the same three `docsContextFor` needs,
 * checked against a different posture and a different port because they are
 * different owner decisions about different corpora.
 *
 * ⚠️ **It also derives THIS TURN'S SPOILER BOUND, from the question, here.** The
 * bound is threaded through the context rather than left to the tool arguments
 * for the reason design §4.3 measured: an `ord` is only meaningful relative to
 * the chunking that produced it, and a bound carried across a re-chunk leaked
 * twenty-eight chapters of book 2 past the reader's position **with no error
 * anywhere and nothing in the answer looking wrong**. Deriving it per turn, from
 * the question, is what makes that impossible rather than merely unlikely — and
 * it is deterministic rather than the model's decision, because a model asked to
 * choose its own spoiler scope chooses the generous one.
 *
 * ⚠️ **A CAPPED PERSON STILL GETS THE TOOLS OFFERED, with `capped: true`**, for
 * the reason the docs half gives: withholding them would leave a question about
 * a book's contents answered from the model's own memory of that book, which is
 * the single worst thing this feature could produce.
 */
async function booksContextFor(
  deps: Pick<MentionDeps, 'books'>,
  cfg: MentionConfig,
  discordUserId: string,
  question: string,
): Promise<BooksToolContext | undefined> {
  if (!cfg.booksEnabled || !deps.books) return undefined;
  let capped = false;
  try {
    capped = !(await deps.books.capCheck(discordUserId)).ok;
  } catch (err) {
    // ⚠️ A fuse that cannot be read is treated as BLOWN, not as open — the same
    // direction the docs fuse fails in, and for the same reason.
    console.error('GABI books: the daily fuse could not be read:', err instanceof Error ? err.message : err);
    capped = true;
  }
  return {
    port: deps.books.port,
    discordUserId,
    budget: makeBooksBudget(),
    capped,
    bound: boundFromQuestion(question),
  };
}

/**
 * Charge the fourth daily fuse — **only if this turn actually opened a book**.
 *
 * ⚠️ `budget.used()` is the discriminator. Most turns in a book channel never
 * touch a book's text; charging them would burn a forty-a-day allowance on
 * conversations about narrators and make the fuse describe something other than
 * what it protects. Equally, a turn that DID pull prose must be charged even if
 * the model's final answer went another way — the tokens were spent either way.
 *
 * ⚠️ Never throws. A fuse that could not be written must not cost somebody the
 * answer they already received.
 */
async function chargeBooksTurn(
  deps: Pick<MentionDeps, 'books'>,
  discordUserId: string,
  books: BooksToolContext | undefined,
): Promise<void> {
  if (!deps.books || !books?.budget.used()) return;
  try {
    await deps.books.record(discordUserId);
  } catch (err) {
    console.error('GABI books: the daily fuse could not be charged:', err instanceof Error ? err.message : err);
  }
}

/**
 * Load this person's durable profile, or nothing.
 *
 * ⚠️ **Keyed on the DISCORD id in phase 1, not the estate email.** The design
 * (§3.3) says the email is the key where a link exists — and resolving it costs
 * a second Firestore read on every single turn, for a join that only matters
 * once the site panel also writes profiles. So phase 1 keys on the snowflake,
 * the panel will key on the email, and the one-time merge is phase 4. ⚠️ The two
 * namespaces (`discord:` / `estate:`) cannot collide, which is what makes
 * deferring the merge safe rather than merely cheap.
 */
async function profileFor(
  deps: Pick<MentionDeps, 'memory'>,
  cfg: MentionConfig,
  discordUserId: string,
): Promise<MemoryProfile | null> {
  if (!cfg.memoryEnabled || !deps.memory) return null;
  const key = personKey({ discordUserId });
  if (!key) return null;
  try {
    return await deps.memory.load(key);
  } catch (err) {
    // ⚠️ A profile that cannot be read costs the turn NOTHING. Failing open here
    // means she is briefly a fresh bot; failing closed would mean no answer at
    // all, which is a far worse trade for a nicety.
    console.error('GABI memory: the profile could not be read:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** The rendered block, or `undefined` when there is nothing worth saying. */
function memoryBlockFrom(profile: MemoryProfile | null): string | undefined {
  return profileIsEmpty(profile) || !profile ? undefined : profilePromptBlock(profile);
}

/**
 * ⚠️ **SEEING AND CLEARING, ANSWERED DETERMINISTICALLY AND WITHOUT A MODEL.**
 *
 * A privacy control must not depend on a model correctly guessing that somebody
 * meant it. *"Forget what you know about me"* is answered by deleting, every
 * time, and the confirmation is only sent if the delete actually succeeded — a
 * cheerful "done!" over a failed delete is the worst possible lie here.
 */
async function memoryAnswer(
  action: 'show' | 'forget',
  deps: Pick<MentionDeps, 'memory'>,
  cfg: MentionConfig,
  discordUserId: string,
): Promise<AnsweredQuestion> {
  const done = (content: string): AnsweredQuestion => ({
    content,
    pending: null,
    intent: 'question',
    components: null,
  });
  if (!cfg.memoryEnabled || !deps.memory) return done(MEMORY_MSG.off);
  const key = personKey({ discordUserId });
  if (!key) return done(MEMORY_MSG.none);

  if (action === 'forget') {
    const ok = await deps.memory.clear(key);
    return done(ok ? MEMORY_MSG.cleared : MEMORY_MSG.trouble);
  }
  return done(profileForDisplay(await profileFor(deps, cfg, discordUserId)));
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
// The catalogue — narrator, duration, genre. The half the index does not hold.
// ---------------------------------------------------------------------------

/** The one field a metadata question actually asked about. Returns `''` when
 * the catalogue has the book but not that fact — which is a different answer
 * from "no such book" and is worded differently. */
function fieldValue(row: CatalogRow, field: MetadataAsk['field']): string {
  switch (field) {
    case 'narrator':
      return row.narrator;
    case 'duration':
      return row.duration;
    case 'series':
      return row.series;
    case 'genre':
      return genreLeaf(row.genre);
    case 'year':
      return yearOf(row.year);
  }
}

/**
 * ⚠️ **THE ZERO-TOKEN ANSWER TO THE OWNER'S CANONICAL QUESTION.**
 *
 * *"Who's the narrator of Way of Kings?"* is answered here, from the estate's
 * own catalogue, **with no model call at all** — so it is correct while
 * `ANTHROPIC_API_KEY_GABI` is set, and still correct the day somebody rotates
 * it and forgets to paste the new one. That is the same ladder `mentions.ts`
 * built for the keyword router, extended to the one question the feature exists
 * for.
 *
 * Returns `null` when the catalogue could not answer *at all* — unreachable, or
 * no matching title — because the caller has a second, wider place to look (the
 * index carries 1,246 rows to this shelf's 1,079, ebooks included) and falling
 * through to it beats reporting a miss this shelf alone cannot justify.
 */
async function catalogAnswer(cfg: MentionConfig, ask: MetadataAsk): Promise<string | null> {
  const load = await loadCatalog(
    cfg.catalogBaseUrl ?? DEFAULT_CATALOG_BASE,
    cfg.fetchOverride ? { fetch: cfg.fetchOverride } : undefined,
  );
  if (!load.ok) return null;

  const hits = searchCatalog(load.rows, ask.term, 'any', MAX_MENTION_HITS);
  const top = hits[0];
  if (!top) return null;

  const value = fieldValue(top, ask.field);
  // ⚠️ The book is here and the field is blank. SAID, not filled — this is the
  // sentence that makes "never invents a narrator" a property of the code
  // rather than a hope about the model.
  if (!value) return CATALOG_MSG.missingField(ask.field, top.title);

  const others =
    hits.length > 1
      ? `\n_${hits.length - 1} other ${hits.length === 2 ? 'title' : 'titles'} also matched **${truncate(ask.term, 60)}**._`
      : '';
  return `${renderRow(top)}${others}`;
}

// ---------------------------------------------------------------------------
// The one answer engine, shared by every door
// ---------------------------------------------------------------------------

export interface AnsweredQuestion {
  content: string;
  pending: PendingChoice | null;
  intent: MentionIntent;
  components: unknown[] | null;
  /**
   * ⚠️ **AUTO-CONTINUE, and the sentence that ends it** (owner decision
   * 2026-08-18, option C).
   *
   * Present only on lanes that may run to several messages without asking
   * permission first. Its presence is what switches `say()` from "truncate with
   * a pointer" to "keep going, up to a bound" — and its text is what she says
   * when that bound is reached. Absent on every other lane, which therefore
   * behaves exactly as it did before.
   */
  overflowNote?: string;
}

/**
 * ⚠️ **THE DOCS PRE-ROUTER — a runbook question is not a shelf query.**
 *
 * Runs at the very top of `answerQuestion`, ahead of the metadata fast path and
 * ahead of every intent branch, for the same reason the Tier-1 ISBN pre-router
 * sits ahead of them: falling through would search the book catalogue for
 * *"promote audiobook site"*, find nothing, and report that miss — a statement
 * about the catalogue in reply to a question that was never about it.
 *
 * ⚠️ **It answers deterministically in the three cases where a model must not
 * be consulted at all**, because each of them is a promise the design made in
 * words:
 *
 *  1. **The link predates the email field** → the relink sentence, always.
 *     Never a shelf search, never the propose-and-deep-link flow. This is the
 *     state the owner is in until he re-runs `/link`, so it is the FIRST thing
 *     this router had to get right.
 *  2. **Not linked / the estate is unreachable** → their own sentences, kept
 *     apart so an outage never reads as "you never linked".
 *  3. **Capped** → the cap sentence, without spending a model call to say it.
 *
 * Only past all three does it spend a turn — and it spends it with **no shelf
 * grounding at all**, which also saves the `/have` subrequest the old path
 * burned on every one of these questions.
 */
async function docsAnswer(
  question: string,
  history: readonly ConversationTurn[],
  who: { discordUserId: string; guildId: string | null; authorName: string; via: MentionVia | 'component' },
  cfg: MentionConfig,
  docs: DocsToolContext,
  overrides: { fetch?: typeof fetch } | undefined,
  /** ⚠️ Tier 2 rides EVERY lane. Who she is talking to is not a property of
   *  which router won. */
  memoryBlock?: string,
): Promise<AnsweredQuestion> {
  const done = (content: string): AnsweredQuestion => ({
    content,
    pending: null,
    intent: 'question',
    components: null,
  });

  // ⚠️ Cheapest first, and no I/O for a cap we already know about.
  if (docs.capped) return done(DOCS_MSG.capped);

  // ⚠️ Identity BEFORE the model. The relink case must be worded by us, from
  // the link document, rather than left to a model that might paraphrase it or
  // — worse — answer the question from its own knowledge instead.
  const asker = await docs.port.askerEmail(docs.discordUserId);
  if (!asker.ok) return done(identityMessage(asker.reason));

  const spoken = await converseWithTools(
    cfg.anthropicKey,
    question,
    // ⚠️ NO GROUNDING. The old path handed the model a public-shelf miss and
    // asked it to answer a runbook question around it; the grounding was not
    // just useless but actively misleading.
    null,
    who,
    toolContext(cfg, docs),
    overrides,
    history,
    memoryBlock,
  );

  // ⚠️ A docs question that goes wrong fails as a DOCS question. The sentence
  // this replaces was a catalogue miss plus an offer to change a book row.
  return done(spoken.text ?? DOCS_MSG.noAnswer);
}

/**
 * ⚠️ **THE BOOK PRE-ROUTER — "what happens in it" is not "what do we have".**
 *
 * Runs alongside the docs pre-router and for exactly the reason that one exists:
 * falling through would search the CATALOGUE for *"what's Jake's stat sheet at
 * the end of book 1"*, come back with a narrator and a running time, and report
 * that as an answer. The catalogue records nothing whatsoever about what happens
 * in a book, so a contents question answered from it is a wrong answer wearing a
 * correct-looking row.
 *
 * ⚠️ **It answers deterministically in the cases where a model must not be
 * consulted**, each of them a promise the design made in words: the link
 * predates the email field; not linked; the estate is unreachable; capped. Only
 * past all of those does it spend a turn — and with **no shelf grounding**,
 * which also saves the `/have` subrequest.
 */
async function booksAnswer(
  question: string,
  history: readonly ConversationTurn[],
  who: { discordUserId: string; guildId: string | null; authorName: string; via: MentionVia | 'component' },
  cfg: MentionConfig,
  books: BooksToolContext,
  overrides: { fetch?: typeof fetch } | undefined,
  memoryBlock?: string,
): Promise<AnsweredQuestion> {
  // ⚠️ Every book answer carries the overflow sentence, so a long one becomes
  // consecutive messages rather than a question about whether to continue. The
  // permission turn is retired here: measured, it did not pause the answer, it
  // gave the model a chance to re-print it (design §10e).
  const done = (content: string): AnsweredQuestion => ({
    content,
    pending: null,
    intent: 'question',
    components: null,
    overflowNote: BOOKS_MSG.moreToCome,
  });

  // ⚠️ Cheapest first, and no I/O for a cap we already know about.
  if (books.capped) return done(BOOKS_MSG.capped);

  // ⚠️ Identity BEFORE the model, so the relink case is worded by us from the
  // link document rather than left to a model that might answer the question
  // from its own memory of the book instead.
  const asker = await books.port.askerEmail(books.discordUserId);
  if (!asker.ok) return done(booksIdentityMessage(asker.reason));

  const spoken = await converseWithTools(
    cfg.anthropicKey,
    question,
    // ⚠️ NO GROUNDING. Handing the model a public-shelf miss and asking it to
    // answer a plot question around it is not merely useless but actively
    // misleading — it is the shape of the failure this router prevents.
    null,
    who,
    // ⚠️ BOOKS ONLY, mirroring `docsAnswer` exactly. Describing the docs corpus
    // on a turn routed as a plot question is input tokens spent describing a
    // capability the router has already decided is not what was asked for.
    toolContext(cfg, undefined, books),
    overrides,
    history,
    memoryBlock,
  );

  // ⚠️ A book question that goes wrong fails as a BOOK question, and the
  // sentence says the wobble was ours rather than implying the book lacks it.
  return done(spoken.text ?? BOOKS_MSG.noAnswer);
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
  /** ⚠️ Lazy and memoised — see `panelFor`. Every caller passes one; a surface
   * with no identity port passes one that resolves statically, so this function
   * has no branch for "asker-aware or not" and cannot grow one. */
  panel: PanelLink,
  docs?: DocsToolContext,
  books?: BooksToolContext,
  /** ⚠️ Tier 2. The rendered block, and the deps needed to SHOW or CLEAR it. */
  memory?: { block?: string; deps: Pick<MentionDeps, 'memory'>; discordUserId: string },
): Promise<AnsweredQuestion> {
  const overrides = cfg.fetchOverride ? { fetch: cfg.fetchOverride } : undefined;

  // ── ⚠️ THE MEMORY CONTROL, AHEAD OF EVERY OTHER ROUTER ────────────────────
  //
  // "Forget what you know about me" must never reach a shelf search, a docs
  // search or a book search — and it must never be a model's judgement call.
  // This is a privacy control, so it is deterministic and it goes first.
  const memoryAsk = memoryCommand(question);
  if (memoryAsk && memory) {
    return await memoryAnswer(memoryAsk, memory.deps, cfg, memory.discordUserId);
  }

  // ── ⚠️ THE DOCS PRE-ROUTER, AHEAD OF EVERY INTENT BRANCH ─────────────────
  //
  // Added 2026-08-18 after the live failure `estate-docs.ts`'s `docsIntent`
  // header records in full: the owner asked "how do I promote the audiobook
  // site?" and was told nothing on the book shelf matched. Offering the docs
  // tools was never the same as routing to them.
  //
  // ⚠️ The three states are deliberately distinct, and a surface that predates
  // the docs feature (`docsEnabled` undefined) falls through UNCHANGED rather
  // than being handed a sentence about a capability it never had.
  if (docsIntent(question)) {
    if (docs) return await docsAnswer(question, history, who, cfg, docs, overrides, memory?.block);
    if (cfg.docsEnabled === true) {
      // The posture is on but no port was built — the app token or the service
      // account is missing. A setup gap, and never phrased as a permissions one.
      return { content: DOCS_MSG.notConfigured, pending: null, intent: 'question', components: null };
    }
    if (cfg.docsEnabled === false) {
      // ⚠️ OFF IS NOT SILENT. The docs half of the design says so explicitly: a
      // docs question must not fall through to a shelf search that finds
      // nothing and reads as broken.
      return { content: DOCS_MSG.switchedOff, pending: null, intent: 'question', components: null };
    }
  }

  // ── ⚠️ THE BOOK PRE-ROUTER, ahead of every intent branch for the same reason ──
  //
  // A question about a book's CONTENTS must never fall through to a catalogue
  // lookup that returns a narrator and reads as an answer. The three states are
  // deliberately distinct, and a surface that predates the feature
  // (`booksEnabled` undefined) falls through UNCHANGED rather than being handed
  // a sentence about a capability it never had.
  //
  // ⚠️ It sits AFTER the docs router on purpose: `docsIntent` is the narrower
  // detector of the two, and an operational question that happens to name a book
  // is still an operational question.
  // ⚠️ `booksFollowUp` is the SECOND half of this router, added 2026-08-18 after
  // she invited a retry ("just say the word!"), the owner said the word, and the
  // stateless detector sent "dig fresh into jake sheet" to the catalogue. A
  // follow-up is elliptical by construction; judged alone it carries none of
  // what makes it a book question. `history` is the same remembered window in a
  // channel and in a DM.
  if (booksIntent(question) || booksFollowUp(question, history)) {
    if (books) return await booksAnswer(question, history, who, cfg, books, overrides, memory?.block);
    if (cfg.booksEnabled === true) {
      // The posture is on but no port was built — the book app token or the
      // service account is missing. A setup gap, never a permissions one.
      return { content: BOOKS_MSG.notConfigured, pending: null, intent: 'question', components: null };
    }
    if (cfg.booksEnabled === false) {
      // ⚠️ OFF IS NOT SILENT, and design §4.6 pins the sentence: she says her
      // reading is switched off and offers what the catalogue knows, rather than
      // answering a plot question with a narrator.
      return { content: BOOKS_MSG.switchedOff, pending: null, intent: 'question', components: null };
    }
  }

  const intent =
    (await classifyIntent(cfg.anthropicKey, question, who, overrides, history)) ??
    classifyByKeyword(question);

  // ── ⚠️ THE METADATA FAST PATH, BEFORE the intent branches ────────────────
  // "Who narrates X?" is classified `have_lookup` by one router and `question`
  // by the other — it is genuinely both — so it is answered here, once, rather
  // than half-answered twice. `fix_request` and `smalltalk` are excluded on
  // purpose: a fix must still be answered with "I can't change that from here",
  // and nobody saying "morning!" wants a catalogue row.
  const ask = intent === 'have_lookup' || intent === 'question' ? metadataAsk(question) : null;
  if (ask) {
    const facts = await catalogAnswer(cfg, ask);
    if (facts) {
      // With a key she says it in her own voice, WITH the tools in front of her
      // (so a follow-up inside the same turn — "and the sequel?" — is one more
      // lookup rather than an apology). Without one, the facts stand alone and
      // are already a correct, complete answer.
      const spoken = await converseWithTools(
        cfg.anthropicKey,
        question,
        facts,
        who,
        toolContext(cfg, docs, books),
        overrides,
        history,
        memory?.block,
      );
      return { content: spoken.text ?? facts, pending: null, intent, components: null };
    }
    // The catalogue could not answer — unreachable, or this shelf does not hold
    // it. Fall through to the index, which is wider. Reporting a miss from the
    // narrower source would be an answer the data does not support.
  }

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
    // ⚠️ THE SITE THE OWNER HIT. A fix-shaped ask is the one message whose
    // whole point is the link, so it is the one that must point at HIS shelf
    // and open loaded with what he typed.
    const found = await shelf(cfg.indexBaseUrl, question);
    return {
      content:
        `${MENTION_MSG.cannotChange}\n\n` +
        `${shelfAnswer(found.term, found.books, found.failure)}\n\n` +
        MENTION_MSG.panel(await panel(question)),
      pending: null,
      intent,
      components: null,
    };
  }

  // question / smalltalk. A question may be about a book, so it is grounded
  // with a lookup; small talk is not — nobody saying "morning!" wants a
  // catalogue search, and skipping it saves a subrequest.
  let grounding: string | null = null;
  if (intent === 'question') {
    const found = await shelf(cfg.indexBaseUrl, question);
    grounding = shelfAnswer(found.term, found.books, found.failure);
  }

  // ⚠️ SMALL TALK GETS NO TOOLS, and that is a spend decision rather than a
  // stylistic one: offering a shelf lookup to "thanks!" invites a lookup nobody
  // wanted, and the tool schemas are input tokens on every turn that carries
  // them. A real question gets the tools; a greeting gets the cheap call.
  const spoken =
    intent === 'question'
      ? (
          await converseWithTools(
            cfg.anthropicKey,
            question,
            grounding,
            who,
            toolContext(cfg, docs, books),
            overrides,
            history,
            memory?.block,
          )
        ).text
      : await converse(cfg.anthropicKey, question, grounding, who, overrides, history, memory?.block);

  // ⚠️ No key, or a turn that failed: she still says something useful. The
  // person asked a question; a silence would be the bot looking broken.
  //
  // ⚠️ **The fallback is built HERE, not above, and that is a spend decision.**
  // Resolving the asker's panel costs a link read and two `whoami` calls; a
  // question the model answers needs none of them. Building it eagerly would
  // have charged every conversational turn in the server for a string most of
  // them throw away.
  if (spoken) return { content: spoken, pending: null, intent, components: null };
  const fallbackBody =
    grounding === null
      ? MENTION_MSG.noKeyFallback
      : `${grounding}\n\n${MENTION_MSG.panel(await panel(question))}`;
  return { content: fallbackBody, pending: null, intent, components: null };
}

// ---------------------------------------------------------------------------
// Tier 1 — the delegated verbs, wired to this surface
// ---------------------------------------------------------------------------

/**
 * Run a delegated verb, or explain in words why she is not going to.
 *
 * ⚠️ **Three "no" states, and they are three different sentences** because they
 * have three different fixes: the switch is off (a lever on our side), the
 * wiring is incomplete (a setup step), or this surface simply has no write port
 * (a lane that never had one — a test, or a future read-only surface). None of
 * them is ever phrased as a permissions problem, and none of them falls through
 * to a shelf search for a barcode.
 *
 * ⚠️ The COMPONENTS are rendered here rather than in `delegated-flow.ts`,
 * deliberately: that file must know nothing about Discord's wire shapes, which
 * is what lets its whole ladder be tested with no renderer at all.
 */
async function delegatedAnswer(
  intent: NonNullable<ReturnType<typeof delegatedIntent>>,
  discordUserId: string,
  deps: MentionDeps,
  cfg: MentionConfig,
  now: number,
): Promise<DelegatedOutcome> {
  if (cfg.delegatedWrites === false) {
    return { content: DELEGATE_MSG.switchedOff, pending: null, components: null };
  }
  if (!deps.delegated) {
    return { content: DELEGATE_MSG.notConfigured, pending: null, components: null };
  }
  const instances = cfg.instances ?? [];
  if (instances.length === 0) {
    return { content: DELEGATE_MSG.notConfigured, pending: null, components: null };
  }

  const outcome = await runDelegated(intent, { discordUserId }, deps.delegated, instances, now);
  return outcome.pending
    ? { ...outcome, components: buildChoiceComponents(outcome.pending) }
    : outcome;
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

  // ⚠️ Whether anything has already reached the channel. It changes what a
  // failure is allowed to say — see the catch at the bottom of this function.
  let said = false;

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
    // ⚠️ POSTS THE WHOLE ANSWER, however long. A runbook answer that is cut at
    // 2,000 characters loses its last steps, and the old `truncate` said so with
    // a single `…`. Chunks after the first ride `followUp`; a surface without
    // one is told in words that the answer was cut rather than left to guess.
    const say = async (body: string, components?: unknown[] | null, overflow?: string) => {
      const whole = `${greeting} ${body}`.trim();
      said = true;
      let parts = splitForDiscord(whole);

      // ⚠️ **AUTO-CONTINUE, BOUNDED** (owner decision 2026-08-18, option C). An
      // `overflow` sentence means this lane may run across consecutive messages
      // without asking permission first — and MUST NOT run on for ever.
      // Unbounded auto-continue is a way to serially dump a book into a shared
      // channel, which is the posture `vis_ebooks` exists to hold. Past the
      // bound she says where the rest lives, in her own words.
      let overflowed = false;
      const bound = () => {
        if (overflow && parts.length > BOOKS_MAX_REPLY_PARTS) {
          parts = parts.slice(0, BOOKS_MAX_REPLY_PARTS);
          overflowed = true;
        }
      };
      bound();

      // ⚠️ Re-split with room reserved for the "(2/3)" label once we know there
      // will be more than one message. Labelling parts that were split at the
      // full ceiling is how a labelled part goes over it and 400s.
      if (parts.length > 1) {
        parts = splitForDiscord(whole, DISCORD_CONTENT_MAX - PART_LABEL_ROOM);
        bound();
      }

      if (parts.length > 1 && !deps.followUp) {
        // ⚠️ ROOM IS RESERVED FOR THE NOTICE FIRST. Appending it and then
        // truncating to the ceiling cuts off the very sentence that explains
        // the cut — which is how a "worded" truncation silently becomes a bare
        // ellipsis again.
        const notice = overflow ? `\n\n${overflow}` : CUT_FOR_LENGTH;
        const room = DISCORD_CONTENT_MAX - notice.length;
        await deps.reply(
          `${truncate(parts[0] as string, room)}${notice}`,
          components ? { components } : undefined,
        );
        return;
      }

      // ⚠️ ORDER IS GUARANTEED BY SERIAL AWAITS, and the label makes a gap
      // visible: if part 3 of 4 never lands, "(4/4)" arriving after "(2/4)"
      // says so. Discord does not promise ordering for concurrent sends, which
      // is why these are not fired in parallel however slow that is.
      const total = parts.length;
      const label = (i: number) => (total > 1 ? `**(${i + 1}/${total})** ` : '');
      const tail = overflowed && overflow ? `\n\n${overflow}` : '';

      await deps.reply(
        `${label(0)}${parts[0] as string}${total === 1 ? tail : ''}`,
        components ? { components } : undefined,
      );
      // ⚠️ Each continuation is its own try: a failed second message must never
      // discard the first, and must never look like the whole turn failed.
      for (let i = 1; i < parts.length; i++) {
        try {
          await deps.followUp?.(
            `${label(i)}${parts[i] as string}${i === parts.length - 1 ? tail : ''}`,
          );
        } catch (err) {
          console.error(
            'GABI mentions: a continuation message failed to post; the answer is incomplete in the ' +
              'channel:',
            err instanceof Error ? err.message : err,
          );
          break;
        }
      }
    };

    // 2. The fuse, before anything that costs. ⚠️ A capped person is TOLD, in
    //    words, that it is a cap on GABI's side and not something they did.
    const verdict = await deps.capCheck(trigger.authorId);
    if (!verdict.ok) {
      await say(verdict.message);
      return { answered: true, intent: 'capped' };
    }

    // ── ⚠️ 3. THE TIER-1 PRE-ROUTER, before the model and before the shelf ──
    //
    // A checksummed ISBN, or an unambiguous "fix my missing details". Neither
    // is a model decision (`delegated.ts` says why at length), and both are
    // deterministic enough to be answered without spending a token.
    //
    // ⚠️ It sits AFTER the turn cap and BEFORE `answerQuestion` for the same
    // reason the metadata fast path does: a DM'd barcode is not a shelf query,
    // and falling through would search the index for a thirteen-digit number
    // and report, correctly and uselessly, that nothing matches it.
    const doing = delegatedIntent(trigger.question);
    if (doing) {
      const outcome = await delegatedAnswer(doing, trigger.authorId, deps, cfg, now);
      await say(outcome.content, outcome.components);
      await deps.conversation.save({
        user: trigger.question,
        assistant: outcome.content,
        pending: outcome.pending,
        ref: { message_id: trigger.messageId, ...(trigger.guildId ? { guild_id: trigger.guildId } : {}) },
      });
      await deps.recordTurn(trigger.authorId);

      // ⚠️ AWAITED, not fired and forgotten. A promise nobody awaits inside a
      // Worker is a promise the runtime may cancel — the failure this estate
      // has already paid for twice. The person already has their "on it", so
      // the wait costs them nothing.
      if (outcome.followUp && deps.followUp) {
        const report = await outcome.followUp();
        await deps.followUp(truncate(report, DISCORD_CONTENT_MAX));
      }
      return { answered: true, intent: 'fix_request' };
    }

    // ⚠️ Built AFTER the turn cap and AFTER the Tier-1 pre-router: a capped
    // turn and a DM'd barcode both end before this line, so neither pays the
    // storage read that the docs fuse costs.
    // ⚠️ **IN PARALLEL, AND THAT IS A LATENCY DECISION.** These were serial
    // awaits; tier 2 would have added a third round trip (an OAuth mint and a
    // Firestore GET) to the front of every turn, on a surface where the owner
    // has already reported slowness. Nothing here depends on anything else here,
    // so the turn pays the slowest of the three rather than their sum.
    const [docs, books, profile] = await Promise.all([
      docsContextFor(deps, cfg, trigger.authorId),
      // ⚠️ The BOUND is derived from THIS question, here, and travels with the
      // context — never stored, never carried from an earlier turn (design §4.3).
      booksContextFor(deps, cfg, trigger.authorId, trigger.question),
      profileFor(deps, cfg, trigger.authorId),
    ]);

    const answer = await answerQuestion(
      trigger.question,
      memory.turns,
      who,
      cfg,
      now,
      panelFor(deps, cfg, trigger.authorId),
      docs,
      books,
      { ...(memoryBlockFrom(profile) ? { block: memoryBlockFrom(profile) } : {}), deps, discordUserId: trigger.authorId },
    );
    await say(answer.content, answer.components, answer.overflowNote);

    // ⚠️ EVERYTHING PAST THE POST IS BOOKKEEPING, AND BOOKKEEPING MUST NOT
    // SPEAK. Before this, a throw from `save`, `recordTurn` or the docs fuse
    // fell into the outer catch and posted "I couldn't reach the estate's
    // catalogue just then" — AFTER the answer had already been delivered. That
    // is a lie about a turn that worked, and it is the mirror image of the
    // 2026-08-18 silent partial: one says nothing when it should speak, this
    // one speaks when it should stay quiet. Both break the same rule — the
    // channel must reflect what actually happened.
    try {
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
      await chargeDocsTurn(deps, trigger.authorId, docs);
      await chargeBooksTurn(deps, trigger.authorId, books);
    } catch (err) {
      console.error(
        'GABI mentions: the answer was delivered but the bookkeeping failed (memory, turn cap or ' +
          'docs fuse). The person has their answer; a counter may be short:',
        err instanceof Error ? err.message : err,
      );
    }
    return { answered: true, intent: answer.intent };
  } catch (err) {
    console.error('GABI mentions: handling failed:', err instanceof Error ? err.message : err);
    try {
      // ⚠️ ALWAYS SOMETHING, AND NEVER NOTHING. If the failure happened AFTER a
      // message was posted, this lands as a SECOND message — which is the whole
      // point: the 2026-08-18 incident ended with a posted announcement and
      // eternal silence, and the rule that came out of it is that no turn may go
      // quiet after speaking. The wording differs so a reader can tell "I never
      // got started" from "I got cut off partway".
      await deps.reply(said ? MENTION_MSG.cutOff : MENTION_MSG.unreachable);
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
  | {
      kind: 'answered';
      content: string;
      intent: MentionIntent | 'pick' | 'delegated';
      /**
       * ⚠️ TIER 1. Present only when the press started something SLOW (the
       * details sweep). The caller must say `content` first, then await this
       * and say what it returns — the interactions endpoint does that by
       * editing the same deferred message twice, which is why this is a
       * closure rather than a second message id.
       */
      followUp?: () => Promise<string>;
    }
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

    // ── ⚠️ TIER 1: "your shelf or the main library?" being answered ──────────
    //
    // A different kind of press entirely: this one WRITES. It is handled before
    // the book-pick rendering below rather than beside it, so the two can never
    // be confused by a record whose `kind` was not read — the discriminant is
    // checked first and the book path is what remains.
    if (pending.kind === 'instance_pick') {
      if (!deps.delegated || (cfg.instances ?? []).length === 0) {
        return { kind: 'error', content: DELEGATE_MSG.notConfigured };
      }
      const done = await resumeDelegated(
        pending,
        option,
        { discordUserId: who.discordUserId },
        deps.delegated,
        cfg.instances ?? [],
      );
      await deps.conversation.save({
        user: `Do it on ${option.label}`,
        assistant: done.content,
        pending: null,
      });
      await deps.recordTurn(who.discordUserId);
      return {
        kind: 'answered',
        content: truncate(done.content, DISCORD_CONTENT_MAX),
        intent: 'delegated',
        ...(done.followUp ? { followUp: done.followUp } : {}),
      };
    }

    // With a key she says something about it, in persona, WITH the
    // conversation in front of her — the point of the whole layer.
    const spoken = await converse(
      cfg.anthropicKey,
      `They picked "${option.label}" from the list you offered. Say something useful about it and what they can do next.`,
      option.detail,
      { ...who, via: 'component' },
      cfg.fetchOverride ? { fetch: cfg.fetchOverride } : undefined,
      memory.turns,
    );

    // Without one, the chosen row plus the deep link — a complete, useful
    // answer with NO model call, which is why this whole path is exercised by
    // tests that supply no key.
    //
    // ⚠️ Built only when it is USED. Resolving the asker's panel costs a link
    // read and two `whoami` calls, and a press she answers in her own voice
    // needs none of them.
    //
    // ⚠️ The prefill is the ORIGINAL QUESTION, not the label they pressed. The
    // pending record kept it (`choiceFor` stores it), and it is what they
    // actually want in the box — "Mistborn" alone would open the panel with a
    // title and no ask.
    const content = spoken
      ? `${CONV_MSG.picked(option.label)}\n${spoken}`
      : `${CONV_MSG.picked(option.label)}\n${option.detail}\n\n` +
        MENTION_MSG.panel(
          await panelFor(deps, cfg, who.discordUserId)(pending.question || option.label),
        );
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

    // ⚠️ Parallel here too, for the same reason — and a typed follow-up reaches
    // the SAME ladder as a DM, so it derives its own bound from its own text.
    // Reusing the bound of the question that opened the box would let a spoiler
    // scope outlive the sentence that set it.
    const [docs, books, profile] = await Promise.all([
      docsContextFor(deps, cfg, who.discordUserId),
      booksContextFor(deps, cfg, who.discordUserId, question),
      profileFor(deps, cfg, who.discordUserId),
    ]);
    const answer = await answerQuestion(
      question,
      memory.turns,
      { ...who, via: 'component' },
      cfg,
      now,
      panelFor(deps, cfg, who.discordUserId),
      docs,
      books,
      { ...(memoryBlockFrom(profile) ? { block: memoryBlockFrom(profile) } : {}), deps, discordUserId: who.discordUserId },
    );
    await deps.conversation.save({
      user: question,
      assistant: answer.content,
      pending: answer.pending,
    });
    await deps.recordTurn(who.discordUserId);
    await chargeDocsTurn(deps, who.discordUserId, docs);
    await chargeBooksTurn(deps, who.discordUserId, books);
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
