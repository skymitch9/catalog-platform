/**
 * todo.js — the estate todo board at heygabi.ai/todo, auth-locked 2026-08-15
 * (owner order: "Auth lock the todo page too").
 *
 * Thin by design, same idiom as ../admin/admin.js: every decision (who may
 * see the board, what the content is) lives in the auth Worker
 * (catalog-platform/apps/auth-worker — src/todo.ts + src/todo-board.ts).
 * This page signs in, sends the Firebase ID token as a bearer to
 * `GET /api/estate/todo`, and renders exactly what comes back. There is no
 * separate "am I allowed?" check — a 200 IS the approver probe, the same
 * fact `/status`'s Operations section and `/admin` both rely on. A 401 or
 * 403 leaves the gate showing a quiet refusal, never board content.
 *
 * ⚠️ The neutral-boot / 8s-backstop pattern is ported verbatim from
 * admin.js, because it fixes a real bug found there live (2026-08-14):
 * Firebase reads its persisted session ASYNCHRONOUSLY, so a page that
 * renders "signed out" immediately shows a signed-in owner a flash of the
 * sign-in button for however long the SDK takes. The sign-in button ships
 * `hidden`; nothing decisive renders until watchAuth's first callback (or
 * the 8s backstop, covering a blocked/slow gstatic load).
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';

const gateMain = document.getElementById('gate-main');
const gateStatusEl = document.getElementById('gate-status');
const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const boardMount = document.getElementById('board-mount');

let currentUser = null;
let boardLoaded = false; // guards against a second fetch racing a stale auth callback

function setGateStatus(text) {
  gateStatusEl.textContent = text || '';
  gateStatusEl.hidden = !text;
}

/** Reset to the pre-board state — used on sign-out and on a failed reload. */
function resetBoard() {
  boardLoaded = false;
  gateMain.hidden = false;
  boardMount.innerHTML = '';
}

/**
 * GET /api/estate/todo with the caller's own bearer. 200 → inject the
 * fragment and hide the gate. 401/403 → the quiet refusal (never board
 * content, never a status-code-specific hint beyond what the URL already
 * reveals). Network/other failures get a plain retry-later message.
 */
async function loadBoard() {
  const token = await idToken();
  if (!token) {
    setGateStatus('Sign-in lapsed — sign in again.');
    return;
  }

  setGateStatus('Loading the board…');

  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/todo`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    // On the wrong origin the browser reports CORS failures as a bare
    // network error — say the likely cause instead of "failed to fetch",
    // same idiom as admin.js's api().
    if (location.origin !== CANONICAL_ORIGIN) {
      setGateStatus(
        `The auth Worker did not answer. Its board API only accepts calls from ${CANONICAL_ORIGIN} — ` +
        `this page is running on ${location.origin}, so use ${CANONICAL_ORIGIN}/todo instead.`,
      );
    } else {
      setGateStatus('The auth Worker did not answer (network). Try again shortly.');
    }
    return;
  }

  if (res.status === 401 || res.status === 403) {
    setGateStatus('This board is for the estate’s admins.');
    return;
  }
  if (!res.ok) {
    setGateStatus(`The board did not load (${res.status}). Try again shortly.`);
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    setGateStatus('The board answer was unreadable. Try again shortly.');
    return;
  }
  if (typeof data.html !== 'string' || !data.html) {
    setGateStatus('The board answer was empty. Try again shortly.');
    return;
  }

  // The fragment is the Worker's own bundled content (todo-board.ts), never
  // user-supplied — safe to inject as markup. It carries its own <main>,
  // so the gate's <main id="gate-main"> is hidden rather than left visible
  // alongside it (one <main> landmark on the page at a time).
  boardMount.innerHTML = data.html;
  boardLoaded = true;
  gateMain.hidden = true;
}

// ---------------------------------------------------------------------------
// Auth wiring — neutral boot + 8s backstop (admin.js's fix, ported).
// ---------------------------------------------------------------------------

let authResolved = false;
const authBackstop = setTimeout(() => {
  if (!authResolved) {
    authResolved = true;
    renderAuthState();
  }
}, 8000);

function renderAuthState() {
  const signedIn = currentUser !== null;
  signinBtn.hidden = signedIn || !authResolved;

  if (signedIn) {
    whoEl.innerHTML = '';
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'linkbtn';
    out.textContent = 'sign out';
    out.addEventListener('click', async () => {
      await signOutUser();
      resetBoard();
      setGateStatus('Sign in to see the board.');
    });
    whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    if (boardLoaded) resetBoard();
    setGateStatus('This board is for the estate’s admins.');
  }
}

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setGateStatus(r.error);
});

watchAuth((user) => {
  authResolved = true;
  clearTimeout(authBackstop);
  currentUser = user;
  renderAuthState();
  if (user) loadBoard();
});

renderAuthState();
setGateStatus('Checking sign-in…');

handleRedirectResult().then((err) => {
  if (err) setGateStatus(err);
});
