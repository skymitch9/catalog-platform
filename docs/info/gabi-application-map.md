# GABI — the full application map

> **Audience:** Claude sessions + the owner. **Status:** TRACKED.
> Last verified: **2026-08-17**. Design of record for GABI as ONE assistant
> across every surface; the Discord mechanics live in the discord design doc
> and this doc deliberately does not duplicate them.

Owner brief (2026-08-17, verbatim): *"Help me build out a full flesh
application here. Give suggestions on features and limitations."* Plus, same
day: DB Q&A (*"who's the narrator of Way of Kings?"*), DM intake (*"Can I dm
her an isbn or a photo and she adds it to the catalog?"*), club ops (*"change
the admin to a book club"*), docs help (*"so she can even help me if needed
for let's say I don't have a Claude code session open"*).

## 1. What GABI is

One assistant, several mouths. The same persona (nerdy bookworm, honest
about her limits), the same conversation-store shape, the same accounting,
the same tool-allowlist philosophy — surfaced through:

| Surface | State | How you reach her |
|---|---|---|
| Site panel (library / padhard) | LIVE | the chat button |
| Discord channel | BUILT, dark | `@GABI …` mention, or reply-with-ping |
| Discord DM | BUILDING | just message her — no @ needed |
| Site panel v2 | FUTURE | same chat button, adopts the shared conversation store |

**The one security principle everything hangs on: GABI owns no permissions.**
She borrows the asker's identity — site session on the web, the `/link`
binding on Discord — and the *destination site's* worker checks that
person's real stored role before anything happens. "What can GABI do for
me?" always reduces to "what can *I* do?"

## 2. The capability ladder (T0–T4)

Proposed 2026-08-17, pending owner sign-off. Blast radius decides the tier;
the tier decides the ceremony.

| Tier | What | Ceremony | Examples |
|---|---|---|---|
| **T0** | Read | none — just answers | narrator/length/series order, cross-catalog "do we have X in ebook?", club schedule, "where am I in Blackflame?" (save-spot data), TBR contents, who-owns-what |
| **T1** | Additive writes with easy undo | auto-apply, then report ("Hey @Sam — added it") | add book by ISBN (DM'd), add by cover photo (DM'd → scan pipeline), blank-detail fills ("fix all my missing details" → sweep run), TBR add |
| **T2** | Mutating existing data | propose → **confirm button** in chat | fix a wrong author/narrator, series or universe merge, cover swap, content-warning edit |
| **T3** | People & club operations | restate exactly what changes → confirm button; asker must hold the capability (manageClub etc.) | club admin change, club resets, kicking a club member |
| **T4** | Never from GABI's chat, any surface | — | estate grants/revokes, deploys/promotes, secrets, moderation config, anything money |

T1's auto-apply inherits the §12 precedent (blank fills auto, everything
else confirms). T3 keeps the "island" property: club powers come from the
asker's own standing, GABI is only the hands.

## 3. Feature suggestions, by effort

**Near (machinery exists, wiring needed)**
- **Catalog Q&A tools (T0)** — read-only tool calls against the catalogs'
  APIs, scoped by the asker's visibilities. The panel's GABI_TOOL_NAMES
  allowlist idiom carries over verbatim.
- **ISBN intake by DM (T1)** — the library's add-by-ISBN ladder already
  exists end to end; Discord is just a new front door to it.
- **"Fix my missing details" (T1)** — triggers the sweep the catalogs
  already run hourly, attributed to the asker, results messaged back.
- **Docs assistant (owner/devops only)** — publish a docs snapshot behind an
  estate-gated endpoint; she answers "how do I promote?" when no Claude
  session is open. ⚠️ Needs its own design pass: audiobook docs are
  local-only today, and access-runbook content deserves the devops gate.

**Middle (new but bounded)**
- **Photo intake (T1)** — DM a cover photo; attachment URL → the existing
  scanPhoto flow → propose/add. Photo quality and size need a worded
  refusal path.
- **T2/T3 confirm verbs** — the continuity build's buttons/modals are the
  exact machinery confirms need; the verbs plug in behind them.
- **Proactive pings** — poll posting (built, needs a channel), new-book
  announcements (club webhooks exist), CW-fulfillment "your book arrived."

**Later**
- **Moderation revival** — timeouts + cleanup are built and dark; owner
  flips MODERATION_ENABLED and re-registers when ready.
- **Panel chat-button v2** — the site panel adopts the shared conversation
  store, so a chat begun on the site is the same GABI, with the same memory
  shape, as Discord.
- **Recommendations / reading stats** — she can already see the data; purely
  a prompt-and-tools feature once Q&A lands.

## 4. Limitations — stated up front, on purpose

1. **She hears only what's addressed to her.** Mentions, reply-with-ping,
   DMs. Bare "heygabi" in channel text needs Discord's read-everything
   privileged intent — deliberately refused (owner decision 2026-08-17:
   start mention-only). A reply with the ping turned off is invisible.
2. **Memory is a sliding window** (~10 turns / ~30 min), by design — she
   forgets old conversations rather than archiving your chatter.
3. **One always-on gateway connection.** On Workers Free it consumes ~83% of
   the daily Durable-Object allowance with no cron backstop (free slots
   full); until the Workers Paid upgrade lands, a dropped connection needs a
   manual start. Paid ($5/mo, owner approved 2026-08-17) erases both.
4. **Bounded steps per message** (50-subrequest platform ceiling): she does
   quick things inline and *triggers* long jobs (sweeps, research runs),
   reporting back when they land — she never grinds a big job inside one
   Discord message.
5. **Her brain costs money on someone's key** — fractions of a cent per
   exchange on the cheap tier, capped per-user and per-day, every turn
   accounted. Padhard's key is spend-capped until raised (Sep 1 reset).
6. **T4 is a wall, not a default.** Estate roles, deploys, secrets, and
   moderation config never route through chat on any surface.
7. **She is not a monitor.** She acts when addressed plus scheduled jobs;
   she does not watch channels (can't — see #1) or poll for work.

## 5. Build order of record

1. Conversation continuity (IN FLIGHT 2026-08-17)
2. Wake-up: her key + `GABI_MENTIONS=on` + gateway start + live `@GABI` test
3. Catalog Q&A tools (T0)
4. T1 intake: ISBN → fills → photo
5. Docs assistant (design first: snapshot + devops gate)
6. T2/T3 confirm verbs on the components machinery
7. Panel chat-button unification; moderation revival when the owner says so
