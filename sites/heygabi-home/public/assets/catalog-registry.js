/**
 * catalog-registry.js — THE APEX'S ONE READER of the estate catalog registry.
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58: *"Make sure everything
 * we have that's in the estate connects to multiple libraries and make sure
 * that the libraries are designated by who owns the physical or shared with
 * digital works."*
 *
 * The registry is `GET https://index.heygabi.ai/api/catalogs` — built and
 * deployed 2026-09-05 (docs/info/catalog-registry.md). It answers, for every
 * catalog the estate has:
 *
 *   { id, push_source, kind, label, owner, holding, shared, host }
 *
 * plus, for a SIGNED-IN member and only for the catalogs their own visibility
 * admits, `rows` and `pushed_at`. An anonymous caller gets names and no counts
 * at all (`counts: "none"`), which is the owner's decision of 16:14 — *"yes
 * name only"* — and is why every label on this site can be right before
 * anybody signs in.
 *
 * ## What this file REPLACES, and why that is the whole point
 *
 * The 2026-09-05 survey (docs/info/multi-library-survey-2026-09-05.md §2 F2)
 * measured **seven** hand-kept source→label maps in the estate, in **seven
 * disagreeing spellings** of two libraries — `library` was called "library",
 * "Skylar's library", "Library", "Book library", "Sky's Library" and "the main
 * library" depending on which file you read. Five of those seven were on this
 * site. They are gone; this module is where the words come from now.
 *
 * ⚠️ **THERE IS NO HARD-CODED CATALOG LIST HERE, DELIBERATELY** — the same
 * rule the Worker keeps (catalogs-route.ts). "The directory is unreachable"
 * and "these are the catalogs" are different facts, and a fallback list that
 * answered the second would make an outage invisible and could serve a label
 * the owner corrected months ago. What a caller gets on failure is a WORDED
 * refusal it can render, never a guess and never a bare status.
 *
 * ## ⚠️ Its deliberate twin: assets/estate-search.js
 *
 * `estate-search.js` carries its OWN inline copy of the fetch + the label
 * helpers and does NOT import this file. That is not an oversight and must not
 * be "fixed": the component is synced VERBATIM AND ALONE into
 * `library_catalog/apps/web/public/estate/` and
 * `Board_Game_Catalog/apps/web/public/estate/` by each repo's
 * `scripts/sync-estate-search.mjs`, which copies exactly one file. A sibling
 * import would 404 on both of those sites and take their search box with it.
 *
 * They are therefore **near-duplicates that exist on purpose and are NOT
 * interchangeable**. `scripts/test/catalog-registry.test.mjs` pins the facts
 * both must agree on (the URL, the unknown-shelf wording, the ebook mapping),
 * so a change to one that forgets the other fails `npm test`.
 *
 * ## What a consumer must NOT do with this
 *
 * ⚠️ **Never a permission.** The registry is cached ten minutes upstream, so a
 * label edited in D1 can take that long to appear and two isolates can
 * disagree in the window. That is fine for a name and wrong for a grant. The
 * `rows`/`pushed_at` keys are ABSENT — not null, not zero — when the caller
 * holds no grant for that catalog; treat a missing key as "this answer does
 * not carry a count", never as zero.
 */

/** The public route. One string, so a test can pin it. */
export const REGISTRY_URL = 'https://index.heygabi.ai/api/catalogs';

/**
 * What a shelf is called when the registry does not name it.
 *
 * ⚠️ NEVER the raw `source` id. The old `MAP[x] || x` fallbacks printed
 * database vocabulary — the literal string "library2" — into an English
 * sentence in front of a person (survey §2 F1). A worded unknown is honest and
 * a database word is not.
 */
export const UNKNOWN_SHELF = 'a shelf we cannot name';

/**
 * The sentence a surface shows when the fetch FAILED — an outage, in words.
 *
 * ⚠️ An outage is not a permission failure, and saying so is not optional:
 * mislabelling one sends people asking for access they already have. Same
 * shape as apex-notices.js's own refusal wording, whose "outage, not a
 * permissions problem" phrase is pinned by predeploy.checks.json.
 */
export const REGISTRY_DOWN_NOTICE =
  'We couldn’t reach the estate index just now, so the shelves below are named from this page’s own ' +
  'copy and may be out of date. That’s an outage on our side, not a permissions problem — nothing is ' +
  'wrong with your account and there is nothing to sign in to.';

/* ------------------------------------------------------------------ *
 * Parsing — validated, not trusted
 * ------------------------------------------------------------------ */

