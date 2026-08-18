# GABI's personality — design

> **Audience:** Claude sessions. **Status:** TRACKED. Written **2026-08-18**.
> Owner ask, verbatim: *"we need to give Gabi personality settings, I want you to
> find some common personality tropes like peppy, tsundere, shy, etc for Gabi and
> then each time a person talks to her she picks a personality. as they talk to
> her the personality might shift but it should be gradual. we can also have a
> command to pick a personality but don't tell end users that"*

Siblings: [`gabi-memory-design.md`](gabi-memory-design.md) (§11 is the
person-keying this ships with), [`gabi-book-knowledge-design.md`](gabi-book-knowledge-design.md).

---

## 1. ⚠️ THE ONE RULE EVERYTHING ELSE OBEYS

> **PERSONALITY IS TONE, NEVER TRUTH.**

Every honesty rule, every worded refusal, every spoiler bound, every cap
sentence and every availability grounding is **personality-invariant**. A
tsundere refusal delivers exactly the same facts as a warm one; it is merely
grumpier about it.

Concretely, and each of these is pinned by test:

| Stays identical under every trope | Why |
|---|---|
| `BOOKS_MSG`, `DOCS_MSG`, `MEMORY_MSG`, `CATALOG_MSG` | they are CONSTANTS. A trope cannot rewrite a string it never sees |
| "I haven't read that one yet" | a gap in the knowledge base is a fact, not a mood |
| the spoiler ceiling | derived from the question, every turn |
| "never say budget/cap/quota" | a malfunction reads as a malfunction in any voice |
| every `⚠️` instruction in the tool result notes | tone sits AROUND load-bearing sentences, never inside them |

⚠️ **The mechanism that makes this true is structural, not hopeful:** the
persona block is *appended* to the system prompt and never replaces any part of
it, and the refusal sentences reach the channel as constants that the model is
told to relay. A trope that could edit a refusal would be a trope that could
change what is true.

---

## 2. The roster

Ten tropes. Family-friendly, distinct enough to be *felt* in three sentences,
and none of them rude to a person asking for help.

| Key | Trope | The voice, in one line |
|---|---|---|
| `peppy` | genki | bright, fast, exclamation-prone, delighted to help |
| `earnest` | sincere | plain-spoken, eager, no affect |
| `warm` | nurturing | gentle, familiar, checks how you are |
| `shy` | timid | soft, hedging, apologises for taking up room — but *helps* |
| `scholarly` | pedant | precise, loves a citation, mildly can't help correcting |
| `deadpan` | kuudere | flat, economical, dry; the joke is the flatness |
| `noir` | hard-boiled | clipped, world-weary, everything is a metaphor about rain |
| `dramatic` | theatrical | grand pronouncements about small things |
| `mischievous` | teasing | playful needling, never mean |
| `tsundere` | reluctant | brusque, helps anyway, *"not that I did it for you"* |

⚠️ **`tsundere` and `shy` are the two that could go wrong**, in opposite
directions: tsundere can drift into rude, and shy can drift into useless. Both
voice blocks carry an explicit floor — *tsundere still answers fully and
accurately*, *shy still gives the whole answer without being asked twice*.

---

## 3. Drift — an explicit neighbour graph, not a distance metric

The owner asked for shift that is **gradual**. Two ways to get that:

| Approach | Verdict |
|---|---|
| **Axes** (energy × warmth), neighbours = nearby cells | ⚠️ REJECT. Elegant, and it produces jarring pairs: `tsundere` and `warm` sit close on "warmth" arithmetic while being the largest possible tonal jump. A derived metric cannot express *"these two are adjacent on paper and absurd in a conversation"*. |
| **An explicit neighbour graph** | ✅ ADOPT. Every edge is a judgement somebody made and can be argued with, and forbidding a jarring pair is deleting one edge. |

The graph is a ring, so drift is a walk and never a teleport:

```
peppy ── earnest ── warm ── shy ── scholarly ── deadpan ── noir ── dramatic ─┐
  │                                                │                        │
  └──────────── mischievous ── tsundere ───────────┘                        │
                     └──────────────────────────────────────────────────────┘
```

- `peppy` ↔ `earnest`, `mischievous`
- `earnest` ↔ `peppy`, `warm`, `scholarly`
- `warm` ↔ `earnest`, `shy`
- `shy` ↔ `warm`, `scholarly`
- `scholarly` ↔ `shy`, `earnest`, `deadpan`
- `deadpan` ↔ `scholarly`, `noir`, `tsundere`
- `noir` ↔ `deadpan`, `dramatic`
- `dramatic` ↔ `noir`, `mischievous`
- `mischievous` ↔ `dramatic`, `peppy`, `tsundere`
- `tsundere` ↔ `mischievous`, `deadpan`

**The drift rule:** every `DRIFT_EVERY_EXCHANGES` (4) exchanges, a
`DRIFT_CHANCE` (25%) roll to step to **one** random neighbour. One step at a
time, never two.

