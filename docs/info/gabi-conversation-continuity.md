# GABI Conversation Continuity — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED (public repo — no secrets, no household names).
> Last verified: **2026-08-17**.
>
> Companion to [`discord-bot-design.md`](discord-bot-design.md) §6 (conversational
> GABI phase A) and §7 (this layer). That doc owns the *Discord* story; **this
> one owns the STORE SHAPE**, because the shape is deliberately not Discord's.

---

## 0. What the owner asked for, verbatim

> *"I don't want to message GABI and then message her again and she has no
> recollection."*

and, separately, the constraint that shaped the record:

> *"whatever we build we need to consider for when we update the chat button on
> GABI."*

The second sentence is why this document exists as its own file. The memory is
implemented in `apps/discord-worker`, but it is **designed to be adopted by the
library site's GABI panel** without a rewrite, and a shape that lives only
inside a Discord Worker's source would not survive that trip.

---

## 1. ⚠️ THE RECORD SHAPE — the contract

```ts
interface ConversationRecord {
  v: 1;                        // shape version
  key: ConversationKey;
  turns: ConversationTurn[];
  updatedAt: number;           // epoch ms
  pending?: PendingChoice | null;
}

interface ConversationKey {
  surface: string;             // 'discord_channel' | 'discord_dm' | 'web_panel' | …
  space:   string;             // OPAQUE. "the room this happened in"
  person:  string;             // OPAQUE. "who was talking"
}

interface ConversationTurn {
  role: 'user' | 'assistant';
  text: string;                // clipped to 600 chars
  at:   number;                // epoch ms
  ref?: Record<string, string>; // ⚠️ SURFACE-PRIVATE. The core NEVER reads it.
}

interface PendingChoice {      // a clarifying question awaiting an answer
  kind:     'book_pick';
  nonce:    string;
  question: string;
  options:  { label: string; detail: string }[];
  at:       number;
}
```

Canonical source: **`apps/discord-worker/src/conversation.ts`**. It is **pure** —
no Discord types, no Durable Object, no `fetch`. That purity is the portability:
the file could be moved to a shared package verbatim.

### 1.1 The split, stated as a table

| Surface-NEUTRAL — every surface reads and writes these | Surface-SPECIFIC |
|---|---|
| `v`, `updatedAt` | — |
| `key.surface` (an opaque label) | the label's *value* (`discord_dm`, `web_panel`…) |
| `key.space` | a Discord channel id / a panel session id |
| `key.person` | a Discord user id / a Firebase uid |
| `turns[].role`, `.text`, `.at` | — |
| — | **`turns[].ref`** — an opaque bag |
| `pending.*` | — |

### 1.2 ⚠️ Three rules that make the contract real

1. **`space` and `person` are OPAQUE.** Nothing may parse them, pattern-match
   them, or assume they are numeric. A Discord snowflake and a Firebase uid must
   be interchangeable, because that interchangeability *is* the portability
   claim. A test asserts both produce valid, distinct keys.
2. **`turns[].ref` is write-only to the core.** Discord stores
   `{message_id, guild_id}` there so a turn can be traced to the message that
   produced it. A reader that starts branching on `ref` has broken the contract.
3. **`v` is checked on every read.** An unknown version is treated as
   **absent** — start fresh — never guessed at. One bad write must not become a
   permanent wrong answer.

### 1.3 What the site panel would have to supply

Everything except a store. Concretely:

| Panel supplies | Value |
|---|---|
| `key.surface` | a new constant, e.g. `'web_panel'` |
| `key.space` | its session/thread id |
| `key.person` | the Firebase **uid** — already available, already the panel's identity |
| storage | anything with get/put/delete by string key (the panel already has Firestore) |
| `turns[].ref` | its own ids, or nothing |

⚠️ **It must NOT reuse the Discord Worker's Durable Object.** The object is
per-Worker and holds a bot token's session; the shape travels, the storage does
not.

---

## 2. The window — two limits, because they answer different questions

| Constant | Value | Answers |
|---|---|---|
| `CONVERSATION_WINDOW_MS` | **30 minutes**, sliding | "is this still the same conversation?" |
| `CONVERSATION_MAX_TURNS` | **20** (≈10 exchanges) | "how much of it does the model pay for?" |
| `CONVERSATION_TURN_CHARS` | **600** per turn | the per-turn spend ceiling |
| `PENDING_TTL_MS` | **15 minutes** | how long a clarifying menu stays answerable |

