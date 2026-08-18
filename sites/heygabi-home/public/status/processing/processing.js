/**
 * processing.js — /status/processing, GABI'S KNOWLEDGE BASE AS IT GROWS.
 *
 * Renders the `processing` SECTION of the same pushed blob /status/agents
 * reads: `GET /api/estate/ops/agent-board` (requireDevops()), pushed with
 * `scripts/push-agent-board.mjs`. The contract is
 * docs/info/agent-board-contract.md — a DOC, not a schema, and this file's
 * tolerance is the other half of that decision.
 *
 * ⚠️ THE PUSHER FOR THIS SECTION DOES NOT EXIST YET (2026-08-18). The
 * transcription/packing pipeline on the home machine will grow a push step;
 * until it does, every list here renders its own worded "nothing pushed yet"
 * rather than an empty box. That is the whole reason this file is written
 * defensively: it must be correct BEFORE its data source ships, and it must
 * not need editing when that source starts sending fields it has never seen.
 *
 * ⚠️ RENDER WHAT IS THERE, NAME WHAT IS NOT. Four different silences —
 * nothing ever pushed / pushed but this section is empty / the poll failed /
 * the pipeline has genuinely nothing in flight — look identical on screen and
 * have four different fixes, so each gets its own sentence. A helper that
 * guessed between them would flatten exactly the distinction the page exists
 * to show.
 *
 * ⚠️ "JOINED GABI'S KNOWLEDGE BASE" IS A SERVABILITY DATE, NOT A TRANSCRIPTION
 * DATE, and this page never derives one from the other. A book can be
 * transcribed and packed and still not be answerable; the owner's standing
 * requirement is that the estate says so honestly rather than implying
 * coverage it does not have. If the push carries no `joined_at`, the row says
 * the date is missing — it does not fall back to a timestamp that means
 * something else.
 *
 * ⚠️ EVERY NODE IS BUILT WITH textContent. Book titles and step lines are free
 * text from another machine; /docs already carries a `mustNotContain:
 * ".innerHTML ="` pin for exactly this reason and this page earns the same one.
 */

import { TICK_INTERVAL_MS, el, sayEmpty } from '../lib/core.js';
import { mountGate } from '../lib/gate.js';
import {
  BOARD_POLL_MS,
  ageOf,
  arraySection,
  fetchBoard,
  objectSection,
  renderFreshness,
  str,
} from '../lib/board.js';
import { idToken } from '../../assets/estate-auth.js';

const freshEl = document.getElementById('board-fresh');
const inflightEl = document.getElementById('proc-inflight');
const queueEl = document.getElementById('proc-queue');
const packsEl = document.getElementById('proc-packs');
const historyEl = document.getElementById('proc-history');

/** The last SUCCESSFUL read, kept whole — a failed poll can then say how old
 *  the picture on screen is instead of pretending there is none, and the
 *  5-second ticker re-words the age without re-fetching. */
let lastGood = null;

/**
 * The lanes the estate actually runs, in the order the ingestion design names
 * them. An unrecognised lane renders its own key verbatim rather than being
 * dropped or relabelled "other": a lane this page has not heard of is the
 * pipeline telling us something new, and losing it would hide the arrival of a
 * whole processing route.
 */
const LANE_LABELS = {
  'audiobook-with-review': 'Audiobook (with review)',
  audiobook: 'Audiobook',
  epub: 'EPUB',
  'text-pdf': 'Text PDF',
  'deferred-pdf': 'Deferred PDF (needs OCR)',
  'needs-ocr': 'Needs OCR',
};

function laneLabel(key) {
  const k = str(key);
  return LANE_LABELS[k] || k || 'unlabelled lane';
}

/**
 * A percentage, or null when the push did not carry a readable one.
 *
 * ⚠️ NULL IS NOT ZERO. A missing percentage rendered as 0% would say "this
 * book has not started", which is a claim about the pipeline that a missing
 * field does not support — the same mistake as rendering a missing usage
 * figure as plenty of budget.
 */
function percentOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** A count, or null. Same reasoning as percentOf: an absent count is unknown,
 *  and "0 waiting" is a much stronger statement than "we were not told". */
function countOf(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Being processed now
// ---------------------------------------------------------------------------

function renderInFlight(list, nowMs) {
  if (!inflightEl) return;
  if (!list.length) {
    // ⚠️ "Nothing in flight" is a GOOD state — the machine is idle, not broken.
    // The freshness strip above is what separates it from "we could not ask".
    sayEmpty(inflightEl, 'No books are being processed right now, according to the last push.');
    return;
  }
  inflightEl.replaceChildren();
  for (const raw of list) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const li = el('li', 'proc-row');

    const head = el('div', 'proc-head');
    head.append(el('span', 'proc-title', str(b.title) || str(b.id) || 'untitled book'));
    if (str(b.author)) head.append(el('span', 'proc-by', str(b.author)));
    if (str(b.lane)) head.append(el('span', 'proc-lane', laneLabel(b.lane)));
    li.append(head);

    const pct = percentOf(b.percent ?? b.progress);
    if (pct !== null) {
      const bar = el('div', 'proc-bar');
      const fill = el('span', 'proc-fill');
      fill.style.width = `${pct}%`;
      bar.append(fill);
      li.append(bar);
    }

    // The meta line is assembled from whatever the push carried, and every
    // piece of it is a fact the pipeline stated — never a rate, an ETA or a
    // verdict computed here. A browser cannot know what a slow chapter means.
    const bits = [];
    if (pct !== null) bits.push(`${pct}%`);
    if (str(b.step)) bits.push(str(b.step));
    const started = ageOf(b.started_at, nowMs);
    if (started) bits.push(`started ${started}`);
    const updated = ageOf(b.updated_at, nowMs);
    if (updated) bits.push(`updated ${updated}`);
    if (str(b.eta)) bits.push(`pipeline's ETA: ${str(b.eta)}`);
    li.append(
      el(
        'p',
        'proc-meta',
        bits.length
          ? bits.join(' · ')
          : 'The push named this book but carried no progress detail.',
      ),
    );

    inflightEl.append(li);
  }
}

// ---------------------------------------------------------------------------
// Queue depth by lane
// ---------------------------------------------------------------------------

/**
 * Accepts BOTH shapes a pusher might reasonably send — an array of
 * `{lane, count}` rows, or a plain `{lane: count}` map — because the contract
 * is a doc and the pipeline that will fill it is not written yet. Normalising
 * here costs six lines; discovering the mismatch on the day the pipeline ships
 * costs an evening, and the page would look empty rather than wrong.
 */
function normaliseQueue(section) {
  const rows = arraySection(section, 'queue');
  if (rows.length) {
    return rows.map((r) => {
      const o = r && typeof r === 'object' ? r : {};
      return { lane: str(o.lane) || str(o.name), count: countOf(o.count ?? o.depth), note: str(o.note) };
    });
  }
  const map = objectSection(section, 'queue');
  if (!map) return [];
  return Object.keys(map).map((lane) => ({ lane, count: countOf(map[lane]), note: '' }));
}

