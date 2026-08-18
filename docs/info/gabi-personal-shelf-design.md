# GABI knows YOUR shelf — TBR, reviews and "unread" — design

> **Audience:** Claude sessions. **Status:** TRACKED. Written **2026-08-18**.
> Owner ask, verbatim: *"We need GABI to know the tbr, reviews, and unread about
> a user if they're /linked."*

Siblings: [`gabi-book-knowledge-design.md`](gabi-book-knowledge-design.md) (the
per-asker gated tool pattern this copies), [`gabi-memory-design.md`](gabi-memory-design.md),
[`gabi-personality-design.md`](gabi-personality-design.md).

---

## 0. ⚠️ The measurements this design rests on

Taken 2026-08-18 by reading the code that writes each store, not by asking. The
design is shaped by these and would be wrong without them.

| Store | Key | Carries | Measured from |
|---|---|---|---|
| `readingLists` (audiobook TBR) | **`{uid}_{bookId}`** post-migration | `displayName, uid, bookId, bookTitle, bookCover, status, addedAt` | `library_catalog/packages/core/src/tbr.ts` §`readingListDocId` |
| ⚠️ legacy TBR rows | `{displayNameLower}_{bookId}` | no `uid` | `legacyReadingListDocId`, kept until `migrate_tbr_to_uid.py --report` prints zero |
| **`reviews`** (audiobook) | ⚠️ **`{bookId}_{displayNameLower}`** | `bookId, displayName, rating, text, createdAt, updatedAt` | `audiobook_catalog/site/reviews.js` §`submitReview` |
| `user_book` (library D1) | uid-keyed | explicit **human-asserted** read state | `library_catalog/packages/core/src/readstate.ts` |
| `discord_links/{discordUserId}` | Discord snowflake | `firebaseUid, email, displayName, slug, linkedAt` | `apps/discord-worker/src/link.ts` |

### ⚠️ 0.1 The review store has NO uid and NO email — measured, not assumed

`submitReview` writes exactly `{bookId, displayName, rating, text, updatedAt}`
(+`createdAt` on first write). **There is no `uid` field and no `email` field.**

⚠️ **And there is a trap here worth naming.** The shared predicate
`isMyReview(review, me)` *prefers email* and only falls back to display name:

```ts
if (reviewEmail && myEmail) return reviewEmail === myEmail;
return !!reviewName && reviewName === myName;
```

Reading that function alone would suggest an email join is available. **It is
not, on this store** — the audiobook writer never populates `review.email`, so
the email branch is permanently dead there and every match falls to the name.
The stronger predicate exists and is unusable until the writer changes. Anyone
building on `isMyReview` needs to know which half is actually live.

---

## 1. ⚠️ The identity join, and the wart it inherits

```
Discord snowflake
   └─ discord_links/{id}  ──→ firebaseUid   → readingLists (TBR), user_book (library)
                          └─→ displayName   → reviews          ⚠️ name-keyed
                          └─→ email         → estate directory (grants)
```

**The good half:** TBR and library read-state are **uid-keyed**, so those joins
are exact and survive a rename.

⚠️ **The bad half, stated plainly because the sites live with it too:** reviews
are keyed by display name, so **renaming your display name orphans your reviews
from you**. She will not find them, and she must say she could not rather than
say you have not written any. This is the same wart the sites carry; this design
does not fix it and does not pretend to.

⚠️ **A second, sharper edge this design found:** `discord_links.displayName` is a
**SNAPSHOT taken at link time**, not a live read. So the name GABI joins on can
be stale *even if the person never noticed a problem on the site*, because the
site reads the live Firebase profile and GABI reads the copy. Two consequences:

1. The reviews lookup should use the link document's `displayName` **and say so
   in its own result**, so a mismatch is visible rather than silent.
2. ⚠️ **A person whose reviews "vanish" is told to re-run `/link`**, which
   refreshes the snapshot. That is a real fix a person can perform, and it is the
   sentence to give them.

---

## 2. The three, defined honestly

### 2.1 TBR — read BOTH shelves, and say which is which

The estate has two TBRs and they are different lists, not two copies:

