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
  MAX_EXEMPT_PROCESSES,
  MAX_RECURRING_WINDOWS,
  PAUSE_MENU,
  PHOENIX_OFFSET,
  PHOENIX_OFFSET_MS,
  PHOENIX_TZ,
  PRESET_CUSTOM_LABEL,
  PRESET_MIN_MS,
  STANDING_UNKNOWN_WORDS,
  SUGGESTED_EXEMPT_PROCESSES,
  activeRecurringWindow,
  activeWindow,
  describeIngestion,
  hhmmWords,
  isoToPhoenixLocal,
  nextWindow,
  parseIso,
  pausePresets,
  phoenixDayIndex,
  phoenixLocalToIso,
  phoenixWeekdayAndMinutes,
  processListWords,
  recurringWindowWords,
  standingSummaryWords,
  validateExemptProcess,
  validateRecurringWindow,
  weekdayWords,
  whenTitleWords,
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

// ---------------------------------------------------------------------------
// RECURRING BLOCKERS + DO-NOT-DISTURB PROGRAMS + THE SOFT PAUSE (owner asks
// 2026-08-31 / 2026-09-01; design §§3, 4, 4a).
//
// ⚠️ THE WORDS ARE THE HALF THE OWNER CAN SEE. The behaviour is on the home
// machine; what this file guards is a card that says something other than what
// the document means — a blocker rendered as the wrong twelve hours, a soft
// pause promising a timer a free GPU will beat, or a "start and end at the
// same time" row the card accepted and the reader silently ignores.
// ---------------------------------------------------------------------------

test('hhmmWords: the owner’s clock, not a 24-hour one', () => {
  assert.equal(hhmmWords('18:30'), '6:30 PM');
  assert.equal(hhmmWords('06:30'), '6:30 AM');
  assert.equal(hhmmWords('00:00'), 'midnight');
  assert.equal(hhmmWords('12:00'), 'noon');
  assert.equal(hhmmWords('23:59'), '11:59 PM');
  for (const bad of ['6:30', '24:00', '18:60', '', null, undefined, 1830]) {
    assert.equal(hhmmWords(bad), null, JSON.stringify(bad));
  }
});

