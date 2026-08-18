# GABI's memory — three tiers — design

> **Audience:** Claude sessions. **Status:** TRACKED. Written **2026-08-18**.
> Owner ask, verbatim: *"i think we need to reconsider her memory, do we need to
> save gabi's memory somewhere else for conversations so its not a fresh bot to
> talk to each time, I think context is what makes a bot more useful but we also
> dont want to blow scope."* Shape approved the same day.

Sibling docs: [`gabi-conversation-continuity.md`](gabi-conversation-continuity.md)
(tier 1, as built), [`gabi-book-knowledge-design.md`](gabi-book-knowledge-design.md)
(§4.3's stored-ceiling hazard, which §3.4 below is about),
[`gabi-application-map.md`](gabi-application-map.md).

---

## 0. The ask, and the scope fence in it

Two sentences, and the second one is half the design: **context makes a bot
useful**, and **we do not want to blow scope**. So this is deliberately not "give
her a memory"; it is three tiers with three different costs, where **only one of
them is paid on every turn**.

| Tier | What it is | Cost per turn | Lives for |
|---|---|---|---|
| **1. Verbatim window** | the last ~10 exchanges, word for word | ≈3k input tokens | 30 minutes |
| **2. Durable profile** | ~2 KB distilled per PERSON | ≈500 input tokens | until corrected |
| **3. Archive + recall** | raw turns, searchable on demand | **zero** | 90 days |

⚠️ **The tiers are not a hierarchy of quality, they are a hierarchy of PRICE.**
Tier 1 is the most useful and the most expensive, so it stays small and
short-lived. Tier 3 is the cheapest and the least used, so it can be large. Tier
2 is the only new thing paid for continuously, which is why its cap is the
number this design argues hardest about.

---

## 1. Tier 1 — the verbatim window, UNCHANGED

Already built and live (`packages/gabi-conversation`). Nothing in this design
touches it:

| Constant | Value |
|---|---|
| `CONVERSATION_WINDOW_MS` | 30 minutes since the last word |
| `CONVERSATION_MAX_EXCHANGES` | 10 (= 20 turns) |
| `CONVERSATION_TURN_CHARS` | 600 per turn |
| Key | `(surface, space, person)` |

⚠️ **The 30-minute forget stays**, and it is not a limitation this design is
working around — it is what keeps tier 1 affordable. A window that never expired
would make turn 50 cost fifty times turn 1 under a cap that never noticed.

---

## 2. ⚠️ THE PROBLEM THIS DESIGN ACTUALLY HAS TO SOLVE FIRST

**There is no expiry EVENT today.** Nothing runs at the 30-minute mark. The
window is applied *lazily* — `pruneConversation` drops old turns the next time
somebody speaks — so a conversation that ends at 2:00 PM is not "closed" at 2:30,
it is simply never read again.

That matters because the whole of tier 2 hangs off "distil it when the
conversation goes quiet". **The trigger has to be built; it does not exist.**

Three candidates, and the tempting one is wrong:

| Trigger | Verdict |
|---|---|
| **Lazily, on the NEXT conversation's first turn** | ⚠️ **REJECT.** It is nearly free and it fails at exactly the moment the feature exists for: the first turn after a gap is *the* "not a fresh bot" moment, and this makes the profile stale precisely there — she would greet you with what she knew two conversations ago, then update. It also puts a model call on the critical path of a reply somebody is waiting for. |
| **A Durable Object alarm per conversation** | ⚠️ REJECT for now. The gateway DO's alarm is already load-bearing for socket reconnection (`ensureAlarm`), and a second purpose on one alarm means a due-time queue and a scheduler inside an object whose job is a WebSocket. Real complexity for no benefit over the next row. |
| **The `*/2 * * * *` cron that already runs** | ✅ **ADOPT.** It already fires every two minutes and already poking the gateway DO. A sweep is a storage prefix-list plus a filter on `updatedAt`. No new infrastructure, no new trigger, worst-case staleness two minutes. |

⚠️ **Distillation must be idempotent and marked**, because a cron that runs every
two minutes will see the same expired conversation again until it is cleaned up.
The record gets a `distilledAt`; the sweep skips anything already stamped and
deletes the record once the profile write succeeds. **A record deleted before the
profile write lands is a conversation lost silently** — so the order is: read →
distil → write profile → *then* delete.

---

## 3. Tier 2 — the per-person durable profile

### 3.1 What it is for, in one sentence

So that the first thing she says after a three-day gap is not the first thing she
said three days ago.

### 3.2 Schema, and the caps are part of it

```jsonc
{
  "v": 1,
  "person": "discord:123456789",       // or "estate:<email>" — see §3.3
  "identity": {
    "callMe": "Sky",                    // what they answer to
    "notes": ["prefers full stat sheets", "no permission questions"]
  },
  "reading": [                          // ⚠️ SOFT CLAIMS ONLY — see §3.4
    { "book": "The Primal Hunter 9", "said": "finished", "at": 1755561000000 }
  ],
  "threads": [                          // things left open
    { "what": "wanted PH 10-14 once processed", "at": 1755561000000 }
  ],
  "updatedAt": 1755561000000,
  "sources": 4                          // how many conversations fed it
}
```

| Cap | Value | Why |
|---|---|---|
| Whole document | **2 KB** serialised | ≈500 input tokens on EVERY turn. At 40 turns/day/person that is the tier's entire running cost, and it is what keeps this from becoming a second window. |
| `notes` | 6 entries, 120 chars each | a profile that grows without bound becomes a transcript |
| `reading` | 8 books | oldest dropped first |
| `threads` | 5 | ditto |

⚠️ **The cap is enforced on WRITE by dropping oldest-first, never by truncating
mid-value.** A half-written preference (*"prefers full stat sh"*) is worse than
no preference — it is unreadable to a model and invisible to a reviewer.

### 3.3 ⚠️ Per-person GLOBAL, and what "person" means

One profile per human, shared across DM, every channel, and the site panel — the
owner's requirement, and the reason tier 2 exists at all: a profile that reset per
channel would be tier 1 with extra steps.

⚠️ **The identity key is the problem to get right.** Discord gives a snowflake;
the panel gives a Firebase uid; the estate directory is keyed by **email**. The
`discord_links/{id}` document already joins the first to the third — that is the
same chain the docs and book lanes use for `on-behalf-of`.

> **Key the profile on the estate EMAIL where a link exists, and on
> `discord:<snowflake>` where it does not** — and when a link is later created,
> the unlinked profile is merged into the email one, once, and the old key
> deleted.

⚠️ That merge is a **migration, not an edit** by the estate's own rule (a
function that produces a persisted key). It gets a version stamp and a one-way
marker so it cannot run twice and double a person's notes.