| Shelf | Store | What it means |
|---|---|---|
| **Audiobooks** | `readingLists` (Firestore) | intentions on the audiobook catalogue |
| **Library** | library D1 | intentions on the print/ebook library |

⚠️ **Read both and label every row.** Merging them into one list would produce a
"your TBR" that matches neither site, and a person who then went looking for an
item would find it missing from the shelf they checked. The tool result carries
`shelf` per row and the count is stated per shelf.

⚠️ **Legacy uid-less TBR rows exist** (the migration's tail). Those are keyed by
display name and inherit §1's wart. They are read on the same fallback the sites
use, and a row found only that way is labelled `matched_by: "name"` so an answer
never implies more certainty than the join had.

### 2.2 Reviews — the asker's own, and other people's with attribution

**Her own-review lookup is uncontroversial**: reviews are **public content on the
sites**, so reading somebody their own words back is the mildest possible case.

**Other people's reviews are also public**, so *"what did Sam think of X?"* is
answerable — with two hard rules:

1. ⚠️ **ATTRIBUTE, NEVER ABSORB.** *"Sam gave it 4 stars and said '…'"*, never
   *"it's a four-star book"*. A review is somebody's opinion and it stays theirs;
   collapsing it into her own claim is how a household member's opinion becomes
   "the estate's view" without them agreeing to that.
2. **Quote or summarise, never invent.** The same rule the book tools carry.

### 2.3 ⚠️ "UNREAD" — the definition is the whole risk

**There is no read-state store on the audiobook side.** Reading positions are
phase 3 of the book design and unbuilt; nothing records "I finished this".

So "unread" cannot be answered directly, and the honest move is to answer a
*different, stated* question rather than a plausible-looking wrong one:

| Source | What it actually means | Confidence |
|---|---|---|
| **audiobook** | owned, and the asker has **no review** of it | ⚠️ *not reviewed* — a proxy |
| **library** | `user_book` read state, **explicitly asserted by a human** | ✅ real read state |

⚠️ **THE COUNT MUST NEVER MASQUERADE.** *"You have 412 unread books"* is a lie
when it means *"412 you have not reviewed"* — most people review a small
fraction of what they read, so the proxy overcounts enormously and in a direction
that feels authoritative. Every row carries `basis: "no_review" | "read_state"`,
and the result's note requires her to say which produced the number.

⚠️ **The memory profile may NOT override the store.** Tier 2 records reading
claims people make in conversation (*"I finished PH 9"*); those are **soft claims
with provenance** (memory design §3.4) and they inform the *conversation*, never
the *count*. A profile that could edit a shelf answer would make her confidently
wrong in a durable way.

---

## 3. The tool surface

A **fifth allowlist array**, `GABI_SHELF_TOOL_NAMES`, beside Tier 0 (catalogue),
0b (docs), 0c (book text) and Tier 1 (delegated writes) — the same reason each
previous one was its own: **what it reads is different**, and here it is *one
named person's own shelf*.

| Tool | Does |
|---|---|
| `my_tbr` | `{shelf?}` → the asker's TBR, per shelf, labelled |
| `my_reviews` | `{query?}` → the asker's own reviews, newest first |
| `book_reviews` | `{title}` → **public** reviews of one book, attributed |
| `my_unread` | `{author?, series?}` → owned-and-unreviewed + library read-state, each row labelled with its basis |

**Caps, sized to the data:**

| Cap | Value | Why |
|---|---|---|
| TBR rows per answer | 40 | a TBR is small; 40 is generous |
| Review rows | 15 | review text is up to 1,000 chars — 15 is already a long message |
| Unread rows | 30 | with the total always stated |
| Bytes per turn | reuse the books ceiling (48 KB) | ⚠️ and the **auto-continue** machinery, so a long list becomes labelled consecutive messages rather than a permission question |

⚠️ **Reuse, do not re-implement, the auto-continue and part-labelling built for
the book lane.** A second implementation of "this answer is long" is a second
place for the 1:31 PM permission-loop to come back.

---

## 4. Posture, gating and refusals

`GABI_SHELF`, affirmative-only, **ships off** (the `GABI_BOOKS` precedent — this
reaches personal data).

| Situation | What she says |
|---|---|
| Not linked | the existing *"run `/link` and try me again"* sentence — **reused, not rewritten** |
| Linked pre-upgrade (no `displayName`/`email`) | the existing relink sentence |
| Reviews join found nothing **and** the name may be stale | ⚠️ *"I could not find reviews under the name I have for you — re-run `/link` and I will pick up your current name"*, never *"you have not reviewed anything"* |
| Asked for **another person's TBR** | ⚠️ worded refusal — a TBR is personal, not public |
| Asked for another person's **reviews** | answered, attributed (§2.2) |

⚠️ **CHANNEL POSTURE.** Asking about your own shelf *in a channel* is your own
choice by asking there — she answers where asked. But another person's **TBR** is
never offered, in any surface, because it is not public content anywhere; the
sites do not show it.

---

## 5. Mechanics

Follows the `vis_ebooks`-checked book tools exactly:

- new tools in the Discord allowlist → executor → **injected port** → routes on
  the estate workers, authenticated by app token **plus the asker's proven
  identity**;
- ⚠️ **the port is the credential seam** — a fifth exec module, and the guard
  test widens deliberately for the fourth time;
- the asker's identity is resolved **once per turn**, memoised, from
  `discord_links` — the same read the book and docs ports already make.

⚠️ **The uid never comes from the model.** It is read from the link document
server-side, exactly as the book lane's email is. There is no tool parameter that
could carry somebody else's identity, which is what makes "the asker's own shelf"
enforceable rather than merely instructed.

---

## 6. What is deliberately NOT built

- **No writes.** No adding to a TBR, no posting a review, no marking read. Those
  are Tier-1 delegated verbs with their own confirm lane.
- **No fixing the display-name join.** Adding `uid` to reviews is a migration on
  ~884 documents and belongs to the sites, not to GABI.
- **No cross-household reviews.** One estate.
- **No "unread" on the audiobook side pretending to be read state** — §2.3.
- **No panel surface.** Discord first, same as every previous tier.

---

## 7. Rollout

| Phase | What | Model |
|---|---|---|
| **1** | Routes + queries for TBR and reviews, per-asker auth | **Kiro Claude Sonnet 5** |
| **2** | The four tools, allowlist array, caps, auto-continue reuse | **Kiro Claude Sonnet 5** |
| **3** | ⚠️ The identity join, the stale-snapshot wording, the privacy refusals | **Kiro Claude Opus 4.8** |
| **4** | `my_unread` and its labelling | **Kiro Claude Sonnet 5** |

⚠️ Phase 3 is Opus-pinned because it is the trust edge: it decides *whose* shelf
is read and what a person is told when the join fails.

---

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a phase above
> names a model, honor that name; the naming exists so AUTO stays cheap
> and safe. Labels (verified against Kiro pricing: Auto = 1.0x credits,
> pinned Sonnet = 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" =
> STAY ON AUTO, do not pin (standard build). "Kiro Claude Opus 4.8" =
> actually pin Opus - the 2.2x is worth it (design judgment or
> trust-critical). "Codex (GPT-5.3-Codex)" = tell the owner; he runs
> Codex himself.

---

## 8. ⚠️ Limitations and what is NOT verified

- ⚠️ **Nothing is built.** No route, no tool, no posture.
- ✅ **Measured** (§0): every store's key shape and the review document's fields,
  read from the code that writes them.
- ⚠️ **NOT measured:** the ~884 review count (taken from the brief, not counted
  here), how many legacy uid-less TBR rows remain, and how many household display
  names have drifted from their link snapshot. **All three change the wording's
  importance and none of them change the design.**
- ⚠️ **The "unread" proxy is unvalidated against reality.** Nobody has checked
  what fraction of read books get reviewed on this estate. If it is very low, the
  audiobook half of `my_unread` is nearly useless and should say so more loudly —
  measure before tuning the wording.
- **The library TBR read path is described from its code, not exercised.** The
  legacy-fallback removal is still queued there.