test('weekdayWords: ISO numbering (1 = Monday), sorted, and “Every day” for all seven', () => {
  // ⚠️ ISO, not JavaScript's getDay(). Reading 1 as Sunday would shift every
  // blocker the owner sets by a day, and nothing on screen would say so.
  assert.equal(weekdayWords([1, 2, 3]), 'Mon Tue Wed');
  assert.equal(weekdayWords([3, 1, 2]), 'Mon Tue Wed', 'sorted, so the row reads the same');
  assert.equal(weekdayWords([7]), 'Sun');
  assert.equal(weekdayWords([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  assert.equal(weekdayWords([]), null);
  assert.equal(weekdayWords([0, 8]), null);
  assert.equal(weekdayWords('MTW'), null);
});

test('recurringWindowWords: the owner’s own example, in his own words', () => {
  // His message was "for instance MTW 630-1015 I want ingestion paused", and
  // question 2 settled that it is PM.
  assert.equal(
    recurringWindowWords({ days: [1, 2, 3], from: '18:30', until: '22:15' }),
    'Mon Tue Wed, 6:30 PM – 10:15 PM',
  );
});

test('⚠️ recurringWindowWords: a MIDNIGHT-CROSSING row says “the next morning”', () => {
  // Without those two words "Mon, 10:00 PM – 2:00 AM" reads as a row that
  // ended twenty hours before it started, and a reader would assume it was
  // broken — or worse, assume it covered 2am to 10pm.
  assert.equal(
    recurringWindowWords({ days: [1], from: '22:00', until: '02:00' }),
    'Mon, 10:00 PM – 2:00 AM the next morning',
  );
  assert.equal(
    recurringWindowWords({ days: [6, 7], from: '23:00', until: '00:00' }),
    'Sat Sun, 11:00 PM – midnight the next morning',
  );
});

test('recurringWindowWords: an unreadable row renders as null, never as half a sentence', () => {
  for (const bad of [
    null,
    'MTW 630-1015',
    { days: [], from: '18:30', until: '22:15' },
    { days: [1], from: '6:30', until: '22:15' },
    { days: [1], from: '18:30', until: '18:30' },
  ]) {
    assert.equal(recurringWindowWords(bad), null, JSON.stringify(bad));
  }
});

test('validateRecurringWindow: accepts a good row and normalises the days', () => {
  const r = validateRecurringWindow({ days: [3, 1, 2, 1], from: '18:30', until: '22:15' });
  assert.deepEqual(r.window, { days: [1, 2, 3], from: '18:30', until: '22:15' });
  assert.equal(r.error, undefined);
});

test('⚠️ validateRecurringWindow REFUSES start === end in words — the reader calls it ambiguous', () => {
  // The card must not let a row through that the home machine will drop: the
  // owner would see it listed and believe those hours were blocked.
  const r = validateRecurringWindow({ days: [1], from: '18:30', until: '18:30' });
  assert.equal(r.window, undefined);
  assert.match(r.error, /same time/i);
  assert.match(r.error, /no minutes or the whole day/i);
  // ⚠️ And it teaches the crossing form, because "set the end EARLIER" is the
  // opposite of what anyone guesses.
  assert.match(r.error, /EARLIER than the start/);
});

test('validateRecurringWindow: the other two refusals are kept APART, because the fixes differ', () => {
  const noDays = validateRecurringWindow({ days: [], from: '18:30', until: '22:15' });
  assert.match(noDays.error, /at least one day/i);
  const badTime = validateRecurringWindow({ days: [1], from: '6:30', until: '22:15' });
  assert.match(badTime.error, /real time of day/i);
  const nothing = validateRecurringWindow(undefined);
  assert.match(nothing.error, /at least one day/i);
});

test('validateExemptProcess: trims, keeps capitals, refuses blank and over-long in words', () => {
  assert.deepEqual(validateExemptProcess('  Wow.exe  '), { name: 'Wow.exe' });
  for (const bad of ['', '   ', null, 7, 'x'.repeat(201)]) {
    const r = validateExemptProcess(bad);
    assert.equal(r.name, undefined, JSON.stringify(bad));
    assert.match(r.error, /image name/i, JSON.stringify(bad));
  }
});

test('⚠️ the suggested programs are the VERIFIED name plus the documented one', () => {
  // Wow.exe was read off `tasklist` on the owner's machine while the game ran
  // (2026-09-01). WowClassic.exe is the standard classic-client name and is
  // NOT verified — both are suggestions, and the box takes anything.
  assert.deepEqual(SUGGESTED_EXEMPT_PROCESSES, ['Wow.exe', 'WowClassic.exe']);
});

test('processListWords: one, two, or several, as a sentence rather than a JSON array', () => {
  assert.equal(processListWords(['Wow.exe']), 'Wow.exe');
  assert.equal(processListWords(['Wow.exe', 'WowClassic.exe']), 'Wow.exe or WowClassic.exe');
  assert.equal(
    processListWords(['a.exe', 'b.exe', 'c.exe']),
    'a.exe, b.exe or c.exe',
  );
  assert.equal(processListWords([]), null);
  assert.equal(processListWords(null), null);
});

test('phoenixWeekdayAndMinutes: ISO weekday and minute-of-day, at UTC-7 in both January and July', () => {
  // 2026-08-19T02:30Z is Tuesday 7:30pm in Phoenix.
  assert.deepEqual(phoenixWeekdayAndMinutes(AT_7_30_PM), { weekday: 2, minutes: 19 * 60 + 30 });
  assert.equal(PHOENIX_OFFSET_MS, 7 * 3_600_000);
  // Same wall clock, six months apart — Arizona does not observe DST, so both
  // read 12:00 noon. A DST assumption would move one of them by an hour.
  assert.equal(phoenixWeekdayAndMinutes(Date.parse('2026-01-15T19:00:00Z')).minutes, 12 * 60);
  assert.equal(phoenixWeekdayAndMinutes(Date.parse('2026-07-15T19:00:00Z')).minutes, 12 * 60);
});

test('activeRecurringWindow: in force on its own day and hour, and not otherwise', () => {
  const tuesdayEvening = { days: [2], from: '18:30', until: '22:15' };
  assert.deepEqual(activeRecurringWindow([tuesdayEvening], AT_7_30_PM), tuesdayEvening);
  // Same hours, the wrong day.
  assert.equal(activeRecurringWindow([{ days: [1], from: '18:30', until: '22:15' }], AT_7_30_PM), null);
  // Right day, the wrong hours (7:30pm is past a 6:30–7:00 blocker).
  assert.equal(activeRecurringWindow([{ days: [2], from: '18:30', until: '19:00' }], AT_7_30_PM), null);
  // The end is EXCLUSIVE — a blocker that ended at 7:30 is over at 7:30.
  assert.equal(activeRecurringWindow([{ days: [2], from: '18:30', until: '19:30' }], AT_7_30_PM), null);
  // The start is INCLUSIVE.
  assert.deepEqual(
    activeRecurringWindow([{ days: [2], from: '19:30', until: '22:00' }], AT_7_30_PM),
    { days: [2], from: '19:30', until: '22:00' },
  );
});

test('⚠️ activeRecurringWindow: a MIDNIGHT-CROSSING row covers BOTH halves and nothing between', () => {
  // Monday 10pm → Tuesday 2am. Evaluating it as a plain "between from and
  // until" would cover 2am–10pm instead: the exact inverse.
  const crossing = { days: [1], from: '22:00', until: '02:00' };
  const monday11pm = Date.parse('2026-08-18T06:00:00Z'); // Mon 17 Aug 23:00 Phoenix
  const tuesday1am = Date.parse('2026-08-18T08:00:00Z'); // Tue 18 Aug 01:00 Phoenix
  const tuesday3am = Date.parse('2026-08-18T10:00:00Z'); // Tue 18 Aug 03:00 Phoenix
  const mondayNoon = Date.parse('2026-08-17T19:00:00Z'); // Mon 17 Aug 12:00 Phoenix
  assert.deepEqual(activeRecurringWindow([crossing], monday11pm), crossing, 'the first half');
  assert.deepEqual(activeRecurringWindow([crossing], tuesday1am), crossing, 'the spill into Tuesday');
  assert.equal(activeRecurringWindow([crossing], tuesday3am), null, 'it ended at 2am');
  assert.equal(activeRecurringWindow([crossing], mondayNoon), null, 'it had not started');
  // Sunday → Monday, the wrap in the weekday arithmetic itself.
  const sundayNight = { days: [7], from: '23:00', until: '01:00' };
  const monday12_30am = Date.parse('2026-08-17T07:30:00Z'); // Mon 17 Aug 00:30 Phoenix
  assert.deepEqual(activeRecurringWindow([sundayNight], monday12_30am), sundayNight);
});

test('activeRecurringWindow: a malformed row can never pause the display', () => {
  for (const junk of [
    [{ days: [2], from: '18:30' }],
    [{ days: [2], from: '18:30', until: '18:30' }], // the reader refuses this shape
    [{ days: 'Tue', from: '18:30', until: '22:15' }],
    [null],
    'nope',
    null,
  ]) {
    assert.equal(activeRecurringWindow(junk, AT_7_30_PM), null, JSON.stringify(junk));
  }
});

// --- describeIngestion: the soft pause ------------------------------------

const SOFT_BASE = {
  paused: false,
  paused_until: '2026-08-19T07:00:00.000Z', // midnight tonight
  pause_until_gpu_free: true,
  dont_check_until: null,
  pause_windows: [],
  recurring_windows: [],
  exempt_processes: [],
};

test('⚠️ describeIngestion: a SOFT pause never promises the timer — it says “at latest”', () => {
  const d = describeIngestion(SOFT_BASE, AT_7_30_PM);
  assert.equal(d.state, 'paused');
  assert.equal(d.badge, 'warn');
  assert.equal(d.softPause, true);
  assert.equal(d.headline, 'Paused for now — until midnight tonight at the latest.');
  const all = d.lines.join(' ');
  assert.match(all, /resumes itself once the GPU has been quiet for ~4 minutes — at latest midnight tonight/);
  // Q4, answered "block everything": while it waits, nothing runs at all.
  assert.match(all, /CPU work is stopped too/);
});

test('⚠️ describeIngestion: the soft pause and the OLD timed pause do not read the same', () => {
  // The difference is whether a free GPU can end it, and that is the whole
  // reason the flag exists — two cards that read alike would hide it.
  const soft = describeIngestion(SOFT_BASE, AT_7_30_PM);
  const hardCeiling = describeIngestion({ ...SOFT_BASE, pause_until_gpu_free: false }, AT_7_30_PM);
  assert.equal(hardCeiling.softPause, false);
  assert.equal(hardCeiling.headline, 'Paused until midnight tonight.');
  assert.notEqual(soft.headline, hardCeiling.headline);
  assert.ok(
    !hardCeiling.lines.join(' ').includes('GPU'),
    'a document without the flag must not be described as GPU-released',
  );
});

test('describeIngestion: an ABSENT soft flag reads as the old timed pause, like every old document', () => {
  const { pause_until_gpu_free, ...noFlag } = SOFT_BASE;
  const d = describeIngestion(noFlag, AT_7_30_PM);
  assert.equal(d.softPause, false);
  assert.equal(d.headline, 'Paused until midnight tonight.');
});

test('describeIngestion: a junk soft flag fails CLOSED — the string "true" is not true', () => {
  for (const junk of ['true', 1, {}, 'yes']) {
    const d = describeIngestion({ ...SOFT_BASE, pause_until_gpu_free: junk }, AT_7_30_PM);
    assert.equal(d.softPause, false, JSON.stringify(junk));
  }
});

test('⚠️ describeIngestion: a don’t-check time DELAYS the soft release, and says so', () => {
  // A don't-check is a spend-nothing instruction and polling is spending, so
  // the home machine will not look at the GPU at all while one is set. Without
  // this sentence the owner would expect a release that cannot happen.
  const d = describeIngestion(
    { ...SOFT_BASE, dont_check_until: '2026-08-19T15:00:00.000Z' },
    AT_7_30_PM,
  );
  const all = d.lines.join(' ');
  assert.match(all, /delays even that/);
  assert.match(all, /does not poll the GPU at all/);
  // ⚠️ And it is said ONCE: the generic "it will not even check" sentence must
  // not follow the specific one that already explained it.
  assert.equal(all.match(/8:00 AM tomorrow/g).length, 1, 'the same fact stated twice reads as two facts');
});

test('describeIngestion: a do-not-disturb program HOLDS the soft release, and the card says which', () => {
  const d = describeIngestion({ ...SOFT_BASE, exempt_processes: ['Wow.exe'] }, AT_7_30_PM);
  assert.match(d.lines.join(' '), /will not release while Wow\.exe is running/);
});

// --- describeIngestion: recurring blockers --------------------------------

const IN_FORCE = { days: [2], from: '18:30', until: '22:15' }; // Tuesday evening

test('⚠️ describeIngestion: a blocker in force is its own state, and says it is absolute', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [],
      recurring_windows: [IN_FORCE],
      exempt_processes: [],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'blocker');
  assert.equal(d.badge, 'warn', 'a blocked machine is not green');
  assert.equal(d.headline, 'Paused by a recurring blocker — Tue, 6:30 PM – 10:15 PM.');
  assert.deepEqual(d.blocker, IN_FORCE);
  const all = d.lines.join(' ');
  assert.match(all, /absolute while they are in force/);
  // ⚠️ The consequence the design said to state to his face.
  assert.match(all, /beats the scheduled 12am–8am window/);
});

test('⚠️ describeIngestion: a blocker OUT of force does not pause the card', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [],
      recurring_windows: [{ days: [1], from: '18:30', until: '22:15' }], // Monday
      exempt_processes: [],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'running');
  assert.equal(d.badge, 'ok');
  assert.equal(d.blocker, null);
});

