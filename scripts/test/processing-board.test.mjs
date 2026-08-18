/**
 * processing-board.test.mjs — pins the projection behind /status/processing
 * (scripts/lib/processing-board.mjs).
 *
 * ⚠️ EVERY FIXTURE HERE IS A REAL LINE, copied off this machine's own logs and
 * state on 2026-08-18 rather than invented. Two of them are the whole reason
 * this file exists:
 *
 *   `transcribing "I'm Glad My Mom Died" (batch 8)` — Python's repr switches to
 *   DOUBLE quotes when a title contains an apostrophe. A single-quote-only
 *   regex silently reports "nothing is being processed" while the GPU is busy,
 *   which is the failure the owner would never see and never be able to
 *   distinguish from an idle machine.
 *
 *   a dangling `transcribing …` with no completion after it and NO LOCK on
 *   disk — the shape a run killed by a reboot leaves behind. Believed, it pins
 *   a book "in flight" on the owner's page forever.
 *
 * The rest guard the two claims this projection makes that are easiest to make
 * wrongly and hardest to notice: that a queue lane reading 0 was MEASURED, and
 * that `joined_at` is the state file's `updated_at` and never another clock.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LOCK_STALE_HOURS,
  PROGRESS_STALE_MS,
  buildProcessingSection,
  inFlightFromLog,
  laneForSource,
  latestQueueLine,
  logEvents,
  phoenixToIso,
  queueRows,
  readProgressRecord,
  titleMap,
} from '../lib/processing-board.mjs';

const NIGHTLY = `================= Tue 08/18/2026 10:23:09.77 =================
warning: The \`fitz\` API is deprecated and will be removed in future.
[2026-08-18 10:23:12 MST] queue: 1064 books (25 CPU, 1039 GPU)
[2026-08-18 11:48:34 MST]   transcribing 'A Court of Thorns and Roses (Part 1 of 2) (Dramatized Adaptation) - A Court of Thorns and Roses, Book 1' (batch 8)
[2026-08-18 11:48:36 MST]   transcription FAILED rc=1: obook_catalog\\scripts\\transcribe_audiobook.py", line 260, in main
    raise FileNotFoundError(f"no .m4b under {LIBRARY_ROOT} matches {title!r}")
[2026-08-18 11:50:36 MST]   transcribing 'Fourth Wing - Empyrean, Book 1' (batch 8)
[2026-08-18 12:13:59 MST]   OK Fourth Wing - Empyrean, Book 1  1491 chunks  432,065B gz (ratio 0.3323)  -> text/fourth-wing-empyrean-book-1.json.gz
[2026-08-18 12:15:59 MST]   transcribing 'Harry Potter and the Sorcerer’s Stone (Full-Cast Edition)' (batch 8)
[2026-08-18 12:25:44 MST]   ERROR 'Harry Potter and the Sorcerer’s Stone (Full-Cast Edition)': FileNotFoundError: no transcript on disk
[2026-08-18 12:27:44 MST]   transcribing "I'm Glad My Mom Died" (batch 8)
`;

const NOW = Date.parse('2026-08-18T19:40:00Z'); // 12:40 Phoenix, mid-transcription
const HELD = { present: true, heldSinceMs: Date.parse('2026-08-18T17:23:09Z') };

test('a Phoenix log stamp becomes the right instant — MST is a fixed UTC-7, no DST', () => {
  assert.equal(phoenixToIso('2026-08-18', '12:27:44'), '2026-08-18T19:27:44.000Z');
  // January and August must convert identically. If this ever differs, someone
  // has reached for a DST-aware conversion and Phoenix does not have one.
  assert.equal(phoenixToIso('2026-01-18', '12:27:44'), '2026-01-18T19:27:44.000Z');
  assert.equal(phoenixToIso('nope', '12:00:00'), null);
});

test('banner and traceback lines are dropped, not given a clock', () => {
  const events = logEvents(NIGHTLY);
  assert.ok(events.every((e) => e.at && e.text));
  assert.ok(!events.some((e) => /fitz/.test(e.text)), 'the un-timestamped warning is not an event');
  assert.ok(!events.some((e) => /^=+/.test(e.text)), 'the run banner is not an event');
  assert.ok(!events.some((e) => /raise FileNotFoundError/.test(e.text)), 'a traceback row is not an event');
});

test('the newest queue line wins, and its commas do not become NaN', () => {
  const q = latestQueueLine(logEvents(`[2026-08-18 09:00:04 MST] queue: 900 books (25 CPU, 875 GPU)\n${NIGHTLY}`));
  assert.deepEqual(
    { total: q.total, cpu: q.cpu, gpu: q.gpu },
    { total: 1064, cpu: 25, gpu: 1039 },
    'the 09:00 line must not win over the 10:23 one',
  );
  assert.equal(latestQueueLine(logEvents('[2026-08-18 09:00:04 MST] queue: 1,064 books (25 CPU, 1,039 GPU)')).total, 1064);
  assert.equal(latestQueueLine([]), null);
});

test('titles are MEASURED off OK lines, never re-derived from the slug', () => {
  const map = titleMap(logEvents(NIGHTLY));
  assert.equal(map.get('fourth-wing-empyrean-book-1'), 'Fourth Wing - Empyrean, Book 1');
  // The punctuation a de-slugger could never restore is exactly the point.
  const km = titleMap(
    logEvents(
      "[2026-08-18 08:44:49 MST]   OK A Killer's Mind (Zoe Bentley Mystery Book 1)  836 chunks  224,741B gz (ratio 0.3101)  -> text/a-killer-s-mind-zoe-bentley-mystery-book-1.json.gz",
    ),
  );
  assert.equal(km.get('a-killer-s-mind-zoe-bentley-mystery-book-1'), "A Killer's Mind (Zoe Bentley Mystery Book 1)");
});

test('⚠️ a double-quoted title is in flight — Python reprs an apostrophe that way', () => {
  const live = inFlightFromLog(logEvents(NIGHTLY), HELD, NOW);
  assert.equal(live.title, "I'm Glad My Mom Died");
  assert.equal(live.batch, 8);
  assert.equal(live.started_at, '2026-08-18T19:27:44.000Z');
});

test('a finished book is not in flight — OK, ERROR and FAILED all end one', () => {
  const upToOk = NIGHTLY.split('\n').slice(0, 8).join('\n'); // ends at the Fourth Wing OK
  assert.equal(inFlightFromLog(logEvents(upToOk), HELD, NOW), null);

  const upToError = NIGHTLY.split('\n').slice(0, 10).join('\n'); // ends at the Harry Potter ERROR
  assert.equal(inFlightFromLog(logEvents(upToError), HELD, NOW), null);

  const upToFailed = NIGHTLY.split('\n').slice(0, 6).join('\n'); // ends at transcription FAILED
  assert.equal(inFlightFromLog(logEvents(upToFailed), HELD, NOW), null);
});

test('⚠️ no lock means no live run, however inviting the log looks', () => {
  assert.equal(inFlightFromLog(logEvents(NIGHTLY), { present: false, heldSinceMs: null }, NOW), null);
  assert.equal(inFlightFromLog(logEvents(NIGHTLY), null, NOW), null);
});

test('⚠️ a lock older than the ingester would tolerate is a dead run, not a live one', () => {
  const stale = { present: true, heldSinceMs: NOW - (LOCK_STALE_HOURS + 1) * 3_600_000 };
  assert.equal(inFlightFromLog(logEvents(NIGHTLY), stale, NOW), null);
  const fresh = { present: true, heldSinceMs: NOW - (LOCK_STALE_HOURS - 1) * 3_600_000 };
  assert.ok(inFlightFromLog(logEvents(NIGHTLY), fresh, NOW));
});

test('lanes map to the labels the page knows, and an unknown source survives verbatim', () => {
  assert.equal(laneForSource('epub'), 'epub');
  assert.equal(laneForSource('pdf-text'), 'text-pdf');
  assert.equal(laneForSource('pdf-ocr'), 'deferred-pdf');
  assert.equal(laneForSource('transcript'), 'audiobook');
  assert.equal(laneForSource('comic-ocr'), 'comic-ocr', 'a new lane must not be relabelled or dropped');
  assert.equal(laneForSource(undefined), null);
});

test('⚠️ a queue lane reading 0 is MEASURED, and says which measurement said so', () => {
  const rows = queueRows({ total: 1064, cpu: 25, gpu: 1039 }, 25);
  const byLane = Object.fromEntries(rows.map((r) => [r.lane, r]));
  assert.equal(byLane.audiobook.count, 1039);
  assert.equal(byLane['deferred-pdf'].count, 25);
  assert.equal(byLane.epub.count, 0);
  assert.match(byLane.epub.note, /Measured, not assumed/);
  assert.equal(byLane['text-pdf'].count, 0);
  assert.ok(!('audiobook-with-review' in byLane), 'the reviewed split is not knowable and must not be invented');
});

test('⚠️ unexplained CPU work gets its own row rather than being folded into a lane', () => {
  const rows = queueRows({ total: 1100, cpu: 60, gpu: 1040 }, 25);
  const byLane = Object.fromEntries(rows.map((r) => [r.lane, r]));
  assert.equal(byLane.epub, undefined, 'we must not claim 0 EPUBs when the CPU bucket is unaccounted for');
  assert.equal(byLane['cpu-work-not-yet-classified'].count, 35);
});

test('no queue line means NO ROWS — the page says "unknown, not zero" for itself', () => {
  assert.deepEqual(queueRows(null, 25), []);
});

// --- the reviewed/rest split -----------------------------------------------
// The ingester exports build_queue()'s tier counts; this page may use them only
// when their arithmetic matches the GPU bucket it already measured.

test('the reviewed split appears when the ingester exports it and the numbers agree', () => {
  const rows = queueRows({ total: 1064, cpu: 25, gpu: 1039 }, 25, {
    lanes: { 'audiobook-with-review': 21, audiobook: 1018 },
  });
  const byLane = Object.fromEntries(rows.map((r) => [r.lane, r]));
  assert.equal(byLane['audiobook-with-review'].count, 21);
  assert.equal(byLane.audiobook.count, 1018);
  assert.match(byLane['audiobook-with-review'].note, /21 \+ 1018 = 1039/);
  // The CPU lanes must be untouched by the split.
  assert.equal(byLane['deferred-pdf'].count, 25);
  assert.equal(byLane.epub.count, 0);
});

test('⚠️ a split whose arithmetic does NOT match the GPU bucket is refused, not shown', () => {
  // 21 + 900 = 921, but the ingester logged 1039 on the GPU. The export
  // describes a different queue (an older run, or a tier this code cannot see),
  // so the honest answer is the whole bucket.
  const rows = queueRows({ total: 1064, cpu: 25, gpu: 1039 }, 25, {
    lanes: { 'audiobook-with-review': 21, audiobook: 900 },
  });
  const byLane = Object.fromEntries(rows.map((r) => [r.lane, r]));
  assert.equal(byLane.audiobook.count, 1039, 'the measured bucket wins over a disagreeing export');
  assert.ok(!('audiobook-with-review' in byLane));
});

test('⚠️ a null tier count is NOT zero — Number(null) would make it a measured 0', () => {
  const rows = queueRows({ total: 1064, cpu: 25, gpu: 1039 }, 25, {
    lanes: { 'audiobook-with-review': null, audiobook: 1039 },
  });
  const byLane = Object.fromEntries(rows.map((r) => [r.lane, r]));
  assert.ok(!('audiobook-with-review' in byLane), 'an uncounted tier must never render as "0 reviewed"');
  assert.equal(byLane.audiobook.count, 1039);
});

test('a missing, malformed or empty queue summary leaves the pre-export behaviour exactly as it was', () => {
  const whole = queueRows({ total: 1064, cpu: 25, gpu: 1039 }, 25);
  for (const bad of [null, undefined, {}, { lanes: null }, { lanes: {} }, 'nope', []]) {
    assert.deepEqual(
      queueRows({ total: 1064, cpu: 25, gpu: 1039 }, 25, bad),
      whole,
      `a ${JSON.stringify(bad)} summary must not change a single row`,
    );
  }
});

const STATE = {
  version: 1,
  books: {
    'fourth-wing-empyrean-book-1': {
      status: 'done',
      updated_at: '2026-08-18T19:13:59Z',
      source: 'transcript',
      chunks: 1491,
      ingester_version: 1,
    },
    'a-killer-s-mind-zoe-bentley-mystery-book-1': {
      status: 'done',
      updated_at: '2026-08-18T15:44:49Z',
      source: 'epub',
      chunks: 836,
      ingester_version: 1,
    },
    'atlas-of-the-heart': {
      status: 'needs-ocr',
      updated_at: '2026-08-18T16:12:54Z',
      source: 'pdf-ocr',
      blocker: 'OCR processor not built',
    },
    'harry-potter-and-the-sorcerer-s-stone-full-cast-edition': {
      status: 'failed',
      updated_at: '2026-08-18T19:25:44Z',
      reason: 'FileNotFoundError: no transcript on disk',
    },
  },
};

function section(over = {}) {
  return buildProcessingSection({
    state: STATE,
    nightlyLog: NIGHTLY,
    cpuLog: '',
    packIndex: { generated_at: '2026-08-18T16:04:10Z', ingester_version: 1, count: 182 },
    receipt: { ingester_version: 1, total_done: 157 },
    lock: HELD,
    stateReadAt: '2026-08-18T19:25:44.000Z',
    nowMs: NOW,
    ...over,
  });
}

test('the whole section matches the contract, and carries no percent it cannot measure', () => {
  const s = section();
  assert.deepEqual(Object.keys(s).sort(), ['history', 'in_flight', 'packs', 'queue']);

  assert.equal(s.in_flight.length, 1);
  const live = s.in_flight[0];
  assert.equal(live.title, "I'm Glad My Mom Died");
  assert.equal(live.lane, 'audiobook');
  // ⚠️ THE LOAD-BEARING ASSERTION. processing.js draws a progress bar from
  // `percent` and never estimates one; an elapsed-time guess in that key would
  // render as a measurement of finished work. It must be absent, and the
  // reason must be in words the owner can read.
  assert.ok(!('percent' in live), 'percent must be ABSENT, not 0 and not an estimate');
  assert.ok(!('eta' in live), 'the pipeline states no ETA, so the push must not carry one');
  assert.match(live.step, /no measurement published yet/);
});

test('⚠️ joined_at is the state file\'s updated_at and nothing else', () => {
  const s = section();
  const row = s.history.find((r) => r.id === 'fourth-wing-empyrean-book-1');
  assert.equal(row.joined_at, '2026-08-18T19:13:59Z');
  assert.equal(row.title, 'Fourth Wing - Empyrean, Book 1');
  assert.equal(row.lane, 'audiobook');
  assert.equal(row.chunks, 1491);
  assert.equal(row.ingester_version, '1');
  assert.ok(!('note' in row), 'a book whose title was measured needs no caveat');
});

test('history holds only books that actually joined, newest first', () => {
  const s = section();
  assert.deepEqual(s.history.map((r) => r.id), [
    'fourth-wing-empyrean-book-1',
    'a-killer-s-mind-zoe-bentley-mystery-book-1',
  ]);
  assert.ok(!s.history.some((r) => r.id === 'atlas-of-the-heart'), 'needs-ocr has not joined');
  assert.ok(!s.history.some((r) => /harry-potter/.test(r.id)), 'a failed book has NOT joined the knowledge base');
});

test('a book with no title in any log shows its id and SAYS it is standing in', () => {
  const s = section({ nightlyLog: '[2026-08-18 10:23:12 MST] queue: 1064 books (25 CPU, 1039 GPU)' });
  const row = s.history.find((r) => r.id === 'fourth-wing-empyrean-book-1');
  assert.equal(row.title, 'fourth-wing-empyrean-book-1');
  assert.match(row.note, /no title recorded/);
});

// ---------------------------------------------------------------------------
// transcribe_progress.json — the measured percentage
// ---------------------------------------------------------------------------

/** A real record, field for field as scripts/transcribe_audiobook.py writes it
 *  (its own test file pins the writer against this same shape). */
