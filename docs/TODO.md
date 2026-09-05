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

## ☐ 🔴 BUILD — "Request a catalog" (the "+" on the heygabi.ai cards) (owner ask 2026-09-05 06:26 Phoenix)

Owner, verbatim: *"Remember that doc about requesting a board game or book site?
Time to build that."* — supersedes the 2026-08-24 constraint "ships only after
dev lanes + more testing".

**Finding: the design had NO repo home.** It existed only as (a) the private
artifact **"Request a Catalog"** — https://claude.ai/code/artifact/717169ac-af10-4b3a-9598-cf1f2ae38f11
(cyberpunk 6-step mockup, 2026-08-24, updated the same night with the sealed reader
key + owner-editable accept), and (b) two Opus research drafts written to a
scratchpad that no longer exists — recovered 2026-09-05 from the session-5154218d
transcript (agents `a33af8314947561ad` phase-1 flow/data model, `aefc2df1cbb203f17`
phase-2 provisioning + sealed-key). Both texts are now to be filed under
[`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) BEFORE code.

Owner decisions already given 2026-08-24 23:48Z: owner can **edit address/name
before approving**; the request form carries an **optional LLM key** field; the
key must be **sealed** so the owner cannot see it and it cannot leak; the owner
may also set a key at accept. Design answers on record: request row in the
auth-worker estate D1 (`catalog_requests`, statuses pending/accepted/declined/live/
cancelled); "+" shown only signed-in + owning zero catalogs; required confirm
step; Members-page banner + "Catalog requests" section (two-tap accept/decline);
**Accept never deploys** — it hands the owner a pre-filled provisioning runbook;
sealed-box key (WebCrypto → private R2 envelope → decrypted only inside the
owner-run provisioner → `wrangler secret put`), D1 holds booleans only.

Owner answers (asked ONE AT A TIME): (1) Games card too? — **"Both"** (2026-09-05
~06:50 Phoenix): the Games card gets the same "+" and flow. (2) Who may request? —
**"only approved people"** (2026-09-05 ~06:58 Phoenix): estate `status='approved'`
gate on the "+" AND server-side on submit. (3) Sealed key — **"Have it fall back to my
Claude key for now. Defer it until everything else is built then build it. I want
this all done today so the defer is until after the other bits build but not
forever"** (2026-09-05 ~07:03 Phoenix): v1 provisions with the OWNER's
`ANTHROPIC_API_KEY` (an explicit owner decision — it supersedes the drafts' "never
silently reuse the owner's key"); the sealed requester key is the LAST phase of
today's build, not dropped. (4) Back-seed — **"Yes back seed"** (2026-09-05 ~07:25
Phoenix): `library`, `padhard`, `boardgames` inserted as `live` rows by hand once
0018 is applied remotely (design §9 row 4 has the exact row shape). All four
questions answered; nothing open.

Plan: design doc → Opus build of the estate side (migration + API + `/admin`
section + home-card "+") → provisioning runbook/script → dev-lane test → live.
**Execution 2026-09-05 07:06 Phoenix:** five Opus agents dispatched in parallel —
A auth-worker (phases 1+2), B home "+" (3a+3b), C `/admin` (4), D books
provisioner (7, `library_catalog`), E games prerequisites (8, `Board_Game_Catalog`).
Then by hand: phase 6 back-seed; then phase 9 games path; then phase 5 sealed key LAST.

### ✅ Phase 6 — back-seed DONE by hand (main loop, 2026-09-05 07:31 Phoenix)

Three `live` rows in remote `estate_auth.catalog_request` — #1 `library` (books,
owner), #2 `padhard` (books, Samantha Hardman, instance `friend`), #3
`boardgames` (games, owner) — full shape in design §10 row 6. Read back: 3 rows.
⚠️ **The owner's primary account now sees NO "+" on either card** (he owns both
kinds). **To test the "+" he signs in as his second approved account** (`estate_user`
#87 `mitchlandtv@gmail.com`), which owns nothing and should see both.
NOT verified: the hide/show in a browser, signed in as each.

### ✅ Phase 7 — books provisioner BUILT, `--dry` only (agent D, 2026-09-05 ~07:35 Phoenix)

`library_catalog` `b84b39f` `scripts/provision-catalog.mjs` (12 idempotent steps, two
PAUSEs for the manual Firebase / auth-worker steps, 68 tests, 2418/0 suite) ·
`bce085e` runbook `docs/access/provision-catalog.md` · `4e0acc8` · here `51e0544`.
`--dry` exercised against the three REAL back-seeded rows (each refused correctly:
already live / already live / games → §8). **No real instance exists; nothing ran
past `--dry`** — the first real run is the owner's.

☐ **OWNER DECISION (asked 2026-09-05 07:37): instance naming.** The script splits
names by what can be renamed — host + env/Worker follow the person
(`amber.heygabi.ai`, `[env.amber]`, `library-catalog-amber`); D1, R2 bucket and the
estate app id are ORDINAL (`library-catalog-3rd`, `library-3rd-covers`, `library3`)
because those can never be renamed and the app id is a contract with the
auth-worker. Design §7.1 wanted everything identity-neutral; `--instance third`
gives that. Which? (a) split as built (b) all ordinal (c) all follow the person.

☐ **Pre-existing, found by agent A:** `GET /api/estate/me` answers unauthenticated
with a bare `{"error":"unauthenticated"}` and no `detail` (`apps/auth-worker/src/estate.ts:409`)
— the "never a bare status" rule broken on the most-read route. One-line fix; do it
after today's build lands (the home page and `/admin` both read this route).

### ✅ Phase 8 — games platform prerequisites LANDED + DEPLOYED (agent E, 2026-09-05 ~07:40 Phoenix)

`Board_Game_Catalog` `fc17ea3` `ESTATE_APP` wrangler var (default `games`) ·
`30dc045` same-id build guard `scripts/instance-guard.mjs` (tests seen to refuse) ·
`4db2f2e` `--env` twins `deploy:games2` / `db:migrate:games2` / `secrets:push:games2`
with the `PER_INSTANCE_SECRETS` refusal · `5ff223a` commented `[env.<instance>]`
template + drift guard, `docs/access/second-instance.md`, `docs/info/instance-model.md`
· `9c1dba6` corrects E's own stale "7403 migrations apply" claim · `a812252` deploy
line. Worker deployed `a349aee1-6437-44b2-9be4-a3185e09ba64`, health 200
`"estate":{"mode":"enforce","app":"games"}`. Here: `d94f2f2` design §10 row 8.
**Measured (Cloudflare docs, 2026-09-05): `RATE_LIMITER` namespaces are per-ACCOUNT**,
so a second instance takes `namespace_id "1002"` and main's `"1001"` never changes.
Open, for phase 9: `BILLING_SITE` is still the constant `'games'`; there is no
donor/peers mechanism for games (books has `[env.friend]` as the drift donor).
NOT verified: a signed-in tail line showing `app=games` — the owner signs in once at
<https://boardgames.heygabi.ai> and checks it.

### ✅ Phases 1 + 2 — the auth-worker half — BUILT, MIGRATED AND DEPLOYED (agent A, 2026-09-05 14:24Z)

`6b1f686` migration `0018_catalog_requests.sql` + `apps/auth-worker/src/catalog-names.ts`
(the ONE reserved list and subdomain validator both cards share) · `9df0b51`
`src/catalog-requests.ts` — the six routes of §3.6 — plus the three `adminCors()`
mounts and 52 tests · `2f55065` `/api/estate/me` gains `catalogs`.
**Migrate-before-deploy, in that order:** `npm run db:migrate` applied `0018` to
**remote** `estate_auth` (4 commands, 0.87 ms, one ✅) before
`npx wrangler deploy` shipped `estate-auth`
`ecf3f86a-5ac9-44c6-9632-8073133c45fd`. Deploy line + full verification list:
[`deploys.log`](deploys.log). As-built rows:
[`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) §10
phases 1–2 and §3.3.

