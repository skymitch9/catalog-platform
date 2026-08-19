/**
 * ⚠️ **THE BUILD-FAILING GUARD ON GABI'S DISCORD TOOLS.**
 *
 * Three different failures, and no other test in this repo can see any of them:
 *
 *  1. **The allowlist stops being the allowlist.** A definition with no name, a
 *     name with no definition, a duplicate, an open input schema.
 *  2. ⚠️ **A WRITE TOOL ARRIVES.** Adding `set_book_details` to `GABI_TOOL_NAMES`
 *     is one line, it typechecks, and nothing else in the repo would notice —
 *     on a bot that is LIVE in the owner's server and that anyone in it can
 *     talk to. **This file is what notices.**
 *  3. ⚠️ **A GATED SURFACE IS READ.** The catalogue metadata this feature reads
 *     is public (`catalog-data.ts` carries the measurement); the estate's ebook
 *     and audio FILE surfaces are not, and the executor holds no credential
 *     that could reach them. That is asserted against the executor's own SOURCE
 *     rather than trusted, because the danger is an import somebody adds later.
 *
 * The style is the repo's own: `mentions.test.ts` already greps
 * `mention-flow.ts` for forbidden verbs, and `gabi.test.ts` reads `wrangler.toml`
 * rather than restating a constant. Both ideas appear here.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  GABI_DELEGATED_TIER,
  GABI_DELEGATED_VERBS,
  GABI_DELEGATED_VERB_NAMES,
  GABI_TOOLS,
  GABI_TOOL_NAMES,
  GABI_TOOL_TIER,
  MAX_TOOL_CALLS_PER_TURN,
  MAX_TOOL_ITERATIONS,
  gabiDelegatedVerbByName,
  gabiToolByName,
  isGabiDelegatedVerb,
  isGabiToolName,
  toolBook,
  toolsForApi,
} from '../src/gabi-tools.js';
import {
  CATALOG_MSG,
  COVERAGE_NOTE,
  DEFAULT_CATALOG_BASE,
  catalogBase,
  catalogUrl,
  factsFor,
  filterCatalog,
  fold,
  foldNoArticle,
  genreLeaf,
  knownUniverses,
  loadCatalog,
  metadataAsk,
  parseCatalogCsv,
  parseCsv,
  resetCatalogCache,
  searchCatalog,
  seriesVolumes,
  summarise,
  yearOf,
  type CatalogRow,
} from '../src/catalog-data.js';
import { runTool } from '../src/tool-exec.js';

function repoFile(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url).href), 'utf8');
}

const WRANGLER = repoFile('wrangler.toml');

/**
 * A fixture in the LIVE file's exact column order, taken from the real
 * `catalog.csv` header measured 2026-08-18. Two of the rows carry the real
 * values for The Way of Kings, because the owner's canonical question is the
 * acceptance test and a fixture that paraphrases it proves nothing.
 *
 * ⚠️ Note the embedded newline and the doubled quote inside `desc` on row 1:
 * that is what the live file does (1,080 records across 9,404 physical lines),
 * and a `split('\n')` parser silently mangles it.
 */
const CSV = [
  'title,series,series_index_display,series_index_sort,author,narrator,year,genre,duration_hhmm,cover_href,companion_files,desc,library_work_id,library_formats,universe,series_gap',
  '"The Way of Kings - The Stormlight Archive, Book 1",The Stormlight Archive,1,1.0,Brandon Sanderson,"Kate Reading, Michael Kramer",2010-08-31,Science Fiction & Fantasy:Fantasy:Action & Adventure,45:30,covers/x.jpg,,"A line,\nand a ""quoted"" second line.",,,The Cosmere,"Volumes 1-2, 2.5, 3 owned"',
  '"Words of Radiance - The Stormlight Archive, Book 2",The Stormlight Archive,2,2.0,Brandon Sanderson,"Kate Reading, Michael Kramer",2014-03-04,Science Fiction & Fantasy:Fantasy,48:13,covers/y.jpg,,Blurb.,,Hardcover|Ebook,The Cosmere,"Volumes 1-2, 2.5, 3 owned"',
  'Steelheart,The Reckoners,1,1.0,Brandon Sanderson,MacLeod Andrews,2013-09-24,Teen & Young Adult:Science Fiction,12:14,covers/z.jpg,,Blurb.,,,Reckoners,Volumes 1-3 owned',
  'A Book With No Narrator,,,,Someone Else,,2001,Fiction,03:00,covers/n.jpg,,Blurb.,,,,',
].join('\n');

