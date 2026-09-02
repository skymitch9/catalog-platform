/**
 * **THE ANTHROPIC↔OPENAI TOOL TRANSLATION — Groq phase 2 (2026-09-02).**
 *
 * Phase 1 (`gabi-groq.ts`) put a cheap first line in front of Haiku on the four
 * TOOLLESS calls and stopped there, with the reason written down in its own
 * header: *"Anthropic's `tools` block and OpenAI's are different schemas with
 * different result-echo grammars."* ⚠️ **That is also where most of the tokens
 * are** — the tool loop has the largest `max_tokens` and runs several round
 * trips per turn — so this file is where the rung's savings actually live.
 *
 * ## ⚠️ THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM
 *
 * **The conversation state stays in ANTHROPIC grammar, always.** `messages` in
 * `converseWithTools` is untouched by this module: OpenAI shapes exist only for
 * the length of one HTTP request, built fresh from the Anthropic array on the
 * way out and translated straight back into Anthropic content BLOCKS on the way
 * in. Nothing downstream — `textOf`, `toolUseBlocks`, `needsFinishing`, the
 * `tool_result` echo, the `is_error` rule — learns that a second provider
 * exists.
 *
 * Two things fall out of that, and both are the reason for it:
 *
 *  1. ⚠️ **A per-turn fallback is a genuine replay.** When a Groq pass fails,
 *     the Haiku call that replaces it is made from *byte-identical* state,
 *     because the failed attempt could not have mutated anything — it never
 *     touched `messages`. "Replay that turn on Haiku" is a property of the data
 *     structure rather than a promise in a comment.
 *  2. ⚠️ **The invariants survive by construction, not by re-implementation.**
 *     One user message carrying ALL of a turn's results, `is_error` rather than
 *     a drop, no tools on the final pass, the dangling-colon guard, the
 *     iteration cap — every one of them lives in `converseWithTools` and is
 *     enforced on the SAME array whichever provider answered.
 *
 * ## The grammar, field by field
 *
 * | Anthropic | OpenAI (Groq) |
 * |---|---|
 * | `tools[].input_schema` | `tools[].function.parameters`, under `type:"function"` |
 * | assistant `tool_use` block | `tool_calls[]`, arguments as a JSON **string** |
 * | user message of `tool_result` blocks | one `role:"tool"` message per result, `tool_call_id` matching |
 * | `is_error: true` | ⚠️ no such field — the error becomes PLAIN TEXT the model reads |
 * | `stop_reason: "tool_use"` | `finish_reason: "tool_calls"` |
 * | `stop_reason: "max_tokens"` | `finish_reason: "length"` |
 *
 * ⚠️ **`is_error` is the one that cannot be translated and must not be dropped.**
 * `converseWithTools`'s header says why: *"a silently-empty one teaches the model
 * that an outage and an absence are the same thing"* — and on this surface those
 * two answers ("the catalogue does not have it" versus "the catalogue could not
 * be reached") are the difference between an honest reply and a wrong one. OpenAI
 * has nowhere to put the flag, so it is put where the model will actually read
 * it: in front of the content, in words.
 *
 * ## ⚠️ WHAT THIS MODULE REFUSES, AND WHY REFUSING IS CHEAP HERE
 *
 * A Groq pass that comes back with a tool call this turn did not offer, with
 * arguments that are not JSON, or with arguments that miss a required property,
 * throws `GroqFailure('invalid')` — and the caller replays the turn on Haiku.
 * That is safe in a way it would not be later in the loop: ⚠️ **the failed pass's
 * tools were never executed.** Nothing happened, so nothing has to be undone.
 * Being strict costs at most one Haiku turn we were going to spend anyway before
 * phase 2 existed; being lax costs a tool call built on arguments nobody checked.
 */

import {
  failureFor,
  GABI_GROQ_MODEL,
  GROQ_CHAT_URL,
  GROQ_MIN_MAX_TOKENS,
  GROQ_TIMEOUT_MS,
  GroqFailure,
} from './gabi-groq.js';
import {
  GABI_BOOKS_TOOL_NAMES,
  GABI_DOCS_TOOL_NAMES,
  GABI_RECALL_TOOL_NAMES,
  GABI_SHELF_TOOL_NAMES,
  GABI_TOOL_NAMES,
  type GabiTool,
} from './gabi-tools.js';

