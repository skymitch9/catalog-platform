/**
 * apex-catalog-cards.test.mjs — the front door's catalogue cells, driven
 * through the REAL module against a stub DOM shaped like `public/index.html`.
 *
 * Owner ask 2026-09-05: *"the libraries are designated by who owns the physical
 * or shared with digital works."* Survey findings F5 (`!Sky`), F3 (the games
 * shelf designated nobody's) and §8 Q2 (a `library3` on the front door).
 *
 * ## 🔴 The five things this file exists to prove
 *
 * 1. **`!Sky` cannot come back.** Not in the markup (there is a second,
 *    independent assertion for that below, which reads the real index.html)
 *    and not on screen: the link text is the registry's label, and the module
 *    rewrites it whether or not the hand-written words happen to be right.
 * 2. **The fallback never stands in for a live answer.** On success EVERY
 *    catalogue cell is rewritten; a stale hand-typed label cannot survive a
 *    successful fetch, which is exactly how `!Sky` lived for weeks.
 * 3. **On failure the static words STAY and the page SAYS SO** — in a
 *    sentence, naming an outage rather than a permissions problem, with no
 *    status code anywhere near a person.
 * 4. **Counts are a member's, in scope, and absent is not zero.** A signed-out
 *    reader gets names and no numbers; a member gets numbers only where the
 *    registry gave one, and a catalog with no `rows` key draws nothing rather
 *    than "0 items".
 * 5. **A catalog the page has never heard of gets a cell** — the `library3`
 *    case — and a cell the registry has never heard of is LEFT ALONE rather
 *    than blanked.
 *
 * ⚠️ WHAT A GREEN RUN DOES NOT SAY: no layout, no CSS, no browser. Nobody has
 * seen this signed in — `predeploy.checks.json` fetches `/` unauthenticated, so
 * the count half of the design is proven here and only here.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { StubNode, installStubFetch } from './helpers/stub-dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public', 'assets');
const MODULE = pathToFileURL(resolve(ASSETS, 'apex-catalog-cards.js')).href;
const INDEX_HTML = resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public', 'index.html');

/** The five catalogs as the live route served them, 2026-09-05 23:58 UTC. */
const FIVE = [
  { id: 'audiobook', push_source: 'audiobook', kind: 'audio', label: 'Shared audiobooks', owner: null, holding: 'digital', shared: true, host: 'audiobooks.heygabi.ai' },
  { id: 'library', push_source: 'library', kind: 'books', label: "Skylar's library", owner: 'Skylar', holding: 'physical', shared: false, host: 'library.heygabi.ai' },
  { id: 'games', push_source: 'game', kind: 'games', label: "Skylar's board games", owner: 'Skylar', holding: 'physical', shared: false, host: 'boardgames.heygabi.ai' },
  { id: 'library2', push_source: 'library2', kind: 'books', label: "Samantha's library", owner: 'Samantha', holding: 'physical', shared: false, host: 'padhard.heygabi.ai' },
  { id: 'ebooks', push_source: null, kind: 'books', label: 'Shared ebooks', owner: null, holding: 'digital', shared: true, host: 'ebooks.heygabi.ai' },
];

const body = (catalogs = FIVE, over = {}) => ({
  ok: true, catalogs, counts: 'none', fetched_at: '2026-09-05T23:58:38.376Z', stale: false, ...over,
});

/* ------------------------------------------------------------------ *
 * A document shaped like index.html's catalogue section
 * ------------------------------------------------------------------ */

function card(li, { links = [], holds = null, host = null } = {}) {
  const div = new StubNode('div');
  div.className = 'card';
  const name = new StubNode('span');
  name.className = 'name';
  div.appendChild(name);
  if (holds !== null) {
    const p = new StubNode('p');
    p.className = 'holds';
    p.textContent = holds;
    div.appendChild(p);
  }
  for (const [href, id, text] of links) {
    const a = new StubNode('a');
    a.setAttribute('href', href);
    a.setAttribute('data-catalog-id', id);
    a.textContent = text;
    const sr = new StubNode('span');
    sr.className = 'sr-only';
    sr.textContent = ' (opens in a new tab)';
    a.appendChild(sr);
    div.appendChild(a);
  }
  if (host) {
    const p = new StubNode('p');
    p.className = 'host';
    p.textContent = host;
    div.appendChild(p);
  }
  li.appendChild(div);
  return li;
}