function renderQueue(rows) {
  if (!queueEl) return;
  queueEl.replaceChildren();
  if (!rows.length) {
    queueEl.append(el('p', 'empty-say', 'The last push carried no queue depths, so how much is waiting is unknown from here — not zero.'));
    return;
  }
  const grid = el('div', 'queue-grid');
  for (const row of rows) {
    const tile = el('div', 'queue-tile');
    tile.append(el('div', 'queue-count', row.count === null ? '—' : row.count.toLocaleString()));
    tile.append(el('div', 'queue-lane', laneLabel(row.lane)));
    if (row.note) tile.append(el('p', 'proc-meta', row.note));
    else if (row.count === null) tile.append(el('p', 'proc-meta', 'no count in the push'));
    grid.append(tile);
  }
  queueEl.append(grid);
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

/**
 * The pack tiles. `ingester_version` is rendered as its own tile rather than
 * as a footnote because it is the field that answers "why does this book
 * answer differently from that one" — the packs are not interchangeable across
 * versions, and a version drift is a real, actionable fact.
 */
const PACK_TILES = [
  { key: 'packed', label: 'Books packed' },
  { key: 'books', label: 'Books indexed' },
  { key: 'needs_ocr', label: 'Needs OCR' },
  { key: 'chunks', label: 'Chunks' },
];

function renderPacks(packs, nowMs) {
  if (!packsEl) return;
  packsEl.replaceChildren();
  if (!packs) {
    packsEl.append(el('p', 'empty-say', 'The last push carried no pack counts — how much of the library is servable is unknown from here.'));
    return;
  }

  const grid = el('div', 'queue-grid');
  let anyCount = false;
  for (const tile of PACK_TILES) {
    const n = countOf(packs[tile.key]);
    if (n === null) continue;
    anyCount = true;
    const t = el('div', 'queue-tile');
    t.append(el('div', 'queue-count', n.toLocaleString()));
    t.append(el('div', 'queue-lane', tile.label));
    grid.append(t);
  }
  if (str(packs.ingester_version)) {
    const t = el('div', 'queue-tile');
    t.append(el('div', 'queue-count', str(packs.ingester_version)));
    t.append(el('div', 'queue-lane', 'Ingester version'));
    grid.append(t);
    anyCount = true;
  }
  if (anyCount) packsEl.append(grid);
  else packsEl.append(el('p', 'empty-say', 'The push carried a packs section with no counts in it.'));

  // ⚠️ THE PACKS SECTION HAS ITS OWN CLOCK. It is a snapshot of a manifest that
  // may have been read hours before the board was pushed; showing it under the
  // board's push age alone would silently promote a stale count to a fresh one.
  const asOf = ageOf(packs.as_of, nowMs);
  packsEl.append(
    el(
      'p',
      'section-note',
      asOf
        ? `Manifest read ${asOf}${str(packs.note) ? ` · ${str(packs.note)}` : ''}`
        : '⚠️ These counts carry no read-at timestamp, so their age is unknown — treat them as older than the board above, not fresher.',
    ),
  );
}

// ---------------------------------------------------------------------------
// The history — "joined GABI's knowledge base <date>"
// ---------------------------------------------------------------------------

/**
 * ⚠️ SORTED NEWEST-FIRST HERE, not trusted from the push — the same decision
 * the agents feed makes, for the same reason: a pusher that appends hands this
 * the opposite order, and a history rendered oldest-first looks like nothing
 * has been ingested in months. Rows with no readable date sink to the bottom
 * rather than being dropped; a book that joined is worth showing even when its
 * clock is missing, and the row says the date is missing out loud.
 */
function sortNewestFirst(rows) {
  return [...rows].sort((x, y) => {
    const a = Date.parse(str(x && (x.joined_at || x.at)));
    const b = Date.parse(str(y && (y.joined_at || y.at)));
    if (!Number.isFinite(a) && !Number.isFinite(b)) return 0;
    if (!Number.isFinite(a)) return 1;
    if (!Number.isFinite(b)) return -1;
    return b - a;
  });
}

function renderHistory(list, nowMs) {
  if (!historyEl) return;
  if (!list.length) {
    sayEmpty(historyEl, 'The last push carried no processed-book history.');
    return;
  }
  historyEl.replaceChildren();
  for (const raw of sortNewestFirst(list)) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const li = el('li', 'proc-row');

    const head = el('div', 'proc-head');
    head.append(el('span', 'proc-title', str(b.title) || str(b.id) || 'untitled book'));
    if (str(b.author)) head.append(el('span', 'proc-by', str(b.author)));
    if (str(b.lane)) head.append(el('span', 'proc-lane', laneLabel(b.lane)));
    li.append(head);

    // The owner's own phrase, and it is the point of the row. A readable date
    // is shown as a DATE plus its age — "joined 3d ago" alone makes a reader do
    // arithmetic to answer "was that before or after the bug".
    const joinedIso = str(b.joined_at || b.at);
    const joinedMs = Date.parse(joinedIso);
    const joined = el('p', 'proc-meta');
    if (Number.isFinite(joinedMs)) {
      joined.append(el('span', 'proc-joined', `Joined GABI's knowledge base ${new Date(joinedMs).toLocaleDateString()}`));
      joined.append(document.createTextNode(` · ${ageOf(joinedIso, nowMs)}`));
    } else {
      // ⚠️ NOT "joined today" and not blank. An unknown date is its own fact,
      // and this is the one label on the page the owner asked for by name.
      joined.textContent = 'In the knowledge base — the push carried no join date.';
    }
    li.append(joined);

    const bits = [];
    if (str(b.ingester_version)) bits.push(`ingester ${str(b.ingester_version)}`);
    if (countOf(b.chunks) !== null) bits.push(`${countOf(b.chunks).toLocaleString()} chunks`);
    if (str(b.note)) bits.push(str(b.note));
    if (bits.length) li.append(el('p', 'proc-meta', bits.join(' · ')));

    historyEl.append(li);
  }
}