const ROWS: CatalogRow[] = parseCatalogCsv(CSV);

/** A `fetch` that serves the fixture and counts how often it was asked. */
function csvFetch(state: { calls: number }, body = CSV, status = 200): typeof fetch {
  return (async () => {
    state.calls += 1;
    return new Response(body, { status, headers: { 'content-type': 'text/csv' } });
  }) as unknown as typeof fetch;
}

// ── 1. the allowlist and the definitions are one thing ──────────────────────

describe('the allowlist and the definitions are one thing', () => {
  it('every allowlisted name has exactly one definition', () => {
    for (const name of GABI_TOOL_NAMES) {
      const matches = GABI_TOOLS.filter((t) => t.name === name);
      assert.equal(matches.length, 1, `'${name}' has ${matches.length} definitions, expected 1`);
    }
  });

  it('no definition exists for a name that is not allowlisted', () => {
    for (const tool of GABI_TOOLS) {
      assert.ok(
        (GABI_TOOL_NAMES as readonly string[]).includes(tool.name),
        `'${tool.name}' has a definition but is not in GABI_TOOL_NAMES — the array is the allowlist`,
      );
    }
  });

  it('the two lists are the same length, so neither can quietly grow', () => {
    assert.equal(GABI_TOOLS.length, GABI_TOOL_NAMES.length);
  });

  it('the API shape carries only what the API takes — never our own fields', () => {
    for (const t of toolsForApi()) {
      assert.deepEqual(Object.keys(t).sort(), ['description', 'input_schema', 'name']);
    }
  });
});

// ── 2. ⚠️ READ-ONLY, and a write tool must fail this file ───────────────────

describe('⚠️ TIER 0 IS READ-ONLY — a write tool must fail this file', () => {
  it('declares itself tier 0', () => {
    assert.equal(GABI_TOOL_TIER, 0, 'the tier moved — the invariants below are tier-0 invariants');
  });

  it('no tool may mutate anything', () => {
    const writers = GABI_TOOLS.filter((t) => t.mutates).map((t) => t.name);
    assert.deepEqual(
      writers,
      [],
      `these declare mutates: ${writers.join(', ')}. ⚠️ A write path DOES exist from Discord ` +
        'since 2026-08-18 (Tier 1, owner-approved) — but it is not a TOOL and must never become ' +
        'one. The Tier-1 verbs are triggered by a checksummed ISBN or by a pattern, never by a ' +
        'model, and they live in their own allowlist (see the Tier-1 block below). A write here ' +
        'would hand the model the ability to add a book because it misread a sentence.',
    );
  });

  it('no tool may reach a method that can change anything', () => {
    for (const tool of GABI_TOOLS) {
      assert.deepEqual(
        [...tool.methods],
        ['GET'],
        `'${tool.name}' declares ${tool.methods.join('/')} — tier 0 issues GET and nothing else`,
      );
    }
  });

  it('every tool reads a PUBLIC surface, never a gated one', () => {
    for (const tool of GABI_TOOLS) {
      assert.equal(
        tool.reads,
        'public_audiobook_catalogue',
        `'${tool.name}' claims to read '${tool.reads}'. Catalogue METADATA is published to the ` +
          'open internet; ebook and audio FILE data is gated and needs the asker\'s Firebase ' +
          'identity, which this Worker cannot mint.',
      );
    }
  });

  it('⚠️ no write-shaped name is reachable, in any tier', () => {
    const NEVER = [
      'set_book_details', 'set_narrator', 'set_cover_from_url', 'update_book', 'add_book',
      'remove_book', 'delete_book', 'delete_work', 'record_gap_verdict', 'undo_changes',
      'set_user_role', 'grant_role', 'timeout_member', 'delete_message', 'export_catalog',
      'research_book', 'mark_cover_wrong', 'create_work', 'scan_shelf',
    ];
    for (const name of NEVER) {
      assert.equal(isGabiToolName(name), false, `'${name}' is reachable from a Discord conversation`);
      assert.equal(gabiToolByName(name), null);
    }
  });

  it('⚠️ no name in the allowlist even LOOKS write-shaped', () => {
    // Belt and braces against the list above going stale: a verb prefix nobody
    // enumerated is still a verb prefix.
    for (const name of GABI_TOOL_NAMES) {
      assert.doesNotMatch(
        name,
        /^(set|add|update|delete|remove|create|write|put|patch|post|grant|revoke|mark|record|undo|edit|rename|move|import|export)_/,
        `'${name}' is write-shaped. A tool that changes something is not a line in this array.`,
      );
    }
  });

  it('⚠️ the executor holds no credential and reaches no gated surface', () => {
    const source = repoFile('src/tool-exec.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const forbidden of [
      /firestoreRequest/,
      /mintAccessToken/,
      /parseServiceAccount/,
      /FIREBASE_SERVICE_ACCOUNT/,
      /DISCORD_BOT_TOKEN/,
      /editOriginalMessage/,
      /replyToMessage/,
      /ebook_files_manifest/,
      /\/api\/ebooks/,
      /method:\s*'(?:POST|PATCH|PUT|DELETE)'/,
    ]) {
      assert.doesNotMatch(source, forbidden, `tool-exec.ts now reaches for ${forbidden}`);
    }
  });

  it('⚠️ the catalogue reader sends no Authorization header — the absence IS the scope', () => {
    const source = repoFile('src/catalog-data.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /authorization/i, 'catalog-data.ts grew a credential');
    assert.doesNotMatch(source, /method:\s*'(?:POST|PATCH|PUT|DELETE)'/);
  });
});