const PROGRESS = {
  source_m4b: 'C:\\Users\\nbasl\\OpenAudible\\books\\Zogarth\\The Primal Hunter 12 - A LitRPG Adventure.m4b',
  title: 'The Primal Hunter 12 - A LitRPG Adventure',
  audio_seconds_done: 18000.0,
  audio_hours_done: 5.0,
  container_duration_s: 72451.188,
  percent: 24.8,
  started_at: '2026-08-18T19:37:33Z',
  updated_at: '2026-08-18T19:39:33Z',
  wall_minutes: 2.0,
  realtime_factor: 150.0,
  words: 40000,
};

const PROGRESS_NOW = Date.parse('2026-08-18T19:40:00Z');

test('a fresh progress record is read whole, with both of its clocks', () => {
  const r = readProgressRecord(PROGRESS, PROGRESS_NOW);
  assert.equal(r.title, 'The Primal Hunter 12 - A LitRPG Adventure');
  assert.equal(r.percent, 24.8);
  assert.equal(r.started_at, '2026-08-18T19:37:33.000Z');
  assert.equal(r.updated_at, '2026-08-18T19:39:33.000Z');
  assert.ok(Math.abs(r.hours_done - 5) < 1e-9);
  assert.ok(Math.abs(r.hours_total - 20.125) < 1e-3);
});

