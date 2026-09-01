/**
 * THE T2 CONFIRM LANE — **the PROPOSE trigger.** Discord's half of turning a
 * natural-language *"fix the series on The Way of Kings to The Stormlight
 * Archive"* into a proposed change + a confirm card, DARK behind
 * `GABI_CONFIRM_T2`.
 *
 * Design of record: `docs/info/gabi-confirm-lanes-design.md` §4 (the parse
 * chooses a CANDIDATE subject and field, never the `before` and never the id)
 * and §4.3 (the subject is resolved to exactly ONE book BEFORE the confirm; more
 * than one is a job for the site, never a disambiguation nested inside a
 * confirm). The press half — `confirm-flow.ts` / `confirm-resume.ts` — already
 * exists and is untouched; this file only produces the proposal it presses.
 *
 * ## ⚠️ THE FOUR THINGS THE MODEL DOES NOT DECIDE
 *
 *  1. **The `before` value** — read from the destination's own dry-run
 *     (`proposeConfirm`), never parsed. §4.3.
 *  2. **The work id** — resolved from the library's own `browse-works` listing
 *     by matching the parsed TITLE locally, never emitted by the model. The id
 *     is what `fix-field` addresses; a model that guessed one could point the
 *     edit at the wrong book.
 *  3. **Which shelf** — routed by the asker's OWN `whoami` on each instance
 *     (`chooseInstances`), exactly as Tier 1 routes a write. GABI holds no
 *     permission; the destination decides.
 *  4. **Whether the field may change at all** — `confirmableFieldFromLabel`
 *     default-denies everything outside `T2_CONFIRMABLE_FIELDS`, so `title`,
 *     `author` and a narrator all fall through to the site rather than propose.
 *
 * ## ⚠️ THE PHASE-1 SHAPE, and what it deliberately DEFERS to the site
 *
 * This proposes only for the smallest thing that exercises the whole grammar
 * (design §10): **one book, one confirmable field, one instance the asker can
 * edit.** Every ambiguity returns `null` and the caller falls through to the
 * existing propose-and-deep-link answer — the panel opens loaded with what they
 * typed, which is exactly where design §4.3 sends anything that is not "exactly
 * one book on the table":
 *
 *  - the parse is not a single confirmable-field change → `null`;
 *  - the asker holds `editCatalog` on BOTH shelves, or neither → `null`
 *    (routing is not `one`); a nested "which shelf?" is a later phase;
 *  - the title matches zero or more than one held work → `null`. Never a
 *    disambiguation nested inside a confirm (§4.3).
 *
 * ## ⚠️ THE CREDENTIAL SEAM
 *
 * This is a credential module, like `delegated-exec.ts`: it names
 * `ESTATE_APP_TOKEN_DISCORD` (the MAC key material AND the delegated bearer) and
 * reads `ANTHROPIC_API_KEY_GABI`. `mention-flow.ts` reaches it ONLY through the
 * injected `ConfirmProposer` port and names none of them — `test/mentions.test.ts`
 * greps that file's source and fails the build if it ever does.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './env.js';
import {
  chooseInstances,
  libraryInstances,
  type BrowseWork,
  type DelegatePort,
  type LibraryInstance,
  type WhoAmI,
} from './delegated.js';
import { makeDelegate } from './delegated-exec.js';
import { proposeConfirm, type ConfirmIntent, type ConfirmMemory } from './confirm-flow.js';
import {
  confirmableFieldFromLabel,
  type ConfirmChangePending,
  type ConversationTurn,
  type T2ConfirmableField,
} from './conversation.js';
import { accountTurn, GABI_CHAT_MODEL, type TurnUsage } from './gabi-chat.js';
/** ⚠️ The Groq first-line rung (2026-09-01). This parse is TOOLLESS and
 *  JSON-shaped, so it is in scope — see `gabi-groq.ts`'s header table. */
import { groqLive, groqRung, viaGroq, type GroqRung, type ModelOverrides } from './gabi-groq.js';

/** The whole physical shelf is ~341 held works (measured live 2026-08-19), well
 *  under `browse-works`' 500 ceiling, so one call lists all of it and the title
 *  match runs locally. If a shelf ever outgrows the ceiling, this becomes a page
 *  loop or a real search verb — noted so the assumption is not silent. */
