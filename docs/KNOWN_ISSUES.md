# catalog-platform — Known Issues, Waivers & Exceptions

> **Audience:** Claude/Kiro sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-26** — KI-10 was re-measured that day against a real
> failed backup run (secret now present; the report itself was refused — see the
> entry). ⚠️ **KI-1 through KI-9 were NOT re-checked**; KI-8 needs the
> Cloudflare dashboard, which only the owner can open.
>
> **This file exists to stop the same non-bug being re-reported every month.**
> It holds things that ARE wrong, or look wrong, and are deliberately tolerated.
>
> - Work in flight → [`TODO.md`](TODO.md)
> - Traps you fall INTO while working → `info/gotchas.md`
> - Finished work → [`DONE.md`](DONE.md)
>
> ⚠️ **A gotcha is something you *do* wrong. A known issue is something that
> *is* wrong and is tolerated.** Filing in the wrong one is how a real defect
> gets read as a tip.
>
> Every entry carries **Symptom · Status · Why tolerated · What would change
> it** — and the last one should be a NUMBER wherever it can be, not a
> judgement call. Format rules: [`DOCS_STANDARD.md`](DOCS_STANDARD.md) §5.

**Status values:** `ACCEPTED` (known, not being fixed) · `WAIVED` (a rule
deliberately switched off here) · `BLOCKED` (waiting on something outside our
control) · `WATCHING` (tolerated only while it stays small).

---

## KI-1 · Node 20 deprecation warning on every CI run — `ACCEPTED`

**Symptom.** Every GitHub Actions run ends with
`Node.js 20 is deprecated. actions/setup-node@v4 … forced to run on Node.js 24`.
It appears as an annotation on green runs and looks like something failed.

**Why tolerated.** It is GitHub's warning about the *action's own* runtime, not
about our code, and the runner already forces Node 24. Nothing is broken and
nothing we ship is affected.

**What would change it.** `actions/setup-node@v5` being released and stable.
Until then, ignore the annotation — ⚠️ and do not read a red X off it, because a
run can carry this warning and still be entirely green.

---

## KI-2 · The estate repos are PUBLIC — `ACCEPTED`, and it constrains everything

**Symptom.** People assume these repos are private and write accordingly.

**Why tolerated.** The owner's choice; measured with `gh repo view` on
2026-08-17 for all four. The names-only discipline was never conditional on
privacy — but "it's private, so a name here is fine" is one short step from "so
a value is fine", in a repo the whole internet can read.

**What would change it.** Nothing planned. ⚠️ Treat every commit as published.
The estate-wide credential catalogue is deliberately LOCAL ONLY in
`audiobook_catalog/docs/access/CREDENTIALS.md` for exactly this reason.

---

## KI-3 · `wrangler dev` writes your `.dev.vars` into a source map — `WATCHING`

**Symptom.** A live `ANTHROPIC_API_KEY` turns up in
`apps/*/.wrangler/tmp/dev-*/index.js.map` — a file nobody thinks of as a secret
store.

**Why tolerated.** It is upstream wrangler behaviour and the paths are
gitignored in every repo. Measured 2026-08-21: 30 files across the estate held
key material; 24 of them were duplicates inside stale agent worktrees, since
deleted.

**What would change it.** ⚠️ **Nothing about it is safe by default** — the
protection is entirely the ignore rule. `Board_Game_Catalog`'s rule lived only in
`.git/info/exclude`, which is **not committed**, so a fresh clone had no
protection at all; fixed 2026-08-21 by moving it into the tracked `.gitignore`.
**Any new repo must have `.claude/worktrees/` and `.wrangler/` ignored in the
TRACKED `.gitignore` before its first `wrangler dev`.** Full write-up: finding
F-9 in `audiobook_catalog/docs/access/CREDENTIALS.md`.

---

## KI-4 · `estate-audio` is refused by the R2 backup, mechanically — `ACCEPTED`

**Symptom.** The nightly backup skips a bucket, and `scripts/backup-r2.mjs`
exits non-zero if you name it.

