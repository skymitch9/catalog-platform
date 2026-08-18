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

/** The stored state. ⚠️ `pinned` outlives a conversation; `exchanges` does not. */
export interface PersonaState {
  trope: Trope;
  exchanges: number;
  since: number;
  /** ⚠️ Set by the hidden pin. While set there is NO drift and NO re-roll. */
  pinned?: Trope;
}

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
  return { trope: next, exchanges, since: now, ...(state.pinned ? { pinned: state.pinned } : {}) };
}

export function freshPersona(trope: Trope, now: number = Date.now(), pinned?: Trope): PersonaState {
  return { trope, exchanges: 0, since: now, ...(pinned ? { pinned } : {}) };
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
