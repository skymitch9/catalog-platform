# In-browser audiobook player — Feasibility study & design

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (this repo is
> public — no household names, no secret values).
> Last verified: **2026-08-17**. **RESEARCH + DESIGN ONLY — nothing here is
> built.** No code was written, no Worker touched, no deploy made.
>
> Owner's ask, verbatim: *"do research on any open source players we can
> incorprate into our app to play audiobooks? build out the feature design doc
> but don't execute yet. Im just curious about the feasibility."*
>
> ⚠️ Every number is labelled **MEASURED** (dated, re-checkable), **CITED**
> (a source, with its date) or **REASONED** (an inference — treat as a guess
> until exercised). §13 lists what was NOT verified, and its first item is the
> one that decides whether this ships at all.

---

## 0. FEASIBILITY VERDICT

**Feasible, and cheaper than the ebook viewer was — with exactly one genuine
unknown and one genuine platform risk.**

Nine-tenths of this feature already exists in the estate and needs only to be
pointed at a different file type. The gated byte stream with `Range`/206 that
`GET /api/ebook/:anchor/file` ships is *the same endpoint an audio stream
needs* — an `<audio>` element wants precisely what pdf.js and foliate-js
wanted. The chapter data the owner's hardest requirement depends on (a
**per-chapter** scrub bar) is **already extracted for all 1,079 books**
(MEASURED, §1.2) by a pipeline built for book clubs. The reading-position
store built the same week already has the right shape, the right key, and live
rules; audio positions are a third `kind`, not a second store. Speed to 3× is
one property on a plain `<audio>` element, with pitch preservation on by
default and Baseline-available since December 2023 (CITED, §6). 15-second
skips, chapter next/prev, a chapter menu and a sleep timer are all ordinary
JavaScript over `currentTime` and a chapters array.

**The one genuine unknown is the auth seam** (§3). `<audio src>` issues its own
range requests and cannot carry an `Authorization` header, so something must
put the credential on requests the page does not make. A service worker can
(and the PWA requirement means one is being built anyway), but that path has a
silent failure mode and has never been exercised on this estate. It is
solvable three different ways; none is free; one of them contradicts a rule
`ebook-file.ts` states in capital letters, so it is an owner decision, not an
engineering one.

**The one genuine platform risk is iOS, and it is not a small one** (§4.1).
Background audio in a *home-screen PWA* on iOS has been broken, semi-broken or
intermittently broken continuously from 2019 to the most recent report found
(late January 2026, iOS 26.2 — CITED). Audio in a *Safari tab* is fine. This
does not block the build; it means the honest promise to the household is
"open it in Safari on iPhone", and a phone-shaped disappointment must be
designed for rather than discovered.

**And one thing that is not a risk but is a bill:** the audio library is
**~14,805 hours** (MEASURED, §1.3). Putting it in R2 is **213–853 GB**
depending on bitrate, i.e. **$3.20–$12.80 a month** (MEASURED against published
pricing). That is affordable, but it is 150–600× the ebook shelf's 1.393 GB,
and it is a recurring cost the ebook build never had to name.

**Recommended shape:** a **thin custom UI over a bare `<audio>` element plus the
Media Session API** — no player library — with a **service-worker bearer
injector** for the stream, over an **audio sibling of the ebook byte route**.
Effort estimate: three phases, the first of which is a working player.

---

## 1. Ground truth — what already exists

Everything in this section was read or measured on **2026-08-17**.

### 1.1 The endpoint pattern is already built and already proven

`apps/audiobook-worker/src/ebook-file.ts` — `GET|HEAD /api/ebook/:anchor/file`.
Read its header comment before designing anything here; the three laws it
states (never buffer, never cacheable, never a URL that works on its own) apply
verbatim to audio and one of them is the crux of §3.

| Property | Value | Relevance to audio |
|---|---|---|
| `Accept-Ranges: bytes` on **every** answer, refusals included | shipped | ⚠️ **Safari decides whether a media element can play at all from this.** Even more load-bearing for audio than it was for PDF |
| `Range` parsing table (`src/range.ts`), 206 + `Content-Range`, 416 on unsatisfiable, malformed **ignored → 200** | shipped, table-tested | Reusable unchanged. ⚠️ The "malformed → 200" branch means a client bug becomes a **2.45 GB download** for audio, not a 393 MB one |
| `Cache-Control: private, max-age=0, no-store` + `Vary: Authorization` | shipped | Must carry over. Non-negotiable for the same reason |
| Streams `R2ObjectBody.body` straight through, never buffers | shipped | ⚠️ Mandatory: the largest audiobook is **2.45 GB** at 64 kbps (MEASURED §1.3) against a 128 MiB isolate |
| CORS: `Range` in `allowHeaders`, `Content-Range`/`Accept-Ranges`/`ETag` in `exposeHeaders` | shipped | Reusable. ⚠️ §3.3 adds a new requirement on top |
| Reading budget keyed on **books**, not requests (12 anchors / 600 requests per 5 min) | shipped | ⚠️ **Wrong sizing for audio** — see §7.5 |
| Gate: `resolveEbookAccess()`, one function, two routes | shipped | An audio route wants the same shape with a different grant — §3.5 |

**MEASURED (from `ebook-viewer-phase1.md` §9.7, live on 2026-08-17):** a 393 MiB
EPUB opened through this path in **9 range requests / 77,382 bytes**, and
Cloudflare's edge did not interfere with a `no-store` 206. The transport
question audio would otherwise have to answer is already answered.

### 1.2 The chapter data already exists — for every book

`bookbuddy/audiobook_catalog/app/tools/extract_chapters.py` → `site/chapters.json`.
Built for the book-club "Start Read" milestone modal. **MEASURED 2026-08-17:**

| | |
|---|---|
| Books | **1,079** — exactly the catalog's row count |
| Source | **`m4b` for 100% of them.** Zero `llm`, zero `hardcover`, zero `none` |
| Chapters | **46,659** total; median **39** per book; min 1, max **255** |
| Books with detected "Part N" groupings | **88** |
| Chapters with a null start time | **0** |
| File | `site/chapters.json`, **3,489,473 bytes**, keyed on the m4b `©nam` title tag |
| Git | **TRACKED** (`.gitignore` line 23 is an explicit `!site/chapters.json` negation) and published to the site — i.e. **PUBLIC today** |

Entry shape:

```json
"Conflicted Home": {
  "source": "m4b",
  "chapters": [ { "title": "Opening Credits", "start_min": 0.0 },
                { "title": "Chapter 1",       "start_min": 0.3 }, … ],
  "parts":    [ { "label": "Part One", "start_index": 3, "end_index": 41 }, … ]
}
```

Three consequences, and the first is the sharpest finding in this whole study:

- 🔴 **`start_min` IS ROUNDED TO 0.1 MINUTE — SIX SECONDS — AND THAT IS NOT
  GOOD ENOUGH FOR A PLAYER.** MEASURED: all ten tenth-of-a-minute digits occur
  in the corpus, so the rounding is real and uniform, not an artefact of the
  sample. `extract_chapters.py` line 78 does
  `round(float(ch["start_time"]) / 60, 1)`. Six seconds of error is invisible
  in a *"read to chapter 12 by Thursday"* milestone — which is what this
  pipeline was built for — and **audible** in a player: "next chapter" lands up
  to three seconds early (you hear the tail of the previous chapter) or three
  seconds late (you miss the first words), and a chapter-relative scrub bar is
  wrong at both ends of every chapter.
  **Fix: emit `start_sec` at full float precision alongside `start_min`.**
  `ffprobe -show_chapters` already returns `start_time` in seconds; the
  precision is thrown away at the last step. This is an additive schema change
  plus one re-run on the library machine, and it must land **before** any
  position is stored (§7.4 — a stored offset is a persisted key).
