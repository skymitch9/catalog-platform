/**
 * status/lib/host-rows.js — WHICH HOST ROWS EXIST, planned from the estate
 * catalog registry instead of hand-written one literal at a time.
 *
 * Pure: no DOM, no fetch, no timers, no imports. Same shape as
 * `lib/ebook-lane.js` — the verdict is computed here and pinned by
 * `scripts/test/status-host-rows.test.mjs`, so the page script keeps only the
 * wiring. `status.js` cannot be imported in Node (top-level DOM lookups, and
 * `estate-auth.js` pulls the Firebase SDK from a CDN), which is why the part
 * worth testing lives here rather than there.
 *
 * ## What this replaces
 *
 * `docs/TODO.md` (survey §3.1's L-sized item): *"/status's nine hand-written
 * host rows and five per-host health fetches are still hand-written … the row
 * SET is what a `library3` would still need an edit for."* The NAMES came from
 * the registry on 2026-09-05; the SITE row set and its probe list on
 * 2026-09-06; and the **WORKERS and DEPLOYED-VERSIONS row sets on 2026-09-07**,
 * which closes the item. All three of this page's catalog row sets are now one
 * plan each, and not one of them spells a shelf by hand.
 *
 * ⚠️ **THE SITES SECTION WAS THE HALF THE REGISTRY COULD ANSWER FIRST, AND THAT
 * IS A STATEMENT ABOUT THE REGISTRY, NOT ABOUT THE PAGE.**
 * `estate_catalog.host` is `NOT NULL` (migration 0020), and it means *"the
 * hostname it answers on"* — which for every catalog is the site a person
 * types. So a site row needs nothing the registry lacks.
 *
 * ## 🔴 Why the OTHER two sections needed a MIGRATION, not a cleverer derivation
 *
 * Measured live 2026-09-06 (agent W13-PLAT-STATUS) and re-measured 2026-09-07,
 * with `curl -sS -D … -o …` against `GET https://<host>/api/health` for all
 * five registry hosts:
 *
 * | Registry `host` | `/api/health` answers |
 * |---|---|
 * | `library.heygabi.ai` | the estate envelope, `service: "library-catalog"`, `estate.app: "library"` |
 * | `boardgames.heygabi.ai` | the estate envelope, `service: "board-game-catalog"`, `estate.app: "games"` |
 * | `padhard.heygabi.ai` | the estate envelope, `service: "library-catalog"`, `estate.app: "library2"` |
 * | `audiobooks.heygabi.ai` | **HTTP 200 and the site's HTML** — it is a Pages site |
 * | `ebooks.heygabi.ai` | **HTTP 200 and the site's HTML** — same |
 *
 * So *"does this catalog's host serve an estate API"* was **not derivable from
 * any field the registry carried**, and a page that iterated `host` would have
 * rendered two rows reading *"Healthy, but reports no version"* about two hosts
 * running no such Worker — a confident false statement, the exact failure this
 * page is written against. ⚠️ Deriving it from `holding === 'physical'` would
 * have been right by coincidence and is the vocabulary conflation
 * `docs/info/catalog-registry.md` §5 warns about — and the coincidence is
 * ALREADY BROKEN: `audiobook` is shared AND digital AND Worker-backed, at
 * `audiobook-api.heygabi.ai`, a hostname the registry did not carry at all.
 *
 * ⚠️ Nor could the health answer supply the DEPLOY's name: `padhard` reports
 * `service: "library-catalog"`, the CODE's name shared with the main instance,
 * while the deployed Worker is `library-catalog-friend`. **A Worker cannot tell
 * you which deploy it is**, so the deployed name is a fact about the estate and
 * belongs in the estate's registry.
 *
 * ✅ **MIGRATION 0022 (2026-09-07) ADDED BOTH FIELDS, AND THIS FILE READS THEM:**
 *
 *   - `api_host` — the host serving this catalog's estate API, `null` when it
 *     has none of its own. **A catalog with no `api_host` gets no Workers row
 *     and no Deployed-versions row at all**, which is the whole mechanism:
 *     `ebooks` is absent from both sections because it runs no such API, not
 *     because a list forgot it.
 *   - `service` — the DEPLOYED Worker name, which is what the
 *     Deployed-versions parenthetical says and what the health body cannot.
 *
 * ✅ **AND THE JOIN IS NOW VERIFIED RATHER THAN ASSUMED** — the free half
 * `docs/TODO.md` promised. Every catalog Worker reports `estate.app` on its own
 * `/api/health`, which is the registry's own `id`, so `appDisagreement()` below
 * turns a mismatch into a row that SAYS the Worker at this address serves a
 * different catalog — instead of rendering its version under somebody else's
 * name. ⚠️ Checked only when the Worker offers the field: `audiobook-worker`
 * does not, and **an absent fact is not a disagreement.**
 *
 * ## ⚠️ What stays hand-written in `status.js`, and why that is correct
 *
 * The estate's NON-CATALOG Workers — `catalog-index` (index.heygabi.ai),
 * `estate-auth` (auth.heygabi.ai), and the probe-suite row that rides the auth
 * health body. **The registry does not know them and must not:** it answers
 * *"which catalogs exist"*, and neither of those is a catalog. A registry that
 * listed the sign-in directory as a shelf would be answering a second question
 * badly. `estate-discord` and `ebooks-door` are absent from this page for a
 * different reason — nobody has asked for their rows — and `audiobook-worker`
 * appears here for the first time precisely because it IS a catalog's API and
 * the registry now says so.
 */

