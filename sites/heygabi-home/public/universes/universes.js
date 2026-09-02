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
 * FETCHING: lazy, one universe at a time, only on expand — never all of them
 * eagerly on load. /api/universe is a real per-universe DB query and this
 * page's own click-to-fetch mirrors find.js's runUniverse() (also
 * click-triggered, not fired on every render). A signed-out expand shows the
 * same sign-in invitation copy find.js already uses for its inline
 * "everything in X" buttons — never a fetch, since /api/universe has no
 * anonymous carve-out (read.ts's header is explicit: members-only, no public
 * fallback, unlike /api/search's §4.5 carve-out).
 *
 * THE NAMES ARE HARDCODED, deliberately, because read.ts exposes no public
 * "list universe names" route — only /api/lookup (title-keyed) and the
 * members-only /api/universe/:name. Checked before assuming this: no such
 * route exists today. The page is also a PLAIN DIRECTORY UPLOAD
 * (`wrangler pages deploy sites/heygabi-home/public`) with no build step, so
 * there is nowhere to read data/universes.json at publish time either.
 *
 * ⚠️ "Keep it in sync by hand, a periodic check is enough" is what this note
 * used to say, and it was WRONG — measured 2026-08-26. DotHack was added to
 * data/universes.json on 2026-08-25 and this page was silently one universe
 * short until somebody read both files side by side. Nothing failed, nothing
 * went red, and the page served a cheerful 200 the whole time. A by-hand sync
 * note is not a guard.
 *
 * 🔴 The guard is now `scripts/test/universe-names-parity.test.mjs`, which
 * diffs UNIVERSE_NAMES below against data/universes.json `universes[].name`
 * and fails `npm test` — which `npm run deploy:home` runs before it uploads
 * anything. Outgrowing the hardcoded list is still the moment to add a real
 * "list names" route; until then the tripwire is what makes the duplication
 * survivable.
 *
 * ALPHABETICAL DISPLAY (owner-ordered upgrade #2): UNIVERSE_NAMES itself
 * stays in add-order (a running log — see the comment above it) so its own
 * history reads cleanly; DISPLAY_NAMES, built once beside it, is what
 * buildRows() actually iterates. Sort is display-order only — it has no
 * bearing on /api/universe/:name resolution, which is name-keyed, not
 * position-keyed.
 *
 * SERIES FOLDS (owner: "add sub sections that can collapse for series. No
 * need to see loose books", 2026-08-15): renderUniverseBody's "Books &
 * audiobooks" and "Games" groups are each broken into per-series <details>
 * (collapsed by default, "SeriesName (N)"), plus one collapsed catch-all fold
 * for series-less rows ("Standalones" for books, "Other games" for games).
 * The GROUPING math (groupBySeries) is imported from estate-search.js rather
 * than re-derived a third time — it is pure data logic with nothing
 * DOM-specific, so importing it does not break this file's own
 * duplicated-DOM-idiom convention (see header above); only the render half
 * (accessoriesDetails-shaped <details> building, this file's own classes)
 * stays duplicated, same as before. The accessories fold is unaffected — it
 * still collapses out of `games`, upstream of this split, and stays last.
 *
 * "+ ADD A VERSE" (owner, 2026-08-24; built 2026-09-02 — design
 * docs/info/universe-add-verse-design.md): the second half of this file, below
 * the browse list's own code. 🔴 It FILES A REQUEST and does not add a
 * universe, for the reason the whole design rests on — the list is a git file
 * compiled into two catalogs at build time, and a browser cannot commit to a
 * git repo. See that section's own banner.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';
import { groupBySeries } from '../assets/estate-search.js';

const INDEX_ORIGIN = 'https://index.heygabi.ai';

// ⚠️ Keep in sync with data/universes.json `universes[].name` — see header.
// 🔴 THIS IS NOW MECHANICALLY ENFORCED. `scripts/test/universe-names-parity.test.mjs`
// reads this array out of this file and diffs it against data/universes.json;
// a name in one and not the other FAILS `npm test`, which `npm run deploy:home`
// runs first. The by-hand sync note in the header above was not enough:
// DotHack was added to the data on 2026-08-25 and this page stayed one
// universe short until 2026-08-26, silently — nothing anywhere went red.
// The tripwire also fails if this const is renamed or reshaped, so a refactor
// cannot quietly turn the check into a no-op.
// Marvel and Disney added 2026-08-15 (owner/coordinator: separate universes).
// Same day, revised further: Star Wars split out of Disney (crossover-
// potential criterion) and Alliances created (owner-approved). Later the same
// day, during the estate-wide orphan sweep, Cytoverse and Reckoners were
// created, both owner-approved. Then the owner ruled on that sweep's verdict
// table and approved three more — Middle-earth, Dungeon Crawler Carl and
// Innworld — so 16. DotHack added 2026-08-25 (owner: "change .hack to DotHack
// as the verse name") — 17 now.
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
  'Cytoverse',
  'Reckoners',
  'Middle-earth',
  'Dungeon Crawler Carl',
  'Innworld',
  'DotHack',
];

// ALPHABETICAL UNIVERSES (owner-ordered upgrade #2) — display order only; the
// list above stays in its historical add-order (a running log, see the
// header note above it), sorted only at render time in buildRows().
//
// ⚠️ NO LONGER A CONST, AND THE HARDCODED LIST IS NOW THE FALLBACK RATHER THAN
// THE SOURCE (2026-09-02, the "+ add a verse" build). A signed-in member's copy
// comes from GET /api/estate/universes/names, which is projected from
// data/universes.json itself — so the page can no longer be silently one
// universe short for a signed-in reader.
//
// ⚠️ THE HARDCODED LIST STAYS, AND ITS TRIPWIRE STAYS. That route is
// members-only (like /api/universe/:name it sits behind estate membership), so
// a SIGNED-OUT visitor still has to be given the list from somewhere, and
// "sign in to see which universes exist" would be a worse page than the one
// that exists. scripts/test/universe-names-parity.test.mjs still diffs the
// array above against data/universes.json and still fails `npm test`, which
// `npm run deploy:home` runs before it uploads anything.
let DISPLAY_NAMES = [...UNIVERSE_NAMES].sort((a, b) => a.localeCompare(b));

const AUTH_ORIGIN = 'https://auth.heygabi.ai';

const whoEl = document.getElementById('uni-who');
const signinBtn = document.getElementById('uni-signin');
const statusEl = document.getElementById('uni-status');
const listEl = document.getElementById('uni-list');
const requestEl = document.getElementById('uni-request');
const requestChromeEl = document.getElementById('uni-request-chrome');
const formEl = document.getElementById('uni-form');
const pendingEl = document.getElementById('uni-pending');

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
  // Clickable cover → the item's detail page (same target as the title link),
  // but only when there is an image to click; otherwise an inert placeholder.
  const linkUrl = row && row.cover_url ? row.detail_url : null;
  const box = document.createElement(linkUrl ? 'a' : 'span');
  box.className = 'hit-cover';
  if (linkUrl) {
    box.href = linkUrl;
    box.target = '_blank';
    box.rel = 'noopener';
    box.setAttribute('aria-label', row.title ? `Open ${row.title}` : 'Open item');
  } else {
    box.setAttribute('aria-hidden', 'true');
  }
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

/** kind='accessory'/'promo' — the "accessories de-clutter" (owner: "make
 * accessories a sub category in a universe page"). Not a checkbox: these
 * always render, just collapsed and out of the way. */
function isAccessoryOrPromo(row) {
  return row.kind === 'accessory' || row.kind === 'promo';
}

/** A <details>, COLLAPSED BY DEFAULT (no `open` attribute) — the native
 * disclosure widget so no extra JS is needed to toggle it. Shared shape for
 * the accessories fold, each per-series fold, and the Standalones/Other-games
 * catch-all fold. */
function foldDetails(label, rows, className) {
  const details = document.createElement('details');
  details.className = className;
  const summary = document.createElement('summary');
  summary.className = 'find-group';
  summary.textContent = `${label} (${rows.length})`;
  details.appendChild(summary);
  const ul = document.createElement('ul');
  ul.className = 'hits';
  for (const row of rows) ul.appendChild(rowCard(row));
  details.appendChild(ul);
  return details;
}

function accessoriesDetails(rows) {
  return foldDetails('Accessories & promos', rows, 'find-accessories');
}

/** Series folds (owner: "add sub sections that can collapse for series. No
 * need to see loose books"): groups `rows` by series via the shared
 * groupBySeries() (imported from estate-search.js), renders one collapsed
 * fold per series (alphabetical), then one collapsed catch-all fold for the
 * series-less rows, labeled `otherLabel` — last, per the owner's ordering. */
function seriesFolds(rows, otherLabel) {
  const { seriesGroups, standalone } = groupBySeries(rows);
  const frag = document.createDocumentFragment();
  for (const g of seriesGroups) frag.appendChild(foldDetails(g.name, g.rows, 'find-series'));
  if (standalone.length) frag.appendChild(foldDetails(otherLabel, standalone, 'find-series'));
  return frag;
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

  const bookRows = data.matches.filter((m) => m.source === 'library' || m.source === 'audiobook');
  const gameRows = data.matches.filter((m) => m.source === 'game');
  const games = gameRows.filter((m) => !isAccessoryOrPromo(m));
  const accessories = gameRows.filter(isAccessoryOrPromo);

  // Series folds (owner-ordered, this pass): each group's rows are broken
  // into per-series collapsed folds plus one collapsed catch-all
  // ("Standalones" / "Other games") — no flat list anymore, so a universe
  // with several series does not dump every volume in the reader's face.
  if (bookRows.length) {
    body.appendChild(groupHeading('Books & audiobooks'));
    body.appendChild(seriesFolds(bookRows, 'Standalones'));
  }
  if (games.length) {
    body.appendChild(groupHeading('Games'));
    body.appendChild(seriesFolds(games, 'Other games'));
  }
  if (accessories.length) {
    body.appendChild(accessoriesDetails(accessories));
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
      // §1e: never a bare HTTP status alone.
      return `Could not load this universe${errCode ? ` (${errCode})` : ''}. Try again shortly.`;
  }
}

// ---------------------------------------------------------------------------
// The list — hardcoded rows in DISPLAY_NAMES's alphabetical order, each a lazy fetch on first expand
// ---------------------------------------------------------------------------

function buildRows() {
  listEl.innerHTML = '';
  for (const name of DISPLAY_NAMES) {
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

// ===========================================================================
// "+ ADD A VERSE" — owner, 2026-08-24: "in the universe page add a plus button
// somewhere to add a verse and let it take series as an input".
// Design: docs/info/universe-add-verse-design.md. Everything below is §3.
//
// 🔴 THE BUTTON FILES A REQUEST. IT DOES NOT ADD A UNIVERSE, and every string
// in here says so plainly rather than letting somebody find out later. The list
// lives in data/universes.json, in git, compiled into two catalogs at build
// time; a browser cannot commit to a git repo, and a second runtime-writable
// copy is the exact failure the whole design refuses. What the "+" creates is a
// row in the estate directory saying somebody asked, and why.
//
// ⚠️ SO `approved` IS NOT `done`, AND THIS PAGE MUST NEVER DRAW IT AS DONE.
// Between a yes and a build the estate is in a state where a person has been
// told yes and nothing exists. The chip reads "approved — waiting on the next
// build" for exactly that window.
// ===========================================================================

/**
 * ⚠️ ONE CALL DECIDES THE WHOLE SURFACE. `GET .../requests` is member-gated and
 * its refusals are already the four the estate distinguishes (not signed in /
 * no record / awaiting approval / revoked), so its answer IS the standing — no
 * second /me round-trip, and no chance of the two disagreeing.
 *
 * `unreachable` is deliberately its OWN kind and not folded into a refusal. A
 * network or server failure is not a permissions failure, and mislabelling an
 * outage sends people asking for access they already have.
 */
let standing = { kind: 'anon' };
let myRequests = [];
/** The canonical list + alias map, once the server has answered. */
let nameData = null;
/** Series suggestions for the autocomplete; fetched lazily when the form opens. */
let seriesSuggestions = null;
let formOpen = false;

async function authedJson(origin, path, init) {
  const token = await idToken();
  if (!token) return { kind: 'lapsed' };
  let res;
  try {
    res = await fetch(`${origin}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init && init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch (e) {
    // ⚠️ A rejected CORS preflight surfaces to JS as a network error and looks
    // exactly like a Worker that is down. Either way it is an OUTAGE, and the
    // caller must not render it as a refusal.
    return { kind: 'network' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* a non-JSON body still has a status, but never shows one to a person */ }
  return { kind: 'answered', status: res.status, ok: res.ok, body: body || {} };
}

/** Refusal wording, per the design's §3.5. Every one says what happened, what
 *  it needs, and how to get it — and the SERVER's own sentence wins whenever it
 *  sent one, so the two never drift. */
function standingFrom(answer) {
  if (answer.kind === 'lapsed') return { kind: 'lapsed' };
  if (answer.kind === 'network') return { kind: 'unreachable' };
  if (answer.ok) {
    return {
      kind: answer.body.is_approver ? 'approver' : 'member',
      requests: Array.isArray(answer.body.requests) ? answer.body.requests : [],
      // A Worker ahead of its migration answers 200 with an explanation and an
      // empty queue — the page renders, and says why it is empty.
      note: answer.body.error ? answer.body.detail : null,
    };
  }
  const detail = typeof answer.body.detail === 'string' ? answer.body.detail : null;
  switch (answer.body.error) {
    case 'unauthenticated':
      return { kind: 'anon' };
    case 'estate_pending':
      return { kind: 'refused', detail: detail || 'Your estate membership is still awaiting approval, so requests are closed for now. The owner sees your name on /admin.' };
    case 'estate_revoked':
      return { kind: 'refused', detail: detail || 'Your estate access was revoked. Ask the owner.' };
    case 'estate_unknown':
      return { kind: 'refused', detail: detail || 'The estate directory has no record of this account yet.' };
    default:
      return { kind: 'unreachable' };
  }
}

async function loadRequestSurface() {
  if (!currentUser) {
    standing = { kind: 'anon' };
    myRequests = [];
    renderRequestSurface();
    return;
  }
  const answer = await authedJson(AUTH_ORIGIN, '/api/estate/universes/requests');
  standing = standingFrom(answer);
  myRequests = standing.requests || [];
  renderRequestSurface();

  // The real list, for a signed-in reader — see DISPLAY_NAMES's note above for
  // why the hardcoded copy stays as the signed-out fallback.
  if (standing.kind === 'member' || standing.kind === 'approver') void loadNames();
}

async function loadNames() {
  const answer = await authedJson(AUTH_ORIGIN, '/api/estate/universes/names');
  if (answer.kind !== 'answered' || !answer.ok || !Array.isArray(answer.body.names)) return;
  nameData = { names: answer.body.names, canonical: answer.body.canonical_names || {} };
  const next = [...answer.body.names].sort((a, b) => a.localeCompare(b));
  // Only rebuild when the served list actually differs — a rebuild collapses
  // every open row, and doing that on every load for no reason is a page that
  // shuts itself while you are reading it.
  if (next.length !== DISPLAY_NAMES.length || next.some((n, i) => n !== DISPLAY_NAMES[i])) {
    DISPLAY_NAMES = next;
    buildRows();
  }
}

/* ------------------------------------------------------------------ *
 * The name check, in the browser
 *
 * ⚠️ THIS IS A CONVENIENCE AND THE SERVER RUNS ITS OWN. The design says it
 * outright: the browser's copy of canonicalNames is a convenience, the row that
 * lands in D1 is the one that matters. So a mismatch between the two can only
 * ever cost a wasted keystroke — never a bad row.
 * ------------------------------------------------------------------ */

/** normText() from tools/lib/universes.mjs, and it must stay a port of it: the
 *  alias map's keys were normalised by that function. */
function normName(s) {
  return String(s == null ? '' : s)
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function localCheck(typed) {
  const key = normName(typed);
  if (!key) return { kind: 'empty' };
  const names = nameData ? nameData.names : UNIVERSE_NAMES;
  const canonical = nameData ? nameData.canonical : {};
  const exact = names.find((n) => normName(n) === key);
  if (exact) return { kind: 'exists', universe: exact };
  const folded = canonical[key];
  if (typeof folded === 'string') return { kind: 'alias', universe: folded };
  const near = names.filter((n) => {
    const k = normName(n);
    return k.includes(key) || key.includes(k);
  });
  return { kind: 'free', near };
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

function note(text, className) {
  const p = document.createElement('p');
  p.className = className || 'uni-note';
  p.textContent = text;
  return p;
}

function renderRequestSurface() {
  renderRequestChrome();
  renderPending();
}

function renderRequestChrome() {
  requestChromeEl.innerHTML = '';

  // ⚠️ SIGNED OUT: NOT RENDERED AT ALL. The page already carries a sign-in
  // invitation above; a second one attached to a button nobody can press is
  // noise, and a button that refuses is worse than a button that is absent.
  if (!authResolved || standing.kind === 'anon') {
    requestEl.hidden = true;
    formEl.hidden = true;
    return;
  }
  requestEl.hidden = false;

  if (standing.kind === 'lapsed') {
    requestChromeEl.appendChild(note('Your sign-in has lapsed — sign in again to ask for a verse.'));
    return;
  }
  if (standing.kind === 'unreachable') {
    // 🔴 An outage, said as an outage. Never as a permissions problem.
    requestChromeEl.appendChild(
      note('Couldn’t reach the estate directory — that’s an outage, not a permissions problem. Try again in a minute.'),
    );
    return;
  }
  if (standing.kind === 'refused') {
    requestChromeEl.appendChild(note(standing.detail));
    return;
  }

  const cta = document.createElement('div');
  cta.className = 'uni-cta';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'find-btn';
  btn.id = 'uni-add';
  btn.textContent = formOpen ? 'Never mind' : '+ Add a verse';
  btn.setAttribute('aria-expanded', formOpen ? 'true' : 'false');
  btn.addEventListener('click', () => {
    formOpen = !formOpen;
    renderRequestChrome();
    if (formOpen) {
      openForm();
    } else {
      formEl.hidden = true;
      formEl.innerHTML = '';
    }
  });
  cta.appendChild(btn);
  requestChromeEl.appendChild(cta);

  requestChromeEl.appendChild(
    note(
      'A verse is a decision the owner records in the estate’s universe list, so this asks him rather than ' +
        'adding one. Even a yes takes a rebuild of both catalogs before it shows up here.',
      'uni-cta-note',
    ),
  );
  if (standing.note) requestChromeEl.appendChild(note(standing.note, 'uni-cta-note'));
}

/** One repeatable list of text inputs. No comma-splitting: a series name with a
 *  comma in it is a real thing, and splitting on one corrupts it silently. */
function repeatField(labelText, hintText, listId) {
  const wrap = document.createElement('div');
  wrap.className = 'uni-field';
  const label = document.createElement('span');
  label.className = 'uni-label';
  label.textContent = labelText;
  wrap.appendChild(label);

  const rows = document.createElement('div');
  rows.className = 'uni-repeat';
  wrap.appendChild(rows);

  function addRow(value) {
    const row = document.createElement('div');
    row.className = 'uni-repeat-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'uni-input';
    input.value = value || '';
    if (listId) input.setAttribute('list', listId);
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'uni-drop';
    drop.setAttribute('aria-label', `Remove this ${labelText.toLowerCase()} row`);
    drop.textContent = '×';
    drop.addEventListener('click', () => {
      row.remove();
      if (!rows.querySelector('input')) addRow('');
    });
    row.append(input, drop);
    rows.appendChild(row);
    return input;
  }
  addRow('');

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'find-linkbtn';
  more.textContent = '+ add another';
  more.addEventListener('click', () => addRow('').focus());

  if (hintText) wrap.appendChild(note(hintText, 'uni-hint'));
  wrap.appendChild(more);

  return {
    el: wrap,
    values: () => [...rows.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
  };
}

async function loadSeriesSuggestions(datalist) {
  if (seriesSuggestions) {
    fillDatalist(datalist, seriesSuggestions);
    return;
  }
  const answer = await authedJson(INDEX_ORIGIN, '/api/series');
  if (answer.kind !== 'answered' || !answer.ok || !Array.isArray(answer.body.series)) return;
  seriesSuggestions = answer.body.series.map((s) => s.display_name || s.slug).filter(Boolean).sort((a, b) => a.localeCompare(b));
  fillDatalist(datalist, seriesSuggestions);
}

function fillDatalist(datalist, values) {
  datalist.innerHTML = '';
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    datalist.appendChild(opt);
  }
}

function openForm() {
  formEl.hidden = false;
  formEl.innerHTML = '';

  const panel = document.createElement('div');
  panel.className = 'uni-panel';

  // --- name, with the live check ------------------------------------------
  const nameField = document.createElement('label');
  nameField.className = 'uni-field';
  const nameLabel = document.createElement('span');
  nameLabel.className = 'uni-label';
  nameLabel.textContent = 'Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'uni-input';
  nameInput.autocomplete = 'off';
  nameInput.placeholder = 'Discworld';
  nameField.append(nameLabel, nameInput);
  const check = document.createElement('p');
  check.className = 'uni-check';
  check.hidden = true;
  nameField.appendChild(check);
  panel.appendChild(nameField);

  let blocked = false;
  nameInput.addEventListener('input', () => {
    const v = localCheck(nameInput.value);
    blocked = v.kind === 'exists' || v.kind === 'alias';
    if (v.kind === 'empty') {
      check.hidden = true;
      return;
    }
    check.hidden = false;
    if (v.kind === 'exists') {
      check.dataset.tone = 'block';
      check.textContent = `${v.universe} already exists — it is in the list below.`;
    } else if (v.kind === 'alias') {
      // ⚠️ THE CASE A NAIVE CHECK MISSES, and the common one.
      check.dataset.tone = 'block';
      check.textContent = `That’s a spelling of ${v.universe} — the estate already has it under that name.`;
    } else if (v.near.length) {
      // ⚠️ A WARNING, NEVER A BLOCK. Marvel, Disney and Star Wars are three
      // universes the owner deliberately split apart; a veto here would have
      // refused two of them.
      check.dataset.tone = 'warn';
      check.textContent = `Close to ${v.near.join(', ')}. Still a different verse? Say so in the reason and carry on.`;
    } else {
      check.dataset.tone = 'ok';
      check.textContent = 'No universe by that name yet.';
    }
  });

  // --- series --------------------------------------------------------------
  const datalist = document.createElement('datalist');
  datalist.id = 'uni-series-options';
  panel.appendChild(datalist);
  const series = repeatField(
    'Series',
    // §6 Q5: the suggestions are visibility-scoped by design, so the hint says
    // so rather than letting somebody wonder why a series is missing. Free text
    // is accepted — a series the estate does not hold yet is a legitimate
    // answer, and often the whole reason for asking.
    'Series from the catalogs you can see; type anything else freely.',
    'uni-series-options',
  );
  panel.appendChild(series.el);
  void loadSeriesSuggestions(datalist);

  // --- the two rarer lists -------------------------------------------------
  const titles = repeatField(
    'Also these exact titles',
    'For a standalone that belongs to the verse but sits in no series.',
  );
  panel.appendChild(titles.el);

  const notSeries = repeatField(
    'Deliberately NOT',
    'Anything that looks like it belongs and does not — worth saying, because somebody will otherwise add it later.',
  );
  panel.appendChild(notSeries.el);

  // --- why -----------------------------------------------------------------
  const whyField = document.createElement('label');
  whyField.className = 'uni-field';
  const whyLabel = document.createElement('span');
  whyLabel.className = 'uni-label';
  whyLabel.textContent = 'Why';
  const whyInput = document.createElement('textarea');
  whyInput.className = 'uni-textarea';
  whyInput.placeholder = 'What makes these one fiction, and why is it worth grouping?';
  whyField.append(whyLabel, whyInput);
  whyField.appendChild(
    // ⚠️ Mirrors the CLI's --why. tools/universes.mjs: "an entry that cannot say
    // why it exists is refused." The form must not be softer than the CLI.
    note('Required. Every entry in the estate’s universe list records why it exists.', 'uni-hint'),
  );
  panel.appendChild(whyField);

  // --- actions -------------------------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'uni-actions';
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'find-btn';
  submit.textContent = 'Ask the owner';
  const outcome = document.createElement('p');
  outcome.className = 'uni-check';
  outcome.hidden = true;
  actions.appendChild(submit);
  panel.append(actions, outcome);

  function say(text, tone) {
    outcome.hidden = false;
    outcome.dataset.tone = tone;
    outcome.textContent = text;
  }

  submit.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return say('A verse needs a name.', 'block');
    if (blocked) return say(check.textContent, 'block');
    if (whyInput.value.trim().length < 10) {
      return say('Say why this verse should exist — at least ten characters. The owner is being asked to make a decision.', 'block');
    }
    submit.disabled = true;
    say('Asking…', 'ok');
    const answer = await authedJson(AUTH_ORIGIN, '/api/estate/universes/requests', {
      method: 'POST',
      body: JSON.stringify({
        name,
        why: whyInput.value.trim(),
        series: series.values(),
        titles: titles.values(),
        notSeries: notSeries.values(),
      }),
    });
    submit.disabled = false;

    if (answer.kind === 'lapsed') return say('Your sign-in has lapsed — sign in again.', 'block');
    if (answer.kind === 'network') {
      return say('Couldn’t reach the estate directory — that’s an outage, not a permissions problem. Try again in a minute.', 'block');
    }
    if (!answer.ok) {
      // ⚠️ THE SERVER'S OWN SENTENCE, VERBATIM. It knows the alias map, it knows
      // whether somebody else already asked, and a second copy of that wording
      // here would be a second thing to keep in step. Never a bare status.
      return say(answer.body.detail || 'That request was not accepted. Try again shortly.', 'block');
    }

    formOpen = false;
    formEl.hidden = true;
    formEl.innerHTML = '';
    renderRequestChrome();
    setStatus(answer.body.detail || 'Asked. The owner decides.', '');
    await loadRequestSurface();
  });

  formEl.appendChild(panel);
  nameInput.focus();
}

/** The status chip's words. ⚠️ `approved` is the one that must not read as
 *  done: between a yes and a build, the verse does not exist. */
function chipText(row) {
  switch (row.status) {
    case 'pending':
      return 'pending';
    case 'approved':
      return row.stale ? `approved ${row.age_days} days ago, not yet in a build` : 'approved — waiting on the next build';
    case 'declined':
      return 'declined';
    case 'withdrawn':
      return 'withdrawn';
    default:
      return row.status;
  }
}

function whenText(iso) {
  if (!iso) return '';
  const t = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return '';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(t).toISOString().slice(0, 10);
}

function renderPending() {
  pendingEl.innerHTML = '';
  // ⚠️ `landed` rows are gone from here on purpose — by then the universe is a
  // real row in the list below, and showing it twice would make one page
  // disagree with itself.
  const rows = myRequests.filter((r) => r.status !== 'landed');
  if (!rows.length) {
    pendingEl.hidden = true;
    return;
  }
  pendingEl.hidden = false;

  const h = document.createElement('h2');
  h.textContent = standing.kind === 'approver' ? 'Waiting on a decision — every request' : 'Waiting on a decision';
  pendingEl.appendChild(h);

  const ul = document.createElement('ul');
  ul.className = 'uni-pending-list';
  for (const row of rows) {
    const li = document.createElement('li');
    // ⚠️ DELIBERATELY NOT `.uni-row`. A pending request must never be drawn as
    // a universe: a member would click it and find nothing there.
    li.className = 'uni-pending-row';

    const head = document.createElement('div');
    head.className = 'uni-pending-head';
    const name = document.createElement('span');
    name.className = 'uni-pending-name';
    name.textContent = row.name;
    const chip = document.createElement('span');
    chip.className = 'uni-chip';
    chip.dataset.status = row.status;
    chip.textContent = chipText(row);
    head.append(name, chip);
    li.appendChild(head);

    const meta = document.createElement('span');
    meta.className = 'uni-pending-meta';
    const who = row.mine ? 'requested by you' : row.requested_by ? `requested by ${row.requested_by}` : 'requested';
    const counts = [];
    if (row.payload && row.payload.series && row.payload.series.length) counts.push(`${row.payload.series.length} series`);
    if (row.payload && row.payload.titles && row.payload.titles.length) counts.push(`${row.payload.titles.length} titles`);
    meta.textContent = [who, whenText(row.requested_at), ...counts].filter(Boolean).join(' · ');
    li.appendChild(meta);

    const why = document.createElement('span');
    why.className = 'uni-pending-why';
    why.textContent = `“${row.why}”`;
    li.appendChild(why);

    // ⚠️ A decline ALWAYS shows the owner's reason, verbatim. The route refuses
    // a decline without one, which is what makes it safe to rely on here.
    if (row.status === 'declined' && row.decided_why) {
      const said = document.createElement('span');
      said.className = 'uni-pending-why';
      said.textContent = `↳ ${row.decided_why}`;
      li.appendChild(said);
    }

    // §6 Q4 — the requester's own exit, and only while it is still pending.
    // ⚠️ `row.mine` comes from the SERVER. Inferring it from the absence of a
    // requester name works for a plain member and breaks for an approver, whose
    // own row is named like every other one in the queue — the button would
    // vanish for the person most likely to press it. The server knows.
    if (row.status === 'pending' && row.mine) {
      const withdraw = document.createElement('button');
      withdraw.type = 'button';
      withdraw.className = 'find-linkbtn';
      withdraw.textContent = 'withdraw';
      withdraw.addEventListener('click', async () => {
        withdraw.disabled = true;
        const answer = await authedJson(AUTH_ORIGIN, `/api/estate/universes/requests/${row.id}/withdraw`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        withdraw.disabled = false;
        if (answer.kind !== 'answered' || !answer.ok) {
          setStatus(
            answer.kind === 'network'
              ? 'Couldn’t reach the estate directory — that’s an outage, not a permissions problem.'
              : (answer.body && answer.body.detail) || 'That could not be withdrawn.',
            'warn',
          );
          return;
        }
        await loadRequestSurface();
      });
      li.appendChild(withdraw);
    }

    ul.appendChild(li);
  }
  pendingEl.appendChild(ul);
}

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
  // The request surface crosses the same boundary: a signed-out visitor sees
  // no "+" at all, and a returning member's queue has to arrive.
  if (changed) void loadRequestSurface();
});

renderAuthState();

// Complete a redirect sign-in if one is landing (must run on every load).
handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
