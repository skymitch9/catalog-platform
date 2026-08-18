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
  assert.deepEqual([...INGESTION_ACTIONS], ['pause', 'resume', 'pause_until', 'dont_check_until']);
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
    paused_until: MIDNIGHT,
    dont_check_until: null,
    pause_windows: [{ from: '2026-08-19T02:00:00.000Z', until: MIDNIGHT }],
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
      paused_until: null,
      dont_check_until: null,
      pause_windows: [],
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
      paused_until: MIDNIGHT,
      dont_check_until: '2026-08-19T15:00:00.000Z',
      pause_windows: [
        { from: '2026-08-19T02:00:00.000Z', until: MIDNIGHT }, // in force right now
        { from: later, until: '2026-08-20T07:00:00.000Z' }, // still to come
      ],
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
      paused_until: SIX_PM,
      dont_check_until: SIX_PM,
      pause_windows: [
        { from: '2026-08-18T02:00:00.000Z', until: '2026-08-18T07:00:00.000Z' }, // expired
        { from: '2026-08-20T02:00:00.000Z', until: '2026-08-20T07:00:00.000Z' }, // future
      ],
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
    paused_until: null,
    dont_check_until: null,
    pause_windows: [],
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
    paused_until: MIDNIGHT,
    dont_check_until: '2026-08-19T15:00:00.000Z',
    pause_windows: [{ from: '2026-08-20T02:00:00.000Z', until: '2026-08-20T07:00:00.000Z' }],
    updated_by: 'estate-ops:owner@example.com',
    updated_at: '2026-08-19T02:30:00.000Z',
  };
  assert.deepEqual(decodeIngestionControl({ fields: ingestionControlFields(control) }), control);
});
