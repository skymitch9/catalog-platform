# ✅ CONDUCTOR FINAL — security-fix batch COMPLETE (2026-08-24)

> All queued security fixes are merged, deployed, and verified live. Conductor cron `5a38e1dd` retired.
>
> **catalog-platform audit highs** — `feature/audit-fixes-platform` merged `717acee` → `3ae51aa`, all targets deployed + logged in `docs/deploys.log`:
> - index-worker `4f9de096` — F5 CORS (POST no longer preflight-refused; verified live `GET,POST,OPTIONS`)
> - audiobook-worker `aecf8bd8` — F3 stream-ping path-injection (manifest lookup + encode; health 200)
> - discord-worker `f0fa48c3` — F6/F7 GABI shelf/recall tools offered + reviewed-set off full id set (health ok)
> - heygabi-home `e53e99ef` — F8 backup "last write" no longer scraped (verify:home 28 pages passed)
> - (auth-worker F2 `d1d53800` shipped earlier this session)
> Full platform suite green before deploys.
>
> **library PEER_TOKEN leak** — `feature/peer-token-secret` merged `d9fefa4`, both instances deployed (`ae88bf6` main, `dc67fdd` friend): token moved out of the public `PEERS` config into the `PEER_TOKEN` secret.
>
> ✅ **PEER_TOKEN secret ROTATED by the owner this session** — fresh random value set on BOTH instances (main + padhard). Incoming gate (`routes/peer.ts:69,127`) + outbound push (`peer-push.ts`) both key off `env.PEER_TOKEN`; leaked value is now invalid. This was the last 🔴 owner-only step — now closed.
>
> 🚩 **Still FLAGGED — owner design-call, NOT auto-fixed:** F4 — estate SSO is silently CSP-blocked (`connect-src`) on `/series` + `/universes`. Two opposite resolutions (widen the CSP vs guard `bootstrapEstateSso()`); access-increasing and sits beside KI-6, so it needs a browser measurement + your decision. See `docs/info/audit-2026-08-findings.md` (F4).
>
> (Separately in flight, NOT part of this security batch: T-B universe sweep + T-D pipeline-sanctity report — owner-directed research, land-for-review.)

---

# ☀️ MORNING SUMMARY — overnight autonomous run 2026-08-23 → 24

> Conductor (Fable, orchestrating; all builds on Opus/Sonnet) ran the whole queue
> across the session resets. **Everything LANDED FOR REVIEW — nothing deployed,
> no remote migration, no paid sweep, no live flag flipped.** Usage at wrap:
> **session 53% · weekly 26% · Fable 2%** (~03:50 Phoenix). The conductor cron is
> now retired. This block is the handoff; delete it once you've actioned it.

## ✅ DONE 2026-08-24 (later AM)

- **Audiobook site XSS fix SHIPPED** — the pipeline was leaving site/ regenerations uncommitted on idle runs; --rebuild-only published + pushed (index.html regenerated with the escape fixes). XSS fix is live.
- **ebook-count SHIPPED** — merged (bbe1ae6); root-caused why it could not ship: site/ebooks.html was in NEITHER the pipeline commit allowlist NOR the auto-promote allow-regex (a3aaf5 added it to both, mirroring index.html), then --rebuild-only committed+pushed ebooks.html with the count (c26572d). Auto-promote gate takes it to prod.
- **SHELF: researched, NOT fixed.** docs/info/shelf-review-2026-08-24.md. Blocked on standing ABS-box access + owner decisions (ebook gate, base-path). Nothing shelf-side changed.
- ⏳ research-queue.mjs fix IN FLIGHT (work_alias + change_log mirror, atomic batch).
- 🔴 STILL OWNER-ONLY: rotate PEER_TOKEN.

---

## ✅ DONE 2026-08-24 (post-wake, owner-driven)

