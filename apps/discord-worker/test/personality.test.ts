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
  personaAdminCommand,
  personaQuery,
  personaSelfAnswer,
  renderPersonaRoster,
  devopsWriter,
  isPersonaWriter,
  PERSONA_ADMIN_MSG,
  PERSONA_ROSTER_MAX,
  PERSONA_VISIBILITY_MSG,
  TROPES,
  TROPE_NEIGHBOURS,
  TROPE_VOICES,
  type PersonaRosterRow,
  type PersonaState,
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
    // ⚠️ Widened 2026-09-01 for the intensity dial, and NOT weakened: the
    // persona block must still be the LAST entry, because its PG-13 register
    // clause and its invariance clause are what qualify everything above them.
    // A dial that appended itself after the persona block would push both of
    // those away from the instruction they bound.
    assert.match(flow, /\[memory\?\.block, cfg\.edgeBlock, persona\?\.block\]\.filter\(Boolean\)/);
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

// ── 7. ⚠️ VISIBILITY — she answers about HERSELF, refuses about others ────

/**
 * ⚠️ **THIS DOES NOT UNDO §5's SECRECY, and these tests are where that line is
 * kept.** The owner's instruction was *"don't tell end users"* about the
 * COMMAND. Answering *"what are you being with me"* with a dodge would read as a
 * malfunction, which is worse than the fact — so the fact is given and the
 * mechanism is still nowhere.
 */
