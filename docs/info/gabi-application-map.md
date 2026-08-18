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
| Discord channel | LIVE | `@GABI …` mention, or reply-with-ping |
| Discord DM | LIVE | just message her — no @ needed |
| Site panel **v2** | **LIVE 2026-08-18** — §2e | same chat button, now on the shared conversation substrate |

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

## 2a. ⚠️ T1 AS BUILT — shipped and deployed 2026-08-18

Owner approval, verbatim: *"that looks good, start with that"* then *"all of
it"*. Two verbs are live; the photo verb is **measured and deliberately not
built** (§2d).

### The delegation contract

```
POST  https://library.heygabi.ai/api/gabi/delegated/{whoami,add-isbn,run-details}
POST  https://padhard.heygabi.ai/api/gabi/delegated/{whoami,add-isbn,run-details}
Authorization: Bearer <ESTATE_APP_TOKEN_DISCORD>
{ "onBehalfOf": "<firebaseUid>", "isbn": "978…" }      ← isbn on add-isbn only
```

| Layer | What it proves | What it does NOT prove |
|---|---|---|
| `ESTATE_APP_TOKEN_DISCORD` | the caller is the estate's Discord Worker | **anything at all about what may be written** |
| `onBehalfOf` uid | the `discord_links/{id}` doc the person created via their own Discord OAuth **and** their own Firebase sign-in | that they have an account on *this* instance |
| `app_user` lookup + `can(role, capability)` **on the destination** | the asker's real stored role there | — |

⚠️ **The authority check is the DESTINATION'S, and only the destination's.**
The bot performs no role check of its own — a check the caller performs is a
check the caller can skip, and a second copy of a role matrix is the copy that
goes stale. GABI relays the destination's own worded refusal verbatim.

| Verb | Capability | The button it borrows from |
|---|---|---|
| `whoami` | none (writes nothing, spends nothing) | — |
| `add-isbn` | `editCatalog` | the scan review screen's **Add** |
| `run-details` | `runResearch` | the details queue's **Run** |

**Four refusal causes, four sentences** (the no-bare-status rule): no account
here · estate-revoked · awaiting approval · role too low. Plus two the bot
words itself because the site cannot: **unlinked** (run `/link`) and
**unreachable** (an outage, never dressed as a permissions problem).

### Instance routing

`whoami` is asked of **both** shelves in parallel, then:

| Answer | What she does |
|---|---|
| capability on exactly one | go |
| capability on **both** | ⚠️ **ask** — a select menu, "your shelf or the main library?". Nothing is written, nothing is called, and the fuse is not spent |
| known somewhere, permitted nowhere | call that shelf and relay **its** refusal |
| known nowhere | worded: sign in once, that is what creates the account |
| nothing reachable | worded as an outage — ⚠️ never as "you have no account" |

⚠️ `whoami` answers **200 with `known:false`** for a stranger, on purpose: on a
household where somebody has one account, one shelf always says "not here", and
turning the ordinary case into an error would make routing indistinguishable
from an outage.

### Provenance and undo

| Write | Stamp | Undo |
|---|---|---|
| add-isbn | `change_log` rows with `changed_by = <asker>`, `changed_how = 'auto'`, `note LIKE 'gabi-discord%'` | the book's own **Changes** panel; the rows are a work + a printing + a copy |
| run-details | `research_run.triggered_by = <asker>` where the cron writes `NULL` | the details queue's existing **auto-applied → Undo** list, unchanged |

So *"what has GABI added"* and *"what did GABI fill for me"* are each one query,
and neither needed a new column.

### ⚠️ What T1 deliberately will not do

A barcode whose book is **already on that shelf** raises the four-way rescan
question (`@lc/core/rescan.ts`) or the pre-order question. Nothing the catalog
knows can tell those apart, and this repo already carries residue from the
version that guessed. Both are handed back **with nothing written** — they are
T2 mutations, and the confirm lane does not exist yet.

### Caps

The existing turn fuse (20/hour/person, 200/day estate-wide) is untouched. A
**second** fuse counts writes: **20 per person per UTC day**, its own `wcap:`
key namespace in the gateway object, checked *before* the link read. Two fuses
because a turn is a fraction of a cent forgiven in an hour, and a write is a row
in somebody's catalog plus ~2¢ of research on their key.

## 2b. ⚠️ The property that ended, on purpose

