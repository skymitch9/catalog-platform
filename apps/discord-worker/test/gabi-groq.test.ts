/**
 * **THE GROQ FIRST-LINE RUNG** (`src/gabi-groq.ts`, owner ask 2026-09-01).
 *
 * The properties worth a build failure, in the order they matter:
 *
 *  1. ⚠️ **`off` is byte-identical to yesterday.** Not "makes no Groq request" —
 *     *builds no prompt*. The `turn` thunk is asserted never to be invoked, so
 *     the property is about the code that RUNS, not about the network.
 *  2. ⚠️ **Every failure class falls through and the answer still arrives.**
 *     Nine of them, table-driven. A person must not be able to tell.
 *  3. ⚠️ **`shadow` uses HAIKU's answer and never Groq's.** This is the whole
 *     difference between the two live postures, and it is one boolean away from
 *     silently becoming an unreviewed model swap.
 *  4. ⚠️ **A tool turn never reaches Groq, in ANY posture.** The scope rule is
 *     structural (phase 2 owns the tool-schema translation) and a future
 *     "just wire it up everywhere" fails here.
 *  5. ⚠️ **The validators are SHARED, not duplicated.** A Groq reply that would
 *     have been rejected on the Anthropic path is rejected here too.
 *
 * ⚠️ **NO LIVE GROQ CALL HAS EVER BEEN MADE FROM THIS REPO.** Every test below
 * drives an injected `fetch`. Nothing here proves Groq accepts what is built —
 * only that what is built is what was intended.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  GABI_GROQ_MODEL,
  GROQ_CHAT_URL,
  GROQ_ERROR_TEXT_MAX,
  GROQ_MIN_MAX_TOKENS,
  GROQ_TIMEOUT_MS,
  groqComplete,
  GroqFailure,
  groqLive,
  groqMode,
  groqRung,
  viaGroq,
  type GroqReason,
} from '../src/gabi-groq.js';
import {
  blocksFromCompletion,
  capToolResult,
  estimateTokens,
  fitGroqRequest,
  groqInputBudget,
  groqToolComplete,
  GROQ_TOOL_DESCRIPTION_MAX,
  GROQ_TOOL_RESULT_MAX,
  GROQ_TPM_LIMIT,
  invalidToolArgs,
  leanTools,
  narrowToFamilies,
  toOpenAiMessages,
  toOpenAiTools,
  TOOL_ERROR_PREFIX,
  type WireTool,
} from '../src/gabi-groq-tools.js';
import {
  GABI_CONFIRM_VERB_NAMES,
  GABI_DELEGATED_VERB_NAMES,
  GROQ_READ_ONLY_TOOL_NAMES,
  groqBlockedTools,
  isGroqEligibleToolName,
  toolsForApi,
} from '../src/gabi-tools.js';
import { classifyIntent, converse, converseWithTools } from '../src/gabi-chat.js';
import { parseFixRequest } from '../src/confirm-propose.js';
import { distillConversation } from '../src/memory-distill.js';
import { DISTILL_SYSTEM, type MemoryPort, type MemoryProfile } from '../src/memory.js';

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

interface Seen {
  url: string;
  init: RequestInit | undefined;
}

/** A `fetch` stand-in that records every call and answers per host. Anything it
 *  was not told about is a loud failure rather than a silent 200 — a test that
 *  forgets to install a handler must not pass by accident. */
function spyFetch(handlers: {
  groq?: (init: RequestInit | undefined) => Response | Promise<Response>;
  anthropic?: (init: RequestInit | undefined) => Response | Promise<Response>;
  /** ⚠️ Phase 2: a tool loop actually EXECUTES tools, and `catalog_lookup` reads
   *  the shelf CSV. Routed separately so `anthropicCalls()` keeps counting model
   *  turns and nothing else — a catalogue read miscounted as a Haiku turn would
   *  make "did Groq answer alone?" unanswerable. */
  catalog?: (init: RequestInit | undefined) => Response | Promise<Response>;
}): { fetch: typeof fetch; calls: Seen[]; groqCalls: () => Seen[]; anthropicCalls: () => Seen[] } {
  const calls: Seen[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });
    if (url.includes('api.groq.com')) {
      if (!handlers.groq) throw new Error(`unexpected Groq call in this test: ${url}`);
      return handlers.groq(init);
    }
    if (url.includes('catalog.test')) {
      if (!handlers.catalog) throw new Error(`unexpected catalogue read in this test: ${url}`);
      return handlers.catalog(init);
    }
    if (!handlers.anthropic) throw new Error(`unexpected Anthropic call in this test: ${url}`);
    return handlers.anthropic(init);
  }) as unknown as typeof fetch;
  return {
    fetch: impl,
    calls,
    groqCalls: () => calls.filter((c) => c.url.includes('api.groq.com')),
    anthropicCalls: () =>
      calls.filter((c) => !c.url.includes('api.groq.com') && !c.url.includes('catalog.test')),
  };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Groq's OpenAI-shaped 200. */
const groqSaid = (text: string): Response =>
  json({
    id: 'chatcmpl-1',
    model: GABI_GROQ_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: 12 },
  });

/** Anthropic's Messages 200. */
const haikuSaid = (text: string): Response =>
  json({
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 4 },
  });

const WHO = { discordUserId: '42', guildId: '100' };
const CHATTER = { ...WHO, authorName: 'Sam' };

/** Silence the structured log lines so a table-driven run stays readable, and
 *  hand back what was written so a test can assert on it. */
function captureLogs<T>(body: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => void lines.push(a.map(String).join(' '));
  return body()
    .then((value) => ({ value, lines }))
    .finally(() => {
      console.log = log;
      console.error = err;
    });
}

// ---------------------------------------------------------------------------
// 1. The posture, and it fails closed
// ---------------------------------------------------------------------------

describe('groqMode — fail closed, always', () => {
  it('accepts exactly the three modes, and forgives only case and whitespace', () => {
    assert.equal(groqMode({ GABI_GROQ: 'off' }), 'off');
    assert.equal(groqMode({ GABI_GROQ: 'shadow' }), 'shadow');
    assert.equal(groqMode({ GABI_GROQ: 'first' }), 'first');
    assert.equal(groqMode({ GABI_GROQ: '  FIRST  ' }), 'first');
    assert.equal(groqMode({ GABI_GROQ: 'Shadow' }), 'shadow');
  });

  it('⚠️ every other value is OFF — absent, empty, affirmative-looking, or a typo', () => {
    // ⚠️ `"on"` and `"true"` are the dangerous ones: they are what somebody who
    // knows this Worker's OTHER postures would type, and guessing them into
    // `first` would enable an unreviewed model swap by typo.
    for (const raw of [undefined, '', '   ', 'on', 'true', '1', 'yes', 'firs', 'firstly', 'shadowing', 'FIRST!']) {
      assert.equal(groqMode({ GABI_GROQ: raw }), 'off', `"${String(raw)}" must coerce to off`);
    }
  });

  it('groqLive needs BOTH halves — a posture and a key', () => {
    assert.equal(groqLive(undefined), false);
    assert.equal(groqLive({ mode: 'off', apiKey: 'k' }), false, 'a key with the switch off is not a rung');
    assert.equal(groqLive({ mode: 'first' }), false, 'a switch with no key is not a rung');
    assert.equal(groqLive({ mode: 'first', apiKey: '' }), false, 'an empty key is no key');
    assert.equal(groqLive({ mode: 'first', apiKey: 'k' }), true);
    assert.equal(groqLive({ mode: 'shadow', apiKey: 'k' }), true);
  });

  it('groqRung reads both halves off env, and omits an absent key rather than storing ""', () => {
    assert.deepEqual(groqRung({ GABI_GROQ: 'first', GROQ_API_KEY_GABI: 'k' }), { mode: 'first', apiKey: 'k' });
    assert.deepEqual(groqRung({}), { mode: 'off' });
    assert.deepEqual(groqRung({ GABI_GROQ: 'nonsense', GROQ_API_KEY_GABI: 'k' }), { mode: 'off', apiKey: 'k' });
  });
});

// ---------------------------------------------------------------------------
// 2. The pins
// ---------------------------------------------------------------------------

describe('the pins — a silent model change is what these stop', () => {
  it('⚠️ the model id is PINNED — and the pin has already fired once', () => {
    // Groq retires model names faster than a deploy can follow (black_bot_baf's
    // own gotcha), so this is a constant and changing it is a decision somebody
    // makes on purpose — including in `/api/health`, which reports it.
    // ⚠️ Decision of record, 2026-09-01: the inherited pin
    // `llama-3.3-70b-versatile` had been DEPRECATED by Groq on 2026-08-16 —
    // every first-day live shadow line read `refused` 404 — and was repinned to
    // `openai/gpt-oss-120b`, one of Groq's two named replacements (over
    // `qwen/qwen3.6-27b`: the prompt carries a full personality register and
    // strict-JSON parses, where the bigger model is the safer bet).
    assert.equal(GABI_GROQ_MODEL, 'openai/gpt-oss-120b');
  });

  it('the endpoint is the OpenAI-compatible one, not Groq\'s native route', () => {
    assert.equal(GROQ_CHAT_URL, 'https://api.groq.com/openai/v1/chat/completions');
  });

  it('⚠️ the first line\'s timeout is SHORT — a slow first line is worse than a costlier fast one', () => {
    // On `first` a hang costs the person this PLUS the whole 20s Haiku turn.
    assert.ok(GROQ_TIMEOUT_MS <= 5_000, `${GROQ_TIMEOUT_MS}ms is too long for a first line on Discord`);
  });
});

