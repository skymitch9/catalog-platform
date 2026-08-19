/**
 * processing.js — /status/processing, GABI'S KNOWLEDGE BASE AS IT GROWS.
 *
 * Renders the `processing` SECTION of the same pushed blob /status/agents
 * reads: `GET /api/estate/ops/agent-board` (requireDevops()), pushed with
 * `scripts/push-agent-board.mjs`. The contract is
 * docs/info/agent-board-contract.md — a DOC, not a schema, and this file's
 * tolerance is the other half of that decision.
 *
 * ⚠️ THE PUSHER EXISTS — `scripts/push-processing-board.mjs`, shipped later on
 * 2026-08-18, running every 15 minutes from the scheduled task
 * `EstateProcessingBoardPush` plus once off the back of every ingestion run.
 * This comment used to say it did not, and the empty-state sentences below were
 * written for a page waiting on an unbuilt source.
 *
 * ⚠️ THAT INVERTS WHAT AN EMPTY SECTION MEANS, which is why the wording was
 * corrected with it: "the home machine is not pushing one yet" describes
 * something nobody has built and needs no action, while the truth today is a
 * pusher that IS built and is NOT PUSHING — which is a broken job, and the log
 * to read is `audiobook_catalog/output_files/processing_push.log`. A stale
 * reassurance is worse than a stale fact: it tells a reader to expect nothing.
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

/**
 * The board sections THIS page renders — the freshness strip is measured
 * against these and nothing else.
 *
 * ⚠️ WITHOUT THIS THE STRIP LIED, and the contract's §9 said so in writing
 * before it was fixed: one D1 row, two pushers, each writing the board whole,
 * so the board-wide `pushed_at` moved every 15 minutes when the processing
 * pusher ran — and this page reported "as of 2 minutes ago" over agent rows the
 * conductor had not touched for hours. The Worker now stamps each section from
 * its own clock (migration 0013) and the strip reads the OLDEST of these.
 */
const PAGE_SECTIONS = ['processing'];

const freshEl = document.getElementById('board-fresh');
const inflightEl = document.getElementById('proc-inflight');
const queueEl = document.getElementById('proc-queue');
const packsEl = document.getElementById('proc-packs');
const historyEl = document.getElementById('proc-history');
const completeEl = document.getElementById('proc-complete');
const historyMoreEl = document.getElementById('proc-history-more');

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
// FINISHED WORK — the headline count
//
// ⚠️ OWNER ASK, 2026-08-18: "also add a completed list not just a queue so we
// know how many things have been finished." The finished list already existed
// — at the BOTTOM of this page, under the queue and the packs — and the ask is
// the evidence that being present is not the same as being FINDABLE. So the
// total moves above the queue, where the first glance lands.
//
// ⚠️ AND IT IS NEVER A ZERO IT WAS NOT TOLD. "No books have joined" and "the
// push carried no history" are different sentences with different fixes; the
// second one is a broken pusher, and rendering it as 0 would report an empty
// knowledge base to a man whose knowledge base has 158 books in it.
// ---------------------------------------------------------------------------

