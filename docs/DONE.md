# DONE — catalog-platform (dated archive)

> **Audience:** Claude sessions. **Status:** TRACKED. Created **2026-08-16**
> by splitting a 778-line `docs/TODO.md`.
>
> ⚠️ **Archive, not a living doc. APPEND ONLY.** Nothing here is ever edited
> or re-summarised. An item arrives once, at completion, moved whole from
> [`TODO.md`](TODO.md).
>
> Newest first, preserving the order the entries had in the original file.
> ⚠️ The last entry is a **duplicate**: "Estate API testing suite" was written
> twice, once as done and once as queued. Both are kept verbatim rather than
> silently reconciled — which of the two a later reader trusts matters, and
> deleting one would hide that the work log had disagreed with itself.

## 🔒 Revocation should clear the flags, not just the status (audit finding, 2026-08-16)

*Landed here 2026-08-17 by the docs hygiene sweep — the "what is left" half SHIPPED the same day it was written and the section never moved. VERIFIED in the tree 2026-08-17: `apps/auth-worker/src/estate-db.ts:128` appends `, is_approver = 0, is_devops = 0` to the revoke UPDATE, and `migrations/0006_revoke_clears_powers.sql` exists for rows revoked earlier (the 2026-08-16 handoff records it applied `--remote`, 0 rows, deployed as `43a26680`). The re-approval question the item raised is answered by construction — the flags are cleared AT REVOKE and the approve path never sets them — though nobody has exercised a revoke→re-approve round trip against the live directory.*


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

## 1. ⚠️ Three of the four repos deploy only from a human's laptop

*Landed here 2026-08-17 by the docs hygiene sweep — the whole section, §1.5's "Owner checklist (nothing deploys until these exist)" included, is spent. MEASURED 2026-08-17 with `gh`: Board_Game_Catalog's default branch is now **`main`** (checklist item 0); `CLOUDFLARE_API_TOKEN` **and** `CATALOG_PLATFORM_TOKEN` are set on `library_catalog` and `Board_Game_Catalog`, and `CLOUDFLARE_API_TOKEN` on `catalog-platform` (items 1–3); and the first real dispatches all SUCCEEDED (items 4) — library run `31813866238`, games `31814054897`, catalog-platform `31900792359` and `31940834851`. ⚠️ Two facts inside the moved text went stale and are corrected here rather than edited above: the per-repo table's "reaches production by hand" column no longer holds, and §1's "Former open questions" says `library_catalog` and `catalog-platform` are PRIVATE — measured 2026-08-17, **all four repos are PUBLIC**, so the metered-minutes reasoning built on that line no longer applies anywhere.*


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

## 📌 HANDOFF — 2026-08-16 ~15:45 PDT (Opus → Fable)

*Landed here 2026-08-17 by the docs hygiene sweep: superseded by the 2026-08-17 work above (GABI phases 2/3, `/have`, dark moderation, the series registry and `/series`, the soak recorder). Its own "Next here" list is spent — item 1 nothing blocking, item 2 Discord bot LIVE, item 3 already self-corrected. The deploy table and the "things worth knowing" notes are kept whole here; their durable halves live in `access/backup-restore.md` and `info/estate-auth-design.md`.*


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

## 🔎 Search normalization — `<estate-search>` — ✅ BUILT AND ADOPTED ON EVERY SURFACE (2026-08-15 → 2026-08-17)

*Landed here 2026-08-17 by the docs hygiene sweep, moved whole out of `TODO.md`'s "Queued behind the Cosmere batch" (items 1 and 2 of that section are unbuilt and stayed). §0.5's adoption plan is now spent: apex ✅ (§0.3), library ✅ (`apps/web/public/estate/estate-search.js` + `SOURCE-estate-search.txt`, deploy recorded in `3cea4b7`), games ✅ (`32e2ddc`, then `fd1a9b3` "hide the estate search bar (owner order — keep, do not delete)"), audiobook ✅ (`f9e7422` "embed the shared `<estate-search>` component — the last estate surface without it"), `/universes` ✅. Every surface named in the plan has adopted it, so nothing here is queued work any more.*

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

## The owner's five (picked from the research ideas, 2026-08-14 night)

*Landed here 2026-08-17 by the docs hygiene sweep. All six survived to completion and were verified before the move: 1 status page + 5 `/universes` live (the TODO itself corrected "still unbuilt" on 2026-08-16), 3 backups BUILT+RUN, 4+6 covers consolidation closed (see the covers-migration entry), and 2 cross-format series completion shipped in `library_catalog` as `8bd08a9` "Cross-format series completion: the by-format headline" (`apps/web/src/pages/SeriesDetailPage.tsx`). It still read "TONIGHT … in flight" from 2026-08-14.*


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

## ✅ Covers migration — FINISHED, verified 2026-08-16

*Landed here 2026-08-17 by the docs hygiene sweep: closed end to end on 2026-08-16 (every step measured or owner-confirmed), so it was finished work sitting in the ACTIVE board. Moved whole, `<details>` block included.*


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

## 🤖 GABI moderation — `/timeout` + `/cleanup` — ✅ BUILT + DEPLOYED 2026-08-17 (SHIPS DARK, and UNPUBLISHED)

*(Moved whole from `TODO.md` §0's queue, item 2: "**Moderation features** —
SCOPE DECIDED by the owner 2026-08-16: **timeouts and message cleanup**,
nothing else (no auto-responses, no scheduled sweeps — not declined forever,
just not in scope now). Design doc still comes first, but it designs exactly
these two: `/timeout <user> <duration> [reason]` — invokable only by members
who hold Discord mod permissions THEMSELVES (mirror the caller's authority,
never let the bot amplify a non-mod), worded confirmations, audit line.
`/cleanup <count|user|contains>` — bulk delete with rails: hard cap per
invocation, Discord's own 14-day bulk-delete API limit surfaced in words (not
a silent partial), preview-then-confirm for anything big. Also from the same
conversation: Interactions Endpoint URL is SAVED (Discord's probe passed at
save time) — the endpoint is verified live. ⚠️ **KILL-SWITCH CONTRACT (owner
order, same evening):** moderation ships DARK. `MODERATION_ENABLED = "off"` is
already declared in wrangler.toml; every moderation code path MUST check it and
answer a worded 'switched off' ephemeral until the owner flips it — the flip is
his evidence-gated step (shadow-first idiom), never part of a deploy. The bot's
mod-bundle server permissions stay granted but unconsumed; if the owner wants
zero latent risk meanwhile, removing them from GABI's server role is one toggle
and re-granting later is the same toggle.")*

**Shipped:** version `ad35e796-ffd6-44a8-b15e-83bc75bf97ab` at
`discord.heygabi.ai`; commit `b9d10d3`. `src/moderation.ts` (decisions),
`src/mod-actions.ts` (flows). Tests 104 → 161. Runbook:
`access/discord-bot.md` §9.

**The kill-switch contract, honoured literally.** `MODERATION_ENABLED` is read
affirmatively — `"on"` and nothing else, so `"true"`, `"1"`, `"yes"` and every
typo fail CLOSED, pinned by a test that names each. The check is **first** on
every path, before permissions, before parsing, before any I/O, so a
switched-off bot performs no network call and reveals nothing about who holds
what permission. Each flow re-checks it a second time, deliberately
redundantly: a moderation path guarded by exactly one gate is one refactor away
from being guarded by none.

**Mirroring the caller, never amplifying them.** `/timeout` requires the CALLER
to hold `MODERATE_MEMBERS` and `/cleanup` requires `MANAGE_MESSAGES`, read from
the interaction payload's own `member.permissions` (Discord's computed value,
already proven authentic by the Ed25519 signature). `ADMINISTRATOR` implies
both. Every refusal NAMES the permission; a DM is answered as "that only works
in a server", which is a different problem from a permissions refusal and is
worded as one.

