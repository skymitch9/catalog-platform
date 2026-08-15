/**
 * Reading books off a photograph of a shelf or a cover — the estate's
 * shelf-scan vision call (docs/info/estate-scan-adoption.md).
 *
 * PORTED, not re-derived, from library_catalog's real, proven, iOS-tested
 * pipeline: the prompts and JSON schemas below are `packages/core/src/
 * vision.ts`'s SHELF_SYSTEM/SHELF_SCHEMA and COVER_SYSTEM/COVER_SCHEMA,
 * copied CHARACTER-FOR-CHARACTER; the call shape is `apps/worker/src/lib/
 * vision.ts`'s readShelf() — one Anthropic Messages call, one image content
 * block, structured output via `output_config.format.json_schema`, refusal/
 * truncation checked BEFORE parsing.
 *
 * WHAT CHANGED FROM LIBRARY_CATALOG'S VERSION, AND WHY (do not re-derive —
 * these are the deliberate deltas, everything else is the same file):
 *
 *   - No D1 persistence, no scan-job bookkeeping, no `matching.ts` /
 *     `buildWorkIndex` catalog-index step. The estate apex has no per-catalog
 *     work table to match a spine against — matching is the CLIENT re-running
 *     <estate-search>'s own `_runSearch()` once per identified title against
 *     the shared cross-catalog index this very Worker already serves
 *     (search-route.ts). This file's job stops at photo → structured titles;
 *     it is stateless and does no D1 read at all.
 *   - `packages/core` + `apps/worker/src/lib` are ONE file here, not two.
 *     library_catalog splits the pure prompt/schema data (no I/O, safe to
 *     import from anywhere) from the network call because `packages/core`
 *     is a leaf package under an explicit no-I/O contract with many
 *     consumers. index-worker has no such leaf layer and exactly one
 *     consumer of this module (scan.ts) — so keeping two files would be
 *     structure for its own sake. The prompts/schemas are still copied
 *     verbatim; only the file boundary moved.
 *   - The model, the cost constants, MAX_TOKENS, the deliberate absence of
 *     `cache_control`, and the refusal/truncation/parse-order discipline are
 *     UNCHANGED — see the comments inline, carried over with the code they
 *     explain.
 */

import Anthropic from '@anthropic-ai/sdk';

// ===========================================================================
// Types + schema + prompts — verbatim from library_catalog's
// packages/core/src/vision.ts (SHELF_SCHEMA, SHELF_SYSTEM, COVER_SCHEMA,
// COVER_SYSTEM, ShelfBook, ShelfReading). Do not edit without editing the
// source of truth there too, or the two will drift.
// ===========================================================================

/**
 * One book read off a spine or cover, before anything tries to resolve it.
 *
 * `author` is required rather than optional-by-omission — a spine that
 * genuinely shows no author answers `null`; what must never happen is
 * quietly not asking.
 */
export interface ShelfBook {
  /** Exactly the text as printed, no expansion or correction. */
  text: string;
  /** The author as printed on the spine, or null when the spine shows none. */
  author: string | null;
  confidence: 'high' | 'medium' | 'low';
  /** Where on the shelf, left to right, so a person can find it again. */
  position: number;
  /** Why it is uncertain: glare, partly hidden, stylised type, spine too worn. */
  note: string | null;
  /**
   * The three below are populated by the COVER read and left undefined by the
   * shelf read — a spine almost never prints them.
   */
  series?: string | null;
  volume?: number | null;
  publisher?: string | null;
}

/**
 * What one read of a whole photograph produced.
 *
 * `unreadable` is not the same as an empty `books` array: "that photo cannot
 * be read, take another" versus "that is a shelf with no books the model
 * could name". Only the first is worth retrying.
 */
export interface ShelfReading {
  books: ShelfBook[];
  unreadable: boolean;
  inputTokens: number;
  outputTokens: number;
  /** Rough, at list price. Shown to the person who is spending it. */
  estimatedCents: number;
}

/** The output contract for a shelf read, as a JSON Schema. Structured output. */
export const SHELF_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          author: { type: ['string', 'null'] },
          position: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: ['string', 'null'] },
        },
        required: ['text', 'author', 'position', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: { type: 'boolean' },
  },
  required: ['books', 'unreadable'],
  additionalProperties: false,
} as const;

/** One cover, and three fields a spine cannot give you. */
export const COVER_SCHEMA = {
  type: 'object',
  properties: {
    books: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          author: { type: ['string', 'null'] },
          series: { type: ['string', 'null'] },
          volume: { type: ['number', 'null'] },
          publisher: { type: ['string', 'null'] },
          position: { type: 'integer' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: ['string', 'null'] },
        },
        required: ['text', 'author', 'series', 'volume', 'publisher', 'position', 'confidence', 'note'],
        additionalProperties: false,
      },
    },
    unreadable: { type: 'boolean' },
  },
  required: ['books', 'unreadable'],
  additionalProperties: false,
} as const;

