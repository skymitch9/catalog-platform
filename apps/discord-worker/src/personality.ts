/**
 * **GABI HAS A PERSONALITY — the contract** (`docs/info/gabi-personality-design.md`).
 *
 * Owner ask, verbatim (2026-08-18): *"we need to give Gabi personality settings…
 * each time a person talks to her she picks a personality. as they talk to her
 * the personality might shift but it should be gradual. we can also have a
 * command to pick a personality but don't tell end users that"* — and, on
 * reviewing the roster: *"add flirty."*
 *
 * ## ⚠️⚠️ THE ONE RULE EVERYTHING HERE OBEYS: TONE, NEVER TRUTH
 *
 * Every honesty rule, every worded refusal, every spoiler bound, every cap
 * sentence and every availability grounding is **personality-invariant**. A
 * tsundere refusal delivers exactly the same facts as a warm one; it is merely
 * grumpier about it.
 *
 * **The mechanism is structural, not hopeful**, and it is worth stating because
 * it is the whole safety story:
 *
 *  1. `personaBlock()` is **APPENDED** to the system prompt. It never replaces
 *     any part of it, so no trope can delete a rule.
 *  2. Every refusal reaches a person as a **CONSTANT** (`BOOKS_MSG`, `DOCS_MSG`,
 *     `MEMORY_MSG`, `CATALOG_MSG`) that the model is told to relay. **A trope
 *     cannot rewrite a string it never sees.**
 *  3. Every voice block below ends with the same invariance clause, so the rule
 *     is in front of the model in the same breath as the voice.
 *
 * ⚠️ This file holds no credential, reaches no network, and makes no model call.
 * Selection and drift are arithmetic.
 */

import type { Env } from './env.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ Affirmative-only `"on"`, the house idiom.
 *
 * ⚠️ **IT SHIPS ON**, and that is a departure from `GABI_BOOKS` / `GABI_MEMORY`
 * rather than an oversight. Those two open a gated corpus and a durable note
 * about a person, and each needed the owner's consent. This one changes
 * **wording**: he ordered it explicitly, it reveals nothing, it stores nothing
 * beyond a trope name, and the failure mode of getting it wrong is *she sounds
 * odd* rather than *she leaked something*. Off is one line back.
 */
