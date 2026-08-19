/**
 * pipelines.js — /status/pipelines, RUN + CONTROL.
 *
 * ⚠️ EVERY CONTROL IN THIS FILE MOVED HERE FROM status.js ON 2026-08-18, in
 * the four-page split (docs/info/status-pages.md). The ingestion pause card,
 * the Run button, the seven pipeline steps and their interlock, the Run levers
 * and the shelf-server force-upload are the SAME implementations, moved rather
 * than rewritten — their comments are the originals and are worth reading as
 * such. Their tests did not move and did not change:
 * `scripts/test/ingestion-time.test.mjs` (23) and
 * `apps/auth-worker/test/ingestion-control.test.ts` (14) still own the
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
  describeIngestion,
  isoToPhoenixLocal,
  phoenixLocalToIso,
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

    li.append(main, btn, reason);
    ul.appendChild(li);
    stepRowRegistry.set(step.key, { li, btn, reasonEl: reason });
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

/** Called every refresh — updates disabled state + reason text without
 * recreating the buttons (which would lose confirmBtn's armed-state timer). */
function renderPipelineStepsAvailability(statusDoc) {
  for (const step of PIPELINE_STEPS) {
    const row = stepRowRegistry.get(step.key);
    if (!row) continue;
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
// ⚠️ SAME TWO-TAP GRAMMAR, NO THIRD GESTURE. All four controls are
// confirmBtn (assets/estate-controls.js). The pickers are inputs, not
// commits: a typed time does nothing at all until its "Set" button is armed
// and tapped a second time.
// ---------------------------------------------------------------------------

const ingStatusEl = document.getElementById('ingestion-status');
const ingHeadlineEl = document.getElementById('ingestion-headline');
const ingLinesEl = document.getElementById('ingestion-lines');
const ingMsgEl = document.getElementById('ingestion-msg');
const ingPauseUntilInput = document.getElementById('ingestion-pause-until');
const ingDontCheckInput = document.getElementById('ingestion-dont-check');

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
  p.textContent = `${detail} The buttons below still work — this is only the reading.`;
  ingLinesEl.appendChild(p);
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
async function sendIngestionControl(action, until, verb) {
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
      body: JSON.stringify(until ? { action, until } : { action }),
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

function buildIngestionCard() {
  const holder = document.getElementById('ingestion-buttons');
  if (!holder) return;

  holder.appendChild(
    confirmBtn('Pause now', 'quiet', () => sendIngestionControl('pause', undefined, 'Pausing'), 'warn'),
  );
  holder.appendChild(
    confirmBtn('Resume', 'quiet', () => sendIngestionControl('resume', undefined, 'Resuming')),
  );

  // ⚠️ "START NOW" IS NOT A SECOND RESUME BUTTON (owner-approved fine control
  // #2, 2026-08-18). Both clear the pause flag, the pause timer and the
  // don't-check timer. RESUME additionally drops a scheduled window that is in
  // force right now — it has to, or the window re-pauses ingestion seconds
  // later and Resume reads as broken. START NOW leaves `pause_windows`
  // completely untouched: quiet hours are a schedule the owner set on purpose,
  // and silently deleting tonight's 7pm window to satisfy a one-off request
  // would take away a recurring instruction he never withdrew.
  //
  // ⚠️ THE CONSEQUENCE IS ADMITTED RATHER THAN HIDDEN: inside a live window
  // this clears the ad-hoc pauses and the window STILL blocks the start. The
  // route's own wording says so and lands in the message line below, so the
  // owner reads it at the moment it matters instead of wondering why nothing
  // started. A control that hid that would be promising a run it cannot
  // deliver, which is the failure this page exists to end.
  holder.appendChild(
    confirmBtn(
      '▶ Start now',
      'quiet',
      () => sendIngestionControl('start_now', undefined, 'Clearing the pauses'),
      'warn',
    ),
  );

  const pauseSlot = document.getElementById('ingestion-pause-until-slot');
  if (pauseSlot) {
    pauseSlot.appendChild(
      confirmBtn('Set pause', 'quiet', () => {
        const r = readPhoenixPicker(ingPauseUntilInput, 'the pause');
        if (r.error) { setIngestionMsg(r.error, 'warn'); return; }
        return sendIngestionControl('pause_until', r.iso, `Pausing until ${wordTime(r.iso, Date.now())}`);
      }, 'warn'),
    );
  }

  const dontSlot = document.getElementById('ingestion-dont-check-slot');
  if (dontSlot) {
    dontSlot.appendChild(
      confirmBtn('Set check time', 'quiet', () => {
        const r = readPhoenixPicker(ingDontCheckInput, 'the check time');
        if (r.error) { setIngestionMsg(r.error, 'warn'); return; }
        return sendIngestionControl('dont_check_until', r.iso, `Holding off until ${wordTime(r.iso, Date.now())}`);
      }, 'warn'),
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
  // Each call is a re-read, never a re-build: the buttons are constructed once
  // at boot (below), because rebuilding them here would silently reset
  // confirmBtn's armed-state timer under someone's finger.
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
