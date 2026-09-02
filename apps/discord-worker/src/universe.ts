/**
 * `/universe` — browse the estate's recorded fictional universes (design §2 P3,
 * *"show me everything the estate owns in the DCC (or any shared) universe"*).
 *
 * ## ⚠️ WHY THIS DOES NOT CALL `/api/universe/:name`, WHICH THE DESIGN NAMED
 *
 * Measured 2026-09-02 rather than assumed:
 *
 * ```
 * GET https://index.heygabi.ai/api/universes  ->  401 Unauthorized
 * ```
 *
 * The index's universe tier sits above `requireEstateMember()`, and `have.ts`
 * already recorded the three-step measurement of why this Worker cannot widen a
 * caller's index scope: the index resolves scope from a **Firebase ID token**
 * only, Discord's OAuth does not produce one, and `firebase-sa.ts` is
 * deliberately scoped to `datastore` alone. So P3's "one more index endpoint
 * wired the same way" is not reachable from here today, and pretending
 * otherwise would have shipped a command that 401s at every caller.
 *
 * **What IS reachable is the same fact from the other side.** `catalog.csv`
 * carries a `universe` column — the pipeline stamps it from
 * `catalog-platform/data/universes.json`, the estate's ONE shared universe list
 * — and this Worker already loads and caches that file for every other
 * read-only lane. `catalog-data.ts` already owns the two functions this command
 * needs (`knownUniverses`, `filterCatalog({ universe })`), so this file adds a
 * surface and no new data path, no new credential, and no new trust edge.
 *
 * ⚠️ **THE HONEST CONSEQUENCE, SAID OUT LOUD IN EVERY ANSWER: this is ONE
 * SHELF.** The estate's `/universes` page is genuinely cross-catalog — audio,
 * print and board games. This command answers from the public **audiobook**
 * shelf, because that is the slice a Discord caller can see (design §4 decision
 * 4). An answer that quietly omitted the other two catalogues while sounding
 * estate-wide would be a wrong answer wearing a number, which is exactly what
 * `catalog-data.ts`'s `COVERAGE_NOTE` exists to prevent.
 */

import {
  filterCatalog,
  knownUniverses,
  loadCatalog,
  summarise,
  type CatalogRow,
} from './catalog-data.js';
import { editOriginalMessage } from './discord-api.js';
import { EMBED_COLOR, truncate } from './have.js';

/** The estate's own cross-catalog universe page — named in every answer as the
 * place the OTHER two catalogues are visible. A constant, not a guess: it is
 * the page `docs/KNOWN_ISSUES.md` KI-6 is about. */
export const UNIVERSES_PAGE = 'https://heygabi.ai/universes/';

/** How many works one universe answer lists. The rest are counted, never
 * dropped silently. */
export const UNIVERSE_MAX_WORKS = 12;

/** How many universes the no-argument listing shows. Measured 2026-08-18: the
 * shared list holds 16–17 universes, so this shows all of them today and states
 * the overflow if the list ever grows. */
export const UNIVERSE_MAX_LIST = 20;

export const UNIVERSE_MSG = {
  unreachable:
    "GABI could not reach the estate's catalogue just now, so this is a service problem on the " +
    'estate side and NOT an answer about the universes — try again in a minute. Nothing was read.',
  /** ⚠️ "That is not a universe the estate records" — a true and useful answer —
   * rather than "0 matches", which reads as a count somebody is withholding.
   * The reasoning is `knownUniverses()`'s own, reused here deliberately. */
  noSuchUniverse: (asked: string) =>
    `**${asked}** is not one of the universes the estate records — it is not a count of zero, it is ` +
    'a name the shared universe list does not carry. The ones it does are below; pick one of those, ' +
    `or see every catalogue's universes at ${UNIVERSES_PAGE}`,
  emptyList:
    "The audiobook shelf does not file anything under a universe at the moment.\n\n" +
    '⚠️ That is a statement about the **audiobook catalogue**, not about the estate: the print and ' +
    `board-game catalogues keep their own universe rows, and ${UNIVERSES_PAGE} shows all three.`,
  /** ⚠️ The coverage sentence. It rides EVERY answer, not just the empty one:
   * a reader who sees "The Cosmere — 21 works" and is not told which shelf that
   * counted will reasonably assume it counted the house. */
  scopeNote:
    `\n\n_Counted on the public **audiobook** shelf only — the print and board-game catalogues are ` +
    `not reachable from Discord (the estate index only widens for a caller holding a Firebase ` +
    `sign-in, which a Discord bot cannot produce). All three catalogues' universes: ${UNIVERSES_PAGE}_`,
  overflow: (shown: number, total: number) => `\n\n_Showing ${shown} of ${total}._`,
} as const;

/** One rendered line per universe in the listing. */
export function renderUniverseLine(row: { universe: string; count: number }): string {
  return `**${truncate(row.universe, 120)}** — ${row.count} work${row.count === 1 ? '' : 's'}`;
}