export const COVER_SYSTEM = `You are reading the FRONT COVER of a single book from a photograph.

Return exactly one entry — the book whose cover this is. Not the books behind it,
not a book named in a cover quote or a "by the author of" line.

Report:
- text:   the TITLE exactly as printed on the cover. If the cover shows a series
          name and a volume title, the volume title is the title. Do not merge
          them, and do not expand abbreviations.
- author: the author exactly as printed, or null if the cover genuinely shows
          none. Do NOT infer an author you cannot see — a guessed author is
          worse than none, because it will be trusted.
- series: the series name if the cover states one, else null.
- volume: the volume number if the cover states one, as a number, else null.
          Only when it is printed. Never inferred from the title's shape.
- publisher: the publisher or imprint if printed on the front, else null.
- position: always 1.
- confidence: high | medium | low.
- note: why it is uncertain — glare, angle, stylised type, partly out of frame —
        or null.

Rules:
- Report only what is printed. Never correct spelling, never complete a title
  from knowledge of the book, never translate.
- A cover quote, an award sticker, a tagline and a "soon to be a major series"
  banner are none of them the title.
- The largest text is usually the title, but not always — an author's name is
  set larger than the title on many genre covers. Prefer position and
  typography together over size alone.
- Set unreadable to true ONLY when the photograph itself has defeated you — too
  dark, too blurred, too angled, or not a book cover at all — and return an
  empty list with it.`;

export const SHELF_SYSTEM = `You are reading the spines of books on a shelf from a photograph.

Return one entry per distinct book, left to right (or top to bottom for a stack).

For each spine, report:
- text:   the BOOK's title exactly as printed. If the spine shows both a series
          name and a volume title, the volume title is the title. Do not merge
          them, and do not expand abbreviations.
- author: the author exactly as printed on the spine, or null if the spine
          genuinely shows no author. Do NOT infer an author you cannot see —
          a guessed author is worse than none, because it will be trusted.
- position: 1-based, left to right.
- confidence: high | medium | low.
- note: why it is uncertain — glare, partly hidden, worn lettering, stylised
        type, spine turned away — or null.

Rules:
- Report only what is printed. Never correct spelling, never complete a title
  from knowledge of the book, never translate.
- A publisher name or imprint (Tor, Gollancz, Orbit, Penguin) is not an author
  and not a title. Ignore colophons.
- If two adjacent spines are the same book (two copies), report both.
- If you cannot read a spine at all, still report it with text as best you can
  and confidence "low", rather than omitting it — a missing book is invisible,
  an uncertain one gets checked.
- Set unreadable to true ONLY when the photograph itself has defeated you — too
  dark, too blurred, too far away, or not a shelf of books at all — and return
  an empty list with it. A shelf you could read that simply has few books on it
  is readable; say so with unreadable false. The two answers lead to different
  advice, and only one of them is worth paying to photograph again.`;

// ===========================================================================
// The call — verbatim from library_catalog's apps/worker/src/lib/vision.ts
// readShelf(), trimmed of the D1/job bits per estate-scan-adoption.md.
// ===========================================================================

/**
 * `claude-opus-5`: $5 / MTok in, $25 / MTok out. Reading print off a
 * photograph is perception rather than reasoning, which is what
 * `effort: 'low'` below is for — but the *perception* has to be good, and a
 * cheaper model reading a paperback spine at an angle is a false economy.
 */
export const VISION_MODEL = 'claude-opus-5';

const CENTS_PER_MTOK_IN = 500;
const CENTS_PER_MTOK_OUT = 2500;

/**
 * Ceiling for one shelf read, covering thinking *and* the JSON.
 *
 * ⚠️ On `claude-opus-5` thinking is on by default — omitting the parameter
 * runs adaptive thinking. `max_tokens` is a budget for both, and a value
 * sized for the JSON alone truncates mid-answer. 8000 holds a dense shelf
 * (twenty-plus entries at ~40 tokens each) with room for low-effort
 * reasoning in front of it. Thinking is deliberately left on: disabling it
 * has a documented failure mode of leaking `<thinking>` tags into the
 * visible output, which for a structured-output call is a malformed answer
 * already paid for.
 */
const MAX_TOKENS = 8000;

export class VisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** True when trying the same photo again is a reasonable thing to do. */
    readonly retryable = false,
  ) {
    super(message);
  }
}

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof MEDIA_TYPES)[number];

export function isPhotoMediaType(v: string): v is PhotoMediaType {
  return (MEDIA_TYPES as readonly string[]).includes(v);
}

export interface Photo {
  /** Raw base64, no `data:` prefix — the client strips it before sending. */
  data: string;
  mediaType: PhotoMediaType;
}

function estimateCents(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * CENTS_PER_MTOK_IN +
    (outputTokens / 1_000_000) * CENTS_PER_MTOK_OUT
  );
}

