/**
 * /docs — search and read the estate's own documentation (GABI docs assistant,
 * phase 6). Design: catalog-platform docs/info/gabi-docs-assistant-design.md.
 *
 * Owner's bar for this page, verbatim (2026-08-18): *"sure, but make it with a
 * search bar and pretty to look at."* Both halves are requirements, and the
 * first is the harder one: this is a REAL search — every keystroke (debounced,
 * and with the previous request aborted) hits GET /api/estate/docs/search on
 * the auth Worker, which scans 1,400 sections of the live snapshot. It is not
 * a filter over a list this page already has, because this page is never given
 * one: it holds no documentation at all until a devops-class token asks for it.
 *
 * ⚠️ THIS FILE DECIDES NOTHING ABOUT ACCESS. The gate is `requireDevops()` in
 * apps/auth-worker/src/estate-docs.ts and nowhere else. A 200 IS the
 * capability probe; 401 and 403 are rendered as the Worker's own worded
 * sentences. Revoke someone's devops in /admin and their next search is
 * refused, with no deploy here and no second place to remember.
 *
 * ⚠️ EVERY REFUSAL AND EVERY FAILURE IS A SENTENCE. A person must never see a
 * bare HTTP status, a dead button, or a blank page — and the four causes must
 * stay distinguishable, because their fixes differ: not signed in / signed in
 * but not devops / the Worker is unreachable / the snapshot has not been
 * published. `describeFailure()` below is the one place that mapping lives.
 * ⚠️ A NETWORK OR SERVER FAILURE IS NOT A PERMISSION FAILURE. Labelling an
 * outage as one sends the owner hunting for a grant he already holds.
 *
 * ⚠️ NOTHING IS EVER WRITTEN WITH innerHTML. Every heading, snippet, table
 * cell and code block below is built as DOM nodes with `textContent`, and the
 * highlighter wraps matches in real `<mark>` elements rather than splicing
 * tags into a string. The corpus is our own writing, so this is not a defence
 * against a hostile author — it is a defence against the ordinary case, where
 * a runbook contains `<script>` inside a code fence, or an angle bracket in a
 * shell one-liner, and an innerHTML renderer would either execute it or
 * silently eat it. The markdown renderer therefore had to be written rather
 * than borrowed; it is deliberately a SUBSET (headings, fenced code, lists,
 * tables, blockquotes, rules, and inline code/bold/italic/links) chosen from
 * what the estate's docs actually use.
 *
 * ⚠️ THE SNAPSHOT DATE IS RENDERED ON EVERY STATE, and the staleness verdict
 * comes from the Worker (`snapshot.stale`, `snapshot.warning`). This page owns
 * NO threshold of its own — the same discipline /status keeps for the backup
 * thresholds, and for the same reason: two copies drift, and only one of them
 * is under test.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';
const SEARCH_URL = `${AUTH_ORIGIN}/api/estate/docs/search`;
const SECTION_URL = `${AUTH_ORIGIN}/api/estate/docs/section`;

/** Long enough that a typed word is one request, short enough to feel live.
 *  Every in-flight request is aborted when the next keystroke lands, so the
 *  cost of being wrong here is latency, never a stale render. */
const DEBOUNCE_MS = 190;
const RESULT_LIMIT = 20;

/** Four real questions, so the empty state teaches the corpus's shape instead
 *  of sitting blank. Each is known to match something; the first is the
 *  design's own review phrase. */
const SEEDS = ['revocation delay', 'promote to prod', 'rollback', 'pipeline step'];

const el = (id) => document.getElementById(id);
const gate = el('gate');
const gateText = el('gate-text');
const signinBtn = el('signin');
const whoEl = el('who');
const snapstrip = el('snapstrip');
const searchwrap = el('searchwrap');
const searchbar = el('searchbar');
const qInput = el('q');
const clearBtn = el('clear');
const searchmeta = el('searchmeta');
const seedsEl = el('seeds');
const resultsEl = el('results');
const emptyEl = el('empty');
const reader = el('reader');