**Why tolerated.** ⚠️ **`estate-audio` IS the off-site backup** — ~685 GB of
disaster-recovery archive of the audiobook library. Tarring it onto a 14 GB
runner is an outage, not a backup, and it would be a backup of a backup eight
generations deep.

**What would change it.** Nothing. The escape hatch is deliberately awkward
(`BACKUP_R2_ALLOW_REFUSED=estate-audio`) and anyone using it should have to mean
it. See `access/backup-restore.md`.

---

## KI-5 · `ebooks-gated/transcripts/` is excluded from its bucket's backup — `ACCEPTED`

**Symptom.** A restore of `ebooks-gated` from a nightly dump does **not**
contain the Whisper transcripts.

**Why tolerated.** Owner decision 2026-08-19: a transcript already exists three
times before the backup runs (local disk, the Drive mirror, the bucket itself),
and a nightly whole-bucket tar would make it copies four through eleven at
~2.6 GB a generation on a 14 GB runner. The rest of the bucket has **no** other
estate-side copy and is fully backed up.

**What would change it.** ⚠️ **The exclusion is announced on every run and
written into each dump's own manifest** — deliberately, so a disaster-day reader
sees it from inside the archive. Where transcripts actually come back from:
`access/backup-restore.md` §6 and `RECOVERY.md` §5.

---

## KI-6 · `/status` and `/universes` omit `auth.heygabi.ai` from CSP `frame-src` — `WATCHING`

**Symptom.** An asymmetry: `/`, `/admin` and `/series` name the auth origin in
`frame-src`; `/universes` and `/status` do not.

**Why tolerated.** ⚠️ **Nothing has been measured to break.** It may be a no-op.

**What would change it.** Measure first — find a flow on those two pages that
actually needs an auth iframe. Fixing an asymmetry that harms nothing, by
widening a CSP, is a net loss.

---

## KI-7 · The `/todo` board is hand-maintained, not generated — `ACCEPTED`

**Symptom.** The board at `/status` can disagree with `docs/TODO.md`.

**Why tolerated.** Argued and recorded in `TODO.md`'s own "why it is NOT
generated" section. A generated board would either publish raw internal notes or
need a curation layer nobody has built.

**What would change it.** Someone deciding the drift costs more than the
curation. Until then ⚠️ **`docs/TODO.md` is the source of truth**, and the board
is a summary of it.

---

## KI-8 · A stale broad Cloudflare API token still exists — `BLOCKED` (owner)

**Symptom.** "Edit Cloudflare Workers" (issued Aug 14) carries Admin Read+Write
on **all** R2 buckets and nothing known uses it.

**Why tolerated.** Only the owner can revoke it — a dashboard action, and
access-reducing changes are his to make.

**What would change it.** Revoke it from the dashboard. ⚠️ Its sibling **"Edit
Cloudflare Workers 2" (Aug 17) IS the live CI-deploy token — keep that one.**
Confusing the two takes CI down.

---

## KI-9 · OneDrive dehydrates files into placeholders that Node reports as symlinks — `ACCEPTED` (upstream), guarded here

**Symptom.** A file is plainly on disk, `ls` shows it, and a Node script that
walks the tree does not see it. `readdirSync(..., {withFileTypes:true})` reports
`isFile() === false` and `isSymbolicLink() === true`.

**Why tolerated.** It is how OneDrive "free up space" works — the file becomes a
reparse point until something opens it. Nothing here controls when OneDrive
decides to do it, and every estate repo lives under OneDrive.

**What would change it.** Nothing upstream. 🔴 **The guard is in the code, and
any new tree-walker needs the same one:** resolve the entry with `realpathSync`
+ `statSync` (which follow), include it if it resolves INSIDE the tree, and
refuse it if it resolves outside — the original reason not to follow links.

⚠️ **This already cost a real silent failure.** `scripts/backup-docs.mjs` walked
`Board_Game_Catalog/docs`, found **27 of its 46 files, and reported success.**
Fixed 2026-08-21; the walker now also PRINTS every skip and carries the skip list
inside each archive's own manifest. Re-drilled the same day: 46/46 restored,
`diff -r` against the live tree — zero differences.

