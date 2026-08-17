# Discord Bot — Setup, Configuration, and the Option Space

> **Audience:** Claude sessions and the owner. **Status:** TRACKED. ~~DESIGN
> ONLY~~ — **phase-1 foundation + §2a poll voting BUILT 2026-08-16** in
> `apps/discord-worker/` (owner-approved; runbook:
> `docs/access/discord-bot.md`). **Still no Discord application created** —
> nothing is live until the owner runs the portal steps.
> Last verified: **2026-08-14**, against `audiobook_catalog/docs/info/
> discord-poll-sync-research.md` (2026-08-14 research), `catalog-platform/
> docs/PLATFORM.md`, `docs/info/index-worker-design.md`, `docs/info/
> estate-auth-design.md` (all read the same day), and
> `audiobook_catalog/app/club_announcements.py` + `app/additions_log.py` +
> `app/tools/send_discord_notification.py` (read directly, not from memory).
> Companion: `discord-poll-sync-research.md` — the bot-mechanics half of this
> doc (Ed25519, interactions endpoint, identity linking) summarizes that
> research rather than repeating it; read the research doc for the deep
> verification trail.

The owner's brief, verbatim intents: *"adding and configuring a discord bot
and what options long term this opens up for us,"* *"other things we can use
the bot for,"* and *"maybe I want a way to post what books I have or ways for
others to ask in discord if I have a book."*

This doc has two jobs: (1) how to actually stand the bot up, and (2) the full
catalog of what it opens up, so a "yes, build the bot" decision is made with
the whole option space in view rather than one feature at a time.

---

## 0. Where this sits in the estate

Three things already exist that this design builds on rather than replaces:

