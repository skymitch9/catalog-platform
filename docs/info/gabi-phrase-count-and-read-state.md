# GABI — "how often does Carl say…": the read-state bound and the `count_phrase` tool

> **Audience:** Claude sessions, the owner. **Status:** TRACKED — **DESIGN + measured
> investigation, NOTHING BUILT** (2026-09-03). **Last verified: 2026-09-03** — every
> `file:line` below was read from source that day; the detector results were
> *executed* (`npx tsx` against `book-knowledge.ts`), the DCC counts were computed
> over the LOCAL pack mirror. ⚠️ NOT verified: the owner's `reviews` doc for DCC 1
> (read blocked), the live `GABI_BOOKS` posture, R2 == local pack. See §6.

## 0. The incident (2026-09-03, Discord)

Owner: *"how often does Carl say God Damnit Donut or something similar in dungeon
crawler Carl book 1"*. GABI found instances, then asked how far he was into book 1.
He: *"I've read them all"*. GABI: *"I don't have a tool that counts specific phrases
across a book's text."* Owner's two complaints: (1) *"It doesn't know that I've read
the books even though I have it rated and I've linked"*; (2) *"It couldn't answer the
question and should be able to. Let's add this tool in."*

**Owner decision, same day:** *"Yes let her see it. She should be able to see everything
on my GABI account except passwords and such."* → GABI may consult the linked
person's OWN account data (ratings, reviews, progress, positions, shelves) when acting
for that person; derived per turn, never stored; secrets and other people's data excluded.

## 1. Why she asked how far he'd got — measured

| Input | `booksIntent` | `boundFromQuestion` | `booksFollowUp` |
|---|---|---|---|
| the owner's question | **false** | `unknown` | — |
| `I've read them all` | false | `unknown` | **false** (even after a book turn) |
| `I've read the whole series` / `I've read it` | false | `whole_book` | — |

- `unknown` is **not a block** — `audiobook-worker/src/book-retrieval.ts:217-219` returns
  `ceiling:null` (search ran over the whole book) plus `SCOPE_UNKNOWN_ASK`
  (`:162-164`), which `discord-worker/src/tool-exec.ts:873-879` relays as an instruction
  to ask. She found the instances *and* asked, as told.
- `ENDPOINT_RE` (`book-knowledge.ts:92-93`) only has `i've (read|finished) (it|the whole)`
  — **"them all" fails on the object**. `boundFromQuestion` (`:98-112`) consults the
  string only: no store, no identity, no rating.
- The follow-up re-derived the bound from *"I've read them all"* alone
  (`mention-flow.ts:781`, called with just the new message at `:2748`/`:3026`) → `unknown`
  again, **and left the book lane**: `booksFollowUp` (`book-knowledge.ts:368`) needs a
  prior user turn satisfying `booksIntent`, and turn 1 never did. Nothing re-ran the count.
- Turn 1 missed `booksIntent` because `BOOKS_WEAK` (`:211-220`) has `said|says` but not
  **`say`**, and no "how often / how many times". The anchors (`book 1`, `dungeon crawler`)
  matched. The model reached for the book tools on its own — the fallback `:236-239` relies on.

## 2. Read-state signals — what exists, what is reachable

| Signal | Store | Key | Reachable from Discord Worker | Note |
|---|---|---|---|---|
| **Rating + review** | Firestore `reviews` (`reviews_dev` on dev sites) | `${bookId}_${displayName.lower}`; `bookId`, `displayName`, `rating`, `text` (`shelf-exec.ts:260-267`) | ✅ `ShelfPort.myReviews()` `shelf-exec.ts:205-230`, already injected into the books lane (`mention-flow.ts:2275` → `:1428`) | **this is "rated and linked"**; matched BY DISPLAY NAME (`:209-212`) — `submitReview` writes no uid/email |
| TBR | Firestore `readingLists` | `uid` | ✅ `myTbr()` | — |
| Reading position | Firestore `readingPositions/{uid}_{bookId}` (design §4.2) | uid + `bookIdFromTitle` | ❌ no seam (`book-retrieval.ts:134-137`); `through_ord` (`:142`) is the socket | 🔴 collection is **EMPTY** (`RECOVERY.md:713-716`) |
| ABS listening progress | the shelf box | ABS user | ❌ no client anywhere | box work ⏸ paused |
| Club progress `finished`/`chapterIndex` | `clubs/{id}/reads/{r}/progress/{slug}` (`club-write.ts:89-132`) | club read + slug | ⚠️ SA could; no read path; `/progress` dark (KI-13) | club reads only |
| Library `user_book.read_state` | `library_catalog` D1 (`packages/core/src/readstate.ts:55-67`) | library account | ❌ other repo, no estate read API | print/ebook only |

**The join is exact, no new id:** `reviews.bookId` = `bookIdFromTitle(title)`
(`audiobook_catalog/site/reviews.js:16-22`) = the pack's `book_id`
(`book-packs.ts:107-111`, `BOOK_ID_RE`).

