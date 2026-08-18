/**
 * **TIER 2 — GABI REMEMBERS YOU.** The tests that keep the promises
 * `docs/info/gabi-memory-design.md` makes in words.
 *
 * Each block names the rule it defends:
 *
 *  1. **The 2 KB cap is the whole price of the tier**, and it is enforced by
 *     dropping WHOLE entries — never by truncating a document mid-value.
 *  2. ⚠️ **A profile is what somebody SAID, never what was looked up.** The
 *     prompt block says so, and the distillation prompt forbids availability
 *     claims from entering at all — a remembered wrong claim is wrong every turn
 *     instead of once.
 *  3. ⚠️ **It must never feed the spoiler bound**, which would be exactly the
 *     stored ord ceiling book design §4.3 forbids.
 *  4. **Forgetting is acceptable; corrupting is not.** Anything unparseable is a
 *     no-op that keeps the old profile.
 *  5. ⚠️ **A credential leaks out of the FOUR modules allowed to hold one.**
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  capProfile,
  DISTILL_SYSTEM,
  emptyProfile,
  MEMORY_MSG,
  memoryCommand,
  memoryOn,
  parseProfile,
  personKey,
  PROFILE_MAX_BYTES,
  PROFILE_MAX_NOTES,
  PROFILE_NOTE_CHARS,
  PROFILE_SHAPE_VERSION,
  profileBytes,
  profileForDisplay,
  profileIsEmpty,
  profilePromptBlock,
  type MemoryProfile,
} from '../src/memory.js';
import { PROFILE_COLLECTION } from '../src/memory-exec.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const profile = (over: Partial<MemoryProfile> = {}): MemoryProfile => ({
  ...emptyProfile('discord:1', 1000),
  ...over,
});

// ── 1. the posture ─────────────────────────────────────────────────────────

describe('⚠️ GABI_MEMORY is affirmative-only and ships off', () => {
  it('only the exact word "on" turns it on', () => {
    assert.equal(memoryOn({ GABI_MEMORY: 'on' }), true);
    assert.equal(memoryOn({ GABI_MEMORY: ' ON ' }), true);
    for (const v of ['true', '1', 'yes', 'enabled', '', undefined]) {
      assert.equal(memoryOn({ GABI_MEMORY: v as string }), false, `"${String(v)}" turned it on`);
    }
  });
});

// ── 2. ⚠️ the cap IS the design ────────────────────────────────────────────

describe('⚠️ the 2 KB cap drops whole entries and never truncates one', () => {
  it('a profile stuffed past the ceiling comes back inside it', () => {
    const big = profile({
      notes: Array.from({ length: 40 }, (_, i) => `note ${i} `.repeat(20)),
      reading: Array.from({ length: 40 }, (_, i) => ({ book: `Book ${i}`, said: 'finished', at: 1 })),
      threads: Array.from({ length: 40 }, (_, i) => ({ what: `thread ${i}`.repeat(10), at: 1 })),
    });
    const capped = capProfile(big);
    assert.ok(profileBytes(capped) <= PROFILE_MAX_BYTES, `still ${profileBytes(capped)} bytes`);
  });

  it('⚠️ every surviving note is WHOLE — no half-written preference', () => {
    // "prefers full stat sh" is worse than no preference: unreadable to a model,
    // invisible to a reviewer skimming, and acted on anyway.
    const note = 'prefers the full stat sheet with no permission questions asked first';
    const capped = capProfile(profile({ notes: Array.from({ length: 30 }, () => note) }));
    for (const n of capped.notes) assert.equal(n, note, 'a note was cut mid-value');
  });

  it('the per-list caps hold on their own', () => {
    const capped = capProfile(profile({ notes: Array.from({ length: 20 }, (_, i) => `n${i}`) }));
    assert.ok(capped.notes.length <= PROFILE_MAX_NOTES);
  });

  it('a long note is clipped to its own limit rather than dropping the profile', () => {
    const capped = capProfile(profile({ notes: ['x'.repeat(500)] }));
    assert.equal((capped.notes[0] as string).length, PROFILE_NOTE_CHARS);
  });

  it('⚠️ notes are the LAST thing dropped — the preference is what he asked for', () => {
    const capped = capProfile(
      profile({
        notes: ['wants full sheets'],
        reading: Array.from({ length: 8 }, (_, i) => ({ book: `B${i}`.repeat(40), said: 'x'.repeat(60), at: 1 })),
        threads: Array.from({ length: 5 }, (_, i) => ({ what: `t${i}`.repeat(50), at: 1 })),
      }),
    );
    assert.deepEqual(capped.notes, ['wants full sheets']);
  });
});

// ── 3. ⚠️ corrupting is worse than forgetting ──────────────────────────────

describe('⚠️ anything unparseable is a no-op, never a half-read profile', () => {
  it('junk of every shape returns null', () => {
    for (const bad of ['not json', '[]', 'null', '42', '', '{"v":99}']) {
      assert.equal(parseProfile(bad, 'discord:1'), null, `parsed ${bad}`);
    }
    assert.equal(parseProfile(undefined, 'discord:1'), null);
  });

  it('⚠️ a version from the FUTURE is ignored rather than guessed at', () => {
    assert.equal(parseProfile({ v: PROFILE_SHAPE_VERSION + 1, notes: ['x'] }, 'discord:1'), null);
  });

  it('a model returning the right shape parses, and is capped on the way in', () => {
    const p = parseProfile(
      JSON.stringify({ callMe: 'Sky', notes: Array.from({ length: 30 }, (_, i) => `n${i}`) }),
      'discord:1',
    );
    assert.ok(p);
    assert.equal(p!.callMe, 'Sky');
    assert.ok(p!.notes.length <= PROFILE_MAX_NOTES);
    assert.equal(p!.person, 'discord:1', 'the person came from the model rather than the caller');
  });

  it('entries missing their required halves are dropped, not defaulted', () => {
    const p = parseProfile({ reading: [{ book: 'X' }, { said: 'finished' }, { book: 'Y', said: 'ch 3' }] }, 'd:1');
    assert.equal(p!.reading.length, 1);
    assert.equal(p!.reading[0]!.book, 'Y');
  });
});

// ── 4. ⚠️ the safety story of the whole tier ───────────────────────────────

describe('⚠️ a profile is COLOUR, never evidence', () => {
  const block = profilePromptBlock(
    profile({ callMe: 'Sky', notes: ['wants full sheets'], reading: [{ book: 'PH 9', said: 'finished', at: 1 }] }),
  );

  it('the prompt block forbids stating it as fact', () => {
    assert.match(block, /memory of what they SAID, not a fact you checked/i);
  });

  it('⚠️ it forbids the profile deciding what she has READ — the 2026-08-18 confabulation', () => {
    assert.match(block, /listing call in THIS turn decides that/i);
  });

  it('⚠️ it forbids the profile deciding the SPOILER BOUND — book design §4.3', () => {
    // A durable per-person reading position IS the stored ord ceiling that rule
    // forbids, if it is ever allowed to decide scope.
    assert.match(block, /never let it decide how far into a book they are for spoiler/i);
    assert.match(block, /from the sentence in front of you/i);
  });

  it('⚠️ the distillation prompt keeps availability claims OUT of the profile', () => {
    // A remembered wrong claim is wrong every turn instead of once, and looks
    // more authoritative for having been remembered.
    assert.match(DISTILL_SYSTEM, /NEVER record what YOU have or have not read/i);
    assert.match(DISTILL_SYSTEM, /Nothing about your own knowledge base/i);
  });

  it('⚠️ the distillation prompt keeps OTHER PEOPLE out', () => {
    assert.match(DISTILL_SYSTEM, /ONLY this person/i);
    assert.match(DISTILL_SYSTEM, /nothing about anybody else/i);
  });

  it('the distillation prompt prefers dropping to guessing', () => {
    assert.match(DISTILL_SYSTEM, /An empty note is a correct note/i);
  });
});

// ── 5. an empty profile is a correct profile ───────────────────────────────

describe('an empty profile is never injected and never sounds broken', () => {
  it('emptiness is recognised', () => {
    assert.equal(profileIsEmpty(null), true);
    assert.equal(profileIsEmpty(emptyProfile('discord:1')), true);
    assert.equal(profileIsEmpty(profile({ notes: ['x'] })), false);
  });

  it('showing an empty one reassures rather than reading as a fault', () => {
    assert.equal(profileForDisplay(null), MEMORY_MSG.none);
    assert.match(MEMORY_MSG.none, /haven't written anything down about you yet/i);
  });

  it('⚠️ a shown profile says how to clear it — a profile you cannot clear is a dossier', () => {
    const shown = profileForDisplay(profile({ notes: ['wants full sheets'], sources: 3 }));
    assert.match(shown, /wants full sheets/);
    assert.match(shown, /\/gabi memory forget/);
    assert.match(shown, /From 3 conversations/);
  });

  it('the display is sentences, not the stored JSON', () => {
    const shown = profileForDisplay(profile({ callMe: 'Sky', notes: ['a'] }));
    assert.doesNotMatch(shown, /[{}"]/, 'the raw document shape leaked into what a person reads');
  });
});

// ── 6. ⚠️ whose profile it is ──────────────────────────────────────────────

describe('⚠️ the person key is the estate email where one exists', () => {
  it('an email wins, lowercased and namespaced', () => {
    assert.equal(personKey({ email: 'Sky@Example.com', discordUserId: '123' }), 'estate:sky@example.com');
  });

  it('a Discord id is the fallback, in its OWN namespace so the two cannot collide', () => {
    assert.equal(personKey({ discordUserId: '123' }), 'discord:123');
    assert.equal(personKey({ email: '   ', discordUserId: '123' }), 'discord:123');
  });

  it('nothing identifiable is null, never a shared bucket', () => {
    // ⚠️ Two people sharing one profile comes from a wrong key. A fallback
    // constant here would be exactly that bug.
    assert.equal(personKey({}), null);
    assert.equal(personKey({ email: 'nope', discordUserId: '' }), null);
  });
});

// ── 7. ⚠️ the control a person has over it ─────────────────────────────────

describe('⚠️ seeing and clearing it is DETERMINISTIC, never a model judgement', () => {
  it('the ways people actually ask to see it', () => {
    for (const q of [
      'memory',
      '/gabi memory',
      'memory show',
      'what do you know about me?',
      'what do you remember about me',
      'show me my profile',
      "what's in my memory",
    ]) {
      assert.equal(memoryCommand(q), 'show', q);
    }
  });

  it('the ways people actually ask to be forgotten', () => {
    for (const q of [
      'forget everything',
      'forget what you know about me',
      'forget what you remember about me',
      'memory forget',
      '/gabi memory clear',
      'clear my memory',
      'delete your notes about me',
    ]) {
      assert.equal(memoryCommand(q), 'forget', q);
    }
  });

  it('⚠️ FORGET WINS OVER SHOW when a sentence contains both', () => {
    // "forget what you remember about me" contains a show-shaped clause.
    // Reading a privacy request as a request to DISPLAY would be the worst
    // possible misreading of this control.
    assert.equal(memoryCommand('forget what you remember about me'), 'forget');
    assert.equal(memoryCommand('please forget everything you know about me'), 'forget');
  });

  it('ordinary questions are not memory commands', () => {
    for (const q of [
      'what do you know about Brandon Sanderson?',
      'do we have any Mistborn?',
      "what's Jake's stat sheet at the end of book 9?",
      'remind me what happens in chapter 4',
      '',
    ]) {
      assert.equal(memoryCommand(q), null, q);
    }
  });

  it('⚠️ a failed delete is NEVER reported as success', () => {
    // Somebody who asked to be forgotten and was told "done" would walk away
    // believing it. The two sentences are distinct and say what is true.
    assert.notEqual(MEMORY_MSG.cleared, MEMORY_MSG.trouble);
    assert.match(MEMORY_MSG.trouble, /Nothing has been deleted/i);
  });
});

// ── 8. ⚠️ THE CREDENTIAL SEAM, WIDENED A THIRD TIME AND IN WRITING ─────────

describe('⚠️ credentials live in exactly FOUR modules', () => {
  const CREDENTIALS = [
    /firestoreRequest/,
    /mintAccessToken/,
    /parseServiceAccount/,
    /FIREBASE_SERVICE_ACCOUNT/,
    /ESTATE_APP_TOKEN/,
    /DISCORD_BOT_TOKEN/,
  ];

  it('⚠️ memory.ts — the whole contract — names none of them', () => {
    // One module became two for Tier 0b, three for Tier 0c, four here. Each time
    // on purpose and in writing — never "credentials are allowed in the chat
    // path now".
    const source = strip(repoFile('src/memory.ts'));
    for (const forbidden of CREDENTIALS) {
      assert.doesNotMatch(source, forbidden, `memory.ts now names ${forbidden}`);
    }
  });

  it('⚠️ the memory executor needs NO NEW SECRET — that was the argument for Firestore', () => {
    const source = strip(repoFile('src/memory-exec.ts'));
    // It uses the service account this Worker already holds for discord_links…
    assert.match(source, /FIREBASE_SERVICE_ACCOUNT/);
    // …and reaches for none of the three app tokens. A profile store that needed
    // a fourth trust edge would have been a materially more expensive feature.
    assert.doesNotMatch(source, /ESTATE_APP_TOKEN/, 'the memory executor grew an app token');
    assert.doesNotMatch(source, /DISCORD_BOT_TOKEN/);
  });

  it('⚠️ it only ever GETs, PATCHes and DELETEs its OWN collection', () => {
    const source = strip(repoFile('src/memory-exec.ts'));
    assert.equal(PROFILE_COLLECTION, 'gabi_profiles');
    // ⚠️ It must not touch discord_links — that document is the identity join,
    // read on the hot path of every gated call, and a memory feature with write
    // access to it could break every book and docs answer.
    assert.doesNotMatch(source, /discord_links/, 'the memory executor reached the identity join');
  });
});
