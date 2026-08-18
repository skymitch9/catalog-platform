# GABI has read the library — design

> **Audience:** Claude sessions + the owner. **Status:** TRACKED (this repo is
> public on GitHub — resource and secret NAMES only, never values).
> **DESIGN ONLY. Nothing in here is built** in production — no bucket, no route,
> no tool, no vector. Two throwaway pilots have now run locally: transcription
> (§6.4) and **retrieval + chunk tuning (§7.3.1, §6.2, §10)**, both in
> `.claude/jobs/*/tmp/`, never committed and never uploaded.
> Last verified: **2026-08-18**. Every figure marked *measured* was taken on
> this machine on 2026-08-18 by extracting text from the estate's own files;
> figures marked *reasoned* are arithmetic on those measurements or vendor-published
> rates, and say so.

Owner brief, verbatim (2026-08-18): *"maybe we add a feature where i say, im
reading x book, give me a question about it to help me ponder. Also I want Gabi
to understand the books we own. is it possible to start a long term project of
having all of the media i own ingested into Gabi so she can talk about the book?
I want to be able to ask clarifying questions like what's Jake's current stat
sheet at the end of book 12 of Primal Hunter and she has that knowledge
cataloged in her memory"*

Companions — read these, this doc deliberately does not repeat them:
[`gabi-docs-assistant-design.md`](gabi-docs-assistant-design.md) (this design's
little sibling: publisher → gated bucket → gated routes → GABI tools → two doors;
§0 and §5.2 in particular, because **its central argument breaks at book scale**
and §2 below is where it breaks),
[`gabi-application-map.md`](gabi-application-map.md) (the T0–T4 ladder; this is
T0-class read-only throughout),
[`audio-player-design.md`](audio-player-design.md) §1.2 and §7.3–7.4 (chapters,
the audio position shape, the one-gated-bucket decision),
[`ebook-viewer-phase1.md`](ebook-viewer-phase1.md) (the gated byte stream and
its nine worded refusals),
`audiobook_catalog/site/reading-position.js` (LOCAL — its header is the
authoritative account of the position store and is quoted in §4).

---

## 0. Feasibility verdict

**Yes — and the ebook half is far easier than it looks, while the question the
owner actually asked lands squarely in the hard half.**

Three measurements decide the whole design:

1. **The ebook corpus is small.** All 138 EPUBs on the shelf yield
   **73,565,597 bytes of extractable text (73.6 MB, 12,476,499 words)** —
   *measured*. Extracting all of it took **5 seconds** on this machine with the
   Python standard library and no dependencies. That is not a research project;
   it is an afternoon.
2. **The PDFs are not a text source.** 30 PDFs, 641 MB of file, yield
   **3,864,121 bytes of text total — and 25 of the 30 yield under 20 KB each**,
   because they are image-only scans (*measured*, PyMuPDF). *The Way of Kings*
   PDF is 48.6 MB and produces **640 bytes** of text. Without OCR the PDFs
   contribute essentially nothing.
3. ⚠️ **The owner's own acceptance test is about a series the estate owns ONLY
   as audio.** The shelf holds **14 Primal Hunter audiobooks, 277.2 hours,
   narrated by Travis Baldree — and ZERO Primal Hunter ebooks** (*measured*).
   "What's Jake's stat sheet at the end of book 12" cannot be answered from any
   text the estate currently possesses. It requires transcription.