| Existing piece | What it does today | Relationship to the bot |
|---|---|---|
| `app/club_announcements.py` (audiobook_catalog) | Per-club, **webhook-only**, write-only announcements (schedule, due dates, polls closed, ratings reveal, meetings, TBR leader) to each club's own Discord channel | **Stays exactly as-is.** The research doc's verdict (§0) is that interactivity is *additive*, never a replacement — clubs that never invite the bot keep getting these embeds forever |
| `app/tools/send_discord_notification.py` | A **single estate-wide webhook** posting "N new books added" embeds after a pipeline run, off `new_books.json` | Stays as-is; §2c below designs a bot-native alternative that works in *any* server the bot is invited to, not just the one webhook this script targets |
| `index.heygabi.ai` (index Worker) | Cross-catalog search/lookup, live 2026-08-14. Anonymous callers get the `{audiobook}` slice (world-readable, matches the audiobook site's own posture); estate members get their per-person **visibility set** (`estate-auth-design.md` §4.5) | The natural backend for "does the estate have this book/game?" from Discord — §2b |

The bot is a **fourth thing**, not a rebuild of any of the three. Everything
below is additive.

---

## 1. Setup & configuration

### 1.1 Registering the application

Discord Developer Portal → New Application. This alone gives an application
ID + public key; a **bot user is a separate toggle** on the same application
(needed here, since posting messages *with components* — buttons — requires
posting as the application itself, not a webhook — research doc §3).

One application for the whole estate, shared across every club/server that
invites it — a separate Discord application per club is not practically
buildable (research doc §3), same as the estate having one Firebase project
rather than one per app.

### 1.2 Token custody

`DISCORD_BOT_TOKEN` becomes a Worker secret, the same class of thing as
`FIREBASE_SERVICE_ACCOUNT` / `TOKEN_SIGNER_KEY` already living in
`auth-worker`, and rotated the same way (Developer Portal "Reset Token").
Per the research doc §7: its blast radius is lower than the Firestore/
custom-token credentials (compromise yields "post/manage interactions in
whatever guilds the bot was invited to," not Firestore admin or Firebase
impersonation) but it is a **single credential shared across every opted-in
club** — a real regression from the per-club webhook model's isolation,
named and accepted there, named again here because this doc's scope is
wider than polls.

### 1.3 The interactions endpoint Worker — where it lives

Discord delivers all interactions (buttons, slash commands, the PING
handshake) as **HTTP POSTs to one configured URL** — no gateway, no
persistent connection (research doc §3). That URL has to live on a
Cloudflare Worker somewhere. Two options, and a recommendation that departs
from the research doc's narrower one:

- **The research doc recommends a route on `auth-worker`**, scoped to the
  poll-voting build alone — reasoning: `auth-worker` already carries the
  exact WebCrypto RS256/Firestore-REST primitives (`firebase-sa.ts`) that
  poll-vote writes need, so a new route is cheaper than a new Worker for
  *that one feature*.
- **This doc recommends a dedicated `apps/discord-worker/`** (sibling of
  `index-worker` and `auth-worker`, own `wrangler.toml`, own secrets) once
  the bot's scope is the *option space* described in §2, not polls alone.
  Reasoning, following the estate's own repeated pattern (`DESIGN.md` §3,
  quoted in `index-worker-design.md` §7: separate Workers "so the projects
  can't collide on schema, secrets, or deploys"):
  1. The bot token (§1.2) is a **second wide-blast-radius shared credential**
     alongside the auth Worker's directory. Putting it inside the Worker
     that gates the *entire estate's membership* mixes two "one leak affects
     everyone" surfaces instead of keeping them separately rotatable and
     separately auditable.
  2. Once the option space grows past poll votes — Firestore writes for
     RSVP/progress/TBR (§2d/e/h), reads against `index.heygabi.ai` (§2b) —
     the interactions handler is combining **three credential classes**
     (bot token, `firebase-sa` service-account pattern, an estate app-token
     for index reads). That is exactly the kind of Worker the estate has
     chosen, every other time, to isolate rather than fold in.
  3. It costs nothing extra: the canonical `estate-auth`/`firebase-sa`
     primitives are already shared modules (`packages/estate-auth/`,
     following the same "shared canonical module over synced copies"
     convention the universes list and the auth verifier already use), so a
     new Worker imports them rather than re-implementing them.

  **Reconciling the two:** if poll-voting alone ships first (§3's adoption
  ladder), landing it as a route on `auth-worker` per the research doc is
  fine and cheap — nothing here blocks that. The moment a second
  capability (RSVP, `/have`, showcase posting) is added, split the
  interactions handling into `discord-worker` and point Discord's one
  Interactions Endpoint URL at the new host — a Developer Portal field
  change, not a rebuild.

### 1.4 Invite model

**Per-server, by that server's own admin — never an estate-initiated
invite.** Same posture as the per-club webhook model today ("the club owns
its integration," research doc §9 Q5): a server admin runs Discord's
standard OAuth2 bot-authorization flow (`bot` + `applications.commands`
scopes) to add the bot to their own server. The estate cannot invite itself
into someone else's Discord without being handed admin rights it doesn't
otherwise hold, and shouldn't want to.

Expect materially lower adoption than the webhook feature — an invite needs
real server-admin rights, not just pasting a URL (research doc §3, §10).
This is fine: the webhook model remains every club's default, permanent,
zero-permission path, not a stepping stone.

### 1.5 Permissions & scopes — minimal, by design

| Ask | Why | Ask for it? |
|---|---|---|
| `bot` scope | Required to post as the application | ✅ |
| `applications.commands` scope | Required for slash commands (`/have`, `/recent`, `/progress`, …) | ✅ |
| Channel: Send Messages, Embed Links | Post embeds/components | ✅ |
| Channel: Read Message History | Edit an existing poll/RSVP message (button state, tallies) | ✅ |
| **Message Content intent** | Reading the text of ordinary messages | ❌ **Never requested.** Every feature in §2 is slash-command or component-driven — nothing needs to read plain chat. Skipping it also sidesteps Discord's privileged-intent verification gate (irrelevant at estate scale, but it's one fewer thing to explain to a server admin approving the invite) |
| Manage Server / Administrator | — | ❌ never |

### 1.6 Identity linking — summarized from the research, not repeated

Full design: `discord-poll-sync-research.md` §5. In one paragraph: a "Link
Discord" button starts a standard OAuth2 **`identify`**-scope flow (user id +
username only, no email consent needed); on return, the app stores
`discordUserId` next to whichever club-member slug is active in that
browser. An unlinked Discord user who tries a write-capable action gets an
**ephemeral** rejection ("link your account first," with a link), never a
silent failure or a name-matching guess. **This is the one linking ceremony
every write-capable command in §2 reuses** — build it once, in phase 1 (§3),
not per-feature.