test('⚠️ describeIngestion: a soft pause AND a blocker both render — the page is not the refusal', () => {
  // The reader names ONE reason (the pause, which it checks first) because a
  // refusal is one sentence. This card is showing the whole document, and an
  // owner reading "it releases when the GPU goes quiet" needs to know a
  // blocker will still be holding when it does.
  const d = describeIngestion({ ...SOFT_BASE, recurring_windows: [IN_FORCE] }, AT_7_30_PM);
  assert.equal(d.state, 'paused', 'the pause is the headline, as on the home machine');
  assert.match(d.headline, /Paused for now/);
  assert.deepEqual(d.blocker, IN_FORCE);
  assert.match(
    d.lines.join(' '),
    /A recurring blocker is also in force right now \(Tue, 6:30 PM – 10:15 PM\)/,
  );
});

test('describeIngestion: the do-not-disturb list is stated even on a GREEN card', () => {
  // A guard nobody can see is a guard nobody remembers setting — and this one
  // stops starts at every moment, not only while something is paused.
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [],
      recurring_windows: [],
      exempt_processes: ['Wow.exe', 'WowClassic.exe'],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'running');
  assert.equal(d.badge, 'ok');
  assert.match(
    d.lines.join(' '),
    /Do not disturb: nothing new starts while Wow\.exe or WowClassic\.exe is running/,
  );
  assert.match(d.lines.join(' '), /never killed/);
});

