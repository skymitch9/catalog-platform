/**
 * universes.js — the /universes page: one collapsed row per estate universe,
 * expanding on click to GET /api/universe/:name.
 *
 * ⚠️ WHY THIS DUPLICATES find.js RATHER THAN IMPORTING IT: find.js's
 * renderUniverse/rowCard functions are page-local (closed over #find-results
 * etc.), and this codebase's own convention — find.js, status.js and
 * identity.js are each a standalone page script, no shared render module —
 * is duplication-with-intent over new shared-module machinery. Chose to
 * follow that convention rather than invent one. See index.html's header for
 * the fuller reasoning.
 *
 * AUTH: same neutral-boot pattern as find.js — authResolved starts false, an
 * 8s backstop forces it true (signed-out) if Firebase never answers, and no
 * interaction commits to a signed-in/out claim before the first watchAuth
 * callback. A returning member must never see "sign in" flash before their
 * session resolves.
 *
 * FETCHING: lazy, one universe at a time, only on expand — never all 7
 * eagerly on load. /api/universe is a real per-universe DB query and this
 * page's own click-to-fetch mirrors find.js's runUniverse() (also
 * click-triggered, not fired on every render). A signed-out expand shows the
 * same sign-in invitation copy find.js already uses for its inline
 * "everything in X" buttons — never a fetch, since /api/universe has no
 * anonymous carve-out (read.ts's header is explicit: members-only, no public
 * fallback, unlike /api/search's §4.5 carve-out).
 *
 * THE 7 NAMES ARE HARDCODED, deliberately, because read.ts exposes no public
 * "list universe names" route — only /api/lookup (title-keyed) and the
 * members-only /api/universe/:name. Checked before assuming this: no such
 * route exists today. Keep this list in sync with data/universes.json's
 * `universes[].name` by hand; that file's own docs say it changes roughly
 * monthly, so a periodic check is enough — this is a maintenance note, not a
 * bug, and outgrowing it is the moment to add a real "list names" route.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';

const INDEX_ORIGIN = 'https://index.heygabi.ai';

// ⚠️ Keep in sync with data/universes.json `universes[].name` — see header.
// Marvel and Disney added 2026-08-15 (owner/coordinator: separate universes).
// Same day, revised further: Star Wars split out of Disney (crossover-
// potential criterion) and Alliances created (owner-approved).
const UNIVERSE_NAMES = [
  'The Cosmere',
  'Runnerverse',
  'CAL Verse',
  'Maasverse',
  'Riordanverse',
  'Solaria',
  'Willverse',
  'Marvel',
  'Disney',
  'Star Wars',
  'Alliances',
];

const whoEl = document.getElementById('uni-who');
const signinBtn = document.getElementById('uni-signin');
const statusEl = document.getElementById('uni-status');
const listEl = document.getElementById('uni-list');

let currentUser = null;

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
  statusEl.hidden = !text;
}

// ---------------------------------------------------------------------------
// Auth — neutral boot, same shape as find.js
// ---------------------------------------------------------------------------

let authResolved = false;
const authBackstop = setTimeout(() => {
  if (!authResolved) {
    authResolved = true;
    renderAuthState();
  }
}, 8000);

function renderAuthState() {
  if (!authResolved) {
    // Neutral: no claim either way until Firebase answers.
    whoEl.hidden = true;
    signinBtn.hidden = true;
    return;
  }
  const signedIn = currentUser !== null;
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
      setStatus('');
    });
    whoEl.append('Signed in as ', name, ' · ', out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
  }
}

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setStatus(r.error, r.ownerAction ? 'owner' : 'warn');
  else if (r.cancelled) setStatus('');
});

// ---------------------------------------------------------------------------
// Rendering — duplicated from find.js's rowCard/coverFor/metaBits on purpose
// ---------------------------------------------------------------------------

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

/** One row inside an expanded universe. No inner "everything in X" button —
 * we are already inside that universe, so it would just re-fetch itself. */
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

  li.appendChild(body);
  return li;
}

function groupHeading(text) {
  const h = document.createElement('h3');
  h.className = 'find-group';
  h.textContent = text;
  return h;
}