### 3.4 ⚠️⚠️ READING STATE MUST NEVER FEED THE SPOILER BOUND

The single most dangerous line in this design, and the reason `reading` is called
a **soft claim**.

`gabi-book-knowledge-design.md` §4.3 is categorical: the ord ceiling is **derived
from the question every turn and never stored**, because a stored bound that
crossed a re-chunk leaked twenty-eight chapters past a reader's position with no
error anywhere. A per-person profile is, structurally, exactly the stored bound
that rule forbids — *if it is ever allowed to decide scope*.

So:

> **The profile may inform the CONVERSATION and must never inform the BOUND.**
> She may say *"last time you were partway through book 9"*. The spoiler ceiling
> still comes only from the sentence in front of her, every turn, exactly as it
> does today.

⚠️ **And when a real position store exists, it SUPERSEDES rather than argues.**
`readingPositions/{uid}_{bookId}` is the authority (design §4.2); the profile's
claim is a conversational memory of something somebody *said*. Every `reading`
entry therefore carries `said` and `at` — provenance, so the two can never be
mistaken for each other, and so a stale profile claim can be dropped in favour of
a real position without a merge rule.

### 3.5 The distillation call

One cheap model call at expiry, on the cron's thread — **never on a reply's
critical path**.

- **Input:** that conversation's turns, already clipped to 600 chars each, plus
  the CURRENT profile.
