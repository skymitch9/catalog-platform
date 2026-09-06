/**
 * **THIS WORKER'S ONE READER of the estate catalog registry.**
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, table confirmed 15:58 (*"Yes that is
 * correct"*): *"Make sure everything we have that's in the estate connects to
 * multiple libraries and make sure that the libraries are designated by who
 * owns the physical or shared with digital works."*
 *
 * The registry is `GET {INDEX_BASE_URL}/api/catalogs` — built and deployed
 * 2026-09-05, `docs/info/catalog-registry.md`. It answers, for every catalog
 * the estate has:
 *
 *   { id, push_source, kind, label, owner, holding, shared, host }
 *
 * plus, for a signed-in member and only within their own visibility, `rows` and
 * `pushed_at`. ⚠️ **This Worker only ever reads the ANONYMOUS branch** — it
 * sends no bearer, so it gets names and no counts at all (`counts: "none"`),
 * the owner's decision of 16:14, *"yes name only"*.
 *
 * ## ⚠️ WHAT THIS FILE REPLACES, and why it is not a tidy-up
 *
 * `multi-library-survey-2026-09-05.md` §2 F2 measured **seven** hand-kept
 * source→label maps across the estate in seven disagreeing spellings of two
 * libraries. Row **#7 was this Worker**: `delegated.ts`'s `libraryInstances()`
 * called them *"the main library"* and ⚠️ *"your own shelf"* — an
 * **asker-relative** label, and therefore simply wrong for the owner, to whom
 * GABI was calling **Samantha's** shelf *"your own shelf"*. §3.4 lists the rest:
 * a closed `'library' | 'library2'` type union (so a `library3` is a type
 * change), two hard-coded URLs inside a worded sentence, and three suggestion
 * strings that say *"the library"* without ever saying **whose**.
 *
 * ## ⚠️ WHAT THIS FILE DOES NOT DO
 *
 * - **It widens nothing.** The anonymous, names-only branch; **no bearer is
 *   sent** (a test asserts the request carries no `authorization`), no CORS
 *   list, no origin allowlist, no `vis_` column and no permission is touched.
 *   Hostnames and English words are the whole payload.
 * - **It decides no permission, ever.** The directory is cached ten minutes
 *   upstream and ten minutes here, so two isolates may disagree inside that
 *   window (`catalog-registry.md` §8 says it outright: fine for a name, never
 *   for a grant). Every capability GABI relies on is still asked of the
 *   destination site, per person, per call.
 * - **It never invents a catalog list.** There is deliberately no hard-coded
 *   registry here: *"the directory is unreachable"* and *"these are the
 *   catalogs"* are different facts. `loadCatalogs` answers `null` for the first
 *   one, and each caller degrades in WORDS from its own configured fallback.
 *
 * ## ⚠️ ITS DELIBERATE TWIN: `sites/heygabi-home/public/assets/catalog-registry.js`
 *
 * The apex has its own client with the same shape and the same helper names.
 * They are **near-duplicates that exist on purpose and are NOT
 * interchangeable**: that one is browser ES-module JavaScript synced verbatim
 * into two other repos, this one is Worker TypeScript with an isolate memo and
 * an `AbortSignal` timeout. What they must agree on is the ROUTE, the
 * ebook-remap rule and the worded-unknown discipline — restated here rather
 * than imported, because there is no import path between a Pages asset and a
 * Worker bundle.
 */

import type { Env } from './env.js';
import { indexBase } from './have.js';

// ---------------------------------------------------------------------------
// The posture
// ---------------------------------------------------------------------------

