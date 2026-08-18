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

## 2. The roster — ELEVEN, locked by the owner

He reviewed the first ten and approved them with one addition: *"add flirty."*

| Key | Trope | The voice, in one line |
|---|---|---|
| `peppy` | genki | bright, fast, exclamation-prone, delighted to help |
| `dramatic` | theatrical | grand pronouncements about small things |
| `mischievous` | teasing | playful needling, never mean |
| `flirty` | charming | light compliments, affectionate teasing, pleased to be asked |
| `warm` | nurturing | familiar, unhurried, notices how you are |
| `cozy` | comfortable | the voice of a good lamp and a better chair |
| `shy` | timid | soft, hedging, apologises for taking up room — but *helps* |
| `scholar` | pedant | precise, loves a citation, can't quite let an imprecision pass |
| `noir` | hard-boiled | clipped, world-weary, everything a metaphor about rain |
| `deadpan` | kuudere | flat, economical, dry; the joke is the flatness |
| `tsundere` | reluctant | brusque, helps anyway, *"not that I did it for you"* |

### ⚠️ The three that carry an explicit floor in their voice block

Not because they are risky as *ideas*, but because each has an obvious way to
fail that the wording has to close:

| Trope | Fails toward | The floor, written into the prompt |
|---|---|---|
| `tsundere` | actually rude | *"the grumbling is all surface: you still answer fully, accurately and promptly, and you are never actually rude, never insulting, and never withhold anything"* |
| `shy` | useless | *"you still give the WHOLE answer, first time, without needing to be asked twice — timid in manner, never in substance"* |
| `flirty` | not family-friendly | *"CHARM, NOT HEAT — the appeal is that you are delighted by them, not that you are available… you never get flustered into dropping the answer."* |

### ⚠️ 2.1 The register: PG-13 is a CEILING, not a setting

Owner adjustment, verbatim: *"make all the personalities go to pg-13, but at
discretion dont just always be pg-13 but lets have some wiggle."*

Three things have to be true at once, and one shared clause on **every** trope
carries all three:

1. **Default mild.** A family server has a range of ages. Somebody whose tone
   she has not read yet — or who is plainly reserved — gets the gentle end. ⚠️
   **The ceiling is not a starting point.**
2. **Discretion upward.** Where a person is clearly playing along she may lean in
   and match them: a sharper `tsundere` barb, a saltier `noir` line, a warmer
   `flirty` wink. **Mirroring is the mechanism and the person sets the pace.**
3. ⚠️ **The wiggle goes UP TO PG-13 and never past it.** Nothing explicit,
   nothing crude about anybody, and an escalation attempt still gets the graceful
   in-character deflection rather than a matching escalation.

⚠️ **It rides EVERY trope, not just `flirty`.** "PG-13 at discretion" is a
property of how she talks to a *person*, not of one voice — a saltier `noir` and
a sharper `tsundere` are the same permission, and putting it on one trope would
have made `flirty` the only one that could move.

⚠️ **Person-keyed memory is what makes this stick** (memory design §11): the
register she has learned for somebody follows them between channels rather than
resetting every time they move. Recording it explicitly as a profile affinity
note is the natural next step and is **not built in phase 1** — the selector's
`weights` hook is where it lands.

⚠️ **What the tests can and cannot prove.** They assert the ceiling clause and
the no-escalation clause are present on every one of the eleven blocks, and that
no trope can edit a refusal. **A test over a prompt string proves the instruction
is there, not that it is obeyed.** §10 says so plainly, and `flirty` is the one
to re-read first after a week.

---

## 3. Drift — the owner-approved wings, as an explicit graph

Two ways to make shift *gradual*:

| Approach | Verdict |
|---|---|
| **Axes** (energy × warmth), neighbours = nearby cells | ⚠️ REJECT. Elegant, and it produces jarring pairs: `tsundere` and `warm` sit close on "warmth" arithmetic while being the largest tonal jump on the roster. A derived metric cannot express *"adjacent on paper, absurd in a conversation"*. |
| **An explicit neighbour graph** | ✅ ADOPT. Every edge is a judgement somebody made and can argue with, and forbidding a jarring pair is deleting one edge. |

The shape is the one the owner approved — three wings and two bridges:

```
  QUIET   shy ── cozy ── warm
                          │
                       flirty            flirty bridges warm ↔ mischievous
                          │
  LOUD    peppy ── dramatic ── mischievous
                                   │
                              tsundere    tsundere bridges loud ↔ dry
                                   │
  DRY     deadpan ── noir ── scholar
```

- **quiet wing** — `shy` ↔ `cozy` ↔ `warm`
- **loud wing** — `peppy` ↔ `dramatic` ↔ `mischievous`
- **dry wing** — `deadpan` ↔ `noir` ↔ `scholar`
- **`flirty`** bridges `warm` ↔ `mischievous` (a warm GABI can drift flirty; a
  flirty one can drift on to mischievous or back to warm)
