# Switching off what can bill — Information Reference

> **Audience:** Claude sessions first, the owner second.
> **Status:** TRACKED — 🔄 **PHASES 0, 1 AND 2 ARE BUILT, MIGRATED AND
> DEPLOYED (2026-09-02)**, plus phase 3 for this repo's own money path (E6).
> Phases 3 (other repos), 4 (the soak) and 5 (audiobook Python) are NOT.
> ⚠️ **This header said "DESIGN ONLY, nothing built" until 2026-09-02** and is
> corrected in place rather than deleted, because a retired claim that does not
> say it is retired keeps answering questions with stale facts. The as-built
> record is §11; the open remainder is [`../TODO.md`](../TODO.md).
> Last verified: **2026-09-02** — §2's inventory was RE-READ out of source in
> all four repos before anything was registered: all 36 paths still exist, no
> dead rows, but several LINE anchors have drifted (L4/L5, L8, A4, A9, E1–E3,
> E7) and were re-found by symbol. The line numbers below are therefore
> **approximate**; the entry points are real.
> ⚠️ **NOT verified:** no policy rule has ever been written, so no resolution
> has run against a non-empty table in production; `billing_denied` has never
> been seen on a real `/seen` or `/me` answer; and **nobody has rendered the
> Spending panel signed in**. Cost figures are the constants the code itself
> declares, not invoices. Effort figures are **labelled guesses**.

The owner's ask, 2026-08-24, verbatim:

> *"we need a way to toggle what can bill the LLM and what can't inside the
> admin page somewhere. and even finer than that, i want to be able to
> determine which features can bill and which can't per site per user etc"*

---

## 1. What already controls spend, and why none of it answers the ask

Four mechanisms exist. Each is real, each works, and **not one of them can be
changed by the owner from a browser.**

| Mechanism | Granularity | Changed by | Example |
|---|---|---|---|
| **Role capability** | per site × per role | an admin, per person, on `/admin` | `runResearch`, `scanPhoto` — `library_catalog/packages/core/src/capabilities.ts:75,65`; games' twin at `Board_Game_Catalog/packages/core/src/capabilities.ts:118,98` |
| **Env-var posture** | per site × per feature | ⚠️ **a DEPLOY** | `GABI_MENTIONS`, `GABI_DOCS`, `GABI_BOOKS`, `GABI_MEMORY`, `GABI_SHELF`, `GABI_SUGGEST`, `GABI_DELEGATED_WRITES`, `GABI_CONFIRM_T2` (`discord-worker/wrangler.toml:261,290,298,355,387,424,465,502`); `GABI_PANEL` (`library_catalog/apps/worker/wrangler.toml:138,373`) |
| **Secret presence** | per Worker, all-or-nothing | ⚠️ a `wrangler secret delete` | `if (!c.env.ANTHROPIC_API_KEY)` → 503, e.g. `library_catalog/apps/worker/src/routes/research.ts:284` |
| **Cron schedule** | per Worker | ⚠️ **a DEPLOY** | `crons = ["7 * * * *"]` — library main **and** friend, `wrangler.toml:64,331`; games `wrangler.toml` |

⚠️ **The gap is exactly the shape of the ask.** The role ladder is *per person*
but not *per feature* (one `runResearch` covers details lookup, cover search,
series scan and the GABI panel at once). The env postures are *per feature* but
not *per person*, and flipping one costs a deploy. Nothing is *per site × per
feature × per person*, and nothing at all is reachable from `/admin`.

### 1.1 ⚠️ Three things this design must NOT duplicate

The estate's own rule is one surface per question. Three surfaces already own
adjacent questions and this one must link to them, never restate them:

| Surface | The question it owns | Where |
|---|---|---|
| **Ingestion pause card** (`/status`) | *"stop the home-machine pipeline for a while"* — a **TIME** control | `info/ingestion-pause-controls.md`; routes `auth-worker/src/ops.ts` |
| **Claude usage meter** (`/status/agents`) | *"how much of the allowance is gone"* — a **MEASUREMENT** | `auth-worker/src/claude-usage.ts:250,349`; the doc that file carries is explicit that one store feeds one display |
| **Role & capability map** | *"which rung spends money"* — the **NORMATIVE** answer | `info/role-capability-map.md:46-48,107-108` |

This design owns a fourth, distinct question: ***"who and what is ALLOWED to
bill."*** Policy, not time, not measurement, not rung.

---

## 2. The money-path inventory — 36 paths across 4 repos

⚠️ **Every row was read from source this session.** "Today's gate" is what
actually stops the call, not what a comment says stops it.

### 2.1 `library` and `library2` — `library_catalog` (13 paths, deployed TWICE)

Both instances run **the same source** from `[env.friend]`
(`apps/worker/wrangler.toml:295`), on **separate Anthropic keys** — hers spends
her money (`wrangler.toml:322-329,398-402`). So these 13 are 26 live paths.

| # | Feature | Entry point | Trigger | Model / secret | Today's gate | Cost |
|---|---|---|---|---|---|---|
| L1 | Details research run | `apps/worker/src/routes/research.ts:277` | `POST /api/research/works/:id/run` | `claude-opus-5`, `ANTHROPIC_API_KEY` | cap `runResearch` + secret presence (`:284`) + in-flight claim (`:296`) | 2–8¢ (`packages/research/src/details.ts:369`) |
| L2 | Cover search (paid rung) | `apps/worker/src/routes/covers.ts:108` | `POST /api/works/:id/cover/find` | `claude-opus-5` | cap `runResearch` + secret presence (`:115`) | 6¢ (`packages/research/src/covers.ts:180`) |
| L3 | Series volume scan | `apps/worker/src/routes/series.ts:150` | `POST /api/series/:name/scan` | `claude-opus-5` | cap `runResearch` + secret presence (`:156`) · ⚠️ **no server-side concurrency lock** | 8¢ (`packages/research/src/series-scan.ts:272`) |
| L4 | Shelf photo scan | `apps/worker/src/routes/scan-jobs.ts:921` → `:1145` | `POST /api/scan-jobs/shelf` | `claude-opus-5` (`lib/vision.ts:52`) | cap `scanPhoto` + secret presence (`:1167`) | $5/$25 per MTok (`lib/vision.ts:55-56`) |
| L5 | Single-cover photo scan | `apps/worker/src/routes/scan-jobs.ts:938` | `POST /api/scan-jobs/single` | same | cap `scanPhoto` | same |
| L6 | GABI site panel turn | `apps/worker/src/routes/gabi.ts:40` | `POST /api/gabi/turn` | `claude-opus-5` (`packages/research/src/gabi.ts:55`) | cap `runResearch` + ⚠️ **env posture `GABI_PANEL`** (`lib/gabi-turn.ts:219`) + secret presence | per turn, 60 s cap |
| L7 | GABI delegated "fix my missing details" | `apps/worker/src/routes/gabi-delegated.ts:724` | `POST /api/gabi/delegated/run-details` (from Discord) | opus-5 + haiku judge | bearer `ESTATE_APP_TOKEN_DISCORD` + **on-behalf-of** cap `runResearch` (`:383`) | ~4¢/call |
| **L8** | 🔴 **Hourly details sweep — unattended** | `apps/worker/src/index.ts:257` → `lib/details-sweep.ts:760` | **cron `7 * * * *`**, both instances | haiku judge (`:900`) + opus-5 web pass (`:1034`) | ⚠️ **NO capability check — there is no user.** Only: cron match, secret presence, `SWEEP_LIMIT = 2` (`:255`), `SWEEP_BUDGET = 46` **subrequests** (`:287` — not money) | ~4¢/hour, ~£0.75/day worst case (`:245-249`) |
| L9 | CLI cover backfill `--llm` | `scripts/backfill-missing-covers.mjs:623` | `npm run backfill:missing-covers` | opus-5 | ⚠️ **CLI flags only** | 6¢/book, unbounded batch |
| L10 | CLI ISBN backfill LLM rung | `scripts/backfill-missing-isbns.mjs:322,494` | `npm run backfill:missing-isbns` | opus-5 + `web_search` ×4 + `web_fetch` ×2 | ⚠️ **CLI flags only** | per book, batch |
| L11 | CLI research-queue driver | `scripts/research-queue.mjs:609` | `tsx scripts/research-queue.mjs` | opus-5 | ⚠️ **NOTHING** — hard-codes `OWNER_USER_ID = 1` (`:99`), no capability check runs | per book, batch |
| L12 | CLI universe audit | `scripts/audit-universes.mjs:255,524` | `node scripts/audit-universes.mjs` | opus-5 | ⚠️ key presence only | per run |
| L13 | CLI universe probe | `scripts/probe-universes.mjs:123` | `node scripts/probe-universes.mjs` | opus-5 | ⚠️ key presence only | one call |

