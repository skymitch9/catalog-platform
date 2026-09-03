# GABI's Groq first line — Information Reference

> **Audience:** Claude sessions first, the owner second.
> **Status:** TRACKED — **LIVE IN `first` since 2026-09-01 evening** (owner:
> *"make sure Groq is the primary"*), and the primary claim is **proven on the
> wire**: a real household turn's `converse` answered `outcome: "groq"`
> (566 ms, 2,477 in / 98 out) on `openai/gpt-oss-120b`. The evening's ledger,
> each step measured:
>
> 1. Key pushed byte-verified (56 bytes / `gsk` / no BOM) → `shadow` deployed.
> 2. Every first shadow line `refused` — the shadow logger did not carry
>    `status` (fixed TWICE: once at the call site, which the field-by-field
>    logger silently dropped, then in the logger itself — a field-by-field
>    logger needs the field in BOTH places).
> 3. The status was **404**: the inherited pin `llama-3.3-70b-versatile` had
>    been DEPRECATED by Groq on 2026-08-16 — and `black_bot_baf` never made a
>    live call either, so nothing ever exercised it. Repinned to
>    `openai/gpt-oss-120b` (their named replacement); that repo's TODO warned.
> 4. First success (`converse`), but `classify` fell back on an EMPTY 200 —
>    gpt-oss is a REASONING model and spends a classification-sized cap
>    entirely on thinking. The Groq attempt now floors `max_tokens` at 512 +
>    `reasoning_effort: "low"`.
> 5. ✅ **The classify floor VERIFIED ON THE WIRE, 2026-09-01 20:23 Phoenix**
>    — the owner's next organic mention: `classify → outcome: "groq"` (94 ms,
>    19 out) and `converse → outcome: "groq"` (378 ms). **Zero fallback on the
>    turn: every toolless call type now answers on Groq.**
> 6. ✅ **PHASE 2 SHIPPED 2026-09-02** — the tool loop, which is where most of
>    the tokens are, now rides Groq first too when every tool it offers is
>    read-only. Ledger entry: [§10](#10--2026-09-02--phase-2-the-tool-loop-ledger-entry).
> 7. 🔴 **AND THE FIRST LIVE TOOL TEST, THE SAME MORNING, REFUSED EVERY PASS
>    `HTTP 413` IN ~37 ms.** The ceiling is the **free tier's 8,000 TPM**, not
>    a bug: the request was ~7,960 tokens before the question. Diagnosed and
>    answered in [§11](#11--the-free-tier-is-the-ceiling--413-diagnosed-2026-09-02) —
>    lean schemas (54% off the tool payload), capped tool results, family
>    narrowing, a pre-flight that refuses to send a doomed request, and **the
>    hybrid: Groq chooses the tools, Haiku speaks.** ⚠️ 🔴 **Half of this is an
>    OWNER decision — upgrading the Groq plan raises the limit** (§11.2).
>
> 8. ✅ **STATUS, CORRECTED 2026-09-03 — this rung is NOT "shipping dark" and
>    NOT "toolless only", and any line elsewhere still saying so is stale.**
>    `GABI_GROQ = "first"` is LIVE (`apps/discord-worker/wrangler.toml:588`) and
>    **phase 2 — tool loops on Groq, allowlist-gated — is live too**. Measured
>    the same evening, 19:12Z: a `converse_tools` line reading
>    `outcome:"ineligible"`, `ineligible_reason:"tool_not_allowlisted"`,
>    `blocked_tools:["count_phrase"]`, `tools_offered:11`. The new
>    `count_phrase` tool (shipped that morning, `4151f80`) had been left off
>    `GROQ_READ_ONLY_TOOL_NAMES` on purpose — and because **the gate is
>    all-or-nothing per LOOP**, that one name was sinking **every** converse
>    loop to Haiku, not merely the book ones. Allowlisted: it is read-only
>    (GET; counts + chapter anchors + ≤3 quotes ≤400 chars), a strict subset of
>    what `search_book_text` already sends. ⚠️ **The general lesson, which is
>    bigger than this tool: on a per-loop gate, holding ONE tool back is not a
>    narrow decision — it is a decision about every loop that tool is offered
>    on.** A new tool's default-deny is still right; noticing what it costs is
>    the part that needs a live line to see.
>
> Last verified: **2026-09-03** — `count_phrase` allowlisted; `apps/discord-worker`
> **1246 pass / 0 fail**, typecheck clean. Everything below §8 last verified
> **2026-09-02 (evening)** — the polish batch, [§12](#12--2026-09-02-evening--the-polish-batch-ledger-entry),
> which measured `test/gabi-groq.test.ts` at **97 tests** and the workspace at
> **2452 pass / 0 fail**. ⚠️ **NOT verified:** **no live Groq TOOL call has ever
> SUCCEEDED from this repo** — every attempt so far was refused before the model
> saw it. Whether an open-weights model calls these tools *accurately* is still
> the real question, and §5's shadow ladder cannot answer it — see §8 and §12.2.

The owner's ask, 2026-09-01, verbatim:

> *"we just used groq in a different project, lets integrate that into our gabi
> model as a first line before going to haiku tokens"*

and, in the same breath:

> *"use the information from the other project to help reduce duplicate work"*

---

## 1. What was built, in one paragraph

A **first-line rung**: on the GABI calls that carry no tools, one attempt at
Groq's OpenAI-compatible endpoint with a pinned open-weights model and a tight
timeout, and on **any** failure the existing Haiku call runs exactly as it did
before. It ships behind a three-state posture (`off` → `shadow` → `first`) and
a separate secret, and neither half alone changes a single answer.

Code: [`apps/discord-worker/src/gabi-groq.ts`](../../apps/discord-worker/src/gabi-groq.ts).
Tests: `apps/discord-worker/test/gabi-groq.test.ts`.
Money path: [`llm-billing-control-design.md`](llm-billing-control-design.md) §2.4 row **E7**.
Operating it: [`../access/discord-bot.md`](../access/discord-bot.md) §3.

---

## 2. ⚠️ THE SCOPE RULE — five call sites, and the fifth has its own gate

The rung is reachable from **five** call sites. Four send `system` + `messages`
and nothing else; the fifth is the tool loop, and it rides a *different* code
path under a *stricter* condition.

| Call site | Shape out | The SHARED validator | On the rung? |
|---|---|---|---|
| `classifyIntent` — `gabi-chat.ts` | one bucket word | `isMentionIntent` | ✅ |
| `converse` — `gabi-chat.ts` | free prose | non-empty text | ✅ |
| `distillConversation` — `memory-distill.ts` | strict JSON | `parseProfile` | ✅ |
| `parseFixRequest` — `confirm-propose.ts` | strict JSON | `firstJsonObject` | ✅ |
| **`converseWithTools`** — `gabi-chat.ts` | tool loop | the loop's own guards | ⚠️ **only under `first`, only when every offered tool is allowlisted** — [§8](#8-phase-2--the-tool-loop-2026-09-02) |

**Why the tool loop needed its own piece of work.** Anthropic's `tools` block
and OpenAI's are different schemas with different result-echo grammars, and
`converseWithTools` is a hand-written loop built entirely around the Anthropic
one: a `tool_use` block echoed back with a matching `tool_result`,
`is_error: true` on a failed tool, and the 400 that a dangling `tool_use`
produces. The 2026-08-18 silent-partial incident is the record of how subtle
those failure modes are. §8 is the translation and the three conditions that
gate it.

⚠️ **This is also where most of the money is.** The tool loop has the largest
`max_tokens` (1024, against 24 for a classification) and runs several round
trips per turn. So **phase 1 was deliberately the *cheap* half of the bill** —
scoped for safety, not for savings — and phase 2 is the half that pays.

### 2.1 The validators are SHARED, not duplicated

⚠️ **One schema, two transports.** `viaGroq`'s `validate` argument is the same
function object the Haiku branch runs on its own reply — not a copy of it — so
a Groq answer that would have been rejected on the Anthropic path is rejected
here too, and falls through (`reason: "invalid"`). There is no configuration in
which the cheap model's output is held to a lower bar than the expensive one's.

⚠️ **But the validator is the PARSE, never the DECISION**, and that cut is
load-bearing. On `parseFixRequest` the validator is `firstJsonObject` — "is
this a well-formed object" — and **not** the field mapping. `{"field":"none"}`
is the model answering *correctly* about the overwhelming majority of messages;
treating it as a transport failure would spend a full Haiku turn on every piece
of small talk, which is the exact opposite of what the rung is for.

---

## 3. What came from `black_bot_baf`, and what did not

The estate's other Groq integration (`black_bloc/groq.py`, `llm.py`,
`chat_llm.py`) had already paid for these decisions. Carried over rather than
re-argued:

| Decision | Their source | Carried? |
|---|---|---|
| Endpoint `https://api.groq.com/openai/v1/chat/completions` | `groq.py:20` | ✅ unchanged |
| Model `llama-3.3-70b-versatile` | `groq.py:21` | ✅ unchanged — see below |
| Model id lives as a **constant**, not a computed thing | `code-notes.md`: *"Groq retires model names faster than a deploy can follow."* | ✅ unchanged |
| OpenAI body shape: `model`, `max_tokens`, system as a leading message | `groq.py:76-80` | ✅ unchanged |
| Key rides `Authorization` and nowhere else | `test_the_key_rides_the_authorization_header_and_nothing_else` | ✅ unchanged, and asserted here too |
| Error taxonomy: 429 own reason, ≥500 unreachable, other non-200 refused, transport wrapped at the boundary | `groq.py:94-98`, `code-notes.md` on `groq.py:53` | ✅ carried, **split three ways** (below) |
| ⚠️ **A 200 with no words in it is a FAILURE, not a silent blank** | `test_an_answer_with_no_words_in_it_is_a_failure_not_a_silent_blank` | ✅ unchanged |
| Groq priced at **zero** in the table, as an open decision | `llm.py:43,48`; `code-notes.md`: *"Groq's unknown falls to zero because its tier genuinely is free today; that is a decision to revisit when it is not."* | ✅ carried as *no price at all* (below) |
| Cheap model gets the SIMPLE tier; important work stays on Haiku | `chat_llm.py:148` `tier_for`, `:161` `ladder` | ✅ same cut, drawn at "toolless" instead of at their four routing rules |

### Deliberately CHANGED, with the reason

| Theirs | Here | Why |
|---|---|---|
| `REQUEST_TIMEOUT_SECONDS = 15` (`groq.py:22`) | **`GROQ_TIMEOUT_MS = 4_000`** | Theirs is a ladder that can afford to wait. Here a Groq hang costs the person the timeout **plus** the whole 20 s Haiku turn (`CHAT_TIMEOUT_MS`), on a surface where they are watching a typing indicator. Groq answers a 70B completion in well under a second, so 4 s is already ~10× the expected latency. **A slow first line is worse than a costlier fast one.** |
| Four reasons: `rate_limited` / `refused` / `unreachable` / `broken` | **Eight**: adds `timeout`, `server`, `empty`, `invalid` | `timeout` split out of `unreachable` because it is the one that costs real seconds; `empty` out of `broken` because their own test says an empty answer is its own failure; `invalid` is new — it names *"the reply arrived and failed the SHARED validator"*, which their design has no equivalent of because it has no shared validator. Every one of the eight is still a fall-through, never an error anybody sees. |
| One `llm_ledger` row per call, with a shared `turn` id so a fall-through is *two rows and one turn* (`db.py:405`) | **A `gabi_groq` log line, and NO `accountTurn` call** | This Worker has no D1 binding — `gabi-chat.ts`'s `accountTurn` note records that compromise and it applies here unchanged. The important half of their decision is kept: a fall-through is honestly TWO spends, and it writes one `gabi_turn` line and one `gabi_groq` line. |
| A price table entry of `Price(0.0, 0.0)` | **No price at all — raw token counts only** | Same open decision, expressed more honestly: a zero in a price table is a *claim* that it is free, and a claim that will be silently wrong the day it is not. Raw counts with no cents cannot be wrong; they can only be uncomputed. |
| `MAX_RETRIES = 1` on the Anthropic client (`llm.py:20`) | **One Groq attempt, no retries anywhere** | This repo's Anthropic client already pins `maxRetries: 0` (`NO_RETRIES`, `gabi-chat.ts`) for a reason written there: *a retried turn is double spend on an answer that may already have landed.* ⚠️ **The fallback IS the retry**, and it retries against a *different provider*, which strictly beats asking the same rate-limited endpoint twice. |
| The model is a per-guild **setting** (`chat_llm.py:70` `SIMPLE_MODEL_KEY`) | A **constant** | They run a multi-guild bot where an operator may need to react to a retirement without a deploy. This estate has one Worker, one owner and a deploy takes a minute; a setting would be a second place for the model id to live. The retirement risk is answered instead by `/api/health` reporting `gabi_groq_model`, so the running pin is checkable in one curl. |

### On the model choice specifically

`llama-3.3-70b-versatile` is what `black_bot_baf` chose, and their
`code-notes.md` records **no** reason it is wrong for chat — the only thing it
records about the id is the retirement gotcha, which is why it is a constant
here too. They assign it the same job this rung does: the cheap tier for
banter, with anything that has to be right left on Haiku. So the decision
transfers rather than being re-taken.

⚠️ **What is NOT known:** whether that id is still live on Groq. Nothing in
this repo has ever called the API. A retirement surfaces as `reason: "refused"`
on the `gabi_groq` line with a 400 status and a silent fall-through to Haiku —
never as a broken bot — and the fix is one constant plus a deploy.

---

## 4. The three postures

`GABI_GROQ` is a plain var in `wrangler.toml`, coerced by `groqMode()`.

| Value | Behaviour |
|---|---|
| **`off`** (ships) | ⚠️ Byte-identical to the pre-Groq bot. The prompt is not even **built** — `viaGroq`'s `turn` argument is a thunk and it is never invoked. Pinned by a test that counts invocations, not requests. |
| **`shadow`** | Groq is called *beside* Haiku and one `gabi_groq_shadow` line is logged. ⚠️ **Haiku's answer is the one used**, always. |
| **`first`** | Groq is tried once. On success its answer is used and no Haiku turn is spent. On any failure, one `gabi_groq` line names the reason and the existing Haiku call runs unchanged. |

⚠️ **`shadow` covers the FOUR TOOLLESS calls only.** Since phase 2 a tool loop
honours `first` and ignores `shadow` — shadowing one would execute every tool
twice — so under `shadow` a tool loop is 100% Anthropic and logs one
`outcome: "ineligible", ineligible_reason: "posture_shadow"` line saying so
([§8.3](#83--the-three-conditions-and-why-each-is-drawn-where-it-is)).

⚠️ **FAIL CLOSED.** Anything that is not exactly `shadow` or `first` — absent,
empty, `"on"`, `"true"`, `"1"`, a capital, a typo — is `off`. `"on"` and
`"true"` are the dangerous ones, because they are what somebody who knows this
Worker's *other* postures would type, and guessing them into `first` would
enable an unreviewed model swap by typo. This is the same posture as
`normalise_pause_mode` in the audiobook repo: an unrecognised mode is never
guessed into the more permissive neighbour.

**The posture and the key are independent**, deliberately. Either can land
first; neither alone changes an answer. `/api/health` reports both halves
separately (`gabi_groq`, `configured.groq_key_gabi`) plus the derived
`gabi_groq_ready`.

### In `shadow`, the Groq call adds no latency

It is started **before** the Haiku call and awaited **after** it, so the
comparison is free to the person waiting. A shadow that made turns slower would
be measured — correctly — as a reason not to flip.

---

## 5. The shadow ladder — what to read, and what "good enough" means

⚠️ **Off → shadow → enforce is the estate's standing enforcement rule**, and the
flip to `first` is the **owner's**, made after reading the lines. It is never a
side effect of a deploy and never an agent's.

```bash
npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq_shadow")'
```

Each line carries, and carries **only**:

| Field | What it answers |
|---|---|
| `purpose` | which of the four call sites (`classify` / `converse` / `distill` / `parse_fix`) |
| `groq_ms`, `haiku_ms` | is it actually faster, here, on this Worker |
| `groq_chars`, `haiku_chars` | is it answering at a comparable length |
| `groq_answered`, `haiku_answered` | ⚠️ the did-it-answer bits — `false` on Groq's side includes *"it replied and failed the shared validator"* |
| `reason` | when it did not answer, which of the eight failure classes |
| `agreed` | ⚠️ **only where agreement is meaningful** — `classify` (same bucket?) and `parse_fix` (same field?). Absent on prose turns, because two free-text replies are never string-equal and an equality bit there would be a number that always says the same thing. |
| `input_tokens`, `output_tokens` | the new bill, raw |

⚠️ **THE TEXTS ARE NEVER LOGGED, on either side.** These are household
conversations, and the log stream's audience is anyone who can run
`wrangler tail`. The same rule `accountTurn` already applies to the remembered
text, the docs payloads and the book passages. A test asserts it.

**A reasonable flip criterion**, offered rather than imposed: `agreed: true` on
the overwhelming majority of `classify` lines, `groq_answered: true` on nearly
all of them, and `groq_ms` genuinely below `haiku_ms`. ⚠️ Prose quality is
**not** measurable from these lines — `converse` is the call where the owner has
to read some actual replies before trusting the swap, and `shadow` cannot show
him those without logging them. The honest way to judge `converse` is to flip
`first` and *talk to her*, knowing a bad turn is one posture flip from being
undone.

---

## 6. Where the failure lines are, and what each one means

```bash
npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq")'
```

| `reason` | What actually happened | What to do |
|---|---|---|
| `timeout` | no answer in 4 s | if constant, Groq is degraded — set `off` |
| `unreachable` | the fetch itself threw | network/DNS; usually transient |
| `rate_limited` | HTTP 429 | the free tier's ceiling. Constant 429s mean the rung is costing latency and buying nothing — set `off` |
| `refused` | HTTP 4xx | ⚠️ **401 = a bad key, and the classic cause is a BOM** (§7). **400 with `model_decommissioned` = the pin is retired** — change `GABI_GROQ_MODEL` |
| `server` | HTTP 5xx | Groq's side |
| `malformed` | 200, body not JSON | a proxy or an error page |
| `empty` | 200, no words in it | the model produced nothing |
| `invalid` | 200, well-formed, **failed the shared validator** | ⚠️ the interesting one — the model is answering but not in the shape the estate needs. A run of these on one `purpose` is a prompt problem, not an outage |

⚠️ **`outcome: "fallback"` is not an incident.** It is the ladder working. The
incident shape is a *sustained* run of them, which means the rung is buying
nothing while costing every turn up to 4 s.

---

## 7. ⚠️ The BOM trap, and the one sanctioned way to push the key

`docs/access/agent-board.md` §3 and this Worker's own incident,
`docs/access/discord-bot.md` §7:

> A PowerShell pipe to a native process prepends an invisible UTF-8 BOM
> (`EF BB BF`); the stored credential is then wrong **while looking perfect
> everywhere a human can check it**, and the failure surfaces as a plain 401
> with a valid-looking key.

That is exactly how `ANTHROPIC_API_KEY_GABI` was broken on 2026-08-18 — GABI
heard every mention and answered none. ⚠️ The first "fix" (`$OutputEncoding` +
trim) was **measured not to work** and is revoked as ritual.

**Use the script**, which side-steps the shell that breaks it:

```bash
node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI
```

It reads the named line out of `apps/discord-worker/.dev.vars` (gitignored),
prints the byte facts — length, first three bytes, last byte — *never the
value*, writes raw bytes to `wrangler`'s stdin from Node (where no encoder can
add a BOM), and blanks the `.dev.vars` line afterwards. It **refuses** a value
that already starts `239 187 191`.

⚠️ **A BOM'd Groq key would be much harder to spot than the Anthropic one was**,
because this rung's whole design is to fail invisibly: every turn would still be
answered, by Haiku, and the only evidence would be a `gabi_groq` line reading
`reason: "refused", status: 401`. That is why the shadow step exists — it makes
the first live call happen while somebody is watching a log.

---

## 8. Phase 2 — the tool loop (2026-09-02)

Code: [`apps/discord-worker/src/gabi-groq-tools.ts`](../../apps/discord-worker/src/gabi-groq-tools.ts)
(the translation) + the gate in `converseWithTools`. Allowlist:
`GROQ_READ_ONLY_TOOL_NAMES` in `gabi-tools.ts`, beside the tool definitions.

### 8.1 ⚠️ The one decision everything else follows from

**The conversation state stays in ANTHROPIC grammar, always.** The loop's
`messages` array is never touched by the translation: OpenAI shapes exist only
for the length of one HTTP request, built fresh on the way out and translated
straight back into Anthropic content **blocks** on the way in. Nothing
downstream — `textOf`, `toolUseBlocks`, `needsFinishing`, the `tool_result`
echo, the `is_error` rule — learns that a second provider exists.

Two things fall out of that, and both are the reason for it:

1. ⚠️ **A per-turn fallback is a genuine replay.** A failed Groq pass could not
   have mutated anything, so the Haiku call that replaces it starts from
   *byte-identical* state. "Replay that turn on Haiku" is a property of the data
   structure rather than a promise in a comment.
2. ⚠️ **The invariants survive by construction.** One user message carrying ALL
   of a turn's results, `is_error` rather than a drop, no tools on the last
   permitted pass, the dangling-colon guard, `MAX_TOOL_ITERATIONS` — every one
   lives in the loop and acts on the same array whichever provider answered.

### 8.2 The grammar, field by field

| Anthropic | OpenAI (Groq) |
|---|---|
| `tools[].input_schema` | `tools[].function.parameters`, under `type:"function"` — passed **by reference**, never rebuilt |
| assistant `tool_use` block | `tool_calls[]`, arguments as a **JSON string** (an object there is a 400) |
| user message of `tool_result` blocks | N consecutive `role:"tool"` messages, `tool_call_id` matching, in order, before any prose |
| `is_error: true` | ⚠️ no such field — becomes **plain text** in front of the content |
| `stop_reason: "tool_use"` / `"max_tokens"` | `finish_reason: "tool_calls"` / `"length"` |

⚠️ **`is_error` is the one that cannot be translated and must not be dropped.**
Dropping it would teach the model that an outage and an absence are the same
thing — here, the difference between *"the house does not own it"* and a wrong
answer.

⚠️ **A pass that produced CALLS is `tool_use` whatever `finish_reason` said.**
Read `finish_reason` alone and a server saying `stop` beside a `tool_calls`
array would have its calls dropped and its narration posted as the answer — the
2026-08-18 silent partial arriving through a new door.

### 8.3 ⚠️ The three conditions, and why each is drawn where it is

A loop rides Groq only when **all three** hold. Otherwise it is 100% Anthropic
and one `outcome: "ineligible"` line says which condition failed.

| Condition | Why |
|---|---|
| posture is exactly **`first`** | ⚠️ **`shadow` is excluded and it is not an oversight.** Shadowing a tool loop would run the loop twice and **execute every tool twice** with it, against live estate services. So tool loops go straight to first-with-fallback under the same `GABI_GROQ` var — no new posture, nothing new for the owner to set. |
| a key exists | unchanged from §4 |
| **every** offered tool is on `GROQ_READ_ONLY_TOOL_NAMES` | see below |

⚠️ **The allowlist is an explicit LITERAL, not a spread of the family arrays.**
The spread reads better and is wrong: it would make a tool added tomorrow
eligible **by default**, silently, as a side effect of a commit about something
else. Written out, a new tool defaults to NOT allowlisted. Same default-deny
shape as `GABI_TOOL_NAMES` and `GABI_DELEGATED_VERB_NAMES`. **Fourteen** names
today (thirteen at phase 2; `count_phrase` added 2026-09-03 — see the header's
step 8), every one `mutates: false`; a test fails the build if one is not an
offered tool, and another asserts no delegated or confirm verb can be on it.

⚠️ **The gate is per LOOP, not per turn.** A loop carrying a mutating tool also
carries the conversation state that decides whether to call it, so letting its
"safe" turns ride Groq would put the cheap model in the seat that *proposes* the
write.

⚠️ **The corollary, stated rather than buried:** an eligible loop sends the tool
RESULTS to Groq too — book passages, the asker's own TBR and reviews, estate
runbook sections. Every one already goes to Anthropic; phase 2 adds a second
processor. **Removing a name from the array is the one-line way to take a
category back**, and it needs no other change.

### 8.4 Fallback: per turn, then sticky

A pass that errors, times out, returns an empty 200, names a tool this turn did
not offer, or sends arguments that fail validation is replayed on Haiku from the
identical state — safe **because the failed pass's tools were never executed**.
Once a loop has fallen back it **finishes** on Haiku: ping-ponging providers
mid-loop would leave a conversation half-translated and half-native, which is two
grammars to be wrong about instead of one.

⚠️ **Argument validation is NEW, and it is the reason a translation layer is
allowed to exist.** The Anthropic path never needed it because the model emitting
the call and the schema constraining it are one vendor's. A different vendor's
open-weights model is exactly where a plausible call with a wrong-shaped argument
is likely and nothing downstream would notice — `runTool` would hand junk to a
catalogue query and get an empty result, which **reads as** *"the house does not
have it"*. Checked: every `required` property present, no undeclared property,
the declared scalar type, enum membership.

### 8.5 The lines to read

```bash
npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq" and .purpose=="converse_tools")'
```

| Field | What it answers |
|---|---|
| `outcome` | `groq` / `fallback` / **`ineligible`** (new) |
| `iteration` | which pass of the loop, 1-based (`0` on a toolless call) |
| `tools_offered` | how many tools that pass carried (`0` on the final tools-free pass) |
| `ineligible_reason` | `tool_not_allowlisted` or `posture_shadow` |
| `blocked_tools` | the offending names, so *"why is this loop still on Haiku?"* needs no TypeScript |

⚠️ **A Groq pass writes NO `gabi_turn` line.** `gabi_turn` means Anthropic spend
and must keep meaning that, or the billing inventory counts free tokens as Haiku
ones. So **a tool turn that produced `gabi_groq` lines and no `gabi_turn` line
is a turn that cost nothing at Anthropic** — that is the savings measurement.

⚠️ **The field-by-field logger drops unknown keys.** Every phase-2 field had to
be added in BOTH `logGroq`'s param type and its emitted object. This exact bug
shipped a `status` fix as a no-op on 2026-09-01 (see §5's note).

---

## 9. ⚠️ NOT verified

- 🔴 **No live Groq TOOL call has ever been made from this repo.** Every phase-2
  test drives an injected `fetch`. Whether Groq accepts this exact `tools` body,
  and **whether `openai/gpt-oss-120b` calls these tools accurately**, are both
  unexercised. ⚠️ Open-weights tool-calling accuracy is the *actual* question and
  §5's shadow ladder **cannot** answer it — a shadow of a tool turn would have to
  execute the tools twice. That is precisely why there is no shadow step here,
  and why the honest instrument is the `fallback` rate on the live lines.
- **The savings are still unmeasured**, though they are now measurable: count
  `converse_tools` turns with `gabi_groq` lines and no `gabi_turn` line (§8.5).
- **Answer quality on a tool turn is unmeasured.** Nobody has read a Groq
  tool-loop answer. The failure shape to watch for is not an error — it is a
  confidently wrong answer built on a tool call the model chose badly.
- **The Groq bill is unknown.** No price table entry exists, deliberately (§3).
- `black_bot_baf` has **also** never made a live Groq call — its own
  `code-notes.md` says so in the same words. So the decisions carried over in
  §3 are *considered* decisions, not *proven* ones.

---

## 10. 📓 2026-09-02 — phase 2, the tool loop (ledger entry)

**Shipped.** Commit `7d9a9b3`, deployed to `estate-discord` version
`f9cd77f3-6c99-4700-93f2-3d28cb147294` at 17:04 UTC from a throwaway worktree of
HEAD (`docs/info/worktree-deploys.md`; `.bin` 51 / 51 / 51 either side of the
teardown). No migration — this Worker has no D1.

- `src/gabi-groq-tools.ts` (new): the Anthropic↔OpenAI translation, §8.
- `GROQ_READ_ONLY_TOOL_NAMES` + `isGroqEligibleToolName` + `groqBlockedTools` in
  `gabi-tools.ts`, beside the tool definitions.
- `converseWithTools` gained the gate, the per-turn Groq pass and the sticky
  fallback; its `system` prompt is now built once and shared by both providers
  **byte for byte** (asserted — a fork would make every comparison a comparison
  of two different questions).
- `logGroq` gained `ineligible`, `iteration`, `tools_offered`,
  `ineligible_reason`, `blocked_tools` — each in **both** places.
- `/api/health`: `gabi_groq_scope` →
  `toolless_calls_plus_read_only_tool_loops_first_only`, new
  `gabi_groq_tool_allowlist` row naming the thirteen, new feature
  `gabi_groq_tool_loops`. ⚠️ `gabi_groq_rung_dark` keeps its now-inaccurate name
  on purpose: a feature NAME is what an external reader greps for.

**Verified**, GET `https://discord.heygabi.ai/api/health` → 200: the three rows
above are live, and every pre-existing field is unchanged (`gabi_groq` `first`,
ready `true`, model `openai/gpt-oss-120b`, `gabi_edge` `full`, `gabi_tools` 2,
`gabi_tool_max_iterations` 3, mentions enabled, all eleven `configured` rows
`true`). No secret-shaped value in the body. Tests before the deploy:
`test/gabi-groq.test.ts` 44 → 82, workspace 2269 → **2307 pass / 0 fail**,
typecheck clean, no existing assertion weakened.

**The phase-1 guard was REPLACED, not deleted.** The build-failing test that kept
a tool turn off `api.groq.com` in every posture is now a stricter set: shadowed
and ineligible loops still make zero Groq requests, `off` is still byte-identical
to before the rung existed, and every failure class still falls through
invisibly.

⚠️ **NOT verified — and the posture is already `first`, so the next tool-bearing
@mention IS the first live call.** See §9. The one thing to watch:

```bash
npx wrangler tail estate-discord --format json \
  | jq 'select(.evt=="gabi_groq" and .purpose=="converse_tools")'
```

A run of `outcome: "groq"` with rising `iteration` is the loop working. A run of
`outcome: "fallback"` with `reason: "invalid"` is the interesting failure — it
means the model is *calling tools* but not in a shape the estate accepts, which
is a prompt-or-model problem rather than an outage, and it costs a Haiku turn per
occurrence exactly as before phase 2.

---

## 11. ⚠️ THE FREE TIER IS THE CEILING — 413, diagnosed 2026-09-02

**The owner drove the first live tool test the morning after phase 2 shipped.
Every 12-tool pass refused `HTTP 413` in ~37 ms.** A 6-tool pass at **4,736
input tokens** rode Groq; the next pass — the same conversation with the tool
results appended — refused.

### 11.1 The diagnosis, and why it is a diagnosis rather than a hypothesis

Groq publishes, for `openai/gpt-oss-120b` on the **free plan**
(`console.groq.com/docs/rate-limits`, read 2026-09-02):

| limit | free plan |
|---|---|
| requests / minute | 30 |
| requests / day | 1,000 |
| **tokens / minute** | **8,000** |
| tokens / day | 200,000 |

and their errors page documents **413** as *"The request body is too large.
Please reduce the size of the request body."* A single request larger than the
whole minute's allowance can never succeed, so it is refused outright rather
than queued — which is exactly an instant 37 ms refusal rather than a wait.

**The arithmetic, measured in this repo the same day, fits his wire facts
exactly:**

| part of the request | tokens (≈) |
|---|---|
| system prompt with all addenda (11,267 chars) | 2,817 |
| 13 tool schemas as OpenAI functions (16,474 bytes) | 4,119 |
| `max_tokens`, charged against the same allowance | 1,024 |
| **total before one word of question** | **≈ 7,960** |

— against a ceiling of 8,000. And the pass that SUCCEEDED measured 4,736 +
1,024 = 5,760, comfortably under.

### 11.2 🔴 OWNER DECISION: the tier

⚠️ **Half of this fix is not ours.** The code can make the request smaller; it
cannot make the tier bigger. **Upgrading to Groq's Developer plan raises the
limit and turns every mitigation below into headroom rather than necessity.**
Nothing in the build assumes he will, and everything works — falling back to
Haiku — if he does not.

### 11.3 What the code does about it

Four levers, Groq-side only. The Anthropic array and prompt are untouched, so a
fallback always replays the turn at full fidelity.

| lever | measured effect |
|---|---|
| `leanTools` — tool + property descriptions clipped at a sentence boundary | **16,474 b → 7,522 b, 54% off**; the full 13-tool request goes from ~7,003 estimated tokens (over the 6,276 budget) to **~4,765 (fits)** |
| `capToolResult` — a result over 2,000 chars is cut **with a marker** | ⚠️ never silent: a silent truncation reads to the model exactly like an absence |
| `narrowToFamilies` — from pass 2, Tier 0 plus only the families this turn used | a catalogue turn drops to **2 tools / ~360 tokens** |
| `fitGroqRequest` — a **pre-flight**; a request that still does not fit is never sent | the fallback line carries `estimated_tokens` and `token_budget` |

⚠️ **There is deliberately NO lever that shortens the system prompt.** The
register lives there, and every line of it is a failure this estate has seen. A
cheaper model reading a shorter brief is how a confidently wrong answer gets
built. A turn that does not fit with the tools trimmed goes to Haiku whole.

### 11.4 ⚠️ THE HYBRID: Groq chooses, Haiku speaks

**Pre-approved option, taken 2026-09-02.** Two measurements pushed it over:

1. **The one answer that fully rode Groq was flat AND answered a different
   question than the one asked** (chars 273). Composition is the job the cheap
   model is worst at, and the only job the person actually sees.
2. **The composing pass is the one that 413s**, because it is the pass carrying
   every tool result.

So it is a quality fix and a payload fix at once. The rule is
`executed.length === 0`: before any tool has run, the pass is a **selection**
(read the question, pick the lookups) and Groq is good and free at it; the
moment results exist, the remaining job is prose and prose is Haiku's. The final
tools-free pass is prose by definition and is excluded too.

⚠️ This is a **narrowing** of phase 2, not a retreat: the pass that rides Groq
is the one that used to cost a full Haiku turn to decide which two of thirteen
tools to call, and the hand-off is a genuine replay — Haiku inherits
byte-identical Anthropic grammar whichever provider authored the `tool_use`
blocks in it.

⚠️ **It also shrinks the savings, and that is honest rather than hidden:** a
typical tool turn now spends one free pass and one-to-three Haiku passes, where
phase 2 aimed at all of them. The savings were never measured, so nothing
measured was lost.

---

## 12. 📓 2026-09-02 (evening) — the polish batch (ledger entry)

Seven commits, one concern each, on top of phase 2. Workspace **2418 → 2452
pass / 0 fail**, typecheck clean.

| commit | what |
|---|---|
| `8d1cc1a` | **Log first.** `error_text` on every `gabi_groq` / `gabi_groq_shadow` line (BOTH the param type and the emitted object); one shared non-200 taxonomy (`failureFor`); **413 becomes its own reason `too_large`**; the reasoning floor becomes `GROQ_MIN_MAX_TOKENS` in one place and rises 512 → 1024 |
| `a583076` | **Jake's Magical Market** — §13 |
| `0247cc3` | **The 413 ceiling** — §11 |
| `b26db3c` | **One retry, `empty` only** — an empty 200 on a reasoning model is a coin toss, not a state; every other reason still gets exactly one attempt, and the tool lane is deliberately excluded |
| `eebe2c0` | **The register through tool answers** — the licence gains *"the lookup answer is a performance too"*; `CHAT_TOOLS_SYSTEM` (NOT edge-gated) gains *"answer the question that was actually asked"* and *"a lookup answer is still you talking"* |
| `2cb83bc` | **Member mentions resolve to names** — §14 |
| `ee688ad` | **`CLUB_WRITE_SHAPES` measured** — four of seven guesses wrong; still dark |

### 12.1 The lines to read now

```bash
npx wrangler tail estate-discord --format json \
  | jq 'select(.evt=="gabi_groq")
        | {purpose, outcome, reason, status, iteration, tools_offered,
           estimated_tokens, token_budget, error_text, retried, ms}'
```

| what you want to know | what to look for |
|---|---|
| did the selection pass ride Groq? | `purpose:"converse_tools"`, `outcome:"groq"`, `iteration:1` |
| is the tier still the ceiling? | `reason:"too_large"` — with `estimated_tokens` vs `token_budget` when we refused it ourselves, or `status:413` + `error_text` when Groq did |
| **the undiagnosed 400** | `outcome:"fallback"` and `status:400` — `error_text` now names the cause |
| is the reasoning floor holding? | `retried:true` — an `empty` that needed a second attempt |

### 12.2 ⚠️ Still NOT verified

- **No live Groq TOOL call has ever SUCCEEDED from this repo.** Every 12-tool
  pass so far was refused before the model saw it. Whether
  `openai/gpt-oss-120b` picks these tools *accurately* remains the open
  question, and the honest instrument is the `fallback` rate with
  `reason: "invalid"` on the live lines.
- **The lean schemas are unexercised against a real model.** Trimming a
  description is a real cost to tool-choice accuracy, taken deliberately; the
  downside is bounded (a bad call is refused and replayed on Haiku) but it is
  not measured.
- **The 400 on `converse` is not diagnosed.** Ruled out by reading: an
  empty-content message (`normaliseHistory` drops empty turns and merges
  same-role ones) and a `json_object` ask without the word JSON (guarded, and
  `converse` does not ask for it). The body is what will name it.
- **Every prompt change is unheard.** A test over a prompt string proves the
  instruction is present, never that it is obeyed.

---

## 13. 📓 "Catalog's got nothing on that one yet" — about three books on the shelf

**Measured 2026-09-02 in #gabi-test:** *"do we have Jake's Magical Market on
audio?"* answered as an absence. The series has three volumes in the catalogue
(`catalog.csv` rows 3852 / 3859 / 3870). **Two independent faults**, both fixed.

**1. The reduction carried a format word.** `on` is a stopword and `audio` was
not, so `searchTermFor` produced `Jake's Magical Market audio` and the have lane
sent that to the index verbatim. Measured live, 17:54 UTC:

```
GET index.heygabi.ai/api/search?q=Jake's+Magical+Market&source=audiobook        → 3 books
GET index.heygabi.ai/api/search?q=Jake's+Magical+Market+audio&source=audiobook  → 0 books
```

Fixed with a closed list of format nouns stripped from the **tail only**. ⚠️ A
LEADING strip was written, measured and **rejected**: it helps *"the audiobook
of X"* and breaks *"The Audio Vault Chronicles"*, because `The` is already a
stopword, which makes a title's own first word leading. Trading a measured miss
for an unmeasured one is not a fix.

**2. ⚠️ THE LANE READS THE INDEX, NOT THE CSV — and this is the durable half.**
The 2026-08-31 scorer fix that handles a chatty query *wrapping* a title lives
in `catalog-data.ts`; the have lane queries `index.heygabi.ai` and never touches
it. **Its fixture tests passed all week while the live path missed.** So a zero
from the index now takes a **second look at the catalogue** — with the whole
question, which is the input the reverse-containment rule was built for — before
reporting an absence. ⚠️ Only on a genuine zero: an index **failure** keeps its
own worded sentence, because an outage is never an absence.

⚠️ **The lesson worth carrying:** a fixture test on the right function is not
evidence about the live path. Ask which SOURCE the lane actually queries before
believing a scorer fix reached it.

---

## 14. 📓 @Diva's TBR, answered with the asker's stats

**Measured 2026-09-02:** the owner asked about **@Diva's** TBR. GABI said she
can only read her own shelf — and then quoted **his** stats as though they were
Diva's.

⚠️ **The root cause is DATA, not prompt.** `stripMention` removes GABI's own
token and nothing else, so the question reached the model as a bare snowflake,
which names nobody. The model then had a question about a person it could not
identify and a set of tools that read *"the asker's own"* rows, and it filled
the gap with the only data in the room.

⚠️ **That is the worst class of answer this surface can produce.** Not a refusal
and not an absence: somebody's private reading, attributed to a third party,
stated confidently, in a public channel.

- `nameMentions` resolves every OTHER member's `<@id>` to `@DisplayName` once,
  in `mentionTrigger`, before any door reads the content. Her own token is
  deliberately left for `stripMention` — naming it would put "@GABI" into her
  own prompt as a third party.
- `safeMemberName` sanitises it: `<`, `>`, `@` and backticks removed so a name
  can never rebuild a mention token, newlines flattened so it cannot open an
  instruction line of its own, capped at 64 chars. ⚠️ A name that sanitises away
  to nothing leaves the **raw token** alone — unresolvable beats misleadingly
  resolved.
- The prompt rule carries the honest half: the `my_*` tools must not be called
  for a third party at all, the refusal must use **that person's name** — and
  `book_reviews` **is** a real cross-person read (reviews are public on the
  estate sites), so *"what did Sam think of X?"* is answerable while *"what's on
  Sam's TBR?"* is not, and she offers the one she has.

Checked, per the brief: the fun menu's `/progress` is a **write** command. There
is **no** cross-member progress read on this surface, so the honest sentence is
the whole of the answer for anything but reviews.
