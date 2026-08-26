# Estate secrets review — 2026-08-26

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (public repo
> — **NAMES only, never values**; no member emails).
> **Last verified: 2026-08-26** — every `wrangler secret list`, `gh secret list`
> and `gh variable list` figure below was taken fresh that day against the LIVE
> account. The `.env` key names were taken fresh from disk the same day.
>
> ⚠️ **WHAT WAS *NOT* CHECKED — read this before trusting a row.**
> - **No value was read, printed, grepped or compared.** Not one. `.dev.vars`,
>   `.env`, `docs/access/keys/*.txt`, the service-account JSONs and every
>   `wrangler secret put` value were left unopened on purpose. So this review
>   proves **a NAME exists on a holder**, and NEVER that two holders carry the
>   **same value**. Every "paired" row below is a *name-parity* check.
> - **No secret was set, rotated, deleted or deployed.** Read-only throughout.
> - **No console was opened** (Cloudflare, Firebase, GCP, Discord, GitHub web).
>   Console-held facts are quoted from the docs that recorded them, with their
>   dates.
> - **Whether a given `.dev.vars` contains a given KEY NAME is unverified**,
>   because the file is never opened. Where this review says "a `.dev.vars`
>   exists for X", that is a statement about the FILE, not its contents.
> - **The OneDrive sync state of any individual file was not measured** — only
>   that every repo lives under `C:\Users\nbasl\OneDrive\Documents\`.
> - **Git history was scanned by PATTERN, not exhaustively.** Five high-signal
>   patterns over every commit in all four repos (§3.2). A credential in a shape
>   no pattern matches would not appear.
>
> **Where this sits:** [`../access/RECOVERY.md`](../access/RECOVERY.md) §11.3 is
> the estate's **custody source of truth** (updated the same day from this
> review). `library_catalog/docs/access/secrets.md` is the **operational
> how-to**. `audiobook_catalog/docs/access/CREDENTIALS.md` is the **complete
> cross-repo catalogue** (gitignored, local-only). **This file is the dated
> AUDIT** — a measurement, not a third living doc. Do not let it become one.

---

## 0. The 60-second version

**59 secret bindings across 8 Worker environments, 12 GitHub Actions secrets
across 4 repos, and ~14 credentials in one local `.env`.** Every repo is
**PUBLIC** (KI-2).

**The five things that matter:**

1. 🔴 **11 live secrets have NO readable master** — no `.dev.vars`, no `.env`,
   no key file. Losing this machine or the Cloudflare account means re-minting
   them, and **6 of the 11 are paired**, so each re-mint is a two-sided
   operation. `apps/auth-worker` and `apps/audiobook-worker` have **no
   `.dev.vars` at all** — that is the single biggest custody hole, and it is
   new information: RECOVERY §11.3 did not say so.
2. ✅ **No credential VALUE was found in any public repo's git history** by the
   five patterns scanned. The one known leak (`PEER_TOKEN`) is rotated and the
   plaintext is out of `PEERS`. The `AIza…` hits are Firebase **web** API keys,
   public by design.
3. ✅ **All 17 must-be-equal pairs EXIST on both sides by name.** Two
   deliberate absences are correct and documented. One pair
   (`ESTATE_APP_TOKEN_LIBRARY2`) that CREDENTIALS.md still calls *"pipe
   outstanding"* is now **closed** — that doc is stale.
4. ⚠️ **Four `.dev.vars` files hold plaintext masters on a OneDrive-synced
   disk**, plus three raw-value `.txt` files in `catalog-platform/docs/access/keys/`.
   All are correctly gitignored; none are protected from cloud sync.
5. 🔴 **`ESTATE_EVENTS_TOKEN` is still not a `catalog-platform` repo secret** —
   measured again today, unchanged since 2026-08-21. KI-10's backup-failure
   notification has now been a no-op for **five days**, not two.

**Two stale claims corrected by measurement** (both would mislead an incident
reader): `TOKEN_SIGNER_KEY` **IS set** (two docs say it is deliberately unset),
and `ANTHROPIC_API_KEY_GABI` lives on **`discord-worker`**, not `estate-auth` as
RECOVERY §11.3 said.

---

## 1. Method, and the rule this review was run under

**The absolute rule:** never read, print, grep or open any file or command
output that could contain a secret VALUE. `wrangler secret list` and
`gh secret list` print names only and were the primary instruments.

| Instrument | What it proves | What it does NOT prove |
|---|---|---|
| `npx wrangler secret list --config <toml> [--env <env>]` | a NAME exists on that Worker env | nothing about the value |
| `gh secret list` / `gh variable list` | a NAME exists on that repo | nothing about the value |
| `grep -oE '^[A-Z_0-9]+=' .env` | the KEY NAMES in the pipeline `.env` | ⚠️ **misses `Claude-llm`** — see §3.1 |
| `git rev-list --all \| xargs git grep -l -E <pattern>` | commit:path of any file matching a credential SHAPE | absence of shapes not scanned |
| `git check-ignore -v <path>` | the exact `.gitignore` line protecting a file | that the file was never committed earlier |
| `ls -l` on a `.dev.vars` | it exists, its size, its mtime | its contents (deliberately) |

⚠️ **`audiobook_catalog/docs/access/CREDENTIALS.md` was opened for NAMES only,
and only after confirming it holds no live value.** Five credential-shape
patterns were counted (not printed) across the file; the single `sk-ant-` hit
was measured at **15 characters** — a prefix/redaction, not a usable key (a real
Anthropic key is ~108 chars) — and sits inside finding F-9, a section about a
leak MECHANISM. Only §1, §6 and §7 of that file were read. ⚠️ A bash `sed` read
of it was **refused by the harness classifier**, correctly; the read went
through the Read tool with a bounded line range instead.

---

## 2. The inventory

### 2.1 Totals by holder — measured 2026-08-26

| Holder | Kind | Secrets |
|---|---|---|
| `estate-auth` (`apps/auth-worker`) | Worker | **12** |
| `catalog-index` (`apps/index-worker`) | Worker | **8** |
| `estate-discord` (`apps/discord-worker`) | Worker | **10** |
| `audiobook-worker` (`apps/audiobook-worker`) | Worker | **4** |
| `ebooks-door` (`apps/ebooks-door`) | Worker | **0** ✅ correct, see §4.9 of CREDENTIALS.md |
| `library-catalog` (library `apps/worker`, top-level env) | Worker | **11** |
| `library-catalog-friend` (library `--env friend`, padhard) | Worker | **10** |
| `board-game-catalog` (BGC `apps/worker`) | Worker | **4** |
| **Worker subtotal** | | **59 bindings / 8 environments** |
| `skymitch9/catalog-platform` | GH Actions | 2 (+1 variable) |
| `skymitch9/library_catalog` | GH Actions | 2 (+1 variable) |
| `skymitch9/Board_Game_Catalog` | GH Actions | 2 (+1 variable) |
| `skymitch9/audiobook_catalog` | GH Actions | 6 (+1 variable) |
| **GH subtotal** | | **12 secrets / 4 variables** |
| `audiobook_catalog/.env` | local file | **~14 credentials** + 16 config keys (30 listed; ⚠️ +≥1 missed, §3.1) |
| `catalog-platform/docs/access/keys/` | local files | **3 raw values** |
| auth-worker KV (hashed, self-service) | KV | 5 minted key families — `machine-keys.ts` |

⚠️ **All four repos are PUBLIC** — re-verified today via `gh repo view --json
visibility`: `catalog-platform`, `library_catalog`, `Board_Game_Catalog`,
`audiobook_catalog` all `PUBLIC`. KI-2 stands.

### 2.2 The estate platform — `catalog-platform`

**Holder legend:** *verifier* = the side that CHECKS the bearer; *presenter* =
the side that SENDS it. A pair desyncs into a silent 401/403/404, never an error.

| Secret | Holder(s) | What it authenticates (code) | Shared / per-instance | Readable master | Risk notes |
|---|---|---|---|---|---|
| `TOKEN_SIGNER_KEY` | `estate-auth` | Signs short-lived Firebase custom tokens for the SSO layer — `apps/auth-worker/src/env.ts:213`, `src/token-signer.ts`, `src/session.ts` | single holder | 🔴 **NONE** — GCP console re-mint (`estate-token-minter` SA, a *different* SA from `FIREBASE_SERVICE_ACCOUNT`) | ⚠️ **Impersonation-capable: signs a session for ANY uid, owner included** (`machine-keys.ts:239`). 🔴 **Two docs say it is UNSET; it IS SET** — §3.6 |


> **Main-session follow-up, 2026-08-26 (measured against `apps/auth-worker/src/env.ts:198-213`, `session.ts:131`, `machine-keys.ts:240-245`):** `TOKEN_SIGNER_KEY` being SET is the **intended** state, not an exposure. It is the SSO Phase-2 session-cookie signer — a dedicated, zero-IAM service account whose only power is minting a Firebase custom token, read by `session.ts` and carried in `machine-keys.ts`'s registry with a ROUTINE yearly rotation. The env.ts comment "DOES NOT EXIST YET as of this build" and `CREDENTIALS.md` §7 rule 7 are the stale facts; the secret is right. Action: fix those two comments, not the key. Its no-readable-master status (finding 1) stands — it is a console-minted key file, and rotation is "create a second key → put → deploy → verify → delete the old".
| `FIREBASE_SERVICE_ACCOUNT` | `estate-auth`, `audiobook-worker`, `estate-discord` | Firebase/identitytoolkit REST for `/api/estate/site-roles` etc. — `apps/auth-worker/src/env.ts:193`, `src/firebase-sa.ts`, `packages/firebase-sa/src/index.ts` | **shared by design — 6 holders** | ✅ 2 local JSONs in `audiobook_catalog` (§7a of RECOVERY) | ⚠️ **Widest credential in the estate.** 6 holders: 3 Workers + GH secret `FIREBASE_SERVICE_ACCOUNT_JSON` + 2 files. CREDENTIALS.md §6 says 5 — now 6 |
| `ESTATE_APP_TOKEN_LIBRARY` | `estate-auth` (verifier) + library **main** | `POST /api/estate/seen` bearer — `apps/auth-worker/src/env.ts:107,463`; library `apps/worker/src/env.ts` | per-instance | library `.dev.vars` (file exists; contents unopened) | rotate both sides in one sitting |
| `ESTATE_APP_TOKEN_LIBRARY2` | `estate-auth` (verifier) + library **friend** | same route, padhard's door — `env.ts:148,471` | per-instance | 🔴 **NONE** — structurally: auth-worker has no `.dev.vars`, and there is **no `.dev.vars.friend` by design** | ⚠️ Was an orphan for a day (F-5). ✅ **Now paired** — CREDENTIALS.md §6 still says *"pipe outstanding"*, stale |
| `ESTATE_APP_TOKEN_GAMES` | `estate-auth` (verifier) + BGC Worker | same route — `env.ts:108,465` | per-instance | BGC `.dev.vars` (file exists) | — |
| `ESTATE_APP_TOKEN_INDEX` | `estate-auth` (verifier) + `catalog-index` | same route — `env.ts:109,467`; `apps/index-worker/src/env.ts:81` | per-instance | index `.dev.vars` (file exists) | — |
| `ESTATE_APP_TOKEN_AUDIOBOOK` | `estate-auth` (verifier) + `audiobook-worker` | same route — `env.ts:117`; `apps/audiobook-worker/src/env.ts:41`, `src/ebook-gate.ts:172` | per-instance | 🔴 **NONE** — neither holder has a `.dev.vars` | both holders write-only |
| `ESTATE_APP_TOKEN_DISCORD_DOCS` | `estate-auth` (verifier) + `estate-discord` | Door B on the estate docs corpus, **plus `X-Estate-On-Behalf-Of`** — `apps/auth-worker/src/env.ts:184`, `src/estate-docs.ts:544`; discord `src/estate-docs-exec.ts` | per-edge, exactly 2 holders | discord `.dev.vars` (file exists) | ⚠️ **Deliberately NOT in `CONSUMER_APPS`** (`env.ts:166`) — adding it there would silently widen it into a `/seen` bearer. ⚠️ Must never be merged with `ESTATE_APP_TOKEN_DISCORD` (`env.ts:157`) |
| `ESTATE_CONDUCTOR_TOKEN` | `estate-auth` (verifier) | `POST /api/estate/ops/agent-board` write door — `src/agent-board.ts:15,352`; `src/env.ts:295` | single holder | ✅ `docs/access/keys/estate-conductor-token.txt` (gitignored) | Blast radius: rewrite the agent board — a **trust** surface. Superseded in part by the self-service minted key (`estate:conductor:token` in KV) |
| `ESTATE_EVENTS_TOKEN` | `estate-auth` (verifier) + `catalog-index` + `audiobook-worker` (presenters) | `POST /api/estate/ops/worker-events` — `src/worker-events.ts:201,225`; `apps/index-worker/src/env.ts:99`; `apps/audiobook-worker/src/index.ts:125` | **shared by design — 3 Workers** | ✅ `docs/access/keys/estate-events-token.txt` | 🔴 **NOT a GH repo secret** — measured again 2026-08-26, `gh secret list` still returns exactly `CLOUDFLARE_API_TOKEN` + `FIREBASE_SERVICE_ACCOUNT_JSON`. **KI-10 open 5 days** |
| `PIPELINE_TRIGGER_TOKEN` | `estate-auth` (**presenter**) + audiobook `.env` (**verifier**) | `POST /api/estate/ops/pipeline` → the home watcher — `src/env.ts:243`; `machine-keys.ts:199` | shared by design, 2 holders | ✅ `audiobook_catalog/.env` `PIPELINE_TRIGGER_TOKEN` | ⚠️ **OUTBOUND — the Worker is not the verifier**, so a grace window cannot protect the cutover. **Rotate the watcher's `.env` FIRST** (`machine-keys.ts:201-204`). Blast radius: starts real GPU runs |
| `SHELF_PARITY_TOKEN` | `estate-auth` (verifier) + Justin's shelf server | `POST /estate/shelf/parity` — `src/env.ts:266`; `machine-keys.ts:118-135` | shared, 2 holders | 🔴 **NONE reachable** — the other copy is `/srv/shelf/.parity.env` on hardware outside the estate | ⚠️ **LEGACY since 2026-08-20** — parity keys are now KV-hashed self-service (`shelf:parity:token`). **Delete secret + fallback once `last_used_at` shows a minted key.** Smallest credential in the file: a leak falsifies one number |
| `ANTHROPIC_API_KEY` | `catalog-index` | The shelf/cover-photo vision call — the ONLY paid route on this Worker — `apps/index-worker/src/env.ts:109`, `src/scan.ts`, `src/vision.ts` | **same value as library main's** (`env.ts:104`) | ✅ library `apps/worker/.dev.vars` | Unset ⇒ 503, never a silent skip |
| `INDEX_PUSH_TOKEN_LIBRARY` | `catalog-index` (verifier) + library **main** `INDEX_PUSH_TOKEN` | snapshot-replace push, source resolved **from which suffixed secret matched** — `apps/index-worker/src/env.ts:13` | per-source | library `.dev.vars` (file exists) | ⚠️ **Per-instance despite the same short name** — main's value on padhard would file her rows as `library` |
| `INDEX_PUSH_TOKEN_AUDIOBOOK` | `catalog-index` + audiobook `.env` `INDEX_PUSH_TOKEN` | same — `env.ts:14` | per-source | ✅ `audiobook_catalog/.env` | desync = push silently no-ops |
| `INDEX_PUSH_TOKEN_GAME` | `catalog-index` + BGC Worker `INDEX_PUSH_TOKEN` | same — `env.ts:12` | per-source | BGC `.dev.vars` (file exists) | as above |
| `INDEX_READ_TOKEN_LIBRARY` | `catalog-index` (verifier) + library **main** `INDEX_READ_TOKEN` | free-details ladder rung 2 — `apps/index-worker/src/env.ts:45,141`; library `src/lib/free-details.ts:45` | per-instance | library `.dev.vars` (file exists) | Minted 2026-08-25 |
| `INDEX_READ_TOKEN_LIBRARY2` | `catalog-index` + library **friend** `INDEX_READ_TOKEN` | same, padhard's rung — `env.ts:48,62` | per-instance | 🔴 **NONE** — no `.dev.vars.friend` by design | ⚠️ **A DIFFERENT VALUE from `_LIBRARY`, deliberately** (`env.ts:48`): the index resolves the app from the value presented, so a shared value would make the app name meaningless and one leak would revoke both instances |
| `ANTHROPIC_API_KEY_GABI` | `estate-discord` | GABI's Haiku ladder — `apps/discord-worker/src/env.ts:105`, `src/gabi-chat.ts` | single holder | 🔴 **NONE** (discord `.dev.vars` exists; contents unopened) | 🔴 **RECOVERY §11.3 says `estate-auth` holds this. It does not** — §3.6 |
| `DISCORD_BOT_TOKEN` | `estate-discord` | Gateway + REST as the bot — `src/env.ts:29`, `src/discord-api.ts`, `src/gateway.ts` | single holder | discord `.dev.vars` (file exists) | Re-mint: discord.com/developers |
| `DISCORD_CLIENT_SECRET` | `estate-discord` | OAuth identity link — `src/env.ts:37`, `src/discord-oauth.ts` | single holder | as above | as above |
| `DISCORD_PUBLIC_KEY` | `estate-discord` | Ed25519 interaction-signature verification — `src/env.ts:20`, `src/index.ts` | single holder | as above | Not a bearer — a **verification** key |
| `DISCORD_APPLICATION_ID` | `estate-discord` | The app id used on command registration — `src/env.ts:23` | single holder | as above | ⚠️ **Not really a secret** (a public identifier) held as one. Harmless, but it inflates the rotation surface |
| `ESTATE_APP_TOKEN_DISCORD` | `estate-discord` (**presenter**) + library **main** + library **friend** (**verifiers**) | Tier-1 delegated writes + confirm-lane MAC key material — discord `src/confirm-flow.ts:58`, `src/confirm-propose.ts:47`; library `apps/worker/src/env.ts:192`, `src/index.ts:102,117` | shared across 3 holders | library main `.dev.vars` (file exists) | ⚠️ **Not held by `estate-auth`** and must never be merged with `_DISCORD_DOCS`. ⚠️ **Doubles as MAC key material** — rotating it invalidates in-flight confirm cards |
| `ESTATE_APP_TOKEN_BOOKS` | `audiobook-worker` (**verifier**) + `estate-discord` (**presenter**) | `/api/books/*` on a linked asker's behalf, **plus `X-Estate-On-Behalf-Of`** — `apps/audiobook-worker/src/book-routes.ts:35,126`, `src/env.ts:75`; discord `src/book-knowledge-exec.ts:27` | per-edge, 2 holders | 🔴 **NONE on the verifier side** — `audiobook-worker` has no `.dev.vars` | ⚠️ **"ITS OWN PAIR — not `ESTATE_APP_TOKEN_DISCORD`"** (`book-knowledge-exec.ts:27`) |
| `POLL_SYNC_TOKEN` | `estate-discord` (verifier) + audiobook `.env` (presenter) | pipeline → Discord poll sync — `src/env.ts:50` | shared, 2 holders | ✅ `audiobook_catalog/.env` | desync = polls not synced; announcements unaffected |
| **KV-hashed, self-service** | | | | | |
| `CLAUDE_USAGE_TOKEN` | auth-worker KV `claude:usage:token` (hash) + the reporting session's env | `POST /api/estate/claude/usage` — `machine-keys.ts:157-173`; `scripts/report-claude-usage.mjs` | single holder | ✅ `docs/access/keys/claude-usage-token.txt` | ⚠️ **No legacy env fallback** — until installed, nothing can report. A leak posts a FALSE budget reading, which then **gets believed and a run starts that should not have** |
| `SHELF_CONFIG_TOKEN` | auth-worker KV `shelf:config:token` (hash) + the pipeline PC | reads 4 shelf connection settings — `machine-keys.ts:138-155` | single holder | ✅ `audiobook_catalog/.env` `SHELF_CONFIG_TOKEN` | Discloses config, not credentials; the SSH key is not in this estate |

### 2.3 `library_catalog` — two Worker environments

Source of truth for procedure: `library_catalog/docs/access/secrets.md`.

| Secret | main | friend (padhard) | What it authenticates (code) | Shared / per-instance | Readable master |
|---|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | ✅ | paid details/cover rungs — `apps/worker/src/env.ts:93`, `src/lib/details-sweep.ts:147` | **`PER_INSTANCE_SECRETS`** — her key bills her | main: `.dev.vars`. 🔴 **friend: NONE** — KI-7 |
| `INDEX_PUSH_TOKEN` | ✅ | ⛔ **unset ON PURPOSE** | index push — `src/env.ts:203,208` | per-instance | main `.dev.vars` |
| `INDEX_READ_TOKEN` | ✅ | ✅ | free-details rung 2 — `src/env.ts:248`, `src/lib/free-details.ts:45` | per-instance (2 different values) | main `.dev.vars`; 🔴 friend NONE |
| `ESTATE_APP_TOKEN_LIBRARY` | ✅ | — | `/seen` | per-instance | main `.dev.vars` |
| `ESTATE_APP_TOKEN_LIBRARY2` | — | ✅ | `/seen` | per-instance | 🔴 NONE |
| `ESTATE_APP_TOKEN_DISCORD` | ✅ | ✅ | delegated writes + MAC — `src/env.ts:192`, `src/index.ts:102,117` | shared with `estate-discord` | main `.dev.vars` |
| `PEER_TOKEN` | ✅ | ✅ | cross-library peer holdings, in+out — `src/env.ts:382`, `src/lib/peer-push.ts:19` | **`SHARED_ALWAYS`** | main `.dev.vars` |
| `DONOR_TOKEN` | ✅ | ✅ | donor-first details sweep, **double duty in+out** — `src/env.ts:141-158` | **`SHARED_ALWAYS`** | 🔴 **NONE — absent from `.dev.vars`**, library `TODO.md` "Custody gap" |
| `AUDIOBOOK_MAPPING_TOKEN` | ✅ | ✅ | `GET /api/machine/audiobook-mapping` — `src/env.ts:131`, `src/index.ts:83` | **`SHARED_OPT_IN`** (route-ENABLING) | ✅ `audiobook_catalog/.env` `LIBRARY_MAPPING_TOKEN` — **but absent from `.dev.vars`**, so a bulk rotation cannot reach it |
| `EBOOK_INGEST_TOKEN` | ✅ | ✅ | `/api/ingest/*` — `src/env.ts:113`; presented by `scripts/import-ebooks.mjs:183` | **`SHARED_OPT_IN`** (route-ENABLING) | main `.dev.vars` (`import-ebooks.mjs:177` reads it from there) |
| `GOOGLE_BOOKS_API_KEY` | ✅ | ✅ | ladder rung — `src/env.ts:82`, `src/lib/free-details.ts:855` | **`SHARED_ALWAYS`** | main `.dev.vars` |
| `HARDCOVER_API_TOKEN` | ✅ | ✅ | ladder rung 5 — `src/env.ts:90`, `src/lib/free-details.ts:923` | **`SHARED_ALWAYS`** | main `.dev.vars` |

⚠️ **`secrets.md`'s own 2026-08-25 snapshot says "friend (7)". Measured today:
friend has 10** — it gained `AUDIOBOOK_MAPPING_TOKEN`, `EBOOK_INGEST_TOKEN`
(both set by hand that day, as the doc's prose says) and `INDEX_READ_TOKEN`. The
doc's header already warns the snapshot was not re-taken; this is that warning
coming true. Main is 11, as stated.

### 2.4 `Board_Game_Catalog` — one Worker

| Secret | What it authenticates | Master |
|---|---|---|
| `ANTHROPIC_API_KEY` | paid lookups | BGC `.dev.vars` |
| `BGG_API_TOKEN` | BoardGameGeek | BGC `.dev.vars` |
| `ESTATE_APP_TOKEN_GAMES` | `/seen`, paired with `estate-auth` | BGC `.dev.vars` |
| `INDEX_PUSH_TOKEN` | paired with index `INDEX_PUSH_TOKEN_GAME` | BGC `.dev.vars` |

### 2.5 GitHub Actions — 4 repos

| Repo | Secrets | Variables |
|---|---|---|
| `catalog-platform` | `CLOUDFLARE_API_TOKEN` (2026-08-17), `FIREBASE_SERVICE_ACCOUNT_JSON` (2026-08-15) | `CLOUDFLARE_ACCOUNT_ID` |
| `library_catalog` | `CATALOG_PLATFORM_TOKEN` (2026-08-14), `CLOUDFLARE_API_TOKEN` (2026-08-17) | `CLOUDFLARE_ACCOUNT_ID` |
| `Board_Game_Catalog` | `CATALOG_PLATFORM_TOKEN` (2026-08-14), `CLOUDFLARE_API_TOKEN` (2026-08-17) | `CLOUDFLARE_ACCOUNT_ID` |
| `audiobook_catalog` | `CLAUDE_LLM` (2026-07-07), `CLOUDFLARE_ACCOUNT_ID` (2026-08-10), `CLOUDFLARE_API_TOKEN` (2026-08-10), `DISCORD_WEBHOOK` (2026-01-16), `DOESTHEDOGDIE_API_KEY` (2026-07-07), `HARDCOVER_TOKEN` (2026-07-07) | `SITE_URL` |

**Rotation dates, read off `gh secret list`'s own `updatedAt`** — this is the
only *measured* rotation evidence in the estate:

- `CLOUDFLARE_API_TOKEN` on three repos: **2026-08-17** (the "Edit Cloudflare
  Workers 2" token — ⚠️ KI-8's keeper; its Aug-14 sibling is the stale one).
  On `audiobook_catalog` it is still **2026-08-10** — an older token or an
  un-rotated one; ⚠️ **unverified which**, since values cannot be compared.
- `DISCORD_WEBHOOK`: **2026-01-16** — 7 months, the oldest secret in the estate.
- `CLAUDE_LLM`, `DOESTHEDOGDIE_API_KEY`, `HARDCOVER_TOKEN`: **2026-07-07**.

⚠️ **`CLOUDFLARE_ACCOUNT_ID` is a SECRET on `audiobook_catalog` and a VARIABLE
on the other three.** It is a non-sensitive identifier (the variable value is
visible: `113be82b840c956b8378a187047ab3ea`). Not a leak — an inconsistency that
makes the audiobook repo's secret list look one item scarier than it is.

### 2.6 `audiobook_catalog/.env` — the pipeline's local master

Key names only, taken 2026-08-26. **⚠️ This list is INCOMPLETE — see §3.1.**

**Credentials (14):** `ABS_CF_CLIENT_ID`, `ABS_CF_CLIENT_SECRET`,
`ABS_PASSWORD`, `ABS_USERNAME`, `DOESTHEDOGDIE_API_KEY`, `GITHUB_TOKEN`,
`HARDCOVER_TOKEN`, `INDEX_PUSH_TOKEN`, `LIBRARY_MAPPING_TOKEN`,
`PIPELINE_TRIGGER_TOKEN`, `POLL_SYNC_TOKEN`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `SHELF_CONFIG_TOKEN`.

**Config / identifiers (16):** `ABS_BASE_URL`, `ABS_LIBRARY_ID`,
`AUTHOR_DRIVE_MAP`, `CSV_LINK`, `DRIVE_AUTHORS_ROOT`, `DRIVE_FOLDER_URL`,
`GITHUB_USER`, `HARDCOVER_ENABLED`, `INSPECT_DIR`, `LIBRARY_MAPPING_URL`,
`OUTPUT_DIR`, `R2_ACCOUNT_ID`, `ROOT_DIR`, `SITE_CSV_NAME`, `SITE_DIR`,
`SITE_INDEX_NAME`.

**Not in `.env`, but in the same repo and equally load-bearing:**
`scripts/firebase_service_account.json`, `docs/access/keys/firebase-sa-restore.json`
(two **different keys on the same service account** — revoking one does not
revoke the other, RECOVERY §7a), `scripts/token.json` + `scripts/credentials.json`
(the estate's Drive OAuth token and its client secret — the credential the
backup MIRROR's upload half runs on).

---

## 3. The five findings

### 3.1 🔴 Finding 1 — secrets with NO readable master (the KI-7 class)

**A "readable master" means a copy this machine can open and re-push without
minting anything.** A Cloudflare Worker secret is write-only; a GH Actions
secret is write-only. So a secret whose only holders are Workers and GH has NO
master by definition.

| Secret | Holders | Why there is no master | Cost of losing it |
|---|---|---|---|
| library **friend** `ANTHROPIC_API_KEY` | library friend | 🔴 **KI-7 (library).** `ANTHROPIC_API_KEY_FRIEND_SAM` in main's `.dev.vars` line 85 is **empty** (measured 2026-08-23, twice). No drop-box content, no file | Sam must mint from her own console. Anything billed to her key stays blocked |
| `DONOR_TOKEN` (main **and** friend) | library ×2 | 🔴 **Absent from `.dev.vars`** — library `TODO.md` "Custody gap", found 2026-08-25. `--both --dry-run` reports *"skip (not set locally)"* | Re-mint + set on both. Desync = **404** on padhard's sweep |
| `ESTATE_APP_TOKEN_LIBRARY2` | `estate-auth` + library friend | **Structural**: `auth-worker` has no `.dev.vars`, and there is deliberately no `.dev.vars.friend` | Re-mint + set both sides in one sitting |
| `INDEX_READ_TOKEN_LIBRARY2` ↔ friend `INDEX_READ_TOKEN` | `catalog-index` + library friend | same structural reason | Re-mint + set both. Rung 2 goes dark on padhard |
| `ESTATE_APP_TOKEN_AUDIOBOOK` | `estate-auth` + `audiobook-worker` | 🔴 **Neither holder has a `.dev.vars`** | Re-mint + set both |
| `ESTATE_APP_TOKEN_BOOKS` | `audiobook-worker` (verifier) + `estate-discord` | verifier has no `.dev.vars` | Re-mint + set both |
| `SHELF_PARITY_TOKEN` | `estate-auth` + Justin's box | The other copy is on **hardware outside the estate** (`/srv/shelf/.parity.env`) | ⚠️ Already superseded — retire it, don't rotate it (§4) |
| `TOKEN_SIGNER_KEY` | `estate-auth` | Google issues it; the estate never generates it | GCP console, `estate-token-minter` SA. **Not dangerous** — two keys can be valid at once |
| `ANTHROPIC_API_KEY_GABI` | `estate-discord` | no file copy known; `discord-worker/.dev.vars` exists but its contents were not opened | console.anthropic.com |
| `CLOUDFLARE_API_TOKEN` | GH Actions ×4 repos | Write-only on GitHub; **RECOVERY §11.3: "not on this machine"** | Cloudflare dashboard re-mint. ⚠️ **Blocks step 2 of the §11.2 rebuild** — nothing else can start |
| `CATALOG_PLATFORM_TOKEN` | GH Actions (library + BGC) | write-only PAT | github.com → Developer settings → PAT |

🔴 **`ESTATE_EVENTS_TOKEN` as a `catalog-platform` repo secret is MISSING
entirely**, not merely master-less. Measured today: `gh secret list` returns
exactly two names. KI-10's `notify-failure` job has been a no-op since
2026-08-21 — **five days**, up from the "two days" the KNOWN_ISSUES entry
records. The custody copy exists (`docs/access/keys/estate-events-token.txt`);
only `gh secret set` is missing. **The value must come from
<https://heygabi.ai/status/api> ("Service event log") or that file — the owner's
keystroke, not a session's.**

⚠️ **A NAMED GAP IN THIS REVIEW'S OWN INSTRUMENT.** The mandated
`grep -oE '^[A-Z_]+=' .env` **cannot see `Claude-llm`** — the audiobook `.env`
key that pairs with GH secret `CLAUDE_LLM` — because the name is hyphenated and
mixed-case. `CREDENTIALS.md` §7 rule 1 warns about exactly this and prescribes
`sed 's/=.*/=<REDACTED>/'` instead, which shows structure with every value
removed. **So the `.env` inventory in §2.6 is a floor, not a census**, and any
future census must use the `sed` form. (It was not re-run here: the brief fixed
the instrument, and substituting one silently would have made the count look
complete when the method that produced it was not the one recorded.)