// ---------------------------------------------------------------------------
// 3. The client
// ---------------------------------------------------------------------------

describe('groqComplete — the request shape, and one failure type out', () => {
  const turn = { system: 'be warm', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 400 };

  it('posts the OpenAI body: pinned model, system first, messages after', async () => {
    const spy = spyFetch({ groq: () => groqSaid('hello') });
    const answer = await groqComplete('secret-groq-key', turn, spy.fetch);
    assert.equal(answer.text, 'hello');
    assert.equal(answer.inputTokens, 30);
    assert.equal(answer.outputTokens, 12);
    const call = spy.groqCalls()[0]!;
    assert.equal(call.url, GROQ_CHAT_URL);
    const body = JSON.parse(String(call.init?.body)) as Record<string, unknown>;
    assert.equal(body.model, GABI_GROQ_MODEL);
    // ⚠️ Decision of record, 2026-09-01 evening — measured on the first
    // successful live Groq turn: `converse` answered on Groq while `classify`
    // fell back with an EMPTY 200 on every call, because gpt-oss-120b is a
    // reasoning model and a classification-sized cap is spent entirely on
    // thinking. The Groq attempt floors max_tokens (the shared validator still
    // enforces the tiny output shape) and pins reasoning_effort low. Re-argue
    // both if the model pin leaves the gpt-oss family.
    //
    // ⚠️ RAISED 512 → 1024 on 2026-09-02: the owner's live test produced a
    // toolless `converse` that came back empty-with-200 PAST the old floor —
    // 400 words in GABI's register is ~500 output tokens on its own, so 512
    // left a reasoning model nothing to think with. Asserted against the
    // exported constant rather than a literal, so the pin has one home.
    assert.equal(
      body.max_tokens,
      GROQ_MIN_MAX_TOKENS,
      'a small caller cap is floored for the reasoning model',
    );
    assert.equal(GROQ_MIN_MAX_TOKENS, 1024, 'the floor is the measured 2026-09-02 value');
    assert.equal(body.reasoning_effort, 'low');
    assert.deepEqual(body.messages, [
      { role: 'system', content: 'be warm' },
      { role: 'user', content: 'hi' },
    ]);
    assert.equal(body.response_format, undefined, 'a prose call must not ask for json_object');
  });

  it('⚠️ the key rides the Authorization header and nothing else', async () => {
    const spy = spyFetch({ groq: () => groqSaid('hi') });
    await groqComplete('secret-groq-key', turn, spy.fetch);
    const call = spy.groqCalls()[0]!;
    const headers = call.init?.headers as Record<string, string>;
    assert.equal(headers.authorization, 'Bearer secret-groq-key');
    assert.doesNotMatch(String(call.init?.body), /secret-groq-key/, 'the key must never reach the body');
    assert.doesNotMatch(call.url, /secret-groq-key/, 'the key must never reach the URL');
  });

  it('asks for json_object ONLY when the prompt actually says "JSON"', async () => {
    // ⚠️ `json_object` is a 400 when the prompt never mentions JSON — which
    // would be a permanent, silent fall-through wearing the face of an outage.
    const withWord = spyFetch({ groq: () => groqSaid('{}') });
    await groqComplete('k', { ...turn, system: 'Reply as JSON.', json: true }, withWord.fetch);
    assert.deepEqual(JSON.parse(String(withWord.groqCalls()[0]!.init?.body)).response_format, {
      type: 'json_object',
    });

    const without = spyFetch({ groq: () => groqSaid('{}') });
    await groqComplete('k', { ...turn, system: 'be warm', json: true }, without.fetch);
    assert.equal(
      JSON.parse(String(without.groqCalls()[0]!.init?.body)).response_format,
      undefined,
      'without the word it must degrade to plain mode, never send a guaranteed 400',
    );
  });

  it('⚠️ both JSON call sites\' prompts still say "JSON" — the guard above has teeth only if they do', () => {
    // If a prompt edit drops the word, the rung silently stops asking for strict
    // JSON on that call site. These are the assertions that make that visible.
    assert.match(DISTILL_SYSTEM, /json/i);
    // `PARSE_SYSTEM` is module-private on purpose (nothing outside the confirm
    // lane may reuse it), so this reads the source the way the credential-seam
    // tests in `mentions.test.ts` do.
    const parseSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/confirm-propose.ts'),
      'utf8',
    );
    const prompt = parseSrc.slice(parseSrc.indexOf('const PARSE_SYSTEM'));
    assert.match(prompt.slice(0, prompt.indexOf('`;')), /json/i);
  });

  it('each status becomes the reason that decides what the ladder logs', async () => {
    const table: [number, GroqReason][] = [
      [429, 'rate_limited'],
      [401, 'refused'],
      [400, 'refused'],
      [404, 'refused'],
      // ⚠️ 413 IS ITS OWN REASON since 2026-09-02. It read `refused` before,
      // in the same bucket as a bad key and a retired model id, so the owner's
      // live test produced a wall of identical lines with three different fixes
      // behind them. A 413 is "bigger than your tier may send", never "wrong".
      [413, 'too_large'],
      [500, 'server'],
      [502, 'server'],
    ];
    for (const [status, reason] of table) {
      const spy = spyFetch({ groq: () => json({ error: 'x' }, status) });
      await assert.rejects(
        () => groqComplete('k', turn, spy.fetch),
        (err: unknown) => {
          assert.ok(err instanceof GroqFailure);
          assert.equal(err.reason, reason, `status ${status}`);
          assert.equal(err.status, status);
          return true;
        },
      );
    }
  });

  // ── ⚠️ THE ERROR BODY, and why it is a test rather than a comment ─────────
  // Measured 2026-09-02, the owner's first live test: one `converse` fallback
  // read `reason: "refused", status: 400` and NOTHING else. A 400 says the
  // request was malformed and the response body says HOW, and the body was
  // being dropped on the floor at the `res.status !== 200` line. Every 413 in
  // the same run carried its own limit and requested size, and lost them the
  // same way.
  it('⚠️ Groq\'s refusal TEXT is captured, flattened and truncated', async () => {
    const long = `{"error":{"message":"${'x'.repeat(400)}"}}`;
    const spy = spyFetch({ groq: () => new Response(long, { status: 400 }) });
    await assert.rejects(
      () => groqComplete('k', turn, spy.fetch),
      (err: unknown) => {
        assert.ok(err instanceof GroqFailure);
        assert.equal(err.errorText?.length, GROQ_ERROR_TEXT_MAX);
        assert.ok(err.errorText?.endsWith('…'), 'a truncation is MARKED, never silent');
        return true;
      },
    );

    // A short body survives whole, and its newlines are flattened so the line
    // stays one line — `wrangler tail | jq` reads lines, not paragraphs.
    const spy2 = spyFetch({
      groq: () => new Response('{"error":{\n  "message": "Request too large"\n}}', { status: 413 }),
    });
    await assert.rejects(
      () => groqComplete('k', turn, spy2.fetch),
      (err: unknown) => {
        assert.ok(err instanceof GroqFailure);
        assert.equal(err.reason, 'too_large');
        assert.equal(err.errorText, '{"error":{ "message": "Request too large" }}');
        return true;
      },
    );
  });

  it('⚠️ an unreadable refusal body is `undefined`, never a thrown error', async () => {
    // A first line whose ERROR HANDLING costs somebody an answer is worse than
    // the missing diagnosis it was added to fix.
    const hostile = new Response('x', { status: 400 });
    Object.defineProperty(hostile, 'text', {
      value: () => Promise.reject(new Error('body already consumed')),
    });
    const spy = spyFetch({ groq: () => hostile });
    await assert.rejects(
      () => groqComplete('k', turn, spy.fetch),
      (err: unknown) => {
        assert.ok(err instanceof GroqFailure);
        assert.equal(err.reason, 'refused');
        assert.equal(err.errorText, undefined);
        return true;
      },
    );
  });

  it('⚠️ the refusal text reaches the LOG LINE — both places, or it does not exist', async () => {
    // ⚠️ THE FIELD-BY-FIELD LESSON, asserted rather than commented. `logGroq`
    // builds its output key by key and silently drops anything its emitted
    // object does not name: a `status` fix shipped as a no-op exactly this way
    // on 2026-09-01, and phase 2 had to fix the same class again on 09-02.
    const spy = spyFetch({
      groq: () => new Response('{"error":{"message":"Request too large for model"}}', { status: 413 }),
      anthropic: () => haikuSaid('haiku picked it up'),
    });
    const { value, lines } = await captureLogs(() =>
      converse('ak', 'hi', null, CHATTER, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'gk' },
      }),
    );
    assert.equal(value, 'haiku picked it up', 'the person still gets an answer');
    const line = lines.map((l) => JSON.parse(l) as Record<string, unknown>).find((l) => l.evt === 'gabi_groq');
    assert.equal(line?.outcome, 'fallback');
    assert.equal(line?.reason, 'too_large');
    assert.equal(line?.status, 413);
    assert.match(String(line?.error_text), /Request too large for model/);
  });

  it('⚠️ a 200 with no words in it is a FAILURE, never a silent blank', async () => {
    for (const payload of [
      { choices: [{ message: { content: '' } }] },
      { choices: [{ message: { content: '   ' } }] },
      { choices: [] },
      {},
    ]) {
      const spy = spyFetch({ groq: () => json(payload) });
      await assert.rejects(
        () => groqComplete('k', turn, spy.fetch),
        (err: unknown) => err instanceof GroqFailure && err.reason === 'empty',
      );
    }
  });

  it('a 200 that is not JSON is `malformed`, not a crash', async () => {
    const spy = spyFetch({ groq: () => new Response('<html>gateway</html>', { status: 200 }) });
    await assert.rejects(
      () => groqComplete('k', turn, spy.fetch),
      (err: unknown) => err instanceof GroqFailure && err.reason === 'malformed',
    );
  });

  it('a transport error is wrapped at the boundary, and an abort is its own reason', async () => {
    const timedOut = spyFetch({
      groq: () => {
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      },
    });
    await assert.rejects(
      () => groqComplete('k', turn, timedOut.fetch),
      (err: unknown) => err instanceof GroqFailure && err.reason === 'timeout',
    );

    const dead = spyFetch({
      groq: () => {
        throw new TypeError('fetch failed');
      },
    });
    await assert.rejects(
      () => groqComplete('k', turn, dead.fetch),
      (err: unknown) => err instanceof GroqFailure && err.reason === 'unreachable',
    );
  });

  it('the first choice WITH words wins, so a blank leading choice is skipped', async () => {
    const spy = spyFetch({
      groq: () =>
        json({
          choices: [{ message: { content: '' } }, { message: { content: 'later' } }],
        }),
    });
    assert.equal((await groqComplete('k', turn, spy.fetch)).text, 'later');
  });
});