- **Output:** the whole new profile as JSON, validated against the schema and the
  caps before it is written. ⚠️ Invalid JSON is a **no-op**, logged — the old
  profile stands. A memory feature whose failure mode is *forgetting* is
  acceptable; one whose failure mode is *corruption* is not.
- **Model:** the same Haiku 4.5 the turns use. This is summarisation, not
  judgement.

⚠️ **The prompt's hard rules**, each of which is a failure this estate has
already had:

1. **Only this person.** Third parties named in her own replies are not facts
   about the asker. *(Channel-mates cannot leak in structurally — see §5 — but
   she can quote one, and the distiller must drop it.)*
2. **Preferences, not content.** *"Wants full sheets"* is a preference; the stat
   sheet itself is not, and belongs to tier 3.
3. **No availability claims, ever.** ⚠️ *"She has read up to book 9"* must never
   enter a profile. That is the confabulation of 2026-08-18 (§10d of the book
   design) given a **durable** home, and a remembered wrong claim is worse than a
   fresh one: it is wrong every turn instead of once, and it looks more
   authoritative for having been remembered. Availability is answered by a
   listing call in the turn that needs it, and by nothing else.
4. **Drop, do not guess.** An empty profile is a correct profile.

### 3.6 Transparency — seeing and clearing it

The owner's requirement, and non-negotiable: a person can see what she has
written down about them and correct or clear it.

**Ships first: `/gabi memory` in Discord** — because that is where she is, it is
an ephemeral reply (nobody else in the channel sees your profile), and the
command surface already exists. Three actions: **show**, **forget** (whole
profile), **forget this** (one note).

⚠️ **A profile with no way to see it is a dossier.** The show/clear affordance is
part of tier 2's first phase, not a follow-up — it ships in the same phase as the
writing does, and there is a test that the clear actually deletes rather than
hides.

Panel affordance is deferred (§8) — the profile is shared, so the Discord control
already clears what the panel would read.

---

## 4. Tier 3 — the archive and the recall tool

### 4.1 Storage: Firestore, and the argument

| Option | Verdict |
|---|---|
| **D1 on `discord-worker`** | ⚠️ REJECT. There is no D1 binding on this Worker, deliberately — `gabi-chat.ts` already records the reasoning for the accounting log: *"adding one for four columns would be new infrastructure on the credential-lightest Worker in the estate."* That argument is stronger here, not weaker. **And it is fatal on its own:** the site panel is a different Worker in a different repo, so a profile in discord's D1 could never be read by the panel — which breaks the per-person-global requirement outright. |
| **Durable Object storage** | ⚠️ REJECT. No queries — prefix listing only — so the recall tool could not be built on it. It would also pile 90 days of raw turns onto the one named object whose actual job is holding a WebSocket. |
| **Firestore** | ✅ **ADOPT.** |

Firestore wins on four counts, and the first is decisive:

1. ⚠️ **It is the only store BOTH GABI surfaces already reach.** Discord has
   `FIREBASE_SERVICE_ACCOUNT` (scope `datastore`) and the panel's instances share
   the audiobook catalogue's Firebase project. Per-person-global is a
   *requirement*, and this is the only option that satisfies it without new
   infrastructure on either side.
2. **The credential already exists**, already scoped, already the seam
   `firebase-sa.ts` established. **No new trust edge, no new secret, no new
   holder** — which is the estate's most expensive kind of change.
3. **It has queries.** The recall tool needs `where(person) + orderBy(at)`, which
   is one composite index.
4. **Native TTL policies** delete expired documents server-side (§4.3).

