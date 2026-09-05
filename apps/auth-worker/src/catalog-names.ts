/**
 * CATALOG NAMES — the ONE reserved list and the ONE subdomain validator for
 * `<them>.heygabi.ai`.
 *
 * Design: docs/info/request-a-catalog-design.md §3.3, which is one paragraph
 * long and entirely about why this file must not be copied:
 *
 *   ⚠️ ONE RESERVED LIST, ONE VALIDATOR, COVERING BOTH CARDS. The list is a
 *   property of the `heygabi.ai` NAMESPACE, not of a catalog kind. A per-kind
 *   copy would let a games request take `bookcovers.` because the games
 *   validator had never heard of it. Two copies of a hostname list is two
 *   copies that drift, and the drifted one is always the check that mattered.
 *
 * So: the shape check, the availability route, the submit route, the Accept
 * panel's re-validation and both cards' live form checks all resolve to this
 * module. The home site does NOT keep a copy — it asks
 * `GET /api/estate/catalogs/availability?name=` and renders the answer.
 *
 * ⚠️ THE CHECK RUNS SERVER-SIDE ON SUBMIT AS WELL AS LIVE IN THE FORM. The
 * browser's copy is a convenience; the row that lands in D1 is the one that
 * matters, and a form is a thing anybody can skip. (Verbatim the rule
 * universe-add-verse-design.md §3.3 established for the alias check.)
 */

/* ------------------------------------------------------------------ *
 * The kind — a closed vocabulary, browser-supplied, never defaulted
 * ------------------------------------------------------------------ */

/**
 * ⚠️ `kind` IS BROWSER-SUPPLIED AND THERE IS NO SERVER-SIDE PROVENANCE FOR A
 * BUTTON PRESS. Nothing tells this Worker which card was clicked except the
 * body, so the vocabulary is closed here, pinned by the `CHECK` constraint in
 * 0018, and anything outside it is a 400 — never a silent fall back to
 * `'books'`. The column's `DEFAULT 'books'` exists for the MIGRATION's safety
 * (an insert that forgets the column lands as the kind that has a working
 * provisioning path), not as a route behaviour.
 */
export const CATALOG_KINDS = ['books', 'games'] as const;
export type CatalogKind = (typeof CATALOG_KINDS)[number];