// ---------------------------------------------------------------------------
// 4. `off` — the property the whole ladder rests on
// ---------------------------------------------------------------------------

describe('⚠️ posture OFF reaches no Groq code at all', () => {
  it('does not even BUILD the prompt — the turn thunk is never invoked', async () => {
    let built = 0;
    const spy = spyFetch({});
    const out = await viaGroq<string>({
      rung: { mode: 'off', apiKey: 'k' },
      purpose: 'test',
      turn: () => {
        built += 1;
        return { system: 's', messages: [], maxTokens: 10 };
      },
      validate: (t) => t,
      haiku: async () => 'haiku answered',
      fetchImpl: spy.fetch,
    });
    assert.equal(out, 'haiku answered');
    assert.equal(built, 0, 'the posture is off — no prompt may be constructed');
    assert.equal(spy.calls.length, 0, 'and nothing may be requested');
  });

  it('an absent rung behaves exactly as `off` does', async () => {
    let built = 0;
    const out = await viaGroq<string>({
      rung: undefined,
      purpose: 'test',
      turn: () => {
        built += 1;
        return { system: 's', messages: [], maxTokens: 10 };
      },
      validate: (t) => t,
      haiku: async () => 'haiku answered',
    });
    assert.equal(out, 'haiku answered');
    assert.equal(built, 0);
  });

  it('⚠️ a KEY with the posture off is still off — the switch is the decision', async () => {
    let built = 0;
    await viaGroq<string>({
      rung: { mode: 'off', apiKey: 'a-real-looking-key' },
      purpose: 'test',
      turn: () => {
        built += 1;
        return { system: 's', messages: [], maxTokens: 10 };
      },
      validate: (t) => t,
      haiku: async () => 'haiku',
    });
    assert.equal(built, 0);
  });

  it('a POSTURE with no key is off too — pasting the switch first changes nothing', async () => {
    let built = 0;
    await viaGroq<string>({
      rung: { mode: 'first' },
      purpose: 'test',
      turn: () => {
        built += 1;
        return { system: 's', messages: [], maxTokens: 10 };
      },
      validate: (t) => t,
      haiku: async () => 'haiku',
    });
    assert.equal(built, 0);
  });

  it('and the real call sites make ZERO Groq requests with the posture off', async () => {
    const spy = spyFetch({ anthropic: () => haikuSaid('smalltalk') });
    const out = await captureLogs(() =>
      classifyIntent('anthropic-key', 'hey!', WHO, { fetch: spy.fetch, groq: { mode: 'off', apiKey: 'g' } }),
    );
    assert.equal(out.value, 'smalltalk');
    assert.equal(spy.groqCalls().length, 0);
    assert.equal(spy.anthropicCalls().length, 1);
  });
});

// ---------------------------------------------------------------------------
// 5. `first` — the happy path, and every failure class falling through
// ---------------------------------------------------------------------------

describe('posture FIRST — Groq answers, or Haiku does and nobody can tell', () => {
  it('the happy path: Groq answers, ONE request, and Haiku is never called', async () => {
    const spy = spyFetch({ groq: () => groqSaid('have_lookup') });
    const { value, lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value, 'have_lookup');
    assert.equal(spy.groqCalls().length, 1, 'exactly one attempt — the fallback IS the retry');
    assert.equal(spy.anthropicCalls().length, 0, 'a Groq answer must not also spend a Haiku turn');
    const line = lines.find((l) => l.includes('"evt":"gabi_groq"'));
    assert.ok(line, 'a Groq turn is accounted');
    const entry = JSON.parse(line) as Record<string, unknown>;
    assert.equal(entry.outcome, 'groq');
    assert.equal(entry.model, GABI_GROQ_MODEL);
    assert.equal(entry.input_tokens, 30);
    // ⚠️ NOT a `gabi_turn` line: that event means ANTHROPIC spend and must keep
    // meaning that, or the billing inventory counts free tokens as Haiku ones.
    assert.equal(lines.find((l) => l.includes('"evt":"gabi_turn"')), undefined);
  });

  it('⚠️ EVERY failure class falls through, the answer still arrives, and one line names why', async () => {
    const failures: [string, () => Response, GroqReason][] = [
      ['rate limited', () => json({ error: 'slow down' }, 429), 'rate_limited'],
      ['a refusal', () => json({ error: 'bad key' }, 401), 'refused'],
      ['a retired model', () => json({ error: 'model_decommissioned' }, 400), 'refused'],
      ['a server fault', () => json({ error: 'oops' }, 503), 'server'],
      ['a non-JSON body', () => new Response('<html>', { status: 200 }), 'malformed'],
      ['an empty completion', () => json({ choices: [{ message: { content: '' } }] }), 'empty'],
      ['no choices at all', () => json({}), 'empty'],
      // ⚠️ THE SHARED-VALIDATOR CASE: a perfectly well-formed 200 that does not
      // pass the check the Haiku path would have applied.
      ['an unrecognised bucket', () => groqSaid('probably_a_lookup'), 'invalid'],
    ];
    for (const [name, groq, reason] of failures) {
      const spy = spyFetch({ groq, anthropic: () => haikuSaid('have_lookup') });
      const { value, lines } = await captureLogs(() =>
        classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
          fetch: spy.fetch,
          groq: { mode: 'first', apiKey: 'g' },
        }),
      );
      assert.equal(value, 'have_lookup', `${name}: the person still gets the answer`);
      // ⚠️ ONE attempt for every reason EXCEPT `empty`, which gets exactly two
      // since 2026-09-02 — see the retry test below for the argument. It is
      // still never a loop, and the second attempt is still followed by the
      // same single fall-through.
      assert.equal(
        spy.groqCalls().length,
        reason === 'empty' ? 2 : 1,
        `${name}: one Groq attempt, never a retry loop`,
      );
      assert.equal(spy.anthropicCalls().length, 1, `${name}: exactly one Haiku turn`);
      const line = lines.find((l) => l.includes('"evt":"gabi_groq"'));
      assert.ok(line, `${name}: the fall-through must be one structured line`);
      assert.equal(
        lines.filter((l) => l.includes('"evt":"gabi_groq"')).length,
        1,
        `${name}: one TURN is one LINE, retry or not`,
      );
      const entry = JSON.parse(line) as Record<string, unknown>;
      assert.equal(entry.outcome, 'fallback', name);
      assert.equal(entry.reason, reason, name);
      assert.equal(entry.retried, reason === 'empty' ? true : undefined, name);
    }
  });

  // ── ⚠️ THE ONE RETRY, AND WHY IT IS ONLY `empty` ─────────────────────────
  //
  // Measured in the owner's live test, 2026-09-02: toolless `converse` fell
  // back 2/2 — one `empty` with status 200 (past the old 512 floor) and one
  // `refused` 400 whose body was thrown away. The floor rose to 1024 in the
  // same batch; this is the other half.
  //
  // An `empty` on a REASONING model is not a state. It is a 200 that spent its
  // whole budget thinking and emitted no words — a coin toss, where every other
  // reason is a condition a second identical request would land in again.
  it('⚠️ an EMPTY 200 is retried ONCE, and a second empty still falls through', async () => {
    const empty = () => json({ choices: [{ message: { content: '' } }] });
    const spy = spyFetch({ groq: empty, anthropic: () => haikuSaid('have_lookup') });
    const { value, lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value, 'have_lookup');
    assert.equal(spy.groqCalls().length, 2, 'ONCE — not a loop, not a backoff');
    const entry = JSON.parse(lines.find((l) => l.includes('"evt":"gabi_groq"'))!) as Record<string, unknown>;
    assert.equal(entry.retried, true, 'the frequency must be measurable, not assumed');
  });

  it('⚠️ a retry that SUCCEEDS costs no Haiku turn at all', async () => {
    let n = 0;
    const spy = spyFetch({
      groq: () => (n++ === 0 ? json({ choices: [{ message: { content: '' } }] }) : groqSaid('have_lookup')),
      anthropic: () => haikuSaid('smalltalk'),
    });
    const { value, lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value, 'have_lookup', "Groq's second answer is used");
    assert.equal(spy.anthropicCalls().length, 0, 'the whole point: no Haiku turn was spent');
    const entry = JSON.parse(lines.find((l) => l.includes('"evt":"gabi_groq"'))!) as Record<string, unknown>;
    assert.equal(entry.outcome, 'groq');
    assert.equal(entry.retried, true);
  });

  it('⚠️ the TOOL lane is deliberately NOT retried — the composing pass needs the budget', async () => {
    const spy = spyFetch({
      catalog: catalogDown,
      groq: () => json({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }] }),
      anthropic: () => haikuSaid('Kate Reading and Michael Kramer.'),
    });
    const { value } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value.text, 'Kate Reading and Michael Kramer.');
    assert.equal(spy.groqCalls().length, 1, 'one selection attempt, then Haiku');
  });

  it('a transport failure falls through the same way', async () => {
    const spy = spyFetch({
      groq: () => {
        throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
      },
      anthropic: () => haikuSaid('smalltalk'),
    });
    const { value, lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'hey', WHO, { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } }),
    );
    assert.equal(value, 'smalltalk');
    const entry = JSON.parse(lines.find((l) => l.includes('"evt":"gabi_groq"'))!) as Record<string, unknown>;
    assert.equal(entry.reason, 'timeout');
  });

  it('⚠️ a validator that THROWS cannot cost the person the Haiku answer', async () => {
    const spy = spyFetch({ groq: () => groqSaid('anything') });
    const out = await captureLogs(() =>
      viaGroq<string>({
        rung: { mode: 'first', apiKey: 'g' },
        purpose: 'test',
        turn: () => ({ system: 's', messages: [], maxTokens: 10 }),
        validate: () => {
          throw new Error('a bug in the validator');
        },
        haiku: async () => 'haiku answered',
        fetchImpl: spy.fetch,
      }),
    );
    assert.equal(out.value, 'haiku answered');
  });

  it('⚠️ the Groq reply is NOT logged — these are household conversations', async () => {
    const secret = 'my daughter is reading Fourth Wing and I am worried about it';
    const spy = spyFetch({ groq: () => groqSaid(secret) });
    const { value, lines } = await captureLogs(() =>
      converse('anthropic-key', 'how is she doing?', null, CHATTER, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value, secret, 'the person gets the answer');
    for (const line of lines) {
      assert.doesNotMatch(line, /Fourth Wing/, 'no log line may carry the text of a reply');
    }
    const entry = JSON.parse(lines.find((l) => l.includes('"evt":"gabi_groq"'))!) as Record<string, unknown>;
    assert.equal(entry.chars, secret.length, 'how MUCH was said is logged; what was said is not');
  });

  it('a blank Groq prose reply falls through, rather than becoming a silent nothing', async () => {
    const spy = spyFetch({
      groq: () => json({ choices: [{ message: { content: '' } }] }),
      anthropic: () => haikuSaid('here you go'),
    });
    const { value } = await captureLogs(() =>
      converse('anthropic-key', 'hi', null, CHATTER, { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } }),
    );
    assert.equal(value, 'here you go');
  });
});