function renderCompleted(section, historyRows, nowMs) {
  if (!completeEl) return;
  completeEl.replaceChildren();

  const packs = objectSection(section, 'packs');
  const packed = packs ? countOf(packs.packed) : null;
  const known = historyRows.length || packed !== null;

  if (!known) {
    completeEl.append(
      el('p', 'empty-say',
        'How many books have finished is unknown from here — the last push carried no history and no pack ' +
        'counts. That is a silent pusher, not an empty knowledge base.'),
    );
    return;
  }

  // The history IS the completed list, so its length is the count. `packs.packed`
  // is the manifest's own tally of the same thing and is shown beside it when
  // the two are both present — if they ever disagree, the page shows both rather
  // than picking a winner, because the disagreement is the interesting fact.
  const headline = el('div', 'complete-headline');
  const n = historyRows.length || packed;
  headline.append(el('span', 'complete-count', n.toLocaleString()));
  headline.append(el('span', 'complete-label', `book${n === 1 ? '' : 's'} in GABI's knowledge base`));
  completeEl.append(headline);

  const bits = [];
  if (historyRows.length && packed !== null && packed !== historyRows.length) {
    bits.push(
      `The pushed history lists ${historyRows.length.toLocaleString()} while the pack manifest counts ` +
      `${packed.toLocaleString()} — both are shown because a disagreement between them is worth seeing, ` +
      'not worth hiding behind whichever number is larger.',
    );
  }
  const newest = historyRows.length ? ageOf(historyRows[0].joined_at || historyRows[0].at, nowMs) : '';
  if (newest) bits.push(`Most recent joined ${newest}.`);
  bits.push('Full list below, newest first.');
  completeEl.append(el('p', 'section-note', bits.join(' ')));
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

/** How many finished books to show before the "show all" control. A 158-row
 *  dump buries the queue and the in-flight book above it; the owner asked for
 *  the list to be VISIBLE, which is not the same as unavoidable. */
const HISTORY_PREVIEW = 12;
let historyExpanded = false;

function renderHistory(list, nowMs) {
  if (!historyEl) return;
  if (historyMoreEl) historyMoreEl.replaceChildren();
  if (!list.length) {
    sayEmpty(historyEl, 'The last push carried no processed-book history.');
    return;
  }
  const ordered = sortNewestFirst(list);
  const shown = historyExpanded ? ordered : ordered.slice(0, HISTORY_PREVIEW);
  if (historyMoreEl && ordered.length > HISTORY_PREVIEW) {
    const btn = el('button', 'linkbtn');
    btn.type = 'button';
    btn.textContent = historyExpanded
      ? `Show only the ${HISTORY_PREVIEW} most recent`
      : `Show all ${ordered.length.toLocaleString()} finished books`;
    btn.addEventListener('click', () => {
      historyExpanded = !historyExpanded;
      renderHistory(list, Date.now());
    });
    historyMoreEl.append(btn);
    if (!historyExpanded) {
      historyMoreEl.append(
        el('p', 'section-note',
          `Showing the ${HISTORY_PREVIEW} most recent of ${ordered.length.toLocaleString()}.`),
      );
    }
  }
  historyEl.replaceChildren();
  for (const raw of shown) {
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
// THE TWO PER-BOOK CONTROLS (owner-approved 2026-08-18): re-queue a failed
// book, and move one to the front of the queue.
//
// ⚠️ NEITHER BUTTON DOES THE THING ITS NAME SUGGESTS, AND EVERY SENTENCE HERE
// HAS TO SAY SO. They write a book id into `ingestion_control/state`, via the
// same devops-gated ops door the pause card on /status/pipelines uses. The home
// machine reads that document at the top of its next run — it checks every 30
// minutes — applies the list, and clears the ids it acted on. So the honest
// report after a successful write is "queued for retry", never "retried".
// Claiming an outcome this page cannot observe is precisely the failure the
// /status split exists to end, and the easiest one to reintroduce.
//
// ⚠️ THE PAGE CANNOT TELL "already done" FROM "nobody asked". An empty
// `requeue` list means either the processor consumed it or it was never
// written, and nothing in the document distinguishes the two. So the wording
// below never says "your retry completed" — it says what the list holds.
//
// ⚠️ THE OUTCOME IS NOT VISIBLE HERE UNTIL THE NEXT PUSH. This page renders a
// board pushed from the home machine every 15 minutes, so a book re-queued now
// keeps showing as failed for up to a quarter of an hour. Saying that out loud
// is what stops somebody pressing the button four more times.
// ---------------------------------------------------------------------------

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const failedEl = document.getElementById('proc-failed');
const failedMsgEl = document.getElementById('proc-failed-msg');

function setFailedMsg(text, tone) {
  if (!failedMsgEl) return;
  failedMsgEl.textContent = text || '';
  failedMsgEl.dataset.tone = tone || '';
}

/**
 * Write one book id into the control document. `action` is 'requeue' or
 * 'priority_front'.
 *
 * ⚠️ EVERY REFUSAL IS WORDED AND THE FOUR CAUSES ARE KEPT APART — not signed
 * in / not devops / not configured / the server broke each have a different
 * fix, and a person must never meet a bare status. Same shape as the pipelines
 * page's sendIngestionControl(), deliberately: two pages writing one document
 * should refuse in the same voice.
 */
async function sendBookControl(action, bookId, title, verb) {
  const token = await idToken();
  if (!token) {
    setFailedMsg('Sign-in lapsed — sign in again, then try that button.', 'warn');
    return;
  }
  setFailedMsg(`${verb} “${title}”…`);
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/ingestion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, book_ids: [bookId] }),
    });
  } catch {
    setFailedMsg('The auth Worker did not answer (network). Nothing was written — try again shortly.', 'warn');
    return;
  }
  let body = null;
  try { body = await res.json(); } catch { /* the status still speaks */ }

  if (res.ok) {
    // The route's own sentence, because only the server knows what the document
    // now holds. The tail is this page's own honest caveat about ITS freshness.
    setFailedMsg(
      `${body?.detail || 'Written to the ingestion control.'} This list is pushed from the home ` +
        'machine every 15 minutes, so the book below stays listed until the next push — that is this ' +
        'page being out of date, not the request being ignored.',
      'ok',
    );
    return;
  }
  if (res.status === 400) {
    setFailedMsg(body?.detail || 'That book could not be read — reload the page and try again.', 'warn');
  } else if (res.status === 401) {
    setFailedMsg('Sign-in lapsed — sign in again, then try that button.', 'warn');
  } else if (res.status === 403) {
    setFailedMsg(
      'This account does not hold devops, so it cannot change the ingestion queue. ' +
        'An admin can grant devops from /admin (“Make devops”).',
      'warn',
    );
  } else if (res.status === 503) {
    setFailedMsg(`Not configured yet (${body?.error || 'unset secret'}): ${body?.fix || ''}`, 'warn');
  } else {
    setFailedMsg(
      `Something went wrong on the server${body?.error ? ` (${body.error})` : ''} — nothing is ` +
        'guaranteed to have been written. Re-read this list after the next push before pressing it again.',
      'warn',
    );
  }
}