// ── 2b. ⚠️ TIER 1 — the WRITE allowlist, and the wall between it and the model

describe('⚠️ TIER 1 — the delegated verbs are their own allowlist', () => {
  it('declares itself tier 1, and is exactly these FOUR verbs', () => {
    assert.equal(GABI_DELEGATED_TIER, 1);
    // ⚠️ Adding a row here is a design decision somebody makes on purpose, and
    // these names are the LIBRARY WORKER'S OWN ROUTE NAMES — the other end pins
    // the identical array (`DELEGATED_VERBS` in
    // library_catalog/apps/worker/src/routes/gabi-delegated.ts). Two
    // allowlists, two ends, neither a denylist.
    // ⚠️ `browse-works` joined 2026-08-19 — a READ, and the second entry that
    // changes nothing. It exists because the physical-suggestion lane could see
    // only the audiobook catalogue's cross-linked print rows and told the owner
    // his shelves looked empty when the print catalogue holds 448 works.
    assert.deepEqual(
      [...GABI_DELEGATED_VERB_NAMES],
      ['whoami', 'add-isbn', 'run-details', 'browse-works'],
    );
  });

  it('every name has a definition and every definition has a name', () => {
    assert.deepEqual(
      GABI_DELEGATED_VERBS.map((v) => v.name).sort(),
      [...GABI_DELEGATED_VERB_NAMES].sort(),
    );
    assert.equal(new Set(GABI_DELEGATED_VERBS.map((v) => v.name)).size, GABI_DELEGATED_VERBS.length);
  });

  it('⚠️ NO DELEGATED VERB IS EVER SHOWN TO THE MODEL — the wall between the tiers', () => {
    // The single most important line in this file since Tier 1 landed. A write
    // that a model may choose is a write that happens when a model misreads a
    // sentence; `toolsForApi()` is the ONLY thing handed to the Messages API,
    // and it must contain the read-only tools and nothing else.
    const offered = toolsForApi().map((t) => t.name);
    assert.deepEqual(offered, [...GABI_TOOL_NAMES]);
    for (const verb of GABI_DELEGATED_VERB_NAMES) {
      assert.ok(!offered.includes(verb as never), `'${verb}' is offered to the model`);
      assert.equal(isGabiToolName(verb), false, `'${verb}' leaked into the READ-ONLY allowlist`);
    }
    // …and the reverse: a read-only tool must not become a delegated verb.
    for (const tool of GABI_TOOL_NAMES) {
      assert.equal(isGabiDelegatedVerb(tool), false, `'${tool}' leaked into the WRITE allowlist`);
    }
  });

  it('each verb declares the capability its equivalent BUTTON needs', () => {
    // ⚠️ Recorded, not enforced — the enforcement is the destination site's own
    // `can(user.role, capability)`. Pinned here because a verb whose declared
    // capability drifts from the one the site checks is a document that lies
    // about what a person needs, which is how a refusal stops being actionable.
    assert.equal(gabiDelegatedVerbByName('add-isbn')?.requiredCapability, 'editCatalog');
    assert.equal(gabiDelegatedVerbByName('run-details')?.requiredCapability, 'runResearch');
    assert.equal(gabiDelegatedVerbByName('whoami')?.requiredCapability, 'none');
  });

  it('the NON-MUTATING verbs are the ones that read, and only POST is issued', () => {
    for (const verb of GABI_DELEGATED_VERBS) {
      assert.deepEqual([...verb.methods], ['POST']);
      // ⚠️ TWO readers now. `browse-works` lists the library's print shelf on
      // the asker's behalf and writes nothing — the assertion moves with the
      // decision rather than being deleted, so a WRITE that sneaks in
      // mis-declared still fails the build.
      const reads = verb.name === 'whoami' || verb.name === 'browse-works';
      assert.equal(verb.mutates, !reads, `'${verb.name}' mis-declares mutates`);
    }
    // Only the sweep spends money, and that is why it needs the higher rung.
    assert.deepEqual(GABI_DELEGATED_VERBS.filter((v) => v.spends).map((v) => v.name), ['run-details']);
  });

  it('⚠️ no T2/T3/T4 verb is reachable — the ladder is a wall, not a default', () => {
    const NEVER = [
      'set-author', 'edit-work', 'update-book', 'delete-book', 'remove-copy', 'merge-series',
      'set-cover', 'set-role', 'grant-role', 'revoke-access', 'approve-user', 'club-admin',
      'reset-club', 'kick-member', 'deploy', 'promote', 'rotate-secret', 'timeout', 'cleanup',
    ];
    for (const name of NEVER) {
      assert.equal(isGabiDelegatedVerb(name), false, `'${name}' is reachable from a Discord message`);
      assert.equal(gabiDelegatedVerbByName(name), null);
    }
    // Belt and braces against that list going stale.
    for (const name of GABI_DELEGATED_VERB_NAMES) {
      assert.doesNotMatch(
        name,
        /(delete|remove|revoke|grant|role|approve|deploy|promote|secret|kick|club|merge|edit|set)/,
        `'${name}' names a power above Tier 1`,
      );
    }
  });
});

