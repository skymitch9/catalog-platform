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
  recallTerms,
  renderRecall,
  RECALL_MSG,
  type ArchivePort,
} from './archive.js';
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
  gabiShelfToolByName,
  isGabiShelfToolName,
  type GabiShelfToolName,
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
  isGabiRecallToolName,
  gabiRecallToolByName,
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
  BOOKS_PASSAGE_RUN_MAX,
  BOOKS_PRESENCE_MAX,
  BOOKS_SEARCH_HITS,
  MAX_COUNT_QUOTES,
  MAX_COUNT_VARIANTS,
  booksIdentityMessage,
  boundForBook,
  boundParams,
  looksLikeStatQuery,
  type BooksToolContext,
  type QuestionBound,
} from './book-knowledge.js';
import {
  bookIdFromTitle,
  SHELF_MSG,
  SHELF_SOFT_CLAIM_NOTE,
  SHELF_UNREAD_ROWS,
  shelfIdentityMessage,
  UNREAD_NOTE,
  type ShelfAsker,
  type ShelfPort,
} from './shelf.js';

/** ⚠️ What the shelf tools are handed for one turn — the port plus the asker's
 *  DISCORD id. The uid is resolved from that server-side and never arrives from
 *  the model. */
export interface ShelfToolContext {
  port: ShelfPort;
  discordUserId: string;
}

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
  /**
   * ⚠️ **TIER 0d — the asker's own shelf, OPTIONAL BY DESIGN.** Absent means this
   * surface cannot read a shelf: the state of every caller not given one, and of
   * production while `GABI_SHELF` is off. The port's only implementation
   * (`shelf-exec.ts`) is the FIFTH module here that names a credential.
   */
  shelf?: ShelfToolContext;
  /**
   * ⚠️ **TIER 4 — the asker's OWN past conversations, OPTIONAL BY DESIGN.**
   *
   * ⚠️ **`person` IS BUILT BY THE COMPOSITION ROOT FROM THE ASKER'S OWN
   * IDENTITY, AND THAT IS THE WHOLE PRIVACY MODEL.** It arrives here already
   * decided; no tool argument can influence it, so a model cannot ask for
   * somebody else's history because there is no parameter that would carry the
   * request. Design §4.4: privacy is a `where` clause, not a prompt instruction.
   */
  recall?: { port: ArchivePort; person: string };
  /**
   * ⚠️ **THE TURN TRACE — optional, inert, and it holds nothing.** Added
   * 2026-08-18 with the recent-turn log, after a real person's *"she didn't
   * answer me"* could not be investigated at all (`turnlog.ts`'s header carries
   * the incident). `runTool` is the ONE dispatch point every tool family passes
   * through, so recording here covers the catalogue, docs, book, shelf and
   * recall families at once rather than in five places that could drift.
   *
   * ⚠️ It records the tool NAME and nothing else — never the arguments, never
   * the result. A query string is content.
   */
  trace?: { tool(name: string): void };
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
  const isShelf = isGabiShelfToolName(name) && Boolean(gabiShelfToolByName(name));
  const isRecall = isGabiRecallToolName(name) && Boolean(gabiRecallToolByName(name));
  if (
    !isDocs &&
    !isBooks &&
    !isShelf &&
    !isRecall &&
    (!isGabiToolName(name) || !gabiToolByName(name))
  ) {
    return {
      name: label,
      isError: true,
      result: {
        error: 'unknown_tool',
        allowed:
          'catalog_lookup, series_volumes, search_estate_docs, read_estate_doc, ' +
          'list_book_knowledge, search_book_text, read_book_passage, book_presence, ' +
          'my_tbr, my_reviews, book_reviews, my_unread, recall_conversation',
        note: 'That tool does not exist on this surface. Nothing was run.',
      },
    };
  }
  // ⚠️ RECORDED AFTER THE ALLOWLIST, BEFORE THE DISPATCH. After, so an unknown
  // name is not written down as a tool that fired; before, so a tool that THREW
  // still shows in the ring — a turn that died inside `search_book_text` and one
  // that never reached it are the two answers "why was she quiet?" can have, and
  // recording on success alone would erase the first.
  ctx.trace?.tool(label);
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    if (isDocs) return await runDocsTool(name as GabiDocsToolName, args, ctx);
    if (isBooks) return await runBooksTool(name as GabiBooksToolName, args, ctx);
    if (isShelf) return await runShelfTool(name as GabiShelfToolName, args, ctx);
    if (isRecall) return await runRecallTool(args, ctx);
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
  if (name === 'count_phrase') return await countPhrase(books, who.email, args);
  return await searchBook(books, who.email, args);
}

