/**
 * `/guessgame` — the cover-guessing game, made Discord-native (design proposal
 * P1).
 *
 * ## ⚠️ IT GUESSES FROM FACTS, NOT FROM AN OBSCURED COVER — and that is a
 * ## deliberate departure from P1, recorded here because it is the design call
 *
 * P1 imagined *"an obscured/cropped cover"*, and named the obscuring as *"the
 * fiddly part"*. It is worse than fiddly from here: this Worker has **no image
 * pipeline** — no canvas, no image decoder, no R2 write path for a derived
 * asset — and `catalog-data.ts` deliberately parses `cover_href` and THROWS IT
 * AWAY (its header: keeping the dropped columns *"would multiply the retained
 * memory of every isolate for a feature nobody asked for"*). Cropping a cover
 * would have meant a new binding, a new stored artefact, and a new thing to
 * back up, for a party game.
 *
 * **The facts version costs nothing and plays better.** The catalogue already
 * carries narrator, duration, genre, year, series and universe — five or six
 * real clues per row — so a round is *"45 hours, narrated by Kate Reading and
 * Michael Kramer, filed under The Cosmere: which book?"* with four real titles
 * to pick from. Every clue is a fact the pipeline measured, and the wrong
 * answers are real books off the same shelf rather than invented ones.
 *
 * ⚠️ **THE ANSWER IS READABLE TO ANYONE WHO INSPECTS THE BUTTON.** The round is
 * STATELESS: `custom_id` is `gg|<chosen>|<correct>`, so a person who opens
 * Discord's developer tools can read the correct index off any of the four
 * buttons. That is an ACCEPTED limit, not an oversight — the alternative is a
 * signed round (a MAC key and a new secret) or a stored round (a new
 * collection to write, expire and back up), and neither is worth spending on a
 * party game in a private household server. If the game ever gains stakes — a
 * leaderboard, a prize — this is the first thing that has to change.
 *
 * ## Scope
 *
 * Public audiobook slice, no credential, no identity, no writes — design's
 * phase-1 tier. The answer press is answered **ephemerally**, so one posted
 * round can be played by everybody in the channel independently rather than
 * being spoiled by the first person to click.
 */

import { loadCatalog, type CatalogRow } from './catalog-data.js';
import { editOriginalMessage } from './discord-api.js';
import { EMBED_COLOR, truncate } from './have.js';

/** The guess button's routing key: `gg|<chosenIndex>|<correctIndex>`. */
export const GUESS_PREFIX = 'gg';

/** How many titles one round offers. Four fits a single action row with room
 * to spare and keeps a blind guess at a respectable 25%. */
export const GUESS_OPTIONS = 4;

/** ⚠️ A round needs a row with enough facts to be guessable. A book with no
 * narrator, no series, no genre and no duration is not a puzzle, it is a
 * coin flip with extra steps — such rows are skipped when picking. */
export const MIN_CLUES = 2;

/** How many times the picker will look for a clue-rich row before giving up
 * and saying so. A rail, so a degenerate catalogue cannot spin. */
export const PICK_ATTEMPTS = 40;

export interface GuessRound {
  /** The four titles offered, in the order they are shown. */
  options: string[];
  /** Which of them is right. */
  correct: number;
  /** The clue lines, already worded. */
  clues: string[];
}

// ---------------------------------------------------------------------------
// custom_id
// ---------------------------------------------------------------------------

export function buildGuessCustomId(chosen: number, correct: number): string {
  return `${GUESS_PREFIX}|${chosen}|${correct}`;
}

/** Strict parse — null on anything that is not exactly the shape above. */
export function parseGuessCustomId(customId: string): { chosen: number; correct: number } | null {
  const parts = customId.split('|');
  if (parts.length !== 3) return null;
  const [prefix, a, b] = parts as [string, string, string];
  if (prefix !== GUESS_PREFIX) return null;
  if (!/^\d$/.test(a) || !/^\d$/.test(b)) return null;
  const chosen = Number(a);
  const correct = Number(b);
  if (chosen >= GUESS_OPTIONS || correct >= GUESS_OPTIONS) return null;
  return { chosen, correct };
}

