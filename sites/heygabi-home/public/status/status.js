/**
 * status.js — the estate status page (owner ask, 2026-08-14: "I want to see
 * all the pipelines"). Reads five public health/reachability surfaces and
 * renders a quiet red/amber/green view. No sign-in anywhere on this page —
 * every endpoint it touches answers signed-out by design, and every payload
 * is counts and timestamps only (checked against each route's own source
 * before this page shipped; see index.html's header comment).
 *
 * Sections, each independent so one dead host cannot blank the others:
 *   1. Shared index  — one GET to index.heygabi.ai/api/health, three rows
 *      (audiobook/library/games) read out of its `sources` object.
 *   2. Book pipeline  — the audiobook sync pipeline's OWN two records, not
 *      inferred from the index push: `pipeline_status/current`, a Firestore
 *      document the pipeline's service account writes at every step and that
 *      firestore.rules makes public-read (`allow read: if true` — see
 *      audiobook_catalog/app/pipeline_status.py and firestore.rules), read
 *      here over the plain REST API (no SDK, no auth, same reasoning as
 *      every other row: a JSON GET this page can fetch signed-out); and
 *      `site/ebooks.json`, the ebook-lane manifest sync step 1b already
 *      publishes (CORS-open, `Access-Control-Allow-Origin: *`, verified live)
 *      with its own `generated_at` stamp. Both records existed before this
 *      page did — nothing here is invented, only read.
 *   3. Workers        — the index (reusing #1's fetch), library, games and
 *      estate-auth /api/health endpoints.
 *   4. Sites           — a no-cors reachability probe of the three catalog
 *      site roots plus the audiobook site's /dev/ lane (its own two-lane
 *      deploy — the apex itself has no such lane, deploy.md §4 is explicit
 *      that it deliberately does not copy that architecture).
 *
 * ⚠️ Reachability, not status codes: none of the four sites this page HEADs
 * send Access-Control-Allow-Origin (verified — Cloudflare Pages does not by
 * default), so a normal cross-origin fetch would reject before a status
 * code is ever visible to this page. `mode: 'no-cors'` sidesteps that: the
 * browser still makes the request and the promise still resolves once a
 * response arrives, but the response is opaque — no status, no body. That
 * is enough to tell "answered" from "did not answer," which is what the
 * Sites section claims and nothing more.
 *
 * ⚠️ Envelope normalization (estate item 5, 2026-08-14): all four
 * /api/health endpoints now answer `{ ok, service, version?, time, detail }`
 * with `detail` holding that worker's pre-existing fields verbatim, AND keep
 * every pre-existing top-level field too (additive transition — see each
 * repo's docs/info/health-envelope.md). `detailOf()` below prefers the new
 * `detail` nesting and falls back to the flat body, so this page keeps
 * working unchanged against a worker that has not redeployed yet, and
 * against a future deploy that drops the top-level duplicates.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';
import { actionBtn, confirmBtn } from '../assets/estate-controls.js';

const REFRESH_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 5_000;
const FETCH_TIMEOUT_MS = 8_000;

const INDEX_ORIGIN = 'https://index.heygabi.ai';
const LIBRARY_ORIGIN = 'https://library.heygabi.ai';
const GAMES_ORIGIN = 'https://boardgames.heygabi.ai';
const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const AUDIO_ORIGIN = 'https://audiobooks.heygabi.ai';

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
/** The ebook-lane manifest — sync step 1b's own output, CORS-open.
 *  ⚠️ TWO copies matter and they mean different things: the /dev/ lane is
 *  written by EVERY pipeline run with no human in the loop (so it is the
 *  honest signal for lane health), while the prod copy only moves when
 *  someone promotes (so its age measures promote cadence, not health). */
const EBOOKS_MANIFEST_DEV_URL = `${AUDIO_ORIGIN}/dev/ebooks.json`;
const EBOOKS_MANIFEST_PROD_URL = `${AUDIO_ORIGIN}/ebooks.json`;

/**
 * The standalone shelf-server force-upload's OWN status doc (owner ask
 * 2026-08-16) — deliberately separate from pipeline_status/current, same
 * public-read Firestore doc idiom as FIRESTORE_STATUS_URL above. Written by
 * audiobook_catalog's scripts/sync_to_server.py via
 * app/pipeline_status.py's force_upload_result().
 */
