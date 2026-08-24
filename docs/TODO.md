# TODO — catalog-platform (ACTIVE work log)

> 🔄 **CONDUCTOR STATUS (00:1x, session 2%):** DONE this session → audio-edition-count
> MERGED to library main (11f1317, 1445 tests). IN FLIGHT → OR-1 follow-ups
> (feature/lent-to-person); --llm double-bill fix (feature/covers-owner-key); T-C
> backup-100%; T-D pipeline-sanctity; T-B universe sweep all libraries. Do NOT
> re-dispatch. HELD → ebook-site count (pipeline mid-run).


> 🔴🔴 **THE ROTATION DEADLINE BELOW HAS PASSED AND THE KEY IS STILL LIVE.**
> **Verified 2026-08-23 ~19:30 Phoenix**, 3½ hours after the 16:00 window this
> file set: `gh secret list --repo skymitch9/audiobook_catalog` reports
> **`CLAUDE_LLM` last updated 2026-07-07** — i.e. untouched. The leaked
> Anthropic key (`sk-ant-api03-…`, last 4 **5AAA**) has now been exposed in a
> session transcript for over a day.
>
> ⚠️ **A dated deadline that has passed reads as upcoming to a skimming eye**,
> which is exactly how it gets missed twice. It is restated here at the very
> top rather than left to be inferred from the date.
>
> **Only the owner can do this** — minting and revoking credentials are his,
> and Claude must never handle the value. Step 1 (revoke at
> console.anthropic.com) is reversible-safe and makes everything after it
> safe; do that first even if the replacement waits.


## ☐ NEW OWNER TASKS 2026-08-23 ~21:40 — queued for the conductor (Opus/Sonnet, NEVER Fable)

⚠️ Owner: "ration Fable 5 credits above all else." Every one of these is an
Opus or Sonnet subagent; the Fable main loop only orchestrates. All READ-ONLY
analysis except the universe sweep (idempotent data backfill). Land-for-review:
report + propose, no deploy / remote migration / paid sweep / flag / destructive
action.

- **T-A · Damsels covers — DONE 2026-08-23 (Fable, direct).** All 5 Damsels of
  Distress works on both instances now carry the publisher cover art
  (mountaindalepress.store `Author_spotlight_with_brand_{28,29,30,27,31}`),
  cover_status=ok. ⚠️ The store only offers 3D-mockup-on-grey art, not flat
  jackets; `00.png`/`1.png` were the "random text" marketing graphics. If flat
  jackets are wanted, a later pass hunts Amazon/audiobook covers.

- **T-B · Universe series sweep, ALL libraries (Opus).** Run
  `backfill-universes.mjs` (library_catalog) DRY then --commit on
  library-catalog + library-catalog-2nd; the equivalent universe backfill in
  Board_Game_Catalog and audiobook_catalog; re-push to the estate index if the
  script does not. Idempotent free backfill — OK to --commit, but NO deploy/push.
  Report what universes changed per instance.

- **T-C · R2 backup mirror to a verifiable 100% (Sonnet).** Board (board-push-
  task@home-pc) shows 1,267 files / 687 GB / "total unknown" so no %, 1 failure
  KindleForPC-installer-2.9.71006.exe, last upload 23h ago, next run 10:05 PM.
  Investigate: is the mirror actually COMPLETE (any missing files vs source)?
  why is there no denominator (can `_mirror_estate_backups` record a total so
  100% is showable)? is the KindleForPC .exe a real upload failure or junk that
  should be excluded? Report + propose action; take none unattended. `access/`
  RECOVERY / backup-restore docs are the map.

- **T-D · OpenAudible pipeline SANCTITY analysis (Opus).** The whole path:
  OpenAudible export -> sort m4b + epub into author folders -> Drive uploads ->
  catalog rebuild -> index/docs push (audiobook_catalog `scripts/sync_to_drive.py`,
  `app/`, sort_books/sort_companion_files). Analyze correctness, robustness,
  failure modes, idempotency, what can be improved. Read-only report to
  audiobook_catalog `docs/info/`.

- **T-E · Shelf author-folder cover + 2 persistent issues (Opus).** Audiobookshelf
  on Justin’s box. (1) Find Kiro’s notes on the "author folder book cover"
  thing — grep all four docs trees. (2) The 2 persistent shelf issues — identify
  them from the docs and current state. (3) Opus previously proposed a COMPLEX
  path involving the server owner — find that proposal, assess whether it is
  sound or there is a simpler way, and recommend. Read-only report.
  (4) Shelf **series and collections are EMPTY** — determine whether that is
  on purpose (ABS not configured to build them / a metadata-agent setting) or a
  fault, and how to populate them. Owner asked 2026-08-23.

- **T-F · Shelf migration research — reader/player + the audio-filter bug (Opus).**
  Owner is slowly migrating things onto the shelf (Audiobookshelf, Justin’s box).
  Research, read-only, report with recommendations:
  (1) ⚠️ On shelf, EVERYTHING is under the AUDIO filter — including ebooks and the
  ereader. Find why (ABS library-type / media-type config, or how items are
  pushed) and how to separate ebooks/ereader from audio.
  (2) What happened to the option to READ ebooks on the shelf and generate a
  DIRECT LINK to the opened book — trace the estate’s in-browser ebook viewer
  work (catalog-platform `GET /api/ebook/:anchor/file`, the vendored-pdf.js
  reader at `/read`, `docs/info/ebook-viewer-*`) vs what ABS offers natively,
  and whether a deep link into an opened book is possible on ABS.
  (3) Feasibility of an embedded SHELF PLAYER on the audiobook catalog
  (audiobooks.heygabi.ai) vs having to flip out to the ABS page — what ABS
  exposes (stream URLs, an embeddable player, auth via Cloudflare Access) and
  the honest limits. Owner asked 2026-08-23.

---

## ☐ T-G · Random TBR picker with pizzazz (BUILD, Opus) — owner ask 2026-08-23

Padhard admins want to "wheel-spin" the TBR to pick a book at random. Owner wants
animated presentations (wheel spin, dice roll, card shuffle…) + filter params, and
gave design/hosting discretion.

**Conductor design call (my discretion, revise if the owner reacts):**
- **Host: ONE reusable component in a shared `packages/` module**, mounted on each
  site’s TBR page, reading THAT site’s own TBR via its existing TBR API — mirrors
  the `@platform/gabi-conversation` "one canonical module, per-surface mount"
  pattern. TBR lives per-instance (library, padhard, audiobook), so the picker
  reads whichever site it’s on. One implementation, no duplicated logic.
- **Core:** `pickRandom(tbr, filters)` — pure, tested, deterministic given a seed
  (so a "reroll" is a new seed, and animations can be replayed). Never a second
  random impl.
- **Filters/params:** format (audio / physical / ebook), hardcover ⟷ no-hardcover,
  first-in-series-only, series-continuation-only, owned-vs-wishlist, exclude just-
  rerolled. **Reroll** button. Respect the estate’s format-gating (TBR already
  carries format; do not surface a book a person can’t open).
- **Presentation:** a THEME system with a polished **wheel spin** as v1, built so
  dice-roll / card-shuffle are drop-in additional themes (data-driven, not forked
  components). Reduced-motion respected; theme picker persists per-person
  (localStorage). Pure front-end animation, no new data.
- Land for review (branch, not deployed). Ship the wheel + all params + reroll in
  v1; leave dice/cards as clearly-stubbed follow-on themes if time-boxed.

⚠️ Opus subagent — ration Fable. Tests for `pickRandom` (each filter, empty-TBR
worded empty state, reroll excludes last, seed determinism).

---

## 🌙 OVERNIGHT RUN POLICY — owner decisions 2026-08-23 ~21:25, before bed

Owner going to bed; wants questions answered NOW and work done before he wakes,
timing irrelevant. Four decisions, binding on every overnight agent:

1. **LAND FOR MORNING REVIEW — no unattended production changes.** Overnight
   agents build, merge to main, run tests, commit. They do **NOT**: deploy to
   prod, apply a REMOTE migration, run a PAID sweep (LLM covers/research), or
   flip a live flag. The owner approves ONE deploy pass in the morning. Local
   migrations for testing are fine.
2. **AUDIT: fix critical + high, report medium/low.** Fix agents write fixes on
   branches → main + tests, NOT deployed. ⚠️ A finding that is a DESIGN decision,
   not a clear bug (e.g. the `/api/series` gated-shelf metadata visibility), is
   FLAGGED for the owner, never auto-fixed — a wrong fix to intended behaviour is
   worse than none.
3. **GABI T2 catalog-fix lane: build DARK** (off-by-default flag), wired to
   Discord + the library chat panel, audiobook surface EXCLUDED (no audit seam).
   Owner flips it on himself after watching it live.
4. **Ebook-site audio count: YES** — change `audiobook_catalog`’s ebook matcher
   (`_agreed_row`, which refuses two-cover rows as ambiguous) so two audio
   editions render a COUNT, not a vanished mark. Flag any side effect the
   ambiguity-refusal protected against.

⚠️ **The conductor stays on Fable and orchestrates only** — every build is an
   Opus subagent. Watch usage each cycle; pause at ~78% session / 55% weekly and
   reschedule. Weekly is the real ceiling (~11 sessions per allowance); session
   caps are naps.

---

## ☐ HELD BUILD QUEUE — paused at 75% session 2026-08-23 ~21:17, resume at session reset

Paused to protect the session window (weekly 15%, Fable 2% — both fine). One-shot
cron `6d8b7313` fires ~23:42 to resume. In priority order:

1. **Resume the library_catalog audit** — `resumeFromRunId: wf_69d2365f-d02` (completed units replay from cache).
2. **OR-1 follow-ups** (owner-approved): a narrow `{id,displayName}` members endpoint at `editCatalog`; strict-create SHADOW mode (shadow→enforce) for `POST /copies`,`/works`,`/editions` — library KI-6.
3. **`--llm` double-bill fix** (owner: do it): in `feature/covers-owner-key` `backfill-missing-covers.mjs`, gate the LLM CALL on `--commit`, not just the SQL write — a dry pass currently bills and is not even a reliable preview. Merge the branch after.
4. **Alias-aware research** (owner: do it, cost accepted): make `research-run.ts` + free-details + `research.ts:388` ask under `work_alias`, capped like `enrich.ts` MAX_QUERIES=4. ~6–8 h. ⚠️ Re-opens a PAID question when an alias is added — owner accepted this 2026-08-23.
5. **Merge** `feature/audio-edition-count` to library main; the ebook-site audio count lives in `audiobook_catalog` (`build_ebook_manifest.py` + `ebooks.html`) — separate dispatch.
6. **GABI T2 catalog-fix lane** (owner chose T2, 2026-08-23): build the `gabi-confirm-lanes-design.md` T2 grammar — propose→restate→confirm-button→apply on the ASKER's borrowed role→report, for a book's own fields (title, series, volume, cover, format, description, notes). ⚠️ NOT raw SQL/direct DB — owner explicitly steered to the confirm lane. Capability checked at BOTH propose and press. T3 (people/club/status) deferred. Design of record: `library_catalog` `info/gabi-confirm-lanes-design.md`.
7. **Audiobook + Board_Game audits** — the remaining two repos.

---

## ☐ ESTATE CODE AUDIT — scoped + prepped 2026-08-23, awaiting owner go

> Owner, 2026-08-23 ~20:05: *"a full audit code review of all the codebases,
> apis, uis, etc that are attached to heygabi … ongoing … in the background …
> sub agents so we can still work on other things while it happens."*

**Plan:** [`info/estate-audit-2026-08.md`](info/estate-audit-2026-08.md) — scope
(~246k lines, ~24 units, 4 repos), the incident-traced checklist, the harness,
the cost band (5–7M tokens ≈ 10–15 weekly points, a GUESS), and the three
owner decisions. **Harness:** `scripts/audit/estate-audit.workflow.mjs`
(inventory → per-unit Opus review → per-finding Opus refuter → per-repo
synthesis). Read-only on source; writes only `docs/`. No push.

