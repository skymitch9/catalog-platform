# GABI's personality (and person-keyed conversations) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (this repo is PUBLIC).
> Last verified: **2026-09-01** — §9 (the intensity dial) built, tested and
> deployed this session; §§1–8 last checked live **2026-08-18** and NOT
> re-measured today. ⚠️ **Nobody has heard her at `full` yet** (§9.5).
> ⚠️ **The pin in §4 is deliberately UNDOCUMENTED to end users** — it lives here
> and in `docs/info/` only. Do not put it in any user-facing text.

Design: [`../info/gabi-personality-design.md`](../info/gabi-personality-design.md)
and [`../info/gabi-memory-design.md`](../info/gabi-memory-design.md) §11.

---

## 1. The levers

| Lever | Where | Ships |
|---|---|---|
| `GABI_PERSONALITY` | `apps/discord-worker/wrangler.toml` | **`"on"`** |
| `GABI_EDGE` | same | **`"full"`** (owner ask 2026-09-01 — §9) |
| `GABI_MEMORY` | same | `"on"` (owner flipped it 2026-08-18) |

⚠️ **Personality ships ON and the other postures do not.** It changes *wording*;
`GABI_BOOKS` and `GABI_MEMORY` open a gated corpus and a durable note about a
person. Off is one line back, and off is silent — nobody asks a question only a
personality could answer.

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_personality_enabled, gabi_personality_tropes, gabi_conversation_scope, gabi_edge
```

Expect `True`, 11 tropes, `person`, and **`full`**.

---

## 2. The roster (owner-locked, 11)

`peppy` `dramatic` `mischievous` `flirty` `warm` `cozy` `shy` `scholar` `noir`
`deadpan` `tsundere`

⚠️ **Adding or removing one is an owner decision, not an edit.** The set was
reviewed and approved as a whole, and `flirty` was his own addition.

---

## 3. How it moves

- **Fresh conversation** → a pin if there is one, otherwise a weighted roll.
- **Every 4 exchanges** → a 25% chance to step to **one neighbour**.
- ⚠️ **Never a wholesale flip.** The graph is three wings and two bridges; `shy`
  and the dry wing are five steps apart on purpose.

State lives at `pers:user:<discordUserId>` in the gateway Durable Object —
**its own key**, because the conversation record's shape is shared with the site
panel and because a pin must outlive a 30-minute conversation.

---

## 4. ⚠️ The hidden pin — DO NOT ADVERTISE

| Say | Effect |
|---|---|
| *"be tsundere"* · *"personality: noir"* · *"act flirty"* | pins it — no drift, no re-roll |
| *"stop being tsundere"* · *"personality off"* · *"be yourself"* | clears it |

⚠️ **She acknowledges in-voice and explains nothing.** There is no confirmation
naming the feature; a test asserts no acknowledgement contains "personality",
"persona", "mode" or "setting", and that no user-facing string mentions it.

⚠️ **The pin is durable and person-keyed**, so one set in a DM holds in every
channel.

---

## 5. Person-keyed conversations

The conversation key is now `(discord_person, all, <snowflake>)` — **one thread
per person, everywhere**. A DM and every channel are the same conversation.

⚠️ **The identity is the SNOWFLAKE, never the display name.** A username is
renameable; keying on it would split somebody's memory the day they renamed and
merge two people if a name were reused.

**The migration was "do nothing", and the sweep finishes it.** Old
channel-scoped records are never read again; with a 30-minute window they are
dead within half an hour of the deploy, and the distillation sweep now deletes
expired records **in both postures** (only the distilling is gated). Without that
they would linger for ever, because the old prune fired on the *read* path.

---

## 6. ⚠️ The posture on private context in public channels

Person-keying means something said in a **DM** can inform a reply in a **public
channel**.

- **It is NOT a leak of other people's content.** The key has always included the
  author, so only that person's own words and her replies to them travel.
- **It IS** a case where a private remark could be referenced where family can
  read it.

**The guard:** in a public channel she may *use* what she knows privately but
must not **quote or restate** it.

⚠️ **This is PROMPT-LEVEL, not enforced.** Enforcing it needs per-turn surface
provenance on every stored turn — a shape change to the shared conversation
package, for a risk this family-server context makes small. If the server ever
stops being family-only, that is the change to make.

---

## 7. Gotchas

- ⚠️ **"She has a different personality than yesterday" is the feature.** A fresh
  conversation re-rolls. If somebody wants stability, pin it (§4).
- ⚠️ **"She keeps drifting mid-chat" should be rare** — 25% every 4 exchanges,
  one step. If it looks faster than that, check `DRIFT_EVERY_EXCHANGES`.
- ⚠️ **PG-13 is a CEILING, not a register.** Default mild; she leans in only
  where somebody is clearly playing along, and never past that line. The clause
  is on all eleven blocks, not just `flirty`.
- ⚠️ **If a refusal ever reads differently under a trope, that is the bug to
  chase and it is serious.** Refusals are constants relayed verbatim; the persona
  block is appended, never substituted. Both are pinned by test.
- **`pers:user:*` keys are not cleaned up** when somebody leaves the server. They
  are tiny (one trope name and two numbers) and nothing reads them for an absent
  person.


---

## 8. ⚠️ VISIBILITY AND THE DEVOPS SET/CLEAR (added 2026-08-18)

Design: [`../info/gabi-personality-design.md`](../info/gabi-personality-design.md)
§§5a, 5b, 5c.

### 8.1 What anybody may ask

| They say | She does |
|---|---|
| *"what personality are you using with me?"* · *"are you pinned?"* | ✅ answers plainly, **in voice**: the trope, and whether it is fixed or drifting |
| *"what personality do you use with Sam?"* | ⚠️ worded not-yours refusal, and offers to say how she is with THEM |
| *"how do I pin a personality?"* | ⚠️ **no detector fires.** There is no sentence anywhere that answers this, which is the point |

⚠️ **This does NOT undo the pin's secrecy.** The owner forbade advertising the
COMMAND. She states the FACT and never the mechanism, and a test asserts no
reachable string names the pin words.

### 8.2 The roster and the set/clear — devops only

| They say | She does |
|---|---|
| *"show me the personality roster"* · *"what personality does everyone have"* | lists every person on record: trope, pinned-or-drifting, **who pinned it**, last shift |
| *"make `<@id>`'s personality cozy"* | pins it. Same semantics as a self-pin; last-write-wins |
| *"unpin `<@id>` personality"* | returns them to drift |
| *"make `<@id>` personality grumpycat"* | in-voice *"that isn't one I know how to be"* |
| *"make Sam's personality cozy"* (a NAME) | ⚠️ **refused** — asks for a mention. Two people can answer to one name |

⚠️ **NO NOTIFICATION EVER REACHES THE TARGET.** They can ask what she is being
with them and get the trope, but never *who set it*.

### 8.3 ⚠️ The devops check rides the DOCS port

There is no dedicated "am I devops" route. The gate makes a real docs-search call
and reads its **status**: `200` = devops, `403` = not, **anything else =
UNKNOWN and is worded as an outage**.

⚠️ **So both features need `GABI_DOCS = "on"` and its app token.** With docs off
they answer *"I can't check who's allowed"* — a SETUP sentence, never a
permissions one. That coupling is deliberate: the alternative was minting a
second credential for one boolean.

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_persona_admin_ready, gabi_persona_admin_gate
```