**Volume, sized rather than assumed:** a turn is ≤600 chars clipped; at a
generous 200 turns/day across the household that is ~120 KB/day, **≈40 MB/year**
— comfortably inside free-tier storage, and the 90-day retention holds it near
10 MB steady-state. Writes are ~200/day against a 20k/day free allowance.

### 4.2 Shape

```
gabi_conversations/{autoId}
  { person, surface, space, role, text, at, ref? }
```

⚠️ **One document per TURN, attributed per author** — not one per conversation.
Shared-channel turns are therefore already separated by person, which is what
makes §4.4's privacy rule enforceable with a `where` clause rather than a filter
somebody has to remember.

### 4.3 Retention — one config value

```ts
export const ARCHIVE_RETENTION_DAYS = 90;   // owner-accepted starting number
```

⚠️ **ONE constant, and everything derives from it.** The document carries an
`expiresAt` computed from it at write time, and a Firestore **TTL policy** on
that field does the deleting server-side.

- ⚠️ Creating the TTL policy is an **owner/console step** (§9), not something a
  Worker can do. Until it exists, documents accumulate — which is safe, visible,
  and reversible.
- **Fallback if the policy is not wanted:** a sweep on the existing cron, deleting
  the oldest expired page per run. Same constant drives it.
- ⚠️ **Changing the number does not retro-delete**: `expiresAt` is stamped at
  write. Lowering retention affects new turns only, and a real purge is a separate
  deliberate job. Written down because "we changed it to 30 days" will otherwise
  be believed to have shortened the past.

### 4.4 The recall tool

A **fifth allowlist array** — `GABI_RECALL_TOOL_NAMES` — beside Tier 0
(catalogue), 0b (docs), 0c (book text) and Tier 1 (delegated writes). The same
reason as every previous one: **what it reads is different**, and here it is *a
person's own past words*.

| Tool | Does |
|---|---|
| `recall_conversation` | `{query, since?}` → matching past turns of **the asker's own** conversations, with dates |

⚠️ **PRIVACY IS A `where` CLAUSE, NOT A PROMPT INSTRUCTION.** The query is
constructed with the asker's own person key server-side, in the executor. A model
cannot ask for somebody else's history because there is no parameter that would
carry it. *"Scoped to the asker"* enforced by wording would be one prompt
injection away from a household member reading another's conversations.

⚠️ **Zero per-turn cost** — it is a tool, so it costs only when a question is
about the past. It is not injected into the prompt.

---

## 5. ⚠️ Privacy posture, per tier

| | Who can see it | How that is enforced |
|---|---|---|
| **Tier 1** | the person, in their own conversation | the key is `(surface, space, person)` |
| **Tier 2** | the person; shown on request | built from one person's record only |
| **Tier 3** | the person, via recall | a `where` on the person key, server-side |

⚠️ **The no-leakage requirement is already satisfied by construction, and that is
worth stating rather than re-implementing.** The conversation key has *always*
included the author, so a channel with five people talking to her holds **five
separate records**, not one. A profile distilled from one record therefore cannot
contain a channel-mate's messages — the requirement costs nothing because the
existing key shape already pays it.

What is NOT free, and is handled in the distillation prompt (§3.5 rule 1): **her
own replies can mention other people**. *"Sam asked about that too"* is in the
asker's record and must not become a fact in the asker's profile.

---

## 6. What changes in the turn prompt

Exactly one block, and only when a profile exists:

```
What you already know about the person you are talking to (from earlier
conversations — they can see and clear this):
<= 2 KB of profile

- Use it to avoid asking what they already told you.
- ⚠️ It is a memory of what they SAID, not a fact you looked up. Never state
  anything from here as a checked fact, and never let it decide what you have
  read — a listing call in this turn decides that, always.
```

⚠️ **The second bullet is the whole safety story of tier 2**, and it is the
2026-08-18 confabulation rule extended to a durable substrate. Availability and
spoiler scope are both re-derived per turn; the profile is colour, never
evidence.

---

## 7. Cost table

Per turn, Haiku 4.5 at $1/MTok in, $5/MTok out.