### 3.2 ✅ Finding 2 — values in the git history of a PUBLIC repo

**Method:** every commit in all four repos
(`git rev-list --all | xargs git grep -l -E …`), five patterns:
`sk-ant-api\d\d-[A-Za-z0-9_-]{40,}`, `ghp_[A-Za-z0-9]{30,}`,
`github_pat_[A-Za-z0-9_]{50,}`, the PEM `BEGIN PRIVATE KEY` marker (five dashes each side — written out
here in words so the docs-snapshot scanner does not flag this sentence),
`AIza[A-Za-z0-9_-]{30,}`. **Paths and commit hashes only — no line was ever
printed.**

**Result: no live credential value found in any repo's history.**

| Pattern | Hits | Verdict |
|---|---|---|
| `sk-ant-api…` | **0**, all four repos, all history | ✅ clean |
| `ghp_…` / `github_pat_…` | **0**, all four repos, all history | ✅ clean |
| `BEGIN PRIVATE KEY` with the five dashes on each side (literal, dashed) | **0** at HEAD and in the commits sampled | ✅ clean |
| `BEGIN PRIVATE KEY` (loose — inside `\n`-escaped strings) | 9 files at HEAD in `catalog-platform` | ✅ **Not key material.** Test fixtures (`apps/auth-worker/test/session.test.ts`, `token-signer.test.ts`, `revoke-clears-site-role.test.ts`, `apps/audiobook-worker/test/{enforce-routes,gate-shadow,me,stream-ping}.test.ts`) and the PEM **parser** (`packages/firebase-sa/src/index.ts`, `tools/estate-probes/authorized-domains.mjs`). The marker is the format string, not a key |
| `AIza…` | `catalog-platform`: `apps/discord-worker/src/link-pages.ts`, `sites/heygabi-home/public/assets/estate-auth.js` · `library_catalog`: `apps/web/src/lib/firebase.ts`, `scripts/backfill-read-from-ratings.mjs`, `scripts/backfill-review-keys.mjs` · `Board_Game_Catalog`: `apps/web/src/lib/firebase.ts` · `audiobook_catalog`: `site/fb-env.js`, `frontend/src/services/firebase.ts`, `site/*.html`, `app/tools/*.py`, `.gitguardian.yml` | ✅ **Firebase WEB API keys — public by design.** They are client identifiers, not secrets; protection is Firestore rules + the authorized-domains list. ⚠️ **Do not "fix" these** — removing them breaks every browser client. `.gitguardian.yml` matching is the allowlist entry that says so |