/**
 * ⚠️ **THE LADDER'S ROW 7, RESOLVED FOR ONE BOOK, AT THE MOMENT OF THE CALL**
 * (`book-knowledge.ts`'s `deriveBound`, design §3).
 *
 * The turn's own bound is derived from the QUESTION before any book is chosen;
 * a rating is per-`bookId` and can only be consulted once there is an id. So the
 * question's answer travels in the context, and this is where the store's answer
 * is added — for the one book about to be queried, and only when the question
 * said nothing at all.
 *
 * ⚠️ **The shelf read is LAZY AND MEMOISED** (the loader is built once per turn),
 * so a turn that opens no book pays nothing and a turn that opens four books
 * pays one query. ⚠️ A failed read resolves to `{ ok: false }` and therefore to
 * `unknown` — never to `whole_book`.
 */
async function bookBound(books: BooksToolContext, bookId: string): Promise<QuestionBound> {
  if (books.bound.scope !== 'unknown' || !books.readState) return books.bound;
  try {
    return boundForBook(books.bound, await books.readState(), bookId);
  } catch {
    // ⚠️ Deliberately silent about WHAT was being read: the loader logs its own
    // failure, and nothing here may name a phrase, a book or a person.
    return books.bound;
  }
}

/** ⚠️ The disclosure sentence, appended to a result whose bound came from the
 *  asker's own RATING rather than from anything they typed this turn (§3.2).
 *  She says which evidence she used, once — that sentence is the fuse for every
 *  residual the rung has: a rating left after a DNF, a shared display name, a
 *  migrated review with no uid. */
function ratingBoundNote(bound: QuestionBound): string {
  if (bound.scope !== 'whole_book' || bound.how !== 'rating') return '';
  return (
    '⚠️ NOBODY SAID HOW FAR THEY HAD GOT THIS TURN — the scope came from THEIR OWN RATING of this ' +
    `book, so nothing was hidden. SAY THIS ONCE, in your own voice, near the top: "${BOOKS_MSG.ratingBound}" ` +
    'Say it once for the whole answer, not once per book, and do not explain the mechanism.'
  );
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
        'looks like what they meant, ask. ⚠️ did_you_mean IS the list of what you actually DO have ' +
        'from around here — if you name the furthest volume you have reached, take it from that ' +
        'list and from nothing else, least of all from what you said a moment ago. ⚠️ And put no ' +
        'date on when this one might arrive; you cannot know.',
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
            'read — say so plainly rather than answering about it. ⚠️ THIS LIST, FROM THIS TURN, IS ' +
            'THE ONLY THING THAT MAY DECIDE WHAT YOU HAVE READ: do not say how far into a series you ' +
            'have got from what you said earlier in the conversation. The knowledge base grows as ' +
            'books finish processing — absence today is not absence forever, and you cannot say ' +
            'when.',
    },
  };
}

/**
 * ⚠️ **THE FALSE NEGATIVE THIS FEATURE CAN SAY OUT LOUD.** Found in the owner's
 * 2026-08-18 transcript: he asked three things in one message, one of which
 * bounded him to chapter 20, and the SAME bound then applied to a cross-book
 * presence roll-up — hiding Villy's real first appearance (book 2, chapter 24,
 * measured) and producing *"not in books 1 or 2"*, which is false.
 *
 * The roll-up reported it honestly in `hidden_by_scope`; the answer did not
 * repeat it. So when anything was hidden, the note stops being advice and
 * becomes the loudest line in the result.
 */
