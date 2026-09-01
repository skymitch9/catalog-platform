# GABI's book knowledge (Tier 0c) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (this repo is PUBLIC on
> GitHub — resource and secret NAMES only, never values).
> Last verified: **2026-09-01** — the UNAUTHENTICATED half re-verified live
> (all four routes answer the worded 401; `discord.heygabi.ai/api/health` is
> green with `gabi_books_ready: true` and the four tool names) and pinned by
> **11 new probes** (§9). ⚠️ **The AUTHENTICATED half was NOT re-measured on
> this date** — no signed-in read, no real Discord question, and no pack was
> read by a live authorized caller. The §6 table's figures remain those
> measured **2026-08-18**; the pack COUNT there (158) is certainly stale, since
> the ingester adds packs nightly with no deploy.

*How to switch GABI's reading on and off, who holds what, how to prove it works,
and how to roll it back.* For how and why it is shaped this way, see
[`../info/gabi-book-knowledge-design.md`](../info/gabi-book-knowledge-design.md).
This file does not repeat it.

---

## 1. What this is, in one paragraph

The books the nightly ingester has packed into `ebooks-gated/text/` are
answerable in conversation: GABI can search a book's actual text, read one
passage, and roll a term up across several books — bounded by where the asker
has got to. Four Discord tools (§4), four retrieval routes on the audiobook
Worker, one `vis_ebooks` gate, and a posture that ships dark.

⚠️ **The knowledge base is a SUBSET of the shelf and it grows nightly with no
deploy.** Measured 2026-08-18 16:15Z: **158 packs** against 1,079 catalogued
audiobooks. `/api/books/available` reads an R2 listing with a 60-second lease, so
a book packed at 03:00 answers at 03:01.

---

## 2. The pieces

| Piece | Where | Note |
|---|---|---|
| Chunk packs | R2 `ebooks-gated`, prefix `text/` | ⚠️ **opaque gzip** — no `Content-Encoding` metadata, every reader gunzips explicitly |
| Index | `text/_index.json.gz` | a DECORATION; its absence is reported, not hidden |
| Retrieval routes | `apps/audiobook-worker/src/book-routes.ts` | ⚠️ paths are NOT symmetric — `/api/books/available` (`:277`) and `/api/books/presence` (`:311`) are **plural**; `/api/book/:bookId/search` (`:372`) and `/api/book/:bookId/passage` (`:429`) are **singular** |
| Unauthenticated-edge probes | `tools/estate-probes/probes/audiobook-worker.mjs` (`AB17`–`AB22`), `probes/discord-worker.mjs` (`D5`) | added 2026-09-01; `npm run probe:estate` |
| Tool definitions | `apps/discord-worker/src/gabi-tools.ts` → `GABI_BOOKS_TOOL_NAMES` | the FOURTH allowlist |
| The contract | `apps/discord-worker/src/book-knowledge.ts` | holds no credential |
| The credential seam | `apps/discord-worker/src/book-knowledge-exec.ts` | the ONLY module here that names the token |
| The executor | `apps/discord-worker/src/tool-exec.ts` → `runBooksTool` | no `fetch` of its own |

---

## 3. The two levers, and the order to pull them

| Lever | Where | Effect |
|---|---|---|
| `GABI_BOOKS` | var in `apps/discord-worker/wrangler.toml` | affirmative-only `"on"`. Anything else is OFF, **and OFF is not silent** — a plot question gets "reading the actual text of our books is switched off" plus an offer of what the catalogue knows |
| `ESTATE_APP_TOKEN_BOOKS` | secret on **two** Workers | unset on either side and door B closes; `makeBooksPort()` returns `null` and the tools are never described to the model |

**To switch her reading OFF (fastest, no deploy):**

```powershell
cd apps/discord-worker
npx wrangler secret delete ESTATE_APP_TOKEN_BOOKS
```

The port goes null on the next request; every other answer is untouched.
`/api/health` then reports `gabi_books_ready: false`.

**To switch it off durably:** set `GABI_BOOKS = "off"` in
`apps/discord-worker/wrangler.toml`, `npx wrangler deploy`. One line.

---

## 4. What she can actually do

Four tools, all read-only, all GET, none of which can write anything:

| Tool | Does |
|---|---|
| `list_book_knowledge` | which books she has READ, and their ids. ⚠️ Ids come from here and nowhere else — the routes refuse a constructed one |
| `search_book_text` | one book, four modes: `relevant` / `latest` / `earliest` / `presence` |
| `read_book_passage` | one passage by `ord`, stitched with its ±1 neighbours |
| `book_presence` | one term rolled up across ≤6 books, in reading order |

Caps (per person), **raised and extended 2026-08-18 by owner decision (option
C: auto-continue AND a modest raise)**:

| Cap | Value | Note |
|---|---|---|
| Retrieved bytes per turn | **48 KB** (was 24 KB) | ⚠️ exactly **2× the route's own `MAX_SEARCH_BYTES`**, so a turn is two full searches — the shape of "the sheet, then the abilities" that broke it |
| Passages per turn | **12** (was 6) | 2× the route's `MAX_PASSAGES`, which clamps `limit` to 6 whatever is asked |
| Consecutive passages per `read_book_passage` | **4** | how continuing works: `ord`, `ord+1`, … |
| Discord messages per answer | **4** | auto-continue is bounded, or it is a way to serially dump a book |
| Book turns per UTC day | 40 | `bcap:user:*` in the gateway DO — its own key namespace, not the docs one |

⚠️ **Auto-continue replaced a permission question.** She no longer stops
mid-answer to ask whether to keep going; the reply is delivered as labelled
consecutive messages (`**(2/3)**`), sent serially so ordering is guaranteed.
Past the 4-message bound she says the rest is in the book on the shelf — **with
no URL, deliberately**: the reader is keyed by `anchor` and a pack by `bookId`
(two different identifiers, design §4.2), so a deep link cannot be built from
this side, and `ebooks.heygabi.ai/read` does not exist yet.

---

## 5. Credentials and custody

| Secret | Holders | What it does |
|---|---|---|
| `ESTATE_APP_TOKEN_BOOKS` | `estate-discord` **and** `audiobook-worker` — exactly two | proves "this request came from the estate's Discord Worker" |
| `FIREBASE_SERVICE_ACCOUNT` | `estate-discord` (already present) | reads `discord_links/{id}.email` — the asker's proven identity |

⚠️ **The token AUTHORISES NO READ.** Every call also carries
`X-Estate-On-Behalf-Of: <proven email>`, and the audiobook Worker resolves THAT
against the estate directory's `vis_ebooks` using the same
`resolveEbookAccessForEmail()` the ebook shelf and the byte streams use. Revoke
somebody's `vis_ebooks` in `/admin` and their next question is refused, with no
deploy. **A leak buys reading on behalf of people who could already read.**

⚠️ **It is its own pair** — not `ESTATE_APP_TOKEN_DISCORD` (shared with both
library Workers) and not `ESTATE_APP_TOKEN_DISCORD_DOCS` (the auth Worker). This
one opens the household's *derived* book text, which is a **more attractive
scrape target than the files**: smaller, cleaner, searchable. A leak from a
library instance or from the docs corpus must not open it.

**Minted 2026-08-18** by the finisher agent, `openssl`-equivalent 32 random
bytes as hex, stored on both holders by the §7 file-redirect ritual in
[`discord-bot.md`](discord-bot.md) (`[IO.File]::WriteAllText` with
`UTF8Encoding($false)`, then `cmd /c "npx wrangler secret put NAME < file"`,
then delete the file — a PowerShell pipe stores a BOM and the BOM breaks the
bearer). ⚠️ The value was **rotated** on `audiobook-worker`, where an earlier
value existed with no second holder; nothing was using it, so nothing broke.

---

## 6. Verifying — the commands, and what a good answer looks like