/** The five cells `public/index.html` ships, in its own order. */
function installDom() {
  const root = new StubNode('body');
  const list = new StubNode('ul');
  list.id = 'catalogue-cards';
  root.appendChild(list);

  const cells = new Map();
  const add = (ids, opts) => {
    const li = new StubNode('li');
    li.setAttribute('data-catalog-card', ids);
    card(li, opts);
    list.appendChild(li);
    cells.set(ids, li);
    return li;
  };

  add('audiobook', { holds: 'Shared across the estate · digital', host: 'audiobooks.heygabi.ai' });
  add('ebooks', { holds: 'Shared across the estate · digital', host: 'ebooks.heygabi.ai' });
  add('library library2', {
    holds: 'Skylar’s and Samantha’s · physical copies',
    links: [
      ['https://library.heygabi.ai', 'library', 'Skylar’s library'],
      ['https://padhard.heygabi.ai', 'library2', 'Samantha’s library'],
    ],
  });
  add('games', { holds: 'Skylar’s · physical copies', host: 'boardgames.heygabi.ai' });

  const admin = new StubNode('li');
  admin.id = 'admin-card-li';
  list.appendChild(admin);

  const notice = new StubNode('p');
  notice.id = 'cat-notice';
  notice.hidden = true;
  root.appendChild(notice);

  const search = new StubNode('estate-search');
  search.id = 'find-search';

  const byId = { 'catalogue-cards': list, 'cat-notice': notice, 'admin-card-li': admin, 'find-search': search };
  const document = {
    body: root,
    createElement: (tag) => new StubNode(tag),
    createElementNS: (_ns, tag) => new StubNode(tag),
    getElementById: (id) => byId[id] || null,
    querySelectorAll: (sel) => root.querySelectorAll(sel),
    querySelector: (sel) => root.querySelector(sel),
  };

  const prev = { document: globalThis.document, had: 'document' in globalThis };
  globalThis.document = document;

  return {
    document, root, list, notice, search, cells, admin,
    holdsOf: (ids) => cells.get(ids).querySelector('.holds').textContent,
    linkTexts: () => root.querySelectorAll('a[data-catalog-id]').map((a) => a.textContent),
    restore() {
      if (prev.had) globalThis.document = prev.document;
      else delete globalThis.document;
    },
  };
}

let caseNo = 0;

/**
 * ⚠️ THE REGISTRY MODULE IS NOT RE-IMPORTED PER CASE, AND MUST BE RESET.
 * `?case=` gives each scenario its own copy of apex-catalog-cards.js, but the
 * `./catalog-registry.js` it imports resolves to one URL and therefore one
 * instance — memo and all. Without this reset the first scenario's healthy
 * answer is served to every later one, which makes the three outage cases pass
 * while proving nothing. (Found exactly that way.)
 */
const registry = await import(pathToFileURL(resolve(ASSETS, 'catalog-registry.js')).href);

/** Stand the module up in a fresh world; `?case=` defeats the ESM URL cache. */
async function boot(routes) {
  const dom = installDom();
  const fetches = installStubFetch(routes);
  registry.__resetRegistry();
  caseNo += 1;
  const mod = await import(`${MODULE}?case=${caseNo}`);
  // Let the un-awaited boot fetch settle.
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
  return { dom, fetches, mod, done: () => { fetches.restore(); dom.restore(); } };
}

const OK = { 'GET /api/catalogs': { status: 200, body: body() } };

/* ------------------------------------------------------------------ *
 * The tests
 * ------------------------------------------------------------------ */