**The one real historical leak, and its closure:**

| Commit | What | Status |
|---|---|---|
| `79036d3` | *"feat: cross-library peer holdings — 'In the Padhard Library' badges"* — introduced `PEER_TOKEN` **as a plaintext value inside the `PEERS` config in the PUBLIC `apps/worker/wrangler.toml`** (lines 203 and 418) | 🔴 was internet-readable |
| `fbd619a` | *"fix(peer): move leaked shared PEER_TOKEN out of public PEERS into the secret"* | ✅ plaintext stripped; `PEERS` now references the secret |
| — | **Value ROTATED by the owner 2026-08-25** on both instances, verified live by the peer route accepting the new token | ✅ **closed** — the leaked value is dead |

⚠️ **`79036d3` still contains the old value and always will** — git history is
immutable and the repo is public. That is *acceptable* only because the value
was rotated. **This is the estate's proof that rotation, not history rewriting,
is the fix.** Confirmed today: no plaintext token remains at HEAD (`PEERS`,
`PEER_SELF_ID` and `PEER_SELF_LABEL` are the only `PEER*` entries, and none is a
credential).

✅ **Ignore rules verified mechanically, not read off `.gitignore`** —
`git check-ignore -v` names the exact protecting line for each file:

| File | Protected by |
|---|---|
| `catalog-platform/apps/index-worker/.dev.vars` | `.gitignore:21` |
| `catalog-platform/apps/discord-worker/.dev.vars` | `.gitignore:21` |
| `catalog-platform/docs/access/keys/*.txt` (all 3) | `.gitignore:67` — `docs/access/keys/*`, deliberately the CONTENTS not the directory, so `README.md` can be re-included |
| `library_catalog/apps/worker/.dev.vars` | `.gitignore:8` |
| `Board_Game_Catalog/apps/worker/.dev.vars` | `.gitignore:25` |
| `audiobook_catalog/.env` | `.gitignore:275` |
| `audiobook_catalog/docs/access/CREDENTIALS.md` | `.gitignore:7` — the whole `docs/` tree |

