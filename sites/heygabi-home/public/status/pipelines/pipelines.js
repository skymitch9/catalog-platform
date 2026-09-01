/**
 * pipelines.js — /status/pipelines, RUN + CONTROL.
 *
 * ⚠️ EVERY CONTROL IN THIS FILE MOVED HERE FROM status.js ON 2026-08-18, in
 * the four-page split (docs/info/status-pages.md). The ingestion pause card,
 * the Run button, the eight pipeline steps and their interlock, the Run levers
 * and the shelf-server force-upload are the SAME implementations, moved rather
 * than rewritten — their comments are the originals and are worth reading as
 * such. Their tests did not move and did not change:
 * `scripts/test/ingestion-time.test.mjs` (**77**, measured 2026-09-01) and
 * `apps/auth-worker/test/ingestion-control.test.ts` (**71**) still own the
 * behaviour this file plumbs.
 *
 * ⚠️ ONE BEHAVIOURAL CHANGE IN THE MOVE, and it is here rather than hidden:
 * the step interlock used to be fed by the Health page's 60-second sweep,
 * which read `pipeline_status/current` for its own "Book pipeline" row. The
 * two pages no longer share a fetch, so this page reads that document itself
 * (`loadPipelineNow()`), renders one compact row from it, and feeds the
 * interlock from the same read. Two pages reading the same PUBLIC document is
 * the right shape; the alternative was one page keeping state alive for a
 * section it no longer contains.
 *
 * ⚠️ SAFETY MODEL OF THE STEP CONTROLS, unchanged by the move:
 *   1. Confirmation tier by blast radius (read-only / mutating / publishing).
 *   2. THE INTERLOCK: every control disables the instant pipeline_status shows
 *      a run in flight (running/deferred/blocked). The REAL guarantee is
 *      app/core/pipeline_lock.py's single-flight lock on the home machine —
 *      this UI state can never be the only thing standing between two runs —
 *      backed by the auth Worker's own live check (the routes answer 409).
 *   3. Dependencies enforced with REAL data, not a fabricated graph: the one
 *      genuine ordering dependency is "upload needs to know what's new", so
 *      Upload disables until the status doc's own `summary.toUpload` says
 *      there is something to upload. Every other step is self-sufficient by
 *      construction — inventing more "needs X first" rules would document an
 *      order that does not exist in the code behind the button.
 *   4. Every click is logged server-side (ops.ts's pipeline_step_requested /
 *      pipeline_force_upload_requested lines) — the audit trail role grants get.
 */

import {
  AUTH_ORIGIN,
  REFRESH_INTERVAL_MS,
  TICK_INTERVAL_MS,
  fetchJSON,
  formatAge,
  fsMap,
  makeRow,
  tickAll,
  updateRow,
} from '../lib/core.js';
import { mountGate } from '../lib/gate.js';
import { idToken } from '../../assets/estate-auth.js';
import { actionBtn, confirmBtn } from '../../assets/estate-controls.js';
import {
  ISO_WEEKDAY_SHORT,
  PAUSE_MENU,
  PRESET_CUSTOM_LABEL,
  STANDING_UNKNOWN_WORDS,
  SUGGESTED_EXEMPT_PROCESSES,
  describeIngestion,
  isoToPhoenixLocal,
  pausePresets,
  phoenixLocalToIso,
  processListWords,
  recurringWindowWords,
  standingSummaryWords,
  validateExemptProcess,
  validateRecurringWindow,
  whenTitleWords,
  wordTime,
} from '../../assets/ingestion-time.js';

/**
 * The audiobook pipeline's own status doc, read straight over the Firestore
 * REST API — public because firestore.rules sets `allow read: if true` on
 * `pipeline_status/current` deliberately ("nobody can forge a run" is the
 * write-side control; the read side was already open for the admin panel).
 * No API key, no SDK: a plain signed-out GET returns the same document the
 * admin panel's onSnapshot() gets, just typed-JSON instead of decoded.
 */
const FIRESTORE_STATUS_URL =
  'https://firestore.googleapis.com/v1/projects/audiobook-catalog/databases/(default)/documents/pipeline_status/current';

/**
 * Fine-grained pipeline step controls (owner ask 2026-08-16: "give us fine
 * control over each part of the pipeline in case we need to do part way
 * steps... make sure we cant break stuff"). MUST mirror auth-worker's
 * ops.ts PIPELINE_STEPS (and, one hop further, audiobook_catalog's
 * scripts/sync_to_drive.py STEP_INFO) exactly — no shared module across the
 * three, same duplication story as INDEX_THRESHOLDS/KNOWN_BACKUP_PREFIXES
 * elsewhere in this estate. `kind` drives the confirmation tier:
 *   read-only  — plain button, runs immediately.
 *   mutating   — two-tap confirmBtn (assets/estate-controls.js).
 *   publishing — two-tap confirmBtn PLUS a standing "updates the live site"
 *                warning next to the button.
 */
const PIPELINE_STEPS = [
  { key: 'audit', label: 'Purchase audit', kind: 'read-only' },
  { key: 'sort', label: 'Sort books', kind: 'mutating' },
  { key: 'detect', label: 'Detect new books', kind: 'read-only' },
  { key: 'folders', label: 'Read Drive folders', kind: 'mutating' },
  { key: 'upload', label: 'Upload to Drive', kind: 'mutating' },
  { key: 'catalog', label: 'Rebuild catalog', kind: 'publishing' },
  { key: 'publish', label: 'Commit & deploy', kind: 'publishing' },
  // ⚠️ STEP 11 (2026-08-23). `publishing`, not `mutating`, for a reason none
  // of the others share: it writes a DIFFERENT APPLICATION's production D1 —
  // the library catalogue's audiobook_holding table, via that repo's
  // backfill-audiobook-holdings.mjs. It also runs unattended on every 8-hourly
  // cycle INCLUDING the idle ones, because the drift it repairs arrives when
  // the LIBRARY gains books, not when the audiobook machine does.
  { key: 'link', label: 'Link sibling catalogues', kind: 'publishing' },
];
/**
 * The standalone shelf-server force-upload's OWN status doc (owner ask
 * 2026-08-16) — deliberately separate from pipeline_status/current, same
 * public-read Firestore doc idiom as FIRESTORE_STATUS_URL above. Written by
 * audiobook_catalog's scripts/sync_to_server.py via
 * app/pipeline_status.py's force_upload_result().
 */
const SHELF_UPLOAD_STATUS_URL =
  'https://firestore.googleapis.com/v1/projects/audiobook-catalog/databases/(default)/documents/shelf_upload_status/current';

// ---------------------------------------------------------------------------
// The pipeline's live state — this page's own read of pipeline_status/current.
//
// One compact row, and it exists to serve the INTERLOCK as much as the reader:
// a step button that disables itself has to show the run it is deferring to,
// or a greyed button is a mystery with no way out. The fuller pipeline
// analysis (cadence thresholds, the ebook lane, Drive⇄role parity) stays on
// the Health page — this is deliberately the same document read for a
// different question.
// ---------------------------------------------------------------------------

/** Mirrors the audiobook admin panel's isStale() — a "running" doc whose
 *  heartbeat stopped updating probably means the process died, not that a
 *  15-minute step is in progress. */
const PIPELINE_STALE_RUNNING_MS = 15 * 60_000;

/** The last decoded pipeline_status/current doc (fsMap() output), or null.
 *  Feeds renderPipelineStepsAvailability() without a second fetch. */
let lastPipelineStatusDoc = null;

function buildPipelineNowSection() {
  const ul = document.getElementById('pipeline-now-rows');
  if (!ul) return;
  ul.appendChild(makeRow('pipe-now', 'Automated Book Pipeline — right now'));
}

/**
 * ⚠️ FAILS TO "UNKNOWN", NEVER TO "IDLE". An unreadable status document means
 * this page cannot tell whether a run is in flight — which is a different
 * thing from knowing that none is, and rendering it as idle would let every
 * step button light up beside a running pipeline. The interlock downstream
 * fails open on purpose (the home machine's lock is the real guarantee), so
 * the honest word here is the whole protection a reader gets.
 */