describe('the front door reads the registry', () => {
  it('🔴 names both households from the registry — "!Sky" is not a thing a label can be', async () => {
    const t = await boot(OK);
    try {
      const texts = t.dom.linkTexts();
      assert.ok(texts.some((x) => x.startsWith("Skylar's library")), texts.join(' | '));
      assert.ok(texts.some((x) => x.startsWith("Samantha's library")), texts.join(' | '));
      assert.ok(!texts.join(' ').includes('!Sky'));
    } finally {
      t.done();
    }
  });

  it('🔴 rewrites a WRONG hand-typed label — the fallback never stands in for a live answer', async () => {
    const t = await boot(OK);
    try {
      // The cell shipped with "Skylar’s library" (curly). The registry says
      // "Skylar's library" (straight). The rendered text must be the
      // registry's, character for character — if the module skipped a cell
      // whose words "looked right" this would pass with the markup's copy.
      const a = t.dom.cells.get('library library2').querySelectorAll('a[data-catalog-id]')[0];
      assert.ok(a.textContent.startsWith("Skylar's library"), a.textContent);
      assert.ok(!a.textContent.startsWith('Skylar’s library'), 'this is the markup’s spelling, not the registry’s');
    } finally {
      t.done();
    }
  });

  it('keeps each link’s new-tab announcement when it renames it', async () => {
    const t = await boot(OK);
    try {
      for (const a of t.dom.root.querySelectorAll('a[data-catalog-id]')) {
        assert.equal(a.querySelectorAll('.sr-only').length, 1, 'the sr-only span is the keyboard/screen-reader contract');
        assert.ok(a.textContent.includes('opens in a new tab'));
      }
    } finally {
      t.done();
    }
  });

  it('designates every shelf: whose it is for physical, "shared" for digital', async () => {
    const t = await boot(OK);
    try {
      assert.equal(t.dom.holdsOf('audiobook'), 'Shared across the estate · digital');
      assert.equal(t.dom.holdsOf('ebooks'), 'Shared across the estate · digital');
      assert.equal(t.dom.holdsOf('games'), 'Skylar’s · physical copies');
      assert.equal(t.dom.holdsOf('library library2'), 'Skylar’s and Samantha’s · physical copies');
    } finally {
      t.done();
    }
  });

  it('asks anonymously and shows NO counts — names only, before anybody signs in', async () => {
    const t = await boot(OK);
    try {
      assert.equal(t.fetches.calls.length, 1);
      assert.equal(t.fetches.calls[0].init, undefined, 'no bearer on the signed-out read');
      for (const ids of ['audiobook', 'ebooks', 'games', 'library library2']) {
        assert.ok(!/\d/.test(t.dom.holdsOf(ids)), `${ids} showed a number to a signed-out reader: ${t.dom.holdsOf(ids)}`);
      }
      assert.equal(t.dom.notice.hidden, true, 'a healthy read draws no notice');
    } finally {
      t.done();
    }
  });
});

describe('counts — a member’s, in scope, and absent is never zero', () => {
  it('shows a count only where the registry gave one', async () => {
    const scoped = [
      { ...FIVE[0], rows: 1251, pushed_at: '2026-09-05T00:00:00Z' },
      { ...FIVE[1], rows: 497, pushed_at: '2026-09-05T00:00:00Z' },
      { ...FIVE[2], rows: 838, pushed_at: '2026-09-05T00:00:00Z' },
      { ...FIVE[3] }, // no vis_library2 grant: NO rows key at all
      { ...FIVE[4] }, // ebooks never carries a count, even with the grant
    ];
    const t = await boot({
      'GET /api/catalogs': ({ init }) =>
        init && init.headers ? { status: 200, body: body(scoped, { counts: 'scoped' }) } : { status: 200, body: body() },
    });
    try {
      t.dom.search.authAdapter = { idToken: async () => 'tok' };
      await t.dom.search.dispatch('estate-search:auth', { detail: { user: { uid: 'u1' } } });
      for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));

      assert.equal(t.dom.holdsOf('audiobook'), 'Shared across the estate · digital · 1,251 items');
      assert.equal(t.dom.holdsOf('games'), 'Skylar’s · physical copies · 838 items');
      assert.equal(t.dom.holdsOf('library library2'), 'Skylar’s (497) and Samantha’s · physical copies');
      assert.equal(t.dom.holdsOf('ebooks'), 'Shared across the estate · digital',
        'ebooks rows ride the audiobook source — printing that total would say the ebook shelf holds every audiobook');
      assert.ok(!t.dom.holdsOf('ebooks').includes('0 '), 'an absent count is not zero');
      assert.equal(t.fetches.calls[1].init.headers.Authorization, 'Bearer tok');
    } finally {
      t.done();
    }
  });

  it('does not re-read on every auth announcement — one token, one read', async () => {
    const t = await boot(OK);
    try {
      t.dom.search.authAdapter = { idToken: async () => 'tok' };
      for (let n = 0; n < 3; n += 1) {
        await t.dom.search.dispatch('estate-search:auth', { detail: { user: { uid: 'u1' } } });
        for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
      }
      assert.equal(t.fetches.calls.length, 2, 'one anonymous boot read plus one member read');
    } finally {
      t.done();
    }
  });

  it('a signed-out announcement changes nothing', async () => {
    const t = await boot(OK);
    try {
      await t.dom.search.dispatch('estate-search:auth', { detail: { user: null } });
      for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
      assert.equal(t.fetches.calls.length, 1);
    } finally {
      t.done();
    }
  });
});

