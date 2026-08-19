/**
 * **THE SUGGESTION LANE'S MOVING PARTS** — the gate, and the gathering.
 *
 * `suggest.ts` is the contract and is pure; this file is what actually asks the
 * estate things. ⚠️ **It holds no credential either**: every port arrives
 * injected, exactly as `delegated-flow.ts` receives `DelegatePort`, so the
 * five-modules-hold-a-secret guard is untouched and no sixth trust edge is
 * created by this feature.
 *
 * ## ⚠️ THE GATE IS ASKED BEFORE ANYTHING IS GATHERED
 *
 * Order matters and is not an optimisation: a person who may not be suggested a
 * physical book must not have their reading list read in order to be told so.
 * The refusal is decided from identity alone.
 *
 * ## ⚠️ THE PHYSICAL GATE USES `whoami`, WHICH IS THE ONLY PER-INSTANCE SIGNAL
 *
 * `suggest.ts` records the measurement: `library_work_id` is a bare integer that
 * names no instance, and the index cannot be widened per-asker from Discord. The
 * one thing that CAN answer "can this person see that table" is the delegated
 * `whoami` verb — it writes nothing, spends nothing, and is the same call the
 * Tier-1 router already makes to decide which shelf a write goes to.
 *
 * ⚠️ **A `null` answer is UNREACHABLE and is worded as our outage, never as "you
 * have no account there."** `delegated.ts` makes the same distinction for the
 * same reason: conflating them is how an outage becomes an accusation.
 */

import { loadCatalog, type CatalogRow } from './catalog-data.js';
import type { BooksPort } from './book-knowledge.js';
import type { BrowseWork, DelegatePort, LibraryInstance } from './delegated.js';
import type { ShelfPort, ReviewRow, TbrRow } from './shelf.js';
import {
  bookIdFromTitle,
  buildSuggestions,
  PHYSICAL_SOURCE_INSTANCE,
  SUGGEST_MSG,
  SUGGEST_ROWS,
  type SuggestCandidate,
  type SuggestFormat,
} from './suggest.js';

/** ⚠️ `ok: false` always carries the sentence. There is no path here that
 *  produces a refusal somebody would have to word later — that is how a bare
 *  status reaches a person. */
export type SuggestGate = { ok: true } | { ok: false; message: string };

export interface SuggestGateContext {
  discordUserId: string;
  /** Tier 0c's port. ⚠️ Present only when `GABI_BOOKS` is on AND a port was
   *  built — its absence is why an ebook suggestion can be refused as a SETUP
   *  gap rather than a permission one. */
  books?: BooksPort;
  /** Tier 1's port plus the instances this deployment may reach. */
  delegated?: { port: DelegatePort; instances: readonly LibraryInstance[] };
}

/**
 * May this person be suggested a book of this format?
 *
 * ⚠️ **AUDIO IS UNGATED, and that is a decision with a measurement behind it**
 * rather than an omission: the candidates come from `catalog.csv`, which
 * `audiobooks.heygabi.ai` publishes to the open internet with
 * `access-control-allow-origin: *`. Gating a suggestion drawn from it would
 * refuse somebody a fact the web already hands to strangers.
 */
export async function suggestGate(
  format: SuggestFormat,
  ctx: SuggestGateContext,
): Promise<SuggestGate> {
  if (format === 'audio') return { ok: true };
  if (format === 'ebook') return await ebookGate(ctx);
  return await physicalGate(ctx);
}

/**
 * ⚠️ **THE EXISTING PER-ASKER EBOOK GATE, ASKED RATHER THAN RE-IMPLEMENTED.**
 *
 * `vis_ebooks` lives in the estate directory and is resolved by the audiobook
 * Worker. This end has no copy of it and must never grow one — a second holder
 * of a permission decision is a second thing to forget to revoke. So the gate is
 * a real call whose 403 is the answer, and the refusal it relays is the estate's
 * own sentence.
 */
async function ebookGate(ctx: SuggestGateContext): Promise<SuggestGate> {
  if (!ctx.books) {
    // ⚠️ A SETUP GAP, never phrased as a permissions one. With `GABI_BOOKS` off
    // there is nothing here that can ask the estate about `vis_ebooks`, and
    // guessing "yes" would hand somebody an ebook the estate never granted.
    return { ok: false, message: SUGGEST_MSG.notConfigured };
  }
  const who = await ctx.books.askerEmail(ctx.discordUserId);
  if (!who.ok) {
    if (who.reason === 'unlinked') return { ok: false, message: SUGGEST_MSG.ebookNotLinked };
    if (who.reason === 'no_email') return { ok: false, message: SUGGEST_MSG.ebookLinkIncomplete };
    return { ok: false, message: SUGGEST_MSG.estateUnreachable };
  }
  // ⚠️ The cheapest call on the port: the knowledge-base LISTING, which is the
  // one thing behind this gate that returns no book text at all. It is asked for
  // its STATUS, not its body.
  const probe = await ctx.books.available(who.email, '');
  if (probe.ok) return { ok: true };
  if (probe.status === 403) {
    return { ok: false, message: probe.message ?? SUGGEST_MSG.ebookNotGranted };
  }
  // ⚠️ Anything else is an outage. A 500 is not a refusal, and saying otherwise
  // sends somebody asking for access they already hold.
  return { ok: false, message: SUGGEST_MSG.estateUnreachable };
}