**Status, 2026-08-23:** **THIS REPO'S PASS HAS RUN AND SYNTHESISED.** 79
findings survived verification (1 critical · 7 high · 29 medium · 42 low)
across 13 units; 7 more were refuted. Read
[`info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md), and the
ranked critical/high work items at the **AUDIT 2026-08** section at the bottom
of this file. ⚠️ **F1 is a credential-exposure item and should be done first.**

The other three repos (`library_catalog`, `audiobook_catalog`,
`Board_Game_Catalog`) synthesise into their own `docs/`; **their state is not
knowable from here** — check each repo's own `docs/info/` rather than assuming
this row covers them. The conductor pulse-checks usage between other tasks and
pauses at 60% weekly. Deliverable per repo:
`docs/info/audit-2026-08-findings.md` + a ranked AUDIT section in its TODO.

## 🔴 SUNDAY 2026-08-23, 16:00 Phoenix — ROTATE A LEAKED ANTHROPIC KEY

**Deliberately above the pause banner. It is a live credential, and the in-session
cron reminder for it was session-only and did not survive.**

**What happened, 2026-08-22.** A masking script I wrote printed the value of
`Claude-llm` from `bookbuddy/audiobook_catalog/.env` into the session transcript
in full. The regex was `^([A-Za-z_][A-Za-z0-9_]*)=`, which does not match a
hyphen — the exact trap that file's own header (lines 19–21) warns about, in the
same output that leaked it. Anthropic API key, `sk-ant-api03-…`, **last 4
`5AAA`**. Deferred to Sunday only because the weekly limit was at 95% and the
owner had no credits to spend; the reset is 16:00 Phoenix.

**Steps, in order:**

1. **Revoke first** — console.anthropic.com → API keys → the key ending `5AAA`.
   Revoking first makes everything after it safe.
2. Mint a replacement.
3. **Install in BOTH halves.** Per `.env` line 17 this key is paired, and
   changing one alone gives a **silent 401**, not a visible error:
   - `bookbuddy/audiobook_catalog/.env` line 38, `Claude-llm=` — ⚠️ hyphenated
     and mixed-case on purpose; do not "normalise" the name, several readers
     depend on it
   - GitHub secret **`CLAUDE_LLM`** — owner runs `gh secret set CLAUDE_LLM` and
     pastes at the prompt. Never `--body` (shell history). Claude must not ask
     for or handle the value.
4. **Verify a consumer**, do not assume the paste landed — e.g. run
   `app/tools/fetch_content_warnings.py` or trigger the `cw-fulfill` workflow.

**Readers (name only — only `.env` and the GitHub secret hold the VALUE):**
`.github/workflows/cw-fulfill.yml` · `app/tools/extract_chapters.py` ·
`app/tools/fetch_content_warnings.py` · `app/tools/generate_prompts.py` ·
`docker-compose.sync.yml` · `scripts/sync_to_drive.py` · `docs/access/CREDENTIALS.md` ·
`docs/access/EXTERNAL_APIS.md`

**Owner's open question, answered but not acted on:** replace the static key with
**Workload Identity Federation** — GA, no beta header. The SDK auto-detects it
when `ANTHROPIC_FEDERATION_RULE_ID` + `ANTHROPIC_ORGANIZATION_ID` +
`ANTHROPIC_SERVICE_ACCOUNT_ID` + `ANTHROPIC_IDENTITY_TOKEN_FILE` (or
`_TOKEN`) are all set, and `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` /
`ANTHROPIC_PROFILE` each **outrank** it, so all three must be unset. GitHub
Actions is the natural fit — it issues an OIDC token, so the `CLAUDE_LLM`
secret could disappear entirely; the pipeline PC is better served by
`ant auth login` (a profile the SDKs read, no key in `.env` at all).
⚠️ **NOT VERIFIED:** whether Anthropic's federation rules accept the GitHub
Actions issuer specifically. Check in the console before promising it.

---

## ⏸️▶️ PAUSED 2026-08-19 · RESTART **Sunday 2026-08-23, 15:49 Phoenix** — READ BEFORE ANYTHING ELSE

> **This is the first thing in this file on purpose.** Everything below it is
> ordinary work log. If you are a new session, you are almost certainly the
> successor to the one that wrote this, and it did not survive.

**Why the estate is paused.** Weekly usage reached **89%** on 2026-08-19 and
does not reset until **Sunday 2026-08-23 at 15:59 Phoenix**. Owner order,
verbatim: ***"Let's save for emergencies."*** Overspending before then costs
DAYS, not an evening.

**When to restart: 15:49 Phoenix — TEN minutes before the reset.** Owner
order: *"set the start up rule for 10 minutes before weekly reset into the
todo doc."* ⚠️ The global rule in `~/.claude/CLAUDE.md` says *~5 minutes*; he
set **10**. Honour the 10, do not "correct" it back, and do not wait until
after the reset — the old window's remnant is wasted at the stroke either way,
and starting early at worst pauses into a reset that is minutes away.

⚠️ **A wake-up timer is NOT the mechanism.** One was scheduled, but
`CronCreate` jobs live in session memory and die with the process. **This
block is the resume mechanism.**

**Do exactly this, in order:**

1. **Read the clock** (`Get-Date`). Never infer the hour from message
   timestamps or from this document.
2. **Read usage** at <https://claude.ai/settings/usage>: navigate away and
   back (single-page app — it will otherwise serve the first render for
   ever), wait 2–3 seconds, then `find` the figures. ⚠️ **Confirm the reset
   actually happened** instead of assuming it from the clock: if weekly still
   reads 89%, it has not landed — wait and re-read. State the numbers with the
   time. If the read FAILS, say so plainly and fall back to the last known
   figure with its age; never treat an unreadable meter as a healthy one.
3. **Read the `⏸️ PARKED FOR EMERGENCIES` section further down this file** —
   it carries the parked queue in pick-up order, what is waiting on the owner
   and costs nothing, and what is frozen by separate order (all GABI
   features).
4. ⚠️ **Ask the owner before starting any build.** *"Save for emergencies"*
   expires **with the reset** — it does not lapse on its own, and the reset is
   not itself permission to begin. Present the parked queue **one item at a
   time**, per his standing rule.
5. **Model:** Fable stood at 91% and weekly at 89%. Unless the reset cleared
   both, the main loop is **Opus** and build agents are Opus/Sonnet — never
   Fable. A paste-ready Opus kickoff prompt is in the `MODEL SWAP` handoff
   section below.

**Nothing is broken and nothing needs rescuing.** All unattended work keeps
running with no Claude budget: the nightly book ingestion (240 books done, 0
failed, mid-book when this was written), the hourly details sweep on both
library instances, the R2 archive task, and the backups. Working trees are
clean and everything is pushed.

2026-08-22: Cover sweep completed (52 covers written, 20 indie titles remain).

## ☐ SUNDAY 2026-08-23 — a PreToolUse hook that surfaces the governing doc

Owner ask, 2026-08-21: *"add it to the todo list for sunday"* — "it" being the
generalisation of the surface-ownership guard, proposed after **two
documented-but-unread facts in one day**.

⚠️ **Sunday because that is the weekly reset** (Sun 15:59 Phoenix; the estate's
restart rule is 15:49, ten minutes early). This is the first piece of work with
real headroom behind it.

### The problem it solves, stated honestly

Twice on 2026-08-21 something was built that a doc already governed:

| What | The doc that said so | Caught by |
|---|---|---|
| `docs/*` added to two of the three places a backup store must be listed | `backups.ts`'s own header | a drift test |
| A second usage surface on `/status` | `docs/info/status-pages.md`'s ownership table | **the owner** |

⚠️ **"Read the docs first" is already a global rule, already mechanically
prompted at session start, and it did not prevent either.** Session-start
reading is the wrong instrument: the decision that goes wrong happens hours
later, against a specific file, and nobody re-reads 4,900 lines of docs before
each edit.

✅ **The in-repo half is DONE** — `predeploy.checks.json` → `surfaces`, enforced
by `scripts/predeploy-check.mjs`, drilled both directions. But it only covers
this repo, and only surfaces somebody thought to list.

### The build

A **`PreToolUse` hook** on `Edit`/`Write` that matches the target path against a
small table and injects the governing doc's key line *before* the edit happens.

```jsonc
// ~/.claude/doc-guards.json — path glob -> what to say
{
  "**/status/**":            "docs/info/status-pages.md owns which page shows what. Read the ownership table BEFORE adding a surface.",
  "**/backups.ts":           "A backup store must be listed in THREE places: KNOWN_BACKUP_PREFIXES, backup.yml's matrices, and the retention job.",
  "**/docs/TODO.md":         "Finished items move WHOLE to DONE.md — never summarised, never left with a ✅ badge."
}
```

☐ **Write the hook** (`~/.claude/hooks/doc-guard.sh`), registered in
  `~/.claude/settings.json` beside the existing `SessionStart` one.
☐ **Table lives OUTSIDE the script**, so adding a guard is a data edit, not a
  code edit — the same reason `predeploy.checks.json` is separate.
☐ ⚠️ **GENERIC, no project names in the script.** Per the owner's 2026-08-21
  rule, global rules must fit any project. The script reads the table; the table
  is per-machine.
☐ **Escape hatch**, an explicit env var (`CLAUDE_SKIP_DOC_GUARD=1`), never a
  flag anyone types by accident.
☐ ⚠️ **Test it against a path that should NOT match.** The `SessionStart` hook
  shipped flagging a published web-asset folder as a missing docs tree, and a
  guard that cries wolf is a guard people learn to ignore — which is the only
  way a mechanical guard actually dies.
☐ ⚠️ **`bash -n` is not a test.** It passed on the SessionStart hook while its
  `find` silently matched nothing, because a heredoc had turned the
  line-continuations into literal `\n`. Run it against a real path and read the
  output.

### The honest limit, to write into the doc rather than discover later

A guard only covers what somebody thought to guard. This narrows the recurrence
of KNOWN mistakes; it does not solve "an agent built before reading". Say so
where the table lives, so nobody reads the table's existence as coverage.

---


# KIRO — COMPLETE THIS WORK, by ease and quickness

> **Audience: Kiro (and any executor who is not the session that wrote this).**
> Ranked easiest-and-quickest first. Each item names the exact files, the exact
> commands, and how to know it worked. Written 2026-08-21.
>
> ⚠️ **This section lives in `catalog-platform/docs/TODO.md` ON PURPOSE** — it is
> the only one of the four docs trees that is **tracked in git**, so it survives
> a clone. `audiobook_catalog/docs/` and the items that live there are LOCAL to
> the owner's machine.

## Read this before you touch anything

These are the estate rules that actually bite. They are not style preferences;
each one is here because it cost real time.

1. ⚠️ **NEVER run `git stash` in a shared tree.** Two incidents in one night: a
   chained `stash pop` popped a pre-existing unrelated stash into conflicts, and
   a `stash -u` swept a concurrent agent's 527 uncommitted insertions. To ask
   "is this failure pre-existing?", use a throwaway `git worktree add <tmp> HEAD`
   instead. `git pull --rebase --autostash` is fine (it pops its own stash
   atomically).
2. ⚠️ **Stage an explicit file allowlist, never `git add -A`.** Other sessions
   and a scheduled pipeline write into these trees.
3. ⚠️ **Migrate before deploy, always.** New code must never meet an old schema.
4. ⚠️ **A deploy ships the WORKING TREE, not a commit** (`wrangler pages deploy
   <dir>`). Commit first. `npm run check:home` enforces this and will refuse a
   dirty tree — that is the guard working, not an obstacle.
5. ⚠️ **Doc updates are part of LANDING the work, not a later pass.** A finished
   item moves WHOLE from `TODO.md` to `DONE.md` in the same session — cut and
   paste, never summarise. Done items do not get a ✅ badge and stay put.
6. ⚠️ **Say what you did NOT verify** in every report. An unavailable fact is
   reported unavailable, never filled in with something plausible.
7. ⚠️ **`npm test | tail` makes the exit status that of `tail`.** A red suite
   passes silently that way. It has already put one commit on a broken suite.
8. **Commit at clean boundaries and often.** Finish fewer things completely
   rather than leaving one half-built.

---

# TIER 1 — quick and self-contained. Start here.

## ☐ Shelf connection details: a form Justin fills in, stored server-side

**Owner ask, 2026-08-22:** *"make those left open things he can enter on the ui
and they get saved somewhere secure, like our own version of a keyvault or to
our cloudflare keyvault or something."*

**The four values** currently blank in `audiobook_catalog/.env`, which
`scripts/sync_to_server.py` needs before the direct push can run at all:
`SHELF_SERVER_HOST`, `SHELF_SERVER_PATH`, `SHELF_SERVER_USER`,
`SHELF_SERVER_SSH_PORT`. Only Justin knows the first three; today they reach us
by him typing them into a chat message, which is exactly the hand-off this is
meant to kill.

### ⚠️ Design correction to make BEFORE building: this is CONFIG, not a key vault

A tailnet hostname, a unix username, a filesystem path and a port number are
**not secrets**. The secret in this system is the SSH *private* key, and it
never leaves the pipeline PC. So do **not** reach for the `/status/api` pattern
wholesale — that stores a **SHA-256 hash** and verifies against it, which is
correct for a token you only ever compare, and useless here because the
pipeline must read these values back in plaintext to use them.

Build a **config store** with an authenticated read, not a vault:

| | |
|---|---|
| **Write** | `POST /api/estate/shelf/config` — devops Access gate, the same one Justin already passes for `/runbooks/`. Body is the four fields, validated (host as a hostname, port 1–65535, path absolute) |
| **Store** | one JSON blob in KV, e.g. key `shelf:config` in an existing namespace. Values in plaintext — they have to be |
| **Read** | `GET /api/estate/shelf/config`, gated on a **machine token** minted at `/status/api` (that flow already exists and already hashes correctly). The token is the secret; the config is not |
| **Consume** | `sync_to_server.py`'s `get_config()` reads the endpoint when the `.env` keys are blank, and keeps its current "not configured" behaviour when neither source answers. ⚠️ It must NOT start guessing — that honest degradation is the best thing about that script |
| **UI** | extend the existing self-service facts form (`/runbooks/shelf-migration/`, SHELF_SERVER.md §8) rather than building a second form. One surface owns "Justin tells us a fact about his box" |

### Why it is worth building at all

Every Mashton hour this week traced back to nobody outside Justin's house being
able to see that disk. The direct push is what fixes that permanently, and
these four values are the last thing standing between it and working. A form
also means the next value — and there will be one — arrives the same way instead
of as a chat message somebody has to transcribe.

### Not to be forgotten

- ⚠️ **Decide `rclone sync` → `copy` in the same change.** `sync_to_server.py`
  line ~153 runs `rclone sync`, which makes the server match the local folder
  EXACTLY — anything on the shelf not on the pipeline PC is **deleted**. Correct
  for a mirror, wrong for the "push my missing books up" button this is being
  built to serve. `--dry-run` first, always.
- The read endpoint returning a host and username is a small disclosure. Keep it
  behind the machine token, do not log the values, and do not put them in a
  public repo — `audiobook_catalog/docs/` is gitignored, this repo is PUBLIC.
- Blocked until Justin does `SHELF_JUSTIN.md` §4 part C (Tailscale + `shelfsync`)
  — there is nothing to store until the hostname exists.

**Size:** small-to-medium; one Worker route pair, one KV key, one form section,
one `get_config()` change. **Not started — filed 2026-08-22 with weekly usage at
95%, deliberately not begun so it does not land half-built.**

---

## K8. Shelf link on every book — ~2–3 h — see `audiobook_catalog/docs/TODO.md`

Full plan is in that file under **"Shelf link on every book"**. The short version:
a fourth button in `app/web/templates/index.html` (~line 707, beside *Open author
folder*), backed by a new `shelf_book_map.json` built from ABS's own listing
(`GET /audiobookshelf/api/libraries/<id>/items?limit=0` returns `id` and a
`relPath` of `<Author>/<Title>`, joinable to `site/catalog.csv`).

🔴 **Read the three warnings in that item before writing code.** The one that
changes the design: **ABS item ids are not stable** — every id from the
2026-08-20 layout 404s today. Prefer an ABS *search* link over a deep item link,
which is exactly why two of the three existing buttons are already "Search … in
Drive".

---

## K9. Newest-author art: a real cover, series-first — ~2 h — `audiobook_catalog/docs/TODO.md`

Pick a random book from the author's collection, prefer #1 in its series, else
the lowest series number held. ⚠️ Two things must be decided before coding, both
written up in that item: what happens for an author with **no series at all**,
and whether "random" is re-rolled nightly or **seeded and stable** (stable is
almost certainly right — art that changes every night reads as a bug).

⚠️ Confirm the surface with the owner first. It is near-certainly ABS's home-page
"Newest Authors" shelf, which means the mechanism is **setting author images
through the ABS API**, not a UI change.

---

## K10. One sign-on everywhere: measure it — ~1 h, mostly clicking

The mechanism exists; this is a **coverage** task, not a build.
`DEFAULT_SESSION_ORIGINS` in `apps/auth-worker/src/env.ts` already admits seven
origins.

⚠️ **The allow-list is NOT the thing to check.** An origin can be on it and still
make a person sign in again, because adoption is a *client* behaviour — that is
the exact shape of the complaint that started the whole build.

**Do this:** sign in on ONE estate site, then open each of the others in turn and
**record whether it signs itself in with no tap**. That table is the deliverable;
the gaps fall out of it. Walk: `heygabi.ai` (home, `/status`, `/docs`,
`/runbooks`, `/admin`), `audiobooks`, `ebooks`, `library`, `padhard`,
`boardgames`. Do it in a real browser — an attribute or a 200 proves nothing here.

⚠️ **`shelf.heygabi.ai` is NOT part of this** and must not be folded in. It is
behind Cloudflare Access, a different gate at the network edge that knows nothing
about `SESSION_ORIGINS`. Confirmed by a real person on 2026-08-21.

---

## K12. Port the EPUB + PDF readers to the shelf — `audiobook_catalog/docs/TODO.md`

⚠️ **Blocked on an owner decision, not on code:** it moves ebook access from the
estate's own `vis_ebooks` / `download_ebooks` grants to Cloudflare Access, a
different gate with different membership. Owner directive 2026-08-17: *"I don't
want people scraping my books."* Settle that first.

## K13. Shelf UX / no ebooks dropdown — `audiobook_catalog/docs/TODO.md`

Three options written up; **A (a second ABS library on an ebooks-only hardlink
tree) matches the ask.** ⚠️ Same gate decision as K12 — **decide them together,
once.**

## K14. GABI unification phases 2–3 — `library_catalog/docs/TODO.md`

🔴 **`migrations/0380_gabi_person_profile.sql` is UNAPPLIED and Phase 1's code is
already on `main`.** Migrate before deploy. Phase 2 changes the conversation
**surface key**, which is a persisted key's input — that is a migration, not an
edit; existing `web_panel` rows do not move themselves.

## K15. The Wandering Inn — split print run — `library_catalog/docs/TODO.md`

⚠️ **Data drift, NOT a design question.** Volume semantics were settled
2026-08-19 in `info/volume-numbers.md`. **Do not reopen that design.** Establish
the publisher's real mapping first, in writing, before touching a record.

---

# NOT for Kiro — these need the owner

Listed so nobody burns a session discovering they are blocked.

| Item | Why it is the owner's |
|---|---|
| **Rotate the Anthropic key in `library_catalog/scripts/find-covers-tmp.mts`** | 🔴 A live key in plaintext. GitHub push protection caught it 2026-08-21; never pushed, never public. Only the owner should mint the replacement |
| **Revoke the stale broad Cloudflare token** ("Edit Cloudflare Workers", Aug 14, Admin R/W on ALL R2 buckets) | Dashboard action, and access-REDUCING actions are the owner's to take |
| **Retire the legacy shelf / worker-events / conductor env secrets** | ⚠️ Gate each on `Last used` showing a report from the minted key — observable, not guessed |
| **Which of K11's three branches, in what order** | A priority call |
| **The K12/K13 ebook-gate decision** | A security posture decision |
| **"Clean this site up a bit UX"** | Not a spec. Three measured starting points are in the shelf-UX item; ask before building |

---

# The order, in one line

**K1 → K2 → K3 → K4 → K5 → K6** are all short, independent, and safe to do in
any order — except that **K2 unblocks K11**, so do it early. Then K7–K10 as
sessions allow. Tier 3 only with the owner's go-ahead.


---

## ☐ Index machine read: DEPLOYED 2026-08-24, waiting on the owner's secret (2026-08-23)

The index can now be read by a **sibling Worker**, which it never could before:
`/api/lookup` and `/api/search` sit below the `requireEstateMember()` blanket,
which verifies a **human's** Firebase ID token, and the `INDEX_PUSH_TOKEN_*`
bearers authenticate writes only. No credential existed for a reading machine,
so the library Worker's free-details ladder had no way in at all.

Branch **`feature/index-machine-read`** (worktree `C:/lcw/index-read`), three
commits. Full design: **`docs/info/index-worker-design.md` §10** — an
owner-approved widening of §9 Q3, one token per calling app, resolved to an
**approved member's** slice (`{audiobook, library, games}` — *not* the owner's
break-glass set, and `library2`/`ebooks` stay out because they are `DEFAULT 0`
and hand-granted).

`npm test` 145/145 · `npm run typecheck` clean.

**Blocked on the owner — these three, in this order.** ⚠️ The order matters:
the route answers a worded 503 naming the missing secret while unkeyed, so
deploying first is safe; minting first would leave a token with nothing to
present it to.

1. ✅ **DONE 2026-08-24 04:02Z — the deploy.** Branch merged as `2603f36`,
   deployed with `npx wrangler deploy` in `apps/index-worker`, version
   **`4e07d0dd-570f-4258-92d9-d32c55e90e45`**. No migration was needed and none
   was run — ⚠️ `wrangler d1 migrations list index_catalog --remote` answered
   *"No migrations to apply!"* **before** the deploy, so `0003_visibility_cache`
   and `0004_series_registry` are BOTH already applied remotely and the
   `library_catalog/docs/access/index-worker.md` line calling 0003 **PENDING is
   stale** (last verified there 2026-08-14). Live: `GET
   /api/machine/lookup?title=x` → **503 `machine_read_unconfigured`**, body
   naming `INDEX_READ_TOKEN_LIBRARY` and the both-holders ritual, exactly the
   worded refusal §10 promises for the unkeyed state.
2. **Mint ONE value and set it on BOTH holders in one sitting** (they are
   write-only secrets; no readable copy will exist):
   - `wrangler secret put INDEX_READ_TOKEN_LIBRARY` — in `apps/index-worker/`
   - `wrangler secret put INDEX_READ_TOKEN` — on the **library** Worker
     (`library_catalog/apps/worker/`)

   ⚠️ **Must NOT be the same value as `INDEX_PUSH_TOKEN_LIBRARY`** — push writes
   a whole source's snapshot, read sees across every catalog.
3. **Re-run `npm run probe:estate`** and confirm `I9`/`I10` report **401
   `machine_token_missing`** rather than 503. ⚠️ **They PASS today at 503** —
   the probe deliberately accepts either worded refusal, so it proves the route
   exists and is wired but **cannot tell you whether the secret landed**. Step 2
   is verified by the code changing 503 → 401, not by the suite going green.
   Measured 2026-08-24 04:12Z, clean run: **118 passed, 0 failed** (the "105"
   written here on 2026-08-23 is stale — the suite has grown).

   ⚠️ **Run the suite ONCE.** Measured the same night: a second run inside a few
   minutes tripped `auth.heygabi.ai`'s own rate limiter and reported **12
   spurious failures**, every one a `429 {"error":"rate_limited"}` or a missing
   CORS header on a preflight that never got through. A back-to-back re-run
   measures the rate limiter, not the estate. Wait a couple of minutes.

**Then, separately:** wire the library Worker's ladder to call it, and add the
two rows to `library_catalog/docs/access/index-worker.md` (that repo is not
touched by this branch).

⚠️ **Shipped ≠ verified, and the gap is now a NARROW one rather than a total
one.** Superseded 2026-08-24: the probes HAVE been executed live (118 passed,
0 failed) and the machine route HAS been called against `index.heygabi.ai` —
but only ever into its **refusal**. **The machine read has never returned a
row**, because no token exists to present, so the happy path is unexercised in
production and stays that way until step 2. §10.8 is the table.

---

## ☐ Backup: the mid-body-drop fix is SHIPPED but not yet proven on a real bucket (2026-08-21)

Run `32469907247` (the 09:12 UTC schedule) lost `library-covers` and
`game-covers` to `TypeError: terminated` — a socket dying *after* `fetch()`
resolved, on a line the retry loop's `try` did not cover. Fixed, tested both
ways, written up in [`access/backup-restore.md`](access/backup-restore.md)
§3.2b and [`DONE.md`](DONE.md).

⚠️ **What is NOT verified: the fix against the real Cloudflare API.** The
regression is a stand-in server; the live proof is a run that survives an actual
mid-body drop, and those are intermittent — the 2026-08-20 run was green with
the bug present. Two things to close it:

☐ **Confirm the re-run landed both dumps.** `gh run list --workflow backup.yml`,
  then check `estate-backups` holds `r2/library-covers/<today>.tar.gz` and
  `r2/game-covers/<today>.tar.gz`. ⚠️ A red job means that day's dump for
  that bucket **does not exist** — backup.yml has no job-level retry.
☐ **Watch the next few 09:12 UTC schedules.** A retry line naming a bucket
  (rather than a crash) is the fix working; the log distinguishes them on
  purpose.

---


## ☐ Schedule the docs backup — it is BUILT and RUN ONCE, by hand (2026-08-21)

Owner ask: *"for our docs folders we don't want those on git but they're so
important to our work. Can we get those into blob and or Google Drive?"*

✅ **Done and drilled**: `scripts/backup-docs.mjs` →
`estate-backups/docs/<repo>/<UTC>.json.gz`, all four repos, unfiltered.
Restore is `scripts/restore-docs.mjs`, and the full round trip was measured the
same day — `diff -r` against the live tree, zero differences. Retention now
prunes the `docs/` prefixes to 8 alongside everything else. Written up in
[`access/backup-restore.md`](access/backup-restore.md) §6b.

☐ **Schedule it.** Nothing does, and one manual run is the silent-staleness
  trap with a longer fuse. ⚠️ It CANNOT go in GitHub Actions — three of the
  four docs trees exist only on the owner's machine, so CI would produce a
  cheerful archive of the one tree that is committed. Two candidate homes:
  a Windows scheduled task beside the hourly jobs, or a step of the audiobook
  pipeline next to STEP 9, which already runs there for this exact reason.
  **Owner's call which.**
☐ **Google Drive was the other half of the ask and is NOT built.** R2 went
  first because `estate-backups` already exists, is private, is pruned and is
  in the recovery runbook. Drive is a second custody store with its own sharing
  model — worth doing only if the answer to "what if Cloudflare is the outage"
  is yes. Ask before building.
🔴 **Handling rule, from a MEASURED finding:** these archives include
  `access/keys/` — **raw** service-account JSON and bearer tokens, not names.
  `estate-backups` must stay bound to no Worker, and a restore lands in a
  scratch directory that then gets deleted.

---


## ☐ One sign-on everywhere: finish the estate SSO port (owner ask, 2026-08-21)

Owner, verbatim: *"port over google sso memory from the other heygabi sites so
one sign on anywhere extends to every site a person has access too."*

**The mechanism already exists** and does not need designing — see
[`info/sso-design.md`](info/sso-design.md) (design of record) and
`audiobook_catalog/docs/access/ESTATE_SSO.md` (how to operate, test and roll it
back). One Google tap anywhere on `*.heygabi.ai` mints a session at
`auth.heygabi.ai`, and a participating origin adopts it silently on the next
page load. This item is about **coverage**, not about building the layer again.

**Measured 2026-08-21** — `DEFAULT_SESSION_ORIGINS` in
`apps/auth-worker/src/env.ts` already admits seven origins:

```
heygabi.ai · www · audiobooks · ebooks · library · padhard · boardgames
```

So the server half is largely done. ⚠️ **The allow-list is NOT the thing to
check.** An origin can sit in that list and still make a person sign in again,
because adoption is a *client* behaviour — that is exactly the shape of the
complaint that started the whole build (*"Ebooks makes me login every time"*),
and it was fixed on the client, not by adding a row.

☐ **Measure per-surface, not per-list: sign in on ONE site, then open each of the
  others in turn and record whether it signs itself in with no tap.** That table
  is the deliverable — the gaps fall out of it. Do it in a real browser; an
  attribute or a 200 proves nothing here.
  Surfaces to walk: `heygabi.ai` (home, `/status`, `/docs`, `/runbooks`,
  `/admin`), `audiobooks`, `ebooks`, `library`, `padhard`, `boardgames`.
☐ **Close whichever surfaces fail**, by shipping the adoption client there —
  the same file, not a re-implementation. ⚠️ One canonical implementation:
  `audiobook_catalog/site/identity.js` and
  `catalog-platform/sites/heygabi-home/public/assets/estate-auth.js` are already
  two copies of this idea. Do not make a third; if they have diverged, say so
  and pick one.
☐ **Add any missing origin to `SESSION_ORIGINS`** — `books.heygabi.ai` and
  `index.heygabi.ai` appear in `HEYGABI_LAYOUT.md` and are **not** in the list.
  Decide whether they are people-facing surfaces at all before adding them;
  ⚠️ granting an origin is access-INCREASING, so it gets confirmed, never
  assumed.
🔴 **CONFIRMED BY A REAL PERSON, 2026-08-21 — the owner: *"For the SSO task
  shelf cloudflare needs the sign in too, it made Justin sign in."*** So this
  is no longer a footnote about scope; it is a reported defect with a name
  attached. ⚠️ **And it cannot be fixed by adding an origin**: the shelf is
  behind **Cloudflare Access**, which is a network-edge gate that runs BEFORE
  any of our code and knows nothing about `SESSION_ORIGINS` or the estate
  directory. Its own session cookie (`CF_Authorization`) is what Justin was
  being asked for. Three honest options, none of them free:
  **(a)** accept it — Access prompts once per device and then rides its own
  cookie for the policy's session lifetime, so the fix may be lengthening that
  lifetime rather than removing the gate;
  **(b)** make Access and the estate directory agree on membership so the
  prompt is at least a one-tap Google flow he never has to think about again;
  **(c)** replace Access with an estate-auth-gated proxy in front of ABS —
  real work, and ⚠️ it moves the library's protection from Cloudflare's edge to
  our own code, which is the one gate SHELF_SERVER.md §2 calls load-bearing.
  ⚠️ Do not pick (c) casually to make one sign-in prompt go away.
☐ ⚠️ **Everything below still holds: `shelf.heygabi.ai` is a DIFFERENT gate.**
  The shelf is gated by **Cloudflare Access** (Google sign-in, family allowlist)
  — a different gate, a different membership list, and not something
  `SESSION_ORIGINS` reaches. "One sign-on anywhere" will still meet an Access
  prompt at the shelf for anyone who has not passed it. That interacts directly
  with the reader-port item in `audiobook_catalog/docs/TODO.md`; the two should
  be decided together.
☐ **"…every site a person has access to" is the load-bearing clause.** SSO
  carries *identity*, not *authorisation*: a signed-in person still meets each
  site's own grants (`vis_ebooks`, `download_ebooks`, roles). ⚠️ Verify that a
  person with no grant on a site sees the site's own written refusal — what
  happened, what it needs, how to get it — and never a bare status or a dead
  button. Silently signing someone in and then 403-ing them is a worse
  experience than the sign-in prompt it replaced.

---


## 🔴 THE FIRST REAL USERS HIT GABI — two P1s (2026-08-18, 19:26–19:28 Phoenix)

**Not the owner. Not tests. Two members of the household, in a channel, hours
after the suggestion lane went live on version `12c519db`.** Both transcripts are
now regression tests.

| # | What they typed | What she did |
|---|---|---|
| 1 | *"I can't sit and read a book it makes me fall asleep. Find me something entertaining"* | grepped the public index for **`can't sit read makes fall asleep something entertaining`**, found nothing, said so. He replied **"Gabi sucks what the heck."** |
| 2 | *"what is the fourth book in the Dungeon Crawler Carl series?"* | ⚠️ **NOTHING AT ALL** — twice (Diva 19:28, owner's re-ask ~22:00). Her follow-up: *"Did you turn her off?"* She had not been |

### ✅ P1-1 — FIXED. Three defects in one turn

Full write-up: [`info/gabi-suggestions-design.md`](info/gabi-suggestions-design.md) §10f.

1. ⚠️ **The routing miss — FOURTH of its family in one day.** Every
   `suggestIntent` pattern required a library word (*recommend, suggest, read,
   listen, book*). **Nobody asks for a "recommendation"; they ask for something
   good.** Widened with the conversational shapes, bounded so it stays a router.
   ⚠️ **The new lesson:** the other three were found by the OWNER using each
   lane's own prescribed phrasings. **This one was found by a stranger using
   ordinary English.** A detector tested only against the sentences its author
   imagined is a detector tested against one person's idiolect.
2. **She quoted a mangled version of his own sentence back at him**, in bold.
   `searchTermFor` is best-effort and its own header says it is *never
   load-bearing* — and then it was printed to a person. Now a reduction over five
   words is not quotable and she says she is not sure what to look up, ⚠️ and
   stops claiming the catalogue lacks it (an unbuilt search is not evidence).
3. **An unstated format asked a question and delivered no books** — the
   ask-instead-of-deliver defect, third time in one day. Now: audio picks first
   (the public slice, **no gate bypassed**), format question after, one clause.
   Plus `suggestMoodHints()` — *"it makes me fall asleep"* is a REQUIREMENT, and
   ⚠️ it can never open a shelf, because it is not a format.

### ⚠️ P1-2 — the silence: HARDENED, root cause NOT PROVEN

⚠️ **Say this plainly and do not let anyone "conclude" otherwise: the cause of the
7:28 PM turn is UNKNOWN and its evidence is gone for ever.** The estate could not
investigate its own bot — five instruments, each correctly knowing nothing:
`wrangler tail` is live-only, **`[observability]` was not enabled on this Worker
at all**, the event ring was never wired here, an unanswered turn writes no
conversation record *by design*, and the four daily fuses keep counts with no
history.

**What WAS established, by execution rather than by reasoning:**

- ⚠️ **A fuse is ruled out.** A capped turn says the cap sentence in the channel
  before returning. Fuses do not fail silently.
- ⚠️ **The deterministic path on that exact string is clean and fast** — driven
  through every detector, then through `handleMention` twice (keyless, and with
  a stubbed model + tool loop). No detector claims it; it reaches the generic
  model path and answers. **So it is not a routing or regex defect.**
- ⚠️ **The turn died before the FIRST model call.** A healthy turn emits three
  `gabi_turn` log lines, the earliest at classification. The tail showed none.
  That narrows it to the work ahead of classification: two DO storage reads, the
  three-way `Promise.all` (docs fuse, books fuse, **the Firestore profile read**),
  and the detectors.
- ⚠️ **A HANG is the only failure shape that produces the observed signature** —
  no answer, no error, no log, no exception. Every other outcome on this surface
  has a sentence written for it; a hang is the case where the code that writes
  the sentence never runs. And **three outbound calls had no deadline at all**
  (the index lookup, the Firestore profile read, Discord itself) while four
  others did — nothing at a call site marked the difference.

**So the fix is a CLASS fix, not a bug fix** — it makes the whole family
un-reproducible whichever member fired:

| Silence path | Now |
|---|---|
| any hang, anywhere in the turn | ⚠️ a **25s whole-turn watchdog** posts a worded follow-through and records `silent` |
| the index lookup | `AbortSignal.timeout(8s)` — it was the only call on the ordinary question path without one |
| the per-turn profile read | raced at 4s; tier 2 is colour, and a turn without it beats no turn |
| a throw in the setup, OUTSIDE the mention handler (`onFrame` only logged) | `onDispatch` wraps an inner handler and **posts** |
| a conversation or persona read that throws | both degrade — no history, or the default voice |
| `replyToMessage` refused (deleted message, permissions) | retried once as a plain message, then logged loudly and recorded `silent` |
| an ignored trigger | `mentionTrigger`'s `why` was **computed and thrown away**; now logged and ringed (except `not_mentioned`) |

**And the two missing instruments now exist:** `[observability] enabled = true`,
and a **40-turn ring** in the gateway object — lane, tools that actually fired,
what scope hid, whether words reached the channel — ⚠️ **and never a word of what
anybody said**. Plus `gabi_dispatch_taken` / `gabi_dispatch_done`, so the happy
path is finally visible in a tail: **a `taken` with no `done` is a turn that died
in between.** Runbook: [`access/gabi-turn-log.md`](access/gabi-turn-log.md).

**🧑 OWNER — the two tests that matter**

1. In a channel: *"@GABI find me something entertaining"* → expect **audiobook
   picks plus one closing question about format**, not a shelf search.
2. Re-ask the exact Dungeon Crawler Carl question. ⚠️ **If it is silent again it
   will now leave a trail**: `GET https://discord.heygabi.ai/admin/gabi/turnlog`
   (signed in, devops) shows the turn, and the Worker's logs now retain. Say if
   it reproduces — that is the evidence this fix could not get.

**Still open:** the turn-log read has never been performed by a real devops
sign-in; no `silent` row has ever been produced by a real hang; and the root
cause remains unproven.

### ✅ THE SILENT KILL — THE INSTRUMENTATION PAID FOR ITSELF (2026-08-19)

**A live two-message test caught two things on tape, hours after the ignore
logging shipped.**

⚠️ **THE "hi" KILLER — FIXED.** `{"evt":"gabi_ignored","why":"empty_question",
"content_len":25,"mentions_count":1,...}` — *"@GABI hi"* was **dropped in
silence**. `questionFrom` strips the mention leaving `"hi"`, `GREETING` then
strips `"hi"` as a courtesy prefix leaving `""`, which fails the floor.
**Every link was working as designed** and together they deleted the message
whose entire content is the greeting. The floor now asks whether anything was
said *at all* rather than what survived stripping; the mention IS the address.

✅ **THE DCC QUESTION IS INNOCENT.** A successful try is on tape end to end
(`dispatch_taken` → classify → lane `have_lookup` → `delivered:true`, 3954 ms),
so **content-triggered death is disproven for this build**. The remaining
intermittent first-try silences are **non-delivery** — the gateway gap after a
deploy evicts the object, plus the ping-off reply blindness. Both now have
surfaces: `socket{connected, connected_since, last_ready_at, fatal_reason}` on
the turn log, and a once-per-person notice when somebody replies with the ping
off.

**🧑 OWNER — the one-message test that closes it:** send **"@GABI hi"** in the
channel. It should now answer in her voice.

### (superseded) THE SILENT KILL — localized, instrumentation live

**Same channel, same minutes: short pings answered, one question died four
times** (19:28, 21:54, 21:56, 22:19) — ⚠️ **and two of those were AFTER the
watchdog deploy, which did not speak.** So the death is **upstream of
`gabi_dispatch_taken`**, not inside the turn.

⚠️ **There is exactly ONE silent path upstream of it, and it was mine:** the
`mentionTrigger` ignore branch exempted `not_mentioned` from logging — the very
case that produces this signature. **That exemption is now lifted** for any
message that *looks addressed to her*, and the filter costs nothing because this
bot has **no Message Content intent**: Discord sends `content` only for mentions,
ping-on replies and DMs, so an ordinary channel message still arrives empty and
stays unlogged. The line carries **shape only** — `content_len`,
`mentions_count`, `msg_type`, `is_reply`, `replied_to_me` — never a character of
text.

**🧑 OWNER — the one thing that finishes this:** re-send *"@GABI what is the
fourth book in the Dungeon Crawler Carl series?"* in the main channel. The next
tail, or `GET https://discord.heygabi.ai/admin/gabi/turnlog`, will name the cause
in one line.

⚠️ **Leading hypothesis, to confirm or kill — a REPLY WITH THE PING REMOVED.**
Discord delivers those with **no content and with her absent from the `mentions`
array**, and `wrangler.toml` already documents that as a state she is
structurally blind to. It fits every observation, including the apparent content
correlation: a long question typed as a reply, a short ping typed fresh.

**Ruled out by execution rather than reasoning:** a fuse (a capped turn speaks),
a routing or regex defect (that exact string was driven through every detector
and twice through `handleMention`, answering both times), and the wrong-channel
theory (it explains Diva's other channel and **not** the main one).

### ⚠️ What the P1s DISPLACED, and exactly where each stands

The batch these interrupted was memory tiers 3–4 and the GABI switchboard.
⚠️ **Tiers 3–4 are now BUILT AND LIVE** (see the deploy line for
`f69025df`); the switchboard's controls are still owed. What follows is the
honest state so the next hand
starts from evidence rather than from a guess.

**✅ Memory tier 3 (archive) + tier 4 (recall) — BUILT, DEPLOYED, LIVE.**
Archive writes and `recall_conversation` are running behind the shared
`GABI_MEMORY` posture (owner-approved). ⚠️ **One owner step remains and nothing
in code can do it:** create the Firestore **TTL policy** on
`gabi_conversations.expiresAt`, or say the cron fallback is preferred. Until it
exists documents accumulate — safe, visible and reversible, and
`gabi_archive_ttl_policy_claimed` reports `false` rather than pretending.
⚠️ **Nothing has been exercised by a real turn yet:** no archive row has ever
been written by a real person, and no recall has ever run against real data.
The superseded note follows.

**🟡 (superseded) Memory tier 3 (archive) + tier 4 (recall) — CONTRACT WRITTEN, NOT WIRED.**
[`apps/discord-worker/src/archive.ts`](../apps/discord-worker/src/archive.ts) is
committed and **inert**: nothing imports it, so it changes no behaviour. It
holds the retention constant, the shape, the recall detector, the lexical
ranker and the render block whose every line carries its date. Three decisions
in it are worth keeping and are argued in the file:

- ⚠️ **The document id sorts newest-first**, so `where(person)` + `orderBy
  __name__` needs **no composite index** — design §4.1 assumed one, and a
  composite index is an owner console step whose absence would 400 every recall
  while the feature looked built.
- **The implementation belongs in `memory-exec.ts`**, not a sixth exec module:
  same service account, same collection family, and the five-module credential
  guard stays exactly as wide as it is.
- ⚠️ **`GABI_MEMORY` is already ON**, and the design shares one posture across
  tiers 2–4. So the day tier 3 is wired, archive writes begin **on deploy** with
  no separate owner flip. That is the design's own choice and it needs saying
  out loud before it ships, not after.

Still to build: the exec half, the tool + its own allowlist array, the
pre-router lane, the health rows, the tests.

**🟡 The GABI switchboard — ITS DIAGNOSTIC HALF SHIPPED, the controls did not.**
The turn log the owner asked for as part of the switchboard is **live**: the
ring, the `/turnlog` route, and the devops HTTP gate
(`devopsHttpGate` — asked of `auth.heygabi.ai/api/estate/me` with the caller's
own bearer, so no second copy of "who is devops" exists). It shipped early
because it was the instrument the silence needed.

Not built: the dynamic config itself (per-surface postures, per-turn caps, daily
budgets), its GET/POST, the `/status` page, and the toml-as-boot-default
precedence. ⚠️ **The storage decision was argued and should not be re-opened
lightly:** the gateway Durable Object, not KV — it is strongly consistent (a
posture that takes 60s to propagate is a control that lies to whoever just
pressed it), it adds no binding and no infrastructure, and the read is free on
the path that matters because every turn already runs inside that object.
⚠️ **The one genuinely hard part is `mentions`:** the cron's poke is gated on the
toml value, so a dashboard flip cannot start a bot the boot default has switched
off without also changing that gate. Decide that deliberately.

## 📋 The /todo board — refreshed 2026-08-18, and why it is NOT generated

Owner: *"this todo board on heygabi seems way off, can we get an update on this
to match whats actually in our todo list, keep how pretty it looks tho."*

Refreshed **by hand** — 18 items, structure and voice untouched. Three items had
shipped and were still listed (the ebooks view, reading schedules, club polls);
the biggest live work was absent entirely (GABI reading books, the audiobook
player, the OCR queue, backups); one count was stale (twelve books with no cover
→ four).

⚠️ **A GENERATOR READING THE TODO.md FILES WAS CONSIDERED AND REJECTED, and the
reason is not effort.** It is a category error. `docs/TODO.md` in each repo is a
900–1,100-line ENGINEER'S work log: incident write-ups, ⚠️ markers, owner-eyeball
checklists, tables of measured facts. The board is a curated, plain-language
*"what's next"* for one reader, in complete sentences, with no jargon and no file
paths. Rendering the first into the second mechanically would produce a wall of
warnings and half-finished thoughts — which is precisely the *"keep how pretty it
looks"* the owner asked to preserve. **The translation IS the product.**

**What was made sustainable instead:** `apps/auth-worker/test/todo-board.test.ts`
now guards the board's STRUCTURE mechanically — every item carries exactly one
scope and a known project class, every filter chip has at least one item, and
the six radios stay direct siblings in order. No test can know whether "four
books" is still four, but these stop the class of edit that leaves a chip
rendering an empty board, which reads as *"nothing left to do on this project"*.

**When it drifts again:** edit `apps/auth-worker/src/todo-board.ts`, run the
auth-worker tests, `wrangler deploy` from `apps/auth-worker/`. No Pages deploy —
the public page is a content-free shim and does not change.

## 🖥️ /status — the 2026-08-18 wave, and what is left

Both asks from ~14:15 ("a health check for if the last upload to blob storage is
good" and "let me see logs by clicking into the health checks") are **BUILT and
deployed**, along with the storage panel, the worker event ring, notification
preferences and the todo-board refresh. The paperwork moved whole to
[`DONE.md`](DONE.md).

**What is genuinely left, named rather than implied:**

1. ⚠️ **The retrieval proof has never run.** The archive row's "Restore proven"
   line reads *"never — nothing has been read back out of the bucket and
   checked"*, which is TRUE and is the estate's largest unverified backup step.
   The field is plumbed end to end: write
   `audiobook_catalog/output_files/audio_archive_restore_test.json` as
   `{at, verdict, detail, file}` and the next storage push renders it.
2. **`discord-worker` is the last Worker not on the event ring** — and the
   blocker is no longer the secret. `ESTATE_EVENTS_TOKEN` is minted and set
   (2026-08-18, moved whole to [`DONE.md`](DONE.md) with `catalog-index` and
   `audiobook-worker`, both proven with real rows in the ring). ⚠️ That tree
   was checked TWICE and left alone both times — on 2026-08-18 it held another
   agent's live uncommitted work on exactly the GABI flows. It is a one-commit
   follow-up for whoever owns it next: the recipe is
   [`info/worker-event-ring.md`](info/worker-event-ring.md) §5 and the value is
   in `access/keys/estate-events-token.txt`.
3. **Nothing SENDS a notification yet.** The preferences and the contract for
   reading them are live; the conductor honouring them is the other half.
4. **The three cover buckets** are measured from the home machine like
   everything else. Binding them into a Worker is an owner decision and only
   matters if the panel should survive the PC being off.

> **Split 2026-08-16** per the global "Access & information docs" rule:
> `TODO.md` is **ACTIVE ONLY**, [`DONE.md`](DONE.md) is the dated archive
> (newest first, **append-only**), and durable reference belongs in
> [`info/`](info/README.md) / [`access/`](access/README.md), findable by topic.
>
> Twelve finished sections moved out — including two that had drifted into
> **contradicting each other**: the estate API testing suite appeared once as
> "✅ DONE" near the top and again as "queued next" at the bottom. Both are
> archived; the later one is marked as the superseded duplicate.
>
> ⚠️ Sections moved **whole — cut and paste, never summarised**, because the
> summary always drops the *why*.
>
> ⚠️ An archive is not a competing living doc. Do not re-merge it here.

## 🟢 BACKUPS ARE HARDENED — ONE CONSOLE CLICK LEFT (2026-08-18)

> ✅ **Owner step 2 — "get a copy of `estate-backups` off Cloudflare" — is
> DONE (2026-08-18) and moved whole to [`DONE.md`](DONE.md).** The mirror is
> built, wired into the pipeline as STEP 10, and populated: 11/11 stores,
> 12 objects, 539,573,402 bytes, on this PC + OneDrive + Google Drive
> `/GABI_backup`. Runbook: `access/RECOVERY.md` §2a.
>
> ✅ **AND THE THREE REMAINING OWNER STEPS WERE WORKED THE SAME DAY (second
> pass).** Two are **closed by measurement** and moved whole to
> [`DONE.md`](DONE.md); the third is stood up. **What is left is one console
> click** — see the single row below.
>
> ⚠️ **One of the two closures is a CORRECTION, not an achievement.** The
> Firebase-credential step was never a real gap: the key had been on this
> machine the whole time, and the runbook said otherwise because nobody had
> looked. `access/RECOVERY.md` §7a records that in full.

The restore drill (`8522b7c`) and the hardening that implemented seven of its
ten recommendations (`8c7f780`) are **finished and archived whole in
[`DONE.md`](DONE.md)**. Backups now run **daily at 09:12 UTC**, cover eleven
stores instead of eight, revive Firestore timestamps on restore, refuse to let
an `estate_auth` restore proceed blind, and are guarded by a test that fails if
the three store lists ever drift apart again.

Runbooks: **[`access/RECOVERY.md`](access/RECOVERY.md)** (3am: what to type) and
**[`access/backup-restore.md`](access/backup-restore.md)** (what is protected
and why). RECOVERY.md's header carries the per-recommendation status table.

**What is left is ONE owner step, and it is a console click.**

| # | Owner step | Why it matters | Where |
|---|---|---|---|
| 1 | **Download a service-account key for the new `estate-restore-drill` Firebase project** | The Firestore `--commit` write path is the last unexercised restore step in the estate. The rehearsal *target* now exists (project + Firestore database, created 2026-08-18 from the CLI); what is missing is a credential to point at it. This session's sandbox correctly declined to mint one — granting roles and minting keys are access-INCREASING acts. **2 minutes:** Firebase console → `estate-restore-drill` → Project settings → Service accounts → Generate new private key → save it under `audiobook_catalog/docs/access/keys/` (gitignored). Then the rehearsal is 3 commands, written out ready to paste | RECOVERY §4.3b |

⚠️ **Sign in as `mitchlandtv@gmail.com`** — the Firebase projects belong to that
account, while Cloudflare is `nbaslamking@gmail.com`. As the wrong user the
project simply looks missing.

**A second, optional decision — his call, NOT a blocker:** keep one **sealed
offline copy** of the `audiobook-catalog` Firebase key (password manager). Both
readable copies live on this one PC today, so a dead machine forces a re-mint
during an incident. Re-minting works and costs minutes; a sealed copy buys those
minutes back at the worst possible time. `access/RECOVERY.md` §7a.

**Not owner steps, but the first things to check later:**

- ⚠️ **The generation count should reach 8 by ~2026-08-26.** It sat at 2 because
  only two runs had ever used the R2-writing path — *not* a prune bug. If it is
  still stuck at 2 a week from now, then suspect the prune.
- ⚠️ **GitHub disables scheduled workflows after 60 days of repo inactivity**
  (it emails first). If backups quietly stop, check Actions for that banner
  **before** suspecting credentials.
- The three newly-covered stores (`library-catalog-2nd`, `ebooks-gated`,
  `estate-docs-gated`) have **never been through a restore drill**. Their paths
  are identical to their siblings' — an inference, not a measurement.
- ⚠️ **`audiobook-covers` is now stored as multiple parts** — it outgrew
  `wrangler r2 object put`'s 300 MiB cap at 313.5 MiB. A restore must
  `cat <STAMP>.tar.gz.part-* > dump.tar.gz` first, and **a dump missing any
  part cannot be untarred at all**. Verified only as far as "the parts are
  written and retention counts them as one generation" — **reassembling and
  untarring a split dump has NOT been exercised.** That is the first thing the
  next drill should do.
- ⚠️ **`game-covers` is 57% of the way to the same wall** (170.6 MiB of 300).
  It will cross it on its own; the split path is already generic, so nothing
  needs doing — but expect its objects to become parts without warning.
- ⚠️ **The mirror's first PRUNE has never run** (`access/RECOVERY.md` §2a). It
  holds one generation; the first deletion cannot happen until nine daily
  backups exist, ~2026-08-27. Check then that it deletes whole generations and
  that a split archive's parts go together.
- ⚠️ **A restore performed FROM the mirror has not been exercised.** The
  mirrored bytes are proven identical to the bucket's (three-way SHA-256 match
  on `estate_auth`, 12/12 MD5 on Drive), so it is the same operation on the
  same bytes — but that is an inference from a byte comparison. The next drill
  should restore from the local mirror rather than from R2, which also
  exercises the split-archive `cat` that is still unproven.

## 🟡 GABI READS THE ESTATE DOCS — LIVE; ONE OWNER STEP LEFT (the relink) (2026-08-18)

⚠️ **Step 2 (flip `GABI_DOCS`) is DONE — the owner flipped it on 2026-08-18.**
⚠️ **THREE live failures on the night of the flip, all fixed and deployed.**
Both incidents are written up in
[`info/gabi-docs-assistant-design.md`](info/gabi-docs-assistant-design.md):

| # | Symptom | Cause | Where |
|---|---|---|---|
| 1 | answered from the **book shelf** | offering the docs tools is not routing to them | **§12** |
| 2 | *"…couldn't put an answer together"* | tool loop truncated, returned null | §12 (2nd defect) |
| 3 | posted *"Let me read the promoting section:"* then **silence for ever** | the loop's exit guard treats any non-`tool_use` stop as the final answer | **§13** |

⚠️ **#2 and #3 share a root cause.** §12 raised the token ceiling, which moved
the failure rather than removing it — the exit guard was always the bug. Every
transcript is now a regression test.

**What is left is step 1 below — the relink — which was never done.** Until it
is, every docs question correctly answers *"your link was made before I could
check estate roles."*

All six phases shipped and are archived in [`DONE.md`](DONE.md); the as-built is
[`info/gabi-docs-assistant-design.md`](info/gabi-docs-assistant-design.md) §§10-11
and the runbook is [`access/estate-docs.md`](access/estate-docs.md) §§8-10. **Only
the two owner steps remain**, which is why this stub is here rather than nothing.

Owner ask, verbatim (2026-08-17): *"let's make sure GABI can read all of our docs
and stuff so she can even help me if needed for let's say I don't have a Claude
code session open."*

### 🧑 Step 1 — re-link, ONCE (about ten seconds)

In Discord: **`/link`**, then press the button on the page. ⚠️ Do this **first**.

Links written before 2026-08-18 carry no email and cannot be upgraded from
outside (owner decision: relink, no backfill). Until you re-link, a docs question
answers *"Your link was made before I could check estate roles. Re-run /link once
and I'll be able to answer this."* — which is the designed sentence, not a fault,
but it will be the first thing you see otherwise. `/unlink` first is not needed;
the ceremony overwrites.

### ✅ Step 2 — flip the posture — DONE 2026-08-18

`GABI_DOCS = "on"`, deployed, and <https://discord.heygabi.ai/api/health> reports
`gabi_docs_ready: true`. Turning her back off is the same one line to `"off"`
plus a deploy.

### Then test it — DM her

> **how do I promote the audiobook site?**

Expect: she searches, reads a section, and answers **citing the file path and the
snapshot's publish date**. Follow up with *"and how do I roll it back?"* — the
memory should carry it without you repeating yourself.

⚠️ **Watch the first few answers for the one thing that is genuinely unproven:**
whether she reaches the *right file*. Measured live 2026-08-18, `promote prod`
returns 124 matching sections and the **top hit is a `DONE.md` handoff entry, not
the promotion runbook** — the archives are in by your own decision (§9.3) and
search ranks headings over bodies, so archive noise can outrank the runbook. She
is instructed to search-then-read, which should recover it. If she keeps citing
archive entries instead of runbooks, that is the signal to revisit ranking (or to
drop `DONE.md` from the publisher's allowlist), and it is design §11.9's
first-listed open question.

### Turning her back off

The same one line to `"off"` and deploy. OFF is not silent — a docs question
still gets *"reading the estate docs from Discord is switched off"* rather than
falling through to a shelf search that finds nothing and reads as broken.

### ⚠️ What is deliberately NOT done

- **Nothing links to `/docs/`** (carried over from the phase-6 item). Not on the
  front door, not in `/status`'s Operations section where the runbook links live
  and where it probably belongs. Left unlinked rather than guessed at.
- **The scanner is still in SHADOW.** Flipping it to enforce still wants a week
  of clean output; today's evidence is a handful of clean passes, not a week.

## 📚 GABI READS THE HOUSEHOLD'S BOOKS — LIVE 2026-08-18; two pieces did NOT ship

The build is in [`DONE.md`](DONE.md); this is only what it deliberately left.
Reference: [`access/gabi-book-knowledge.md`](access/gabi-book-knowledge.md).

**1. ⚠️ OWNER DECISION — does the SITE PANEL get the book tools too?**
Not built, and not a forgotten half. `library_catalog`'s `@lc/core` tool array
is about that app's own D1 catalogue; the estate docs corpus set the precedent
by living on the Discord Worker alone; and design §9 scopes phase 4 to one
Worker. Building it would make `ESTATE_APP_TOKEN_BOOKS` a **three-holder**
secret where the design's custody note pins it at two — the "fresh trust edge,
fresh pair" rule, so it is a decision rather than an edit.
→ Ask the owner: *"should the site panel read book text too, or is Discord
enough for now?"* If yes, the shape needs settling first (third holder vs. a
browser-token door A path) — do not guess.

**2. Every knowledge-base listing row has an EMPTY `title`.**
Measured 2026-08-18 against the live route: `index_present: true`, and the rows
carry `source`, `chunks`, `chapters` and `ingester_version` — but no `title`.
`book_id` is a slug of the title so nothing is broken, and GABI reads fine; a UI
that renders `title` will render blanks. The fix is in the INGESTER's index
writer, not in the serving layer.

**3. ✅ CLOSED 2026-08-18 — channels are allowed, as-built stands.** Owner,
verbatim: *"gabi can book test in channels that fine"*. Moved whole to
[`DONE.md`](DONE.md); the posture is recorded as an OWNER DECISION in
[`info/gabi-book-knowledge-design.md`](info/gabi-book-knowledge-design.md) §11 decision 8
so nobody re-litigates it from the two hazards alone.

**4. ⚠️ One word in `apps/audiobook-worker/src/book-retrieval.ts` — NOT fixed.**
`looksLikeStatQuestion()` fires on "stat sheet" and not on "status sheet", the
word the transcripts actually use. Measured: the auto detector returns passages
that MENTION the words (`stat_keys: 0`) where the forced one returns the actual
blocks (`stat_keys: 12`). The Discord lane works around it by sending
`stat_block=true`; **every other caller of these routes still has the gap** —
the browser door, and anything built on them later. Outside the finisher's
fence, so it is recorded rather than done.

**5. Not measured: how the four tools behave in a real conversation.**
The routes were exercised directly (including the exact call the fixed routing
now makes) and the executor is unit-tested, but no end-to-end Discord turn has
been graded. ⚠️ The owner's FIRST live turn found a routing defect that no unit
test would have caught — design §10b — so the second live turn is worth
watching just as closely.

## 📕 GABI KNOWS YOUR SHELF — TBR / reviews / unread — DESIGN LANDED 2026-08-18

Owner: *"We need GABI to know the tbr, reviews, and unread about a user if
they're /linked."* Design:
[`info/gabi-personal-shelf-design.md`](info/gabi-personal-shelf-design.md).
**Nothing built yet** — four phases, models named in §7 (phase 3 is Opus-pinned:
it is the identity join and the privacy posture).

**Three measured findings the build must not lose:**
- ⚠️ **Reviews carry NO uid and NO email** — measured from `submitReview`, which
  writes `{bookId, displayName, rating, text, createdAt, updatedAt}`. The shared
  `isMyReview` predicate *prefers email*, so reading it alone would suggest a
  strong join exists; on this store that branch is permanently dead and every
  match falls to the display name.
- ⚠️ **`discord_links.displayName` is a SNAPSHOT taken at link time**, so the
  name GABI joins on can be stale even when the site looks fine. A person whose
  reviews "vanish" is told to re-run `/link`, which refreshes it — a real fix
  they can perform.
- ⚠️ **"Unread" does not exist as data on the audiobook side.** The honest proxy
  is *owned and not reviewed*, and the count must never masquerade as "books you
  have not read" — most people review a small fraction of what they read, so the
  proxy overcounts hugely and authoritatively.

✅ **BUILT 2026-08-18, and LIVE** — four tools, 25 tests. Operator doc:
[`access/gabi-shelf.md`](access/gabi-shelf.md). The owner step (flip
`GABI_SHELF = "on"`) is **DONE**.

⚠️ **AND ITS FIRST LIVE QUESTION MISROUTED — fixed the same day (`83a649c`).**
The owner typed one of `my_unread`'s OWN prescribed lines, *"what haven't I read
by Sanderson?"*, and was told *"nothing on the estate's public shelf matches
**not read by Sanderson**"*. ⚠️ **Not an identity failure** — an unlinked asker
would have seen the `/link` sentence and it never appeared. The shelf lane was
never entered: the intent classifier claimed the turn for `have_lookup`, which is
a pure public-index lookup that never calls a model, so the four tools sat on a
table the turn never walked into.

⚠️ **AND THEN A SECOND DEFECT ON THE SAME QUESTION AT 16:25, also fixed the same
day (`f538de8`).** Routing was FIXED — she engaged the question. The answer was
still wrong, in a new way: she said *"we've got 38 Sanderson audiobooks… have you
worked through The Stormlight Archive and Mistborn? What's the Cosmere stuff you
have tackled?"* — ⚠️ **she INTERVIEWED the asker for data her own tools already
held.** The evidence no tool ran is inside the sentence: "38 Sanderson
audiobooks" is a CATALOGUE count, there is no *"you have reviewed N"* fact, and
every question she asked is one `my_reviews` answers exactly.

| | The miss | The lesson |
|---|---|---|
| 15:40 | the lane was never entered | offering a tool is not routing to it |
| 16:25 | the lane was entered, the tool was never called | ⚠️ **ENTERING THE LANE IS NOT CALLING THE TOOL** |

⚠️ **The fix is NOT a sterner prompt** — *"you must call the tool"* is the same
category of hope as *"be honest"*. `my_unread` already computed the right answer;
only whether it RAN was wrong. So the arithmetic moved AHEAD of the model
(`src/shelf-flow.ts`), the move that makes the suggestion lane un-interviewable.
⚠️ Her wall-of-titles instinct was **half right** and that half is kept: the
delivery shape is a grouped summary with counts, leading with the series they
have STARTED and naming what they DID review — shorter than the wall and more
useful than the interview. One refining question is welcome AFTER a real answer,
never instead of one.

⚠️ **THE THIRD OF THIS CLASS IN ONE DAY** (docs §12, books §10b/§10c), and all
three teach the same sentence: **OFFERING A TOOL IS NOT ROUTING TO IT.** The fix
EXTENDS that structure rather than rivalling it — `shelfIntent` + `shelfFollowUp`
in the same shape as `docsIntent`/`booksIntent`, the same three posture states,
the same pre-router position. The rule is that **FIRST PERSON is the whole
signal**: "what haven't I read by Sanderson" and "what Sanderson do we have"
differ by one pronoun, and that pronoun is the difference between a reading list
and a catalogue row. ⚠️ The public-review shapes are a SECOND detector needing NO
identity, because the sites show reviews to anonymous visitors.

⚠️ **As-built deviation, deliberate:** it reads Firestore DIRECTLY rather than
through new gated routes, because both audiobook stores are collections this
Worker already reaches — no new app token, no new trust edge. The gate is that
every query is built from the asker's own uid/display name server-side.

**Still open:**
- ⚠️ **The LIBRARY's D1 TBR and read state are NOT readable** — another repo,
  needs a route. TBR rows carry `shelf` so the gap is visible, not silent.
- ⚠️ **Still not exercised against a live linked identity.** The lane is now
  REACHABLE (proven by test); whether a real linked person gets a real TBR back
  has still never happened.
- **Still to measure:** the real review count, how many legacy uid-less TBR rows
  remain, and how many display names have drifted from their link snapshot.

## 💡 GABI SUGGESTS A BOOK, FORMAT-AWARE — ✅ LIVE 2026-08-18

Owner: *"I also need Gabi to give book suggestions and clarify if I want audio
physical or ebook. For physical I only want her to suggest a physical book to a
linked person who can view a book from the table she's suggesting."*
Design: [`info/gabi-suggestions-design.md`](info/gabi-suggestions-design.md).
Operator doc: [`access/gabi-suggestions.md`](access/gabi-suggestions.md).
`GABI_SUGGEST` ships **on** — the owner ordered the outcome and the lane opens no
new corpus.

⚠️ **His one sentence contains a PERMISSION MODEL, and it differs per format:**
audio ungated (the public slice), ebook behind the estate's existing `vis_ebooks`
(**asked, never copied** — 403 relays the estate's own sentence, ⚠️ anything else
is an OUTAGE), physical behind *"can this person open that shelf"*.

⚠️ **THE MEASUREMENT THE PHYSICAL GATE RESTS ON.** `catalog.csv`'s
`library_work_id` is a **bare integer naming no instance**, and the index cannot
be widened per-asker from Discord — so the source shelf was resolved one level up
at the WRITER: `audiobook_catalog/app/library_link.py` fetches the join from
`<LIBRARY_MAPPING_URL>`, and `audiobook_catalog/.env` sets that to
`https://library.heygabi.ai`. A print row IS the main library's copy, so the gate
is the delegated `whoami`'s `known` on that instance. ⚠️ `known`, not
`capabilities`: a reader with no edit rights can still walk to the bookcase.

**Still open:**
- ⚠️ **NOT EXERCISED AGAINST A LIVE LINKED IDENTITY.** The gates are proven by
  injected-port tests only; no real `whoami` has produced the physical refusal.
- ⚠️ **`PHYSICAL_SOURCE_INSTANCE` depends on an env var in ANOTHER REPO** and
  nothing here can detect a change to it. If the join ever spans both instances,
  the gate must widen to "known on EVERY instance".
- ⚠️ **The print shelf is small — 64 of 1,079 rows carry a print format**
  (measured 2026-08-18; the older docs' "86" was stale). Her "nothing left"
  sentence calls that a gap in the JOIN, never a verdict on what the house owns.
- **Whether her picks are any GOOD is unmeasured.** The ladder is reasoned and
  unit-tested; nobody has judged a suggestion.

## 🎭 GABI'S PERSONALITY — VISIBILITY + DEVOPS SET/CLEAR — ✅ LIVE 2026-08-18

Two more owner orders on top of the personality build. Design:
[`info/gabi-personality-design.md`](info/gabi-personality-design.md) §§5a/5b/5c.
Operator doc: [`access/gabi-personality.md`](access/gabi-personality.md) §8.

- **(a)** anybody may ask what she is being **with them** and gets a plain
  factual in-voice answer (trope, pinned-or-drifting). Asking about somebody
  else's gets a worded not-yours refusal.
- **(b)** owner/devops get a **roster**: person → trope, pinned-or-auto **+ who
  wrote it**, last shift. Read live from Durable Object state that turn.
- **(c)** devops may **pin any of the eleven on anybody** or return them to
  drift. Semantics identical to a self-pin, last-write-wins, writer recorded,
  ⚠️ **no notification to the target**.

⚠️ **THIS DOES NOT UNDO THE PIN'S SECRECY.** The owner forbade advertising the
COMMAND; she states the FACT and never the mechanism, and a test asserts no
reachable string names the pin words. Answering a straight question with a dodge
would read as a malfunction — which is worse than the fact.

⚠️ **THE DEVOPS CHECK IS ASKED, NEVER COPIED.** It rides the docs port and reads
its status: 200 = devops, 403 = not, **anything else = UNKNOWN, worded as an
outage**. A second local holder of "who is devops" would be a second thing to
forget to revoke. ⚠️ **The cost, stated rather than discovered:** with
`GABI_DOCS` off both features answer *"I can't check who's allowed"* — a SETUP
sentence, never a permissions one.

**Still open:**
- ⚠️ **No real devops has run either verb.** Both gates are proven by
  injected-port tests; the 403 branch has never been produced by the live auth
  Worker on this path.
- **A bare NAME is refused rather than resolved** (only a mention targets
  somebody). If that proves annoying in practice, the fix is a resolver with an
  explicit disambiguation question — never a guess.

## 🎭 GABI'S PERSONALITY + PERSON-KEYED MEMORY — ✅ LIVE 2026-08-18

Two owner orders, built and deployed together. Designs:
[`info/gabi-personality-design.md`](info/gabi-personality-design.md),
[`info/gabi-memory-design.md`](info/gabi-memory-design.md) §11. Operator doc:
[`access/gabi-personality.md`](access/gabi-personality.md).

Eleven owner-locked tropes, drift along an approved wing graph, a hidden pin, and
one conversation thread per PERSON rather than per channel. `GABI_PERSONALITY`
ships **on**.

**Left open, and worth returning to:**
- ⚠️ **How the tropes actually READ is unmeasured** — no conversation has been
  held under any of them. Read `flirty` first (its failure mode is a safety
  question, not a quality one), then `tsundere` and `shy`.
- ⚠️ **The invariance tests prove a trope CANNOT edit a refusal and that the
  instruction is present. They do not prove a model never paraphrases one.**
  That gap is real; watch it in the first week.
- **Drift numbers (4 exchanges, 25%) are reasoned, not tuned.** Nobody has
  counted steps in a real conversation.
- **Register affinity is not built.** "PG-13 at discretion" is decided per turn
  from the conversation; recording the register she has learned for somebody as a
  tier-2 profile note is the natural next step, and the selector's `weights` hook
  is where it lands.
- ⚠️ **The private-context-in-public-channel guard is PROMPT-LEVEL, not
  enforced** (access doc §6). Enforcing it needs per-turn surface provenance — a
  shared-package shape change. Revisit if the server stops being family-only.

## 🧠 GABI'S MEMORY — three tiers — DESIGN LANDED 2026-08-18, BUILD NEXT

Owner ask: *"so its not a fresh bot to talk to each time… but we also dont want
to blow scope."* Design: [`info/gabi-memory-design.md`](info/gabi-memory-design.md).
Shape approved; the doc argues the details.

Tier 1 (30-min verbatim window) is **unchanged**. Tier 2 is a ~2 KB per-person
profile distilled at expiry and injected every turn. Tier 3 is a 90-day archive
plus a recall tool that costs nothing per turn.

**Build order (each dark behind `GABI_MEMORY`, affirmative-only):**
1. ✅ **DONE + DEPLOYED DARK 2026-08-18.** Profile store, distillation on the
   existing two-minute cron, the prompt block, and `/gabi memory` show/clear.
   Access reference: [`access/gabi-memory.md`](access/gabi-memory.md).
   ⚠️ **OWNER STEP: flip `GABI_MEMORY = "on"` in
   `apps/discord-worker/wrangler.toml` and deploy** — deliberately not done by
   an agent (the `GABI_BOOKS` precedent).
2. archive writes ⚠️ before the tool, so recall has something to find on day one
3. `recall_conversation` + its own (fifth) allowlist array and pinning test
4. identity merge on first `/link` — riskiest, deliberately last

**Left open by phase 1, to settle after a week of real profiles:**
- ⚠️ **Distillation quality is unmeasured** — no profile has been produced by a
  real conversation. Grade it by reading actual profiles before trusting the
  2 KB cap.
- The per-turn profile READ is one Firestore GET; it is issued in parallel with
  the docs and books contexts so it adds no latency, but if turn latency ever
  regresses, caching the profile in the DO's conversation record is the known
  next move (it is already loaded there every turn).

**Two things in the design worth not losing:**
- ⚠️ There is **no expiry event today** — pruning is lazy. The cron is the
  trigger; distilling lazily at the next conversation's first turn is the
  tempting option and it is wrong (stale exactly when the feature is for).
- ⚠️ **The profile must never feed the spoiler bound.** It would be precisely the
  stored ceiling that book design §4.3 forbids. Reading state in a profile is a
  soft claim with provenance, superseded by a real position store, never fighting
  it.

**Owner steps:** flip `GABI_MEMORY=on` when phase 1 is verified; create the
Firestore TTL policy on `gabi_conversations.expiresAt` (or choose the cron
fallback); confirm 90 days after a week of measured size.

## 🔑 ESTATE SSO — BUILT + DEPLOYED, INERT PENDING ONE OWNER CONSOLE STEP (2026-08-18)

Owner ask, verbatim, after hitting it himself: *"Ebooks makes me login every
time why is it not inheriting login from main page?"* — approved 2026-08-18
("3 yes"). Design of record: [`info/sso-design.md`](info/sso-design.md); the
as-built account is **§8c** there.

**Phases 1–3 are built and deployed. The whole thing does nothing yet**, on
purpose: `TOKEN_SIGNER_KEY` is unset (measured 2026-08-18, `wrangler secret
list`), so the mint route 503s and every surface behaves exactly as before.

### 🔴 The one owner step that switches it on

Create the zero-IAM-role `estate-token-minter` service account and
`wrangler secret put TOKEN_SIGNER_KEY` — [`access/estate-auth.md`](access/estate-auth.md)
§6 step 3, which now carries the full context. **No redeploy follows it.**
⚠️ That section also carries the **BOM warning**: a PowerShell-piped secret
picks up an invisible UTF-8 BOM, and a BOM'd signing key fails *while looking
valid*, estate-wide, with nothing pointing back at the cause.

### Adopted this pass

`heygabi.ai` + `www` · `library.heygabi.ai` · `padhard.heygabi.ai` ·
`boardgames.heygabi.ai` — all deployed and verified serving the code.

### ⛔ Still queued

- **`audiobook_catalog/site/identity.js`** — covers `audiobooks.heygabi.ai`
  **and `ebooks.heygabi.ai`, the site the owner actually complained about.**
  Deliberately skipped: a concurrent agent held that tree for a P1 iOS reader
  bug. Step-by-step recipe in `sso-design.md` §8c.5, including Q5's
  legacy-mirror guard. ⚠️ Audiobook two-lane rule applies — pushing `main`
  publishes `/dev/` only; it reaches both live hostnames on the next
  **promote**.
- **Phase 4 (optional polish)** — sessions list + per-device revoke on the
  apex `/admin` page. Never built ⇒ sign-out stays "this origin + the
  cookie", which is livable indefinitely.

### Owner test, once the secret is set

Sign in on `heygabi.ai`, then open `library.heygabi.ai` in a new tab —
expect to arrive **already signed in**, no tap. ⚠️ Not testable by any agent:
it needs a real signed-in browser.

## 🎧 AUDIOBOOK PLAYER — PHASES 0a/0b/1 SHIPPED; **PHASE 2 (the player) IS NEXT**

Design of record, all six owner decisions settled:
[`info/audio-player-design.md`](info/audio-player-design.md) — §12 for the
decisions, **§10.1 for phase 1 as built**. Requirements verbatim: position
remembering · speed to 3x · PWA · 15s back/forth · next/prev chapter · chapter
select + view · sleep timer · **scrub bar per chapter not per book**.

**Landed 2026-08-18 — the plumbing, and nothing that plays.**

| Phase | What | Where |
|---|---|---|
| 0a | exact-seconds chapters (`start_sec`) | `audiobook_catalog/app/tools/extract_chapters.py` |
| 0b | `estate-audio` bucket, boto3 multipart ingest, the `audio_requests` queue + rules, fulfiller as pipeline STEP 5.9 | `audiobook_catalog/scripts/upload_audio_r2.py`, `app/tools/fulfill_audio_requests.py` |
| 1 | `GET\|HEAD /api/audio/:anchor/file` + `GET /api/audio/status`, the re-sized listening budget, the manifest publish path, and the site's **request** button | `catalog-platform/apps/audiobook-worker/src/audio-*.ts`, `listen-budget.ts`; `audiobook_catalog/scripts/publish_audio_manifest.py`, `site/audio-request.js` |

🔗 **Try it:** <https://audiobooks.heygabi.ai/dev/> — open any book; under the
metadata there is now *"🎧 Not streamable yet — request it"*.
⚠️ **`/dev/` only.** The site half is on `main`, so it **rides the next
promote** to reach the site root and `ebooks.heygabi.ai`.

### 🧑 OWNER — the one thing nothing automated can stand in for

**Request a real book, then let a pipeline run fulfil it.** Nothing has ever
been streamed: the bucket is empty by design, so the 206 path has never met a
real 601 MB m4b. Suggested first book: **Skyward (Brandon Sanderson)** —
mid-sized, an unambiguous title, and the one every doc and test fixture already
names, so a failure is easy to trace. Press request, wait for the next 8-hourly
run, then `python -m app.tools.fulfill_audio_requests --status`.

### ⏳ Phase 2 — the player, and the two things it MUST carry

1. **The auth seam** (design §3): `<audio src>` cannot carry a bearer, so a
   service worker injects it. ⚠️ Its failure mode is a **silently dead play
   button**, and §3.2 item 5's page-level `HEAD` probe is the mandatory
   mitigation — the byte route already answers HEAD for exactly this reason.
2. **Eviction's access timestamps** (§10.1): `last_stream_at` is still null for
   every object, so `evict_candidates()` correctly refuses to delete anything.
   The shape to build is written out in §10.1 — a throttled
   `audio_streams/{anchor}` stamp through the service account, ⚠️ **plus a new
   `firestore.rules` clause and its own live smoke**.

Also then: re-derive the listening budget from a REAL session (§10.1's numbers
are arithmetic over measured inputs, not a measurement), and decide whether the
audio routes re-word the shared gate's ebook-shaped 401.

## 🗃️ GABI CATALOG Q&A — TIER 0 SHIPPED 2026-08-18; two pieces did NOT

Tier 0 (`catalog_lookup`, `series_volumes`) is live — the original item moved
whole to [`DONE.md`](DONE.md). What remains is here because it was measured as
out of reach, not because nobody got to it.

**1. `person_context` — the asker's own TBR and reading positions. NOT BUILT.**
Measured 2026-08-18 rather than attempted:

- **TBR is keyed on a DISPLAY NAME, not a uid.** `readingLists/{displayNameLower}_{bookId}`
  (audiobook_catalog `site/reviews.js`, whose own comment says the order is the
  REVERSE of a review's and may not be harmonised because the ids already exist
  in production). Two members sharing a display name would read each other's
  list. That is an identity-safety question, not a plumbing one, and it wants
  the owner's call before anything reads it.
- **Reading positions ARE properly keyed** — `readingPositions/{uid}_{bookId}`,
  and `discord_links/{discordUserId}` carries `firebaseUid`, so the join is
  sound. What it needs is a Firestore `:runQuery` with a `__name__` prefix
  range plus a typed-value decoder; this Worker has only ever done single-doc
  GETs.
- ⚠️ **It would also put `firestoreRequest` / `mintAccessToken` into the mention
  path**, which was 100% credential-free — a property `test/mentions.test.ts`
  asserted against `mention-flow.ts`'s source. Shipping it means deciding to
  give up that property on purpose.
  ⚠️ **UPDATE 2026-08-18: that decision has been made, for a different feature.**
  The owner approved T1 (see the write-verb ladder section below) and the write
  path shipped, so the property is gone — but note what replaced it, because it
  is the shape `person_context` must now fit into rather than a licence to add
  credentials anywhere: **credentials live in `delegated-exec.ts` and nowhere
  else**, reached only through an injected port, pinned by a source-reading
  test over eight files. A `person_context` tool would still be a MODEL-chosen
  read, which is a different and stricter category — the Tier-0 tool surface is
  still credential-free by construction and `toolsForApi()` is asserted to
  contain nothing else. The TBR display-name identity question below is
  untouched by any of this and remains the real blocker.

**2. Cross-catalog counting. STRUCTURALLY UNREACHABLE from Discord.**
The owner asked the live bot *"how many books do we have in all the libraries
from Brandon Sanderson and his related authors, include universes like Wheel of
Time, Cosmere and Reckoners"*. Measured against the live index, anonymously:

| endpoint | result |
|---|---|
| `GET /api/search?source=audiobook` | **200** — the public audiobook slice |
| `GET /api/universes` | **401 `{"error":"unauthenticated"}`** |
| `GET /api/universe/:name` | **401** |
| `GET /api/series` | **401** |

Only `/api/search` sits above the index's `requireEstateMember()` blanket, and
`searchScope()` resolves an anonymous caller to `{audiobook}`. Widening needs a
Firebase ID token Discord cannot produce. Tier 0 therefore counts the audiobook
shelf exactly and **says so on every result** (`COVERAGE_NOTE`), rather than
implying an estate-wide total. Closing this needs one of: an estate app-token
pair for the index (`ESTATE_APP_TOKEN_DISCORD`) with a server-to-server
widening path that does not exist yet, or public read-only universe/series
counts on the index — an owner decision about what the anonymous internet may
count, not a build task.

**Also measured, and worth knowing before anyone "fixes" it:** the estate's
shared universe list holds **16 universes and Wheel of Time is not one of
them**, and the audiobook shelf holds **zero** Robert Jordan rows. So the right
answer to that part of the owner's question is "that isn't a universe we
record", which Tier 0 now says explicitly (it returns the real 16 rather than a
bare 0).

## 🔑 GABI WRITE-VERB PERMISSION LADDER — ✅ APPROVED BY OWNER 2026-08-17 ("that looks good, start with that")

Asked: *"what api permissions should she have? Can I dm her an isbn or a
photo and she adds it to the catalog? What if I need her to do some club
resets like change the admin to a book club?"* Proposed ladder (GABI holds
NOTHING herself — she borrows the linked asker's role, verified by the
destination site): T0 lookups (live) · T1 additive-with-undo auto-apply
(add-by-ISBN/photo, blank fills) · T2 mutations propose→confirm-button ·
T3 people/club changes restate→confirm, asker must hold the capability ·
T4 never-from-Discord (estate grants, deploys, money, moderation-config).

### ✅ T1 SHIPPED + DEPLOYED 2026-08-18 (owner: *"all of it"*)

⚠️ The item stays HERE rather than moving to `DONE.md` because it is not
finished: T1 is one rung of a five-rung ladder, and an item moves once, whole,
at completion. What landed, and what did not:

- **`add-isbn` and `run-details` are LIVE** on both library instances, driven by
  a DM or an @mention. As-built account: [`info/gabi-application-map.md`
  §2a–2d](info/gabi-application-map.md); owner's live test script (the exact
  DMs to send): [`access/discord-bot.md` §13.4](access/discord-bot.md).
  Commits `67ec937` (bot) and library `5b4b860`; Workers `e508302f` /
  `7fdbe01b` / `5886875e`.
