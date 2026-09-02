# TODO — catalog-platform (ACTIVE work log)

> **Cleaned 2026-08-31.** The layered 2026-08-24 conductor/morning-summary
> handoff blocks that sat above this file's real items were actioned and moved
> WHOLE to [`DONE.md`](DONE.md) (entry *"2026-08-31 — the 2026-08-24
> conductor/morning-summary handoff blocks"*), each open claim re-verified
> first: F4's CSP fix was deployed 2026-08-24 (`deploys.log` `510adab`), GABI
> T2 was merged, deployed AND flipped ON the same day (`e73e7ec`), PEER_TOKEN
> was rotated by the owner, and the deploy pass is superseded by the later
> per-repo deploys. The still-open remnants were extracted into the items
> below.

## ☐ Groq as GABI's first-line model before Haiku — BUILT + DEPLOYED DARK, awaiting the owner's key

Owner ask 2026-09-01: *"we just used groq in a different project, lets integrate
that into our gabi model as a first line before going to haiku tokens"* +
*"use the information from the other project to help reduce duplicate work."*

**Built, tested and deployed 2026-09-01** — and it changes nothing today,
because `GABI_GROQ = "off"` ships in `wrangler.toml` and `GROQ_API_KEY_GABI` is
unset. Design of record: [`info/gabi-groq-rung.md`](info/gabi-groq-rung.md).
Runbook: [`access/discord-bot.md`](access/discord-bot.md) §11.8. Money path:
[`info/llm-billing-control-design.md`](info/llm-billing-control-design.md) §2.4
row **E7**.

**What landed:** `apps/discord-worker/src/gabi-groq.ts` — a first-line rung in
front of the pinned Haiku on the **four TOOLLESS** call sites (classification,
small talk, memory distill, T2 fix parse). ⚠️ The tool loop is **out of scope by
construction** — the Anthropic↔OpenAI tool-schema translation is phase 2, and a
build-failing test keeps a tool turn off `api.groq.com` in every posture. Model
pinned `llama-3.3-70b-versatile` (black_bot_baf's own choice); one attempt, 4 s
timeout, eight failure reasons, every one of them an **invisible** fall-through
to the unchanged Haiku call. 44 new tests, workspace 2247 pass / 0 fail.

### 🔴 THE OWNER'S FIVE REMAINING STEPS, in order

1. **Mint a Groq key** at `console.groq.com`. ⚠️ A new key — not an Anthropic
   one, and not the other project's, so this spend is separately auditable.
2. **Paste it into the FILE** — `apps/discord-worker/.dev.vars`, after
   `GROQ_API_KEY_GABI=`, with an editor. Never onto a terminal line, where it
   lands in shell history.
3. **Push it with the script** (⚠️ **THE BOM-FREE RITUAL — this is the whole
   point of step 3**), from the repo root:

   ```bash
   node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI
   ```

   ⚠️ **NEVER `$value | npx wrangler secret put`.** A PowerShell pipe to a
   native process prepends an invisible UTF-8 BOM (`EF BB BF`); the stored key
   is then wrong **while looking perfect everywhere a human can check it**, and
   fails as a plain 401. That is exactly how `ANTHROPIC_API_KEY_GABI` was
   broken on 2026-08-18 (GABI heard every mention and answered none), and its
   first "fix" — `$OutputEncoding` + trim — was **measured not to work** and is
   revoked as ritual. See [`access/agent-board.md`](access/agent-board.md) §3
   and [`access/discord-bot.md`](access/discord-bot.md) §7.

   The script reads the one named line out of `.dev.vars`, **prints the byte
   facts and never the value** (length, first three bytes — a BOM is
   `239 187 191` — and the last byte), writes raw bytes to `wrangler`'s stdin
   from Node where no encoder can add a BOM, refuses a value that already
   carries a BOM, and **blanks the `.dev.vars` line afterwards**. Confirm:
   `curl -s https://discord.heygabi.ai/api/health | jq '.configured.groq_key_gabi'`
   → `true`.

4. **Flip SHADOW, deploy, and read the lines.** `GABI_GROQ = "shadow"` in
   `apps/discord-worker/wrangler.toml`, `npx wrangler deploy`. Nothing a person
   sees changes — Groq is called beside Haiku and ⚠️ **Haiku's answer is used.**
   @mention GABI a few times, then:

   ```bash
   npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq_shadow")'
   ```

   Look for `agreed: true` on nearly every `classify` line, `groq_answered:
   true` on nearly all of them, and `groq_ms` below `haiku_ms`. A wall of
   `reason: "refused"` / `status: 401` means **a BOM'd key** — redo step 3.
   `status: 400` naming a decommission means the pinned model was retired.

5. **Flip `first`** once the shadow lines look right, and talk to her. ⚠️ Prose
   quality is **not** readable off the shadow lines (they carry lengths, never
   text — these are household conversations). Backing out is one line:
   `GABI_GROQ = "off"` and deploy, or delete the secret and skip the deploy.

### 🔴 NOT VERIFIED — no live Groq call has ever been made from this repo

Every test drives an injected `fetch`. Whether Groq accepts this body, whether
`llama-3.3-70b-versatile` is still a live id, whether the answers are good
enough, and what the savings actually are (⚠️ the tool loop — the expensive
half — is excluded) are all unknown until step 4.

### ☐ Phase 2 — the tool-schema translation

Not started, and not a "small addition": `tool_use`/`tool_result` ↔
`tool_calls`/`role: "tool"`, preserving every invariant `converseWithTools`'s
header records (all results for one turn in ONE user message; a failed tool
comes back `is_error` rather than dropped; the last pass sends no tools; the
dangling-colon guard against the 2026-08-18 silent partial). ⚠️ This is where
most of the tokens are, so it is where the actual savings live. Open-weights
tool-calling accuracy is the real question and the shadow ladder cannot answer
it without executing tools twice.

## ☐ GABI personality intensity — snark/flirt dial up (owner ask 2026-09-01)

Owner: *"Gabi can be a bit more into her personality, she can be a bit snarkier
or a bit more flirty. this is a private server so we can be a bit mean to my
friends. let her really sell the personality. Think of Grok from X in its all
go mode. have it really lean into stuff she's ingested from the books to build
out those personalities."*

✅ **BUILT AND DEPLOYED 2026-09-01.** `GABI_EDGE` (`standard` | `full`, fail
closed, ships **`full`**) in `apps/discord-worker/wrangler.toml`; the block
lives in `src/gabi-prompt.ts` beside the canonical prompt and is appended
BETWEEN memory and the persona block, so the PG-13 register clause and the
invariance clause stay last. `/api/health` reports `gabi_edge`. Tests:
`test/gabi-edge.test.ts` (18), including a literal pin of the whole pre-dial
prompt so `standard` is byte-identical. Operating it and the floor:
[`access/gabi-personality.md`](access/gabi-personality.md) §9; design:
[`info/gabi-personality-design.md`](info/gabi-personality-design.md) §11.

⚠️ **REMAINING — what is NOT done:**

1. **The owner has to HEAR the difference.** Nobody has talked to her at
   `full`; a test over a prompt proves the instruction is present, never that
   it is obeyed. Turning her down is `GABI_EDGE = "standard"` plus a deploy.
2. ⚠️ **The Groq shadow rung now renders this same prompt and its voice at
   `full` is UNMEASURED** — the shadow lines carry lengths and latencies and
   deliberately never texts, so nothing in them can show how a 70B
   open-weights model handles a roast licence. That needs `first`.
3. **The library panel does NOT have it, by design, and the step is
   library-side.** Phase 3's unification is a COPIED prompt with a comment
   naming its source (`library_catalog/packages/research/src/gabi.ts` →
   `GABI_SYSTEM`), not a shared package. This change did not touch the copied
   core — the byte pin proves it — so the copy is still in sync. Giving the
   panel the dial means appending its own `GABI_EDGE_FULL` there with its own
   posture, and that is an OWNER decision, not a sync: the panel's audience is
   not this private server's audience.

## 🔄 BUILD PROGRAM 2026-09-02 (owner: "list me and then build the remaining features. nothing else needs to wait unless it has a dependency")

19 features fanned out in repo-sequenced waves (Opus builds, Fable conducting).
Wave 1 in flight: Groq phase-2 tool translation (platform) · library quick
wins (scroll-to-top, Signed toggle, research transparency) · audiobook batch
(say-2, also-on-audio fix, poll-announce toggle, supplements armed
disambiguated) · games (deploy guards then disposal/copy-history). Waves 2–4:
player phase 2, Discord fun menu, billing phase 0+1, universes +, OR-1,
format toggle, Wandering Inn, cross-links, newest-authors. Where a TODO said
"ask first", the recorded recommendation is being built and flagged vetoable
at landing (owner's nothing-waits order). ⚠️ GENUINELY WAITING: shelf
ebooks-dropdown + reader-port (the one ebook-gate-vs-Access decision),
library-panel personality dial, second instance/federation (owner-deferred).

## ☐ Prune the `C:/lcw/` worktrees (leftover from the 2026-08-23→24 overnight run)

~15 worktrees from the night's branches. The merged ones can go at leisure;
check `git worktree list` from each repo before deleting anything unmerged.

## ☐ OWNER DECISION — details-sweep cron cadence (standing offer, 2026-08-24)

The library details-sweep now honestly heals **1 book/tick** (was silently
over-budget at 2 and dying mid-second-book). Raise the cron frequency if you
want the old rate; do NOT raise the per-tick budget (it must stay under the
50-subrequest ceiling).

## ☐ Follow-up (unverified since 2026-08-24): `library_catalog/scripts/research-queue.mjs` schema drift

Carried out of the retired morning summary because nothing else tracks it: its
in-memory mirror omits `work_alias` (0410) + `change_log`, and `makeShim.batch`
is non-atomic (a partial write occurred). Add both tables to MIRRORED + make
batch atomic before using the script again. ⚠️ **Not re-verified on
2026-08-31** — if it was fixed since, close this against the commit.

## ☐ BUG (not urgent, owner 2026-08-24) — ebook "also on audio" button resolves to nothing

Some books in the ebooks library show an "also on audio" affordance, but there is
no matching audiobook, so the link/button dead-ends. The ebook→audiobook match is
stale or over-eager (shows the button when no live audio edition exists). Fix:
only surface "also on audio" when a real matching audiobook resolves; otherwise
hide it. **Locate exact surface first** — likely audiobook_catalog `site/ebooks.html`
(the recent "N audiobooks" ebook-count work) or the library work-page audio cross-link.
Land for review. Candidate for a Fable/subagent build once located.

---

## ☐ Secrets review follow-ups (from `info/secrets-review-2026-08-26.md`)

> The three decided/done owner items (keys stay in OneDrive; `ESTATE_EVENTS_TOKEN`
> set + verified; 1Password adopted — vault `Estate` is the master, steps 1+2
> done, four console keys verified live and old ones revoked by the owner) moved
> WHOLE to [`DONE.md`](DONE.md) on 2026-08-31. What remains open is steps 3 and
> 4 below, plus the two master-less secrets tracked in
> `library_catalog/docs/TODO.md` (*"Custody gaps"*).

## ☐ STEP 3 of the 1Password adoption — 1 of 4 pairs DONE, 3 REFUSED for want of a probe (2026-08-26)

`scripts/op-rotate-pair.mjs` mints a fresh value into the vault and sets it on
BOTH holders in one run, verifier first, stopping at the first failure.
`--list` prints the four and their probe status.

### ✅ `INDEX_READ_TOKEN_LIBRARY2` — ROTATED AND PROVED, 2026-08-26

Vault item `library2.INDEX_READ_TOKEN`; `catalog-index` (verifier) and
library-catalog-friend (presenter) both set in one run. **Handshake proved
directly**: `GET index.heygabi.ai/api/machine/lookup?title=…` with the new value
returns **200, 2 matching rows**, having returned 401 before the rotation. It had
**no readable master** before today (secrets review §3.1); it has one now.
padhard's secret NAME list re-measured after: **10**, unchanged.

⚠️ **What it does NOT prove:** that padhard is *sending* the new value on her own
traffic. Worker secrets are write-only, so the evidence there is that wrangler
accepted the write and the name is still listed. The VERIFIER half is proved.

### 🔴 The other three are REFUSED, and that is a guard, not an omission

```
ESTATE_APP_TOKEN_LIBRARY2    estate-auth      ↔ library-catalog-friend
ESTATE_APP_TOKEN_AUDIOBOOK   estate-auth      ↔ audiobook-worker
ESTATE_APP_TOKEN_BOOKS       audiobook-worker ↔ estate-discord
```

**None has a live handshake a script can run**, and the script refuses a pair
that has none **before minting anything**:

| Pair | Why no probe |
|---|---|
| `ESTATE_APP_TOKEN_LIBRARY2` | `POST /api/estate/seen` needs the app token **and a real signed-in identity**, and it WRITES a seen record. `GET /api/estate/health` is open but exercises no app token at all (`apps/auth-worker/src/estate.ts:647` — counts and a version) |
| `ESTATE_APP_TOKEN_AUDIOBOOK` | Only reached from the ebook gate and `/api/me` (`apps/audiobook-worker/src/estate-status.ts:74`), both of which need a signed-in identity. `/api/health` reports the estate-check MODE, not whether the pair authenticates |
| `ESTATE_APP_TOKEN_BOOKS` | Needs the token **plus** `X-Estate-On-Behalf-Of` naming a linked Discord asker (`apps/audiobook-worker/src/book-routes.ts:35,126`). ⚠️ Fabricating an on-behalf identity to test a token is asserting an identity to a live gate, which is not a probe |

⚠️ **Why refusing is right.** A half-applied pair raises no error anywhere: the
verifier stops recognising the presenter and the result is a silent 401/403/404
on a route nobody is watching. Rotating with no way to observe the new pair
agreeing is shipping that state and hoping — and the one pair that WAS rotated
today proves the point twice over (see the propagation note below).

**Two ways forward, either is fine:**
1. **Give each a read-only self-check route** — an endpoint on the VERIFIER that
   answers "does this bearer authenticate, and as which app?" without touching a
   human identity or writing anything. That is exactly what
   `/api/machine/lookup` already is for the index, which is why that pair could
   be done. One small route per Worker unblocks all three permanently.
2. **Do them by hand with the owner watching the surface each feeds** — sign in
   on padhard; open an ebook; ask GABI a book question in Discord. Slower, and it
   needs him present, but it needs no new code.

### ⚠️ The gotcha this run bought, worth more than the rotation

**A Cloudflare secret change is not live the instant `wrangler` returns.** The
first run set the verifier, probed immediately, got **401**, and correctly
stopped with the pair half-applied — padhard's rung 2 was down for the couple of
minutes it took to resume. The value was fine; the *edge* had not caught up. The
script now **retries the handshake with backoff (2s, 4s, 8s, 15s)** before
declaring failure, because a false negative there is itself an outage.

⚠️ **And "just re-run it" was NOT a safe retry**, which is the sharper half:
re-running would have minted a SECOND value and created a DUPLICATE vault item
under the same title — two masters for one secret. Hence `--resume`, which takes
the value from the vault item the failed run already created. **Any script that
mints into a vault and then does something fallible needs a resume path**, or its
own error message tells you to corrupt your custody store.

**This is the step that actually changes the recovery story** (secrets review
§5's own words), and it is the only one of the four that **mints new values and
touches live estate-internal pairs**. It was scoped, not executed. Four pairs,
each a `crypto.randomBytes(32).toString('hex')` minted inside a script, stored as
a vault item, then pushed to **both holders in the same run**, then proved by the
handshake that only agreeing sides can pass:

| Pair | Holder A (verifier) | Holder B | The proof it worked |
|---|---|---|---|
| `ESTATE_APP_TOKEN_LIBRARY2` | `estate-auth` | library **friend** (padhard) | `POST /api/estate/seen` accepted; padhard's health line |
| `ESTATE_APP_TOKEN_AUDIOBOOK` | `estate-auth` | `audiobook-worker` | the `/api/estate/…` health path |
| `ESTATE_APP_TOKEN_BOOKS` | `audiobook-worker` | `estate-discord` | `/api/books/*` on a linked asker's behalf |
| `INDEX_READ_TOKEN_LIBRARY2` | `catalog-index` | library friend's `INDEX_READ_TOKEN` | the index machine lookup returns rows for that app |

⚠️ **ONE PAIR AT A TIME, verify, then the next — stop at the first failure.** A
half-pushed pair does not error; it goes silently 401/403/404 and reads exactly
like a code bug. Verifier first for all four (they are inbound-verified).

**Deliberately OUT of scope — the owner re-mints these into the vault himself,
because each is a console he holds and a session should not:**
`ANTHROPIC_*`, `CLOUDFLARE_API_TOKEN`, `CATALOG_PLATFORM_TOKEN`,
`TOKEN_SIGNER_KEY` (GCP `estate-token-minter`), and `SHELF_PARITY_TOKEN` —
⚠️ the last is **RETIRE, not rotate** (superseded by the KV-hashed self-service
key since 2026-08-20).

## ☐ 🔴 STEP 4 of the 1Password adoption — `audiobook_catalog/.env` — NOT DONE, estimate only (2026-08-26)

Deliberately not attempted. The estimate, from the secrets review's own §2.6
inventory (names only; the file was **not** opened by this work):

- **~30 keys**, split **14 credentials / 16 config-and-identifiers**. Each one
  needs the config-vs-credential call made by hand — `R2_ACCOUNT_ID` and
  `ABS_BASE_URL` are identifiers, `R2_SECRET_ACCESS_KEY` and `ABS_PASSWORD` are
  not, and only a human reading the file can finish that sort.
- ⚠️ **The key count is a FLOOR, not a census.** `Claude-llm` is hyphenated and
  mixed-case, so the `^[A-Z_]+=` grep that produced the list cannot see it
  (§3.1). Any real census must use the `sed 's/=.*/=<REDACTED>/'` form.
- ⚠️ **Four files are not `NAME=value` at all and need DOCUMENT-type vault
  items, not password items:** `scripts/firebase_service_account.json` and
  `docs/access/keys/firebase-sa-restore.json` (⚠️ **two DIFFERENT keys on the
  same service account** — revoking one does not revoke the other), plus
  `scripts/token.json` and `scripts/credentials.json` (the estate's Drive OAuth
  token and its client secret). `op document create` is a different code path
  from everything built for steps 1–2.
- **Reusable as-is:** the importer (`--keys-dir` already handles one-value-per-
  file), the title convention, the idempotent create/update, the glued-value
  guard. **Needed new:** an `.env`-shaped template + the document-item path.
- ⚠️ **A concurrent agent was working in that repo** when steps 1–2 ran, which
  is a second reason it was left alone.
- **Rough size:** the 30 `NAME=` keys are a short sitting once the config/credential
  sort is made; the four JSON documents are the real work.

## ☐ DESIGNED — two still unbuilt, one BUILT 2026-09-01

Items 1 and 2 are **DESIGN ONLY**: nothing was built, no route exists, no
migration was applied. Each doc carries its own phases, effort guesses and open
questions. Item 0 was built on 2026-09-01 and has moved to
[`DONE.md`](DONE.md); only its live round trip remains.

### 0. ✅ BUILT 2026-09-01 — soft pauses + recurring blockers + do-not-disturb
The whole item moved to [`DONE.md`](DONE.md) (*"2026-09-01 — soft pauses,
recurring blockers and the do-not-disturb list, BUILT in both repos"*). Both
halves are live: reader `audiobook_catalog` **76aa89b** (merged 36a0f21),
platform **d752d93**. What is left open is the part no build can do
for itself:

- ☐ **The live round trip has never been run, and no human has clicked the
  card.** Set a soft pause with the GPU busy and read the worded refusal; free
  the GPU and watch the processor release it; add a 5-minute recurring blocker
  and watch it bite and lapse; add `Wow.exe` from the card and confirm a start
  is refused while the game runs. Needs the owner signed in at
  <https://heygabi.ai/status/pipelines/> — the routes require a devops token
  no session holds, and fabricating one against a live gate is not a test.
  ⚠️ This also finally pays the standing *"the signed-in card has never been
  rendered by a human"* debt (`info/ingestion-pause-controls.md` §6).
- ☐ **`WowClassic.exe` is unverified.** `Wow.exe` was read off `tasklist` while
  the game ran (2026-09-01); the classic-client name was not. If he plays
  Classic, check the real image name before trusting the suggestion.

### 1. Toggle what can bill the LLM — `docs/info/llm-billing-control-design.md`
Mockup (private artifact): https://claude.ai/code/artifact/2f288c59-d6ca-4fdf-b3e0-da732f0e78d1
Owner: *"we need a way to toggle what can bill the LLM and what can't inside the
admin page somewhere. and even finer than that, i want to be able to determine
which features can bill and which can't per site per user etc"*

- ⚠️ **36 money-spending code paths inventoried** across the four repos, each with
  today's gate cited (library 13 — deployed twice; games 7; audiobook 9;
  platform 7). §2 of the doc is the inventory. ⚠️ **E7 was added 2026-09-01** —
  GABI's Groq first line, and it is the first path in this estate that bills a
  provider OTHER than Anthropic. Its posture ships `off`.
- ☐ **OWNER DECISION Q1:** may policy GRANT, or only DENY? Recommendation: deny-only.
- ☐ **OWNER DECISION Q2:** the `system` (cron) principal vs games'
  `SWEEP_LIMIT` "a knob nobody tunes hides its value" intent. Recommendation:
  on/off switch only, no numeric budgets in v1.
- ✅ **Q3 ANSWERED BY DOING IT — A3 IS GATED AND DEPLOYED 2026-08-26.**
  `audiobook_catalog/site/user-warnings.js:102` was a **public, no-sign-in
  button** queueing work the hourly `cw-fulfill.yml` pays Anthropic for.
  `cw_requests` (+ `_dev`) now read
  `allow create, update: if request.auth != null && validCwRequest()` —
  `request.auth` only, the same mechanism `/readingLists` uses, **not** a new
  one (a `site_roles` check was refused: it holds admin/moderator only and
  would lock out the household). ⚠️ `allow delete: if true` **and**
  `allow read: if true` are untouched and load-bearing — the fulfiller lists
  and clears with the *public web API key* and no account, which is why
  create/update were split out rather than `write` tightened. Signed-out
  readers now see *"Sign in to request a content warning."* instead of a dead
  button, keyed on the LIVE uid (a legacy passphrase session has a display name
  and no `request.auth`). Rules deployed; `scripts/smoke_cw_request_rules.py`
  **9/9 against live**; vitest 781. ⚠️ **NOT verified:** nobody has seen the
  sentence rendered. (The static site HAS been republished since — the pipeline
  auto-committed `site/` on 2026-08-27+ — so the fix should now be live on the
  page, but no one has looked.)
- ☐ Phase 0 is worth doing alone: the feature registry + three refusal defects
  found while reading (see §6.1).
  - ✅ **The three refusal defects are FIXED 2026-08-26**, each with a tripwire —
    `Board_Game_Catalog` `93fad25` (defects 1 + 3) and `library_catalog` `06a2bfb`
    (defect 2). ⚠️ **None of the three was in this repo.** ✅ **Both commits are
    now DEPLOYED** (corrected 2026-08-31; the line here previously said neither
    was): games deployed `93fad25` as version `a34971db` on 2026-08-26 ~17:27
    Phoenix (recorded in that repo's TODO — it still has no deploys.log, which
    is its own open item there), and the library deployed `06a2bfb` to main
    (`d7321ebe`) + friend (`1813565d`) on 2026-08-27 00:26Z per its
    `deploys.log`. §6.1 carries the table and the two lessons. The **feature
    registry** half of Phase 0 is still ☐ unbuilt.

### 2. "+ Add a verse" on /universes — `docs/info/universe-add-verse-design.md`
Mockup (private artifact): https://claude.ai/code/artifact/d1cfd9d1-2b7c-458a-8c66-5b5dc7e78384
Owner: *"in the universe page add a plus button somewhere to add a verse and let
it take series as an input"*

- ⚠️ A direct "add" **cannot write** — a universe is compiled into two catalogs
  and pinned by `library_catalog/packages/core/test/universes.test.ts:347`, and
  `tools/universes.mjs:126` refuses to create one. The "+" creates a PENDING
  request; the owner approves; a session prepares the commit; the owner deploys.
- ☐ **OWNER DECISION Q1:** should `tools/universes.mjs` grow a `create` command?
  Recommendation: yes, with `--why` **and** `--confirmed` both required — stricter
  than the hand edits that have happened 11 times already.
- ✅ **The two live discrepancies are FIXED 2026-08-26** — moved whole to
  [`DONE.md`](DONE.md). The design itself is still ☐ unbuilt.
