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
small talk, memory distill, T2 fix parse). Model pinned
`llama-3.3-70b-versatile` (black_bot_baf's own choice); one attempt, 4 s
timeout, eight failure reasons, every one of them an **invisible** fall-through
to the unchanged Haiku call. 44 new tests, workspace 2247 pass / 0 fail.

⚠️ **SUPERSEDED IN PART, 2026-09-02.** The tool loop was *"out of scope by
construction"* above; **phase 2 shipped and it is not any more** — a tool loop
whose every tool is read-only now rides Groq first under the same
`GABI_GROQ = "first"`. The pin also moved to `openai/gpt-oss-120b`. Both are
recorded in [`DONE.md`](DONE.md) and [`info/gabi-groq-rung.md`](info/gabi-groq-rung.md);
the paragraph above is left as written because it is the record of what phase 1
decided, not a claim about today. ⚠️ **The five owner steps below are also
stale — all five were done on 2026-09-01** (key pushed byte-verified, `shadow`
read, `first` flipped and verified on the wire). They are NOT swept here because
that is this item's own close-out, and nobody has re-verified each step; the
next session that touches this item should move it whole.

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
player phase 2, ~~Discord fun menu~~, billing phase 0+1, ~~universes +~~, OR-1,
format toggle, Wandering Inn, cross-links, newest-authors.

✅ **The Discord fun menu LANDED 2026-09-02 and moved WHOLE to
[`DONE.md`](DONE.md)** (*"THE DISCORD FUN MENU: five commands live, two dark,
one toggle honoured"*). ⚠️ **Two owner steps remain open and are tracked as
their own items below** — the registration re-run, without which none of the
five new commands is visible in any Discord server, and the
`GABI_CLUB_WRITES` verification checklist. Neither is a build step, which is
why they are here rather than in the archive. Where a TODO said
"ask first", the recorded recommendation is being built and flagged vetoable
at landing (owner's nothing-waits order). SETTLED 2026-09-02 by owner: **"yes
everyone on the shelf list can have the ebooks"** — the ebook gate question is
answered: Cloudflare Access (family allowlist) is a lawful second door for the
ebook FILES on the shelf. Unblocks the shelf cluster (second ABS library on an
ebooks-only hardlink shadow tree per option A in audiobook TODO, ebooks
dropdown, reader via ABS's native reader or the port item as its docs record,
shelf_book_map + "Open on shelf" button — ONE canonical catalog→ABS join per
the recorded warning). ⚠️ Scope limit: this does NOT make ebook titles public
anywhere (the no-ebook-chip directive on public pages stands) and does NOT
retire the estate site's vis_ebooks/download_ebooks gate — two doors coexist.
Queued in the audiobook-repo wave lane behind player phase 2. SETTLED 2026-09-02 by owner:
**library panel gets full GABI edge, matching Discord** ("library panel should
match gabi in discord no matter what. same experience different entry point")
— queued wave 2 (library tree busy; panel prompt lives at
`library_catalog/packages/research/src/gabi.ts` → append its GABI_EDGE_FULL +
the NEVER-SOUND-PREWRITTEN section, keep the copied-core byte pin honest).
Second board-game instance STAYS deferred (owner 2026-09-02: "no use case yet").

## ☐ 🔴 OWNER STEP — re-run the slash-command registration, or the fun menu is INVISIBLE

The five new commands (`/recent`, `/universe`, `/review`, `/suggest`,
`/guessgame`) are **deployed and answering**, and **nobody can see them**:
Discord shows exactly the list an application PUTs, and that PUT has not been
made since they were added. One call, and it needs an estate **admin** Firebase
ID token, which no session holds:

```
POST https://discord.heygabi.ai/admin/commands/register
Authorization: Bearer <admin Firebase ID token>
```

Getting a token: sign in on any estate page and run
`await (await import('/assets/estate-auth.js')).idToken()` in the console.
Full ritual and the two-switch registry:
[`access/discord-bot.md`](access/discord-bot.md) §15.2 and §4. Global commands
can take up to an hour to appear the first time.

⚠️ **Until this runs, "the fun menu is live" is a fact about the Worker and not
about Discord** — and the honest way to say so is that it is deployed, not that
it is usable.

## ☐ 🔴 OWNER/SESSION STEP — verify `CLUB_WRITE_SHAPES` before `GABI_CLUB_WRITES` is ever flipped

`/rsvp` and `/progress` are built, tested and **dark** (`GABI_CLUB_WRITES =
"off"`). The blocker is a **measurement, not caution**: the field names inside
an RSVP and a progress document live in `audiobook_catalog/site/`, which the
build was directed not to read, and this Worker's service account **bypasses
`firestore.rules`** — so a wrongly shaped write is not refused, it **succeeds**,
and the club page then shows nothing with no error anywhere.

The checklist is [`access/discord-bot.md`](access/discord-bot.md) §15.3, in
order: read `site/club-meetings.js` / `site/club-reads.js` + `firestore.rules`
→ correct `CLUB_WRITE_SHAPES` in `apps/discord-worker/src/club-write.ts` (one
block, `deepEqual`-pinned by `test/club-write.test.ts`, so update the pin in the
same commit) → flip `club_write_shapes_verified` in `/api/health` → flip the
posture and deploy → re-run registration → opt a club in with
`features.meetingRsvp = true` → **exercise it and then look at the club PAGE**,
because the Discord side saying "recorded" is not the evidence.

⚠️ A concurrent agent was working in `audiobook_catalog` on 2026-09-02, which is
the second reason it was left alone.

## ☐ OWNER DECISION — upgrade the Groq plan? (2026-09-02)

🔴 **The 413 wall the owner met is the FREE TIER, not a bug.** Groq allows
`openai/gpt-oss-120b` **8,000 tokens per minute** on the free plan and refuses a
single request bigger than that with `413` rather than queueing it — which is
the instant ~37 ms refusal he measured. The request was **~7,960 tokens before
his question**.

The code side is done (lean schemas cut the tool payload 54%, the full 13-tool
request now fits with ~1,500 tokens to spare, and a pre-flight refuses to send a
doomed one). But a three-pass tool loop still spends several thousand tokens a
minute, so on the free plan a busy turn will meet `429`s where it used to meet
`413`s.

**Upgrading to Groq's Developer plan turns every mitigation into headroom.**
Nothing breaks if he does not — the ladder falls back to Haiku invisibly, which
is what it did all through the live test. Measurement + arithmetic:
[`info/gabi-groq-rung.md`](info/gabi-groq-rung.md) §11.

## ☐ OWNER DECISION — `/progress percent` has no destination field (2026-09-02)

The club-write shapes were finally MEASURED against `audiobook_catalog/site`
(read-only) and **four of the seven inferred names were wrong** — corrected in
commit `ee688ad`, with the evidence table in `src/club-write.ts`.

⚠️ **`GABI_CLUB_WRITES` stays `off`, and the remaining blocker is a design
question rather than a constant.** The club page tracks a **milestone position**
or a **chapter index**, both numbers; there is no percentage field anywhere in
it. A percentage is not a milestone index and not a chapter number, so
converting one to the other would be inventing a value. `/progress percent` is
now refused in words instead of written into a document nothing reads.

**The question:** should `/progress` drop `percent` and take a chapter only, or
also learn `milestonePosition` (which needs the read's milestone list to mean
anything)? Answer that, then the flip checklist in
[`access/discord-bot.md`](access/discord-bot.md) §15 is the rest.

⚠️ Flipping it is **access-increasing on somebody else's live page** — this
Worker's service account bypasses `firestore.rules`, so a wrong shape SUCCEEDS
silently. It gets confirmed, never assumed.
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

## ☐ DESIGNED — one still unbuilt, two BUILT (0 on 2026-09-01, 1 on 2026-09-02)

⚠️ **Item 1 is NO LONGER design-only, and this heading said it was until
2026-09-02.** Its phases 0–2 are built, migrated and deployed; only **item 2**
still has no route and no migration. Each doc carries its own phases, effort
guesses and open questions. Item 0 was built on 2026-09-01 and has moved to
[`DONE.md`](DONE.md); only its live round trip remains — and item 1 is in
exactly the same shape, waiting on a human to press its switch once.

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

### 1. Toggle what can bill the LLM — 🔄 PHASES 0–2 BUILT + DEPLOYED 2026-09-02
Design of record: [`info/llm-billing-control-design.md`](info/llm-billing-control-design.md).
What landed moved WHOLE to [`DONE.md`](DONE.md) (*"LLM billing control — phases
0, 1, 2 and (this repo's half of) 3"*). Panel:
<https://heygabi.ai/admin/> → **"Spending — what may bill the model, and where"**.
Mockup (private artifact): https://claude.ai/code/artifact/2f288c59-d6ca-4fdf-b3e0-da732f0e78d1

🔴 **NOTHING IS SWITCHED OFF TODAY, and nothing can be until somebody presses
a switch.** The `billing_policy` table is EMPTY (an empty table is exactly
today's behaviour), and `BILLING_POLICY` ships `"off"` on the one consumer
that reads the answer. Both were deployed that way on purpose.

- ✅ **OWNER DECISION Q1 — deny-only. BUILT.** Not a convention: the resolver's
  only output is a set of DENIED ids and every call site ANDs it with the gate
  it already had, so there is no code path where a policy row opens anything.
  ⚠️ **Vetoable** — if the owner wants per-person GRANTS, that is a role-ladder
  change on the site that owns the ladder, not a change here.
- ✅ **OWNER DECISION Q2 — on/off switches only, no numeric budgets. BUILT.**
  `SWEEP_LIMIT` stays hard-coded. ⚠️ **Vetoable.**
- ✅ **Q3 — A3's public button was gated 2026-08-26**, ahead of the plan.

### 🔴 WHAT IS LEFT, in the order it can be done

1. 🔴 **NOBODY HAS RENDERED THE PANEL SIGNED IN.** No cell has been clicked, no
   rule has ever been written, and the matrix has never been drawn against a
   real `/api/estate/billing/rules` answer. There is no browser test harness
   for `admin.js`; `check:home` proves it parses and nothing more. ⚠️ **This is
   the first step and it needs the owner** — an approver token no session
   holds. Sign in at <https://heygabi.ai/admin/>, open **Spending**, switch one
   cheap cell off with a `why`, save, reload, and switch it back on. That one
   round trip is what turns "deployed" into "works".
2. ☐ **Phase 2b — the per-member drawer** (§7.2): a **Spending** column on the
   existing `perm-grid`, staged into the card's one Save. The matrix is the
   per-SITE axis; this is the per-PERSON one. The resolver and the write door
   already take `user` and `role` principals — only the UI is missing.
3. ☐ 🔴 **OWNER STEP — the Discord Worker cannot be wired without a secret.**
   E1–E5 and E7 are on the design's call-site list, but `estate-auth`
   **cannot identify** that Worker: `identifyApp` resolves a caller by token
   VALUE against `CONSUMER_APPS`, and it holds no Discord token. Wiring it
   means minting one and setting it on both Workers — and ⚠️ adding `discord`
   to `CONSUMER_APPS` would ALSO make that bearer a valid `/seen` bearer,
   which `test/dev-access.test.ts` explicitly guards against as *"a capability
   nobody granted it"*. Access-increasing, so it is confirmed, never assumed.
   Until then GABI's spend has no switch.
4. ☐ **Phase 3 for the other three repos** — `library`, `library2` and `games`
   read `billing_denied` off `/seen` (the shared client already sends
   `local_role` and parses the field); the audiobook Python paths need the
   phase-5 client. Each is a separate repo and a separate deploy.
5. ☐ **Phase 4 — the soak, then `enforce` ONE SITE AT A TIME.** Flip
   `BILLING_POLICY = "shadow"` first and read the lines:
   `npx wrangler tail catalog-index --format json | jq 'select(.evt=="billing_policy")'`.
   ⚠️ The flip criterion is §4.2's and it has TWO halves: zero `would_deny:true`
   on anything the owner did not switch off, **AND at least one
   `would_deny:true` on something he DID**. Without the second, "zero denials"
   is indistinguishable from "the instrument never ran" — the exact
   `0 of 0 — unmeasured, not clean` verdict the audiobook auth soak reached.
6. ☐ **Phase 5 — the audiobook Python paths (A1–A9).** A small policy client
   (one HTTPS GET on the app token, cached to a file, 10-minute TTL) plus the
   `--no-llm` wiring. The hard one: no estate client exists on that side.

⚠️ **One finding from the build, worth keeping:** the design's §3.2 table
double-covers L9 and L10 (`research.covers` + `cli.backfill`;
`research.isbn` + `cli.backfill`). Reproduced VERBATIM rather than tidied —
policy can only deny, so a path under two switches is refused if either
denies, which fails safe. A test pins the list of double covers so a NEW one
has to be argued for.

### 2. "+ Add a verse" — ⚠️ BUILT, NOT DEPLOYED — `docs/info/universe-add-verse-design.md`
Phases 0–3 landed 2026-09-02 and are archived whole in [`DONE.md`](DONE.md).
What is left is a **deploy in a fixed order** and one unbuilt phase.

🔴 **THE ORDER IS NOT OPTIONAL, and the page is LAST.** The page's "+" calls
`auth.heygabi.ai`; deploying it first means a member presses a button that
reports an outage. And the Worker's routes need the table, so the migration goes
before the Worker — the estate's own migrate-before-deploy rule, which exists so
new code never meets an old schema.

1. ☐ **Apply migration `0017_universe_requests.sql` to remote `estate_auth`** —
   `cd apps/auth-worker && npm run db:migrate`. Purely additive (one
   `CREATE TABLE IF NOT EXISTS` on a new object plus its index), so it is safe to
   apply ahead of the Worker and unattended, the same property 0012–0016 had.
2. ☐ **Deploy `estate-auth`** — from a clean tree or a throwaway
   `git worktree add <tmp> HEAD`. Adds five routes and three CORS mounts; the
   only change to an existing surface is none.
3. ☐ **Deploy `heygabi-home`** — `npm run deploy:home` (runs `npm test` and
   `check:home` first). ⚠️ A directory upload ships the WORKING TREE, not a
   commit — [`info/worktree-deploys.md`](info/worktree-deploys.md).
4. ☐ **Then verify LIVE, signed in**, because none of it has been: the "+"
   renders on <https://heygabi.ai/universes/>, a request lands, and
   <https://heygabi.ai/admin> shows it under "Verse requests". Nothing below the
   build was exercised against a browser or a real D1 — the tests use a fake.
5. ☐ **Phase 4 — notify on a decision** (~½ day, a labelled guess). Reuse
   `estate_prefs` / `notify-prefs.ts`. Unbuilt; it was never a recommendation,
   just a later phase.
6. ☐ **First real use closes its own loop:** after the JSON edit and both
   catalog rebuilds, `POST /api/estate/universes/requests/:id/landed { commit }`
   flips the row from `approved` to `landed`. Until somebody does that once, the
   fourth status is a claim this estate has not yet exercised.

⚠️ **Two recommendations were built as recommended and are VETOABLE** (§6 Q1's
`create` verb, gated by `--why` **and** `--confirmed`; §6 Q2's collapsed `/admin`
section rather than a tab). Both are reversible in one commit each; the reasoning
is in `DONE.md`.
