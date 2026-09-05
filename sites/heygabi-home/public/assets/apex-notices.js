/**
 * apex-notices.js — the bell on the front door's signed-in line.
 *
 * Phase 4 of docs/info/universe-add-verse-design.md built the Worker half on
 * 2026-09-05 (`f2e7543`): a notice is written to the REQUESTER when a verse
 * request is approved, declined, or finally lands. §8.8's second open box said
 * the quiet part out loud — *"the routes exist; no page reads them yet"* — and
 * that gap is exactly the person the notice was invented for: the one who is
 * NOT already looking at /universes. This file is that page. Design: §8.9.
 *
 * ── WHERE IT LIVES, AND WHY THERE IS ONLY ONE OF IT ───────────────────────
 * It hangs off `<estate-search>`'s ONE extension point — a light-DOM child
 * carrying slot="who-extra", which renders inside the component's own
 * signed-in line ("Signed in as Amber · sign out", assets/estate-search.js's
 * `.es-who`). That line is the estate's single canonical drawing of "the front
 * door learnt who you are", and the seam exists so a host page can hang
 * something on it without the component learning what it is —
 * apex-admin-link.js used the same slot for the Admin chip until 2026-08-16.
 *
 * ⚠️ ONE MODULE, ONE STYLESHEET, TWO PAGES — a one-fact-one-home decision, not
 * a convenience. A bell drawn per page is N copies of an unread count, and
 * this estate has already shipped two surfaces answering one question with
 * different numbers (docs/info/status-pages.md). A third page opts in with a
 * <link> and a <script> and no new code.
 *
 * ⚠️ IT FINDS THE COMPONENT BY TAG, NOT BY ID. The front door calls it
 * #find-search and /universes calls it #uni-search; a module that hardcoded
 * either would be silently dead on the other page, which is the "it works on
 * the front door so it must work everywhere" failure.
 *
 * ── EVERY REFUSAL IS INVISIBLE, AND THAT IS DELIBERATE (§8.9.2) ───────────
 * Signed out, 401, 403, 404 (the routes are NOT DEPLOYED as of this writing),
 * 5xx, a thrown fetch: in every case NO BELL IS DRAWN and nothing else on the
 * page changes. This inverts the estate's usual "never a bare status, always
 * words" rule on purpose — the bell is a courtesy, and a courtesy that cannot
 * be delivered must not become an error message about itself. A missing
 * feature is not an outage the page should shout about.
 *
 * ⚠️ THE CAUSES STAY DISTINCT IN CODE ANYWAY. `network` is its own outcome and
 * is never folded into `refused`: "a network or server failure is NOT a
 * permission failure" is a rule about diagnosis, and on the day somebody debugs
 * a missing bell that distinction is the whole answer.
 *
 * ⚠️ ONCE THE BELL IS DRAWN THE ORDINARY RULE RESUMES. Every action inside the
 * panel that fails says in words what happened, and the SERVER'S OWN sentence
 * wins whenever it sent one — two copies of a refusal drift, and the drifted
 * one is always the one somebody reads.
 *
 * 🔴 THE WORDS IN A NOTICE ARE THE WORKER'S, RENDERED VERBATIM. `subject` and
 * `body` go in as text and are never re-wrapped, paraphrased or summarised.
 * §8.6's guarantee that `approved` NEVER READS AS DONE lives in the Worker's
 * verseNotice(), pinned by its own test; a page free to reword is a page free
 * to break it. The number of sentences this file composes about a decision is
 * zero.
 */

const AUTH_ORIGIN = 'https://auth.heygabi.ai';

const OUTAGE =
  'Couldn’t reach the estate directory — that’s an outage, not a permissions problem. ' +
  'Try again in a minute.';
const LAPSED = 'Your sign-in has lapsed — sign in again, then try once more.';

/**
 * The one canonical "who am I" seam on this site (see the header). Absent on
 * pages that embed no search box (/series says so in its own head comment), in
 * which case this module does nothing at all.
 */
const search = document.querySelector('estate-search');

/* ------------------------------------------------------------------------ *
 * State — one bell, so one copy of the count
 * ------------------------------------------------------------------------ */