const BROWSE_LIMIT = 500;

/** A parse is one book, one field, one value — a few dozen output tokens at
 *  most. It never needs room to be expensive. */
const PARSE_MAX_TOKENS = 200;

// ---------------------------------------------------------------------------
// The parse — the model chooses a CANDIDATE subject + field + value, nothing else
// ---------------------------------------------------------------------------

/** What the parse extracted, once the field has been mapped to the destination's
 *  own name. ⚠️ No `before`, no id — those are read from the library (see the
 *  header). `after` is what the person literally typed, echoed verbatim. */
export interface ParsedFix {
  /** The book the person named, as text — resolved to an id downstream. */
  book: string;
  /** A member of `T2_CONFIRMABLE_FIELDS`, mapped from whatever word they used. */
  field: T2ConfirmableField;
  /** The new value, verbatim. */
  after: string;
}

const PARSE_SYSTEM = `You read ONE chat message asking to correct a book's details and pull out three things as JSON. Reply with ONLY the JSON object, no prose.

{"book": "<the book's title as they named it>", "field": "<one field>", "value": "<the new value, exactly as they gave it>"}

"field" must be ONE of: subtitle, series, volume, description, cover, illustrator.
- "volume" is the book's number within its series ("book 3", "volume 2.5").
- "cover" is the cover image URL.

⚠️ If the message is NOT a request to set ONE of those six fields to a specific new value — including any request to change the TITLE, the AUTHOR, the narrator, the genre, or anything you are unsure how to map — reply exactly {"field": "none"}. Do not guess a field, and do not invent a value they did not give.

You are only extracting what they said. You never decide whether it is correct.`;

interface ParseModelRaw {
  book?: unknown;
  field?: unknown;
  value?: unknown;
}

/** Pull the first JSON object out of a model reply, tolerating stray prose. */
function firstJsonObject(text: string): ParseModelRaw | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as ParseModelRaw;
  } catch {
    return null;
  }
}

function usageOf(u: unknown): TurnUsage {
  const raw = (u ?? {}) as Record<string, unknown>;
  const n = (k: string) => (typeof raw[k] === 'number' ? (raw[k] as number) : 0);
  return {
    inputTokens: n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens'),
    outputTokens: n('output_tokens'),
  };
}

function textOf(content: readonly unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    const b = block as { type?: unknown; text?: unknown };
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('').trim();
}

/**
 * One cheap classification-shaped turn that extracts a candidate fix, or `null`.
 *
 * ⚠️ Returns `null` on EVERY doubt — no key, a model error, a non-fix message, a
 * key-moving or unmapped field, an empty book or value. `null` is the ordinary
 * outcome and means "not a T2 propose; carry on to the panel-link answer". A
 * throw would cost somebody an answer over a parse.
 */
