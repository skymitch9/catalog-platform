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
 *   3. **"Nothing pushed yet" is a STATE, not an error** — on a board that has
 *      genuinely never been written. ⚠️ It stopped meaning "nobody has built
 *      the other end" on 2026-08-18, when the processing pusher shipped: an
 *      absent section now means a pusher that is failing, and the pages say so
 *      rather than reassuring a reader about an unbuilt thing that exists.
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
    // ⚠️ Per-SECTION stamps (Worker migration 0013). An empty object means the
    // stored row predates them, and renderFreshness() then falls back to the
    // board-wide age AND SAYS SO — it must never read a missing stamp as new.
    sectionPushedAt:
      body.section_pushed_at && typeof body.section_pushed_at === 'object' && !Array.isArray(body.section_pushed_at)
        ? body.section_pushed_at
        : {},
    detail: '',
  };
}

/**
 * The stamp a PAGE should measure itself against, given the sections it owns.
 *
 * ⚠️ THE WRINKLE THIS EXISTS FOR (contract §9): one row, two pushers, each
 * writing the board whole — so `pushed_at` only ever said when SOMEBODY last
 * pushed. The processing pusher fires every 15 minutes, and /status/agents
 * therefore read "as of 2 minutes ago" over agent rows the conductor had not
 * touched since breakfast. A freshness strip that says fresh when it is stale
 * is worse than no strip at all.
 *
 * ⚠️ THE OLDEST SECTION WINS, not the newest and not an average. The strip is
 * one sentence about a page that may show three sections; the honest single
 * number is the worst of them, and the sentence names which one it came from so
 * the reader is not left guessing. Per-item clocks inside each block
 * (`agents[].started_at`, `usage.read_at`, `packs.as_of`) carry the detail.
 *
 * Returns `{ iso, key, fellBack, missing }` — `fellBack` true means no
 * per-section stamp was available and the board-wide one is standing in, which
 * the caller must SAY rather than quietly present as the section's own age.
 */
export function sectionFreshness(result, sections) {
  const stamps = (result && result.sectionPushedAt) || {};
  const keys = Array.isArray(sections) ? sections : [];
  const present = keys
    .filter((k) => typeof stamps[k] === 'string' && Number.isFinite(Date.parse(stamps[k])))
    .map((k) => ({ key: k, ms: Date.parse(stamps[k]) }));

  if (!keys.length || !present.length) {
    return { iso: result?.pushedAt ?? null, key: null, fellBack: true, missing: keys };
  }
  present.sort((a, b) => a.ms - b.ms);
  const oldest = present[0];
  return {
    iso: stamps[oldest.key],
    key: oldest.key,
    fellBack: false,
    missing: keys.filter((k) => !present.some((p) => p.key === k)),
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
export function renderFreshness(strip, result, lastGoodPushedAt, nowMs = Date.now(), sections = null) {
  if (!strip) return;
  const ageEl = strip.querySelector('.fresh-age');
  const noteEl = strip.querySelector('.fresh-note');
  if (!ageEl || !noteEl) return;

  if (result.status === 'ok') {
    // ⚠️ THE AGE IS THIS PAGE'S SECTIONS, NOT THE BOARD'S. Two pushers share one
    // row and each writes it whole, so the board-wide `pushed_at` says only that
    // SOMEBODY pushed. See sectionFreshness() for the whole story.
    const fresh = sections ? sectionFreshness(result, sections) : { iso: result.pushedAt, key: null, fellBack: true, missing: [] };
    const ms = fresh.iso ? nowMs - Date.parse(fresh.iso) : NaN;
    const tone = !Number.isFinite(ms) ? 'warn' : ms > BOARD_RED_MS ? 'danger' : ms > BOARD_AMBER_MS ? 'warn' : 'ok';
    strip.dataset.tone = tone;
    ageEl.textContent = Number.isFinite(ms) ? `as of ${formatAge(ms)}` : 'as of an unknown time';

    const bits = [];
    if (result.pushedBy) bits.push(`Last written to by ${result.pushedBy}.`);
    if (sections && !fresh.fellBack) {
      // Name the section the age belongs to, and say when it is NOT the whole
      // board — otherwise "as of 4h ago" beside a board pushed 2 minutes ago
      // looks like a bug rather than the point.
      bits.push(
        `This age is the “${fresh.key}” section's own — the oldest of ${sections.join(', ')} on this page — ` +
        'not the age of the last push to the shared board.',
      );
      if (fresh.missing.length) {
        bits.push(`No separate timestamp arrived for ${fresh.missing.join(', ')}; ${fresh.missing.length === 1 ? 'that section is' : 'those sections are'} not covered by the age above.`);
      }
    } else if (sections) {
      // ⚠️ Pre-0013 rows, or a Worker that has not been deployed yet. Falling
      // back is fine; letting the reader believe it is a per-section age is not.
      bits.push(
        'This board carries no per-section timestamps, so the age above is the age of the WHOLE board — ' +
        'any one section on this page may be considerably older than it. Deploy auth-worker and push again to separate them.',
      );
    }
    bits.push(
      tone === 'ok'
        ? 'This page only ever shows what was last published to it.'
        : 'Nothing has refreshed this recently. What is below is the last thing published, not a live reading.',
    );
    noteEl.textContent = bits.join(' ');
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
