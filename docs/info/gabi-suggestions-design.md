# GABI suggests a book — and asks WHICH SHELF first — design

> **Audience:** Claude sessions. **Status:** TRACKED. Written and BUILT
> **2026-08-18**.
> Owner ask, verbatim: *"I also need Gabi to give book suggestions and clarify if
> I want audio physical or ebook. For physical I only want her to suggest a
> physical book to a linked person who can view a book from the table she's
> suggesting"*

Siblings: [`gabi-personal-shelf-design.md`](gabi-personal-shelf-design.md) (the
reviews and TBR this composes from), [`gabi-book-knowledge-design.md`](gabi-book-knowledge-design.md)
(the `vis_ebooks` gate reused verbatim), [`gabi-personality-design.md`](gabi-personality-design.md).

---

## 1. ⚠️ THE SENTENCE CONTAINS A PERMISSION MODEL

The owner's ask reads as one feature and is three, because his second sentence
is a **gate** and it applies to exactly one of the formats:

| Format | Who may be suggested to | Why |
|---|---|---|
| **audio** | anybody, linked or not | drawn from `catalog.csv`, which `audiobooks.heygabi.ai` publishes to the open internet (`access-control-allow-origin: *`). Gating it would refuse somebody a fact the web hands to strangers |
| **ebook** | linked **and** granted `vis_ebooks` | the estate's existing per-asker ebook gate — **asked, never copied** |
| **physical** | linked **and** able to open the SHELF the row came from | ⚠️ his own words: *"a linked person who can view a book from the table she's suggesting"* |

⚠️ **THE PHYSICAL GATE IS ABOUT A TABLE, NOT ABOUT A BOOK.**
`library.heygabi.ai` and `padhard.heygabi.ai` are separate deployments with
separate D1 databases. Pointing somebody at a hardback in a house they have no
account on is not a privacy leak — it is worse in the way that matters to a
person: **an errand that ends at a shelf they cannot open.**

---

## 2. ⚠️ THE MEASUREMENTS THIS DESIGN RESTS ON

Taken **2026-08-18** by fetching the live CSV and reading the code that writes
it, not by asking.

### 2.1 The catalogue's cross-catalog join

| fact | measured |
|---|---|
| rows in `catalog.csv` | 1,079 |
| rows carrying a `library_formats` join | **84** — the older docs' "86" is stale by two |
| distinct format tokens | `Hardcover`, `Paperback`, `Ebook`, **pipe-separated** (`Hardcover\|Ebook`) |
| rows with a PHYSICAL format | **64** |
| rows with an ebook format | **50** |
| `library_work_id` | a **bare integer** — `233`, `3`, `27` |

⚠️ **THE ROW NAMES NO INSTANCE.** No prefix, no host, no discriminator. So the
join records *that* the library holds a print copy and never *which* library —
and `have.ts` already measured that the estate index cannot be widened per-asker
from Discord (it needs a Firebase ID token this Worker structurally cannot mint).

### 2.2 ⚠️ So the question was answered one level up, at the WRITER

| step | measured |
|---|---|
| `audiobook_catalog/app/library_link.py` | stamps the column from `GET <LIBRARY_MAPPING_URL>/api/machine/audiobook-mapping` |
| `audiobook_catalog/.env` | **`LIBRARY_MAPPING_URL=https://library.heygabi.ai`** |
| the route's home | `library_catalog/apps/worker/src/routes/audiobook-mapping.ts` — the **main** library's Worker |
| `padhard` | the **friend** instance, its own D1; the pipeline never reads it (`CREDENTIALS.md` §4.4 calls it "the friend library instance") |

**A print row in `catalog.csv` is the MAIN library's copy.** That is what makes
the gate expressible: `PHYSICAL_SOURCE_INSTANCE = 'library'`.

⚠️ **IF THAT ENV VAR EVER MOVES, THE CONSTANT IS WRONG AND THE FAILURE IS
SILENT FROM HERE.** It is one variable in another repo. The safe re-derivation
if the join ever spans both instances: require the asker to be known on **every**
instance — the default-deny form — because an unattributable row could then come
from a shelf they cannot open.

---

## 3. The gate, and what asks it

⚠️ **The gate is asked BEFORE anything is gathered.** Somebody who may not be
suggested a physical book must not have their reading list read in order to be
told so.

