# Mutation run — the auth / roles / gates group, all three TS repos (2026-09-05)

> **Audience:** the owner (this answers his *"do we truly need all of them"* the
> way the estate's own standing advice says it must be answered), and future
> Claude/Kiro sessions second. **Status:** TRACKED.
> **Last verified: 2026-09-05** — every row below was **executed on that date**:
> 51 hand-written mutations applied one at a time to real source, the named test
> files run, the result read off the runner's own exit code, and the file
> restored before the next one. Nothing here is reasoned; all of it was watched.
>
> **Why this exists.** [`test-inventory-2026-09-05.md`](test-inventory-2026-09-05.md)
> §2.7 and §5.6: *"a test count is not evidence — mutate the code and watch"*.
> The estate's only mutation evidence was **8 mutations from 2026-08-16**, whose
> single survivor led straight to a live privilege-retention bug. This run
> re-applies that method to the largest and most security-bearing group in the
> suite (77 files / ~1,382 cases by the inventory's count).
>
> ## 🔴 THE HEADLINE
>
> **51 mutations · 42 KILLED · 9 SURVIVED (82.4% kill rate).** The pure
> predicates and the pure ladders are extremely well tested — every single
> mutation to `approverAllows` / `devopsAllows` / `devAccessAllows` /
> `memberAllows` / `canGrant` / `canGrantRole` / `roleAtLeast` /
> `effectiveVisibility` / `combineEstateAndLocal` died, usually to a test whose
> NAME is the rule. **Eight of the nine survivors sit in exactly two places:**
> the **middleware wrappers** that call those predicates (4 survivors across all
> three repos) and the **code paths behind an I/O boundary a unit test does not
> cross** (3 survivors in `verify.ts` and the cached-column parsers).
>
> ⚠️ **WHAT WAS NOT CHECKED, and it matters:**
> - **`audiobook_catalog` was NOT in scope** — the brief named three repos. Its
>   Python role tests are still evidenced only by the 2026-08-16 run.
> - **No route-level or integration mutation was attempted.** Every mutation was
>   to a module the named tests import; nothing was deployed, no live request was
>   made, no D1 was read, no browser was opened.
> - **A SURVIVED row means "the test files named in that row all passed"** — NOT
>   "no test anywhere in the estate would have caught it". Test selection was
>   deliberately narrow and fast (see §1). A survivor is a lead, not a verdict.
> - **`.dev.vars`, `.env*`, `docs/access/keys/` and `CREDENTIALS.md` were not
>   opened.** No secret value appears here.
> - **Nothing was changed in any shared working tree.** All 51 mutations were
>   applied inside throwaway detached worktrees which were verified
>   `git status --short` empty and then removed (§1.2). This file and its row in
>   [`README.md`](README.md) are the only writes.
>
> **Commits under test** (HEAD of each repo when the run started; all three
> repos moved during the run because other agents were committing — these are
> the commits the numbers describe):
>
> | Repo | Commit |
> |---|---|
> | `catalog-platform` | `1fea14e` |
> | `bookbuddy/library_catalog` | `744f866` |
> | `boardbuddy/Board_Game_Catalog` | `cbf9cd4` |

---

## 1. Method

### 1.1 The mutation protocol

Hand-written, no mutation framework, no new dependency (the estate has none and
this run did not add one). For each auth/role/gate decision point:

1. apply **ONE** small semantic change — invert a comparison, drop a role from
   an allowlist, make a refusal return the success shape, skip a revocation
   check, swap `&&`/`||`, short-circuit a gate to `if (false && …)`;
2. run **only** the relevant test files (2–5 files, 1–4 s), never a full suite;
3. record **KILLED** (the runner exited non-zero) or **SURVIVED** (all green);
4. restore the file from the in-memory original — in a `finally`, so a crash
   cannot leave a mutation behind;
5. next.

**Every group was run UNMUTATED first** and had to be green before any mutation
was applied to it. Every `find` string was asserted to occur **exactly once** in
its file; a zero or ambiguous match is reported, not silently skipped. Both
guards matter: a baseline that was already red would have reported every
mutation in that group as KILLED for free.

The driver, the spec and the raw results are scratchpad-only and are not
tracked; the tables below are the record.

### 1.2 The harness — and the two things that would have faked the result

Other agents were editing all three trees throughout, so nothing was mutated in
a shared checkout. Each repo got a throwaway `git worktree add --detach … HEAD`
with `node_modules` junctioned from the real checkout, per
[`worktree-deploys.md`](worktree-deploys.md). ⚠️ **Two harness problems each
looked exactly like a clean result and neither announced itself:**

| Trap | What it would have produced | The fix used |
|---|---|---|
| 🔴 **The junctioned `node_modules` carries the WORKSPACE SYMLINKS, and they point at the REAL checkout.** `@bgc/core`, `@lc/core`, `@platform/estate-auth` in the worktree all resolved to the *unmutated* source in the shared tree. | Every mutation to a workspace package would have SURVIVED — for a reason that has nothing to do with the tests. The most dangerous possible false negative. | A real (non-junction) `<wt>/apps/node_modules/@scope/*` and `<wt>/packages/node_modules/@scope/*` pointing at the worktree's own packages. Node walks the nearest `node_modules` first, so these shadow the root junction for everything under `apps/` and `packages/`. Proof it worked: `LC-09`, `LC-10`, `BD-01`…`BD-05` are killed by tests that import via the scope alias. |
| ⚠️ **The sync-generated sources are gitignored, so a fresh worktree does not have them** (`library_catalog/packages/{estate-auth,universes,gabi-conv}/generated/`, `Board_Game_Catalog/apps/worker/src/estate-auth/`). `pretest`'s sync scripts cannot run in a worktree (that repo's `gotchas.md`). | `ERR_MODULE_NOT_FOUND` on the baseline — which at least fails loudly, but would have made every library and board mutation read KILLED. | Copied from the real checkout, which is what `pretest` would have produced. |

Two smaller notes, recorded because they cost time: `library_catalog` will not
check out into a deep scratchpad path (`Filename too long` on two cover JPEGs) —
it was given `C:/mutwt/lc` instead; and `spawnSync('npx.cmd', …)` fails
`EINVAL` on this Node/Windows pair, so the driver spawns through `shell: true`.

**Teardown, in the order [`worktree-deploys.md`](worktree-deploys.md) §3
insists on:** every junction removed **as a link first** (`fs.rmdirSync`, which
does not follow a reparse point — 73 links), then `git worktree remove --force`.
The real `node_modules/.bin` counts were taken either side and are unchanged:
**51 / 69 / 72**, with 197 / 115 / 119 packages beside them.

### 1.3 What "the relevant test files" meant

| Group | Files run |
|---|---|
| cp · auth-worker gates | `gates` · `revoke-clears-powers` · `dev-access` · `me` · `universe-requests` · `catalog-requests` · `estate-probes` · `ops` (per row) |
| cp · auth-worker ladder | `role-ladder` · `site-roles` · `revoke-clears-site-role` |
| cp · auth-worker visibility | `visibility` · `me` · `me-contract` |
| cp · estate-auth | `combine` · `seen` · `config` · `probes` · `verify` (per row) |
| cp · index-worker | `scope` · `search` · `machine-read` · `rows` · `catalogs` · `auth` (per row) |
| lc · gate | `packages/estate-auth/test/{gate,billing-denied-shape,instance-estate-app}` |
| lc · capabilities | `packages/core/test/capabilities` · `apps/worker/src/routes/{capability-wiring,users-role-guard,peer-holdings-auth}` |
| bd | `apps/worker/src/lib/{capabilities,role-grant,export-fields,estate-app,estate-refusals,estate-auth-posture,instance-template}` |

---

## 2. `catalog-platform` — 26 mutations, 23 KILLED, 3 SURVIVED

### 2.1 `apps/auth-worker/src/middleware/auth.ts` — the four gate predicates

| # | Line | Mutation | Result | Killed by |
|---|---:|---|---|---|
| CP-01 | 58 | `approverAllows`: drop `status === 'approved'` (**the exact 2026-08-16 live bug, re-introduced**) | ✅ KILLED (4 fail) | *"⚠️ a REVOKED approver is refused, flag or no flag"* |
| CP-02 | 65 | `devopsAllows`: opened to **anyone not banned** (`row?.status !== 'revoked'`) — **the 2026-08-16 SURVIVOR, re-run** | ✅ KILLED (11 fail) | *"dev access is OFF by default — approval alone grants nothing"* |
| CP-03 | 65 | `devopsAllows`: drop the `is_approver` arm (approvers fenced out of devops) | ✅ KILLED (4 fail) | *"devops: an approver qualifies implicitly, without the devops flag"* |
| CP-04 | 95 | `devAccessAllows`: drop `status === 'approved'` | ✅ KILLED (1 fail) | *"⚠️ status gates it: a pending or revoked row is refused, flag or no flag"* |
| CP-05 | 118 | `memberAllows`: admit `pending` as well as `approved` | ✅ KILLED (3 fail) | *"availability is members-only"* |
| CP-06 | 170 | Four-causes collapse: the **revoked** refusal answers `estate_pending` | ✅ KILLED (2 fail) | *"⚠️ pending and revoked get DIFFERENT sentences — the fixes are different"* |
| CP-07 | 160 | Four-causes collapse: the **no-row** refusal answers `estate_pending` | ✅ KILLED (2 fail) | *"somebody with no directory row at all is told how to get one"* |
| CP-08 | 287 | 🔴 `requireApprover()`: **the gate itself short-circuited** — `if (false && !approverAllows(row, isOwner))` | 🔴 **SURVIVED** (50 pass) | — |

### 2.2 `apps/auth-worker/src/role-ladder.ts` — the audiobook site ladder

| # | Line | Mutation | Result | Killed by |
|---|---:|---|---|---|
| CP-10 | 105 | `roleAtLeast`: `>=` → `>` (a role no longer satisfies itself) | ✅ KILLED (8 fail) | *"roleAtLeast: reflexive, and correct in both directions"* |
| CP-11 | 132 | `canGrant`: the `GRANT_FLOOR` (moderator) check removed | ✅ KILLED (3 fail) | *"canGrant: contributor holds NO grant power, even over member"* |
| CP-12 | 138 | `canGrant`: strict-beneath weakened to allow **peer promotion** | ✅ KILLED (7 fail) | *"canGrant: owner -> owner FAILS — no path for owner to touch owner"* |
| CP-13 | 79 | `SITE_ROLES` gains `'owner'` (the DB-only rung becomes API-grantable) | ✅ KILLED (4 fail) | *"SITE_ROLES: the grantable subset excludes guest and owner"* |
| CP-14 | 173 | `effectiveLadderRole`: a stored role beats `OWNER_EMAILS` | ✅ KILLED (2 fail) | *"BOTH owner accounts resolve to owner … regardless of any stored role"* |

### 2.3 `apps/auth-worker/src/visibility.ts` + `estate-db.ts` — vis_ boundaries and revocation

| # | Line | Mutation | Result | Killed by |
|---|---:|---|---|---|
| CP-16 | 116 | `effectiveVisibility`: **pending** gets the STORED set, not the public slice | ✅ KILLED (5 fail) | *"meAnswer: pending → the public slice, whatever the stored flags say"* |
| CP-17 | 118 | `effectiveVisibility`: **revoked** gets the public slice, not `{}` | ✅ KILLED (6 fail) | *"meAnswer: revoked → {} — revocation beats the public slice"* |
| CP-19 | 140 | `decideStatus`: revocation no longer clears `is_approver` / `is_devops` / `dev_access` | ✅ KILLED (3 fail) | *"revoke clears is_approver and is_devops in the same statement"* |

### 2.4 `packages/estate-auth/src/` — the canonical verifier and the §3.1 table

| # | File:line | Mutation | Result | Killed by |
|---|---|---|---|---|
| CP-20 | `combine.ts:64` | `revoked` no longer beats a standing local approval | ✅ KILLED (1 fail) | *"row 1: revoked beats anything, even a local owner"* |
| CP-21 | `combine.ts:78` | directory unreachable + no admission **fails OPEN** | ✅ KILLED (1 fail) | *"row 8: unreachable + pending/unknown fails CLOSED with the named verdict"* |
| CP-22 | `combine.ts:74` | estate `pending` + no local standing → `default_grant` instead of the request screen | ✅ KILLED (1 fail) | *"row 6: pending + pending = request screen, as today"* |
| CP-23 | `verify.ts:90` | dev bypass widened back to `ENVIRONMENT !== 'production'` | ✅ KILLED (1 fail) | *"the old !== production hole is closed: unrecognised environments get REAL auth"* |
| CP-24 | `verify.ts:117` | 🔴 **the `email_verified === false` refusal deleted** | 🔴 **SURVIVED** (19 pass) | — |
| CP-25 | `verify.ts:110` | 🔴 **`audience: projectId` dropped from `jwtVerify`** — any Firebase project's token is accepted | 🔴 **SURVIVED** (19 pass) | — |
| CP-26 | `visibility.ts:90` | `parseVisibility` **strips** unknown names instead of refusing the array | ✅ KILLED (3 fail) | *"parseVisibility: canonical order enforced, duplicates collapsed, garbage refused"* |

### 2.5 `apps/index-worker/` — search scope and the anonymous boundary

| # | File:line | Mutation | Result | Killed by |
|---|---|---|---|---|
| CP-27 | `middleware/scope.ts:93` | `scopeFromAnswer` falls back to **all** catalogs, not the public slice | ✅ KILLED (1 fail) | *"estate unreachable + valid token + NO cache → the public slice (fail closed, never open)"* |
| CP-28 | `read.ts:69` | `UNSCOPED_LOOKUP_EXCLUDED` emptied — `library2` leaks into the unscoped lookup lane | ✅ KILLED (3 fail) | *"🔴 /api/lookup returns NO library2 row to a member without the grant"* |
| CP-29 | `catalogs-route.ts:304` | **the anonymous branch opens D1 and returns counts** | ✅ KILLED (3 fail) | *"🔴 the anonymous branch NEVER OPENS THE DATABASE — the rule is control flow, not a strip"* |

---

## 3. `bookbuddy/library_catalog` — 13 mutations, 10 KILLED, 3 SURVIVED

| # | File:line | Mutation | Result | Killed by |
|---|---|---|---|---|
| LC-01 | `packages/estate-auth/src/gate.ts:300` | `parseEstateMode`: `'enforce'` silently downgraded to `shadow` — **enforcement disabled while the config still says enforce** | ✅ KILLED (11 fail) | *"enforce / revoked + local owner → deny 403 estate_revoked (row 1)"* |
| LC-02 | `gate.ts:301` | an **unrecognised** `ESTATE_CHECK` value enforces instead of falling to off | ✅ KILLED (2 fail) | *"an unrecognised mode value is off WITH its name in the log"* |
| LC-03 | `gate.ts:200` | `resolveEstateApp`: a typo'd `ESTATE_APP` falls back to `library` — **the F-5 bug re-introduced** | ✅ KILLED (3 fail) | *"a typo does NOT fall back to `library` — that fallback IS the bug"* |
| LC-04 | `gate.ts:561` | enforce mode stops emitting the 403 on `revoked` | ✅ KILLED (3 fail) | *"enforce / fresh revoked cache → deny 403 WITHOUT a /seen call"* |
| LC-05 | `gate.ts:553` | `wouldDeny` drops `estate_unreachable` (the soak's greppable gate goes half-blind) | ✅ KILLED (1 fail) | *"estate down + no cache + local pending → would-deny as estate_unreachable, named"* |
| LC-06 | `gate.ts:255` | `OVERRIDABLE_DEFAULT_ROLES` gains `admin` — one env var could auto-grant admin | ✅ KILLED (1 fail) | *"resolveDefaultRole: unset → posture member; valid override taken; garbage falls back loudly"* |
| LC-07 | `gate.ts:669` | 🔴 `parseCachedBillingDenied`: a **NULL column answers `[]`** — "unknown" becomes "the directory denied nothing" | 🔴 **SURVIVED** (45 pass) | — |
| LC-08 | `gate.ts:427` | 🔴 the `SKIPPED` outcome answers `billingDenied: []` instead of `null` — **an OFF gate claims the directory denied nothing** | 🔴 **SURVIVED** (45 pass) | — |
| LC-09 | `packages/core/src/capabilities.ts:112` | `manageUsers` gains `moderator` | ✅ KILLED (2 fail) | *"admin holds manageUsers; moderator does not"* |
| LC-10 | `capabilities.ts:150` | `canGrantRole`: `<` → `<=` (self-escalation and peer-promotion allowed) | ✅ KILLED (2 fail) | *"admin attempting to grant admin -> FAILS (no self-escalation)"* |
| LC-11 | `capabilities.ts:149` | a `pending` actor may grant | ✅ KILLED (1 fail) | *"a pending actor grants no real role"* |
| LC-12 | `capabilities.ts:29` | 🔴 `trackReading` gains `guest` — a guest may write read-state and rate | 🔴 **SURVIVED** (345 pass) | — |
| LC-13 | `apps/worker/src/middleware/auth.ts:308` | `requireCapability` short-circuited (`if (false && …)`) | ✅ KILLED (**206** fail) | *"GET /works/1/accessories refuses BY NAME as 'read'"* — `capability-wiring.test.ts` |

⚠️ **LC-13 is the most emphatic single result in the run** and it is worth
reading next to CP-08 and BD-06, which are the same mutation in the other two
repos and both SURVIVED. `library_catalog` is the only repo whose capability
middleware is exercised rather than described: `capability-wiring.test.ts` drives
real routes through it and 206 cases went red. See §5.

---

## 4. `boardbuddy/Board_Game_Catalog` — 12 mutations, 9 KILLED, 3 SURVIVED

| # | File:line | Mutation | Result | Killed by |
|---|---|---|---|---|
| BD-01 | `packages/core/src/capabilities.ts:186` | `canGrantRole`: `<` → `<=` | ✅ KILLED (4 fail) | *"admin may not grant its own rung or anything above it"* |
| BD-02 | `capabilities.ts:184` | an off-ladder rank (`pending`) may grant everything | ✅ KILLED (1 fail) | *"pending itself may grant nothing — it is a status, not a rung"* |
| BD-03 | `capabilities.ts:99` | `scanPhoto` gains `contributor` — **the money-gated rung widened** | ✅ KILLED (1 fail) | *"scanBarcode (free, contributor+) and scanPhoto (paid, moderator+) are different rows"* |
| BD-04 | `capabilities.ts:44` | `rate` gains `guest` | ✅ KILLED (1 fail) | *"rate: member and above, not guest"* |
| BD-05 | `capabilities.ts:128` | `manageUsers` gains `moderator` | ✅ KILLED (2 fail) | *"manageUsers: admin and above"* + *"🔴 only admin and owner get the account emails"* |
| BD-06 | `apps/worker/src/middleware/auth.ts:93` | 🔴 `requireCapability` short-circuited — **every capability gate in the repo opened** | 🔴 **SURVIVED** (22 pass) | — |
| BD-07 | `lib/export-fields.ts:62` | `canExportEmails` returns `true` for every role | ✅ KILLED (1 fail) | *"🔴 only admin and owner get the account emails"* |
| BD-08 | `lib/export-fields.ts:75` | the ratings query becomes `SELECT ui.*` (default-deny → default-allow) | ✅ KILLED (1 fail) | *"🔴 the ratings query is default-deny — it never selects ui.\*"* |
| BD-09 | `lib/export-fields.ts:48` | a column dropped from the `USER_ITEM_COLUMNS` allow-list | ✅ KILLED (1 fail) | *"🔴 the allow-list matches the LIVE user_item schema — the drift guard"* |
| BD-10 | `lib/estate-app.ts:120` | a typo'd `ESTATE_APP` falls back to `games` | ✅ KILLED (2 fail) | *"🔴 a typo does NOT fall back to `games` — that fallback IS the bug"* |
| BD-11 | `middleware/estate.ts:231` | 🔴 `if (mode === 'shadow') return null` → `'enforce'` — **enforce stops enforcing and shadow starts refusing** | 🔴 **SURVIVED** (28 pass) | — |
| BD-12 | `middleware/estate.ts:109` | 🔴 `actionFor('revoked')` returns `deny: false` — **a revoked estate member is admitted** | 🔴 **SURVIVED** (28 pass) | — |

⚠️ **BD-08 and BD-09 are the export/projection default-deny pins working
exactly as designed** — the added-column leak the estate rule warns about is
mechanically guarded here, in the one repo whose export reaches across a table.

---

## 5. The nine survivors — what each means, and what to do about it

Ordered by how much a real defect there would cost. **Each entry names the test
that SHOULD have killed it and PROPOSES a test; none was written — the
conductor decides.**

### S1 · 🔴 `verify.ts` — `email_verified` (CP-24) and `audience` (CP-25)

**Where:** `catalog-platform/packages/estate-auth/src/verify.ts:110` and `:117`.
**What survived:** deleting the unverified-email refusal, and deleting the
`audience: projectId` assertion — the second of which the file's own header
calls out in bold: *"Removing either assertion turns this into 'any Google user
of any Firebase app on the internet', which is not a smaller check — it is no
check."* **This is the most load-bearing sentence in the estate's auth, and
nothing fails when it stops being true.**

**Why it survived:** `test/verify.test.ts` has seven cases and **every one of
them stops before `jwtVerify` is reached** — the dev bypass (4), a
misconfiguration throw, a missing header, and `readBearer`'s parsing. Nothing in
the estate ever feeds this function a token. There is no test that *should* have
killed it; the coverage simply ends at the network boundary.

**Proposal.** Mint tokens locally with `jose` (already a dependency) — generate
an RSA keypair in the test, sign three JWTs, and stub the JWKS by injecting the
key set rather than fetching. Three cases: (a) a token from the pinned project
with `email_verified: true` resolves; (b) the **same signer, a different
`aud`/`iss`**, resolves to `null` — this is the one CP-25 asks for; (c) the
right project with `email_verified: false` resolves to `null` — CP-24's. That
needs `getJwks()` to become injectable (an optional `jwksFor?` parameter or a
module-level setter), which is a small, honest widening of the seam. **This is
the highest-value single test in this document.**

### S2 · 🔴 The middleware wrappers: CP-08, BD-06, BD-11, BD-12

**Where:** `catalog-platform/apps/auth-worker/src/middleware/auth.ts:287`
(`requireApprover`), `Board_Game_Catalog/apps/worker/src/middleware/auth.ts:93`
(`requireCapability`), and `.../middleware/estate.ts:109` and `:231`.

**What survived:** disabling the approver gate outright; disabling every
capability gate in the board Worker; swapping which estate mode acts (so
`enforce` stops refusing and `shadow` starts); and making a **revoked** estate
member's verdict non-denying.

**Why they survived, and it is not an accident:** these files' own test headers
say so. `backups.test.ts`: *"The 401/403 gating itself (requireDevops()) is NOT
re-verified … it is the same shared middleware every other requireDevops() route
already relies on."* The estate extracted the **predicates** as pure functions
in 2026-08-16 precisely so they could be tested — and that worked, spectacularly
(§2.1 is 7 for 7). ⚠️ **But the wrapper that reads the identity, fetches the
row, calls the predicate and turns `false` into a 403 was never covered by the
same move.** `estate-refusals.test.ts` in the board repo reads the middleware
**as text** and asserts the wording of its refusals; it never executes it, so a
gate that returns early still passes a test about what it would have said.

**Proposal.** One `middleware/gate-wiring.test.ts` per repo, modelled on
`library_catalog`'s `capability-wiring.test.ts`, which is the only one of the
three that does this and which killed LC-13 with **206** failing cases. Mount a
one-route Hono app behind each middleware with a stub `resolveIdentity` and a
`FakeDB` (both already exist in these suites) and assert the four causes stay
four: tokenless → 401 `unauthenticated`; approved-but-unflagged → 403
`forbidden`; pending → 403 `estate_pending`; revoked → 403 `estate_revoked`. For
the board's `estate.ts`, the same harness with `ESTATE_CHECK` set to each of
`off` / `shadow` / `enforce` and one assertion per cell — that single table
kills BD-11 and BD-12 together. ⚠️ **Do this in the board repo first:** it is
the repo with no route tests at all (test-inventory §5.2) and the one where the
mutation opened *every* gate.

### S3 · ⚠️ The cached billing deny-set: LC-07 and LC-08

**Where:** `library_catalog/packages/estate-auth/src/gate.ts:669`
(`parseCachedBillingDenied`) and `:427` (the `SKIPPED` constant).
**What survived:** making an unknown deny-set answer `[]`. Both the file and
`billing-denied-shape.test.ts` state, in red, that `null` is UNKNOWN and `[]` is
"the directory answered and denied nothing", and that the two must never
collapse.

**Why it survived:** `billing-denied-shape.test.ts` pins the **wire** parser
thoroughly — all eight of its cases feed a `/seen` response body and read
`out.refresh.billingDenied`. **Neither the cached-COLUMN parser nor the SKIPPED
path is ever exercised**: no test passes `estateBillingDeniedJson` into
`subject()`, and the three `skipReason` assertions in `gate.test.ts` (lines 157,
192, 208) check `skipReason` and `performed` but never `billingDenied`. Half the
distinction the file exists to protect is unguarded.

**Proposal.** Two cases in the existing `billing-denied-shape.test.ts`, using
the subject builder already there: (a) `estateBillingDeniedJson: null` and
`'not json'` and `'{"a":1}'` each produce `out.billingDenied === null`, while
`'[]'` produces `[]`; (b) with `ESTATE_CHECK` off (and again with an unset
bearer), `out.billingDenied === null` — an off gate sought no answer. Cheap,
and it closes the exact asymmetry.

### S4 · ⚠️ `trackReading` gains `guest` (LC-12)

**Where:** `library_catalog/packages/core/src/capabilities.ts:29`.
**Why it survived:** `packages/core/test/capabilities.test.ts` asserts the
capability **key set** and the grant rule, and `capability-wiring.test.ts`
asserts every route's capability **name** — but no test asserts the **role
membership** of `trackReading`. ⚠️ The board repo pins the same fact with
*"rate: member and above, not guest"*, which is why BD-04 died and LC-12 lived.
**Two sibling matrices, one pinned and one not.**

**Proposal.** Port the board's row-by-row assertions into
`packages/core/test/capabilities.test.ts` — one `assert.deepEqual` per
capability against the owner-approved matrix, so any silent widening of any row
is a failure. It is a dozen lines and it makes the owner-approved table a
mechanical guard instead of a comment.

---

## 6. Against the 2026-08-16 baseline

| | 2026-08-16 | 2026-09-05 |
|---|---|---|
| Mutations | 8 | **51** |
| Repos | `audiobook_catalog` + `catalog-platform` role ladder | `catalog-platform`, `library_catalog`, `Board_Game_Catalog` |
| Killed | 7 | **42** |
| Survived | 1 (`requireDevops()` opened to anyone not banned) | **9** |
| Kill rate | 87.5% | **82.4%** |

**The 2026-08-16 survivor is now KILLED.** CP-02 is that mutation, verbatim —
`devopsAllows` opened to anyone not banned — and it takes **11 test cases** with
it. The fix that followed that run (extracting the two gate decisions as pure
predicates, and giving `requireApprover` the `status` check it never had) is
fully load-bearing: CP-01, the live privilege-retention bug it found, dies to a
test whose name is *"⚠️ a REVOKED approver is refused, flag or no flag"*.

⚠️ **But the shape of the survivors has not changed, only moved one layer out.**
2026-08-16's lesson was *"a gate with no test is a gate that silently opens"*,
and the remedy applied then was to make the DECISION testable. This run says the
remedy stopped at the decision: **the same sentence is now true of the WRAPPER**
in two of three repos, and of the token verifier in the shared package. The
predicates are 7-for-7; the middlewares are 0-for-4.

The two runs also disagree on one thing worth recording: the 2026-08-16 note
says the lock and the additions log *"are genuinely well tested — do not
'improve' their tests without re-running the mutations above"*. Nothing in this
run touched them, so **that standing instruction is untested here and still
stands on its own evidence**.

---

## 7. What this answers, in one paragraph

The estate's auth code is not carrying dead tests — in the group most likely to
hide them, **82% of deliberate breakages were caught, most of them by a test
whose NAME is the rule being broken**, and the run found no capability matrix
row, no ladder comparison and no §3.1 verdict that could be quietly widened.
What it found instead is a **shape**: the estate tests the functions that
DECIDE and does not test the code that ACTS on the decision. Four of nine
survivors are middleware, three are behind an I/O seam a unit test never
crosses, and two are the unpinned half of a distinction the file itself calls
load-bearing. **None of the nine is a defect today** — every one is a mutation
that a future edit could make for real, with nothing to stop it. The two that
would cost the most are `verify.ts`'s dropped `audience` (§5 S1) and the board
Worker's `requireCapability` (§5 S2), and both are answerable with one test file
each.