// ---------------------------------------------------------------------------
// 6. `shadow` — measured, discarded
// ---------------------------------------------------------------------------

describe('⚠️ posture SHADOW — Groq is measured and DISCARDED; Haiku answers', () => {
  it('both are called, and the answer is HAIKU\'s even when Groq answered well', async () => {
    const spy = spyFetch({
      groq: () => groqSaid('smalltalk'),
      anthropic: () => haikuSaid('have_lookup'),
    });
    const { value } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'shadow', apiKey: 'g' },
      }),
    );
    assert.equal(value, 'have_lookup', 'shadow must NEVER return the Groq answer');
    assert.equal(spy.groqCalls().length, 1);
    assert.equal(spy.anthropicCalls().length, 1);
  });

  it('logs ONE comparison line: latencies, lengths, did-it-answer, agreement — never the texts', async () => {
    const spy = spyFetch({
      groq: () => groqSaid('smalltalk'),
      anthropic: () => haikuSaid('have_lookup'),
    });
    const { lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'shadow', apiKey: 'g' },
      }),
    );
    const shadow = lines.filter((l) => l.includes('"evt":"gabi_groq_shadow"'));
    assert.equal(shadow.length, 1, 'exactly one comparison line per turn');
    const entry = JSON.parse(shadow[0]!) as Record<string, unknown>;
    assert.equal(entry.purpose, 'classify');
    assert.equal(entry.groq_answered, true);
    assert.equal(entry.haiku_answered, true);
    // ⚠️ The number the owner is actually deciding on: did the cheap model route
    // this turn the same way? A bucket name is our vocabulary, never theirs.
    assert.equal(entry.agreed, false, 'smalltalk vs have_lookup is a disagreement');
    assert.equal(typeof entry.groq_ms, 'number');
    assert.equal(typeof entry.haiku_ms, 'number');
  });

  it('agreement reads true when both routed the same way', async () => {
    const spy = spyFetch({ groq: () => groqSaid('have_lookup'), anthropic: () => haikuSaid('have_lookup') });
    const { lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'shadow', apiKey: 'g' },
      }),
    );
    const entry = JSON.parse(lines.find((l) => l.includes('gabi_groq_shadow'))!) as Record<string, unknown>;
    assert.equal(entry.agreed, true);
  });

  it('⚠️ a Groq FAILURE in shadow changes nothing a person sees, and is named in the line', async () => {
    const spy = spyFetch({ groq: () => json({ error: 'x' }, 429), anthropic: () => haikuSaid('have_lookup') });
    const { value, lines } = await captureLogs(() =>
      classifyIntent('anthropic-key', 'do we have Mistborn?', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'shadow', apiKey: 'g' },
      }),
    );
    assert.equal(value, 'have_lookup');
    const entry = JSON.parse(lines.find((l) => l.includes('gabi_groq_shadow'))!) as Record<string, unknown>;
    assert.equal(entry.groq_answered, false);
    assert.equal(entry.reason, 'rate_limited');
    assert.equal(entry.agreed, undefined, 'there is nothing to agree with when nothing came back');
  });

  it('⚠️ prose turns carry NO agreement bit — two free replies are never string-equal', async () => {
    const spy = spyFetch({ groq: () => groqSaid('a lovely answer'), anthropic: () => haikuSaid('another one') });
    const { value, lines } = await captureLogs(() =>
      converse('anthropic-key', 'hi', null, CHATTER, { fetch: spy.fetch, groq: { mode: 'shadow', apiKey: 'g' } }),
    );
    assert.equal(value, 'another one');
    const entry = JSON.parse(lines.find((l) => l.includes('gabi_groq_shadow'))!) as Record<string, unknown>;
    assert.equal(entry.agreed, undefined);
    assert.equal(entry.groq_chars, 'a lovely answer'.length);
    assert.equal(entry.haiku_chars, 'another one'.length);
  });
});

// ---------------------------------------------------------------------------
// 7. ⚠️ PHASE 2 (2026-09-02) — THE ANTHROPIC↔OPENAI TOOL TRANSLATION
//
// Phase 1 shipped with a build-failing test here asserting that a tool loop
// NEVER reached api.groq.com, in any posture. That guard has been REPLACED
// rather than deleted, and by a stricter set: a tool loop now rides Groq only
// under `first`, only when every tool it offers is on the read-only allowlist,
// and never under `shadow` — because shadowing a tool loop would run the loop
// twice and EXECUTE EVERY TOOL TWICE with it.
// ---------------------------------------------------------------------------

/** Groq's OpenAI-shaped 200 carrying tool calls. */
const groqCalled = (calls: { id: string; name: string; args: unknown }[], text = ''): Response =>
  json({
    id: 'chatcmpl-2',
    model: GABI_GROQ_MODEL,
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: text,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            // ⚠️ A JSON STRING, which is the contract and the commonest thing a
            // hand-rolled translation gets wrong in both directions.
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        },
      },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
  });

/** Anthropic's Messages 200 carrying `tool_use` blocks. */
const haikuCalled = (calls: { id: string; name: string; args: unknown }[]): Response =>
  json({
    id: 'm',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-4-5-20251001',
    content: calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 4 },
  });

/** Answers a queue in order and REFUSES a call it has no answer for — a loop
 *  that goes round once too often must fail loudly, not reuse the last reply. */
function inOrder(responses: (() => Response)[]): () => Response {
  let at = 0;
  return () => {
    const next = responses[at++];
    if (!next) throw new Error(`unexpected extra model call (#${at}) in this test`);
    return next();
  };
}

/**
 * ⚠️ The catalogue read FAILS on purpose throughout this section, for two
 * reasons. It is deterministic — `loadCatalog` caches a SUCCESS for 30 minutes
 * inside one isolate, so a passing read in one test would leak into the next —
 * and it exercises the half of the translation that has no OpenAI equivalent at
 * all: `is_error`.
 */
const catalogDown = (): Response => new Response('nope', { status: 503 });

const toolCtxFor = (spy: { fetch: typeof fetch }) => ({
  catalogBaseUrl: 'https://catalog.test',
  fetchOverride: spy.fetch,
});