let probedFor = null;
/** The rows as the Worker sent them. Never re-derived, never re-ordered. */
let notices = [];
let unread = 0;
/** MEMBER_NOTICE_CLASSES as the route reports them — labels come from there. */
let classes = [];
/**
 * The person's own switches. Three states, and all three are meant:
 * `null` — not asked yet; `undefined` — asked and the answer failed, so the
 * panel says so; an object — read from the door.
 */
let prefs = null;
/** The words the prefs read failed with, so the panel can repeat them. */
let prefsFailure = null;

let slot = null;
let bell = null;
let badge = null;
let dialog = null;

/* ------------------------------------------------------------------------ *
 * The wire — apex-request-catalog.js's authedJson(), same shape on purpose
 * ------------------------------------------------------------------------ */

async function bearer() {
  try {
    return (await search?.authAdapter?.idToken()) || null;
  } catch {
    return null;
  }
}

/**
 * One shape for every answer so a caller can never mistake an outage for a
 * refusal. ⚠️ A rejected CORS preflight surfaces to JS as a THROWN fetch and
 * looks exactly like a Worker that is down — either way it is `network`, and
 * mislabelling one sends people asking for access they already have.
 */
async function authedJson(path, init) {
  const token = await bearer();
  if (!token) return { kind: 'lapsed' };
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init && init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch {
    return { kind: 'network' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body still has a status, and a person never sees one */
  }
  return { kind: 'answered', status: res.status, ok: res.ok, body: body || {} };
}

/** The server's own sentence wins whenever it sent one — two copies drift. */
export function said(answer, fallback) {
  if (answer.kind === 'lapsed') return LAPSED;
  if (answer.kind === 'network') return OUTAGE;
  const detail = answer && answer.body && answer.body.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return fallback;
}

/**
 * Why the bell is not being drawn, kept as five values rather than a boolean.
 *
 * ⚠️ NOTHING RENDERS ANY OF THEM. They exist so the reason is nameable in a
 * console session and in a test, which is the difference between "the bell is
 * missing" and "the bell is missing because the Worker answered 404".
 */
export function probeVerdict(answer) {
  if (!answer) return 'signed-out';
  if (answer.kind === 'lapsed') return 'signed-out';
  if (answer.kind === 'network') return 'network';
  if (answer.status === 401 || answer.status === 403) return 'signed-out';
  if (answer.status === 404) return 'unavailable';
  if (!answer.ok) return 'unavailable';
  return 'ok';
}

/* ------------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------------ */

const RELATIVE_UNITS = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['week', 604_800_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/**
 * ⚠️ THE PLATFORM'S FORMATTER, NOT A THIRD ESTATE COPY. `status/lib/core.js`
 * has `formatAge` and `storage-view.js` has `formatAgeShort`; both speak an
 * operator's grammar ("3d 4h ago") to an operator's page. This is addressed
 * mail, `Intl.RelativeTimeFormat` says "3 days ago" and "yesterday" in the
 * reader's own locale, and one-canonical-implementation is best served by not
 * writing a third one at all.
 */
export function whenText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = t - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'just now';
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

/**
 * ⚠️ A LINK FIELD IS DATA, AND DATA IS NOT A URL YOU HAND TO `href` UNCHECKED.
 * The Worker only ever writes https://heygabi.ai/universes/ today; this refuses
 * anything that is not plainly `https://` so a future writer cannot turn a
 * stored string into a `javascript:` on somebody's page.
 */
export function safeLink(link) {
  return typeof link === 'string' && /^https:\/\/[^\s]+$/.test(link) ? link : null;
}

/** The accessible name of the bell — a glyph is not a label. */
export function bellLabel(count) {
  if (!count) return 'Notices — nothing unread';
  return count === 1 ? 'Notices — 1 unread' : `Notices — ${count} unread`;
}

/* ------------------------------------------------------------------------ *
 * The bell, in the who line
 * ------------------------------------------------------------------------ */

function ensureSlot() {
  if (slot || !search) return slot;
  slot = document.createElement('span');
  slot.setAttribute('slot', 'who-extra');
  slot.className = 'nx-slot';
  // ⚠️ Belt AND braces. An unslotted light-DOM child of a shadow host does not
  // render at all, and estate-search empties its who line when you sign out —
  // so this would already be invisible. `hidden` says so anyway, because
  // "invisible by an implementation detail of another component" is not a
  // guarantee this file gets to rely on.
  slot.hidden = true;
  search.appendChild(slot);
  return slot;
}

/** An inline SVG bell: one glyph, `currentColor`, no image request, no font. */
function bellGlyph() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '15');
  svg.setAttribute('height', '15');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute(
    'd',
    'M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2L5 15.2h14l-1.5-3.5V8.5A5.5 5.5 0 0 0 12 3Zm0 16.5a2.2 2.2 0 0 0 2.1-1.6H9.9a2.2 2.2 0 0 0 2.1 1.6Z',
  );
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function ensureBell() {
  if (bell) return bell;
  bell = document.createElement('button');
  bell.type = 'button';
  bell.className = 'nx-bell';
  bell.appendChild(bellGlyph());
  badge = document.createElement('span');
  badge.className = 'nx-badge';
  badge.hidden = true;
  bell.appendChild(badge);
  bell.addEventListener('click', openPanel);
  ensureSlot().appendChild(bell);
  return bell;
}

/** The ONE place the count is written — a second writer is a second truth. */
function paintBadge() {
  if (!bell) return;
  const label = bellLabel(unread);
  bell.setAttribute('aria-label', label);
  bell.title = label;
  badge.hidden = unread === 0;
  // 9+ rather than a three-digit pill; the exact number is in the label above.
  badge.textContent = unread > 9 ? '9+' : String(unread);
  bell.classList[unread ? 'add' : 'remove']('has-unread');
}

function showBell() {
  ensureBell();
  paintBadge();
  ensureSlot().hidden = false;
}

/** Every failure path lands here, and it is genuinely silent. */
function hideBell() {
  notices = [];
  unread = 0;
  prefs = null;
  if (dialog && dialog.open) dialog.close();
  if (slot) {
    slot.hidden = true;
    if (badge) badge.hidden = true;
  }
}

/* ------------------------------------------------------------------------ *
 * The panel — a <dialog> on body (apex-request-catalog.js's rc-dialog
 * precedent), NOT a popover inside the who line: that line is a <p> inside
 * another element's shadow DOM, and positioning slotted content is a layout
 * fight with no upside.
 * ------------------------------------------------------------------------ */

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'nx-dialog';
  dialog.addEventListener('close', () => {
    dialog.textContent = '';
  });
  document.body.appendChild(dialog);
  return dialog;
}

