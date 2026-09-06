/**
 * catalog-registry.test.mjs — the apex's reader of `GET /api/catalogs`, driven
 * through the REAL module.
 *
 * Design: docs/info/catalog-registry.md. Survey:
 * docs/info/multi-library-survey-2026-09-05.md §2 F1/F2/F3.
 *
 * ## 🔴 The six things this file exists to prove
 *
 * 1. **`FULL_SCOPE_SIZE = 3` cannot come back.** `scopeIsEverything()` is a SET
 *    comparison: a three-catalog scope on a five-catalog estate is NOT
 *    everything, and neither is any other three. That constant told every
 *    ordinary member their search covered "any shelf" while two shelves were
 *    never consulted.
 * 2. **A shelf the registry does not name degrades to WORDS, never to its
 *    database id.** The old `MAP[x] || x` printed the literal string
 *    "library2" into an English sentence.
 * 3. **An ebook row is attributed to the SHARED pool, not to a library.** The
 *    stale comment this replaces asserted the opposite, and the attribution it
 *    described is the one the owner's rule forbids.
 * 4. **A failure is a WORDED outage, never a bare status** — and the four
 *    causes stay distinguishable to a debugger even though a person sees one
 *    sentence.
 * 5. **A failure is not memoised**, so one flaky fetch does not leave a page
 *    wrong for its whole life.
 * 6. **There is NO hard-coded catalog list to fall back to.** On failure the
 *    module returns a refusal, never a guess at what the estate holds.
 *
 * ⚠️ WHAT A GREEN RUN DOES NOT SAY: nothing here renders anything. These are
 * the words and the shapes; what a person sees on the front door is
 * apex-catalog-cards.test.mjs's half, and what a person sees SIGNED IN is
 * nobody's — the live registry answers `counts: "none"` to this suite's
 * fixtures and to any unauthenticated fetch.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = pathToFileURL(
  resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public', 'assets', 'catalog-registry.js'),
).href;

const mod = await import(MODULE);

/** The five catalogs exactly as https://index.heygabi.ai/api/catalogs served
 *  them at 2026-09-05 23:58 UTC — copied from the live answer, not invented. */
const FIVE = [
  { id: 'audiobook', push_source: 'audiobook', kind: 'audio', label: 'Shared audiobooks', owner: null, holding: 'digital', shared: true, host: 'audiobooks.heygabi.ai' },
  { id: 'library', push_source: 'library', kind: 'books', label: "Skylar's library", owner: 'Skylar', holding: 'physical', shared: false, host: 'library.heygabi.ai' },
  { id: 'games', push_source: 'game', kind: 'games', label: "Skylar's board games", owner: 'Skylar', holding: 'physical', shared: false, host: 'boardgames.heygabi.ai' },
  { id: 'library2', push_source: 'library2', kind: 'books', label: "Samantha's library", owner: 'Samantha', holding: 'physical', shared: false, host: 'padhard.heygabi.ai' },
  { id: 'ebooks', push_source: null, kind: 'books', label: 'Shared ebooks', owner: null, holding: 'digital', shared: true, host: 'ebooks.heygabi.ai' },
];

const answer = (over = {}) => ({ ok: true, catalogs: FIVE, counts: 'none', stale: false, fetched_at: '2026-09-05T23:58:38.376Z', ...over });

/** A `fetch` that answers once from `res` and records what it was asked. */
function stubFetch(res) {
  const calls = [];
  return {
    calls,
    fn: async (url, init) => {
      calls.push({ url: String(url), init });
      if (typeof res === 'function') return res();
      return res;
    },
  };
}

const okRes = (body) => ({ ok: true, status: 200, json: async () => body });

describe('parseCatalogs — validated, not trusted', () => {
  it('accepts the live answer and keeps unknown keys', () => {
    const out = mod.parseCatalogs({ catalogs: [{ ...FIVE[1], future_field: 7 }] });
    assert.equal(out.length, 1);
    assert.equal(out[0].future_field, 7, 'the registry is expected to grow fields; truncating tomorrow’s schema is the bug');
  });

  it('refuses every shape that is not the answer', () => {
    for (const bad of [null, 'nope', 42, {}, { catalogs: null }, { catalogs: [] }, { catalogs: [null] }, { catalogs: [[]] }]) {
      assert.equal(mod.parseCatalogs(bad), null, `should have refused ${JSON.stringify(bad)}`);
    }
  });

  it('refuses a row missing or mistyping any field this site renders', () => {
    const bads = [
      { id: '' }, { label: '' }, { host: '' }, { kind: '' },
      { holding: 'borrowed' }, { shared: 'yes' }, { owner: 7 }, { push_source: 7 },
    ];
    for (const patch of bads) {
      assert.equal(mod.parseCatalogs({ catalogs: [{ ...FIVE[1], ...patch }] }), null, `should have refused ${JSON.stringify(patch)}`);
    }
  });
});