/** Every site row id starts with this, so a reader can tell the section at a glance. */
export const SITE_ROW_PREFIX = 'site-';

/**
 * 🔴 THE HOSTS THIS PAGE IS PERMITTED TO OPEN A CONNECTION TO — the `connect-src`
 * of `/status`'s own Content-Security-Policy, in `sites/heygabi-home/public/_headers`.
 *
 * ⚠️ **THIS IS THE ONE LIST THAT CANNOT COME FROM THE REGISTRY, EVER, AND THE
 * REASON IS THE ORDER THINGS HAPPEN IN.** A CSP is a response header chosen by
 * the CDN before a single byte of this page runs; a registry fetch happens
 * after. A page cannot widen its own CSP by learning something at runtime — so
 * a catalog can join the directory and this page still may not ask about it.
 *
 * 🔴 **AND IT COST A FALSE RED ROW THE HOUR THE SITES SECTION BECAME
 * REGISTRY-DRIVEN.** Measured live 2026-09-06: `ebooks.heygabi.ai` arrived in
 * the row set the moment the registry drove it, its probe was refused by this
 * CSP, `probeReachable()` saw a thrown fetch exactly as it sees a dead host, and
 * the row read **"DOWN — Did not answer within 8s"** for a site that answers
 * `HEAD /` with `HTTP/1.1 200 OK`. That is a permission failure wearing an
 * outage's clothes — the estate's own rule, inverted: *mislabelling one sends
 * people to fix a host that is fine.*
 *
 * So a host that is not here is **not probed at all** and its row says why.
 *
 * ⚠️ **IT GATES THREE SECTIONS, NOT ONE** (2026-09-07). The Workers and
 * Deployed-versions rows read the SAME list — one array, three sections — which
 * is why `audiobook-api.heygabi.ai` (the `audiobook` catalog's API, a different
 * machine from its site, which migration 0022 put in the registry) blanked two
 * rows the day it arrived rather than one.
 *
 * ✅ **BOTH OF THOSE HOSTS ARE NOW HERE — the owner's `_headers` decision was
 * taken 2026-09-07 (yes to both), and `docs/TODO.md`'s item moved to
 * `DONE.md`.** Four rows that had never once been fetched — `site-ebooks`,
 * `wk-audiobook`, `dep-audiobook`, and the summary's "unknown" count that
 * carried them — are probed for the first time. ⚠️ **The grey-not-red machinery
 * below STAYS AND IS NOT DEAD CODE:** it is what any FUTURE catalog gets, because
 * the ordering argument above has not changed — a `library3` provisioned tomorrow
 * is rowed from the registry at runtime and cannot be probed until somebody edits
 * `_headers`. The tests exercise it against exactly that hypothetical now that no
 * real host is blocked.
 *
 * ⚠️ **IT MUST NOT DRIFT FROM `_headers`, and that is MECHANICAL, not a
 * promise:** `scripts/test/status-host-rows.test.mjs` PARSES `_headers` for the
 * `/status` and `/status/` rules, pulls their `connect-src` out of the real
 * header, and fails if this array disagrees. Same shape as
 * `apps/index-worker/test/read-origins.test.ts` parsing `wrangler.toml` — a
 * hard-coded copy that nothing checks is how two sources survive.
 */