One limit alone gets the other case wrong: a fast argument makes forty turns in
ten minutes, a slow one makes four across an hour.

### 2.1 ⚠️ Aged-out state is DELETED, not archived

`pruneConversation()` returns **`null`** when nothing is left inside the window,
and every caller is **required** to answer that by deleting the key. There is no
archive, no tombstone, no `expired` flag. The estate keeps half an hour of what
somebody said to a librarian in a chat window, and then it is gone.

This is a privacy posture, not an optimisation, and it is enforced mechanically:
a test asserts `null` specifically (rather than "an empty record"), because an
empty record would leave a row per person per channel forever — a row whose
*key* still says who talked to her and where.

### 2.2 The spend, and why it is bounded rather than trending

Context tokens are charged on **every** turn, so an unbounded history makes turn
10 cost ten times turn 1 under a cap that never noticed. A full window is
20 × 600 = **12,000 characters ≈ 3k input tokens** — about **0.3¢** at Haiku
4.5's $1/MTok. Bounded, and stated in the unit the bill is in.

Every `gabi_turn` accounting line now carries `history_turns` and
`history_chars` beside the raw token counts, so continuity's share of the spend
is **attributable rather than inferred**. ⚠️ The remembered *text* is never
logged — only how much of it there was.

---

## 3. ⚠️ Where it lives, and the write-budget arithmetic

**The gateway Durable Object's own storage** (`apps/discord-worker/src/gateway.ts`),
under `conv:` keys — alongside `gw:` (the session) and `cap:` (the fuses).

Why not somewhere else:

| Candidate | Why not |
|---|---|
| A **second Durable Object** | Named BLOCKING in `wrangler.toml`: the existing always-on socket accrues ~10,800 of the free plan's 13,000 GB-s/day (~83%) |
| **D1** | A new binding on the credential-lightest Worker in the estate, for one table |
| **Firestore** | A service-account round trip per turn, and it would put chat text in the estate's primary datastore. `mention-flow.ts` is pinned by a test that greps it for `firestoreRequest` |
| A **cron**-swept table | Free cron slots were exhausted; a prior deploy FAILED on exactly this |

### 3.1 The arithmetic

| | Writes |
|---|---|
| `convLoad()` | **0** on the normal path. Pruning is in memory. Its one possible write is a **DELETE** of a fully aged-out record — the garbage collection §2.1 requires |
| `convSave()` | **exactly 1**, and only on an **answered** turn |

Answered turns are already fused at `GLOBAL_TURNS_PER_DAY = 200`. So:

```
worst case ≈ 200 saves + 200 GC deletes            =  ≤400 rows/day
already accrued by the heartbeat                    ≈ 2,100 rows/day
                                                   ─────────────────
new total                                          ≈ 2,500 rows/day
free-plan ceiling                                    100,000 rows/day
                                                   ≈ 2.5%
```

⚠️ **The bound is not a hope — it is arithmetic over an existing cap.** If
`GLOBAL_TURNS_PER_DAY` is ever raised, this paragraph is what must be recomputed.

⚠️ **Priced against the TIGHTER (free) ceiling on purpose.** `docs/TODO.md`
records the owner upgrading to **Workers Paid on 2026-08-17** — the repo's own
dated record, **not measured by this build**. A bound proven under the stricter
limit is still a bound under the looser one, and pricing against Paid would have
to be re-derived the day anybody downgrades.

### 3.2 ⚠️ The defect class this does NOT repeat

An early version of `gateway.ts` wrote the gateway sequence number **on every
frame** — a Durable Object row write per message in every channel of every guild
the bot is in, against a 100,000/day ceiling — and was corrected to once per
heartbeat. **Nothing in the memory path writes per frame.** The write is tied to
an *answer*, which is the thing the daily cap already counts.

Size: a full record is ~12 KB, inside the 128 KiB per-value ceiling with an
order of magnitude to spare.

---

## 4. ⚠️ The four doors, and the documentation that opens each

Everything rests on Discord's own list of exceptions to the `MESSAGE_CONTENT`
privileged intent. **Read 2026-08-17**, quoted verbatim from
<https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent>,
§*"Exceptions: when you get message content without the privileged intent"*:

> - **Messages your app sends**
> - **Direct Messages sent to your app**
> - **Messages that @mention your app**
> - **Replies to your app's messages.** Note: this applies to replies sent using
>   Discord's reply feature to a regular bot message (not an interaction
>   response) and the user has "ping on reply" enabled. It does not apply to
>   replies to slash command responses.

The same four appear on <https://docs.discord.com/developers/events/gateway>
§*Message Content Intent*, where the word "mentioned" **links to the
`<@USER_ID>` message-formatting format** — which is why the mention door tests
for the literal token and not merely for array membership.

| Door | Trigger | Rests on |
|---|---|---|
| `mention` | `<@GABI>` in the text **and** her id in `mentions` | *"Messages that @mention your app"* |
| `reply` | reply to one of **her own regular messages**, ping left ON, proved by `referenced_message.author.id` | *"Replies to your app's messages"* + its note |
| `dm` | any message in a DM; no mention looked for | *"Direct Messages sent to your app"* |
| `component` | a press on a select/button she attached | not a message at all — a signed HTTP interaction |

### 4.1 ⚠️ THE HONEST LIMIT: a reply with the ping removed is INVISIBLE

Discord's condition is *"the user has 'ping on reply' enabled"*. With the ping
switched off, GABI is not in `mentions` and `content` arrives blank. **She
cannot tell that it happened**, so she cannot apologise for it — there is no
event to apologise about.

This is written into the runbook ([`../access/discord-bot.md`](../access/discord-bot.md))
in the words a person needs, because the symptom — "I replied and she ignored
me" — is indistinguishable from a bug.

### 4.2 ⚠️ Replying to a SLASH COMMAND answer does not work either

Discord's note excludes interaction responses explicitly. So a reply to `/have`,
`/gabi` or any other command's answer is **not** heard. This is Discord's rule,
not a gap in this build, and it is the reason `replyToMessage()` must stay a
regular bot message: a refactor that answered mentions through an interaction
webhook would make her deaf to follow-ups without touching a line that looks
related.

### 4.3 Intents

`GUILDS (1<<0) | GUILD_MESSAGES (1<<9) | DIRECT_MESSAGES (1<<12)` = **4609**.

⚠️ **All three unprivileged.** Discord's privileged list is exactly
`GUILD_PRESENCES`, `GUILD_MEMBERS`, `MESSAGE_CONTENT`. `DIRECT_MESSAGES` needs
no portal toggle, no verification and no review — which is precisely why it was
available and bare-text triggers still are not.

⚠️ **`MESSAGE_CONTENT` (1<<15) is never set**, and a test asserts it as its own
case so the assertion survives any future widening. **`DIRECT_MESSAGE_TYPING`
(1<<14) is not requested either** — the owner asked for messages, not a typing
indicator, and it would cost a `TYPING_START` per keystroke burst.

⚠️ **Bare text is still an owner decision, and this layer does not move that
line by a millimetre.** All four doors are messages somebody *deliberately*
addressed to her.

---

## 5. Clarifying questions — components, and the security model

When a lookup matches **more than one** book, she asks which one: a **string
select** of up to 5 candidates plus a **button** that opens a **modal** for free
text.

⚠️ **The trigger is deterministic, not a model decision.** "More than one match"
is a genuinely closed answer set, which is what a select menu is for — and it
means the whole components path is exercised **by tests that supply no Anthropic
key at all**. A model-chosen offer is a later phase and a different call shape.

### 5.1 The vocabulary

| custom_id | Meaning | Length |
|---|---|---|
| `gc\|pick\|<nonce>` | a row was chosen (`data.values[0]` is the index) | 16 |
| `gc\|more\|<nonce>` | "none of these" — open the modal | 16 |
| `gcm\|<nonce>` | the modal's submit | 13 |
| `gcq` | the one text input inside it | 3 |

All far inside Discord's 100-character ceiling; a test asserts it.

### 5.2 ⚠️ The nonce is NOT a capability — and that is the design

It is unsigned and not secret, because it carries no authority. **The
conversation key is rebuilt from who pressed the button and where** — both
proved by Discord's Ed25519 signature on the interaction. Somebody else pressing
the same public menu therefore resolves a **different** record, finds no pending
question with that nonce, and is answered `CONV_MSG.stale`.

Contrast `moderation.ts`, whose confirm `custom_id` **is** MAC'd with an expiry
and an invoker/channel binding — because that one authorises a message
**deletion**, so the id itself is a capability. Two different problems, two
different answers, stated so the asymmetry reads as a decision rather than an
oversight.