function presenceNote(books: unknown): string {
  const rows = Array.isArray(books) ? books : [];
  const hidden = rows.reduce((n, r) => {
    const h = (r as Record<string, unknown>)?.hidden_by_scope;
    return n + (typeof h === 'number' ? h : 0);
  }, 0);
  if (hidden > 0) {
    return (
      `⚠️ ${hidden} mention(s) sit PAST where this reader has got to and were hidden from this ` +
      'roll-up. YOU MUST NOT say the term is absent from any book with a non-zero hidden_by_scope — ' +
      'that would be a false statement about the story, and it is the one mistake a spoiler bound ' +
      'can make you make. Say instead that you kept to where they are and offer to look further. ' +
      PRESENCE_NOTE
    );
  }
  return PRESENCE_NOTE;
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

  // ⚠️ The turn's bound, plus the ladder's row 7 for THIS book — the fix for
  // *"It doesn't know that I've read the books even though I have it rated"*.
  const bound = await bookBound(books, bookId);

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
    ...boundParams(bound),
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
      result: { mode: 'presence', query, books: body.books, note: presenceNote(body.books) },
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
      'Those passages were NOT read — do not describe them. Say so in ordinary words and offer to ' +
        'go again. ⚠️ NEVER name a budget, a cap or a quota: it reads as a malfunction when nothing ' +
        'is wrong.',
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
      note: [searchNote(body, scope, passages.length), ratingBoundNote(bound)]
        .filter(Boolean)
        .join(' '),
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

  // ⚠️ **WALKING FORWARD IS THE WHOLE POINT OF `count`** (owner decision
  // 2026-08-18, and the loop it ended). Continuing a list is a POSITION problem,
  // not a relevance one: a ranked search returns its best match every time and
  // the tail of a sheet is never the best match, so "search again to continue"
  // is an infinite loop by construction. Reading ord+1, ord+2 … is not.
  const runs = Math.min(Math.max(1, Math.floor(num(args.count) ?? 1)), BOOKS_PASSAGE_RUN_MAX);
  const start = Math.floor(ord);

  const collected: Record<string, unknown>[] = [];
  let body: Record<string, unknown> = {};
  let stopped: string | null = null;

  // ⚠️ Resolved ONCE for the whole run, not per page: the ceiling must not move
  // between ord N and ord N+1 of the same answer.
  const bound = await bookBound(books, bookId);

  for (let i = 0; i < runs; i++) {
    const call = await books.port.passage(email, bookId, {
      ord: String(start + i),
      ...boundParams(bound),
    });
    // ⚠️ A failure on a LATER page keeps what already came back rather than
    // discarding the run — the person gets the part that worked, and the reason
    // the rest did not.
    if (!call.ok) {
      if (collected.length === 0) return callFailure(name, call);
      stopped = call.message ?? BOOKS_MSG.estateUnreachable;
      break;
    }
    body = call.body ?? {};
    if (body.ingested === false) {
      if (collected.length === 0) return notIngested(name, body);
      break;
    }
    const one = (body.passage ?? null) as Record<string, unknown> | null;
    if (!one) {
      // End of the book, or the spoiler ceiling. Both are real stopping points
      // and neither is an error; the route's own sentence says which.
      if (collected.length === 0) break;
      stopped = typeof body.detail === 'string' ? body.detail : null;
      break;
    }
    const oneText = typeof one.text === 'string' ? one.text : '';
    if (!books.budget.take(oneText.length, 1)) {
      // ⚠️ The ceiling reached MID-RUN. Everything already collected was read
      // and may be printed; this one was not. She says so and does not ask.
      stopped = BOOKS_MSG.turnBudgetSpent;
      break;
    }
    collected.push(one);
  }

  const passage = collected[0] ?? null;
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

  const bytes = collected.reduce(
    (n, p) => n + (typeof p.text === 'string' ? (p.text as string).length : 0),
    0,
  );
  const lastOrd = collected.reduce(
    (n, p) => (typeof p.ord === 'number' && p.ord > n ? p.ord : n),
    start,
  );

  return {
    name,
    isError: false,
    result: {
      ingested: true,
      book_id: body.book_id,
      title: body.title,
      source: body.source,
      scope: body.scope,
      // ⚠️ Kept as `passage` AND `passages`: the singular is what every existing
      // caller and every earlier prompt expects, the plural is the run. Dropping
      // the singular would have been a silent contract change on a shape a model
      // is already trained on by its own description.
      passage,
      passages: collected,
      count: collected.length,
      // ⚠️ **THE CONTINUATION ANCHOR.** The single most important field for the
      // loop this ended: where to pick up if the thing being printed is still
      // not finished. It rides in the RESULT rather than being recomputed,
      // because a model that has to derive its own next position is a model that
      // will re-run the search instead.
      next_ord: lastOrd + 1,
      ...(stopped ? { stopped_because: stopped } : {}),
      bytes,
      note:
        'Quote what these passages actually say and cite the chapter (and the timestamp if there is ' +
        'one). ⚠️ A stitch of "reduced" means a neighbouring chunk was dropped at a chapter edge, ' +
        'so a block may be missing its header — say what you can see rather than completing it ' +
        'from memory. ' +
        '⚠️ IF WHAT YOU ARE PRINTING IS STILL NOT FINISHED, call this again with ord = next_ord ' +
        `(${lastOrd + 1}). Do NOT search again — the same best-ranked passage comes back every ` +
        'time and you will print the same thing twice. ' +
        '⚠️ AND PRINT ONLY WHAT IS NEW. Do not re-print the part you already sent; repeating it is ' +
        'what used up the room the rest of it needed.' +
        (stopped ? ` ⚠️ The run stopped early: ${stopped} Say what you did not get to.` : '') +
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

// ---------------------------------------------------------------------------
// ⚠️ COUNT_PHRASE — the tool she said she did not have, 2026-09-03
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE FOUR SENTENCES THIS RELAY EXISTS TO KEEP APART**, each of them a
 * different fact and each with a different fix. Collapsing any pair produces a
 * confident false statement about somebody's book:
 *
 * | shape | means | and NOT |
 * |---|---|---|
 * | `ingested: false` | "I have not read that book" | "it never happens" |
 * | `total: 0` | "he never says it, in the text I read" | "the book is missing" |
 * | `hidden_by_scope > 0` | "there are more, past where you are" | "that is all of them" |
 * | a refusal | "I did not count" | "the count is zero" |
 *
 * ⚠️ **`hidden_by_scope` is the one that can spoil a book in reverse** — it makes
 * "never" a FALSE word, and the note says so in the loudest terms available,
 * because the same omission has already been measured once on the presence
 * roll-up (Villy, book 2 chapter 24, reported as "not in books 1 or 2").
 */
function countNote(
  body: Record<string, unknown>,
  bound: QuestionBound,
  quotesAsked: number,
): string {
  const parts: string[] = [];
  const total = typeof body.total === 'number' ? body.total : null;
  const hidden = typeof body.hidden_by_scope === 'number' ? body.hidden_by_scope : 0;
  const scope = (body.scope ?? {}) as Record<string, unknown>;

  if (hidden > 0) {
    const where = scope.ceiling_chapter_title
      ? `“${String(scope.ceiling_chapter_title)}”`
      : `chapter ${String(scope.ceiling_chapter ?? '?')}`;
    parts.push(
      `⚠️ ${hidden} more match(es) sit PAST where this reader has got to and are NOT in the total. ` +
        'YOU MUST NOT say "never", "not at all" or "absent", and you must not present this number as ' +
        `the whole book's: say it is the count THROUGH ${where}, and offer to count the rest.`,
    );
  } else if (total === 0) {
    parts.push(
      '⚠️ ZERO IS A REAL ANSWER HERE and it is worth saying plainly: the book IS in your knowledge ' +
        'base, it WAS counted, and the phrase is not in it. That is completely different from not ' +
        'having read the book. ⚠️ Before you conclude it, check the variants you asked for — a ' +
        'transcript may punctuate or spell a catchphrase differently, and one more spelling is ' +
        'cheaper than a wrong "never".',
    );
  } else if (total !== null) {
    parts.push(
      'Give the NUMBER first, then where it lands — the chapters with the most, and the timestamps ' +
        'if there are any. ⚠️ Quote only the excerpts that came back, and never add one from memory.',
    );
  }

  if (body.source === 'transcript') {
    parts.push(
      '⚠️ This text is a TRANSCRIPT of the audiobook, not the written book, and for a catchphrase ' +
        'that matters: say the count is "in the transcript". The printed page may punctuate it ' +
        'differently — "goddammit" on paper can be "god damn it" in the recording.',
    );
  } else if (typeof body.source === 'string' && body.source) {
    parts.push(`⚠️ Say which text this came from: the ${String(body.source)}.`);
  }

  if (typeof body.matcher === 'string' && body.matcher) {
    parts.push(
      `How the counting matched, in one clause if they ask: ${String(body.matcher)}. Do not recite ` +
        'it unprompted.',
    );
  }

  if (quotesAsked === 0 && (total ?? 0) > 0) {
    parts.push('No excerpts were asked for. Offer to show one or two rather than inventing any.');
  }

  if (typeof body.note === 'string' && body.note) parts.push(String(body.note));
  const rating = ratingBoundNote(bound);
  if (rating) parts.push(rating);
  else if (bound.scope === 'unknown' && typeof scope.ask === 'string' && scope.ask) {
    parts.push(
      `⚠️ Nobody said how far they have got, so nothing was hidden and this is the whole-book count. ` +
        `Say so, and ask before going deeper: "${scope.ask}"`,
    );
  }
  return parts.join(' ');
}

async function countPhrase(
  books: BooksToolContext,
  email: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const name = 'count_phrase';
  const phrase = str(args.phrase);
  const ids = Array.isArray(args.bookIds)
    ? args.bookIds.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  if (!phrase || ids.length === 0) {
    return booksRefusal(
      name,
      'nothing_to_count',
      'I need the words to count and the book to count them in.',
      'Call list_book_knowledge for the book id first — ids come from that listing and are refused ' +
        'if constructed. Nothing was counted.',
    );
  }
  if (ids.length > BOOKS_PRESENCE_MAX) {
    // ⚠️ Refused rather than quietly counting the first six. A partial count
    // reported as a whole one is a number nobody can stand behind, which is the
    // exact failure this tool was built to end.
    return booksRefusal(
      name,
      'too_many_books',
      `I can count across ${BOOKS_PRESENCE_MAX} books at a time, and I would rather refuse than quietly count the first few.`,
      'Pick the six that matter, or ask in two goes. Nothing was counted.',
    );
  }

  // ⚠️ CLAMPED HERE TOO, not only at the route. The route clamps silently (a
  // caller asking for eight spellings is optimistic, not wrong); clamping on
  // this side as well means the model's own request and the answer's `variants`
  // cannot quietly disagree.
  const variants = (Array.isArray(args.variants) ? args.variants : [])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    // ⚠️ `phrase` itself counts as one of the six on the other end, so this list
    // may hold at most five more.
    .slice(0, Math.max(0, MAX_COUNT_VARIANTS - 1));
  const quotes = Math.min(Math.max(0, Math.floor(num(args.quotes) ?? 0)), MAX_COUNT_QUOTES);

  // ⚠️ SEVERAL BOOKS IS A DIFFERENT ROUTE AND A DIFFERENT ANSWER — totals only,
  // whole-book only. A ceiling is derived against ONE pack's chapter table, so
  // there is no honest single ceiling for six of them (design §4.3, the
  // 28-chapter leak), and the answer says so rather than implying a scope.
  if (ids.length > 1) {
    const call = await books.port.countAcross(email, {
      q: phrase,
      books: ids.join(','),
      // ⚠️ PIPE-joined, because a comma is a legal character inside a phrase
      // ("God damn it, Donut") and the `books=` list already owns the comma.
      ...(variants.length ? { variants: variants.join('|') } : {}),
    });
    if (!call.ok) return countFailure(name, call);

    const body = call.body ?? {};
    const rows = Array.isArray(body.books) ? body.books : [];
    const bytes = JSON.stringify(rows).length;
    if (!books.budget.take(bytes, 0)) {
      return booksRefusal(
        name,
        'books_turn_budget_spent',
        BOOKS_MSG.turnBudgetSpent,
        'Nothing was counted — do not state a number. Say so in ordinary words and offer to go ' +
          'again. ⚠️ NEVER name a budget, a cap or a quota.',
      );
    }
    return {
      name,
      isError: false,
      result: {
        mode: 'count',
        phrase,
        variants: body.variants,
        scope: 'whole_book',
        matcher: body.matcher,
        books: rows,
        bytes,
        note:
          '⚠️ THIS COUNT COVERS THE WHOLE OF EACH BOOK — a multi-book count cannot be bounded by ' +
          'where the reader has got to, so say that plainly if any of these might be ahead of them. ' +
          '⚠️ A book marked ingested: false was NOT counted at all; reporting that as zero is the one ' +
          'mistake this tool exists to prevent. Say which books you actually counted in, and say ' +
          'which text they came from (source). For chapters, timestamps or quotes, count that book ' +
          'on its own.',
      },
    };
  }

  const bookId = ids[0] as string;
  const bound = await bookBound(books, bookId);
  const call = await books.port.count(email, bookId, {
    q: phrase,
    ...(variants.length ? { variants: variants.join('|') } : {}),
    quotes: String(quotes),
    ...boundParams(bound),
  });
  if (!call.ok) return countFailure(name, call);

  const body = call.body ?? {};
  if (body.ingested === false) return notIngested(name, body);

  const quoteRows = Array.isArray(body.quotes) ? body.quotes : [];
  // ⚠️ Charged AFTER the call and BEFORE the model sees it, the same order the
  // search relay uses: the bytes were spent either way, and a result the turn
  // has no room for must not be described as though it had been read.
  const bytes = JSON.stringify(body).length;
  if (!books.budget.take(bytes, quoteRows.length)) {
    return booksRefusal(
      name,
      'books_turn_budget_spent',
      BOOKS_MSG.turnBudgetSpent,
      'That count was NOT read — do not state a number and do not describe the excerpts. Say so in ' +
        'ordinary words and offer to go again. ⚠️ NEVER name a budget, a cap or a quota: it reads as ' +
        'a malfunction when nothing is wrong.',
    );
  }

  return {
    name,
    isError: false,
    result: {
      ingested: true,
      mode: 'count',
      book_id: body.book_id,
      title: body.title,
      // ⚠️ ALWAYS carried, so the answer can say "in the transcript" — for a
      // catchphrase the difference between the recording and the printed page is
      // the difference between a right number and a wrong one.
      source: body.source,
      phrase,
      variants: body.variants,
      total: body.total,
      by_variant: body.by_variant,
      by_chapter: body.by_chapter,
      quotes: quoteRows,
      hidden_by_scope: body.hidden_by_scope,
      scope: body.scope,
      matcher: body.matcher,
      bytes,
      note: countNote(body, bound, quotes),
    },
  };
}

/**
 * ⚠️ **A COUNT'S OWN REFUSALS, WORDED — never a bare status** (ROLES.md §1e).
 *
 * Two of them are this route's alone and neither may reach a person as a number:
 * a phrase of pure punctuation (400 `empty_phrase`) would otherwise compile to
 * no matcher and answer 0, which reads as *"he never says it"*; and an `iv`
 * mismatch (409) means a ceiling was derived against a different chunking of the
 * book, which is the one input that can silently spoil one.
 */
function countFailure(name: string, call: { status: number; message?: string; body: Record<string, unknown> | null }): ToolOutcome {
  const error = typeof call.body?.error === 'string' ? call.body.error : '';
  if (call.status === 400 && error === 'empty_phrase') {
    return booksRefusal(
      name,
      'empty_phrase',
      call.message ??
        'Give me the words to count — punctuation on its own is not a phrase, and I will not guess ' +
          'which words you meant.',
      '⚠️ NOTHING WAS COUNTED. Do not say zero: a phrase with no words in it cannot be counted at ' +
        'all, which is not the same as it never being said. Ask them which words they meant, or ' +
        'call again with the actual phrase.',
    );
  }
  if (call.status === 409) {
    return booksRefusal(
      name,
      'bound_version_mismatch',
      call.message ?? BOOKS_MSG.noAnswer,
      '⚠️ NOTHING WAS COUNTED. The reading position was worked out against a different version of ' +
        'this book\'s text, and counting under it could reveal something past where they are. Do not ' +
        'state a number. Say you need to know where they have got to and ask.',
    );
  }
  return callFailure(name, call);
}

// ---------------------------------------------------------------------------
// TIER 0d — the asker's OWN shelf
//
// ⚠️ Three rules run through every branch below:
//   • the identity is resolved SERVER-SIDE and no argument can widen it;
//   • "not reviewed" is never allowed to masquerade as "not read";
//   • an empty reviews result is NOT proof somebody has written none — the join
//     is by display name and the name on file is a snapshot.
// ---------------------------------------------------------------------------

function shelfRefusal(name: string, error: string, say: string, note?: string): ToolOutcome {
  return { name, isError: true, result: { error, say, ...(note ? { note } : {}) } };
}

async function runShelfTool(
  name: GabiShelfToolName,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const shelf = ctx.shelf;
  if (!shelf) return shelfRefusal(name, 'shelf_not_available', SHELF_MSG.notConfigured);

  // ⚠️ `book_reviews` reads PUBLIC site content, so it needs no identity at all.
  // Requiring a link for it would refuse a question the websites answer to
  // anonymous visitors — and that absence of a gate is deliberate, not an
  // oversight.
  if (name === 'book_reviews') return await publicBookReviews(shelf, args);

  const who = await shelf.port.asker(shelf.discordUserId);
  if (!who.ok) {
    return shelfRefusal(
      name,
      `shelf_identity_${who.reason}`,
      shelfIdentityMessage(who.reason),
      who.reason === 'outage'
        ? 'An outage on our side. It says NOTHING about whether they have a shelf — do not answer as though it were empty.'
        : 'This is about the /link ceremony, not permissions. Relay the sentence as it is.',
    );
  }

  if (name === 'my_tbr') return await myTbr(shelf, who.asker);
  if (name === 'my_reviews') return await myReviews(shelf, who.asker);
  return await myUnread(shelf, who.asker, args, ctx);
}

async function myTbr(shelf: ShelfToolContext, asker: ShelfAsker): Promise<ToolOutcome> {
  const name = 'my_tbr';
  const call = await shelf.port.myTbr(asker);
  if (!call.ok) return shelfRefusal(name, 'shelf_unreachable', call.message ?? SHELF_MSG.estateUnreachable);
  if (call.rows.length === 0) {
    return {
      name,
      isError: false,
      result: {
        shelf: 'the asker’s own reading list',
        count: 0,
        say: SHELF_MSG.emptyTbr,
        note:
          '⚠️ This is the AUDIOBOOK reading list only — the print/ebook library keeps its own, and ' +
          'GABI cannot read that one yet. Say which shelf you looked at, so an empty answer is not ' +
          'heard as "you have nothing anywhere".',
      },
    };
  }
  return {
    name,
    isError: false,
    result: {
      shelf: 'the asker’s own reading list',
      count: call.total,
      shown: call.rows.length,
      books: call.rows,
      note:
        'These are books they said they want to read. ⚠️ Every row carries the SHELF it came from — ' +
        'say which. And this covers the AUDIOBOOK list only; the print/ebook library keeps a ' +
        'separate one that is not readable here yet, so do not present this as their whole list. ' +
        SHELF_SOFT_CLAIM_NOTE,
    },
  };
}

async function myReviews(shelf: ShelfToolContext, asker: ShelfAsker): Promise<ToolOutcome> {
  const name = 'my_reviews';
  const call = await shelf.port.myReviews(asker);
  if (!call.ok) return shelfRefusal(name, 'shelf_unreachable', call.message ?? SHELF_MSG.estateUnreachable);

  if (call.rows.length === 0) {
    // ⚠️ THE SENTENCE THIS WHOLE FEATURE EXISTS TO GET RIGHT. An empty result has
    // two causes and only one of them is "you have not written any": reviews are
    // filed under a display NAME, and the name on file was copied at link time.
    return {
      name,
      isError: false,
      result: {
        count: 0,
        joined_on_name: asker.displayName,
        say: SHELF_MSG.reviewsNotFound(asker.displayName),
        note:
          '⚠️ DO NOT tell them they have written no reviews. Nothing matched the name on file, which ' +
          'is a different fact — say the name you looked under and offer /link to refresh it.',
      },
    };
  }

  return {
    name,
    isError: false,
    result: {
      count: call.total,
      shown: call.rows.length,
      // ⚠️ Stated on every answer so a wrong-name join is visible rather than
      // silent, even when it DID find something (a renamed person may have
      // reviews under both names).
      joined_on_name: asker.displayName,
      reviews: call.rows,
      note:
        'These are their own words — quote them back accurately and do not reword their opinion ' +
        'into yours. ⚠️ Found by matching the display name on file; if they mention a review that is ' +
        'not here, the name may have changed and /link refreshes it. ' +
        SHELF_SOFT_CLAIM_NOTE,
    },
  };
}

async function publicBookReviews(
  shelf: ShelfToolContext,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const name = 'book_reviews';
  const title = str(args.title);
  if (!title) {
    return shelfRefusal(name, 'nothing_to_look_up', 'Tell me which book and I will look.', 'Nothing was read.');
  }
  const call = await shelf.port.bookReviews(bookIdFromTitle(title));
  if (!call.ok) return shelfRefusal(name, 'shelf_unreachable', call.message ?? SHELF_MSG.estateUnreachable);
  return {
    name,
    isError: false,
    result: {
      asked_about: title,
      count: call.total,
      shown: call.rows.length,
      reviews: call.rows,
      note:
        call.rows.length === 0
          ? 'Nobody in the household has reviewed that one. ⚠️ That is a statement about the REVIEWS, ' +
            'not about the book and not about whether the estate owns it.'
          : '⚠️ ATTRIBUTE, NEVER ABSORB. Name whose review each one is — "Sam gave it 4 and said …" — ' +
            'and never fold them into your own verdict or average them into a score nobody gave. ' +
            'These are public on the estate sites, which is why you may repeat them at all.',
    },
  };
}

/**
 * ⚠️ **"NOT REVIEWED", AND IT SAYS SO IN EVERY ROW.**
 *
 * The estate has no read-state store on the audiobook side, so this answers a
 * DIFFERENT question from the one usually asked — and the difference is enormous
 * in the direction that sounds authoritative, because most people review a small
 * fraction of what they read.
 */
async function myUnread(
  shelf: ShelfToolContext,
  asker: ShelfAsker,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const name = 'my_unread';
  const author = str(args.author);
  const series = str(args.series);

  const reviews = await shelf.port.myReviews(asker);
  if (!reviews.ok) {
    return shelfRefusal(name, 'shelf_unreachable', reviews.message ?? SHELF_MSG.estateUnreachable);
  }
  // ⚠️ The whole review set, not the capped display slice — a cap meant for a
  // readable message must never decide which books count as reviewed. Before
  // audit F7 this read `reviews.rows` (the 15-row slice), so anyone with more
  // than 15 reviews saw older-reviewed books reported as "not reviewed". Fall
  // back to the row ids only when a caller/stub predates `allBookIds`.
  const reviewed = new Set((reviews.allBookIds ?? reviews.rows.map((r) => r.bookId)).filter(Boolean));

  const load = await loadCatalog(
    ctx.catalogBaseUrl,
    ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined,
  );
  if (!load.ok) return loadFailure(name, load);

  const query = author || series;
  const matches = query
    ? filterCatalog(load.rows, { query, field: author ? 'author' : 'series' })
    : load.rows;

  const rows = matches
    .filter((r) => !reviewed.has(bookIdFromTitle(r.title)))
    .map((r) => ({
      title: r.title,
      author: r.author,
      ...(r.series ? { series: r.series } : {}),
      // ⚠️ THE LABEL THAT STOPS THE COUNT MASQUERADING.
      basis: 'no_review' as const,
    }));

  return {
    name,
    isError: false,
    result: {
      filters: { author: author || undefined, series: series || undefined },
      // ⚠️ Named `not_reviewed_count`, not `unread_count`. A field name is the
      // first thing a model reproduces, and this one cannot be misread.
      not_reviewed_count: rows.length,
      searched: matches.length,
      shown: Math.min(rows.length, SHELF_UNREAD_ROWS),
      books: rows.slice(0, SHELF_UNREAD_ROWS),
      basis_note: UNREAD_NOTE,
      note:
        '⚠️ Say "not reviewed", never "unread", and never call this a backlog. The estate keeps no ' +
        'record of what anybody has FINISHED on the audiobook side, so this is what they have not ' +
        'written about — a much larger set. ' +
        SHELF_SOFT_CLAIM_NOTE,
    },
  };
}

// ---------------------------------------------------------------------------
// TIER 4 — recall_conversation
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE PERSON KEY IS TAKEN FROM THE CONTEXT AND NEVER FROM `args`.**
 *
 * That single line is the whole of design §4.4's privacy guarantee. `args`
 * carries a query and a day count; there is no field on it that names a person,
 * so a prompt injection has nothing to inject INTO. `test/archive.test.ts`
 * asserts that this function never reads a person from `args`.
 */
async function runRecallTool(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const name = 'recall_conversation';
  if (!ctx.recall) {
    return {
      name,
      isError: true,
      result: { error: 'not_available', say: RECALL_MSG.notConfigured },
    };
  }
  const query = str(args.query);
  const terms = recallTerms(query);
  if (terms.length === 0) {
    // ⚠️ NO SUBJECT MEANS NO SEARCH. Searching for nothing would return the most
    // recent turns and present them as MATCHES — a confabulation with dates on
    // it, which is worse than any of the things this lane exists to prevent.
    return { name, isError: false, result: { matched: 0, say: RECALL_MSG.noSubject } };
  }

  const days = typeof args.since_days === 'number' && args.since_days > 0 ? args.since_days : null;
  const outcome = await ctx.recall.port.recall({
    person: ctx.recall.person,
    terms,
    ...(days ? { since: Date.now() - days * 24 * 60 * 60 * 1000 } : {}),
  });
  if (!outcome.ok) return { name, isError: true, result: { error: 'unreachable', say: outcome.message } };

  return {
    name,
    isError: false,
    // ⚠️ The RENDERED block, not the raw rows: `renderRecall` is what puts the
    // date on every line and the never-absorb rule in the text beside them. A
    // caller handed raw rows would have to remember to do that, and the whole
    // failure mode here is a model quietly dropping the date.
    result: { matched: outcome.hits.length, transcript: renderRecall(outcome, terms) },
  };
}
