/**
 * worker-events.test.ts — the capped event ring behind /status's
 * "Recent worker events".
 *
 * ⚠️ THE FAILURE THIS SURFACE CAN CAUSE IS A FALSE ALL-CLEAR. An empty list
 * rendered without a date reads as "no errors", and the placeholder this
 * replaces refused to show an empty box for exactly that reason. So the tests
 * below care most about the two things that keep that honest: the validator
 * REFUSING rather than storing something misleading, and the read always
 * carrying a `since`.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EVENTS_PER_WORKER,
  EVENT_LEVELS,
  MAX_BATCH,
  MAX_MESSAGE,
  parseEvents,
} from '../src/worker-events.js';

const NOW = '2026-08-18T22:00:00.000Z';
const ok = { worker: 'catalog-index', level: 'error', message: 'push rejected' };

test('parseEvents: a single event and a batch both work', () => {
  const one = parseEvents(ok, NOW);
  assert.ok('events' in one);
  assert.equal(one.events.length, 1);
  assert.equal(one.events[0]!.worker, 'catalog-index');

  const many = parseEvents([ok, { ...ok, level: 'warn' }], NOW);
  assert.ok('events' in many);
  assert.equal(many.events.length, 2);
});

test('⚠️ IT REFUSES, IT NEVER STRIPS', () => {
  // A Worker that believes it reported an error and did not is strictly worse
  // than one that never tried, because the silence is then trusted.
  const cases: Array<[unknown, string]> = [
    [{ level: 'error', message: 'x' }, 'missing_worker'],
    [{ worker: 'w', level: 'error' }, 'missing_message'],
    [{ worker: 'w', level: 'chatty', message: 'x' }, 'bad_level'],
    [{ worker: 'w', message: 'x' }, 'bad_level'],
    ['a string', 'not_an_object'],
    [[], 'empty_batch'],
  ];
  for (const [body, expected] of cases) {
    const r = parseEvents(body, NOW);
    assert.ok('error' in r, `expected refusal for ${JSON.stringify(body)}`);
    assert.equal(r.error, expected, `for ${JSON.stringify(body)}`);
    assert.ok(r.detail.length > 10, 'every refusal explains itself');
  }
});

test('the bad-level refusal NAMES the levels that are accepted', () => {
  const r = parseEvents({ worker: 'w', level: 'nope', message: 'x' }, NOW);
  assert.ok('error' in r);
  for (const l of EVENT_LEVELS) assert.match(r.detail, new RegExp(l));
});

test('⚠️ an absurd batch is refused outright, not silently truncated', () => {
  const big = Array.from({ length: MAX_BATCH + 1 }, () => ok);
  const r = parseEvents(big, NOW);
  assert.ok('error' in r);
  assert.equal(r.error, 'batch_too_large');
  // Storing a slice would mean the writer believes all of them landed.
  assert.match(r.detail, new RegExp(String(MAX_BATCH)));
});

test('long messages are capped, not rejected — a stack trace is still useful', () => {
  const r = parseEvents({ ...ok, message: 'x'.repeat(MAX_MESSAGE + 500) }, NOW);
  assert.ok('events' in r);
  assert.equal(r.events[0]!.message.length, MAX_MESSAGE);
});

test('⚠️ a broken writer clock loses the EVENT TIME, never the event', () => {
  // received_at records what actually happened either way, so falling back is
  // strictly better than dropping a report because a clock is wrong.
  const r = parseEvents({ ...ok, at: 'not a date' }, NOW);
  assert.ok('events' in r);
  assert.equal(r.events[0]!.at, NOW);

  const good = parseEvents({ ...ok, at: '2026-08-18T21:00:00.000Z' }, NOW);
  assert.ok('events' in good);
  assert.equal(good.events[0]!.at, '2026-08-18T21:00:00.000Z');
});

test('optional context rides through, and absent context is null not ""', () => {
  const r = parseEvents({ ...ok, route: '/api/push/game', request_id: 'abc123', detail: 'stack' }, NOW);
  assert.ok('events' in r);
  assert.equal(r.events[0]!.route, '/api/push/game');
  assert.equal(r.events[0]!.request_id, 'abc123');

  const bare = parseEvents(ok, NOW);
  assert.ok('events' in bare);
  assert.equal(bare.events[0]!.route, null);
  assert.equal(bare.events[0]!.detail, null);
});

test('whitespace-only fields count as absent', () => {
  const r = parseEvents({ worker: '   ', level: 'error', message: 'x' }, NOW);
  assert.ok('error' in r);
  assert.equal(r.error, 'missing_worker');
});

test('⚠️ the cap is PER WORKER — one noisy Worker must not evict the others', () => {
  // Global capping would delete every other Worker's history on the night one
  // of them misbehaves, which is exactly when the others are worth comparing.
  assert.equal(EVENTS_PER_WORKER, 200);
  assert.ok(EVENTS_PER_WORKER >= 50, 'too small to hold a bad night');
  assert.ok(EVENTS_PER_WORKER <= 1000, 'large enough to be a log rather than a noticeboard');
});
