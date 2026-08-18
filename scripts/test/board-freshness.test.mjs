/**
 * board-freshness.test.mjs — the freshness strip's choice of clock.
 *
 * ⚠️ THE WRINKLE THIS PINS was written down in docs/info/agent-board-contract.md
 * §9 the day the second pusher shipped, and shipped KNOWN-BROKEN: the board is
 * ONE D1 row holding ONE JSON object, both pushers write it whole (a partial
 * push would delete the other's section), so `pushed_at` only ever said when
 * SOMEBODY last pushed. The processing pusher fires every 15 minutes. So
 * /status/agents' strip read "as of 2 minutes ago" over agent rows the conductor
 * had not touched since breakfast — a stale picture wearing a fresh timestamp,
 * which is the exact failure the strip exists to prevent.
 *
 * The Worker half (which section moved, and when) is pinned in
 * apps/auth-worker/test/agent-board.test.ts. This file pins the READER half:
 * given the stamps, which one does a page show, and what does it say when it
 * has none.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sectionFreshness } from '../../sites/heygabi-home/public/status/lib/board.js';

const MORNING = '2026-08-18T09:00:00.000Z';
const NOON = '2026-08-18T12:00:00.000Z';
const NOW_ISH = '2026-08-18T21:00:00.000Z';

const AGENTS_PAGE = ['agents', 'events', 'usage'];

test('⚠️ THE BUG: the strip reports the SECTION age, not the board push age', () => {
  // A processing push landed seconds ago; the conductor's sections are hours
  // old. The page must say hours.
  const result = {
    pushedAt: NOW_ISH,
    sectionPushedAt: { agents: MORNING, events: MORNING, usage: NOON, processing: NOW_ISH },
  };
  const fresh = sectionFreshness(result, AGENTS_PAGE);
  assert.equal(fresh.iso, MORNING);
  assert.equal(fresh.fellBack, false);
  assert.notEqual(fresh.iso, result.pushedAt);
});

test('the OLDEST of a page’s sections wins, and the strip can name which', () => {
  const result = { pushedAt: NOW_ISH, sectionPushedAt: { agents: NOON, events: MORNING, usage: NOW_ISH } };
  const fresh = sectionFreshness(result, AGENTS_PAGE);
  assert.equal(fresh.key, 'events');
  assert.equal(fresh.iso, MORNING);
});

test('a one-section page reads only its own section', () => {
  const result = { pushedAt: NOW_ISH, sectionPushedAt: { agents: MORNING, processing: NOON } };
  const fresh = sectionFreshness(result, ['processing']);
  assert.equal(fresh.iso, NOON);
  assert.equal(fresh.key, 'processing');
});

test('⚠️ a pre-0013 board FALLS BACK and flags it — it never invents a section age', () => {
  // The strip must then say "this is the whole board's age, any section may be
  // older". Silently presenting the board age as the section's own would be the
  // original bug with a fix's name on it.
  const fresh = sectionFreshness({ pushedAt: NOON, sectionPushedAt: {} }, AGENTS_PAGE);
  assert.equal(fresh.iso, NOON);
  assert.equal(fresh.fellBack, true);
  assert.deepEqual(fresh.missing, AGENTS_PAGE);
});

test('an unreadable or absent stamp is ignored, not treated as fresh', () => {
  const result = { pushedAt: NOW_ISH, sectionPushedAt: { agents: 'not a date', events: MORNING } };
  const fresh = sectionFreshness(result, AGENTS_PAGE);
  assert.equal(fresh.iso, MORNING, 'the one readable stamp is used');
  assert.equal(fresh.fellBack, false);
  // The sections with no usable stamp are NAMED, so the reader knows the age
  // above does not cover them.
  assert.deepEqual(fresh.missing.sort(), ['agents', 'usage']);
});

test('a board with no stamps AND no push time reports null rather than "now"', () => {
  const fresh = sectionFreshness({ pushedAt: null, sectionPushedAt: {} }, AGENTS_PAGE);
  assert.equal(fresh.iso, null);
  assert.equal(fresh.fellBack, true);
});

test('a missing result or missing section list degrades without throwing', () => {
  assert.equal(sectionFreshness(null, AGENTS_PAGE).iso, null);
  assert.equal(sectionFreshness({ pushedAt: NOON }, null).fellBack, true);
  assert.equal(sectionFreshness({ pushedAt: NOON }, []).iso, NOON);
});
