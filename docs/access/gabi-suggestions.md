# GABI suggests a book — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED. Built + deployed
> **2026-08-18**, ships **ON**.
> Design: [`../info/gabi-suggestions-design.md`](../info/gabi-suggestions-design.md).

---

## 1. The lever

`GABI_SUGGEST` in `apps/discord-worker/wrangler.toml`, affirmative-only, **ships
`"on"`** — the owner ordered the outcome, and the lane opens **no new corpus**
(public catalogue + the asker's own shelf, each already behind its own posture).

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_suggest_enabled, gabi_suggest_audio_ready,
                gabi_suggest_ebook_ready, gabi_suggest_physical_ready,
                gabi_suggest_physical_instance
```

⚠️ **`ready` is per FORMAT, not one boolean** — the three formats have three
different gates, and "suggestions are on" tells you nothing about which of them
can actually answer.

⚠️ **NO NEW SECRET AND NO NEW TRUST EDGE.** Every port this lane uses is one the
Worker already builds. Credentials still live in exactly five modules.

---

## 2. ⚠️ The three gates — what each one needs

| Format | Needs | Refused when |
|---|---|---|
| **audio** | nothing | never |
| **ebook** | `/link` **+** `vis_ebooks` **+** `GABI_BOOKS=on` and its app token | not linked; the estate says no (relayed verbatim); the books port is unbuilt (a SETUP sentence) |
| **physical** | `/link` **+** an account on **`library.heygabi.ai`** | not linked; `whoami` says `known: false`; the delegated port is unbuilt |

⚠️ **Physical is gated on the MAIN library specifically.** Measured 2026-08-18:
`catalog.csv`'s `library_work_id` is a bare integer naming no instance, so the
question was answered at the writer —
`audiobook_catalog/app/library_link.py` fetches the join from
`<LIBRARY_MAPPING_URL>`, and `audiobook_catalog/.env` sets that to
`https://library.heygabi.ai`. **padhard is never read by the pipeline.**

⚠️ **IF `LIBRARY_MAPPING_URL` EVER MOVES, `PHYSICAL_SOURCE_INSTANCE` IN
`src/suggest.ts` IS WRONG AND NOTHING HERE CAN DETECT IT.** The fix if the join
ever spans both: require the asker to be known on EVERY instance.

---

## 3. Owner test lines

| Type this | Expect |
|---|---|
| `@GABI what should I read next?` | ⚠️ **one** clarifying question: audiobook, ebook, or physical |
| `@GABI recommend me an audiobook` | 3–5 books, each with a one-clause reason, from the audiobook shelf |
| `@GABI suggest me a physical book` | as owner: real print candidates. As somebody with **no account on library.heygabi.ai**: the worded refusal naming the shelf and the sign-in URL |
| `@GABI recommend me an ebook` | granted → candidates; not granted → the estate's own `vis_ebooks` refusal |

---

## 4. ⚠️ The three things that will be reported as bugs

**a) "She only ever suggests the same few physical books."**
Correct, and it is a data gap rather than a fault. **Measured 2026-08-18: only 64
of 1,079 catalogue rows carry a print format** in the cross-catalog join. Her
"nothing left" sentence is careful to call that a gap in the JOIN, never a
verdict on what the house owns.

**b) "She asked me the format question again."**
She skips it when the message names a format, or when the person's tier-2 profile
records a **preference** (a preference verb is required — *"listened to PH 9 last
night"* is a reading claim, not a standing preference). ⚠️ Two named formats
("audiobook or paperback?") is a COMPARISON and deliberately falls through to the
question.

**c) "She suggested something I already read."**
She excludes what you have **reviewed**, because that is the only record the
estate has. ⚠️ **She must never call the rest "unread"** — the audiobook side has
no read-state store, and the grounding note bans the words "unread" and
"backlog". If those words appear, chase the note.

---

## 5. The ladder, for debugging a strange pick

In order; the first rungs that produce rows win:

1. **their own TBR** — *"already on your reading list"*
2. ⚠️ **series continuation** — *"you gave X 5 stars and this is the next one"*
   (needs a rating **≥ 4**; a three is politeness)
3. same author of a well-rated book
4. same universe
5. the shelf, with the WHY admitting there was no signal

Every rung excludes anything reviewed. Every candidate comes from the catalogue
fetched **that turn** and the shelf read **that turn** — the model is handed a
closed list and told to suggest only from it.