Until this build the mention path was **100% credential-free** and
`test/mentions.test.ts` asserted it against `mention-flow.ts`'s source;
`docs/TODO.md` recorded that shipping any write *"means deciding to give up that
property on purpose"*. **The owner's T1 approval is that decision.**

The assertion was not deleted or worked around. It was **repointed** at the
narrower property that replaced it, and a second test gives that one teeth:

> **Credentials appear only in `delegated-exec.ts`.** `mention-flow.ts`,
> `delegated.ts`, `delegated-flow.ts`, `gabi-chat.ts`, `tool-exec.ts`,
> `catalog-data.ts` and `gabi-tools.ts` name no Firestore client, no service
> account and no app token, and reach the write path only through an injected
> port they cannot construct.

(`have.ts` is excluded and the test says why: its `isLinked` has read the same
link document for `/have`'s scope note since long before T1, and the mention
path never calls it.)

## 2c. ⚠️ The model chooses nothing

The delegated verbs are **not tools**, are never described to the model, and
`toolsForApi()` — the only thing handed to the Messages API — returns the
read-only Tier-0 tools and nothing else, pinned by a build-failing test. A verb
fires on a **checksummed ISBN** or an unambiguous pattern, decided before any
model call. A write a model may choose is a write that happens when a model
misreads a sentence.

The checksum is load-bearing rather than decorative: a bare 13-digit run is also
a phone number, an order id and a timestamp, and a real ISBN with **one digit
changed** resolves — confidently, with a cover — to a different book
(`library_catalog/docs/info/isbn-ladder.md` §2).

## 2d. 📷 Photo intake — MEASURED, and deliberately NOT built

The owner's ask was *"an isbn **or a photo**"*. The ISBN half shipped; the photo
half is recorded here as a design rather than half-built, for a reason that is
about correctness rather than effort.

**Measured 2026-08-18, from the sources:**

| Fact | Where |
|---|---|
| the scan-photo endpoint is `POST /api/scan-jobs/single`, body `{ data: <base64, no data: prefix>, mediaType }` | `library_catalog/apps/worker/src/routes/scan-jobs.ts` |
| accepted types jpeg/png/webp; **5 MB decoded ceiling**, 413 with words above it | same file, `MAX_PHOTO_BYTES` |
| gated `scanPhoto` = **moderator+**, because it bills the vision API | `packages/core/src/capabilities.ts` |
| the photo is **never stored** — no R2 binding exists and must not | `wrangler.toml` §7 |
| it produces a **scan job in `review`**, i.e. a PROPOSAL — it does not add anything | `readPhoto()` |
| turning reviewed lines into rows is `addLineToCatalog`, which lives in the **web app** and asks the pre-order and rescan questions | `apps/web/src/lib/catalog-add.ts` |
| ⚠️ **today a photo DM with no text is silently ignored** — `mentionTrigger` reads `content`, which is empty, and returns `empty_question` | `apps/discord-worker/src/mentions.ts` |

**Why it is deferred rather than shipped.** An ISBN is a *checksummed
identifier* that resolves to a specific edition. A cover photo yields a **title
and author string** — and this estate has measured, twice, a title+author match
scoring **1.0 on both axes and being the wrong book** (*Firefight*, *Unsouled*;
isbn-ladder.md §4.4–4.5). T1 is "additive with easy undo", and a wrong book
added under a name that already matched is precisely the write that is *not*
easily undone, because it looks right. The existing photo flow makes a proposal
a person confirms, deliberately.

**The bounded follow-up, if the owner wants it** (recommended shape): a fourth
delegated verb `add-photo`, gated `scanPhoto`, which fetches the Discord
attachment, forwards the bytes to `/api/scan-jobs/single`, and replies *"I read
N books off that photo — here they are; open this to confirm"* with the deep
link. **Proposal-only**: it reuses the whole existing review flow and adds no
new matching risk. Not verified: whether Discord delivers `attachments` under
the same intent-free exceptions as `content` (the docs gate both on Message
Content, and DMs/@mentions are exceptions to both — but no live attachment has
been tested), and whether a signed `cdn.discordapp.com` URL is fetchable from a
Worker within its ~24 h signature window.

## 2e. ⚠️ PANEL v2 AS BUILT — shipped and deployed 2026-08-18

