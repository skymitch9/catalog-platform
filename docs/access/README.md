# Access Reference — index

> **Audience:** Claude sessions. **Status:** TRACKED (secret NAMES only,
> never values — this repo is private but the discipline is the same either
> way).
> Last verified: **2026-08-16**.

*How to reach and operate things.* For how/why the system works, see
[`../info/`](../info/README.md). For current work, decisions in flight, and
handoffs, see [`../TODO.md`](../TODO.md) — that stays the single living work
log. These docs hold **stable** facts only.

| Doc | Covers |
|---|---|
| [discord-bot.md](discord-bot.md) | The estate Discord bot (`apps/discord-worker`, built 2026-08-16, ⚠️ NOT deployed — no Discord application exists yet): secret NAMES, the owner's Developer Portal runbook (register app → secrets → deploy → set Interactions Endpoint URL → minimal-permission invite), and how Discord poll votes map to `votes/{slug}` |
| [backup-restore.md](backup-restore.md) | The estate's backup & restore story: what's protected across all four repos, the manual `backup.yml` workflow, D1 Time Travel + export/import, the Firestore dump/restore scripts, R2's real gaps, and what's deliberately not backed up and why |
| [estate-auth.md](estate-auth.md) | Estate SSO (`apps/auth-worker`): the Phase 1 `/__/auth/*` proxy and the Phase 2 session service — routes, secrets, the `TOKEN_SIGNER_KEY` rotation/revocation runbook, and §9 **the `/admin` page's interaction grammar** (owner order 2026-08-17: two gestures only — grants stage and a per-card Save appears; status actions tap twice — read it before adding any control there) (⚠️ the key that can mint a custom token for any estate user). Not to be confused with `library_catalog/docs/access/estate-auth.md` below — that one is the *adoption* runbook (a consumer wiring itself to the directory); this one is the *directory Worker's own* SSO build |
| [ebooks-gate.md](ebooks-gate.md) | The ebook permission gate (owner directive 2026-08-17, "I don't want people scraping my books"): how to grant/revoke the `ebooks` view grant and the `download_ebooks` side permission, who holds each today, how the manifest is published to the PRIVATE `ebooks-gated` R2 bucket, what every refusal code means — and the gotchas that cost real time (the repo is public so the deployment was only half the fix; ebook rows ride the PUBLIC `audiobook` search source; Pages answers a missing path 200 with the SPA fallback; a stripped file can keep serving from the edge cache and needs an owner purge) |
| [`../../tools/estate-probes/README.md`](../../tools/estate-probes/README.md) | The estate API testing suite (`npm run probe:estate`) — read-only, unauthenticated-edge probes against LIVE production across all five Workers (including the audiobook-worker at audiobook-api.heygabi.ai; the not-yet-deployed discord-worker prints a visible SKIP), the audiobook static site, and the public Firestore doc; what's covered, what's NOT (every signed-in path), and the new-endpoint-gets-a-probe rule |

See also, in sibling repos:

| Doc | Repo | Covers |
|---|---|---|
| `docs/access/index-worker.md` | `library_catalog` | The cross-catalog index Worker — push protocol, tokens, freshness backstops |
| `docs/access/estate-auth.md` | `library_catalog` | The estate auth adoption runbook |
| `docs/access/FIREBASE.md` | `audiobook_catalog` | Firestore collections, the dev/prod lane split, rules deploy |
| `docs/access/GIT_CI_DEPLOY.md` | `audiobook_catalog` | audiobook's two-lane deploy, promote/rollback |