export async function parseFixRequest(
  apiKey: string | undefined,
  question: string,
  who: { discordUserId: string; guildId: string | null },
  overrides?: ModelOverrides,
  history: readonly ConversationTurn[] = [],
): Promise<ParsedFix | null> {
  // ⚠️ "No model at all", not "no Anthropic key" — with the Groq rung live this
  // parse can run without one. See `memory-distill.ts` for the same check.
  if (!apiKey && !groqLive(overrides?.groq)) return null;
  const recent = history.slice(-2);
  const preamble =
    recent.length > 0
      ? `A moment ago in this conversation:\n${recent
          .map((t) => `${t.role === 'user' ? 'Them' : 'You'}: ${t.text.slice(0, 300)}`)
          .join('\n')}\n\nTheir message now:\n`
      : '';
  const asked = `${preamble}${question}`;

  const viaHaiku = async (): Promise<ParseModelRaw | null> => {
    if (!apiKey) return null;
    try {
      const client = new Anthropic({
        apiKey,
        maxRetries: 0,
        timeout: 20_000,
        ...(overrides?.fetch ? { fetch: overrides.fetch } : {}),
      });
      const res = await client.messages.create({
        model: GABI_CHAT_MODEL,
        max_tokens: PARSE_MAX_TOKENS,
        system: PARSE_SYSTEM,
        messages: [{ role: 'user', content: asked }],
      });
      accountTurn({
        purpose: 'classify',
        usage: usageOf(res.usage),
        discordUserId: who.discordUserId,
        guildId: who.guildId,
      });
      return firstJsonObject(textOf(res.content));
    } catch (err) {
      console.error('GABI confirm: the fix parse failed:', err instanceof Error ? err.message : err);
      return null;
    }
  };

  /**
   * ⚠️ **THE SHARED VALIDATOR IS THE PARSE, NOT THE DECISION — and that cut is
   * load-bearing.** `firstJsonObject` asks "did the model produce a well-formed
   * object"; the field mapping below asks "does that object describe a change
   * we may propose". Only the FIRST is a transport failure. `{"field":"none"}`
   * is the model answering correctly about the overwhelming majority of
   * messages, and treating it as a Groq failure would spend a full Haiku turn on
   * every piece of small talk — the exact opposite of what this rung is for.
   */
  const raw = await viaGroq<ParseModelRaw>({
    ...(overrides?.groq ? { rung: overrides.groq } : { rung: undefined }),
    purpose: 'parse_fix',
    turn: () => ({
      system: PARSE_SYSTEM,
      messages: [{ role: 'user', content: asked }],
      maxTokens: PARSE_MAX_TOKENS,
      // ⚠️ Strict JSON out. `PARSE_SYSTEM` says "JSON" in words, which
      // `json_object` requires; `test/gabi-groq.test.ts` pins that it still does.
      json: true,
    }),
    validate: firstJsonObject,
    haiku: viaHaiku,
    ...(overrides?.fetch ? { fetchImpl: overrides.fetch } : {}),
    who,
    // A parsed field/value pair IS a decision, so agreement is meaningful — and
    // it is our own vocabulary (a field label), never the person's words.
    compare: (fromGroq, fromHaiku) =>
      confirmableFieldFromLabel(fromGroq.field) === confirmableFieldFromLabel(fromHaiku?.field),
    size: (r) => JSON.stringify(r).length,
  });

  if (!raw) return null;
  const field = confirmableFieldFromLabel(raw.field);
  if (!field) return null; // "none", a key-move, or an unmapped word — defer to the site.
  const book = typeof raw.book === 'string' ? raw.book.trim() : '';
  const after = typeof raw.value === 'string' ? raw.value.trim() : '';
  // ⚠️ An empty book cannot be resolved to a row and an empty value is not a
  // change anybody asked for — either way there is nothing safe to propose.
  if (!book || !after) return null;
  return { book, field, after };
}

// ---------------------------------------------------------------------------
// Subject resolution — title → exactly one held work, or defer (design §4.3)
// ---------------------------------------------------------------------------

/** Punctuation and case removed so "The Way of Kings" and "the way of kings!"
 *  compare equal. Articles are kept — dropping "the" would fold distinct books. */
function normaliseTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export type SubjectResolution =
  | { kind: 'one'; work: BrowseWork }
  /** Zero held works matched, or more than one — both defer to the site, because
   *  a confirm is offered ONLY when exactly one book is on the table (§4.3). */
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  /** The shelf could not be listed — an outage, worded by the caller as its own
   *  limit, never as a fact about what the house holds. */
  | { kind: 'unreachable' };

/**
 * Match the parsed title against the instance's held works.
 *
 * ⚠️ **Exact normalised title first, then a UNIQUE containment match** — and any
 * tie is `ambiguous`, never a guess. A title+author match has scored 1.0 on the
 * wrong book twice in this estate (design §4.3), so "which book" is allowed to
 * fail loudly and hand the job to the site rather than propose an edit to a
 * book the person never meant.
 */
