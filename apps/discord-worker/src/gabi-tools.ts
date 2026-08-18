/**
 * GABI's Discord allowlists — **two of them, and they are deliberately not one
 * list.**
 *
 * `GABI_TOOL_NAMES` (Tier 0) is what a MODEL may call during a turn, and it is
 * READ-ONLY BY CONSTRUCTION. `GABI_DELEGATED_VERB_NAMES` (Tier 1, added
 * 2026-08-18) is what a DETERMINISTIC router may ask the destination site to do
 * on the asker's behalf, and every entry writes.
 *
 * ## ⚠️ WHY TWO ARRAYS RATHER THAN ONE WITH A `mutates` FLAG
 *
 * Because the two lists answer different questions and are reached by different
 * machinery, and merging them would put a write inside the surface a model
 * chooses from. Read the difference off the types below:
 *
 * | | Tier 0 tools | Tier 1 delegated verbs |
 * |---|---|---|
 * | chosen by | the **model**, mid-turn | a **regex**, before any model call |
 * | sent to the model | yes (`toolsForApi`) | ⚠️ **never** |
 * | credential | none — public CSV | the bot's app bearer, in ONE module |
 * | authority | none needed (public) | the **asker's own role**, checked by the destination site |
 * | `mutates` | `false`, every entry, asserted | `true`, every entry, asserted |
 *
 * A model that could pick "add this book" is a model that adds books when it
 * misreads a sentence. `delegated.ts` decides instead: an ISBN is a checksummed
 * number or it is not, and *"fix all my missing details"* matches a pattern or
 * it does not. **`toolsForApi()` returns Tier 0 and nothing else**, and
 * `test/gabi-tools.test.ts` fails the build if a delegated name ever appears in
 * what is handed to the Messages API.
 *
 * ---
 *
 * ## Tier 0 — READ-ONLY BY CONSTRUCTION
 *
 * ## The idiom, borrowed on purpose
 *
 * This is `library_catalog/packages/core/src/gabi-tools.ts`'s pattern, moved to
 * the Discord surface: an **explicit array of allowed names**, a definition per
 * name, and a build-failing test (`test/gabi-tools.test.ts`) that goes red the
 * moment anything write-shaped is added. The estate's own rule, which that file
 * quotes and this one inherits:
 *
 * > *"Export/projection surfaces are default-deny: allowed fields as an
 * > explicit array, never SELECT-*-minus-exclusions — the exclusion form leaks
 * > when a column is added."*
 *
 * A denylist here would mean that a data source added six months from now
 * becomes reachable by a Discord conversation the moment somebody writes an
 * executor for it. `GABI_TOOL_NAMES` is therefore the allowlist of record, and
 * `tool-exec.ts` refuses anything not in it — by name, before dispatch.
 *
 * ## ⚠️ WHY THIS SURFACE IS STRICTER THAN THE PANEL'S
 *
 * The library's own allowlist is phase-0 read-only *for now*, with a designed
 * phase 1 that adds writers behind a confirm lane. **This list has no such
 * phase and never will.** Every tool below declares `mutates: false` and
 * `methods: ['GET']`, and the test asserts both.
 *
 * ⚠️ **WHAT CHANGED 2026-08-18, stated here rather than discovered.** This
 * paragraph used to say *"from Discord GABI has no path to a catalogue write at
 * all"*. That is no longer true: the owner approved Tier 1 explicitly —
 * *"Can I dm her an isbn or a photo and she adds it to the catalog?"* … *"all
 * of it"* — so a write path now exists, in `delegated.ts` / `delegated-exec.ts`.
 * The sentence that replaces it is narrower and still mechanical:
 *
 * > **The MODEL still has no path to a catalogue write.** The write path is not
 * > a tool, is not described to the model, and cannot be reached by anything
 * > the model emits.
 *
 * And the credential is not "on the bot" in any diffuse sense — it lives in
 * exactly one module, holds no authority by itself, and the destination site
 * checks the asker's own role before it acts. See `delegated.ts`'s header.
 *
 * ## ⚠️ WHAT EACH TOOL READS, MEASURED (2026-08-18)
 *
 * | tool | reads | credential |
 * |---|---|---|
 * | `catalog_lookup` | `audiobooks.heygabi.ai/catalog.csv` (public, 200, CORS `*`, 1,079 rows) | none |
 * | `series_volumes` | the same parsed catalogue, grouped by `series` | none |
 *
 * Both go through `catalog-data.ts`, whose header carries the measurement and
 * the scope argument. **Neither touches a gated surface**, and the executor has
 * no Firestore client, no service account and no bot token in scope — so the
 * gating question is answered by what is *absent* rather than by a check
 * somebody could forget.
 *
 * ## The honesty contract, enforced in the DATA rather than the prompt
 *
 * Every result carries `coverage` (`catalog-data.ts` → `COVERAGE_NOTE`) naming
 * the one shelf that was searched and the two that are unreachable, and a
 * missing field is **omitted rather than filled**. A prompt asking a model to
 * be honest is a hope; a tool result that physically cannot contain an invented
 * narrator is a guarantee.
 */

