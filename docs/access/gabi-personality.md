# GABI's personality (and person-keyed conversations) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (this repo is PUBLIC).
> Last verified: **2026-08-18**, deployed and checked live.
> ⚠️ **The pin in §4 is deliberately UNDOCUMENTED to end users** — it lives here
> and in `docs/info/` only. Do not put it in any user-facing text.

Design: [`../info/gabi-personality-design.md`](../info/gabi-personality-design.md)
and [`../info/gabi-memory-design.md`](../info/gabi-memory-design.md) §11.

---

## 1. The levers

| Lever | Where | Ships |
|---|---|---|
| `GABI_PERSONALITY` | `apps/discord-worker/wrangler.toml` | **`"on"`** |
| `GABI_MEMORY` | same | `"on"` (owner flipped it 2026-08-18) |

⚠️ **Personality ships ON and the other postures do not.** It changes *wording*;
`GABI_BOOKS` and `GABI_MEMORY` open a gated corpus and a durable note about a
person. Off is one line back, and off is silent — nobody asks a question only a
personality could answer.

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_personality_enabled, gabi_personality_tropes, gabi_conversation_scope
```

Expect `True`, 11 tropes, and `person`.

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