/**
 * A small button. Deliberately NOT the two-tap confirm the pipelines page uses
 * for pause/deploy: the blast radius of a mistaken re-queue is one book moving
 * from `failed` to `pending`, and the processor itself refuses to do even that
 * to a book that already succeeded. A confirmation tax on a reversible,
 * bounded action only teaches people to click twice without reading.
 */
function bookBtn(label, ariaLabel, onClick) {
  const b = el('button', 'btn quiet proc-btn', label);
  b.type = 'button';
  b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', () => { onClick(); });
  return b;
}

/**
 * "Not in GABI's knowledge base" — the failed books and the deferred PDFs.
 *
 * ⚠️ THREE SILENCES, THREE SENTENCES, the same rule as every other list here.
 * `hasSection` lets this tell "the push carried no `failed` key" (an older
 * pusher — go look at it) from "the key was there and empty" (genuinely
 * nothing is broken, which is good news worth stating rather than rendering as
 * a blank box).
 */
function renderFailed(rows, hasSection, nowMs) {
  if (!failedEl) return;
  if (!hasSection) {
    sayEmpty(
      failedEl,
      'The last push carried no failed-book list. That is an older pusher, not a clean shelf — it ' +
        'says nothing about whether anything failed. Check scripts/push-processing-board.mjs on the home machine.',
    );
    return;
  }
  if (!rows.length) {
    sayEmpty(
      failedEl,
      'Nothing failed and nothing is deferred — every book the ingester tracks is either done or ' +
        'still queued. This is a measurement, not an absence of information.',
    );
    return;
  }
  failedEl.replaceChildren();
  for (const raw of rows) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const id = str(b.id);
    const title = str(b.title) || id || 'untitled book';
    const deferred = str(b.status) === 'needs-ocr';
    const li = el('li', 'proc-row');
    li.dataset.status = str(b.status) || 'failed';

    const head = el('div', 'proc-head');
    head.append(el('span', 'proc-title', title));
    if (str(b.lane)) head.append(el('span', 'proc-lane', laneLabel(b.lane)));
    head.append(el('span', 'proc-lane', deferred ? 'waiting on OCR' : 'failed'));
    li.append(head);

    // ⚠️ THE PROCESSOR'S OWN SENTENCE, VERBATIM. It is what tells the owner
    // whether a retry is worth twenty GPU-minutes or will fail identically.
    const why = str(b.reason) || str(b.blocker);
    if (why) li.append(el('p', 'proc-meta', why));

    const bits = [];
    const whenIso = str(b.at);
    if (Number.isFinite(Date.parse(whenIso))) bits.push(ageOf(whenIso, nowMs));
    if (str(b.note)) bits.push(str(b.note));
    if (bits.length) li.append(el('p', 'proc-meta', bits.join(' · ')));

    // ⚠️ A BOOK ALREADY RETRIED ONCE SAYS SO, and it is the highest-value line
    // in the row. A second failure with the same reason means retrying is not
    // the fix; without this the owner presses the button all night.
    if (str(b.requeued_at)) {
      const again =
        str(b.previous_reason) && str(b.previous_reason) === why
          ? ' It failed the same way both times, so a third retry is unlikely to help.'
          : '';
      li.append(
        el('p', 'proc-meta proc-warn', `Already re-queued once (${ageOf(b.requeued_at, nowMs)}).${again}`),
      );
    }

    const actions = el('div', 'proc-actions');
    if (id) {
      const retry = bookBtn('↻ Re-queue', `Re-queue ${title} for ingestion`, () =>
        sendBookControl('requeue', id, title, 'Queueing a retry for'));
      if (deferred) {
        // ⚠️ OFFERED, NOT HIDDEN, AND HONEST ABOUT BEING A NO-OP TODAY. The
        // processor accepts a retry on a deferred PDF; what it cannot do is
        // READ one, because the OCR step was never built. Hiding the button
        // would imply the book is unreachable forever; enabling it silently
        // would waste the owner's evening. So it stays clickable and says what
        // will happen, which is nothing until OCR exists.
        retry.title =
          'This PDF is a scan and the OCR step has not been built, so re-queuing it will not get it ' +
          'read today. The row exists so the book is not mistaken for one the shelf simply lacks.';
      }
      actions.append(retry);
      actions.append(
        bookBtn('⇧ Front of queue', `Move ${title} to the front of the ingestion queue`, () =>
          sendBookControl('priority_front', id, title, 'Moving to the front of the queue')),
      );
    } else {
      // No id means no button — and the row says why, rather than showing a
      // control that cannot work.
      actions.append(
        el('p', 'proc-meta', 'No book id in the push, so this one cannot be re-queued from here.'),
      );
    }
    li.append(actions);

    failedEl.append(li);
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
  // ⚠️ `false`, not `[]`-as-empty: nothing has ever been pushed, so "nothing
  // failed" is not something this page has been told. Rendering it as a clean
  // shelf would be the page inventing the one reassurance it cannot support.
  renderFailed([], false, Date.now());
  renderQueue([]);
  renderPacks(null, Date.now());
  renderCompleted(null, [], Date.now());
}

