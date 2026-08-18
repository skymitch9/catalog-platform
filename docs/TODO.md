# TODO — catalog-platform (ACTIVE work log)

> **Split 2026-08-16** per the global "Access & information docs" rule:
> `TODO.md` is **ACTIVE ONLY**, [`DONE.md`](DONE.md) is the dated archive
> (newest first, **append-only**), and durable reference belongs in
> [`info/`](info/README.md) / [`access/`](access/README.md), findable by topic.
>
> Twelve finished sections moved out — including two that had drifted into
> **contradicting each other**: the estate API testing suite appeared once as
> "✅ DONE" near the top and again as "queued next" at the bottom. Both are
> archived; the later one is marked as the superseded duplicate.
>
> ⚠️ Sections moved **whole — cut and paste, never summarised**, because the
> summary always drops the *why*.
>
> ⚠️ An archive is not a competing living doc. Do not re-merge it here.

## 🟡 GABI READS THE ESTATE DOCS — LIVE; ONE OWNER STEP LEFT (the relink) (2026-08-18)

⚠️ **Step 2 (flip `GABI_DOCS`) is DONE — the owner flipped it on 2026-08-18.**
⚠️ **THREE live failures on the night of the flip, all fixed and deployed.**
Both incidents are written up in
[`info/gabi-docs-assistant-design.md`](info/gabi-docs-assistant-design.md):

| # | Symptom | Cause | Where |
|---|---|---|---|
| 1 | answered from the **book shelf** | offering the docs tools is not routing to them | **§12** |
| 2 | *"…couldn't put an answer together"* | tool loop truncated, returned null | §12 (2nd defect) |
| 3 | posted *"Let me read the promoting section:"* then **silence for ever** | the loop's exit guard treats any non-`tool_use` stop as the final answer | **§13** |

⚠️ **#2 and #3 share a root cause.** §12 raised the token ceiling, which moved
the failure rather than removing it — the exit guard was always the bug. Every
transcript is now a regression test.

**What is left is step 1 below — the relink — which was never done.** Until it
is, every docs question correctly answers *"your link was made before I could
check estate roles."*

All six phases shipped and are archived in [`DONE.md`](DONE.md); the as-built is
[`info/gabi-docs-assistant-design.md`](info/gabi-docs-assistant-design.md) §§10-11
and the runbook is [`access/estate-docs.md`](access/estate-docs.md) §§8-10. **Only
the two owner steps remain**, which is why this stub is here rather than nothing.

Owner ask, verbatim (2026-08-17): *"let's make sure GABI can read all of our docs
and stuff so she can even help me if needed for let's say I don't have a Claude
code session open."*

### 🧑 Step 1 — re-link, ONCE (about ten seconds)

In Discord: **`/link`**, then press the button on the page. ⚠️ Do this **first**.

Links written before 2026-08-18 carry no email and cannot be upgraded from
outside (owner decision: relink, no backfill). Until you re-link, a docs question
answers *"Your link was made before I could check estate roles. Re-run /link once
and I'll be able to answer this."* — which is the designed sentence, not a fault,
but it will be the first thing you see otherwise. `/unlink` first is not needed;
the ceremony overwrites.

### ✅ Step 2 — flip the posture — DONE 2026-08-18

`GABI_DOCS = "on"`, deployed, and <https://discord.heygabi.ai/api/health> reports
`gabi_docs_ready: true`. Turning her back off is the same one line to `"off"`
plus a deploy.

### Then test it — DM her

> **how do I promote the audiobook site?**

Expect: she searches, reads a section, and answers **citing the file path and the
snapshot's publish date**. Follow up with *"and how do I roll it back?"* — the
memory should carry it without you repeating yourself.