function openPanel() {
  const d = ensureDialog();
  renderPanel();
  if (!d.open) d.showModal();
  // The switches are asked for only when somebody opens the drawer — a control
  // nobody looks at should not cost a request on every page load.
  if (prefs === null) loadPrefs();
}

function closePanel() {
  if (dialog && dialog.open) dialog.close();
}

/**
 * ⚠️ ONE RENDER FUNCTION, CALLED AFTER EVERY CHANGE. The alternative — patching
 * the row that changed — is how a badge and a list end up disagreeing.
 */
export function renderPanel() {
  const d = ensureDialog();
  d.textContent = '';

  const panel = document.createElement('div');
  panel.className = 'nx-panel';

  const head = document.createElement('div');
  head.className = 'nx-head';
  const h = document.createElement('h2');
  h.className = 'nx-title';
  h.textContent = 'Notices';
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'nx-x';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '×';
  x.addEventListener('click', closePanel);
  head.append(h, x);
  panel.appendChild(head);

  if (!notices.length) {
    // ⚠️ The Worker's "shipped ahead of migration" answer is a 200 with an
    // EMPTY LIST and a `fix` naming an npm command (§8.7). That sentence is an
    // operator's line and is not put in front of a member — the same judgement
    // the route made when it chose 200 over 500. It is in the response for
    // whoever is debugging.
    const empty = document.createElement('p');
    empty.className = 'nx-empty';
    empty.textContent =
      'Nothing yet. When a verse you asked for is approved, declined, or finally lands, ' +
      'it turns up here.';
    panel.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'nx-list';
    for (const n of notices) list.appendChild(noticeRow(n));
    panel.appendChild(list);
  }

  const foot = document.createElement('div');
  foot.className = 'nx-foot';
  if (unread > 0) foot.appendChild(markAllButton());
  foot.appendChild(prefsBlock());
  panel.appendChild(foot);

  d.appendChild(panel);
}

