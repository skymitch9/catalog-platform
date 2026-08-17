# Audiobook estate-auth SHADOW SOAK — Evidence Pack, 2026-08-16 — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-16** (23:21 MST / 2026-08-17 06:21Z).

**Purpose:** the measured evidence for the owner-gated decision in
[`audiobook-auth-migration.md`](audiobook-auth-migration.md) §4 — whether
`ESTATE_CHECK` on `apps/audiobook-worker` may move `shadow` → `enforce`.

---

## ⚠️ VERDICT — NOT ENOUGH EVIDENCE. DO NOT FLIP. Re-run in ~7 days.

The flip criterion is **not met**, and it is not met for a reason stronger than
"the numbers look bad": **there are no numbers.** Zero organic gate decisions
have been observed, on any surface, by anyone.

The design already anticipated exactly this and wrote the rule that governs it:

> *"A surface that nobody exercised during soak has not soaked — absence of
> lines is only evidence when the action demonstrably ran."*
> — `audiobook-auth-migration.md` §4

Every one of the 23 instrumented actions is currently in that state. **Zero
would-deny lines out of zero observed decisions is not "zero false denials" —
it is an unmeasured system**, and reading it as a pass would be precisely the
padding-thin-data-into-confidence failure this pack exists to prevent.

Four independent blockers, each sufficient on its own:

| # | Blocker | Detail |
|---|---|---|
| 1 | **Soak is hours, not days** | Prod-lane reporter live **1h 52m**; server in shadow **4h 17m**. The criterion says *"Days of shadow soak."* |
| 2 | **Zero organic decisions observed** | 5-minute tail: 3 worker requests total, **all 3 were mine**. No household actor exercised any gated surface. |
| 3 | **2 of 25 gated actions are not instrumented at all** | `warning.modDelete`, `read.setSlot` — see §5. Their silence can never be evidence. |
| 4 | **The telemetry cannot distinguish a false denial from an agreeing denial** | `reportGate()` fires in a `finally` block and carries no success/failure field — see §6. This weakens the criterion *as written*. |

⚠️ **Blocker 4 is a design finding, not just a data shortage.** Even a perfect
7-day soak, with the current payload, could not answer the question the flip
criterion actually asks. Fixing it (§7.1) should precede the re-run, or the
next pack will be thin for the same reason in a week's time.

---

## 1. What this pack is, and what it is not

⚠️ **This is a 5-minute SAMPLE, not a census — and a census is currently
impossible.**

`apps/audiobook-worker/src/gate-shadow.ts` states its own read path in its
module header:

> *"`wrangler tail | grep ab_gate_shadow` is the whole read path; nothing is
> stored in D1 or Firestore."*

Verified against the config: **no `[observability]`, `analytics_engine`, `d1`,
`kv`, or `logpush` binding exists in `apps/audiobook-worker/wrangler.toml` —
nor in any sibling worker's.** A shadow decision therefore exists only as a
line on an attached tail, and is **unrecoverable once emitted**.

**Consequence:** the ~4 hours of soak that elapsed before this pack began are
gone. They cannot be recounted, re-read, or audited later — by me, by a future
session, or by the owner. This is the single most actionable finding here, and
§7.1 is the one-line fix.

---

## 2. Timeline — how long has this actually soaked?

All times **MST (-0700)**, the account's local zone (`America/Phoenix`).

| When | Event | Source |
|---|---|---|
| 2026-08-16 18:33:56 | Phase 0 scaffold + shadow receiver committed | `511fd69` |
| 2026-08-16 18:37:48 | Worker first deploy; route live at `audiobook-api.heygabi.ai` | `148ca2b` |
| 2026-08-16 18:54:00 | Client reporter `site/gate-shadow.js` committed | `391d2c8` (audiobook_catalog) |
| 2026-08-16 18:59:06 | Phase 2 — UI gates answer from `/api/me` | `ade37bf` |
| 2026-08-16 19:04:55 | **`ESTATE_CHECK` off → shadow committed** | `d8e599f` |
| 2026-08-16 **19:05:07** | **Worker deployment carrying the flip — server-side soak starts** | `wrangler deployments list` (`02:05:07Z`) |
| 2026-08-16 19:40:41 | Later worker deployment — the version serving now (`cdd7e279`) | `wrangler deployments list` (`02:40:41Z`) |
| 2026-08-16 21:26:58 | `Promote to Prod` workflow run | `gh run list` (`04:26:58Z`) |
| 2026-08-16 **~21:29:46** | `Deploy site` finishes — **prod-lane reporter live** | `gh run list` (`04:27:29Z` + 2m17s) |
| 2026-08-16 23:16:56–23:21:56 | **This pack's tail sample (5m 00s)** | below |