let currentUser = null;
let authResolved = false;
let inflight = null;
let debounceTimer = null;
let lastResults = [];
let lastTerms = [];
/** The whole last search envelope, kept so "back to results" restores the view
 *  the reader left — including the `matched: 'any'` badge. Rebuilding it from
 *  `lastResults` alone would silently upgrade a loose match to an exact one on
 *  the way back, which is the one thing the badge exists to prevent. */
let lastBody = null;

// ---------------------------------------------------------------------------
// Gate + chrome
// ---------------------------------------------------------------------------

function setGate(text, tone) {
  gateText.textContent = text;
  gate.hidden = false;
  if (tone) gate.dataset.tone = tone;
  else delete gate.dataset.tone;
}

function hideGate() {
  gate.hidden = true;
  delete gate.dataset.tone;
}

/**
 * The one place an HTTP outcome becomes a sentence. ⚠️ Keep the four causes
 * apart: "sign in", "you are signed in but this is not for you", "we are
 * broken", and "nothing has been published yet" have four different fixes, and
 * collapsing any two of them sends someone to solve the wrong problem.
 */
function describeFailure(status, body) {
  if (typeof body?.detail === 'string' && body.detail) {
    // The Worker already worded it — including all four §4.5 refusals and the
    // "this is our configuration, not your access" ones. Prefer its copy over
    // a second wording invented here.
    return { text: body.detail, tone: status === 403 || status === 401 ? 'refused' : 'outage' };
  }
  if (status === 401) {
    return { text: 'Your sign-in has lapsed. Sign in again to search the docs.', tone: null };
  }
  if (status === 403) {
    return {
      text: 'The estate docs are limited to devops-class members, and your account isn’t one. Ask an approver in /admin if you need it — that’s a deliberate line, not a glitch.',
      tone: 'refused',
    };
  }
  return {
    text: 'The docs service did not answer — that’s a problem on our side, not your permissions. Try again in a minute.',
    tone: 'outage',
  };
}

function renderAuthState() {
  const signedIn = currentUser !== null;
  signinBtn.hidden = signedIn || !authResolved;

  if (!signedIn) {
    whoEl.hidden = true;
    whoEl.textContent = '';
    searchwrap.hidden = true;
    seedsEl.hidden = true;
    resultsEl.replaceChildren();
    emptyEl.hidden = true;
    reader.hidden = true;
    snapstrip.hidden = true;
    setGate(
      authResolved
        ? 'The estate docs are for devops-class members. Sign in and I’ll search them for you.'
        : 'Checking sign-in…',
      null,
    );
    return;
  }

  whoEl.textContent = '';
  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'find-linkbtn';
  out.textContent = 'sign out';
  out.addEventListener('click', async () => {
    await signOutUser();
  });
  whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
  whoEl.hidden = false;
}

// ---------------------------------------------------------------------------
// The snapshot strip — always visible once we have a date
// ---------------------------------------------------------------------------

function renderSnapshot(snapshot) {
  if (!snapshot || !snapshot.generated_at) return;
  snapstrip.replaceChildren();

  const when = new Date(snapshot.generated_at);
  const label = Number.isNaN(when.getTime())
    ? snapshot.generated_at
    : when.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });

  const parts = [];
  const stamp = document.createElement('span');
  stamp.append('Snapshot published ');
  const b = document.createElement('b');
  b.textContent = label;
  stamp.append(b);
  parts.push(stamp);

  if (typeof snapshot.files === 'number') {
    const c = document.createElement('span');
    c.append(`${snapshot.files.toLocaleString()} documents · ${(snapshot.sections ?? 0).toLocaleString()} sections`);
    parts.push(c);
  }

  // ⚠️ The warning is the Worker's sentence, verbatim. This page decides
  // nothing about when a snapshot is stale — one threshold, server-side.
  if (snapshot.stale && snapshot.warning) {
    const w = document.createElement('span');
    w.textContent = snapshot.warning;
    parts.push(w);
    snapstrip.dataset.tone = 'stale';
  } else {
    delete snapstrip.dataset.tone;
  }

  parts.forEach((node, i) => {
    if (i > 0) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.textContent = '·';
      snapstrip.append(dot);
    }
    snapstrip.append(node);
  });
  snapstrip.hidden = false;
}

