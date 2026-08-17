/**
 * series.js — the /series page: one collapsed row per series in the estate's
 * series registry, expanding on click to GET /api/series/:slug.
 *
 * ⚠️ WHY THIS DUPLICATES universes.js RATHER THAN IMPORTING IT: the same
 * reason universes.js duplicates find.js, and that file's header states it —
 * this codebase's convention is one page, one script, no build step and no
 * shared render module (find.js, status.js, identity.js, universes.js are
 * each standalone). Duplication with intent, chosen over inventing shared
 * machinery for a third caller. The rowCard/coverFor idiom, the neutral-boot
 * auth block and the errorNote vocabulary below are that convention showing.
 *
 * AUTH: neutral boot, same shape as universes.js and find.js — authResolved
 * starts false, an 8s backstop forces it true (signed-out) if Firebase never
 * answers, and nothing commits to a signed-in/out claim before the first
 * watchAuth callback. A returning member must never see "sign in" flash.
 *
 * FETCHING: two lazy layers. GET /api/series once when auth resolves to a
 * member (the list, per-source counts only — no volumes). Then GET
 * /api/series/:slug on FIRST EXPAND of a row, one series at a time, never
 * eagerly. Signed out, neither call is made: series-route.ts's own header is
 * explicit that this surface sits below requireEstateMember() with no
 * anonymous carve-out (§4.5's carve-out names /api/search alone), so a
 * signed-out visitor gets the worded invitation universes.js uses, not a
 * fetch that would answer 401 and not a wall.
 *
 * ⚠️ THE VOLUME VIEW IS THIS FILE'S REASON TO EXIST (owner, 2026-08-17: "I
 * want missing books to say you don't have book 1 but audio and ebook do and
 * Skylar also owns it"). The API answers rows GROUPED BY MEDIUM; this file
 * REGROUPS them BY series_index into volumes, in number order, and — the
 * whole point — SYNTHESISES the numbers that are absent as distinct GAP
 * rows. Everything below the fetch is that transform:
 *
 *   volumesFrom()   flatten media[].entries → one bucket per series_index
 *   gapPlan()       which integers between the first and the last are absent
 *   holdingLabel()  source+format → the owner's words ("Skylar's library")
 *
 * ⚠️ THE SCOPE IS THE API'S AND IS NEVER RE-DERIVED HERE. Both endpoints
 * scope in SQL by the member's visibility set, and the list is built from
 * scoped ENTRY rows rather than the estate-wide `series` table so that a
 * member cannot learn the names of series only the private catalogs hold.
 * This page therefore says "nobody you can see has this" rather than "the
 * estate does not own this": a source outside your scope is not consulted,
 * and claiming a gap on its behalf would be a claim the wire cannot support.
 * The same rule governs "Not in …" — it names only sources that appear
 * ELSEWHERE IN THIS SERIES' OWN ANSWER, never the estate's full source list,
 * so the page never asserts the existence of a shelf it was not shown.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';

const INDEX_ORIGIN = 'https://index.heygabi.ai';

/**
 * entry.source (the push vocabulary) → the words the household actually uses
 * for that shelf. The owner's own sentence supplied these; index-worker's
 * SOURCE_FOR_CATALOG (search-route.ts) supplies the keys.
 *
 * ⚠️ `library2` and `ebook` are here AHEAD of any rows. Measured on the live
 * index 2026-08-17, GET /api/health reports exactly three sources with rows:
 * game 837, library 351, audiobook 1246. `library2` is a real scope value
 * whose federation has not minted a push token yet (search-route.ts says so),
 * and `ebook` is not an index source at all today — the estate's ebooks
 * arrive as `format: 'ebook'` rows under a library source, which
 * holdingLabel() renders as "Skylar's library (ebook)". Naming both here
 * costs nothing and means the first pushed row reads in words instead of in
 * database vocabulary; sourceLabel() falls back to the raw value regardless,
 * so an unfamiliar future source degrades to its own name rather than to a
 * bucket somebody guessed at.
 */
