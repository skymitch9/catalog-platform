/**
 * The estate's own catalogue METADATA — narrator, duration, genre, series
 * position — read from the audiobook site's public `catalog.csv`.
 *
 * ## ⚠️ WHY THIS FILE EXISTS AT ALL: THE INDEX DOES NOT HOLD A NARRATOR
 *
 * The owner's canonical question is *"who's the narrator of Way of Kings?"*, and
 * the honest answer to "can `/have`'s existing lookup answer that" is **no** —
 * MEASURED 2026-08-17 rather than assumed, by reading `apps/index-worker/
 * migrations/0001_entry.sql` and by querying the live index:
 *
 * > `entry` columns: source, source_id, title, creator, title_fold, work_fold,
 * > universe, series, series_slug, series_index, year, publisher, format, kind,
 * > parent_source_id, cover_url, detail_url, pushed_at.
 *
 * There is **no narrator column, no duration column and no genre column**, and
 * `GET /api/search?q=way%20of%20kings&source=audiobook` returns exactly those
 * fields. The index is a cross-catalog *pointer* table by design (its own
 * schema comment: "POINTERS, NEVER TRUTH"), so asking it for a narrator is
 * asking it to be something it deliberately is not.
 *
 * ## Where the narrator DOES live, and why reading it needs no credential
 *
 * `https://audiobooks.heygabi.ai/catalog.csv` — the audiobook site's own
 * published catalogue, measured live 2026-08-18:
 *
 * | fact | measured |
 * |---|---|
 * | HTTP | `200`, `text/csv; charset=utf-8`, `access-control-allow-origin: *` |
 * | size | 1,410,970 bytes |
 * | rows | 1,079 audiobooks (1,080 lines incl. header; `desc` holds newlines) |
 * | narrator filled | 1,079 / 1,079 |
 * | duration filled | 1,079 / 1,079 |
 * | genre / year / series | 1,078 / 1,048 / 895 |
 * | `library_formats` | 86 rows carry the print+ebook cross-catalog join |
 *
 * ⚠️ **THIS IS A PUBLIC SURFACE, AND THAT IS THE WHOLE SCOPE ARGUMENT.** The
 * estate gates ebook and audio *FILE* bytes; it publishes catalogue *metadata*
 * to the open internet today — the same CSV every anonymous visitor to
 * `audiobooks.heygabi.ai` downloads to render the site's table. Reading it here
 * therefore reveals nothing the web does not already show, needs no
 * Authorization header, and inherits `/have`'s recorded scope decision (design
 * §4 decision 4) rather than re-making it. ⚠️ Nothing in this file may ever
 * reach a GATED surface: no `/api/ebooks`, no signed URL, no file manifest. A
 * gated read would need the asker's Firebase identity, which this Worker
 * structurally cannot mint (`have.ts` §"The wider scope for linked members").
 *
 * ⚠️ **1,079 here vs 1,246 in the index is NOT a bug** — also measured. The
 * index's audiobook source carries the household's whole shared pool, ebooks
 * included (they ride `source: 'audiobook'` with `format: 'ebook'`, per the
 * index's own `EBOOK_FORMAT` note). `catalog.csv` is the audiobook shelf alone.
 * A tool that says "the catalogue does not know" about an ebook-only title is
 * therefore telling the truth about THIS shelf, which is why every answer names
 * which shelf it looked on.
 *
 * ## The cost, priced rather than hoped
 *
 * 1.4 MB fetched and parsed per turn would be silly, so it is fetched and
 * parsed **once per isolate per 30 minutes** and memoised at module scope. The
 * gateway Durable Object is the estate's one always-on isolate, so in practice
 * that is one fetch per half hour for every mention it answers. The parse drops
 * `desc` and `cover_href` on the floor — together they are most of the bytes —
 * so the retained shape is roughly 200 KB of fields somebody might actually ask
 * about, not 1.4 MB of prose nobody will.
 *
 * ⚠️ The catalogue is re-published by the pipeline roughly daily (the index's
 * `pushed_at` moved at 00:37 UTC on the day this was written), so a 30-minute
 * window can never serve anything meaningfully stale, and a cold isolate pays
 * one round trip.
 */

// ---------------------------------------------------------------------------
// Where it lives
// ---------------------------------------------------------------------------

/** The audiobook site. A var override exists so a test can point elsewhere; the
 * default is the live host, which is a constant rather than a guess. */
export const DEFAULT_CATALOG_BASE = 'https://audiobooks.heygabi.ai';

/** The published catalogue. One path, in one place. */
export const CATALOG_PATH = '/catalog.csv';

