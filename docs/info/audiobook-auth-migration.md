# Audiobook Catalog → Real Auth Model — Migration Design

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — DESIGN
> ONLY, nothing here is built. Last verified: **2026-08-16** (every write path
> below was measured against the repos that day; anything not measured is
> labeled). Companions: `estate-auth-design.md` (§3.1 verdicts, §4.4 /seen,
> §5 protocol), `audiobook_catalog/docs/info/ROLES.md` (the ladder, §1b
> capability matrix, §1f revocation — LOCAL ONLY there),
> `library_catalog/docs/info/estate-auth-shadow.md` (the proven shadow→enforce
> pattern this design copies), `apps/auth-worker/src/role-ladder.ts` (the
> ladder in code).

**The owner's decision (2026-08-16):** bring the audiobook site onto the model
its siblings use — server-verified Firebase tokens, roles in a database,
capability gates in a Worker — replacing today's model (world-readable static
site; permissions enforced only by `firestore.rules` reading `site_roles/{uid}`
client-side; pipeline trigger guarded by a shared token; admin UI gated by a
presentation-only client role read).

**The incident that motivates it (measured 2026-08-16):** revoking an estate
member left their audiobook `site_roles/{uid}` admin doc standing, and
`firestore.rules` — which consults only that doc, never the estate directory —
kept honouring `allow delete: if isSiteAdmin()` on `/reviews`.
`clearSiteRoleOnRevocation()` (auth-worker `site-roles.ts`) now clears the doc
as the Firestore half of a revocation, but it is **best-effort by design** (no
transaction across D1 and Firestore; a Firestore outage leaves the role
standing with only a log line). Rules structurally cannot ask "is this person
still approved?" — a Worker can, on every request. That is the migration.

---

## 0. Ground truth this design is built on (all measured 2026-08-16)

| Fact | Where measured |
|---|---|
| `firestore.rules` is 939 lines; role logic appears in exactly two enforcement families: club manager/moderator tiers (claim-gated `managerUids` + `site_roles`) and the site-admin `/reviews` delete. Everything else is shape-only, open by design | `audiobook_catalog/firestore.rules` |
| identity.js v2 keeps a LIVE Firebase session; `request.auth` carries a real uid for Google sign-ins; legacy v1 mirrors (no live session) still exist and their writes work because rules are shape-only | `site/identity.js` |
| `site_roles/{uid}` is written ONLY server-side: the estate auth Worker's `/api/estate/site-roles` (approver-gated, ladder-checked via `role-ladder.ts`) or `scripts/seed_site_admin.py` break-glass. Browsers can `get` their own doc, never list, never write | rules `site_roles` block + `site-roles.ts` |
| The estate ladder `guest < member < contributor < moderator < admin < owner` is already grantable from `/admin`; `member`/`contributor` are stored but **grant nothing** until rules or a Worker enforce them (`rulesEnforced: false` in `ROLE_CAPABILITIES`) | `role-ladder.ts` |
| The library Worker verifies Firebase ID tokens against the **same** Firebase project (`audiobook-catalog`) and gates routes with `requireCapability()`; estate check runs in SHADOW with a built enforce arm | `library_catalog/apps/worker/src/middleware/auth.ts`, `estate-auth-shadow.md` |
| The library's review bridge deliberately does NOT write reviews server-side: the Worker builds the doc, the **browser** writes it under the same open rules, to the same `reviews` collection | `library_catalog/apps/worker/src/routes/reviews.ts` header |
| `cw_requests` delete is performed by `app/tools/fetch_content_warnings.py` over REST with the **public web key** (`request.auth` null) — `allow delete: if true` is load-bearing | rules comment + tool |
| Estate `/seen` uses per-app bearers `ESTATE_APP_TOKEN_LIBRARY/_GAMES/_INDEX`; there is **no** `_AUDIOBOOK` token yet | `auth-worker/src/env.ts:76–82` |
| `pipeline_requests` create is open-with-token-shape; the watcher on the home machine validates the shared secret; status/heartbeat docs are service-account-only writes | rules pipeline block, `pipeline-status.js` |

---