| Tier | Added input tokens/turn | ¢/turn | Notes |
|---|---|---|---|
| 1 (existing) | ≈3,000 at a full window | ≈0.30¢ | unchanged |
| **2 (new)** | **≈500** | **≈0.05¢** | the only new continuous cost |
| 3 (new) | **0** | 0 | tool-only |

Per conversation, not per turn:

| Event | Cost |
|---|---|
| Distillation at expiry | one call, ≈3k in + ≈300 out ≈ **0.45¢** |
| Archive write | 1 Firestore write per turn (free tier: 20k/day) |
| Recall invocation | ≈1k in for the results, only when asked |

⚠️ **Tier 2 raises a book turn's cost by roughly a sixth of a percent of a cent.**
The number that matters is not this one — it is the 2 KB cap that produces it, and
the reason §3.2 enforces the cap by dropping rather than truncating.

---

## 8. What is deliberately NOT built

- **No cross-person memory.** She never learns about you from somebody else's
  conversation. Not a cap — a rule.
- **No semantic/embedding search over the archive.** Recall is lexical. Vectorize
  is out of scope here for the reason it is out of scope in the book design.
- **No free-text profile editing.** Show, forget-all, forget-one. An "edit my
  profile" box is a way to write anything into a prompt every turn.
- **No panel affordance in phase 1.** The profile is shared, so the Discord
  control already clears what the panel reads.
- **No profile-driven proactivity.** She does not open with *"still reading book
  9?"* unprompted. That is a different product decision and a different consent
  question.
- **No memory of tool RESULTS.** Retrieved book passages are never distilled into
  a profile — design §8 of the book doc forbids writing them to the conversation
  window, and a profile is a more durable version of that window.

---

## 9. Rollout order, and what the owner has to do

| Phase | What | Ships |
|---|---|---|
| **1** | Profile store + distillation on the cron + the prompt block + `/gabi memory` show/clear | dark behind `GABI_MEMORY`, affirmative-only |
| **2** | Archive writes | dark behind the same posture; writing before recall exists means recall has something to find on day one |
| **3** | `recall_conversation` + its allowlist array and pinning test | dark, then on |
| **4** | Identity merge on first `/link` after a profile exists | needs phase 1 in the wild |

⚠️ **Phase 2 before phase 3 on purpose.** A recall tool shipped first would be
correct and useless — it would search an empty archive and answer *"I have
nothing from before today"*, which reads exactly like a bug.

**Owner steps** (nothing below can be done from a session):

1. **Flip `GABI_MEMORY=on`** when phase 1 is verified — deliberate, never a deploy
   side effect, the `GABI_BOOKS` precedent.
2. **Create the Firestore TTL policy** on `gabi_conversations.expiresAt` (console
   or `gcloud`), or say the cron fallback is preferred.
3. **Confirm 90 days** once it has run for a week and the archive's real size is
   measured rather than estimated.

**Review link when phase 1 lands:** Discord — `@GABI /gabi memory`, and a
conversation resumed after a gap.

---

## 10. ⚠️ Limitations and what is NOT verified

- ⚠️ **Nothing here is built.** No collection, no policy, no tool, no posture.
- **Every token and cent figure is arithmetic**, not an invoice — `bytes ÷ 4` and
  the published rate table, the same estimate class `estimateCents` already
  carries.
- **The 40 MB/year archive figure is derived** from the 600-char clip and an
  assumed 200 turns/day. The turn count is a guess; the clip is measured.
- **Distillation quality is unmeasured.** No prompt has been run. The first week
  should be graded by reading real profiles, and the 2 KB cap re-argued then.
- ⚠️ **The identity merge (§3.3) is the riskiest piece** and is deliberately last.
  Two people sharing one profile is the failure mode to fear, and it comes from a
  wrong key, not from a wrong merge.
- **Firestore TTL policy latency is vendor-published** (deletion within 24h of
  expiry), not measured here. Retention is therefore "90 days, then soon after".