// ---------------------------------------------------------------------------
// Building a round
// ---------------------------------------------------------------------------

/**
 * The clue lines for one row.
 *
 * ⚠️ **AN ABSENT FIELD IS OMITTED, NEVER GUESSED AND NEVER FILLED WITH A
 * SENTINEL** — `catalog-data.ts`'s own rule for `factsFor`, kept here because a
 * clue that says "narrator: unknown" is a clue about the catalogue rather than
 * about the book.
 *
 * ⚠️ **THE TITLE AND THE AUTHOR ARE NEVER CLUES.** The title is the answer, and
 * on this shelf the author gives it away outright for most series — a
 * Sanderson clue with four titles of which one is his is not a puzzle.
 * The SERIES is likewise withheld when the series name contains the title's
 * first word, for the same reason.
 */
export function cluesFor(row: CatalogRow): string[] {
  const out: string[] = [];
  if (row.narrator) out.push(`🎙️ Narrated by **${truncate(row.narrator, 100)}**`);
  if (row.duration) out.push(`⏱️ **${row.duration}** long`);
  if (row.genre) {
    // The catalogue's genre is Audible's colon-delimited path; the leaf is the
    // informative half ("Science Fiction & Fantasy:Fantasy" → "Fantasy").
    const leaf = row.genre.split(':').pop()?.trim() ?? '';
    if (leaf) out.push(`🏷️ Filed under **${truncate(leaf, 60)}**`);
  }
  if (row.year) out.push(`📅 Catalogued as **${truncate(row.year, 20)}**`);
  if (row.universe) out.push(`🌌 Part of the **${truncate(row.universe, 60)}** universe`);
  if (row.series && !givesItAway(row.title, row.series)) {
    out.push(
      `📚 Volume **${row.seriesIndex || '?'}** of **${truncate(row.series, 80)}**`,
    );
  }
  return out;
}

/** ⚠️ "The Way of Kings" in "The Stormlight Archive" is a fair clue; "Mistborn"
 * in "The Mistborn Saga" is the answer written out. A shared significant word
 * is the test. */
export function givesItAway(title: string, series: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const t = words(title);
  for (const w of words(series)) if (t.has(w)) return true;
  return false;
}

/**
 * Pick one round out of the catalogue.
 *
 * `pick` is injected (a `() => number` in `[0, 1)`) rather than calling
 * `Math.random()` directly, so a test can pin an exact round and assert its
 * clues instead of asserting "something plausible happened".
 *
 * ⚠️ Returns `null` when the shelf cannot furnish a round — too few distinct
 * titles, or no row with `MIN_CLUES` facts. That is a real state (an empty or
 * broken catalogue) and it is worded as our limit rather than as a game over.
 */
