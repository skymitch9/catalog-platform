/**
 * estate-search-registry.test.mjs — the shared search component's words, driven
 * through the REAL custom-element class.
 *
 * 🔴 THE LINE THIS FILE EXISTS FOR:
 *
 *     const FULL_SCOPE_SIZE = 3;   // assets/estate-search.js, until 2026-09-05
 *
 * The estate has FIVE catalogs and the default grant from migration 0002 is
 * exactly THREE (`vis_library2` and `vis_ebooks` are `DEFAULT 0`). So
 * `scope.length >= FULL_SCOPE_SIZE` was true for every ordinary member, and
 * this component told all of them their search covered **"on any shelf"** while
 * two shelves were never consulted — and suppressed `_scopeNote()`, the one
 * sentence written to say otherwise. The survey called it the single worst line
 * in the estate: a confident false statement about whose shelves were searched,
 * on the front door, in both places a person would look.
 *
 * ## How this drives a web component with no browser
 *
 * The module ends in `customElements.define('estate-search', EstateSearch)`, so
 * a stub `customElements` CAPTURES the class on import and the test constructs
 * a real instance. That is why these are assertions about the shipped code and
 * not about a copy of its logic. ⚠️ It also means the whole module must import
 * cleanly in Node — which is itself worth a test, because this file is synced
 * verbatim into two other repos.
 *
 * ⚠️ WHAT A GREEN RUN DOES NOT SAY: no shadow DOM, no layout, no fetch, no
 * keystrokes. This is the vocabulary and the scope arithmetic; whether a person
 * SEES the right sentence is `verify:home` and an eyeball.
 */

import { strict as assert } from 'node:assert';
import { describe, it, before } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { StubNode } from './helpers/stub-dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public', 'assets');
const SEARCH_JS = resolve(ASSETS, 'estate-search.js');
const REGISTRY_JS = resolve(ASSETS, 'catalog-registry.js');

/** The five catalogs as the live route served them, 2026-09-05 23:58 UTC. */
const FIVE = [
  { id: 'audiobook', push_source: 'audiobook', kind: 'audio', label: 'Shared audiobooks', owner: null, holding: 'digital', shared: true, host: 'audiobooks.heygabi.ai' },
  { id: 'library', push_source: 'library', kind: 'books', label: "Skylar's library", owner: 'Skylar', holding: 'physical', shared: false, host: 'library.heygabi.ai' },
  { id: 'games', push_source: 'game', kind: 'games', label: "Skylar's board games", owner: 'Skylar', holding: 'physical', shared: false, host: 'boardgames.heygabi.ai' },
  { id: 'library2', push_source: 'library2', kind: 'books', label: "Samantha's library", owner: 'Samantha', holding: 'physical', shared: false, host: 'padhard.heygabi.ai' },
  { id: 'ebooks', push_source: null, kind: 'books', label: 'Shared ebooks', owner: null, holding: 'digital', shared: true, host: 'ebooks.heygabi.ai' },
];

/** The three-catalog grant migration 0002 hands every ordinary member. */
const DEFAULT_GRANT = ['audiobook', 'library', 'games'];

let Element = null;

before(async () => {
  globalThis.document = {
    createElement: (tag) => {
      const n = new StubNode(tag);
      if (String(tag).toLowerCase() === 'template') n.content = { cloneNode: () => new StubNode('fragment') };
      return n;
    },
    createElementNS: (_ns, tag) => new StubNode(tag),
  };
  globalThis.HTMLElement = class {
    constructor() {
      this.attributes = {};
      this.shadowRoot = null;
    }
    attachShadow() {
      this.shadowRoot = new StubNode('shadow-root');
      return this.shadowRoot;
    }
    setAttribute(n, v) { this.attributes[n] = String(v); }
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n) ? this.attributes[n] : null; }
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attributes, n); }
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
  };
  globalThis.customElements = {
    get: () => null,
    define: (_name, cls) => { Element = cls; },
  };
  await import(pathToFileURL(SEARCH_JS).href);
});

