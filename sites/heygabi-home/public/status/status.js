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
/** The ebook-lane manifest — sync step 1b's own output, CORS-open. */
const EBOOKS_MANIFEST_URL = `${AUDIO_ORIGIN}/ebooks.json`;

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
  ul.appendChild(makeRow('pipe-audio', 'Audiobook pipeline'));
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

/** Ebook lane row — freshness + size of site/ebooks.json only. No
 *  import-outcome signal is exposed by library_catalog's worker today
 *  (checked: no stored last-import status route exists there), so this row
 *  does not claim one rather than inventing a number. */
function renderPipelineEbookRow(fetchResult, now) {
  if (!fetchResult.reached || !fetchResult.httpOk || !fetchResult.body) {
    updateRow('pipe-ebook', 'danger', `Did not answer (${fetchResult.error || `HTTP ${fetchResult.status}`}).`, null, now);
    return;
  }
  const body = fetchResult.body;
  const generatedAt = Date.parse(body.generated_at || '');
  if (!Number.isFinite(generatedAt) || typeof body.count !== 'number') {
    updateRow('pipe-ebook', 'danger', 'ebooks.json answered with no generated_at/count — manifest shape changed.', null, now);
    return;
  }
  const ageMs = now - generatedAt;
  const state = ageMs > PIPELINE_RED_MS ? 'danger' : ageMs > PIPELINE_AMBER_MS ? 'warn' : 'ok';
  updateRow(
    'pipe-ebook', state,
    `${body.count.toLocaleString()} ebooks · manifest generated ${formatAge(ageMs)}`,
    'Manifest freshness from scripts/build_ebook_manifest.py (sync step 1b) only — no last-import outcome from library_catalog is available yet.',
    now,
  );
}

function renderSiteRow(id, name, reached, now) {
  updateRow(id, reached ? 'ok' : 'danger', reached ? 'Reachable.' : 'Did not answer within 8s.', null, now);
}

let refreshing = false;

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.classList.add('spinning');

  const now = () => Date.now();

  const [indexHealth, libraryHealth, gamesHealth, authHealth, audioUp, audioDevUp, libraryUp, gamesUp, pipelineStatus, ebooksManifest] =
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
      fetchJSON(EBOOKS_MANIFEST_URL),
    ]);

  const t = now();

  renderIndexSection(indexHealth, t);
  renderIndexWorkerRow(indexHealth, t);
  renderPipelineAudioRow(pipelineStatus, t);
  renderPipelineEbookRow(ebooksManifest, t);
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
// Wiring
// ---------------------------------------------------------------------------

buildIndexSection();
buildPipelineSection();
buildWorkerSection();
buildSiteSection();

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