/**
 * ⚠️ **AFFIRMATIVE-ONLY**, the same idiom as `GABI_MENTIONS`,
 * `GABI_DELEGATED_WRITES` and `GABI_PANEL_REGISTRY`: `"on"` and nothing else.
 * `"true"`, `"1"`, `"yes"` and every typo mean OFF — and OFF is byte-for-byte
 * the pre-registry Worker: **no subrequest at all**, every label and every
 * instance coming from the configured vars exactly as they did before.
 *
 * ⚠️ **It is why the ~1,300 other tests in this package touch no network.**
 * Nothing here fetches unless somebody wrote the word `on`.
 *
 * ⚠️ **Two postures, not one, and that is deliberate.** `GABI_PANEL_REGISTRY`
 * (2026-09-05) gates one hostname in a deep link; this one gates the set of
 * shelves she offers and the words she calls them. They fail differently and
 * they back out differently — an operator pinning this bot's links to one host
 * (posture off + `GABI_PANEL_URL`) has no reason to also lose every ownership
 * label — so collapsing them into one lever would take away a backout that
 * costs nothing to keep. They share this module's fetch and memo, so the
 * directory is still read once per isolate per ten minutes however many lanes
 * ask.
 */
export function catalogRegistryOn(env: Pick<Env, 'GABI_CATALOG_REGISTRY'>): boolean {
  return (env.GABI_CATALOG_REGISTRY ?? '').trim().toLowerCase() === 'on';
}

// ---------------------------------------------------------------------------
// The wire shape
// ---------------------------------------------------------------------------

/** One catalog, exactly as `GET /api/catalogs` publishes it to an anonymous
 *  caller. ⚠️ `owner` is `null` **exactly when** `shared` is true — a digital
 *  pool has no one owner, which is the whole distinction the owner's rule
 *  draws, and a renderer must say *"shared"* rather than print an empty name.
 *  ⚠️ `push_source` is `null` for `ebooks` and **null is the answer, not a
 *  gap**: ebook rows ride `PUT /api/push/audiobook` with `format: 'ebook'`. */
export interface CatalogEntry {
  id: string;
  push_source: string | null;
  kind: string;
  label: string;
  owner: string | null;
  holding: 'physical' | 'digital';
  shared: boolean;
  host: string;
}

/**
 * What a shelf is called when the directory does not name it.
 *
 * ⚠️ **NEVER the raw id.** The estate's old `MAP[x] || x` fallbacks printed
 * database vocabulary — the literal string `library2` — into an English
 * sentence in front of a person (survey §2 F1). A worded unknown is honest; a
 * database word is not.
 */
export const UNKNOWN_SHELF = 'a shelf I cannot name';

/** ⚠️ **Ten minutes, matching the registry's OWN cache TTL**
 *  (`catalog-registry.md` §8), so the estate has one number to remember rather
 *  than two. A label edited in D1 can therefore take up to twenty minutes to
 *  reach a Discord sentence — fine for a name, and the reason §8 says outright
 *  never to put a permission behind this cache. */
export const CATALOG_REGISTRY_TTL_MS = 10 * 60 * 1000;

/** ⚠️ **A hard ceiling, because this sits in front of a person waiting for a
 *  reply.** A directory that is slow must cost a worded fallback, never a turn. */
export const CATALOG_REGISTRY_TIMEOUT_MS = 2_000;

/** What a caller may inject. Both exist for tests; production passes neither. */
export interface CatalogRegistryDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Parsing — validated, not trusted
// ---------------------------------------------------------------------------

/**
 * The response body → the catalogs, or `null` if it is not that shape.
 *
 * ⚠️ **VALIDATED EVEN THOUGH THE FAR END IS OUR OWN WORKER.** A
 * partially-deployed estate is a normal state, and a malformed row that reached
 * here would become a sentence GABI says or a hostname somebody presses.
 * Unknown KEYS are kept — the registry is expected to grow fields — but every
 * field this Worker renders is checked, and **one bad row refuses the whole
 * answer**: a half-parsed directory is how a catalog silently disappears from a
 * menu.
 */