| Format | Mechanism | Refusal source |
|---|---|---|
| audio | none | — |
| ebook | `BooksPort.available()`, asked for its **status** | ⚠️ **403 = the estate's own relayed sentence.** 200 = pass. **Anything else = OUTAGE**, never a permission failure |
| physical | `DelegatePort.linkedUid()` then `whoami(library)` | `known: false` → the not-shared sentence naming the shelf and the sign-in URL. `null` → ⚠️ **unreachable, worded as ours** |

⚠️ **`known` is the right question and `capabilities` is not.** The Tier-1 router
asks about `editCatalog` because a write needs a capability; being able to *see*
a shelf is what having an account there means. A reader with no edit rights can
still walk to the bookcase.

⚠️ **NO NEW CREDENTIAL AND NO SIXTH TRUST EDGE.** Every port this lane uses is
one the Worker already builds. `suggest.ts` and `suggest-flow.ts` name no secret,
and the five-modules guard is untouched.

---

## 4. ⚠️ ONE CLARIFYING QUESTION, NOT A MENU

*"clarify if I want audio physical or ebook"* — asked **once**, in one sentence,
and skipped in two cases:

1. **the question already says it** (`formatAsked`) — only an EXPLICIT word
   counts. Inferring "physical" from *"something to take on the plane"* is a
   guess dressed as an understanding, and the cost of guessing wrong is the gate
   being applied to the wrong shelf.
2. **their tier-2 profile has learned it** (`formatFromProfileNotes`). ⚠️ **A
   PREFERENCE VERB IS REQUIRED, not merely a format word** — *"listened to PH 9
   last night"* is a reading claim, and treating it as a standing preference
   would silently stop asking somebody who never chose. When she goes on a
   learned preference she **says so in one clause**, so it can be corrected.

⚠️ **TWO NAMED FORMATS IS A COMPARISON, NOT A PREFERENCE.** *"audiobook or
paperback?"* is the person asking the clarifying question back; picking the first
silently is how a gate gets applied to a shelf nobody chose. It falls through to
the one question.

---

## 5. Quality — the ladder, in order

Composed **deterministically** from data read that turn, then handed to the model
as a closed list. Each rung carries its own one-clause WHY.

| # | Rung | The WHY it produces |
|---|---|---|
| 1 | ⚠️ **their own TBR** | *"it is already on your own reading list"* — an unmet intention outranks anything she thought of |
| 2 | ⚠️ **SERIES CONTINUATION — the star move** | *"you gave Words of Radiance 5 stars and this is the next one"* |
| 3 | same author of a well-rated book | *"you rated X 5 stars, and this is Sanderson too"* |
| 4 | same universe | *"same universe as X, which you rated 5"* |
| 5 | the shelf, with **no signal at all** | ⚠️ *"…and I have nothing else to go on yet"* |

**Exclusion:** anything the asker has **reviewed** is removed at every rung.

⚠️ **THE SERIES CONTINUATION IS THE STAR MOVE BECAUSE IT NEEDS NO TASTE MODEL.**
The evidence is their own rating and the shelf's own ordering — it cannot be
wrong about what they liked, only about whether they want more of it.

⚠️ **FOUR STARS IS THE THRESHOLD** (`LIKED_RATING`). A three is somebody being
polite, and building a recommendation on it is how she ends up suggesting more of
something they merely tolerated.

---

## 6. ⚠️ GROUNDING, ENFORCED IN THE DATA

> **Every suggested row came from a lookup made THIS turn.**

That is a property of the data rather than a hope about the prompt: the candidate
list is composed from the catalogue fetched this turn and the asker's reviews and
TBR read this turn, and `SUGGEST_NOTE` tells the model to suggest **only** from
it. A model shown a closed list of real rows cannot invent a twelfth Stormlight
book, because the row is not there to pick.

⚠️ **THE SHELF LANE'S HONESTY RULE RIDES ALONG, VERBATIM.** *"Not reviewed"* is
not *"unread"* — the estate has no read-state store on the audiobook side — so a
WHY clause may never say *"you haven't read this"*, and the note bans the words
"unread" and "backlog" outright. A suggestion is exactly where that would get
blurred.

⚠️ **A FAILED SHELF READ DOES NOT CANCEL THE ANSWER**, it changes it: the
suggestions are still real rows, but they are un-personalised and
`SUGGEST_SHELF_DOWN_NOTE` requires her to say so rather than imply she checked.
Without the CATALOGUE there is no answer at all, and that is worded as an outage.

---

## 7. Posture

`GABI_SUGGEST`, affirmative-only, **ships ON** — the `GABI_PERSONALITY`
precedent rather than the `GABI_BOOKS` one.