async function loadPipelineNow() {
  const now = Date.now();
  const result = await fetchJSON(FIRESTORE_STATUS_URL);

  if (result.status === 404) {
    lastPipelineStatusDoc = null;
    updateRow('pipe-now', 'nodata', 'The pipeline has never recorded a run.', null, now);
    renderPipelineStepsAvailability(null);
    return null;
  }
  if (!result.reached || !result.httpOk || !result.body || !result.body.fields) {
    lastPipelineStatusDoc = null;
    updateRow(
      'pipe-now',
      'warn',
      `Cannot read the pipeline's status (${result.error || `HTTP ${result.status}`}).`,
      'The step buttons below stay enabled — the home machine’s own single-flight lock is what actually stops two runs, and it holds regardless of this reading.',
      now,
    );
    renderPipelineStepsAvailability(null);
    return null;
  }

  const doc = fsMap(result.body.fields);
  lastPipelineStatusDoc = doc;

  const state = doc.state || 'unknown';
  const since = doc.startedAt || doc.updatedAt;
  const sinceMs = since ? Date.parse(since) : NaN;
  const busy = state === 'running' || state === 'deferred' || state === 'blocked';
  const staleRunning =
    state === 'running' && Number.isFinite(sinceMs) && now - sinceMs > PIPELINE_STALE_RUNNING_MS;

  // ⚠️ "BUSY" IS NOT A WARNING (fixed 2026-08-18, the owner's status-colour
  // rule). This row used to paint amber for every busy state, so a pipeline
  // doing exactly its job lit up the same colour as a pipeline in trouble —
  // and the Health page's own row for the SAME document rendered RUNNING as
  // green, so the two pages contradicted each other about one fact.
  //
  // The three "busy" states are not one thing:
  //   running  — working. Green. Nothing is wrong and nothing needs a human.
  //   deferred
  //   blocked  — a run that WANTED to proceed and could not. That is the one
  //              thing amber is for, so those two keep it.
  let badge = state === 'running' ? 'ok' : busy ? 'warn' : 'ok';
  let note = null;
  if (staleRunning) {
    badge = 'danger';
    // The one reading that means something is WRONG rather than merely busy.
    note =
      'This run has been "running" with no heartbeat for over 15 minutes — on the home machine that usually means the process died rather than that a step is slow.';
  } else if (state === 'running') {
    note = 'Green because a run in progress is the pipeline working, not a fault. This row turns red only if its heartbeat stops.';
  }

  // ⚠️ An ISO string is not an age. `since 2026-08-18T15:00:21.957279+00:00`
  // makes a reader do timezone arithmetic to answer the only question the row
  // is asked; both are printed now, and an unreadable stamp says so.
  const sinceText = since
    ? ` since ${Number.isFinite(sinceMs) ? `${formatAge(now - sinceMs)} (${since})` : `${since} — unreadable timestamp`}`
    : '';
  updateRow(
    'pipe-now',
    badge,
    `${String(state).toUpperCase()} (trigger ${doc.trigger || 'not recorded'})` +
      sinceText +
      (doc.step ? ` · step "${doc.step}"` : ''),
    note,
    now,
  );
  renderPipelineStepsAvailability(doc);
  return doc;
}

// ---------------------------------------------------------------------------
// The nightly window (blueprint: "nightly-window state (Phoenix clock, next
// window, GPU guard reading)").
//
// ⚠️ TWO OF THE THREE ARE COMPUTABLE HERE AND THE THIRD IS NOT, and the card
// says which is which rather than blurring them. Phoenix wall clock and
// whether the 12am–8am window is open follow from a FIXED UTC-7 (Arizona has
// not observed DST since 1968 — the same constant assets/ingestion-time.js
// pins and its tests hold at January and July alike), so they are facts. The
// GPU guard is read on the home machine immediately before a run and has no
// published surface, so the markup states "not published" instead of leaving
// a blank that reads as "fine".
//
// ⚠️ THIS IS A CLOCK, NOT A PROMISE. The window being open does not mean a run
// will start — ingestion can be paused, the lock can be held, the guard can
// refuse. The headline says "the window is open", never "ingestion will run".
// ---------------------------------------------------------------------------

const PHOENIX_OFFSET_MS = 7 * 3600_000; // fixed UTC-7, no DST, ever
const WINDOW_OPEN_HOUR = 0; // midnight, Phoenix
const WINDOW_CLOSE_HOUR = 8; // 8am, Phoenix

function phoenixParts(nowMs) {
  const shifted = new Date(nowMs - PHOENIX_OFFSET_MS);
  return {
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    clock: `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`,
  };
}

function renderNightlyWindow(nowMs = Date.now()) {
  const card = document.getElementById('window-card');
  const headline = document.getElementById('window-headline');
  const line = document.getElementById('window-line');
  if (!card || !headline || !line) return;

  const { hour, minute, clock } = phoenixParts(nowMs);
  const open = hour >= WINDOW_OPEN_HOUR && hour < WINDOW_CLOSE_HOUR;

  card.dataset.state = open ? 'open' : 'closed';
  if (open) {
    const minsLeft = (WINDOW_CLOSE_HOUR - hour) * 60 - minute;
    headline.textContent = `The 12am–8am window is OPEN — ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left.`;
  } else {
    const minsUntil = ((24 - hour) % 24) * 60 - minute;
    headline.textContent = `The 12am–8am window is closed — it opens in ${Math.floor(minsUntil / 60)}h ${minsUntil % 60}m.`;
  }
  // ⚠️ The disclaimer is part of the sentence, not decoration: an open window
  // is permission, not a prediction, and the four things that can still stop a
  // run are named so nobody reads a green card as "it ran".
  line.replaceChildren();
  line.append('Phoenix time now ');
  const strong = document.createElement('span');
  strong.className = 'window-clock';
  strong.textContent = clock;
  line.append(strong);
  line.append(
    ' (fixed UTC-7, no DST). An open window means ingestion is ALLOWED to start, not that it will — ' +
      'a pause above, the single-flight lock, or the GPU guard can each still stop it.',
  );
}
// ---------------------------------------------------------------------------
// Fine-grained pipeline step controls (owner ask 2026-08-16) — see
// PIPELINE_STEPS above for the classification. THE SAFETY MODEL:
//   1. Confirmation tier by blast radius (read-only/mutating/publishing).
//   2. THE INTERLOCK: every control disables the instant pipeline_status/
//      current shows a run in flight (running/deferred/blocked) — the same
//      doc the "Book pipeline" row above already reads, so no extra fetch.
//      The REAL guarantee is app/core/pipeline_lock.py's single-flight lock
//      on the home machine (this UI state can never be the only thing
//      standing between two runs); this is the fast, honest UX layer on
//      top of it, backed up by the auth Worker's own live check
//      (POST .../pipeline/step answers 409 if it reads the same doc busy).
//   3. Dependencies enforced with REAL data, not a fabricated graph: the
//      one genuine ordering dependency in the underlying pipeline is
//      "upload needs to know what's new", so the Upload button disables
//      with a reason until pipeline_status/current's own summary.toUpload
//      field says there is something to upload. Every other step is
//      self-sufficient by construction (see sync_to_drive.py's
//      _step_upload(), which always re-runs detect internally) — inventing
//      more "needs X first" rules here would document an order that does
//      not actually exist in the code behind the button.
//   4. Every click is logged server-side (ops.ts's pipeline_step_requested
//      / pipeline_force_upload_requested console lines) — same audit-trail
//      role grants get.
// ---------------------------------------------------------------------------

const stepRowRegistry = new Map(); // key -> { li, btn, reasonEl }
const stepsMsgEl = document.getElementById('pipeline-steps-msg');

function setStepsMessage(text, tone) {
  if (!stepsMsgEl) return;
  stepsMsgEl.textContent = text || '';
  stepsMsgEl.dataset.tone = tone || '';
}

function buildPipelineStepsSection() {
  const ul = document.getElementById('pipeline-steps');
  if (!ul) return;
  for (const step of PIPELINE_STEPS) {
    const li = document.createElement('li');
    li.className = 'step-row';
    li.dataset.step = step.key;

    const main = document.createElement('div');
    main.className = 'step-main';
    const name = document.createElement('span');
    name.className = 'step-name';
    name.textContent = step.label;
    const kind = document.createElement('span');
    kind.className = 'step-kind';
    kind.dataset.kind = step.kind;
    kind.textContent = step.kind;
    main.append(name, kind);
    if (step.kind === 'publishing') {
      const warnNote = document.createElement('span');
      warnNote.className = 'step-warn-note';
      warnNote.textContent = '⚠ updates the live site';
      main.appendChild(warnNote);
    }

    const onClick = () => runPipelineStep(step.key, step.label);
    const btn =
      step.kind === 'read-only'
        ? actionBtn('Run', 'quiet', onClick)
        : confirmBtn('Run', 'quiet', onClick, step.kind === 'publishing' ? 'warn' : '');
    btn.setAttribute('aria-label', `Run ${step.label}`);

    const reason = document.createElement('p');
    reason.className = 'step-reason';
    reason.hidden = true;

    // The last outcome this step is KNOWN to have had. Its own element rather
    // than more text in `reason`, because the two answer different questions —
    // "why can I not press this now" and "what happened last time I did".
    const outcome = document.createElement('p');
    outcome.className = 'step-outcome';
    outcome.hidden = true;

    li.append(main, btn, reason, outcome);
    ul.appendChild(li);
    stepRowRegistry.set(step.key, { li, btn, reasonEl: reason, outcomeEl: outcome });
  }
}