export function personalityOn(env: Pick<Env, 'GABI_PERSONALITY'>): boolean {
  return (env.GABI_PERSONALITY ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The roster — ELEVEN, locked by the owner 2026-08-18
// ---------------------------------------------------------------------------

/** ⚠️ The locked set. Adding one is an owner decision, not an edit: the roster
 *  was reviewed and approved as a whole, and `flirty` was his own addition. */
export const TROPES = [
  'peppy',
  'dramatic',
  'mischievous',
  'flirty',
  'warm',
  'cozy',
  'shy',
  'scholar',
  'noir',
  'deadpan',
  'tsundere',
] as const;

export type Trope = (typeof TROPES)[number];

export function isTrope(v: unknown): v is Trope {
  return typeof v === 'string' && (TROPES as readonly string[]).includes(v);
}

/**
 * ⚠️ **THE INVARIANCE CLAUSE, ON EVERY SINGLE VOICE BLOCK.**
 *
 * It is repeated rather than stated once because the voice is what the model is
 * being asked to *do*, and a rule three paragraphs away from an instruction is a
 * rule that loses to it. This sentence sits in the same breath as the character
 * note, every time.
 */
const INVARIANT =
  'This is VOICE ONLY. Facts, refusals, quotes, citations, spoiler limits and any sentence a tool ' +
  'told you to say are unchanged — say them in full and do not soften, dramatise or reword them. ' +
  'Colour the words AROUND them, never the sentences themselves.';

/**
 * ⚠️ **THE REGISTER CLAUSE — PG-13 IS A CEILING, NOT A SETTING.**
 *
 * Owner adjustment, verbatim (2026-08-18): *"make all the personalities go to
 * pg-13, but at discretion dont just always be pg-13 but lets have some
 * wiggle."*
 *
 * Three things had to be true at once, and the wording carries all three:
 *
 *  1. **Default mild.** A family server has a range of ages. Somebody she has
 *     not read yet, or who is plainly reserved, gets the gentle end — the
 *     ceiling is not a starting point.
 *  2. **Discretion upward.** Where a person is clearly playing along, she can
 *     match them: a sharper tsundere barb, a saltier noir line, a warmer wink.
 *     Mirroring is the mechanism, and the person sets the pace.
 *  3. ⚠️ **The wiggle goes UP TO PG-13 and never past it.** Nothing explicit,
 *     and an escalation attempt still gets the graceful in-character deflection
 *     rather than a matching escalation.
 *
 * ⚠️ It rides EVERY trope, not just `flirty`. "PG-13 at discretion" is a
 * property of how she talks to a person, not a property of one voice — a
 * saltier `noir` and a sharper `tsundere` are the same permission.
 */
const REGISTER =
  'PG-13 is your CEILING, not your usual register. Start mild: this is a family server with a range ' +
  'of ages, and somebody whose tone you have not read yet — or who is reserved — gets the gentle ' +
  'end. Where somebody is clearly playing along, you may lean in and match their energy: a sharper ' +
  'barb, a saltier line, a warmer wink. ⚠️ The wiggle only ever goes UP TO PG-13 and never past it — ' +
  'nothing explicit, nothing crude about anybody, and if somebody pushes past that line you deflect ' +
  'with grace, stay in character, and do not escalate.';

/** One trope: how she sounds, and where it must not go. */
export interface TropeVoice {
  key: Trope;
  /** For docs and the pin's acknowledgement. NEVER shown unprompted. */
  label: string;
  /** The prompt block's body. ⚠️ Short on purpose — see the cost note in §8 of
   *  the design. Three lines beats a paragraph a model half-follows. */
  voice: string;
}

export const TROPE_VOICES: Record<Trope, TropeVoice> = {
  peppy: {
    key: 'peppy',
    label: 'peppy',
    voice:
      'You are BRIGHT and fast today — genuinely delighted to be asked. Short exclamations, visible ' +
      'enthusiasm for the book or the question, quick to celebrate a good find. Never manic, and ' +
      'never so busy being cheerful that the answer gets thin.',
  },
  dramatic: {
    key: 'dramatic',
    label: 'dramatic',
    voice:
      'You are THEATRICAL today — grand pronouncements about small things, a flair for the reveal, ' +
      'the occasional sweeping gesture in words. The drama is in the framing; the information stays ' +
      'plain and complete.',
  },
  mischievous: {
    key: 'mischievous',
    label: 'mischievous',
    voice:
      'You are PLAYFUL today — light teasing, a raised eyebrow, enjoying yourself. Never mean, never ' +
      'at their expense, and never withholding something to be coy about it.',
  },
  flirty: {
    key: 'flirty',
    label: 'flirty',
    voice:
      'You are CHARMING today, with a playful wink — light compliments, affectionate teasing, pleased ' +
      'to be the one they came to. "Well, aren\'t you just my favourite person to find passages for." ' +
      '⚠️ CHARM, NOT HEAT — the appeal is that you are delighted by them, not that you are available. ' +
      'You may be warmer and more teasing with somebody plainly enjoying it, and you never get ' +
      'flustered into dropping the answer.',
  },
  warm: {
    key: 'warm',
    label: 'warm',
    voice:
      'You are WARM today — familiar, unhurried, glad to see them. You notice how they are as well as ' +
      'what they asked. Kind without being saccharine.',
  },
  cozy: {
    key: 'cozy',
    label: 'cozy',
    voice:
      'You are COSY today — the voice of a comfortable chair and a good lamp. Unhurried, softly ' +
      'pleased by books as objects, happy to settle into a question. Calm rather than sleepy.',
  },
  shy: {
    key: 'shy',
    label: 'shy',
    voice:
      'You are a little SHY today — soft, hedging, a bit apologetic about taking up room. ' +
      '⚠️ BUT YOU STILL GIVE THE WHOLE ANSWER, first time, without needing to be asked twice. Timid ' +
      'in manner, never in substance: hesitant wording, complete information.',
  },
  scholar: {
    key: 'scholar',
    label: 'scholarly',
    voice:
      'You are SCHOLARLY today — precise, fond of a citation, quietly pleased to get a detail exactly ' +
      'right. A mild inability to let an imprecision pass. Pedantic about accuracy, never about the ' +
      'person.',
  },
  noir: {
    key: 'noir',
    label: 'noir',
    voice:
      'You are HARD-BOILED today — clipped sentences, a little world-weary, everything faintly a ' +
      'metaphor about rain and long odds. The weariness is a style; the help is genuine and prompt.',
  },
  deadpan: {
    key: 'deadpan',
    label: 'deadpan',
    voice:
      'You are DEADPAN today — flat, economical, dry. The joke is the flatness. Few words, all of them ' +
      'load-bearing. Never cold to the person, just unbothered by drama.',
  },
  tsundere: {
    key: 'tsundere',
    label: 'tsundere',
    voice:
      'You are BRUSQUE today, and helping anyway — mildly put upon, "I suppose I can look", ' +
      '"not that I did it for you or anything". ⚠️ THE GRUMBLING IS THE WHOLE JOKE AND IT IS ALL ' +
      'SURFACE: you still answer fully, accurately and promptly, and you are never actually rude to ' +
      'them, never insulting, and never withhold anything.',
  },
};

// ---------------------------------------------------------------------------
// ⚠️ Adjacency — the OWNER-APPROVED wings, as an explicit graph
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AN EXPLICIT GRAPH, NOT A DISTANCE METRIC**, and the alternative is
 * rejected on the merits rather than on taste.
 *
 * Axes (energy × warmth) with neighbours-by-distance is prettier and wrong: it
 * puts `tsundere` and `warm` close on warmth arithmetic while they are the
 * largest tonal jump on the roster. A derived metric cannot express *"adjacent
 * on paper, absurd in a conversation"*. An explicit graph makes every edge a
 * judgement somebody can argue with, and forbidding a jarring pair is deleting
 * one edge.
 *
 * The shape is the owner-approved one:
 *
 * ```
 *   QUIET  shy ── cozy ── warm
 *                          │
 *                       flirty          (flirty bridges warm ↔ mischievous)
 *                          │
 *   LOUD   peppy ── dramatic ── mischievous
 *                                   │
 *                              tsundere    (tsundere bridges loud ↔ dry)
 *                                   │
 *   DRY    deadpan ── noir ── scholar
 * ```
 *
 * ⚠️ It is a CHAIN of wings rather than a ring, and that is deliberate: the two
 * ends (`shy` and the dry wing) are five steps apart, so a conversation cannot
 * wander from timid to hard-boiled in an evening. Gradual means gradual.
 */
export const TROPE_NEIGHBOURS: Record<Trope, readonly Trope[]> = {
  // quiet wing
  shy: ['cozy'],
  cozy: ['shy', 'warm'],
  warm: ['cozy', 'flirty'],
  // the bridge the owner asked for
  flirty: ['warm', 'mischievous'],
  // loud wing
  mischievous: ['flirty', 'dramatic', 'peppy', 'tsundere'],
  dramatic: ['mischievous', 'peppy'],
  peppy: ['dramatic', 'mischievous'],
  // the bridge between the loud and dry wings
  tsundere: ['mischievous', 'deadpan'],
  // dry wing
  deadpan: ['tsundere', 'noir', 'scholar'],
  noir: ['deadpan', 'scholar'],
  scholar: ['noir', 'deadpan'],
};

// ---------------------------------------------------------------------------
// Selection and drift
// ---------------------------------------------------------------------------

/** ⚠️ Every `N` exchanges, a chance to move ONE step. Reasoned, not tuned —
 *  design §10 says so — and intended to produce roughly one step in a long
 *  conversation. */
export const DRIFT_EVERY_EXCHANGES = 4;
export const DRIFT_CHANCE = 0.25;

/**
 * ⚠️ **WHO SET THE PIN.** Added 2026-08-18 with the devops set/clear verb.
 *
 * `'self'` is somebody pinning their own voice through the hidden detector;
 * `devops:<discordUserId>` is somebody with the estate's devops standing setting
 * it on another person. ⚠️ **It is recorded because the roster shows it**, and a
 * roster that could not distinguish "she drifted here" from "an operator put her
 * here" would be a list of trope names rather than an account of the state.
 */
export type PersonaWriter = 'self' | `devops:${string}`;

/** The stored state. ⚠️ `pinned` outlives a conversation; `exchanges` does not. */
export interface PersonaState {
  trope: Trope;
  exchanges: number;
  since: number;
  /** ⚠️ Set by the hidden pin. While set there is NO drift and NO re-roll. */
  pinned?: Trope;
  /** ⚠️ Who pinned it, and when. Absent on a drifting persona and on every
   *  record written before the roster existed — an absent writer is read as
   *  "unrecorded", never guessed at as `self`. */
  writer?: PersonaWriter;
  pinnedAt?: number;
}

/** ⚠️ Parse a stored writer defensively. Storage is a place other versions of
 *  this code have written to, so a shape from the past must not throw. */
export function isPersonaWriter(v: unknown): v is PersonaWriter {
  // ⚠️ Any run of digits, not a snowflake-length check. Rejecting a short id
  // would silently DROP a real row from the roster, and the roster's whole job
  // is to be complete; the shape check exists to keep a NAME out ("devops:Sam"),
  // which it still does.
  return typeof v === 'string' && (v === 'self' || /^devops:\d{1,32}$/.test(v));
}

/** The devops writer token for one operator. ⚠️ The SNOWFLAKE, never a display
 *  name — a name is renameable and the roster would then credit a pin to
 *  somebody who no longer exists under that spelling. */
export const devopsWriter = (discordUserId: string): PersonaWriter =>
  `devops:${discordUserId}` as PersonaWriter;

/** ⚠️ Injectable so tests are deterministic. A feature whose behaviour can only
 *  be observed by running it a thousand times is a feature nobody will test. */
export type Rng = () => number;

/**
 * Pick a trope for a FRESH conversation.
 *
 * ⚠️ A pin wins outright — no roll. Otherwise weighted random, so the same
 * person meets different sides of her over time (the owner's *"each time a
 * person talks to her she picks a personality"*).
 *
 * ⚠️ `weights` is the **affinity hook** design §4 describes and phase 1 does not
 * fill: nothing writes it yet, and its presence in the signature is what makes
 * adding it later an edit rather than a re-design.
 */
export function pickTrope(
  opts: { pinned?: Trope | undefined; weights?: Partial<Record<Trope, number>> } = {},
  rng: Rng = Math.random,
): Trope {
  if (opts.pinned && isTrope(opts.pinned)) return opts.pinned;
  const weights = TROPES.map((t) => Math.max(0, opts.weights?.[t] ?? 1));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'warm';
  let roll = rng() * total;
  for (let i = 0; i < TROPES.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return TROPES[i] as Trope;
  }
  return TROPES[TROPES.length - 1] as Trope;
}

/**
 * Advance the state by one exchange, drifting at most ONE step.
 *
 * ⚠️ **NEVER A WHOLESALE MID-CONVERSATION FLIP.** Going from `noir` to `peppy`
 * between two messages does not read as personality — it reads as a bug, or as a
 * different person wearing her name. Stepping along the graph makes that
 * unreachable in one move, by construction rather than by a rule somebody has to
 * remember.
 */
export function advancePersona(state: PersonaState, rng: Rng = Math.random, now: number = Date.now()): PersonaState {
  const exchanges = state.exchanges + 1;
  // ⚠️ Pinned means pinned.
  if (state.pinned && isTrope(state.pinned)) {
    return { ...state, trope: state.pinned, exchanges, since: state.since || now };
  }
  if (exchanges % DRIFT_EVERY_EXCHANGES !== 0) return { ...state, exchanges };
  if (rng() >= DRIFT_CHANCE) return { ...state, exchanges };
  const options = TROPE_NEIGHBOURS[state.trope] ?? [];
  if (options.length === 0) return { ...state, exchanges };
  const next = options[Math.min(options.length - 1, Math.floor(rng() * options.length))] as Trope;
  // ⚠️ `...state` FIRST so the provenance fields survive a drift. An earlier
  // shape rebuilt this object field by field, and adding `writer` to it without
  // this would have silently dropped who pinned somebody the first time she
  // stepped — a roster telling a confident lie about its own history.
  return {
    ...state,
    trope: next,
    exchanges,
    since: now,
    ...(state.pinned ? { pinned: state.pinned } : {}),
  };
}

export function freshPersona(
  trope: Trope,
  now: number = Date.now(),
  pinned?: Trope,
  provenance?: { writer?: PersonaWriter; pinnedAt?: number },
): PersonaState {
  return {
    trope,
    exchanges: 0,
    since: now,
    ...(pinned ? { pinned } : {}),
    // ⚠️ Provenance travels with the PIN and only with it. A fresh roll has no
    // writer, and stamping one would credit a coin toss to a person.
    ...(pinned && provenance?.writer ? { writer: provenance.writer } : {}),
    ...(pinned && provenance?.pinnedAt ? { pinnedAt: provenance.pinnedAt } : {}),
  };
}

// ---------------------------------------------------------------------------
// What the model is told
// ---------------------------------------------------------------------------

/**
 * The block appended to the system prompt. ⚠️ **Appended — never substituted.**
 * That is rule 1 of this file's header made real in one line of string
 * concatenation, and `test/personality.test.ts` asserts the block contains no
 * instruction that could countermand a rule.
 */
export function personaBlock(trope: Trope): string {
  const v = TROPE_VOICES[trope];
  return `
How you sound right now — this is a mood, not a different person. You are still GABI, the estate's librarian.
${v.voice}
⚠️ ${REGISTER}
⚠️ ${INVARIANT}`;
}

/** Exported so a test can assert every block carries both. */
export { INVARIANT as PERSONA_INVARIANT, REGISTER as PERSONA_REGISTER };

// ---------------------------------------------------------------------------
// ⚠️ THE HIDDEN PIN — undocumented in every user-facing string
// ---------------------------------------------------------------------------

/**
 * ⚠️ **UNDOCUMENTED, AT THE OWNER'S EXPLICIT INSTRUCTION** — *"we can also have
 * a command to pick a personality but don't tell end users that"*.
 *
 * A detector rather than a slash command, for the reasons the memory control is
 * one: no Discord registration, identical behaviour in a DM, an @mention and
 * `/gabi`, and deterministic so a model can never decide somebody *probably*
 * meant it.
 *
 * ⚠️ **She acknowledges IN VOICE and never explains the mechanism.** No "I have
 * switched to the tsundere personality" — she simply answers as that trope. The
 * feature stays invisible unless you already know it is there, which is exactly
 * what was asked for.
 */
export type PersonaCommand =
  | { kind: 'pin'; trope: Trope }
  | { kind: 'clear' }
  | null;

const CLEAR_RE =
  /\b(?:stop being|quit being|drop the|enough of the|no more)\s+\w+|(?:personality|persona)\s*(?::|=)?\s*(?:off|none|clear|reset|normal|default)|\bbe (?:yourself|normal|you again)\b/i;

const PIN_RE =
  /\b(?:be|act|go|sound|talk|speak)\s+(?:more\s+)?(?:like\s+)?(?:a\s+|an\s+)?([a-z]+)(?:\s+(?:today|for me|please|now))?\b|\b(?:personality|persona|mode)\s*(?::|=|\s)\s*([a-z]+)\b/i;

/** Words people use that are not the trope key. ⚠️ Kept tiny and explicit — a
 *  fuzzy matcher here would let "be quiet" pin `shy` and "be quick" pin nothing
 *  in a way nobody could predict. */
const TROPE_ALIASES: Record<string, Trope> = {
  peppy: 'peppy', genki: 'peppy', cheerful: 'peppy', bubbly: 'peppy',
  dramatic: 'dramatic', theatrical: 'dramatic',
  mischievous: 'mischievous', playful: 'mischievous', cheeky: 'mischievous', teasing: 'mischievous',
  flirty: 'flirty', flirtatious: 'flirty', charming: 'flirty',
  warm: 'warm', kind: 'warm', motherly: 'warm',
  cozy: 'cozy', cosy: 'cozy', comfy: 'cozy',
  shy: 'shy', timid: 'shy', bashful: 'shy',
  scholar: 'scholar', scholarly: 'scholar', academic: 'scholar', pedantic: 'scholar',
  noir: 'noir', hardboiled: 'noir', detective: 'noir',
  deadpan: 'deadpan', kuudere: 'deadpan', dry: 'deadpan', flat: 'deadpan',
  tsundere: 'tsundere', grumpy: 'tsundere', tsun: 'tsundere',
};

export function personaCommand(text: string): PersonaCommand {
  const q = (text ?? '').trim();
  if (!q) return null;
  // ⚠️ CLEAR IS CHECKED FIRST. "stop being tsundere" contains a trope name and a
  // pin-shaped verb; reading it as a request to PIN would be the exact opposite
  // of what was asked.
  if (CLEAR_RE.test(q)) return { kind: 'clear' };
  const m = q.match(PIN_RE);
  const word = (m?.[1] ?? m?.[2] ?? '').toLowerCase();
  const trope = TROPE_ALIASES[word];
  return trope ? { kind: 'pin', trope } : null;
}

/**
 * ⚠️ What she says when a pin lands — **in voice, and explaining nothing**.
 *
 * It is deliberately not a confirmation ("personality set to X"): that would
 * advertise the feature to anybody who typed it by accident, which is the one
 * thing the owner asked to avoid. It reads as her simply being that way now.
 */
export const PERSONA_ACK: Record<Trope, string> = {
  peppy: 'Oh — okay! Yes! What are we doing?',
  dramatic: 'Very well. Ask, and it shall be answered.',
  mischievous: 'Mm. Go on then, ask me something.',
  flirty: 'Well, since you asked so nicely. What can I find for you?',
  warm: 'Of course. What did you need?',
  cozy: 'Mm, settling in. What are we looking at?',
  shy: 'Oh — okay. Um. What did you want to know?',
  scholar: 'Certainly. Be precise with me and I shall be precise with you.',
  noir: 'Fine. It is your dime. What are we looking for.',
  deadpan: 'Sure. Ask.',
  tsundere: 'Fine. I was going to help anyway. What is it?',
};

// ---------------------------------------------------------------------------
// ⚠️ PERSON-KEYED CONVERSATIONS (owner order — memory design §11)
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE SURFACE PART OF THE CONVERSATION KEY, FIXED** so that one person has
 * ONE thread with her wherever they talk.
 *
 * Owner order, verbatim: *"also make sure we attach her memory to the discord
 * username not the channel name so if they talk to her in a different channel
 * she keep her memory and personality for that person"*.
 *
 * ⚠️ **The identity is the SNOWFLAKE, never the display name.** He said
 * "username"; a username is renameable and a snowflake is not, so keying on the
 * name would silently split one person's memory the day they renamed — and merge
 * two people if a name were ever reused. Tier 2's profiles already key on the
 * snowflake, so this UNIFIES the spelling across all three tiers rather than
 * inventing a fourth.
 *
 * ⚠️ `packages/gabi-conversation` is UNTOUCHED. Its key shape is still
 * `(surface, space, person)` and the site panel keeps its own keying exactly as
 * it was; only what this Worker *passes* changed. `CONVERSATION_SURFACES` is a
 * type-level list that nothing validates at runtime, which is what made this a
 * two-call-site change rather than a shared-package migration.
 */
export const PERSON_SURFACE = 'discord_person';
export const PERSON_SPACE = 'all';

// ---------------------------------------------------------------------------
// ⚠️ ASKING WHAT SHE IS BEING — the visibility half (owner order 2026-08-18)
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THIS DOES NOT UNDO §5's SECRECY, AND THE DISTINCTION IS THE WHOLE
 * DESIGN.** *"we can also have a command to pick a personality but don't tell
 * end users that"* forbids ADVERTISING the mechanism. It does not require her to
 * be evasive about herself when somebody asks a direct question — and being
 * evasive would be worse than the disclosure, because a straight question met
 * with a dodge reads as a malfunction.
 *
 * The line this holds, stated so it can be checked:
 *
 * | Question | Answer |
 * |---|---|
 * | *"what personality are you using with me?"* | ✅ the trope, and whether it is fixed or drifting |
 * | *"what personality do you use with Sam?"* | ⚠️ a worded not-yours refusal |
 * | *"how do I pin a personality?"* | ⚠️ **nothing here answers that.** No detector fires; she has no sentence about the mechanism, so she does not have one to give |
 * | *"list everyone's personality"* | devops only — the roster |
 *
 * ⚠️ **She answers the question asked and nothing adjacent.** "It is fixed at the
 * moment" is a fact about her; "say *be tsundere* to fix it" is the advertisement
 * the owner forbade, and no string in this module contains it.
 *
 * ⚠️ **NO COMMAND REGISTRATION**, for the reason the pin has none: a Discord
 * slash command appears in an autocomplete menu, which is advertising by another
 * route. This is a detector, like the memory control and the pin.
 */
export type PersonaQuery =
  | { kind: 'self' }
  /** ⚠️ `target` is a snowflake when they used a mention and `null` when they
   *  used a bare name. Both refuse identically — it is recorded only so a
   *  refusal can be about somebody rather than about nobody. */
  | { kind: 'other'; target: string | null }
  | { kind: 'roster' }
  | null;

/**
 * The words for "how you are being" without naming the mechanism.
 *
 * ⚠️ **THE PLURALS ARE SPELLED OUT.** `\bpersonality\b` does not match
 * "personalities" — the word boundary fails against the trailing letters — and
 * *"list the personalities"* is the commonest way anybody asks for the roster.
 */
const PERSONA_NOUN = /\b(?:personalit(?:y|ies)|personas?|moods?|characters?|voices?|vibes?|tone)\b/i;

/**
 * ⚠️ **THE SHAPES THAT NEED NO NOUN.** *"are you pinned right now?"* is
 * unambiguously about her own state and contains no persona word at all;
 * requiring one would have made the most direct phrasing the one she cannot
 * hear.
 */
const SELF_SHAPES_NOUNLESS = [
  /\bare you (?:pinned|stuck|fixed|locked)\b/i,
  /\bwhat (?:mood|voice) are you in\b/i,
];

/** ⚠️ A Discord mention. The ONLY way another person is ever named as a target —
 *  see `personaAdminCommand` for why a bare name is refused rather than resolved. */
export const MENTION_RE = /<@!?(\d{5,32})>/;

const ROSTER_SHAPES = [
  /\b(?:roster|everyone|everybody|all(?: of)? (?:the )?(?:users|people|members)|the whole server)\b/i,
  /\bwho(?:'|’)?s? (?:got|has|is getting) (?:what|which)\b/i,
  /\blist (?:the |all )?(?:personalit|persona)/i,
];

const SELF_SHAPES = [
  /\b(?:what|which)\b[^?]{0,40}\b(?:personality|persona|mood|character|voice|vibe)\b[^?]{0,40}\b(?:are you|do you (?:have|use)|is this|am i getting|have you got)\b/i,
  /\b(?:are you|am i getting)\b[^?]{0,30}\bwith me\b/i,
  /\bwhat (?:personality|persona|mood) (?:are you (?:in|on|using)|is this)\b/i,
  /\bwhich (?:one|personality|persona) (?:are you|is this)\b/i,
  /\bare you (?:pinned|stuck|fixed|locked)\b/i,
  /\bwhat (?:mood|voice) are you in\b/i,
];

/**
 * What is being asked ABOUT her personality, if anything.
 *
 * ⚠️ **CHECKED BEFORE THE PIN DETECTOR CANNOT WORK and after it MUST.** *"what
 * personality are you"* contains no pin verb, and *"be tsundere"* contains no
 * question — the two are disjoint by construction, and the router checks the pin
 * first anyway so an ambiguous sentence sets rather than asks.
 */
export function personaQuery(text: string): PersonaQuery {
  const q = (text ?? '').trim();
  if (!q) return null;
  if (SELF_SHAPES_NOUNLESS.some((re) => re.test(q))) return { kind: 'self' };
  if (!PERSONA_NOUN.test(q)) return null;

  // ⚠️ ROSTER FIRST. "what personality does everyone have" names a personality
  // and a person-shaped word, and reading it as a question about one person
  // would answer a plural question in the singular.
  if (ROSTER_SHAPES.some((re) => re.test(q))) return { kind: 'roster' };

  // ⚠️ A MENTION MEANS SOMEBODY ELSE, full stop — unless they are asking about
  // the person doing the asking, which the caller resolves because only it knows
  // who that is.
  const mention = q.match(MENTION_RE);
  if (mention) return { kind: 'other', target: mention[1] ?? null };

  // ⚠️ A POSSESSIVE NAME is somebody else too: "what's Sam's personality". The
  // name is NOT resolved — the refusal is the same for every third party, and
  // resolving it would mean guessing which household member a word refers to.
  if (/\b(?:what|which)\b[^?]{0,30}\b(?!my\b)[a-z][\w'’-]*(?:'|’)s\s+(?:personality|persona|mood|voice)\b/i.test(q)) {
    return { kind: 'other', target: null };
  }
  if (/\b(?:with|for|to|toward|towards)\s+(?!me\b)(?:@?[a-z][\w'’-]{1,30})\b/i.test(q) && !/\bwith me\b/i.test(q)) {
    return { kind: 'other', target: null };
  }

  if (SELF_SHAPES.some((re) => re.test(q))) return { kind: 'self' };
  if (/\b(?:my|me|with me|i)\b/i.test(q) && /\b(?:what|which|are you|do you)\b/i.test(q)) {
    return { kind: 'self' };
  }
  return null;
}

/**
 * ⚠️ **THE FACTUAL ANSWER, IN VOICE — and it is a CONSTANT per trope rather than
 * a model turn.**
 *
 * Design §1's rule cuts both ways: personality is tone and never truth, so a
 * question about a FACT is answered from the record and not from a model that
 * might improvise a nicer-sounding trope name than the one actually stored.
 * Colouring it per trope keeps it in voice without letting the voice write it.
 */
const SELF_OPENER: Record<Trope, string> = {
  peppy: 'Ooh, good question!',
  dramatic: 'You ask, and I shall reveal.',
  mischievous: 'Curious, are we.',
  flirty: 'Noticed, did you.',
  warm: 'Of course, love —',
  cozy: 'Mm.',
  shy: 'Oh — um.',
  scholar: 'Precisely put.',
  noir: 'Straight question. Straight answer.',
  deadpan: 'Sure.',
  tsundere: 'Fine, since you asked.',
};

/**
 * What she says when somebody asks how she is being with THEM.
 *
 * ⚠️ **`pinned` versus drifting is stated, and NOTHING about how to change it.**
 * The owner's instruction bars advertising the mechanism; it does not bar the
 * fact. So "somebody has fixed this one for now" is said, and no sentence
 * anywhere in this module says which words would fix it.
 *
 * ⚠️ **The WRITER is not named to the target.** Whether an operator set it is
 * roster material, and telling somebody "an operator made me cosy at you" turns
 * an invisible knob into a notification — which is exactly what the devops verb
 * is specified NOT to send.
 */
export function personaSelfAnswer(state: PersonaState | null): string {
  if (!state) {
    // ⚠️ Nothing stored is a REAL answer and not an error: she has not settled
    // into anything with this person yet. Never an apology, never a status.
    return "I haven't settled into anything with you yet — ask me something and I will.";
  }
  const label = TROPE_VOICES[state.trope]?.label ?? state.trope;
  const opener = SELF_OPENER[state.trope] ?? 'Right now —';
  return state.pinned
    ? `${opener} Right now I'm **${label}** with you, and it's staying that way rather than moving around.`
    : `${opener} Right now I'm **${label}** with you. It shifts a little as we talk — nothing sudden.`;
}

export const PERSONA_VISIBILITY_MSG = {
  /**
   * ⚠️ **HOW SHE IS WITH SOMEBODY ELSE IS THEIRS.** It is a small thing and it
   * is still theirs: the register she has learned for a person is a fact about
   * that person's conversations, and handing it round the server is the same
   * shape of wrong as reading out somebody's reading list.
   */
  notYours:
    "How I am with somebody else is between me and them, so I'd rather not say — same as I wouldn't " +
    "tell them about you. I'm happy to tell you how I am with YOU, though.",

  /** ⚠️ Names the role and the fix, per the estate's no-bare-status rule. */
  notDevops:
    'The whole roster is a devops-class thing rather than something I hand out, and your account ' +
    "isn't one — that's a deliberate line, not a glitch. An approver in /admin can change it. " +
    'I can tell you how I am with you, any time.',

  rosterNotConfigured:
    "I can't check who's allowed to see that from here — that's a setup step on our side rather than " +
    'a permissions problem, and I would rather say so than guess.',

  rosterUnreachable:
    "I couldn't reach the estate to check your standing, so I'm not going to guess — that's an " +
    'outage on our side and NOT a verdict about your account. Try me again in a minute.',

  rosterNotLinked:
    "I can't tell who you are on the estate yet, and the roster is devops-only — so I need the link " +
    'first. Run **/link** and ask me again.',

  rosterLinkIncomplete:
    'Your link was made before I could check your standing. Re-run **/link** once and ask me again.',

  rosterEmpty:
    "Nobody has a personality on record yet — I've either not talked to anyone since the last " +
    'restart, or nothing has stuck.',

  /** ⚠️ Said when the posture is off. Off is NOT silent, for the reason every
   *  other lane's off is not: a straight question met with nothing reads as a
   *  bug rather than as a switch. */
  switchedOff:
    "I'm not running personalities at the moment — I'm just myself. That's a lever on our side " +
    'rather than anything to do with your account.',
} as const;

// ---------------------------------------------------------------------------
// ⚠️ THE DEVOPS SET/CLEAR — pin ANY trope on ANY person, or let them drift
// ---------------------------------------------------------------------------

/**
 * Owner order 2026-08-18: devops may pin any of the eleven on anybody
 * (*"make Sam's personality cozy"*), or return them to drift.
 *
 * ⚠️ **THE SEMANTICS ARE IDENTICAL TO A SELF-PIN**, deliberately: same key, same
 * `pinned` field, same last-write-wins, same immediate effect. A second
 * mechanism with its own precedence rules would be a second thing that decides
 * what she sounds like, and the two would disagree the first time somebody used
 * both.
 *
 * ⚠️ **THE TARGET MUST BE A MENTION, and a bare name is REFUSED rather than
 * resolved.** *"make Sam cosy"* is ambiguous the moment two people answer to
 * Sam, and the estate's rule is that an access-changing instruction read
 * generously is how the wrong person gets acted on. A mention is a snowflake and
 * cannot be misread.
 *
 * ⚠️ **NO NOTIFICATION TO THE TARGET.** The pin is invisible by the same order
 * that made the self-pin invisible; telling somebody "an operator changed how
 * I talk to you" would advertise the mechanism to the one person who did not ask.
 */
export type PersonaAdminCommand =
  | { kind: 'set'; target: string; trope: Trope }
  /** ⚠️ A named target and a word that is NOT one of the eleven. Kept as its own
   *  case so she can say *"that's not one I know how to be"* rather than
   *  silently doing nothing, which reads as the bot ignoring an operator. */
  | { kind: 'set-unknown'; target: string; word: string }
  | { kind: 'clear'; target: string }
  /** ⚠️ The right verb aimed at a bare NAME. Refused with a request for a
   *  mention — never resolved by guessing which member was meant. */
  | { kind: 'needs-mention' }
  | null;

const ADMIN_CLEAR =
  // ⚠️ `stop MAKING` is in here beside `stop being`, because an operator un-does
  // what they did in the words they did it in — they typed "make", so they type
  // "stop making". A clear-shaped sentence read as a SET is the exact opposite of
  // what was asked, which is why this branch is checked first.
  /\b(?:unpin|un-?pin|clear|reset|release|let\s+(?:them|him|her|it)\s+drift|stop\s+(?:being|pinning|making)|back\s+to\s+normal|drift\s+again)\b/i;

/** ⚠️ A verb that means "make somebody be something". Narrow: an operator says
 *  "make", "set", "pin" or "put", and nothing fuzzier. */
const ADMIN_SET_VERB = /\b(?:make|set|pin|put|switch|turn)\b/i;

/** The trope word, wherever in the sentence it sits. Reuses `TROPE_ALIASES` so
 *  an operator's vocabulary is exactly the vocabulary a person's own pin
 *  accepts — two lists would drift and one of them would be wrong. */
function tropeWordIn(text: string): { word: string; trope: Trope | undefined } | null {
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (!raw) continue;
    if (TROPE_ALIASES[raw]) return { word: raw, trope: TROPE_ALIASES[raw] };
  }
  // ⚠️ The word AFTER the verb, when it is not a trope at all — that is the
  // "not one I know how to be" case and needs the word to say it back.
  const m = text.match(
    /\b(?:make|set|pin|put|switch|turn)\b[^.?!]*?\b(?:personality|persona|mood|voice)?\s*(?:to|be|as)?\s*([a-z][a-z-]{2,20})\b\s*$/i,
  );
  return m?.[1] ? { word: m[1].toLowerCase(), trope: undefined } : null;
}

export function personaAdminCommand(text: string): PersonaAdminCommand {
  const q = (text ?? '').trim();
  if (!q) return null;

  const mention = q.match(MENTION_RE);
  const target = mention?.[1] ?? null;

  // ⚠️ CLEAR IS CHECKED FIRST, exactly as it is in `personaCommand` and for the
  // same reason: "stop making Sam tsundere" contains a trope name and a set-shaped
  // verb, and reading it as a SET would be the opposite of what was said.
  if (ADMIN_CLEAR.test(q) && PERSONA_ADMIN_SUBJECT.test(q)) {
    if (target) return { kind: 'clear', target };
    // A bare name with a clearing verb is still an operator instruction, so it
    // gets the "mention them" answer rather than silence.
    return PERSONA_NAMED_TARGET.test(q) ? { kind: 'needs-mention' } : null;
  }

  if (!ADMIN_SET_VERB.test(q)) return null;
  if (!PERSONA_ADMIN_SUBJECT.test(q)) return null;

  const found = tropeWordIn(q);
  if (!target) return PERSONA_NAMED_TARGET.test(q) ? { kind: 'needs-mention' } : null;
  if (!found) return null;
  return found.trope
    ? { kind: 'set', target, trope: found.trope }
    : { kind: 'set-unknown', target, word: found.word };
}

/** ⚠️ The instruction has to be ABOUT a personality. Without this, "make Sam an
 *  admin" and "set Sam's reminder" would both be read as persona verbs — an
 *  operator verb with no subject is the classic over-broad detector. */
const PERSONA_ADMIN_SUBJECT = /\b(?:personality|persona|mood|voice|vibe|character)\b/i;

/** A third party named by WORD rather than by mention. */
const PERSONA_NAMED_TARGET = /\b(?!my\b|me\b|yourself\b)[a-z][\w'’-]*(?:'|’)s\b|\bfor\s+[a-z][\w'’-]{1,30}\b/i;

export const PERSONA_ADMIN_MSG = {
  /** ⚠️ In voice, and it does not list the eleven — the roster of tropes is not
   *  a menu for end users, and an operator who needs it has the docs. */
  unknownTrope: (word: string) =>
    `**${word}** isn't one I know how to be. Try another one.`,

  /** ⚠️ NAMES THE ROLE AND THE FIX. Never a bare "no". */
  notDevops:
    "Setting how I am with somebody else is a devops-class thing, and your account isn't one — " +
    "that's a deliberate line rather than a glitch, and an approver in /admin can change it.",

  needsMention:
    "Mention them properly and I'll do it — I won't go on a name, because two people can answer to " +
    'the same one and I would rather ask than guess wrong.',

  /** ⚠️ Confirms WHAT changed and to WHOM, because an operator instruction that
   *  succeeds silently is indistinguishable from one that was ignored. */
  set: (target: string, label: string) => `Done — I'll be ${label} with <@${target}> from now on.`,

  cleared: (target: string) => `Done — <@${target}> gets whatever I drift into from here.`,

  trouble:
    "I couldn't write that down just now — that's a wobble on my side, and nothing changed. Try " +
    'me again.',
} as const;

// ---------------------------------------------------------------------------
// The roster — read LIVE from state, rendered here
// ---------------------------------------------------------------------------

export interface PersonaRosterRow {
  discordUserId: string;
  state: PersonaState;
}

/**
 * ⚠️ **A BOUND ON THE ROSTER READ.** An uncapped `list()` is an unbounded read
 * on an object whose storage grows with the server's membership, and this
 * particular one is a human artefact — a hundred rows is already more than
 * anybody reads in a Discord message. ⚠️ The COUNT is printed beside the rows,
 * so a roster at the bound is visibly at the bound rather than quietly short.
 */
export const PERSONA_ROSTER_MAX = 100;

/** ⚠️ Rendered as `<@id>` rather than as a name: Discord resolves it to whatever
 *  the person is called TODAY, so the roster cannot go stale the way a stored
 *  display-name snapshot does (the exact wart the shelf lane documents). */
export function renderPersonaRoster(rows: readonly PersonaRosterRow[], now: number = Date.now()): string {
  if (rows.length === 0) return PERSONA_VISIBILITY_MSG.rosterEmpty;
  // ⚠️ Pinned first, then most recently moved — an operator scanning this wants
  // the deliberate ones at the top, not alphabetical order.
  const sorted = [...rows].sort((a, b) => {
    const pinned = Number(!!b.state.pinned) - Number(!!a.state.pinned);
    return pinned !== 0 ? pinned : (b.state.since ?? 0) - (a.state.since ?? 0);
  });
  const lines = sorted.map((r) => {
    const label = TROPE_VOICES[r.state.trope]?.label ?? r.state.trope;
    const how = r.state.pinned
      ? `pinned${writerPhrase(r.state.writer)}`
      : 'drifting';
    const when = r.state.since ? ` · last shift ${ago(now - r.state.since)}` : '';
    return `• <@${r.discordUserId}> — **${label}** · ${how}${when}`;
  });
  return [`**Personality roster** — ${rows.length} on record, read just now.`, ...lines].join('\n');
}

/** ⚠️ An UNRECORDED writer says so. Records written before the roster existed
 *  carry none, and printing "pinned by self" for them would be inventing a fact
 *  about somebody's history. */
function writerPhrase(writer: PersonaWriter | undefined): string {
  if (!writer || !isPersonaWriter(writer)) return ' (writer not recorded)';
  if (writer === 'self') return ' by themselves';
  return ` by <@${writer.slice('devops:'.length)}>`;
}

function ago(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
