/**
 * claude-usage.test.ts — the Claude budget meter on /status.
 *
 * ⚠️ THE FAILURE THIS SURFACE CAN CAUSE IS A COMFORTABLE NUMBER NOBODY EARNED,
 * and it has two shapes:
 *
 *   1. A reading that stopped arriving hours ago still rendering its last calm
 *      figure. Usage only ever RISES inside a window, so a stale reading is
 *      always an under-estimate — the one direction of error that gets a run
 *      killed mid-build.
 *   2. A percentage that was computed rather than read. The meters show whole
 *      percent; anything fractional came from somewhere else, and an estimate
 *      wearing a measurement's clothes is the exact thing the estate's rules
 *      forbid.
 *
 * So these tests care most about what must NOT render green, and about the
 * validator refusing rather than storing something that renders wrongly.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  SESSION_PAUSE_PCT,
  STALE_AFTER_MS,
  WEEKLY_NO_AGENTS_PCT,
  WEEKLY_STOP_PCT,
  deriveUsageState,
  validateUsage,
  type StoredUsage,
  type UsageReport,
} from '../src/claude-usage.js';

const good: UsageReport = {
  session_pct: 2,
  weekly_pct: 40,
  fable_pct: 50,
  credits_pct: 63,
  credits_spent_cents: 6293,
  session_resets: 'Resets in 4 hr 20 min',
  weekly_resets: 'Resets Sun 3:59 PM',
};

const NOW = Date.parse('2026-08-21T15:40:00.000Z');
const stamp = (r: Partial<UsageReport>, agoMs = 0): StoredUsage => ({
  ...good,
  ...r,
  received_at: new Date(NOW - agoMs).toISOString(),
});

// ── validation ─────────────────────────────────────────────────────────────

test('accepts a well-formed reading', () => {
  const v = validateUsage({ ...good });
  assert.equal(v.ok, true);
});

test('accepts a reading with only the four percentages — the labels are optional', () => {
  const v = validateUsage({ session_pct: 1, weekly_pct: 2, fable_pct: 3, credits_pct: 4 });
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.report.session_resets, undefined);
});

test('⚠️ rejects a FRACTIONAL percentage — the meters show whole percent, so a fraction was computed, not read', () => {
  const v = validateUsage({ ...good, weekly_pct: 92.5 });
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /whole number|computed rather than read/);
});

test('rejects a percentage outside 0–100', () => {
  for (const bad of [-1, 101, 1000]) {
    const v = validateUsage({ ...good, session_pct: bad });
    assert.equal(v.ok, false, `${bad} was accepted`);
  }
});

test('rejects a missing percentage rather than defaulting it to zero', () => {
  // ⚠️ A defaulted 0 would render as "loads of budget left" — the single most
  // dangerous value this field can silently take.
  const { fable_pct, ...withoutFable } = good;
  void fable_pct;
  const v = validateUsage(withoutFable);
  assert.equal(v.ok, false);
  if (!v.ok) assert.match(v.detail, /fable_pct/);
});

test('rejects a non-object body', () => {
  for (const bad of [null, 'nope', 42, []]) {
    const v = validateUsage(bad);
    assert.equal(v.ok, false, `${JSON.stringify(bad)} was accepted`);
  }
});

test('rejects an over-long reset label — it is stored verbatim and rendered as text', () => {
  const v = validateUsage({ ...good, weekly_resets: 'x'.repeat(61) });
  assert.equal(v.ok, false);
});

test('money is whole cents, never a float', () => {
  assert.equal(validateUsage({ ...good, credits_spent_cents: 62.93 }).ok, false);
  assert.equal(validateUsage({ ...good, credits_spent_cents: 6293 }).ok, true);
});

// ── state derivation ───────────────────────────────────────────────────────

test('no reading at all is never_reported — NOT "usage is fine"', () => {
  const { state, detail } = deriveUsageState(null, NOW);
  assert.equal(state, 'never_reported');
  // The wording matters: the absence of a reading must not read as a low one.
  assert.match(detail, /not a claim that usage is low|absence of a reading/);
});

test('⚠️ a stale reading is unknown, however calm its numbers were', () => {
  const { state } = deriveUsageState(stamp({ session_pct: 1, weekly_pct: 1 }, STALE_AFTER_MS + 60_000), NOW);
  assert.equal(state, 'unknown', 'an old comfortable reading rendered as a current one');
});

test('a reading just inside the staleness window still counts', () => {
  const { state } = deriveUsageState(stamp({}, STALE_AFTER_MS - 60_000), NOW);
  assert.equal(state, 'ok');
});

test('an unparseable timestamp is unknown, not ok', () => {
  const bad = { ...good, received_at: 'not-a-date' } as StoredUsage;
  assert.equal(deriveUsageState(bad, NOW).state, 'unknown');
});

test('a fresh reading inside every threshold is ok', () => {
  assert.equal(deriveUsageState(stamp({}), NOW).state, 'ok');
});

test('weekly at the no-agents threshold stops agents, not conversation', () => {
  const { state, detail } = deriveUsageState(stamp({ weekly_pct: WEEKLY_NO_AGENTS_PCT }), NOW);
  assert.equal(state, 'weekly_no_agents');
  assert.match(detail, /No new agents/);
  // It must say the work that is still allowed, or the reader over-corrects.
  assert.match(detail, new RegExp(`${WEEKLY_STOP_PCT}%`));
});

test('weekly at the stop threshold stops everything', () => {
  assert.equal(deriveUsageState(stamp({ weekly_pct: WEEKLY_STOP_PCT }), NOW).state, 'weekly_stop');
});

test('session at its own threshold pauses, even while weekly is untouched', () => {
  // ⚠️ The two limits do NOT share a threshold. 89% is calibrated for the
  // session window; applying it to weekly wastes a session's budget every time.
  const { state } = deriveUsageState(stamp({ session_pct: SESSION_PAUSE_PCT, weekly_pct: 10 }), NOW);
  assert.equal(state, 'session_pause');
});

test('⚠️ session_pause OUTRANKS weekly_no_agents — severity is what it ASKS YOU TO DO, not the bigger number', () => {
  // 93% weekly says "no new agents, keep working". 89% session says "stop and
  // shut down cleanly". Sorting these by percentage would downgrade the
  // stricter instruction to the looser one.
  const both = stamp({ session_pct: SESSION_PAUSE_PCT + 5, weekly_pct: WEEKLY_NO_AGENTS_PCT + 1 });
  assert.equal(deriveUsageState(both, NOW).state, 'session_pause');
});

test('weekly_stop outranks everything, including a session pause', () => {
  const both = stamp({ session_pct: 99, weekly_pct: WEEKLY_STOP_PCT });
  assert.equal(deriveUsageState(both, NOW).state, 'weekly_stop');
});

test('⚠️ staleness beats every threshold — an old 99% is still "unknown", not a state to act on', () => {
  const old = stamp({ session_pct: 99, weekly_pct: 99 }, STALE_AFTER_MS * 2);
  assert.equal(deriveUsageState(old, NOW).state, 'unknown');
});

test('the thresholds are the ones the global rules actually specify', () => {
  // Pinned so a later edit has to be deliberate: these numbers are load-bearing
  // operating policy, not tuning knobs.
  assert.equal(SESSION_PAUSE_PCT, 89);
  assert.equal(WEEKLY_NO_AGENTS_PCT, 93);
  assert.equal(WEEKLY_STOP_PCT, 97);
});
