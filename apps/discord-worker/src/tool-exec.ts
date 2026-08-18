/**
 * Running one allowlisted tool call. **Default-deny, never throws, and it has
 * nothing dangerous in scope to reach for.**
 *
 * ## The security model is what this file cannot import
 *
 * There is no Firestore client here, no `mintAccessToken`, no bot token, no
 * `editOriginalMessage`, no `fetch` to anything but the public catalogue. A
 * model that hallucinates `delete_book` gets `unknown_tool`; a model that
 * hallucinates an argument gets it ignored by a closed schema. The guard is
 * structural, and `test/gabi-tools.test.ts` reads this file's own source to
 * assert the dangerous names stay absent — the same instrument
 * `test/mentions.test.ts` already points at `mention-flow.ts`.
 *
 * ⚠️ **THE ESTATE DOCS CORPUS IS GATED, AND THIS FILE STILL HOLDS NO
 * CREDENTIAL — the two are reconciled by an INJECTED PORT.** Tier 0b (added
 * 2026-08-18) reads material that is emphatically not public: break-glass SQL,
 * deploy levers, secret names, household members' emails and role assignments.
 * The sentence above therefore stays literally true — no `fetch` in this file
 * reaches anything but `catalog.csv` — because the corpus is reached through
 * `ctx.docs.port`, an interface this file cannot construct, whose only
 * implementation (`estate-docs-exec.ts`) holds the bearer. What changed is the
 * SCOPE of the claim, and it is narrowed rather than dropped:
 *
 * > This file names no secret and opens no gated connection. It hands an
 * > injected port an email it did not choose, and the AUTH WORKER decides.
 *
 * ⚠️ And the decision genuinely is not here. A non-devops asker's question
 * reaches the auth Worker, is refused 403 there, and comes back as a worded
 * `tool_result` — GABI never sees a byte of corpus on their behalf, and that is
 * a property of the other end rather than of a check this file could forget.
 *
 * ## ⚠️ A FAILED TOOL IS REPORTED, NEVER FAKED
 *
 * Every failure comes back as a `tool_result` with `is_error: true` and a
 * sentence saying what happened. The alternative — returning an empty result
 * set when the fetch failed — teaches the model that "the catalogue is
 * unreachable" and "the catalogue does not have it" are the same fact. They are
 * the opposite fact, and telling somebody the estate does not own a book it
 * does own is the single worst thing this surface can do.
 */

import {
  CATALOG_MSG,
  COVERAGE_NOTE,
  filterCatalog,
  isLookupField,
  knownUniverses,
  loadCatalog,
  MAX_LOOKUP_HITS,
  seriesVolumes,
  summarise,
  type CatalogLoad,
  type LookupField,
} from './catalog-data.js';
import {
  gabiBooksToolByName,
  gabiDocsToolByName,
  gabiToolByName,
  isGabiBooksToolName,
  isGabiDocsToolName,
  isGabiToolName,
  toolBook,
  type GabiBooksToolName,
  type GabiDocsToolName,
  type GabiToolName,
} from './gabi-tools.js';
import {
  DOCS_MSG,
  DOCS_SEARCH_HITS,
  identityMessage,
  snapshotNote,
  type DocsSnapshotMeta,
  type DocsToolContext,
} from './estate-docs.js';
import {
  BOOKS_LIST_LIMIT,
  BOOKS_MSG,
  BOOKS_PRESENCE_MAX,
  BOOKS_SEARCH_HITS,
  booksIdentityMessage,
  boundParams,
  looksLikeStatQuery,
  type BooksToolContext,
} from './book-knowledge.js';

export interface ToolContext {
  catalogBaseUrl: string;
  /** Test seam: the same shape `chatClient` takes, for the same reason. */
  fetchOverride?: typeof fetch;
  /**
   * ⚠️ **TIER 0b — the estate docs corpus, and it is OPTIONAL BY DESIGN.**
   *
   * Absent means this surface cannot read the docs at all — which is the state
   * of every caller that has not been given one, the state while `GABI_DOCS` is
   * off, and the state while the app token is unset. It is an injected context
   * rather than an import so that THIS FILE holds no credential: the port's
   * implementation (`estate-docs-exec.ts`) is the only module here that names a
   * service account or an app bearer, and `test/estate-docs.test.ts` reads
   * these sources and fails the build if that changes.
   *
   * ⚠️ It carries the asker and the per-TURN budget, so no tool call can ask on
   * somebody else's behalf and no tool call can escape the turn's ceiling by
   * being the fourth one.
   */
  docs?: DocsToolContext;
  /**
   * ⚠️ **TIER 0c — the household's own book TEXT, OPTIONAL BY DESIGN and for the
   * same reasons `docs` is.**
   *
   * Absent means this surface cannot read a book's text at all — the state of
   * every caller that has not been given one, of production while `GABI_BOOKS`
   * is off, and of production while the book app token is unset. The port's only
   * implementation (`book-knowledge-exec.ts`) is the third and last module here
   * that names a credential, and `test/book-knowledge.test.ts` reads these
   * sources and fails the build if that changes.
   *
   * ⚠️ It carries the asker, the per-TURN budget **and the bound derived from
   * THIS turn's question**, so no tool call can read on somebody else's behalf,
   * none can escape the turn's ceiling by being the fourth, and none can be
   * handed a spoiler scope from an earlier turn.
   */
  books?: BooksToolContext;
}

