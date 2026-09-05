# Friend's Library — the Ingest Story — Information Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED. **DESIGN
> DOC, not a build** — nothing below exists yet except where a row says LIVE.
> Last verified: **2026-08-16** — every "measured" figure below was read that
> day from the named source doc or code file, each of which carries its own
> measurement date. Unmeasured claims are labelled.
>
> Scope is settled elsewhere and is NOT relitigated here: a second **instance**
> of `library_catalog` (own D1, own covers bucket, own hostname), estate auth
> shared, federation later; games and ebooks OUT. See `docs/TODO.md` "second
> household's library" + its SCOPE NARROWED block ("for now my friend wants to
> sort her books"), and `ebook-split-design.md` (her ingest surface for ebooks
> is a 404 and stays one). This doc answers ONE question: **how do her books
> get into her catalog when she has a phone, a shelf, no terminal, and no one
> technical within driving distance.**

---

## 1. What exists today, measured

The ingest surfaces below are `library_catalog`'s, which her instance inherits
byte-for-byte — a second instance runs the same Worker and PWA.

| Surface | Gate (capability → lowest role) | Cost | Measured reality |
|---|---|---|---|
| **Barcode scan** (`POST /api/scan-jobs/barcode`) | `scanBarcode` → contributor | free | Field-proven on a real iPhone at a bookstore (2026-08-05 device pass; 2026-08-15 owner bookstore trip). ISBN ladder rung 1 (Open Library by ISBN-13) resolved **9/10** with full metadata + cover (`isbn-ladder.md`, live calls 2026-08-09) |
| **Shelf photo** (`POST /api/scan-jobs/shelf`) | `scanPhoto` → **moderator** (split from `scanBarcode` 2026-08-16 *because it costs money*) | **3–7¢ per shelf**, shown on screen (`estimatedCents`) | Real ~30-spine shelf: 28 verified correct, **0 invented**, 6.7¢, 19.5s. Hard case (occluded, non-English): recall poor but no false books. Unreadable photo fails for 1¢ (`scan-jobs-and-vision.md`, 2026-08-10/11) |
| **Single-cover photo** (`/single`) | `scanPhoto` → moderator | ~1–3¢ | Same vision path, one book framed large |
| **Manual add** (`POST /api/works`) | `editCatalog` → contributor | free | The "Type it in" path; always available from a scan row |
| **Review a sweep** (`/scans`, `/add?job=<id>`, line patch/lookup/done) | `editCatalog` → contributor | free | One job per sweep, survives a locked phone (`scan_job` rows, resumed by `?job=id`) |
| **Research runs** | `runResearch` → moderator | per-run LLM spend | Exists; not part of her day-one path |

Capability source: `library_catalog/packages/core/src/capabilities.ts`
(2026-08-16 six-role ladder, owner-approved: `guest < member < contributor <
moderator < admin < owner`).

### What a phone user actually does today, step by step

Read from `router.tsx`, `ScanPage.tsx`, `scan-jobs.ts` and
`scan-jobs-and-vision.md`:

1. Open the site → **Sign in with Google** (Firebase project
   `audiobook-catalog` — the shared-identity setting).