const ASKED = 'who narrates The Way of Kings?';
const CHATTER_TOOLS = { ...WHO, authorName: 'Sam' };
const groqLines = (lines: string[]): Record<string, unknown>[] =>
  lines
    .filter((l) => l.includes('"evt":"gabi_groq"'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe('⚠️ THE ELIGIBILITY ALLOWLIST — read-only names, written out, default-deny', () => {
  const everything = toolsForApi({ docs: true, books: true, shelf: true, recall: true });

  it('every allowlisted name is a tool that is actually OFFERED — no stale entries', () => {
    const offered = new Set(everything.map((t) => t.name));
    for (const name of GROQ_READ_ONLY_TOOL_NAMES) {
      assert.ok(
        offered.has(name),
        `"${name}" is on GROQ_READ_ONLY_TOOL_NAMES but no longer exists as an offered tool. ` +
          'A stale allowlist entry is dead weight at best and a name somebody re-uses at worst.',
      );
    }
  });

  it('⚠️ NO delegated or confirm verb can ever be on it', () => {
    for (const verb of [...GABI_DELEGATED_VERB_NAMES, ...GABI_CONFIRM_VERB_NAMES]) {
      assert.equal(
        isGroqEligibleToolName(verb),
        false,
        `"${verb}" WRITES (or is chosen by a router, never offered to a model). A write a cheap ` +
          'model may choose is a write that happens when a cheap model misreads a sentence.',
      );
    }
  });

  it('default-deny: an invented name, and the classic prototype holes, are all refused', () => {
    for (const junk of ['set_narrator', 'toString', '__proto__', 'constructor', '', 'CATALOG_LOOKUP']) {
      assert.equal(isGroqEligibleToolName(junk), false, `"${junk}" must not be eligible`);
    }
    assert.equal(isGroqEligibleToolName(undefined), false);
  });

  it('⚠️ ONE unlisted tool takes the WHOLE loop off Groq — not merely that turn', () => {
    // The gate is per LOOP by design: a loop carrying a mutating tool also
    // carries the conversation state that decides whether to call it, so letting
    // its "safe" turns ride Groq would put the cheap model in the seat that
    // PROPOSES the write.
    // ⚠️ **`count_phrase` IS DELIBERATELY NOT ON THE ALLOWLIST** (2026-09-03,
    // design §4.3 of `gabi-phrase-count-and-read-state.md`: *"Groq: out — tools
    // stay on Anthropic"*). It is read-only like the rest; what keeps it off is
    // the ANSWER it produces — a single number a person will quote back, over a
    // spoiler bound, from a text they cannot check. That is the shape least
    // suited to the cheap rung.
    //
    // ⚠️ **The consequence, stated because it is larger than one tool:** the
    // book tools are offered as a family, so a books turn now carries an
    // unlisted name and the WHOLE book loop stays on Anthropic. That is the
    // per-loop gate working as designed, not a side effect to be tidied away —
    // and it is why this assertion names the tool instead of being deleted.
    assert.deepEqual(groqBlockedTools(everything), ['count_phrase'], 'the allowlist has drifted');
    assert.deepEqual(groqBlockedTools([...everything, { name: 'fix-field' }]), [
      'count_phrase',
      'fix-field',
    ]);
    assert.deepEqual(groqBlockedTools([{ name: 'add-isbn' }, { name: 'catalog_lookup' }]), ['add-isbn']);
  });
});

describe('the schema conversion — Anthropic tools → OpenAI functions', () => {
  const tools = toolsForApi({ docs: true }) as WireTool[];

  it('wraps each tool as {type:"function", function:{name, description, parameters}}', () => {
    const wired = toOpenAiTools(tools);
    assert.equal(wired.length, tools.length);
    for (const [i, t] of tools.entries()) {
      const w = wired[i]!;
      assert.equal(w.type, 'function');
      assert.equal(w.function.name, t.name);
      assert.equal(w.function.description, t.description);
      // ⚠️ The SAME object, not a copy. A hand-rebuilt schema is a second place
      // for the tool's contract to live, and the two drift the first time
      // somebody adds a property.
      assert.equal(w.function.parameters, t.input_schema);
    }
  });

  it('the required/enum/additionalProperties detail survives untouched', () => {
    const lookup = toOpenAiTools(tools).find((t) => t.function.name === 'catalog_lookup')!;
    assert.equal(lookup.function.parameters.additionalProperties, false);
    assert.deepEqual(lookup.function.parameters.properties.mode?.enum, ['list', 'count']);
    const series = toOpenAiTools(tools).find((t) => t.function.name === 'series_volumes')!;
    assert.deepEqual(series.function.parameters.required, ['series']);
  });
});

describe('the message translation — tool_use ↔ tool_calls, tool_result → role:"tool"', () => {
  const conversation = [
    { role: 'user' as const, content: ASKED },
    {
      role: 'assistant' as const,
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 'call_a', name: 'catalog_lookup', input: { query: 'Way of Kings' } },
        { type: 'tool_use', id: 'call_b', name: 'series_volumes', input: { series: 'Stormlight' } },
      ],
    },
    {
      role: 'user' as const,
      content: [
        { type: 'tool_result', tool_use_id: 'call_a', content: '{"total_matches":1}' },
        { type: 'tool_result', tool_use_id: 'call_b', content: '{"error":"unreachable"}', is_error: true },
      ],
    },
  ];

  it('the system prompt leads, and a plain string message is passed through untouched', () => {
    const out = toOpenAiMessages('be warm', conversation);
    assert.deepEqual(out[0], { role: 'system', content: 'be warm' });
    assert.deepEqual(out[1], { role: 'user', content: ASKED });
  });

  it('⚠️ tool_use becomes tool_calls with arguments as a JSON STRING', () => {
    const assistant = toOpenAiMessages('s', conversation).find((m) => m.role === 'assistant')!;
    assert.equal(assistant.content, 'let me look');
    assert.equal(assistant.tool_calls?.length, 2);
    const first = assistant.tool_calls![0]!;
    assert.equal(first.id, 'call_a');
    assert.equal(first.type, 'function');
    assert.equal(first.function.name, 'catalog_lookup');
    assert.equal(typeof first.function.arguments, 'string', 'an OBJECT here is a 400');
    assert.deepEqual(JSON.parse(first.function.arguments), { query: 'Way of Kings' });
  });

  it('⚠️ EVERY result comes back, keyed by a matching tool_call_id, in order', () => {
    // Anthropic states this invariant as "one user message carrying ALL of this
    // turn's tool_results"; OpenAI states it as "one tool message per emitted
    // call, immediately after the assistant message". Same rule, and a missing
    // one is a 400 that eats somebody's answer on either provider.
    const out = toOpenAiMessages('s', conversation);
    const assistantAt = out.findIndex((m) => m.role === 'assistant');
    const answers = out.slice(assistantAt + 1).filter((m) => m.role === 'tool');
    assert.deepEqual(
      answers.map((m) => m.tool_call_id),
      ['call_a', 'call_b'],
    );
    assert.deepEqual(
      out.slice(assistantAt + 1, assistantAt + 3).map((m) => m.role),
      ['tool', 'tool'],
      'the answers must sit immediately after the calls they answer',
    );
  });

  it('⚠️ is_error becomes PLAIN TEXT the model can read — it is never dropped', () => {
    // OpenAI has nowhere to put the flag. Dropping it would teach the model that
    // an outage and an absence are the same thing, which on this surface is the
    // difference between "the house does not own it" and a wrong answer.
    const failed = toOpenAiMessages('s', conversation).find((m) => m.tool_call_id === 'call_b')!;
    assert.ok(failed.content.startsWith(TOOL_ERROR_PREFIX), failed.content);
    assert.match(failed.content, /unreachable/);
    const fine = toOpenAiMessages('s', conversation).find((m) => m.tool_call_id === 'call_a')!;
    assert.equal(fine.content, '{"total_matches":1}', 'a SUCCESS must not wear the error prefix');
  });

  it('an assistant turn with neither text nor calls becomes a placeholder, never empty', () => {
    // An assistant message with no content at all is a 400 on both providers —
    // the same reason `converseWithTools` substitutes "(cut off)" on its own side.
    const out = toOpenAiMessages('s', [{ role: 'assistant', content: [] }]);
    assert.equal(out[1]?.content, '(cut off)');
  });

  it('a prose block riding with the results stays a USER message, and goes AFTER them', () => {
    const out = toOpenAiMessages('s', [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'call_a', content: 'ok' },
          { type: 'text', text: 'and also…' },
        ],
      },
    ]);
    assert.deepEqual(
      out.slice(1).map((m) => m.role),
      ['tool', 'user'],
      'a tool answer arriving after a new user sentence reads as stale',
    );
  });
});

