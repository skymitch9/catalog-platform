/**
 * status/lib/core.js — the pieces every /status page shares.
 *
 * Extracted from status.js on 2026-08-18 when the page split into four
 * (Health · Processing · Pipelines · Agents). Nothing here is new: every
 * function below is the original implementation, moved so that four pages
 * cannot each grow their own slightly different copy of "how old is this" or
 * "what does a red dot mean".
 *
 * ⚠️ THE ROW REGISTRY IS PER-DOCUMENT AND THAT IS FINE. Each page loads this
 * module once and owns its own registry — the pages never share a DOM. The
 * Map lives here rather than in each page so `tickAll()` is one implementation
 * of "re-word every age on screen", which is the single behaviour that makes
 * the difference between a status page and a screenshot.
 *
 * ⚠️ NOTHING IN THIS FILE FETCHES ANYTHING ON ITS OWN. It has no top-level
 * side effects, no timers and no DOM lookups at import time, so importing it
 * from a page that has none of the matching elements is safe and silent.
 */

export const REFRESH_INTERVAL_MS = 60_000;
export const TICK_INTERVAL_MS = 5_000;
export const FETCH_TIMEOUT_MS = 8_000;

export const INDEX_ORIGIN = 'https://index.heygabi.ai';
export const LIBRARY_ORIGIN = 'https://library.heygabi.ai';
export const GAMES_ORIGIN = 'https://boardgames.heygabi.ai';
/**
 * The SECOND library instance — "Sam's library" (library_catalog's
 * `[env.friend]`, Worker `library-catalog-friend`, its own D1 and covers
 * bucket). Same Worker code as LIBRARY_ORIGIN, so the same `/api/health`
 * envelope and the same apex-only status CORS. ⚠️ The hostname is the only
 * thing about that instance allowed to change — if it moves, this constant and
 * tools/estate-probes/lib/origins.mjs move together.
 */
export const LIBRARY2_ORIGIN = 'https://padhard.heygabi.ai';
export const AUTH_ORIGIN = 'https://auth.heygabi.ai';
export const AUDIO_ORIGIN = 'https://audiobooks.heygabi.ai';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * An age in ms → words.
 *
 * ⚠️ A NON-FINITE AGE USED TO RENDER AS "just now" (fixed 2026-08-18). That is
 * the worst possible answer: an unparseable or missing timestamp came out of
 * here looking like the freshest reading on the page, and every caller that
 * forgot to guard with Number.isFinite() published a fabricated freshness. An
 * unknown age now SAYS it is unknown — the estate's rule that a measurement's
 * absence is never a value. Callers that already guard are unaffected, because
 * they never reach this branch with a bad number.
 *
 * A NEGATIVE age still clamps to "just now", deliberately and unlike the
 * above: that is ordinary clock skew between this browser and whatever stamped
 * the timestamp, not missing information.
 */
export function formatAge(ms) {
  if (!Number.isFinite(ms)) return 'age unknown';
  if (ms < 0) ms = 0;
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
 * Envelope-aware accessor — prefers `body.detail` (the normalized health
 * envelope's unchanged nested copy of a worker's own fields), falls back to
 * the flat body for a worker still on the pre-envelope shape.
 */
export function detailOf(body) {
  return body && body.detail ? body.detail : body;
}

/**
 * Decode one Firestore REST typed value (`{stringValue: "x"}`,
 * `{integerValue: "3"}`, `{mapValue: {fields: {...}}}`, …) into a plain JS
 * value. The REST API always wraps values this way; the JS SDK the audiobook
 * admin panel uses hides this same decoding inside onSnapshot(), so this is
 * the same document, just undecoded.
 */
export function fsValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return fsMap((v.mapValue && v.mapValue.fields) || {});
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fsValue);
  return null; // nullValue, or a type these pages never need to read
}

export function fsMap(fields) {
  const out = {};
  for (const k of Object.keys(fields)) out[k] = fsValue(fields[k]);
  return out;
}

/** GET JSON with a timeout. Never throws — the caller reads `.ok`. */
export async function fetchJSON(url) {
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
 * A no-cors reachability probe. None of the sites these pages HEAD send
 * Access-Control-Allow-Origin (Cloudflare Pages does not by default), so a
 * normal cross-origin fetch would reject before a status code was ever
 * visible. `mode: 'no-cors'` sidesteps that: the browser still makes the
 * request and the promise still resolves once a response arrives, but the
 * response is opaque — no status, no body. That is enough to tell "answered"
 * from "did not answer", which is all the Sites section claims.
 *
 * HEAD, never GET: the audiobook site's root ships a multi-megabyte generated
 * page, and a HEAD costs nothing on either side of the check.
 */
export async function probeReachable(url) {
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
// Row rendering — one shape shared by every section on every page
// ---------------------------------------------------------------------------

/** Rows keep their DOM node + checked-at timestamp so the ticker can update
 *  "checked Ns ago" without re-fetching anything. */
export const rowRegistry = new Map(); // id -> { el, badgeEl, detailEl, noteEl, checkedEl, checkedAt }

export function makeRow(id, name) {
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

// `skipped` and `nodata` have no CSS rule of their own on purpose: the base
// `.dot`/`.badge` colour is already `--et-muted`, so an unlisted state renders
// grey for free. They are two different facts and get two different words —
// "the step ran and declined to act" is not "the step never reported".
export const STATE_LABELS = { ok: 'OK', warn: 'WARN', danger: 'DOWN', skipped: 'SKIPPED', nodata: 'NO DATA' };

export function updateRow(id, state, detailText, noteText, checkedAt) {
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

export function tickRow(id) {
  const row = rowRegistry.get(id);
  if (!row || row.checkedAt == null) return;
  row.checkedEl.textContent = `checked ${formatAge(Date.now() - row.checkedAt)}`;
}

export function tickAll() {
  for (const id of rowRegistry.keys()) tickRow(id);
}

/** Set a row's visible name after creation (some labels ship with the data). */
export function setRowName(id, name) {
  const row = rowRegistry.get(id);
  if (row) row.el.querySelector('.row-name').textContent = name;
}

// ---------------------------------------------------------------------------
// Worded empty states — the owner's standing rule, made reusable
// ---------------------------------------------------------------------------

/**
 * Replace a list's contents with ONE sentence explaining why it is empty.
 *
 * ⚠️ The reason is always passed in, never inferred here, because the causes
 * are not interchangeable: "nothing has been pushed yet", "the push carried no
 * agents", "the poll failed" and "this is not wired up yet" look identical on
 * screen and have four different fixes. A helper that guessed would flatten
 * them, which is exactly the failure it exists to prevent.
 */
export function sayEmpty(listEl, sentence) {
  if (!listEl) return;
  listEl.replaceChildren();
  const li = document.createElement(listEl.tagName === 'UL' || listEl.tagName === 'OL' ? 'li' : 'p');
  li.className = 'empty-say';
  li.textContent = sentence;
  listEl.appendChild(li);
}

/** textContent-only element helper. Every renderer on these pages builds nodes
 *  rather than assigning innerHTML — book titles and agent tasks are free text
 *  from elsewhere, and /docs already carries a mustNotContain pin for exactly
 *  this reason. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
