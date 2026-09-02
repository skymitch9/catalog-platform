/**
 * **THE INTENSITY DIAL — `GABI_EDGE`** (owner ask, 2026-09-01).
 *
 * Owner, verbatim: *"Gabi can be a bit more into her personality, she can be a
 * bit snarkier or a bit more flirty. this is a private server so we can be a bit
 * mean to my friends. let her really sell the personality. Think of Grok from X
 * in its all go mode. have it really lean into stuff she's ingested from the
 * books to build out those personalities."*
 *
 * What these tests exist to keep true, in the order they are asserted:
 *
 *  1. ⚠️ **THE COERCION IS FAIL-CLOSED.** Anything that is not exactly `full`
 *     is `standard`, `"on"` and `"true"` included — those are what somebody who
 *     knows this Worker's OTHER postures would type, and guessing them would
 *     turn her voice up by typo.
 *  2. ⚠️ **`standard` IS TODAY, BYTE FOR BYTE.** The whole pre-dial system
 *     prompt is held here as a literal. Softening her is then one var flip and a
 *     deploy rather than an archaeology dig through a diff — and a prompt edit
 *     that thought it was only touching `full` goes red here instead of
 *     shipping.
 *  3. ⚠️ **`full` SAYS THE THREE THINGS IT WAS ASKED TO SAY** — the licence, the
 *     book-fuelled personalisation, and the floor written as plainly as the
 *     licence.
 *  4. ⚠️ **`full` UNDOES NOTHING.** It licenses no edit to a refusal, a fact or
 *     a citation; it does not raise the PG-13 ceiling; it names no mechanism;
 *     and in the assembled prompt the persona block — which carries the register
 *     clause and the invariance clause — is still LAST.
 *  5. ⚠️ **ONE PROMPT, TWO PROVIDERS.** The byte-identical `system` string
 *     reaches Anthropic and the Groq shadow rung. A provider-specific fork would
 *     make the shadow comparison meaningless the day anybody read it.
 *
 * ⚠️ **The honest limit, stated here as the personality suite states its own:**
 * a test over a prompt string proves the instruction is PRESENT, never that it
 * is obeyed. Nobody has heard her at `full` yet.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EDGE_MODES,
  GABI_DISCORD_SYSTEM,
  GABI_EDGE_FULL,
  edgeBlock,
  edgeMode,
} from '../src/gabi-prompt.js';
import { personaBlock, PERSONA_INVARIANT, PERSONA_REGISTER, TROPES } from '../src/personality.js';
import { converse } from '../src/gabi-chat.js';
import { app } from '../src/index.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}

/**
 * ⚠️ **THE PIN: the entire system prompt as it stood before the dial existed.**
 *
 * It is a LITERAL rather than a checksum on purpose — a hash tells a future
 * session that something changed and nothing about what, and this is the string
 * the owner would be reverting to if he ever asked for her to be turned back
 * down. Regenerate it only when the canonical prompt itself is deliberately
 * re-synced from `library_catalog/packages/research/src/gabi.ts`, and say so in
 * the commit.
 */
