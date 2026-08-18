/**
 * The retrieval core — the four modes, the stitch, and the derived ceiling.
 *
 * ⚠️ Every test here is behaviour-failing against a rule the design argues, and
 * the comment on each names which one. Delete the ceiling comparison and the
 * scope tests serve the whole book; collapse `earliest` into `relevant` and the
 * ordinal tests return the densest passage instead of the first one.
 *
 * These prove the DECISIONS on a synthetic pack. Behaviour against the REAL
 * Primal Hunter book-1 pack was exercised separately against the deployed route
 * — see the build report; a unit test cannot hold a 452 KB gzipped object.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  boundVersionRefusal,
  deOverlap,
  deriveCeiling,
  presenceInPack,
  queryTerms,
  searchPack,
  SCOPE_UNKNOWN_ASK,
  statKeyCount,
  stitchPassage,
  type BookPack,
} from '../src/book-retrieval.js';

/**
 * Three chapters, ten chunks. Chapter 1 is the "early" one, chapter 3 the
 * "late" one, and the marker word `zephyr` appears once early and once late so
 * `earliest` and `latest` must disagree.
 */
function pack(over: Partial<BookPack> = {}): BookPack {
  const texts = [
    'The opening pages, in which nothing at all happens to anybody.',
    'A stranger named Zephyr is mentioned once, in passing, at a crowded market.',
    'More scene setting with no names in it whatsoever.',
    'The middle of the book, a long stretch about weather and roads.',
    'Zephyr again, and again, and Zephyr a third time, densely, in the middle.',
    'Still the middle, still nothing of consequence being decided here.',
    'Name: Ilse\nRace: Human\nClass: Ranger\nLevel: 12\nStrength: 7\nAgility: 9',
    'The late chapter opens on a quiet morning after the long march north.',
    'Status. Name, Ilse. Race, human. Class, ranger, level 40. Strength, 22. Agility, 30. Perception, 18.',
    'Zephyr is named one last time, at the very end of the book.',
  ];
  return {
    book_id: 'test-book',
    title: 'A Test Book',
    source: 'transcript',
    ingester_version: 1,
    chapters: [
      { index: 0, title: 'One', first_chunk: 0, last_chunk: 2, start_sec: 0 },
      { index: 1, title: 'Two', first_chunk: 3, last_chunk: 6, start_sec: 100 },
      { index: 2, title: 'Three', first_chunk: 7, last_chunk: 9, start_sec: 200 },
    ],
    chunks: texts.map((text, i) => ({
      ord: i,
      chapter_index: i <= 2 ? 0 : i <= 6 ? 1 : 2,
      text,
      start_sec: i * 10,
      end_sec: i * 10 + 9,
    })),
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The four modes
// ---------------------------------------------------------------------------

test('relevant ranks by density — the densest Zephyr passage wins', () => {
  const a = searchPack(pack(), {
    query: 'Zephyr',
    mode: 'relevant',
    bound: { kind: 'whole_book' },
  });
  assert.equal(a.passages[0]?.ord, 4, 'chunk 4 says the name three times');
});

test('⚠️ earliest returns the FIRST mention, which relevance ranks last', () => {
  // The pilot's headline miss: BM25 scores density, and a first appearance is by
  // construction the least dense mention. `relevant` puts chunk 1 behind chunk 4.
  const a = searchPack(pack(), {
    query: 'Zephyr',
    mode: 'earliest',
    bound: { kind: 'whole_book' },
  });
  assert.equal(a.passages[0]?.ord, 1);
  assert.match(a.note ?? '', /FIRST position/);
});

test('⚠️ latest returns the LAST mention, not the best one', () => {
  const a = searchPack(pack(), {
    query: 'Zephyr',
    mode: 'latest',
    bound: { kind: 'whole_book' },
  });
  assert.equal(a.passages[0]?.ord, 9);
});

test('⚠️ a stat question selects the LAST stat block by ORDINAL, not by score', () => {
  // Design §6.2 step ④. Chunk 6 is the more complete-looking sheet; chunk 8 is
  // the current one. Ordinary relevance would return the early baseline.
  const a = searchPack(pack(), {
    query: "what is Ilse's stat sheet",
    mode: 'latest',
    bound: { kind: 'whole_book' },
  });
  assert.equal(a.stat_detector, true);
  assert.equal(a.passages[0]?.ord, 8);
  assert.match(a.note ?? '', /LAST position/);
});

test('the stat detector reads BOTH renderings — anchored lines and spoken runs', () => {
  // §6.2 for print, §6.4's measured correction for speech. A transcript states a
  // sheet as a flat comma-separated run and the `^Key:` form matches none of it.
  assert.ok(statKeyCount('Name: Ilse\nRace: Human\nLevel: 12\nStrength: 7') >= 4);
  assert.ok(statKeyCount('Stats. Strength, 7. Agility, 8. Endurance, 7. Level, 12.') >= 4);
  assert.equal(statKeyCount('He levelled the ground and checked his strength of will.'), 0);
});

test('⚠️ presence answers with counts and a first sighting, never passages', () => {
  const p = presenceInPack(pack(), 'Zephyr', { kind: 'whole_book' });
  assert.equal(p.chunk_hits, 3);
  assert.equal(p.first_ord, 1);
  assert.equal(p.first_chapter, 0);
  assert.equal(p.last_ord, 9);
});

test('⚠️ presence reports ABSENCE as a real answer, not as an empty list', () => {
  // The whole point of the mode: "she is not in this book" is the fact top-K
  // silently omits, and it is the one the reader asked for.
  const p = presenceInPack(pack(), 'Miranda', { kind: 'whole_book' });
  assert.equal(p.chunk_hits, 0);
  assert.deepEqual(p.terms_missing, ['miranda']);
  assert.equal(p.first_ord, undefined);
});

test('⚠️ presence distinguishes "absent" from "past where you are"', () => {
  // Two different facts, and one of them is a spoiler boundary (§6.3 criterion 6).
  const p = presenceInPack(pack(), 'Zephyr', { kind: 'through_chapter', chapter: 0 });
  assert.equal(p.chunk_hits, 1);
  assert.equal(p.hidden_by_scope, 2, 'the two later mentions are hidden, not absent');
});

// ---------------------------------------------------------------------------
// The derived ceiling
// ---------------------------------------------------------------------------

test('through_chapter derives the ceiling from THIS pack’s chapter table', () => {
  const s = deriveCeiling(pack(), { kind: 'through_chapter', chapter: 1 });
  assert.equal(s.ceiling, 6);
  assert.equal(s.bounded, true);
  assert.equal(s.ceiling_chapter, 1);
});

test('⚠️ nothing past the ceiling can be returned, or even scored', () => {
  const a = searchPack(pack(), {
    query: 'Zephyr',
    mode: 'latest',
    bound: { kind: 'through_chapter', chapter: 0 },
  });
  assert.equal(a.passages.length, 1);
  assert.equal(a.passages[0]?.ord, 1, 'the late mentions are invisible, not merely unranked');
  assert.equal(a.scope.chunks_visible, 3);
  assert.equal(a.scope.chunks_total, 10);
});

test('⚠️ unknown is NOT "no limit" — it carries the sentence she has to say', () => {
  // Design §4.5: absence of a position means UNKNOWN, never "unread" and never
  // "finished". A silent whole-book answer here is the spoiling direction.
  const a = searchPack(pack(), { query: 'Zephyr', mode: 'relevant', bound: { kind: 'unknown' } });
  assert.equal(a.scope.bounded, false);
  assert.equal(a.scope.ask, SCOPE_UNKNOWN_ASK);
});

test('⚠️ an ord bound from a DIFFERENT ingester_version is refused, not warned about', () => {
  // The 28-chapter leak (§4.3): the same ord means a different place at a
  // different chunking, it produces no error, and nothing in the answer looks
  // wrong. So it is a hard refusal.
  const refusal = boundVersionRefusal(pack(), {
    kind: 'through_ord',
    ord: 400,
    ingesterVersion: 2,
  });
  assert.ok(refusal && refusal.includes('version 2'));
  assert.equal(
    boundVersionRefusal(pack(), { kind: 'through_ord', ord: 4, ingesterVersion: 1 }),
    null,
  );
});

test('a chapter bound past the end of the book CLAMPS rather than extrapolating', () => {
  const s = deriveCeiling(pack(), { kind: 'through_chapter', chapter: 99 });
  assert.equal(s.ceiling, 9);
});

// ---------------------------------------------------------------------------
// The stitch
// ---------------------------------------------------------------------------

test('a hit comes back stitched with its ±1 neighbours', () => {
  const p = stitchPassage(pack(), 4);
  assert.deepEqual(p?.ord_span, [3, 5]);
  assert.equal(p?.stitch, 'full');
  assert.ok(p?.text.includes('weather and roads'));
  assert.ok(p?.text.includes('nothing of consequence'));
});

test('⚠️ the stitch is CLAMPED to the chapter — a passage never straddles one', () => {
  // §7.3 step 3: a chunk that crosses a chapter boundary cannot be scoped and
  // cannot be cited. Chunk 3 is the first of chapter 1, so its left neighbour
  // (chunk 2, chapter 0) must not be pulled in.
  const p = stitchPassage(pack(), 3);
  assert.deepEqual(p?.ord_span, [3, 4]);
  assert.equal(p?.stitch, 'reduced');
  assert.ok(!p?.text.includes('no names in it whatsoever'));
});

test('the de-overlap removes the duplicated seam rather than repeating it', () => {
  assert.equal(deOverlap('the quick brown fox jumps', 'brown fox jumps over the dog'),
    'the quick brown fox jumps over the dog');
});

test('⚠️ adjacent hits do not come back as two near-identical passages', () => {
  // Measured on the real book-1 pack: `latest` picked ords 1547 and 1546, whose
  // ±1 spans share two chunks of three. Two passages that are 90% the same text
  // spend the turn's byte budget saying one thing twice.
  const dense = pack({
    chunks: pack().chunks.map((c, i) =>
      i === 8 || i === 9 ? { ...c, text: 'Zephyr Zephyr Zephyr' } : c,
    ),
  });
  const a = searchPack(dense, { query: 'Zephyr', mode: 'latest', bound: { kind: 'whole_book' } });
  const ords = a.passages.map((p) => p.ord);
  assert.ok(ords.every((o, i) => i === 0 || Math.abs(o - ords[i - 1]!) > 2), String(ords));
});

// ---------------------------------------------------------------------------
// The honesty contract (§6.3 criterion 6)
// ---------------------------------------------------------------------------

test('⚠️ the answer says which query terms were NOT found anywhere in scope', () => {
  // Retrieval never returns nothing. A model told only "answer from these
  // passages" composes a confident answer out of near-misses, which is exactly
  // what the pilot measured. The tool result has to make the gap visible.
  const a = searchPack(pack(), {
    query: 'Zephyr Miranda',
    mode: 'relevant',
    bound: { kind: 'whole_book' },
  });
  assert.deepEqual(a.terms_found, ['zephyr']);
  assert.deepEqual(a.terms_missing, ['miranda']);
});

test('the possessive is one term with the plain name, not a second rare one', () => {
  assert.deepEqual(queryTerms("Jake's stat sheet"), ['jake', 'stat', 'sheet']);
});

test('⚠️ alias expansion is REPORTED, never a silent rewrite', () => {
  // Whisper renders "Thayne" as "Thane" in all 43 mentions across books 1–3, so
  // the printed spelling finds nothing in a transcript. Looking for the book's
  // own spelling is right; doing it quietly is not — the answer must be able to
  // say which spelling it read.
  const p = pack({ alias_candidates: { Thane: 21 } });
  const a = searchPack(p, { query: 'Thayne', mode: 'relevant', bound: { kind: 'whole_book' } });
  assert.deepEqual(a.alias_expansions, { thayne: ['thane'] });
});
