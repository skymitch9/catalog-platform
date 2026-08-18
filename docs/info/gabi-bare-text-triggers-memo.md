# Bare "heygabi" in channel text — a decision memo

> **Audience:** the owner, first. **Status:** TRACKED (public repo).
> Last verified: **2026-08-18**. **DECISION MEMO — nothing here is built, and
> the recommendation is a recommendation.**
>
> The question: today GABI hears an `@mention`, a reply-with-ping, or a DM.
> Making bare **`heygabi …`** / **`Hey Gabi …`** work — no `@`, no reply, not a
> DM — needs Discord's **Message Content** privileged intent. This memo lays out
> what that costs, honestly, and leaves the call to the owner.
>
> Context: [`discord-bot-design.md`](discord-bot-design.md) §1.5 and §6.8;
> [`gabi-conversation-continuity.md`](gabi-conversation-continuity.md) §4;
> [`gabi-application-map.md`](gabi-application-map.md) §4 limitation 1.

---

## 1. What the intent actually grants

Not "the ability to match a keyword". **The ability to read every message.**

From Discord's own gateway documentation (read 2026-08-18,
<https://docs.discord.com/developers/events/gateway>):

> The `MESSAGE_CONTENT` intent permits apps to receive message content data
> across APIs. Fields affected include `content`, `embeds`, `attachments`,
> `components`, and `poll` in message objects.

With it set, the bot's socket receives the **full text, embeds and attachment
metadata of every message in every channel it can see, in every server it is
in** — not only messages mentioning it. Today those fields arrive **blank**
except in four cases (continuity §4):

| Door | Rests on Discord's exception |
|---|---|
| the app's own messages | *"Messages your app sends"* |
| DMs with the app | *"Direct Messages sent to your app"* |
| `@mention`s | *"Messages that @mention your app"* |
| replies to her regular messages, ping on | *"Replies to your app's messages"* |

Everything else is blank today. **That blankness is the current privacy
posture, and it is enforced by Discord, not by our code.** The intent removes
it.

⚠️ **The asymmetry that matters:** today, a person choosing to type `@GABI` is
choosing to be heard. With the intent, that choice is gone — she receives
everything and *our handler* decides what to look at. **The decision moves from
Discord's servers to ours.**

---

## 2. What Discord requires at this scale

⚠️ **The rule changed, and the estate's docs carry the OLD one.** Recorded here
because the old number is quoted in prior planning and would be quoted again.

| | Threshold | Status |
|---|---|---|
| **Old rule** | *"apps in fewer than 100 servers could access Privileged Intents by toggling them on in the Developer Portal, and apps in 100+ servers needed to apply"* | ⚠️ **superseded** |
| **Current rule** (as of June 2026) | **10,000 unique users** who can see the app across all servers it is installed in | in force |

Discord's wording, from
<https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review>
(read 2026-08-18):

> *"If that number exceeds 10,000, your app needs to apply for Privileged Intent
> access."*

and, for apps below it:

> *"[you] can turn privileged intents on and off from the Developer Portal as
> needed. **No need to apply for access.**"*

**Where GABI sits: comfortably below, on either rule.** A household estate is
one or a few servers and a couple of dozen people. So:

> ⚠️ **There is no gate. It is one toggle in the Developer Portal, plus one
> constant in the code, and it takes about a minute. Nothing external is asking
> a question and nothing external will say no.**

That is the important finding, and it cuts **against** the comfortable answer.
The reason not to do this was never "Discord won't let us" — it is a household
privacy decision the estate has to make on its own, with nobody else's review to
hide behind. ⚠️ It also means the change is **trivially reversible**: the toggle
goes off as easily as on, and the bot resumes hearing only what is addressed to
it. This is not a one-way door.

---

## 3. What the estate refused it for

`discord-bot-design.md` §1.5's table row, verbatim:

> **Message Content intent** — *"❌ **Never requested.** Every feature in §2 is
> slash-command or component-driven — nothing needs to read plain chat."*

and §6.8:

> *"the bot would receive the text of **every message in every channel it can
> see**, in every server it is in. That is a different privacy posture from
> anything the estate has agreed to, and it is a **decision for the owner**, not
> a config change. Phase A deliberately does not build toward it."*

⚠️ **The row survived contact with a feature that looked like it needed the
intent** — conversational GABI answers ordinary chat, which sounds exactly like
"reading plain chat", and it turned out not to need it. That is a genuine win
worth protecting: the design found the version that works inside the exception
list rather than widening access to fit the first design.

**But it is honest to record that this specific ask is the half that did not
fit.** The owner's original wording was *"I want to use heygabi and similar
forms like Hey Gabi, hey @Gabi, heyGabi etc to kick her off for a question."*
Phase A shipped the `@`-bearing forms. **The bare form is the part of what he
asked for that has not been delivered**, and "we found a clever way to avoid the
intent" should not quietly become "the feature was never wanted".