/**
 * `GET /api/catalogs`'s body → the catalogs, or `null` if it is not that shape.
 *
 * ⚠️ VALIDATED EVEN THOUGH THE FAR END IS OUR OWN WORKER, for the same reason
 * the Worker validates the auth Worker: a partially-deployed estate is a normal
 * state, and a malformed entry that reached here would be rendered as a label
 * on the estate's front door. Unknown KEYS are kept — the registry is expected
 * to grow fields — but the ones this site renders are checked.
 */
export function parseCatalogs(body) {
  if (body === null || typeof body !== 'object') return null;
  const list = body.catalogs;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out = [];
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.label !== 'string' || !raw.label) return null;
    if (typeof raw.host !== 'string' || !raw.host) return null;
    if (typeof raw.kind !== 'string' || !raw.kind) return null;
    if (raw.holding !== 'physical' && raw.holding !== 'digital') return null;
    if (typeof raw.shared !== 'boolean') return null;
    if (raw.owner !== null && typeof raw.owner !== 'string') return null;
    if (raw.push_source !== null && typeof raw.push_source !== 'string') return null;
    out.push({ ...raw });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The fetch
 * ------------------------------------------------------------------ */

/**
 * Per-page memo, keyed on whether a bearer was presented. Two keys because the
 * two answers differ: the member one carries scoped counts and is `no-store`,
 * the anonymous one is names only and edge-cacheable.
 */
let memo = new Map();

/** Test seam only — never called by a page. */
export function __resetRegistry() {
  memo = new Map();
}

/**
 * Load the registry.
 *
 * @returns {Promise<
 *   | { ok: true, catalogs: object[], counts: 'none'|'scoped', stale: boolean, fetchedAt: string|null }
 *   | { ok: false, reason: 'network'|'unavailable'|'malformed', detail: string }
 * >}
 *
 * ⚠️ THE FOUR OUTCOMES STAY DISTINCT even though every one of them renders the
 * same sentence to a person. On the day somebody debugs a front door that has
 * forgotten what the shelves are called, "the fetch threw" and "the Worker
 * answered a shape we do not understand" are the whole answer, and folding them
 * together throws that away.
 */
export async function loadCatalogs({ token = null, fetchImpl = null, url = REGISTRY_URL, force = false } = {}) {
  const key = token ? 'member' : 'anon';
  if (!force && memo.has(key)) return memo.get(key);
  const doFetch = fetchImpl || globalThis.fetch;
  const run = (async () => {
    let res;
    try {
      res = await doFetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
    } catch {
      return { ok: false, reason: 'network', detail: REGISTRY_DOWN_NOTICE };
    }
    if (!res || !res.ok) return { ok: false, reason: 'unavailable', detail: REGISTRY_DOWN_NOTICE };
    let body;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: 'malformed', detail: REGISTRY_DOWN_NOTICE };
    }
    const catalogs = parseCatalogs(body);
    if (!catalogs) return { ok: false, reason: 'malformed', detail: REGISTRY_DOWN_NOTICE };
    return {
      ok: true,
      catalogs,
      counts: body.counts === 'scoped' ? 'scoped' : 'none',
      stale: body.stale === true,
      fetchedAt: typeof body.fetched_at === 'string' ? body.fetched_at : null,
    };
  })();
  memo.set(key, run);
  const settled = await run;
  // ⚠️ A FAILURE IS NOT MEMOISED. A card list that failed once on a flaky
  // network would otherwise stay wrong for the life of the page, and the next
  // consumer on the same page pays one cheap retry instead of inheriting it.
  if (!settled.ok) memo.delete(key);
  return settled;
}

/* ------------------------------------------------------------------ *
 * Lookups — the two vocabularies, and the one place that maps between them
 * ------------------------------------------------------------------ */

/**
 * The VISIBILITY vocabulary (`games`, what a grant is keyed on, what `scope`
 * carries) → its catalog.
 */
export function catalogById(catalogs, id) {
  return catalogs.find((c) => c.id === id) || null;
}

/**
 * The PUSH vocabulary (`game`, what `entry.source` carries) + the row's format
 * → its catalog. **This is the estate's one source+format → catalog map.**
 *
 * ⚠️ THE EBOOK CASE IS THE REASON THIS TAKES A FORMAT. Ebook rows ride
 * `PUT /api/push/audiobook` with `format: 'ebook'`, because — audiobook_catalog's
 * own `app/index_push.py:54` — *"'audiobook' the source means the household's
 * shared pool"*. So `ebooks` has NO push source of its own (`push_source` is
 * null in the registry and null is the answer, not a gap), and a row that says
 * `audiobook` + `ebook` belongs to the shared EBOOK shelf, not to the audiobook
 * one.
 *
 * ⚠️ `series/series.js` carried a header comment asserting the opposite —
 * that ebooks ride a LIBRARY source and render as "Skylar's library (ebook)".
 * The survey measured that false (§2 F3) and it was worse than merely wrong: it
 * described exactly the attribution the owner's rule forbids, a shared digital
 * work credited to one person's physical shelf. It is deleted, and this is the
 * one place the real mapping lives.
 *
 * ⚠️ The remap fires ONLY when the matched catalog is itself the shared digital
 * pool. A hypothetical `library` row carrying `format: 'ebook'` still reads as
 * that library's own copy, because it would be one.
 */
