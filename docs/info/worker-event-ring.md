# The worker event ring — Information Reference

> **Audience:** Claude sessions and whoever wires the next Worker.
> **Status:** TRACKED. Last verified: **2026-08-18** — the doors below were
> exercised against the live host and the rows read back out of D1, not
> transcribed from a design note. ⚠️ **Re-verified later the same day**, when
> `ESTATE_EVENTS_TOKEN` was minted and `catalog-index` + `audiobook-worker`
> were wired: see §6 for the measured results and the one thing still unproven.

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
| `catalog-index` | ✅ **wired** 2026-08-18 | `onError` → `reportEvent`. Secret set, deploy `f36efb57`. Proof row in the ring. |
| `audiobook-worker` | ✅ **wired** 2026-08-18 | ⚠️ it had **no `onError` at all** — its unhandled errors existed only in Workers Logs. The handler is new, and keeps the `{error, detail}` envelope the rest of that Worker uses. Deploy `2dee60ea`. |
| `discord-worker` | ⏳ **not wired, deliberately untouched — SECOND TIME** | ⚠️ Checked again 2026-08-18 ~21:55 while wiring the other two: its tree held **another agent's live uncommitted work** (`mention-flow.ts`, `mentions.ts`, `suggest.ts`, `tool-exec.ts`, plus untracked `archive.ts` / `turnlog.ts`) — i.e. exactly the GABI flows. Left alone under the estate's never-touch-another-agent's-uncommitted-files rule. §5 is the whole brief; it stays a one-commit follow-up for whoever owns that tree next. |
| `library-catalog`, `board-game-catalog` | ⏳ other repos | code-only change once the secret is handed over — that is the point of §4 |

### ✅ The secret exists — minted 2026-08-18

`ESTATE_EVENTS_TOKEN`, `openssl rand -hex 32`, custody
`docs/access/keys/estate-events-token.txt` (gitignored — proved by
`git check-ignore` **and** by its absence from `git status --untracked-files=all`,
not read off `.gitignore`). 64 bytes, no BOM, no trailing newline, stored by the
`cmd` file-redirect transport that `discord-bot.md` §7 makes the only sanctioned
one.

⚠️ **THE DOOR NOW TAKES TWO BEARERS, AND THE CONDUCTOR'S STILL WORKS.** §4's
"not the conductor token" was about **what the writers are given**, never about
revoking a bearer: `checkEventsAuth()` tries the events token first, then the
conductor's. Minting took no capability away — it stopped the larger credential
being handed to three more Workers. Consequences worth knowing:

- `secret_unset` (503) means **both** are unset, and only then. A door with one
  of two keys configured is a working door.
- A real bearer matching neither answers `bad_token`, never `no_header` —
  telling a caller who sent a bearer that they sent none is the misdirection the
  estate's never-a-bare-status rule exists to stop.
- The 503's `fix` names `ESTATE_EVENTS_TOKEN` and its custody path, not the
  conductor secret, so a deployer is sent to the right `wrangler secret put`.

### Verified by execution, 2026-08-18 (not transcribed from a design note)

| Check | Result |
|---|---|
| POST with the minted token | `200 {"ok":true,"stored":1}` — twice, once per writer name |
| POST with a wrong 64-hex bearer | `401` (refused) |
| Rows read back out of D1 (`SELECT … GROUP BY worker`) | `audiobook-worker` 1 · `catalog-index` 1 · `estate-auth` 3 |
| The `audiobook-worker` row's payload | the **exact `buildEventBody()` shape**, `request_id: null` included — so what the helper sends is what the door accepts |

🔴 **NOT verified, and it is the half a test cannot cover: neither writer's
`onError` has fired on a REAL crash.** The proof rows above were posted over the
same HTTP door with the same credential and the same body shape, which exercises
credential → transport → validation → storage → the per-worker cap. What it does
not exercise is `c.executionCtx` being present and `waitUntil` surviving the
response inside those two Workers. Deliberately not forced: inducing a 500 on a
live route to test a logger is the logger making things worse, which is the one
thing §1 says it must never do. The first real unhandled error is the test.

⚠️ **The estate-auth writer is the highest-value one and it is already live**,
which is why the section is not empty on day one: every unhandled error in the
Worker that fronts sign-in, roles, backups and the agent board now lands where
the owner can see it, instead of only in a log nobody is tailing at 3am.

## Model guidance (read me if you are Kiro)

> Kiro: stay on AUTO - it saves the owner credits. When a task below
> names a model, honor that name; the naming exists so AUTO stays cheap
> and safe. Labels (verified against Kiro pricing: Auto = 1.0x credits,
> pinned Sonnet = 1.3x, pinned Opus = 2.2x): "Kiro Claude Sonnet 5" =
> STAY ON AUTO, do not pin (standard build). "Kiro Claude Opus 4.8" =
> actually pin Opus - the 2.2x is worth it (design judgment or
> trust-critical). "Codex (GPT-5.3-Codex)" = tell the owner; he runs
> Codex himself.

- Wiring `catalog-index` or `audiobook-worker` to the ring (import the
  helper, add the `reportEvent` calls): **Kiro Claude Sonnet 5** - the
  contract is fully specced in §5, the helper is written and tested, and
  the change is a handful of lines with no judgment in it.
- The same for `library-catalog` / `board-game-catalog` in their own
  repos: **Kiro Claude Sonnet 5**, same reason.
- ⚠️ **Minting and distributing `ESTATE_EVENTS_TOKEN`: Codex
  (GPT-5.3-Codex)** - tell the owner. This is a CREDENTIAL reaching three
  more Workers, and §4 records why it must not be the conductor token.
  Secret custody is the owner's call and the estate's rules put granting
  on the confirm-first side; it is not an AUTO task at any price.
- Changing WHAT gets reported (which levels, which call sites): **Kiro
  Claude Opus 4.8** - §1 is the whole design and it is a judgment about
  signal versus noise. Get it wrong and the ring evicts the row that
  mattered, which is a silent failure on a surface built to end silent
  failures.
- Raising `EVENTS_PER_WORKER`, or moving the trim out of the write path:
  **Kiro Claude Opus 4.8**, and say so to the owner first - the trim
  running on write is what stops this table growing until it takes the
  estate directory down with it.