// ---------------------------------------------------------------------------
// Highlighting — the reason a search result is readable at a glance
// ---------------------------------------------------------------------------

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap every occurrence of any term in a real <mark> element. Returns a
 * DocumentFragment of text nodes and marks — never a string of markup, so a
 * document containing `<b>` or `&amp;` renders as those characters rather than
 * as tags or as an entity.
 */
function markText(str, terms) {
  const frag = document.createDocumentFragment();
  const usable = (terms || []).filter((t) => t && t.length >= 2);
  if (usable.length === 0) {
    frag.append(document.createTextNode(str));
    return frag;
  }
  const re = new RegExp(`(${usable.map(escapeRe).join('|')})`, 'gi');
  let last = 0;
  let m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) frag.append(document.createTextNode(str.slice(last, m.index)));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    frag.append(mark);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1; // paranoia: never loop forever
  }
  if (last < str.length) frag.append(document.createTextNode(str.slice(last)));
  return frag;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function runSearch(query) {
  if (inflight) inflight.abort();
  const controller = new AbortController();
  inflight = controller;

  const token = await idToken();
  if (!token) {
    setGate('Your sign-in has lapsed. Sign in again to search the docs.', null);
    return;
  }

  let res;
  try {
    res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(query)}&limit=${RESULT_LIMIT}`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') return; // superseded by a later keystroke
    // ⚠️ A rejected fetch() is ALSO what a CSP block looks like — the two are
    // indistinguishable from in here, which is why _headers must name
    // auth.heygabi.ai in connect-src. Say what is actually known.
    setGate(
      location.origin !== CANONICAL_ORIGIN
        ? `The docs service did not answer. It only accepts calls from ${CANONICAL_ORIGIN} — this page is running on ${location.origin}.`
        : 'The docs service did not answer (network). That’s a problem on our side, not your permissions — try again shortly.',
      'outage',
    );
    return;
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const { text, tone } = describeFailure(res.status, body);
    setGate(text, tone);
    searchwrap.hidden = res.status === 401 || res.status === 403;
    resultsEl.replaceChildren();
    emptyEl.hidden = true;
    return;
  }

  hideGate();
  renderSnapshot(body.snapshot);
  lastTerms = Array.isArray(body.terms) ? body.terms : [];
  lastResults = Array.isArray(body.results) ? body.results : [];
  lastBody = body;
  renderResults(body);
}

function renderResults(body) {
  reader.hidden = true;
  resultsEl.replaceChildren();
  seedsEl.hidden = lastResults.length > 0;

  searchmeta.replaceChildren();
  const count = document.createElement('span');
  const total = body.total ?? lastResults.length;
  count.textContent =
    lastResults.length === 0
      ? 'No matching sections'
      : `${lastResults.length} of ${total.toLocaleString()} matching section${total === 1 ? '' : 's'}`;
  searchmeta.append(count);

  // ⚠️ A loose match must never be presented as an exact one. The Worker falls
  // back to any-token matching only when every-token found nothing, and says
  // which pass answered; showing that is what keeps the page honest about how
  // hard it had to look.
  if (body.matched === 'any' && lastResults.length > 0) {
    const loose = document.createElement('span');
    loose.className = 'loose';
    loose.textContent = 'closest matches — not every word appears together';
    searchmeta.append(loose);
  }
  searchmeta.hidden = false;

  if (lastResults.length === 0) {
    emptyEl.replaceChildren();
    const p = document.createElement('p');
    p.style.margin = '0';
    // The Worker's own absence sentence when it sent one — absence reported as
    // absence, never an answer from general knowledge dressed as an estate fact.
    p.textContent =
      body.detail ||
      'I don’t have anything on that in the docs snapshot — that means it is not in the estate’s docs, not that it is not true.';
    emptyEl.append(p);
    emptyEl.hidden = false;
    seedsEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  lastResults.forEach((hit) => {
    const li = document.createElement('li');
    li.className = 'result';
    li.dataset.repo = hit.repo;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'open';

    const top = document.createElement('div');
    top.className = 'r-top';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = hit.repo;
    const path = document.createElement('span');
    path.className = 'r-path';
    path.textContent = shortPath(hit.path);
    top.append(chip, path);

    const head = document.createElement('div');
    head.className = 'r-head';
    head.append(markText(hit.heading, lastTerms));

    const snip = document.createElement('p');
    snip.className = 'r-snip';
    snip.append(markText(hit.snippet, lastTerms));

    btn.append(top, head, snip);
    btn.addEventListener('click', () => openSection(hit.id));
    li.append(btn);
    resultsEl.append(li);
  });
}

/** `catalog-platform/docs/info/x.md` reads better as `info/x.md` beside the
 *  repo chip that already names the tree. The full path is still named in the
 *  reader, where it is the citation. */
function shortPath(path) {
  return path.replace(/^[^/]+\/docs\//, '');
}

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

async function openSection(id) {
  const token = await idToken();
  if (!token) {
    setGate('Your sign-in has lapsed. Sign in again to read this.', null);
    return;
  }

  let res;
  try {
    res = await fetch(`${SECTION_URL}?id=${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    setGate('The docs service did not answer (network). That’s on our side, not your permissions.', 'outage');
    return;
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const { text, tone } = describeFailure(res.status, body);
    setGate(text, tone);
    return;
  }

  renderSnapshot(body.snapshot);
  renderReader(body.section, body.snapshot);
  // A shareable, bookmarkable address for one section. replaceState, not push:
  // the reader is a view of the same search, not a new page in the history.
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
}

