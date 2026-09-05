# TODO — catalog-platform (ACTIVE work log)

> **Cleaned 2026-08-31.** The layered 2026-08-24 conductor/morning-summary
> handoff blocks that sat above this file's real items were actioned and moved
> WHOLE to [`DONE.md`](DONE.md) (entry *"2026-08-31 — the 2026-08-24
> conductor/morning-summary handoff blocks"*), each open claim re-verified
> first: F4's CSP fix was deployed 2026-08-24 (`deploys.log` `510adab`), GABI
> T2 was merged, deployed AND flipped ON the same day (`e73e7ec`), PEER_TOKEN
> was rotated by the owner, and the deploy pass is superseded by the later
> per-repo deploys. The still-open remnants were extracted into the items
> below.

## ☐ 🔴 OWNER ASK 2026-09-05 15:50 Phoenix — "everything in the estate connects to MULTIPLE libraries; libraries designated by who OWNS the physical, or SHARED for digital works" — ☑ table CONFIRMED by the owner 15:58

> **Owner, verbatim:** *"Make sure everything we have that's in the estate
> connects to multiple libraries and make sure that the libraries are
> designated by who owns the physical or shared with digital works."*
> Asked whether the table below was right; **owner 15:58: "Yes that is
> correct."** The table is now the settled ownership model.

**What it means, as read by the conductor (confirmed):**
every estate surface stops assuming ONE library, and every row/holding is
labelled by its **ownership model**, which has two kinds:

| Source | Kind | Designation |
|---|---|---|
| `library` (library.heygabi.ai) | physical copies | **Skylar's** |
| `library2` (padhard.heygabi.ai) | physical copies | **Samantha's** |
| `game` (boardgames.heygabi.ai) | physical copies | **Skylar's** |
| `audiobook` (audiobooks.heygabi.ai) | digital | **shared** (estate pool) |
| `ebooks` (ebooks.heygabi.ai) | digital | **shared** (estate pool) |
| `library3…` (provisioner) | physical | the requester's name, from the catalog request |

**Measured 2026-09-05 15:50 — the labels are hard-coded in FIVE copies and
already disagree** (one-fact-one-home violated on a SURFACE):
`sites/heygabi-home/public/assets/estate-search.js:234`, `series/series.js:72`,
`universes/universes.js:111` (`HOLDER_LABELS`, only `library2`), the library
repo's `apps/web/public/estate/estate-search.js:234` (a copy), and the games
repo's copy at `apps/web/public/estate/estate-search.js:234` which **lacks
`library2` altogether** (`{ game, library, audiobook }`). The auth Worker's
`catalog-names.ts` knows `CATALOG_KINDS = ['books','games']` and hostnames but
no owner/holding model; the index Worker's `Source` set is being widened to
`library2` by W4-FED-INDEX right now.

**Proposed shape (design, not yet built):** ONE registry — the index Worker
serves `GET /api/catalogs` (`{id, label, owner, holding:'physical'|'digital',
shared:boolean, host}`) fed from the auth Worker's catalog table (the
provisioner already writes new libraries there); every surface (apex search /
series / universes / status, GABI's book knowledge, the library+games copies of
`estate-search.js`, the audiobook site's estate strip) reads it and the
hard-coded maps go. `holdingLabel()` becomes "Samantha's (hardcover)" /
"shared · audiobook". The `estate-search.js` copies become ONE shared
component synced by script (owner rule 2026-09-03: shared global components).

**Sequence:** ① W4-FED-INDEX + W4-FED-LIB land (padhard rows exist) → ② one
read-only SURVEY agent (Opus, ~180k) inventories every single-library
assumption across the four repos → ③ registry + consumer builds, per repo,
Opus → ④ eyeball. ☐ ① W4-FED-LIB landed 15:54 (library side deployed both
instances; index side still building) · ☐ ② SURVEY dispatched 16:00 as
W4-MULTILIB-SURVEY (read-only; runs beside ①, does not wait on it) · ☐ ③ · ☐ ④.

☑ ❓ **Owner confirm (asked 15:54 Phoenix):** is the ownership table above
right — in particular `game` = Skylar's physical, and BOTH audiobooks and
ebooks = shared digital? — **☑ 15:58 "Yes that is correct."**

## ☐ 🔴 OWNER ASK 2026-09-05 15:27 Phoenix — "in the universe and series tab it's not pulling Padhard library" — ☑ GO ("A build now", 15:37) — W4-FED-INDEX + W4-FED-LIB in flight

> **Owner, verbatim:** *"let's put this on hold for now, in the universe and
> series tab it's not pulling Padhard library"* — "this" = the estate-auth
> deploy (manifest section below), now ON HOLD at his word. ⚠️ Superseded
> 15:45: the deploy landed and the manifest section moved to `DONE.md`.

**Diagnosis, measured 2026-09-05 15:28 Phoenix (code read, not a live probe):**
both tabs read the index Worker (`sites/heygabi-home/public/universes/universes.js:472`,
`series/series.js:574`), and **padhard has never pushed one row into the index**:

| Layer | Fact | Where |
|---|---|---|
| index Worker push door | knows sources `game`/`library`/`audiobook` only — `library2` is 404 `unknown_source` | `apps/index-worker/src/push.ts:32`, `pushTokenFor` `env.ts:167` |
| index Worker scope | `library2` IS a scope value (`search-route.ts:54`) and the tests pin *"no federated rows … matches nothing"* | `test/scope.test.ts:265` |
| library Worker | pushes to a hard-coded `/api/push/library` — would label her rows `library` | `apps/worker/src/lib/index-push.ts:109` |
| `[env.friend]` | `INDEX_URL` is top-level only (the Wrangler nag in `second-instance.md:376`); `INDEX_PUSH_TOKEN` **deliberately unset** — *"federation is phase 2"* | `second-instance.md:202`, `push-secrets.mjs:640` |
| apex | `series.js:73` already labels `library2: "Samantha's library"`; `universes.js:358` filters `source === 'library' \|\| 'audiobook'` — `library2` would be dropped even once rows exist | |

This is the library repo's **⏸ DEFERRED BY OWNER 2026-08-16 — second
household federation** item (`library_catalog/docs/TODO.md:1961`), surfacing as
a bug. ⚠️ It is **access-increasing** (a new write credential into the shared
index; her rows become visible to whoever holds `vis_library2` — owner only,
`DEFAULT 0`), so it is a ❓ decision, not a silent build.

**The build if he says go (two Opus dispatches, ~150k each, index side first):**
1. index Worker: `library2` as a push source + `INDEX_PUSH_TOKEN_LIBRARY2` +
   universes/series carry it; tests; deploy.
2. library Worker: push source from `ESTATE_APP`, `INDEX_URL` on
   `[env.friend.vars]`; deploy PAIR; apex `universes.js` source filter.
3. Mint the pair via `op-rotate-pair.mjs` (needs a no-write probe — the
   push door's 401-vs-400 answers that); first push via `POST /api/admin/index-push`
   on padhard; verify `library2` rows in `/api/health`, then the two tabs.

☐ Owner go/no-go (asked 15:3x Phoenix, notification pushed).

☑ **index side BUILT 2026-09-05 — `a62d7d6` (code + tests + apex) and `25e7a12`
(migration 0006 + the bare-500 guard)**, agent W4-FED-INDEX. As-built is
[`info/index-worker-design.md`](info/index-worker-design.md) **§11**; the deploy
and what was verified live are in [`deploys.log`](deploys.log). Step 1 of the
three-step plan above is done. ⚠️ **Nothing is visible yet** — step 2 (the
library Worker's `ESTATE_APP` push source) is a sibling agent's, and step 3's
`INDEX_PUSH_TOKEN_LIBRARY2` is the owner's to set on both holders.

Three things the build found that the plan above did not anticipate, each
written up in §11:

- 🔴 **A migration WAS required**, though `wrangler d1 migrations list --remote`
  correctly said nothing was pending: `entry.source` carries a CHECK constraint
  listing the three original sources (verified on the live remote schema), so a
  Worker deployed ahead of it would have answered every `library2` push a bare
  500. `0006_entry_source_library2.sql` widens it; drilled locally first, all
  three sources' rows intact through the table rebuild.
- 🔴 **Federation would have opened a hole in `/api/lookup`**, which is
  membership-gated but deliberately UNSCOPED — every approved member, and every
  machine token via `/api/machine/lookup`, could have enumerated Samantha's
  shelf by title while holding no `library2` grant. Closed fail-shut in the same
  commit (`read.ts`'s `UNSCOPED_LOOKUP_EXCLUDED`). ❓ **Worth an owner line:
  widening it later is one line, but it is his call, not a build's.**
- ⚠️ **`/status` will not show her source once she pushes.** That page keeps its
  own `INDEX_SOURCE_ORDER` and ignores unknown keys, so nothing breaks — but
  adding `library2` there needs an `INDEX_THRESHOLDS` cadence nobody has
  measured, and the row would sit amber/red until her first push. Left as its
  own decision.

## ☐ 🔴 OWNER ASK 2026-09-05 12:58 Phoenix — "build it all … check first then build. Also make sure all docs aren't stale" (ALL FOUR REPOS)

Owner, verbatim, after a build-queue summary that listed four items as unbuilt:
*"Yes build it all, I thought we had some of this built so check first then
build. Also make sure all docs aren't stale."* He was right: the games `/scan`
target, shelf round 3, the edition note and the `count_phrase` allowlist were
ALL built and deployed on 09-03/09-04 — their `☐` headings were stale while
their bodies said BUILT. The conductor had listed them from headings, the
anti-pattern the global docs rule names.

**Wave 1 (dispatched ~13:10, Opus):** one DOCS AUDIT agent per repo
(`catalog-platform`, `library_catalog`, `Board_Game_Catalog`,
`audiobook_catalog`) — every open heading verified against code and the live
site, finished items moved WHOLE to `DONE.md`, headings corrected to the
body's truth, `Last verified` re-measured where re-verified (never re-dated
otherwise), README indexes checked against the folders; each reports the
GENUINELY unbuilt owner asks with size estimates. Plus one BUILD agent for the
three "Request a catalog" residues (the three bare-status 401s, the two
reserved names, design §7.6's manual step).
**Wave 2:** build what the audits name as genuinely unbuilt.
Status of the wave is recorded under each repo's own TODO by its agent.

**Wave 1 · `catalog-platform` audit — RAN 2026-09-05 ~13:15–14:0x Phoenix (agent
AUD-platform).** Every `##` section verified against code, `deploys.log`, the
live edge (`curl -s -D -`) and a read-only remote `estate_auth` query. Headings
corrected to their bodies' truth; one finished item moved WHOLE to
[`DONE.md`](DONE.md); index and link repairs made in `access/README.md`,
`info/README.md`, `README.md` and `KNOWN_ISSUES.md`. **Four STALE-WRONG claims
were corrected in place, each marked `⚠️ Corrected 2026-09-05`** — the largest
being that `billing_policy` was called EMPTY and the Spending panel "never
rendered signed in" when the owner had in fact written a rule through it on
2026-09-02 (see the LLM-billing item). ⚠️ **Not audited by this agent, by
design:** the *"Three more BARE-STATUS 401s"* section, `catalog-names.ts` and
design §7.6 (agent RES held them), and the *"Request a catalog"* block's
structure (waiting on a human browser test — its wrong claims were corrected,
its shape left alone).

**Owner, 13:11 Phoenix, three more messages (verbatim), which set the END
CONDITION of the whole run:**
1. *"Build it all and keep it going. If something needs me notify me while
   building other things that don't need [me]. I want an empty todo list of
   all not deferred items unless I said otherwise."* → the target state is a
   `TODO.md` in every repo holding ONLY (i) items HE deferred in his own words,
   (ii) items waiting on his decision, (iii) items built and waiting on a human
   eyeball. Everything else gets built. Audits therefore classify DEFERRED
   (his words only — a conductor's "wave N" is not a deferral) separately from
   UNBUILT.
2. *"After all the builds present me all deferred things and we can decide to
   build or can[cel]."* → the closing step: the (i) list, one item at a time.
3. *"Also I recently got some new books, did the pipeline ran when they were
   detected or at the cron time"* → answered in-session from the pipeline's
   own state and task definition (see the reply of 13:1x); not a build item.

## ☐ 🔴 BUILD — "Request a catalog" (the "+" on the heygabi.ai cards) (owner ask 2026-09-05 06:26 Phoenix)

Owner, verbatim: *"Remember that doc about requesting a board game or book site?
Time to build that."* — supersedes the 2026-08-24 constraint "ships only after
dev lanes + more testing".

**Finding: the design had NO repo home.** It existed only as (a) the private
artifact **"Request a Catalog"** — https://claude.ai/code/artifact/717169ac-af10-4b3a-9598-cf1f2ae38f11
(cyberpunk 6-step mockup, 2026-08-24, updated the same night with the sealed reader
key + owner-editable accept), and (b) two Opus research drafts written to a
scratchpad that no longer exists — recovered 2026-09-05 from the session-5154218d
transcript (agents `a33af8314947561ad` phase-1 flow/data model, `aefc2df1cbb203f17`
phase-2 provisioning + sealed-key). Both texts are now to be filed under
[`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) BEFORE code.

Owner decisions already given 2026-08-24 23:48Z: owner can **edit address/name
before approving**; the request form carries an **optional LLM key** field; the
key must be **sealed** so the owner cannot see it and it cannot leak; the owner
may also set a key at accept. Design answers on record: request row in the
auth-worker estate D1 (`catalog_requests`, statuses pending/accepted/declined/live/
cancelled); "+" shown only signed-in + owning zero catalogs; required confirm
step; Members-page banner + "Catalog requests" section (two-tap accept/decline);
**Accept never deploys** — it hands the owner a pre-filled provisioning runbook;
sealed-box key (WebCrypto → private R2 envelope → decrypted only inside the
owner-run provisioner → `wrangler secret put`), D1 holds booleans only.

Owner answers (asked ONE AT A TIME): (1) Games card too? — **"Both"** (2026-09-05
~06:50 Phoenix): the Games card gets the same "+" and flow. (2) Who may request? —
**"only approved people"** (2026-09-05 ~06:58 Phoenix): estate `status='approved'`
gate on the "+" AND server-side on submit. (3) Sealed key — **"Have it fall back to my
Claude key for now. Defer it until everything else is built then build it. I want
this all done today so the defer is until after the other bits build but not
forever"** (2026-09-05 ~07:03 Phoenix): v1 provisions with the OWNER's
`ANTHROPIC_API_KEY` (an explicit owner decision — it supersedes the drafts' "never
silently reuse the owner's key"); the sealed requester key is the LAST phase of
today's build, not dropped. (4) Back-seed — **"Yes back seed"** (2026-09-05 ~07:25
Phoenix): `library`, `padhard`, `boardgames` inserted as `live` rows by hand once
0018 is applied remotely (design §9 row 4 has the exact row shape). All four
questions answered; nothing open.

Plan: design doc → Opus build of the estate side (migration + API + `/admin`
section + home-card "+") → provisioning runbook/script → dev-lane test → live.
**Execution 2026-09-05 07:06 Phoenix:** five Opus agents dispatched in parallel —
A auth-worker (phases 1+2), B home "+" (3a+3b), C `/admin` (4), D books
provisioner (7, `library_catalog`), E games prerequisites (8, `Board_Game_Catalog`).
Then by hand: phase 6 back-seed; then phase 9 games path; then phase 5 sealed key LAST.
**Wave 2, 2026-09-05 ~07:55 Phoenix — three Opus agents in parallel:** S1 sealed key
SERVER half (auth-worker: `sealed_key` on submit/accept, private R2 `estate-catalog-keys`,
booleans, deploy), S2 sealed key CLIENT + PROVISIONER half (keypair mint, `catalog-seal.js`,
form + Accept-panel fields, `scripts/lib/catalog-seal.mjs`, books provisioner decrypt step),
G phase 9 games provisioner in `Board_Game_Catalog` (+ `BILLING_SITE` lift). ⚠️ Deviation
from "sealed key LAST", named on purpose: phase 9 is the only "other bit" left and the two
touch different files, so they run side by side rather than the key waiting idle; the
provisioner's decrypt step still lands after the games script exists. Conductor does the
ONE `deploy:home` at the end (plus the `admin.js` games next-step wording).

### ✅ Phase 6 — back-seed DONE by hand (main loop, 2026-09-05 07:31 Phoenix)

Three `live` rows in remote `estate_auth.catalog_request` — #1 `library` (books,
owner), #2 `padhard` (books, Samantha Hardman, instance `friend`), #3
`boardgames` (games, owner) — full shape in design §10 row 6. Read back: 3 rows.
✅ **RE-MEASURED 2026-09-05 ~13:20 Phoenix (docs audit)**, read-only against the
live remote D1: `catalog_request` still holds **3 rows, all three `live`**, and
no fourth row has appeared — which also confirms the standing "no signed-in
request has ever been filed" claim below is still true as of this reading.
⚠️ **The owner's primary account now sees NO "+" on either card** (he owns both
kinds). **To test the "+" he signs in as his second approved account** (`estate_user`
#87 `mitchlandtv@gmail.com`), which owns nothing and should see both.
NOT verified: the hide/show in a browser, signed in as each.

### ✅ Phase 7 — books provisioner BUILT, `--dry` only (agent D, 2026-09-05 ~07:35 Phoenix)

`library_catalog` `b84b39f` `scripts/provision-catalog.mjs` (12 idempotent steps, two
PAUSEs for the manual Firebase / auth-worker steps, 68 tests, 2418/0 suite) ·
`bce085e` runbook `docs/access/provision-catalog.md` · `4e0acc8` · here `51e0544`.
`--dry` exercised against the three REAL back-seeded rows (each refused correctly:
already live / already live / games → §8). **No real instance exists; nothing ran
past `--dry`** — the first real run is the owner's.

(The instance-naming decision — **(a), the split as built** — was taken
2026-09-05 08:35 and moved whole to [`DONE.md`](DONE.md); the rule lives in
design §7.1.)

### ✅ Phase 8 — games platform prerequisites LANDED + DEPLOYED (agent E, 2026-09-05 ~07:40 Phoenix)

`Board_Game_Catalog` `fc17ea3` `ESTATE_APP` wrangler var (default `games`) ·
`30dc045` same-id build guard `scripts/instance-guard.mjs` (tests seen to refuse) ·
`4db2f2e` `--env` twins `deploy:games2` / `db:migrate:games2` / `secrets:push:games2`
with the `PER_INSTANCE_SECRETS` refusal · `5ff223a` commented `[env.<instance>]`
template + drift guard, `docs/access/second-instance.md`, `docs/info/instance-model.md`
· `9c1dba6` corrects E's own stale "7403 migrations apply" claim · `a812252` deploy
line. Worker deployed `a349aee1-6437-44b2-9be4-a3185e09ba64`, health 200
`"estate":{"mode":"enforce","app":"games"}`. Here: `d94f2f2` design §10 row 8.
**Measured (Cloudflare docs, 2026-09-05): `RATE_LIMITER` namespaces are per-ACCOUNT**,
so a second instance takes `namespace_id "1002"` and main's `"1001"` never changes.
Open, for phase 9: `BILLING_SITE` is still the constant `'games'`; there is no
donor/peers mechanism for games (books has `[env.friend]` as the drift donor).
NOT verified: a signed-in tail line showing `app=games` — the owner signs in once at
<https://boardgames.heygabi.ai> and checks it.

### ✅ Phase 9 — games provisioner BUILT, `--dry` only (agent G, 2026-09-05)

`Board_Game_Catalog` `7b6b049` **`BILLING_SITE` lifted** — phase 8's open item
closed. The constant became `billingSite(env)`, resolved from `ESTATE_APP`
through the same `resolveEstateApp()` the gate uses, because the site id and the
app id are ONE identity: this repo's `siteForApp()` (`apps/auth-worker/src/
estate.ts:118`) maps `games → games`, and the system door answers for the
consumer whose bearer was presented. An unrecognised id gives `null`, not
`games`. ⚠️ **Not deployed and it did not need to be** — `BILLING_POLICY = "off"`
means neither call site runs, and with `ESTATE_APP = "games"` the function
returns the identical string. Provable no-op, stated rather than assumed.

`b11a373` **`scripts/provision-catalog.mjs`** — twelve idempotent steps, the same
CLI and both PAUSEs as the books twin, with the §7.6 games ledger. `ad2258c`
**74 tests** (suite 220 → **298 pass / 0 fail**). `54faef0` runbook
`docs/access/provision-catalog.md` + index row + the phase-9 item moved WHOLE to
that repo's `DONE.md`.

**Four deliberate differences from the books twin, each with its reason in the
file:** it does **not** deploy (step 11 prints `DEPLOY_HOLDER=<you> npm run
deploy:<i>`; `--resume` sees the `env=<i>` line in `deploys.log` and continues);
the env block is **rendered from the committed commented template**, so the
existing drift guard protects the provisioner too; 🔴 the block is inserted
**above** that template, never at EOF, because the guard slices banner→EOF and
requires every line there to be commented; and the covers domain is a real CLI
step with an **ordinal** hostname (`gamecovers2.`) because `cover-storage.ts`
writes `COVERS_BASE_URL` into `thumbnail_url` rows.

🔴 **TWO THINGS THIS REPO NEEDS, found by G and not on the books runbook.**
Adding `games2` to `CONSUMER_APPS` also needs a `case 'games2'` arm in
`siteForApp()` (`apps/auth-worker/src/estate.ts:118`) and `'games2'` in
`BILLING_SITES` (`apps/auth-worker/src/billing-registry.ts:38`) — **without both
this repo does not compile**, because `siteForApp` is exhaustive over
`ConsumerApp`. Then a decision about which `BILLING_FEATURES` list `games2` in
their `sites`, or the Spending panel draws an empty matrix. The provisioner
prints all of it with exact diffs and re-reads five of the seven back out of this
checkout on `--resume`.

**The seal hook works against S2's real module.** It dynamic-imports
`scripts/lib/catalog-seal.mjs` through the `platform-repo.mjs` locator and acts
on `source`; absent and `'none'` are the same outcome (§6.4 row 3) and different
facts, printed differently; a THROWING inject stops the run rather than falling
through to the owner's money. 🔴 **The "no key" outcome uses the GAMES sentence,
not the books one** — there is no donor and no peers, so it says *no AI lookups
at all on this instance*, and refuses to finish a real provision with no key.

**MEASURED:** `--dry` against the LIVE `estate_auth` D1 — row **#3**
`boardgames` refused as already live (exit 2), row **#1** `library` refused as a
BOOKS request pointing at the other repo (exit 2). A fixture accepted row printed
all twelve steps, both pauses and a 109-line block at exit 0, with the Firebase
authorised-domain list read live. Four defects were found **by running it**, not
reading it — a key-only TOML substitution had rewritten `name = "RATE_LIMITER"`
to the Worker's name; `Number(null)` is 0 so an absent `--request` read as #0;
`--resume` threw about `games3` when an id was pinned; and the secret plan's
last-moment guard was unreachable.

⚠️ **NOT verified:** no second games instance exists — no D1, bucket, covers
hostname, secret or deploy — nothing ran past `--dry`, no envelope was decrypted
from that side, and nobody signed in. ☐ **Owner decision still open:** the naming
split — (a) as built (env/Worker follow the person, the rest ordinal), (b) all
ordinal, (c) all follow the person. Both provisioners are built to (a) so the
pair agrees, and each keeps it in ONE function, so a flip is one function per
repo.

**For `admin.js`'s `catalogNextStep()` games branch** (the conductor's edit, not
G's) — the exact text is in G's report: the command line is
`npm run provision:catalog -- --request <id> --dry` run from
`boardbuddy/Board_Game_Catalog`, plus two sentences naming both pauses and the
no-donor fact.

### ✅ Phases 1 + 2 — the auth-worker half — BUILT, MIGRATED AND DEPLOYED (agent A, 2026-09-05 14:24Z)

`6b1f686` migration `0018_catalog_requests.sql` + `apps/auth-worker/src/catalog-names.ts`
(the ONE reserved list and subdomain validator both cards share) · `9df0b51`
`src/catalog-requests.ts` — the six routes of §3.6 — plus the three `adminCors()`
mounts and 52 tests · `2f55065` `/api/estate/me` gains `catalogs`.
**Migrate-before-deploy, in that order:** `npm run db:migrate` applied `0018` to
**remote** `estate_auth` (4 commands, 0.87 ms, one ✅) before
`npx wrangler deploy` shipped `estate-auth`
`ecf3f86a-5ac9-44c6-9632-8073133c45fd`. Deploy line + full verification list:
[`deploys.log`](deploys.log). As-built rows:
[`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) §10
phases 1–2 and §3.3.

✅ **This UNBLOCKS agent C's phase-4 deploy** (item 1 below): the three CORS
mounts are committed in `9df0b51`, so `cors-coverage.test.ts` is green and
`npm run deploy:home` can run from a worktree of HEAD.

Measured: suite 594 → **651 pass / 0 fail**, `tsc` clean on both projects.
Live (`curl -s -D - … -o /dev/null` — ⚠️ `-I` and `-o NUL` misreport on this
host): unauthenticated `GET /api/estate/catalogs/availability?name=test` and
`POST …/requests` both **401** with the worded *"You are not signed in…"*
refusal, never a bare status; `OPTIONS` preflight from `https://heygabi.ai`
**204** on the bare mount and the wildcard; `/api/health` 200;
`wrangler d1 execute estate_auth --remote` reads `catalog_request` count **0**
with both indexes present. Probe suite 136/1 on a clean run, the one failure
being the **pre-existing** stale `discord:D5` (it asserts four
`gabi_books_tools` names; there have been five since 2026-09-03).

🔴 **What is left, and it is the whole 200 side:**

1. 🔴 **NO SIGNED-IN REQUEST HAS EVER BEEN FILED.** A session cannot sign in as
   a person and must not mint an identity against a live gate, so every
   success path — a real submit, an availability answer for a member, the `/me`
   `catalogs` array, accept/decline, mark-live, withdraw — is proven **only**
   against an in-memory D1. **This is the owner's step**, and it is the same
   one phase 4 needs: file one request of each kind at <https://heygabi.ai>
   signed in, then accept one at <https://heygabi.ai/admin/>.
2. ☐ **Phase 6's back-seed is now UNBLOCKED** — `0018` is applied remotely, so
   the `library` / `padhard` / `boardgames` `live` rows the owner asked for
   ("Yes back seed", ~07:25 Phoenix) can be inserted. Not done by this agent:
   it was not in its brief, and it is a data write to the row shape §9 row 4
   specifies.
3. ⚠️ **A finding, not a defect:** `docs/access/estate-auth.md` §2's route table
   covers **four** of the Worker's ~forty routes — it is the SSO build's table,
   not the Worker's. Rather than duplicate §3.6 into it, §2 now carries a
   pointer paragraph naming where each feature's route contract lives. One
   fact, one home.

### ✅ Phase 4 — the `/admin` queue — BUILT + PUSHED, `7acc497` (agent C, 2026-09-05)

`sites/heygabi-home/public/admin/admin.js` + `admin/index.html`. Banner (§5.2),
"Catalog requests" section first among the panels (§5.3), Accept panel with
owner-editable address + live availability (§5.4), two-tap Decline with the
required reason, Mark live, the collapsed decided list, and the §5.6 refusal set
with the four causes kept distinct. As-built record, including the two gesture
rulings and the two defects fixed in passing:
[`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) §10.1;
the `/admin` page map is now [`access/estate-auth.md`](access/estate-auth.md) §9.3.
Green: `check:home` (30 JS, 26 module graphs, 14 HTML) and the full workspace
suite.

What is left on this phase, in the order it can be done:

1. ~~🔴 **THE DEPLOY IS BLOCKED ON PHASE 1's CORS COMMIT — not on a defect
   here.**~~ ⚠️ **Corrected 2026-09-05 (docs audit): the block CLEARED the same
   afternoon and this phase IS DEPLOYED.** Measured: `deploys.log` line
   `2026-09-05T14:27:55Z heygabi-home 2a6ecb1 … 3bb3bff7`, which shipped
   `admin/admin.js` + `admin/index.html` after agent A's mounts landed in
   `9df0b51`; a cache-busted `GET /admin/admin.js` answered 200 carrying
   `renderCatalogQueue`, and the later wave-2 deploy `3abf9d01` (15:23Z) shipped
   the Accept panel's sealed-key half on top. The refusal text and the ordering
   rule it bought are kept below because they are the durable half. The original
   claim, for the record:
   `apps/auth-worker/test/cors-coverage.test.ts` failed while the frontend named
   `/api/estate/catalogs/*` and `apps/auth-worker/src/index.ts` has no
   `app.use(…, cors())` for them, and `npm run deploy:home` runs the whole
   workspace suite. Agent A has the three mounts written (`index.ts:208–210`)
   and **uncommitted**; the moment they land, re-run the deploy from a worktree
   of HEAD. ⚠️ **The guard was NOT bypassed** — it is right: a missing preflight
   makes the page report a network error, which reads as an outage rather than a
   missing route. Ordering rule for the next parallel build: **the route repo's
   CORS registration is a phase-1 deliverable, not a phase-1 detail.**
2. 🔴 **NOBODY HAS RENDERED THE SECTION SIGNED IN**, and this is the debt §10's
   own row 4 said not to repeat. There is no browser harness for `admin.js`;
   `check:home` proves it parses and nothing more. Sign in at
   <https://heygabi.ai/admin/>, file one request of each kind from the front
   door, and check: the banner appears above the panels and names the kinds; the
   section is first and collapsed with a live count; a Games row carries the §8
   cost in words; Accept's two taps open the panel and write nothing; editing
   the address live-checks and the *unchanged* address does **not** read as
   taken; Accept then shows the `--dry` provisioner line; Decline refuses
   without a reason.
3. ☐ **The sealed-key hook** (phase 5, LAST): `catalogAcceptPanel()` carries a
   marked comment where §5.4 items 3 and 4 go. Until then the panel states that
   the catalog is provisioned with the **owner's own** key, per §6.4 row 3.

### Dispatch B — the home-card "+" (phases 3a + 3b)

- ✅ **3a LANDED `d475682`** — the Games card is `.card.multi`; the host row is
  now the link (full-width, one tab stop, `.sr-only` new-tab note inside it, its
  own `--hue` focus outline). Cost paid knowingly and on the precedent of
  `index.html:653–663`: no whole-card tap target, no hover lift, no sheen.
- ✅ **3b BUILT `1bfb5ac`** — `sites/heygabi-home/public/assets/apex-request-catalog.js`
  (the "+", the modal, the **required** review step, the pending pill with a
  two-tap Withdraw, per-kind show/hide, fail-hidden), styles in `index.html`'s
  own `<style>` per the `apex-admin-link.js` precedent, one `data-catalog-kind`
  hook per card, and two new live pins in `predeploy.checks.json` (the hooks as
  a **pair**, plus the module itself — partly closing audit finding **F25**,
  which is that no front-door asset was pinned at all).
  **Exercised** with a stub-DOM harness: all nine §4.3 rows correct, the review
  gate refusing in words with zero fetches, the exact POST body, a 409 shown as
  the route's own sentence, a thrown fetch shown as an **outage**, the debounce
  firing once, withdraw arming → POSTing → restoring the "+".
  🔴 **NOT verified: anything signed in, and anything live.**
- ✅ **DEPLOYED `4875d1dd`** from a worktree of `597e40d`, after the block
  cleared. It **was** blocked on the same CORS commit as phase 4 above (see that
  section's item 1 for the mechanism); the refusal named seven paths, three of
  them `apex-request-catalog.js`'s, and it was **not bypassed**. ⚠️ Uploaded
  **0 new files of 57** — byte-identical `public/` to agent C's deploy
  `3bb3bff7` four minutes earlier, which had already shipped this commit's
  public tree; this deploy exists so the shipped commit and the record agree.
  **One deploy covers both surfaces**, which is worth knowing before the next
  parallel build sends two agents at the same Pages project.
  Now written down where a future deployer will look:
  [`info/worktree-deploys.md`](info/worktree-deploys.md) §5 owns the general
  rule, and the incident with its full refusal text sits beside the build order
  it corrects in
  [`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) §10.
- ✅ **VERIFIED LIVE with the right instrument** (`curl -s -D -`, cache-busted):
  `GET /` **200** serving `div class="card multi" data-catalog-kind="games"` at
  line 933 with the `boardgames.heygabi.ai` host **link** at 940, the books
  hook, and the script tag at 1008; `GET /assets/apex-request-catalog.js`
  **200**, `application/javascript`, ~~**27,939 bytes**~~ — ⚠️ **Corrected
  2026-09-05 (docs audit): that byte count is a point-in-time measurement and is
  now SUPERSEDED.** Phase 5's client half (deploy `3abf9d01`, 15:23Z) added the
  optional sealed-key field; the same `curl -s … | wc -c` re-run at ~13:20
  Phoenix reads **36,012 bytes**, and `/assets/catalog-seal.js` answers **200**
  beside it. A session that re-runs this check and does not find 27,939 is
  looking at a stale figure, not a regression — carrying all six pinned
  strings. ⚠️ **No `class="card-add"` and no `class="card-pending"` appear
  anywhere in the served HTML** — the signed-out page carries the hooks and
  nothing else, which is the gate working rather than a missing feature.
  `npm run verify:home`: 29 pages fetched, all checks passed.
- ☐ **THE OWNER'S VERIFICATION, and nothing substitutes for it:** signed in at
  <https://heygabi.ai>, press the "+" bottom-right of **both** the Books and the
  Games card and file one real request of each kind. There is no browser harness
  for this page; `check:home` proves it parses and nothing more.

### ✅ Phase 5 — SERVER half of the sealed key: BUILT, DEPLOYED, LIVE-CHECKED (agent S1, 2026-09-05 15:00Z)

`estate-auth` **`d87235f8-c2a1-4756-bacf-ac2a23da880e`** at commit `9e0922f`.
Four commits: `f3b40b6` the bucket + binding + `Env` field · `e722d01`
`src/catalog-keys.ts` + the four route changes · `e8254db` 22 tests ·
`9e0922f` the `/me` bare-status fix (its own commit; the item moved WHOLE to
[`DONE.md`](DONE.md)). Deploy line and the full verification list:
[`deploys.log`](deploys.log). As-built cell: design §10 phase-5 row, SERVER
bullet. Operating facts (bucket, binding, key layout, who deletes what):
[`access/estate-auth.md`](access/estate-auth.md) §11.

**Created:** private R2 **`estate-catalog-keys`**, binding **`CATALOG_KEYS`**,
2026-09-05 14:47:18Z — ⚠️ it did **not** already exist. Public access verified
**disabled** the same minute; no custom domain, and it must never get one.

**MEASURED:** migrate-before-deploy ran in that order and answered **"No
migrations to apply!"** — `reader_key_set`/`owner_key_set` have existed since
`0018`, so **no new migration was needed**, which is a measurement rather than an
assumption. Suite **651 → 674 pass / 0 fail**; `tsc` clean on both projects;
`cors-coverage.test.ts` green — this phase adds **no new PATHS**, only fields on
three existing ones.

**Live** (`curl -s -D - … -o /dev/null`; ⚠️ `-I` and `-o NUL` misreport on this
host): `/api/health` **200** · unauthenticated `POST …/requests` **carrying a
`sealed_key`** → **401** with the worded refusal (auth gates before the envelope
is ever looked at) · `OPTIONS` preflight from `https://heygabi.ai` → **204** on
the bare mount and the wildcard · `GET /api/estate/me` signed out → **401 with
the new `detail`**.

🔴 **NOT VERIFIED, and it is the whole 200 side again:** no signed-in request
with a real envelope has ever been filed. A session cannot sign in as a person,
so every success path is proven **only** against an in-memory D1 plus an R2
stub. **The owner's browser test with S2's form is the live proof** — file one
request at <https://heygabi.ai> with a key attached, and check the answer says a
key was stored (the page reads the `reader_key_set` boolean back and must say so
in words if it is not `1`).

☐ **Left for whoever runs the first real provisioning:** confirm the envelope is
actually readable by `scripts/lib/catalog-seal.mjs` (S2's half) and that the
object is **gone** from `estate-catalog-keys` afterwards. Nothing has round-tripped
a real key end to end yet; the two halves have only been tested against the same
written contract.

### ✅ Phase 5 — CLIENT + PROVISIONER half of the sealed key: BUILT, DEPLOYED `3abf9d01` (agent S2; conductor deploy 2026-09-05 15:23Z)

**LIVE since 2026-09-05 15:23Z** — the conductor's single `deploy:home` from a
clean tree at `5d33b14` (heygabi-home deploy `3abf9d01`, 3 files uploaded, 55
unchanged; `deploys.log` has the line). The first `verify:home` hit the
propagation race recorded for 2026-09-01 — seven markers in
`assets/catalog-seal.js` and `assets/apex-request-catalog.js` "served 200 but
MISSING" — and the re-run at 15:31Z fetched 30 pages, all checks passed. Also
in that deploy: the games Accept row's next-step text now names the
`Board_Game_Catalog` provisioner (phase 9) instead of "no step to run yet".
Review: <https://heygabi.ai> (signed in, "+" → the form) and
<https://heygabi.ai/admin/> (the Accept panel).

**Commits.** `catalog-platform`: `c53d361` the mint script + `assets/catalog-seal.js` ·
`342d7be` `scripts/lib/catalog-seal.mjs` + 34 tests · `d687264` the "+" form's
optional field + a committed stub-DOM harness + 10 scenarios · `6cbb452` the
Accept panel's §5.4 items 3–4 + the `predeploy.checks.json` pins · `e63ccbe` the
absent-envelope fix. `library_catalog`: `acb4c44` step 10's §6.4 ladder.
As-built cell: design §10 phase-5 row, CLIENT + PROVISIONER bullet.

**The keypair was minted for real** — RSA-OAEP-4096/SHA-256, **kid
`fb6eb908ead63ce7`**, public half in the bundle, private JWK at
`docs/access/keys/catalog-provisioning.private.jwk`. `git check-ignore -v`
confirms `.gitignore:67` excludes it; it never appeared in `git status`. Custody
row: [`access/RECOVERY.md`](access/RECOVERY.md) §11.3.

**MEASURED — a fact that was asked for and is worth stating plainly:**
`scripts/lib/backup-keys.mjs` is **NOT** about `docs/access/keys/` despite its
name; it is the backup GENERATION-key grammar. The file that backs that folder
up is `scripts/backup-docs.mjs`, which applies **no extension filter and no
denylist** (`:108–117`) — its dry-run inventoried **82 files, exactly the 82 on
disk**, and `docs/access/keys/` holds 5. So the private JWK **is** covered, from
tonight, by the 3am `EstateDocsBackupR2` scheduled task. ⚠️ That is the same
machine's job writing to R2 — a second copy, not a second custodian.

**Verified, by exercising it.** Round trip proven **Node-to-Node**: the real
browser module seals, the real provisioner lib opens, bytes equal, with a
throwaway keypair. The "+" form driven through a stub DOM in 10 scenarios,
including a CANARY plaintext appearing in none of the request body, the dialog,
the page body or the console. Suites: platform scripts **277 → 324**,
`library_catalog` **2418 → 2428**, both 0 fail. `check:home` green.

🔴 **NOT VERIFIED — say it plainly: no human has sealed a key in a real
browser.** No envelope has ever been written to `estate-catalog-keys` or read
out of it, so §6.4 rows 1 and 2 are proven only against a keypair that exists
nowhere but a test. Nobody has rendered the Accept panel signed in.

☐ **The owner's step, and it is the only proof that counts.** After the home
deploy: sign in at <https://heygabi.ai> as the second approved account (his
primary owns all three back-seeded catalogs and sees no "+"), file one request
with a key attached, and check the answer says the key was **stored** — the page
reads `reader_key_set` back and must say so in words if it is not `1`. Then run
`node scripts/provision-catalog.mjs --request <id> --dry` in `library_catalog`
and confirm step 10 reports the reader envelope **PRESENT**.

(The 1Password copy of `catalog-provisioning.private.jwk` landed 2026-09-05
09:15 Phoenix — moved whole to [`DONE.md`](DONE.md); custody row in
[`access/RECOVERY.md`](access/RECOVERY.md) §11.3.)

☑ **Reserved list — the ORDINAL hostnames a provisioner mints are now refused**
(agent RES, 2026-09-05, `49f6e59`): `gamecovers<N>` is reserved by SHAPE, because
a games instance's covers host is ordinal (§7.1(a) — `COVERS_BASE_URL` is written
into `thumbnail_url` rows) and the second instance takes `gamecovers2` whether or
not anybody was asked; `bookcovers<N>` too, by anticipation of §7.2 step 2's
custom-domain tier. Near misses (`gamecoversx`, `gamecover`) stay free.
🔴 **Rides the SAME BLOCKED `estate-auth` DEPLOY** as the bare-401 fix — see that
section below; until it ships, `gamecovers2` is still answered "available" live.

## ☑ BUILT + DEPLOYED 2026-09-03 — `count_phrase` allowlisted on Groq — ☐ owner review (one live `@mention`)

Measured by the Groq Monitor at 19:12Z (the owner's own review question):
`mode:"first" purpose:"converse_tools" outcome:"ineligible" blocked_tools:["count_phrase"]`.
🔴 **Corrects the DONE entry above and `gabi-groq-rung.md`:** `GABI_GROQ = "first"` is
LIVE (`wrangler.toml:588`) and phase 2 tool loops are live — the "shipping dark /
toolless only" claim was stale, and dispatch B was briefed from it. The gate is
all-or-nothing per loop, so from the 12:04 deploy until this lands, **every mention's
converse loop billed Haiku instead of Groq**, not just book questions.
Fix: one array entry in `GROQ_READ_ONLY_TOOL_NAMES` (`gabi-tools.ts:1007-1010`, Tier 0c)
— the tool is read-only and returns a strict subset of what `search_book_text` already
sends Groq; invert the `gabi-groq.test.ts` assertion; correct the three docs; redeploy.
Conductor's call (restores the owner's configured posture; owner told, may reverse).
✅ **LANDED 12:47** (117k Opus; `272ac67` code+test, `6bbc39f` docs; deployed
`estate-discord` `45565653-1456-4a77-8605-17a8d073cae4`; 1246/0 unchanged; `/api/health`
200 with `gabi_groq_tool_allowlist` 13 → **14** names incl. `count_phrase`;
`gabi-groq-tools.ts` needed no wire entry — schemas pass by reference and families
already carried the name). Docs corrected: `gabi-groq-rung.md` step 8 + "Fourteen",
design §4.8, phrase-count §5b, `info/README.md` row. Regression window: 12:04 → 12:47.
☐ **PROOF PENDING — and it is the OWNER's step, because a session cannot post to
  Discord.** The next `@mention` must produce a `converse_tools` `gabi_groq` line
  with `outcome` ≠ `ineligible` (the Monitor catches it). `outcome:"fallback"` with
  `invalid`/`too_large` would be the rung's own §11/§12.2 question, not this fix. When
  seen, move this heading WHOLE to DONE beneath the phrase-count entry it corrects.
  **What to do:** `@mention` GABI in Discord with any book question, then read one
  line off `npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq" and .purpose=="converse_tools")'`.
  The deployed side is already re-confirmed — see the measurement directly below.

✅ **RE-VERIFIED LIVE 2026-09-05 ~13:20 Phoenix (docs audit), the code half only.**
`GET https://discord.heygabi.ai/api/health` **200**; `gabi_groq_tool_allowlist`
reads **14 names with `count_phrase` among them**, `gabi_groq` `"first"`,
`gabi_groq_ready` `true`, `groq_key_gabi` `true`. `gabi-tools.ts:1014` carries the
array entry. So the fix is still deployed and still configured; **only the wire
observation is outstanding**, and nothing about it is a build.

## ☐ Flip `GABI_CLUB_WRITES` — 5 of 7 steps left, and step 3 is BLOCKED on the `/progress percent` decision below

⚠️ **Corrected 2026-09-05 (docs audit). This section's premise was STALE by
three days: it said the blocker was an unmade MEASUREMENT, and that measurement
was made on 2026-09-02.** Verified: commit `ee688ad`
(*"CLUB_WRITE_SHAPES measured at last -- four of seven guesses were wrong, and
it STAYS DARK"*, 2026-09-02 11:33 -0700) read `audiobook_catalog/site/club-reads.js`,
`site/clubs.js` and `firestore.rules` read-only and rewrote the block;
`apps/discord-worker/src/club-write.ts:108` now carries `CLUB_WRITE_SHAPES` with
per-line evidence beside each field. **The real remaining blocker is an OWNER
DECISION** — `/progress percent` has no destination field — which is its own
section further down, and which `KNOWN_ISSUES.md` KI-13 already states
correctly. The original text, struck rather than deleted:

> ~~The blocker is a **measurement, not caution**: the field names inside an RSVP
> and a progress document live in `audiobook_catalog/site/`, which the build was
> directed not to read~~ … and this Worker's service account **bypasses
> `firestore.rules`** — so a wrongly shaped write is not refused, it **succeeds**,
> and the club page then shows nothing with no error anywhere. *(That second half
> is still true and is the whole reason the posture, not the code, is what
> protects a live club page.)*

`/rsvp` and `/progress` are built, tested and **dark** — re-measured 2026-09-05:
`apps/discord-worker/wrangler.toml:557` `GABI_CLUB_WRITES = "off"`, and
`GET https://discord.heygabi.ai/api/health` answers `gabi_club_writes_enabled:false`,
`gabi_club_writes_ready:false`, `club_write_shapes_verified:false`.

The checklist is [`access/discord-bot.md`](access/discord-bot.md) §15.3, with
today's state marked:

1. ☑ **DONE 2026-09-02 (`ee688ad`)** — read `site/club-reads.js` / `site/clubs.js`
   + `firestore.rules`. ⚠️ The old text named `site/club-meetings.js`; the commit
   read `site/clubs.js`.
2. ☑ **DONE 2026-09-02 (`ee688ad`)** — `CLUB_WRITE_SHAPES` corrected in
   `apps/discord-worker/src/club-write.ts` (one block, `deepEqual`-pinned by
   `test/club-write.test.ts`, pin updated in the same commit).
3. ☐ 🔴 **BLOCKED ON THE OWNER** — flip `club_write_shapes_verified` in
   `/api/health` (`src/index.ts:578`, hard-coded `false` today). It should not
   flip while `/progress percent` still has nowhere to land.
4. ☐ flip the posture and deploy · 5. ☐ re-run registration · 6. ☐ opt a club in
   with `features.meetingRsvp = true` · 7. ☐ **exercise it and then look at the
   club PAGE**, because the Discord side saying "recorded" is not the evidence.

⚠️ A concurrent agent was working in `audiobook_catalog` on 2026-09-02, which is
the second reason it was left alone.

## ❓ OWNER DECISION — pay for Groq's Developer plan, or stay free? (2026-09-02)

**The options: (a) upgrade to Groq's Developer plan** — every mitigation already
built turns into headroom, `reason:"too_large"` should vanish from the stream,
and `gabi_groq_tpm_limit` (8,000 today, confirmed live 2026-09-05) needs
updating; **(b) stay on the free tier** — nothing breaks, busy turns fall back
to Haiku invisibly, and the person cannot tell. Nothing is blocked either way;
this is a money question, not a build.

🔴 **The 413 wall the owner met is the FREE TIER, not a bug.** Groq allows
`openai/gpt-oss-120b` **8,000 tokens per minute** on the free plan and refuses a
single request bigger than that with `413` rather than queueing it — which is
the instant ~37 ms refusal he measured. The request was **~7,960 tokens before
his question**.

The code side is done (lean schemas cut the tool payload 54%, the full 13-tool
request now fits with ~1,500 tokens to spare, and a pre-flight refuses to send a
doomed one). But a three-pass tool loop still spends several thousand tokens a
minute, so on the free plan a busy turn will meet `429`s where it used to meet
`413`s.

**Upgrading to Groq's Developer plan turns every mitigation into headroom.**
Nothing breaks if he does not — the ladder falls back to Haiku invisibly, which
is what it did all through the live test. Measurement + arithmetic:
[`info/gabi-groq-rung.md`](info/gabi-groq-rung.md) §11.

## ❓ OWNER DECISION — should `/progress` drop `percent`, or learn `milestonePosition`? (2026-09-02)

**The options: (a) drop `percent` and take a CHAPTER only** — smallest change,
lands on `chapterIndex`, which the club page already reads; **(b) also learn
`milestonePosition`** — needs the read's milestone list to mean anything, so it
is the larger build. Doing neither leaves `/rsvp` and `/progress` dark for ever.
⚠️ This is the ONLY thing now blocking the `GABI_CLUB_WRITES` flip above.

The club-write shapes were finally MEASURED against `audiobook_catalog/site`
(read-only) and **four of the seven inferred names were wrong** — corrected in
commit `ee688ad`, with the evidence table in `src/club-write.ts`.

⚠️ **`GABI_CLUB_WRITES` stays `off`, and the remaining blocker is a design
question rather than a constant.** The club page tracks a **milestone position**
or a **chapter index**, both numbers; there is no percentage field anywhere in
it. A percentage is not a milestone index and not a chapter number, so
converting one to the other would be inventing a value. `/progress percent` is
now refused in words instead of written into a document nothing reads.

**The question:** should `/progress` drop `percent` and take a chapter only, or
also learn `milestonePosition` (which needs the read's milestone list to mean
anything)? Answer that, then the flip checklist in
[`access/discord-bot.md`](access/discord-bot.md) §15 is the rest.

⚠️ Flipping it is **access-increasing on somebody else's live page** — this
Worker's service account bypasses `firestore.rules`, so a wrong shape SUCCEEDS
silently. It gets confirmed, never assumed.
## ⏸ DEFERRED BY OWNER 2026-09-02 — anything needing the other computer

Owner, verbatim, 2026-09-02: *"Anything needing the other computer is on
pause."* Resumes only on his word — a session must not restart it.

The ABS box steps for the ebooks shelf library
(`audiobook_catalog/docs/access/SHELF_EBOOKS_LIBRARY.md` §3–§5) and anything
else requiring hands on the shelf box. Resumes only on the owner's word.

(The rest of the ~14:00 owner decision batch — publisher fix + B&N sweep,
work-page shelf merge, per-edition covers, single play button, Emberdark
dedupe with all source files kept — was BUILT the same afternoon and moved
WHOLE to [`DONE.md`](DONE.md) entry "2026-09-02 — the ~14:00 owner decision
batch, executed"; per-repo detail lives in library_catalog's and
audiobook_catalog's own DONE files.)

## ☐ Prune the `C:/lcw/` worktrees — 18 of 27 removed 2026-09-05; the 9 left each have a REASON

✅ **18 removed by agent W2-PLAT, 2026-09-05.** ⚠️ **Nothing is lost and that is
measurable:** `git worktree remove` deletes a checkout, never a branch — every
one of the 18 branches is still listed by `git branch` in its own repo and can
be checked out again in one command.

~~About 15 worktrees from the night's branches.~~ ⚠️ **Corrected 2026-09-05 (docs
audit) — MEASURED, and it is nearly double:** `C:/lcw/` holds **27
directories**, of which **5 are worktrees still registered to THIS repo**
(`git worktree list`: `f2fix`, `gabicp`, `index-read`, `pause`,
`platformhighs`). The other 22 belong to the sibling repos or are orphaned
directories git no longer tracks. The merged ones can go at leisure; check
`git worktree list` from EACH repo before deleting anything unmerged, and
⚠️ prefer `git worktree remove` over `rm -rf` so the registration goes too —
an `rm -rf`'d worktree leaves a stale entry that makes the next `worktree add`
of the same path fail.

⚠️ **Corrected again 2026-09-05 by the removal pass: "orphaned directories git
no longer tracks" was WRONG. Every one of the 23 git checkouts was a REGISTERED
worktree** — 5 to `catalog-platform`, 14 to `library_catalog`, 4 to
`audiobook_catalog` — so `rm -rf` was never needed and `git worktree prune` was
never called. The other 4 directories are not checkouts at all.

**The three checks each directory had to pass**, all measured before anything
was deleted: it is a git checkout (`rev-parse --show-toplevel` + `remote -v`);
`git status --porcelain` is **empty**; and its HEAD is an **ancestor of
`origin/main`** in its own repo (`merge-base --is-ancestor`, after `git fetch
origin main`). Plus: nothing inside modified since 2026-09-04.

### 🔴 The 9 that STAYED, and why

| Directory | Repo | Why it was NOT removed |
|---|---|---|
| `abfix` | `audiobook_catalog` | 🔴 **6 unmerged commits** on `feature/audit-fixes-audiobook` — HEAD `6b75fe2` is not an ancestor of `origin/main`. ⚠️ **Three of them are stored-XSS fixes** (`community.html` profile fields, inline `renderReviewSection`, generated community-stats `displayName`) plus a `reclaim_drive_files` trash-instead-of-delete fix and a CI gate. **This is unlanded security work, not leftovers** |
| `ebookcount` | `audiobook_catalog` | 🔴 **2 unmerged commits** on `feature/ebook-audio-count` (`5d49e90`) — the ebook manifest counting audio editions instead of refusing them |
| `gabicp` | `catalog-platform` | 🔴 **3 unmerged commits** on `feature/gabi-t2-confirm` (`177ae91`) — the T2 catalog-fix confirm lane, shipped DARK |
| `index-read` | `catalog-platform` | 🔴 **3 unmerged commits** on `feature/index-machine-read` (`a751349`) — the named MACHINE READ exception + its estate probe |
| `pause` | `catalog-platform` | 🔴 **1 unmerged commit** on `feature/pause-asks` (`9471961`) — *"Pausing ingestion is a QUESTION now"* |
| `onedrive-excluded` | — | **Not a git checkout.** Eight directories named after repos and side projects (`boardbuddy`, `bookbuddy`, `catalog-platform`, `flight-info`, `scraping-tool`, `Sundance`, `tome-of-lore`, `wow-recorder`), created 2026-08-25 — it looks deliberate (a OneDrive-exclusion staging area), so it was left alone rather than guessed at |
| `tbr-audit` | — | **Not a git checkout.** A 2026-08-26 scratch dump — `audit.mts`, `audit-report.txt` and ~40 MB of `.tmp` files |
| `v3` | — | **Not a git checkout.** `cache/ d1/ observability/ r2/ workflows/`, untouched since 2026-08-11 |
| `worktrees` | — | **Not a git checkout.** An **empty directory** |

☐ **What is left to decide, and it is the owner's call, not a session's.** The
five unmerged branches are the only real question: **land them, or delete the
branch and the worktree together.** Removing the directory alone would not lose
the commits (the branch holds them) but would lose the built `node_modules` and
any local state. ⚠️ **Start with `abfix`** — unlanded XSS fixes are worth more
than the other four combined. The other four directories can be deleted with
`rm -rf` whenever their content is judged uninteresting; none is a worktree, so
no registration goes with them.

☐ **Also left, and out of this item's scope:** ~40 loose files at the top of
`C:/lcw/` (commit-message drafts, `covers2-*.mjs/.sql/.log`, and two ~300 KB
`deploy-home-rq*.log` from **2026-09-05 07:2x** — ⚠️ so `C:/lcw/` is still a
LIVE scratch area, not purely a graveyard, which is one more reason nothing
there gets a blanket `rm -rf`).

☐ **Three stale worktree ADMIN directories were found and deliberately left**
(they are inside the repos, not under `C:/lcw/`, and predate this pass):
`catalog-platform/.git/worktrees/agent-a37b9d469f37af097` (2026-08-24),
`library_catalog/.git/worktrees/wave3` and `wave4` (2026-08-10). Each is a husk
with no `gitdir` file, so `git worktree list` already ignores them; harmless,
and `git worktree prune` is the one-command clean-up if anyone wants it.

## ❓ OWNER DECISION — raise the details-sweep cron frequency? (standing offer, 2026-08-24)

**The options: (a) leave it** — 1 book/tick, honest and slower; **(b) raise the
cron FREQUENCY** to get the old rate back. ⚠️ **Not an option: raising the
per-tick budget** — it must stay under the 50-subrequest ceiling, which is what
made it die mid-second-book before.

The library details-sweep now honestly heals **1 book/tick** (was silently
over-budget at 2 and dying mid-second-book). Raise the cron frequency if you
want the old rate; do NOT raise the per-tick budget (it must stay under the
50-subrequest ceiling).

---

## ☐ Secrets review follow-ups (from `info/secrets-review-2026-08-26.md`)

> The three decided/done owner items (keys stay in OneDrive; `ESTATE_EVENTS_TOKEN`
> set + verified; 1Password adopted — vault `Estate` is the master, steps 1+2
> done, four console keys verified live and old ones revoked by the owner) moved
> WHOLE to [`DONE.md`](DONE.md) on 2026-08-31. What remains open is steps 3 and
> 4 below, plus the two master-less secrets tracked in
> `library_catalog/docs/TODO.md` (*"Custody gaps"*).

## ☐ STEP 3 of the 1Password adoption — 3 of 4 pairs left, and all three are the OWNER'S ceremony (tooling ☑ BUILT, probes ☑ LIVE 2026-09-02)

`scripts/op-rotate-pair.mjs` mints a fresh value into the vault and sets it on
BOTH holders in one run, verifier first, stopping at the first failure.
`--list` prints the four and their probe status.

🔴 **THE BLOCKER IS GONE, THE WORK IS NOT DONE.** The three pairs below were
refused from 2026-08-26 because nothing could *watch* a rotation; the handshake
routes shipped 2026-09-02 and `--list` now reads ✅ four times. **Three
ceremonies are waiting on the owner** — the exact commands are below, and
nothing has been minted.

### ✅ `INDEX_READ_TOKEN_LIBRARY2` — ROTATED AND PROVED, 2026-08-26

Vault item `library2.INDEX_READ_TOKEN`; `catalog-index` (verifier) and
library-catalog-friend (presenter) both set in one run. **Handshake proved
directly**: `GET index.heygabi.ai/api/machine/lookup?title=…` with the new value
returns **200, 2 matching rows**, having returned 401 before the rotation. It had
**no readable master** before today (secrets review §3.1); it has one now.
padhard's secret NAME list re-measured after: **10**, unchanged.

⚠️ **What it does NOT prove:** that padhard is *sending* the new value on her own
traffic. Worker secrets are write-only, so the evidence there is that wrangler
accepted the write and the name is still listed. The VERIFIER half is proved.

### ✅ The other three were REFUSED for want of a probe — and the probes now EXIST (2026-09-02)

```
ESTATE_APP_TOKEN_LIBRARY2    estate-auth      ↔ library-catalog-friend
ESTATE_APP_TOKEN_AUDIOBOOK   estate-auth      ↔ audiobook-worker
ESTATE_APP_TOKEN_BOOKS       audiobook-worker ↔ estate-discord
```

**Option 1 below was taken.** Two read-only routes shipped 2026-09-02 (commit
`1cfa531`; `estate-auth` version `9fb859be-202f-40c5-9a6c-168263d2754e`,
`audiobook-worker` version `ee8255dd-8219-4372-bc48-a2c6688f6dc9`), and
`node scripts/op-rotate-pair.mjs --list` now prints ✅ against all four pairs:

| Route | Unblocks | Deliberately reaches |
|---|---|---|
| `GET auth.heygabi.ai/api/estate/app-check` | `_LIBRARY2` + `_AUDIOBOOK` (one Worker verifies both) | no D1, no identity, no write |
| `GET audiobook-api.heygabi.ai/api/books/app-check` | `_BOOKS` | no bucket, no pack, no email — **no book** |

Each answers *"does this bearer authenticate, and as which app?"* and nothing
else. Neither echoes a value; a refusal names no app and no configured secret.

### 🔴 THE OWNER'S CEREMONY — three runs, ONE PAIR AT A TIME

⚠️ **A session must not do this**, and none has: minting a value and pushing it
to two live Workers is the owner's mint-and-set-both-sides step. What follows is
what to type. From the repo root, with `op` signed in:

```bash
# 0. See the four pairs and confirm every probe reads ✅ before starting.
node scripts/op-rotate-pair.mjs --list

# 1. Rehearse. Mints nothing, sets nothing, sends no probe.
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_LIBRARY2 --dry-run

# 2. The real run, one pair, then STOP and read the seven lines it prints.
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_LIBRARY2

# 3. Only once that ends "✅ … handshake proved", the next:
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_AUDIOBOOK
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_BOOKS
```

⚠️ **`ESTATE_APP_TOKEN_LIBRARY2` has a holder in `library_catalog`**, so that
checkout must be present (the script finds it, or set `LIBRARY_CATALOG_DIR`).
The other two are entirely inside this repo.

🔴 **IF A RUN STOPS AT STEP 5 OR 6, DO NOT RE-RUN IT — RESUME IT:**

```bash
node scripts/op-rotate-pair.mjs --pair <NAME> --resume
```

A plain re-run mints a SECOND value and creates a DUPLICATE vault item under the
same title — two masters for one secret, which is worse than the half-applied
pair it was trying to fix. `--resume` takes the value from the item the failed
run already created.

**What each run does, in order:** mint → probe (expect a refusal) → vault item →
**VERIFIER** → probe (expect 200 naming the app, retried 2s/4s/8s/15s) →
**PRESENTER** → probe again. It stops at the first failure, and between the
verifier and the presenter that route is briefly DOWN — inherent to a
single-valued verifier, which is why both pushes are one run with no question in
between.

**Verify by hand afterwards, if you want a second opinion** (the value is the
one now in the vault; ⚠️ header, never a query string — this repo is public):

```bash
curl -s -H "Authorization: Bearer $(op read 'op://Estate/ESTATE_APP_TOKEN_AUDIOBOOK/password')" \
  https://auth.heygabi.ai/api/estate/app-check
# → {"ok":true,"app":"audiobook","verifier":"estate-auth","secret_name":"ESTATE_APP_TOKEN_AUDIOBOOK",…}
```

⚠️ **`app` is the assertion, not `ok`.** A value pushed to the wrong
`ESTATE_APP_TOKEN_*` secret still authenticates — as the wrong app — so a
status-only check would call that a success.

⚠️ **A new Worker version is not live at every edge the instant `wrangler`
returns.** Measured twice now: the 2026-08-26 rotation's probe 401'd for a
couple of minutes, and on 2026-09-02 the freshly deployed `/api/books/app-check`
answered **404 for about a minute** before answering correctly. The script
retries with backoff for exactly this reason; a by-hand `curl` should too.

### What the probes prove, and what they do NOT

✅ The **verifier** accepts the value presented. 🔴 **NOT** that the holding
Worker *sends* it on its own traffic — Worker secrets are write-only, so the
only evidence there is that `wrangler` accepted the write and the name is still
listed. The routes say so on the wire (`proves` field) rather than only here.

**The alternative, still available and needing no new code:** do them by hand
with the owner watching the surface each feeds — sign in on padhard; open an
ebook; ask GABI a book question in Discord. Slower, and it needs him present.

### ⚠️ The gotcha this run bought, worth more than the rotation

**A Cloudflare secret change is not live the instant `wrangler` returns.** The
first run set the verifier, probed immediately, got **401**, and correctly
stopped with the pair half-applied — padhard's rung 2 was down for the couple of
minutes it took to resume. The value was fine; the *edge* had not caught up. The
script now **retries the handshake with backoff (2s, 4s, 8s, 15s)** before
declaring failure, because a false negative there is itself an outage.

⚠️ **And "just re-run it" was NOT a safe retry**, which is the sharper half:
re-running would have minted a SECOND value and created a DUPLICATE vault item
under the same title — two masters for one secret. Hence `--resume`, which takes
the value from the vault item the failed run already created. **Any script that
mints into a vault and then does something fallible needs a resume path**, or its
own error message tells you to corrupt your custody store.

**This is the step that actually changes the recovery story** (secrets review
§5's own words), and it is the only one of the four that **mints new values and
touches live estate-internal pairs**. It was scoped, not executed. Four pairs,
each a `crypto.randomBytes(32).toString('hex')` minted inside a script, stored as
a vault item, then pushed to **both holders in the same run**, then proved by the
handshake that only agreeing sides can pass:

| Pair | Holder A (verifier) | Holder B | The proof it worked |
|---|---|---|---|
| `ESTATE_APP_TOKEN_LIBRARY2` | `estate-auth` | library **friend** (padhard) | `POST /api/estate/seen` accepted; padhard's health line |
| `ESTATE_APP_TOKEN_AUDIOBOOK` | `estate-auth` | `audiobook-worker` | the `/api/estate/…` health path |
| `ESTATE_APP_TOKEN_BOOKS` | `audiobook-worker` | `estate-discord` | `/api/books/*` on a linked asker's behalf |
| `INDEX_READ_TOKEN_LIBRARY2` | `catalog-index` | library friend's `INDEX_READ_TOKEN` | the index machine lookup returns rows for that app |

⚠️ **ONE PAIR AT A TIME, verify, then the next — stop at the first failure.** A
half-pushed pair does not error; it goes silently 401/403/404 and reads exactly
like a code bug. Verifier first for all four (they are inbound-verified).

**Deliberately OUT of scope — the owner re-mints these into the vault himself,
because each is a console he holds and a session should not:**
`ANTHROPIC_*`, `CLOUDFLARE_API_TOKEN`, `CATALOG_PLATFORM_TOKEN`,
`TOKEN_SIGNER_KEY` (GCP `estate-token-minter`), and `SHELF_PARITY_TOKEN` —
⚠️ the last is **RETIRE, not rotate** (superseded by the KV-hashed self-service
key since 2026-08-20).

## ☐ 🔴 STEP 4 of the 1Password adoption — `audiobook_catalog/.env` — GENUINELY UNBUILT, estimate only (owner ask 2026-08-26)

⚠️ **This is the one item in this file that is UNBUILT in the plain sense** —
no code, no vault items, nothing attempted. Re-confirmed 2026-09-05 (docs
audit) by reading this section only; the `.env` file was **not** opened, then
or now. Deliberately not attempted. The estimate, from the secrets review's own §2.6
inventory (names only; the file was **not** opened by this work):

- **~30 keys**, split **14 credentials / 16 config-and-identifiers**. Each one
  needs the config-vs-credential call made by hand — `R2_ACCOUNT_ID` and
  `ABS_BASE_URL` are identifiers, `R2_SECRET_ACCESS_KEY` and `ABS_PASSWORD` are
  not, and only a human reading the file can finish that sort.
- ⚠️ **The key count is a FLOOR, not a census.** `Claude-llm` is hyphenated and
  mixed-case, so the `^[A-Z_]+=` grep that produced the list cannot see it
  (§3.1). Any real census must use the `sed 's/=.*/=<REDACTED>/'` form.
- ⚠️ **Four files are not `NAME=value` at all and need DOCUMENT-type vault
  items, not password items:** `scripts/firebase_service_account.json` and
  `docs/access/keys/firebase-sa-restore.json` (⚠️ **two DIFFERENT keys on the
  same service account** — revoking one does not revoke the other), plus
  `scripts/token.json` and `scripts/credentials.json` (the estate's Drive OAuth
  token and its client secret). `op document create` is a different code path
  from everything built for steps 1–2.
- **Reusable as-is:** the importer (`--keys-dir` already handles one-value-per-
  file), the title convention, the idempotent create/update, the glued-value
  guard. **Needed new:** an `.env`-shaped template + the document-item path.
- ⚠️ **A concurrent agent was working in that repo** when steps 1–2 ran, which
  is a second reason it was left alone.
- **Rough size:** the 30 `NAME=` keys are a short sitting once the config/credential
  sort is made; the four JSON documents are the real work.

## ☐ The three formerly-DESIGNED items — all three now have code SHIPPED; 8 sub-steps left, listed per item

⚠️ **Count corrected 2026-09-05 by agent W2-BILL2B, for item 1 only** (the other
two items were not re-measured): of the eight, **item 1's phase 2b is now
CODE-LANDED** (`52ab54c` + `44492c8`, ☐ two deploys) and **item 1's phase 3 was
already BUILT** in the library and games repos when the eight were counted. The
paragraph below is left as written; these two lines are the correction.
⚠️ **Count corrected again 2026-09-05 14:1x Phoenix by the conductor:** item 2's
phase 4 is now CODE-LANDED too (`f2e7543`, agent W2-VERSE4, rides the pending
`estate-auth` migrate+deploy above), and item 1's phase 2b home half is DEPLOYED
(`1372ad9b`). So of the "five genuinely unbuilt phases" only **item 1's phases 4
and 5** remain unbuilt; the rest of the eight are deploys and eyeballs.

⚠️ **Corrected 2026-09-05 (docs audit). The old heading read `DESIGNED — one
still unbuilt, two BUILT`, and by then NONE of the three was design-only** —
item 2 ("+ Add a verse") was deployed on 2026-09-02, which the old subheading
correction itself never propagated up. What is left across all three is eight
☐ sub-steps: two human eyeballs (item 0's round trip, item 1's matrix read-back),
five genuinely unbuilt phases (item 1's phases 2b/3/4/5 and item 2's phase 4),
and one first-real-use (item 2's `landed` flip). ⚠️ Nothing here is a DESIGN
gap any more; each doc carries its own phases, effort guesses and open questions.

~~Item 1 is NO LONGER design-only, and this heading said it was until
2026-09-02. Its phases 0–2 are built, migrated and deployed; only **item 2**
still has no route and no migration.~~ *(that last clause was already stale when
written — item 2's migration `0017` was applied and its routes deployed the same
day)*. Item 0 was built on 2026-09-01 and has moved to [`DONE.md`](DONE.md);
only its live round trip remains.

### 0. ✅ BUILT 2026-09-01 — soft pauses + recurring blockers + do-not-disturb
The whole item moved to [`DONE.md`](DONE.md) (*"2026-09-01 — soft pauses,
recurring blockers and the do-not-disturb list, BUILT in both repos"*). Both
halves are live: reader `audiobook_catalog` **76aa89b** (merged 36a0f21),
platform **d752d93**. What is left open is the part no build can do
for itself:

- ☐ **The live round trip has never been run, and no human has clicked the
  card.** Set a soft pause with the GPU busy and read the worded refusal; free
  the GPU and watch the processor release it; add a 5-minute recurring blocker
  and watch it bite and lapse; add `Wow.exe` from the card and confirm a start
  is refused while the game runs. Needs the owner signed in at
  <https://heygabi.ai/status/pipelines/> — the routes require a devops token
  no session holds, and fabricating one against a live gate is not a test.
  ⚠️ This also finally pays the standing *"the signed-in card has never been
  rendered by a human"* debt (`info/ingestion-pause-controls.md` §6).
- ☐ **`WowClassic.exe` is unverified.** `Wow.exe` was read off `tasklist` while
  the game ran (2026-09-01); the classic-client name was not. If he plays
  Classic, check the real image name before trusting the suggestion.

### 1. Toggle what can bill the LLM — 🔄 PHASES 0–3 BUILT; 2b CODE-LANDED 2026-09-05, ☐ NOT DEPLOYED
Design of record: [`info/llm-billing-control-design.md`](info/llm-billing-control-design.md).
What landed moved WHOLE to [`DONE.md`](DONE.md) (*"LLM billing control — phases
0, 1, 2 and (this repo's half of) 3"*). Panel:
<https://heygabi.ai/admin/> → **"Spending — what may bill the model, and where"**.
Mockup (private artifact): https://claude.ai/code/artifact/2f288c59-d6ca-4fdf-b3e0-da732f0e78d1

🔴 **NOTHING IS SWITCHED OFF TODAY** — `BILLING_POLICY` ships `"off"` on the one
consumer that reads the answer (re-measured 2026-09-05:
`apps/index-worker/wrangler.toml:45`, and it is the only `BILLING_POLICY` in the
tree), so no policy row can deny anything. ~~The `billing_policy` table is EMPTY
(an empty table is exactly today's behaviour)~~ … ~~and nothing can be until
somebody presses a switch.~~

⚠️ **Corrected 2026-09-05 (docs audit) — THE TABLE IS NOT EMPTY, AND THE SWITCH
WAS PRESSED THREE DAYS AGO.** Measured read-only against the live remote
`estate_auth` D1 (`wrangler d1 execute estate_auth --remote --command "SELECT *
FROM billing_policy"`): **one row**, and it was written from the panel by the
owner himself —

```
id 1 · feature sweep.details · site games · principal_kind system · allow 0
updated_by nbaslamking@gmail.com · updated_at 2026-09-02T22:45:48.138Z
why "throwaway soak rule: shadow-mode falsifiability evidence for the billing
     gate (would-deny lines hourly). BILLING_POLICY is off everywhere, so
     nothing is blocked. Delete this rule before any site flips to enforce."
```

**What that row proves, and it is exactly what item 1 below was waiting for:**
the panel HAS been rendered signed in, a cell HAS been clicked, a rule HAS been
written with a `why`, and the write door HAS accepted an approver's identity and
stamped it. The round trip that "turns deployed into works" happened on
2026-09-02 22:45:48Z. ⚠️ **What it does NOT prove:** that the matrix DREW
correctly afterwards (nobody recorded a reload), and it says nothing about the
per-member drawer, which does not exist.

🔴 **A NEW ACTION FALLS OUT OF THE ROW'S OWN `why`, and it is a trap if
forgotten: DELETE RULE `id 1` BEFORE ANY SITE FLIPS TO `enforce`.** It is a
deliberately throwaway soak rule. Left in place at the enforce flip it becomes a
real denial of `sweep.details` on `games` for the `system` principal — the
unattended cron — which is precisely the failure shape phase 4's criterion is
designed to catch and would instead be caused by. It is also, until then, the
*second half* of §4.2's flip criterion sitting pre-staged: the "at least one
`would_deny:true` on something he DID switch off".

- ✅ **OWNER DECISION Q1 — deny-only. BUILT.** Not a convention: the resolver's
  only output is a set of DENIED ids and every call site ANDs it with the gate
  it already had, so there is no code path where a policy row opens anything.
  ⚠️ **Vetoable** — if the owner wants per-person GRANTS, that is a role-ladder
  change on the site that owns the ladder, not a change here.
- ✅ **OWNER DECISION Q2 — on/off switches only, no numeric budgets. BUILT.**
  `SWEEP_LIMIT` stays hard-coded. ⚠️ **Vetoable.**
- ✅ **Q3 — A3's public button was gated 2026-08-26**, ahead of the plan.

### 🔴 WHAT IS LEFT, in the order it can be done

⚠️ **Re-counted 2026-09-05 (agent W2-BILL2B): 2 of these 6 are now ☑.** Item 2
(phase 2b) is code-landed and waiting only on the two deploys; item 4 (phase 3
for `library`/`library2`/`games`) was measured BUILT in those repos and its old
☐ text is struck below. What is genuinely open: the owner's read-back (1), the
Discord secret (3), the soak (5) and the audiobook Python client (6).

1. ☑ **DONE 2026-09-02 22:45:48Z — the panel WAS rendered signed in and a rule
   WAS written.** ⚠️ **Corrected 2026-09-05 (docs audit); this item read
   `🔴 NOBODY HAS RENDERED THE PANEL SIGNED IN. No cell has been clicked, no
   rule has ever been written` for three days after it stopped being true.**
   The evidence is `billing_policy` row `id 1` above, stamped
   `updated_by nbaslamking@gmail.com` — a row can only reach that table through
   the approver-gated write door, so its existence is proof the sign-in, the
   click, the `why` and the Save all worked. ☐ **What is genuinely still
   unwitnessed is the READ-BACK:** nobody has recorded reloading
   <https://heygabi.ai/admin/> → **Spending** and seeing the matrix DRAW that
   row, nor switched it back on. That is a one-minute owner eyeball, not a
   build, and it is the same page linked below.
   🔴 **And do not switch `sweep.details` / `games` back on casually** — the
   owner's own `why` says the row is wanted until enforce; see the delete-before-
   enforce note above.
2. ☑ **CODE LANDED 2026-09-05 (agent W2-BILL2B, `52ab54c` + `44492c8`) —
   Phase 2b, the per-member drawer (§7.2) — 🔴 ☐ deploy (owner).** The
   **Spending** column is the grid's fifth cell on every member card, staged
   into the card's ONE Save beside the visibility boxes and the role dropdowns.
   It writes through the matrix's OWN door with `principal_kind: 'user'` —
   no new route and **no migration**, because the table, the resolver and the
   write door have taken `user` and `role` principals since phase 1.
   - **Four things it refuses to draw as a control**, each because the control
     would be a lie: a `system`-only path (the hourly sweep — a per-person rule
     there denies nobody, and `44492c8` makes the Worker refuse to store one);
     the OWNER (worded fact, matching the door's 409 — the break-glass is not
     narrowable into a lockout); a site the person holds no rung on (`n/a`,
     unless a rule already names them there); and an unanswered billing route
     (`not loaded`, never "spends nothing").
   - **It never says "all on" over a deny it does not own.** An `everyone`
     row, a `system` row, this person's RUNG or a wildcard is counted in the
     cell (`· N off by a wider rule`) and named on the line. Those rules cover
     people this column never names, so it reports them and changes none.
   - **`why` is required per money path and checked BEFORE the first write of
     any kind** — a card saves three systems in one gesture, and stopping on an
     empty box halfway would be half-applied for a reason the person could have
     been told first. Turning a path back on DELETES the row; "no rule" IS the
     default state.
   - **One defect fixed in the matrix above while building it:**
     `saveSpending()` reported SUCCESS for a cell it had not changed, when the
     deny arrived through a wildcard row it must not delete. It now says which
     rule is holding the cell and changes nothing.
   - ☐ **DEPLOY — TWO PROJECTS, and they are listed in the deploy manifest
     section above** (`## ☑ CODE LANDED 2026-09-05 (agent RES …)`): `44492c8`
     rides the `estate-auth` deploy; `52ab54c` needs `npm run deploy:home` for
     the `heygabi-home` Pages project. There is no ordering constraint between
     them — the column works against the Worker that is live today.
   - ☐ 🔴 **NOT VERIFIED: nobody has rendered it signed in.** No drawer has
     been opened in a browser and no per-person rule has ever been written from
     one. It was exercised instead by a throwaway stub-DOM harness driving the
     real `permGrid`/`spendCell`/`spendLine`/`savePermissions` through 16 rows
     (staging writes nothing; Save-without-a-why writes *nothing at all*, not
     even the visibility POST; the POST body; the DELETE-not-allow;
     the owner's fact; the wildcard refusal), plus `check:home`, which proves
     the module parses and is pinned. The bar is the owner at
     <https://heygabi.ai/admin/> → a member card → **Permissions** → the
     **Spending** cell on any row.
3. ☐ 🔴 **OWNER STEP — the Discord Worker cannot be wired without a secret.**
   E1–E5 and E7 are on the design's call-site list, but `estate-auth`
   **cannot identify** that Worker: `identifyApp` resolves a caller by token
   VALUE against `CONSUMER_APPS`, and it holds no Discord token. Wiring it
   means minting one and setting it on both Workers — and ⚠️ adding `discord`
   to `CONSUMER_APPS` would ALSO make that bearer a valid `/seen` bearer,
   which `test/dev-access.test.ts` explicitly guards against as *"a capability
   nobody granted it"*. Access-increasing, so it is confirmed, never assumed.
   Until then GABI's spend has no switch.
4. ☑ **Phase 3 for `library`, `library2` and `games` — BUILT, and it was
   already built when this line was written.**
   ⚠️ **Corrected 2026-09-05 (agent W2-BILL2B, from the two repo audits run the
   same day).** This item read:
   ~~"☐ **Phase 3 for the other three repos** — `library`, `library2` and
   `games` read `billing_denied` off `/seen` (the shared client already sends
   `local_role` and parses the field); the audiobook Python paths need the
   phase-5 client. Each is a separate repo and a separate deploy."~~
   Measured in the repos themselves:

   | Site | Built at | Live version | Posture |
   |---|---|---|---|
   | `library` + `library2` | `e7b3f6b` (`bookbuddy/library_catalog`) | `77a9f67c` / `37b83f8b` | `BILLING_POLICY="off"` — `apps/worker/wrangler.toml:288,550` |
   | `games` | `5150269f` (`boardbuddy/Board_Game_Catalog`) | `2e598a9e` | `BILLING_POLICY="off"` — `apps/worker/wrangler.toml:222` |

   So the only phase-3/5 work left is the **audiobook Python client**, which is
   item 6 below and always was. ⚠️ **Everything ships `"off"`**, so nothing is
   denied anywhere yet — built is not switched on, and the soak in item 5 is
   still the next real step.
5. ☐ **Phase 4 — the soak, then `enforce` ONE SITE AT A TIME.** Flip
   `BILLING_POLICY = "shadow"` first and read the lines:
   `npx wrangler tail catalog-index --format json | jq 'select(.evt=="billing_policy")'`.
   ⚠️ The flip criterion is §4.2's and it has TWO halves: zero `would_deny:true`
   on anything the owner did not switch off, **AND at least one
   `would_deny:true` on something he DID**. Without the second, "zero denials"
   is indistinguishable from "the instrument never ran" — the exact
   `0 of 0 — unmeasured, not clean` verdict the audiobook auth soak reached.
6. ☐ **Phase 5 — the audiobook Python paths (A1–A9).** A small policy client
   (one HTTPS GET on the app token, cached to a file, 10-minute TTL) plus the
   `--no-llm` wiring. The hard one: no estate client exists on that side.

⚠️ **One finding from the build, worth keeping:** the design's §3.2 table
double-covers L9 and L10 (`research.covers` + `cli.backfill`;
`research.isbn` + `cli.backfill`). Reproduced VERBATIM rather than tidied —
policy can only deny, so a path under two switches is refused if either
denies, which fails safe. A test pins the list of double covers so a NEW one
has to be argued for.

7. ❓ **OWNER DECISION (found 2026-09-05 by agent W2-LIBCLI, design §9 Q5 has
   the full argument): the Spending panel's cell cannot reach the library CLI
   scripts.** The scripts' gate (`bbc693b`, `bookbuddy/library_catalog`) asks
   the SYSTEM door, which resolves `principal_kind='system'` rules only; but
   `apps/auth-worker/src/billing-registry.ts` declares `cli.backfill`,
   `research.covers` and `research.isbn` with `principals: ['person']`, so the
   panel's click writes an `everyone` rule the scripts never see. A `system`
   rule written via `POST /api/estate/billing/rules` DOES trip the gate today.
   The one-line fix is `principals: ['person', 'system']` on those three rows
   (behind the registry pin test) — **not made**, because it adds a clock-icon
   row to the matrix for each, which is a visible change the owner has not
   asked for. (a) make it, (b) leave the CLI reachable by API only. ⚠️ Until
   `ESTATE_APP_TOKEN_LIBRARY` / `_LIBRARY2` are exported in the shell that runs
   the scripts (names only; `library_catalog/docs/access/secrets.md` → "The two
   NAMES the CLI spending gate reads"), the gate prints "policy UNKNOWN …
   proceeding" either way.

### 2. "+ Add a verse" — ✅ phases 0–3 DEPLOYED 2026-09-02; ☑ phase 4 CODE LANDED 2026-09-05 (`f2e7543`) and its FRONT END DEPLOYED 2026-09-05 (`795f242` / `ba7ddd03`) — 🔴 ☐ migrate + deploy the WORKER (owner), ☐ first real use

Phases 0–3 archived whole in [`DONE.md`](DONE.md). The fixed-order deploy RAN:
migration `0017` applied to remote `estate_auth` first (`npm run db:migrate`,
✅ in 1.07ms); `estate-auth` deployed from a worktree of HEAD (version
`07dbe1b0-a58f-4980-a435-c8c01f909f34`); `heygabi-home` deployed LAST from the
same worktree (`18df9ec9`, 28 live predeploy checks passed) — but ⚠️ only
after `.gitattributes` pinned `universe-names.generated.ts` to `eol=lf`
(commit `886b370`): a Windows worktree checkout CRLF'd the generated file and
the byte-comparing parity test correctly refused the deploy. Live verify:
"+ Add a verse" and "Missing a verse?" both render signed-in on
<https://heygabi.ai/universes/>. NOT verified: no request has ever been FILED
(the first real request → /admin approve → CLI create round-trip is untried),
and /admin's Verse-requests section is unrendered by human eyes.
✅ **RE-MEASURED 2026-09-05 (docs audit), read-only against the live remote D1:
`SELECT COUNT(*) FROM universe_request` = **0**.** So the "no request has ever
been FILED" claim is not an assumption carried forward — it is true as of this
reading, and the whole 200 side of this feature remains unexercised. Review
link for the human step: <https://heygabi.ai/universes/> to file one, then
<https://heygabi.ai/admin/> → **Verse requests** to approve it.

Remaining, unchanged:

5. ☑ **CODE LANDED 2026-09-05 (agent W2-VERSE4, `f2e7543`) — Phase 4, notify on
   a decision** — 🔴 **☐ deploy + migrate (owner).** ~~Unbuilt; it was never a
   recommendation, just a later phase.~~ The as-built, its two departures from
   the design and what is still open are
   [`info/universe-add-verse-design.md`](info/universe-add-verse-design.md) §8.
   In short: the **opt-out** reuses `estate_prefs` as §4 asked
   (`notify:user:<id>`, `notify-prefs.ts`'s own parse idioms); the **messages**
   could not, so there is a migration the design never named —
   `0019_estate_notification.sql`, purely additive. `POST …/decide` and
   `POST …/landed` now write one notice to the **requester** (never the
   approver), quoting the decider's words verbatim; ⚠️ `approved` still never
   reads as done. Nothing is sent when there is no requester, an opt-out means
   the notice does not exist, and 🔴 **a failed notice never fails the
   decision** — three refusals, three tests. Doors:
   `GET /api/estate/notifications`, `POST …/:id/read`, `POST …/read-all`,
   `GET|POST …/prefs`, all `requireApprovedMember()` and apex-CORS-mounted.
   Suite 682 → 721 pass / 0 fail; `tsc` clean.
   - 🔴 **IN-APP ONLY — nothing buzzes a phone, sends mail or DMs anybody**,
     because this Worker holds no outbound channel to a member (§8.2). Email
     needs a mail credential; a GABI DM needs `estate-auth` to hold a Discord
     bearer and `CONSUMER_APPS` to accept one, which `test/dev-access.test.ts`
     guards against by name — ⚠️ **access-INCREASING, so the owner's to mint,
     not an agent's to assume.** The queue is built and the channel is named.
   - ☐ **The owner's two steps, in this order:** `cd apps/auth-worker &&
     npm run db:migrate` (applies `0019` remotely), then `npx wrangler deploy`.
     Batched into the one estate-auth deploy manifest above — the section that
     also carries RES's bare-401 fix and S1's sealed-key phase.
   - ☑ **A page draws a notice — CODE LANDED + DEPLOYED 2026-09-05 (agent
     `W3-NOTICES-UI`, `795f242`, heygabi-home deployment `ba7ddd03`).**
     ~~No page draws a notice yet.~~ `assets/apex-notices.js` +
     `assets/apex-notices.css` hang a bell on `<estate-search>`'s one
     extension point (`slot="who-extra"` — the component's own *"Signed in as
     … · sign out"* line), so **one module and one stylesheet serve both pages
     that embed the component**: <https://heygabi.ai/> and
     <https://heygabi.ai/universes/>. Unread badge, notices newest first with
     the decider's words **verbatim**, mark read, mark all read, and the
     opt-out toggle. The as-built is
     [`info/universe-add-verse-design.md`](info/universe-add-verse-design.md)
     §8.9; `predeploy.checks.json` gained four pins and a **surface owner**
     entry so a second notices UI fails `check:home` by name.
     - 🔴 **UNEXERCISED, AND IT CANNOT BE OTHERWISE YET.** Measured live
       2026-09-05 21:39 UTC: `GET https://auth.heygabi.ai/api/estate/notifications`
       answers **404 `{"error":"not_found"}`** while `/api/estate/me` on the
       same host answers **401** with its worded refusal — so the routes
       genuinely do not exist yet rather than being merely gated. That 404 is
       the case the module treats as `unavailable`: **no bell is drawn and
       nothing else on the page changes.** The bell cannot appear for anybody
       until the owner's two steps below land, and cannot show a *notice* until
       a first request is filed and decided.
     - ☐ **Owner review, and it is the only proof that counts:** signed in at
       <https://heygabi.ai/> (or <https://heygabi.ai/universes/>), look at the
       *"Signed in as …"* line under the search box — the bell sits to the
       right of *sign out*. ⚠️ **Nobody has seen it signed in**; a session
       cannot sign in as a person, so every claim about what a member sees is
       proven only against the stub-DOM harness
       (`scripts/test/apex-notices.test.mjs`, 24 cases) and the Worker's source.
   - ☐ **Never exercised.** No notice has ever been written, because no request
     has ever been filed (`SELECT COUNT(*) FROM universe_request` = 0, measured
     2026-09-05). The whole 200 side is proven against an in-memory D1 only.
6. ☐ **First real use closes its own loop:** after the JSON edit and both
   catalog rebuilds, `POST /api/estate/universes/requests/:id/landed { commit }`
   flips the row from `approved` to `landed`. Until somebody does that once, the
   fourth status is a claim this estate has not yet exercised.

⚠️ **Two recommendations were built as recommended and are VETOABLE** (§6 Q1's
`create` verb, gated by `--why` **and** `--confirmed`; §6 Q2's collapsed `/admin`
section rather than a tab). Both are reversible in one commit each; the reasoning
is in `DONE.md`.
