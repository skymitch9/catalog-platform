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
  countPhrase,
  deOverlap,
  deriveCeiling,
  MAX_COUNT_QUOTES,
  MAX_COUNT_VARIANTS,
  MAX_QUOTE_CHARS,
  phraseWords,
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

// ---------------------------------------------------------------------------
// ⚠️ THE PHRASE COUNT (`docs/info/gabi-phrase-count-and-read-state.md` §4)
//
// The live failure: *"how often does Carl say God damn it, Donut"*. `/presence`
// answered 17 (bag of words), `/search` saw 13 chunks behind a top-6 cap, and
// the truth was 14. Every test below fails against one of the two errors that
// produced those numbers — counting per CHUNK, or counting WORDS.
//
// ⚠️ THE FIXTURE IS BUILT AROUND THE SEAM, because that is where both de-overlap
// bugs live and neither is visible in ordinary prose:
//
//   ch0 (chunks 0–1) the phrase sits INSIDE a real 56-char overlap — stored
//                    twice, and a per-chunk tally says 2
//   ch1 (chunks 2–3) the phrase is CUT IN HALF by a seam with no overlap —
//                    stored whole in neither, and a per-chunk tally says 0
//   ch2 (chunk 4)    the three punctuation/case renderings, plus the words that
//                    must NOT match
//   ch3 (chunk 5)    a curly apostrophe
// ---------------------------------------------------------------------------

/** The phrase from the incident, as the transcript renders it. */
const DCC = 'God damn it, Donut';

/** ⚠️ Chunk 1 opens with chunk 0's last 56 characters, exactly as the ingester's
 *  100-character overlap does. Change one character of either and the seam test
 *  stops testing a seam. */
const SEAM = 'Carl sighed and said, God damn it, Donut, put that down.';

function countPack(over: Partial<BookPack> = {}): BookPack {
  const texts = [
    `The stairs went down forever and the stairwell smelled of ozone. ${SEAM}`,
    `${SEAM} Then the mongoliod screamed and the whole floor shook.`,
    'A door opened onto a corridor of screens. Carl looked at the ceiling and muttered, God damn it,',
    'Donut, we are not doing that again. The corridor lights flickered twice.',
    'God damn it. Donut! he shouted. Later he said god damn it donut again, and then GOD DAMN IT, ' +
      'DONUT one last time. He also mentioned donuts and a doughnut, which are not the same thing.',
    'Carl said, that’s enough, Donut. The stairs kept going down and down.',
  ];
  const chapterOfChunk = [0, 0, 1, 1, 2, 3];
  return {
    book_id: 'count-book',
    title: 'A Book To Count In',
    source: 'transcript',
    ingester_version: 1,
    chapters: [
      { index: 0, title: 'One', first_chunk: 0, last_chunk: 1 },
      { index: 1, title: 'Two', first_chunk: 2, last_chunk: 3 },
      { index: 2, title: 'Three', first_chunk: 4, last_chunk: 4 },
      { index: 3, title: 'Four', first_chunk: 5, last_chunk: 5 },
    ],
    chunks: texts.map((text, i) => ({
      ord: i,
      chapter_index: chapterOfChunk[i] ?? 0,
      text,
      start_sec: i * 10,
      end_sec: i * 10 + 9,
    })),
    ...over,
  };
}

test('🔴 the seam is real — chunk 1 opens with chunk 0’s tail, as the ingester writes it', () => {
  // A guard on the FIXTURE, not on the code. If this ever fails, the two
  // de-overlap tests below are silently testing nothing.
  const p = countPack();
  assert.ok(p.chunks[0]?.text.endsWith(SEAM));
  assert.ok(p.chunks[1]?.text.startsWith(SEAM));
  assert.equal(deOverlap(p.chunks[0]!.text, p.chunks[1]!.text).split('God damn it').length - 1, 1);
});

