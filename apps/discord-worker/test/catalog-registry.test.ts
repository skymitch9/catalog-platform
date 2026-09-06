/**
 * **THE ESTATE DIRECTORY, AS THIS WORKER READS IT** — `src/catalog-registry.ts`,
 * plus the two things it decides: which shelves GABI offers
 * (`resolveLibraryInstances`) and what she calls them (`suggestShelvesFrom`).
 *
 * Written 2026-09-06 for dispatch 3 of the owner's multi-library rule
 * (`docs/info/multi-library-survey-2026-09-05.md` §10). What each block is
 * defending is written above it, because the failures here are all of one kind:
 * a sentence that is confidently wrong about whose shelf something is.
 *
 * ⚠️ **NOT A NETWORK TEST.** Every fetch is injected. The posture is what makes
 * that safe in production too: with `GABI_CATALOG_REGISTRY` unset there is no
 * subrequest at all, which is why the other ~1,300 tests in this package touch
 * no network either.
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { app } from '../src/index.js';
import {
  baseUrlFromHost,
  catalogForEntry,
  catalogRegistryHealthRows,
  catalogRegistryOn,
  catalogRegistryState,
  designation,
  estateCatalogs,
  joinWords,
  labelForCatalog,
  labelForEntry,
  loadCatalogs,
  parseCatalogs,
  resetCatalogRegistryCache,
  UNKNOWN_SHELF,
  type CatalogEntry,
} from '../src/catalog-registry.js';
import {
  DEFAULT_LIBRARY_FRIEND,
  DEFAULT_LIBRARY_MAIN,
  libraryInstances,
  libraryInstancesFrom,
  resolveLibraryInstances,
} from '../src/delegated.js';
import { DEFAULT_SUGGEST_SHELVES, suggestShelvesFrom } from '../src/suggest.js';

/** The five rows the live registry answers, verbatim in shape (measured
 *  2026-09-06 against `https://index.heygabi.ai/api/catalogs`) with hosts
 *  changed to sentinels so a passing test can never be a live host answering. */
const ROWS: CatalogEntry[] = [
  {
    id: 'audiobook',
    push_source: 'audiobook',
    kind: 'audio',
    label: 'Shared audiobooks',
    owner: null,
    holding: 'digital',
    shared: true,
    host: 'audio.example.test',
  },
  {
    id: 'library',
    push_source: 'library',
    kind: 'books',
    label: "Skylar's library",
    owner: 'Skylar',
    holding: 'physical',
    shared: false,
    host: 'main.example.test',
  },
  {
    id: 'games',
    push_source: 'game',
    kind: 'games',
    label: "Skylar's board games",
    owner: 'Skylar',
    holding: 'physical',
    shared: false,
    host: 'games.example.test',
  },
  {
    id: 'library2',
    push_source: 'library2',
    kind: 'books',
    label: "Samantha's library",
    owner: 'Samantha',
    holding: 'physical',
    shared: false,
    host: 'friend.example.test',
  },
  {
    id: 'ebooks',
    push_source: null,
    kind: 'books',
    label: 'Shared ebooks',
    owner: null,
    holding: 'digital',
    shared: true,
    host: 'ebooks.example.test',
  },
];

const BODY = { ok: true, catalogs: ROWS, counts: 'none' };

