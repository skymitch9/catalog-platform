/**
 * `/guessgame` — the round builder, the clue rules, and the stateless press.
 *
 * The tests that matter most:
 *  - `the title is never a clue, and a giveaway series is withheld` — a puzzle
 *    that contains its own answer is not a puzzle;
 *  - `the distractors are REAL rows, deduplicated` — an invented title would
 *    teach somebody a book that does not exist;
 *  - `parseGuessCustomId refuses anything that is not exactly the shape` — it
 *    is the only thing that trusts a string coming back off a button.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CatalogRow } from '../src/catalog-data.js';
import {
  buildGuessCustomId,
  buildRound,
  buildRoundMessage,
  cluesFor,
  givesItAway,
  GUESS_MSG,
  GUESS_OPTIONS,
  GUESS_PREFIX,
  judgeGuess,
  MIN_CLUES,
  parseGuessCustomId,
} from '../src/guessgame.js';
import { BASE_COMMANDS } from '../src/commands.js';
import { EPHEMERAL, GUESSGAME_COMMAND_NAME, routeInteraction } from '../src/interactions.js';
import { signedPost } from './helpers/signed-post.js';

const row = (over: Partial<CatalogRow>): CatalogRow => ({
  title: 'A Title',
  author: 'An Author',
  narrator: '',
  year: '',
  genre: '',
  duration: '',
  series: '',
  seriesIndex: '',
  seriesSort: null,
  universe: '',
  libraryFormats: [],
  seriesGap: '',
  ...over,
});

/** A deterministic `pick`, so a test asserts an exact round rather than
 * "something plausible happened". */
const sequence = (values: number[]): (() => number) => {
  let i = 0;
  return () => values[i++ % values.length] as number;
};

// ---------------------------------------------------------------------------
// The clues
// ---------------------------------------------------------------------------

test('⚠️ the TITLE and the AUTHOR are never clues — one is the answer, the other gives it away', () => {
  const clues = cluesFor(
    row({ title: 'The Way of Kings', author: 'Brandon Sanderson', narrator: 'Kate Reading', duration: '45:30' }),
  );
  assert.equal(clues.some((c) => c.includes('Way of Kings')), false);
  assert.equal(clues.some((c) => c.includes('Sanderson')), false);
  assert.equal(clues.some((c) => c.includes('Kate Reading')), true);
});

test('⚠️ a series that contains the title is WITHHELD — "Mistborn" of "The Mistborn Saga" is the answer', () => {
  assert.equal(givesItAway('Mistborn', 'The Mistborn Saga'), true);
  assert.equal(givesItAway('The Way of Kings', 'The Stormlight Archive'), false);
  const clues = cluesFor(row({ title: 'Mistborn', series: 'The Mistborn Saga', narrator: 'A', duration: '20:00' }));
  assert.equal(clues.some((c) => c.includes('Mistborn Saga')), false);
});

test('⚠️ an absent field is OMITTED, never filled with a sentinel', () => {
  const clues = cluesFor(row({ title: 'X' }));
  assert.deepEqual(clues, []);
  assert.equal(cluesFor(row({ title: 'X', narrator: 'N' })).length, 1);
});

test('the genre clue uses Audible’s LEAF, which is the informative half', () => {
  const clues = cluesFor(row({ title: 'X', genre: 'Science Fiction & Fantasy:Fantasy', narrator: 'N' }));
  assert.equal(clues.some((c) => c.includes('**Fantasy**')), true);
  assert.equal(clues.some((c) => c.includes('Science Fiction')), false);
});

// ---------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------

const RICH: CatalogRow[] = [
  row({ title: 'Alpha', narrator: 'N1', duration: '10:00', genre: 'A:Fantasy' }),
  row({ title: 'Bravo', narrator: 'N2', duration: '11:00' }),
  row({ title: 'Charlie', narrator: 'N3', duration: '12:00' }),
  row({ title: 'Delta', narrator: 'N4', duration: '13:00' }),
  row({ title: 'Echo', narrator: 'N5', duration: '14:00' }),
];

test('a round offers exactly four REAL, DISTINCT titles and marks one right', () => {
  const round = buildRound(RICH, sequence([0, 0.25, 0.5, 0.75, 0.9, 0.1, 0.3]));
  assert.ok(round);
  assert.equal(round!.options.length, GUESS_OPTIONS);
  assert.equal(new Set(round!.options).size, GUESS_OPTIONS);
  for (const t of round!.options) assert.ok(RICH.some((r) => r.title === t), `${t} must be a real row`);
  assert.ok(round!.correct >= 0 && round!.correct < GUESS_OPTIONS);
  assert.ok(round!.clues.length >= MIN_CLUES);
});

