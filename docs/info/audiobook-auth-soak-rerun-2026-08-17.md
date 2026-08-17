# Audiobook estate-auth SOAK — the RECORDER, and how to run the next pack — Information Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-17** (worker version
> `8cdf7c88-50c5-4895-b13d-3cb2f7d35198`; observability read back from the
> LIVE Worker's settings, not from the toml).

**What this is:** the dated addendum to
[`audiobook-auth-soak-2026-08-16.md`](audiobook-auth-soak-2026-08-16.md).
That pack is an **evidence record** and is not edited — its findings stand as
written. This file supersedes exactly one part of it: **§9, the re-run
instructions.** §9 told you to attach a 5-minute tail, because in the world
that pack measured, a tail was the only read path there was. That is no
longer true, and following §9 now would throw away the retention this build
exists to provide.

⚠️ **Nothing here flips anything.** `ESTATE_CHECK` is `"shadow"` and was not
touched by this build (confirmed live: `/api/health` answers
`estate_check:"shadow"`). This build **records**; it does not enforce.

---

## 1. What changed on 2026-08-17 — the three fixes the pack named

| Pack blocker | Fix | Where |
|---|---|---|
| 1 — shadow is tail-only and unrecoverable | `[observability] enabled = true` | `apps/audiobook-worker/wrangler.toml` |
| §7.4 — the log line carried an **email in cleartext** (the precondition on blocker 1) | `email_hash` + `identity_class` replace `email`, on BOTH gate lines | `apps/audiobook-worker/src/pseudonym.ts`, `gate-shadow.ts`, `enforce-gate.ts` |
| 4 — the criterion is unfalsifiable without an outcome | `succeeded` in the payload, parsed and logged | `audiobook_catalog/site/gate-shadow.js` + 24 call sites; `gate-shadow.ts` |
| 3 — `read.setSlot` sends nothing | `updateReadLabel()` reports it | `audiobook_catalog/site/club-reads.js` |

**25 of 25 gated actions now report.** The vocabulary gap is closed.

### 1.1 The log line, as of 2026-08-17

```json
{"tag":"ab_gate_shadow","action":"read.setSlot","lane":"prod",
 "club":"soak-probe-0817","tokened":false,
 "email_hash":null,"identity_class":"anonymous",
 "ladder_role":null,"estate":null,
 "club_manager":false,"club_claimed":false,
 "succeeded":true,"would_deny":true,"reason":"no_live_session"}
```

Three fields are new and one is gone.

- **`email` is GONE.** A test asserts the serialised line contains no `@` at
  all, so an edit that puts an address back fails the suite rather than
  quietly retaining it.
- **`email_hash`** — salted SHA-256, first 16 hex chars, `null` when there
  was no verified identity (never a fake hash: "how many distinct people"
  must not count noise as people). Stable per person across invocations, so
  counting and per-user grouping still work.
- **`identity_class`** — `anonymous` | `owner` | `household` | `outside`.
  This is the field the flip criterion actually needs: its bar is about
  **household members**, and an owner row must stay distinguishable from one.
