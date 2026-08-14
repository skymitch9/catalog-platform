/**
 * admin.js — the estate member directory page at heygabi.ai/admin.
 *
 * Thin by design: every decision (who may call, what a status transition
 * means, the never-delete rule, the OWNER_EMAILS break-glass) lives in the
 * auth Worker (catalog-platform/apps/auth-worker). This page signs in,
 * sends the Firebase ID token as a bearer, and renders what the API says.
 *
 * The API (auth.heygabi.ai, CORS locked to https://heygabi.ai):
 *   GET  /api/estate/users               → { users: [...] }  (pending first)
 *   POST /api/estate/users/:id/status    { status: 'approved' | 'revoked' }
 *   POST /api/estate/users/:id/approver  { is_approver: boolean }
 *
 * ⚠️ Because the Worker's CORS names https://heygabi.ai exactly, this page
 * does not work from www.heygabi.ai or a local file. That is the Worker's
 * config being right, not a bug here — the page says so instead of failing
 * mutely.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';

const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const refreshBtn = document.getElementById('refresh');
const statusEl = document.getElementById('status');
const usersEl = document.getElementById('users');

let currentUser = null;

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
  statusEl.hidden = !text;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function api(path, init) {
  const token = await idToken();
  if (!token) {
    setStatus('Sign-in lapsed — sign in again.', 'warn');
    return null;
  }
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch (e) {
    // On the wrong origin the browser reports CORS failures as a bare
    // network error — say the likely cause instead of "failed to fetch".
    if (location.origin !== CANONICAL_ORIGIN) {
      setStatus(
        `The auth Worker did not answer. Its admin API only accepts calls from ${CANONICAL_ORIGIN} — ` +
        `this page is running on ${location.origin}, so use ${CANONICAL_ORIGIN}/admin instead.`,
        'warn',
      );
    } else {
      setStatus('The auth Worker did not answer (network). Try again shortly.', 'warn');
    }
    return null;
  }

  if (res.ok) return res.json();

  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* the status code still speaks */ }

  switch (res.status) {
    case 401:
      setStatus('The directory did not accept the sign-in token. Sign out and back in.', 'warn');
      break;
    case 403:
      setStatus(
        'This page needs an approver account. You are signed in, but approving members is itself an ' +
        'approver-only power — an existing approver (or an owner email) can grant it from this page.',
        'warn',
      );
      break;
    case 409:
      // e.g. promoting someone who is not yet approved — the API's own words.
      setStatus(body?.detail || body?.error || 'That change is not coherent yet.', 'warn');
      break;
    default:
      setStatus(`Request failed (${res.status}${body?.error ? `: ${body.error}` : ''}).`, 'warn');
  }
  return null;
}

async function loadUsers() {
  setStatus('Loading…');
  const data = await api('/api/estate/users');
  if (!data) {
    usersEl.innerHTML = '';
    return;
  }
  setStatus('');
  renderUsers(data.users);
}

async function mutate(path, body) {
  const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
  if (data) await loadUsers();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function actionBtn(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn small ${className || ''}`.trim();
  b.textContent = label;
  b.addEventListener('click', async () => {
    b.disabled = true;
    await onClick();
    b.disabled = false;
  });
  return b;
}

function userCard(u) {
  const li = document.createElement('li');
  li.className = 'user';

  const head = document.createElement('div');
  head.className = 'user-head';

  const name = document.createElement('span');
  name.className = 'user-name';
  name.textContent = u.display_name || u.email;
  head.appendChild(name);

  if (u.display_name) {
    const email = document.createElement('span');
    email.className = 'user-email';
    email.textContent = u.email;
    head.appendChild(email);
  }

  const badge = document.createElement('span');
  badge.className = `badge ${u.status}`;
  badge.textContent = u.status;
  head.appendChild(badge);

  if (u.is_approver) {
    const ap = document.createElement('span');
    ap.className = 'badge approved';
    ap.textContent = 'approver';
    head.appendChild(ap);
  }

  li.appendChild(head);

  const meta = document.createElement('p');
  meta.className = 'user-meta';
  const bits = [`origin ${u.origin}`, `first seen ${u.first_seen_at}`];
  if (u.decided_at) bits.push(`decided ${u.decided_at}`);
  meta.textContent = bits.join(' · ');
  li.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'user-actions';

  if (u.status !== 'approved') {
    actions.appendChild(actionBtn('Approve', '', () =>
      mutate(`/api/estate/users/${u.id}/status`, { status: 'approved' })));
  }
  if (u.status !== 'revoked') {
    actions.appendChild(actionBtn('Revoke', 'danger', () =>
      mutate(`/api/estate/users/${u.id}/status`, { status: 'revoked' })));
  }
  if (u.status === 'approved') {
    actions.appendChild(u.is_approver
      ? actionBtn('Remove approver', 'quiet', () =>
          mutate(`/api/estate/users/${u.id}/approver`, { is_approver: false }))
      : actionBtn('Make approver', 'quiet', () =>
          mutate(`/api/estate/users/${u.id}/approver`, { is_approver: true })));
  }

  li.appendChild(actions);
  return li;
}

function renderUsers(users) {
  usersEl.innerHTML = '';
  if (!users.length) {
    setStatus('The directory is empty. Owner emails still work everywhere (the break-glass), and the seed script fills this list.');
    return;
  }
  for (const u of users) usersEl.appendChild(userCard(u));
}

// ---------------------------------------------------------------------------
// Auth wiring
// ---------------------------------------------------------------------------

function renderAuthState() {
  const signedIn = currentUser !== null;
  signinBtn.hidden = signedIn;
  refreshBtn.hidden = !signedIn;
  if (signedIn) {
    whoEl.innerHTML = '';
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'linkbtn';
    out.textContent = 'sign out';
    out.addEventListener('click', async () => {
      await signOutUser();
      usersEl.innerHTML = '';
      setStatus('');
    });
    whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    usersEl.innerHTML = '';
  }
}

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setStatus(r.error, r.ownerAction ? 'owner' : 'warn');
});

refreshBtn.addEventListener('click', loadUsers);

watchAuth((user) => {
  currentUser = user;
  renderAuthState();
  if (user) loadUsers();
});

renderAuthState();
setStatus('Sign in to see the member list. The page is API-gated — nothing loads without an approver token.');

handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
