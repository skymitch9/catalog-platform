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
 * the registry on 2026-09-05; the SITE row set and its probe list come from it
 * as of 2026-09-06, which is this file.
 *
 * ⚠️ **THE SITES SECTION IS THE HALF THE REGISTRY CAN ANSWER TODAY, AND THAT IS
 * A STATEMENT ABOUT THE REGISTRY, NOT ABOUT THE PAGE.** `estate_catalog.host`
 * is `NOT NULL` (migration 0020), and it means *"the hostname it answers on"* —
 * which for every catalog is the site a person types. So a site row needs
 * nothing the registry lacks, and a provisioned `library3` gets one for free.
 *
 * 🔴 **The Workers and Deployed-versions sections still cannot be planned from
 * here, and the missing fact is NAMED rather than guessed at.** Measured live
 * 2026-09-06 with `curl -sS -D … -o …` against `GET https://<host>/api/health`
 * for all five registry hosts:
 *
 * | Registry host | `/api/health` answers |
 * |---|---|
 * | `library.heygabi.ai` | the estate envelope, `service: "library-catalog"` |
 * | `boardgames.heygabi.ai` | the estate envelope, `service: "board-game-catalog"` |
 * | `padhard.heygabi.ai` | the estate envelope, `service: "library-catalog"` |
 * | `audiobooks.heygabi.ai` | **HTTP 200 and the site's HTML** — it is a Pages site |
 * | `ebooks.heygabi.ai` | **HTTP 200 and the site's HTML** — same |
 *
 * So "does this catalog's host serve an estate API" is **not derivable from any
 * field the registry carries**, and a page that iterated all five would render
 * two Workers rows reading *"Healthy, but reports no version"* for two hosts
 * that run no Worker at all — a confident false statement, which is the exact
 * failure this page is written against. Deriving it from `holding === 'physical'`
 * would be right today by coincidence and is the vocabulary conflation
 * `docs/info/catalog-registry.md` §5 warns about.
 *
 * ⚠️ It cannot be taken from the health answer either, and that was measured
 * too: `padhard.heygabi.ai` reports `service: "library-catalog"`, the CODE's
 * name, not the deployed Worker `library-catalog-friend` that the Deployed-
 * versions row names. A Worker cannot tell you which deploy it is.
 *
 * **The two registry fields that would close it** (`docs/TODO.md`, and
 * `docs/info/catalog-registry.md` §10):
 *
 *   - `api_host TEXT` — the hostname serving this catalog's estate API, `NULL`
 *     when it has none of its own. Equal to `host` for the Worker-backed
 *     catalogs, `audiobook-api.heygabi.ai` for `audiobook`, `NULL` for `ebooks`.
 *   - `service TEXT` — the DEPLOYED Worker name, which is what the
 *     Deployed-versions parenthetical says and what the health body cannot.
 *
 * Both are `apps/auth-worker` (a migration + `estate-catalog.ts`) and
 * `apps/index-worker` (`catalogs-route.ts`) changes, which this pass did not
 * own. Until they exist the Workers and Deployed-versions row sets stay
 * hand-written in `status.js`, and they say so there.
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
