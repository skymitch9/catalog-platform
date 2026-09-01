/**
 * ingestion-control.test.ts — the ingestion pause/resume control document
 * (owner order 2026-08-18: "give me a way to pause and start the process flow
 * on the GABI dashboard... let me also set pause timers on the ui. I can say
 * don't even check to start until x time.").
 *
 * Its own file rather than more of ops.test.ts because it pins a different
 * KIND of thing: everything in ops.test.ts is a fire-and-forget REQUEST
 * document, consumed once and deleted, while this is durable STATE that a
 * machine consults before every run. The bugs are different too, and all
 * three of the ones below are silent — a pause that does not persist, a
 * Resume that leaves a timer behind, and a lapsed timer that keeps a machine
 * paused past its own expiry would each look completely fine on screen.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  INGESTION_ACTIONS,
  INGESTION_CONTROL_DOC,
  decodeIngestionControl,
  emptyIngestionControl,
  ingestionControlFields,
  isIngestionAction,
  nextIngestionControl,
  cleanBookIds,
  ingestionActionDetail,
  sameIdList,
  PAUSE_MODES,
  isPauseMode,
  normalisePauseMode,
  pauseModeWords,
  MAX_CONTROL_LIST,
  MAX_CONTROL_ENTRY_CHARS,
  MAX_RECURRING_WINDOWS,
  MAX_EXEMPT_PROCESSES,
  PHOENIX_OFFSET_MS,
  cleanProcessName,
  cleanProcessNames,
  cleanRecurringWindow,
  cleanRecurringWindows,
  isHhMm,
  nextPhoenixMidnightIso,
  sameRecurringList,
  sameRecurringWindow,
  sameStringList,
  type IngestionControl,
  type RecurringWindow,
} from '../src/ops.js';

const NOW = Date.parse('2026-08-19T02:30:00Z'); // 7:30pm Tue 18 Aug, Phoenix
const MIDNIGHT = '2026-08-19T07:00:00.000Z'; // midnight tonight, Phoenix
const SIX_PM = '2026-08-19T01:00:00.000Z'; // an hour and a half ago

function fsControlDoc(fields: Record<string, unknown>) {
  return { fields };
}

test('INGESTION_CONTROL_DOC: pinned to audiobook_catalog’s CONTROL_COLLECTION/CONTROL_DOC', () => {
  // ⚠️ app/core/ingest_control.py owns this path: CONTROL_COLLECTION
  // "ingestion_control" + CONTROL_DOC "state". It is NOT "current" — that was
  // this route's first guess, corrected against the reader before shipping.
  assert.equal(INGESTION_CONTROL_DOC, 'ingestion_control/state');
  // ⚠️ Widened 2026-08-18 with the three owner-approved fine controls. The
  // list is asserted WHOLE rather than by membership so that adding an action
  // is a deliberate edit here — every entry is a button somebody can press.
  // ⚠️ Widened again 2026-09-01 with the soft pause, the recurring blockers
  // and the do-not-disturb list. Still asserted WHOLE, for the same reason:
  // every entry is a button somebody can press, so gaining one is a
  // deliberate edit here and never a side effect of a refactor.
  assert.deepEqual(
    [...INGESTION_ACTIONS],
    [
      'pause',
      'resume',
      'pause_until',
      'pause_for_now',
      'dont_check_until',
      'start_now',
      'requeue',
      'priority_front',
      'priority_front_clear',
      'recurring_add',
      'recurring_delete',
      'exempt_add',
      'exempt_delete',
    ],
  );
  assert.equal(isIngestionAction('pause_until'), true);
  assert.equal(isIngestionAction('delete_everything'), false);
  assert.equal(isIngestionAction(undefined), false);
});

test('decodeIngestionControl: a missing document decodes to null, not to a fake pause', () => {
  assert.equal(decodeIngestionControl(null), null);
  assert.equal(decodeIngestionControl({}), null);
  assert.equal(decodeIngestionControl({ error: { status: 'NOT_FOUND' } }), null);
});

test('decodeIngestionControl: reads the six agreed fields off the REST shape', () => {
  const control = decodeIngestionControl(
    fsControlDoc({
      paused: { booleanValue: true },
      paused_until: { stringValue: MIDNIGHT },
      dont_check_until: { nullValue: null },
      pause_windows: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  from: { stringValue: '2026-08-19T02:00:00.000Z' },
                  until: { stringValue: MIDNIGHT },
                },
              },
            },
          ],
        },
      },
      updated_by: { stringValue: 'estate-ops:owner@example.com' },
      updated_at: { stringValue: '2026-08-19T02:00:00.000Z' },
    }),
  );
  assert.deepEqual(control, {
    paused: true,
    // ⚠️ ABSENT from the document above, exactly like every pause written
    // before 2026-08-23 — and absent means 'all', the strict meaning. A
    // decoder that defaulted the other way would reinterpret an old pause into
    // permission to run the nightly window.
    pause_mode: 'all',
    paused_until: MIDNIGHT,
    // ⚠️ ABSENT means OFF, exactly like every pause written before
    // 2026-09-01. A decoder that read an absent flag as `true` would make the
    // card promise a GPU release the reader will never perform.
    pause_until_gpu_free: false,
    dont_check_until: null,
    pause_windows: [{ from: '2026-08-19T02:00:00.000Z', until: MIDNIGHT }],
    recurring_windows: [],
    exempt_processes: [],
    // Absent from the document above, and absent means EMPTY — a control
    // surface must never invent a retry request nobody made.
    requeue: [],
    priority_front: [],
    updated_by: 'estate-ops:owner@example.com',
    updated_at: '2026-08-19T02:00:00.000Z',
  });
});

test('decodeIngestionControl: a malformed field reads as UNSET, never as a pause', () => {
  const control = decodeIngestionControl(
    fsControlDoc({
      paused: { stringValue: 'true' }, // wrong type — must NOT become true
      paused_until: { stringValue: 'sometime' }, // unparseable — not a timer
      pause_windows: { stringValue: 'nope' },
    }),
  );
  assert.equal(control!.paused, false);
  assert.equal(control!.paused_until, null);
  assert.deepEqual(control!.pause_windows, []);
});

test('nextIngestionControl: "pause now" latches the flag with no end time', () => {
  const r = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'pause',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, true);
  assert.equal(r.control.paused_until, null);
  assert.equal(r.control.updated_by, 'estate-ops:owner@example.com');
  assert.equal(r.control.updated_at, new Date(NOW).toISOString());
});

test('nextIngestionControl: ⚠️ "pause until" writes the TIMER WITH THE FLAG OFF, so it expires', () => {
  // control_blocks_start()'s `if state.paused` is unconditional and never
  // consults the timer, so a flag left true would still be blocking at 12:01.
  // This is the single most consequential line in the file.
  const r = nextIngestionControl({
    current: null,
    action: 'pause_until',
    until: MIDNIGHT,
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, false);
  assert.equal(r.control.paused_until, MIDNIGHT);
});

test('nextIngestionControl: "pause until" pressed during an INDEFINITE pause clears the flag', () => {
  // Otherwise the timed pause would inherit a true flag and never expire.
  const r = nextIngestionControl({
    current: {
      paused: true,
      pause_mode: 'all', // irrelevant to this test; 'all' is what an old document means
      paused_until: null,
      pause_until_gpu_free: false,
      dont_check_until: null,
      pause_windows: [],
      recurring_windows: [],
      exempt_processes: [],
      requeue: [],
      priority_front: [],
      updated_by: null,
      updated_at: null,
    },
    action: 'pause_until',
    until: MIDNIGHT,
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, false);
  assert.equal(r.control.paused_until, MIDNIGHT);
});

test('nextIngestionControl: RESUME clears the flag, both timers, and a window in force', () => {
  const later = '2026-08-20T02:00:00.000Z';
  const r = nextIngestionControl({
    current: {
      paused: true,
      pause_mode: 'all', // irrelevant to this test; 'all' is what an old document means
      paused_until: MIDNIGHT,
      pause_until_gpu_free: false,
      dont_check_until: '2026-08-19T15:00:00.000Z',
      pause_windows: [
        { from: '2026-08-19T02:00:00.000Z', until: MIDNIGHT }, // in force right now
        { from: later, until: '2026-08-20T07:00:00.000Z' }, // still to come
      ],
      recurring_windows: [],
      exempt_processes: [],
      requeue: [],
      priority_front: [],
      updated_by: 'x',
      updated_at: '2026-08-19T02:00:00.000Z',
    },
    action: 'resume',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, false);
  assert.equal(r.control.paused_until, null);
  assert.equal(r.control.dont_check_until, null);
  // The window covering right now is gone — otherwise Resume would appear to
  // do nothing, since the window would re-pause seconds later. A window that
  // has not started yet is left alone.
  assert.deepEqual(r.control.pause_windows, [{ from: later, until: '2026-08-20T07:00:00.000Z' }]);
});

test('nextIngestionControl: past times self-clear on the next write', () => {
  const r = nextIngestionControl({
    current: {
      paused: false,
      pause_mode: 'all', // irrelevant to this test; 'all' is what an old document means
      paused_until: SIX_PM,
      pause_until_gpu_free: false,
      dont_check_until: SIX_PM,
      pause_windows: [
        { from: '2026-08-18T02:00:00.000Z', until: '2026-08-18T07:00:00.000Z' }, // expired
        { from: '2026-08-20T02:00:00.000Z', until: '2026-08-20T07:00:00.000Z' }, // future
      ],
      recurring_windows: [],
      exempt_processes: [],
      requeue: [],
      priority_front: [],
      updated_by: null,
      updated_at: null,
    },
    action: 'dont_check_until',
    until: '2026-08-19T15:00:00.000Z',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused_until, null);
  assert.equal(r.control.dont_check_until, '2026-08-19T15:00:00.000Z');
  assert.equal(r.control.pause_windows.length, 1);
});

test('nextIngestionControl: a time already past is REFUSED, not accepted then silently dropped', () => {
  const r = nextIngestionControl({
    current: null,
    action: 'pause_until',
    until: SIX_PM,
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('error' in r);
  assert.equal(r.error, 'until_in_the_past');
  assert.match(r.detail, /already passed/);
});

test('nextIngestionControl: an unreadable time is refused in words', () => {
  for (const bad of [undefined, null, '', 'tonight', 42]) {
    const r = nextIngestionControl({
      current: null,
      action: 'pause_until',
      until: bad,
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('error' in r, `expected refusal for ${JSON.stringify(bad)}`);
    assert.equal(r.error, 'invalid_until');
  }
});

test('nextIngestionControl: pause/resume never need a time and are never refused for want of one', () => {
  for (const action of ['pause', 'resume'] as const) {
    const r = nextIngestionControl({ current: null, action, actor: 'a', nowMs: NOW });
    assert.ok('control' in r, `${action} must not be refused`);
  }
});

test('ingestionControlFields: nulls are written as explicit nullValue, so a clear really clears', () => {
  const fields = ingestionControlFields({
    paused: false,
    pause_mode: 'all', // irrelevant to this test; 'all' is what an old document means
    paused_until: null,
    pause_until_gpu_free: false,
    dont_check_until: null,
    pause_windows: [],
    recurring_windows: [],
    exempt_processes: [],
    requeue: [],
    priority_front: [],
    updated_by: 'estate-ops:owner@example.com',
    updated_at: '2026-08-19T02:30:00.000Z',
  });
  assert.deepEqual(fields.paused, { booleanValue: false });
  assert.deepEqual(fields.paused_until, { nullValue: null });
  assert.deepEqual(fields.dont_check_until, { nullValue: null });
  assert.deepEqual(fields.pause_windows, { arrayValue: { values: [] } });
  assert.deepEqual(fields.updated_by, { stringValue: 'estate-ops:owner@example.com' });
});

test('ingestionControlFields: round-trips back through decodeIngestionControl unchanged', () => {
  const control = {
    paused: true,
    // 'manual_only' rather than the default, so this catches a field that
    // encodes but decodes back to the fail-closed value — a bug an 'all'
    // fixture would sail straight through.
    pause_mode: 'manual_only' as const,
    paused_until: MIDNIGHT,
    // ⚠️ TRUE on purpose: a round trip that only ever saw `false` would sail
    // straight past a boolean encoded as a string, which is the one shape the
    // reader's `is True` would silently mis-read.
    pause_until_gpu_free: true,
    dont_check_until: '2026-08-19T15:00:00.000Z',
    pause_windows: [{ from: '2026-08-20T02:00:00.000Z', until: '2026-08-20T07:00:00.000Z' }],
    // ⚠️ NON-EMPTY, and with a MULTI-DAY midnight-crossing row: the weekday
    // numbers are the only integers on this document, and Firestore's REST
    // shape sends an integer as a STRING — a decoder without that branch
    // turns every blocker into a dropped row and nothing says so.
    recurring_windows: [{ days: [1, 3, 5], from: '22:00', until: '02:00' }],
    exempt_processes: ['Wow.exe'],
    // ⚠️ NON-EMPTY on purpose: the round trip is only worth anything if it
    // exercises the arrayValue encoding of the two list fields, and an empty
    // list round-trips through almost any bug.
    requeue: ['a-failed-book'],
    priority_front: ['the-primal-hunter'],
    updated_by: 'estate-ops:owner@example.com',
    updated_at: '2026-08-19T02:30:00.000Z',
  };
  assert.deepEqual(decodeIngestionControl({ fields: ingestionControlFields(control) }), control);
});

// ---------------------------------------------------------------------------
// THE THREE FINE CONTROLS (owner-approved 2026-08-18): start-now, re-queue,
// priority bump. All three ride this same document and this same door.
//
// ⚠️ The tests that matter most here are about what a write does NOT touch.
// Three fields on one document are owned by three different conversations —
// and one of them, `requeue`, is written by the HOME MACHINE too, which removes
// the entries it has consumed. A control that carried the whole document would
// undo the processor's work with a button nobody pressed.
// ---------------------------------------------------------------------------

const withLists = (over: Partial<IngestionControl> = {}): IngestionControl => ({
  ...emptyIngestionControl(),
  ...over,
});

test('start_now clears all three pause levers', () => {
  const r = nextIngestionControl({
    current: withLists({
      paused: true,
      paused_until: '2026-08-19T07:00:00.000Z',
      dont_check_until: '2026-08-19T07:00:00.000Z',
    }),
    action: 'start_now',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, false);
  assert.equal(r.control.paused_until, null);
  assert.equal(r.control.dont_check_until, null);
});

test('⚠️ start_now LEAVES pause_windows ALONE — that is what separates it from resume', () => {
  // The owner's quiet hours are a schedule he set on purpose. A "start now"
  // that deleted tonight's window would take a RECURRING instruction away to
  // satisfy a one-off one. resume drops a window in force (otherwise it
  // re-pauses seconds later and reads as broken); start_now must not.
  const live = { from: '2026-08-19T02:00:00.000Z', until: '2026-08-19T07:00:00.000Z' };
  const started = nextIngestionControl({
    current: withLists({ paused: true, pause_windows: [live] }),
    action: 'start_now',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in started);
  assert.deepEqual(started.control.pause_windows, [live], 'start_now kept the window');

  const resumed = nextIngestionControl({
    current: withLists({ paused: true, pause_windows: [live] }),
    action: 'resume',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in resumed);
  assert.deepEqual(resumed.control.pause_windows, [], 'resume dropped the window in force');
});

test('⚠️ start_now does not touch requeue or priority_front either', () => {
  const r = nextIngestionControl({
    current: withLists({ paused: true, requeue: ['a'], priority_front: ['b'] }),
    action: 'start_now',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.requeue, ['a']);
  assert.deepEqual(r.control.priority_front, ['b']);
});

test('⚠️ a pause or resume carries requeue and priority_front through unchanged', () => {
  // The likeliest real sequence: somebody queues a retry, then pauses for the
  // evening. Losing the retry to the pause would be invisible and infuriating.
  for (const action of ['pause', 'resume', 'pause_until', 'dont_check_until'] as const) {
    const r = nextIngestionControl({
      current: withLists({ requeue: ['keep-me'], priority_front: ['and-me'] }),
      action,
      until: '2026-08-19T09:00:00.000Z',
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('control' in r, action);
    assert.deepEqual(r.control.requeue, ['keep-me'], action);
    assert.deepEqual(r.control.priority_front, ['and-me'], action);
  }
});

test('requeue appends rather than replacing — two clicks are two requests', () => {
  const r = nextIngestionControl({
    current: withLists({ requeue: ['first'] }),
    action: 'requeue',
    bookIds: ['second'],
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.requeue, ['first', 'second']);
});

test('⚠️ re-adding an id already on the list cannot grow the document', () => {
  const r = nextIngestionControl({
    current: withLists({ requeue: ['dup'] }),
    action: 'requeue',
    bookIds: ['dup', 'DUP'],
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.requeue, ['dup']);
});

test('priority_front keeps the order it was given — the order IS the instruction', () => {
  const r = nextIngestionControl({
    current: withLists({ priority_front: ['one'] }),
    action: 'priority_front',
    bookIds: ['two', 'three'],
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.priority_front, ['one', 'two', 'three']);
});

test('the two list actions refuse an empty or unreadable book_ids with words', () => {
  for (const bookIds of [undefined, [], 'b1', [7, null], {}]) {
    const r = nextIngestionControl({
      current: null,
      action: 'requeue',
      bookIds,
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('error' in r, `expected refusal for ${JSON.stringify(bookIds)}`);
    assert.equal(r.error, 'no_book_ids');
    assert.ok(r.detail.length > 20, 'a refusal must say what to do, not just fail');
  }
});

test('⚠️ priority_front_clear empties ONLY the priority list, never a pending retry', () => {
  const r = nextIngestionControl({
    current: withLists({ requeue: ['still-waiting'], priority_front: ['a', 'b'] }),
    action: 'priority_front_clear',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.priority_front, []);
  assert.deepEqual(
    r.control.requeue,
    ['still-waiting'],
    'a retry request is somebody else’s outstanding work',
  );
});

test('cleanBookIds: non-strings, blanks and over-long entries are dropped and counted', () => {
  const { ids, dropped } = cleanBookIds([
    'ok',
    '',
    '   ',
    7,
    null,
    'x'.repeat(MAX_CONTROL_ENTRY_CHARS + 1),
  ]);
  assert.deepEqual(ids, ['ok']);
  assert.equal(dropped, 5);
});

test('cleanBookIds: the cap counts the excess as dropped rather than truncating in silence', () => {
  const { ids, dropped } = cleanBookIds(
    Array.from({ length: MAX_CONTROL_LIST + 5 }, (_, i) => `b${i}`),
  );
  assert.equal(ids.length, MAX_CONTROL_LIST);
  assert.equal(dropped, 5);
});

test('sameIdList: a REORDER is a change, because for priority the order is the instruction', () => {
  assert.equal(sameIdList(['a', 'b'], ['a', 'b']), true);
  assert.equal(sameIdList(['a', 'b'], ['b', 'a']), false);
  assert.equal(sameIdList([], []), true);
  assert.equal(sameIdList(['a'], ['a', 'b']), false);
});

test('⚠️ every list action’s wording says NOT YET DONE, never that it happened', () => {
  // This Worker wrote a line in a document; the home machine acts on it at the
  // top of its next run. Reporting "re-queued" on the write would be claiming
  // an outcome nothing here can observe.
  const control = withLists({ requeue: ['a'], priority_front: ['b'] });
  assert.match(ingestionActionDetail('requeue', control), /Nothing has been retried yet/);
  assert.match(ingestionActionDetail('priority_front', control), /still apply/);
});

test('⚠️ start_now’s wording admits a live quiet-hours window will still block it', () => {
  const words = ingestionActionDetail('start_now', emptyIngestionControl());
  assert.match(words, /still blocks the start/);
  assert.match(words, /allowed to start/);
});

test('every action in INGESTION_ACTIONS is accepted and has wording of its own', () => {
  for (const action of INGESTION_ACTIONS) {
    assert.equal(isIngestionAction(action), true, action);
    assert.ok(ingestionActionDetail(action, emptyIngestionControl()).length > 10, action);
  }
});

// ---------------------------------------------------------------------------
// WHAT A MANUAL PAUSE MEANS — `pause_mode` (owner ask 2026-08-23, verbatim:
// "when i manually pause the pipeline it says nothing can override it. I want
// it to ask me if i want to stop all work until unpaused or if scheduled
// window is fine to continue."). His decision: ASK EVERY TIME, nothing saved
// as a preference.
//
// ⚠️ THE FAILURE THESE GUARD IS SILENT IN BOTH DIRECTIONS. A mode that never
// persists leaves the owner pressing a button that changes nothing; a mode
// that survives a Resume makes the NEXT pause mean something he did not
// choose. Neither shows on screen.
//
// The BEHAVIOUR (which triggers a mode actually stops) is enforced on the home
// machine — audiobook_catalog `control_blocks_start()`, tested there in
// tests/test_ingest_books.py::TestPauseMode. This Worker only decides what gets
// written, so these tests pin the write.
// ---------------------------------------------------------------------------

test('pause_mode: “stop all work” is the default when the body says nothing', () => {
  // ⚠️ Fail closed. A caller that predates this field — or a script — must not
  // be able to write a permissive pause by omission.
  const r = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'pause',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.pause_mode, 'all');
  assert.equal(r.control.paused, true);
});

test('pause_mode: “let the scheduled window continue” is written when chosen', () => {
  const r = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'pause',
    mode: 'manual_only',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.pause_mode, 'manual_only');
  assert.equal(r.control.paused, true, 'it is still a pause — only its meaning changed');
});

test('pause_mode: a value that is not a mode is REFUSED in words, never coerced', () => {
  for (const junk of ['manual-only', 'MANUAL_ONLY', 'window', '', 7, true, {}]) {
    const r = nextIngestionControl({
      current: emptyIngestionControl(),
      action: 'pause',
      mode: junk,
      actor: 'estate-ops:owner@example.com',
      nowMs: NOW,
    });
    assert.ok('error' in r, `${JSON.stringify(junk)} must not be accepted`);
    assert.equal(r.error, 'invalid_pause_mode');
    assert.ok(r.detail.length > 20, 'a refusal is always worded, never a bare code');
  }
});

test('pause_mode: the mode is validated even for actions that do not read it', () => {
  // ⚠️ Validating inside the two pause branches would let `resume` accept a
  // typo'd mode silently — the body would be wrong and nothing would say so.
  const r = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'resume',
    mode: 'nonsense',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('error' in r);
});

test('⚠️ pause_mode: RESUME resets the meaning, so the next pause cannot inherit it', () => {
  // The owner's decision was that the question is asked EVERY time. A
  // 'manual_only' left on the document after a Resume would become the silent
  // default of a pause he never chose it for.
  const r = nextIngestionControl({
    current: withLists({ paused: true, pause_mode: 'manual_only' }),
    action: 'resume',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, false);
  assert.equal(r.control.pause_mode, 'all');
});

test('⚠️ pause_mode: START NOW resets it too — it clears every pause lever', () => {
  const r = nextIngestionControl({
    current: withLists({ paused: true, pause_mode: 'manual_only' }),
    action: 'start_now',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.pause_mode, 'all');
});

test('pause_mode: a timed pause carries the meaning field too', () => {
  const r = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'pause_until',
    until: MIDNIGHT,
    mode: 'manual_only',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.pause_mode, 'manual_only');
  assert.equal(r.control.paused_until, MIDNIGHT);
  assert.equal(r.control.paused, false, 'still a timer with the flag OFF');
});

test('⚠️ pause_mode: the list actions carry it through UNCHANGED', () => {
  // A requeue that rewrote the meaning of a pause in force would be a control
  // with an invisible side effect — the same rule `requeue` and
  // `priority_front` already follow in the other direction.
  for (const action of ['requeue', 'priority_front'] as const) {
    const r = nextIngestionControl({
      current: withLists({ paused: true, pause_mode: 'manual_only' }),
      action,
      bookIds: ['a-book'],
      actor: 'estate-ops:owner@example.com',
      nowMs: NOW,
    });
    assert.ok('control' in r, action);
    assert.equal(r.control.pause_mode, 'manual_only', action);
    assert.equal(r.control.paused, true, action);
  }
});

test('pause_mode: decoded defensively — an unexpected value is the STRICT meaning', () => {
  for (const raw of [
    { stringValue: 'manual-only' },
    { stringValue: '' },
    { booleanValue: true },
    { nullValue: null },
  ]) {
    const decoded = decodeIngestionControl(
      fsControlDoc({ paused: { booleanValue: true }, pause_mode: raw }),
    );
    assert.equal(decoded!.pause_mode, 'all', JSON.stringify(raw));
  }
  const good = decodeIngestionControl(
    fsControlDoc({ paused: { booleanValue: true }, pause_mode: { stringValue: 'manual_only' } }),
  );
  assert.equal(good!.pause_mode, 'manual_only', 'the one value that unlocks it must survive');
});

test('normalisePauseMode / isPauseMode agree with the reader’s fail-closed rule', () => {
  assert.deepEqual([...PAUSE_MODES], ['all', 'manual_only']);
  assert.equal(isPauseMode('manual_only'), true);
  assert.equal(isPauseMode('all'), true);
  assert.equal(isPauseMode('manual-only'), false);
  assert.equal(normalisePauseMode(undefined), 'all');
  assert.equal(normalisePauseMode('manual_only'), 'manual_only');
});

test('⚠️ the pause wording says WHICH answer landed, in the owner’s own words', () => {
  // A pause that reported only "Saved" would leave the one thing he was just
  // asked to decide invisible — and the two outcomes differ by whether the
  // machine runs tonight.
  const strict = ingestionActionDetail('pause', withLists({ paused: true, pause_mode: 'all' }));
  const lenient = ingestionActionDetail(
    'pause',
    withLists({ paused: true, pause_mode: 'manual_only' }),
  );
  assert.notEqual(strict, lenient, 'the two answers must not read identically');
  assert.match(strict, /all work is stopped/i);
  assert.match(lenient, /scheduled 12am–8am window may continue/i);
  assert.match(lenient, /by hand is refused/i);
  assert.match(pauseModeWords('all'), /stop all work until unpaused/);
  assert.match(pauseModeWords('manual_only'), /let the scheduled window continue/);
});

test('⚠️ pause_mode is encoded on EVERY write, so the flag and its meaning land together', () => {
  // A document that said `paused: true` with the previous pause's meaning
  // still attached — even for an instant — is the bug this pins.
  const fields = ingestionControlFields(withLists({ paused: true, pause_mode: 'manual_only' }));
  assert.deepEqual((fields as Record<string, unknown>).pause_mode, { stringValue: 'manual_only' });
  const cleared = ingestionControlFields(emptyIngestionControl());
  assert.deepEqual((cleared as Record<string, unknown>).pause_mode, { stringValue: 'all' });
});

test('decodeIngestionControl reads the two lists defensively, like every other field', () => {
  const decoded = decodeIngestionControl({
    fields: {
      paused: { booleanValue: false },
      requeue: { arrayValue: { values: [{ stringValue: 'a' }, { integerValue: '7' }] } },
      priority_front: { stringValue: 'not-a-list' },
    },
  });
  assert.ok(decoded);
  assert.deepEqual(decoded.requeue, ['a'], 'a non-string entry is dropped, not coerced');
  assert.deepEqual(decoded.priority_front, [], 'a non-list reads as unset, never as one entry');
});

// ---------------------------------------------------------------------------
// SOFT PAUSES, RECURRING BLOCKERS, DO-NOT-DISTURB PROCESSES (owner asks
// 2026-08-31 + the 2026-09-01 WoW-at-midnight incident; design
// docs/info/ingestion-pause-until-gpu-design.md, reader half landed in
// audiobook_catalog 76aa89b).
//
// ⚠️ WHAT THESE GUARD IS THE SAME FAMILY AS EVERYTHING ABOVE: writes that look
// fine on screen and mean the wrong thing on the machine. A soft pause whose
// flag latched would never release; a Resume that left `pause_until_gpu_free`
// set would arm the NEXT pause with a release nobody asked for; and a
// Start-now that swept the standing lists would delete quiet hours and a
// do-not-disturb entry to satisfy a one-off "go now".
//
// The BEHAVIOUR (a blocker actually refusing a start, the GPU release itself)
// lives on the home machine and is tested there. This Worker only decides what
// gets written, so these pin the write.
// ---------------------------------------------------------------------------

test('nextPhoenixMidnightIso: pinned in JANUARY and JULY, both UTC-7 — no DST, ever', () => {
  // ⚠️ The two months are the whole point: Arizona does not observe DST, so a
  // library-free arithmetic conversion is correct all year. If the estate ever
  // moves, THIS is the test that fails rather than a pause landing an hour out
  // with nothing on screen saying so.
  assert.equal(PHOENIX_OFFSET_MS, 7 * 3_600_000);
  // 2026-01-15T02:30Z is 7:30pm on the 14th in Phoenix → tonight's midnight.
  assert.equal(nextPhoenixMidnightIso(Date.parse('2026-01-15T02:30:00Z')), '2026-01-15T07:00:00.000Z');
  // 2026-07-15T02:30Z is 7:30pm on the 14th in Phoenix → the SAME +07:00 shift.
  assert.equal(nextPhoenixMidnightIso(Date.parse('2026-07-15T02:30:00Z')), '2026-07-15T07:00:00.000Z');
});

test('nextPhoenixMidnightIso: ⚠️ STRICTLY in the future, even standing exactly on midnight', () => {
  // A ceiling equal to "now" would be self-cleared by the very write that set
  // it: the owner would press "Pause for now" at midnight, get a cheerful
  // success, and nothing at all would be paused.
  assert.equal(nextPhoenixMidnightIso(Date.parse('2026-01-15T07:00:00Z')), '2026-01-16T07:00:00.000Z');
  assert.equal(nextPhoenixMidnightIso(Date.parse('2026-01-15T06:59:00Z')), '2026-01-15T07:00:00.000Z');
  // Mid-window (1am Phoenix) it is TOMORROW's opening, not this one — the
  // design's §1a reading: "next scheduled start" is the next window OPENING,
  // not the next 30-minute tick, or the GPU condition would never matter.
  assert.equal(nextPhoenixMidnightIso(Date.parse('2026-01-15T08:00:00Z')), '2026-01-16T07:00:00.000Z');
});

test('⚠️ pause_for_now writes the SOFT shape: flag OFF, ceiling computed, GPU release ON', () => {
  const r = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'pause_for_now',
    actor: 'estate-ops:owner@example.com',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  // The §3 gotcha applies here exactly as it does to pause_until: their step 2
  // never consults a timer, so a latched flag would outlive all three release
  // conditions this pause is supposed to have.
  assert.equal(r.control.paused, false, 'a soft pause NEVER sets the hard flag');
  assert.equal(r.control.paused_until, MIDNIGHT, 'the ceiling is the next 00:00 Phoenix');
  assert.equal(r.control.pause_until_gpu_free, true);
  assert.equal(r.control.pause_mode, 'all');
});

test('pause_for_now needs no time and is never refused for want of one', () => {
  const r = nextIngestionControl({ current: null, action: 'pause_for_now', actor: 'a', nowMs: NOW });
  assert.ok('control' in r);
});

test('⚠️ pause_until is SOFT TOO since 2026-09-01 — the picked time is a CEILING', () => {
  // The owner's own sweep: "any pause thats not the 'until i unpause'" is
  // released by the next window opening or a free GPU. So the picker writes
  // the same shape as the button, with the chosen instant instead of midnight.
  const r = nextIngestionControl({
    current: null,
    action: 'pause_until',
    until: '2026-08-19T04:00:00.000Z',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, false);
  assert.equal(r.control.paused_until, '2026-08-19T04:00:00.000Z');
  assert.equal(r.control.pause_until_gpu_free, true, 'a free GPU releases it early');
});

test('⚠️ the HARD pause clears the GPU-release flag — it is the one pause a free GPU must not end', () => {
  const r = nextIngestionControl({
    current: withLists({ paused: false, paused_until: MIDNIGHT, pause_until_gpu_free: true }),
    action: 'pause',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused, true);
  assert.equal(r.control.paused_until, null);
  assert.equal(r.control.pause_until_gpu_free, false, 'hardening a soft pause must really harden it');
});

test('⚠️ RESUME and START NOW both clear pause_until_gpu_free as well as the ceiling', () => {
  // The flag is half of a pause — the half that says how it ends. A cleared
  // ceiling with a surviving flag describes a release for a pause that no
  // longer exists, and it would arm the next timed pause with it.
  for (const action of ['resume', 'start_now'] as const) {
    const r = nextIngestionControl({
      current: withLists({ paused_until: MIDNIGHT, pause_until_gpu_free: true }),
      action,
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('control' in r, action);
    assert.equal(r.control.paused_until, null, action);
    assert.equal(r.control.pause_until_gpu_free, false, action);
  }
});

test('a soft flag whose ceiling has EXPIRED self-clears with it', () => {
  const r = nextIngestionControl({
    current: withLists({ paused_until: SIX_PM, pause_until_gpu_free: true }),
    action: 'dont_check_until',
    until: '2026-08-19T15:00:00.000Z',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.paused_until, null);
  assert.equal(r.control.pause_until_gpu_free, false, 'no pause left for the GPU to release');
});

test('⚠️ THE STANDING LISTS SURVIVE EVERY OTHER ACTION — the §3a lesson, twice over', () => {
  // Quiet hours and a do-not-disturb entry are instructions the owner set on
  // purpose. Resume drops a pause_window IN FORCE because otherwise it reads
  // as broken; nothing gives it licence to delete a WEEKLY schedule, and
  // start_now least of all.
  const blockers: RecurringWindow[] = [{ days: [1, 2, 3], from: '18:30', until: '22:15' }];
  const programs = ['Wow.exe'];
  for (const action of [
    'pause',
    'resume',
    'pause_until',
    'pause_for_now',
    'dont_check_until',
    'start_now',
    'requeue',
    'priority_front',
    'priority_front_clear',
  ] as const) {
    const r = nextIngestionControl({
      current: withLists({
        paused: true,
        recurring_windows: blockers,
        exempt_processes: programs,
      }),
      action,
      until: '2026-08-19T09:00:00.000Z',
      bookIds: ['a-book'],
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('control' in r, action);
    assert.deepEqual(r.control.recurring_windows, blockers, `${action} kept the blockers`);
    assert.deepEqual(r.control.exempt_processes, programs, `${action} kept the programs`);
  }
});

test('recurring_add: a valid blocker lands, normalised, and appends', () => {
  const first = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'recurring_add',
    // Days deliberately out of order and duplicated: the ORDER is not the
    // instruction here (unlike priority_front), so normalising is what makes
    // "delete this exact row" and "do not add it twice" work at all.
    window: { days: [3, 1, 2, 1], from: '18:30', until: '22:15' },
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in first);
  assert.deepEqual(first.control.recurring_windows, [{ days: [1, 2, 3], from: '18:30', until: '22:15' }]);

  const second = nextIngestionControl({
    current: first.control,
    action: 'recurring_add',
    window: { days: [6, 7], from: '22:00', until: '02:00' }, // crosses midnight
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in second);
  assert.equal(second.control.recurring_windows.length, 2);
  assert.deepEqual(second.control.recurring_windows[1], { days: [6, 7], from: '22:00', until: '02:00' });
});

test('recurring_add: adding the SAME row twice is a no-op that still reports success', () => {
  // A double-tap is not an error, and a duplicated row would show the same
  // blocker twice — deleting one would then look like it had failed.
  const r = nextIngestionControl({
    current: withLists({ recurring_windows: [{ days: [1], from: '06:30', until: '10:15' }] }),
    action: 'recurring_add',
    window: { days: [1], from: '06:30', until: '10:15' },
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.equal(r.control.recurring_windows.length, 1);
});

test('⚠️ recurring_add REFUSES bad input in words, each cause kept apart', () => {
  const cases: Array<[unknown, string, RegExp]> = [
    [{ days: [], from: '18:30', until: '22:15' }, 'invalid_recurring_days', /at least one day/i],
    [{ days: [0], from: '18:30', until: '22:15' }, 'invalid_recurring_days', /at least one day/i],
    [{ days: [8], from: '18:30', until: '22:15' }, 'invalid_recurring_days', /at least one day/i],
    [{ days: [1], from: '6:30', until: '22:15' }, 'invalid_recurring_time', /real time of day/i],
    [{ days: [1], from: '18:30', until: '25:00' }, 'invalid_recurring_time', /real time of day/i],
    [{ days: [1], from: '18:30' }, 'invalid_recurring_time', /real time of day/i],
    // ⚠️ THE ONE THE READER REFUSES AS AMBIGUOUS. The card must refuse it too,
    // with words — letting it through would show a row the machine ignores.
    [{ days: [1], from: '18:30', until: '18:30' }, 'recurring_zero_length', /same time/i],
    [undefined, 'invalid_recurring_days', /at least one day/i],
    ['MTW 630-1015', 'invalid_recurring_days', /at least one day/i],
  ];
  for (const [window, error, detail] of cases) {
    const r = nextIngestionControl({
      current: emptyIngestionControl(),
      action: 'recurring_add',
      window,
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('error' in r, `expected refusal for ${JSON.stringify(window)}`);
    assert.equal(r.error, error, JSON.stringify(window));
    assert.match(r.detail, detail, JSON.stringify(window));
    assert.ok(r.detail.length > 20, 'a refusal says what to do, never a bare code');
  }
});

test('⚠️ recurring_add is BOUNDED at the reader’s own cap, and says so rather than dropping silently', () => {
  const full = Array.from({ length: MAX_RECURRING_WINDOWS }, (_, i) => ({
    days: [1],
    from: `${String(i % 12).padStart(2, '0')}:00`,
    until: `${String((i % 12) + 1).padStart(2, '0')}:30`,
  }));
  const r = nextIngestionControl({
    current: withLists({ recurring_windows: full }),
    action: 'recurring_add',
    window: { days: [7], from: '23:00', until: '23:30' },
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('error' in r);
  assert.equal(r.error, 'too_many_recurring_windows');
  assert.match(r.detail, /Delete one/);
});

test('recurring_delete: removes the exact row, whatever order the days arrive in', () => {
  const keep = { days: [6, 7], from: '22:00', until: '02:00' };
  const r = nextIngestionControl({
    current: withLists({ recurring_windows: [{ days: [1, 2, 3], from: '18:30', until: '22:15' }, keep] }),
    action: 'recurring_delete',
    window: { days: [3, 2, 1], from: '18:30', until: '22:15' },
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.recurring_windows, [keep]);
});

test('recurring_delete: a row that is not there leaves the list alone and does not error', () => {
  const rows = [{ days: [1], from: '18:30', until: '22:15' }];
  const r = nextIngestionControl({
    current: withLists({ recurring_windows: rows }),
    action: 'recurring_delete',
    window: { days: [2], from: '18:30', until: '22:15' },
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.recurring_windows, rows);
});

test('exempt_add: case-PRESERVING store, case-INSENSITIVE dedupe (the reader matches that way)', () => {
  const first = nextIngestionControl({
    current: emptyIngestionControl(),
    action: 'exempt_add',
    process: '  Wow.exe  ',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in first);
  assert.deepEqual(first.control.exempt_processes, ['Wow.exe'], 'trimmed, capitals kept');

  const again = nextIngestionControl({
    current: first.control,
    action: 'exempt_add',
    process: 'WOW.EXE',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in again);
  assert.deepEqual(again.control.exempt_processes, ['Wow.exe'], 'one program, not two');

  const second = nextIngestionControl({
    current: first.control,
    action: 'exempt_add',
    process: 'WowClassic.exe',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in second);
  assert.deepEqual(second.control.exempt_processes, ['Wow.exe', 'WowClassic.exe']);
});

test('exempt_delete: removes ignoring capitals — an owner who typed it lower-case meant the same program', () => {
  const r = nextIngestionControl({
    current: withLists({ exempt_processes: ['Wow.exe', 'WowClassic.exe'] }),
    action: 'exempt_delete',
    process: 'wow.exe',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('control' in r);
  assert.deepEqual(r.control.exempt_processes, ['WowClassic.exe']);
});

test('⚠️ exempt_add refuses a blank or over-long name in words, and is bounded', () => {
  for (const bad of [undefined, null, '', '   ', 7, {}, 'x'.repeat(MAX_CONTROL_ENTRY_CHARS + 1)]) {
    const r = nextIngestionControl({
      current: emptyIngestionControl(),
      action: 'exempt_add',
      process: bad,
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('error' in r, `expected refusal for ${JSON.stringify(bad)}`);
    assert.equal(r.error, 'invalid_process');
    assert.match(r.detail, /image name/i);
  }
  const full = Array.from({ length: MAX_EXEMPT_PROCESSES }, (_, i) => `game${i}.exe`);
  const capped = nextIngestionControl({
    current: withLists({ exempt_processes: full }),
    action: 'exempt_add',
    process: 'Wow.exe',
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('error' in capped);
  assert.equal(capped.error, 'too_many_exempt_processes');
});

test('the standing-list actions carry requeue, priority_front and the pause through untouched', () => {
  for (const [action, extra] of [
    ['recurring_add', { window: { days: [1], from: '18:30', until: '22:15' } }],
    ['exempt_add', { process: 'Wow.exe' }],
    ['exempt_delete', { process: 'nothing.exe' }],
  ] as const) {
    const r = nextIngestionControl({
      current: withLists({
        paused: true,
        pause_mode: 'manual_only',
        requeue: ['keep-me'],
        priority_front: ['and-me'],
      }),
      action,
      ...extra,
      actor: 'a',
      nowMs: NOW,
    });
    assert.ok('control' in r, action);
    assert.deepEqual(r.control.requeue, ['keep-me'], action);
    assert.deepEqual(r.control.priority_front, ['and-me'], action);
    assert.equal(r.control.paused, true, action);
    assert.equal(r.control.pause_mode, 'manual_only', action);
  }
});

test('⚠️ recurring_delete REFUSES an unreadable row rather than reporting a deletion it did not make', () => {
  const r = nextIngestionControl({
    current: withLists({ recurring_windows: [{ days: [1], from: '18:30', until: '22:15' }] }),
    action: 'recurring_delete',
    window: { days: [9], from: '18:30', until: '22:15' },
    actor: 'a',
    nowMs: NOW,
  });
  assert.ok('error' in r);
  assert.equal(r.error, 'invalid_recurring_days');
});

test('cleanRecurringWindow: drops what cannot be read rather than repairing it', () => {
  assert.deepEqual(cleanRecurringWindow({ days: ['1', 2], from: '00:00', until: '08:00' }), {
    days: [1, 2],
    from: '00:00',
    until: '08:00',
  });
  for (const bad of [
    null,
    'MTW',
    { days: [1] },
    { days: [1], from: '18:30', until: '18:30' },
    { days: [1, 1.5], from: '18:30', until: '22:15' },
    { days: [1], from: '18:3', until: '22:15' },
  ]) {
    assert.equal(cleanRecurringWindow(bad), null, JSON.stringify(bad));
  }
  assert.equal(isHhMm('23:59'), true);
  assert.equal(isHhMm('24:00'), false);
  assert.equal(isHhMm('6:30'), false);
});

test('cleanRecurringWindows: de-dupes, caps, and never crashes on junk', () => {
  const list = cleanRecurringWindows([
    { days: [1], from: '18:30', until: '22:15' },
    { days: [1], from: '18:30', until: '22:15' }, // exact duplicate
    'not a window',
    null,
    { days: [2], from: '18:30', until: '22:15' },
  ]);
  assert.deepEqual(list, [
    { days: [1], from: '18:30', until: '22:15' },
    { days: [2], from: '18:30', until: '22:15' },
  ]);
  const many = cleanRecurringWindows(
    Array.from({ length: MAX_RECURRING_WINDOWS + 5 }, (_, i) => ({
      days: [(i % 7) + 1],
      from: `${String(i % 12).padStart(2, '0')}:00`,
      until: `${String((i % 12) + 1).padStart(2, '0')}:30`,
    })),
  );
  assert.equal(many.length, MAX_RECURRING_WINDOWS);
});

test('cleanProcessName / cleanProcessNames mirror the reader’s bounds', () => {
  assert.equal(cleanProcessName(' Wow.exe '), 'Wow.exe');
  assert.equal(cleanProcessName(''), null);
  assert.equal(cleanProcessName(7), null);
  assert.equal(cleanProcessName('x'.repeat(MAX_CONTROL_ENTRY_CHARS + 1)), null);
  assert.deepEqual(cleanProcessNames(['Wow.exe', 'wow.exe', 7, '', 'WowClassic.exe']), [
    'Wow.exe',
    'WowClassic.exe',
  ]);
  assert.equal(
    cleanProcessNames(Array.from({ length: MAX_EXEMPT_PROCESSES + 3 }, (_, i) => `g${i}.exe`)).length,
    MAX_EXEMPT_PROCESSES,
  );
});

test('⚠️ decodeIngestionControl reads WEEKDAY NUMBERS, which arrive as REST integerValue STRINGS', () => {
  // The one genuinely new decode shape. Before this build, fsValue() had no
  // integerValue branch at all, so every `days` entry decoded to null and
  // every blocker would have been dropped — invisibly, since a dropped
  // blocker looks exactly like a blocker nobody set.
  const decoded = decodeIngestionControl(
    fsControlDoc({
      paused: { booleanValue: false },
      pause_until_gpu_free: { booleanValue: true },
      recurring_windows: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  days: { arrayValue: { values: [{ integerValue: '1' }, { integerValue: '3' }] } },
                  from: { stringValue: '18:30' },
                  until: { stringValue: '22:15' },
                },
              },
            },
            // Malformed: dropped WITH the rest of the list still read, exactly
            // as clean_id_list does on the far side.
            {
              mapValue: {
                fields: {
                  days: { arrayValue: { values: [{ integerValue: '9' }] } },
                  from: { stringValue: '18:30' },
                  until: { stringValue: '22:15' },
                },
              },
            },
          ],
        },
      },
      exempt_processes: {
        arrayValue: { values: [{ stringValue: 'Wow.exe' }, { integerValue: '7' }] },
      },
    }),
  );
  assert.ok(decoded);
  assert.equal(decoded.pause_until_gpu_free, true);
  assert.deepEqual(decoded.recurring_windows, [{ days: [1, 3], from: '18:30', until: '22:15' }]);
  assert.deepEqual(decoded.exempt_processes, ['Wow.exe'], 'a non-string entry is dropped, not coerced');
});

test('decodeIngestionControl: the new fields fail CLOSED on junk, like every other field', () => {
  const decoded = decodeIngestionControl(
    fsControlDoc({
      paused: { booleanValue: false },
      pause_until_gpu_free: { stringValue: 'true' }, // wrong type — must NOT be true
      recurring_windows: { stringValue: 'MTW 630-1015' },
      exempt_processes: { stringValue: 'Wow.exe' }, // a bare string is not a list
    }),
  );
  assert.ok(decoded);
  assert.equal(decoded.pause_until_gpu_free, false);
  assert.deepEqual(decoded.recurring_windows, []);
  assert.deepEqual(decoded.exempt_processes, []);
});

test('ingestionControlFields: the soft flag is a REAL boolean and the days are integerValue strings', () => {
  // ⚠️ The reader coerces with `is True`, so the type is load-bearing: a
  // string here reads as truthy in Python and a soft pause would never end.
  const fields = ingestionControlFields(
    withLists({
      pause_until_gpu_free: true,
      recurring_windows: [{ days: [1, 7], from: '22:00', until: '02:00' }],
      exempt_processes: ['Wow.exe'],
    }),
  ) as Record<string, unknown>;
  assert.deepEqual(fields.pause_until_gpu_free, { booleanValue: true });
  assert.deepEqual(fields.recurring_windows, {
    arrayValue: {
      values: [
        {
          mapValue: {
            fields: {
              days: { arrayValue: { values: [{ integerValue: '1' }, { integerValue: '7' }] } },
              from: { stringValue: '22:00' },
              until: { stringValue: '02:00' },
            },
          },
        },
      ],
    },
  });
  assert.deepEqual(fields.exempt_processes, { arrayValue: { values: [{ stringValue: 'Wow.exe' }] } });
  const off = ingestionControlFields(emptyIngestionControl()) as Record<string, unknown>;
  assert.deepEqual(off.pause_until_gpu_free, { booleanValue: false });
});

test('sameRecurringList / sameStringList decide whether the mask carries the list at all', () => {
  const a: RecurringWindow[] = [{ days: [1, 2], from: '18:30', until: '22:15' }];
  assert.equal(sameRecurringList(a, [{ days: [1, 2], from: '18:30', until: '22:15' }]), true);
  assert.equal(sameRecurringList(a, [{ days: [1], from: '18:30', until: '22:15' }]), false);
  assert.equal(sameRecurringList(a, []), false);
  assert.equal(
    sameRecurringWindow(a[0]!, { days: [2, 1], from: '18:30', until: '22:15' }),
    false,
    'rows are stored normalised, so an unnormalised row is genuinely a different one',
  );
  assert.equal(sameStringList(['Wow.exe'], ['Wow.exe']), true);
  // A change of CASE is a real change to the document even though the reader
  // matches either way — the owner would see a different row.
  assert.equal(sameStringList(['Wow.exe'], ['wow.exe']), false);
});

test('⚠️ the soft pause’s wording says AT LATEST, because its timer is a ceiling', () => {
  // An owner who read "paused until midnight" and found books running at 9pm
  // would rightly stop trusting this card. Both soft forms have to admit it.
  const forNow = ingestionActionDetail('pause_for_now', emptyIngestionControl());
  assert.match(forNow, /at the latest/i);
  assert.match(forNow, /GPU has been quiet/i);
  const until = ingestionActionDetail('pause_until', emptyIngestionControl());
  assert.match(until, /LATEST it can last/);
  assert.match(until, /Pause until I unpause/, 'it names the control that does survive a free GPU');
  // The HARD pause still promises the opposite, and the two must not read alike.
  const hard = ingestionActionDetail('pause', withLists({ paused: true }));
  assert.notEqual(hard, until);
  assert.match(hard, /Nothing overrides this/);
});

test('the two standing lists’ wording says what the machine will DO with them', () => {
  const blocked = ingestionActionDetail(
    'recurring_add',
    withLists({ recurring_windows: [{ days: [1], from: '18:30', until: '22:15' }] }),
  );
  assert.match(blocked, /1 recurring blocker set/);
  // ⚠️ The consequence the design says to state to the owner's face: a blocker
  // overlapping 12am–8am stops the scheduled run for the overlap.
  assert.match(blocked, /12am–8am/);
  const dnd = ingestionActionDetail('exempt_add', withLists({ exempt_processes: ['Wow.exe'] }));
  assert.match(dnd, /1 program on the do-not-disturb list/);
  assert.match(dnd, /NOTHING new starts/);
  assert.match(dnd, /Wow\.exe/, 'it says which NAME to type, since the match is exact');
});
