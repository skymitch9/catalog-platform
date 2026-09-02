/**
 * **THE GROQ FIRST-LINE RUNG** — one cheap, fast attempt before GABI's pinned
 * Haiku, on the calls that carry no tools.
 *
 * Owner ask 2026-09-01, verbatim: *"we just used groq in a different project,
 * lets integrate that into our gabi model as a first line before going to haiku
 * tokens"* and *"use the information from the other project to help reduce
 * duplicate work"*. Design of record: `docs/info/gabi-groq-rung.md`.
 *
 * ## ⚠️ THE SCOPE RULE — THIS MODULE IS THE TOOLLESS HALF
 *
 * Anthropic's `tools` block and OpenAI's `tools` block are different schemas
 * with different result-echo grammars, and `converseWithTools` in
 * `gabi-chat.ts` is a hand-written loop built around the Anthropic one (a
 * `tool_use` block echoed back with a matching `tool_result`, `is_error`, the
 * dangling-call 400). ⚠️ **That translation now EXISTS, in its own file** —
 * `gabi-groq-tools.ts`, phase 2, 2026-09-02 — and it is deliberately not in
 * this one: this module's four call sites send `system` + `messages` and
 * nothing else, which is why they needed no translation at all, and mixing the
 * two would hide that difference. The gate that decides whether a tool loop may
 * ride Groq is `GROQ_READ_ONLY_TOOL_NAMES` in `gabi-tools.ts`, beside the tool
 * definitions, so a new tool defaults to NOT eligible.
 *
 * The four call sites this module serves:
 *
 * | call site | shape | validator |
 * |---|---|---|
 * | `classifyIntent` (`gabi-chat.ts`) | one bucket word | `isMentionIntent` |
 * | `converse` (`gabi-chat.ts`) | free prose | non-empty text |
 * | `distillConversation` (`memory-distill.ts`) | strict JSON | `parseProfile` |
 * | `parseFixRequest` (`confirm-propose.ts`) | strict JSON | `firstJsonObject` |
 *
 * ⚠️ **The validator is SHARED, not re-implemented.** One schema, two
 * transports: whatever the Anthropic path would have accepted is exactly what
 * the Groq path must produce, and a reply that fails it is a FAILURE (→ fall
 * through to Haiku), never a slightly-worse answer that ships. `viaGroq`'s
 * `validate` argument is the same function object the Haiku path runs.
 *
 * ## THE LADDER — three postures, and the fallback is invisible
 *
 * `GABI_GROQ` is a plain var, coerced fail-closed to `'off'` by `groqMode`:
 *
 * - **`off`** (ships this way) — byte-identical to the pre-Groq behaviour. No
 *   prompt is built, no request is made, and `viaGroq` returns the Haiku call's
 *   own result. Pinned by `test/gabi-groq.test.ts`.
 * - **`shadow`** — Groq is called *beside* Haiku and **Haiku's answer is the
 *   one used**. One comparison line per turn (latency, lengths, did-it-answer)
 *   is what the owner reads before flipping. This is the estate's shadow-first
 *   enforcement rule applied to a model swap.
 * - **`first`** — Groq is tried once; on ANY failure the existing Haiku call
 *   runs unchanged and the person cannot tell which answered.
 *
 * ⚠️ **ONE ATTEMPT, NEVER A RETRY LOOP.** The fallback IS the retry, and it
 * falls to a *different provider*, which is strictly better than asking the
 * same rate-limited endpoint twice. This mirrors `NO_RETRIES` on the Anthropic
 * client for the same reason: a retried turn is double spend on an answer that
 * may already have landed.
 *
 * ## WHAT CAME FROM `black_bot_baf` (the estate's other Groq integration)
 *
 * Carried over unchanged, because those decisions were already paid for:
 *
 * - the endpoint (`/openai/v1/chat/completions`) and the OpenAI body shape;
 * - the **model id**, `llama-3.3-70b-versatile` (see `GABI_GROQ_MODEL`);
 * - the **error taxonomy** — 429 is its own reason, 5xx is "unreachable", other
 *   non-200 is "refused", a transport error is wrapped at the boundary so one
 *   `catch` sees one type;
 * - ⚠️ **an answer with no words in it is a FAILURE, not a silent blank**
 *   (`test_an_answer_with_no_words_in_it_is_a_failure_not_a_silent_blank`);
 * - the model id lives as a **constant**, because — in that repo's own words —
 *   *"Groq retires model names faster than a deploy can follow."*
 *
 * Deliberately CHANGED, with the reason:
 *
 * - **The timeout is 4s here, not their 15s.** Theirs is a chat bot with a
 *   ladder that can afford to wait; this is a first line whose failure costs
 *   the person the Groq timeout **plus** the full 20s Haiku turn. Groq's entire
 *   value is sub-second completions, so 4s is already ~10× the expected
 *   latency, and a slow first line is worse than a costlier fast one.
 * - **No ledger row.** They write one `llm_ledger` row per call with a shared
 *   `turn` id so a fall-through is two rows and one turn; this Worker has no D1
 *   binding (see `accountTurn`'s note), so a Groq turn emits its own
 *   `gabi_groq` log line and ⚠️ **does NOT call `accountTurn`** — `gabi_turn`
 *   means *Anthropic spend* and must keep meaning that, or the billing
 *   inventory starts counting free tokens as Haiku ones.
 */