export function matchWork(rows: readonly BrowseWork[], book: string): SubjectResolution {
  const q = normaliseTitle(book);
  if (!q) return { kind: 'none' };
  const exact = rows.filter((r) => normaliseTitle(r.title) === q);
  if (exact.length === 1) return { kind: 'one', work: exact[0]! };
  if (exact.length > 1) return { kind: 'ambiguous' };
  // No exact title — a unique containment either way (their words inside a
  // title, or a title inside their words) is confident enough; anything else is
  // deferred.
  const contains = rows.filter((r) => {
    const t = normaliseTitle(r.title);
    return t.includes(q) || q.includes(t);
  });
  if (contains.length === 1) return { kind: 'one', work: contains[0]! };
  if (contains.length > 1) return { kind: 'ambiguous' };
  return { kind: 'none' };
}

/** A human label for the resolved subject — title + author, never a bare id
 *  (design §5.1 element 1). */
function subjectLabel(work: BrowseWork): string {
  const title = (work.title ?? '').trim() || 'Untitled';
  const authors = (work.authors ?? '').trim();
  return authors ? `${title} by ${authors}` : title;
}

// ---------------------------------------------------------------------------
// The proposer port — injected into the flow, holds every credential
// ---------------------------------------------------------------------------

/** What a successful propose produces, in the shape `mention-flow.ts` already
 *  renders and saves: `content` + `components` ride the reply, `pending` is
 *  persisted as the per-person confirm slot for the press to load. ⚠️ `pending`
 *  is `null` when the outcome is a relayed refusal or a no-op — a message with
 *  no button and nothing stored. */
export interface ProposeOutcome {
  content: string;
  embeds?: unknown[];
  components?: unknown[];
  pending: ConfirmChangePending | null;
}

export interface ConfirmProposer {
  /**
   * Try to turn a fix-shaped message into a proposal + confirm card. Returns the
   * outcome to render, or `null` to fall through to the propose-and-deep-link
   * answer. ⚠️ Never throws — it is called from a socket handler where an
   * unhandled rejection is a silent nothing.
   */
  tryPropose(
    question: string,
    who: { discordUserId: string; guildId: string | null },
    history: readonly ConversationTurn[],
    currentPending: ConfirmChangePending | null,
  ): Promise<ProposeOutcome | null>;
}

/**
 * The injected world the orchestration needs. ⚠️ A PORT, not `env`, and that is
 * the credential seam AND the test seam: `makeConfirmProposer` builds these from
 * `env`, and `test/confirm-propose.test.ts` builds a fake port with no network,
 * exactly as `confirm.test.ts` drives `proposeConfirm`.
 */
export interface ProposerDeps {
  port: Pick<DelegatePort, 'linkedUid' | 'whoami' | 'browseWorks' | 'fixField'>;
  instances: readonly LibraryInstance[];
  /** The MAC key material — `ESTATE_APP_TOKEN_DISCORD` — passed opaque. */
  keyMaterial: string;
  /** The classifier key. Absent → nothing is parsed and every fix defers. */
  apiKey?: string;
  /** Test seam: a fake `fetch` for the parse model call ONLY (the port is
   *  stubbed directly). Never used in production. */
  fetchOverride?: typeof fetch;
  /** ⚠️ The Groq first-line rung, passed opaque exactly as `apiKey` is — this
   *  module names `GROQ_API_KEY_GABI` in ONE place, `makeConfirmProposer`, and
   *  the orchestration below never sees a secret's name. Absent → the parse is
   *  byte-for-byte the pre-Groq one. */
  groq?: GroqRung;
}

/**
 * The orchestration: parse → route → resolve → dry-run propose. Pure of `env`
 * and pure of the network (every side effect is on the injected `port`), so the
 * whole ladder is exercised by a test with a fake port and a fake model.
 *
 * ⚠️ Never throws — see `ConfirmProposer.tryPropose`.
 */
