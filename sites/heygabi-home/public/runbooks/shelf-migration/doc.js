/**
 * doc.js — the estate-runbook shim's auth + fetch, /todo/todo.js's
 * idiom applied to GET /api/estate/docs/shelf-migration (0003 devops). Thin by
 * design: every decision (who may read, what the content is) lives in the
 * auth Worker (src/docs.ts + the estate_docs KV namespace). A 200 IS the
 * devops probe; 401/403 leave a quiet refusal, never content. Neutral boot
 * + 8s backstop ported verbatim — the flash-of-sign-in bug was found live.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';
const DOC_SLUG = 'shelf-migration';

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
    setGateStatus(`The document did not load (${res.status}). Try again shortly.`);
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