/**
 * 🔴 THE WORKER'S WORDS, VERBATIM. `textContent` throughout: no markup, no
 * truncation, no "…". §8.6 is enforced in verseNotice(); this renders it.
 */
function noticeRow(n) {
  const item = document.createElement('article');
  item.className = n.read_at ? 'nx-item' : 'nx-item nx-unread';

  const top = document.createElement('div');
  top.className = 'nx-item-head';

  const subject = document.createElement('h3');
  subject.className = 'nx-subject';
  subject.textContent = String(n.subject ?? '');
  top.appendChild(subject);

  const when = document.createElement('span');
  when.className = 'nx-when';
  when.textContent = whenText(n.created_at);
  // The exact instant on hover — a relative age is friendlier and less precise,
  // and the precise one has to stay reachable.
  const exact = Date.parse(n.created_at);
  if (Number.isFinite(exact)) when.title = new Date(exact).toLocaleString();
  top.appendChild(when);
  item.appendChild(top);

  const body = document.createElement('p');
  body.className = 'nx-body';
  body.textContent = String(n.body ?? '');
  item.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'nx-actions';
  const href = safeLink(n.link);
  if (href) {
    const a = document.createElement('a');
    a.className = 'nx-link';
    a.href = href;
    a.textContent = 'Open the universes page';
    actions.appendChild(a);
  }
  if (!n.read_at && n.id != null) actions.appendChild(markReadButton(n, actions));
  item.appendChild(actions);
  return item;
}

/** A refusal, in words, exactly where the button that failed is. */
function sayHere(where, text) {
  const p = document.createElement('p');
  p.className = 'nx-note';
  p.setAttribute('role', 'status');
  p.textContent = text;
  where.appendChild(p);
}

function markReadButton(n, actions) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nx-read';
  btn.textContent = 'Mark read';
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const answer = await authedJson(`/api/estate/notifications/${n.id}/read`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    btn.disabled = false;
    if (answer.kind !== 'answered' || !answer.ok) {
      sayHere(actions, said(answer, 'That notice could not be marked read — nothing changed.'));
      return;
    }
    // ⚠️ The row is updated from the SERVER'S answer, never from optimism: the
    // route returns the `read_at` it actually stored (and the one it already
    // held, if this was a second press).
    n.read_at = answer.body.read_at || new Date().toISOString();
    unread = notices.filter((x) => !x.read_at).length;
    paintBadge();
    renderPanel();
  });
  return btn;
}

function markAllButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nx-readall';
  btn.textContent = 'Mark all read';
  const wrap = document.createElement('div');
  wrap.className = 'nx-readall-wrap';
  wrap.appendChild(btn);
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const answer = await authedJson('/api/estate/notifications/read-all', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    btn.disabled = false;
    if (answer.kind !== 'answered' || !answer.ok) {
      sayHere(wrap, said(answer, 'Those notices could not be marked read — nothing changed.'));
      return;
    }
    const at = answer.body.read_at || new Date().toISOString();
    for (const n of notices) if (!n.read_at) n.read_at = at;
    unread = 0;
    paintBadge();
    renderPanel();
  });
  return wrap;
}

/* ------------------------------------------------------------------------ *
 * The opt-out (§8.5's second refusal, said out loud)
 * ------------------------------------------------------------------------ */

async function loadPrefs() {
  const answer = await authedJson('/api/estate/notifications/prefs');
  if (answer.kind === 'answered' && answer.ok && answer.body && typeof answer.body.prefs === 'object') {
    prefs = answer.body.prefs;
    if (Array.isArray(answer.body.classes) && answer.body.classes.length) classes = answer.body.classes;
  } else {
    // ⚠️ NOT silently "off", and not silently "on" either. `undefined` means
    // "we do not know", the toggle says so, and nothing pretends to be a
    // setting it never read.
    prefs = undefined;
    prefsFailure = said(answer, 'Your notice settings could not be read just now.');
  }
  if (dialog && dialog.open) renderPanel();
}

