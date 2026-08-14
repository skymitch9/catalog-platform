/**
 * find.js — the global search in the front door's #find slot.
 *
 * The contract (estate-auth-design.md §7 + §4.5, index-worker-design.md §3.3):
 *   - the PAGE stays public, and since §4.5 the SEARCH answers everyone —
 *     scoped by VISIBILITY. Signed out, queries go tokenless and the index
 *     answers the public slice (the audiobook catalog) with a quiet "sign in
 *     to search everything" affordance — an invitation, not a wall. Signed
 *     in, every query sends the Firebase ID token as a bearer to
 *     index.heygabi.ai, which verifies it locally and scopes results to the
 *     member's effective visibility set (the /api/search answer carries
 *     `scope`, applied server-side in the SQL — out-of-scope rows never
 *     reach this page). This page holds no membership or visibility logic at
 *     all — the canonical module lives server-side and the browser's whole
 *     job is sign-in + bearer.
 *   - universe follow-ups (/api/universe) stay MEMBERS-ONLY server-side; the
 *     signed-out click gets the sign-in invitation instead of a 401.
 *
 * ⚠️ WHAT A RESULT MEANS — the index design's own words: a hit means "in your
 *   catalog — tap through for owned-vs-wanted", NEVER "you own this".
 *   Ownership deliberately does not travel to the index (29 of the 836 game
 *   rows are wanted-only). The caveat line under the results is load-bearing
 *   copy, not decoration; do not "tidy" it into a claim of ownership.
 *
 * HOW IT SEARCHES (the owner's ask, 2026-08-14): as you type. From two
 * characters, each pause of ~250ms fires GET /api/search?q=… — the Worker's
 * RANKED partial-match search (exact > prefix > all-tokens-prefix >
 * substring; title > creator > series; every hit carries its reason).
 * Stale responses cannot land: each request aborts the previous one via
 * AbortController, and an aborted request renders nothing. Enter merely
 * flushes the debounce — no submit needed, none punished.
 *
 * Rendering groups per the server's own grouping:
 *   - books: SAME-WORK groups (work_fold joined server-side) — one card,
 *     every owned format a link inside it;
 *   - games: individual rows carrying `kind` and `parent_source_id`;
 *   - universes: names the QUERY matched, as follow-up buttons onto
 *     /api/universe/:name (the only cross-format join games take part in).
 *
 * Keyboard: ↑/↓ walk the results (aria-activedescendant on the input,
 * aria-selected on the row), Enter opens the active row, Escape closes the
 * list. The results container is role="listbox", rows role="option".
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from './estate-auth.js';

const INDEX_ORIGIN = 'https://index.heygabi.ai';
const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

const form = document.getElementById('find-form');
const input = document.getElementById('find-input');
const submitBtn = document.getElementById('find-submit');
const signinBtn = document.getElementById('find-signin');
const whoEl = document.getElementById('find-who');
const statusEl = document.getElementById('find-status');
const resultsEl = document.getElementById('find-results');

let currentUser = null;

/**
 * ⚠️ THE SIGN-IN FLASH BUG, fixed for good (owner-found, live, 2026-08-14):
 * Firebase reads its persisted session ASYNCHRONOUSLY after load, so a page
 * that renders the signed-out state immediately shows a returning member
 * "Sign in to search" for however long the SDK takes — which reads as "it
 * forgot me". The box therefore boots NEUTRAL (markup ships it disabled with
 * both buttons hidden) and renders nothing decisive until watchAuth's FIRST
 * callback — which always comes, signed in or out, once the session is read.
 * The timeout below is a backstop for the SDK never answering at all
 * (blocked gstatic, dead network): after 8s the box falls back to the
 * signed-out state, because a silent forever-disabled box is worse.
 */
let authResolved = false;
const authBackstop = setTimeout(() => {
  if (!authResolved) {
    authResolved = true;
    renderAuthState();
  }
}, 8000);

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
  statusEl.hidden = !text;
}