All four repos also carry `.env`, `.env.*` and `.dev.vars.*` rules (the
credentials-catalog F-2/F-3 fix), so a stray `.dev.vars.friend` cannot slip
through a pattern nobody updated.

### 3.3 ✅ Finding 3 — must-be-equal pairs, EXISTS/MISSING per side

⚠️ **This is a NAME-PARITY check.** It proves both sides hold a secret of that
name. It **cannot** prove the values match — nothing in this estate can, except
`push-secrets.mjs`'s last-4 fingerprint on the main library path.

| # | The value | Side A | Side B | Verdict |
|---|---|---|---|---|
| 1 | estate library bearer | `estate-auth` `ESTATE_APP_TOKEN_LIBRARY` ✅ | library **main** `ESTATE_APP_TOKEN_LIBRARY` ✅ | ✅ **both EXIST** |
| 2 | estate library2 bearer | `estate-auth` `ESTATE_APP_TOKEN_LIBRARY2` ✅ | library **friend** `ESTATE_APP_TOKEN_LIBRARY2` ✅ | ✅ **both EXIST** — ⚠️ CREDENTIALS.md §6 still says *"pipe outstanding"*; **that is stale, the pair is closed** |
| 3 | estate games bearer | `estate-auth` `ESTATE_APP_TOKEN_GAMES` ✅ | BGC `ESTATE_APP_TOKEN_GAMES` ✅ | ✅ **both EXIST** |
| 4 | estate index bearer | `estate-auth` `ESTATE_APP_TOKEN_INDEX` ✅ | `catalog-index` `ESTATE_APP_TOKEN_INDEX` ✅ | ✅ **both EXIST** |
| 5 | estate audiobook bearer | `estate-auth` `ESTATE_APP_TOKEN_AUDIOBOOK` ✅ | `audiobook-worker` `ESTATE_APP_TOKEN_AUDIOBOOK` ✅ | ✅ **both EXIST** |
| 6 | estate docs door B | `estate-auth` `ESTATE_APP_TOKEN_DISCORD_DOCS` ✅ | `estate-discord` `ESTATE_APP_TOKEN_DISCORD_DOCS` ✅ | ✅ **both EXIST** |
| 7 | delegated-writes bearer / MAC key | `estate-discord` `ESTATE_APP_TOKEN_DISCORD` ✅ | library **main** ✅ **and** library **friend** ✅ | ✅ **all 3 EXIST**. ⚠️ **`estate-auth` does NOT hold it — correct**, it is not a `/seen` bearer |
| 8 | books-on-behalf bearer | `audiobook-worker` `ESTATE_APP_TOKEN_BOOKS` ✅ | `estate-discord` `ESTATE_APP_TOKEN_BOOKS` ✅ | ✅ **both EXIST** |
| 9 | index push (library) | `catalog-index` `INDEX_PUSH_TOKEN_LIBRARY` ✅ | library **main** `INDEX_PUSH_TOKEN` ✅ | ✅ **both EXIST** |
| 10 | index push (library2) | `catalog-index` `INDEX_PUSH_TOKEN_LIBRARY2` ⛔ **absent** | library **friend** `INDEX_PUSH_TOKEN` ⛔ **absent** | ✅ **CONSISTENTLY ABSENT — correct.** padhard does not push to the index; `secrets.md` and CREDENTIALS §7 rule 7 both record it as intentional. **Do not "tidy" this into existence** |
| 11 | index push (audiobook) | `catalog-index` `INDEX_PUSH_TOKEN_AUDIOBOOK` ✅ | audiobook `.env` `INDEX_PUSH_TOKEN` ✅ | ✅ **both EXIST** |
| 12 | index push (games) | `catalog-index` `INDEX_PUSH_TOKEN_GAME` ✅ | BGC `INDEX_PUSH_TOKEN` ✅ | ✅ **both EXIST** |
| 13 | index read (library) | `catalog-index` `INDEX_READ_TOKEN_LIBRARY` ✅ | library **main** `INDEX_READ_TOKEN` ✅ | ✅ **both EXIST** (minted 2026-08-25) |
| 14 | index read (library2) | `catalog-index` `INDEX_READ_TOKEN_LIBRARY2` ✅ | library **friend** `INDEX_READ_TOKEN` ✅ | ✅ **both EXIST** — ⚠️ **deliberately a DIFFERENT VALUE from #13** |
| 15 | mapping export | library `AUDIOBOOK_MAPPING_TOKEN` (main ✅ + friend ✅) | audiobook `.env` `LIBRARY_MAPPING_TOKEN` ✅ | ✅ **both EXIST** (3 holders) |
| 16 | donor sweep | library **main** `DONOR_TOKEN` ✅ | library **friend** `DONOR_TOKEN` ✅ | ✅ **both EXIST** — but 🔴 **neither has a readable master** (§3.1) |
| 17 | poll sync | audiobook `.env` `POLL_SYNC_TOKEN` ✅ | `estate-discord` `POLL_SYNC_TOKEN` ✅ | ✅ **both EXIST** |
| 18 | pipeline trigger | audiobook `.env` `PIPELINE_TRIGGER_TOKEN` ✅ | `estate-auth` `PIPELINE_TRIGGER_TOKEN` ✅ | ✅ **both EXIST** |
| 19 | worker event ring | `estate-auth` ✅ + `catalog-index` ✅ + `audiobook-worker` ✅ | GH secret on `catalog-platform` ⛔ **MISSING** | 🔴 **3 of 4 — the CI holder is absent.** KI-10. ⚠️ `estate-discord` not holding it is *correct*; it is not a ring writer |
| 20 | Firebase service account | `estate-auth` ✅ + `audiobook-worker` ✅ + `estate-discord` ✅ | GH `FIREBASE_SERVICE_ACCOUNT_JSON` ✅ + 2 local JSONs ✅ | ✅ **all 6 EXIST.** ⚠️ **6 holders, and the 2 local JSONs are DIFFERENT KEYS on the same SA** — a rotation that revokes one leaves the other live |
| 21 | peer holdings | library **main** `PEER_TOKEN` ✅ | library **friend** `PEER_TOKEN` ✅ | ✅ **both EXIST**, rotated 2026-08-25 |
| 22 | shared free-details keys | library main `GOOGLE_BOOKS_API_KEY` ✅ / `HARDCOVER_API_TOKEN` ✅ | library friend, both ✅ | ✅ **both EXIST** |
| 23 | ebook ingest | library main `EBOOK_INGEST_TOKEN` ✅ + friend ✅ | `scripts/import-ebooks.mjs:183` (env or `.dev.vars`) | ✅ **EXISTS** — ⚠️ route-ENABLING on the receiver; presence on friend is a **capability grant** the owner made deliberately |
| 24 | shelf parity | `estate-auth` `SHELF_PARITY_TOKEN` ✅ | `/srv/shelf/.parity.env` on Justin's box | ⚠️ **Side B UNVERIFIABLE from here** — offsite hardware. Both may be vestigial (§4) |
| 25 | Anthropic (index ↔ library) | `catalog-index` `ANTHROPIC_API_KEY` ✅ | library main `ANTHROPIC_API_KEY` ✅ | ✅ **both EXIST** — same value by design (`index-worker/src/env.ts:104`) |
| 26 | Anthropic (audiobook) | audiobook `.env` `Claude-llm` (⚠️ not enumerable by the mandated grep) | GH secret `CLAUDE_LLM` ✅ | ⚠️ **A-side UNVERIFIED** — §3.1 |

