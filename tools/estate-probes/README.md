# estate-probes — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-16** (102/102 passing against live production,
> measured by running `npm run probe:estate` — **+11 for
> `padhard.heygabi.ai`** ("Sam's library", `library_catalog`'s
> `[env.friend]`), added the day the estate began MANAGING that instance's
> roles from `heygabi.ai/admin`: 6 health-envelope assertions as a fifth
> `health.mjs` target, plus 5 on the federated role surface itself
> (`/api/admin/users` refusing a tokenless AND a garbage-bearer caller, and
> its apex-only CORS admitting `heygabi.ai` with GET+PATCH while refusing a
> foreign origin). All GET/OPTIONS — no `NON_GET_ALLOWLIST` row was needed
> or added. Prior count: 91/91.
>
> The 91/91 reasoning, kept because it explains the two odd rows: +13 for the audiobook-worker
> (deployed 2026-08-16 at `audiobook-api.heygabi.ai`: health + estate_check
> mode printed every run, the worded `/api/me` 401 on tokenless AND garbage
> bearer, site-only CORS admit/refuse, and the one by-design 204 POST to
> `/api/gate/shadow`) plus the read-only discipline audit (`discipline:RO1`)
> that mechanically fails the suite if any probe is non-GET/OPTIONS without
> an explicit allowlist row. The discord-worker prints a visible SKIP — not
> deployed yet, expected. Prior count: 78/78.

Owner order 2026-08-15: *"Maybe it's time to make an api testing suite"* —
promoting `apps/auth-worker/test/live-probes.ts`'s idiom (a named `check()`,
printed as it runs, counted, exit-coded) **estate-wide**, against LIVE
production rather than a local `wrangler dev`.

## Run it

```bash
npm run probe:estate                    # from the repo root
node tools/estate-probes/run.mjs        # equivalent, direct
```