/**
 * ⚠️ **THE OWNER'S OWN SENTENCE, ENFORCED**: *"For physical I only want her to
 * suggest a physical book to a linked person who can view a book from the table
 * she's suggesting."*
 *
 * Two facts must both be true, and they are read in this order because the
 * cheaper one can refuse without a network call to a catalog:
 *
 *  1. **linked** — the `discord_links` document exists and carries a uid;
 *  2. **can view that table** — the instance the print row is drawn from
 *     (`PHYSICAL_SOURCE_INSTANCE`) says it KNOWS this person.
 *
 * ⚠️ **`known` is the right question and `capabilities` is not.** The Tier-1
 * router asks about `editCatalog` because a write needs a capability; being able
 * to *see* a shelf is what having an account there means. A reader with no edit
 * rights can still walk to the bookcase.
 */
async function physicalGate(ctx: SuggestGateContext): Promise<SuggestGate> {
  const instance = ctx.delegated?.instances.find((i) => i.app === PHYSICAL_SOURCE_INSTANCE);
  if (!ctx.delegated || !instance) {
    return { ok: false, message: SUGGEST_MSG.physicalNotConfigured };
  }
  const link = await ctx.delegated.port.linkedUid(ctx.discordUserId);
  if (!link.ok) {
    return {
      ok: false,
      message:
        link.reason === 'unlinked' ? SUGGEST_MSG.physicalNotLinked : SUGGEST_MSG.estateUnreachable,
    };
  }
  const who = await ctx.delegated.port.whoami(instance, link.uid);
  // ⚠️ UNREACHABLE ≠ UNKNOWN. Worded as our outage, and it names the shelf so
  // the sentence is about something rather than about nothing.
  if (who === null) {
    return { ok: false, message: SUGGEST_MSG.physicalUnreachable(instance.label) };
  }
  if (!who.known) {
    return {
      ok: false,
      message: SUGGEST_MSG.physicalNotShared(instance.label, instance.baseUrl),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The gathering
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE PHYSICAL SOURCE, AS OF 2026-08-19 — the library's OWN shelf.**
 *
 * Until today a physical suggestion was drawn from `catalog.csv`'s cross-linked
 * print rows: 64 of 1,079, a slice of the audiobook catalogue's own join. The
 * owner asked for a physical book and was told his shelves looked empty. ⚠️ The
 * estate's print catalogue holds **448 works**, of which **341** carry a held
 * physical copy — and none of them were reachable from here.
 *
 * `browse-works` is that shelf, read on the asker's behalf. ⚠️ **The gate is
 * unchanged and still sits in front**: `physicalGate` decides whether this
 * person may be pointed at that instance at all, and this only changes what the
 * ALLOWED path reads.
 *
 * ⚠️ **A row with `formats: []` IS SUGGESTIBLE.** The contract defines it as
 * *"held, printing not typed in yet"* — six rows today — and dropping them would
 * hide books the house really owns behind a data-entry gap.
 */
export interface BrowsedPhysical {
  rows: readonly BrowseWork[];
  total: number;
}

export interface GatheredSuggestions {
  candidates: SuggestCandidate[];
  /** ⚠️ True when the asker's own shelf could NOT be read. The suggestions are
   *  still real rows, but they are un-personalised and the caller must not let
   *  her imply otherwise. */
  shelfUnavailable: boolean;
}

/**
 * Fetch what a suggestion is made of, and compose it.
 *
 * ⚠️ **THE SHELF READS ARE ALLOWED TO FAIL, AND THE CATALOGUE READ IS NOT.**
 * Without the catalogue there are no rows and therefore no suggestion. Without
 * the reviews there is still a real, honest, less personal one — and refusing
 * the whole answer because the personalisation failed would trade a good answer
 * for none.
 *
 * ⚠️ **BOTH SHELF READS AND THE CATALOGUE GO OUT TOGETHER.** Nothing here
 * depends on anything else here, so the turn pays the slowest rather than their
 * sum — the same latency decision the mention path already makes for its three
 * context loads.
 */
export async function gatherSuggestions(opts: {
  catalogBaseUrl: string;
  format: SuggestFormat;
  shelf?: { port: ShelfPort; discordUserId: string };
  fetchOverride?: typeof fetch;
  limit?: number;
  /** ⚠️ The library's OWN print shelf, already fetched by the caller (which is
   *  the half that holds the delegated port). Present only for `physical`. */
  browsed?: BrowsedPhysical | null;
}): Promise<GatheredSuggestions | null> {
  const overrides = opts.fetchOverride ? { fetch: opts.fetchOverride } : undefined;

  const shelfReads = opts.shelf
    ? (async (): Promise<{ reviews: ReviewRow[]; tbr: TbrRow[]; ok: boolean } | null> => {
        const who = await opts.shelf!.port.asker(opts.shelf!.discordUserId);
        // ⚠️ NOT LINKED IS NOT AN ERROR HERE. An audiobook suggestion is offered
        // to anybody, so an unlinked asker simply gets an un-personalised one —
        // refusing them would gate the public shelf behind a link the format
        // does not require.
        if (!who.ok) return { reviews: [], tbr: [], ok: who.reason === 'unlinked' };
        const [reviews, tbr] = await Promise.all([
          opts.shelf!.port.myReviews(who.asker),
          opts.shelf!.port.myTbr(who.asker),
        ]);
        return {
          reviews: reviews.ok ? reviews.rows : [],
          tbr: tbr.ok ? tbr.rows : [],
          ok: reviews.ok && tbr.ok,
        };
      })()
    : Promise.resolve(null);

  // ── ⚠️ PHYSICAL COMES FROM THE LIBRARY'S OWN SHELF ──────────────────────
  //
  // Not from `catalog.csv`'s cross-linked print rows, which are a slice of the
  // AUDIOBOOK catalogue's join (64 of 1,079) and which told the owner his
  // shelves were empty when the print catalogue holds 448 works.
  //
  // ⚠️ **IT RETURNS BEFORE THE AUDIOBOOK CATALOGUE IS EVEN CONSULTED**, and that
  // is deliberate rather than an optimisation: the audiobook CSV contributes
  // NOTHING to a physical answer, so letting its outage return `null` here would
  // kill a suggestion the library could have answered perfectly.
  //
  // ⚠️ `browsed === null` means the verb errored or refused. That becomes an
  // EMPTY candidate list, whose constant sentence says the lookup came back
  // empty and names it as OUR limit — never as a fact about his shelves.
  if (opts.format === 'physical') {
    const shelfNow = await shelfReads;
    if (!opts.browsed) {
      return { candidates: [], shelfUnavailable: shelfNow !== null && !shelfNow.ok };
    }
    const reviewed = new Set((shelfNow?.reviews ?? []).map((r) => r.bookId).filter(Boolean));
    const candidates = opts.browsed.rows
      // ⚠️ Excluded the same way every other rung excludes: by REVIEW, the only
      // record the estate keeps. Never "already read".
      .filter((r) => !reviewed.has(bookIdFromTitle(r.title)))
      .slice(0, opts.limit ?? SUGGEST_ROWS)
      .map((r) => physicalCandidate(r));
    return { candidates, shelfUnavailable: shelfNow !== null && !shelfNow.ok };
  }

  const [load, shelf] = await Promise.all([
    loadCatalog(opts.catalogBaseUrl, overrides),
    shelfReads,
  ]);

  if (!load.ok) return null;

  const rows: readonly CatalogRow[] = load.rows;
  return {
    candidates: buildSuggestions({
      rows,
      reviews: shelf?.reviews ?? [],
      tbr: shelf?.tbr ?? [],
      format: opts.format,
      limit: opts.limit ?? SUGGEST_ROWS,
    }),
    shelfUnavailable: shelf !== null && !shelf.ok,
  };
}

/**
 * One library row as a suggestion.
 *
 * ⚠️ **`url` IS USED VERBATIM** — assembling one here would be a second
 * implementation of that site's routing, in a repo that does not deploy it.
 *
 * ⚠️ **`formats: []` IS NOT "not physical"** — it is *held, printing not typed
 * in yet*. The WHY says so in plain words rather than dropping the book or
 * inventing an edition for it.
 */
function physicalCandidate(r: BrowseWork): SuggestCandidate {
  const formats = r.formats.filter(Boolean);
  const shelf = formats.length > 0
    ? `the library, in ${formats.join(' and ').toLowerCase()}`
    : 'the library — a copy is held, though the edition has not been typed in yet';
  const why = formats.length > 0
    ? `it is on the library shelf in ${formats.join(' and ').toLowerCase()} and you have not written about it`
    : 'the library has a copy on the shelf — the edition is not recorded yet, but the book is there';
  return {
    title: r.title,
    // ⚠️ null authors stay unattributed. A sentinel would print as an author.
    author: r.authors ?? '',
    bookId: bookIdFromTitle(r.title),
    ...(r.series ? { series: r.series } : {}),
    ...(r.seriesIndex != null ? { seriesIndex: String(r.seriesIndex) } : {}),
    shelf,
    why,
    basis: 'shelf',
    url: r.url,
  };
}
