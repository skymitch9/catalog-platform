# Catalog Platform — Work Log

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-12**.
> This is the *work log* — current state and things in flight. Stable facts live
> in [`PLATFORM.md`](PLATFORM.md), [`DOMAIN_AND_HOSTING.md`](DOMAIN_AND_HOSTING.md)
> and [`UNIVERSES.md`](UNIVERSES.md). Cross-link rather than duplicate.

---

## 1. ⚠️ Three of the four repos deploy only from a human's laptop

**Raised by the owner 2026-08-12**, immediately after a manual
`npm run deploy` of `library_catalog`: *"i dont think board games has one
either, add a todo in catalog platform to look into deploying these apps."*

Correct, and it is worse than "no CI" — it is a **single point of failure that
is a person at a specific machine.**

### What is actually true (measured 2026-08-12)

| Repo | `.github/workflows` | How it reaches production |
|---|---|---|
| `bookbuddy/audiobook_catalog` | ✅ 7 workflows — `deploy`, `promote`, `auto-promote`, `lint`, `tests`, `club-notify`, `cw-fulfill` | Push to `main` → deploy → `/dev/`; a separate **Promote to Prod** dispatch publishes the root |
| `bookbuddy/library_catalog` | ✅ `deploy.yml` (manual dispatch, 2026-08-14) | `npm run deploy` by hand, **or** Actions → Deploy Worker (manual) once secrets exist (§1.5) |
| `boardbuddy/Board_Game_Catalog` | ✅ `deploy.yml` (manual dispatch, 2026-08-14) | same as library |
| `catalog-platform` | ✅ `deploy.yml` (manual dispatch, target choice, 2026-08-14) | index-worker / auth-worker / heygabi-home / all — once secrets exist (§1.5) |

### 1.1 The two catalogs are structurally identical, which is the opportunity

They are not two problems. Every relevant script is the same shape:

| | `library_catalog` | `Board_Game_Catalog` |
|---|---|---|
| `predeploy` | `node scripts/check-clean.mjs` | `node scripts/check-clean.mjs` |
| `deploy` | `npm run build && npm run deploy --workspace @lc/worker` | `npm run build && npm run deploy --workspace @bgc/worker` |
| Target | Cloudflare Worker + D1 + R2 + `[assets]` | Cloudflare Worker + D1 + R2 + `[assets]` |

So **one workflow, parameterised by workspace name, covers both.** Whatever is
written for one should be written once and copied with a single string changed.

### 1.2 ⚠️ Do not copy the audiobook workflow wholesale

It is the only working example in the estate and it is tempting, but it encodes
a **two-lane deploy** (`main` → `/dev/`, an explicit promote → prod) that exists
because that site publishes a generated static catalog and needs a staging lane
for data. The two Workers have no such split — they deploy one artifact to one
custom domain. Copying the promote machinery would add a lane nobody asked for.

⚠️ Also learned the hard way on 2026-08-12: `Auto-promote books to prod`
**skipped** a commit that was a code fix rather than a catalog auto-update, so
the fix sat on `/dev/` looking deployed while prod was stale. Any lane split
must make "this did not reach prod" loud, not silent.

### 1.3 What a workflow has to preserve

These are guardrails the manual path currently provides, and a workflow that
drops them is worse than no workflow:

1. **`check-clean.mjs` refuses a dirty tree.** It exists because production in
   the Board Game Catalog twice ran code that was in no commit. CI is clean by
   construction, so the guard becomes free — but the *reason* must survive: the
   deployed artifact has to be a commit.
2. **Migrate before deploying**, so new code never meets an old schema.
   `library_catalog` has `db:migrate`; the ordering is currently a human
   remembering it.
3. ⚠️ **Wrangler on Windows sometimes prints success then exits non-zero** (a
   libuv teardown quirk). On Linux CI this stops being a problem — but do not
   port any `|| true` written to work around it, or a real failure goes green.
4. **Secrets.** A Cloudflare API token with Workers + D1 + R2 scope has to live
   in repo secrets. ⚠️ Neither repo has ever needed one, so this is new
   surface — and `audiobook_catalog` **must stay public** for unmetered Actions
   minutes, so think about whether these two should be public too before
   assuming the same budget applies.

### 1.4 Does `catalog-platform` need deploying at all?

Probably not, and that should be decided rather than defaulted. It has no
`deploy` script and no worker. What it does have is a **build-time dependency
edge**: `library_catalog`'s `prebuild`/`pretest`/`pretypecheck` fetch the shared
universe list from this repo and **fail loudly** if the checkout is missing
(`UNIVERSES.md`). So CI for `library_catalog` has to check out *two* repos, and
that is the real coupling to solve here — not a deploy.