- **The delegation seam as built**: `ESTATE_APP_TOKEN_DISCORD` (one value,
  THREE holders, same name) proves only *"this is the estate's Discord
  Worker"*; the **destination catalog** resolves the on-behalf-of Firebase uid
  to its own `app_user` row and checks that person's `editCatalog` /
  `runResearch`. Pairing **verified live** on both instances 2026-08-18.
- ⚠️ **The credential-free mention path ended here, deliberately** — see the
  Tier-0 section above, which recorded that shipping a write *"means deciding
  to give up that property on purpose"*. The owner's approval is that decision;
  `test/mentions.test.ts`'s assertion was **repointed**, not removed, at the
  narrower property (credentials only in `delegated-exec.ts`) and given teeth
  by a second source-reading test.
- 📷 **Photo intake: MEASURED AND DEFERRED**, not half-built — application map
  §2d has the numbers and the recommended proposal-only shape. Short version: a
  cover photo yields a title+author string, and this estate has twice measured
  a title+author match scoring **1.0 on the wrong book**. *"Additive with easy
  undo"* does not cover a wrong book added under a name that already matched.
- ⛔ **Still open: T2/T3 confirm verbs — ✅ DESIGNED 2026-08-18, not built.**
  Full grammar: [`info/gabi-confirm-lanes-design.md`](info/gabi-confirm-lanes-design.md).
  The instance-choice select menu is the right machinery, but ⚠️ **"one option
  and a restatement" understates it**: the hard part is the restatement still
  being TRUE when somebody presses, which needs **compare-and-set on the
  `before` values** and a worded 409 — the `firestore.rules` `hasAll` incident
  generalised. Also decided: the proposal lives in the existing `pending.*`
  slot (**zero new Durable Object writes**), the capability is checked at
  **both** propose and press, ⚠️ **club deletion is T4 not T3**, and ⚠️ **T2
  cannot touch the audiobook surface until it has an audit seam** (it has no
  `change_log`). Phase 1 is **one verb** (`fix-field`), ~200 k. **5 owner
  questions** in §11 — the first is `changed_how` `'human'` vs `'auto'`, which
  no later migration can recover.