function renderReader(section, snapshot) {
  reader.dataset.repo = section.repo;
  el('reader-src').textContent = `${section.path}  §  ${section.heading}`;
  el('reader-title').textContent = section.heading;

  // ⚠️ SOURCE AND DATE TOGETHER, inside the document rather than beside it. A
  // section read without knowing which file it came from or how old it is
  // invites exactly the mistake this feature exists to prevent.
  const when = snapshot?.generated_at ? new Date(snapshot.generated_at) : null;
  const whenLabel = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : snapshot?.generated_at || 'an unknown date';
  const parts = [`From ${section.title} — section ${section.id.split('#').pop()} of ${section.of_sections}.`,
                 `As published on ${whenLabel}.`];
  if (snapshot?.stale && snapshot.warning) parts.push(snapshot.warning);
  if (section.truncated) {
    parts.push('⚠️ This section was longer than the 8 KB ceiling and has been cut — read the file itself for the rest.');
  }
  el('reader-when').textContent = parts.join(' ');

  const bodyEl = el('reader-body');
  bodyEl.replaceChildren(renderMarkdown(section.text, lastTerms));

  const idx = Number(section.id.split('#').pop());
  const prev = el('reader-prev');
  const next = el('reader-next');
  prev.disabled = !(idx > 0);
  next.disabled = !(idx + 1 < section.of_sections);
  prev.onclick = () => openSection(`${section.path}#${idx - 1}`);
  next.onclick = () => openSection(`${section.path}#${idx + 1}`);

  resultsEl.replaceChildren();
  emptyEl.hidden = true;
  searchmeta.hidden = true;
  seedsEl.hidden = true;
  reader.hidden = false;
  reader.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function backToResults() {
  reader.hidden = true;
  history.replaceState(null, '', location.pathname);
  if (lastResults.length > 0 && lastBody) {
    renderResults(lastBody);
  } else {
    seedsEl.hidden = false;
  }
  qInput.focus();
}

// ---------------------------------------------------------------------------
// The markdown subset
//
// ⚠️ WRITTEN, NOT BORROWED, and every node below is built with textContent.
// The corpus is our own writing, so this is not a defence against a hostile
// author — it is a defence against the ORDINARY case: a runbook containing
// `<script>` inside a code fence, or an angle bracket in a shell one-liner. An
// innerHTML renderer would either execute that or silently eat it, and the
// estate's docs are full of both shapes.
//
// The subset is chosen from what these docs actually use: ATX headings, fenced
// code, unordered and ordered lists, pipe tables, blockquotes, thematic
// breaks, and inline code / bold / italic / links. Anything else renders as
// the plain text it is, which is the correct failure: readable, never wrong.
// ---------------------------------------------------------------------------

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const ULI_RE = /^(\s*)[-*+]\s+(.*)$/;
const OLI_RE = /^(\s*)\d+[.)]\s+(.*)$/;
const HR_RE = /^\s*([-*_])\s*(\1\s*){2,}$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|[\s:|-]+\|\s*$/;

