# CI deploys — `.github/workflows/deploy.yml`

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED
> (secret NAMES only — ⚠️ **this repo is PUBLIC**, `KNOWN_ISSUES.md` KI-2).
> **Last verified: 2026-09-05.** ⚠️ **CREATED that day, and its absence was
> the finding that created it:** `docs/access/` described the backup workflow
> (`backup-restore.md` §3) but **nothing in this tree described the DEPLOY
> workflow** — `grep -rn "deploy.yml" docs/access/` returned only
> `backup-restore.md`'s two passing mentions of the token it shares. Every
> claim below was read out of `.github/workflows/deploy.yml` on 2026-09-05,
> and the 39 s figure is measured (§3).
>
> ⚠️ **What was NOT verified:** no run of this workflow was dispatched — it
> has no non-deploying target (§4), and the session that added the test gate
> was not authorised to deploy. **The `tests` job has therefore never
> executed on a runner.** §4 says exactly what its first run will show.
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
| `heygabi-home` | `wrangler pages deploy sites/heygabi-home/public` | `heygabi.ai` |
| `all` | all three | |

Actions → **Deploy (manual)** → Run workflow → pick a target. Or:

```sh
gh workflow run deploy.yml --repo skymitch9/catalog-platform -f target=auth-worker
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
`scripts/test`, then `npm test --workspaces --if-present`) and all three deploy
jobs carry `needs: tests`. **Measured 2026-09-05: ~39 s for 3,076 cases**
(re-run the same day at 31 s / 3,104 cases after two other agents' work
landed), of which **27.3 s is `scripts/test` alone** — several of those files
spawn the real scripts as child processes rather than importing them. The whole
suite runs, never a per-target subset: the three targets share `packages/` and
`scripts/`, and a subset gate is how a shared change ships untested. No new
secret and no new permission were needed — the suite is hermetic, and
`apps/discord-worker`'s `pretest` (`sync-gabi-prompt --check`) skips loudly
with exit 0 when the sibling `library_catalog` checkout is absent, which is the
CI case, so this workflow deliberately does not check out a second repo the way
library's does. ⚠️ **Accepted trade-off:** the per-job token guards now fire
~40 s later, because their jobs wait on the gate.

## 4. ⚠️ There is no way to exercise this workflow without deploying

Every target is live and the only trigger is `workflow_dispatch`, so a push to
`main` starts nothing and **there is no dry run**. The consequence to hold on to:
a change to this file — including the test gate itself — is *shipped* but not
*verified* until somebody dispatches a real deploy.

**What the first dispatch after 2026-09-05 will show:** a `tests` job appearing
above the target job(s) in the run's job list; ~10–15 s of `npm ci` (warm npm
cache), then `Run the full suite (root npm test)` printing each workspace's
`ℹ tests / ℹ pass / ℹ fail` block and taking ~40 s; then the notice *"Suite
green at &lt;sha&gt; — the deploy jobs may proceed."*. Only then does the chosen
deploy job start, unchanged from before. **If the suite is red, the deploy job
is skipped, not failed** — the run is red overall and nothing reached
Cloudflare, which is the whole point. Expect KI-1's Node-20 `setup-node`
annotation on the green run; it is not a failure.

**If someone wants CI feedback without a deploy**, the shape to copy is
`audiobook_catalog`'s separate `js-tests.yml` (a test-only workflow on
push/PR, which its `deploy.yml` then `needs:`). That is a *new workflow*, not
an edit to this one, and it is an owner decision — it has never existed here.