**The decisions worth keeping:**

- ⚠️ **REGISTRATION IS A FUNCTION OF THE SWITCH.** While moderation is off, the
  two commands are not published to Discord at all — `commandsFor(env)` returns
  `/link` + `/have` only. Both idioms were defensible and the reasoning is
  recorded in `commands.ts`: `/link` being visible-but-off costs a curious
  person twenty seconds, whereas a visible `/timeout` costs a moderator the
  seconds of an actual incident, and advertises in **every** server GABI is
  invited to (commands are global) a capability the estate deliberately has not
  switched on. The handlers still answer the switched-off ephemeral if an
  interaction arrives, so the contract holds at RUNTIME regardless of what is
  published — which is what makes hiding safe rather than merely quiet.
  **Consequence:** the flip has a documented SECOND step, re-running
  `POST /admin/commands/register`.
- **The confirm button is signed, short-lived and bound.** `/cleanup` previews
  first; the confirm's `custom_id` carries an expiry (2 minutes) and a
  truncated HMAC keyed off the bot token under its own label. The **invoker and
  the channel are associated data** — signed but never transmitted, recomputed
  at press time — which binds "this person, this channel" for free and is what
  keeps the id inside Discord's 100-character ceiling. The confirm **re-reads
  the channel live** rather than trusting a remembered list: two minutes of
  chat may have moved things, and deleting a remembered list would delete
  messages nobody previewed.
- ⚠️ **A real bug the tests caught, and it would have hit exactly one group of
  people.** The `contains` cap was written in CHARACTERS while the custom_id
  carries base64 of BYTES: a 32-character accented filter produced a
  **115-character** custom_id — 15 over Discord's ceiling, i.e. a confirm
  button that would simply not have rendered, for exactly the users whose
  language uses accents. Now capped at 32 UTF-8 **bytes**, refused in words
  (never truncated — truncation would delete a different set than the preview
  showed), and pinned by a worst-case test.
- **Rails:** a hard cap of **50** messages per run (deliberately half Discord's
  own bulk ceiling — a mis-typed cleanup cannot be undone and nothing about
  tidying is urgent), refused in words rather than clamped; Discord's **14-day**
  bulk-delete limit surfaced as a named leftover, never a silent partial; pins
  never deleted; an unreadable timestamp lands on the SAFE side of the 14-day
  line; a preview with nothing to delete gets **no button at all**.
- **Audit:** `discord_mod_audit`, a top-level collection the Worker owns
  outright — no `firestore.rules` grant exists and the file has no catch-all,
  so browsers are denied by default and the service account bypasses (the same
  posture as `discord_poll_messages`). Pinned by a contract test on the field
  shape and the doc id. ⚠️ Switched-off answers and permission refusals are
  **not** audited: nothing happened, and auditing them would let any member of
  any server fill an estate collection by spamming a command.
- **Discord's own audit log gets a reason header** on every action, so a server
  admin sees "GABI timed out X — spam, by @mod" rather than an unexplained bot
  action.

⚠️ **NOT VERIFIED LIVE, and cannot be while the switch is off:** no timeout, no
message read and no deletion has ever been executed against Discord. Every
Discord call in the moderation path is written, typed and unit-tested against
injected dependencies, and has never run. The first real invocation will be the
first test of role-hierarchy 403s, of the bulk-delete endpoint, and of the
audit write.

## 🤖 GABI `/have` — "is this book on the estate's shelves?" — ✅ BUILT + DEPLOYED 2026-08-17