const SOURCE_LABELS = {
  library: "Skylar's library",
  library2: "Samantha's library",
  audiobook: 'audiobook (shared pool)',
  ebook: 'ebook (shared pool)',
  game: 'games',
};

/** The visibility vocabulary (`scope` on the wire) differs from the push
 *  vocabulary in exactly one place — games↔game — same as the Worker's own
 *  SOURCE_FOR_CATALOG map. Kept separate rather than fudged. */
const CATALOG_LABELS = {
  library: SOURCE_LABELS.library,
  library2: SOURCE_LABELS.library2,
  audiobook: SOURCE_LABELS.audiobook,
  games: SOURCE_LABELS.game,
};

/** A format already implied by the source's own label — saying it twice
 *  ("audiobook (shared pool) (audiobook)") is noise, so it is dropped. */
const IMPLIED_FORMAT = { audiobook: 'audiobook', ebook: 'ebook', game: 'boardgame' };

/** ⚠️ THE GAP GUARD. A gap row is synthesised for every integer between the
 *  first and last volume that nobody holds — which is exactly right for a
 *  9-book series and exactly wrong for a row whose series_index is really a
 *  year (2019) or a catalog number. Two ceilings, deliberately conservative,
 *  and when either trips the page SAYS SO instead of silently listing only
 *  what it has: a page that quietly stops answering its own question is
 *  worse than one that admits the numbering defeated it. */
const GAP_MAX_INDEX = 60;
const GAP_MAX_ROWS = 25;

const whoEl = document.getElementById('ser-who');
const signinBtn = document.getElementById('ser-signin');
const statusEl = document.getElementById('ser-status');
const listEl = document.getElementById('ser-list');
const filterWrap = document.getElementById('ser-filter');
const filterInput = document.getElementById('ser-filter-input');
const countEl = document.getElementById('ser-count');

let currentUser = null;
let seriesList = []; // the last /api/series answer's `series` array
let listedFor = null; // 'member' | 'anon' — which side of the auth boundary the list was built for

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
  statusEl.hidden = !text;
}

// ---------------------------------------------------------------------------
// Auth — neutral boot, same shape as universes.js
// ---------------------------------------------------------------------------

let authResolved = false;
const authBackstop = setTimeout(() => {
  if (!authResolved) {
    authResolved = true;
    renderAuthState();
    refreshList();
  }
}, 8000);