function renderAuthState() {
  if (!authResolved) {
    // Neutral: no claim either way until Firebase answers.
    input.disabled = true;
    input.placeholder = 'One moment…';
    submitBtn.hidden = true;
    signinBtn.hidden = true;
    whoEl.hidden = true;
    return;
  }
  const signedIn = currentUser !== null;
  // §4.5: the box works for EVERYONE — signed out it searches the public
  // (audiobook) slice, so it is never disabled once auth state is known.
  input.disabled = false;
  submitBtn.hidden = false;
  signinBtn.hidden = signedIn;
  if (signedIn) {
    whoEl.innerHTML = '';
    const name = document.createElement('span');
    name.textContent = currentUser.displayName || currentUser.email;
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'find-linkbtn';
    out.textContent = 'sign out';
    out.addEventListener('click', async () => {
      await signOutUser();
      clearResults();
      setStatus('');
    });
    whoEl.append('Signed in as ', name, ' · ', out);
    whoEl.hidden = false;
    input.placeholder = 'Start typing a title, author or series…';
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    // The quiet affordance, not a wall: the placeholder names what works now
    // and the visible "Sign in to search everything" button offers the rest.
    input.placeholder = 'Search the audiobook shelf…';
  }
}

// ---------------------------------------------------------------------------
// Results + keyboard navigation
// ---------------------------------------------------------------------------

/** The walkable rows, top to bottom: { el, open } — open() is what Enter does. */
let navItems = [];
let activeIndex = -1;

function clearResults() {
  resultsEl.innerHTML = '';
  navItems = [];
  activeIndex = -1;
  input.removeAttribute('aria-activedescendant');
  input.setAttribute('aria-expanded', 'false');
}