---

## 4. What would actually change in code — small

| Change | Where | Size |
|---|---|---|
| intent bit `MESSAGE_CONTENT` (1<<15) → `4609` becomes **`37377`** | `gateway.ts` IDENTIFY | one constant |
| a trigger regex for `^\s*hey\s*,?\s*gabi\b` (case-insensitive, optional space/comma) | `mentions.ts` `mentionTrigger()` | one branch |
| the door table gains a fifth row | `mentions.ts`, continuity §4 | docs + test |
| ⚠️ a test that currently asserts `MESSAGE_CONTENT` is **never set** must be repointed | `test/mentions.test.ts` | see below |
| the channel allowlist (§6) | `env.ts` + `mentions.ts` | small |

**Perhaps a day's work, most of it tests and wording.** ⚠️ **The code is not the
decision.** This memo exists because the cheap change and the significant change
are the same change.

⚠️ **One test deserves naming.** Continuity §4.3 records that `MESSAGE_CONTENT`
being unset is asserted *"as its own case so the assertion survives any future
widening"*. That test is doing its job right now: **it is why this cannot be
done as a quiet config tweak.** Turning bare text on means deliberately
rewriting a test written to make somebody stop and think. That is the design
working, and the repointing should be as explicit as T1's was — pointed at the
narrower property that replaces it (§6), not deleted.

---

## 5. The privacy delta, in household terms

Not in protocol terms. In terms of what is true about a room.