- **Dice + card-shuffle spinner animations** — built, merged, DEPLOYED both instances (main e8fb5e50 / padhard de0f5486, 1591 tests). Theme picker at /tbr now offers wheel / dice / cards.
- **Padhard details queue → 0.** The "4" were 4 field-gaps across 2 works: 490 Ex Hex Duo filled via paid lookup (~1.6c on owner key, corroborated); 468 Veil of Darkness = unidentifiable, unknown verdicts. No open gaps remain.
- ⚠️ **FOLLOW-UP: `scripts/research-queue.mjs` is broken by schema drift** — its in-memory mirror omits `work_alias` (0410) + `change_log`, and `makeShim.batch` is non-atomic (a partial write occurred: work.series written but change_log insert failed). Add both tables to MIRRORED + make batch atomic before using it. Padhard 490 was finalized with direct sanctioned writes instead.
- ⏳ ebook-count auto-merge armed (cron, fires when the pipeline clears site/ebooks.html).
- 🔴 STILL OWNER-ONLY: rotate PEER_TOKEN (public repo wrangler.toml); mint INDEX_READ_TOKEN x2.

---

## ✅ DEPLOYED 2026-08-24 AM (owner-driven, from phone)

- **library main + padhard**: migrated 0400+0410, deployed (75818eff / bf1c225c), health green. Spinner live at /tbr on both.
- **catalog-platform**: discord-worker deployed (GABI T2 DARK, 82818629); backup-board push triggered (/status shows real 100%).
- **audiobook**: ingest-lock-pid + audit-fixes (XSS, Drive->trash, CI gate) merged to main (5b154e8); SyncPipeline triggered to rebuild+publish → ships the XSS fix.
- ⏸ **ebook-count** still held — merge after the running pipeline commits site/ebooks.html (clears the collision).
- 🔴 STILL OWNER-ONLY (type the secret): rotate PEER_TOKEN (wrangler.toml:203/:418, public repo); mint INDEX_READ_TOKEN x2 for GABI index rung 2.

---

## ☐ OWNER DECISIONS 2026-08-24 AM (from phone)

- **Damsels of Distress covers → KEEP the 3D publisher mockups.** Done, no flat-jacket hunt.
- **GABI T2 propose-trigger → ✅ BUILT (land-for-review, 2026-08-24).** Discord surface wired on
  `feature/gabi-t2-propose-trigger`: model-parse a chat message → subject + field → dry-run propose
  → confirm card, behind `GABI_CONFIRM_T2` (still DARK, inert when off). See the 🟡 decisions item
  below for the go-live steps and the phase-1 boundaries. The library panel's own propose trigger
  remains separate (library_catalog `feature/gabi-t2-panel`).

---

## 🔴 DO THESE FIRST (only you can)
1. **ROTATE `PEER_TOKEN`** — the library audit found it as a **plaintext value TRACKED
   in the PUBLIC repo** (`bookbuddy/library_catalog/apps/worker/wrangler.toml:203` &
   `:418`, inside `PEERS`). Live credential, internet-readable. `wrangler secret put`
   a new value, move the `PEERS` entries to reference the secret, strip the plaintext.
   Not auto-fixed (stripping without rotating breaks peer auth). The value was never
   copied into any doc/commit.
2. **Approve the DEPLOY PASS** (below) — one pass ships the whole night's stack.

## ✅ THE DEPLOY PASS (all on `main`, tested, committed, NOT deployed)
**library_catalog `main`** (tip `33c3e04`, **1,580 tests green**) — migrations `0390`,
`0400`, `0410` are in the tree but UNAPPLIED. Order: `npm run db:migrate` +
`db:migrate:friend` (both instances) → `npm run deploy` + `deploy:friend`.
Carries: per-edition audiobook schema, duplicate finder, lent/borrowed/sold + OR-1
(members endpoint + strict-create SHADOW), universe `--friend` fix, TBR spin picker,
alias-aware research (build only — the paid re-ask is yours to run), GABI T2 panel
(DARK), and **1 critical + 12 high audit fixes** (collection white-screen, last-owner
guard, unauth peer read, GABI memory bugs, details-sweep subrequest estimate, …).

**catalog-platform `main`** (tip after GABI merge `2eb0f3f`, **2,054 tests**) — backup
`/status` board now shows the real 100%; GABI T2 confirm lane (DARK). Deploy: auth-worker,
index-worker, heygabi-home (per the earlier deploy runbook / worktree-of-HEAD for the
directory deploy).

**audiobook_catalog — on BRANCHES, merge when the pipeline is IDLE** (it auto-commits
`site/`): `feature/ebook-audio-count`, `feature/ingest-lock-pid` (252 tests),
`feature/audit-fixes-audiobook` (1 crit + 5 high incl. stored-XSS, 1,466 py + 730 js
tests). Then Firestore rules if STEP 11's `link` button is wanted live.

