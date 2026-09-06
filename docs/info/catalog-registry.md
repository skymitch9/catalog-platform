# The catalog registry — which catalogs exist, and whose they are

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED.
> **Last verified: 2026-09-05** — the as-built for the code that landed that
> day (commits `40bdd60` auth side, `97ce067` index side), every file:line read
> out of the tree as it was written, plus the live measurements in §8.
>
> ✅ **UPDATED 2026-09-05, same day: THE APEX NOW READS IT** (dispatch 2, agent
> W6-APEX, deploy `58d8efae`). The header's old warning — *"no consumer reads
> this registry yet … nothing a person sees has changed"* — is superseded and
> §10a is the new consumers table. Every catalog NAME on `heygabi.ai` comes
> from this route.
>
> ✅ **UPDATED 2026-09-06: DISPATCH 3 HAS LANDED TOO** (agent W10-FED-GABI) —
> GABI and the audiobook site's vendored component are both consumers now, §10a.
> The header's *"the other three consumer dispatches … have not run"* below is
> superseded: **dispatch 4 (the provisioner + `PEERS`) is the one that has not.**
>
> ✅ **UPDATED 2026-09-06, later: DISPATCH 4 HAS LANDED — ALL FOUR ARE IN**
> (agent W10-FED-PROV). The line above is now superseded in its turn.
> `library_catalog`'s `PEERS` reads this route for each peer's host and label
> (`bfba496`, deployed to both instances `d950b97d` / `7f782b10`), and — the
> half nothing had yet — **both provisioners now WRITE a row here** when they
> mark a request live, so a provisioned catalog arrives with a name and an owner
> instead of as an id nothing can render. §10a's table gains its first writer
> rows. ⚠️ **`PEERS` still decides MEMBERSHIP by hand**: a directory that
> enrolled catalogs into peer networks would hand another household a read of
> somebody's shelf with nobody deciding it. §10.
>
> ⚠️ **Still NOT verified:** anything a SIGNED-IN person sees.
> `predeploy.checks.json`'s live pass fetches unauthenticated, so the
> scoped-count half of §4 is proven by tests and by this route's own answer, and
> by nobody's eyes. And the other three consumer dispatches (GABI, the audiobook
> vendored component, the provisioner + peers) have not run — §10.

**The one-line version:** the estate now has a table that says *who owns each
catalog*, the auth Worker serves it to the index Worker, and the index Worker
publishes it at <https://index.heygabi.ai/api/catalogs> — names to everybody,
counts only to a member and only in their own scope.

---

## 1 · Why it exists