### 2.2 `games` — `Board_Game_Catalog` (7 paths)

| # | Feature | Entry point | Trigger | Today's gate | Cost |
|---|---|---|---|---|---|
| G1 | Photo identify (single box) | `apps/worker/src/routes/vision.ts:102` | `POST /api/vision/identify` | cap `scanPhoto` (`capabilities.ts:98`) | per call |
| G2 | Photo identify (shelf) | `apps/worker/src/routes/vision.ts:160` | `POST /api/vision/shelf` | cap `scanPhoto` | per call |
| G3 | Queued photo scan job | `apps/worker/src/routes/scan-jobs.ts:226` → `:664` | `POST /api/scan-jobs` | cap `scanPhoto` + secret presence (`:674`) | per upload |
| G4 | Paid barcode identify | `apps/worker/src/routes/barcode.ts:133` | `POST /api/barcode/identify` | cap `runResearch` (`capabilities.ts:118`) | per call + `web_search` |
| G5 | Research tier run | `apps/worker/src/routes/research.ts:118` | `POST /api/research/:id/run` | cap `runResearch` | 🔴 **6–40¢** (`packages/research/src/research.ts:259`) |
| G6 | Missing-details lookup | `apps/worker/src/routes/research.ts:248` → `lib/details-run.ts:170` | `POST /api/research/:id/details` | cap `runResearch` + secret + dedupe | 2–6¢ (`packages/research/src/enrich.ts:307`) |
| **G7** | 🔴 **Hourly details sweep — unattended** | `apps/worker/src/index.ts:173` → `lib/details-sweep.ts:76` | **cron `7 * * * *`** | ⚠️ **NO capability gate.** Secret presence + `SWEEP_LIMIT = 8` (`:58`) | ~11¢/hour while a backlog exists |

All games paths use `claude-opus-5` (`packages/research/src/client.ts:12`) and
the secret `ANTHROPIC_API_KEY` (`apps/worker/src/env.ts:71`).

### 2.3 `audiobook` / `ebooks` — `audiobook_catalog` (9 paths)

⚠️ **This repo has no server and no estate client on the money paths.** The
paths are Python, run by the home machine and by GitHub Actions. The secret is
**`Claude-llm`** (note the hyphen), not `ANTHROPIC_API_KEY`.

| # | Feature | Entry point | Trigger | Model | Today's gate | Cost |
|---|---|---|---|---|---|---|
| A1 | Chapter list, LLM fallback | `app/tools/extract_chapters.py:220` | CLI + pipeline STEP 5.5 (`scripts/sync_to_drive.py:1481`) | `claude-opus-4-8` | ⚠️ secret presence + `--no-llm` | per book (only after 3 free rungs miss) |
| A2 | Content warnings via web search | `app/tools/fetch_content_warnings.py:244` | CLI + pipeline STEP 5.6 (`sync_to_drive.py:1494`) | `claude-opus-4-8` | ⚠️ secret presence + `--no-llm` + answered-cache | per book |
| **A3** | ✅ **"Request AI warning check" button — GATED 2026-08-26** | write `site/user-warnings.js`; fulfil `app/tools/fetch_content_warnings.py:523` | signed-in only (was ⚠️ **PUBLIC UI BUTTON, NO SIGN-IN**) | `claude-opus-4-8` | `firestore.rules` `cw_requests` → `allow create, update: if request.auth != null && validCwRequest()`. Was 🔴 **NOTHING** — shape-only, never inspected `request.auth`. ⚠️ `read`/`delete` stay open for the fulfiller; see §9 Q3 | per request, **no longer attacker-controlled — volume is bounded by the household's accounts** |
| A4 | Author → Drive folder match | `scripts/sync_to_drive.py:501,536` | 8-hourly pipeline | `claude-haiku-4-5-20251001` | secret presence, after exact/normalised/fuzzy all miss | per new author, cheap |
| **A5** | 🔴 **CW request fulfiller — unattended** | `.github/workflows/cw-fulfill.yml:68` | **cron `17 * * * *`** | A2's call | ⚠️ secret presence only. The workflow header (`:15-16`) says out loud to loosen the schedule if you want to avoid the paid backfill | batch, hourly, driven by A3's public queue |
| A6 | Ebook AI cover-page classifier | `scripts/build_ebook_manifest.py:839` | manifest build | `claude-haiku-4-5` | ⚠️ **deliberately dead** — keyed on `ANTHROPIC_API_KEY` (`:286`), absent from `.env` on purpose (`:274-285`) | currently **zero** |
| A7 | Discussion prompt generation | `app/tools/generate_prompts.py:75` | CLI only — no cron caller found | `claude-opus-4-8` | secret presence + `--force` | per book, manual |
| A8 | "Run pipeline now" button | `app/tools/pipeline_watcher.py:114,125` | Firestore `pipeline_requests` doc | runs A1+A2+A3-fulfil+A4 | shared-secret HMAC vs `PIPELINE_TRIGGER_TOKEN` (`:203`) + age cutoff. ⚠️ **no role or estate check** | whole pipeline |
| A9 | Filesystem watcher auto-pipeline | `app/tools/fs_watcher.py:331,337` | Task Scheduler, **every 1 min** | same as A8 | ⚠️ rate limit + the single-flight pipeline lock only | whole pipeline, event-driven |

### 2.4 `estate` — `catalog-platform` (7 paths)