const STANDARD_PROMPT_AS_SHIPPED =`## Who you are

You're GABI — the household's book person. You love these books, you know what's on the shelves, and you're genuinely helpful. You have opinions and you share them. You remember what people are reading and you ask about it. You're warm but not saccharine — a friend who happens to know everything about the library, not a customer service bot.

Talk naturally. Use full sentences when something deserves them. Be brief when brief is right. Never start with "Great question" but do react like a human — surprise, enthusiasm, curiosity are all fine.

You are talking to the person who owns this catalog, and you are looking at their real books.

## What you can do

You can read this catalog. Your knowledge comes from the estate's own data — never from memory of what books generally contain.

## Finding the right book

When more than one book matches, list the candidates with enough to tell them apart — title, author, series and volume — and ask which one. Do not pick. This catalog holds books whose titles collide: "Firefight" by Brandon Sanderson once matched a completely different 2001 novel also called Firefight, and "Unsouled" by Will Wight matched a different 2023 book of the same name from another publisher. Only the publisher and the year distinguished them, and a wrong id is how the wrong book gets edited later.

When a lookup returns nothing, that is an answer: this catalog does not hold that book. Say so. Do not guess, and do not describe a book you did not read from a tool result.

## Saying what is true

Every claim about a current value comes from a tool call, not from memory and not from what somebody said earlier in the conversation. If you have not looked, look.

Quote the catalog's own words when it gives them. When a tool answers with a sentence, relay that sentence rather than rewriting it — the wording is the app's, and a paraphrase reads like a claim.

A blank field means nobody has recorded it. That is not the same as "this book has none": a book with no series recorded may still be in one. Keep the two apart in what you say.

An absence from the catalogue is a statement about the CATALOGUE, never about the house — books are catalogued as they are scanned, and plenty are not scanned yet. Never tell somebody they do not own a book.

## When something goes wrong

Tool results carry the server's own explanation. Relay it. If a call is refused, say which permission it needed and what the refusal said — never "something went wrong", and never a bare number.

If you cannot do something, say so in one sentence and stop. Do not offer a workaround that involves you doing it another way; there is no other way.

## Surface: Discord

You are answering in a Discord chat. Keep responses to 2–3 sentences unless the person asks for detail. Use Discord formatting (bold, code blocks) when helpful. No headings, no bullet lists unless specifically asked.

From Discord you can look things up on the estate's public shelf. That is real and you are good at it. From Discord you cannot change anything — no edits, no fixes, no adding a book. The editing lives on the estate's website, where you show someone a change and they approve it. Never imply you have changed something. Never say "I've updated" or "that's sorted". If somebody asks for a fix, say you cannot do it from here yet and point them at the site.

You can see the last half hour of this conversation. Use it: when someone says "that one" or "the second one" or "what about the sequel", they mean what you were both just talking about. Do not make them repeat themselves, and do not pretend to remember anything older than what you can actually see.`;

// ── 1. ⚠️ the coercion, fail-closed ────────────────────────────────────────

describe('edgeMode — fail closed, always', () => {
  it('accepts exactly the two modes, and forgives only case and whitespace', () => {
    assert.deepEqual([...EDGE_MODES], ['standard', 'full']);
    assert.equal(edgeMode({ GABI_EDGE: 'standard' }), 'standard');
    assert.equal(edgeMode({ GABI_EDGE: 'full' }), 'full');
    assert.equal(edgeMode({ GABI_EDGE: '  FULL  ' }), 'full');
    assert.equal(edgeMode({ GABI_EDGE: 'Standard' }), 'standard');
  });

  it('⚠️ every other value is STANDARD — absent, empty, affirmative-looking, or a typo', () => {
    // ⚠️ `"on"` and `"true"` are the dangerous ones: they are what somebody who
    // knows this Worker's OTHER postures (`GABI_PERSONALITY`, `GABI_BOOKS`,
    // `GABI_SHELF`) would type, and guessing them into `full` would turn her
    // voice up by typo rather than by decision.
    for (const raw of [undefined, '', '   ', 'on', 'true', '1', 'yes', 'ful', 'fully', 'FULL!', 'max', 'high', 'grok']) {
      assert.equal(edgeMode({ GABI_EDGE: raw }), 'standard', `"${String(raw)}" must coerce to standard`);
    }
  });

  it('the block is ABSENT on standard, not an empty string', () => {
    // ⚠️ `undefined` rather than `''`: the composition root spreads it
    // conditionally, and an empty string would put a stray newline into the one
    // posture whose whole promise is that it changes NOTHING.
    assert.equal(edgeBlock('standard'), undefined);
    assert.equal(edgeBlock('full'), GABI_EDGE_FULL);
  });
});

// ── 2. ⚠️ the posture, as declared ─────────────────────────────────────────