const SHELF_UPLOAD_STATUS_URL =
  'https://firestore.googleapis.com/v1/projects/audiobook-catalog/databases/(default)/documents/shelf_upload_status/current';

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
 * Per-source staleness thresholds for the shared index (design:
 * catalog-platform/docs/info/index-worker-design.md §5, §7 step 4).
 *
 * `audiobook` is OWNER-SPECIFIED, not a guess: the pipeline pushes on an 8h
 * cadence and its index push IS that pipeline's heartbeat, so amber/red are
 * "8h cadence + slack" exactly as asked.
 *
 * `library` and `games` are GUESSES, marked as such deliberately. Both push
 * on every catalog-mutating write PLUS a staleness backstop that rides
 * ordinary /api/* request traffic (at most once per isolate-hour, re-pushing
 * only past 24h stale — see library_catalog and Board_Game_Catalog
 * apps/worker/src/lib/index-push.ts). Neither catalog has a cron backing
 * this any more (the games cron backstop was retired 2026-08-13 for being
 * unobservable). That means an untouched app's index row can age
 * indefinitely without anything being wrong — nobody opened the app, so
 * nothing pushed, because nothing changed either. These thresholds are
 * therefore "worth a glance," not "certainly broken": chosen as the 24h
 * backstop ceiling plus slack for the hourly check granularity (amber), and
 * two full backstop cycles (red) — round numbers, not measurements.
 */
const INDEX_THRESHOLDS = {
  audiobook: {
    label: 'Audiobook',
    amberMs: 9 * 3600_000,
    redMs: 17 * 3600_000,
    note: 'See the Book pipeline section below for the pipeline’s own run status — this row is only its index push, a downstream effect of a successful run, not the run itself.',
    guess: false,
  },
  library: {
    label: 'Library',
    amberMs: 26 * 3600_000,
    redMs: 48 * 3600_000,
    note: 'GUESS — pushes on edit + a 24h backstop riding request traffic, no cron. A long age can mean "quiet," not "broken."',
    guess: true,
  },
  game: {
    label: 'Games',
    amberMs: 26 * 3600_000,
    redMs: 48 * 3600_000,
    note: 'GUESS — same push design as library (on-edit + a 24h traffic-riding backstop). Same caveat: quiet ≠ broken.',
    guess: true,
  },
};
/** Display order — matches the front door's Audio / Books / Games cards. */
const INDEX_SOURCE_ORDER = ['audiobook', 'library', 'game'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m ago` : `${h}h ago`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h ago` : `${d}d ago`;
}

/**
 * Envelope-aware accessor (see file header) — prefers `body.detail` (the new
 * envelope's unchanged nested copy of a worker's own fields), falls back to
 * the flat body itself for a worker still on the pre-envelope shape.
 */
function detailOf(body) {
  return body && body.detail ? body.detail : body;
}

/**
 * Decode one Firestore REST typed value (`{stringValue: "x"}`,
 * `{integerValue: "3"}`, `{mapValue: {fields: {...}}}`, …) into a plain JS
 * value. The REST API always wraps values this way; the JS SDK the admin
 * panel uses (site/pipeline-status.js) hides this same decoding inside
 * onSnapshot(), so this is the same document, just undecoded.
 */
function fsValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fsMap((v.mapValue && v.mapValue.fields) || {});
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fsValue);
  return null; // nullValue, or a type this page never needs to read
}
function fsMap(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = fsValue(fields[k]);
  return out;
}

