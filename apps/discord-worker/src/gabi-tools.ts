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
      { type: string; description: string; enum?: readonly string[] }
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

/** The `tools` array as the Messages API wants it — the executor's own fields
 * (`reads`, `methods`, `mutates`) are ours and are never sent. */
export function toolsForApi(): {
  name: string;
  description: string;
  input_schema: GabiTool['input_schema'];
}[] {
  return GABI_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
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
