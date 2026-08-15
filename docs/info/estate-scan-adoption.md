# estate-scan.js — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Last verified: **2026-08-15**
> (the day it shipped — owner's bookstore trip).

## What this is

`sites/heygabi-home/public/assets/estate-scan.js` is the estate's ONE canonical
scanning module: barcode detection, camera capture, ISBN resolution, and
shelf/cover photo capture. `<estate-search scan>` (`assets/estate-search.js`)
imports it lazily for its 📷 button and manual-ISBN fallback. The contract is
in the module's own header — read that first; this file is the *why* and the
*what's left*, not a restatement of the API.

Ported from `library_catalog`'s real, proven, iOS-tested scanner
(`apps/web/src/lib/{scanner,camera}.ts`, `apps/worker/src/lib/vision.ts`,
`packages/core/src/{isbn,vision}.ts`) — not re-derived. See the module header
for the specific provenance of each export.

## Shipped 2026-08-15 (the bookstore deploy)

| Piece | Where | Status |
|---|---|---|
| Barcode detect (self-hosted zxing-wasm ponyfill) | `assets/estate-scan.js`, `assets/scanner/*` | **LIVE**, verified end-to-end on `heygabi.ai` and `/universes` |
| Camera open/close, permission handling | `assets/estate-scan.js` | **LIVE** — permission correctly requested; desktop verification only (no camera on the test machine) |
| ISBN → title/author resolve (Open Library, 2 fetches) | `assets/estate-scan.js::resolveIsbn` | **LIVE**, verified with `9780590353427` → a real search hit |
| 📷 UI + manual ISBN fallback | `assets/estate-search.js` (`scan` attribute) | **LIVE** on `/` and `/universes` |
| "Add to Books →" (queues a resolved ISBN into library_catalog's own intake queue) | `assets/estate-scan.js::addToCatalog`, `assets/estate-search.js::_renderAddAffordance` | **LIVE client-side.** Reuses `library_catalog`'s own `POST /api/scan-jobs/barcode` — NOT a hand-rolled `createWork` call (a barcode alone cannot honestly supply `format`/`publisher`; the intake endpoint runs the real ISBN ladder and dedup). CORS opened on the library Worker for `https://heygabi.ai` (`scanCors()` in `apps/worker/src/routes/scan-jobs.ts`), deployed same day. Verified to the 401/CORS boundary only — see below |
| Shelf/cover photo capture helper | `assets/estate-scan.js::captureFrame` | **Code complete**, unused (no UI wired to it yet) |
| Shelf/cover photo identify caller | `assets/estate-scan.js::identifyPhoto` | **Code complete**, calls a server endpoint that **does not exist yet** — see below |

## NOT shipped: the shelf-photo vision backend

The owner asked (mid-build) for a "scan a shelf" photo path to match
`library_catalog`'s real shelf-scanning sessions. The proven shape was
investigated and is fully specified below — it was **not built**, on the
explicit standing instruction that the barcode path ships first and photo
trails as a second deploy if it threatens the clock. It did.

**The proven server-side shape** (port verbatim, do not re-derive):

- Model: `claude-opus-5`, `output_config.effort: 'low'`, structured output via
  `output_config.format.type: 'json_schema'`.
- Prompt + schema: `library_catalog/packages/core/src/vision.ts` —
  `SHELF_SYSTEM`/`SHELF_SCHEMA` (many spines) and `COVER_SYSTEM`/`COVER_SCHEMA`
  (one cover, +series/volume/publisher). Copy these two prompts and two JSON
  schemas verbatim; they are tuned (rotated text, spine-vs-cover framing,
  "author null rather than guessed", the `unreadable` distinction).
- Call shape: `library_catalog/apps/worker/src/lib/vision.ts::readShelf()` —
  one Anthropic Messages call, one image content block (`base64`), check
  `stop_reason` for `refusal`/`max_tokens` BEFORE parsing content, parse the
  structured JSON, return `{books, unreadable, inputTokens, outputTokens,
  estimatedCents}`.
- Cost discipline: no `cache_control` on a system prompt under ~512 tokens
  (silently ignored, not an error — a wasted breakpoint reads as "caching is
  working" to the next person, so the library's own file says never add one
  there); `max_tokens: 8000` budgets thinking + JSON together since opus-5
  thinks by default.

**What the estate version does differently from library_catalog's**: no D1
job persistence, no catalog-matching index (`buildWorkIndex` et al) — the
apex has no per-catalog work table to match against. Per the owner's own
framing: *"component runs its normal scoped search per identified title"* —
so the estate server's job is ONLY photo → `[{text, author, confidence,
note}]`; matching is the CLIENT re-running `<estate-search>`'s existing
`_runSearch()` once per identified title, reusing the exact search path the
barcode result already uses. This is a smaller server than library_catalog's
— no D1 read at all, stateless.

**Sizing the remaining work** (for whoever picks this up):

1. `apps/index-worker/src/scan.ts` — new Hono sub-app, one route
   `POST /scan/shelf` (mounted at `/api` — the existing blanket
   `requireEstateMember()` in `index.ts` already gates everything mounted
   there, so no new auth code, just a new route file + import + `app.route`
   line). Port `readShelf()` trimmed to remove the D1/job bits. ~1-2 hours.
2. `env.ts` — add `ANTHROPIC_API_KEY: string` to the `Env` type.
3. **The secret.** The value already exists in
   `library_catalog/apps/worker/.dev.vars` (never printed to a transcript —
   pipe it directly: `awk -F= '/^ANTHROPIC_API_KEY/{...}' .dev.vars | wrangler
   secret put ANTHROPIC_API_KEY --config apps/index-worker/wrangler.toml`,
   run from `catalog-platform` with the library repo as a sibling checkout).
   If only the deployed secret exists and the local `.dev.vars` copy is gone,
   this needs a fresh key from the Anthropic console — say so, don't guess.
4. `assets/estate-search.js` — a "scan a shelf" second button/tab beside 📷,
   wiring `captureFrame` + `identifyPhoto` (both already written) to a
   per-title result list: `<title>` → run `_runSearch(title)` → render the
   normal own-it/not-owned answer, or "unidentified" for a spine the model
   couldn't read. `estate-scan.js`'s `identifyPhoto()` already expects exactly
   this response shape.
5. Deploy `apps/index-worker` (`wrangler deploy`, its own convention — check
   `apps/index-worker/README.md` or `deploys.log` if one exists there).
6. Test: a constructed image (render text into a canvas/PNG — a real bookshelf
   photo is not required to prove the pipeline; any image with legible text
   proves the vision call, the schema-conformant parse, and the per-title
   search fan-out) end-to-end BEFORE handing it to the owner's phone.

Rough total: half a day, most of it the endpoint + its first real test, not
the client (already written).

## Adoption plan: retiring library_catalog's own scanner onto this one

The owner asked that this be *sized*, not built, in this pass.

`library_catalog` (React/TS, Vite-bundled) currently owns its own copies of
everything `estate-scan.js` now also has: `apps/web/src/lib/scanner.ts` +
`camera.ts` (barcode + camera), `packages/core/src/isbn.ts` (the classify
gate — `classifyScannedCode`, richer than estate-scan's `classifyBarcode`:
it also recognises ASINs, which the estate version does not need since a
scanned barcode from a bookstore shelf is never a Kindle-only title).

**Why it hasn't already adopted the shared module, and won't trivially:**
`estate-scan.js` is a plain ESM `<script type="module">` file with no build
step — the exact shape `assets/estate-theme.css` and (via `groupBySeries`)
`assets/estate-search.js` already sync into `library_catalog` with
`scripts/sync-estate-theme.mjs`-style scripts. `library_catalog`'s scanner
is Vite-bundled TypeScript that imports `zxing-wasm/reader/zxing_reader.wasm
?url` — a bundler-specific import estate-scan.js deliberately avoids (see its
own header) so it works with NO build step on every consuming site. A sync
script could vendor the plain-JS pieces (`resolveIsbn`, `classifyBarcode`,
the camera helpers) unchanged, but the barcode decode loop and its
`preloadBarcodeDetector` warm-up are wired slightly differently in
`ScanPage.tsx` (continuous mode, duplicate-in-sweep prompting, a `seenRef`/
`promptedRef` pair) — real behavior the estate version does not replicate
(the apex scan is one-off "do I own this", not bulk shelf intake).

**Sized adoption**, smallest first:

1. **Trivial, safe now**: `library_catalog` could delete its own
   `resolveIsbn`-equivalent if it has one and call `estate-scan.js`'s instead
   via a `sync-estate-scan.mjs` script (new, ~20 lines, copy the
   `sync-estate-theme.mjs` shape) — but it doesn't have one; it never needed
   Open Library resolve client-side, its barcode screen resolves server-side
   through the full ladder. **No action needed here.**
2. **Medium**: vendor `assets/scanner/*` (the ponyfill + wasm) via the sync
   script instead of `library_catalog`'s own `npm install barcode-detector
   zxing-wasm` + Vite `?url` import. Saves ~1.1MB from node_modules and one
   less place the wasm version can drift from the estate's, at the cost of
   losing Vite's content-hashed cache-busting (the vendored file would need
   the sync script's own versioning, same trade estate-theme.css already
   made). **Worth doing, not urgent** — half a day, mostly testing that the
   iOS scan behavior is unchanged.
3. **Large, not recommended soon**: replacing `scanner.ts`'s decode loop with
   `startBarcodeScanLoop` outright. `ScanPage.tsx`'s continuous-sweep
   duplicate-prompting logic is real, tested-on-real-shelves behavior that
   `estate-scan.js`'s single-shot loop does not have and would need to grow —
   at which point it stops being "the same loop, reused" and starts being "a
   second continuous-mode loop the estate module now also carries for one
   consumer." Recommendation: leave `scanner.ts` as the sweep-mode
   implementation; if a second `continuous` consumer ever appears, add
   `continuous`/`ignore` options to `startBarcodeScanLoop` THEN (mirroring
   the library's own options) rather than speculatively now.

**Games (board-game catalog)**: no scanner exists there today (confirmed
absent — the games repo's `/api/scan-jobs` the owner recalled is actually
`library_catalog`'s route, not a games one; games has no barcode UI). Nothing
to retire. If a games barcode-to-catalog flow is ever built, it should start
from `estate-scan.js` directly rather than writing a third copy — `UPC`/EAN
board-game codes are NOT ISBN13s, so `classifyBarcode`'s Bookland gate would
need a games-specific variant (the Board Game Catalog's own prior finding,
noted in `library_catalog/apps/web/src/lib/scanner.ts`'s header, was that
`isPlausibleBarcode` accepted any 8-14 digit code — the opposite gate from
books). Not sized further here; noted as a future line only.