/** Renders one /api/universe/:name answer into `body` (the row's expand slot). */
function renderUniverseBody(body, data) {
  body.innerHTML = '';

  if (data.reason === 'no_catalogs_visible') {
    const p = document.createElement('p');
    p.className = 'uni-note';
    p.textContent = 'Your account currently has no catalogs visible. An approver can restore them.';
    body.appendChild(p);
    return;
  }

  if (!data.matches.length) {
    const p = document.createElement('p');
    p.className = 'uni-note';
    p.textContent = `Nothing in any catalog sits in ${data.universe} right now.`;
    body.appendChild(p);
    return;
  }

  const caveat = document.createElement('p');
  caveat.className = 'find-caveat';
  caveat.textContent =
    'A result means it is in the catalog — some entries are wanted, not owned. ' +
    'Tap through to the owning catalog for owned-versus-wanted.';
  body.appendChild(caveat);

  const groups = [
    { name: 'Books & audiobooks', rows: data.matches.filter((m) => m.source === 'library' || m.source === 'audiobook') },
    { name: 'Board games', rows: data.matches.filter((m) => m.source === 'game') },
  ];
  for (const g of groups) {
    if (!g.rows.length) continue;
    body.appendChild(groupHeading(g.name));
    const ul = document.createElement('ul');
    ul.className = 'hits';
    for (const row of g.rows) ul.appendChild(rowCard(row));
    body.appendChild(ul);
  }
}

/** The index's own error vocabulary (find.js's callIndex switch, trimmed to
 * what this page can hit — it never sends a malformed request itself). */
function errorNote(status, errCode) {
  switch (errCode) {
    case 'estate_pending':
      return 'Your account is awaiting approval. An approver admits new members; nothing more for you to do.';
    case 'estate_revoked':
      return 'Your access has been revoked.';
    case 'estate_unreachable':
      return 'The estate directory did not answer, so new admissions cannot be checked right now. Try again shortly.';
    case 'unauthenticated':
      return 'The index did not accept the sign-in token. Sign out and back in.';
    default:
      return `Could not load this universe (${status}${errCode ? `: ${errCode}` : ''}).`;
  }
}

// ---------------------------------------------------------------------------
// The list — 7 hardcoded rows, each a lazy fetch on first expand
// ---------------------------------------------------------------------------

function buildRows() {
  listEl.innerHTML = '';
  for (const name of UNIVERSE_NAMES) {
    const li = document.createElement('li');
    li.className = 'uni-row';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'uni-toggle';
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = name;

    const body = document.createElement('div');
    body.className = 'uni-body';
    body.hidden = true;

    // Re-populate when the auth boundary is crossed while a row has already
    // rendered its OTHER side (a member's contents, or the sign-in note).
    let renderedFor = null; // 'member' | 'anon' | null

    btn.addEventListener('click', () => {
      if (!authResolved) return; // neutral boot: no claims either way yet
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        btn.setAttribute('aria-expanded', 'false');
        body.hidden = true;
        return;
      }
      btn.setAttribute('aria-expanded', 'true');
      body.hidden = false;
      const wantFor = currentUser ? 'member' : 'anon';
      if (renderedFor === wantFor) return; // already showing the right content
      renderedFor = wantFor;
      populate(body, name, () => renderedFor === wantFor);
    });

    li.append(btn, body);
    listEl.appendChild(li);
  }
}

async function populate(body, name, stillCurrent) {
  if (!currentUser) {
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'uni-note';
    p.textContent = `The universe view spans every shelf, so it needs a sign-in. Sign in to see everything in ${name}.`;
    body.appendChild(p);
    return;
  }

  body.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'uni-note';
  loading.textContent = `Loading ${name}…`;
  body.appendChild(loading);

  const token = await idToken();
  if (!stillCurrent()) return;
  if (!token) {
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'uni-note';
    p.textContent = 'Your sign-in has lapsed — sign in again.';
    body.appendChild(p);
    return;
  }

  let res;
  try {
    res = await fetch(`${INDEX_ORIGIN}/api/universe/${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    if (!stillCurrent()) return;
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'uni-note';
    p.textContent = 'The index did not answer (network). Try again shortly.';
    body.appendChild(p);
    return;
  }
  if (!stillCurrent()) return;

  if (!res.ok) {
    let errBody = null;
    try { errBody = await res.json(); } catch (e) { /* non-JSON error body; status still speaks */ }
    if (!stillCurrent()) return;
    body.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'uni-note';
    p.textContent = errorNote(res.status, errBody?.error);
    body.appendChild(p);
    return;
  }

  const data = await res.json();
  if (!stillCurrent()) return;
  renderUniverseBody(body, data);
}

buildRows();

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

watchAuth((user) => {
  authResolved = true;
  clearTimeout(authBackstop);
  const changed = currentUser !== user;
  currentUser = user;
  renderAuthState();
  // Any row already expanded on the wrong side of the boundary (signed in
  // while showing the sign-in note, or vice versa after sign-out) needs a
  // re-render — cheapest correct fix is rebuilding the collapsed list; a
  // signed-out visitor loses nothing since nothing was fetched for them.
  if (changed) buildRows();
});

renderAuthState();

// Complete a redirect sign-in if one is landing (must run on every load).
handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
