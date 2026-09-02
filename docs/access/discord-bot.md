# Discord Bot — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret
> NAMES only, never values).
>
> ⚠️ **ADDED 2026-09-02 — §15, THE FUN MENU** (`/recent`, `/universe`,
> `/review`, `/suggest`, `/guessgame` live; `/rsvp` and `/progress` DARK behind
> `GABI_CLUB_WRITES`). ⚠️ **§4's registration ritual now has a second switch —
> see §15.2**, and **nothing in §15 has been typed in Discord yet**: the
> registration route has not been re-run, so the five new commands are not
> visible in any server. The verification below was NOT re-taken.
>
> Last verified: **2026-08-18** — LIVE at `discord.heygabi.ai`, version
> **`c9af75f0-f8e3-4de6-b6ac-81a02c98ce9f`** (the **asker-aware, prefilled deep
> link**, §10.3). Measured live this deploy: `/api/health` `ok: true`, 12
> features, all rows intact including `gabi_docs_ready: true`,
> `gabi_delegated_ready: true` and `gabi_panel_url:
> "https://padhard.heygabi.ai/"` (a config report, deliberately still bare and
> still the static fallback); `/interactions` **401** to an unsigned POST and
> **401** to a bad signature; `library.heygabi.ai/?gabi=…` and
> `padhard.heygabi.ai/?gabi=…` both **200**. ⚠️ **NOT verified:** that the panel
> visibly prefills in a browser — the reader function was measured in the
> deployed bundle, but nobody drove a signed-in, `runResearch`-holding session
> through it.
>
> Previously verified **2026-08-17** at version
> **`03bd6a3a-7f05-4fbe-a846-05bc614f97e6`** (**`/gabi`**, the fixer's surface
> in shape (b), §10 — joining **`/have`** and the **moderation pair, dark**,
> §9). Application **GABI** (id `1538775435880562758`). Measured live that
> deploy: `/api/health` `ok: true`; `discord_public_key`,
> `discord_application_id`, `discord_bot_token`, `firebase_service_account`,
> `firebase_project_id` and **`poll_sync_token` all `true`**, with
> `poll_sync_ready: true` (the token has been set since §8 was written — ⚠️
> **not verified** is whether the pipeline's `.env` holds the same value);
> ✅ **`discord_client_secret` now `true` and `link_ready` `true`** — the owner
> did §3 step 7's clicks between the last verification and this one, so the
> link ceremony is **no longer dark** (this line previously said `false`;
> corrected by re-measurement, not by assumption); **`moderation_enabled:
> false`**, `have_scope: "audiobook"`, and the two new rows
> `gabi_surface: "propose_and_deep_link"` /
> `gabi_panel_url: "https://padhard.heygabi.ai/"`;
> `/interactions` still answering **401 `missing_signature_headers`** to an
> unsigned POST and **401 `bad_signature`** to a bad one — the endpoint is
> intact. Also measured: `https://padhard.heygabi.ai/api/health` reports
> `gabi: {"panel": true}`, so §10's deep link points at a site that really does
> run the panel.
> **Remaining steps: §4** (owner/admin: publish the commands — ⚠️ **`/link`,
> `/have` and `/gabi` do not exist in Discord until this is run**), a club
> opt-in for §8, and §9's owner-only `MODERATION_ENABLED` flip. Steps 5, 6 and
> 7 are done.

The estate Discord bot's operational runbook: what exists, the secrets, and
the exact Developer Portal steps **only the owner can perform**. The bot IS
live. ⚠️ **Nothing is visible in Discord until §4 publishes the commands** —
that is now the single highest-value remaining click, and it has grown more
valuable, not less: `/have` (§9) and **`/gabi` (§10)** each need nothing else
at all, and identity linking (§3 step 7) is now switched on, so `/link` works
the moment it appears. Still off besides that: **poll-message posting** (§8 —
the token is set; a club still has to opt in) and **moderation** (§9.5, the
owner's evidence-gated flip). Both are built, deployed and shipping dark. Design and
option space:
[`../info/discord-bot-design.md`](../info/discord-bot-design.md); bot
mechanics research: `audiobook_catalog/docs/info/discord-poll-sync-research.md`.

---

## 1. What exists / what does not (2026-08-17)

| Piece | State |
|---|---|
| `apps/discord-worker/` — interactions endpoint (Ed25519 verify, PING→PONG, router) + two-way poll voting | **Built, tested (161), LIVE** |
| Discord application / bot user | **Exists** — GABI, `1538775435880562758` |
| Secrets | ✅ **ALL SIX SET** (re-measured 2026-08-17 at the `/gabi` deploy — this row previously said five of six: `DISCORD_CLIENT_SECRET` is now `true` and `link_ready` with it, so the owner did §3 step 7 in between); `POLL_SYNC_TOKEN` **is** now set on the Worker — ⚠️ **not verified** whether the pipeline's `.env` holds the same value |
| Route `discord.heygabi.ai` | **Live** — custom domain, `wrangler.toml` `routes` |
| Interactions Endpoint URL | **Saved and verified** — the portal's probe passed |
| Identity-link ceremony (OAuth2 `identify`, writes `discord_links/*`) | **Built + deployed 2026-08-17.** ✅ **No longer dark** — `DISCORD_CLIENT_SECRET` is set and `/api/health` reports `link_ready: true` (measured 2026-08-17). ⚠️ `/link` still has to be PUBLISHED (§4) before anyone can type it |
| `/link`, `/have` and `/gabi` slash commands | **Written, NOT PUBLISHED** — Discord shows only what an app PUTs. ⚠️ None of the three exists in Discord until someone runs §4; `/have` and `/gabi` need nothing else and work the moment they are published |
| `/have` — "is this book on the estate's shelves?" | **Built + deployed 2026-08-17** (§9). Answers at the PUBLIC audiobook scope for everyone, with **no credential on the call** — that absence IS the scope decision. Needs no switch-on beyond §4 |
| `/gabi` — the fixer's Discord surface, **shape (b) propose-and-deep-link** | **Built + deployed 2026-08-17** (§10), version `03bd6a3a`. A best-effort answer from the same public slice **plus a deep link into the real GABI panel** on `padhard.heygabi.ai`. ⚠️ **No write, no model call, no new secret** — that is the whole reason it could ship without any of the design's four blockers being solved. Needs no switch-on beyond §4 |
| `/timeout` + `/cleanup` (moderation) | **Built + deployed 2026-08-17, SHIPPING DARK AND UNPUBLISHED** (§9). Every path answers a worded "moderation is switched off" while `MODERATION_ENABLED` is anything but `"on"`, and the two commands are not published to Discord at all until it is |
| `MODERATION_ENABLED` | **`"off"`** — owner's evidence-gated flip, never an agent's, never a deploy side effect (§9.5) |
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
| `DISCORD_CLIENT_SECRET` | Portal → **OAuth2** tab → **Client Secret** (Reset Secret) | ✅ **SET** (measured 2026-08-17: `/api/health` reports `discord_client_secret: true`, `link_ready: true`). A *different* credential from the bot token: it authenticates the **application** during the identity-link code exchange and can mint no bot powers. It also derives the HMAC key for the 15-minute pending-link cookie, so rotating it invalidates in-flight link attempts and nothing else. Set it per §3 step 7 |
| `POLL_SYNC_TOKEN` | ⚠️ **Nobody issues this one — the conductor MINTS it.** `python -c "import secrets; print(secrets.token_urlsafe(32))"` | ✅ **SET on the Worker** (measured 2026-08-17: `/api/health` reports `poll_sync_token: true`). ⚠️ **NOT VERIFIED:** whether the audiobook pipeline's `.env` holds the SAME value — without that the cadence trigger cannot authenticate. The shared secret gating `POST /polls/sync` (§8). Goes to **both** sides: `wrangler secret put POLL_SYNC_TOKEN` here, and the *same value* into the audiobook pipeline's `.env` under the same name. A third, deliberately weaker credential class: holding it lets someone make the bot re-render its **own** poll messages sooner than it would have — it grants no Discord powers, holds no Firestore access of its own, and can post nothing a poll doc does not already say |
| `ESTATE_APP_TOKEN_DISCORD` | ⚠️ **Nobody issues this one either — the conductor MINTS it** (`openssl rand -hex 32`) | ✅ **SET on all three holders 2026-08-18, and the pairing VERIFIED LIVE**: a real bearer call to both library instances answered 200/403 with worded bodies, a wrong bearer answered 401. The bearer for GABI's **Tier-1 delegated write door** (§13). **One value, THREE holders, the same NAME on each**: here, plus both library Workers (`npm run secret -- ESTATE_APP_TOKEN_DISCORD` and `npm run secret:friend -- ESTATE_APP_TOKEN_DISCORD` in `library_catalog`) — the `DONOR_TOKEN` idiom. ⚠️ **Holding it authorises NO WRITE.** It proves only "this request came from the estate's Discord Worker"; the destination then resolves the on-behalf-of Firebase uid to its OWN `app_user` row and checks THAT person's capability. So a leak buys the ability to act for people who already hold the capability, on a surface where every write is stamped `gabi-discord` and is revertible in the app — a smaller blast radius than the bot token's. Read by exactly one module (`src/delegated-exec.ts`), pinned by a build-failing test |

| `ANTHROPIC_API_KEY_GABI` | ⚠️ **Nobody issues it — MINT a new key** at console.anthropic.com | ✅ **SET.** Deliberately separate from `library_catalog`'s `ANTHROPIC_API_KEY` so the Discord spend is separately capped, rotated and auditable. Its absence is a **LADDER not a fault**: the keyword router still answers. ⚠️ Its value passed through a Cloudflare tail during the 2026-08-18 BOM diagnosis and the owner **accepted that exposure** — do not re-raise rotation for this key unless NEW exposure occurs (§7) |
| `GROQ_API_KEY_GABI` | ⚠️ **Nobody issues it — MINT a new key** at console.groq.com | 🔴 **NOT SET (2026-09-01) — the owner's step.** The **Groq first line** in front of Haiku on the four TOOLLESS GABI calls ([`info/gabi-groq-rung.md`](../info/gabi-groq-rung.md)). ⚠️ **A DIFFERENT PROVIDER, SO A DIFFERENT BILL** — cheap-to-free today and that is not a promise; it is row **E7** in the money-path inventory. Its absence is a **LADDER not a fault**: with no key every call is the Haiku one it always was, whatever `GABI_GROQ` says, and `/api/health` reports `configured.groq_key_gabi: false` with `gabi_groq_ready: false`. ⚠️ **PUSH IT WITH THE SCRIPT, NEVER A POWERSHELL PIPE** — `node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI` (§11.8). A BOM'd key here is *harder* to spot than the 2026-08-18 one was, because this rung is designed to fail invisibly: every turn would still be answered, by Haiku |

Three **vars** (not secrets) that matter are in `wrangler.toml`. Two were added
with the link ceremony, both mirroring auth-worker's: `FIREBASE_PROJECT_ID =
"audiobook-catalog"` (the canonical verifier asserts it as *both* issuer and
audience — ⚠️ removing it does not make the check smaller, it makes it
absent) and `OWNER_EMAILS` (read by exactly one thing: the gate on §4).

The third is **`GABI_GROQ`** (added 2026-09-01), and ⚠️ **it is the only
THREE-state posture on this Worker** — every other one is affirmative-only
`"on"`:

| Value | Behaviour |
|---|---|
| `off` | byte-identical to the pre-Groq bot; no prompt is built and no request is made |
| `shadow` — **ships this way** (flipped off → shadow 2026-09-01, `8286150`) | Groq is called beside Haiku, one `gabi_groq_shadow` line is logged, and ⚠️ **Haiku's answer is used** |
| `first` | Groq is tried once; any failure falls through to Haiku invisibly |

⚠️ **Fail closed**: anything that is not exactly `shadow` or `first` — including
`"on"` and `"true"`, which are what somebody who knows this Worker's *other*
postures would type — coerces to `off`. ⚠️ **Shadow before first**, and the flip
is the OWNER's after reading the lines, never a deploy's side effect. Scope:
**toolless calls only** — a tool-loop turn stays on Anthropic in every posture.

A fourth, **`GABI_EDGE`** (added 2026-09-01), is the **second** multi-state
posture — GABI's intensity dial, owner ask *"she can be a bit snarkier or a bit
more flirty… Think of Grok from X in its all go mode."*

| Value | Behaviour |
|---|---|
| `standard` | ⚠️ **Byte-identical to the pre-dial bot.** Nothing is appended, and a test holds the whole prompt as a literal |
| `full` — **ships this way** | The roast licence, the book-fuelled personalisation instruction and the written floor ride the system prompt |

⚠️ **Fail closed the same way**: anything that is not exactly `full` reads as
`standard`. ⚠️ **Turning her down is ONE WORD and a deploy** — `full` →
`standard` in `wrangler.toml`. It multiplies whatever trope
`GABI_PERSONALITY` picked rather than replacing one, and it raises **bite**,
never the PG-13 ceiling. Full posture and floor:
[`gabi-personality.md`](gabi-personality.md) §9.

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

7. ✅ **DONE — identity linking is switched on** (measured 2026-08-17: `discord_client_secret: true`, `link_ready: true`). Kept in full because it is the rotation runbook, and because a re-measured correction is worth being able to see. It previously read "THE ONE REMAINING OWNER STEP"; the one remaining step is now §4.

   The three clicks that switched it on, in the order they must be done —
   kept verbatim because they are also the ROTATION runbook. Until all three
   exist, the ceremony ships **dark**: `/link` answers a worded "linking is
   not configured yet" page, `/api/health` reports
   `configured.discord_client_secret: false` and `link_ready: false`, and
   `/link` in Discord says so in its ephemeral reply. Nothing is broken
   meanwhile — voting on the club page is unchanged.

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
`apps/discord-worker/src/commands.ts`: `BASE_COMMANDS` (`/link`, `/have`,
`/gabi`, and since 2026-09-02 `/recent`, `/universe`, `/review`, `/suggest`,
`/guessgame`) always, **plus** `MODERATION_COMMANDS` (`/timeout`, `/cleanup`)
**only when `MODERATION_ENABLED` is `"on"`** — see §9.5 for why hiding them was
chosen over showing a control that answers "switched off" — **plus**
`CLUB_WRITE_COMMANDS` (`/rsvp`, `/progress`) **only when `GABI_CLUB_WRITES` is
`"on"`**, which it is not: ⚠️ **see §15.3 before flipping it.** It is published
by calling the Worker:

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

Registration is a **bulk overwrite**. ⚠️ It is idempotent *for a given switch
state* — it is no longer a pure constant, because the payload depends on
**two** switches, `MODERATION_ENABLED` and `GABI_CLUB_WRITES`. Re-running it
after **either** flip is therefore a REAL step, not a no-op, and the route's own
JSON answer states which commands it published and what **both** switches were.
Commands are
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

- ⚠️ **"GABI hears but never answers, and the tail shows `401 invalid
  x-api-key`" = a BOM in the secret, not a bad key.** Incident 2026-08-18:
  piping a value to `wrangler secret put` from PowerShell prepended an
  invisible UTF-8 byte-order-mark (`EF BB BF`) to the stored secret;
  Anthropic rejected every call while the key itself was perfectly valid,
  and the tail's non-ASCII-header warning printed the FULL key value (so an
  affected key should be rotated, not just re-stored).
  ⚠️ OWNER DECISION 2026-08-18 ("Leave key as is"): the current
  ANTHROPIC_API_KEY_GABI's value DID pass through the owner's private
  Cloudflare tail during the diagnosis and he ACCEPTED that exposure after
  it was laid out (blast radius: his own account's log stream + one Claude
  session). Do not re-raise rotation for this key unless NEW exposure
  occurs — a decided risk, not an oversight.
  ⚠️ **The first "fix" was measured NOT to work and is REVOKED as ritual**
  (same night, rotated key, same 401): setting
  `$OutputEncoding = UTF8Encoding($false)` + trimming, then
  `$val | npx wrangler secret put`, STILL stored a BOM'd secret on Windows
  PowerShell 5.1. A string does not survive a PowerShell pipe to a native
  process here, full stop. **The ONLY sanctioned method:**
  `[IO.File]::WriteAllText($tmp, $val, (New-Object System.Text.UTF8Encoding($false)))`,
  verify the file's first bytes are the value's own (115 107 for `sk`),
  then `cmd /c "npx wrangler secret put NAME < $tmp"`, then delete the
  file — cmd's `<` passes raw bytes untouched (this is how
  TOKEN_SIGNER_KEY and the final ANTHROPIC_API_KEY_GABI were stored).
  Still prove the value against the live API (a 1-token call) BEFORE
  storing — an upload succeeding proves transport, not the value.
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


## 9. `/have`, and the moderation pair (built dark)

*(Numbered 9 for the same reason §8 is numbered 8: `DONE.md` is append-only and
already points at earlier sections by number, so nothing is ever renumbered
here. Built + deployed 2026-08-17, version
`ad35e796-ffd6-44a8-b15e-83bc75bf97ab`, commit `b9d10d3`.)*

### 9.1 `/have <title>` — what a person gets

An **ephemeral** answer listing the works that match a title/author/series
query — title, creator, every format found (audiobook, ebook) and a detail link
each — or a clean no-match. GABI answers "thinking…" inside Discord's 3-second
window and fills it in under the 15-minute interaction token, so a slow index
never turns into "This interaction failed".

| Caller | What they get today |
|---|---|
| Anyone, in any server, unlinked | The **public audiobook shelf** — the same slice `audiobooks.heygabi.ai` already shows the world |
| A **linked** member (`discord_links/{id}` exists) | The **same** results, plus one sentence saying wider shelves are not reachable from Discord yet, and naming why |
| In a DM | Works — `/have` reads nothing personal and needs no guild |

⚠️ **A no-match NEVER says "you don't own it."** A catalogue is not an
inventory — books are catalogued as they are scanned — so the answer says the
*catalogue* has nothing close, and says outright that an unscanned book looks
exactly like this.

⚠️ **It needs no secret and no switch.** The one thing between it and a person
is §4: publish the commands.

### 9.2 The scope line, and where the wider one actually stops

Design §4 decision 4 sets the default to `{audiobook}`, and the implementation
is the *absence* of a credential rather than the presence of one:

- ⚠️ **The call to `index.heygabi.ai/api/search` carries NO `Authorization`
  header.** The index's own `searchScope()` resolves an unauthenticated caller
  to the public slice by its §4.5 rule — so there is no token here to leak,
  misuse or accidentally widen, and a test asserts the header is absent.
- **`source=audiobook` is sent anyway.** It can only NARROW, so it costs
  nothing today and guarantees `/have` would not widen if the index's anonymous
  default ever did.

⚠️ **Why linked members do NOT get more, measured 2026-08-17 by reading the
code:** index scope resolves from `resolveIdentity()` — a **Firebase ID token
and nothing else** (`index-worker/src/middleware/scope.ts`). Discord's OAuth
cannot mint one; this Worker cannot either (its service account is deliberately
`datastore`-scoped, with no identitytoolkit); and even a `/seen` answer would
have nothing on the index to be handed to. **Making it real is two new pieces
of estate surface** — an `ESTATE_APP_TOKEN_DISCORD` pair on auth-worker and
here, AND an index capability that accepts an app token plus a subject. Both
widen access, so both are the owner's call, not an agent's.

### 9.3 The moderation pair — what it does in every state

`/timeout <user> <duration> [reason]` and `/cleanup <count> [user] [contains]`,
and nothing else (the owner's decided scope).

| State | What `/timeout` and `/cleanup` answer |
|---|---|
| **`MODERATION_ENABLED` is not `"on"` (today)** | A worded ephemeral: switched off, nothing happened, this is an estate setting and not your permissions, Discord's own tools are unaffected. **No network call is made at all.** They are also **not published**, so most people never see them |
| Switch on, caller **lacks** the permission | A worded refusal that NAMES it — Moderate Members / Manage Messages — and says GABI will not act for someone who could not act themselves |
| Switch on, **in a DM** | "That only works inside a server" — a different answer from a permissions refusal, because it is a different problem |
| Switch on, caller **holds** it | The action runs, with the rails in §9.4, a worded confirmation, and an audit line |

⚠️ **`"on"` and nothing else.** `"true"`, `"1"`, `"yes"`, `"On "` — only the
last works (it trims), and every other spelling means OFF. A typo fails closed,
by design and by test.

Durations: `30s`, `10m`, `1h`, `1d`, `1w`, and joins like `1h30m`. A bare number
is refused rather than guessed at; over **28 days** is refused and names
Discord's own ceiling.

### 9.4 The `/cleanup` rails

- **Hard cap 50 messages per invocation** — deliberately half Discord's own
  bulk-delete ceiling. Over the cap is **refused in words**, never clamped.
- **Preview, then confirm.** The first reply shows what *would* go (counts, plus
  the oldest three as samples) and deletes nothing. The confirm button's
  `custom_id` is HMAC-signed, **expires in two minutes**, and binds the invoker
  and the channel as *associated data* — signed but not transmitted — so a
  stale press, someone else's press, or a hand-typed id all fail. The confirm
  **re-reads the channel live**; it never deletes a remembered list.
- **Discord's 14-day bulk-delete limit is surfaced in words** as a named
  leftover ("4 also matched but are more than 14 days old, so GABI left them
  alone") — never a silent partial.
- **Pins are never deleted.** An unreadable timestamp is treated as ancient,
  i.e. the safe side of the 14-day line.
- **A preview with nothing to delete gets no button** — a confirm that would do
  nothing is a trap, not a choice.
- The `contains` filter is capped at **32 UTF-8 bytes** (32 plain characters,
  fewer with emoji or accents) because the confirm button has to carry it inside
  Discord's 100-character `custom_id`. Over is refused in words; ⚠️ never
  truncated, which would delete a different set than the preview showed.

### 9.5 Switching moderation on — the OWNER's step, and its second half

1. `MODERATION_ENABLED = "on"` in `apps/discord-worker/wrangler.toml`, then
   deploy. ⚠️ **No agent flips this, and it is never a side effect of an
   unrelated deploy.**
2. ⚠️ **Re-run §4's registration route.** While the switch is off, `/timeout`
   and `/cleanup` are **not published to Discord at all** — the registry is a
   function of the switch. Without this second step the switch is on and the
   commands are still invisible. (Why hidden rather than visible-and-refusing:
   `/link` being visible-but-off costs a curious person twenty seconds, while a
   visible `/timeout` costs a moderator the seconds of an actual incident, and
   advertises the capability in *every* server GABI is in, since commands are
   global. The handlers still answer the off-switch if an interaction arrives,
   so the contract holds at runtime regardless of visibility.)
3. Check `GET /api/health` → `moderation_enabled: true`.
4. Make sure GABI's role in that server actually holds **Moderate Members** and
   **Manage Messages** (the invite bundle `1116825807878` includes both — that
   is arithmetic on the bitfield, ⚠️ **not** verified against Discord's UI), and
   that her role sits **above** anyone she is expected to time out. Role order,
   not permissions, is the usual cause of a 403 — and the refusal says so.

**To back it out:** set it to `"off"`, deploy, re-run registration. The commands
disappear and every path returns to the worded off-switch. Nothing persists
except the audit lines of whatever ran.

### 9.6 The audit trail

`discord_mod_audit/{ISO-instant}__{nonce}` — a top-level collection the Worker
owns outright, written with the service account. No `firestore.rules` change
ships with it and none is needed: nothing grants a browser access and the file
has no catch-all, so browsers are denied by default (the same posture as
`discord_links/*` and `discord_poll_messages/*`).

```
{ action: 'timeout'|'cleanup', outcome: 'applied'|'refused_by_discord'|'failed',
  actorId, actorName, guildId, channelId, at,
  targetUserId?, durationSeconds?, reason?, messagesDeleted?, detail? }
```

⚠️ **Switched-off answers and permission refusals are NOT audited.** Nothing
happened in either case, and auditing them would let any member of any server
GABI is in fill an estate collection by spamming a command. Those go to the
Worker log instead. Discord's **own** server audit log additionally receives a
reason header on every real action, so a server admin sees who asked for what.

### 9.7 ⚠️ NOT VERIFIED LIVE

- **No moderation action has ever executed.** No timeout, no message read and no
  deletion has touched Discord — the switch has never been on. Every Discord
  call in that path is written, typed and unit-tested against injected
  dependencies, and has never run. The first real invocation will also be the
  first test of role-hierarchy 403s, of the bulk-delete endpoint, and of the
  audit write.
- **`/have` has never been invoked from Discord**, because the commands are not
  published. The index side WAS exercised: `GET /api/search?q=dungeon` was
  called live and answered `scope: ["audiobook"]` with real rows. What is
  unproven is the Worker-to-index hop and the render inside a real Discord
  client.
- **Whether the audiobook pipeline's `.env` holds the same `POLL_SYNC_TOKEN`**
  that is now set on the Worker.

---

## 10. `/gabi` — the fixer's Discord surface, shape (b)

*(Built + deployed 2026-08-17, version `03bd6a3a-7f05-4fbe-a846-05bc614f97e6`,
commit `4715b03`. Design: `library_catalog/docs/info/gabi-fixer-design.md` §10
— the three-way split, the four blockers, and why (b) is the shape that needs
none of them. Numbered 10 for the same reason §9 is numbered 9: nothing here is
ever renumbered.)*

### 10.1 What a person gets

`/gabi <question>` — an **ephemeral** answer in two halves:

1. **A best-effort factual nibble** from the estate index's **public slice**,
   the only surface this Worker can reach. The question is prose, so it is
   reduced to a searchable term first, and the answer **states the term it
   searched** — a bad reduction is then visible rather than mysterious.
2. **A deep link into the real GABI panel** at `https://padhard.heygabi.ai/`,
   with the wording *"GABI can dig deeper and propose fixes on the site"*, and
   **the question quoted back for copy-paste**.

| Caller state | What they get |
|---|---|
| **Linked** (`discord_links/{id}` exists) | Nibble + link + *"your Discord account is linked… but whether the panel opens is your role on that site (`runResearch`), and this bot genuinely cannot see it"* |
| **Not linked** (a 404 on the doc) | Nibble + link + the `/link` nudge (opt-in, revocable), and the same honest sentence about the role |
| **Link read failed / no service account / no user id** | Nibble + link + the role sentence, and ⚠️ **nothing at all about linking** |
| **No match on the public shelf** | *"Nothing on the estate's public shelf matches that"* + the catalogue-is-not-an-inventory caveat + the link |
| **Index down or refusing** | The service-problem sentence + **the link anyway** — a failed search is no reason to withhold the useful half |

⚠️ **The third row is a deliberate difference from `/have`.** `/have`'s
`isLinked()` folds every failure into `false`, which is right there (it changes
a scope footnote). Here it would tell an already-linked person to run `/link`
because Firestore blinked, so `/gabi` reads a **three-valued** state and a read
that could not be performed says nothing.

### 10.2 What it does NOT do — and why that is the point

| | |
|---|---|
| **No write, anywhere** | No Firestore write, no catalog write, no `change_log` row. The only Firestore access is a GET of the caller's own link doc |
| **No model call** | This Worker holds no `ANTHROPIC_API_KEY` and none was added. The tool loop stays on her site, on her key, under her sign-in |
| **No new secret** | The one new binding is `GABI_PANEL_URL` — a public hostname in `[vars]`, present so a test can point elsewhere |
| **No tool loop, no conversation state** | Each `/gabi` is one shot. Nothing is persisted between them |

A test asserts the whole flow makes **exactly two requests** — a GET to the
index and the PATCH that edits the deferred message — so a model call or a
write cannot slip in later while every other test still passes.

### 10.3 ⚠️ The deep link — asker-aware, and prefilled with `?gabi=`

⚠️ **SUPERSEDED 2026-08-18.** This section used to read *"the deep link carries
no `?q=`, and that is measured"*, on a 2026-08-17 reading that `GabiPanel.tsx`
parsed no location. Both halves changed, and both changed because the owner hit
them live: ***"why is it showing padhard and not the generic site"***.

**Where it points.** No longer `GABI_PANEL_URL` for everybody, and ⚠️ **not the
apex** — `heygabi.ai` runs no panel, so sending somebody there is the same dead
end wearing a friendlier hostname. It resolves the **asker's own catalog** from
their linked identity, reusing Tier 1's `whoami` port read-only:

| `whoami` | destination |
|---|---|
| `runResearch` on one instance | that instance |
| `runResearch` on both | the main library |
| an account, no capability | that instance; on both → the main library |
| unlinked / unresolved / outage | the configured `GABI_PANEL_URL` |

⚠️ It is **not** gated on `GABI_DELEGATED_WRITES` (a `whoami` mutates nothing),
but it **is** gated on the port existing — `estate_app_token_discord` **and**
`firebase_service_account`. With either unset every surface falls back to the
static link and behaves exactly as it did before this landed. `/api/health`'s
`gabi_delegated_ready` tells you which state the Worker is in.

**What it carries.** `?gabi=<question>` — ⚠️ **NOT `?q=`**, which is the library
app's own collection search on the same path and would empty the book list under
a floating panel. Measured off the deployed bundle 2026-08-18
(`/assets/index-rvJiy8K2.js`, byte-identical on both instances): the panel
collapses whitespace, trims, caps at **500** chars and `trimEnd()`s.
`panelDeepLink()` mirrors that step for step, so what the URL shows is what the
box will hold. The panel prefills and opens itself; it **never sends**.

The decision table and the whole rationale live in
`apps/discord-worker/src/panel.ts`; the regression suite is `test/panel.test.ts`.

⚠️ `GET /api/health`'s `gabi_panel_url` still calls the same function with **no
question** and stays bare. It is a **config report** — "is the fallback var set
correctly" — not a person's link, and it is deliberately not asker-aware.

### 10.4 What can be checked without Discord

```bash
curl -s https://discord.heygabi.ai/api/health   # gabi_surface, gabi_panel_url, gabi_delegated_ready
curl -s https://padhard.heygabi.ai/api/health   # {"gabi":{"panel":true}}
curl -s https://library.heygabi.ai/api/health   # the other deep-link target
# the prefill contract, read off the LIVE bundle rather than trusted:
curl -s https://library.heygabi.ai/assets/index-rvJiy8K2.js | grep -o '="gabi",[A-Za-z0-9$_]*=500'
```

⚠️ `gabi_surface` reading anything but `propose_and_deep_link` means somebody
answered the token-custody question, which is a decision worth finding in one
curl rather than in a diff.

### 10.5 ⚠️ NOT VERIFIED LIVE

- **`/gabi` has never been invoked from Discord** — the commands are not
  published (§4). The index hop WAS exercised live this deploy
  (`GET /api/search?q=dungeon born&source=audiobook` → 200, real rows), and so
  was the deep-link target (`padhard.heygabi.ai` → 200,
  `gabi.panel: true`). What is unproven is the render inside a real Discord
  client and whether the term reduction behaves well on real questions.
- **Nobody has followed the deep link from Discord**, so the hand-off
  experience — arrive, sign in, find the speech-bubble button, paste — has
  never been walked end to end by a person.
- **Whether anyone besides Samantha can open the panel.** Her instance's
  `ESTATE_DEFAULT_ROLE` is unset, so estate auto-grant hands out `member`, and
  `member` does not hold `runResearch`. The honest expectation is that a
  linked stranger following the link sees the library **without** the panel —
  which is what the wording promises, but it has not been observed.

---

## 11. GABI answers when you @mention her — phase A (built 2026-08-17, OFF)

Design: [`../info/discord-bot-design.md` §6](../info/discord-bot-design.md).
Code: `src/mentions.ts`, `src/mention-flow.ts`, `src/gabi-chat.ts`,
`src/gateway.ts`. Live at version `fa8140f6-da59-4f0d-b918-0f6a6f7777a7`.

> ⚠️ **WIDENED 2026-08-17 by the continuity layer — read [§12](#12-she-remembers-the-continuity-layer-built-2026-08-17-off) too.**
> She now also answers a **reply** to one of her own messages (ping left on) and
> **any direct message**, and she **remembers the last half hour**. Everything
> in §11 still applies; §12 adds what changed.

### 11.1 What a person gets

They type, in any channel the bot can see:

```
@GABI do we have Mistborn?
```

and she replies **in that channel, as a reply to their message**, addressing
them: *"Hey @Sam — I looked on the estate's public shelf for **Mistborn**. …"*

The greeting forms the owner asked for all work **as long as the `@` is there**:
`@GABI heygabi …`, `hey @GABI, …`, `@GABI Gabi: …` — the greeting is stripped
from the question rather than searched for.

⚠️ **A bare `heygabi …` with no `@` does nothing, on purpose.** Reading messages
she was not addressed in needs Discord's Message Content privileged intent,
which the design has refused since §1.5. Turning that on is an owner decision
with a materially wider privacy posture, not a config change.

### 11.2 ⚠️ Switching it on — THREE steps, in this order

Nothing happens until all three. She is currently **not connected at all**,
which is different from connected-and-quiet.

1. **The Anthropic key** (optional; it is the difference between a lookup bot
   and a conversation). Mint a **NEW** key at `console.anthropic.com` — ⚠️ *not*
   the library's `ANTHROPIC_API_KEY`, so the Discord spend is separately capped,
   rotated and audited. Then, from `apps/discord-worker/`:

   ```bash
   # paste the value after ANTHROPIC_API_KEY_GABI= in .dev.vars (gitignored),
   # then pipe it in WITHOUT printing it, then blank the line again:
   wrangler secret put ANTHROPIC_API_KEY_GABI
   ```

   Confirm with `curl -s https://discord.heygabi.ai/api/health` →
   `configured.anthropic_key_gabi: true`.

2. **The posture.** `GABI_MENTIONS = "on"` in `wrangler.toml`, then
   `npx wrangler deploy`. ⚠️ Owner's decision, never an agent's, never a side
   effect of a deploy. Confirm: `gabi_mentions_enabled: true` on `/api/health`.

3. **Start the gateway** — with an estate admin's Firebase ID token:

   ```bash
   curl -s -X POST https://discord.heygabi.ai/admin/gateway/start \
     -H "Authorization: Bearer <estate admin Firebase ID token>"
   ```

   ⚠️ **This is the ONLY starter.** The cron that was meant to be a second,
   independent poker could not be installed — see §11.5 — so nothing else
   creates the object, and there is no backstop if its alarm chain breaks. The
   response is the object's own status (`connected`, `has_session`, `fatal`,
   `identifies_today`).

**Then test it, in the server, as a person:**

```
@GABI do we have Mistborn?
@GABI what can you actually do from here?
@GABI can you fix the author on Mistborn?
```

Expected: a shelf answer; a short chat reply that admits she cannot change
anything from Discord; and a propose-and-deep-link reply carrying
`padhard.heygabi.ai`. With no Anthropic key set, the middle one degrades to a
worded template — ⚠️ and in **no** case should a channel ever see the words
"API key", "not configured" or a bare status.

### 11.3 Turning it off

Set `GABI_MENTIONS = "off"` and deploy — the object's next alarm disconnects and
stands down. To stop it immediately without a deploy, `POST /stop` is not
exposed publicly; use the posture flip, or `npx wrangler tail estate-discord` to
confirm the stand-down line.

### 11.4 The rails, so nobody has to read the code

| Rail | Value |
|---|---|
| Trigger | a genuine `@` mention **only** — not `@everyone`, not a role, not a reply |
| Intents | `GUILDS \| GUILD_MESSAGES` = 513, both **unprivileged** |
| Per-user cap | 20 answered mentions per rolling hour |
| Estate-wide cap | 200 answered mentions per UTC day |
| Model | `claude-haiku-4-5-20251001`, pinned |
| Subrequests per mention | at most 4 (classify, lookup, converse, reply) |
| Writes | **none.** No Firestore, no catalogue, no moderation, no admin |
| Reconnect ceiling | 400 IDENTIFYs per UTC day, then it stands down |

A capped person is still **replied to**, in words that say it is GABI's cap and
not something they did.

### 11.5 ⚠️ "The fix didn't take effect" — the two things that will bite

**She is silent after the posture flip.** Almost always step 3: the object has
never been created. There is **no cron** on this Worker — the deploy that added
one was refused with *"This account has reached the Workers Free limit of 5 cron
triggers per account"*, and the `[triggers]` block was removed rather than left
half-applying (a wrangler.toml that cannot fully apply makes **every** future
deploy exit with a partial-failure banner). POST the start route.

**She went silent after working.** Check `fatal` on the start route's response.
Close codes 4004 (bad token) and 4014 (unapproved intent) set a fatal flag and
**deliberately stop the reconnect loop** — a bad token will not fix itself and
hammering identify burns Discord's daily session-start budget. Fix the cause,
then POST the start route to clear it. `npx wrangler tail estate-discord` shows
the worded line naming which.

### 11.6 ⚠️ Cost — the constraint is a cap, not a bill

This account is on **Workers Free** (measured at deploy, see above). An outbound
WebSocket **cannot hibernate**, so the object accrues duration the whole time it
is connected: **~10,800 GB-s/day against a free allowance of 13,000 GB-s/day.**

**$0.00/month — and about 83% of a cap that STOPS the object rather than billing
for it.** ⚠️ Two things would eat the remaining ~17% and both should be treated
as blocking: **a second always-on Durable Object anywhere on this Cloudflare
account**, and any reconnect pattern leaving two sockets briefly overlapping.
Workers Paid removes the constraint entirely (400,000 GB-s/month included,
~$4.05/month if ever billed at the full rate). Model spend is separate, capped,
and logged as `gabi_turn` lines visible in `wrangler tail`.

### 11.7 ⚠️ NOT VERIFIED LIVE

- **Nothing in this build has ever talked to Discord's gateway.** No READY
  handshake has been observed. The protocol handling — IDENTIFY, HELLO,
  heartbeat jitter, RESUME, the close-code table — is written from Discord's
  documentation and is entirely unexercised. The local `.dev.vars` drop-box is
  correctly blank, so no agent holds the bot token to test with.
- **The claim that mention content arrives without the privileged intent is a
  documentation reading, not an observation.** If it is wrong, the symptom is
  GABI silently ignoring every mention.
- **No real @mention has been answered**, so the persona, the wording, the caps
  and the reply rendering in a real client are all unproven.
- **No model call has ever been made on this surface** — the cents figures are
  arithmetic over the published price table, not an invoice.
- ⚠️ **NO LIVE GROQ CALL HAS EVER BEEN MADE FROM THIS REPO** (2026-09-01).
  The first-line rung in §11.8 is exercised only by tests with an injected
  `fetch`. Whether Groq accepts the body, whether `llama-3.3-70b-versatile` is
  still a live model id, and whether the answers are good enough are all
  unknown — which is exactly what §11.8's shadow step is for.

### 11.8 The Groq first line — turning it on, in three owner steps

*Built + deployed 2026-09-01, SHIPPING DARK. Design of record:
[`info/gabi-groq-rung.md`](../info/gabi-groq-rung.md). Owner:* "we just used
groq in a different project, lets integrate that into our gabi model as a first
line before going to haiku tokens."

A cheap, fast attempt in **front** of Haiku on the four TOOLLESS calls
(classification, small talk, the memory distillation, the T2 fix parse). Any
failure falls through to the Haiku call unchanged and ⚠️ **the person cannot tell
it happened.** A tool-loop turn stays on Anthropic in every posture.

**Step 1 — the key.** Mint a **NEW** key at `console.groq.com` (⚠️ not an
Anthropic key, and not the other project's). Paste it into
`apps/discord-worker/.dev.vars` after `GROQ_API_KEY_GABI=` — into the FILE, with
an editor, never onto a terminal line where it lands in history. Then, from the
repo root:

```bash
node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI
```

⚠️ **Use the script, never a PowerShell pipe.** A pipe prepends an invisible
UTF-8 BOM and the stored key then fails as a plain 401 while looking perfect
(§7 — this Worker's own incident). The script prints the byte facts, never the
value; pushes raw bytes to `wrangler`'s stdin; and blanks the `.dev.vars` line
afterwards. Confirm:

```bash
curl -s https://discord.heygabi.ai/api/health | jq '.configured.groq_key_gabi'   # true
```

**Step 2 — SHADOW first.** In `apps/discord-worker/wrangler.toml` set
`GABI_GROQ = "shadow"`, then `npx wrangler deploy` from `apps/discord-worker/`.
Nothing a person sees changes: Groq is called *beside* Haiku and **Haiku's
answer is used**. @mention GABI a few times, then read the comparison:

```bash
npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq_shadow")'
```

Each line carries `groq_ms` / `haiku_ms`, `groq_chars` / `haiku_chars`,
`groq_answered` / `haiku_answered`, a `reason` when it did not answer, and —
on `classify` and `parse_fix` only — `agreed`. ⚠️ **The texts are never
logged**; these are household conversations.

Look for: `agreed: true` on nearly every `classify` line, `groq_answered: true`
on nearly all of them, and `groq_ms` genuinely below `haiku_ms`. A wall of
`reason: "refused"` with `status: 401` is a **BOM'd key** — redo step 1.
`status: 400` with a decommission message means the pinned model was retired;
that is a one-constant change in `src/gabi-groq.ts`.

**Step 3 — flip `first`.** `GABI_GROQ = "first"` and deploy. Now a toolless call
tries Groq once and falls through on any failure. Watch:

```bash
npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq")'
```

`outcome: "groq"` is a turn that cost no Haiku tokens. `outcome: "fallback"` is
**the ladder working**, not an incident — the incident shape is a *sustained*
run of them, which means the rung is buying nothing while costing up to 4 s a
turn.

**Backing it out is one line:** `GABI_GROQ = "off"` and deploy. Deleting the
secret works too and needs no deploy — either half alone disables the rung.

⚠️ **Prose quality cannot be read off the shadow lines** (they carry lengths,
never text). `converse` is the call where the owner has to actually talk to her
after flipping `first` — knowing a bad turn is one posture flip from undone.

### 11.9 The TOOL LOOP on Groq — phase 2 (shipped 2026-09-02), and what to watch

*Design of record: [`info/gabi-groq-rung.md` §8](../info/gabi-groq-rung.md).*
Since `7d9a9b3` a **tool-using** turn rides Groq first too — which matters
because the tool loop is where most of the Anthropic tokens go.

**Nothing new to set.** It runs under the same `GABI_GROQ = "first"` you already
flipped. Three conditions, all required, and a loop that fails any of them is
100% Anthropic:

1. the posture is exactly **`first`** — ⚠️ a tool loop is **never shadowed**,
   because shadowing it would run the loop twice and **execute every tool
   twice**, against live estate services;
2. a key exists;
3. **every** tool offered on that turn is on the read-only allowlist —
   `curl -s https://discord.heygabi.ai/api/health | jq '.gabi_groq_tool_allowlist'`
   (13 names today, all reads).

**What to watch, and it is a different line from §11.8's:**

```bash
npx wrangler tail estate-discord --format json \
  | jq 'select(.evt=="gabi_groq" and .purpose=="converse_tools")'
```

| What you see | What it means |
|---|---|
| `outcome: "groq"` with `iteration` climbing 1, 2, 3 | the loop is running on Groq. ⚠️ **A `converse_tools` turn with these lines and NO `gabi_turn` line cost nothing at Anthropic** — that is the savings, measured rather than assumed |
| `outcome: "fallback"`, `reason: "invalid"` | ⚠️ **the interesting one.** The model IS calling tools but not in a shape the estate accepts (a tool it was not offered, arguments that miss a required field). That pass is replayed on Haiku and the person cannot tell; a *run* of them means the rung is buying nothing on tool turns |
| `outcome: "fallback"`, `reason: "timeout"`/`"rate_limited"`/`"refused"` | as §6 of the design doc — same taxonomy as the toolless rung |
| `outcome: "ineligible"`, `ineligible_reason: "posture_shadow"` | you are on `shadow`; tool loops do not shadow. Expected, not a fault |
| `outcome: "ineligible"`, `ineligible_reason: "tool_not_allowlisted"` with `blocked_tools` | a tool was offered that nobody put on the allowlist. Deliberate default: a new tool is NOT eligible until someone says so in `gabi-tools.ts` |

**Backing out phase 2 alone, without giving up the toolless savings:** delete a
name from `GROQ_READ_ONLY_TOOL_NAMES` in `apps/discord-worker/src/gabi-tools.ts`
and deploy — every loop that offers it goes back to Anthropic whole. Backing out
everything is still `GABI_GROQ = "off"`.

### 11.9a 🔴 THE FIRST LIVE TEST REFUSED EVERY PASS — 413, and it is the TIER

**Measured 2026-09-02, the morning after phase 2 shipped.** Every 12-tool pass
came back `HTTP 413` in ~37 ms. A 6-tool pass at 4,736 input tokens rode Groq;
the next pass, with the tool results appended, refused.

**It is not a bug.** Groq allows `openai/gpt-oss-120b` **8,000 tokens per
minute** on the **free** plan and refuses a single request bigger than the whole
minute's allowance outright. The request measured **~7,960 tokens before the
question** — system prompt 2,817 + 13 tool schemas 4,119 + `max_tokens` 1,024.

**What changed in the code** (`0247cc3`; arithmetic in
[`info/gabi-groq-rung.md` §11](../info/gabi-groq-rung.md)):

- **lean tool schemas for Groq only** — 16,474 b → 7,522 b, **54% off**; the
  full 13-tool request now fits with ~1,500 tokens to spare;
- **tool results capped at 2,000 chars with an explicit marker** — never a
  silent truncation, which would read to the model as an absence;
- **family narrowing** from the second pass on;
- a **pre-flight** — a request that still does not fit is never sent, and the
  line carries `estimated_tokens` and `token_budget`.

⚠️ **AND THE LANE IS NOW A HYBRID: Groq CHOOSES the tools, Haiku SPEAKS.**
The one answer that fully rode Groq was flat and answered a different question
than the one asked; and the composing pass is the one that 413s, because it
carries every tool result. So the selection pass rides Groq and every pass from
the first tool result onward is Haiku's. `/api/health`'s `gabi_groq_scope` says
so: `toolless_calls_plus_tool_selection_pass_first_only`.

🔴 **HALF OF THIS IS AN OWNER DECISION.** The code can shrink the request; it
cannot raise the tier. **Upgrading the Groq plan turns every mitigation above
into headroom** — tracked in [`../TODO.md`](../TODO.md). Nothing breaks if he
does not: the ladder falls back to Haiku and the person cannot tell.

Two new health rows answer *"is the bot small enough for the plan we are on?"*
in one curl:

```bash
curl -s https://discord.heygabi.ai/api/health \
  | jq '{scope: .gabi_groq_scope, tpm: .gabi_groq_tpm_limit,
         budget: .gabi_groq_request_budget_tokens}'
```

⚠️ **NOT VERIFIED as of 2026-09-02 evening:** no live Groq tool call has ever
**succeeded** — every attempt so far was refused before the model saw it.
Whether an open-weights model calls these tools *accurately* is still the real
question, it cannot be answered from a shadow, and the next tool-bearing
@mention is still the first real test.


---

## 12. She remembers — the continuity layer (built 2026-08-17, OFF)

Design: [`../info/discord-bot-design.md` §7](../info/discord-bot-design.md) and
the store shape in
[`../info/gabi-conversation-continuity.md`](../info/gabi-conversation-continuity.md).
Code: `src/conversation.ts`, `src/conversation-flow.ts`, plus the same four
files §11 lists.

Owner's ask, verbatim: *"I don't want to message GABI and then message her again
and she has no recollection."*

⚠️ **It ships behind the SAME switch.** `GABI_MENTIONS` is still `"off"`, so none
of this is live and §11.2's three steps are still the way to turn it on. There is
no second switch to find.

### 12.1 The four ways to reach her

| You do this | She hears it |
|---|---|
| `@GABI …` in a channel — **the USER mention** | ✅ as before — ⚠️ but see 12.2a: the ROLE looks identical in the picker and is invisible |
| **Reply** to one of her messages, **ping left ON** | ✅ **new** |
| Reply to one of her messages, **ping switched OFF** | ❌ **invisible — see 12.2** |
| Reply to a `/have` or `/gabi` **slash-command answer** | ❌ **Discord excludes it — see 12.2** |
| **Direct message** her — no `@` needed | ✅ **new** |
| Press a button / menu she attached | ✅ **new** |
| `heygabi …` bare text, no `@`, in a channel | ❌ still an owner decision (§11.1) |

### 12.2 ⚠️ THE ONE THING TO TELL PEOPLE: keep the ping on when you reply

Discord's own rule, quoted from
<https://docs.discord.com/developers/gateway/you-might-not-need-a-privileged-intent>
(read 2026-08-17), on what an app can read **without** the Message Content
privileged intent:

> **Replies to your app's messages.** Note: this applies to replies sent using
> Discord's reply feature to a regular bot message (not an interaction response)
> and the user has **"ping on reply" enabled**. It does not apply to replies to
> slash command responses.

So:

- **Ping ON** (the default — the `@ON` toggle above the message box stays lit):
  she gets your text and answers.
- **Ping OFF**: Discord sends her **nothing at all**. Not a blank message — no
  event. ⚠️ **She cannot know it happened**, so she cannot say "sorry, I missed
  that". From your side it looks exactly like a bug, and from hers there is
  nothing to look at.
- **Replying to a slash-command answer** (`/have`, `/gabi`) never works, ping or
  not. Discord excludes interaction responses explicitly. Use an `@` or a DM.

If somebody reports "I replied and she ignored me", this is the first thing to
check, and it is a client setting, not a deploy.

### 12.2a ⚠️ Mentioning her ROLE is invisible — and it looks exactly like mentioning her (incident 2026-09-01)

`mentions.ts` requires **her user id in the message's `mentions` array**
(`mentionTrigger`, ~line 452); a mention of a **role** she holds lands in
`mention_roles` and is **ignored on purpose** (the file's own comment, ~line 65
— same class as `@everyone`: a bot that answered every role ping would be a
menace). The trap: Discord's @-autocomplete offers the integration role and
the bot user as two identically-rendered "GABI" entries, and a message built
from the ROLE entry looks byte-identical on screen while delivering no event
her handler accepts.

**Measured 2026-09-01:** the owner @'d her in the standing test channel — a
channel she had answered in before — and got silence, while a DM (no role
ambiguity possible) answered normally. Health was green throughout; nothing
was down. The chase started at permissions and ended at the picker.

**The fix is a naming convention, not code** (owner, same day): the
integration role is renamed **`role_gabi_bot`** — ✅ **done and verified
2026-09-01 ~15:20 Phoenix** via the web UI (⚠️ useful fact: a managed
integration role's "cannot be assigned" lock does NOT lock its NAME — the
rename saved normally), and the root cause was then proven from the channel
history itself: the failed 2:59 PM message renders as `@role_gabi_bot …`
while the answered 3:07 PM retry renders `@GABI …`. The picker now shows the
two entries unmistakably — so the picker's two entries
can no longer be confused — `@GABI` is always the user, `@role_gabi_bot` is
visibly not a way to talk to her. ⚠️ If a future server or re-invite recreates
a role named like the bot, apply the same rename before anyone tests
mentions. The role-mention door stays closed by design; do not "fix" this by
answering `mention_roles`.

If somebody reports "I @'d her and she ignored me" in a channel she can see:
ask which autocomplete entry they picked, before anything else.

### 12.3 What she remembers, and for how long

| | |
|---|---|
| Window | **30 minutes** from the last thing said, sliding |
| Depth | **last ~10 exchanges** (20 turns) |
| Scope | per **person**, per **channel** — a DM is its own conversation |
| Then | **deleted.** Not archived, not flagged expired — gone |

⚠️ Two people talking to her in the same channel have **separate** memories, and
the same person in two channels has two. Nothing bleeds.

She **greets you by name on the first message only**. A second message in the
same conversation gets a straight answer, and a DM is never greeted by ping —
that is deliberate, not a lost greeting.

### 12.4 When she does not know which book you meant

A lookup matching several books now comes back with a **dropdown** of the
closest few plus a **"None of these — let me type it"** button, which opens a
small text box. Picking a row, or typing into the box, continues the **same**
conversation.

⚠️ **Anybody in the channel can physically click that menu**, because Discord
components are public. Somebody who was not the asker gets a worded *"I can't
pick that up — either that question was for whoever asked it, or the
conversation has moved on"*. Nothing leaks and nothing is answered.

⚠️ The menu **expires after 15 minutes**, sooner than the conversation itself: a
dropdown sitting in a channel for hours describes a search nobody remembers
running.

### 12.5 ⚠️ The exact script to try once she is lit

Do these **in order, in one channel**, then the DM. Every line is what to type;
the italics are what should come back.

1. **`@GABI do we have Mistborn?`**
   → *"Hey @you — I looked on the estate's public shelf for **Mistborn**…"*,
   posted **as a reply to your message**, and — if more than one Mistborn book
   is catalogued — with a **dropdown** underneath.
2. **Pick a row from the dropdown.**
   → a new message naming **that** book. The dropdown's question is now answered,
   and pressing it again says so.
3. **Reply to her last message** (hit reply, **leave the ping on**) with
   **`what else did they write?`**
   → she answers **without** being asked who "they" is. ⚠️ **This is the whole
   feature.** If she asks "who?", the memory is not working — check `wrangler
   tail` for a `gabi_turn` line with `history_turns: 0`.
4. **Reply again, ping ON: `and the first one — is it on audio?`**
   → still in context, still no `@`.
5. **Now reply with the ping switched OFF.**
   → ⚠️ **nothing happens, and that is correct** (§12.2). This step exists so the
   limitation is seen once deliberately rather than discovered later in
   confusion.
6. **Wait 31 minutes, then reply again (ping on): `what about that one?`**
   → she does **not** know. The window closed and the record was deleted. Also
   correct, also worth seeing once.
7. **Open a DM with GABI and type `hi`** — no `@`, no command.
   → she answers. ⚠️ If she does not, the `DIRECT_MESSAGES` intent did not take:
   check `/api/health` reports `gabi_gateway_intents: 4609`, then re-POST
   `/admin/gateway/start`.
8. **In the DM: `do we have anything by Sanderson?`** then **`which of those is
   shortest?`**
   → the second answers in context, with no mention anywhere.

Check afterwards with `npx wrangler tail estate-discord`: each answered turn
logs one `gabi_turn` JSON line carrying `via` (`mention` / `reply` / `dm` /
`component`), `history_turns` and `history_chars` beside the raw token counts.
⚠️ It logs **how much** was remembered, never **what** — no message text reaches
the log.

### 12.6 What can be checked without Discord

```bash
curl -s https://discord.heygabi.ai/api/health | jq
```

| Row | Expected |
|---|---|
| `features` | contains `gabi_continuity` |
| `gabi_mentions_trigger` | `at_mention_reply_or_dm` |
| `gabi_gateway_intents` | **4609** (= GUILDS 1 + GUILD_MESSAGES 512 + DIRECT_MESSAGES 4096) |
| `gabi_mentions_privileged_intent` | **false**, always |
| `gabi_memory_window_minutes` | 30 |
| `gabi_memory_max_exchanges` | 10 |
| `gabi_memory_store` | `gateway_durable_object_storage` |
| `gabi_mentions_enabled` | `false` until the owner flips it |

⚠️ **`gabi_gateway_intents` must never contain 32768** (`1 << 15`,
`MESSAGE_CONTENT`). `4609 & 32768 == 0`. If it ever does, somebody requested the
privileged intent and that is a decision, not a bug fix.

The **must-not-regress** check is unchanged and still the important one:

```bash
curl -s -o NUL -w "%{http_code}\n" -X POST https://discord.heygabi.ai/interactions \
  -H "content-type: application/json" -d "{\"type\":1}"          # expect 401
```

⚠️ Use `-o NUL`, not `-o /dev/null` — see §7's gotcha about Git Bash returning
exit 43 / status 000 on the latter.

The gateway's own view, which now reports the memory too (estate admin bearer):

```bash
curl -s -X POST https://discord.heygabi.ai/admin/gateway/start \
  -H "Authorization: Bearer $ID_TOKEN" | jq .gateway
```

`conversations_held` is a **count** — never a key, never a word anybody said.

### 12.7 Cost, and why nothing new was added to the account

⚠️ **No second Durable Object, no D1 binding, no Firestore collection, no cron.**
The transcript lives in `conv:` rows inside the gateway object that already
existed, precisely because §11.6 names a second always-on object as blocking.

**One row write per answered turn**, and answered turns are already fused at 200
a day estate-wide. Worst case **≤400 extra row writes/day** on top of the
heartbeat's ~2,100 — about **2.5%** of the free plan's 100,000/day. Loads write
nothing at all.

⚠️ Model spend grows with the conversation, and that is the real cost: context
tokens are charged **every** turn. It is bounded by the 20-turn × 600-character
clip — a full window is ≈3k input tokens, roughly **0.3¢** at Haiku 4.5's rate —
and it is **measured**, via `history_turns` / `history_chars` on every accounting
line.

⚠️ **The plan changed under this section.** `docs/TODO.md` records the owner
upgrading to **Workers Paid on 2026-08-17**, which lifts the duration pressure
§11.6 describes and raises the cron limit. That is the repo's dated record, not
something this build measured, and nothing here was re-architected to spend the
new headroom — the arithmetic above is deliberately priced against the tighter
free-plan ceiling, because a bound proven under the stricter limit is still a
bound.

### 12.8 ⚠️ NOT VERIFIED LIVE

§11.7 stands in full and is extended:

- **No real reply, DM, button press or modal submit has ever been handled.** The
  memory, the doors, the components and the modal are exercised only by tests.
- **The content-exception list in §12.2 is a documentation READING, not an
  observation.** If Discord's list narrows, the symptom is her silently ignoring
  replies or DMs.
- **The `DIRECT_MESSAGES` intent has never been sent in a real `IDENTIFY`.** If
  it were privileged after all, the symptom is close code **4014**, which the
  gateway already treats as fatal rather than retrying — she would go silent
  loudly, not quietly.
- **No model call has ever been made on this surface**, so no real
  `history_turns` count has been observed and the cents figures remain
  arithmetic over the published price table.
- **The Workers Paid upgrade is `docs/TODO.md`'s record, not a measurement taken
  here.**

## 13. ⚠️ TIER 1 — she can now WRITE (built + deployed 2026-08-18)

Owner ask 2026-08-17: *"Can I dm her an isbn or a photo and she adds it to the
catalog?"* and *"Hey Gabi, fix all my missing details… Hey @Sam i went ahead and
fixed all your missing stuff."* Approved as Tier 1 of the T0–T4 ladder (*"that
looks good, start with that"*, then *"all of it"*). Design of record:
[`../info/gabi-application-map.md` §2a–2d](../info/gabi-application-map.md).

### 13.1 What she can do, and what she cannot

| She can | She cannot |
|---|---|
| add a book from a **checksummed ISBN** you DM her | change any value already recorded (T2 — needs a confirm lane that does not exist) |
| run a catalog's **missing-details sweep**, attributed to you | answer the four-way rescan question or the pre-order question — she hands both back with **nothing written** |
| tell you which catalogs you may do that on | grant, revoke, approve, deploy, moderate or touch a role (T4 — a wall) |

### 13.2 The one lever, and the one secret

| Thing | Value | Effect |
|---|---|---|
| `GABI_DELEGATED_WRITES` (var, `wrangler.toml`) | `"on"` | affirmative-only. **Anything else means OFF**, and OFF means no write, no site call, no credential read — but she still *says so* rather than searching the shelf for a barcode |
| `ESTATE_APP_TOKEN_DISCORD` (secret, §2) | set | unset ⇒ she answers *"I'm not wired up to write to the catalogs yet"* and every read-only answer is unchanged |

**Turning it off is one line** in `wrangler.toml` plus a deploy. Nothing else
changes; the read-only ladder is untouched either way.

### 13.3 The security shape, in one paragraph

GABI holds **no permissions**. She asserts an *identity* — the
`discord_links/{id}` document the person created through their own Discord OAuth
**and** their own Firebase sign-in — and the **destination catalog** checks that
person's real stored role (`editCatalog` to add, `runResearch` to sweep, the
same capability the equivalent button needs) before anything happens. Two
independent facts must both be true: the caller is the bot, and the asker holds
the capability. Every refusal is the destination's own worded sentence, relayed
verbatim, because it is the only thing that can honestly say which of the four
causes applies.

### 13.4 The owner's live test — the exact messages to send

DM **GABI** (no `@` needed in a DM), one at a time:

1. `9780765311788` — a real ISBN (Mistborn, Tor). Expect either *"Added
   **Mistborn**…"*, or *"That barcode is already on library.heygabi.ai"*, or the
   deliberate refusal explaining that the book is there but the barcode is not
   on any of its printings and she will not guess which of four things you mean.
2. `9780765311789` — the same ISBN with **one digit changed**. Expect her to
   ignore it as an ISBN entirely (it fails its check digit) and answer as an
   ordinary message. That refusal is the feature.
3. `fix all my missing details` — expect *"On it — I'll report back"* within a
   second or two, then a **second message a minute or two later** that pings you
   and says what was filled **and what could not be**.

If you hold a role on **both** catalogs, steps 1 and 3 will first ask *"Which
catalog?"* with a two-row select menu. Pressing a row is what performs the
write; walking away writes nothing and the question ages out in fifteen minutes.

🔗 Where to see the result:
- <https://library.heygabi.ai/> — the book's own page, and its **Changes** panel
  (the rows say `gabi-discord`)
- <https://library.heygabi.ai/research> — the details queue's **auto-applied**
  list, where a sweep is undone in one tap
- <https://padhard.heygabi.ai/> — the same two, on the other shelf

### 13.5 Caps

| Fuse | Limit | Why it is separate |
|---|---|---|
| turns | 20/person/hour, 200/day estate-wide | a model turn is a fraction of a cent, forgiven in an hour |
| **writes** | **20/person/UTC day** | a write is a row in somebody's catalog plus ~2¢ of research on their key — an hour does not undo it |

The write fuse is checked **before** the link read and before any site is
dialled, and it counts every call that reached a destination, refusals included.

### 13.6 ⚠️ NOT VERIFIED LIVE

- **No real Discord DM has ever driven this end to end.** The bearer pairing IS
  verified (a real authenticated call to both library instances, 2026-08-18);
  what has not happened is a person sending GABI an ISBN and a book appearing.
  That needs the owner and a Discord client — see §13.4.
- **No book has been added by this path**, so no `change_log` row wearing
  `gabi-discord` exists yet in production. Until one does, the provenance claim
  is a design, not an observation.
- **No sweep has been triggered through it**, so the async follow-up message has
  never been posted by a real gateway.
- **Photo intake is not built** — measured and deferred, application map §2d.


## 14. GABI's book-club QUESTIONS in Discord (built 2026-08-18)

*(Numbered 14 for the same reason §8 and §9 are numbered as they are:
`DONE.md` is append-only, so sections are only ever appended.)*

The owner's ask, verbatim: *"you know how for bookclub gabi can post questions
in each book club? lets add that feature to the discord bot."*

### 14.1 ⚠️ What the site feature actually is — the measurement that decided everything

It is **not a poll**, and getting that backwards would have built the wrong
thing. Measured 2026-08-18 against `audiobook_catalog/site/club-read.html` and
`site/club-reads.js`:

| | |
|---|---|
| Where the questions come from | `site/discussion_prompts.json` — `{ "<Book Title>": { prompts: [{ chapter_index, question }] } }`, written offline by `app/tools/generate_prompts.py`. A static site asset; nothing per-club, nothing live. |
| Who sees them | Hosts/mods only, on the read page, one per section, while `club.promptsEnabled !== false` (`starterQuestionHtml()`). |
| The trigger | **A human presses "Post as GABI".** There is no automatic posting anywhere, then or now. |
| What that writes | `addComment(..., { asBot: true })` → an ORDINARY COMMENT at `clubs/{id}/reads/{readId}/comments/{commentId}` with `isBot: true`, `slug: 'gabi'`, `displayName: 'GABI'`, the section's `milestoneId` (or `'general'` + `partIndex`), and the question as `text`. |

So they are **open discussion prompts, not votable polls**. That is why the
Discord message carries **no buttons** and why there is **nothing to sync
back**: a poll has a vote that belongs in Firestore; a discussion question's
replies are Discord's own conversation. This is a one-way publisher.

### 14.2 What runs, and who starts it

| | |
|---|---|
| Endpoint | `POST https://discord.heygabi.ai/questions/sync` |
| Auth | `Authorization: Bearer <POLL_SYNC_TOKEN>` — the **same** shared secret as §8, no new credential |
| Body | `{"lane":"prod"}` or `{"lane":"dev"}` (absent = prod) |
| Trigger | `audiobook_catalog/app/club_announcements.py` → `sync_question_messages()`, on the existing ~8h pipeline cadence, immediately after the poll poke |
| Code | `apps/discord-worker/src/question-sync.ts` |
| Override URL | `DISCORD_QUESTION_SYNC_URL` in the pipeline env (sibling of `DISCORD_POLL_SYNC_URL`) |

⚠️ **A SEPARATE ROUTE from `/polls/sync`, deliberately.** They share a cadence
and a token and nothing else: a question sweep that fails must never take the
poll tick's tallies down with it. Both pokes catch everything, log one line and
return; neither can fail a pipeline run, and neither can fail the other
(exercised in both directions by `tests/test_club_announcements.py`).

By hand:

```bash
curl -s -X POST https://discord.heygabi.ai/questions/sync \
  -H "Authorization: Bearer $POLL_SYNC_TOKEN" \
  -H 'content-type: application/json' -d '{"lane":"dev"}'
```

### 14.3 What one tick does, per opted-in club

1. **Opt-in check** — `features.discordQuestions === true` on the club doc.
   Absent, `false`, or a non-boolean all mean OFF. A club that never opted in
   makes no note; it is the normal case, not an event.
2. ⚠️ **Baseline check, BEFORE anything else.** A club with no baseline doc is
   new to this feature: the tick records `baselinedAt = now`, **posts nothing
   at all**, says so in words, and returns. See §14.5 — this is the rail that
   makes the feature switchable-on.
3. **Active reads only** (`status === 'active'`). The site caps a club at two.
   A question posted onto a finished read stays on the site.
4. **GABI's comments only** (`isBot: true`). A member's comment is never
   republished — that would be broadcasting somebody's words without consent.
5. Anything created **at or before** the baseline is history and is skipped.
   Anything already carrying a record is skipped. The rest go out oldest-first
   across every read, capped at **5 per tick** (the remainder is *said*, never
   dropped).
6. Each post writes its record **immediately**, before the next post, so a tick
   killed halfway leaves every message it sent recorded.

### 14.4 What a posted question looks like

An embed, no components:

> **Lessons in Chemistry — Part 2**
>
> *(blockquoted)* How does Garmus use the 1950s lab to critique institutional barriers?
>
> Something to chew on for Part 2. Say it here if you like — or [take it to the
> club page](https://audiobooks.heygabi.ai/club-read.html?club=…&read=…#c-…),
> where it sits with the rest of the discussion.
>
> *Night Watch · a question from GABI*

- ⚠️ **No model call, and that is a decision.** The question text is already
  written and a human already chose it; paraphrasing it would spend money to
  make the club page and the channel say different things. GABI's voice here is
  the **frame** around a question she already asked, rendered deterministically
  so it is testable and free.
- **The deep link lands on the QUESTION**, not the page: `club-read.html` reads
  `#c-<commentId>`, finds that comment, opens its section and scrolls to it
  (measured 2026-08-18). Dev-lane clubs link into `/dev/`.
- **Spoilers**: the section is named in the **title**, prominently, so anyone
  behind can skip the message — and the question is **not** hidden behind
  spoiler bars. That matches the site's own posture for *comments* (collapsed
  under a heading, never locked); the site locks **polls** by reading position
  (`isPollLocked`) and deliberately does not lock discussion comments. A channel
  cannot gate per-reader anyway, so the honest option is to label loudly rather
  than imply a protection that is not there. **If the owner wants spoiler bars,
  this is the line to change** — one `||…||` wrap in `buildQuestionMessage`.
- A section that cannot be named honestly (a chapter-grouped read whose label
  the site derives client-side) **drops out of the title** rather than
  appearing as something wrong.

### 14.5 ⚠️ Baseline-first silence — read this before switching a club on

A club accumulates a GABI question **per section per book**. If the first tick
posted them, a club switching this on would get a wall of history and would
switch it straight back off.

So the **first tick a club is ever seen on posts NOTHING** and records the
instant in `discord_question_state/{clubCol}__{clubId}`. Only questions created
**after** that instant are ever posted — the same discipline
`club_announcements.py` already uses for its own first run.

**What that means in practice:** switching it on is quiet. Nothing appears
until somebody presses "Post as GABI" again — which is the right moment for a
question to arrive in a channel anyway. An opted-out club is not even
baselined, so it gets its baseline on the tick it actually opts in, however
long it was off.

### 14.6 State — two collections this Worker owns outright

```
discord_question_messages/{clubCol}__{clubId}__{readId}__{commentId}
  { clubCol, clubId, readId, commentId, channelId, messageId, postedAt, updatedAt }

discord_question_state/{clubCol}__{clubId}
  { clubCol, clubId, baselinedAt (epoch ms), updatedAt }
```

- **Not beside the club**, for `poll-sync.ts`'s reason: a comment doc is
  browser-writable under `firestore.rules`, and Worker bookkeeping inside a doc
  a browser can rewrite is a collision waiting to happen.
- **No rules change needed.** `firestore.rules` has no catch-all, so browsers
  are denied by default; the service account bypasses rules. Same posture as
  `discord_links/*` and `discord_poll_messages/*`.
- **Composite keys** because the two lanes are separate universes that could
  legitimately hold the same Firestore auto-id.

**Idempotence:** record PRESENT ⇒ already in the channel, skipped outright;
ABSENT ⇒ post and record. A question's text never changes on the site (there is
no edit affordance on a bot comment), so unlike a poll there is no re-render
pass at all.

⚠️ **Deletion is deliberately NOT propagated.** A host can delete a GABI comment
on the site; the Discord message stays. By the time a tick could notice, the
message may already carry a conversation, and deleting somebody's discussion to
mirror a site-side tidy-up is worse than a stale prompt.

### 14.7 Which channel it posts to

Identical to §8.3, reusing the **same binding** rather than inventing a second
one: `discordChannelId` on `clubs/{id}/settings/discord` wins; else the club's
existing `webhookUrl` resolved through `GET /webhooks/{id}/{token}`; else a
named skip saying exactly which field to add.

⚠️ `discordChannelId` rides alongside `webhookUrl` with **no rules change**:
`validClubSettings()` requires `webhookUrl` to be present and well-shaped but
uses no `hasOnly`, so an extra field is accepted (read 2026-08-18,
`firestore.rules`).

### 14.8 ⚠️ Switching it on — THE OWNER'S STEPS

Steps 1–3 are one-time and are **already done if `/polls/sync` is live** — the
token, the bot and the channel are all shared.

1. **`POLL_SYNC_TOKEN` set on both sides** (§8.6 steps 1–3). Confirm:
   `curl -s https://discord.heygabi.ai/api/health` → `question_sync_ready: true`.
2. **The estate bot is in the club's Discord server**, with **Send Messages**
   and **Embed Links** in the target channel. This needs Manage-Server rights
   *in that server* — the club's own admin does it, not the estate.
3. **The club has a Discord channel bound**: either it already pasted an
   announcement webhook in Edit Club (nothing more to do), or an explicit
   `discordChannelId` on `clubs/{id}/settings/discord`.
4. ⚠️ **Tick the box.** On the club page → **Edit Club** → *"GABI's questions in
   Discord"*. Host/mod/site-moderator only. This is the whole opt-in; it sets
   `features.discordQuestions = true`.
5. **Nothing happens yet, and that is correct** — the next tick baselines the
   club silently (§14.5).
6. **Press "Post as GABI"** on a read section. The next pipeline run (≤8h), or
   the curl in §14.2, puts it in the channel.

**Exactly what the owner needs to hand over / know:** nothing new. No new
secret, no new bot invite beyond the one `/polls/sync` already needs, no new
channel id if the club already has an announcement webhook. If a club has
**never** set a webhook, the one ID needed is that channel's **Discord channel
id** (right-click the channel → Copy Channel ID, with Developer Mode on),
written to `clubs/{id}/settings/discord.discordChannelId`.

**Turning it off:** untick the box. The Worker refuses the club on the very
next tick; already-posted messages stay where they are (see §14.6).

### 14.9 Verified live 2026-08-18 (deploy `6ccb1c99-bd45-4b92-a22b-cd3377cfed57`)

| Probe | Result |
|---|---|
| `GET /api/health` | `features` includes `club_question_sync`; `question_sync_ready: true`; `moderation_enabled: false` (untouched) |
| `POST /questions/sync`, no token | **401**, worded body ("did not carry the shared pipeline token… nothing was changed") |
| `POST /questions/sync`, wrong token | **401**, same worded body |
| `POST /questions/sync`, real token, `lane: dev` | **200** — `clubs_considered: 4`, `clubs_opted_in: 0`, `baselined: 0`, `posted: 0`, `skipped: 0`, 0 notes |
| `POST /questions/sync`, real token, `lane: prod` | **200** — `clubs_considered: 3`, `clubs_opted_in: 0`, `baselined: 0`, `posted: 0`, `skipped: 0` |
| Same dev tick run 3× | **byte-identical** each time, 0 notes — a stable no-op |
| `lane: "staging"` | **400**, *"Unknown lane… nothing was posted."* |
| `POST /polls/sync`, wrong token | **401** — unaffected by this build |
| `POST /interactions`, unsigned | **401** — unaffected by this build |

**What that actually proves:** the route's gate, the lane parse, and — the one
worth having — **the Firestore service-account read path works live**, since it
enumerated real clubs on both lanes. It also proves the feature **ships dark and
inert**: `clubs_opted_in: 0` on both lanes, so nothing was posted anywhere.

### 14.10 ⚠️ NOT VERIFIED LIVE

- **No question has ever been posted to a real Discord channel by this code.**
  0 clubs have `features.discordQuestions` set on either lane (the key did not
  exist until today). Every orchestration rule above is pinned by 45
  injected-dependency tests; none of it has met real Discord.
- ⚠️ **`baselined: 0` above means the baseline WRITE has never executed.** The
  read path returned "no baseline" for zero clubs because zero clubs got that
  far. §14.5 — the rail this whole feature's usability rests on — is proven by
  test only.
- **Nothing downstream of the opt-in has run live**: the post path, the record
  write, the per-tick cap, the oldest-first ordering, and the channel
  resolution have each executed only against injected stubs.
- **The webhook → `channel_id` round trip is still unproven** — the same gap
  §8.3 already records, inherited unchanged because this reuses that resolver.
- **`question_sync_ready: true` does NOT mean questions are live.** It is a
  fact about the Worker's three secrets, not about any club opting in.
- **The Edit Club checkbox has not been clicked in a browser.** It follows the
  same `FEATURE_DEFAULTS` + `updateClubDetails` path as six existing toggles and
  is covered by the site suite, but no one has used it. ⚠️ It is also on the
  audiobook site's **`/dev/` lane only** until a promote.
- **The Firestore read cost of `listQuestions`** (a masked list of a read's
  comments, filtered in the Worker) has not been measured against a busy read.
  At estate scale — ≤2 active reads per club, tens of comments — it is cheap by
  inspection; it is the only part of the tick whose cost grows with ordinary
  member activity, and the line to revisit if a read's comments ever run to
  thousands.

### 14.11 ⚠️ "curl says 403 / 000 and the route looks dead"

Two client artefacts cost time verifying this build. Neither is the Worker.

- **Python `urllib` gets a bare `403` from `discord.heygabi.ai`** — its default
  `User-Agent` (`Python-urllib/3.x`) is WAF-blocked in front of the Worker. The
  route never sees the request, so the 403 is not one of its answers (it only
  ever returns 200/400/401/503). **Fix: send a normal `User-Agent` header.**
- **Git Bash `curl -o <file> -w '%{http_code}'` reports `000`** and writes no
  file, which reads exactly like a dead host. Same family as the existing
  `curl -o /dev/null` artefact. **Fix: use PowerShell's `Invoke-WebRequest`, or
  pipe the body straight to a parser instead of `-o`.**

---

## 15. THE FUN MENU — five commands live, two dark (built 2026-09-02)

Design of record: [`../info/discord-bot-design.md`](../info/discord-bot-design.md)
§2c.2, §2d, §2e, P1, P2, P3, plus
[`../info/gabi-suggestions-design.md`](../info/gabi-suggestions-design.md) for
`/suggest`. Code: `src/recent.ts`, `src/universe.ts`, `src/review.ts`,
`src/suggest-command.ts`, `src/guessgame.ts`, `src/club-write.ts`.

### 15.1 What a person types, and what they get

| Command | What it does | Who can use it | Where the data comes from |
|---|---|---|---|
| `/recent [count]` | The newest arrivals on the shelves, 1–25 (default 10) | anybody | `audiobooks.heygabi.ai/additions_log.json` — public, **no credential** |
| `/universe [name]` | One universe's works, or the list of them all | anybody | `catalog.csv`'s `universe` column — public, **no credential** |
| `/review book:<title>` | What the house thought of a book, with the average rating; and a link to add your own | anybody | the `reviews` collection, via the shelf port |
| `/suggest [format] [mood]` | A few picks built on your own ratings and reading list | anybody (personalised once linked) | the catalogue + your own shelf |
| `/guessgame` | Guess the book from its facts — four titles, one right | anybody | `catalog.csv` |
| `/rsvp club:<name>` | 🔴 **DARK.** Offers Coming / Not coming / Maybe for the club's next meeting | linked members | `clubs/{id}` + `rsvps/{slug}` |
| `/progress club:<name> [percent] [chapter]` | 🔴 **DARK.** Records where you are in the club's current read | linked members | `clubs/{id}/reads/{readId}/progress/{slug}` |

**Answer shapes, so nothing surprises a channel:**

- `/recent`, `/universe`, `/review`, `/suggest`, `/rsvp` and `/progress` answer
  **ephemerally** — only the person who typed it sees the reply.
- `/guessgame` posts the **round publicly** (a channel plays it together) and
  answers each **press privately**, so the first person to click does not spoil
  it for the next reader.

### 15.2 Publishing them — §4's ritual, with one change

The registration route is unchanged:

```
POST https://discord.heygabi.ai/admin/commands/register
Authorization: Bearer <a Firebase ID token from an estate ADMIN account>
```

⚠️ **The registry is now a function of TWO switches**, not one. It publishes:

- `BASE_COMMANDS` always — `/link`, `/have`, `/gabi`, **`/recent`,
  `/universe`, `/review`, `/suggest`, `/guessgame`** (eight);
- **plus** `/rsvp` and `/progress` only while `GABI_CLUB_WRITES = "on"`;
- **plus** `/timeout` and `/cleanup` only while `MODERATION_ENABLED = "on"`.

The route's JSON answer states **both** switch states (`moderation_enabled`,
`club_writes_enabled`) and lists exactly what it published, so *"why can I not
see /rsvp"* is answerable in one call. Re-running after **either** flip is a
real step, not a no-op. Global commands take up to an hour to appear the first
time; updates show up almost immediately.

**Confirm from outside Discord:**

```bash
curl -s https://discord.heygabi.ai/api/health \
  | jq '.fun_menu_commands, .gabi_club_writes_enabled, .club_write_shapes_verified'
```

### 15.3 🔴 THE CHECKLIST BEFORE `GABI_CLUB_WRITES` IS EVER FLIPPED

⚠️ **`/rsvp` and `/progress` ship OFF, and the reason is a MISSING MEASUREMENT
rather than caution.** Read this before touching the switch.

**What is measured** (from this repo, 2026-09-02):

| Fact | Evidence |
|---|---|
| `clubs/{id}/reads/{readId}/progress` exists as a subcollection | `apps/audiobook-worker/src/enforce-routes.ts:857` sweeps it on read delete |
| RSVPs exist and are `meetingAt`-stamped | `../info/audiobook-auth-migration.md` line 103 |
| Per-member club subdocs are keyed by **member slug** | `votes/{slug}` (`poll-vote.ts`), `members/:slug`, `requests/:slug` (`enforce-routes.ts`), `slugifyName = displayName.toLowerCase()` |
| Both writes are gated `open` in rules, not by a capability | the migration doc's table: *setProgress / setChapterProgress: open, browser-direct*; *RSVP: open, browser-direct* |
| `features.meetingRsvp` is a real club feature key | `enforce-routes.ts:126` |

✅ **AND THE MISSING HALF WAS MEASURED ON 2026-09-02** — read from
`audiobook_catalog/site/club-reads.js`, `site/clubs.js` and `firestore.rules`
(read-only; nothing in that repo was changed). 🔴 **Four of the seven
inferred names were WRONG**, and every one of them would have SUCCEEDED:

| what | the guess | ⚠️ the MEASURED truth | evidence |
|---|---|---|---|
| RSVP collection | `rsvps` | ✅ `rsvps`, doc id = member slug | `club-reads.js:1961` |
| RSVP answer field | `status` | 🔴 **`response`** | `club-reads.js:1961-66`, `firestore.rules:626` |
| RSVP answer VALUES | `yes`/`no`/`maybe` | 🔴 **`going`/`maybe`/`cant`** | `RSVP_RESPONSES`, `club-reads.js:1895` |
| RSVP `meetingAt` | a string | 🔴 **a NUMBER** (epoch ms) | `firestore.rules:628`, `isRsvpCurrent` |
| club's meeting field | `meetingAt` | 🔴 **`nextMeetingAt`**, also a number | `clubs.js:263,565` |
| progress fields | `percent`, `chapter` | 🔴 **`milestonePosition`** or **`chapterIndex`**, both NUMBERS, plus `finished` and `history` | `club-reads.js:976-81,1007-12`; `firestore.rules:1143` |
| `displayName` / `updatedAt` | both | ✅ both, on both documents | `club-reads.js:1962,1975` |

⚠️ **`meetingAt` is the silent killer.** Every reader filters
`rsvp.meetingAt === club.nextMeetingAt` to drop answers to a rescheduled
meeting. A string never `===` a number, so an RSVP in the old shape would have
stored fine and been **absent from every tally for ever**. And reading the
club's instant from `meetingAt` returns null for every real club, so `/rsvp`
would have answered *"no meeting scheduled"* always.

All corrected in commit `ee688ad`, with the evidence table in
`src/club-write.ts` and the pin updated in `test/club-write.test.ts`.

⚠️ **This Worker's service account BYPASSES `firestore.rules`.** A write in the
wrong shape is therefore **not refused — it SUCCEEDS**, and the club page then
shows a member who has not RSVP'd, or a progress bar that never moves, with no
error anywhere. It fails silently, on somebody else's surface, and it looks
exactly like a bug in their code.

### 🔴 THE ONE THING STILL BLOCKING THE FLIP — an OWNER decision

⚠️ **`/progress percent` has NO DESTINATION FIELD, and correcting a constant
cannot fix that.** The club page tracks a milestone POSITION or a chapter INDEX,
both numbers; there is no percentage anywhere in it, and a percentage is neither
of those, so converting one into the other would be **inventing a value**. Since
`ee688ad` the percentage input is REFUSED in words rather than written into a
document nothing reads, and a chapter LABEL becomes a `chapterIndex` (`"ch. 14"`
→ `14`); a label with no number in it is refused too.

**The question, and it is the owner's rather than a coder's:** should
`/progress` drop `percent` and take a chapter only, or should it also learn
`milestonePosition` — which needs the read's milestone list to mean anything?
Tracked in [`../TODO.md`](../TODO.md).

**The flip, once that is answered, in order:**

1. ✅ **DONE 2026-09-02** — the shapes are measured and `CLUB_WRITE_SHAPES` is
   corrected (see the table above). Nothing to repeat here.
2. Answer the `/progress percent` question above and land whatever it implies
   (dropping the option is a command **re-registration**, not just an edit).
3. Flip `club_write_shapes_verified` in `/api/health` to `true`, saying in the
   commit who checked and against what. ⚠️ It is still `false` today **on
   purpose**: the shapes are verified but the command is not yet coherent, and
   one flag claiming both would be a half-truth.
4. `GABI_CLUB_WRITES = "on"` in `wrangler.toml`, `npx wrangler deploy`.
5. Re-run the registration route (§15.2) so `/rsvp` and `/progress` appear.
6. Opt a club in: `features.meetingRsvp = true` on its club doc. Default OFF —
   the same posture `discordPollVoting` keeps.
7. **Exercise it against a real club and then look at the club PAGE.** The
   Discord side saying "recorded" is not the evidence; the page rendering it is.
   ⚠️ Check an RSVP actually appears in the TALLY, not merely that a document
   exists — the `meetingAt` trap above is invisible from the document side.

**Backing out** is one line: `GABI_CLUB_WRITES = "off"` and deploy. The commands
disappear from Discord on the next registration run, and a stale one answers the
worded switched-off sentence rather than acting.

### 15.4 The per-club poll-ANNOUNCEMENT opt-out

`features.discordPollAnnouncements` is read by the sync tick
(`src/poll-vote.ts`'s `clubPollAnnouncementsEnabled`). ⚠️ **Its default is the
OPPOSITE of `discordPollVoting`'s, on purpose: ABSENT MEANS YES.** No club doc
carries the key yet, so an affirmative `=== true` check would have silently
muted every club that already announces its polls, and the symptom would have
looked like the sync tick being broken.

- `discordPollVoting` — may Discord vote at all? Affirmative-only, **default
  OFF**. Unchanged.
- `discordPollAnnouncements` — may the tick PUSH a poll into the channel?
  **Default ON**; an explicit `false` opts out.

An opted-out club is a **noted** skip (the tick's `notes` say the club chose it
and name the toggle), never a silent one — because it still has voting on, and
"opted in, nothing posted, no reason" reads as a fault. Turning it off does not
touch a poll message already in the channel; its vote buttons keep working.

⚠️ **This Worker only READS that key.** It is defined and written on the
audiobook side (`enforce-routes.ts`'s `CLUB_FEATURE_KEYS`, and the Edit Club
modal).

### 15.5 The decisions worth knowing, and what they cost

- **`/universe` does not call the index.** Measured 2026-09-02:
  `GET index.heygabi.ai/api/universes` → **401** for an anonymous caller, and
  `have.ts` already recorded why this Worker cannot widen a caller's index scope
  (it needs a Firebase ID token Discord cannot produce). So P3's "one more index
  endpoint" is unreachable from here; the answer comes from `catalog.csv`'s
  `universe` column instead. ⚠️ **Consequence, said in every answer: it counts
  ONE shelf.** The print and board-game catalogues are not in the number.
- **`/guessgame` guesses from FACTS, not from an obscured cover** — P1's
  "fiddly part" needs an image pipeline this Worker does not have, and
  `catalog-data.ts` deliberately throws `cover_href` away. ⚠️ **Accepted limit:
  the round is stateless, so the answer rides in the button's `custom_id` and
  anybody who opens Discord's developer tools can read it.** That is fine for a
  party game and would not be if the game ever gained a leaderboard.
- **`/suggest` calls no model.** It renders the composer's own `why` clauses
  instead of handing the rows to Haiku, so it spends nothing and is **not** a
  new row in `llm-billing-control-design.md`'s 36-path inventory. It reads
  flatter than she does; the answer says to @mention her for the conversation.
- **`/review` shows reviews and does not write one.** The doc-id convention
  belongs to `site/reviews.js`; inventing one would create a second review by
  the same person under a different id, and the service account would not be
  refused. The write half is a **deep link to the book's page**, the same
  propose-and-deep-link shape `/gabi` uses. What would change it: the id
  convention, measured and written down.

### 15.6 ⚠️ NOT VERIFIED LIVE

- **No command in this section has been typed in Discord.** Every test drives
  an injected `fetch` or a signed synthetic interaction. Registration has not
  been re-run, so **none of the five is visible in any server yet** — that is
  §15.2, and it needs an admin Firebase ID token no session holds.
- **`additions_log.json` was fetched live and its shape measured; `/recent`'s
  rendering of it was not** — the flow was exercised against a fixture.
- **The `reviews` join is unproven against real data.** Reviews are filed under
  `bookIdFromTitle(title)`; nobody has confirmed that the index's spelling of a
  title and the audiobook site's agree for a book that actually has reviews.
- **`/suggest`'s picks have still never been judged by a person** — unchanged
  from `gabi-suggestions-design.md` §10, and this surface does not change the
  ladder, only the door to it.
- **Nothing has been written to Firestore by `/rsvp` or `/progress`**, by
  construction: the posture is off, and the tests assert no call is even
  attempted while it is.