import type { CatalogRow } from './catalog-data.js';

/**
 * THE ALLOWLIST. Nothing GABI can call from a Discord turn is absent from this
 * array, and nothing in this array is absent from `GABI_TOOLS` below (pinned by
 * a test).
 *
 * ⚠️ Note what is NOT here and cannot be added without failing
 * `test/gabi-tools.test.ts`: no `set_*`, no `update_*`, no `add_*`, no
 * `delete_*`, no `record_*`, no cover write, no role change, no moderation
 * verb, no `person_context` (see this build's report — the asker's own TBR and
 * reading positions are a FOLLOW-UP, not a quietly-shipped read of somebody's
 * private rows).
 */
export const GABI_TOOL_NAMES = ['catalog_lookup', 'series_volumes'] as const;

export type GabiToolName = (typeof GABI_TOOL_NAMES)[number];

/** Which shipped slice this is. Tier 0 = read the estate's own public
 * catalogue metadata and answer from it. */
export const GABI_TOOL_TIER = 0;

/**
 * ⚠️ **HOW MANY TIMES ONE TURN MAY GO ROUND THE TOOL LOOP.**
 *
 * Three, per the brief. It is a bound on *iterations*, not on *calls*: the
 * Messages API lets one assistant turn emit several `tool_use` blocks at once
 * and they are executed together, so *"how many Sanderson books, and how many
 * in the Cosmere, Wheel of Time and Reckoners"* is four lookups inside ONE
 * iteration — the shape the owner's own failing question needs.
 *
 * The reason there is a cap at all is the reason `mention-flow.ts` counts
 * subrequests: a loop is the one way a chat surface spends real money without
 * anybody noticing, and the number that matters is "does this terminate".
 */
export const MAX_TOOL_ITERATIONS = 3;

/** ⚠️ A ceiling on tool calls per turn as well as iterations, because parallel
 * calls are unbounded by the iteration count alone. Eight is generous for the
 * hardest question anybody has actually asked (four) and still bounded. */
export const MAX_TOOL_CALLS_PER_TURN = 8;

/** One tool: what the model sees, plus what the executor is permitted to do. */
export interface GabiTool {
  name: GabiToolName;
  /**
   * ⚠️ Prescriptive about **when** to call, not just what it does. Current
   * models reach for tools conservatively and a trigger condition in the
   * description measurably lifts should-call rate where a bare capability
   * statement does not — which matters here because the whole feature is
   * worthless if she answers from memory instead of from the shelf.
   */
  description: string;
  /** JSON Schema, Anthropic tool shape. `additionalProperties: false` throughout. */
  input_schema: {
    type: 'object';
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: readonly string[];
        /** ⚠️ Present only for `type: 'array'`, and only ever a scalar element
         *  type. A nested object schema here would be a tool taking structured
         *  input a model composes, which nothing on this surface does. */
        items?: { type: string };
      }
    >;
    required: readonly string[];
    additionalProperties: false;
  };
  /** Which estate surface this reads. Every entry is a PUBLIC one. */
  reads: 'public_audiobook_catalogue';
  /** HTTP methods the executor may use. Tier 0: GET and nothing else. */
  methods: readonly ('GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE')[];
  /** Whether the tool can change anything. ⚠️ Every entry is `false`. */
  mutates: boolean;
}