import type { Env } from './env.js';
import type { ModelMessage } from './conversation.js';

// ---------------------------------------------------------------------------
// The pins
// ---------------------------------------------------------------------------

/**
 * ⚠️ **PINNED, and pinned for the same reason `GABI_CHAT_MODEL` is** — a model
 * that changes under a fixed posture changes what the posture means, and the
 * comparison the owner reads in shadow mode is only worth reading if both
 * halves are named.
 *
 * `llama-3.3-70b-versatile` is `black_bot_baf`'s own choice
 * (`black_bloc/groq.py:21`), taken there as the SIMPLE tier — banter and small
 * talk — with the heavier work left on Haiku. That is the same cut this rung
 * makes, so the decision transfers rather than being re-argued. Their
 * `code-notes.md` records no reason it is wrong for chat; what it does record is
 * the gotcha this constant exists for:
 *
 * > *"Groq retires model names faster than a deploy can follow."*
 *
 * So a retirement shows up as a `refused` reason on the `gabi_groq` line and a
 * silent fall-through to Haiku — never as a broken bot — and the fix is one
 * constant plus a deploy. `/api/health` reports this id so the running pin is
 * checkable in one curl.
 *
 * ⚠️ AND THE GOTCHA FIRED ON DAY ONE — the comment above aged one evening.
 * `llama-3.3-70b-versatile` was DEPRECATED BY GROQ ON 2026-08-16 (their
 * deprecations page), two weeks before this rung inherited the pin — and it
 * was never caught earlier because black_bot_baf has never made a live Groq
 * call either (its own code-notes say so). Every first-day shadow line read
 * `refused` status 404 in ~20 ms. Repinned 2026-09-01 to `openai/gpt-oss-120b`,
 * one of Groq's two named replacements (the other, `qwen/qwen3.6-27b`, is
 * smaller/faster — chosen against because this prompt now carries a full
 * personality register and strict-JSON parses, where the bigger model is the
 * safer bet at Groq speeds). A pin inherited from a project that never ran it
 * is a decision, not a validation.
 */
export const GABI_GROQ_MODEL = 'openai/gpt-oss-120b';

/** The OpenAI-compatible endpoint. Same URL `black_bloc/groq.py:20` uses. */
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * ⚠️ **4 SECONDS, AND THE SHORTNESS IS THE POINT.** This is Discord: a person is
 * watching a typing indicator. On `first`, a Groq call that hangs costs them
 * this timeout *plus* the whole Haiku turn (`CHAT_TIMEOUT_MS`, 20s) — so the
 * budget for the first line has to be small enough that failing it is cheap.
 * Groq answers a 70B completion in well under a second; 4s is ~10× that and
 * still a fifth of the fallback's own ceiling.
 */
export const GROQ_TIMEOUT_MS = 4_000;

/**
 * ⚠️ **THE REASONING-MODEL FLOOR, now a named constant in ONE place.** It was
 * the literal `512` written twice — once in `groqComplete`, once in
 * `groqToolComplete` — which is two places for a pin whose whole value is that
 * both transports send the same one.
 *
 * Why a floor at all: `openai/gpt-oss-120b` is a REASONING model and `max_tokens`
 * bounds its thinking as well as its words. Measured 2026-09-01: `classify`,
 * handed its own 24-token cap, spent the entire budget thinking and returned an
 * empty 200 on every call — reason `empty`, an invisible fallback, and a Haiku
 * call per mention for ever.
 *
 * ⚠️ **RAISED 512 → 1024 on 2026-09-02, and the raise is a measurement, not a
 * guess.** The owner's live test produced a toolless `converse` that ALSO came
 * back empty-with-200 — past the old floor. 400 words of GABI's register is
 * ~500 output tokens on its own, so a 512 ceiling left a reasoning model nothing
 * to think with before it started writing. 1024 is the smallest number that
 * leaves the answer room at the measured output size. ⚠️ It is charged against
 * the tier's TPM (see §12): every token here is a token the request cannot spend
 * on context, which is why it is a floor and not simply a bigger number.
 */
export const GROQ_MIN_MAX_TOKENS = 1_024;

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

