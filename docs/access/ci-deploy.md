# CI deploys — `.github/workflows/deploy.yml`

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED
> (secret NAMES only — ⚠️ **this repo is PUBLIC**, `KNOWN_ISSUES.md` KI-2).
> **Last verified: 2026-09-07** — ⚠️ **for §1's target table and §5 ONLY.**
> What was measured on that date: the `audiobook-worker` target was ADDED to
> `.github/workflows/deploy.yml` and the file was **parsed** (PyYAML,
> `yaml.safe_load` — five jobs, five `target` options, the new job carries
> `needs: tests`, the `if:` condition and **no migrate step**), the root
> `npm test` was re-run green, and `apps/audiobook-worker/wrangler.toml` +
> `package.json` were read to confirm the no-D1 claim in §5.
> ⚠️ **NOT verified on that date:** the new job has **never run** — no
> dispatch, no `wrangler deploy`, and whether `CLOUDFLARE_API_TOKEN`'s Workers
> scope actually reaches *this* Worker is inference from its two siblings, not
> a measurement. §2–§4 still carry their 2026-09-05/2026-09-06 readings and
> were not re-checked.
> ⚠️ **CREATED 2026-09-05, and its absence was
> the finding that created it:** `docs/access/` described the backup workflow
> (`backup-restore.md` §3) but **nothing in this tree described the DEPLOY
> workflow** — `grep -rn "deploy.yml" docs/access/` returned only
> `backup-restore.md`'s two passing mentions of the token it shares. Every
> claim below was read out of `.github/workflows/deploy.yml` on 2026-09-05,
> and the 39 s figure is measured (§3).
>
> ✅ **2026-09-06: the `tests` job HAS now executed on a runner** — twice,
> green, 61 s / 3,151 cases — because `tests.yml` gives it a non-deploying
> trigger and this workflow now calls it (§4 has the table).
> ⚠️ **What is STILL not verified:** no *deploy* job has ever been dispatched
> from a session authorised to run one, so `needs: tests` in front of a real
> `wrangler deploy` remains reasoned, not observed (§4, last block).
>
> - How the home site's *local* deploy works → [`../../sites/heygabi-home/deploy.md`](../../sites/heygabi-home/deploy.md)
> - The backup workflow → [`backup-restore.md`](backup-restore.md) §3
> - What deployed when → `../deploys.log`

---

## 1. What it deploys, and how you start it

**Manual dispatch only**, decided by the owner 2026-08-14. There is no dev
lane and no promote step: every target goes straight to a live `heygabi.ai`
host. ⚠️ **Do not add push triggers or schedules** — the workflow's own header
says so, and the rule is the owner's, not a style preference.

| `target` input | Deploys | Host |
|---|---|---|
| `index-worker` | `apps/index-worker` — D1 migrate, then `wrangler deploy` | `index.heygabi.ai` |
| `auth-worker` | `apps/auth-worker` — D1 migrate, then `wrangler deploy` | `auth.heygabi.ai` |
| `audiobook-worker` | `apps/audiobook-worker` — `wrangler deploy`, ⚠️ **no migrate step** (§5) | `audiobook-api.heygabi.ai` |
| `heygabi-home` | `wrangler pages deploy sites/heygabi-home/public` | `heygabi.ai` |
| `all` | all four | |

⚠️ **`apps/discord-worker` is deliberately NOT a target.** Whether it gets one
is an open owner question (`TODO.md`, the 2026-09-07 deploy-endpoint item) —
it is the same shape as the two D1 workers, so it would need the migrate step
the audiobook job omits. Do not add it as a side effect of another change.

Actions → **Deploy (manual)** → Run workflow → pick a target. Or:

```sh
gh workflow run deploy.yml --repo skymitch9/catalog-platform -f target=auth-worker
gh workflow run deploy.yml --repo skymitch9/catalog-platform -f target=audiobook-worker
gh run list --repo skymitch9/catalog-platform --limit 3
```

⚠️ **Coupled deploys:** index-worker and heygabi-home ship TOGETHER when the
front door's `find.js` moves — dispatch `all`, or index-worker then
heygabi-home. ⚠️ **The Pages upload root `sites/heygabi-home/public` is
load-bearing:** anything wider publishes this repo's `docs/`.

