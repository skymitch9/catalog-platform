# Access Reference — index

> **Audience:** Claude sessions. **Status:** TRACKED (secret NAMES only,
> never values). ⚠️ **THIS REPO IS PUBLIC on GitHub** — measured with
> `gh repo view` 2026-08-17, as are the other three (`library_catalog`,
> `audiobook_catalog`, `Board_Game_Catalog`). This line claimed the repo was
> *private* until 2026-08-17 (estate credentials catalog F-1). The names-only
> discipline was never conditional on that, but the premise is what a session
> reasons FROM, and "it's private, so a name here is fine" is one short step
> from "so a value is fine" — in a repo the whole internet can read.
> Last verified: **2026-08-17**.

*How to reach and operate things.* For how/why the system works, see

> ⚠️ **The estate-wide credentials catalog is LOCAL-ONLY in `audiobook_catalog/docs/access/CREDENTIALS.md`** — every custody store, every paired token, the three env-file patterns, and each rotation procedure, in one place. It is deliberately not tracked in any repo (all four are public and the aggregation is more sensitive than the scattered names-only convention). Names only there too; never a value, anywhere.
[`../info/`](../info/README.md). For current work, decisions in flight, and
handoffs, see [`../TODO.md`](../TODO.md) — that stays the single living work
log. These docs hold **stable** facts only.

| Doc | Covers |
|---|---|
| [discord-bot.md](discord-bot.md) | The estate Discord bot (`apps/discord-worker`, **LIVE at discord.heygabi.ai since 2026-08-16**): secret NAMES, the owner's Developer Portal runbook (register app → secrets → deploy → set Interactions Endpoint URL → minimal-permission invite), how Discord poll votes map to `votes/{slug}`, `/have` + the dark moderation pair (§9), `/gabi` (§10), conversational GABI phase A (§11) and ⚠️ **the continuity layer (§12): the four ways to reach her, the exact script to try once she is lit, and the honest limit that a REPLY WITH THE PING SWITCHED OFF is invisible to her** |
| [backup-restore.md](backup-restore.md) | The estate's backup & restore story: what's protected across all four repos, the manual `backup.yml` workflow, D1 Time Travel + export/import, the Firestore dump/restore scripts, R2's real gaps, and what's deliberately not backed up and why |
| [estate-auth.md](estate-auth.md) | Estate SSO (`apps/auth-worker`): the Phase 1 `/__/auth/*` proxy and the Phase 2 session service — routes, secrets, the `TOKEN_SIGNER_KEY` rotation/revocation runbook, and §9 **the `/admin` page's interaction grammar** (owner order 2026-08-17: two gestures only — grants stage and a per-card Save appears; status actions tap twice — read it before adding any control there) (⚠️ the key that can mint a custom token for any estate user). Not to be confused with `library_catalog/docs/access/estate-auth.md` below — that one is the *adoption* runbook (a consumer wiring itself to the directory); this one is the *directory Worker's own* SSO build |
| [estate-docs.md](estate-docs.md) | The estate's searchable **docs corpus** (GABI docs assistant, phases 1/2/5/6, live 2026-08-18): the private `estate-docs-gated` R2 bucket, the publisher that runs on the owner's machine (⚠️ the only place all three docs trees exist), the three `requireDevops()` routes, the pipeline STEP 9 that refreshes it, and <https://heygabi.ai/docs/>. Read §6 before debugging anything: the Worker's **route mount order is load-bearing** (mounted wrongly the feature answers a 404 that reads as "not written yet"), the `.env` R2 token **does not reach this bucket** (measured — wrangler is the working transport), and a paused pipeline makes the corpus go stale silently, which is why every answer carries its publish date |
| [ebooks-gate.md](ebooks-gate.md) | The ebook permission gate (owner directive 2026-08-17, "I don't want people scraping my books"): how to grant/revoke the `ebooks` view grant and the `download_ebooks` side permission, who holds each today, how the manifest is published to the PRIVATE `ebooks-gated` R2 bucket, what every refusal code means — and the gotchas that cost real time (the repo is public so the deployment was only half the fix; ebook rows ride the PUBLIC `audiobook` search source; Pages answers a missing path 200 with the SPA fallback; a stripped file can keep serving from the edge cache and needs an owner purge) |
| [`../../tools/estate-probes/README.md`](../../tools/estate-probes/README.md) | The estate API testing suite (`npm run probe:estate`) — read-only, unauthenticated-edge probes against LIVE production across all five Workers (including the audiobook-worker at audiobook-api.heygabi.ai; the not-yet-deployed discord-worker prints a visible SKIP), the audiobook static site, and the public Firestore doc; what's covered, what's NOT (every signed-in path), and the new-endpoint-gets-a-probe rule |

See also, in sibling repos:

| Doc | Repo | Covers |
|---|---|---|
| `docs/access/index-worker.md` | `library_catalog` | The cross-catalog index Worker — push protocol, tokens, freshness backstops |
| `docs/access/estate-auth.md` | `library_catalog` | The estate auth adoption runbook |
| `docs/access/FIREBASE.md` | `audiobook_catalog` | Firestore collections, the dev/prod lane split, rules deploy |
| `docs/access/GIT_CI_DEPLOY.md` | `audiobook_catalog` | audiobook's two-lane deploy, promote/rollback |