> ⚠️ **Line anchors in E1–E5 re-read 2026-09-01** when the Groq rung (E7) moved
> each Anthropic call into a `viaHaiku` closure. The calls themselves are
> unchanged — same model, same prompts, same caps.

| # | Feature | Entry point | Trigger | Model / secret | Today's gate | Cost |
|---|---|---|---|---|---|---|
| E1 | GABI intent classify | `apps/discord-worker/src/gabi-chat.ts:377` | Discord @mention / reply / DM | `claude-haiku-4-5-20251001` (`:91`), `ANTHROPIC_API_KEY_GABI` | env posture `GABI_MENTIONS` (`wrangler.toml:261`) + key presence | 24 max tokens (`:100`) |
| E2 | GABI conversational turn | `apps/discord-worker/src/gabi-chat.ts:480` | same | same | same | 400 max tokens (`:104`) |
| E3 | GABI tool-loop turn | `apps/discord-worker/src/gabi-chat.ts:857` | same, when tools are offered | same | `GABI_MENTIONS` + the per-feature postures `GABI_DOCS` / `GABI_BOOKS` / `GABI_SHELF` / `GABI_SUGGEST` | 1024 max tokens (`:124`) × `MAX_TOOL_ITERATIONS` |
| E4 | GABI memory distill | `apps/discord-worker/src/memory-distill.ts:147` | end of a remembered conversation | same | env posture `GABI_MEMORY` (`wrangler.toml:424`) | per distill |
| E5 | GABI confirm-lane restatement | `apps/discord-worker/src/confirm-propose.ts:187` | a T2/T3 proposal | same | env posture `GABI_CONFIRM_T2` (`wrangler.toml:298`) | per proposal |
| **E7** | 🆕 **GABI Groq first line** — one attempt in FRONT of E1, E2, E4 and E5 | `apps/discord-worker/src/gabi-groq.ts:278` (`groqComplete`), driven by `viaGroq` (`:471`) | the same four triggers as E1/E2/E4/E5 — ⚠️ **never E3** | 🆕 **`llama-3.3-70b-versatile`** on **Groq** (`gabi-groq.ts:109`), 🆕 `GROQ_API_KEY_GABI` | ⚠️ **THREE-state posture `GABI_GROQ`** (`wrangler.toml:533`, ships `"off"`, fail-closed coercion) **AND** key presence — plus whatever gate the call it fronts already had | ⚠️ **A NEW PROVIDER = A NEW BILL.** Groq's tier is cheap-to-free **today** and that is not a promise. Bounded by the same `max_tokens` as the call it fronts (24 / 400 / 600 / 200), one attempt, 4 s timeout (`:122`) |
| E6 | Apex shelf-photo identify | `apps/index-worker/src/scan.ts:77` → `src/vision.ts:326` | `POST /api/scan/shelf` from `<estate-search scan>` | 🔴 **`claude-opus-5`** (`vision.ts:216`), `ANTHROPIC_API_KEY` | ⚠️ **`requireEstateMember()` only** (`index.ts:96`) — estate membership, **no role, no capability**. `scan.ts:6-13` says so and calls it *"the one endpoint that spends real money per call"* | $5/$25 per MTok (`vision.ts:211`) |

Haiku pricing is declared at `gabi-chat.ts:95-96` ($1 / $5 per MTok) and every
GABI turn writes one accounting line (`accountTurn`, `gabi-chat.ts:170`) — ⚠️ a
**log line, not a table**, because the Discord Worker has no D1 binding
(`gabi-chat.ts:164-169`).

⚠️ **E7 IS ACCOUNTED SEPARATELY, AND THAT SEPARATION IS DELIBERATE (2026-09-01).**
A Groq turn emits its own `gabi_groq` line (`gabi-groq.ts`, `logGroq`) and
**does NOT call `accountTurn`**, because `gabi_turn` means *Anthropic spend* and
a rung that logged free tokens as Haiku ones would inflate the only number this
document's §2 can be checked against. Two consequences, stated rather than
discovered:

- **`gabi_groq` carries RAW token counts and NO cents.** There is no Groq price
  table in this repo, and a fabricated price would be wrong the day the tier is
  not free. `black_bot_baf` prices Groq at zero for the same reason and records
  it as *"a decision to revisit when it is not"* — this is that same open
  decision, in this estate.
- **Reading the whole GABI bill now takes two filters, not one.**
  `wrangler tail estate-discord | jq 'select(.evt=="gabi_turn")'` is Anthropic;
  `select(.evt=="gabi_groq")` is Groq. A fall-through writes **one of each** for
  the same person-turn, which is correct: it really did spend both.

⚠️ **What E7 does to the OTHER rows' cost, unmeasured:** with the posture at
`first`, E1/E2/E4/E5 should each fire *less often*, and a Groq failure makes a
turn cost E7 **plus** the original row rather than instead of it. Nothing has
measured either direction — see §"NOT verified" in
[`gabi-groq-rung.md`](gabi-groq-rung.md).

### 2.5 What the inventory says, in three sentences

1. **Two unattended billers have no user at all** — L8 and G7 (plus A5, which is
   driven by an unauthenticated public button). A *per-user* toggle is
   structurally inapplicable to them; they need a **per-site switch**.
2. **The estate already carries a per-person, per-site fact to every Worker and
   nobody gates money on it.** `visibility` is fetched, cached and logged in
   both TypeScript catalogs and read by **no** money route in either
   (`grep vis_` is empty in games; in library it appears only in the cache
   round-trip and the log line).
3. **Spend gating today is three unrelated vocabularies**: games and library gate
   by local role; audiobook gates by secret presence; the estate gates neither.

---

## 3. The model — `billing_policy`

### 3.1 The shape

A policy is a list of rules. One rule is:

```
(feature, site, principal_kind, principal_value) → allow | deny
```

| Axis | Values | Wildcard |
|---|---|---|
| **feature** | a registry id — §3.2 | `*` = every feature |
| **site** | `library` · `library2` · `games` · `audiobook` · `estate` | `*` = every site |
| **principal_kind** | `everyone` · `role` · `user` · ⚠️ `system` | — |
| **principal_value** | `null` · a rung name · an estate_user id | — |

⚠️ **`system` is the fourth principal and it is not optional.** L8, G7, A5, A8
and A9 have no human. Modelling them as `everyone` would mean switching a cron
off also switches the whole household off, which is the opposite of what the
owner would mean. `system` is the cron/pipeline principal, and it resolves
alone.

### 3.2 The feature registry — one home, generated outward

Feature ids are declared **once**, in the auth Worker, and synced into each
consumer the same way `estate-auth` and `universes` already are
(`library_catalog/scripts/sync-estate-auth.mjs`,
`scripts/sync-universes.mjs` — a build artifact, gitignored, never a second
source of truth).

