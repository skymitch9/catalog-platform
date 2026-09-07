/**
 * apex-catalog-cards.js — the front door's catalogue cards, named and
 * DESIGNATED from the estate registry.
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58: *"Make sure everything
 * we have that's in the estate connects to multiple libraries and make sure
 * that the libraries are designated by who owns the physical or shared with
 * digital works."* This is that rule on the estate's most-read surface.
 *
 * ## What it does
 *
 * On load it reads `GET https://index.heygabi.ai/api/catalogs`
 * (assets/catalog-registry.js) and, for every `<li data-catalog-card="…">`:
 *
 *   - rewrites each `a[data-catalog-id]`'s visible text to that catalog's
 *     registry label — 🔴 this is the line that read **`!Sky`** on the live
 *     front door until today (survey F5);
 *   - writes the card's `.holds` line: *"Skylar's · physical copies"*,
 *     *"Shared across the estate · digital"*, *"Skylar's and Samantha's ·
 *     physical copies"* — the designation itself;
 *   - appends a ROW COUNT to that line, but only for a signed-in member and
 *     only for the catalogs their own grants admit, because that is all the
 *     registry will tell us (owner decision 16:14, *"yes name only"*).
 *
 * A catalog in the registry that has no cell on the page gets one appended, so
 * a `library3` provisioned tomorrow reaches the front door with no edit here.
 *
 * ## 🔴 The fallback rule, which is the whole reason this file is careful
 *
 * The hand-written words in `index.html` are the fallback for an UNREACHABLE
 * index and nothing else. When the fetch SUCCEEDS every catalog cell is
 * rewritten, so a stale hand-typed label cannot quietly stand in for a live
 * answer that arrived — that is precisely how `!Sky` and the seven disagreeing
 * label maps survived for weeks. When the fetch FAILS the static words stay
 * AND `#cat-notice` says so in a sentence: that the shelves are named from
 * this page's own copy, that it is an outage on our side, and that it is not a
 * permissions problem. ⚠️ A person never sees the status code, and an outage
 * is never dressed as a refusal — mislabelling one sends people asking for
 * access they already have.
 *
 * ## Where the sign-in comes from
 *
 * The same seam apex-admin-link.js, apex-request-catalog.js and apex-notices.js
 * use: `<estate-search>`'s `estate-search:auth` event plus its `authAdapter`.
 * No second Firebase loader, no second sign-in. ⚠️ Unlike those three this
 * module renders for a SIGNED-OUT reader too — names need no sign-in — so it
 * runs once immediately and again if and when a session resolves.
 */

import {
  REGISTRY_DOWN_NOTICE,
  catalogById,
  designation,
  joinWords,
  loadCatalogs,
} from './catalog-registry.js';

const notice = document.getElementById('cat-notice');
const list = document.getElementById('catalogue-cards');

/**
 * A count, when the registry gave us one for this catalog.
 *
 * ⚠️ ABSENT IS NOT ZERO. `rows` is missing — not null, not 0 — when the caller
 * holds no grant, and `ebooks` never carries one even for a member who does,
 * because its rows ride the audiobook source and printing that total would say
 * the shared ebook shelf holds every audiobook in the house. So an absent key
 * draws nothing at all rather than "0 items".
 */
function countOf(cat) {
  return cat && typeof cat.rows === 'number' ? cat.rows : null;
}

/** "497 items" / "1 item". */
function items(n) {
  return `${n.toLocaleString()} ${n === 1 ? 'item' : 'items'}`;
}

/**
 * One card's designation line, for one catalog or for several.
 *
 * The multi-catalog form is what the Books cell needs — two households on one
 * card — and it is written generically so a third household joins the sentence
 * rather than needing a new branch.
 */
export function holdsLine(cats) {
  if (cats.length === 0) return '';
  if (cats.length === 1) {
    const n = countOf(cats[0]);
    return designation(cats[0]) + (n === null ? '' : ` · ${items(n)}`);
  }
  const who = joinWords(
    cats.map((c) => {
      const base = c.shared ? 'Shared' : c.owner ? `${c.owner}’s` : 'holder not recorded';
      const n = countOf(c);
      return n === null ? base : `${base} (${n.toLocaleString()})`;
    }),
  );
  const holding = cats.every((c) => c.holding === 'physical')
    ? 'physical copies'
    : cats.every((c) => c.holding === 'digital')
      ? 'digital'
      : 'mixed holdings';
  return `${who} · ${holding}`;
}

/**
 * Replace a link's visible words while KEEPING its `.sr-only` new-tab
 * announcement.
 *
 * ⚠️ `textContent = label` would delete that span, and the card's whole
 * keyboard/screen-reader contract with it — every one of these links opens a
 * new tab and says so. The visible text is the element's own text node; the
 * span is a child. So: drop the text nodes, keep the children, prepend.
 */