test('⚠️ a record older than the staleness cut-off is ABSENT, not live', () => {
  // The run was killed and never reached the transcriber's cleanup. A dead
  // run's last measurement sitting on the page as a live book is worse than
  // showing nothing: it is a confident wrong answer.
  const old = { ...PROGRESS, updated_at: new Date(PROGRESS_NOW - PROGRESS_STALE_MS - 1000).toISOString() };
  assert.equal(readProgressRecord(old, PROGRESS_NOW), null);
  const justInside = { ...PROGRESS, updated_at: new Date(PROGRESS_NOW - PROGRESS_STALE_MS + 1000).toISOString() };
  assert.ok(readProgressRecord(justInside, PROGRESS_NOW));
});

test('⚠️ staleness is measured on updated_at, NEVER on started_at', () => {
  // A 20-hour audiobook's run legitimately started hours ago. Measuring age on
  // started_at would hide every long book — exactly the ones worth watching.
  const longRun = { ...PROGRESS, started_at: '2026-08-18T05:00:00Z' };
  assert.ok(readProgressRecord(longRun, PROGRESS_NOW));
});

test('a record with no readable updated_at is not "fresh"', () => {
  assert.equal(readProgressRecord({ ...PROGRESS, updated_at: undefined }, PROGRESS_NOW), null);
  assert.equal(readProgressRecord({ ...PROGRESS, updated_at: 'soon' }, PROGRESS_NOW), null);
});