Owner brief, verbatim: *"Yes this is priority. I want to make upgrades it apply
to both."* The library site's chat panel now runs on **the same conversation
substrate as Discord**, so §1's claim — *"the same conversation-store shape"* —
stopped being an aspiration about a future surface and became a shared module.

### The decision of record: SHARED SHAPE, SEPARATE STORAGE

| | Shared SHAPE (chosen) | Shared STORAGE (rejected) |
|---|---|---|
| What travels | the record, the window, the limits, the alternation rule | all of that, plus the bytes |
| Panel's bytes live in | `library_catalog`'s own D1 (`gabi_conversation`, migration 0350) | the discord-worker's gateway Durable Object |
| A site chat turn depends on | that Worker and its D1 | **the Discord Worker being up** |

⚠️ **Reason #1 is the one that decided it.** The gateway object holds an
always-on socket; when it drops, GABI goes quiet in Discord — and shared storage
would take the *website's* chat down with it, for a person who has never opened
Discord and could not be told why. `gabi-conversation-continuity.md` §1.3 had
already refused it in writing (*"the shape travels, the storage does not"*); the
refusal was re-tested against the real second surface rather than inherited.
Two supporting reasons: a cross-Worker call is a subrequest, and the panel's
whole architecture is an argument about the 50-subrequest ceiling; and it would
need a new trust edge into an object holding a bot session, to buy a property
nobody asked for.

⚠️ **The honest cost, stated in the panel's own words to the reader:** the same
person talking to GABI on the site and in Discord has **two** conversations.
She will not carry a site question into a DM. If that ever becomes wrong, the
fix is a *third* store both surfaces read — never one surface reaching into the
other's.

### What actually moved

`apps/discord-worker/src/conversation.ts` was **split**, and it now re-exports
the shared half so not one of its eight importers changed:

| Moved to `@platform/gabi-conversation` | Stayed in the discord-worker |
|---|---|
| `ConversationRecord` / `Key` / `Turn` / `PendingChoice` | — |
| the 30-min window, the 20-turn cap, the 600-char clip | — |
| `pruneConversation` / `appendTurns` / `conversationChars` / `conversationStorageKey` | — |
| `modelMessages` / `normaliseHistory` / `historyCost` (moved out of `gabi-chat.ts`) | — |
| **new:** `withRemembered()` — the panel's merge | — |
| — | the `gc\|…` / `gcm\|…` `custom_id` vocabulary |
| — | `buildChoiceComponents`, `buildQuestionModal`, `modalInputValue` |
| — | `CONV_MSG` — the sentences she says on Discord |

The library repo consumes it through `scripts/sync-gabi-conversation.mjs` into a
**gitignored `generated/`** — the `@platform/estate-auth` materialise pattern,
third cross-repo package in that repo, same recorded reason (two copies of
`auth.ts`, one hardening).

### ⚠️ The resume rule — the asymmetry between the two surfaces

Discord holds **nothing** between messages, so the store *is* the conversation.
The panel holds its live tab's transcript in React state — `tool_use` and
`tool_result` blocks included, which the store deliberately never keeps — and
re-sends it whole every turn. Prepending the stored window there would send
every turn **twice** and pay for it twice.

So the panel prepends only turns from **other** conversation ids, matched on the
tab id it stamps into `turns[].ref.cid` — the surface-private bag the core never
reads, used exactly as designed. ⚠️ **Never matched on text**: two identical
questions ten minutes apart are a normal thing to ask.

### The panel's key

`conv:web_panel:<ESTATE_APP>:<app_user.id>` — one row **per person per
instance**, so `library` and `library2` are two memories (two shelves, two
conversations). `surface` is the `web_panel` label §1.3 wrote down before the
panel existed. `person` is the `app_user` id rather than the Firebase uid,
because that column is **nullable** in the library schema and keying on it would
give one person two memories.

### What the panel gained, and what it deliberately did not

| Gained | Deliberately not |
|---|---|
| the rolling window, the same limits, the same shape | the **docs tools** — the devops gating they need is its own decision (`gabi-docs-assistant-design.md`), explicitly out of scope here |
| `history_turns` / `history_chars` on its accounting row, **the same field names** | **per-user / per-day turn caps** — the grammar is shared and the constants are one import away, but adding refusals nobody asked for could lock the owner out of his own catalog mid-conversation. An owner decision, not a build one |
| the alternation rule, so a window cut cannot 400 its prompt | **`pending` components** — the panel writes `null`; its clarifying question is prose in a chat box. A T2 confirm lane would be the same shape |
| a `Picking up where you left off` line, shown only when something was remembered | a **second route** — the posture test pinning `POST /turn` as the only declaration is untouched |

