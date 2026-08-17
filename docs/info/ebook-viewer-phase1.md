# Ebook viewer phase 1 — Information Reference (BUILT, with evidence)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-17** — every number below was measured that day.
> §7 lists what was **NOT** verified, and the top of it is the one that matters.
>
> This is the **as-built** record for viewer phases **1a** (the gated byte
> stream, this repo) and **1b** (the PDF reader, `audiobook_catalog`). The
> DESIGN is `library_catalog/docs/info/ebook-viewer-design.md`; the measured
> EPUB fetch behaviour is `epub-streaming-findings-2026-08-17.md` beside it;
> phase 0a (the bucket + file ingest) is `audiobook_catalog/docs/info/ebooks-r2-ingest.md`
> (LOCAL — that repo's `docs/` is gitignored).
>
> ⚠️ **Where this doc and the design doc disagree, THIS one is what shipped.**
> §6 lists the three deliberate deviations and the measurement behind each.

---

## 1. What exists now

| | |
|---|---|
| Endpoint | **`GET\|HEAD https://audiobook-api.heygabi.ai/api/ebook/:anchor/file`** |
| Worker | `apps/audiobook-worker`, commits `653f2a6` + `65d7ff8`, versions `b5061759-cdc5-4e44-83c1-9053fd82362d` then **`41206de4-b5b8-41f6-af30-76fc482cde05`** |
| Reader | **`ebooks.heygabi.ai/read?b=<anchor>`** — ⚠️ PROD only after a promote; today it is `audiobooks.heygabi.ai/dev/read?b=<anchor>`. `audiobook_catalog` commit `af57fbb` |
| Renderer | **pdfjs-dist 5.4.149**, vendored to `site/static/pdfjs/`, Apache-2.0, no CDN at runtime |
| Bytes | R2 bucket **`estate-ebooks`** via `[[r2_buckets]] binding = "EBOOKS"`; 167 of 168 objects (§5) |
| Gate | the estate's **`vis_ebooks`** grant — ⚠️ **not** the ladder's `download` |
| `ESTATE_CHECK` | **untouched, still `"shadow"`.** This route deliberately does not read it |

---

## 2. The contract as shipped

### 2.1 Verbs and statuses

| Verb | Condition | Status | Body |
|---|---|---|---|
| `GET`/`HEAD` | no/invalid token | **401** `unauthenticated` | worded |
| | estate not configured | **503** `estate_unconfigured` | worded + `fix` |
| | estate unreachable | **502** `estate_unreachable` | worded |
| | estate `pending` | **403** `awaiting_approval` | worded |
| | estate `revoked` | **403** `access_revoked` | worded |
| | approved, no `ebooks` grant | **403** `no_ebooks_grant` | worded |
| | budget exceeded | **429** `rate_limited` + `Retry-After` | worded |
| | anchor not in the manifest | **404** `unknown_book` | worded |
| | **on the shelf, absent from the bucket** | **404** `file_absent` | worded |
| | `EBOOKS` / `EBOOKS_GATED` unbound | **503** `file_store_unbound` / `manifest_store_unbound` | worded + distinct `fix` |
| | range understood, unsatisfiable | **416** + `Content-Range: bytes */<size>` | worded |
| `GET` | granted, no `Range` | **200** | the stream |
| `GET` | granted, one valid `Range` | **206** + `Content-Range` | the slice |
| `HEAD` | as above | **200**/**206** | empty, same headers |

⚠️ **Nine distinct error codes, nine distinct sentences.** The four
404-class-adjacent causes in particular must never collapse into one: "your
link is stale", "the file was never uploaded", "you are not allowed" and "we
are misconfigured" have four different fixes and only one of them is the
reader's to act on.

### 2.2 Headers on every answer, refusals included

```
Accept-Ranges: bytes
Cache-Control: private, max-age=0, no-store
Vary: Authorization            (the CORS layer appends `, Origin`)
```

plus, on a body-bearing answer: `Content-Type` (from the object's stored
metadata, falling back to the manifest's `format`), `Content-Disposition:
inline` with both the ASCII and `filename*=UTF-8''` forms, `Content-Length`,
`ETag`, and `Content-Range` on a 206.

⚠️ **`Accept-Ranges` rides on refusals too, and that is not decoration.**
pdf.js decides whether to range-stream from the headers of the *first* response
it sees. A 401 that omits it, retried after sign-in, can leave a client
downloading a 181 MiB file whole. This was **missing on the first deploy** and
found by curling it — see §4.

⚠️ **`no-store` is unconditional and must stay so.** Cloudflare's edge cache is
keyed on URL and knows nothing about an `Authorization` header, so a cacheable
authenticated response is a public download endpoint with extra steps — the
exact outcome the design exists to prevent, arriving disguised as a
performance win.

### 2.3 Range semantics

`apps/audiobook-worker/src/range.ts`, pure and table-tested.

| Header | Answer |
|---|---|
| absent / empty | 200, whole |
| `bytes=A-B`, valid | 206, clamped to `size-1` |
| `bytes=A-` | 206 to the end |
| `bytes=-N` | 206, last N bytes |
| `bytes=A-…`, `A ≥ size` | **416** |
| `bytes=-0`, or any range on a 0-byte object | **416** |
| malformed (`bytes=10-5`, `bytes=abc`, `bytes=1 -3`, …) | **ignored → 200** |
| multi-range (`bytes=0-1,4-5`) | **ignored → 200** |

⚠️ **Malformed is ignored, not refused, and that is deliberate.** 416 means
*understood, and those bytes do not exist*. RFC 9110 §14.2 says to ignore a
`Range` you cannot parse. Collapsing the two would make a client bug and a
client mistake indistinguishable.

⚠️ **Multi-range is ignored WHOLE, never partially honoured.** Answering the
first span of a two-span request is the tempting shortcut and it is a silent
corruption bug: the client splices one 206 into the wrong offsets.

### 2.4 CORS

`SITE_ORIGINS` already carried both origins. What phase 1a added:

- **`Range` on `allowHeaders`.** ⚠️ Not optional. `Range` is not a
  CORS-safelisted request header, so *every* ranged fetch preflights, and a
  preflight that does not name it fails as an **opaque network error** —
  indistinguishable from the Worker being down, which is the misdiagnosis this
  estate has already eaten once.
- **`exposeHeaders`**: `Content-Range, Content-Length, Accept-Ranges, ETag,
  Retry-After`. Cross-origin JavaScript sees only safelisted response headers
  otherwise, so pdf.js would get a 206 whose `Content-Range` it cannot read.

### 2.5 The reading budget (§3.5)

Per isolate, in memory, **keyed on BOOKS rather than requests**:

| Axis | Limit / 5 min | Why |
|---|---|---|
| distinct anchors opened | 12 | a scraper needs 168; a reader opens one |
| total requests | 600 | ~15 range GETs per open × generous headroom |

⚠️ **Ranges within an already-open book are uncapped.** A page turn is several
range GETs and opening one EPUB is ~15; a per-request cap would throttle
*reading*, which is the failure this axis choice exists to avoid. The owner is
exempt — a break-glass that can be rate-limited is not one. Refusals are quiet,
worded, and carry `Retry-After`.

⚠️ **Never make this the security story.** A caller spread across N isolates
gets up to N budgets. It raises a scraper's floor; the gate is the gate.

---

## 3. The capability distinction — the sharpest edge in the build

**The stream gates on the estate's `vis_ebooks` READ grant. It must NEVER gate
on the ladder's `download` capability, whose floor is `admin`.**

Doing so would lock every ordinary household member out of *reading* books they
were explicitly granted — the exact inversion the design's §6.x records. Read
and download are two capabilities on purpose:

| | Capability | Grant mechanism |
|---|---|---|
| see the shelf + read in the viewer | estate **`vis_ebooks`** | a checkbox on `/admin`'s Ebooks row |
| take the file away | ladder **`download`**, floor `admin` | **promotion**, no checkbox anywhere |

Three things now enforce it rather than merely documenting it:

1. `test/ebook-file.test.ts` — *"a granted member with NO ladder rung still
   READS"*, run against an env with no service account so no rung is resolvable
   at all. Add `can(role, 'download')` to the stream and it goes red.
2. `tests/test_reader_page.py` — the shelf's Read button must not consult
   `can_download`.
3. ⚠️ **A stale comment in `ebooks.ts` was corrected.** It told the next agent
   the file route *"must ask the SAME question this does: `can(role,
   'download')`"*. That was wrong by exactly one capability and would have
   shipped a viewer nobody below `admin` could use. This is the clearest case
   in the estate of a comment being a defect.

⚠️ And the honesty the design insists on survives: **read-online vs download is
a product distinction, never protection.** Anyone who can stream every range
can concatenate them.

---

## 4. One gate, not two

`resolveEbookAccess()` in `apps/audiobook-worker/src/ebook-gate.ts` was
extracted from the manifest route when the stream became the second caller.
Both routes now ask one function, so **a shelf that admits someone the reader
refuses cannot happen**. Every refusal sentence moved verbatim; `ebooks.test.ts`
was not touched and stayed green.

⚠️ **The extraction had a cost that only a live curl found.** The gate writes
plain JSON for a route (the shelf) that needs neither `Accept-Ranges` nor
`Cache-Control`, so the byte stream's first deploy answered a bare 401. 189 unit
tests passed; they asserted those headers only on the 429. The fix dresses the
answer in the file route (the gate stays shared) and a new test walks **all six**
refusal paths, because each is written by different code.

**The lesson, stated for reuse:** *when a shared helper writes a response, the
CALLER's header contract is not inherited — and a test that checks one refusal
path has checked one refusal path.*

---

## 5. The one book that 404s, on purpose

`wrangler r2 object put` refuses files over 300 MiB (measured twice at phase
0a, `--pipe` included), so **the 393 MiB White Sand Omnibus is the one of 168
files not in `estate-ebooks`.** Opening it answers:

> **404 `file_absent`** — *"This book is on the shelf but its file has not been
> uploaded yet, so there is nothing to read. That is a gap on our side, not a
> permission problem — tell Mitch and he can push the file up."*

⚠️ Never a 403 (reads as "you are not allowed", sending someone to ask for
access they hold) and never a 500 (reads as "it is broken", sending them
nowhere). Fixing it needs an R2 API token and is an **owner step** — design
§2.2a, owner step 1.

---

## 6. Three deviations from the design, each on a measurement

### 6.1 ⚠️ `disableStream: true` — the design said `false`, and `false` is wrong

Design §5.1's config block specifies `disableStream: false`, and §5.3 promises
*"opening page 1 of a 181 MiB book transfers a few hundred KB, not 181 MB"*.
**With `false`, that promise is not kept.**

Measured 2026-08-17 against the real 181 MiB Stormlight handbook
(189,930,310 B) with the vendored pdf.js, on a local server counting bytes
actually delivered:

| `disableStream` | the full-file GET pdf.js opens beside its ranges | delivered |
|---|---|---|
| **`false`** | **ran to completion** | **189,930,310 B — 100%** |
| **`true`** | **aborted** | **655,360 B — 0.3%** |

Roughly **2.5 MiB to open the book instead of ~183 MiB**, for a **byte-identical
render** (392 pages; 1,065,914 ink pixels on page 1 either way; 12 MB JS heap;
113 ms to open).

⚠️ **`disableAutoFetch: true` alone does NOT prevent this** — that was the
assumption and it is false. The flags govern different things: autoFetch
governs speculative fetching of the *rest* of the document; stream governs the
whole-file read opened at the *start*.

⚠️ Honest caveat: measured on localhost, where the full transfer completes in
milliseconds, so `false` may abort earlier over a real network. That makes
181 MiB the worst case rather than the certain case — and there is no upside to
`false` to weigh against it.

### 6.2 `anchor → path` comes from the GATED manifest, not a public URL

Design §3.4 said to `fetch('https://audiobooks.heygabi.ai/ebooks.json')`
because *"the manifest is already public"*. ⚠️ **It is not, since 2026-08-17** —
the owner's *"I don't want people scraping my books"* took it out of the Pages
deployment and out of git. The Worker reads the same `ebooks.json` object from
the `EBOOKS_GATED` bucket that the shelf route reads, cached per isolate for 5
minutes.

Strictly better than the plan: shelf and reader resolve a book from one
byte-identical source, and no subrequest leaves the Worker.

### 6.3 The reader mounts at `/read`, not `/read/`, and its logic is external

- **No trailing slash**: `/read/` would re-base every relative URL on the page
  onto `/read/`, where nothing exists.
- **No `.html`**: Pages 308s it, and `ebooks-door` passes responses through
  verbatim, so the redirect escapes onto the audiobook host — measured on
  `/ebooks.html` the same day.
- **The logic is `site/reader.js`, not an inline script**, because `/read`'s CSP
  is `script-src 'self'` with no `'unsafe-inline'`. An inline script would be
  blocked in production and nowhere else.
- ⚠️ **`connect-src` needs `'self'`, and it was MISSING.** `default-src 'none'`
  blocks same-origin fetches too, and pdf.js fetches its cMaps and standard
  fonts with `fetch()` — so without it a CJK page renders as boxes and a
  non-embedded base-14 font renders as no text at all. Caught by serving the
  exact policy string locally and listening for `securitypolicyviolation`;
  fixed in `audiobook_catalog` `59147a5`. ⚠️ **The `/dev/` lane could never
  have caught it**: `deploy.yml` copies `prod-src/site/.` to the `_site` root
  and Cloudflare ignores nested `_headers`, so the live policy comes from the
  PROD branch and the dev lane ships none. The promote would have been the
  policy's first exercise.
- ⚠️ **The vendored files were renamed `.mjs` → `.js`.** Module scripts are
  refused on a wrong MIME type, and `.mjs` is not universally mapped (measured:
  a local server served it as `text/plain`, and Chrome refused the import). The
  live origin sends `nosniff`, so a wrong type there would be fatal with no
  fallback. Contents unchanged.

---

## 7. What was NOT verified

- 🔴 **NOBODY HAS OPENED A REAL GATED PDF WHILE SIGNED IN.** Every render
  measured above is against a **local file over a local server**, not through
  the Worker, R2, Cloudflare's edge, or a bearer token. The full path — token →
  gate → R2 → range → canvas — is **assembled and unexercised**. This needs the
  owner's eyes: <https://audiobooks.heygabi.ai/dev/read?b=&lt;anchor&gt;> (open a
  PDF from `/dev/ebooks` with "Show PDFs" ticked and press **Read**).
- **No authenticated request of any kind was made to the live endpoint.** No
  agent holds a Firebase ID token, so every live check is the unauthenticated
  half: 401s, their headers, and CORS preflights.
- **The 393 MiB omnibus's `file_absent` answer was proved by TEST, not live** —
  the live check needs a token.
- **`Accept-Ranges` → pdf.js range-mode is an inference on the live path.** It
  was measured locally (14 ranged requests to open the handbook), and the live
  endpoint advertises the header, but the two have not been observed together.
- **The reader's CSP has been exercised against the exact policy string in a
  real browser** (zero violations, a real PDF rendered) — but **never on the
  live origin**, where it cannot exist until the promote, and never over
  `https`.
- **Cloudflare's edge behaviour on a `no-store` 206 was not observed.** The
  header is right; nothing has confirmed the edge does not interfere.
- **No mobile device, and no low-memory device.** Every heap figure is one
  Windows desktop. The DPR cap at 2× is reasoning, not measurement.
- **The rate limiter was exercised only in unit tests**, never against a live
  isolate, and its per-isolate scope means live behaviour is by construction
  looser than the test's.
- **Token expiry mid-session is unhandled and untested.** pdf.js captures
  `httpHeaders` once, at `getDocument`; the reader forces a fresh token at open,
  buying an hour. A longer session ends in a 401 that surfaces as a worded
  refusal, not a crash — but nobody has sat there for an hour.
- **Two pre-existing `apps/discord-worker` test failures** were present before
  this work and are untouched by it (a concurrent agent's in-flight GABI work).
- **No claude.ai usage reading was taken** during this work.

---

## 8. The EPUB seam — for whoever builds phase 2

Everything phase 2 needs is built and gated already: sign-in, the manifest
lookup, the anchor contract, the error mapping, and a byte stream that honours
`Range` **for both formats**. Phase 2 replaces **exactly one branch** —
`openBook()`'s format switch in `site/reader.js`, documented there under
`EPUB_SEAM`.

- ⚠️ **foliate-js, NOT epub.js.** Measured on the 393 MiB omnibus: epub.js
  fetched 412,436,591 B into **1,207 MB of JS heap**; foliate-js with a zip.js
  `HttpRangeReader` did it in **78,741 B and 10.4 MB**.
- ⚠️ **Inject the range-reading loader deliberately.** foliate's own `view.js`
  builds `new ZipReader(new BlobReader(file))` over a whole in-memory Blob, so
  using it unmodified brings the whole-file fetch back and undoes the win.
- ⚠️ **Decide the renderer BEFORE phase 3 stores a position.** A CFI is a
  persisted key produced by a specific renderer; swapping later is a migration.
- **The 32 MiB size gate and its refusal card are NOT needed** — worth not
  building rather than building and removing.
- ⚠️ `blob:` is already in `/read`'s `img-src` and `frame-src`, placed there for
  this. Omitting it gives a reader that paginates perfectly and shows no images.
- The shelf's EPUB cards deliberately have **no Read button** until then, so
  nobody is offered a door onto a refusal.

---

## Related

- `library_catalog/docs/info/ebook-viewer-design.md` — the design. ⚠️ Its §5.1
  `disableStream: false` and §3.4 public-manifest lookup are both superseded by
  §6 above.
- `library_catalog/docs/info/epub-streaming-findings-2026-08-17.md` — the
  measured EPUB fetch behaviour phase 2 rests on.
- `audiobook_catalog/docs/info/ebooks-r2-ingest.md` — phase 0a, the bucket and
  the key scheme (LOCAL ONLY).
- [`audiobook-auth-migration.md`](audiobook-auth-migration.md) §5 Phase 4 — the
  sibling gated-read surface.
- [`../deploys.log`](../deploys.log) — the two phase-1a rows, `b5061759` and
  `41206de4`.
