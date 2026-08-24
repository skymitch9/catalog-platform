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
- **GABI T2 propose-trigger → BUILD IT (queued).** Wire the live classifier: model-parse a chat
  message → subject + field → dry-run propose → render the confirm card, on Discord + the library
  panel, behind the existing `GABI_CONFIRM_T2` flag (still DARK). Builds on the merged T2 plumbing.
  Dispatch when owner is at the PC / next run. Land for review.

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
- **Mint `INDEX_READ_TOKEN`** (one value, set on BOTH: index-worker `INDEX_READ_TOKEN_LIBRARY`
  + library worker `INDEX_READ_TOKEN`) to light GABI's index rung 2 — different from the push token.
- **GABI T2 flag** `GABI_CONFIRM_T2` ships OFF. ⚠️ The press path is wired but the
  **propose trigger is NOT yet hooked to the live classifier** — flipping the flag alone
  won't surface a proposal until that follow-on lands. Review the two branches, then decide.
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