export const GROQ_MODES = ['off', 'shadow', 'first'] as const;
export type GroqMode = (typeof GROQ_MODES)[number];

/**
 * ⚠️ **FAIL CLOSED.** Anything that is not exactly `shadow` or `first` — absent,
 * empty, `"on"`, `"true"`, `"1"`, `"First"` with a capital, a typo, a value
 * somebody meant to set later — is `'off'`.
 *
 * This is the affirmative-only idiom every other posture on this Worker uses
 * (`mentionsOn`, `docsOn`, `booksOn`), widened from a boolean to a three-state
 * ladder, and it matches `normalise_pause_mode` in the audiobook repo: an
 * unrecognised mode is never guessed into the more permissive neighbour.
 * Case and surrounding whitespace are forgiven because those are typing, not
 * intent; nothing else is.
 */
export function groqMode(env: Pick<Env, 'GABI_GROQ'>): GroqMode {
  const raw = (env.GABI_GROQ ?? '').trim().toLowerCase();
  return (GROQ_MODES as readonly string[]).includes(raw) ? (raw as GroqMode) : 'off';
}

/**
 * The rung as the chat helpers receive it — a mode and a key, never `env`.
 * `gabi-chat.ts` and `confirm-propose.ts` are handed this by their composition
 * roots exactly as they are handed `anthropicKey`; neither names the secret.
 */
export interface GroqRung {
  mode: GroqMode;
  apiKey?: string;
}

/**
 * ⚠️ **Is there actually a first line?** Both halves are required: a posture
 * that is not `off` AND a key. This is the one predicate — `viaGroq` uses it and
 * so does `memory-distill.ts`, which has to answer "is there ANY model at all"
 * before it decides whether a missing Anthropic key is `no_key`. Two copies of
 * this test would drift the day a fourth mode appears.
 */
export function groqLive(rung: GroqRung | undefined): boolean {
  return Boolean(rung && rung.mode !== 'off' && rung.apiKey);
}

/** Build the rung from `env`. Called only at a composition root. */
export function groqRung(env: Pick<Env, 'GABI_GROQ' | 'GROQ_API_KEY_GABI'>): GroqRung {
  return {
    mode: groqMode(env),
    ...(env.GROQ_API_KEY_GABI ? { apiKey: env.GROQ_API_KEY_GABI } : {}),
  };
}

/**
 * ⚠️ **The bag every model helper already took, widened by ONE optional field.**
 *
 * `overrides` was `{ fetch?: typeof fetch }` — the test seam. Adding `groq` here
 * rather than a seventh positional parameter keeps every existing call site and
 * every existing test compiling untouched, and it is the same kind of thing:
 * what the caller injects into a function that otherwise knows nothing about
 * its world.
 */
