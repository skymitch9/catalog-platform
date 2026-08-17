# Discord Bot — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret
> NAMES only, never values).
> Last verified: **2026-08-17** — LIVE at `discord.heygabi.ai`, version
> `b64be346-876c-4cf0-8365-137afee3536a` (**phase 3**, bot-posted poll
> messages). Application **GABI** (id `1538775435880562758`). Measured live
> this deploy: `/api/health` `ok: true`; the four original `configured`
> booleans `true`; `poll_sync_token` **`false`** and `poll_sync_ready`
> **`false`** (honest — phase 3 ships dark, §8); `discord_client_secret`
> **`false`** and `link_ready` **`false`** (honest — the link ceremony ships
> dark, §3 step 7); `POST /polls/sync` answering **503 with the worded
> not-configured body** both unsigned and with a bearer token;
> `/interactions` still answering **401 `missing_signature_headers`** to an
> unsigned POST — the endpoint is intact.
> **Remaining steps: §3 step 7** (owner: client secret + redirect URI + the
> Firebase authorised-domain entry) and **§8's `POLL_SYNC_TOKEN`**
> (conductor: mint once, give to both sides). Steps 5 and 6 are done.

The estate Discord bot's operational runbook: what exists, the secrets, and
the exact Developer Portal steps **only the owner can perform**. The bot IS
live; what is not yet on is **identity linking** (§3 step 7, the owner's three
clicks) and **poll-message posting** (§8.6, one minted secret). Both are built,
deployed and shipping dark. Design and option space:
[`../info/discord-bot-design.md`](../info/discord-bot-design.md); bot
mechanics research: `audiobook_catalog/docs/info/discord-poll-sync-research.md`.

---

## 1. What exists / what does not (2026-08-17)

| Piece | State |
|---|---|
| `apps/discord-worker/` — interactions endpoint (Ed25519 verify, PING→PONG, router) + two-way poll voting | **Built, tested (104), LIVE** |
| Discord application / bot user | **Exists** — GABI, `1538775435880562758` |
| Secrets | **Four of six set.** `DISCORD_CLIENT_SECRET` (§3 step 7, owner) and `POLL_SYNC_TOKEN` (§8, conductor) are the two gaps |
| Route `discord.heygabi.ai` | **Live** — custom domain, `wrangler.toml` `routes` |
| Interactions Endpoint URL | **Saved and verified** — the portal's probe passed |
| Identity-link ceremony (OAuth2 `identify`, writes `discord_links/*`) | **Built + deployed 2026-08-17, SHIPPING DARK.** Every route answers a worded "linking is not configured yet" page until `DISCORD_CLIENT_SECRET` exists. Until it is on, every vote click still gets the worded "not linked" rejection |
| `/link` slash command | **Written, NOT PUBLISHED** — Discord shows only what an app PUTs. Publish it with §4 once the secret is set |
| Bot-posted poll messages with buttons, tally refresh, close propagation (phase 3) | **Built + deployed 2026-08-17, SHIPPING DARK.** `POST /polls/sync` answers a worded 503 until `POLL_SYNC_TOKEN` is minted (§8). Nothing has been posted to any channel yet |
| `send_discord_notification.py` | **Untouched, by design** — the estate-wide new-books webhook is unchanged |
| `club_announcements.py` | **One additive function, 2026-08-17** (`sync_poll_messages`): it POKES §8's endpoint after its own pass and can never fail because of it. Every webhook announcement it already sent is byte-for-byte unchanged — the announcements are permanent and are never replaced by the bot |

## 2. Secrets — names and custody

Set from `apps/discord-worker/` with `wrangler secret put <NAME>` (after the
first deploy creates the Worker; locally they go in `.dev.vars`, gitignored):