async function refreshBoard() {
  if (polling) return;
  polling = true;
  try {
    const now = Date.now();
    const result = await fetchBoard(await idToken());
    renderFreshness(freshEl, result, lastGood?.pushedAt ?? null, now, PAGE_SECTIONS);

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
      sayEmpty(inflightEl, 'The last board carried no processing section. The home-machine pusher exists and runs every 15 minutes, so this means it is FAILING, not that it was never built — check output_files/processing_push.log on the home machine. It says nothing about whether books are actually being processed.');
      sayEmpty(historyEl, 'No processing section in the last board, so no history to show.');
      renderFailed([], false, now);
      renderQueue([]);
      renderPacks(null, now);
      renderCompleted(null, [], now);
      return;
    }

    const history = arraySection(section, 'history');
    renderCompleted(section, sortNewestFirst(history), now);
    renderInFlight(arraySection(section, 'in_flight'), now);
    renderQueue(normaliseQueue(section));
    renderPacks(objectSection(section, 'packs'), now);
    // ⚠️ `hasSection` is asked of the RAW section, not of the array: a `failed`
    // key that is present and empty means "nothing is broken", while a key that
    // is absent means an older pusher that cannot tell us either way. Collapsing
    // them would render a clean shelf over a pusher nobody had noticed was stale.
    renderFailed(arraySection(section, 'failed'), 'failed' in section, now);
    renderHistory(history, now);
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
  if (lastGood && freshEl) renderFreshness(freshEl, lastGood, lastGood.pushedAt, Date.now(), PAGE_SECTIONS);
}, TICK_INTERVAL_MS);