## 1. Write-surface inventory (measured from the pages' JS, 2026-08-16)

**78 Firestore write call-sites** (`setDoc/addDoc/updateDoc/deleteDoc/`
`runTransaction`) across 10 client files, touching **22 collection families**
(each with a `_dev` twin except the deliberately unsuffixed `site_roles` and
`pipeline_*`). Surface by surface:

### index.html (the 42k-line generated catalog) + account-modal.js + identity.js
| Write | Collection | Today's gate | After |
|---|---|---|---|
| Submit/edit review (`reviews.js submitReview`) | `reviews` | open, `validReview()` shape | **browser-direct** (Phase 5 adds uid-stamping) — the library bridge shares this path |
| Delete review (`reviews.js deleteReview`) | `reviews` | `isSiteAdmin()` (rules) | **audiobook-worker** `DELETE /api/reviews/:id` — capability `removeAnyReview` (admin+), estate-checked |
| Currently-reading / favorites (3 call-sites) | `profiles` | open, `validProfile()` | browser-direct |
| Profile ensure at sign-in (`ensureProfile`) | `profiles` | open | browser-direct (part of sign-in — constraint: untouched) |
| TBR shelf add/remove (2 call-sites) | `readingLists` | open | browser-direct |
| Add/delete content warning (`user-warnings.js`) | `user_content_warnings` | open shape / open delete | browser-direct; **mod-sweep delete** later via worker (moderator+) |
| Request warning check | `cw_requests` | create-only, shape | browser-direct — ⚠️ delete stays `if true` for the REST tool |

### guess-game.html
| Write | Collection | Today | After |
|---|---|---|---|
| Leaderboard entry, game stats on profile | `leaderboard`, `profiles` | open, shape | browser-direct (reads identity synchronously — untouched) |

### clubs.html (list + create) via clubs.js
| Write | Today | After |
|---|---|---|
| `createClub` (+ first member doc) | open; claimed-at-birth roster may only contain caller's uid | browser-direct (create is a member action) |
| `joinClub`, `requestToJoin`, `acceptInvite`, `declineInvite` | open (display-name identity) | browser-direct until Phase 5 |

### club.html (club management) via clubs.js
| Write | Today | After |
|---|---|---|
| `updateClubDetails` — STRUCTURAL fields (`joinMode`, `features`) | `canManageClub` in rules (claim-gated) | **worker** — capability `manageClub` (club managerUids OR moderator-tier per field map) |
| next-meeting fields (OPERATIONAL) | `canOperateClub` (site moderator too) | **worker** — capability `operateClub` (moderator+ or club manager) |
| `setClubDiscordWebhook` / `clearClubDiscordWebhook` + mask (RESTRICTED) | `canAdministerClub` (site admin only) | **worker** — capability `administerClub` (admin+); webhook value never returns to a browser |
| `claimManagerRole` (stamps own uid into `managerUids`) | RESTRICTED field → admin-only since 2026-08-16 (TOFU claiming on unclaimed clubs) | **worker** — claiming becomes an explicit endpoint with audit |
| `setMemberRole`, `removeMemberBySlug`, `acceptRequest`, `rejectRequest`, `inviteMember` | shape-only (presentation roles) | **worker** for the mod-tier ops; plain joins/leaves stay browser-direct |
| `leaveClub` (incl. host-transfer transaction) | open | browser-direct (member action; the transfer is why member-doc roles stay shape-only) |
| `deleteClub` | `canManageClub` once claimed | **worker** — `manageClub`, estate-checked. ⚠️ **Did NOT move in the 2026-08-17 MANAGECLUB SPLIT** — this is the destructive row option B deliberately kept at the admin floor |
| Edit-modal name/description/emoji (any member) | open by design | browser-direct |