function renderAuthState() {
  if (!authResolved) {
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
// Words — the source/format vocabulary, and small English helpers
// ---------------------------------------------------------------------------

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source;
}

function catalogLabel(catalog) {
  return CATALOG_LABELS[catalog] || catalog;
}

/** "Skylar's library (hardcover)" / "audiobook (shared pool)" — who holds it,
 *  in which format, in one phrase. */
function holdingLabel(source, format) {
  const label = sourceLabel(source);
  if (!format) return label;
  if (IMPLIED_FORMAT[source] === format) return label;
  return `${label} (${format})`;
}

/** ["a", "b", "c"] → "a, b and c". A list a person reads out loud. */
function joinWords(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** 1 → "1", 1.5 → "1.5". series_index is a REAL column, so a half-volume is a
 *  real value printed as itself, never rounded into the volume beside it. */
function fmtIndex(n) {
  return String(n);
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// The transform: rows grouped by medium → volumes in number order, gaps included
// ---------------------------------------------------------------------------

/**
 * Flattens the API's media[] grouping back into one list and re-buckets it by
 * series_index. Returns `{ numbered, unnumbered, sources }`:
 *   numbered   Map<number, entry[]>  — one bucket per volume number
 *   unnumbered entry[]               — series_index IS NULL, kept for the end
 *   sources    Set<string>           — every source appearing ANYWHERE in this
 *                                      series' answer; the only shelves this
 *                                      page will ever name as missing a volume
 */
function volumesFrom(data) {
  const numbered = new Map();
  const unnumbered = [];
  const sources = new Set();
  for (const group of data.media || []) {
    for (const entry of group.entries || []) {
      sources.add(entry.source);
      const idx = entry.series_index;
      if (idx === null || idx === undefined || Number.isNaN(Number(idx))) {
        unnumbered.push(entry);
        continue;
      }
      const key = Number(idx);
      const bucket = numbered.get(key);
      if (bucket) bucket.push(entry);
      else numbered.set(key, [entry]);
    }
  }
  return { numbered, unnumbered, sources };
}

/**
 * Which numbers are MISSING between the first volume and the last.
 *
 * Starts at 1 even when the lowest held volume is 3 — "you don't have book 1"
 * is the owner's own example and the most valuable gap the page can show.
 * Starts lower only if the series itself numbers from 0 or below (prequels).
 *
 * Returns `{ gaps, suppressed, reason }`. `suppressed` is not a failure: it
 * is the honest refusal for numbering the page cannot interpret (see
 * GAP_MAX_INDEX / GAP_MAX_ROWS), and the caller prints `reason`.
 */
function gapPlan(indices) {
  if (indices.length === 0) return { gaps: [], suppressed: false, reason: '' };
  const lo = Math.min(1, Math.floor(Math.min(...indices)));
  const hi = Math.floor(Math.max(...indices));
  if (hi > GAP_MAX_INDEX) {
    return {
      gaps: [],
      suppressed: true,
      reason:
        `The numbering here runs to ${hi}, which is high enough that it is probably ` +
        'not a volume count — so nothing is guessed about missing numbers. Only what the estate holds is listed.',
    };
  }
  const present = new Set(indices.map((n) => Math.floor(n)));
  const gaps = [];
  for (let n = lo; n <= hi; n += 1) if (!present.has(n)) gaps.push(n);
  if (gaps.length > GAP_MAX_ROWS) {
    return {
      gaps: [],
      suppressed: true,
      reason:
        `${gaps.length} of the numbers between ${lo} and ${hi} are absent — too sparse to read as a shelf ` +
        'with holes in it, so nothing is guessed. Only what the estate holds is listed.',
    };
  }
  return { gaps, suppressed: false, reason: '' };
}

// ---------------------------------------------------------------------------
// Rendering — page-local, same .hit contract as find.js/universes.js
// ---------------------------------------------------------------------------

function numberBadge(text) {
  const span = document.createElement('span');
  span.className = 'vol-num';
  span.textContent = text;
  return span;
}

function coverBox(entry) {
  const box = document.createElement('span');
  box.className = 'hit-cover';
  box.setAttribute('aria-hidden', 'true');
  if (entry && entry.cover_url) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.width = 42;
    img.height = 58;
    img.src = entry.cover_url;
    // Same as find.js: a broken cover drops the image and keeps the slot,
    // so the row stays aligned instead of collapsing.
    img.addEventListener('error', () => img.remove());
    box.appendChild(img);
  }
  return box;
}

/** One holding, as a link when the owning catalog gave us somewhere to go. */
function holdingNode(entry) {
  const text = holdingLabel(entry.source, entry.format);
  if (!entry.detail_url) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
  }
  const a = document.createElement('a');
  a.href = entry.detail_url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

/**
 * A volume the estate HAS — the owner's sentence, rendered: the title, then
 * who holds it in which format, then (only when some shelf in this series
 * lacks it) who does not.
 */
function volumeRow(index, entries, seriesSources) {
  const li = document.createElement('li');
  li.className = 'hit';
  li.appendChild(numberBadge(index === null ? '—' : fmtIndex(index)));

  const withCover = entries.find((e) => e.cover_url);
  li.appendChild(coverBox(withCover));

  const body = document.createElement('div');
  body.className = 'hit-body';

  // The API orders by series_index then title, so entries[0] is a stable
  // choice — and where two catalogs spell a title differently, showing one
  // spelling with every holding named beneath it beats showing both as if
  // they were two books.
  const lead = entries[0];
  const title = document.createElement('span');
  title.className = 'hit-title';
  const linked = entries.find((e) => e.detail_url);
  if (linked) {
    const a = document.createElement('a');
    a.href = linked.detail_url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = lead.title;
    title.appendChild(a);
  } else {
    title.textContent = lead.title;
  }
  body.appendChild(title);

  const bits = [];
  if (lead.creator) bits.push(lead.creator);
  if (lead.year) bits.push(String(lead.year));
  if (bits.length) {
    const meta = document.createElement('span');
    meta.className = 'hit-meta';
    meta.textContent = bits.join(' · ');
    body.appendChild(meta);
  }

  // Held by — one phrase per distinct source+format, deduped so two copies of
  // the same edition do not read as two shelves.
  const held = document.createElement('span');
  held.className = 'vol-held';
  held.append('On ');
  const seen = new Set();
  const nodes = [];
  for (const entry of entries) {
    const key = `${entry.source}|${entry.format}`;
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(holdingNode(entry));
  }
  nodes.forEach((node, i) => {
    if (i > 0) held.append(i === nodes.length - 1 ? ' and ' : ', ');
    held.appendChild(node);
  });
  held.append('.');
  body.appendChild(held);

  // ⚠️ Missing FROM WHAT: only the shelves that carry some other volume of
  // THIS series. Never the estate's full source list — see the file header;
  // naming a shelf that holds nothing here would invent a shelf the answer
  // never showed, and would print "not in games" under every novel.
  const holders = new Set(entries.map((e) => e.source));
  const missing = [...seriesSources].filter((s) => !holders.has(s));
  if (missing.length) {
    const gap = document.createElement('span');
    gap.className = 'vol-missed';
    gap.textContent = `Not in ${joinWords(missing.map(sourceLabel))}.`;
    body.appendChild(gap);
  }

  li.appendChild(body);
  return li;
}

/** ⚠️ A number NOBODY in the viewer's scope holds — the row the owner asked
 *  for. Rendered as its own thing (.hit.gap), never as a dimmed book. */
function gapRow(index) {
  const li = document.createElement('li');
  li.className = 'hit gap';
  li.appendChild(numberBadge(fmtIndex(index)));
  // An EMPTY cover slot, deliberately: it keeps this row's text on the same
  // column as the volumes above and below it, so the eye reads one list with
  // a hole in it rather than two kinds of row. The empty frame is honest —
  // there is no book here to have a cover.
  li.appendChild(coverBox(null));

  const body = document.createElement('div');
  body.className = 'hit-body';

  const title = document.createElement('span');
  title.className = 'hit-title';
  title.textContent = `Book ${fmtIndex(index)} — nobody in the estate has this one`;
  body.appendChild(title);

  const meta = document.createElement('span');
  meta.className = 'vol-missed';
  meta.textContent = 'Not on any shelf you can see, in any format.';
  body.appendChild(meta);

  li.appendChild(body);
  return li;
}

function noteP(text, className) {
  const p = document.createElement('p');
  p.className = className || 'ser-note';
  p.textContent = text;
  return p;
}

function groupHeading(text) {
  const h = document.createElement('h3');
  h.className = 'find-group';
  h.textContent = text;
  return h;
}

/** Renders one /api/series/:slug answer into `body` (the row's expand slot). */
function renderSeriesBody(body, data) {
  body.innerHTML = '';

  if (data.reason === 'no_catalogs_visible') {
    body.appendChild(
      noteP('Your account currently has no catalogs visible. An approver can restore them.'),
    );
    return;
  }

  const { numbered, unnumbered, sources } = volumesFrom(data);
  if (numbered.size === 0 && unnumbered.length === 0) {
    body.appendChild(noteP('Nothing in this series is on a shelf you can see right now.'));
    return;
  }

  body.appendChild(
    noteP(
      'A volume listed means it is in a catalog — some entries are wanted, not owned. ' +
        'Tap a format to open the owning catalog.',
      'find-caveat',
    ),
  );

  const indices = [...numbered.keys()].sort((a, b) => a - b);
  const plan = gapPlan(indices);

  if (indices.length) {
    const ul = document.createElement('ul');
    ul.className = 'hits';
    const keys = [...indices, ...plan.gaps].sort((a, b) => a - b);
    for (const key of keys) {
      const entries = numbered.get(key);
      if (entries) ul.appendChild(volumeRow(key, entries, sources));
      else ul.appendChild(gapRow(key));
    }
    body.appendChild(ul);
    if (plan.suppressed) body.appendChild(noteP(plan.reason));
    else if (plan.gaps.length) {
      body.appendChild(
        noteP(
          `${plural(plan.gaps.length, 'number is', 'numbers are')} missing between ` +
            `${fmtIndex(Math.min(...keys))} and ${fmtIndex(Math.max(...keys))} — the dashed rows above.`,
        ),
      );
    }
  }

  // Unnumbered last, per the brief: a companion volume or a box set with no
  // series_index is real, but it cannot take part in the gap arithmetic, so
  // it is kept out of it rather than given a number it does not have.
  if (unnumbered.length) {
    body.appendChild(groupHeading(`Unnumbered (${unnumbered.length})`));
    const ul = document.createElement('ul');
    ul.className = 'hits';
    for (const entry of unnumbered) ul.appendChild(volumeRow(null, [entry], sources));
    body.appendChild(ul);
  }
}

/** The index's own error vocabulary (universes.js's errorNote, retargeted —
 *  §1e: a person never sees a bare HTTP status). */
function errorNote(status, errCode, what) {
  switch (errCode) {
    case 'estate_pending':
      return 'Your account is awaiting approval. An approver admits new members; nothing more for you to do.';
    case 'estate_revoked':
      return 'Your access has been revoked.';
    case 'estate_unreachable':
      return 'The estate directory did not answer, so new admissions cannot be checked right now. Try again shortly.';
    case 'unauthenticated':
      return 'The index did not accept the sign-in token. Sign out and back in.';
    case 'unknown_series':
      return 'That series is not on any shelf you can see. It may have been merged into another spelling — reload the page for the current list.';
    default:
      return `Could not load ${what}${errCode ? ` (${errCode})` : ''}. Try again shortly.`;
  }
}

/** One fetch, one place, so both callers get the same error vocabulary. */
async function callIndex(path) {
  const token = await idToken();
  if (!token) return { error: 'Your sign-in has lapsed — sign in again.' };
  let res;
  try {
    res = await fetch(`${INDEX_ORIGIN}${path}`, { headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    // ⚠️ A CSP-blocked fetch lands HERE, indistinguishable from a dead host —
    // if this ever fires estate-wide, check _headers' /series connect-src
    // before believing the index is down (estate-auth-design.md §1.2).
    return { error: 'The index did not answer (network). Try again shortly.' };
  }
  if (!res.ok) {
    let errBody = null;
    try {
      errBody = await res.json();
    } catch (e) {
      /* non-JSON error body; the status still speaks through errorNote */
    }
    return { status: res.status, code: errBody?.error || null };
  }
  return { data: await res.json() };
}

// ---------------------------------------------------------------------------
// The list — fetched once per signed-in session, each row a lazy fetch on expand
// ---------------------------------------------------------------------------

function scopeSentence(scope) {
  if (!Array.isArray(scope) || scope.length === 0) return '';
  return `Your view covers ${joinWords(scope.map(catalogLabel))}.`;
}

function buildRows(list) {
  listEl.innerHTML = '';
  for (const series of list) {
    const li = document.createElement('li');
    li.className = 'ser-row';
    li.dataset.name = (series.display_name || series.slug).toLowerCase();

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ser-toggle';
    btn.setAttribute('aria-expanded', 'false');

    const head = document.createElement('span');
    head.className = 'ser-head';
    const name = document.createElement('span');
    name.className = 'ser-name';
    name.textContent = series.display_name || series.slug;
    head.appendChild(name);

    const counts = document.createElement('span');
    counts.className = 'ser-counts';
    const perSource = Object.entries(series.sources || {})
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([source, n]) => `${sourceLabel(source)} ${n}`);
    counts.textContent = [plural(series.total, 'entry', 'entries'), ...perSource].join(' · ');
    head.appendChild(counts);

    btn.appendChild(head);

    const body = document.createElement('div');
    body.className = 'ser-body';
    body.hidden = true;

    let loaded = false;
    let inFlight = false;

    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        btn.setAttribute('aria-expanded', 'false');
        body.hidden = true;
        return;
      }
      btn.setAttribute('aria-expanded', 'true');
      body.hidden = false;
      if (loaded || inFlight) return;
      inFlight = true;
      populate(body, series).then(() => {
        inFlight = false;
        loaded = true;
      });
    });

    li.append(btn, body);
    listEl.appendChild(li);
  }
  applyFilter();
}