The research doc's stated caveat carries forward unchanged: the link binds a
Discord identity to "whoever was sitting at this browser when they clicked
Link" — exactly as strong, and no stronger, than every other identity claim
this site already makes (`site/identity.js`'s shape-only trust model).

**BUILT 2026-08-17** — `apps/discord-worker/src/link.ts` and siblings, live at
`discord.heygabi.ai`, shipping dark behind `DISCORD_CLIENT_SECRET`.
Operational detail, the owner's remaining click and the end-to-end experience:
[`../access/discord-bot.md`](../access/discord-bot.md) §3 step 7, §4, §5. Two
questions this section had left open, and how the build answered them:

- **Where the ceremony is hosted.** Not "the app" — the *Worker* serves both
  pages itself. `discord.heygabi.ai` has no Pages project behind it, and
  hosting the callback on a catalog site would have put the Discord OAuth
  credential in a second place. The pages are self-contained HTML with the
  estate's `--et-*` tokens inlined in a minimal, documented subset.
- **How the two halves are joined without trusting the browser.** The Discord
  identity never enters the page's JavaScript; it crosses from the OAuth
  callback to the confirm POST inside an **HttpOnly, HMAC-signed, 15-minute
  cookie**. Otherwise a page that knows a Discord user id is a page that can
  be edited to submit somebody *else's*. The estate half is proven
  independently in the same request by a server-verified Firebase ID token
  (`@platform/estate-auth`, project-pinned issuer and audience). Neither
  proof alone writes anything — which is what makes §1.6's "never guessed"
  a mechanism rather than a promise.

⚠️ One measured correction to this section's shorthand: a club-member slug is
`displayName.toLowerCase()` and nothing else (`site/identity.js:765`), so it
routinely contains spaces. See `access/discord-bot.md` §7's gotcha — the
Firestore-auto-id shape is the WRONG validator for it, and using it silently
refuses almost every real member.

### 1.7 Operational notes

- **3-second response deadline**, extendable via a deferred response
  (`DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` / `DEFERRED_UPDATE_MESSAGE`) that
  buys up to 15 minutes via the interaction token. Research doc §3, §7 flags
  the Firestore-REST round trip as "plausible but not proven" inside 3s on a
  cold isolate — build the deferred fallback from day one, don't add it only
  if the synchronous path is observed flaky.
- **Rate limits:** 50 requests/second global bot ceiling; interaction
  *responses* are explicitly exempt from it. Not a practical constraint at
  estate scale (research doc §7).
- **Ed25519 setup is unforgiving:** Discord actively probes the saved
  interactions URL with deliberately invalid signatures during setup and
  silently removes the URL if verification isn't exactly right — this reads
  as "the portal is broken" rather than a code bug if hit unprepared
  (research doc §10). Budget for this during initial build/test regardless
  of which Worker ends up hosting the endpoint.
- **Health:** same pattern as `index.heygabi.ai`'s and `auth.heygabi.ai`'s
  `GET /api/health` — row/interaction counts, no PII, open to anonymous
  callers.

---

## 2. THE OPTION SPACE

Each entry: what it is, what it needs, size (S/M/L), and any privacy/trust
caveat. (a)–(h) are the owner's named ideas; the numbered items after are
this doc's own proposals, marked as such.

### (a) Two-way poll voting

**What:** Button-based voting on club polls, posted and updated live in
Discord, syncing both directions with the app's existing `votes`
subcollection. **Full design already exists** — see
`discord-poll-sync-research.md` in full; do not re-derive it here.
**Needs:** interactions endpoint (§1.3), identity link (§1.6), Firestore
writes via the `firebase-sa.ts` pattern, per-club opt-in flag
(`discordPollVoting`, default OFF), bot invited to that club's server.
**Size:** M (phases 2–3 of the research doc's plan; phase 1 foundation is
shared with every other write-capable feature here).
**Caveat:** shared bot-token blast radius (§1.2); a compromised token
affects every opted-in club simultaneously, unlike the per-club webhook
model.

### (b) "Do I have this book?" — `/have` or `/shelf`

**What:** A slash command that queries `index.heygabi.ai`'s search surface
and answers "does the estate own this, in what format(s)?" — the Discord
equivalent of the estate's own cross-catalog search.
**Needs:** the bot Worker as an authenticated caller of `GET /api/search`
(and, for a linked+approved member, potentially `GET /api/lookup`); no
Firestore writes; identity linking is optional here, not required, because
the interesting design question is about *scope*, not write authorization.
**Size:** S–M — the index Worker is already live; this is a new consumer
plus slash-command registration.

**The privacy line, designed explicitly (per the brief's ask):**

The hard question is *what a stranger in someone else's Discord server can
learn about the estate's library/games shelves* — a Discord server is not an
estate-controlled surface the way `heygabi.ai` is, and the bot answering
queries there is functionally letting that server's membership query the
estate.

| Caller | Recommended default scope | Reasoning |
|---|---|---|
| Any Discord user, unlinked, in any server | **`{audiobook}` only** — same as an anonymous web visitor to `index.heygabi.ai`'s search | Matches the estate's own recorded anonymous rule (`estate-auth-design.md` §4.5): absent/invalid identity ⇒ the world-readable slice, nothing more. The audiobook catalog is already public at `audiobooks.heygabi.ai`; answering `/have` with that same slice in Discord reveals nothing the site doesn't already show |
| A Discord user who has **completed the link ceremony** (§1.6) and is an **approved estate member** | Their own `/seen` visibility set (audiobook/library/games, per `estate-auth-design.md` §4.5), same as they'd get signed into `heygabi.ai` | Requires them to already be a trusted estate member — this is not a Discord-specific grant, it inherits the estate's existing membership decision |
| A Discord user who is NOT an estate member, in a server the owner personally controls and trusts | **Owner's explicit per-server call, not a global default** | If the owner wants "does the estate own this board game" answerable in one specific trusted server (e.g. their own household's private server) without every participant individually linking, that is a deliberate, narrower widening — size it and decide it separately, never assume it |

**Mechanically:** because linked-but-unauthenticated Discord users have no
way to hand the bot a Firebase ID token (Discord's OAuth doesn't mint one),
the bot cannot forward a per-user token to `/api/search` the way a browser
does. Two workable shapes, in order of recommendation:

1. **The bot calls `/api/search` at the anonymous scope for everyone by
   default** — zero extra credential, zero privilege-escalation risk,
   matches row 1 above exactly. This is the correct default and should ship
   first.
2. **For the linked+approved case**, the bot Worker's own estate app-token
   (same pattern as `ESTATE_APP_TOKEN_INDEX`) calls `/api/estate/seen` for
   that Discord user's *linked email* to fetch their current visibility set,
   then scopes the `/api/search` call to it. This reuses machinery that
   already exists (`estate-auth-design.md` §4.4/§5.2) rather than inventing
   a new one — the bot is just one more `/seen`-calling consumer, gated the
   same way every app is.

**Not recommended:** giving the bot's own app-token wide (library+games)
scope and applying it to *every* caller regardless of who they are — that
would let any stranger in any server the bot is ever invited to see the
private catalogs, which is exactly the "wider than anonymous scope" case the
brief asked to be a deliberate, called-out decision rather than a default.

### (c) Posting what books the owner has — browse/showcase

**What:** three related surfaces, sized separately because they have
different costs:

1. **New-additions feed to a channel.** `site/additions_log.json` is
   already the append-only, dated source of truth for "when did this book
   first arrive" (`app/additions_log.py`) — a bot-native version of
   `send_discord_notification.py`'s existing new-books webhook, but postable
   to *any* server the bot is in (not just the one estate-wide webhook that
   script targets today), and driven by the durable log rather than the
   ephemeral `new_books.json` pipeline artifact. **Size: S** — read-only,
   no identity, no Firestore writes; a Worker cron or a pipeline-triggered
   `waitUntil` posts new `additions_log.json` entries since the last run.
2. **`/recent` command.** On-demand equivalent of (1) — "show me the last N
   additions" — answerable any time, not just when the estate chooses to
   push. **Size: S**, same data source, just a slash command instead of a
   cron.
3. **A rich shelf/embed browse surface** (e.g. `/shelf <author>` or
   `/shelf <series>` showing covers + status). **Size: M** — needs a real
   query surface over the catalog (the index Worker's `/api/search`, scoped
   per (b)'s rule, or a dedicated read against the audiobook catalog data),
   plus embed pagination since Discord embeds cap out quickly.

**Caveat:** all three are showcase surfaces over data that's already public
on `audiobooks.heygabi.ai` — no new privacy exposure if scoped per (b)'s
audiobook-only default.

### (d) Club RSVP via buttons

**What:** meeting RSVP (yes/no/maybe, per the shipped meeting-scheduler
backlog #5) as Discord buttons on the meeting-announcement embed
`club_announcements.py` already posts, instead of requiring a trip to the
club page.
**Needs:** interactions endpoint, identity link, Firestore write to the
`rsvps` subcollection via the service-account pattern, per-club opt-in.
**Size:** M — same shape as poll voting (a), and can share almost all of
its plumbing (button component, identity resolution, deferred-response
handling) once (a) exists.
**Caveat:** same shared-bot-token blast radius as (a); no new privacy
surface beyond what the meeting embed already shows (date/notes are already
posted to the club's webhook today).

### (e) Reading-progress updates from Discord — `/progress`

**What:** a member updates their chapter/percentage progress on their
current club read without opening the app.
**Needs:** interactions endpoint, identity link, **estate-approved**
membership (this writes personal reading state, a step beyond RSVP/voting),
Firestore write via service account, and — the real complexity — resolving
*which club and which read* a bare `/progress` command applies to when a
member is in more than one club. Recommend either (i) a required command
argument (`/progress club:<name>`) or (ii) scoping the command to
per-server, single-club Discord servers only (most club Discords likely map
1:1 to one club, making this trivial) with an explicit error if the server
maps to more than one club.
**Size:** M–L — the club-resolution question is the size driver, not the
Firestore write itself.

### (f) Meeting reminders with snooze/RSVP actions

**What:** extends `club_announcements.py`'s existing meeting-reminder embed
(already fires once per meeting instant, `REMINDER_WINDOW_MS`) with buttons
— RSVP directly (ties to (d)) or "remind me again in N hours."
**Needs:** everything (d) needs, plus a small amount of new state (a
snooze marker, mirroring the existing `meetingReminderSentFor` marker-keyed
convention in `announceState`) and a scheduled re-check.
**Size:** M.
**Caveat:** none beyond (d)'s.

### (g) Community-stats digest posts

**What:** a periodic embed summarizing estate activity — total books,
active readers, who's currently reading what — modeled on what
`site/community.html` and `site/stats.html` already render for the web.
**Needs:** either (i) reading the same data those pages already compute
(cheapest — no new Firestore reads if the pipeline already produces a JSON
summary) or (ii) a small service-account read against the `reads`/`progress`
collections `club_announcements.py` already touches. No identity linking —
this is an aggregate, not per-person.
**Size:** S–M depending on whether (i) or (ii).
**Caveat:** low — same information already public on the community/stats
pages; posting it to Discord doesn't create new exposure, just a new
surface for existing public data. (Did not verify exactly which fields
`community.html`/`stats.html` compute client-side vs. receive pre-baked —
worth a quick check before build to avoid recomputing something that
already exists as JSON.)

### (h) TBR suggestions from Discord — `/suggest`

**What:** suggest a book for a club's to-be-read list from Discord.
**Needs:** interactions endpoint, identity link, estate-approved
membership, Firestore write to the `tbr` subcollection, and the same
club-resolution question as (e) (`/progress`) — which club's TBR gets the
suggestion.
**Size:** M, same shape as (e).

---

### Proposals (this doc's own additions, marked clearly)

**Not requested by the owner — sized and caveated the same as the rest so
they can be picked up or dropped with the same rigor.**

#### P1 — `/guessgame`: the cover-guessing game, in Discord

**What:** `site/guess-game.html` already exists as a cover-guessing game
against public catalog covers. A Discord-native version — the bot posts an
obscured/cropped cover, members guess via the interaction, correct guesses
get a public reveal — costs almost nothing new: the covers and titles are
already public data, and the game logic is already written once for the
web version.
**Needs:** bot token, no identity link (guesses can be anonymous — it's a
game, not a write to personal state), a Worker cron or on-demand slash
command.
**Size:** M (mostly UI/embed work — obscuring a cover image server-side and
posting it before revealing the answer is the fiddly part).

#### P2 — `/review`: surface existing reviews on request

**What:** "what did the club think of *Book X*?" — reads the existing,
already-public review data (self-asserted display names, shape-only rules
per the estate's recorded trust model) and posts a short digest (average
rating if available, a snippet or two) to Discord.
**Needs:** read-only, no identity link, no Firestore write. (Did not verify
whether the reviews collection is readable by an unauthenticated caller the
way the audiobook site itself renders it, or only via the site's own
client-side Firestore rules path — confirm the exact read path before
build, since the bot would need its own read credential if reviews turn
out not to be publicly readable the way covers/titles are.)
**Size:** S, pending that verification.

#### P3 — `/universe <name>`: cross-catalog showcase

**What:** the estate's own genuinely new cross-catalog capability — "show
me everything the estate owns in the DCC (or any shared) universe," across
audiobook/library/games — is exactly what `index-worker-design.md` §3.2's
universe tier was built for, and it's a natural, good-looking Discord
command that showcases real platform work rather than re-deriving anything.
**Needs:** `GET /api/universe/:name` (already live, members-only today —
same scope design as (b): default to whatever's in the public/anonymous
slice unless the caller is linked+approved).
**Size:** S, once (b)'s scope machinery exists — this is largely "one more
index endpoint wired the same way."

#### P4 — Per-book discussion threads

**What:** when a club starts a read (the existing `started` event
`club_announcements.py` already detects), the bot opens a dedicated Discord
thread named after the book, seeded with the cover + a one-line blurb, so
spoiler-prone discussion stays contained instead of flooding the main
channel.
**Needs:** interactions/messaging permissions to create threads, ties into
the existing `started`/`finished` event detection (no new Firestore reads —
`club_announcements.py` already has this data on every run), no identity
link, no writes.
**Size:** M–L (thread lifecycle — archiving on `finished`, handling a club
with several concurrent reads — is the real cost, not the initial post).
Lower priority than P1–P3; included as a "further out" idea rather than a
near-term one.

---

## 3. Adoption ladder

The point of laying this out as a ladder rather than a flat list: several
ideas share almost all of their plumbing once the phase below them exists,
so the *order* determines how much of §2 is cheap versus expensive.

| Tier | What it needs | Ideas that fit here |
|---|---|---|
| **Phase 1 — bot mechanics only** (§1: registration, Ed25519 endpoint, PING handshake, slash-command registration) — **no identity link, no Firestore writes** | Nothing beyond §1 | (b) `/have` at the anonymous/audiobook-only scope · (c.1)/(c.2) new-additions feed + `/recent` · (g) stats digest (if read from existing pipeline JSON) · P1 `/guessgame` · P2 `/review` (pending its read-path check) · P3 `/universe` (anonymous slice only) |
| **Phase 2 — identity linking** (§1.6: OAuth `identify`, discordUserId ↔ slug) added on top of phase 1 | Phase 1 + the link ceremony | (b) `/have` at member-scoped visibility · P3 `/universe` at member scope |
| **Phase 3 — service-account writes** (`firebase-sa.ts` pattern, Firestore writes as a linked+approved member) added on top of phase 2 | Phases 1+2 + Firestore write plumbing | (a) poll voting · (d) RSVP buttons · (e) `/progress` · (f) reminders with actions · (h) `/suggest` |
| **Later / larger** | Phase 3 + extra state or lifecycle management | P4 per-book threads |

**Recommended first three, in order:**

1. **(b) `/have`, anonymous/audiobook-scope only.** Delivers the owner's
   named "ask in Discord if I have a book" ask directly, ships with zero
   privacy risk (same data already public on the site), and proves the
   entire bot mechanics chain (Ed25519 verification, PING handshake,
   slash-command registration, the 3-second-deadline/deferred-response
   pattern) with nothing else riding on it. If this is wrong, nothing else
   built on top of it is affected.
2. **(a) Two-way poll voting.** The research is already done in full
   (`discord-poll-sync-research.md`) — this is the highest-value,
   most-designed idea on the list, delivers real value to already-shipped
   club features (polls, backlog #3/#3b), and is what builds the identity
   link + Firestore-write plumbing every other write-capable idea in phase
   3 then reuses for free.
3. **(d) Club RSVP via buttons.** The cheapest phase-3 idea once (a) exists
   — it reuses the exact same button-component, identity-resolution, and
   deferred-response code, applied to a different Firestore subcollection.
   Ships fast specifically *because* it's second, not first.

---

## 4. Owner decision points

| # | Decision | Recommendation |
|---|---|---|
| 1 | **Bot name / branding** — it represents the estate in other people's Discord servers | **"GABI"** — the estate already has a bot-adjacent identity under this name (`site/static/img/gabi.png`, the "Post as GABI" AI-comment feature in `audiobook_catalog`'s backlog, and the `heygabi.ai` domain itself). Reusing it rather than inventing a second brand keeps "the estate's assistant" as one consistent character across surfaces. Verify `gabi.png` meets Discord's avatar requirements (square, reasonable resolution) before using it as-is — not checked here |
| 2 | **Interactions endpoint location** — dedicated `discord-worker` vs. a route on `auth-worker` | **Dedicated `apps/discord-worker/`** if building past poll-voting alone (§1.3's reasoning); a route on `auth-worker` is acceptable **only** if poll-voting is genuinely the sole planned feature, per the research doc's narrower recommendation |
| 3 | **Invite model** — per-server admin invite vs. any estate-wide mechanism | **Confirm per-server-admin-only, never estate-initiated** (§1.4) — matches the existing webhook model's "the club owns its integration" posture |
| 4 | **`/have` scope for unlinked/stranger Discord users** — the core privacy line the brief asked to be designed explicitly | **Default: `{audiobook}` only**, matching the estate's own anonymous-scope rule (§2b). Wider scope for a specific trusted server is a deliberate, per-server owner call, never a global default |
| 5 | **One identity-link ceremony, reused everywhere** — vs. a separate link per feature | **One `identify`-scope OAuth ceremony (§1.6), built once in phase 2**, consumed by every write-capable command in phase 3 rather than re-built per feature |
| 6 | **Should the bot ever treat a Discord *server's* membership as estate-trusted**, i.e. assume "everyone in this server is basically family"? | **No** — every capability in §2 that touches non-public data gates on the *individual* Discord user having completed the link ceremony and holding estate `approved` status, never on which server the interaction came from. The one narrow exception is decision #4's owner-controlled trusted-server carve-out, and that stays an explicit, named, per-server choice — never inferred from "the owner invited the bot here" |

---

## 5. What this doc does not do

- **Does not commit to a build.** Every size in §2 is a sizing input for a
  go/no-go, the same discipline `discord-poll-sync-research.md` §7 used.
- **Does not re-derive the poll-voting design.** That's
  `discord-poll-sync-research.md` in full; this doc only summarizes it in
  §1 and places it in the wider option space in §2a/§3.
- **Does not change `app/club_announcements.py` or
  `send_discord_notification.py`.** Both keep running unchanged; the bot is
  additive (§0).
- **Does not decide whether `audiobooks.heygabi.ai` reads should ever be
  gated.** `estate-auth-design.md` §13 Q1 already carries that as a
  separate, unresolved question; this doc's `/have` design (§2b) explicitly
  assumes the audiobook slice stays the public default, consistent with
  that doc's own default-if-unanswered.

---

## Sources

Read directly, 2026-08-14: `audiobook_catalog/docs/info/
discord-poll-sync-research.md` (whole file); `catalog-platform/docs/
PLATFORM.md`; `catalog-platform/docs/info/index-worker-design.md`; `catalog-
platform/docs/info/estate-auth-design.md` (§1–§9, §13; §10–14 header status
lines only — not fully re-read past §9's close); `audiobook_catalog/app/
club_announcements.py` (whole file); `audiobook_catalog/app/
additions_log.py` (whole file); `audiobook_catalog/app/tools/
send_discord_notification.py` (partial — `create_embed`); `audiobook_catalog/
docs/TODO.md` (grepped for Discord/club-backlog context, lines ~600–750
read in full); `audiobook_catalog/site/community.html` (header/structure
only, not the full rendering logic — **not verified**: exactly which stats
fields are pre-baked JSON vs. computed client-side, flagged in §2g).

**Not verified, named where relevant above:** whether the reviews
collection is readable by an unauthenticated caller the way the site
renders it (P2's caveat); `gabi.png`'s suitability as a Discord avatar
(decision #1); the exact split between pre-baked and client-computed stats
on `community.html`/`stats.html` (§2g).
