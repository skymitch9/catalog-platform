# Estate code audit — scope and harness (2026-08-23)

> **Audience:** the owner (go/no-go), then the Claude conductor that runs it.
> **Status:** TRACKED. **Last verified:** 2026-08-23 — the line counts and unit
> list were measured that evening; the cost figures are ESTIMATES from the
> calibration table in `~/.claude/CLAUDE.md`, labelled as such.
>
> Owner ask, 2026-08-23 ~20:05 Phoenix: *"a full audit code review of all the
> codebases, apis, uis, etc that are attached to heygabi … ongoing … in the
> background … sub agents so we can still work on other things."*

## 1. What is in scope — measured

| Repo | Non-test source | Units |
|---|---|---|
| `catalog-platform` | 75,586 lines | auth-worker · index-worker · discord-worker · audiobook-worker · ebooks-door · heygabi-home site (status pages, estate-search, themes, admin) · packages (estate-auth, estate-events, gabi-conversation, firebase-sa) · backup scripts + CI workflows |
| `bookbuddy/library_catalog` | 69,763 | worker routes in 5 slices (auth/users/admin · catalog/copies/editions/covers · research/details/donor/peer · scan-jobs/isbn/enrich · gabi + memory) · packages core · db + migrations · isbn/research/universes · web app · scripts (backfills, deploy guards) |
| `bookbuddy/audiobook_catalog` | 66,546 | pipeline (`sync_to_drive.py` + `app/core`) · `app/tools` · site JS (player, readers, fb rules) · shelf server + Docker · scripts · CI |
| `boardbuddy/Board_Game_Catalog` | 34,484 | worker · web · packages (barcode, bgg, core, db, research) · scripts |
| Cross-cutting | — | estate auth contract across all Workers · secrets/credential handling · CORS + CSP · deploy guards · Firestore rules (2 projects) · GitHub workflows |

**~24 review units.** Out of scope: `node_modules`, `dist/`, generated packages, vendored pdf.js, the ~9 dead `worktree-agent-*` branches.

## 2. What each reviewer looks for — the estate's own checklist, not generic advice