/** A tool as `toolsForApi` hands it over: what the model is told, and nothing
 *  the executor uses. Structurally the Anthropic wire shape. */
export interface WireTool {
  name: string;
  description: string;
  input_schema: GabiTool['input_schema'];
}

/**
 * ⚠️ **The prefix a failed tool wears on the OpenAI side.** It exists because
 * `is_error: true` has no OpenAI equivalent and dropping it would make an
 * outage read as an absence. Deliberately worded rather than a code: the reader
 * is a language model, and `{"is_error":true}` in a JSON blob is a token it can
 * skim past in a way that a sentence in capitals at position zero is not.
 */
export const TOOL_ERROR_PREFIX =
  'TOOL ERROR — this lookup FAILED and returned no data. This is not the same as the ' +
  'thing not existing; do not report it as an absence. Details: ';

// ---------------------------------------------------------------------------
// Out: Anthropic → OpenAI
// ---------------------------------------------------------------------------

/**
 * The tool array, translated. ⚠️ `input_schema` is passed through by REFERENCE
 * rather than rebuilt field by field: a hand-copied schema is a second place for
 * the tool's contract to live, and the two would drift the first time somebody
 * adds a property. JSON Schema is JSON Schema on both sides — only the envelope
 * differs.
 */
export function toOpenAiTools(tools: readonly WireTool[]): {
  type: 'function';
  function: { name: string; description: string; parameters: GabiTool['input_schema'] };
}[] {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

/** One OpenAI-shaped message. `tool` messages carry the id they answer. */
export interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

/** ⚠️ An assistant turn with neither text nor tool calls is a 400 on both
 *  providers. `converseWithTools` already substitutes this exact placeholder on
 *  the Anthropic side (the nudge path's `(cut off)`); the same string is used
 *  here so the two transports send the same conversation. */
const EMPTY_ASSISTANT = '(cut off)';

function textFromBlocks(blocks: readonly unknown[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const block = b as { type?: unknown; text?: unknown };
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

/**
 * The `messages` array, translated — the system prompt first, exactly as the
 * toolless rung does it.
 *
 * ⚠️ **THE ORDERING RULE THAT IS NOT OPTIONAL.** A `role:"tool"` message is only
 * valid immediately after the assistant message whose `tool_calls` it answers,
 * and every emitted id must be answered. Anthropic expresses the same rule as
 * *"one user message carrying ALL of this turn's `tool_result`s"* — so a
 * one-to-many expansion here (one Anthropic user message → N OpenAI tool
 * messages, in order, then any leftover prose as a real user message) preserves
 * it rather than merely resembling it. `test/gabi-groq.test.ts` pins that the
 * ids round-trip.
 */
export function toOpenAiMessages(
  system: string,
  messages: readonly { role: 'user' | 'assistant'; content: unknown }[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: system }];

  for (const msg of messages) {
    // The plain case — every remembered turn, the question itself, the nudge.
    // Already both grammars at once, so nothing is done to it: a conversion is a
    // place for a bug.
    if (typeof msg.content === 'string') {
      out.push({ role: msg.role, content: msg.content });
      continue;
    }
    const blocks = Array.isArray(msg.content) ? (msg.content as readonly unknown[]) : [];

    if (msg.role === 'assistant') {
      const text = textFromBlocks(blocks);
      const calls: NonNullable<OpenAiMessage['tool_calls']> = [];
      for (const b of blocks) {
        const block = b as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
        if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue;
        calls.push({
          id: block.id,
          type: 'function',
          // ⚠️ A JSON **STRING**, not an object. This is the single commonest way
          // an OpenAI-compatible translation is written wrong, and it fails as a
          // 400 rather than as anything a reader would recognise.
          function: { name: String(block.name ?? ''), arguments: JSON.stringify(block.input ?? {}) },
        });
      }
      out.push({
        role: 'assistant',
        content: text.length > 0 ? text : calls.length > 0 ? '' : EMPTY_ASSISTANT,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }

    // A user message of `tool_result` blocks becomes N tool messages, in the
    // order the results were produced. Any text blocks riding along stay a user
    // message and go AFTER them, because a tool answer that arrives after a new
    // user sentence is a tool answer the model reads as stale.
    const prose: string[] = [];
    for (const b of blocks) {
      const block = b as {
        type?: unknown;
        tool_use_id?: unknown;
        content?: unknown;
        is_error?: unknown;
        text?: unknown;
      };
      if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const raw = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? null);
        // ⚠️ CAPPED FOR GROQ ONLY, and the cut is MARKED. The Anthropic array
        // is untouched — this function builds a throwaway body for one HTTP
        // request. A silent truncation would read to the model exactly like a
        // short result, which is to say like an absence, and this surface's
        // whole contract is that a partial and an absence are different things.
        const body = capToolResult(raw);
        out.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: block.is_error === true ? `${TOOL_ERROR_PREFIX}${body}` : body,
        });
        continue;
      }
      if (block?.type === 'text' && typeof block.text === 'string') prose.push(block.text);
    }
    if (prose.length > 0) out.push({ role: 'user', content: prose.join('') });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Back in: OpenAI → Anthropic
// ---------------------------------------------------------------------------

/**
 * ⚠️ **ARGUMENT VALIDATION, and it is the reason a translation layer is allowed
 * to exist at all.** The Anthropic path never needed this because the model
 * emitting the call and the schema constraining it are the same vendor's; a
 * different vendor's open-weights model is exactly the case where a plausible
 * call with a wrong-shaped argument is likely, and where nothing downstream
 * would notice — `runTool` would hand junk to a catalogue query and get an empty
 * result, which reads as *"the house does not have it"*.
 *
 * Checked, cheaply: every `required` property present, no property the schema
 * does not declare (every tool here is `additionalProperties: false`), the
 * declared scalar type, and enum membership. NOT checked: nested object shapes,
 * because no tool on this surface takes one.
 *
 * Returns a sentence naming the first problem, or `null` when the arguments are
 * usable.
 */
export function invalidToolArgs(
  schema: GabiTool['input_schema'],
  args: Record<string, unknown>,
): string | null {
  for (const need of schema.required) {
    if (args[need] === undefined) return `missing required property "${need}"`;
  }
  for (const [key, value] of Object.entries(args)) {
    const spec = schema.properties[key];
    if (!spec) return `unknown property "${key}"`;
    if (value === undefined || value === null) continue;
    const actual = Array.isArray(value) ? 'array' : typeof value;
    const wanted = spec.type === 'integer' ? 'number' : spec.type;
    if (actual !== wanted) return `property "${key}" should be ${spec.type}, got ${actual}`;
    if (spec.enum && !spec.enum.includes(String(value))) {
      return `property "${key}" is not one of ${spec.enum.join(', ')}`;
    }
  }
  return null;
}

/** What one Groq pass produced, in the loop's own vocabulary. */
export interface GroqToolPass {
  /** ⚠️ ANTHROPIC content blocks — `text` and `tool_use`. The loop cannot tell
   *  which provider built them, and that is the whole design. */
  blocks: unknown[];
  /** Mapped to Anthropic's vocabulary so `needsFinishing` and the loop's
   *  `stop_reason !== 'tool_use'` guard keep working unchanged. */
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens';
  inputTokens: number;
  outputTokens: number;
  /** How much prose came back, for the log line. Never the prose itself. */
  chars: number;
}

function tokenCount(usage: unknown, key: string): number {
  const raw = (usage ?? {}) as Record<string, unknown>;
  return typeof raw[key] === 'number' ? (raw[key] as number) : 0;
}

/**
 * Translate one OpenAI completion into Anthropic blocks, refusing anything this
 * turn cannot honestly execute.
 *
 * `offered` is the tool array THIS pass sent — not the module's allowlist — so a
 * call to a tool that exists but was withheld (the final tools-free pass, or a
 * family the posture switched off) is refused as firmly as an invented one.
 */
export function blocksFromCompletion(payload: unknown, offered: readonly WireTool[]): GroqToolPass {
  const choices = (payload as { choices?: unknown } | null)?.choices;
  const choice = (Array.isArray(choices) ? choices[0] : null) as {
    message?: { content?: unknown; tool_calls?: unknown };
    finish_reason?: unknown;
  } | null;
  if (!choice) throw new GroqFailure('malformed', 'groq answered 200 with no choices', 200);

  const said = choice.message?.content;
  const text = typeof said === 'string' ? said.trim() : '';
  const rawCalls = Array.isArray(choice.message?.tool_calls) ? choice.message.tool_calls : [];

  const blocks: unknown[] = [];
  if (text.length > 0) blocks.push({ type: 'text', text });

  for (const raw of rawCalls) {
    const call = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const id = typeof call?.id === 'string' && call.id.length > 0 ? call.id : null;
    const name = typeof call?.function?.name === 'string' ? call.function.name : '';
    if (!id) throw new GroqFailure('invalid', 'groq emitted a tool call with no id', 200);
    const tool = offered.find((t) => t.name === name);
    // ⚠️ Refused rather than passed to `runTool`'s own default-deny. The
    // executor would answer `unknown_tool` and the loop would burn an iteration
    // teaching a cheap model a lesson Haiku does not need; a fall-through spends
    // the same tokens and gets the question answered.
    if (!tool) throw new GroqFailure('invalid', `groq called a tool this turn did not offer: ${name}`, 200);

    const rawArgs = call.function?.arguments;
    let args: Record<string, unknown>;
    if (rawArgs === undefined || rawArgs === null || rawArgs === '') {
      args = {};
    } else if (typeof rawArgs !== 'string') {
      // ⚠️ Some OpenAI-compatible servers send an OBJECT here in violation of the
      // contract. Accepted rather than refused: it is unambiguous, and refusing a
      // usable call to be pedantic about an envelope would spend a Haiku turn for
      // nothing.
      args = (typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
    } else {
      try {
        const parsed: unknown = JSON.parse(rawArgs);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        args = parsed as Record<string, unknown>;
      } catch {
        throw new GroqFailure('invalid', `groq sent arguments for ${name} that are not a JSON object`, 200);
      }
    }

    const wrong = invalidToolArgs(tool.input_schema, args);
    if (wrong) throw new GroqFailure('invalid', `groq's arguments for ${name} are unusable: ${wrong}`, 200);

    blocks.push({ type: 'tool_use', id, name, input: args });
  }

  // ⚠️ A 200 with neither words nor a call in it is a FAILURE, never a silent
  // blank — the same rule the toolless client applies, and the one that caught
  // gpt-oss spending a whole classification cap on thinking.
  if (blocks.length === 0) throw new GroqFailure('empty', 'groq answered with no words and no tool call', 200);

  const finish = typeof choice.finish_reason === 'string' ? choice.finish_reason : '';
  // ⚠️ A pass that produced calls is `tool_use` WHATEVER the finish reason said.
  // The loop keys on this: read it from `finish_reason` alone and a server that
  // says `stop` beside a `tool_calls` array would have its calls silently dropped
  // and its narration posted as the answer — which is the 2026-08-18 silent
  // partial, arriving through a new door.
  const hasCalls = blocks.some((b) => (b as { type?: unknown })?.type === 'tool_use');
  const stopReason: GroqToolPass['stopReason'] = hasCalls
    ? 'tool_use'
    : finish === 'length'
      ? 'max_tokens'
      : 'end_turn';

  const usage = (payload as { usage?: unknown } | null)?.usage;
  return {
    blocks,
    stopReason,
    inputTokens: tokenCount(usage, 'prompt_tokens'),
    outputTokens: tokenCount(usage, 'completion_tokens'),
    chars: text.length,
  };
}

// ---------------------------------------------------------------------------
// ⚠️ FITTING THE REQUEST — the 413 ceiling, measured 2026-09-02
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE CEILING IS THE TIER, AND IT IS 8,000 TOKENS A MINUTE.**
 *
 * The owner's first live tool test produced this, off the wire:
 *
 * | pass | tools | input tokens | outcome |
 * |---|---|---|---|
 * | 12-tool pass | 12 | — | **413 in ~37 ms**, every time |
 * | 6-tool pass | 6 | **4,736** | ✅ rode Groq |
 * | the next pass (results appended) | 6 | — | **413** |
 *
 * Groq publishes, for `openai/gpt-oss-120b` on the **free plan**: 30 RPM,
 * 1,000 RPD, **8,000 TPM**, 200,000 TPD
 * (`console.groq.com/docs/rate-limits`, read 2026-09-02). Their errors page
 * documents 413 as *"The request body is too large. Please reduce the size of
 * the request body."* A single request larger than the whole minute's
 * allowance can never succeed, so it is refused outright rather than queued —
 * which is exactly the instant 37 ms refusal that was measured.
 *
 * ⚠️ **THE ARITHMETIC FITS THE MEASUREMENTS EXACTLY**, which is why this is a
 * diagnosis and not a hypothesis. Measured in this repo the same day:
 *
 * | part | tokens (≈) |
 * |---|---|
 * | system prompt, all addenda (11,267 chars) | 2,817 |
 * | 13 tool schemas as OpenAI functions (16,474 bytes) | 4,119 |
 * | `max_tokens`, charged against the same allowance | 1,024 |
 * | **total before a single word of question** | **≈ 7,960** |
 *
 * — against a ceiling of 8,000. And the 6-tool pass that SUCCEEDED measured
 * 4,736 input + 1,024 = 5,760, comfortably under; the pass after it added the
 * tool results and went over.
 *
 * ⚠️ **SO THE FIX IS TWO-SIDED AND THE OWNER OWNS HALF OF IT.** This module can
 * make the request smaller; it cannot make the tier bigger. Upgrading to Groq's
 * Developer plan raises the limit and makes every mitigation below headroom
 * rather than necessity. Nothing here assumes he will.
 */
export const GROQ_TPM_LIMIT = 8_000;

/**
 * ⚠️ Slack against a token ESTIMATE. The estimator below is characters ÷ 4 —
 * good to maybe ±15% on English prose and worse on JSON schemas, which are
 * punctuation-dense. Being wrong low costs a 413 and a wasted round trip;
 * being wrong high costs a Groq pass we could have had. The first is worse, so
 * the headroom is generous.
 */
export const GROQ_REQUEST_HEADROOM = 700;

/** How many INPUT tokens a request may carry, given what it reserves for the
 *  answer. ⚠️ `max_tokens` is charged against the same per-minute allowance, so
 *  it is subtracted rather than ignored. */
export function groqInputBudget(maxTokens: number): number {
  return GROQ_TPM_LIMIT - Math.max(maxTokens, GROQ_MIN_MAX_TOKENS) - GROQ_REQUEST_HEADROOM;
}

/**
 * ⚠️ **A TOKEN ESTIMATE, AND IT SAYS SO IN ITS NAME.** There is no tokeniser on
 * this Worker and adding one for a pre-flight check would be a dependency to
 * dodge a 37 ms refusal. Characters ÷ 4 is the standard rough figure; the
 * headroom above is what makes it safe to be wrong.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * ⚠️ **HOW SHORT A TOOL DESCRIPTION GETS ON THE GROQ WIRE ONLY.**
 *
 * These descriptions are long on purpose — `GabiTool`'s own comment records why:
 * *"prescriptive about WHEN to call, not just what it does… a trigger condition
 * in the description measurably lifts should-call rate"*. Every ⚠️ line in them
 * is a failure this estate has actually seen.
 *
 * ⚠️ **So trimming them is a REAL cost, taken deliberately and only for Groq.**
 * The Anthropic array is untouched: `toolsForApi`'s output goes to Haiku exactly
 * as it always did, and a fallback replays the turn with the full text. What is
 * being traded is *some* of a cheap model's tool-choice accuracy for the
 * possibility of a Groq pass at all — and the downside is bounded, because a
 * badly-chosen or badly-shaped call is REFUSED by `blocksFromCompletion` and
 * replayed on Haiku, which is the turn we were going to spend before phase 2
 * existed.
 *
 * The cut is at a SENTENCE boundary wherever there is one before the cap, so a
 * description ends on a complete instruction rather than mid-clause.
 */
export const GROQ_TOOL_DESCRIPTION_MAX = 240;

/** The same, for a property's description — these are mostly one short clause
 *  already, and the few long ones are prose a schema does not need. */
export const GROQ_PROPERTY_DESCRIPTION_MAX = 80;

/** Cut at the last sentence end before the cap, or hard-cut with an ellipsis so
 *  a truncation is never silent. */
function clipDescription(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
  // ⚠️ Only accept a sentence break in the last third — a break at character 12
  // of a 240-character budget throws away more than the truncation saves.
  if (stop > max * 0.66) return head.slice(0, stop + 1);
  return `${head.trimEnd()}…`;
}

/**
 * The tool array, trimmed for the Groq request. ⚠️ Returns NEW objects: the
 * shared `GABI_TOOLS` definitions and the array Anthropic receives must not be
 * mutated by a shaping pass — that would make the trim leak into the fallback
 * and quietly degrade the model that was supposed to be the good one.
 */
export function leanTools(tools: readonly WireTool[]): WireTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: clipDescription(t.description, GROQ_TOOL_DESCRIPTION_MAX),
    input_schema: {
      ...t.input_schema,
      properties: Object.fromEntries(
        Object.entries(t.input_schema.properties).map(([key, spec]) => [
          key,
          { ...spec, description: clipDescription(spec.description, GROQ_PROPERTY_DESCRIPTION_MAX) },
        ]),
      ),
    },
  }));
}

