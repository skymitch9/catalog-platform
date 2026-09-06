# Deploying from a throwaway worktree — and the way it eats `node_modules`

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-09-06** — ⚠️ **§0 only**, and it was written from a real
> incident that day: every number in its table was measured during the repair
> (junction inventory, suite counts either side, the 2.96 GB the re-exclusion
> moved). ⚠️ **§1–§5 were NOT re-measured on that date** and carry their own
> dates below.
>
> Previously verified: **2026-09-05** — §5 was added that day from a guard that
> genuinely refused a `deploy:home`, with its refusal text quoted from the run.
> ⚠️ **§1–§4 were NOT re-measured on that date**; their last measurement is
> **2026-08-24**, when the teardown order was executed with counts taken either
> side of every step. ⚠️ The *cause* in §2 is INFERRED from timestamps, not
> reproduced; §2 says exactly how far the evidence goes.
>
> Operating steps: [`access/README.md`](../access/README.md). What shipped:
> `deploys.log`.

## 0. 🔴 `C:\lcw` IS NOT SCRATCH SPACE — never `rm -rf` it (incident 2026-09-06)

⚠️ **Read this before you tear a worktree down.** `C:\lcw` looks like a scratch
directory because every worktree in this document lives in it. It is not. It
also holds **`C:\lcw\onedrive-excluded\`**, which is where
[`scripts/onedrive-exclude.ps1`](../../scripts/onedrive-exclude.ps1) MOVES every
repo's real `node_modules` and `.claude` folder, leaving a junction behind in the
repo. **The estate's dependencies physically live there.**

**Measured 2026-09-06 (W9-KILL).** After removing a worktree at `C:/lcw/k`, the
agent ran `rm -rf /c/lcw` to tidy up. That deleted:

| What | Recoverable? | How it came back |
|---|---|---|
| `node_modules` for **9 repos** (36 junction targets) | ✅ yes | `npm install` per repo (every one has a lockfile), then re-run `scripts/onedrive-exclude.ps1` to move them back out and re-junction — 26 folders, 2.96 GB |
| **6 `.claude/` project folders** (`catalog-platform`, `Board_Game_Catalog`, `audiobook_catalog`, `bookbuddy/`, `Sundance/` ×2, `flight-info`) | 🔴 **no** | Untracked local state. Gone. See `KNOWN_ISSUES.md` KI-14 |
| **6 registered git worktrees** on feature branches (4 here, 2 in `audiobook_catalog`) | ⚠️ commits yes, uncommitted no | The branches are intact in the object store; only working-tree edits were lost |
| Tracked source, anywhere | ✅ **nothing lost** | `git status` was clean in all four estate repos before and after |

⚠️ **Two things made it survivable, and neither was luck you can count on:** the
`.claude` folders are gitignored (so `git status` stayed clean and no tracked file
was touched), and every affected repo had a committed lockfile.

**The rules that follow from it:**

1. 🔴 **Delete the WORKTREE, never its parent.** `git worktree remove --force
   C:/lcw/<name>` and stop there. There is no step after it.
2. ⚠️ **Before any recursive delete under `C:\lcw`, run
   `git worktree list` in every estate repo** — other agents' worktrees live
   beside yours and `rm -rf` does not ask.
3. **Remove junctions as LINKS first** (§3 already says this) — but note the
   failure above was the opposite direction: the links were fine, the *target*
   was deleted out from under them.
4. **The check that would have caught it in one command:**
   ```powershell
   Get-ChildItem C:\lcw -Force -Directory | Select-Object Name
   ```
   If `onedrive-excluded` is in that list — and it always is — the directory is
   not yours to remove.

**If it happens again**, the repair is in that order: recreate the missing target
directories so the junctions resolve, `npm install` at each repo root (⚠️ **not**
`npm ci`, which wipes `node_modules` wholesale), delete the now-stale empty
placeholders under `onedrive-excluded`, then re-run `onedrive-exclude.ps1` to
move the trees back out of OneDrive. Verified 2026-09-06: the three estate suites
came back **3,151 / 2,918 / 762** — the platform figure identical to the
pre-incident baseline.

## 1. Why a worktree at all

`npm run deploy:home` ends in `wrangler pages deploy sites/heygabi-home/public`.
⚠️ **A directory upload ships the WORKING TREE, not a commit** — the estate has
already put another agent's half-built search refactor on the live front door
this way. When the main checkout is shared (concurrent agents, or merely an
untracked directory like `.docs-backup-tmp/` that belongs to another workflow),
the deploy runs from a clean throwaway checkout instead:

```bash
git worktree add --detach C:/lcw/deploy-home2 HEAD
cmd /c "mklink /J C:\lcw\deploy-home2\node_modules C:\...\catalog-platform\node_modules"
cd C:/lcw/deploy-home2 && npm run deploy:home
```

The junction exists so the deploy does **not** pay for a fresh `npm install`.
⚠️ That matters beyond speed: a fresh install can resolve transitive
dependencies differently from the tree the tests just passed on, and the whole
point is shipping what was tested.

## 2. ⚠️ The symptom: `'tsx' is not recognized`, and every npm script dies

**What it looks like.** Every workspace script fails at once — `npm test`,
`npm run typecheck`, `npx tsc` — with `'tsx' is not recognized as an internal or
external command` and npx offering to install TypeScript for you. It reads like
a broken install. It is not: the packages are all still there.

**What is actually wrong.** `node_modules/.bin/` is **empty**. The shims are
gone; the 197 packages beside them are untouched.

```bash
ls node_modules/.bin | wc -l     # 0  → broken.  51 → healthy (this repo)
ls node_modules | wc -l          # 197 either way — this is why it looks fine
```

**The fix, and it is safe:**

```bash
npm rebuild        # relinks binaries from the installed tree
```

`npm rebuild` does **not** fetch and does **not** re-resolve. Measured
2026-08-24: `package-lock.json`'s md5 was identical before and after, and
`.bin` went 0 → 51, matching the two worktrees' own counts exactly.

**Where it comes from — how far the evidence actually goes.** Measured
2026-08-24: `.bin` was found empty with a directory mtime of **20:05:42**, the
same minute the night's first junctioned worktree was created. Both worktrees
had healthy 51-shim `.bin` directories of their own. A **recursive delete that
follows the junction into the real `node_modules`** is the only mechanism that
fits, and `.bin` sorting first explains why it is the only casualty — the
delete got one directory in. ⚠️ **This was NOT reproduced.** Do not write it
down anywhere as proven; the correlation is exact-minute and the mechanism is
inference.

On Windows the relevant difference is which tool removes the link:

| Removing the junction with | Effect |
|---|---|
| `cmd /c rmdir <path>` | removes the **link**. Safe. |
| `git worktree remove` | removes the checkout — ⚠️ with a junction still inside, it is deleting a directory that contains one |
| PowerShell `Remove-Item -Recurse` | ⚠️ known to **follow** junctions and delete the target's contents |

## 3. The teardown order that was measured safe

Remove the junction **as a link, first** — then the worktree. Count either
side; the count is the proof, and it costs one command.

```bash
ls node_modules/.bin | wc -l                       # 51
cmd //c "rmdir C:\lcw\deploy-home2\node_modules"    # the LINK only
ls node_modules/.bin | wc -l                       # 51 — still 51, or stop
git worktree remove C:/lcw/deploy-home2
ls node_modules/.bin | wc -l                       # 51
```

⚠️ **`git worktree remove` exits non-zero while having done most of the job.**
Measured 2026-08-24: it removed the checkout, then failed with
`error: failed to delete '.git/worktrees/deploy-home2': Permission denied`, and
`git worktree prune` failed the same way while still dropping the entry from
`git worktree list`. The stale admin directory is harmless and is removed by
hand (`rm -rf .git/worktrees/<name>`). **Do not read that exit code as "the
teardown failed" and retry with something more forceful** — that is exactly the
reflex that empties `node_modules`.

## 4. What the guards do and do not cover

`--commit-dirty=false` asks git whether the tree is dirty. In a fresh worktree
of `HEAD` the answer is honestly "clean", so the flag passes **on its own
merit** rather than because anything was suppressed. Nothing about the
junction, the teardown, or `.bin` is guarded mechanically — §3 is a procedure,
not an enforcement, and it is the weakest link on this page.

## 5. ⚠️ `deploy:home` is gated on the auth WORKER, not just on this site

Added 2026-09-05, after the guard refused a deploy and the refusal was right.

`npm run deploy:home` is `npm test && npm run check:home && wrangler pages
deploy … && npm run verify:home`, and that **`npm test` is the whole
workspace** — including `apps/auth-worker/test/cors-coverage.test.ts`, a
scanner that reads every `/api/estate/*` path named anywhere under
`sites/heygabi-home/public/**` and fails unless `apps/auth-worker/src/index.ts`
carries an `app.use(…, cors())` that covers it.

**So a front-end change that calls a NEW auth-Worker path cannot deploy until
that path's CORS mount is committed** — even though the two live in different
directories and feel like different jobs. This bites hardest in a parallel
build, where the page and the route are being written by different hands at
the same time; the page's commit lands fine and the *deploy* is what blocks.

⚠️ **Do not reach for `ALLOW_DIRTY_DEPLOY=1` or `--ignore-scripts` when this
fires — it is not that kind of failure, and neither would help.** The thing it
prevents is the estate's recorded one: a rejected preflight surfaces to JS as a
**network error**, indistinguishable from the Worker being down, so a page
shipped ahead of its mount looks exactly like an outage while working
perfectly. The fix is to land the mount; the wait is the guard doing its job.
Worked example, with the full refusal text:
[`request-a-catalog-design.md`](request-a-catalog-design.md) §10.