Every rule below is traced to a real incident in these repos (the global rules and each repo's `KNOWN_ISSUES.md` / `info/gotchas.md` name them). Reviewers are briefed with this list AND told to read the target repo's `KNOWN_ISSUES.md` first so they do not re-report an accepted defect.

**Correctness / data integrity**
- Does anything move a **persisted key** (`work_key`, `audio_key`, review keys) on an ordinary edit path? (the silent-retitle trap)
- Does a **status flag travel atomically** with its value? (`cover_status` ↔ `cover_url`, migration 0040)
- Is **silent failure distinguishable from success**? (rungs that printed "no cover" when never asked; a 0-row walk that reported success)
- Is there a **second implementation** of something canonical? (three wrong-game matches from a drifted similarity function)
- Does a change need a **migration that must not ship unattended**? Do new code paths meet an old schema anywhere?
- Validators that **strip instead of reject** (`.strict()` on every PATCH schema?)
- Thresholds/constants whose **premise has moved** (the backup-grading incident)

**Auth / access**
- **Mount order**: a blanket `.use('*', requireCapability(...))` on a sub-app at a bare prefix gates everything mounted after it (the `export.ts` incident); and a machine route mounted BELOW a human blanket is unreachable by machines.
- The **four refusal causes stay distinct** (not signed in / awaiting approval / insufficient role / revoked) and a network failure is never labelled a permission failure.
- **No bare HTTP status reaches a person**; every refusal says what/needs/how.
- Capability tables: does every route declare one, and is there a test pinning the table?
- Access-**increasing** paths (grants, default-grant on outage, role widening) — who can reach them?

**Secrets / exposure**
- Any secret VALUE in tracked files, comments, tests, source maps, logs? (KI-3: `wrangler dev` writes `.dev.vars` into a source map; a key was hardcoded in `find-covers-tmp.mts`)
- Export/projection surfaces **default-deny** (explicit allow-list, never SELECT-\*-minus)
- CORS: a Hono CORS mount is not implied by a route (the `/ops/ingestion` incident); `_headers` does not match by prefix (three pages nearly shipped with no CSP)
- Firestore rules: validate the whole resulting state, never that a change is "among" the changes (the `hasAll` incident)

**Operational**
- Deploy guards present and not bypassable by an easy flag; directory deploys from a clean tree
- Scheduled jobs that commit: explicit allow-list, `--autostash`, never `git add -A`
- Subrequest/limit ceilings (the 50-subrequest cron that would terminate silently)
- Windows traps: cp1252 writes, `npx` not exec-able as bare argv, path length, OneDrive placeholders read as symlinks
- Every `/api/health` speaks the shared envelope; every new endpoint has a probe

**UI**
- Controls a person cannot use are not rendered — but the page never looks broken ("this is for admins")
- Staleness is labelled on every pushed/cached number, and an age label is a floor not a fix
- Theme contract (`--et-*` tokens) respected; no second copy of estate assets

## 3. The harness — a Workflow, not a parked agent

Deterministic fan-out, so coverage is a list and not a hope:

1. **Inventory** (1 Sonnet agent): walks each repo and returns the unit list with exact paths and line counts — replaces §1's hand list with a measured one.
2. **Review** (1 Opus agent per unit, ~24, runs ~10 at a time): reads the unit in full plus its repo's `KNOWN_ISSUES.md` and `gotchas.md`; returns structured findings `{file, line, category, severity, claim, evidence, how_to_reproduce}`. Read-only. Told explicitly that "nothing found" is a valid answer and a padded list is a failure.
3. **Verify** (1 Opus refuter per finding, pipelined per unit): tries to REFUTE each finding against the code — is it real, is it already in KNOWN_ISSUES, does a test already cover it. Defaults to refuted when uncertain. Only survivors go forward.
4. **Synthesis** (1 agent per repo, Opus; one estate-wide pass at the end — **Fable only if the cross-repo judgement needs it**, otherwise Opus): writes `docs/info/audit-2026-08-findings.md` in each repo (severity-ranked, evidence-linked, KNOWN_ISSUES cross-referenced) and appends a ranked "AUDIT" section to that repo's `TODO.md`. **No code is changed by the audit.** Fixes are separate, owner-decided dispatches.

Model tiering per the standing rule: builds and reading on Opus, Sonnet for the mechanical inventory, Fable reserved.

## 4. Cost — an estimate, not a measurement

Calibration: a read-only survey of several repos cost **184k**; focused research ~100k. Budget per unit review ~120–180k × 24 ≈ **3–4.5M tokens**, plus verification (~30k × maybe 60 findings ≈ 1.8M) and synthesis (~150k × 5). **Call it 5–7M tokens**, which on 2026-08-23's observed rate (~4 Opus agents ≈ 1 weekly point) is roughly **10–15 weekly points**. ⚠️ Guess from a small sample; the conductor takes the mandatory usage reads after each phase and **pauses the workflow at 60% weekly**, never lets it run blind.

Wall-clock: ~2–4 hours with 10 concurrent slots.

## 5. How "ongoing" works

The Workflow runs in the background and notifies the conductor on completion; the conductor checks `/workflows` between other tasks, takes a usage read at each check, and can resume from the run id if it is paused or killed — completed units are cached and are not re-reviewed. Findings land in the repos' docs as they synthesise, so a partial run still delivers.

## 6. Owner decisions before it runs

1. **Go / no-go** on the scope and the cost band above.
2. Whether the estate-wide synthesis may use **Fable** (one agent, ~200–300k Fable tokens) or stays on Opus.
3. Whether findings may be pushed to GitHub as part of the docs commits (the repos are public — findings that name an exploitable gap should stay LOCAL until fixed; the harness defaults to **local commits, no push**).