**Precedent, in the owner's own words** (`library_catalog/.../readstate.ts:9-17`): *"if a
book has a rating from the audiobook library mark it as read … if its a rating i left mark
it read for me."* The suggestions rule (*not reviewed ≠ unread*) bans `¬rated ⇒ unread`;
it never touched `rated ⇒ read`. This is an existing policy reaching a surface that never
got it.

## 3. The bound ladder — `deriveBound(text, readState)`, first hit wins

| # | Source | → bound |
|---|---|---|
| 1 | question names a chapter (`CHAPTER_RE`) | `through_chapter` (round down, unchanged) |
| 2 | question states an endpoint (`ENDPOINT_RE`, **widened** — §3.1) | `whole_book` |
| 3 | `readingPositions` `progress ≥ 0.98` | `whole_book` — *not reachable today* |
| 4 | `readingPositions` `progress < 0.98` | `through_ord` derived THIS turn via this pack's chapter table, sent with `iv=<ingester_version>` (`book-routes.ts:206-222` refuses a mismatch) — *not reachable today* |
| 5 | club `finished == true` | `whole_book` — *no read path today* |
| 6 | club `chapterIndex` | `through_chapter` — *no read path today* |
| 7 | **asker's OWN `reviews` doc for that `bookId` with a valid rating** | **`whole_book`, `how:'rating'` — THE SHIPPABLE FIX** |
| 8 | nothing | `unknown` — existing sentence, unchanged |

The question always outranks the store (a sentence is live; a store is a record).

### 3.1 Widen `ENDPOINT_RE`
Currently `unknown`: *I've read them all · I have read them all · I've read all of them ·
I finished the series · I read them all · read the whole series.* Add (tightened so bare
*"I read"* does not fire): `(?:i'?ve|i have|i) (?:read|finished) (?:it|them|this|these)?
(?:all|the whole|the entire|every one)?`, `(?:the )?(?:whole|entire) (?:series|lot|thing)`,
`caught up`. A series statement is `whole_book` for every book of the series — safe
because it is derived per turn from what the person just typed.

### 3.2 Guards that keep `rated ⇒ read` honest (all precedented)
- Asker's own review only, folded `displayName` (`readstate.ts:99-129`; `shelf-exec.ts:213-223`).
- **No rating floor** — a 0.5 is still a finished book (`readstate.ts:85-94`).
- Per `bookId`, never the series.
- Rows 1–6 outrank row 7 (DNF-with-rating: the more specific truth wins, `readstate.ts:151-155`).
- Transcript vs ebook: same story identity by construction; the answer already names the
  text it read (`tool-exec.ts:859-863`).
- **A failed shelf read falls to `unknown`**, never to `whole_book` (`unknown ≠ no limit`).
- Nothing stored: only the WORD `whole_book` crosses `boundParams` — no ord, so the
  28-chapter re-chunk leak (design §4.3, `:462-474`) cannot apply.
- She says which evidence she used: *"you rated this one, so I'm treating it as finished —
  say if that's wrong."* That sentence is the fuse for the residuals: rated-after-DNF with no
  position, a housemate sharing a display name, a migrated passphrase-era review with no uid.

### 3.3 Carry the pending question
1. `booksFollowUp` should accept a turn whose predecessor **spent book budget**
   (`BooksBudget.used()`, `book-knowledge.ts:480,497`), not only one whose text passed
   `booksIntent`.
