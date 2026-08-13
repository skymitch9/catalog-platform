# Matching Thresholds — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-12** (measured that night, by Fable 5).

Re-measurement of the two thresholds `PLATFORM.md` §7 Stage 1 marks **critical**:
`MIN_TITLE_SIMILARITY` (0.34) and the **0.7 spine floor** (`MIN_SPINE_SIMILARITY`),
plus the containment matcher built on them. Measured against **both production
D1s, read-only**: 341 library works / 378 editions / 117 known series names, and
836 board-game items / 72 aliases. Every similarity score below was computed by
the repos' own implementations (`library_catalog/packages/core/src/matching.ts`,
`Board_Game_Catalog/packages/core/src/barcode.ts`), imported — not re-implemented
— by a throwaway measurement script.

## The verdict in one paragraph

**Keep both numbers, in both catalogs: 0.34 and 0.7.** No value on the threshold
axis does better, because the dangerous pairs in both catalogs score **1.00** —
no threshold can exclude them — and the honest book spine reads score **0.50–0.75**
— any floor that admits them admits the junk too. The safety the games catalog
attributes to 0.7 actually has to come from **structural gates** (numbers must
agree; author must not contradict; a strict-subset title is a different product),
and the two catalogs each hold gates the other lacks. Fix once means: **one
shared matcher with all three gates**, shaped like the library's, with the games'
fragment guard added. The threshold constants can then genuinely be shared.

## 1. What was measured

| Measurement | Library (books) | Board games |
|---|---|---|
| Distinct-work/item pairs compared | 57,967 | 349,030 |
| Pairs scoring ≥ 0.7 (spine floor) | **126** (0.22%) | **1,063** (0.30%) |
| Pairs scoring **exactly 1.00** while being different things | **79** | **15** |
| Pairs scoring ≥ 0.34 | 751 (1.3%) | 12,635 (3.6%) |
| Exact normalised-title collisions (different things, same key) | **3 keys** | **0** |
| Known true alias pairs scoring < 0.7 (false negatives at the spine floor) | 3 of 11 | n/a (see §5) |
| Known true alias pairs scoring < 0.34 | **0** of 11 | n/a |

### ⚠️ 1.1 The 1.00 cluster — why no threshold can work alone

`titleWords` drops words shorter than two characters, so **single-digit volume
numbers vanish before comparison**. Measured consequences:

- *Super Boss Monster 2* vs *Super Boss Monster* → **1.00**
- *Ark Nova: Zoo Map Pack 1* vs *Zoo Map Pack 2* → **1.00**
- every pair of *Dungeon Crawler Carl: Art Print #1..#5* → **1.00**
- 79 library pairs, nearly all numbered series siblings → **1.00**

A floor of 0.99 passes every one of these. They are only separable by the
**numbers-agree gate** (`matching.ts` `numbersAgree`), which the library matcher
applies to containment and the games matcher **does not have at all**. Applying
it to the ≥0.7 sets kills 121 of the library's 126 wrong pairs and 38 of the
games' 1,063 — including the entire 1.00 cluster in both.

### 1.2 What survives all gates — the honest residual

Library, after author gate + numbers gate: **4 pairs of 57,967**:

| sim | pair |
|---|---|
| 0.86 | *Dungeon Crawler Carl: Crocodile* vs *Dungeon Crawler Carl* (same author — the fragment guard would catch this one) |
| 0.75 ×3 | *My First Farm / Wild / Ocean Animals* (Autumn Publishing sibling picture books; genuinely confusable, and only a human can tell them apart) |

Games, after fragment guard + numbers gate: **885 pairs of 349,030** — but they
are overwhelmingly same-family accessories (*…Painted Miniature – Santa* vs
*– Krampus* scores **1.00** because both discriminating words already appear in
the shared family name *Santa vs Krampus*). Word-membership similarity is
structurally blind there; only exact-string matching distinguishes them, which is
what the exact-then-alias-then-containment ladder already provides.

## 2. ⚠️ The games rationale for 0.7 does NOT transfer to books — but the value survives anyway

The games measurement said: junk clusters at 0.67, genuine reads at 1.00, and 0.7
sits in the gap. **For books that gap does not exist.** The only real book shelf
scan in production (job 9, seven spines) is the counter-example: the *My First*
board books print only the sub-title on the spine, so the **true** reads scored:

| Spine read | True work | sim | Current matcher result |
|---|---|---|---|
| Things That Go | My First Things That Go | **0.75** | ✅ matched (containment) |
| Wild / Ocean / Farm Animals | My First … Animals | **0.67** | ❌ no match (length gate) |
| Toys / Food | My First Toys / Food | **0.50** | ❌ no match |

Genuine book reads live at **0.50–0.75** — exactly where the games' junk cluster
sits. So for books, 0.7 does not sit "in the gap between populations"; the
populations **overlap**, and no floor value separates them:

- **Lowering** the floor to catch the true reads (0.5) admits the games' one-word
  junk at 0.67 *and* the library's 126 series-sibling pairs at ≥0.7 — wrong books
  auto-filed as owned.
- **Raising** it to 0.8 to kill the *My First* residual pairs costs 3 measured
  true alias matches (Tamer Kickstarter editions at 0.73/0.77, *Things That Go*
  at 0.75) to remove 3 false ones. A wash on counts, and the FN direction is the
  cheap one.

**So 0.7 stays — but its meaning changes for books.** It is not "the gap"; it is
"nothing auto-ticks unless the read is essentially exact", which is the right
posture because a book false negative costs a tap while a false positive files a
book as already-owned where it is lost (the `BOSS MONSTER` shape). The library
review screen already shows sub-floor matches unticked; that behaviour is the
load-bearing part, not the constant.

## 3. The fragment attack — the matchers are NOT equally safe