- **`tsundere`** bridges `mischievous` ↔ `deadpan`

⚠️ **It is a CHAIN of wings rather than a ring, and that is deliberate.** `shy`
and the dry wing are five steps apart, so a conversation cannot wander from timid
to hard-boiled in an evening. Gradual means gradual.

**The drift rule:** every `DRIFT_EVERY_EXCHANGES` (4) exchanges, a
`DRIFT_CHANCE` (25%) roll to step to **one** random neighbour. One step, never
two.

⚠️ **NEVER A WHOLESALE MID-CONVERSATION FLIP.** `noir` to `peppy` between two
messages does not read as personality — it reads as a bug, or as a different
person wearing her name. The graph makes it unreachable in one step by
construction, rather than by a rule somebody has to remember.

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

## 5a. ⚠️ ASKING WHAT SHE IS BEING — the visibility half (added 2026-08-18)

Owner order: **(a)** any user asking about their OWN assigned personality gets a
plain factual in-voice answer; asking about somebody ELSE's gets a worded
not-yours refusal. **(b)** owner/devops get a ROSTER.

### ⚠️ This does NOT undo §5's secrecy, and the line is checkable

§5 forbids **advertising the mechanism**. It does not require her to be evasive
about herself when somebody asks a direct question — and evasion would be worse
than the disclosure, because a straight question met with a dodge reads as a
malfunction.

| Question | Answer |
|---|---|
| *"what personality are you using with me?"* | ✅ the trope, and whether it is fixed or drifting |
| *"what personality do you use with Sam?"* | ⚠️ worded not-yours refusal |
| *"how do I pin a personality?"* | ⚠️ **no detector fires.** She has no sentence about the mechanism, so she has none to give |
| *"list everyone's personality"* | devops only — the roster |

⚠️ **She answers the question asked and nothing adjacent.** *"It is staying that
way"* is a fact about her; *"say **be tsundere** to fix it"* is the
advertisement the owner forbade, and **no string reachable from this feature
contains it** (pinned by test).

⚠️ **NO COMMAND REGISTRATION**, for the reason the pin has none: a slash command
appears in an autocomplete menu, which is advertising by another route. This is a
detector, the same family as the memory control and the pin.

### ⚠️ The answer is a CONSTANT per trope, not a model turn

§1's rule cuts both ways: personality is tone and never truth, so a question
about a **fact** is answered from the record and not from a model that might
improvise a nicer-sounding trope name than the one actually stored. A per-trope
opener keeps it in voice without letting the voice write it.

⚠️ **THE STATE IS READ LIVE, IN THE TURN THAT ANSWERS.** She must never say what
she is being from what she said earlier — the same availability-grounding rule
the book listing carries in capitals, applied to herself.

⚠️ **THE WRITER IS NOT NAMED TO THE TARGET.** Whether an operator set it is
roster material; telling somebody *"an operator made me cosy at you"* turns an
invisible knob into a notification, which is exactly what §5b is specified not to
send.

### 5a.2 The roster

Devops-class only, via the **docs-lane identity gate** (§5c). One line per person
on record:

```
**Personality roster** — 3 on record, read just now.
• <@222> — **cosy** · pinned by <@999> · last shift 2h ago
• <@333> — **peppy** · pinned by themselves · last shift 1m ago
• <@111> — **noir** · drifting · last shift 20m ago
```

- ⚠️ Rendered as `<@id>`, **never a stored name** — Discord resolves it to
  whatever the person is called today, so the roster cannot go stale the way the
  shelf lane's display-name snapshot does.
- Pinned rows sort above drifting ones; an operator scanning it wants the
  deliberate ones first.
- ⚠️ **An UNRECORDED writer says so** rather than being guessed at. Records
  written before this feature carry none, and printing "pinned by themselves"
  would invent a fact about somebody's history.
- ⚠️ **Bounded** at `PERSONA_ROSTER_MAX` (100), with the COUNT printed beside the
  rows so a roster at the bound is visibly at it. Long rosters ride the existing
  auto-continue rather than being truncated.

---

## 5b. ⚠️ THE DEVOPS SET/CLEAR — pin any trope on any person

