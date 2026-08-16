/**
 * doc.js — the estate-runbook shim's auth + fetch, /todo/todo.js's
 * idiom applied to GET /api/estate/docs/shelf-server (0003 devops). Thin by
 * design: every decision (who may read, what the content is) lives in the
 * auth Worker (src/docs.ts + the estate_docs KV namespace). A 200 IS the
 * devops probe; 401/403 leave a quiet refusal, never content. Neutral boot
 * + 8s backstop ported verbatim — the flash-of-sign-in bug was found live.
 *
 * ALSO fills in the §0 facts table (0007, 2026-08-16 — see index.html's
 * header for the client-vs-server design note). After the document renders,
 * fillFacts() fetches GET /api/estate/facts/shelf and writes each value into
 * the fragment's own `[data-fact="…"]` cells with `textContent` — never
 * `innerHTML` — because that value was typed by Justin into a browser and
 * this is the point it gets rendered back out; textContent cannot execute
 * markup regardless of what the string contains, which is the actual
 * escaping boundary here (nothing server-side re-escapes it). A facts-fetch
 * failure is swallowed quietly: the fragment's own default placeholder text
 * stays exactly as written, and the document the caller came to read is
 * never blocked on it.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';
const DOC_SLUG = 'shelf-server';
const FACTS_SLUG = 'shelf';
const FACT_FIELDS = ['hardware', 'os', 'disk_free', 'library_size', 'notes'];

const gateMain = document.getElementById('gate-main');
const gateStatusEl = document.getElementById('gate-status');
const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const docMount = document.getElementById('doc-mount');

let currentUser = null;
let docLoaded = false;

function setGateStatus(text) {
  gateStatusEl.textContent = text || '';
  gateStatusEl.hidden = !text;
}

function resetDoc() {
  docLoaded = false;
  gateMain.hidden = false;
  docMount.innerHTML = '';
}

async function loadDoc() {
  const token = await idToken();
  if (!token) {
    setGateStatus('Sign-in lapsed — sign in again.');
    return;
  }

  setGateStatus('Loading…');

  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/docs/${DOC_SLUG}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    if (location.origin !== CANONICAL_ORIGIN) {
      setGateStatus(
        `The auth Worker did not answer. This API only accepts calls from ${CANONICAL_ORIGIN} — ` +
        `this page is running on ${location.origin}.`,
      );
    } else {
      setGateStatus('The auth Worker did not answer (network). Try again shortly.');
    }
    return;
  }

  if (res.status === 401 || res.status === 403) {
    setGateStatus('This page is for the estate’s devops and admins. If you were sent this link, ask Skylar to grant your account the devops role.');
    return;
  }
  if (!res.ok) {
    // §1e: never a bare HTTP status alone.
    setGateStatus('The document did not load. Try again shortly.');
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    setGateStatus('The answer was unreadable. Try again shortly.');
    return;
  }
  if (typeof data.html !== 'string' || !data.html) {
    setGateStatus('The answer was empty. Try again shortly.');
    return;
  }

  // The fragment is our own KV-stored content, never user-supplied — safe to
  // inject as markup. It carries its own <style> + <main>; the gate's <main>
  // hides so the page keeps one landmark.
  docMount.innerHTML = data.html;
  docLoaded = true;
  gateMain.hidden = true;

  // Best-effort: never blocks the document above from having already shown.
  fillFacts();
}

/**
 * GET /api/estate/facts/shelf and write each value into the just-rendered
 * fragment's `[data-fact="…"]` cells. Swallows every failure quietly — the
 * fragment's own placeholder text is a perfectly good fallback, and this is
 * decoration on top of a document that already loaded successfully.
 */
async function fillFacts() {
  let token;
  try {
    token = await idToken();
  } catch (e) {
    return;
  }
  if (!token) return;

  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/facts/${FACTS_SLUG}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return;
  }
  if (!res.ok) return;

  let data;
  try {
    data = await res.json();
  } catch (e) {
    return;
  }
  const facts = data && data.facts;

  for (const field of FACT_FIELDS) {
    const cell = docMount.querySelector(`[data-fact="${field}"]`);
    if (!cell) continue;
    const value = facts ? facts[field] : '';
    if (value && value.trim()) cell.textContent = value;
    // else: leave the fragment's own default placeholder text untouched.
  }

  const metaEl = docMount.querySelector('[data-fact="meta"]');
  if (metaEl) {
    if (facts && facts.submitted_by) {
      const parsed = new Date(facts.submitted_at);
      const when = Number.isNaN(parsed.getTime())
        ? facts.submitted_at
        : parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      metaEl.textContent = `Entered by ${facts.submitted_by} on ${when}.`;
    }
    // else: leave the fragment's own default "not yet entered" text.
  }
}

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
      resetDoc();
      setGateStatus('Sign in to read this page.');
    });
    whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    if (docLoaded) resetDoc();
    setGateStatus('Sign in to read this page.');
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
  if (user) loadDoc();
});

renderAuthState();
setGateStatus('Checking sign-in…');

handleRedirectResult().then((err) => {
  if (err) setGateStatus(err);
});