describe('scopeIsEverything — the replacement for FULL_SCOPE_SIZE = 3', () => {
  it('🔴 the DEFAULT three-catalog grant is NOT every shelf', () => {
    assert.equal(mod.scopeIsEverything(FIVE, ['audiobook', 'library', 'games']), false);
  });

  it('is a SET comparison, so three of the wrong three is still not everything', () => {
    assert.equal(mod.scopeIsEverything(FIVE, ['audiobook', 'library2', 'ebooks']), false);
  });

  it('says yes only when every catalog id is present', () => {
    assert.equal(mod.scopeIsEverything(FIVE, FIVE.map((c) => c.id)), true);
  });

  it('says NO when the registry is unknown — we cannot claim "everything" without knowing what everything is', () => {
    assert.equal(mod.scopeIsEverything([], ['audiobook', 'library', 'games']), false);
    assert.equal(mod.scopeIsEverything(FIVE, []), false);
    assert.equal(mod.scopeIsEverything(FIVE, null), false);
  });
});

describe('words — the seven disagreeing maps, replaced', () => {
  it('names each shelf from the registry, in the push vocabulary', () => {
    assert.equal(mod.labelForEntry(FIVE, 'library'), "Skylar's library");
    assert.equal(mod.labelForEntry(FIVE, 'library2'), "Samantha's library");
    assert.equal(mod.labelForEntry(FIVE, 'game'), "Skylar's board games", 'games↔game is the ONE place the two vocabularies differ');
    assert.equal(mod.labelForEntry(FIVE, 'audiobook'), 'Shared audiobooks');
  });

  it('names each shelf from the registry, in the visibility vocabulary', () => {
    assert.equal(mod.labelForCatalog(FIVE, 'games'), "Skylar's board games");
    assert.equal(mod.labelForCatalog(FIVE, 'ebooks'), 'Shared ebooks');
  });

  it('🔴 degrades to WORDS, never to a database id', () => {
    assert.equal(mod.labelForEntry(FIVE, 'library3'), mod.UNKNOWN_SHELF);
    assert.equal(mod.labelForCatalog(FIVE, 'library3'), mod.UNKNOWN_SHELF);
    assert.ok(!mod.UNKNOWN_SHELF.includes('library'), 'the unknown wording must not itself be a source id');
  });

  it('🔴 an ebook row rides `audiobook` and belongs to the SHARED EBOOK shelf', () => {
    assert.equal(mod.labelForEntry(FIVE, 'audiobook', 'ebook'), 'Shared ebooks');
    assert.equal(mod.labelForEntry(FIVE, 'audiobook', 'audiobook'), 'Shared audiobooks');
  });

  it('⚠️ but a PHYSICAL shelf’s own ebook stays that shelf’s — the remap fires only on the shared digital pool', () => {
    assert.equal(mod.labelForEntry(FIVE, 'library', 'ebook'), "Skylar's library");
  });

  it('designates who owns each shelf, and says "shared" rather than an empty name', () => {
    assert.equal(mod.designation(mod.catalogById(FIVE, 'library')), 'Skylar’s · physical copies');
    assert.equal(mod.designation(mod.catalogById(FIVE, 'games')), 'Skylar’s · physical copies');
    assert.equal(mod.designation(mod.catalogById(FIVE, 'library2')), 'Samantha’s · physical copies');
    assert.equal(mod.designation(mod.catalogById(FIVE, 'audiobook')), 'Shared across the estate · digital');
    assert.equal(mod.designation(mod.catalogById(FIVE, 'ebooks')), 'Shared across the estate · digital');
  });

  it('never invents a holder for a private catalog whose owner is not recorded', () => {
    const nameless = { id: 'library9', push_source: 'library9', kind: 'books', label: 'A shelf', owner: null, holding: 'physical', shared: false, host: 'x.heygabi.ai' };
    const said = mod.designation(nameless);
    assert.ok(said.includes('not recorded'), said);
    assert.ok(!said.includes('undefined') && !said.includes('null'), said);
  });

  it('drops a format the shelf’s own name already implies', () => {
    assert.equal(mod.formatSuffix(mod.catalogById(FIVE, 'audiobook'), 'audiobook'), null);
    assert.equal(mod.formatSuffix(mod.catalogById(FIVE, 'ebooks'), 'ebook'), null);
    assert.equal(mod.formatSuffix(mod.catalogById(FIVE, 'games'), 'boardgame'), null);
    assert.equal(mod.formatSuffix(mod.catalogById(FIVE, 'library'), 'hardcover'), 'hardcover');
    assert.equal(mod.formatSuffix(mod.catalogById(FIVE, 'games'), 'expansion'), 'expansion');
  });

  it('an unknown future catalog gets the right English with no edit anywhere', () => {
    const library3 = { id: 'library3', push_source: 'library3', kind: 'books', label: "Justin's library", owner: 'Justin', holding: 'physical', shared: false, host: 'l3.heygabi.ai' };
    const six = [...FIVE, library3];
    assert.equal(mod.labelForEntry(six, 'library3'), "Justin's library");
    assert.equal(mod.designation(library3), 'Justin’s · physical copies');
    assert.equal(mod.formatSuffix(library3, 'paperback'), 'paperback');
    assert.equal(mod.scopeIsEverything(six, FIVE.map((c) => c.id)), false, 'a sixth catalog makes the old five no longer everything');
  });

  it('speaks a scope as a list a person reads out loud', () => {
    assert.equal(
      mod.scopePhrase(FIVE, ['audiobook', 'library', 'games']),
      "Shared audiobooks, Skylar's library and Skylar's board games",
    );
    assert.equal(mod.scopePhrase(FIVE, ['library']), "Skylar's library");
    assert.equal(mod.scopePhrase(FIVE, []), '');
  });
});