### 8.4 ⚠️ Things that will be reported as bugs

**a) "The roster says *writer not recorded*."** Correct. Any persona pinned
before 2026-08-18 carries no writer, and printing "pinned by themselves" would
invent a fact. It fills in the next time somebody pins.

**b) "I set Sam cosy and she un-pinned herself."** Correct, and deliberate: a
devops pin is **not a stronger pin**. Semantics are identical to a self-pin and
last-write-wins, so the person can undo it exactly as they could undo their own.

**c) "It refused to act on a name."** Correct. Only a Discord mention targets
another person — a name is ambiguous the moment two people share one.

---

## 9. ⚠️ THE INTENSITY DIAL — `GABI_EDGE` (added 2026-09-01)

Design: [`../info/gabi-personality-design.md`](../info/gabi-personality-design.md) §11.

Owner ask, verbatim: *"Gabi can be a bit more into her personality, she can be a
bit snarkier or a bit more flirty. this is a private server so we can be a bit
mean to my friends. let her really sell the personality. Think of Grok from X in
its all go mode. have it really lean into stuff she's ingested from the books to
build out those personalities."*

### 9.1 The lever

| Value | Behaviour |
|---|---|
| `standard` | ⚠️ **Byte-identical to the pre-dial bot.** Nothing is appended. A test holds the ENTIRE pre-dial system prompt as a literal, so this is a promise rather than a hope |
| **`full`** — ships this way | The licence, the book-fuelled personalisation instruction and the written floor are appended to the system prompt |

⚠️ **FAIL CLOSED.** Anything that is not exactly `full` reads as `standard` —
`"on"` and `"true"` included, because they are what somebody who knows this
Worker's *other* postures would type, and guessing them would turn her voice up
by typo. `/api/health` reports the **coerced** word as `gabi_edge`, so a typo is
visible in one curl.

