# TODO — catalog-platform (ACTIVE work log)

> **Split 2026-08-16** per the global "Access & information docs" rule:
> `TODO.md` is **ACTIVE ONLY**, [`DONE.md`](DONE.md) is the dated archive
> (newest first, **append-only**), and durable reference belongs in
> [`info/`](info/README.md) / [`access/`](access/README.md), findable by topic.
>
> Twelve finished sections moved out — including two that had drifted into
> **contradicting each other**: the estate API testing suite appeared once as
> "✅ DONE" near the top and again as "queued next" at the bottom. Both are
> archived; the later one is marked as the superseded duplicate.
>
> ⚠️ Sections moved **whole — cut and paste, never summarised**, because the
> summary always drops the *why*.
>
> ⚠️ An archive is not a competing living doc. Do not re-merge it here.

## 0. 🤖 GABI Discord bot — LIVE 2026-08-16; the build queue that follows

State: registered (**GABI**, id `1538775435880562758`), worker deployed at
`discord.heygabi.ai` (health all-green), **invited to the owner's server with
the moderator permission bundle** (`1116825807878` — deliberately NOT
Administrator; blast-radius reasoning in `access/discord-bot.md` and the
2026-08-16 conversation; widening later is a role toggle, never a re-invite).
Interactions Endpoint URL save: owner's click, unconfirmed until interactions
arrive.

Queue, in intended order (all dispatch as OPUS agents per the model-tiering
rule):
1. **Phase 2 — identity-link ceremony**: OAuth2 `identify` → writes
   `discord_links/{discordUserId}` `{slug, displayName}`; until it ships every
   vote click gets the worded "not linked" ephemeral. Design §1.6.
2. **Phase 3 — bot-posted poll messages with buttons** (+ tally refresh /
   close propagation riding `club_announcements.py` cadence). ⚠️ Until this
   ships there is NOTHING votable in Discord — the invite changes nothing
   visible. Set owner expectations accordingly.
3. **Slash commands** — register via the API (`/have` first, anonymous
   audiobook-scope default per design §4 decision 4).