/**
 * One rendered line per work inside a universe. ⚠️ The SERIES is carried where
 * the catalogue has one, because "which Mistborn book" is the question a person
 * asks next, and a bare title list makes them ask it.
 */
export function renderUniverseWork(row: CatalogRow): string {
  const head = `**${truncate(row.title, 100)}**`;
  const by = row.author ? ` — ${truncate(row.author, 60)}` : '';
  const series = row.series
    ? ` · _${truncate(row.series, 60)}${row.seriesIndex ? ` #${row.seriesIndex}` : ''}_`
    : '';
  return `${head}${by}${series}`;
}

/**
 * The whole answer, pure. Two shapes in one function because they are one
 * question asked at two zoom levels, and splitting them would let the coverage
 * footnote drift onto only one of them.
 */
export function buildUniverseAnswer(
  rows: readonly CatalogRow[],
  asked: string,
): { embeds: unknown[] } {
  const wanted = asked.trim();
  const all = knownUniverses(rows);

  // ── No argument: the list of universes the shelf actually files under. ──
  if (!wanted) {
    const shown = all.slice(0, UNIVERSE_MAX_LIST);
    const description =
      shown.length === 0
        ? UNIVERSE_MSG.emptyList
        : shown.map(renderUniverseLine).join('\n') +
          (all.length > shown.length ? UNIVERSE_MSG.overflow(shown.length, all.length) : '') +
          UNIVERSE_MSG.scopeNote;
    return {
      embeds: [
        {
          title:
            shown.length === 0
              ? 'No universes on this shelf'
              : `The estate's universes — ${all.length} on the audiobook shelf`,
          description: truncate(description, 4000),
          color: EMBED_COLOR,
        },
      ],
    };
  }

  // ── A named universe: its works, its authors, its print crossover. ──
  const matches = filterCatalog(rows, { universe: wanted });
  if (matches.length === 0) {
    const description =
      UNIVERSE_MSG.noSuchUniverse(truncate(wanted, 100)) +
      (all.length > 0 ? `\n\n${all.slice(0, UNIVERSE_MAX_LIST).map(renderUniverseLine).join('\n')}` : '') +
      UNIVERSE_MSG.scopeNote;
    return {
      embeds: [
        {
          title: truncate(`No universe called “${wanted}”`, 256),
          description: truncate(description, 4000),
          color: EMBED_COLOR,
        },
      ],
    };
  }

  // ⚠️ The catalogue's OWN spelling of the name, taken from a matched row —
  // never the caller's. `filterCatalog` folds articles and punctuation away, so
  // "cosmere" matches "The Cosmere", and echoing the typed word back would
  // quietly rename the estate's universe in the answer.
  const canonical = matches[0]?.universe ?? wanted;
  const stats = summarise(matches);
  const shown = matches.slice(0, UNIVERSE_MAX_WORKS);
  const facts =
    `${stats.total} work${stats.total === 1 ? '' : 's'} · ` +
    `${stats.distinctSeries} series · ${stats.distinctAuthors} author${stats.distinctAuthors === 1 ? '' : 's'}` +
    // ⚠️ NOT a count of the library catalogue — it is the library edition the
    // audiobook pipeline already matched to these same works. `summarise`'s own
    // warning, restated where a reader meets the number.
    (stats.alsoInPrintOrEbook > 0
      ? ` · ${stats.alsoInPrintOrEbook} also matched to a print or ebook edition`
      : '');

  const description =
    `${facts}\n\n` +
    shown.map(renderUniverseWork).join('\n') +
    (matches.length > shown.length ? UNIVERSE_MSG.overflow(shown.length, matches.length) : '') +
    UNIVERSE_MSG.scopeNote;

  return {
    embeds: [
      {
        title: truncate(canonical, 256),
        description: truncate(description, 4000),
        color: EMBED_COLOR,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flow — runs in waitUntil after the deferred ephemeral ack
// ---------------------------------------------------------------------------

export interface UniverseContext {
  name: string;
  applicationId: string;
  interactionToken: string;
  catalogBaseUrl: string;
  fetchOverride?: typeof fetch;
}

/** Answer `/universe`. Never throws — a throw would leave Discord's spinner up
 * forever with no explanation. */
export async function processUniverse(ctx: UniverseContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    const load = await loadCatalog(
      ctx.catalogBaseUrl,
      ctx.fetchOverride ? { fetch: ctx.fetchOverride } : undefined,
    );
    // ⚠️ The catalogue is the ONLY source here, so its failure is the answer's
    // failure — worded as an outage, never as "no universes".
    if (!load.ok) {
      await say({ content: UNIVERSE_MSG.unreachable });
      return;
    }
    await say(buildUniverseAnswer(load.rows, ctx.name));
  } catch (err) {
    console.error('/universe failed:', err instanceof Error ? err.message : err);
    try {
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: UNIVERSE_MSG.unreachable,
      });
    } catch {
      // Token expired or Discord is down; nothing further is possible.
    }
  }
}