async function populate(body, series) {
  body.innerHTML = '';
  body.appendChild(noteP(`Loading ${series.display_name || series.slug}…`));

  const r = await callIndex(`/api/series/${encodeURIComponent(series.slug)}`);
  if (r.error) {
    body.innerHTML = '';
    body.appendChild(noteP(r.error));
    return;
  }
  if (r.code !== undefined && r.data === undefined) {
    body.innerHTML = '';
    body.appendChild(noteP(errorNote(r.status, r.code, 'this series')));
    return;
  }
  renderSeriesBody(body, r.data);
}

/** Page-local, no network — see index.html's own note on the filter box. */
function applyFilter() {
  const q = (filterInput.value || '').trim().toLowerCase();
  let shown = 0;
  for (const li of listEl.children) {
    const match = !q || li.dataset.name.includes(q);
    li.hidden = !match;
    if (match) shown += 1;
  }
  if (!seriesList.length) {
    countEl.textContent = '';
    return;
  }
  countEl.textContent = q
    ? `${shown} of ${seriesList.length}`
    : plural(seriesList.length, 'series', 'series');
}

filterInput.addEventListener('input', applyFilter);

/** Loads (or clears) the list for whichever side of the auth boundary we are
 *  on. Signed out: the invitation, and no fetch at all. */
