/**
 * status/lib/board.js — reading the conductor's pushed state blob, and saying
 * how old it is.
 *
 * ONE endpoint (`GET /api/estate/ops/agent-board`, requireDevops()) feeds TWO
 * pages: /status/agents renders `agents`, `events` and `usage`;
 * /status/processing renders `processing`. They share this module so the
 * FRESHNESS SENTENCE is written once — a page that gets that wrong is worse
 * than a page that does not exist, because it makes a stale picture look live.
 *
 * ⚠️ THE FRESHNESS RULES, and every one of them is deliberate:
 *
 *   1. **The age is measured against the WORKER'S `pushed_at`**, not against
 *      any timestamp inside the blob. A pusher's own clock can be wrong, stale
 *      or missing; `pushed_at` is stamped when the write actually landed.
 *   2. **A failed poll says so and BLANKS nothing.** It flips the strip to
 *      danger and states that what is on screen is from the last successful
 *      read — never leaving a good reading on screen looking current, and
 *      never wiping the page clean either, which would read as "everything
 *      stopped" when the truth is "we could not ask".
 *   3. **"Nothing pushed yet" is a STATE, not an error.** The home-machine
 *      side of `processing` does not exist yet; a page that shouted about it
 *      would be crying wolf about a thing nobody has built.
 *   4. **Thresholds are round numbers chosen for a 30-second poll**, and they
 *      are labelled as judgement, not measurement: the conductor pushes when
 *      something changes, so a quiet hour is genuinely quiet. Amber at 15
 *      minutes says "worth a glance"; red at an hour says "this board is not
 *      being maintained right now" — neither says "broken".
 */

import { AUTH_ORIGIN, formatAge } from './core.js';

/** How often each page re-asks. Owner's ask: 30 s. */
export const BOARD_POLL_MS = 30_000;

/** GUESSES, marked as such — see rule 4 in the header. */
export const BOARD_AMBER_MS = 15 * 60_000;
export const BOARD_RED_MS = 60 * 60_000;

/**
 * The shape every renderer on the two pushed-data pages reads. It is
 * deliberately a small, closed vocabulary so a page can never invent a fifth
 * kind of "we don't know".
 *
 *   status: 'ok' | 'never' | 'unreadable' | 'failed' | 'denied' | 'unset'
 *   board:  the pushed object, or null
 *   pushedAt / pushedBy: from the Worker
 *   detail: a full sentence for the freshness strip
 */
export async function fetchBoard(token) {
  if (!token) {
    return { status: 'failed', board: null, pushedAt: null, pushedBy: null, detail: 'Sign-in lapsed — sign in again to read the board.' };
  }
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/agent-board`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { status: 'failed', board: null, pushedAt: null, pushedBy: null, detail: 'The auth Worker did not answer (network).' };
  }

  let body = null;
  try { body = await res.json(); } catch { /* the status still speaks */ }

  if (res.status === 401 || res.status === 403) {
    // ⚠️ A PERMISSION refusal and an OUTAGE get different words. Mislabelling
    // an outage as a permission problem sends someone asking for access they
    // already hold — the estate's standing rule, and the row most easily got
    // wrong.
    return {
      status: 'denied',
      board: null,
      pushedAt: null,
      pushedBy: null,
      detail:
        body?.detail ||
        'This account is not allowed to read the agent board. An admin can grant devops from /admin.',
    };
  }
  if (res.status === 503) {
    return {
      status: 'unset',
      board: null,
      pushedAt: null,
      pushedBy: null,
      detail: `${body?.detail || 'The agent board is not configured yet.'}${body?.fix ? ` Fix: ${body.fix}` : ''}`,
    };
  }
  if (!res.ok) {
    return {
      status: 'failed',
      board: null,
      pushedAt: null,
      pushedBy: null,
      detail: body?.detail || `The agent board endpoint answered HTTP ${res.status}.`,
    };
  }
  if (!body || body.exists !== true) {
    return {
      status: 'never',
      board: null,
      pushedAt: null,
      pushedBy: null,
      detail: 'Nothing has been pushed to the agent board yet.',
    };
  }
  if (body.board === null || typeof body.board !== 'object') {
    // The Worker keeps `pushed_at` on an unreadable row precisely so this
    // sentence can exist — see agent-board.ts's readAgentBoard().
    return {
      status: 'unreadable',
      board: null,
      pushedAt: body.pushed_at ?? null,
      pushedBy: body.pushed_by ?? null,
      detail: 'A push landed but its contents could not be read. Push the board again.',
    };
  }
  return {
    status: 'ok',
    board: body.board,
    pushedAt: body.pushed_at ?? null,
    pushedBy: body.pushed_by ?? null,
    detail: '',
  };
}

/**
 * Paint the freshness strip. PURE-ish: it only writes into the two elements it
 * is handed, so both pages get an identical sentence for an identical state.
 *
 * ⚠️ `lastGood` is passed in by the caller and is what makes rule 2 work: on a
 * failed poll the strip says how old the reading ON SCREEN is, instead of
 * pretending there is no reading or pretending it is current.
 */
export function renderFreshness(strip, result, lastGoodPushedAt, nowMs = Date.now()) {
  if (!strip) return;
  const ageEl = strip.querySelector('.fresh-age');
  const noteEl = strip.querySelector('.fresh-note');
  if (!ageEl || !noteEl) return;

  if (result.status === 'ok') {
    const ms = result.pushedAt ? nowMs - Date.parse(result.pushedAt) : NaN;
    const tone = !Number.isFinite(ms) ? 'warn' : ms > BOARD_RED_MS ? 'danger' : ms > BOARD_AMBER_MS ? 'warn' : 'ok';
    strip.dataset.tone = tone;
    ageEl.textContent = Number.isFinite(ms) ? `as of ${formatAge(ms)}` : 'as of an unknown time';
    noteEl.textContent =
      (result.pushedBy ? `pushed by ${result.pushedBy}. ` : '') +
      (tone === 'ok'
        ? 'Pushed from the conductor session — this page only ever shows what was last published.'
        : 'The conductor has not pushed recently. This is the last board it published, not a live reading.');
    return;
  }

  if (result.status === 'never') {
    strip.dataset.tone = 'none';
    ageEl.textContent = 'never pushed';
    noteEl.textContent = result.detail;
    return;
  }

  // failed / denied / unset / unreadable — the reading could not be taken.
  strip.dataset.tone = 'danger';
  const staleMs = lastGoodPushedAt ? nowMs - Date.parse(lastGoodPushedAt) : NaN;
  ageEl.textContent = 'reading FAILED';
  noteEl.textContent =
    `${result.detail} ` +
    (Number.isFinite(staleMs)
      ? `What is below is the board pushed ${formatAge(staleMs)} and is NOT current.`
      : 'Nothing below has been read successfully.');
}

/** `board.section` when it is an array, else []. Never throws on a board shape
 *  nobody has invented yet — the contract is a doc, not a schema. */
export function arraySection(board, key) {
  const v = board && board[key];
  return Array.isArray(v) ? v : [];
}

/** `board.section` when it is a plain object, else null. */
export function objectSection(board, key) {
  const v = board && board[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

/** A string field, trimmed, or ''. Everything rendered from the blob goes
 *  through here or through textContent — never innerHTML. */
export function str(v) {
  return typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v);
}

/** An ISO instant → "3m ago", or '' when it is not a readable instant. Used
 *  for every per-item timestamp so one bad field cannot blank a whole list. */
export function ageOf(iso, nowMs = Date.now()) {
  const t = Date.parse(str(iso));
  return Number.isFinite(t) ? formatAge(nowMs - t) : '';
}