/** GET JSON with a timeout. Never throws — the caller reads `.ok`. */
async function fetchJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON error body */ }
    return { reached: true, httpOk: res.ok, status: res.status, body };
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return { reached: false, error: timedOut ? 'timed out' : 'network error (offline, or CORS)' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A no-cors reachability probe — see the file header for why this is the
 * right (and only) tool for a site with no CORS headers. HEAD, never GET:
 * the audiobook site's root ships a multi-megabyte generated page, and a
 * HEAD costs nothing regardless of body size on either side of the check.
 */
async function probeReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    await fetch(url, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Row rendering — one shape shared by all three sections
// ---------------------------------------------------------------------------

/** Rows keep their DOM node + checked-at timestamp so the ticker (below)
 *  can update "checked Ns ago" without re-fetching anything. */
const rowRegistry = new Map(); // id -> { el, checkedAtEl, checkedAt }

function makeRow(id, name) {
  const li = document.createElement('li');
  li.className = 'row';
  li.dataset.state = 'pending';
  li.id = `row-${id}`;

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'row-body';

  const head = document.createElement('div');
  head.className = 'row-head';
  const nameEl = document.createElement('span');
  nameEl.className = 'row-name';
  nameEl.textContent = name;
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'checking…';
  head.append(nameEl, badge);

  const detail = document.createElement('p');
  detail.className = 'row-detail';
  detail.textContent = 'Checking…';

  const note = document.createElement('p');
  note.className = 'row-note';
  note.hidden = true;

  const checked = document.createElement('p');
  checked.className = 'row-checked';
  checked.textContent = '';

  body.append(head, detail, note, checked);
  li.append(dot, body);

  rowRegistry.set(id, { el: li, badgeEl: badge, detailEl: detail, noteEl: note, checkedEl: checked, checkedAt: null });
  return li;
}

const STATE_LABELS = { ok: 'OK', warn: 'WARN', danger: 'DOWN' };

function updateRow(id, state, detailText, noteText, checkedAt) {
  const row = rowRegistry.get(id);
  if (!row) return;
  row.el.dataset.state = state;
  row.badgeEl.textContent = STATE_LABELS[state] || state;
  row.detailEl.textContent = detailText;
  if (noteText) {
    row.noteEl.textContent = noteText;
    row.noteEl.hidden = false;
  } else {
    row.noteEl.hidden = true;
  }
  row.checkedAt = checkedAt;
  tickRow(id);
}

function tickRow(id) {
  const row = rowRegistry.get(id);
  if (!row || row.checkedAt == null) return;
  row.checkedEl.textContent = `checked ${formatAge(Date.now() - row.checkedAt)}`;
}

function tickAll() {
  for (const id of rowRegistry.keys()) tickRow(id);
}

// ---------------------------------------------------------------------------
// Section builders (called once, at boot)
// ---------------------------------------------------------------------------

function buildIndexSection() {
  const ul = document.getElementById('index-rows');
  for (const key of INDEX_SOURCE_ORDER) {
    ul.appendChild(makeRow(`idx-${key}`, INDEX_THRESHOLDS[key].label));
  }
}

/** 8h Task Scheduler cadence (00:00/08:00/16:00 local) — same amber/red
 *  thresholds INDEX_THRESHOLDS.audiobook already used for the index push,
 *  now applied to the pipeline's own timestamps instead of a downstream one. */
const PIPELINE_AMBER_MS = 9 * 3600_000;
const PIPELINE_RED_MS = 17 * 3600_000;
const PIPELINE_CADENCE_MS = 8 * 3600_000;
/** Mirrors site/pipeline-status.js isStale() — a "running" doc whose
 *  heartbeat stopped updating probably means the process died, not that a
 *  15-minute step is in progress. */
const PIPELINE_STALE_RUNNING_MS = 15 * 60_000;

function buildPipelineSection() {
  const ul = document.getElementById('pipeline-rows');
  ul.appendChild(makeRow('pipe-audio', 'Automated Book Pipeline'));
  ul.appendChild(makeRow('pipe-ebook', 'Ebook lane'));
}

function buildWorkerSection() {
  const ul = document.getElementById('worker-rows');
  ul.appendChild(makeRow('wk-index', 'Shared index (index.heygabi.ai)'));
  ul.appendChild(makeRow('wk-library', 'Library (library.heygabi.ai)'));
  ul.appendChild(makeRow('wk-games', 'Games (boardgames.heygabi.ai)'));
  ul.appendChild(makeRow('wk-auth', 'Estate auth (auth.heygabi.ai)'));
}

function buildSiteSection() {
  const ul = document.getElementById('site-rows');
  ul.appendChild(makeRow('site-audio', 'Audio (audiobooks.heygabi.ai)'));
  ul.appendChild(makeRow('site-audio-dev', 'Audio — /dev/ lane'));
  ul.appendChild(makeRow('site-library', 'Books (library.heygabi.ai)'));
  ul.appendChild(makeRow('site-games', 'Games (boardgames.heygabi.ai)'));
}

// ---------------------------------------------------------------------------
// Refresh — one pass touches all three sections, independently per row
// ---------------------------------------------------------------------------

function renderIndexSection(fetchResult, now) {
  const detail = fetchResult.body ? detailOf(fetchResult.body) : null;
  if (!fetchResult.reached || !fetchResult.httpOk || !detail || !detail.sources) {
    for (const key of INDEX_SOURCE_ORDER) {
      updateRow(`idx-${key}`, 'danger', `index.heygabi.ai did not answer (${fetchResult.error || `HTTP ${fetchResult.status}`}).`, null, now);
    }
    return;
  }
  const sources = detail.sources;
  for (const key of INDEX_SOURCE_ORDER) {
    const cfg = INDEX_THRESHOLDS[key];
    const src = sources[key];
    if (!src || !src.pushed_at || !src.rows) {
      // "zero rows from a source means the push failed, never that the
      // collection is empty" — index-worker-design.md §1. Never silent.
      updateRow(`idx-${key}`, 'danger', `${cfg.label}: 0 rows / never pushed.`, cfg.note, now);
      continue;
    }
    const pushedAt = Date.parse(src.pushed_at);
    const ageMs = now - pushedAt;
    const state = ageMs > cfg.redMs ? 'danger' : ageMs > cfg.amberMs ? 'warn' : 'ok';
    const rowsText = src.rows.toLocaleString();
    updateRow(`idx-${key}`, state, `${rowsText} rows · pushed ${formatAge(ageMs)}`, cfg.note, now);
  }
}

function renderIndexWorkerRow(fetchResult, now) {
  if (!fetchResult.reached || !fetchResult.httpOk || !fetchResult.body) {
    updateRow('wk-index', 'danger', `Did not answer (${fetchResult.error || `HTTP ${fetchResult.status}`}).`, null, now);
    return;
  }
  const sources = detailOf(fetchResult.body).sources || {};
  const total = Object.values(sources).reduce((sum, s) => sum + (s && s.rows ? s.rows : 0), 0);
  const ok = fetchResult.body.ok !== false;
  updateRow('wk-index', ok ? 'ok' : 'danger', `Reachable · ${total.toLocaleString()} rows across 3 sources.`, null, now);
}

function renderWorkerHealthRow(id, name, fetchResult, now, detailFn) {
  if (!fetchResult.reached) {
    updateRow(id, 'danger', `${name} did not answer (${fetchResult.error}).`, null, now);
    return;
  }
  if (!fetchResult.body) {
    updateRow(id, 'danger', `${name} answered HTTP ${fetchResult.status} with no readable body.`, null, now);
    return;
  }
  // `ok` is deliberately read off the raw body, not detailOf(): every worker
  // keeps `ok` at the top level in both the envelope and the legacy shape,
  // and the envelope's `ok` is the one meant to win once fallback fields
  // are eventually dropped.
  const ok = fetchResult.body.ok === true;
  updateRow(id, ok ? 'ok' : 'danger', detailFn(detailOf(fetchResult.body)), null, now);
}

/**
 * Audiobook pipeline row — reads pipeline_status/current straight, no
 * inference. The page cannot see Task Scheduler's NEXT run (it is a local
 * job on the home machine, not a public endpoint), so this shows the last
 * recorded run plus a cadence-based estimate, clearly labeled as such.
 */
function renderPipelineAudioRow(fetchResult, now) {
  if (!fetchResult.reached) {
    updateRow('pipe-audio', 'danger', `Did not answer (${fetchResult.error}).`,
      'firestore.googleapis.com unreachable — cannot read the pipeline heartbeat.', now);
    return;
  }
  if (fetchResult.status === 404) {
    updateRow('pipe-audio', 'warn', 'No runs recorded yet.',
      'pipeline_status/current has never been written — either a fresh clone or the home machine has no service-account credentials configured.', now);
    return;
  }
  if (!fetchResult.httpOk || !fetchResult.body || !fetchResult.body.fields) {
    updateRow('pipe-audio', 'danger', `Firestore answered HTTP ${fetchResult.status} with no readable status doc.`, null, now);
    return;
  }

  const status = fsMap(fetchResult.body.fields);
  const startedAt = Date.parse(status.startedAt || '');
  const updatedAt = Date.parse(status.updatedAt || '');
  const finishedAt = Date.parse(status.finishedAt || '');
  const stale = status.state === 'running' && Number.isFinite(updatedAt)
    && (now - updatedAt) > PIPELINE_STALE_RUNNING_MS;

  if (status.state === 'running' && !stale) {
    const step = status.stepLabel ? ` · ${status.stepLabel}` : '';
    updateRow('pipe-audio', 'ok', `RUNNING${step} · started ${formatAge(now - startedAt)}`,
      '8h Task Scheduler cadence (00/08/16 local) — mid-run, so the freshness check below does not apply yet.', now);
    return;
  }

  // Finished (success/partial/failed) or a stale "running" doc with a dead
  // heartbeat — either way, age it against the same cadence as the index row.
  const anchor = Number.isFinite(finishedAt) ? finishedAt : updatedAt;
  const ageMs = now - anchor;
  const outcome = stale ? 'NO HEARTBEAT' : (status.state || 'unknown').toUpperCase();
  let state = ageMs > PIPELINE_RED_MS ? 'danger' : ageMs > PIPELINE_AMBER_MS ? 'warn' : 'ok';
  if (stale || status.state === 'failed') state = 'danger';
  else if (status.state === 'partial' && state === 'ok') state = 'warn';

  const summary = status.summary || {};
  const bits = [];
  if (summary.idle) bits.push('nothing new to upload');
  if (summary.uploaded) bits.push(`${summary.uploaded} uploaded`);
  if (summary.books) bits.push(`${summary.books} books`);
  const summaryText = bits.length ? ` · ${bits.join(' · ')}` : '';

  let nextText = '';
  if (Number.isFinite(anchor)) {
    const dueAt = anchor + PIPELINE_CADENCE_MS;
    const clock = new Date(dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    nextText = dueAt > now
      ? ` Next run expected ~${clock} (cadence estimate only — this page cannot see Task Scheduler).`
      : ` Next run is overdue by this cadence estimate — Task Scheduler itself is not visible to this page, so confirm on the machine before assuming a miss.`;
  }

  updateRow(
    'pipe-audio', state,
    `${outcome} · ${formatAge(ageMs)}${summaryText}`,
    `${stale ? 'No heartbeat for over 15 minutes on a run marked running — it may have been interrupted. ' : ''}` +
      `Amber past 9h, red past 17h since last finish, same thresholds as the index row above.${nextText}`,
    now,
  );
}

/**
 * Ebook lane row.
 *
 * ⚠️ REWRITTEN 2026-08-16 (owner: "i want it to be green if things are good
 * or ill never trust the colors"). The old logic aged
 * `ebooks.json:generated_at` against WALL CLOCK with the same 9h/17h
 * thresholds as the pipeline row, and went amber/red while everything was
 * perfectly healthy. Two measured reasons it was structurally wrong:
 *
 *   1. `scripts/build_ebook_manifest.py` rewrites `generated_at` on EVERY
 *      run unconditionally (line ~185, `datetime.now(timezone.utc)`), so the
 *      stamp says "when the pipeline last ran", never "how fresh the ebook
 *      data is". Ageing it measures cadence, not health.
 *   2. The PROD copy only changes when someone PROMOTES. So on prod the age
 *      was really "time since last promote" — a manual, irregular act. A row
 *      that goes red because nobody promoted overnight trains you to ignore
 *      red, which is exactly what the owner said.
 *
 * So the row now asks the only question that means anything: **did the
 * ebook step keep up with the pipeline's own last run?** The `/dev/` lane is
 * the honest source for that — the pipeline commits there every run with no
 * human in the loop. Green = the lane produced a manifest for the most
 * recent run. Amber = the pipeline ran and the ebook step did NOT produce
 * (a real fault). Prod lag is reported as a NOTE, never as a colour, because
 * "not promoted yet" is a normal state, not a failure.
 */
function renderPipelineEbookRow(devResult, prodResult, pipelineResult, now) {
  if (!devResult.reached || !devResult.httpOk || !devResult.body) {
    updateRow('pipe-ebook', 'danger', `Did not answer (${devResult.error || `HTTP ${devResult.status}`}).`, null, now);
    return;
  }
  const body = devResult.body;
  const generatedAt = Date.parse(body.generated_at || '');
  if (!Number.isFinite(generatedAt) || typeof body.count !== 'number') {
    updateRow('pipe-ebook', 'danger', 'ebooks.json answered with no generated_at/count — manifest shape changed.', null, now);
    return;
  }

  // The pipeline's own last run, from the same Firestore doc the row above
  // reads. Without it we cannot judge "kept up", so fall back to reporting
  // the facts uncoloured rather than inventing a verdict.
  const pipeStatus = pipelineResult?.body?.fields ? fsMap(pipelineResult.body.fields) : null;
  const startedAt = pipeStatus ? Date.parse(pipeStatus.startedAt || '') : NaN;

  let state = 'ok';
  let detail = `${body.count.toLocaleString()} ebooks · manifest from the last pipeline run`;

  if (Number.isFinite(startedAt)) {
    // Slack: the ebook step runs a little after the run starts, and clocks
    // differ slightly between the pipeline host and this browser.
    const keptUp = generatedAt >= startedAt - 15 * 60_000;
    if (!keptUp) {
      state = 'warn';
      detail =
        `${body.count.toLocaleString()} ebooks · ⚠️ manifest is OLDER than the last pipeline run ` +
        `(manifest ${formatAge(now - generatedAt)}, run ${formatAge(now - startedAt)}) — the ebook step did not produce`;
    }
  } else {
    detail += ` (${formatAge(now - generatedAt)})`;
  }

  // Prod lag: information, never colour. Promoting is a deliberate human act.
  let note =
    'Green means the ebook step kept up with the pipeline’s own last run — not wall-clock freshness, which only measured how long ago anyone promoted.';
  const prodStamp = prodResult?.body ? Date.parse(prodResult.body.generated_at || '') : NaN;
  if (Number.isFinite(prodStamp) && Number.isFinite(generatedAt) && prodStamp < generatedAt - 60_000) {
    note += ` Prod is ${formatAge(generatedAt - prodStamp)} behind /dev/ — normal until the next promote.`;
  }

  updateRow('pipe-ebook', state, detail, note, now);
}

function renderSiteRow(id, name, reached, now) {
  updateRow(id, reached ? 'ok' : 'danger', reached ? 'Reachable.' : 'Did not answer within 8s.', null, now);
}

let refreshing = false;
/** The last decoded pipeline_status/current doc (fsMap() output), or null.
 * Feeds renderPipelineStepsAvailability() — the pipeline-step interlock —
 * without a second fetch, since refreshAll() already reads this doc every
 * cycle for the "Book pipeline" row above. */
let lastPipelineStatusDoc = null;

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.classList.add('spinning');

  const now = () => Date.now();

  const [indexHealth, libraryHealth, gamesHealth, authHealth, audioUp, audioDevUp, libraryUp, gamesUp, pipelineStatus, ebooksDev, ebooksProd] =
    await Promise.all([
      fetchJSON(`${INDEX_ORIGIN}/api/health`),
      fetchJSON(`${LIBRARY_ORIGIN}/api/health`),
      fetchJSON(`${GAMES_ORIGIN}/api/health`),
      fetchJSON(`${AUTH_ORIGIN}/api/health`),
      probeReachable(AUDIO_ORIGIN + '/'),
      probeReachable(AUDIO_ORIGIN + '/dev/'),
      probeReachable(LIBRARY_ORIGIN + '/'),
      probeReachable(GAMES_ORIGIN + '/'),
      fetchJSON(FIRESTORE_STATUS_URL),
      fetchJSON(EBOOKS_MANIFEST_DEV_URL),
      fetchJSON(EBOOKS_MANIFEST_PROD_URL),
    ]);

  const t = now();

  renderIndexSection(indexHealth, t);
  renderIndexWorkerRow(indexHealth, t);
  renderPipelineAudioRow(pipelineStatus, t);
  renderPipelineEbookRow(ebooksDev, ebooksProd, pipelineStatus, t);

  // Feed the pipeline-step interlock (see stepDisabledReason()) from the
  // same doc the row above just read — no extra fetch. null when the doc
  // is missing/unreadable, same "fail open, not busy" stance as the
  // server-side checkPipelineBusy() in ops.ts.
  lastPipelineStatusDoc =
    pipelineStatus.reached && pipelineStatus.httpOk && pipelineStatus.body?.fields
      ? fsMap(pipelineStatus.body.fields)
      : null;
  if (opsIsApprover) renderPipelineStepsAvailability(lastPipelineStatusDoc);
  renderWorkerHealthRow('wk-library', 'Library', libraryHealth, t, (b) =>
    `v${b.version || '?'} · database ${b.database || '?'}${b.universes ? ` · ${b.universes.count} universes` : ''}`);
  renderWorkerHealthRow('wk-games', 'Games', gamesHealth, t, (b) =>
    `v${b.version || '?'} · database ${b.database || '?'}`);
  renderWorkerHealthRow('wk-auth', 'Estate auth', authHealth, t, (b) => {
    const u = b.users || {};
    return `${u.approved ?? '?'} approved · ${u.pending ?? '?'} pending · ${u.revoked ?? '?'} revoked · ${u.approvers ?? '?'} approvers`;
  });

  renderSiteRow('site-audio', 'Audio', audioUp, t);
  renderSiteRow('site-audio-dev', 'Audio /dev/', audioDevUp, t);
  renderSiteRow('site-library', 'Books', libraryUp, t);
  renderSiteRow('site-games', 'Games', gamesUp, t);

  const rows = [...rowRegistry.values()];
  const okCount = rows.filter((r) => r.el.dataset.state === 'ok').length;
  const warnCount = rows.filter((r) => r.el.dataset.state === 'warn').length;
  const dangerCount = rows.filter((r) => r.el.dataset.state === 'danger').length;
  document.getElementById('summary').textContent =
    `Estate status refreshed: ${okCount} ok, ${warnCount} warnings, ${dangerCount} down, out of ${rows.length} checks.`;

  btn.disabled = false;
  btn.classList.remove('spinning');
  refreshing = false;
}

// ---------------------------------------------------------------------------
// Operations — signed-in approvers only. Everything above this point is
// untouched and stays anonymous; this block only ever REVEALS #ops-section,
// never removes anything from the read-only rows. See index.html's header
// comment for the full design note.
// ---------------------------------------------------------------------------

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
 * Backups row — GET /api/estate/backups (requireDevops()), added 2026-08-16
 * for the "is the backup workflow actually still running" gap: nothing
 * before this surfaced whether a silently-dead backup workflow was
 * invisible or not, which is exactly the failure this row exists to catch.
 *
 * ⚠️ THRESHOLDS ARE CALENDAR-BASED, DELIBERATELY, UNLIKE THE PIPELINE ROWS
 * ABOVE. `.github/workflows/backup.yml` is `workflow_dispatch`-only — no
 * cron, no expected cadence — so there is no "did it keep up with X" signal
 * to measure against the way renderPipelineEbookRow() measures the ebook
 * lane against the pipeline's own last run (see that function's header for
 * the incident this row deliberately does NOT repeat: aging a MANUAL act
 * against a threshold that implied an AUTOMATIC cadence, which went
 * amber/red while genuinely healthy). A backup's own age IS the right thing
 * to measure here — the question this row answers is "how much would the
 * estate lose if disaster struck right now," which is a real, wall-clock
 * question regardless of how the last backup was triggered. What must stay
 * honest is the LABEL: every state below says outright that the trigger is
 * manual, so a long age reads as "nobody has run it in a while" first and
 * "something is broken" only past a wide margin — 14 days amber (worth a
 * glance), 45 days red (six-plus weeks with no fresh copy of the estate's
 * data is a real risk regardless of intent). Both are round numbers, not
 * measurements — there is no historical cadence to derive them from yet.
 */
const BACKUP_AMBER_MS = 14 * 24 * 3600_000;
const BACKUP_RED_MS = 45 * 24 * 3600_000;
const BACKUP_MANUAL_NOTE =
  'Backups run on manual dispatch only (no cron) — a long age can mean nobody has run it recently, ' +
  // "above", not "below": the lever list lives inside Operations, which
  // renders BEFORE the Backups section — the original wording pointed the
  // wrong way even before the 2026-08-16 move up under Pipeline steps.
  'not that anything is broken. Run it from the "Backup" row in Run levers ' +
  '(Operations, above) if it has been a while.';

function buildBackupsSection() {
  const ul = document.getElementById('backups-rows');
  ul.appendChild(makeRow('backup-age', 'Estate backups (estate-backups R2)'));
}

async function loadBackups() {
  const token = await idToken();
  if (!token) return; // no live session yet — probeOpsApprover() retries on the next auth event
  const now = Date.now();
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/backups`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    updateRow('backup-age', 'danger', 'The auth Worker did not answer (network).', BACKUP_MANUAL_NOTE, now);
    return;
  }
  if (res.status === 401 || res.status === 403) {
    // Should not happen once opsIsApprover is true (same token, same gate
    // tier as /me), but never show a stale row silently if it does.
    updateRow('backup-age', 'danger', 'Not authorized to read backup metadata.', null, now);
    return;
  }
  if (!res.ok) {
    updateRow('backup-age', 'danger', `The backups endpoint answered HTTP ${res.status}.`, BACKUP_MANUAL_NOTE, now);
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    updateRow('backup-age', 'danger', 'The backups answer was unreadable.', BACKUP_MANUAL_NOTE, now);
    return;
  }

  const prefixes = body.prefixes || {};
  const missing = Object.keys(prefixes).filter((k) => prefixes[k].count === 0);
  const newestOverall = body.newest_overall ? Date.parse(body.newest_overall) : NaN;

  if (!Number.isFinite(newestOverall)) {
    updateRow(
      'backup-age', 'danger', 'No backup has ever been captured.',
      `${BACKUP_MANUAL_NOTE} This bucket has never received an object of any kind.`, now,
    );
    return;
  }

  const ageMs = now - newestOverall;
  const state = ageMs > BACKUP_RED_MS ? 'danger' : ageMs > BACKUP_AMBER_MS ? 'warn' : 'ok';
  const total = Object.values(prefixes).reduce((sum, p) => sum + (p.count || 0), 0);
  let note = BACKUP_MANUAL_NOTE;
  if (missing.length) {
    note += ` Never captured yet: ${missing.join(', ')}.`;
  }
  updateRow('backup-age', state, `Newest backup ${formatAge(ageMs)} · ${total} object${total === 1 ? '' : 's'} across ${Object.keys(prefixes).length} stores.`, note, now);
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
      setStepsMessage(`${body?.detail || 'Requested.'} Watch the Pipeline row above.`, 'ok');
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
    updateRow('shelf-upload', 'warn', 'Never run yet.', 'Use the button above once the shelf server exists (see /runbooks/shelf/).', now);
    return;
  }
  if (!result.reached || !result.httpOk || !result.body || !result.body.fields) {
    updateRow('shelf-upload', 'danger', `Did not answer (${result.error || `HTTP ${result.status}`}).`, null, now);
    return;
  }
  const doc = fsMap(result.body.fields);
  const state = SHELF_STATE_LABELS[doc.state] || 'warn';
  updateRow('shelf-upload', state, `${(doc.state || 'unknown').toUpperCase()} — ${doc.message || ''}`, doc.updatedAt ? `Last attempt: ${doc.updatedAt}` : null, now);
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

const opsSigninBtn = document.getElementById('ops-signin');
const opsWhoEl = document.getElementById('ops-who');
const opsNoteEl = document.getElementById('ops-note');
const opsSectionEl = document.getElementById('ops-section');
const opsRunBtn = document.getElementById('ops-run-pipeline');
const opsRunMsgEl = document.getElementById('ops-run-msg');
// Server migration section (2026-08-15) — same gate, same probe, one more box.
const migrationSectionEl = document.getElementById('migration-section');
const commandmentsSectionEl = document.getElementById('commandments-section');
// Backups section (2026-08-16) — same gate; its row is fetched separately
// (loadBackups()) since it is its own endpoint, not part of /me.
const backupsSectionEl = document.getElementById('backups-section');

let opsCurrentUser = null;
let opsIsApprover = false;
let opsApproverCheckedFor = null; // uid the last /me probe ran for

function setOpsNote(text, tone) {
  opsNoteEl.textContent = text || '';
  opsNoteEl.dataset.tone = tone || '';
  opsNoteEl.hidden = !text;
}

function setOpsRunMsg(text, tone) {
  opsRunMsgEl.textContent = text || '';
  opsRunMsgEl.dataset.tone = tone || '';
}

/**
 * GET /api/estate/me with the caller's own ID token — the same gate find.js
 * uses for the /admin link (a 200-shaped fact, not a client-side guess), but
 * reading `is_approver` directly since /me answers it without a second call.
 * Never throws: a failed probe leaves the section hidden, which is the safe
 * default (fail closed on a control surface, unlike a read-only status row).
 */
async function probeOpsApprover() {
  const uid = opsCurrentUser?.uid;
  if (!uid || opsApproverCheckedFor === uid) return;
  opsApproverCheckedFor = uid;
  const token = await idToken();
  if (!token) return;
  try {
    const res = await fetch(`${AUTH_ORIGIN}/api/estate/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      opsIsApprover = false;
    } else {
      const body = await res.json();
      // is_devops is EFFECTIVE from /me (approver ⇒ true), so this one field
      // is the whole answer — owner order 2026-08-15: the devops role drives
      // this page. Older worker deploys lack the field; is_approver keeps
      // approvers working across that skew.
      opsIsApprover = body?.is_devops === true || body?.is_approver === true;
    }
  } catch {
    opsIsApprover = false;
  }
  if (opsCurrentUser?.uid === uid) renderOpsAuthState();
}