### Soak duration as of 2026-08-16 23:21:56 MST

| Window | Duration | Meaning |
|---|---|---|
| Server in `shadow` | **4h 16m 49s** | the receiver would have logged, had anything reported |
| **Prod-lane client reporter live** | **1h 52m 10s** | ⚠️ **the number that matters** — until this, prod visitors sent nothing |
| Dev-lane client reporter live | ~4h (not precisely dated) | see §8 |

⚠️ **The prod soak is under two hours.** The 4-hour figure is the *server's*
readiness, not the period during which prod users could actually be measured.
Quoting the larger number would overstate the evidence by more than 2×.

---

## 3. The sample — what was actually observed

**Method:** `npx wrangler tail --format json` from `apps/audiobook-worker`,
run for a bounded 5 minutes, clean exit (code 0), no stderr, no dropped-log
warnings.

**Window:** 2026-08-16 23:16:56 → 23:21:56 MST (exactly 5m 00s).

| Metric | Count |
|---|---|
| Worker invocations captured | **3** |
| — of which **organic (household or public)** | **0** |
| — of which **my own probes** | **3** |
| `ab_gate_shadow` decision lines | **2** (both synthetic) |
| `ab_gate_shadow_shed` rate-limit lines | **0** |
| Worker exceptions | **0** |
| Invocation outcomes | 3 × `ok` |

### 3.1 The two decision lines (BOTH SYNTHETIC — mine, not household traffic)

⚠️ Labelled explicitly so no future reader mistakes these for real actors.
Both were generated by me from this machine (PowerShell UA, `cf-colo: PHX`)
to prove the read path works end to end.

```json
{"tag":"ab_gate_shadow","action":"club.setSchedule","lane":"prod",
 "club":"soak-probe","tokened":false,"email":null,"ladder_role":null,
 "estate":null,"club_manager":false,"would_deny":true,
 "reason":"no_live_session"}

{"tag":"ab_gate_shadow","action":null,"lane":"prod","club":null,
 "tokened":false,"email":null,"ladder_role":null,"estate":null,
 "club_manager":false,"would_deny":null,"reason":"malformed_report"}
```

**What these DO establish** (a real, if narrow, positive result):

- The receiver is **live and in shadow** — `/api/health` answers
  `{"ok":true,"service":"audiobook-worker","estate_check":"shadow"}`.
- **Iron rule 1 holds:** both probes got **204**, including the garbage body.
- **Iron rule 2 holds:** the malformed report still produced a line
  (`would_deny:null`, `malformed_report`) rather than vanishing.
- The **tail read path works** — a report reaches the tail as a parseable line.

**What they do NOT establish:** anything whatsoever about household members.

### 3.2 would_deny by route/action

| Action | Decisions | would_deny true | false | null |
|---|---|---|---|---|
| `club.setSchedule` | 1 *(synthetic)* | 1 | 0 | 0 |
| *(malformed — no action)* | 1 *(synthetic)* | 0 | 0 | 1 |
| **All other 22 instrumented actions** | **0** | — | — | — |
| **ORGANIC TOTAL** | **0** | **0** | **0** | **0** |

### 3.3 would_deny by identity CLASS

Per the brief, identities are reported as **classes and row counts only**. No
non-owner email appears in this document. (The worker's log line *does* carry
`email` in cleartext — noted in §7.4 as a privacy point for the owner.)

| Identity class | Decisions observed | would_deny true |
|---|---|---|
| **Owner accounts** (`OWNER_EMAILS`) | **0** | 0 |
| **Household members** (estate `approved`, non-owner) | **0** | **0 — of 0. UNMEASURED, not clean.** |
| **Anonymous / tokenless** | 2 *(both mine)* | 1 |

⚠️ **The household row is the whole decision, and it is empty.** The bar is
*"measured zero false denials for household members."* A denominator of zero
does not clear a bar; it means the instrument was never pointed at the subject.