/** A component instance with the registry already resolved to `catalogs`. */
function withRegistry(catalogs) {
  const el = new Element();
  el._registry = catalogs;
  el._registryReady = Promise.resolve(catalogs);
  return el;
}

describe('the module still imports, which two other repos depend on', () => {
  it('defines <estate-search> exactly once', () => {
    assert.ok(typeof Element === 'function', 'customElements.define was never reached');
  });
});

describe('🔴 "on any shelf" — the claim FULL_SCOPE_SIZE made falsely', () => {
  it('the DEFAULT three-catalog grant is NOT every shelf', () => {
    const el = withRegistry(FIVE);
    assert.equal(el._scopeIsEverything(DEFAULT_GRANT), false);
  });

  it('is a SET comparison — three of the WRONG three is still not everything', () => {
    const el = withRegistry(FIVE);
    assert.equal(el._scopeIsEverything(['audiobook', 'library2', 'ebooks']), false);
  });

  it('says yes only when every catalog the registry names is in scope', () => {
    const el = withRegistry(FIVE);
    assert.equal(el._scopeIsEverything(FIVE.map((c) => c.id)), true);
  });

  it('says NO when the registry could not be read — an unverifiable scope is not vouched for', () => {
    assert.equal(withRegistry([])._scopeIsEverything(FIVE.map((c) => c.id)), false);
  });

  it('a sixth catalog makes the old five stop being everything, with no code change', () => {
    const six = [...FIVE, { id: 'library3', push_source: 'library3', kind: 'books', label: "Justin's library", owner: 'Justin', holding: 'physical', shared: false, host: 'l3.heygabi.ai' }];
    assert.equal(withRegistry(six)._scopeIsEverything(FIVE.map((c) => c.id)), false);
  });
});

describe('🔴 the scope note — the sentence the same constant suppressed', () => {
  it('IS drawn for the default grant, and names the shelves actually searched', () => {
    const el = withRegistry(FIVE);
    const p = el._scopeNote(DEFAULT_GRANT);
    assert.ok(p, 'a 3-of-5 member was told nothing at all before today');
    assert.equal(
      p.textContent,
      "Searching Shared audiobooks, Skylar's library and Skylar's board games only. Sign in to search every shelf.",
    );
  });

  it('is NOT drawn when the scope really is every shelf', () => {
    const el = withRegistry(FIVE);
    assert.equal(el._scopeNote(FIVE.map((c) => c.id)), null);
  });

  it('drops the sign-in invitation once somebody is signed in', () => {
    const el = withRegistry(FIVE);
    el._currentUser = { uid: 'u1' };
    assert.ok(!el._scopeNote(DEFAULT_GRANT).textContent.includes('Sign in'));
  });

  it('names an unknown shelf in WORDS — never the database id', () => {
    const el = withRegistry(FIVE);
    const said = el._scopeNote(['library', 'library7']).textContent;
    assert.ok(!said.includes('library7'), said);
    assert.ok(said.includes('a shelf we cannot name'), said);
  });
});