4. **Moderation features** — SCOPE DECIDED by the owner 2026-08-16:
   **timeouts and message cleanup**, nothing else (no auto-responses, no
   scheduled sweeps — not declined forever, just not in scope now). Design
   doc still comes first, but it designs exactly these two:
   - `/timeout <user> <duration> [reason]` — invokable only by members who
     hold Discord mod permissions THEMSELVES (mirror the caller's authority,
     never let the bot amplify a non-mod), worded confirmations, audit line.
   - `/cleanup <count|user|contains>` — bulk delete with rails: hard cap per
     invocation, Discord's own 14-day bulk-delete API limit surfaced in
     words (not a silent partial), preview-then-confirm for anything big.
   Also from the same conversation: Interactions Endpoint URL is SAVED
   (Discord's probe passed at save time) — the endpoint is verified live.
   ⚠️ **KILL-SWITCH CONTRACT (owner order, same evening):** moderation ships
   DARK. `MODERATION_ENABLED = "off"` is already declared in wrangler.toml;
   every moderation code path MUST check it and answer a worded "switched
   off" ephemeral until the owner flips it — the flip is his evidence-gated
   step (shadow-first idiom), never part of a deploy. The bot's mod-bundle
   server permissions stay granted but unconsumed; if the owner wants zero
   latent risk meanwhile, removing them from GABI's server role is one
   toggle and re-granting later is the same toggle.

5. **FUTURE (design seed, logged in library_catalog docs/TODO.md —
   "Sam asks GABI to fix her books"):** a conversational fixer riding the
   library's existing research/apply machinery as an Anthropic tool-use loop,
   acting with HER authority on HER instance only. Not queued; listed here so
   the GABI queue knows its likely next horizon after the viewer.

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

---

## 📌 HANDOFF — 2026-08-16 ~15:45 PDT (Opus → Fable)

**Everything below the line is ACTIVE. What landed today is archived in
[`DONE.md`](DONE.md).** Nothing is in flight; the board is clear.

### Deployed today from this repo

| Worker / site | Version | What |
|---|---|---|
| `estate-auth` | `43a26680` | Revoked-approver gate fix; revocation clears `is_approver`/`is_devops` (migration **0006**, applied `--remote`, 0 rows); the Firestore ladder-role clear; owner rows render as facts |
| `catalog-index` | `befcce25` | ⚠️ `READ_ORIGINS` set explicitly — it was ABSENT, so `readCors` defaulted to the apex alone and **both catalogs were CORS-blocked** from the shared index |
| `heygabi-home` | `b41e1b03` | Status-page fixes (ebook row ×3, labelled Run levers, back arrows), backups graded per-store, `/admin` owner cells, predeploy guard |

### ⚠️ Things worth knowing before touching this repo

- **`npm run deploy:home` is now the routine** — it runs a static check (every
  public `.js` parses, every `.html` structurally sound, tree committed-clean),
  deploys, then fetches the live URLs and asserts each page still serves its own
  markers. `ALLOW_DIRTY_DEPLOY=1` is the deliberate escape hatch.
  ⚠️ `verify:home` fetches **signed out**, so a green run means the shell
  shipped, never that gated behaviour works.
- **Backups grade per STORE, not "newest object anywhere."** A partial
  `backup.yml` dispatch (target input) happened twice on 2026-08-15; under the
  old logic a database could go months unbacked while the row read green.
- **`skymitch9/estate-backups` (the REPO) was deleted 2026-08-16.** ⚠️ The **R2
  bucket of the same name is live and holds every backup** — do not confuse
  them. Backups verified landing that day: 5 runs ever, all successful, newest
  with all 8 store jobs green.
- **Two auth gates had no tests at all** until today; a mutation opened one and
  the whole 126-test suite still passed. `test/gates.test.ts` and
  `test/revoke-clears-powers.test.ts` now pin them. **176 tests.**

### Next here

1. Nothing is blocking. The reactive pipeline (audiobook_catalog) is the queued
   work; this repo is only involved if the status page needs a row for it.
2. **Discord bot** — design doc on file, needs the owner's decisions.
3. ~~Sub-item 1 — the apex `/universes` page~~ — ⚠️ **CORRECTED 2026-08-16:
   it is BUILT and LIVE** (heygabi.ai/universes, "tap one to see its books,
   audiobooks and games together... sourced live from the shared index").
   The previous line here said "still unbuilt" — written without checking,
   the exact mark-done failure recorded the same day. Both sub-items are done.

---


## 📖 TBR should span all catalogs, the way "read" does (owner ask 2026-08-16)

> *"tbr like read should span all catalogs"*

**Recorded, not started.** Sits with the two entries below it — this is the
same question they are, arrived at from the reader's side rather than the
architecture's.

**What exists today, measured 2026-08-16:**

| Concept | Where it lives | Spans catalogs? |
|---|---|---|
| Reviews + ratings | ONE shared Firestore store, keyed by `bookIdFromTitle` — audiobook and library both write it | ✅ yes, already |
| "read" / reading state | `PUT /works/:id/reading` (`trackReading`), library only | ❌ library's own table |
| **TBR** | Only inside audiobook **book clubs** — a club's Current Read and TBR list | ❌ per-club, not per-person |
| Wishlist | Per catalog (`suggestWishlist` / `manageWishlist` in both library and games) | ❌ separate lists |

So there is a precedent that already works — the shared review store proves a
per-person fact CAN span catalogs — and TBR is the one that most obviously
should follow it: what someone intends to read next does not care whether the
copy is an audiobook, an ebook or a paperback.

⚠️ **The design question this forces, and why it is worth answering once:**
TBR is a **per-person, per-WORK** fact, while every catalog is organised around
**copies**. "I want to read *Wintersteel*" is one intention, even when the
household holds it in three formats. So a cross-catalog TBR needs the same
identity key the reviews already use, NOT a row in each catalog — otherwise
finishing the audiobook leaves the paperback still on the list.

⚠️ **This is the same seam as the ebooks question below.** Shared-pool formats
(audio, ebook) versus owned copies (physical, games) is the split; a spanning
TBR is what it looks like from the reader's side. Decide them together, and
consider whether "read", wishlist and TBR are three names for one per-person
state machine (want → have → reading → read) rather than three features.

**Games:** "all catalogs" plausibly includes a to-PLAY list. Ask before
assuming — it may be the same feature or a deliberately different one.

### ⚠️ SCOPE NARROWED by the owner, 2026-08-16 — read this before building anything above

> *"lets more or less exclude games unless we design a feature thats worth
> adding to it. for now my friend wants to sort her books"*

Two corrections to everything written above, and the second is the important one:

1. **Games are out of scope** for the federation, the cross-catalog TBR and the
   ownership join — unless a feature turns up that is genuinely worth adding to
   games on its own merits. Do not carry games through these designs "for
   symmetry"; it doubles the surface for a use case nobody asked for.

2. ⚠️ **The actual requirement is "she wants to sort her books."** That is not
   the federation, not "who owns what", not a spanning TBR. Those are things
   the OWNER finds interesting about the estate; they are not what the person
   with the books needs. **Build the small thing first.**

**What "sort her books" actually needs, in order:**

| Need | Status today |
|---|---|
| Get her books INTO a catalog without a terminal | Scanning exists and is field-proven; the remote/non-technical ingest story is the real gap |
| Details filled in without her chasing them | The hourly auto-sweep landed for games 2026-08-16; **library is the queued twin and is what she actually needs** |
| Browse/sort by series, author, what's missing | Already the library app's strongest feature — series ladders, gaps, sorting, filters |

So most of what she needs **already exists**; the missing piece is ingestion for
someone remote and non-technical, plus the library details sweep.

⚠️ **Do NOT start with the shared index join.** "See who owns what" is a
SECOND-phase want, and it is cheap to add later precisely because a separate
instance is already an index source. Building the join first would mean
designing a federation for a catalog that does not yet have any books in it.

## 📚 Ebooks may want to be their OWN site — the ownership boundary is per-FORMAT (owner insight 2026-08-16)

Raised mid-conversation and **not yet decided** — recorded because it reframes
the federation question above rather than adding to it.

> *"we might need to now make ebooks its own site because we all share ebooks
> like we do audiobooks but physical books obviously belong to someone"*

**Why this is the sharp observation:** this estate has been splitting catalogs
by MEDIUM (audiobooks / books / games), and the owner has just pointed out the
split that actually matters is by **ownership model**:

| | Shared by the household | Belongs to one person |
|---|---|---|
| Audiobooks | ✅ already its own site | |
| **Ebooks** | ✅ **behaves like audiobooks** | |
| Physical books | | ✅ a specific copy on a specific shelf |
| Board games | | ✅ (a physical copy, though played together) |

Ebooks currently live INSIDE the physical library catalog — `site/ebooks.json`
is produced by the audiobook pipeline's step 1b and imported by
`library_catalog`. So a shared-by-everyone format is stored inside the one
catalog whose entire premise is "who owns this copy".

⚠️ **This is exactly the question the second-household federation runs into.**
"See who owns what" is meaningful for physical books and games, and close to
meaningless for ebooks and audiobooks — those are "do we have it", not "whose
is it". Deciding the ebook split FIRST would likely simplify the federation,
because it separates *the shared pool* from *the per-person shelves* before two
households ever have to be joined.

**Not a build yet.** Open questions, in the order they need answering:
1. Does an ebook site mean a new catalog, or a VIEW over the shared index?
   (The index already exists and already spans catalogs — a new Worker may be
   the expensive answer to a question a query answers.)
2. What happens to `library_catalog`'s existing ebook rows — move, mirror, or
   leave and re-point?
3. Does the shelf server change shape? It serves audiobooks by URL today;
   ebooks are the same *kind* of thing.
4. Who is the ingest owner once ebooks leave the physical catalog — step 1b
   still produces the manifest.

## 🤝 A second household's library, federated with ours (owner ask 2026-08-16)

**Deferred by the owner the same day it was raised — "do the next catalog
later" — recorded now so it is not lost.**

The ask: *"I want to make a site for my friends library and then link it to
mine so we can see who owns what. but she's less technical and doesnt live near
me, they need a much better automated solution."*

Three constraints that make this NOT just "deploy another copy":

1. ⚠️ **She is less technical.** Every operational assumption this estate rests
   on — a pipeline on a home machine, wrangler from a laptop, reading a runbook
   — is unavailable. Whatever is built has to run without her ever seeing a
   terminal.
2. ⚠️ **She is not local.** No shared LAN, no "I'll set it up on your machine",
   no physical access to fix a stuck box. Remote-first from day one.
3. **The point is the JOIN, not the copy.** "See who owns what" means the two
   catalogs must be comparable — which is what the shared index
   (`index.heygabi.ai`) already does across our three catalogs, and is the
   obvious foundation rather than a new mechanism.

⚠️ **Do not start this by cloning a repo.** The interesting design question is
the automation and the ownership boundary (her data, her account, her control,
our shared view), and answering that first will change what gets deployed.
Related: the combined-site architecture already sketched for our own three
catalogs.

## 🔒 Revocation should clear the flags, not just the status (audit finding, 2026-08-16)

**Found by the testing audit** ("useful test not just bulk") and **half-fixed
the same day.** `decideStatus()` revokes by setting `status = 'revoked'` and
deliberately leaves `is_approver` / `is_devops` untouched. That was survivable
only because both gates now check status — but it means the *flag outlives the
status*, and every future reader of that row has to remember the gate is what
saves them.

⚠️ **The gate fix already shipped** (`middleware/auth.ts`, `approverAllows()` /
`devopsAllows()`, both requiring `status === 'approved'`, 14 tests in
`test/gates.test.ts`, deployed as version `d043a337`). This item is the
**defence in depth**, not the fix.

**What is left:** clear `is_approver` and `is_devops` in the same statement
that sets `status='revoked'`, so a revoked row carries no live-looking
privilege at all. Also decide the re-approval story — restoring someone should
NOT silently hand back an approver flag they used to have, which is exactly the
access-*increasing* direction the global rules say to confirm rather than
assume.

**Why it is filed rather than done:** it changes stored data and wants a
migration for existing rows, and the risk is asymmetric — a bad UPDATE here
strips real people's access. Small, but it needs its own careful pass.

**Verification when it is built:** the live directory currently holds 3 flagged
accounts, all `approved` (both owners + Justin), and 0 revoked — so a migration
touches nothing today. Re-check that before running it, not after.

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

---

## ✅ Fable-preferred queue — RELEASED 2026-08-16 (kept for the reasoning)

⚠️ **This queue is no longer in force.** It existed only while the Fable weekly
meter was near its cap; the memory that carried it said in its own words that it
was "TEMPORARY — a usage-cap workaround, not a standing rule" that lapses at the
weekly reset. Measured 2026-08-16 16:06 local: Fable **0%**, all-models **0%**.
The memory file has been deleted per those terms, and work no longer needs to
wait for a Fable window.

The original entry follows, because the reasoning about which work suits which
model is still useful even though the rationing is over.

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

---

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

---

## ✅ Covers migration — FINISHED, verified 2026-08-16

**All three steps are done.** Verified rather than assumed, because the owner
asked for this to be picked up and the honest answer turned out to be "it
already happened":

| Step | Evidence |
|---|---|
| 1. Games index push lands with new cover URLs | `board-game-catalog` D1: **507 items on `gamecovers.heygabi.ai`, 330 with no cover, ZERO on any other host.** The index pushed **837 rows at 08:19:56Z** on 2026-08-16 — 507 + 330 = 837 exactly, so the push carried the migrated set |
| 2. Deploy heygabi-home (CSP prune) | Live CSP `img-src` names `gamecovers.heygabi.ai` and no old hosts. Shipped repeatedly on 2026-08-16 |
| 3. Apex search shows a game thumbnail | ✅ **VERIFIED BY THE OWNER, 2026-08-16** — *"yes covers are showing up in global search"* |

⚠️ **The ordering hazard did not bite, and it was close.** The note warned that
deploying step 2 before step 1 blanks apex-search game thumbnails, because the
pruned CSP excludes the old hosts while the index still serves them. heygabi-home
was deployed eight times on 2026-08-16 for unrelated work — but the games push
landed at **08:19Z**, hours before the first of those deploys. Correct order by
luck, not by design. If a future migration carries the same warning, check the
push timestamp BEFORE deploying rather than after.

✅ **Step 3 confirmed by the owner the same day.** It could not be checked from
this session and was not guessed at: anonymous search returns **zero game rows**
by design (the visibility narrowing rule — an anonymous caller sees the
audiobook source only), so the only instrument that could answer it was a
signed-in pair of eyes. The owner looked and reported covers loading in global
search.

**The migration is now closed end to end** — every step either measured or
confirmed by someone who could see it. Nothing here is outstanding.

The one deliberate refusal from the migration stands: a 7.3MB Shopify file over
the size ceiling, left on its original URL on purpose — it is among the 330
without a rehosted cover, not a failure.

<details>
<summary>The original ordered instructions, kept for the record</summary>

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

</details>

---

## Queued behind the Cosmere batch (owner, 2026-08-15)

0. **Search normalization (owner proposal, adopted)** — ✅ **PHASE 1 BUILT
   2026-08-15**: search improvements must reach EVERY search bar — today
   only the apex consumes the shared index, so tiers like universe-name
   search die at one site. §0.1–§0.4 below are the build record; §0.5 is the
   adoption plan for what's left, sized rather than assumed.

### 0.1 The component

`sites/heygabi-home/public/assets/estate-search.js` — `<estate-search>`, a
framework-agnostic custom element (Shadow DOM, no build step, `customElements
.define`), find.js's whole behavior turned configurable. Extraction was
verbatim where the logic was already tested by hand (ranking groups, keyboard
nav, the debounced-abortable query pattern, the sign-in flash fix) — nothing
about the search itself changed, only where it lives.

**Config — attributes (kebab-case), each mirrored by a same-name camelCase
property:**

| Attribute | Values | Default | Does |
|---|---|---|---|
| `index-url` | any origin | `https://index.heygabi.ai` | the index Worker to query |
| `source` | `all`\|`audiobook`\|`library`\|`game` | `all` | scope preset → `&source=` on `/api/search` (§0.2); NARROWS the caller's own visibility, never widens it |
| `auth` | `authless`\|`authed` | `authless` | authless: tokenless forever, zero Firebase cost, nothing imported. authed: find.js's neutral-boot/sign-in/bearer pattern |
| `auth-module` | a module path | sibling `estate-auth.js` (`import.meta.url`-relative) | where `auth="authed"` dynamically imports its adapter from — never a static import, so authless embeds pay nothing |
| `min-chars` | int | 2 | query length before a search fires |
| `debounce-ms` | int | 250 | debounce delay |
| `placeholder` / `placeholder-authed` | text | find.js's own copy | input placeholder, signed-out/authless vs signed-in |
| `sign-in-label` | text | "Sign in to search everything" | the sign-in button's text |
| `hint` | text | find.js's own copy | the helper line; pass `""` to hide it, omit the attribute to keep the default |
| `universes` | `true`\|`false` | `true` | show the cross-catalog "Universes" group + "everything in X →" follow-ups |

**Config — JS-only properties** (no attribute can carry a function/object):

- `.intakeFilter(data, { kind: 'search'|'universe' }) → data` — the per-site
  INTAKE FILTER hook: runs on every parsed response before render, so a host
  can narrow further (e.g. drop non-local entries out of a same-work group)
  without forking the component.
- `.authAdapter = { watchAuth, idToken, signIn, signOutUser,
  handleRedirectResult }` — set directly to skip the dynamic import (a React
  app that already has an estate-auth-shaped module loaded).

**Events** (`bubbles: true, composed: true` — cross the shadow boundary):

- `estate-search:auth` — `detail: { user, resolved }`, authed mode only.
- `estate-search:select` — `detail: { url, hit }`, **cancelable** — fires
  instead of the default `window.open(url, '_blank', 'noopener')` on any
  result open (click or Enter). `preventDefault()` to hand navigation to an
  SPA router instead — this is the hook library/games will need (§0.5).

**One extension point for opinions the component must NOT hold:** a light-DOM
child carrying `slot="who-extra"` inside `<estate-search>` renders after
"Signed in as … · sign out" in the signed-in state. The apex uses this for
its approver-only Admin chip (`assets/apex-admin-link.js` — the extracted,
unchanged probeApprover() logic) instead of teaching the shared component
what "Admin" is.

### 0.2 What the server gained

`apps/index-worker/src/search-route.ts`: `GET /api/search` accepts an
optional `source` param — `audiobook`\|`library`\|`game`\|`all` — that
INTERSECTS with the caller's own visibility from `searchScope()`, never
widens it. A stranger requesting `source=game` gets an honest empty (`scope:
[]`, no `reason` — this is not §4.5's account-level `no_catalogs_visible`,
it's "you asked for a shelf you cannot see", answered the same shape as a
zero-match query). An unrecognised value is `400 invalid_source`. The
response's `scope` field now reflects what was ACTUALLY searched after
narrowing, not the caller's raw visibility — universe counts inherit this for
free, same as before. 5 new tests in `test/search.test.ts` (narrows a full
scope; narrows-to-nothing outside visibility; `source=all` ≡ no param;
400 on garbage); **70/70 tests pass, typecheck clean.** Deployed with
`wrangler deploy` (index-worker) — no migration needed, additive query param
only.

### 0.3 Apex adoption — verified live

`sites/heygabi-home/public/index.html`'s `#find` section now embeds
`<estate-search id="find-search" auth="authed" hint="…">` (the `hint`
attribute and defaults reproduce find.js's copy verbatim — no attribute
overrides needed beyond `auth` and `hint`) with the Admin chip as its
`slot="who-extra"` child. `assets/find.js` is deleted (dead code — nothing
imported it, confirmed by grep before deletion); `assets/estate-search.js` +
`assets/apex-admin-link.js` replace it. The `.find-*`/`.hit*` CSS block in
`index.html` is gone (it now lives in the component's own scoped `<style>`,
reading the same `--et-*` tokens so it re-skins with every theme unchanged);
`index.html` keeps only `#find`'s section spacing and the slotted Admin
link's own small style block, since `::slotted()` can't reach that deep.

Deployed: `npx wrangler pages deploy sites/heygabi-home/public --project-name
heygabi-home`. **Review link: https://heygabi.ai** — try: (1) type 2+
characters signed out, confirm audiobook-only results with the "Searching
audiobooks only. Sign in to search every shelf." note; (2) sign in, confirm
the box widens and the Admin chip appears if you're an approver; (3) ↑/↓/
Enter/Escape still walk and open results; (4) a universe hit's "everything in
X →" still asks for sign-in when signed out. Behavior is pixel/behavior-
identical to find.js's — the same markup shape renders inside the shadow
root, same CSS custom properties, same copy.

### 0.4 Tests

- `apps/index-worker/test/search.test.ts`: 70/70 (5 new for `source`), plus
  `npm run typecheck` clean.
- The component itself ships no automated tests (browser-only custom element,
  no existing JS test runner in `sites/heygabi-home` — same as find.js before
  it, which also had none; this is an existing gap, not a regression).
  Verified by hand against the review link above.

### 0.5 Adoption plan for what's left (sizes, not code)

Researched 2026-08-15 (read `CollectionPage.tsx` + `router.tsx` + `api.ts` in
both React apps, and `audiobook_catalog/site/index.html`'s inline filter
block) before sizing, rather than assuming.

**library_catalog + Board_Game_Catalog (React, `apps/web`) — size M each,
same shape (the "structurally identical" property from §1.1 holds here too):**

- Both apps' own collection search (`CollectionPage.tsx` — 739 lines library,
  399 games) is SERVER-SIDE against `/api/collection?q=…`, filtering their
  OWN catalog's rows with facets/pagination `<estate-search>` cannot
  replicate — that stays exactly as it is. `<estate-search>` is ADDITIVE: a
  header/nav-level "search the whole estate" box, not a replacement.
- ⚠️ **Neither app uses `react-router-dom`** — both ship a **hand-rolled
  ~20KB pushState/replaceState router** (`router.tsx`). A wrapper assuming
  `useNavigate`/`<Link>` would be wrong; it must call this repo's own
  `navigate()`-equivalent from the `estate-search:select` handler instead.
- The wrapper itself: a thin React component (ref to the custom element,
  props → attributes, `intakeFilter` passed as a property not an attribute,
  `estate-search:select` listened to and `preventDefault()`ed to route
  through the local router). Sync machinery is close to mechanical —
  `sync-estate-theme.mjs`/`sync-estate-auth.mjs` are the exact precedent for
  a `sync-estate-search.mjs` copying `estate-search.js` (+ `estate-auth.js`
  if `auth="authed"` is wanted here too) into the build.
  ⚠️ **library_catalog materializes into `apps/web/public/estate/`;
  Board_Game_Catalog's existing estate assets sit under `apps/web/public/
  assets/` instead** — confirm which convention before writing the sync
  script for games, rather than assuming it matches library.
- `auth="authed"` here would need each app's OWN sign-in wired as the
  adapter (or reuse of the shared Firebase project's session — the estate
  design already assumes one Firebase project estate-wide) — undecided,
  flag for the dispatcher.

**audiobook_catalog (vanilla, `site/index.html`) — size S:**

- Its own filter (the ~860-line inline block, `_buildSearchCache`/
  `_applySearch`) is CLIENT-SIDE substring search over the already-rendered
  table/card grid across every column (title, series, series#, author,
  narrator, year, genre, duration, rating) with sort/pagination on top —
  genuinely a different job (its OWN columns) and STAYS, per the owner's own
  framing of the split.
  `<estate-search>` is close to a real drop-in here: no framework to bridge,
  `<script type="module" src=".../estate-search.js">` + the tag, DOM events
  straight through — the "do we own this anywhere across catalogs" box the
  site does not have today (confirmed: no existing cross-catalog search
  there; it only PUSHES to the index via `app/index_push.py`, never queries
  it). Likely placement: a small "search the whole estate" affordance
  alongside the existing table, `source="audiobook"` NOT set (the point is
  reaching the other two shelves, which this table cannot show).

**`/universes` page (`sites/heygabi-home/public/universes/`) — size S,
tomorrow's item per §5 below:**

- ✅ **BUILT 2026-08-15** — see "Four owner-ordered upgrades" below. The
  swap happened exactly as sized here: `<estate-search universes>` embedded
  as the page's own search entry point, the hand-rolled expand/collapse
  browse view (`universes.js`) kept as-is underneath it.

**Cross-cutting note for the dispatcher:** every non-apex site currently gets
`source`-scoped searches from ANONYMOUS visibility `{audiobook}` only
(§4.5) — an authless `source="library"` or `source="game"` box returns
empty, always, by design (§0.2's narrowing rule). Only audiobook's box is
useful authless out of the box; library/games need `auth="authed"` wired
before their own-shelf scoping does anything, which is real new work, not
config.

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