test('describeIngestion: an empty do-not-disturb list says NOTHING rather than “none”', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [],
      recurring_windows: [],
      exempt_processes: [],
    },
    AT_7_30_PM,
  );
  assert.ok(!d.lines.join(' ').includes('Do not disturb'));
});

test('⚠️ describeIngestion: the HARD flag still outranks everything, soft flag included', () => {
  // A document carrying both is one the processor reads as an unconditional
  // block — step 2 never consults a timer — so the card must not describe a
  // GPU release that will never be reached.
  const d = describeIngestion({ ...SOFT_BASE, paused: true }, AT_7_30_PM);
  assert.equal(d.state, 'paused');
  assert.equal(d.softPause, false);
  assert.equal(d.headline, 'Paused, with no end time set.');
  assert.ok(!d.lines.join(' ').includes('GPU'));
});

// ---------------------------------------------------------------------------
// THE CONDENSE (owner ask 2026-09-01: "this all works good, the time selector
// is a not my favorite and its getting to be a lot of menus and buttons, can
// you reassess and condense for a better ux").
//
// ⚠️ These pin the two halves a screenshot cannot check: that a chip's LABEL
// names the instant the chip WRITES (the same class of bug as the Phoenix
// conversion — the words and the instant would agree with each other while
// both being wrong), and that a COLLAPSED disclosure never reads as absent.
// ---------------------------------------------------------------------------

