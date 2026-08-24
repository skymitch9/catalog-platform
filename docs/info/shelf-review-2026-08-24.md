# Shelf (Audiobookshelf) review — 7 owner questions answered

> **Audience:** the owner (Skylar) and future Claude sessions. **Status:** TRACKED
> (this repo is public — no household names, no secret values, ABS item ids only
> referenced, never pasted).
> **Last verified: 2026-08-24** — this is a *documentation* review. Every claim
> below is sourced to a doc file:line or an earlier measurement recorded in one.
> ⚠️ **Nothing here was measured live against ABS this session.** No ABS admin
> UI login, no shell on Justin's box, no ABS API call was made. Where an answer
> needs one of those, it says so plainly rather than guessing. The numbers I cite
> (409 items, 1,206 items, 125 ebook-only, 0 series, 0 collections) are other
> sessions' datestamped measurements, re-quoted with their dates — treat any of
> them as re-checkable, not fresh.

Primary sources (all read this session):
- `bookbuddy/audiobook_catalog/docs/access/SHELF_SERVER.md` — operate/troubleshoot
- `bookbuddy/audiobook_catalog/docs/access/SHELF_JUSTIN.md` — Justin's steps
- `bookbuddy/audiobook_catalog/docs/info/shelf-parity-design.md`
- `bookbuddy/audiobook_catalog/docs/info/author-folder-audit.md`
- `bookbuddy/audiobook_catalog/docs/TODO.md` (shelf-link, ebooks-dropdown, reader-port, newest-authors items)
- `bookbuddy/audiobook_catalog/docs/KNOWN_ISSUES.md`
- `catalog-platform/docs/info/ebook-viewer-phase1.md`
- `catalog-platform/docs/access/ebooks-gate.md`
- `catalog-platform/docs/info/audio-player-design.md`

---

## Q1 — The author-folder book-cover thing discussed with Kiro

**What it is.** Two distinct but related "author-folder + cover" threads exist. The
one that is *live and unfinished* is the **"Newest authors: show a real book cover,
series-first"** item — `audiobook_catalog/docs/TODO.md:324-372`. On the ABS shelf,
**~490 authors sit behind placeholder art** (`TODO.md:251`, `:345`), and the owner
asked (verbatim, `:326`): *"for the newest author area lets make the author be a
random book from their collection, make sure its the first book in a series, if we
dont have the first book have it be the lo[w]est series book."*

The **decided rule** (`TODO.md:330-340`): pick a random book from the author's
collection → prefer the one that is **#1 in its series** → else the **lowest series
number held** → and (the gap the item flags) a standalone-only author needs an
explicit "random-among-standalones" fallback that was never stated in the ask.