- **Chapters have starts, never ends.** A chapter's end is the next chapter's
  start; the **last** chapter's end is the book's duration, which lives in a
  different file (`catalog.csv`'s `duration_hhmm`, minute resolution). A
  per-chapter scrub bar therefore needs a durable book duration in **seconds**
  — and the honest source for that is the media element's own
  `audio.duration` once metadata loads, not the CSV.
- **The key is the title tag**, which is the same identity family
  `bookIdFromTitle()` folds for `readingPositions`. Chapters and positions will
  agree about what book they are on — which is *not* true of the ebook anchor
  (`reader-page.md` §7.1).

**Alternative considered and rejected for phase 1:** parse the m4b's own
chapter atoms in the browser. The data is in the file, so it needs no pipeline
— but it means an MP4 box parser, a `moov` atom whose position in the file is
not guaranteed, and a second implementation of chapter identity. `chapters.json`
already exists, is already keyed correctly, and is already correct for 1,079 of
1,079 books. Use it.

### 1.3 The library — the number that sets the bill

**MEASURED 2026-08-17** from `site/catalog.csv` (1,079 rows, `duration_hhmm`
parsed for all 1,079, zero failures):

| | |
|---|---|
| Total runtime | **14,804.5 hours** |
| Mean / median book | **13.72 h** / 12.08 h |
| Longest book | **85.1 h** (*Galaxy Outlaws: The Complete Black Ocean Mobius Missions, 1–16.5*) |
| Books over 20 h | 173 |

**REASONED** (arithmetic from those durations; the library's actual encoding
bitrate was **not** measured — see §13):

| Bitrate | Total | R2 at $0.015/GB-mo | Mean book | Largest book | **Books over the 300 MiB `wrangler` wall** |
|---|---|---|---|---|---|
| 32 kbps | 213 GB | **$3.20/mo** | 198 MB | 1.23 GB | **128** of 1,079 |
| 64 kbps | 426 GB | **$6.40/mo** | 395 MB | 2.45 GB | **641** of 1,079 |
| 128 kbps | 853 GB | **$12.79/mo** | 790 MB | 4.90 GB | **978** of 1,079 |

⚠️ **The 300 MiB wall is not theoretical here — it is the common case.**
`scripts/upload_ebooks_r2.py` records it as MEASURED twice: `wrangler r2 object
put` refuses files over 300 MiB, and it cost the ebook build exactly one book
out of 168. For audio it costs **128 to 978 books out of 1,079**. The boto3
multipart path that script already carries is therefore **the primary upload
path from day one**, not a fallback. (R2's own object ceiling is far above
this; the wall is `wrangler`'s.)

R2 egress is **free** (CITED — Cloudflare R2 pricing), which is what makes a
14,805-hour library affordable to serve at all. Class B (read) operations are
$0.36/million with 10 million free per month; a household will not approach it.

### 1.4 The position store already has the right shape

`audiobook_catalog/site/reading-position.js` + `firestore.rules`. Built
2026-08-17 (`c059e24`, `ec74c31`), live rules smoke-tested **16/16**.

- Doc id `${uid}_${bookId}`, `bookId = bookIdFromTitle(title)` — **not** the
  anchor, deliberately, because the anchor is a path hash and re-filing a book
  would silently orphan every position on it.
- `pos` is one atomic map: `{ kind, value }`, and `kind` travels with `value`
  by rule so the pair can never disagree.
- Two stores: `localStorage` read **synchronously** for first paint (never on
  the critical path), Firestore as the store, reconciled **last-write-wins**
  on a client-clock `updatedAt`.
- A newer remote position that points elsewhere is **offered, never applied** —
  the `#rd-resume` bar: *"You were at Chapter 7 · 27% on Windows · Chrome —
  Jump / Stay"*.

🔴 **But the rules currently forbid audio, and that is a deploy, not an edit.**
MEASURED — `firestore.rules` `validReadingPosition()`:

```
&& request.resource.data.format in ['pdf', 'epub']
&& request.resource.data.pos.kind in ['page', 'cfi']
```

Storing an audio position requires `'audio'` in the first list and `'audio'` in
the second, in **both** lanes (`readingPositions` and `readingPositions_dev`).
Standing permission exists for `firebase deploy --only firestore:rules` from
main, with a smoke test after — but this is a rules change with a live
smoke-test obligation, and a phase that writes positions before the rules ship
fails silently in a way that looks exactly like "the player does not save".

### 1.5 What does NOT exist yet

**MEASURED** by search on 2026-08-17:

- **No PWA of any kind.** No `manifest.webmanifest`, no `sw.js`, no
  `serviceWorker.register` anywhere in `audiobook_catalog/site/` or its
  templates. The service worker this design leans on is a **from-scratch
  build**, not an extension of something working.
- **No audio manifest, no audio anchors, no audio bucket.** `ebooks.json` /
  `ebook_anchor()` / `estate-ebooks` have no audio sibling. `catalog.csv` has
  no path column and no file-size column.
- **No audio grant.** The estate has five catalogs
  (`audiobook, library, games, library2, ebooks`); audio *bytes* are not one of
  them — §3.5.

---

## 2. Open-source players — the survey

### 2.1 The landscape is mid-consolidation, and that is the headline

**CITED, primary sources:** on **2026-01-21** Vidstack's maintainer announced
that *"Vidstack, Media Chrome, and Plyr are combining forces. We're building
Video.js v10 from the ground up at Mux."* The **2026-03-10** Video.js blog post
shipped that beta: a ground-up rewrite, 88% smaller default bundles, audio
presets and audio skins included, APIs explicitly *"not quite stable"*, **GA
targeted mid-2026**.

**MEASURED against the npm registry, 2026-08-17** — GA has not landed on the
`latest` tag:

| Package | `latest` | Published | License | Read |
|---|---|---|---|---|
| `video.js` | **8.24.0** | **2026-08-03** | Apache-2.0 | v8 actively maintained; **v10 not on `latest`** |
| `vidstack` | **0.6.15** | **2024-04-19** | MIT | ⚠️ `next` tag is `1.15.6`, package modified 2026-06-10 — the stable tag is **two years old** |
| `plyr` | **3.8.4** | 2026-01-03 | MIT | Version unchanged for years; no npm deprecation flag |
| `mediaelement` | **7.1.0** | 2025-11-12 | MIT | Alive, but a jQuery-era design |
| `howler` | **2.2.4** | **2023-09-19** | MIT | ⚠️ **No release in ~3 years** |
| `shaka-player` | **5.2.6** | **2026-08-16** | Apache-2.0 | Very active — and aimed at a different problem |

⚠️ **Adopting Plyr, Vidstack or Media Chrome today buys a migration**, because
all three are being folded into something else by their own authors. Adopting
Video.js v8 today buys a migration to v10. Adopting Video.js v10 today buys a
beta whose interfaces its authors say will change.

### 2.2 The candidates, judged against *this* feature list

The question is not "is it a good player" — several are. It is **what does it
add over a bare `<audio>` element for these seven requirements**.

| | License | What it actually adds here | Verdict |
|---|---|---|---|
| **Bare `<audio>` + Media Session** | n/a | Nothing to add — it *is* the mechanism the others wrap. Every requirement maps to `currentTime`, `playbackRate`, `duration` and a chapters array (§8) | ✅ **Recommended** |
| **Plyr** | MIT | A clean, accessible skin and a keyboard map. Its seek bar is **book-relative** and its speed menu is a fixed list | ❌ Being folded into Video.js v10 by its own authors |
| **Vidstack** | MIT | Framework-agnostic web components, strong a11y, an audio layout | ⚠️ Closest migration path per its maintainer — but `latest` is 0.6.15 from 2024 and the real work is on an unreleased `next` |
| **Video.js v8** | Apache-2.0 | A large, stable, plugin-rich player. **~200 kB+ before v10's diet** (CITED) | ❌ Weight and a known migration ahead |
| **Video.js v10** | Apache-2.0 (v8's licence; **v10's not confirmed — §13**) | The likely right answer *in a year*. Audio presets and skins already in the beta | ⏳ Revisit at GA |
| **Media Chrome** | MIT | Headless, composable media UI elements — philosophically the closest to "thin UI" | ❌ Same merge |
| **Howler.js** | MIT | A sound-effects/game audio library. Documents `rate` as **0.5–4.0** (CITED — covers 3×) and **requires `html5: true` for large files** because its Web Audio default *decodes the whole file first* | ❌ Wrong tool. Web Audio's `decodeAudioData` on a 2.45 GB book is an OOM, and with `html5: true` you are back to a bare `<audio>` element with a wrapper on top |
| **Shaka Player** | Apache-2.0 | DASH/HLS adaptive streaming, EME/DRM | ❌ Solves a problem the estate does not have, and would require **remuxing 1,079 books** into segmented streams |
| **Audiobookshelf's player** | 🔴 **GPL-3.0** (CITED — repo `LICENSE`) | The only surveyed option built *for audiobooks*: chapter tracks, speed, sleep timer, cross-device progress | ❌ **Do not copy code.** GPL-3.0 is viral, this repo is **public**, and the estate's code is not GPL. ✅ **Do read it for design** — it has solved these exact UX problems and its issue tracker (e.g. *"Show progress bar by chapters instead of by audio file"*) is a free requirements review |

### 2.3 Recommendation: thin custom UI over `<audio>` — and it is not a close call

Five reasons, in order of weight:

1. ⚠️ **THE OWNER'S HARDEST REQUIREMENT IS THE ONE NO LIBRARY SHIPS.** *"the
   scrub bar should be per chapter not per book"*. Every player surveyed draws a
   **book-relative** seek bar, because that is what a media file is. Using one
   means either fighting its seek bar or replacing it — and replacing the seek
   bar is most of the UI work. The library would be carried for the parts that
   are *already easy*.
2. **The estate's own precedent points here.** pdf.js and foliate-js were
   vendored because rasterising PDF and paginating EPUB are genuinely hard and
   the browser will not do them. **Decoding AAC and seeking in an MP4 is the
   browser's job** — it does it natively, in C++, with hardware decoders and
   OS-level media integration. A player library adds a skin, not a capability.
3. **The consolidation makes every library a migration** (§2.1).
4. **CSP.** `/read`'s policy is `script-src 'self'` with no `'unsafe-inline'`
   and no CDN, so anything adopted must be **vendored** and audited
   (`ebook-viewer-phase1.md` §6.3 — and §9.3 records how a two-directive CSP
   gap produced a *silent* defect that looked like a badly-made book). A smaller
   dependency surface is directly cheaper here.
5. **The whole custom surface is small.** A play/pause button, two skip
   buttons, a chapter-relative bar, a speed control, a chapter list, a sleep
   timer, and ~30 lines of Media Session wiring. Perhaps 500–700 lines with
   tests — comparable to `reading-position.js`, and every line of it is a line
   this feature needs anyway.

**Revisit trigger, written down so it is not forgotten:** when **Video.js v10
reaches GA** (targeted mid-2026, not on the `latest` tag as of 2026-08-17),
re-evaluate — specifically whether its audio preset can accept a
**chapter-relative** seek bar as a first-class control. If it can, the custom UI
becomes a skin over it. If it cannot, the decision above stands permanently.

---

## 3. The auth seam — the hard problem

### 3.1 Why it is hard, stated precisely

`<audio src="https://audiobook-api.heygabi.ai/api/audio/:anchor/file">` makes
the browser — not the page — issue the HTTP requests. It will issue **many**:
an initial probe (Safari opens with `Range: bytes=0-1`, CITED), a metadata
fetch, then rolling range requests for hours. **The page cannot attach an
`Authorization` header to any of them.** There is no API for it; this is by
design in HTML.

⚠️ **The pdf.js / foliate-js answer does not transfer.** Those readers work
because the *application* fetches every byte (`httpHeaders` at `getDocument`;
`epub-range.js` re-asking for a token on every range) and hands buffers to a
renderer. Audio has no equivalent: you cannot hand an `ArrayBuffer` to an
`<audio>` element and have it stream — you can only give it a URL, or go to
MSE (§3.4), which for a 13.7-hour mean book means re-encoding the library.

### 3.2 Option A — service-worker bearer injection ✅ **RECOMMENDED**

A service worker registered on `audiobooks.heygabi.ai` sees the `fetch` event
for requests its controlled pages cause, **including cross-origin subresource
requests**, and can answer them with its own `fetch()` carrying whatever headers
it likes.

**Why it wins:** the PWA requirement means a service worker is being built
regardless (§4). This makes the auth seam *free* in marginal cost. It also
preserves `ebook-file.ts`'s law 3 exactly — the credential stays a header on
every request, the URL still 401s if copied, and revocation still bites
mid-session because every range is re-verified.

**The five things that will go wrong, and what to do about each:**

1. ⚠️ **The `Range` header must be re-applied by hand.** Constructing a new
   `Request` from an existing one and modifying its headers is the operation
   that historically dropped `Range` — CITED (web.dev): Chrome/Edge fixed it in
   **v87**, Safari in *"recent versions"* as of Oct 2020, Firefox later. Do not
   rely on it surviving: read `event.request.headers.get('Range')` explicitly
   and set it explicitly on the outgoing request. This is a two-line habit that
   prevents a 2.45 GB download.
2. ⚠️ **The 206 must be returned verbatim.** WebKit bug **184447** (*"mp4 video
   element broken with service worker"*, **RESOLVED FIXED 2019-11-05**, CITED)
   is the historical record: WebKit's media loader **rejects a 200 answering a
   range request**, where other browsers tolerate it. Never rewrite the status,
   never re-wrap the body, never strip `Content-Range`. Combined with
   `range.ts`'s "malformed → 200" branch (§1.1), a sloppy service worker
   produces *"the audio silently will not play in Safari"* and *"we served a
   2.45 GB file"* in the same bug.
3. ⚠️ **The token lives in IndexedDB, not `localStorage`.** A service worker
   has no `localStorage`. The page writes a fresh ID token to IndexedDB and
   `postMessage`s the worker on refresh; the worker reads it per request. ⚠️
   **A service worker is terminated when idle** — during a paused book, or
   between buffering bursts — and restarts on the next fetch event with **no
   memory**. Any token cached in a module-level variable is gone; the IndexedDB
   read must be on the request path.
4. ⚠️ **Cross-origin + `Authorization` forces a CORS preflight.** The request
   becomes `mode: 'cors'`, and neither `Authorization` nor `Range` is
   CORS-safelisted, so an `OPTIONS` precedes it. `SITE_ORIGINS` and
   `allowHeaders` already carry `Range` (added for the ebook stream) — but
   **`Authorization` must be verified present**, and an `Access-Control-Max-Age`
   worth setting so a long listen is not preflighting all afternoon. ⚠️ A
   preflight that fails presents as an **opaque network error**, which this
   estate has already misdiagnosed once as "the Worker is down"
   (`ebook-viewer-phase1.md` §2.4).
5. 🔴 **THE FAILURE MODE IS A SILENT DEAD BUTTON, AND THAT VIOLATES A STANDING
   RULE.** If no service worker controls the page — the very first load before
   activation, a hard reload, private browsing, a registration that failed —
   the request goes out bare, the Worker answers a correct, worded **401**, and
   the `<audio>` element reports it to the page as a **bare `error` event with
   no status code**. The person sees a play button that does nothing. The
   estate's rule is explicit: *a person must never see a bare HTTP status*, and
   a silently dead button is worse than one.
   **Mitigation, and it is mandatory:** before setting `src`, the page issues
   its own `fetch()` `HEAD` for the same URL with a real bearer. That request
   the page *can* read: it yields the real status and the Worker's worded
   sentence, so a refusal is displayed in words. It also proves the seam works
   before the element is asked to use it. Additionally: refuse to render the
   play button at all until `navigator.serviceWorker.controller` is non-null,
   and say *"getting the player ready…"* in the meantime.

### 3.3 Option B — cookie-scoped auth on the audio host ⚠️ the honest fallback

The Worker exchanges a verified bearer for a short-lived, `HttpOnly`, `Secure`
cookie scoped to the API host; the element is marked
`<audio crossorigin="use-credentials">` so its requests carry it.

**Strengths, and they are real:** it works with **no service worker at all**,
on every browser, on the first load, in private browsing, and it survives every
one of §3.2's five hazards. It is still a *session record* the Worker can
revoke — not a self-contained signature — so the estate's revocation promise
survives. It is the only option that is robust on the platform the household
will actually use (iPhone).

**Costs, stated honestly:** cross-site delivery requires `SameSite=None`, which
is ambient authority — any page that can cause a request to that host rides it,
where a bearer header is carried only by code that deliberately attaches it.
The response must then send `Access-Control-Allow-Credentials: true` with an
**exact** origin, never `*`. Narrowing the blast radius means a dedicated
hostname for audio bytes.

**Verdict:** design A and B to be **switchable behind one function**, and ship
A first. If iOS proves hostile to the service-worker path (§4.1 makes that a
live possibility), B is the escape hatch and it must not be a rewrite.

### 3.4 Options considered and rejected

**Short-lived signed URLs.** 🔴 **This contradicts a rule `ebook-file.ts`
states in capital letters** — *"NEVER a URL that works on its own… A signed URL
would be the credential — surviving in history, referrers, screenshots and
logs — and could not be revoked mid-session, which is precisely the estate's
revocation promise."* Changing that is an **owner decision** (§12), not an
engineering shortcut. And on the merits it is worse here than it was for
ebooks: a 13.7-hour mean listen outlives any TTL short enough to be safe, so
the player must swap `src` mid-playback to re-sign — and swapping `src` on a
media element is a reload, a re-seek and an audible gap. A TTL long enough to
avoid that is a TTL long enough to be a leaked download link.

**MSE / ManagedMediaSource.** This is the true analogue of the pdf.js pattern —
JS fetches ranges with a bearer and appends to a `SourceBuffer`. Two blockers,
either of which is fatal for phase 1. (a) **MSE needs fragmented MP4**; a
plain `.m4b` is not fragmented, so the entire 1,079-book library would need
remuxing to fMP4/CMAF or HLS — a pipeline of a different magnitude, plus a
second copy of 213–853 GB. (b) On **iPhone**, plain MSE is unavailable; Apple
gated it behind **ManagedMediaSource**, which landed in **Safari 17.1** (CITED)
and is *"only available when an AirPlay source alternative is present, or remote
playback is explicitly disabled"*. Revisit only if adaptive bitrate ever
becomes a requirement.

**Fetch-the-whole-file to a Blob URL.** For *streaming*, no: a 395 MB mean and
2.45 GB max against browser memory. ✅ **But for OFFLINE it is exactly right** —
§4.3. Once bytes are in OPFS, `URL.createObjectURL(file)` hands the element a
same-origin blob it ranges internally, and **the auth seam disappears
entirely**. Worth stating plainly: *the offline path is the easy path.*

### 3.5 Which grant gates the bytes — ⚠️ an owner decision, not a default

The estate has five catalogs: `audiobook, library, games, library2, ebooks`.
**MEASURED** from `estate-auth-design.md` §4.5 and its 2026-08-17 amendment:

| Grant | Default | In the PUBLIC slice? |
|---|---|---|
| `vis_audiobook` | **1** (every approved member holds it) | ✅ **YES** — the public slice is `{audiobook}` |
| `vis_ebooks` | **0** — *"an approval that does not deliberately widen grants nothing here"* | ❌ never, *"and never can be"* |

⚠️ **Riding `vis_audiobook` would hand the entire 14,805-hour library to every
approved member by default**, because that grant defaults to 1 and exists to
answer *"can you see the catalogue"*. The ebook precedent is directly on point
and was decided by the owner three weeks ago on a smaller corpus: *"I don't
want people scraping my books."* Audio files are the same class of asset,
100× larger, and equally copyable once streamed.

**The design's recommendation** (the owner decides — §12): a **sixth column,
`vis_audio`, `DEFAULT 0`, never in the public slice**, exactly mirroring
`vis_ebooks`, appended last in canonical order, granted by one checkbox on the
existing Audiobooks/Ebooks row. Seeing the shelf stays `vis_audiobook`;
**hearing the book** becomes its own grant, the way *reading* the book did.

And the rule the ebook build had to correct in a comment applies verbatim:
⚠️ **gate on the visibility grant, NEVER on the ladder's `download`** (floor
`admin`). Listening and taking the file away are two capabilities on purpose.

---

## 4. PWA feasibility

### 4.1 🔴 iOS — the section that decides real-world usability

This is where the honest answer is uncomfortable, so it is stated first:
**background audio in an installed, home-screen iOS PWA has not been reliably
working at any point in the seven years of reports found.**

**The evidence, dated and cited:**

| Date | Source | Finding |
|---|---|---|
| 2019-08-19 | PROTOTYP engineering write-up | *"When added to the home screen, audio playback stopped completely when the app was minimised or screen was locked."* Lock-screen controls *"spotty at best… sometimes showing up, sometimes not"*. They shipped a native app instead: *"if it has anything to do with media playback, don't bet on iOS"* |
| 2023-03-20 (upd. 2024) | dbushell, iOS PWA + Media Session | Action handlers **do** appear on the lock screen; custom skip intervals **do** work; artwork was broken until Safari 16.4 and low-resolution until iOS 18 |
| 2023-08-10 | WebKit storage policy | Safari 17 storage rework (§4.2) |
| 2024-08 | Apple Developer Forums #762582 | *"playing audio from the lockscreen works as expected until you leave the audio paused for 30 seconds. After this, the audio will cease to function until you return the PWA to the foreground."* Not reproducible on Android. No Apple response |
| 2025-09 → 2026-01 | MacRumors thread #2466839 | **iOS 26.0 regressed PWA audio further** — works once after install, then breaks, and *"it breaks for other PWAs as well"*. Improved in **26.1** (Nov 2025) and **26.2** (*"much more rare, though still reproducible"*). ⚠️ **Still unresolved as of the most recent post, late January 2026** |
| — | WebKit bug 261858 | Autoplay and media-session controls fail in a standalone web app when playback ends, iOS 16.x–17.x |

**What this means for the design, concretely:**

- ✅ **In a Safari TAB, iPhone audio is fine.** Lock-screen playback and Media
  Session controls work there. The regressions above are specific to
  `display: standalone` home-screen apps.
- ⚠️ **The install prompt must therefore be honest, not enthusiastic.** Do not
  ship an "Add to Home Screen" nudge on iOS that promises background listening.
  If the household installs it and playback dies at a red light, the feature is
  judged broken and no amount of correctness elsewhere recovers that.
- ✅ **Wire Media Session properly anyway** — it is ~30 lines, it is what makes
  the lock screen show the cover, the chapter title and 15-second skip buttons,
  and it works everywhere it is supported (§4.4). It is also what *makes* the
  Safari-tab path pleasant.
- ✅ **Design the resume path so an iOS kill is survivable.** Position is
  flushed on `pagehide`/`visibilitychange` (already the pattern
  `reading-position.js` uses, deliberately not `beforeunload`). If iOS kills
  playback, reopening lands within seconds of where it stopped. **That turns a
  platform bug from data loss into an annoyance**, which is the most this design
  can do about it.
- ⏳ **Re-measure before phase 3.** These reports are a moving target and iOS 26
  is actively churning. A dated re-test on a real iPhone is worth more than
  every citation above.

### 4.2 Storage quotas — better than folklore says, with one Safari trap

**CITED, primary sources (WebKit storage policy 2023-08-10; MDN storage quotas):**

| Browser | Per-origin | Overall | Notes |
|---|---|---|---|
| Chrome/Edge | **60% of disk** | 80% of disk | No group limit |
| Firefox | 10% of disk **or 10 GiB**, whichever smaller (best-effort) | — | Persistent mode: up to 50% of disk |
| **Safari 17+ / iOS 17+** | **60% of total disk space** | **80%** | A **Home Screen web app gets the same quota as the browser** — CITED verbatim |

- ⚠️ **Safari's 7-day eviction is the trap**, not the quota: with cross-site
  tracking prevention on, **script-created data is deleted after 7 days with no
  user interaction**. A book downloaded for a flight, then not opened for a
  fortnight, is gone.
- ✅ **The counter to it is `navigator.storage.persist()`, and installing the
  PWA is how you earn it.** CITED verbatim from WebKit: *"WebKit currently
  grants a request based on heuristics like whether the website is opened as a
  Home Screen Web App."* Persistent-mode data is exempt from best-effort
  eviction. **So on iOS the install is worth doing for storage durability even
  though it is bad for background audio** — an awkward, real tension worth
  naming rather than smoothing over.
- **Always call `navigator.storage.estimate()` before a download** and show
  real numbers ("this book is 412 MB; you have 6.2 GB free"). Never let a
  multi-hundred-MB write fail with a `QuotaExceededError` the person cannot
  interpret.
- ⓘ **The widely-repeated "iOS Cache API is capped at 50 MB" figure could not be
  confirmed against a current primary source** and appears to predate the
  Safari 17 rework. Treat it as **unverified** (§13). It does not affect the
  recommendation, because §4.3 recommends OPFS over Cache Storage anyway.

### 4.3 Where offline bytes should live: **OPFS**, not Cache Storage

For multi-hundred-megabyte media, the Origin Private File System is the right
primitive:

- It is a real file system, so a book can be written **in chunks as it
  downloads** rather than assembled as one enormous `Response` body.
- A `FileSystemFileHandle.getFile()` yields a `File`, and
  `URL.createObjectURL(file)` gives `<audio>` a **same-origin blob URL it can
  range internally** — ✅ **no service worker, no token, no CORS: the auth seam
  disappears for offline books** (§3.4).
- It shares the large IndexedDB-class quota rather than any Cache-API-specific
  ceiling.
- It is private to the origin and invisible to the user's file manager, which
  is the right posture for household media.

Cache Storage remains right for the **app shell** — HTML, JS, CSS, covers — the
ordinary PWA job.

### 4.4 Media Session — the lock-screen and car-stereo integration

**MEASURED 2026-08-17** against MDN's browser-compat-data (fetched from source):

| Feature | Chrome | Chrome Android | Firefox | Safari | Safari iOS |
|---|---|---|---|---|---|
| `MediaSession`, `metadata`, `playbackState`, `setActionHandler` | 73 | **57** | 82 | **15** | mirrors Safari |
| `setPositionState` | 81 | **57** | 82 | **15** | mirrors Safari |

Everything this player needs is supported everywhere that matters. Wire:
`play`, `pause`, `seekbackward`/`seekforward` (with the 15 s default —
`details.seekOffset` honours a custom interval, CITED as working on iOS),
`previoustrack`/`nexttrack` **mapped to previous/next CHAPTER** (which is
exactly what a listener expects from a car stereo's track buttons), `seekto`,
and `setPositionState` every second so the lock-screen scrubber is live.
`MediaMetadata` gets title, author, the cover from the covers bucket, and —
⚠️ **the chapter title as `album` or in the title line**, so the lock screen
answers *"what chapter am I in"* without unlocking. Artwork: supply a **96×96**
variant as well as 512×512 (CITED — older iOS pixellated an upscale; iOS 18
fixed it, but the small variant costs nothing).

⚠️ Every `setActionHandler` call goes in its own `try/catch`: an unsupported
action **throws**, and one throw aborts the rest of the wiring.

### 4.5 Service-worker lifetime during a long listen

A service worker is **not** a background process; it is terminated when idle
and restarted on the next event. During playback the browser issues range
requests in bursts with long gaps, so the worker will be killed and revived
repeatedly across a 13-hour book. Consequences, all designed for in §3.2:
nothing in memory survives (read the token from IndexedDB per request), the
worker must be **stateless per fetch**, and there is no "keep the worker alive"
trick worth attempting. ⚠️ Note the reverse too: **the service worker is not
what keeps audio playing.** The media element and the OS media stack do that.
A dead worker only matters when the *next* range request needs a token.

---

## 5. Offline ebooks for the PWA — ⚠️ AN OWNER DECISION, NO DEFAULT CHOSEN

The owner asked for this in the same breath: *"ebooks need to be able to local
for pwa also."* It is technically easy and **policy-loaded**, so this section
presents options and picks none.

**The technical part is small.** EPUB/PDF files are 1.393 GB for the whole
shelf (167 objects) — three orders of magnitude smaller than the audio problem.
Fetch with a bearer, write to OPFS, hand pdf.js / foliate-js a local
`File`/blob instead of the network transport. `epub-range.js` and the pdf.js
config would each gain one branch.

**The collision, stated plainly.** ⚠️ **An offline copy IS a download.** Once
bytes sit in OPFS they can be extracted with DevTools in about thirty seconds.
The estate's current policy, decided by the owner on **2026-08-17**, is that
**`download` floors at `admin`** — *"For ebooks I don't want a download check
box, I want to use roles we have"* — while **reading** is granted to anyone
with `vis_ebooks`. Shipping offline ebooks to every `vis_ebooks` holder would
**hand the download capability to exactly the people the role floor was written
to exclude**, silently, under a different name. Doing that by accident is
precisely the inversion `ebook-file.ts`'s comment was corrected to prevent.

**The three options, with the honest cost of each:**

| | What it means | Cost |
|---|---|---|
| **1. Offline = admin+ only** | Gate the offline button on `can(role,'download')`. Policy stays exactly consistent | The PWA's offline reading is useless to the household members most likely to want it. It also makes offline a *privilege*, which reads oddly next to "you may read this book" |
| **2. Offline allowed for `vis_ebooks`, as an opaque cache** | Anyone who may read may cache. Mitigations: no export affordance, no filenames, obfuscated OPFS keys, cache cleared on revocation at next launch, and a per-book cap | ⚠️ **These are speed bumps, not a gate.** The doc must say so out loud: this is a decision that *the convenience is worth the copyability*, not a technical containment. It is also arguably the honest position, since anyone who can stream every range can already concatenate them (`ebook-viewer-phase1.md` §3 says exactly this) |
| **3. No offline ebooks** | The PWA works offline for the shell and for audio only | Declines an explicit owner request. But it is the only option with zero policy drift, and it can be revisited any time |

⚠️ **Whatever is chosen applies to AUDIO too, and audio is the bigger asset.**
An offline audiobook is a 400 MB file on a phone. Deciding this for ebooks and
not for audio would leave the estate's most copyable asset governed by an
unstated default. **Decide once, for both.**

---

## 6. Speed to 3× — a solved problem

- **`playbackRate` is unbounded in the spec**; 3.0 is ordinary. Browsers mute
  audio at *extreme* rates — Firefox mutes outside **0.25–4.0** (CITED) — so 3×
  sits comfortably inside every threshold found.
- **Pitch is preserved by default.** `HTMLMediaElement.preservesPitch` defaults
  to **`true`** and is **Baseline Widely available since December 2023**
  (CITED, MDN). Nothing needs setting; the property exists to turn it *off*.
- **Quality at 2.5–3× is a REASONED claim, not a measured one.** Modern
  browsers use time-stretching (WSOLA-class) that holds up well on speech, and
  every native audiobook app offers 3×. ⚠️ But no measurement of *this* library
  at 3× on Safari, Chrome and Firefox was made. It is a five-minute check once
  a single file is streamable, and it should be done before 3× is advertised.
- **Design implications:** offer **0.75 / 1.0 / 1.25 / 1.5 / 1.75 / 2.0 / 2.5 /
  3.0** as taps plus fine adjustment; ⚠️ **remember speed per book, not
  globally** (narrator pace varies enormously); show the rate on the control at
  all times, because a book left at 2× and resumed a week later reads as "the
  narrator sounds wrong"; and ⚠️ `playbackRate` **resets to 1.0 when `src`
  changes**, so re-apply it on every load and after any recovery.

---

## 7. Architecture

### 7.1 The pieces

```
  audiobooks.heygabi.ai/listen?b=<anchor>          the player page
    ├── listen.js              UI: transport, chapter-relative bar, chapter list
    ├── audio-chapters.js      chapters.json → {startSec, endSec, title, index}
    ├── audio-position.js      reuses reading-position.js, kind:'audio'
    ├── media-session.js       lock screen / car stereo wiring
    └── sw.js                  ⚠️ bearer injector + app-shell cache + OPFS
                    │
                    ▼  Range: bytes=… + Authorization: Bearer …
  audiobook-api.heygabi.ai/api/audio/:anchor/file   ← sibling of /api/ebook/…
    ├── resolveAudioAccess()   the gate — vis_audio (§3.5), one function
    ├── range.ts               UNCHANGED, reused verbatim
    └── R2 binding AUDIO → bucket estate-audio  (private, no r2.dev, no domain)
```

### 7.2 The Worker route — a sibling, deliberately not a generalisation

`GET|HEAD /api/audio/:anchor/file` should be written as a **near-copy** of
`ebook-file.ts`, not as a refactor of it into a shared handler. Reasons: the
gate differs (§3.5), the budget differs (§7.5), the content types differ, and
the ebook route is *live, verified and load-bearing*. ⚠️ The estate has already
recorded the cost of sharing a response-writing helper across two routes with
different header contracts — `ebook-viewer-phase1.md` §4: *"when a shared helper
writes a response, the CALLER's header contract is not inherited."* Share
`range.ts` (pure, table-tested, no response contract) and share the *shape*.
Copy the rest.

Everything else carries over verbatim: never buffer, `no-store` + `Vary:
Authorization`, `Accept-Ranges` on every answer including refusals, nine
distinct worded refusals, `Content-Disposition: inline`, `Content-Type:
audio/mp4` (⚠️ **`audio/mp4`, never `audio/x-m4b` and never
`application/octet-stream`** — an m4b is structurally an m4a, AAC in an MPEG-4
container, CITED, and browsers key behaviour off the type).

### 7.3 The manifest and the anchor

A new `audio_files_manifest.json` published to a **private** R2 bucket, exactly
as `ebooks.json` is — anchor → path, size, format, duration. The anchor uses
the **same fold** as `ebook_anchor()` (`"b-" + sha256(relative path)[:12]`), one
implementation, emitted by the pipeline and never recomputed in JavaScript.

⚠️ **`chapters.json` is currently PUBLIC** (MEASURED, §1.2 — tracked in git and
served from the site). It contains 46,659 chapter titles for 1,079 books, which
is a fair description of the library's contents. Given the owner's *"I don't
want people scraping my books"*, whether it stays public is worth a deliberate
answer rather than an inherited one. The player can read it from either place;
moving it behind the gate is one route and one fetch. **This is a question, not
a recommendation** — chapter titles are far less sensitive than files.

### 7.4 The position store — one new `kind`, not a new store

Reuse `reading-position.js` wholesale: same doc id `${uid}_${bookId}`, same
`bookIdFromTitle` key, same two stores, same last-write-wins, same
offer-never-apply resume bar.

```json
{ "uid": "…", "bookId": "conflicted-home", "format": "audio",
  "pos": { "kind": "audio", "value": { "chapter": 7, "offsetSec": 812.4 } },
  "progress": 0.31, "anchor": "b-…",
  "updatedAt": 1755400000000, "device": "iPhone · Safari" }
```

⚠️ **Store `{chapter, offsetSec}`, not a single absolute second**, and the
reason is the same reason `reader-page.md` §7.4 stores a CFI rather than a
fraction: an absolute offset is a position in the *file*, and a re-encode, a
re-rip or a chapter-boundary correction moves it silently. A chapter index plus
an offset within that chapter survives all three, and degrades gracefully — a
lost chapter costs a chapter, never a book. Carry an absolute `seconds` field
alongside for display and as a fallback, and **never navigate by it**.

⚠️ **The rules change (§1.4) must ship BEFORE the first write**, in both lanes,
with the live smoke test extended. A position written against rules that refuse
it fails silently and looks exactly like "the player does not save your spot".

⚠️ **`start_sec` precision (§1.2) must land before this too.** `chapter` +
`offsetSec` is a persisted key derived from the chapter table; storing
positions against 6-second-rounded boundaries and then correcting the
boundaries is a **migration**, not an edit.

### 7.5 The reading budget needs re-sizing — do not inherit it

`read-budget.ts` allows **12 distinct anchors / 600 requests per 5 minutes**,
sized on *"~15 range GETs per open"*. **REASONED:** that sizing is wrong for
audio in both directions. A 13-hour listen is **one anchor** for hours (so the
book axis is generous to the point of irrelevance) while the *request* count
over a long session is unbounded and entirely legitimate — a browser
re-requesting ranges after every seek, every speed change and every network
blip. **A per-request cap here would throttle listening**, which is the exact
failure the ebook budget's axis choice was made to avoid. Re-derive it from a
real session before enabling it, and keep the anchor axis as the scraper
deterrent.

---

## 8. The requirements, mapped to mechanisms

| # | Requirement | Mechanism | Class |
|---|---|---|---|
| 1 | **Position remembering** | `reading-position.js` with `kind:'audio'` (§7.4); write on pause, on chapter change, on `pagehide`/`visibilitychange`, and every ~15 s while playing (throttled) | Reuse + rules change |
| 2 | **Speed to 3×** | `audio.playbackRate`; `preservesPitch` already true; per-book memory; ⚠️ re-apply after every `src` change | Trivial |
| 3 | **PWA** | manifest + service worker (§4); ⚠️ built from nothing (§1.5) | Substantial |
| 4 | **15 s back / forward** | `audio.currentTime ± 15`; also `seekbackward`/`seekforward` on the lock screen with `seekOffset: 15`; ⚠️ make the interval configurable (10/15/30) — it is one number and people are religious about it | Trivial |
| 5 | **Next / previous chapter** | seek to `chapters[i±1].startSec`. ⚠️ **"Previous" should restart the current chapter if more than ~3 s in**, and only step back a chapter if near its start — every audio player does this and its absence feels broken | Trivial |
| 6 | **Chapter list + select** | render the chapters array; current chapter highlighted; per-chapter duration; ⚠️ use `parts` (88 books have them) as collapsible group headers; a 255-chapter book needs the list virtualised or at least scroll-anchored to the current chapter | Small |
| 7 | 🔴 **SCRUB BAR PER CHAPTER** | the bar's domain is `[chapter.startSec, chapter.endSec]`, not `[0, duration]`. Position = `(currentTime − startSec) / (endSec − startSec)`; a drag maps back the same way. Labels read **elapsed-in-chapter / remaining-in-chapter**. A *thin* book-level progress line can sit beneath it for context | Small — and it is the reason no library is used (§2.3) |
| 8 | **Sleep timer** | `setTimeout` → fade out over ~10 s → pause. Presets 5/10/15/30/45/60 min, **plus "end of chapter"** (compute `endSec − currentTime`, adjusted for `playbackRate`) which is the option audiobook listeners actually use. ⚠️ Show the countdown; ⚠️ offer "shake / tap to add 5 minutes"; ⚠️ the timer must survive a chapter change but must be cancelled on manual pause | Small |

**⚠️ Two cross-cutting notes that will otherwise be found the hard way:**

- **Chapter boundaries are computed, not given.** `endSec` for chapter *i* is
  `start[i+1]`; for the last chapter it is the media element's own
  `audio.duration` once `loadedmetadata` fires. Until that event the last
  chapter has no end — so the bar must handle "duration not yet known" rather
  than render `NaN`.
- ⚠️ **Every seek path must go through one function.** `reader-page.md` §7.6
  records exactly this defect in the ebook reader: a second page-turn path that
  bypassed the position keeper stopped saving the spot, silently. Here there are
  *six* seek paths — the bar, ±15 s, chapter next/prev, the chapter list, the
  lock screen's `seekto`, and position restore. One `seekTo(seconds, reason)`,
  and everything calls it.

---

## 9. Future features

### 9.1 The two the owner named

- **Bookmark an audio timestamp.** A new per-person collection
  `audioBookmarks/{uid}_{bookId}_{ms}` — or a `bookmarks` array on the existing
  position doc if the count stays small. Store `{chapter, offsetSec, note,
  createdAt}` using the **same locator shape** as the position (§7.4), so one
  fold governs both. ⚠️ Same rules-change obligation, and ⚠️ **`list` must be
  allowed for one's own bookmarks** — unlike `readingPositions`, where listing
  is refused outright — which means a different rule shape and its own smoke
  test. Nice touch: capture the timestamp **5 seconds before the tap**, because
  people bookmark *after* hearing the thing worth bookmarking.
- **Mark as finished → counts as read in the TBR.** ⚠️ **The join is not
  designed yet and this doc does not design it.** `readingLists` is keyed on
  `bookId` with a `status` string and open rules (shape-only), and `TODO.md`
  already carries an owner ask that *"TBR should span all catalogs, the way
  'read' does"* — whose seam is `workKey` (title|author), a **persisted-key
  decision and therefore migration-grade** (`ebook-split-design.md` §8). Do not
  invent a second key here. **Sequence this behind that decision**, and until
  then offer the button as a plain write of whatever `readingLists` already
  accepts. Auto-suggest at ~95% of the last chapter — **offer, never
  auto-apply**, matching the resume bar's existing manners.

### 9.2 Suggestions — labelled as suggestions, none requested

1. **Media Session lock-screen controls** (§4.4). Not really optional — it is
   what makes the thing usable in a car or a pocket, for ~30 lines.
2. **Per-book speed memory** — store `rate` on the position doc. One field.
3. **Car mode / big-button mode** — a two-control layout (play/pause and ±15 s)
   at thumb size, auto-offered in landscape or on a wide short viewport.
4. **Keyboard shortcuts** — space, ←/→ (15 s), shift+←/→ (chapter), ↑/↓ volume,
   `[`/`]` speed. Free, and the estate's readers are desktop-first.
5. **Sleep-timer smart-resume** — when a book was ended by a sleep timer, offer
   *"rewind 2 minutes?"* on next open. People fall asleep before the timer fires.
6. **Listening stats** — hours listened, books finished, current streak; the
   estate already has a `stats.html` and a `leaderboard` collection to hang it
   on. ⚠️ Per-person listening data is more sensitive than a review; keep it in
   the owner-only collection class, not the shape-only one.
7. **"Continue listening" shelf** on the catalogue index, driven by the position
   store — the single highest-value UI addition and nearly free once §7.4 exists.
8. **Chapter-aware skip-silence / volume normalisation** — ⚠️ **do not build**.
   Both need Web Audio processing of the decoded stream, which forfeits the
   native decoding this design rests on. Named here only so a future session
   knows it was considered and why it was declined.
9. **Playback-position handoff between formats** — the estate has books in both
   audio and ebook. *"You're 31% through listening; open the ebook there?"* is
   genuinely delightful and genuinely hard (an audio offset does not map to a
   CFI). Park it; note it as the reason `bookId` unifies both.
10. **A download-for-offline queue with real numbers** — sizes, progress, free
    space, and a per-book "remove". Gated by whatever §5 decides.

---

## 10. Phased build plan

Effort classes: **S** ≈ a focused session · **M** ≈ a full build agent ·
**L** ≈ multi-layer, split it (per the global sizing rule, a multi-layer build
is the 279k–474k class and wants a clean tree before dispatch).

| Phase | What | Effort | Gate to start |
|---|---|---|---|
| **0a** | **Chapter precision.** Add `start_sec` (full float) to `extract_chapters.py`; re-run on the library machine (cached, incremental); publish. **Nothing downstream can be right without this** | **S** | none — do it first |
| **0b** | **Ingest.** `estate-audio` R2 bucket (private, **no r2.dev URL, no custom domain — verify with `wrangler r2 bucket dev-url get`**); `build_audio_manifest.py`; `upload_audio_r2.py` reusing the boto3 multipart path as **primary** (§1.3). ⚠️ Owner step: R2 API token. ⚠️ 213–853 GB over a household uplink is measured in **days**, not minutes | **M** + owner time | §12 decisions on cost and grant |
| **1** | **The gated stream.** `/api/audio/:anchor/file`, sibling of `ebook-file.ts`; reuse `range.ts`; `vis_audio` gate; nine worded refusals; re-sized budget. Prove it with `curl` on the unauthenticated half, exactly as phase 1a was | **M** | 0b |
| **2** | **The player, online only, desktop first.** `/listen`, all seven must-haves, chapter-relative bar, Media Session. ⚠️ **Auth seam decided and exercised here** (§3) — a minimal service worker that does nothing but inject the bearer, no offline yet | **M** | 1 |
| **3** | **Position + resume.** Rules change (both lanes) + live smoke test **first**; then `kind:'audio'`, the resume offer bar, per-book speed | **S–M** | 2 |
| **4** | **PWA.** Manifest, app-shell cache, install flow, `storage.persist()`, offline downloads to OPFS for **audio** (and ebooks iff §5 says so). ⚠️ **Test on a real iPhone before announcing anything** | **L — split** | §5 decided |
| **5** | **Futures.** Bookmarks; mark-finished (behind the `workKey` decision); continue-listening shelf; stats | **M** | 3, and the TBR key decision |

**Sequencing rule this plan is built on:** ⚠️ **every persisted-key decision
lands before anything writes against it** — `start_sec` before positions,
positions before bookmarks, the TBR `workKey` before mark-as-finished. The
estate has already paid for the general version of this lesson twice (the CFI
renderer, the anchor-as-key near-miss).

---

## 11. Limitations & risks

| Risk | Severity | Honest statement |
|---|---|---|
| 🔴 **iOS PWA background audio** | **High** | Broken or flaky continuously 2019 → Jan 2026 (§4.1). Safari-tab playback is fine. Mitigation is honest messaging plus a resume path that makes a kill an annoyance, not data loss. **This is not fixable from our side** |
| 🔴 **The auth seam's silent failure** | **High** | No controlling service worker ⇒ 401 ⇒ a play button that does nothing, with no status the page can read. §3.2 item 5 is mandatory, not advisory |
| ⚠️ **Chapter timestamps are 6 s coarse** | **Medium → zero** | MEASURED (§1.2). Fully fixed by phase 0a. Becomes **High** if any position is stored before that |
| ⚠️ **Ingest volume** | Medium | 213–853 GB and $3.20–$12.80/mo. Days of upload; 128–978 books need multipart |
| ⚠️ **`range.ts` "malformed → 200"** | Medium | Correct HTTP, and here it means a client off-by-one is a **2.45 GB** download. `epub-range.js` already models the guard: no code path that fetches without a `Range`, and a 200 is a named failure whose body is **cancelled, not read** |
| ⚠️ **Storage eviction** | Medium | Safari's 7-day no-interaction rule deletes best-effort data. `persist()` is granted by heuristics that favour installed apps — the same install that is bad for background audio |
| ⚠️ **Licensing** | Medium | Audiobookshelf is **GPL-3.0** and this repo is **public**. Read it; copy nothing. Every recommended dependency is MIT/Apache-2.0 — and the recommendation is zero dependencies |
| ⚠️ **Player-library churn** | Low | Plyr/Vidstack/Media Chrome → Video.js v10, GA targeted mid-2026 and not on `latest` at time of writing. The zero-dependency recommendation sidesteps it entirely |
| ⚠️ **`moov` atom position** | Low–Medium, **unverified** | If a file's `moov` sits at the end, the browser must range the tail before it can play or seek. The endpoint supports it; whether the library's files are `faststart` was **not** measured. Cheap to check with `ffprobe`; cheap to fix with `ffmpeg -movflags +faststart` — but that is a rewrite of every affected file |
| ⚠️ **Read ≠ protection** | — | Unchanged and worth restating: anyone who can stream every range can concatenate them. Gating is a product distinction, never DRM |

---

## 12. Decisions this doc surfaces for the owner

Presented as a queue — per the standing rule these go **one at a time**, in
this order, with an answer before the next is shown.

1. ✅ **DECIDED 2026-08-17 — audio bytes ride `vis_ebooks`.** The owner's
   words: *"MIRROR EBOOK if they can read an ebook they can listen to an
   audio."* Not option (a) and not option (b): **one grant means "may consume
   the estate's book files," reading or listening** — no sixth column, no new
   admin button, and the grant stays out of the public slice with DEFAULT 0.
   Everywhere this doc says `vis_audio` (§3.5, §7, §9 phase 1,
   `resolveAudioAccess()`), read `vis_ebooks`. Seeing the audiobook *site*
   remains `vis_audiobook`, unchanged — the gate is on the BYTES.
2. **Offline copies — the download-policy collision.** Options 1 / 2 / 3 in §5,
   **no default chosen**, and ⚠️ the answer applies to **audio as well as
   ebooks**.
3. **The storage bill.** 213–853 GB in R2 at $3.20–$12.80/month, forever.
   Acceptable? (An answer of "start with the ~200 most-listened books" is a
   legitimate third option and cuts it to a few dollars.)
4. **Does `chapters.json` stay public?** 46,659 chapter titles for 1,079 books
   are on the public site today (§7.3). Fine, or move it behind the gate?
5. **Signed URLs — ever?** §3.4 recommends never, quoting `ebook-file.ts`'s own
   law. If the service-worker seam proves untenable on iOS, the fallback in this
   design is a **cookie**, not a signed URL — confirm that is the right ordering.
6. **How far to go for iOS?** Given §4.1, is a "works properly in Safari, not
   as an installed app on iPhone" answer acceptable, or does that change the
   priority of the whole feature?

---

## 13. What was NOT verified

- 🔴 **THE LIBRARY'S ACTUAL AUDIO BITRATE WAS NEVER MEASURED**, so every size
  and cost figure in §1.3 is arithmetic over a range, not a measurement. The
  spread is **4×** (213 GB vs 853 GB) and it decides both the bill and how many
  books need multipart upload. ⚠️ It was deliberately not measured: reading
  1,079 files would risk re-hydrating OneDrive placeholders, which
  `extract_chapters.py` explicitly guards against. **`ffprobe` on a sample of
  ~20 files answers it in a minute** and is the single highest-value
  measurement outstanding.
- 🔴 **Nothing in this document has been exercised.** No audio file has been
  streamed through any Worker, no service worker has injected any header, no
  `<audio>` element has played anything from this estate. This is a paper study.
- 🔴 **No iOS device was tested.** Every iOS claim in §4.1 is a citation of
  someone else's dated report, and the most recent is from **late January 2026**
  — nearly seven months old at time of writing. iOS 26 is actively churning in
  this exact area. **Re-measure on a real iPhone before phase 4.**
- **Whether `<audio>` plays a `.m4b` URL at all in each browser was not
  tested.** REASONED: an m4b is AAC-in-MP4 (CITED) served as `audio/mp4`, which
  is universally supported; Firefox relies on the OS decoder (CITED). Untested.
- **The `moov` atom's position in the library's files** (§11).
- **`playbackRate` at 3× was not listened to** on any browser (§6).
- **The service-worker + media-element + `Authorization` path has not been run
  anywhere**, on any browser. Its 2019 WebKit fix is cited; the *combination*
  with a bearer, cross-origin, on a 206, on Safari, is untested by anyone here.
- **The "iOS Cache API is capped at 50 MB" figure could not be confirmed**
  against a current primary source and appears to predate Safari 17 (§4.2).
- **Video.js v10's licence was not confirmed.** v8 is Apache-2.0 (MEASURED via
  npm); v10 is a rewrite and its licence was not read.
- **Plyr's deprecation is CITED from the Vidstack announcement, not from Plyr
  itself** — its GitHub page carries no archive notice and npm carries no
  deprecation flag (MEASURED 2026-08-17).
- **R2 costs were computed against published list prices**, not against a bill.
- **No claude.ai usage reading was taken** during this work.
- **`docs/TODO.md` was not touched** — another agent holds uncommitted work in
  this tree. The audio-player item is already logged there (added in `244915e`).

---

## Related

- `docs/info/ebook-viewer-phase1.md` — **the endpoint this design is a sibling
  of**: the shipped contract, statuses, headers, the range table, CORS, the
  budget, and the capability rule. Read §2, §3 and §4 before writing the audio
  route.
- `apps/audiobook-worker/src/ebook-file.ts` — the three laws, verbatim, and the
  one this design has to ask the owner about (§3.4).
- `apps/audiobook-worker/src/range.ts` — reused unchanged.
- `docs/info/estate-auth-design.md` §4.5 + its 2026-08-17 amendment — the
  visibility layer and the `vis_ebooks` precedent §3.5 argues from.
- `docs/access/ebooks-gate.md` — how a grant is actually toggled, UI-first.
- `docs/info/role-capability-map.md` — the normative `download` floor.
- `docs/info/ebook-split-design.md` §8 — the TBR `workKey` seam that
  mark-as-finished must wait for.
- `bookbuddy/audiobook_catalog/app/tools/extract_chapters.py` — the chapter
  pipeline, and the `round(…, 1)` on line 78 that phase 0a must change.
- `bookbuddy/audiobook_catalog/docs/info/reader-page.md` §7 — the position
  store's as-built record (LOCAL ONLY: that repo's `docs/` is gitignored).
- `bookbuddy/audiobook_catalog/site/reading-position.js` — read its header
  before touching §7.4.
- `bookbuddy/audiobook_catalog/scripts/upload_ebooks_r2.py` — the 300 MiB wall
  and the boto3 multipart path phase 0b promotes to primary.

## Sources

Fetched or measured **2026-08-17** unless the source's own date is given.

**Players & licences** — npm registry metadata for
[video.js](https://registry.npmjs.org/video.js/latest),
[vidstack](https://registry.npmjs.org/vidstack/latest),
[plyr](https://registry.npmjs.org/plyr/latest),
[mediaelement](https://registry.npmjs.org/mediaelement/latest),
[howler](https://registry.npmjs.org/howler/latest),
[shaka-player](https://registry.npmjs.org/shaka-player/latest) ·
[Vidstack/Media Chrome/Plyr → Video.js v10 announcement, 2026-01-21](https://github.com/vidstack/player/discussions/1747) ·
[Video.js v10 Beta: Hello, World (again), 2026-03-10](https://videojs.org/blog/videojs-v10-beta-hello-world-again) ·
[howler.js README](https://github.com/goldfire/howler.js) ·
[Audiobookshelf LICENSE — GPL-3.0](https://github.com/advplyr/audiobookshelf/blob/master/LICENSE) ·
[audiobookshelf-app issue #239 — chapter-based progress bar](https://github.com/advplyr/audiobookshelf-app/issues/239)

**Service workers, range requests & media** —
[Handle range requests in a service worker (web.dev)](https://web.dev/articles/sw-range-requests) ·
[WebKit bug 184447 — mp4 video element broken with service worker, RESOLVED FIXED 2019-11-05](https://bugs.webkit.org/show_bug.cgi?id=184447) ·
[Service workers: beware Safari's range request, 2018-10-23](https://philna.sh/blog/2018/10/23/service-workers-beware-safaris-range-request/) ·
[Adactio: Service workers and videos in Safari, 2018-10-26](https://adactio.com/journal/14452) ·
[Service workers are underrated (Mux), 2023-08-21](https://www.mux.com/blog/service-workers-are-underrated) ·
[Token-based auth for media files with service workers](https://medium.com/@alekswebnet/setup-token-based-authentication-for-media-files-with-service-workers-and-workbox-e8674fa621f)

**iOS / PWA reality** —
[Apple Developer Forums #762582 — iOS Audio Lockscreen Problem in PWA, 2024-08](https://developer.apple.com/forums/thread/762582) ·
[MacRumors #2466839 — iOS 26 audio issues in PWA web apps, Sept 2025 → Jan 2026](https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/) ·
[dbushell — iOS Web Apps and Media Session API, 2023-03-20](https://dbushell.com/2023/03/20/ios-pwa-media-session-api/) ·
[PROTOTYP — What we learned about PWAs and audio playback, 2019-08-19](https://dev.to/prototyp/what-we-learned-about-pwas-and-audio-playback-50eh) ·
[WebKit bug 261858 — media session in standalone web app](https://bugs.webkit.org/show_bug.cgi?id=261858) ·
[WebKit Features in Safari 17.1 — ManagedMediaSource on iPhone](https://webkit.org/blog/14735/webkit-features-in-safari-17-1/)

**Storage** —
[WebKit — Updates to Storage Policy, 2023-08-10](https://webkit.org/blog/14403/updates-to-storage-policy/) ·
[MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

**Media APIs** —
[MDN browser-compat-data `api/MediaSession.json`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/MediaSession.json) and
[`api/WakeLock.json`](https://raw.githubusercontent.com/mdn/browser-compat-data/main/api/WakeLock.json) (parsed directly) ·
[MDN — MediaSession](https://developer.mozilla.org/en-US/docs/Web/API/MediaSession) ·
[MDN — HTMLMediaElement.preservesPitch](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preservesPitch) ·
[MDN — HTMLMediaElement.playbackRate](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/playbackRate) ·
[Bugzilla 1630569 — Firefox mutes outside 0.25–4.0](https://bugzilla.mozilla.org/show_bug.cgi?id=1630569) ·
[MDN — ManagedMediaSource](https://developer.mozilla.org/en-US/docs/Web/API/ManagedMediaSource/streaming)

**Platform & cost** —
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) ·
[Cloudflare Workers — streams runtime API](https://developers.cloudflare.com/workers/runtime-apis/streams/) ·
[Cloudflare changelog — subrequest limits, 2026-02-11](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/)