export function parseCatalogs(body: unknown): CatalogEntry[] | null {
  if (body === null || typeof body !== 'object') return null;
  const list = (body as { catalogs?: unknown }).catalogs;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: CatalogEntry[] = [];
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id) return null;
    if (typeof row.label !== 'string' || !row.label) return null;
    if (typeof row.host !== 'string' || !row.host) return null;
    if (typeof row.kind !== 'string' || !row.kind) return null;
    if (row.holding !== 'physical' && row.holding !== 'digital') return null;
    if (typeof row.shared !== 'boolean') return null;
    if (row.owner !== null && typeof row.owner !== 'string') return null;
    if (row.push_source !== null && typeof row.push_source !== 'string') return null;
    out.push({
      id: row.id,
      push_source: row.push_source,
      kind: row.kind,
      label: row.label,
      owner: row.owner,
      holding: row.holding,
      shared: row.shared,
      host: row.host,
    });
  }
  return out;
}

/**
 * A registry `host` as a base URL, or `null`.
 *
 * ⚠️ **A bad host is REFUSED, never repaired.** The contract is a bare hostname
 * (`library.heygabi.ai`); anything carrying a scheme, a slash, a port, a space
 * or a credential marker is a shape we do not understand, and a "corrected"
 * hostname is a guess that ends up in a link somebody presses.
 */