function renderMarkdown(text, terms) {
  const frag = document.createDocumentFragment();
  const lines = text.split('\n');
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length === 0) return;
    const p = document.createElement('p');
    p.append(inlineNodes(para.join(' ').trim(), terms));
    frag.append(p);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      flushPara();
      const fence = line.trim().slice(0, 3);
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // the closing fence
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      codeEl.textContent = code.join('\n');
      pre.append(codeEl);
      frag.append(pre);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      const level = heading[1].length;
      const tag = level <= 2 ? 'h2' : level === 3 ? 'h3' : 'h4';
      const h = document.createElement(tag);
      h.append(inlineNodes(heading[2], terms));
      frag.append(h);
      i += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      flushPara();
      frag.append(document.createElement('hr'));
      i += 1;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      flushPara();
      const rows = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rows.push(lines[i]);
        i += 1;
      }
      frag.append(renderTable(rows, terms));
      continue;
    }

    if (line.trim().startsWith('>')) {
      flushPara();
      const quoted = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      const bq = document.createElement('blockquote');
      bq.append(renderMarkdown(quoted.join('\n'), terms));
      frag.append(bq);
      continue;
    }

    if (ULI_RE.test(line) || OLI_RE.test(line)) {
      flushPara();
      const ordered = OLI_RE.test(line);
      const list = document.createElement(ordered ? 'ol' : 'ul');
      while (i < lines.length) {
        const m = ordered ? OLI_RE.exec(lines[i]) : ULI_RE.exec(lines[i]);
        if (!m) {
          // A continuation line (indented, not blank, not a new item) belongs
          // to the item above rather than starting a paragraph after the list.
          if (list.lastElementChild && lines[i].trim() && /^\s{2,}/.test(lines[i])) {
            list.lastElementChild.append(' ');
            list.lastElementChild.append(inlineNodes(lines[i].trim(), terms));
            i += 1;
            continue;
          }
          break;
        }
        const li = document.createElement('li');
        li.append(inlineNodes(m[2], terms));
        list.append(li);
        i += 1;
      }
      frag.append(list);
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      i += 1;
      continue;
    }

    para.push(line.trim());
    i += 1;
  }
  flushPara();
  return frag;
}