2. Tap **Add** (`/add` — deliberately ONE flat route; iOS re-prompts camera
   permission on every route change, WebKit #215884).
3. **Barcode tab:** camera opens (ponyfill scanner, works on iOS), point at the
   back-cover barcode; each book becomes a line on the same job, resolved
   synchronously through the free ISBN ladder. **Shelf tab:** photograph the
   shelf in place; vision + catalog match + a first Open Library pass all run
   **automatically** (reversed 2026-08-11 — no button pressing), throttled to
   one upstream call per 1.1s, 8 lines per chunk.
4. **Review, same screen:** every line is a proposal. Since the 3b dead-ends
   fix, **every row always has buttons** — Add, Add 2nd copy, Type it in,
   Not wanted. A misread spine is repaired by retyping; the corrected words
   re-run the same `lookupLine` ("the repair bench"). Nothing auto-applies;
   the person presses Add.
5. Phone locks mid-sweep → nothing lost; `/scans` lists unfinished sweeps.

**Where a non-technical remote user falls off this path today** (the honest
audit — each has a fix in §2/§3):

- **Before step 1:** her Google sign-in only works if her hostname is in
  Firebase's Authorised domains (else `auth/unauthorized-domain` — the site
  "looks broken at sign-in", `wrangler.toml`'s own warning). Owner-console
  lever.
- **After step 1:** a new sign-in is `pending` twice — estate directory AND
  app row. Estate-approved + never-locally-decided auto-grants only
  **`member`** (`LIBRARY_POSTURE.defaultRole = 'member'`, `gate.ts:99`) — and
  a member holds **no scan capability at all**, and the app **hides tabs the
  role cannot use** (`scan-jobs-and-vision.md` §4). She would see a working
  catalog with no way to add a book and no explanation. **This is the biggest
  fall-off risk in the whole story.**
- **Step 3, shelf tab:** photo mode has **never been exercised on a real
  iPhone** ("Not yet exercised on device: photo mode, shelf mode" —
  `ios-camera.md`, 2026-08-05). The API side is measured; the phone side is
  not.
- **Step 4:** the review flow works, but today the only person who has ever
  reviewed a sweep is the catalog owner. Nothing in the code restricts review
  to the owner — it is `editCatalog` — but nobody has watched a second person
  do it (unmeasured).

### What she does NOT have to do — the details sweep

LIVE on library since 2026-08-16 (`6e3a368f`, cron `7 * * * *`,
`details-sweep.ts`): if a book is missing a detail nobody ever looked for, the
Worker looks for it hourly, unasked — 2 books/tick (subrequest cap, not money),
**~4¢/hour while converging, ~2½ days for this household's library, then
quiet**. It never re-asks a question it already asked. So she scans, walks
away, and covers/pages/years fill themselves in. Her instance gets this for
free — it is the same Worker. (Her convergence time depends on her library
size: unmeasured, but at 2 books/hour a 300-book backlog with ~half missing
details is under a week.)

---

## 2. Her day-one walkthrough, phone only

Assumes §6 provisioning is done. Every step names who holds the lever.

| # | She does | What happens | Lever, and who holds it |
|---|---|---|---|
| 0 | (nothing) | Her email is **pre-approved** in the estate directory with visibility including her catalog | Owner, once, at `heygabi.ai/admin` (row created via seed `--extra` or D1 — the admin API cannot create rows, only decide existing ones) |
| 1 | Opens `https://<hers>.heygabi.ai`, taps **Sign in with Google** | Firebase sign-in; `/seen` upserts her; estate answers `approved` | Owner: hostname in Firebase Authorised domains **beforehand** (console click). She: needs a Google account — **ANSWERED 2026-08-16: she has Gmail, and she is ALREADY an approved estate member** (verified against `estate_user`: status `approved`, visibility across all three catalogs, origin `seed:audiobook` — identity on file in the estate directory, deliberately not named here because this repo is public) |
| 2 | (nothing) | Estate-approved + locally-undecided → **auto-grant** her instance's default role, which this design sets to **`moderator`** (see §3 — a one-line, app-owned posture change on HER instance only) | Design decision, owner-approved at build time. Fallback if declined: owner promotes her via her instance's People page, remotely, during a first phone call |
| 3 | Taps **Add**, allows camera | `/add` opens on the barcode tab | Nothing — contributor-and-up, granted at step 2 |
| 4 | **Shelf tab** → photographs a shelf in place | Screen shows the cost (**3–7¢**); vision reads the spines; lookups run unattended; rows appear with matches, covers, "not in Open Library" verdicts | Money: owner's Anthropic key with a hard cap (§4). Her tap is the only trigger — never automatic, never retried on her behalf |
| 5 | Reviews the rows: taps **Add** on the right ones, **Type it in** on misreads, **Not wanted** on junk | Books land in her catalog with covers | Nothing — every row always has buttons; nothing auto-applies |
| 6 | Locks her phone, comes back tomorrow | `/scans` lists the unfinished sweep; the hourly sweep has been filling missing details overnight | Nothing — both are automatic |

Barcode vs shelf, stated honestly: the **barcode is the precision path**
(9/10, free) but means pulling every book off the shelf to reach its back
cover; the **shelf photo is the bulk path** (a dozen books per 7¢ tap, in
place) and is what "sort her books" wants day one. Her library's Open Library
coverage is **unmeasured** — the owner's 14/30 title-search miss rate is a
fact about a KU/Audible-heavy library, not about hers; a typical
trade-paperback shelf should fare better on the ISBN rung (population-neutral)
but nobody has measured her shelves.

---

## 3. The self-serve loop: she reviews her own sweeps

The capability model already supports this — review was never owner-locked,
only role-gated:

| She wants to | Needs | Lowest role |
|---|---|---|
| Scan barcodes, review sweeps, add/fix books, manage her wishlist | `scanBarcode` + `editCatalog` + `manageWishlist` | **contributor** |
| Shelf/cover photos (the bulk path), accept research findings | `scanPhoto` + `reviewFindings` (+ `runResearch`) | **moderator** |
| Approve HER future household members | `manageUsers` | admin |

**Recommendation: `moderator` on her own instance**, delivered by the
auto-grant so no coordination call is needed (step 2 above). The mechanism is
already app-owned config — `declareAuthPosture({ defaultRole })` in her
instance's gate posture (`packages/estate-auth/src/gate.ts:99` sets `'member'`
for this library; hers says `'moderator'`). This is an **access-increasing
default and therefore an explicit owner decision, flagged per the global
rule** — the blast radius is: anyone the estate approves *with visibility into
her catalog* gets moderator there, i.e. can spend scan money. Mitigated by §6
step 8's `DEFAULT 0` visibility (nobody sees her catalog unless deliberately
switched on) and the §4 cap. If the owner declines, the fallback is one manual
promotion on her People page and the default stays `member`.