### 3.4 Malformed / unparseable lines

| Category | Count | Assessment |
|---|---|---|
| `malformed_report` | 1 | **Synthetic** — my deliberate garbage-body probe. Correct behaviour, not a gap. |
| `unknown_action` | 0 | No client typos — corroborated statically in §5 (no client action is unknown to the server). |
| Unparseable tail output | 0 | All 314 captured lines parsed cleanly. |
| `role_unresolved` / `service_account_*` | 0 | ⚠️ **Untested.** No tokened report ran, so the service-account path in `processReport()` was never exercised — see §8. |

---

## 4. The zero-false-denial check

**Question:** would any household member have been denied anything?

**Answer: UNKNOWN. Not "no".** Zero household decisions were observed, so the
question has not been asked of the live system even once.

With no empirical data, the honest substitute is a **static** read of the
capability matrix (`apps/audiobook-worker/src/capabilities.ts` +
`ACTION_GATES`). This is **reasoning, not measurement** — flagged as such, and
it is expressly *not* a substitute for the soak. It is here to tell the owner
**which surfaces to deliberately exercise** during the real soak.

### 4.1 Capability floors

`guest < member < contributor < moderator < admin < owner`

| Capability | Floor | Club manager may hold? |
|---|---|---|
| `read`, `rate` | guest | — |
| `download` | member | — |
| `upload` | contributor | — |
| `operateClub` | **moderator** | ✅ yes |
| `manageClub` | **admin** | ✅ yes |
| `administerClub` | **admin** | ❌ **no** |
| `removeAnyReview` | **admin** | ❌ no |

### 4.2 ⚠️ Predicted false-denial risks — exercise these first

| Risk | Actions | Why a household member could be denied |
|---|---|---|
| 🔴 **HIGH — and INVISIBLE to the current shadow** | `warning.modDelete` | **Not instrumented (§5).** Today `deleteUserWarning()` is an *author self-delete* guarded only by a client-side name check, with `firestore.rules` set to `allow delete: if true`. If enforce routes this surface through `warning.modDelete` (floor **moderator**, club island **off**), **every ordinary member deleting their own warning is denied.** |
| 🟠 **MEDIUM — bootstrap trap** | `club.claimManager` | Floor **admin**, club island **off**. This is the action by which someone *becomes* a manager. Requiring admin means a non-admin member can never claim an unclaimed club — the capability is self-blocking. |
| 🟠 **MEDIUM** | `club.setWebhook`, `club.clearWebhook` | Floor **admin**, club island **off** (the deliberate 2026-08-16 tightening). A club's own manager who is not ladder-admin **loses** webhook control they hold today. Intentional — but it *will* register as a denial, and the owner should confirm no household manager relies on it. |
| 🟢 **LOW — matches today** | `review.delete` | Floor admin, no island — but `deleteReview()` is *already* admin-only and rules-enforced (three-tier model, 2026-08-14). Gate and reality agree. |
| 🟢 **LOW** | all `operateClub` / `manageClub` club actions | Club island is **on**, so a club's manager holds these regardless of ladder rank. |

⚠️ **The 🔴 row is the important one.** It is both the most likely false denial
*and* the one the shadow, as currently wired, is structurally incapable of
detecting. A soak that runs another week and reports "zero would-deny lines"
would still be blind to it.

---

## 5. Instrumentation gaps — 2 of 25 gated actions send nothing

Measured by diffing the server's `ACTION_GATES` vocabulary against every
`reportGate()` call site in `audiobook_catalog/site/*.js`.

| | Count |
|---|---|
| Actions the **server** gates (`ACTION_GATES`) | **25** |
| Actions the **client** can send | **23** |
| **In server, never sent by client** | **2** |
| Sent by client but unknown to server | **0** ✅ |

### The two gaps

| Action | Gate | Live surface that is NOT instrumented |
|---|---|---|
| `warning.modDelete` | `operateClub` (moderator), island **off** | `site/user-warnings.js:93` `deleteUserWarning()` — ⚠️ the module **does not import `gate-shadow.js` at all** (0 references). |
| `read.setSlot` | `manageClub` (admin), island **on** | `site/club-reads.js:608` `updateReadLabel()` — no `reportGate()` call, though its sibling `read.remove`/`read.finish` paths have one. |