async function refreshList() {
  if (!authResolved) return;
  const want = currentUser ? 'member' : 'anon';
  if (listedFor === want) return;
  listedFor = want;

  if (!currentUser) {
    seriesList = [];
    listEl.innerHTML = '';
    filterWrap.hidden = true;
    setStatus(
      'The series view spans every shelf the estate indexes, so it needs a sign-in. ' +
        'Sign in and this page lists every series you can see — and, inside each one, the volumes nobody has.',
    );
    return;
  }

  setStatus('Loading the estate’s series…');
  const r = await callIndex('/api/series');
  if (listedFor !== want) return; // signed out while the request was in flight
  if (r.error) {
    setStatus(r.error, 'warn');
    return;
  }
  if (r.code !== undefined && r.data === undefined) {
    setStatus(errorNote(r.status, r.code, 'the series list'), 'warn');
    return;
  }

  const data = r.data;
  if (data.reason === 'no_catalogs_visible') {
    seriesList = [];
    listEl.innerHTML = '';
    filterWrap.hidden = true;
    setStatus('Your account currently has no catalogs visible. An approver can restore them.', 'warn');
    return;
  }

  seriesList = data.series || [];
  if (!seriesList.length) {
    listEl.innerHTML = '';
    filterWrap.hidden = true;
    setStatus(`No series are on a shelf you can see. ${scopeSentence(data.scope)}`.trim());
    return;
  }

  const volumes = seriesList.reduce((sum, s) => sum + (s.total || 0), 0);
  const summary = `${plural(seriesList.length, 'series', 'series')}, ${plural(volumes, 'entry', 'entries')}.`;
  setStatus(`${summary} ${scopeSentence(data.scope)}`.trim());
  filterWrap.hidden = false;
  buildRows(seriesList);
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
  // Crossing the auth boundary invalidates the whole list (a member's scope
  // decides what it even contains), so it is refetched rather than patched.
  // ⚠️ refreshList() runs on EVERY callback, not only on `changed`: the very
  // first callback of a signed-out load reports null when currentUser is
  // already null, which is not a change but IS the moment the page may first
  // speak. Its own listedFor guard makes the repeat calls free.
  if (changed) listedFor = null;
  refreshList();
});

renderAuthState();

// Complete a redirect sign-in if one is landing (must run on every load).
handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