// ---------------------------------------------------------------------------
// The poll
// ---------------------------------------------------------------------------

let polling = false;

/** Every list's "nothing has ever been pushed" wording, in one place — the
 *  state that is NOT an error and must not look like one. */
function sayNeverPushed() {
  sayEmpty(inflightEl, 'Nothing has been pushed to the board yet, so there is nothing to show — not "nothing is processing".');
  sayEmpty(historyEl, 'No history yet — the home machine has not pushed a processing section.');
  renderQueue([]);
  renderPacks(null, Date.now());
}

async function refreshBoard() {
  if (polling) return;
  polling = true;
  try {
    const now = Date.now();
    const result = await fetchBoard(await idToken());
    renderFreshness(freshEl, result, lastGood?.pushedAt ?? null, now);

    if (result.status !== 'ok') {
      // ⚠️ THE LISTS ARE LEFT EXACTLY AS THEY WERE on a failed poll. Blanking
      // them would read as "processing stopped"; the strip above has already
      // said in words that what is on screen is not current. Only the
      // never-pushed case gets written lists — there is nothing behind it to
      // preserve.
      if (result.status === 'never') sayNeverPushed();
      return;
    }

    lastGood = result;
    const section = objectSection(result.board, 'processing');
    if (!section) {
      // ⚠️ A BOARD WITHOUT A `processing` SECTION IS THE EXPECTED STATE TODAY,
      // and it is NOT the same as an empty pipeline. The conductor pushes
      // agents/events/usage; the home machine's processing push is unbuilt, so
      // this sentence names the missing PUSHER rather than implying the
      // pipeline is idle.
      sayEmpty(inflightEl, 'The last board carried no processing section — the home-machine pipeline is not pushing one yet. This says nothing about whether books are being processed.');
      sayEmpty(historyEl, 'No processing section in the last board, so no history to show.');
      renderQueue([]);
      renderPacks(null, now);
      return;
    }

    renderInFlight(arraySection(section, 'in_flight'), now);
    renderQueue(normaliseQueue(section));
    renderPacks(objectSection(section, 'packs'), now);
    renderHistory(arraySection(section, 'history'), now);
  } finally {
    polling = false;
  }
}

const processingSectionEl = document.getElementById('processing-section');

const gate = mountGate({
  sections: [processingSectionEl],
  onAllowed: () => { refreshBoard(); },
});

// Same 30-second poll as /status/agents, visible tabs only — a backgrounded tab
// learns nothing by asking, and returning to the tab re-reads immediately
// rather than waiting up to 30 seconds.
setInterval(() => {
  if (!document.hidden && gate.isAllowed()) refreshBoard();
}, BOARD_POLL_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gate.isAllowed()) refreshBoard();
});

// The freshness strip re-words itself between polls: "as of 29 seconds ago"
// must not still say so two minutes later because a fetch happened not to land.
setInterval(() => {
  if (lastGood && freshEl) renderFreshness(freshEl, lastGood, lastGood.pushedAt);
}, TICK_INTERVAL_MS);