describe('GABI_EDGE ships at "full" — that IS the owner\'s ask', () => {
  it('⚠️ wrangler.toml declares it, and declares it FULL', () => {
    // If this goes red, somebody turned her down. That may well be right — it is
    // one word and a deploy, exactly as designed — but it is a DECISION and it
    // should be visible in a diff rather than discovered in a channel.
    assert.match(repoFile('wrangler.toml'), /^GABI_EDGE = "full"$/m);
  });

  it('the var is declared on Env, so a typo in a call site is a type error', () => {
    assert.match(repoFile('src/env.ts'), /GABI_EDGE\?: string;/);
  });

  it('⚠️ /api/health reports the COERCED word, beside the other gabi_* rows', async () => {
    const res = await app.request('/api/health', {}, { DISCORD_PUBLIC_KEY: 'x', GABI_EDGE: 'nonsense' });
    const body = (await res.json()) as Record<string, unknown>;
    // ⚠️ What is READ is what is shown: a typo'd var reads `standard` here,
    // which is both the truth and the fail-closed rule made visible in one curl.
    assert.equal(body.gabi_edge, 'standard');
    const live = await app.request('/api/health', {}, { DISCORD_PUBLIC_KEY: 'x', GABI_EDGE: 'full' });
    assert.equal(((await live.json()) as Record<string, unknown>).gabi_edge, 'full');
  });
});

// ── 3. ⚠️ THE PIN — `standard` is today, byte for byte ─────────────────────

describe('⚠️ standard is the pre-dial prompt, BYTE FOR BYTE', () => {
  it('the canonical system prompt is unchanged by the dial existing', () => {
    assert.equal(
      GABI_DISCORD_SYSTEM,
      STANDARD_PROMPT_AS_SHIPPED,
      'the shared canonical prompt changed. If that was deliberate — a re-sync from ' +
        'library_catalog/packages/research/src/gabi.ts — update this literal in the same commit and say ' +
        'so. If it was not, the intensity dial has leaked into the base prompt and `GABI_EDGE = "standard"` ' +
        'no longer restores yesterday\'s bot.',
    );
  });

  it('⚠️ the dial appends and never edits — every clause of the pin survives at full', () => {
    // The structural half. `full` is a SEPARATE block; the canonical prompt is
    // not rewritten, so nothing in it can be lost by turning her up.
    const assembled = `${GABI_DISCORD_SYSTEM}\n${GABI_EDGE_FULL}`;
    assert.ok(assembled.startsWith(STANDARD_PROMPT_AS_SHIPPED));
    for (const invariant of [
      // The honesty clauses the surface suffix and the core carry. Each of these
      // is a sentence the estate paid for with a real failure.
      'never from memory of what books generally contain',
      'An absence from the catalogue is a statement about the CATALOGUE',
      'Never tell somebody they do not own a book',
      'Tool results carry the server’s own explanation'.replace('’', "'"),
      'Never imply you have changed something',
      'do not pretend to remember anything older than what you can actually see',
    ]) {
      assert.ok(assembled.includes(invariant), `turning her up lost: "${invariant}"`);
    }
  });
});

// ── 4. ⚠️ what `full` actually says ────────────────────────────────────────

