# estate-probes — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-15** (54/54 passing against live production).

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
| All four `/api/health` | `probes/health.mjs` | The `{ ok, service, version?, time, detail }` envelope (`docs/info/health-envelope.md`) on auth, index, library, games |
| `auth.heygabi.ai` | `probes/auth-worker.mjs` | `/me`, `/hello` tokenless → 401; `/docs/:slug` tokenless → 401; admin API (`/users`) tokenless AND garbage-bearer → 401; `/hello` CORS (audiobook site admitted, foreign origin refused, POST allowed); admin API CORS (apex admitted, foreign origin refused) |
| `index.heygabi.ai` | `probes/index-worker.mjs` | `/api/search` anonymous → 200 with the public-slice shape (`scope === ["audiobook"]`); `/api/universe/:name`, `/api/lookup`, `/api/scan/shelf` tokenless → 401; `/api/search` CORS (apex admitted, foreign origin refused) |
| `library.heygabi.ai` | `probes/library-worker.mjs` | `/api/scan-jobs/barcode` and `/api/scan-jobs` tokenless → 401; barcode-route CORS (apex admitted, POST allowed, foreign origin refused) — *(sibling repo, read-only reference for expected shapes: `library_catalog/apps/worker/src/routes/scan-jobs.ts`, `middleware/auth.ts`; nothing in that repo is touched)* |
| `boardgames.heygabi.ai` | `probes/health.mjs` | `/api/health` only — no other public surface is asked for by design |
| `audiobooks.heygabi.ai` | `probes/audiobooks.mjs` | `/ebooks.json` parses, has `generated_at` (string) and `count` (number) |
| Firestore | `probes/firestore.mjs` | `pipeline_status/current`, unauthenticated REST `GET`, parses, has `fields` — the one document `firestore.rules` sets `allow read: if true` on |

54 assertions as of last verification, all passing. Run the suite for the
current count and result — this table is not re-derived automatically.

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
  /api/estate/ops/pipeline`.
- Nothing that requires a **per-app machine bearer**: `POST
  /api/estate/seen`, `POST /api/push` (index-worker's per-source push
  tokens). These are secrets by design and this suite holds none.
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