function prefsBlock() {
  const box = document.createElement('div');
  box.className = 'nx-prefs';

  if (prefs === null) {
    const p = document.createElement('p');
    p.className = 'nx-note';
    p.textContent = 'Reading your notice settings…';
    box.appendChild(p);
    return box;
  }
  if (prefs === undefined) {
    sayHere(box, prefsFailure || 'Your notice settings could not be read just now.');
    return box;
  }
  // ⚠️ A Worker that named no classes gets NO switches drawn and no sentence
  // about switches — an empty toggle list with an explanation under it is a
  // control that promises something it cannot do.
  if (!classes.length) return box;

  // The class list is the WORKER'S (MEMBER_NOTICE_CLASSES); its `label` and
  // `detail` are rendered rather than restated, so adding a class server-side
  // needs no change here.
  for (const cls of classes) {
    const row = document.createElement('label');
    row.className = 'nx-pref';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = prefs[cls.key] !== false;
    input.addEventListener('change', () => savePrefs(cls.key, input.checked, box, input));
    const text = document.createElement('span');
    text.className = 'nx-pref-text';
    const label = document.createElement('span');
    label.className = 'nx-pref-label';
    label.textContent = String(cls.label ?? cls.key);
    text.appendChild(label);
    if (cls.detail) {
      const detail = document.createElement('span');
      detail.className = 'nx-pref-detail';
      detail.textContent = String(cls.detail);
      text.appendChild(detail);
    }
    row.append(input, text);
    box.appendChild(row);
  }

  // 🔴 §8.5's second refusal, in the one place a person can act on it: an
  // opt-out means the notice is NEVER WRITTEN, not that it is stored and
  // hidden. Somebody who reads "off" as "hide these" would switch it off, come
  // back later, and find nothing waiting — and be right to feel misled.
  const honesty = document.createElement('p');
  honesty.className = 'nx-note nx-honesty';
  honesty.textContent =
    'Switching one off means the estate stops writing that notice at all — it does not hide ' +
    'the ones already here, and it never changes what happens to your request.';
  box.appendChild(honesty);
  return box;
}

/**
 * ⚠️ THE WHOLE OBJECT IS SENT, not the one switch that moved. The door refuses
 * an unknown class rather than stripping it, and a partial body would make the
 * page's idea of "everything else" the server's problem to guess.
 */
async function savePrefs(key, on, box, input) {
  const next = { ...prefs, [key]: on };
  input.disabled = true;
  const answer = await authedJson('/api/estate/notifications/prefs', {
    method: 'POST',
    body: JSON.stringify(next),
  });
  input.disabled = false;
  if (answer.kind !== 'answered' || !answer.ok) {
    // Put the switch back where it was; a control that looks changed and is not
    // is worse than one that refused out loud.
    input.checked = prefs[key] !== false;
    sayHere(box, said(answer, 'That setting could not be saved — nothing changed.'));
    return;
  }
  prefs = answer.body.prefs && typeof answer.body.prefs === 'object' ? answer.body.prefs : next;
  if (Array.isArray(answer.body.classes) && answer.body.classes.length) classes = answer.body.classes;
  renderPanel();
}

/* ------------------------------------------------------------------------ *
 * The probe — apex-admin-link.js's seam, verbatim in shape
 * ------------------------------------------------------------------------ */

/** Exported so a test can drive it without a CustomEvent. */
export async function probe(user) {
  if (!user) {
    probedFor = null;
    hideBell();
    return 'signed-out';
  }
  if (probedFor === user.uid) return 'already-probed';
  probedFor = user.uid;
  hideBell(); // hidden until the route earns otherwise

  const answer = await authedJson('/api/estate/notifications');
  // ⚠️ A fast sign-out must not land a stale answer on the page. Re-checked
  // AFTER the await, the apex-request-catalog.js rule.
  if (probedFor !== user.uid) return 'stale';

  const verdict = probeVerdict(answer);
  if (verdict !== 'ok') return verdict;

  const body = answer.body || {};
  notices = Array.isArray(body.notices) ? body.notices : [];
  unread = Number.isFinite(body.unread) ? body.unread : notices.filter((n) => !n.read_at).length;
  classes = Array.isArray(body.classes) ? body.classes : [];
  // ⚠️ Drawn even at zero unread: the opt-out has to live somewhere findable,
  // and a control that only exists when there is news is a control nobody
  // knows exists.
  showBell();
  return 'ok';
}

if (search) {
  search.addEventListener('estate-search:auth', (e) => probe(e && e.detail && e.detail.user));
}