### ⚠️ NOT VERIFIED

- **No person has held a real conversation against the deployed memory** on
  either instance. Everything below the model call is proven by tests and by
  direct SQL; the end-to-end "ask, close the tab, come back, she remembers" is
  the acceptance test and it is unrun (`library_catalog/docs/TODO.md`).
- **No model call was made by this build** — `history_turns` / `history_chars`
  have never been compared against a real invoice on the panel.
- **The 30-minute expiry has never been observed in production** on the panel,
  only in tests with a synthetic clock.
- **Discord's behaviour is unchanged but that is a test result, not an
  observation**: 514/514 still pass and `tsc` over `src` is clean; no live
  Discord conversation was held after the split.

## 3. Feature suggestions, by effort

**Near (machinery exists, wiring needed)**
- **Catalog Q&A tools (T0)** — read-only tool calls against the catalogs'
  APIs, scoped by the asker's visibilities. The panel's GABI_TOOL_NAMES
  allowlist idiom carries over verbatim.
- ~~**ISBN intake by DM (T1)**~~ — **SHIPPED 2026-08-18**, §2a. The prediction
  that "Discord is just a new front door" held for the lookup ladder and did
  **not** hold for the commit half: the web app's `addLineToCatalog` asks a
  four-way question a bot must not answer, so the delegated verb writes only
  the additive cases and hands the question back.
- ~~**"Fix my missing details" (T1)**~~ — **SHIPPED 2026-08-18**, §2a. It is
  literally the hourly sweep, one function, with `triggeredBy` carrying the
  asker where the cron passes `NULL`.
- **Docs assistant (owner/devops only)** — publish a docs snapshot behind an
  estate-gated endpoint; she answers "how do I promote?" when no Claude
  session is open. ⚠️ Needs its own design pass: audiobook docs are
  local-only today, and access-runbook content deserves the devops gate.

**Middle (new but bounded)**
- **Photo intake (T1)** — ⚠️ **measured 2026-08-18 and deliberately not built;
  §2d has the numbers, the reason and the recommended shape.** Short version: a
  cover photo yields a title+author string, and a title+author match has scored
  1.0 on the wrong book twice in this estate. Proposal-only is the honest
  version, and it is a bounded follow-up.
- **T2/T3 confirm verbs** — the continuity build's buttons/modals are the
  exact machinery confirms need; the verbs plug in behind them.
- **Proactive pings** — poll posting (built, needs a channel), new-book
  announcements (club webhooks exist), CW-fulfillment "your book arrived."

**Later**
- **Moderation revival** — timeouts + cleanup are built and dark; owner
  flips MODERATION_ENABLED and re-registers when ready.
- ~~**Panel chat-button v2**~~ — **SHIPPED 2026-08-18, §2e.** The site panel
  runs on the shared substrate, so an upgrade to how she remembers lands once.
  ⚠️ Shared SHAPE, **separate storage** — a site chat turn must not depend on
  the Discord Worker being up. The acceptance test (a person, a closed tab, a
  return inside half an hour) is **unrun**.
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

1. ~~Conversation continuity~~ **SHIPPED 2026-08-17**
2. ~~Wake-up: her key + `GABI_MENTIONS=on` + gateway start~~ **SHIPPED 2026-08-17**
3. ~~Catalog Q&A tools (T0)~~ **SHIPPED 2026-08-18**
4. **T1 intake: ISBN ✅ + blank fills ✅ SHIPPED 2026-08-18** (§2a); photo
   **measured and deferred** with a recorded design (§2d)
5. Docs assistant (design first: snapshot + devops gate) — in flight
6. **T2/T3 confirm verbs on the components machinery.** ⚠️ The instance-choice
   menu built for T1 is the first working instance of exactly this shape: a
   `PendingChoice` whose press performs an ACTION rather than producing a
   sentence. A T2 confirm is that with one option and a restatement.
7. ~~Panel chat-button unification~~ **SHIPPED 2026-08-18** (§2e) — jumped the
   queue on the owner's call: *"Yes this is priority. I want to make upgrades it
   apply to both."* Moderation revival still waits on him.