Plain Node, **zero dependencies** (global `fetch`/`AbortController`, Node
20+ — matches `tools/`'s existing ethos, see `../README.md`). No build step,
no `npm install` beyond the repo root. Exits nonzero if any probe fails.

## What this is

Every probe is one of three things, asserted against **production**:

1. a status code (`200`, `401`);
2. a JSON envelope/body **shape** (keys present, right types) — never the
   full content, since content changes legitimately;
3. a CORS header's presence or absence on an `OPTIONS` preflight.

Nothing here signs in. Nothing mints a Firebase token or holds a service
account. Nothing reads or prints a secret. The suite is safe to run at any
time, by anyone with this repo checked out, with no credentials at all.

## What is covered

| Area | File | Surface |
|---|---|---|
| All five `/api/health` | `probes/health.mjs` | The `{ ok, service, version?, time, detail }` envelope (`docs/info/health-envelope.md`) on auth, index, library, games, **library2** (`padhard.heygabi.ai`). ⚠️ `library2-health` asserts `service === "library-catalog"` — the SAME string the main library answers, correctly: `[env.friend]` is the same Worker code at another hostname, and the health route names the software, not the deploy. The origin is what separates the rows |
| `auth.heygabi.ai` | `probes/auth-worker.mjs` | `/me`, `/hello` tokenless → 401; `/docs/:slug` tokenless → 401; `/backups` tokenless → 401 (0006, the /status "last backup age" row) plus its apex-only CORS admit/refuse; `/facts/:slug` tokenless → 401 on GET AND POST (0007, the self-service shelf-facts form) plus its apex-only CORS admit/refuse; `/ops/pipeline/step` and `/ops/pipeline/force-upload` tokenless → 401 (0008, the fine-grained pipeline step controls — owner ask 2026-08-16) plus apex-only CORS admit/refuse for both — **never a live trigger, see the note below**; admin API (`/users`) tokenless AND garbage-bearer → 401; `/hello` CORS (audiobook site admitted, foreign origin refused, POST allowed); admin API CORS (apex admitted, foreign origin refused); `/__/auth/*` proxy is live (not this Worker's 404 shape — sso-design.md §4.1 Phase 1); `/api/session` tokenless → 401, `/api/session/token` no-cookie / unknown-cookie → 401 `no_session`, `DELETE /api/session` no-cookie → 200 idempotent (§4.3 Phase 2); session-routes CORS is CREDENTIALED and admits `library.heygabi.ai` (proving it uses its own SESSION_ORIGINS list, not ADMIN_ORIGINS/ME_ORIGINS), foreign origin refused |
| `index.heygabi.ai` | `probes/index-worker.mjs` | `/api/search` anonymous → 200 with the public-slice shape (`scope === ["audiobook"]`); `/api/universe/:name`, `/api/lookup`, `/api/scan/shelf` tokenless → 401; `/api/search` CORS (apex admitted, foreign origin refused) |
| `library.heygabi.ai` | `probes/library-worker.mjs` | `/api/scan-jobs/barcode` and `/api/scan-jobs` tokenless → 401; barcode-route CORS (apex admitted, POST allowed, foreign origin refused) — *(sibling repo, read-only reference for expected shapes: `library_catalog/apps/worker/src/routes/scan-jobs.ts`, `middleware/auth.ts`; nothing in that repo is touched)* |
| `padhard.heygabi.ai` | `probes/library2-worker.mjs` | **"Sam's library"** — the SECOND library instance (`library_catalog`'s `[env.friend]`: Worker `library-catalog-friend`, own D1 `library-catalog-2nd`, own bucket). Probed because the CODE is shared with `library.heygabi.ai` and the DEPLOY is not — a green main library says nothing about hers. `/api/admin/users` (the surface `heygabi.ai/admin`'s fourth role column drives) tokenless AND garbage-bearer → the worded 401; its `adminCors()` apex-only preflight admitting `https://heygabi.ai` with GET+PATCH and refusing a foreign origin. ⚠️ `PATCH /api/admin/users/:id/role` is deliberately NEVER exercised — it changes what a real person may do on a real catalog; its escalation rules (`canGrantRole`) are unit-tested in that repo. *(sibling repo, read-only reference: `library_catalog/apps/worker/src/routes/admin.ts`, `wrangler.toml [env.friend]`)* |
| `boardgames.heygabi.ai` | `probes/health.mjs` | `/api/health` only — no other public surface is asked for by design |
| `audiobook-api.heygabi.ai` | `probes/audiobook-worker.mjs` | The audiobook-worker (deployed 2026-08-16). `/api/health` → 200 with this Worker's OWN envelope `{ ok, service, time, estate_check }` (no `detail`, by design — not the estate health envelope), `estate_check` asserted ∈ {off, shadow, enforce} **and printed on every run** (the shadow flip / an accidental revert shows here without reading wrangler config); `/api/me` tokenless AND garbage-bearer → the WORDED 401 (`error: "unauthenticated"` + a non-empty human `detail` — the ROLES.md §1e contract, asserted, not just the shape); `/api/me` CORS (audiobook site admitted, foreign origin refused); `POST /api/gate/shadow` with `{ action: "probe" }` → 204 + empty body — **the one by-design non-refused POST in this suite, see the note below** |
| discord-worker | `probes/discord-worker.mjs` | **NOT DEPLOYED — visible SKIP, on purpose.** Prints `discord-worker: not deployed yet (expected)` every run so the suite knows the worker exists. Health probes (200, `service === "estate-discord"`, config-presence booleans printed) are already written against `apps/discord-worker/src/index.ts`'s real shape; the day it deploys, setting `DISCORD_API_ORIGIN` in `lib/origins.mjs` switches them on — a one-line change |
| `audiobooks.heygabi.ai` | `probes/audiobooks.mjs` | `/ebooks.json` parses, has `generated_at` (string) and `count` (number) |
| Firestore | `probes/firestore.mjs` | `pipeline_status/current`, unauthenticated REST `GET`, parses, has `fields` — the one document `firestore.rules` sets `allow read: if true` on; `shelf_upload_status/current` (2026-08-16) — read permitted (200 or 404, never denied) |

102 assertions as of last verification, all passing. Run the suite for the
current count and result — this table is not re-derived automatically.

⚠️ **The read-only discipline is now a MECHANICAL GUARD, not just prose**
(`run.mjs`: `NON_GET_ALLOWLIST` + `auditMethodDiscipline()`, the
`discipline:RO1` row). After all probes run, every recorded row must be
GET/OPTIONS/PARSE or appear in the explicit allowlist of documented non-GET
rows — each a tokenless call an auth gate refuses before any handler runs,
the idempotent no-cookie `DELETE /api/session`, or the one 204 shadow POST
below. An unlisted non-GET probe fails the whole suite. Adding one requires
adding its `area:id:METHOD` allowlist row in the same commit — that edit is
the deliberate escape hatch, per the mechanical-guards rule.

**Why `POST /api/gate/shadow` is inside the read-only contract** (verified
by reading `apps/audiobook-worker/src/gate-shadow.ts`, not guessed): the
receiver answers 204 with no body ALWAYS (its own "iron rule 1"); it stores
nothing — no D1/KV/R2 bindings exist in that Worker's wrangler.toml, and the
only side effect is one `console.log` line read via `wrangler tail`; and a
TOKENLESS report (the probe sends no token) skips every outbound call —
`estateStatusFor`, `cachedStoredRole`, `isClubManager` are all gated on a
verified identity, so the probe cannot trigger even a Firestore READ.
`action: "probe"` is not in ACTION_GATES, so in shadow/enforce it logs one
clearly-synthetic `unknown_action` line; in off it is not processed at all.
Total blast radius: one log line and one unit of the 240/min budget.

⚠️ **`POST /api/estate/ops/pipeline` itself has NO probe, on purpose, and
neither do the two 0008 routes above beyond the tokenless-401/CORS checks —
do not add one that signs in and actually calls it.** A prior version of
this suite included a signed-in call to a live trigger route and it queued a
real pipeline run against production. `requireDevops()` checks identity
FIRST on all three routes, so a tokenless call never reaches the
Firestore-write path — that is what makes A5/A26/A27/A30/A31 safe to run
unattended. See "What is NOT covered" below.

## `authorized-domains.mjs` — optional, credentialed

**Not part of `npm run probe:estate`. Not imported by `run.mjs`. Run it by
hand.** Everything above this section is the zero-auth, zero-dependency
contract; this one script is deliberately outside it, because what it checks
cannot be checked any other way.

Built 2026-08-16 after a real incident: the apex (`heygabi.ai`) was
accidentally REMOVED from Firebase's authorised-domain list during unrelated
console cleanup, and estate-wide sign-in broke — silently, because nothing
in this suite (or anywhere else) was watching that list. This probe reads it
straight from the source of truth, `GET
https://identitytoolkit.googleapis.com/admin/v2/projects/audiobook-catalog/config`,
and asserts all five estate sign-in origins (`heygabi.ai`,
`audiobooks.heygabi.ai`, `library.heygabi.ai`, `boardgames.heygabi.ai`,
`padhard.heygabi.ai`) are present.

⚠️ **`padhard.heygabi.ai` (D5) was added 2026-08-16 and has NOT been verified
against the live list** — this script needs a service account that was not in
hand at the time. Her instance signs in through the same shared Firebase
project (`authDomain: 'auth.heygabi.ai'`), so the incident this script exists
for applies to her hostname exactly as it does to ours, and she is the one
person in the estate who cannot debug it herself. A D5 failure on the first
credentialed run is a genuine finding — add the host in Firebase →
Authentication → Settings → Authorised domains — not a bug in the list.

```bash
# PowerShell
$env:FIREBASE_SERVICE_ACCOUNT_PATH = "<path to a Firebase service-account JSON>"
node tools/estate-probes/authorized-domains.mjs

# bash
FIREBASE_SERVICE_ACCOUNT_PATH=<path> node tools/estate-probes/authorized-domains.mjs
```

No `FIREBASE_SERVICE_ACCOUNT_PATH` (or no file at that path) → the script
prints why and exits **0** — SKIPPED is the expected state for anyone
running this repo without the credential, not a failure. This is why it is
not wired into the default `npm run probe:estate` run: that command must
stay runnable by anyone, with nothing, always — bolting a credentialed check
onto it would make "no credential" look like a failing suite.

The service-account JSON needs the same shape
`apps/auth-worker/src/firebase-sa.ts` parses (`client_email`, `private_key`,
`project_id`) and enough GCP IAM on the project to read Identity Platform
admin config (Firebase Authentication Admin/Editor/Owner-class access) — a
plain OAuth scope is not enough by itself; the project IAM role is what
actually gates the call. ⚠️ **Never print, log, or commit the service
account JSON, its private key, or the minted access token.** The script
itself only ever prints authorised-domain hostnames (public information —
the same hostnames already appear in every CSP header this repo ships).

## What is NOT covered, and why

**Every signed-in 200-path, estate-wide.** This suite has no authenticated
identity to act as — that is the whole point of "unauthenticated-edge":

- Nothing that requires an approved member's Firebase ID token: `GET
  /api/estate/me` answering a real profile, `/api/search` at a member's real
  visibility, `/api/universe/:name`, `/api/lookup`, `/api/scan/shelf`
  (spends money per call), `library_catalog`'s authenticated catalog routes,
  the games worker's authenticated routes.
- Nothing that requires an **approver**: `/api/estate/users` (list/create),
  `/status`, `/approver`, `/visibility`; `/api/estate/site-roles`.
- Nothing that requires a **devops** role: `GET /api/estate/docs/:slug`
  returning real content (only the tokenless 401 is probed); `POST
  /api/estate/ops/pipeline`; `GET /api/estate/backups` returning real
  aggregate counts/timestamps (only the tokenless 401 + CORS are probed);
  `GET`/`POST /api/estate/facts/:slug` returning or writing a real facts
  record (0007 — only the tokenless 401 on both verbs + CORS are probed,
  same honest gap as the other two devops-tier routes above); `POST
  /api/estate/ops/pipeline/step` and `POST /api/estate/ops/pipeline/
  force-upload` actually queuing a step or a force-upload (0008 — same
  honest gap, tokenless 401 + CORS only; a signed-in 200 here queues a REAL
  request the home machine will act on, so it is deliberately never
  exercised by this unattended suite).
- Nothing that requires a **per-app machine bearer**: `POST
  /api/estate/seen`, `POST /api/push` (index-worker's per-source push
  tokens). These are secrets by design and this suite holds none.
- **`POST /api/session/token`'s `token_signer_unset` 503 path.** Reaching it
  requires a LIVE `estate_session` row, which requires a real Firebase ID
  token from `POST /api/session` first — this suite holds none (same class
  as every signed-in path above). What IS probed is the no-cookie/
  unknown-cookie 401 edge; the 503 idiom itself is proven in
  `apps/auth-worker/test/session.test.ts` against a fake D1.
- The **games worker's** non-health routes entirely — no probe target was
  named for them in the design pass that produced this suite, and inventing
  unauthenticated assertions for an unfamiliar route surface risked getting
  them wrong. Add them here (see "New endpoints" below) once someone reads
  that Worker's routes the way this suite reads the other three.

**Future work**: an authed probe identity (a dedicated, clearly-labelled
Firebase test account, enrolled and approved on purpose, its token minted
outside this suite and passed in via an env var never committed) would close
most of the "signed-in 200-path" gap in one pass. Nobody has decided that
identity should exist yet — the security cost (one more standing account
with real estate visibility) needs an explicit owner call, not a Claude
default. Until then, the signed-in paths are covered only by each repo's own
local dev-bypass tests (`live-probes.ts`, `library_catalog`'s equivalents),
which run against local D1 and cost nothing to add to.

## The rule

**New estate endpoints get a probe in the same commit.** An endpoint that
answers on a `*.heygabi.ai` host and has no row in this suite is an
undocumented surface. At minimum: does it 401 tokenless where it should,
does its CORS admit only what it should. If the new endpoint costs money per
call or writes anything, its unauthenticated-401 check is not optional —
that is exactly the case `/api/scan/shelf` and `/api/scan-jobs/barcode`
exist to set a precedent for.

## Design notes

- **`lib/kit.mjs`** is the shared harness: `check()` (record + print
  immediately, mirroring `live-probes.ts`'s `check()`), `request()`/`get()`/
  `post()`/`options()` (fetch wrapped in a timeout and a try/catch so a
  network blip becomes a FAILED check, never a crash), `printTable()` (the
  final PASS/FAIL table).
- **`lib/origins.mjs`** holds every production host and the two CORS-probe
  origins (`https://heygabi.ai` admitted, `https://evil.example` never
  registered anywhere), lifted verbatim from
  `sites/heygabi-home/public/status/status.js` so this suite and the status
  page can never quietly point at different URLs.
- **One file per surface** under `probes/`, each importing only `lib/`, each
  a single exported `probeX()` async function. `run.mjs` is wiring only —
  it imports each probe module and calls it in turn, then prints the table
  and sets the exit code.
- **Why not reuse `@platform/estate-auth`'s `runConformanceProbes`
  directly**: that helper drives the §8.2 conformance suite against a
  *local* `wrangler dev` with known seeded state (owner bypass, specific
  tokens) — its assertions are keyed to that local fixture, not to
  production's real, changing membership table. This suite deliberately
  re-implements the *few* assertions that hold true unconditionally in
  production (tokenless → 401, CORS admit-lists) rather than importing a
  helper built for a different environment.

## Gotchas

| Gotcha | Detail |
|---|---|
| A probe FAILING is a finding about production, not a bug in this suite by default | `run.mjs` prints a reminder to this effect on any failure. Read the observed value, check it against the source route, and report honestly — do not loosen the assertion unless it was factually wrong (say so if it was) |
| `library.heygabi.ai` probes read a **sibling repo** for their expected shapes | `library_catalog/apps/worker/src/routes/scan-jobs.ts` and `middleware/auth.ts` — read-only reference. This suite and its build never write to that repo |
| The Firestore probe has no fallback if the rule changes | If `pipeline_status/current` ever loses its public-read rule, `F1` starts failing with a 403/PERMISSION_DENIED body — that is itself useful signal, not a bug to route around |
| `redirect: 'manual'` on every request | So a probe that expects 401 does not silently follow a redirect into something else's response. If a route starts redirecting, the probe will show the redirect status (3xx) rather than resolving it |
| Commit with `git commit -F <file>`, never `-m` | Same PowerShell quoting/em-dash trap as every other doc in this repo |