Not day-one, recorded for later: `admin` for her, so she can approve her own
household without the owner in the loop. Access-increasing; ask, don't assume.

---

## 4. Where the scanPhoto money lands, and the cap

**Where it lands today:** the Worker's `ANTHROPIC_API_KEY` — the owner's key,
owner's bill. The app shows `estimatedCents` on the scan screen (deliberate:
"the person spending the money is the person holding the phone") but has **no
cap anywhere** — `capabilities.ts`'s own comment names `scanPhoto`/
`runResearch` as "the two capabilities that carry a bill and have no cap in
the app".

**Realistic exposure, from measured figures:** a 300-book library ≈ 25–40
shelf photos ≈ **$1.75–$2.80** of vision, plus the details sweep converging at
~4¢/hour for some days ≈ $2–$4, plus repair re-lookups (free — Open Library).
**First month plausibly under $10 total; steady state near zero.** (Library
size is a guess; the per-unit costs are measured.)

**Options:**

| # | Option | Cost to build | Failure shape |
|---|---|---|---|
| a | Nothing — on-screen cents + trust | 0 | Unbounded in principle; in practice bounded by her tapping |
| b | App-side monthly cap (D1 spend counter + var, worded refusal) | small build + tests | Best UX at the limit; another counter to maintain |
| c | **Key-side cap: her instance gets its OWN `ANTHROPIC_API_KEY` from a separate Anthropic Console workspace with a hard monthly spend limit** | 0 code — console only | At the cap the API errors; the scan screen must say so in words, not a bare status (see caveat) |
| d | Owner notification per scan / weekly digest | small build | Notifies; caps nothing |

**Recommendation: (c) with a $10/month hard cap, keeping (a)'s on-screen
cents.** It is the mechanical guard (zero app code, cannot be forgotten), it
isolates her spend from the owner's on the bill, and $10 is ~3× the estimated
worst month. Revisit to (b) only if the cap is ever actually hit — and note
the caveat honestly: **what the scan screen renders when the key is refused at
the cap is unmeasured**; per the estate's own rule ("a person must never see a
bare HTTP status"), verify the worded-error path before telling her the cap
exists. The details sweep draws the same key, so a capped month also pauses
her detail-healing until reset — acceptable, and self-resolving.