- 💤 **Someday: bare `heygabi` triggers** —
  [`info/gabi-bare-text-triggers-memo.md`](info/gabi-bare-text-triggers-memo.md).
  ⚠️ **The estate's docs carry a superseded fact**: the privileged-intent gate is
  no longer *100 servers* but **10,000 unique users** (Discord, June 2026) — so
  there is **no gate**, just a portal toggle, reversible in a minute. ⚠️ The
  intent **cannot be scoped to channels** (verified against Discord's docs);
  only the handler can drop messages, and the memo pins what "unlogged" can
  honestly promise. **Recommendation: not yet** (DMs already give a zero-`@`
  surface; deferring costs nothing) — **owner's decision, with flip conditions
  written down.**
- 🧑 **OWNER EYEBALL — nothing here is verified by a real Discord message yet.**
  No `change_log` row wearing `gabi-discord` exists in production, and the
  async sweep report has never been posted by a live gateway. `access/discord-bot.md`
  §13.4 is the three-message test; §13.6 is the full not-verified list.

## 🚪 DEV ACCESS in the estate (owner, 2026-08-17) — IN FLIGHT

Owner's words: *"i need a way in the estate to manage dev access for ebook,
add a button for give dev access also make devops always able to see dev
envs. in the meantime grant Samantha dev permission."*

- Meantime grant DONE 2026-08-17: Samantha holds the estate **devops** flag
  (granted via /admin two-tap, badge verified on the rendered page 22:13:28).
- ~~This repo's half~~ **SHIPPED 2026-08-17** — commit `be6f15c`, migration
  `0011_dev_access.sql` applied `--remote` (12 rows, 0 hand grants, 4 devops
  who hold it by the OR), Worker version `265c6131-b0c1-4960-9385-e780025a06f2`.
  Grammar recorded in [`access/estate-auth.md` §10](access/estate-auth.md).
  ⚠️ It stays HERE rather than moving to `DONE.md` because the item is not
  finished: the audiobook half below is the other half of the same ask, and an
  item moves once, whole, at completion.
- **STILL OPEN — audiobook_catalog's half** (the dev ebook pages' worded
  curtain), queued in THAT repo's local TODO behind the save-spot build.
  Nothing there consumes `dev_access` yet, so the flag's end use is
  unexercised. ⚠️ Curtain, not lock: the `vis_ebooks`-gated manifest/stream
  APIs stay the real lock on both lanes.
