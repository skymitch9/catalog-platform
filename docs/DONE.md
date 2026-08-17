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