export interface ModelOverrides {
  /** Test seam: a fake `fetch` for the model call. Never set in production. */
  fetch?: typeof fetch;
  /** The Groq first-line rung. Absent → the pre-Groq behaviour exactly. */
  groq?: GroqRung;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/**
 * Why a Groq attempt did not produce a usable answer. ⚠️ Every one of these is
 * a **fall-through to Haiku**, not an error anybody sees — the taxonomy exists
 * so the log line can say *which*, because "Groq is rate-limiting all evening"
 * and "the pinned model was retired" want completely different fixes and look
 * identical from a channel.
 *
 * `black_bot_baf`'s four reasons (`rate_limited` / `refused` / `unreachable` /
 * `broken`) with three splits this surface needs: `timeout` out of
 * `unreachable` (the one that costs the person real seconds), `empty` out of
 * `broken` (a 200 with no words — their
 * `test_an_answer_with_no_words_in_it_is_a_failure_not_a_silent_blank`), and
 * `invalid` for a well-formed reply that failed the SHARED validator.
 */
export type GroqReason =
  | 'timeout'
  | 'unreachable'
  | 'rate_limited'
  /**
   * ⚠️ **HTTP 413 — ITS OWN REASON SINCE 2026-09-02, and the split earns its
   * keep.** It read `refused` before, in the same bucket as a retired model id
   * and a bad key, and the owner's live test therefore produced a wall of
   * identical-looking `refused` lines with three different fixes behind them.
   * A 413 is not a refusal of the REQUEST's contents — it is *"this request is
   * bigger than your account is allowed to send"* (Groq's own wording: *"The
   * request body is too large"*), and the fix is smaller payloads or a higher
   * tier, never a code change to what was asked. See `§12` of the ledger.
   */
  | 'too_large'
  | 'refused'
  | 'server'
  | 'malformed'
  | 'empty'
  | 'invalid';

/** Groq's documented "request entity too large". */
export const GROQ_TOO_LARGE_STATUS = 413;

export class GroqFailure extends Error {
  readonly reason: GroqReason;
  readonly status: number | undefined;
  /**
   * ⚠️ **WHAT GROQ ACTUALLY SAID, and it is here because its absence cost a
   * diagnosis.** Measured 2026-09-02: the owner's first live test produced one
   * `converse` fallback reading `reason: "refused", status: 400` and NOTHING
   * else — a 400 names a fault in the request, the fault is written in the
   * response body, and the body was read by nobody and thrown away. Same for
   * every 413: the refusal sentence carries the LIMIT and the REQUESTED size,
   * which is the whole of §12's measurement, and it was being discarded at the
   * `res.status !== 200` line.
   *
   * Truncated to {@link GROQ_ERROR_TEXT_MAX}. ⚠️ It is Groq's ERROR ENVELOPE —
   * a sentence about the request's shape and the account's limits — never the
   * conversation, and the truncation bounds an envelope that turned out to be
   * unexpectedly chatty. Undefined when the body could not be read.
   */
  readonly errorText: string | undefined;
  constructor(reason: GroqReason, message: string, status?: number, errorText?: string) {
    super(message);
    this.name = 'GroqFailure';
    this.reason = reason;
    this.status = status;
    this.errorText = errorText;
  }
}

/**
 * ⚠️ How much of Groq's refusal is kept. 200 characters holds the whole of a
 * TPM refusal (*"Request too large … Limit 8000, Requested 12345"*) and a
 * validation 400's first clause, and stops a pathological body from becoming a
 * log line nobody can read.
 */
export const GROQ_ERROR_TEXT_MAX = 200;

/**
 * The refusal body, read defensively. ⚠️ **This can never throw and can never
 * hang the caller**: a first line whose *error handling* costs somebody an
 * answer is worse than the missing diagnosis it was added to fix. A body that
 * is already consumed, is not text, or is not there at all comes back
 * `undefined`, and the log line simply carries no `error_text`.
 */
export async function refusalText(res: Response): Promise<string | undefined> {
  try {
    const body = await res.text();
    const flat = body.replace(/\s+/g, ' ').trim();
    if (flat.length === 0) return undefined;
    return flat.length <= GROQ_ERROR_TEXT_MAX ? flat : `${flat.slice(0, GROQ_ERROR_TEXT_MAX - 1)}…`;
  } catch {
    return undefined;
  }
}

/**
 * ⚠️ **ONE non-200 taxonomy, shared by both clients.** The toolless client and
 * the tool client had a byte-identical copy of this ladder each, and the error
 * body had to be added to it — which is exactly the moment two copies become
 * one copy and one stale copy. `null` means the response is fine and the caller
 * should carry on reading it.
 *
 * ⚠️ **The body is read ONLY on the failure path**, because reading it consumes
 * the stream: a success must reach `res.json()` with its body intact.
 */
export async function failureFor(res: Response): Promise<GroqFailure | null> {
  if (res.status === 429) {
    return new GroqFailure('rate_limited', 'groq is rate limiting', 429, await refusalText(res));
  }
  if (res.status === GROQ_TOO_LARGE_STATUS) {
    return new GroqFailure(
      'too_large',
      `groq refused the request as too large (${res.status})`,
      res.status,
      await refusalText(res),
    );
  }
  if (res.status >= 500) {
    return new GroqFailure('server', `groq answered ${res.status}`, res.status, await refusalText(res));
  }
  if (res.status !== 200) {
    return new GroqFailure('refused', `groq answered ${res.status}`, res.status, await refusalText(res));
  }
  return null;
}

export interface GroqTurn {
  /** The SAME system prompt the Anthropic path sends, moved to a leading
   *  `system` message — that is the whole of the translation. */
  system: string;
  /** Already `{role, content: string}` on every toolless call site, which is
   *  both the Anthropic shape and the OpenAI shape. No conversion is needed and
   *  none is done: a conversion is a place for a bug. */
  messages: readonly ModelMessage[];
  maxTokens: number;
  /**
   * ⚠️ Ask for `response_format: json_object` on the two call sites whose
   * validator is a JSON parse. It is not a substitute for the validator — the
   * validator still runs and still decides — it just stops the commonest
   * avoidable failure (a fenced or prefaced object) from spending a fallback.
   */
  json?: boolean;
}

export interface GroqAnswer {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

function messageText(payload: unknown): string {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  if (!Array.isArray(choices)) return '';
  for (const choice of choices) {
    const said = (choice as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof said === 'string' && said.trim().length > 0) return said.trim();
  }
  return '';
}

function tokenCount(usage: unknown, key: string): number {
  const raw = (usage ?? {}) as Record<string, unknown>;
  return typeof raw[key] === 'number' ? (raw[key] as number) : 0;
}

/**
 * One Groq completion, or a `GroqFailure` naming why not.
 *
 * ⚠️ **Every transport error is wrapped at this boundary**, exactly as
 * `black_bloc/groq.py:53` wraps its own, so one `catch` in `viaGroq` sees one
 * type from a DNS failure, an abort and a malformed body alike.
 */
export async function groqComplete(
  apiKey: string,
  turn: GroqTurn,
  fetchImpl: typeof fetch = fetch,
): Promise<GroqAnswer> {
  // ⚠️ `json_object` REQUIRES the word "JSON" somewhere in the prompt (the
  // OpenAI contract Groq implements); asking for it without that is a 400 that
  // would fall through to Haiku on every single turn, for ever, while looking
  // like an outage. Both JSON call sites' prompts do say it, and
  // `test/gabi-groq.test.ts` pins that they still do — this guard is the
  // belt to that braces, so a future prompt edit degrades to plain mode
  // instead of silently disabling the rung.
  const jsonSafe = turn.json === true && /json/i.test(turn.system);
  const body = {
    model: GABI_GROQ_MODEL,
    // ⚠️ REASONING-MODEL FLOOR — measured live 2026-09-01 ~18:10, the first
    // successful Groq turn in this estate: `converse` answered on Groq (566 ms,
    // 98 output tokens) while `classify` fell back with an EMPTY 200 on every
    // call. `openai/gpt-oss-120b` is a reasoning model: handed a
    // classification-sized cap (a few dozen tokens) it spends the whole budget
    // thinking and returns empty content — reason "empty", invisible fallback,
    // a Haiku call per mention for ever. So the Groq ATTEMPT floors max_tokens
    // at 512 (Groq is cheap; the shared validator still enforces the tiny
    // shape) and pins reasoning effort low — this constant is gpt-oss-specific
    // and gets re-argued if the model pin ever changes family.
    max_tokens: Math.max(turn.maxTokens, GROQ_MIN_MAX_TOKENS),
    reasoning_effort: 'low',
    messages: [{ role: 'system', content: turn.system }, ...turn.messages],
    ...(jsonSafe ? { response_format: { type: 'json_object' } } : {}),
  };

  let res: Response;
  try {
    res = await fetchImpl(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        // ⚠️ The key rides the Authorization header and nowhere else — never a
        // query string, never the body. Same assertion `black_bot_baf`'s
        // `test_the_key_rides_the_authorization_header_and_nothing_else` makes.
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch (err) {
    const name = (err as { name?: unknown })?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new GroqFailure('timeout', `groq did not answer within ${GROQ_TIMEOUT_MS}ms`);
    }
    throw new GroqFailure('unreachable', `groq unreachable: ${String(name ?? 'error')}`);
  }

  const refused = await failureFor(res);
  if (refused) throw refused;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new GroqFailure('malformed', 'groq answered 200 with a body that is not JSON', 200);
  }

  const text = messageText(payload);
  // ⚠️ A 200 with no words in it is a FAILURE, never a silent blank. Returning
  // '' here would make an empty Groq reply indistinguishable from a person
  // whose question genuinely had no answer.
  if (text.length === 0) throw new GroqFailure('empty', 'groq answered with no words in it', 200);

  const usage = (payload as { usage?: unknown } | null)?.usage;
  return {
    text,
    inputTokens: tokenCount(usage, 'prompt_tokens'),
    outputTokens: tokenCount(usage, 'completion_tokens'),
  };
}

// ---------------------------------------------------------------------------
// The log lines
// ---------------------------------------------------------------------------

export interface GroqWho {
  discordUserId?: string;
  guildId?: string | null;
}

/**
 * ⚠️ **ONE structured line per Groq attempt, and never the TEXTS.** These are
 * household conversations; the line carries how LONG, how BIG and whether it
 * ANSWERED, which is everything a decision to flip needs and nothing a person
 * would mind being in a log stream. Same rule `accountTurn` follows for the
 * remembered text and the docs/book payloads.
 *
 * JSON on one line so `wrangler tail estate-discord | jq 'select(.evt ==
 * "gabi_groq")'` aggregates it.
 */
export function logGroq(entry: {
  mode: GroqMode;
  purpose: string;
  /**
   * `groq` — Groq's answer was used. `fallback` — Haiku answered instead.
   * ⚠️ `ineligible` — **phase 2 (2026-09-02)** — a TOOL LOOP that a live rung was
   * not allowed to try at all: either its tool array carries a name that is not
   * on `GROQ_READ_ONLY_TOOL_NAMES`, or the posture is `shadow` and a tool loop is
   * never shadowed (shadowing would execute every tool twice, and some tools have
   * side effects). It is logged ONCE PER TURN rather than per pass, and only when
   * a rung is actually live — with the posture `off` there is nothing to explain.
   */
  outcome: 'groq' | 'fallback' | 'ineligible';
  reason?: GroqReason;
  status?: number | undefined;
  /**
   * ⚠️ **WHAT GROQ SAID, TRUNCATED — and this field is the third time the
   * field-by-field lesson has been paid for.** The owner's live test on
   * 2026-09-02 produced a `refused` status 400 with no way to know what was
   * wrong with the request, and a wall of `refused` 413s whose bodies carried
   * the exact limit and the exact requested size. ⚠️ Added to BOTH this param
   * type AND the emitted object below — a `status` fix shipped as a no-op on
   * 2026-09-01 by being added to only one of them, and phase 2 had to fix the
   * same class again.
   */
  errorText?: string | undefined;
  ms: number;
  chars?: number;
  inputTokens?: number;
  outputTokens?: number;
  /**
   * ⚠️ **TOOL-LOOP FIELDS (phase 2), AND THE LESSON THAT PUT THEM HERE.** This
   * logger builds its output field by field and SILENTLY DROPS anything it was
   * not told about — which is exactly how the first `status` fix shipped as a
   * no-op on 2026-09-01: it was added at the call site alone and never appeared
   * in a line. ⚠️ **A new field goes in BOTH places, this type and the object
   * below, or it does not exist.**
   */
  /** Which pass of the tool loop this was, 1-based. 0 on a toolless call. */
  iteration?: number;
  /** How many tools this pass offered. ⚠️ 0 on the loop's final tools-free pass
   *  as well as on a toolless call — the `iteration` field distinguishes them. */
  toolsOffered?: number;
  /**
   * ⚠️ **THE PRE-FLIGHT NUMBERS (2026-09-02), and they are here so the owner
   * can act on the ceiling rather than interpret an error.** On a `too_large`
   * fallback these say how far over the tier's allowance the request was; on a
   * successful pass they say how much room was left. A 413 on its own is an
   * error nobody can size. Both, as ever, in BOTH places.
   */
  estimatedTokens?: number;
  budget?: number;
  /** ⚠️ Tool NAMES the shaping withheld from the Groq request this pass —
   *  our vocabulary, never a person's words. `[]` and absent both mean none. */
  toolsDropped?: readonly string[];
  /** On `ineligible` only: which of the two reasons. */
  ineligibleReason?: 'tool_not_allowlisted' | 'posture_shadow';
  /** On `ineligible` only: the offered tool names that are not allowlisted, so
   *  "why is this loop still on Haiku?" is answerable from `wrangler tail`
   *  without reading TypeScript. Tool names are our vocabulary, never a
   *  person's words — nothing here is a text. */
  blockedTools?: readonly string[];
  who?: GroqWho;
}): void {
  console.log(
    JSON.stringify({
      evt: 'gabi_groq',
      surface: 'discord_mention',
      mode: entry.mode,
      purpose: entry.purpose,
      model: GABI_GROQ_MODEL,
      outcome: entry.outcome,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.status ? { status: entry.status } : {}),
      // ⚠️ THE EMITTED HALF of the field above. Omitted rather than logged as
      // an empty string when there is nothing to say, so `jq 'select(.error_text)'`
      // selects the lines that actually carry a refusal.
      ...(entry.errorText ? { error_text: entry.errorText } : {}),
      ms: entry.ms,
      chars: entry.chars ?? 0,
      // ⚠️ The tool-loop half of the line. Always present (as 0) rather than
      // conditional, so `jq 'select(.iteration > 1)'` is a question that can be
      // asked of the whole stream instead of only of the lines that happened to
      // carry the key.
      iteration: entry.iteration ?? 0,
      tools_offered: entry.toolsOffered ?? 0,
      // ⚠️ THE EMITTED HALF of the pre-flight numbers. Omitted rather than
      // logged as 0 on the toolless lane, which does no pre-flight at all — a 0
      // budget would read as a ceiling of nothing.
      ...(entry.estimatedTokens === undefined ? {} : { estimated_tokens: entry.estimatedTokens }),
      ...(entry.budget === undefined ? {} : { token_budget: entry.budget }),
      ...(entry.toolsDropped && entry.toolsDropped.length > 0
        ? { tools_dropped: [...entry.toolsDropped] }
        : {}),
      ...(entry.ineligibleReason ? { ineligible_reason: entry.ineligibleReason } : {}),
      ...(entry.blockedTools && entry.blockedTools.length > 0
        ? { blocked_tools: [...entry.blockedTools] }
        : {}),
      // ⚠️ Raw counts, no cents. Groq's tier is free TODAY and a fabricated
      // price would be wrong the day it is not — see `black_bot_baf`'s own
      // note that charging Groq at zero "is a decision to revisit when it is
      // not". `docs/info/llm-billing-control-design.md` §2 carries the row.
      input_tokens: entry.inputTokens ?? 0,
      output_tokens: entry.outputTokens ?? 0,
      discord_user_id: entry.who?.discordUserId ?? null,
      guild_id: entry.who?.guildId ?? null,
      at: new Date().toISOString(),
    }),
  );
}

/**
 * ⚠️ **THE SHADOW LINE — the one the owner reads before flipping to `first`.**
 *
 * Never the texts, for the reason above. `groq_answered` / `haiku_answered` are
 * the did-it-answer bits: an answer that failed the SHARED validator reads
 * `false` here, which is exactly the question "would Groq have been good
 * enough" reduced to one boolean. `agreed` appears only where an agreement is
 * meaningful (a bucket name, a parsed fix) — comparing two free-prose replies
 * for equality would be noise wearing a number.
 */
export function logGroqShadow(entry: {
  purpose: string;
  groqMs: number;
  haikuMs: number;
  groqChars: number;
  haikuChars: number;
  groqAnswered: boolean;
  haikuAnswered: boolean;
  reason?: GroqReason;
  // ⚠️ The HTTP status behind a `refused`/`rate_limited`/`server` reason. Added
  // 2026-09-01 evening: the first live shadow lines ever logged read
  // `reason: "refused"` with no way to tell a 401 (bad key) from a 400 (retired
  // model id) — and the first fix landed at the CALL SITE while this function
  // builds its output explicitly and silently dropped the extra key. The
  // lesson: a field-by-field logger needs the field in BOTH places.
  status?: number;
  /** ⚠️ The same refusal text the `gabi_groq` line carries, for the same
   *  reason and in BOTH places. A shadow line reading `refused` with no body
   *  is the exact shape of the 2026-09-01 `status` miss. */
  errorText?: string | undefined;
  agreed?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  who?: GroqWho;
}): void {
  console.log(
    JSON.stringify({
      evt: 'gabi_groq_shadow',
      surface: 'discord_mention',
      purpose: entry.purpose,
      model: GABI_GROQ_MODEL,
      groq_ms: entry.groqMs,
      haiku_ms: entry.haikuMs,
      groq_chars: entry.groqChars,
      haiku_chars: entry.haikuChars,
      groq_answered: entry.groqAnswered,
      haiku_answered: entry.haikuAnswered,
      ...(entry.reason ? { reason: entry.reason } : {}),
      ...(entry.status === undefined ? {} : { status: entry.status }),
      ...(entry.errorText ? { error_text: entry.errorText } : {}),
      ...(entry.agreed === undefined ? {} : { agreed: entry.agreed }),
      input_tokens: entry.inputTokens ?? 0,
      output_tokens: entry.outputTokens ?? 0,
      discord_user_id: entry.who?.discordUserId ?? null,
      guild_id: entry.who?.guildId ?? null,
      at: new Date().toISOString(),
    }),
  );
}

// ---------------------------------------------------------------------------
// The rung itself
// ---------------------------------------------------------------------------

const now = (): number => Date.now();

/**
 * **Try Groq, then fall through to Haiku** — the whole ladder, in one place, so
 * the four call sites each add three lines rather than a copy of this.
 *
 * ⚠️ **`turn` IS A THUNK, DELIBERATELY.** With the posture `off` the prompt is
 * never even BUILT: no string is concatenated, no message array is allocated,
 * no request is made, and the function is a straight `return haiku()`. That is
 * what makes "`off` is byte-identical to yesterday" a property a test can
 * assert rather than a claim — `test/gabi-groq.test.ts` fails the build if
 * `turn` is ever invoked with the posture off.
 *
 * ⚠️ **`haiku` is always the EXISTING call, unchanged.** This module makes no
 * Anthropic request of its own; it calls back into the function that was
 * already there. A fallback that re-implemented the Haiku turn would be a
 * second place for it to drift.
 */
export async function viaGroq<T>(args: {
  rung: GroqRung | undefined;
  /** `classify` / `converse` / `distill` / `parse_fix` — the log's key. */
  purpose: string;
  /** Builds the Groq request. NOT called when the posture is `off`. */
  turn: () => GroqTurn;
  /**
   * ⚠️ THE SHARED VALIDATOR — the same function the Anthropic path applies to
   * its own reply. `null` means "this is not a usable answer", which is a
   * FAILURE (`reason: 'invalid'`) and falls through.
   */
  validate: (text: string) => T | null;
  /** The existing Anthropic call, verbatim. */
  haiku: () => Promise<T | null>;
  fetchImpl?: typeof fetch;
  who?: GroqWho;
  /** Optional, and only where agreement means something. See `logGroqShadow`. */
  compare?: (fromGroq: T, fromHaiku: T | null) => boolean;
  /** How long the answer was, for the log. Defaults to a JSON length. */
  size?: (value: T) => number;
}): Promise<T | null> {
  const rung = args.rung;
  const mode = rung?.mode ?? 'off';

  // ⚠️ THE OFF PATH. Nothing below this line runs, including `args.turn()`.
  // A missing key is the same non-event a missing `ANTHROPIC_API_KEY_GABI` is:
  // the rung simply does not exist, and no line is written about it on every
  // turn — the absence is visible on `/api/health` instead.
  if (!groqLive(rung) || !rung?.apiKey) return args.haiku();

  const apiKey = rung.apiKey;
  const sizeOf = args.size ?? ((v: T) => (typeof v === 'string' ? v.length : JSON.stringify(v).length));

  const attempt = async (): Promise<
    { ok: true; value: T; ms: number; chars: number; inputTokens: number; outputTokens: number }
    | { ok: false; ms: number; reason: GroqReason; status?: number | undefined; errorText?: string | undefined }
  > => {
    const started = now();
    try {
      const answer = await groqComplete(apiKey, args.turn(), args.fetchImpl ?? fetch);
      const value = args.validate(answer.text);
      if (value === null) {
        return { ok: false, ms: now() - started, reason: 'invalid' };
      }
      return {
        ok: true,
        value,
        ms: now() - started,
        chars: answer.text.length,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
      };
    } catch (err) {
      const failure =
        err instanceof GroqFailure
          ? err
          : // ⚠️ Anything unforeseen — a validator that threw, a runtime quirk —
            // is `malformed` rather than an escape into the caller. A first line
            // must never be able to cost somebody the answer Haiku would have
            // given.
            new GroqFailure('malformed', `groq rung failed: ${String((err as Error)?.name ?? err)}`);
      return {
        ok: false,
        ms: now() - started,
        reason: failure.reason,
        ...(failure.status === undefined ? {} : { status: failure.status }),
        ...(failure.errorText === undefined ? {} : { errorText: failure.errorText }),
      };
    }
  };

  // ── shadow ───────────────────────────────────────────────────────────────
  // ⚠️ Started BEFORE the Haiku call and awaited AFTER it, so the comparison
  // costs the person no extra latency. A shadow that made turns slower would be
  // measured, correctly, as a reason not to flip.
  if (mode === 'shadow') {
    const shadowed = attempt();
    const haikuStarted = now();
    const answer = await args.haiku();
    const haikuMs = now() - haikuStarted;
    const seen = await shadowed;
    logGroqShadow({
      purpose: args.purpose,
      groqMs: seen.ms,
      haikuMs,
      groqChars: seen.ok ? seen.chars : 0,
      haikuChars: answer === null ? 0 : sizeOf(answer),
      groqAnswered: seen.ok,
      haikuAnswered: answer !== null,
      // ⚠️ Status included since 2026-09-01 (same day as the build): the FIRST
      // live shadow lines came back reason:"refused" with no way to tell a 401
      // (bad key) from a 400 (retired model id) — while the runbook was already
      // telling the owner to look for `status: 401` on these very lines.
      ...(seen.ok
        ? {}
        : {
            reason: seen.reason,
            ...(seen.status === undefined ? {} : { status: seen.status }),
            ...(seen.errorText === undefined ? {} : { errorText: seen.errorText }),
          }),
      ...(seen.ok && args.compare ? { agreed: args.compare(seen.value, answer) } : {}),
      ...(seen.ok ? { inputTokens: seen.inputTokens, outputTokens: seen.outputTokens } : {}),
      ...(args.who ? { who: args.who } : {}),
    });
    // ⚠️ HAIKU'S ANSWER, ALWAYS. Groq's is measured and discarded — that is the
    // entire difference between `shadow` and `first`.
    return answer;
  }

  // ── first ────────────────────────────────────────────────────────────────
  const seen = await attempt();
  if (seen.ok) {
    logGroq({
      mode,
      purpose: args.purpose,
      outcome: 'groq',
      ms: seen.ms,
      chars: seen.chars,
      inputTokens: seen.inputTokens,
      outputTokens: seen.outputTokens,
      ...(args.who ? { who: args.who } : {}),
    });
    return seen.value;
  }
  // ⚠️ ONE line naming the reason, then the existing Haiku call, unchanged. The
  // person cannot tell this happened, and that is the requirement.
  logGroq({
    mode,
    purpose: args.purpose,
    outcome: 'fallback',
    reason: seen.reason,
    status: seen.status,
    errorText: seen.errorText,
    ms: seen.ms,
    ...(args.who ? { who: args.who } : {}),
  });
  return args.haiku();
}