export async function tryProposeWith(
  deps: ProposerDeps,
  question: string,
  who: { discordUserId: string; guildId: string | null },
  history: readonly ConversationTurn[],
  currentPending: ConfirmChangePending | null,
  now: number = Date.now(),
): Promise<ProposeOutcome | null> {
  try {
    // 1. Parse first — cheapest way to bail on the overwhelming majority of
    //    fix-shaped messages that are not a single confirmable-field change,
    //    before any library call is made.
    const overrides: ModelOverrides | undefined =
      deps.fetchOverride || deps.groq
        ? {
            ...(deps.fetchOverride ? { fetch: deps.fetchOverride } : {}),
            ...(deps.groq ? { groq: deps.groq } : {}),
          }
        : undefined;
    const parsed = await parseFixRequest(deps.apiKey, question, who, overrides, history);
    if (!parsed) return null;

    // 2. Who is this? Never guessed from a Discord name.
    const link = await deps.port.linkedUid(who.discordUserId);
    if (!link.ok) return null; // unlinked or an outage → the panel-link answer.

    // 3. Which shelf may they edit? Both asked at once, and the confirm is
    //    offered ONLY when exactly one can (design §4.3). Two → the site;
    //    none → the site.
    const answers = await Promise.all(
      deps.instances.map(async (instance) => ({
        instance,
        who: await deps.port.whoami(instance, link.uid),
      })),
    );
    const routing = chooseInstances(
      answers as { instance: LibraryInstance; who: WhoAmI | null }[],
      'editCatalog',
    );
    if (routing.kind !== 'one') return null;
    const instance = routing.instance;

    // 4. Resolve the title to exactly one held work on that shelf.
    const page = await deps.port.browseWorks(instance, link.uid, { limit: BROWSE_LIMIT });
    if (!page) return null; // unreachable/refused → the panel-link answer.
    const match = matchWork(page.rows, parsed.book);
    if (match.kind !== 'one') return null;

    // 5. Propose: the dry-run reads `before` and is capability check #1, the
    //    proposal is stored (captured here for the caller to persist), and the
    //    confirm card is rendered. Everything past this is the EXISTING press
    //    path — `proposeConfirm` from `confirm-flow.ts`, unchanged.
    const intent: ConfirmIntent = {
      subject: { entity: 'work', id: match.work.id, label: subjectLabel(match.work) },
      instance,
      fields: [{ field: parsed.field, after: parsed.after }],
    };
    let captured: ConfirmChangePending | null = null;
    const memory: ConfirmMemory = {
      // ⚠️ Only a prior CONFIRM counts as "the change I offered a moment ago"
      // (design §2.1 cost 1); a book_pick being displaced is not.
      async loadPending() {
        return currentPending && currentPending.kind === 'confirm_change' ? currentPending : null;
      },
      async savePending(p) {
        captured = p;
      },
      async clearPending() {
        captured = null;
      },
    };
    const outcome = await proposeConfirm(
      intent,
      { discordUserId: who.discordUserId },
      { port: deps.port, memory, keyMaterial: deps.keyMaterial },
      now,
    );
    return {
      content: outcome.content,
      ...(outcome.embeds ? { embeds: outcome.embeds } : {}),
      ...(outcome.components ? { components: outcome.components } : {}),
      pending: captured,
    };
  } catch (err) {
    console.error('GABI confirm: tryPropose failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Build the proposer, or `null` when the estate has not finished the wiring.
 *
 * ⚠️ A `null` port is how "ships dark" is expressed at the composition root: with
 * no delegated bearer (so no dry-run is possible) or no service account (so no
 * identity), there is nothing to propose, and the flow's fix path is byte-for-
 * byte what it was before this file existed. The Anthropic key being absent is
 * NOT a reason to return null — the port still exists and simply parses nothing,
 * which is the same dull-GABI ladder the rest of the surface has.
 */
export function makeConfirmProposer(env: Env): ConfirmProposer | null {
  const delegate = makeDelegate(env);
  const token = env.ESTATE_APP_TOKEN_DISCORD;
  if (!delegate || !token) return null;
  const instances = libraryInstances(env);
  if (instances.length === 0) return null;
  const deps: ProposerDeps = {
    port: delegate,
    instances,
    keyMaterial: token,
    ...(env.ANTHROPIC_API_KEY_GABI ? { apiKey: env.ANTHROPIC_API_KEY_GABI } : {}),
    // ⚠️ THE GROQ RUNG, built here because this is a composition root. It ships
    // `{ mode: 'off' }` and is then a no-op by construction — `viaGroq` returns
    // the Haiku call's own result without building a prompt.
    groq: groqRung(env),
  };
  return {
    tryPropose: (question, who, history, currentPending) =>
      tryProposeWith(deps, question, who, history, currentPending),
  };
}