/** What one executed call produced. `isError` becomes the `tool_result` block's
 * `is_error`, which is how the model learns the difference between "nothing
 * matched" and "the lookup did not happen". */
export interface ToolOutcome {
  name: string;
  isError: boolean;
  /** Serialised as JSON into the `tool_result` block. */
  result: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** How many books a `list` result carries. More than this and the model spends
 * its output budget reciting a table nobody asked for; the TOTAL is always
 * reported truthfully beside it. */
export const MAX_TOOL_BOOKS = MAX_LOOKUP_HITS;

/** How many volumes a series result carries. Higher than a lookup's: somebody
 * asking about a series wants the series. */
export const MAX_TOOL_VOLUMES = 30;

function loadFailure(name: string, load: Extract<CatalogLoad, { ok: false }>): ToolOutcome {
  return {
    name,
    isError: true,
    result: {
      error: 'catalogue_unavailable',
      reason: load.reason,
      status: load.status,
      // ⚠️ Worded, because this string can reach a channel through the model.
      say: CATALOG_MSG.unreachable,
      note: 'This is an outage on the estate side. It says NOTHING about whether the estate holds the book — do not answer as if the catalogue came back empty.',
    },
  };
}

/**
 * Execute one allowlisted call.
 *
 * ⚠️ The name is checked against `GABI_TOOL_NAMES` **before** anything else
 * happens, and an unknown name performs no I/O at all.
 */
export async function runTool(
  name: unknown,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const label = typeof name === 'string' ? name : String(name);
  const isDocs = isGabiDocsToolName(name) && Boolean(gabiDocsToolByName(name));
  const isBooks = isGabiBooksToolName(name) && Boolean(gabiBooksToolByName(name));
  if (!isDocs && !isBooks && (!isGabiToolName(name) || !gabiToolByName(name))) {
    return {
      name: label,
      isError: true,
      result: {
        error: 'unknown_tool',
        allowed:
          'catalog_lookup, series_volumes, search_estate_docs, read_estate_doc, ' +
          'list_book_knowledge, search_book_text, read_book_passage, book_presence',
        note: 'That tool does not exist on this surface. Nothing was run.',
      },
    };
  }
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    if (isDocs) return await runDocsTool(name as GabiDocsToolName, args, ctx);
    if (isBooks) return await runBooksTool(name as GabiBooksToolName, args, ctx);
    switch (name as GabiToolName) {
      case 'catalog_lookup':
        return await catalogLookup(args, ctx);
      case 'series_volumes':
        return await seriesLookup(args, ctx);
    }
  } catch (err) {
    console.error(`GABI tools: ${label} failed:`, err instanceof Error ? err.message : err);
    return {
      name: label,
      isError: true,
      result: { error: 'tool_failed', say: CATALOG_MSG.unreachable },
    };
  }
}

// ---------------------------------------------------------------------------
// catalog_lookup
// ---------------------------------------------------------------------------