- 🧑 **OWNER EYEBALL** — <https://heygabi.ai/admin/>, signed in: open any
  member's card and look at the button row. A plain member gets a two-tap
  **Give dev access** button (and a `DEV ACCESS` badge beside their status
  once granted); a devops or approver gets the WORDS *"dev access · via
  devops"* where that button would be, because they already hold it and a
  button there could not change the answer.

## 🧑 OWNER EYEBALL: the reshaped /admin page, signed in (2026-08-17)

The control-grammar reshape + full permission map shipped (see
[`DONE.md`](DONE.md), newest entry; grammar recorded in
[`access/estate-auth.md`](access/estate-auth.md) §9). **Everything a predeploy
marker can assert is chrome** — the member table is injected only after
Firebase sign-in, so the part that matters is unverified until someone signs in.

🔗 <https://heygabi.ai/admin/> — three things to look at:

1. **Open a member.** One row per site, the same four columns on every row
   (site · visible · role · what that role can do), and a role dropdown on
   *every* site — not just Audiobooks/Ebooks.
2. **Change something.** Nothing should write; the control outlines and a
   **Save permissions** button *appears* on that card with a count. Save →
   one worded sentence naming exactly what changed.
3. **"Permission map — every site's ladder"** at the top: four subsections,
   one per site, in the same order as the grid.

Report anything that still feels like a different experience per site — that
is precisely what this was for.

## 🧑 OWNER EYEBALL: read a PDF in the browser, signed in (2026-08-17)

**Viewer phases 1a + 1b shipped** — the gated byte stream
(`audiobook-worker` `41206de4`) and the PDF reader (`audiobook_catalog`
`af57fbb`, on the **dev lane**). As-built record with every measurement:
[`info/ebook-viewer-phase1.md`](info/ebook-viewer-phase1.md).

⚠️ **Everything an agent could verify is the UNAUTHENTICATED half.** No agent
holds a Firebase ID token, so the live checks are 401s, their headers and CORS
preflights. The renders were measured against **local files over a local
server** — the full path (token → gate → R2 → range → canvas) is assembled and
has never once been exercised end to end.

🔗 <https://audiobooks.heygabi.ai/dev/ebooks> — tick **"Show PDFs"**, tap any
PDF, press **Read**. Four things to look at:

1. **Does a page appear at all?** That is the whole question. If it does, the
   bearer-per-range design works end to end and phase 2 inherits a proven pipe.
2. **Try the 181 MiB Stormlight handbook** (`SL001_Stormlight_Handbook_digital.pdf`).
   It should open to page 1 in a couple of seconds having transferred ~2.5 MB,
   not 181 MB — devtools Network, sum the sizes. This is the one that would
   have been 183 MB before the `disableStream` fix.
3. **Turn some pages, zoom, resize.** One canvas is live at a time by
   construction; a page turn is a few range requests.
4. **Open an EPUB card.** There should be NO Read button, and a one-line note
   saying browser EPUB reading is not on yet. If a Read button appears there,
   that is a bug.

⚠️ **This is the DEV lane. `ebooks.heygabi.ai/read` does not exist until a
promote** — `ebooks-door` proxies to the PROD origin, deliberately. What rides
the next promote: the reader page, `site/reader.js`, the vendored pdf.js, the
`/read` CSP block, and the shelf's Read button.

## 🔴 Audiobook Phase 3 (enforce) — ⚠️ SUPERSEDED 2026-08-17: owner chose FORCE-THEN-FIX

**Owner decision (2026-08-17, after full explanation of both paths):** *"Yes
let's do it. We don't have that many users just my friends so we can do our
best to fit roles right away and then promote people as needed. As long as
club mod and owners stays we're in good shape."* The week-long soak ceremony
is dead; the flip happens the moment the soak-recorder build lands, so day
one of enforce is fully recorded and the retained log becomes the live
who-needs-a-role-bump list. ⚠️ THE FLIP'S ACCEPTANCE CRITERIA, from his
words: **owners keep max everywhere (OWNER_EMAILS + auto-max), site
moderators keep their standing, and club managers keep their club powers**
(the island logic shipped 2026-08-17). Pre-flip check enumerates those three
classes; post-flip verification exercises what it can and names what needs
the owner's eyes. Reverting is one var back to "shadow" — the fail-safe that
made force-then-fix acceptable. Executor: the CONDUCTOR flips
(trust-critical), never an agent.

(The original blocked-on-evidence section follows for the record; blockers
1-3 are closed by 2026-08-17 builds, and blocker 4's "exercise the surfaces"
now happens live under enforce.)

**Evidence pack:
[`info/audiobook-auth-soak-2026-08-16.md`](info/audiobook-auth-soak-2026-08-16.md)
(2026-08-16 23:21 MST). Verdict at the time: NOT ENOUGH EVIDENCE.

Measured: prod-lane reporter live **1h 52m** (the server's 4h 17m is *not* the
soak — until the prod promote at ~21:29 MST, prod visitors reported nothing).
A 5-minute tail caught **3 worker requests, all of them the probes themselves**
— **zero organic gate decisions**. Household false denials: **0 of 0**, i.e.
⚠️ **unmeasured, not clean.** Per the design's own rule, a surface nobody
exercised has not soaked.

