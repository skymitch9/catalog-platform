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
> ⚠️ **Still wire-unverified: the classify floor** (deployed, unit-tested; no
> tail caught a post-floor turn — attach-timing races, and the night's
> distills had not fired by 19:00). Its failure mode is an invisible
> pennies-cost fallback; the next organic conversation settles it. The tool
> loop (most of the tokens) remains Anthropic-only — phase 2.
> Last verified: **2026-09-01** — the code was written and the test suite run
> this session (`test/gabi-groq.test.ts`, 44 tests; workspace 2247 pass / 0
> fail; typecheck clean). ⚠️ **NOT verified:** **no live Groq call has ever been
> made from this repo.** Every test drives an injected `fetch`. Nothing here
> proves Groq accepts what is built, that the pinned model is still live, or
> that the answers are good enough — the shadow ladder in §5 exists precisely
> because none of that is knowable yet.

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

## 2. ⚠️ THE SCOPE RULE — toolless calls only, and it is structural

The rung is reachable from **four** call sites. There is a fifth model call in
GABI's Discord surface and it is deliberately excluded.

| Call site | Shape out | The SHARED validator | On the rung? |
|---|---|---|---|
| `classifyIntent` — `gabi-chat.ts` | one bucket word | `isMentionIntent` | ✅ |
| `converse` — `gabi-chat.ts` | free prose | non-empty text | ✅ |
| `distillConversation` — `memory-distill.ts` | strict JSON | `parseProfile` | ✅ |
| `parseFixRequest` — `confirm-propose.ts` | strict JSON | `firstJsonObject` | ✅ |
| **`converseWithTools`** — `gabi-chat.ts` | tool loop | — | 🔴 **NO — phase 2** |

**Why the tool loop is out.** Anthropic's `tools` block and OpenAI's are
different schemas with different result-echo grammars, and `converseWithTools`
is a hand-written loop built entirely around the Anthropic one: a `tool_use`
block echoed back with a matching `tool_result`, `is_error: true` on a failed
tool, and the 400 that a dangling `tool_use` produces. Translating that is a
piece of work with its own failure modes, and the 2026-08-18 silent-partial
incident is the record of how subtle those failure modes are. So a tool turn
stays on Anthropic **in every posture**, and
`test/gabi-groq.test.ts` fails the build if one ever reaches `api.groq.com`.

⚠️ **This is also where most of the money is.** The tool loop has the largest
`max_tokens` (1024, against 24 for a classification) and runs several round
trips per turn. So v1 is deliberately the *cheap* half of the bill — it is
scoped for **safety**, not for savings, and the savings it produces will be
smaller than the call count suggests. Phase 2 is where the money is.

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

## 8. Phase 2 — the tool-schema translation

Not started, and not to be attempted as a "small addition":

- Anthropic `tools[]` (`input_schema`) → OpenAI `tools[].function`
  (`parameters`), and back for the results.
- `tool_use` blocks → `tool_calls` on the assistant message; `tool_result`
  content blocks → `role: "tool"` messages keyed by `tool_call_id`.
- Every invariant `converseWithTools`'s header records has to survive the
  translation: one user message carrying **all** the `tool_result`s for one
  assistant turn; a failed tool coming back `is_error` rather than dropped;
  the last permitted pass sending no tools at all; `needsFinishing`'s
  dangling-colon guard against the 2026-08-18 silent partial.
- Open-weights tool-calling accuracy is the actual question, and it is not
  answerable from the shadow lines this build produces — a shadow of a *tool*
  turn would have to execute the tools twice or compare unexecuted calls.

Nothing here blocks phase 2; the boundary is one `if` in `gabi-chat.ts` and the
health row `gabi_groq_scope` that names it.

---

## 9. ⚠️ NOT verified

- **No live Groq call has ever been made from this repo.** Every test drives an
  injected `fetch`. Whether Groq accepts this exact body, whether
  `llama-3.3-70b-versatile` is still a live id, and whether `response_format:
  json_object` behaves as assumed are all **unexercised**.
- **No shadow comparison has ever been logged**, because the posture is `off`
  and there is no key. Every claim in §5 about what the lines will say is a
  claim about code that has run only against fakes.
- **Answer quality is entirely unmeasured.** Nobody has read a Groq reply from
  this prompt set. The `converse` call is the one where that matters most and
  the one shadow can least help with (§5).
- **The savings are unmeasured, and may be small** (§2): the tool loop is
  excluded and it is where most of the tokens are.
- **The Groq bill is unknown.** No price table entry exists, deliberately (§3).
- `black_bot_baf` has **also** never made a live Groq call — its own
  `code-notes.md` says so in the same words. So the decisions carried over in
  §3 are *considered* decisions, not *proven* ones.