⚠️ The stale message names **both** possible causes ("that question was for
whoever asked it, or the conversation has moved on") in one sentence, because
the person pressing cannot distinguish them either — and picking one would be a
guess presented as a fact.

### 5.3 Response shapes

- The **`more` button** is answered **synchronously with a MODAL (type 9)** — a
  modal cannot be sent as a followup, and Discord's table says type 9 is *"Not
  available for `MODAL_SUBMIT` and `PING` interactions"*.
- A **`pick`** and a **modal submit** are answered with **`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`
  (type 5), public**, then edited.
  ⚠️ **Deliberately not type 6 (`DEFERRED_UPDATE_MESSAGE`)**, which would edit
  the message the component was attached to and thereby *replace* her earlier
  answer — quietly erasing half of the conversation a reader needs. A
  conversation is a sequence of messages; type 5 adds one.
  ⚠️ **And deliberately not ephemeral**: an ephemeral message cannot be replied
  to with the ping Discord requires to deliver content, so it would be a dead
  end in the middle of a continuity feature.
- The modal's text input is wrapped in a **Label (type 18)**, per Discord's
  component reference: *"We no longer recommend using Text Input within an
  Action Row in modals."* ⚠️ The submit parser reads **both** shapes, because
  the Action Row form is deprecated, **not removed** — a parser that only knew
  the new one would silently receive an empty question from an older client.

---

## 6. Behaviour a reader will notice

- **She greets on the first turn only**, and never by ping in a DM. Re-pinging
  somebody on every turn is how a bot that gained a memory manages to sound like
  it lost one.
- **Caps are unchanged and apply to presses too**: 20 answered turns per person
  per rolling hour, 200/day estate-wide. A refused press leaves the menu still
  answerable, and writes nothing.
- **The classifier sees only the last 2 turns** (clipped to 300 chars) — enough
  to resolve *"what about the second one?"*, without quadrupling the input
  tokens of the cheapest call in the build.
- **`converse` sees the whole window**, injected as real `messages` rather than
  as a summary pasted into the user turn. A summary is a second thing that can
  be wrong, and it makes the model reason about a transcript instead of
  continuing one.

### 6.1 ⚠️ Alternation is enforced, not assumed

The Messages API requires `messages` to start with `user` and alternate. The
30-minute window cuts wherever it lands (which can leave an `assistant` turn
first), and a reply Discord refused to post can leave two `user` turns adjacent.
`modelMessages()` **drops leading assistant turns and merges consecutive
same-role turns**. Violating the rule would be a 400 that eats somebody's answer
over a bookkeeping detail.

---

## 7. The allowlist grew, on purpose

`GABI_MENTION_ACTIONS` went from four entries to **eight**, and the four
additions are each a decision pinned by a test:

`recall_conversation` · `remember_conversation` · `offer_choice_components` ·
`open_question_modal`

⚠️ **What is still absent and cannot arrive without failing that test**: any
catalogue write, any Firestore write, any `change_log` row, any timeout, any
message delete, any role change, any command registration. The one thing this
layer persists is half an hour of chat text **in the bot's own storage**, and it
deletes it.

---

## 8. ⚠️ NOT VERIFIED

Inherited honestly from `discord-bot-design.md` §6.7 and extended:

- **Nothing in this build has ever talked to Discord's gateway.** `GABI_MENTIONS`
  ships `"off"`, so no socket has ever opened. Every protocol claim is read from
  documentation.
- **No real message, reply, DM or button press has ever been handled.** The
  memory, the doors, the components and the modal are exercised only by tests.
- **The four content exceptions (§4) are a documentation READING, not an
  observation.** If Discord's list ever narrows, the symptom is GABI silently
  ignoring things, and §4 is the first place to look.
- **The `DIRECT_MESSAGES` intent has never been sent in a real `IDENTIFY`.** The
  claim that it is unprivileged comes from Discord's own privileged-intent list;
  if it were wrong, the symptom is close code **4014**, which this build already
  treats as fatal rather than retrying.
- **No model call has ever been made on this surface** — every test supplies no
  key. `history_turns` / `history_chars` are recorded; no real token count has
  been observed.
- **The Workers Paid upgrade is `docs/TODO.md`'s record, not this build's
  measurement.** No deploy here has exercised the raised limits.
- **The write-budget arithmetic is arithmetic**, over a published table and an
  existing cap. The first week of real use is the measurement.