| Secret NAME | Where the value comes from | Notes |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Portal → General Information → **Public Key** | 64 hex chars. Public by design (it only *verifies*); kept as a secret for uniform custody |
| `DISCORD_APPLICATION_ID` | Same portal page → **Application ID** | |
| `DISCORD_BOT_TOKEN` | Portal → Bot → **Reset Token** | ⚠️ Shown **once**; one credential shared across every opted-in club (§1.2's accepted blast-radius regression). Rotate via the same Reset Token button. Still NOT used by the poll-**vote** path (those message edits ride the 15-min interaction token) — it is consumed by exactly two things: publishing slash commands (§4) and **phase 3's sync tick** (§8), which posts and edits real channel messages with it |
| `FIREBASE_SERVICE_ACCOUNT` | The same JSON `auth-worker` holds | ⚠️ **Pipe the file in** (`wrangler secret put FIREBASE_SERVICE_ACCOUNT < key.json`) — never paste into a terminal line, never echo |
| `DISCORD_CLIENT_SECRET` | Portal → **OAuth2** tab → **Client Secret** (Reset Secret) | ⚠️ **NOT SET.** A *different* credential from the bot token: it authenticates the **application** during the identity-link code exchange and can mint no bot powers. It also derives the HMAC key for the 15-minute pending-link cookie, so rotating it invalidates in-flight link attempts and nothing else. Set it per §3 step 7 |
| `POLL_SYNC_TOKEN` | ⚠️ **Nobody issues this one — the conductor MINTS it.** `python -c "import secrets; print(secrets.token_urlsafe(32))"` | ⚠️ **NOT SET.** The shared secret gating `POST /polls/sync` (§8). Goes to **both** sides: `wrangler secret put POLL_SYNC_TOKEN` here, and the *same value* into the audiobook pipeline's `.env` under the same name. A third, deliberately weaker credential class: holding it lets someone make the bot re-render its **own** poll messages sooner than it would have — it grants no Discord powers, holds no Firestore access of its own, and can post nothing a poll doc does not already say |

Two **vars** (not secrets) were added to `wrangler.toml` with the link
ceremony, both mirroring auth-worker's: `FIREBASE_PROJECT_ID =
"audiobook-catalog"` (the canonical verifier asserts it as *both* issuer and
audience — ⚠️ removing it does not make the check smaller, it makes it
absent) and `OWNER_EMAILS` (read by exactly one thing: the gate on §4).

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

   *(Done 2026-08-16 — invited with the wider moderator bundle
   `1116825807878`, deliberately NOT Administrator. Widening later is a role
   toggle, never a re-invite.)*

7. ⚠️ **THE ONE REMAINING OWNER STEP — switch identity linking on.**
   Three clicks, in this order. Until all three exist, the ceremony ships
   **dark**: `/link` answers a worded "linking is not configured yet" page,
   `/api/health` reports `configured.discord_client_secret: false` and
   `link_ready: false`, and `/link` in Discord says so in its ephemeral
   reply. Nothing is broken meanwhile — voting on the club page is unchanged.

   **7a. The redirect URI.** Portal → application **GABI** → **OAuth2** tab →
   **Redirects** → **Add Redirect** →

   ```
   https://discord.heygabi.ai/link/callback
   ```

   → Save. ⚠️ **Do this BEFORE 7b.** Discord matches the redirect URI
   *exactly*, and an absent one fails the round trip at the authorize page
   with Discord's own error, not the estate's — which reads as "the link is
   broken" rather than "a field is empty".

   **7b. The client secret.** Same OAuth2 tab → **Client Secret** →
   **Reset Secret** → copy (shown once) → from `apps/discord-worker/`:

   ```
   npx wrangler secret put DISCORD_CLIENT_SECRET
   ```

   …and paste at the prompt. ⚠️ **Never on the command line, never echoed** —
   same custody as every other secret here. No redeploy is needed; secrets
   take effect on the next request.

   **7c. The Firebase authorised domain.** Firebase console → project
   **audiobook-catalog** → **Authentication → Settings → Authorised
   domains** → add **`discord.heygabi.ai`**.
   ⚠️ **`heygabi.ai` already being on the list does NOT cover this** —
   Firebase matches exact hostnames, not domain trees. Without it the
   callback page's Google sign-in throws `auth/unauthorized-domain` and the
   page says so in words (naming this exact step), but nobody can finish a
   link. Console-only; it cannot be scripted.

   **Confirm all three landed:**

   ```
   curl -s https://discord.heygabi.ai/api/health
   ```

   `configured.discord_client_secret` and `link_ready` should both be `true`.
   Then publish the slash command (§4) and run `/link` in Discord.

## 4. Publishing the slash commands

Discord does not discover commands — an application **PUTs** its command
list and Discord shows exactly that. GABI's registry is
`apps/discord-worker/src/commands.ts` (`ESTATE_COMMANDS`; currently one
entry, `/link`), and it is published by calling the Worker:

```
POST https://discord.heygabi.ai/admin/commands/register
Authorization: Bearer <a Firebase ID token from an estate ADMIN account>
```

**Why a route and not a script:** the two credentials it needs
(`DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`) are wrangler secrets that
exist inside the Worker and nowhere else. A script could only work by
pasting the bot token onto a command line, which §2 forbids in as many
words. The Worker already holds both, so the Worker publishes.

**The gate:** verified Firebase ID token **and** ladder rank `admin` or
above — `OWNER_EMAILS` short-circuits, otherwise `site_roles/{uid}`, the very
doc `firestore.rules` consults. Every refusal is worded; a directory outage
answers as an outage, never as a permissions refusal.

**Getting a token:** sign in on any estate page and run
`await (await import('/assets/estate-auth.js')).idToken()` in the console,
or take it from an authenticated request's `Authorization` header.

Registration is a **bulk overwrite and idempotent** — the payload is a
constant in the repo, so re-running it changes nothing. Commands are
**global** (design §1.4: any server's own admin invites GABI, and the estate
never enumerates the servers it is in — per-guild registration would require
exactly that enumeration). Global commands can take up to an hour to appear
the first time; updates show up almost immediately.

## 5. Identity linking — what a person actually experiences

Once §3 step 7 is done and §4 has run:

1. In Discord they run **`/link`** (or click a vote button while unlinked and
   are told, in words, to run it). The reply is **ephemeral** — a link
   ceremony is personal, and a channel-visible message would invite the wrong
   person to press it.
2. They open `https://discord.heygabi.ai/link`. The Worker sets a CSRF nonce
   cookie and sends them to Discord's own authorize screen, asking for
   **`identify` and nothing else** — a username, no email, no server list, no
   messages.
3. They approve. Discord returns to `/link/callback`, which checks the nonce,
   exchanges the code, and learns who they are. **Declining is a first-class
   outcome** and gets a page that says so kindly, with nothing stored.
4. That page then asks them to **sign in with the same Google account they
   use on the club pages**, and posts the resulting Firebase ID token back.
5. The Worker verifies the token server-side and writes **one document**:
   `discord_links/{discordUserId}` = `{slug, displayName, linkedAt,
   firebaseUid}`. The page says "Linked" in words.
6. From then on, a vote clicked in Discord lands on
   `…/polls/{pollId}/votes/{slug}` — the exact doc id and field shape the
   club page's own `castVote()` writes, so tallies, the club page and
   `club_announcements.py` pick it up with zero new code.
7. **Unlink** is a button on the same page. It deletes the doc; the next
   Discord vote is refused in words again.

**The two proofs, and why both.** A link joins two identities, so the write
demands both in the same request: the Discord half is an OAuth code exchange
the browser cannot forge (carried to the confirm step in an **HttpOnly**
HMAC'd cookie the page can neither read nor edit), and the estate half is a
Firebase ID token verified server-side. Possessing a Discord session lets you
bind *your* Discord account and no other; possessing an estate session lets
you bind to *your* member entry and no other. Neither alone writes anything.

**The residual risk is unchanged and stated in design §1.6:** the link binds
a Discord identity to "whoever was signed in to Google in that browser" —
exactly as strong, and no stronger, than every other identity claim the
estate makes.

## 6. Poll voting — how a Discord click becomes a vote

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
  An **app-side** vote does not move the Discord message until the next sync
  tick — **phase 3, built 2026-08-17 (§8)**: the periodic refresh and the
  close propagation ride `club_announcements.py`'s cadence, so an app-side
  vote shows up in Discord within one pipeline run rather than instantly.

## 7. Gotchas (the ones that cost time elsewhere)

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
- ⚠️ **A Firebase authorised domain does NOT cover subdomains.**
  `heygabi.ai` being on the list says nothing about `discord.heygabi.ai`;
  each hostname that runs a Google sign-in needs its own entry. Symptom:
  `auth/unauthorized-domain` on the link page's sign-in button, which reads
  like a broken button rather than a missing console row. §3 step 7c.
- ⚠️ **A member slug is `displayName.toLowerCase()` — nothing more**
  (`audiobook_catalog/site/identity.js:765`). It is NOT dashed, NOT stripped,
  NOT transliterated, so nearly every real slug contains a **space**. Any code
  validating a slug with a Firestore-auto-id pattern (`[A-Za-z0-9_-]+`) will
  refuse almost every genuine member. That was live in `poll-vote.ts` until
  2026-08-17 and would have made every linked voter with a two-word name hear
  "you are not linked" while their link doc sat right there. The rule now
  lives in one file, `apps/discord-worker/src/slug.ts`, and a round-trip
  contract test pins the writer to the reader.
- **`/link` will not appear in Discord until it is published.** Discord shows
  exactly the command list an application PUT; writing the handler is not
  registering it (§4). Global commands can also take up to an hour to appear
  the first time — an absent `/link` in the first few minutes is normal.

## 8. Poll message sync — the bot-posted votable message (phase 3)

*(Numbered 8, not 5, on purpose: `DONE.md` is append-only and already points
at §7's gotchas, so renumbering this file would leave the archive pointing at
the wrong section. Code refers to this section by NAME rather than number, so
it can move without lying.)*

Phase 2 made a Discord click become a vote. **This is what posts the thing to
click.** Built + deployed 2026-08-17, `apps/discord-worker/src/poll-sync.ts`.

### 8.1 What runs, and who starts it

| | |
|---|---|
| Endpoint | `POST https://discord.heygabi.ai/polls/sync` |
| Auth | `Authorization: Bearer <POLL_SYNC_TOKEN>` (§2) |
| Body | `{"lane": "prod"}` or `{"lane":"dev"}` — an empty body means prod |
| Caller | `audiobook_catalog/app/club_announcements.py` → `sync_poll_messages()`, on the pipeline's existing ~8-hour cadence (the trigger `discord-poll-sync-research.md` §6 recommends) |
| Manual run | `curl -s -X POST -H "authorization: Bearer $POLL_SYNC_TOKEN" -H 'content-type: application/json' -d '{"lane":"prod"}' https://discord.heygabi.ai/polls/sync` |

⚠️ **The trigger carries NO club data — only the lane.** Every fact the tick
acts on (which clubs opted in, which polls exist, the vote tallies, the
channel) is read by the Worker with its own service account. A trigger that
carried club ids or webhook URLs would make the pipeline a second source of
truth and would put a webhook capability on the wire for nothing.

⚠️ **Independent failure domains.** A dead sync endpoint costs the webhook
announcements nothing: `sync_poll_messages()` runs *after* the announcement
pass, catches everything, and logs one line. A dead pipeline costs the vote
path nothing — clicking a button in Discord still writes a vote and still
refreshes that message, because that rides the interaction token.

### 8.2 What one tick does, per opted-in club

Gated on `features.discordPollVoting === true` (default OFF — the same
affirmative check the vote path re-enforces server-side).

1. **Open poll, never posted** → post a message with one button per option.
2. **Open poll, already posted** → edit that message with a fresh tally.
3. **Poll now closed, message exists** → edit it to the closed rendering
   (buttons **removed**, winner marked 🏆, footer "final — this poll is
   closed") and record it as propagated, so it happens exactly **once**.
4. **Poll closed and never posted** → nothing. The bot does not introduce a
   vote nobody could cast.
5. **Message deleted in Discord (404)** → an *open* poll is reposted and the
   record repointed; a *closed* one is left gone rather than resurrected.

### 8.3 Which channel it posts to

In order, first hit wins:

1. **`discordChannelId`** on `clubs/{id}/settings/discord` — a new, additive,
   optional field. Set it when the club wants the bot in a *different* channel
   from the one its announcement webhook posts to.
2. **The club's existing `webhookUrl`**, resolved through Discord's own
   `GET /webhooks/{id}/{token}`, whose webhook object carries `channel_id`.
   This is the default and needs no new configuration at all: the bot simply
   posts where that club's announcements already go — the channel the club
   already agreed to.
3. **Neither** → a named skip in the tick's `notes`, saying exactly which
   field to add. Never a guess, never a crash.

⚠️ **NOT VERIFIED LIVE:** step 2's `channel_id` round trip. No club had opted
in at build time, so it has never run against real Discord. If Discord omits
the field, step 1 is the documented fallback and the skip says so in words.

### 8.4 State — `discord_poll_messages/{clubCol}__{clubId}__{pollId}`

```
{ clubCol, clubId, pollId, channelId, messageId,
  renderedStatus: 'open' | 'closed', updatedAt }
```

A **top-level collection this Worker owns outright**, and the three reasons
it is shaped that way:

- **Not a field beside the poll.** `clubs/{id}/polls/{pollId}` is
  browser-writable and edited by the club page's manager UI; Worker
  bookkeeping in a doc a browser rewrites is a collision waiting to happen.
  Nothing else writes this collection — not the club page, not the vote path
  (`polls/{id}/votes/{slug}`), not `club_announcements.py`
  (`settings/announceState`).
- **Composite id, not the bare `pollId`.** `clubs` and `clubs_dev` are two
  separate universes that may legitimately hold the same auto-id.
- **No `firestore.rules` change.** No rule grants it and the file has no
  catch-all, so browsers are denied by default and the service account
  bypasses — the same posture as `discord_links/*` (§6).

**Idempotence is keyed on the stored `messageId`:** present ⇒ edit, absent ⇒
post. That is what makes a tick safe to run twice, or by hand mid-cadence.

### 8.5 Blast rails

- Per-club failures are **named skips** in `notes`, never a crash — one broken
  club cannot stop the sweep, and the note says what to fix.
- **429s honour Discord's own `retry_after`**, bounded to three attempts, so a
  rate limit can never hold a tick open indefinitely.
- At most `MAX_POLLS_PER_CLUB` (10) polls per club per tick; the overflow is
  **stated**, not dropped.
- A whole-tick Firestore outage answers as an outage, in words — never as a
  permissions problem.

### 8.6 Switching it on

1. **Mint the secret once** (conductor):
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
2. `wrangler secret put POLL_SYNC_TOKEN` from `apps/discord-worker` — paste at
   the prompt, never on the command line.
3. Put the **same value** in the audiobook pipeline's `.env` as
   `POLL_SYNC_TOKEN` (documented in that repo's `.env.example`).
4. Confirm: `curl -s https://discord.heygabi.ai/api/health` →
   `configured.poll_sync_token: true`, `poll_sync_ready: true`.
5. Opt a club in: `features.discordPollVoting = true` on its club doc, and
   make sure GABI is in that server with Send Messages + Embed Links in the
   target channel.
6. The next pipeline run posts the message. Or run §8.1's curl to see it
   immediately.

**What a club sees once it is on:** an embed titled with the poll question,
one numbered line per option with a live vote count, and a row of buttons
(five per row, up to ten options). Clicking one records the vote against
`votes/{slug}` — the same doc the club page writes — and the message's tally
refreshes on the spot. When a manager closes the poll, the next tick strips
the buttons, marks the winner, and the footer reads "final — this poll is
closed". Members who have not linked their Discord account get the existing
worded ephemeral telling them to run `/link`.