⚠️ **Watch the first few answers for the one thing that is genuinely unproven:**
whether she reaches the *right file*. Measured live 2026-08-18, `promote prod`
returns 124 matching sections and the **top hit is a `DONE.md` handoff entry, not
the promotion runbook** — the archives are in by your own decision (§9.3) and
search ranks headings over bodies, so archive noise can outrank the runbook. She
is instructed to search-then-read, which should recover it. If she keeps citing
archive entries instead of runbooks, that is the signal to revisit ranking (or to
drop `DONE.md` from the publisher's allowlist), and it is design §11.9's
first-listed open question.

### Turning her back off

The same one line to `"off"` and deploy. OFF is not silent — a docs question
still gets *"reading the estate docs from Discord is switched off"* rather than
falling through to a shelf search that finds nothing and reads as broken.

### ⚠️ What is deliberately NOT done

- **Nothing links to `/docs/`** (carried over from the phase-6 item). Not on the
  front door, not in `/status`'s Operations section where the runbook links live
  and where it probably belongs. Left unlinked rather than guessed at.
- **The scanner is still in SHADOW.** Flipping it to enforce still wants a week
  of clean output; today's evidence is a handful of clean passes, not a week.

## 🔑 ESTATE SSO — BUILT + DEPLOYED, INERT PENDING ONE OWNER CONSOLE STEP (2026-08-18)

Owner ask, verbatim, after hitting it himself: *"Ebooks makes me login every
time why is it not inheriting login from main page?"* — approved 2026-08-18
("3 yes"). Design of record: [`info/sso-design.md`](info/sso-design.md); the
as-built account is **§8c** there.

**Phases 1–3 are built and deployed. The whole thing does nothing yet**, on
purpose: `TOKEN_SIGNER_KEY` is unset (measured 2026-08-18, `wrangler secret
list`), so the mint route 503s and every surface behaves exactly as before.

### 🔴 The one owner step that switches it on

Create the zero-IAM-role `estate-token-minter` service account and
`wrangler secret put TOKEN_SIGNER_KEY` — [`access/estate-auth.md`](access/estate-auth.md)
§6 step 3, which now carries the full context. **No redeploy follows it.**
⚠️ That section also carries the **BOM warning**: a PowerShell-piped secret
picks up an invisible UTF-8 BOM, and a BOM'd signing key fails *while looking
valid*, estate-wide, with nothing pointing back at the cause.

### Adopted this pass

`heygabi.ai` + `www` · `library.heygabi.ai` · `padhard.heygabi.ai` ·
`boardgames.heygabi.ai` — all deployed and verified serving the code.

### ⛔ Still queued

- **`audiobook_catalog/site/identity.js`** — covers `audiobooks.heygabi.ai`
  **and `ebooks.heygabi.ai`, the site the owner actually complained about.**
  Deliberately skipped: a concurrent agent held that tree for a P1 iOS reader
  bug. Step-by-step recipe in `sso-design.md` §8c.5, including Q5's
  legacy-mirror guard. ⚠️ Audiobook two-lane rule applies — pushing `main`
  publishes `/dev/` only; it reaches both live hostnames on the next
  **promote**.
- **Phase 4 (optional polish)** — sessions list + per-device revoke on the
  apex `/admin` page. Never built ⇒ sign-out stays "this origin + the
  cookie", which is livable indefinitely.

### Owner test, once the secret is set

Sign in on `heygabi.ai`, then open `library.heygabi.ai` in a new tab —
expect to arrive **already signed in**, no tap. ⚠️ Not testable by any agent:
it needs a real signed-in browser.

## 🎧 AUDIOBOOK PLAYER — PHASES 0a/0b/1 SHIPPED; **PHASE 2 (the player) IS NEXT**

Design of record, all six owner decisions settled:
[`info/audio-player-design.md`](info/audio-player-design.md) — §12 for the
decisions, **§10.1 for phase 1 as built**. Requirements verbatim: position
remembering · speed to 3x · PWA · 15s back/forth · next/prev chapter · chapter
select + view · sleep timer · **scrub bar per chapter not per book**.

**Landed 2026-08-18 — the plumbing, and nothing that plays.**

| Phase | What | Where |
|---|---|---|
| 0a | exact-seconds chapters (`start_sec`) | `audiobook_catalog/app/tools/extract_chapters.py` |
| 0b | `estate-audio` bucket, boto3 multipart ingest, the `audio_requests` queue + rules, fulfiller as pipeline STEP 5.9 | `audiobook_catalog/scripts/upload_audio_r2.py`, `app/tools/fulfill_audio_requests.py` |
| 1 | `GET\|HEAD /api/audio/:anchor/file` + `GET /api/audio/status`, the re-sized listening budget, the manifest publish path, and the site's **request** button | `catalog-platform/apps/audiobook-worker/src/audio-*.ts`, `listen-budget.ts`; `audiobook_catalog/scripts/publish_audio_manifest.py`, `site/audio-request.js` |

🔗 **Try it:** <https://audiobooks.heygabi.ai/dev/> — open any book; under the
metadata there is now *"🎧 Not streamable yet — request it"*.
⚠️ **`/dev/` only.** The site half is on `main`, so it **rides the next
promote** to reach the site root and `ebooks.heygabi.ai`.

### 🧑 OWNER — the one thing nothing automated can stand in for

**Request a real book, then let a pipeline run fulfil it.** Nothing has ever
been streamed: the bucket is empty by design, so the 206 path has never met a
real 601 MB m4b. Suggested first book: **Skyward (Brandon Sanderson)** —
mid-sized, an unambiguous title, and the one every doc and test fixture already
names, so a failure is easy to trace. Press request, wait for the next 8-hourly
run, then `python -m app.tools.fulfill_audio_requests --status`.

### ⏳ Phase 2 — the player, and the two things it MUST carry

1. **The auth seam** (design §3): `<audio src>` cannot carry a bearer, so a
   service worker injects it. ⚠️ Its failure mode is a **silently dead play
   button**, and §3.2 item 5's page-level `HEAD` probe is the mandatory
   mitigation — the byte route already answers HEAD for exactly this reason.
2. **Eviction's access timestamps** (§10.1): `last_stream_at` is still null for
   every object, so `evict_candidates()` correctly refuses to delete anything.
   The shape to build is written out in §10.1 — a throttled
   `audio_streams/{anchor}` stamp through the service account, ⚠️ **plus a new
   `firestore.rules` clause and its own live smoke**.

Also then: re-derive the listening budget from a REAL session (§10.1's numbers
are arithmetic over measured inputs, not a measurement), and decide whether the
audio routes re-word the shared gate's ebook-shaped 401.

## 🗃️ GABI CATALOG Q&A — TIER 0 SHIPPED 2026-08-18; two pieces did NOT

Tier 0 (`catalog_lookup`, `series_volumes`) is live — the original item moved
whole to [`DONE.md`](DONE.md). What remains is here because it was measured as
out of reach, not because nobody got to it.

**1. `person_context` — the asker's own TBR and reading positions. NOT BUILT.**
Measured 2026-08-18 rather than attempted:

- **TBR is keyed on a DISPLAY NAME, not a uid.** `readingLists/{displayNameLower}_{bookId}`
  (audiobook_catalog `site/reviews.js`, whose own comment says the order is the
  REVERSE of a review's and may not be harmonised because the ids already exist
  in production). Two members sharing a display name would read each other's
  list. That is an identity-safety question, not a plumbing one, and it wants
  the owner's call before anything reads it.
- **Reading positions ARE properly keyed** — `readingPositions/{uid}_{bookId}`,
  and `discord_links/{discordUserId}` carries `firebaseUid`, so the join is
  sound. What it needs is a Firestore `:runQuery` with a `__name__` prefix
  range plus a typed-value decoder; this Worker has only ever done single-doc
  GETs.
- ⚠️ **It would also put `firestoreRequest` / `mintAccessToken` into the mention
  path**, which was 100% credential-free — a property `test/mentions.test.ts`
  asserted against `mention-flow.ts`'s source. Shipping it means deciding to
  give up that property on purpose.
  ⚠️ **UPDATE 2026-08-18: that decision has been made, for a different feature.**
  The owner approved T1 (see the write-verb ladder section below) and the write
  path shipped, so the property is gone — but note what replaced it, because it
  is the shape `person_context` must now fit into rather than a licence to add
  credentials anywhere: **credentials live in `delegated-exec.ts` and nowhere
  else**, reached only through an injected port, pinned by a source-reading
  test over eight files. A `person_context` tool would still be a MODEL-chosen
  read, which is a different and stricter category — the Tier-0 tool surface is
  still credential-free by construction and `toolsForApi()` is asserted to
  contain nothing else. The TBR display-name identity question below is
  untouched by any of this and remains the real blocker.

**2. Cross-catalog counting. STRUCTURALLY UNREACHABLE from Discord.**
The owner asked the live bot *"how many books do we have in all the libraries
from Brandon Sanderson and his related authors, include universes like Wheel of
Time, Cosmere and Reckoners"*. Measured against the live index, anonymously:

| endpoint | result |
|---|---|
| `GET /api/search?source=audiobook` | **200** — the public audiobook slice |
| `GET /api/universes` | **401 `{"error":"unauthenticated"}`** |
| `GET /api/universe/:name` | **401** |
| `GET /api/series` | **401** |

Only `/api/search` sits above the index's `requireEstateMember()` blanket, and
`searchScope()` resolves an anonymous caller to `{audiobook}`. Widening needs a
Firebase ID token Discord cannot produce. Tier 0 therefore counts the audiobook
shelf exactly and **says so on every result** (`COVERAGE_NOTE`), rather than
implying an estate-wide total. Closing this needs one of: an estate app-token
pair for the index (`ESTATE_APP_TOKEN_DISCORD`) with a server-to-server
widening path that does not exist yet, or public read-only universe/series
counts on the index — an owner decision about what the anonymous internet may
count, not a build task.

**Also measured, and worth knowing before anyone "fixes" it:** the estate's
shared universe list holds **16 universes and Wheel of Time is not one of
them**, and the audiobook shelf holds **zero** Robert Jordan rows. So the right
answer to that part of the owner's question is "that isn't a universe we
record", which Tier 0 now says explicitly (it returns the real 16 rather than a
bare 0).

