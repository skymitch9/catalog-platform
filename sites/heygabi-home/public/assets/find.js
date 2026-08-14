/**
 * find.js — the global search in the front door's #find slot.
 *
 * The contract (estate-auth-design.md §7, index-worker-design.md §3.3):
 *   - the PAGE stays public; the SEARCH is estate-members-only. Signed out,
 *     the box asks for a sign-in; signed in, every query sends the Firebase
 *     ID token as a bearer to index.heygabi.ai, which verifies it locally and
 *     checks estate membership. This page holds no membership logic at all —
 *     the canonical module lives server-side and the browser's whole job is
 *     sign-in + bearer.
 *
 * ⚠️ WHAT A RESULT MEANS — the index design's own words: a hit means "in your
 *   catalog — tap through for owned-vs-wanted", NEVER "you own this".
 *   Ownership deliberately does not travel to the index (29 of the 836 game
 *   rows are wanted-only). The caveat line under the results is load-bearing
 *   copy, not decoration; do not "tidy" it into a claim of ownership.
 *
 * Rendering groups per the index design's two tiers:
 *   - books tier (source library/audiobook): same work, any format —
 *     work_fold joins these server-side; here they are one group.
 *   - games: matched on title alone, carrying `kind` and `parent_source_id`
 *     (expansions point at their base game). Games are never the same *work*
 *     as a book; the only cross-format join they take part in is the
 *     universe tier, offered here as a "everything in <universe>" follow-up
 *     that calls /api/universe/:name.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from './estate-auth.js';

const INDEX_ORIGIN = 'https://index.heygabi.ai';

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
  input.disabled = !signedIn;
  submitBtn.hidden = !signedIn;
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
      resultsEl.innerHTML = '';
      setStatus('');
    });
    whoEl.append('Signed in as ', name, ' · ', out);
    whoEl.hidden = false;
    input.placeholder = 'A title — book, audiobook or board game';
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    input.placeholder = 'Sign in to search';
  }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function sourceLabel(source) {
  return source === 'game' ? 'board games'
    : source === 'library' ? 'library'
    : source === 'audiobook' ? 'audiobooks'
    : source;
}

function rowCard(row) {
  const li = document.createElement('li');
  li.className = 'hit';

  if (row.cover_url) {
    const img = document.createElement('img');
    img.className = 'hit-cover';
    img.alt = '';
    img.loading = 'lazy';
    img.src = row.cover_url;
    // A cover host missing from the CSP img-src list, or a dead hotlink,
    // fails here — hide the box rather than show a broken-image glyph.
    img.addEventListener('error', () => img.remove());
    li.appendChild(img);
  }

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
  const bits = [];
  if (row.creator) bits.push(row.creator);
  bits.push(row.format);
  if (row.kind && row.kind !== 'base') bits.push(row.kind);
  if (row.parent_source_id) bits.push('belongs with a base game');
  if (row.series) bits.push(row.series_index != null ? `${row.series} #${row.series_index}` : row.series);
  if (row.year) bits.push(String(row.year));
  if (row.publisher) bits.push(row.publisher);
  meta.textContent = bits.join(' · ');
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
  return li;
}

function renderGroups(matches, headingText) {
  resultsEl.innerHTML = '';

  if (!matches.length) {
    setStatus('Nothing in any catalog matches that title exactly. The search joins on the exact title — try the full title, or browse the shelf that would hold it.');
    return;
  }

  const heading = document.createElement('p');
  heading.className = 'find-caveat';
  // ⚠️ Load-bearing copy (see file header): in-catalog, not owned.
  heading.textContent =
    `${headingText} A result means it is in the catalog — some entries are wanted, not owned. ` +
    'Tap through to the owning catalog for owned-versus-wanted.';
  resultsEl.appendChild(heading);

  // Books tier first (same work, any format), then games (title-only match).
  const groups = [
    { name: 'Books & audiobooks — same work, any format', rows: matches.filter((m) => m.source === 'library' || m.source === 'audiobook') },
    { name: 'Board games — matched on title', rows: matches.filter((m) => m.source === 'game') },
  ];

  for (const g of groups) {
    if (!g.rows.length) continue;
    const h = document.createElement('h3');
    h.className = 'find-group';
    h.textContent = g.name;
    resultsEl.appendChild(h);
    const ul = document.createElement('ul');
    ul.className = 'hits';
    for (const row of g.rows) ul.appendChild(rowCard(row));
    resultsEl.appendChild(ul);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function callIndex(path) {
  const token = await idToken();
  if (!token) {
    setStatus('Your sign-in has lapsed — sign in again.', 'warn');
    return null;
  }
  let res;
  try {
    res = await fetch(`${INDEX_ORIGIN}${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
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

async function runLookup(title) {
  setStatus('Searching…');
  const data = await callIndex(`/api/lookup?title=${encodeURIComponent(title)}`);
  if (!data) return;
  setStatus('');
  renderGroups(data.matches, `Matches for “${data.query}”.`);
}

async function runUniverse(name) {
  setStatus(`Everything in ${name}…`);
  const data = await callIndex(`/api/universe/${encodeURIComponent(name)}`);
  if (!data) return;
  setStatus('');
  renderGroups(data.matches, `Everything in ${data.universe} — every catalog, every format.`);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  if (!currentUser) return;
  runLookup(q);
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
  // decisively, in whichever direction the answer went.
  authResolved = true;
  clearTimeout(authBackstop);
  currentUser = user;
  renderAuthState();
});

renderAuthState();

// Complete a redirect sign-in if one is landing (must run on every load —
// the mobile/in-app-browser flow depends on it; identity.js's rule, kept).
handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