export function baseUrlFromHost(host: unknown): string | null {
  const raw = typeof host === 'string' ? host.trim() : '';
  if (!raw || /[\s/\\@?#]|:/.test(raw)) return null;
  try {
    return new URL(`https://${raw}`).origin;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The fetch
// ---------------------------------------------------------------------------

/**
 * Where the words in front of a person actually came from.
 *
 * `'registry'` — the estate directory answered and was understood.
 * `'fallback'` — it did not, and each caller's own configured words stood in.
 */
export type CatalogRegistrySource = 'registry' | 'fallback';

/**
 * ⚠️ **WHY the memo holds what it holds** — added 2026-09-06 because the memo
 * was previously indistinguishable from outside.
 *
 * Measured 2026-09-06 07:50–08:00 Phoenix: `/api/health` answered the registry's
 * labels on ~60% of requests and the configured FALLBACK on ~40%, interleaved,
 * from one deployment at 100% of traffic — while `wrangler tail` caught 113
 * events with **zero logs and zero exceptions**. Both facts are consistent
 * (`console.error` fires once per isolate per failure, and the failure is then
 * remembered for ten minutes, so the log is almost always OUTSIDE the tail
 * window that notices the fallback) — but nothing could tell them apart from
 * outside, so nobody could say whether the directory was timing out, refusing,
 * or answering a shape we do not parse.
 *
 * ⚠️ **This changes NOTHING about behaviour** — not the TTL, not the timeout,
 * not what a caller falls back to. It only records the answer to *"why?"*
 * beside the answer itself, so `/api/health` can say it.
 */
interface CatalogRegistryMemo {
  /** ⚠️ **The TTL base, and it is the moment the read STARTED** — unchanged
   *  from before this instrumentation, deliberately: a memo timed from the end
   *  of a slow fetch would live longer than ten minutes. */
  at: number;
  catalogs: CatalogEntry[] | null;
  source: CatalogRegistrySource;
  /** `null` exactly when `source === 'registry'`. Otherwise the WORDED reason:
   *  `'timeout'`, `'http 503'`, `'shape'` or `'error: <message>'`. */
  reason: string | null;
  /** How long the attempt took, in ms. */
  fetchMs: number;
  /** When the answer (or the failure) actually ARRIVED — `at + fetchMs`. */
  fetchedAt: number;
}

/**
 * ⚠️ **Isolate-local, and it caches the FAILURE too** (as `null`). A directory
 * that is unreachable and retried on every turn turns a directory outage into a
 * latency outage; remembering *"it did not answer"* for the same ten minutes is
 * what keeps the worded fallback cheap.
 */
let memo: CatalogRegistryMemo | null = null;

/** Tests only. Production never calls it — the memo's whole point is to survive. */
export function resetCatalogRegistryCache(): void {
  memo = null;
}

/** What this isolate is holding, and why. `ageMs` is how long it has held it. */
export interface CatalogRegistryState extends CatalogRegistryMemo {
  ageMs: number;
}

/**
 * ⚠️ **A PURE READER — it never fetches, never populates and never expires the
 * memo.** It answers *"what is this isolate holding right now, and why?"* and
 * nothing else, so a health route can report the state without changing it.
 *
 * `null` means **this isolate has not read the directory at all** — which on a
 * posture-off Worker is the permanent and correct answer (no subrequest is ever
 * made), and on a posture-on one only ever happens before the first read.
 *
 * ⚠️ It deliberately does NOT check the posture: the posture is the caller's
 * (two lanes, two levers — see `loadCatalogs`), and a reader that enforced one
 * would report the other lane's memo as absent.
 */
export function catalogRegistryState(deps: Pick<CatalogRegistryDeps, 'now'> = {}): CatalogRegistryState | null {
  if (!memo) return null;
  const now = deps.now ?? Date.now;
  return { ...memo, ageMs: Math.max(0, now() - memo.at) };
}

/**
 * A thrown fetch failure → the worded reason the memo records.
 *
 * ⚠️ **`AbortSignal.timeout` is the ONLY thing that aborts this request**, so an
 * abort of any name is our own two-second ceiling and is reported as `timeout`
 * rather than as a mysterious error. Runtimes disagree on the name
 * (`TimeoutError` in Workers, `AbortError` in some Node/undici builds) and on
 * whether the word reaches the message at all, so all three are checked.
 *
 * ⚠️ Anything else keeps its own message, TRUNCATED — a health row is read by a
 * person, and an unbounded upstream string is how a diagnostic row becomes a
 * wall. Fetch failure messages carry no credential (this read sends none).
 */
export function catalogRegistryFailureReason(err: unknown): string {
  const name = typeof (err as { name?: unknown })?.name === 'string' ? (err as { name: string }).name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
  const message = err instanceof Error ? err.message : String(err);
  if (/\b(timed out|timeout|aborted)\b/i.test(message)) return 'timeout';
  const trimmed = message.trim().replace(/\s+/g, ' ');
  const short = trimmed.length > 120 ? `${trimmed.slice(0, 119)}…` : trimmed;
  return `error: ${short || 'no message'}`;
}

/**
 * The estate's catalogs, or `null` when the directory did not say.
 *
 * ⚠️ **`null` means "the registry did not answer", which is NOT the same fact
 * as "the estate has no catalogs"** and must never collapse into it. Callers
 * fall back to their own configured values and say so in words; nothing here
 * throws, and nothing here guesses.
 *
 * ⚠️ **THE POSTURE IS THE CALLER'S, and this function deliberately does not
 * check one.** There are two lanes with two levers — `GABI_PANEL_REGISTRY` for
 * the deep link's host, `GABI_CATALOG_REGISTRY` for the shelves and their names
 * — and a loader that enforced either would silently switch off the other. Each
 * caller asks its own posture BEFORE calling, so posture-off is still zero
 * subrequests; they then share this one fetch and this one memo.
 */
export async function loadCatalogs(
  env: Pick<Env, 'INDEX_BASE_URL'>,
  deps: CatalogRegistryDeps = {},
): Promise<CatalogEntry[] | null> {
  const now = deps.now ?? Date.now;
  const at = now();
  if (memo && at - memo.at < CATALOG_REGISTRY_TTL_MS) return memo.catalogs;

  const doFetch = deps.fetch ?? fetch;
  let catalogs: CatalogEntry[] | null = null;
  // ⚠️ Set on every failure branch, and the branches are exhaustive: a `null`
  // answer with a `null` reason would be exactly the un-diagnosable state this
  // instrumentation exists to end, so the assembly below refuses to produce one.
  let reason: string | null = null;
  try {
    const res = await doFetch(new URL('/api/catalogs', indexBase(env)).toString(), {
      // ⚠️ NO Authorization header. That absence IS the scope decision — the
      // anonymous branch is names-only and this Worker has no business asking
      // for anybody's counts.
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(CATALOG_REGISTRY_TIMEOUT_MS),
    });
    if (res.ok) {
      catalogs = parseCatalogs(await res.json());
      if (!catalogs) {
        reason = 'shape';
        console.error('GABI registry: the estate directory answered a shape we do not understand; using the configured fallback.');
      }
    } else {
      // ⚠️ `http 503`, not `503` — this string is read by a person on
      // `/api/health`, and a bare number there is a puzzle, not a diagnosis.
      reason = `http ${res.status}`;
      console.error(`GABI registry: the estate directory answered HTTP ${res.status}; using the configured fallback.`);
    }
  } catch (err) {
    reason = catalogRegistryFailureReason(err);
    console.error(
      `GABI registry: the estate directory could not be read (${reason}):`,
      err instanceof Error ? err.message : err,
    );
  }

  const fetchedAt = now();
  memo = {
    at,
    catalogs,
    source: catalogs ? 'registry' : 'fallback',
    // ⚠️ Belt and braces: a `null` answer ALWAYS carries words. If a future
    // branch forgets to set one, the health row says so plainly rather than
    // reporting a reasonless failure.
    reason: catalogs ? null : (reason ?? 'unknown — the directory answered nothing this code recognises'),
    fetchMs: Math.max(0, fetchedAt - at),
    fetchedAt,
  };
  return catalogs;
}

/**
 * ⚠️ **THE ONE CALL A LABEL LANE SHOULD MAKE** — the posture, then the
 * directory, in the right order. `loadCatalogs` deliberately checks no posture
 * (two lanes, two levers); this is the wrapper for the lane that
 * `GABI_CATALOG_REGISTRY` governs, so a caller cannot accidentally read the
 * directory with the switch off.
 *
 * Posture off → `null`, **no subrequest**, and every caller falls back to its
 * own configured words.
 */
export async function estateCatalogs(
  env: Pick<Env, 'GABI_CATALOG_REGISTRY' | 'INDEX_BASE_URL'>,
  deps: CatalogRegistryDeps = {},
): Promise<CatalogEntry[] | null> {
  if (!catalogRegistryOn(env)) return null;
  return loadCatalogs(env, deps);
}

// ---------------------------------------------------------------------------
// The health rows — the one place that turns the memo into words
// ---------------------------------------------------------------------------

/**
 * ⚠️ **THE ROWS `/api/health` PUBLISHES ABOUT THIS LANE**, built here rather
 * than in `index.ts` so the wording and the memo cannot drift apart, and so
 * every state is a pure unit test with no network.
 *
 * ⚠️ **Every value is words a person can read.** A bare `503` in a health row
 * is a puzzle; `http 503` is a diagnosis. That rule is why `reason` is a string
 * and never a status code, and why `off` is a source rather than an absent row.
 */
export interface CatalogRegistryHealthRows {
  /** `registry` = the directory answered · `fallback` = it did not, see the
   *  reason · `off` = the posture is off and no subrequest is ever made. */
  gabi_catalog_registry_source: CatalogRegistrySource | 'off';
  /** `null` exactly when nothing went wrong (`source: 'registry'`). */
  gabi_catalog_registry_reason: string | null;
  /** How long THIS ISOLATE has held that answer, whole seconds. `null` when
   *  there is nothing held. ⚠️ At `CATALOG_REGISTRY_TTL_MS`/1000 = 600 it is
   *  due to be re-read on the next call. */
  gabi_catalog_registry_age_s: number | null;
  /** How long the read that produced it TOOK, in ms — the number that says
   *  whether the 2 s ceiling is close. `null` when no read was made. */
  gabi_catalog_registry_fetch_ms: number | null;
}

/**
 * The memo, as `/api/health` says it.
 *
 * ⚠️ **Reads the memo; never populates it.** A health route that triggered the
 * fetch would be measuring itself. The caller reads the shelves first (which is
 * what populates the memo, once per isolate per ten minutes) and this reports
 * what that left behind.
 */
export function catalogRegistryHealthRows(
  env: Pick<Env, 'GABI_CATALOG_REGISTRY'>,
  deps: Pick<CatalogRegistryDeps, 'now'> = {},
): CatalogRegistryHealthRows {
  if (!catalogRegistryOn(env)) {
    return {
      gabi_catalog_registry_source: 'off',
      gabi_catalog_registry_reason: 'the posture is off, so the estate directory is never read',
      gabi_catalog_registry_age_s: null,
      gabi_catalog_registry_fetch_ms: null,
    };
  }
  const state = catalogRegistryState(deps);
  if (!state) {
    // ⚠️ Posture on but nothing held — this isolate has not read the directory
    // yet. On `/api/health` it should be unreachable (the shelves are resolved
    // before these rows are built), so it is stated honestly rather than
    // guessed at: it would mean the read order changed.
    return {
      gabi_catalog_registry_source: 'fallback',
      gabi_catalog_registry_reason: 'the estate directory has not been read in this isolate yet',
      gabi_catalog_registry_age_s: null,
      gabi_catalog_registry_fetch_ms: null,
    };
  }
  return {
    gabi_catalog_registry_source: state.source,
    gabi_catalog_registry_reason: state.reason,
    gabi_catalog_registry_age_s: Math.round(state.ageMs / 1000),
    gabi_catalog_registry_fetch_ms: Math.round(state.fetchMs),
  };
}

// ---------------------------------------------------------------------------
// Lookups — the two vocabularies, and the one place that maps between them
// ---------------------------------------------------------------------------

/** The VISIBILITY vocabulary (`games`, what a grant is keyed on) → its catalog. */
export function catalogById(
  catalogs: readonly CatalogEntry[] | null,
  id: string,
): CatalogEntry | null {
  return catalogs?.find((c) => c.id === id) ?? null;
}

/**
 * The PUSH vocabulary (`game`, what `entry.source` carries) + the row's format
 * → its catalog. **The estate's one source+format → catalog map.**
 *
 * ⚠️ **THE EBOOK CASE IS WHY THIS TAKES A FORMAT.** Ebook rows ride
 * `PUT /api/push/audiobook` with `format: 'ebook'` because — `audiobook_catalog`'s
 * own `app/index_push.py:54` — *"'audiobook' the source means the household's
 * shared pool"*. So `ebooks` has no push source of its own, and a row that says
 * `audiobook` + `ebook` belongs to the shared EBOOK shelf, not the audiobook
 * one. The remap fires ONLY when the matched catalog is itself the shared
 * digital pool: a hypothetical `library` row carrying `format: 'ebook'` still
 * reads as that library's own copy, because it would be one.
 */
export function catalogForEntry(
  catalogs: readonly CatalogEntry[] | null,
  source: string,
  format: string | null = null,
): CatalogEntry | null {
  const direct = catalogs?.find((c) => c.push_source === source) ?? null;
  if (format === 'ebook' && direct && direct.shared && direct.holding === 'digital') {
    const ebooks = catalogs?.find((c) => c.shared && c.holding === 'digital' && c.kind === 'books');
    if (ebooks) return ebooks;
  }
  return direct;
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** A row's shelf, in words. Degrades to a worded unknown, never to an id. */
export function labelForEntry(
  catalogs: readonly CatalogEntry[] | null,
  source: string,
  format: string | null = null,
): string {
  return catalogForEntry(catalogs, source, format)?.label ?? UNKNOWN_SHELF;
}

/** A catalog id, in words. Degrades to a worded unknown, never to an id. */
export function labelForCatalog(catalogs: readonly CatalogEntry[] | null, id: string): string {
  return catalogById(catalogs, id)?.label ?? UNKNOWN_SHELF;
}

/**
 * WHO OWNS IT — the sentence the owner's rule is actually about.
 *
 * ⚠️ A shared pool prints *"shared"* and never an empty name; a private catalog
 * with no owner recorded says what is known and no more, because inventing a
 * holder is the exact failure this whole build is about.
 */
export function designation(cat: CatalogEntry | null): string {
  if (!cat) return UNKNOWN_SHELF;
  if (cat.shared) return `shared across the estate · ${cat.holding}`;
  if (cat.owner) return `${cat.owner}'s · ${cat.holding} copies`;
  return `${cat.holding} copies · holder not recorded`;
}

/** ["a", "b", "c"] → "a, b and c". A list a person reads out loud. */
export function joinWords(parts: readonly string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
