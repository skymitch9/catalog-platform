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

## ☐ DESIGNED, NOT BUILT (owner asks 2026-08-24) — two designs landed 2026-08-26

Both are **DESIGN ONLY**. Nothing was built, no route exists, no migration was
applied. Each doc carries its own phases, effort guesses and open questions.

### 1. Toggle what can bill the LLM — `docs/info/llm-billing-control-design.md`
Mockup (private artifact): https://claude.ai/code/artifact/2f288c59-d6ca-4fdf-b3e0-da732f0e78d1
Owner: *"we need a way to toggle what can bill the LLM and what can't inside the
admin page somewhere. and even finer than that, i want to be able to determine
which features can bill and which can't per site per user etc"*

- ⚠️ **35 money-spending code paths inventoried** across the four repos, each with
  today's gate cited (library 13 — deployed twice; games 7; audiobook 9;
  platform 6). §2 of the doc is the inventory.
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