/**
 * Pure: given the DECODED pipeline_status/current doc (fsMap() output, or
 * null when unreadable/never-run), returns a disable reason for ONE step,
 * or null when it should be enabled. See the section header above for the
 * two rules this implements — the interlock (applies to every step) and
 * the one real "needs detect first" dependency (upload only).
 */
function stepDisabledReason(statusDoc, stepKey) {
  if (statusDoc) {
    const state = statusDoc.state;
    if (state === 'running' || state === 'deferred' || state === 'blocked') {
      const since = statusDoc.startedAt || statusDoc.updatedAt;
      const clock = since && Number.isFinite(Date.parse(since))
        ? new Date(Date.parse(since)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null;
      return `pipeline ${state} (${statusDoc.trigger || 'unknown'})${clock ? ` since ${clock}` : ''} — wait for it to finish.`;
    }
  }
  if (stepKey === 'upload') {
    const toUpload = statusDoc && statusDoc.summary ? statusDoc.summary.toUpload : undefined;
    if (toUpload === 0) return 'Detect found 0 new files — nothing to upload right now.';
    if (typeof toUpload !== 'number') return 'Run Detect first so we know what’s new.';
  }
  return null;
}

/**
 * The last outcome of ONE step, off `pipeline_status/current`'s `steps[]`
 * (audiobook_catalog's app/pipeline_status.py writes it: {key, label, state,
 * detail}). Returns `null` when this step was not part of the run that document
 * describes.
 *
 * ⚠️ IT IS "THE LAST RUN", NOT "EVER", AND THE WORDING MUST SAY SO. That
 * document holds ONE run and is overwritten by the next; a single-step run
 * scaffolds only the one step it executes (start_step_run's whole reason for
 * existing — running `upload` alone must never make this page claim `sort` also
 * just ran). So a step missing from `steps[]` has NO outcome to show, which is a
 * completely different fact from "it did not run" or "it failed", and this
 * returns null rather than inventing either.
 *
 * ⚠️ A `pending` or `skipped` step is reported as such and NEVER as a success.
 * The vocabulary belongs to the pipeline; an unrecognised state is shown
 * verbatim, the same stance renderDriveParityRow takes on the Health page.
 */
function stepLastOutcome(statusDoc, stepKey) {
  const steps = statusDoc && Array.isArray(statusDoc.steps) ? statusDoc.steps : null;
  if (!steps) return null;
  const entry = steps.find((s) => s && s.key === stepKey);
  if (!entry) return null;
  const when = statusDoc.updatedAt || statusDoc.startedAt;
  const clock =
    when && Number.isFinite(Date.parse(when))
      ? new Date(Date.parse(when)).toLocaleString([], {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        })
      : null;
  const state = typeof entry.state === 'string' && entry.state ? entry.state : 'unknown state';
  // The pipeline's own detail line, verbatim — it is the closest thing this
  // page has to the step's OUTPUT, and summarising it would throw away the one
  // sentence that says what actually happened.
  const detail = typeof entry.detail === 'string' ? entry.detail.trim() : '';
  const err = state === 'failed' && typeof statusDoc.error === 'string' ? statusDoc.error.trim() : '';
  const bits = [`last run: ${state}`];
  if (clock) bits.push(clock);
  if (statusDoc.trigger) bits.push(`trigger ${statusDoc.trigger}`);
  let text = bits.join(' · ');
  if (detail) text += ` — ${detail}`;
  if (err) text += ` — ${err.slice(0, 300)}`;
  return { text, state };
}

/** Called every refresh — updates disabled state + reason text without
 * recreating the buttons (which would lose confirmBtn's armed-state timer). */
function renderPipelineStepsAvailability(statusDoc) {
  for (const step of PIPELINE_STEPS) {
    const row = stepRowRegistry.get(step.key);
    if (!row) continue;
    if (row.outcomeEl) {
      const outcome = stepLastOutcome(statusDoc, step.key);
      if (outcome) {
        row.outcomeEl.textContent = outcome.text;
        row.outcomeEl.dataset.state = outcome.state;
        row.outcomeEl.hidden = false;
      } else {
        // ⚠️ HIDDEN, NOT "never run". This page reads one document describing
        // one run; a step absent from it has simply not been reported on, and
        // saying "never run" would be asserting a history nothing here holds.
        row.outcomeEl.hidden = true;
        row.outcomeEl.textContent = '';
      }
    }
    const reason = stepDisabledReason(statusDoc, step.key);
    row.btn.disabled = reason !== null;
    row.li.dataset.disabled = reason !== null ? 'true' : 'false';
    if (reason) {
      row.reasonEl.textContent = reason;
      row.reasonEl.hidden = false;
      row.btn.title = reason;
    } else {
      row.reasonEl.hidden = true;
      row.btn.removeAttribute('title');
    }
  }
}

async function runPipelineStep(step, label) {
  const token = await idToken();
  if (!token) {
    setStepsMessage('Sign-in lapsed — sign in again.', 'warn');
    return;
  }
  setStepsMessage(`Requesting "${label}"…`);
  try {
    const res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/pipeline/step`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
    });
    let body = null;
    try { body = await res.json(); } catch { /* status still speaks */ }
    if (res.ok) {
      setStepsMessage(`${body?.detail || 'Requested.'} Watch the pipeline row at the top of this section.`, 'ok');
      watchForPickup();
    } else if (res.status === 409) {
      setStepsMessage(body?.detail || 'The pipeline is already busy — try again shortly.', 'warn');
    } else if (res.status === 503) {
      setStepsMessage(`Not configured yet (${body?.error || 'unset secret'}): ${body?.fix || ''}`, 'warn');
    } else if (res.status === 403) {
      setStepsMessage('You need the approver role to trigger a step. Ask an existing approver or an owner.', 'warn');
    } else {
      setStepsMessage(`Something went wrong on the server${body?.error ? ` (${body.error})` : ''}. Try again shortly.`, 'warn');
    }
  } catch {
    setStepsMessage('The auth Worker did not answer (network). Try again shortly.', 'warn');
  }
}

// ---------------------------------------------------------------------------
// Force full upload to the shelf server (owner ask 2026-08-16) — deliberately
// NOT one of the pipeline steps above; see index.html's comment. Reads its
// own status doc (shelf_upload_status/current) so a "not configured yet"
// result is shown plainly, never silently swallowed.
// ---------------------------------------------------------------------------

function buildShelfUploadSection() {
  const ul = document.getElementById('shelf-upload-rows');
  if (!ul) return;
  ul.appendChild(makeRow('shelf-upload', 'Shelf upload (last force-upload result)'));
}

const SHELF_STATE_LABELS = {
  success: 'ok',
  not_configured: 'warn',
  unreachable: 'warn',
  failed: 'danger',
};

async function loadShelfUploadStatus() {
  const now = Date.now();
  const result = await fetchJSON(SHELF_UPLOAD_STATUS_URL);
  if (result.status === 404) {
    // Grey, not amber (2026-08-18): "nobody has ever pressed this button" is
    // an absence, not a run that tried something and failed.
    updateRow('shelf-upload', 'nodata', 'Never run yet — no force-upload has ever been recorded.',
      'Grey rather than amber: nothing has failed here. Use the button above once the shelf server exists (see /runbooks/shelf/).', now);
    return;
  }
  if (!result.reached || !result.httpOk || !result.body || !result.body.fields) {
    updateRow('shelf-upload', 'danger', `Did not answer (${result.error || `HTTP ${result.status}`}).`, null, now);
    return;
  }
  const doc = fsMap(result.body.fields);
  // ⚠️ AN UNRECOGNISED STATE IS NOT A WARNING. It used to default to amber,
  // which is this page inventing a verdict for a word it has not been taught —
  // the opposite of what renderDriveParityRow does on the Health page for the
  // same situation, and the vocabulary belongs to the pipeline, not here.
  const known = Object.prototype.hasOwnProperty.call(SHELF_STATE_LABELS, doc.state);
  const state = known ? SHELF_STATE_LABELS[doc.state] : 'nodata';
  // ⚠️ A raw ISO stamp with no age is a stale reading wearing a fresh face.
  const updatedMs = Date.parse(doc.updatedAt || '');
  const attemptNote = doc.updatedAt
    ? `Last attempt ${Number.isFinite(updatedMs) ? `${formatAge(now - updatedMs)} (${doc.updatedAt})` : `${doc.updatedAt} — unreadable timestamp`}.`
    : 'The status document carries no attempt time, so how old this result is cannot be said.';
  updateRow(
    'shelf-upload',
    state,
    `${(doc.state || 'no state recorded').toUpperCase()}${doc.message ? ` — ${doc.message}` : ''}`,
    known ? attemptNote
      : `${attemptNote} This page has not been taught the state “${doc.state}” — it renders what the pipeline sent rather than guessing a colour for it.`,
    now,
  );
  return doc.updatedAt;
}

/** Poll loadShelfUploadStatus() until it reports something newer than the
 * request, or PICKUP_POLL_MAX_MS elapses — same cadence/limits as
 * watchForPickup() below, generalized since force-upload has no "RUNNING"
 * state on pipeline_status to watch for. */
let shelfPickupTimer = null;
function watchForShelfPickup(requestedAtIso) {
  if (shelfPickupTimer) clearInterval(shelfPickupTimer);
  const deadline = Date.now() + PICKUP_POLL_MAX_MS;
  shelfPickupTimer = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(shelfPickupTimer);
      shelfPickupTimer = null;
      return;
    }
    const updatedAt = await loadShelfUploadStatus();
    if (updatedAt && Date.parse(updatedAt) >= Date.parse(requestedAtIso)) {
      clearInterval(shelfPickupTimer);
      shelfPickupTimer = null;
    }
  }, PICKUP_POLL_MS);
}

const opsForceUploadBtn = document.getElementById('ops-force-upload');
const opsForceUploadMsgEl = document.getElementById('ops-force-upload-msg');

function setForceUploadMsg(text, tone) {
  if (!opsForceUploadMsgEl) return;
  opsForceUploadMsgEl.textContent = text || '';
  opsForceUploadMsgEl.dataset.tone = tone || '';
}

if (opsForceUploadBtn) {
  opsForceUploadBtn.addEventListener('click', async () => {
    const token = await idToken();
    if (!token) {
      setForceUploadMsg('Sign-in lapsed — sign in again.', 'warn');
      return;
    }
    opsForceUploadBtn.disabled = true;
    setForceUploadMsg('Requesting…');
    try {
      const res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/pipeline/force-upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      let body = null;
      try { body = await res.json(); } catch { /* status still speaks */ }
      if (res.ok) {
        setForceUploadMsg(`${body?.detail || 'Requested.'} Watch the "Shelf upload" row below.`, 'ok');
        watchForShelfPickup(body?.requestedAt || new Date().toISOString());
      } else if (res.status === 409) {
        setForceUploadMsg(body?.detail || 'The pipeline is busy — try again shortly.', 'warn');
      } else if (res.status === 503) {
        setForceUploadMsg(`Not configured yet (${body?.error || 'unset secret'}): ${body?.fix || ''}`, 'warn');
      } else if (res.status === 403) {
        setForceUploadMsg('You need the approver role to trigger this. Ask an existing approver or an owner.', 'warn');
      } else {
        setForceUploadMsg(`Something went wrong on the server${body?.error ? ` (${body.error})` : ''}. Try again shortly.`, 'warn');
      }
    } catch {
      setForceUploadMsg('The auth Worker did not answer (network). Try again shortly.', 'warn');
    } finally {
      opsForceUploadBtn.disabled = false;
    }
  });
}
// ---------------------------------------------------------------------------
// Ingestion pause / resume (owner order 2026-08-18, verbatim: "give me a way
// to pause and start the process flow on the GABI dashboard. Tonight starting
// at 7pm I need all of this paused until midnight. So let me also set pause
// timers on the ui. I can say don't even check to start until x time.").
//
// ⚠️ EVERY WORD ON THIS CARD IS DECIDED IN assets/ingestion-time.js, NOT HERE.
// That file is pure, has no imports, and is pinned by
// scripts/test/ingestion-time.test.mjs; this file cannot be tested at all
// (it imports the Firebase SDK through estate-auth.js). So the split is
// deliberate: everything that could be silently WRONG — the Phoenix
// conversion, "midnight tonight", whether a lapsed timer still reads as
// paused — lives on the tested side, and what is left here is DOM plumbing.
//
// ⚠️ READ AND WRITTEN THROUGH THE WORKER, not straight off Firestore's public
// REST path the way the pipeline_status row above is. The control document
// stays closed on the audiobook_catalog side that way — see ops.ts's
// GET /estate/ops/ingestion header for the full reasoning.
//
// ⚠️ SAME TWO-TAP GRAMMAR, NO THIRD GESTURE. Resume, Start now, both "Set"
// buttons and every add/delete are confirmBtn (assets/estate-controls.js).
// The Pause menu's four answers are NOT, for the reason its own comment gives:
// the button has already opened a question and each answer is a sentence
// naming its consequence, so the answer IS the second tap.
//
// ⚠️ CONDENSED 2026-09-01 (owner: "this all works good, the time selector is a
// not my favorite and its getting to be a lot of menus and buttons, can you
// reassess and condense for a better ux"). The card's DEFAULT state went from
// 22 visible interactive elements to 2 — one contextual button and one counted
// disclosure — with no route, no written shape and no semantic changed. What
// this file gained is three renderers keyed off describeIngestion(): the
// primary button, the time drawer, and the disclosure summary.
// ---------------------------------------------------------------------------

const ingStatusEl = document.getElementById('ingestion-status');
const ingHeadlineEl = document.getElementById('ingestion-headline');
const ingLinesEl = document.getElementById('ingestion-lines');
const ingMsgEl = document.getElementById('ingestion-msg');
const ingPauseUntilInput = document.getElementById('ingestion-pause-until');
const ingDontCheckInput = document.getElementById('ingestion-dont-check');
const ingButtonsEl = document.getElementById('ingestion-buttons');
const ingWhenEl = document.getElementById('ingestion-when');
const ingWhenTitleEl = document.getElementById('ingestion-when-title');
const ingWhenChipsEl = document.getElementById('ingestion-when-chips');
const ingWhenCustomEl = document.getElementById('ingestion-when-custom');
const ingPauseUntilBlock = document.getElementById('ingestion-pause-until-block');
const ingDontCheckBlock = document.getElementById('ingestion-dont-check-block');
const ingStandingSummaryEl = document.getElementById('ingestion-standing-summary');
const ingRecurringDaysEl = document.getElementById('ingestion-recurring-days');
const ingRecurringFromInput = document.getElementById('ingestion-recurring-from');
const ingRecurringUntilInput = document.getElementById('ingestion-recurring-until');
const ingRecurringRowsEl = document.getElementById('ingestion-recurring-rows');
const ingProcessInput = document.getElementById('ingestion-process');
const ingProcessRowsEl = document.getElementById('ingestion-process-rows');

/** The last control document read, kept so the ticker can re-word it (a
 *  pause "until 7:05 PM" has to stop saying "paused" at 7:05 even if no
 *  fetch happens to land in that second) without a network round trip. */
let lastIngestionControl = null;
let ingestionKnown = false; // false until a read has actually succeeded

function setIngestionMsg(text, tone) {
  if (!ingMsgEl) return;
  ingMsgEl.textContent = text || '';
  ingMsgEl.dataset.tone = tone || '';
}

/** Paint the status half from a control document (or null for "none yet"). */
function renderIngestion(control, nowMs = Date.now()) {
  if (!ingStatusEl) return;
  const d = describeIngestion(control, nowMs);
  ingStatusEl.dataset.state = d.badge;
  ingHeadlineEl.textContent = d.headline;
  ingLinesEl.innerHTML = '';
  for (const line of d.lines) {
    const p = document.createElement('p');
    p.textContent = line;
    ingLinesEl.appendChild(p);
  }
  renderPrimaryAction(d.primary, d.showStartNow);
  renderStandingLists(control, nowMs);
  renderStandingSummary(control, nowMs);
}

// ---------------------------------------------------------------------------
// THE ONE CONTEXTUAL PRIMARY ACTION (owner ask 2026-09-01 — the condense).
//
// ⚠️ WHICH BUTTON IS HONEST IS DECIDED IN ingestion-time.js, not here: this
// function is handed `primary` and `showStartNow` and does nothing but build
// the DOM for them. The card used to show four pause/resume buttons at all
// times, three of which were wrong in any given state — "Resume" over a
// running pipeline and "Pause for now" over an already-paused one are both
// controls that mean nothing, and four of them together were most of what the
// owner meant by "a lot of menus and buttons".
//
// ⚠️ REBUILT ONLY WHEN THE ANSWER CHANGES, for exactly the reason the standing
// lists are: the ticker re-renders every 5 seconds and a rebuild would disarm
// a confirmBtn under somebody's finger and close an open question mid-read.
// ---------------------------------------------------------------------------

let lastPrimarySignature = null;

function renderPrimaryAction(primary, showStartNow) {
  if (!ingButtonsEl) return;
  const signature = `${primary}|${showStartNow ? 'start' : ''}`;
  if (signature === lastPrimarySignature) return;
  lastPrimarySignature = signature;

  closeWhen();
  ingButtonsEl.replaceChildren();

  // ⚠️ 'unknown' is the FAILED-READ state (failIngestion). We cannot tell
  // which single button is right, so both are offered rather than guessing —
  // hiding the control somebody needs because a fetch failed would be a worse
  // failure than showing one that turns out to be a no-op, and the headline
  // above already says the reading is what broke.
  if (primary === 'pause' || primary === 'unknown') buildPauseMenu(ingButtonsEl);
  if (primary === 'resume' || primary === 'unknown') {
    ingButtonsEl.appendChild(
      confirmBtn('Resume', 'quiet', () => sendIngestionControl('resume', undefined, 'Resuming')),
    );
  }

  // ⚠️ "START NOW" IS NOT A SECOND RESUME BUTTON (owner-approved fine control
  // #2, 2026-08-18), and since 2026-09-01 it is shown ONLY in the one state
  // where that is true. Both clear the pause flag and both timers. RESUME
  // additionally drops a scheduled window that is in force right now — it has
  // to, or the window re-pauses ingestion seconds later and Resume reads as
  // broken. START NOW leaves `pause_windows` completely untouched: quiet hours
  // are a schedule the owner set on purpose, and silently deleting tonight's
  // 7pm window to satisfy a one-off request would take away a recurring
  // instruction he never withdrew. Outside a live window the two write the
  // same document, so a second button there is noise.
  //
  // ⚠️ THE CONSEQUENCE IS ADMITTED RATHER THAN HIDDEN: inside a live window
  // this clears the ad-hoc pauses and the window STILL blocks the start. The
  // route's own wording says so and lands in the message line below.
  if (showStartNow) {
    ingButtonsEl.appendChild(
      confirmBtn(
        '▶ Start now',
        'quiet',
        () => sendIngestionControl('start_now', undefined, 'Clearing the pauses'),
        'warn',
      ),
    );
  }
}

/** The counted line on the collapsed disclosure. Cheap enough to repaint on
 *  every tick — it is text, so it cannot disarm a button or close the
 *  disclosure — and it MUST repaint, because "blocker in force" becomes true
 *  at a wall-clock boundary no fetch is waiting for. */
function renderStandingSummary(control, nowMs = Date.now()) {
  if (!ingStandingSummaryEl) return;
  const summary = standingSummaryWords(control ?? null, nowMs);
  ingStandingSummaryEl.textContent = summary.text;
  ingStandingSummaryEl.dataset.inForce = summary.inForce ? 'true' : 'false';
}

// ---------------------------------------------------------------------------
// The two STANDING lists — recurring blockers and do-not-disturb programs
// (owner asks 2026-08-31 / 2026-09-01, design §§4 and 4a).
//
// ⚠️ RE-RENDERED ONLY WHEN THE CONTENT CHANGED, and that guard is not an
// optimisation. renderIngestion() runs every 5 seconds off the ticker, and
// rebuilding these rows each time would destroy every confirmBtn's armed state
// under somebody's finger — a Delete you tapped once would go back to
// unarmed a moment later, and it would look like the button was broken.
// The signature is the whole of both lists, so a change made on the phone
// still repaints here within the 60-second re-read.
// ---------------------------------------------------------------------------

let lastStandingSignature = null;

function standingSignature(control) {
  return JSON.stringify([control?.recurring_windows ?? [], control?.exempt_processes ?? []]);
}

function renderStandingLists(control, nowMs = Date.now()) {
  if (!ingRecurringRowsEl || !ingProcessRowsEl) return;
  const signature = standingSignature(control);
  if (signature === lastStandingSignature) {
    // Only the "in force right now" marker can change without the list
    // changing, and that is a class flip rather than a rebuild.
    markBlockerInForce(control, nowMs);
    return;
  }
  lastStandingSignature = signature;

  ingRecurringRowsEl.replaceChildren();
  const blockers = Array.isArray(control?.recurring_windows) ? control.recurring_windows : [];
  if (blockers.length === 0) {
    ingRecurringRowsEl.appendChild(
      emptyRow('No recurring blockers. Ingestion is free to run at any hour the other controls allow.'),
    );
  }
  for (const win of blockers) {
    const words = recurringWindowWords(win);
    const li = document.createElement('li');
    li.className = 'ing-row';
    const text = document.createElement('span');
    text.className = 'ing-row-words';
    // ⚠️ A row this page cannot put into words is shown as unreadable rather
    // than skipped: the home machine drops it too, and an owner who set it
    // deserves to see that it is not doing anything.
    text.textContent = words || 'Unreadable blocker — the home machine ignores it. Delete it.';
    if (!words) text.dataset.unreadable = 'true';
    li.append(text);
    li.appendChild(
      confirmBtn('Delete', 'quiet', () =>
        sendIngestionControl('recurring_delete', undefined, 'Deleting the blocker', undefined, {
          window: win,
        }),
      'warn'),
    );
    ingRecurringRowsEl.appendChild(li);
  }

  ingProcessRowsEl.replaceChildren();
  const programs = Array.isArray(control?.exempt_processes) ? control.exempt_processes : [];
  if (programs.length === 0) {
    ingProcessRowsEl.appendChild(
      emptyRow('No programs listed. Nothing on this machine stops a start just by running.'),
    );
  }
  for (const name of programs) {
    const li = document.createElement('li');
    li.className = 'ing-row';
    const text = document.createElement('span');
    text.className = 'ing-row-words';
    text.textContent = name;
    li.append(text);
    li.appendChild(
      confirmBtn('Delete', 'quiet', () =>
        sendIngestionControl('exempt_delete', undefined, `Removing ${name}`, undefined, {
          process: name,
        }),
      'warn'),
    );
    ingProcessRowsEl.appendChild(li);
  }
  markBlockerInForce(control, nowMs);
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'ing-row ing-row-empty';
  li.textContent = text;
  return li;
}

/** Mark the blocker that is in force RIGHT NOW, so the list agrees with the
 *  headline above it. `describeIngestion` decides which one — this file never
 *  re-implements the midnight-crossing arithmetic. */
function markBlockerInForce(control, nowMs) {
  if (!ingRecurringRowsEl) return;
  const active = describeIngestion(control ?? null, nowMs).blocker;
  const activeWords = active ? recurringWindowWords(active) : null;
  for (const li of ingRecurringRowsEl.children) {
    const words = li.querySelector('.ing-row-words');
    li.dataset.inForce = words && activeWords && words.textContent === activeWords ? 'true' : 'false';
  }
}

/**
 * A failed READ must never leave the last good reading on screen looking
 * current — the silent-staleness trap this page exists to close, and it is
 * far worse on a control than on a row: an owner deciding whether his 7pm
 * pause landed would be reading a sentence from before he set it.
 */
function failIngestion(detail) {
  if (!ingStatusEl) return;
  ingestionKnown = false;
  lastIngestionControl = null;
  ingStatusEl.dataset.state = 'danger';
  ingHeadlineEl.textContent = 'Cannot tell whether ingestion is paused.';
  ingLinesEl.innerHTML = '';
  const p = document.createElement('p');
  p.textContent =
    `${detail} The controls below still work — this is only the reading. Pause AND Resume are both ` +
    'offered because nothing here can tell which one you need right now.';
  ingLinesEl.appendChild(p);
  // ⚠️ The contextual primary needs a state, and "we could not read it" is a
  // state — not an excuse to leave the last answer on screen. 'unknown' offers
  // both buttons; see renderPrimaryAction().
  renderPrimaryAction('unknown', false);
  if (ingStandingSummaryEl) {
    ingStandingSummaryEl.textContent = STANDING_UNKNOWN_WORDS;
    ingStandingSummaryEl.dataset.inForce = 'false';
  }
  // ⚠️ THE STANDING LISTS MUST GO TOO, and they must NOT go to "none". Leaving
  // the last good rows on screen would be the same silent-staleness trap the
  // headline above just avoided, and rendering an empty list would state
  // something stronger and falser — "you have no blockers" — than "we could
  // not read them".
  lastStandingSignature = null;
  for (const el of [ingRecurringRowsEl, ingProcessRowsEl]) {
    if (!el) continue;
    el.replaceChildren(emptyRow('Cannot read this list right now — it is unchanged on the home machine.'));
  }
}

async function loadIngestionControl() {
  if (!ingStatusEl) return;
  const token = await idToken();
  if (!token) return; // probeOpsApprover() retries on the next auth event
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/ingestion`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    failIngestion('The auth Worker did not answer (network).');
    return;
  }
  if (res.status === 401 || res.status === 403) {
    failIngestion('This account is not allowed to read the ingestion control.');
    return;
  }
  if (res.status === 503) {
    let body = null;
    try { body = await res.json(); } catch { /* status still speaks */ }
    failIngestion(`Not configured yet (${body?.error || 'unset secret'}): ${body?.fix || ''}`);
    return;
  }
  if (!res.ok) {
    failIngestion(`The ingestion endpoint answered HTTP ${res.status}.`);
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    failIngestion('The answer was unreadable.');
    return;
  }
  ingestionKnown = true;
  lastIngestionControl = body?.control ?? null;
  renderIngestion(lastIngestionControl);
  prefillIngestionInputs(lastIngestionControl);
}

/** Show what is already set in the pickers, so "Pause until…" opens on the
 *  time currently in force rather than on an empty box that implies nothing
 *  is set. Never overwrites a value the owner is part-way through typing. */
function prefillIngestionInputs(control) {
  if (ingPauseUntilInput && !ingPauseUntilInput.value) {
    ingPauseUntilInput.value = isoToPhoenixLocal(control?.paused_until);
  }
  if (ingDontCheckInput && !ingDontCheckInput.value) {
    ingDontCheckInput.value = isoToPhoenixLocal(control?.dont_check_until);
  }
}

/**
 * The one write path. `until` is already an ISO instant (converted from
 * Phoenix wall-clock by the caller) or undefined.
 *
 * ⚠️ Every refusal is worded, never a bare status — the estate's standing
 * rule, and the four causes are kept distinct because their fixes differ.
 */
async function sendIngestionControl(action, until, verb, mode, extra) {
  const token = await idToken();
  if (!token) {
    setIngestionMsg('Sign-in lapsed — sign in again.', 'warn');
    return;
  }
  setIngestionMsg(`${verb}…`);
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/ingestion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // ⚠️ `mode` rides only when the caller decided one (the two pause
      // buttons). Omitting it is the SAFE default — the Worker and the home
      // machine both read an absent mode as "stop all work" — so a caller that
      // has nothing to say about the meaning of a pause says nothing.
      // `extra` carries `window` (a recurring blocker) or `process` (a
      // do-not-disturb name) for the four standing-list actions, and nothing
      // at all for every other control — the same "say nothing unless this
      // caller decided something" rule `mode` follows.
      body: JSON.stringify({
        action,
        ...(until ? { until } : {}),
        ...(mode ? { mode } : {}),
        ...(extra || {}),
      }),
    });
  } catch {
    setIngestionMsg('The auth Worker did not answer (network). Nothing changed — try again shortly.', 'warn');
    return;
  }
  let body = null;
  try { body = await res.json(); } catch { /* status still speaks */ }

  if (res.ok) {
    ingestionKnown = true;
    lastIngestionControl = body?.control ?? null;
    renderIngestion(lastIngestionControl);
    // ⚠️ THE ROUTE'S OWN SENTENCE WINS when it sends one. Each action has a
    // different consequence and only the server knows the resulting document —
    // "Start now" in particular has to admit that a live quiet-hours window
    // still blocks the start. A single generic "Saved." would flatten that into
    // a claim the page cannot support. The old wording stays as the fallback so
    // an older Worker deploy still says something true.
    setIngestionMsg(body?.detail || 'Saved. The home machine reads this before every run.', 'ok');
    return;
  }
  if (res.status === 400) {
    setIngestionMsg(body?.detail || 'That request could not be read — check the time and try again.', 'warn');
  } else if (res.status === 401) {
    setIngestionMsg('Sign-in lapsed — sign in again, then set it.', 'warn');
  } else if (res.status === 403) {
    setIngestionMsg(
      'This account does not hold devops, so it cannot pause or resume ingestion. ' +
        'An admin can grant devops from /admin ("Make devops").',
      'warn',
    );
  } else if (res.status === 503) {
    setIngestionMsg(`Not configured yet (${body?.error || 'unset secret'}): ${body?.fix || ''}`, 'warn');
  } else {
    setIngestionMsg(
      `Something went wrong on the server${body?.error ? ` (${body.error})` : ''} — nothing is guaranteed to have changed. ` +
        'Re-read the status line above before assuming either way.',
      'warn',
    );
  }
}