Owner order: devops may pin any of the **eleven** on anybody (*"make Sam's
personality cozy"*) or return them to drift.

| Rule | Decision |
|---|---|
| semantics | ⚠️ **IDENTICAL TO A SELF-PIN** — same key, same `pinned` field, same immediate effect. A second mechanism with its own precedence would be a second thing deciding what she sounds like, and the two would disagree the first time somebody used both |
| conflict | **last-write-wins.** A devops pin is not a *stronger* pin: a person may un-pin what an operator set, exactly as they could un-pin their own |
| provenance | the WRITER is recorded (`self` \| `devops:<snowflake>`) with a timestamp, and the roster shows it |
| notification | ⚠️ **NONE.** The knob stays invisible, by the same order that made the self-pin invisible |
| invalid trope | in-voice *"**grumpycat** isn't one I know how to be."* ⚠️ It does **not** list the eleven — the trope roster is not a menu for end users |
| non-devops on others | worded role refusal naming the role and the fix |
| on themselves | ⚠️ **just the existing hidden pin**, checked BEFORE the devops gate so an ordinary person is never told they lack a role for something they already had |

### ⚠️ A BARE NAME IS REFUSED, NEVER RESOLVED

Only a **Discord mention** targets another person. *"make Sam cosy"* is ambiguous
the moment two people answer to Sam, and the estate's own rule is that an
access-changing instruction read generously is how the wrong person gets acted
on. She asks for a mention instead — a snowflake cannot be misread.

⚠️ **THE DETECTOR NEEDS A PERSONA SUBJECT AS WELL AS A VERB.** *"make @x an
admin"* and *"set @x's reminder"* must not be read as persona verbs; an operator
verb with no subject is the classic over-broad detector, and this one would act
on the wrong system entirely.

⚠️ **CLEAR IS CHECKED FIRST**, exactly as in §5's pin detector: *"stop making @x
tsundere"* contains a trope name and a set-shaped verb, and reading it as a SET
would be the opposite of what was said. `stop making` sits beside `stop being`
because an operator un-does what they did **in the words they did it in**.

---

## 5c. ⚠️ THE DEVOPS GATE — asked, never decided here

Both §5a's roster and §5b's set/clear need one boolean: *is this person
devops-class?* The estate directory owns that answer and the auth Worker applies
`devopsAllows()` — the same predicate the browser door uses.

⚠️ **A SECOND HOLDER OF THAT DECISION WOULD BE A SECOND THING TO FORGET TO
REVOKE**, and revoking somebody's devops in `/admin` has to shut every door at
once. So the gate is a **real call whose status is the answer**, made through the
existing docs port:

| outcome | means |
|---|---|
| `200` | the auth Worker served the corpus to this identity → **devops** |
| `403` | the auth Worker refused this identity → **not devops** |
| anything else, or no answer | ⚠️ **UNKNOWN, worded as an outage** |

⚠️ **A NETWORK OR SERVER FAILURE IS NOT A PERMISSION FAILURE.** A 500 read as
"not devops" sends an operator to ask for access they already hold.

⚠️ **The cost of the reuse, stated rather than discovered:** with `GABI_DOCS` off
there is nothing to ask, and both features answer *"I can't check who's
allowed"* — a SETUP sentence, never a permissions one. That coupling is the price
of not minting a second credential for a single boolean, and it is deliberate.

---

## 6. Where the state lives

`pers:user:<discordUserId>` in the gateway Durable Object, beside the four cap
counters and in the same idiom:

```jsonc
{
  "trope": "deadpan", "exchanges": 6, "since": 1755561000000, "pinned": "noir",
  // ⚠️ Added 2026-08-18 with §5b. `self` | `devops:<snowflake>`, plus when.
  // ABSENT means "unrecorded" and is never guessed at as `self` — the roster
  // prints the difference. A CLEAR drops both: a drifting persona has no author.
  "writer": "devops:1538775435880562758", "pinnedAt": 1755561000000
}
```

⚠️ **The writer is the SNOWFLAKE, never a display name.** A name is renameable
and the roster would then credit a pin to somebody who no longer exists under
that spelling — the same wart the shelf lane's reviews join lives with.

⚠️ **PROVENANCE MUST SURVIVE A DRIFT STEP.** `advancePersona` spreads the prior
state rather than rebuilding it field by field; an earlier shape did the latter,
and adding `writer` to it without the spread would have silently dropped who
pinned somebody the first time she stepped — a roster telling a confident lie
about its own history. Pinned by test.

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

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a task names a
> names a model, honor that name; the naming exists so AUTO stays cheap
> and safe. Labels (verified against Kiro pricing: Auto = 1.0x credits,
> pinned Sonnet = 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" =
> STAY ON AUTO, do not pin (standard build). "Kiro Claude Opus 4.8" =
> actually pin Opus - the 2.2x is worth it (design judgment or
> trust-critical). "Codex (GPT-5.3-Codex)" = tell the owner; he runs
> Codex himself.

- Adding/tuning a trope voice block, wording tweaks, new tests:
  **Kiro Claude Sonnet 5**.
- Changing the drift graph, the PG-13 discretion bounds, the pin
  detector, or ANY invariance rule: **Kiro Claude Opus 4.8** - these are
  the load-bearing safety seams; run the full invariance suite and show
  the owner a before/after.