### Former open questions — answered

- `Board_Game_Catalog` is **PUBLIC** (unmetered minutes); `library_catalog` and
  `catalog-platform` are **PRIVATE** (metered — fine for occasional manual
  deploys, revisit if usage grows).
- The owner decided **manual dispatch only** (2026-08-14): these Workers have no
  dev lane, so the trigger stays a deliberate human button-press. No push
  triggers, no schedules.

### 1.5 BUILT 2026-08-14 — workflows exist; owner actions remain before first use

`deploy.yml` in each of the three repos (manual `workflow_dispatch` only).
All preserve §1.3: check-clean still runs (not disabled), D1 migrate runs
**before** deploy, no `|| true` anywhere. The two catalog workflows check out
`catalog-platform` as a sibling and set `CATALOG_PLATFORM_DIR`. Each fails
early with instructions when a secret is missing (proven by a triggered run).
`CLOUDFLARE_ACCOUNT_ID` is already set as an Actions **variable** on all three
repos (it is not a secret). CI does **not** commit `docs/deploys.log` — the
workflow prints the line to append locally if wanted.

**Owner checklist (nothing deploys until these exist):**

0. ⚠️ **Board_Game_Catalog's default branch is still `phase-1-manual-catalog`**
   (a stale ancestor, 152 commits behind `main`) — GitHub only shows the
   dispatch button for workflows on the *default* branch, so the deploy
   workflow is invisible until this flips. Fix:
   `gh repo edit skymitch9/Board_Game_Catalog --default-branch main`
   (a session tried on 2026-08-14; repo-settings changes are permission-blocked
   for Claude, so this one is genuinely the owner's).
1. Create ONE Cloudflare API token at dash.cloudflare.com/profile/api-tokens:
   'Edit Cloudflare Workers' template **plus D1 edit + Cloudflare Pages: Edit**
   (Pages is for heygabi-home; the plain Workers template lacks it), account
   `113be82b840c956b8378a187047ab3ea`.
2. `gh secret set CLOUDFLARE_API_TOKEN --repo skymitch9/library_catalog`
   (repeat for `skymitch9/Board_Game_Catalog` and `skymitch9/catalog-platform`).
3. Create a fine-grained PAT (github.com/settings/personal-access-tokens) with
   **Contents: Read on skymitch9/catalog-platform** (it is private), then
   `gh secret set CATALOG_PLATFORM_TOKEN` on **library_catalog** and
   **Board_Game_Catalog** (catalog-platform's own workflow does not need it).
4. First real runs: dispatch from the Actions tab. For §2's pending pair,
   dispatch catalog-platform with `target=all` (or index-worker then
   heygabi-home — never heygabi-home alone first).

## 2. Visibility-scoped + anonymous search (B2) — ✅ DEPLOYED LIVE 2026-08-14

(The pair shipped together — index Worker migration 0003 + wrangler deploy, and the
Pages site — and was verified live: tokenless /api/search returns 200 with
scope ["audiobook"]. The section below is the build record.)

**Asked 2026-08-13** (owner-approved a+b), built the same day on `main`.
Estate design §4.5 is the contract; `index-worker-design.md` §9 Q3's
amendment names the carve-out.

- `/api/search` scopes to the caller's effective visibility set — in the SQL
  (`search-route.ts`), so out-of-scope rows never reach ranker, universe
  counts, or wire. Anonymous/invalid-token/pending ⇒ `{audiobook}`; revoked
  ⇒ `{}` (200 + `reason: no_catalogs_visible`, never 401). `/api/lookup`
  members-only untouched; `/api/universe` members-only, rows scoped.
- `estate_cache` carries visibility WITH status (migration **0003**, applied
  locally; remote apply is the dispatcher's). `@platform/estate-auth` gained
  `postSeenAnswer`/`Catalog`/`parseVisibility` — additive, `postSeen` and app
  consumers untouched.
- `find.js`: signed-out live-search of the audiobook slice with a quiet
  "sign in to search everything" affordance; scope note under partial-scope
  results; universe view still asks for sign-in.

**Pending (dispatcher, one step):** deploy the pair together — index Worker
(`apps/index-worker`: `npm run db:migrate` for 0003, then `wrangler deploy`)
**and** Pages (`sites/heygabi-home`) — a new find.js against the old Worker
would send tokenless searches into 401s. Verify after: tokenless
`GET https://index.heygabi.ai/api/search?q=dune` → 200 with
`"scope":["audiobook"]`.

## Done 2026-08-14 — audiobook members migrated; apex Admin affordances

- **All audiobook Firebase Auth accounts migrated into the estate directory**
  (owner ask). 10 accounts exported; 8 new rows inserted as **pending**,
  audiobook-only visibility, origin 'seed:audiobook'. Pending on purpose:
  the library posture auto-grants 'reader' to any APPROVED member, so
  approving at migration time would have silently granted app access —
  the Approve button on /admin is the deliberate grant moment.
- **Approver-only Admin link on the apex** — find.js probes GET /estate/users
  (a 200 IS the approver fact) and shows 'Admin' in the signed-in chip.
- **/admin sign-in flash fixed** — button ships hidden, neutral until
  watchAuth's first callback, 8s backstop (find.js's rule, applied).
- Commit 8b15d7c; deployed to Pages; all three verified live.
- Next owner-facing idea on file: deep-links from person surfaces in each
  catalog to /admin (see-someone-then-grant). Not ordered yet.

## In flight 2026-08-14 — /admin sort & filter (owner ask)

Sort + filter the estate member list: by estate status, approver flag,
per-catalog visibility (who can see what), and per-app role (who is an admin
where). All client-side — the page already holds the directory + both apps'
federated rosters. Dispatched same day.

## Discord bot — option space (design doc on file)

Design doc: [`docs/info/discord-bot-design.md`](info/discord-bot-design.md)
(2026-08-14, no code yet). Builds on `audiobook_catalog/docs/info/
discord-poll-sync-research.md` (bot mechanics: Ed25519 interactions endpoint,
token custody, per-server invite, identity linking). Recommended first
three: (b), (a), (d) below.

- (a) Two-way poll voting — buttons sync votes with club polls both ways. **M**
- (b) `/have` or `/shelf` — "does the estate have this book?" via the index
  Worker's search, scoped `{audiobook}` for strangers / member visibility for
  linked+approved users. **S–M**
- (c) New-additions feed / `/recent` / rich shelf embed — browse what's owned,
  driven by `additions_log.json`. **S (feed/`/recent`), M (rich embed)**
- (d) Club RSVP via buttons — ties to the shipped meeting scheduler. **M**
- (e) `/progress` — reading-progress updates from Discord, identity-linked
  writes via service account. **M–L**
- (f) Meeting reminders with snooze/RSVP actions. **M**
- (g) Community-stats digest posts to a channel. **S–M**
- (h) `/suggest` — TBR suggestions from Discord, identity-linked writes. **M**
- P1 `/guessgame` — Discord-native cover-guessing game (proposal). **M**
- P2 `/review` — surface existing book reviews on request (proposal). **S**
- P3 `/universe <name>` — cross-catalog universe showcase (proposal). **S**
- P4 Per-book discussion threads on read-start (proposal, lower priority). **M–L**

## Fable-preferred queue (started 2026-08-14, owner directive)

Agents now run non-Fable by default. Work banked here genuinely benefits from
Fable and waits for the owner to release it (e.g. after a weekly reset):

1. **SSO build, phases 1-4** (sso-design.md) — service-account signing, estate
   cookie sessions, per-surface adoption. Awaiting the owner's go on the design
   regardless (it overturns the no-central-cookie rule).
2. **Rules tightening deploy (club permissions 0b)** — deny manager writes on
   unclaimed clubs once every active club is claimed. Precondition-gated.
3. **Edit-audit phases A2/A3** (edit-audit-design.md §6) — override-aware
   review backfill + CLI key-move warning; guards the shared review store
   against orphaning. Do BEFORE any reviewed audiobook is retitled.
4. Any future Firestore-rules rewrite or estate auth-worker change touching
   verification/secrets.

## The owner's five (picked from the research ideas, 2026-08-14 night)

Prioritized by the owner; rejected ideas removed (dashboard, recap, game
nights, purchase guard, and PWA — all skipped by owner decision. PWA reasoning worth keeping: the owner LIKES the idea, but the site's main job is linking into Google Drive to download m4b files — offline browsing is meaningless when the endgame needs data anyway. Re-pitch only if the site ever gains offline-useful jobs.)

**TONIGHT (non-Fable agents, in flight):**
1. **Estate status page** ("I want to see ALL the pipelines") — apex page:
   every pipeline's last run + freshness (audiobook 8h pipeline, index pushes
   per source, worker healths, site build stamps), red/green at a glance.
2. **Cross-format series completion view** — library site: series ladders
   showing gaps by format and what ANY format would complete.
3. **Backup & restore runbook + backup workflows** — ✅ **BUILT + RUN
   2026-08-14.** `docs/access/backup-restore.md` is the runbook (protect
   inventory across all four repos, D1 Time Travel + export/import, Firestore
   dump/restore, R2's real gaps, what's deliberately not backed up and why).
   `.github/workflows/backup.yml` (manual dispatch, `d1`/`firestore`/`all`)
   exports **all four** D1 databases — library-catalog, board-game-catalog,
   index_catalog, estate_auth — from THIS repo alone, by database ID (proven
   interactively: no wrangler.toml needed), because `Board_Game_Catalog` is a
   PUBLIC repo and a GitHub Actions artifact there is downloadable by any
   signed-in GitHub account, not just collaborators — unacceptable for a
   database dump. `scripts/backup-firestore.mjs` (+ its restore companion
   `scripts/restore-firestore.mjs`, dry-run by default) walks every Firestore
   collection/subcollection recursively via the existing service account —
   no GCS bucket, no gcloud infra. **Proof run** (workflow dispatch
   `31855147930`): all 5 jobs green, artifacts downloaded and verified —
   4 non-empty `.sql` exports (5.8 KB estate_auth to 3.8 MB board-game-catalog)
   + 1 Firestore dump (56 collections, 1,294 docs, matching the local
   pre-flight run exactly). Named gap, closed the next night (2026-08-15):
   R2 `library-covers` had no backup path — `wrangler r2 object list` still
   doesn't exist, but the plain Cloudflare REST API (Bearer-token auth, no
   S3 keys) has always had list+get for R2 objects, and the existing
   `CLOUDFLARE_API_TOKEN` already carries enough permission to use it.
   `scripts/backup-r2.mjs` + `backup.yml`'s new `r2` job back up
   `library-covers` (208 objects/20.6 MiB), `audiobook-covers` (1,868
   objects/240.4 MiB), and `game-covers` (922 objects/118.8 MiB, a bucket
   created AND actively populated the same night by a second agent on the
   covers-consolidation plan). Full details + restore commands:
   `docs/access/backup-restore.md` §6/§8.
4. **Covers consolidation — research + inventory tonight** — count the
   third-party hotlink tail, size the R2 rehost, write the execution plan.

**TOMORROW:**
5. **Universes page on the apex** — after the status page lands (same repo
   surface); one page per universe across all three catalogs via the index.
6. **Covers consolidation — execution** — per tonight's plan, attended. Plan:
   `docs/info/covers-consolidation-plan.md` — 506 `item.thumbnail_url` rows /
   1,124 distinct URLs across item+edition, 13 hosts, 0/78 sampled dead,
   ~110–230 MB; new `game-covers` R2 bucket at `gamecovers.heygabi.ai`;
   CSP prune is the last step, gated on a zero-rows verification query.

## ⚠️ Covers migration — ONE ordered finish step (2026-08-15)

Migration itself is DONE (1,123/1,124 rehosted to gamecovers.heygabi.ai; the
one refusal is a 7.3MB Shopify file over the size ceiling, row left on its
original URL on purpose). Intake hooks live. Rollback snapshots committed in
the games repo. Remaining, IN THIS ORDER:
1. The games index push must land with the new cover URLs. The push-token
   pair was rotated FRESH on both workers (the agent-printed token is dead —
   never use a token that has appeared in any transcript). The push fires on
   the next real games item mutation OR the 24h staleness backstop
   (~03:46Z). VERIFY on heygabi.ai/status (game source pushed_at advances)
   or index /api/health.
2. ONLY THEN deploy heygabi-home (the CSP prune is already committed in
   _headers): npx wrangler pages deploy sites/heygabi-home/public
   --project-name heygabi-home. Deploying before step 1 blanks apex-search
   game thumbnails (CSP excludes old hosts while index still serves them).
3. Verify: apex search a game, thumbnail loads from gamecovers.heygabi.ai.
Nothing is user-visibly broken meanwhile — old hotlinks still serve under
the still-deployed old CSP.

## Queued behind the Cosmere batch (owner, 2026-08-15)

1. **Generalize the Cosmere treatment estate-wide**: for every universe and
   series, apply the same logic just exercised on Cosmere — matcher
   completeness (no member left unflagged by a spelling quirk), series-blank
   via the corrections layer where a 'series' is really a universe umbrella
   (non-destructive, owner's exclusion-list rule), spelling fixes through the
   series canon. Same propagation chain.
2. **Full orphan sweep (AI judgment, Opus)**: read all three catalogs like a
   librarian and find every book/game that BELONGS in a series or universe
   but isn't attached — missing series fields, universe members the matchers
   miss, series spelled into isolation. Verdict table like the fuzzy-match
   sweep (confident fixes applied via the proper instruments; ambiguous rows
   reported); before/after counts.