### club-read.html (reads, discussion) via club-reads.js
| Write | Today | After |
|---|---|---|
| `startRead` | open (member action) | browser-direct |
| `setReadSchedule` (milestones — OPERATIONAL) | `canOperateClub` | **worker** — `operateClub` |
| `finishRead` / `removeRead` / ratings-reveal (LIFECYCLE) | `canOperateClub` — **club managers + site moderator, `firestore.rules` TODAY** (MANAGECLUB SPLIT, 2026-08-17) | **worker** — `operateClub` |
| read `slot` assignment (STRUCTURAL) | `canManageClub` | **worker** — `manageClub`. Left behind by the split on purpose: nothing UPDATES `slot` (stamped at create), so this guards re-slotting alone |
| `updateReadLabel`, `commentCount`/`ratingCount` bumps | open | browser-direct |
| `addComment`, `toggleReaction`, `togglePin` | open shape | browser-direct; `deleteComment` by a mod → **worker** later (own-delete stays direct) |
| `setProgress` / `setChapterProgress` | open | browser-direct |
| `addQuote` / `deleteQuote` | open | browser-direct / mod-delete via worker later |
| `createPoll`, `setPollStatus`, `deletePoll` | `canOperateClub` | **worker** — `operateClub` |
| `castVote` | open + poll-is-open get() | browser-direct |
| `submitRating` / `deleteRating` (blind until reveal) | open write, read-gated | browser-direct (read gate stays in rules — it protects READS, which rules do well) |
| RSVP (`meetingAt`-stamped) | open | browser-direct |
| TBR add/remove/vote | open | browser-direct |

### Everywhere (club-notify.js)
| Write | Today | After |
|---|---|---|
| `club_seen` seen-map | open | browser-direct |

### admin.html / estate /status (pipeline-status.js)
| Write | Today | After |
|---|---|---|
| `pipeline_requests` create (trigger token) | token-shape rules + watcher validation | **UNTOUCHED** (hard constraint #3) |

**Frozen, not migrated:** `users` (passphrase accounts — create-only, frozen
2026-08-14; the collection dies by attrition, no worker surface).

### The split, summarised
Role-gated and destructive actions (~14 write paths across 6 families) move
behind the Worker. Member self-writes (~60 call-sites) **stay browser-direct
under rules** — deliberately: they are the "anyone who can load the page"
surfaces the trust model documents as open, the library review bridge depends
on one of them, and moving them buys zero enforcement until per-doc uid
binding exists (Phase 5). "Move the write paths behind a worker" here means
*move the decisions rules cannot make*; the open member surfaces were never
decisions, they are shape checks, and shape checks are what rules are good at.

---

## 2. Which Worker — recommendation: a NEW `audiobook-worker`

**Recommendation: a new, thin `catalog-platform/apps/audiobook-worker`, not
routes bolted onto the existing auth-worker.**

Reasoning:
1. **The estate's own separation of concerns** (auth-worker `index.ts` header):
   *"the estate answers in/out; the apps answer what/here."* The auth-worker is
   the membership directory — grant/revoke, sessions, ops. Making it also the
   audiobook content API couples the household's most trust-critical deploy to
   its busiest feature surface; a bug in a club-comment endpoint must never be
   able to take down grant/revoke for every app.
2. **Convergence is the goal.** Library and games each run their own Worker
   that verifies tokens locally and consults the estate via `/seen` with a
   per-app bearer. The audiobook site joining as a *fourth consumer of the same
   pattern* is the migration; joining as a special tenant inside the directory
   Worker would be a new, fifth pattern.
3. **The pieces are already shared.** `@platform/estate-auth` (resolveIdentity,
   the shadow/enforce gate) lives in this repo, so a Worker here needs no
   cross-repo sync (the library's `sync-estate-auth.mjs` exists only because it
   lives in a different repo). The service-account Firestore REST helpers
   (`firebase-sa.ts`) can be lifted into a shared package both Workers use.

Shape of the new Worker:
- **Auth:** `resolveIdentity` verifying Firebase ID tokens against project
  `audiobook-catalog` (same verifier as library — same issuer/audience checks,
  `email_verified` refusal).
- **Roles:** read `site_roles/{uid}` via service account (see §3) →
  `effectiveLadderRole()` from `role-ladder.ts` (imported directly — same repo,
  one implementation).
- **Capabilities:** a `can(role, capability)` map in the library's idiom,
  gated per-route with `requireCapability()`; club-scoped checks additionally
  consult the club doc's `managerUids` (the orthogonal "club island" axis —
  ROLES.md keeps it off the ladder on purpose).