/** How long a parsed catalogue is reused inside one isolate. Half an hour
 * against a roughly-daily republish: never stale enough to matter. */
export const CATALOG_TTL_MS = 30 * 60 * 1000;

/** ⚠️ A ceiling on what will be read into memory, because a Worker that tries
 * to buffer an unexpectedly enormous body dies without a message. Measured size
 * is 1.41 MB; 8 MB is ~5.7× headroom and still far under any isolate limit. */
export const MAX_CATALOG_BYTES = 8 * 1024 * 1024;

/** A fetch that hangs must fail, not hold a Discord reply hostage. */
export const CATALOG_TIMEOUT_MS = 10_000;

export function catalogBase(env: { CATALOG_BASE_URL?: string }): string {
  const configured = (env.CATALOG_BASE_URL ?? '').trim();
  return configured.length > 0 ? configured : DEFAULT_CATALOG_BASE;
}

export function catalogUrl(base: string): string {
  return new URL(CATALOG_PATH, base).toString();
}

// ---------------------------------------------------------------------------
// The row shape — the columns kept, and the ones deliberately dropped
// ---------------------------------------------------------------------------

/**
 * One catalogued audiobook, reduced to what somebody in a Discord channel might
 * ask about.
 *
 * ⚠️ `desc`, `cover_href`, `companion_files` and `library_work_id` are parsed
 * and THROWN AWAY. `desc` alone is most of the file's bytes and no tool here
 * answers "summarise the blurb" — keeping it would multiply the retained memory
 * of every isolate for a feature nobody asked for.
 */
export interface CatalogRow {
  title: string;
  author: string;
  /** ⚠️ Often SEVERAL people, comma-separated in the source ("Kate Reading,
   * Michael Kramer" on The Way of Kings). Kept as the catalogue's own string
   * rather than split: splitting invents a structure the data does not have,
   * and a narrator whose real name contains a comma would be torn in half. */
  narrator: string;
  /** The catalogue's own spelling — usually `YYYY-MM-DD`, sometimes `YYYY`. */
  year: string;
  /** Audible's colon-delimited path, e.g. `Science Fiction & Fantasy:Fantasy`. */
  genre: string;
  /** `HH:MM`, and HH runs past 24 on the long ones (The Way of Kings is 45:30). */
  duration: string;
  series: string;
  /** The display index — `1`, `2.5`, `7`. A string because half-volumes exist. */
  seriesIndex: string;
  /** The numeric sort key, or `null` where the catalogue has none. */
  seriesSort: number | null;
  universe: string;
  /** Print/ebook formats the LIBRARY catalogue holds for the same work — the
   * cross-catalog join the pipeline already computed. Empty for most rows (86
   * of 1,079 carry one), and an empty list means "no library match recorded",
   * never "the house does not own a copy". */
  libraryFormats: string[];
  /** The pipeline's own one-line summary of what the estate holds of a series,
   * e.g. `Volumes 1-2, 2.5, 3, 3.5, 4-5 owned`. */
  seriesGap: string;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * RFC 4180 CSV, hand-rolled because this Worker has no CSV dependency and the
 * file genuinely needs the quoting rules: `desc` contains commas, quotes AND
 * newlines, so a `split('\n')` parser silently produces garbage rows rather
 * than failing. (Measured: 1,080 records span 9,404 physical lines.)
 *
 * Returns rows of raw cells. Pure, and exported so a test can feed it a fixture
 * with an embedded newline and assert the record count rather than the line
 * count.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** The header names this file reads. Looked up BY NAME, never by position: the
 * pipeline owns that file and a column inserted in the middle must not silently
 * turn every narrator into a year. */
const COLUMNS = [
  'title',
  'series',
  'series_index_display',
  'series_index_sort',
  'author',
  'narrator',
  'year',
  'genre',
  'duration_hhmm',
  'library_formats',
  'universe',
  'series_gap',
] as const;

/**
 * Raw CSV → the kept fields.
 *
 * ⚠️ A missing column is skipped, not faked. If the pipeline ever drops
 * `narrator`, every row's narrator becomes `''` and the tools answer "the
 * catalogue does not record that" — which is true — rather than answering with
 * whatever happened to sit in that position.
 */
export function parseCatalogCsv(text: string): CatalogRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = (rows[0] ?? []).map((h) => h.trim());
  const at: Partial<Record<(typeof COLUMNS)[number], number>> = {};
  for (const name of COLUMNS) {
    const i = header.indexOf(name);
    if (i >= 0) at[name] = i;
  }
  const cell = (r: string[], name: (typeof COLUMNS)[number]): string => {
    const i = at[name];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };

  const out: CatalogRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const title = cell(r, 'title');
    if (!title) continue; // a blank trailing record, not a book
    const sort = Number(cell(r, 'series_index_sort'));
    out.push({
      title,
      author: cell(r, 'author'),
      narrator: cell(r, 'narrator'),
      year: cell(r, 'year'),
      genre: cell(r, 'genre'),
      duration: cell(r, 'duration_hhmm'),
      series: cell(r, 'series'),
      seriesIndex: cell(r, 'series_index_display'),
      seriesSort: Number.isFinite(sort) && cell(r, 'series_index_sort') !== '' ? sort : null,
      universe: cell(r, 'universe'),
      libraryFormats: cell(r, 'library_formats')
        .split('|')
        .map((f) => f.trim())
        .filter(Boolean),
      seriesGap: cell(r, 'series_gap'),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Loading, memoised
// ---------------------------------------------------------------------------

export type CatalogLoad =
  | { ok: true; rows: CatalogRow[]; fetchedAt: number }
  | { ok: false; reason: 'unreachable' | 'refused' | 'too_large' | 'unparseable'; status: number };

interface CacheEntry {
  at: number;
  rows: CatalogRow[];
}

let cached: CacheEntry | null = null;
/** ⚠️ In-flight de-duplication. Two mentions landing in the same second must not
 * both pull 1.4 MB — the second awaits the first's promise. */
let inFlight: Promise<CatalogLoad> | null = null;

/** ⚠️ A TEST SEAM, and only that. Production never calls it: the TTL is the
 * production invalidation. Exported so a test can prove the memo is a memo. */
export function resetCatalogCache(): void {
  cached = null;
  inFlight = null;
}

/** What the memo currently holds, for `/api/health` and for tests. */
export function catalogCacheState(): { loaded: boolean; rows: number; ageMs: number | null } {
  if (!cached) return { loaded: false, rows: 0, ageMs: null };
  return { loaded: true, rows: cached.rows.length, ageMs: Date.now() - cached.at };
}

/**
 * The catalogue, from the memo or from the network.
 *
 * ⚠️ Carries **no Authorization header**, exactly as `lookupHave` does not, and
 * for the same recorded reason: the surface is public, so the absence of a
 * credential IS the scope decision rather than an oversight.
 */
export async function loadCatalog(
  base: string,
  overrides?: { fetch?: typeof fetch; now?: number },
): Promise<CatalogLoad> {
  const now = overrides?.now ?? Date.now();
  if (cached && now - cached.at < CATALOG_TTL_MS) {
    return { ok: true, rows: cached.rows, fetchedAt: cached.at };
  }
  if (inFlight) return inFlight;

  const doFetch = overrides?.fetch ?? fetch;
  inFlight = (async (): Promise<CatalogLoad> => {
    let res: Response;
    try {
      res = await doFetch(catalogUrl(base), {
        method: 'GET',
        headers: { accept: 'text/csv' },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
    } catch {
      return { ok: false, reason: 'unreachable', status: 0 };
    }
    if (!res.ok) return { ok: false, reason: 'refused', status: res.status };

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_CATALOG_BYTES) {
      return { ok: false, reason: 'too_large', status: res.status };
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      return { ok: false, reason: 'unreachable', status: res.status };
    }
    if (text.length > MAX_CATALOG_BYTES) {
      return { ok: false, reason: 'too_large', status: res.status };
    }
    const rows = parseCatalogCsv(text);
    // ⚠️ Zero rows is a failed publish, not an empty estate — the same
    // loud-failure rule the index's own push contract states. Caching it would
    // make one bad deploy look like "the catalogue does not know" for half an
    // hour.
    if (rows.length === 0) return { ok: false, reason: 'unparseable', status: res.status };

    cached = { at: now, rows };
    return { ok: true, rows, fetchedAt: now };
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * The fold used for matching. Deliberately its OWN small function and NOT a
 * port of the index's `normaliseTitle`: nothing here produces a persisted key,
 * so this fold can change freely, and importing the index's would create a
 * second copy of a function whose whole value is that there is one copy.
 */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The same fold with a leading article dropped, so "The Way of Kings" and
 * "Way of Kings" are the same search. */
export function foldNoArticle(s: string): string {
  return fold(s).replace(/^(?:the|a|an) /, '');
}

/** Which field a search is allowed to look at. `any` is the default and the
 * one the model will pick 95% of the time. */
export const LOOKUP_FIELDS = ['any', 'title', 'author', 'narrator', 'series'] as const;
export type LookupField = (typeof LOOKUP_FIELDS)[number];

export function isLookupField(v: unknown): v is LookupField {
  return typeof v === 'string' && (LOOKUP_FIELDS as readonly string[]).includes(v);
}

/** Shortest useful query. One letter ranks the whole shelf; two is the index's
 * own floor and it is a good one. */
export const MIN_LOOKUP_QUERY = 2;

/** How many rows one tool result carries. A model turn that receives thirty
 * books answers about thirty books; three is a chat reply. */
export const MAX_LOOKUP_HITS = 5;

interface Scored {
  row: CatalogRow;
  score: number;
}

/**
 * Score one row against a folded query. Deliberately simple and deliberately
 * ORDERED: an exact title beats a title prefix beats a title substring beats an
 * author beats a narrator beats a series. A tie is broken by the shorter title,
 * so "Mistborn" finds *Mistborn* rather than *Mistborn: Secret History*.
 */
function scoreRow(row: CatalogRow, q: string, field: LookupField): number {
  const wants = (f: LookupField) => field === 'any' || field === f;
  const title = foldNoArticle(row.title);
  const author = fold(row.author);
  const narrator = fold(row.narrator);
  const series = foldNoArticle(row.series);

  if (wants('title')) {
    if (title === q) return 1000;
    if (title.startsWith(`${q} `) || title.startsWith(`${q}-`)) return 900;
    if (title.includes(q)) return 700;
  }
  if (wants('author')) {
    if (author === q) return 650;
    if (author.includes(q)) return 600;
  }
  if (wants('narrator')) {
    if (narrator === q) return 550;
    if (narrator.includes(q)) return 500;
  }
  if (wants('series')) {
    if (series === q) return 450;
    if (series.includes(q)) return 400;
  }
  // ⚠️ THE REVERSE DIRECTION — the query CONTAINS the title/series. Measured
  // live 2026-09-01 ~17:53: "tell me about Jake from Jake's magical market
  // series" produced the folded query `jake s magical market series`, which is
  // LONGER than the row (`jake s magical market`), so every includes() above
  // scored 0 and GABI told the owner the series "isn't ringing any bells" —
  // about three books sitting in the catalogue. includes() only ever asks
  // whether the ROW contains the QUERY; a chatty query wraps the title in
  // extra words and needs the question asked the other way round too. The
  // floor (two words AND 8+ chars) keeps one-word titles ("It", "Us") from
  // matching every sentence that mentions them.
  if (wants('title') && rowInQuery(title, q)) return 350;
  if (wants('series') && rowInQuery(series, q)) return 300;
  return 0;
}

/** Word-boundary "the query contains this row value", with the floor above. */
function rowInQuery(rowValue: string, q: string): boolean {
  if (rowValue.length < 8 || !rowValue.includes(' ')) return false;
  return (
    q === rowValue ||
    q.startsWith(`${rowValue} `) ||
    q.endsWith(` ${rowValue}`) ||
    q.includes(` ${rowValue} `)
  );
}

/**
 * Search the catalogue. Pure over the rows — the network lives in
 * `loadCatalog` — so the ranking is exercised by tests with no fetch at all.
 */
export function searchCatalog(
  rows: readonly CatalogRow[],
  query: string,
  field: LookupField = 'any',
  limit = MAX_LOOKUP_HITS,
): CatalogRow[] {
  let q = foldNoArticle(query);
  // ⚠️ Trailing genre-words are QUERY DECORATION, not title. "…magical market
  // series" (the measured live miss above), "…saga", "…trilogy", "…books".
  // Stripped repeatedly so "the X book series" sheds both. A CLOSED list on
  // purpose — stripping real title words would trade this miss for worse ones.
  //
  // ⚠️ FORMAT words joined the list 2026-09-02, after *"do we have Jake's
  // Magical Market on audio?"* was answered "nothing". The reverse-containment
  // rule below already RESCUED that query here (score 300), but a rescue is a
  // weaker match than the real one: with `audio` stripped the same query scores
  // an exact series hit (450) and ranks the three volumes correctly instead of
  // behind anything with a stronger accidental match. Same closed list as
  // `gabi.ts`'s `FORMAT_WORDS`, which is where the live miss actually was.
  for (;;) {
    const stripped = q.replace(
      /\s+(series|saga|trilogy|novels?|books?|audiobooks?|audio|audible|ebooks?|kindle|epub|print|paperback|hardcover|hardback)$/,
      '',
    );
    if (stripped === q) break;
    q = stripped;
  }
  if (q.length < MIN_LOOKUP_QUERY) return [];
  const scored: Scored[] = [];
  for (const row of rows) {
    const score = scoreRow(row, q, field);
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.row.title.length - b.row.title.length,
  );
  return scored.slice(0, Math.max(1, limit)).map((s) => s.row);
}

// ---------------------------------------------------------------------------
// Filtering and counting — "how many Sanderson books do we have?"
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE HONEST-COVERAGE SENTENCE, and it rides on EVERY result.**
 *
 * The owner asked the live bot *"how many books do we have in all the libraries
 * from Brandon Sanderson and his related authors, include universes like Wheel
 * of Time, Cosmere and Reckoners"* — a question whose honest answer is partly
 * "I can count that" and partly "I cannot see that from here". Which half is
 * which was MEASURED 2026-08-18 against the live index, not assumed:
 *
 * | surface | anonymous result |
 * |---|---|
 * | `GET /api/search?source=audiobook` | **200** — the public audiobook slice |
 * | `GET /api/universes` | **401 `{"error":"unauthenticated"}`** |
 * | `GET /api/universe/:name` | **401** |
 * | `GET /api/series` | **401** |
 *
 * Only `/api/search` sits above the index's `requireEstateMember()` blanket, and
 * `searchScope()` resolves an anonymous caller to `{audiobook}`. So the LIBRARY
 * and BOARD-GAME shelves are structurally unreachable from this Worker — not
 * because somebody forgot a token, but because widening needs a Firebase ID
 * token that Discord cannot produce and `firebase-sa.ts` here is deliberately
 * scoped away from minting (`have.ts` §"The wider scope for linked members").
 *
 * A count that does not say so is a **wrong answer wearing a number**, which is
 * exactly the failure the estate's no-bare-status and never-invent rules exist
 * to stop. So this sentence is attached to every tool result, not left to the
 * model's discretion — and the model's system prompt is told to keep it.
 */
export const COVERAGE_NOTE =
  "Counted on the estate's AUDIOBOOK shelf only (the public catalogue at " +
  'audiobooks.heygabi.ai). The library and board-game catalogues are not reachable from Discord: ' +
  'the estate index only widens for a caller holding a Firebase sign-in, which a Discord bot ' +
  'cannot produce. So this is a real count of one shelf, never an estate-wide total. The ' +
  '"also_in_print_or_ebook" figure is the library edition the audiobook pipeline already matched ' +
  'to these same works — it is not a count of the library catalogue.';

export interface CatalogFilter {
  query?: string;
  field?: LookupField;
  /** A universe name from the estate's shared list, matched loosely (leading
   * articles and punctuation folded away), e.g. `cosmere` → `The Cosmere`. */
  universe?: string;
}

/**
 * Every row matching a filter — **unlimited**, because a count that silently
 * stops at five is a lie with a number in it. The caller decides how many rows
 * to render; the total is always the true total.
 */
export function filterCatalog(rows: readonly CatalogRow[], filter: CatalogFilter): CatalogRow[] {
  let out: CatalogRow[] = [...rows];

  if (filter.universe && filter.universe.trim()) {
    const u = foldNoArticle(filter.universe);
    out = out.filter((r) => r.universe && foldNoArticle(r.universe) === u);
  }

  const query = (filter.query ?? '').trim();
  if (query.length >= MIN_LOOKUP_QUERY) {
    const q = foldNoArticle(query);
    const field = filter.field ?? 'any';
    out = out.filter((r) => scoreRow(r, q, field) > 0);
    out.sort((a, b) => {
      const d = scoreRow(b, q, field) - scoreRow(a, q, field);
      return d !== 0 ? d : a.title.length - b.title.length;
    });
  } else {
    out.sort((a, b) => a.title.localeCompare(b.title));
  }
  return out;
}

export interface CatalogSummary {
  total: number;
  /** How many of the matched works also have a print or ebook edition recorded
   * by the library catalogue. ⚠️ NOT a count of the library catalogue itself. */
  alsoInPrintOrEbook: number;
  /** Matched works per universe, biggest first. `(none)` is a real bucket: a
   * book with no universe is not a book that is missing one. */
  byUniverse: { universe: string; count: number }[];
  distinctAuthors: number;
  distinctSeries: number;
}

export function summarise(matches: readonly CatalogRow[]): CatalogSummary {
  const uni = new Map<string, number>();
  const authors = new Set<string>();
  const series = new Set<string>();
  let print = 0;
  for (const r of matches) {
    const u = r.universe || '(none)';
    uni.set(u, (uni.get(u) ?? 0) + 1);
    if (r.author) authors.add(fold(r.author));
    if (r.series) series.add(foldNoArticle(r.series));
    if (r.libraryFormats.length > 0) print += 1;
  }
  return {
    total: matches.length,
    alsoInPrintOrEbook: print,
    byUniverse: [...uni.entries()]
      .map(([universe, count]) => ({ universe, count }))
      .sort((a, b) => b.count - a.count || a.universe.localeCompare(b.universe)),
    distinctAuthors: authors.size,
    distinctSeries: series.size,
  };
}

/**
 * Every universe the AUDIOBOOK shelf actually files something under, with its
 * count.
 *
 * ⚠️ Returned whenever a universe filter matched NOTHING, and that is the whole
 * point: measured 2026-08-18, the estate's shared list holds **16 universes and
 * "Wheel of Time" is not one of them**, and the audiobook shelf holds **zero**
 * Wheel of Time or Robert Jordan rows. Handing the model the real list lets her
 * say "that isn't a universe the estate records" — a true and useful answer —
 * instead of "I found 0", which reads as a count somebody is withholding.
 */
export function knownUniverses(rows: readonly CatalogRow[]): { universe: string; count: number }[] {
  const uni = new Map<string, number>();
  for (const r of rows) {
    if (!r.universe) continue;
    uni.set(r.universe, (uni.get(r.universe) ?? 0) + 1);
  }
  return [...uni.entries()]
    .map(([universe, count]) => ({ universe, count }))
    .sort((a, b) => b.count - a.count || a.universe.localeCompare(b.universe));
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export interface SeriesAnswer {
  /** The catalogue's own spelling of the series name. */
  series: string;
  /** The pipeline's own gap sentence, when it recorded one. */
  gap: string;
  universe: string;
  volumes: CatalogRow[];
}

/**
 * Every catalogued volume of one series, in reading order.
 *
 * ⚠️ Ordering falls back to the DISPLAY index and then to the title when
 * `series_index_sort` is absent (measured: 878 of 895 series rows carry a
 * display index, and 1,079−895 have no series at all). An unsorted list of a
 * series is worse than useless — it reads as an answer about reading order.
 */
export function seriesVolumes(rows: readonly CatalogRow[], query: string): SeriesAnswer | null {
  const q = foldNoArticle(query);
  if (q.length < MIN_LOOKUP_QUERY) return null;

  // Two passes: an exact series-name fold first, then a containment match, so
  // "Mistborn" does not resolve to "Mistborn: The Wax and Wayne Series" while
  // a real "Mistborn" series exists.
  const exact = rows.filter((r) => r.series && foldNoArticle(r.series) === q);
  let matched = exact;
  if (matched.length === 0) {
    matched = rows.filter((r) => r.series && foldNoArticle(r.series).includes(q));
  }
  // Last resort: the query was a BOOK, not a series. Find the book, then take
  // its series — "what else is in Way of Kings' series" is the same question.
  if (matched.length === 0) {
    const byBook = searchCatalog(rows, query, 'title', 1)[0];
    if (byBook?.series) {
      const s = foldNoArticle(byBook.series);
      matched = rows.filter((r) => r.series && foldNoArticle(r.series) === s);
    }
  }
  if (matched.length === 0) return null;

  const volumes = [...matched].sort((a, b) => {
    if (a.seriesSort !== null && b.seriesSort !== null) return a.seriesSort - b.seriesSort;
    if (a.seriesSort !== null) return -1;
    if (b.seriesSort !== null) return 1;
    const ai = Number(a.seriesIndex);
    const bi = Number(b.seriesIndex);
    if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
    return a.title.localeCompare(b.title);
  });

  const first = volumes[0];
  if (!first) return null;
  return {
    series: first.series,
    gap: volumes.find((v) => v.seriesGap)?.seriesGap ?? '',
    universe: volumes.find((v) => v.universe)?.universe ?? '',
    volumes,
  };
}

// ---------------------------------------------------------------------------
// Rendering — one place, so a tool result and a Discord message agree
// ---------------------------------------------------------------------------

const clip = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** The catalogue's genre path reduced to its most specific leaf: nobody wants
 * to read `Science Fiction & Fantasy:Fantasy:Action & Adventure` in a chat. */
export function genreLeaf(genre: string): string {
  const parts = genre.split(':').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/** `2010-08-31` → `2010`. The catalogue stores a release date; a person asked a
 * year. */
export function yearOf(year: string): string {
  const m = /^(\d{4})/.exec(year.trim());
  return m?.[1] ?? year.trim();
}

/**
 * One row as fielded facts. ⚠️ **An absent field is OMITTED, never guessed and
 * never rendered as "unknown" filler** — this is the whole honesty contract of
 * the feature: she may say what the catalogue records, and she may say the
 * catalogue records nothing, and there is no third thing she may say.
 */
export function factsFor(row: CatalogRow): string {
  const bits: string[] = [];
  if (row.narrator) bits.push(`narrated by ${row.narrator}`);
  if (row.duration) bits.push(`${row.duration} long`);
  if (row.year) bits.push(yearOf(row.year));
  if (row.series) {
    bits.push(row.seriesIndex ? `${row.series} #${row.seriesIndex}` : row.series);
  }
  const genre = genreLeaf(row.genre);
  if (genre) bits.push(genre);
  if (row.universe) bits.push(row.universe);
  if (row.libraryFormats.length > 0) bits.push(`also in print/ebook: ${row.libraryFormats.join(', ')}`);
  return bits.join(' · ');
}

/** One catalogue row, rendered for a Discord message. */
export function renderRow(row: CatalogRow): string {
  const head = `**${clip(row.title, 140)}**${row.author ? ` — ${clip(row.author, 80)}` : ''}`;
  const facts = factsFor(row);
  return facts ? `${head}\n  ${facts}` : head;
}

/** One volume line inside a series listing. */
export function renderVolume(row: CatalogRow): string {
  const n = row.seriesIndex || (row.seriesSort !== null ? String(row.seriesSort) : '?');
  const extras = [row.narrator && `narr. ${row.narrator}`, row.duration].filter(Boolean).join(' · ');
  return `**${n}.** ${clip(row.title, 120)}${extras ? ` — ${extras}` : ''}`;
}

// ---------------------------------------------------------------------------
// The no-model fast path: "who narrates X?"
// ---------------------------------------------------------------------------

/**
 * ⚠️ Which METADATA question a message is, decided by regex and no model at
 * all.
 *
 * The brief's own words: *"the keyword router path (no-model fallback) may also
 * use catalog_lookup for 'narrator of X'-shaped questions if cheap"*. It is
 * cheap: the catalogue is already in memory, so this path costs zero
 * subrequests and zero cents, and it means the owner's canonical question is
 * answered correctly **even with the Anthropic key unset**.
 *
 * Returns the field being asked about and the search term with the question
 * scaffolding stripped. `null` means "not a metadata question" — and the
 * default is `null`, not a guess, for `classifyByKeyword`'s own reason: a wrong
 * guess here answers a question nobody asked.
 */
export type MetadataField = 'narrator' | 'duration' | 'series' | 'genre' | 'year';

export interface MetadataAsk {
  field: MetadataField;
  term: string;
}

/** Ordered: the first pattern that matches wins, so "how long is X narrated by
 * Y" is a duration question rather than a narrator one. */
const METADATA_PATTERNS: readonly { field: MetadataField; re: RegExp }[] = [
  { field: 'duration', re: /\b(?:how long|run ?time|runtime|length|duration|how many hours)\b/i },
  { field: 'narrator', re: /\b(?:narrat\w*|who reads|who read|voiced by|voice actor|read by)\b/i },
  { field: 'year', re: /\b(?:what year|when (?:was|did).{0,20}\b(?:published|released|come out)|release date|published)\b/i },
  { field: 'genre', re: /\b(?:what genre|which genre|genre of)\b/i },
  { field: 'series', re: /\b(?:what series|which series|series is|book number|what number)\b/i },
];

/** Scaffolding words dropped when reducing a metadata question to a title.
 * Small on purpose — an over-eager list mangles titles, and every answer names
 * the book it matched so a bad reduction is visible rather than mysterious. */
const ASK_STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'book', 'books', 'by', 'can', 'come', 'date',
  'did', 'do', 'does', 'duration', 'for', 'from', 'gabi', 'genre', 'has', 'have', 'hours',
  'how', 'in', 'is', 'it', 'know', 'length', 'long', 'many', 'me', 'much', 'narrated',
  'narrates', 'narrating', 'narration', 'narrator', 'narrators', 'number', 'of', 'on',
  'our', 'out', 'published', 'read', 'reads', 'release', 'released', 'run', 'runtime',
  'series', 'tell', 'that', 'the', 'their', 'there', 'they', 'this', 'to', 'us', 'voice',
  'voiced', 'was', 'we', 'what', 'whats', 'when', 'which', 'who', 'whos', 'why', 'year',
  'you', 'your',
]);

/** The little words that sit between the question and the title. ⚠️ `by` is
 * deliberately ABSENT: "narrated by Kate Reading" is a search for a person, and
 * treating `by` as a connector would make it one for a title. */
const CONNECTOR = /^[\s,:—–-]*(?:of|for|in|is|are|was|were|the|a|an|to|on|about|from)\b\s*/i;

/** Question words that lead a sentence and never appear in a title. */
const LEADING_INTERROGATIVE = /^[\s,]*(?:whats|what|whos|who|which|how|when|why|is|are|do|does|did|can|could|please|tell|me|us|hey|gabi)\b\s*/i;

/**
 * ⚠️ **THE TITLE IS TAKEN RELATIVE TO THE METADATA KEYWORD, not from the
 * leftmost "of" — and that distinction was found by RUNNING this, not by
 * reading it.**
 *
 * The first version grabbed whatever followed the first `of`, which is correct
 * for *"the narrator **of** Way of Kings"* and wrong for *"is Way **of** Kings
 * narrated by anyone good"* — where it captured `Kings narrated by anyone good`
 * and searched for that. So the split is made at the keyword:
 *
 *   - text AFTER the keyword wins when a connector follows it
 *     (`narrator **of** X`, `how long **is** X`, `narrates **the** X`);
 *   - text BEFORE it wins otherwise, which is the trailing-clause shape
 *     (`**Way of Kings** narrated by …`);
 *   - and when only one side has anything in it, that side wins.
 */
export function metadataAsk(question: string): MetadataAsk | null {
  const q = question.trim().replace(/[?!.]+\s*$/, '');
  if (q.length === 0) return null;

  let hit: { field: MetadataField; m: RegExpExecArray } | null = null;
  for (const p of METADATA_PATTERNS) {
    const m = new RegExp(p.re.source, p.re.flags.replace('g', '')).exec(q);
    if (m) {
      hit = { field: p.field, m };
      break;
    }
  }
  if (!hit) return null;

  const rawAfter = q.slice(hit.m.index + hit.m[0].length);
  const hadConnector = CONNECTOR.test(rawAfter);
  const after = rawAfter.replace(CONNECTOR, '').replace(/[\s,]+$/, '').trim();
  const before = q
    .slice(0, hit.m.index)
    .replace(LEADING_INTERROGATIVE, '')
    .replace(LEADING_INTERROGATIVE, '')
    .replace(/[\s,]+$/, '')
    .trim();

  let term = '';
  if (after.length >= MIN_LOOKUP_QUERY && (hadConnector || before.length < MIN_LOOKUP_QUERY)) {
    term = after;
  } else if (before.length >= MIN_LOOKUP_QUERY) {
    term = before;
  } else if (after.length >= MIN_LOOKUP_QUERY) {
    term = after;
  }

  // Last resort: strip the scaffolding words and search whatever is left. It is
  // a worse reduction than either half above, which is why it is last — and
  // every answer names the book it matched, so a bad one is visible.
  if (term.length < MIN_LOOKUP_QUERY) {
    term = q
      .replace(/[?!.,;:"“”]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0 && !ASK_STOPWORDS.has(w.toLowerCase()))
      .join(' ')
      .trim();
  }
  if (term.length < MIN_LOOKUP_QUERY) return null;
  return { field: hit.field, term };
}

/** ⚠️ Every string here obeys the inherited wording rules: an absence is a fact
 * about the CATALOGUE, never about the house, and an outage is never phrased as
 * an answer about the book. */
export const CATALOG_MSG = {
  unreachable:
    "I couldn't reach the estate's catalogue just then — that's a problem on our side, not an " +
    'answer about the book. Nothing was looked up.',

  none: (term: string) =>
    `Nothing on the estate's audiobook shelf matches **${clip(term, 80)}**. ⚠️ That's a statement ` +
    'about the **catalogue**, not about the house — books are catalogued as they are scanned, and a ' +
    'real book nobody has scanned yet looks exactly like this.',

  /** ⚠️ The row matched but the field is blank. Said out loud, because the one
   * thing she must never do is fill it in. */
  missingField: (field: MetadataField, title: string) =>
    `The catalogue has **${clip(title, 100)}**, but it doesn't record a ${field} for it — so I'd be ` +
    "making one up, and I won't do that.",

  seriesNone: (term: string) =>
    `I couldn't find a series called **${clip(term, 80)}** on the estate's audiobook shelf. That's a ` +
    'statement about the catalogue, not about the house.',
} as const;
