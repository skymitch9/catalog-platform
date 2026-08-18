# GABI knows your shelf (Tier 0d) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Built + deployed **DARK**
> 2026-08-18. Design: [`../info/gabi-personal-shelf-design.md`](../info/gabi-personal-shelf-design.md).

---

## 1. The lever

`GABI_SHELF` in `apps/discord-worker/wrangler.toml`, affirmative-only, **ships
`"off"`** — it reaches a named person's personal reading list.

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_shelf_enabled, gabi_shelf_ready, gabi_shelf_tools
```

⚠️ **`ready` contains no app token** — both stores are Firestore collections this
Worker already reaches with the service account it holds for `discord_links`.
**No new secret, no new trust edge.**

---

## 2. The four tools

| Tool | Reads | Needs a link? |
|---|---|---|
| `my_tbr` | `readingLists` where `uid == asker` | ✅ yes |
| `my_reviews` | `reviews` where `displayName == asker` | ✅ yes |
| `book_reviews` | `reviews` where `bookId == …` | ❌ **no — public site content** |
| `my_unread` | catalogue minus the asker's reviews | ✅ yes |

⚠️ **No tool takes a person argument**, and a test enforces that. It is what
makes "the asker's own shelf" a property of the code rather than an instruction.

---

## 3. ⚠️ The two things that will be reported as bugs

**a) "She says I have no reviews and I definitely do."**
Reviews are keyed by **display name**, and the name GABI holds is a **snapshot
taken at `/link` time** — the sites read the live Firebase profile, GABI reads
the copy. **Fix: re-run `/link`.** She already says this; if she said "you have
written none" instead, that is a real bug — the result note forbids it.

**b) "She says I have 400 unread books."**
She should never say *unread*. The estate has **no read-state store** on the
audiobook side, so the honest answer is **not reviewed**, which is a much larger
set. The field is `not_reviewed_count`, every row carries `basis: no_review`, and
the note forbids the words "unread" and "backlog". If those words appear in an
answer, chase the note.

**c) "She asked me what I'd read instead of telling me."**
⚠️ **That was a real defect and it is fixed** (2026-08-18, `f538de8`). She
answered *"what have I not read by Sanderson"* by interviewing the asker —
*"have you worked through Stormlight and Mistborn?"* — which is a question
`my_reviews` answers. The lane now does the arithmetic **before** the model is
consulted, so the finished result is in front of her and there is nothing to
interview about. If she ever opens a shelf answer with a question about what you
have read, that is this defect returning and it is serious.

⚠️ **The delivery shape is deliberate too**: grouped by series with counts,
leading with the series you have started, naming what you DID review, with the
full list on request. That is not truncation — it is the alternative to a wall of
thirty-eight titles, and it is why the answer looks like a summary.

---

## 4. Known gaps

- ⚠️ **The LIBRARY's TBR and read state are NOT readable** — they live in D1 in
  another repo and need a route. Every TBR row carries `shelf`, and an empty
  answer says which shelf it checked, so this gap is visible rather than silent.
- **Legacy uid-less `readingLists` rows are unreachable.** The migration copied
  `uid` onto every row it could; a retired passphrase account has none and no
  query can find it. A fact about the migration, not something to paper over.
- **Not exercised against a live linked identity** — the posture is off, so no
  real query has run. That is the first thing to do when it is switched on.

---

## 5. ⚠️ A mirrored persisted-key function

`bookIdFromTitle` in `src/shelf.ts` is a **deliberate copy** of
`audiobook_catalog/site/reviews.js`. It produces the id every review and
reading-list row is **filed under**, so by the estate's rule **changing it is a
migration, not an edit** — and changing one side only silently orphans every
join. If a `packages/` home is ever made, both sides move together; a third copy
would be worse than these two.