*(Moved whole from `TODO.md` §0's queue, item 1: "**More slash commands** —
`/link` is registered by `POST /admin/commands/register`
(`access/discord-bot.md` §4); the next is `/have`, anonymous audiobook-scope
default per design §4 decision 4. Add it to `ESTATE_COMMANDS` and re-run the
same route.")*

**Shipped:** version `ad35e796-ffd6-44a8-b15e-83bc75bf97ab` at
`discord.heygabi.ai`; commit `b9d10d3`. `src/have.ts`. Runbook:
`access/discord-bot.md` §9. ⚠️ **Not yet visible in Discord** — publishing is
§4's admin-gated route and needs an estate admin's Firebase ID token, which no
agent holds.

**What it answers.** A worded, **ephemeral** reply listing the works that match
a title/author/series query — title, creator, every format found (audiobook,
ebook), and a detail link each — or a clean no-match. Deferred inside Discord's
3-second window and answered under the 15-minute interaction token, per design
§1.7's "build the deferred path from day one".

**The scope line, which IS the design (§4 decision 4):**

- ⚠️ **The call to `index.heygabi.ai/api/search` carries NO Authorization
  header, and that absence is the decision** — an anonymous caller gets the
  `{audiobook}` slice by the index's own §4.5 rule, which is exactly what
  decision 4 specifies. So the default path needs no credential, and there is
  none here to leak, misuse or accidentally widen. A test asserts the header is
  absent, because this is precisely the thing a well-meaning refactor "fixes".
- **`source=audiobook` is sent anyway, and it is not redundant.** It can only
  NARROW (index `search-route.ts`), so it costs nothing today — but if the
  index's anonymous default were ever widened, `/have` would not widen with it.
  The scope is stated by the command, in one place, not inherited.

⚠️ **The wider scope for linked members is NOT shipped, because it does not
exist to ship.** Measured 2026-08-17 by reading the code, not the design:

1. `index-worker/src/middleware/scope.ts` resolves scope from
   `resolveIdentity()` — a **Firebase ID token and nothing else**. There is no
   app-token path, no on-behalf-of header, no server-to-server widening on
   `/api/search` at all.
2. This Worker cannot mint such a token: Discord's OAuth does not produce one,
   and `firebase-sa.ts` here is deliberately scoped to `datastore` only (a
   recorded credential decision — it does not carry identitytoolkit).
3. Even holding a `/seen` answer — which would need a NEW app-token pair,
   `ESTATE_APP_TOKEN_DISCORD`, minted on auth-worker AND here — there is
   nothing on the index to hand it to.

So a linked member gets the same public slice plus **one honest sentence** that
names what the wider shelves wait on ("the index only widens for a caller
holding a Firebase sign-in, which Discord cannot produce — estate
infrastructure, not a permission you are missing"). Shipping a minted-secret
name for a path with no receiving end would have been theatre, not dark
shipping. **Making it real is two pieces of new estate surface**, and both are
privilege-increasing decisions for the owner, not an agent: the app-token pair,
and an index capability that accepts an app token plus a subject.

**The wording rules, pinned by tests:**

- ⚠️ **Never "you don't own it".** A catalogue is not an inventory — ~100 books
  are unscanned at any time — so a no-match says the *catalogue* has nothing
  close and says outright that an unscanned book looks exactly like this.
- An outage is never dressed as an answer about the book: "a service problem on
  the estate side, NOT an answer about the book."
- More matches than fit are **counted and stated**, never silently dropped.

## 🤖 GABI phase 3 — bot-posted poll messages with vote buttons — ✅ BUILT + DEPLOYED 2026-08-17 (SHIPS DARK)

*(Moved whole from `TODO.md` §0's queue, item 1: "**Phase 3 — bot-posted poll
messages with buttons** (+ tally refresh / close propagation riding
`club_announcements.py` cadence). ⚠️ Until this ships there is NOTHING votable
in Discord — the invite changes nothing visible. Set owner expectations
accordingly.")*

**Shipped:** version `b64be346-876c-4cf0-8365-137afee3536a` at
`discord.heygabi.ai`; commits `92375af` (catalog-platform) and `f9f3ab6`
(audiobook_catalog, pushed to `main`). Tests 77 → 104. Runbook: `access/discord-bot.md` §8.

**What it is.** `POST /polls/sync` on the discord-worker, poked by
`audiobook_catalog/app/club_announcements.py` on the pipeline's existing
~8-hour cadence — the trigger the research doc itself recommended. Per
opted-in club (`features.discordPollVoting === true`) the tick posts a votable
message for each open poll, refreshes its tally, and edits it to a closed
rendering (buttons removed, winner marked, "final" footer) exactly once when
the poll closes.

**The decisions worth keeping:**

- **The buttons REUSE the live `pv|<clubs|clubs_dev>|<clubId>|<pollId>|<idx>`
  grammar exactly.** The posting test parses what the poster emits with the
  LIVE parser, not a copy — a button the vote path could not route would be a
  dead button, and the suite now refuses to ship one.
- **The trigger carries only the LANE.** Every fact the tick acts on is read by
  the Worker with its own service account. Sending club ids or webhook URLs
  would have made the pipeline a second source of truth and put a capability on
  the wire for nothing.
- **Independent failure domains, both ways.** `sync_poll_messages()` runs after
  the announcement pass, catches everything and logs one line — a dead endpoint
  cannot fail a run (pinned by a test). The webhook announcements themselves are
  byte-for-byte unchanged, as design §0 requires.
- **State lives in `discord_poll_messages/{clubCol}__{clubId}__{pollId}`**, a
  top-level collection the Worker owns: not a field beside the poll (that doc is
  browser-writable), not keyed on the bare `pollId` (the two lanes are separate
  universes), and needing no `firestore.rules` change (nothing grants it, there
  is no catch-all, the service account bypasses).
- **Idempotence is keyed on the stored `messageId`** — present ⇒ edit, absent ⇒
  post — so a tick is safe to run twice or by hand mid-cadence. A closed poll
  that was never posted is never posted; a deleted OPEN message is reposted, a
  deleted CLOSED one is left gone.
- **Blast rails:** per-club named skips (never a crash), 429s honouring
  Discord's own `retry_after` bounded to three attempts, a 10-poll-per-club cap
  that states its overflow, and a whole-tick Firestore outage answering as an
  outage rather than a permissions refusal.
- **Ships dark, and dark BEFORE closed:** with `POLL_SYNC_TOKEN` unset the route
  answers a worded 503 even to a caller presenting a bearer token — an unminted
  secret is not the caller's fault, and a 401 there would send someone hunting a
  credential mismatch that does not exist.

**Remaining to switch it on** (`access/discord-bot.md` §8.6): mint
`POLL_SYNC_TOKEN` once, `wrangler secret put` it here, put the same value in the
audiobook pipeline's `.env`, and opt a club in. **Not verified:** no real
Discord message has been posted — that needs the secret minted AND a club opted
in AND GABI holding Send Messages in the target channel. Nor has the
webhook→`channel_id` resolution run against real Discord.

## 🤖 GABI phase 2 — the identity-link ceremony — ✅ BUILT + DEPLOYED 2026-08-17 (SHIPS DARK)

*(Moved whole from `TODO.md` §0's queue, item 1: "**Phase 2 — identity-link
ceremony**: OAuth2 `identify` → writes `discord_links/{discordUserId}`
`{slug, displayName}`; until it ships every vote click gets the worded 'not
linked' ephemeral. Design §1.6.")*

**Shipped:** version `9d496ece-ae58-440f-b6d0-d51ba6143e6d` at
`discord.heygabi.ai`, commit `7ae9137` plus the docs commit that follows it.
Tests 34 → 77.

**What it is.** `GET /link` → Discord's OAuth2 `identify` screen →
`GET /link/callback` → a self-contained page that signs the person in to the
estate's Firebase → `POST /link/confirm` writes ONE doc:
`discord_links/{discordUserId}` = `{slug, displayName, linkedAt,
firebaseUid}`. `POST /link/unlink` deletes it — revocable is part of §1.6's
identity rules, not an afterthought, and its button sits on the same page as
the link button so nobody has to hunt for it. `POST /admin/commands/register`
(estate `admin` only) publishes the `/link` slash command, whose reply is
ephemeral.

**The design decision worth keeping.** A link joins TWO identities, so the
write demands both in the same request. The Discord half is an OAuth code
exchange the browser cannot forge; it crosses from the callback to the
confirm POST inside an **HttpOnly, HMAC-signed, 15-minute cookie**, never in
the page's JavaScript — because a page that knows a Discord user id is a page
that can be edited to submit somebody *else's*, and that is the entire
security of the ceremony. The estate half is a Firebase ID token verified
server-side by `@platform/estate-auth` (project-pinned issuer AND audience).
Neither proof alone writes anything. That is what makes §1.6's "votes are
never guessed from usernames" a mechanism rather than a promise.

**Why it ships dark, deliberately.** `DISCORD_CLIENT_SECRET` is a NEW secret
and only the owner can fetch it. Rather than crash or 500, every route
answers a worded "linking is not configured yet" page naming the exact
remaining step; `/api/health` reports `configured.discord_client_secret:
false` and `link_ready: false` **honestly**, which is how the dark state is
visible from outside rather than inferred from a page nobody loaded. Same
idiom as `MODERATION_ENABLED`.

⚠️ **THE BUG THIS BUILD FOUND, which would have been silent and cruel.**
`poll-vote.ts` validated the link doc's `slug` with the Firestore-auto-id
pattern `/^[A-Za-z0-9_-]{1,64}$/`. But a member slug is
`displayName.toLowerCase()` — measured against
`audiobook_catalog/site/identity.js:765`, which strips nothing, dashes
nothing and transliterates nothing — so nearly every real slug contains a
**space**, and that regex refused it. Left alone, phase 2 would have written
links that phase 1 then declined to read, and every affected voter would have
been told **"you are not linked" while their link doc sat right in front of
the Worker**. Fixed: the slug rule now lives in one file
(`apps/discord-worker/src/slug.ts`) shared by the writer and the reader,
everything reaching a Firestore REST path is percent-encoded, and a
round-trip **contract test** over real display-name shapes ("Sam Vimes",
"Conn O'Neill", "Renée Descartes", an email fallback) pins the two halves
together so they cannot drift apart again. The gotcha is recorded in
`access/discord-bot.md` §7.

**Verified live at deploy (2026-08-17 07:36 UTC):** `/api/health` `ok: true`
with the four original booleans `true` and the two new ones honest;
`GET /link` → **503 + the worded not-configured page** (naming
`DISCORD_CLIENT_SECRET`, the callback URI and the runbook, and never
redirecting into a broken OAuth trip); `POST /link/confirm` → worded JSON
naming a configuration gap, "NOT a permissions problem";
`POST /admin/commands/register` → worded 401 saying how to authenticate; and
critically `POST /interactions` still answering **401 `bad_signature`** to
Discord's invalid-signature probe and **401 `missing_signature_headers`** to
an unsigned POST — the endpoint the portal silently removes on failure is
intact.

**NOT verified, and why.** The full OAuth round trip has never run — it
cannot until the client secret exists, and the code exchange is the one step
no test can stand in for. Also unexercised: the Firestore write and delete
themselves, the Google sign-in on the callback page (which additionally needs
`discord.heygabi.ai` added to Firebase's authorised domains — ⚠️ a subdomain
is NOT covered by its parent), the `site_roles` admin-gate read, and the
Discord command-registration API call. Everything up to the network boundary
is tested; nothing across it is.

**Remaining owner action:** `access/discord-bot.md` §3 step 7 (three clicks),
then §4 to publish `/link`.

## 📚 The apex `/series` page — ✅ BUILT + DEPLOYED + VERIFIED SIGNED-IN 2026-08-17

*(Moved whole from `TODO.md`'s "Series registry — what still hangs off it",
item 1: "**The apex `/series` page** — the reason `GET /api/series` and
`GET /api/series/:slug` exist. The detail endpoint already returns rows grouped
by medium with `source`, `title`, `series_index`, `cover_url` and `detail_url`,
and every search hit now carries `series_slug`, so a result can link straight to
its series with no client-side folding. ⚠️ It is **members-only** (sign-in
required, like `/universes`' data), so the page needs the apex's signed-in
fetch, not an anonymous one. Size S.")*

**The owner's ask, in his words:** *"I want missing books to say you don't have
book 1 but audio and ebook do and Skylar also owns it."* So the page is **not a
list of the rows the index returned** — it is a list of **volumes in number
order**, and the numbers nobody holds are rendered as their own dashed **GAP
rows**. A list of what we own can never show what is missing, and what is
missing was the request.

Live: <https://heygabi.ai/series/> (sign in — the data is members-only).

### What shipped

| Piece | Where |
|---|---|
| The page + its script | `sites/heygabi-home/public/series/index.html`, `series.js` |
| CSP, both forms (the 308 trap) | `sites/heygabi-home/public/_headers` — `/series` and `/series/` |
| Live markers | `sites/heygabi-home/predeploy.checks.json` — `/series/` and `/series/series.js` |
| Nav | `public/index.html` (the Universes cell became `.card.multi`), `public/universes/index.html` (cross-link) |

Commits `32a6f2b`, `f2fd6dc`, `6d41982`. Deploys `1f932b64` then `f40d18c5`
(`npm run deploy:home`; `verify:home` green both times — 11 live pages).

**Structure is `/universes`, near enough line for line** — collapsed rows, a
lazy per-item fetch on first expand, page-local render functions, the same
neutral-boot auth (8s backstop, no signed-out flash), the same theme tokens and
the same back arrow. Duplicated rather than shared, per that page's own header
and this codebase's one-page-one-script convention.

**The transform is the page.** `/api/series/:slug` answers rows grouped by
MEDIUM; `series.js` regroups them by `series_index` (`volumesFrom`), works out
which integers between the first volume and the last nobody holds (`gapPlan`),
and prints each volume as the owner's sentence (`holdingLabel`): *"On audiobook
(shared pool) and Skylar's library (book)."* plus, where a shelf in that series
lacks it, *"Not in Skylar's library."* Source vocabulary → household words:
`library` = Skylar's library, `library2` = Samantha's library, `audiobook` /
`ebook` = shared pool, `game` = games.

**Two honest refusals rather than nonsense:** numbering past 60, or more than 25
gaps, gets a printed note instead of synthesised rows — a `series_index` that is
really a year must not produce 2,000 dashed rows. Unnumbered volumes group last,
in a collapsed `<details>`. Scope is the API's throughout: the page never widens
it, and a gap is worded as *"not on any shelf you can see"*, never as a claim
about a catalog the viewer was not shown.

### ⚠️ What only a real signed-in browser found — twice

The page passed every unauthenticated signal (`check:home`, `verify:home`,
markers, both CSP headers curl-verified) while carrying two real defects. Both
were found by **opening it signed in** — the same lesson the `/admin` role
columns taught the day before.

1. **Dungeon Crawler Carl holds 8 books and 29 game rows under one series
   name**, so *"Not in games."* printed under every novel and *"Not in audiobook
   (shared pool) and Skylar's library."* under every dice bag. The design
   already said why that is wrong — `info/index-worker-design.md` §3.1 gives a
   game `work_fold = NULL` **by design**, because *"a board game is never the
   same work as a book"* and never answers a same-work-in-another-format
   question. A missing-FORMAT claim is exactly that question, so the game/book
   line is now never crossed in either direction.
2. **The same 31 accessories buried the 8-book ladder** — the ladder being the
   point of the page. They moved into a collapsed `<details>`, the same native
   fold and the same class `/universes` uses for the owner's identical complaint
   there.

### Measured live, signed in as the owner, 2026-08-17

| Observation | Result |
|---|---|
| List | **441 series, 1,588 entries**; scope read *audiobook (shared pool), Skylar's library, games and Samantha's library* |
| Complete run | *All the Skills* — books 1–6, each on audiobook **and** Skylar's library; no gaps, no gap note |
| Half-volumes | *The Stormlight Archive* — 1, 2, **2.5** (Edgedancer), 3, **3.5** (Dawnshard), 4, 5, printed as their real `REAL` values rather than rounded |
| The owner's sentence | *Dungeon Crawler Carl* book 4: *"On audiobook (shared pool). Not in Skylar's library."* |
| **The GAP rows** | *The Survivalist Series* — **books 1–5 as dashed "Book N — nobody in the estate has this one"**, then 6–9 held on audiobook, closing with *"5 numbers are missing between 1 and 9 — the dashed rows above."* |
| Filter box | page-local, no network: "storm" → 1 of 441, "survivalist" → 2 of 441 |
| Console | clean — no CSP refusal, no JS error |
| CSP headers | `curl` on **both** `/series` (308) and `/series/` (200) carries `connect-src https://index.heygabi.ai` |

### NOT verified

- **No automated test covers the render.** `node --check` parses `series.js` and
  `predeploy-check` asserts its markers; the volume/gap transform has **no unit
  test** — the repo has no harness for page JS (no DOM, no build step) and one
  was not invented for this. The live signed-in walk above is the evidence, and
  it is a walk, not a suite.
- **`estate-probes` was not extended.** It probes APIs, and the series API
  already gained its own probes (B11–B15) with the registry; no apex page has a
  probe row, because that pattern does not exist.
- **Only ~8 of 441 series were opened by hand.** The gap ceilings
  (`GAP_MAX_INDEX = 60`, `GAP_MAX_ROWS = 25`) never fired on any of them, so
  **the suppression note has never been seen rendering** — that path is
  unexercised in production.
- **The signed-OUT page was never seen.** The owner's browser was signed in
  throughout; the sign-in invitation and the makes-no-fetch path are asserted by
  the markers and by reading the code, not observed.
- **`library2` and `ebook` labels are unexercised** — `/api/health` reports rows
  for `game`, `library` and `audiobook` only. Samantha's library is in the
  owner's scope and contributes no rows yet.
- **Mistborn's volumes render with blank cover frames.** Those rows carry no
  `cover_url` in the index — inferred from other audiobook rows on the same page
  rendering covers from the same host, **not** confirmed against the data.

## 📚 The estate SERIES REGISTRY — ✅ BUILT + DEPLOYED LIVE 2026-08-17

**The owner's order, 2026-08-16: "I don't want duplicate series."** The index
held one free-text `series` string per row, in whichever spelling the owning
catalog happened to have — an m4b tag saying *"The Stormlight Archive"*, a
library row saying *"Stormlight Archive"*, and the apex seeing two series.
Series now have a KEY, the way books have had `work_fold` since day one.

Design section: [`info/index-worker-design.md` §8.5](info/index-worker-design.md).
Live: `https://index.heygabi.ai/api/series` (members-only — sign in on the apex
first; a tokenless GET is a 401 by design).

### What shipped

| Piece | Where |
|---|---|
| Migration 0004: `entry.series_slug`, `series`, `series_alias`, `series_pending` | `apps/index-worker/migrations/0004_series_registry.sql` |
| The resolver (pure) | `apps/index-worker/src/series.ts` |
| Its D1 side + the canon reader | `src/series-store.ts`, `src/series-canon-data.ts` |
| Push-time resolution, inside the push's own batch | `src/push.ts` |
| The API + the approver's confirm queue | `src/series-route.ts`, `src/middleware/auth.ts` (`requireOwnerStanding`) |
| The one-shot backfill (dry run by default) | `scripts/backfill-series.ts` |
| Tests: 22 unit + 5 real-runtime probes | `test/series.test.ts`, `test/live-probes.ts` B11–B15 |

Commits `f6a83b0`, `a1a7288`, `b78b3eb`. Worker version
`1db25143-1dcc-47f9-9fb1-000d5627ec81`. Remote migration 0004 applied (✅ row
seen, not assumed).

### The decisions, so nobody reopens them

- **The fold is `normaliseTitle` — the pinned §6 port — hyphenated. Not a new
  normaliser.** It already strips a leading article, which is exactly why the
  owner's own example merges with no judgement call. Empty folds are REFUSED to
  NULL, same rule as `title_fold` (two Korean series names).
- **Exact fold → auto-merge; near miss → confirm-first.** The owner approved
  exactly this split. A near miss registers as its own slug AND queues; nothing
  is merged behind anyone's back, and silence leaves two series.
- **The near rule is DISCOVERY only** — it gates no write, so §8's "no second
  matcher" stands. It is `data/series-canon.json`'s own `_measured` decoration
  fold, which that file already calls a discovery tool and never a runtime rule.
- **The canon merges what a human already decided** (3 entries, with evidence).
  Re-queueing a decision on record would be a queue asking a question it has the
  answer to.
- **Members-only + scoped**, i.e. `/api/universe`'s stance, not `/api/search`'s
  anonymous carve-out — which §4.5 grants to search ALONE. Widening it is one
  line and an owner's call, not a side effect of building a page.
- ⚠️ **The list is derived from scoped `entry` rows, never from the registry
  table**, or an audiobook-only member would learn the series NAMES held in the
  two private catalogs. `/api/series/:slug` answers `unknown_series` for a real
  but out-of-scope slug for the same reason.
- **Approver = `OWNER_EMAILS`**: the index has no local roles, and the shared
  auth module does not expose the estate's `is_approver` to consumers.
  `requireOwnerStanding()` is the one place to widen it later.

### Measured live, 2026-08-17 (backfill applied to remote D1)

| | |
|---|---|
| rows carrying a series | **1,590** |
| distinct raw spellings → slugs | **443 → 441** |
| rows keyed / with a series but no key | **1,588 / 2** (the two Korean names — the refusal, working) |
| exact merges | **0** |
| confirm-queue rows | **1** — *"The Survivalist Series"* ~ *"The Survivalist"*, both audiobook |

⚠️ **Zero exact merges is the honest headline.** The cross-catalog spellings had
already been straightened upstream (the series canon, and the audiobook
catalog's own corrections layer), so today this registry is **preventative**: it
makes the regression structurally impossible rather than cleaning up a mess that
was still on the shelf. The owner's Stormlight example is already spelled
identically in both catalogs — measured, not assumed.

### NOT verified

- **A signed-in production GET.** `/api/series`, `/api/series/:slug` and
  `/api/series/pending` were confirmed live as **401 (not 404)** — routed and
  gated — and their 200 answers were verified against a REAL Workers runtime
  and a real D1 by `npm run probe` (B11–B15). Nobody signed in to
  `index.heygabi.ai` itself: that needs the owner's Firebase token, and this
  repo has no authenticated-probe mechanism.
- **The apex `/series` page** — not built; this is the API it will read.

## 🔑 Sam's library (`library2`) — the CSP half, and the SIGNED-IN verification — ✅ DONE 2026-08-16

**Appended, not edited into the entry below it** (this file is append-only).
The entry beneath this one closed with *"NOT verified: the SIGNED-IN table"*.
It has since been verified, and doing so immediately found a real bug that
every unauthenticated check had passed straight over.

### The bug: the fourth column read "unreachable" on every row

Everything that can be checked without a browser session was green — the
`APPS` row shipped, `verify:home` passed all 9 pages, 102/102 estate probes
passed, and padhard's own CORS preflight admitted `https://heygabi.ai` with
GET+PATCH when curled directly. The signed-in page still showed
*"Sam's library … unreachable"* on every member, and the role filter had no
vocabulary at all.

**Cause: the apex's own Content-Security-Policy.** `/admin` and `/admin/` in
`sites/heygabi-home/public/_headers` named `library.heygabi.ai` and
`boardgames.heygabi.ai` in `connect-src` and nothing else. A CSP-blocked
`fetch()` **rejects** inside the page, and `fetchAppDirectory()` catches a
rejection as `{ ok: false, why: 'unreachable' }` — which is
indistinguishable from the other site being down. `/status` and `/status/`
had the identical latent failure for the new `wk-library2` / `site-library2`
rows.

⚠️ **The durable lesson, written into `_headers` itself and into
`estate-auth-design.md` §1.2 so the next person meets it: federating an app
is TWO edits — the `APPS` row in `admin.js` AND the host in this origin's
CSP — and shipping only the first looks exactly like the other site being
down.** The other site's CORS is the first lock; this origin's CSP is the
second, and only a real signed-in browser session shows the second one
failing. This is the "verify with the right instrument" rule paying for
itself: a 200, a marker match and a green probe suite all held while the
feature was broken.

Fix: commit `3f0a5ba` — `https://padhard.heygabi.ai` added to `connect-src`
on all four rules (`/admin`, `/admin/`, `/status`, `/status/`; both forms,
per the 308 trailing-slash trap that file documents). Redeployed from a
second `git worktree add <tmp> HEAD` checkout.

### Verified live, SIGNED IN, 2026-08-16

Read off `https://heygabi.ai/admin` in a real browser session:

| Verified | Observed |
|---|---|
| The role filter reaches her instance | "Sam's library role (padhard.heygabi.ai)" carries her Worker's full vocabulary — `owner / admin / moderator / contributor / member / guest / pending` — fetched from padhard, never hardcoded |
| **The owner's actual ask** | **Samantha Hardman's row shows a "Sam's library" role dropdown reading `admin`**, editable exactly like her `games` cell |
| Owner auto-max, extended identically | Both owner rows render **no control at all** on the Sam's-library cell — "Owner — holds owner, this app's highest role. Not changeable here; owner is DB-only." — the same sentence the library and games cells show |
| No account there ≠ an error | Members who have never signed into her instance show "no account yet — appears on first sign-in", not a broken dropdown |
| The estate visibility checkbox is unaffected | Every row still carries its own "Sam's library / visible" checkbox (0007's `DEFAULT 0` column) |
| No JS errors | Console clean across a signed-out and a signed-in load |
| Live CSP carries the host | `/admin/` and `/status/` response headers both match `padhard` |

⚠️ **Still NOT verified, and unchanged from the entry below:** whether
`padhard.heygabi.ai` is present in Firebase's authorised-domain list (probe
D5 exists but needs a service account nobody had in hand). And **nothing was
WRITTEN** — no role was granted or changed on anyone during verification;
the dropdowns were read, never submitted.

## 🔑 Sam's library (`library2`) joins the estate MANAGEMENT surfaces — ✅ DONE 2026-08-16

Owner, live on the page 2026-08-16: *"in the admin page Sam's library has no
roles, I should be able to set her with the same level of roles as my
library."*

He is right, and the fix is smaller than the ask implies — because the
plausible premise ("add a fourth managed site to the auth Worker") is wrong.
`padhard.heygabi.ai` runs the **same Worker code** as `library.heygabi.ai`
(`library_catalog`'s `[env.friend]`), so it already answers
`GET /api/admin/users` in the library's own vocabulary, already gates on its
own `manageUsers` capability, and already CORS-locks itself to
`https://heygabi.ai`. The admin page simply was not asking. Serving her roles
from the auth Worker instead would have stood up a **second, competing role
store for a catalog that already has one** — see
`docs/info/estate-auth-design.md` §1.2's 2026-08-16 amendment.

Scope, all in one pass:
- `admin.js`: `library2` becomes a full member of `APPS` (canonical order,
  appended last), gaining the same dropdown, the same server-enforced
  strictly-beneath granting and the same owner-auto-max cell as library and
  games; the old "roles live on that site — not federated here yet" note is
  gone.
- `admin/index.html`: a "Sam's library" role filter (`f-role-library2`).
- `/status`: `wk-library2` + `site-library2` rows.
- `tools/estate-probes`: padhard health as a fifth `health.mjs` target plus a
  new `probes/library2-worker.mjs` (tokenless AND garbage-bearer 401 on the
  role surface, apex-only CORS admit/refuse). All GET/OPTIONS — no
  `NON_GET_ALLOWLIST` row needed.
- `auth-worker`: **no code change**. `test/library2-vocabulary.test.ts` pins
  the wire word (`CONSUMER_APPS`, `appTokenFor`'s distinct secret,
  `vis_library2`, canonical-last) and carries a tripwire asserting the
  audiobook ladder never grows a per-site rung.

One deliberate asymmetry worth keeping written down: **the seed-gap notice
does not run for `library2`** (`seedGap: false` in `APPS`). Her roster is her
household's, so "listed there but not in our estate directory" is the
permanent normal state, not a seed that missed someone — flagging it would
print a warning nobody could ever clear, which trains the reader to ignore the
whole line.

### Landed + verified 2026-08-16

Commit `71e4a0e`. Deployed to the apex from a throwaway
`git worktree add <tmp> HEAD` checkout, **not** from the working tree — two
other agents were mid-flight in this repo and one had
`public/assets/estate-theme.css` dirty at deploy time, which
`wrangler pages deploy <dir>` would have shipped. `check:home` refused the
direct deploy exactly as designed; the worktree pattern is the documented
recovery and it worked first time. Deployment:
`https://6ed48c0d.heygabi-home.pages.dev` → `heygabi.ai`.

| Verified | How |
|---|---|
| The shipped page carries the fourth column | `verify:home` (9 pages, every marker) + a direct fetch of `https://heygabi.ai/admin/admin.js`: `padhard.heygabi.ai`, `Sam's library`, `seedGap` all present |
| The filter row shipped | `/admin/` contains `id="f-role-library2"` |
| `/status` rows shipped | `status.js` contains `wk-library2` and `site-library2` |
| Her role surface refuses strangers | probes L21/L22 — `/api/admin/users` tokenless AND garbage-bearer → the worded 401 |
| Her CORS admits only the apex | probes L23/L24/L25 — apex gets ACAO + GET/PATCH, `evil.example` gets none |
| Her Worker is up, and it is HERS | `library2-health` H1–H6 read from `padhard.heygabi.ai` |
| The estate suite is whole | `npm run probe:estate` → **102 passed, 0 failed** (was 91) |
| auth-worker unregressed | `npm test` → **183 pass, 0 fail**; `npm run typecheck` clean |

⚠️ **NOT verified, and it is the half that matters most to the owner: the
SIGNED-IN table.** Everything above is the unauthenticated shell. The role
cells, the dropdown, the owner-auto-max rendering, and an actual grant landing
on her instance all need a Firebase sign-in this build never had. The owner
verifies it himself at **https://heygabi.ai/admin** — expand any member and
look for a fourth catalog row, "Sam's library", carrying a role dropdown
beside its visibility checkbox.

⚠️ **Also NOT verified: `padhard.heygabi.ai` in Firebase's authorised-domain
list.** It was added as D5 to `tools/estate-probes/authorized-domains.mjs`,
which needs a service account nobody had in hand. If her sign-in ever fails
`auth/unauthorized-domain`, that is the first thing to check.

⚠️ **auth-worker was NOT redeployed, deliberately.** This build changed no
line of its `src/` — only a test file — so a deploy would have shipped an
identical Worker, and in a shared checkout it risks publishing another agent's
committed-but-unshipped work. Nothing about the fourth column depends on it.

## Fine-grained pipeline step controls + shelf-server force-upload (owner ask 2026-08-16) — ✅ DONE

Owner: *"maybe in the admin status dashboard you give us fine control over
each part of the pipeline in case we need to do part way steps, do so in a
way to make sure we cant break stuff though"* + *"add a button to force a
full upload to the server that we can run to make sure we can move google
drive to server without the full pipeline."*

Built on `/status`'s Operations section (devops/approver-gated, unchanged
tier): 7 per-stage buttons (audit/sort/detect/folders/upload/catalog/publish)
classified by blast radius — read-only plain buttons, mutating/publishing
two-tap `confirmBtn` (now shared via `assets/estate-controls.js`, extracted
from `admin.js` so both pages use the one idiom), publishing steps carry a
standing "updates the live site" warning. THE SAFETY MODEL: every control —
including the standalone force-upload — takes the exact same single-flight
lock the scheduled 8h run already takes (audiobook_catalog's
`app/core/pipeline_lock.py`); the auth Worker also live-checks
`pipeline_status/current` before queuing (409 if busy, fails OPEN on a read
error since the lock downstream is the real guarantee); the one genuine
ordering dependency (Upload needs to know what's new) disables with a
reason using real `summary.toUpload` data, not a fabricated graph. Every
manual invocation is logged server-side (`pipeline_step_requested` /
`pipeline_force_upload_requested`). New auth-worker routes: `POST
/api/estate/ops/pipeline/step`, `POST /api/estate/ops/pipeline/force-upload`
(`ops.ts`), both `requireDevops()`, same as the existing pipeline trigger.
Force-upload is its own control, outside the step list (not a pipeline
stage) — the shelf server does not exist yet
(`audiobook_catalog/docs/access/SHELF_SERVER.md`), so it degrades honestly
("not configured"/"unreachable") via its own `shelf_upload_status/current`
Firestore doc, never the pipeline's own status row. audiobook_catalog side:
`scripts/sync_to_drive.py --step <name>`, new `scripts/sync_to_server.py`,
`app/tools/pipeline_watcher.py` dispatch, `firestore.rules` updates — see
that repo's own docs for detail. 10 new auth-worker tests (116→126), 67 new
Python tests (805→872), 7 new probes (71→78, all passing live). Deployed:
auth-worker, firestore rules (audiobook_catalog), apex.

---

---

## Estate API testing suite (owner ask 2026-08-15) — ✅ DONE

Owner: *"Maybe it's time to make an api testing suite"* — promote
`apps/auth-worker/test/live-probes.ts`'s idiom estate-wide. Built
`tools/estate-probes/` (plain Node, zero deps, `npm run probe:estate`):
54 read-only, unauthenticated-edge assertions against LIVE production across
all four `/api/health` envelopes, auth-worker (`/me`, `/hello`, `/docs/:slug`,
admin API — tokenless and garbage-bearer 401s, CORS admit/refuse), index-worker
(`/api/search` anonymous public-slice shape, `/universe`/`/lookup`/`/scan/shelf`
401s, CORS), library-worker's scan-jobs barcode intake (401 + CORS, read against
the sibling repo's route source, never edited), `audiobooks.heygabi.ai/ebooks.json`,
and the public Firestore `pipeline_status/current` REST doc. All 54 passed on
first live run (2026-08-15) — no findings, no production changes made or
needed. Signed-in 200-paths are explicitly OUT OF SCOPE (no authed probe
identity exists) — listed as future work in `tools/estate-probes/README.md`,
which also carries the "new estate endpoint → probe in the same commit" rule.
Indexed in `tools/README.md` and `docs/access/README.md`.

---

---

## Scan icons: barcode glyph vs camera glyph (owner ask 2026-08-15) — ✅ DONE

Owner: the apex's two scan icons were confusing (camera emoji sat on the
*barcode* scanner) — "give the barcode scanner a barcode icon and a photo icon
for the shelf and cover option… do this everywhere too." Estate-wide
convention now: **barcode modes show a barcode SVG, photo modes (shelf +
single-cover) show a camera SVG**, currentColor so they follow theme.
Canonical set is `ES_ICONS` in `estate-search.js`; the library and games scan
tabs carry vendored copies of the same paths (comment at each points back
here). Changed: apex `estate-search.js` (buttons + stop/busy states),
library `ScanPage.tsx` + `styles.css`, games `ScanJobsPage.tsx` + `styles.css`.

---

---

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

---

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

---

## In flight 2026-08-14 — /admin sort & filter (owner ask)

Sort + filter the estate member list: by estate status, approver flag,
per-catalog visibility (who can see what), and per-app role (who is an admin
where). All client-side — the page already holds the directory + both apps'
federated rosters. Dispatched same day.

---

## ✅ Estate Operations on the status page (owner order, 2026-08-15) — DEPLOYED

"Make sure the status page has all the pieces to RUN the pipelines" +
centralize controls away from individual sites, because the audiobook
pipeline is really an estate pipeline (it moves the ebooks too, via
sync_to_drive.py).

- `apps/auth-worker`: `POST /api/estate/ops/pipeline` (`src/ops.ts`),
  `requireApprover()`-gated, apex-only CORS. Writes the SAME
  `pipeline_requests` document audiobook_catalog's admin panel already
  writes (its `firestore.rules` `validPipelineRequest()` and
  `app/tools/pipeline_watcher.py` are untouched — this is a second producer
  of the existing contract) via the existing Firebase service account plus
  a new `PIPELINE_TRIGGER_TOKEN` secret, piped from audiobook_catalog's own
  `.env`. Deployed; secret set; unit tests + live probes (401 tokenless,
  403 non-approver/stranger, apex-only CORS, 503 config-error) all pass —
  probe suite never performs a real Firestore write.
- `sites/heygabi-home/public/status`: a new Operations section, gated on
  `GET /api/estate/me`'s `is_approver` (mirrors find.js's approver-probe
  pattern) — invisible to anonymous/non-approver visitors, who see the
  existing read-only rows unchanged. "Run audiobook pipeline" button +
  optimistic feedback + a faster poll to catch the Pipeline row flipping to
  RUNNING. A "Run levers" list deep-links every other run control instead
  of embedding it: the platform's three deploy targets (one workflow,
  `target=` choice), Backup, audiobook's Promote + Verify, and the legacy
  admin-panel trigger.
- `_headers`: `/status` + `/status/` CSP gained the sign-in trio
  (gstatic/apis.google.com script-src, identitytoolkit/securetoken
  connect-src, the Firebase authDomain + accounts.google.com frame-src) for
  the new sign-in affordance only — the six read-only hosts are unchanged.

⚠️ **The audiobook admin panel's own trigger (`site/admin.html` +
`site/pipeline-status.js`) is deliberately UNTOUCHED** — it still works
exactly as before, listed on the status page's Run levers as "legacy". Its
retirement (localStorage token entry replaced entirely by the estate path)
is a LATER OWNER DECISION, not made here.

**Awaiting the owner's first press**: the endpoint and UI are live and
verified as far as tokenless/non-approver probing and code-reading allow,
but the button itself was never clicked in anger during this build — it
starts a REAL local pipeline run with Google Drive side effects, so that
was deliberately left for the owner.

---

## ✅ Estate backups rewired to R2, not artifacts (2026-08-15) — DEPLOYED

`backup.yml` moved back into this repo (it had spent part of the day on the
private `skymitch9/estate-backups` repo to keep D1/Firestore/R2 export
artifacts off a now-public repo) and every job now writes straight into a
new **private** `estate-backups` R2 bucket via `wrangler r2 object put ...
--remote` instead of `actions/upload-artifact` — the artifact exposure this
was working around no longer applies regardless of which repo runs the
workflow. `CLOUDFLARE_API_TOKEN`'s R2-write permission was proven with a
throwaway smoke-test object before the rewrite; no owner-side token change
was needed. A new `retention` job (`scripts/prune-r2-backups.mjs`) keeps the
newest 8 objects per `<kind>/<store>` prefix on every dispatch. Proof run
(`target=all`, all 8 jobs + retention green) verified objects for all four
D1s, Firestore, and all three covers buckets, with the D1 export and
Firestore dump each sampled and confirmed byte-identical across two
independent downloads. Full detail: `docs/access/backup-restore.md`. The
`estate-backups` GitHub repo is now superseded (README updated, its own
`backup.yml` disabled) — kept only as a pointer, owner may delete it.

**Queued, not built — v2 idea:** a "last backup age" row on `/status`,
reading the `estate-backups` bucket's object listing (would need a small
Worker with Cloudflare-API access, since the status page has none server-
side today). Sized but deliberately not built this session.

---

## ✅ Four owner-ordered upgrades to universes/search (2026-08-15) — DEPLOYED

1. **Accessories de-clutter** ("make accessories a sub category in a
   universe page"; no include-checkbox by design). `apps/index-worker/
   src/search.ts`: a `unitDemotionTier()` on the `units.sort` inside
   `searchIndex` — `kind='accessory'`/`'promo'` game units sort BELOW every
   book/audiobook/base/expansion-game unit regardless of raw match score
   (previously `kindRank`'s tie-break only ordered them at EQUAL score; this
   is an outright demotion, so it also protects the `MAX_RESULTS` cap from
   an exact-match accessory bumping a real result out). Every consumer
   inherits it for free since none of them re-sort server output. Client
   side (`universes.js` + `estate-search.js`'s `_renderUniverse`): the
   universe expansion view groups game rows by kind — base/expansion stay in
   "Games", accessory/promo collapse into a native `<details>` "Accessories
   & promos (N)", COLLAPSED BY DEFAULT. `kind` was already on the
   `/api/universe/:name` wire (`ENTRY_COLS` in both `read.ts` and
   `search-route.ts`) — checked before assuming a server change was needed;
   none was. 7 new tests (`search.test.ts` ×6, `scope.test.ts` ×1 pinning
   `kind` on the wire).
2. **Alphabetical universes** — `universes.js`: `DISPLAY_NAMES`, a sorted
   copy of `UNIVERSE_NAMES` built once, is what `buildRows()` now iterates.
   `UNIVERSE_NAMES` itself stays in its historical add-order (a running log,
   per its own header) — display order only, no data change.
3. **Embed the component** — `universes/index.html` gets a new `#find`
   section at the top: `<estate-search auth="authed" universes>`, same
   wiring the front door uses (its own dynamic `estate-auth.js` import, its
   own neutral-boot sign-in). The hand-rolled browse list (`#uni-list`)
   stays underneath, unchanged — two ways to the same data, per §0.5's own
   sizing above.
4. **Member-implied universe autofill** ("if I search mistborn have it show
   cosmere as the search autofill"). `search.ts`: `searchIndex` now returns
   an additive `universeSuggestions` field — distinct universes the MATCHED
   rows belong to (from `scored`, pre-cap, so the count is the true matched
   count), excluding anything already in the name-matched `universes` field
   (never duplicate), capped at the top 2 by matched-row count
   (`MAX_SUGGESTED_UNIVERSES`). `estate-search.js`'s `_renderSearch` merges
   `data.universeSuggestions` into the same "Universes" group as
   `data.universes` — same row idiom, no client dedup needed since the
   server already excludes the overlap. Verified server-side that anonymous
   "mistborn" still surfaces the Cosmere suggestion (audiobook-slice rows
   carry `universe` same as every other source) — a dedicated route test
   pins this. 8 new tests in `search.test.ts` (the owner's own example, the
   never-duplicate rule, the top-2 cap with a tie-break, matched-row-only
   counting, plus the signed-out route case).

**Tests**: `apps/index-worker` — 79/79 pass (21 new), `npm run typecheck`
clean (both the main and test tsconfig). No DB migration — `kind` and
`universe` were already columns; nothing changed shape, only the ranking and
one additive response field.

**Review links**: https://heygabi.ai/universes (alphabetical order, the
embedded component, Marvel's 48 accessories + 2 promos collapsed by
default — the built-in demo case) and https://heygabi.ai (front door, search
"mistborn", confirm the Cosmere autofill row). See the deploy log for exact
verification performed signed-out vs. what still needs signed-in eyes.

---

## Index-push staleness — the real fix (sweep finding, 2026-08-15)

Backfill scripts write D1 directly and BYPASS the workers, so no index push
fires; the backstops ask a 24-HOUR staleness question, so data changes go
unnoticed for up to a day (this bit three times today: Boba Fett, the games
universe rows, the library universe rows — each needed a manual save-trigger).
Fix properly: (a) give both catalogs' backfill scripts a --push-index flag
(mint-and-call the push the way the workers do), or (b) gate the existing
checks on MAX(updated_at) > pushed_at instead of a clock. Small build, big
annoyance-removal. Queue for the next working session.

---

## ✅ Auth-lock the /todo page (owner order, 2026-08-15) — DEPLOYED

"Auth lock the todo page too" — `/todo` was CSS-only-radios and had never
gained a `<script>`, but it was still **public**: every board item shipped in
cleartext to anyone with the URL, `_headers`' `default-src 'none'` CSP or not.
That protected against the wrong thing (a hidden link, not a lock) — the
front door's Admin card already link-hid `/todo` behind an approver probe
(2026-08-15, same day, earlier order), but the URL itself answered for
anyone who had it. Same architecture as the earlier `/status` Operations
lock and `/admin`: content must LEAVE the public origin, not just be
harder to find.

- `apps/auth-worker`: `GET /api/estate/todo` (`src/todo.ts`),
  `requireApprover()`-gated, apex-only CORS (mounted in `index.ts`
  alongside `/api/estate/users`, `/api/estate/site-roles`,
  `/api/estate/ops/pipeline`). Returns `{ html }` — the board's `<main>`
  fragment, bundled as a plain TS string constant in
  `src/todo-board.ts` (**not** a wrangler text-module `import … from
  './todo-board.html'`: that idiom has no precedent in this Worker and
  would have broken `npm test`, since `tsx --test` does not read
  `wrangler.toml`'s `[[rules]]` module types the way `wrangler
  dev`/`deploy` do — see `todo-board.ts`'s own header for the full
  reasoning). Unit tests (`test/todo.test.ts`) pin the fragment's shape
  (starts `<main>`, carries all six filter-radio ids, no `<script>`, no
  secret-shaped words). Gating (401 tokenless, 403 approved-non-approver,
  403 stranger, 200 + fragment for an approver, apex-only CORS) is in
  `test/live-probes.ts` phases A/B/C/D (checks A37/A37v, B14–B16, C6, D6) —
  same idiom `ops/pipeline`'s gating uses, run against a real `wrangler
  dev`, never a Hono-level stub (`resolveIdentity()` needs a fully
  configured verifier context to answer 401 the way production does).
  **70/70 live-probe checks pass**, including every new one.
- `sites/heygabi-home/public/todo/index.html` rewritten as a content-free
  shim (no board items, no titles, no hints in the served HTML — verified
  by fetching the anonymous page and grepping for board text). Loads
  `../assets/estate-auth.js` (the front door's sign-in module, "neutral
  boot" + 8s backstop ported from `admin.js`'s 2026-08-14 sign-in-flash
  fix), then `public/todo/todo.js` fetches `GET /api/estate/todo` with the
  caller's Firebase ID token. 200 → the fragment is injected into
  `#board-mount` via `innerHTML` (safe: it is the Worker's own bundled
  content, never user-supplied) and the gate is hidden. 401/403 → the gate
  stays up, showing "This board is for the estate's admins." — no
  status-code-specific hint. The CSS-only radio filter is UNCHANGED: same
  six radios, same `:checked ~` rules, still zero JS in the filtering
  itself, verified working once injected (the fragment preserves the
  original direct-sibling structure `.filters`/`.board` need; no id
  collisions with the shim's own `gate-*`/`signin`/`who` elements).
- `_headers`: `/todo` + `/todo/` CSP replaced `default-src 'none'` (no
  script-src) with the sign-in allow-list — `script-src 'self'` +
  `www.gstatic.com` + `apis.google.com`; `connect-src auth.heygabi.ai` +
  `identitytoolkit.googleapis.com` + `securetoken.googleapis.com`;
  `frame-src` the Firebase authDomain + `accounts.google.com` — the same
  shape `/status`'s Operations section uses, not a general loosening.
  `img-src`/`style-src` unchanged (`'self' data:'` / `'unsafe-inline'`
  only — still one inline `<style>` block, no images beyond the favicon).
  The file's own header comment and the old `/todo` section are both kept,
  marked SUPERSEDED with the date, rather than deleted.
- Stale "no-JS"/"must never acquire JavaScript" claims corrected, same
  supersede-don't-delete treatment, in: `sites/heygabi-home/README.md`
  (three sections + the files table + the local-preview note),
  `sites/heygabi-home/public/index.html` (two comments — the CSP summary
  and the Admin card's link-hiding note, which used to say `/todo` "cannot
  authenticate" and now can), `docs/info/estate-auth-design.md` §14.4's
  `/todo` aside. `deploy.md`'s `/todo` checklist (§3) still applies
  unchanged for the filter tap-test; its "exactly one network request...
  has no JS and must never acquire any" line is now wrong and should be
  revisited before the next `/todo`-touching deploy walks that checklist.

**Content-update path, now deliberately slower**: editing the board means
editing `apps/auth-worker/src/todo-board.ts` + `wrangler deploy` from
`apps/auth-worker/` — **not** editing a file under `sites/heygabi-home/`
and re-running the Pages upload. This is a real cost, accepted because the
board changes rarely (documented in `todo-board.ts`'s own header and here).
A Pages deploy is only needed again if the SHIM (gate UI, auth wiring)
changes — not for a content-only edit.

**Verification performed**: `npm test` and `npm run probe` both green in
`apps/auth-worker` (see above). Pages deploy and the live
`https://heygabi.ai/todo` checks (anonymous HTML carries no board text,
tokenless `GET /api/estate/todo` 401s, CSP present on both `/todo` and
`/todo/`) are recorded in the deploy log / session report for this change.

---

## Estate API testing suite (owner proposal, 2026-08-15 — queued next)

Promote the auth worker's live-probes idiom (70 checks: real minted tokens,
synthetic users, role matrix, cleanup) to an ESTATE-WIDE suite in
catalog-platform: every worker's public + gated endpoints probed — index
(search/scan/universe/health), auth (estate/me/site-roles/ops/todo), library
API (incl. the audiobook-mapping machine route + the apex add flow's CORS),
games API. One runner (npm run probe:estate), per-surface sections, a
manual-dispatch workflow button, matrix output. First customer: the owner's
ordered EXTENSIVE scanning + add-to-catalog test pass (plus the coordinator's
browser session for signed-in UI flows the suite can't drive).