function splitRow(row) {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function renderTable(rows, terms) {
  const wrap = document.createElement('div');
  wrap.className = 'tablewrap';
  const table = document.createElement('table');
  const hasHeader = rows.length > 1 && TABLE_SEP_RE.test(rows[1]);

  let bodyStart = 0;
  if (hasHeader) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const cell of splitRow(rows[0])) {
      const th = document.createElement('th');
      th.append(inlineNodes(cell, terms));
      tr.append(th);
    }
    thead.append(tr);
    table.append(thead);
    bodyStart = 2;
  }

  const tbody = document.createElement('tbody');
  for (let r = bodyStart; r < rows.length; r += 1) {
    if (TABLE_SEP_RE.test(rows[r])) continue;
    const tr = document.createElement('tr');
    for (const cell of splitRow(rows[r])) {
      const td = document.createElement('td');
      td.append(inlineNodes(cell, terms));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

const INLINE_RE = /(`[^`]+`)|(\[[^\]\n]+\]\([^\s)]+\))|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;

/**
 * Inline markdown -> DOM nodes. Code spans are matched FIRST and never
 * descended into, so `**not bold**` inside backticks stays literal — which
 * matters here, because the estate's docs quote markdown at each other
 * constantly.
 */
function inlineNodes(str, terms) {
  const frag = document.createDocumentFragment();
  let last = 0;
  let m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(str)) !== null) {
    if (m.index > last) frag.append(markText(str.slice(last, m.index), terms));
    const tok = m[0];
    if (tok.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = tok.slice(1, -1);
      frag.append(code);
    } else if (tok.startsWith('[')) {
      const split = tok.indexOf('](');
      const label = tok.slice(1, split);
      const href = tok.slice(split + 2, -1);
      // ⚠️ Only http(s) and mailto become links. A `javascript:` or `data:`
      // href renders as plain text instead — the corpus is our own, but this
      // is one line and the alternative is a class of bug nobody would notice
      // until it mattered. Relative links (to other docs) are NOT resolvable
      // from this page, so they render as text too rather than 404ing.
      if (/^(https?:\/\/|mailto:)/i.test(href)) {
        const a = document.createElement('a');
        a.href = href;
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        a.append(markText(label, terms));
        frag.append(a);
      } else {
        frag.append(markText(label, terms));
      }
    } else if (tok.startsWith('**') || tok.startsWith('__')) {
      const strong = document.createElement('strong');
      strong.append(markText(tok.slice(2, -2), terms));
      frag.append(strong);
    } else {
      const em = document.createElement('em');
      em.append(markText(tok.slice(1, -1), terms));
      frag.append(em);
    }
    last = m.index + tok.length;
  }
  if (last < str.length) frag.append(markText(str.slice(last), terms));
  return frag;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function scheduleSearch() {
  const q = qInput.value.trim();
  searchbar.dataset.filled = q ? '1' : '0';
  clearTimeout(debounceTimer);

  if (q.length === 0) {
    if (inflight) inflight.abort();
    resultsEl.replaceChildren();
    emptyEl.hidden = true;
    searchmeta.hidden = true;
    reader.hidden = true;
    seedsEl.hidden = false;
    lastResults = [];
    return;
  }
  // One character is not a question — the Worker drops sub-2-character tokens
  // anyway, and firing on it would spend a request to be told nothing.
  if (q.length < 2) return;

  debounceTimer = setTimeout(() => runSearch(q), DEBOUNCE_MS);
}

function renderSeeds() {
  seedsEl.replaceChildren();
  const label = document.createElement('li');
  label.textContent = 'Try:';
  label.style.color = 'var(--et-muted)';
  label.style.alignSelf = 'center';
  label.style.fontSize = 'var(--et-text-small)';
  seedsEl.append(label);
  for (const seed of SEEDS) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = seed;
    b.addEventListener('click', () => {
      qInput.value = seed;
      scheduleSearch();
      qInput.focus();
    });
    li.append(b);
    seedsEl.append(li);
  }
}

qInput.addEventListener('input', scheduleSearch);
clearBtn.addEventListener('click', () => {
  qInput.value = '';
  scheduleSearch();
  qInput.focus();
});
el('reader-back').addEventListener('click', backToResults);

qInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && lastResults.length > 0 && reader.hidden) {
    e.preventDefault();
    openSection(lastResults[0].id);
  }
});

document.addEventListener('keydown', (e) => {
  // `/` focuses the search from anywhere — the one keystroke a search page owes
  // a keyboard reader. Ignored while typing, so it never eats a literal slash.
  if (e.key === '/' && document.activeElement !== qInput && !searchwrap.hidden) {
    e.preventDefault();
    qInput.focus();
    qInput.select();
  }
  if (e.key === 'Escape' && !reader.hidden) backToResults();
});

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setGate(r.error, 'outage');
});

/**
 * Neutral boot + 8s backstop, ported verbatim from /todo and /runbooks: the
 * flash-of-sign-in bug was found live, and the fix is never to render an
 * "authenticated" or "signed out" conclusion before the SDK has spoken.
 */
const authBackstop = setTimeout(() => {
  if (!authResolved) {
    authResolved = true;
    renderAuthState();
  }
}, 8000);

watchAuth((user) => {
  authResolved = true;
  clearTimeout(authBackstop);
  currentUser = user;
  renderAuthState();
  if (!user) return;

  searchwrap.hidden = false;
  renderSeeds();
  seedsEl.hidden = false;
  hideGate();

  // A deep link (#<section id>) opens straight into the reader; otherwise the
  // box takes focus, because this page has exactly one thing to do.
  // A section id always carries a '#<n>' suffix INSIDE it, which survives the
  // decode as a literal '#'. That is the whole test — a bare '#anything-else'
  // is not one of ours and is ignored rather than fetched.
  const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (/#\d+$/.test(hash)) {
    openSection(hash);
  } else {
    qInput.focus();
  }
});

renderAuthState();

handleRedirectResult().then((err) => {
  if (err) setGate(err, 'outage');
});
