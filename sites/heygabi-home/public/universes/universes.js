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
const DISPLAY_NAMES = [...UNIVERSE_NAMES].sort((a, b) => a.localeCompare(b));

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
