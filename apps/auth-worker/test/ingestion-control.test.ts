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
  type IngestionControl,
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
  assert.deepEqual(
    [...INGESTION_ACTIONS],
    [
      'pause',
      'resume',
      'pause_until',
      'dont_check_until',
      'start_now',
      'requeue',
      'priority_front',
      'priority_front_clear',
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
    dont_check_until: null,
    pause_windows: [{ from: '2026-08-19T02:00:00.000Z', until: MIDNIGHT }],
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
      dont_check_until: null,
      pause_windows: [],
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
      dont_check_until: '2026-08-19T15:00:00.000Z',
      pause_windows: [
        { from: '2026-08-19T02:00:00.000Z', until: MIDNIGHT }, // in force right now
        { from: later, until: '2026-08-20T07:00:00.000Z' }, // still to come
      ],
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
      dont_check_until: SIX_PM,
      pause_windows: [
        { from: '2026-08-18T02:00:00.000Z', until: '2026-08-18T07:00:00.000Z' }, // expired
        { from: '2026-08-20T02:00:00.000Z', until: '2026-08-20T07:00:00.000Z' }, // future
      ],
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
    dont_check_until: null,
    pause_windows: [],
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
    dont_check_until: '2026-08-19T15:00:00.000Z',
    pause_windows: [{ from: '2026-08-20T02:00:00.000Z', until: '2026-08-20T07:00:00.000Z' }],
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