export function catalogForEntry(catalogs, source, format = null) {
  const direct = catalogs.find((c) => c.push_source === source) || null;
  if (format === 'ebook' && direct && direct.shared === true && direct.holding === 'digital') {
    const ebooks = catalogs.find((c) => c.shared === true && c.holding === 'digital' && c.kind === 'books');
    if (ebooks) return ebooks;
  }
  return direct;
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** A row's shelf, in words. Degrades to a worded unknown, never to an id. */
export function labelForEntry(catalogs, source, format = null) {
  const cat = catalogForEntry(catalogs, source, format);
  return cat ? cat.label : UNKNOWN_SHELF;
}

/** A scope/visibility id, in words. Degrades to a worded unknown, never to an id. */
export function labelForCatalog(catalogs, id) {
  const cat = catalogById(catalogs, id);
  return cat ? cat.label : UNKNOWN_SHELF;
}

/**
 * WHO OWNS IT — the sentence the owner's rule is actually about.
 *
 * ⚠️ `owner` is null exactly when `shared` is true, and a renderer must print
 * *"shared"* rather than an empty name (catalog-registry.md §2). A digital pool
 * has no one owner; that is the whole distinction the rule draws.
 */
export function designation(cat) {
  if (!cat) return UNKNOWN_SHELF;
  if (cat.shared) return `Shared across the estate · ${cat.holding}`;
  if (cat.owner) return `${cat.owner}’s · ${cat.holding} copies`;
  // A private catalog with no owner name recorded. Say what is known and no
  // more — inventing a holder here is the failure this whole build is about.
  return `${cat.holding} copies · holder not recorded`;
}

/**
 * A format already implied by the shelf's own name — saying it twice ("Shared
 * audiobooks · audiobook") is noise.
 *
 * ⚠️ Derived from `kind`/`holding`, NOT from a per-catalog table, so a
 * `library3` inherits the right behaviour with no edit anywhere. This is a fact
 * about ENGLISH, not about which catalogs exist, which is why it can live in
 * code at all.
 */
export function impliedFormat(cat) {
  if (!cat) return null;
  if (cat.kind === 'audio') return 'audiobook';
  if (cat.kind === 'games') return 'boardgame';
  if (cat.kind === 'books' && cat.holding === 'digital') return 'ebook';
  return null;
}

/** The format worth printing beside the shelf's name, or `null` when implied. */
export function formatSuffix(cat, format) {
  if (!format) return null;
  return impliedFormat(cat) === format ? null : format;
}

/** ["a", "b", "c"] → "a, b and c". A list a person reads out loud. */
export function joinWords(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * The shelves a scope covers, in words: "Shared audiobooks, Skylar's library
 * and Skylar's board games".
 */
export function scopePhrase(catalogs, scope) {
  if (!Array.isArray(scope) || scope.length === 0) return '';
  return joinWords(scope.map((id) => labelForCatalog(catalogs, id)));
}

/**
 * 🔴 DOES THIS SCOPE COVER EVERY SHELF? — the replacement for
 * `FULL_SCOPE_SIZE = 3`, which was the single worst line in the estate.
 *
 * The estate has FIVE catalogs; the default grant from migration 0002 is
 * exactly three (`vis_library2` and `vis_ebooks` are `DEFAULT 0`). So the old
 * constant told **every ordinary member their search covered "any shelf" while
 * two shelves were never consulted** — a confident false statement about whose
 * shelves were searched — and suppressed the very sentence that existed to say
 * otherwise.
 *
 * ⚠️ IT IS A SET COMPARISON, NOT A LENGTH COMPARISON. Counting was what broke:
 * any three-catalog grant satisfied a `>= 3` test, including three that were
 * not the three anybody meant. Every catalog id must be present, or the answer
 * is no.
 *
 * ⚠️ Returns `false` when the registry is unknown (`catalogs` empty). We cannot
 * claim a scope is everything without knowing what everything is, and the safe
 * direction of that unknown is to say less, not more.
 */
export function scopeIsEverything(catalogs, scope) {
  if (!Array.isArray(scope) || scope.length === 0) return false;
  if (!Array.isArray(catalogs) || catalogs.length === 0) return false;
  const have = new Set(scope);
  return catalogs.every((c) => have.has(c.id));
}
