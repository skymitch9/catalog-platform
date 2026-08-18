# The worker event ring — Information Reference

> **Audience:** Claude sessions and whoever wires the next Worker.
> **Status:** TRACKED. Last verified: **2026-08-18** — the doors below were
> exercised against the live host and the rows read back out of D1, not
> transcribed from a design note.

Owner, 2026-08-18, on clicking into a health check and meeting the *"Not wired
up yet"* placeholder: **"fix this."**

| | |
|---|---|
| **Write** | `POST https://auth.heygabi.ai/api/estate/ops/worker-events` — `Authorization: Bearer <token>` |
| **Read** | `GET` same path — `requireDevops()`, a signed-in person in a browser |
| **Store** | `worker_events` in `estate_auth` D1 (migration 0015), capped **per worker** |
| **Helper** | [`@platform/estate-events`](../../packages/estate-events/src/index.ts) — the one client |
| **Renders on** | [/status](https://heygabi.ai/status/) → *Recent worker events* |

## 1. What it is FOR, and what it is not

⚠️ **It is a noticeboard, not a log.** Workers already log to Cloudflare and
`wrangler tail` already shows a live stream. This exists for the one thing
neither can do: put the handful of events that MATTER in front of someone
looking at a red row on /status, **after the fact**, with no Cloudflare token in
a browser.

⚠️ **That distinction is a design constraint, not a caveat.** If Workers write
everything here it becomes an expensive, capped, worse copy of Workers Logs —
and because the ring evicts oldest-first, the row that mattered is the one that
goes. Write **errors, refusals worth a human's attention, and deploy markers**.
Not requests, not cache misses, not "ok".

## 2. The rule the renderer must never break

⚠️ **AN EMPTY LIST IS NOT "NO ERRORS".** The placeholder this replaced refused
to show an empty box for exactly that reason, and the reason did not disappear
when the ring shipped — it moved. So the GET **always** answers `since`, and the
page renders one of three sentences, never a blank:

| State | What the page says |
|---|---|
| rows exist | them, newest first, each with its own clock |
| ring empty, `since` set | *"No events recorded since &lt;date&gt; … that is not the same as no errors"* |
| ring never written | *"The ring is live and no Worker has written to it yet … a Worker that has not been wired up cannot report at all"* |

## 3. Two clocks, kept apart

`at` is when the **Worker** says it happened; `received_at` is when this estate
actually heard. They differ when a report is delayed, and the page shows the
second only when they disagree by more than a minute. Collapsing them would hide
exactly the case worth seeing. Same discipline as the agent board's `pushed_at`
versus its per-section stamps.

⚠️ A missing or unreadable `at` falls back to the server's clock rather than
being refused — losing an event because a writer's clock is broken is the worse
trade, and `received_at` records the truth either way.

## 4. Why an HTTP door and not a service binding

A service binding would be tidier: no token, no network hop, nothing to rotate.
It was **rejected** for one reason that outweighs those:

⚠️ **Service bindings only bind Workers in the same account AND require every
writer's `wrangler.toml` to name this Worker.** That makes adopting the ring a
config-plus-deploy change in repos this one does not own — `library_catalog` and
`Board_Game_Catalog` are separate repos on their own cycles. A bearer makes
adoption a **code-only change** in the writer's repo.

⚠️ **AND THE TOKEN IS NOT `ESTATE_CONDUCTOR_TOKEN` — MEASURED, NOT ASSUMED.**
The plan said "a token the workers already hold". They do not: `wrangler secret
list` on 2026-08-18 showed `index-worker` holding only its three
`INDEX_PUSH_TOKEN_*` and `audiobook-worker` only `ESTATE_APP_TOKEN_BOOKS` +
`FIREBASE_SERVICE_ACCOUNT`. So adopting the ring needs a secret either way, and
that makes the choice a real one:

**Mint a dedicated `ESTATE_EVENTS_TOKEN` rather than spreading the conductor
token.** The conductor token can also rewrite the agent board — the estate's
whole picture of what is running. An events token's entire power is *writing
lines to a noticeboard the owner reads*. Putting the larger credential on three
more Workers to save minting one is the wrong trade, and it is the kind of quiet
scope creep the estate's access rules exist to stop.

⚠️ The auth Worker itself is the **one writer that needs no credential**: the
ring lives in the D1 it already binds, so it writes directly (`recordOwnEvent`)
with no token and no subrequest.

## 5. Wiring a Worker — the whole recipe

Adoption is one commit in the writer's repo plus one secret:

```bash
# 1. once, per writer (value from the estate's custody file)
cd apps/<worker> && cmd /c "npx wrangler secret put ESTATE_EVENTS_TOKEN < <path-to-token>"
```

```ts
// 2. in the Worker
import { reportEvent } from '@platform/estate-events';

reportEvent(c.executionCtx, {
  endpoint: c.env.ESTATE_AUTH_URL ?? 'https://auth.heygabi.ai',
  token: c.env.ESTATE_EVENTS_TOKEN,
  worker: 'catalog-index',
  level: 'error',
  message: 'push rejected: unknown source',
  route: new URL(c.req.url).pathname,
  detail: String(err),
});
```

The helper **never throws, never blocks the response** (it rides `waitUntil`),
and **does nothing at all when the token is unset** — so a Worker can ship the
code before the secret exists and behave exactly as before. That is the estate's
standing "ships dark until configured" idiom.

## 6. Status of each writer — 2026-08-18

| Worker | State | Note |
|---|---|---|
| `estate-auth` | ✅ **wired** | every unhandled error, direct to D1, no token needed |
| `catalog-index` | ⏳ not wired | needs `ESTATE_EVENTS_TOKEN`; helper import is a ~5-line change |
| `audiobook-worker` | ⏳ not wired | same |
| `discord-worker` | ⏳ **not wired, deliberately untouched** | ⚠️ another agent's working tree on 2026-08-18. The contract above is the whole brief; it is a one-commit follow-up for whoever owns that tree next, and reaching into it mid-flight is how two agents end up editing one file. |
| `library-catalog`, `board-game-catalog` | ⏳ other repos | code-only change once the secret is set — that is the point of §4 |

⚠️ **The estate-auth writer is the highest-value one and it is already live**,
which is why the section is not empty on day one: every unhandled error in the
Worker that fronts sign-in, roles, backups and the agent board now lands where
the owner can see it, instead of only in a log nobody is tailing at 3am.