// ── 3. default-deny means junk is refused, not coerced ──────────────────────

describe('default-deny means junk is refused, not coerced', () => {
  it('refuses the empty string, whitespace and case variants', () => {
    for (const junk of ['', ' ', 'CATALOG_LOOKUP', 'catalog_lookup ', ' catalog_lookup']) {
      assert.equal(isGabiToolName(junk), false, `'${junk}' was admitted`);
    }
  });

  it('refuses non-strings without throwing — the model can send anything', () => {
    for (const junk of [null, undefined, 42, {}, [], { name: 'catalog_lookup' }, true]) {
      assert.equal(isGabiToolName(junk), false);
      assert.equal(gabiToolByName(junk), null);
    }
  });

  it('refuses inherited Object keys — the classic allowlist hole', () => {
    for (const key of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.equal(isGabiToolName(key), false, `'${key}' got through`);
      assert.equal(gabiToolByName(key), null);
    }
  });

  it('⚠️ an unknown tool name performs NO I/O and comes back as an error', async () => {
    let called = 0;
    const out = await runTool(
      'delete_everything',
      { x: 1 },
      {
        catalogBaseUrl: 'https://example.invalid',
        fetchOverride: (async () => {
          called += 1;
          return new Response('', { status: 200 });
        }) as unknown as typeof fetch,
      },
    );
    assert.equal(called, 0, 'an unknown tool reached the network');
    assert.equal(out.isError, true);
    assert.match(JSON.stringify(out.result), /unknown_tool/);
  });
});

// ── 4. the schemas are shapes the API and the executor can both use ─────────