export const GABI_TOOLS: readonly GabiTool[] = [
  {
    name: 'catalog_lookup',
    description:
      "Look a book up on the estate's own audiobook shelf and get what the catalogue actually " +
      'records: narrator, running time, release year, series and position in it, genre, fictional ' +
      'universe, and whether the library also has a print or ebook edition. ' +
      'Call this ANY time somebody asks about a specific book, an author, a narrator, or how many ' +
      'books the estate has of something — including "who narrates X", "how long is X", "what have ' +
      'we got by Y", and "how many Z books do we have". Call it once per thing being asked about: ' +
      'several lookups in one turn is normal and correct for a question that names several authors ' +
      'or universes. ' +
      "Use mode 'count' when the person wants a number rather than a list. " +
      '⚠️ NEVER state a narrator, a running time or a count from your own memory — if it did not ' +
      'come back from this tool, say the catalogue does not record it. Returning nothing is a real ' +
      'answer: it means this shelf does not hold that book, which is never the same as the house ' +
      'not owning it.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Title, author or narrator — whatever the person actually named. Optional when you ' +
            'are filtering by universe alone.',
        },
        field: {
          type: 'string',
          enum: ['any', 'title', 'author', 'narrator', 'series'],
          description:
            "Which field to match on. Use 'any' unless the person was explicit (\"books narrated " +
            "by Kate Reading\" → 'narrator'). Defaults to 'any'.",
          },
        universe: {
          type: 'string',
          description:
            'Restrict to one fictional universe from the estate\'s shared list, e.g. "The ' +
            'Cosmere", "Reckoners", "Cytoverse". If the universe is not one the estate records, ' +
            'the result says so and lists the ones it does.',
        },
        mode: {
          type: 'string',
          enum: ['list', 'count'],
          description:
            "'list' returns the matching books with their details (the default). 'count' returns " +
            'totals and a per-universe breakdown with no book list — use it when the person asked ' +
            '"how many".',
        },
      },
      required: [],
      additionalProperties: false,
    },
    reads: 'public_audiobook_catalogue',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'series_volumes',
    description:
      "Every volume of one series that the estate's audiobook shelf holds, in reading order, with " +
      'each volume\'s narrator and running time, plus the catalogue\'s own note on which volumes ' +
      'are owned and which are gaps. ' +
      'Call this whenever somebody asks about a series rather than a single book — "what Stormlight ' +
      'books do we have", "are we missing any Mistborn", "what order do these go in", "what is next ' +
      'after book 3". You can pass a BOOK title instead of a series name and it will find that ' +
      "book's series. ⚠️ Do not list a series from memory; a volume the catalogue does not have is " +
      'exactly what the person is asking about.',
    input_schema: {
      type: 'object',
      properties: {
        series: {
          type: 'string',
          description:
            'The series name as the person said it, or a book title from the series if that is ' +
            'all they gave you.',
        },
      },
      required: ['series'],
      additionalProperties: false,
    },
    reads: 'public_audiobook_catalogue',
    methods: ['GET'],
    mutates: false,
  },
];

/** The one place anything decides whether a tool name is allowed. Default-deny,
 * and an ARRAY rather than a `Record` so `toString` and `__proto__` are not
 * quietly truthy — the classic allowlist hole. */
export function isGabiToolName(name: unknown): name is GabiToolName {
  return typeof name === 'string' && (GABI_TOOL_NAMES as readonly string[]).includes(name);
}