describe('loadCatalogs — the fetch, and its honest failures', () => {
  it('reads the anonymous answer and reports it carries no counts', async () => {
    mod.__resetRegistry();
    const f = stubFetch(okRes(answer()));
    const r = await mod.loadCatalogs({ fetchImpl: f.fn });
    assert.equal(r.ok, true);
    assert.equal(r.counts, 'none');
    assert.equal(r.stale, false);
    assert.equal(r.catalogs.length, 5);
    assert.equal(f.calls[0].url, mod.REGISTRY_URL);
    assert.equal(f.calls[0].init, undefined, 'an anonymous read must not send an Authorization header');
  });

  it('presents the bearer when one is given, and memoises the two answers separately', async () => {
    mod.__resetRegistry();
    const f = stubFetch(() => okRes(answer({ counts: 'scoped' })));
    const r = await mod.loadCatalogs({ token: 'tok', fetchImpl: f.fn });
    assert.equal(r.counts, 'scoped');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer tok');
    await mod.loadCatalogs({ token: 'tok', fetchImpl: f.fn });
    assert.equal(f.calls.length, 1, 'the member answer is memoised for the life of the page');
    await mod.loadCatalogs({ fetchImpl: f.fn });
    assert.equal(f.calls.length, 2, 'the anonymous answer is a different question and gets its own fetch');
  });

  it('reports a stale upstream copy as stale rather than as fresh', async () => {
    mod.__resetRegistry();
    const f = stubFetch(okRes(answer({ stale: true })));
    const r = await mod.loadCatalogs({ fetchImpl: f.fn });
    assert.equal(r.stale, true);
  });

  it('🔴 every failure is WORDS, names an outage rather than a permission, and carries NO catalog list', async () => {
    const cases = [
      ['network', () => { throw new Error('offline'); }],
      ['unavailable', () => ({ ok: false, status: 503, json: async () => ({}) })],
      ['malformed', () => okRes({ nope: true })],
      ['malformed', () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })],
    ];
    for (const [reason, res] of cases) {
      mod.__resetRegistry();
      const f = stubFetch(res);
      const r = await mod.loadCatalogs({ fetchImpl: f.fn });
      assert.equal(r.ok, false, `${reason} should not be ok`);
      assert.equal(r.reason, reason);
      assert.equal(r.catalogs, undefined, 'a failure must never hand back a guessed catalog list');
      assert.ok(r.detail.includes('outage'), r.detail);
      assert.ok(r.detail.includes('not a permissions problem'), r.detail);
      assert.ok(!/\b\d{3}\b/.test(r.detail), `a person must never see a bare status: ${r.detail}`);
    }
  });

  it('does NOT memoise a failure — one flaky fetch must not leave the page wrong for its whole life', async () => {
    mod.__resetRegistry();
    let n = 0;
    const f = stubFetch(() => {
      n += 1;
      if (n === 1) throw new Error('flaky');
      return okRes(answer());
    });
    assert.equal((await mod.loadCatalogs({ fetchImpl: f.fn })).ok, false);
    assert.equal((await mod.loadCatalogs({ fetchImpl: f.fn })).ok, true);
    assert.equal(n, 2);
  });
});

describe('there is no hard-coded catalog list in this module', () => {
  it('🔴 the source names no catalog id, label or host of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(fileURLToPath(new URL(MODULE)), 'utf8');
    // Comments legitimately discuss the catalogs by name; code must not. Strip
    // block comments and line comments, then look for the ids as string values.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ["'library2'", '"library2"', "'audiobooks.heygabi.ai'", "'Samantha", "'Skylar"]) {
      assert.ok(!code.includes(forbidden), `catalog-registry.js must not hard-code ${forbidden} — the registry is the list`);
    }
  });
});
