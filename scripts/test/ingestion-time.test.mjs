/**
 * ingestion-time.test.mjs — pins the pure half of the /status ingestion pause
 * card (sites/heygabi-home/public/assets/ingestion-time.js).
 *
 * WHY A SITE MODULE IS TESTED FROM scripts/test: this repo has exactly one
 * wired-up JS runner for non-Worker code (`npm run test:scripts`, node:test
 * over scripts/test/**), and sites/heygabi-home has no suite of its own. The
 * module under test was deliberately written with no imports and no DOM so
 * that it could be reached from here — the alternative was leaving the
 * timezone conversion and the wording untested inside status.js, which
 * cannot be imported at all (it pulls in the Firebase SDK).
 *
 * ⚠️ THE FIRST TEST IS THE ONE THAT MATTERS TONIGHT. The owner's ask was
 * "tonight starting at 7pm I need all of this paused until midnight"; if the
 * Phoenix conversion is wrong the pause lands at the wrong hour and NOTHING
 * on screen says so, because the words and the stored instant would agree
 * with each other while both being wrong.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PHOENIX_OFFSET,
  PHOENIX_TZ,
  activeWindow,
  describeIngestion,
  isoToPhoenixLocal,
  nextWindow,
  parseIso,
  phoenixDayIndex,
  phoenixLocalToIso,
  wordTime,
} from '../../sites/heygabi-home/public/assets/ingestion-time.js';

// ---------------------------------------------------------------------------
// The Phoenix conversion — a datetime-local value is PHOENIX wall clock, not
// device wall clock. These instants are the ones tonight's pause actually
// writes into the control document.
// ---------------------------------------------------------------------------

test('phoenixLocalToIso: 7pm Phoenix on 2026-08-18 is 02:00Z the next day', () => {
  assert.equal(phoenixLocalToIso('2026-08-18T19:00'), '2026-08-19T02:00:00.000Z');
});

test('phoenixLocalToIso: midnight tonight (00:00 on the 19th) is 07:00Z on the 19th', () => {
  assert.equal(phoenixLocalToIso('2026-08-19T00:00'), '2026-08-19T07:00:00.000Z');
});

test('phoenixLocalToIso: no DST — January and July are both UTC-7', () => {
  assert.equal(PHOENIX_TZ, 'America/Phoenix');
  assert.equal(PHOENIX_OFFSET, '-07:00');
  assert.equal(phoenixLocalToIso('2026-01-15T12:00'), '2026-01-15T19:00:00.000Z');
  assert.equal(phoenixLocalToIso('2026-07-15T12:00'), '2026-07-15T19:00:00.000Z');
});

test('phoenixLocalToIso: refuses anything that is not a complete picker value', () => {
  for (const bad of ['', '2026-08-18', 'tonight', '2026-08-18T19', null, undefined, 7]) {
    assert.equal(phoenixLocalToIso(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('isoToPhoenixLocal: round-trips a picker value through the stored instant', () => {
  const iso = phoenixLocalToIso('2026-08-18T19:00');
  assert.equal(isoToPhoenixLocal(iso), '2026-08-18T19:00');
  assert.equal(isoToPhoenixLocal('2026-08-19T07:00:00.000Z'), '2026-08-19T00:00');
  assert.equal(isoToPhoenixLocal(null), '');
  assert.equal(isoToPhoenixLocal('not a time'), '');
});

test('phoenixDayIndex: an instant late in the UTC day is still the earlier Phoenix day', () => {
  // 2026-08-19T02:30Z is 7:30pm on the 18th in Phoenix.
  assert.equal(
    phoenixDayIndex(Date.parse('2026-08-19T02:30:00Z')),
    phoenixDayIndex(Date.parse('2026-08-18T20:00:00Z')),
  );
});

test('parseIso: never returns NaN, never throws', () => {
  assert.equal(parseIso('2026-08-18T19:00:00Z'), Date.parse('2026-08-18T19:00:00Z'));
  assert.equal(parseIso('nope'), null);
  assert.equal(parseIso(null), null);
  assert.equal(parseIso(''), null);
});

// ---------------------------------------------------------------------------
// The words. The owner asked for "paused until midnight"; the card has to say
// that back to him, not an ISO string.
// ---------------------------------------------------------------------------

const AT_7_30_PM = Date.parse('2026-08-19T02:30:00Z'); // 7:30pm Tue 18 Aug, Phoenix

test('wordTime: the end of tonight reads "midnight tonight", not "12:00 AM tomorrow"', () => {
  assert.equal(wordTime('2026-08-19T07:00:00.000Z', AT_7_30_PM), 'midnight tonight');
});

test('wordTime: same Phoenix day, next day, and further out', () => {
  assert.equal(wordTime('2026-08-19T04:00:00.000Z', AT_7_30_PM), '9:00 PM today');
  assert.equal(wordTime('2026-08-19T15:00:00.000Z', AT_7_30_PM), '8:00 AM tomorrow');
  assert.equal(wordTime('2026-08-19T19:00:00.000Z', AT_7_30_PM), 'noon tomorrow');
  assert.equal(wordTime('2026-08-21T22:00:00.000Z', AT_7_30_PM), '3:00 PM on Friday');
  assert.equal(wordTime('2026-08-27T22:00:00.000Z', AT_7_30_PM), '3:00 PM on Thu, Aug 27');
});

test('wordTime: a past instant is not silently rendered as a future one', () => {
  assert.equal(wordTime('2026-08-18T21:00:00.000Z', AT_7_30_PM), '2:00 PM today');
  assert.equal(wordTime('2026-08-18T02:00:00.000Z', AT_7_30_PM), '7:00 PM yesterday');
});

test('wordTime: unreadable input is null, so a caller can say so instead of printing junk', () => {
  assert.equal(wordTime(null, AT_7_30_PM), null);
  assert.equal(wordTime('soon', AT_7_30_PM), null);
});

// ---------------------------------------------------------------------------
// describeIngestion — the status line. Never blank, never a bare state name.
// ---------------------------------------------------------------------------

test('describeIngestion: a MISSING document is worded, not blank', () => {
  const d = describeIngestion(null, AT_7_30_PM);
  assert.equal(d.state, 'unknown');
  assert.ok(d.headline.length > 0);
  assert.ok(d.lines.join(' ').includes('runs on its normal schedule'));
});

test('describeIngestion: tonight’s seeded 7pm–midnight pause renders as the owner asked', () => {
  const d = describeIngestion(
    {
      paused: false, // the timed encoding — see the module header
      paused_until: '2026-08-19T07:00:00.000Z',
      dont_check_until: null,
      pause_windows: [],
      updated_by: 'nightly-ingestion',
      updated_at: '2026-08-19T02:00:00.000Z',
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'paused');
  assert.equal(d.badge, 'warn');
  assert.equal(d.headline, 'Paused until midnight tonight.');
  assert.ok(d.lines.some((l) => l.includes('restarts by itself')));
  assert.ok(d.lines.some((l) => l.includes('nightly-ingestion')));
});

test('describeIngestion: ⚠️ the HARD FLAG outranks a timer, exactly as control_blocks_start does', () => {
  // If the other side seeds tonight's pause as flag+timer, the card must NOT
  // promise a midnight restart their step 2 will never perform.
  const d = describeIngestion(
    {
      paused: true,
      paused_until: '2026-08-19T07:00:00.000Z',
      dont_check_until: null,
      pause_windows: [],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'paused');
  assert.equal(d.headline, 'Paused, with no end time set.');
  assert.ok(d.lines.some((l) => l.includes('overrides it and outlives it')));
});

test('describeIngestion: a pause window seeded for tonight renders while it is in force', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [{ from: '2026-08-19T02:00:00.000Z', until: '2026-08-19T07:00:00.000Z' }],
      updated_by: null,
      updated_at: null,
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'window');
  assert.equal(d.headline, 'Paused by a scheduled window — waiting until midnight tonight.');
});

test('describeIngestion: an indefinite pause says there is no timer to end it', () => {
  const d = describeIngestion(
    { paused: true, paused_until: null, dont_check_until: null, pause_windows: [] },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'paused');
  assert.equal(d.headline, 'Paused, with no end time set.');
  assert.ok(d.lines.join(' ').includes('Resume'));
});

// ---------------------------------------------------------------------------
// WHAT THE PAUSE MEANS — `pause_mode` (owner ask 2026-08-23, verbatim: "when i
// manually pause the pipeline it says nothing can override it. I want it to
// ask me if i want to stop all work until unpaused or if scheduled window is
// fine to continue.").
//
// ⚠️ THE CARD IS HALF THE FEATURE. The behaviour lives on the home machine;
// what the owner can SEE is this wording, and the failure it guards is a card
// that reads identically for two pauses that do opposite things — one lets the
// nightly run proceed, the other does not.
// ---------------------------------------------------------------------------

const PAUSED_BASE = { paused: true, paused_until: null, dont_check_until: null, pause_windows: [] };

test('describeIngestion: a “stop everything” pause still says nothing overrides it', () => {
  const d = describeIngestion({ ...PAUSED_BASE, pause_mode: 'all' }, AT_7_30_PM);
  assert.equal(d.state, 'paused');
  assert.equal(d.pauseMode, 'all');
  assert.equal(d.headline, 'Paused, with no end time set.');
  assert.match(d.lines.join(' '), /Nothing overrides it/);
  assert.match(d.lines.join(' '), /not the scheduled 12am–8am window/);
});

test('describeIngestion: ⚠️ a “window may continue” pause must NOT read like a total stop', () => {
  const d = describeIngestion({ ...PAUSED_BASE, pause_mode: 'manual_only' }, AT_7_30_PM);
  assert.equal(d.state, 'paused', 'it is still a pause — the badge must not go green');
  assert.equal(d.badge, 'warn');
  assert.equal(d.pauseMode, 'manual_only');
  assert.equal(d.headline, 'Paused for work started by hand — the scheduled window may continue.');
  assert.match(d.lines.join(' '), /12am–8am window runs as if nothing were paused/);
  assert.ok(
    !d.lines.join(' ').includes('Nothing overrides it'),
    'the total-stop sentence would be a lie about the nightly run',
  );
});

test('describeIngestion: the two answers never produce the same headline', () => {
  const strict = describeIngestion({ ...PAUSED_BASE, pause_mode: 'all' }, AT_7_30_PM);
  const lenient = describeIngestion({ ...PAUSED_BASE, pause_mode: 'manual_only' }, AT_7_30_PM);
  assert.notEqual(strict.headline, lenient.headline);
  assert.notEqual(strict.lines.join(' '), lenient.lines.join(' '));
});

test('describeIngestion: ⚠️ an ABSENT mode reads as “stop everything”, like every old pause', () => {
  // Every pause document written before 2026-08-23 lacks the field, and every
  // one of them meant stop-everything. A card that softened its wording for
  // them would be describing a machine that is more paused than it says.
  const d = describeIngestion(PAUSED_BASE, AT_7_30_PM);
  assert.equal(d.pauseMode, 'all');
  assert.equal(d.headline, 'Paused, with no end time set.');
});

test('describeIngestion: an unrecognised mode fails closed in the wording too', () => {
  for (const junk of ['manual-only', 'MANUAL_ONLY', '', 1, true, null, undefined]) {
    const d = describeIngestion({ ...PAUSED_BASE, pause_mode: junk }, AT_7_30_PM);
    assert.equal(d.pauseMode, 'all', JSON.stringify(junk));
    assert.equal(d.headline, 'Paused, with no end time set.', JSON.stringify(junk));
  }
});

test('describeIngestion: a TIMED pause carries its mode into the wording too', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: '2026-08-19T07:00:00.000Z',
      dont_check_until: null,
      pause_windows: [],
      pause_mode: 'manual_only',
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'paused');
  assert.equal(d.pauseMode, 'manual_only');
  assert.match(d.headline, /work started by hand/);
  assert.match(d.lines.join(' '), /restarts by itself/);
  assert.match(d.lines.join(' '), /only work started by hand is refused/);
});

test('describeIngestion: the mode never softens a SCHEDULED pause window', () => {
  // ⚠️ A pause window IS the owner's quiet hours. "Let the scheduled window
  // continue" must not read as though it overrode one — the home machine does
  // not, and the card must not disagree with it.
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [{ from: '2026-08-19T02:00:00.000Z', until: '2026-08-19T07:00:00.000Z' }],
      pause_mode: 'manual_only',
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'window');
  assert.equal(d.headline, 'Paused by a scheduled window — waiting until midnight tonight.');
});

test('describeIngestion: an unpaused control is unaffected by either mode', () => {
  for (const mode of ['all', 'manual_only']) {
    const d = describeIngestion(
      { paused: false, paused_until: null, dont_check_until: null, pause_windows: [], pause_mode: mode },
      AT_7_30_PM,
    );
    assert.equal(d.state, 'running', mode);
    assert.equal(d.badge, 'ok', mode);
  }
});

test('describeIngestion: an EXPIRED timer reads as running, and says the old value clears itself', () => {
  // Their control_blocks_start() stops matching the instant paused_until
  // passes, so "still paused" would be a claim about a machine that has
  // already resumed — and "running" with no explanation would leave an
  // expired timestamp visible on the document with nothing said about it.
  const d = describeIngestion(
    {
      paused: false,
      paused_until: '2026-08-19T01:00:00.000Z', // 6pm, an hour and a half ago
      dont_check_until: null,
      pause_windows: [],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'running');
  assert.equal(d.badge, 'ok');
  assert.ok(d.lines.some((l) => l.includes('has finished')));
  assert.ok(d.lines.some((l) => l.includes('clears itself')));
});

test('describeIngestion: "don’t even check until" is its own state when nothing is paused', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: '2026-08-19T15:00:00.000Z',
      pause_windows: [],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'not-checking');
  assert.equal(d.headline, 'Not checking whether to start until 8:00 AM tomorrow.');
});

test('describeIngestion: a paused card still mentions a check-time set alongside it', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: '2026-08-19T07:00:00.000Z',
      dont_check_until: '2026-08-19T15:00:00.000Z',
      pause_windows: [],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'paused');
  assert.ok(d.lines.some((l) => l.includes('not even check')));
});

test('describeIngestion: nothing set at all reads green and says so plainly', () => {
  const d = describeIngestion(
    { paused: false, paused_until: null, dont_check_until: null, pause_windows: [] },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'running');
  assert.equal(d.badge, 'ok');
  assert.equal(d.headline, 'Running — nothing here is pausing ingestion.');
});

test('describeIngestion: a live timer outranks a window, so the earlier end is not over-promised', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: '2026-08-19T07:00:00.000Z',
      dont_check_until: null,
      pause_windows: [{ from: '2026-08-19T02:00:00.000Z', until: '2026-08-19T05:00:00.000Z' }],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'paused');
  assert.equal(d.headline, 'Paused until midnight tonight.');
});

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

test('activeWindow: a window with an unreadable end never pauses the display forever', () => {
  assert.equal(activeWindow([{ from: '2026-08-19T02:00:00Z', until: null }], AT_7_30_PM), null);
  assert.equal(activeWindow([{ from: null, until: 'whenever' }], AT_7_30_PM), null);
  assert.equal(activeWindow(null, AT_7_30_PM), null);
});

test('activeWindow / nextWindow: in force vs still to come', () => {
  const past = { from: '2026-08-18T02:00:00Z', until: '2026-08-18T07:00:00Z' };
  const now = { from: '2026-08-19T02:00:00Z', until: '2026-08-19T07:00:00Z' };
  const soon = { from: '2026-08-20T02:00:00Z', until: '2026-08-20T07:00:00Z' };
  assert.deepEqual(activeWindow([past, now, soon], AT_7_30_PM), now);
  assert.deepEqual(nextWindow([past, now, soon], AT_7_30_PM), soon);
  assert.equal(nextWindow([past, now], AT_7_30_PM), null);
});