function renderOpsAuthState() {
  const signedIn = opsCurrentUser !== null;
  opsSigninBtn.hidden = signedIn;
  opsWhoEl.hidden = !signedIn;

  if (!signedIn) {
    opsWhoEl.innerHTML = '';
    opsSectionEl.hidden = true;
    migrationSectionEl.hidden = true;
    commandmentsSectionEl.hidden = true;
    backupsSectionEl.hidden = true;
    setOpsNote('');
    return;
  }

  opsWhoEl.innerHTML = '';
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'linkbtn';
  out.textContent = 'sign out';
  out.addEventListener('click', async () => {
    await signOutUser();
  });
  opsWhoEl.append(`Signed in as ${opsCurrentUser.displayName || opsCurrentUser.email} · `, out);

  if (opsApproverCheckedFor !== opsCurrentUser.uid) {
    setOpsNote('Checking access…');
    opsSectionEl.hidden = true;
    migrationSectionEl.hidden = true;
    commandmentsSectionEl.hidden = true;
    backupsSectionEl.hidden = true;
    return;
  }

  if (opsIsApprover) {
    setOpsNote('');
    opsSectionEl.hidden = false;
    migrationSectionEl.hidden = false;
    commandmentsSectionEl.hidden = false;
    backupsSectionEl.hidden = false;
    loadBackups();
    loadShelfUploadStatus();
    // Interlock state may already be known from the last refreshAll() pass
    // (the ops section can reveal well after boot); render it immediately
    // instead of waiting up to 60s for the next tick.
    renderPipelineStepsAvailability(lastPipelineStatusDoc);
  } else {
    opsSectionEl.hidden = true;
    migrationSectionEl.hidden = true;
    commandmentsSectionEl.hidden = true;
    backupsSectionEl.hidden = true;
    setOpsNote(
      'Signed in, but this account holds neither devops nor admin — Operations stays hidden. ' +
        'An admin can grant devops from /admin ("Make devops").',
      'warn',
    );
  }
}