/** Read a picker as PHOENIX wall-clock and refuse, in words, anything that
 *  is empty or already past — a control that reports success and changes
 *  nothing is the failure mode worth spending two branches on. */
function readPhoenixPicker(input, what) {
  const raw = input?.value || '';
  if (!raw) return { error: `Pick a date and time first — ${what} needs one.` };
  const iso = phoenixLocalToIso(raw);
  if (!iso) return { error: 'That date and time could not be read. Pick it again.' };
  if (Date.parse(iso) <= Date.now()) {
    return { error: `${wordTime(iso, Date.now()) || 'That time'} has already passed — pick a time in the future.` };
  }
  return { iso };
}

/**
 * ⚠️ PAUSING IS A QUESTION, NOT A BUTTON (owner ask 2026-08-23, verbatim:
 * *"when i manually pause the pipeline it says nothing can override it. I want
 * it to ask me if i want to stop all work until unpaused or if scheduled
 * window is fine to continue."*). His decision was ASK EVERY TIME — nothing is
 * saved as a preference, so there is no remembered default to pre-select and
 * no settings row anywhere; the question is the control.
 *
 * ⚠️ SINCE 2026-09-01 THE QUESTION IS THE WHOLE PAUSE MENU, not just the hard
 * pause's two meanings ("its getting to be a lot of menus and buttons"). One
 * **Pause** opens four answers — for now / until a time / until I unpause /
 * don't even check until a time — and the fourth control the card used to
 * carry standing is now the fourth line of one question. The two-tap total is
 * unchanged: open the question, pick the answer.
 *
 * ⚠️ THE ANSWERS ARE NOT `confirmBtn`, AND THAT IS DELIBERATE. Everything else
 * on this card is two-tap because the label alone ("Resume", "Start now") does
 * not say what it will do. Here the first tap has already opened a question and
 * each answer carries a full sentence naming its own consequence — so the
 * answer IS the confirmation. Wrapping them would make pausing three taps and,
 * worse, would put "Tap again to…" over the one moment the owner is being
 * asked to read the options and pick.
 *
 * ⚠️ "Until I unpause" ASKS A SECOND QUESTION, and it has to: `pause_mode`
 * is a real difference in what the pause MEANS (all work, versus everything
 * but the nightly window) and the owner's answer was that it is asked every
 * time. It is the one two-step answer, and it is the one whose two outcomes
 * are genuinely different documents.
 *
 * Cancel exists because an opened question must be closeable without
 * answering it: a control that can only be escaped by doing something is how
 * an accidental pause happens.
 */