const AT_6_PM = Date.parse('2026-08-19T01:00:00Z'); // 6:00 PM sharp, Tue 18 Aug
const AT_6_55_PM = Date.parse('2026-08-19T01:55:00Z'); // five minutes before 7
const AT_11_55_PM = Date.parse('2026-08-19T06:55:00Z'); // five minutes before midnight
const AT_7_55_AM = Date.parse('2026-08-18T14:55:00Z'); // five minutes before 8am

test('pausePresets: every chip is labelled with the words the status line uses', () => {
  const chips = pausePresets(AT_7_30_PM);
  assert.deepEqual(
    chips.map((c) => c.label),
    [
      'In an hour — 8:30 PM today',
      'In 3 hours — 10:30 PM today',
      'Midnight tonight',
      '8:00 AM tomorrow',
    ],
  );
  // ⚠️ THE LABEL MUST NAME THE INSTANT THE CHIP WRITES. A chip saying "in an
  // hour" over an ISO an hour and a half out is the exact silent-wrongness
  // this module exists to prevent.
  for (const chip of chips) {
    const words = wordTime(chip.iso, AT_7_30_PM);
    assert.ok(
      chip.label.toLowerCase().endsWith(words.toLowerCase()),
      `${chip.key}: "${chip.label}" does not end in its own instant ("${words}")`,
    );
  }
});