describe('the definitions are shapes the API and the executor can both use', () => {
  it('every schema is closed — additionalProperties: false, always', () => {
    for (const tool of GABI_TOOLS) {
      assert.equal(tool.input_schema.type, 'object');
      assert.equal(tool.input_schema.additionalProperties, false, `'${tool.name}' is open`);
    }
  });

  it('every required key is a declared property', () => {
    for (const tool of GABI_TOOLS) {
      for (const key of tool.input_schema.required) {
        assert.ok(key in tool.input_schema.properties, `'${tool.name}' requires undeclared '${key}'`);
      }
    }
  });

  it('every property carries a real description — the model reads these', () => {
    for (const tool of GABI_TOOLS) {
      for (const [key, prop] of Object.entries(tool.input_schema.properties)) {
        assert.ok(prop.description.length > 10, `'${tool.name}.${key}' has no real description`);
      }
    }
  });

  it('every description says WHEN to call, not just what the tool is', () => {
    for (const tool of GABI_TOOLS) {
      assert.match(tool.description, /call (this|it)/i, `'${tool.name}' never says when to reach for it`);
    }
  });

  it('⚠️ every description forbids answering from memory', () => {
    // The whole feature is worthless if she answers about the WORLD instead of
    // about the ESTATE, and a model that knows the answer will happily skip the
    // tool unless told not to.
    for (const tool of GABI_TOOLS) {
      assert.match(
        tool.description,
        /memory|never state|do not list/i,
        `'${tool.name}' does not tell the model to stop answering from its own knowledge`,
      );
    }
  });
});

// ── 5. the two ceilings ─────────────────────────────────────────────────────

