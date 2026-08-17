/**
 * The `Range` parsing table — every row of range.ts's contract, plus the two
 * request shapes MEASURED from real readers on 2026-08-17
 * (`library_catalog/docs/info/epub-streaming-findings-2026-08-17.md` §4.2).
 *
 * ⚠️ These are behaviour-failing by construction: an off-by-one anywhere in
 * `parseRange` corrupts a PDF or hangs a reader, and both symptoms are
 * invisible until someone opens a book.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contentRange, parseRange, unsatisfiedContentRange } from '../src/range.js';

/** The White Sand Omnibus, exactly — the file every constraint is sized by. */
const HUGE = 412_436_591;

test('absent, empty and unknown-unit headers all mean "the whole thing"', () => {
  assert.deepEqual(parseRange(null, 100), { kind: 'full' });
  assert.deepEqual(parseRange(undefined, 100), { kind: 'full' });
  assert.deepEqual(parseRange('', 100), { kind: 'full' });
  assert.deepEqual(parseRange('   ', 100), { kind: 'full' });
  // A unit we do not understand is IGNORED, per RFC 9110 §14.2 — never a 416.
  assert.deepEqual(parseRange('items=0-10', 100), { kind: 'full' });
  assert.deepEqual(parseRange('bytes 0-10', 100), { kind: 'full' });
});

test('the closed form, and the boundaries either side of it', () => {
  assert.deepEqual(parseRange('bytes=0-9', 100), { kind: 'range', start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=10-10', 100), { kind: 'range', start: 10, end: 10 });
  // The very last byte.
  assert.deepEqual(parseRange('bytes=99-99', 100), { kind: 'range', start: 99, end: 99 });
  // One past it: understood, and not satisfiable.
  assert.deepEqual(parseRange('bytes=100-100', 100), { kind: 'unsatisfiable' });
});

test('⚠️ bytes=0-0 — the zip.js probe — is ONE byte, not the whole file', () => {
  // Measured: zip.js's HttpRangeReader opens with exactly this to learn whether
  // the origin ranges at all. Answering 200 with 393 MiB here would turn the
  // cheapest request in the session into the most expensive.
  assert.deepEqual(parseRange('bytes=0-0', HUGE), { kind: 'range', start: 0, end: 0 });
});

test('⚠️ the measured ZIP end-of-archive reads land exactly where they should', () => {
  // Verbatim from the 2026-08-17 probe log against the 393 MiB omnibus.
  assert.deepEqual(parseRange('bytes=412436569-412436590', HUGE), {
    kind: 'range',
    start: 412_436_569,
    end: 412_436_590, // the last byte of the file
  });
  assert.deepEqual(parseRange('bytes=412369287-412436568', HUGE), {
    kind: 'range',
    start: 412_369_287,
    end: 412_436_568,
  });
  // The central directory read is 67,282 B — the length the handler must send.
  assert.equal(412_436_568 - 412_369_287 + 1, 67_282);
});

test('an open-ended range runs to the last byte', () => {
  assert.deepEqual(parseRange('bytes=90-', 100), { kind: 'range', start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=0-', 100), { kind: 'range', start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=100-', 100), { kind: 'unsatisfiable' });
});

test('a last-byte-pos past the end CLAMPS, it does not refuse', () => {
  // RFC 9110 §14.1.1, and zip.js relies on it: it guesses how far back the
  // end-of-central-directory record is and over-asks on purpose.
  assert.deepEqual(parseRange('bytes=95-100000', 100), { kind: 'range', start: 95, end: 99 });
});

test('the suffix form takes the LAST n bytes', () => {
  assert.deepEqual(parseRange('bytes=-22', 100), { kind: 'range', start: 78, end: 99 });
  // A suffix larger than the object is the whole object, not an error.
  assert.deepEqual(parseRange('bytes=-500', 100), { kind: 'range', start: 0, end: 99 });
  // ⚠️ bytes=-0 asks for the last zero bytes: unsatisfiable, NOT an empty 206.
  // An empty 206 reads to a client as end-of-file, which stalls the reader.
  assert.deepEqual(parseRange('bytes=-0', 100), { kind: 'unsatisfiable' });
});

test('a zero-byte object satisfies no range at all', () => {
  assert.deepEqual(parseRange('bytes=0-0', 0), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=0-', 0), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=-1', 0), { kind: 'unsatisfiable' });
  // …but no range at all is still a legitimate empty 200.
  assert.deepEqual(parseRange(null, 0), { kind: 'full' });
});

test('⚠️ MALFORMED is ignored (200), not refused (416) — they are different facts', () => {
  // 416 means "understood, and those bytes do not exist". A value we could not
  // parse is neither, and RFC 9110 §14.2 says to ignore it. Collapsing the two
  // would be the indistinguishable-failure pattern this estate forbids.
  for (const bad of [
    'bytes=',
    'bytes=abc',
    'bytes=-',
    'bytes=1.5-3',
    'bytes=1 -3',
    'bytes=+1-3',
    'bytes=0x10-20',
    'bytes=1e3-2000',
    'bytes=10-5', // last < first: an INVALID spec, not an unsatisfiable one
  ]) {
    assert.deepEqual(parseRange(bad, 100), { kind: 'full' }, `${bad} must be ignored`);
  }
});

test('⚠️ MULTI-RANGE is ignored whole — never partially honoured', () => {
  // Answering the first span of a two-span request is the tempting shortcut
  // and it is a corruption bug: the client splices a single 206 into the wrong
  // offsets. Serving everything is slower and right.
  assert.deepEqual(parseRange('bytes=0-1,4-5', 100), { kind: 'full' });
  assert.deepEqual(parseRange('bytes=0-1, -5', 100), { kind: 'full' });
});

test('surrounding whitespace is TOLERATED, not treated as malformed', () => {
  // RFC 9110's list rule permits optional whitespace around a byte-range-spec,
  // and a client that sends `bytes= 1-3` means exactly what it says. Being
  // strict here would answer a 393 MiB body to a request for three bytes.
  assert.deepEqual(parseRange('bytes= 1-3', 100), { kind: 'range', start: 1, end: 3 });
  assert.deepEqual(parseRange('  bytes=1-3  ', 100), { kind: 'range', start: 1, end: 3 });
});

test('the header values a 206 and a 416 must carry', () => {
  assert.equal(contentRange(0, 0, HUGE), `bytes 0-0/${HUGE}`);
  assert.equal(contentRange(78, 99, 100), 'bytes 78-99/100');
  assert.equal(unsatisfiedContentRange(100), 'bytes */100');
  assert.equal(unsatisfiedContentRange(0), 'bytes */0');
});

test('the byte count a range implies is inclusive on both ends', () => {
  // The Content-Length the handler derives. Off by one here truncates every
  // chunk a reader asks for, which looks like a corrupt file, not a bug.
  const r = parseRange('bytes=20447232-20971519', 200_000_000);
  assert.equal(r.kind, 'range');
  if (r.kind !== 'range') return;
  assert.equal(r.end - r.start + 1, 524_288); // exactly 512 KiB, pdf.js's chunk
});