**Score: 17 of the 26 rows are true two-sided pairs and all 17 exist on both
sides. 2 rows are correct deliberate absences. 1 row (#19) is genuinely
half-missing. 3 rows could not be checked from here.**

### 3.4 ⚠️ Finding 4 — plaintext masters on a OneDrive-synced disk

**Every repo lives under `C:\Users\nbasl\OneDrive\Documents\vs-code-repos\`.**
Every file below is therefore a candidate for upload to Microsoft's cloud, and
`.gitignore` does nothing about that — it stops git, not OneDrive.

| File | Size | Last modified | Holds |
|---|---|---|---|
| `bookbuddy/library_catalog/apps/worker/.dev.vars` | 7,046 B | 2026-08-25 14:22 | 🔴 **The largest master in the estate** — the source of truth for the main library's 11 secrets, plus the drop-box lines |
| `boardbuddy/Board_Game_Catalog/apps/worker/.dev.vars` | 5,576 B | 2026-08-17 13:19 | BGC's 4 secrets |
| `catalog-platform/apps/index-worker/.dev.vars` | 2,979 B | 2026-08-25 14:13 | index-worker's push/read tokens + `ANTHROPIC_API_KEY` |
| `catalog-platform/apps/discord-worker/.dev.vars` | 2,608 B | 2026-08-17 18:53 | Discord app credentials + `ANTHROPIC_API_KEY_GABI` |
| `bookbuddy/audiobook_catalog/.env` | 5,232 B | 2026-08-22 23:57 | 14 credentials incl. R2 access keys and the ABS Cloudflare-Access service token |
| `catalog-platform/docs/access/keys/estate-conductor-token.txt` | 64 B | 2026-08-18 12:06 | 🔴 raw `ESTATE_CONDUCTOR_TOKEN` value |
| `catalog-platform/docs/access/keys/estate-events-token.txt` | 64 B | 2026-08-18 21:43 | 🔴 raw `ESTATE_EVENTS_TOKEN` value |
| `catalog-platform/docs/access/keys/claude-usage-token.txt` | 47 B | 2026-08-21 10:10 | 🔴 raw `CLAUDE_USAGE_TOKEN` value |
| `bookbuddy/audiobook_catalog/scripts/firebase_service_account.json` | — | — | 🔴 **The widest credential in the estate**, whole |
| `bookbuddy/audiobook_catalog/docs/access/keys/firebase-sa-restore.json` | — | — | 🔴 a **second, different** key on the same SA |
| `bookbuddy/audiobook_catalog/scripts/token.json` + `credentials.json` | — | — | 🔴 the estate's Drive OAuth token + its client secret |

⚠️ **This cuts both ways and the doc set already argues both halves.**
RECOVERY §7a's recommendation and §11.3's "real, named weakness" both want MORE
copies of some of these, precisely because a dead machine currently forces a
console re-mint mid-incident. OneDrive is, accidentally, that off-machine copy —
just in a place nobody chose, with sharing semantics nobody reviewed.

⚠️ **KI-3 compounds it.** `wrangler dev` inlines `.dev.vars` values into
`apps/*/.wrangler/tmp/dev-*/index.js.map`. Those paths are gitignored in every
repo, and they are **also under OneDrive**. 30 such files across the estate held
key material on 2026-08-21 (24 in stale worktrees, since deleted).

⚠️ **`docs/access/keys/README.md` says "Nothing here is backed up off this
machine, on purpose."** Measured against the disk, that sentence is
**functionally false** — the folder is inside OneDrive. The reasoning behind it
is still sound (conductor-minted values cost one re-mint), but the *claim* is
not, and a session reading it would draw the wrong conclusion about exposure.

**What would change it** (in cost order, none done here — all are the owner's):
1. Mark the four `.dev.vars`, the `.env`, `docs/access/keys/` and the two
   `*.json` credential files **"Always keep on this device" is not the fix —
   the fix is excluding them from sync.** OneDrive has no per-file exclude, so
   the practical lever is moving the repos out of `OneDrive\Documents`, or
   moving the secret files to a non-synced path and pointing the tools at it.
2. Or accept it explicitly, as a `KNOWN_ISSUES` entry with a status — an
   accepted exposure is better than an unexamined one.
3. Or make it moot: **1Password (§5)** removes the plaintext masters entirely,
   which is the only option that fixes the cause rather than the symptom.

### 3.5 Finding 5 — safe channels, and which repos lack a runbook

**The estate's safe channels, as defined by
`library_catalog/docs/access/secrets.md`** (the only complete statement of them,
and the best doc in the estate on this subject):

1. **Owner sets it interactively** — `wrangler secret put` at a hidden prompt.
   The session never sees it.
2. **Owner writes it to `apps/worker/.dev.vars`** and the session runs
   `npm run secrets:push` — the *script* reads the file; the session runs the
   command and never opens it.
3. **Drop-box** — a deliberately oddly-named line in the MAIN `.dev.vars`, piped
   once, then blanked. `ANTHROPIC_API_KEY_FRIEND_SAM` is the live example.
   ⚠️ **A filled drop-box is an unfinished operation**, never storage.
4. **Self-service minting** at <https://heygabi.ai/status/api> — five key
   families, SHA-256-hashed in KV, shown once, 24 h grace window. This is the
   newest channel and the preferred one where it applies.

**Mechanical guards that already exist** (`library_catalog/scripts/push-secrets.mjs`):
`SHARED_ALWAYS` / `SHARED_OPT_IN` / `PER_INSTANCE_SECRETS` classification with a
startup error on any key in two lists; `--enable NAME` required for
route-ENABLING keys; a **glued-value refusal** that aborts the whole run if a
value looks like two lines welded together (the 2026-08-25 incident, mechanised);
names-only output on every `--both`/`--friend` path.

| Repo | Has a secrets runbook? | Gap |
|---|---|---|
| `library_catalog` | ✅ `docs/access/secrets.md` — channels, both-instance push, opt-in split, glued-value guard, ops table | ⚠️ Its 2026-08-25 `secret:list` snapshot is stale (friend is 10, not 7) |
| `audiobook_catalog` | ✅ `docs/access/CREDENTIALS.md` — the estate-wide catalogue, §6 pairing map, §7 rules | ⚠️ **Gitignored, local-only** — the aggregation *is* the sensitive artifact, so this is deliberate, but it means the best cross-repo map dies with the machine. ⚠️ §6 has two stale rows (§3.6) |
| `catalog-platform` | ⚠️ **Partial.** `docs/access/machine-keys.md` + `apps/auth-worker/src/machine-keys.ts` `KEY_REGISTRY` cover the 9 self-service/paired/manual key families **superbly** — blast radius, `livesAt`, `origin`, `rotateHow`, `installHow`, ordered smallest-blast-radius-first. `docs/access/keys/README.md` covers local custody. `RECOVERY.md` §7/§7a/§11.3 covers disaster custody | 🔴 **No single "how do I set/rotate a secret here" front door.** The knowledge is real but split across four files and a source module, and `RECOVERY.md` §11.3's table was **incomplete and in two places wrong** before today |
| `Board_Game_Catalog` | 🔴 **NONE.** `docs/access/` holds `covers-r2.md`, `external-apis.md`, `firebase-auth.md`, `login.md`, `README.md`, `RECOVERY.md`, `SETUP.md` — no secrets doc | 4 secrets with no runbook. Also ⚠️ a `HANDOFF.md` sits at the top of `docs/` — a **competing living doc**, which `DOCS_STANDARD.md` says to retire |

### 3.6 Bonus — three stale facts, corrected by measurement

These are not part of the five findings, but each would mislead someone at 3am.

| Where it says | What it says | What was measured 2026-08-26 |
|---|---|---|
| `RECOVERY.md` §11.3 | `ANTHROPIC_API_KEY_GABI` — **Held by `estate-auth`** | 🔴 **Wrong.** It is on **`estate-discord`**. `estate-auth`'s secret list has no Anthropic key at all |
| `apps/auth-worker/src/env.ts:209` + `CREDENTIALS.md` §7 rule 7 | `TOKEN_SIGNER_KEY` **"DOES NOT EXIST YET"** / is a *deliberately unset* secret | 🔴 **Wrong.** `TOKEN_SIGNER_KEY` **IS SET** on `estate-auth`. Either it was set and the comments never caught up, or something set it unnoticed. ⚠️ **This is the impersonation-capable key** — the one where a wrong belief costs most |
| `CREDENTIALS.md` §6 | estate library2 bearer — *"⚠️ pipe outstanding"* | ✅ **Closed.** Both sides hold it |

⚠️ Also: `RECOVERY.md` §11.3 listed **11 secrets**. The live count is **59
bindings**; the table omitted every `INDEX_PUSH_TOKEN_*`, every
`INDEX_READ_TOKEN_*`, `SHELF_PARITY_TOKEN`, `DISCORD_PUBLIC_KEY`,
`DISCORD_APPLICATION_ID`, `ESTATE_APP_TOKEN_BOOKS`, `_DISCORD_DOCS`, `_GAMES`,
`_AUDIOBOOK`, `_LIBRARY2`, and the whole library/BGC side. **Repaired in the
same pass as this review** — see §11.3's "(added 2026-08-26, secrets review)"
rows.

---

## 4. The rotation plan

⚠️ **Read this before rotating anything: ORDER IS THE WHOLE GAME.** For an
*inbound-verified* pair the verifier can accept old and new at once, so set the
**verifier first**. For an *outbound* value the far side is the verifier, so the
grace window is on the wrong end and you must set the **far side first**. Get it
backwards and the failure is a silent 401/403/404 that reads like a code bug.

⚠️ **Transport:** never a PowerShell pipe into `wrangler secret put` — a piped
value picks up an invisible UTF-8 BOM and the stored credential is wrong *while
looking perfect everywhere a human can check*. Use the file-redirect transport
(`docs/access/agent-board.md` §3). ⚠️ Appending to `.dev.vars`: check for a
trailing newline first (`tail -c1 … | od -c`) or use `printf '\nKEY=%s\n'`.

| Secret | Re-mint at | Set in this ORDER | Verify |
|---|---|---|---|
| `TOKEN_SIGNER_KEY` | GCP console → IAM → Service Accounts → **`estate-token-minter`** → Keys. ⚠️ **Create a SECOND key; both work at once** | 1. new key in console → 2. `wrangler secret put TOKEN_SIGNER_KEY` (auth-worker) → 3. `wrangler deploy` → 4. verify → **5. ONLY THEN delete the old key** | `tools/estate-probes/run.mjs`. Tokens are 5-min-lived, so in-flight ones expire before you finish. Full runbook: `library_catalog/docs/access/estate-auth.md` §3.4. Recommended **yearly**, or when someone with console access leaves the household |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase console → `audiobook-catalog` → Project settings → Service accounts → Generate new private key | 1. new key → 2. `wrangler secret put FIREBASE_SERVICE_ACCOUNT` on **auth-worker, audiobook-worker, discord-worker** → 3. `gh secret set FIREBASE_SERVICE_ACCOUNT_JSON --repo skymitch9/catalog-platform` → 4. replace **both** local JSONs → 5. deploy all three → 6. verify → **7. ONLY THEN delete old keys in the console** | ⚠️ **6 holders and 2 distinct local keys.** Deleting the old key is *part of* the rotation, not cleanup — skip it and you have merely added a second working credential. Probe: `audiobook_catalog/app/core/ingest_control.py` `read_control()` (a single `.get()`, writes nothing) |
| `ESTATE_APP_TOKEN_<SERVICE>` ×6 | `openssl rand -hex 32` | ⚠️ **ONE SERVICE AT A TIME.** 1. mint → 2. set on the **VERIFIER** → 3. set the same value on the **presenter** → 4. redeploy the presenter → 5. verify → **only then start the next service** | Verifier per pair: `estate-auth` for `_LIBRARY`/`_LIBRARY2`/`_GAMES`/`_INDEX`/`_AUDIOBOOK`/`_DISCORD_DOCS`; **`audiobook-worker`** for `_BOOKS`; **the library Workers** for `_DISCORD`. Probe: `GET /api/health` then the gated route. ⚠️ `_DISCORD` is also **MAC key material** — rotating it invalidates in-flight confirm cards |
| `ESTATE_CONDUCTOR_TOKEN` | ✅ **Preferred: mint at <https://heygabi.ai/status/api> → "Agent board publisher"** (24 h grace) | 1. generate on the page → 2. put it in the conductor's environment on this machine → 3. push the board once **inside the grace window** | Reload `/status/agents` — **Last used** shows a moment ago. Legacy path: `wrangler secret put` + overwrite `docs/access/keys/estate-conductor-token.txt` **after** (store-then-overwrite, never edit-in-place) |
| `ESTATE_EVENTS_TOKEN` | ✅ **Mint at <https://heygabi.ai/status/api> → "Service event log"** | 1. generate → 2. `wrangler secret put ESTATE_EVENTS_TOKEN` from **each** of `apps/auth-worker`, `apps/index-worker`, `apps/audiobook-worker` → 3. **`gh secret set ESTATE_EVENTS_TOKEN --repo skymitch9/catalog-platform`** (⚠️ **the step that has never been done** — KI-10) → all inside the 24 h window | A real event arriving on `/status`. ⚠️ Auth-worker also accepts `ESTATE_CONDUCTOR_TOKEN` on that route, so a half-finished rotation degrades to "writers cannot report", never to an open door |
| `CLAUDE_USAGE_TOKEN` | <https://heygabi.ai/status/api> → "Claude usage reporter" | 1. generate → 2. `setx CLAUDE_USAGE_TOKEN "<value>"` in the reporting session's environment (new shells only) inside the window | `node scripts/report-claude-usage.mjs --session N --weekly N --fable N --credits N`, then reload `/status`. ⚠️ **No legacy fallback** — until installed, nothing can report |
| `SHELF_PARITY_TOKEN` | ⚠️ **DO NOT ROTATE — RETIRE.** | 1. Confirm on `/status/api` that the **minted** `shelf:parity:token` shows a recent **Last used** → 2. delete `SHELF_PARITY_TOKEN` from auth-worker → 3. remove the fallback branch in `POST /estate/shelf/parity` | `apps/auth-worker/src/env.ts:250-257` says exactly this. If it must be rotated instead: `echo 'SHELF_PARITY_TOKEN=<value>' \| sudo tee /srv/shelf/.parity.env; sudo chmod 600` then run `./03-shelf-parity.sh` |
| `SHELF_CONFIG_TOKEN` | <https://heygabi.ai/status/api> → "Shelf connection reader" | 1. generate → 2. `setx SHELF_CONFIG_TOKEN` on the pipeline PC inside the window | `python scripts/sync_to_server.py --dry-run` — *"not configured"* means the form is blank; an auth error means the token did not land |
| `PIPELINE_TRIGGER_TOKEN` | `openssl rand -hex 32` | 🔴 **REVERSED ORDER — this one is OUTBOUND.** 1. change it in the **watcher's `.env` on the home machine FIRST** → 2. `wrangler secret put PIPELINE_TRIGGER_TOKEN` (auth-worker) | ⚠️ **No grace window can protect this cutover** — the Worker SENDS the value and the watcher verifies it, so minting here starts sending something the watcher does not know, instantly. `machine-keys.ts:200-204`. Verify with one "Run now" from `/status/pipelines` |
| `POLL_SYNC_TOKEN` | `openssl rand -hex 32` | 1. `wrangler secret put POLL_SYNC_TOKEN` on **`estate-discord`** (the verifier) → 2. update `audiobook_catalog/.env` | A pipeline poll sync landing in Discord. Failure is polls-not-synced; announcements unaffected |
| `INDEX_PUSH_TOKEN_*` ×3 | `openssl rand -hex 32`, **one value per source** | 1. `wrangler secret put INDEX_PUSH_TOKEN_<SOURCE>` on **`catalog-index`** (verifier) → 2. set `INDEX_PUSH_TOKEN` on the pusher (library `.dev.vars` + `npm run secrets:push`; BGC likewise; audiobook `.env`) | Push once, check the index row count moves. ⚠️ **Never share one value across sources** — the index derives the source from *which suffixed secret matched* |
| `INDEX_READ_TOKEN_LIBRARY` / `_LIBRARY2` | `openssl rand -hex 32`, **two different values** | 1. set the suffixed secret on **`catalog-index`** → 2. set `INDEX_READ_TOKEN` on that instance | Rung 2 returns 200 with rows for a real title on each token, and a named `401 machine_token_invalid` on a wrong one — the exact check run at mint time, 2026-08-25 |
| `PEER_TOKEN` | `openssl rand -hex 32` | `.dev.vars` → **`npm run secrets:push:both`** (it is `SHARED_ALWAYS`) | The peer route accepting the new token — exercised for real 2026-08-25 |
| `DONOR_TOKEN` | `openssl rand -hex 32` | 🔴 **First close the custody gap:** add the line to main's `.dev.vars` (trailing-newline check!) → then **`npm run secrets:push:both`** | padhard's `/api/donor/details` sweep returning rows, not 404. ⚠️ Wrong token is **404, not 401**, by design |
| `AUDIOBOOK_MAPPING_TOKEN` | `openssl rand -hex 32` | 🔴 Same gap: add to main's `.dev.vars` → **`npm run secrets:push:both -- --enable AUDIOBOOK_MAPPING_TOKEN`** (⚠️ `SHARED_OPT_IN`) → then update `audiobook_catalog/.env` `LIBRARY_MAPPING_TOKEN` | `GET /api/machine/audiobook-mapping` returning rows. Unset ⇒ 404 (disabled, not open) |
| `EBOOK_INGEST_TOKEN` | `openssl rand -hex 32` | `.dev.vars` → `npm run secrets:push` (main). For friend: **`-- --enable EBOOK_INGEST_TOKEN`** — ⚠️ **that flag is a CAPABILITY GRANT, not a rotation** | `scripts/import-ebooks.mjs` importing one ebook |
| `GOOGLE_BOOKS_API_KEY` / `HARDCOVER_API_TOKEN` | Google Cloud console / `hardcover.app/account/api` | `.dev.vars` → **`npm run secrets:push:both`** (`SHARED_ALWAYS`) | A ladder rung answering instead of recording the NAMED skip (*"Hardcover: not asked — no HARDCOVER_API_TOKEN"*) |
| `ANTHROPIC_API_KEY` (index + library main) | console.anthropic.com | 1. `.dev.vars` on library main → `npm run secrets:push` → 2. push the same value to `catalog-index` (`estate-scan-adoption.md` has the command) | `/api/scan` answering instead of 503 |
| library **friend** `ANTHROPIC_API_KEY` | 🔴 **Sam's own console** — nobody here can mint it | Drop-box: owner writes `ANTHROPIC_API_KEY_FRIEND_SAM=<value>` into main's `.dev.vars` → pipe it to `--env friend` → **blank the line** | `backfill-missing-covers.mjs --friend --remote --llm` no longer printing *"ANTHROPIC_API_KEY_FRIEND_SAM is empty or absent"*. **KI-7 (library)** |
| `ANTHROPIC_API_KEY_GABI` | console.anthropic.com | `wrangler secret put ANTHROPIC_API_KEY_GABI` on **`estate-discord`** | @mention GABI; she answers instead of falling back |
| `DISCORD_BOT_TOKEN` / `_CLIENT_SECRET` / `_PUBLIC_KEY` | discord.com/developers → the application | `wrangler secret put` each on `estate-discord`, then deploy | ⚠️ `DISCORD_PUBLIC_KEY` changing breaks **interaction signature verification** — Discord will show every command as failed. `/api/health` + one slash command |
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → My Profile → API Tokens → **"Edit Cloudflare Workers"** template | `gh secret set CLOUDFLARE_API_TOKEN --repo <each of the 4>` | A CI deploy succeeding. ⚠️ **KI-8: the Aug-14 "Edit Cloudflare Workers" token is the STALE one to revoke; "Edit Cloudflare Workers 2" (Aug 17) is LIVE CI.** Confusing them takes CI down |
| `CATALOG_PLATFORM_TOKEN` | github.com → Settings → Developer settings → PAT | `gh secret set CATALOG_PLATFORM_TOKEN --repo skymitch9/library_catalog` and `…/Board_Game_Catalog` | A sibling-checkout CI step succeeding |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | dash.cloudflare.com → R2 → Manage API tokens | update `audiobook_catalog/.env` (both keys together) | `archive_audio_r2.py` / `upload_ebooks_r2.py` listing a bucket |
| Drive OAuth (`scripts/token.json`) | `python scripts/drive_auth.py` (re-consents against `scripts/credentials.json`) | regenerate in place | Mirror half 2 uploading one object to `/GABI_backup`, MD5-verified — RECOVERY §2a |

**Two orderings worth memorising, because they are opposite:**

> **Inbound-verified (almost everything):** VERIFIER first, presenter second.
> `estate-auth` before the app. `catalog-index` before the pusher.
>
> **Outbound (`PIPELINE_TRIGGER_TOKEN`, and only it):** FAR SIDE first. The
> watcher's `.env` before the Worker's secret.

**The one-command paths that already exist** (use them instead of hand-setting):

```
# library — main only, allowlisted keys, last-4 fingerprints
npm run secrets:push
npm run secrets:push -- --dry

# library — main then friend; PER_INSTANCE refused by name, SHARED_OPT_IN skipped
npm run secrets:push:both
npm run secrets:push:both -- --dry-run
npm run secrets:push:both -- --enable AUDIOBOOK_MAPPING_TOKEN   # one key at a time

# names only, never values
npm run secret:list          # library main
npm run secret:list:friend   # padhard
npx wrangler secret list --config apps/<worker>/wrangler.toml [--env <env>]
```

---

## 5. The 1Password end state

> ✅ **SUPERSEDED THE SAME DAY, AND HALF-EXECUTED — 2026-08-26.** The owner
> reversed the deferral hours after this section was written (*"a do it, I have
> 1 password and time now"* — option A). ⚠️ **This section is the PLAN; the
> sections below it are no longer a sketch for steps 1 and 2.**
>
> | Step | State | Where the record is |
> |---|---|---|
> | 1. `library_catalog` | ✅ **DONE** — 13 items, `--source op` proves plan-identical, one key pushed live from the vault to both instances | `library_catalog/docs/DONE.md` + `docs/access/secrets.md` |
> | 2. `docs/access/keys/*.txt` | ✅ **DONE** — 3 items, files deliberately kept as a courtesy copy | `docs/access/keys/README.md`, `scripts/op-import-keys.mjs` |
> | 3. `catalog-platform` Workers (the no-master set) | ⚠️ **1 of 4** — `INDEX_READ_TOKEN_LIBRARY2` rotated and handshake-proved; the other 3 REFUSED, no runnable probe | `docs/TODO.md`, `scripts/op-rotate-pair.mjs --list` |
> | 4. `audiobook_catalog/.env` | 🔴 **NOT DONE** — estimate only | `docs/TODO.md` |
>
> **16 items in vault `Estate`**, verified by `op item list` — titles only.
> ⚠️ **§3.1's "no readable master" list is UNCHANGED by any of this.** A vault
> holds what somebody could read, and every one of those secrets is a secret
> nothing on this machine can read. Step 3 is what would change it.
>
> ⚠️ **Two of §3.1's rows were also falsified by step 1**, by measurement rather
> than by the work: `ESTATE_APP_TOKEN_LIBRARY` and `INDEX_PUSH_TOKEN` are
> recorded above as *"master: library `.dev.vars` (file exists; contents
> unopened)"*. Parsing that file for NAMES (never values) showed **neither is in
> it**, so both belong on the no-master list. This review's own header was honest
> that those rows were claims about a FILE; this is that caveat coming true.

**The original 2026-08-25 decision, kept for the record: the vault is DEFERRED
(option C), and when it happens the target is 1Password — not Bitwarden.** This
section sketches the end state so that when it is picked up, the shape is already
argued.

**The principle: `.dev.vars` and `.env` stop being hand-edited masters and
become GENERATED artifacts.** The master moves into 1Password; the file on disk
becomes a build output that can be deleted and regenerated at will. The session
still never sees a value — but now neither does the disk, except transiently.

```
apps/worker/.dev.vars.tpl        # TRACKED. Names + op:// references. No values.
        │
        │  op inject -i .dev.vars.tpl -o .dev.vars      (generate, then push, then delete)
        │  op run --env-file=.dev.vars.tpl -- <command> (never touches disk at all)
        ▼
apps/worker/.dev.vars            # GENERATED. Gitignored. Ephemeral.
```

A template line looks like `HARDCOVER_API_TOKEN={{ op://Estate/hardcover/credential }}`
— **a name and a pointer, no secret** — so the template is safe to commit to a
public repo, and `.dev.vars.example` finally has a reason to exist beyond
documentation.

**What it fixes, mapped onto this review's findings:**

| Finding | How 1Password closes it |
|---|---|
| §3.1 — 11 secrets with no readable master | Every one gets a master in the vault. `ESTATE_APP_TOKEN_LIBRARY2`, `_AUDIOBOOK`, `_BOOKS`, `INDEX_READ_TOKEN_LIBRARY2`, `DONOR_TOKEN` stop being un-recoverable, and `auth-worker`/`audiobook-worker` gain the master they have never had |
| §3.4 — plaintext on a OneDrive disk | The generated file exists only between `op inject` and the push, and `op run` avoids the disk entirely. `docs/access/keys/*.txt` become vault items |
| §3.3 — pairs verified only by NAME | 1Password stores **one item with many holders**, so "which holders should have this value" becomes data instead of a table in a doc that goes stale |
| §3.6 — stale custody facts | The vault item *is* the custody record. A doc cannot drift from it if the doc stops claiming to hold it |
| RECOVERY §11.3 — *"in a machine-loss rebuild `CREDENTIALS.md` is gone"* | The vault survives the machine. This is the single biggest recovery win |

**The order to adopt it in** (each step independently useful, none of them a
big-bang):

1. **`library_catalog` first** — it already has the allowlist, the classification
   lists and the glued-value guard, so `push-secrets.mjs` gains an `op` source
   with the smallest change and the best test coverage.
2. **The three `docs/access/keys/*.txt` files next** — three items, no code, and
   it removes three raw values from a synced disk in one sitting.
3. **`catalog-platform`'s Workers third** — this is where the no-master secrets
   are, so it is the step that actually changes the recovery story.
4. **`audiobook_catalog/.env` last** — biggest file, most config-vs-credential
   sorting to do, and the two service-account JSONs and the Drive token need
   document-type items rather than password items.

⚠️ **What 1Password does NOT fix, and must not be claimed to:** Worker secrets
stay write-only, so the vault is a *master*, never a *readback* of what is
actually installed. `wrangler secret list` still proves only that a NAME exists.
The value-drift question — *are these two holders really equal?* — is still
answerable only by the last-4 fingerprint or by re-pushing both sides.

---

## 6. What each OTHER repo should change

⚠️ **Nothing outside `catalog-platform` was modified by this review.** These are
recommendations for those repos' own sessions.

**`bookbuddy/library_catalog`**
1. 🔴 **Close the custody gap** (its own `TODO.md` item): mint `DONOR_TOKEN`
   fresh into `.dev.vars` and add `AUDIOBOOK_MAPPING_TOKEN`'s value there too,
   so a bulk run can rotate them. Trailing-newline check first.
2. **Re-take the `secret:list` snapshot in `docs/access/secrets.md`** — it says
   friend has 7; friend has **10**. The header already flags it as un-re-taken;
   this closes it.
3. **KI-7** stays open until Sam mints her key — no action available here.

**`bookbuddy/audiobook_catalog`**
1. **Fix two stale rows in `CREDENTIALS.md` §6**: the library2 bearer is **no
   longer "pipe outstanding"**, and the Firebase service account has **6
   holders, not 5**.
2. **Fix §7 rule 7**: `TOKEN_SIGNER_KEY` is listed as a deliberately-unset
   secret. **It is set.** That rule protects real deliberate absences
   (`ebooks-door`'s empty list, friend's absent `INDEX_PUSH_TOKEN`,
   `GATE_HASH_SALT`, main's absent `DONOR_URL`) and a wrong entry weakens all of
   them.
3. **Add `Claude-llm` to the §2.6-equivalent list explicitly**, flagged as the
   key every `^[A-Z_]+=` grep misses — its own §7 rule 1 predicts this exact
   failure and it happened again today.
4. ⚠️ **Consider whether `CLOUDFLARE_ACCOUNT_ID` should be a GH *variable***, as
   it is in the other three repos.

**`boardbuddy/Board_Game_Catalog`**
1. 🔴 **Create `docs/access/secrets.md`** — 4 secrets, none documented. Even a
   one-screen stub naming the four, their pairs
   (`ESTATE_APP_TOKEN_GAMES` ↔ `estate-auth`, `INDEX_PUSH_TOKEN` ↔
   `INDEX_PUSH_TOKEN_GAME`) and the `.dev.vars` channel would do.
2. **Retire `docs/HANDOFF.md`** per `DOCS_STANDARD.md` — finished parts to
   `DONE.md`, live parts to `TODO.md`, durable facts to `access/`/`info/`, husk
   to `archive/`. It is a competing living doc.
3. **Confirm `.claude/worktrees/` and `.wrangler/` are in the TRACKED
   `.gitignore`** — KI-3 records that this repo's rule once lived only in
   `.git/info/exclude`, which is not committed. (The 2026-08-21 fix moved it;
   worth one `git check-ignore -v` to confirm it stuck.)

---

## 7. What this review did NOT verify — restated, because it matters

1. **That any two paired holders carry the same VALUE.** Every ✅ in §3.3 is
   name-parity. The estate has exactly one sanctioned value check
   (`push-secrets.mjs`'s last-4 fingerprint) and it covers only the main library
   path.
2. **The contents of any `.dev.vars`, `.env`, `*.json` key file or
   `docs/access/keys/*.txt`.** Not opened, by rule. Where a row says "master:
   library `.dev.vars` (file exists)", the *file* was measured; the *key name
   inside it* was not.
3. **Anything only a console can answer** — whether KI-8's stale Cloudflare
   token still exists, whether an old Firebase key was actually deleted after a
   rotation, whether `TOKEN_SIGNER_KEY`'s SA has one key or two.
4. **Whether `SHELF_PARITY_TOKEN`'s far side is still installed** on Justin's
   box, and therefore whether it can be retired today.
5. **Whether any of these files has actually been uploaded by OneDrive**, or
   what its sharing state is. Only the path was measured.
6. **The completeness of the git-history scan.** Five patterns. A credential in
   an unmatched shape — a bare hex token, a base64 blob, a URL-embedded password
   — would not have appeared. ⚠️ **`PEER_TOKEN` itself was a bare token inside a
   TOML config**, and it would NOT have been caught by these patterns. It was
   found by a human audit, and the next one will be too.
7. **Whether every secret listed is still USED.** `wrangler secret list` proves
   a name is set, never that any code reads it. `DISCORD_APPLICATION_ID` is the
   obvious candidate for "held as a secret but is not one".