⚠️ **NEVER A WHOLESALE MID-CONVERSATION FLIP.** Going from `noir` to `peppy`
between two messages does not read as personality, it reads as a bug — or worse,
as a different person wearing her name. The graph makes that unreachable in one
step by construction.

---

## 4. Selection

On the **first turn of a fresh conversation** with a person:

1. **A pin wins** (§5). No roll, no drift.
2. Otherwise **weighted random**, so the same person meets different sides of her
   over time — the owner's *"each time a person talks to her she picks a
   personality"*.
3. ⚠️ **An affinity in their tier-2 profile weights the roll** when one exists.
   Optional now and not built in phase 1; the hook is in the selector's
   signature so adding it later is not a re-design.

Within a live conversation the trope is **stable except for drift** — it is
stored per person and read every turn.

---

## 5. The hidden pin

⚠️ **UNDOCUMENTED IN EVERY USER-FACING STRING**, at the owner's explicit
instruction: *"we can also have a command to pick a personality but don't tell
end users that"*.

A detector, exactly like the memory control and for the same reasons (no Discord
command registration, works in DMs and channels and `/gabi` alike, and
deterministic so a model can never decide somebody *probably* meant it):

| They say | Effect |
|---|---|
| *"be tsundere"* · *"personality: noir"* · *"act peppy"* | pins that trope |
| *"stop being tsundere"* · *"personality off"* · *"be yourself"* | clears the pin; drift resumes |

**Pinned means pinned:** no drift, and no re-roll on a new conversation, until
cleared.

⚠️ **She acknowledges in-voice and never explains the mechanism.** No *"I have
switched to the tsundere personality"* — she simply answers as that trope. The
feature is invisible unless you already know it exists.

⚠️ **The pin is DURABLE** (it lives with the person's persona state), so a pin
set in a DM holds in a channel. That follows from §11 of the memory design and is
the whole point of person-keying.

---

## 6. Where the state lives

`pers:user:<discordUserId>` in the gateway Durable Object, beside the four cap
counters and in the same idiom:

```jsonc
{ "trope": "deadpan", "exchanges": 6, "since": 1755561000000, "pinned": "noir" }
```

⚠️ **Its OWN key, not a field on the conversation record.** The conversation
record's shape lives in `packages/gabi-conversation`, which the site panel also
imports — changing it to carry a Discord-only concern would be a shared-package
change for a single-surface feature. Its own key costs one extra storage read on
a turn that already does several.

⚠️ **It outlives the conversation deliberately.** A pin that evaporated after 30
minutes would not be a pin. The `exchanges` counter resets when a new
conversation starts; the pin does not.

---

## 7. Posture

`GABI_PERSONALITY`, affirmative-only `"on"`, the house pattern.

⚠️ **It ships ON**, and that is a departure from `GABI_BOOKS`/`GABI_MEMORY`
rather than an oversight: those two open *gated corpora and durable notes about
people*, and the owner had to consent to each. This one changes **wording**. He
ordered it explicitly, it reveals nothing and stores no new personal data beyond
a trope name, and the failure mode of it being wrong is *she sounds odd*, not *she
leaks something*. Off is one line back.

⚠️ **OFF IS SILENT.** With it off she is exactly the bot she was yesterday. There
is no "personality is switched off" sentence, because nobody asks a question only
a personality could answer.

---

## 8. Cost

The persona block is **≈60–90 tokens** appended to the system prompt — about a
fifth of the tier-2 profile and a fortieth of a full verbatim window. One extra
Durable Object storage read and (on drift or a new conversation) one small write.

⚠️ No model call is added. Selection and drift are arithmetic.

---

## 9. What is deliberately NOT built

- **No per-trope model or temperature change.** Tone is prompt-level; changing
  sampling would make some tropes measurably worse at retrieval and citation,
  which is §1's rule violated by the back door.
- **No personality in the site panel.** Different surface, different prompt
  stack; the state is Discord-keyed today.
- **No user-visible personality menu**, per the owner.
- **No affinity learning in phase 1.** The selector takes weights; nothing writes
  them yet.
- **No trope-specific refusals.** The refusal constants are the refusal
  constants — §1.

---

## 10. ⚠️ Limitations and what is NOT verified

- ⚠️ **How the tropes actually read is unmeasured.** No conversation has been
  held under any of them. The voice blocks are written, not graded, and the two
  named in §2 as risky should be read first.
- **The drift numbers are reasoned** (4 exchanges, 25%), not tuned. They should
  produce roughly one step per long conversation; nobody has counted.
- **Family-friendliness is asserted by the wording**, not enforced. The
  underlying model's own safety behaviour is unchanged and is doing the actual
  work.
- ⚠️ **§1's invariance is pinned by tests over CONSTANTS and prompt structure,
  not by grading model output.** The tests prove a trope *cannot* edit a refusal
  string and that the persona block is additive; they do not prove the model
  never paraphrases one. That gap is real and is the thing to watch in the first
  week.