⚠️ The owner ordered the **outcome**, and this lane opens **no new corpus**: it
composes from the public catalogue plus the asker's own shelf, each already
switched on and already gated by its own posture. Flipping it grants nothing that
was not already granted. **The lever exists so there is a lever.**

⚠️ **OFF IS NOT SILENT.** She says suggestions are switched off, rather than
falling through to a catalogue search that finds nothing and reads as broken —
the lesson of the docs lane's §12 and the shelf lane's routing miss.

---

## 8. Routing

⚠️ **The FOURTH member of the `docsIntent` / `booksIntent` / `shelfIntent`
family, built to the same shape.** Its position is a decision at both ends:

```
memory control → persona pin → persona admin/query → docs → SUGGEST → shelf → books → shelf follow-up → classifyIntent
```

- **AFTER docs**, because `docsIntent` is the narrowest detector on this surface
  and an operational question that happens to contain "recommend" is still
  operational. The docs lane shipped first with its own regression tests.
- **BEFORE shelf**, because *"what should I read next"* is first-person and
  shelf-shaped and is nonetheless a request for a RECOMMENDATION. The shelf lane
  would answer it by reading the reading list back — a good answer to a different
  question.

---

## 9. What is deliberately NOT built

- **No per-book instance resolution.** §2 measured that the join cannot express
  it. The gate is per-INSTANCE and the source instance is a constant.
- **No writes.** She does not add a suggestion to a TBR; that is a Tier-1
  delegated verb with its own confirm lane.
- **No taste model, no embeddings, no "because people like you".** Every rung is
  a fact about this person's own ratings.
- **No cross-household suggestions.** One estate.
- **No panel surface.** Discord first, as every previous tier.

---

## 10. ⚠️ Limitations and what is NOT verified

- ⚠️ **NOT EXERCISED AGAINST A LIVE LINKED IDENTITY.** No real person has asked
  her for a suggestion; the gates are proven by injected-port tests only. The
  physical refusal for a non-visible identity has never been produced by a real
  `whoami`.
- ⚠️ **The physical shelf is SMALL: 64 of 1,079 rows carry a print format.** For
  most of the catalogue she will say she cannot find a print candidate, and
  `SUGGEST_MSG.nothingLeft` is careful to call that a gap in the JOIN rather than
  a verdict on what the house owns.
- ⚠️ **`PHYSICAL_SOURCE_INSTANCE` depends on an env var in another repo** (§2.2).
  Nothing here can detect a change to it.
- **The ebook gate probes with the knowledge-base LISTING.** That is the cheapest
  call behind `vis_ebooks` and returns no book text — but it means an ebook
  suggestion costs one extra round trip, and it couples this lane to `GABI_BOOKS`
  being on.
- ⚠️ **The 84-row join was measured at one moment.** The pipeline republishes
  roughly daily; the number moves.
- **How the suggestions actually READ is unmeasured.** The ladder is reasoned and
  unit-tested; nobody has judged whether its picks are good.

---

## 10f. 🔴 INCIDENT — THE FIRST REAL NON-OWNER USER, AND THE LANE MISSED HIM (2026-08-18)

**7:26 PM Phoenix. Not a test. Not the owner. A member of the household, in a
channel, three hours after this lane went live.** Verbatim:

> **Cheetah11:** *"@GABI I can't sit and read a book it makes me fall asleep.
> Find me something entertaining"*
>
> **GABI:** *"I looked on the estate's public shelf for **can't sit read makes
> fall asleep something entertaining**. Nothing on the estate's public shelf
> matches that…"*
>
> **Cheetah11:** *"Gabi sucks what the heck."*

⚠️ **He is right, and his sentence is now the specification.** Two separate
defects fired in one turn, and they are worth keeping apart because they have
different fixes and different lessons.

### Defect 1 — the routing miss, and it is the FOURTH of its family in one day

`suggestIntent` never claimed the turn. Every pattern it had required one of a
small set of **library words** — *recommend*, *suggest*, *read*, *listen*,
*book*. His sentence contained none of them, because:

> ⚠️ **NOBODY ASKS FOR A "RECOMMENDATION". THEY ASK FOR SOMETHING GOOD.**

`find me (?:a|something) (?:book|read)` needed a noun after "something". He said
*"find me something entertaining"*. One word of grammar between a working feature
and *"Gabi sucks"*.

