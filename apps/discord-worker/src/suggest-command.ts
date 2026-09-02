/**
 * `/suggest` — the suggestion lane, given a front door.
 *
 * ## ⚠️ NOTHING HERE IS RE-DESIGNED, AND THAT IS THE POINT
 *
 * `gabi-suggestions-design.md` is BUILT: the three-format permission model
 * (§1), the gate-before-gathering order (§3), the quality ladder with its own
 * WHY clause per rung (§5), the four-star `LIKED_RATING` threshold, the
 * exclusion of anything already reviewed, and the 10f incident's two fixes
 * (never ask instead of answering; a mood improves the picks and can never open
 * a shelf) all live in `suggest.ts` and `suggest-flow.ts`. Every one of them is
 * REUSED here, unchanged.
 *
 * What was missing was a **door**: the lane could only be reached by @mentioning
 * GABI and phrasing the request so `suggestIntent()` claimed the turn — which is
 * exactly the surface the 10f incident showed a stranger failing to find
 * (*"NOBODY ASKS FOR A RECOMMENDATION. THEY ASK FOR SOMETHING GOOD."*). A slash
 * command cannot be missed by a detector, because there is no detector: typing
 * `/suggest` IS the intent, stated by the person.
 *
 * ## ⚠️ AND IT SPENDS NOTHING
 *
 * The mention path hands the candidate rows to the model, which writes the
 * sentences. This one **renders the rows deterministically** — the composer's
 * own `why` clause per candidate, already written by `buildSuggestions()`
 * against the person's real ratings. Consequences, all deliberate:
 *
 *  - **No LLM call, so no money path.** `/suggest` is not a new row in
 *    `llm-billing-control-design.md`'s inventory of 36 spending paths.
 *  - **No fabrication surface at all.** §6's grounding rule ("every suggested
 *    row came from a lookup made THIS turn") is enforced by the data in the
 *    mention path and by the *absence of a model* here.
 *  - ⚠️ **It reads flatter than she does.** That is the honest trade, and the
 *    answer says where her voice lives: @mention her for the conversation.
 *
 * ## The format option, and the one rule it must not break
 *
 * ⚠️ **`format` IS AN EXPLICIT WORD OR IT IS NOTHING** — §4's rule, and the
 * whole permission model rests on it: a Discord CHOICE option is as explicit as
 * a word gets, so a chosen `ebook`/`physical` reaches its gate exactly as a
 * typed one does, and an UNCHOSEN format falls back to **audio**, the public
 * slice `audiobooks.heygabi.ai` publishes to the open internet. ⚠️ No gate is
 * bypassed by that fallback (10f's third finding); the answer says which shelf
 * it looked at and how to ask for the other two.
 *
 * ⚠️ **`mood` IS FREE TEXT AND CAN NEVER OPEN A SHELF** — §10f's own boundary,
 * preserved here structurally: the mood string is passed to
 * `suggestMoodHints()` and shown as context, and it is never consulted by
 * `formatAsked`. A mood improves the picks; it is not a format and never
 * becomes one.
 */

import type { BooksPort } from './book-knowledge.js';
import type { DelegatePort, LibraryInstance } from './delegated.js';
import { editOriginalMessage } from './discord-api.js';
import { EMBED_COLOR, truncate } from './have.js';
import type { ShelfPort } from './shelf.js';
import {
  PHYSICAL_SOURCE_INSTANCE,
  SUGGEST_MSG,
  suggestMoodHints,
  type SuggestCandidate,
  type SuggestFormat,
} from './suggest.js';
import { gatherSuggestions, suggestGate } from './suggest-flow.js';

/** The three shelves, as Discord choice values. ⚠️ The SAME three strings
 * `SuggestFormat` uses — a fourth spelling here would be a fourth shelf as far
 * as the gate is concerned. */
export const SUGGEST_FORMAT_CHOICES = ['audio', 'ebook', 'physical'] as const;

export function isSuggestFormat(v: string): v is SuggestFormat {
  return (SUGGEST_FORMAT_CHOICES as readonly string[]).includes(v);
}

/** ⚠️ REJECTED, NEVER COERCED. A `format` Discord did not offer is a
 * hand-crafted interaction; silently treating it as `audio` would answer a
 * question nobody asked. */
export const SUGGEST_CMD_MSG = {
  badFormat: (given: string) =>
    `**${truncate(given, 40)}** is not one of the shelves GABI can pick from — it is ` +
    '`audio`, `ebook` or `physical`. Nothing went wrong; run `/suggest` again and choose one from ' +
    'the list (or leave it blank for the audiobook shelf).',
  notLinkedYet:
    "GABI could not tell who you are on the estate, so these are un-personalised picks off the " +
    'public shelf rather than ones built on your own ratings. Run **/link** once and ask again and ' +
    'they will be about you.',
  /** ⚠️ §6's rule: a failed shelf read CHANGES the answer, it does not cancel
   * it — and she must not imply she checked when she could not. */
  shelfDown:
    '\n\n⚠️ _GABI could not read your own shelf just now, so these picks are real books but they ' +
    'are **not** built on your ratings — that is a wobble on our side, not an empty shelf._',
  audioFallback:
    '\n\n_Looked at the **audiobook** shelf, which is the one everybody can see. Ask for `ebook` or ' +
    '`physical` and GABI will check whether the estate has opened those to you._',
  voice: '\n\n_Straight from the shelf, no commentary — @mention GABI if you want her opinion on it._',
} as const;

/** One candidate as a rendered line. ⚠️ The `why` is the composer's own, per
 * rung — never re-worded here, because the WHY is the half that proves the pick
 * came from this person's ratings rather than from a taste model. */