| id | Covers | Sites |
|---|---|---|
| `research.details` | L1, L7, G6 | library, library2, games |
| `research.covers` | L2, L9 | library, library2 |
| `research.series` | L3 | library, library2 |
| `research.tier` | G5 | games |
| `research.isbn` | L10 | library, library2 |
| `scan.photo` | L4, L5, G1, G2, G3, E6 | all |
| `barcode.paid` | G4 | games |
| `gabi.panel` | L6 | library, library2 |
| `gabi.chat` | E1, E2, E3 | estate |
| `gabi.memory` | E4 | estate |
| `gabi.confirm` | E5 | estate |
| `sweep.details` | **L8, G7** | library, library2, games |
| `warnings.web` | A2, **A3**, **A5** | audiobook |
| `chapters.llm` | A1 | audiobook |
| `authors.match` | A4 | audiobook |
| `prompts.generate` | A7 | audiobook |
| `pipeline.run` | A8, A9 | audiobook |
| `cli.backfill` | L9–L13 | library, library2 |

⚠️ **A test pins each Worker's checked ids against the registry.** A Worker that
checks `research.cover` (singular) against a registry holding `research.covers`
fails silently open, forever. This is the same class of bug the audit's §8
names as its most common shape — *"a flag flipped, the sweep updated three
places, and the missed copy was always a comment or a README"*.

### 3.3 Resolution — most specific wins, and it can only ever DENY

Rules are ordered by specificity, most specific first. The first rule that
matches decides:

| Rank | Principal | Feature | Site |
|---|---|---|---|
| 1 | `user` | exact | exact |
| 2 | `user` | exact | `*` |
| 3 | `user` | `*` | exact |
| 4 | `user` | `*` | `*` |
| 5 | `role` | exact | exact |
| 6–8 | `role` | … | … |
| 9 | `system` | exact | exact |
| 10–12 | `system` | … | … |
| 13 | `everyone` | exact | exact |
| 14–16 | `everyone` | … | … |
| 17 | **no rule** | — | — |

⚠️ **Rank 17 — no rule — is `allow`, and that is what "default = today's
behaviour" means.** An empty `billing_policy` table changes nothing anywhere.
The estate ships with an empty table and stays exactly as it is until the owner
switches something off.

🔴 **THE ONE RULE THIS WHOLE DESIGN RESTS ON: POLICY CAN ONLY DENY.**

An `allow` rule means *"not denied by this rule"* — it can un-deny a broader
deny (switch `sweep.details` off estate-wide, then back on for `games` alone),
and it **can never open a call the code's own gate closes**. A member with no
`runResearch` capability gets nothing from an `allow` row. The Anthropic key
being unset is still a 503. `GABI_MENTIONS` being off is still off.

The reason is the estate's own standing rule: *act on access-REDUCING orders
immediately; CONFIRM access-INCREASING ones.* A policy table that could grant is
a table where one bad row hands a guest a 40¢ endpoint, and it would be reached
through a browser. A table that can only deny fails in the safe direction by
construction — the worst a corrupt row can do is switch something off.

⚠️ **Corollary: the existing gates are not replaced, they are ANDed.** The
check reads *"the code's gate says yes AND policy does not say no."* Nothing in
§2's "today's gate" column is removed by this work.

### 3.4 Where it lives, and how it travels

**Stored:** the auth Worker's estate D1 (`estate_auth`, binding `DB`) — the one
home for cross-site member facts, and the only estate D1 whose write protocol is
not bulk-replace.

```sql
-- 0016: billing policy. PURELY ADDITIVE — one CREATE TABLE IF NOT EXISTS on a
-- new object, the property that made 0012/0013/0014 safe to apply remotely and
-- unattended. An EMPTY table is exactly today's behaviour (§3.3 rank 17).
CREATE TABLE IF NOT EXISTS billing_policy (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  feature         TEXT    NOT NULL,           -- a registry id, or '*'
  site            TEXT    NOT NULL,           -- a site id, or '*'
  principal_kind  TEXT    NOT NULL
                          CHECK (principal_kind IN ('everyone','role','user','system')),
  principal_value TEXT,                       -- rung name | estate_user id | NULL
  allow           INTEGER NOT NULL CHECK (allow IN (0, 1)),
  why             TEXT    NOT NULL,           -- ⚠️ NOT NULL, per §5
  updated_by      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_policy
  ON billing_policy(feature, site, principal_kind, IFNULL(principal_value, ''));
```