test('a clock skewed into the future is a broken clock, not a fresh reading', () => {
  const ahead = { ...PROGRESS, updated_at: new Date(PROGRESS_NOW + 60 * 60 * 1000).toISOString() };
  assert.equal(readProgressRecord(ahead, PROGRESS_NOW), null);
});

test('⚠️ a bad percentage costs ONLY the percentage — the book is still named', () => {
  for (const bad of [null, undefined, 'lots', NaN, -5, 140]) {
    const r = readProgressRecord({ ...PROGRESS, percent: bad }, PROGRESS_NOW);
    assert.ok(r, `a record with percent=${String(bad)} still names a real book`);
    assert.ok(!('percent' in r), `percent=${String(bad)} must be dropped, not clamped or zeroed`);
  }
});

test('a record with nothing to name the book with is dropped', () => {
  assert.equal(readProgressRecord({ ...PROGRESS, title: '', source_m4b: '' }, PROGRESS_NOW), null);
  assert.equal(readProgressRecord(null, PROGRESS_NOW), null);
  assert.equal(readProgressRecord([PROGRESS], PROGRESS_NOW), null, 'an array is not a record');
  assert.equal(readProgressRecord('{}', PROGRESS_NOW), null);
});

test('the m4b path stands in when the title is missing', () => {
  const r = readProgressRecord({ ...PROGRESS, title: undefined }, PROGRESS_NOW);
  assert.match(r.title, /The Primal Hunter 12/);
});