✅ **This UNBLOCKS agent C's phase-4 deploy** (item 1 below): the three CORS
mounts are committed in `9df0b51`, so `cors-coverage.test.ts` is green and
`npm run deploy:home` can run from a worktree of HEAD.

Measured: suite 594 → **651 pass / 0 fail**, `tsc` clean on both projects.
Live (`curl -s -D - … -o /dev/null` — ⚠️ `-I` and `-o NUL` misreport on this
host): unauthenticated `GET /api/estate/catalogs/availability?name=test` and
`POST …/requests` both **401** with the worded *"You are not signed in…"*
refusal, never a bare status; `OPTIONS` preflight from `https://heygabi.ai`
**204** on the bare mount and the wildcard; `/api/health` 200;
`wrangler d1 execute estate_auth --remote` reads `catalog_request` count **0**
with both indexes present. Probe suite 136/1 on a clean run, the one failure
being the **pre-existing** stale `discord:D5` (it asserts four
`gabi_books_tools` names; there have been five since 2026-09-03).

🔴 **What is left, and it is the whole 200 side:**

1. 🔴 **NO SIGNED-IN REQUEST HAS EVER BEEN FILED.** A session cannot sign in as
   a person and must not mint an identity against a live gate, so every
   success path — a real submit, an availability answer for a member, the `/me`
   `catalogs` array, accept/decline, mark-live, withdraw — is proven **only**
   against an in-memory D1. **This is the owner's step**, and it is the same
   one phase 4 needs: file one request of each kind at <https://heygabi.ai>
   signed in, then accept one at <https://heygabi.ai/admin/>.
