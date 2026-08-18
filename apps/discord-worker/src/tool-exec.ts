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
  gabiDocsToolByName,
  gabiToolByName,
  isGabiDocsToolName,
  isGabiToolName,
  toolBook,
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
  if (!isDocs && (!isGabiToolName(name) || !gabiToolByName(name))) {
    return {
      name: label,
      isError: true,
      result: {
        error: 'unknown_tool',
        allowed: 'catalog_lookup, series_volumes, search_estate_docs, read_estate_doc',
        note: 'That tool does not exist on this surface. Nothing was run.',
      },
    };
  }
  const args = (input ?? {}) as Record<string, unknown>;
  try {
    if (isDocs) return await runDocsTool(name as GabiDocsToolName, args, ctx);
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