**Why this is evidence, not noise:** these two surfaces will produce **zero
would-deny lines no matter how long the soak runs**, because nothing reports
them. Their silence is indistinguishable from a clean result, which is the
exact trap §4's rule warns about.

⚠️ **Naming ambiguity worth an owner decision:** `warning.modDelete` reads like
a *moderator* sweep, but the only live delete path is an *author self-delete*.
Either (a) the mod-sweep surface does not exist yet and the gate is
speculative, or (b) enforce will apply a moderator floor to a self-delete and
break ordinary members. **Which one is true changes the risk from 🟢 to 🔴**,
and the shadow cannot tell you. This needs deciding before enforce, not after.

---

## 6. ⚠️ A limitation in the telemetry itself

**`reportGate()` is called from a `finally` block at every site verified**
(`club-reads.js:316,1468`, `clubs.js:825`, `reviews.js:82,103`, …).

It therefore fires **whether the underlying Firestore write succeeded or
failed**, and the payload (`action`, `lane`, `clubId`, `token`) carries **no
outcome field**. The logged line has no `success` key.

The flip criterion asks for:

> *"`would_deny:true` lines — requests that **succeeded today** but the gate
> would refuse."*

**The tail cannot answer that**, because it cannot separate:

| Case | Meaning | Is it a blocker? |
|---|---|---|
| Write **succeeded**, `would_deny:true` | ⚠️ **A true regression** — enforce breaks something that works today | **YES** |
| Write **already failed** (e.g. `PERMISSION_DENIED` from rules), `would_deny:true` | The gate simply **agrees** with today's rules | **No** |

Both emit a byte-identical line. On a surface already locked down by
`firestore.rules` (`review.delete` is exactly this), every legitimate refusal
will look like a would-deny — **manufacturing false alarms**. Conversely, a
genuine regression is buried among them.

⚠️ **This means the criterion is currently unfalsifiable in either direction.**
§7.1 fixes it with one extra boolean.

---

## 7. What must change before the re-run

### 7.1 🔴 Make the soak measurable (do these two first)

1. **Enable Workers Logs so decisions persist.** Add to
   `apps/audiobook-worker/wrangler.toml` and redeploy:
   ```toml
   [observability]
   enabled = true
   ```
   Without this, **every future pack is also a 5-minute sample**, and the
   week between now and the re-run is again unrecoverable. Retention (3 vs 7
   days by plan) is **not verified** — confirm before relying on a 7-day
   lookback.

2. **Add the outcome bit** (fixes §6). One field in the client payload —
   `"succeeded": true|false` — and one field in the logged line. Without it
   the flip criterion cannot be evaluated even with perfect data.

⚠️ Both are **code/config changes and therefore out of scope for this
read-only pack.** Nothing was flipped, deployed, or edited outside this
report and its index lines.

### 7.2 🟠 Close the instrumentation gaps (§5)

Wire `reportGate()` into `updateReadLabel()` and `deleteUserWarning()` — **and
first decide what `warning.modDelete` is actually meant to gate.**

### 7.3 🟠 Exercise the surfaces deliberately

Absence of lines is only evidence when the action demonstrably ran. Before the
next pack, each of these should run **at least once** with `estate:"approved"`
from a fresh source:

- an **owner** account — any club action;
- a **household member who is a club manager but not ladder-admin** — the
  single highest-value actor, since they exercise the 🟠 rows in §4.2;
- a **site moderator** — an `operateClub` action;
- an **ordinary member** — `review.submit`, and a content-warning self-delete
  (once instrumented — this probes the 🔴 row);
- the `administerClub` trio: `club.setWebhook`, `club.clearWebhook`,
  `club.claimManager`.

### 7.4 🟢 Privacy note for the owner

The shadow log line carries **`email` in cleartext** to the tail
(`gate-shadow.ts` line ~297). That is fine for an ephemeral tail; it becomes a
**retained** record the moment §7.1's `[observability]` is enabled. Consider
hashing or truncating the local part before turning retention on. No
non-owner email appears in this report.

---

## 8. ⚠️ What was NOT verified

Stated plainly, per the verification-culture rule.