describe('reading Groq back — refusing what cannot honestly be executed', () => {
  const offered = toolsForApi({}) as WireTool[];
  const completion = (message: unknown, finish = 'tool_calls'): unknown => ({
    choices: [{ index: 0, finish_reason: finish, message }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  });

  it('tool_calls become Anthropic tool_use blocks with parsed object input', () => {
    const pass = blocksFromCompletion(
      completion({
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'x1', type: 'function', function: { name: 'series_volumes', arguments: '{"series":"Mistborn"}' } },
        ],
      }),
      offered,
    );
    assert.equal(pass.stopReason, 'tool_use');
    assert.deepEqual(pass.blocks, [{ type: 'tool_use', id: 'x1', name: 'series_volumes', input: { series: 'Mistborn' } }]);
  });

  it('⚠️ a pass that produced CALLS is tool_use whatever finish_reason claimed', () => {
    // Read finish_reason alone and a server saying "stop" beside a tool_calls
    // array would have its calls silently dropped and its narration posted as
    // the answer — the 2026-08-18 silent partial, arriving through a new door.
    const pass = blocksFromCompletion(
      completion(
        {
          role: 'assistant',
          content: 'let me check:',
          tool_calls: [
            { id: 'x1', type: 'function', function: { name: 'series_volumes', arguments: '{"series":"M"}' } },
          ],
        },
        'stop',
      ),
      offered,
    );
    assert.equal(pass.stopReason, 'tool_use');
  });

  it('finish_reason "length" maps to max_tokens, so needsFinishing still bites', () => {
    const pass = blocksFromCompletion(
      completion({ role: 'assistant', content: 'found it. Let me read:' }, 'length'),
      offered,
    );
    assert.equal(pass.stopReason, 'max_tokens');
  });

  it('⚠️ a 200 with no words AND no call is a FAILURE, not a silent blank', () => {
    assert.throws(
      () => blocksFromCompletion(completion({ role: 'assistant', content: '' }, 'stop'), offered),
      (err: unknown) => err instanceof GroqFailure && err.reason === 'empty',
    );
  });

  const refusals: [string, unknown][] = [
    [
      'a tool this turn did not offer',
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'add-isbn', arguments: '{}' } }] },
    ],
    [
      'arguments that are not JSON',
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'series_volumes', arguments: 'Mistborn' } }] },
    ],
    [
      'arguments that are a JSON ARRAY rather than an object',
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'series_volumes', arguments: '["Mistborn"]' } }] },
    ],
    [
      'a missing required property',
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'series_volumes', arguments: '{}' } }] },
    ],
    [
      'a property the schema does not declare',
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'series_volumes', arguments: '{"series":"M","limit":5}' } }] },
    ],
    [
      'a value outside an enum',
      { role: 'assistant', content: '', tool_calls: [{ id: 'x', type: 'function', function: { name: 'catalog_lookup', arguments: '{"mode":"everything"}' } }] },
    ],
    [
      'a call with no id',
      { role: 'assistant', content: '', tool_calls: [{ type: 'function', function: { name: 'series_volumes', arguments: '{"series":"M"}' } }] },
    ],
  ];
  for (const [what, message] of refusals) {
    it(`refuses ${what} — reason "invalid", and NOTHING was executed`, () => {
      assert.throws(
        () => blocksFromCompletion(completion(message), offered),
        (err: unknown) => {
          assert.ok(err instanceof GroqFailure, String(err));
          assert.equal(err.reason, 'invalid');
          return true;
        },
      );
    });
  }

  it('invalidToolArgs names the FIRST problem, or null when the arguments are usable', () => {
    const schema = offered.find((t) => t.name === 'catalog_lookup')!.input_schema;
    assert.equal(invalidToolArgs(schema, { query: 'Mistborn', mode: 'count' }), null);
    assert.match(String(invalidToolArgs(schema, { query: 7 })), /should be string/);
    assert.match(String(invalidToolArgs(schema, { nope: 'x' })), /unknown property/);
    assert.match(String(invalidToolArgs(schema, { field: 'publisher' })), /not one of/);
  });

  it('the final tools-free pass sends NO tools key at all', async () => {
    const spy = spyFetch({ groq: () => groqSaid('here is the answer') });
    await groqToolComplete('k', { system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 1024 }, spy.fetch);
    const body = JSON.parse(String(spy.groqCalls()[0]!.init?.body)) as Record<string, unknown>;
    assert.equal(body.tools, undefined, 'offering tools whose results can never run is how a loop goes silent');
    assert.equal(body.tool_choice, undefined);
    // ⚠️ The phase-1 pins, unchanged: same model, same floor, same effort. A tool
    // loop quietly on a different model would make /api/health's row a half-truth.
    assert.equal(body.model, GABI_GROQ_MODEL);
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.reasoning_effort, 'low');
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE 413 CEILING — measured 2026-09-02, and the shaping that answers it
// ---------------------------------------------------------------------------

describe('⚠️ fitting the request to the tier — the 413 the owner met', () => {
  const ALL = toolsForApi({ docs: true, books: true, shelf: true, recall: true });

  it('⚠️ THE DIAGNOSIS: the full 13-tool request does NOT fit the free tier', () => {
    // Measured off the wire in the owner's live test: 12-tool passes refused
    // 413 in ~37 ms, every time; a 6-tool pass at 4,736 input tokens SUCCEEDED.
    // Groq publishes 8,000 TPM for openai/gpt-oss-120b on the free plan, and a
    // single request bigger than the whole minute's allowance can never
    // succeed — so it is refused outright rather than queued, which is exactly
    // that instant refusal.
    assert.equal(GROQ_TPM_LIMIT, 8_000);
    const full = estimateTokens(JSON.stringify(toOpenAiTools(ALL as never)));
    assert.ok(full > 4_000, `13 tool schemas alone are ~${full} tokens`);
    // `max_tokens` is charged against the same allowance, so it is subtracted
    // rather than ignored.
    assert.ok(groqInputBudget(1024) < GROQ_TPM_LIMIT - 1024);
  });

  it('lean schemas cut the tool payload by more than half, Groq-side ONLY', () => {
    const full = JSON.stringify(toOpenAiTools(ALL as never)).length;
    const lean = JSON.stringify(toOpenAiTools(leanTools(ALL as never))).length;
    // Measured 2026-09-02: 16,474 b → 7,522 b, 54% off. Asserted as a ratio
    // rather than a byte count so a new tool does not fail the build for
    // existing.
    assert.ok(lean < full * 0.6, `lean ${lean} b vs full ${full} b`);
    // ⚠️ AND THE ANTHROPIC ARRAY IS UNTOUCHED. The long descriptions are long
    // on purpose — every ⚠️ line in them is a failure this estate has seen —
    // and a shaping pass that mutated the shared definitions would quietly
    // degrade the model that was supposed to be the good one.
    const again = JSON.stringify(toOpenAiTools(ALL as never)).length;
    assert.equal(again, full, 'leanTools must not mutate its input');
  });

  it('a lean description ends on a sentence where it can, and is MARKED where it cannot', () => {
    const [lean] = leanTools([
      {
        name: 'catalog_lookup',
        description: `${'a'.repeat(300)} and more`,
        input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
      },
    ]);
    assert.ok(lean!.description.endsWith('…'), 'a hard cut says so');
    assert.ok(lean!.description.length <= GROQ_TOOL_DESCRIPTION_MAX + 1);
  });

  it('⚠️ a capped tool result is MARKED — a silent truncation reads as an absence', () => {
    const body = 'x'.repeat(GROQ_TOOL_RESULT_MAX + 500);
    const capped = capToolResult(body);
    assert.ok(capped.includes('TRUNCATED'), 'the cut says, in words, that it is a cut');
    assert.match(capped, /never report it as an absence/i);
    // ⚠️ Appended, never substituted: what the model DOES see is real.
    assert.ok(capped.startsWith('x'.repeat(GROQ_TOOL_RESULT_MAX)));
    assert.equal(capToolResult('short'), 'short', 'a result that fits is untouched');
  });

  it('the cap reaches the WIRE, through toOpenAiMessages', () => {
    const out = toOpenAiMessages('sys', [
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'y'.repeat(9_000) }],
      },
    ]);
    const answer = out.find((m) => m.role === 'tool')!;
    assert.ok(answer.content.length < 9_000);
    assert.ok(answer.content.includes('TRUNCATED'));
  });

  it('⚠️ narrowing is by FAMILY, not by tool — the book sequence must survive', () => {
    // The book addendum's own instruction: "list_book_knowledge (always first —
    // it is where book ids come from), THEN search_book_text". Narrowing to
    // "tools already executed" would offer the first and withhold the second,
    // which is the very call the next pass exists to make.
    const after = narrowToFamilies(ALL as never, ['list_book_knowledge']);
    const names = after.tools.map((t) => t.name);
    assert.ok(names.includes('search_book_text'), 'the rest of the family stays');
    assert.ok(names.includes('catalog_lookup'), 'Tier 0 is always kept');
    assert.ok(!names.includes('search_estate_docs'), 'an unused family goes');
    assert.ok(after.dropped.includes('recall_conversation'));
  });

  it('nothing is narrowed on the FIRST pass — the loop knows nothing yet', () => {
    const first = narrowToFamilies(ALL as never, []);
    assert.equal(first.tools.length, ALL.length);
    assert.deepEqual(first.dropped, []);
  });

  it('⚠️ fitGroqRequest turns the measured 413 into a request that FITS', () => {
    const system = 'x'.repeat(11_267); // the measured full system prompt, ~2,817 tok
    const req = {
      system,
      messages: [{ role: 'user' as const, content: 'who narrates The Way of Kings?' }],
      tools: ALL as never,
      maxTokens: 1024,
    };
    const fit = fitGroqRequest(req, []);
    assert.ok(fit.fits, `estimated ${fit.estimatedTokens} against a budget of ${fit.budget}`);
    assert.equal(fit.toolsOffered, ALL.length, 'pass 1 still offers everything');
    // The same request with the FULL schemas would not have fitted — which is
    // the 37 ms refusal, reproduced as arithmetic.
    const unshaped =
      estimateTokens(JSON.stringify(toOpenAiMessages(system, req.messages))) +
      estimateTokens(JSON.stringify(toOpenAiTools(ALL as never)));
    assert.ok(unshaped > fit.budget, `unshaped ${unshaped} > budget ${fit.budget}`);
  });

  it('⚠️ a request that STILL does not fit is refused BEFORE it is sent', async () => {
    // A 413 is cheap but it arrives with no number in it. A pre-flight line
    // saying how far over we were is something the owner can act on.
    const spy = spyFetch({
      catalog: catalogDown,
      anthropic: () => haikuSaid('Kate Reading and Michael Kramer.'),
    });
    const { value, lines } = await captureLogs(() =>
      converseWithTools(
        'anthropic-key',
        // A question so long that nothing can shrink the request enough.
        'who narrates '.repeat(4_000),
        null,
        CHATTER_TOOLS,
        toolCtxFor(spy),
        { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } },
      ),
    );
    assert.equal(value.text, 'Kate Reading and Michael Kramer.', 'the person still gets an answer');
    assert.equal(spy.groqCalls().length, 0, '⚠️ a doomed request is never SENT');
    const fell = groqLines(lines).find((l) => l.outcome === 'fallback')!;
    assert.equal(fell.reason, 'too_large');
    assert.ok(Number(fell.estimated_tokens) > Number(fell.token_budget), 'the line carries both numbers');
  });
});

