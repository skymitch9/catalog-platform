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