| | Today | With the intent |
|---|---|---|
| Somebody vents in a channel GABI is in | ⚠️ **She never receives the words.** Discord blanks them | She receives every word |
| Somebody shares a link, a photo, a private aside | never received | received (`content`, `attachments`, `embeds`) |
| A channel GABI was added to for one feature (a club's poll channel) | she hears only what is addressed to her there | she hears **everything** in it |
| A guest in the server | their messages never reach us | their messages reach our Worker |
| What is stored | 30 min of what was **said to her** (continuity §2.1), then deleted | unchanged **if** the handler drops the rest — §6 |

**The plainest statement of the delta:** today, the honest sentence is *"GABI
cannot hear what you say unless you say it to her."* Afterwards the honest
sentence is *"GABI receives everything said in channels she is in, and ignores
what isn't addressed to her."*

⚠️ **Those are different sentences, and the second one asks for trust the first
one did not need.** The first is guaranteed by Discord; the second is guaranteed
by us. The estate's own verification culture is the right lens: *a claim nobody
can check is a claim.*

⚠️ **And people cannot see which one is true.** Discord shows no badge in a
channel for "this bot has message content". The change is invisible to everyone
in the room unless somebody tells them. **If this is turned on, telling the
household is part of turning it on** — not a nicety. That is the estate's own
no-bare-status principle pointed at a privacy change instead of an error.

---

## 6. Mitigations — and what each can honestly promise

### 6.1 ⚠️ The intent CANNOT be scoped. Measured, not assumed.

Checked directly against Discord's documentation (read 2026-08-18):
<https://docs.discord.com/developers/events/gateway> and
<https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent>.

> **Neither page describes any mechanism for limiting the Message Content intent
> to particular channels or guilds. Intents are declared per-connection in
> `IDENTIFY`, as a bitfield. There is no channel dimension.**

So *"let her read only the channels she's bound to"* **cannot be done at the
Discord layer.** It is on or off for the whole socket. ⚠️ Anyone proposing this
mitigation as a way to *avoid* the privacy delta has mis-modelled where the line
is. (Removing her from a channel entirely still works, and remains the only
control that is enforced by Discord rather than by us.)

### 6.2 What the HANDLER can do, and the exact promise it can make

A channel allowlist in our own code: `mentions.ts` checks `channel_id` against a
configured set **before looking at `content` at all**, and returns early
otherwise.

⚠️ **What "unlogged" can honestly promise, stated precisely, because this is
where a memo like this usually overclaims:**

| Claim | Honest? |
|---|---|
| *"The bytes never reach the estate's servers"* | ❌ **FALSE.** They arrive over the gateway socket into the Worker's memory. That is what the intent means |
| *"Nothing is written to storage"* | ✅ **TRUE and checkable.** The conversation record is written only on an **answered** turn (continuity §3.1); a dropped message produces no `conv:` write, no `gabi_turn` accounting row, no Firestore write |
| *"Nothing is sent to the model"* | ✅ **TRUE and checkable.** No answered turn, no Messages API call, no token spend |
| *"No human can read it"* | ⚠️ **CONDITIONAL.** True only if nothing logs it. `console.log` of a raw payload during one debugging session would put message content into Workers logs. **This is the promise that is one careless line away from being false** |
| *"It is as if she never received it"* | ❌ **Not quite**, and the gap is worth naming: the Worker's runtime handled it, and any platform-level observability, error report or exception trace could incidentally capture it |

**So the honest promise is: *"she receives it, does not read it, does not store
it, does not send it anywhere, and it is gone when the event handler
returns."*** That is a real and meaningful guarantee — and it is **strictly
weaker** than today's, which is *"she never receives it."*

⚠️ **If this is built, the promise needs a mechanical guard, not a comment** —
the estate's own rule that a rule that matters gets promoted from prose to a
script. The shape that matches this repo's existing idiom: a **source-reading
test** like the one pinning credentials to `delegated-exec.ts`, asserting that
the raw `content` of a non-matching message reaches **no** logging call, no
storage call, and no accounting call. Without that, "unlogged" is an intention.

### 6.3 The mitigation that costs nothing and should happen regardless

**Remove her from channels where she has no job.** It is the only control
enforced by Discord rather than by us, it needs no intent decision, and it
shrinks the delta before the decision is even taken. ⚠️ Worth doing *first*,
because it also measures the real size of the question: if she is in three
channels that all exist for her, the delta is small; if she is in the household's
general chat, it is not.

---

## 7. Recommendation

**Recommend: not yet — and for a reason that is about value, not fear.**

1. **The benefit is small and precisely known.** It saves typing one `@`. The
   feature it unlocks is *convenience*, and it is the only feature in the whole
   GABI roadmap whose cost is a standing privacy posture rather than an
   engineering effort.
2. **The cost is the estate's most checkable privacy claim.** *"She cannot hear
   what you don't say to her"* is guaranteed by Discord. Every substitute is
   guaranteed by our own code — and the estate's own verification culture says
   a claim only we can check is weaker, in kind, not just in degree.
3. **DMs already solved the case that actually mattered.** The owner's ask was
   about friction; `DIRECT_MESSAGES` is unprivileged and needed no toggle, so
   **the zero-`@` surface already exists** — it is just a DM rather than a
   channel. Most of the convenience arrived without the cost.
4. ⚠️ **It gets cheaper to reconsider later, not more expensive.** It is one
   toggle and one constant, reversible in a minute (§2). There is no
   architecture being locked in by waiting, and no migration created by
   deciding later. **This is the rare decision that costs nothing to defer** —
   which is exactly why deferring is the right default.

**The conditions under which the answer should flip** — worth writing down so
this is a decision with a trigger rather than a permanent no:

- The household is **told and is comfortable**, in words, not by inference (§5).
- She has been **removed from channels she has no job in** (§6.3) — so the
  delta is as small as it can be before it is accepted.
- The **drop-unlogged guard exists as a test**, not as an intention (§6.2).
- ⚠️ The owner has **noticed himself typing `@GABI` and being annoyed by it**.
  That is the real evidence that the convenience is worth a posture change, and
  it does not exist yet — GABI has never been switched on for a real
  conversation (§8).

**The decision is the owner's.** If he wants it, it is an afternoon: the toggle,
the constant, the regex, the allowlist, the repointed test, the guard test, and
a sentence to the household.

---

## 8. ⚠️ NOT VERIFIED

- **Nothing here is built or tested.** No intent has been toggled, no bare-text
  regex exists.
- ⚠️ **GABI has never had a real conversation on Discord at all.** Continuity §8:
  `GABI_MENTIONS` ships `"off"`, no socket has ever opened, no real message,
  reply, DM or press has ever been handled. **So there is no measurement of how
  often the missing `@` is actually annoying** — the central input to §7's
  cost/benefit is absent, and the recommendation is correspondingly a judgement
  rather than a finding.
- **Discord's thresholds and exception list are a documentation READING**
  (2026-08-18), not an observation. ⚠️ The 100-server rule was **found to be
  superseded** while writing this memo, which is itself the evidence that these
  facts move: re-read them before acting, do not quote this memo's §2 as
  current a year from now.
- **The support-centre articles were NOT read directly** — `support-dev.discord.com`
  returned **HTTP 403** to the fetch. §2's current rule is taken from
  `docs.discord.com`'s privileged-intent-review page, which states both the
  current threshold and the superseded one; the support articles agreed via
  search snippets but were not read in full.
- **The intent bitfield value `37377`** (§4) is arithmetic over the documented
  bit positions (`4609 + 32768`), not observed in a real `IDENTIFY`.
- **Whether Workers' platform observability could incidentally capture message
  content** (§6.2) was **not investigated**. It is flagged as an honest gap in
  the "unlogged" promise, not resolved.
- **Which channels GABI is currently in was NOT checked.** §6.3's recommendation
  is made without knowing the current answer.