export const PROBEABLE_ORIGINS = [
  'https://index.heygabi.ai',
  'https://auth.heygabi.ai',
  'https://library.heygabi.ai',
  'https://boardgames.heygabi.ai',
  'https://padhard.heygabi.ai',
  'https://audiobooks.heygabi.ai',
  // Added 2026-09-07 with the same two lines in `_headers` (/status and
  // /status/). ⚠️ `ebooks` is the SITE of a catalog that runs no estate API;
  // `audiobook-api` is the API of a catalog whose SITE is the entry above it.
  // Two different kinds of host, one CSP.
  'https://ebooks.heygabi.ai',
  'https://audiobook-api.heygabi.ai',
];

/**
 * What a row says when this page's CSP will not let it ask.
 *
 * ⚠️ GREY AND UNKNOWN, NEVER RED. "We did not look" and "it did not answer" are
 * different facts, and only one of them is true here. The sentence names the
 * limit as this page's own, says the site may be perfectly healthy, and gives
 * the exact one-line fix — no status code, and no implication that anybody's
 * access is wrong.
 */
export const NOT_PROBEABLE_DETAIL = 'Not checked — this page is not allowed to open a connection to this host.';
export const NOT_PROBEABLE_NOTE =
  'The site may be perfectly healthy; this page simply cannot ask. Which hosts it may reach is fixed by the ' +
  'Content-Security-Policy served WITH the page, so it cannot be learned from the catalog directory the way ' +
  'the row itself was. Adding this host is one line in sites/heygabi-home/public/_headers — the connect-src ' +
  'of both the /status and /status/ rules — and it is a security-header change, so it is the owner’s call ' +
  'rather than a page’s.';

/**
 * The same withheld-probe state, worded for a WORKER row rather than a site row.
 *
 * ⚠️ ONE SENTENCE PER KIND OF THING, because "the site may be perfectly
 * healthy" is the wrong reassurance about an API host — the reader of a Workers
 * row is asking about a Worker, and a note that talks about a site reads as
 * though the page has confused the two addresses. It has not: for `audiobook`
 * they are genuinely different machines, which is the whole reason `api_host`
 * exists.
 */
export const NOT_PROBEABLE_API_NOTE =
  'The Worker may be perfectly healthy; this page simply cannot ask. Which hosts it may reach is fixed by the ' +
  'Content-Security-Policy served WITH the page, so it cannot be learned from the catalog directory the way ' +
  'the row itself was. Adding this host is one line in sites/heygabi-home/public/_headers — the connect-src ' +
  'of both the /status and /status/ rules — and it is a security-header change, so it is the owner’s call ' +
  'rather than a page’s.';

/**
 * The id of the ONE site row that is not a catalog: the audiobook site's `/dev/`
 * preview lane.
 *
 * ⚠️ IT IS A DEPLOY LANE, NOT A SHELF, which is why it is not in the registry
 * and must not be added to it. The registry answers *"which catalogs exist"*;
 * `/dev/` is a second copy of one catalog's site that only a promote moves. Its
 * NAME still comes from the registry — it is that catalog's site — so the row
 * cannot go back to spelling a shelf by hand.
 */
export const DEV_LANE_ROW_ID = 'site-audio-dev';

/** The row that stands in for the whole section when the directory is unreadable. */
export const SITE_REGISTRY_ROW_ID = 'site-registry';

/**
 * What the section says when it has no catalogs to list.
 *
 * ⚠️ NOT AN EMPTY PANEL, for `buildIndexSection()`'s reason stated once more
 * because it is the rule this whole page turns on: a section with no rows reads
 * as *"nothing to report"*, which is a confident claim we have no basis for. And
 * it names the failure as an OUTAGE — a person must never be left thinking a
 * blank panel is a permissions problem.
 */
export const SITE_REGISTRY_UNKNOWN_NAME = 'Catalog sites — the list could not be read';
export const SITE_REGISTRY_UNKNOWN_DETAIL =
  'The catalog directory could not be read, so this panel cannot say which sites the estate has.';

