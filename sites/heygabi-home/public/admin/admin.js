/**
 * admin.js — the estate member directory page at heygabi.ai/admin.
 *
 * Thin by design: every decision (who may call, what a status transition
 * means, the never-delete rule, the OWNER_EMAILS break-glass) lives in the
 * auth Worker (catalog-platform/apps/auth-worker). This page signs in,
 * sends the Firebase ID token as a bearer, and renders what the APIs say.
 *
 * ## Federation, not centralization (estate-auth-design.md §1.2/§4.5)
 *
 * One row per person shows three different kinds of fact, each fetched from
 * and written to the system that owns it:
 *
 *   - estate STATUS (pending/approved/revoked) + approver — the auth Worker
 *   - per-catalog VISIBILITY (which shelves their search sees) — also the
 *     auth Worker (§4.5; the stored set, canonical order)
 *   - per-app ROLES — each app's OWN /api/admin surface, in each app's OWN
 *     vocabulary, verbatim: library `owner|manager|reader|pending`, games
 *     `owner|manager|rater|viewer|pending`. ⚠️ `reader` ≠ `viewer` — the
 *     dropdowns list what each endpoint answers and never translate. The
 *     audiobook catalog has no roles by design (world-readable site), so its
 *     cell says so instead of pretending.
 *
 * A per-app fetch failure degrades to that app's cell reading "unreachable";
 * the directory and every other column keep working.
 *
 * The APIs:
 *   auth.heygabi.ai (CORS locked to https://heygabi.ai):
 *     GET  /api/estate/users               → { users: [...] }  (pending first)
 *     POST /api/estate/users/:id/status    { status: 'approved' | 'revoked' }
 *     POST /api/estate/users/:id/approver  { is_approver: boolean }
 *     POST /api/estate/users/:id/visibility { visibility: ['audiobook', ...] }
 *   library.heygabi.ai + boardgames.heygabi.ai (same CORS lock, each app's
 *   own owner-only `manageUsers` gate — this page holds no credential; the
 *   caller's own bearer must be an owner THERE to change anything there):
 *     GET   /api/admin/users               → { app, roles, users: [{id,email,displayName,role}] }
 *     PATCH /api/admin/users/:id/role      { role: <one of that app's roles> }
 *
 * ⚠️ Because every Worker's CORS names https://heygabi.ai exactly, this page
 * does not work from www.heygabi.ai or a local file. That is the Workers'
 * config being right, not a bug here — the page says so instead of failing
 * mutely.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';

/** §4.5's canonical catalog order — never re-sorted, never duplicated. */
const CATALOGS = ['audiobook', 'library', 'games'];

/** The two apps with roles to federate. The audiobook column is a note. */
const APPS = [
  { key: 'library', label: 'library', origin: 'https://library.heygabi.ai' },
  { key: 'games', label: 'games', origin: 'https://boardgames.heygabi.ai' },
];

const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const refreshBtn = document.getElementById('refresh');
const statusEl = document.getElementById('status');
const usersEl = document.getElementById('users');
const gapsEl = document.getElementById('gaps');

let currentUser = null;

/**
 * Per-app directory state, keyed by app key:
 *   null                                  — not loaded yet
 *   { ok: true, roles, byEmail }          — that app's list + vocabulary
 *   { ok: false, why }                    — degraded; why is shown in-cell
 */
let appDirs = { library: null, games: null };

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
  statusEl.hidden = !text;
}

// ---------------------------------------------------------------------------
// API calls — the auth Worker (directory + visibility)
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

// ---------------------------------------------------------------------------
// API calls — the app Workers (federated roles)
// ---------------------------------------------------------------------------

/**
 * One app's member list + role vocabulary, or the reason it degraded.
 * Never throws: a broken app becomes an honest cell, not a broken page.
 */
async function fetchAppDirectory(app) {
  const token = await idToken();
  if (!token) return { ok: false, why: 'sign-in lapsed' };
  let res;
  try {
    res = await fetch(`${app.origin}/api/admin/users`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, why: 'token refused' };
  if (res.status === 403) return { ok: false, why: 'needs an owner account there' };
  if (!res.ok) return { ok: false, why: `error ${res.status}` };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: 'unreadable answer' };
  }
  const byEmail = new Map();
  for (const u of data.users ?? []) byEmail.set(String(u.email).toLowerCase(), u);
  return { ok: true, roles: Array.isArray(data.roles) ? data.roles : [], byEmail };
}