**On the "discussed with Kiro" framing.** The estate's Kiro hand-off queue ("KIRO —
COMPLETE THIS WORK") is documented as living in `catalog-platform/docs/TODO.md`
(`library_catalog/docs/TODO.md:27-28`, `audiobook_catalog/docs/TODO.md:39-43`), but
that catalog TODO file is now only 8 lines (the queue was swept — see
`catalog-platform/docs/DONE.md:115` "The Kiro queue K1–K17 — swept out of the work
log 2026-08-23"). ⚠️ **I could not find a preserved verbatim Kiro discussion of the
author-cover item** in any of the four docs trees; the Kiro K-items that survive
in `audiobook_catalog/KNOWN_ISSUES.md` are K5 (lint `scripts/`) and K6
(`PYTHONIOENCODING`), not covers. So "the thing discussed with Kiro" is almost
certainly this newest-authors item, but the Kiro conversation itself was not
retained in the docs — that part is **not in the docs / needs the owner's memory
or a Kiro transcript to confirm**.

**The distinct, already-resolved thread** (so it is not re-opened): the
**author-folder MOVE audit** (`info/author-folder-audit.md`). That was about author
*aliases* re-shelving files (`William D. Arand → Randi Darren` collapsing two
bibliographies) and its only cover impact was stale `cover_href` paths after folder
renames (`§4`, `SITE_DATA.md:81`). It was **fixed 2026-08-09** (§7, the
`author_shelf_aliases.json` split). That is a separate matter from author *card art*
on ABS.

**What's left (Q1).** The newest-authors item is **not started** (`TODO.md:355-372`).
Before building: (a) confirm the surface is the ABS home "Newest Authors" shelf —
the item already grepped every self-built site and found no such section, so it is
ABS's own UI (`:342-349`); (b) the mechanism is **not a UI change** but **setting each
author's image via the ABS API** — `PATCH /api/authors/:id`, whose accepted body
(URL vs upload-only) **must be read, not guessed** (`:356-358`); (c) series numbers
come from `site/catalog.csv` (ABS reports 0 series, `:365-368`), so the picker runs
pipeline-side and only the image write touches ABS; (d) the choice is a **persisted
key** → make it **seeded-per-author and stable**, not re-rolled nightly (`:359-364`).

**Recommendation.** Sound and worth doing, but it needs **ABS admin/API access to
verify the author-image write path first**. Build the picker pipeline-side against
the catalogue; write images through the ABS API with a stable per-author seed. Ask
the owner the one open question (which surface) and settle the standalone-author
fallback before coding.

---

## Q2 — The 2 persistent shelf issues

⚠️ **The docs never literally enumerate "the 2 persistent issues"** — I'm inferring
the two standing problems from the `SHELF_SERVER.md` status board and the TODO. If
the owner had a different pair in mind, this is the place he should correct me.

**Issue 1 — Flat folder shape → the hardlink shadow tree, and new books going
invisible.** This is *the* recurring shelf defect and it has two faces:
- **Root cause** (`SHELF_SERVER.md:91`, `SHELF_JUSTIN.md:620-654`): the library is
  flat — `<Author>/<Title>.m4b`, every file at depth 1. ABS treats each *author*
  folder as ONE item and every file as a *track*, so 460 authors collapsed to
  **409 "books"** (e.g. "Brandon Sanderson" = one 40-track, 748-hr, 32 GB item).
  There is **no ABS setting** for a flat layout (`SHELF_JUSTIN.md:637`).
- **The fix and why it keeps biting** (`SHELF_SERVER.md:66-78`, `:254-277`): a
  second **hardlink shadow tree** at `/media/napling/abs`, one folder per book,
  built by `02-abs-hardlinks.sh`, is what ABS actually mounts. It ran **once** on
  2026-08-20 and **was never wired to run again**, so every book added after that
  date has no folder and is invisible to ABS. Measured 2026-08-22: four **Mashton XX**
  audiobooks present on Drive, disk and mirror but **absent from ABS** (`/audiobooks`
  = 408 author folders, no Mashton). **Nothing is lost** — only a folder is missing.
- **Status:** 🟠 **OPEN.** The durable fix is a cron/flock timer (`SHELF_JUSTIN.md
  §4B`, `:855-866`) or chaining the script to whatever triggers Justin's
  `rclone-sync` **container**. The wiring was left undone because rclone runs as a
  container, not a crontab, so there was no line to extend (`SHELF_SERVER.md:78`).
  ⚠️ Do **not** "fix" it by deleting/re-uploading/re-syncing — a per-item rescan on a
  missing folder made it *worse* (stripped tracks, 0-byte husks — `SHELF_SERVER.md:272-276`).

**Issue 2 — Operability: no standing access to the box + the unsettled
`/audiobookshelf/` base path.** These are the two things that make every shelf
problem slow and every link fragile:
- **No standing access** (`SHELF_JUSTIN.md §4C`, `:869-905`): the Mashton
  investigation "took four days and a dozen messages... **only because nobody
  outside your house can see that disk.** Every theory died on not being able to run
  one `ls`." The fix is Option E (Tailscale + a limited read-only SSH user), which is
  also the Phase-2 prerequisite. **Status: BLOCKED on Justin.**
- **Base path** (`SHELF_SERVER.md:302`, `:96`, `:104-106`): ABS is served under
  `ROUTER_BASE_PATH=/audiobookshelf`, not root. This is not a fault but it is
  **unsettled**, and it changes the phone-app server URL
  (`https://shelf.heygabi.ai/audiobookshelf`) and every per-book link
  (`…/audiobookshelf/item/<id>`). The doc says settle it **before** anyone saves a
  server URL or shares a per-book link. **Status: owner decision, still open.**

**Recommendation.** Issue 1 is the one that actually breaks the shelf for real
people — land the cron/flock timer (or container chain) this week; it is the single
highest-leverage shelf fix and needs only Justin running one line. Issue 2's two
halves are decisions, not builds: get Option E done so #1 never takes four days
again, and settle the base path (preferred: Justin removes `ROUTER_BASE_PATH` so
links are literal) before the shelf-link/reader-port work hard-codes a URL shape.

---

## Q3 — Opus's "complex path involving the server owner"

⚠️ **No document contains that literal phrase** — it is the owner's paraphrase, so I
identify the best-fit proposals and assess them. Two candidates match "a complex
path that routes through the server owner (Justin)":

**Candidate A (best fit) — the parity meter, which by design can only run on
Justin's box.** `info/shelf-parity-design.md §3` argues that *only* Justin's box
sees Drive and the disk at once, so "the box computes, the box reports, the estate
renders" — a bearer-token script (`03-shelf-parity.sh`) + cron on his machine
(`§4`, `SHELF_JUSTIN.md §3`). Crucially, **§8 explicitly rejected the simpler
alternative**: driving ABS's own API through the tunnel with a Cloudflare Access
**service token** (`shelf-parity-design.md:834-840`) — "needs nothing from Justin,
which is genuinely attractive... Rejected because it measures the wrong thing (§2)
*and* because it requires adding a Service Auth policy to the Shelf Access app —
widening the gate that §2 of the runbook calls load-bearing, in order to obtain a
worse number."

**Candidate B — the standing-access / Phase-2 push path.** Option E (Tailscale +
SSH) and Phase 2 direct push (`SHELF_SERVER.md §7`) both route real, one-time setup
work through Justin. `§7` notes "**The one-time setup CANNOT avoid Justin**" (rows 3
and 4 are on his machine) — that is the irreducible "involves the server owner"
part.

**Assessment.** The pattern behind both is the same tension, and it is genuinely
argued in the docs, not lazy: **rich shelf features (parity, author images,
collections, second libraries) can be driven either (a) by Justin doing box-side
work — the "complex path" — or (b) by hitting the ABS API remotely, which needs a
Cloudflare Access service token and thereby widens the load-bearing family gate.**
The docs consciously chose (a) for parity to avoid widening the gate for a worse
measurement — **that reasoning is sound for parity specifically** (per-file
`rclone check` genuinely cannot be computed anywhere but the box, `§2`/`§3`).

**Is there a simpler way?** For **parity**, no — the topology forces it, and the
"simpler" ABS-API path measures the wrong thing. For the **other** shelf features
(author images, collections, series, a second ebook library), the trade is more
open: an ABS-API-with-service-token path would be dramatically simpler than getting
Justin to build and cron more shadow trees, and the cost is one narrowly-scoped
Access Service Auth policy. **Recommendation:** keep the box-side path for parity;
for the ABS-write features, **seriously reconsider the service-token path the
parity design rejected** — the rejection was scoped to parity ("a worse number"),
and it does not automatically carry to write operations where the ABS API is the
*only* way to do the job. Either way, get **Option E standing access** done first:
it makes the "complex path" cheap (one `ls` instead of four days) and is the
honest unblocker for everything else. This one genuinely needs the owner to decide
the gate-widening question — it is an access-increasing change, so confirm, don't
infer.

---

## Q4 — Shelf series and collections are EMPTY: on purpose or a fault?

**Finding: it is a consequence of how items are added, not a deliberate "we don't
want series." It is fixable, and populating it is real work — mostly on the box /
ABS side.** Measured 2026-08-21 (`TODO.md:249-251`, `:365-368`): the ABS library has
**0 series and 0 collections defined**, "so those nav entries lead nowhere."

**Why empty:**
- **No metadata agent / no series metadata reaches ABS.** ABS derives series from
  per-book metadata (embedded tags or `metadata.json`/`.abs` files, or a metadata
  provider). The library is seeded by a flat `rclone` mirror of Drive `.m4b` files
  through a hardlink tree; nothing writes ABS series metadata, so ABS has none to
  group by. The docs state series numbers live in `site/catalog.csv` / the series
  canon, **not** in ABS (`TODO.md:365-368`).
- **Collections are manual in ABS** (user- or API-created groupings). Nobody and no
  script creates them, so there are none.

**How to populate them:**
- **Series:** either (a) write series name + sequence into each book's ABS metadata
  (embed in the m4b tags upstream, or push via `PATCH` on the ABS item), sourced
  from `site/catalog.csv`'s series canon; then ABS auto-builds the Series view. Or
  (b) build ABS **collections** per series via the ABS API. Both need the
  `catalog row → ABS item` join (Q6), which **does not exist yet** and whose ABS
  ids are **not stable across a rebuild** (`TODO.md:189-198`, `:297`).
- **Collections:** create via ABS API from the same catalogue groupings (universes,
  series, "recently added").

⚠️ **Cannot be fully determined without ABS admin access:** whether a metadata
provider is configured, whether any `metadata.json` sidecars exist in the shadow
tree, and exactly what `PATCH /api/items/:id` / the collections API accept. The
docs do not record an ABS metadata-agent configuration either way.

**Recommendation.** Not a fault to alarm over — it is unbuilt. Lowest-risk path:
build the durable `catalog row → ABS item` join first (author+title or ASIN, since
ids rot), then push series metadata from the catalogue via the ABS API and/or
create per-series collections. This shares the join with Q6/Q1 — **build it once**
(`TODO.md:210-212`). Needs ABS admin/API access to verify the write endpoints.

---

## Q5 — Everything is under the AUDIO filter, including ebooks + the ereader

**Finding: structural, and expected given how ABS is configured — not a bug in our
pipeline.** Measured 2026-08-21 (`TODO.md:217-252`): the server has **exactly one
ABS library**, named **"Audio"**, `mediaType: book`, folder `/audiobooks`. The
"dropdown for audio" the owner sees is ABS's **library switcher** — with one
library it has one entry. Meanwhile **125 of 1,206 items carry ebook files and zero
audio tracks**, and more ebooks ride *inside* audiobook items (the Sanderson item
had 27 ebook files). So the ebooks are genuinely on the box with **no front door**.

**Why:** every item — audio and ebook alike — is hardlinked into the single
`/audiobooks` tree ABS mounts, so ABS files them all under the one "Audio" library.
Nothing separates ebooks into their own library or tree.

**How to separate ebooks/ereader from audio** (`TODO.md:230-246`, owner's call, none
started):
| Option | Cost | Effect |
|---|---|---|
| **A. Second ABS library on an ebooks-only shadow tree** | a second `02-abs-hardlinks.sh`-style tree + one new ABS library | Gives the dropdown a real second entry — **matches the ask** |
| **B. One library, lean on ABS filters** | nothing to build | A filter nobody discovers; doesn't answer "why is there no ebooks option" |
| **C. Rename the library** ("Audio" → "Library") | trivial | Honest labelling only; no separate place for ebooks |

⚠️ **The gate is the real decision, not the dropdown** (`TODO.md:239-246`,
`:303-311`): ebook access today is gated by the estate's own `vis_ebooks` /
`download_ebooks` grants (owner, 2026-08-17: *"I don't want people scraping my
books"* — `ebooks-gate.md`). The **shelf** is gated by **Cloudflare Access with a
family allowlist** — a *different* gate, different membership, no concept of
`download_ebooks`. Giving ebooks their own shelf library moves ebook access from the
estate gate to the CF-Access gate **for everyone who can reach the shelf**. This
must be settled deliberately, together with Q6 (reader port), **once**
(`TODO.md:246`).

**Recommendation.** Option A is the one that matches the words in the ask, and it
fits the existing shadow-tree pattern on the box — but do **not** ship it as a
side effect: decide the ebook-gate question first (Q6), because A silently
re-homes ebook access. Needs ABS admin to create the second library and box work
(Justin) to build the ebooks-only tree.

---

## Q6 — Reading ebooks ON the shelf + a direct link to the opened book

**Two separate realities here — the estate's own viewer vs ABS's native reader.**

**What the estate has (its own, gated, deep-linkable):** a fully built in-browser
ebook viewer that does **not** use ABS at all — `ebook-viewer-phase1.md`:
- **Byte route:** `GET|HEAD https://audiobook-api.heygabi.ai/api/ebook/:anchor/file`
  (`apps/audiobook-worker`), R2 bucket `estate-ebooks`, honours `Range`/206 for
  **both** PDF and EPUB (`§1`, `§2`).
- **Readers:** PDF via vendored **pdf.js 5.4.149** (`/read?b=<anchor>`); EPUB via
  vendored **foliate-js** (range-streaming — the 393 MiB omnibus opens in 18
  requests / 664 KB / 16.6 MB heap, `§9.1`).
- **Gate:** the estate's **`vis_ebooks`** read grant — deliberately **NOT** the
  ladder's `download` capability (`§3`; a stale comment that said otherwise was a
  documented defect).
- **Deep link into an opened book: YES, and it already works** — the reader URL is
  `ebooks.heygabi.ai/read?b=<anchor>` (prod) / `audiobooks.heygabi.ai/dev/read?b=<anchor>`
  (dev). `<anchor>` is a durable, catalogue-joinable key.

**What ABS offers natively:** ABS v2.36.0 ships an EPUB **and** PDF reader
(`TODO.md:276`). The owner's ask (`TODO.md:257-320`, verbatim `:259`) is to **port
our readers to the shelf** — hand off from `ebooks.heygabi.ai` to ABS's built-in
reader, in a new tab, "so they dont realize theyre away from the library."

**Is a deep link into an *opened book on ABS* possible?** Partially, and the docs
are blunt about the limits:
- ABS item pages have the shape `…/audiobookshelf/item/<uuid>` and a *Read* button,
  but ⚠️ **ABS item ids are NOT stable** — every id from the 2026-08-20 flat layout
  **404s** after the hardlink reshape (`TODO.md:189-192`, `:297`). A stored
  `item/<uuid>` map **rots on the next rebuild** → a dead link, which is worse than
  none. The doc's recommended mitigation is to **link to an ABS search instead of an
  item id** (a search link can't 404) or regenerate the map every pipeline run with a
  visible build stamp (`:194-198`).
- ⚠️ The **exact reader-URL shape must be verified in a working ABS UI**, not guessed
  (`TODO.md:292-294`) — needs ABS admin access.
- ⚠️ **Everyone who clicks meets Cloudflare Access** (`TODO.md:199-204`, `:312-316`):
  a new tab hides the library page behind it, but the URL bar reads
  `shelf.heygabi.ai` and anyone not on the family allowlist meets a Google sign-in
  first. "Seamless" holds only for people already inside the gate.
- ⚠️ Same **gate decision** as Q5 (`:303-311`).

**Recommendation.** The estate's **own** viewer already gives gated, stable deep
links into an opened book (`/read?b=<anchor>`) and is the safer default. Porting to
ABS's reader is a legitimate "first real load on the shelf" test, but only after:
(1) verifying ABS's reader URL in a real UI, (2) building the **durable** join
(author+title/ASIN, not the volatile uuid) and linking to **search, not item id**,
and (3) settling the ebook gate. Do **not** retire the local readers until the ABS
path is measured working (`TODO.md:317-319`) — their production-only failure modes
(`info/reader-page.md`) are the expensive part. Needs ABS admin to verify URLs.

---

## Q7 — Embedded shelf PLAYER on audiobooks.heygabi.ai vs flipping out to ABS

**The estate's actual direction is its OWN player over its OWN byte stream — not
embedding ABS's player.** `catalog-platform/docs/info/audio-player-design.md`:
- **Verdict:** "Feasible, and cheaper than the ebook viewer was" (`§0`). The design
  is a **thin custom UI over a bare `<audio>` element + Media Session API — no player
  library** — over an **audio sibling of the ebook byte route**.
- **Already built + deployed (2026-08-18):** the gated stream
  `/api/audio/:anchor/file` and `/api/audio/status` (`§10`, line 866) — but ⚠️ **no
  player UI yet**, and **no audiobook byte has ever reached a browser** (`§13`).
- **The one genuine unknown = the auth seam** (`§0`, `§3`): `<audio src>` issues its
  own range requests and **cannot carry an `Authorization` header**, so a service
  worker must inject the bearer — solvable but never exercised on this estate, and
  one of its three solutions contradicts a rule `ebook-file.ts` states in capitals.
- **Cost:** the audio library is ~14,805 hours → **213–853 GB in R2 = $3.20–$12.80/mo**
  (`§0`), 150–600× the ebook shelf.

**What ABS exposes (and the honest limits for embedding *its* player):**
- ABS has a REST API with stream/playback endpoints and its own web player, but the
  docs here do **not** record ABS's stream-URL shapes, HLS/direct-play behaviour, or
  any embeddable-player widget — ⚠️ **cannot be confirmed without ABS admin/API
  access.** ABS ships **no supported "embed this player" iframe widget**; embedding
  would mean iframing `shelf.heygabi.ai` or reconstructing a player against ABS's
  API.
- **Auth is the wall.** ABS playback is behind **ABS's own bearer auth AND Cloudflare
  Access** (family allowlist, Google sign-in). An `<audio>`/iframe on
  `audiobooks.heygabi.ai` pointed at ABS would hit the CF-Access 302 to
  `cloudflareaccess.com` for anyone not already signed in (`SHELF_SERVER.md:94`,
  `:284-296`) — an unauthenticated `curl` to the shelf is always a 302 to CF Access.
  Cross-origin embedding of a CF-Access-gated origin is exactly the friction the
  estate's own-byte-route design sidesteps.
- The parity design already rejected leaning on ABS-through-the-tunnel because it
  requires **widening the Access Service Auth policy** (`shelf-parity-design.md:834-840`)
  — the same gate-widening cost would apply to a page that streams from ABS.

**Recommendation.** For an *embedded* player on `audiobooks.heygabi.ai`, build the
estate's **own** player (design already exists, stream route already deployed) over
`/api/audio/:anchor/file` — it stays on the estate's `vis`/download gate, needs no
CF-Access widening, and gives a real embedded experience. **Flipping out to the ABS
page** is the cheap fallback that works *today* for family members already through
the gate, with the honest limit that it leaves `audiobooks.heygabi.ai` and meets a
sign-in for anyone who isn't. Do **not** try to embed ABS's own player cross-origin
— it fights CF Access and ABS auth and buys nothing the own-route player doesn't.
The blocker to finishing the own player is the **service-worker auth seam** (an
owner decision, `§3`) and the **R2 audio bill** ($3–13/mo) — neither needs Justin.

---

## What needs the owner / ABS-admin access to answer

1. **(ABS admin)** The **ABS reader URL shape** for an ebook item — Q6 hangs off the
   exact string (`TODO.md:292-294`).
2. **(ABS admin)** The **author-image write path** — does `PATCH /api/authors/:id`
   accept an image by URL or only by upload? (Q1, `TODO.md:356-358`).
3. **(ABS admin)** Whether any **metadata provider / `metadata.json` sidecars** exist
   and what `PATCH /api/items/:id` and the **collections API** accept — decides how
   series/collections get populated (Q4).
4. **(ABS admin)** What ABS actually exposes for **streaming/embedding** (stream-URL
   shapes, HLS vs direct, any player embed) — Q7's ABS half is unconfirmed in docs.
5. **(Owner decision)** The **ebook GATE**: does moving ebooks to an ABS library /
   ABS reader move access from the estate `vis_ebooks`/`download_ebooks` gate to the
   CF-Access family gate? Settle Q5 + Q6 together, once (`TODO.md:246`, `:303-311`).
   This is access-*increasing* → confirm explicitly, don't infer.
6. **(Owner decision)** The **`/audiobookshelf/` base path** — keep or remove — before
   any link shape is hard-coded (Q2, `SHELF_SERVER.md:302`).
7. **(Owner decision)** The **ABS-API-with-service-token vs box-side** trade for the
   write features (Q3) — this widens the load-bearing Access gate, so it is an
   owner call.
8. **(Owner + Justin)** **Option E standing access** (Tailscale + read-only SSH) —
   Justin-side, and the unblocker for almost everything above (Q2, Q3).
9. **(Owner memory / Kiro transcript)** Whether the **Kiro** discussion of the
   author-cover item recorded anything not captured in the docs (Q1).

---

## Recommended next steps, ranked

1. **Land the shadow-tree timer** (Justin runs the `02-abs-hardlinks.sh` cron/flock
   line, or chains it to `rclone-sync`). One line; fixes the only shelf defect that
   breaks the shelf for real users (invisible new books). `SHELF_JUSTIN.md §4A/§4B`.
2. **Get Option E standing access done** (Tailscale + read-only `shelfsync` SSH
   user). Turns future 4-day debugs into one `ls`, and unblocks Phase 2, parity
   automation, and the ABS-write features. `SHELF_JUSTIN.md §4C`.
3. **Settle the two decisions that gate everything else:** the **ebook gate**
   (estate grants vs CF-Access family gate, Q5/Q6) and the **`/audiobookshelf/`
   base path** (Q2). Cheap to decide, expensive to get wrong after links are baked.
4. **Build the one durable `catalog row → ABS item` join** (author+title/ASIN, not
   the volatile uuid) — shared by Q1, Q4, Q6. Build it once (`TODO.md:210-212`).
   Prefer **search links over item-id deep links** so nothing 404s on a rebuild.
5. **Finish the estate's own audiobook player** (Q7) — resolve the service-worker
   auth seam (owner decision) and accept the ~$3–13/mo R2 bill; the stream route is
   already live. Prefer this over embedding ABS's player.
6. **Populate series/collections** (Q4) via the ABS API off the catalogue, once the
   join and ABS-write path are settled. Reconsider the service-token path Q3
   rejected-for-parity — it may be the simpler route for *writes*.
7. **Author card art** (Q1) — pipeline-side picker (stable seed, series-first) +
   ABS author-image write, after verifying the write path.
8. **Give ebooks a front door** (Q5 Option A: second ABS library on an ebooks-only
   shadow tree) — but only after step 3 settles the gate.

⚠️ **Sequencing note:** steps 6–8 each need ABS admin/API access and box work; steps
1–3 are the unblockers and should come first. Do not dispatch 4–8 as one multi-layer
build — `shelf-parity-design.md §7` measured that shape at 300–470k tokens and warns
against it.
