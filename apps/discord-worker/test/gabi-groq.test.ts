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
  GROQ_TIMEOUT_MS,
  groqComplete,
  GroqFailure,
  groqLive,
  groqMode,
  groqRung,
  viaGroq,
  type GroqReason,
} from '../src/gabi-groq.js';
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
}): { fetch: typeof fetch; calls: Seen[]; groqCalls: () => Seen[]; anthropicCalls: () => Seen[] } {
  const calls: Seen[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    calls.push({ url, init });
    if (url.includes('api.groq.com')) {
      if (!handlers.groq) throw new Error(`unexpected Groq call in this test: ${url}`);
      return handlers.groq(init);
    }
    if (!handlers.anthropic) throw new Error(`unexpected Anthropic call in this test: ${url}`);
    return handlers.anthropic(init);
  }) as unknown as typeof fetch;
  return {
    fetch: impl,
    calls,
    groqCalls: () => calls.filter((c) => c.url.includes('api.groq.com')),
    anthropicCalls: () => calls.filter((c) => !c.url.includes('api.groq.com')),
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
    // thinking. The Groq attempt now floors max_tokens at 512 (the shared
    // validator still enforces the tiny output shape) and pins
    // reasoning_effort low. Re-argue both if the model pin leaves the
    // gpt-oss family.
    assert.equal(body.max_tokens, 512, 'a small caller cap is floored for the reasoning model');
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
      assert.equal(spy.groqCalls().length, 1, `${name}: exactly one Groq attempt, never a retry loop`);
      assert.equal(spy.anthropicCalls().length, 1, `${name}: exactly one Haiku turn`);
      const line = lines.find((l) => l.includes('"evt":"gabi_groq"'));
      assert.ok(line, `${name}: the fall-through must be one structured line`);
      const entry = JSON.parse(line) as Record<string, unknown>;
      assert.equal(entry.outcome, 'fallback', name);
      assert.equal(entry.reason, reason, name);
    }
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
// 7. ⚠️ THE SCOPE RULE — tool turns never touch Groq, in any posture
// ---------------------------------------------------------------------------

describe('⚠️ THE SCOPE RULE — a TOOLFUL turn never reaches Groq, in ANY posture', () => {
  for (const mode of ['off', 'shadow', 'first'] as const) {
    it(`converseWithTools makes no Groq request with the posture "${mode}"`, async () => {
      const spy = spyFetch({ anthropic: () => haikuSaid('the catalogue says…') });
      const { value } = await captureLogs(() =>
        converseWithTools(
          'anthropic-key',
          'who narrates The Way of Kings?',
          null,
          { ...WHO, authorName: 'Sam' },
          { catalogBaseUrl: 'https://audiobooks.example' },
          { fetch: spy.fetch, groq: { mode, apiKey: 'g' } },
        ),
      );
      assert.equal(value.text, 'the catalogue says…');
      assert.equal(
        spy.groqCalls().length,
        0,
        'the Anthropic↔OpenAI tool-schema translation is PHASE 2 — a tool loop must stay on Anthropic',
      );
    });
  }
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
