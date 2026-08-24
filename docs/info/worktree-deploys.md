# Deploying from a throwaway worktree — and the way it eats `node_modules`

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-24** — the teardown order below was executed and
> measured that night (counts taken either side of every step). ⚠️ The *cause*
> in §2 is INFERRED from timestamps, not reproduced; §2 says exactly how far
> the evidence goes.
>
> Operating steps: [`access/README.md`](../access/README.md). What shipped:
> `deploys.log`.

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