test('⚠️ a phrase inside the chunk OVERLAP counts ONCE, not twice', () => {
  // The 100-character overlap stores the seam text in both chunks. Counting per
  // chunk reports every catchphrase near a boundary twice, silently.
  const a = countPhrase(countPack(), { q: DCC, bound: { kind: 'through_chapter', chapter: 0 } });
  assert.equal(a.total, 1);
  // ⚠️ Cited to chunk 1, the LATER of the two that hold the seam text — both do,
  // so both are truthful, and picking the later one deterministically is what
  // stops the citation wobbling with the overlap length.
  assert.deepEqual(a.by_chapter, [{ index: 0, title: 'One', n: 1, first_start_sec: 10 }]);
});

test('⚠️ a phrase CUT IN HALF by a chunk boundary counts ONCE, not zero', () => {
  // The opposite error, same cause: "God damn it," ends chunk 2 and "Donut,"
  // opens chunk 3, so neither chunk contains the phrase and a per-chunk tally
  // reports it missing. De-overlapped chapter text has it exactly once.
  const p = countPack();
  assert.ok(!p.chunks[2]!.text.toLowerCase().includes('donut'));
  const a = countPhrase(p, {
    q: DCC,
    bound: { kind: 'through_chapter', chapter: 1 },
  });
  assert.equal(a.by_chapter.find((c) => c.index === 1)?.n, 1);
});

test('⚠️ the matcher tolerates punctuation, case and collapsed whitespace', () => {
  // "God damn it. Donut!", "god damn it donut" and "GOD DAMN IT, DONUT" are one
  // phrase said three times, not three phrases.
  const a = countPhrase(countPack(), { q: DCC, bound: { kind: 'through_chapter', chapter: 2 } });
  assert.equal(a.by_chapter.find((c) => c.index === 2)?.n, 3);
  assert.match(a.matcher, /case-insensitive/);
});

test('⚠️ a curly apostrophe in the book matches a straight one in the question', () => {
  // Whisper writes ’. Nobody types it.
  const a = countPhrase(countPack(), { q: "that's enough, Donut", bound: { kind: 'whole_book' } });
  assert.equal(a.total, 1);
  assert.equal(a.by_chapter[0]?.index, 3);
});

test('⚠️ word boundaries hold at BOTH ends — "donuts" is not "donut"', () => {
  // Chunk 4 says "Donut" three times, and also says "donuts" and "doughnut".
  // A substring count would answer 4 or 5 and look just as confident.
  const a = countPhrase(countPack(), { q: 'donut', bound: { kind: 'whole_book' } });
  assert.equal(a.by_chapter.find((c) => c.index === 2)?.n, 3);
  const damn = countPhrase(countPack(), { q: 'damn', bound: { kind: 'whole_book' } });
  assert.equal(damn.by_chapter.find((c) => c.index === 2)?.n, 3);
  assert.equal(phraseWords('God damn it, Donut?').join('|'), 'God|damn|it|Donut');
});

test('⚠️ a different SPELLING is not a punctuation variant — "goddamnit" is its own word', () => {
  // The gap that makes `variants` necessary: the separator never matches the
  // empty string, so a run-together spelling is a variant the caller declares
  // and the answer reports — never a silent widening of the phrase.
  const p = countPack({
    chunks: [{ ord: 0, chapter_index: 0, text: 'He said goddamnit Donut and meant it.' }],
    chapters: [{ index: 0, title: 'One', first_chunk: 0, last_chunk: 0 }],
  });
  assert.equal(countPhrase(p, { q: DCC, bound: { kind: 'whole_book' } }).total, 0);
  const withVariant = countPhrase(p, {
    q: DCC,
    variants: ['goddamnit Donut'],
    bound: { kind: 'whole_book' },
  });
  assert.equal(withVariant.total, 1);
  assert.deepEqual(withVariant.by_variant.map((v) => v.n), [0, 1]);
});

test('⚠️ by_chapter is reading order, hit chapters only, with a first timestamp', () => {
  const a = countPhrase(countPack(), { q: DCC, bound: { kind: 'whole_book' } });
  assert.equal(a.total, 5);
  assert.deepEqual(a.by_chapter.map((c) => [c.index, c.n]), [[0, 1], [1, 1], [2, 3]]);
  assert.equal(a.by_chapter[0]?.first_start_sec, 10);
  assert.equal(a.by_chapter[1]?.first_start_sec, 20);
});