- **Estate:** `ESTATE_CHECK` off/shadow/enforce + `POST /seen` with a new
  `ESTATE_APP_TOKEN_AUDIOBOOK` (⚠️ requires adding the token to auth-worker's
  `env.ts` resolver — a small auth-worker change, part of Phase 0).
- **Writes:** Firestore REST via `FIREBASE_SERVICE_ACCOUNT` (bypasses rules —
  which is what lets rules clauses close behind it), honouring `col()` lane
  suffixing via an `ENVIRONMENT`-driven helper exactly like the library's
  `reviewCollection()`.
- **Refusals:** ROLES.md §1e verbatim — never a bare status; what happened /
  what it needs / how to get it; the four causes kept distinct; controls the
  role cannot use are not rendered (`/api/me` tells the client what to render).
- **Hostname/CORS:** same pattern as auth-worker's `meCors()` — exact-origin
  allow-list of the audiobook site's prod + dev-lane origins. (Exact hostname
  NOT verified here — pull it from `audiobook_catalog/docs/access/` at build
  time.)

---

## 3. Role source of truth — during and after

**`site_roles/{uid}` in Firestore stays THE role database, before, during and
after.** Roles resolve live *through the worker* but *from* that collection.

Why not move roles into a new D1 (the library's shape):
- The estate `/admin` federation **already writes** `site_roles` (grant,
  revoke, ladder checks, D1 audit trail via `site_role_grant_log`), and
  `clearSiteRoleOnRevocation()` already targets it. A second store means a
  reconciler and a drift story on day one — ROLES.md §1f's D1-vs-Firestore
  warning is about exactly this shape.
- `firestore.rules` must keep consulting it **throughout the transition**
  (club tiers stay rules-enforced until their worker phase lands). A D1 copy
  would put the transition period on two diverging sources.
- "Roles in a database" is satisfied: Firestore is the database; the point of
  the owner's decision is *server-side resolution*, not a particular engine.

During migration:
- Rules keep reading `site_roles` for the clauses that still enforce
  (`siteRoleIs()` helpers) — unchanged.
- The worker reads the same doc via service account, caches it per-uid for
  **10 minutes max** (the estate's `REVOCATION_DELAY_MS` convention — the TTL
  *is* the revocation delay), and combines it with the estate verdict:
  `effectiveRole = estate revoked → guest; else ladder(site_roles doc)`.
  This is the structural fix for the revoked-admin incident: even if the
  best-effort Firestore clear fails, the worker's live estate check refuses.

After (end state):
- Every ROLE decision lives in the worker. Rules shrink to: shape validation,
  public reads, the blind-ratings **read** gate, `request.auth`/uid-binding
  checks (Phase 5), and `write: if false` on everything the worker owns.
  The `siteRoleIs()/canManageClub/canOperateClub/canAdministerClub` helper
  family and their three field-tier diffs (~120 lines of the hardest-to-reason
  logic in the file) delete outright; the club blocks collapse toward
  "member shapes open, manager fields `if false`".
- `site_roles` remains: the estate `/admin` grant UI, the seed script, and the
  worker's reads all keep their single store. Browser `get`-own-doc stays so
  the account modal can say "you are a moderator" without a worker round-trip.

---

## 4. The SHADOW phase (the estate's proven pattern, applied to a static site)

The library/games shadow ran *inside* their Workers because every request
already passed through one. The audiobook site's writes go straight to
Firestore, so the shadow must be **additive telemetry**, not an interception:

**Mechanism — the shadow reporter:**
- The worker exposes `POST /api/gate/shadow` (mode-gated: inert unless
  `ESTATE_CHECK` ∈ {shadow, enforce}).
- A ~30-line client module (`site/gate-shadow.js`) exports
  `reportGate(action, context)` — **fire-and-forget**: called *after* the
  existing Firestore write path runs (success or failure), never awaited,
  never able to block, every error swallowed. Wired into exactly the write
  paths destined for the worker (§1's "worker" rows) plus review
  create/update (to measure Phase 5's population).
- The payload: action name, lane, club id where relevant, and the Firebase ID
  token **when a live session exists** — a legacy v1 session sends none, which
  is itself the measurement.
- The worker runs the FULL future gate — verify token → estate check →
  resolve ladder role → `can(role, capability)` + club `managerUids` — and
  logs one JSON line in the estate shadow vocabulary, **acting on nothing**:

```json
{"tag":"ab_gate_shadow","action":"club.setSchedule","lane":"prod",
 "tokened":true,"email":"…","ladder_role":"moderator","estate":"approved",
 "club_manager":false,"would_deny":false,"reason":null}
```

**What gets measured (per surface, over days):**
1. `would_deny:true` lines — requests that succeeded today but the gate would
   refuse. The rollout gate, same as library's.
2. `tokened:false` lines — legacy/v1 sessions still performing gated actions.
   Each one is a person the enforce flip would break; zero is the target,
   otherwise the owner decides per person (upgrade nudge already exists).
3. `estate` distribution — confirms every household actor reads `approved`
   with fresh sources before anything enforces.

**Behaviour change during shadow: none, by construction.** The Firestore write
already happened (or already failed) before the reporter fires; the reporter
cannot alter a response because nothing consumes its response. This honours
the global rule: off → shadow (log would-deny, act on nothing) → enforce,
flipped only on measured zero false denials, never as a side effect.

**The flip criterion (per surface, evidence-gated, owner-approved):**
> Days of shadow soak on that surface with **zero `would_deny:true` lines for
> household members** and **zero `tokened:false` lines** (or each remaining
> one explicitly waived by the owner), while both club-manager and
> site-moderator actors have exercised the surface at least once with
> `estate:"approved"` from a fresh source.

A surface that nobody exercised during soak has not soaked — absence of lines
is only evidence when the action demonstrably ran (the library learned this:
exercise the change, don't reason about it).

---

## 5. The phased plan

Each phase independently shippable, reversible, verifiable. **Every
`firestore.rules` deploy is an explicit owner-gated step** (standing
permission: `firebase deploy --only firestore:rules` from main, smoke test
after, prod and `_dev` blocks in step, never a side effect of anything else).

### Phase 0 — Scaffold (no behaviour change, no rules change)
- `apps/audiobook-worker`: resolveIdentity + `/api/health` + `/api/me`
  (answers `{role, capabilities, estate}` for the caller — read-only).
- Auth-worker: add `ESTATE_APP_TOKEN_AUDIOBOOK` to `env.ts`'s resolver; mint
  the secret both sides.
- Capability map committed (see §6) with unit tests in the `role-ladder.ts`
  idiom.
- **Verify:** `/api/me` answers correctly for owner, a moderator, a guest.
- **Reverse:** delete the worker; nothing referenced it.

### Phase 1 — SHADOW (client telemetry, no enforcement)
- `site/gate-shadow.js` + `reportGate()` calls on the §1 worker-bound paths;
  `ESTATE_CHECK="shadow"`.
- **Verify:** `wrangler tail | grep ab_gate_shadow` shows lines for each
  exercised surface; site behaviour byte-identical (writes still direct).
- **Reverse:** mode `off` (reporter becomes a 204 no-op) or remove the calls.
- **Soak:** per §4's criterion, surface by surface.

### Phase 2 — UI truth from the worker (presentation only)
- Club pages and admin.html render gates from `/api/me`'s capability answer
  instead of duplicating ladder logic client-side (identity.js keeps
  `resolveAdmin()` as fallback). §1e refusal UX strings land here.
- **Verify:** controls render identically for each role; no enforcement moved.
- **Reverse:** client-only revert.

### Phase 3 — Enforce wave A: the destructive/role-gated writes
The surfaces marked **worker** in §1: review delete; club structural/
operational/restricted updates; webhook set/clear; claim; mod-tier member
ops; poll create/close/delete; read lifecycle/schedule; club delete.
- 3a. Worker endpoints live, client switched behind a per-surface flag
  (old direct-write path kept in code one release).
- 3b. **Owner-gated rules deploy #1:** the moved clauses close —
  `allow delete: if false` on `/reviews` (worker's service account bypasses
  rules), manager/restricted field diffs → `if false`, `canOperateClub`
  clauses removed. `siteRoleIs()` helpers survive only while any consumer
  remains. Smoke test: a moderator schedules a read via the UI; a non-role
  devtools write of a structural field is REFUSED; review delete works from
  admin UI and fails from console.
- **Reverse:** flip the client flag back AND redeploy the previous rules file
  (kept as the rollback artifact) — two independent levers, both cheap.
- ⚠️ Shipped only after that surface's shadow soak passes. Waves may split
  further (reviews-delete alone is a fine first slice).

### Phase 4 — File-level permissions (the NEW capabilities — no rules involved)
The ROLES.md §1b ask, absorbed here because it is the same migration:
- `GET /api/download/:bookId` — capability `download` (**admin+**, see below):
  answers a short-lived signed/proxied URL to the shelf server or Drive file.
  This is a **gated READ behind the worker** (constraint #1's second half).

  ⚠️ **The floor moved `member` → `admin` on 2026-08-17**, by owner directive,
  verbatim: *"For ebooks I don't want a download check box, I want to use roles
  we have. Set up the roles to match library."* The `member+` written here was a
  placeholder committed during this design phase and never enforced by a shipped
  route; `capabilities.ts` now floors `download` at `admin`, and
  `capabilities.test.ts` pins it.

  **The two-capability decision is UNCHANGED — only the GRANT MECHANISM moved.**
  Reading and downloading were always meant to be two separate capabilities, and
  they still are:

  | Capability | Grant | Where it lives |
  |---|---|---|
  | See the shelf + read in the viewer | estate `vis_ebooks` | the **Ebooks visible** checkbox on the admin page's **Audiobooks/Ebooks** row |
  | Take the file away | ladder `download`, floor `admin` | **promotion** on that same row's role dropdown |

  (⚠️ Those were two separate rows until 2026-08-17, when the owner merged them:
  *"instead of a new line for ebooks in the auth page, just make it
  Audiobook/Ebooks."* One site, one ladder, one line — the two capabilities and
  the two grants behind them are unchanged.)

  What changed is that the second briefly had its OWN per-person checkbox
  (`dl_ebooks`, migration 0009, shipped 2026-08-16) and no longer does. That
  column, its route, its admin toggle and its `download_ebooks` wire field were
  all removed the next day; the column survives in D1 unread (migration 0010
  records why it was not dropped). A download grant is now exactly a promotion —
  the way this estate's library grants every capability it grants.
- `POST /api/upload` — capability `upload` (contributor+): lands in a staging
  INBOX **outside the rclone sync target** with validation + dedupe + promote
  (both hazards from the audiobook TODO honoured: rclone `sync` deletes
  server-side strays; nothing reaches the pipeline's canonical input
  unvalidated).
- Drive ⇄ role reconciler: **report-only first** (ROLES.md §2 — the measured
  drift is 10/15 people; the owner decides per person before anything moves).
- **Verify:** an `admin` can download; a `member` can upload nothing and
  download nothing; a `contributor` can upload and NOT download (the two floors
  deliberately cross); a `guest` sees neither control and gets the §1e sentence
  if they hit the endpoint anyway.
- **Reverse:** endpoints off; nothing else depended on them.

### Phase 5 — uid-binding on member self-writes (LAST, optional-until-wanted)
- Live-session clients start stamping `authorUid` on reviews, comments,
  quotes, ratings, progress, RSVPs (additive field — `validReview()` etc.
  ignore extras, measured in the library bridge's rules audit).
- After a stamped-coverage soak (measured via the same shadow tail), **owner-
  gated rules deploy #2:** create/update on those docs require
  `request.auth != null` and own-doc updates require uid match. ⚠️ This is
  the step that ends legacy v1 sessions and constrains the library bridge —
  the library's browser holds a live session on the same Firebase project, so
  its review writes carry `request.auth` (reasoned from its auth middleware,
  **not exercised — verify before this deploy**). Coordinate the two repos;
  this phase does not ship until the tokenless-writes measurement reads zero.
- **Reverse:** rules rollback; the stamped fields are inert extras.

### Phase 6 — Rules shrink to end state
- Delete the role-helper family; collapse club blocks; leave shape checks,
  public reads, the ratings read-gate, uid bindings, `write: if false` on
  worker-owned surfaces. One final owner-gated deploy + full smoke pass.
- ⚠️ `cw_requests` delete stays `if true` until `fetch_content_warnings.py`
  moves to the service account (a one-line tool change — do it here, then
  close the clause in the same deploy).

---

## 6. Capability matrix → concrete gates (ROLES.md §1b mapped to this site)

`manager → moderator` preserved; `guest`/`member`/`contributor`/`admin` are
new rungs nobody migrates into. Club managers (`managerUids`) stay orthogonal.

⚠️ **Revised 2026-08-17 — the CLUB MANAGER package (owner-approved: "Yes I'm
good with your club logic").** The 2026-08-16 tightening had one admin-only
`administerClub` covering both the Discord webhook and `managerUids`. The
shadow soak's blocker 4 showed why that could not stand: the surface was
unexercisable, and `claimManager` was **self-blocking** — claiming is how one
*becomes* a club manager, so an admin floor on it meant nobody below admin
could ever reach the club island at all. The capability split in two:

- **`administerClub`** — the club's own settings. Club-scoped power over a
  club you already run, so the **island holds it**; floor drops `admin` →
  `moderator` so the island can never out-rank the ladder (a bound manager
  may hold no rung whatsoever).
- **`claimClub`** — the roster itself. **Island OFF, permanently**: a manager
  appointing co-managers is the peer-escalation ROLES.md outlaws. Claiming an
  already-claimed club is moderator+ (the override path). One narrow open
  arm: an **unclaimed** club is first-come-first-served to any live session.

⚠️ **"any member may claim" does NOT mean the `member` RUNG** — that rung is
granted and essentially nobody holds it, so flooring the claim there would
re-create the self-blocking AND diverge from `firestore.rules`, which cannot
test a rung and enforces "signed in". `CLAIM_UNCLAIMED_FLOOR` in
capabilities.ts is the one-line lever if the owner ever means the rung.

⚠️ **The inversion above was HALF answered later the same day — the
MANAGECLUB SPLIT (owner decision, option B verbatim).** `manageClub` still
keeps its `admin` floor while being island-held, so a site moderator still
cannot toggle a claimed club's `features`/`joinMode` though a rankless club
manager can. What the owner DID decide is the read lifecycle: `read.finish`,
`read.remove` and `read.revealRatings` moved to `operateClub` (island on) —
manager-of-this-club **or** site moderator+ — while `club.delete` and
`club.updateStructural` stayed exactly where they were.

The line drawn is **"running the reading" vs "destroying the thing"**, not
"club-scoped vs site-wide". So the remaining open question is narrower than
it was: only `features`/`joinMode`/`deleteClub` still sit above the site
moderator. `firestore.rules` enforces the split LIVE (audiobook_catalog
`f3f0a3f`, deployed + **36/36 REST smoke assertions**), and the worker's
dormant arms match.

⚠️ **Unlike every other row, these two are enforced by `firestore.rules`
TODAY**, not only by the dormant worker — the site's live gate was changed in
the same package (audiobook_catalog `84009e7`, deployed and smoke-tested).

| Capability | guest | member | contributor | moderator | admin | owner | Enforced by (end state) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| `read` (site, reviews, stats, clubs) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | nothing — world-readable stays |
| `rate` / `trackReading` / club member actions | ✅* | ✅ | ✅ | ✅ | ✅ | ✅ | rules (shape now; + uid binding after Phase 5). *Today open to all; Phase 5 narrows to "signed in", not to `member` — rating a book was never meant to need a granted role |
| `download` (shelf/Drive file access) | | | | | ✅ | ✅ | **worker** Phase 4; Drive parity via reconciler. ⚠️ **admin+ since 2026-08-17** (was member+) — owner: *"use roles we have… match library"*. This capability replaced the per-person `dl_ebooks` checkbox entirely: the grant IS the promotion |
| `upload` (inbox → validated promote) | | | ✅ | ✅ | ✅ | ✅ | **worker** Phase 4 |
| `operateClub` (schedule, polls mgmt, next meeting, membership ops, content deletes, **read lifecycle** — any club) | | | | ✅ | ✅ | ✅ | **worker** Phase 3 + `firestore.rules` today for the read lifecycle (club managers get it on their own club). Finish/remove/reveal joined this row in the 2026-08-17 MANAGECLUB SPLIT |
| `manageClub` (structural: features, joinMode, read `slot`, **club delete** — any club) | | | | | ✅ | ✅ | **worker** Phase 3 (club managers on their own club). ⚠️ The destructive half; option B deliberately left it here |
| `administerClub` (the club's own settings — the Discord webhook) | | | | ✅ | ✅ | ✅ | **worker** Phase 3 + `firestore.rules` today — **club managers hold it on their own club** (2026-08-17) |
| `claimClub` (writing `managerUids`) | | | | ✅ | ✅ | ✅ | **worker** Phase 3 + `firestore.rules` today — **never** club managers; an UNCLAIMED club is first-come-first-served to any live session |
| `removeAnyReview` | | | | | ✅ | ✅ | **worker** Phase 3 |
| `manageUsers` (grant strictly beneath self) | | | | ✅† | ✅ | ✅ | already live: auth-worker `canGrant()` — †moderator+ per `GRANT_FLOOR` |
| grant `admin` | | | | | | ✅ | already live: `canGrant()` (nothing outranks owner) |

---

## 7. What explicitly does NOT change

- **The static site.** World-readable generated `index.html`/`stats.html`/CSV;
  the pipeline that generates them; the two-lane Pages deploy and `col()`
  suffixing.
- **When/how auth initialises on the client.** identity.js v2 flow —
  `handleRedirectResult` on every sign-in surface, the localStorage mirror,
  the legacy-upgrade path, `ensureProfile` at sign-in — verified live across
  four surfaces and untouched.
- **The pipeline, entirely.** Heartbeat/status service-account writes,
  `pipeline_requests` token+watcher trigger, the 8h schedule, the estate
  `/status` Operations controls.
- **Public load-bearing reads.** `reviews` and `profiles` open reads
  (stats.html aggregates both; community.html adds `readingLists` + `clubs`;
  the shared review store is read cross-catalog) — measured 2026-08-16;
  nothing closes them.
- **The library review bridge's browser-write model** — until and unless
  Phase 5, and then only as a coordinated two-repo change.
- **`site_roles` as the role store**, the estate `/admin` grant UI,
  `canGrant()`/`GRANT_FLOOR`, `seed_site_admin.py` break-glass,
  `clearSiteRoleOnRevocation()` (the worker adds a live check in front of it;
  it stays as defence in depth).
- **`users`** (frozen), **`leaderboard`**, **`club_seen`**, guess-game.
- **The blind-ratings read gate and the webhook `read: if false`** — rules
  keep guarding reads they already guard well.
- **`cw_requests` open delete** until the tool moves to the service account
  (Phase 6, same deploy).
- **Cloudflare Access on the shelf** — the email-list decision stands
  (ROLES.md §3); Phase 4's download URLs work *with* it, not around it.

## 8. Not measured / open at design time

- **Legacy-session population** performing gated writes — unknowable from the
  repo; Phase 1's `tokened:false` count is the instrument built to answer it.
- **Library review writes carrying `request.auth`** — reasoned from its
  middleware (same Firebase project), not exercised. Must be exercised before
  the Phase 5 rules deploy.
- **The audiobook site's production hostname(s)** for the worker's CORS list —
  take from `audiobook_catalog/docs/access/` at build time.
- **Live deployed `firestore.rules` == repo copy** — assumed in step (the
  standing rule keeps them so), not diffed against production today.
- **Per-surface traffic volumes** — the shadow soak measures them.
- **Whether estate `/seen` needs more than the env-token addition** for a
  fourth app — check `estate-auth-design.md` §4.4 at Phase 0.