function buildPauseMenu(holder) {
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn small quiet warn';
  open.textContent = 'Pause…'; // the ellipsis promises the question

  const menu = document.createElement('div');
  menu.className = 'ing-menu';
  // ⚠️ `style.display`, not the `hidden` attribute: this page's stylesheet sets
  // display on .btn and friends, and a CSS `display` beats `hidden` — the exact
  // attribute-says-hidden/pixels-say-visible trap the estate's verification
  // rule names. Setting display directly cannot be overridden that way.
  menu.style.display = 'none';

  const closeMenu = () => {
    menu.style.display = 'none';
    open.style.display = '';
    modeRow.style.display = 'none';
  };

  /** One menu answer: the label, and underneath it the sentence that makes the
   *  answer safe to act on without a confirm step. */
  const item = (entry, onPick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small quiet ing-menu-item';
    const label = document.createElement('span');
    label.className = 'ing-menu-label';
    label.textContent = entry.label;
    const detail = document.createElement('span');
    detail.className = 'ing-menu-detail';
    detail.textContent = entry.detail;
    b.append(label, detail);
    b.addEventListener('click', onPick);
    return b;
  };

  // The hard pause's own two answers, revealed under the menu rather than
  // replacing it — the owner can still see which of the four he picked.
  const modeRow = document.createElement('div');
  modeRow.className = 'ing-pause-choice';
  modeRow.style.display = 'none';
  const ask = document.createElement('span');
  ask.className = 'ing-label';
  ask.textContent = 'Pause what?';
  const answer = (label, mode, verb) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small danger';
    b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await sendIngestionControl('pause', undefined, verb, mode);
      } finally {
        b.disabled = false;
        // Closed on both paths: leaving the question open after a FAILED
        // write invites a second press against a card whose message line
        // already says what went wrong.
        closeMenu();
      }
    });
    return b;
  };
  modeRow.append(
    ask,
    answer('Stop all work until unpaused', 'all', 'Pausing everything'),
    answer('Let the scheduled window continue', 'manual_only', 'Pausing work started by hand'),
  );

  const items = document.createElement('div');
  items.className = 'ing-menu-items';
  for (const entry of PAUSE_MENU) {
    if (entry.key === 'for_now') {
      // ⚠️ THE SOFT PAUSE (owner 2026-08-31: "i want any pause thats not the
      // 'until i unpause' to be unpaused by either next scheduled start or the
      // next gpu free availability"). It asks NO mode question, unlike the hard
      // pause: a soft pause is window-exempt by construction — the window
      // opening is its own ceiling — so there is nothing for 'all' versus
      // 'manual_only' to decide.
      items.appendChild(
        item(entry, async () => {
          await sendIngestionControl('pause_for_now', undefined, 'Pausing for now');
          closeMenu();
        }),
      );
    } else if (entry.key === 'until_time') {
      items.appendChild(item(entry, () => { closeMenu(); openWhen('pause_until'); }));
    } else if (entry.key === 'hard') {
      items.appendChild(item(entry, () => { modeRow.style.display = ''; }));
    } else if (entry.key === 'dont_check') {
      items.appendChild(item(entry, () => { closeMenu(); openWhen('dont_check_until'); }));
    }
  }

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn small quiet';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeMenu);

  menu.append(items, modeRow, cancel);

  open.addEventListener('click', () => {
    closeWhen();
    open.style.display = 'none';
    menu.style.display = '';
  });

  holder.append(open, menu);
}