test('⚠️ pausePresets: a clock time already PAST is skipped, never rolled to tomorrow', () => {
  // At 7:30 PM the "7:00 PM" chip is gone. Rolling it to tomorrow evening
  // would offer a 23-hour pause under a label reading like half an hour.
  const keys = pausePresets(AT_7_30_PM).map((c) => c.key);
  assert.ok(!keys.includes('evening'));
  assert.deepEqual(keys, ['plus1h', 'plus3h', 'midnight', 'morning']);
});

test('⚠️ pausePresets: a chip less than ten minutes away is skipped too', () => {
  // A pause that expires before the owner looks up from the screen is
  // indistinguishable from a control that did nothing.
  assert.equal(PRESET_MIN_MS, 10 * 60_000);
  assert.ok(!pausePresets(AT_6_55_PM).map((c) => c.key).includes('evening'), '7:00 PM is 5 min away');
  assert.ok(!pausePresets(AT_11_55_PM).map((c) => c.key).includes('midnight'), 'midnight is 5 min away');
});

test('pausePresets: two presets landing on the same instant collapse to one', () => {
  // At 6:00 PM sharp "In an hour" IS the 7:00 PM chip; two chips writing the
  // same instant under different labels is a menu that looks like a choice.
  const chips = pausePresets(AT_6_PM);
  assert.deepEqual(chips.map((c) => c.key), ['plus1h', 'plus3h', 'midnight', 'morning']);
  assert.equal(chips[0].label, 'In an hour — 7:00 PM today');
  assert.equal(new Set(chips.map((c) => c.iso)).size, chips.length);
});

test('pausePresets: the 8am chip is the NEXT 8am, and the row is sorted by time', () => {
  // Before breakfast it is today's; after it, tomorrow's — and when today's is
  // minutes away it rolls, because "the next 8am" is the whole meaning of the
  // chip (unlike "7:00 PM", which is an evening or nothing).
  const morning = pausePresets(AT_7_55_AM).find((c) => c.key === 'morning');
  assert.equal(morning.label, '8:00 AM tomorrow');
  const evening = pausePresets(AT_7_55_AM).find((c) => c.key === 'evening');
  assert.equal(evening.label, '7:00 PM today');
  for (const at of [AT_7_55_AM, AT_6_PM, AT_7_30_PM, AT_11_55_PM]) {
    const times = pausePresets(at).map((c) => Date.parse(c.iso));
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'chips are a timeline');
    for (const t of times) assert.ok(t - at >= PRESET_MIN_MS, 'no chip in the past or nearly here');
  }
});