## 2. Secrets and permissions

One secret, `CLOUDFLARE_API_TOKEN`, shared with `backup.yml`. It must carry
**Workers + D1 + `Cloudflare Pages: Edit`** — the plain *Edit Cloudflare
Workers* template carries neither Pages nor D1, both measured the hard way
(`backup-restore.md` §8 and its 2026-08-27 D1 row). Each deploy job opens with
a guard step that fails with the minting instruction when the secret is absent.
`permissions: contents: read`, and nothing here writes to the repo.

## 3. ⚠️ The test gate — added 2026-09-05

Until 2026-09-05 this workflow ran **no tests at all**: `npm ci` → `db:migrate`
→ `wrangler deploy`. The repo's suite gated only the *local* `npm run
deploy:home` path, which is not the path an Actions dispatch takes — so the
auth Worker, the index Worker and the live front door could all ship from CI
with a red suite, while `library_catalog` and `Board_Game_Catalog` both gated
their CI deploys through `predeploy` → `npm test`. It was named the single
highest-value change in
[`../info/test-inventory-2026-09-05.md`](../info/test-inventory-2026-09-05.md)
§5.1.

A `tests` job now runs the **root** `npm test` (`test:scripts` over
`scripts/test`, then `npm test --workspaces --if-present`) and **every** deploy
job carries `needs: tests` — three when this was written, four since
`audiobook-worker` joined 2026-09-07 (§5). ⚠️ **Since 2026-09-06 that job's steps live in
[`tests.yml`](../../.github/workflows/tests.yml), not in `deploy.yml`** — this
workflow calls it (§4). Edit the suite there.
**Measured locally 2026-09-05: ~39 s for 3,076 cases**
(re-run the same day at 31 s / 3,104 cases after two other agents' work
landed), of which **27.3 s is `scripts/test` alone** — several of those files
spawn the real scripts as child processes rather than importing them. The whole
suite runs, never a per-target subset: the deploy targets share `packages/` and
`scripts/`, and a subset gate is how a shared change ships untested. No new
secret and no new permission were needed — the suite is hermetic, and
`apps/discord-worker`'s `pretest` (`sync-gabi-prompt --check`) skips loudly
with exit 0 when the sibling `library_catalog` checkout is absent, which is the
CI case, so this workflow deliberately does not check out a second repo the way
library's does. ⚠️ **Accepted trade-off:** the per-job token guards now fire
~40 s later, because their jobs wait on the gate.

## 4. Exercising the gate without deploying — `tests.yml`

**Until 2026-09-06 there was no way.** Every target is live and the only trigger
is `workflow_dispatch`, so a push to `main` started nothing, there was no dry
run, and a change to this file — including the test gate itself — was *shipped*
but never *verified*. That is fixed, and not by touching this workflow:

> **[`.github/workflows/tests.yml`](../../.github/workflows/tests.yml)** — added
> 2026-09-06 (W9-TESTS-YML, `de8008b` + `a6f28a9`). Runs on **push to `main`,
> on `pull_request`, and on `workflow_call`**. `permissions: contents: read`,
> **no secrets, no Cloudflare, no deploy**.

⚠️ **It is not a second copy of the gate.** This workflow's `tests` job is now
`uses: ./.github/workflows/tests.yml` — one definition, called from both lanes,
so the deploy gate and the push/PR lane cannot drift apart. To change what the
gate runs, edit `tests.yml`; nothing in this file spells the steps out any more.
⚠️ **This did NOT add a trigger here**: `deploy.yml` is still
`workflow_dispatch`-only, per §1 and its own header. A called workflow inherits
this file's `permissions: contents: read` and is passed no secrets.

### 🟢 Measured 2026-09-06 — the first runs of the gate on a runner

Both green on the first try; **no fix rounds were needed**.

| Run | Commit | npm cache | `npm ci` | Suite step | Wall |
|---|---|---|---|---|---|
| [34014004841](https://github.com/skymitch9/catalog-platform/actions/runs/34014004841) | `de8008b` | cold | 8 s | **51 s** | **73 s** |
| [34014020664](https://github.com/skymitch9/catalog-platform/actions/runs/34014020664) | `a6f28a9` | warm | 7 s | **44 s** | **61 s** |

**3,151 cases, `fail 0`, `skipped 0`** — every workspace's
`ℹ tests / ℹ pass / ℹ fail` block printed, then the notice *"Suite green at
&lt;sha&gt; — the deploy jobs may proceed."*. ⚠️ The runner is **slower than a
local run**, not faster: the same suite is ~31–39 s on the owner's machine
(§3), so budget **~45–50 s** for the gate in CI, not 40.

⚠️ **KI-1's Node-20 `setup-node` annotation appeared on both green runs**, as
§3 predicted. It is not a failure; do not read a red X off it.

### What is still NOT verified from here

The gate's *steps* are now measured, but the **deploy jobs remain unexercised**
— they are still `workflow_dispatch`-only against live hosts, so `needs: tests`
gating a real `wrangler deploy`, and the two-line caller stanza in this file,
have not run. **If the suite is red the deploy job is skipped, not failed** —
the run is red overall and nothing reaches Cloudflare — but that path is
reasoned, not observed. The next real dispatch is its measurement.

## 5. 🆕 The `audiobook-worker` target — added 2026-09-07

**Why it exists.** The owner's ask, verbatim: *"We need a deploy end point so
you can take over that job"* (2026-09-07 ~02:40 Phoenix). The 2026-09-07
audiobook-worker deploy had taken him three attempts from the phone — the first
two never reached the Worker; the third, `e91ea098`, landed at 09:22Z and is in
`../deploys.log`. The endpoint already existed; **only this target was
missing.** `gh auth status` on the owner's machine is logged in as `skymitch9`,
so from the terminal:

```sh
gh workflow run deploy.yml --repo skymitch9/catalog-platform -f target=audiobook-worker
gh run watch --repo skymitch9/catalog-platform
```

A green run shows **two** jobs in the Summary — the `tests` gate's notice
*"Suite green at &lt;sha&gt; — the deploy jobs may proceed."*, then
*"audiobook-worker deployed at &lt;sha&gt; → audiobook-api.heygabi.ai (live)."*
(the other three deploy jobs are skipped by their `if:`). Verify afterwards the
way any Worker deploy is verified: `npx wrangler deployments list` from
`apps/audiobook-worker` (⚠️ **newest is LAST**), `audiobook-api.heygabi.ai/api/health`
200, and the audiobook rows on <https://heygabi.ai/status/> going green.

### ⚠️ Why this job has NO D1 migrate step

The two Worker jobs above run `npm run db:migrate --workspace @platform/<name>`
before `wrangler deploy`, per the estate's migrate-before-deploy rule. **This
job deliberately does not**, and the reason is not a shortcut:

| Checked 2026-09-07 in | Finding |
|---|---|
| `apps/audiobook-worker/wrangler.toml` | **No `[[d1_databases]]` block at all.** Its bindings are three R2 buckets — `EBOOKS_GATED` (`ebooks-gated`), `EBOOKS` (`estate-ebooks`), `AUDIO` (`estate-audio`) — plus `[vars]` and `[observability]` |
| `apps/audiobook-worker/package.json` | Scripts are `dev`, `typecheck`, `test`. **There is no `db:migrate`**, so the sibling jobs' command would fail the run outright |

So there is no schema for new code to meet, and nothing to migrate. ⚠️ **If this
Worker ever gains a database, the migrate step goes in BEFORE the deploy step**,
exactly as the two jobs above do — the comment on the job in `deploy.yml` says
so, so the rule is where a session editing that job will read it.

### What is NOT verified about this target

⚠️ **The job has never run.** Added, parsed and committed only:
`yaml.safe_load` of the whole workflow succeeds (five jobs; `target` carries
five options; the new job has `needs: tests`, the
`inputs.target == 'audiobook-worker' || inputs.target == 'all'` condition, and
no migrate step), and the root `npm test` is green. **Not measured:** the
dispatch itself, the deploy, the resulting Worker version, and — the one worth
naming — **whether `CLOUDFLARE_API_TOKEN`'s Workers scope reaches THIS Worker.**
It deploys the two sibling Workers today, which is good reason to expect it to,
but "same account, same scope" is inference; the first dispatch is the
measurement. If it refuses, the symptom will be an authentication error from
`wrangler deploy` *after* the green gate, not the guard step (the guard only
checks the secret is non-empty).