test('⚠️ a shelf too small for four distinct titles yields NO round, worded as our limit', () => {
  assert.equal(buildRound(RICH.slice(0, 3), sequence([0])), null);
  assert.match(GUESS_MSG.noRound, /limit on our side, not a verdict on the shelf/);
});

test('⚠️ a shelf whose rows carry no facts yields no round rather than a coin flip', () => {
  const bare = ['A', 'B', 'C', 'D', 'E'].map((t) => row({ title: t }));
  assert.equal(buildRound(bare, sequence([0, 0.2, 0.4, 0.6, 0.8])), null);
});

// ---------------------------------------------------------------------------
// custom_id — the only thing that trusts a string off a button
// ---------------------------------------------------------------------------

test('the custom_id round-trips, and is well inside Discord’s 100-character ceiling', () => {
  const id = buildGuessCustomId(2, 3);
  assert.equal(id, `${GUESS_PREFIX}|2|3`);
  assert.ok(id.length <= 100);
  assert.deepEqual(parseGuessCustomId(id), { chosen: 2, correct: 3 });
});

test('parseGuessCustomId refuses anything that is not exactly the shape', () => {
  for (const bad of [
    'gg|2',
    'gg|2|3|4',
    'pv|2|3',
    'gg|a|3',
    'gg|2|b',
    `gg|${GUESS_OPTIONS}|1`,
    `gg|1|${GUESS_OPTIONS}`,
    '',
  ]) {
    assert.equal(parseGuessCustomId(bad), null, `${bad} must not parse`);
  }
});

test('the round message wires one button per option, each carrying the same answer index', () => {
  const round = { options: ['A', 'B', 'C', 'D'], correct: 1, clues: ['x', 'y'] };
  const msg = buildRoundMessage(round) as { components: { components: { custom_id: string }[] }[] };
  const ids = msg.components[0]!.components.map((b) => b.custom_id);
  assert.deepEqual(ids, ['gg|0|1', 'gg|1|1', 'gg|2|1', 'gg|3|1']);
});

test('the round says everybody can play — the answer is private, so nobody spoils it', () => {
  const msg = buildRoundMessage({ options: ['A', 'B', 'C', 'D'], correct: 0, clues: ['x'] }) as {
    embeds: { footer: { text: string } }[];
  };
  assert.equal(msg.embeds[0]!.footer.text, GUESS_MSG.footer);
});

test('judging is by index, and a wrong answer names the right one without shaming', () => {
  assert.match(judgeGuess(1, 1), /Correct/);
  assert.match(judgeGuess(0, 2), /answer was \*\*option 3\*\*/);
});

// ---------------------------------------------------------------------------
// The registry and the router
// ---------------------------------------------------------------------------

test('/guessgame is registered and takes no options', () => {
  const cmd = BASE_COMMANDS.find((c) => c.name === GUESSGAME_COMMAND_NAME) as
    | { options?: unknown[] }
    | undefined;
  assert.ok(cmd);
  assert.equal(cmd!.options, undefined);
});

test('⚠️ the ROUND is public and the PRESS is private — that split is the whole game', async () => {
  const posted = await signedPost({
    type: 2,
    token: 'tok',
    application_id: 'app',
    data: { name: GUESSGAME_COMMAND_NAME },
    member: { user: { id: 'u1' } },
  });
  const round = (await posted.json()) as { type: number; data: { flags?: number } };
  assert.equal(round.type, 5);
  assert.equal(round.data.flags, undefined, 'the round must be visible to the channel');

  const press = await signedPost({
    type: 3,
    token: 'tok',
    application_id: 'app',
    data: { custom_id: 'gg|1|1' },
    member: { user: { id: 'u2' } },
  });
  const answer = (await press.json()) as { type: number; data: { content: string; flags: number } };
  // ⚠️ Type 4, not 5: judging is two integers and no I/O, so deferring would
  // add a spinner to an instant answer.
  assert.equal(answer.type, 4);
  assert.equal(answer.data.flags, EPHEMERAL);
  assert.match(answer.data.content, /Correct/);
});

test('a malformed gg| press falls through to the worded bad-component answer', () => {
  const decision = routeInteraction({ type: 3, data: { custom_id: 'gg|9|9' } });
  assert.equal(decision.kind, 'bad_component');
});