test('pausePresets: a chip writes a real UTC instant, Phoenix-correct in January and July', () => {
  // The chip goes through the same conversion the picker does, so a laptop on
  // Eastern still means 8:00 AM at home. Pinned in both halves of the year
  // because Arizona has no DST and a library that thought otherwise would
  // shift these by an hour for half the year.
  for (const [now, expected] of [
    [Date.parse('2026-01-15T05:00:00Z'), '2026-01-15T15:00:00.000Z'], // 10pm Jan 14 Phoenix → 8am Jan 15
    [Date.parse('2026-07-15T05:00:00Z'), '2026-07-15T15:00:00.000Z'],
  ]) {
    const morning = pausePresets(now).find((c) => c.key === 'morning');
    assert.equal(morning.iso, expected);
  }
});

test('the pause MENU is four distinct answers, each naming its own consequence', () => {
  // ⚠️ The detail sentence is what lets the answer BE the confirmation instead
  // of demanding a third tap — a menu of bare verbs would have condensed
  // nothing. Every entry must carry one.
  assert.deepEqual(PAUSE_MENU.map((m) => m.key), ['for_now', 'until_time', 'hard', 'dont_check']);
  assert.equal(new Set(PAUSE_MENU.map((m) => m.label)).size, 4);
  for (const entry of PAUSE_MENU) {
    assert.ok(entry.detail.length > 20, `${entry.key} has no consequence sentence`);
  }
  // The two that open the time drawer say so with an ellipsis; the two that
  // write immediately do not.
  assert.ok(PAUSE_MENU[1].label.endsWith('…'));
  assert.ok(PAUSE_MENU[3].label.endsWith('…'));
  assert.ok(!PAUSE_MENU[0].label.endsWith('…'));
  assert.ok(!PAUSE_MENU[2].label.endsWith('…'));
  // ⚠️ The ceiling is admitted in the menu itself, not only in the drawer.
  assert.match(PAUSE_MENU[1].detail, /At latest/);
  assert.match(PAUSE_MENU[2].detail, /Nothing but Resume/);
});

test('whenTitleWords: each drawer says which control it is about, and refuses to guess', () => {
  assert.equal(whenTitleWords('pause_until'), 'Pause until… (at latest)');
  assert.equal(whenTitleWords('dont_check_until'), 'Don’t even check to start until…');
  assert.equal(whenTitleWords('something_else'), null);
  assert.equal(PRESET_CUSTOM_LABEL, 'Custom…');
});

// --- the counted disclosure ------------------------------------------------

test('standingSummaryWords: a collapsed disclosure says how much is in there', () => {
  const two = standingSummaryWords(
    { recurring_windows: [{ days: [1], from: '18:30', until: '22:15' }, { days: [5], from: '09:00', until: '10:00' }], exempt_processes: ['Wow.exe'] },
    AT_7_30_PM,
  );
  assert.equal(two.text, '2 blockers · 1 exemption');
  assert.equal(two.inForce, false);
  const one = standingSummaryWords(
    { recurring_windows: [{ days: [5], from: '09:00', until: '10:00' }], exempt_processes: [] },
    AT_7_30_PM,
  );
  assert.equal(one.text, '1 blocker', 'singular, and an empty list is not counted at all');
});

test('⚠️ standingSummaryWords: “none set” is STATED — collapsed must never read as absent', () => {
  for (const control of [null, undefined, {}, { recurring_windows: [], exempt_processes: [] }]) {
    const s = standingSummaryWords(control, AT_7_30_PM);
    assert.equal(s.text, 'none set');
    assert.equal(s.inForce, false);
  }
});

test('⚠️ standingSummaryWords: a blocker IN FORCE leads the line and flags itself amber', () => {
  // A blocker stopping starts right now, hidden behind a closed disclosure,
  // would be the invisible control this surface bans — so the live fact is
  // first, and `inForce` is what tints it.
  const s = standingSummaryWords(
    { recurring_windows: [IN_FORCE], exempt_processes: ['Wow.exe'] },
    AT_7_30_PM,
  );
  assert.equal(s.text, 'Blocker in force until 10:15 PM · 1 blocker · 1 exemption');
  assert.equal(s.inForce, true);
});

