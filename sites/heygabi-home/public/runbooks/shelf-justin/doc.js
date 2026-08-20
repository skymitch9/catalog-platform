/**
 * doc.js — the estate-runbook shim's auth + fetch, /todo/todo.js's
 * idiom applied to GET /api/estate/docs/shelf-justin (0003 devops). Thin by
 * design: every decision (who may read, what the content is) lives in the
 * auth Worker (src/docs.ts + the estate_docs KV namespace). A 200 IS the
 * devops probe; 401/403 leave a quiet refusal, never content. Neutral boot
 * + 8s backstop ported verbatim — the flash-of-sign-in bug was found live.
 *
 * ALSO drives #facts-card (0007, 2026-08-16): the same devops sign-in that
 * unlocks the document unlocks the facts form — loadFacts()/saveFacts()
 * below hit GET/POST /api/estate/facts/shelf (src/facts.ts), sharing this
 * file's token/auth plumbing rather than standing up a second gate. Every
 * value that comes back from that API is written with `.value =` (inputs)
 * or `textContent` (status/meta text) — never `innerHTML` — which is the
 * actual escaping boundary for content Justin typed into the form; nothing
 * server-side re-escapes it, because a JSON string cannot execute as markup
 * through either of those two DOM APIs regardless of what it contains.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';
const DOC_SLUG = 'shelf-justin';
const FACTS_SLUG = 'shelf';
const FACT_FIELDS = ['hardware', 'os', 'disk_free', 'library_size', 'notes'];

const gateMain = document.getElementById('gate-main');
const gateStatusEl = document.getElementById('gate-status');
const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const docMount = document.getElementById('doc-mount');

const factsCard = document.getElementById('facts-card');
const factsForm = document.getElementById('facts-form');
const factsSaveBtn = document.getElementById('facts-save');
const factsStatusEl = document.getElementById('facts-status');
const factsMetaEl = document.getElementById('facts-meta');
const factsInputs = Object.fromEntries(FACT_FIELDS.map((f) => [f, factsForm.elements.namedItem(f)]));

let currentUser = null;
let docLoaded = false;

function setGateStatus(text) {
  gateStatusEl.textContent = text || '';
  gateStatusEl.hidden = !text;
}

function setFactsStatus(text, isError) {
  factsStatusEl.textContent = text || '';
  factsStatusEl.classList.toggle('err', Boolean(isError));
}

function setFactsMeta(facts) {
  if (facts && facts.submitted_by) {
    const parsed = new Date(facts.submitted_at);
    const when = Number.isNaN(parsed.getTime())
      ? facts.submitted_at
      : parsed.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    factsMetaEl.textContent = `Last saved by ${facts.submitted_by} on ${when}.`;
    factsMetaEl.hidden = false;
  } else {
    factsMetaEl.textContent = '';
    factsMetaEl.hidden = true;
  }
}

// GET the current facts and pre-fill the form — this is what makes the form
// an EDIT, not just a create: re-visiting shows what is already saved.
async function loadFacts() {
  const token = await idToken();
  if (!token) return; // the gate itself will already be showing "sign in again"

  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/facts/${FACTS_SLUG}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    setFactsStatus('Could not load the saved facts (network). Your edits below still save.', true);
    return;
  }
  if (!res.ok) {
    // §1e: never a bare HTTP status alone. The form still works for a fresh
    // save even if the pre-fill failed to load.
    setFactsStatus('Could not load the saved facts. Your edits below still save.', true);
    return;
  }
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return;
  }
  const facts = data && data.facts;
  for (const field of FACT_FIELDS) {
    factsInputs[field].value = facts ? facts[field] || '' : '';
  }
  setFactsMeta(facts);
}

async function saveFacts(ev) {
  ev.preventDefault();
  const token = await idToken();
  if (!token) {
    setFactsStatus('Sign-in lapsed — sign in again, then save.', true);
    return;
  }

  factsSaveBtn.disabled = true;
  setFactsStatus('Saving…', false);

  const body = {};
  for (const field of FACT_FIELDS) body[field] = factsInputs[field].value;

  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/facts/${FACTS_SLUG}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    factsSaveBtn.disabled = false;
    setFactsStatus('Could not reach the save service (network). Try again shortly.', true);
    return;
  }

  factsSaveBtn.disabled = false;

  if (res.status === 401 || res.status === 403) {
    setFactsStatus('Only devops accounts can save these facts.', true);
    return;
  }
  if (res.status === 400) {
    let detail = '';
    try {
      detail = (await res.json()).detail || '';
    } catch (e) {
      // fall through with no detail
    }
    setFactsStatus(detail ? `That didn't save — ${detail}.` : "That didn't save — check the fields and try again.", true);
    return;
  }
  if (!res.ok) {
    // §1e: never a bare HTTP status alone.
    setFactsStatus('The save didn’t go through. Try again shortly.', true);
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    setFactsStatus('Saved, but the confirmation was unreadable — reload to check.', true);
    return;
  }
  setFactsStatus('Saved.', false);
  setFactsMeta(data && data.facts);
}

factsForm.addEventListener('submit', saveFacts);

function resetDoc() {
  docLoaded = false;
  gateMain.hidden = false;
  docMount.innerHTML = '';
  factsCard.hidden = true;
  setFactsStatus('', false);
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

  // The devops proof that just unlocked the document ALSO unlocks the facts
  // form — same caller, same gate, no second round-trip needed to decide
  // visibility. loadFacts() has its own error handling and never blocks the
  // document from showing.
  factsCard.hidden = false;
  loadFacts();
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