describe('when the index cannot be reached', () => {
  const failures = {
    'the fetch throws': { 'GET /api/catalogs': () => { throw new Error('offline'); } },
    'the Worker answers 503': { 'GET /api/catalogs': { status: 503, body: { error: 'registry_unavailable' } } },
    'the body is a shape we do not understand': { 'GET /api/catalogs': { status: 200, body: { nope: true } } },
  };

  for (const [name, routes] of Object.entries(failures)) {
    it(`🔴 ${name}: the static words stay, and the page says so in words`, async () => {
      const t = await boot(routes);
      try {
        assert.equal(t.dom.notice.hidden, false, 'a silent failure is the whole bug this replaces');
        const said = t.dom.notice.textContent;
        assert.ok(said.includes('outage'), said);
        assert.ok(said.includes('not a permissions problem'), said);
        assert.ok(said.includes('may be out of date'), said);
        assert.ok(!/\b\d{3}\b/.test(said), `a person must never see a bare status: ${said}`);
        // The hand-written fallback is untouched — and still correct.
        assert.equal(t.dom.holdsOf('games'), 'Skylar’s · physical copies');
        assert.ok(!t.dom.linkTexts().join(' ').includes('!Sky'));
      } finally {
        t.done();
      }
    });
  }
});

describe('a catalog the page has never heard of', () => {
  it('🔴 gets a cell of its own — a library3 reaches the front door with no edit', async () => {
    const library3 = { id: 'library3', push_source: 'library3', kind: 'books', label: "Justin's library", owner: 'Justin', holding: 'physical', shared: false, host: 'l3.heygabi.ai' };
    const t = await boot({ 'GET /api/catalogs': { status: 200, body: body([...FIVE, library3]) } });
    try {
      const added = t.dom.list.children.find((li) => li.getAttribute('data-catalog-card') === 'library3');
      assert.ok(added, 'no cell was appended for the new catalog');
      assert.ok(added.textContent.includes("Justin's library"));
      assert.ok(added.textContent.includes('Justin’s · physical copies'));
      assert.ok(added.textContent.includes('l3.heygabi.ai'));
      assert.equal(added.querySelector('.card').getAttribute('href'), 'https://l3.heygabi.ai');
      const idx = t.dom.list.children.indexOf(added);
      assert.ok(idx < t.dom.list.children.indexOf(t.dom.admin), 'a catalogue cell belongs before the Admin cell');
    } finally {
      t.done();
    }
  });

  it('leaves a cell the registry does not know EXACTLY as it is', async () => {
    // The registry has dropped `games` (a partially-deployed estate, or a
    // mistake). Blanking the cell would say "this shelf does not exist",
    // which is a much bigger claim than "the registry has not caught up".
    const t = await boot({ 'GET /api/catalogs': { status: 200, body: body(FIVE.filter((c) => c.id !== 'games')) } });
    try {
      assert.equal(t.dom.holdsOf('games'), 'Skylar’s · physical copies');
      assert.equal(t.dom.list.children.filter((li) => li.getAttribute('data-catalog-card') === 'games').length, 1);
    } finally {
      t.done();
    }
  });
});

describe('the markup itself', () => {
  const html = readFileSync(INDEX_HTML, 'utf8');
  /** ⚠️ Comments are stripped first, ON PURPOSE. The cell's own comment quotes
   *  `!Sky` and the old "Paper-and-ebook shelves" sentence verbatim, because
   *  the record of what was wrong is the most useful thing on that line — and
   *  a regression check that forbade writing the bug DOWN would have deleted
   *  it. What must not come back is the rendered text. */
  const shipped = html.replace(/<!--[\s\S]*?-->/g, '');

  it('🔴 "!Sky" is gone from the front door and cannot be typed back in unnoticed', () => {
    assert.ok(!shipped.includes('!Sky'), 'index.html still renders !Sky');
    assert.ok(html.includes('!Sky'), 'the comment recording what F5 was should stay — this is the one place it is written down on the page');
  });

  it('every catalogue cell declares the catalog(s) it stands for', () => {
    for (const ids of ['"audiobook"', '"ebooks"', '"games"', '"library library2"']) {
      assert.ok(shipped.includes(`data-catalog-card=${ids}`), `no cell declares data-catalog-card=${ids}`);
    }
  });

  it('the fallback words state an ownership, never a shelf that holds ebooks', () => {
    assert.ok(shipped.includes('Skylar’s · physical copies'), 'the games cell must designate its owner');
    assert.ok(shipped.includes('Skylar’s and Samantha’s · physical copies'));
    assert.ok(!shipped.includes('Paper-and-ebook shelves'), 'ebooks are the shared pool with their own card — F5');
  });

  it('the heading carries no shelf count to go stale', () => {
    assert.ok(!shipped.includes('One question, three shelves'));
    assert.ok(shipped.includes('One question, every shelf'));
  });
});