| Not verified | Why | How to close it |
|---|---|---|
| **Any organic gate decision, by anyone** | None occurred in the sample window | Longer soak + §7.3 |
| **Whether household members would be denied** | Denominator is **zero** | The re-run |
| **The ~4h of soak before 23:16:56** | ⚠️ **Permanently unrecoverable** — nothing is stored (§1) | Impossible retroactively; §7.1 prevents recurrence |
| **Estate membership census** (how many approved members / their visibility) | ⚠️ `wrangler d1 execute estate_auth --remote` was **blocked by the permission classifier** | Owner runs the query, or adds a Bash permission rule |
| **Exact dev-lane reporter deploy time** | Not resolvable from the `gh run list` window fetched | `gh run list --workflow` with a wider window |
| **Whether Workers Logs is enabled account-side** | Inferred from the **absence** of `[observability]` in the toml — the account-level setting was not read | Cloudflare dashboard → Worker → Logs |
| **Workers Logs retention (3 vs 7 days)** | Plan-dependent; plan not checked | Dashboard |
| **The service-account / role-resolution path** | No **tokened** report ran, so `cachedStoredRole()`, `estateStatusFor()`, `isClubManager()` and the `role_unresolved` branch were **never exercised live** | One authenticated action during the re-run |
| **The rate limiter** (240/min) | Never approached — 2 reports total | Not worth forcing |
| **That `firestore.rules` matches the capability map** | Out of scope; read only for `user_content_warnings` | Separate audit |
| **Session/weekly usage figures** | Not readable from this subagent's context | Parent session reads `claude.ai/settings/usage` |

Also noted, **not fixed** (outside my file scope): `docs/info/README.md` has
**no index rows** for `audiobook-auth-migration.md`, `audiobook-edit-design.md`,
`sso-design.md`, `discord-bot-design.md`, `ebook-split-design.md`,
`friend-ingest-design.md`, or `covers-consolidation-plan.md`. The index is
stale by seven documents; I added only my own row.

---

## 9. Re-run instructions — the next pack in one command

```bash
# 1. Confirm the mode is still shadow (must print estate_check:"shadow")
curl -s https://audiobook-api.heygabi.ai/api/health

# 2. Capture. Bounded; raise the sleep for a longer window.
cd apps/audiobook-worker
npx wrangler tail --format json > /tmp/ab_tail.jsonl 2>/tmp/ab_tail.err &
TAILPID=$!; sleep 900; kill $TAILPID

# 3. Extract every decision line
grep -o '{\\"tag\\":\\"ab_gate_shadow[^"]*' /tmp/ab_tail.jsonl

# 4. Headline counts
grep -c 'ab_gate_shadow'      /tmp/ab_tail.jsonl   # decisions
grep -c 'ab_gate_shadow_shed' /tmp/ab_tail.jsonl   # rate-limit sheds
grep -c '\\"would_deny\\":true' /tmp/ab_tail.jsonl # the gate number
```

⚠️ **`wrangler tail` shows only what arrives WHILE ATTACHED.** It is not a
lookback. Until §7.1 lands, a pack can only ever cover its own attached
window — plan the window around when the household is actually using the site,
not around when the report is being written.

**Once `[observability]` is enabled**, replace steps 2–4 with a dashboard log
query (Worker → Logs → filter `ab_gate_shadow`), which *is* retrospective and
turns the next pack into a genuine census.

### The bar, restated

> Days of soak with **zero `would_deny:true` for household members** and
> **zero `tokened:false`**, while **both club-manager and site-moderator
> actors have exercised the surface at least once** with `estate:"approved"`
> from a fresh source.

**Current status: 0 of 3 clauses satisfiable** — no days, no household
decisions, no actors exercised. Re-run once §7.1–7.3 land and the household has
used the site across several ordinary days.

---

## Related

- [`audiobook-auth-migration.md`](audiobook-auth-migration.md) — §4 shadow
  design, §5 phased plan, the flip criterion
- [`estate-auth-design.md`](estate-auth-design.md) — estate membership
- [`role-ladder.md`](role-ladder.md) — the ladder and grant rules
- `apps/audiobook-worker/src/gate-shadow.ts` — the receiver + `ACTION_GATES`
- `apps/audiobook-worker/src/capabilities.ts` — the capability matrix
- `audiobook_catalog/site/gate-shadow.js` — the client reporter