export function buildRound(rows: readonly CatalogRow[], pick: () => number): GuessRound | null {
  const usable = rows.filter((r) => r.title.trim().length > 0);
  if (usable.length < GUESS_OPTIONS) return null;

  let answer: CatalogRow | null = null;
  let clues: string[] = [];
  for (let i = 0; i < PICK_ATTEMPTS; i++) {
    const candidate = usable[Math.floor(pick() * usable.length)];
    if (!candidate) continue;
    const c = cluesFor(candidate);
    if (c.length >= MIN_CLUES) {
      answer = candidate;
      clues = c;
      break;
    }
  }
  if (!answer) return null;

  // ⚠️ The distractors are REAL books off the same shelf, deduplicated by
  // title: two identical options would make one of them unanswerable, and an
  // invented title would teach somebody a book that does not exist.
  const chosen: string[] = [answer.title];
  for (let i = 0; i < PICK_ATTEMPTS && chosen.length < GUESS_OPTIONS; i++) {
    const row = usable[Math.floor(pick() * usable.length)];
    if (!row) continue;
    if (chosen.some((t) => t.toLowerCase() === row.title.toLowerCase())) continue;
    chosen.push(row.title);
  }
  if (chosen.length < GUESS_OPTIONS) return null;

  // A deterministic shuffle driven by the same injected `pick`.
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    const a = chosen[i] as string;
    const b = chosen[j] as string;
    chosen[i] = b;
    chosen[j] = a;
  }
  const correct = chosen.findIndex((t) => t === answer.title);
  if (correct < 0) return null;
  return { options: chosen, correct, clues };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const GUESS_MSG = {
  unreachable:
    "GABI could not reach the estate's catalogue just now, so there is no round to play — a service " +
    'problem on the estate side, not something you did. Try again in a minute.',
  noRound:
    "GABI could not build a round from the catalogue just now: it needs at least four books, and at " +
    'least one of them has to carry a couple of facts worth guessing from. That is a limit on our ' +
    'side, not a verdict on the shelf — try again in a minute.',
  badPress:
    'That button is from a round GABI no longer recognises — press one on a fresh `/guessgame` ' +
    'round instead. Nothing went wrong and nothing was recorded.',
  correct: (option: number, title: string) =>
    `✅ **Correct** — option ${option} it was: **${title}**.`,
  wrong: (option: number, correctOption: number) =>
    `❌ Not this time — option ${option} is not it. The answer was **option ${correctOption}**, ` +
    'which is still up there in the round.',
  /** ⚠️ Said on the ROUND, not on the press: everybody in the channel sees one
   * round and each person's press is answered privately, so nobody spoils it
   * for the next reader. */
  footer: 'Everybody can play this round — your answer is shown only to you.',
} as const;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const BUTTON_LABEL_MAX = 80;

export function buildRoundMessage(round: GuessRound): { embeds: unknown[]; components: unknown[] } {
  const lines = round.clues.map((c) => `• ${c}`).join('\n');
  return {
    embeds: [
      {
        title: 'Which book is this?',
        description: truncate(
          `${lines}\n\n` +
            round.options.map((t, i) => `**${i + 1}.** ${truncate(t, 120)}`).join('\n'),
          4000,
        ),
        color: EMBED_COLOR,
        footer: { text: GUESS_MSG.footer },
      },
    ],
    components: [
      {
        type: 1,
        components: round.options.map((t, i) => ({
          type: 2,
          style: 2,
          label: truncate(`${i + 1}. ${t}`, BUTTON_LABEL_MAX),
          custom_id: buildGuessCustomId(i, round.correct),
        })),
      },
    ],
  };
}

/** The private answer to one press. Pure; the flow only decides when to send. */
export function judgeGuess(chosen: number, correct: number, optionLabel?: string): string {
  if (chosen === correct) {
    return GUESS_MSG.correct(correct + 1, optionLabel ?? `option ${correct + 1}`);
  }
  return GUESS_MSG.wrong(chosen + 1, correct + 1);
}

// ---------------------------------------------------------------------------
// The flow — runs in waitUntil after the deferred ack
// ---------------------------------------------------------------------------

export interface GuessContext {
  applicationId: string;
  interactionToken: string;
  catalogBaseUrl: string;
  fetchOverride?: typeof fetch;
  pick?: () => number;
}

/** Post a round. Never throws — a throw leaves Discord's spinner up forever. */
export async function processGuessGame(ctx: GuessContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    const load = await loadCatalog(
      ctx.catalogBaseUrl,
      ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined,
    );
    if (!load.ok) {
      await say({ content: GUESS_MSG.unreachable });
      return;
    }
    const round = buildRound(load.rows, ctx.pick ?? Math.random);
    if (!round) {
      await say({ content: GUESS_MSG.noRound });
      return;
    }
    await say(buildRoundMessage(round));
  } catch (err) {
    console.error('/guessgame failed:', err instanceof Error ? err.message : err);
    try {
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: GUESS_MSG.unreachable,
      });
    } catch {
      // Token expired or Discord is down; nothing further is possible.
    }
  }
}
