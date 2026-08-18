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
import { gabiToolByName, isGabiToolName, toolBook, type GabiToolName } from './gabi-tools.js';

export interface ToolContext {
  catalogBaseUrl: string;
  /** Test seam: the same shape `chatClient` takes, for the same reason. */
  fetchOverride?: typeof fetch;
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
  if (!isGabiToolName(name) || !gabiToolByName(name)) {
    return {
      name: label,
      isError: true,
      result: {
        error: 'unknown_tool',
        allowed: 'catalog_lookup, series_volumes',
        note: 'That tool does not exist on this surface. Nothing was run.',
      },
    };
  }
  const args = (input ?? {}) as Record<string, unknown>;
  try {
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