Feeding each catalog its own pre-colon prefixes (the "spine printed only the
series/family name" simulation, no author):

| | tried | matched a **different** thing | passed the confident floor |
|---|---|---|---|
| Games `matchIndexedTitle` | 354 | **162 (46%)** | 1 |
| Library `matchIndexedWork` | 29 | **0** | 0 |

The games' 46% is *Dice Throne* → *Marvel Dice Throne*, *Cult of the Lamb* →
*Cult of the Lamb: Tote Bag*, *Deep Rock Galactic* → *…: Steeve Mini* — the exact
`BOSS MONSTER` → `Super Boss Monster 2` failure the original TODO recorded, and
it is the routine case, not the outlier. The library's zero comes from the
numbers gate plus containment ordering, not from books being easier.

⚠️ **Conclusion for the platform fork: the shared matcher must be shaped like
`library_catalog`'s `matchIndexedWork`, not `Board_Game_Catalog`'s
`matchIndexedTitle`.** The games matcher is the one that needs the port.

## 4. Books need (title, author) — now measured, not just argued

- 341 book titles produced **3** exact normalised-title collisions across
  different works (*Welcome to the World* under two unrelated authors, *Bizzy
  Bear* twice, and one empty-key pair — see §7). 836 game names produced **0**.
- **4 works cannot match themselves** through a title-only index (first-in wins).
- But the author gate's value is asymmetric: among the 126 ≥0.7 wrong book
  pairs, the author gate alone rescues **1** (*I Love You, Little Moo* vs
  *…Little Bear*) — because 125 of 126 are same-series, same-author. **The author
  gate protects against cross-author collisions (the Open Library wrong-answer
  class); the numbers gate protects against same-series volumes. Both are
  required; neither substitutes for the other.**
- ⚠️ The series-name attack defeats the author gate entirely: all 23 series
  names that match something still match **with the correct author supplied**,
  because the same author wrote the whole series. Only §6's rule covers this.

## 5. `MIN_TITLE_SIMILARITY` = 0.34 — keep, unchanged, both catalogs

Its job is ranking/gating candidates a person asked for, never auto-acting.
Measured: **0 of 11** known true library alias pairs fall below it (3 fall below
0.7), and it passes only 1.3% (books) / 3.6% (games) of random wrong pairs into a
list a human reads. The 2026-08-06 lesson stands: it catches nothing as a spine
floor, and it is not one.

(The games' 72 `item_alias` rows all score ~0 against their items — *D&D* →
*Auroboros: Coils of the Serpent* — because they are **identity assertions**, not
spelling variants. Both codebases already treat aliases as exact-match-only, no
similarity credit. Keep that; running any floor over aliases would be wrong in
both directions.)

## 6. ⚠️ The bare-series-name rule — the failure that corrupted data on 2026-08-13

The signature that night: a barcode resolved to an Open Library **work-level**
record, producing a work titled with the bare series name (*Space Knight*,
*Tamer*, *Monster Empire*) carrying **six editions with six unrelated ISBNs**.

Measured legitimacy bounds from production:

- **18 of 341** real works are legitimately titled with a known series name
  (volume 1s: *The Wandering Inn*, *Dungeon Crawler Carl*; picture books:
  *Bizzy Bear*). ⚠️ So "title equals a series name" alone must **never** hard-refuse.
- Editions per work: **303×1, 33×2, 3×3, max 3**. No legitimate work has ever
  gained more than one edition from one event. Six-from-one-barcode is not an
  edge case of anything legitimate; it is impossible data.
- 23 of 117 known series names, fed as bare spine reads, match something in the
  catalog; 21 pass the 0.7 floor; the author gate saves none of them (§4).

**The rule, three tiers:**

1. **REFUSE at ingest (mechanical, no judgement):**
   - One barcode may create **at most one edition and one copy**. A lookup
     answer carrying more than one distinct ISBN13 for one scanned barcode is
     refused outright, not trimmed to its first entry.
   - An Open Library `/works/…` (work-level) record may never be an edition
     source. Only edition-level (`/books/…`) records carry a printing's identity.
2. **REVIEW-ONLY, never auto-tick:** a candidate whose normalised title equals a
   known series name — `work.series` ∪ `series_volume.series` ∪
   `series_check.series`, via the same `normaliseTitle` — **and** carries no
   volume marker/number. It may be volume 1; a person can say so in one tap. The
   18 legitimate works above are why this tier exists instead of a refusal.
3. **AUDIT (retrospective sweep):** any work whose title equals a series name
   and which carries ≥2 editions. In current production this set is empty after
   the manual cleanup, which is exactly why it is the right standing alarm.

For games the same rule reads "family name" for "series name": the 46% fragment
mismatch in §3 is the identical failure one abstraction over.

## 7. Side findings (not the task, worth recording)

- ⚠️ **Non-Latin titles normalise to the empty string.** Two Korean works
  (#195, #305) share the key `""` — `normaliseTitle` strips everything outside
  `[a-z0-9]`. The matcher refuses keys shorter than 2 chars so they cannot be
  matched *at all*, and the title half of `work_key` is empty, making the key
  effectively author-only for them. Any CJK growth makes this a real collision
  path. Fixing it changes stored keys, so it is a **migration**, not an edit.
- #258 *The Wizard, The Witch, The Wild One* carries **3 hardcover editions** —
  either the edition-picker case (FABLE5.md §4.2a) in the wild or leftover
  duplicates; a human should eyeball it.
- The games' `isFragmentOf` guard rejects 147 of the 1,063 ≥0.7 wrong game
  pairs, including `BOSS MONSTER` shapes the numbers gate misses (no numbers to
  disagree). The library's `isConfidentMatch` **lacks it** — ported verbatim
  from before the guard existed. The full guard set is: fragment guard (games
  has), numbers gate (library has), author gate (library has). **Union them.**

## 8. What was NOT measured, and why

- **Open Library's wrong-answer rate at scale.** Would need a live API sweep;
  the 2026-08-09 spot measurements in `library_catalog/docs/info/isbn-ladder.md`
  (*Firefight* → wrong 2001 *Firefight*; *The Wandering Inn* → *Garden of
  Sanctuary*) remain the only evidence, and they motivate the floors rather than
  calibrate them.
- **Kindle/ASIN name-only matching.** One ASIN-only edition exists in
  production; no corpus to measure against yet. The (title, author) argument
  for that path rests on §4's collision counts, not on measured Kindle rows.
- **Book spine read-rate on a full shelf.** The entire book spine corpus is one
  job of seven spines. The §2 population claim (true reads at 0.50–0.75) is
  n=6 and should be re-checked after the next few shelf scans — the
  `PLATFORM.md` "measure before splitting photographs" question stays open for
  the same reason.
- **The games' 885 residual ≥0.7 pairs** were characterised by inspection of the
  top of the list, not exhaustively classified.