describe('⚠️ asking what she is being — the visibility half', () => {
  it('a question about YOURSELF is a self query', () => {
    for (const line of [
      'what personality are you using with me?',
      'which personality is this?',
      'what mood are you in?',
      'are you pinned right now?',
      'what persona do you have with me',
    ]) {
      assert.equal(personaQuery(line)?.kind, 'self', `not read as a self query: ${line}`);
    }
  });

  it('⚠️ a question about SOMEBODY ELSE is refused, mention or name', () => {
    assert.equal(personaQuery('what personality do you use with <@123456789>?')?.kind, 'other');
    assert.equal(personaQuery("what's Sam's personality?")?.kind, 'other');
    assert.match(PERSONA_VISIBILITY_MSG.notYours, /between me and them/i);
    // ⚠️ It offers what they CAN have, so a refusal is not a dead end.
    assert.match(PERSONA_VISIBILITY_MSG.notYours, /how I am with YOU/);
  });

  it('the roster question is its own kind', () => {
    for (const line of [
      'what personality does everyone have',
      'list the personalities',
      'show me the personality roster',
    ]) {
      assert.equal(personaQuery(line)?.kind, 'roster', `not read as a roster query: ${line}`);
    }
  });

  it('⚠️ ORDINARY TALK IS NOT A PERSONA QUESTION', () => {
    for (const line of ['do we have Mistborn', 'what should I read next', 'how are you?']) {
      assert.equal(personaQuery(line), null, `false positive: ${line}`);
    }
  });

  it('⚠️ SHE ANSWERS THE QUESTION ASKED AND NOTHING ADJACENT', () => {
    // The trope and whether it is fixed — and NO string anywhere in this module
    // says which words would fix it. That is the owner's line, held.
    const drifting = personaSelfAnswer({ trope: 'cozy', exchanges: 3, since: Date.now() });
    assert.match(drifting, /cosy|cozy/i);
    assert.match(drifting, /shifts a little/i);

    const pinned = personaSelfAnswer({ trope: 'noir', exchanges: 3, since: Date.now(), pinned: 'noir' });
    assert.match(pinned, /noir/i);
    assert.match(pinned, /staying that way/i);

    for (const said of [drifting, pinned]) {
      assert.doesNotMatch(said, /\bbe tsundere\b|to (?:pin|set) (?:me|it)/i);
      assert.doesNotMatch(said, /\bcommand\b/i);
    }
  });

  it('⚠️ THE WRITER IS NOT NAMED TO THE TARGET — no notification, ever', () => {
    // An operator's pin is roster material. Telling somebody "an operator made
    // me cosy at you" turns an invisible knob into a notification, which is
    // exactly what the devops verb is specified NOT to send.
    const said = personaSelfAnswer({
      trope: 'cozy',
      exchanges: 1,
      since: Date.now(),
      pinned: 'cozy',
      writer: devopsWriter('999'),
    });
    assert.doesNotMatch(said, /999|operator|devops|somebody (?:set|asked)/i);
  });

  it('nothing stored is a real answer, not an error', () => {
    const said = personaSelfAnswer(null);
    assert.match(said, /haven't settled/i);
    assert.doesNotMatch(said, /error|sorry|problem/i);
  });
});

// ── 8. ⚠️ THE ROSTER — matches stored state, and shows the WRITER ─────────

describe('⚠️ the roster is the state, rendered', () => {
  const now = 1_700_000_000_000;
  const rows: PersonaRosterRow[] = [
    { discordUserId: '111', state: { trope: 'noir', exchanges: 2, since: now - 20 * 60_000 } },
    {
      discordUserId: '222',
      state: {
        trope: 'cozy',
        exchanges: 5,
        since: now - 2 * 3_600_000,
        pinned: 'cozy',
        writer: devopsWriter('999'),
        pinnedAt: now - 2 * 3_600_000,
      },
    },
    {
      discordUserId: '333',
      state: { trope: 'peppy', exchanges: 1, since: now - 60_000, pinned: 'peppy', writer: 'self' },
    },
  ];

  it('every person on record appears, with their stored trope', () => {
    const out = renderPersonaRoster(rows, now);
    assert.match(out, /<@111>/);
    assert.match(out, /<@222>/);
    assert.match(out, /<@333>/);
    assert.match(out, /noir/);
    assert.match(out, /cosy|cozy/i);
    assert.match(out, /peppy/);
    assert.match(out, /3 on record/);
  });

  it('⚠️ PINNED-OR-DRIFTING and the WRITER are both shown', () => {
    const out = renderPersonaRoster(rows, now);
    assert.match(out, /drifting/);
    assert.match(out, /pinned by <@999>/, 'the devops writer must be named on the roster');
    assert.match(out, /pinned by themselves/, 'a self-pin must be distinguishable');
  });

  it('the LAST SHIFT is shown', () => {
    const out = renderPersonaRoster(rows, now);
    assert.match(out, /20m ago/);
    assert.match(out, /2h ago/);
  });

  it('⚠️ an UNRECORDED writer says so rather than being guessed at', () => {
    // Records written before the roster existed carry none, and printing
    // "pinned by themselves" for them would invent a fact about somebody.
    const out = renderPersonaRoster(
      [{ discordUserId: '444', state: { trope: 'shy', exchanges: 0, since: now, pinned: 'shy' } }],
      now,
    );
    assert.match(out, /writer not recorded/);
  });

  it('pinned rows sort above drifting ones', () => {
    const out = renderPersonaRoster(rows, now).split('\n').slice(1);
    assert.ok((out[0] ?? '').includes('pinned'), 'a drifting row was listed first');
  });

  it('an empty roster is a real answer', () => {
    assert.equal(renderPersonaRoster([], now), PERSONA_VISIBILITY_MSG.rosterEmpty);
  });

  it('⚠️ the roster read is BOUNDED', () => {
    assert.ok(PERSONA_ROSTER_MAX > 0 && PERSONA_ROSTER_MAX <= 500);
    assert.match(repoFile('src/gateway.ts'), /limit: PERSONA_ROSTER_MAX/);
  });
});

// ── 9. ⚠️ THE DEVOPS SET/CLEAR ────────────────────────────────────────────

describe('⚠️ devops may set any trope on any person', () => {
  it('the owner-shaped instruction, with a mention', () => {
    const cmd = personaAdminCommand("make <@123456789>'s personality cozy");
    assert.equal(cmd?.kind, 'set');
    assert.equal(cmd?.kind === 'set' && cmd.target, '123456789');
    assert.equal(cmd?.kind === 'set' && cmd.trope, 'cozy');
  });

  it('all ELEVEN are settable — the roster is the locked set, not a subset', () => {
    for (const t of TROPES) {
      const cmd = personaAdminCommand(`set <@123456789> personality to ${t}`);
      assert.equal(cmd?.kind, 'set', `${t} is not settable`);
      assert.equal(cmd?.kind === 'set' && cmd.trope, t);
    }
  });

  it('clearing returns them to drift', () => {
    const cmd = personaAdminCommand('unpin <@123456789> personality');
    assert.equal(cmd?.kind, 'clear');
    assert.equal(cmd?.kind === 'clear' && cmd.target, '123456789');
  });

  it('⚠️ CLEAR IS CHECKED FIRST — "stop making them tsundere" is not a SET', () => {
    const cmd = personaAdminCommand('stop making <@123456789> tsundere, personality off');
    assert.equal(cmd?.kind, 'clear');
  });

  it('⚠️ AN INVALID TROPE IS ITS OWN CASE, so she can say she cannot be it', () => {
    const cmd = personaAdminCommand('make <@123456789> personality grumpycat');
    assert.equal(cmd?.kind, 'set-unknown');
    assert.match(PERSONA_ADMIN_MSG.unknownTrope('grumpycat'), /isn't one I know how to be/i);
    // ⚠️ It does NOT list the eleven — the trope roster is not a menu for end
    // users, and an operator who needs it has the docs.
    assert.doesNotMatch(PERSONA_ADMIN_MSG.unknownTrope('grumpycat'), /tsundere|deadpan|peppy/i);
  });

  it('⚠️ A BARE NAME IS REFUSED, NEVER RESOLVED', () => {
    // Two people can answer to "Sam", and the estate's rule is that an
    // access-changing instruction read generously is how the wrong person gets
    // acted on.
    const cmd = personaAdminCommand("make Sam's personality cozy");
    assert.equal(cmd?.kind, 'needs-mention');
    assert.match(PERSONA_ADMIN_MSG.needsMention, /rather ask than guess/i);
  });

  it('⚠️ AN OPERATOR VERB WITH NO PERSONA SUBJECT IS NOT THIS COMMAND', () => {
    // "make them an admin" and "set their reminder" must not be read as persona
    // verbs — an over-broad detector here acts on the wrong system entirely.
    assert.equal(personaAdminCommand('make <@123456789> an admin'), null);
    assert.equal(personaAdminCommand("set <@123456789>'s reminder for 5pm"), null);
    assert.equal(personaAdminCommand('do we have Mistborn'), null);
  });

  it('⚠️ THE ROLE REFUSAL NAMES THE ROLE AND THE FIX — never a bare no', () => {
    assert.match(PERSONA_ADMIN_MSG.notDevops, /devops/i);
    assert.match(PERSONA_ADMIN_MSG.notDevops, /\/admin/);
    assert.match(PERSONA_ADMIN_MSG.notDevops, /deliberate line/i);
    assert.match(PERSONA_VISIBILITY_MSG.notDevops, /devops/i);
    assert.match(PERSONA_VISIBILITY_MSG.notDevops, /\/admin/);
    // ⚠️ AND IT IS NOT A DEAD END: she offers what they CAN have.
    assert.match(PERSONA_VISIBILITY_MSG.notDevops, /how I am with you/i);
  });

  it('⚠️ THE FIVE CAUSES STAY APART, because the fixes differ', () => {
    const said = [
      PERSONA_VISIBILITY_MSG.notDevops,
      PERSONA_VISIBILITY_MSG.rosterNotLinked,
      PERSONA_VISIBILITY_MSG.rosterLinkIncomplete,
      PERSONA_VISIBILITY_MSG.rosterUnreachable,
      PERSONA_VISIBILITY_MSG.rosterNotConfigured,
    ];
    assert.equal(new Set(said).size, said.length, 'two causes share a sentence');
    // ⚠️ An OUTAGE is never worded as a permission problem.
    assert.match(PERSONA_VISIBILITY_MSG.rosterUnreachable, /outage on our side/i);
    assert.doesNotMatch(PERSONA_VISIBILITY_MSG.rosterUnreachable, /devops-class/);
  });
});

// ── 10. ⚠️ THE WRITER IS RECORDED, AND SURVIVES A DRIFT ───────────────────

describe('⚠️ who set a pin is recorded and does not evaporate', () => {
  it('the writer token is the SNOWFLAKE, never a name', () => {
    assert.equal(devopsWriter('123456789'), 'devops:123456789');
    assert.equal(isPersonaWriter('devops:123456789'), true);
    assert.equal(isPersonaWriter('self'), true);
    assert.equal(isPersonaWriter('devops:Sam'), false);
    assert.equal(isPersonaWriter('nonsense'), false);
  });

  it('⚠️ PROVENANCE SURVIVES A DRIFT STEP', () => {
    // An earlier shape rebuilt the state object field by field; adding `writer`
    // to it without spreading would have silently dropped who pinned somebody
    // the first time she stepped — a roster telling a confident lie.
    const state: PersonaState = {
      trope: 'cozy',
      exchanges: 3,
      since: 1,
      writer: devopsWriter('999'),
      pinnedAt: 1,
    };
    const next = advancePersona(state, () => 0, 2);
    assert.equal(next.writer, 'devops:999');
  });

  it('a fresh roll has NO writer — a coin toss is not credited to a person', () => {
    assert.equal(freshPersona('warm', 1).writer, undefined);
    assert.equal(freshPersona('warm', 1, 'warm', { writer: 'self', pinnedAt: 1 }).writer, 'self');
  });

  it('⚠️ the gateway records the writer on a pin and DROPS it on a clear', () => {
    const gw = repoFile('src/gateway.ts');
    assert.match(gw, /pinned: trope, writer, pinnedAt: now/);
    // The clear branch builds a state with no `writer` key at all — a drifting
    // persona has no author.
    assert.match(gw, /trope: stored\?\.trope \?\? pickTrope\(\)/);
  });

  it('⚠️ the devops gate is ASKED, never copied — 403 no, 200 yes, else UNKNOWN', () => {
    const gate = repoFile('src/devops-gate.ts');
    assert.match(gate, /probe\.status === 403/);
    assert.match(gate, /if \(probe\.ok\) return \{ kind: 'devops'/);
    // ⚠️ No local list of who is devops. A second holder of that decision is a
    // second thing to forget to revoke — so the CODE (comments stripped) must
    // name no address list and no local predicate.
    const code = gate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /OWNER_EMAILS|devopsAllows|@[a-z]+\.(?:com|ai)/i);
  });
});

// ── 11. ⚠️ WIRED, NOT MERELY WRITTEN ──────────────────────────────────────

describe('⚠️ the persona lanes are REACHABLE, and in the right order', () => {
  const flow = repoFile('src/mention-flow.ts');

  it('both detectors are called and both lanes have answer functions', () => {
    assert.match(flow, /personaAdminCommand\(question\)/, 'the devops set/clear is not wired');
    assert.match(flow, /personaQuery\(question\)/, 'the visibility query is not wired');
    assert.match(flow, /await personaAdminAnswer\(/);
    assert.match(flow, /await personaVisibilityAnswer\(/);
  });

  it('⚠️ the ADMIN command is checked BEFORE the QUESTION', () => {
    // "make <@1> cozy" contains a persona noun and could be read as an enquiry.
    // An instruction misread as a question does nothing and looks broken; a
    // question misread as an instruction changes somebody's state. So the
    // ambiguous reading loses to the explicit verb.
    const admin = flow.indexOf('personaAdminCommand(question)');
    const query = flow.indexOf('personaQuery(question)');
    assert.ok(admin > 0 && query > 0);
    assert.ok(admin < query, 'a set instruction can be swallowed by the query detector');
  });

  it('⚠️ the hidden PIN still runs first of all — the existing behaviour is intact', () => {
    const pin = flow.indexOf('personaCommand(question)');
    const admin = flow.indexOf('personaAdminCommand(question)');
    assert.ok(pin > 0 && pin < admin, 'the hidden self-pin lost its place in the order');
  });

  it('⚠️ on THEMSELVES no devops check happens — anybody may choose their own voice', () => {
    const lane = flow.slice(flow.indexOf('async function personaAdminAnswer'));
    const onSelf = lane.indexOf('const onSelf =');
    const check = lane.indexOf('await checkDevops(');
    assert.ok(onSelf > 0 && check > 0);
    assert.ok(onSelf < check, 'an ordinary person is told they lack a role for something they had');
    assert.match(lane.slice(0, check + 200), /if \(!onSelf\)/);
  });
});