/**
 * After a successful trigger, poll faster than the standing 60s cadence for
 * a few minutes so "watch the Pipeline row" is actually true within a
 * reasonable wait — the home machine's watcher checks every ~3 min, so this
 * covers one full poll cycle with margin, then gets out of the way. Stops
 * early the moment the row itself reports "running".
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
    await refreshAll();
    const row = document.getElementById('row-pipe-audio');
    if (row && /^RUNNING/.test(row.querySelector('.row-detail')?.textContent || '')) {
      clearInterval(pickupTimer);
      pickupTimer = null;
    }
  }, PICKUP_POLL_MS);
}

opsSigninBtn.addEventListener('click', async () => {
  opsSigninBtn.disabled = true;
  const r = await signIn();
  opsSigninBtn.disabled = false;
  if (r.error) setOpsNote(r.error, 'warn');
});

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
        `${body?.detail || 'Requested.'} Watch the Pipeline row below — it flips to RUNNING on pickup.`,
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

watchAuth((user) => {
  const changed = opsCurrentUser?.uid !== user?.uid;
  opsCurrentUser = user;
  if (!user) {
    opsIsApprover = false;
    opsApproverCheckedFor = null;
  }
  renderOpsAuthState();
  if (user && changed) probeOpsApprover();
});

handleRedirectResult().then((err) => {
  if (err) setOpsNote(err, 'warn');
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

buildIndexSection();
buildPipelineSection();
buildWorkerSection();
buildSiteSection();
buildLeverList();
buildBackupsSection();
buildPipelineStepsSection();
buildShelfUploadSection();

document.getElementById('refresh').addEventListener('click', () => refreshAll());

refreshAll();
setInterval(tickAll, TICK_INTERVAL_MS);

// Auto-refresh every 60s, but only while the tab is actually visible — a
// backgrounded tab gains nothing from polling five hosts, and refreshing
// once immediately on return keeps the numbers from reading stale.
setInterval(() => { if (!document.hidden) refreshAll(); }, REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAll();
});