That third fact is the shape of the whole project. Across the catalogue,
**1,012 of 1,079 audiobooks have no ebook twin — 13,629 of 14,804 hours**
(*measured*, loose title join; see §1.4 for the join's honesty). The library
GABI can read today is 6% of the library the estate owns.

The good news is that transcription is **cheap and bounded when done on
demand**: Primal Hunter's 14 books are **16,633 minutes → $8.32** at Workers
AI's published Whisper rate, or one overnight run on the RTX 4080 SUPER already
in this machine. The whole 14,804-hour corpus is **$444** — a real number, not a
blocker, but also not something to spend before a single question has been asked.

**So the verdict is: build it, in the order the owner's two asks actually
imply.** The ponder-question feature (§5) is buildable *before any ingestion at
all* and gets better as books arrive. The stat-sheet question (§6) is the
acceptance test for the full stack and is deliberately last. Between them sits a
retrieval architecture whose only unusual property is that **almost every
question names its book**, which collapses the hard part of RAG into a lookup
the estate has already built.

---

## 1. The corpus, measured

### 1.1 Ebooks — what the estate can read today

`site/ebooks.json` (root `C:/Users/nbasl/OpenAudible/books`), 168 files:

| | EPUB | PDF | Total |
|---|---:|---:|---:|
| Files | 138 | 30 | **168** |
| Bytes on disk | 1,163,534,944 | 641,758,294 | 1.81 GB |
| **Extractable text (bytes)** | **73,565,597** | **3,864,121** | **77,429,718** |
| Words | 12,476,499 | — | — |
| Extraction wall-clock | 5 s | 7 s | 12 s |

**Per-EPUB text distribution** (*measured*, bytes of UTF-8 after tag stripping):

| min | p25 | median | p75 | max | mean |
|---:|---:|---:|---:|---:|---:|
| 155 | 240,662 | **514,952** | 744,198 | 3,216,621 | 533,084 |

⚠️ **14 EPUBs yield under 50 KB of text**, and the reason matters: they are
graphic novels and illustrated light-novel volumes. The worst case is measured
and is worth stating because it will otherwise be rediscovered as a bug: the
**White Sand omnibus is a 412,436,591-byte EPUB that yields 5,647 bytes of
text.** A pipeline that sizes work by file bytes will spend 412 MB of I/O on a
book it cannot index. Size by *extracted text*, and record image-only books as
**deliberately absent**, not as failures.

⚠️ **The PDFs are 25/30 scans.** Median PDF text is **6,304 bytes**; five files
carry essentially all 3.9 MB. §9 recommends leaving them out of scope and saying
so out loud rather than shipping a shelf where a third of the "readable" books
silently return nothing.

### 1.2 Audiobooks — what the estate owns but cannot read

| | |
|---|---:|
| Titles (`site/catalog.csv`) | **1,079** |
| Total duration | **14,804 hours** (*measured*, summed from `duration_hhmm`) |
| Mean per title | 13.7 h |
| `chapters.json` entries | **1,079** — exact-seconds chapter tables for every title |
| Bytes on disk | ~630 GB |

`chapters.json` is the single most valuable asset in this design and it already
exists. Every entry is `{title, source:"m4b", chapters:[{title, start_min,
start_sec}]}` with `start_sec` to millisecond precision. It is what makes an
audio position map onto a text chunk (§4.3) and what gives a transcript
chapter-anchored structure for free (§3.3).

### 1.3 ⚠️ The words-per-audio-hour ratio, measured on this estate's own shelf

Rather than assume an industry figure, **30 books the estate owns in BOTH
formats** were paired and the ratio measured directly:

| | words / audio-hour |
|---|---:|
| Minimum (Sanderson, *Isles of the Emberdark*) | 7,754 |
| **Median** | **9,476** |
| Mean | 9,559 |
| Maximum (*The Knight*, Last Horizon 3) | 11,017 |

That is a 1.42× spread across narrators, so treat it as a planning figure, not a
constant. Applied to the audio-only remainder:

| Quantity | Value | Basis |
|---|---:|---|
| Audio-only hours | **13,629** | measured |
| → words | **~129,150,000** | reasoned (13,629 × 9,476) |
| → bytes of text | **~762 MB** | reasoned (× 5.90 bytes/word, the estate's own measured ebook ratio) |
| → tokens | **~190 M** | reasoned (bytes ÷ 4) |

**So the finished corpus is ~840 MB of text (~210 M tokens): 9% ebook, 91%
audio.** Every sizing decision below is made against 840 MB, not 77 MB.

### 1.4 ⚠️ Coverage, and the honesty of the join

The 67-twinned / 1,012-audio-only split comes from a **normalised title join**
(lowercased, punctuation and series-boilerplate stripped) between `catalog.csv`
and `ebooks.json`'s `audiobook_title`. It is deliberately loose and it is
**approximate in the direction that matters least**: a missed match understates
twinning and overstates the transcription bill. The manifest's own
`beside_audiobook` field is set on 156 of 168 ebooks, so the true twinned count
is likely somewhat higher than 67.

⚠️ **The estate already has a canonical identity for this and the ingest must
use it, not re-derive one.** `bookIdFromTitle()` — the key `readingPositions`
uses — and `ebook-notes.warningTitleFor()` already answer "which title is this
book's identity when it exists in two formats". `reading-position.js`'s header
explains at length why keying on the EPUB's own title fails silently in both
directions. One implementation. This design adds none.

### 1.5 ⚠️ The acceptance-test series, measured

| | |
|---|---|
| Primal Hunter audiobooks owned | **14** |
| Total duration | **277.2 hours** (16,633 minutes) |
| Narrator | Travis Baldree (all 14) |
| Book 12 (*The Primal Hunter 12*) | **20:07** |
| **Primal Hunter EPUBs owned** | ⚠️ **ZERO** |
| Estimated transcript size for the series | ~2.63 M words / ~15.5 MB (*reasoned*) |

The owner's question is not answerable today and will not be answerable until
phase 5. That is stated up front rather than discovered at demo time.

---

## 2. ⚠️ Why the docs-assistant's central argument breaks here

`gabi-docs-assistant-design.md` §0 makes an explicit, measured case for **one
bundle instead of a search engine**: the docs corpus is 3.1 MB raw / 1.19 MB
gzipped, one R2 GET on a cold isolate, and a literal substring scan over it is
milliseconds of Worker CPU. That reasoning was right, and it is **not
transferable**.

It also wrote its own tripwire (§5.4): *WARN above 10 MB raw, refuse above
25 MB.* Applied here:

| Corpus | Raw | vs. the docs tripwire |
|---|---:|---|
| Estate docs (built) | 3.1 MB | under WARN |
| Ebook text alone | **73.6 MB** | **7× past REFUSE** |
| Ebook + audio transcripts | **~840 MB** | **34× past REFUSE** |

**The tripwire fires immediately, which is the tripwire working.** So this
design does not extend the docs assistant; it inherits its *shape* (local
publisher → private bucket → gated Worker routes → two named tools → worded
refusals) and replaces its *retrieval*.

But it inherits one more thing, and this is the pivot the whole architecture
turns on:

> **The docs assistant's unit of retrieval is a section. This design's unit of
> retrieval is a BOOK — and almost every question names it.**

"In book 12 of Primal Hunter", "I'm reading X", "what happened to Y in
Blackflame" — the book is in the question. The estate **already** has the tool
that resolves a title/series/index to a book: the T0 catalogue Q&A tools shipped
2026-08-18. So the retrieval problem decomposes into a resolved lookup the
estate has already built, plus a search over **one median-515 KB document** —
which is *smaller than the docs bundle the Worker already scans today.*

That is the whole design in one sentence, and §3 is its consequences.

---

## 3. Architecture

### 3.0 The four stages

```
   "what's Jake's stat sheet at the end of book 12 of Primal Hunter"
        │
   ①  RESOLVE  ── existing T0 catalogue tools ──▶ bookId + format + owned?
        │                                          (already built)
   ②  SCOPE    ── readingPositions/{uid}_{bookId} ──▶ ordinal ceiling
        │                                          (store already built)
   ③  RETRIEVE ── one book's chunk pack from R2 ──▶ ≤6 chunks
        │           + Vectorize namespace = bookId (semantic recall)
        │
   ④  ANSWER   ── chunks + citation + scope statement ──▶ GABI's turn
```

Stages ① and ② are **already built and need no new machinery**. Stage ③ is the
new thing. Stage ④ is prompt and wording work.

### 3.1 Storage: one chunk pack per book, in R2

| Piece | Name | Notes |
|---|---|---|
| Bucket | **`ebooks-gated`**, new prefix `text/` | recommended — see §9 decision 2 |
| Object | `text/{bookId}.json.gz` | one per ingested book |
| Object | `text/_index.json.gz` | bookId → {title, chunks, bytes, source, ingested_at, has_audio_map} |
| Binding | reuse the existing gated-manifest binding on the audiobook Worker | no new binding if the bucket is reused |

**Chunk pack shape** (reasoned; pin it in the ingester's header when built):

```
{ book_id, title, source: "epub"|"pdf"|"transcript",
  ingested_at, ingester_version, text_sha256,
  chapters: [ { index, title, first_chunk, last_chunk,
                start_sec, end_sec } ],        // start/end only when an audio twin exists
  chunks:  [ { ord, chapter_index, text,
               spine_index,                    // EPUB only — see §4.4
               page,                           // PDF only
               start_sec, end_sec } ] }        // transcript / audio-mapped only
```

**Sizing, measured against the real distribution:** a median book is 514,952
bytes of text. Markdown-ish prose gzips to roughly 30–40% (the docs corpus
measured 40.1%), so a median chunk pack is **~150–200 KB gzipped** and the
largest book on the shelf (3.2 MB) is **~1.0–1.3 MB gzipped** — *smaller than
the estate-docs bundle the auth Worker already fetches and scans on a cold
isolate today*. One R2 GET, one gunzip, one scan. No index, no database, no
second write path.

⚠️ **The Worker caches per book, not globally.** Module-scope map keyed by
`bookId → {pack, etag, leased_at}`, five-minute revalidation lease — the
departure `gabi-docs-assistant-design.md` §10.3 already found necessary and
already justified. Cap the map (say 8 books) and evict least-recently-used: a
Worker isolate that has served eight different books must not be holding eight
megabytes.

### 3.2 The four candidate architectures, weighed

| | (a) Per-book packs in R2 + lexical | (b) Cloudflare Vectorize | (c) D1 + FTS5 | (d) Hybrid — **recommended** |
|---|---|---|---|---|
| Fits the book-scoped query | ✅ perfectly | ✅ via namespaces | ✅ via a WHERE | ✅ |
| Finds literal text (stat blocks, names, item names) | ✅ **best** | ⚠️ embeddings blur exact strings | ✅ best | ✅ |
| Finds paraphrase ("how did he feel about…") | ❌ | ✅ **best** | ❌ | ✅ |
| Cross-book ("which books mention X") | ❌ scan-everything | ✅ | ✅ | ✅ (via b) |
| New write path into production data | none | index writes only | ⚠️ **yes — D1** | index writes only |
| Publish atomicity | ✅ one PUT | ✅ per-namespace | ❌ non-atomic bulk | ✅ |
| Scale headroom | ✅ unbounded | ⚠️ 20 M vectors/index | ⚠️ 10 GB DB cap | ✅ |
| Cost at this corpus | ~free | ~$0.31/mo + $6 one-time | ~free | ~$0.31/mo |

**Recommendation: (d) — lexical over one book's pack as the default path, with
Vectorize as a semantic layer namespaced per book, and Vectorize-without-filter
as the cross-book path.**

The reasons, in order:

1. **The query pattern is book-scoped, so the cheap path is the common path.**
   A literal scan over 515 KB in a Worker is single-digit milliseconds. Most
   questions never touch a vector index at all.
2. **LitRPG stat blocks are literal text** (§6). Embeddings are the *wrong*
   instrument for "find the block whose lines start with `Strength:`". Lexical
   is not a fallback here; it is the primary.
3. **Semantic recall is genuinely needed for the other half** — "what did the
   narrator think of her mother" has no keyword. One namespace per book keeps it
   scoped for free.
4. **D1 FTS5 is a good engine and the wrong home.** It works (D1 supports FTS5
   virtual tables), but it means a second write path from this machine into the
   estate's production database, a non-atomic bulk load of ~600,000 rows against
   a 30-second statement ceiling, and 100 bound parameters per query. It buys
   cross-book ranking that (b) already provides. **Named as the runner-up so the
   alternative does not have to be rediscovered.**

### 3.3 Vectorize, sized against its published limits

*Vendor figures read 2026-08-18 from Cloudflare's Vectorize limits and pricing
pages.* ⚠️ **Chunk size is no longer assumed — §7.3 now carries a measured
recommendation of 800 chars / 100 overlap with a ±1-neighbour return span**, and
that roughly doubles the vector count against the 1,500-char figure this table
was originally built on. Both are shown; the 800 column is the one to plan
against.

| Limit | Published | @1,500 chars (old assumption) | @800 chars (**measured recommendation**) | Verdict |
|---|---|---|---|---|
| Vectors per index | 20,000,000 | ~603,000 | **~1,105,000** (ebooks 95 k + transcripts 1,010 k) | 6% used |
| Dimensions per vector | 1,536 max | 1,024 (bge-m3) | 1,024 (bge-m3) | fine |
| **Namespaces per index** | **50,000 paid / 1,000 free** | **1,073 books** | **1,073 books** | ⚠️ **exceeds the FREE tier** |
| Metadata per vector | 10 KiB | ~200 B | ~200 B | fine |
| Metadata indexes | 10 | 3 (`ord`, `chapter_index`, `source`) | same | fine |
| topK with metadata | 50 | 6–8 | 6–8 | fine |
| Upsert batch | 1,000 (Workers) | batch at 1,000 | batch at 1,000 | fine |

*The 800-char vector count is **reasoned** arithmetic on a **measured** chunk
count: books 1–3 of Primal Hunter chunk to 1,598 chunks/book at 800/100 versus
872 at 1,500/200 — a 1.83× multiplier applied to this table's original figures.*

⚠️ **1,073 books against a 1,000-namespace free-tier ceiling is a real
tripwire and it is already crossed.** The estate is on Workers Paid ($5/mo,
owner-approved 2026-08-17 per `gabi-application-map.md` §4.3), so 50,000
applies and there is 46× headroom — but the design must not be built on the
free tier, and a future session must not "simplify" by dropping to it.

**Cost** (*vendor rates, arithmetic reasoned*):

| Line | Calculation (at the measured 800-char chunking) | Cost |
|---|---|---|
| Storage | 1,105 k vectors × 1,024 dims × $0.05 / 100 M | **$0.57 / month** |
| One-time index build | 1,131 M dims × $0.01 / 1 M | **$11.31 once** |
| Queries (household scale, ~500/mo) | 500 × 1,024 dims × $0.01 / 1 M | **< $0.01 / month** |
| Embedding, whole corpus (`@cf/baai/bge-m3`, $0.012/M input tokens) | 210 M tokens | **$2.52 once** |

**The entire semantic layer costs about fourteen dollars to build and fifty-seven
cents a month to keep.** The expensive part of this project is not retrieval, and
halving the chunk size did not change that — it moved the bill by eight dollars
once and twenty-six cents a month. ⚠️ **Do not let this cost line argue for
larger chunks; §7.3 measured what larger chunks cost in answers.**

### 3.4 The answer model, and one inherited trap

Rates read from the Anthropic API reference, 2026-08-18. Token counts are
bytes ÷ 4 estimates, **not** `count_tokens` measurements.

A grounded answer carries ~6 chunks × 1,500 chars ≈ 9 KB ≈ 2.3 k tokens, plus
system ≈ 1 k, plus a short output.

| Model | Input $/MTok | Per answer (~3.5 k in / 400 out) |
|---|---:|---:|
| Haiku 4.5 (what the mention loop is pinned to today) | $1.00 | **~0.55¢** |
| Sonnet 5 | $3.00 ($2.00 intro through 2026-08-31) | ~1.25¢ |
| Opus 5 | $5.00 | ~2.0¢ |

⚠️ **Do not repeat the docs assistant's model recommendation without reading
why it failed there.** `gabi-docs-assistant-design.md` §5.3 recommended a
Sonnet-class model for docs turns; §11.7 records that it **was not adopted and
could not be as written**, because the tools compose into the existing
conversation loop and the model must be chosen before anyone knows whether the
turn will touch a book — and because `CHAT_MAX_TOKENS` is 400 while Sonnet 5
runs adaptive thinking by default, sharing that ceiling with the response. The
same two facts apply here verbatim. **Ship on the pinned Haiku and revisit with
retrieval-quality evidence, not by flipping the id.**

⚠️ **Prompt caching will not help the retrieved text and must not be aimed at
it.** Minimum cacheable prefix is 4,096 tokens on Haiku 4.5 (512 on Opus 5,
1,024 on Sonnet 5), and the retrieved passages are volatile by construction. Any
`cache_control` breakpoint belongs on the system prompt, *before* the passages,
or nothing caches at all.

---

## 4. The retrieval and scoping contract

### 4.1 ⚠️ Spoiler safety is a first-class axis, not a filter bolted on

This is the one place where a plausible-looking implementation causes real harm
that no error message reports. A person mid-way through book 12 who asks a
clarifying question and gets an answer sourced from chapter 48 has had the book
spoiled, silently, by a feature built to help them enjoy it.

So scoping is **part of the retrieval contract**, enforced where the chunks are
selected, and never left to the model's discretion.

### 4.2 What the position store already provides

From `reading-position.js` (LOCAL; header read 2026-08-18) and
`audio-player-design.md` §7.4:

```
readingPositions/{uid}_{bookId}   (and readingPositions_dev in the /dev/ lane)
{ uid, bookId, format: "epub"|"pdf"|"audio",
  pos: { kind: "cfi"|"page"|"audio", value: … },   // kind travels WITH value, atomically
  progress: 0.0–1.0, anchor: "b-…", updatedAt, device }
```

⚠️ Three properties of this store are load-bearing and must not be re-derived:

1. **The key is `bookIdFromTitle(title)`, NOT the anchor.** The anchor is
   `sha256(relative path)[:12]` and changes when a file is re-filed. Chunk packs
   are therefore keyed on `bookId` too, so a position and a pack always agree.
2. **`pos.kind` travels with `pos.value` atomically**, and `firestore.rules`
   refuses a document whose `pos` has no `kind`. A CFI read as a page number is
   a silent jump to the wrong place — the scoping code must switch on `kind`,
   never guess from the value's type.
3. **A CFI is a persisted key produced by a specific renderer** (foliate-js at a
   pinned commit). §4.4 is where that bites.

### 4.3 The scoping contract

Every chunk carries `ord` — its 0-based position in reading order. Scoping
reduces to one comparison:

```
visible(chunk) ⟺ chunk.ord ≤ ceiling
```

Three modes, and the mode is **always stated in the answer**:

| Mode | When | `ceiling` |
|---|---|---|
| `whole_book` | the question names an endpoint ("at the end of book 12"), or the asker's progress is 1.0, or the book is in their finished list | `∞` |
| `up_to_position` | **the default** whenever a position exists for `(uid, bookId)` | derived below |
| `unscoped` | explicit per-turn consent only (§4.5) | `∞` |

**Deriving `ceiling` from `pos`:**

| `pos.kind` | Derivation | Fidelity |
|---|---|---|
| `audio` `{chapter, offsetSec}` | `chapters[chapter]` → its `first_chunk..last_chunk` range; interpolate within it by `offsetSec ÷ chapter_duration` | ✅ **best** — this is what exact-seconds `chapters.json` buys |
| `page` (PDF) | last chunk whose `page ≤ value` | ✅ exact |
| `cfi` (EPUB) | ⚠️ see §4.4 | ⚠️ chapter-grained at best |
| *(fallback)* | `floor(progress × chunk_count)` | ⚠️ coarse but monotonic |

⚠️ **When in doubt, round DOWN.** An answer that stops one chapter short of
where the reader is costs a follow-up question. An answer that runs one chapter
long costs them the book.

⚠️ **DERIVE the ceiling every turn. NEVER store one, never cache one, never let
one cross a re-ingest.** Measured 2026-08-18, and it bit the pilot on the first
try: an `ord` is only meaningful relative to the chunking that produced it. The
same number **405** in book 2 is *end of chapter 32* at 1,500/200, *chapter ~15*
at 800/100, and *chapter ~60* at 3,000/300 — so a ceiling carried across a
re-chunk **silently changed what the reader was allowed to see, and at the larger
chunk size it leaked twenty-eight chapters of book 2 past the intended
position.** ⚠️ **The failure direction is toward spoiling, it produces no error,
and nothing in the answer looks wrong.** The rule that makes it safe is already
in this section — derive the ceiling from `pos` (`kind` + value) through the
chapter table each turn — so the only thing to add is the prohibition: **no
component may persist a computed `ord` ceiling**, and §7.5's `ingester_version`
must be checked before a pack and a position are used together.

### 4.4 ⚠️ The CFI problem, stated plainly because it is the design's weakest joint

A CFI is not comparable to a chunk ordinal without the renderer that produced
it. `epubcfi(/6/14!/4/2/6,/1:0,/1:120)` encodes a spine step, then a path into
that document's DOM — and the chunker's ordinals are derived from *extracted
text*, not from foliate's DOM.

**The joint that does work: the spine index.** The leading path component
(`/6/14` → the 7th spine item) identifies **which EPUB document** the reader is
in, and the chunker knows which chunks came from which spine document. So:

> **Store `spine_index` on every EPUB chunk at ingest time, and map a CFI to a
> ceiling by spine document, not by character offset.**

That gives **chapter-grained** scoping for EPUBs — good enough, because the
spoiler risk is measured in chapters, not sentences. Sub-document precision
would require running the same renderer server-side and is explicitly out of
scope.

⚠️ **This is a persisted-key hazard by the estate's own rule.** `spine_index` is
derived from the EPUB's spine order; re-ingesting a book with a different
extractor that orders documents differently is a **migration**, not an edit.
Pin the spine ordering rule in the ingester's header and record
`ingester_version` in every pack.

### 4.5 What a person hears when the answer is past their position

⚠️ **Never a bare refusal, never a silent trim, and never a hint at the
content** — the estate's no-bare-status rule, applied to the one case where
leaking the *shape* of the answer is itself the harm.

| Situation | What she says (shape, not final copy) |
|---|---|
| Answer needs content past the position | *"That's past where you are — you're about 40% through book 12, and the answer comes later. Want me to tell you anyway?"* ⚠️ **Requires an explicit yes, per turn, never remembered across turns.** |
| No position stored for that book | *"I don't have a bookmark for you in that one, so I don't know how far you've got. Have you finished it, or should I keep to the early chapters?"* ⚠️ **Absence of a position means UNKNOWN, never "unread" and never "finished".** |
| Position exists, answer is within it | Answer, and say the scope: *"…as of where you are, about chapter 19."* |
| Book owned but not ingested | *"I have that one on the shelf but I haven't read it yet — I can tell you what the catalogue knows (narrator, length, series order) but not what happens in it."* |
| Book not owned | the existing `/have` sentence — ⚠️ *absence means "not in the catalogue", never "not owned"* |
| Asker not linked / not permitted | the ebook gate's existing worded refusals, unchanged |

⚠️ **Scope is per-person and GABI borrows it, exactly as she borrows
permissions.** A Discord question resolves the asker's `uid` through
`discord_links/{discordUserId}.firebaseUid` — the same chain door B uses for
docs. Two people reading the same book get two different answers to the same
question, and that is correct.

### 4.6 The tool surface

Two tools, both read-only, in **their own array** — a fourth alongside
`GABI_TOOL_NAMES` (T0 public catalogue), `GABI_DELEGATED_VERB_NAMES` (T1
writes), and `GABI_DOCS_TOOL_NAMES` (gated docs):

| Action | Does |
|---|---|
| `search_book_text` | `{bookId, query, mode?}` → up to N passages within the asker's scope, each `chapter §heading` + snippet + `ord`. ⚠️ `mode` ∈ `relevant`\|`latest`\|`earliest`\|`presence` (§6.2) — and `presence` returns a per-book roll-up, **not** passages |
| `read_book_passage` | `{bookId, ord}` → that one passage, capped |

⚠️ **A fourth array, for the reason §11.5 of the docs design gives.** What
separates these tool families is *what they read*: T0 reads
`public_audiobook_catalogue`, the docs tools read `gated_estate_docs`, and these
read `gated_book_text` — a surface scoped **per person by reading position**,
which neither of the others is. Merging them would delete that claim and hand a
model an unscoped book surface on every turn of every conversation.

⚠️ **`toolsForApi()` with no argument must continue to return Tier 0 and
nothing else**, pinned by test. Only a caller that has checked the posture *and*
resolved the asker's identity passes `{ books: true }`.

**Caps** (reasoned; re-measure after a week of real use):

| Cap | Value | Why |
|---|---|---|
| Passages per search | 6 | |
| One passage | 4 KB | |
| Retrieved bytes per turn | 24 KB, ≤6 passages | ≈6 k tokens — same envelope the docs budget already proved |
| Book turns per person per UTC day | `GABI_BOOKS_TURNS_PER_DAY`, default 40 | a **fourth** DO counter, additional to the existing three |
| Posture | `GABI_BOOKS`, affirmative-only `"on"` | ships dark |

⚠️ **The per-turn budget REFUSES rather than trims**, and the refusal says *the
passage was NOT read* — the docs build's rule, and it matters more here: a
silently truncated passage is a plot point missing the sentence that mattered.

---

## 5. PHASE 1 — the ponder question

**This is the first thing built, and it needs no ingestion at all.** It is the
half of the owner's brief that can ship in days rather than months, and it
degrades gracefully in exactly the direction the project grows.

### 5.1 The ask

> *"maybe we add a feature where i say, im reading x book, give me a question
> about it to help me ponder."*

### 5.2 The precedent that already exists

`audiobook_catalog/site/discussion_prompts.json` already holds chapter-indexed
ponder questions — *measured*: **3 books**, each `{prompts: [{chapter_index,
question}]}`, e.g. for *Lessons in Chemistry*: *"Six-Thirty the dog is given his
own inner life and even chapters from his perspective. How does this narrative
choice affect the tone of the novel…"*

That file **is** this feature, hand-built, for three books. Phase 1 is the same
thing, generated live, position-aware, for 1,079.

### 5.3 The three grounding tiers — and why the weakest one still works

| Tier | Available when | Grounding | Quality |
|---|---|---|---|
| **A — catalogue-grounded** | **immediately, for all 1,079 titles** | title, author, series + index, genre, narrator, chapter TITLES from `chapters.json`, description, content warnings, universe | surprisingly good — chapter titles alone carry a lot of a book's shape |
| **B — position-aware** | immediately, wherever a position exists | tier A + *"you're in chapter 19 of 41"* | good — the question can be about what they've just met |
| **C — content-grounded** | once that book is ingested | tier A + the actual passages up to their position | best |

⚠️ **The graceful degradation must be visible, not silent.** A tier-A question
is honest about being about the book's *shape*; a tier-C question quotes it. She
says which she is doing — *"I haven't read this one myself yet, so this is from
what the catalogue knows"* — rather than producing a confident question about a
book she has never seen. This is the same rule the docs assistant learned twice:
**absence is reported as absence.**

### 5.4 Shape

```
"I'm reading The Way of Kings"      →  resolve via existing T0 catalogue tool
                                    →  read readingPositions/{uid}_{bookId}
                                    →  tier C if ingested, else B, else A
                                    →  ONE question, 1–2 sentences, open-ended
```

Design rules, each with a reason:

- **One question, not a list.** The owner asked for *a* question to ponder. A
  menu is a different feature and defeats the purpose.
- **Open-ended, never factual recall.** *"What does X's choice cost him?"* not
  *"What is X's class?"* — pondering, not a quiz.
- ⚠️ **Absolutely no content past the position** (§4.3). A ponder question is
  the single easiest way to spoil a book, because a good question about chapter
  40 *reveals that chapter 40 exists and what is in it.* The scoping contract is
  not optional here; it is the feature's safety property.
- **Optionally persist what she asked**, so a second ask on the same book that
  day doesn't repeat. Reuse the conversation window rather than adding a store —
  or, if it must persist, one document per `(uid, bookId)` with a rolling list
  of recent question hashes.
- ⚠️ **Never write into `discussion_prompts.json`.** That file is the *book
  clubs* feature's curated, human-reviewed asset. A live-generated question is a
  different thing with a different audience, and merging the two would put
  unreviewed model output into the club flow.

### 5.5 Effort

**Small–medium (~150 k).** One tool added to the mention loop, one position
read, one prompt, worded fallbacks, the tier statement. No bucket, no ingestion,
no new gate.

---

## 6. PHASE-6 ACCEPTANCE TEST — the stat-sheet class

The owner's Primal Hunter question is not one test; it is a **class** of
question the design must be able to answer, and it is chosen well because LitRPG
makes the hard part legible.

### 6.1 Why this class is tractable — the stat block is literal text

LitRPG stat sheets are recurring set-piece blocks of highly regular text:

```
Name: Jake Thayne
Race: [Human (D)]
Class: [Avaricious Arcane Hunter of the Malefic Viper (A)]
Level: 175
Health: … / Stamina: … / Mana: …
Strength: … / Agility: … / Perception: … / Willpower: … / Intelligence: …
Free Points: …
```

That is not a semantic-search problem. It is a **regex-and-ordinal** problem,
and it is exactly what the lexical primary path (§3.2) is for.

### 6.2 How retrieval finds "current at the end"

| Step | What happens | Instrument |
|---|---|---|
| ① Resolve | "book 12 of Primal Hunter" → `bookId` | existing T0 catalogue tool (*measured: the title exists, 20:07, Baldree*) |
| ② Scope | the question says **"at the end of"** → `whole_book` | §4.3 mode selection |
| ③ Detect | score every chunk by **count of distinct stat-key lines matched** by an anchored family: `^\s*(Name\|Race\|Class\|Level\|Profession\|Health\|Stamina\|Mana\|Strength\|Agility\|Perception\|Willpower\|Wisdom\|Intelligence\|Toughness\|Free Points)\s*[:\-–]` | lexical, in-Worker |
| ④ **Select by ORDINAL, not by score** | take the **highest-`ord`** chunk above the detection threshold | ⚠️ **the key insight** |
| ⑤ Answer | quote the block verbatim, name its chapter, state the scope | prompt contract |

⚠️ **Step ④ is where a naive implementation gets this wrong.** Ordinary
relevance ranking returns the *best* stat block — which is usually the most
complete one, often an early-book baseline. *"Current at the end"* means **last
in reading order**, and that is a different sort. The tool must expose
`mode: "latest"` alongside `mode: "relevant"`, and the model must be told which
questions take which.

⚠️ **MEASURED 2026-08-18: `latest` is not enough — there are FOUR modes, and two
of them are ordinal sorts that relevance ranking cannot approximate.** The pilot
put a question to the lexical path that looks trivial and is not: *"where does
Jake first meet Casper?"*

| Mode | Question shape | Pilot result |
|---|---|---|
| `relevant` | "what happened when X" | the workhorse; 6/9 in the pilot |
| `latest` | "current at the end of book N" | ✅ top-1 correct, all chunk sizes |
| **`earliest`** ⭐ **NEW** | "where does X **first** appear / first meet / get introduced" | ✅ top-1 correct, all chunk sizes |
| **`presence`** ⭐ **NEW** | "**which books** mention X" | ✅ correct; `relevant` was wrong |

⚠️ **`relevant` ranked the true first-meeting passage at 34th–60th of 200** —
against a top-6 cap that is a total miss, at every chunk size. The reason is
structural, not a tuning problem: BM25 scores *density of mentions*, and a
character's first appearance is by construction their **least** dense mention,
usually one clause in a crowd scene. **`mode: "earliest"` — lowest `ord` among
chunks matching the term — returned it at rank 1 at every chunk size.** It is
the exact mirror of `latest` and costs the same nothing to implement.

⚠️ **`presence` needs a different RETURN SHAPE, not a different sort, and this is
the one place the top-K passage list is simply the wrong data structure.** Asked
*"which books mention Miranda"*, top-K returned six book-3 passages at every
chunk size and **silently omitted book 2, where she is introduced.** A per-book
roll-up — `{book, chunk_hits, first_ord, first_chapter, first_timestamp}` — is
free from a lexical index and answers it exactly:

```
miranda:  book 1 — absent
          book 2 — 60 chunks, first at ch 54 "Monsters" (16:37:16)
          book 3 — 231 chunks, first at ch 6 "City Lord" (1:27:19)
```

⚠️ **Vectorize does NOT fix this** (§3.2 assigns cross-book to it). A vector index
also returns top-K passages, so it inherits the same omission. `presence` belongs
on the lexical path, and it is the strongest argument in this document that
lexical is the primary and not the fallback.

### 6.3 Acceptance criteria — the class, not the one question

An implementation passes only if **all five** hold:

1. **The answer names the book and states the scope** — *"as of the last stat
   sheet in book 12, which is in chapter 47 of 52."*
2. **Every number is quoted from a retrieved passage.** No arithmetic, no
   inference, no filling a missing stat from an earlier book.
3. ⚠️ **If the last block is not at the literal end, the answer says so** rather
   than implying finality. *"That's the most recent one in the book — nothing
   after chapter 47 restates it."*
4. ⚠️ **It refuses to interpolate.** Two blocks at level 170 and 180 do not
   license "about 175 at the end."
5. **Asked mid-book by someone with a position, it scopes and says so** —
   proving §4 works, not just §3.
6. ⚠️ **NEW, from the pilot — the answer must verify that the question's key
   term actually APPEARS in a retrieved passage, and say so when it does not.**
   Retrieval never returns nothing: asked about a book-3 class evolution with the
   ceiling set at book 2 chapter 10, scoping correctly excluded every book-3
   chunk — and then handed back six plausible, on-topic, **wrong** passages about
   other class evolutions. ⚠️ **Server-side scoping is necessary and not
   sufficient**; a model told only "answer from these passages" will compose a
   confident answer out of near-misses. The contract must be *"if no passage
   contains what was asked about, say that it is not in what you can see, and say
   whether that is because it is past their position or because it is not in the
   book at all"* — and those two must be distinguishable, because one is a
   spoiler boundary and the other is a gap in the shelf.

### 6.4 ✅ The transcription hazard — MEASURED, and milder than feared

> **Status: RETIRED as a blocker, 2026-08-18.** The pilot ran: *The Primal
> Hunter* book 1 (20.17 h) transcribed end-to-end on the owner's RTX 4080 SUPER.
> Artifacts are local-only (`.claude/jobs/3473b22a/tmp/transcripts/`), never
> committed and never uploaded. **Verdict: RECOVERABLE.** Three of this
> section's four hazards did not materialise; one did, in a milder form.

**Measured throughput — the §7.4 estimate was 6–12× too pessimistic:**

| Quantity | §7.4 reasoned guess | **Measured 2026-08-18** |
|---|---|---|
| Rate, `large-v3` fp16, batch 8 | 30–70× derated | **85.3× realtime** |
| Book 1 (20.17 h) | 7–14 GPU-h *(for 277 h)* | **14.2 min wall clock** |
| Whole series (277.2 h) | "one night" | **~3.3 GPU-hours** |
| Whole corpus (14,804 h) | 15–31 days | **~7.2 GPU-days** |
| VRAM peak (batch 8) | unstated | **10.3 GB of 16 GB** |
| m4b → 16 kHz mono WAV | unstated | 46 s (1,590×) |

Batch 16 measured **102.6×** but peaked **12.8 GB** — rejected for concurrent
use of the machine. Batch 8 is the recommended setting.

**Hazard-by-hazard, against what this section predicted:**

- ❌ **"Numbers may arrive as words" — DID NOT HAPPEN.** Of **186** key→number
  pairs inside the 21 detected stat blocks, **186 were digits and 0 were number
  words** (100%). Whisper's own text normalisation emits digits for spoken
  numerals. **The error-prone `"one seventy-five"` → `175` normalisation pass is
  not needed** for this narrator/model pair. (Book-wide the digit share is only
  37%, but the number-words are ordinary prose — *"one of them"* — not stats.)
- ❌ **"The `^Key:` family will not match" — TRUE, but trivially repaired.** The
  block survives as a flat comma-separated run: keys in order, each followed by
  its value, e.g. *"Stats. Strength, 7. Agility, 8. Endurance, 7."* A
  speech-tolerant detector — `\b(key)\b[\s,.:;-]*(\d+)`, scored by **count of
  distinct keys per segment** — found **22 candidate blocks across the book with
  zero tuning**, the strongest carrying 11 distinct keys. §6.2's step ③ needs the
  regex swapped, and nothing else.
- ⚠️ **"Whisper mis-hears proper nouns" — TRUE, and stable WITHIN a book but
  NOT across books.** ⚠️ **REVISED 2026-08-18** on books 2–3, which this bullet
  had not seen. Within one book a noun does collapse to one dominant variant, as
  claimed. Across books it does not, and an alias map authored once per *series*
  from book 1 will silently stop working:

  | Noun | Book 1 | Book 2 | Book 3 | Across books |
  |---|---|---|---|---|
  | *Thayne* | `Thane` ×21 | `Thane` ×7 | `Thane` ×15 | ✅ stable, 43/43 |
  | *Villy* | *(no mentions)* | `Vili` ×7 | `Vili` ×22, `Villy` ×7, `Villi` ×1, `Willy` ×1 | ⚠️ **variant shifts** |
  | *Sylphie* | — | — | `Sylphie` ×43, `Sylvie` ×6 | ⚠️ 12% minority tail |

  ⚠️ **So the alias map must be BUILT PER BOOK from that book's own transcript,
  not authored once per series** — book 3 alone splits *Villy* four ways, and a
  map derived from book 2 (`Vili` only) misses 9 of its 31 mentions.
  ⚠️ **A second, worse defect class the pilot found: mis-heard WORD BOUNDARIES
  inside proper nouns.** The species *Sylphian Ayas* is transcribed *"Sylphie and
  Ayas"* — which is not a spelling variant but a **meaning change**, silently
  converting a species name into two named entities joined by "and". An alias map
  cannot fix that; only a glossary `initial_prompt` or a human can.

- ✅ ⚠️ **"Letter grades are unreliable" — WITHDRAWN 2026-08-18. The original
  claim was a measurement error, and it was the strongest prohibition in this
  document.** This bullet previously read: *"the race grade rendered as 'human,
  G' where the text reads `Human (D)`. Letter grades are not reliably
  transcribed and must never be quoted as fact from audio."* **That comparison
  was invalid** — it compared an *early-book-1* stat block against the
  illustrative *book-12* sheet quoted in §6.1 (level 175, `Avaricious Arcane
  Hunter (A)`). Primal Hunter has **zero EPUBs** (§1.5), so there was no text to
  compare against; the "error" was Jake being G-grade in book 1, which is correct.

  **Re-measured across all 43 race-grade renderings in books 1–3, the letters are
  perfectly coherent and monotonic:** `G` ×11 (early book 1) → `F` ×5 (mid book
  1) → `E` ×22 (late book 1 through book 3 ch 57) → `D` ×2 (book 3 ch 58+). The
  transition points are independently corroborated by prose the transcript
  renders separately — *"level 99, the cap of E grade"* (bk 3 ch 40), *"you have
  undergone a perfect evolution to become a D grade human"* (bk 3 ch 58, the
  chapter is titled **"D-grade"**), and *"evolved to both F and E grade"* (bk 3).
  **Three independent renderings agree at every step of the ladder.**

  ⚠️ **What survives, narrowed:** a letter is only reliable where the narrator
  gives it *context* — `"D grade human"`, `"the cap of E grade"`. A truly bare
  spoken letter with no neighbouring word remains unverified here, because this
  narrator never reads one. **So the rule is not "never quote letter grades" but
  "quote a letter grade only from a passage that spells out what it grades" —**
  and that is a rule the answering contract already enforces, since §6.3 criterion
  2 requires every value to be quoted from a retrieved passage.

  ⚠️ **The general lesson is worth more than the specific correction: a
  transcription "error" measured against a source the estate does not possess is
  not a measurement.** Glossary prompting remains worth doing but is an accuracy
  nicety, not a precondition — a per-book alias map (`Thane`→`Thayne`) fixes
  retrieval at a fraction of the cost.
- ✅ **"Store BOTH views" — STILL RIGHT, for a different reason.** Not because
  numbers need normalising, but because proper nouns need aliasing. Raw text is
  what GABI quotes; the alias-normalised view is what the detector scans.

**Bonus finding — §7.4's timestamp warning is WRONG and should be relaxed.**
That section says Whisper's segment times "drift" and must never be trusted over
`chapters.json`. Measured against the container's exact table across **69 of 73
chapters**: the narrator's spoken *"Chapter N"* lands at **mean +0.27 s**
(stdev 0.10 s, range −0.04 s to +0.54 s) from `start_sec`, with **no
accumulation** — first half +0.26 s, second half +0.29 s over 20 hours. Word
timestamps are accurate enough to **cut chunks at chapter boundaries directly**.
`chapters.json` stays the anchor of record, but the reconciliation §7.4 demands
is a sub-second correction, not drift management.

⚠️ **What this pilot did NOT establish:** one book, one narrator
(Travis Baldree), one series, English, clean studio audio, no `initial_prompt`
glossary (baseline deliberately unmitigated), and **no accuracy ground truth** —
no ebook twin exists for Primal Hunter, so WER is unmeasured and the numerals
were verified as *well-formed*, not as *correct*. Multi-narrator, accented, or
older recordings remain unmeasured.

---

## 7. The ingestion pipeline

### 7.1 Where it runs

⚠️ **On the owner's machine**, like every bulk job in this estate. The ebook
files are here (`C:/Users/nbasl/OpenAudible/books`), the audio is here (630 GB),
the GPU is here. Nothing about this belongs in CI or in a Worker.

### 7.2 EPUB → text — measured, and simpler than expected

**138 EPUBs extracted in 5 seconds using only the Python standard library**
(`zipfile` + a tag-stripping regex over the spine's XHTML documents). No
`ebooklib`, no `lxml`, no vendored renderer.

⚠️ **That is a measurement, not a recommendation to ship a regex.** For
production, read the OPF spine for *document order* (a `sorted(namelist())` walk
happens to work on this shelf and will not on all EPUBs), and prefer a real
parser (`BeautifulSoup`, already installed here) for entity handling and
block-level whitespace. The measurement's point is the **cost class**: whole-shelf
re-ingestion is seconds, so re-ingesting is cheap and versioned re-runs are free.

⚠️ **Do not reuse foliate-js server-side.** It is vendored for the *reader*, and
§4.4 explains that CFI comparability is achieved by spine index, not by running
the same renderer twice.

### 7.3 Chunking — chapter-anchored, and audio-aligned where a twin exists

> ✅ **TUNED 2026-08-18** against Primal Hunter books 1–3 (58.4 h of transcript,
> 205 chapters, 3.79 M characters) in a scratch harness — see §7.3.1. The
> 1,500/200 figure was a guess and it **loses answers**; the recommendation below
> is measured. ⚠️ Chunking is a persisted-key decision (§10): change it before
> phase 2 ships, not after.

1. **Split at chapter boundaries first.** For EPUBs, spine documents and their
   headings; for transcripts, `chapters.json`'s exact `start_sec` table.
   *Measured: word-level Whisper timestamps land the cut on the spoken "Chapter
   N" for **201 of 205** chapters; the other 4 have no spoken marker at all and
   fall back to the container's `start_sec`, which is exact anyway.*
2. **Then split long chapters** into **~800-character chunks with ~100
   characters of overlap**, and **return the matched chunk stitched together with
   its ±1 neighbours** (de-overlapped, ~2,160 chars) as one passage.
   ⚠️ **Index small, return wide. These are two different numbers and the design
   previously conflated them into one.**
3. **Never split across a chapter boundary.** A chunk that straddles two
   chapters cannot be scoped and cannot be cited. *(The ±1 expansion in step 2
   must not cross one either — clamp it to the chapter's `first_chunk..last_chunk`
   range.)*
4. ⚠️ **Where a book has both an ebook and an audio twin, align them** — carry
   `start_sec`/`end_sec` onto the text chunks from `chapters.json`. This is the
   payoff the exact-seconds table was built for: **an audio listener's position
   then scopes the EBOOK's text**, so a book with an EPUB twin never needs
   transcribing to be answerable for a listener. *Measured: 67 titles / 1,175
   hours qualify today.*

#### 7.3.1 ⚠️ Why 800/100 and not 1,500/200 — the measurement

Three axes were measured across 800/100, 1,500/200 and 3,000/300 (and 2,000/400
and 1,500/450 as controls). **They do not agree, and the design's single global
chunk size cannot satisfy them at once — which is why the answer is a small index
with a widened return span rather than a bigger chunk.**

**(a) Block integrity — bigger is better.** A LitRPG stat sheet is a **298–421
character** atomic block (mean 369; 18 full sheets in books 1–3, *measured*). If
a chunk boundary lands inside it, the top-1 result carries stat lines with no
Name/Race/Class/Level header. Measured over 8 chunk phases × 17 sheets = 136
trials per setting:

| setting | stat sheets whole in ONE chunk | index chunks / book |
|---|---:|---:|
| 800 / 100 | **75.7%** | 1,598 |
| 1,500 / 200 *(the old guess)* | **94.9%** | 872 |
| 3,000 / 300 | 99.3% | 438 |
| 2,000 / 400 | **100%** | 707 |
| **800 / 100, returned ±1 neighbour** | **100%** | 1,598 |

⚠️ **The governing parameter is the OVERLAP, not the size.** A block of length
*L* is guaranteed whole in some chunk **iff overlap ≥ L** — confirmed: every
setting with overlap ≥ 450 hit 100% at every chunk size, and every setting with
overlap < 450 lost sheets. The design's 200 was under the 421-char worst case,
so **1 sheet in 20 arrives decapitated** — including, in the real pack, Jake's
book-2 chapter-48 sheet, split across two chunks with the header in one and
Willpower in the other.

**(b) Retrieval precision — smaller is better.** Over the 9 relevance-mode pilot
questions, "right passage in the top 3":

| setting | top-3 hit rate |
|---|---:|
| **800 / 100** | **6 / 9** |
| 1,500 / 200 | 4 / 9 |
| 3,000 / 300 | 4 / 9 |

The losses at 1,500 and 3,000 are the same failure twice: a passage that states
the fact in one sentence gets diluted by a chunk full of other prose, and BM25
ranks a longer chunk that merely mentions the terms more often. *"What is Jake's
hawk called"* is answerable from the 800-char top-2 (which contain the words
"this is Sylphie") and **not** from the 3,000-char top-3, which retrieve the
right chapter and never state the name.

**(c) Citation precision — smaller is better.** A chunk can only be cited at its
own start, so the cited audio timestamp lands early by half a chunk on average
(*measured over 299 sampled phrases per setting*):

| setting | median cited-timestamp error | mean chunk duration |
|---|---:|---:|
| 800 / 100 | **27.5 s** | 49.4 s |
| 1,500 / 200 | 49.9 s | 91.0 s |
| 3,000 / 300 | 102.2 s | 173.7 s |

⚠️ **At 3,000 chars a "jump to this moment" link puts the listener ~1.7 minutes
early**, which for a spoiler-scoped feature is the wrong direction to be wrong in.

**The synthesis, and why it is not a compromise.** Indexing at 800/100 and
returning the hit stitched with its ±1 neighbours scores **100% block integrity
(a), 800-char retrieval precision (b), and 28-second citation precision (c)** —
it is the best available on all three axes at once, not a midpoint between them.
The returned span (~2,160 chars) sits inside §4.6's existing 4 KB-per-passage cap,
and 6 × 2,160 = 13 KB is inside the 24 KB-per-turn cap. **No cap needs changing.**

### 7.4 Transcription — on demand, per series, never as a bulk sweep

Two viable paths, both costed:

| Path | Rate | Whole corpus (14,804 h) | Primal Hunter (277.2 h) |
|---|---|---:|---:|
| **Workers AI** `@cf/openai/whisper-large-v3-turbo` | $0.0005 / audio-minute *(vendor, read 2026-08-18)* | **$444** | **$8.32** |
| **Local**, RTX 4080 SUPER (16 GB) + Ryzen 9 7950X3D + 64 GB *(hardware measured on this machine)* | electricity | 370–740 GPU-hours ≈ **15–31 days** continuous | 7–14 GPU-hours ≈ **one night** |

*Local throughput is reasoned from published `faster-whisper large-v3-turbo`
benchmarks (30–70× realtime batched on 4090-class hardware), derated for a
4080 SUPER. **No transcription has been run on this machine.***

⚠️ **Recommendation: on-demand, series at a time, local first, Primal Hunter
first** — because it is the owner's own acceptance test *and* it is the largest
audio-only series with zero ebook coverage.

Three mitigations that shrink the bill by construction:

1. ⚠️ **Skip any book whose ebook twin already gives text.** *Measured: 1,175
   of 14,804 hours are already covered by an EPUB.* Transcribing them would
   produce a worse copy of text the estate already has.
2. **Transcribe on request.** A question about an untranscribed book returns the
   worded "haven't read it yet" refusal and **enqueues** the book. The existing
   `audio_requests` queue and its pipeline fulfiller (`audio-player-design.md`
   §0b) are the exact precedent — same shape, different payload.
3. **Series-granular, not book-granular.** Nobody asks about book 12 alone; they
   ask about the series. Enqueue the series.

⚠️ **Whisper's segment timestamps are the transcript's `start_sec`, and they
must be reconciled with `chapters.json`, not trusted over it.** `chapters.json`
comes from the m4b container and is exact; Whisper's segment times drift. Anchor
each chapter's transcript to the container's `start_sec` and let segment times
position chunks *within* the chapter.

### 7.5 Idempotence, receipts, and the growth tripwire

Inherit the docs publisher's contract, including the defect it found:

- ⚠️ **Hash the CONTENT, not the artifact.** The docs build shipped a sha-skip
  over the *gzipped bundle*, which carries `generated_at` and therefore changed
  every run — re-PUTting 1.2 MB forever while printing "no change". Hash
  `{book_id, source_sha256, ingester_version, chunk texts}` and nothing else.
- **A receipt per run**, diffed against the previous: `+3 books, -0 books`.
- **Per-book WARN above 5 MB of text** (nothing on the shelf approaches it — the
  measured maximum is 3.2 MB) and **REFUSE above 20 MB**, pointing back at this
  section.
- **`--dry-run` and `--force`**, mirroring `publish_ebooks_manifest.py`'s flags
  verbatim.

---

## 8. Privacy, licensing, and posture — stated honestly

**What this is:** personal-use analysis of files the household lawfully owns,
stored in a private bucket, gated to the household by the same grant that gates
the files themselves, and never redistributed.

| Property | Commitment |
|---|---|
| Source | files the estate owns, already on this machine and already in private R2 |
| Derived text | ⚠️ **as sensitive as the source** — it is the book, chunked. Same bucket, same gate, same posture |
| Public URL | ⚠️ **never.** No `r2.dev`, no custom domain. Verify with `npx wrangler r2 bucket dev-url get <bucket>` — must say **disabled** |
| Gate | the estate's **`vis_ebooks`** grant — the same one the byte stream uses (§9 decision 3) |
| Redistribution | none. No public search, no export, no sharing a passage outside the gate |
| Third-party processing | ⚠️ passages **do** leave the estate: they go to the answering model as prompt input, and (if Workers AI is used) audio goes to Cloudflare for transcription. This is a real disclosure and is stated rather than glossed |
| Retention | chunk packs live until re-ingested. Retrieved passages are **never** written to the conversation window or the log stream — only *how much* was retrieved (the docs build's rule, and here it protects copyrighted text as well as privacy) |
| Reading positions | ⚠️ already the household's most personal data in this estate. This feature *reads* them and must never widen who can see them: GABI answers for the asker, from the asker's position, and never reports one person's position to another |

⚠️ **The owner's standing directive applies with full force:** *"I don't want
people scraping my books."* Derived full text is a **more** attractive scrape
target than the files, not less — it is smaller, cleaner, and searchable. The
gate is the whole security story.

---

## 9. Phased plan

Effort classes use the estate's measured calibration (research ≈100 k, single
subsystem ≈280 k, multi-layer ≈470 k). ⚠️ **Every phase ends at a committable
boundary**, so a killed agent costs nothing beyond the phase in flight.

| Phase | What | Layers | Effort | Depends on |
|---|---|---|---|---|
| **1** | **The ponder question** (§5) — tiers A and B only. One tool, position read, worded tiers, `GABI_BOOKS` posture. **No ingestion, no bucket.** | 1 worker | **small–medium** (~150 k) | nothing |
| **2** | **EPUB ingestion.** `ingest_book_text.py` on this machine: spine-ordered extraction, chapter-anchored chunking **at the measured 800/100 (§7.3.1)**, `spine_index`, audio alignment where a twin exists, chunk packs + index to R2, receipt, sha-skip, `--dry-run`. **No Worker changes.** | 1 script, local | **medium** (~200 k) | owner: bucket/prefix decision |
| **3** | **Retrieval routes.** `GET …/book/{bookId}/search` and `…/passage`, behind the ebooks gate, position-scoped server-side. ⚠️ **Four modes, not one** — `relevant`/`latest`/`earliest`/`presence` (§6.2) — plus the **±1-neighbour return stitch** (§7.3) and the **derive-never-store ceiling** rule (§4.3). Testable in a browser before any Discord work. | 1 worker | **medium** (~200 k) | 2 |
| **4** | **The two GABI tools** (§4.6) + the fourth allowlist array and its pinning test, the caps, the spoiler wording, `gabi_turn` fields. **Ponder questions become tier C here.** | 1 worker | **medium** (~200 k) | 1, 3 |
| **5** | **Transcription, on demand.** Local Whisper runner, per-series queue reusing the `audio_requests` shape, chapter reconciliation against `chapters.json`, speech-tolerant stat detection, per-series ASR glossary. ⚠️ **Primal Hunter first.** | script + worker | **medium–large** (~300 k) + GPU time | 2, owner decision 4/5 |
| **6** | **The acceptance test** (§6) — `mode:"latest"`, the stat-block detectors, the five criteria as tests. | 1 worker | **small–medium** | 4, 5 |
| **7** *(optional)* | **Vectorize semantic layer.** One namespace per book, embeddings via `@cf/baai/bge-m3`, hybrid merge, cross-book search. | worker + script | **medium** | 3 |
| **8** *(optional)* | A gated `heygabi.ai/books/` search page on the same routes, mirroring `/docs/`. | 1 site | **small–medium** | 3 |

**Owner steps** (nothing below can be done from a session):

1. **Decide the bucket/prefix** (decision 2 below) and, if a new bucket, create
   it — then run `npx wrangler r2 bucket dev-url get <name>` and confirm
   **disabled**. ⚠️ Never attach a domain.
2. **Flip `GABI_BOOKS=on`** when phase 1 is verified — a deliberate act, never a
   side effect of a deploy.
3. **Phase 5 only:** install the local Whisper toolchain and confirm GPU
   throughput on one book before committing a series.
4. **Phase 7 only:** create the Vectorize index (Workers Paid required — §3.3).

**Review link, for when phase 8 lands:** `https://heygabi.ai/books/`. Before
that, the reviewable surface is Discord: *"I'm reading The Way of Kings, give me
something to ponder"* — check the reply names the tier it used and, if you have
a bookmark in that book, mentions where you are.

---

## 10. ⚠️ Limitations and what is NOT verified

**Measured facts** (this machine, 2026-08-18): every number in §1, the
words-per-audio-hour ratio in §1.3, the Primal Hunter zero-ebook finding, the
extraction wall-clocks, the PDF scan ratio, the GPU/CPU/RAM. **Everything else
is reasoned or vendor-published.**

- ⚠️ **NOTHING IS BUILT.** No script, no bucket, no prefix, no route, no tool,
  no chunk, no transcript, no vector.
- ✅ **RETIRED 2026-08-18 — one transcript now exists.** Primal Hunter book 1
  (20.17 h) was transcribed on this machine and the stat blocks inspected; see
  §6.4 for the measured verdict (**recoverable**; 85.3× realtime; numbers arrive
  as digits, not words; proper-noun variants are stable, not scattered).
  ⚠️ **Still unverified within it:** accuracy has **no ground truth** — Primal
  Hunter has no ebook twin, so WER is unmeasured; and one narrator, one series,
  one language is not the shelf. Letter grades (`Human (D)` → *"human, G"*) are
  measurably unreliable and must not be quoted from audio.
- ✅ **RETIRED 2026-08-18 — chunk size is now TUNED, and the guess was wrong.**
  1,500/200 loses **1 stat sheet in 20** to a boundary cut and scores **4/9** on
  top-3 retrieval where 800/100 scores **6/9**. The measured recommendation is
  **800/100 indexed, returned as the hit stitched with its ±1 neighbours**
  (§7.3.1): 100% block integrity, best retrieval precision, 28 s citation
  precision. ⚠️ **Chunking remains a persisted-key decision** — every `ord` and
  every vector depends on it, so re-chunking is a migration, not an edit —
  **which is exactly why this had to change BEFORE phase 2 ships.**
  ⚠️ **Still not measured for chunking:** prose without stat blocks (the tuning
  optimised for a 421-char atomic block that only LitRPG has), EPUB text (all
  three axes were measured on transcripts), and non-English or multi-narrator
  audio.
- ⚠️ **CFI → chunk mapping is chapter-grained at best** (§4.4) and has never
  been exercised against a real stored CFI.
- ⚠️ **Retrieval quality — MEASURED 2026-08-18, and the docs build's warning
  reproduced exactly.** A 12-question pilot over Primal Hunter books 1–3 scored
  **6/9 top-3 on relevance-mode questions** at the best chunk size, **9/12
  overall answered correctly with correct book+chapter attribution**, and
  **12/12 once `earliest` and `presence` modes were added** (§6.2). The failures
  were not close: the true passage sat at rank 34–60 of 200 for a
  first-appearance question. ⚠️ **Attribution was never wrong when retrieval
  succeeded** — no answer cited the wrong book or chapter — so the risk in this
  design is *misses*, not *false citations*.
  ⚠️ **What that pilot did NOT establish:** it is a **simulation**, not the live
  Worker — the same model family answering under the same grounding contract, in
  a scratch harness, with the retrieval hand-invoked. Lexical only, **no
  embeddings were built or tested**, so every claim about the semantic layer
  (§3.2 (b)/(d), §3.3, phase 7) remains entirely unmeasured. 3 books of 14, one
  series, one narrator, transcripts only, and the questions were written by the
  same session that graded them.
- **Token counts are bytes ÷ 4 estimates**, not `count_tokens` measurements. The
  per-answer cent figures inherit that error.
- **The 67-twinned figure is a loose title join** (§1.4) and understates
  twinning, which overstates the transcription bill in the safe direction.
- **Gzip ratios (30–40%) are assumed** from the docs corpus's measured 40.1%.
  Prose may compress differently from Markdown.
- **Local Whisper throughput is derated from third-party 4090 benchmarks.** No
  run on this hardware.
- **Vectorize and Workers AI rates were read 2026-08-18** and are vendor
  figures, not invoices.
- **The `discussion_prompts.json` overlap is unresolved as a product question**
  — three curated books vs. live generation for 1,079 (§5.4 keeps them apart;
  the owner may disagree).
- ⚠️ **`chapters.json` is currently PUBLIC** (46,659 chapter titles, tracked in
  git and served from the site — `audio-player-design.md` §7.3). This design
  reads it heavily and does not change that, but it makes the question more
  pointed: chapter titles are a fair description of a book's contents.

---

## 11. Owner decisions — ONE AT A TIME, in this order

Each carries a recommendation. Nothing in §9 should start before decision 1 is
answered; decisions 4–7 are not needed until phase 5.

**1. Do we build the ponder question FIRST, before any ingestion?**
It ships in days, needs no bucket and no transcription, works for all 1,079
titles at tier A/B immediately, and silently upgrades to tier C as books arrive.
→ **Recommend YES.** It is the half of the brief that is cheap, and it is the
half that gets used daily.

**2. Where do chunk packs live — a new bucket, or a `text/` prefix in
`ebooks-gated`?**
`audio-player-design.md` §884 already made this exact call for the audio
manifest and chose consolidation, reasoning that a fourth bucket is a fourth
privacy posture to keep verifying for no separation that was needed. The same
argument holds: derived book text is gated by the same grant as the book files.
→ **Recommend `ebooks-gated` with a `text/` prefix.** One gated bucket per one
book-files grant. (A new `estate-book-text` is the alternative if the owner
wants to be able to delete all derived text in one action.)

**3. Which grant gates it — `vis_ebooks`?**
The text is derived from files that grant already guards, and the audio
transcripts are derived from audio the same household owns.
→ **Recommend `vis_ebooks`, unchanged, no new grant.** A new grant is a new
thing to remember to revoke.

**4. Transcription: local GPU, or Workers AI?**
Local is free-but-slow (7–14 GPU-hours per Primal Hunter, one night) and keeps
the audio on this machine. Workers AI is $8.32 for the same series, needs no
toolchain, and sends the audio to Cloudflare.
→ **Recommend LOCAL as the primary, Workers AI as the burst/fallback.** The
hardware is already here, the estate already runs bulk jobs here, and it keeps
§8's third-party-processing disclosure smaller.

**5. Transcribe the whole corpus, or on demand?**
Whole corpus is $444 or ~15–31 days of GPU. On demand is $8.32 / one night for
the series the owner actually asked about.
→ **Recommend ON DEMAND, series at a time, Primal Hunter first.** With the
already-twinned 1,175 hours skipped by construction (§7.4).

**6. Spoiler default: scope silently and say so, or ask first?**
Scoping silently and stating the scope in the answer is one round-trip and never
leaks; asking first is safer but makes every question two turns.
→ **Recommend SCOPE SILENTLY + STATE IT**, with an explicit per-turn consent
prompt only when the answer genuinely needs content past the position (§4.5).

**7. Do the PDFs get OCR?**
25 of 30 are image-only scans; five carry 3.9 MB between them. OCR is a whole
subsystem (layout, hyphenation, page furniture) for ~30 books.
→ **Recommend NO for now.** Ingest the five that yield text, mark the other 25
**deliberately absent** in the index so she says *"that one's a scan — I can't
read it"* rather than returning nothing. Revisit if the owner names a specific
book that matters.
