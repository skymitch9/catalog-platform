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
  readAgentBoard,
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