**Is she wired up at all?**

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_books_enabled, gabi_books_ready, gabi_books_tools
```

Both `True`, and four tool names. `ready` is the AND of: posture on, book token
set, service account set — so a `false` there is a setup gap, never a
permissions one.

**Do the routes answer?** (needs the token; there is no read-back — a session
that does not already hold it cannot run these)

```powershell
$h = @{ authorization = "Bearer $tok"; "x-estate-on-behalf-of" = "<a vis_ebooks email>" }
Invoke-RestMethod "https://audiobook-api.heygabi.ai/api/books/available?limit=5" -Headers $h
```

**Measured 2026-08-18, live, all four modes:**

| Check | Result |
|---|---|
| `available` | 158 packs, `index_present: true` |
| `search … mode=latest&scope=whole_book` on Primal Hunter 1 | top hit ord 1547, ch 68, `stat_keys: 12`, `stitch: full`, 4,370 bytes |
| `scope=through_chapter&chapter=20` | ceiling **422**, 423/1667 chunks visible, top hit ord **421** — inside the bound |
| `scope=unknown` | `bounded: false` **and the ask sentence**, never a silent whole-book read |
| `presence` "Villy" across books 1–3 | book 1 **0 hits**, book 2 first at ord 520 (ch 24), book 3 26 hits — the §6.2 case, answered correctly |
| `passage?ord=1547` | span 1546–1548, `stitch: full` |
| an un-ingested id | **200** with `ingested: false`, the honest sentence and `did_you_mean` |

---

## 7. Gotchas that cost real time

- ⚠️ **THE ROUTE PATHS ARE NOT SYMMETRIC, AND GUESSING WRONG LOOKS LIKE "NOT
  DEPLOYED".** The corpus-wide pair is `/api/books/…` (**plural**); the
  per-book pair is `/api/book/:bookId/…` (**singular**). A wrong guess —
  `/api/books/{id}/search` is the natural one — gets Hono's default
  `text/plain` **`404 Not Found`**, with no worded refusal, which is exactly
  what an undeployed route looks like. Cost a round-trip on 2026-09-01 to
  diagnose; recorded so it is not diagnosed a third time. ⚠️ It is also the one
  bare status on this surface, and it is Hono's fallback rather than anything
  this feature writes — a real refusal from these routes is always a worded
  JSON body.
- ⚠️ **Packs are opaque gzip on purpose.** The `Content-Encoding` metadata was
  deliberately removed: the Workers R2 binding returns STORED bytes, so a reader
  that assumes inflation gets gzip magic where it wanted JSON. Gunzip explicitly.
- ⚠️ **Nine twin `bookId`s are packed twice** (an EPUB and a transcript of the
  same book). Do not double-count availability.
- ⚠️ **`title` is EMPTY on every listing row** (measured 2026-08-18) even with
  `index_present: true` — the index carries `source`, `chunks`, `chapters` and
  `ingester_version` but no title. `book_id` is a slug of the title so it is
  still readable, but a UI that shows only `title` will render blanks. Not fixed
  here; recorded so the next session does not diagnose it twice.
- **All nine Primal Hunter packs are `source: transcript`** — there is no ebook
  twin for that series. Letter grades are measurably unreliable from speech
  (design §6.4: `Human (D)` → *"human, G"*), which is why the tool result tells
  the model to say it is quoting a transcript.
- **An `ord` means nothing outside the pack that produced it.** A bound carried
  across a re-chunk leaked 28 chapters in testing. Nothing on the Discord side
  computes or stores one: it sends `scope=whole_book|through_chapter|unknown`
  and the pack derives the ceiling every turn.
- ⚠️ **ROUTING IS THE DEFECT CLASS THIS FEATURE FAILS BY, TWICE NOW.** The first
  live question (*"jakes status sheet at the end of the 9th book"*) was answered
  from the catalogue because `booksIntent()` missed three ways at once —
  `status` vs `stat`, words between "end of" and "book", and `9th book` vs
  `book 9`. Design §10b has the full account. **If a book question ever gets a
  shelf answer again, look at `booksIntent()` FIRST** and reproduce it with a
  one-line script before touching anything else; the reply text tells you the
  branch, because a shelf answer reassembles from `MENTION_MSG.searched` +
  `MENTION_MSG.none`.
- ⚠️ **TO CONTINUE A CUT-OFF ANSWER, PAGE FORWARD BY ORDINAL — NEVER RE-SEARCH.**
  A ranked search returns its best match every time and the tail of a stat sheet
  is never the best match, so "search again to continue" is an infinite loop by
  construction. It happened to the owner live: he asked for the professions, she
  re-pulled the same passage, re-printed the whole sheet and stopped in exactly
  the same place, twice. `read_book_passage` takes `count` and returns
  `next_ord` for this reason.
- ⚠️ **A FOLLOW-UP IS ROUTED ON THE CONVERSATION, NOT THE SENTENCE.** She
  offered a retry, the owner accepted it in five words, and the stateless
  detector sent it to the catalogue (design §10c). `booksFollowUp()` reads the
  remembered window — which is keyed **per channel** — so a bare "go on" after
  moving to a DM or another channel will NOT continue a book conversation. That
  is correct, and it is the thing to explain rather than to fix.
- ⚠️ **NEVER let her say "budget", "cap" or "quota" to a person.** She did, the
  owner read it as a malfunction, and nothing was wrong. The words are banned by
  test from every `BOOKS_MSG` sentence; if one reappears, look for a tool
  DESCRIPTION that uses it — the model quotes those verbatim.
- ⚠️ **`book-retrieval.ts`'s `looksLikeStatQuestion()` has the same `stat` /
  `status` gap** and it is NOT fixed — the Discord side works around it by
  sending `stat_block=true` whenever the query is stat-shaped. Every other
  caller of these routes still gets the auto detector, which measurably returns
  passages that MENTION the words instead of the blocks themselves.
- ⚠️ **A book turn burns THREE fuses** — the ordinary turn cap, and the books
  day cap, and (if she also read docs) the docs cap. They are separate counters
  in separate key namespaces on purpose.

---

## 8. Rolling back

| Want | Do |
|---|---|
| Stop her reading NOW | `wrangler secret delete ESTATE_APP_TOKEN_BOOKS` on `estate-discord` (§3) |
| Stop her durably | `GABI_BOOKS = "off"` + deploy |
| Undo the code | the feature is four commits on `main`, `apps/discord-worker` only; the routes it calls predate it and are used by nothing else yet |
| Suspect a leaked token | re-mint and re-store on **both** holders (§5). Nothing else holds it, so there is no third place to remember |

---

## 9. The probes — what is checked with NO credential

Added 2026-09-01, per the estate's new-endpoint-gets-a-probe rule. Run with
`npm run probe:estate` from the repo root. **129/129 passing**, measured
2026-09-01 (was 118 before these; see `tools/estate-probes/README.md`).

| Probe | Asserts |
|---|---|
| `AB17` | `GET /api/books/available` tokenless → worded 401 |
| `AB18` | same, on a **garbage bearer** → worded 401 |
| `AB19` | `GET /api/books/presence` tokenless → worded 401 |
| `AB20` | `GET /api/book/:bookId/search` tokenless → worded 401 |
| `AB21` | `GET /api/book/:bookId/passage` tokenless → worded 401 |
| `AB22` | that refusal names **no pack, bucket or `text/` prefix** — the gate runs before any R2 GET |
| `D5` | `gabi_books_tools` on the live health route equals the four names in `GABI_BOOKS_TOOL_NAMES` |

The worded 401, quoted live 2026-09-01 from all four routes, identically:

```json
{"error":"unauthenticated","detail":"The ebook shelf is for the household. Sign in with Google to see it — signed-out visitors get no list at all."}
```

⚠️ **The probes can only ever see the refusal, and that is deliberate.** The
suite holds no credential and mints no identity; §5's note stands — fabricating
an `X-Estate-On-Behalf-Of` to exercise a token is asserting an identity to a
live gate, which is not a probe. So the reading half is proven by the owner's
acceptance test, never by this suite.

⚠️ **`D5` pins the fourth allowlist against the DEPLOY.** The discord-worker's
own `test/book-knowledge.test.ts` pins it structurally at build time — that a
tool cannot leave its array, and that `toolsForApi()` with no argument still
returns Tier 0 and nothing else. `D5` is the other end: what is actually
serving. Both are needed, because a green build says nothing about which
version is live.

⚠️ **`gabi_books_enabled` / `gabi_books_ready` and the caps are PRINTED, never
failed on.** `GABI_BOOKS = "off"` is §3's documented rollback, so a probe that
failed on it would fight the lever it exists to keep safe. Measured live
2026-09-01: `enabled=true ready=true bytes/turn=49152 passages/turn=12
turns/day=40` — matching §4's table exactly.

⚠️ **`ESTATE_APP_TOKEN_BOOKS` does NOT appear in the health route's
`configured` map** (measured 2026-09-01; the map lists ten other secrets).
Its presence is only observable through `gabi_books_ready`, which is the AND of
posture + book token + service account. So a `ready: false` still means "a
setup gap, never a permissions one" (§6), but it does **not** tell you *which*
of the three is missing. Not fixed here; recorded so the next session does not
hunt for a token name that was never published.
