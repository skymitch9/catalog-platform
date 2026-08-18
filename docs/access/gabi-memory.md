# GABI's memory (tier 2) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (this repo is PUBLIC —
> resource and secret NAMES only, never values).
> Last verified: **2026-08-18**. Phase 1 built and deployed **dark**.

*How to switch her memory on and off, where a profile lives, how to see or clear
one, and what to check when she seems to have forgotten somebody.* For why it is
shaped this way, see [`../info/gabi-memory-design.md`](../info/gabi-memory-design.md).

---

## 1. What is built, and what is not

| Tier | State |
|---|---|
| 1 — 30-min verbatim window | live since before this feature, **unchanged** |
| **2 — per-person profile** | ✅ **built, deployed DARK 2026-08-18** |
| 3 — archive + recall tool | ❌ not built (design §9 phases 2–3) |
| identity merge on `/link` | ❌ not built (phase 4) |

---

## 2. The one lever

| Lever | Where | Effect |
|---|---|---|
| `GABI_MEMORY` | var in `apps/discord-worker/wrangler.toml` | affirmative-only `"on"`. Ships `"off"` |

**To turn it on:** set `GABI_MEMORY = "on"`, `npx wrangler deploy` from
`apps/discord-worker`. **To turn it off:** the same line back, and deploy.

⚠️ **OFF is silent, and that is correct here** where it was not for books:
nobody asks a question only memory could answer, so there is no sentence to say.
The 30-minute window still works, nothing is written, nothing is read, and no
prompt changes.

⚠️ **Turning it off does NOT delete existing profiles.** They stop being read and
stop being written. To actually erase one, use the person's own control (§4) —
or delete the Firestore document.

**Check it:**

```powershell
(Invoke-RestMethod https://discord.heygabi.ai/api/health) |
  Select-Object gabi_memory_enabled, gabi_memory_ready, gabi_memory_profile_max_bytes
```

⚠️ **Note what is NOT in that readiness AND: an app token.** `ready` is the
posture plus `FIREBASE_SERVICE_ACCOUNT` — the credential this Worker already
held. That absence is the design's Firestore argument, visible in one curl.

---

## 3. Where a profile lives

| | |
|---|---|
| Collection | `gabi_profiles/{personKey}` (Firestore, the audiobook-catalog project) |
| Person key | `discord:<snowflake>` today; `estate:<email>` once phase 4 lands |
| Shape | one `json` string field, plus `v` and `updatedAt` |
| Cap | **2 KB**, enforced on write by dropping whole entries |

⚠️ **One JSON string field, deliberately** — it makes `parseProfile` the only
validator on both read and write, so the schema cannot drift into a second
place. The cost, stated: Firestore cannot query *inside* a profile. Nothing
needs to.

---

## 4. What a person can do about it

Works in a DM, in an @mention, and via `/gabi` — **no slash command was
registered**, it is a deterministic detector, so it behaves the same everywhere.

| They say | She does |
|---|---|
| `memory` · `/gabi memory` · *"what do you know about me?"* | shows the profile in plain sentences |
| `memory forget` · *"forget what you know about me"* | **deletes** the document |

⚠️ **`forget` is checked BEFORE `show`** — *"forget what you remember about me"*
contains a show-shaped clause, and reading a privacy request as a request to
display would be the worst possible misreading.

⚠️ **A failed delete is never reported as success.** If the delete does not
return ok, she says nothing was deleted and asks them to try again.

---

## 5. How a profile gets written

The two-minute cron pokes `POST /conv/sweep` on the gateway Durable Object. The
sweep finds conversations whose last word is older than 30 minutes, distils each
with **one cheap Haiku call**, writes the profile, and **only then** deletes the
conversation record.

⚠️ **The order is the safety property** — read → distil → write → delete. Every
failure leaves the record for the next sweep, with one bounded exception:
`DISTILL_GIVE_UP_MS` (24 h past expiry) deletes an undistillable record and logs
it loudly, so one poisonous record cannot consume every sweep's allowance for
ever.

---

## 6. Gotchas that cost real time

- ⚠️ **"She forgot me" is usually the POSTURE, not a bug.** Check
  `gabi_memory_enabled` first. With it off, nothing is ever written, so profiles
  do not accumulate quietly in the background waiting to be switched on.
- ⚠️ **A profile only appears AFTER a conversation ends.** Nothing is written
  mid-conversation, so a person who has been talking to her for ten minutes still
  has an empty profile. That is correct and it looks exactly like a fault. Give
  it 30 minutes plus one sweep.
- ⚠️ **An empty profile is never injected**, so a person with nothing noted gets
  the pre-feature prompt exactly. `/gabi memory` says so in words rather than
  showing an empty document.
- ⚠️ **The read path no longer deletes aged-out conversations while memory is
  on** — the sweep owns that, or a person returning at 30m01s would destroy the
  conversation before it was distilled. If you see `conv:` records older than 30
  minutes lingering in the DO, that is by design and the sweep will take them.
- ⚠️ **A profile is COLOUR, never evidence.** It may not decide what she has read
  (a listing call in the turn decides that) and it may not decide a spoiler bound
  (the question decides that). Both are asserted in the prompt block and pinned
  by test. If a book answer ever cites a profile, that is the bug to chase.
- **Distillation quality is unmeasured.** No profile has been produced by a real
  conversation yet. The first week should be graded by reading real profiles
  (`/gabi memory` as several people) and the 2 KB cap re-argued then.

---

## 7. Rolling back

| Want | Do |
|---|---|
| Stop reading and writing profiles | `GABI_MEMORY = "off"` + deploy |
| Erase one person's profile | they run `/gabi memory forget`, or delete `gabi_profiles/{key}` |
| Erase everything | delete the `gabi_profiles` collection — nothing else references it |
| Undo the code | phases 1a–1c are three commits on `main`, `apps/discord-worker` only |