Owner, verbatim (2026-09-05 15:50 Phoenix), table confirmed 15:58 (*"Yes that
is correct"*):

> *"Make sure everything we have that's in the estate connects to multiple
> libraries and make sure that the libraries are designated by who owns the
> physical or shared with digital works."*

[`multi-library-survey-2026-09-05.md`](multi-library-survey-2026-09-05.md) §4
measured what the estate could answer that day:

| Field | Existed before this build? |
|---|---|
| `id` | ✅ `packages/estate-auth/src/visibility.ts:45` `CATALOGS` |
| `host` | 🟡 four partial copies, no single home |
| `label` | ❌ **seven disagreeing spellings** of two libraries (§2 F2) |
| `owner` | ❌ 🔴 **nothing anywhere.** `visibility` is what you may SEE, never what you OWN |
| `holding` | ❌ inferable by hand, written down nowhere executable |
| `shared` | ❌ same |

Three of six fields had to be **added**, and that is a migration. That is this
build.

---

## 2 · The settled ownership model

| id | push source | kind | label | owner | holding | shared | host |
|---|---|---|---|---|---|---|---|
| `audiobook` | `audiobook` | audio | Shared audiobooks | — | digital | ✅ | audiobooks.heygabi.ai |
| `library` | `library` | books | Skylar's library | Skylar | physical | — | library.heygabi.ai |
| `games` | `game` | games | Skylar's board games | Skylar | physical | — | boardgames.heygabi.ai |
| `library2` | `library2` | books | Samantha's library | Samantha | physical | — | padhard.heygabi.ai |
| `ebooks` | *(none)* | books | Shared ebooks | — | digital | ✅ | ebooks.heygabi.ai |
| `library3…` | the id | books | from the request | the requester | physical | — | from the request |

⚠️ **`owner` is NULL exactly when `shared` is true.** A digital pool has no one
owner; that is the whole distinction the rule draws, and a renderer must print
*"shared"* rather than an empty name.

---

## 3 · Where it lives

```
estate-auth (auth.heygabi.ai)                catalog-index (index.heygabi.ai)
┌────────────────────────────────┐           ┌──────────────────────────────────┐
│ D1 estate_auth                 │           │  GET /api/catalogs               │
│  └ estate_catalog  (0020)      │  app      │   · anonymous → names only       │
│                                │  token    │   · member    → + scoped counts  │
│ GET /api/estate/catalogs ──────┼──────────►│  10-min in-memory cache          │
│  identifyApp() bearer door     │           │  stale-if-error, age reported    │
│  no CORS: no browser calls it  │           │  readCors: apex, library, games, │
└────────────────────────────────┘           │            audiobooks            │
        ▲                                    └──────────────────────────────────┘
        │ writes one row                                    ▲
   POST /api/estate/catalogs/requests/:id/live              │ everybody
   (requireDevops — the provisioner's own call)         every estate surface
```

| Piece | File |
|---|---|
| Schema + the back-seed of the five | `apps/auth-worker/migrations/0020_estate_catalog.sql` |
| Module, the wire shape, the write | `apps/auth-worker/src/estate-catalog.ts` |
| The provisioner's write site | `apps/auth-worker/src/catalog-requests.ts` (`/live`) |
| Mount | `apps/auth-worker/src/index.ts` |
| The public route | `apps/index-worker/src/catalogs-route.ts` |
| Mount | `apps/index-worker/src/index.ts` |
| Tests | `apps/auth-worker/test/estate-catalog.test.ts` (18), `test/catalog-requests.test.ts` (+8), `apps/index-worker/test/catalogs.test.ts` (20) |
| Live probes | `tools/estate-probes/probes/index-worker.mjs` I12–I16, `probes/auth-worker.mjs` A42–A44 |

---

## 4 · 🔴 The access rule

**Owner decision, 2026-09-05 16:14, asked and answered: "yes name only".**

| Caller | Gets |
|---|---|
| **Anonymous** | `{id, push_source, kind, label, owner, holding, shared, host}` for every catalog, and `counts: "none"` |
| **Signed-in member** | the same, plus `rows` and `pushed_at` **only** for the catalogs their own visibility set admits, and `counts: "scoped"` |
| **Revoked member** | every name, **no** counts, and `counts: "scoped"` — not `"none"` |

Three things about that table are load-bearing:

1. ⚠️ **The anonymous branch does not open the database.** The rule is enforced
   by control flow, not by computing counts and stripping them — so an edit
   that reintroduced the query would fail
   `catalogs.test.ts`'s *"the anonymous branch NEVER OPENS THE DATABASE"*, which
   asserts the count query ran **zero** times.
2. ⚠️ **The count keys are ABSENT, not null, when not permitted.**
   `rows: null` reads as *"we looked and found nothing"*, which a renderer
   prints as "0 items". The key being absent is the true statement.
   (`agent-board-contract.md`'s rule: a missing number is not zero — and it is
   not null either.)
3. ⚠️ **Revoked is `scoped` with an empty scope.** *"We did not look"* and
   *"you may see nothing"* are different facts.

**Nothing here widened `vis_library2`.** Samantha's rows are reachable exactly
where they were: search, scoped; `/api/lookup`, fenced (`read.ts`'s
`UNSCOPED_LOOKUP_EXCLUDED` — owner decision 2026-09-05 16:08, *"keep it
fenced"*). Her shelf is now **named** to the signed-out internet and is still
**never counted** to anyone without the grant.

---

## 5 · Two vocabularies, and this is the map between them

| | visibility | push |
|---|---|---|
| Where it lives | `vis_<id>` columns (0002/0007/0008), `/seen`'s array, `estate_catalog.id` | `entry.source`, `rows.ts` `SOURCES`, `estate_catalog.push_source` |
| The five | audiobook · library · **games** · library2 · ebooks | audiobook · library · **game** · library2 · *(ebooks has none)* |

They differ in exactly one place — `games` ↔ `game` — and until this build
`index-worker/src/search-route.ts:46` `SOURCE_FOR_CATALOG` was the only thing
that knew it. The registry now carries both, which is what lets a consumer turn
a search hit's `source` into a label without a second map.

⚠️ **`ebooks.push_source` is NULL and NULL is the answer, not a gap.** Ebook
rows ride `PUT /api/push/audiobook` with `format: 'ebook'` (`audiobook_catalog`'s
own `app/index_push.py:54`: *"'audiobook' the source means the household's
shared pool"*). A reader that "filled this in" with `'ebooks'` would build a
scope that matches nothing while looking exactly like a working one — and
`/api/catalogs` therefore never reports a count for `ebooks` **even to a member
who holds the grant**, because the only number available is the audiobook
source's total and printing it would say the shared ebook shelf holds every
audiobook in the house.

### ⚠️ And a THIRD word that is not either of them: `kind`

`estate_catalog.kind` is the **content** kind (`books` | `games` | `audio`) —
what is on the shelf. `catalog-names.ts` `CATALOG_KINDS` is the **provisioning**
kind (`books` | `games`) — which ten-step runbook and which ledger applies, and
it never names a catalog that exists. The survey's §1 flags confusing the two as
a trap. They overlap by design, which is what makes the `/live` write a straight
copy; `audio` is the value no provisioning path has.

---

## 6 · ⚠️ `/api/health` still reports `library2`'s row count to anybody

Measured, and deliberately **not changed** by this build.
`index-worker/src/health.ts` is open by design, predates the owner's rule, is
read by the estate Health page, and answers `{rows, pushed_at}` for all four
push sources including `library2` — so the two surfaces disagree about how coy
they are, and `/api/catalogs` is the stricter one.

That is recorded here rather than fixed quietly, because narrowing `/api/health`
is a decision about a **different** surface with a **different** consumer, and
"flipped as a side effect of an unrelated deploy" is precisely what the estate's
own rules forbid. **What would change it:** the owner saying a row count is
itself private. The number to know before asking him: `library2` sat at **677
rows** at 16:03 Phoenix on federation day.

---

## 7 · How a `library3` gets a name

`POST /api/estate/catalogs/requests/:id/live` — the call whoever ran the
provisioning makes — now writes the registry row.

| Field | Comes from |
|---|---|
| `id` | ⚠️ **the body's `catalog_id`, and it is never guessed** |
| `label` | the request's `display_name`, as recorded at submit |
| `owner_name` | the request's `requester_display_name`; overridable with `owner_name` |
| `push_source` | defaults to `catalog_id`; overridable, `null` for "pushes nothing" |
| `kind` | the request's `kind` (`books`/`games`), copied |
| `holding` / `shared` | `physical` / `false` — constants, per the owner's model |
| `host` | the `provisioned_host` the same call validated |

⚠️ **Why the id is asked for.** `provisioned_instance` is the wrangler env block
(padhard's is `friend`), not the visibility id; the next name in the visibility
vocabulary is computed by the provisioner in the *other* repo against its own
ledger. Inventing one here would publish a catalog whose `vis_<id>` column can
never exist — a grant that can never be given, on a catalog the front door is
already advertising. **Omitting `catalog_id` writes no row and says so**, and
the call is repeatable.

⚠️ **A registry row is NOT a grant.** It publishes a name and an owner;
`vis_<id>` is still its own migration and its own code change (survey §7, which
the provisioner already prints). Access-increasing steps stayed where they were.

⚠️ **The registry write cannot fail `/live`.** The status change is the answer
to *"did the provisioning land"*; a registry hiccup is housekeeping, reported in
the response's `registry` object, never a reason to re-run a step that already
succeeded. So `{status: "live", registry: {written: false, reason: "failed"}}`
is a real state, and it means *live, but nothing knows its name yet*.

⚠️ **Not at `accept`.** Between accept and live somebody has been told yes and
nothing exists (`catalog-requests.ts`'s own load-bearing rule). A registry row
written at accept time would put a catalog on the estate's front door before the
hostname resolved. *(The dispatch brief said "accept path"; `/live` is the call
the provisioner actually makes, and this is the deviation.)*

---

## 8 · Caching, staleness, and the honest failure

- **TTL 10 minutes**, isolate-local, no KV and no new binding. Same number the
  estate's `/seen` cache uses, so there is one to remember rather than two.
- ⚠️ **A label edited in D1 takes up to ten minutes to appear**, and two
  isolates can disagree in that window. Fine for a name; **never** put a
  permission here.
- 🔴 **There is no hard-coded fallback list of catalogs, deliberately.** "The
  directory is unreachable" and "these are the catalogs" are different facts. A
  fallback would make an outage invisible and could serve a label the owner
  corrected months ago.
- A failed refresh **serves the last good copy** and says `stale: true` — and
  keeps that copy's **own** `fetched_at`. Re-stamping the cache on a failed
  refresh is what makes an unreachable directory look perpetually fresh.
- With **no** cache and **no** directory: a worded 503 and **no `catalogs` key
  at all**. `[]` would say the estate has no catalogs, which is a confident
  false statement of exactly the kind the owner's rule is about.

**Cache-Control**, and the asymmetry is the safe direction: the anonymous answer
is `public, max-age=300`, the member answer is `private, no-store`, both at the
same URL. A shared cache that stored the member copy could hand another caller
counts they hold no grant for; `no-store` makes that impossible. The reverse — a
member served the cached anonymous copy — costs them the counts and leaks
nothing. `Vary: Authorization` states the dependency for any cache that honours
it; `no-store` is the half that does not depend on that.

---

## 9 · Auth: no new secret

The index→auth call presents **`ESTATE_APP_TOKEN_INDEX`**, the bearer this
Worker already holds for `POST /api/estate/seen`, verified by the same
`identifyApp()` the `/seen` and billing-system doors use. Nothing was minted and
no pair was rotated.

The auth-side route has **no CORS mount**, deliberately: nothing in a browser
calls it, and a mount there would create a second browser-reachable copy of one
fact. Pinned by probe `A44`.

---

## 10a · Who reads it — the consumers, as built

| Consumer | Reads it for | Landed |
|---|---|---|
| `sites/heygabi-home/public/assets/catalog-registry.js` | **the apex's one client** — fetch, validate, memo, and the words (`labelForEntry`, `designation`, `scopeIsEverything`, `catalogForEntry`) | `b30e233` |
| `public/assets/apex-catalog-cards.js` | the front door's cards: link text, the `.holds` designation line, scoped counts, and a cell for a catalog the page has never heard of | `dfdb174` |
| `public/assets/estate-search.js` | ⚠️ **an INLINE twin of the client, deliberately** — see below. Hit labels, the scope note, and the "on any shelf" claim | `caef55a` |
| `public/series/series.js` | `sourceLabel`/`catalogLabel`/`holdingLabel` (the estate's one holding renderer) and `bookish()` | `dee846a` |
| `public/universes/universes.js` | the row subtitle's holder, and `isGameRow()`'s kind | `dee846a` |
| `public/status/status.js` | the index source ORDER and denominator, every catalog's row name | `dee846a` |
| `public/admin/admin.js` | ⚠️ **NAMES ONLY** — see below | `94d3e65` |
| `apps/discord-worker/src/catalog-registry.ts` | **GABI's one reader** — the shelves she offers (`resolveLibraryInstances`, registry rows that are `kind:books` + `holding:physical`) and the words she calls them, incl. the three suggestion shelves. Posture `GABI_CATALOG_REGISTRY`; `panel.ts`'s pre-existing lane now shares this fetch and this memo | `893ca5f` |
| `audiobook_catalog/site/estate/estate-search.js` | ⚠️ **the fourth copy of `estate-search.js`, and it reads the registry now** — re-vendored 2026-09-06 by that repo's new `scripts/sync_estate_search.py`. It inherits the inline twin below rather than reading it itself | `2b4ba2f` *(audiobook_catalog)* |
| `library_catalog/apps/worker/src/lib/peer-push.ts` | **each peer's `host` and `label`** — `resolvePeers()`, with `wrangler.toml`'s `PEERS` as the fallback. 🔴 **NAMES ONLY, never MEMBERSHIP** — see §10a's peer note below | `bfba496` *(library_catalog)* |

**And the first WRITERS, 2026-09-06** — until dispatch 4 the only rows here came
from 0020's back-seed:

| Writer | Writes | Landed |
|---|---|---|
| `apps/auth-worker/src/catalog-requests.ts` `/live` | the canonical write (`insertCatalog`), for a devops session with a browser | `40bdd60` |
| `library_catalog/scripts/provision-catalog.mjs` step 12 | the same row by `d1 execute`, because the provisioner runs on a **wrangler** login and `/live` is `requireDevops()` (a Firebase ID token) | `f472578` *(library_catalog)* |
| `Board_Game_Catalog/scripts/provision-catalog.mjs` step 12 | the same, with `push_source` ≠ `id` (`games` ↔ `game`) | `7a1ca7c` *(Board_Game_Catalog)* |

⚠️ **The route and the two scripts are near-duplicates ON PURPOSE and are NOT
interchangeable** — one is for a browser session, one for the machine that
actually created the catalog. Change one and the others must change too; both
sides carry that sentence in their own headers. All three write
`ON CONFLICT(id) DO NOTHING`, so a repeated provisioning run cannot rename a
catalog somebody is already using.

⚠️ **`estate-search.js` carries its own inline copy of the fetch and the label
helpers and MUST keep it.** `sync-estate-search.mjs` (in both consumer repos)
copies that ONE file into `library_catalog/apps/web/public/estate/` and
`Board_Game_Catalog/apps/web/public/estate/`; a sibling import would 404 on both
and take their search box with it. They are near-duplicates that exist on
purpose and are **NOT interchangeable**;
`scripts/test/estate-search-registry.test.mjs` pins the four facts both must
agree on (the route, the unknown wording, the ebook rule, the implied-format
rule), so changing one and forgetting the other fails `npm test`.

⚠️ **`/admin` takes NAMES from here and NOTHING ELSE.** Its `CATALOGS` array —
which decides *which permission controls render* — stays hand-kept. This
registry is a name service with a ten-minute cache and two isolates free to
disagree inside it (§8, which says it outright: fine for a name, never for a
permission). Driving a grant surface from it would let a stale or unreachable
directory silently remove an admin's ability to grant or revoke a catalog: an
access surface failing closed on a cache miss.

🔴 **And no consumer has a hard-coded fallback list**, which is §8's rule kept on
the client side. Each surface degrades to a WORDED unknown per shelf plus one
sentence naming the failure as an **outage rather than a permissions problem**,
with no status code in front of a person — and never to a guess at what the
estate holds.

## 10 · What is NOT done, and what a session should not re-derive

- ✅ ~~**No consumer reads this yet.**~~ **The apex does, since 2026-09-05** —
  §10a. ✅ ~~*"What is still untouched … GABI's `delegated.ts`/`suggest.ts`, the
  audiobook site's hand-vendored copy of `estate-search.js`"*~~ — **both landed
  2026-09-06 (dispatch 3, agent W10-FED-GABI).** GABI: `893ca5f`, deployment
  `ae966987-9030-4e4f-a5ae-734ba6fc7c13`; the audiobook vendor: `2b4ba2f` in
  that repo, on the **/dev/** lane only (see below). ✅ ~~**Still untouched:**
  `library_catalog`'s `PEERS`~~ — **landed 2026-09-06 (dispatch 4, agent
  W10-FED-PROV)**, `bfba496`, deployed to both instances (`d950b97d` /
  `7f782b10`). ⚠️ It took the NAMES and left the MEMBERSHIP, on purpose — the
  last bullet of this section says why.
- ⚠️ **THE AUDIOBOOK SITE'S COPY IS ON `/dev/` AND NOT ON PROD.** That repo's
  two-lane deploy moves prod only through `gh workflow run promote.yml`, which
  is the owner's explicit request, and `auto-promote.yml` carries **book-only**
  commits — which this is not. So `audiobooks.heygabi.ai` still serves the
  hand-vendored component with the four measured divergences until somebody
  promotes. That is a decision, not a gap.
- ⚠️ **GABI's shelf list is registry-driven; her PRINT GATE is not.**
  `suggest.ts`'s `PHYSICAL_SOURCE_INSTANCE = 'library'` was deliberately left
  alone (survey §3.4 calls it the estate's deepest single-library assumption).
  Which library a print suggestion is gated on needs `audiobook_catalog`'s
  `LIBRARY_MAPPING_URL` join to carry an instance — another repo's work. This
  build only NAMES that shelf correctly.
- ✅ **`READ_ORIGINS` NOW INCLUDES `padhard.heygabi.ai` — the owner said "Yes"
  on 2026-09-06** (00:5x Phoenix, item 3 of the sixteen), and it is deployed:
  `4ef4816`, deployment `a2ed0d67-2d8e-4391-854f-3895ae5bee02`, rollback
  `04bef4e8-9842-4a11-a9ff-7bbd9aa52119`. **Measured live 14:33Z** with
  `curl -s -D -`: `/api/catalogs` and `/api/search?q=test` both answer
  `access-control-allow-origin: https://padhard.heygabi.ai`; before the deploy
  the same request got 200 with no ACAO at all. ⚠️ **It widens which PAGES may
  ask, never what is RETURNED** — visibility is still decided per-caller inside
  the Worker, and Samantha's own rows still need `vis_library2`.
  🔴 **`ebooks.heygabi.ai` is STILL ABSENT and is the same question**: nothing
  on that host calls the index today and the owner was asked about padhard only,
  so it needs its own "Yes". Verified live the same minute that
  `https://ebooks.heygabi.ai` still gets no ACAO header. The exact set is pinned
  by `apps/index-worker/test/read-origins.test.ts`, which PARSES `wrangler.toml`
  so a hard-coded copy cannot drift from the deployed value.
  ⚠️ **The stale half nobody has fixed yet:**
  `sites/heygabi-home/public/assets/estate-search.js` still carries a comment
  saying this call *"is refused by CORS today"* on padhard. It is now wrong, and
  it lives in a **canonical asset with copies in `library_catalog` and
  `Board_Game_Catalog`** — so correcting it is a synced-asset change across
  three repos, not a one-line edit here.

  The original finding, kept because it is what the decision was made from:
  the list was heygabi.ai, library, boardgames, audiobooks (measured 2026-09-05
  in `apps/index-worker/wrangler.toml`), so a browser on either of those two
  hosts could not read `/api/catalogs` cross-origin. Widening a CORS list is
  access-increasing, so it was the owner's line and not a build's.
  ✅ **CHECKED BY DISPATCH 2, and it changed nothing there.** Padhard runs the
  same build as the library's site, so it mounts `<estate-search>` — and that
  component ⚠️ **already could not read `/api/search` on that host either**, by
  the same list. So the registry made nothing worse: the component degrades on
  padhard in WORDS (a worded unknown per shelf, plus one caveat line naming the
  outage) rather than showing database ids or claiming a partial scope was every
  shelf. ✅ **The question — whether Samantha's own site should be able to
  search the estate index at all — was ANSWERED "Yes" on 2026-09-06** and the
  ❓ item in [`../TODO.md`](../TODO.md) is closed. ⚠️ **The degradation code is
  deliberately unchanged**: it is what the component does whenever a registry
  read fails for any reason, and that path still has to exist.
- **`MACHINE_VISIBILITY` was not touched and must not be.** It is a deliberate
  default-deny (`machine-route.ts`); the registry must never auto-admit a new
  catalog there. Pinned in `machine-read.test.ts` and again in
  `catalogs.test.ts`.
- **`RESERVED_SUBDOMAINS` and the registry are still the same fact twice**
  (survey §3.2), and dispatch 4 **deliberately did not join them.** The registry
  now has `host`; nothing feeds the reserved check from it, and nothing should:
  🔴 **the two lists answer opposite questions.** The registry says *"these
  catalogs exist"*; `RESERVED_SUBDOMAINS` says *"nobody may ask for these
  names"* — and the second is strictly larger, holding retired names (`sam`),
  decided-against names (`books`, `search`, `shelf`) and hosts nothing routes.
  Deriving it from the registry would QUIETLY FREE every name in that
  difference, which is an access-increasing change with no owner behind it, and
  it fails in the direction where somebody is told a name is available and given
  it. What dispatch 4 did instead: **both provisioners now PRINT the exact
  `RESERVED_SUBDOMAINS` line to add** (the games one prints both hostnames), in
  the same commit that routes the host, which is what that file's own header
  asks for. The duplication stays; the forgetting is what was fixed.
- ✅ ~~**Nobody has provisioned a catalog through the `/live` path in
  production.**~~ Still true of the ROUTE, and now for a sharper reason:
  🔴 **the provisioners never call `/live` at all.** It is `requireDevops()`,
  which needs a Firebase ID token from an admin account, and both provisioners
  run on the owner's **wrangler** login with no browser in the loop. They mark
  the request live by a direct `d1 execute` against the directory — as they
  always did — and since 2026-09-06 they write the registry row the same way
  (§10a's writer table). So `/live` remains exercised by tests only, and the
  five rows that exist still came from 0020's back-seed. ⚠️ **Nothing has been
  provisioned by either script either**, so the new write is also unexercised in
  production; the first real run is the test.
- ⚠️ **`PEERS` is NOT fed from this registry, and that half is deliberate.**
  Dispatch 4 took the names and left the membership. A peer entry lets another
  household read this catalog's holdings and this one read theirs —
  access-increasing in both directions — so a catalog appearing in a directory
  must never enrol itself into a peer network. Adding a `library3` is still a
  line in every existing instance's `PEERS` plus a redeploy of each, which is
  what the provisioner prints. The reasoning, the match order and the failure
  wording live in `library_catalog/docs/info/peer-network.md`.