2. Answering her own scope question is a continuation of it — add a `pendingScopeAsk`
   window marker, the `answeredFormat` pattern (`mention-flow.ts:2175-2205`, *"a clarifying
   question is a promise"*), so the follow-up re-derives `whole_book` AND re-issues turn 1.
3. `BOOKS_WEAK` gains `say`, `how often`, `how many times`.

## 4. The phrase-count gap — why the existing tool cannot count

| Instrument | Returns | Cap |
|---|---|---|
| `GET /api/book/:id/search` (`book-routes.ts:372-426`) | ≤6 stitched passages | `MAX_PASSAGES=6`, 4 KB each, 24 KB total (`book-retrieval.ts:109-117`); `limit` clamped `:642` |
| `/passage` | one chunk by `ord` | 4 KB |
| `/api/books/presence` (`:311-369`) | `chunk_hits` per book | `MAX_PRESENCE_BOOKS=6` |

Measured on the real pack: bag-of-words presence `{god,damn,donut}` → **17 chunk hits**;
literal string → **13 chunks**; true de-overlapped phrase count → **14**. Two errors, opposite
directions, neither reported. `phraseOf` (`:860-866`) forms no phrase for a `?`-free 91-char
sentence; `aliasExpansions` (`:308-333`) is per-term, cannot relate *god damn it, Donut* to
*goddammit Donut*. **Her sentence was true.**

### 4.1 The store
`ebooks-gated` / `text/{bookId}.json.gz` (opaque gzip, `book-packs.ts:50-51,113-119`); chunks
`{ord, chapter_index, text, start_sec…}` 800 chars / 100 overlap, chapter-anchored; writer
`audiobook_catalog/app/core/ingest_pack.py`; state `C:\Users\nbasl\estate-training-data\ingest_state.json`
(**1,199 rows: 1,182 done / 16 superseded / 1 failed**, measured 2026-09-03).
**DCC 1 is packed:** `dungeon-crawler-carl-a-litrpg-gamelit-adventure`, `source: transcript`,
1,033 chunks / 50 chapters / 705,453 bytes; all 8 DCC volumes are packed.

### 4.2 The measured answer
**"God damn it, Donut" — 14× in book 1** (transcript), 12 of 50 chapters, **chapter 28 has 3**;
chapters 11,15,18,20,24,27,30,33,39,44,46 one each. `Donut` 753×, `god damn` 32×,
`goddamn` 11× (never before *Donut* in the transcript). ⚠️ Whisper punctuation — the printed
book may say *goddammit*; the tool must say "transcript".

### 4.3 `count_phrase` — the tool
- **Runs on the audiobook Worker** over the pack (one HTTP call, zero subrequests —
  `book-routes.ts:21-28`). Never ships prose to be tallied.
- Routes: `GET /api/book/:id/count?q&variants&scope[&chapter|ord|iv]`;
  `GET /api/books/count?books=a,b,c&q` (≤ `MAX_PRESENCE_BOOKS`).
- Tool: `count_phrase { bookIds ≤6, phrase, variants ≤6, quotes ≤3 }`.
- Returns `{ total, by_variant, by_chapter[{index,title,n,first_start_sec}], quotes ≤3 ×
  ≤400 chars, hidden_by_scope, scope, matcher }` — counts + anchors, never the book.
- ⚠️ Count on **de-overlapped** text per chapter (reuse `deOverlap`, `:484-490`); casefold,
  collapse whitespace, optional `,.!` between words, `’→'`; `total` is a PHRASE count;
  `0` ≠ `ingested:false` (`:617`, `tool-exec.ts:834-838`).
- Scope: `visibleChunks(pack, ceiling)` first (`:635-638`); `hidden_by_scope>0` forbids
  "absent" (`tool-exec.ts:816-832`); `unknown` → whole-book count + the ask, unless §3 resolves it.
- Permission unchanged: `booksGate()` → `resolveEbookAccessForEmail()` → `vis_ebooks`;
  door B bearer `ESTATE_APP_TOKEN_BOOKS` + `x-estate-on-behalf-of`. No new secret/grant.
- Fuses: 4th daily fuse (`BOOKS_TURNS_PER_DAY=40`); charge serialised bytes (~1–2 KB of 48 KB)
  and `passages: quotes.length`; new `MAX_COUNT_VARIANTS=6`, `MAX_COUNT_QUOTES=3`.
- Groq: **out** — tools stay on Anthropic (`gabi-groq-rung.md`); not in `gabi-groq-tools.ts`.
- `gabi_turn`: ride `books_passages`/`books_bytes`; never log the phrase (design §8).

### 4.4 Effort — two dispatches, ~250–300k Opus total
| Dispatch | Files |
|---|---|
| **A — audiobook-worker** | `book-retrieval.ts` (+`countPhrase` ~120 lines), `book-routes.ts` (+2 routes), tests |
| **B — discord-worker + bound fix + docs** | `gabi-tools.ts` (5th tool), `tool-exec.ts`, `book-knowledge.ts` (caps, `ENDPOINT_RE`, `BOOKS_WEAK`, `deriveBound`), `mention-flow.ts:781` + `booksContextFor`, `shelf-exec.ts` (`ratingFor(bookId)`), `test/book-knowledge.test.ts` §5 regression pair, `gabi-book-knowledge-design.md` §4.5/§4.6 + incident §10f, `access/gabi-book-knowledge.md` |

**Review when it lands:** same Discord channel, *"@GABI how often does Carl say God damn it
Donut in Dungeon Crawler Carl book 1"* → **14**, chapter 28 the triple, ≤3 quotes, a
"transcript" line, **no question about how far he has got.**

## 5. To check before building (one command each)
- Owner's rating for DCC 1: `documents:runQuery` on `reviews` with `bookId ==
  "dungeon-crawler-carl-a-litrpg-gamelit-adventure"`, match `displayName` against
  `discord_links/133003216978837504.displayName` (shape: `shelf-exec.ts:238-248`).
- Live posture: `GABI_BOOKS` on the deployed discord-worker; deployed commit vs `main`.
- Pack parity: `npx wrangler r2 object get ebooks-gated/text/dungeon-crawler-carl-a-litrpg-gamelit-adventure.json.gz` vs the local mirror.

## 6. Not verified (2026-09-03)
The owner's `reviews` doc (blocked); the literal Discord transcript (reconstructed from the
quoted question); no live request, R2, D1 or wrangler call; `GABI_BOOKS`/deployed version;
R2 pack == local mirror; transcript vs printed text; the de-overlap was re-implemented in
Python, not `deOverlap` executed (705,502 vs 705,453 bytes — join spacing); club/ABS/library
absences established by grep, not audit.