describe('the loop terminates, and the bound is real', () => {
  it('the iteration cap is a small positive integer', () => {
    assert.ok(Number.isInteger(MAX_TOOL_ITERATIONS) && MAX_TOOL_ITERATIONS > 0);
    assert.ok(MAX_TOOL_ITERATIONS <= 5, 'a chat surface does not need a deep loop');
  });

  it('⚠️ the parallel-call cap exists too — an iteration cap alone bounds nothing', () => {
    // One assistant turn may emit several tool_use blocks; capping round trips
    // without capping calls is not a bound on work.
    assert.ok(Number.isInteger(MAX_TOOL_CALLS_PER_TURN) && MAX_TOOL_CALLS_PER_TURN > 0);
    assert.ok(
      MAX_TOOL_CALLS_PER_TURN >= 4,
      "the owner's own question names four things (Sanderson + three universes) and must fit in one iteration",
    );
  });

  it('⚠️ the LAST permitted request sends no tools, so the loop cannot end silent', () => {
    const source = repoFile('src/gabi-chat.ts').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(source, /const last = i === MAX_TOOL_ITERATIONS/);
    assert.match(source, /\.\.\.\(last \? \{\} : \{ tools/);
  });
});

// ── 6. the CSV parser, against what the live file actually does ─────────────

describe('the CSV parser handles what the live file actually contains', () => {
  it('⚠️ a newline inside a quoted field is not a new record', () => {
    // The live file: 1,080 records across 9,404 physical lines. A line-splitting
    // parser produces garbage rows here rather than failing.
    assert.equal(ROWS.length, 4, 'the embedded newline in desc split a record');
  });

  it('a doubled quote inside a quoted field is one quote', () => {
    const rows = parseCsv('a,b\n"say ""hi""",2');
    assert.equal(rows[1]?.[0], 'say "hi"');
  });

  it('reads columns BY NAME, so an inserted column cannot shift a narrator', () => {
    const shifted = parseCatalogCsv(
      'author,narrator,title\nBrandon Sanderson,Kate Reading,The Way of Kings',
    );
    assert.equal(shifted[0]?.narrator, 'Kate Reading');
    assert.equal(shifted[0]?.title, 'The Way of Kings');
  });

  it('a missing column is blank, never faked from a neighbour', () => {
    const noNarrator = parseCatalogCsv('title,author\nX,Y');
    assert.equal(noNarrator[0]?.narrator, '');
  });

  it('splits library_formats on the pipe the pipeline uses', () => {
    const wor = ROWS.find((r) => r.title.startsWith('Words of Radiance'));
    assert.deepEqual(wor?.libraryFormats, ['Hardcover', 'Ebook']);
  });
});

// ── 7. matching, and the owner's canonical question ─────────────────────────

describe("⚠️ the owner's canonical question: who narrates The Way of Kings?", () => {
  it('finds the book by the words a person actually types', () => {
    for (const q of ['Way of Kings', 'the way of kings', 'WAY OF KINGS', 'way of kings']) {
      const hit = searchCatalog(ROWS, q)[0];
      assert.ok(hit, `"${q}" found nothing`);
      assert.match(hit!.title, /^The Way of Kings/);
    }
  });

  it('and the narrator is the catalogue\'s, both of them', () => {
    const hit = searchCatalog(ROWS, 'Way of Kings')[0];
    assert.equal(hit?.narrator, 'Kate Reading, Michael Kramer');
  });

  it('the no-model router recognises the question and pulls the title out', () => {
    for (const q of [
      "who's the narrator of Way of Kings?",
      'who narrates The Way of Kings',
      'who reads Way of Kings',
      'is Way of Kings narrated by anyone good',
    ]) {
      const ask = metadataAsk(q);
      assert.ok(ask, `"${q}" was not recognised as a metadata question`);
      assert.equal(ask.field, 'narrator', `"${q}" was read as ${ask.field}`);
      assert.ok(searchCatalog(ROWS, ask.term)[0]?.title.startsWith('The Way of Kings'), `term "${ask.term}" missed`);
    }
  });

  it('a duration question is a duration question, even when it names a narrator', () => {
    const ask = metadataAsk('how long is Way of Kings, the one narrated by Kate Reading?');
    assert.equal(ask?.field, 'duration');
  });

  it('⚠️ an ordinary question is NOT a metadata question — the default is null', () => {
    for (const q of ['what can you do?', 'hello', 'do we have Mistborn?', 'fix the author on Steelheart']) {
      assert.equal(metadataAsk(q), null, `"${q}" was mistaken for a metadata question`);
    }
  });

  it('ranks the exact title above a longer one that contains it', () => {
    const rows = parseCatalogCsv(
      'title,author,narrator\nMistborn: Secret History,B,N\nMistborn,B,N',
    );
    assert.equal(searchCatalog(rows, 'Mistborn')[0]?.title, 'Mistborn');
  });

  it('searches author and narrator too, and honours an explicit field', () => {
    assert.equal(searchCatalog(ROWS, 'MacLeod Andrews')[0]?.title, 'Steelheart');
    assert.equal(searchCatalog(ROWS, 'Sanderson', 'narrator').length, 0, 'author leaked into a narrator search');
  });

  it('folds a leading article away in both directions', () => {
    assert.equal(foldNoArticle('The Stormlight Archive'), fold('Stormlight Archive'));
  });
});

// ── 8. ⚠️ she never invents a fact ──────────────────────────────────────────

describe('⚠️ an absent field is said out loud, never filled in', () => {
  it('omits keys the catalogue does not record, rather than nulling them', () => {
    const bare = ROWS.find((r) => r.title === 'A Book With No Narrator');
    assert.ok(bare);
    const book = toolBook(bare);
    assert.equal('narrator' in book, false, 'an empty narrator reached the model as a key it can fill');
    assert.equal('series' in book, false);
    assert.equal(book.title, 'A Book With No Narrator');
  });

  it('renders no phantom facts into a Discord line', () => {
    const bare = ROWS.find((r) => r.title === 'A Book With No Narrator')!;
    const facts = factsFor(bare);
    assert.doesNotMatch(facts, /narrated by/);
    assert.doesNotMatch(facts, /unknown|n\/a|null/i);
  });

  it('has a worded sentence for "the book is here, the field is not"', () => {
    const said = CATALOG_MSG.missingField('narrator', 'A Book With No Narrator');
    assert.match(said, /doesn't record a narrator/);
    assert.match(said, /making one up/, 'the refusal to guess is not stated');
  });

  it('⚠️ an absence is a statement about the CATALOGUE, never about the house', () => {
    assert.match(CATALOG_MSG.none('Dune'), /statement about the \*\*catalogue\*\*/);
    assert.match(CATALOG_MSG.none('Dune'), /scanned/);
    assert.doesNotMatch(CATALOG_MSG.none('Dune'), /you (?:do not|don't) own/i);
  });

  it('⚠️ an outage is never phrased as an answer about the book', () => {
    assert.match(CATALOG_MSG.unreachable, /problem on our side/);
    assert.match(CATALOG_MSG.unreachable, /not an answer about the book/);
  });

  it('trims the genre path to its leaf and the release date to a year', () => {
    assert.equal(genreLeaf('Science Fiction & Fantasy:Fantasy:Action & Adventure'), 'Action & Adventure');
    assert.equal(yearOf('2010-08-31'), '2010');
    assert.equal(yearOf(''), '');
  });
});

// ── 9. series ───────────────────────────────────────────────────────────────

describe('series_volumes puts a series in reading order', () => {
  it('orders by the sort key, not by the title', () => {
    const found = seriesVolumes(ROWS, 'Stormlight Archive');
    assert.ok(found);
    assert.deepEqual(
      found.volumes.map((v) => v.seriesIndex),
      ['1', '2'],
    );
  });

  it('passes the pipeline\'s own owned/gap sentence through verbatim', () => {
    const found = seriesVolumes(ROWS, 'The Stormlight Archive');
    assert.equal(found?.gap, 'Volumes 1-2, 2.5, 3 owned');
  });

  it('⚠️ accepts a BOOK title, because that is often all somebody has', () => {
    const found = seriesVolumes(ROWS, 'Words of Radiance');
    assert.equal(found?.series, 'The Stormlight Archive');
    assert.equal(found?.volumes.length, 2);
  });

  it('answers null for a series the shelf does not hold', () => {
    assert.equal(seriesVolumes(ROWS, 'The Wheel of Time'), null);
  });
});

// ── 10. ⚠️ counting, and the coverage sentence that must ride with it ───────

describe("⚠️ the owner's four-part question: counting, honestly", () => {
  it('counts an author across the shelf and breaks it down by universe', () => {
    const matches = filterCatalog(ROWS, { query: 'Brandon Sanderson', field: 'author' });
    const s = summarise(matches);
    assert.equal(s.total, 3);
    assert.deepEqual(s.byUniverse, [
      { universe: 'The Cosmere', count: 2 },
      { universe: 'Reckoners', count: 1 },
    ]);
    assert.equal(s.alsoInPrintOrEbook, 1, 'the library print/ebook join was miscounted');
  });

  it('filters by universe with the article folded away', () => {
    for (const u of ['The Cosmere', 'cosmere', 'COSMERE']) {
      assert.equal(filterCatalog(ROWS, { universe: u }).length, 2, `universe "${u}" did not match`);
    }
  });

  it('⚠️ "not a universe we record" is a DIFFERENT answer from "zero matches"', async () => {
    const state = { calls: 0 };
    resetCatalogCache();
    const out = await runTool(
      'catalog_lookup',
      { universe: 'Wheel of Time', mode: 'count' },
      { catalogBaseUrl: 'https://catalog.test', fetchOverride: csvFetch(state) },
    );
    const body = out.result as Record<string, unknown>;
    assert.equal(out.isError, false);
    assert.equal(body.universe_not_recorded, 'Wheel of Time');
    assert.ok(Array.isArray(body.universes_the_estate_records));
    // Measured on the live shelf 2026-08-18: 16 universes, and Wheel of Time is
    // not one of them, and there are zero Robert Jordan rows. The model has to
    // be able to say that instead of reporting a count somebody will read as a
    // claim about the house.
    assert.match(String(body.note), /not one of the fictional universes/);
    resetCatalogCache();
  });

  it('⚠️ EVERY successful result carries the coverage sentence', async () => {
    resetCatalogCache();
    const state = { calls: 0 };
    const ctx = { catalogBaseUrl: 'https://catalog.test', fetchOverride: csvFetch(state) };
    for (const [tool, input] of [
      ['catalog_lookup', { query: 'Sanderson', field: 'author', mode: 'count' }],
      ['catalog_lookup', { query: 'Way of Kings' }],
      ['catalog_lookup', { query: 'nothing at all matches this' }],
      ['series_volumes', { series: 'Stormlight' }],
      ['series_volumes', { series: 'A Series That Does Not Exist' }],
    ] as const) {
      const out = await runTool(tool, input, ctx);
      const body = JSON.stringify(out.result);
      assert.match(body, /AUDIOBOOK shelf only/, `${tool} dropped the coverage sentence`);
    }
    resetCatalogCache();
  });

  it('the coverage sentence names both unreachable shelves and why', () => {
    assert.match(COVERAGE_NOTE, /library and board-game catalogues are not reachable/);
    assert.match(COVERAGE_NOTE, /Firebase sign-in/);
    assert.match(COVERAGE_NOTE, /never an estate-wide total/);
  });

  it('a count reports the TRUE total, never the truncated list length', async () => {
    resetCatalogCache();
    const state = { calls: 0 };
    const out = await runTool(
      'catalog_lookup',
      { query: 'Sanderson', field: 'author' },
      { catalogBaseUrl: 'https://catalog.test', fetchOverride: csvFetch(state) },
    );
    const body = out.result as Record<string, unknown>;
    assert.equal(body.total_matches, 3);
    resetCatalogCache();
  });

  it('lists the shelf\'s real universes with counts', () => {
    assert.deepEqual(knownUniverses(ROWS), [
      { universe: 'The Cosmere', count: 2 },
      { universe: 'Reckoners', count: 1 },
    ]);
  });
});

// ── 11. loading: memoised, bounded, and honest about failure ────────────────

describe('the catalogue is fetched once and failures are not cached', () => {
  it('⚠️ parses once per isolate, not once per turn', async () => {
    resetCatalogCache();
    const state = { calls: 0 };
    const f = csvFetch(state);
    await loadCatalog('https://catalog.test', { fetch: f });
    await loadCatalog('https://catalog.test', { fetch: f });
    await loadCatalog('https://catalog.test', { fetch: f });
    assert.equal(state.calls, 1, '1.4 MB was fetched more than once for three turns');
    resetCatalogCache();
  });

  it('⚠️ a failed fetch is NOT cached — an outage must not last half an hour', async () => {
    resetCatalogCache();
    const state = { calls: 0 };
    const dead = csvFetch(state, 'nope', 503);
    const first = await loadCatalog('https://catalog.test', { fetch: dead });
    assert.equal(first.ok, false);
    await loadCatalog('https://catalog.test', { fetch: dead });
    assert.equal(state.calls, 2, 'a 503 was memoised');
    resetCatalogCache();
  });

  it('⚠️ zero rows is a failed publish, not an empty estate', async () => {
    resetCatalogCache();
    const state = { calls: 0 };
    const empty = csvFetch(state, 'title,author\n');
    const load = await loadCatalog('https://catalog.test', { fetch: empty });
    assert.equal(load.ok, false);
    if (!load.ok) assert.equal(load.reason, 'unparseable');
    resetCatalogCache();
  });

  it('⚠️ an outage reaches the model as is_error, never as "we do not have it"', async () => {
    resetCatalogCache();
    const state = { calls: 0 };
    const out = await runTool(
      'catalog_lookup',
      { query: 'Way of Kings' },
      { catalogBaseUrl: 'https://catalog.test', fetchOverride: csvFetch(state, '', 500) },
    );
    assert.equal(out.isError, true, 'an outage was reported as a normal empty result');
    assert.match(JSON.stringify(out.result), /says NOTHING about whether the estate holds the book/);
    resetCatalogCache();
  });
});

// ── 12. the posture var, pinned to wrangler.toml ────────────────────────────

describe('the catalogue host is declared, not hardcoded in a call site', () => {
  it('wrangler.toml declares CATALOG_BASE_URL', () => {
    assert.match(WRANGLER, /^\s*CATALOG_BASE_URL\s*=\s*"https:\/\/audiobooks\.heygabi\.ai"/m);
  });

  it('the code default matches the declared value, so an unset var is not a new host', () => {
    const declared = WRANGLER.match(/^\s*CATALOG_BASE_URL\s*=\s*"([^"]+)"/m);
    assert.ok(declared);
    assert.equal(catalogBase({}), DEFAULT_CATALOG_BASE);
    assert.equal(declared?.[1], DEFAULT_CATALOG_BASE);
  });

  it('an explicit var wins, so a test lane can point elsewhere', () => {
    assert.equal(catalogBase({ CATALOG_BASE_URL: 'https://elsewhere.test' }), 'https://elsewhere.test');
    assert.equal(catalogBase({ CATALOG_BASE_URL: '   ' }), DEFAULT_CATALOG_BASE);
  });

  it('the URL it builds is the published CSV', () => {
    assert.equal(catalogUrl(DEFAULT_CATALOG_BASE), 'https://audiobooks.heygabi.ai/catalog.csv');
  });
});