---

## 5. Support at distance

| Situation | Who/what handles it |
|---|---|
| Stuck lookup pass (dead process mid-enrich) | **Self-heals** — `processed_at` heartbeat, `STALE_AFTER_MS = 90s`, a retry replaces a dead pass; measured 2026-08-11 |
| Unreadable/dark photo | **Self-limits** — fails for ~1¢ with `unreadable: true`; the advice is "take another photo" |
| Vision misread a spine | **She fixes it** — retype the line, same-screen re-lookup (`editCatalog`, which she holds) |
| Sweep abandoned half-done | **Self-preserves** — `/scans` lists it forever until done/deleted; `not_found`/`error` rows deliberately stay outstanding |
| Missing covers/details | **Self-heals** — hourly sweep (§1) |
| Genuinely wedged job | She can delete it (`editCatalog`); or the **owner signs into HER hostname** and does anything she can — same app, no federation needed. Owner needs standing there: recommend her instance's `OWNER_EMAILS` = owner's email (break-glass, unrevokable by design) — an owner decision, and the honest note is that this means her instance is operationally the owner's in phase 1 |
| Account/approval problems | Owner at `heygabi.ai/admin` (estate: approve/revoke/visibility — the owner is the estate's 1 approver, measured 2026-08-14 health counts) and at her instance's People page (roles). Both are phone-usable web UIs — **auth admin is UI-first; CLI is break-glass only** |
| Her instance down / D1 / deploy issues | Owner only, via wrangler from home — she has no lever and needs none. Estate-auth outage: she keeps working on stale cache (10-min TTL rides through) |
| Scan-jobs page federated to the owner's own site? | **NOT built, not needed** — signing into her hostname IS the remote support surface. Federating job lists is phase-2 thinking (§7) |

---

## 6. Provisioning runbook sketch (one-time)

Sized honestly: **two real build items** (steps 2 and 8), the rest are
one-command or console-click steps. Everything runs from the owner's machine;
she does nothing until §2 step 1.

| # | Step | Size / kind |
|---|---|---|
| 1 | Pick names: her hostname (`<hers>.heygabi.ai`), D1 name, bucket name, her covers hostname (a custom domain belongs to exactly ONE bucket — `bookcovers.heygabi.ai` is taken) | Owner decision, minutes |
| 2 | **Teach the repo a second instance** — a `[env.friend]` wrangler environment (own D1/R2 bindings, own routes, own vars: `OWNER_EMAILS`, `COVERS_BASE_URL`, `ESTATE_CHECK`, unset `INDEX_URL`) + making the deploy/verify/secrets scripts (`check-clean`, `deploy-done.mjs`, `push-secrets.mjs`) env-aware, + her posture (`defaultRole: 'moderator'`, §3) | **Build item #1 — the larger one.** One focused agent / a supervised day; the scripts all assume a single instance today |
| 3 | `wrangler d1 create <hers>` then migrations apply `--remote` (shared `migrations/` dir — migrate before deploy, standing rule) | Two commands |
| 4 | `wrangler r2 bucket create <hers-covers>` + custom domain + Cache Rule (1-year edge TTL — safe, object names are content hashes) | One command + ~10 min dashboard |
| 5 | Route `[[routes]] pattern = "<hers>.heygabi.ai", custom_domain = true` — in git, asserted by deploy; zone already in this account | Free with step 2. Gotcha: this LAN negative-caches new subdomains ~30 min — test from the phone, not the desk |
| 6 | **Firebase console: add her hostname to Authorised domains** — BEFORE she ever sees the URL | Console click. ⚠️ Order matters; the failure is a broken-looking sign-in |
| 7 | Secrets on her Worker: `ANTHROPIC_API_KEY` (**new key, capped workspace — §4**), `ESTATE_APP_TOKEN_<HERS>` (mint once, set both sides), optionally `GOOGLE_BOOKS_API_KEY` (reuse). Deliberately NOT set: `INDEX_PUSH_TOKEN` (federation later — unset = inert by design, the games precedent), `EBOOK_INGEST_TOKEN` (never — `ebook-split-design.md`; ⚠️ it WAS set on both instances for the 2026-09-03 ebook ingest and DELETED from both 2026-09-05 after phase 5 — the ingest door 404s `ingest_disabled` now), `AUDIOBOOK_MAPPING_TOKEN` | Console + 3 commands |
| 8 | **Estate learns a 4th catalog**: auth-worker migration `vis_<hers>` — **`DEFAULT 0`, deliberately opposite the existing columns' `DEFAULT 1`** (the household should not silently see her shelf, nor she theirs; switch people on by hand) — plus the `/seen` effective-set, the admin-UI checkbox, the seed left untouched, tests | **LIVE 2026-08-16** — `0007_vis_library2.sql` (column named `vis_library2` for the CATALOG, identity-neutral; hostnames are temporary, columns are forever). Applied local + remote (12 approved rows, all backfilled 0 — measured); `/seen`/`/me`/admin UI/index scope speak the 4-entry canon; only her own row was granted (`vis_library2 = 1`). Her instance's own `ESTATE_APP_TOKEN_LIBRARY2` is declared but unset until step 2 provisions her Worker env |
| 9 | Pre-approve her: seed `--extra` with her email (or one D1 insert), then approve + set visibility at `/admin` | Minutes |
| 10 | Deploy her env; verify `/api/health`, sign-in on the owner's own phone at her hostname, `wrangler tail` shows `estate_enforce … denied:false` | Commands + the standing verify routine |

**Total: roughly one build-day plus an hour of console work**, dominated by
steps 2 and 8. Owner decisions embedded: names (1), the moderator default
(§3), the cap amount (§4), `OWNER_EMAILS` on her instance (§5), visibility
defaults (8).

**The ownership boundary, stated honestly for phase 1:** her books live in her
own D1 and bucket, but on the owner's Cloudflare account, the owner's Anthropic
key, and the owner's Firebase project. "Her data, her control" is real at the
data layer and aspirational at the infrastructure layer; moving custody is
explicitly not phase 1.

---

## 7. Explicitly NOT built in phase 1

- **Federation / "who owns what"** — the whole point of a separate instance is
  that the join is cheap to add LATER (an instance is already an index source;
  set `INDEX_URL` + mint `INDEX_PUSH_TOKEN_<HERS>` + `READ_ORIGINS` when the
  day comes). Building it first would federate an empty catalog — the TODO's
  own warning.
- **Ebooks** — her ebook ingest surface is a 404 on purpose and stays one.
- **Games** — out by the owner's narrowing; nothing here carries them "for
  symmetry".
- **Scan-jobs federation / owner dashboards** — signing into her hostname is
  the support surface (§5).
- **Infrastructure custody transfer**, her-side admin/approver powers, and any
  app-side spend counter (option b) — all recorded above as later decisions.

---

## 8. What was NOT measured

- ~~Whether she has a Google account~~ — **ANSWERED 2026-08-16 by the owner:
  yes, Gmail, and she is already an APPROVED estate member with visibility into
  all three catalogs (seeded from the audiobook side).** Two consequences for
  the phases above: day-one step 1 (owner pre-approves her) is ALREADY DONE —
  no seed `--extra` needed for the estate row; and the sign-in/approval
  fall-off risk shrinks to just the ROLE gap (member holds no scan capability),
  which the moderator-default posture on her instance addresses. The original
  text follows for the record.
- *(superseded)* **Whether she has a Google account** — the single cheapest question with the
  power to change the design (Firebase sign-in is non-negotiable estate-wide).
  Ask first.
- **Shelf-photo mode on a real phone** — API-side measured; on-device is not
  (`ios-camera.md` and `scan-jobs-and-vision.md` both say so explicitly).
- **Her library's Open Library coverage and size** — every hit-rate above was
  measured against the owner's shelves or third-party photos.
- **The scan screen's behaviour when the API key is refused at a spend cap**
  (§4 caveat) — verify before relying on option (c)'s failure mode.
- **A second person driving the review flow** — capability-supported, never
  observed.
- **This doc's costs for HER instance** — per-unit costs are measured; totals
  are estimates and labelled so.