## 🟡 DECISIONS / FOLLOW-ONS waiting on you
- ~~**Mint `INDEX_READ_TOKEN`**~~ ✅ **DONE 2026-08-25** — minted and set on all four holders in
  one sitting, **two values, not one**: index-worker `INDEX_READ_TOKEN_LIBRARY` ↔ library main
  `INDEX_READ_TOKEN`, and index-worker `INDEX_READ_TOKEN_LIBRARY2` ↔ padhard's own
  `INDEX_READ_TOKEN`. ⚠️ The original ask said *one value on both*; that is right for ONE calling
  app and wrong for two, because the index resolves the app **from the value presented** — a
  shared value would make the app name meaningless and one leak would revoke both instances.
  `MACHINE_APPS` gained `library2` accordingly; `MACHINE_VISIBILITY` is unchanged, so the
  `library2` APP still cannot read the `library2` SHELF. Verified live: 200 with rows for a real
  title on each token, named 401 `machine_token_invalid` on a wrong one. Rung 2's contract is
  `library_catalog/docs/info/free-details-ladder.md` §4.
  ⚠️ **It was never merely unminted** — the library rung was pointed at the HUMAN `/api/lookup`
  with both env vars set, so it was refused every run while looking configured. Fixed in the
  same batch.
- **GABI T2 flag** `GABI_CONFIRM_T2` ships OFF. ✅ **Propose trigger now BUILT (land-for-review,
  2026-08-24)** on `feature/gabi-t2-propose-trigger` (Discord surface + shared parse map): a
  `fix_request` message → Haiku parse `{book,field,value}` → route to the one editable shelf →
  `browse-works` title match → `fix-field` dry-run → confirm card, all DARK behind the flag and
  inert with it off (pinned at the `handleMention` call site). Full estate suite green (discord-worker
  948, gabi-conversation 34), typecheck clean. ⚠️ Phase-1 defers to the panel link on any ambiguity
  (not-a-single-field / editable on both-or-neither shelf / 0-or->1 title match / modal door). To go
  live: review + merge the branch, deploy discord-worker, THEN flip `GABI_CONFIRM_T2`. The panel's OWN
  propose trigger stays separate (library_catalog `feature/gabi-t2-panel`).
- **details-sweep** now honestly heals **1 book/tick** (was silently over-budget at 2 and
  dying mid-second-book). Raise the cron frequency if you want the old rate; do NOT raise
  the budget (must stay under the 50-subrequest ceiling).
- **Low-confidence covers held for you:** padhard 435 *Risky Business* (set, Samantha to eyeball),
  main 513 *Snow X Dwight* (set as stand-in). Damsels of Distress covers fixed (publisher 3D art;
  say if you want flat jackets).
- **LibraryThing ISBN rung** (library HIGH) — left for you: the fix needs the live API's XML
  shape + a `source` CHECK value; a wrong parser is worse than the documented status.

## 🔍 AUDIT RESULTS (findings docs committed; crit/high FIXED on main/branches)
- **library**: 4 crit / 13 high / 53 med / 25 low → `docs/info/audit-2026-08-findings.md`.
  1 crit (PEER_TOKEN) = your rotation; 1 crit + 12 high fixed; 1 high (LibraryThing) flagged.
- **audiobook**: 1 crit + 5 high fixed (branch); med/low in its gitignored findings doc.
  ⚠️ The audit's own verify step first checked the WRONG repo and false-refuted real bugs
  (incl. the stored-XSS) — caught and re-verified.
- **board-game**: 0 crit / 0 high; 13 med / 11 low documented (`5daf64f`).

## SPEND / NOT DONE
- Paid LLM spend overnight: **$0** (alias-aware research + covers were build-only; the padhard
  cover run earlier was ~$0.82 on your key). Audits + builds were Opus/Sonnet time (weekly 20→26%).
- NOT done, by policy: any deploy, remote migration, the GABI propose-trigger wiring, the
  audiobook manifest stale-key delete (live data — do when pipeline idle), the ebook-site
  reader/player builds (T-F was research only), the shelf items (research only — see
  `docs/info/shelf-review-2026-08-24.md`, needs ABS-admin access).
- `C:/lcw/` holds ~15 worktrees from the night's branches — prune the merged ones at leisure.