2. ☐ **Phase 6's back-seed is now UNBLOCKED** — `0018` is applied remotely, so
   the `library` / `padhard` / `boardgames` `live` rows the owner asked for
   ("Yes back seed", ~07:25 Phoenix) can be inserted. Not done by this agent:
   it was not in its brief, and it is a data write to the row shape §9 row 4
   specifies.
3. ⚠️ **A finding, not a defect:** `docs/access/estate-auth.md` §2's route table
   covers **four** of the Worker's ~forty routes — it is the SSO build's table,
   not the Worker's. Rather than duplicate §3.6 into it, §2 now carries a
   pointer paragraph naming where each feature's route contract lives. One
   fact, one home.

### ✅ Phase 4 — the `/admin` queue — BUILT + PUSHED, `7acc497` (agent C, 2026-09-05)

`sites/heygabi-home/public/admin/admin.js` + `admin/index.html`. Banner (§5.2),
"Catalog requests" section first among the panels (§5.3), Accept panel with
owner-editable address + live availability (§5.4), two-tap Decline with the
required reason, Mark live, the collapsed decided list, and the §5.6 refusal set
with the four causes kept distinct. As-built record, including the two gesture
rulings and the two defects fixed in passing:
[`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) §10.1;
the `/admin` page map is now [`access/estate-auth.md`](access/estate-auth.md) §9.3.
Green: `check:home` (30 JS, 26 module graphs, 14 HTML) and the full workspace
suite.

What is left on this phase, in the order it can be done:

1. 🔴 **THE DEPLOY IS BLOCKED ON PHASE 1's CORS COMMIT — not on a defect here.**
   `apps/auth-worker/test/cors-coverage.test.ts` fails while the frontend names
   `/api/estate/catalogs/*` and `apps/auth-worker/src/index.ts` has no
   `app.use(…, cors())` for them, and `npm run deploy:home` runs the whole
   workspace suite. Agent A has the three mounts written (`index.ts:208–210`)
   and **uncommitted**; the moment they land, re-run the deploy from a worktree
   of HEAD. ⚠️ **The guard was NOT bypassed** — it is right: a missing preflight
   makes the page report a network error, which reads as an outage rather than a
   missing route. Ordering rule for the next parallel build: **the route repo's
   CORS registration is a phase-1 deliverable, not a phase-1 detail.**
2. 🔴 **NOBODY HAS RENDERED THE SECTION SIGNED IN**, and this is the debt §10's
   own row 4 said not to repeat. There is no browser harness for `admin.js`;
   `check:home` proves it parses and nothing more. Sign in at
   <https://heygabi.ai/admin/>, file one request of each kind from the front
   door, and check: the banner appears above the panels and names the kinds; the
   section is first and collapsed with a live count; a Games row carries the §8
   cost in words; Accept's two taps open the panel and write nothing; editing
   the address live-checks and the *unchanged* address does **not** read as
   taken; Accept then shows the `--dry` provisioner line; Decline refuses
   without a reason.
3. ☐ **The sealed-key hook** (phase 5, LAST): `catalogAcceptPanel()` carries a
   marked comment where §5.4 items 3 and 4 go. Until then the panel states that
   the catalog is provisioned with the **owner's own** key, per §6.4 row 3.

### Dispatch B — the home-card "+" (phases 3a + 3b)

- ✅ **3a LANDED `d475682`** — the Games card is `.card.multi`; the host row is
  now the link (full-width, one tab stop, `.sr-only` new-tab note inside it, its
  own `--hue` focus outline). Cost paid knowingly and on the precedent of
  `index.html:653–663`: no whole-card tap target, no hover lift, no sheen.
- ✅ **3b BUILT `1bfb5ac`** — `sites/heygabi-home/public/assets/apex-request-catalog.js`
  (the "+", the modal, the **required** review step, the pending pill with a
  two-tap Withdraw, per-kind show/hide, fail-hidden), styles in `index.html`'s
  own `<style>` per the `apex-admin-link.js` precedent, one `data-catalog-kind`
  hook per card, and two new live pins in `predeploy.checks.json` (the hooks as
  a **pair**, plus the module itself — partly closing audit finding **F25**,
  which is that no front-door asset was pinned at all).
  **Exercised** with a stub-DOM harness: all nine §4.3 rows correct, the review
  gate refusing in words with zero fetches, the exact POST body, a 409 shown as
  the route's own sentence, a thrown fetch shown as an **outage**, the debounce
  firing once, withdraw arming → POSTing → restoring the "+".
  🔴 **NOT verified: anything signed in, and anything live.**
- ✅ **DEPLOYED `4875d1dd`** from a worktree of `597e40d`, after the block
  cleared. It **was** blocked on the same CORS commit as phase 4 above (see that
  section's item 1 for the mechanism); the refusal named seven paths, three of
  them `apex-request-catalog.js`'s, and it was **not bypassed**. ⚠️ Uploaded
  **0 new files of 57** — byte-identical `public/` to agent C's deploy
  `3bb3bff7` four minutes earlier, which had already shipped this commit's
  public tree; this deploy exists so the shipped commit and the record agree.
  **One deploy covers both surfaces**, which is worth knowing before the next
  parallel build sends two agents at the same Pages project.
  Now written down where a future deployer will look:
  [`info/worktree-deploys.md`](info/worktree-deploys.md) §5 owns the general
  rule, and the incident with its full refusal text sits beside the build order
  it corrects in
  [`info/request-a-catalog-design.md`](info/request-a-catalog-design.md) §10.
- ✅ **VERIFIED LIVE with the right instrument** (`curl -s -D -`, cache-busted):
  `GET /` **200** serving `div class="card multi" data-catalog-kind="games"` at
  line 933 with the `boardgames.heygabi.ai` host **link** at 940, the books
  hook, and the script tag at 1008; `GET /assets/apex-request-catalog.js`
  **200**, `application/javascript`, **27,939 bytes**, carrying all six pinned
  strings. ⚠️ **No `class="card-add"` and no `class="card-pending"` appear
  anywhere in the served HTML** — the signed-out page carries the hooks and
  nothing else, which is the gate working rather than a missing feature.
  `npm run verify:home`: 29 pages fetched, all checks passed.
- ☐ **THE OWNER'S VERIFICATION, and nothing substitutes for it:** signed in at
  <https://heygabi.ai>, press the "+" bottom-right of **both** the Books and the
  Games card and file one real request of each kind. There is no browser harness
  for this page; `check:home` proves it parses and nothing more.

## ☐ `count_phrase` sank every converse loop to Haiku — allowlist it on Groq (2026-09-03 12:40)

Measured by the Groq Monitor at 19:12Z (the owner's own review question):
`mode:"first" purpose:"converse_tools" outcome:"ineligible" blocked_tools:["count_phrase"]`.
🔴 **Corrects the DONE entry above and `gabi-groq-rung.md`:** `GABI_GROQ = "first"` is
LIVE (`wrangler.toml:588`) and phase 2 tool loops are live — the "shipping dark /
toolless only" claim was stale, and dispatch B was briefed from it. The gate is
all-or-nothing per loop, so from the 12:04 deploy until this lands, **every mention's
converse loop billed Haiku instead of Groq**, not just book questions.
Fix: one array entry in `GROQ_READ_ONLY_TOOL_NAMES` (`gabi-tools.ts:1007-1010`, Tier 0c)
— the tool is read-only and returns a strict subset of what `search_book_text` already
sends Groq; invert the `gabi-groq.test.ts` assertion; correct the three docs; redeploy.
Conductor's call (restores the owner's configured posture; owner told, may reverse).
✅ **LANDED 12:47** (117k Opus; `272ac67` code+test, `6bbc39f` docs; deployed
`estate-discord` `45565653-1456-4a77-8605-17a8d073cae4`; 1246/0 unchanged; `/api/health`
200 with `gabi_groq_tool_allowlist` 13 → **14** names incl. `count_phrase`;
`gabi-groq-tools.ts` needed no wire entry — schemas pass by reference and families
already carried the name). Docs corrected: `gabi-groq-rung.md` step 8 + "Fourteen",
design §4.8, phrase-count §5b, `info/README.md` row. Regression window: 12:04 → 12:47.
☐ **PROOF PENDING** — the next `@mention` must produce a `converse_tools` `gabi_groq`
  line with `outcome` ≠ `ineligible` (the Monitor catches it). `outcome:"fallback"` with
  `invalid`/`too_large` would be the rung's own §11/§12.2 question, not this fix. When
  seen, move this heading WHOLE to DONE beneath the phrase-count entry it corrects.

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
## ⏸ ON PAUSE by owner order 2026-09-02: "Anything needing the other computer is on pause"

The ABS box steps for the ebooks shelf library
(`audiobook_catalog/docs/access/SHELF_EBOOKS_LIBRARY.md` §3–§5) and anything
else requiring hands on the shelf box. Resumes only on the owner's word.

(The rest of the ~14:00 owner decision batch — publisher fix + B&N sweep,
work-page shelf merge, per-edition covers, single play button, Emberdark
dedupe with all source files kept — was BUILT the same afternoon and moved
WHOLE to [`DONE.md`](DONE.md) entry "2026-09-02 — the ~14:00 owner decision
batch, executed"; per-repo detail lives in library_catalog's and
audiobook_catalog's own DONE files.)

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

---

## ☐ Secrets review follow-ups (from `info/secrets-review-2026-08-26.md`)

> The three decided/done owner items (keys stay in OneDrive; `ESTATE_EVENTS_TOKEN`
> set + verified; 1Password adopted — vault `Estate` is the master, steps 1+2
> done, four console keys verified live and old ones revoked by the owner) moved
> WHOLE to [`DONE.md`](DONE.md) on 2026-08-31. What remains open is steps 3 and
> 4 below, plus the two master-less secrets tracked in
> `library_catalog/docs/TODO.md` (*"Custody gaps"*).

## ☐ STEP 3 of the 1Password adoption — 1 of 4 pairs ROTATED, and all 4 now RUNNABLE

`scripts/op-rotate-pair.mjs` mints a fresh value into the vault and sets it on
BOTH holders in one run, verifier first, stopping at the first failure.
`--list` prints the four and their probe status.

🔴 **THE BLOCKER IS GONE, THE WORK IS NOT DONE.** The three pairs below were
refused from 2026-08-26 because nothing could *watch* a rotation; the handshake
routes shipped 2026-09-02 and `--list` now reads ✅ four times. **Three
ceremonies are waiting on the owner** — the exact commands are below, and
nothing has been minted.

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

### ✅ The other three were REFUSED for want of a probe — and the probes now EXIST (2026-09-02)

```
ESTATE_APP_TOKEN_LIBRARY2    estate-auth      ↔ library-catalog-friend
ESTATE_APP_TOKEN_AUDIOBOOK   estate-auth      ↔ audiobook-worker
ESTATE_APP_TOKEN_BOOKS       audiobook-worker ↔ estate-discord
```

**Option 1 below was taken.** Two read-only routes shipped 2026-09-02 (commit
`1cfa531`; `estate-auth` version `9fb859be-202f-40c5-9a6c-168263d2754e`,
`audiobook-worker` version `ee8255dd-8219-4372-bc48-a2c6688f6dc9`), and
`node scripts/op-rotate-pair.mjs --list` now prints ✅ against all four pairs:

| Route | Unblocks | Deliberately reaches |
|---|---|---|
| `GET auth.heygabi.ai/api/estate/app-check` | `_LIBRARY2` + `_AUDIOBOOK` (one Worker verifies both) | no D1, no identity, no write |
| `GET audiobook-api.heygabi.ai/api/books/app-check` | `_BOOKS` | no bucket, no pack, no email — **no book** |

Each answers *"does this bearer authenticate, and as which app?"* and nothing
else. Neither echoes a value; a refusal names no app and no configured secret.

### 🔴 THE OWNER'S CEREMONY — three runs, ONE PAIR AT A TIME

⚠️ **A session must not do this**, and none has: minting a value and pushing it
to two live Workers is the owner's mint-and-set-both-sides step. What follows is
what to type. From the repo root, with `op` signed in:

```bash
# 0. See the four pairs and confirm every probe reads ✅ before starting.
node scripts/op-rotate-pair.mjs --list

# 1. Rehearse. Mints nothing, sets nothing, sends no probe.
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_LIBRARY2 --dry-run

# 2. The real run, one pair, then STOP and read the seven lines it prints.
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_LIBRARY2

# 3. Only once that ends "✅ … handshake proved", the next:
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_AUDIOBOOK
node scripts/op-rotate-pair.mjs --pair ESTATE_APP_TOKEN_BOOKS
```

⚠️ **`ESTATE_APP_TOKEN_LIBRARY2` has a holder in `library_catalog`**, so that
checkout must be present (the script finds it, or set `LIBRARY_CATALOG_DIR`).
The other two are entirely inside this repo.

🔴 **IF A RUN STOPS AT STEP 5 OR 6, DO NOT RE-RUN IT — RESUME IT:**

```bash
node scripts/op-rotate-pair.mjs --pair <NAME> --resume
```

A plain re-run mints a SECOND value and creates a DUPLICATE vault item under the
same title — two masters for one secret, which is worse than the half-applied
pair it was trying to fix. `--resume` takes the value from the item the failed
run already created.

**What each run does, in order:** mint → probe (expect a refusal) → vault item →
**VERIFIER** → probe (expect 200 naming the app, retried 2s/4s/8s/15s) →
**PRESENTER** → probe again. It stops at the first failure, and between the
verifier and the presenter that route is briefly DOWN — inherent to a
single-valued verifier, which is why both pushes are one run with no question in
between.

**Verify by hand afterwards, if you want a second opinion** (the value is the
one now in the vault; ⚠️ header, never a query string — this repo is public):

```bash
curl -s -H "Authorization: Bearer $(op read 'op://Estate/ESTATE_APP_TOKEN_AUDIOBOOK/password')" \
  https://auth.heygabi.ai/api/estate/app-check
# → {"ok":true,"app":"audiobook","verifier":"estate-auth","secret_name":"ESTATE_APP_TOKEN_AUDIOBOOK",…}
```

⚠️ **`app` is the assertion, not `ok`.** A value pushed to the wrong
`ESTATE_APP_TOKEN_*` secret still authenticates — as the wrong app — so a
status-only check would call that a success.

⚠️ **A new Worker version is not live at every edge the instant `wrangler`
returns.** Measured twice now: the 2026-08-26 rotation's probe 401'd for a
couple of minutes, and on 2026-09-02 the freshly deployed `/api/books/app-check`
answered **404 for about a minute** before answering correctly. The script
retries with backoff for exactly this reason; a by-hand `curl` should too.

### What the probes prove, and what they do NOT

✅ The **verifier** accepts the value presented. 🔴 **NOT** that the holding
Worker *sends* it on its own traffic — Worker secrets are write-only, so the
only evidence there is that `wrangler` accepted the write and the name is still
listed. The routes say so on the wire (`proves` field) rather than only here.

**The alternative, still available and needing no new code:** do them by hand
with the owner watching the surface each feeds — sign in on padhard; open an
ebook; ask GABI a book question in Discord. Slower, and it needs him present.

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

### 2. "+ Add a verse" — ✅ DEPLOYED 2026-09-02 ~15:00 on the owner's "Run it"; two open remnants

Phases 0–3 archived whole in [`DONE.md`](DONE.md). The fixed-order deploy RAN:
migration `0017` applied to remote `estate_auth` first (`npm run db:migrate`,
✅ in 1.07ms); `estate-auth` deployed from a worktree of HEAD (version
`07dbe1b0-a58f-4980-a435-c8c01f909f34`); `heygabi-home` deployed LAST from the
same worktree (`18df9ec9`, 28 live predeploy checks passed) — but ⚠️ only
after `.gitattributes` pinned `universe-names.generated.ts` to `eol=lf`
(commit `886b370`): a Windows worktree checkout CRLF'd the generated file and
the byte-comparing parity test correctly refused the deploy. Live verify:
"+ Add a verse" and "Missing a verse?" both render signed-in on
<https://heygabi.ai/universes/>. NOT verified: no request has ever been FILED
(the first real request → /admin approve → CLI create round-trip is untried),
and /admin's Verse-requests section is unrendered by human eyes.

Remaining, unchanged:

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
