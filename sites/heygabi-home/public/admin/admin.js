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
 *     dropdowns list what each endpoint answers and never translate.
 *     ⚠️ THREE app Workers now, not two (2026-08-16): `library2` — the
 *     second library instance at `padhard.heygabi.ai` ("Sam's library",
 *     `library_catalog`'s `[env.friend]`) — runs the SAME Worker code as
 *     library.heygabi.ai, so it answers the same `/api/admin/users` with the
 *     same vocabulary and the same apex-only CORS lock. It is a fourth
 *     managed site here, not a special case: same dropdown, same
 *     strictly-beneath granting (enforced by `canGrantRole` in that repo's
 *     `@lc/core`, server-side), same owner-auto-max rendering. The estate
 *     never redefines what a role means there. The
 *     AUDIOBOOK catalog (world-readable site) grew rules-enforced site
 *     roles 2026-08-14 and was extended 2026-08-16 to the full estate role
 *     LADDER (ROLES.md §1, audiobook_catalog repo — read-only reference):
 *     `guest < member < contributor < moderator < admin < owner`,
 *     cumulative — each role includes everything beneath it. Renamed
 *     mid-build from `viewer`/`reader` (owner decision — those read as
 *     near-synonyms and collided with Google Drive's own vocabulary).
 *     ⚠️ the `member` ROLE (may download) is NOT the same thing as an
 *     "estate member" (approved in the estate directory, the badge/status
 *     column elsewhere on this page) — an approved estate member can still
 *     hold no audiobook role at all (`guest`). `guest` is never stored
 *     (no row = guest) and `owner` is DB-only (no UI/API path ever touches
 *     it — this page cannot grant, revoke, or even display an editable
 *     control for it). They live in ITS system — Firestore
 *     site_roles docs — federated here through the auth Worker's
 *     /api/estate/site-roles (the Worker holds the service account;
 *     browsers can neither list nor write those docs). The Worker enforces
 *     "grant only strictly beneath your own role" server-side; this page
 *     mirrors that by only offering roles GET /site-roles's `grantable`
 *     array names — a row the caller may not touch renders read-only
 *     rather than a dropdown that would just be refused on submit. The full
 *     ladder + what each role does is fetched from
 *     GET /api/estate/site-roles/tree and rendered near the top of the page
 *     (the owner's "role tree map" ask) rather than hardcoded here.
 *
 * The page also offers ADD MEMBER BY EMAIL (POST /api/estate/users, origin
 * 'manual') so pre-seeding a person before their first sign-in never needs
 * a script — the owner's UI-first rule, 2026-08-14.
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
 *     GET  /api/estate/site-roles/tree     → { ladder, grantFloor, capabilities }
 *                                             — the role ladder + capability map
 *   library.heygabi.ai + boardgames.heygabi.ai + padhard.heygabi.ai (same
 *   CORS lock, each app's own `manageUsers` gate — this page holds no
 *   credential; the caller's own bearer must hold that capability THERE to
 *   change anything there. The owner is in `padhard`'s own OWNER_EMAILS
 *   (`library_catalog` wrangler.toml `[env.friend].vars`), which is what
 *   makes his bearer work on her instance):
 *     GET   /api/admin/users               → { app, roles, users: [{id,email,displayName,role}] }
 *     PATCH /api/admin/users/:id/role      { role: <one of that app's roles> }
 *
 * ⚠️ Because every Worker's CORS names https://heygabi.ai exactly, this page
 * does not work from www.heygabi.ai or a local file. That is the Workers'
 * config being right, not a bug here — the page says so instead of failing
 * mutely.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';
import { actionBtn, confirmBtn } from '../assets/estate-controls.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';

/** §4.5's canonical catalog order — never re-sorted, never duplicated.
 *  `library2` (0007) is the second library instance — visibility DEFAULTS
 *  TO 0 there, so every row renders it unchecked until deliberately granted. */
const CATALOGS = ['audiobook', 'library', 'games', 'library2', 'ebooks'];

/** UI labels only — the wire vocabulary stays the CATALOGS keys above. */
const CATALOG_LABELS = {
  audiobook: 'audiobook',
  library: 'library',
  games: 'games',
  library2: "Sam's library",
  ebooks: 'Ebooks',
};

/**
 * The app Workers with roles to federate, in §4.5's canonical CATALOGS order
 * minus `audiobook` (whose roles come from the auth Worker's site-roles
 * federation instead, rendered by audiobookRoleCell).
 *
 * ⚠️ `library2` appends LAST and never moves — the canonical order is
 * load-bearing across repos. It is `library_catalog`'s `[env.friend]`
 * deploy: the SAME Worker code at a different hostname with its own D1, so
 * `/api/admin/users` answers the identical `{ app, roles, users }` shape and
 * the identical apex-only CORS lock. Nothing special-cases it.
 *
 * `seedGap: false` on library2 is deliberate and is the ONE difference (see
 * renderSeedGaps): her roster is HER household's, not a subset of ours, so
 * "listed there but not in the estate directory" is the normal state there
 * rather than a seed that missed someone. Flagging it would be a warning
 * that can never be cleared.
 */
const APPS = [
  { key: 'library', label: 'library', origin: 'https://library.heygabi.ai', seedGap: true },
  { key: 'games', label: 'games', origin: 'https://boardgames.heygabi.ai', seedGap: true },
  { key: 'library2', label: "Sam's library", origin: 'https://padhard.heygabi.ai', seedGap: false },
];

/**
 * SORT + FILTER — client-side over the directory already in memory (owner
 * ask: "sort on who has access to what catalogs, who's an admin in what
 * spaces"). Household scale — no server round-trip, no pagination.
 */
const NO_ACCOUNT = '__none__'; // per-app role filter: "no row in that app's roster yet" (audiobook: "no site role")
/** Every column with a role filter: the audiobook site-roles federation + the
 *  three app Workers, in canonical CATALOGS order (library2 appended last). */
const ROLE_FILTER_KEYS = ['audiobook', 'library', 'games', 'library2'];
const SORT_KEYS = ['name', 'email', 'status', 'first_seen', 'decided', 'breadth'];
const STATUS_RANK = { pending: 0, approved: 1, revoked: 2 }; // the existing pending-first instinct, made sortable
const DEFAULT_DIR_FOR_KEY = { // the sensible starting direction when a sort key is first picked
  name: 'asc', email: 'asc', status: 'asc', first_seen: 'asc', decided: 'asc', breadth: 'desc',
};
const VIEW_STORAGE_KEY = 'hg-admin-view-v1'; // sessionStorage: survives a refresh, not a new tab/session
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const refreshBtn = document.getElementById('refresh');
const statusEl = document.getElementById('status');
const usersEl = document.getElementById('users');
const gapsEl = document.getElementById('gaps');
const controlsEl = document.getElementById('controls');
const countEl = document.getElementById('count');
const advEl = document.getElementById('adv');
const advCountEl = document.getElementById('adv-count');

let currentUser = null;

/**
 * Per-app directory state, keyed by app key:
 *   null                                  — not loaded yet
 *   { ok: true, roles, byEmail }          — that app's list + vocabulary
 *   { ok: false, why }                    — degraded; why is shown in-cell
 */
let appDirs = Object.fromEntries(APPS.map((a) => [a.key, null]));

/**
 * Audiobook site-roles state, same shape contract as appDirs entries, plus
 * the ladder-specific fields the auth Worker now includes:
 *   null | { ok: true, roles, byEmail, actorRole, grantable } | { ok: false, why }
 * byEmail maps lowercased email → { role, uid, ... } so the filter logic
 * can treat all three role columns uniformly (roleDirFor). `actorRole` is
 * the SIGNED-IN caller's own ladder role on the audiobook site (computed
 * server-side: OWNER_EMAILS always wins); `grantable` is exactly the
 * SITE_ROLES entries canGrant() currently allows this caller to set —
 * audiobookRoleCell renders a dropdown only for rows it covers.
 */
let siteRolesDir = null;

/**
 * The role ladder + capability map (owner ask: "see a role tree map"),
 * fetched once per load from GET /api/estate/site-roles/tree — static
 * data, so it degrades independently of siteRolesDir (it works even when
 * the Firestore service account isn't configured there).
 *   null | { ok: true, ladder, grantFloor, capabilities } | { ok: false, why }
 */
let roleTreeDir = null;

function roleDirFor(key) {
  return key === 'audiobook' ? siteRolesDir : appDirs[key];
}

/** The full directory as last loaded — filters/sort run over this, it is never re-fetched for a view change. */
let allEstateUsers = [];

let state = loadPersistedView();

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
      // §1e: never a bare HTTP status — say it failed, and pass along the
      // server's own words when it gave any, but never the number alone.
      setStatus(`Something went wrong on the server${body?.error ? ` (${body.error})` : ''}. Try again shortly.`, 'warn');
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
  if (!res.ok) return { ok: false, why: 'server error' };
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
// API calls — the audiobook site-roles federation (auth Worker holds the
// service account; this page holds nothing)
// ---------------------------------------------------------------------------

/** The site-roles roster + vocabulary, or the reason the cell degrades. */
async function fetchSiteRoles() {
  const token = await idToken();
  if (!token) return { ok: false, why: 'sign-in lapsed' };
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/site-roles`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, why: 'token refused' };
  if (res.status === 403) return { ok: false, why: 'needs an approver account' };
  if (res.status === 503) return { ok: false, why: 'service account not configured on the auth Worker' };
  if (!res.ok) return { ok: false, why: 'server error' };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: 'unreadable answer' };
  }
  const byEmail = new Map();
  for (const h of data.holders ?? []) {
    if (h.email) byEmail.set(String(h.email).toLowerCase(), h);
  }
  return {
    ok: true,
    roles: Array.isArray(data.roles) ? data.roles : [],
    byEmail,
    actorRole: typeof data.actorRole === 'string' ? data.actorRole : 'guest',
    grantable: Array.isArray(data.grantable) ? data.grantable : [],
    // Lowercased server-side already; defaulted to [] so an older Worker
    // simply means "nobody is flagged as owner" rather than a crash.
    ownerEmails: Array.isArray(data.ownerEmails) ? data.ownerEmails : [],
  };
}

/**
 * Is this estate row an OWNER? (owner decision 2026-08-16.)
 *
 * ⚠️ Read from the server's OWNER_EMAILS, never inferred from a stored role.
 * 'owner' is deliberately absent from SITE_ROLES and is never written to a
 * site_roles doc, so a stored role can never say 'owner' — inferring it from
 * one would silently answer "no" for every real owner.
 *
 * Fails CLOSED in the useful direction: if the field is missing (older Worker,
 * failed fetch), nobody is treated as an owner and the page keeps its previous
 * behaviour of offering a dropdown the server will refuse. That is the same
 * safety the page had before this flag existed — never worse.
 */
function isOwnerEmail(estateUser) {
  const list = siteRolesDir && siteRolesDir.ok ? siteRolesDir.ownerEmails : null;
  if (!Array.isArray(list) || !list.length) return false;
  return list.includes(String(estateUser.email || '').trim().toLowerCase());
}

/**
 * The role ladder + capability map. Independent of fetchSiteRoles() on
 * purpose — the tree endpoint needs no Firestore service account, so it
 * can succeed (and the ladder can render) even when the roster cell above
 * is showing "service account not configured".
 */
async function fetchRoleTree() {
  const token = await idToken();
  if (!token) return { ok: false, why: 'sign-in lapsed' };
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/site-roles/tree`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, why: 'token refused' };
  if (res.status === 403) return { ok: false, why: 'needs an approver account' };
  if (!res.ok) return { ok: false, why: 'server error' };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: 'unreadable answer' };
  }
  if (!Array.isArray(data.capabilities) || !Array.isArray(data.ladder)) {
    return { ok: false, why: 'unrecognized shape' };
  }
  return { ok: true, ladder: data.ladder, grantFloor: data.grantFloor, capabilities: data.capabilities };
}

/** POST one grant/revoke. role null = revoke. True on success; failures explain themselves. */
async function postSiteRole(email, role) {
  const token = await idToken();
  if (!token) {
    setStatus('Sign-in lapsed — sign in again.', 'warn');
    return false;
  }
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/site-roles`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
  } catch (e) {
    setStatus('The auth Worker did not answer — the audiobook role is unchanged.', 'warn');
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
  setStatus(`audiobook: ${detail || `role change refused (${res.status}${body?.error ? `: ${body.error}` : ''})`}`, 'warn');
  return false;
}

/** Add-member-by-email (POST /api/estate/users, origin 'manual'). */
async function createMember(email) {
  const data = await api('/api/estate/users', { method: 'POST', body: JSON.stringify({ email }) });
  return data; // null on failure (api() already said why)
}

// ---------------------------------------------------------------------------
// Loading — the directory, both app lists and the site-roles roster, in parallel
// ---------------------------------------------------------------------------

async function loadDirectory() {
  setStatus('Loading…');
  // One fetch per app Worker, driven by APPS rather than positional
  // destructuring — adding a fourth managed site is a row in APPS and
  // nothing else. A failed app fetch degrades that column only.
  const [estate, appResults, sroles, rtree] = await Promise.all([
    api('/api/estate/users'),
    Promise.all(APPS.map((app) => fetchAppDirectory(app))),
    fetchSiteRoles(),
    fetchRoleTree(),
  ]);
  appDirs = Object.fromEntries(APPS.map((app, i) => [app.key, appResults[i]]));
  siteRolesDir = sroles;
  roleTreeDir = rtree;
  renderRoleTree();
  // Owner: "just always auto fill and write the max role possible for each
  // site." Fire-and-forget — the render below must not wait on it.
  void reconcileOwnerRoles();
  if (!estate) {
    // api() already said why. The app lists are useless without the spine.
    usersEl.innerHTML = '';
    gapsEl.hidden = true;
    return;
  }
  setStatus('');
  renderUsers(estate.users);
  renderSeedGaps(estate.users);
  // Auth resolves async, so the directory renders well after page load —
  // this is the moment the anchor's target actually exists.
  revealAnchoredMember();
}

/**
 * ⚠️ A REVOCATION HAS TWO HALVES, and only one of them is D1.
 *
 * POST /estate/users/:id/status clears the estate row (status, approver,
 * devops) and then, best-effort, the audiobook LADDER role in Firestore —
 * which the audiobook site's own rules read directly from the browser, so a
 * stale one keeps real powers there (site-wide review deletes, club
 * administration) no matter what this directory says. There is no
 * transaction across the two stores: the Worker answers 200 for the
 * revocation that landed and reports the second half in `site_role`.
 *
 * So this must never be dropped on the floor. Returns the sentence to show,
 * or null when there is genuinely nothing to say (it worked, or they had no
 * audiobook role to lose).
 */
function siteRoleNote(siteRole) {
  if (!siteRole || siteRole.cleared) return null;
  if (siteRole.reason === 'no_role' || siteRole.reason === 'no_firebase_user') return null;
  const failed = siteRole.reason === 'firestore_error' || siteRole.reason === 'service_account_unset';
  return { text: siteRole.detail, tone: failed ? 'warn' : '' };
}

async function mutate(path, body) {
  const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
  if (!data) return;
  const note = siteRoleNote(data.site_role);
  // loadDirectory() clears the status line on success, so the note goes after.
  await loadDirectory();
  if (note) setStatus(note.text, note.tone);
}

// ---------------------------------------------------------------------------
// Filtering & sorting — entirely client-side over `allEstateUsers`. Every
// control change and every mutation re-render both funnel through
// renderFilteredList(), so approve/revoke/visibility/role edits never reset
// what the admin was looking at. Persisted in sessionStorage; every stored
// value is re-validated on load (and the app-role vocab re-checked on every
// render) rather than trusted, since a stale value can outlive its vocab.
// ---------------------------------------------------------------------------

function defaultFilters() {
  return {
    status: 'all',       // all | pending | approved | revoked
    approverOnly: false,
    visCats: [],          // subset of CATALOGS the member must SEE (AND semantics)
    // 'any' | NO_ACCOUNT | a role from that column's own vocab. audiobook =
    // the site-roles federation (NO_ACCOUNT there means "no site role").
    appRoles: Object.fromEntries(ROLE_FILTER_KEYS.map((k) => [k, 'any'])),
    q: '',
  };
}

function defaultSort() {
  return { key: 'name', dir: 'asc' };
}

function loadPersistedView() {
  const filters = defaultFilters();
  const sort = defaultSort();
  let advOpen = false; // advanced filters section: collapsed by default (owner spec)
  try {
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const pf = parsed?.filters;
      if (pf) {
        if (['all', 'pending', 'approved', 'revoked'].includes(pf.status)) filters.status = pf.status;
        if (typeof pf.approverOnly === 'boolean') filters.approverOnly = pf.approverOnly;
        if (Array.isArray(pf.visCats)) filters.visCats = pf.visCats.filter((c) => CATALOGS.includes(c));
        if (pf.appRoles && typeof pf.appRoles === 'object') {
          for (const key of ROLE_FILTER_KEYS) {
            if (typeof pf.appRoles[key] === 'string') filters.appRoles[key] = pf.appRoles[key];
          }
        }
        if (typeof pf.q === 'string') filters.q = pf.q;
      }
      const ps = parsed?.sort;
      if (ps) {
        if (SORT_KEYS.includes(ps.key)) sort.key = ps.key;
        if (ps.dir === 'asc' || ps.dir === 'desc') sort.dir = ps.dir;
      }
      // Older saves predate the advanced disclosure — a missing/non-boolean
      // value just leaves it collapsed rather than failing to load at all.
      if (typeof parsed?.advOpen === 'boolean') advOpen = parsed.advOpen;
    }
  } catch (e) {
    // corrupt or unavailable storage (private mode quota) — defaults stand
  }
  return { filters, sort, advOpen };
}

function persistView() {
  try {
    sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // storage unavailable — the view simply won't survive a refresh
  }
}

function breadth(u) {
  return Array.isArray(u.visibility) ? u.visibility.length : 0;
}

function matchesFilters(u) {
  const f = state.filters;
  if (f.status !== 'all' && u.status !== f.status) return false;
  if (f.approverOnly && !u.is_approver) return false;

  if (f.visCats.length) {
    const vis = Array.isArray(u.visibility) ? u.visibility : [];
    for (const cat of f.visCats) if (!vis.includes(cat)) return false;
  }

  for (const key of ROLE_FILTER_KEYS) {
    const want = f.appRoles[key];
    if (want === 'any') continue;
    const dir = roleDirFor(key);
    if (!dir || !dir.ok) continue; // can't verify a degraded column — don't hide people on a guess
    const appUser = dir.byEmail.get(u.email.toLowerCase());
    if (want === NO_ACCOUNT) {
      if (appUser) return false;
    } else if (!appUser || appUser.role !== want) {
      return false;
    }
  }

  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (q) {
      const hay = `${u.display_name || ''} ${u.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }

  return true;
}

function displayKey(u) {
  return (u.display_name || u.email).toLowerCase();
}

function tiebreak(a, b) {
  return collator.compare(displayKey(a), displayKey(b));
}

/** No decided_at (and, in principle, no first_seen_at) always sorts last, in either direction. */
function compareNullableDate(av, bv, mult) {
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return (new Date(av) - new Date(bv)) * mult;
}

function compareUsers(a, b) {
  const { key, dir } = state.sort;
  const mult = dir === 'desc' ? -1 : 1;

  if (key === 'first_seen' || key === 'decided') {
    const field = key === 'first_seen' ? 'first_seen_at' : 'decided_at';
    const res = compareNullableDate(a[field], b[field], mult);
    return res !== 0 ? res : tiebreak(a, b);
  }

  let res;
  switch (key) {
    case 'email': res = collator.compare(a.email, b.email); break;
    case 'status': res = STATUS_RANK[a.status] - STATUS_RANK[b.status]; break;
    case 'breadth': res = breadth(a) - breadth(b); break;
    default: res = collator.compare(displayKey(a), displayKey(b)); break; // 'name'
  }
  res *= mult;
  return res !== 0 ? res : tiebreak(a, b);
}

/** Rebuild each role column's filter <select> from its OWN fetched vocabulary — never hardcoded (§1.2). */
function populateRoleFilterOptions() {
  for (const key of ROLE_FILTER_KEYS) {
    const select = document.getElementById(`f-role-${key}`);
    // A key with no <select> in the markup (a column added to the JS before
    // its filter row exists) must not take the whole controls bar down with
    // it — the role CELLS are the load-bearing half, the filter is a
    // convenience. Skip it rather than throw.
    if (!select) continue;
    const dir = roleDirFor(key);
    const current = state.filters.appRoles[key];
    const valid = ['any', NO_ACCOUNT, ...(dir?.ok ? dir.roles : [])];

    select.innerHTML = '';
    select.appendChild(new Option('any', 'any'));
    // audiobook: everyone can use the public site — absence means "no site
    // role", not "no account". The apps create rows on first sign-in.
    select.appendChild(new Option(key === 'audiobook' ? 'no site role' : 'no account yet', NO_ACCOUNT));
    if (dir?.ok) {
      for (const role of dir.roles) select.appendChild(new Option(role, role));
    }
    select.disabled = !dir?.ok; // that column is degraded right now — its role filter can't be trusted

    if (!valid.includes(current)) state.filters.appRoles[key] = 'any'; // vocab moved under a stale value
    select.value = state.filters.appRoles[key];
  }
}

function syncControlsFromState() {
  document.getElementById('f-status').value = state.filters.status;
  document.getElementById('f-approver').value = state.filters.approverOnly ? 'only' : 'any';
  document.getElementById('f-q').value = state.filters.q;
  for (const cat of CATALOGS) {
    const chip = controlsEl.querySelector(`.chip[data-cat="${cat}"]`);
    const active = state.filters.visCats.includes(cat);
    chip.setAttribute('aria-pressed', String(active));
    chip.classList.toggle('active', active);
  }
  populateRoleFilterOptions();
  document.getElementById('s-key').value = state.sort.key;
  updateSortDirButton();
  advEl.open = state.advOpen;
  updateAdvHint();
}

/**
 * "N active" on the Advanced filters toggle — status/approver/role are the
 * fields living behind the disclosure that actually HIDE rows (sort only
 * reorders, catalog chips and search sit outside it already), so those are
 * what's counted. Hidden while the section is open — the fields are right
 * there, nothing to summarize.
 */
function countActiveAdvancedFilters() {
  const f = state.filters;
  let n = 0;
  if (f.status !== 'all') n++;
  if (f.approverOnly) n++;
  for (const key of ROLE_FILTER_KEYS) if (f.appRoles[key] !== 'any') n++;
  return n;
}

function updateAdvHint() {
  const n = countActiveAdvancedFilters();
  const show = !advEl.open && n > 0;
  advCountEl.hidden = !show;
  advCountEl.textContent = show ? `${n} active` : '';
}

function updateSortDirButton() {
  const btn = document.getElementById('s-dir');
  const asc = state.sort.dir === 'asc';
  btn.textContent = asc ? '↑ asc' : '↓ desc';
  btn.setAttribute('aria-pressed', String(!asc));
}

function updateCountLine(shown, total) {
  countEl.textContent = total ? `Showing ${shown} of ${total}` : '';
}

/** Filter + sort `allEstateUsers` and paint. Every control change and every mutation re-render go through here. */
function renderFilteredList() {
  const view = allEstateUsers.filter(matchesFilters).sort(compareUsers);
  usersEl.innerHTML = '';
  for (const u of view) usersEl.appendChild(userCard(u));
  updateCountLine(view.length, allEstateUsers.length);
  updateAdvHint();
}

function wireControls() {
  const statusSel = document.getElementById('f-status');
  const approverSel = document.getElementById('f-approver');
  const qInput = document.getElementById('f-q');
  const sortKeySel = document.getElementById('s-key');
  const sortDirBtn = document.getElementById('s-dir');
  const resetBtn = document.getElementById('f-reset');

  statusSel.addEventListener('change', () => {
    state.filters.status = statusSel.value;
    persistView();
    renderFilteredList();
  });

  approverSel.addEventListener('change', () => {
    state.filters.approverOnly = approverSel.value === 'only';
    persistView();
    renderFilteredList();
  });

  qInput.addEventListener('input', () => {
    state.filters.q = qInput.value;
    persistView();
    renderFilteredList();
  });

  for (const chip of controlsEl.querySelectorAll('.chip[data-cat]')) {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      const i = state.filters.visCats.indexOf(cat);
      if (i === -1) state.filters.visCats.push(cat); else state.filters.visCats.splice(i, 1);
      chip.setAttribute('aria-pressed', String(i === -1));
      chip.classList.toggle('active', i === -1);
      persistView();
      renderFilteredList();
    });
  }

  for (const key of ROLE_FILTER_KEYS) {
    const select = document.getElementById(`f-role-${key}`);
    if (!select) continue; // same reasoning as populateRoleFilterOptions
    select.addEventListener('change', (e) => {
      state.filters.appRoles[key] = e.target.value;
      persistView();
      renderFilteredList();
    });
  }

  // Add member by email (owner UI-first rule): pre-seed a directory row
  // before the person's first sign-in. The Worker lowercases + validates;
  // idempotent — adding someone already present changes nothing.
  const addBtn = document.getElementById('add-member-btn');
  const addInput = document.getElementById('add-member-email');
  const submitAdd = async () => {
    const email = addInput.value.trim();
    if (!email) return;
    addBtn.disabled = true;
    const data = await createMember(email);
    addBtn.disabled = false;
    if (!data) return; // api() already said why
    addInput.value = '';
    setStatus(
      data.created
        ? `${data.user.email} added (pending) — approve them below when ready.`
        : `${data.user.email} is already in the directory (${data.user.status}).`,
    );
    await loadDirectory();
  };
  addBtn.addEventListener('click', submitAdd);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAdd();
  });

  sortKeySel.addEventListener('change', () => {
    state.sort.key = sortKeySel.value;
    state.sort.dir = DEFAULT_DIR_FOR_KEY[state.sort.key] || 'asc';
    updateSortDirButton();
    persistView();
    renderFilteredList();
  });

  sortDirBtn.addEventListener('click', () => {
    state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    updateSortDirButton();
    persistView();
    renderFilteredList();
  });

  resetBtn.addEventListener('click', () => {
    state.filters = defaultFilters();
    state.sort = defaultSort();
    syncControlsFromState();
    persistView();
    renderFilteredList();
  });

  // Native <details> toggle — fires on open AND close, from keyboard or click.
  advEl.addEventListener('toggle', () => {
    state.advOpen = advEl.open;
    persistView();
    updateAdvHint();
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// actionBtn/confirmBtn moved to ../assets/estate-controls.js (2026-08-16) so
// the /status page's fine-grained pipeline controls could reuse the exact
// same two-tap idiom instead of a second implementation — see that file's
// header comment.

/**
 * Save the visibility set as the checkboxes now stand — the whole array in
 * §4.5's canonical order, because the endpoint takes the set, not a delta.
 */
async function saveVisibility(estateUser, catsEl) {
  // ⚠️ `[data-cat]` is load-bearing: the Ebooks row also carries a DOWNLOAD
  // checkbox (0009), which is NOT a catalog and must never be folded into the
  // visibility array. A bare input[type=checkbox] selector would have posted
  // it as one and had the Worker's strict schema reject the whole save.
  const boxes = [...catsEl.querySelectorAll('input[type="checkbox"][data-cat]')];
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

  // ⚠️ AN OWNER'S ROLE IS NOT EDITABLE — no dropdown at all (owner decision
  // 2026-08-16: "for anyone with owner rank dont even render options to change
  // it. just always auto fill and write the max role possible for each site").
  //
  // Rendering a disabled control, or one that snaps back when the server
  // refuses, would be the "button that looks like it worked" failure the
  // never-show-a-bare-status rule exists to prevent. An owner outranks every
  // grant this page can make, so there is no state a dropdown could offer that
  // is not a refusal waiting to happen. It shows a fact instead.
  //
  // Each app owns its OWN vocabulary and they genuinely differ (library
  // `owner|manager|reader`, games `owner|manager|rater|viewer`) — so "the max
  // role possible for each site" is read from that app's own `dir.roles`
  // (first entry, the apps list theirs highest-first) rather than hardcoding a
  // word that would rot the next time an app renames a rung.
  if (isOwnerEmail(estateUser)) {
    const top = dir.roles[0];
    cell.className = 'cat-role cat-owner';
    cell.textContent = appUser.role === top ? top : `${appUser.role} → ${top}`;
    cell.title =
      appUser.role === top
        ? `Owner — holds ${top}, this app's highest role. Not changeable here; owner is DB-only.`
        : `Owner — should hold ${top} (this app's highest role) but currently holds ` +
          `${appUser.role}. Not changeable here; fix it in the app itself.`;
    if (appUser.role !== top) cell.classList.add('cat-warn');
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

/**
 * The audiobook role cell: a none/member/contributor/moderator/admin
 * dropdown wired to the auth Worker's site-roles LADDER federation, or the
 * honest reason there isn't one. 'none' is a real state (most members hold
 * no site role — i.e. guest, never stored), so the dropdown always
 * renders when it renders at all — unlike the app cells there is no "no
 * account yet" case: revoking = picking none, granting = picking a role.
 *
 * ⚠️ Escalation is enforced SERVER-SIDE (site-roles.ts's canGrant, mirrored
 * from role-ladder.ts) — this cell mirrors that rather than re-deriving
 * it: only `dir.grantable` roles are ever offered, and a row whose CURRENT
 * role the caller may not touch (it outranks their own grant power, or is
 * 'owner' — DB-only, no UI path, ever) renders READ-ONLY rather than a
 * control that would just be refused on submit.
 *
 * Role changes are DESTRUCTIVE (they change what a member may do) — the
 * owner explicitly asked for confirmation on role changes, so this reuses
 * the two-tap confirmBtn idiom instead of applying on a bare <select>
 * change: picking a new value only STAGES it; the confirm button must be
 * tapped twice before postSiteRole() actually runs.
 */
/**
 * Keep every OWNER at the top of the audiobook ladder, automatically.
 *
 * Owner decision 2026-08-16: *"just always auto fill and write the max role
 * possible for each site."* An owner outranks anything this page can grant, so
 * their stored role is not a choice — it is a value that should simply always
 * be correct, and drift in it is a bug rather than a preference.
 *
 * ⚠️ Runs ONCE after the directory loads, never from inside a render function.
 * A cell that wrote as a side effect of being drawn would re-fire on every
 * re-render, every sort and every filter change — a storm of POSTs triggered by
 * scrolling.
 *
 * ⚠️ Only ever writes the TOP role to a KNOWN OWNER, so the sole direction this
 * can move anyone is one the owner has already decided is theirs by rank. It
 * cannot promote a non-owner: the guard is the server's own ownerEmails list,
 * the same one the gates use. If the server refuses anyway (an owner whose
 * caller lacks grant power — e.g. an admin viewing an owner's row), the refusal
 * stands and is reported, not retried.
 *
 * Silent by design when there is nothing to do, which is the normal case.
 */
async function reconcileOwnerRoles() {
  const dir = siteRolesDir;
  if (!dir || !dir.ok || !Array.isArray(dir.ownerEmails) || !dir.ownerEmails.length) return;
  const top = dir.roles[dir.roles.length - 1];
  if (!top) return;

  const behind = dir.ownerEmails.filter((email) => (dir.byEmail.get(email)?.role ?? 'none') !== top);
  if (!behind.length) return;

  const fixed = [];
  for (const email of behind) {
    const ok = await postSiteRole(email, top);
    if (ok) {
      const prev = dir.byEmail.get(email);
      dir.byEmail.set(email, { ...(prev ?? { uid: '', displayName: '' }), email, role: top });
      fixed.push(email);
    }
  }
  if (fixed.length) {
    setStatus(`Owner role set to ${top} for ${fixed.join(', ')}.`, 'owner');
    render();
  }
}

function audiobookRoleCell(estateUser) {
  const dir = siteRolesDir;
  const cell = document.createElement('span');
  cell.className = 'cat-role';

  if (!dir || !dir.ok) {
    cell.className = 'cat-warn';
    cell.textContent = dir?.why ?? 'not loaded';
    return cell;
  }

  const emailKey = estateUser.email.toLowerCase();
  const holder = dir.byEmail.get(emailKey);
  const currentRole = holder?.role ?? 'none';
  const grantable = Array.isArray(dir.grantable) ? dir.grantable : [];
  const canTouchCurrent = currentRole === 'none' || grantable.includes(currentRole);

  // ⚠️ AN OWNER GETS NO CONTROL HERE EITHER (owner-reported 2026-08-16: "for
  // the audiobook portal it didnt force my role" — the app cells got this
  // treatment and this one was missed).
  //
  // ⚠️ The `currentRole === 'owner'` branch below CANNOT FIRE, and that is the
  // whole bug. `currentRole` comes from the Firestore site_roles doc, and
  // SITE_ROLES stops at 'admin' — 'owner' is never stored there by design, it
  // lives in OWNER_EMAILS. So an owner's row carried 'admin' or 'none', passed
  // the canTouchCurrent test, and was handed a dropdown. The dead branch is
  // kept below only because a doc COULD hold a stale 'owner' string from an
  // earlier vocabulary; it is not the owner check.
  //
  // Ask the server who owns the estate instead, exactly as the app cells do.
  // The displayed value is the highest role this ladder can express (the last
  // SITE_ROLES entry, not a hardcoded 'admin' that a rename would rot), shown
  // as a fact with the real rank beside it.
  if (isOwnerEmail(estateUser)) {
    const top = dir.roles[dir.roles.length - 1];
    const note = document.createElement('span');
    note.className = 'cat-owner';
    note.textContent = `owner · ${top}`;
    note.title =
      `Owner — outranks every role this page can grant, so there is nothing to choose. ` +
      `'owner' itself is DB-only and is never stored in a site_roles doc; ${top} is the ` +
      `highest role the audiobook ladder can express, and is kept set automatically.`;
    if (currentRole !== top) {
      // Reconciliation is done once after load (reconcileOwnerRoles), not from
      // inside a render function — a cell that writes as a side effect of being
      // drawn would fire again on every re-render and every filter change.
      note.classList.add('cat-warn');
      note.textContent = `owner · ${currentRole} → ${top}`;
      note.title += ` Currently ${currentRole}; being corrected.`;
    }
    cell.appendChild(note);
    return cell;
  }

  if (!canTouchCurrent) {
    // The current holder outranks what this caller may grant/revoke (e.g.
    // an admin viewed by a moderator, or 'owner' — DB-only for everyone).
    const note = document.createElement('span');
    note.className = 'cat-note';
    note.textContent =
      currentRole === 'owner' ? 'owner (DB-only — no UI path, ever)' : `${currentRole} (outranks your grant power)`;
    cell.appendChild(note);
    return cell;
  }

  if (grantable.length === 0) {
    // Nothing to grant AND nothing held — no control worth showing.
    const note = document.createElement('span');
    note.className = 'cat-note';
    note.textContent = 'none — you hold no grant power on this ladder';
    cell.appendChild(note);
    return cell;
  }

  const select = document.createElement('select');
  select.setAttribute('aria-label', `audiobook site role for ${estateUser.email}`);
  for (const role of ['none', ...grantable]) {
    const opt = document.createElement('option');
    opt.value = role;
    opt.textContent = role;
    if (currentRole === role) opt.selected = true;
    select.appendChild(opt);
  }
  select.value = currentRole;

  const applyBtn = confirmBtn('Set role', 'quiet', async () => {
    const role = select.value === 'none' ? null : select.value;
    if (role === (holder?.role ?? null)) return; // no-op — nothing staged
    select.disabled = true;
    const ok = await postSiteRole(emailKey, role);
    if (ok) {
      // Keep the map truthful without a refetch (the app-cell idiom).
      if (role) dir.byEmail.set(emailKey, { ...(holder ?? { uid: '', displayName: '' }), email: emailKey, role });
      else dir.byEmail.delete(emailKey);
    } else {
      select.value = holder?.role ?? 'none'; // refused — snap back to what stands
    }
    select.disabled = false;
  });

  cell.append(select, applyBtn);
  return cell;
}

/**
 * The Ebooks row's second cell — a NOTE, not a control, and deliberately so.
 *
 * ⚠️ THERE IS NO DOWNLOAD CHECKBOX HERE ANY MORE. One shipped on 2026-08-16
 * (0009's per-person `dl_ebooks` grant) and the owner removed it the next day,
 * verbatim: *"For ebooks I don't want a download check box, I want to use roles
 * we have. Set up the roles to match library."*
 *
 * So the Ebooks row now carries exactly ONE control — the `visible` checkbox
 * every catalog row has — and downloading is granted by PROMOTION on the
 * Audiobook row's role dropdown further up this same card (`download` floors at
 * `admin` in audiobook-worker's capability matrix). One grant mechanism, in the
 * place the page already puts "what may they DO there".
 *
 * This cell exists so the row does not simply go quiet about downloads: a blank
 * space would read as "downloads are not a thing here", and someone would go
 * looking for the toggle that used to be in it. Saying where the grant moved is
 * cheaper than the question it prevents.
 */
function downloadEbooksCell(estateUser) {
  const cell = document.createElement('span');
  cell.className = 'cat-note';
  // Named for what the reader must DO, and pointing at the control that does
  // it — never a bare statement that they lack something.
  cell.textContent = 'download: admin on the audiobook role above';
  cell.title =
    'Downloading ebook files is a role, not a per-person grant (owner decision ' +
    '2026-08-17). Set this person to admin on the Audiobook row to allow it; ' +
    'the "visible" box here only opens the shelf and the in-browser reader.';
  return cell;
}

/** One catalog line: name, visibility checkbox, role cell. */
function catalogRow(estateUser, catKey, roleCell) {
  const row = document.createElement('div');
  row.className = 'cat';

  const name = document.createElement('span');
  name.className = 'cat-name';
  name.textContent = CATALOG_LABELS[catKey] || catKey;
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
  // Stable handle for the #member=<email> anchor (revealAnchoredMember).
  li.dataset.email = String(u.email).toLowerCase();

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

  // The estate devops capability (0003, owner 2026-08-15): unlisted runbook
  // pages + the status page's Operations. Badged only when it is the ROW's
  // own flag — approvers hold it implicitly and already wear a badge.
  if (u.is_devops) {
    const dv = document.createElement('span');
    dv.className = 'badge approved';
    dv.textContent = 'devops';
    head.appendChild(dv);
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

  cats.appendChild(catalogRow(u, 'audiobook', audiobookRoleCell(u)));

  for (const app of APPS) {
    cats.appendChild(catalogRow(u, app.key, appRoleCell(app, u)));
  }

  // ⚠️ The second library instance (library2, 0007) used to render a note here
  // reading "roles live on that site — not federated here yet". It is now a
  // full member of APPS above, so it gets the same dropdown as every other app
  // Worker (owner-reported live 2026-08-16: "in the admin page Sam's library
  // has no roles, I should be able to set her with the same level of roles as
  // my library"). Its visibility checkbox is unchanged — 0007's column is
  // DEFAULT 0, so existing rows still show it unchecked until granted.

  // The ebook shelf (0008, owner directive 2026-08-17: "ebooks should be like
  // the other site where we grant permission to view it"). Its `visible` box is
  // the whole grant: the shelf AND reading in the browser viewer.
  //
  // ⚠️ Its second cell is a NOTE, not a control — the download checkbox that
  // sat there for one day was removed by the follow-up directive ("use roles we
  // have… match library"). The shelf has no ladder of its own; it rides the
  // AUDIOBOOK role rendered a few rows up, where `download` floors at admin.
  cats.appendChild(catalogRow(u, 'ebooks', downloadEbooksCell(u)));
  li.appendChild(cats);

  const actions = document.createElement('div');
  actions.className = 'user-actions';

  if (u.status !== 'approved') {
    actions.appendChild(actionBtn('Approve', '', () =>
      mutate(`/api/estate/users/${u.id}/status`, { status: 'approved' })));
  }
  // Revoke and every role flip are two-tap (confirmBtn) — owner order
  // 2026-08-15 after nearly fat-fingering a role change. Approve stays
  // single-tap: it is the common, additive, low-stakes action.
  if (u.status !== 'revoked') {
    actions.appendChild(confirmBtn('Revoke', 'danger', () =>
      mutate(`/api/estate/users/${u.id}/status`, { status: 'revoked' })));
  }
  if (u.status === 'approved') {
    actions.appendChild(u.is_approver
      ? confirmBtn('Remove approver', 'quiet', () =>
          mutate(`/api/estate/users/${u.id}/approver`, { is_approver: false }))
      : confirmBtn('Make approver', 'quiet', () =>
          mutate(`/api/estate/users/${u.id}/approver`, { is_approver: true })));
    // Devops (0003): pointless to toggle on an approver — they hold every
    // devops surface implicitly — so the button only renders for the rest.
    if (!u.is_approver) {
      actions.appendChild(u.is_devops
        ? confirmBtn('Remove devops', 'quiet', () =>
            mutate(`/api/estate/users/${u.id}/devops`, { is_devops: false }))
        : confirmBtn('Make devops', 'quiet', () =>
            mutate(`/api/estate/users/${u.id}/devops`, { is_devops: true })));
    }
  }

  li.appendChild(actions);
  return li;
}

/**
 * The role tree / capability map (owner ask: "see a role tree map") — a
 * small table of the whole audiobook ladder, rendered from
 * GET /api/estate/site-roles/tree regardless of whether the roster itself
 * loaded (independent fetch, independent failure mode; see fetchRoleTree).
 */
function renderRoleTree() {
  const details = document.getElementById('role-ladder');
  const body = document.getElementById('role-ladder-body');
  if (!details || !body) return;

  if (!roleTreeDir) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  body.innerHTML = '';

  if (!roleTreeDir.ok) {
    const p = document.createElement('p');
    p.className = 'cat-warn';
    p.textContent = roleTreeDir.why ?? 'not loaded';
    body.appendChild(p);
    return;
  }

  const table = document.createElement('table');
  table.className = 'role-tree-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>role</th><th>grants</th><th>granted by</th><th>rules-enforced</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const cap of roleTreeDir.capabilities) {
    const tr = document.createElement('tr');

    const roleTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${cap.role === 'owner' ? 'revoked' : cap.apiGrantable ? 'approved' : 'pending'}`;
    badge.textContent = cap.role;
    roleTd.appendChild(badge);
    tr.appendChild(roleTd);

    const summaryTd = document.createElement('td');
    summaryTd.textContent = cap.summary;
    tr.appendChild(summaryTd);

    const grantedByTd = document.createElement('td');
    grantedByTd.className = 'cat-note';
    grantedByTd.textContent = cap.grantedBy;
    tr.appendChild(grantedByTd);

    const rulesTd = document.createElement('td');
    rulesTd.textContent = cap.rulesEnforced ? 'yes' : 'not yet';
    if (!cap.rulesEnforced) rulesTd.className = 'cat-warn';
    tr.appendChild(rulesTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);

  const note = document.createElement('p');
  note.className = 'role-tree-note';
  note.textContent =
    'member/contributor are real and grantable here, but the audiobook site’s firestore.rules (a different, owner-gated repo) only enforces moderator/admin today — see "rules-enforced" above. (Note: this "member" role ≠ an "estate member" approved in the directory above — see the role tree\'s own row for that distinction.)';
  body.appendChild(note);
}

function renderUsers(users) {
  allEstateUsers = users;
  controlsEl.hidden = !users.length;
  if (!users.length) {
    usersEl.innerHTML = '';
    updateCountLine(0, 0);
    setStatus('The directory is empty. Owner emails still work everywhere (the break-glass), and the seed script fills this list.');
    return;
  }
  syncControlsFromState(); // the app role vocab may have just arrived/changed — keep the bar honest
  renderFilteredList();
}

/**
 * An app listing an email the estate directory does not hold means the seed
 * missed someone (§9 step 2 is idempotent and re-runnable) — say so rather
 * than silently rendering a directory that disagrees with its apps.
 *
 * ⚠️ NOT every app. `library2` (padhard.heygabi.ai) is a SECOND HOUSEHOLD's
 * instance: her roster is hers, and people on it who are not in our estate
 * directory are the expected, permanent state — not a seed that missed
 * someone. Flagging it would print a warning nobody can ever clear, which
 * trains the reader to ignore the whole line. Opt in per app (`seedGap`).
 */
function renderSeedGaps(estateUsers) {
  const known = new Set(estateUsers.map((u) => u.email.toLowerCase()));
  const lines = [];
  for (const app of APPS) {
    if (!app.seedGap) continue;
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
// #member=<email> anchor — the "see someone, then grant permissions" flow.
// The catalogs link a rendered person straight to their card here, e.g.
// https://heygabi.ai/admin#member=someone%40example.com. This page only
// scrolls and highlights; it grants nothing the buttons don't already.
// ---------------------------------------------------------------------------

/** The URL-encoded email carried by a #member= fragment, lowercased; else null. */
function anchoredMemberEmail() {
  const m = /^#member=(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim().toLowerCase();
  } catch (e) {
    return null; // malformed percent-encoding — ignore rather than throw
  }
}

/**
 * Scroll the anchored member's card into view with a brief highlight.
 * Safe to call any time: it does nothing without a fragment, a rendered
 * directory (auth resolves async — loadDirectory re-runs this), or a match.
 *
 * The deep-link must always land: if the anchored member exists in the
 * directory but the CURRENT filters hide them, drop the filters (sort is
 * left alone — it only reorders, never hides) and re-render once before
 * giving up.
 */
function revealAnchoredMember() {
  const email = anchoredMemberEmail();
  if (!email) return;
  let card = usersEl.querySelector(`li.user[data-email="${CSS.escape(email)}"]`);
  if (!card && allEstateUsers.some((u) => u.email.toLowerCase() === email)) {
    state.filters = defaultFilters();
    syncControlsFromState();
    persistView();
    renderFilteredList();
    card = usersEl.querySelector(`li.user[data-email="${CSS.escape(email)}"]`);
  }
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('anchored');
  setTimeout(() => card.classList.remove('anchored'), 2600);
}

window.addEventListener('hashchange', revealAnchoredMember);

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
      controlsEl.hidden = true;
      allEstateUsers = [];
      updateCountLine(0, 0);
      setStatus('');
      roleTreeDir = null;
      renderRoleTree();
    });
    whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    usersEl.innerHTML = '';
    gapsEl.hidden = true;
    controlsEl.hidden = true;
    roleTreeDir = null;
    renderRoleTree();
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

wireControls();
syncControlsFromState(); // paint any persisted filter/sort choice into the controls before data even loads

renderAuthState();
setStatus('Sign in to see the member list. The page is API-gated — nothing loads without an approver token.');

handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