async function catalogLookup(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const name = 'catalog_lookup';
  const query = str(args.query);
  const universe = str(args.universe);
  const field: LookupField = isLookupField(args.field) ? args.field : 'any';
  const mode = str(args.mode) === 'count' ? 'count' : 'list';

  if (!query && !universe) {
    return {
      name,
      isError: true,
      result: {
        error: 'nothing_to_search',
        note: 'Give a query (a title, author or narrator) or a universe, or both. Nothing was searched.',
      },
    };
  }

  const load = await loadCatalog(ctx.catalogBaseUrl, ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined);
  if (!load.ok) return loadFailure(name, load);

  // ⚠️ A universe the estate does not record is a DIFFERENT answer from a
  // universe with no matches, and conflating them is how "we own no Wheel of
  // Time" becomes a claim about the house. Measured 2026-08-18: the shared list
  // holds 16 universes and Wheel of Time is not one of them.
  const known = knownUniverses(load.rows);
  if (universe && !known.some((u) => u.universe.toLowerCase().replace(/^the /, '') === universe.toLowerCase().replace(/^the /, ''))) {
    return {
      name,
      isError: false,
      result: {
        shelf: 'estate audiobook shelf',
        filters: { query: query || undefined, field, universe, mode },
        universe_not_recorded: universe,
        universes_the_estate_records: known,
        total_matches: 0,
        coverage: COVERAGE_NOTE,
        note:
          `"${universe}" is not one of the fictional universes the estate's shared list records, so ` +
          'there is nothing filed under it. Say that plainly — it is not the same as the estate ' +
          'owning none of those books, and any book from it would simply be filed under its own ' +
          'series instead. You can search for the author or the series by name instead.',
      },
    };
  }

  const matches = filterCatalog(load.rows, {
    ...(query ? { query } : {}),
    field,
    ...(universe ? { universe } : {}),
  });
  const summary = summarise(matches);

  if (matches.length === 0) {
    return {
      name,
      isError: false,
      result: {
        shelf: 'estate audiobook shelf',
        filters: { query: query || undefined, field, universe: universe || undefined, mode },
        total_matches: 0,
        coverage: COVERAGE_NOTE,
        say: CATALOG_MSG.none(query || universe),
        note: 'Nothing matched. That is a statement about this CATALOGUE, never about the house — say so.',
      },
    };
  }

  const base = {
    shelf: 'estate audiobook shelf',
    filters: { query: query || undefined, field, universe: universe || undefined, mode },
    total_matches: summary.total,
    also_in_print_or_ebook: summary.alsoInPrintOrEbook,
    by_universe: summary.byUniverse,
    distinct_authors: summary.distinctAuthors,
    distinct_series: summary.distinctSeries,
    coverage: COVERAGE_NOTE,
  };

  if (mode === 'count') {
    return {
      name,
      isError: false,
      result: {
        ...base,
        note:
          'Give the number WITH its breakdown and the coverage sentence — never a bare total. ' +
          'The by_universe bucket "(none)" means those books are not filed under any universe, ' +
          'not that a universe is missing.',
      },
    };
  }

  const shown = matches.slice(0, MAX_TOOL_BOOKS);
  return {
    name,
    isError: false,
    result: {
      ...base,
      books: shown.map(toolBook),
      shown: shown.length,
      note:
        shown.length < summary.total
          ? `Showing the closest ${shown.length} of ${summary.total}. Say the total, do not imply the list is everything.`
          : 'This is every match. A field that is absent from a book is one the catalogue does not record — say so rather than filling it in.',
    },
  };
}

// ---------------------------------------------------------------------------
// series_volumes
// ---------------------------------------------------------------------------