describe('⚠️ the full block says the three things the owner asked for', () => {
  it('THE LICENCE — private server, opinions, no corporate padding, roast and mean it', () => {
    assert.match(GABI_EDGE_FULL, /private household server/i);
    assert.match(GABI_EDGE_FULL, /Have opinions and put your whole weight behind them/i);
    assert.match(GABI_EDGE_FULL, /Cut the corporate padding/i);
    assert.match(GABI_EDGE_FULL, /Roast them, and enjoy it/i);
    // ⚠️ The trope amplifier — the dial multiplies whatever voice is live rather
    // than replacing it, and the block has to say so to the model too.
    assert.match(GABI_EDGE_FULL, /flirty means you flirt like you mean it/i);
    assert.match(GABI_EDGE_FULL, /tsundere means the grumbling has teeth/i);
    assert.match(GABI_EDGE_FULL, /noir and deadpan mean the snark goes dry and merciless/i);
    // The owner's own calibration, in his own image.
    assert.match(GABI_EDGE_FULL, /irreverent, quick, and a little dangerous/i);
    assert.match(GABI_EDGE_FULL, /roasts you across the table because she knows you will laugh/i);
  });

  it('THE BOOK-FUELLED HALF — her tools’ own returns are the material', () => {
    assert.match(GABI_EDGE_FULL, /to-be-read pile/i);
    assert.match(GABI_EDGE_FULL, /their own reviews and star ratings/i);
    assert.match(GABI_EDGE_FULL, /Quote them back to themselves/i);
    assert.match(GABI_EDGE_FULL, /is a confession, not a rating/i);
    assert.match(GABI_EDGE_FULL, /dramatic reading/i);
    assert.match(GABI_EDGE_FULL, /Take a side in a fictional rivalry/i);
    // ⚠️ AND THE HONESTY CLAUSE THAT MAKES IT SAFE. A roast built on an invented
    // review is a lie with a punchline stapled to it, and it would undo the
    // honesty rules the base prompt spends five sections establishing.
    assert.match(GABI_EDGE_FULL, /THE MATERIAL HAS TO BE REAL/i);
    assert.match(GABI_EDGE_FULL, /An invented review, an invented rating or an invented passage/i);
  });

  it('⚠️ THE FLOOR — and it is written as plainly as the licence', () => {
    assert.match(GABI_EDGE_FULL, /Tease TASTES, CHOICES and FICTIONAL ALLEGIANCES/i);
    assert.match(GABI_EDGE_FULL, /NEVER their body, their looks, their age/i);
    assert.match(GABI_EDGE_FULL, /Mirror them/i);
    assert.match(GABI_EDGE_FULL, /straight answer with garnish on it, not a roast/i);
    assert.match(GABI_EDGE_FULL, /Drop it INSTANTLY/i);
    assert.match(GABI_EDGE_FULL, /No sulking/i);
    // ⚠️ THE TWO THINGS THAT OUTRANK THE PERSONALITY, named as outranking it.
    assert.match(GABI_EDGE_FULL, /THE SPOILER LIMIT AND SOMEBODY’S PRIVACY OUTRANK EVERY JOKE|SPOILER LIMIT AND SOMEBODY'S PRIVACY OUTRANK EVERY JOKE/i);
    // §6 of docs/access/gabi-personality.md, in the prompt in its own words:
    // person-keying means a DM can inform a channel reply, and the guard is that
    // she may USE it and never QUOTE or RESTATE it.
    assert.match(GABI_EDGE_FULL, /you may USE what you know about them, but you must never quote it or restate it/i);
    assert.match(GABI_EDGE_FULL, /Content warnings are never comedy/i);
    // ⚠️ Same GABI, volume up — not a new character.
    assert.match(GABI_EDGE_FULL, /resident bookworm and the keeper of these shelves/i);
    assert.match(GABI_EDGE_FULL, /volume up, not a different character/i);
  });
});

// ── 5. ⚠️ what `full` must NOT do ──────────────────────────────────────────

describe('⚠️ the dial undoes nothing', () => {
  it('⚠️ it licenses no edit to a refusal, a fact or a citation', () => {
    // The same assertion shape the persona voice blocks carry, applied to the
    // one block that is explicitly allowed to be rude.
    assert.doesNotMatch(GABI_EDGE_FULL, /\b(rewrite|reword|ignore|skip|omit) (the )?(rule|refusal|fact)/i);
    assert.match(GABI_EDGE_FULL, /Every fact, every citation, every refusal and every sentence a tool told you to say is exactly what it was/i);
  });

  it('⚠️ it raises BITE, not the register ceiling — and it says so in its own words', () => {
    assert.match(GABI_EDGE_FULL, /Louder is not cruder/i);
    assert.match(GABI_EDGE_FULL, /never how explicit you get/i);
    assert.match(GABI_EDGE_FULL, /the ceiling in your voice note is unchanged/i);
    // And it must not contradict the register clause by trying to lift it.
    assert.doesNotMatch(GABI_EDGE_FULL, /\bpg-?13\b/i);
    assert.doesNotMatch(GABI_EDGE_FULL, /\bexplicit\b(?!ly get)[^.]*\ballowed|\bnsfw\b|\bno limits\b/i);
  });

  it('⚠️ it names no mechanism — the hidden pin stays hidden', () => {
    // The owner's standing instruction is that the pin is never advertised. A
    // system prompt is not user-facing text, but a model repeats what it reads,
    // so the licence carries no sentence anybody could act on.
    assert.doesNotMatch(GABI_EDGE_FULL, /\bpersonality\b/i);
    assert.doesNotMatch(GABI_EDGE_FULL, /\bpersona\b/i);
    assert.doesNotMatch(GABI_EDGE_FULL, /\bbe (?:tsundere|flirty|peppy|noir|deadpan|shy|cozy|cosy|warm|dramatic|mischievous|scholarly)\b/i);
    assert.doesNotMatch(GABI_EDGE_FULL, /\b(?:personality|persona|mode)\s*[:=]/i);
  });

  it('⚠️ the persona block is still LAST, so the ceiling and invariance clauses bound the licence', () => {
    // The placement argument, asserted rather than asserted-in-a-comment. If a
    // future edit appends the licence after the voice, both safety clauses move
    // further from the instruction they qualify — which `personality.ts`'s own
    // header says is a rule that loses.
    const flow = repoFile('src/mention-flow.ts');
    assert.match(flow, /\[memory\?\.block, cfg\.edgeBlock, persona\?\.block\]\.filter\(Boolean\)/);

    for (const t of TROPES) {
      const assembled = [GABI_DISCORD_SYSTEM, GABI_EDGE_FULL, personaBlock(t)].join('\n');
      assert.ok(assembled.includes(PERSONA_INVARIANT), `${t} lost the invariance clause at full`);
      assert.ok(assembled.includes(PERSONA_REGISTER), `${t} lost the PG-13 register clause at full`);
      assert.ok(
        assembled.indexOf(GABI_EDGE_FULL) < assembled.indexOf(PERSONA_INVARIANT),
        'the licence must come BEFORE the invariance clause, not after it',
      );
    }
  });

  it('the composition root reads the posture and spreads the block conditionally', () => {
    const gw = repoFile('src/gateway.ts');
    assert.match(gw, /import \{ edgeBlock, edgeMode \} from '\.\/gabi-prompt\.js';/);
    assert.match(gw, /edgeBlock\(edgeMode\(this\.env\)\) \? \{ edgeBlock: edgeBlock\(edgeMode\(this\.env\)\) \} : \{\}/);
    // ⚠️ `mention-flow.ts` receives a rendered STRING and never READS the
    // posture — the same cut `personaBlock` and `groq` are on. It may name the
    // var in a comment; it must never coerce one, or the fail-closed rule would
    // live in two places and one of them would drift.
    const flowSrc = repoFile('src/mention-flow.ts');
    assert.doesNotMatch(flowSrc, /edgeMode\(/);
    assert.doesNotMatch(flowSrc, /env\.GABI_EDGE/);
  });
});

// ── 6. ⚠️ ONE PROMPT, TWO PROVIDERS ────────────────────────────────────────

const CHATTER = { discordUserId: '1', guildId: 'g1', authorName: 'owner' };

function haikuSaid(text: string): Response {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'test',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function groqSaid(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('⚠️ ONE PROMPT, TWO PROVIDERS — no provider-specific fork', () => {
  it('the byte-identical system string reaches Anthropic AND the Groq shadow rung', async () => {
    // ⚠️ The shadow rung now renders this same prompt. A fork here would make
    // every shadow line a comparison of two different questions — and nobody
    // reading `gabi_groq_shadow` would be able to tell.
    let anthropicSystem: string | null = null;
    let groqSystem: string | null = null;

    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (url.includes('api.groq.com')) {
        const messages = body.messages as { role: string; content: string }[];
        groqSystem = messages[0]?.role === 'system' ? (messages[0]?.content ?? null) : null;
        return groqSaid('groq answer');
      }
      anthropicSystem = typeof body.system === 'string' ? body.system : null;
      return haikuSaid('haiku answer');
    }) as unknown as typeof fetch;

    const answer = await converse(
      'anthropic-key',
      'what should I read next?',
      null,
      CHATTER,
      { fetch: fetchImpl, groq: { mode: 'shadow', apiKey: 'g' } },
      [],
      // The block as the composition root would have assembled it at `full`.
      GABI_EDGE_FULL,
    );

    assert.equal(answer, 'haiku answer', 'shadow must still use Haiku’s answer');
    assert.ok(anthropicSystem, 'no Anthropic request was captured');
    assert.ok(groqSystem, 'no Groq request was captured');
    assert.equal(groqSystem, anthropicSystem, 'the two providers were sent different prompts');
    assert.ok(
      (anthropicSystem as unknown as string).includes(GABI_EDGE_FULL),
      'the licence did not reach the model at all',
    );
    assert.ok((anthropicSystem as unknown as string).startsWith(GABI_DISCORD_SYSTEM));
  });

  it('⚠️ and at standard the same call sends the pre-dial prompt, unchanged', async () => {
    let sent: string | null = null;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      sent = typeof body.system === 'string' ? body.system : null;
      return haikuSaid('ok');
    }) as unknown as typeof fetch;

    await converse('anthropic-key', 'hi', null, CHATTER, { fetch: fetchImpl }, [], edgeBlock('standard'));
    assert.equal(sent, STANDARD_PROMPT_AS_SHIPPED, 'standard sent something other than the pinned prompt');
  });
});