Blockers to clear before the re-run is worth taking (all out of scope for the
read-only pack — none were done):

⚠️ **THE SOAK RECORDER LANDED 2026-08-17 — blockers 1, 2 and 3 are CLOSED.**
Worker version **`8cdf7c88-50c5-4895-b13d-3cb2f7d35198`**; `ESTATE_CHECK` was
**not touched** and remains `"shadow"` (this build records, it never
enforces — the flip stays the conductor's, per the decision above). The
re-run command, the retained lines, and two gotchas that would otherwise cost
an hour are in
[`info/audiobook-auth-soak-rerun-2026-08-17.md`](info/audiobook-auth-soak-rerun-2026-08-17.md).

1. ✅ **CLOSED 2026-08-17 — shadow decisions now PERSIST.** `[observability]
   enabled = true` shipped; the LIVE Worker's settings read back
   `logs {enabled:true, persist:true, head_sampling_rate:1}`, and three
   synthetic reports were **queried back out of Workers Logs ~5 minutes after
   emission** — retrospectively, from a window that had already closed. That
   is the capability day-one-of-enforce depends on, and it is measured, not
   assumed.
   ⚠️ Its precondition was met FIRST, as this item demanded: the cleartext
   `email` is **gone** from both gate lines (`ab_gate_shadow` and the enforce
   twin `ab_gate`), replaced by `email_hash` (salted SHA-256, one-way) +
   `identity_class` (owner/household/outside/anonymous) — so the retained
   who-needs-a-role-bump list keeps its counts, its per-person grouping and
   its owner-vs-household split while holding no addresses. A test asserts no
   `@` reaches a line at all.
   ⚠️ **Two gotchas:** the observability query API **refuses wrangler's OAuth
   token** (and wrangler 4.123 ships no observability subcommand — use the
   dashboard's own API with its session cookie), and Workers Logs **drops
   null-valued keys**, so *absent means null*. **Nothing for the owner to
   click** — enablement is entirely in `wrangler deploy`.
   ⚠️ Unfixable and unchanged: the ~4h that soaked before 2026-08-16 23:16 is
   permanently gone. Retention starts now.
2. ✅ **CLOSED 2026-08-17 — a would-deny can now be told from a real break.**
   The site payload carries `succeeded`, threaded through all 24
   `reportGate()` call sites (a local flag set on the one success path, so an
   early `{success:false}` from *inside* a try reports honestly as a failure),
   and the receiver parses and logs it strictly: `true`, `false`, or `null`
   for "cannot say" — never coerced. Under force-then-fix this is the field
   that matters most: after the flip, **`denied:true` + `succeeded:true` on
   the shadow record is the person to promote**, while a denial on something
   `firestore.rules` already refused is nobody's problem. Pinned by the same
   literal in BOTH repos' tests, because the halves deploy independently.
   ⚠️ **The site half rides the next owner-worded promote to prod.** `main` →
   `/dev/` has it; until a promote, prod reports carry no outcome and log
   `succeeded` absent (= "cannot say"). ⚠️ **If the flip happens before that
   promote, day one of enforce is recorded WITHOUT the outcome bit on prod** —
   worth sequencing deliberately rather than discovering afterwards.
3. ✅ **CLOSED 2026-08-17 — 25 of 25 gated actions now report.**
   `updateReadLabel()` reports `read.setSlot`; the vocabulary gap is gone.
   ⚠️ **What that made visible, and did NOT decide — read this before the
   flip:** `read.setSlot` carries a `manageClub` (admin) floor while the label
   is **member-editable by design** (the migration design's own §1 table, and
   `firestore.rules` deliberately keeps `slotLabel` out of
   `MANAGED_READ_FIELDS`: "commentCount bumps and slot labels stay open"). So
   an ordinary member renaming a read card is a **predicted real break** at
   enforce — it will log `would_deny:true` with `succeeded:true`. 🧑 **Owner
   decision:** lower the floor for this action, or route the label away from
   `read.setSlot`. Under force-then-fix this is one of the few breaks that can
   be named IN ADVANCE rather than discovered from the log, so it is cheap to
   settle first. Do not "fix" it by removing the report.
   The content-warning half was already closed earlier that day: ✅ **CLOSED
   2026-08-17** (owner-approved): the action was SPLIT into
   `warning.selfDelete` (`{kind:'signedIn'}`, member floor) and
   `warning.modDelete` (`operateClub`, unchanged), `site/user-warnings.js`
   now imports `gate-shadow.js` and reports the right one per case, and
   `firestore.rules` was tightened from `allow delete: if true` to
   author-or-moderator on `user_content_warnings{,_dev}` (author bound by a
   new `authorUid` field; rules deployed and smoke-tested). So the owner
   decision this item asked for is answered — a member self-delete is a
   member floor and will not be denied at enforce.
   ✅ The worker deploy this item was waiting on **landed 2026-08-17**
   (version `d5752cca-5435-4f63-a06f-788b39f53fca`); `warning.selfDelete` was
   confirmed on the live tail to resolve rather than log `unknown_action`.
   ⚠️ Still unmeasured: neither warning action has an ORGANIC report yet.
4. 🟢 **Exercise the surfaces deliberately** — ⚠️ **the reason they COULD NOT
   be exercised is fixed 2026-08-17** (owner-approved CLUB MANAGER package;
   catalog-platform `fe30cb0`, audiobook_catalog `84009e7`). The blocker was
   not shyness about testing: `club.setWebhook` / `club.clearWebhook` /
   `club.claimManager` were all `administerClub`, admin-floor, club island
   **off**, and `club.claimManager` was **self-blocking** — it is how one
   *becomes* a manager, so no non-admin could reach the island at all.
   Now: `administerClub` is island-held at a moderator floor, and
   `claimManager` is its own rule (unclaimed → any live session, claimed →
   moderator+ override). `firestore.rules` enforces the same shapes live —
   **18/18 REST smoke assertions** against the deployed rules, re-runnable
   via `audiobook_catalog/scripts/smoke_club_manager_rules.py`.
   **Still to measure (this is what remains of the item):** a real household
   club manager doing these in a browser. Nothing organic has been logged
   yet; the worker vocabulary is deployed and verified live (version
   `d5752cca-5435-4f63-a06f-788b39f53fca` — `club.claimManager` and
   `warning.selfDelete` both resolve, a control action still reads
   `unknown_action`, and the log line now carries `club_claimed`), and the
   site half rides the next owner-worded promote to prod.

5. 🧑 **OWNER QUESTION — HALF ANSWERED 2026-08-17 by the MANAGECLUB SPLIT
   (option B); the rest is still open.** The question was whether
   `manageClub` should follow `administerClub` down to a moderator floor,
   because a site moderator could not touch a claimed club while a rankless
   member who claimed it could.
   ✅ **Decided and shipped:** the READ LIFECYCLE — `read.finish`,
   `read.remove`, `read.revealRatings` — moved to `operateClub` (island on),
   i.e. manager-of-that-club **or** site moderator+. `firestore.rules`
   enforces it live (36/36 smoke), the worker's dormant arms match, and the
   UI now renders those controls for club managers and moderators. Written up
   whole in [`DONE.md`](DONE.md).
   ⚠️ **Still open, and NARROWER than before:** `features`, `joinMode` and
   `deleteClub` keep the `admin` floor, so the inversion survives for those
   three — a rankless club manager may toggle their club's features; a site
   moderator may not. The owner's line was "running the reading" vs
   "destroying the thing", which settles `deleteClub` (it stays) but does
   **not** obviously settle `features`/`joinMode` — those are neither
   destructive nor part of running the reading. That is the actual remaining
   question. Lowering a floor is access-INCREASING, so it stays confirmed,
   not assumed: one line in `capabilities.ts` plus `canManageClub` in
   `firestore.rules` if the answer is yes.

Owner action available now: `wrangler d1 execute estate_auth --remote` was
**blocked by the permission classifier**, so the estate membership census
(how many approved members, what visibility) is unverified.

## 0. 🤖 GABI Discord bot — LIVE 2026-08-16; the build queue that follows

State: registered (**GABI**, id `1538775435880562758`), worker deployed at
`discord.heygabi.ai` (health all-green), **invited to the owner's server with
the moderator permission bundle** (`1116825807878` — deliberately NOT
Administrator; blast-radius reasoning in `access/discord-bot.md` and the
2026-08-16 conversation; widening later is a role toggle, never a re-invite).
Interactions Endpoint URL save: owner's click, unconfirmed until interactions
arrive.

⚠️ **Phase 2 (the identity-link ceremony) LANDED 2026-08-17** — moved whole
to [`DONE.md`](DONE.md). ✅ **No longer dark**: measured 2026-08-17 at the
`/gabi` deploy, `/api/health` reports `discord_client_secret: true` and
`link_ready: true`, so `access/discord-bot.md` §3 step 7's clicks are done.
`/link` still has to be PUBLISHED via §4 before anyone can type it.

⚠️ **Phase 3 (bot-posted poll messages with buttons) LANDED 2026-08-17** —
moved whole to [`DONE.md`](DONE.md). Live and **shipping dark** until a club
opts in.

⚠️ **`/have` LANDED 2026-08-17** and ⚠️ **moderation (`/timeout` + `/cleanup`)
LANDED 2026-08-17, DARK** — both moved whole to [`DONE.md`](DONE.md). Live at
version `ad35e796-ffd6-44a8-b15e-83bc75bf97ab`.

⚠️ **`/gabi` — THE FIXER'S DISCORD SURFACE, shape (b) propose-and-deep-link
— LANDED 2026-08-17** (queue item 3). Moved whole to [`DONE.md`](DONE.md).
Live at version `03bd6a3a-7f05-4fbe-a846-05bc614f97e6`, commit `4715b03`;
runbook [`access/discord-bot.md` §10](access/discord-bot.md). It ships with all
four of the design's blockers still unsolved, which is exactly what shape (b)
is for: no write, no model call, no new secret.

⚠️ **CONVERSATIONAL GABI, phase A — "@mention her and she answers" — LANDED
2026-08-17, shipped OFF.** Moved whole to [`DONE.md`](DONE.md); the as-built
design is [`info/discord-bot-design.md` §6](info/discord-bot-design.md). Live at
version `fa8140f6-da59-4f0d-b918-0f6a6f7777a7`, commits `74d6bd3` + `cfe768b`.

⚠️ **THE DEEP LINK — asker-aware destination AND `?gabi=` prefill — LANDED
2026-08-18.** Moved whole to [`DONE.md`](DONE.md). Live at version
`c9af75f0-f8e3-4de6-b6ac-81a02c98ce9f`, commits `02c5834` + `a4b5d53`. It grew
from the one-line prefill item recorded here into two halves, because the owner
hit the second one live: the link pointed at `padhard.heygabi.ai` for everybody.

**Everything else outstanding on this whole section is a switch-on, not a build:**

- 🧑 **Owner — TURN GABI'S EARS ON. Three steps, in this order**, and nothing
  happens until all three: she is currently **not connected at all**, not
  merely quiet.
  1. **Paste the Anthropic key** — optional, but it is the difference between
     a lookup bot and a conversation. Mint a **NEW** key at
     `console.anthropic.com` (⚠️ deliberately NOT the library's
     `ANTHROPIC_API_KEY`, so the Discord spend is separately capped and
     rotated), put it in `apps/discord-worker/.dev.vars` after
     `ANTHROPIC_API_KEY_GABI=`, run `wrangler secret put ANTHROPIC_API_KEY_GABI`,
     then blank the line again. Without it she still answers *"do we have …"*
     from the keyword router and never mentions the gap in a channel.
  2. **Flip the posture** — `GABI_MENTIONS = "on"` in
     `apps/discord-worker/wrangler.toml`, then deploy. ⚠️ The owner's decision,
     never an agent's and never a side effect of a deploy.
  3. **Start the gateway** — `POST /admin/gateway/start` with an estate admin's
     Firebase ID token. ⚠️ **This is the ONLY starter.** The cron meant to be a
     second, independent poker could not be installed (this account is on
     Workers Free and its 5 cron triggers are spent), so nothing else will
     create the object, and there is no backstop if its alarm chain breaks.

  Then test it in the server by typing: **`@GABI do we have Mistborn?`**
- 🧑 **Owner, worth knowing BEFORE step 2:** the always-on Durable Object uses
  **~83% of this Cloudflare account's free-plan Durable Object duration
  allowance** (10,800 of 13,000 GB-s/day). It costs **$0.00**, but that is a cap
  which **stops** the object rather than billing for it. ⚠️ A second always-on
  Durable Object anywhere on this account would break it; Workers Paid removes
  the constraint entirely.
- 🧑 **Owner decision, deliberately NOT built — bare-text triggers**
  (`heygabi …` with no `@`). It needs Discord's Message Content privileged
  intent, which the design has refused since §1.5: the bot would receive the
  text of **every message in every channel it can see**, in every server it is
  in. That is a different privacy posture from anything agreed so far.
  Reasoning: [`info/discord-bot-design.md` §6.8](info/discord-bot-design.md).
- ✅ **Identity linking is ON** — `access/discord-bot.md` §3 step 7's three
  clicks were done by the owner at some point before 2026-08-17's `/gabi`
  deploy, and the correction is MEASURED, not assumed: `/api/health` now
  reports `discord_client_secret: true` and `link_ready: true`. This line
  previously said the clicks were outstanding.
- 🧑 **Owner or admin — THE ONE REMAINING CLICK:** run §4's
  `POST /admin/commands/register` (one button on the `/admin` page, CORS now
  open to the apex) — ⚠️ **until someone does, `/link`, `/have` and `/gabi`
  do not exist in Discord at all.** It needs a Firebase ID token from an estate
  admin account, which no agent holds; it is one authenticated POST and it is
  idempotent for a given `MODERATION_ENABLED` state.
- 🎛️ **Conductor / owner:** opt a club in with
  `features.discordPollVoting = true`. `POLL_SYNC_TOKEN` is **set on the
  Worker** (measured 2026-08-17: `/api/health` reports
  `poll_sync_token: true`, `poll_sync_ready: true`) — ⚠️ **not verified** is
  whether the audiobook pipeline's `.env` holds the SAME value, which is what
  makes the tick actually fire on cadence.
- 🧑 **Owner, evidence-gated:** flipping `MODERATION_ENABLED` to `"on"`. ⚠️ It
  has a **second step**: re-run the registration route, because while the
  switch is off the two moderation commands are deliberately not published to
  Discord at all (reasoning in `commands.ts` and `DONE.md`).

## 📚 Series registry — the API is LIVE; what still hangs off it

The registry itself is **done and deployed** (2026-08-17) — the whole record,
including the measured counts and what was NOT verified, is in
[`DONE.md`](DONE.md); the design is
[`info/index-worker-design.md` §8.5](info/index-worker-design.md). Only the
work that has NOT been done is listed here.

1. 🧑 **OWNER DECISION — one near miss is waiting, and the evidence is in.**
   ⚠️ **The build half of this item is finished and moved whole to
   [`DONE.md`](DONE.md) (2026-08-18)** — both the API half (2026-08-17) and
   the `/series` banner that reads it. What is left here is not work; it is a
   decision only the owner can take, so the item is split rather than parked:
   a finished build does not sit in the active list waiting for a human, and a
   human's pending decision does not get archived as done.
   **The row**: *"The Survivalist Series"* ~ *"The Survivalist"* (both
   audiobook, so it may belong in the audiobook catalog's own corrections
   layer rather than as an index merge — that is the decision).
   ⚠️ **`/series` has produced EVIDENCE for it, observed live 2026-08-17** —
   and it points at *separate*, not merge: *The Survivalist* holds one volume,
   **Frontier Justice, Arthur T. Bradley, 2014**, while *The Survivalist
   Series* holds books 6–9 by **A. American**. Two authors, so two series that
   merely share a name; merging would fuse two people's work under one key.
   Resolving it `{"action":"separate"}` would also retire the phantom
   *"Book 1 — nobody in the estate has this one"* row `/series` shows on the
   A. American run — the visible cost of an unanswered queue. **Still the
   owner's call**; recorded as evidence, not as a decision taken.
   ⚠️ **There is no UI for the resolving POST and that was deliberate** — see
   `DONE.md`. Taking the decision today means one authenticated
   `POST /api/series/pending/:fold` with an owner's own bearer.
2. **`/universes`' CSP `frame-src` does not name `auth.heygabi.ai`** — noticed
   while writing `/series`' own rule and deliberately NOT fixed there (a page
   nobody is building is not a page to change blind). `estate-auth.js`'s
   `authDomain` moved to `auth.heygabi.ai` at the SSO Phase 1 cutover
   ([`info/sso-design.md` §4.1](info/sso-design.md)); `/`, `/admin` and the new
   `/series` name it, `/universes` and `/status` do not. ⚠️ Whether it actually
   breaks a sign-in *started from those pages* is **UNMEASURED** — the popup
   path may never need the iframe. Measure first (sign out, sign in from
   `/universes`, watch the console for a frame-src refusal), then fix. Size XS,
   and both the bare and trailing-slash rules need it — that file's 308 trap.
   ⚠️ **Datapoint, 2026-08-18:** the /status split's three NEW rules
   (`/status/processing`, `/status/pipelines`, `/status/agents`) DO name
   `auth.heygabi.ai` in `frame-src`, and **sign-in was exercised on all three
   signed in with no console refusal**. That does not prove the old rules are
   broken — the popup path may genuinely not need the iframe — but it does mean
   `/status` and `/universes` are now the only two pages on the old shape, and
   the split's pages are the control group for measuring it.
3. *(Moved whole to [`DONE.md`](DONE.md), 2026-08-17 — the universe join now
   reads the SERIES rather than one spelling of it. The number is left
   standing rather than renumbering the list, the same way `DONE.md`'s own
   split kept item numbering so the archive's references still resolve.)*
4. **Decide whether `/api/series` should answer the anonymous internet.** It
   currently takes `/api/universe`'s stance (members-only, scoped) because
   §4.5's anonymous carve-out names `/api/search` alone. Widening is one line
   in `index.ts` plus a named comment — but it is an ACCESS-INCREASING change,
   so it waits for the owner rather than being assumed.
5. **Widen the approver gate if the estate ever exposes `is_approver` on
   `/seen`.** `requireOwnerStanding()` in `apps/index-worker/src/middleware/auth.ts`
   is the single place; it is narrow today only because the shared module does
   not carry the flag to consumers.

---

## 📖 TBR should span all catalogs, the way "read" does (owner ask 2026-08-16)

> *"tbr like read should span all catalogs"*

**Recorded, not started.** Sits with the two entries below it — this is the
same question they are, arrived at from the reader's side rather than the
architecture's.

**What exists today, measured 2026-08-16:**

| Concept | Where it lives | Spans catalogs? |
|---|---|---|
| Reviews + ratings | ONE shared Firestore store, keyed by `bookIdFromTitle` — audiobook and library both write it | ✅ yes, already |
| "read" / reading state | `PUT /works/:id/reading` (`trackReading`), library only | ❌ library's own table |
| **TBR** | Only inside audiobook **book clubs** — a club's Current Read and TBR list | ❌ per-club, not per-person |
| Wishlist | Per catalog (`suggestWishlist` / `manageWishlist` in both library and games) | ❌ separate lists |

So there is a precedent that already works — the shared review store proves a
per-person fact CAN span catalogs — and TBR is the one that most obviously
should follow it: what someone intends to read next does not care whether the
copy is an audiobook, an ebook or a paperback.

⚠️ **The design question this forces, and why it is worth answering once:**
TBR is a **per-person, per-WORK** fact, while every catalog is organised around
**copies**. "I want to read *Wintersteel*" is one intention, even when the
household holds it in three formats. So a cross-catalog TBR needs the same
identity key the reviews already use, NOT a row in each catalog — otherwise
finishing the audiobook leaves the paperback still on the list.

⚠️ **This is the same seam as the ebooks question below.** Shared-pool formats
(audio, ebook) versus owned copies (physical, games) is the split; a spanning
TBR is what it looks like from the reader's side. Decide them together, and
consider whether "read", wishlist and TBR are three names for one per-person
state machine (want → have → reading → read) rather than three features.

**Games:** "all catalogs" plausibly includes a to-PLAY list. Ask before
assuming — it may be the same feature or a deliberately different one.

### ⚠️ SCOPE NARROWED by the owner, 2026-08-16 — read this before building anything above

> *"lets more or less exclude games unless we design a feature thats worth
> adding to it. for now my friend wants to sort her books"*

Two corrections to everything written above, and the second is the important one:

1. **Games are out of scope** for the federation, the cross-catalog TBR and the
   ownership join — unless a feature turns up that is genuinely worth adding to
   games on its own merits. Do not carry games through these designs "for
   symmetry"; it doubles the surface for a use case nobody asked for.

2. ⚠️ **The actual requirement is "she wants to sort her books."** That is not
   the federation, not "who owns what", not a spanning TBR. Those are things
   the OWNER finds interesting about the estate; they are not what the person
   with the books needs. **Build the small thing first.**

**What "sort her books" actually needs, in order:**

| Need | Status today |
|---|---|
| Get her books INTO a catalog without a terminal | Scanning exists and is field-proven; the remote/non-technical ingest story is the real gap |
| Details filled in without her chasing them | The hourly auto-sweep landed for games 2026-08-16; **library is the queued twin and is what she actually needs** |
| Browse/sort by series, author, what's missing | Already the library app's strongest feature — series ladders, gaps, sorting, filters |

So most of what she needs **already exists**; the missing piece is ingestion for
someone remote and non-technical, plus the library details sweep.

⚠️ **Do NOT start with the shared index join.** "See who owns what" is a
SECOND-phase want, and it is cheap to add later precisely because a separate
instance is already an index source. Building the join first would mean
designing a federation for a catalog that does not yet have any books in it.

## 📚 Ebooks may want to be their OWN site — the ownership boundary is per-FORMAT (owner insight 2026-08-16)

## ⏸️ PARKED FOR EMERGENCIES — 2026-08-19 12:30 Phoenix. READ THIS FIRST.

> **Owner order, verbatim: *"Let's save for emergencies."*** Weekly usage was
> **89%** and does not reset until **Sunday 2026-08-23, 3:59 PM Phoenix**, so
> overspending now costs DAYS, not an evening.

**The posture, until the owner says otherwise or the pool resets:**

- ⛔ **Start no builds and dispatch no agents.** Not "small" ones either — ⚠️ a
  subagent's cost is invisible until it lands, and one landed at 431k today.
- ✅ **Conversation, reads, doc edits and single commands are fine** — they are
  individually tiny. The reserve exists to be spendable in an emergency, and
  an emergency is something that would break or corrupt if left, not something
  that is merely waiting.
- ✅ **Everything unattended keeps running and costs no Claude budget:** the
  nightly book ingestion, the hourly details sweeps on both library instances,
  the R2 archive task, the backups.
### ▶️ THE STARTUP RULE — Sunday 2026-08-23, **15:49 Phoenix**. Ten minutes BEFORE the reset.

> **Owner order, 2026-08-19: *"We'll likely lose this session so set the start
> up rule for 10 minutes before weekly reset into the todo doc."*** He is
> right that the session will not survive — a wake-up timer was scheduled but
> it lives in session memory and dies with the process. **This block is the
> resume mechanism. Nothing else is.**

⚠️ **TEN minutes, not five.** The global rule in `~/.claude/CLAUDE.md` says
*~5 minutes before*; the owner set **10** for this resume. Honour the 10 — do
not "correct" it back to the global figure, and do not wait until after the
reset. The old window's remnant is wasted at the stroke either way, and the
worst case of starting early is a pause into a reset that is minutes away,
which costs nothing.

**Whoever opens the next session at or after Sun 15:49 Phoenix, do exactly
this, in order:**

1. **Read the clock first** (`Get-Date`). ⚠️ Never infer the hour from message
   timestamps or from this document — a session that does not know what time
   it is cannot honour a window.
2. **Read usage** at <https://claude.ai/settings/usage>: navigate away and
   back (it is a single-page app and will otherwise serve the first render
   for ever), wait 2–3 seconds, then `find` the figures. **Confirm the reset
   actually happened** rather than assuming it from the clock — if the weekly
   figure still reads 89%, the reset has not landed yet; wait and re-read.
   Report the numbers with the time.
3. **Read this whole parked section**, then the handoff below it.
4. **Ask the owner before starting any build.** His standing decision was
   *"Let's save for emergencies"*, and that decision expires WITH THE RESET —
   it does not lapse on its own, and it does not authorise a fresh start
   either. Present the parked queue **one item at a time**.
5. **Model:** Fable was at 91% (past its own 92-warn in practice) and weekly
   at 89% when this was written. Unless the reset cleared both, the main loop
   is **Opus**, and build agents are Opus/Sonnet — never Fable. The paste-ready
   Opus kickoff prompt is in the handoff section directly below.

**If the pool did NOT reset when expected**, treat it as a failed read rather
than good news: say so plainly, fall back to the last known figure WITH its
timestamp, and do not start work on the assumption that budget exists.

**The parked queue, in the order I would pick it up** (nothing here is
broken; each is a want):

1. **TBR reassignment — 53 documents** from a retired passphrase account.
   ⚠️ Not a build: the tool is dry-run verified (53 to carry, **0
   duplicates**) and the run is blocked by the permission classifier, so it
   needs the OWNER's hand, not an agent.
   `audiobook_catalog/scripts/reassign_tbr_owner.py`.
2. **OCR processor** — 23 image-scan PDFs are permanently outside GABI's
   knowledge until it exists. The largest single gap in the knowledge base.
3. **Audiobook player phase 2.**
4. **Revoke the stale broad Cloudflare token** ("Edit Cloudflare Workers",
   Aug 14, admin read+write on ALL R2 buckets, nothing known uses it). Small,
   security-shaped, and access-REDUCING — so it needs no confirmation beyond
   the owner's hands on the dashboard.
5. **GABI features remain FROZEN** by separate owner order ("on hold until we
   get room") — switchboard, human-speak eval corpus + model router, wider
   stay-in-character pass.

**Waiting on the owner and costing nothing:**

- ⚠️ **GABI has never been used on Samantha's site, on her key, about her
  books.** Every measured conversation ran against the main catalog on the
  owner's key. Same for the memory test (talk, close the tab, return inside
  30 min — then wait past 30 min and confirm she FORGETS; step two is the one
  that proves the privacy posture).
- **Words of Radiance (main #220)** — the standing `multi_volume_printing`
  checkbox decision; two hardcover editions, and only someone holding them
  can say.
- **Three unsplit containers on main**, surveyed but untouched: **413**
  *Skyward Flight: The Collection*, **416** *Arcanum Unbounded*, **90**
  *White Sand*. Pattern to follow is R11 in
  `library_catalog/docs/info/volume-numbers.md`. One at a time.
- Firestore TTL console click; estate SSO console step (the feature is inert
  without it); the Diva's-house Discord channel permission; deadline-gate
  boundary confirm.

## 🔄 HANDOFF — 2026-08-19 ~11:15 Phoenix (MODEL SWAP: Fable → Opus main loop)

> **Why this handoff:** Fable weekly read **91%** at 11:07 (resets Sun
> 3:59 PM) — the owner's warn line, and his order: *"we will be swapping to
> Opus once everything is done."* The 2026-08-18 handoff below still holds
> for everything not restated here; its **global-rules-are-law block and
> Model-selection ladder apply verbatim to the Opus session too.**

### ⚡ OPUS KICKOFF PROMPT — for a CLAUDE-CODE-ON-OPUS main loop ONLY
> ⚠️ **Kiro executors: SKIP this block.** Your instructions are unchanged —
> the "Fallback executors" part of the Model-selection section in the next
> handoff down (stay on AUTO, honor the per-task model labels). This block
> assumes Claude Code tools (agent dispatch, browser usage reads, Firestore
> service account) that a Kiro session must not assume.

Paste-ready first message for the Opus session:

```text
You are the estate conductor, now on Opus 5 (Fable hit its weekly warn line;
conduct exactly as Fable did — plan, brief, review; Opus/Sonnet agents
build). First: read the top handoff of catalog-platform/docs/TODO.md and
treat ~/.claude/CLAUDE.md as absolute law (usage lines with clock in every
substantive reply; before-dispatch and after-landing usage reads; one owner
decision at a time; commit -F never -m; never stash; push main only,
promote only on the owner's word). Standing priorities, owner-ordered:
(1) Samantha's library (padhard) — the details queue must converge on its
own; verify tomorrow it reads single digits with worded residue, touch
nothing unless it drifted. (2) GABI features are FROZEN by owner order
until usage room returns — do not start switchboard/eval-corpus/router
work. (3) Keep all docs current at landing; designs execution-complete
(a weaker Kiro session may succeed you at 89% weekly — that is the next
rung of the ladder). Settled law you may not relitigate: series ==
volume; the multi-volume-printing checkbox is HUMAN-ONLY (research never
writes it); missing printed-volume display is not a details gap.
```

### State at swap (all verified 2026-08-19 morning)
- **Padhard details agent LANDED** (Opus, 431k, 13 commits `05247ce`→`110f043`,
  friend deployed 4× → `2a135abb`, tests 1273→1301). Root causes: filling
  57 series *created* the 55 volume questions, and `seriesIndexIncomplete`
  demanded a display form nothing ever wrote — successful runs stranded
  their own books. Fixed + owner's semantics built: series+sort=complete,
  display optional (only written when a finding quoted it verbatim),
  `multiVolumePrinting` checkbox (migration 0360, both remotes; About
  panel; shut to research on four surfaces, one guard test). Failure
  classifier now re-queues allowance/key failures instead of demoting.
  Canonical doc: `library_catalog/docs/info/volume-numbers.md`.
- ✅ **Sam's volume queue then emptied BY HAND, 51 → 0 waiting, for nothing**
  (owner: *"Fix them by hand"*). 49 numbered, *Tusk Love* recorded standalone
  as a verdict rather than a fake `1`, and the **Caraval boxed set split**
  into three works with every ISBN verified against Open Library first (the
  container's own record named its contents). Batches
  `hand-volumes-20260819` / `caraval-split-20260819`, all reversible,
  `changed_how='human'`. Rules R9–R12 in `volume-numbers.md`.
  Live now: **3 waiting** — the three new Caraval works needing descriptions,
  which the sweep fills two an hour. Review:
  <https://padhard.heygabi.ai/queue>.
- 🔴 **Live defect found on the way, NOT fixed** (in `library_catalog`
  TODO.md): *"Look up all"* tracks asked-ness **per book, not per question**,
  so it disables itself with "Every one already asked" while N questions are
  open. This is what the owner meant by *"the button didnt fix"*. The hourly
  sweep is unaffected. Fix = make outstanding-ness per (work, field).
- **Volume/lookup spend note:** her key spent ~8¢ under the agent (4 books,
  cron ticks); the ~90¢ of 45 runs earlier was the owner's own button press.
- **GABI: FROZEN** (owner 2026-08-19: "on hold until we get room"). Open
  GABI items in older sections are parked, not lost.
- Usage at write: 25% session / 88% weekly / 91% Fable (11:07 read).
  Weekly agent-dispatch stop line is 93%.

### ✅ Owner-pending commands — CLEARED 2026-08-19 ~11:22
1. ✅ **Main library instance deployed** on the owner's word ("Run the npm
   command for me") — version `2fe70887` at commit `110f0436`, health
   green, deploys.log committed (`8208284`). The 0360 column gap is
   closed. Nothing remains in this category.

### 🧑 Owner-pending decisions/eyeballs (ONE at a time)
1. **Words of Radiance (main #220)** is the only multi-volume candidate the
   data supports — two `hardcover` editions, equally consistent with a
   leatherbound+trade pair. Only someone holding the books can tick the
   new checkbox. (Agent deliberately did not tick it.)
2. Deadline-gate boundary mapping confirm (carried from 08-18 handoff).
3. Padhard queue eyeball tomorrow: expect single digits, every remaining
   row saying in words why it is there.

## 🔄 HANDOFF — 2026-08-18 ~16:00 Phoenix (written for ANY successor, including a weaker one)

> Owner order of record (2026-08-18): designs written to EXECUTION
> completeness, docs current at landing — the fallback executor may be the
> Kiro-IDE Claude, which needs complete instructions. If you are that
> successor: read this whole section, then `git status` all three repos.
>
> ⚠️ **THE GLOBAL RULES ARE ABSOLUTE LAW FOR EVERY SESSION AND EVERY
> EXECUTOR** (owner order, verbatim intent, 2026-08-18: the global rules
> "are not to be ignored and followed as absolute law unless explicit
> permission is given per instance"). They live in `~/.claude/CLAUDE.md`
> (usage monitoring and handoffs, verification culture, multi-agent
> discipline, commit/deploy guards, never-stash, one-decision-at-a-time,
> and the rest). A deviation is legitimate ONLY with the owner's explicit
> permission for that specific instance — never inferred, never carried
> over from a previous exception, never self-granted because a rule seems
> inconvenient or inapplicable. When a rule seems wrong for the situation,
> the move is to ASK, not to skip.

### Model selection — for agents now, and for whoever executes later

**While Claude Code runs this estate:**
- Conductor: **Fable 5** until Fable weekly hits 92% (warn the owner at that
  reading), then **Opus 5** as the main loop until 89% weekly.
- Build/execution agents: **Opus 5** by default; **Sonnet 5** only for
  genuinely simple sweeps/lookups. Never dispatch on Fable without a
  written reason (estate tiering rule).

**Fallback executors, labeled so anyone reading knows what to tell the
owner:**
- **Kiro (AUTO)** — the default fallback. ⚠️ A note to Kiro directly: stay
  on AUTO (it costs the owner fewer credits); when a design doc or task
  below names a model, honor that naming — it exists precisely so AUTO
  stays safe and cheap. The naming convention:
  - **"Kiro Claude Sonnet 5" = STAY ON AUTO.** Verified 2026-08-18 from
    Kiro's own pricing: Auto is the 1.0x credit baseline; manually pinning
    Sonnet costs 1.3x and Opus 2.2x for the same task. So a Sonnet-class
    label means "Auto is fine here" — do not pin. Standard builds,
    mechanical execution, doc updates, test-backed changes. Most tasks.
  - **"Kiro Claude Opus 4.8" = actually PIN Opus (2.2x, worth it here)** —
    design judgment, trust-critical changes
    (auth, rules deploys, migrations, anything touching money or grants),
    debugging that resists two attempts on Sonnet.
  - **"Codex (GPT-5.3-Codex)"** — isolated, spec-complete greenfield
    builds in their own sandbox (the docker-PoC shape). ⚠️ This label
    means TELL THE OWNER — he runs Codex himself; no other executor
    should attempt to invoke it.
- **Standing convention from 2026-08-18: every new design/spec doc carries
  a "Model guidance" line per phase/task using exactly these labels**, so
  a Kiro-on-AUTO session inherits the escalation decision from the doc
  instead of guessing (or burning credits running everything high).

### Landed and verified today (deployed unless marked)
- Primal Hunter 1–14 in GABI's knowledge base (index = 190 books; ingestion
  unpaused 14:01, daytime run harvesting reviewed audiobooks until 18:30).
- GABI conversation stack, deployed: routing + follow-ups via context,
  no "budget" wording, auto-continue in numbered parts (max 4) paging
  FORWARD from cutoffs, caps 48KB/12 passages, availability grounded.
- GABI memory phase 1 LIVE (GABI_MEMORY="on", version be3434cc): 30-min
  window + per-person 2KB profile (2-min sweep) + "@GABI memory"/"forget".
  Design: docs/info/gabi-memory-design.md. Tiers 3–4 not built.
- /status: four pages incl. GABI Knowledge, per-section freshness (0013),
  usage tiles (push via scripts/push-agent-board.mjs .local/agent-board.json),
  processing board every 15 min with measured per-book percent.
- Audiobook archive: estate-audio archive/ (author folders only), hourly
  task AudiobookArchiveR2, ~685 GB seed near done; retrieval PROVEN
  (sha256-identical round trip). Backup job refuses this bucket.
- Ebook shelf publish unblocked; content notes live; index titles filled;
  transcripts third-copied to ebooks-gated/transcripts/ per book.
- Prod promote at 87cae40 (WebKit reader fix verified live).
- Ingest fixes by commit: 6296a22 resolver tail-strip; 30fef25 per-book
  control re-read + non-ASCII join; fba9355 publish steps every-cycle;
  65c769e CI platform tests; 3d79f53 CPU guard + deadline gate (first
  real exercise = tonight's window — check output_files/ingest_nightly.log
  for "would finish ~HH:MM -> OK/holding" lines); 4f1b6b0 pack-side
  tail-strip (ACOTAR pack-miss class; an 18:40 job clears false-failed
  rows so tonight packs harvested transcripts free).

### In flight (each reports to the conductor)
1. ✅ LANDED ~16:30, DEPLOYED (version 7b7b2e73): Personality +
   person-keyed memory. 11 tropes, PG-13-ceiling discretion on ALL voices,
   chain-not-ring drift graph, hidden pin (acks in voice, never names the
   feature), memory keyed to the Discord SNOWFLAKE (not the renameable
   username) across channels/DMs; the sweep doubles as the key migration.
   Design: docs/info/gabi-personality-design.md + gabi-memory-design.md
   §11. 656 tests. Honest gap: invariance tests prove a trope cannot EDIT
   a refusal, not that a model never paraphrases one — the owner eyeball
   is "what happens in PH 14" while pinned tsundere: same fact, grumpier.
2. ✅ LANDED ~17:00 (all deployed): Dashboard pass complete — storage card
   in BACKUPS (real %, three-state liveness, restore-proven ✓ from the
   conductor's sha256 round trip), worker event RING live (auth-worker
   writing; dedicated ESTATE_EVENTS_TOKEN design, catalog-index/audiobook
   -worker wiring ~5 lines each once minted — Codex/tell-owner label),
   notification prefs live (machines cannot POST them), /todo refreshed
   (auth was already correct — 2026-08-15 owner lock; generator declined
   with reasons), backups.test CRLF root cause fixed, ebook-lane THIRD
   VERDICT (library-shrank = grey; branch-order bug proven fixed in the
   shipped bundle). Superseded text follows: blob rows into the BACKUPS grouping with seed %, last
   run, verified?, restore-proven line (first data point: conductor's
   sha256 round trip today); worker event RING BUFFER in D1 (owner:
   "fix this" on the placeholder) + click-to-expand log tails; pushed
   home-job tail rings; notification prefs; /todo board content refresh
   (KEEP the design; check public exposure — standing rule says gated).
3. **The ingestion controls need ONE thing a session cannot do: the owner's
   browser.** The four controls themselves shipped 2026-08-18 and are archived
   whole in [`DONE.md`](DONE.md); what is left is the half no service account
   can stand in for. Every write so far was made with the Firestore credential,
   so `POST /api/estate/ops/ingestion`'s **200 path has never been exercised by
   a signed-in devops token and the new buttons have never been clicked.** Two
   minutes, and it is the difference between "deployed" and "verified":
   - <https://heygabi.ai/status/processing/> → *Not in GABI's knowledge base* →
     press **↻ Re-queue** on any row; it should answer with a sentence saying the
     book is queued and that nothing has been retried yet.
   - <https://heygabi.ai/status/pipelines/> → the ingestion card → **▶ Start
     now**; it should say the pauses are cleared and that a scheduled quiet-hours
     window, if one is live, still blocks the start.

### Open owner decisions (ONE at a time)
1. Gates agent flagged: confirm the deadline gate's boundary mapping
   (07:45/08:00 constants + pause windows) matches the owner's intent.

> ✅ **The `ebooks-gated` backup-mechanics decision is CLOSED** (owner,
> 2026-08-19, option "a": exclude the `transcripts/` prefix, keep the bucket)
> and moved whole to [`DONE.md`](DONE.md). It was item 1 here; the remaining
> numbers are re-flowed rather than left with a hole, because this list is read
> aloud one item at a time.

> ✅ **The book-text-in-channels decision is CLOSED** (owner, 2026-08-18:
> *"gabi can book test in channels that fine"*) and moved whole to
> [`DONE.md`](DONE.md). It was item 1 here and item 3 in the GABI-books
> section; the remaining numbers are re-flowed rather than left with a hole,
> because this list is read aloud one item at a time.

### Verify (copy-paste)
`python -m app.tools.ingest_books --status` · `python -m
scripts.archive_audio_r2 --status` (both in audiobook_catalog) ·
`curl -s https://discord.heygabi.ai/api/health` · https://heygabi.ai/status/
· suites: audiobook pytest (1 known failure: test_universes drift),
catalog-platform npm run test:scripts + per-app npm test.

## 🔄 HANDOFF — PC restart 2026-08-18 ~09:45 Phoenix (IDE update; owner-initiated)

> Written during an Anthropic 529 outage that had already stopped all agents.
> Next session: read this section FIRST, then git status both repos.

### State at restart
- **All agent work already landed today is deployed and verified**: panel-v2
  (both library instances), ingestion pause card on /status, nightly ingestion
  build (157 packs in ebooks-gated/text/, index at text/_index.json.gz,
  scheduled Windows task proven firing every 30 min — SURVIVES REBOOT, first
  real window tonight 00:00–07:45 Phoenix), library worker deploy (universe
  tags live), details queue = 0 missing / 0 coverless (badge is fetched once
  per page load — stale-tab gotcha), TBR entry "The Court of the Dead" for the
  owner, DONE.md paperwork current.
- **Two builds were IN FLIGHT and died on 529s — their uncommitted files are
  ON DISK in this repo, intact.** Do not revert them; finish them.

### In-flight build A: GABI book-knowledge SERVING layer — ✅ FINISHED 2026-08-18, moved whole to [`DONE.md`](DONE.md)
Four tools live in Discord, `GABI_BOOKS` on, all four retrieval modes exercised
against the deployed routes. Two things it deliberately did NOT do are recorded
as their own items below: the PANEL half (a three-holder-secret decision, not an
omission) and the empty `title` on every knowledge-base listing row.

### In-flight build B: /status SPLIT (4 pages) — ✅ FINISHED 2026-08-18, moved whole to [`DONE.md`](DONE.md)
All four pages are live and were checked signed in. The one piece of it still
open is a NEW item, not a leftover: nothing pushes the `processing` section
yet — see "Processing tab: the pusher" below.

### Primal Hunter / GPU
Books 1–9 transcribed+packed. Book 10 was mid-transcription at restart — its
partial is LOST BY DESIGN (tonight's window re-transcribes; truncation gate
rejects partials). Books 10–14: whatever the adopter (dead at reboot) copied
to C:\Users\nbasl\estate-training-data\ is durable; the nightly task
re-queues the rest automatically. NOTHING TO DO except verify tomorrow that
the window ran (receipts in estate-training-data, packs in the index).

### Owner-pending (present ONE AT A TIME when he's back)
32 unsettled seriesIndex judgment calls (board books + Ballad of Songbirds
and Snakes), HP/PJ set-edition rows for publisher/year fill, Ender set year
suspect (1991 = Xenocide's year). Night-report artifact:
https://claude.ai/code/artifact/af0f9cf0-aefc-4ed2-9993-d049df2ad1a4 — update
from any session by passing url to the Artifact tool; needs final PH + build
numbers before the OLD restart-report ritual is considered closed.

### Verification commands
git status (this repo + library_catalog + bookbuddy/audiobook_catalog);
schtasks task per audiobook_catalog ingestion docs; /status card renders
tonight's hold; library.heygabi.ai/tbr shows Court of the Dead.

## 🖥️ Status-page expansion — owner asks, 2026-08-18 (execute as agent bandwidth frees)

All from the owner's messages of 2026-08-18 morning; queued behind the pause-UI
agent because they share the /status page surface.

> ⚠️ **Items 1 and 3 SHIPPED 2026-08-18 and were moved whole to
> [`DONE.md`](DONE.md)** with the /status split that carries them. The numbers
> of the remaining items are left as they were — 0, 2, 4 — so the references
> above and in DONE.md still point at the same things.
>
> ⚠️ **Item 0 (ebook-lane status semantics) SHIPPED 2026-08-18 and was moved
> whole to [`DONE.md`](DONE.md)**, together with the audit it asked for, the
> per-section freshness fix, the two missing `/api/health` versions, the label
> sweep and the GABI Knowledge rename. Its number is left in the sequence for
> the same reason as the others.
>
> ⚠️ **Item 2 SHIPPED IN FULL LATER THE SAME DAY** — the page, its pusher, AND
> the per-book percentage — and was moved whole to [`DONE.md`](DONE.md). It is
> left in the numbering because 0 and 4 refer to it. (Item 2b, the missing
> progress bar, existed for about an hour: the owner read the report, said
> *"fill the gap"*, and it was filled. It is archived with item 2.)
4. ⚠️ **Incremental knowledge is a REQUIREMENT, not a nice-to-have** (owner:
   "I don't want to wait until every book is processed to use Gabi's
   knowledge. I want to use her while the knowledge base grows"). The serving
   build must serve whatever packs exist at query time, say cleanly when a
   book isn't ingested yet ("book 9 isn't in my knowledge base yet"), and
   pick up new packs without a redeploy. Per-book alias maps + derived ord
   ceilings already support this; the available-books check is the piece to
   make explicit.

### Ops IA — the /status SPLIT — ✅ BUILT 2026-08-18, blueprint moved whole to [`DONE.md`](DONE.md)

The four pages are live behind the devops gate:
[Health](https://heygabi.ai/status/) ·
[Processing](https://heygabi.ai/status/processing/) ·
[Pipelines](https://heygabi.ai/status/pipelines/) ·
[Agents](https://heygabi.ai/status/agents/). Reference lives by topic now:
[`info/status-pages.md`](info/status-pages.md) (who owns what, the module map,
the three traps) and [`info/agent-board-contract.md`](info/agent-board-contract.md)
(the pushed blob). Custody of the push bearer:
[`access/agent-board.md`](access/agent-board.md).

**Two follow-ups the split deliberately did NOT block on.** The first — *the
processing PUSHER* — shipped 2026-08-18 and was moved whole to
[`DONE.md`](DONE.md). The second is below.

### The agent board needs an estate probe (repo rule, not yet honoured)
`tools/estate-probes` carries a **new-endpoint-gets-a-probe** rule, and
`GET|POST /api/estate/ops/agent-board` shipped 2026-08-18 without one. It is a
natural probe target because its whole unauthenticated edge is worth pinning:
GET answers `401 unauthenticated`, POST with no bearer answers `401`, POST with
a wrong bearer answers `401 bad_token` — all three were exercised by hand
against the live host the day it shipped, and none of that is watched. **Left
undone deliberately**: `tools/` was outside the finishing agent's fence, and
widening a fence mid-build is how two agents end up editing one file. Size XS.

### Worker log ring buffer (owner asked for "logs for the pods/workers")
⚠️ **There are no pods or containers** — the estate is Workers plus pipelines on
a home PC, and that word must not become a promise the estate cannot keep.
Workers cannot be live-tailed from a static page. The plan: workers write
structured error/event rows to a **capped D1 table** (newest-N), Health renders
it, and deep-dive links out to the Cloudflare dashboard. Local pipeline logs
already exist on the PC; the ingestion push can carry recent tails on the same
board. Never fake a "live" tail that is actually stale — **timestamp every log
block**. Health currently says the section is not built rather than showing an
empty box that reads as silence.

Raised mid-conversation and **not yet decided** — recorded because it reframes
the federation question above rather than adding to it.

> *"we might need to now make ebooks its own site because we all share ebooks
> like we do audiobooks but physical books obviously belong to someone"*

**Why this is the sharp observation:** this estate has been splitting catalogs
by MEDIUM (audiobooks / books / games), and the owner has just pointed out the
split that actually matters is by **ownership model**:

| | Shared by the household | Belongs to one person |
|---|---|---|
| Audiobooks | ✅ already its own site | |
| **Ebooks** | ✅ **behaves like audiobooks** | |
| Physical books | | ✅ a specific copy on a specific shelf |
| Board games | | ✅ (a physical copy, though played together) |

Ebooks currently live INSIDE the physical library catalog — `site/ebooks.json`
is produced by the audiobook pipeline's step 1b and imported by
`library_catalog`. So a shared-by-everyone format is stored inside the one
catalog whose entire premise is "who owns this copy".

⚠️ **This is exactly the question the second-household federation runs into.**
"See who owns what" is meaningful for physical books and games, and close to
meaningless for ebooks and audiobooks — those are "do we have it", not "whose
is it". Deciding the ebook split FIRST would likely simplify the federation,
because it separates *the shared pool* from *the per-person shelves* before two
households ever have to be joined.

**Not a build yet.** Open questions, in the order they need answering:
1. Does an ebook site mean a new catalog, or a VIEW over the shared index?
   (The index already exists and already spans catalogs — a new Worker may be
   the expensive answer to a question a query answers.)
2. What happens to `library_catalog`'s existing ebook rows — move, mirror, or
   leave and re-point?
3. Does the shelf server change shape? It serves audiobooks by URL today;
   ebooks are the same *kind* of thing.
4. Who is the ingest owner once ebooks leave the physical catalog — step 1b
   still produces the manifest.

## 🤝 A second household's library, federated with ours (owner ask 2026-08-16)

**Deferred by the owner the same day it was raised — "do the next catalog
later" — recorded now so it is not lost.**

The ask: *"I want to make a site for my friends library and then link it to
mine so we can see who owns what. but she's less technical and doesnt live near
me, they need a much better automated solution."*

Three constraints that make this NOT just "deploy another copy":

1. ⚠️ **She is less technical.** Every operational assumption this estate rests
   on — a pipeline on a home machine, wrangler from a laptop, reading a runbook
   — is unavailable. Whatever is built has to run without her ever seeing a
   terminal.
2. ⚠️ **She is not local.** No shared LAN, no "I'll set it up on your machine",
   no physical access to fix a stuck box. Remote-first from day one.
3. **The point is the JOIN, not the copy.** "See who owns what" means the two
   catalogs must be comparable — which is what the shared index
   (`index.heygabi.ai`) already does across our three catalogs, and is the
   obvious foundation rather than a new mechanism.

⚠️ **Do not start this by cloning a repo.** The interesting design question is
the automation and the ownership boundary (her data, her account, her control,
our shared view), and answering that first will change what gets deployed.
Related: the combined-site architecture already sketched for our own three
catalogs.

## Discord bot — option space (design doc on file)

Design doc: [`docs/info/discord-bot-design.md`](info/discord-bot-design.md)
(2026-08-14, no code yet). Builds on `audiobook_catalog/docs/info/
discord-poll-sync-research.md` (bot mechanics: Ed25519 interactions endpoint,
token custody, per-server invite, identity linking). Recommended first
three: (b), (a), (d) below.

⚠️ **Two of the recommended three have SHIPPED (2026-08-17) — read this list as
"what is left", not as a queue.** (a) is GABI phase 3 (bot-posted poll messages
with vote buttons, tally refresh, close propagation) and (b) is `/have`; both
are live at `discord.heygabi.ai` and archived whole in [`DONE.md`](DONE.md).
(d) and everything below it are genuinely unbuilt. Noted 2026-08-17 by the docs
hygiene sweep, which found this list still reading as though nothing existed.

- (a) Two-way poll voting — buttons sync votes with club polls both ways. **M**
- (b) `/have` or `/shelf` — "does the estate have this book?" via the index
  Worker's search, scoped `{audiobook}` for strangers / member visibility for
  linked+approved users. **S–M**
- (c) New-additions feed / `/recent` / rich shelf embed — browse what's owned,
  driven by `additions_log.json`. **S (feed/`/recent`), M (rich embed)**
- (d) Club RSVP via buttons — ties to the shipped meeting scheduler. **M**
- (e) `/progress` — reading-progress updates from Discord, identity-linked
  writes via service account. **M–L**
- (f) Meeting reminders with snooze/RSVP actions. **M**
- (g) Community-stats digest posts to a channel. **S–M**
- (h) `/suggest` — TBR suggestions from Discord, identity-linked writes. **M**
- P1 `/guessgame` — Discord-native cover-guessing game (proposal). **M**
- P2 `/review` — surface existing book reviews on request (proposal). **S**
- P3 `/universe <name>` — cross-catalog universe showcase (proposal). **S**
- P4 Per-book discussion threads on read-start (proposal, lower priority). **M–L**

---

## Fable-preferred queue (started 2026-08-14, owner directive)

Agents now run non-Fable by default. Work banked here genuinely benefits from
Fable and waits for the owner to release it (e.g. after a weekly reset):

1. ~~**SSO build, phases 1-4**~~ — ⚠️ **STALE, see the live SSO section at the
   top of this file.** The owner approved the design 2026-08-16 and phases
   1–3 shipped 2026-08-18; "awaiting the owner's go" is two decisions out of
   date. Kept rather than deleted because this queue exists to record which
   work suits which model, and phase 4 is still unbuilt.
2. **Rules tightening deploy (club permissions 0b)** — deny manager writes on
   unclaimed clubs once every active club is claimed. Precondition-gated.
3. **Edit-audit phases A2/A3** (edit-audit-design.md §6) — override-aware
   review backfill + CLI key-move warning; guards the shared review store
   against orphaning. Do BEFORE any reviewed audiobook is retitled.
4. Any future Firestore-rules rewrite or estate auth-worker change touching
   verification/secrets.

---

## Queued behind the Cosmere batch (owner, 2026-08-15)

1. **Generalize the Cosmere treatment estate-wide**: for every universe and
   series, apply the same logic just exercised on Cosmere — matcher
   completeness (no member left unflagged by a spelling quirk), series-blank
   via the corrections layer where a 'series' is really a universe umbrella
   (non-destructive, owner's exclusion-list rule), spelling fixes through the
   series canon. Same propagation chain.
2. **Full orphan sweep (AI judgment, Opus)**: read all three catalogs like a
   librarian and find every book/game that BELONGS in a series or universe
   but isn't attached — missing series fields, universe members the matchers
   miss, series spelled into isolation. Verdict table like the fuzzy-match
   sweep (confident fixes applied via the proper instruments; ambiguous rows
   reported); before/after counts.
## ☐ Keeping the doc tree honest — the recurring pass

⚠️ **The reusable half of the old K3/K19 items moved to
[`info/doc-tree-maintenance.md`](info/doc-tree-maintenance.md) on 2026-08-23.**
They were reference wearing a work-item heading: a worked example and a shape
lesson, neither of which is a task anybody can finish. The recurring pass
itself is still a task, so it stays here.

After any substantial piece of work, in the same session:

☐ Finished item moved **whole** into `DONE.md`?
☐ The `access/`/`info/` doc whose facts changed updated, **with its
  *Last verified* date**?
☐ Anything deliberately left broken written into `KNOWN_ISSUES.md`, with a
  removal condition that is a **number** where it can be?
☐ Nothing loose at the top of `docs/` — a stray `.md` there belongs in
  `access/`, `info/`, `archive/`, or one of the three logs?
☐ Said what was **not** verified?

### ⚠️ Four ✅ headings remain in this file ON PURPOSE — do not sweep them

Checked 2026-08-23 by reading each body, which is the only way (see
[`info/doc-tree-maintenance.md`](info/doc-tree-maintenance.md)). All four are
**partial completions correctly retained**: the badge names a milestone that
shipped, and the body says why the item is not finished.

| Heading | Why it stays |
|---|---|
| GABI WRITE-VERB PERMISSION LADDER — ✅ APPROVED | Says so itself: *"T1 is one rung of a five-rung ladder, and an item moves once, whole, at completion"* |
| GABI SUGGESTS A BOOK — ✅ LIVE | Live, with open per-format gate work in the body |
| GABI’S PERSONALITY — VISIBILITY + DEVOPS — ✅ LIVE | ditto |
| GABI’S PERSONALITY + PERSON-KEYED MEMORY — ✅ LIVE | ditto |

⚠️ **A ✅ in a heading is not by itself evidence of anything** — in this file
it has meant "finished" eleven times and "one milestone of several" four
times. The body is the authority, both ways.

---


## 🔍 AUDIT 2026-08 — confirmed findings (`catalog-platform`), ranked

> Landed **2026-08-23**. Full document, with all 79 findings, the evidence for
> each and what would fix it:
> [`info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md).
>
> **79 findings survived verification** (1 critical · 7 high · 29 medium · 42
> low) across 13 review units; 7 further findings were refuted and are not
> recorded. **Only critical and high get an item here** — medium and low stay
> in the findings doc, which is the one home for them. Ratings are the
> refuter's final ones, so a few read `orig → final`.
>
> ⚠️ **The audit changed no code.** Every item below is unstarted work, and
> each is an owner-decided dispatch, not a sweep. ⚠️ **It was read-only:** no
> production request, no database read, no browser. Findings whose *impact*
> depends on runtime state say so in the doc's §7 — check that before sizing.

### ☐ F1 · 🔴 CRITICAL — unfiltered docs backups sit in the public repo's tree

`scripts/backup-docs.mjs:270` writes archives containing **raw secret values**
(service-account JSON, bearer tokens) into `.docs-backup-tmp/`, never deletes
them, and that path is **not** in `.gitignore`. Eight archives, ~6.6 MB, are
there right now — one `git add .` from being published on a public repo.
**Fix:** add `.docs-backup-tmp/` to the tracked `.gitignore`, `rmSync` the temp
file after the R2 put (or write under `os.tmpdir()`), and delete the eight.
**Size:** XS. **Do this one first** — the other seven can wait a week.

### ☐ F2 · 🟠 HIGH — one runbook form silently wipes the other's saved facts

`sites/heygabi-home/public/runbooks/shelf-justin/doc.js:26` knows 5 of the 9
`shelf` fact fields but POSTs to the same **whole-record-replace** endpoint
`/runbooks/shelf-migration/` uses with 9 — so saving on Justin's page blanks
`shelf_host`/`shelf_path`/`shelf_user`/`shelf_ssh_port` and
`/api/machine/shelf-config` starts answering `configured:false` to the
pipeline. Introduced by `2656741`, which updated one page and not the other.
**Fix:** make the POST a merge, or collapse to one form per this file's own
rule at §*Shelf connection details* (*one surface owns it*).

### ☐ F3 · 🟠 HIGH — `stream-ping` lets the caller choose the Firestore document

`apps/audiobook-worker/src/stream-ping.ts:115` interpolates the client-supplied
`anchor` into a Firestore REST path with no `encodeURIComponent` and **no
manifest lookup**, so an admitted caller steers a rules-bypassing service
account: `..%2Fsite_roles%2F<uid>%23` both escapes `audio_streams` and drops the
update mask, making the PATCH a full-document replace — answered `204`.
Breaks `audio-manifest.ts:11-17` verbatim (*"THE MAPPING IS A LOOKUP, NEVER A
CONSTRUCTION"*). **Fix:** look the anchor up and 404 on a miss; encode anyway;
use `patchFsDoc`. The module has **no tests at all**.

### ☐ F4 · 🟠 HIGH — estate SSO is CSP-blocked on `/series` and `/universes`

Both pages call `handleRedirectResult()`, which unconditionally fires
`bootstrapEstateSso()` at `auth.heygabi.ai`, but neither page's `connect-src`
names that host (`public/_headers:304`, `:308`, `:313`, `:317`) under
`default-src 'none'`. Every failure path is a silent `catch { return false }`.
**Signing out on either page never clears the `.heygabi.ai` session cookie**,
and signing in there never propagates. **Fix:** add the host to those four
rules. ⚠️ Distinct from KI-6, which is `frame-src`. Also re-date
`info/sso-design.md:257` — its "connect-src already names it" measurement was
taken against `/` and `/admin` before `/series` existed.

### ☐ F5 · 🟠 HIGH — index-worker's CORS blocks every POST on `/api/*`

`apps/index-worker/src/index.ts:113` sets `allowMethods: ['GET','OPTIONS']` on
the whole prefix. `/api/scan/shelf` is **already called from the apex**
(`assets/estate-search.js:1415`), so shelf-photo identify cannot work from a
browser today — and the catch prints *"The scan endpoint did not answer
(network)"*, an outage sentence for a config refusal.
`POST /api/series/pending/:fold` is blocked the same way, latently.
**Fix:** allow `POST`. Same class as the `/ops/ingestion` incident: **a Hono
CORS mount is not implied by a route.** (medium → high on verification, because
one of the two routes is live rather than latent.)

### ☐ F6 · 🟠 HIGH — GABI's shelf and recall tools are never offered to the model

`apps/discord-worker/src/gabi-chat.ts:754` builds the API tool array as
`{docs, books}` only, so `my_tbr`, `my_reviews`, `book_reviews` and
`recall_conversation` are unreachable — with `GABI_SHELF="on"` and the ports
wired in production. Two in-repo comments assert the opposite. Only `my_unread`
works, because it is computed deterministically ahead of the model.
**Fix:** pass `shelf`/`recall` at that call site, and add a test asserting what
the **call site** passes — today's tests pin the pure function, which is why
this passed CI.

### ☐ F7 · 🟠 HIGH — "reviewed" is computed from the capped 15-row display slice

`apps/discord-worker/src/shelf-flow.ts:111` builds the reviewed set from
`reviews.rows`, which `shelf-exec.ts:269` has already sliced to 15 — directly
beneath a comment insisting it uses the whole set. Anyone with more than 15
reviews has older-reviewed books counted as **not reviewed**, and gets
already-reviewed books suggested back to them (`suggest.ts:802`, the set that
file calls *"the single most obviously wrong thing this feature could do"* to
get wrong). `tool-exec.ts:1343` carries the same wrong comment.
**Fix:** return an uncapped reviewed-id set from the port and key all three
exclusion sets off it.

### ☐ F8 · 🟠 HIGH — the storage panel scrapes its own rendered sentence for an age

`sites/heygabi-home/public/status/status.js:1153` regexes the backups row's
text for `(\d+[a-z ]*ago)` and publishes the **trailing fragment of a compound
age** as "newest backup": *"Oldest of 5 stores 3d 2h ago … newest 12m ago"*
renders as *"newest backup 2h ago"* — neither number, understating the backup's
age by days, on the page whose whole purpose is honest ages.
**Fix:** hand `lastWriteFor` the value; `renderBackupGroup` already holds
`group.newest`.

### Not listed here, on purpose

The **29 medium** and **42 low** findings live only in
[`info/audit-2026-08-findings.md`](info/audit-2026-08-findings.md). Its §8
flags the two cheapest wins in the whole document: `KNOWN_ISSUES.md:13` points
at a `info/gotchas.md` that does not exist, and six separate findings are the
same shape — a flag flipped, the sweep updated three or four places, and the
missed copy was **always a comment or a README, never code**.