async function seriesLookup(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome> {
  const name = 'series_volumes';
  const series = str(args.series);
  if (!series) {
    return {
      name,
      isError: true,
      result: { error: 'nothing_to_search', note: 'Give a series name or a book from it.' },
    };
  }

  const load = await loadCatalog(ctx.catalogBaseUrl, ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined);
  if (!load.ok) return loadFailure(name, load);

  const found = seriesVolumes(load.rows, series);
  if (!found) {
    return {
      name,
      isError: false,
      result: {
        shelf: 'estate audiobook shelf',
        asked_for: series,
        volumes: [],
        coverage: COVERAGE_NOTE,
        say: CATALOG_MSG.seriesNone(series),
        note: 'No series matched. A statement about the CATALOGUE, never about the house.',
      },
    };
  }

  const shown = found.volumes.slice(0, MAX_TOOL_VOLUMES);
  return {
    name,
    isError: false,
    result: {
      shelf: 'estate audiobook shelf',
      series: found.series,
      universe: found.universe || undefined,
      // ⚠️ The pipeline's OWN gap sentence, passed through verbatim. It is the
      // only authoritative statement anywhere about which volumes the estate
      // holds, and re-deriving it here would be a second implementation of a
      // fact that already has one.
      volumes_owned: found.gap || undefined,
      volume_count: found.volumes.length,
      volumes: shown.map(toolBook),
      shown: shown.length,
      coverage: COVERAGE_NOTE,
      note:
        'The volumes are in reading order. "volumes_owned" is the catalogue\'s own summary of ' +
        'which numbers the estate holds — quote it rather than inferring gaps from the list, and ' +
        'never say a missing number means the house does not own that book.',
    },
  };
}

// ---------------------------------------------------------------------------
// TIER 0b — the estate docs corpus
//
// ⚠️ EVERY REFUSAL IN HERE IS WORDED AND CARRIES `isError: true`. The model
// relays the sentence; the person never sees a bare status. And the four
// distinct causes stay four distinct sentences all the way to the channel,
// because the FIXES differ — run /link, re-run /link, ask an approver, wait a
// minute. Collapsing them is how an outage becomes "you don't have access".
// ---------------------------------------------------------------------------

/** Refused before any I/O, in the model's own tool-result shape. */
function docsRefusal(name: string, error: string, say: string, note?: string): ToolOutcome {
  return {
    name,
    isError: true,
    result: {
      error,
      // ⚠️ `say` is relayed to a person through the model, so it is a sentence
      // and not a code. Every branch below supplies one.
      say,
      ...(note ? { note } : {}),
    },
  };
}

/**
 * Run one docs tool on the ASKER'S behalf.
 *
 * ⚠️ **THE ORDER OF THESE CHECKS IS THE DESIGN.** Cheapest and most local
 * first, so a switched-off posture or a spent budget costs no subrequest and no
 * Firestore read; identity next, because it is one read and it decides three of
 * the four refusals; the corpus call last, because only the auth Worker can
 * decide the fourth.
 */
async function runDocsTool(
  name: GabiDocsToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const docs = ctx.docs;

  // 1. This surface has no docs port at all — a lane that never had one (a
  //    test), or production with the posture off or the token unset. Never
  //    phrased as a permissions problem.
  if (!docs) {
    return docsRefusal(name, 'docs_not_available', DOCS_MSG.notConfigured);
  }

  // 2. The daily fuse, read once before the turn. ⚠️ A capped person is TOLD it
  //    is a cap on our side and not something they did.
  if (docs.capped) {
    return docsRefusal(name, 'docs_capped', DOCS_MSG.capped);
  }

  // 3. The per-turn ceiling, checked before spending a subrequest on a result
  //    there is no room to return.
  if (!docs.budget.take(0, 0)) {
    return docsRefusal(name, 'docs_turn_budget_spent', DOCS_MSG.turnBudgetSpent);
  }

  // 4. Who is asking, on the estate. One memoised read per turn.
  const who = await docs.port.askerEmail(docs.discordUserId);
  if (!who.ok) {
    return docsRefusal(
      name,
      `docs_identity_${who.reason}`,
      identityMessage(who.reason),
      who.reason === 'outage'
        ? 'This is an outage on the estate side. It says NOTHING about whether this person may read the docs — do not answer as if they were refused.'
        : 'This is about the /link ceremony, not about permissions. Relay the sentence as it is.',
    );
  }

  const call =
    name === 'search_estate_docs'
      ? await docs.port.search(who.email, str(args.query), DOCS_SEARCH_HITS)
      : await docs.port.section(who.email, str(args.id));

  // 5. The auth Worker refused, or could not answer. ⚠️ Its own `detail` is
  //    relayed VERBATIM — it is the authority, so it is the only thing that can
  //    honestly say why, and a sentence written here would be a second copy of
  //    a decision that already has one.
  if (!call.ok) {
    return docsRefusal(
      name,
      call.status === 403 ? 'docs_not_devops' : call.status === 0 ? 'docs_unreachable' : 'docs_refused',
      call.message ?? DOCS_MSG.estateUnreachable,
      call.status >= 500 || call.status === 0
        ? 'An outage on our side. Say so — it is NOT a statement about this person’s access.'
        : 'The estate refused this read. Relay the sentence exactly; do not soften it, and do not offer to look anyway.',
    );
  }

  const body = call.body ?? {};
  const snapshot = (body.snapshot ?? null) as DocsSnapshotMeta | null;
  const freshness = snapshotNote(snapshot);

  if (name === 'search_estate_docs') {
    const results = Array.isArray(body.results) ? body.results : [];
    const shaped = results.map((r) => {
      const hit = r as Record<string, unknown>;
      return {
        id: hit.id,
        repo: hit.repo,
        path: hit.path,
        heading: hit.heading,
        snippet: hit.snippet,
      };
    });
    // ⚠️ Charged AFTER the call and BEFORE the model sees it. A result that does
    // not fit is refused rather than trimmed: a silently truncated runbook is a
    // runbook missing the step that mattered.
    const bytes = JSON.stringify(shaped).length;
    if (!docs.budget.take(bytes, 0)) {
      return docsRefusal(name, 'docs_turn_budget_spent', DOCS_MSG.turnBudgetSpent);
    }
    return {
      name,
      isError: false,
      result: {
        corpus: 'the estate’s internal docs',
        snapshot,
        // ⚠️ EVERY ANSWER CARRIES THE PUBLISH DATE (design §6). It rides in the
        // result rather than the prompt so that dropping it is a visible defect.
        freshness,
        query: str(args.query) || undefined,
        matched: body.matched,
        count: shaped.length,
        total: body.total,
        results: shaped,
        note:
          shaped.length === 0
            ? 'Nothing matched. ⚠️ That is a statement about the DOCS, never about the estate — say the docs do not cover it rather than answering from your own knowledge. ' +
              freshness
            : 'These are SNIPPETS, not the whole section. If one looks like the answer, call read_estate_doc with its id before stating any command, path or step. ' +
              'Name the file you are quoting so somebody can check you. ' +
              freshness,
      },
    };
  }

  const section = (body.section ?? {}) as Record<string, unknown>;
  const text = typeof section.text === 'string' ? section.text : '';
  const bytes = text.length;
  if (!docs.budget.take(bytes, 1)) {
    return docsRefusal(
      name,
      'docs_turn_budget_spent',
      DOCS_MSG.turnBudgetSpent,
      'The section was NOT read — do not summarise it from the snippet as though you had.',
    );
  }
  return {
    name,
    isError: false,
    result: {
      corpus: 'the estate’s internal docs',
      snapshot,
      freshness,
      id: section.id,
      repo: section.repo,
      path: section.path,
      title: section.title,
      heading: section.heading,
      text,
      truncated: section.truncated === true || undefined,
      note:
        'Quote what this section actually says. ⚠️ If it does not give the command, the path or the ' +
        'step being asked for, say so — do not fill the gap from your own knowledge, because a ' +
        'plausible command that is not in the runbook is worse than no command. ' +
        `Name the file (${String(section.path ?? 'the source')}) so somebody can check you. ` +
        freshness,
    },
  };
}

// ---------------------------------------------------------------------------
// TIER 0c — the household's own book TEXT
//
// ⚠️ EVERY REFUSAL IN HERE IS WORDED AND CARRIES `isError: true`, and the causes
// stay distinct all the way to the channel because the FIXES differ. Two of them
// are the whole reason this feature exists:
//
//   • "not in my knowledge base yet"  ≠  "that doesn't happen in the book"
//   • "past where you are"            ≠  "not in the book"
//
// Collapsing either is how a confident wrong answer gets said about a book
// nobody has processed, or a plot point gets spoiled by a feature built to help
// somebody enjoy it.
// ---------------------------------------------------------------------------

/** Refused before any I/O, in the model's own tool-result shape. */
function booksRefusal(name: string, error: string, say: string, note?: string): ToolOutcome {
  return { name, isError: true, result: { error, say, ...(note ? { note } : {}) } };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** ⚠️ The mode is validated HERE as well as at the route. A model that invents
 *  `mode: "last"` should get a sentence naming the four, not a 400 it has to
 *  guess at — and the four are four different questions (design §6.2). */
const BOOK_MODES = ['relevant', 'latest', 'earliest', 'presence'] as const;

/**
 * Run one book tool on the ASKER'S behalf.
 *
 * ⚠️ **THE ORDER OF THESE CHECKS IS THE DESIGN**, the same order `runDocsTool`
 * uses and for the same reason: cheapest and most local first, so a switched-off
 * posture or a spent budget costs no subrequest and no Firestore read; identity
 * next, because it is one memoised read and decides three of the refusals; the
 * gated call last, because only the audiobook Worker can decide `vis_ebooks`.
 */
async function runBooksTool(
  name: GabiBooksToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const books = ctx.books;

  // 1. No port at all — a test, or production with the posture off or the token
  //    unset. ⚠️ Never phrased as a permissions problem.
  if (!books) return booksRefusal(name, 'books_not_available', BOOKS_MSG.notConfigured);

  // 2. The fourth daily fuse, read once before the turn.
  if (books.capped) return booksRefusal(name, 'books_capped', BOOKS_MSG.capped);

  // 3. The per-turn ceiling, checked before spending a subrequest on a result
  //    there is no room to return.
  if (!books.budget.take(0, 0)) {
    return booksRefusal(name, 'books_turn_budget_spent', BOOKS_MSG.turnBudgetSpent);
  }

  // 4. Who is asking, on the estate. One memoised read per turn.
  const who = await books.port.askerEmail(books.discordUserId);
  if (!who.ok) {
    return booksRefusal(
      name,
      `books_identity_${who.reason}`,
      booksIdentityMessage(who.reason),
      who.reason === 'outage'
        ? 'This is an outage on the estate side. It says NOTHING about whether this person may read the household’s books — do not answer as if they were refused.'
        : 'This is about the /link ceremony, not about permissions. Relay the sentence as it is.',
    );
  }

  if (name === 'list_book_knowledge') return await listKnowledge(books, who.email, args);
  if (name === 'book_presence') return await presenceAcross(books, who.email, args);
  if (name === 'read_book_passage') return await readPassage(books, who.email, args);
  return await searchBook(books, who.email, args);
}

/** ⚠️ The gated call's own failure, relayed. The audiobook Worker's `detail` is
 *  the authority — it is the only thing that knows whether the answer is "no
 *  ebooks grant", "the bucket did not answer" or "that pack is damaged". */
function callFailure(name: string, call: { status: number; message?: string }): ToolOutcome {
  return booksRefusal(
    name,
    call.status === 403
      ? 'books_not_permitted'
      : call.status === 0
        ? 'books_unreachable'
        : 'books_refused',
    call.message ?? BOOKS_MSG.estateUnreachable,
    call.status >= 500 || call.status === 0
      ? 'An outage on our side. Say so — it is NOT a statement about this person’s access, and NOT a statement about the book.'
      : 'The estate refused this read. Relay the sentence exactly; do not soften it, and do not answer the question from your own memory of the book instead.',
  );
}

/**
 * ⚠️ **THE ANSWER TO "IS IT INGESTED YET" IS A 200, NOT AN ERROR** — the routes'
 * own absence rule, carried through. It comes back `isError: false` with the
 * honest sentence, because "I have not read that one" is a real answer and the
 * model must not treat it as a wobble to retry around.
 */
function notIngested(name: string, body: Record<string, unknown>): ToolOutcome {
  return {
    name,
    isError: false,
    result: {
      ingested: false,
      book_id: body.book_id,
      say: BOOKS_MSG.notIngested,
      did_you_mean: body.did_you_mean,
      knowledge_base_size: body.knowledge_base_size,
      note:
        '⚠️ This book is NOT in the knowledge base. That is a gap in what has been processed, and it ' +
        'is NOT a fact about the story — never say something does not happen in a book you have not ' +
        'read. Say you have not read it yet, offer what the catalogue knows, and if did_you_mean ' +
        'looks like what they meant, ask.',
    },
  };
}

async function listKnowledge(
  books: BooksToolContext,
  email: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const name = 'list_book_knowledge';
  const query = str(args.query);
  const call = await books.port.available(email, query);
  if (!call.ok) return callFailure(name, call);

  const body = call.body ?? {};
  const rows = Array.isArray(body.books) ? body.books : [];
  const shown = rows.slice(0, BOOKS_LIST_LIMIT).map((r) => {
    const b = r as Record<string, unknown>;
    return { book_id: b.book_id, title: b.title, source: b.source, chapters: b.chapters };
  });
  return {
    name,
    isError: false,
    result: {
      knowledge_base: 'the books whose full text GABI has actually read',
      // ⚠️ `count` is the WHOLE knowledge base and `matched` is what this query
      // narrowed to. A model shown only the second will report the second as the
      // size of everything she has read.
      total_in_knowledge_base: body.count,
      matched: body.matched,
      shown: shown.length,
      books: shown,
      index_present: body.index_present,
      note:
        shown.length === 0
          ? '⚠️ Nothing in the knowledge base matched. That means the text of that book has NOT been ' +
            'processed — it does NOT mean the estate lacks the book, and it does NOT license ' +
            'answering from your own memory of it. Say you have not read it yet; books are added as ' +
            'they finish processing. catalog_lookup can still say what the catalogue records.'
          : 'Use these book ids exactly. ⚠️ A title missing from this list is a book you have NOT ' +
            'read — say so plainly rather than answering about it. The knowledge base grows: ' +
            'absence today is not absence next week.',
    },
  };
}

const PRESENCE_NOTE =
  '⚠️ chunk_hits: 0 is a REAL answer — the term is genuinely absent from that book. But a book ' +
  'marked ingested: false was NOT checked at all, and reporting that as absence is the one thing ' +
  'this tool exists to prevent. Say which books you actually looked in. hidden_by_scope counts ' +
  'mentions past where the reader has got to — that is a spoiler boundary, not an absence.';

function searchNote(
  body: Record<string, unknown>,
  scope: Record<string, unknown>,
  shown: number,
): string {
  const parts: string[] = [];
  if (shown === 0) {
    parts.push(
      '⚠️ Nothing matched INSIDE this book. That is a statement about the text you searched, and it ' +
        'is not the same as the book lacking it — check terms_missing, try another wording, or try ' +
        'mode "earliest" if it is a first appearance.',
    );
  } else {
    parts.push(
      'Quote and cite what is here: name the book and the chapter, and give the timestamp when one ' +
        'is present. ⚠️ Never add a detail these passages do not contain — you may remember this ' +
        'book from elsewhere, and an answer sourced from there is exactly what this tool replaces.',
    );
  }
  if (body.source === 'transcript') {
    parts.push(
      '⚠️ This text is a TRANSCRIPT of the audiobook, not the written book. Say so when you quote ' +
        'it. Numbers are reliable; single-letter grades and unusual proper nouns are not.',
    );
  }
  if (scope.bounded === true) {
    const where = scope.ceiling_chapter_title
      ? `“${String(scope.ceiling_chapter_title)}”`
      : `chapter ${String(scope.ceiling_chapter ?? '?')}`;
    parts.push(
      `⚠️ You are reading up to ${where} and no further, because that is where the question said to ` +
        'stop. SAY the scope in your answer.',
    );
  } else if (typeof scope.ask === 'string' && scope.ask) {
    // ⚠️ Absence of a stated position means UNKNOWN — never "unread" and never
    // "finished" (design §4.5). The sentence is the route's own.
    parts.push(
      `⚠️ Nobody said how far they have got, so nothing was hidden. Ask before going deep: "${scope.ask}"`,
    );
  }
  if (typeof body.note === 'string' && body.note) parts.push(String(body.note));
  return parts.join(' ');
}

async function searchBook(
  books: BooksToolContext,
  email: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const name = 'search_book_text';
  const bookId = str(args.bookId);
  const query = str(args.query);
  if (!bookId || !query) {
    return booksRefusal(
      name,
      'nothing_to_search',
      'I need both a book and something to look for.',
      'Call list_book_knowledge for the book id, then search again. Nothing was read.',
    );
  }
  const modeRaw = str(args.mode) || 'relevant';
  if (!(BOOK_MODES as readonly string[]).includes(modeRaw)) {
    return booksRefusal(
      name,
      'bad_mode',
      'I did not recognise that way of searching, so I have not looked yet.',
      'mode must be relevant, latest, earliest or presence — four different questions, not four ' +
        'sorts of one. Nothing was read.',
    );
  }

  const call = await books.port.search(email, bookId, {
    q: query,
    mode: modeRaw,
    limit: String(BOOKS_SEARCH_HITS),
    // ⚠️ ASK for the stat-block detector when the query is stat-shaped, rather
    // than leaving it to the route's own `looksLikeStatQuestion()` — which has
    // the same "stat sheet" / "status sheet" blind spot the router had, and
    // which measurably returned prose that MENTIONED the words instead of the
    // blocks themselves. Only ever `true`: unset leaves the route's judgement
    // in place, and `false` would suppress a detector that was right.
    ...(modeRaw !== 'presence' && looksLikeStatQuery(query) ? { stat_block: 'true' } : {}),
    // ⚠️ THE BOUND, DERIVED FROM THIS TURN'S QUESTION AND NEVER STORED. It is
    // threaded from the context rather than read from `args`: a model asked to
    // choose its own spoiler scope chooses the generous one, because the
    // generous one answers the question better.
    ...boundParams(books.bound),
  });
  if (!call.ok) return callFailure(name, call);

  const body = call.body ?? {};
  if (body.ingested === false) return notIngested(name, body);

  // Presence-as-a-mode returns a roll-up rather than passages, and the roll-up
  // is metadata — it costs the turn no prose.
  if (body.mode === 'presence') {
    return {
      name,
      isError: false,
      result: { mode: 'presence', query, books: body.books, note: PRESENCE_NOTE },
    };
  }

  const passages = Array.isArray(body.passages) ? body.passages : [];
  // ⚠️ Charged AFTER the call and BEFORE the model sees it, and it REFUSES
  // rather than trims: a silently truncated passage is a plot point missing the
  // sentence that mattered.
  const bytes = JSON.stringify(passages).length;
  if (!books.budget.take(bytes, passages.length)) {
    return booksRefusal(
      name,
      'books_turn_budget_spent',
      BOOKS_MSG.turnBudgetSpent,
      'Those passages were NOT read. Do not describe them.',
    );
  }

  const scope = (body.scope ?? {}) as Record<string, unknown>;
  return {
    name,
    isError: false,
    result: {
      ingested: true,
      book_id: body.book_id,
      title: body.title,
      // ⚠️ `source` says whether this text came from an EPUB or from a
      // TRANSCRIPT of the audio, and the answer has to be able to say so:
      // letter grades and proper nouns are measurably unreliable from speech
      // (design §6.4), so a transcript quote is cited as one.
      source: body.source,
      mode: body.mode,
      query,
      terms_found: body.terms_found,
      terms_missing: body.terms_missing,
      alias_expansions: body.alias_expansions,
      scope,
      passages,
      bytes,
      note: searchNote(body, scope, passages.length),
    },
  };
}

async function readPassage(
  books: BooksToolContext,
  email: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const name = 'read_book_passage';
  const bookId = str(args.bookId);
  const ord = num(args.ord);
  if (!bookId || ord === null || ord < 0) {
    return booksRefusal(
      name,
      'nothing_to_read',
      'I need a book and a position from a search result before I can read a passage.',
      '⚠️ Do not construct an ord — they only mean anything inside the book that produced them. ' +
        'Nothing was read.',
    );
  }

  const call = await books.port.passage(email, bookId, {
    ord: String(Math.floor(ord)),
    ...boundParams(books.bound),
  });
  if (!call.ok) return callFailure(name, call);

  const body = call.body ?? {};
  if (body.ingested === false) return notIngested(name, body);

  const passage = (body.passage ?? null) as Record<string, unknown> | null;
  if (!passage) {
    // ⚠️ TWO DIFFERENT FACTS, and the route distinguishes them in its `detail`:
    // "past where you asked me to stop" and "there is no passage there". Both
    // are 200s and neither is an error — relayed as the route worded it.
    return {
      name,
      isError: false,
      result: {
        ingested: true,
        book_id: body.book_id,
        passage: null,
        scope: body.scope,
        say: body.detail,
        note:
          '⚠️ Nothing was read. If this is a spoiler boundary, say so and offer to go past it — do ' +
          'not describe the passage, and do not conclude the book lacks whatever was asked about.',
      },
    };
  }

  const text = typeof passage.text === 'string' ? passage.text : '';
  if (!books.budget.take(text.length, 1)) {
    return booksRefusal(
      name,
      'books_turn_budget_spent',
      BOOKS_MSG.turnBudgetSpent,
      'The passage was NOT read — do not summarise it from the snippet as though you had.',
    );
  }

  return {
    name,
    isError: false,
    result: {
      ingested: true,
      book_id: body.book_id,
      title: body.title,
      source: body.source,
      scope: body.scope,
      passage,
      bytes: text.length,
      note:
        'Quote what this passage actually says and cite the chapter (and the timestamp if there is ' +
        'one). ⚠️ A stitch of "reduced" means a neighbouring chunk was dropped at a chapter edge, ' +
        'so a block may be missing its header — say what you can see rather than completing it ' +
        'from memory.' +
        (body.source === 'transcript'
          ? ' ⚠️ This is a TRANSCRIPT of the audio, not the written book. Say so when you quote it.'
          : ''),
    },
  };
}

async function presenceAcross(
  books: BooksToolContext,
  email: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const name = 'book_presence';
  const query = str(args.query);
  const ids = Array.isArray(args.bookIds)
    ? args.bookIds.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  if (!query || ids.length === 0) {
    return booksRefusal(
      name,
      'nothing_to_search',
      'I need something to look for and the books to look in.',
      'Call list_book_knowledge for the ids first. Nothing was read.',
    );
  }
  if (ids.length > BOOKS_PRESENCE_MAX) {
    // ⚠️ Refused rather than quietly checking the first six — a partial sweep
    // reported as a whole one is exactly how "she never appears" gets said.
    return booksRefusal(
      name,
      'too_many_books',
      `I can check ${BOOKS_PRESENCE_MAX} books at a time, and I would rather refuse than quietly check the first few.`,
      'Pick the six that matter, or ask in two goes. Nothing was read.',
    );
  }

  const call = await books.port.presence(email, {
    q: query,
    books: ids.join(','),
    ...boundParams(books.bound),
  });
  if (!call.ok) return callFailure(name, call);

  const body = call.body ?? {};
  return {
    name,
    isError: false,
    result: { mode: 'presence', query, books: body.books, note: PRESENCE_NOTE },
  };
}