**This is the same class as the day's other three** — docs answered from the book
shelf, the shelf lane never entered, the shelf lane entered and the tool never
called — but with a twist that makes it worse: those three were found by the
OWNER, testing, using the lanes' own prescribed phrasings. **This one was found by
a stranger using ordinary English.** The lesson generalises:

> **A detector tested only against the sentences its author imagined is a
> detector tested against one person's idiolect.**

Fixed by widening `SUGGEST_STRONG` with the conversational shapes: *find/give/pick
me something*, *I'm bored*, *entertain me*, *surprise me*, *anything good*, *what
should I listen to*, *in the mood for*, *something entertaining/funny/short/that
won't put me to sleep*. ⚠️ The widening is bounded — every added pattern still
carries an imperative or a *what/anything* question, so this stays a router and
does not become "any sentence mentioning books". `test/suggest.test.ts` asserts
both halves: the sixteen shapes it must now catch, and the nine it must still
leave to the docs, catalogue, shelf, book and small-talk lanes.

### Defect 2 — she quoted a mangled version of his own sentence back at him

`searchTermFor` is a best-effort stopword-stripper whose own header says it is
*"never load-bearing"*. Its output was then **printed to a person in bold** as
what she had looked for.

⚠️ **A machine reciting a garbled version of your own words and telling you it
found nothing is worse than a plain "I don't know."** It reads as not having been
listened to — which is exactly what he said next.

Fixed with `termIsQuotable()`: a reduction of more than five words is a sentence,
not a title, and when nothing matched she says *"I'm not sure what to look up
there…"* and names what would work instead. ⚠️ **She also stops claiming the
catalogue lacks it** — a search she is not confident she built correctly is not
evidence of an absence. Five words is the bar because the longest real title
question measured on this surface — *"what is the fourth book in the Dungeon
Crawler Carl series"* → `fourth Dungeon Crawler Carl series` — is five, and it
keeps its old behaviour.

### And the third thing, which was not a defect but was a design mistake

He never named a format, so the lane would have asked *"audiobook, ebook, or a
physical copy?"* — **a question, and no books.** That is the
ask-instead-of-deliver defect the estate had already written up **twice the same
day**, arriving a third time in the newest lane.

> **One refining question is welcome AFTER a real answer, never instead of one.**

An unstated format now falls back to the **audiobook** shelf and answers, then
asks in one closing clause. ⚠️ **No gate is bypassed:** audio is the public slice
`audiobooks.heygabi.ai` already publishes to the open internet, ungated for the
same reason `/have` is. The ebook and physical gates are still reached only by a
format somebody actually NAMED, and `formatAsked`'s explicit-word rule is
untouched.

### ⚠️ The mood is a REQUIREMENT, not small talk

*"I can't sit and read a book it makes me fall asleep"* is the more useful half of
his message: it names the shelf (audio), the pace (fast) and the failure mode
(anything worthy). `suggestMoodHints()` now reads those and hands them to the
composer as prose.

⚠️ **AND IT CAN NEVER OPEN A SHELF.** The hints are deliberately separate from
`formatAsked`, which drives the ebook and physical **permission gates** and still
demands an explicit word — its own rule, unchanged: *"Inferring 'physical' from
'something to take on the plane' would be a guess dressed as an understanding."*
A mood improves the PICKS; it is not a format and never becomes one.

### What is still not fixed

- ⚠️ **Nobody has judged whether the picks are good** — unchanged from §10, and
  now with a real audience. The next thing to watch is whether Cheetah11's second
  attempt gets something he actually starts.
- **The widened detector is unit-tested, not user-tested.** It catches sixteen
  shapes somebody wrote down. The next stranger will say a seventeenth.

---

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a task names a
> model, honor that name; the naming exists so AUTO stays cheap and safe.
> Labels (verified against Kiro pricing: Auto = 1.0x credits, pinned
> Sonnet = 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" = STAY ON
> AUTO, do not pin (standard build). "Kiro Claude Opus 4.8" = actually
> pin Opus - the 2.2x is worth it (design judgment or trust-critical).
> "Codex (GPT-5.3-Codex)" = tell the owner; he runs Codex himself.

- Tuning the ladder, adding a rung, wording the WHY clauses, new tests:
  **Kiro Claude Sonnet 5**.
- ⚠️ Touching **any gate** — the physical instance constant, the ebook
  probe, the refusal shapes, or the outage-versus-permission split:
  **Kiro Claude Opus 4.8**. These decide who is pointed at what, and the
  outage/permission distinction is the one that sends real people asking
  for access they already hold.