## 🔑 GABI WRITE-VERB PERMISSION LADDER — ✅ APPROVED BY OWNER 2026-08-17 ("that looks good, start with that")

Asked: *"what api permissions should she have? Can I dm her an isbn or a
photo and she adds it to the catalog? What if I need her to do some club
resets like change the admin to a book club?"* Proposed ladder (GABI holds
NOTHING herself — she borrows the linked asker's role, verified by the
destination site): T0 lookups (live) · T1 additive-with-undo auto-apply
(add-by-ISBN/photo, blank fills) · T2 mutations propose→confirm-button ·
T3 people/club changes restate→confirm, asker must hold the capability ·
T4 never-from-Discord (estate grants, deploys, money, moderation-config).

### ✅ T1 SHIPPED + DEPLOYED 2026-08-18 (owner: *"all of it"*)

⚠️ The item stays HERE rather than moving to `DONE.md` because it is not
finished: T1 is one rung of a five-rung ladder, and an item moves once, whole,
at completion. What landed, and what did not:

- **`add-isbn` and `run-details` are LIVE** on both library instances, driven by
  a DM or an @mention. As-built account: [`info/gabi-application-map.md`
  §2a–2d](info/gabi-application-map.md); owner's live test script (the exact
  DMs to send): [`access/discord-bot.md` §13.4](access/discord-bot.md).
  Commits `67ec937` (bot) and library `5b4b860`; Workers `e508302f` /
  `7fdbe01b` / `5886875e`.
- **The delegation seam as built**: `ESTATE_APP_TOKEN_DISCORD` (one value,
  THREE holders, same name) proves only *"this is the estate's Discord
  Worker"*; the **destination catalog** resolves the on-behalf-of Firebase uid
  to its own `app_user` row and checks that person's `editCatalog` /
  `runResearch`. Pairing **verified live** on both instances 2026-08-18.
- ⚠️ **The credential-free mention path ended here, deliberately** — see the
  Tier-0 section above, which recorded that shipping a write *"means deciding
  to give up that property on purpose"*. The owner's approval is that decision;
  `test/mentions.test.ts`'s assertion was **repointed**, not removed, at the
  narrower property (credentials only in `delegated-exec.ts`) and given teeth
  by a second source-reading test.
- 📷 **Photo intake: MEASURED AND DEFERRED**, not half-built — application map
  §2d has the numbers and the recommended proposal-only shape. Short version: a
  cover photo yields a title+author string, and this estate has twice measured
  a title+author match scoring **1.0 on the wrong book**. *"Additive with easy
  undo"* does not cover a wrong book added under a name that already matched.
- ⛔ **Still open: T2/T3 confirm verbs — ✅ DESIGNED 2026-08-18, not built.**
  Full grammar: [`info/gabi-confirm-lanes-design.md`](info/gabi-confirm-lanes-design.md).
  The instance-choice select menu is the right machinery, but ⚠️ **"one option
  and a restatement" understates it**: the hard part is the restatement still
  being TRUE when somebody presses, which needs **compare-and-set on the
  `before` values** and a worded 409 — the `firestore.rules` `hasAll` incident
  generalised. Also decided: the proposal lives in the existing `pending.*`
  slot (**zero new Durable Object writes**), the capability is checked at
  **both** propose and press, ⚠️ **club deletion is T4 not T3**, and ⚠️ **T2
  cannot touch the audiobook surface until it has an audit seam** (it has no
  `change_log`). Phase 1 is **one verb** (`fix-field`), ~200 k. **5 owner
  questions** in §11 — the first is `changed_how` `'human'` vs `'auto'`, which
  no later migration can recover.
- 💤 **Someday: bare `heygabi` triggers** —
  [`info/gabi-bare-text-triggers-memo.md`](info/gabi-bare-text-triggers-memo.md).
  ⚠️ **The estate's docs carry a superseded fact**: the privileged-intent gate is
  no longer *100 servers* but **10,000 unique users** (Discord, June 2026) — so
  there is **no gate**, just a portal toggle, reversible in a minute. ⚠️ The
  intent **cannot be scoped to channels** (verified against Discord's docs);
  only the handler can drop messages, and the memo pins what "unlogged" can
  honestly promise. **Recommendation: not yet** (DMs already give a zero-`@`
  surface; deferring costs nothing) — **owner's decision, with flip conditions
  written down.**
- 🧑 **OWNER EYEBALL — nothing here is verified by a real Discord message yet.**
  No `change_log` row wearing `gabi-discord` exists in production, and the
  async sweep report has never been posted by a live gateway. `access/discord-bot.md`
  §13.4 is the three-message test; §13.6 is the full not-verified list.

## 🚪 DEV ACCESS in the estate (owner, 2026-08-17) — IN FLIGHT

Owner's words: *"i need a way in the estate to manage dev access for ebook,
add a button for give dev access also make devops always able to see dev
envs. in the meantime grant Samantha dev permission."*

- Meantime grant DONE 2026-08-17: Samantha holds the estate **devops** flag
  (granted via /admin two-tap, badge verified on the rendered page 22:13:28).
- ~~This repo's half~~ **SHIPPED 2026-08-17** — commit `be6f15c`, migration
  `0011_dev_access.sql` applied `--remote` (12 rows, 0 hand grants, 4 devops
  who hold it by the OR), Worker version `265c6131-b0c1-4960-9385-e780025a06f2`.
  Grammar recorded in [`access/estate-auth.md` §10](access/estate-auth.md).
  ⚠️ It stays HERE rather than moving to `DONE.md` because the item is not
  finished: the audiobook half below is the other half of the same ask, and an
  item moves once, whole, at completion.
- **STILL OPEN — audiobook_catalog's half** (the dev ebook pages' worded
  curtain), queued in THAT repo's local TODO behind the save-spot build.
  Nothing there consumes `dev_access` yet, so the flag's end use is
  unexercised. ⚠️ Curtain, not lock: the `vis_ebooks`-gated manifest/stream
  APIs stay the real lock on both lanes.
- 🧑 **OWNER EYEBALL** — <https://heygabi.ai/admin/>, signed in: open any
  member's card and look at the button row. A plain member gets a two-tap
  **Give dev access** button (and a `DEV ACCESS` badge beside their status
  once granted); a devops or approver gets the WORDS *"dev access · via
  devops"* where that button would be, because they already hold it and a
  button there could not change the answer.

## 🧑 OWNER EYEBALL: the reshaped /admin page, signed in (2026-08-17)

