/**
 * **PERSONALITY.** The tests that keep the one rule everything else obeys.
 *
 * ⚠️ **PERSONALITY IS TONE, NEVER TRUTH.** A tsundere refusal delivers exactly
 * the same facts as a warm one; it is merely grumpier about it. These assert the
 * three structural reasons that holds:
 *
 *  1. the persona block is **APPENDED** to the system prompt, never substituted;
 *  2. every refusal reaches a person as a **CONSTANT** a trope never sees;
 *  3. the invariance clause rides **every one of the eleven** voice blocks.
 *
 * ⚠️ And the honest limit, stated here as it is in the design: these prove a
 * trope *cannot* edit a refusal and that the instruction is present. They do not
 * prove a model never paraphrases one. That gap is real.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  advancePersona,
  DRIFT_CHANCE,
  DRIFT_EVERY_EXCHANGES,
  freshPersona,
  isTrope,
  personaBlock,
  personaCommand,
  PERSONA_ACK,
  PERSONA_INVARIANT,
  PERSONA_REGISTER,
  personalityOn,
  PERSON_SPACE,
  PERSON_SURFACE,
  pickTrope,
  TROPES,
  TROPE_NEIGHBOURS,
  TROPE_VOICES,
  type Trope,
} from '../src/personality.js';
import { BOOKS_MSG } from '../src/book-knowledge.js';
import { MEMORY_MSG } from '../src/memory.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}

// ── 1. the roster is the owner's locked set ────────────────────────────────

describe('the roster is the ELEVEN the owner approved', () => {
  it('exactly eleven, including his own addition', () => {
    assert.equal(TROPES.length, 11);
    assert.ok(TROPES.includes('flirty'), 'the owner added flirty by name');
    for (const t of ['peppy', 'tsundere', 'shy', 'deadpan', 'warm', 'scholar', 'dramatic', 'mischievous', 'noir', 'cozy']) {
      assert.ok((TROPES as readonly string[]).includes(t), `${t} is missing from the locked set`);
    }
  });

  it('every trope has a voice, and the guard is default-deny', () => {
    for (const t of TROPES) assert.ok(TROPE_VOICES[t]?.voice?.length > 40, `${t} has no real voice`);
    assert.equal(isTrope('flirty'), true);
    assert.equal(isTrope('sultry'), false);
    assert.equal(isTrope(7), false);
  });
});

// ── 2. ⚠️ TONE, NEVER TRUTH ────────────────────────────────────────────────

describe('⚠️ personality cannot change what is true', () => {
  it('⚠️ EVERY voice block carries the invariance clause', () => {
    // Repeated on each rather than stated once, because the voice is what the
    // model is being asked to DO, and a rule three paragraphs away loses to it.
    for (const t of TROPES) {
      assert.ok(personaBlock(t).includes(PERSONA_INVARIANT), `${t} lost the invariance clause`);
    }
  });

  it('⚠️ EVERY voice block carries the PG-13 ceiling and the no-escalation clause', () => {
    // Owner: "make all the personalities go to pg-13, but at discretion… lets
    // have some wiggle." The ceiling rides every trope, not just flirty — a
    // saltier noir and a sharper tsundere are the same permission.
    for (const t of TROPES) {
      const block = personaBlock(t);
      assert.ok(block.includes(PERSONA_REGISTER), `${t} lost the register clause`);
      assert.match(block, /never past it/i, `${t} lost the ceiling`);
      assert.match(block, /do not escalate/i, `${t} lost the no-escalation clause`);
      assert.match(block, /Start mild/i, `${t} lost the default-mild rule`);
    }
  });

  it('⚠️ no voice block licenses changing a refusal, a fact or a citation', () => {
    for (const t of TROPES) {
      const block = personaBlock(t);
      assert.match(block, /Facts, refusals, quotes, citations, spoiler limits/i);
      assert.match(block, /do not soften, dramatise or reword them/i);
      // ⚠️ And nothing may invite the opposite.
      assert.doesNotMatch(block, /\b(rewrite|reword|ignore|skip|omit) (the )?(rule|refusal|fact)/i, t);
    }
  });

  it('⚠️ the load-bearing SENTENCES are constants a trope never sees', () => {
    // This is the structural half: a trope cannot rewrite a string that is not
    // in its prompt. Assert the refusal constants appear in NO voice block.
    const loadBearing = [BOOKS_MSG.notIngested, BOOKS_MSG.turnBudgetSpent, BOOKS_MSG.capped, MEMORY_MSG.none];
    for (const t of TROPES) {
      const block = personaBlock(t);
      for (const sentence of loadBearing) {
        assert.ok(!block.includes(sentence), `${t}'s block contains a refusal it could edit`);
      }
    }
  });

  it('⚠️ the block is APPENDED, never substituted — asserted at the call site', () => {
    // gabi-chat builds `system` as an array join; personality is one more entry.
    // If it ever became a replacement, a trope could delete a rule.
    const chat = repoFile('src/gabi-chat.ts');
    assert.match(chat, /CHAT_TOOLS_SYSTEM,/);
    assert.match(chat, /\.\.\.\(memoryBlock \? \[memoryBlock\] : \[\]\)/);
    const flow = repoFile('src/mention-flow.ts');
    assert.match(flow, /\[memory\?\.block, persona\?\.block\]\.filter\(Boolean\)/);
  });

  it('⚠️ the three risky tropes carry their explicit floors', () => {
    assert.match(TROPE_VOICES.tsundere.voice, /never actually rude|never insulting/i);
    assert.match(TROPE_VOICES.tsundere.voice, /answer fully/i);
    assert.match(TROPE_VOICES.shy.voice, /WHOLE answer/i);
    assert.match(TROPE_VOICES.flirty.voice, /CHARM, NOT HEAT/i);
  });
});

// ── 3. drift is gradual, by construction ───────────────────────────────────

describe('⚠️ drift walks the graph and never teleports', () => {
  it('the graph is symmetric — an edge is an edge in both directions', () => {
    for (const t of TROPES) {
      for (const n of TROPE_NEIGHBOURS[t]) {
        assert.ok(TROPE_NEIGHBOURS[n].includes(t), `${t}→${n} is one-way`);
      }
    }
  });

  it('every trope is reachable — no island', () => {
    const seen = new Set<Trope>(['shy']);
    const queue: Trope[] = ['shy'];
    while (queue.length) {
      for (const n of TROPE_NEIGHBOURS[queue.pop() as Trope]) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    assert.equal(seen.size, TROPES.length, 'a trope is unreachable by drift');
  });

  it('⚠️ the owner-approved wings and bridges are exactly what is wired', () => {
    assert.deepEqual([...TROPE_NEIGHBOURS.cozy].sort(), ['shy', 'warm']);
    assert.deepEqual([...TROPE_NEIGHBOURS.noir].sort(), ['deadpan', 'scholar']);
    // flirty bridges warm ↔ mischievous
    assert.deepEqual([...TROPE_NEIGHBOURS.flirty].sort(), ['mischievous', 'warm']);
    // tsundere bridges the loud and dry wings
    assert.deepEqual([...TROPE_NEIGHBOURS.tsundere].sort(), ['deadpan', 'mischievous']);
  });

  it('⚠️ tsundere and warm are NOT adjacent — the jump a distance metric would allow', () => {
    // The whole argument for an explicit graph over axes: those two sit close on
    // warmth arithmetic and are the largest tonal jump on the roster.
    assert.ok(!TROPE_NEIGHBOURS.tsundere.includes('warm'));
    assert.ok(!TROPE_NEIGHBOURS.warm.includes('tsundere'));
  });

  it('a drift step only ever lands on a NEIGHBOUR', () => {
    for (const t of TROPES) {
      const state = { trope: t, exchanges: DRIFT_EVERY_EXCHANGES - 1, since: 0 };
      const next = advancePersona(state, () => 0, 1);
      if (next.trope !== t) {
        assert.ok(TROPE_NEIGHBOURS[t].includes(next.trope), `${t} teleported to ${next.trope}`);
      }
    }
  });

  it('it does not drift between drift points, however unlucky the roll', () => {
    const state = { trope: 'noir' as Trope, exchanges: 0, since: 0 };
    const next = advancePersona(state, () => 0, 1);
    assert.equal(next.trope, 'noir');
    assert.equal(next.exchanges, 1);
  });

  it('a high roll declines the step even at a drift point', () => {
    const state = { trope: 'noir' as Trope, exchanges: DRIFT_EVERY_EXCHANGES - 1, since: 0 };
    assert.equal(advancePersona(state, () => DRIFT_CHANCE + 0.01, 1).trope, 'noir');
  });
});

// ── 4. selection and the pin ───────────────────────────────────────────────

describe('selection, and ⚠️ pinned means pinned', () => {
  it('a pin wins outright — no roll', () => {
    assert.equal(pickTrope({ pinned: 'noir' }, () => 0.99), 'noir');
  });

  it('without a pin it is a weighted roll across the whole roster', () => {
    assert.ok(isTrope(pickTrope({}, () => 0)));
    assert.ok(isTrope(pickTrope({}, () => 0.999)));
  });

  it('⚠️ a pinned persona NEVER drifts, however many exchanges pass', () => {
    let state = freshPersona('warm', 0, 'tsundere');
    for (let i = 0; i < 40; i++) state = advancePersona(state, () => 0, 1);
    assert.equal(state.trope, 'tsundere');
    assert.equal(state.pinned, 'tsundere');
  });

  it('the hidden pin recognises how people actually ask', () => {
    for (const [q, want] of [
      ['be tsundere', 'tsundere'],
      ['act peppy', 'peppy'],
      ['personality: noir', 'noir'],
      ['be more flirty', 'flirty'],
      ['talk like a scholar', 'scholar'],
      ['be grumpy', 'tsundere'],
    ] as const) {
      assert.deepEqual(personaCommand(q), { kind: 'pin', trope: want }, q);
    }
  });

  it('⚠️ CLEAR WINS OVER PIN when a sentence contains both', () => {
    // "stop being tsundere" has a trope name and a pin-shaped verb; reading it
    // as a PIN would be the exact opposite of what was asked.
    assert.deepEqual(personaCommand('stop being tsundere'), { kind: 'clear' });
    assert.deepEqual(personaCommand('personality off'), { kind: 'clear' });
    assert.deepEqual(personaCommand('be yourself'), { kind: 'clear' });
  });

  it('ordinary questions never move her personality', () => {
    for (const q of [
      "what's Jake's stat sheet at the end of book 9?",
      'do we have any Sanderson?',
      'what do you know about me?',
      'be careful with spoilers',
      '',
    ]) {
      assert.equal(personaCommand(q), null, q);
    }
  });

  it('⚠️ the acknowledgement is IN VOICE and explains NOTHING', () => {
    // The owner asked for the command not to be advertised. A confirmation like
    // "personality set to tsundere" would advertise it to anybody who typed it
    // by accident.
    for (const t of TROPES) {
      const ack = PERSONA_ACK[t];
      assert.ok(ack.length > 0, `${t} has no acknowledgement`);
      assert.doesNotMatch(ack, /personality|persona|mode|setting|switch/i, `${t}'s ack names the mechanism`);
    }
  });

  it('⚠️ the feature is NAMED NOWHERE a person would look', () => {
    // Not in the health surface's user-facing wording, not in any message
    // constant. Documented only in docs/.
    const flow = repoFile('src/mention-flow.ts');
    const spoken = flow.match(/content: '[^']*'/g) ?? [];
    for (const line of spoken) {
      assert.doesNotMatch(line, /personality/i, `a user-facing string names the feature: ${line}`);
    }
  });
});

// ── 5. ⚠️ person-keyed conversations ───────────────────────────────────────

describe('⚠️ one thread per PERSON, not per channel', () => {
  it('the key parts are fixed, so every surface lands in the same conversation', () => {
    assert.equal(PERSON_SURFACE, 'discord_person');
    assert.equal(PERSON_SPACE, 'all');
  });

  it('⚠️ both lanes key identically, or a component press answers an empty thread', () => {
    for (const file of ['src/gateway.ts', 'src/conversation-flow.ts']) {
      const src = repoFile(file);
      assert.match(src, /conversationKey\(PERSON_SURFACE, PERSON_SPACE,/, `${file} still keys on the channel`);
    }
  });

  it('⚠️ the identity is the SNOWFLAKE, never the display name', () => {
    // He said "username". A username is renameable and a snowflake is not, so
    // keying on the name would split one person's memory the day they renamed —
    // and merge two people if a name were ever reused.
    const gw = repoFile('src/gateway.ts');
    assert.match(gw, /conversationKey\(PERSON_SURFACE, PERSON_SPACE, trigger\.authorId\)/);
    assert.doesNotMatch(gw, /conversationKey\([^)]*authorName/);
  });

  it('⚠️ the sweep collects expired records in BOTH postures — it is the migration', () => {
    // The old channel-scoped records are never read again, and the lazy prune
    // that used to delete them fired on the READ path. Without this they would
    // linger for ever.
    const gw = repoFile('src/gateway.ts');
    assert.match(gw, /const port = memoryOn\(this\.env\) \? makeMemoryPort\(this\.env\) : null;/);
  });
});

// ── 6. the posture ─────────────────────────────────────────────────────────

describe('GABI_PERSONALITY is affirmative-only and ships ON', () => {
  it('only the exact word "on"', () => {
    assert.equal(personalityOn({ GABI_PERSONALITY: 'on' }), true);
    for (const v of ['true', '1', 'yes', '', undefined]) {
      assert.equal(personalityOn({ GABI_PERSONALITY: v as string }), false);
    }
  });

  it('⚠️ it ships ON — the owner ordered the feature', () => {
    assert.match(repoFile('wrangler.toml'), /^GABI_PERSONALITY = "on"$/m);
  });
});
