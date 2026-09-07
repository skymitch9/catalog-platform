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
 *   catalogId: string|null, notice: boolean
 * }>} every row the section should carry. A row with a `url` is probed; the row
 *   with `notice: true` is rendered as a worded grey state and probed for
 *   nothing.
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
    rows.push({
      id: `${SITE_ROW_PREFIX}${cat.id}`,
      // Same sentence catRow() built by hand for four catalogs: "<label> site — <host>".
      name: `${label} site — ${cat.host}`,
      url: `https://${cat.host}/`,
      catalogId: cat.id,
      notice: false,
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
    });
  }

  return rows;
}

function devLaneRow(label, audioOrigin) {
  return {
    id: DEV_LANE_ROW_ID,
    name: label
      ? `${label} site, /dev/ preview lane`
      : `Preview lane (/dev/) — ${hostOf(audioOrigin)}`,
    url: `${audioOrigin}/dev/`,
    catalogId: null,
    notice: false,
  };
}