function setActive(i) {
  if (activeIndex >= 0 && navItems[activeIndex]) {
    navItems[activeIndex].el.setAttribute('aria-selected', 'false');
  }
  activeIndex = i;
  if (i >= 0 && navItems[i]) {
    const el = navItems[i].el;
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    el.scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function registerNav(el, open) {
  el.id = `find-opt-${navItems.length}`;
  el.setAttribute('role', 'option');
  el.setAttribute('aria-selected', 'false');
  navItems.push({ el, open });
}

function sourceLabel(source) {
  return source === 'game' ? 'board games'
    : source === 'library' ? 'library'
    : source === 'audiobook' ? 'audiobooks'
    : source;
}

/** The server's scope vocabulary (§4.5 catalogs), spoken like a person. */
const SCOPE_LABELS = { audiobook: 'audiobooks', library: 'the library', games: 'board games' };
const FULL_SCOPE_SIZE = 3;

function scopePhrase(scope) {
  return scope.map((c) => SCOPE_LABELS[c] || c).join(' and ');
}

/**
 * The subtle scope line under a partial-scope answer: which shelves were
 * searched, plus the sign-in invitation for the signed-out. Full scope earns
 * no line at all — the default deserves no furniture.
 */
function scopeNote(scope) {
  if (!Array.isArray(scope) || scope.length === 0 || scope.length >= FULL_SCOPE_SIZE) return null;
  const p = document.createElement('p');
  p.className = 'find-caveat';
  p.setAttribute('role', 'presentation');
  p.textContent = `Searching ${scopePhrase(scope)} only.` +
    (currentUser ? '' : ' Sign in to search every shelf.');
  return p;
}

function openUrl(url) {
  if (url) window.open(url, '_blank', 'noopener');
}

function metaBits(row) {
  const bits = [];
  if (row.creator) bits.push(row.creator);
  bits.push(row.format);
  if (row.kind && row.kind !== 'base') bits.push(row.kind);
  if (row.parent_source_id) bits.push('belongs with a base game');
  if (row.series) bits.push(row.series_index != null ? `${row.series} #${row.series_index}` : row.series);
  if (row.year) bits.push(String(row.year));
  if (row.publisher) bits.push(row.publisher);
  return bits.join(' · ');
}

/**
 * The thumbnail slot — ALWAYS rendered at fixed size so rows line up and
 * nothing shifts as lazy images land. No cover (or a cover whose host is
 * missing from the CSP img-src list, or a dead hotlink) leaves a clean
 * themed box — never a broken-image glyph. The allow-list of cover hosts
 * lives in public/_headers, measured from the real pushed rows.
 */
function coverFor(li, row) {
  const box = document.createElement('span');
  box.className = 'hit-cover';
  box.setAttribute('aria-hidden', 'true');
  if (row && row.cover_url) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.width = 42;
    img.height = 58;
    img.src = row.cover_url;
    img.addEventListener('error', () => img.remove());
    box.appendChild(img);
  }
  li.appendChild(box);
}

/** One game row, or one flat row in a universe listing. */
function rowCard(row) {
  const li = document.createElement('li');
  li.className = 'hit';
  coverFor(li, row);

  const body = document.createElement('div');
  body.className = 'hit-body';

  const title = document.createElement('span');
  title.className = 'hit-title';
  if (row.detail_url) {
    const a = document.createElement('a');
    a.href = row.detail_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = row.title;
    title.appendChild(a);
  } else {
    title.textContent = row.title;
  }
  body.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'hit-meta';
  meta.textContent = metaBits(row);
  body.appendChild(meta);

  if (row.universe) {
    const uni = document.createElement('button');
    uni.type = 'button';
    uni.className = 'find-linkbtn hit-universe';
    uni.textContent = `everything in ${row.universe} →`;
    uni.addEventListener('click', () => runUniverse(row.universe));
    body.appendChild(uni);
  }

  li.appendChild(body);
  registerNav(li, () => openUrl(row.detail_url));
  return li;
}

/** One BOOK WORK: the server joined same-work rows; every format is a link. */
function workCard(hit) {
  const li = document.createElement('li');
  li.className = 'hit';
  coverFor(li, hit.entries.find((e) => e.cover_url) || null);

  const body = document.createElement('div');
  body.className = 'hit-body';

  const title = document.createElement('span');
  title.className = 'hit-title';
  title.textContent = hit.title;
  body.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'hit-meta';
  meta.textContent = hit.creator || '';
  if (meta.textContent) body.appendChild(meta);

  // The formats line: "library · book" / "audiobooks · audiobook", each a link.
  const formats = document.createElement('span');
  formats.className = 'hit-meta';
  hit.entries.forEach((e, i) => {
    if (i > 0) formats.append(' · ');
    const label = `${sourceLabel(e.source)}: ${e.format}`;
    if (e.detail_url) {
      const a = document.createElement('a');
      a.href = e.detail_url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      formats.appendChild(a);
    } else {
      formats.append(label);
    }
  });
  body.appendChild(formats);

  const withUniverse = hit.entries.find((e) => e.universe);
  if (withUniverse) {
    const uni = document.createElement('button');
    uni.type = 'button';
    uni.className = 'find-linkbtn hit-universe';
    uni.textContent = `everything in ${withUniverse.universe} →`;
    uni.addEventListener('click', () => runUniverse(withUniverse.universe));
    body.appendChild(uni);
  }

  li.appendChild(body);
  const first = hit.entries.find((e) => e.detail_url);
  registerNav(li, () => openUrl(first ? first.detail_url : null));
  return li;
}

function groupHeading(text) {
  const h = document.createElement('h3');
  h.className = 'find-group';
  h.setAttribute('role', 'presentation');
  h.textContent = text;
  return h;
}

function caveatLine(headingText) {
  const heading = document.createElement('p');
  heading.className = 'find-caveat';
  heading.setAttribute('role', 'presentation');
  // ⚠️ Load-bearing copy (see file header): in-catalog, not owned.
  heading.textContent =
    `${headingText} A result means it is in the catalog — some entries are wanted, not owned. ` +
    'Tap through to the owning catalog for owned-versus-wanted.';
  return heading;
}

/** The live /api/search answer: books (same-work), games, universes — scoped. */
function renderSearch(data) {
  clearResults();

  if (data.reason === 'no_catalogs_visible') {
    // The server's honest empty scope ({} — revoked, or narrowed to nothing):
    // said plainly, one message for both, because the server does not say which.
    setStatus('Your account currently has no catalogs to search. An approver can restore them.', 'warn');
    return;
  }

  const total = data.books.length + data.games.length + data.universes.length;
  if (total === 0) {
    const where = Array.isArray(data.scope) && data.scope.length < FULL_SCOPE_SIZE
      ? `in ${scopePhrase(data.scope)}` : 'on any shelf';
    setStatus(`Nothing ${where} matches “${data.query}”. The search tries titles, authors and series — a couple more letters can help.` +
      (currentUser || !Array.isArray(data.scope) || data.scope.length >= FULL_SCOPE_SIZE
        ? '' : ' Signing in searches every shelf.'));
    return;
  }
  setStatus('');
  input.setAttribute('aria-expanded', 'true');

  resultsEl.appendChild(caveatLine(`Matches for “${data.query}”.`));
  const note = scopeNote(data.scope);
  if (note) resultsEl.appendChild(note);

  if (data.universes.length) {
    resultsEl.appendChild(groupHeading('Universes — every catalog, every format'));
    const ul = document.createElement('ul');
    ul.className = 'hits';
    ul.setAttribute('role', 'presentation');
    for (const u of data.universes) {
      const li = document.createElement('li');
      li.className = 'hit';
      const body = document.createElement('div');
      body.className = 'hit-body';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'find-linkbtn hit-universe';
      btn.textContent = `everything in ${u.name} (${u.count}) →`;
      btn.addEventListener('click', () => runUniverse(u.name));
      body.appendChild(btn);
      li.appendChild(body);
      registerNav(li, () => runUniverse(u.name));
      ul.appendChild(li);
    }
    resultsEl.appendChild(ul);
  }

  if (data.books.length) {
    resultsEl.appendChild(groupHeading('Books & audiobooks — same work, any format'));
    const ul = document.createElement('ul');
    ul.className = 'hits';
    ul.setAttribute('role', 'presentation');
    for (const hit of data.books) ul.appendChild(workCard(hit));
    resultsEl.appendChild(ul);
  }

  if (data.games.length) {
    resultsEl.appendChild(groupHeading('Board games — matched on title'));
    const ul = document.createElement('ul');
    ul.className = 'hits';
    ul.setAttribute('role', 'presentation');
    for (const hit of data.games) ul.appendChild(rowCard(hit));
    resultsEl.appendChild(ul);
  }
}

/** A /api/universe answer: flat rows, grouped by tier (unchanged shape). */
function renderUniverse(data) {
  clearResults();

  if (!data.matches.length) {
    setStatus(`Nothing in any catalog sits in ${data.universe} right now.`);
    return;
  }
  setStatus('');
  input.setAttribute('aria-expanded', 'true');

  resultsEl.appendChild(caveatLine(`Everything in ${data.universe} — every catalog, every format.`));

  const groups = [
    { name: 'Books & audiobooks', rows: data.matches.filter((m) => m.source === 'library' || m.source === 'audiobook') },
    { name: 'Board games', rows: data.matches.filter((m) => m.source === 'game') },
  ];
  for (const g of groups) {
    if (!g.rows.length) continue;
    resultsEl.appendChild(groupHeading(g.name));
    const ul = document.createElement('ul');
    ul.className = 'hits';
    ul.setAttribute('role', 'presentation');
    for (const row of g.rows) ul.appendChild(rowCard(row));
    resultsEl.appendChild(ul);
  }
}

// ---------------------------------------------------------------------------
// Queries — debounced, abortable
// ---------------------------------------------------------------------------

let debounceTimer = 0;
let inflight = null; // the current AbortController

async function callIndex(path, signal) {
  // Signed out, the request goes TOKENLESS on purpose — §4.5's anonymous
  // rule answers it with the public slice server-side. Only a signed-in
  // session whose token cannot be minted is worth a warning.
  const headers = {};
  if (currentUser) {
    const token = await idToken();
    if (!token) {
      setStatus('Your sign-in has lapsed — sign in again.', 'warn');
      return null;
    }
    headers.authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${INDEX_ORIGIN}${path}`, { headers, signal });
  } catch (e) {
    if (e && e.name === 'AbortError') return { aborted: true };
    setStatus('The index did not answer (network). Try again shortly.', 'warn');
    return null;
  }

  if (res.ok) return res.json();

  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* non-JSON error body; the status code still speaks */ }

  // The index's own error vocabulary, answered in its own words.
  switch (body?.error) {
    case 'estate_pending':
      // The same posture and the same words as the apps' request screens.
      setStatus('Your account is awaiting approval. An approver admits new members; nothing more for you to do.', 'warn');
      break;
    case 'estate_revoked':
      setStatus('Your access has been revoked.', 'warn');
      break;
    case 'estate_unreachable':
      setStatus('The estate directory did not answer, so new admissions cannot be checked right now. Try again shortly.', 'warn');
      break;
    case 'query_too_short':
      // The client already gates at MIN_CHARS; reaching this means the gates
      // disagree — stay quiet rather than scold mid-keystroke.
      break;
    case 'unfoldable_query':
      setStatus('That title cannot be key-matched (it folds to nothing — wholly non-Latin or punctuation-only titles do this). Browse the owning catalog instead.', 'warn');
      break;
    case 'unauthenticated':
      setStatus('The index did not accept the sign-in token. Sign out and back in.', 'warn');
      break;
    default:
      setStatus(`Search failed (${res.status}${body?.error ? `: ${body.error}` : ''}).`, 'warn');
  }
  return null;
}

async function runSearch(q) {
  if (inflight) inflight.abort();
  inflight = new AbortController();
  const data = await callIndex(`/api/search?q=${encodeURIComponent(q)}`, inflight.signal);
  if (!data || data.aborted) return; // a newer keystroke owns the box now
  renderSearch(data);
}

async function runUniverse(name) {
  if (!currentUser) {
    // /api/universe is members-only server-side (the §4.5 carve-out is
    // search-only). Say so as an invitation, before a 401 says it worse.
    setStatus(`The universe view spans every shelf, so it needs a sign-in. Sign in to see everything in ${name}.`);
    return;
  }
  if (inflight) inflight.abort();
  inflight = new AbortController();
  setStatus(`Everything in ${name}…`);
  const data = await callIndex(`/api/universe/${encodeURIComponent(name)}`, inflight.signal);
  if (!data || data.aborted) return;
  renderUniverse(data);
}

function scheduleSearch() {
  clearTimeout(debounceTimer);
  const q = input.value.trim();
  if (q.length < MIN_CHARS) {
    // Below the threshold nothing is pending and nothing stale can land.
    if (inflight) inflight.abort();
    clearResults();
    setStatus('');
    return;
  }
  debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

input.setAttribute('role', 'combobox');
input.setAttribute('aria-autocomplete', 'list');
input.setAttribute('aria-expanded', 'false');
input.setAttribute('aria-controls', 'find-results');
resultsEl.setAttribute('role', 'listbox');
resultsEl.setAttribute('aria-label', 'Search results');

input.addEventListener('input', () => {
  if (!authResolved) return; // neutral boot: no claims either way yet
  scheduleSearch();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!navItems.length) return;
    e.preventDefault();
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const next = activeIndex + delta;
    setActive(next < -1 ? navItems.length - 1 : next >= navItems.length ? -1 : next);
  } else if (e.key === 'Enter') {
    if (activeIndex >= 0 && navItems[activeIndex]) {
      e.preventDefault();
      navItems[activeIndex].open();
    }
    // Plain Enter falls through to the form submit below: flush the debounce.
  } else if (e.key === 'Escape') {
    clearTimeout(debounceTimer);
    if (inflight) inflight.abort();
    clearResults();
    setStatus('');
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!authResolved) return;
  clearTimeout(debounceTimer);
  const q = input.value.trim();
  if (q.length < MIN_CHARS) return;
  runSearch(q);
});

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setStatus(r.error, r.ownerAction ? 'owner' : 'warn');
  else if (r.cancelled) setStatus('');
  // ok / redirecting need nothing: watchAuth re-renders, or the page leaves.
});

watchAuth((user) => {
  // The first callback is the moment auth is KNOWN — neutral ends here,
  // decisively, in whichever direction the answer went. (Signed out is now a
  // WORKING state: the anonymous audiobook slice, §4.5 — not disabled.)
  authResolved = true;
  clearTimeout(authBackstop);
  const changed = currentUser !== user;
  currentUser = user;
  renderAuthState();
  // Crossing the sign-in boundary changes the scope: re-run a standing query
  // so the results widen (or narrow) without a re-type.
  if (changed && input.value.trim().length >= MIN_CHARS) scheduleSearch();
});

renderAuthState();

// Complete a redirect sign-in if one is landing (must run on every load —
// the mobile/in-app-browser flow depends on it; identity.js's rule, kept).
handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