/** `https://library.heygabi.ai` → `library.heygabi.ai`. Tolerates a bare host. */
function hostOf(origin) {
  return String(origin || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

/**
 * PLAN THE SITES SECTION — one row per catalog, in the registry's own order,
 * plus the `/dev/` lane row directly after the catalog it is a lane of.
 *
 * @param {Array<{id:string,label:string,host:string}>} catalogs the registry, as
 *   `assets/catalog-registry.js` parsed it. An empty array means *the directory
 *   could not be read* — never *there are no catalogs*.
 * @param {{audioOrigin: string, unknownShelf?: string}} opts
 * @returns {Array<{
 *   id: string, name: string, url: string|null,
 *   catalogId: string|null, notice: boolean, blocked: boolean
 * }>} every row the section should carry. A row with a `url` is probed; a row
 *   with `notice: true` (the directory is unreadable) or `blocked: true` (this
 *   page's CSP forbids the connection) carries no `url`, is probed for nothing,
 *   and is rendered as a worded grey state saying which of the two it is.
 *
 * ⚠️ THE ORDER IS THE REGISTRY'S (`sort_order`, then id — migration 0020's
 * covering index), NOT this file's. That is the same rule `indexSourceOrder()`
 * keeps one section up: a page that re-sorted the catalogs would be a second
 * opinion about their order, and the registry is meant to be the only one.
 *
 * ⚠️ THE `/dev/` LANE ROW SURVIVES A DEAD REGISTRY, deliberately. Its URL is a
 * constant of this site, not a registry fact, so the one row that can still be
 * probed is still probed — and it is named for what it is rather than borrowing
 * a shelf name nothing can supply.
 */
export function siteRowPlan(catalogs, { audioOrigin, unknownShelf = null } = {}) {
  const audioHost = hostOf(audioOrigin);
  const rows = [];

  const list = Array.isArray(catalogs) ? catalogs : [];
  for (const cat of list) {
    if (!cat || typeof cat.id !== 'string' || typeof cat.host !== 'string' || !cat.host) continue;
    const label = typeof cat.label === 'string' && cat.label ? cat.label : (unknownShelf || cat.id);
    const origin = `https://${cat.host}`;
    // ⚠️ The row exists either way — the catalog is real and belongs on the
    // page. Only the PROBE is withheld, and only when this page may not ask.
    const blocked = !PROBEABLE_ORIGINS.includes(origin);
    rows.push({
      id: `${SITE_ROW_PREFIX}${cat.id}`,
      // Same sentence catRow() built by hand for four catalogs: "<label> site — <host>".
      name: `${label} site — ${cat.host}`,
      url: blocked ? null : `${origin}/`,
      catalogId: cat.id,
      notice: false,
      blocked,
    });
    if (cat.host === audioHost) rows.push(devLaneRow(label, audioOrigin));
  }

  if (rows.length === 0 || !rows.some((r) => r.id === DEV_LANE_ROW_ID)) {
    // Either the directory is unreadable, or it no longer names the host this
    // site's /dev/ lane belongs to. Both are states where the lane still exists
    // and can still be probed; only its borrowed name is gone.
    rows.push(devLaneRow(null, audioOrigin));
  }

  if (list.length === 0) {
    rows.unshift({
      id: SITE_REGISTRY_ROW_ID,
      name: SITE_REGISTRY_UNKNOWN_NAME,
      url: null,
      catalogId: null,
      notice: true,
      blocked: false,
    });
  }

  return rows;
}

function devLaneRow(label, audioOrigin) {
  const blocked = !PROBEABLE_ORIGINS.includes(String(audioOrigin || '').replace(/\/+$/, ''));
  return {
    id: DEV_LANE_ROW_ID,
    name: label
      ? `${label} site, /dev/ preview lane`
      : `Preview lane (/dev/) — ${hostOf(audioOrigin)}`,
    url: blocked ? null : `${audioOrigin}/dev/`,
    catalogId: null,
    notice: false,
    blocked,
  };
}

/* ================================================================== *
 * THE CATALOG APIs — the Workers and Deployed-versions row sets (0022)
 * ================================================================== */

/** Every Workers row id for a CATALOG starts with this. */
export const WORKER_ROW_PREFIX = 'wk-';
/** Every Deployed-versions row id for a CATALOG starts with this. */
export const DEPLOY_ROW_PREFIX = 'dep-';

/** The rows that stand in for the catalog half of each section when the directory is unreadable. */
export const WORKER_REGISTRY_ROW_ID = 'wk-registry';
export const DEPLOY_REGISTRY_ROW_ID = 'dep-registry';

export const WORKER_REGISTRY_UNKNOWN_NAME = 'Catalog APIs — the list could not be read';
export const WORKER_REGISTRY_UNKNOWN_DETAIL =
  'The catalog directory could not be read, so this panel cannot say which catalogs run an API of their own. ' +
  'The estate’s own Workers above are unaffected and were checked normally.';
export const DEPLOY_REGISTRY_UNKNOWN_NAME = 'Catalog Workers — the list could not be read';
export const DEPLOY_REGISTRY_UNKNOWN_DETAIL =
  'The catalog directory could not be read, so this panel cannot say which catalog Workers to ask for a version. ' +
  'The estate’s own Workers above are unaffected and were checked normally.';

/**
 * What a Deployed-versions row calls a catalog whose deployed Worker name the
 * registry does not carry.
 *
 * ⚠️ NOT A GUESS AT THE NAME, and not silence either. `service` is NULL when a
 * catalog was recorded live without one — which `/live` allows on purpose,
 * because nothing in the auth Worker can derive another repo's wrangler.toml.
 * The row still exists (it has an API, so it has a version worth asking for);
 * only the parenthetical is honest about being absent.
 */
export const SERVICE_UNRECORDED = 'deployed Worker name not recorded';

/**
 * 🔴 THE CATALOGS THAT RUN AN ESTATE API OF THEIR OWN — the shared spine of the
 * Workers and Deployed-versions sections.
 *
 * ⚠️ ONE ENTRY PER CATALOG, NOT PER SECTION, and that is the point: both
 * sections ask the SAME host the SAME question (`GET /api/health`), so the page
 * fetches it once and renders it twice. Two independently-built lists is how
 * the Workers section and the versions section end up disagreeing about which
 * catalogs exist — which is exactly what they did until 2026-09-07, when both
 * were hand-written and neither knew about `audiobook-api.heygabi.ai`.
 *
 * @param {Array<{id:string,label:string,api_host:string|null,service:string|null}>} catalogs
 *   the registry, as `assets/catalog-registry.js` parsed it. An empty array
 *   means *the directory could not be read* — never *there are no catalogs*.
 * @param {{unknownShelf?: string}} [opts]
 * @returns {Array<{
 *   catalogId: string, label: string, apiHost: string, service: string|null,
 *   origin: string, url: string|null, blocked: boolean
 * }>} in the registry's own order. `url` is null exactly when `blocked` — this
 *   page's CSP forbids the connection — and a blocked entry is never fetched.
 *
 * ⚠️ A CATALOG WITH NO `api_host` IS ABSENT, NOT BLOCKED AND NOT GREY. "This
 * shelf runs no API of its own" is a settled fact about the estate, not a thing
 * we failed to check, and a permanently grey row saying so would be noise on a
 * page whose whole job is that grey means *unknown*.
 */
export function apiCatalogs(catalogs, { unknownShelf = null } = {}) {
  const list = Array.isArray(catalogs) ? catalogs : [];
  const out = [];
  for (const cat of list) {
    if (!cat || typeof cat.id !== 'string') continue;
    const apiHost = typeof cat.api_host === 'string' ? cat.api_host.trim() : '';
    if (!apiHost) continue;
    const origin = `https://${apiHost}`;
    out.push({
      catalogId: cat.id,
      label: typeof cat.label === 'string' && cat.label ? cat.label : (unknownShelf || cat.id),
      apiHost,
      service: typeof cat.service === 'string' && cat.service ? cat.service : null,
      origin,
      // ⚠️ Same CSP rule the site rows keep. It blocked `audiobook-api.heygabi.ai`
      // from 2026-09-07 04:32Z until the `_headers` edit later that day; it now
      // blocks no host the registry currently names, and is kept for the next one
      // the registry learns about before this file's `connect-src` does.
      url: PROBEABLE_ORIGINS.includes(origin) ? `${origin}/api/health` : null,
      blocked: !PROBEABLE_ORIGINS.includes(origin),
    });
  }
  return out;
}

/**
 * PLAN THE CATALOG HALF OF THE WORKERS SECTION — one row per catalog that runs
 * an estate API, in the registry's own order.
 *
 * The name is the sentence `catRow(id, 'API')` built by hand for three
 * catalogs: *"<label> API — <api_host>"*. ⚠️ It says the API HOST, not the
 * site host, because that is the address the row's verdict is about — and for
 * `audiobook` those are two different machines.
 */
export function workerRowPlan(catalogs, opts = {}) {
  const rows = apiCatalogs(catalogs, opts).map((c) => ({
    id: `${WORKER_ROW_PREFIX}${c.catalogId}`,
    name: `${c.label} API — ${c.apiHost}`,
    url: c.url,
    catalogId: c.catalogId,
    apiHost: c.apiHost,
    service: c.service,
    notice: false,
    blocked: c.blocked,
  }));
  return rows.length ? rows : [registryNoticeRow(WORKER_REGISTRY_ROW_ID, WORKER_REGISTRY_UNKNOWN_NAME)];
}

/**
 * PLAN THE CATALOG HALF OF THE DEPLOYED-VERSIONS SECTION.
 *
 * ⚠️ THE PARENTHETICAL IS NOW THE REGISTRY'S `service`, NOT A HAND-WRITTEN REPO
 * NAME. It used to read "(library_catalog worker)" and "(Board_Game_Catalog
 * worker)" — the repo — and "(library-catalog-friend)" — the deploy — in the
 * same list, three literals in two vocabularies. `service` is the DEPLOYED
 * name in every row, which is the one a `wrangler deployments list` and a
 * rollback are keyed on, and therefore the one a person chasing a version can
 * actually use.
 */
export function deployRowPlan(catalogs, opts = {}) {
  const rows = apiCatalogs(catalogs, opts).map((c) => ({
    id: `${DEPLOY_ROW_PREFIX}${c.catalogId}`,
    name: `${c.label} (${c.service || SERVICE_UNRECORDED})`,
    url: c.url,
    catalogId: c.catalogId,
    apiHost: c.apiHost,
    service: c.service,
    notice: false,
    blocked: c.blocked,
  }));
  return rows.length ? rows : [registryNoticeRow(DEPLOY_REGISTRY_ROW_ID, DEPLOY_REGISTRY_UNKNOWN_NAME)];
}

/**
 * ⚠️ NEVER AN EMPTY CATALOG HALF, for `buildIndexSection()`'s reason. Both of
 * these sections keep their non-catalog rows (index, auth) whatever happens, so
 * an unreadable directory would NOT blank the panel — it would silently shrink
 * it, which is worse: the page would look complete while saying nothing about
 * three catalogs. One worded grey row says which fetch failed instead.
 */
function registryNoticeRow(id, name) {
  return { id, name, url: null, catalogId: null, apiHost: null, service: null, notice: true, blocked: false };
}

/**
 * 🔴 DOES THIS WORKER AGREE THAT IT SERVES THIS CATALOG? — the verification the
 * two new columns made free, and the reason the join is measured rather than
 * assumed.
 *
 * Every catalog Worker publishes `estate.app` on its own `/api/health`, and
 * that value is the registry's own `id` (`library`, `games`, `library2`,
 * measured 2026-09-07). So the registry saying *"ask this host about this
 * catalog"* can be CHECKED against what the host says about itself, and a
 * mismatch is a real and dangerous state: a version, a database status and a
 * row count rendered under the wrong shelf's name.
 *
 * @param {string} catalogId the registry's id for the row
 * @param {object|null} healthDetail the normalised `/api/health` detail body
 * @returns {string|null} the sentence to show, or null when there is no
 *   disagreement to report.
 *
 * ⚠️ ABSENCE IS NOT DISAGREEMENT. `audiobook-worker` answers
 * `{ok, service, time, estate_check}` and carries no `estate.app` at all; a
 * Worker that does not claim an app has not contradicted anything, and treating
 * silence as a mismatch would put a red row on the page for a design choice.
 */
export function appDisagreement(catalogId, healthDetail) {
  const app = healthDetail && healthDetail.estate ? healthDetail.estate.app : undefined;
  if (typeof app !== 'string' || !app) return null;
  if (app === catalogId) return null;
  return (
    `This address answered, but it says it serves the catalog “${app}” while the estate directory lists it ` +
    `under “${catalogId}”. One of the two is out of date, so nothing below can be trusted to be about the ` +
    'right shelf and no version is shown. Nothing is broken for anybody using either catalog — this is a ' +
    'bookkeeping disagreement between the directory and the Worker, and it is fixed by correcting whichever ' +
    'is wrong: the registry row (estate_catalog.api_host) or the Worker’s own ESTATE_APP.'
  );
}