/**
 * ⚠️ **HOW MANY BYTES OF ONE TOOL RESULT GROQ IS SENT, and why the marker is
 * not optional.**
 *
 * A book passage, a docs section or a 30-row catalogue count can be thousands of
 * tokens on its own, and the measured failure was precisely *"the pass after
 * the results were appended"*. Truncating is the only lever that does not
 * change what was asked.
 *
 * ⚠️ **A SILENT TRUNCATION WOULD BE THE WORST BUG IN THIS FILE.** It reads to
 * the model exactly like a short result — which is to say, like an absence —
 * and this whole surface's honesty contract is that an absence and an outage
 * and a partial are three different things. So the cut says, in words, that it
 * is a cut, and tells the model what to do about it.
 */
export const GROQ_TOOL_RESULT_MAX = 2_000;

export const TOOL_RESULT_TRUNCATED =
  ' …[CUT SHORT — this result was TRUNCATED to fit the request size. What you cannot see is ' +
  'MISSING FROM YOUR VIEW, not missing from the estate: never report it as an absence. Say you ' +
  'only saw part of it if the missing part matters, and offer to look again.]';

/** One tool result, capped. ⚠️ The marker is appended, never substituted, so
 *  what the model DOES see is real. */
export function capToolResult(body: string, max: number = GROQ_TOOL_RESULT_MAX): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}${TOOL_RESULT_TRUNCATED}`;
}

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

export interface GroqToolRequest {
  system: string;
  messages: readonly { role: 'user' | 'assistant'; content: unknown }[];
  /** ⚠️ EMPTY on the loop's final pass, exactly as the Anthropic call omits
   *  `tools` there. Offering tools whose results could never be executed is how
   *  a loop ends with an unanswered call and no text at all. */
  tools: readonly WireTool[];
  maxTokens: number;
}

/**
 * ⚠️ **THE PRE-FLIGHT, and it exists so a doomed request is never SENT.**
 *
 * The measured failure mode is a 413 in ~37 ms — cheap, but not free, and it
 * arrives with no number in it. Estimating first means the log line can say
 * *"we did not even try, and here is how far over we were"*, which is a
 * measurement the owner can act on (upgrade the tier) rather than an error he
 * has to interpret.
 *
 * ⚠️ It is a `fits` boolean and an estimate, not a throw: the caller's fallback
 * is Haiku either way, and this function's job is to say WHICH kind of
 * not-Groq this turn is.
 */
export interface GroqFit {
  /** The request as it would actually be sent — lean tools, capped results. */
  request: GroqToolRequest;
  estimatedTokens: number;
  budget: number;
  fits: boolean;
  /** What the shaping actually did, for the log line. Never the texts. */
  toolsOffered: number;
  toolsDropped: readonly string[];
}

/**
 * ⚠️ **NARROWING — "offer only what this turn has shown it needs", and the
 * grain is the FAMILY rather than the tool.**
 *
 * On the first pass the loop knows nothing, so everything is offered. Once a
 * tool has run, the turn has declared what kind of question it is, and the
 * other families are ~10 KB of schema describing capabilities this turn will
 * not use.
 *
 * ⚠️ **BY FAMILY, NOT BY TOOL, and the difference is a real bug avoided.** The
 * book addendum's own instruction is *"list_book_knowledge (always first — it
 * is where book ids come from), THEN search_book_text"*. Narrowing to "tools
 * already executed" would offer `list_book_knowledge` on pass 2 and withhold
 * the `search_book_text` that pass 2 exists to call. Tier 0 is always kept: a
 * question about a book's text is very often also a question about the shelf.
 */
export function narrowToFamilies(
  tools: readonly WireTool[],
  executed: readonly string[],
): { tools: WireTool[]; dropped: string[] } {
  if (executed.length === 0) return { tools: [...tools], dropped: [] };
  const families: readonly (readonly string[])[] = [
    GABI_DOCS_TOOL_NAMES,
    GABI_BOOKS_TOOL_NAMES,
    GABI_SHELF_TOOL_NAMES,
    GABI_RECALL_TOOL_NAMES,
  ];
  const keep = new Set<string>(GABI_TOOL_NAMES);
  for (const family of families) {
    if (family.some((n) => executed.includes(n))) for (const n of family) keep.add(n);
  }
  const kept: WireTool[] = [];
  const dropped: string[] = [];
  for (const t of tools) {
    if (keep.has(t.name)) kept.push(t);
    else dropped.push(t.name);
  }
  return { tools: kept, dropped };
}

/**
 * Shape one request to fit the tier, and say whether it did.
 *
 * Three levers, applied in increasing order of how much they cost us:
 *  1. **lean tool schemas** — free-ish, Groq-only, the Anthropic text untouched;
 *  2. **capped tool results** — marked, never silent (`toOpenAiMessages`);
 *  3. **narrowing to the families this turn has used** — only once the turn has
 *     told us what it is.
 *
 * ⚠️ There is deliberately no fourth lever that drops the SYSTEM PROMPT. Every
 * line of it is a failure this estate has seen, the register lives there, and a
 * cheaper model reading a shorter brief is exactly how a confidently wrong
 * answer gets built. If a turn does not fit with the tools trimmed, it goes to
 * Haiku whole.
 */
export function fitGroqRequest(req: GroqToolRequest, executed: readonly string[] = []): GroqFit {
  const narrowed = narrowToFamilies(req.tools, executed);
  const tools = leanTools(narrowed.tools);
  const request: GroqToolRequest = { ...req, tools };
  const messages = toOpenAiMessages(request.system, request.messages);
  const estimatedTokens =
    estimateTokens(JSON.stringify(messages)) +
    (tools.length > 0 ? estimateTokens(JSON.stringify(toOpenAiTools(tools))) : 0);
  const budget = groqInputBudget(request.maxTokens);
  return {
    request,
    estimatedTokens,
    budget,
    fits: estimatedTokens <= budget,
    toolsOffered: tools.length,
    toolsDropped: narrowed.dropped,
  };
}

/**
 * One Groq tool pass, or a `GroqFailure` naming why not.
 *
 * ⚠️ The pins are phase 1's, unchanged and deliberately so: the same endpoint,
 * the same model constant, the same 4 s ceiling, the same `max_tokens` floor of
 * 512 and `reasoning_effort: 'low'` (both gpt-oss-specific, both re-argued if
 * the pin ever leaves that family). A tool loop that quietly used a different
 * model from the toolless rung would make `/api/health`'s `gabi_groq_model` row
 * a half-truth.
 */
export async function groqToolComplete(
  apiKey: string,
  req: GroqToolRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GroqToolPass> {
  const body = {
    model: GABI_GROQ_MODEL,
    max_tokens: Math.max(req.maxTokens, GROQ_MIN_MAX_TOKENS),
    reasoning_effort: 'low',
    messages: toOpenAiMessages(req.system, req.messages),
    ...(req.tools.length > 0 ? { tools: toOpenAiTools(req.tools), tool_choice: 'auto' } : {}),
  };

  let res: Response;
  try {
    res = await fetchImpl(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        // The key rides `Authorization` and nowhere else — phase 1's assertion,
        // pinned again for this path.
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

  // ⚠️ The SHARED taxonomy, since 2026-09-02. This branch was a byte-identical
  // copy of phase 1's, which is how one of them would have gained the error body
  // and the other would not.
  const refused = await failureFor(res);
  if (refused) throw refused;

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new GroqFailure('malformed', 'groq answered 200 with a body that is not JSON', 200);
  }

  return blocksFromCompletion(payload, req.tools);
}