The control-grammar reshape + full permission map shipped (see
[`DONE.md`](DONE.md), newest entry; grammar recorded in
[`access/estate-auth.md`](access/estate-auth.md) §9). **Everything a predeploy
marker can assert is chrome** — the member table is injected only after
Firebase sign-in, so the part that matters is unverified until someone signs in.

🔗 <https://heygabi.ai/admin/> — three things to look at:

1. **Open a member.** One row per site, the same four columns on every row
   (site · visible · role · what that role can do), and a role dropdown on
   *every* site — not just Audiobooks/Ebooks.
2. **Change something.** Nothing should write; the control outlines and a
   **Save permissions** button *appears* on that card with a count. Save →
   one worded sentence naming exactly what changed.
3. **"Permission map — every site's ladder"** at the top: four subsections,
   one per site, in the same order as the grid.

Report anything that still feels like a different experience per site — that
is precisely what this was for.

## 🧑 OWNER EYEBALL: read a PDF in the browser, signed in (2026-08-17)

**Viewer phases 1a + 1b shipped** — the gated byte stream
(`audiobook-worker` `41206de4`) and the PDF reader (`audiobook_catalog`
`af57fbb`, on the **dev lane**). As-built record with every measurement:
[`info/ebook-viewer-phase1.md`](info/ebook-viewer-phase1.md).

⚠️ **Everything an agent could verify is the UNAUTHENTICATED half.** No agent
holds a Firebase ID token, so the live checks are 401s, their headers and CORS
preflights. The renders were measured against **local files over a local
server** — the full path (token → gate → R2 → range → canvas) is assembled and
has never once been exercised end to end.

🔗 <https://audiobooks.heygabi.ai/dev/ebooks> — tick **"Show PDFs"**, tap any
PDF, press **Read**. Four things to look at:

1. **Does a page appear at all?** That is the whole question. If it does, the
   bearer-per-range design works end to end and phase 2 inherits a proven pipe.
2. **Try the 181 MiB Stormlight handbook** (`SL001_Stormlight_Handbook_digital.pdf`).
   It should open to page 1 in a couple of seconds having transferred ~2.5 MB,
   not 181 MB — devtools Network, sum the sizes. This is the one that would
   have been 183 MB before the `disableStream` fix.
3. **Turn some pages, zoom, resize.** One canvas is live at a time by
   construction; a page turn is a few range requests.
4. **Open an EPUB card.** There should be NO Read button, and a one-line note
   saying browser EPUB reading is not on yet. If a Read button appears there,
   that is a bug.

⚠️ **This is the DEV lane. `ebooks.heygabi.ai/read` does not exist until a
promote** — `ebooks-door` proxies to the PROD origin, deliberately. What rides
the next promote: the reader page, `site/reader.js`, the vendored pdf.js, the
`/read` CSP block, and the shelf's Read button.

## 🔴 Audiobook Phase 3 (enforce) — ⚠️ SUPERSEDED 2026-08-17: owner chose FORCE-THEN-FIX

**Owner decision (2026-08-17, after full explanation of both paths):** *"Yes
let's do it. We don't have that many users just my friends so we can do our
best to fit roles right away and then promote people as needed. As long as
club mod and owners stays we're in good shape."* The week-long soak ceremony
is dead; the flip happens the moment the soak-recorder build lands, so day
one of enforce is fully recorded and the retained log becomes the live
who-needs-a-role-bump list. ⚠️ THE FLIP'S ACCEPTANCE CRITERIA, from his
words: **owners keep max everywhere (OWNER_EMAILS + auto-max), site
moderators keep their standing, and club managers keep their club powers**
(the island logic shipped 2026-08-17). Pre-flip check enumerates those three
classes; post-flip verification exercises what it can and names what needs
the owner's eyes. Reverting is one var back to "shadow" — the fail-safe that
made force-then-fix acceptable. Executor: the CONDUCTOR flips
(trust-critical), never an agent.

(The original blocked-on-evidence section follows for the record; blockers
1-3 are closed by 2026-08-17 builds, and blocker 4's "exercise the surfaces"
now happens live under enforce.)

**Evidence pack:
[`info/audiobook-auth-soak-2026-08-16.md`](info/audiobook-auth-soak-2026-08-16.md)
(2026-08-16 23:21 MST). Verdict at the time: NOT ENOUGH EVIDENCE.

Measured: prod-lane reporter live **1h 52m** (the server's 4h 17m is *not* the
soak — until the prod promote at ~21:29 MST, prod visitors reported nothing).
A 5-minute tail caught **3 worker requests, all of them the probes themselves**
— **zero organic gate decisions**. Household false denials: **0 of 0**, i.e.
⚠️ **unmeasured, not clean.** Per the design's own rule, a surface nobody
exercised has not soaked.

Blockers to clear before the re-run is worth taking (all out of scope for the
read-only pack — none were done):