---

---

## KI-10 · A failed backup still notifies nobody — `WATCHING` (half-fixed 2026-08-21)

**Symptom.** `backup.yml` fails on a store and nothing tells anyone. The
2026-08-21 scheduled run failed on two buckets and was noticed only because a
human opened Actions. ⚠️ `fail-fast: false` means the other nine stores still
land, so the run is **partially** green — the shape of failure that gets
shrugged at.

**Why tolerated.** Half of it no longer is: a `notify-failure` job now reports
any non-clean result to the estate event ring, so it surfaces on `/status`.
It was a no-op for five days because the secret did not exist (measured
2026-08-21, re-measured unchanged 2026-08-23) — the job emitted a loud
`::error::` annotation naming the missing secret rather than exiting quietly,
which is the best it can do from inside CI, but nothing reached `/status`.

✅ **STEP 1 CLOSED — `ESTATE_EVENTS_TOKEN` IS NOW A REPO SECRET.** Measured
2026-08-26 21:35 UTC with `gh secret list` (names only): three secrets, not two —
`CLOUDFLARE_API_TOKEN`, `ESTATE_EVENTS_TOKEN`, `FIREBASE_SERVICE_ACCOUNT_JSON`.

**What would change it.** Two things, both measurable and in order:

1. ~~**Owner: add the secret.**~~ ✅ **DONE 2026-08-26** (set 21:35:50 UTC).
2. **See one real failure arrive on `/status`.** Shipped is not verified.
   🔴 **STILL OPEN as of 2026-08-26 — and the first attempt FAILED. Read on.**

**MEASURED 2026-08-26 — the first run that ever exercised this path.** Manual
dispatch
[`33016196134`](https://github.com/skymitch9/catalog-platform/actions/runs/33016196134),
started 21:37 UTC, 1 min 13 s after the secret was set. `r2 (game-covers)`
failed on a Cloudflare rate limit (`backup-restore.md` §3.2c), so
`notify-failure` ran against a REAL failure with a REAL token — and the estate
event ring **rejected the report as a bad request (HTTP 400)**:

```
##[warning]Backup run did not complete cleanly: d1=success firestore=success r2=failure retention=success
event ring responded 400
{"error":"missing_worker","detail":"Every event must name the `worker` that produced it."}
```

⚠️ **The refusal was CORRECT and the workflow was wrong.** `parseEvents`
(`apps/auth-worker/src/worker-events.ts:100`) does
`Array.isArray(body) ? body : [body]` — it accepts one event object, or an array
of them. `backup.yml` was posting `{"events":[{…}]}`, so the *wrapper* became
"the event", and a wrapper names no worker. Nothing had ever posted a real body
through this path, so five days of "the notification is shipped, it just has no
secret" was hiding a payload that would have failed on the day it mattered.

✅ **Fixed 2026-08-26** in the same commit as the §3.2c backup fix: the curl now
sends a bare `[{ … }]` array, with the incident written beside it in the
workflow. ⏳ **NOT YET VERIFIED END-TO-END, and deliberately so.** The next run
([`33017504084`](https://github.com/skymitch9/catalog-platform/actions/runs/33017504084))
went **14/14 green**, so `notify-failure` took its "all jobs succeeded" branch
in 3 s and posted nothing — ⚠️ **the §3.2c fix removed the only failure that was
available to test against.** Options, in preference order: wait for the next
genuine failure; or post one test event by hand with the token and confirm it
lands on <https://heygabi.ai/status/> (the ring's own GET is devops-gated).

Until step 2 is confirmed green, treat backup health as **checked, not
alerted** — i.e. it still depends on somebody looking.

⚠️ **The age grading is the other half, and it catches a different failure.**
This job answers "it ran and broke"; the freshness grade answers "it never ran
at all" — and a job that never starts cannot report its own failure. Neither
substitutes for the other.