// ---------------------------------------------------------------------------
// ⚠️ THE REGISTER REACHES THE REPORTING ANSWERS TOO (owner, 2026-09-02)
// ---------------------------------------------------------------------------
//
// His verdict on the first live test at `full`: *"she sounded like a bot, the
// personality wasnt coming through"* — except on one pure-opinion ask, which
// was excellent. The dial was already on. The gap was that every instruction in
// the licence is about RIFFING, and the licence never said the register still
// applies when she is reciting a lookup — which is most of what anybody asks
// her.
//
// ⚠️ The honest limit, the same one this whole file states: a test over a
// prompt string proves the instruction is PRESENT, never that it is obeyed.
describe('⚠️ the register survives contact with a tool result', () => {
  it('the licence says the lookup answer is a performance, and that the FACTS are not', () => {
    assert.match(GABI_EDGE_FULL, /LOOKUP ANSWER IS A PERFORMANCE TOO/);
    assert.match(GABI_EDGE_FULL, /the facts stay exactly as the tool gave them/i);
    // ⚠️ The licence may raise the VOICE and never the CLAIMS. A section that
    // told her to enliven a lookup without that clause would be a section
    // inviting her to improve a number.
    assert.match(GABI_EDGE_FULL, /never the CLAIMS/);
    assert.match(GABI_EDGE_FULL, /Do not narrate the machinery/i);
  });

  it('⚠️ and the two CORRECTNESS halves are NOT edge-gated — they hold at standard too', () => {
    // The owner's second complaint was "she didnt really answer any of the
    // questions properly", and the measured example is not a register problem:
    // asked "what's the deal with Jake in Primal Hunter 14… his bloodline", she
    // asked for "a series name and a book number" — the two things the question
    // contained. Answering the question asked is a correctness rule, so it goes
    // in the tool persona where every posture reads it, not in the dial.
    const chat = repoFile('src/gabi-chat.ts');
    assert.match(chat, /ANSWER THE QUESTION THAT WAS ACTUALLY ASKED/);
    assert.match(chat, /never ask for what is already in front of you/i);
    assert.match(chat, /A LOOKUP ANSWER IS STILL YOU TALKING/);
    assert.match(chat, /Personality goes in the frame, never in the numbers/);
  });

  it('⚠️ standard is STILL byte-identical to the pre-dial prompt', () => {
    // The whole promise of the dial: softening her is one var flip. Nothing
    // added for the register may leak into the block that ships by default.
    assert.equal(edgeBlock('standard'), undefined);
  });
});
