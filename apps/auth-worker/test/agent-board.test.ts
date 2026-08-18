/**
 * agent-board.test.ts — the conductor's push surface
 * (`GET`/`POST /api/estate/ops/agent-board`, 2026-08-18, the /status split's
 * Agents page).
 *
 * Its own file rather than more of ops.test.ts because it pins a different
 * KIND of thing again: ops.ts writes Firestore documents another repo consumes,
 * this owns a D1 row of its OWN and, uniquely in this Worker, carries a WRITE
 * door that is not a Firebase identity at all. Three of the failures below are
 * silent by construction and none of them would look wrong on screen:
 *
 *   1. a bearer check that passes when the secret is UNSET (an open write door
 *      that reads exactly like a working one);
 *   2. "never pushed" and "pushed but unreadable" collapsing into one answer
 *      (the page would say "no agents" for a corrupted blob);
 *   3. a validator that STRIPS what it does not understand instead of
 *      refusing, so a pusher believes it published something it did not — the
 *      estate has that bug on record and this file is where it is fenced out.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGENT_BOARD_MAX_BYTES,
  AGENT_BOARD_ROW_ID,
  checkConductorAuth,
  conductorRefusal,
  parseAgentBoard,
  parseDeclaredSections,
  parseSectionStamps,
  readAgentBoard,
  stampSections,
} from '../src/agent-board.js';

const SECRET = 'a'.repeat(64);
const NOW = '2026-08-18T21:04:00.000Z';

// ---------------------------------------------------------------------------
// The bearer door
// ---------------------------------------------------------------------------

test('checkConductorAuth: an UNSET secret never admits anyone', () => {
  // ⚠️ The failure this exists for: a `if (secret && secret !== given)` shape
  // passes every request while the secret is unset. A write door that is open
  // before it is configured is worse than one that refuses everything.
  assert.equal(checkConductorAuth(undefined, `Bearer ${SECRET}`), 'secret_unset');
  assert.equal(checkConductorAuth('', `Bearer ${SECRET}`), 'secret_unset');
  assert.equal(checkConductorAuth(undefined, null), 'secret_unset');
});

test('checkConductorAuth: the four causes stay four causes', () => {
  assert.equal(checkConductorAuth(SECRET, `Bearer ${SECRET}`), 'ok');
  assert.equal(checkConductorAuth(SECRET, null), 'no_header');
  assert.equal(checkConductorAuth(SECRET, '   '), 'no_header');
  assert.equal(checkConductorAuth(SECRET, SECRET), 'no_header'); // no "Bearer "
  assert.equal(checkConductorAuth(SECRET, `Bearer ${'b'.repeat(64)}`), 'bad_token');
  // A prefix of the real secret is a WRONG token, never a partial pass.
  assert.equal(checkConductorAuth(SECRET, `Bearer ${'a'.repeat(63)}`), 'bad_token');
});

test('checkConductorAuth: the scheme is case-insensitive and the value is trimmed', () => {
  // Real clients send "bearer"; a shell heredoc leaves a trailing newline.
  assert.equal(checkConductorAuth(SECRET, `bearer ${SECRET}`), 'ok');
  assert.equal(checkConductorAuth(SECRET, `Bearer  ${SECRET}  `), 'ok');
});

test('checkConductorAuth: a BOM’d STORED secret rejects a clean bearer — visibly', () => {
  // ⚠️ THE discord-bot.md §7 INCIDENT, pinned at the one end where it hides.
  // A PowerShell-piped `wrangler secret put` prepends an invisible UTF-8 BOM,
  // and the stored value is then wrong while LOOKING perfect in every place a
  // human can inspect it. This test does not fix that — nothing here can —
  // it records what the symptom looks like from this side (`bad_token` on a
  // bearer the operator knows is right), so the next person reads the doc
  // instead of re-deriving the night. The transport that avoids it is the
  // file-redirect method, written out in docs/access/agent-board.md.
  const bomd = `﻿${SECRET}`;
  assert.equal(checkConductorAuth(bomd, `Bearer ${SECRET}`), 'bad_token');
  // …and the header side is forgiving on purpose: a value pasted with a
  // stray BOM or a trailing newline still authenticates against a CLEAN
  // stored secret, so only the storage end can ever produce the failure.
  assert.equal(checkConductorAuth(SECRET, `Bearer ${bomd}\n`), 'ok');
});

test('conductorRefusal: every cause carries words and a fix, never a bare status', () => {
  const unset = conductorRefusal('secret_unset');
  assert.equal(unset.status, 503);
  assert.equal(unset.body.error, 'conductor_token_unset');
  assert.match(unset.body.fix ?? '', /ESTATE_CONDUCTOR_TOKEN/);

  const none = conductorRefusal('no_header');
  assert.equal(none.status, 401);
  assert.equal(none.body.error, 'unauthenticated');
  assert.match(none.body.detail, /Bearer/);
  assert.match(none.body.detail, /docs\/access\/agent-board\.md/);

  const bad = conductorRefusal('bad_token');
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, 'bad_token');
  // ⚠️ "wrong token" and "no token" must stay distinguishable: one is a
  // rotation, the other is a missing header, and they are fixed differently.
  assert.notEqual(bad.body.error, none.body.error);
});

// ---------------------------------------------------------------------------
// The envelope validator
// ---------------------------------------------------------------------------

test('parseAgentBoard: accepts an object and hands it back UNTOUCHED', () => {
  // ⚠️ Pass-through is the contract, not laziness: the home-machine pipeline
  // that fills `processing` does not exist yet, so a validator that insisted
  // on today's field list would reject tomorrow's correct push.
  const blob = {
    agents: [{ name: 'status-split', model: 'opus', state: 'running' }],
    events: [{ at: NOW, kind: 'dispatched', agent: 'status-split' }],
    usage: { session_pct: 62, weekly_pct: 71, fable_pct: 40, read_at: NOW },
    a_field_nobody_has_invented_yet: { deep: [1, 2, 3] },
  };
  const out = parseAgentBoard(JSON.stringify(blob));
  assert.ok(!('error' in out));
  assert.deepEqual(out.board, blob);
});

test('parseAgentBoard: refuses, never strips', () => {
  // The estate's recorded bug: a validator that silently drops what it does
  // not understand leaves a pusher believing it published something it did not.
  for (const body of ['[]', '"a string"', '42', 'null', 'true']) {
    const out = parseAgentBoard(body);
    assert.ok('error' in out, `${body} should have been refused`);
    assert.equal(out.error, 'not_an_object');
    assert.match(out.detail, /agents/);
  }
});

test('parseAgentBoard: the three malformed cases each get their own word', () => {
  const empty = parseAgentBoard('');
  assert.ok('error' in empty && empty.error === 'empty_body');

  const bad = parseAgentBoard('{ not json');
  assert.ok('error' in bad && bad.error === 'invalid_json');

  const huge = parseAgentBoard(JSON.stringify({ pad: 'x'.repeat(AGENT_BOARD_MAX_BYTES) }));
  assert.ok('error' in huge && huge.error === 'board_too_large');
  // The refusal has to name the number and the fix, or a pusher retries blind.
  assert.match(huge.detail, new RegExp(String(AGENT_BOARD_MAX_BYTES)));
  assert.match(huge.detail, /event feed/);
});

test('parseAgentBoard: measures BYTES, not characters', () => {
  // A board full of book titles is not ASCII. A char-count cap would let a
  // multi-byte board through at up to 4× the intended size.
  const emoji = '🙂'; // 4 bytes, 2 UTF-16 code units
  const body = JSON.stringify({ pad: emoji.repeat(AGENT_BOARD_MAX_BYTES / 4) });
  const out = parseAgentBoard(body);
  assert.ok('error' in out && out.error === 'board_too_large');
});

// ---------------------------------------------------------------------------
// The read shape
// ---------------------------------------------------------------------------

test('readAgentBoard: nothing pushed is a STATE, not an error', () => {
  const answer = readAgentBoard(null, NOW);
  assert.equal(answer.exists, false);
  assert.equal(answer.pushed_at, null);
  assert.equal(answer.board, null);
  assert.equal(answer.now, NOW);
});

test('readAgentBoard: a stored row round-trips whole', () => {
  const board = { agents: [], events: [], usage: { session_pct: 3 } };
  const answer = readAgentBoard(
    { board: JSON.stringify(board), pushed_at: '2026-08-18T20:00:00.000Z', pushed_by: 'conductor@home-pc' },
    NOW,
  );
  assert.equal(answer.exists, true);
  assert.equal(answer.pushed_at, '2026-08-18T20:00:00.000Z');
  assert.equal(answer.pushed_by, 'conductor@home-pc');
  assert.deepEqual(answer.board, board);
});

test('readAgentBoard: an UNREADABLE row keeps its pushed_at — the two silences stay apart', () => {
  // ⚠️ THE POINT OF THIS TEST. "Nothing has ever been pushed" and "a push
  // landed and cannot be read" are different sentences with different fixes,
  // and collapsing them would make a corrupted blob render as a quiet night.
  const answer = readAgentBoard(
    { board: '{ truncated', pushed_at: '2026-08-18T20:00:00.000Z', pushed_by: null },
    NOW,
  );
  assert.equal(answer.exists, true);
  assert.equal(answer.board, null);
  assert.equal(answer.pushed_at, '2026-08-18T20:00:00.000Z');
});

test('AGENT_BOARD_ROW_ID: one row, and the schema is what enforces it', () => {
  // Paired with migrations/0012_agent_board.sql's `CHECK (id = 1)`. If this
  // constant ever moves, that CHECK makes every push fail loudly rather than
  // quietly starting a second, competing board.
  assert.equal(AGENT_BOARD_ROW_ID, 1);
});

// ---------------------------------------------------------------------------
// PER-SECTION FRESHNESS (2026-08-18, migration 0013)
//
// ⚠️ THE WRINKLE THESE CLOSE, recorded in the contract's §9 on the day the
// second pusher shipped: the board is ONE row written WHOLE by TWO pushers, so
// `pushed_at` only ever said when SOMEBODY last pushed. The processing pusher
// fires every 15 minutes, so /status/agents' freshness strip read "as of 2
// minutes ago" over agent rows the conductor had not touched for hours. A
// freshness display that says fresh when it is stale is worse than none — it is
// the silent-staleness trap with a timestamp on it.
//
// Every test below is about ONE property: the clock is the SERVER'S, and a
// section only gets a new one when it actually moved.
// ---------------------------------------------------------------------------

const T1 = '2026-08-18T09:00:00.000Z';
const T2 = '2026-08-18T21:00:00.000Z';

test('⚠️ THE BUG: a processing-only push does NOT restamp agents', () => {
  // The exact 15-minute cadence that produced the wrinkle. `agents` is
  // byte-identical and undeclared, so it keeps the stamp it earned this morning
  // while `processing` moves to now.
  const before = { agents: [{ id: 'a1', state: 'running' }], processing: { packs: { packed: 157 } } };
  const after = { agents: [{ id: 'a1', state: 'running' }], processing: { packs: { packed: 158 } } };
  const stamps = stampSections(before, after, { agents: T1, processing: T1 }, T2);
  assert.equal(stamps.agents, T1, 'agents must keep its own age, not inherit the pusher’s');
  assert.equal(stamps.processing, T2);
});

test('a section that CHANGED is restamped, with no header needed', () => {
  // This is what makes the fix work today without touching either pusher —
  // both already read-modify-write the shared draft and push it whole.
  const stamps = stampSections({ agents: [] }, { agents: [{ id: 'a1' }] }, { agents: T1 }, T2);
  assert.equal(stamps.agents, T2);
});

test('a DECLARED section is restamped even when its content is identical', () => {
  // "I am authoritative for this and I just wrote it" — the conductor saying
  // "still true, as of now". The optional X-Estate-Sections seam.
  const board = { agents: [{ id: 'a1' }], processing: { packs: {} } };
  const stamps = stampSections(board, board, { agents: T1, processing: T1 }, T2, ['agents']);
  assert.equal(stamps.agents, T2);
  assert.equal(stamps.processing, T1, 'declaring one section must not move the others');
});

test('⚠️ key ORDER is not a change — a reserialised section keeps its stamp', () => {
  // Without a stable comparison, a pusher that emitted the same data with keys
  // in another order would restamp a section that did not move: the same false
  // freshness in a new place.
  const before = { usage: { session_pct: 40, weekly_pct: 60, read_at: T1 } };
  const after = { usage: { read_at: T1, weekly_pct: 60, session_pct: 40 } };
  const stamps = stampSections(before, after, { usage: T1 }, T2);
  assert.equal(stamps.usage, T1);
});

test('a NEW section, and a first-ever push, stamp now', () => {
  assert.equal(stampSections(null, { agents: [] }, {}, T2).agents, T2);
  assert.equal(stampSections({ agents: [] }, { agents: [], usage: {} }, { agents: T1 }, T2).usage, T2);
});

test('a section with content but NO carried stamp is stamped now, never left blank', () => {
  // The migration boundary: a row written before 0013 has no stamps at all. The
  // first push after it must give every section a real one rather than leaving
  // holes the page would have to invent a value for.
  const stamps = stampSections({ agents: [{ id: 'a' }] }, { agents: [{ id: 'a' }] }, {}, T2);
  assert.equal(stamps.agents, T2);
});

test('a section that DISAPPEARS loses its stamp', () => {
  const stamps = stampSections({ agents: [], usage: {} }, { agents: [] }, { agents: T1, usage: T1 }, T2);
  assert.deepEqual(Object.keys(stamps), ['agents']);
});

test('⚠️ parseSectionStamps: an unreadable map is EMPTY, never invented', () => {
  // Returning `now` for a missing stamp would be the original bug wearing the
  // fix's clothes — a section nobody had written for hours reading as fresh.
  assert.deepEqual(parseSectionStamps(null), {});
  assert.deepEqual(parseSectionStamps(undefined), {});
  assert.deepEqual(parseSectionStamps('{ truncated'), {});
  assert.deepEqual(parseSectionStamps('[]'), {}, 'an array is not a stamp map');
  assert.deepEqual(parseSectionStamps('"a string"'), {});
  // A value that is not a readable instant is dropped: a stamp nobody can parse
  // is not better than no stamp, it is one that renders as an age.
  assert.deepEqual(parseSectionStamps('{"agents":"not a date","usage":123}'), {});
  assert.deepEqual(parseSectionStamps(`{"agents":"${T1}"}`), { agents: T1 });
});

test('readAgentBoard: a pre-0013 row answers with NO section stamps, not fabricated ones', () => {
  const answer = readAgentBoard(
    { board: '{"agents":[]}', pushed_at: T1, pushed_by: null },
    NOW,
  );
  assert.deepEqual(answer.section_pushed_at, {}, 'the page must fall back to pushed_at and say so');
});

test('readAgentBoard: section stamps round-trip when the column is populated', () => {
  const answer = readAgentBoard(
    { board: '{"agents":[]}', pushed_at: T2, pushed_by: null, section_pushed_at: `{"agents":"${T1}"}` },
    NOW,
  );
  assert.deepEqual(answer.section_pushed_at, { agents: T1 });
  // ⚠️ The whole point, in one assertion: the section is OLDER than the push.
  assert.ok(Date.parse(answer.section_pushed_at.agents!) < Date.parse(answer.pushed_at!));
});

test('parseDeclaredSections: tolerant of spacing, bounded, and empty when absent', () => {
  assert.deepEqual(parseDeclaredSections('agents, events,usage'), ['agents', 'events', 'usage']);
  assert.deepEqual(parseDeclaredSections(null), []);
  assert.deepEqual(parseDeclaredSections(''), []);
  assert.deepEqual(parseDeclaredSections('  ,  '), []);
  assert.equal(parseDeclaredSections(Array.from({ length: 100 }, (_, i) => `s${i}`).join(',')).length, 32);
  assert.deepEqual(parseDeclaredSections(`${'x'.repeat(65)},ok`), ['ok'], 'an absurd name is dropped, not stored');
});

test('the stamps and the board move TOGETHER — a section is never aged by another’s clock', () => {
  // A three-push sequence over one row, which is what actually happens in a
  // day: conductor, then processing twice. `agents` must age.
  let board: Record<string, unknown> = { agents: [{ id: 'a1' }], usage: { session_pct: 10 } };
  let stamps = stampSections(null, board, {}, T1);
  assert.equal(stamps.agents, T1);

  const next = { ...board, processing: { packs: { packed: 1 } } };
  stamps = stampSections(board, next, stamps, '2026-08-18T12:00:00.000Z');
  board = next;
  assert.equal(stamps.agents, T1, 'still this morning');

  const later = { ...board, processing: { packs: { packed: 2 } } };
  stamps = stampSections(board, later, stamps, T2);
  assert.equal(stamps.agents, T1, 'STILL this morning, twelve hours on');
  assert.equal(stamps.processing, T2);
});