export function isCatalogKind(v: unknown): v is CatalogKind {
  return typeof v === 'string' && (CATALOG_KINDS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ *
 * The reserved list
 * ------------------------------------------------------------------ */

/**
 * HOW THIS LIST WAS GATHERED — 2026-09-05, and the method matters more than the
 * entries, because the entries will grow.
 *
 * Two sources, unioned, and deliberately nothing else:
 *
 *  1. **The design's §3.3 list, verbatim:** www, auth, index, discord, docs,
 *     ebooks, audiobooks, boardgames, library, padhard, status, admin, api,
 *     bookcovers, covers, gamecovers.
 *
 *  2. **Every `*.heygabi.ai` hostname the estate actually routes**, measured by
 *     grepping all three repos' `wrangler.toml` route/custom-domain blocks and
 *     the whole of `sites/heygabi-home/` for the literal pattern
 *     `[a-z0-9-]+\.heygabi\.ai`. That added five names §3.3 did not carry, each
 *     with its citation:
 *
 *       audiobook-api  the audiobook Worker's API host (its own custom domain,
 *                      distinct from the `audiobooks.` Pages site)
 *       shelf          the live Audiobookshelf box behind the family Google
 *                      gate (docs/info/shelf-review-2026-08-24.md; linked from
 *                      /admin and /status today)
 *       sam            ⚠️ RETIRED, AND RESERVED BECAUSE IT IS RETIRED. The
 *                      second library instance was `sam.heygabi.ai` before it
 *                      became `padhard.heygabi.ai` (design §7.1). Handing a
 *                      retired hostname to a different person is how an old
 *                      link, an old bookmark or a lingering DNS record starts
 *                      pointing at somebody else's shelf.
 *       books          ⚠️ RESERVED PRECISELY BECAUSE IT IS "NOT CREATED".
 *                      docs/info/HEYGABI_LAYOUT.md §1.1 argues at length that
 *                      the books host is `library.` and that `books.` must not
 *                      exist, because `books.` implies a sibling `ebooks.` app
 *                      and someone eventually builds the second one. A name the
 *                      estate decided not to use is not a free name.
 *       search         the named fallback host for the cross-catalog search if
 *                      the apex arrangement does not survive
 *                      (docs/info/estate-auth-design.md §1097). Not routed
 *                      today; reserved so the fallback stays available.
 *
 * ⚠️ WHAT WAS DELIBERATELY *NOT* ADDED, so a later session does not read the
 * absence as an oversight:
 *
 *   - `amber` — it is the design doc's worked EXAMPLE of a third instance
 *     (§7.2), not a host anything routes. Reserving example values would grow
 *     this list without bound.
 *   - The usual infrastructure vocabulary (mail, ftp, cdn, static, dev,
 *     staging, login, sso, …). None of it is routed here and none of it is in
 *     the design, and inventing policy is not this build's to do. ⚠️ If the
 *     owner wants a broader reservation it is one array edit plus a test — but
 *     it is HIS call, and it belongs on the TODO rather than in a build that
 *     was asked for something else.
 *
 * ⚠️ THIS LIST IS A MEASUREMENT WITH A DATE, NOT A STANDING TRUTH. Every new
 * estate hostname must be added here in the same commit that routes it, or the
 * first person to ask for that name gets told it is free.
 *
 * ⚠️ A THIRD SOURCE WAS ADDED 2026-09-05: THE HOSTNAMES NOTHING ROUTES YET
 * BECAUSE A PROVISIONER WILL MINT THEM. See RESERVED_PATTERNS below — the
 * literal list above cannot express them, because the name does not exist until
 * somebody asks for a catalog and it is the ASKING that creates it.
 */
export const RESERVED_SUBDOMAINS: readonly string[] = [
  // §3.3, verbatim
  'admin',
  'api',
  'audiobooks',
  'auth',
  'boardgames',
  'bookcovers',
  'covers',
  'discord',
  'docs',
  'ebooks',
  'gamecovers',
  'index',
  'library',
  'padhard',
  'status',
  'www',
  // measured 2026-09-05 — routed, retired, or decided-against (see the header)
  'audiobook-api',
  'books',
  'sam',
  'search',
  'shelf',
];

const RESERVED = new Set(RESERVED_SUBDOMAINS);

/* ------------------------------------------------------------------ *
 * The reserved SHAPES — names a provisioner will mint on its own
 * ------------------------------------------------------------------ */

/**
 * 🔴 THE HOLE A LITERAL LIST CANNOT PLUG, and it is the one that bites.
 *
 * The array above is every hostname that exists TODAY. But provisioning a
 * catalog CREATES hostnames — and one of them is not the subdomain the person
 * asked for. Design §7.1, the owner's decision (a) of 2026-09-05: a name follows
 * the requested subdomain only if it is cheap to rename, and **the games covers
 * hostname is not**, because `cover-storage.ts` writes `COVERS_BASE_URL` into
 * every `thumbnail_url` row. So it is ORDINAL — `gamecovers2.heygabi.ai`,
 * `gamecovers3.heygabi.ai`, … — and the second games instance takes it whether
 * or not anybody has been asked.
 *
 * Without this, the first person to type `gamecovers2` is told it is free, the
 * row lands, the owner accepts it, and the provisioner then tries to attach a
 * custom domain that belongs to somebody else's catalog. ⚠️ **A custom domain
 * belongs to exactly ONE bucket** (§7.2 step 2), so the collision is not a
 * cosmetic clash — it is the point at which one of the two catalogs cannot
 * serve its covers at all.
 *
 * MEASURED 2026-09-05 by reading both provisioners' `deriveNames()` READ-ONLY
 * and grepping each for every `*.heygabi.ai` it can construct
 * (`grep -n 'heygabi\.ai\|APEX\|coversHost\|coversBaseUrl\|r2\.dev'`):
 *
 *  - `boardbuddy/Board_Game_Catalog/scripts/provision-catalog.mjs` mints TWO
 *    hostnames: `<desired_subdomain>.heygabi.ai` (`deriveNames():529`, the
 *    availability check already covers it) and
 *    **`gamecovers<N>.heygabi.ai`** (`:539–540`, and `:1367/:1377` really run
 *    `wrangler r2 bucket domain add`). `N` comes from `nextEstateApp()`
 *    (`:386–408`), which counts from **2 to 99** — instance 1 is the digitless
 *    `games`/`gamecovers` pair already in the literal list.
 *  - `bookbuddy/library_catalog/scripts/provision-catalog.mjs` mints exactly
 *    **ONE** hostname: `<desired_subdomain>.heygabi.ai` (`deriveNames():404`).
 *    ⚠️ Its covers URL is the managed **`r2.dev` launch tier**
 *    (`:1156–1181` — `https://pub-<id>.r2.dev`), which is not on this apex at
 *    all, so **no `bookcovers<N>` is minted today**.
 *
 * ⚠️ `bookcovers<N>` IS RESERVED ANYWAY, AND THE REASON IS DIFFERENT FROM
 * `gamecovers<N>`'s — say so rather than letting a later reader assume both were
 * measured the same way. §7.2 step 2 names the r2.dev tier as the LAUNCH tier
 * and a bucket custom domain plus a Cache Rule as the tier the main library
 * actually runs on, "and a third catalog needs a third name, checked free
 * first". The moment any library instance is promoted off the launch tier, the
 * name it needs is `bookcovers2` — and a reservation is worth nothing if it
 * arrives in the same commit as the collision. This one is ANTICIPATION with a
 * citation, not a measurement, and it is cheap: it costs one shape nobody would
 * pick for a catalog of their own.
 *
 * ⚠️ WHAT WAS DELIBERATELY *NOT* ADDED HERE, in the same spirit as the literal
 * list's note:
 *
 *   - `covers<N>` — `covers.heygabi.ai` is the AUDIOBOOK bucket's, and the
 *     audiobook catalog has no provisioner, no `[env.*]` second instance and no
 *     ordinal plan of any kind. There is nothing that would mint it.
 *   - `library<N>`, `boardgames<N>`, `audiobooks<N>` — no provisioner derives a
 *     SITE hostname from the catalog kind. The site host is always the person's
 *     requested subdomain (§7.1: "the hostname stays the only identity-bearing
 *     name"), so an ordinal form of a kind name is not a name anything creates.
 *     Reserving it would be inventing policy, which the literal list's header
 *     already says is the owner's call and not a build's.
 *
 * ⚠️ SHAPES, NOT PREFIXES. `gamecoversx` and `gamecover` are NOT reserved and
 * must stay free — a prefix match would swallow both, and swallow every future
 * word that happens to start the same way. The digits are mandatory.
 */
export interface ReservedShape {
  /** Anchored — a shape, never a prefix. */
  readonly re: RegExp;
  /** What a person is told, in words: why this name is not theirs to take. */
  readonly detail: string;
  /** The measurement or citation behind it, for the header and the tests. */
  readonly source: string;
}

export const RESERVED_PATTERNS: readonly ReservedShape[] = [
  {
    re: /^gamecovers[0-9]+$/,
    detail:
      'is the image address a new board-game catalog is given when it is set up, so it is ' +
      'already spoken for — pick another.',
    source:
      'MEASURED 2026-09-05: Board_Game_Catalog/scripts/provision-catalog.mjs deriveNames():539 ' +
      'mints gamecovers<N>.heygabi.ai and :1367 attaches it as a bucket custom domain; N runs 2–99 ' +
      'via nextEstateApp():386.',
  },
  {
    re: /^bookcovers[0-9]+$/,
    detail:
      'is the image address a new library catalog will be given when it outgrows its starter ' +
      'storage, so it is already spoken for — pick another.',
    source:
      'ANTICIPATED, not measured: library_catalog/scripts/provision-catalog.mjs mints NO covers ' +
      'hostname today (it uses the r2.dev launch tier, :1156–1181). Reserved on design §7.2 ' +
      'step 2 — the custom-domain tier "needs a third name, checked free first".',
  },
];

/**
 * The reserved answer, or null. ⚠️ ONE function, checked by BOTH the literal
 * list and the shapes, so there is no door that consults only half of it — the
 * §3.3 argument for one list is the same argument for one lookup.
 */
export function reservedDetail(name: string): string | null {
  if (RESERVED.has(name)) {
    return `${name}.heygabi.ai is part of the estate itself, so it is not available — pick another.`;
  }
  for (const shape of RESERVED_PATTERNS) {
    if (shape.re.test(name)) return `${name}.heygabi.ai ${shape.detail}`;
  }
  return null;
}

export function isReservedSubdomain(name: string): boolean {
  return reservedDetail(name) !== null;
}

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

/**
 * §3.3's shape, verbatim: lowercase letters, digits and hyphens; 3–40
 * characters; a hyphen may not start or end it.
 *
 * ⚠️ The regex encodes the LENGTH too — `{1,38}` between two mandatory
 * alphanumerics is 3 to 40 inclusive. A separate length check would be a second
 * place for the bound to live, and the two would eventually disagree.
 */
export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const SUBDOMAIN_MIN = 3;
export const SUBDOMAIN_MAX = 40;

/**
 * Trim and lowercase — the ONE normalisation, applied before every check and
 * before the value is stored, so what was validated is what lands in D1.
 *
 * ⚠️ It deliberately does NOT strip anything else. A name with a space or an
 * underscore in it is REFUSED with words, never silently repaired into a
 * different name than the person typed — the estate's standing "refuses, never
 * strips" rule for every write door.
 */
export function normaliseSubdomain(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

export type SubdomainVerdict =
  | { ok: true; name: string }
  | { ok: false; reason: 'shape' | 'reserved'; name: string; detail: string };

/**
 * The shape + reserved check. ⚠️ Availability is NOT decided here — it needs
 * D1, and this module stays pure so both the route and the tests can call it
 * without a database. `catalog-requests.ts` composes the two.
 */
export function checkSubdomain(input: unknown): SubdomainVerdict {
  const name = normaliseSubdomain(input);
  if (!name) {
    return {
      ok: false,
      reason: 'shape',
      name,
      detail: 'Pick an address for your catalog — it becomes <name>.heygabi.ai.',
    };
  }
  if (!SUBDOMAIN_RE.test(name)) {
    return {
      ok: false,
      reason: 'shape',
      name,
      detail:
        `“${name}” cannot be a web address. Use ${SUBDOMAIN_MIN}–${SUBDOMAIN_MAX} lowercase letters, ` +
        'numbers and hyphens, starting and ending with a letter or a number.',
    };
  }
  // ⚠️ SHAPE IS CHECKED FIRST AND STAYS FIRST. A reserved shape is a subset of
  // the legal shapes, so a name that is not a legal subdomain at all must hear
  // "that cannot be a web address", never "that one is taken" — the second
  // sentence would send someone off inventing a different name when the real
  // problem was the space they typed.
  const reserved = reservedDetail(name);
  if (reserved) {
    return { ok: false, reason: 'reserved', name, detail: reserved };
  }
  return { ok: true, name };
}