test('⚠️ the in-flight card carries a MEASURED percent when a progress file is live', () => {
  const s = section({ progress: PROGRESS, nowMs: PROGRESS_NOW });
  assert.equal(s.in_flight.length, 1);
  const row = s.in_flight[0];
  assert.equal(row.title, 'The Primal Hunter 12 - A LitRPG Adventure');
  assert.equal(row.percent, 24.8);
  assert.equal(row.lane, 'audiobook');
  assert.equal(row.started_at, '2026-08-18T19:37:33.000Z');
  assert.equal(row.updated_at, '2026-08-18T19:39:33.000Z');
  assert.match(row.step, /5\.00h of 20\.13h transcribed/);
  assert.match(row.step, /measured from the model's own segment timestamps/);
});

test('⚠️ THE PROGRESS FILE WINS OVER THE LOG — it sees hand runs the log cannot', () => {
  // The nightly log names "I'm Glad My Mom Died"; the progress file names the
  // Primal Hunter book a hand-run chain is transcribing. The hand run is the
  // one actually on the GPU, and it writes no log line at all.
  const s = section({ progress: PROGRESS, nowMs: PROGRESS_NOW });
  assert.equal(s.in_flight.length, 1, 'one book on one GPU — never two rows');
  assert.match(s.in_flight[0].title, /Primal Hunter/);
});

test('⚠️ NO progress file behaves exactly as it did before the tee existed', () => {
  const s = section({ progress: null });
  assert.equal(s.in_flight.length, 1);
  assert.ok(!('percent' in s.in_flight[0]), 'absent file means absent percent, not zero');
  assert.equal(s.in_flight[0].title, "I'm Glad My Mom Died", 'the log is still the fallback');
});

test('a stale progress file falls back to the log rather than blanking the card', () => {
  const stale = { ...PROGRESS, updated_at: '2026-08-18T18:00:00Z' };
  const s = section({ progress: stale });
  assert.equal(s.in_flight.length, 1);
  assert.equal(s.in_flight[0].title, "I'm Glad My Mom Died");
  assert.ok(!('percent' in s.in_flight[0]));
});

test('the packs note no longer claims hand runs are invisible', () => {
  const s = section();
  assert.match(s.packs.note, /hand-run chain shows up too/);
});

test('packs carry their own clock, and the note names the second one', () => {
  const s = section();
  assert.equal(s.packs.packed, 2);
  assert.equal(s.packs.needs_ocr, 1);
  assert.equal(s.packs.chunks, 2327);
  assert.equal(s.packs.books, 182);
  assert.equal(s.packs.ingester_version, '1');
  assert.equal(s.packs.as_of, '2026-08-18T19:25:44.000Z', 'as_of is when the STATE was read');
  assert.match(s.packs.note, /published pack index generated 2026-08-18T16:04:10Z/);
  assert.match(s.packs.note, /1 book failed/);
  assert.match(s.packs.note, /queue and history below are the nightly ingester's/);
});

test('a version drift across packs is called out — the packs are not interchangeable', () => {
  const drifted = JSON.parse(JSON.stringify(STATE));
  drifted.books['a-killer-s-mind-zoe-bentley-mystery-book-1'].ingester_version = 2;
  const s = buildProcessingSection({
    state: drifted,
    nightlyLog: NIGHTLY,
    packIndex: null,
    receipt: null,
    lock: HELD,
    stateReadAt: '2026-08-18T19:25:44.000Z',
    nowMs: NOW,
  });
  assert.match(s.packs.note, /span ingester versions 1, 2/);
  assert.ok(!('books' in s.packs), 'no manifest read means no indexed-books count — not a zero');
});

test('⚠️ the history is TRIMMED by the pusher and the trim is announced', () => {
  const s = section({ maxHistory: 1 });
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].id, 'fourth-wing-empyrean-book-1', 'the NEWEST rows survive a trim');
  assert.match(s.packs.note, /1 oldest history rows were trimmed/);
});

test('an unreadable state file yields an empty section, never a fabricated one', () => {
  const s = buildProcessingSection({
    state: {},
    nightlyLog: '',
    stateReadAt: '2026-08-18T19:25:44.000Z',
    nowMs: NOW,
  });
  assert.deepEqual(s.in_flight, []);
  assert.deepEqual(s.queue, [], 'no queue line means no rows, so the page says "unknown, not zero"');
  assert.deepEqual(s.history, []);
  assert.equal(s.packs.packed, 0);
});