---

# TODO — catalog-platform (ACTIVE work log)

 TODO — catalog-platform (ACTIVE work log)

> 🔄 **CONDUCTOR STATUS (~03:1x, session 51%, weekly 26%):** AUDIT FIXES: audiobook 1crit+5high FIXED
> (feature/audit-fixes-audiobook, 7 commits, 1466py+730js tests — XSS x4, Drive delete->trash, CI JS gate).
> Library crit/high fix agent IN FLIGHT (feature/audit-fixes-library). 🔴 OWNER: rotate PEER_TOKEN (public
> library wrangler.toml:203/:418). After library fixes land+merge → write MORNING SUMMARY + CronDelete conductor.
> Audiobook branches (ebook-count, ingest-lock-pid, audit-fixes) merge in the morning when pipeline idle.

---

## ☐ BUG (not urgent, owner 2026-08-24) — ebook "also on audio" button resolves to nothing
Some books in the ebooks library show an "also on audio" affordance, but there is
no matching audiobook, so the link/button dead-ends. The ebook→audiobook match is
stale or over-eager (shows the button when no live audio edition exists). Fix:
only surface "also on audio" when a real matching audiobook resolves; otherwise
hide it. **Locate exact surface first** — likely audiobook_catalog `site/ebooks.html`
(the recent "N audiobooks" ebook-count work) or the library work-page audio cross-link.
Land for review. Candidate for a Fable/subagent build once located.

---

## ☐ Secrets review follow-ups — owner decisions, one at a time (from `info/secrets-review-2026-08-26.md`)

1. ✅ **DECIDED 2026-08-26 — leave the raw key files where they are.** Asked whether to move
   `docs/access/keys/` (+ `.dev.vars` / `.env`) out of OneDrive via a junction
   (Finding 4, §3.4). Owner: *"no thats fine"*. Not re-asking; the finding stays
   recorded in the review as accepted.
2. ✅ **DECIDED + DONE 2026-08-26 14:35 — `ESTATE_EVENTS_TOKEN` set as a repo
   secret** from the custody file (owner: *"yes do it"*); test event seen on
   `/status` 15:17 (KI-10).
3. ✅ **DECIDED 2026-08-26 15:35 — option A: adopt 1Password NOW** (owner: *"a do
   it, I have 1 password and time now"*). Supersedes the 2026-08-25 "deferred (C)".
   Plan = `info/secrets-review-2026-08-26.md` §5, in its order: (1) `library_catalog`
   templates + `op`-sourced push; (2) `docs/access/keys/*.txt` → vault items;
   (3) `catalog-platform` Workers — the 10 no-master secrets (`DONOR_TOKEN` closed
   2026-08-26); (4) `audiobook_catalog/.env` last.
   Measured 15:35: desktop app **8.12.32** installed (Store package); **CLI not
   installed**; owner's keystrokes: `winget install AgileBits.1Password.CLI`, app
   Settings → Developer → *Integrate with 1Password CLI*, then `op whoami`.
   Sessions never see a value — every move is `op` reading a file or a vault item.
   **15:57:** CLI 2.34.1 installed (winget), app integration ON, account connected,
   vault **`Estate`** created (`y5w264u3akx22cf2ffric32kii`). Build delegated to an
   Opus agent: steps 1–3 of §5 in order, step 4 (`audiobook_catalog/.env`) estimate only.

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
- ☐ **OWNER DECISION Q3:** 🔴 A3 — `audiobook_catalog/site/user-warnings.js:102`
  is a **public, no-sign-in button** that queues work the hourly GitHub Action
  (`cw-fulfill.yml:20`) pays Anthropic for. Gate it now, or in phase 6?
  ⚠️ Any gate must be on `create`/`write` only — `allow delete: if true` on the
  same Firestore block is load-bearing for the fulfiller.
- ☐ Phase 0 is worth doing alone: the feature registry + three refusal defects
  found while reading (see §6.1).

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
- 🔴 **Two live discrepancies found, fixable today and independent of the design:**
  - `sites/heygabi-home/public/universes/universes.js` hardcodes **16** universe
    names; `data/universes.json` holds **17** — `DotHack` is missing, so the page
    has been silently one universe short.
  - `tools/universes.mjs:127`'s help text still says *"Six exist"*.
