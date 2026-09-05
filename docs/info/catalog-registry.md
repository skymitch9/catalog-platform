# The catalog registry — which catalogs exist, and whose they are

> **Audience:** Claude sessions first, the owner second. **Status:** TRACKED.
> **Last verified: 2026-09-05** — the as-built for the code that landed that
> day (commits `40bdd60` auth side, `97ce067` index side), every file:line read
> out of the tree as it was written, plus the live measurements in §8.
>
> ⚠️ **What was NOT verified:** no consumer reads this registry yet. Dispatch 2
> (the apex) is what deletes the seven label maps; until it ships, every surface
> in the estate still renders from its own hard-coded copy and nothing a person
> sees has changed. `/api/catalogs` answering correctly is a fact about the
> route, not about the front door.

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

## 10 · What is NOT done, and what a session should not re-derive

- 🔴 **No consumer reads this yet.** The seven label maps, `FULL_SCOPE_SIZE = 3`,
  `HOLDER_LABELS`, `INDEX_SOURCE_ORDER`, the apex's `!Sky` — all still exactly as
  the survey found them. That is dispatch 2.
- **`READ_ORIGINS` on the index Worker does not include
  `padhard.heygabi.ai` or `ebooks.heygabi.ai`** (measured 2026-09-05 in
  `apps/index-worker/wrangler.toml`). Pre-existing, and it means a browser on
  either of those two hosts cannot read `/api/catalogs` cross-origin. Widening a
  CORS list is access-increasing, so it is the owner's line and not a build's —
  ⚠️ **and dispatch 2 must check it before shipping a component that needs the
  registry on padhard's own site.**
- **`MACHINE_VISIBILITY` was not touched and must not be.** It is a deliberate
  default-deny (`machine-route.ts`); the registry must never auto-admit a new
  catalog there. Pinned in `machine-read.test.ts` and again in
  `catalogs.test.ts`.
- **`RESERVED_SUBDOMAINS` and the registry are still the same fact twice**
  (survey §3.2). The registry now has `host`; nothing feeds the reserved check
  from it yet. Left for dispatch 4, which is the provisioner's.
- **Nobody has provisioned a catalog through the `/live` path in production.**
  The registry write is exercised by tests only; the five rows that exist came
  from the migration's back-seed.