describe('⚠️ THE TOOL LOOP ON GROQ — gating, and the per-turn fallback', () => {
  // ── ⚠️ THE HYBRID LANE (2026-09-02): GROQ CHOOSES, HAIKU SPEAKS ───────────
  //
  // Phase 2 ran the WHOLE loop on Groq. It shipped on 09-02 and the owner's
  // live test measured two things that changed the design the same day:
  //
  //  1. the one answer that fully rode Groq was FLAT and answered a DIFFERENT
  //     QUESTION than the one asked (chars 273) — composition is the job it is
  //     worst at and the only job the person actually sees;
  //  2. the composing pass is the one that 413s, because it is the pass
  //     carrying every tool result, and the tier's ceiling is 8,000 tokens.
  //
  // So the pass that reads the question and picks the lookups rides Groq; the
  // pass that speaks does not. A quality fix and a payload fix at once.
  it('⚠️ THE HYBRID: Groq picks the tools, Haiku composes — and the tool really ran', async () => {
    const spy = spyFetch({
      catalog: catalogDown,
      groq: () => groqCalled([{ id: 'c1', name: 'catalog_lookup', args: { query: 'The Way of Kings' } }]),
      anthropic: () => haikuSaid('The catalogue could not be reached just now — ask me again in a minute.'),
    });
    const { value, lines } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.match(String(value.text), /could not be reached/);
    assert.deepEqual(value.tools, ['catalog_lookup'], 'the tool really ran');
    assert.equal(spy.groqCalls().length, 1, 'exactly ONE Groq pass: the selection');
    assert.equal(spy.anthropicCalls().length, 1, 'and exactly one Haiku pass: the prose');

    const groq = groqLines(lines);
    assert.deepEqual(
      groq.map((l) => [l.outcome, l.purpose, l.iteration]),
      [['groq', 'converse_tools', 1]],
    );
    // Tier 0 only: this context carries no docs, books, shelf or recall port.
    assert.equal(groq[0]!.tools_offered, 2, 'the tools-bearing pass names how many it offered');
    // ⚠️ The pre-flight numbers ride the SUCCESS line too, so the estimator can
    // be checked against Groq's own prompt_tokens beside it.
    assert.ok(Number(groq[0]!.estimated_tokens) > 0);
    assert.ok(Number(groq[0]!.token_budget) > 0);
    // ⚠️ ONE gabi_turn line, for the ONE Anthropic pass. `gabi_turn` means
    // Anthropic spend and must keep meaning that, or the billing inventory
    // counts free tokens as Haiku ones — so a hybrid turn shows exactly the
    // Haiku half and no more.
    assert.equal(lines.filter((l) => l.includes('"evt":"gabi_turn"')).length, 1);
  });

  it('⚠️ THE HAND-OFF: Haiku inherits the Groq-authored call, keyed to its result', async () => {
    // The state Haiku is handed is byte-identical ANTHROPIC grammar whichever
    // provider produced the tool_use in it — that is the whole reason the
    // translation never touches `messages`. This is the invariant the hybrid
    // rests on: a `tool_use` Groq chose, echoed with the `tool_result` that
    // answers it, and a 400 if the pairing were ever broken.
    const spy = spyFetch({
      catalog: catalogDown,
      groq: () => groqCalled([{ id: 'c1', name: 'catalog_lookup', args: { query: 'The Way of Kings' } }]),
      anthropic: () => haikuSaid('done'),
    });
    await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    const body = JSON.parse(String(spy.anthropicCalls()[0]!.init?.body)) as {
      messages: { role: string; content: unknown }[];
    };
    const assistant = body.messages.find((m) => m.role === 'assistant')!;
    const use = (assistant.content as { type: string; id?: string; name?: string }[]).find(
      (b) => b.type === 'tool_use',
    )!;
    assert.equal(use.id, 'c1', 'the id Groq minted survives into the Anthropic turn');
    assert.equal(use.name, 'catalog_lookup');
    const results = body.messages[body.messages.length - 1]!.content as {
      type: string;
      tool_use_id?: string;
      is_error?: boolean;
    }[];
    assert.equal(results[0]?.type, 'tool_result');
    assert.equal(results[0]?.tool_use_id, 'c1');
    // ⚠️ The catalogue was down, so this result is an ERROR — and it must arrive
    // flagged rather than vanish: a silently-empty result teaches the model that
    // an outage and an absence are the same thing.
    assert.equal(results[0]?.is_error, true);
  });

  const perTurnFailures: [string, () => Response][] = [
    ['a 429', () => json({ error: 'slow down' }, 429)],
    ['a 500', () => json({ error: 'boom' }, 500)],
    ['a body that is not JSON', () => new Response('<html>', { status: 200 })],
    ['an empty 200', () => json({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }] })],
    [
      'a call to a tool that was never offered',
      () => groqCalled([{ id: 'c1', name: 'delete_everything', args: {} }]),
    ],
    [
      'arguments that fail validation',
      () => groqCalled([{ id: 'c1', name: 'series_volumes', args: { nonsense: true } }]),
    ],
  ];
  for (const [what, failure] of perTurnFailures) {
    it(`⚠️ ${what} replays THAT pass on Haiku, from identical state`, async () => {
      const spy = spyFetch({
        catalog: catalogDown,
        groq: failure,
        anthropic: () => haikuSaid('Kate Reading and Michael Kramer.'),
      });
      const { value, lines } = await captureLogs(() =>
        converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
          fetch: spy.fetch,
          groq: { mode: 'first', apiKey: 'g' },
        }),
      );
      // ⚠️ The person cannot tell. That is the requirement, unchanged from phase 1.
      assert.equal(value.text, 'Kate Reading and Michael Kramer.');
      assert.equal(spy.groqCalls().length, 1, 'one attempt, never a retry loop');
      const fell = groqLines(lines).find((l) => l.outcome === 'fallback')!;
      assert.equal(fell.purpose, 'converse_tools');
      assert.equal(fell.iteration, 1);
      assert.ok(typeof fell.reason === 'string' && fell.reason.length > 0, 'the reason is named');
    });
  }

  it('⚠️ the hand-off is one-way: once Haiku has the turn it KEEPS it', async () => {
    // Ping-ponging providers mid-loop would leave a conversation half
    // translated and half native — two grammars to be wrong about instead of
    // one. Under the hybrid the rule is stronger and simpler: the moment a
    // tool has run, every remaining pass is Haiku's, so a loop that goes round
    // three more times makes no further Groq request at all.
    const call = (n: number) => () =>
      haikuCalled([{ id: `h${n}`, name: 'catalog_lookup', args: { query: 'x' } }]);
    const spy = spyFetch({
      catalog: catalogDown,
      groq: () => groqCalled([{ id: 'c1', name: 'catalog_lookup', args: { query: 'The Way of Kings' } }]),
      anthropic: inOrder([call(2), call(3), () => haikuSaid('the shelf is unreachable right now.')]),
    });
    const { value, lines } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value.text, 'the shelf is unreachable right now.');
    assert.equal(spy.groqCalls().length, 1, 'no second attempt once the turn is composing');
    assert.equal(spy.anthropicCalls().length, 3);
    assert.deepEqual(
      groqLines(lines).map((l) => [l.outcome, l.iteration]),
      [['groq', 1]],
    );
  });

  it('⚠️ a Groq answer that trails off mid-thought gets the SAME nudge Haiku gets', async () => {
    // The dangling-colon guard is the 2026-08-18 silent partial's fix and it
    // lives in the loop, on the shared Anthropic-shaped blocks — so it applies
    // to a Groq answer without being re-implemented for it.
    const spy = spyFetch({
      catalog: catalogDown,
      groq: inOrder([() => groqSaid('Perfect — found it. Let me read the section:'), () => groqSaid('Kate Reading.')]),
    });
    const { value } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value.text, 'Kate Reading.', 'the narration must never be posted as the answer');
    assert.equal(spy.groqCalls().length, 2);
  });

  it('⚠️ SHADOW never shadows a tool loop — it would execute every tool twice', async () => {
    const spy = spyFetch({ catalog: catalogDown, anthropic: () => haikuSaid('the catalogue says…') });
    const { value, lines } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'shadow', apiKey: 'g' },
      }),
    );
    assert.equal(value.text, 'the catalogue says…');
    assert.equal(spy.groqCalls().length, 0);
    const line = groqLines(lines)[0]!;
    assert.equal(line.outcome, 'ineligible');
    assert.equal(line.ineligible_reason, 'posture_shadow');
    assert.equal(line.blocked_tools, undefined, 'the tools were fine; the posture was not');
  });

  it('with the posture OFF a tool loop is byte-identical to before the rung existed', async () => {
    const spy = spyFetch({ catalog: catalogDown, anthropic: () => haikuSaid('the catalogue says…') });
    const { value, lines } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'off', apiKey: 'g' },
      }),
    );
    assert.equal(value.text, 'the catalogue says…');
    assert.equal(spy.groqCalls().length, 0);
    assert.equal(groqLines(lines).length, 0, 'with nothing armed there is nothing to explain');
  });

  it('…and with no rung in the bag at all, likewise', async () => {
    const spy = spyFetch({ catalog: catalogDown, anthropic: () => haikuSaid('the catalogue says…') });
    const { value, lines } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), { fetch: spy.fetch }),
    );
    assert.equal(value.text, 'the catalogue says…');
    assert.equal(spy.groqCalls().length, 0);
    assert.equal(groqLines(lines).length, 0);
  });

  it('⚠️ the loop is still BOUNDED, and the LAST pass offers no tools', async () => {
    const call = (n: number) => () =>
      haikuCalled([{ id: `h${n}`, name: 'catalog_lookup', args: { query: 'x' } }]);
    const spy = spyFetch({
      catalog: catalogDown,
      groq: () => groqCalled([{ id: 'c1', name: 'catalog_lookup', args: { query: 'x' } }]),
      anthropic: inOrder([call(2), call(3), () => haikuSaid('I could not reach the shelf.')]),
    });
    const { value } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value.text, 'I could not reach the shelf.');
    assert.equal(value.iterations, 4, 'MAX_TOOL_ITERATIONS + the final tools-free pass');
    // The final pass drops `tools` entirely: offering them on a turn whose
    // results could never be executed is how a loop ends with an unanswered
    // call and no text at all.
    const lastBody = JSON.parse(String(spy.anthropicCalls()[2]!.init?.body)) as Record<string, unknown>;
    assert.equal(lastBody.tools, undefined);
    // ⚠️ The ONE Groq pass is the selection, and it carries the tools.
    const groqBody = JSON.parse(String(spy.groqCalls()[0]!.init?.body)) as { tools: unknown[] };
    assert.equal(groqBody.tools.length, 2, 'Tier 0 only on this context');
  });

  it('⚠️ the two providers are handed the SAME system prompt, byte for byte', async () => {
    // A fork would make every comparison a comparison of two different
    // questions — the same argument `gabi-edge.test.ts` makes for the toolless
    // half, applied to the loop.
    const spy = spyFetch({
      catalog: catalogDown,
      groq: () => json({ error: 'slow down' }, 429),
      anthropic: () => haikuSaid('ok'),
    });
    await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    const groqBody = JSON.parse(String(spy.groqCalls()[0]!.init?.body)) as {
      messages: { role: string; content: string }[];
    };
    const haikuBody = JSON.parse(String(spy.anthropicCalls()[0]!.init?.body)) as { system: string };
    const groqSystem = groqBody.messages.find((m) => m.role === 'system')!.content;
    assert.equal(groqSystem, haikuBody.system);
  });

  it('⚠️ neither line ever carries the reply TEXT — household conversations', async () => {
    const secret = 'the narrator is Kate Reading and Sam asked at midnight';
    const spy = spyFetch({ catalog: catalogDown, groq: () => groqSaid(secret) });
    const { lines } = await captureLogs(() =>
      converseWithTools('anthropic-key', ASKED, null, CHATTER_TOOLS, toolCtxFor(spy), {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    for (const line of groqLines(lines)) {
      assert.equal(JSON.stringify(line).includes(secret), false, JSON.stringify(line));
    }
    assert.equal(groqLines(lines)[0]!.chars, secret.length, 'how long, never what');
  });
});

// ---------------------------------------------------------------------------
// 8. The JSON call sites, and the shared validators
// ---------------------------------------------------------------------------

describe('the JSON call sites — one schema, two transports', () => {
  const turns = [
    { role: 'user' as const, text: 'call me Sky, I want the full sheets', at: 1 },
    { role: 'assistant' as const, text: 'noted', at: 2 },
  ];
  const portWith = (): MemoryPort & { saved: MemoryProfile[] } => {
    const saved: MemoryProfile[] = [];
    return {
      saved,
      load: async () => null,
      save: async (p: MemoryProfile) => {
        saved.push(p);
        return true;
      },
      clear: async () => true,
    } as MemoryPort & { saved: MemoryProfile[] };
  };

  it('the distillation asks Groq for json_object and writes what came back', async () => {
    const spy = spyFetch({ groq: () => groqSaid('{"callMe":"Sky","notes":["wants full sheets"]}') });
    const port = portWith();
    const { value } = await captureLogs(() =>
      distillConversation(
        'anthropic-key',
        port,
        { discordUserId: '99' },
        turns,
        { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } },
        5000,
      ),
    );
    assert.equal(value.written, true);
    assert.equal(port.saved[0]!.callMe, 'Sky');
    assert.equal(spy.anthropicCalls().length, 0, 'Groq answered — no Haiku turn was spent');
    const body = JSON.parse(String(spy.groqCalls()[0]!.init?.body)) as Record<string, unknown>;
    assert.deepEqual(body.response_format, { type: 'json_object' });
  });

  it('⚠️ a Groq reply that fails `parseProfile` falls through — the SHARED validator decides', async () => {
    const spy = spyFetch({
      groq: () => groqSaid('sure! here is the note: not json at all'),
      anthropic: () => haikuSaid('{"callMe":"Sky"}'),
    });
    const port = portWith();
    const { value, lines } = await captureLogs(() =>
      distillConversation(
        'anthropic-key',
        port,
        { discordUserId: '99' },
        turns,
        { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } },
        5000,
      ),
    );
    assert.equal(value.written, true, 'the sweep still succeeds, on Haiku');
    assert.equal(port.saved[0]!.callMe, 'Sky');
    const entry = JSON.parse(lines.find((l) => l.includes('"evt":"gabi_groq"'))!) as Record<string, unknown>;
    assert.equal(entry.reason, 'invalid');
  });

  it('⚠️ a corrupt Groq profile NEVER overwrites what she already knew when Haiku also fails', async () => {
    const spy = spyFetch({ groq: () => groqSaid('not json'), anthropic: () => haikuSaid('also not json') });
    const port = portWith();
    const { value } = await captureLogs(() =>
      distillConversation(
        'anthropic-key',
        port,
        { discordUserId: '99' },
        turns,
        { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } },
        5000,
      ),
    );
    assert.equal(value.written, false);
    assert.equal(value.why, 'unparseable');
    assert.equal(port.saved.length, 0, 'forgetting is acceptable; corruption is not');
  });

  it('the T2 fix parse rides the rung too, and the field mapping is applied to EITHER transport', async () => {
    const spy = spyFetch({ groq: () => groqSaid('{"book":"Mistborn","field":"series","value":"The Final Empire"}') });
    const { value } = await captureLogs(() =>
      parseFixRequest('anthropic-key', 'fix the series on Mistborn', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.deepEqual(value, { book: 'Mistborn', field: 'series', after: 'The Final Empire' });
    assert.equal(spy.anthropicCalls().length, 0);
  });

  it('⚠️ {"field":"none"} is a CORRECT answer, not a Groq failure — it must not spend a Haiku turn', async () => {
    // The commonest outcome by far. Treating a well-formed "no fix here" as a
    // transport failure would fall through on every piece of small talk, which
    // is the exact opposite of what this rung is for.
    const spy = spyFetch({ groq: () => groqSaid('{"field":"none"}') });
    const { value } = await captureLogs(() =>
      parseFixRequest('anthropic-key', 'hello there', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.equal(value, null);
    assert.equal(spy.anthropicCalls().length, 0, 'a correct "none" must not cost a fallback');
  });

  it('a Groq reply that is not an object at all DOES fall through', async () => {
    const spy = spyFetch({
      groq: () => groqSaid('I think they want the series changed'),
      anthropic: () => haikuSaid('{"book":"Mistborn","field":"series","value":"The Final Empire"}'),
    });
    const { value } = await captureLogs(() =>
      parseFixRequest('anthropic-key', 'fix the series on Mistborn', WHO, {
        fetch: spy.fetch,
        groq: { mode: 'first', apiKey: 'g' },
      }),
    );
    assert.deepEqual(value, { book: 'Mistborn', field: 'series', after: 'The Final Empire' });
  });
});

// ---------------------------------------------------------------------------
// 9. The ladder's edges
// ---------------------------------------------------------------------------

describe('the ladder\'s edges', () => {
  it('⚠️ with a Groq rung and NO Anthropic key, Groq alone still answers', async () => {
    // The rung is a LADDER, and a missing Anthropic key is a rung that is not
    // there rather than a fault. This is the state the estate would be in if
    // the owner ever rotated the Anthropic key out.
    const spy = spyFetch({ groq: () => groqSaid('smalltalk') });
    const { value } = await captureLogs(() =>
      classifyIntent(undefined, 'hey!', WHO, { fetch: spy.fetch, groq: { mode: 'first', apiKey: 'g' } }),
    );
    assert.equal(value, 'smalltalk');
  });

  it('…and with NEITHER key nothing is requested at all, exactly as before the rung existed', async () => {
    const spy = spyFetch({});
    const { value } = await captureLogs(() =>
      classifyIntent(undefined, 'hey!', WHO, { fetch: spy.fetch, groq: { mode: 'first' } }),
    );
    assert.equal(value, null, 'the caller falls back to the keyword router, as it always did');
    assert.equal(spy.calls.length, 0);
  });

  it('the distillation reports `no_key` only when there is NO model at all', async () => {
    const spy = spyFetch({});
    const { value } = await captureLogs(() =>
      distillConversation(
        undefined,
        portless(),
        { discordUserId: '99' },
        [{ role: 'user', text: 'hi there, call me Sky', at: 1 }],
        { fetch: spy.fetch, groq: { mode: 'off', apiKey: 'g' } },
        5000,
      ),
    );
    assert.equal(value.why, 'no_key');
    assert.equal(spy.calls.length, 0);
  });

  function portless(): MemoryPort {
    return { load: async () => null, save: async () => true, clear: async () => true } as MemoryPort;
  }
});