function renameLink(a, label) {
  const keep = Array.from(a.children);
  a.textContent = label;
  for (const child of keep) a.appendChild(child);
}

/** The `.holds` paragraph of a card, created if the markup has none. */
function holdsEl(li) {
  const found = li.querySelectorAll('.holds')[0];
  if (found) return found;
  const card = li.querySelectorAll('.card')[0] || li;
  const p = document.createElement('p');
  p.className = 'holds';
  const host = card.querySelectorAll('.host')[0];
  if (host && card.insertBefore) card.insertBefore(p, host);
  else card.appendChild(p);
  return p;
}

/**
 * A cell for a catalog the page has never heard of — a `library3`, the day
 * after somebody provisions one.
 *
 * ⚠️ Deliberately plain: it carries no hue of its own and a neutral glyph,
 * because the alternative is guessing a house colour for somebody else's shelf.
 * It says what the registry knows and nothing more.
 */
function newCard(cat) {
  const li = document.createElement('li');
  li.setAttribute('data-catalog-card', cat.id);

  const a = document.createElement('a');
  a.className = 'card';
  a.setAttribute('href', `https://${cat.host}`);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener');

  const glyph = document.createElement('span');
  glyph.className = 'glyph';
  glyph.setAttribute('aria-hidden', 'true');
  a.appendChild(glyph);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = cat.label;
  a.appendChild(name);

  // ⚠️ NO p.what ON A REGISTRY CARD — grey-paragraph audit item 220, cut
  // 2026-09-07. It announced that the card had been written from the estate's
  // own catalog registry, which described the MECHANISM that produced the card
  // rather than the catalog the card points at. The five
  // hand-written cards' taglines went the same day (item 179); only the Admin
  // card keeps one, because it states a gate. A new card should look like the
  // others, so do not reintroduce this line here either.

  const holds = document.createElement('p');
  holds.className = 'holds';
  holds.textContent = holdsLine([cat]);
  a.appendChild(holds);

  const host = document.createElement('p');
  host.className = 'host';
  host.textContent = cat.host;
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = ' (opens in a new tab)';
  host.appendChild(sr);
  a.appendChild(host);

  li.appendChild(a);
  return li;
}

/** Every catalogue cell on the page, by the ids it declares. */
function cells() {
  const out = [];
  for (const li of document.querySelectorAll('[data-catalog-card]')) {
    const raw = li.getAttribute('data-catalog-card') || '';
    out.push({ li, ids: raw.split(/\s+/).filter(Boolean) });
  }
  return out;
}

/** Draw the registry onto the page. Exported so a test can drive it directly. */
export function render(catalogs) {
  const claimed = new Set();
  for (const { li, ids } of cells()) {
    const cats = ids.map((id) => catalogById(catalogs, id)).filter(Boolean);
    // ⚠️ A cell whose ids the registry does not know is LEFT EXACTLY AS IT IS.
    // Blanking it would turn "the registry has not caught up" into "this shelf
    // does not exist", and the second is a much bigger claim than we have.
    if (cats.length === 0) continue;
    for (const id of ids) claimed.add(id);

    for (const a of li.querySelectorAll('a[data-catalog-id]')) {
      const cat = catalogById(catalogs, a.getAttribute('data-catalog-id'));
      if (cat) renameLink(a, cat.label);
    }
    holdsEl(li).textContent = holdsLine(cats);
  }

  // Anything the registry names that the page does not show yet.
  if (!list) return;
  const adminCell = document.getElementById('admin-card-li');
  for (const cat of catalogs) {
    if (claimed.has(cat.id)) continue;
    const li = newCard(cat);
    if (adminCell && list.insertBefore) list.insertBefore(li, adminCell);
    else list.appendChild(li);
  }
}

/** Say, in one sentence, that the words on screen are this page's own copy. */
function sayUnreachable() {
  if (!notice) return;
  notice.textContent = REGISTRY_DOWN_NOTICE;
  notice.hidden = false;
}

let lastToken = null;

/** One pass: read the registry (with a bearer if we have one) and draw it. */
export async function refresh(token = null) {
  const r = await loadCatalogs(token ? { token } : {});
  if (!r.ok) {
    sayUnreachable();
    return r;
  }
  if (notice) notice.hidden = true;
  render(r.catalogs);
  return r;
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

if (list) {
  // Names first, for everybody, before any sign-in resolves.
  refresh();

  const search = document.getElementById('find-search');
  if (search) {
    search.addEventListener('estate-search:auth', async (e) => {
      const user = e && e.detail ? e.detail.user : null;
      if (!user) return;
      let token = null;
      try {
        token = search.authAdapter ? await search.authAdapter.idToken() : null;
      } catch {
        token = null;
      }
      // ⚠️ One re-read per session, not one per auth event: the component
      // re-announces on every token refresh and the counts do not change
      // between them.
      if (!token || token === lastToken) return;
      lastToken = token;
      await refresh(token);
    });
  }
}
