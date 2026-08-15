# Covers Consolidation — Information Reference (plan)

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-14** — inventory measured live tonight against the
> production `board-game-catalog` D1 (remote, read-only) and a stratified
> HEAD/GET sample of 78 of the 506 hotlinked cover URLs (13/13 hosts sampled,
> 0 dead). **Research and plan only — no asset migration, no code, no deploy
> tonight.** Written by **Fable 5** on the owner's ask, pick #8 of "the
> owner's five" (`docs/TODO.md`).
>
> Companion docs: `sites/heygabi-home/public/_headers` (the CSP this plan
> prunes), `Board_Game_Catalog/docs/covers-wanted.md` (per-item cover
> sourcing decisions, unaffected by this plan), `bookbuddy/library_catalog/
> docs/cover-rehost-report.md` (the sibling migration this plan ports),
> `bookbuddy/library_catalog/docs/access/cloudflare.md` §7.1 (the R2 bucket
> recipe being reused), `bookbuddy/audiobook_catalog/docs/info/covers-r2.md`
> (the other sibling's R2 setup), `bookbuddy/library_catalog/packages/core/
> src/covers.ts` (the verify/hash/key code this plan ports).

---

## 0. TL;DR

The games catalog (`Board_Game_Catalog`, D1 `board-game-catalog`) has **never
had its own image storage.** Every one of its 506 covers is a hotlink to one
of 13 third-party hosts, and the estate apex's Content-Security-Policy
(`sites/heygabi-home/public/_headers`) carries all 13 by name so the
as-you-type search's thumbnails don't blank. The two book catalogs already
did this migration (library 2026-08-13, audiobook 2026-08-10) — this plan
ports their pattern to games:

1. **Inventory** (below): 506 `item.thumbnail_url` rows (503 distinct) across
   13 hosts, plus 974 `edition.image_url` rows (871 distinct) — the union is
   **1,124 distinct third-party URLs**. Estimated total weight: **~110–230
   MB**, comfortably inside R2's 10 GB free tier. **0 of 78 sampled URLs were
   dead** (measured tonight, not merely assumed).
2. **Target**: a new R2 bucket, `game-covers`, behind a new custom domain
   `gamecovers.heygabi.ai`, following the exact naming precedent of
   `bookcovers.heygabi.ai` (library) and `covers.heygabi.ai` (audiobook).
3. **Migration**: one idempotent script, ported from library's rehost run —
   download, verify (magic bytes + size floor), hash, upload
   content-addressed, rewrite `item.thumbnail_url` and `edition.image_url`
   guarded on old value, log a report for rollback (games has no
   `change_log` table, so the report file *is* the audit trail).
4. **Future covers**: hook the rehost into the one choke point that already
   exists for `thumbnail_url` writes (`updateItem` in `packages/db/src/
   items.ts`) plus the creation paths, so the hotlink count stops growing.
5. **CSP prune**: last step, only after a verification query returns zero
   rows referencing any of the 13 hosts.

---

## 1. Inventory — measured 2026-08-14

### 1.1 Which catalog owns each row

**All of it is `board-game-catalog`.** These 13 hosts are game-specific CDNs
(BoardGameGeek, Gamefound, D&D Beyond, Dice Throne's own WordPress site,
Kickstarter/BackerKit/Shopify storefronts). Neither `library-catalog` nor
`audiobook_catalog` references any of them — confirmed by the apex `_headers`
file's own comment, which attributes this exact 13-host tail to "the games'
long third-party tail" and nothing else. The two book catalogs' own hotlink
tails were already retired (library: `cover-rehost-report.md`, 2026-08-13;
audiobook: R2 since `0ab1e18e`/`39026da`).

### 1.2 `item.thumbnail_url` — what the index push and the apex search render

Query: `SELECT thumbnail_url FROM item WHERE thumbnail_url IS NOT NULL AND
thumbnail_url != ''` against production, remote — **506 rows, 503 distinct
URLs** (836 items total, so 330 have no cover at all — a separate, existing
concern tracked in `covers-wanted.md`, not this plan's problem).

Grouped by host, with a stratified sample (all URLs sampled for hosts with
≤6 rows; ~12% sampled, floor 8/ceiling 15, for larger hosts). Every sampled
URL was fetched with a real user agent, following redirects; **PowerShell's
`Invoke-WebRequest` was used after `curl.exe` on this machine returned a
false-negative `000`/exit-43 on every HTTP/2 host** (a schannel/libcurl
decode bug on this Windows box, not a real failure — verified by re-running
the identical URLs through PowerShell and getting clean 200s with real
image bytes; noted here so the next session doesn't waste time
re-diagnosing curl instead of switching tools):

| host | rows | % of 506 | sampled | sample dead | avg size (sampled) | est. total |
|---|---:|---:|---:|---:|---:|---:|
| `cf.geekdo-images.com` (BoardGameGeek) | 196 | 38.7% | 15 | 0 | 40 KB | 7.7 MB |
| `imgcdn.gamefound.com` | 113 | 22.3% | 14 | 0 | 561 KB | 61.9 MB |
| `www.dndbeyond.com` | 73 | 14.4% | 9 | 0 | 201 KB | 14.4 MB |
| `cdn.shopify.com` | 51 | 10.1% | 8 | 0 | 358 KB | 17.8 MB |
| `dicethrone.com` | 45 | 8.9% | 7 | 0 | 86 KB | 3.8 MB |
| `d1wgd08o7gfznj.cloudfront.net` | 11 | 2.2% | 8 | 0 | 159 KB | 1.7 MB |
| `images.squarespace-cdn.com` | 4 | 0.8% | 4 (all) | 0 | 585 KB | 2.3 MB |
| `i.kickstarter.com` | 3 | 0.6% | 3 (all) | 0 | 275 KB | 0.8 MB |
| `img.itch.zone` | 3 | 0.6% | 3 (all) | 0 | 314 KB | 0.9 MB |
| `loottavern.com` | 3 | 0.6% | 3 (all) | 0 | 245 KB | 0.7 MB |
| `cdn11.bigcommerce.com` | 2 | 0.4% | 2 (all) | 0 | 346 KB | 0.7 MB |
| `cdn.backerkit.com` | 1 | 0.2% | 1 (all) | 0 | 1007 KB | 1.0 MB |
| `files.d20.io` | 1 | 0.2% | 1 (all) | 0 | 37 KB | 0.0 MB |
| **Total** | **506** | 100% | **78 (15.4%)** | **0** | — | **~113.7 MB** |

**Rot rate: 0/78 measured (0%).** By the rule of three, the true rate is
bounded above by roughly 3/78 ≈ 3.8% at ~95% confidence — low, but not
"never," and the execution plan (§3) treats every URL as needing its own
verify-before-write regardless of this sample. `cover_check` (migration
0013, cron `*/30 * * * *`) already probes the live set continuously and
would be the fastest way to get an exhaustive rot count if wanted before
executing — see §3 step 0.

### 1.3 `edition.image_url` — the larger pool the item cover is chosen from

Query against `edition`: **974 of 1,067 rows carry an `image_url`, 871
distinct.** These are the "every printing this item could wear" candidates
the in-app cover picker (`CoverPicker.tsx`, `assembleCoverCandidates`-style
code in `packages/db/src/editions.ts`) offers, sourced from BGG's
`?versions=1` response and Kickstarter/Gamefound campaign backfills
(migration 0014). Most overlap with `item.thumbnail_url` (a chosen cover
usually **is** an edition row), but not all.

**Union of `item.thumbnail_url` ∪ `edition.image_url`, distinct: 1,124
URLs.** This is the true one-time migration size if both tables are rehosted
together — which library did (Task 1 there: "295 rows updated (171 work +
124 edition)"), for the same reason: an edition's image is retrievable
history, and leaving it a hotlink means the cover picker degrades exactly
the way the pre-rehost library one did.

The games app has no CSP of its own (it's a Worker with an `[assets]`
binding, not a Cloudflare Pages `_headers` file — confirmed by grepping the
whole repo for `Content-Security-Policy`, zero hits), so edition hotlinks
are not blocked by anything today. Migrating them is about **rot resistance
and consistency with the item covers**, not a CSP requirement — worth doing
in the same pass because it's the same script and the same verify step, not
a second effort.

---

## 2. Target architecture

### 2.1 Bucket: new, not shared — `game-covers`

**Recommendation: a new R2 bucket, `game-covers`, in the same Cloudflare
account** (`113be82b840c956b8378a187047ab3ea` — the account every Worker,
`library-covers`, and `audiobook-covers` already live in).

Reasons, weighed against reusing `library-covers`:

- **Precedent is one bucket per catalog.** `library-covers` ↔ `library-
  catalog`, `audiobook-covers` ↔ `audiobook_catalog`. A `game-covers` bucket
  keeps that 1:1 shape rather than making `library-covers` the odd one out
  that also holds an unrelated catalog's images under a prefix.
- **Blast radius.** `DESIGN.md`'s "separate blast radius" rule (cited
  verbatim in `index-worker-design.md` §7 for the index Worker's own
  wrangler.toml) applies just as well to storage: a bad games-side rehost
  run touching `library-covers` risks the already-completed, already-clean
  library migration for no reason.
- **Ownership clarity.** `Board_Game_Catalog`'s Worker binds its own bucket
  the same way `library_catalog`'s Worker binds `library-covers` — no cross-
  repo R2 binding to reason about, no new "which repo's wrangler.toml points
  at whose bucket" question.
- **Cost is not a factor either way** — see §3's size estimate; a shared
  bucket would save nothing meaningful.

### 2.2 Public hostname: `gamecovers.heygabi.ai`

Matches the naming precedent exactly: `covers.heygabi.ai` (audiobook, the
oldest), `bookcovers.heygabi.ai` (library). `gamecovers.heygabi.ai` continues
the `<word>covers.heygabi.ai` pattern rather than inventing a new shape.

⚠️ **Not verified tonight which of `covers.heygabi.ai` / `bookcovers.
heygabi.ai` is actually attached as a live R2 custom domain right now** —
`audiobook_catalog/docs/info/covers-r2.md` (last verified 2026-08-10) says
the custom-domain attach was still owner-only and undone, serving instead
from the rate-limited `pub-*.r2.dev` interim URL; but the apex `_headers`
file (verified 2026-08-14, four days later) writes as though
`covers.heygabi.ai` is live and serving 1,077 audiobook covers today. One of
these two docs is stale. **Confirm which, before tomorrow's step 2** — it
changes nothing about the games plan itself, but the DNS/domain-attach step
for `gamecovers.heygabi.ai` should copy whichever of the two prior domain
attaches actually happened, not the one that's merely documented.

### 2.3 Naming scheme: port `coverObjectKey` verbatim

`library_catalog/packages/core/src/covers.ts` already has the complete,
tested recipe:

- `sniffImageType(bytes)` — magic-byte detection (JPEG/PNG/GIF/WebP/AVIF),
  never trusts a declared `Content-Type`.
- `MIN_COVER_BYTES = 1000` — catches Open Library's 43-byte "no cover"
  placeholder and other fake-200 responses. **Directly relevant to games**:
  BGG and Gamefound may have their own placeholder patterns worth checking
  for during the actual run, even though none showed up in tonight's sample.
- `MAX_COVER_BYTES = 6 * 1024 * 1024` — rejects a raw photo upload;
  irrelevant for a hotlink migration (nothing sampled tonight came close)
  but worth keeping as a sanity ceiling on the fetch.
- `coverObjectKey(workKey, digestHex, type)` → `covers/{slug}-
  {sha256[0:16]}.{ext}` — content-addressed, so a replaced cover is a new
  URL and a cached copy can never go stale (1-year immutable
  `Cache-Control`, same as `library-covers`).

**Games has no `work_key`.** The `workKey` argument is just a slug seed;
pass `${item.id}-${item.name}` (or `${item.id}-${edition.name ?? item.name}`
for edition rows) — the function only uses it for a human-readable prefix in
the bucket listing, not as an identity key (the hash is). This requires zero
changes to the function itself.

**Porting, not importing.** `Board_Game_Catalog` and `library_catalog` don't
share a package boundary the way the three repos share `universes.json` and
`estate-auth` via `catalog-platform`'s `sync-*.mjs` mechanism — those exist
because `catalog-platform` is the deliberate upstream single source of truth
for those two things. Cover-verification code has never been that; it's a
small (~180 line), self-contained utility with no cross-repo state. **Copy
`covers.ts`'s verify/hash/key functions into a new `packages/core/src/
covers.ts` in `Board_Game_Catalog`, adapted for the `workKey` substitution
above.** If a *third* catalog ever needs the same code, that's the signal to
promote it into `catalog-platform` behind a real sync script — not before;
CLAUDE.md's "prefer shared canonical modules over synced copies" is a
guideline for genuinely shared state, and one fork today is not that yet.

### 2.4 Who uploads today vs. who keeps future covers estate-hosted

**One-time migration**: a new script, `Board_Game_Catalog/scripts/
rehost-covers.mjs` (or `.ts`), modeled directly on library's
`upload_covers_r2`-style run (`covers-r2.md` §3) and `cover-rehost-report.md`
§"Task 1". Reads every distinct URL from `item.thumbnail_url` ∪
`edition.image_url`, fetches, verifies, hashes, uploads to `game-covers`,
then rewrites every referencing row guarded on the row still holding the old
URL (optimistic concurrency — exactly library's pattern, "every UPDATE
guarded on the row still holding the old URL so a concurrent edit could not
be clobbered").

**Future covers — the actual intake question.** Every place `thumbnail_url`
or `image_url` gets written today stores the raw candidate URL verbatim,
with **no upload step anywhere in this codebase** (confirmed: `routes/
covers.ts` only does `cover_check` health probing, never storage — unlike
`library_catalog`'s `routes/covers.ts`, which is the write path). The write
paths, all in `packages/db/src/items.ts` and callers:

| Path | Where | Shape |
|---|---|---|
| **Update** (cover swap, BGG enrichment fill-in, CoverPicker apply) | `updateItem()`, `packages/db/src/items.ts` — the function's own comment calls this "the only place an item's `thumbnail_url` changes" *after creation* | Single choke point — **the natural hook** |
| **Create** (barcode scan match, vision scan, manual add) | `createItem()` (`items.ts`), fed by `apps/web/src/lib/catalog-add.ts`, `routes/scan-jobs.ts`, `routes/vision.ts`, `routes/bgg.ts` | Several callers, one DB function — **second hook** |
| **Bulk import** | `packages/db/src/import.ts` | Batch INSERT — **third hook, lowest traffic** |
| **Editions** (BGG versions backfill, campaign backfill) | `packages/db/src/editions.ts` (`insertBggVersions`-style, campaign insert) | Feeds the picker, not the live cover directly — can be rehosted lazily by a periodic sweep instead of inline, since it's not on the CSP-relevant path |

**Recommendation**: wrap the fetch-verify-hash-upload logic from §2.3 as a
shared function (`ensureCoverHosted(url) → hostedUrl`), call it from
`updateItem()` and `createItem()` right before the write — mirroring
library's stated plan ("Then do the same at intake so the number stops
growing," `improvement-proposals.md` §1.3). A URL already on
`gamecovers.heygabi.ai` short-circuits (no re-upload). Editions can stay
lazy (swept by the cron path, alongside `cover_check`) since they're not
what the apex CSP or index push render.

---

## 3. Execution plan for tomorrow

Ordered, each step with its verification and rollback. **Attended** — same
caution level as library's run ("SQL and R2 only — no repo source files were
touched, no deploys, no migrations" describes the *shape* to aim for, though
here new code is unavoidable since no upload path exists yet).

### Step 0 — Before touching anything: snapshot + exhaustive rot check

```bash
# From Board_Game_Catalog/apps/worker. Snapshot every referencing row —
# this file IS the rollback material, since games has no change_log table.
npx wrangler d1 execute board-game-catalog --remote --json --command \
  "SELECT id, thumbnail_url FROM item WHERE thumbnail_url IS NOT NULL AND thumbnail_url != ''" \
  > docs/covers-migration-2026-08-15-item-snapshot.json
npx wrangler d1 execute board-game-catalog --remote --json --command \
  "SELECT id, item_id, image_url FROM edition WHERE image_url IS NOT NULL AND image_url != ''" \
  > docs/covers-migration-2026-08-15-edition-snapshot.json
```

Optionally force a full `cover_check` pass first (`POST /api/covers/check`
in slices of `COVER_BATCH`, already built) to get an exhaustive rather than
sampled rot count before spending script time on URLs already known dead —
cheap, since the cron does this anyway.

**Verification**: two JSON files exist, row counts match §1.2/§1.3 (506 /
974).
**Rollback**: nothing mutated yet; this step is pure insurance.

### Step 1 — Provision the bucket and domain

```bash
wrangler r2 bucket create game-covers
# Dashboard → R2 → game-covers → Settings → Public access →
# Connect a custom domain → gamecovers.heygabi.ai
# Cache Rule on the zone: gamecovers.heygabi.ai/* → Edge TTL 1 year
#   (safe because objects are content-addressed, per §2.3)
```

Add to `Board_Game_Catalog/apps/worker/wrangler.toml`:

```toml
[[r2_buckets]]
binding = "COVERS"
bucket_name = "game-covers"

[vars]
COVERS_BASE_URL = "https://gamecovers.heygabi.ai"
```

**Verification**: `wrangler r2 bucket list` shows `game-covers`; after
deploy, a health/echo endpoint (port library's `GET /api/cover-storage`
pattern, `{"enabled":true}`) confirms the binding + base URL are both set —
library's "both, or neither" refusal rule is worth porting too, so a partial
config fails loud rather than storing an object nobody can resolve the URL
for.
**Rollback**: `wrangler r2 bucket delete game-covers` (bucket is empty at
this point — safe). Revert the `wrangler.toml` diff.

### Step 2 — Port the cover utilities

Copy `sniffImageType`, `MIN_COVER_BYTES`, `MAX_COVER_BYTES`,
`coverObjectKey`, `extensionFor` from `library_catalog/packages/core/src/
covers.ts` into a new `Board_Game_Catalog/packages/core/src/covers.ts`,
adapted per §2.3 (workKey substitution). Add the upload route
(`POST /api/items/:id/cover`, mirroring library's `routes/covers.ts`
upload half — today's `routes/covers.ts` in games only has `/health` and
`/check`).

**Verification**: `npm run typecheck` (this repo's only test gate for new
code per `index-worker-design.md` §7 step 2's own caveat — "No `test`
script there"). Manually exercise one upload against `wrangler dev` with a
known-good and a known-bad (43-byte placeholder, oversized) file.
**Rollback**: revert the commit; nothing external changed yet.

### Step 3 — Run the one-time rehost script (download → verify → upload → rewrite)

**Never rewrite-then-download** (§4's mitigation for the source-dies-mid-run
risk) — the script's own ordering enforces this: fetch bytes into memory,
verify, hash, upload to R2, and only *then* issue the guarded `UPDATE`. A
row is never pointed at an object that doesn't exist yet.

```
for each of the 1,124 distinct URLs (item ∪ edition):
  1. fetch (real UA, 10s timeout, 3 retries on transient failure)
  2. sniffImageType — reject non-image bytes regardless of declared type
  3. size floor/ceiling — reject placeholders and oversized files
  4. sha256, coverObjectKey(...)
  5. wrangler r2 object put (or R2 binding PUT if run as a Worker script)
  6. UPDATE item SET thumbnail_url = ? WHERE id = ? AND thumbnail_url = <old>
     UPDATE edition SET image_url = ? WHERE id = ? AND image_url = <old>
  7. log: url, outcome, new key, bytes — this log is the migration report
     (games has no change_log; the report file is the only audit trail,
     so do not skip logging a row just because it succeeded)
```

Checkpoint every N objects (library's R2 uploader checkpoints every 200,
for the same reason: a 10-minute task cap can kill a long-running upload
mid-batch — `covers-r2.md` §3 gotcha table). Idempotent: re-running skips
any URL already rewritten to a `gamecovers.heygabi.ai` key.

**Verification**:
```bash
npx wrangler d1 execute board-game-catalog --remote --command \
  "SELECT COUNT(*) FROM item WHERE thumbnail_url LIKE '%cf.geekdo-images.com%'
    OR thumbnail_url LIKE '%gamefound.com%' OR thumbnail_url LIKE '%dndbeyond.com%'
    OR thumbnail_url LIKE '%shopify.com%' OR thumbnail_url LIKE '%dicethrone.com%'
    OR thumbnail_url LIKE '%cloudfront.net%' OR thumbnail_url LIKE '%squarespace-cdn.com%'
    OR thumbnail_url LIKE '%kickstarter.com%' OR thumbnail_url LIKE '%itch.zone%'
    OR thumbnail_url LIKE '%loottavern.com%' OR thumbnail_url LIKE '%bigcommerce.com%'
    OR thumbnail_url LIKE '%backerkit.com%' OR thumbnail_url LIKE '%d20.io%'"
# target: 0
```
Spot-check 10 random rewritten items in the live web UI — cover renders,
same image (byte-diff against the pre-migration URL for a handful, the same
"open and visually confirm" step library did for its 21 found-covers).

**Rollback**: `docs/covers-migration-2026-08-15-*-snapshot.json` (step 0)
has every old URL. A restore script re-runs the same guarded-UPDATE pattern
in reverse. **Never deletes** the uploaded R2 objects on rollback — same
rule as `upload_covers_r2 --report-orphans`, "never deletes" — so a bad
rollback decision is still recoverable forward.

### Step 4 — Wire future intake (the "stops growing" half)

Add the `ensureCoverHosted()` call to `updateItem()` and `createItem()`
(§2.4). Deploy.

**Verification**: change a cover through the UI on a test item, confirm the
new `thumbnail_url` is a `gamecovers.heygabi.ai` URL, not the original
hotlink. Run one BGG-match barcode scan on a game with no existing cover,
confirm the same.
**Rollback**: revert the deploy (`wrangler rollback <version>`); D1 rows are
unaffected by a code rollback since nothing here changes schema.

### Step 5 — Prune the apex CSP (LAST, only after step 3 verifies zero rows)

Edit `sites/heygabi-home/public/_headers`: remove all 13 third-party hosts
from the `/` and `/admin` `img-src` directives, replacing them with nothing
(the games section of the comment block goes with them). Keep
`cf.geekdo-images.com` **only if** a decision is made to keep BGG-sourced
`?versions=1` thumbnails live-linked in the CoverPicker rather than rehosted
— per §1.3/§2.4 this plan rehosts everything, so it should go too, but flag
this as the one line item worth a final human glance before deleting, since
it's the largest single host (38.7% of covers) and the one most likely to
have a reason to stay live-linked that this research pass didn't surface.

**Verification**: reload `heygabi.ai` (apex search), type a query that
surfaces a game result, confirm its thumbnail still renders (now from
`gamecovers.heygabi.ai`, already allow-listed as the games catalog's own
cover host — confirm that line is *added* to `img-src` in the same commit
this plan's step 1 domain goes live, not left for a second pass). Browser
console shows no CSP violation.
**Rollback**: revert the `_headers` commit — Cloudflare Pages applies it at
the edge with no build step, so a revert is live within the next deploy.

### Size estimate

- **Objects**: 1,124 distinct URLs (§1.3).
- **Time**: library's R2 uploader measured ~3 objects/sec (Node-process-
  per-upload overhead, not bandwidth) for *already-local* files; this script
  also fetches remotely first, so budget more per object — call it 1–2/sec
  end to end with retries and the 200-object checkpoints. **~10–20 minutes**
  for the full run, single session, matching the order of magnitude of
  library's 296-row rehost the same night it was written.
- **Storage**: ~110–230 MB (§1.2's item-only estimate, roughly doubled for
  the edition superset) against R2's 10 GB free tier — **effectively free**,
  no billing consideration worth tracking.

---

## 4. Risks

1. **Hosts that may block scripted fetches.** Tonight's sample found **zero**
   blocking across all 13 hosts, including Kickstarter's signed,
   expiring-query-string URLs (all 3 sampled still resolved) and Shopify's
   CDN — but the sample was 78/1,124 distinct-URL-equivalent (15.4% of the
   item-level set, smaller as a fraction of the full item+edition union).
   `docs/covers-wanted.md` §"Only a Kickstarter image exists" already
   documents that **Kickstarter's signed URLs expire** — a URL working
   tonight is not a guarantee it works during tomorrow's run. **Mitigation**:
   run the actual migration soon after this plan, not deferred; treat any
   fetch failure during the real run as expected-possible, not a fatal
   script error — log and skip, don't abort the batch.
2. **A curl bug on this machine returns false 404-shaped failures.**
   `curl.exe 8.8.0` (Windows/schannel build) returns exit 43 / `000` on
   every HTTP/2 negotiated host tested tonight, even though the same URLs
   succeed via `Invoke-WebRequest` and via `curl -v` (which shows the
   transfer actually completing despite printing `schannel: failed to
   decrypt data, need more data` warnings). **If tomorrow's migration script
   is Node-based (`fetch()`), this specific bug likely does not apply** —
   Node's fetch doesn't go through `curl.exe`/schannel — but **do not use
   `curl.exe` as the fetch mechanism for the real script**, and if a fetch
   library reports a mysterious connection failure on a host that a browser
   loads fine, suspect the tool before the host.
3. **Download-verify-then-rewrite, never rewrite-then-download** (already
   built into §3's ordering) — a source that dies mid-migration (Kickstarter
   URL expiry, a Shopify store taken down) must not leave a row pointing at
   an R2 object that was never actually written. The guarded UPDATE only
   fires after a successful upload.
4. **Games repo has no `change_log` / audit table.** Library's rollback
   material is `change_log.old_json`; games has nothing equivalent. This
   plan's step 0 snapshot files are the substitute — **do not skip them**,
   since there is no other way to know what a row used to say if the
   migration needs to be partially reversed.
5. **Data-authority question: D1 is truth, not the games repo's static
   files.** Unlike `library_catalog`'s `catalog.csv`-vs-D1 question (not
   applicable there either, per that repo's own docs — D1 is truth), games
   has no CSV/file-based mirror at all: `item.thumbnail_url` and
   `edition.image_url` in the **remote production D1** are the only record.
   There is nothing to reconcile against — but this also means **there is
   no second copy to recover from** if a bulk UPDATE goes wrong outside the
   guarded-write pattern, which is why step 0's snapshot is not optional.
6. **The `covers.heygabi.ai` / `bookcovers.heygabi.ai` live-attach status
   conflict** (§2.2) should be resolved (a quick `dig`/`curl -I` against
   both) before choosing how to attach `gamecovers.heygabi.ai`, so the games
   domain doesn't inherit whichever sibling's setup turns out to be the
   half-finished one.
7. **cf.geekdo-images.com is 38.7% of the item-level covers and is the one
   host most likely to have a legitimate reason to stay live-linked**
   (BoardGameGeek serves versioned, frequently-updated images per printing;
   a rehosted copy could go stale the day BGG's community updates an
   entry's photo). This plan defaults to rehosting it like everything else
   — content-addressed storage means "stale" isn't really possible, a
   changed BGG image just becomes a new R2 object on the next intake-time
   sync — but flagged in §3 step 5 as worth a final glance rather than
   silently assuming the default is right for the largest single host.

---

## 5. Not assessed tonight, and why

- **Whether `wrangler r2 object put` from a long-running script hits the
  same ~3 obj/sec ceiling library measured**, or is faster/slower fetching
  remotely first — no real upload was attempted tonight (research-only
  scope).
- **BGG / Gamefound / Dice Throne's own placeholder-image patterns** (the
  OpenLibrary-43-byte-sentinel equivalent) — nothing in tonight's 78-URL
  sample looked like one, but the sample is not exhaustive and
  `MIN_COVER_BYTES` is the existing defense either way.
- **Whether `game-covers` should also absorb the "own host" bundled-asset
  pattern** library uses for some covers (`/covers/*.jpg`, 115 library rows)
  — games has no bundled-asset covers today (confirmed: every one of the
  506 is a hotlink), so this is moot unless a future scan-photo-as-cover
  feature is built.