// ---------------------------------------------------------------------------
// THE TIME DRAWER — preset chips, with the native picker demoted to "Custom…".
//
// ⚠️ THIS IS THE OWNER'S ACTUAL COMPLAINT ("the time selector is a not my
// favorite"). A datetime-local input asks for a date, an hour, a minute and an
// AM/PM on a phone keyboard to express "an hour from now", and it opens on
// whatever the browser feels like. The chips are the same instants, computed in
// Phoenix at render time, labelled in the words the status line above uses —
// and they write the SAME shapes through the SAME routes. The picker is still
// here, one tap away, because some pauses genuinely want an arbitrary instant.
// ---------------------------------------------------------------------------

let whenIntent = null;

function closeWhen() {
  whenIntent = null;
  if (ingWhenEl) ingWhenEl.hidden = true;
  if (ingWhenCustomEl) ingWhenCustomEl.hidden = true;
}

function openWhen(intent) {
  if (!ingWhenEl || !ingWhenChipsEl) return;
  whenIntent = intent;
  ingWhenEl.hidden = false;
  if (ingWhenCustomEl) ingWhenCustomEl.hidden = true;
  // Only the block belonging to this intent — two pickers side by side was
  // half of what made the old card a wall of controls, and the one that is not
  // being set would be a second, silent way to write a different field.
  if (ingPauseUntilBlock) ingPauseUntilBlock.hidden = intent !== 'pause_until';
  if (ingDontCheckBlock) ingDontCheckBlock.hidden = intent !== 'dont_check_until';
  if (ingWhenTitleEl) ingWhenTitleEl.textContent = whenTitleWords(intent) || '';

  const verb = intent === 'pause_until' ? 'Pausing until' : 'Holding off until';
  ingWhenChipsEl.replaceChildren();
  // ⚠️ COMPUTED AT OPEN TIME, NOT AT PAGE LOAD. "In an hour" is a lie the
  // moment the card has been open for ten minutes, and the fixed clock chips
  // drop themselves as their hour passes.
  for (const preset of pausePresets(Date.now())) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small quiet ing-chip';
    b.textContent = preset.label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await sendIngestionControl(intent, preset.iso, `${verb} ${wordTime(preset.iso, Date.now())}`);
      } finally {
        b.disabled = false;
        closeWhen();
      }
    });
    ingWhenChipsEl.appendChild(b);
  }

  const custom = document.createElement('button');
  custom.type = 'button';
  custom.className = 'btn small quiet ing-chip';
  custom.textContent = PRESET_CUSTOM_LABEL;
  custom.addEventListener('click', () => {
    if (ingWhenCustomEl) ingWhenCustomEl.hidden = false;
    const input = intent === 'pause_until' ? ingPauseUntilInput : ingDontCheckInput;
    input?.focus();
  });
  ingWhenChipsEl.appendChild(custom);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn small quiet';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeWhen);
  ingWhenChipsEl.appendChild(cancel);
}

