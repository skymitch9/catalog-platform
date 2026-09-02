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
import type { GabiTool } from './gabi-tools.js';

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
        const body = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? null);
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