⚠️ **THE SOAK RECORDER LANDED 2026-08-17 — blockers 1, 2 and 3 are CLOSED.**
Worker version **`8cdf7c88-50c5-4895-b13d-3cb2f7d35198`**; `ESTATE_CHECK` was
**not touched** and remains `"shadow"` (this build records, it never
enforces — the flip stays the conductor's, per the decision above). The
re-run command, the retained lines, and two gotchas that would otherwise cost
an hour are in
[`info/audiobook-auth-soak-rerun-2026-08-17.md`](info/audiobook-auth-soak-rerun-2026-08-17.md).

1. ✅ **CLOSED 2026-08-17 — shadow decisions now PERSIST.** `[observability]
   enabled = true` shipped; the LIVE Worker's settings read back
   `logs {enabled:true, persist:true, head_sampling_rate:1}`, and three
   synthetic reports were **queried back out of Workers Logs ~5 minutes after
   emission** — retrospectively, from a window that had already closed. That
   is the capability day-one-of-enforce depends on, and it is measured, not
   assumed.
   ⚠️ Its precondition was met FIRST, as this item demanded: the cleartext
   `email` is **gone** from both gate lines (`ab_gate_shadow` and the enforce
   twin `ab_gate`), replaced by `email_hash` (salted SHA-256, one-way) +
   `identity_class` (owner/household/outside/anonymous) — so the retained
   who-needs-a-role-bump list keeps its counts, its per-person grouping and
   its owner-vs-household split while holding no addresses. A test asserts no
   `@` reaches a line at all.
   ⚠️ **Two gotchas:** the observability query API **refuses wrangler's OAuth
   token** (and wrangler 4.123 ships no observability subcommand — use the
   dashboard's own API with its session cookie), and Workers Logs **drops
   null-valued keys**, so *absent means null*. **Nothing for the owner to
   click** — enablement is entirely in `wrangler deploy`.
   ⚠️ Unfixable and unchanged: the ~4h that soaked before 2026-08-16 23:16 is
   permanently gone. Retention starts now.
2. ✅ **CLOSED 2026-08-17 — a would-deny can now be told from a real break.**
   The site payload carries `succeeded`, threaded through all 24
   `reportGate()` call sites (a local flag set on the one success path, so an
   early `{success:false}` from *inside* a try reports honestly as a failure),
   and the receiver parses and logs it strictly: `true`, `false`, or `null`
   for "cannot say" — never coerced. Under force-then-fix this is the field
   that matters most: after the flip, **`denied:true` + `succeeded:true` on
   the shadow record is the person to promote**, while a denial on something
   `firestore.rules` already refused is nobody's problem. Pinned by the same
   literal in BOTH repos' tests, because the halves deploy independently.
   ⚠️ **The site half rides the next owner-worded promote to prod.** `main` →
   `/dev/` has it; until a promote, prod reports carry no outcome and log
   `succeeded` absent (= "cannot say"). ⚠️ **If the flip happens before that
   promote, day one of enforce is recorded WITHOUT the outcome bit on prod** —
   worth sequencing deliberately rather than discovering afterwards.
3. ✅ **CLOSED 2026-08-17 — 25 of 25 gated actions now report.**
   `updateReadLabel()` reports `read.setSlot`; the vocabulary gap is gone.
   ⚠️ **What that made visible, and did NOT decide — read this before the
   flip:** `read.setSlot` carries a `manageClub` (admin) floor while the label
   is **member-editable by design** (the migration design's own §1 table, and
   `firestore.rules` deliberately keeps `slotLabel` out of
   `MANAGED_READ_FIELDS`: "commentCount bumps and slot labels stay open"). So
   an ordinary member renaming a read card is a **predicted real break** at
   enforce — it will log `would_deny:true` with `succeeded:true`. 🧑 **Owner
   decision:** lower the floor for this action, or route the label away from
   `read.setSlot`. Under force-then-fix this is one of the few breaks that can
   be named IN ADVANCE rather than discovered from the log, so it is cheap to
   settle first. Do not "fix" it by removing the report.
   The content-warning half was already closed earlier that day: ✅ **CLOSED
   2026-08-17** (owner-approved): the action was SPLIT into
   `warning.selfDelete` (`{kind:'signedIn'}`, member floor) and
   `warning.modDelete` (`operateClub`, unchanged), `site/user-warnings.js`
   now imports `gate-shadow.js` and reports the right one per case, and
   `firestore.rules` was tightened from `allow delete: if true` to
   author-or-moderator on `user_content_warnings{,_dev}` (author bound by a
   new `authorUid` field; rules deployed and smoke-tested). So the owner
   decision this item asked for is answered — a member self-delete is a
   member floor and will not be denied at enforce.
   ✅ The worker deploy this item was waiting on **landed 2026-08-17**
   (version `d5752cca-5435-4f63-a06f-788b39f53fca`); `warning.selfDelete` was
   confirmed on the live tail to resolve rather than log `unknown_action`.
   ⚠️ Still unmeasured: neither warning action has an ORGANIC report yet.
4. 🟢 **Exercise the surfaces deliberately** — ⚠️ **the reason they COULD NOT
   be exercised is fixed 2026-08-17** (owner-approved CLUB MANAGER package;
   catalog-platform `fe30cb0`, audiobook_catalog `84009e7`). The blocker was
   not shyness about testing: `club.setWebhook` / `club.clearWebhook` /
   `club.claimManager` were all `administerClub`, admin-floor, club island
   **off**, and `club.claimManager` was **self-blocking** — it is how one
   *becomes* a manager, so no non-admin could reach the island at all.
   Now: `administerClub` is island-held at a moderator floor, and
   `claimManager` is its own rule (unclaimed → any live session, claimed →
   moderator+ override). `firestore.rules` enforces the same shapes live —
   **18/18 REST smoke assertions** against the deployed rules, re-runnable
   via `audiobook_catalog/scripts/smoke_club_manager_rules.py`.
   **Still to measure (this is what remains of the item):** a real household
   club manager doing these in a browser. Nothing organic has been logged
   yet; the worker vocabulary is deployed and verified live (version
   `d5752cca-5435-4f63-a06f-788b39f53fca` — `club.claimManager` and
   `warning.selfDelete` both resolve, a control action still reads
   `unknown_action`, and the log line now carries `club_claimed`), and the
   site half rides the next owner-worded promote to prod.

5. 🧑 **OWNER QUESTION — HALF ANSWERED 2026-08-17 by the MANAGECLUB SPLIT
   (option B); the rest is still open.** The question was whether
   `manageClub` should follow `administerClub` down to a moderator floor,
   because a site moderator could not touch a claimed club while a rankless
   member who claimed it could.
   ✅ **Decided and shipped:** the READ LIFECYCLE — `read.finish`,
   `read.remove`, `read.revealRatings` — moved to `operateClub` (island on),
   i.e. manager-of-that-club **or** site moderator+. `firestore.rules`
   enforces it live (36/36 smoke), the worker's dormant arms match, and the
   UI now renders those controls for club managers and moderators. Written up
   whole in [`DONE.md`](DONE.md).
   ⚠️ **Still open, and NARROWER than before:** `features`, `joinMode` and
   `deleteClub` keep the `admin` floor, so the inversion survives for those
   three — a rankless club manager may toggle their club's features; a site
   moderator may not. The owner's line was "running the reading" vs
   "destroying the thing", which settles `deleteClub` (it stays) but does
   **not** obviously settle `features`/`joinMode` — those are neither
   destructive nor part of running the reading. That is the actual remaining
   question. Lowering a floor is access-INCREASING, so it stays confirmed,
   not assumed: one line in `capabilities.ts` plus `canManageClub` in
   `firestore.rules` if the answer is yes.

Owner action available now: `wrangler d1 execute estate_auth --remote` was
**blocked by the permission classifier**, so the estate membership census
(how many approved members, what visibility) is unverified.

## 0. 🤖 GABI Discord bot — LIVE 2026-08-16; the build queue that follows

State: registered (**GABI**, id `1538775435880562758`), worker deployed at
`discord.heygabi.ai` (health all-green), **invited to the owner's server with
the moderator permission bundle** (`1116825807878` — deliberately NOT
Administrator; blast-radius reasoning in `access/discord-bot.md` and the
2026-08-16 conversation; widening later is a role toggle, never a re-invite).
Interactions Endpoint URL save: owner's click, unconfirmed until interactions
arrive.

⚠️ **Phase 2 (the identity-link ceremony) LANDED 2026-08-17** — moved whole
to [`DONE.md`](DONE.md). ✅ **No longer dark**: measured 2026-08-17 at the
`/gabi` deploy, `/api/health` reports `discord_client_secret: true` and
`link_ready: true`, so `access/discord-bot.md` §3 step 7's clicks are done.
`/link` still has to be PUBLISHED via §4 before anyone can type it.

⚠️ **Phase 3 (bot-posted poll messages with buttons) LANDED 2026-08-17** —
moved whole to [`DONE.md`](DONE.md). Live and **shipping dark** until a club
opts in.

⚠️ **`/have` LANDED 2026-08-17** and ⚠️ **moderation (`/timeout` + `/cleanup`)
LANDED 2026-08-17, DARK** — both moved whole to [`DONE.md`](DONE.md). Live at
version `ad35e796-ffd6-44a8-b15e-83bc75bf97ab`.

⚠️ **`/gabi` — THE FIXER'S DISCORD SURFACE, shape (b) propose-and-deep-link
— LANDED 2026-08-17** (queue item 3). Moved whole to [`DONE.md`](DONE.md).
Live at version `03bd6a3a-7f05-4fbe-a846-05bc614f97e6`, commit `4715b03`;
runbook [`access/discord-bot.md` §10](access/discord-bot.md). It ships with all
four of the design's blockers still unsolved, which is exactly what shape (b)
is for: no write, no model call, no new secret.

⚠️ **CONVERSATIONAL GABI, phase A — "@mention her and she answers" — LANDED
2026-08-17, shipped OFF.** Moved whole to [`DONE.md`](DONE.md); the as-built
design is [`info/discord-bot-design.md` §6](info/discord-bot-design.md). Live at
version `fa8140f6-da59-4f0d-b918-0f6a6f7777a7`, commits `74d6bd3` + `cfe768b`.

⚠️ **THE DEEP LINK — asker-aware destination AND `?gabi=` prefill — LANDED
2026-08-18.** Moved whole to [`DONE.md`](DONE.md). Live at version
`c9af75f0-f8e3-4de6-b6ac-81a02c98ce9f`, commits `02c5834` + `a4b5d53`. It grew
from the one-line prefill item recorded here into two halves, because the owner
hit the second one live: the link pointed at `padhard.heygabi.ai` for everybody.

**Everything else outstanding on this whole section is a switch-on, not a build:**

- 🧑 **Owner — TURN GABI'S EARS ON. Three steps, in this order**, and nothing
  happens until all three: she is currently **not connected at all**, not
  merely quiet.
  1. **Paste the Anthropic key** — optional, but it is the difference between
     a lookup bot and a conversation. Mint a **NEW** key at
     `console.anthropic.com` (⚠️ deliberately NOT the library's
     `ANTHROPIC_API_KEY`, so the Discord spend is separately capped and
     rotated), put it in `apps/discord-worker/.dev.vars` after
     `ANTHROPIC_API_KEY_GABI=`, run `wrangler secret put ANTHROPIC_API_KEY_GABI`,
     then blank the line again. Without it she still answers *"do we have …"*
     from the keyword router and never mentions the gap in a channel.
  2. **Flip the posture** — `GABI_MENTIONS = "on"` in
     `apps/discord-worker/wrangler.toml`, then deploy. ⚠️ The owner's decision,
     never an agent's and never a side effect of a deploy.
  3. **Start the gateway** — `POST /admin/gateway/start` with an estate admin's
     Firebase ID token. ⚠️ **This is the ONLY starter.** The cron meant to be a
     second, independent poker could not be installed (this account is on
     Workers Free and its 5 cron triggers are spent), so nothing else will
     create the object, and there is no backstop if its alarm chain breaks.

  Then test it in the server by typing: **`@GABI do we have Mistborn?`**
- 🧑 **Owner, worth knowing BEFORE step 2:** the always-on Durable Object uses
  **~83% of this Cloudflare account's free-plan Durable Object duration
  allowance** (10,800 of 13,000 GB-s/day). It costs **$0.00**, but that is a cap
  which **stops** the object rather than billing for it. ⚠️ A second always-on
  Durable Object anywhere on this account would break it; Workers Paid removes
  the constraint entirely.
- 🧑 **Owner decision, deliberately NOT built — bare-text triggers**
  (`heygabi …` with no `@`). It needs Discord's Message Content privileged
  intent, which the design has refused since §1.5: the bot would receive the
  text of **every message in every channel it can see**, in every server it is
  in. That is a different privacy posture from anything agreed so far.
  Reasoning: [`info/discord-bot-design.md` §6.8](info/discord-bot-design.md).
- ✅ **Identity linking is ON** — `access/discord-bot.md` §3 step 7's three
  clicks were done by the owner at some point before 2026-08-17's `/gabi`
  deploy, and the correction is MEASURED, not assumed: `/api/health` now
  reports `discord_client_secret: true` and `link_ready: true`. This line
  previously said the clicks were outstanding.
- 🧑 **Owner or admin — THE ONE REMAINING CLICK:** run §4's
  `POST /admin/commands/register` (one button on the `/admin` page, CORS now
  open to the apex) — ⚠️ **until someone does, `/link`, `/have` and `/gabi`
  do not exist in Discord at all.** It needs a Firebase ID token from an estate
  admin account, which no agent holds; it is one authenticated POST and it is
  idempotent for a given `MODERATION_ENABLED` state.
- 🎛️ **Conductor / owner:** opt a club in with
  `features.discordPollVoting = true`. `POLL_SYNC_TOKEN` is **set on the
  Worker** (measured 2026-08-17: `/api/health` reports
  `poll_sync_token: true`, `poll_sync_ready: true`) — ⚠️ **not verified** is
  whether the audiobook pipeline's `.env` holds the SAME value, which is what
  makes the tick actually fire on cadence.
- 🧑 **Owner, evidence-gated:** flipping `MODERATION_ENABLED` to `"on"`. ⚠️ It
  has a **second step**: re-run the registration route, because while the
  switch is off the two moderation commands are deliberately not published to
  Discord at all (reasoning in `commands.ts` and `DONE.md`).

## 📚 Series registry — the API is LIVE; what still hangs off it

The registry itself is **done and deployed** (2026-08-17) — the whole record,
including the measured counts and what was NOT verified, is in
[`DONE.md`](DONE.md); the design is
[`info/index-worker-design.md` §8.5](info/index-worker-design.md). Only the
work that has NOT been done is listed here.

1. 🧑 **OWNER DECISION — one near miss is waiting, and the evidence is in.**
   ⚠️ **The build half of this item is finished and moved whole to
   [`DONE.md`](DONE.md) (2026-08-18)** — both the API half (2026-08-17) and
   the `/series` banner that reads it. What is left here is not work; it is a
   decision only the owner can take, so the item is split rather than parked:
   a finished build does not sit in the active list waiting for a human, and a
   human's pending decision does not get archived as done.
   **The row**: *"The Survivalist Series"* ~ *"The Survivalist"* (both
   audiobook, so it may belong in the audiobook catalog's own corrections
   layer rather than as an index merge — that is the decision).
   ⚠️ **`/series` has produced EVIDENCE for it, observed live 2026-08-17** —
   and it points at *separate*, not merge: *The Survivalist* holds one volume,
   **Frontier Justice, Arthur T. Bradley, 2014**, while *The Survivalist
   Series* holds books 6–9 by **A. American**. Two authors, so two series that
   merely share a name; merging would fuse two people's work under one key.
   Resolving it `{"action":"separate"}` would also retire the phantom
   *"Book 1 — nobody in the estate has this one"* row `/series` shows on the
   A. American run — the visible cost of an unanswered queue. **Still the
   owner's call**; recorded as evidence, not as a decision taken.
   ⚠️ **There is no UI for the resolving POST and that was deliberate** — see
   `DONE.md`. Taking the decision today means one authenticated
   `POST /api/series/pending/:fold` with an owner's own bearer.
2. **`/universes`' CSP `frame-src` does not name `auth.heygabi.ai`** — noticed
   while writing `/series`' own rule and deliberately NOT fixed there (a page
   nobody is building is not a page to change blind). `estate-auth.js`'s
   `authDomain` moved to `auth.heygabi.ai` at the SSO Phase 1 cutover
   ([`info/sso-design.md` §4.1](info/sso-design.md)); `/`, `/admin` and the new
   `/series` name it, `/universes` and `/status` do not. ⚠️ Whether it actually
   breaks a sign-in *started from those pages* is **UNMEASURED** — the popup
   path may never need the iframe. Measure first (sign out, sign in from
   `/universes`, watch the console for a frame-src refusal), then fix. Size XS,
   and both the bare and trailing-slash rules need it — that file's 308 trap.
3. *(Moved whole to [`DONE.md`](DONE.md), 2026-08-17 — the universe join now
   reads the SERIES rather than one spelling of it. The number is left
   standing rather than renumbering the list, the same way `DONE.md`'s own
   split kept item numbering so the archive's references still resolve.)*
4. **Decide whether `/api/series` should answer the anonymous internet.** It
   currently takes `/api/universe`'s stance (members-only, scoped) because
   §4.5's anonymous carve-out names `/api/search` alone. Widening is one line
   in `index.ts` plus a named comment — but it is an ACCESS-INCREASING change,
   so it waits for the owner rather than being assumed.
5. **Widen the approver gate if the estate ever exposes `is_approver` on
   `/seen`.** `requireOwnerStanding()` in `apps/index-worker/src/middleware/auth.ts`
   is the single place; it is narrow today only because the shared module does
   not carry the flag to consumers.

---

## 📖 TBR should span all catalogs, the way "read" does (owner ask 2026-08-16)

> *"tbr like read should span all catalogs"*

**Recorded, not started.** Sits with the two entries below it — this is the
same question they are, arrived at from the reader's side rather than the
architecture's.

**What exists today, measured 2026-08-16:**

| Concept | Where it lives | Spans catalogs? |
|---|---|---|
| Reviews + ratings | ONE shared Firestore store, keyed by `bookIdFromTitle` — audiobook and library both write it | ✅ yes, already |
| "read" / reading state | `PUT /works/:id/reading` (`trackReading`), library only | ❌ library's own table |
| **TBR** | Only inside audiobook **book clubs** — a club's Current Read and TBR list | ❌ per-club, not per-person |
| Wishlist | Per catalog (`suggestWishlist` / `manageWishlist` in both library and games) | ❌ separate lists |

So there is a precedent that already works — the shared review store proves a
per-person fact CAN span catalogs — and TBR is the one that most obviously
should follow it: what someone intends to read next does not care whether the
copy is an audiobook, an ebook or a paperback.

⚠️ **The design question this forces, and why it is worth answering once:**
TBR is a **per-person, per-WORK** fact, while every catalog is organised around
**copies**. "I want to read *Wintersteel*" is one intention, even when the
household holds it in three formats. So a cross-catalog TBR needs the same
identity key the reviews already use, NOT a row in each catalog — otherwise
finishing the audiobook leaves the paperback still on the list.

⚠️ **This is the same seam as the ebooks question below.** Shared-pool formats
(audio, ebook) versus owned copies (physical, games) is the split; a spanning
TBR is what it looks like from the reader's side. Decide them together, and
consider whether "read", wishlist and TBR are three names for one per-person
state machine (want → have → reading → read) rather than three features.

**Games:** "all catalogs" plausibly includes a to-PLAY list. Ask before
assuming — it may be the same feature or a deliberately different one.

### ⚠️ SCOPE NARROWED by the owner, 2026-08-16 — read this before building anything above

> *"lets more or less exclude games unless we design a feature thats worth
> adding to it. for now my friend wants to sort her books"*

Two corrections to everything written above, and the second is the important one:

1. **Games are out of scope** for the federation, the cross-catalog TBR and the
   ownership join — unless a feature turns up that is genuinely worth adding to
   games on its own merits. Do not carry games through these designs "for
   symmetry"; it doubles the surface for a use case nobody asked for.

2. ⚠️ **The actual requirement is "she wants to sort her books."** That is not
   the federation, not "who owns what", not a spanning TBR. Those are things
   the OWNER finds interesting about the estate; they are not what the person
   with the books needs. **Build the small thing first.**

**What "sort her books" actually needs, in order:**

| Need | Status today |
|---|---|
| Get her books INTO a catalog without a terminal | Scanning exists and is field-proven; the remote/non-technical ingest story is the real gap |
| Details filled in without her chasing them | The hourly auto-sweep landed for games 2026-08-16; **library is the queued twin and is what she actually needs** |
| Browse/sort by series, author, what's missing | Already the library app's strongest feature — series ladders, gaps, sorting, filters |

So most of what she needs **already exists**; the missing piece is ingestion for
someone remote and non-technical, plus the library details sweep.

⚠️ **Do NOT start with the shared index join.** "See who owns what" is a
SECOND-phase want, and it is cheap to add later precisely because a separate
instance is already an index source. Building the join first would mean
designing a federation for a catalog that does not yet have any books in it.

## 📚 Ebooks may want to be their OWN site — the ownership boundary is per-FORMAT (owner insight 2026-08-16)

Raised mid-conversation and **not yet decided** — recorded because it reframes
the federation question above rather than adding to it.

> *"we might need to now make ebooks its own site because we all share ebooks
> like we do audiobooks but physical books obviously belong to someone"*

**Why this is the sharp observation:** this estate has been splitting catalogs
by MEDIUM (audiobooks / books / games), and the owner has just pointed out the
split that actually matters is by **ownership model**:

| | Shared by the household | Belongs to one person |
|---|---|---|
| Audiobooks | ✅ already its own site | |
| **Ebooks** | ✅ **behaves like audiobooks** | |
| Physical books | | ✅ a specific copy on a specific shelf |
| Board games | | ✅ (a physical copy, though played together) |

Ebooks currently live INSIDE the physical library catalog — `site/ebooks.json`
is produced by the audiobook pipeline's step 1b and imported by
`library_catalog`. So a shared-by-everyone format is stored inside the one
catalog whose entire premise is "who owns this copy".

⚠️ **This is exactly the question the second-household federation runs into.**
"See who owns what" is meaningful for physical books and games, and close to
meaningless for ebooks and audiobooks — those are "do we have it", not "whose
is it". Deciding the ebook split FIRST would likely simplify the federation,
because it separates *the shared pool* from *the per-person shelves* before two
households ever have to be joined.

**Not a build yet.** Open questions, in the order they need answering:
1. Does an ebook site mean a new catalog, or a VIEW over the shared index?
   (The index already exists and already spans catalogs — a new Worker may be
   the expensive answer to a question a query answers.)
2. What happens to `library_catalog`'s existing ebook rows — move, mirror, or
   leave and re-point?
3. Does the shelf server change shape? It serves audiobooks by URL today;
   ebooks are the same *kind* of thing.
4. Who is the ingest owner once ebooks leave the physical catalog — step 1b
   still produces the manifest.

## 🤝 A second household's library, federated with ours (owner ask 2026-08-16)

**Deferred by the owner the same day it was raised — "do the next catalog
later" — recorded now so it is not lost.**

The ask: *"I want to make a site for my friends library and then link it to
mine so we can see who owns what. but she's less technical and doesnt live near
me, they need a much better automated solution."*

Three constraints that make this NOT just "deploy another copy":

1. ⚠️ **She is less technical.** Every operational assumption this estate rests
   on — a pipeline on a home machine, wrangler from a laptop, reading a runbook
   — is unavailable. Whatever is built has to run without her ever seeing a
   terminal.
2. ⚠️ **She is not local.** No shared LAN, no "I'll set it up on your machine",
   no physical access to fix a stuck box. Remote-first from day one.
3. **The point is the JOIN, not the copy.** "See who owns what" means the two
   catalogs must be comparable — which is what the shared index
   (`index.heygabi.ai`) already does across our three catalogs, and is the
   obvious foundation rather than a new mechanism.

⚠️ **Do not start this by cloning a repo.** The interesting design question is
the automation and the ownership boundary (her data, her account, her control,
our shared view), and answering that first will change what gets deployed.
Related: the combined-site architecture already sketched for our own three
catalogs.

## Discord bot — option space (design doc on file)

Design doc: [`docs/info/discord-bot-design.md`](info/discord-bot-design.md)
(2026-08-14, no code yet). Builds on `audiobook_catalog/docs/info/
discord-poll-sync-research.md` (bot mechanics: Ed25519 interactions endpoint,
token custody, per-server invite, identity linking). Recommended first
three: (b), (a), (d) below.

⚠️ **Two of the recommended three have SHIPPED (2026-08-17) — read this list as
"what is left", not as a queue.** (a) is GABI phase 3 (bot-posted poll messages
with vote buttons, tally refresh, close propagation) and (b) is `/have`; both
are live at `discord.heygabi.ai` and archived whole in [`DONE.md`](DONE.md).
(d) and everything below it are genuinely unbuilt. Noted 2026-08-17 by the docs
hygiene sweep, which found this list still reading as though nothing existed.

- (a) Two-way poll voting — buttons sync votes with club polls both ways. **M**
- (b) `/have` or `/shelf` — "does the estate have this book?" via the index
  Worker's search, scoped `{audiobook}` for strangers / member visibility for
  linked+approved users. **S–M**
- (c) New-additions feed / `/recent` / rich shelf embed — browse what's owned,
  driven by `additions_log.json`. **S (feed/`/recent`), M (rich embed)**
- (d) Club RSVP via buttons — ties to the shipped meeting scheduler. **M**
- (e) `/progress` — reading-progress updates from Discord, identity-linked
  writes via service account. **M–L**
- (f) Meeting reminders with snooze/RSVP actions. **M**
- (g) Community-stats digest posts to a channel. **S–M**
- (h) `/suggest` — TBR suggestions from Discord, identity-linked writes. **M**
- P1 `/guessgame` — Discord-native cover-guessing game (proposal). **M**
- P2 `/review` — surface existing book reviews on request (proposal). **S**
- P3 `/universe <name>` — cross-catalog universe showcase (proposal). **S**
- P4 Per-book discussion threads on read-start (proposal, lower priority). **M–L**

---

## ✅ Fable-preferred queue — RELEASED 2026-08-16 (kept for the reasoning)

⚠️ **This queue is no longer in force.** It existed only while the Fable weekly
meter was near its cap; the memory that carried it said in its own words that it
was "TEMPORARY — a usage-cap workaround, not a standing rule" that lapses at the
weekly reset. Measured 2026-08-16 16:06 local: Fable **0%**, all-models **0%**.
The memory file has been deleted per those terms, and work no longer needs to
wait for a Fable window.

The original entry follows, because the reasoning about which work suits which
model is still useful even though the rationing is over.

## Fable-preferred queue (started 2026-08-14, owner directive)

Agents now run non-Fable by default. Work banked here genuinely benefits from
Fable and waits for the owner to release it (e.g. after a weekly reset):

1. ~~**SSO build, phases 1-4**~~ — ⚠️ **STALE, see the live SSO section at the
   top of this file.** The owner approved the design 2026-08-16 and phases
   1–3 shipped 2026-08-18; "awaiting the owner's go" is two decisions out of
   date. Kept rather than deleted because this queue exists to record which
   work suits which model, and phase 4 is still unbuilt.
2. **Rules tightening deploy (club permissions 0b)** — deny manager writes on
   unclaimed clubs once every active club is claimed. Precondition-gated.
3. **Edit-audit phases A2/A3** (edit-audit-design.md §6) — override-aware
   review backfill + CLI key-move warning; guards the shared review store
   against orphaning. Do BEFORE any reviewed audiobook is retitled.
4. Any future Firestore-rules rewrite or estate auth-worker change touching
   verification/secrets.

---

## Queued behind the Cosmere batch (owner, 2026-08-15)

1. **Generalize the Cosmere treatment estate-wide**: for every universe and
   series, apply the same logic just exercised on Cosmere — matcher
   completeness (no member left unflagged by a spelling quirk), series-blank
   via the corrections layer where a 'series' is really a universe umbrella
   (non-destructive, owner's exclusion-list rule), spelling fixes through the
   series canon. Same propagation chain.
2. **Full orphan sweep (AI judgment, Opus)**: read all three catalogs like a
   librarian and find every book/game that BELONGS in a series or universe
   but isn't attached — missing series fields, universe members the matchers
   miss, series spelled into isolation. Verdict table like the fuzzy-match
   sweep (confident fixes applied via the proper instruments; ambiguous rows
   reported); before/after counts.