function buildIngestionCard() {
  // ⚠️ The pause/resume buttons themselves are NOT built here any more — they
  // depend on the control document, so renderPrimaryAction() builds them and
  // rebuilds them when (and only when) the answer changes. What is built once
  // here is everything whose existence does not depend on the state: the two
  // "Set" buttons behind Custom…, and the two standing editors.

  const pauseSlot = document.getElementById('ingestion-pause-until-slot');
  if (pauseSlot) {
    pauseSlot.appendChild(
      confirmBtn('Set pause', 'quiet', () => {
        const r = readPhoenixPicker(ingPauseUntilInput, 'the pause');
        if (r.error) { setIngestionMsg(r.error, 'warn'); return; }
        return sendIngestionControl(
          'pause_until',
          r.iso,
          `Pausing until ${wordTime(r.iso, Date.now())}`,
        ).then(closeWhen);
      }, 'warn'),
    );
  }

  const dontSlot = document.getElementById('ingestion-dont-check-slot');
  if (dontSlot) {
    dontSlot.appendChild(
      confirmBtn('Set check time', 'quiet', () => {
        const r = readPhoenixPicker(ingDontCheckInput, 'the check time');
        if (r.error) { setIngestionMsg(r.error, 'warn'); return; }
        return sendIngestionControl(
          'dont_check_until',
          r.iso,
          `Holding off until ${wordTime(r.iso, Date.now())}`,
        ).then(closeWhen);
      }, 'warn'),
    );
  }

  buildRecurringEditor();
  buildProcessEditor();
}

// ---------------------------------------------------------------------------
// The recurring-blocker editor and the do-not-disturb editor.
//
// ⚠️ EVERY WORD THEY PRODUCE COMES FROM assets/ingestion-time.js — the row
// sentences, the refusals, the weekday names and the suggested program names.
// This file collects checkbox states and hands them over; it decides nothing
// that could be silently wrong, which is the same split the pause card has
// followed since 2026-08-18.
// ---------------------------------------------------------------------------

/** The seven ISO weekday checkboxes, built here rather than typed into the
 *  HTML so the numbering comes from ONE place (ISO_WEEKDAY_SHORT) and cannot
 *  drift from the numbering the reader uses. */
function buildRecurringEditor() {
  if (!ingRecurringDaysEl) return;
  ISO_WEEKDAY_SHORT.forEach((label, i) => {
    const iso = i + 1; // ⚠️ ISO: 1 = Monday. NOT JavaScript's getDay().
    const wrap = document.createElement('label');
    wrap.className = 'ing-day';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = String(iso);
    box.dataset.isoDay = String(iso);
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(box, text);
    ingRecurringDaysEl.appendChild(wrap);
  });

  const slot = document.getElementById('ingestion-recurring-add-slot');
  if (!slot) return;
  slot.appendChild(
    confirmBtn('Add blocker', 'quiet', () => {
      const days = [...ingRecurringDaysEl.querySelectorAll('input[type="checkbox"]')]
        .filter((b) => b.checked)
        .map((b) => Number(b.dataset.isoDay));
      // ⚠️ VALIDATED HERE FIRST so the owner is told before a round trip — and
      // validated AGAIN by the Worker, because a page is not a gate. The two
      // use the same sentences on purpose (see ingestion-time.js).
      const checked = validateRecurringWindow({
        days,
        from: ingRecurringFromInput?.value || '',
        until: ingRecurringUntilInput?.value || '',
      });
      if (checked.error) { setIngestionMsg(checked.error, 'warn'); return; }
      return sendIngestionControl(
        'recurring_add',
        undefined,
        `Adding ${recurringWindowWords(checked.window)}`,
        undefined,
        { window: checked.window },
      );
    }, 'warn'),
  );
}