export function renderCandidate(c: SuggestCandidate): string {
  const head = c.author ? `**${truncate(c.title, 110)}** — ${truncate(c.author, 60)}` : `**${truncate(c.title, 110)}**`;
  const series = c.series ? ` · _${truncate(c.series, 50)}${c.seriesIndex ? ` #${c.seriesIndex}` : ''}_` : '';
  const link = c.url ? ` · [open](${c.url})` : '';
  return `${head}${series}${link}\n_${truncate(c.why, 220)}_`;
}

export function buildSuggestAnswer(
  candidates: readonly SuggestCandidate[],
  format: SuggestFormat,
  opts: { shelfUnavailable: boolean; assumedAudio: boolean; mood: string[] },
): { embeds: unknown[] } {
  const moodLine =
    opts.mood.length > 0 ? `_Picked with this in mind: ${truncate(opts.mood.join('; '), 300)}._\n\n` : '';
  const description =
    moodLine +
    candidates.map(renderCandidate).join('\n\n') +
    (opts.shelfUnavailable ? SUGGEST_CMD_MSG.shelfDown : '') +
    (opts.assumedAudio ? SUGGEST_CMD_MSG.audioFallback : '') +
    SUGGEST_CMD_MSG.voice;
  return {
    embeds: [
      {
        title: `A few ${format} picks`,
        description: truncate(description, 4000),
        color: EMBED_COLOR,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export interface SuggestCommandContext {
  /** The chosen choice value, or `''` when the option was left out. */
  format: string;
  mood: string;
  applicationId: string;
  interactionToken: string;
  catalogBaseUrl: string;
  discordUserId: string | null;
  /** `GABI_SUGGEST`. ⚠️ The SAME lever the mention lane obeys — a second one
   *  could disagree with it, and then "is it on?" would have two answers. */
  suggestOn: boolean;
  shelf: ShelfPort | null;
  books: BooksPort | null;
  delegated: { port: DelegatePort; instances: readonly LibraryInstance[] } | null;
  fetchOverride?: typeof fetch;
}

/** Answer `/suggest`. Never throws. */
export async function processSuggestCommand(ctx: SuggestCommandContext): Promise<void> {
  const say = async (payload: unknown) => {
    await editOriginalMessage(ctx.applicationId, ctx.interactionToken, payload);
  };
  try {
    if (!ctx.suggestOn) {
      await say({ content: SUGGEST_MSG.switchedOff });
      return;
    }
    const given = (ctx.format ?? '').trim();
    if (given && !isSuggestFormat(given)) {
      await say({ content: SUGGEST_CMD_MSG.badFormat(given) });
      return;
    }
    const assumedAudio = given.length === 0;
    const format: SuggestFormat = assumedAudio ? 'audio' : (given as SuggestFormat);

    // ⚠️ A suggestion is built on the asker's OWN shelf, so an anonymous caller
    // (no Discord user on the payload at all — a shape Discord should not send,
    // but the type allows) gets the public audio path and is told so.
    const discordUserId = ctx.discordUserId ?? '';
    if (!discordUserId && format !== 'audio') {
      await say({ content: SUGGEST_MSG.ebookNotLinked });
      return;
    }

    // ── ⚠️ THE GATE, BEFORE THE GATHERING (design §3) ──────────────────────
    // Somebody who may not be suggested a physical book must not have their
    // reading list read in order to be told so.
    if (format !== 'audio') {
      const gate = await suggestGate(format, {
        discordUserId,
        ...(ctx.books ? { books: ctx.books } : {}),
        ...(ctx.delegated ? { delegated: ctx.delegated } : {}),
      });
      if (!gate.ok) {
        await say({ content: gate.message });
        return;
      }
    }

    // ── The physical source is the library's OWN shelf, not the CSV join ────
    let browsed: { rows: readonly unknown[]; total: number } | null = null;
    if (format === 'physical' && ctx.delegated) {
      const instance = ctx.delegated.instances.find((i) => i.app === PHYSICAL_SOURCE_INSTANCE);
      const link = instance ? await ctx.delegated.port.linkedUid(discordUserId) : null;
      if (instance && link?.ok) {
        const page = await ctx.delegated.port.browseWorks(instance, link.uid);
        browsed = page ? { rows: page.rows, total: page.total } : null;
      }
    }

    const gathered = await gatherSuggestions({
      catalogBaseUrl: ctx.catalogBaseUrl,
      format,
      ...(format === 'physical'
        ? { browsed: browsed as Parameters<typeof gatherSuggestions>[0]['browsed'] }
        : {}),
      ...(ctx.shelf && discordUserId ? { shelf: { port: ctx.shelf, discordUserId } } : {}),
      ...(ctx.fetchOverride ? { fetchOverride: ctx.fetchOverride } : {}),
    });

    // ⚠️ NO CATALOGUE MEANS NO SUGGESTION, worded as our outage. An empty list
    // dressed as an answer would say "there is nothing for you" about a shelf of
    // more than a thousand books.
    if (!gathered) {
      await say({ content: SUGGEST_MSG.estateUnreachable });
      return;
    }
    if (gathered.candidates.length === 0) {
      await say({ content: SUGGEST_MSG.nothingLeft(format) });
      return;
    }

    await say(
      buildSuggestAnswer(gathered.candidates, format, {
        shelfUnavailable: gathered.shelfUnavailable,
        assumedAudio,
        // ⚠️ The mood reaches the PICKS as context and never the gate.
        mood: suggestMoodHints(ctx.mood ?? ''),
      }),
    );
  } catch (err) {
    console.error('/suggest failed:', err instanceof Error ? err.message : err);
    try {
      await editOriginalMessage(ctx.applicationId, ctx.interactionToken, {
        content: SUGGEST_MSG.estateUnreachable,
      });
    } catch {
      // Token expired or Discord is down; nothing further is possible.
    }
  }
}
