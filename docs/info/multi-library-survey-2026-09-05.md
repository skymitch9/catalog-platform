# Multi-library survey — every single-library assumption in the estate (2026-09-05)

> **Audience:** future Claude sessions first, the owner second.
> **Status:** TRACKED. **Last verified: 2026-09-05.**
>
> ⚠️ **This is a READ-ONLY SURVEY. Nothing here was built, changed, deployed or
> fixed.** Every `file:line` below was read out of source on 2026-09-05 in the
> four repos named in §0. Two things were measured against the LIVE estate that
> day and are marked *(live)*: `GET https://index.heygabi.ai/api/health` and
> `GET https://heygabi.ai/`. Everything else is **source, not production** — it
> proves the code is written, never that the deployed Worker or the rendered
> page behaves that way.
>
> ⚠️ **WHAT WAS NOT CHECKED, so an absence below is not evidence of health:**
> no D1 read, no `wrangler secret list`, no browser, no signed-in session, no
> test run, no live `/api/search` with a real member's scope, no
> `padhard.heygabi.ai` request, no games or audiobook site fetch. The
> `docs/` trees of all four repos were read for overlap (§9) but their claims
> were not re-measured. Anything about what a *person actually sees* is
> inferred from the code that renders it.

---

## 0 · The rule this surveys for

