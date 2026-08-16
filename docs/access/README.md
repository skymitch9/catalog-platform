# Access Reference — index

> **Audience:** Claude sessions. **Status:** TRACKED (secret NAMES only,
> never values — this repo is private but the discipline is the same either
> way).
> Last verified: **2026-08-15**.

*How to reach and operate things.* For how/why the system works, see
[`../info/`](../info/README.md). For current work, decisions in flight, and
handoffs, see [`../TODO.md`](../TODO.md) — that stays the single living work
log. These docs hold **stable** facts only.

| Doc | Covers |
|---|---|
| [backup-restore.md](backup-restore.md) | The estate's backup & restore story: what's protected across all four repos, the manual `backup.yml` workflow, D1 Time Travel + export/import, the Firestore dump/restore scripts, R2's real gaps, and what's deliberately not backed up and why |
| [`../../tools/estate-probes/README.md`](../../tools/estate-probes/README.md) | The estate API testing suite (`npm run probe:estate`) — read-only, unauthenticated-edge probes against LIVE production across all four Workers, the audiobook static site, and the public Firestore doc; what's covered, what's NOT (every signed-in path), and the new-endpoint-gets-a-probe rule |

See also, in sibling repos:

| Doc | Repo | Covers |
|---|---|---|
| `docs/access/index-worker.md` | `library_catalog` | The cross-catalog index Worker — push protocol, tokens, freshness backstops |
| `docs/access/estate-auth.md` | `library_catalog` | The estate auth adoption runbook |
| `docs/access/FIREBASE.md` | `audiobook_catalog` | Firestore collections, the dev/prod lane split, rules deploy |
| `docs/access/GIT_CI_DEPLOY.md` | `audiobook_catalog` | audiobook's two-lane deploy, promote/rollback |