/** A fetch that records what it was asked and answers `body` with `status`. */
function directorySaid(
  body: unknown,
  status = 200,
): { fetch: typeof fetch; calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

/** ⚠️ A SENTINEL, not a stub: any call at all fails the test that installed it. */
const neverCalled = (async () => {
  throw new Error('the estate directory was read when it must not have been');
}) as unknown as typeof fetch;

const ON = { GABI_CATALOG_REGISTRY: 'on', INDEX_BASE_URL: 'https://index.test' };

beforeEach(() => resetCatalogRegistryCache());

// ---------------------------------------------------------------------------
// 1. The posture
// ---------------------------------------------------------------------------

describe('⚠️ catalogRegistryOn — affirmative-only, and OFF is the pre-registry bot', () => {
  it('only the exact word turns it on; case and whitespace are forgiven', () => {
    assert.equal(catalogRegistryOn({ GABI_CATALOG_REGISTRY: 'on' }), true);
    assert.equal(catalogRegistryOn({ GABI_CATALOG_REGISTRY: '  ON  ' }), true);
  });

  it('⚠️ everything else is OFF — absent, empty, affirmative-looking, a typo', () => {
    // `"true"`, `"1"` and `"yes"` are the dangerous ones: they are what
    // somebody who knows this Worker's other postures would type, and coercing
    // them to `on` would start a subrequest by typo rather than by decision.
    for (const raw of [undefined, '', '   ', 'true', '1', 'yes', 'enabled', 'On!', 'registry']) {
      assert.equal(
        catalogRegistryOn({ GABI_CATALOG_REGISTRY: raw }),
        false,
        `"${String(raw)}" must coerce to off`,
      );
    }
  });

  it('⚠️ posture OFF makes NO subrequest at all', async () => {
    assert.equal(await estateCatalogs({}, { fetch: neverCalled }), null);
    assert.deepEqual(
      await resolveLibraryInstances({}, { fetch: neverCalled }),
      libraryInstances({}),
      'off must be byte-for-byte the pre-registry shelf list',
    );
  });

  it('⚠️ wrangler.toml declares it, and declares it ON', async () => {
    // If this goes red somebody pinned the labels back to the in-code fallback.
    // That may well be right — it is one word and a deploy, exactly as designed
    // — but it is a DECISION and it should be visible in a diff rather than
    // discovered by GABI calling Samantha's shelf "the library at
    // padhard.heygabi.ai".
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const toml = readFileSync(fileURLToPath(new URL('../wrangler.toml', import.meta.url)), 'utf8');
    assert.match(toml, /^GABI_CATALOG_REGISTRY = "on"$/m);
  });
});

// ---------------------------------------------------------------------------
// 2. The fetch, and what it does NOT send
// ---------------------------------------------------------------------------

describe('the directory read', () => {
  it('asks the index Worker for /api/catalogs', async () => {
    const { fetch: f, calls } = directorySaid(BODY);
    const out = await estateCatalogs(ON, { fetch: f });
    assert.equal(out?.length, 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, 'https://index.test/api/catalogs');
  });

  it('🔴 SENDS NO CREDENTIAL — the absence IS the scope decision', async () => {
    // The route's anonymous branch is names-only by the owner's decision of
    // 2026-09-05 16:14 ("yes name only"). Sending a bearer would ask for counts
    // this Worker has no business holding, on behalf of nobody.
    const { fetch: f, calls } = directorySaid(BODY);
    await estateCatalogs(ON, { fetch: f });
    const headers = (calls[0]!.init?.headers ?? {}) as Record<string, string>;
    for (const key of Object.keys(headers)) {
      assert.doesNotMatch(key, /authorization|cookie|x-api-key/i, `the read sent ${key}`);
    }
  });

  it('⚠️ memoised for ten minutes, and the FAILURE is memoised too', async () => {
    // A directory that is unreachable and retried every turn turns a directory
    // outage into a latency outage.
    const { fetch: f, calls } = directorySaid({}, 503);
    let clock = 1_000;
    const now = () => clock;
    assert.equal(await estateCatalogs(ON, { fetch: f, now }), null);
    assert.equal(await estateCatalogs(ON, { fetch: f, now }), null);
    assert.equal(calls.length, 1, 'the failure must not be re-asked inside the TTL');
    clock += 10 * 60 * 1000 + 1;
    assert.equal(await estateCatalogs(ON, { fetch: f, now }), null);
    assert.equal(calls.length, 2, 'and it must be re-asked after it');
  });

  it('⚠️ every failure shape answers null rather than throwing', async () => {
    for (const [body, status] of [
      [{}, 200],
      [{ catalogs: [] }, 200],
      [{ catalogs: 'nope' }, 200],
      [{ catalogs: [{ id: 'library' }] }, 200],
      [BODY, 500],
      ['not json at all', 200],
    ] as [unknown, number][]) {
      resetCatalogRegistryCache();
      const { fetch: f } = directorySaid(body, status);
      assert.equal(await estateCatalogs(ON, { fetch: f }), null, `${JSON.stringify(body)} threw or resolved`);
    }
  });

  it('a fetch that throws is caught — a Durable Object must never see a rejection', async () => {
    const boom = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    assert.equal(await estateCatalogs(ON, { fetch: boom }), null);
  });
});

// ---------------------------------------------------------------------------
// 3. Parsing — validated, not trusted
// ---------------------------------------------------------------------------

describe('parseCatalogs — one bad row refuses the whole answer', () => {
  it('accepts the live shape and keeps every field', () => {
    const out = parseCatalogs(BODY);
    assert.deepEqual(out, ROWS);
  });

  it('⚠️ a malformed row refuses everything, rather than half a directory', () => {
    // Half a directory is how a shelf disappears from a menu silently — and a
    // menu missing a shelf is indistinguishable, to a person, from a shelf that
    // does not exist.
    for (const bad of [
      { ...ROWS[1]!, id: '' },
      { ...ROWS[1]!, label: 42 },
      { ...ROWS[1]!, host: null },
      { ...ROWS[1]!, holding: 'paper' },
      { ...ROWS[1]!, shared: 'false' },
      { ...ROWS[1]!, owner: 7 },
      { ...ROWS[1]!, kind: '' },
    ]) {
      assert.equal(parseCatalogs({ catalogs: [ROWS[0], bad] }), null, JSON.stringify(bad));
    }
  });

  it('an unknown KEY is kept — the registry is expected to grow fields', () => {
    const out = parseCatalogs({ catalogs: [{ ...ROWS[0]!, rows: 1251 }] });
    assert.equal(out?.length, 1);
    assert.equal(out![0]!.id, 'audiobook');
  });
});

describe('baseUrlFromHost — refused, never repaired', () => {
  it('a bare hostname becomes an origin', () => {
    assert.equal(baseUrlFromHost('library.heygabi.ai'), 'https://library.heygabi.ai');
    assert.equal(baseUrlFromHost('  main.example.test '), 'https://main.example.test');
  });

  it('⚠️ anything else is null — a "corrected" host is a guess in a link', () => {
    for (const host of [
      '',
      '   ',
      'https://x.test',
      'x.test/panel',
      'x.test:8443',
      'evil@x.test',
      'x test',
      'x.test?next=y',
      'x.test#f',
      null,
      42,
    ]) {
      assert.equal(baseUrlFromHost(host), null, `${String(host)} was accepted`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The words — and the two vocabularies
// ---------------------------------------------------------------------------

describe('⚠️ labels degrade to a WORDED unknown, never to a database id', () => {
  it('the old `MAP[x] || x` printed "library2" into an English sentence', () => {
    assert.equal(labelForCatalog(ROWS, 'library2'), "Samantha's library");
    assert.equal(labelForCatalog(ROWS, 'library3'), UNKNOWN_SHELF);
    assert.equal(labelForCatalog(null, 'library'), UNKNOWN_SHELF);
    assert.doesNotMatch(UNKNOWN_SHELF, /library2|_|[A-Z]{2}/);
  });

  it('the PUSH vocabulary is a different word from the visibility one', () => {
    // `games` (a grant) ↔ `game` (a row's source). The registry carries both,
    // which is what lets a hit's `source` become a label with no second map.
    assert.equal(labelForEntry(ROWS, 'game'), "Skylar's board games");
    assert.equal(labelForCatalog(ROWS, 'games'), "Skylar's board games");
  });

  it('🔴 an EBOOK row rides the audiobook source and is still the SHARED EBOOK shelf', () => {
    // `series.js` once asserted the opposite in a comment — that ebooks ride a
    // LIBRARY source and render as "Skylar's library (ebook)". The survey
    // measured that false (§2 F3) and it described exactly the attribution the
    // owner's rule forbids: a shared digital work credited to one person's
    // physical shelf.
    assert.equal(labelForEntry(ROWS, 'audiobook', 'ebook'), 'Shared ebooks');
    assert.equal(labelForEntry(ROWS, 'audiobook', 'audiobook'), 'Shared audiobooks');
    // ⚠️ And the remap fires ONLY for the shared digital pool: a library row
    // carrying `format: 'ebook'` is still that library's own copy.
    assert.equal(catalogForEntry(ROWS, 'library', 'ebook')?.id, 'library');
  });
});

describe('⚠️ designation — a shared pool has no owner, and says so', () => {
  it('names the owner for a physical shelf', () => {
    assert.equal(designation(ROWS[1]!), "Skylar's · physical copies");
  });

  it('🔴 says "shared" rather than printing an empty name', () => {
    // `owner` is null exactly when `shared` is true. A renderer that printed
    // the name would say "'s · digital", which is the sentence this whole
    // build exists to stop.
    const said = designation(ROWS[0]!);
    assert.match(said, /shared/i);
    assert.doesNotMatch(said, /^'s|\bnull\b|undefined/);
  });

  it('a private catalog with no owner recorded says what is known and no more', () => {
    const orphan: CatalogEntry = { ...ROWS[1]!, owner: null, shared: false };
    assert.match(designation(orphan), /holder not recorded/);
    assert.doesNotMatch(designation(orphan), /null|undefined/);
  });

  it('an unknown catalog is the worded unknown', () => {
    assert.equal(designation(null), UNKNOWN_SHELF);
  });
});

describe('joinWords', () => {
  it('reads out loud', () => {
    assert.equal(joinWords([]), '');
    assert.equal(joinWords(['a']), 'a');
    assert.equal(joinWords(['a', 'b']), 'a and b');
    assert.equal(joinWords(['a', 'b', 'c']), 'a, b and c');
  });
});

// ---------------------------------------------------------------------------
// 5. 🔴 THE SHELVES SHE OFFERS — the closed type union that is no longer one
// ---------------------------------------------------------------------------

describe('🔴 resolveLibraryInstances — the estate decides which shelves exist', () => {
  it('the registry names them, and the main library comes first', async () => {
    const { fetch: f } = directorySaid(BODY);
    const out = await resolveLibraryInstances(ON, { fetch: f });
    assert.deepEqual(
      out.map((i) => i.app),
      ['library', 'library2'],
      'the digital pools are not instances — there is nothing to route a write to',
    );
    assert.equal(out[0]!.label, "Skylar's library");
    assert.equal(out[1]!.label, "Samantha's library");
  });

  it('🔴 A THIRD LIBRARY NEEDS NO CODE CHANGE — that was the whole finding', async () => {
    // `LibraryInstance.app` was `'library' | 'library2'`, a closed type union,
    // and survey §3.4 named it: "a `library3` is a type change today".
    const three = [
      ...ROWS,
      {
        id: 'library3',
        push_source: 'library3',
        kind: 'books',
        label: "Amber's library",
        owner: 'Amber',
        holding: 'physical' as const,
        shared: false,
        host: 'third.example.test',
      },
    ];
    const { fetch: f } = directorySaid({ ok: true, catalogs: three });
    const out = await resolveLibraryInstances(ON, { fetch: f });
    assert.deepEqual(
      out.map((i) => i.app),
      ['library', 'library2', 'library3'],
    );
    assert.equal(out[2]!.baseUrl, 'https://third.example.test');
    assert.equal(out[2]!.label, "Amber's library");
  });

  it('⚠️ a CONFIGURED host wins over the directory — a pin is a decision', () => {
    // `LIBRARY_MAIN_URL`/`LIBRARY_FRIEND_URL` exist so a test or an operator
    // can point this Worker somewhere deliberately. A directory must not
    // override that; a shelf the vars do NOT name takes the registry's host,
    // which is how a third one can exist at all.
    const out = libraryInstancesFrom({ LIBRARY_MAIN_URL: 'https://pinned.test' }, ROWS);
    assert.equal(out[0]!.baseUrl, 'https://pinned.test');
    assert.equal(out[0]!.label, "Skylar's library", 'the NAME still comes from the directory');
  });

  it('⚠️ a row whose host cannot be read is SKIPPED, never repaired', () => {
    const bent = ROWS.map((r) => (r.id === 'library2' ? { ...r, host: 'https://friend.test' } : r));
    // ⚠️ `library2` IS one of the configured pair, so it keeps its configured
    // base — the pin is what protects it. An unconfigured shelf with a bent
    // host is the one that drops out.
    const withThird = [
      ...bent,
      {
        id: 'library3',
        push_source: 'library3',
        kind: 'books',
        label: "Amber's library",
        owner: 'Amber',
        holding: 'physical' as const,
        shared: false,
        host: 'not a host',
      },
    ];
    const out = libraryInstancesFrom({}, withThird);
    assert.deepEqual(out.map((i) => i.app), ['library', 'library2']);
  });

  it('⚠️ the directory naming NO physical book catalog falls back, it does not empty', () => {
    // "The registry did not say" and "the estate has no libraries" are
    // different facts, and an empty shelf list would silently disable every
    // delegated write.
    const digitalOnly = ROWS.filter((r) => r.holding === 'digital');
    assert.deepEqual(libraryInstancesFrom({}, digitalOnly), libraryInstances({}));
  });

  it('⚠️ an unreachable directory falls back to the configured pair', async () => {
    const { fetch: f } = directorySaid({}, 503);
    const out = await resolveLibraryInstances(ON, { fetch: f });
    assert.deepEqual(out, libraryInstances({}));
    assert.equal(out[0]!.baseUrl, DEFAULT_LIBRARY_MAIN);
    assert.equal(out[1]!.baseUrl, DEFAULT_LIBRARY_FRIEND);
  });
});

describe('🔴 the FALLBACK names no owner — "your own shelf" was asker-relative', () => {
  it('the second shelf is named by its ADDRESS, never as the asker\'s own', () => {
    // Survey §2 F2 row #7: GABI called SAMANTHA'S library "your own shelf" TO
    // SKYLAR. Ownership is the registry's fact; a directory outage is not
    // evidence about whose shelf something is, so the fallback names something
    // checkable instead of guessing.
    const [main, friend] = libraryInstances({});
    assert.equal(main!.label, 'the main library');
    assert.equal(friend!.label, 'the library at padhard.heygabi.ai');
    for (const i of libraryInstances({})) {
      assert.doesNotMatch(i.label, /your own|my own|\byours\b/i, `"${i.label}" is asker-relative`);
    }
  });

  it('a configured friend host is reflected in the fallback label', () => {
    const [, friend] = libraryInstances({ LIBRARY_FRIEND_URL: 'https://elsewhere.test' });
    assert.equal(friend!.label, 'the library at elsewhere.test');
  });
});

// ---------------------------------------------------------------------------
// 6. 🔴 THE THREE SUGGESTION SHELVES
// ---------------------------------------------------------------------------

describe('🔴 suggestShelvesFrom — whose shelf a suggestion is on', () => {
  it('the directory names all three', () => {
    assert.deepEqual(suggestShelvesFrom(ROWS), {
      audio: 'Shared audiobooks',
      ebook: 'Shared ebooks',
      physical: "Skylar's library",
    });
  });

  it('🔴 an ebook is the SHARED POOL, never "the library"', () => {
    // "the library, as an ebook" credited a shared digital work to one
    // person's physical shelf — the exact attribution the owner's rule forbids
    // (survey §6).
    assert.doesNotMatch(suggestShelvesFrom(ROWS).ebook, /^the library$/i);
    assert.match(suggestShelvesFrom(ROWS).ebook, /shared/i);
    assert.match(DEFAULT_SUGGEST_SHELVES.ebook, /shared/i);
  });

  it('⚠️ no directory → the fallback, which names no owner rather than the wrong one', () => {
    assert.deepEqual(suggestShelvesFrom(null), DEFAULT_SUGGEST_SHELVES);
    for (const word of Object.values(DEFAULT_SUGGEST_SHELVES)) {
      assert.doesNotMatch(word, /skylar|samantha/i, `"${word}" guesses an owner`);
    }
  });

  it('⚠️ a directory missing a row keeps that row\'s fallback word, never an id', () => {
    const noAudio = ROWS.filter((r) => r.kind !== 'audio');
    assert.equal(suggestShelvesFrom(noAudio).audio, DEFAULT_SUGGEST_SHELVES.audio);
  });

  it('⚠️ `physical` is the shelf the print join is MEASURED to point at', () => {
    // It names that shelf correctly; it does not change which one it is. Moving
    // it needs `audiobook_catalog`'s join to carry an instance — another repo's
    // work, and deliberately out of scope here.
    const swapped = ROWS.map((r) =>
      r.id === 'library' ? { ...r, label: 'THE MEASURED ONE' } : r,
    );
    assert.equal(suggestShelvesFrom(swapped).physical, 'THE MEASURED ONE');
  });
});

// ---------------------------------------------------------------------------
// 7. The two lanes share one fetch and one memo
// ---------------------------------------------------------------------------

describe('⚠️ one directory, one memo — however many lanes ask', () => {
  it('a second lane inside the TTL makes no second subrequest', async () => {
    const { fetch: f, calls } = directorySaid(BODY);
    await resolveLibraryInstances(ON, { fetch: f });
    await estateCatalogs(ON, { fetch: f });
    await loadCatalogs(ON, { fetch: f });
    assert.equal(calls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// 8. ⚠️ WHY the memo holds what it holds — and the health rows that say it
// ---------------------------------------------------------------------------

/**
 * 🔴 **THE DEFECT THESE DEFEND, measured 2026-09-06 07:50–08:00 Phoenix.**
 * `GET https://discord.heygabi.ai/api/health` answered
 * `gabi_delegated_target_labels: ["Skylar's library","Samantha's library"]` on
 * ~60 of 100 sampled requests and the configured FALLBACK
 * `["the main library","the library at padhard.heygabi.ai"]` on the other ~40 —
 * interleaved, from ONE deployment at 100% of traffic, none edge-cached. In the
 * same four minutes `wrangler tail` captured 113 events, **all `outcome: ok`,
 * with zero logs and zero exceptions**, so not one of `loadCatalogs`'s
 * `console.error` lines fired inside the window that saw the fallback.
 *
 * Both facts are consistent — the log fires ONCE per isolate per failure and
 * the failure is then remembered for ten minutes, so it lands outside almost
 * every window — but **nothing published from outside could tell them apart**,
 * and `gabi_catalog_registry` (the posture) reads `on` either way. These tests
 * pin the rows that end that: the SOURCE, and when it is the fallback, WHY.
 */
describe('🔴 the memo records WHY, and /api/health publishes it', () => {
  /** A fetch that fails a given way, and moves the injected clock while it does
   *  — so `fetchMs` is a measured duration rather than an artefact of a frozen
   *  test clock. */
  function slowFailure(kind: 'timeout' | 'abort-message' | 'boom' | 'long', tick: () => void) {
    return (async () => {
      tick();
      if (kind === 'timeout') {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      if (kind === 'abort-message') {
        // ⚠️ Some runtimes report our own AbortSignal only in the MESSAGE.
        throw new Error('This operation was aborted');
      }
      if (kind === 'long') throw new Error('x'.repeat(400));
      throw new Error('network');
    }) as unknown as typeof fetch;
  }

  /** The injected clock plus a fetch that costs `costMs` of it. */
  function clockAndFetch(costMs: number, body: unknown, status = 200) {
    let clock = 1_000_000;
    const now = () => clock;
    const impl = (async () => {
      clock += costMs;
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;
    return { now, fetch: impl, advance: (ms: number) => (clock += ms) };
  }

  it('a directory that answers: source `registry`, NO reason, and a measured fetch time', async () => {
    const { now, fetch: f, advance } = clockAndFetch(37, BODY);
    assert.equal((await estateCatalogs(ON, { fetch: f, now }))?.length, 5);
    advance(90_000);
    assert.deepEqual(catalogRegistryHealthRows(ON, { now }), {
      gabi_catalog_registry_source: 'registry',
      gabi_catalog_registry_reason: null,
      gabi_catalog_registry_age_s: 90,
      gabi_catalog_registry_fetch_ms: 37,
    });
  });

  it('⚠️ a TIMEOUT says `timeout` — the 2 s ceiling, named rather than guessed at', async () => {
    let clock = 500;
    const now = () => clock;
    await estateCatalogs(ON, { fetch: slowFailure('timeout', () => (clock += 2_000)), now });
    assert.deepEqual(catalogRegistryHealthRows(ON, { now }), {
      gabi_catalog_registry_source: 'fallback',
      gabi_catalog_registry_reason: 'timeout',
      gabi_catalog_registry_age_s: 2,
      gabi_catalog_registry_fetch_ms: 2_000,
    });
  });

  it('⚠️ an abort reported only in the MESSAGE is still a timeout, not a mystery', async () => {
    let clock = 0;
    const now = () => clock;
    await estateCatalogs(ON, { fetch: slowFailure('abort-message', () => (clock += 2_001)), now });
    assert.equal(catalogRegistryHealthRows(ON, { now }).gabi_catalog_registry_reason, 'timeout');
  });

  it('⚠️ a NON-2xx says `http 503` — words plus the code, never a bare number', async () => {
    // A bare `503` in a health row is a puzzle; `http 503` is a diagnosis.
    const { now, fetch: f } = clockAndFetch(12, BODY, 503);
    assert.equal(await estateCatalogs(ON, { fetch: f, now }), null);
    assert.deepEqual(catalogRegistryHealthRows(ON, { now }), {
      gabi_catalog_registry_source: 'fallback',
      gabi_catalog_registry_reason: 'http 503',
      gabi_catalog_registry_age_s: 0,
      gabi_catalog_registry_fetch_ms: 12,
    });
  });

  it('a 200 carrying a BAD SHAPE says `shape` — a parse refusal, not a network fault', async () => {
    for (const body of [{}, { catalogs: [] }, { catalogs: 'nope' }, { catalogs: [{ id: 'library' }] }]) {
      resetCatalogRegistryCache();
      const { now, fetch: f } = clockAndFetch(5, body);
      assert.equal(await estateCatalogs(ON, { fetch: f, now }), null);
      assert.equal(
        catalogRegistryHealthRows(ON, { now }).gabi_catalog_registry_reason,
        'shape',
        `${JSON.stringify(body)} must read as a shape refusal`,
      );
    }
  });

  it('any other throw keeps its own message under `error:`', async () => {
    let clock = 0;
    await estateCatalogs(ON, { fetch: slowFailure('boom', () => (clock += 4)), now: () => clock });
    assert.equal(
      catalogRegistryHealthRows(ON, { now: () => clock }).gabi_catalog_registry_reason,
      'error: network',
    );
  });

  it('⚠️ a very long upstream message is TRUNCATED — a health row is read by a person', async () => {
    let clock = 0;
    await estateCatalogs(ON, { fetch: slowFailure('long', () => (clock += 4)), now: () => clock });
    const reason = catalogRegistryHealthRows(ON, { now: () => clock }).gabi_catalog_registry_reason!;
    assert.ok(reason.startsWith('error: xxx'));
    assert.ok(reason.endsWith('…'));
    assert.ok(reason.length <= 130, `reason was ${reason.length} chars`);
  });

  it('⚠️ POSTURE OFF is its own source — not a failure, and no subrequest', async () => {
    assert.equal(await estateCatalogs({}, { fetch: neverCalled }), null);
    assert.deepEqual(catalogRegistryHealthRows({}), {
      gabi_catalog_registry_source: 'off',
      gabi_catalog_registry_reason: 'the posture is off, so the estate directory is never read',
      gabi_catalog_registry_age_s: null,
      gabi_catalog_registry_fetch_ms: null,
    });
  });

  it('posture ON with nothing read yet says so in words rather than claiming `registry`', () => {
    assert.deepEqual(catalogRegistryHealthRows(ON), {
      gabi_catalog_registry_source: 'fallback',
      gabi_catalog_registry_reason: 'the estate directory has not been read in this isolate yet',
      gabi_catalog_registry_age_s: null,
      gabi_catalog_registry_fetch_ms: null,
    });
  });

  it('⚠️ `catalogRegistryState` is a PURE reader — it never fetches or expires', async () => {
    const { fetch: f, calls } = directorySaid(BODY);
    assert.equal(catalogRegistryState(), null, 'reading an empty memo must not populate it');
    assert.equal(calls.length, 0);
    await estateCatalogs(ON, { fetch: f });
    for (let i = 0; i < 5; i += 1) assert.equal(catalogRegistryState()?.source, 'registry');
    assert.equal(calls.length, 1, 'reading the state must never cost a subrequest');
  });
});

// ---------------------------------------------------------------------------
// 9. The same thing END TO END, through the real /api/health handler
// ---------------------------------------------------------------------------

describe('🔴 GET /api/health tells a reader WHICH of the two answered', () => {
  const HEALTH_ENV = {
    DISCORD_PUBLIC_KEY: 'x',
    GABI_CATALOG_REGISTRY: 'on',
    INDEX_BASE_URL: 'https://index.test',
  };

  /** Drive the REAL handler with the global `fetch` stubbed — production passes
   *  no deps, so the global is the only seam the live path actually has. */
  async function healthWith(impl: typeof fetch): Promise<Record<string, unknown>> {
    const real = globalThis.fetch;
    globalThis.fetch = impl;
    try {
      const res = await app.request('/api/health', {}, HEALTH_ENV);
      assert.equal(res.status, 200);
      return (await res.json()) as Record<string, unknown>;
    } finally {
      globalThis.fetch = real;
    }
  }

  it('the directory answering → `registry`, no reason, and the REGISTRY labels', async () => {
    const { fetch: f } = directorySaid(BODY);
    const body = await healthWith(f);
    assert.equal(body.gabi_catalog_registry, 'on');
    assert.equal(body.gabi_catalog_registry_source, 'registry');
    assert.equal(body.gabi_catalog_registry_reason, null);
    assert.deepEqual(body.gabi_delegated_target_labels, ["Skylar's library", "Samantha's library"]);
    assert.ok(typeof body.gabi_catalog_registry_age_s === 'number');
    assert.ok(typeof body.gabi_catalog_registry_fetch_ms === 'number');
  });

  it('🔴 the directory refusing → `fallback` + `http 503`, WITH the fallback labels', async () => {
    // This is the exact pairing that was invisible on 2026-09-06: the labels
    // silently changed and every published row went on saying `on`.
    const { fetch: f } = directorySaid({}, 503);
    const body = await healthWith(f);
    assert.equal(body.gabi_catalog_registry, 'on', 'the posture row is unchanged — it is the posture');
    assert.equal(body.gabi_catalog_registry_source, 'fallback');
    assert.equal(body.gabi_catalog_registry_reason, 'http 503');
    assert.deepEqual(body.gabi_delegated_target_labels, [
      'the main library',
      'the library at padhard.heygabi.ai',
    ]);
  });

  it('a timeout → `fallback` + `timeout`, the answer that would settle the 2 s question', async () => {
    const timedOut = (async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'TimeoutError';
      throw err;
    }) as unknown as typeof fetch;
    const body = await healthWith(timedOut);
    assert.equal(body.gabi_catalog_registry_source, 'fallback');
    assert.equal(body.gabi_catalog_registry_reason, 'timeout');
  });

  it('posture OFF → `off`, worded, and NOT reported as a failure', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = neverCalled;
    try {
      const res = await app.request('/api/health', {}, { DISCORD_PUBLIC_KEY: 'x' });
      const body = (await res.json()) as Record<string, unknown>;
      assert.equal(body.gabi_catalog_registry, 'off');
      assert.equal(body.gabi_catalog_registry_source, 'off');
      assert.match(String(body.gabi_catalog_registry_reason), /posture is off/);
      assert.equal(body.gabi_catalog_registry_age_s, null);
    } finally {
      globalThis.fetch = real;
    }
  });

  it('⚠️ every published value is READABLE — no row is a bare number or a code', async () => {
    const { fetch: f } = directorySaid({}, 418);
    const body = await healthWith(f);
    const reason = String(body.gabi_catalog_registry_reason);
    assert.match(reason, /^http 418$/, 'a status must arrive with the word http in front of it');
    assert.doesNotMatch(reason, /^\d+$/);
    assert.match(String(body.gabi_catalog_registry_source), /^(registry|fallback|off)$/);
  });
});
