# Health-check envelope — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-14**.

## Why

The estate's four Workers (`index-worker`, `auth-worker` here in
catalog-platform; `library_catalog/apps/worker`; `Board_Game_Catalog/apps/worker`)
each grew their own `/api/health` response shape independently. The status page
(`sites/heygabi-home/public/status/status.js`) reads all four, and every new
worker meant a new set of field names to special-case. Item 5 of the
2026-08-14 estate normalization pass put one envelope on all four, additively,
so the status page can eventually read one shape instead of four.

## The envelope

Every `/api/health` now answers:

```json
{
  "ok": true,
  "service": "<worker's wrangler.toml name>",
  "version": "0.1.0",
  "time": "2026-08-15T03:35:06.155Z",
  "detail": { "...the worker's own pre-existing fields, unchanged, nested" }
}
```

- `ok` — same boolean the worker already computed (usually `database === 'up'`,
  or a hardcoded `true` for the two count-only endpoints that have no
  reachability check of their own).
- `service` — the `name` field from that worker's `wrangler.toml`
  (`catalog-index`, `estate-auth`, `library-catalog`, `board-game-catalog`).
- `version` — present where the worker has an `APP_VERSION` var
  (`library-catalog`, `board-game-catalog`). Omitted (not `null`) on
  `catalog-index` and `estate-auth`, which have no version binding.
- `time` — `new Date().toISOString()` at response time. `library-catalog` and
  `board-game-catalog` already had this field pre-envelope; it is now also the
  envelope's own `time`, computed once and reused for both.
- `detail` — the worker's **complete pre-existing response body**, unchanged.
  This is the field to read for anything that isn't `ok`/`service`/`time`.

## ⚠️ Additive transition — nothing removed this pass

Every field each worker returned **before** this change is **still present at
the top level**, exactly as before, alongside the new envelope fields. A
consumer written against the old shape (`body.sources`, `body.users`,
`body.version`, `body.database`, `body.universes`) keeps working with zero
changes. `detail` is a second copy of the same data, nested.

This was deliberate so the rollout could not break `status.js` (the only
consumer at the time) mid-deploy, regardless of which of the four workers had
redeployed yet.

**Removal is a later, separate, deliberate step** — dropping the top-level
duplicates once every known consumer reads `detail` instead. Nothing currently
tracks that step; when it happens, grep each repo's `/api/health` route for
`...legacy` (the spread that keeps the old fields at the top level) and the
call sites in `status.js`'s `detailOf()`.

## Per-worker before → after

| Worker | Pre-envelope body | `detail` now holds |
|---|---|---|
| `catalog-index` (`index.heygabi.ai`) | `{ ok, sources }` | same, verbatim |
| `estate-auth` (`auth.heygabi.ai`) | `{ ok, users }` | same, verbatim |
| `library-catalog` (`library.heygabi.ai`) | `{ ok, version, database, universes, time }` | same, verbatim |
| `board-game-catalog` (`boardgames.heygabi.ai`) | `{ ok, version, database, time }` | same, verbatim |

## Consumers

- **`sites/heygabi-home/public/status/status.js`** — the status page, and the
  reason this exists. Its `detailOf(body)` helper (near the top of the file)
  reads `body.detail` when present and falls back to the flat `body`
  otherwise, so it works unchanged against a worker on either shape. `ok` is
  still read off the raw top-level body everywhere, since every shape (old and
  new) carries it there.
- No other known consumer as of 2026-08-14 — each worker's own health route
  file says so in its header comment (`grep -rn "Envelope normalization"
  apps/*/src` across all three repos to find the routes).

## Where the code lives

- `catalog-platform/apps/index-worker/src/health.ts`
- `catalog-platform/apps/auth-worker/src/estate.ts` (the `GET /health` handler
  near the bottom of the file)
- `library_catalog/apps/worker/src/routes/health.ts`
- `Board_Game_Catalog/apps/worker/src/routes/health.ts`