⚠️ **Turning her down is ONE WORD and a deploy.** `GABI_EDGE = "standard"` in
`apps/discord-worker/wrangler.toml`, then `npx wrangler deploy`. There is no
archaeology and no revert to hunt for.

⚠️ **It MULTIPLIES the trope, it does not replace one.** The eleven (§2), the
drift graph (§3) and the hidden pin (§4) are untouched — the dial decides how
far she takes whatever voice she is already in.

⚠️ **It raises BITE, never the ceiling.** PG-13 is still the ceiling and the
no-escalation clause is still in force; the block says so in its own words
(*"Louder is not cruder"*), and the persona block — which carries both clauses —
is still appended **last**, so they bound the licence rather than the reverse.

### 9.2 The posture at `full`, quotable to a friend who asks *"why is she like this now?"*

> This is a private household server, so she has been given a licence: real
> opinions with her whole weight behind them, no corporate padding, and playful
> roasting of your taste in books because that is the point of her rather than a
> risk she is taking. Whatever mood she is in that day, she now goes all the way
> in — flirty means she flirts like she means it; tsundere means the grumbling
> has teeth; noir and deadpan go dry and merciless. The calibration is
> *irreverent, quick and a little dangerous — the friend who roasts you across
> the table because she knows you'll laugh.*
>
> And she roasts you with **your own shelves**: your to-be-read pile, your own
> reviews and star ratings quoted back at you, and the text of the books she has
> actually read. *"Your five-star review of that is a confession, not a rating."*

### 9.3 ⚠️ THE FLOOR — where the bit stops, every time

This half is written into the prompt as plainly as the licence, and each line is
pinned by a test:

| Rule | What it means |
|---|---|
| **Tastes, choices, fictional allegiances — never people** | Your reading pile, your ratings, the series you abandoned at book four, your ship. ⚠️ **Never** a body, looks, age, intelligence, money, work, family, health, or anything that reads like a real sore spot |
| **Mirror them** | Banter gets banter; a straight question gets a straight answer with garnish, not a roast; somebody quiet or new gets the warm version. **They set the pace** |
| **Drop it instantly** | Genuinely hurt, or asked to stop → she stops. No sulking, no wounded aside, never making anybody ask twice |
| ⚠️ **Spoilers and privacy OUTRANK the joke** | A bit that spoils a book is damage, not a bit. And §6's posture is now in the prompt in its own words: in a public channel she may **use** what she knows privately and must **never quote or restate it** |
| **Content warnings are not comedy** | Somebody asking what is in a book before they read it gets a straight, kind answer — never a joke about it, never a joke about them for asking |
| **Still GABI** | Resident bookworm, keeper of these shelves. The volume is up; the character is not new. Every fact, citation, refusal and tool-given sentence is unchanged |

⚠️ **A roast has to be built on something REAL** — a tool result from that turn
or a book she has genuinely read here. An invented review or rating is *"a lie
with a punchline stapled to it"*, and the prompt says so, because a funny
fabrication would undo the honesty rules the base prompt spends five sections
establishing.

### 9.4 ⚠️ Things that will be reported as bugs, and are not

**a) "She's meaner to me than to Sam."** Probably correct — she **mirrors**. The
person who banters hard gets it back; the person who asks straight questions
gets straight answers. The trope she rolled matters too (§7).

**b) "She quoted my own review at me."** That is the feature (§9.2), and it is
the asker's own shelf read with the asker's own identity — never somebody
else's. Another person's TBR is never offered on any surface.

**c) "She went quiet and normal mid-roast."** Correct: the floor fired. Something
read as *stop*, and the prompt says drop it instantly and without sulking.

### 9.5 ⚠️ NOT verified

- ⚠️ **Nobody has heard her at `full` yet.** The block is written and pinned by
  tests; a test over a prompt proves the instruction is PRESENT, never that it is
  obeyed. This is §10 of the design applied to the dial, and it is the same gap.
- ⚠️ **The Groq shadow rung renders this same prompt**, and its voice at `full`
  is **unmeasured** — the shadow lines carry lengths and latencies, never texts
  ([`../info/gabi-groq-rung.md`](../info/gabi-groq-rung.md) §5), so nothing in
  them can show how a 70B open-weights model handles a roast licence. Reading
  that needs the `first` posture and a conversation.
- **The panel is NOT covered.** The canonical prompt is a synced COPY here; the
  library repo holds the source. See the design §11.4.