**Travels:** on the channel that already exists, with **one resolver on the
server** — the same stance `visibility`, `dev_access` and `devops` take on the
`/seen` answer (`estate.ts:227-258`: *"a consumer applies it as-is and never
recomputes it"*).

| Consumer | Call | Gains |
|---|---|---|
| A Worker, per request | `POST /api/estate/seen` (already made — `packages/estate-auth/src/seen.ts:110`) | `billing_denied: string[]` — the feature ids denied **for this person on this app**, already resolved |
| A browser | `GET /api/estate/me` (already made — `me.ts`) | the same array — ⚠️ **curtain, not lock**: it decides whether a button is drawn, never whether a call is served |
| A cron / the Python pipeline | `GET /api/estate/billing/policy` with the app's own `ESTATE_APP_TOKEN_*` | `{ system_denied: string[] }` for `principal_kind='system'` on that site |

⚠️ **Three callers, ONE resolver.** The `system` door exists because a cron has
no email to send to `/seen`; it resolves the same rule table through the same
function.

⚠️ **`/seen`'s request body gains one optional field: `local_role`.** Without
it a `role`-principal rule is unresolvable server-side for library and games,
because the estate does not hold their ladders — those live in each app's own
`app_user`. The value is a **claim by the app about its own user**, which is
exactly the right trust level: the app is the authority on its own ladder, it
already holds an app token, and the field is used only to *pick a deny row*,
never to grant anything. It is already available at the call site — the gate's
log line prints `local_role` today (`library_catalog/packages/estate-auth/src/gate.ts:566`).

**Cached:** on the existing cache, with the existing TTL. `billing_denied` rides
with `status` and `visibility` on the app's own user row and ages with them —
§4.5's one-answer rule, *"a cached status brings ITS cached visibility, never a
fresher or staler one"* (`seen.ts:155-160`). `REVOCATION_DELAY_MS = 10 * 60 *
1000` (`seen.ts:19`).

⚠️ **So the switch-off delay is ten minutes, the same number as the revocation
delay, and it is the same number on purpose.** The admin page must say so:
*"takes effect within 10 minutes"*. A page that implies "instantly" invites the
owner to press it twice.

### 3.5 The failure direction, stated rather than discovered

| Failure | What happens | Why |
|---|---|---|
| Directory unreachable, cache fresh | cached `billing_denied` applies | normal |
| Directory unreachable, cache stale | ⚠️ **stale `billing_denied` applies, flagged `stale`** | the existing `estateCheck` behaviour (`seen.ts:215-222`) — one code path, not two |
| Directory unreachable, no cache at all | ⚠️ **ALLOW — today's behaviour** | 🔴 named exposure, see below |
| Policy row references an unknown feature id | ignored, logged | a registry that has moved on must not brick a Worker |
| `local_role` absent from the `/seen` body | `role` rules skipped; `user` and `everyone` rules still apply | an old consumer mid-deploy keeps working |

🔴 **The third row is FAIL-OPEN ON MONEY, and it is a deliberate choice.** The
alternative — deny every paid feature when the directory is down — turns an auth
outage into a household-wide "everything is broken", which is the failure the
estate's own wording rule exists to prevent. The exposure is bounded and
measurable rather than hypothetical: with policy absent, the ceilings that
already exist still hold (`SWEEP_LIMIT = 2` / `8`, `CHAT_MAX_TOKENS = 400`,
`SWEEP_BUDGET = 46` subrequests, the 90 s and 60 s timeouts), so the worst case
is the estate's *current* spend rate for the length of the outage — measured at
~4¢/hour for the library sweep and ~11¢/hour for the games sweep. **A policy
that only ever denies cannot be depended on to fail closed; the ceilings are
what bound the wallet, and this design does not remove them.**

---

## 4. Enforcement — shadow first, per the estate's own rule

Each consumer gets one posture var, in the exact idiom of `ESTATE_CHECK`:

```
BILLING_POLICY = "off" | "shadow" | "enforce"
```

Three values; anything unrecognised falls to `off` **and logs**
(`Board_Game_Catalog/apps/worker/src/middleware/estate.ts:86` is the pattern).
It ships `"off"`.

| Posture | Behaviour |
|---|---|
| `off` | no resolution, no log line, no cost |
| `shadow` | resolve, **log the decision, act on nothing** — the call proceeds and bills |
| `enforce` | a deny refuses, worded per §6 |

### 4.1 ⚠️ The shadow line must carry an OUTCOME, or the flip criterion is unfalsifiable

This is the lesson the estate paid for once already, recorded in
`info/audiobook-auth-soak-2026-08-16.md`: `reportGate()` fired from a `finally`
block **with no outcome field**, so the tail could not separate *a true
regression* from *the gate merely agreeing with today's rules* — and the verdict
was **NOT ENOUGH EVIDENCE, do not flip**.

So one JSON line per decision, carrying:

| Field | Why |
|---|---|
| `feature`, `site` | which cell |
| `principal_kind`, `principal_value` | which rule matched |
| `rule_id` | ⚠️ **the exact row**, so "why was I denied" is answerable |
| `would_deny` | the decision |
| `proceeded` | ⚠️ **whether the call actually happened** — the outcome bit the soak lacked |
| `est_cents` | ⚠️ **what the call cost**, from the constants in §2 — so a shadow soak measures *money that would have been saved*, not just events |

### 4.2 The flip criterion, written down before the soak starts

Flip a site to `enforce` when **both** hold over ≥ 7 days:

1. **Zero `would_deny:true` on any feature the owner did not switch off.** A
   false denial is the failure this soak exists to catch.
2. ⚠️ **At least one `would_deny:true` on a feature the owner DID switch off, on
   that site.** This is the falsifiability half. Without it, "zero denials" is
   indistinguishable from "the instrument never ran" — which is exactly the
   `0 of 0 — unmeasured, not clean` verdict the audiobook soak reached.

⚠️ **Flip one site at a time, and never as a side effect of an unrelated
deploy.**

---

## 5. `why` is required on every rule

`billing_policy.why` is `NOT NULL`, and the admin form will not submit without
it. This mirrors `tools/universes.mjs`'s `--why`, whose own header says an entry
that cannot say why it exists is refused — and it earns its keep here for a
sharper reason: **a switched-off feature is invisible.** Six months later, the
question *"why does cover search not work on padhard?"* has exactly one cheap
answer, and it is this column. Without it, the answer is a bisect.

The refusal shown to a person **does not quote `why`** — it is the owner's
internal note, and it may name people. §6's wording is what a person sees.

---

## 6. What every refusal says — no bare status, ever

⚠️ **Five distinct causes, five distinct sentences.** The estate's rule is that
a refusal says what happened, what it needs, and how to get it, and that a
network failure is never rendered as a permission failure.

| Cause | Sentence |
|---|---|
| Not signed in | *"Sign in to run a lookup."* |
| Awaiting approval | *"Your estate membership is still awaiting approval."* |
| Insufficient role (existing) | *"Running research needs the moderator role. Ask an owner or admin to grant it."* — already correct, `library_catalog/apps/web/src/lib/errors.ts:80` |
| Revoked | *"This account no longer has access here."* |
| **NEW — denied for THIS SITE** | *"Paid cover search is switched off for this catalogue. The owner can turn it back on."* |
| **NEW — denied for THIS PERSON** | *"Paid cover search is switched off for you. Ask the owner."* |
| Outage | *"Couldn't reach the estate directory — that's an outage, not a permissions problem. Try again in a minute."* |

⚠️ **The site/person split is load-bearing.** *"Switched off for you"* sends
someone to ask the owner; *"switched off for this catalogue"* tells them not to
bother asking, because nobody there can do it either. Collapsing them into one
sentence wastes somebody's evening.

⚠️ **Prefer not rendering a control nobody can use** — that is what
`/api/estate/me`'s `billing_denied` is for — **but never hide so much the page
looks broken.** A greyed control with the sentence beneath it beats a missing
one.

### 6.1 🔴 Three refusal defects found while reading, worth fixing in Phase 0

| Defect | Where | Fix |
|---|---|---|
| `estate_revoked` returns a **bare** `{error}` with no `detail` — its sibling one line down does carry one | `Board_Game_Catalog/apps/worker/src/middleware/estate.ts:189` (vs `:192`) | add the sentence |
| Universe page renders `err.message` verbatim, which for an `ApiError` is `body?.error ?? "HTTP <status>"` — so a person sees the literal word `forbidden` or `HTTP 503` | `library_catalog/apps/web/src/pages/UniversePage.tsx:61,67` (bypasses `describeError`) | route through `describeError` |
| Games' `ESTATE_CHECK` comment says *"deliberately `off` … must be inert until the owner flips it"*; the value is `enforce` | `Board_Game_Catalog/apps/worker/src/middleware/estate.ts` comment vs `wrangler.toml` | update the comment |

✅ **ALL THREE FIXED 2026-08-26.** ⚠️ **None of them lives in this repo** —
defect 2 is `library_catalog`, defects 1 and 3 are `Board_Game_Catalog` — so
the commits are there, not here.

| # | Repo | Commit | What landed |
|---|---|---|---|
| 1 | `Board_Game_Catalog` | `93fad25` | `estate_revoked` carries `detail: 'this account no longer has access to the estate; ask an owner to restore it'` |
| 2 | `library_catalog` | `06a2bfb` | `UniversePage` routes through `describeError`; `err.message` gone |
| 3 | `Board_Game_Catalog` | `93fad25` | `wrangler.toml`'s comment now names the value that is actually set |

**Each got a tripwire, not just a fix**, because all three are the kind of
defect that reappears silently:
`Board_Game_Catalog/apps/worker/src/lib/estate-refusals.test.ts` (6 tests) asserts
**every** `c.json` refusal in `estateGate` carries a `detail`, that the outage
stays a 503, and that the `ESTATE_CHECK` comment block contains the literal
`⚠️ ESTATE_CHECK IS "<value>"` matching the committed value — so the next flip
cannot skip the prose beside it. `library_catalog/apps/web/test/universe-page-refusal.test.ts`
(4 tests) pins the `describeError` route and forbids `err.message` returning.

⚠️ **Two things worth carrying into the rest of this design.**

1. **"The client translates the code" is not compliance.** Defect 1 survived
   because `Board_Game_Catalog/apps/web/src/lib/errors.ts` maps
   `estate_revoked` to a sentence, so no browser ever showed the bare code.
   The rule is about the **response**; curl, GABI, a second surface and every
   future app got a machine code and no route back. The `billing_denied`
   sentences in §6 above need the same reading — the Worker must carry them,
   not only the React app.
2. 🔴 **Defect 2's real harm was the OUTAGE, not the bare code.**
   `estate_unreachable` is a 503, and rendering `err.message` put it on screen
   worded exactly like a refusal — which sends people asking for access they
   already have. That is the failure §6's own outage row exists to prevent, and
   it was live on a real page while the row was being written.

**NOT verified:** nothing was deployed for any of the three, and no live
403/503 was provoked. `Board_Game_Catalog`'s live Worker still answers the bare
`estate_revoked` body until someone ships it.

---

## 7. The admin UI — a "Spending" panel on the Members page

### 7.1 The matrix

One panel, **features as rows, sites as columns** — the transpose of the
existing permission grid, deliberately, because the owner's question here is
*"what is switched on where"* and not *"what can this person do"*.

Rows group by kind: **Research** · **Photo scan** · **GABI** · **Unattended
(cron)** · **Command line**. Each cell is one of four states:

| State | Means |
|---|---|
| **On** | no deny rule reaches this cell |
| **Off** | a rule denies it for `everyone` on this site |
| **Off for some** | denied for one or more `user`/`role` principals — the count is shown, the drawer lists them |
| **n/a** | this site does not implement this feature |

⚠️ **Each row carries the feature's own cost**, taken from the constants in §2
(`6¢`, `2–8¢`, `6–40¢`, `$5/$25 per MTok`, `4¢/hr`). The owner is switching off
something whose price he can see. ⚠️ Labelled *"the code's own estimate"*, never
*"spend"* — the measured spend is the `/status/agents` meter's question, not
this panel's.

⚠️ **The `sweep.details` row shows a clock icon, not a person icon**, because it
is the `system` principal. Switching it off is the only control in the estate
that stops an unattended hourly biller without a deploy, and the panel says so
in one line.

### 7.2 The per-member drawer

On the **existing member card**, in the **existing** `perm-grid`
(`admin/admin.js:1737`), a new column: **Spending**. It follows that page's
established grammar exactly, which the file's own header pins
(`admin.js:99-112`): **no per-row apply button anywhere, one per-card Save that
appears the moment anything changes, and a Discard beside it.**

```
Site               Visible   Role         What that role can do        Spending
Audiobooks/Ebooks  [x] [x]   admin        runs people…                 all on
Library            [x]       moderator    spends and moderates…        ⊘ 2 off
Padhard            [ ]       —            no site role…                n/a
Games              [x]       contributor  builds the catalog…          all on
```

Clicking the Spending cell opens a checklist of that site's features for that
person, each with a **Why** box that must be filled to save a deny. Staged, not
applied — the card's one Save writes visibility, roles and spending together, in
the order the file already documents.

⚠️ **The owner's own row shows every feature on and every control disabled**,
matching how the page already treats owners (*"Owners get no editable controls
— their row auto-fills max everywhere"*, `info/role-capability-map.md`). The
`OWNER_EMAILS` break-glass cannot be narrowed into a lockout, and a spend switch
is not the place to start.

### 7.3 What the panel links to and does not restate

- **"How much has been spent"** → a link to `/status/agents`. Not a number here.
- **"Pause the pipeline for tonight"** → a link to the `/status` ingestion card.
  ⚠️ That control is a **time** switch on the home machine; this panel is a
  **policy** switch. Two different questions, and a number worth showing twice
  is a number that will eventually disagree with itself.
- **"Which rung spends"** → a link to `info/role-capability-map.md`.

**Mockup:** https://claude.ai/code/artifact/2f288c59-d6ca-4fdf-b3e0-da732f0e78d1
(private artifact, published 2026-08-26) — the matrix, the drawer, the four cell
states and the refusal wording, in the estate cyberpunk theme, light and dark.

---

## 8. Migration and rollout

| Phase | What lands | Rough effort | Notes |
|---|---|---|---|
| ~~**0**~~ | ✅ **DONE 2026-09-02.** `apps/auth-worker/src/billing-registry.ts` + its literal pin test. (The three §6.1 refusal defects landed 2026-08-26, in the other two repos) | landed | §11 |
| ~~**1**~~ | ✅ **DONE 2026-09-02.** All of it: 0016 applied to remote `estate_auth`, the resolver, `/seen`'s two new fields, `/me`, the system door, the approver-gated write routes, 39 tests | landed | §11 |
| 🔄 **2** | The Spending panel: ✅ **DONE 2026-09-02** (the §7.1 matrix, live on `/admin`). ⚠️ The §7.2 per-member DRAWER is **not built** — the resolver and write door already take `user`/`role` principals, only the UI is missing | half landed | §11 |
| 🔄 **3** | ✅ `index-worker` reads the answer 2026-09-02 and ships `BILLING_POLICY = "off"`. ☐ library, library2, games still to do. 🔴 `discord-worker` is BLOCKED on an owner step — `estate-auth` holds no Discord token, so `identifyApp` cannot identify it, and adding one to `CONSUMER_APPS` would also make that bearer a valid `/seen` bearer (guarded against by `test/dev-access.test.ts`). Access-increasing ⇒ confirmed, never assumed | ~1 day | ⚠️ `off` in the committed file; shadow flipped per site |
| **4** | ⏳ **Soak ≥ 7 days**, then `enforce` one site at a time against §4.2 | ~½ day work, 7+ days elapsed | Not a build task — a measurement |
| **5** | 🔴 The audiobook Python paths (A1–A9): a small policy client (one HTTPS GET on the app token, cached to a file, 10-min TTL) + the `--no-llm` wiring | ~1 day | The hard one — no estate client exists on that side today |
| ~~**6**~~ | ✅ **DONE 2026-08-26, ahead of the plan** — A3's public button requires sign-in on `create`/`update`, `delete` **and** `read` kept open. ⚠️ In Firestore `write` COVERS delete, so this row's own wording would have broken the fulfiller | landed | §9 Q3 |

**Total: ~5 days of build, plus a soak.** ⚠️ Labelled guesses. Phases 0–2 touch
one repo (`catalog-platform`) and are the cheap, reversible half; phases 3–5
touch three more repos and each is a separate deploy.

⚠️ **Sequencing rule, from the estate's own mechanical guards: migrate before
deploy, always.** 0016 applies remotely and unattended safely (it is one
`CREATE TABLE IF NOT EXISTS` on a new object, the property 0012/0013/0014 relied
on), so it can go ahead of the Worker that reads it.

---

## 9. Open questions — each with a recommendation

### Q1 🔴 Should policy be able to GRANT, or only DENY? *(the load-bearing one)*

A grant-capable table is more expressive: the owner could hand one person paid
research without moving them up the role ladder. It is also a browser-reachable
path to access-increasing changes.

> **Recommendation: DENY-ONLY, and make it structural rather than a convention**
> — the resolver returns a set of denied features and the call site ANDs it with
> its existing gate, so there is no code path where a policy row can open
> anything. The estate's standing rule is that granting is neither reversible
> nor safe to do generously, and *"an ambiguous instruction read generously can
> hand real people real access nobody intended"*. If the owner later wants
> per-person grants, that is a **role-ladder** change on the site that owns the
> ladder — the mechanism that already exists for it.

### Q2 ⚠️ The `system` principal contradicts a stated design intent — whose wins?

`Board_Game_Catalog/apps/worker/src/lib/details-sweep.ts:53-57` deliberately
refuses to make `SWEEP_LIMIT` an env var: *"a knob nobody tunes is a knob that
hides its value."* A central spending switch reaches into exactly that sweep.

> **Recommendation: both stand, because they are different things.** Keep
> `SWEEP_LIMIT` hard-coded — it is a **knob** (a number somebody must choose
> well), and the argument against it is sound. Add only an **on/off switch** for
> `sweep.details` — a switch has no value to hide and one obvious meaning.
> ⚠️ **Ship no numeric budgets or per-person spend caps in v1.** A cap needs a
> spend ledger to enforce against, the Discord Worker has no D1 to keep one in
> (`gabi-chat.ts:154-159`), and a cap that silently mis-counts is worse than no
> cap. On/off first; measure; decide about caps with data.

### Q3 🔴 A3 — the public "Request AI warning check" button — gate it now, or later?

Today any anonymous visitor queues work an hourly GitHub Action pays Anthropic
for (`site/user-warnings.js:102` → `firestore.rules:857-861` → `validCwRequest()`
at `:646`, which never inspects `request.auth`). It is the only money path in
the estate reachable with no identity at all.

> **Recommendation: gate it in Phase 6, NOT as part of this build, and treat it
> as its own owner decision — but write it down as a `KNOWN_ISSUES.md` entry
> today.** Two reasons for the split: it is a `firestore.rules` change in a
> repo this design otherwise only reads, and ⚠️ **`allow delete: if true` on the
> same block is load-bearing** — the fulfiller clears requests with the public
> web API key, so a gate must be added on `create`/`write` only or the pipeline
> breaks. The cheap interim, if the owner wants one now: switch `warnings.web`
> off for `system` on the `audiobook` site, which stops A5 paying for the queue
> without touching the rules file. ⚠️ That interim needs Phase 5 first.

✅ **ANSWERED BY DOING IT — GATED AND DEPLOYED 2026-08-26**
(`audiobook_catalog` `172e3ba`). The recommendation above was *"gate it in
Phase 6"*, and it was overtaken: this is the only money path in the estate
reachable with no identity at all, and Phase 6 has no date.

```
- allow write:          if validCwRequest()
+ allow create, update: if request.auth != null && validCwRequest()
  allow read:   if true      # untouched — the fulfiller LISTS with the public key
  allow delete: if true      # untouched — the fulfiller CLEARS with the public key
```

⚠️ **The `delete` warning above was right, and sharper than it reads:** in
Firestore `write` *covers* delete, so "add the gate on `create`/`write`" would
itself have broken the fulfiller. The gate had to be on `create, update`
specifically, with `delete` left as its own statement. Read is load-bearing for
the same reason — the fulfiller lists the collection with the same public key.
It never writes; checked in `fetch_content_warnings.py`, not assumed.

The gate is `request.auth != null` and nothing more — the same mechanism
`/readingLists` uses, **not** a new one. ⚠️ **A `site_roles` check was
considered and refused**: that collection holds admin/moderator only, so
requiring it would have locked out every ordinary member of the household to
fix a problem they are not causing. This is the shape §3's *"policy can only
DENY"* rule protects against from the other side — an over-tightened gate is
also a wrong answer.

UI: signed-out readers get *"Sign in to request a content warning."* in the
button's place — ⚠️ keyed on the **live uid**, never `getSession()`, because a
legacy passphrase session carries a display name and **no `request.auth` at
all** and would otherwise be handed a button that always fails.

**Verified:** rules deployed and compiled; `scripts/smoke_cw_request_rules.py`
**9/9 against the LIVE rules**, asserting both directions *and* that the
anonymous read and delete still answer 200; vitest 781. ⚠️ **NOT verified:**
nobody has seen the sentence rendered, and the static site was not republished
in that pass — the live page still shows the button, which now fails with a
worded refusal instead of succeeding.

⚠️ **Phase 6's row (§ build plan) is therefore CLOSED, and the `KNOWN_ISSUES`
entry the recommendation asked for was never needed** — the fix landed first.
The interim (`warnings.web` off for `system`) is moot.

### Q4 Does a per-user deny follow the DELEGATED path?

L7 and every GABI confirm-lane verb run on **borrowed authority** — the bot acts
as a named person (`gabi-delegated.ts:383`).

> **Recommendation: yes, and resolve on the ON-BEHALF-OF person, never the bot.**
> The confirm-lane design already establishes that the capability is checked
> twice — at propose and at press — *"because revocation beats everything"*
> (`info/gabi-confirm-lanes-design.md`). A billing deny is the same class of
> fact and takes the same treatment. Denying the *bot* instead would switch the
> feature off for the whole household, which is not what a per-person rule
> means.

### Q5 Should the CLI scripts (L9–L13) be gated at all?

They run on the owner's machine, from his shell, with his key. Five of the
thirteen library paths have no gate but a command-line flag, and one
(`research-queue.mjs:99`) hard-codes `OWNER_USER_ID = 1` and checks nothing.

> **Recommendation: honour policy, but as a WARNING with an explicit
> `--ignore-policy` escape hatch, never a hard refusal.** A local script the
> owner runs deliberately is not the threat model, and a CLI that refuses its
> operator is a CLI that gets edited. But the estate's own rule is that a rule
> that matters gets promoted from prose to a script with a deliberate escape
> hatch — and a warning that says *"cover search is switched off for library;
> re-run with --ignore-policy"* is exactly that.

### Q6 Who may see the Spending panel — approvers, or devops?

> **Recommendation: `requireApprover()`, matching every other control on
> `/admin`.** Spending policy is a household decision, not an operations one,
> and the page already refuses non-approvers wholesale. ⚠️ Read access follows
> write access here on purpose: the list of who has been switched off is a fact
> about people.

---

## 10. What was NOT verified

- **Nothing live.** No production request, no D1 read, no `wrangler secret
  list`, no browser, no `wrangler tail`. Every claim in §2 is source-read.
- **Whether any Anthropic key is actually set** on any deployed Worker. If the
  games Worker's key is unset, G3/G6/G7 no-op and G1/G2/G4/G5 return a 503
  (`Board_Game_Catalog/packages/research/src/client.ts:26`).
- **Actual spend to date.** The library keeps `research_run` token totals in D1
  (surfaced at `routes/research.ts:146-152`) and the Discord Worker keeps
  accounting lines in `wrangler tail` output only (`gabi-chat.ts:154-159`).
  Neither was queried.
- **Whether `HARDCOVER_TOKEN` and `DOESTHEDOGDIE_API_KEY` cost money.** Both are
  called ahead of Claude in the audiobook content-warning chain; no pricing
  evidence exists in-repo either way. They are **not** in the inventory as
  billers, and that is an assumption, not a measurement.
- **Which Windows Scheduled Tasks are actually registered and enabled.** The
  task names in §2.3 come from `.bat` header comments; the schedule lives in
  Task Scheduler, outside every repo (`audiobook_catalog/app/core/pipeline_schedule.py:18`
  says so).
- **Whether `AudiobookIngestNightly` spends** — its target script was not
  opened.
- **The effort figures.** No comparable build was timed.
- **`tools/lib/universes.mjs`, `Board_Game_Catalog`'s test suite and
  `library_catalog`'s test suite were not RUN**, so every guard test cited is
  described from its comments, not from a passing run.

### 🔴 One thing found while reading that is not part of this design

`Board_Game_Catalog/apps/worker/.dev.vars` contains a plaintext
production-shaped Anthropic key. It is gitignored and `git ls-files` confirms it
is untracked — it has **not** leaked to the repo. But it sits in a
OneDrive-synced folder, so copies exist outside the owner's control, and
`scripts/push-secrets.mjs:35` treats that file as the push source, so it is
intentional plumbing rather than a stray. **Worth a rotation decision.** Value
not read, not quoted, not stored anywhere in this doc.
</content>

---

## 11. AS BUILT — 2026-09-02

⚠️ **Everything above §11 is the DESIGN as written on 2026-08-26.** It is kept
verbatim rather than rewritten in place, because the argument is the valuable
half and a design edited to match its implementation stops being checkable
against it. **This section is where the two differ.**

### 11.1 What exists, and where

| Piece | File | Deployed |
|---|---|---|
| The registry (18 ids) + its literal pin | `apps/auth-worker/src/billing-registry.ts` · `test/billing-registry.test.ts` | `estate-auth` `e9aee6f4` |
| The resolver + the posture | `apps/auth-worker/src/billing-policy.ts` · `test/billing-policy.test.ts` | same |
| The table | `apps/auth-worker/migrations/0016_billing_policy.sql` | applied to remote `estate_auth` **before** the deploy |
| D1 access | `apps/auth-worker/src/billing-db.ts` | same |
| The four doors | `apps/auth-worker/src/billing.ts` · `test/billing-routes.test.ts` | same |
| `/seen` + `/me` + `/hello` | `apps/auth-worker/src/estate.ts`, `me.ts` | same |
| The shared client | `packages/estate-auth/src/seen.ts` | — |
| The Spending panel | `sites/heygabi-home/public/admin/{admin.js,index.html}` | `heygabi-home` `a52a8b81` |
| E6's call-site gate | `apps/index-worker/src/billing-gate.ts` · `test/billing-gate.test.ts` | `catalog-index` `4804dbb6`, `BILLING_POLICY = "off"` |
| E6's cache column | `apps/index-worker/migrations/0005_billing_cache.sql` | applied to remote `index_catalog` **before** the deploy |

**The review link:** <https://heygabi.ai/admin/> → the **"Spending — what may
bill the model, and where"** disclosure, directly under the permission map.

### 11.2 Where the build DEPARTS from the design, and why

Each of these is a decision a later session could reasonably have made
differently, so each is written down rather than left to be re-derived.

| # | The design says | The build does | Why |
|---|---|---|---|
| 1 | §3.3's rank table lists all sixteen rungs in one ladder | **`system` resolves ALONE in BOTH directions** — a cron ignores `everyone` rules AND a person ignores `system` rules | §3.1 states the first half outright. The second follows from the same argument: an `everyone` deny is a statement about PEOPLE, and letting it silently stop an unattended sweep would make §7.1's clock-icon row a lie about what the click did |
| 2 | §3.4: `/me` gains *"the same array"* | **a per-SITE map** | `/me` has no site — its origins are the apex AND the audiobook site — and a flat union would HIDE a control on a site where it is allowed. It is a curtain either way (§3.4), so the extra detail costs nothing |
| 3 | §3.2's table registers E7 under nothing (it predates the Groq rung) | **E7 is a `frontedBy` RUNG, not a feature and not a path** | It fronts E1/E2/E4/E5 across THREE features; a path can only have one switch, and the check runs before the ladder — so denying `gabi.chat` denies BOTH providers, no Groq attempt and no Haiku fall-through |
| 4 | §3.2 double-covers L9 and L10 | **reproduced verbatim, and pinned by a test** | Policy can only deny, so a path under two switches is refused if EITHER denies. Tidying it would have been a change to the spec dressed as a cleanup; a test now pins the list so a NEW double cover has to be argued for |
| 5 | §7.1/§7.2 do not say what a WRITE door refuses | **an `OWNER_EMAILS` row cannot be denied** (worded 409) | §7.2's *"the owner's row shows every control disabled"* is a UI rule, and a UI rule is one fetch away from being bypassed. The break-glass must not be narrowable into a lockout, and a spend switch is not the place to start |
| 6 | §2 registers 36 paths | **35 registered; A6 deliberately left out** | A6 is keyed on a secret absent from `.env` ON PURPOSE and bills zero. A switch that does nothing is worse than no switch — the design's own dead-row warning |
| 7 | §7.2's per-member drawer ships with the panel | **not built** | The owner's decision of record was *"on/off per registered money path"* — the per-SITE axis. The per-PERSON axis is tracked in `TODO.md`; the resolver and the write door already take `user` and `role` principals, so only the UI is missing |

### 11.3 What is NOT verified

- **No rule has ever been written.** The `billing_policy` table is empty, so
  the resolver has never run against a non-empty table in production. Every
  resolution assertion is a unit test.
- **`billing_denied` has never been seen on a real `/seen` or `/me` answer** —
  both need a credential a session must not use.
- 🔴 **Nobody has rendered the Spending panel signed in.** No cell has been
  clicked, no rule has been written from a browser, and the matrix has never
  been drawn against a real `GET /api/estate/billing/rules` answer. There is no
  browser test harness for `admin.js`; `check:home` proves it parses.
- **The gate has never fired.** `BILLING_POLICY` is `"off"` on the one deployed
  consumer, so no shadow line has ever been emitted by a live Worker.
- **What WAS verified live** (2026-09-02, after the deploys): both Workers'
  `/api/health` answered 200; `GET /api/estate/billing/policy` with no bearer
  answered `401 {"error":"unauthorized"}`; `GET /api/estate/billing/rules`
  unauthenticated answered `401 {"error":"unauthenticated"}`; the `OPTIONS`
  preflight for `DELETE` from `https://heygabi.ai` answered 204 with
  `Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS`, and the same
  preflight from a foreign origin got **no** `Access-Control-Allow-Origin`;
  `https://heygabi.ai/admin/` serves both the panel markup and
  `renderSpendingPanel`.
