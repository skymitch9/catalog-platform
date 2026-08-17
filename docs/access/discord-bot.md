# Discord Bot — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret
> NAMES only, never values).
> Last verified: **2026-08-16 late** — LIVE. The owner registered application
> **GABI** (id `1538775435880562758`) and the Worker is deployed at
> `discord.heygabi.ai` (version `96b315e4`), all four secrets set,
> `/api/health` answering `ok: true` with every `configured` boolean `true`.
> Remaining owner steps at that point: §3 step 5 (Interactions Endpoint URL
> save — the Ed25519 verification moment) and step 6 (server invite).

The estate Discord bot's operational runbook: what exists, the secrets, and
the exact Developer Portal steps **only the owner can perform** — the bot is
not live, and cannot be, until they happen. Design and option space:
[`../info/discord-bot-design.md`](../info/discord-bot-design.md); bot
mechanics research: `audiobook_catalog/docs/info/discord-poll-sync-research.md`.

---

## 1. What exists / what does not (2026-08-16)

| Piece | State |
|---|---|
| `apps/discord-worker/` — interactions endpoint (Ed25519 verify, PING→PONG, router) + two-way poll voting | **Built, tested (34), NOT deployed** |
| Discord application / bot user | **Does not exist** — owner creates it (§3) |
| Secrets | **None set** — names in §2 |
| Route `discord.heygabi.ai` | **Not created** — commented in `wrangler.toml`, added at deploy |
| Identity-link ceremony (OAuth2 `identify`, writes `discord_links/*`) | **Not built** — phase 2; until it ships every vote click gets the worded "not linked" rejection |
| Bot-posted poll messages with buttons (phase 3) | **Not built** — nothing posts the votable message yet |
| `club_announcements.py` / `send_discord_notification.py` | **Untouched, by design** — webhook announcements are permanent, never replaced |

## 2. Secrets — names and custody

Set from `apps/discord-worker/` with `wrangler secret put <NAME>` (after the
first deploy creates the Worker; locally they go in `.dev.vars`, gitignored):

| Secret NAME | Where the value comes from | Notes |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Portal → General Information → **Public Key** | 64 hex chars. Public by design (it only *verifies*); kept as a secret for uniform custody |
| `DISCORD_APPLICATION_ID` | Same portal page → **Application ID** | |
| `DISCORD_BOT_TOKEN` | Portal → Bot → **Reset Token** | ⚠️ Shown **once**; one credential shared across every opted-in club (§1.2's accepted blast-radius regression). Rotate via the same Reset Token button. Not consumed by the poll-vote path yet (message edits ride the 15-min interaction token) — required for phase-3 bot-posted messages |
| `FIREBASE_SERVICE_ACCOUNT` | The same JSON `auth-worker` holds | ⚠️ **Pipe the file in** (`wrangler secret put FIREBASE_SERVICE_ACCOUNT < key.json`) — never paste into a terminal line, never echo |

## 3. Owner runbook — Developer Portal steps, in order

⚠️ **Order is load-bearing**: the portal *verifies the endpoint when you save
the URL* (a PING plus deliberately invalid signatures). Saving the URL before
the Worker is deployed **with `DISCORD_PUBLIC_KEY` set** fails and reads as
"the portal is broken" — that is step 5 failing, not Discord.

1. **Register the application.** [discord.com/developers/applications](https://discord.com/developers/applications)
   → **New Application**. Name: **GABI** (design decision #1 — the estate's
   existing bot-adjacent identity; check `gabi.png` meets Discord's avatar
   rules before uploading it, square ≥512px is safe — not verified).
   One application for the whole estate, shared by every club that invites it.
2. **Copy the two identifiers** from General Information: **Application ID**
   and **Public Key** → they become `DISCORD_APPLICATION_ID` and
   `DISCORD_PUBLIC_KEY`.
3. **Add the bot user.** Bot tab → add/confirm the bot → **Reset Token** →
   copy once → `DISCORD_BOT_TOKEN`. On the same tab:
   - Leave **Public Bot ON** — club server admins invite it themselves
     (design §1.4; turning it off would make the owner the only possible
     inviter).
   - Leave **every privileged intent OFF**, especially **Message Content**
     (design §1.5 — never requested; everything is slash-command/component
     driven).
4. **Deploy the Worker** (dispatcher/owner, from `apps/discord-worker/`):
   set the four §2 secrets, uncomment the `discord.heygabi.ai` route in
   `wrangler.toml`, `npx wrangler deploy`. Confirm
   `https://discord.heygabi.ai/api/health` answers `ok: true` with all four
   `configured` booleans `true`.
5. **Set the Interactions Endpoint URL.** General Information →
   Interactions Endpoint URL → `https://discord.heygabi.ai/interactions` →
   Save. Discord PINGs it and probes with invalid signatures; the save
   succeeding **is** the verification that the Ed25519 gate works. If it
   refuses to save, re-check step 4 (usually a missing/mistyped
   `DISCORD_PUBLIC_KEY`).
6. **Invite it to a server** (any server's own admin, never estate-initiated
   — design §1.4). Minimal-permission invite URL, per design §1.5:

   ```
   https://discord.com/oauth2/authorize?client_id=<APPLICATION_ID>&scope=bot+applications.commands&permissions=84992
   ```

   `84992` = View Channel (1024) + Send Messages (2048) + Embed Links
   (16384) + Read Message History (65536). Never Manage Server, never
   Administrator, never Message Content.

## 4. Poll voting — how a Discord click becomes a vote

- The vote buttons carry `custom_id = pv|<clubs|clubs_dev>|<clubId>|<pollId>|<idx>`;
  the Worker answers a deferred ack inside Discord's 3-second window and does
  the Firestore work under the 15-minute interaction token.
- **Identity (design §1.6, followed exactly):** the clicker's Discord user id
  is resolved via the Firestore doc `discord_links/{discordUserId}` →
  `{slug, displayName}`. Unlinked → worded **ephemeral** rejection; votes are
  **never** guessed from usernames (the pseudo-member fallback was
  deliberately not built). Only this Worker reads the collection (service
  account — no rules change needed); the phase-2 link ceremony is the only
  intended writer.
- The write is `…/polls/{pollId}/votes/{slug}` `{optionIndex, displayName}` —
  the exact shape `validPollVote()` accepts from a browser, so the club page,
  tallies, and `club_announcements.py` pick it up with **zero new code**.
  Last write wins = the existing "change your vote" behavior.
- Server-side re-checks (the SA bypasses rules): poll exists and is `open`,
  option index in range, and the club's `features.discordPollVoting` flag is
  affirmatively `true` (default OFF — a club opts in).
- App→Discord direction: the message tally refreshes on every Discord vote.
  An **app-side** vote does not move the Discord message until someone votes
  in Discord again — the periodic refresh and close-propagation ride
  `club_announcements.py`'s cadence and are phase 3 (that file stays as-is
  until that build is approved).

## 5. Gotchas (the ones that cost time elsewhere)

- **The portal silently removes a saved Interactions URL** if invalid
  signatures ever stop being rejected. If interactions stop arriving, check
  the portal field *first* — it may simply be empty again.
- **Health check:** `GET /api/health` — config-presence booleans only, no
  values, no PII. `configured.firebase_service_account: false` means votes
  bounce with a worded "not fully set up" ephemeral, not a crash.
- `apps/discord-worker/src/firebase-sa.ts` is a **marked copy** of
  auth-worker's (auth-worker was frozen by a concurrent agent at build
  time), scoped down to `datastore` only. Treat auth-worker's as canonical;
  the recorded follow-up is hoisting the common core into `packages/`.