/** The definition for an allowlisted name, or `null`. Never throws on junk. */
export function gabiToolByName(name: unknown): GabiTool | null {
  if (!isGabiToolName(name)) return null;
  return GABI_TOOLS.find((t) => t.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// TIER 0b — the READ-ONLY DOCS category. A separate allowlist, deliberately.
// ---------------------------------------------------------------------------

/**
 * ⚠️ **A THIRD ARRAY, NOT A THIRD PAIR OF ENTRIES IN `GABI_TOOL_NAMES`** — the
 * same reasoning that keeps the Tier-1 verbs in their own array, applied to a
 * different axis.
 *
 * Tier 0 above and this list are both read-only and both chosen by the model,
 * so `mutates` cannot tell them apart. What separates them is **what they
 * read**, and it is the whole security story:
 *
 * | | Tier 0 catalogue tools | Tier 0b docs tools |
 * |---|---|---|
 * | surface | `catalog.csv`, **published to the open internet** | the estate docs corpus, **PII + an operations runbook** |
 * | credential | none — the absence IS the scope decision | an app bearer, in ONE module |
 * | who may read it | anyone with a browser | **devops-class only**, decided by the auth Worker |
 * | offered to the model | always | only with `GABI_DOCS=on` AND a configured port |
 * | posture | no switch — nothing to switch off | ⚠️ ships OFF behind `GABI_DOCS` |
 *
 * Merging them would mean a single `toolsForApi()` hands a model the gated
 * surface on every turn of every conversation in the server, and that the
 * build-failing guard could no longer assert *"the catalogue tools reach
 * nothing gated"* — the sentence that currently makes Tier 0 safe by
 * construction. Two arrays keep both claims true and separately checkable.
 *
 * ⚠️ **NOTHING HERE WRITES, AND NOTHING HERE EVER WILL.** A docs *assistant*,
 * not a docs editor: no publish trigger, no doc edit, no TODO append. If "GABI
 * writes to docs/TODO.md" is ever wanted it is a T1/T2 verb with its own design
 * and its own confirm lane, not a third entry in this array.
 */
export const GABI_DOCS_TOOL_NAMES = ['search_estate_docs', 'read_estate_doc'] as const;

export type GabiDocsToolName = (typeof GABI_DOCS_TOOL_NAMES)[number];

/** Which shipped slice this is. Tier 0b = read the estate's own GATED docs
 *  corpus, on the asker's behalf, and answer from it. */
export const GABI_DOCS_TOOL_TIER = '0b';

/** One docs tool. Same shape as `GabiTool` but a DIFFERENT `reads` category,
 *  because the category is the thing the guard checks. */
export interface GabiDocsTool {
  name: GabiDocsToolName;
  description: string;
  input_schema: GabiTool['input_schema'];
  /** ⚠️ The gated category. `test/gabi-tools.test.ts` asserts every Tier-0 tool
   *  reads `public_audiobook_catalogue` and every entry here reads this — so a
   *  docs tool that drifted into the public list, or vice versa, fails the
   *  build rather than quietly changing what a model may reach. */
  reads: 'gated_estate_docs';
  methods: readonly ('GET')[];
  mutates: boolean;
}

export const GABI_DOCS_TOOLS: readonly GabiDocsTool[] = [
  {
    name: 'search_estate_docs',
    description:
      "Search the estate's own internal documentation — every docs/ file across the three repos " +
      '(runbooks, access references, design docs, the work log and its archive), published as one ' +
      'snapshot. Returns matching SECTIONS, each with its repo, file path, heading and a short ' +
      'snippet, plus a section id you can pass to read_estate_doc. ' +
      'Call this whenever somebody asks how something in the estate WORKS or how to DO something ' +
      'operational — "how do I promote the audiobook site", "what is the rollback procedure", ' +
      '"which secret does X need", "why did we decide Y", "where does Z live". ' +
      '⚠️ NEVER answer an operational question about this estate from your own memory: you know how ' +
      'software generally works, you do not know how THIS house does it, and that is the only ' +
      'question being asked. If nothing comes back, say the docs do not cover it — that is a real ' +
      'answer and is never the same as it not being true.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The words to look for, as the person said them. Two or three specific terms beat a ' +
            'whole sentence — "promote prod", "rollback tag", "revocation delay".',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    reads: 'gated_estate_docs',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'read_estate_doc',
    description:
      'Read ONE section of an estate document in full, by the section id a search result gave you. ' +
      'Call this after search_estate_docs when a snippet looks like the answer but you need the ' +
      'actual steps, commands or table rather than the first few lines. ' +
      'Read the one or two sections that matter, not everything that matched — there is a strict ' +
      'budget per answer and spending it on near-misses leaves nothing for the real one. ' +
      '⚠️ Quote what the section actually says, and never fill a gap from memory: a plausible-looking ' +
      'command that is not in the runbook is worse than saying the runbook does not give one.',
    input_schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description:
            'The section id exactly as a search result gave it — it looks like ' +
            '`<repo>/docs/<file>.md#<n>`. Do not construct one yourself; ids only exist inside the ' +
            'snapshot that produced them.',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    reads: 'gated_estate_docs',
    methods: ['GET'],
    mutates: false,
  },
];

/** The one place anything decides whether a docs tool name is allowed.
 *  Default-deny, and an ARRAY for the same reason `isGabiToolName` is one. */
export function isGabiDocsToolName(name: unknown): name is GabiDocsToolName {
  return typeof name === 'string' && (GABI_DOCS_TOOL_NAMES as readonly string[]).includes(name);
}

/** The definition for an allowlisted docs name, or `null`. Never throws. */
export function gabiDocsToolByName(name: unknown): GabiDocsTool | null {
  if (!isGabiDocsToolName(name)) return null;
  return GABI_DOCS_TOOLS.find((t) => t.name === name) ?? null;
}

// ---------------------------------------------------------------------------
// TIER 0c — the BOOK-TEXT category. A FOURTH allowlist, deliberately.
// ---------------------------------------------------------------------------

/**
 * ⚠️ **A FOURTH ARRAY, NOT FOUR MORE ENTRIES IN AN EXISTING ONE** — design
 * §4.6, and the same axis the docs array was split on, one step further.
 *
 * What separates the tool families is **what they read**:
 *
 * | | Tier 0 | Tier 0b docs | Tier 0c books |
 * |---|---|---|---|
 * | surface | `catalog.csv`, public | the estate docs corpus | **the household's own book TEXT** |
 * | who may read it | anyone with a browser | devops-class only | anyone the estate grants `vis_ebooks` |
 * | scoped per person by | nothing | their role | ⚠️ **their reading position** |
 * | posture | none | `GABI_DOCS` | `GABI_BOOKS`, ships dark |
 *
 * The third row is the one that makes this its own array rather than more docs
 * entries. A book answer is bounded by where the asker has got to, and merging
 * these into `toolsForApi()`'s default would hand a model an **unscoped book
 * surface on every turn of every conversation** — which is the spoiler failure
 * §4.1 calls first-class rather than a filter bolted on.
 *
 * ⚠️ **FOUR TOOLS, WHERE DESIGN §4.6 NAMED TWO — and that is a reconciliation
 * with phase 3, not a widening of what may be read.** §4.6 was written before
 * the retrieval routes existed. What they turned out to require:
 *
 *  1. `apps/audiobook-worker/src/book-routes.ts` refuses a CONSTRUCTED book id
 *     (*"Book ids come from the knowledge-base listing; do not construct one"*),
 *     so discovery has to be a tool — a model cannot guess its way in, and
 *     nothing else on this surface knows which books are packed.
 *  2. `presence` is a mode whose answer is a **per-book roll-up across several
 *     books**, so it takes a list of books and returns no passages at all.
 *     Design §6.2 is explicit that top-K silently omits the book a character is
 *     introduced in; expressing that as a `mode` on a single-book search cannot
 *     ask the question it exists to ask.
 *
 * Both extra tools read the SAME surface through the SAME gate as the two §4.6
 * named, with the same caps and the same posture. Nothing here reaches anything
 * the design did not already put behind `vis_ebooks`.
 *
 * ⚠️ **NOTHING HERE WRITES, AND NOTHING HERE EVER WILL.** No ingest trigger, no
 * re-chunk, no position write. GABI reads the household's books; she does not
 * keep anybody's bookmark.
 */
export const GABI_BOOKS_TOOL_NAMES = [
  'list_book_knowledge',
  'search_book_text',
  'read_book_passage',
  'book_presence',
] as const;

export type GabiBooksToolName = (typeof GABI_BOOKS_TOOL_NAMES)[number];

/** Which shipped slice this is. Tier 0c = read the TEXT of the household's own
 *  books, on the asker's behalf, bounded by where they have got to. */
export const GABI_BOOKS_TOOL_TIER = '0c';

/** One book tool. Same shape as `GabiTool` but a DIFFERENT `reads` category,
 *  because the category is the thing the guard checks. */
export interface GabiBooksTool {
  name: GabiBooksToolName;
  description: string;
  input_schema: GabiTool['input_schema'];
  /** ⚠️ The gated category, design §4.6's own word for it. `test/gabi-tools.
   *  test.ts` asserts every Tier-0 tool reads `public_audiobook_catalogue`,
   *  every docs tool reads `gated_estate_docs` and every entry here reads this —
   *  so a book tool that drifted into a public list fails the build rather than
   *  quietly changing what a model may reach. */
  reads: 'gated_book_text';
  methods: readonly ('GET')[];
  mutates: boolean;
}

export const GABI_BOOKS_TOOLS: readonly GabiBooksTool[] = [
  {
    name: 'list_book_knowledge',
    description:
      'Find out which of the household\'s books you have actually READ — the ones whose full text is ' +
      'in your knowledge base — and get their book ids. ' +
      '⚠️ CALL THIS FIRST, every time, before any other book-text tool: book ids come from this ' +
      'listing and nowhere else. Never construct one, never reuse one from memory, and never assume ' +
      'a book is in there because the catalogue has it — the catalogue is 1,079 audiobooks and your ' +
      'knowledge base is a much smaller, GROWING subset. ' +
      'If the book somebody asked about is not in the listing, say you have not read that one yet ' +
      'rather than answering from your own memory of it. That is a real answer, it is honest, and ' +
      'the book may well be there next week.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Words from the title or series to narrow the listing — "primal hunter", "way of kings". ' +
            'Leave it out to see everything that is in the knowledge base.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    reads: 'gated_book_text',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'search_book_text',
    description:
      'Search the actual text of ONE book and get back the passages that match, each with its ' +
      'chapter, its position (ord) and — for a book you know from the audio — its timestamp. ' +
      'This is how you answer a question about what HAPPENS in a book rather than what the ' +
      'catalogue records about it. ' +
      '⚠️ Pick the mode deliberately, because they are four different questions and not four sorts ' +
      'of one: "relevant" is the workhorse; "latest" gets the LAST time something appears, which is ' +
      'the mode for "what is X at the END of the book" (a stat sheet, a rank, a total) because the ' +
      'best-scoring passage is almost never the last one; "earliest" is its mirror, for a first ' +
      'appearance or an introduction, which scores badly by construction; "presence" answers ' +
      'whether a term is in this book at all. ' +
      '⚠️ Quote and cite what comes back. Never fill a gap from what you remember about the book — ' +
      'you may well have read it in training, and an answer sourced from there is exactly the thing ' +
      'this tool exists to replace.',
    input_schema: {
      type: 'object',
      properties: {
        bookId: {
          type: 'string',
          description: 'The book id exactly as list_book_knowledge gave it. Do not construct one.',
        },
        query: {
          type: 'string',
          description:
            'The words to look for. Two or three specific terms beat a whole sentence — a name, a ' +
            'place, a title, "stat sheet", "level up".',
        },
        mode: {
          type: 'string',
          enum: ['relevant', 'latest', 'earliest', 'presence'],
          description:
            "Default 'relevant'. Use 'latest' for anything asked about the END or the current state " +
            "of something, 'earliest' for a first appearance or introduction, 'presence' to ask only " +
            'whether it is in the book.',
        },
      },
      required: ['bookId', 'query'],
      additionalProperties: false,
    },
    reads: 'gated_book_text',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'read_book_passage',
    description:
      'Read ONE passage of a book in full, by the ord a search result gave you. ' +
      'Call this when a snippet looks like the answer but you need the whole thing — the rest of a ' +
      'stat block, the sentence after the one that matched. ' +
      'Read the one or two that matter, not everything that came back: there is a strict budget per ' +
      'answer and spending it on near-misses leaves nothing for the real one. ' +
      '⚠️ If the budget refuses, say you did not read it. Do not summarise a passage from its ' +
      'snippet as though you had.',
    input_schema: {
      type: 'object',
      properties: {
        bookId: {
          type: 'string',
          description: 'The book id exactly as list_book_knowledge gave it.',
        },
        ord: {
          type: 'number',
          description:
            'The ord a search result gave you. Ords only mean anything inside the book that produced ' +
            'them — do not construct one and do not carry one between books.',
        },
      },
      required: ['bookId', 'ord'],
      additionalProperties: false,
    },
    reads: 'gated_book_text',
    methods: ['GET'],
    mutates: false,
  },
  {
    name: 'book_presence',
    description:
      'Ask ONE question across SEVERAL books at once — where does this name, place or term appear, ' +
      'and where does it first show up? Returns a per-book roll-up (how many mentions, the first ' +
      'and last sighting with its chapter) rather than passages. ' +
      '⚠️ This is the right tool for "which book does X first appear in" and "does X ever come up in ' +
      'this series", and searching each book separately is the WRONG way to ask it: a ranked search ' +
      'returns the densest mentions, which is systematically not the book somebody is introduced in. ' +
      '⚠️ A count of zero is a REAL and useful answer — it means the term is genuinely absent from ' +
      'that book, which is different from the book not being in your knowledge base, and the result ' +
      'tells you which of the two it is. Say which.',
    input_schema: {
      type: 'object',
      properties: {
        bookIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The books to check, in reading order, as ids from list_book_knowledge. At most six — ' +
            'a series arc, not a shelf.',
        },
        query: {
          type: 'string',
          description: 'The name, place or term to look for.',
        },
      },
      required: ['bookIds', 'query'],
      additionalProperties: false,
    },
    reads: 'gated_book_text',
    methods: ['GET'],
    mutates: false,
  },
];

/** The one place anything decides whether a book tool name is allowed.
 *  Default-deny, and an ARRAY for the same reason `isGabiToolName` is one. */
export function isGabiBooksToolName(name: unknown): name is GabiBooksToolName {
  return typeof name === 'string' && (GABI_BOOKS_TOOL_NAMES as readonly string[]).includes(name);
}

/** The definition for an allowlisted book name, or `null`. Never throws. */
export function gabiBooksToolByName(name: unknown): GabiBooksTool | null {
  if (!isGabiBooksToolName(name)) return null;
  return GABI_BOOKS_TOOLS.find((t) => t.name === name) ?? null;
}

/**
 * The `tools` array as the Messages API wants it — the executor's own fields
 * (`reads`, `methods`, `mutates`) are ours and are never sent.
 *
 * ⚠️ **THE DOCS TOOLS ARE OPT-IN PER CALL, AND THE DEFAULT IS OFF.** Called
 * with no argument this returns Tier 0 and nothing else, which is what every
 * pre-existing caller gets and what `test/gabi-tools.test.ts` pins. Only a
 * caller that has checked the `GABI_DOCS` posture AND holds a configured docs
 * port passes `{ docs: true }` — so the gated surface is never described to a
 * model on a turn that could not use it anyway.
 *
 * ⚠️ **NO DELEGATED VERB APPEARS IN EITHER SHAPE.** A write a model may choose
 * is a write that happens when a model misreads a sentence; that wall is
 * asserted in both modes by the build-failing guard.
 */
export function toolsForApi(opts: { docs?: boolean; books?: boolean } = {}): {
  name: string;
  description: string;
  input_schema: GabiTool['input_schema'];
}[] {
  const wire = (t: { name: string; description: string; input_schema: GabiTool['input_schema'] }) => ({
    name: t.name as string,
    description: t.description,
    input_schema: t.input_schema,
  });
  const out = GABI_TOOLS.map(wire);
  // ⚠️ Each gated family is its own opt-in. A caller that has checked the docs
  // posture has said NOTHING about the books posture, and a single `gated: true`
  // would make one owner decision silently grant the other.
  if (opts.docs) out.push(...GABI_DOCS_TOOLS.map(wire));
  if (opts.books) out.push(...GABI_BOOKS_TOOLS.map(wire));
  return out;
}

// ---------------------------------------------------------------------------
// The Tier-0 result shape the model receives
// ---------------------------------------------------------------------------

/** One book, as the model sees it. Field names are the ones a model will
 * reproduce verbatim, so they are written for a reader rather than for the CSV. */
export interface ToolBook {
  title: string;
  author: string;
  narrator?: string;
  duration?: string;
  year?: string;
  series?: string;
  series_index?: string;
  genre?: string;
  universe?: string;
  also_in_print_or_ebook?: string[];
}

// ---------------------------------------------------------------------------
// TIER 1 — the DELEGATED VERBS. A separate allowlist, deliberately.
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE WRITE ALLOWLIST.** Nothing GABI can ask a catalog to DO is absent
 * from this array, and it is an array rather than a subtraction for the estate's
 * stated reason: *"allowed fields as an explicit array, never
 * SELECT-*-minus-exclusions — the exclusion form leaks when a column is added."*
 *
 * ⚠️ These names are the LIBRARY WORKER'S ROUTE NAMES, mirrored. The other end
 * pins the identical array in `library_catalog/apps/worker/src/routes/
 * gabi-delegated.ts` (`DELEGATED_VERBS`), and each end's own test fails the
 * build if its half changes. Two allowlists at two ends, neither a denylist.
 *
 * ⚠️ Note what is NOT here and cannot arrive without failing
 * `test/gabi-tools.test.ts`: no role change, no approval, no estate grant or
 * revoke, no deploy, no secret, no delete of anything, no moderation verb, no
 * club operation, and no edit of an existing value. **Everything here is
 * additive or a read**, which is precisely what makes this Tier 1 rather than
 * Tier 2+ — a mutation of existing data needs a confirm button that this build
 * does not have.
 */
export const GABI_DELEGATED_VERB_NAMES = ['whoami', 'add-isbn', 'run-details'] as const;

export type GabiDelegatedVerbName = (typeof GABI_DELEGATED_VERB_NAMES)[number];

/** Which shipped slice this is. Tier 1 = additive writes with easy undo,
 * auto-applied and then reported (the owner-approved ladder). */
export const GABI_DELEGATED_TIER = 1;

/** One delegated verb: what it does, what it costs, and what it needs. */
export interface GabiDelegatedVerb {
  name: GabiDelegatedVerbName;
  /** For a human reading this file and for the report. NEVER sent to a model. */
  description: string;
  /**
   * The capability the DESTINATION SITE requires of the asker — the same one
   * the equivalent button in the web app is gated on. ⚠️ Recorded here for
   * review and for the refusal wording; it is **not** the check. The check is
   * the library Worker's own `can(user.role, capability)` against `app_user` on
   * that instance, because a check the caller performs is a check the caller
   * can skip.
   */
  requiredCapability: 'none' | 'editCatalog' | 'runResearch';
  /** HTTP method the executor may use. */
  methods: readonly ('POST')[];
  /** Whether it changes anything. ⚠️ `whoami` is the only `false`. */
  mutates: boolean;
  /**
   * Whether one call may cost money on somebody's key. `run-details` can spend
   * ~2¢ per book on the destination instance's own key, which is why it needs
   * `runResearch` and why the per-person daily write cap exists.
   */
  spends: boolean;
}

export const GABI_DELEGATED_VERBS: readonly GabiDelegatedVerb[] = [
  {
    name: 'whoami',
    description:
      'Ask ONE catalog instance what standing the asker has there — known or not, their role, ' +
      'and whether they hold the capabilities the two writing verbs need. Writes nothing, spends ' +
      'nothing, and is how instance routing is decided: somebody with an account on both shelves ' +
      'gets asked which one they meant instead of being guessed at.',
    requiredCapability: 'none',
    methods: ['POST'],
    mutates: false,
    spends: false,
  },
  {
    name: 'add-isbn',
    description:
      'Add a book to one catalog by ISBN, on the asker’s behalf. Purely additive: a new work with ' +
      'its printing and one owned copy, or a first printing on a work that had none. ⚠️ A barcode ' +
      'whose book is already on that shelf is HANDED BACK unanswered — the four-way rescan ' +
      'question and the pre-order question are mutations of existing data and belong to a confirm ' +
      'lane that does not exist yet.',
    requiredCapability: 'editCatalog',
    methods: ['POST'],
    mutates: true,
    spends: false,
  },
  {
    name: 'run-details',
    description:
      'Run the missing-details sweep on one catalog once, attributed to the asker, and report what ' +
      'it filled AND what it could not. Costs money on that instance’s own key (donor copies ' +
      'first, which are free), which is why it needs the spending capability rather than the ' +
      'editing one.',
    requiredCapability: 'runResearch',
    methods: ['POST'],
    mutates: true,
    spends: true,
  },
];

/** The one place anything decides whether a delegated verb name is allowed.
 * Default-deny, and an ARRAY for the same reason `isGabiToolName` is one. */
export function isGabiDelegatedVerb(name: unknown): name is GabiDelegatedVerbName {
  return typeof name === 'string' && (GABI_DELEGATED_VERB_NAMES as readonly string[]).includes(name);
}

/** The definition for an allowlisted verb, or `null`. Never throws on junk. */
export function gabiDelegatedVerbByName(name: unknown): GabiDelegatedVerb | null {
  if (!isGabiDelegatedVerb(name)) return null;
  return GABI_DELEGATED_VERBS.find((v) => v.name === name) ?? null;
}

/** ⚠️ Absent fields are OMITTED, not emitted as `null` or `"unknown"`. A model
 * shown `"narrator": null` will sometimes fill it in; a model shown no narrator
 * key at all has nothing to fill. */
export function toolBook(row: CatalogRow): ToolBook {
  const out: ToolBook = { title: row.title, author: row.author };
  if (row.narrator) out.narrator = row.narrator;
  if (row.duration) out.duration = row.duration;
  if (row.year) out.year = row.year;
  if (row.series) out.series = row.series;
  if (row.seriesIndex) out.series_index = row.seriesIndex;
  if (row.genre) out.genre = row.genre;
  if (row.universe) out.universe = row.universe;
  if (row.libraryFormats.length > 0) out.also_in_print_or_ebook = row.libraryFormats;
  return out;
}
