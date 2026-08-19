# GABI's recent turn log — Access Reference

> **Audience:** Claude sessions and whoever is asked *"why didn't she answer
> me?"*. **Status:** TRACKED. Last verified: **2026-08-18** — the ring was built
> this session; the READ has not yet been exercised against a live devops
> sign-in (see §6).

| | |
|---|---|
| **Read** | `GET https://discord.heygabi.ai/admin/gabi/turnlog` — `Authorization: Bearer <your Firebase ID token>` |
| **Gate** | devops (devops **or** approver **or** owner), asked of `auth.heygabi.ai/api/estate/me` |
| **Store** | the gateway Durable Object, one key `gw:turnlog`, last **40** turns |
| **Contract** | [`apps/discord-worker/src/turnlog.ts`](../../apps/discord-worker/src/turnlog.ts) |
| **Page** | `/status` → GABI (from 2026-08-18) |

## 1. ⚠️ Why it exists — the 7:28 PM silence

The second real non-owner user ever to talk to GABI asked a question in a
channel and **got nothing at all**. Her next message was *"Did you turn her
off?"* She had not been turned off.

⚠️ **The estate then discovered it could not investigate its own bot.** Five
instruments, each correctly knowing nothing:

| Instrument | Why it was blank |
|---|---|
| `wrangler tail` | a LIVE stream; nobody was watching at 7:28 PM |
| Workers Logs | ⚠️ `[observability]` was not enabled on this Worker at all |
| the worker event ring | `discord-worker` had never been wired to it |
| the conversation store | an unanswered turn writes no record — **by design** |
| the four daily fuses | counts, with no per-turn history |

Every one of those is defensible on its own. Together they meant a real
complaint from a real person could not be answered. **That is what this ring
fixes**, and it is deliberately the smallest thing that does.

## 2. What one row says

```jsonc
{ "at": 1755650880000, "person": "3901…", "channel": "1401…",
  "via": "mention", "outcome": "answered", "intent": "question",
  "lane": "books", "tools": ["list_book_knowledge","search_book_text"],
  "hid": ["books_capped"], "ms": 4210 }
```

| Field | Answers |
|---|---|
| `via` | which door — `mention` / `reply` / `dm` / `component` / `ignored` |
| `outcome` | ⚠️ `answered` / `capped` / `error` / **`silent`** / `ignored` |
| `lane` | which lane CLAIMED the turn — the field three 2026-08-18 routing incidents would each have been solved by |
| `tools` | which tools **actually executed**. ⚠️ Offering a tool is not calling it, and this is how you tell them apart after the fact |
| `hid` | what scope refused — a posture off, a fuse, an unlinked identity, a grant declined. *"She couldn't"* vs *"she wouldn't"* |
| `why` | for `ignored` rows: `mentionTrigger`'s own reason |
| `ms` | wall clock. A 20-second turn and a turn that never started look identical from a channel |

## 3. ⚠️ It records what HAPPENED, never what was SAID

No question text, no answer text, no book title, no retrieved passage — and
`test/turnlog.test.ts` reads the source and fails the build if a field for any
of them appears. Two reasons, either sufficient:

1. `info/gabi-bare-text-triggers-memo.md` §6.2 names *"nothing logs the
   content"* as the estate's most fragile privacy promise, **"one careless line
   away from being false"**. This is the file that would be that line.
2. The ring is read at **devops**, which is wider than the gates on what she
   reads for people (a passage is `vis_ebooks`; a TBR is that person's own).
   Content must not leak upward into an operations surface.

## 4. Reading it when somebody says "she ignored me"

1. **Find their turn** by `person` (a Discord snowflake) and `at`.
2. **No row at all?** Then she never took the turn. Look for an `ignored` row in
   the same second — `why` names it (`empty_question`, `message_type_21`,
   `author_is_bot`). ⚠️ `not_mentioned` is deliberately NOT recorded: it is every
   ordinary message in every channel she sits in, and recording it would evict
   the forty rows that matter within seconds.
3. **`outcome: "silent"`?** ⚠️ **That is the prohibited outcome.** An answer was
   composed and Discord did not take it. The Worker log for that minute carries
   `THE ANSWER WAS NEVER DELIVERED` with both HTTP statuses; the usual cause is
   the bot lacking **Send Messages** in that channel.
4. **`outcome: "capped"`?** She said so in the channel — a fuse is never a
   silence. The fuse is named in `hid`.
5. **Wrong `lane`?** That is the routing-miss class, four instances on
   2026-08-18. The lane that should have claimed it has a detector, and its
   design doc has an incident section.

## 5. The four silence paths, and what now closes each

| Path | Closed by |
|---|---|
| a throw in the setup, outside the mention handler | `onDispatch` wraps `dispatchInner` and **posts a worded line** |
| a conversation or persona read that throws | both degrade — she answers without history, or in her default voice |
| `replyToMessage` refused (message deleted, permissions) | retried once as a plain channel message, then logged loudly and recorded `silent` |
| an ignored trigger with no trace | the `why` is logged and ringed (except `not_mentioned`) |

## 6. ⚠️ NOT VERIFIED

- **The read has never been performed by a real devops sign-in.** The gate is
  proven by unit tests and by the shape of `/api/estate/me`; no browser has
  fetched this route.
- **No `silent` row has ever been produced.** The path is exercised by a source
  guard, not by a refused Discord reply.
- ⚠️ **The 7:28 PM turn itself is UNRECOVERABLE.** The ring did not exist and
  observability was off. Its cause is **unknown and will stay unknown** — every
  hypothesis in the incident write-up is reasoning, not evidence.
- **Workers Logs is enabled in `wrangler.toml` but has not been read back from
  the live settings API**, the way `audiobook-worker`'s was on 2026-08-17.