/**
 * Turn an upstream failure into something the person holding the phone can
 * act on.
 *
 * ⚠️ The authentication branch exists because the sibling project got it
 * wrong once: a rejected API key surfaced as "could not read that photo",
 * which sent someone to check their lighting when the actual problem was a
 * rotated key that had never been pushed to production. An authentication
 * failure has nothing to do with the photograph and must never be described
 * as though it does.
 */
function explain(err: unknown): VisionError {
  if (err instanceof VisionError) return err;

  const status = (err as { status?: number })?.status;

  if (status === 401 || status === 403) {
    return new VisionError(
      'The Anthropic API key was rejected. This is a configuration problem, not a problem with your photo — the key was probably rotated without being pushed. Run `wrangler secret put ANTHROPIC_API_KEY --config apps/index-worker/wrangler.toml`.',
      503,
    );
  }
  if (status === 429) {
    return new VisionError('Rate limited by the Anthropic API. Wait a moment and try again.', 429, true);
  }
  if (status === 413) {
    return new VisionError('That photo is too large for the model. Take a wider, lower-resolution shot.', 413);
  }

  const detail = err instanceof Error ? err.message : String(err);
  return new VisionError(`Could not read that photo: ${detail}`, 502, true);
}

/**
 * Read every book you can off one photograph of a shelf, or the one book on
 * a cover photograph.
 *
 * Deliberately does no resolving — see the file header. Matching the titles
 * against a catalog is the CALLER's job (here: the client, per-title,
 * through this Worker's own /api/search).
 *
 * @param kind `'shelf'` reads many spines; `'cover'` reads one front cover and
 *   also returns series, volume and publisher.
 */
export async function readShelf(
  apiKey: string | undefined,
  photo: Photo,
  kind: 'shelf' | 'cover' = 'shelf',
): Promise<ShelfReading> {
  if (!apiKey) {
    throw new VisionError(
      'No Anthropic API key is configured, so photos cannot be read. `wrangler secret put ANTHROPIC_API_KEY --config apps/index-worker/wrangler.toml`.',
      503,
    );
  }

  const client = new Anthropic({ apiKey });

  let message;
  try {
    message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: MAX_TOKENS,
      output_config: {
        // Reading large print off a photograph is perception, not reasoning.
        effort: 'low',
        // Structured output: no "please reply with JSON", no code-fence
        // extraction, no retry-on-bad-parse. The API constrains the answer
        // to SHELF_SCHEMA/COVER_SCHEMA or fails loudly.
        format: {
          type: 'json_schema',
          schema: (kind === 'cover' ? COVER_SCHEMA : SHELF_SCHEMA) as unknown as Record<string, unknown>,
        },
      },
      // ⚠️ No `cache_control` here on purpose. SHELF_SYSTEM is around 400
      // tokens and the minimum cacheable prefix on this model is 512, so a
      // breakpoint would be silently ignored — `cache_creation_input_tokens: 0`
      // and no error. A marker that does nothing is worse than no marker,
      // because the next person reads it as evidence that caching is working.
      system: kind === 'cover' ? COVER_SYSTEM : SHELF_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: photo.mediaType, data: photo.data },
            },
            {
              type: 'text',
              text:
                kind === 'cover'
                  ? 'Read this book cover.'
                  : 'List every book you can read on this shelf.',
            },
          ],
        },
      ],
    });
  } catch (err) {
    throw explain(err);
  }

  // ⚠️ Check why it stopped BEFORE reading content. A refusal and a
  // truncation both leave content that looks nearly parseable, and half an
  // answer that silently becomes "the shelf has four books on it" is worse
  // than an error.
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category;
    throw new VisionError(
      `The model declined to read that image${category ? ` (${category})` : ''}. Photograph the ${kind === 'cover' ? 'book' : 'shelf'} rather than anything else in the room.`,
      422,
    );
  }
  if (message.stop_reason === 'max_tokens') {
    throw new VisionError(
      kind === 'cover'
        ? 'That cover produced more than one answer can hold. Try a straighter, closer photograph.'
        : 'That shelf produced more than one answer can hold. Photograph it in two halves.',
      502,
    );
  }

  const text = message.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new VisionError('The model returned nothing to read.', 502, true);

  let parsed: { books?: ShelfBook[]; unreadable?: boolean };
  try {
    parsed = JSON.parse(text) as { books?: ShelfBook[]; unreadable?: boolean };
  } catch {
    throw new VisionError('The model returned text that was not valid JSON.', 502, true);
  }

  const inputTokens = message.usage.input_tokens ?? 0;
  const outputTokens = message.usage.output_tokens ?? 0;

  return {
    // Sorted, then renumbered on the way out by the caller — the model is
    // asked for left-to-right positions and mostly obliges, but a gap or a
    // repeat in its numbering must not become a gap or a repeat downstream.
    books: (parsed.books ?? []).slice().sort((a, b) => a.position - b.position),
    unreadable: parsed.unreadable ?? false,
    inputTokens,
    outputTokens,
    estimatedCents: estimateCents(inputTokens, outputTokens),
  };
}