describe('🔴 the hit line — whose shelf, then what format', () => {
  it('names each shelf from the registry, and drops an implied format', () => {
    const el = withRegistry(FIVE);
    const line = (source, format) => {
      const suffix = el._formatSuffix(source, format);
      return suffix ? `${el._sourceLabel(source, format)} · ${suffix}` : el._sourceLabel(source, format);
    };
    assert.equal(line('library', 'hardcover'), "Skylar's library · hardcover");
    assert.equal(line('library2', 'paperback'), "Samantha's library · paperback");
    assert.equal(line('game', 'boardgame'), "Skylar's board games");
    assert.equal(line('game', 'expansion'), "Skylar's board games · expansion");
    assert.equal(line('audiobook', 'audiobook'), 'Shared audiobooks');
  });

  it('an ebook is the SHARED pool’s, never a person’s physical shelf', () => {
    const el = withRegistry(FIVE);
    assert.equal(el._sourceLabel('audiobook', 'ebook'), 'Shared ebooks');
    assert.equal(el._formatSuffix('audiobook', 'ebook'), '', 'the shelf’s own name already says "ebooks"');
    // …but a physical shelf's own ebook stays that shelf's, because it would be.
    assert.equal(el._sourceLabel('library', 'ebook'), "Skylar's library");
  });

  it('degrades an unknown source to WORDS — "library2" in an English sentence was the bug', () => {
    const el = withRegistry(FIVE);
    assert.equal(el._sourceLabel('library9', 'hardcover'), 'a shelf we cannot name');
    assert.equal(withRegistry([])._sourceLabel('library', 'hardcover'), 'a shelf we cannot name');
  });

  it('says so, in words, when the directory could not be read', () => {
    const said = withRegistry([])._registryCaveat().textContent;
    assert.ok(said.includes('outage'), said);
    assert.ok(said.includes('not a permissions problem'), said);
    assert.ok(!/\b\d{3}\b/.test(said), `a person must never see a bare status: ${said}`);
    assert.equal(withRegistry(FIVE)._registryCaveat(), null, 'a healthy read draws no caveat');
  });
});

describe('the source, as a contract with two other repos', () => {
  const search = readFileSync(SEARCH_JS, 'utf8');
  const registry = readFileSync(REGISTRY_JS, 'utf8');
  const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('🔴 the three constants are GONE from the code (their obituary in the comments may stay)', () => {
    const c = code(search);
    for (const dead of ['FULL_SCOPE_SIZE', 'SOURCE_LABELS', 'SCOPE_LABELS']) {
      assert.ok(!c.includes(dead), `estate-search.js still has ${dead} in live code`);
    }
    assert.ok(search.includes('FULL_SCOPE_SIZE'), 'the comment recording what it did should stay — it is the only place that story is written');
  });

  it('🔴 stays SELF-CONTAINED — it is synced alone into two repos, so a sibling import would 404 there', () => {
    const imports = [...code(search).matchAll(/(?:^|\s)import\s+[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    assert.deepEqual(imports, [], `estate-search.js must have no static imports; found ${JSON.stringify(imports)}`);
    assert.ok(
      !code(search).includes("catalog-registry.js"),
      'the apex module must not be imported here — sync-estate-search.mjs copies ONE file',
    );
  });

  it('⚠️ the deliberate twin agrees with catalog-registry.js on every fact both carry', () => {
    // These are the four that would silently diverge, each with the failure it
    // would cause: a different route (one page names a shelf and the next does
    // not), a different unknown wording (two vocabularies for one absence), a
    // different ebook rule (the attribution the owner's rule forbids), and a
    // different implied-format rule ("Shared audiobooks · audiobook").
    assert.ok(search.includes('/api/catalogs') && registry.includes('/api/catalogs'));
    assert.ok(search.includes("'a shelf we cannot name'"), 'estate-search.js lost the shared unknown wording');
    assert.ok(registry.includes("'a shelf we cannot name'"), 'catalog-registry.js lost the shared unknown wording');
    for (const rule of [
      "c.shared === true && c.holding === 'digital' && c.kind === 'books'",
      "cat.kind === 'audio'",
      "cat.kind === 'games'",
    ]) {
      assert.ok(search.includes(rule), `estate-search.js diverged: ${rule}`);
      assert.ok(registry.includes(rule), `catalog-registry.js diverged: ${rule}`);
    }
  });

  it('🔴 carries NO hard-coded catalog list of its own', () => {
    const c = code(search);
    for (const forbidden of ["'library2'", '"library2"', "Samantha's library", "Skylar's library"]) {
      assert.ok(!c.includes(forbidden), `estate-search.js must not hard-code ${forbidden} — the registry is the list`);
    }
  });
});