function buildProcessEditor() {
  const slot = document.getElementById('ingestion-process-add-slot');
  if (slot) {
    slot.appendChild(
      confirmBtn('Add program', 'quiet', () => {
        const checked = validateExemptProcess(ingProcessInput?.value);
        if (checked.error) { setIngestionMsg(checked.error, 'warn'); return; }
        return sendIngestionControl(
          'exempt_add',
          undefined,
          `Adding ${checked.name}`,
          undefined,
          { process: checked.name },
        ).then(() => {
          // Cleared only after the attempt: a box that still held the name
          // would invite a second press, and the second press of an add is a
          // no-op that looks like a failure.
          if (ingProcessInput) ingProcessInput.value = '';
        });
      }, 'warn'),
    );
  }

  // ⚠️ THE QUICK-ADDS ARE SUGGESTIONS, NOT THE LIST. "Wow.exe" was read off
  // `tasklist` on the owner's own machine while the game ran (2026-09-01);
  // "WowClassic.exe" is the documented classic-client name and is NOT
  // verified. Either way the text box above takes anything — a list that only
  // held names this page knew about would be useless the first time he ran
  // something else.
  const quick = document.getElementById('ingestion-process-quickadd');
  if (!quick) return;
  const note = document.createElement('span');
  note.className = 'ing-quickadd-note';
  note.textContent = `Suggestions: ${processListWords(SUGGESTED_EXEMPT_PROCESSES)}`;
  quick.appendChild(note);
  for (const name of SUGGESTED_EXEMPT_PROCESSES) {
    quick.appendChild(
      confirmBtn(`+ ${name}`, 'quiet', () =>
        sendIngestionControl('exempt_add', undefined, `Adding ${name}`, undefined, { process: name }),
      'warn'),
    );
  }
}
/**
 * Deep-links to every OTHER run control, in the order an owner would reach
 * for them: platform deploys, the audiobook promote path, backups, then the
 * legacy per-catalog trigger. Each opens the real surface (GitHub Actions or
 * the audiobook admin page) rather than embedding it — those already have
 * their own auth, and this page holding none of their credentials is the
 * point (footer note).
 *
 * catalog-platform ships ONE "Deploy (manual)" workflow with a `target`
 * choice (index-worker | auth-worker | heygabi-home | all) rather than three
 * separate workflow files — GitHub's web UI has no way to pre-select a
 * workflow_dispatch input from a URL, so all three rows below land on the
 * same Actions page; the target is picked there, same as the owner already
 * does today.
 */
const RUN_LEVERS = [
  {
    label: 'Deploy — index-worker',
    url: 'https://github.com/skymitch9/catalog-platform/actions/workflows/deploy.yml',
    note: 'catalog-platform · "Deploy (manual)", target=index-worker',
  },
  {
    label: 'Deploy — auth-worker',
    url: 'https://github.com/skymitch9/catalog-platform/actions/workflows/deploy.yml',
    note: 'catalog-platform · "Deploy (manual)", target=auth-worker',
  },
  {
    label: 'Deploy — heygabi-home',
    url: 'https://github.com/skymitch9/catalog-platform/actions/workflows/deploy.yml',
    note: 'catalog-platform · "Deploy (manual)", target=heygabi-home (this page)',
  },
  {
    label: 'Backup',
    url: 'https://github.com/skymitch9/catalog-platform/actions/workflows/backup.yml',
    note: 'catalog-platform · "Backup (manual)"',
  },
  {
    label: 'Promote + Verify',
    url: 'https://github.com/skymitch9/audiobook_catalog/actions/workflows/promote-verified.yml',
    note: 'audiobook_catalog · dev → prod, verified after landing',
  },
  {
    label: 'Audiobook admin panel',
    url: 'https://audiobooks.heygabi.ai/admin',
    note: 'legacy per-catalog trigger — the same request doc as the button above, written from that page instead of here',
  },
];

function buildLeverList() {
  const ul = document.getElementById('lever-rows');
  for (const lever of RUN_LEVERS) {
    const li = document.createElement('li');
    li.className = 'lever-item';
    const a = document.createElement('a');
    a.href = lever.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = lever.label;
    const note = document.createElement('span');
    note.className = 'lever-note';
    note.textContent = lever.note;
    li.append(a, note);
    ul.appendChild(li);
  }
}

/**
 * After a successful trigger, poll faster than the standing cadence for a few
 * minutes so "watch the pipeline row" is actually true within a reasonable
 * wait — the home machine's watcher checks every ~3 min, so this covers one
 * full poll cycle with margin, then gets out of the way. Stops early the
 * moment the row itself reports "running".
 *
 * ⚠️ CHANGED IN THE 2026-08-18 MOVE, and this is the only line of behaviour
 * that did. It used to call the Health page's refreshAll(), which polled five
 * hosts to learn one thing. Here it polls the ONE document that answers the
 * question — cheaper, and it works on a page that has no Health rows to
 * refresh.
 */
const PICKUP_POLL_MS = 20_000;
const PICKUP_POLL_MAX_MS = 4 * 60_000;
let pickupTimer = null;

function watchForPickup() {
  if (pickupTimer) clearInterval(pickupTimer);
  const deadline = Date.now() + PICKUP_POLL_MAX_MS;
  pickupTimer = setInterval(async () => {
    if (Date.now() > deadline) {
      clearInterval(pickupTimer);
      pickupTimer = null;
      return;
    }
    const doc = await loadPipelineNow();
    if (doc && doc.state === 'running') {
      clearInterval(pickupTimer);
      pickupTimer = null;
    }
  }, PICKUP_POLL_MS);
}
// ---------------------------------------------------------------------------
// The full-pipeline Run button. Moved 2026-08-18 with everything else; its two
// element handles and message helper used to live in status.js's gate block,
// which stayed behind, so they are re-declared here — the ONE piece of this
// move that is retyped rather than relocated.
// ---------------------------------------------------------------------------

const opsRunBtn = document.getElementById('ops-run-pipeline');
const opsRunMsgEl = document.getElementById('ops-run-msg');

function setOpsRunMsg(text, tone) {
  if (!opsRunMsgEl) return;
  opsRunMsgEl.textContent = text || '';
  opsRunMsgEl.dataset.tone = tone || '';
}

opsRunBtn.addEventListener('click', async () => {
  const token = await idToken();
  if (!token) {
    setOpsRunMsg('Sign-in lapsed — sign in again.', 'warn');
    return;
  }
  opsRunBtn.disabled = true;
  setOpsRunMsg('Requesting…');
  try {
    const res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    let body = null;
    try { body = await res.json(); } catch { /* status still speaks */ }
    if (res.ok) {
      setOpsRunMsg(
        `${body?.detail || 'Requested.'} Watch the pipeline row at the top of this section — it flips to RUNNING on pickup.`,
        'ok',
      );
      watchForPickup();
    } else if (res.status === 503) {
      setOpsRunMsg(`Not configured yet (${body?.error || 'unset secret'}): ${body?.fix || ''}`, 'warn');
    } else if (res.status === 403) {
      setOpsRunMsg('You need the approver role to trigger a run. Ask an existing approver or an owner.', 'warn');
    } else {
      // §1e: never a bare HTTP status alone — say it failed, pass along the
      // server's own words when it gave any.
      setOpsRunMsg(`Something went wrong on the server${body?.error ? ` (${body.error})` : ''}. Try again shortly.`, 'warn');
    }
  } catch {
    setOpsRunMsg('The auth Worker did not answer (network). Try again shortly.', 'warn');
  } finally {
    opsRunBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// The devops gate + wiring
//
// ⚠️ THIS PAGE IS ALL CONTROL AND NO ANONYMOUS CONTENT, so the gate hides the
// whole Operations section and there is nothing behind it to leak. That is a
// deliberate difference from /status, which stays readable signed-out: a
// health board is worth seeing without an account; a room full of buttons is
// not.
// ---------------------------------------------------------------------------

const opsSectionEl = document.getElementById('ops-section');

const gate = mountGate({
  sections: [opsSectionEl],
  // ⚠️ IDEMPOTENT ON PURPOSE — the gate re-runs this on every auth event.
  // Each call is a re-read, never a re-build: everything whose existence does
  // not depend on the control document is constructed once at boot (below),
  // because rebuilding it here would silently reset confirmBtn's armed-state
  // timer under someone's finger. The ONE contextual button does depend on the
  // document, so renderPrimaryAction() owns it — and it too rebuilds only when
  // the answer actually changes, for the same reason.
  onAllowed: () => {
    loadIngestionControl();
    loadShelfUploadStatus();
    loadPipelineNow();
  },
});

buildPipelineNowSection();
buildIngestionCard();
buildPipelineStepsSection();
buildLeverList();
buildShelfUploadSection();
renderNightlyWindow();

setInterval(tickAll, TICK_INTERVAL_MS);

// The ingestion card has TWO clocks, and they are separate on purpose.
//
//   Every 5s, from memory: re-word the last reading. "Paused until 7:05 PM"
//   has to stop saying "paused" AT 7:05, and a card that only re-words when a
//   fetch happens to land would keep claiming a pause that had expired — the
//   same staleness the row ticker exists to prevent, on the one surface where
//   it would mislead an owner into pressing Resume on nothing.
//
//   Every 60s, over the network: re-read the document, so a pause set from the
//   phone (or by the home machine itself) shows up on a screen already open.
//   Visible tabs only.
setInterval(() => {
  if (ingestionKnown) renderIngestion(lastIngestionControl);
  // The window clock re-words on the same tick for the same reason: a card
  // that says "opens in 0h 1m" must not still say it a minute later.
  renderNightlyWindow();
}, TICK_INTERVAL_MS);

setInterval(() => {
  if (document.hidden || !gate.isAllowed()) return;
  loadIngestionControl();
  loadPipelineNow();
}, REFRESH_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gate.isAllowed()) {
    loadIngestionControl();
    loadPipelineNow();
  }
});