/** PATCH one role change to one app. True on success; failures explain themselves. */
async function patchAppRole(app, appUserId, role) {
  const token = await idToken();
  if (!token) {
    setStatus('Sign-in lapsed — sign in again.', 'warn');
    return false;
  }
  let res;
  try {
    res = await fetch(`${app.origin}/api/admin/users/${appUserId}/role`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  } catch (e) {
    setStatus(`The ${app.label} catalog did not answer — the role is unchanged.`, 'warn');
    return false;
  }
  if (res.ok) {
    setStatus('');
    return true;
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* the status code still speaks */ }
  const detail = typeof body?.detail === 'string' ? body.detail : null;
  setStatus(`${app.label}: ${detail || `role change refused (${res.status})`}`, 'warn');
  return false;
}

// ---------------------------------------------------------------------------
// Loading — the directory and both app lists, in parallel
// ---------------------------------------------------------------------------

async function loadDirectory() {
  setStatus('Loading…');
  const [estate, library, games] = await Promise.all([
    api('/api/estate/users'),
    fetchAppDirectory(APPS[0]),
    fetchAppDirectory(APPS[1]),
  ]);
  appDirs = { library, games };
  if (!estate) {
    // api() already said why. The app lists are useless without the spine.
    usersEl.innerHTML = '';
    gapsEl.hidden = true;
    return;
  }
  setStatus('');
  renderUsers(estate.users);
  renderSeedGaps(estate.users);
}

async function mutate(path, body) {
  const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
  if (data) await loadDirectory();
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

/**
 * Save the visibility set as the checkboxes now stand — the whole array in
 * §4.5's canonical order, because the endpoint takes the set, not a delta.
 */
async function saveVisibility(estateUser, catsEl) {
  const boxes = [...catsEl.querySelectorAll('input[type="checkbox"]')];
  for (const b of boxes) b.disabled = true;
  const visibility = CATALOGS.filter(
    (cat) => boxes.find((b) => b.dataset.cat === cat)?.checked,
  );
  const data = await api(`/api/estate/users/${estateUser.id}/visibility`, {
    method: 'POST',
    body: JSON.stringify({ visibility }),
  });
  if (data) {
    await loadDirectory(); // re-render from what the server now says
  } else {
    for (const b of boxes) b.disabled = false; // failed — leave them editable
  }
}

/** The role cell for one app: a dropdown, or the honest reason there isn't one. */
function appRoleCell(app, estateUser) {
  const dir = appDirs[app.key];
  const cell = document.createElement('span');

  if (!dir || !dir.ok) {
    cell.className = 'cat-warn';
    cell.textContent = dir?.why ?? 'not loaded';
    return cell;
  }

  const appUser = dir.byEmail.get(estateUser.email.toLowerCase());
  if (!appUser) {
    // The app creates its row on the person's first sign-in there — until
    // then there is nothing to hold a role. Not an error.
    cell.className = 'cat-note';
    cell.textContent = 'no account yet — appears on first sign-in';
    return cell;
  }

  const select = document.createElement('select');
  select.setAttribute('aria-label', `${app.label} role for ${estateUser.email}`);
  for (const role of dir.roles) {
    const opt = document.createElement('option');
    opt.value = role;
    opt.textContent = role;
    if (role === appUser.role) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', async () => {
    select.disabled = true;
    const ok = await patchAppRole(app, appUser.id, select.value);
    if (ok) {
      appUser.role = select.value; // keep the map truthful without a refetch
    } else {
      select.value = appUser.role; // refused — snap back to what stands
    }
    select.disabled = false;
  });
  cell.className = 'cat-role';
  cell.appendChild(select);
  return cell;
}

/** One catalog line: name, visibility checkbox, role cell. */
function catalogRow(estateUser, catKey, roleCell) {
  const row = document.createElement('div');
  row.className = 'cat';

  const name = document.createElement('span');
  name.className = 'cat-name';
  name.textContent = catKey;
  row.appendChild(name);

  if (Array.isArray(estateUser.visibility)) {
    const vis = document.createElement('label');
    vis.className = 'cat-vis';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.dataset.cat = catKey;
    box.checked = estateUser.visibility.includes(catKey);
    box.addEventListener('change', () => saveVisibility(estateUser, row.parentElement));
    vis.append(box, ' visible');
    row.appendChild(vis);
  }

  row.appendChild(roleCell);
  return row;
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

  // The federated catalog block: per catalog, the estate's visibility flag
  // (what their search may SEE) beside the app's own role (what they may DO
  // there — each app's words, each app's decision).
  const cats = document.createElement('div');
  cats.className = 'cats';

  const abNote = document.createElement('span');
  abNote.className = 'cat-note';
  abNote.textContent = 'public site — no roles to grant';
  cats.appendChild(catalogRow(u, 'audiobook', abNote));

  for (const app of APPS) {
    cats.appendChild(catalogRow(u, app.key, appRoleCell(app, u)));
  }
  li.appendChild(cats);

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

/**
 * An app listing an email the estate directory does not hold means the seed
 * missed someone (§9 step 2 is idempotent and re-runnable) — say so rather
 * than silently rendering a directory that disagrees with its apps.
 */
function renderSeedGaps(estateUsers) {
  const known = new Set(estateUsers.map((u) => u.email.toLowerCase()));
  const lines = [];
  for (const app of APPS) {
    const dir = appDirs[app.key];
    if (!dir?.ok) continue;
    const extras = [...dir.byEmail.keys()].filter((e) => !known.has(e));
    if (extras.length) {
      lines.push(
        `The ${app.label} catalog also lists ${extras.join(', ')} — not in the estate directory (a seed gap; re-run the seed).`,
      );
    }
  }
  gapsEl.textContent = lines.join(' ');
  gapsEl.hidden = !lines.length;
}

// ---------------------------------------------------------------------------
// Auth wiring
// ---------------------------------------------------------------------------

/**
 * ⚠️ The sign-in flash, same bug find.js fixed and the owner then met HERE
 * (live, 2026-08-14): Firebase reads its persisted session asynchronously,
 * so a page that renders signed-out immediately shows a signed-in owner the
 * sign-in button for however long the SDK takes. The markup now ships the
 * button hidden; nothing decisive renders until watchAuth's first callback.
 * The 8s backstop covers the SDK never answering (blocked gstatic).
 */
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
      gapsEl.hidden = true;
      setStatus('');
    });
    whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    usersEl.innerHTML = '';
    gapsEl.hidden = true;
  }
}

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setStatus(r.error, r.ownerAction ? 'owner' : 'warn');
});

refreshBtn.addEventListener('click', loadDirectory);

watchAuth((user) => {
  authResolved = true;
  clearTimeout(authBackstop);
  currentUser = user;
  renderAuthState();
  if (user) loadDirectory();
});

renderAuthState();
setStatus('Sign in to see the member list. The page is API-gated — nothing loads without an approver token.');

handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