test('standingSummaryWords: a blocker OUT of force is only counted, never announced', () => {
  const s = standingSummaryWords({ recurring_windows: [{ days: [4], from: '18:30', until: '22:15' }] }, AT_7_30_PM);
  assert.equal(s.text, '1 blocker');
  assert.equal(s.inForce, false);
});

test('a FAILED read says so — never “none set”, which is a stronger and falser claim', () => {
  assert.match(STANDING_UNKNOWN_WORDS, /Cannot read/);
  assert.ok(!STANDING_UNKNOWN_WORDS.includes('none'));
});

// --- the ONE contextual primary action -------------------------------------

test('⚠️ describeIngestion: the card offers PAUSE when there is nothing to resume', () => {
  const running = describeIngestion(
    { paused: false, paused_until: null, dont_check_until: null, pause_windows: [] },
    AT_7_30_PM,
  );
  assert.equal(running.primary, 'pause');
  assert.equal(running.showStartNow, false);
  // A document that does not exist yet is the same answer.
  assert.equal(describeIngestion(null, AT_7_30_PM).primary, 'pause');
  assert.equal(describeIngestion(null, AT_7_30_PM).showStartNow, false);
});

test('⚠️ describeIngestion: a blocker ALONE still offers Pause — Resume cannot end one', () => {
  // Blockers are absolute and survive every button on the card, so a Resume
  // offered here would be a control that does nothing. That is worse than no
  // control: it teaches the owner that Resume is broken.
  const d = describeIngestion(
    { paused: false, paused_until: null, dont_check_until: null, pause_windows: [], recurring_windows: [IN_FORCE] },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'blocker');
  assert.equal(d.primary, 'pause');
  assert.equal(d.showStartNow, false);
});

test('describeIngestion: every kind of pause offers RESUME, and only that', () => {
  const cases = [
    { paused: true, paused_until: null, dont_check_until: null, pause_windows: [] },
    { ...SOFT_BASE },
    { paused: false, paused_until: '2026-08-19T04:00:00Z', dont_check_until: null, pause_windows: [] },
    { paused: false, paused_until: null, dont_check_until: '2026-08-19T04:00:00Z', pause_windows: [] },
  ];
  for (const control of cases) {
    const d = describeIngestion(control, AT_7_30_PM);
    assert.equal(d.primary, 'resume', JSON.stringify(control));
    assert.equal(d.showStartNow, false, 'no window in force, so Start now would be a duplicate Resume');
  }
});

test('⚠️ describeIngestion: START NOW appears ONLY inside a live window — §3a, the one state where it differs', () => {
  // Resume drops the window in force; Start now deliberately does not. That is
  // the entire difference between the two buttons, so this is the only state
  // where showing both is honest rather than noise.
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [{ from: '2026-08-19T02:00:00Z', until: '2026-08-19T07:00:00Z' }],
    },
    AT_7_30_PM,
  );
  assert.equal(d.state, 'window');
  assert.equal(d.primary, 'resume');
  assert.equal(d.showStartNow, true);
});

test('describeIngestion: an EXPIRED window is not a live one, so Start now stays away', () => {
  const d = describeIngestion(
    {
      paused: false,
      paused_until: null,
      dont_check_until: null,
      pause_windows: [{ from: '2026-08-18T02:00:00Z', until: '2026-08-18T07:00:00Z' }],
    },
    AT_7_30_PM,
  );
  assert.equal(d.primary, 'pause');
  assert.equal(d.showStartNow, false);
});

test('the card’s caps mirror the reader’s and the Worker’s — one number, three copies', () => {
  // ⚠️ No shared module across the three repos (the same duplication story as
  // PIPELINE_STEPS). Keeping the numbers equal is what makes the card's
  // refusal agree with the machine that would otherwise drop the 21st row.
  assert.equal(MAX_RECURRING_WINDOWS, 20);
  assert.equal(MAX_EXEMPT_PROCESSES, 20);
});
