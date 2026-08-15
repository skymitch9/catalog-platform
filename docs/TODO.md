# Catalog Platform — Work Log

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-15**.
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

## Index-push staleness — the real fix (sweep finding, 2026-08-15)

Backfill scripts write D1 directly and BYPASS the workers, so no index push
fires; the backstops ask a 24-HOUR staleness question, so data changes go
unnoticed for up to a day (this bit three times today: Boba Fett, the games
universe rows, the library universe rows — each needed a manual save-trigger).
Fix properly: (a) give both catalogs' backfill scripts a --push-index flag
(mint-and-call the push the way the workers do), or (b) gate the existing
checks on MAX(updated_at) > pushed_at instead of a clock. Small build, big
annoyance-removal. Queue for the next working session.

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