test('⚠️ two variants over the same words count ONCE — by_variant always sums to total', () => {
  // This IS the 17-versus-14 error, one layer down: adding per-spelling counts
  // together double-counts every occurrence both spellings cover.
  const a = countPhrase(countPack(), {
    q: DCC,
    variants: ['damn it, Donut'],
    bound: { kind: 'whole_book' },
  });
  assert.equal(a.total, 5);
  assert.equal(a.by_variant.reduce((n, v) => n + v.n, 0), a.total);
  assert.deepEqual(a.by_variant.map((v) => v.n), [5, 0]);
});

test('⚠️ the ceiling hides matches, and hiding them is REPORTED not silent', () => {
  // "He never says it" and "the rest of the book is hidden from me" are
  // different facts, and one of them is a spoiler boundary (§6.3 criterion 6).
  const a = countPhrase(countPack(), { q: DCC, bound: { kind: 'through_chapter', chapter: 0 } });
  assert.equal(a.total, 1);
  assert.equal(a.hidden_by_scope, 4, 'the four later sayings are hidden, not absent');
  assert.equal(a.scope.chunks_visible, 2);
  assert.equal(a.scope.chunks_total, 6);
});

test('⚠️ 0 is a real answer, and it still says what the scope was', () => {
  const a = countPhrase(countPack(), { q: 'banana split', bound: { kind: 'unknown' } });
  assert.equal(a.total, 0);
  assert.deepEqual(a.by_chapter, []);
  assert.equal(a.hidden_by_scope, 0);
  assert.equal(a.scope.bounded, false);
  assert.equal(a.scope.ask, SCOPE_UNKNOWN_ASK);
});

test('variants and quotes are CLAMPED rather than refused, and the clamp is visible', () => {
  const a = countPhrase(countPack(), {
    q: DCC,
    variants: ['a one', 'a two', 'a three', 'a four', 'a five', 'a six', 'a seven'],
    quotes: 99,
  bound: { kind: 'whole_book' },
  });
  assert.equal(a.variants.length, MAX_COUNT_VARIANTS);
  assert.equal(a.variants[0], DCC, 'q counts as one of them, and it is the first');
  assert.equal(a.quotes.length, MAX_COUNT_QUOTES);
});

test('⚠️ quotes come from VISIBLE chunks only and are spread across chapters', () => {
  const a = countPhrase(countPack(), { q: DCC, bound: { kind: 'whole_book' }, quotes: 3 });
  assert.deepEqual(a.quotes.map((q) => q.chapter_index), [0, 1, 2]);
  for (const q of a.quotes) {
    assert.ok(q.text.length <= MAX_QUOTE_CHARS, `${q.text.length} chars`);
    assert.ok(/god damn it/i.test(q.text));
    assert.ok(typeof q.ord === 'number' && q.ord >= 0);
  }
  const bounded = countPhrase(countPack(), {
    q: DCC,
    bound: { kind: 'through_chapter', chapter: 0 },
    quotes: 3,
  });
  assert.equal(bounded.quotes.length, 1, 'nothing past the ceiling may be quoted');
});

test('a quote is centred on its match and never longer than the cap', () => {
  const filler = 'The corridor stretched on and the lights hummed overhead. '.repeat(20);
  const p = countPack({
    chapters: [{ index: 0, title: 'One', first_chunk: 0, last_chunk: 0 }],
    chunks: [{ ord: 0, chapter_index: 0, text: `${filler}God damn it, Donut! ${filler}` }],
  });
  const a = countPhrase(p, { q: DCC, bound: { kind: 'whole_book' }, quotes: 1 });
  const quote = a.quotes[0]?.text ?? '';
  assert.equal(quote.length, MAX_QUOTE_CHARS);
  assert.ok(quote.startsWith('…') && quote.endsWith('…'), quote.slice(0, 40));
  assert.ok(quote.includes('God damn it, Donut'));
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
