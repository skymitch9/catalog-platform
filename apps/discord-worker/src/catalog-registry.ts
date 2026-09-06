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
 * ⚠️ **Isolate-local, and it caches the FAILURE too** (as `null`). A directory
 * that is unreachable and retried on every turn turns a directory outage into a
 * latency outage; remembering *"it did not answer"* for the same ten minutes is
 * what keeps the worded fallback cheap.
 */
let memo: { at: number; catalogs: CatalogEntry[] | null } | null = null;

/** Tests only. Production never calls it — the memo's whole point is to survive. */
export function resetCatalogRegistryCache(): void {
  memo = null;
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
        console.error('GABI registry: the estate directory answered a shape we do not understand; using the configured fallback.');
      }
    } else {
      console.error(`GABI registry: the estate directory answered HTTP ${res.status}; using the configured fallback.`);
    }
  } catch (err) {
    console.error('GABI registry: the estate directory could not be read:', err instanceof Error ? err.message : err);
  }

  memo = { at, catalogs };
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
