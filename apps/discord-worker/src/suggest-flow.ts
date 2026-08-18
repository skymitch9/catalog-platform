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
import type { DelegatePort, LibraryInstance } from './delegated.js';
import type { ShelfPort, ReviewRow, TbrRow } from './shelf.js';
import {
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