- **`succeeded`** — `true` | `false` | `null`. ⚠️ **`null` is a real third
  state**, meaning *this report cannot say* (an older client build still
  cached in someone's browser, or a malformed body). It is never collapsed
  into `false` at either end.

### 1.2 The salt — one-way, and what that does and does not buy

`IDENTITY_SALT` in `src/pseudonym.ts` is a **hardcoded, non-secret
domain-separation constant**. The full argument is in that file's module doc;
the short version:

- The hash is **one-way** — nothing inverts it back to an address.
- An email is **low-entropy**, so anyone holding the salt can hash a
  *guessed* address and check whether it appears. A secret salt would close
  that; we did not take it, because the threat this addresses is
  **accidental disclosure through a retained log**, not an adversary who
  already has the source and a candidate list. This is pseudonymisation, not
  authentication.
- The salt's real job is **domain separation**: the same address hashes
  differently here than anywhere else, so two log corpora can never be joined
  on it.
- **The lever, if the owner ever wants more:** `wrangler secret put
  GATE_HASH_SALT`. ⚠️ Changing it **re-pseudonymises everyone** — a soak
  window must never span a salt change, and any pack that does must say which
  generation it counted.

---

## 2. ⚠️ Retention: what is PROVEN and what is NOT

Per the verification-culture rule, stated plainly rather than implied.

| Claim | Status |
|---|---|
| The Worker is deployed carrying all three fixes | ✅ **Measured** — version `8cdf7c88-50c5-4895-b13d-3cb2f7d35198`, `/api/health` → `{"ok":true,...,"estate_check":"shadow"}` |
| Observability is enabled **on the live Worker**, not just in the toml | ✅ **Measured** — `GET /accounts/{acct}/workers/scripts/audiobook-worker/settings` returns `observability.logs = {enabled:true, persist:true, head_sampling_rate:1, invocation_logs:true}` |
| Reports round-trip and produce lines | ✅ **Measured** — three synthetic POSTs, all `204` (including a garbage body — iron rule 1 holds) |
| ⚠️ **A retained line READ BACK out of Workers Logs** | ✅ **MEASURED — this is the whole point, so it was proven, not assumed.** See §2.1 |
| The retained line carries `succeeded` | ✅ **Measured** — `true` and `false` both round-tripped |
| The retained line carries **no address** | ✅ **Measured** — no `email` key, and no `@` anywhere in any retained gate line |
| Retention **length** (3 days free / 7 paid) | ⚠️ **NOT VERIFIED** — plan-dependent; check the dashboard before relying on a 7-day lookback |
| Any **organic** (household) decision | ⚠️ **Still zero.** The instrument was repaired; nobody has used it yet. The 2026-08-16 verdict is unchanged |

### 2.1 ✅ PROOF OF RETENTION — the actual retained lines

Three synthetic reports were POSTed at **16:13:41–42 UTC** and queried back
**~5 minutes later**, retrospectively, from a window that had already closed.
A tail could not have done this; that is the difference this build bought.

```json
{"tag":"ab_gate_shadow","action":"read.setSlot","lane":"prod",
 "club":"soak-probe-0817","tokened":false,"identity_class":"anonymous",
 "club_manager":false,"club_claimed":false,
 "succeeded":true,"would_deny":true,"reason":"no_live_session"}

{"tag":"ab_gate_shadow","action":"review.delete","lane":"prod",
 "tokened":false,"identity_class":"anonymous",
 "club_manager":false,"club_claimed":false,
 "succeeded":false,"would_deny":true,"reason":"no_live_session"}

{"tag":"ab_gate_shadow","lane":"prod","tokened":false,
 "identity_class":"anonymous","club_manager":false,"club_claimed":false,
 "reason":"malformed_report"}
```

All three carry `$workers.scriptVersion.id =
8cdf7c88-50c5-4895-b13d-3cb2f7d35198`. Asserted against the retained records:
`'email' in line` → **false** for every line; `JSON.stringify(line)` contains
`'@'` → **false** for every line.

⚠️ **THE GOTCHA THAT WILL MISLEAD THE NEXT PACK: Workers Logs DROPS
null-valued keys.** `email_hash`, `ladder_role`, `estate` and `succeeded` were
all emitted as `null` on these tokenless probes and are simply **ABSENT** from
the stored object — see the third line, which has no `succeeded` key at all.

**So, when counting: absent means null.** It does *not* mean an old client
build, a parse failure, or a dropped line. `succeeded` absent and `succeeded`
null are the same statement — *this report cannot say* — which is exactly the
third state both ends were built to preserve, so the counting rule is
unaffected. But a query written as "where succeeded = false" will silently
miss nothing, while one written as "where succeeded != true" will sweep in
every unknown. Say which you used.

### 2.2 ⚠️ Auth: the hour this note saves you

**The Workers Observability query API REFUSES wrangler's OAuth token.**

Measured 2026-08-17: the same OAuth token that happily answers
`GET /accounts/{acct}/workers/scripts` returns

```json
{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}
```

for `POST https://api.cloudflare.com/.../observability/telemetry/query`.
`wrangler login`'s scope list has `workers_tail (read)` but nothing for
observability, and **wrangler 4.123.0 has no `observability` / `logs`
subcommand at all** — `wrangler tail` is still the only log command it ships.

**Three paths, in order of cost:**

1. ✅ **The dashboard's own API, with the dashboard's session cookie** — what
   actually produced §2.1, and it needs no credential work at all. From a
   logged-in `dash.cloudflare.com` tab, `fetch('/api/v4/accounts/{acct}/…')`
   with `credentials:'include'` authenticates by cookie. Exact call in §3.
2. **The dashboard UI**: Workers & Pages → **audiobook-worker** →
   **Observability** → **Logs**. Direct link:
   `https://dash.cloudflare.com/113be82b840c956b8378a187047ab3ea/workers/services/view/audiobook-worker/production/observability/logs`
3. **A proper API token** with account observability/analytics read — the same
   class of credential as `CLOUDFLARE_API_TOKEN` (in GitHub secrets, not on
   this machine; `access/backup-restore.md` §8 has the pattern and its own
   warning that OAuth and API tokens do NOT cover the same REST endpoints).
   **Not verified** against this endpoint.

**Is there anything for the owner to CLICK?** ⚠️ **No — nothing.** Enablement
is entirely in `wrangler deploy`; the live settings read and the retained
lines above both confirm it. No dashboard toggle, no plan change, no console
step. The only reason to open the dashboard is to *look*.

---

## 3. The next evidence pack — the command

⚠️ **This replaces §9 of the 2026-08-16 pack.** Do not attach a tail and call
it a census; a tail measures only the minutes you happened to be watching,
which is exactly the flaw that made the last pack thin.

```bash
# 0. Confirm the mode is still shadow — it MUST print estate_check:"shadow".
#    (curl in Git Bash: use -o NUL, never -o /dev/null — see the audiobook
#     repo's memory note; /dev/null there gives a bogus exit 43 / status 000.)
curl -s https://audiobook-api.heygabi.ai/api/health

# 1. Confirm retention is actually on for the LIVE worker, not just the toml.
ACCT=113be82b840c956b8378a187047ab3ea
curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCT/workers/scripts/audiobook-worker/settings" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
| python -c "import sys,json; print(json.load(sys.stdin)['result']['observability'])"
# expect: {'enabled': True, ..., 'logs': {'enabled': True, 'persist': True, ...}}


# 2. THE QUERY — see below. It runs in a logged-in dash.cloudflare.com TAB,
#    not in this shell, because that is the auth that works (§2.2).
```

**Step 2, verbatim — this exact snippet produced §2.1.** Open any
`dash.cloudflare.com` tab while signed in and run it in the console:

```js
const acct = '113be82b840c956b8378a187047ab3ea';
const to = Date.now(), from = to - 7 * 86400_000;   // widen to the claim window
const body = {
  queryId: 'ab-soak-rerun',        // ⚠️ REQUIRED — omit it and you get a ZodError 400
  view: 'events',
  limit: 1000,
  timeframe: { from, to },
  parameters: {
    datasets: ['cloudflare-workers'],
    // ⚠️ Filter on the SERVICE, not on the message text. A
    //    `$metadata.message INCLUDES "ab_gate_shadow"` filter returns ZERO —
    //    Workers Logs parses a JSON console.log into STRUCTURED fields, so
    //    there is no raw message string left to substring-match. Measured
    //    2026-08-17; it looks exactly like "no logs retained", and is not.
    filters: [{ key: '$metadata.service', operation: 'eq',
                type: 'string', value: 'audiobook-worker' }],
  },
};
const r = await fetch(
  `/api/v4/accounts/${acct}/workers/observability/telemetry/query`,
  { method: 'POST', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const j = await r.json();

// The parsed JSON line lands in `event.source` — tag, action, succeeded and
// the rest are top-level keys there. Everything else on the event is the
// invocation envelope.
const lines = (j.result?.events?.events || [])
  .filter(e => e.source?.tag === 'ab_gate_shadow')
  .map(e => ({ ts: new Date(e.timestamp).toISOString(), ...e.source }));
console.log(lines.length, lines);
copy(JSON.stringify(lines));   // paste into the pack
```

**Dashboard equivalent** (no console): the Logs view's search box takes
`ab_gate_shadow` and its time picker is the `from`/`to` above.

### 3.1 The counts the pack needs

Once you hold the lines, these are the questions — and the **new** fields are
what make three of them answerable at all:

| Question | How |
|---|---|
| How many organic decisions, at all? | count lines where `identity_class != "anonymous"` **or** the request did not come from a probe |
| ⚠️ **The bar: household false denials** | `would_deny == true` **AND** `identity_class == "household"` **AND `succeeded == true`** |
| Denials the gate merely AGREES with | `would_deny == true` AND `succeeded == false` — **not blockers**, and before 2026-08-17 these were indistinguishable from the row above |
| Reports that cannot say | `succeeded == null` — an older cached client build; if this stays high, the site half has not reached everyone yet |
| Legacy/v1 sessions (measurement #2) | `tokened == false` |
| Distinct actors | distinct `email_hash` (⚠️ only comparable within one salt generation; ⚠️ **absent = null = tokenless**, see §2.1) |
| Surfaces genuinely exercised | distinct `action` — a surface with zero lines has **not soaked**, it was **not run** |

### 3.2 The bar, restated (unchanged from the 2026-08-16 pack)

> Days of soak with **zero `would_deny:true` for household members** and
> **zero `tokened:false`**, while **both club-manager and site-moderator
> actors have exercised the surface at least once** with `estate:"approved"`
> from a fresh source.

⚠️ **Read it with the outcome bit now:** "zero would_deny for household
members" means zero **on writes that SUCCEEDED**. A would_deny on a write
today's `firestore.rules` already refused is the gate agreeing, not a
regression — and counting those as failures was the false-alarm generator the
pack's blocker 4 predicted.

---

## 4. One thing the instrumentation now MAKES VISIBLE — and does not decide

⚠️ **`read.setSlot` is expected to log `would_deny:true` with
`succeeded:true` for ordinary members**, and that is a **real predicted
regression**, not a bug in the telemetry.

The gate carries a `manageClub` (admin) floor. The live surface behind it —
`updateReadLabel()`, renaming a read's card — is **member-editable by
design**: the migration design's own §1 table lists it as staying
browser-direct, and `firestore.rules` deliberately keeps `slotLabel` out of
`MANAGED_READ_FIELDS` ("commentCount bumps and slot labels stay open").

So instrumenting it did not create the problem; it made a pre-existing
mismatch **measurable**, which is the entire justification for closing the
gap. **The owner decision before any flip:** either lower the floor for this
action, or route the label away from `read.setSlot` — see enforce-blocker 3
in [`../TODO.md`](../TODO.md). Do not "fix" it by removing the report.

---

## Related

- [`audiobook-auth-soak-2026-08-16.md`](audiobook-auth-soak-2026-08-16.md) —
  the evidence record this addends; **§9 there is superseded by §3 here**
- [`audiobook-auth-migration.md`](audiobook-auth-migration.md) — §4 shadow
  design, §5 phased plan, the flip criterion
- `apps/audiobook-worker/src/pseudonym.ts` — the hash, the salt argument
- `apps/audiobook-worker/src/gate-shadow.ts` — the receiver + `ACTION_GATES`
- `audiobook_catalog/site/gate-shadow.js` — the client reporter