Owner, verbatim (2026-09-05 15:50 Phoenix), confirmed 15:58 (*"Yes that is
correct"*):

> *"Make sure everything we have that's in the estate connects to multiple
> libraries and make sure that the libraries are designated by who owns the
> physical or shared with digital works."*

The settled ownership model:

| Source id | Host | Holding | Designation |
|---|---|---|---|
| `library` | library.heygabi.ai | physical copies | **Skylar's** |
| `library2` | padhard.heygabi.ai | physical copies | **Samantha's** |
| `game` | boardgames.heygabi.ai | physical copies | **Skylar's** |
| `audiobook` | audiobooks.heygabi.ai | digital | **shared** (estate pool) |
| `ebooks` | ebooks.heygabi.ai | digital | **shared** (estate pool) |
| `library3…` | per request | physical | the requester's name |

Repos surveyed:

1. `catalog-platform` — apex `sites/heygabi-home`, `apps/auth-worker`,
   `apps/index-worker`, `apps/discord-worker`, `apps/audiobook-worker`,
   `apps/ebooks-door`, `packages/estate-auth`
2. `bookbuddy/library_catalog` — `library` **and** `library2` (`[env.friend]`)
3. `boardbuddy/Board_Game_Catalog` — `game`
4. `bookbuddy/audiobook_catalog` — `audiobook` + `ebooks` (`docs/` gitignored,
   read from disk)

---

## 1 · The five corrections the dispatch brief needs

⚠️ **Read these before planning any build — four of the brief's starting
points were measured different.**

| Brief said | Measured 2026-09-05 |
|---|---|
| "the three copies of `estate-search.js` become one shared component synced by script" | **The sync script ALREADY EXISTS in both consumer repos** — `library_catalog/scripts/sync-estate-search.mjs` and `Board_Game_Catalog/scripts/sync-estate-search.mjs`, wired into `pretypecheck`/`pretest`/`prebuild`/`predeploy` in both `package.json`s. The apex and library copies are **byte-identical** (md5 `90840e74…` both). The work is NOT "write a sync script"; see §5 |
| "the games repo's copy LACKS `library2`" | True on disk, but it is a **GENERATED build artifact** carrying a `⚠️ GENERATED COPY — DO NOT EDIT` banner. It is stale only because no games build has run since 2026-09-05; the next `npm test` in that repo rewrites it. **Not a code defect** |
| three copies | **FOUR.** `audiobook_catalog/site/estate/estate-search.js` is a **fourth, hand-vendored** copy (banner: *"Vendored 2026-08-17 … This site has no sync-from-sibling build step (unlike library/games), so refresh is manual"*). It is 23 lines behind upstream. **This is the only genuine estate-search divergence** |
| "the auth Worker's catalog table (the provisioner already writes new libraries there)" | `catalog_request` (migration `0018`) is a **REQUEST queue, not a registry** — its own header says so in red: *"A ROW HERE IS A REQUEST, NOT A CATALOG. Nothing reads this table to decide what exists."* It holds **zero rows for the five catalogs that exist today** (nothing back-seeded them) and has no `owner`/`holding`/`shared` columns. `GET /api/catalogs` **cannot** be derived from it without a migration + a back-seed. See §4 |
| `apps/auth-worker/src/catalog-names.ts` `CATALOG_KINDS = ['books','games']` | Correct, but it is the **provisioning kind** (which ledger applies), not the catalog registry. It never names a catalog that exists |

The fifth: the index Worker is **already federation-ready** — W4-FED-INDEX
landed (`a62d7d6`, `25e7a12`). `SOURCES = ['game','library','audiobook','library2']`
(`apps/index-worker/src/rows.ts:33`). *(live)* `/api/health` answers all four:
`game` 838 rows, `library` 497, `audiobook` 1251, **`library2` 0 rows,
`pushed_at: null`** — padhard has still never pushed. So every consumer-side
label fix below is currently **dark** and can be built and shipped safely
ahead of her first push.

---

## 2 · The headline findings, ranked

### 🔴 F1 — The shared search component tells people it searched "any shelf" when it searched three of five

`sites/heygabi-home/public/assets/estate-search.js:227` —
`const FULL_SCOPE_SIZE = 3;`

The estate has **five** catalogs (`CATALOGS = ['audiobook','library','games','library2','ebooks']`,
`packages/estate-auth/src/visibility.ts:62`). The component decides whether to
say *"on any shelf"* by comparing the caller's scope length against `3`:

- `:977` — `data.scope.length < FULL_SCOPE_SIZE ? 'in <scope>' : 'on any shelf'`
- `:735` — `_scopeNote()` returns **null** (no worded note at all) when
  `scope.length >= FULL_SCOPE_SIZE`

The default grant from migration `0002` is exactly `{audiobook, library, games}`
— **three** — because `vis_library2` (0007) and `vis_ebooks` (0008) are
`DEFAULT 0`. So **every ordinary member today is told their search covered
"any shelf" while two shelves were never consulted**, and the sentence that
exists to say otherwise is suppressed by the same constant. Under the owner's
rule this is the single worst line in the estate: it is a confident false
statement about whose shelves were searched.

`:241` — `SCOPE_LABELS = { audiobook, library, games }` has no `library2` and
no `ebooks`, so `_scopePhrase()` falls through to the raw value (`:732`,
`SCOPE_LABELS[c] || c`) and prints the database word **"library2"** in an
English sentence to a person who holds that grant.

**Must become:** scope size and scope labels both read from the registry, not
constants. **Size: M.** **Lands in:** `catalog-platform` (apex deploy) → and
propagates to library + games by their sync scripts, and to the audiobook site
only by a manual re-vendor (§5).

### 🔴 F2 — Five hand-kept source→label maps that already disagree, in SEVEN spellings

There is no single fact "what is `library2` called". Measured:

| # | file:line | Map | `library` says | `library2` says | `game` says | `audiobook` says |
|---|---|---|---|---|---|---|
| 1 | `sites/heygabi-home/public/assets/estate-search.js:234` | `SOURCE_LABELS` | `library` | `Samantha's library` | `board games` | `audiobooks` |
| 2 | `sites/heygabi-home/public/series/series.js:72` | `SOURCE_LABELS` | `Skylar's library` | `Samantha's library` | `games` | `audiobook (shared pool)` |
| 3 | `sites/heygabi-home/public/universes/universes.js:111` | `HOLDER_LABELS` | *(absent)* | `Samantha's library` | *(absent)* | *(absent)* |
| 4 | `sites/heygabi-home/public/admin/admin.js:198` | `CATALOG_LABELS` | `Library` | **`Sam's library`** | `Games` | `Audiobooks` |
| 5 | `sites/heygabi-home/public/status/status.js:194,196,206,235` | inline row strings | `Book library` | **`Sam's book library`** / **`Sam's library`** | `Board game catalog` | `Audiobook site` |
| 6 | `library_catalog/apps/worker/wrangler.toml:221,223,474,477` | `PEER_SELF_LABEL` / `PEERS` | **`Sky's Library`** (id `sky`) | **`the Padhard Library`** (id `padhard`) | — | — |
| 7 | `apps/discord-worker/src/delegated.ts:125-126` | `libraryInstances()` | **`the main library`** | **`your own shelf`** | — | — |

Seven spellings of two libraries. Two of them (#6, #7) are on entirely
different id vocabularies (`sky`/`padhard`; and `library`/`library2` with
asker-relative labels). ⚠️ **#7's `"your own shelf"` is wrong for the owner** —
GABI calls Samantha's shelf "your own shelf" to Skylar.

**Must become:** one registry, every map deleted; `holdingLabel()`
(`series.js:189`) becomes the one renderer, fed by `{owner, holding, shared}`.
**Size: L across the estate, M per surface.** **Lands in:**
`catalog-platform` (apex), `library_catalog` (wrangler PEERS labels),
`catalog-platform` (discord-worker deploy).

### 🔴 F3 — `game` is never designated as Skylar's, and an ebook is attributed to a physical library

The owner's table says `game` = **Skylar's physical**. No surface says so:
`series.js:77` labels it `games`, `estate-search.js:234` `board games`,
`admin.js:200` `Games`. The board-game shelf reads as an unowned estate
facility.

Worse, `series.js:64-66`'s own header asserts:

> *"`ebook` is still not an index source at all — the estate's ebooks arrive as
> `format: 'ebook'` rows under a library source, which `holdingLabel()` renders
> as **"Skylar's library (ebook)"**."*

⚠️ **That comment is STALE and the claim is wrong.** Measured in
`audiobook_catalog/app/index_push.py:54-62`: ebook rows ride
`PUT /api/push/audiobook` with `format:'ebook'`, because *"'audiobook' the
source means the household's shared pool"*. Confirmed on the index side at
`apps/index-worker/src/search-route.ts:60-70` — `ebooks` is *"the ONE catalog
with no source of its own"*, mapped to `''`. So the rendered label is
`audiobook (shared pool) (ebook)`, not `Skylar's library (ebook)`. The comment
would have any session "fixing" a bug that does not exist — and it documents
exactly the attribution the owner's rule forbids (a shared digital work
credited to one person's physical shelf).

**Must become:** `game` designated Skylar's; the stale comment corrected; the
ebook format labelled `shared · ebook`. **Size: S.** **Lands in:**
`catalog-platform` (apex).

### 🔴 F4 — `/status` is blind to `library2` as an index source, and the apex front door still says "three shelves"

- `status/status.js:156` — `INDEX_SOURCE_ORDER = ['audiobook','library','game']`.
  `library2` is absent, so the index panel's *"N rows across 3 of 3 sources"*
  (`:391`) will read **complete** forever while a fourth source sits at zero.
  The TODO already flags this (`docs/TODO.md:125-129`) as needing an
  `INDEX_THRESHOLDS` cadence nobody has measured. `INDEX_THRESHOLDS`
  (`:133-155`) has entries for `audiobook`/`library`/`game` only.
- `status/status.js:194-206,233-235` — worker/site/deploy rows are **nine
  hand-written literals** naming five hosts. A `library3` gets no row without a
  code edit; and there is **no `ebooks.heygabi.ai` row at all** (only an
  ebook-lane heartbeat, `:89-107`).
- *(live)* `sites/heygabi-home/public/index.html:807` — `<h2 id="find-h">One
  question, three shelves</h2>`. There are five catalogs and four index
  sources. Confirmed rendering on `https://heygabi.ai/`.

**Size: M.** **Lands in:** `catalog-platform` (apex).

### 🔴 F5 — *(live)* The apex Books card renders the literal string `!Sky`

`sites/heygabi-home/public/index.html:912`:

```html
<a href="https://library.heygabi.ai" …>!Sky<span class="sr-only"> (opens in a new tab)</span></a>
```

Confirmed live: `curl https://heygabi.ai/` returns
`library.heygabi.ai" target="_blank" rel="noopener">!Sky`. The sibling link on
the same card reads `Samantha`. So the estate's front door labels the owner's
own library **`!Sky`** and the other **`Samantha`** — the exact "who owns it"
surface the rule is about, with a stray `!` on it. The card's `<p class="what">`
also says *"Paper-and-ebook shelves"*, which contradicts the settled model
(ebooks are the shared pool, its own card two `<li>`s above).

**Size: S** (one character + one sentence), **but it is the highest-visibility
line in the estate.** **Lands in:** `catalog-platform` (apex).

---

## 3 · Full inventory, by repo then surface

Legend — **Size:** S ≤ 1 file / a few lines · M = one surface, tests · L =
crosses a repo or needs a migration.

### 3.1 · `catalog-platform` — apex `sites/heygabi-home`

| file:line | What it assumes | What the multi-library version must do | Size |
|---|---|---|---|
| `public/assets/estate-search.js:227` `FULL_SCOPE_SIZE = 3` | full scope is three catalogs | read the registry's length; "any shelf" only when scope == every catalog. **F1** | M |
| `public/assets/estate-search.js:234` `SOURCE_LABELS` | 4 hard-coded labels | registry `label`+`owner`; delete the map. **F2** | M |
| `public/assets/estate-search.js:241` `SCOPE_LABELS` | 3 keys; `library2`/`ebooks` fall through to raw db words | registry-driven | S |
| `public/assets/estate-search.js:730,732` `_sourceLabel`/`_scopePhrase` | `MAP[x] \|\| x` — degrades to database vocabulary | degrade to a worded unknown, never a source id | S |
| `public/assets/estate-search.js:865` `` `${label}: ${format}` `` | source label + format is the whole holding phrase | must carry owner + physical/shared | S |
| `public/assets/estate-scan.js:634,645` `https://library.heygabi.ai/api/scan-jobs/barcode` | **the only shelf you can add a scanned book to is Skylar's** | the "Add to Books" target must be chosen from the registry (which library is this person adding to?) — ⚠️ access-relevant, a write door | M |
| `public/series/series.js:72` `SOURCE_LABELS` | 4 labels, `game` undesignated | **F2/F3** | M |
| `public/series/series.js:64-66` header comment | claims ebooks ride a *library* source | **STALE — measured false. F3** | S |
| `public/series/series.js:83` `CATALOG_LABELS` | a second map re-deriving from the first; `games↔game` translated here | one registry knows the two vocabularies | S |
| `public/series/series.js:92` `IMPLIED_FORMAT` | per-source implied format, 3 keys | registry `holding` decides | S |
| `public/series/series.js:189` `holdingLabel(source, format)` | **the estate's one holding renderer** — exists, is good, and knows nothing about owner/shared | becomes the registry consumer every surface calls | M |
| `public/universes/universes.js:111` `HOLDER_LABELS = { library2 }` | only `library2` needs naming; `library` is "the default" | under the rule EVERY physical row names its owner | M |
| `public/universes/universes.js:97` `GAME_SOURCES = new Set(['game'])` | one games source ever | registry `kind`; a `games2` would silently render as a book | S |
| `public/universes/universes.js:245-250` row subtitle | shows a holder only when the format cannot | show owner always for physical, "shared" for digital | M |
| `public/status/status.js:156` `INDEX_SOURCE_ORDER` | 3 sources | registry; **F4** | M |
| `public/status/status.js:133-155` `INDEX_THRESHOLDS` | per-source cadence, 3 entries | per-catalog cadence from the registry (⚠️ a new source has no measured cadence — see `docs/TODO.md:127`) | M |
| `public/status/status.js:194-206,233-235,278-280,730-763` | **9 hard-coded host rows + 5 hard-coded health fetches** (`libraryHealth`, `gamesHealth`, `library2Health`, …) | iterate the registry's `host` list | L |
| `public/status/status.js` | **no `ebooks.heygabi.ai` row exists** | the fifth catalog gets a row | S |
| `public/admin/admin.js:182` `CATALOGS` | **a third in-repo copy** of the canonical array | one source (`packages/estate-auth`), served or synced | M |
| `public/admin/admin.js:198` `CATALOG_LABELS` (`"Sam's library"`) | hand labels, disagreeing spelling. **F2** | registry | S |
| `public/admin/admin.js:237-239` `APP_WORKERS` | `{key,label,origin,seedGap}` per app, hand-kept — **this is an embryonic registry** | fold into the real one | M |
| `public/admin/admin.js:262-264` `SITE_ROWS` | one row per site, hand-kept | registry | M |
| `public/admin/admin.js:415` `ROLE_FILTER_KEYS` | 4 keys, hand-kept | registry | S |
| `public/admin/index.html:964,1049-1064` | `data-cat="library2"` chip + `f-role-library2` select + host notes, **hand-written HTML per catalog** | rendered from the registry | M |
| `public/index.html:807` "three shelves" | 3 | **F4** | S |
| `public/index.html:912` `!Sky` | — | **F5** | S |
| `public/index.html:911` *"Paper-and-ebook shelves"* | libraries hold ebooks | contradicts the settled model. **F5** | S |
| `public/index.html:855-950` the cards | one `<li>` per catalog, hand-written; a `library3` needs a hand edit | registry-rendered card list (⚠️ or accept it — see §8 Q2) | M |
| `predeploy.checks.json` | pins some of the above | update with whatever moves | S |

### 3.2 · `catalog-platform` — `apps/auth-worker`

| file:line | What it assumes | What must change | Size |
|---|---|---|---|
| `src/visibility.ts:47` `CATALOGS` | the canonical 5, **hand-kept**, and duplicated at `packages/estate-auth/src/visibility.ts:62` | ⚠️ two copies in ONE repo; one must own it | M |
| `src/visibility.ts:57-63` `VisibilityFlags` | **one interface field per catalog** (`vis_library`, `vis_library2`, …) | a `library3` = a migration + 4 code sites (`storedVisibility`, `visibilityToFlags`, the interface, `EstateUserRow`) | L |
| `src/env.ts:4` `CONSUMER_APPS` | `['library','games','index','audiobook','library2']` | registry-fed or explicitly frozen with a documented add-procedure | M |
| `src/env.ts:502-513` `appTokenFor()` | a **`switch` with one `case` per app**, reading `ESTATE_APP_TOKEN_<APP>` by hand | ⚠️ deliberate (the header argues a data-driven var name is a security hazard). Keep the switch; the registry must NOT try to remove it | — |
| `src/env.ts:487` `'https://padhard.heygabi.ai'` in the CORS allowlist | hosts enumerated by hand | a new instance's host must be added, by hand, to CORS — ⚠️ access-increasing, keep manual | S |
| `src/catalog-names.ts:38` `CATALOG_KINDS` | provisioning kinds, not catalogs | fine as-is; do not confuse with the registry | — |
| `src/catalog-names.ts:109-133` `RESERVED_SUBDOMAINS` | a **measurement with a date** of every routed host | ⚠️ **the registry and this list are the same fact twice.** A registry with `host` should feed the reserved check, or the two will disagree the first time a host is added | M |
| `migrations/0018_catalog_requests.sql` | requests, never a registry | **§4** — a registry needs a new table or new columns + a back-seed | L |

### 3.3 · `catalog-platform` — `apps/index-worker`

Mostly done by W4-FED-INDEX. What remains is the shape of adding **catalog N**:

| file:line | Assumption | Size |
|---|---|---|
| `src/rows.ts:33` `SOURCES` | 4 literals; a `library3` is a code edit **and** a migration (see below) | S |
| `migrations/0006_entry_source_library2.sql` | `entry.source` carries a **CHECK constraint** listing sources — a new source without a migration is a bare 500 on every push (`src/push.ts:85-88`) | L |
| `src/env.ts:187-197` `pushTokenFor()` | `switch`, one `case` per source, `INDEX_PUSH_TOKEN_<SOURCE>` | S |
| `src/env.ts:169` `MACHINE_APPS = ['library','library2']` + `readTokenFor():173-181` | `INDEX_READ_TOKEN_<APP>` per instance | S |
| `src/machine-route.ts:118` `MACHINE_VISIBILITY = ['audiobook','library','games']` | ⚠️ **deliberate default-deny** — `library2`/`ebooks` excluded on purpose. A registry must NOT auto-add new catalogs here | — |
| `src/read.ts:69` `UNSCOPED_LOOKUP_EXCLUDED = ['library2']` | ⚠️ **an allowlist inverted** — every future private catalog must be added here BY HAND or `/api/lookup` enumerates it. 🔴 This is the one place the registry should drive a *default-deny* (`shared:false` ⇒ excluded), because the current form fails OPEN for catalog N | M |
| `src/search-route.ts:47-70` `SOURCE_FOR_CATALOG` | the `games↔game` translation + `ebooks → ''` | the registry must carry both vocabularies | S |
| `src/search-route.ts:111` `VALID_SOURCE_PARAMS` | 5 literals | registry | S |
| `src/health.ts:57-59` | answers `{rows, pushed_at}` per source and **nothing else** — no label, no owner, no host *(live-confirmed)* | **this is where `GET /api/catalogs` belongs** (§4) | M |

### 3.4 · `catalog-platform` — `apps/discord-worker` (GABI)

| file:line | What it assumes | What must change | Size |
|---|---|---|---|
| `src/delegated.ts:101-106` `LibraryInstance { app: 'library' \| 'library2' }` | **exactly two libraries, as a closed type union** | registry-driven list; a `library3` is a type change today | M |
| `src/delegated.ts:108-109,125-126` | hosts + labels `'the main library'` / `'your own shelf'` | ⚠️ **`'your own shelf'` is asker-relative and wrong for the owner.** Must become the owner's name from the registry. **F2** | M |
| `src/delegated.ts:482` | hard-codes both URLs in a worded sentence | registry | S |
| `src/suggest.ts:143` `PHYSICAL_SOURCE_INSTANCE = 'library'` | ⚠️ **every print suggestion is gated on the MAIN library**, because `catalog.csv`'s `library_work_id` is a bare integer naming no instance (`:104-135`) | the join must carry an instance, which is a change in `audiobook_catalog` (`LIBRARY_MAPPING_URL`), not here. **This is the deepest single-library assumption in the estate** | L |
| `src/suggest.ts:753-755` | `'the library, as an ebook'` / `'the library, in print'` | never says WHOSE, and calls a shared ebook "the library". **F3** | S |
| `src/suggest.ts:592` | `<https://library.heygabi.ai>` as *"the real shelf"* | registry | S |
| `src/panel.ts:72` `DEFAULT_PANEL_BASE = 'https://padhard.heygabi.ai'` | a relic of the padhard-only pilot; the file's own header records the owner complaining *"why is it showing padhard and not the generic site"* | already partly addressed; verify against the registry | S |
| `src/env.ts:209` | comment: GABI knows `library` and `library2` — "that is measured" | will go stale the moment a third exists | S |

### 3.5 · `catalog-platform` — `packages/estate-auth`, `apps/audiobook-worker`, `apps/ebooks-door`

| file:line | Note | Size |
|---|---|---|
| `packages/estate-auth/src/visibility.ts:62` `CATALOGS` | ✅ **the closest thing to a registry today**, and it IS properly propagated — `sync-estate-auth.mjs` generates `library_catalog/packages/estate-auth/generated/visibility.ts:62` and `Board_Game_Catalog/apps/worker/src/estate-auth/visibility.ts:67`, both carrying `⚠️ GENERATED COPY` banners. All three read `['audiobook','library','games','library2','ebooks']` — **verified in agreement** | — |
| `apps/audiobook-worker/src/` | **no source/label/host map at all** — it serves one catalog and never names another. Nothing to change | — |
| `apps/ebooks-door/src/index.ts:38` `ORIGIN = 'https://audiobooks.heygabi.ai'` | correct by design (a door in front of one deployment) | — |

### 3.6 · `bookbuddy/library_catalog` (both instances)

| file:line | What it assumes | What must change | Size |
|---|---|---|---|
| `apps/worker/wrangler.toml:220-223` / `:474-477` `PEER_SELF_ID`, `PEER_SELF_LABEL`, `PEERS` | 🔴 **A SECOND, INDEPENDENT LIBRARY REGISTRY** on its own id vocabulary (`sky`, `padhard`) and its own labels (`Sky's Library`, `the Padhard Library`), stored as JSON in `[vars]`, per instance, N×(N−1) entries | ⚠️ **one-fact-one-home violated at the registry level.** Either the peer list is fed from `GET /api/catalogs`, or it is documented as deliberately NOT interchangeable. Adding a `library3` today = editing every existing instance's `PEERS` + redeploying each (`scripts/provision-catalog.mjs:561-568` says exactly this) | L |
| `apps/worker/src/lib/peer-push.ts:45-77,150,172-177` | parses `PEERS`; `{peerId, peerLabel, holdings}` | registry-fed | M |
| `apps/worker/src/routes/peer.ts:48-113` + `peer_holding` D1 table (`peer_id`, `peer_label`) | **peer labels are PERSISTED in each instance's D1**, so a label change needs a re-push, not a redeploy | ⚠️ a registry rename does not propagate; say so | M |
| `apps/web/src/components/PeerLibraries.tsx:30-37`, `OnYourShelf.tsx:238-250`, `pages/SeriesDetailPage.tsx:921-931` (`📚 In {ph.peerLabel}`) | render `peerLabel` verbatim | ✅ **generic already** — these scale to `library3` with no code change, IF the peer registry is fed | — |
| `apps/worker/src/lib/index-push.ts:109-152` `resolveIndexSource(env.ESTATE_APP)` | ✅ **already config-driven** (fixed 2026-09-05) — `library` on main, `library2` on friend | — | — |
| `apps/web/src/lib/estate-search.ts:68` `source?: 'audiobook' \| 'library' \| 'game'` | the wrapper's type union **lacks `library2`** | ⚠️ **dead code today** — `components/EstateSearch.tsx:184` sets **no** `source` attribute on purpose ("any preset could only narrow"). So this is cosmetic. ⚠️ It also means `index-worker/src/search-route.ts:104-110`'s comment — *"padhard runs the SAME build … so it sends the same per-site preset"* — describes a preset **nothing sends**. Correct the comment, not the code | S |
| `apps/web/index.html:18` `data-default-theme-by-host='{"padhard.heygabi.ai":"hearts"}'` | per-instance identity keyed by **hostname literal** | a `library3` gets the default theme silently; registry could carry a theme | S |
| `apps/web/src/lib/shelf-view.ts:440` comment *"Peer libraries (e.g. Padhard)"* | — | fine | — |
| `scripts/provision-catalog.mjs:29-30,758-819` | ✅ **already honest** — it PAUSES twice and prints the exact `CONSUMER_APPS` diff, the `vis_<app>` migration, and the `PEERS` follow-up. `:568` `PEERS = "[]"` is deliberate (peer reciprocity is access-increasing) | ⚠️ It does **not** know about: the index `SOURCES` array, the `entry.source` CHECK migration, `INDEX_PUSH_TOKEN_<APP>`, `MACHINE_APPS`, `UNSCOPED_LOOKUP_EXCLUDED`, or any apex label map. **§7 lists what a `library3` is missing today** | L |

### 3.7 · `boardbuddy/Board_Game_Catalog`

| file:line | Note | Size |
|---|---|---|
| `apps/worker/src/lib/estate-app.ts:66,74-77` `ESTATE_APPS = ['games','games2']`, `APP_TOKEN_VAR` | ✅ **identity is CONFIG since 2026-09-05** — the hard-coded `'games'` the request-a-catalog design flagged in red is **fixed**. `[env.games2]` is a commented-out SLOT (`wrangler.toml:279-358`), not live | — |
| `apps/worker/src/estate-auth/visibility.ts:67` | generated copy, in agreement | — |
| `apps/web/public/estate/estate-search.js` | generated artifact, stale on disk only. **§1** | — |
| — | **no library/holder label map anywhere in `apps/web/src` or `apps/worker/src`** (grepped `library.heygabi.ai\|padhard\|library2\|'library'`; only comments and the estate-auth generated copy hit) | — |
| `apps/worker/wrangler.toml:274` comment | records the `sam.` → `padhard.` rename | — |

### 3.8 · `bookbuddy/audiobook_catalog`

| file:line | What it assumes | What must change | Size |
|---|---|---|---|
| `site/estate/estate-search.js` | 🔴 **the fourth, HAND-VENDORED copy** of the shared component — banner says *"no sync-from-sibling build step (unlike library/games), so refresh is manual"*. 1582 lines vs upstream 1605 | **give it a sync script** (§5). Three real divergences, listed in §5 | M |
| `app/index_push.py:54-62,214` | ebooks ride source `audiobook` with `format:'ebook'`; audiobook rows are `format:'audiobook'` | ✅ correct under the ownership model (both are the shared pool) — but nothing downstream knows the pool is *shared* rather than *someone's* | — |
| `app/index_push.py:238-250` | ⚠️ a missing manifest deletes **every ebook row** (snapshot-replace of the whole `audiobook` source) | pre-existing, documented; a registry does not change it | — |
| `app/config.py:43-61` `SIBLING_LINK_FRIEND` | the owner and padhard **share one audio pool** (owner decision 2026-08-25) | ✅ consistent with "digital = shared" | — |
| `.env` `LIBRARY_MAPPING_URL=https://library.heygabi.ai` | 🔴 **the print-holdings join points at exactly one library** — this is the root of GABI's `PHYSICAL_SOURCE_INSTANCE` (§3.4) | multi-library print suggestions need this join to carry an instance | L |
| `app/web/templates/index.html:673-683,2272-2288` | mounts `<estate-search>` from the vendored copy | inherits every F1/F2 defect until re-vendored | — |
| `site/estate-search-mount.js:112` `hit.source !== 'audiobook'` | ebook deep-link detection keys on the source | correct; note it hard-codes the source id | S |

---

## 4 · The registry data that exists today, and what `GET /api/catalogs` needs

**Proposed shape:** `{id, label, owner, holding:'physical'|'digital', shared:boolean, host}`.

| Field | Derivable today? | From where |
|---|---|---|
| `id` | ✅ **yes** | `packages/estate-auth/src/visibility.ts:62` `CATALOGS` (5 ids, canonical order, already synced to both consumer repos). ⚠️ Note the id here is the **visibility** vocabulary (`games`), not the **push** vocabulary (`game`) — `index-worker/src/search-route.ts:47` owns the one translation |
| `host` | 🟡 **partially** | Scattered literals: `auth-worker/src/env.ts:476-487` (CORS list), `catalog-names.ts:109-133` (reserved list), `admin.js:237-239` (`APP_WORKERS.origin`), `status.js:194-206`. **No single home.** `catalog_request.provisioned_host` exists but is empty for all five |
| `label` | ❌ **no** | Seven disagreeing copies (**F2**). Nothing authoritative |
| `owner` | ❌ **no** | 🔴 **The estate has no ownership signal at all.** `request-a-catalog-design.md` says it in one line: *"⚠️ `visibility` is what you may SEE, never what you OWN"*. `catalog_request.requester_display_name` would carry it for FUTURE catalogs only; the five that exist have no row |
| `holding` | ❌ **no** | Inferable by hand today (`game`/`library`/`library2` physical; `audiobook`/`ebooks` digital) but written down nowhere executable |
| `shared` | ❌ **no** | Same. `PUBLIC_CATALOGS = ['audiobook']` (`visibility.ts:71`) is a **different** question (world-readable ≠ estate-shared) and must not be reused for it |

**Verdict: three of six fields must be ADDED, and that is a migration.**

Two options, and they are genuinely different:

- **(a) New table `estate_catalog`** in the auth Worker's D1 — `id, label,
  owner_name, holding, shared, host, kind, created_at` — seeded with the five,
  written by the provisioner on `live`. Clean, but it is a sixth place a
  catalog id lives.
- **(b) Widen `catalog_request`** with `owner_name`/`holding`/`shared` and
  **back-seed five synthetic `status='live'` rows** for the catalogs that
  predate it. ⚠️ This contradicts `0018`'s own load-bearing header (*"A ROW
  HERE IS A REQUEST, NOT A CATALOG"*) and would make `catalog_request` mean two
  things.

**Recommendation: (a).** Then `GET /api/catalogs` on the **index Worker**
(where `/api/health` already answers per-source, and where every surface
already talks) reads it through the same estate-cache the index uses for
`/seen`, and answers `{id, push_source, label, owner, holding, shared, host,
rows, pushed_at}` — one call replacing seven maps and `/api/health`'s
half-answer. ⚠️ **`GET /api/catalogs` must be readable by the ANONYMOUS
internet** (the apex search box needs labels before sign-in), so it may carry
**no per-member state and no private hostnames** — it is a public document.
Whether `library2`'s existence is itself private is an owner question (§8 Q1).

---

## 5 · The four `estate-search.js` copies

| Copy | md5 | Lines | Kept how |
|---|---|---|---|
| `catalog-platform/sites/heygabi-home/public/assets/estate-search.js` | `90840e74ad712263e8ae506407e2a3bf` | 1605 | **SOURCE OF TRUTH** |
| `library_catalog/apps/web/public/estate/estate-search.js` | `90840e74ad712263e8ae506407e2a3bf` | 1605 | ✅ **byte-identical.** `scripts/sync-estate-search.mjs`, run by `pretypecheck`/`pretest`/`prebuild`; gitignored artifact |
| `Board_Game_Catalog/apps/web/public/estate/estate-search.js` | `beec7e19bf73b77950a70d40624b738a` | 1600 | ✅ same mechanism (`scripts/sync-estate-search.mjs`, in `pretypecheck`/`pretest`/`prebuild`/`predeploy`/`predeploy:games2`). **Stale on disk only** — one hunk, the `SOURCE_LABELS` block, plus its own 5-line GENERATED banner. Next build fixes it |
| `audiobook_catalog/site/estate/estate-search.js` | `44571c506fb450eb9df59b70611186f0` | 1582 | 🔴 **HAND-VENDORED 2026-08-17. No sync script.** |

**Every divergence in the audiobook copy** (`diff`, 4 hunks):

1. `+1..6` — its own `⚠️ DO NOT EDIT — VENDORED COPY` banner (expected).
2. `:235` — `SOURCE_LABELS` missing `library2`, and `library` reads `library`
   not an owner name (**F2**).
3. `:351` — missing `a.es-hit-cover { cursor: pointer }` +
   `:focus-visible` outline (apex `:356-357`).
4. `:759-761` — **the cover is not a link.** Apex `:765-784` makes the cover an
   `<a>` routed through `_openHit` (so `estate-search:select` still fires);
   the audiobook copy builds an inert `aria-hidden` `<span>`. A real,
   user-visible behaviour gap.

**The work is not "write a sync script" — it is "write the FOURTH one".** Copy
`audiobook_catalog`'s existing `scripts/sync_estate_theme.py` pattern (it
already syncs `theme.js` from the sibling checkout), or port
`library_catalog/scripts/sync-estate-search.mjs`. ⚠️ That repo's build is
Python + a static `site/`, not npm, so there is **no `pretest` hook to hang it
on** — it needs a place in `scripts/sync_to_server.py` or the pipeline, and
until it has one the copy will go stale again. **Size: M.**

Also synced correctly and worth NOT touching: `sync-estate-auth.mjs`
(`visibility.ts` → both repos, verified in agreement §3.5),
`sync-estate-theme.mjs`, `sync-universes.mjs`, `sync-gabi-conversation.mjs`.

---

## 6 · Where "who owns it / physical vs digital" could be surfaced today, and what it says instead

| Surface | Says today | Should say |
|---|---|---|
| Apex search hit line (`estate-search.js:865`) | `library: hardcover` | `Skylar's library · hardcover` |
| Apex search hit, padhard row | `Samantha's library: hardcover` ✅ (the one correct one) | — |
| Apex search hit, a games row | `board games: boardgame` | `Skylar's games · boardgame` |
| Apex search hit, an ebook row | `audiobooks: ebook` | `shared · ebook` |
| Apex search scope note (`:739,977`) | *"on any shelf"* to a 3-of-5 member | name the shelves searched, or say which were not (**F1**) |
| Apex "Held by" on a series volume (`series.js:390-398`) | `holdingLabel()` — the best surface in the estate; already owner-aware for the two libraries | extend to `game` and the shared pool (**F3**) |
| Apex "Not in …" (`series.js:411-419`) | names only sources appearing elsewhere in that series ✅ deliberate, keep | — |
| Apex universes row subtitle (`universes.js:245-250`) | `Brandon Sanderson · hardcover` for a `library` row; adds `Samantha's library` only for `library2` | every physical row names its holder |
| Apex universes group headings (`:405,408`) | *"Books & audiobooks"* / *"Other games"* | ownership is not a grouping today; owner call (§8 Q3) |
| Apex front-door Books card (`index.html:911-913`) | *"Paper-and-ebook shelves"*, `!Sky`, `Samantha` | **F5** |
| Apex `/status` (`status.js:194-235`) | `Sam's book library API` / `Sam's library` | registry labels (**F2/F4**) |
| Apex `/admin` (`admin.js:198`, `index.html:964`) | `Sam's library` | registry label |
| Library work page "Also available" (`OnYourShelf.tsx:238-250`) | `the Padhard Library` ✅ generic, config-fed | keep; feed from the registry |
| Library series ladder (`SeriesDetailPage.tsx:921-931`) | `📚 In the Padhard Library` ✅ | keep |
| GABI, print suggestion (`suggest.ts:753-755`) | *"the library, in print"* — **whose is never said** | *"Skylar's library, in print"* |
| GABI, ebook suggestion (`suggest.ts:753`) | *"the library, as an ebook"* — attributes a shared work to a library | *"the shared ebook pool"* |
| GABI, choosing an instance (`delegated.ts:126`) | *"your own shelf"* — asker-relative, **wrong for the owner** | the owner's name |
| Games site | **says nothing about any other catalog** (no map found) | inherits the shared component's labels only |
| Audiobook site | inherits the **stale vendored** component (§5) | re-vendor |

---

## 7 · What a `library3` is missing on each surface today

Assume the provisioner runs end to end tomorrow. `library3` would exist as a
Worker, a D1, a bucket and a hostname, and would be **invisible or wrong** at
every point below. ⚠️ Items marked 🔴 are **fail-open or user-visible-wrong**;
the rest are merely absent.

| Layer | What is missing | file:line |
|---|---|---|
| auth Worker | `CONSUMER_APPS` entry, `appTokenFor` case, `ESTATE_APP_TOKEN_LIBRARY3` field, `vis_library3` migration, `VisibilityFlags` field ×3 uses, `EstateUserRow` field | `env.ts:4,502`, `visibility.ts:47,57,72,86` — ✅ **the provisioner already prints this exact diff** (`provision-catalog.mjs:771-803`) |
| auth Worker | CORS origin for the new host | `env.ts:487` — ⚠️ **not in the provisioner's checklist** |
| auth Worker | the new host added to `RESERVED_SUBDOMAINS` | `catalog-names.ts:109` — ⚠️ **not in the checklist**; the file's own header says *"Every new estate hostname must be added here in the same commit that routes it, or the first person to ask for that name gets told it is free"* |
| index Worker | `SOURCES` entry | `rows.ts:33` |
| index Worker | 🔴 **a migration widening `entry.source`'s CHECK constraint** — without it every push is a bare 500, and `wrangler d1 migrations list` correctly reports nothing pending | `migrations/0006…`, `push.ts:85-88` |
| index Worker | `pushTokenFor` case + `INDEX_PUSH_TOKEN_LIBRARY3` | `env.ts:187` |
| index Worker | `MACHINE_APPS` + `readTokenFor` + `INDEX_READ_TOKEN_LIBRARY3` (only if it needs the free-details ladder) | `env.ts:169,173` |
| index Worker | `SOURCE_FOR_CATALOG` + `VALID_SOURCE_PARAMS` | `search-route.ts:47,111` |
| index Worker | 🔴 **`UNSCOPED_LOOKUP_EXCLUDED`** — a new private shelf is enumerable by title through `/api/lookup` and `/api/machine/lookup` **until somebody remembers to add it.** This inverted allowlist fails OPEN | `read.ts:69` |
| apex search | `SOURCE_LABELS`, `SCOPE_LABELS`, `FULL_SCOPE_SIZE` | `estate-search.js:227,234,241` |
| apex series | `SOURCE_LABELS`, `CATALOG_LABELS` | `series.js:72,83` |
| apex universes | `HOLDER_LABELS` | `universes.js:111` |
| apex status | `INDEX_SOURCE_ORDER`, `INDEX_THRESHOLDS`, worker row, site row, deploy row, health fetch | `status.js:133,156,194,205,234,730` |
| apex admin | `CATALOGS`, `CATALOG_LABELS`, `APP_WORKERS`, `SITE_ROWS`, `ROLE_FILTER_KEYS`, a chip in `index.html`, a role `<select>` in `index.html` | `admin.js:182,198,237,262,415`; `admin/index.html:964,1058` |
| apex home | a card link | `index.html:912` |
| GABI | `LibraryInstance` type union, `libraryInstances()`, a URL env var | `delegated.ts:102,123` |
| GABI | 🔴 print suggestions still gate on `library` only | `suggest.ts:143` |
| library repo | a `PEERS` entry **in every existing instance** + a redeploy of each | `wrangler.toml:223,477` — ✅ **the provisioner prints this as a follow-up** (`:817-819`) |
| library repo | a theme in `data-default-theme-by-host` | `apps/web/index.html:18` |
| audiobook site | a re-vendor of `estate-search.js` | §5 |
| every repo | `sync-estate-auth.mjs` re-run in library + games (automatic on their next build) | ✅ no action |

**Count: ~28 hand-edits across 4 repos and 5 deploys, of which the provisioner
today names 3.** That is the number the registry exists to reduce.

---

## 8 · Owner questions this survey cannot answer

Four, and they are **decisions, not builds**. Ask them one at a time.

1. **Is the EXISTENCE of `library2` public?** `GET /api/catalogs` must answer
   anonymous callers (the search box needs labels before sign-in). If it lists
   `library2` with `owner: "Samantha"`, the anonymous internet learns Samantha
   has a shelf here even though `vis_library2` is `DEFAULT 0`. A member-only
   registry is possible but then the sign-in-flash labels come from nowhere.
   **This is access-increasing — confirm before building.**
2. **Should the apex card list be registry-rendered?** It is 5 hand-written
   `<li>`s today. Rendering them from `/api/catalogs` makes a `library3` appear
   on the front door **automatically** — which is either the point of the rule
   or an access-increasing surprise. (§3.1)
3. **Should universes/series GROUP by owner?** Today they group by format
   ("Books & audiobooks" / "Other games"). The rule says designate, not group.
4. **`/api/lookup` unscoped**: `docs/TODO.md:123-124` already carries this
   one — widening it later is one line, but it is the owner's call. The
   registry makes the default-deny form cheap (§3.3, `read.ts:69`).

---

## 9 · What the four `docs/` trees already say (checked for overlap)

Read: all four repos' `README.md`, `TODO.md`, `KNOWN_ISSUES.md`,
`info/README.md`, plus `catalog-platform/docs/access/README.md`.

- **No `KNOWN_ISSUES.md` entry in any repo covers any finding above.** Grepped
  all four for `library2`, `estate-search`, `SOURCE_LABELS`, `FULL_SCOPE`,
  `three shelves`. The only hits are the games repo's cache-header entry
  (`KNOWN_ISSUES.md:154-184`, about `/estate/estate-search.js` `no-cache` —
  unrelated) and the library repo's KI-13 billing entry.
- **Already planned, do not re-plan:** `catalog-platform/docs/TODO.md:13-64`
  (this owner ask), `:66-129` (the federation build, index side ☑ done),
  `:125-129` (`/status` will not show `library2` — **F4 confirms and extends
  it**).
- **The design of record for the provisioner** is
  `docs/info/request-a-catalog-design.md`; its §9 already carries the open
  question *"back-seed the existing owners"*, which §4 above now answers with a
  measurement: **it is required, and it is a migration.**
- `docs/info/index-worker-design.md` **§11** is the as-built for federation day.

---

## 10 · Proposed build split — four Opus dispatches, registry first

Each sized ≤ ~150k. ⚠️ **Order is load-bearing: nothing may consume the
registry before D1 dispatch lands.** Every dispatch commits at clean
boundaries.

### Dispatch 1 — THE REGISTRY (`catalog-platform`, auth + index) · ~120k
**Files:** `apps/auth-worker/migrations/0020_estate_catalog.sql` (new — ⚠️
re-measure the number, `0019` exists), `apps/auth-worker/src/estate-catalog.ts`
(new), `apps/auth-worker/src/index.ts` (mount), `apps/auth-worker/src/env.ts`
(nothing removed — the `appTokenFor` switch stays, §3.2),
`apps/index-worker/src/catalogs-route.ts` (new), `apps/index-worker/src/health.ts`,
`apps/index-worker/src/env.ts` (registry fetch through the existing
estate-cache), tests in both `test/` dirs.
**Deliverable:** `GET https://index.heygabi.ai/api/catalogs` answering the six
fields for all five catalogs, seeded from the owner's table, anonymous-readable
(pending §8 Q1). **Deploy:** auth Worker (migrate first), then index Worker.

### Dispatch 2 — THE APEX (`catalog-platform/sites/heygabi-home`) · ~150k
**Files:** `public/assets/estate-search.js` (**F1**, `FULL_SCOPE_SIZE`,
`SOURCE_LABELS`, `SCOPE_LABELS`, `_sourceLabel`, `_scopePhrase`, `:865`,
`:977`), `public/series/series.js` (`SOURCE_LABELS`, `CATALOG_LABELS`,
`IMPLIED_FORMAT`, `holdingLabel`, **the stale ebook comment F3**),
`public/universes/universes.js` (`HOLDER_LABELS`, `GAME_SOURCES`, `:245-250`),
`public/status/status.js` (`INDEX_SOURCE_ORDER`, `INDEX_THRESHOLDS`, the nine
host rows, the ebooks row), `public/admin/admin.js` (`CATALOGS`,
`CATALOG_LABELS`, `APP_WORKERS`, `SITE_ROWS`, `ROLE_FILTER_KEYS`),
`public/admin/index.html`, `public/index.html` (**F5** `!Sky`, *"three
shelves"*, the Books card `what`), `predeploy.checks.json`, `scripts/test/*`.
⚠️ **Directory-upload deploy — committed-clean tree or a `git worktree add`
checkout** (`docs/info/worktree-deploys.md`). **Review link:**
<https://heygabi.ai/> , <https://heygabi.ai/series> , <https://heygabi.ai/universes> ,
<https://heygabi.ai/status> , <https://heygabi.ai/admin>.

⚠️ **Landing dispatch 2 changes the file the other two repos SYNC**, so their
next build picks the new component up automatically. That is intended — but it
means dispatch 2 must not ship a component that needs a registry the library
and games Workers cannot reach. `/api/catalogs` is on `index.heygabi.ai`,
which both already call, so this holds — **verify it before merging.**

### Dispatch 3 — GABI + the audiobook vendor (`catalog-platform` + `audiobook_catalog`) · ~140k
**Files:** `apps/discord-worker/src/delegated.ts` (`LibraryInstance`,
`libraryInstances()`, `:482`), `src/suggest.ts` (`:592`, `:753-755`; ⚠️
`PHYSICAL_SOURCE_INSTANCE:143` is **out of scope** — it needs the
`audiobook_catalog` join to carry an instance, which is its own piece of work),
`src/env.ts`, `src/panel.ts:72`, tests. Then `audiobook_catalog`: a new
`scripts/sync_estate_search.py` + a call site in `scripts/sync_to_server.py`,
and the first re-vendor (§5's four divergences). **Deploy:** discord Worker;
audiobook site through its own pipeline.

### Dispatch 4 — THE PROVISIONER + peers (`library_catalog`, `Board_Game_Catalog`, `catalog-platform`) · ~130k
**Files:** `library_catalog/scripts/provision-catalog.mjs` (add the 25 missing
checklist items from §7 — chiefly 🔴 the index `entry.source` migration,
`UNSCOPED_LOOKUP_EXCLUDED`, the CORS origin, `RESERVED_SUBDOMAINS`),
`Board_Game_Catalog/scripts/provision-catalog.mjs` (same), the auth Worker's
provisioner write path so a `live` request **inserts an `estate_catalog` row**,
and `library_catalog/apps/worker/src/lib/peer-push.ts` + `wrangler.toml`
`PEERS` fed from `/api/catalogs`. ⚠️ **Library changes are a PAIR:**
`npm run db:migrate` + `db:migrate:friend`, then `npm run deploy` +
`npm run deploy:friend` (`deploy:both` where it exists), both lines in
`deploys.log`.

**Deploy pairs required overall:** auth Worker (migrate then deploy) · index
Worker (migrate then deploy) · apex (directory upload, clean tree) · discord
Worker · **library ×2 (`deploy` + `deploy:friend`)** · games ×1 · audiobook
site pipeline.

---

## 11 · Inconclusive, and said so

- **Whether any of these labels is actually WRONG on screen** — only `!Sky`
  and the card link texts were confirmed live *(live)*. Everything else is the
  code that produces the string, not the string a browser rendered.
- **Whether `library2`'s `SOURCE_LABELS` entry has ever been exercised** — it
  cannot have been: *(live)* `/api/health` shows `library2` at **0 rows**.
- **The `estate-scan.js` "Add to Books" flow** (`:634`) was read but not
  traced end to end; whether padhard's own scanner also posts to
  `library.heygabi.ai` was **not determined**. It is a write door and worth its
  own check.
- **`Board_Game_Catalog`'s `RATE_LIMITER` namespace question** for a second
  instance (raised in `request-a-catalog-design.md` §7.6) was **not measured**
  here.
- **No test suite was run in any repo**, so which of the maps above are pinned
  by tests is known only from grep (`auth-worker/test/library2-vocabulary.test.ts`,
  `index-worker/test/scope.test.ts:265`, `discord-worker/test/panel.test.ts:87,352`,
  `library_catalog/apps/web/test/instance-default-theme.test.ts:216`,
  `apps/web/test/shelf-view.test.ts:926` all touch this vocabulary and will
  need updating).
