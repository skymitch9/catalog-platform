# DONE — catalog-platform (dated archive)

> **Audience:** Claude sessions. **Status:** TRACKED. Created **2026-08-16**
> by splitting a 778-line `docs/TODO.md`.
>
> ⚠️ **Archive, not a living doc. APPEND ONLY.** Nothing here is ever edited
> or re-summarised. An item arrives once, at completion, moved whole from
> [`TODO.md`](TODO.md).
>
> Newest first, preserving the order the entries had in the original file.

## 2026-09-05 — the apex CSP would have blanked a provisioned catalog's covers — fixed, deployed and verified as SERVED

Moved whole from `TODO.md` by agent W2-PLAT. Commit `79d92da`; **deployed**
`heygabi-home` `ce97408a` (from a throwaway worktree of HEAD — two other agents
had uncommitted files in the shared tree). No migration is involved, and that is
a measurement: this ships one edge-headers file and no schema anywhere.
**Verified live** with `curl -s -D -` and a cache-buster: `/`, `/universes/` and
`/series/` serve `img-src 'self' data: https://*.heygabi.ai https://covers.heygabi.ai
https://bookcovers.heygabi.ai https://library.heygabi.ai https://covers.openlibrary.org
https://books.google.com https://gamecovers.heygabi.ai https://lh3.googleusercontent.com`,
and `/admin/` the same minus `library.heygabi.ai`. `verify:home` passed first
run, 30 pages. Review link: <https://heygabi.ai/> (the covers on the search
results are what the directive gates).

🔴 **THE ITEM'S OWN PROPOSED FIX COULD NOT BE WRITTEN, and this is the finding
worth keeping.** It asked for `gamecovers*.heygabi.ai`. CSP3's grammar —
`host-part = "*" / [ "*." ] 1*host-char *( "." 1*host-char )` — allows a
wildcard **only as the whole leftmost label**, so a partial one is not a
narrower rule: it is an **invalid source expression** browsers drop with a
console warning, i.e. the same silent blank with extra confidence. The real
choice was `https://*.heygabi.ai` or a hand edit per instance. The wildcard was
taken because the zone is entirely owner-controlled, `img-src` grants no
execution, and `Referrer-Policy: no-referrer` is already on `/*` — and it is
**not** the `https:` wildcard `_headers`' own 2026-08-15 note rejects, which
re-admits the whole internet. The four named cover hosts stay as documentation
of what production serves. ⚠️ **NOT verified:** no `gamecovers2.heygabi.ai` or
`bookcovers2.heygabi.ai` exists yet, so no browser has ever been asked to load
an image from one — the header is proved as SERVED, not as EXERCISED. The
grammar claim is read off the specification, not measured in Chrome.

⚠️ **Two claims in the original text were wrong and are corrected here rather
than silently:** (1) *"verify with `verify:home`'s header check"* — `verify:home`
(`scripts/predeploy-check.mjs --live`) asserts **body markers only** and reads no
response header at all (`grep -n "header" scripts/predeploy-check.mjs` → one hit,
an outbound request header). The live proof is the `curl` above. (2) `session.ts`'s
second 401 was at **`:85`**, not `:69` — agent RES's bare-401 fix shifted it the
same day.

The session.ts half of this item is code-landed and **NOT deployed** — see the
`estate-auth` section still open in [`TODO.md`](TODO.md); it rides the owner's
one batched deploy.

The original text, verbatim:

> ## ☐ The home site's CSP would BLOCK a provisioned games instance's covers (found 2026-09-05 by agent RES)
>
> `sites/heygabi-home/public/_headers` names `gamecovers.heygabi.ai` explicitly in
> every CSP `img-src`. A games instance provisioned under naming rule (a) serves
> its covers from `gamecovers<N>.heygabi.ai` (design §7.1; ordinal because
> `COVERS_BASE_URL` is written into `thumbnail_url` rows), so the first
> `gamecovers2` catalog's images would be blocked on the apex with nothing in
> the provisioner's runbook saying so. **Fix:** widen the `img-src` entry to the
> pattern the reserved list now guards (`gamecovers*.heygabi.ai`, and
> `bookcovers*.heygabi.ai` for the custom-domain tier of §7.2 step 2 while
> there), verify with `verify:home`'s header check, and add the line to design
> §7.6a step 2 so the next provisioner run reads it. Size: one-file fix, ~40k.
> Also from RES, smaller: `session.ts:69` has a second 401 whose `detail` is the
> technical `'token carries no uid'` — reword for a person in the same pass.

## ☑ CODE LANDED 2026-09-05 (agent W2-VERSE4, `f2e7543`) — "+ Add a verse" PHASE 4, notify the requester on a decision — 🔴 ☐ NOT DEPLOYED, ☐ NOT MIGRATED

> ⚠️ **A PHASE, not the whole item** — the same shape as the *"phases 0–3
> BUILT"* entry further down this file. `TODO.md`'s *"+ Add a verse"* section
> stays open for item 6 (the first real `landed` call) and for the page that
> would draw a notice. Design of record and the full as-built:
> [`info/universe-add-verse-design.md`](info/universe-add-verse-design.md) **§8**.
>
> **Commit** `f2e7543` — `apps/auth-worker/src/notifications.ts` (new),
> `migrations/0019_estate_notification.sql` (new, purely additive),
> `src/universe-requests.ts` (the decide/landed wiring), `src/index.ts` (two
> CORS mounts + the route mount), `test/notifications.test.ts` (new, 29 tests)
> and six wiring tests in `test/universe-requests.test.ts`.
> **Deploy:** 🔴 **none.** `npx wrangler deploy` for `estate-auth` is refused by
> the permission system for agents (twice today, both shells), so this rides in
> the batched owner deploy that `TODO.md`'s *"Three BARE-STATUS 401s"* section
> holds. ⚠️ **THE OWNER'S TWO COMMANDS, IN THIS ORDER — this deploy is now a
> migrate-first one:**
> `cd apps/auth-worker && npm run db:migrate` (applies `0019` to remote
> `estate_auth`), **then** `npx wrangler deploy`.
> **Verified:** the suite, `682 → 721 pass / 0 fail`, and `tsc` clean on both
> projects. **NOT verified — and it is the whole feature's standing debt:**
> nothing live. Migration not applied, Worker not deployed, and 🔴 **no notice
> has ever been written, because no verse request has ever been FILED**
> (`SELECT COUNT(*) FROM universe_request` = 0, read remote read-only earlier
> the same day). Every 200-side path is proven against an in-memory D1 only.
> **Review link, after the deploy:** file a request at
> <https://heygabi.ai/universes/>, approve it at <https://heygabi.ai/admin/> →
> **Verse requests**, then read the notice back with the requester's own
> session — ⚠️ **there is no page for that yet**, so today that read is a
> `GET https://auth.heygabi.ai/api/estate/notifications` with a signed-in
> token, which is exactly the gap the front-end step names.

**What landed, and the two places it departs from the design it implements.**

§4's phase table says only *"Notification when a request is decided (reuse
`estate_prefs`/`notify-prefs.ts`)"*. Half of that was honoured exactly:

- ✅ **The opt-out reuses `estate_prefs` (0014)**, one row per person under
  `notify:user:<id>`, parsed with `notify-prefs.ts`'s own idioms — defaults
  filled in, ⚠️ refuses-never-strips on write, and ⚠️ an unreadable row falls
  back to the **defaults**, never to silence.
- 🔴 **The messages could not.** `estate_prefs` is one row per KEY of owner-set
  settings that the CONDUCTOR reads; a stream of dated messages addressed to
  people is not a settings row. Hence `0019_estate_notification.sql`, **a
  migration the design never named** — said loudly in the migration's own
  header, the module header, and the design's new §8, rather than left for a
  reader who trusted the phase table to discover.

🔴 **WHAT THIS IS: IN-APP DELIVERY. NOTHING HERE SENDS ANYTHING.** No phone
buzzes, no email leaves, nobody is DM'd — because **this Worker holds no
outbound channel to a member.** `notify-prefs.ts` is the OWNER's phone,
delivered by the conductor over its own bearer; there is no equivalent for
anybody else. Email needs a mail credential; a GABI DM needs `estate-auth` to
hold a Discord bearer **and** `CONSUMER_APPS` to accept one, which
`test/dev-access.test.ts` guards against by name as *"a capability nobody
granted it"*. ⚠️ **Both are access-INCREASING, so they are the owner's to mint
and not an agent's to assume.** The queue is built, the channel is **named**,
and the estate stays honest that a notice **waits to be read** rather than
claiming it was **sent**.

**Why it is not a second copy of the /universes queue** (the one-fact-one-home
rule for surfaces would otherwise refuse it): that queue answers *"what is the
state of my requests"*, always current; a notice answers *"what changed since I
last looked"* — dated, quoting the decider's words **as they stood then**,
markable read. The status is the fact; the notice is the event. ⚠️ Rendering it
by re-reading the row would make a message about the past change when the past
changes, which is how *"you were declined because X"* becomes a sentence nobody
ever wrote.

**Why it is not the event ring**, which is this Worker's other notifier:
`worker-events.ts`'s own header forbids it (*"a noticeboard, not a log … Not
requests"*), it is per-WORKER, and it is read behind `requireDevops()`, so a
member could never see a line addressed to them. ⚠️ **The ring IS used for
exactly one thing, which is the thing it is for:** when writing a notice FAILS,
one `warn` line goes to it. A notifier that fails silently is worse than none,
because the silence is then trusted.

**The three refusals, each pinned by a test:**

1. 🔴 **Nothing is written when there is no requester** — a seed, a script or a
   `system` principal has nobody to tell, and inventing a recipient writes a
   message nobody is owed into somebody's inbox.
2. 🔴 **An opt-out means the notice does not EXIST**, not that it is stored and
   hidden. The switch is read by the *writer*, in the one place a notice is
   written, so no later caller can route around it.
3. 🔴 **A FAILED NOTICE NEVER FAILS THE DECISION.** `notify()` is the last
   statement in the handler, hands its work to `waitUntil` and swallows every
   path: the decision is already durable in D1, and throwing would turn a
   completed approval into a 502 the approver would reasonably retry — ⚠️ **and
   the retry would meet `already_decided`.**

⚠️ **`landed` is notified too, and the design did not ask for it.** The clause
says *"when a request is decided"* and is silent about `landed`; §3.6 is the
argument for the extension — *"landed rows disappear from this section"* — so
without it the last thing that ever happens to a request, from the requester's
side, is that it **silently vanishes**, and the one moment the verse actually
exists is the one moment nobody tells them. ⚠️ **`approved` still never reads as
done** in any of the three notices, and a test refuses any sentence claiming the
verse now exists.

**Two smaller findings, kept because they cost a reader time:**

1. **The design doc had two stray XML tags at the bottom** (`</content>`,
   `</invoke>`) rendering as literal text since 2026-08-26 — a tool artifact.
   Removed.
2. **The doc's own header was stale in both directions** — it said phases 0–3
   were NOT deployed and `0017` NOT applied, three days after both happened.
   Corrected in place with the deploy ids, struck rather than deleted.

---

## 2026-09-05 — the `discord:D5` estate probe, fixed: the suite is 137/137 again

Moved whole from `TODO.md` by agent W2-PLAT. Commit `d7b8465`
(`tools/estate-probes/probes/discord-worker.mjs` + its `README.md`). **No
deploy is involved** — the probe suite is plain Node run from a checkout, so
there is nothing to ship and nothing to migrate. **How it was verified:**
`npm run probe:estate` against live production, one clean run — **137 passed,
0 failed**, with `D5` reading *"gabi_books_tools === the five names in
GABI_BOOKS_TOOL_NAMES"*. The baseline immediately before the change was **136
passed, 1 failed**, the one failure being D5 itself, so nothing else changed
colour. ⚠️ **NOT verified:** nothing about the Worker was touched or re-tested
— the fix was always to the assertion's data, and the deployed allowlist was
already correct.

⚠️ **The durable lesson, written into the suite's own *Gotchas* table rather
than left here:** a probe that pins a DEPLOYED allowlist goes stale the day
the allowlist grows, and nothing mechanically links the two. Adding a name to
an allowlist a probe pins means editing the probe **in the same commit**, the
same rule as *"new endpoints get a probe"*.

The original text, verbatim:

> ## ☐ 🔴 The `discord:D5` estate probe has FAILED on every run since 2026-09-03 — and it is the probe that is wrong (found 2026-09-05 by the docs audit)
>
> **One-line fix, and it is worth doing fast because a suite with a standing
> false failure is a suite people stop reading.** `tools/estate-probes/probes/discord-worker.mjs:83`
> pins `BOOKS_TOOLS = ['book_presence','list_book_knowledge','read_book_passage','search_book_text']`
> — **four** names — and asserts `gabi_books_tools` equals that set exactly.
> `count_phrase` became the fifth on 2026-09-03 (deploy `7d61418`, then `272ac67`),
> so D5 has failed ever since.
>
> **MEASURED 2026-09-05 ~13:20 Phoenix:** `GET https://discord.heygabi.ai/api/health`
> returns `gabi_books_tools` = `["list_book_knowledge","search_book_text","read_book_passage","book_presence","count_phrase"]`
> — **five**. Two independent `deploys.log` lines already name this as
> *"the PRE-EXISTING stale `discord:D5`"* and neither opened an item for it, which
> is why it is one here.
>
> **The fix:** add `'count_phrase'` to that array and update the two wordings that
> say "four" — `:90`'s check description and `tools/estate-probes/README.md:38`
> and `:106`. ⚠️ **Keep it asserted as a SET, not a count** — the comment at
> `:78–82` is explicit that the point of the fourth allowlist is that these names
> travel together and no new tool joins them without a decision, and a length
> check would silently accept a swap. ⚠️ Do NOT relax it to a subset test for the
> same reason.

## 2026-09-05 — design §7.6 / §7.2 step 5 understated the auth-worker manual step: nine hand edits, four of them silent

Agent RES, commit `a257366`. **Not moved from `TODO.md`** — this correction was
its own brief, not a tracked item, and it is filed here so nobody re-derives it.
**How it was verified:** by reading each symbol in
`apps/auth-worker/src`, not by grepping for a name. §7.6 row 5 said the games
manual step was *"`games2` + `vis_games2`"*; §7.2 step 5 listed four sub-steps.
The measured count is **nine**, now written out in a new **§7.6a** with
file:symbol and the failure mode of each. The two the old ledgers named
(`CONSUMER_APPS`, `vis_`) are among the four that fail **silently**; the two
that were in *no* ledger at all — a `case` arm in `siteForApp()`
(`estate.ts:118`) and an entry in `BILLING_SITES` (`billing-registry.ts:38`) —
are the ones that fail the BUILD, because both switches are exhaustive over
`ConsumerApp` with no `default`. ⚠️ The deepest silence is
`visibility.ts:45/55/73/84`: `VisibilityFlags` is a separate interface from
`CATALOGS`, so adding a catalog and forgetting the two mappers type-checks,
ships, and produces a catalog nobody can be granted, with nothing red anywhere.

**Two STALE-WRONG claims corrected in place** (struck, not deleted), measured by
reading `boardbuddy/Board_Game_Catalog`:

- §7.6 **row 5b** said the games estate identity *"CANNOT — the id is hard-coded
  (`env.ts:141`)"* and consequence 1 called it a hard blocker whose absence meant
  a second instance would be **silently misidentified**. It is BUILT:
  `apps/worker/src/lib/estate-app.ts` (`ESTATE_APPS = ['games','games2']`,
  `APP_TOKEN_VAR`, `estateAppToken()`), commit `fc17ea3`, with
  `estate-app.test.ts` as the same-id build guard and `wrangler.toml:189` setting
  `ESTATE_APP = "games"` (`:358` carries the commented `games2`). And the failure
  direction is a deliberate `null` rather than a fall back to `'games'`, so the
  misidentification the item warned about can no longer happen at all.
- §7.6 **row 6** said the paired token was *"AUTO only after 5b — blocked by
  5b"*. Unblocked by the same commit.

Two drifted line anchors in §7.2 step 5 re-measured: `appTokenFor()` is at
`env.ts:502` (was `478–491`), `EstateUserRow` at `env.ts:373` (was `:349`).

⚠️ **The gap was in the DOCUMENT, not the code.** `Board_Game_Catalog`'s
`billing-gate.ts` (`billingSite()`) already carried the
`siteForApp()`/`BILLING_SITES` note, and its `provision-catalog.mjs` prints both
in the PAUSE #2 runbook. ⚠️ **NOT verified:** no new consumer app was actually
registered, so the nine-edit list is read off the code, not exercised by a
provisioning run.

## 2026-09-05 — `research-queue.mjs` schema drift: CLOSED against the commit it asked to be closed against

Moved whole from `TODO.md` by the 2026-09-05 docs audit (agent AUD-platform).
**How completion was verified:** the item's own closing instruction was *"if it
was fixed since, close this against the commit"*, so the commit was looked for.
`library_catalog` `cfea2b9` — *"Fix research-queue.mjs: mirror schema drift +
non-atomic batch"*, **2026-08-24 07:34:27 -0700** — closes BOTH halves, and both
were re-read in the file itself rather than trusted from the subject line:
`scripts/research-queue.mjs:123–129` lists `MIRRORED` with **`work_alias` and
`change_log` both present** (a comment at `:104` dates their addition to
2026-08-24 and names migration 0410 / 0120 as the reason), and `makeShim.batch`
at `:336–351` now carries the explicit *"Atomic: every statement in a batch
commits together or none does"* transaction, with `:484–491` recording that the
pre-fix code split statements into blocks of 40 and could leave `work.series`
written with no audit row. ⚠️ **NOT verified:** the script was not RUN, and no
research queue was processed — this is a source-level close, which is exactly
what the item asked for. ⚠️ The fix landed the *same day* the item was written,
so it was never open for more than a few hours; it survived on the TODO for
twelve days purely because nobody looked. Original item:

☐ **Follow-up (unverified since 2026-08-24): `library_catalog/scripts/research-queue.mjs` schema drift**

Carried out of the retired morning summary because nothing else tracks it: its
in-memory mirror omits `work_alias` (0410) + `change_log`, and `makeShim.batch`
is non-atomic (a partial write occurred). Add both tables to MIRRORED + make
batch atomic before using the script again. ⚠️ **Not re-verified on
2026-08-31** — if it was fixed since, close this against the commit.

## 2026-09-05 09:15 Phoenix — the provisioning private key has a second custodian: 1Password `Estate`

Moved whole from `TODO.md`. Done from the owner's phone: he connected by Chrome
Remote Desktop, the session ran `op document create` (the CLI reads the file
itself — the value never entered the session), and he approved the 1Password
authorise prompts with Windows Hello. **Gotcha measured on the way:** with the
desktop-app integration on, EVERY `op` call in a fresh process raises its own
authorise prompt and times out in ~60 s if nobody is watching the screen —
the first `op item list` timed out, the `op document create` right after it was
approved, the verification read timed out once more and passed on the retry.
So batch the calls into one job and have the approver ready BEFORE running it.
Verified by name and size only: 1 matching item, DOCUMENT
`catalog-provisioning.private.jwk` id `wjsfpbl4hw3zujxdctiaoonvyu`, created
2026-09-05T16:15:54Z, attached file 3,333 B = the file on disk. Custody row:
`access/RECOVERY.md` §11.3, with the `op document get … --out-file` restore.
NOT verified: a restore round-trip (the file was not fetched back and compared).
Original item:

☐ **Put a copy of `catalog-provisioning.private.jwk` in 1Password `Estate`.**
Losing it does not lose a secret that can be re-minted — it makes every pending
envelope permanently unopenable, and every requester has to be asked again.
**Owner, 2026-09-05 09:09 (on his phone): "Is there any way you can do it, or
at least set it up for an easy remote in and windows hello."** Measured the
same minute: `op` CLI 2.34.1 is installed and knows the account; the 1Password
app is running with CLI integration on (`op vault list` waits on the app's
authorise prompt and times out, it does not ask for a password); Chrome Remote
Desktop host is installed and its `chromoting` service is Running. So the path
is: he remotes in with CRD, the session runs `op document create <file>
--vault Estate` (the CLI reads the file itself — the value never passes through
the session), and he approves the one Windows Hello prompt with his PIN. Never
`cat`/paste the file.

## 2026-09-05 08:35 Phoenix — OWNER DECISION: instance naming is (a), the split as built

Moved whole from `TODO.md` ("Request a catalog" → phase 7 residue). The owner's
answer, one word: **"A"** — after a full description of the three and my
recommendation for (a). The rule and the reasons for rejecting (b)/(c) are
recorded once, in the design doc §7.1 (`docs/info/request-a-catalog-design.md`);
both provisioners already implement (a) in one `deriveNames()` each, so nothing
was rebuilt. Original item:

☐ **OWNER DECISION (asked 2026-09-05 07:37): instance naming.** The script splits
names by what can be renamed — host + env/Worker follow the person
(`amber.heygabi.ai`, `[env.amber]`, `library-catalog-amber`); D1, R2 bucket and the
estate app id are ORDINAL (`library-catalog-3rd`, `library-3rd-covers`, `library3`)
because those can never be renamed and the app id is a contract with the
auth-worker. Design §7.1 wanted everything identity-neutral; `--instance third`
gives that. Which? (a) split as built (b) all ordinal (c) all follow the person.

## 2026-09-05 — `GET /api/estate/me` answered a BARE status; it now says a sentence

Moved whole from `TODO.md` (agent S1), where it read:

> ☐ **Pre-existing, found by agent A:** `GET /api/estate/me` answers unauthenticated
> with a bare `{"error":"unauthenticated"}` and no `detail` (`apps/auth-worker/src/estate.ts:409`)
> — the "never a bare status" rule broken on the most-read route. One-line fix; do it
> after today's build lands (the home page and `/admin` both read this route).

✅ **FIXED, DEPLOYED AND VERIFIED LIVE 2026-09-05** — commit `9e0922f`,
`estate-auth` version `d87235f8-c2a1-4756-bacf-ac2a23da880e` (the same deploy as
phase 5's server half). The line was `src/estate.ts:416` by the time it was
fixed — agent A's own `catalogs` edit had moved it seven lines, which is why the
route line (`:409`) rather than the defect line was quoted above.

`GET https://auth.heygabi.ai/api/estate/me` signed out now answers, measured
with `curl -s` at 15:00Z:

```
{"error":"unauthenticated","detail":"You are not signed in. Sign in with your estate account and try again."}
```

⚠️ **The `error` CODE is unchanged, deliberately.** `tools/estate-probes`
asserts `error === 'unauthenticated'` across this Worker's whole
unauthenticated edge and every page's failure wording branches on it; only the
`detail` is additive, in the shape `middleware/auth.ts:141–148` has used since
2026-08-18. A test in `test/me-contract.test.ts` pins both — the sentence, and
that it stays the *"not signed in"* cause rather than merging with the other
three (awaiting approval / revoked / insufficient role), which have four
different fixes.

⚠️ **THREE SIBLINGS OF THE SAME DEFECT ARE STILL OPEN** and were deliberately
not fixed in that commit (out of the agent's brief — reported, not silently
widened). They are back on [`TODO.md`](TODO.md) as their own item:
`src/middleware/auth.ts:259` (`requireApprover()`, person-facing on `/admin`),
`src/estate.ts:372` (`POST /estate/seen`, app-facing) and `src/session.ts:64`
(`POST /session`, browser-facing).

## 2026-09-03 12:18 Phoenix — GABI counts phrases and knows what the owner has rated (DCC "God damn it, Donut" = 14)

Owner pasted a DCC book-1 exchange (*"how often does Carl say God Damnit
Donut or something similar"*) and named two faults:

1. ☐ **GABI does not know he has read the books** — *"even though I have it
   rated and I've linked."* She asked how far he was into book 1 (spoiler
   guard) when his rating + linked account already answer that. Find which
   read-state signal the spoiler guard consults, why a rated + linked owner
   reads as unknown, and fix so a rating (or finished progress) counts as
   read — without breaking `gabi-suggestions-design.md`'s *not reviewed ≠
   unread* rule (that rule says an UNrated book is not proof of unread; the
   reverse direction, rated ⇒ read, is what's missing).
2. ☐ **"I don't have a tool that counts specific phrases across a book's
   text"** — *"It couldn't answer the question and should be able to. Let's
   add this tool in."* A phrase-search/count tool over a book's text, scoped
   to books whose text the estate actually holds (ebooks on the shelf /
   `ebooks-door`); needs a grounding answer to "which books have text",
   spoiler scope by read-state (item 1), and the same permission model as
   the ebook suggestions (`vis_ebooks`, asked never copied).

✅ **OWNER DECISION 2026-09-03 ~11:05, on item 1** — *"Yes let her see it.
She should be able to see everything on my GABI account except passwords and
such."* Standing rule for GABI's read-state: **a linked person's own account
data (ratings, reviews, progress, listening position, shelves, read flags) is
visible to GABI when she acts for THAT person** — derived per turn, never
stored as a spoiler ceiling (the §4.5 re-chunk hazard stays honoured that
way). Excluded: secrets, tokens, passwords, anything under `vis_*` grants
that belong to OTHER people. This is the person's own data relayed under the
person's own identity — not a widening of who may see what.

✅ **Investigated 2026-09-03 11:07** (Opus, read-only, 230k) — findings + design in
[`info/gabi-phrase-count-and-read-state.md`](info/gabi-phrase-count-and-read-state.md).
The short version: **her sentence was true** (`/search` caps at 6 passages, `/presence`
counts bag-of-words — 17 vs the true 14), and the bound is derived from the QUESTION
STRING only, where *"I've read them all"* fails `ENDPOINT_RE` on the object. The one
read-state signal reachable today is his own `reviews` doc (display-name matched,
`bookId` == pack id). **Measured answer: "God damn it, Donut" 14× in book 1, chapter 28
×3** — transcript punctuation, so the printed book may differ.

✅ **OWNER: "Go" (2026-09-03 11:12).** Dispatch A (audiobook-worker, Opus) launched
11:15 from a clean tree at `64b00db`; usage at dispatch session 12 / weekly 52 / Fable 54.
✅ **DCC-1 rating VERIFIED 11:17** (owner asked, PowerShell run): `reviews` holds
displayName `Skylar`, rating `"5"`, 2026-06-24; `reviews_dev` empty. ⚠️ **`rating` is a
STRING on two of three docs (`"5"`) and a number on the third (`4.5`)** — B's validity
check must be `Number(rating)` finite and > 0, never `typeof === 'number'`.
✅ **A LANDED 11:31** (223k Opus, 4 commits `bbafa5e`→`7a69b41`, deployed
`7f1bb01c-17ae-4d1f-8105-3d1290a9e353`; tests 271→293 / 0 fail; probes 134→137 green;
live no-bearer refusal 401 worded; **counter hits 14 / ch 28 ×3 on the local pack**).
Contract for B: `variants` is PIPE-separated; `by_variant` sums to `total` (overlaps
collapse to the first variant); `/api/books/count` is whole-book only; pure-punctuation
phrase → 400 `empty_phrase`; exports `countPhrase, MAX_COUNT_VARIANTS, MAX_COUNT_QUOTES,
MAX_COUNT_BYTES, CountAnswer…`. NOT verified: an authenticated 200 against live R2
(session holds no token); R2 pack == local mirror.
✅ **B LANDED 12:04** (315k Opus, commits `4151f80`→`f4e702c`, deployed `estate-discord`
`583cc953-5ae6-4dd6-9422-29d6aed6d440`; tests 1199→1246 / 0 fail; `/api/health` 200 with
`gabi_books_ready: true` and `count_phrase` in the tool list; `GABI_BOOKS = "on"` at
`wrangler.toml:387`). As built, with the deviations and why in
[`info/gabi-book-knowledge-design.md`](info/gabi-book-knowledge-design.md) **§4.7/§4.8/§10f**
(§4.5/§4.6 were taken): row 7 of the ladder resolves per BOOK at tool-call time
(`tool-exec.ts:734 boundForBook`), the shelf read is lazy + memoised (one Firestore query
per turn at most), `pendingScopeAsk` is derived from the window text (no store change).
⚠️ **Two findings while building:** (1) `shelf-exec.ts`'s `num()` read only
`integerValue`/`doubleValue`, so a STRING rating (`"5"` — the owner's own) never parsed
at all — fixed; every GABI shelf answer that showed a rating before today skipped those
docs. (2) Because the book tools are offered as a family and `count_phrase` is not on
`GROQ_READ_ONLY_TOOL_NAMES`, **the whole book tool loop now stays on Anthropic** — no
live effect while `GABI_GROQ` ships `off`; reverting is one array entry.
Horizon: `myReviews` returns the newest 15 rows, so a rating past row 15 falls to
`unknown` (the safe direction).
✅ **OWNER REVIEW PASSED 12:18** (*"It worked"*). In Discord: *"@GABI how often does Carl
  say God damn it Donut in Dungeon Crawler Carl book 1"* → expect **14**, chapter 28
  ×3, ≤3 short quotes, a "transcript" clause, the line *"you rated this one, so I'm
  treating it as finished — say if that's wrong"*, and **no how-far question**.
  ⚠️ NOT verified by either dispatch: an authenticated count against live R2 (no
  session holds `ESTATE_APP_TOKEN_BOOKS`), so the owner's question is the first
  end-to-end exercise of tool → route → pack → 14. When it passes, move this heading
  WHOLE to DONE.

✅ **VERIFIED END-TO-END 2026-09-03 12:18 Phoenix** — the owner ran the review line in Discord
and reported *"It worked"*: the first authenticated exercise of tool → `/count` route → R2
pack → answer. Not captured: the literal reply text (the owner did not paste it), so the
"14 / ch 28 ×3 / disclosure sentence" expectations are confirmed only by his one word.
Item 1 and item 2 above are both closed by this.

## 2026-09-02 21:41 Phoenix — the owner played Skyward from his phone; stream stamp AND saved spot PROVED

**Closure.** Owner: *"ive played music from my phone on the site and it
works."* `python -m app.tools.fulfill_audio_requests --status` read back at
21:51: `Skyward.m4b … last stream 2026-09-03T04:41:55Z, last saved spot
2026-09-03T04:41:56Z` — `Streams : 1`, `Positions : 1`, no 403 on any lane.
Units correct (no 1970 date). The phase-3 `audio_positions` rules had been
released 21:47 by the session (owner: "Run the deploy") and smoke-tested
15/15 live first. **Neither `--evict --commit` was run nor should it be yet:**
the shield now has data, but eviction needs a real idle candidate, and the
only book in the bucket was just played. Still unmeasured: the resume-offer
bar on a second device; prod (this was `/dev/`). The item below is the one
that asked for this, moved whole.

### ☐ 🔴 OWNER STEP — play Skyward, so the eviction stamp is PROVED rather than deployed

The audiobook player's platform half shipped 2026-09-02 (`e3396c5`, version
`245ad6a1-408a-41b8-a832-45917a266924`, `deploys.log` 20:58Z): the audio BYTE
route now stamps `audio_streams/{anchor}` = `{ anchor, lastStreamAt }` —
**epoch milliseconds** — through the service account, one write per anchor per
isolate per hour. Without it `evict_candidates()` never learns anything and R2
grows for ever.

🔴 **NOT ONE BYTE OF AUDIO HAS EVER BEEN STREAMED BY ANYBODY, so NO STAMP HAS
EVER BEEN WRITTEN.** Every test drives a stubbed `fetch`. Deployed is not
verified, and the missing half is a human with ears. Two steps, in order:

1. **Play Skyward**, signed in, at
   <https://audiobooks.heygabi.ai/dev/listen?b=b-4754c8e4548e&t=Skyward>
   (⚠️ `/dev/` only — the site half rides the next promote). It is the only
   book in the bucket, so it is the only thing that can be played at all.
   Thirty seconds is enough; the stamp lands on the first byte served.
2. **Read the stamp back**, in `audiobook_catalog`:

   ```bash
   python -m app.tools.fulfill_audio_requests --status
   ```

   ✅ **What proves it:** the `Skyward` line reads `last stream <a timestamp>`
   instead of `last stream never measured`. ⚠️ **Two OTHER answers, and they
   are different findings:** `[WARN] listing audio_streams failed: HTTP Error
   403` means the owner's 13:30 rules deploy did not take (the reader is
   locked out, and the stamp may well be there); a clean `Streams : 0` with no
   warning means the listing works and **the Worker's write is what failed** —
   check `npx wrangler tail audiobook-worker --format json | jq 'select(.message[0] | tostring | startswith("[stream-stamp]"))'`,
   which names the status.

⚠️ **A stamp that lands with the wrong UNITS is invisible here and it deletes
books.** The reader's `_parse_stamp` divides by 1000 only above 1e11, so a
seconds-valued stamp reads as a date in 1970 and a book somebody is halfway
through looks two generations idle. If the status line shows a 1970 date, that
is the bug, and it is one line in `src/stream-stamp.ts`.

⚠️ **Do NOT run `--evict --commit` on the strength of this.** `last_position_at`
is the mid-book shield and it waits for phase 3; until both land, eviction
correctly deletes nothing.

## 2026-09-02 (evening sweep) — five completed/stale TODO blocks moved whole

Swept in the pre-5.1-handoff docs pass on the owner's order ("update all docs").
Each block below is VERBATIM as it stood in TODO.md, prefaced by its closing note.

### CLOSED: Groq first-line item (phases 1+2 shipped, all five owner steps done 2026-09-01, phase-2 tool loops + polish 2026-09-02; savings measurement now rides the Groq-tier decision, tracked separately)

## ☐ Groq as GABI's first-line model before Haiku — BUILT + DEPLOYED DARK, awaiting the owner's key

Owner ask 2026-09-01: *"we just used groq in a different project, lets integrate
that into our gabi model as a first line before going to haiku tokens"* +
*"use the information from the other project to help reduce duplicate work."*

**Built, tested and deployed 2026-09-01** — and it changes nothing today,
because `GABI_GROQ = "off"` ships in `wrangler.toml` and `GROQ_API_KEY_GABI` is
unset. Design of record: [`info/gabi-groq-rung.md`](info/gabi-groq-rung.md).
Runbook: [`access/discord-bot.md`](access/discord-bot.md) §11.8. Money path:
[`info/llm-billing-control-design.md`](info/llm-billing-control-design.md) §2.4
row **E7**.

**What landed:** `apps/discord-worker/src/gabi-groq.ts` — a first-line rung in
front of the pinned Haiku on the **four TOOLLESS** call sites (classification,
small talk, memory distill, T2 fix parse). Model pinned
`llama-3.3-70b-versatile` (black_bot_baf's own choice); one attempt, 4 s
timeout, eight failure reasons, every one of them an **invisible** fall-through
to the unchanged Haiku call. 44 new tests, workspace 2247 pass / 0 fail.

⚠️ **SUPERSEDED IN PART, 2026-09-02.** The tool loop was *"out of scope by
construction"* above; **phase 2 shipped and it is not any more** — a tool loop
whose every tool is read-only now rides Groq first under the same
`GABI_GROQ = "first"`. The pin also moved to `openai/gpt-oss-120b`. Both are
recorded in [`DONE.md`](DONE.md) and [`info/gabi-groq-rung.md`](info/gabi-groq-rung.md);
the paragraph above is left as written because it is the record of what phase 1
decided, not a claim about today. ⚠️ **The five owner steps below are also
stale — all five were done on 2026-09-01** (key pushed byte-verified, `shadow`
read, `first` flipped and verified on the wire). They are NOT swept here because
that is this item's own close-out, and nobody has re-verified each step; the
next session that touches this item should move it whole.

### 🔴 THE OWNER'S FIVE REMAINING STEPS, in order

1. **Mint a Groq key** at `console.groq.com`. ⚠️ A new key — not an Anthropic
   one, and not the other project's, so this spend is separately auditable.
2. **Paste it into the FILE** — `apps/discord-worker/.dev.vars`, after
   `GROQ_API_KEY_GABI=`, with an editor. Never onto a terminal line, where it
   lands in shell history.
3. **Push it with the script** (⚠️ **THE BOM-FREE RITUAL — this is the whole
   point of step 3**), from the repo root:

   ```bash
   node scripts/push-discord-secret.mjs GROQ_API_KEY_GABI
   ```

   ⚠️ **NEVER `$value | npx wrangler secret put`.** A PowerShell pipe to a
   native process prepends an invisible UTF-8 BOM (`EF BB BF`); the stored key
   is then wrong **while looking perfect everywhere a human can check it**, and
   fails as a plain 401. That is exactly how `ANTHROPIC_API_KEY_GABI` was
   broken on 2026-08-18 (GABI heard every mention and answered none), and its
   first "fix" — `$OutputEncoding` + trim — was **measured not to work** and is
   revoked as ritual. See [`access/agent-board.md`](access/agent-board.md) §3
   and [`access/discord-bot.md`](access/discord-bot.md) §7.

   The script reads the one named line out of `.dev.vars`, **prints the byte
   facts and never the value** (length, first three bytes — a BOM is
   `239 187 191` — and the last byte), writes raw bytes to `wrangler`'s stdin
   from Node where no encoder can add a BOM, refuses a value that already
   carries a BOM, and **blanks the `.dev.vars` line afterwards**. Confirm:
   `curl -s https://discord.heygabi.ai/api/health | jq '.configured.groq_key_gabi'`
   → `true`.

4. **Flip SHADOW, deploy, and read the lines.** `GABI_GROQ = "shadow"` in
   `apps/discord-worker/wrangler.toml`, `npx wrangler deploy`. Nothing a person
   sees changes — Groq is called beside Haiku and ⚠️ **Haiku's answer is used.**
   @mention GABI a few times, then:

   ```bash
   npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_groq_shadow")'
   ```

   Look for `agreed: true` on nearly every `classify` line, `groq_answered:
   true` on nearly all of them, and `groq_ms` below `haiku_ms`. A wall of
   `reason: "refused"` / `status: 401` means **a BOM'd key** — redo step 3.
   `status: 400` naming a decommission means the pinned model was retired.

5. **Flip `first`** once the shadow lines look right, and talk to her. ⚠️ Prose
   quality is **not** readable off the shadow lines (they carry lengths, never
   text — these are household conversations). Backing out is one line:
   `GABI_GROQ = "off"` and deploy, or delete the secret and skip the deploy.

### 🔴 NOT VERIFIED — no live Groq call has ever been made from this repo

Every test drives an injected `fetch`. Whether Groq accepts this body, whether
`llama-3.3-70b-versatile` is still a live id, whether the answers are good
enough, and what the savings actually are (⚠️ the tool loop — the expensive
half — is excluded) are all unknown until step 4.

### CLOSED: Personality dial (owner HEARD it 2026-09-02 — 'sounded like a bot' on tool answers → the polish batch shipped the register-through-lookups fix + anti-formula; Groq voice measured flat → the hybrid keeps Haiku on final prose; the library panel got its own FULL edge on both instances the same day)

## ☐ GABI personality intensity — snark/flirt dial up (owner ask 2026-09-01)

Owner: *"Gabi can be a bit more into her personality, she can be a bit snarkier
or a bit more flirty. this is a private server so we can be a bit mean to my
friends. let her really sell the personality. Think of Grok from X in its all
go mode. have it really lean into stuff she's ingested from the books to build
out those personalities."*

✅ **BUILT AND DEPLOYED 2026-09-01.** `GABI_EDGE` (`standard` | `full`, fail
closed, ships **`full`**) in `apps/discord-worker/wrangler.toml`; the block
lives in `src/gabi-prompt.ts` beside the canonical prompt and is appended
BETWEEN memory and the persona block, so the PG-13 register clause and the
invariance clause stay last. `/api/health` reports `gabi_edge`. Tests:
`test/gabi-edge.test.ts` (18), including a literal pin of the whole pre-dial
prompt so `standard` is byte-identical. Operating it and the floor:
[`access/gabi-personality.md`](access/gabi-personality.md) §9; design:
[`info/gabi-personality-design.md`](info/gabi-personality-design.md) §11.

⚠️ **REMAINING — what is NOT done:**

1. **The owner has to HEAR the difference.** Nobody has talked to her at
   `full`; a test over a prompt proves the instruction is present, never that
   it is obeyed. Turning her down is `GABI_EDGE = "standard"` plus a deploy.
2. ⚠️ **The Groq shadow rung now renders this same prompt and its voice at
   `full` is UNMEASURED** — the shadow lines carry lengths and latencies and
   deliberately never texts, so nothing in them can show how a 70B
   open-weights model handles a roast licence. That needs `first`.
3. **The library panel does NOT have it, by design, and the step is
   library-side.** Phase 3's unification is a COPIED prompt with a comment
   naming its source (`library_catalog/packages/research/src/gabi.ts` →
   `GABI_SYSTEM`), not a shared package. This change did not touch the copied
   core — the byte pin proves it — so the copy is still in sync. Giving the
   panel the dial means appending its own `GABI_EDGE_FULL` there with its own
   posture, and that is an OWNER decision, not a sync: the panel's audience is
   not this private server's audience.

### CLOSED: The 19-feature build program — every feature landed 2026-09-02; the two owner steps it left open (registration, club-writes) were tracked separately, and registration RAN at 12:24 (8 commands published)

## 🔄 BUILD PROGRAM 2026-09-02 (owner: "list me and then build the remaining features. nothing else needs to wait unless it has a dependency")

19 features fanned out in repo-sequenced waves (Opus builds, Fable conducting).
Wave 1 in flight: Groq phase-2 tool translation (platform) · library quick
wins (scroll-to-top, Signed toggle, research transparency) · audiobook batch
(say-2, also-on-audio fix, poll-announce toggle, supplements armed
disambiguated) · games (deploy guards then disposal/copy-history). Waves 2–4:
player phase 2, ~~Discord fun menu~~, billing phase 0+1, ~~universes +~~, OR-1,
format toggle, Wandering Inn, cross-links, newest-authors.

✅ **The Discord fun menu LANDED 2026-09-02 and moved WHOLE to
[`DONE.md`](DONE.md)** (*"THE DISCORD FUN MENU: five commands live, two dark,
one toggle honoured"*). ⚠️ **Two owner steps remain open and are tracked as
their own items below** — the registration re-run, without which none of the
five new commands is visible in any Discord server, and the
`GABI_CLUB_WRITES` verification checklist. Neither is a build step, which is
why they are here rather than in the archive. Where a TODO said
"ask first", the recorded recommendation is being built and flagged vetoable
at landing (owner's nothing-waits order). SETTLED 2026-09-02 by owner: **"yes
everyone on the shelf list can have the ebooks"** — the ebook gate question is
answered: Cloudflare Access (family allowlist) is a lawful second door for the
ebook FILES on the shelf. Unblocks the shelf cluster (second ABS library on an
ebooks-only hardlink shadow tree per option A in audiobook TODO, ebooks
dropdown, reader via ABS's native reader or the port item as its docs record,
shelf_book_map + "Open on shelf" button — ONE canonical catalog→ABS join per
the recorded warning). ⚠️ Scope limit: this does NOT make ebook titles public
anywhere (the no-ebook-chip directive on public pages stands) and does NOT
retire the estate site's vis_ebooks/download_ebooks gate — two doors coexist.
Queued in the audiobook-repo wave lane behind player phase 2. SETTLED 2026-09-02 by owner:
**library panel gets full GABI edge, matching Discord** ("library panel should
match gabi in discord no matter what. same experience different entry point")
— queued wave 2 (library tree busy; panel prompt lives at
`library_catalog/packages/research/src/gabi.ts` → append its GABI_EDGE_FULL +
the NEVER-SOUND-PREWRITTEN section, keep the copied-core byte pin honest).
Second board-game instance STAYS deferred (owner 2026-09-02: "no use case yet").

### CLOSED: STALE ITEM — the registration ran the same day it was filed (12:24, 8 global commands published from /admin page context; see the earlier DONE entry 'Slash-command registration ran'); the item was written by the fun-menu builder before that and never swept

## ☐ 🔴 OWNER STEP — re-run the slash-command registration, or the fun menu is INVISIBLE

The five new commands (`/recent`, `/universe`, `/review`, `/suggest`,
`/guessgame`) are **deployed and answering**, and **nobody can see them**:
Discord shows exactly the list an application PUTs, and that PUT has not been
made since they were added. One call, and it needs an estate **admin** Firebase
ID token, which no session holds:

```
POST https://discord.heygabi.ai/admin/commands/register
Authorization: Bearer <admin Firebase ID token>
```

Getting a token: sign in on any estate page and run
`await (await import('/assets/estate-auth.js')).idToken()` in the console.
Full ritual and the two-switch registry:
[`access/discord-bot.md`](access/discord-bot.md) §15.2 and §4. Global commands
can take up to an hour to appear the first time.

⚠️ **Until this runs, "the fun menu is live" is a fact about the Worker and not
about Discord** — and the honest way to say so is that it is deployed, not that
it is usable.

### CLOSED: STALE ITEM — fixed 2026-09-02 by the audiobook feature batch: the button drew on 162/162 cards and was right on 21; now gated on a resolved audiobook_title, misses render NO control. Live on /dev/; detail in audiobook_catalog's local DONE

## ☐ BUG (not urgent, owner 2026-08-24) — ebook "also on audio" button resolves to nothing

Some books in the ebooks library show an "also on audio" affordance, but there is
no matching audiobook, so the link/button dead-ends. The ebook→audiobook match is
stale or over-eager (shows the button when no live audio edition exists). Fix:
only surface "also on audio" when a real matching audiobook resolves; otherwise
hide it. **Locate exact surface first** — likely audiobook_catalog `site/ebooks.html`
(the recent "N audiobooks" ebook-count work) or the library work-page audio cross-link.
Land for review. Candidate for a Fable/subagent build once located.

## 2026-09-02 — the ~14:00 owner decision batch, executed (moved whole from TODO)

Owner, verbatim: "fix the wandering inn publisher, fix the duplicates. on your
shelf should be the main with other editions available under their given
section. so if its a second physical there should be 2 under physical. we
should also add being able to set the covers for the alternate editions too.
for now we want to use only the listen/download here button in the audiobook
catalog. Anything needing the other computer is on pause"

All built the same afternoon by two follow-up agents, one per repo:
**library_catalog** (its DONE has the detail): work-page merge — "On your
shelf" is THE list, per-format sections, available-but-unowned rows dashed
with the honest "May be yours" state where `edition_id` is unlinked, the
audiobook cross-link painted once under Audio (double-paint finding closed);
per-edition covers (no migration — `edition.cover_url` existed since 0001;
new cover routes reusing the one pipeline); publisher batch — 7 rows
corrected with per-row attestation (Harper Voyager ×4, Ballantine, Clarkson
Potter, Scholastic Press), editions 511/557 correctly REFUSED as real B&N
imprints, importer-side fix filed as its own item there.
**audiobook_catalog** (its local DONE has the detail): modal play control is
the estate "Listen here"/download alone, shelf button off (shelf-link.js kept
and pinned); Emberdark deduped via the new curated `catalog_twins` mechanism —
Audible row survives ("Keep the audible one but make sure all source files
stay"), ZERO files touched (pinned against real bytes+mtimes), 1,088→1,087
rows; correction of record: the "ingestion refusal" was the m4b RESOLVER's
ambiguity, and the book's pack has existed from its EPUB since 2026-08-18.
The only remnant is the ON-PAUSE box-steps item left in TODO.

## 2026-09-02 — THE HANDSHAKE PROBES: three master-less token pairs become rotatable

Commit `1cfa531`; `estate-auth` `9fb859be-202f-40c5-9a6c-168263d2754e`,
`audiobook-worker` `ee8255dd-8219-4372-bc48-a2c6688f6dc9` (`deploys.log`
21:10Z). ⚠️ **This is the BLOCKER being removed, not the work being finished** —
the three ceremonies are still open and are tracked in
[`TODO.md`](TODO.md) with their exact commands.

**The blocker was never the ceremony. It was that nothing could WATCH one.**
`scripts/op-rotate-pair.mjs` refuses a pair with no runnable handshake *before
minting anything*, and that refusal is correct: a half-applied pair raises no
error anywhere — the verifier stops recognising the presenter, and the result is
a silent 401/403/404 on a route nobody watches.

| Route | Unblocks | Deliberately reaches |
|---|---|---|
| `GET auth.heygabi.ai/api/estate/app-check` | `ESTATE_APP_TOKEN_LIBRARY2`, `ESTATE_APP_TOKEN_AUDIOBOOK` | no D1, no identity, no write |
| `GET audiobook-api.heygabi.ai/api/books/app-check` | `ESTATE_APP_TOKEN_BOOKS` | no bucket, no pack, no email — **no book** |

One route for two pairs, because one Worker verifies both. Option 1 of the two
the TODO offered; option 2 (by hand, with the owner watching each surface) is
still available and needs no code.

### 🔴 The app NAME is the load-bearing half, not `ok`

A value pushed to the **wrong** `ESTATE_APP_TOKEN_*` secret still
authenticates — as the wrong app. A probe checking only the status would call
that a success and go on to set the presenter. `appCheckProbe()` requires 200
**and** the expected name, and reports a mismatch in those words: *"the value is
set on the WRONG secret"*.

### ⚠️ Why the BOOKS one is a new route, not a flag on `/api/books/*`

The recorded objection was exactly right and is the whole design: door B's
contract is *token **AND** asker*, and *"fabricating an on-behalf identity to
test a token is asserting an identity to a live gate, which is not a probe."* A
probe route that quietly became a second, weaker door onto the household's book
text would be worse than no probe at all. Its test drives the **real** app with
a `fetch` that THROWS on any outbound call and a bucket that THROWS on any
read — so *"it cannot reach a book"* is **asserted**, not merely true today.

### The refusal contract, on both routes

- **401 and 503 are kept apart.** "Wrong token" and "no token was ever set" have
  different fixes; on rotation day one status for both sends an operator to
  re-mint a value that was fine.
- ⚠️ **A refusal is not a listing.** It names no app, no configured secret, and
  carries **neither `ok` nor `app`** — one careless `if (body.ok)` in a rotation
  script turns a 401 into a success.
- No secret value appears in any answer, in either direction.

The three `whyNoProbe` sentences are kept **in place**, above the probes that
answered them: the reason a route exists is worth more than the fact that it
does. ⚠️ The guard is unchanged — a pair added later with `probe: null` is still
refused.

### 🔴 Three findings this run bought, two of them nearly a wrong diagnosis

1. ⚠️ **A newly deployed ROUTE is not live at every edge the instant `wrangler`
   returns.** `/api/books/app-check` answered **404 for about a minute** after
   its deploy — which reads exactly like "the route was never mounted", and one
   more minute of debugging would have gone into a file that was already
   correct. The estate had recorded this lag for a **secret** change
   (2026-08-26); it applies to routes too, and it is why the rotation script
   retries with backoff.
2. ⚠️ **Running `npm run probe:estate` back to back trips `auth-worker`'s own
   rate limiter, and the 429s land on UNRELATED rows.** The fourth run in a few
   minutes came back **115 passed, 19 failed**, every failure a
   `429 rate_limited` on sessions, CORS and pipeline ops. It reads exactly like
   a regression. Written into the probes README; the evidence to quote is *one
   clean run*, never *the last run*.
3. ⚠️ **A duplicate probe id used to pass silently.** The two new `auth` rows
   were written as `A36`/`A37` after a grep of the file's **tail** found `A35`
   as the highest — but `A36`–`A39` were declared **earlier in the same file**.
   Four rows ran under two ids and the suite still said *"133 passed, 0
   failed"*. Ids are how `deploys.log` and `DONE.md` refer to a row, so a
   duplicate makes entries **already written** ambiguous forever. Renumbered to
   `A40`/`A41`, and `discipline:RO2` now fails the suite on any collision.

**And one measured fact worth keeping:** `ESTATE_APP_TOKEN_BOOKS` **is set** on
`audiobook-worker` — the live route answers `401 unrecognised_app_token`, not
the `503 app_token_unset` an absent secret gives. `wrangler secret list` says as
much from inside; this is the first time it could be told **from outside**,
which is the half a rebuild day actually has.

**Tests 2567 → 2585** (+10 auth, +8 audiobook), typecheck clean,
`probe:estate` **134/134** on a clean run. Deployed from a throwaway worktree of
HEAD; `.bin` 51 / 51 / 51.

🔴 **NOT DONE, deliberately: no token was minted and no pair was rotated.** So
the 200 side of both routes has never been exercised against a real app token in
production — only the refusals have — and `RECOVERY.md` §11.3 still says
🔴 NONE for all three pairs, truthfully.

---

## 2026-09-02 — AUDIO PLAYER PHASE 2, the PLATFORM half: the byte route stamps the eviction clock

Commit `e3396c5`, deployed version `245ad6a1-408a-41b8-a832-45917a266924`
(`deploys.log` 20:58Z). The other end of the seam `audiobook_catalog` built the
same day — its `docs/info/listen-page.md` and its `DONE.md` 2026-09-02 entry
left a three-item handoff table, and all three are closed. Design of record:
[`info/audio-player-design.md`](info/audio-player-design.md) §10.1 (the stamp)
and §3.2 item 4 (the preflight).

**What is left open is the only part a build cannot do for itself** — a human
with ears — and it is tracked as its own item in [`TODO.md`](TODO.md)
(*"OWNER STEP — play Skyward"*).

### 1. The eviction stamp — `src/stream-stamp.ts`

`audio_streams/{anchor}` = `{ anchor, lastStreamAt }`, `lastStreamAt` in
**epoch MILLISECONDS**, PATCHed with an `updateMask` through
`FIREBASE_SERVICE_ACCOUNT`, throttled to **one write per anchor per isolate per
hour**. Called from the BYTE route, after the gate, the budget, the manifest
lookup and the R2 head — so only an admitted caller asking for a book that
really exists can cause one, and the anchor reaching Firestore has been
*looked up* rather than constructed.

🔴 **The units are stated three times between here and
`fulfill_audio_requests.py`'s `parse_stream_doc`, and that is not belt and
braces — it is the failure that DELETES BOOKS.** The reader's `_parse_stamp`
divides by 1000 only above `1e11`, so a **seconds** stamp reads as a date in
1970: a book somebody is halfway through looks two generations idle, and
`evict_candidates()` deletes on that reading. Nothing throws, nothing logs.

⚠️ **It stamps on HEAD as well as GET**, deliberately: the player's mandatory
§3.2 item-5 probe *is* a HEAD, so a real listen begins with one. Stamping
eagerly only ever **delays** an eviction; missing a stamp deletes a book. The
asymmetry decides the default.

⚠️ **One lane on purpose.** It writes `audio_streams` only. Nothing in a
request can tell the site's lanes apart — `/dev/` is a PATH on the same host,
so the Origin, the host and the bearer are identical — and a guess would be
wrong half the time. The reader unions `audio_streams` + `audio_streams_dev`
and takes the newest, so a `/dev/` listen still counts.

⚠️ **The throttle slot is claimed BEFORE the write, not after** — audit finding
L9 on the route this replaces, which recorded the key only on success and so
re-did the whole mint-and-write on every single range request while Firestore
was failing.

### 2. CORS — one already true, one measured and raised

`Authorization` was already in `allowHeaders` and was **verified live before
the change** (the preflight answered `Authorization,Content-Type,Range`). It is
now pinned by a test that says what breaking it costs: ⚠️ **an opaque network
error, not a status** — the failure this estate has already misdiagnosed once
as "the Worker is down".

`Access-Control-Max-Age` was **measured at 600**, a re-preflight every ten
minutes for the whole of a 13.7-hour mean book, on top of every seek. Raised to
**7200 — Chromium's own cap**, not a round number. ⚠️ Firefox allows 86400 and
**Safari clamps to 600 regardless**, which is worth knowing before reading a
Safari preflight trace as a bug. It caches the preflight ANSWER, never an
authorisation: the gate still runs on every real request.

### 3. The 401's wording — verified live, and LEFT ALONE

Phase 2's own recommendation, and the measurement agrees with it: an
unauthenticated `curl` on the byte route answers **401** with a worded refusal
(*"The ebook shelf is for the household. Sign in with Google to see it —
signed-out visitors get no list at all."*) carrying `Accept-Ranges: bytes` and
`Cache-Control: private, max-age=0, no-store`. `ebook-gate.ts` is one decision
with one answer; forking its copy forks the gate. The PAGE words audio
refusals itself from the HEAD probe and prefers the Worker's sentence when it
can read one. ⚠️ Vetoable — audio-specific wording is a Worker change.

### 🔴 And a route was DELETED: `POST /api/audio/:anchor/stream-ping`

It had been mounted since 2026-08-19. Six standing reasons, and ⚠️ **a git
revert is not an argument against any of them**:

1. The design puts the stamp on the byte route *"never a client-driven ping,
   which is both spoofable and one request per listener"*.
2. A stamp is **exactly what keeps a file from being evicted**, so a forgeable
   one pins the household's bucket at full size for ever.
3. It had **no caller**. `audiobook_catalog`'s `tests/test_listen_page.py`
   asserts that no site JavaScript mentions it, and the WIP that did call it
   was replaced on 2026-09-02.
4. 🔴 It wrote the **caller's email** (`updatedBy`) into a collection whose
   `firestore.rules` say `allow read: if true` — household addresses in a
   world-readable place. The replacement writes **nothing personal**: a book
   and a moment, never a person.
5. It carried its own copy of the SA JWT signing, the OAuth exchange and the
   datastore scope string (audit findings **F12** and **L9**) instead of
   `@platform/firebase-sa`.
6. Its ten-minute throttle contradicted the design's hour.

⚠️ **Audit finding F3's guard did not go with it.** The path-injection it
closed (`..%2Fsite_roles%2Fvictim%23` escaping the collection to name whichever
document a rules-bypassing service account writes) is closed on the byte route
by the manifest LOOKUP, and a test now pins that the stamp sits **downstream**
of that lookup — the same anchor gets a 404 and reaches no Firestore.

**Tests 2552 → 2567** (+16 `stream-stamp`, +2 CORS, −3 with the deleted
route), typecheck clean. Deployed from a throwaway worktree of HEAD with the
`node_modules` junction; `.bin` 51 before / 51 after the link's `rmdir` / 51
after `git worktree remove`.

🔴 **NOT VERIFIED, and it is the whole of what remains:** no stamp has ever
been written to a real Firestore, because no byte of audio has ever been
streamed by anybody. Every test drives a stubbed `fetch`.

---

## 2026-09-02 — Slash-command registration ran; the "CORS blocker" premise was wrong

Moved whole from TODO.md, superseding its own diagnosis. The item said the
admin route needed a CORS allowance before a browser could call it. Measured:
the route has had `origin: 'https://heygabi.ai'` CORS since 2026-08-17, and
`/admin`'s CSP gained `discord.heygabi.ai` in connect-src the same day —
the earlier "Failed to fetch" came from running the call on
`/status/pipelines/`, whose CSP correctly refuses that connect. Ran from
`/admin` page context (token never left the browser):
`POST /admin/commands/register` → 200, **"Published 8 global command(s)"**
(`link, have, gabi, recent, universe, review, suggest, guessgame`);
`/timeout`+`/cleanup` held (moderation off) and `/rsvp`+`/progress` held
(club writes off, per §15.3) — both deliberate. First-time commands can take
up to an hour to appear in Discord clients. No code change was needed; the
2026-08-17 provisioning was simply undocumented in the runbook's "how to get
a token" paragraph, which suggests the console-on-/admin path — that is the
correct and sufficient recipe.
> ⚠️ The last entry is a **duplicate**: "Estate API testing suite" was written
> twice, once as done and once as queued. Both are kept verbatim rather than
> silently reconciled — which of the two a later reader trusts matters, and
> deleting one would hide that the work log had disagreed with itself.


---

## ✅ "+ Add a verse" on /universes — phases 0–3 BUILT — 2026-09-02

> ⚠️ **BUILT, NOT DEPLOYED, AND THE DISTINCTION IS THE POINT.** Every line below
> describes code in `main` and tests that pass. Nothing is live: migration
> `0017` has not been applied to remote `estate_auth`, neither Worker nor the
> page has been deployed, and no browser has rendered any of it. The ordered
> deploy runbook, phase 4, and the first `landed` call are on
> [`TODO.md`](TODO.md). Design of record:
> [`info/universe-add-verse-design.md`](info/universe-add-verse-design.md).

**The item as it stood on `TODO.md`, moved whole:**

> ### 2. "+ Add a verse" on /universes — `docs/info/universe-add-verse-design.md`
> Mockup (private artifact): https://claude.ai/code/artifact/d1cfd9d1-2b7c-458a-8c66-5b5dc7e78384
> Owner: *"in the universe page add a plus button somewhere to add a verse and let
> it take series as an input"*
>
> - ⚠️ A direct "add" **cannot write** — a universe is compiled into two catalogs
>   and pinned by `library_catalog/packages/core/test/universes.test.ts:347`, and
>   `tools/universes.mjs:126` refuses to create one. The "+" creates a PENDING
>   request; the owner approves; a session prepares the commit; the owner deploys.
> - ☐ **OWNER DECISION Q1:** should `tools/universes.mjs` grow a `create` command?
>   Recommendation: yes, with `--why` **and** `--confirmed` both required — stricter
>   than the hand edits that have happened 11 times already.
> - ✅ **The two live discrepancies are FIXED 2026-08-26** — moved whole to
>   [`DONE.md`](DONE.md). The design itself is still ☐ unbuilt.

**What landed** — commits `c27c5c9` (Worker), `24c96a6` (CLI), `4430352` (pages).

| Piece | Where |
|---|---|
| Migration (additive, unapplied) | `apps/auth-worker/migrations/0017_universe_requests.sql` |
| Five routes + the name check | `apps/auth-worker/src/universe-requests.ts` |
| The member gate | `memberAllows()` / `requireApprovedMember()`, `middleware/auth.ts` |
| The served name list | `src/universe-names.generated.ts` ← `scripts/gen-universe-names.mjs` |
| The "+", the form, the queue | `sites/heygabi-home/public/universes/universes.js` + `index.html` |
| The approve/decline section | `verse-queue` in `sites/heygabi-home/public/admin/` |
| The sanctioned verb | `createUniverse()` in `tools/lib/universes.mjs`, `create` in `tools/universes.mjs` |

🔴 **Nothing built here can create a universe, and that was the whole design
problem rather than a limitation of the build.** A universe is not a row
anywhere in this estate: it is a decision in `data/universes.json`, in git,
compiled into two catalogs at build time and pinned by
`library_catalog/packages/core/test/universes.test.ts`, whose own comment says
the assertion failing IS that file working. A browser cannot commit to a git
repo. So the "+" files a **request**; the owner decides; a person edits the
file, updates the tripwire and rebuilds both catalogs. Making the list
runtime-writable was considered and rejected in the design (§1) — it deletes the
git history that is the entire value of the file.

⚠️ **THE FOURTH STATUS IS THE HONEST ONE, and it is why `approved` is never
drawn as done.** Between a yes and a build, a person has been told yes and
nothing exists. Both surfaces read *"approved — waiting on the next build"* for
that window, and past seven days `/admin` spells the age out — §6 Q3's
recommendation, which does not fix the gap (a page cannot deploy somebody else's
catalog) and only stops it being invisible.

**The two recommendations built as recommended, both VETOABLE:**

- **§6 Q1 — `tools/universes.mjs create`, gated by `--why` AND `--confirmed`.**
  The CLI refused to create a universe, in writing, and the refusal was right
  about DECISIONS and wrong about SYNTAX — there are 17 universes and it could
  make zero, so **eleven arrived by hand-editing the JSON**, the one path with no
  `--why`, no `canonicalNames` registration and no `validate` gate. The command
  is therefore **stricter than the hand edit it replaces**: `--confirmed` is
  required and nothing else in the CLI requires it. Veto = revert `24c96a6`.
- **§6 Q2 — a collapsed section on `/admin`, not a tab bar.** One surface per
  question, and *"what is waiting on my decision"* is the question that page
  already answers about pending members. Veto = move it to its own page.

§6 Q4 (withdraw) and Q5 (scoped autocomplete with a hint saying so) were also
built as recommended; both are one small function each.

**Two findings from the build, worth keeping:**

1. ⚠️ **`mine` has to be computed SERVER-side.** The page first inferred it from
   the absence of a requester name — true for a member, false for an approver,
   whose own row is named like every other one in the queue. That inference
   would have taken the withdraw button away from the one person entitled to
   press it. A test pins it.
2. ⚠️ **The 180 KB data file cannot simply be imported into a Worker.** esbuild
   cannot tree-shake inside a JSON object, and 145 KB of that file is `notes`
   prose and `_changelog` — history that belongs in git and not in a bundle.
   Hence a 3 KB generated projection plus a parity test that regenerates it in
   memory and diffs, rather than a hand-kept copy: a checked-in generated file
   is a hand-kept copy the moment nothing proves it is current, which is exactly
   how the page went a day one universe short in August.

⚠️ **§3.5's `GET …/names` did NOT delete the page's hardcoded list** — it demoted
it to the SIGNED-OUT fallback, because the route is members-only and *"sign in to
see which universes exist"* is a worse page than the one that exists. The parity
tripwire still holds it.

**Tests:** 2500 → 2552 pass, 0 fail. `npm run check:home` passes. **Not
verified:** anything live — every route test uses a fake D1, and no page has been
opened in a browser.

---

## ✅ LLM billing control — phases 0, 1, 2 and (this repo's half of) 3 — 2026-09-02

> ⚠️ **NOT the whole item.** `TODO.md`'s *"Toggle what can bill the LLM"* stays
> open: the per-member drawer, the other three repos' call sites, the soak and
> the audiobook Python client are all still ahead. This entry archives the
> phases that LANDED, so nobody re-derives them; the open remainder is in
> `TODO.md` and the design of record stays
> [`info/llm-billing-control-design.md`](info/llm-billing-control-design.md).

Owner ask, 2026-08-24: *"we need a way to toggle what can bill the LLM and what
can't inside the admin page somewhere. and even finer than that, i want to be
able to determine which features can bill and which can't per site per user
etc"* — built 2026-09-02 on the recorded recommendations (deny-only switches;
on/off per registered money path; no budgets and no metering in this phase),
each flagged vetoable at landing.

**Deployed:** `estate-auth` `e9aee6f4`, `catalog-index` `4804dbb6`,
`heygabi-home` `a52a8b81`, all from commit `644338d`. Migrations applied to
remote D1 **before** the deploys that needed them: `estate_auth` 0016, and
`index_catalog` 0005. Ledger lines in `deploys.log`.

🔴 **Nothing changed for anybody at that deploy, and the fact that it could
not is the design.** An empty `billing_policy` table is exactly today's
behaviour (§3.3 rank 17), the table IS empty, and `BILLING_POLICY` ships
`"off"` on the one consumer that reads the answer. Both properties are
asserted by a test named for them rather than assumed.

**Phase 0 — the registry** (`apps/auth-worker/src/billing-registry.ts`). 18
feature ids, declared ONCE, covering 35 of the design's 36 inventoried money
paths. ⚠️ **Every row was re-verified against source in all four repos before
being registered** — all 36 paths still exist, NO DEAD ROWS, though several
line anchors in the design doc have drifted (L4/L5, L8, A4, A9, E1–E3, E7) and
were re-found by symbol. **A6 is deliberately unregistered**: the ebook cover
classifier is keyed on a secret absent from `.env` on purpose, so it bills
zero, and a switch that does nothing is worse than no switch. The id list is
pinned LITERALLY by a test rather than derived from the table it describes,
because a derived pin agrees with any typo — and the bug it guards
(`research.cover` vs `research.covers`) produces no error and no log line,
only a money gate that is open forever.

**Phase 1 — the switches** (migration 0016, `billing-policy.ts`,
`billing-db.ts`, `billing.ts`). The resolver, the system door
(`GET /api/estate/billing/policy`, a cron's own app token — a cron has no
email to send to `/seen`), and the approver-gated read/write/remove.
🔴 **Policy can only DENY, structurally rather than by convention:** the
resolver's only output is a set of denied ids, there is no function that
returns "allowed", and every call site ANDs the set with the gate it already
had. 🔴 **The owner cannot be denied** — the write door refuses a deny naming
an `OWNER_EMAILS` row with a worded 409, because §7.2's "his row draws every
control disabled" is a UI rule and a UI rule is one fetch away from being
bypassed.

**Phase 2 — the Spending panel** on `/admin`, beside the permission map:
<https://heygabi.ai/admin/> → *"Spending — what may bill the model, and
where"*. Features as rows, sites as columns (the transpose of the member grid,
deliberately). Grant-class gesture per the page's own two-gesture grammar.
Turning a cell ON deletes the rule rather than writing an `allow` row, because
"no rule" IS the default state.

**Phase 3, this repo only** — E6, the apex shelf scanner, reads the answer and
ships inert. ⚠️ **The shadow line carries `proceeded` and `est_cents`** — the
outcome bit the 2026-08-16 audiobook soak lacked, and without which the flip
criterion is unfalsifiable.

**Three readings the design left for the builder, all vetoable:**

1. **`system` resolves ALONE in BOTH directions** — a cron ignores `everyone`
   rules and a person ignores `system` rules. §3.1 states the first half; the
   second follows from the same reasoning, and a clock-icon row that an
   everyone-deny could flip would be a lie about what the click did.
2. **`/me` answers a per-site MAP** where §3.4 says *"the same array"*. `/me`
   has no site, and a flat union would hide a control on a site where it is
   allowed. It is a curtain either way.
3. **E7 (the Groq rung) is a RUNG, not a feature.** It fronts four rows across
   three features, so denying `gabi.chat` denies BOTH providers — no Groq
   attempt and no Haiku fall-through.

**Tests:** 39 + 9 = 48 new; workspace **2500 pass / 0 fail** (baseline 2452).
Also fixed: `cors-coverage.test.ts` could only see paths that inline
`${AUTH_ORIGIN}`, so admin.js's whole `api(path)` surface was invisible to it
and the panel's DELETE was reported as refused at a preflight that in fact
allows it. A guard that fails on a clean tree gets ignored, and an ignored
guard still gets credited as coverage.

⚠️ **NOT VERIFIED:** no rule has ever been written, so no resolution has run
against a non-empty table in production; `billing_denied` has never been seen
on a real `/seen` or `/me` answer; and **nobody has rendered the Spending
panel signed in** — no cell has been clicked and the matrix has never been
drawn against a real `/api/estate/billing/rules` answer.

---

## ✅ GABI polish batch (owner live-test findings, 2026-09-02 ~10:33) — 2026-09-02

> ⚠️ Moved WHOLE from `TODO.md`, unedited, on the day the work landed. The
> original item is verbatim below; what was found and shipped follows it.

Owner drove the first live phase-2 test; measured off the wire + his report:
1. **Groq 413 payload ceiling** — 12-tool passes refuse instantly; a 6-tool
   pass at 4,736 input tokens RODE GROQ; iteration 2 (tool results appended)
   refused. Ceiling ≈ just above 5k tokens/request — check the key's tier on
   the Groq console; fix = leaner tool schemas for the Groq lane + capped
   tool-result payloads.
2. **Toolless converse fell back 2/2** — one `empty` status 200 (reasoning
   quirk past the 512 floor), one `refused` status 400 with NO error body in
   the log line. Add Groq error-text capture to the log (both param type AND
   emitted object), then diagnose.
3. **Personality flat on tool-backed answers** (owner: "she sounded like a
   bot, the personality wasnt coming through except on" an opinion ask —
   which WAS on-voice). Hypothesis: edge licence not carried into
   reporting-mode; extend the prompt so lookup answers are performed in her
   register too. Both flat turns were HAIKU, so this is prompt work, not
   Groq.
4. **Member-mention misattribution**: asked about @Diva's TBR, she claimed
   she can only read her own shelf, then quoted the ASKER's stats — confident
   misattribution. Check mention→member resolution and whether the new
   /progress tool covers cross-member reads.
5. **Answer QUALITY was poor across the test** (owner follow-up: "She also
   didnt really answer any of the questions properly"). The conductor's
   "every answer was right" claim was made off log lines that never carry
   text — wrong instrument, retracted. Diagnose from the actual channel
   transcript: retrieval quality vs. composition vs. the one Groq-ridden
   tool loop.
Dispatch as ONE agent after the fun-menu builder lands (same tree).

### What was found and shipped — 7 commits, `8d1cc1a`..`ee688ad`

Full ledger: [`info/gabi-groq-rung.md`](info/gabi-groq-rung.md) §11–§14.
Workspace **2418 → 2452 pass / 0 fail**, typecheck clean.
Deployed from a throwaway worktree of HEAD — see `deploys.log`.

| # | root cause, MEASURED | fix |
|---|---|---|
| 1 | 🔴 **Not "≈5k" — the FREE TIER's 8,000 TPM.** Groq refuses a request bigger than a whole minute's allowance with 413 rather than queueing it, which is the instant 37 ms refusal. The request measured **≈7,960 tokens before the question**: system prompt 2,817 + 13 tool schemas 4,119 + `max_tokens` 1,024 | `leanTools` (16,474 b → 7,522 b, **54% off**, Groq-side only), `capToolResult` with an explicit marker, `narrowToFamilies` from pass 2, and a **pre-flight** that refuses to send a doomed request and logs `estimated_tokens` vs `token_budget`. The full 13-tool request now fits: ~4,765 against a 6,276 budget |
| 2 | The body was **thrown away** at the `res.status !== 200` line, in both clients | `error_text` (truncated 200 chars) on every line, in **both** the param type and the emitted object; one shared `failureFor` taxonomy; 413 split out as its own reason `too_large` |
| 3 | The edge licence is **all about riffing** and never said the register applies while reciting a lookup — which is most of what she is asked | a new licence section (*"the lookup answer is a performance too"*, with *the facts stay exactly as the tool gave them*) + two **not-edge-gated** rules in `CHAT_TOOLS_SYSTEM` |
| 4 | 🔴 **DATA, not prompt.** Only GABI's own mention token was stripped, so the question named nobody; the model had `my_*` tools that read *the asker's own* rows and filled the gap with the only data in the room | `nameMentions` resolves other members to `@DisplayName`; `safeMemberName` sanitises it; the prompt forbids `my_*` for a third party, requires the refusal to use **their name**, and points at `book_reviews`, which IS a real cross-person read |
| 5 | *"do we have Jake's Magical Market on audio?"* → "Catalog's got nothing on that one yet", about **three books on the shelf**. TWO faults: the reduction kept the format word `audio` (index returns 3 books without it, **0 with it** — measured live), and ⚠️ **the have lane reads the INDEX, not the CSV**, so the 2026-08-31 scorer fix never touched it — its fixture tests passed all week while the live path missed | a closed list of format nouns stripped from the **tail only** (a leading strip was written, measured and rejected), plus a **second look at the catalogue** on a zero — never on a failure, because an outage is not an absence |

### ⚠️ Settled design taken: the HYBRID — Groq chooses, Haiku speaks

Pre-approved and taken. The one answer that fully rode Groq was flat AND
answered a different question than the one asked; and the composing pass is the
one that 413s, because it carries every tool result. So the selection pass rides
Groq and every pass from the first tool result onward is Haiku's — a quality fix
and a payload fix at once. It shrinks the (never-measured) savings, which is
stated in the ledger rather than hidden.

### ⚠️ What is NOT verified, and what is still the owner's

- 🔴 **No live Groq TOOL call has ever SUCCEEDED here.** Every attempt so far
  was refused before the model saw it. Tool-choice accuracy on an open-weights
  model remains the open question.
- **The 400 on `converse` is not diagnosed.** Ruled out by reading: an
  empty-content message, and a `json_object` ask without the word JSON. The
  capture now exists and the tail command that names it is in §12.1.
- **Every prompt change is unheard** — a test proves an instruction is present,
  never that it is obeyed.
- 🔴 **OWNER DECISION — the Groq plan.** The code can shrink the request; it
  cannot raise the tier. Upgrading to Developer turns every mitigation into
  headroom. Tracked as its own open item in [`TODO.md`](TODO.md).
- 🔴 **OWNER DECISION — `/progress percent`.** Tracked in `TODO.md` with the
  club-write flip.

## 2026-09-02 — THE DISCORD FUN MENU: five commands live, two dark, one toggle honoured

The **"Discord fun menu"** lane of the *BUILD PROGRAM 2026-09-02* item in
[`TODO.md`](TODO.md) — built in one pass on `apps/discord-worker`, on top of the
Groq phase-2 commit that landed the same day. Design of record:
[`info/discord-bot-design.md`](info/discord-bot-design.md) §2c.2, §2d, §2e, P1,
P2, P3 (as-built departures now recorded there as §9) plus
[`info/gabi-suggestions-design.md`](info/gabi-suggestions-design.md) for
`/suggest`. Runbook: [`access/discord-bot.md`](access/discord-bot.md) §15.

**Live, published by re-running the registration route** (§15.2 — the owner's
step; it needs an admin Firebase ID token no session holds):

| Command | Source | Credential |
|---|---|---|
| `/recent [count]` | `audiobooks.heygabi.ai/additions_log.json` | none |
| `/universe [name]` | `catalog.csv`'s `universe` column | none |
| `/review book:<title>` | the `reviews` collection via the existing shelf port | the service account already held |
| `/suggest [format] [mood]` | the catalogue + the asker's own shelf | ports already built |
| `/guessgame` | `catalog.csv` | none |

**Dark behind `GABI_CLUB_WRITES = "off"`:** `/rsvp club:<name>` and
`/progress club:<name> [percent] [chapter]`.

### ⚠️ Why the two writes ship dark — a missing measurement, not caution

Measured from this repo: the collection paths (`enforce-routes.ts:857` sweeps
`clubs/{id}/reads/{readId}/progress`), the member-slug doc id (`votes/{slug}`,
`members/:slug`, `slugifyName = displayName.toLowerCase()`), the `open` rules
gate, and `features.meetingRsvp` as a real club feature key. **NOT measured: the
field names inside an RSVP and a progress document** — they live in
`audiobook_catalog/site/`, which this build was directed not to read.

⚠️ This Worker's service account **bypasses `firestore.rules`**, so a wrongly
shaped write is not refused — it **succeeds**, and the club page then shows a
member who has not RSVP'd or a bar that never moves, with no error anywhere, on
somebody else's surface. `CLUB_WRITE_SHAPES` gathers every inferred name in one
block (`deepEqual`-pinned by a test) so verifying them is one diff, and
`/api/health` reports `club_write_shapes_verified: false` — an honest false that
says the feature is unfinished rather than leaving it inferred from a comment.
The flip checklist is `access/discord-bot.md` §15.3.

### The measurements that decided the build

- `GET audiobooks.heygabi.ai/additions_log.json` → **200**, 241,010 bytes,
  `{entries:[{key,title,author,added,source}]}`. `catalog.csv` has **no arrival
  date**, so answering "what is new" from its publication `year` would be a
  different question wearing the right word.
- `GET index.heygabi.ai/api/universes` → **401**. P3's *"one more index
  endpoint"* is unreachable from Discord (the index widens only for a Firebase
  ID token this Worker structurally cannot mint — `have.ts`'s own measurement),
  so `/universe` answers from `catalog.csv` and says in **every** answer that it
  counted ONE shelf.
- P2's open question — *"confirm the exact reviews read path before build"* — is
  answered: `shelf-exec.ts` already reads them with the service account this
  Worker holds. No new credential, no sixth credential-holding module.

### The decisions taken, each vetoable

1. **`/review` shows reviews and does not write one.** The doc-id convention
   belongs to `site/reviews.js`; a guessed id would not be refused, it would
   duplicate. The write half is a deep link to the book's page — `/gabi`'s
   propose-and-deep-link shape. A test asserts over every outbound call that
   `/review` issues no Firestore write and no non-GET, so a later session cannot
   "finish" it by guessing.
2. **`/suggest` is the RECOMMENDATION lane, not §2h's TBR write.** §2h remains
   unbuilt and needs a different name. The lane was already built and could only
   be reached by phrasing an @mention so `suggestIntent()` claimed the turn —
   the surface §10f's incident showed a stranger failing to find. Nothing about
   the lane was re-designed. ⚠️ It calls **no model**, so it is not a new row in
   `info/llm-billing-control-design.md`'s 36-path inventory.
3. **`/guessgame` guesses from FACTS, not an obscured cover.** No image pipeline
   exists here and `catalog-data.ts` throws `cover_href` away. ⚠️ Accepted
   limit: the round is stateless, so the answer rides in the button's
   `custom_id` and dev tools can read it. First thing to change if the game ever
   gains a leaderboard.
4. **`/progress` takes design §2e's recommendation (i)** — a required `club`
   argument — because (ii) would need this Worker to map a guild to a club,
   i.e. to enumerate the servers it is in, which §1.4 exists to avoid.
5. **`/rsvp` OFFERS buttons and does not write.** A command that both asked and
   answered would have to invent a default.

### The poll-ANNOUNCEMENT toggle, honoured (read only)

`features.discordPollAnnouncements` — an existing club feature key the audiobook
Worker already allows through `updateClubDetails`, with its toggle built on that
side — is now read by the sync tick. ⚠️ **Its default is the OPPOSITE of
`discordPollVoting`'s, on purpose: ABSENT MEANS YES.** No club doc carries the
key yet, so an affirmative `=== true` check would have silently muted every club
that already announces, and the symptom would have looked like a broken tick.
That is the `promptsEnabled !== false` idiom the estate already uses for a
club-level opt-out. An opted-out club is a **noted** skip naming the toggle, not
a silent one, and the opt-out does not touch a poll message already posted.

### Two touches to existing behaviour

- `commandsFor()` is now a function of **two** switches; re-running registration
  after either flip is a real step, and the route's answer states both.
- The *"Discord sent no interaction token"* sentence is hoisted to one constant.
  Two copies were about to become nine.

### Groq phase 2 untouched

No new model tool, no change to `GROQ_READ_ONLY_TOOL_NAMES` (the deliberate
literal allowlist), and `/api/health`'s phase-2 rows — `gabi_groq`,
`gabi_groq_ready`, `gabi_groq_model`, `gabi_groq_scope`,
`gabi_groq_tool_allowlist` — are unchanged.

### Tests

**2307 → 2418 workspace pass, 0 fail** (+111). Two existing tests were corrected
rather than deleted, and both corrections are findings: `interactions.test.ts`
used `/recent` as its stand-in for "a command the router does not know" — a
placeholder named after a designed-but-unbuilt feature has an expiry date, and
it expired the day `/recent` was built; and `moderation.test.ts`'s `BASE` list
grew from three to eight, deliberately a `deepEqual` so a base command being
added lands as a one-line decision.

### ⚠️ NOT VERIFIED

- **No command has been typed in Discord**, and registration has not been
  re-run, so none of the five is visible in any server yet.
- **The `reviews` join is unproven against real data** — nobody has confirmed
  the index's spelling of a title and the audiobook site's agree for a book that
  actually has reviews.
- **`/suggest`'s picks have still never been judged by a person.**
- **Nothing has been written to Firestore by `/rsvp` or `/progress`**, by
  construction.


## 2026-09-02 — GABI Groq PHASE 2: the Anthropic↔OpenAI tool translation (the expensive half now rides Groq)

**Moved whole from [`TODO.md`](TODO.md)**, from under *"Groq as GABI's first-line
model before Haiku"*. The item as it stood there, verbatim:

> ### ☐ Phase 2 — the tool-schema translation
>
> Not started, and not a "small addition": `tool_use`/`tool_result` ↔
> `tool_calls`/`role: "tool"`, preserving every invariant `converseWithTools`'s
> header records (all results for one turn in ONE user message; a failed tool
> comes back `is_error` rather than dropped; the last pass sends no tools; the
> dangling-colon guard against the 2026-08-18 silent partial). ⚠️ This is where
> most of the tokens are, so it is where the actual savings live. Open-weights
> tool-calling accuracy is the real question and the shadow ladder cannot answer
> it without executing tools twice.

**Shipped**: commit `7d9a9b3`, `estate-discord` version
`f9cd77f3-6c99-4700-93f2-3d28cb147294`, 2026-09-02 17:04 UTC, deployed from a
throwaway worktree of HEAD (`.bin` 51 / 51 / 51 across the teardown). No
migration — no D1 on this Worker. Design of record:
[`info/gabi-groq-rung.md` §8 and its §10 ledger entry](info/gabi-groq-rung.md).
Runbook: [`access/discord-bot.md` §11.9](access/discord-bot.md).

**The one decision everything else follows from: the conversation state stays in
ANTHROPIC grammar, always.** `src/gabi-groq-tools.ts` builds OpenAI shapes for
the length of one HTTP request and translates the reply straight back into
Anthropic content *blocks*; `converseWithTools`'s `messages` array is never
touched. That is what makes the per-turn fallback a **genuine replay** (a failed
Groq pass could not have mutated anything, so the Haiku call that replaces it
starts from byte-identical state) and what makes every invariant the item above
lists survive **by construction** rather than by re-implementation.

**Eligibility is an explicit allowlist, not an inference.**
`GROQ_READ_ONLY_TOOL_NAMES` sits beside the tool definitions in `gabi-tools.ts`:
thirteen read-only names, every one `mutates: false`. A loop rides Groq only if
**every** tool it offers is on it; one unlisted name and the **whole loop** —
not merely that turn — stays 100% Anthropic. ⚠️ It is a **literal**, deliberately
not a spread of the family arrays: the spread reads better and is wrong, because
it makes a tool added tomorrow eligible *by default* as a side effect of a commit
about something else. ⚠️ The gate is per LOOP because a loop carrying a mutating
tool also carries the state that decides whether to call it — letting its "safe"
turns ride Groq would put the cheap model in the seat that *proposes* the write.

**`shadow` is excluded, and that answers the item's own open question.** The item
above says the shadow ladder "cannot answer it without executing tools twice" —
so tool loops are never shadowed: they go straight to first-with-fallback under
the existing `GABI_GROQ = "first"`, with **no new env var**. The honest
instrument in place of a shadow is the live `fallback` rate.

**`is_error` is the one field that cannot be translated and must not be
dropped** — OpenAI has nowhere to put the flag, so it becomes plain text in front
of the content. Dropping it would teach the model that an outage and an absence
are the same thing, which here is the difference between *"the house does not own
it"* and a wrong answer.

**Argument validation is new, and it is the reason a translation layer is allowed
to exist.** A different vendor's open-weights model is exactly where a plausible
call with a wrong-shaped argument is likely and nothing downstream would notice —
`runTool` would hand junk to a catalogue query and get an empty result, which
*reads as* "the house does not have it". Required present, no undeclared
property, declared scalar type, enum membership; anything else falls through.

**The phase-1 guard was REPLACED, not deleted.** The build-failing test that kept
a tool turn off `api.groq.com` in every posture is now a stricter set: shadowed
and ineligible loops still make zero Groq requests, `off` is still byte-identical
to before the rung existed, and every failure class still falls through
invisibly. `test/gabi-groq.test.ts` 44 → **82 tests**; workspace 2269 → **2307
pass / 0 fail**; typecheck clean; no existing assertion weakened.

**Verified live** (GET `https://discord.heygabi.ai/api/health`, 200):
`gabi_groq_scope` → `toolless_calls_plus_read_only_tool_loops_first_only`, new
`gabi_groq_tool_allowlist` naming the thirteen, new feature
`gabi_groq_tool_loops`; every pre-existing field unchanged. No secret-shaped
value in the body.

🔴 **NOT verified, and the posture is already `first` so the next tool-bearing
@mention is the first live test:** no live Groq *tool* call has ever been made
from this repo. Whether Groq accepts this exact `tools` body and — the real
question — whether `openai/gpt-oss-120b` calls these tools *accurately* are both
unexercised. The savings are now **measurable** but unmeasured: a
`converse_tools` turn with `gabi_groq` lines and **no** `gabi_turn` line is a
turn that cost nothing at Anthropic.

---

## 2026-09-01 — GABI's book-knowledge SERVING half: found ALREADY BUILT, and closed the one real gap (the probes)

**Dispatched to build the serving half; found it shipped 2026-08-18 and
verified that instead.** Nothing was moved from [`TODO.md`](TODO.md) — there
was no entry, because the work had already landed and been recorded. This entry
exists so the next session does not build it a second time.

**The brief was stale, and the docs said so before any code was read.** The
task named phases 3 and 4 of
[`../info/gabi-book-knowledge-design.md`](../info/gabi-book-knowledge-design.md)
as unbuilt ("978 book packs sit inert… this build makes GABI able to read
them"). But that document's own §4.6 carries an **"⚠️ AS BUILT 2026-08-18 —
FOUR TOOLS, NOT TWO"** banner, and
[`gabi-book-knowledge.md`](gabi-book-knowledge.md) is an operating manual for a
shipped feature. **Reading the docs first is what turned a multi-layer
rebuild into an afternoon of verification** — and a rebuild would have been
actively destructive, since the live routes and tools are the ones GABI is
serving from.

**What already existed, verified by execution and not by reading the banner:**

| Asked for | Found at | State |
|---|---|---|
| Four retrieval modes (§6.2) | `apps/audiobook-worker/src/book-retrieval.ts:97` `RETRIEVAL_MODES` | built; `earliest`/`latest` sort by `ord`, `presence` returns a roll-up not passages |
| Explicit gunzip (opaque gzip) | `book-packs.ts:121` `gunzipJson()` via `DecompressionStream` | built, with the "no `Content-Encoding`" reason in its header |
| ±1-neighbour stitch at RETURN time | `book-retrieval.ts:515` `stitchPassage()` | built; clamped to the chapter, drops a neighbour rather than cutting text |
| Derive-never-store ceiling (§4.3) | `book-retrieval.ts:167` + `:232` | built; `through_ord` REFUSES without a matching `ingester_version` |
| The four routes, behind `vis_ebooks` | `book-routes.ts:277,311,372,429` | built and live |
| The FOURTH tool allowlist | `apps/discord-worker/src/gabi-tools.ts:448` `GABI_BOOKS_TOOL_NAMES` | built |
| The structural pinning test | `apps/discord-worker/test/book-knowledge.test.ts:76,131,142` | built; pins the set, that docs tools do not leak in, and the total |
| Tests | audiobook-worker **248**, discord-worker **950** | green before this work and after it — **unchanged, because no product code was touched** |

**The one genuine gap: NO PROBES.** `tools/estate-probes/` had not a single row
for any of the four routes, against the estate's own new-endpoint-gets-a-probe
rule. Closed with **+11**, taking the suite **118 → 129, all passing**:

- `AB17`–`AB21` — each route tokenless → the worded 401, plus
  `/api/books/available` on a garbage bearer.
- `AB22` — the refusal names **no pack, bucket or `text/` prefix**, asserting
  that the gate runs before any R2 GET. The derived text is a more attractive
  scrape target than the files (§5), so this is asserted rather than assumed.
- `D1`–`D4` — **the discord-worker probes were SWITCHED ON.**
- `D5` — new: `gabi_books_tools` on the live health route equals the four names
  in `GABI_BOOKS_TOOL_NAMES`, pinning the fourth allowlist against the DEPLOY
  and not only against the build.

**⚠️ The discord-worker finding is the one worth carrying forward.**
`DISCORD_API_ORIGIN` was still `null` in `lib/origins.mjs`, so the suite printed
*"discord-worker: not deployed yet (expected)"* on every run — **for weeks after
the Worker deployed and began serving GABI in production.** The skip was
deliberately designed to be *visible* so the suite would never silently forget
the Worker existed, and it still failed, because **nothing ever made it stop
skipping.** A skip that has outlived its reason reads exactly like a passing
suite. The lesson generalises past this repo: a visible-SKIP needs an owner or
an expiry, not just visibility.

**⚠️ A second gotcha, recorded because it cost a live round-trip:** the route
paths are **not symmetric**. `/api/books/available` and `/api/books/presence`
are plural; `/api/book/:bookId/search` and `/api/book/:bookId/passage` are
singular. The natural guess (`/api/books/{id}/search`) gets Hono's default
`text/plain` **`404 Not Found`** — no worded body — which is indistinguishable
from "the feature is not deployed". Now in §7 of the access doc.

**⚠️ `ESTATE_APP_TOKEN_BOOKS` is absent from the health route's `configured`
map** (measured; the map names ten other secrets). Its presence is observable
only through `gabi_books_ready`, the AND of three things — so a `false` there is
still "a setup gap, never a permissions one", but it does not say *which*.
Recorded, not fixed.

**Live, measured 2026-09-01** — all four routes answer identically to a
tokenless caller and to a garbage bearer:

```json
{"error":"unauthenticated","detail":"The ebook shelf is for the household. Sign in with Google to see it — signed-out visitors get no list at all."}
```

`discord.heygabi.ai/api/health`: `ok: true`, `gabi_books_enabled: true`,
`gabi_books_ready: true`, the four tool names, and the caps matching §4 exactly
(`bytes/turn=49152`, `passages/turn=12`, `turns/day=40`).

**NO DEPLOY WAS MADE, and that is the correct outcome.** The brief's deploy step
presumed new product code; none was written. `apps/` is byte-for-byte unchanged
— the change is confined to `tools/estate-probes/` and `docs/`, neither of which
ships to a Worker. **`docs/deploys.log` therefore gains no line**, because
nothing was deployed; writing one would have recorded a deploy that did not
happen.

**⚠️ NOT verified, and none of it can be from this side:** no signed-in read, no
real Discord question, and **no pack was read by a live authorized caller** —
the probe suite holds no credential by design, and fabricating an
`X-Estate-On-Behalf-Of` to exercise the token would be asserting an identity to
a live gate, which is not a probe. The **978 pack count in the brief is
unconfirmed** (the last MEASURED figure is 158, on 2026-08-18; the ingester adds
packs nightly, so the true number is certainly higher and certainly not 158).
The reading half stays the owner's acceptance test.

---

## 2026-09-01 — the ingestion card's UX condense: 22 controls down to 2

Moved WHOLE from [`TODO.md`](TODO.md)'s *"Ingestion card UX condense (owner ask
2026-09-01, in flight)"*, which read:

> Owner, after using the shipped pause feature: *"this all works good, the time
> selector is a not my favorite and its getting to be a lot of menus and
> buttons, can you reassess and condense for a better ux."* Plan: one contextual
> primary action (Pause menu when running / Resume when paused), preset time
> chips with the native picker demoted to "Custom…", both standing editors
> behind one counted disclosure. Presentation only — no route or reader changes.

⚠️ That item was written into `TODO.md` and **never committed** — it was handed
to this build as the working tree's one uncommitted edit, and removing it
returned the file to its committed state. So this entry is the only record of
it, which is why the whole item is quoted above rather than referenced.

**Landed and deployed the same day.** Commit **05c079e**, `heygabi-home`
version **2b39c4a5** (`deploys.log`, 2026-09-01T18:05:29Z). The plan was
executed as written; the rationale, the before/after table and the three rules
the condense had to obey are
[`info/ingestion-pause-until-gpu-design.md`](info/ingestion-pause-until-gpu-design.md)
**§9**, and the operating contract's card rows now carry the new labels beside
the unchanged writes
([`info/ingestion-pause-controls.md`](info/ingestion-pause-controls.md) §3, §3a,
§3c, §6).

**Presentation only, and the boundary was held:** `ops.ts` was never opened, no
route changed, no written shape changed, no feature semantic changed, the
reader repo was untouched. **Measured:** the default signed-in state with
nothing paused carried **22** visible interactive elements and now carries
**2**. Tests `59 → 77` on the card's pure half, workspace `2185 → 2203`, 0 fail,
typecheck clean, no existing assertion weakened.

**Three refinements the code argued for, all in §9:** the clock chips are
dropped rather than rolled forward when their hour has passed (a 23-hour pause
under a label reading "7:00 PM" is worse than no chip); the 8am chip is the
*next* 8am, because that is the whole meaning of that one; and a failed READ
became its own state offering **both** buttons, since the card cannot know
which single one is right when it could not read the document.

⚠️ **Still owed, and unchanged by this work:** nobody has clicked the card —
now including a layout nobody has *seen*, since the menu, chips, drawer and
disclosure are all injected after Firebase sign-in. That debt, and the live
soft-pause round trip, stay recorded in the entry below and in
`info/ingestion-pause-controls.md` §6.

## 2026-09-01 — soft pauses, recurring blockers and the do-not-disturb list, BUILT in both repos

Moved WHOLE from [`TODO.md`](TODO.md)'s *"DESIGNED, NOT BUILT"* item 0 on the
day it stopped being true. Owner's go: *"yes lets build this"*. The design is
[`info/ingestion-pause-until-gpu-design.md`](info/ingestion-pause-until-gpu-design.md)
(now headed BUILT, with a §8 listing the four deviations); the operating
contract is
[`info/ingestion-pause-controls.md`](info/ingestion-pause-controls.md) §§2, 3,
3c, 5, 6.

**Shipped in the order §5 demanded — reader FIRST**, because an old
`ingest_control.py` ignores `recurring_windows` and `exempt_processes` and
therefore fails **OPEN** (it would run during blocked hours, beside a running
game):

| Half | Repo | Commit |
|---|---|---|
| Reader — the two fail-open fields, recurrence evaluation, the GPU release | `audiobook_catalog` | **76aa89b**, merged **36a0f21** |
| Platform — `ops.ts`, the card, the words, the tests, the docs | `catalog-platform` | **d752d93** |

⚠️ **Shipped ≠ verified, and the gap is named rather than implied:** no live
control document was written through these routes, no human has clicked the
signed-in card, and the end-to-end soft-pause release has never run. Those
remain as a small ☐ item in `TODO.md`.

The item as it stood in TODO.md:

> ### 0. Soft pauses + recurring blockers — `docs/info/ingestion-pause-until-gpu-design.md` (v2)
> Owner asks 2026-08-31 (two messages; Q1 answered by the second): every pause
> that is not "until I unpause" becomes SOFT — released at the earliest of the
> next window opening (12am), the GPU next sustained-free, or an explicit
> ceiling — plus RECURRING weekly blockers (*"MTW 630-1015"*). Designed against
> the live `ingest_control.py`: soft pause = `paused_until` ceiling computed at
> write time + `pause_until_gpu_free` (processor-released, clear-then-start,
> fails closed); blockers = `recurring_windows` (absolute while in force).
> Effort ~M. 🔴 **Deploy order is load-bearing: reader FIRST** — an old reader
> ignores `recurring_windows`, which fails OPEN.
> - ✅ **ALL QUESTIONS SETTLED (Q1–Q4 + the v3 do-not-disturb addition) — the
>   design is BUILD-READY.** v3 (2026-09-01): the WoW-at-midnight incident —
>   the in-window guard is one lenient poll and a menu-idle game reads under
>   50%, so §4a adds `exempt_processes` (process PRESENCE blocks all new
>   starts, window or not; seeds with the WoW image names, verified live).
>   Build on the owner's go: reader half FIRST (two fail-open fields:
>   `recurring_windows`, `exempt_processes`), then ops.ts + the card. ~M
>   effort, ~2 days, live round trip at the end.
> - Found while designing: `pause_mode` (`all`|`manual_only`, owner ask
>   2026-08-23) is already BUILT in `ingest_control.py` — that is library TODO's
>   OR-3 answered; verify the card offers the choice, then close OR-3 there.

## 2026-08-31 — the 2026-08-24 conductor/morning-summary handoff blocks, actioned and retired from TODO.md

Moved WHOLE from the top of [`TODO.md`](TODO.md), where they had sat as layered
handoff blocks since 2026-08-24 — each one true when written, and each one's
headline claims overtaken by later work. **Every open claim in them was
re-verified on 2026-08-31 before the move** (instrument named per claim):

| Claim still reading as open in TODO.md | Re-measured 2026-08-31 |
|---|---|
| 🚩 F4 — estate SSO silently CSP-blocked on `/series` + `/universes`, "owner design-call" | ✅ **Fixed and deployed 2026-08-24 19:19Z** — `deploys.log`: heygabi-home `510adab`, "connect-src now names auth.heygabi.ai on /series + /universes", owner ran the deploy, verify:home 28 pages passed |
| GABI T2 propose-trigger "review + merge the branch, deploy discord-worker, THEN flip `GABI_CONFIRM_T2`" | ✅ **All three happened 2026-08-24** — `deploys.log` 16:29Z: merged + deployed inert (`358fc2d2`); 16:49Z: **flag flipped ON with the owner present** (`1e51665a`). `git merge-base --is-ancestor feature/gabi-t2-propose-trigger main` = yes |
| 🔴 rotate `PEER_TOKEN` (owner-only) | ✅ Rotated by the owner 2026-08-24 — recorded in the conductor-final block itself; leaked value invalid |
| ✅ THE DEPLOY PASS — library migrations `0390/0400/0410` "in the tree but UNAPPLIED" | ✅ Superseded by later deploys: `wrangler d1 migrations list --remote` answers **"No migrations to apply!" on BOTH instances** (measured 2026-08-31), and the library's `deploys.log` carries deploys through `dd290cd` (2026-08-27) |
| audiobook branches "merge when the pipeline is IDLE" | ✅ Content merged — the XSS fixes (`fba1a80`, `696a737`, `a9bca2e`), the CI JS gate (`js-tests.yml`) and the Drive→trash fix are all on `main` AND `origin/prod` (measured 2026-08-31; ⚠️ the `5b154e8` SHA the block names is NOT an ancestor of main — the content landed under different SHAs) |
| Low-confidence covers held (padhard 435, main 513) / LibraryThing rung | Still open — but each is **already tracked in `library_catalog/docs/TODO.md`** (the covers residue table; the 🚩 FLAGGED audit item). One fact, one home: the library copy is the home; the duplicates here retire with this move |
| `C:/lcw` worktrees prune / details-sweep cadence | Still open — extracted to their own ☐ items in TODO.md |

The blocks, verbatim as they stood:

> # ✅ CONDUCTOR FINAL — security-fix batch COMPLETE (2026-08-24)
>
> All queued security fixes are merged, deployed, and verified live. Conductor cron `5a38e1dd` retired.
>
> **catalog-platform audit highs** — `feature/audit-fixes-platform` merged `717acee` → `3ae51aa`, all targets deployed + logged in `docs/deploys.log`:
> - index-worker `4f9de096` — F5 CORS (POST no longer preflight-refused; verified live `GET,POST,OPTIONS`)
> - audiobook-worker `aecf8bd8` — F3 stream-ping path-injection (manifest lookup + encode; health 200)
> - discord-worker `f0fa48c3` — F6/F7 GABI shelf/recall tools offered + reviewed-set off full id set (health ok)
> - heygabi-home `e53e99ef` — F8 backup "last write" no longer scraped (verify:home 28 pages passed)
> - (auth-worker F2 `d1d53800` shipped earlier this session)
> Full platform suite green before deploys.
>
> **library PEER_TOKEN leak** — `feature/peer-token-secret` merged `d9fefa4`, both instances deployed (`ae88bf6` main, `dc67fdd` friend): token moved out of the public `PEERS` config into the `PEER_TOKEN` secret.
>
> ✅ **PEER_TOKEN secret ROTATED by the owner this session** — fresh random value set on BOTH instances (main + padhard). Incoming gate (`routes/peer.ts:69,127`) + outbound push (`peer-push.ts`) both key off `env.PEER_TOKEN`; leaked value is now invalid. This was the last 🔴 owner-only step — now closed.
>
> 🚩 **Still FLAGGED — owner design-call, NOT auto-fixed:** F4 — estate SSO is silently CSP-blocked (`connect-src`) on `/series` + `/universes`. Two opposite resolutions (widen the CSP vs guard `bootstrapEstateSso()`); access-increasing and sits beside KI-6, so it needs a browser measurement + your decision. See `docs/info/audit-2026-08-findings.md` (F4).
>
> (Separately in flight, NOT part of this security batch: T-B universe sweep + T-D pipeline-sanctity report — owner-directed research, land-for-review.)
>
> # ☀️ MORNING SUMMARY — overnight autonomous run 2026-08-23 → 24
>
> Conductor (Fable, orchestrating; all builds on Opus/Sonnet) ran the whole queue
> across the session resets. **Everything LANDED FOR REVIEW — nothing deployed,
> no remote migration, no paid sweep, no live flag flipped.** Usage at wrap:
> **session 53% · weekly 26% · Fable 2%** (~03:50 Phoenix). The conductor cron is
> now retired. This block is the handoff; delete it once you've actioned it.
>
> ## ✅ DONE 2026-08-24 (later AM)
>
> - **Audiobook site XSS fix SHIPPED** — the pipeline was leaving site/ regenerations uncommitted on idle runs; --rebuild-only published + pushed (index.html regenerated with the escape fixes). XSS fix is live.
> - **ebook-count SHIPPED** — merged (bbe1ae6); root-caused why it could not ship: site/ebooks.html was in NEITHER the pipeline commit allowlist NOR the auto-promote allow-regex (a3aaf5 added it to both, mirroring index.html), then --rebuild-only committed+pushed ebooks.html with the count (c26572d). Auto-promote gate takes it to prod.
> - **SHELF: researched, NOT fixed.** docs/info/shelf-review-2026-08-24.md. Blocked on standing ABS-box access + owner decisions (ebook gate, base-path). Nothing shelf-side changed.
> - ⏳ research-queue.mjs fix IN FLIGHT (work_alias + change_log mirror, atomic batch).
> - 🔴 STILL OWNER-ONLY: rotate PEER_TOKEN.
>
> ## ✅ DONE 2026-08-24 (post-wake, owner-driven)
>
> - **Dice + card-shuffle spinner animations** — built, merged, DEPLOYED both instances (main e8fb5e50 / padhard de0f5486, 1591 tests). Theme picker at /tbr now offers wheel / dice / cards.
> - **Padhard details queue → 0.** The "4" were 4 field-gaps across 2 works: 490 Ex Hex Duo filled via paid lookup (~1.6c on owner key, corroborated); 468 Veil of Darkness = unidentifiable, unknown verdicts. No open gaps remain.
> - ⚠️ **FOLLOW-UP: `scripts/research-queue.mjs` is broken by schema drift** — its in-memory mirror omits `work_alias` (0410) + `change_log`, and `makeShim.batch` is non-atomic (a partial write occurred: work.series written but change_log insert failed). Add both tables to MIRRORED + make batch atomic before using it. Padhard 490 was finalized with direct sanctioned writes instead.
> - ⏳ ebook-count auto-merge armed (cron, fires when the pipeline clears site/ebooks.html).
> - 🔴 STILL OWNER-ONLY: rotate PEER_TOKEN (public repo wrangler.toml); mint INDEX_READ_TOKEN x2.
>
> ## ✅ DEPLOYED 2026-08-24 AM (owner-driven, from phone)
>
> - **library main + padhard**: migrated 0400+0410, deployed (75818eff / bf1c225c), health green. Spinner live at /tbr on both.
> - **catalog-platform**: discord-worker deployed (GABI T2 DARK, 82818629); backup-board push triggered (/status shows real 100%).
> - **audiobook**: ingest-lock-pid + audit-fixes (XSS, Drive->trash, CI gate) merged to main (5b154e8); SyncPipeline triggered to rebuild+publish → ships the XSS fix.
> - ⏸ **ebook-count** still held — merge after the running pipeline commits site/ebooks.html (clears the collision).
> - 🔴 STILL OWNER-ONLY (type the secret): rotate PEER_TOKEN (wrangler.toml:203/:418, public repo); mint INDEX_READ_TOKEN x2 for GABI index rung 2.
>
> ## ☐ OWNER DECISIONS 2026-08-24 AM (from phone)
>
> - **Damsels of Distress covers → KEEP the 3D publisher mockups.** Done, no flat-jacket hunt.
> - **GABI T2 propose-trigger → ✅ BUILT (land-for-review, 2026-08-24).** Discord surface wired on
>   `feature/gabi-t2-propose-trigger`: model-parse a chat message → subject + field → dry-run propose
>   → confirm card, behind `GABI_CONFIRM_T2` (still DARK, inert when off). See the 🟡 decisions item
>   below for the go-live steps and the phase-1 boundaries. The library panel's own propose trigger
>   remains separate (library_catalog `feature/gabi-t2-panel`).
>
> ## 🔴 DO THESE FIRST (only you can)
> 1. **ROTATE `PEER_TOKEN`** — the library audit found it as a **plaintext value TRACKED
>    in the PUBLIC repo** (`bookbuddy/library_catalog/apps/worker/wrangler.toml:203` &
>    `:418`, inside `PEERS`). Live credential, internet-readable. `wrangler secret put`
>    a new value, move the `PEERS` entries to reference the secret, strip the plaintext.
>    Not auto-fixed (stripping without rotating breaks peer auth). The value was never
>    copied into any doc/commit.
> 2. **Approve the DEPLOY PASS** (below) — one pass ships the whole night's stack.
>
> ## ✅ THE DEPLOY PASS (all on `main`, tested, committed, NOT deployed)
> **library_catalog `main`** (tip `33c3e04`, **1,580 tests green**) — migrations `0390`,
> `0400`, `0410` are in the tree but UNAPPLIED. Order: `npm run db:migrate` +
> `db:migrate:friend` (both instances) → `npm run deploy` + `deploy:friend`.
> Carries: per-edition audiobook schema, duplicate finder, lent/borrowed/sold + OR-1
> (members endpoint + strict-create SHADOW), universe `--friend` fix, TBR spin picker,
> alias-aware research (build only — the paid re-ask is yours to run), GABI T2 panel
> (DARK), and **1 critical + 12 high audit fixes** (collection white-screen, last-owner
> guard, unauth peer read, GABI memory bugs, details-sweep subrequest estimate, …).
>
> **catalog-platform `main`** (tip after GABI merge `2eb0f3f`, **2,054 tests**) — backup
> `/status` board now shows the real 100%; GABI T2 confirm lane (DARK). Deploy: auth-worker,
> index-worker, heygabi-home (per the earlier deploy runbook / worktree-of-HEAD for the
> directory deploy).
>
> **audiobook_catalog — on BRANCHES, merge when the pipeline is IDLE** (it auto-commits
> `site/`): `feature/ebook-audio-count`, `feature/ingest-lock-pid` (252 tests),
> `feature/audit-fixes-audiobook` (1 crit + 5 high incl. stored-XSS, 1,466 py + 730 js
> tests). Then Firestore rules if STEP 11's `link` button is wanted live.
>
> ## 🟡 DECISIONS / FOLLOW-ONS waiting on you
> - ~~**Mint `INDEX_READ_TOKEN`**~~ ✅ **DONE 2026-08-25** — minted and set on all four holders in
>   one sitting, **two values, not one**: index-worker `INDEX_READ_TOKEN_LIBRARY` ↔ library main
>   `INDEX_READ_TOKEN`, and index-worker `INDEX_READ_TOKEN_LIBRARY2` ↔ padhard's own
>   `INDEX_READ_TOKEN`. ⚠️ The original ask said *one value on both*; that is right for ONE calling
>   app and wrong for two, because the index resolves the app **from the value presented** — a
>   shared value would make the app name meaningless and one leak would revoke both instances.
>   `MACHINE_APPS` gained `library2` accordingly; `MACHINE_VISIBILITY` is unchanged, so the
>   `library2` APP still cannot read the `library2` SHELF. Verified live: 200 with rows for a real
>   title on each token, named 401 `machine_token_invalid` on a wrong one. Rung 2's contract is
>   `library_catalog/docs/info/free-details-ladder.md` §4.
>   ⚠️ **It was never merely unminted** — the library rung was pointed at the HUMAN `/api/lookup`
>   with both env vars set, so it was refused every run while looking configured. Fixed in the
>   same batch.
> - **GABI T2 flag** `GABI_CONFIRM_T2` ships OFF. ✅ **Propose trigger now BUILT (land-for-review,
>   2026-08-24)** on `feature/gabi-t2-propose-trigger` (Discord surface + shared parse map): a
>   `fix_request` message → Haiku parse `{book,field,value}` → route to the one editable shelf →
>   `browse-works` title match → `fix-field` dry-run → confirm card, all DARK behind the flag and
>   inert with it off (pinned at the `handleMention` call site). Full estate suite green (discord-worker
>   948, gabi-conversation 34), typecheck clean. ⚠️ Phase-1 defers to the panel link on any ambiguity
>   (not-a-single-field / editable on both-or-neither shelf / 0-or->1 title match / modal door). To go
>   live: review + merge the branch, deploy discord-worker, THEN flip `GABI_CONFIRM_T2`. The panel's OWN
>   propose trigger stays separate (library_catalog `feature/gabi-t2-panel`).
> - **details-sweep** now honestly heals **1 book/tick** (was silently over-budget at 2 and
>   dying mid-second-book). Raise the cron frequency if you want the old rate; do NOT raise
>   the budget (must stay under the 50-subrequest ceiling).
> - **Low-confidence covers held for you:** padhard 435 *Risky Business* (set, Samantha to eyeball),
>   main 513 *Snow X Dwight* (set as stand-in). Damsels of Distress covers fixed (publisher 3D art;
>   say if you want flat jackets).
> - **LibraryThing ISBN rung** (library HIGH) — left for you: the fix needs the live API's XML
>   shape + a `source` CHECK value; a wrong parser is worse than the documented status.
>
> ## 🔍 AUDIT RESULTS (findings docs committed; crit/high FIXED on main/branches)
> - **library**: 4 crit / 13 high / 53 med / 25 low → `docs/info/audit-2026-08-findings.md`.
>   1 crit (PEER_TOKEN) = your rotation; 1 crit + 12 high fixed; 1 high (LibraryThing) flagged.
> - **audiobook**: 1 crit + 5 high fixed (branch); med/low in its gitignored findings doc.
>   ⚠️ The audit's own verify step first checked the WRONG repo and false-refuted real bugs
>   (incl. the stored-XSS) — caught and re-verified.
> - **board-game**: 0 crit / 0 high; 13 med / 11 low documented (`5daf64f`).
>
> ## SPEND / NOT DONE
> - Paid LLM spend overnight: **$0** (alias-aware research + covers were build-only; the padhard
>   cover run earlier was ~$0.82 on your key). Audits + builds were Opus/Sonnet time (weekly 20→26%).
> - NOT done, by policy: any deploy, remote migration, the GABI propose-trigger wiring, the
>   audiobook manifest stale-key delete (live data — do when pipeline idle), the ebook-site
>   reader/player builds (T-F was research only), the shelf items (research only — see
>   `docs/info/shelf-review-2026-08-24.md`, needs ABS-admin access).
> - `C:/lcw/` holds ~15 worktrees from the night's branches — prune the merged ones at leisure.
>
> 🔄 **CONDUCTOR STATUS (~03:1x, session 51%, weekly 26%):** AUDIT FIXES: audiobook 1crit+5high FIXED
> (feature/audit-fixes-audiobook, 7 commits, 1466py+730js tests — XSS x4, Drive delete->trash, CI JS gate).
> Library crit/high fix agent IN FLIGHT (feature/audit-fixes-library). 🔴 OWNER: rotate PEER_TOKEN (public
> library wrangler.toml:203/:418). After library fixes land+merge → write MORNING SUMMARY + CronDelete conductor.
> Audiobook branches (ebook-count, ingest-lock-pid, audit-fixes) merge in the morning when pipeline idle.

**Not verified in the 2026-08-31 pass:** whether the research-queue.mjs schema-drift
follow-up was ever fixed (it appears nowhere else in TODO.md — if it matters, it
needs re-raising as its own item), and whether anyone has SEEN a live T2 confirm
card since the flag flip.

---

## 2026-08-31 — Secrets-review follow-ups items 1–3: decided and done (moved whole from TODO.md)

The three decided/done numbered items from TODO.md's *"Secrets review
follow-ups — owner decisions, one at a time"* section. Steps 3 (three refused
pairs) and 4 (`audiobook_catalog/.env`) remain OPEN in TODO.md; only the closed
decisions move. Verbatim:

> 1. ✅ **DECIDED 2026-08-26 — leave the raw key files where they are.** Asked whether to move
>    `docs/access/keys/` (+ `.dev.vars` / `.env`) out of OneDrive via a junction
>    (Finding 4, §3.4). Owner: *"no thats fine"*. Not re-asking; the finding stays
>    recorded in the review as accepted.
> 2. ✅ **DECIDED + DONE 2026-08-26 14:35 — `ESTATE_EVENTS_TOKEN` set as a repo
>    secret** from the custody file (owner: *"yes do it"*); test event seen on
>    `/status` 15:17 (KI-10).
> 3. ✅ **DECIDED 2026-08-26 15:35 — option A: adopt 1Password NOW** (owner: *"a do
>    it, I have 1 password and time now"*). Supersedes the 2026-08-25 "deferred (C)".
>    Plan = `info/secrets-review-2026-08-26.md` §5, in its order: (1) `library_catalog`
>    templates + `op`-sourced push; (2) `docs/access/keys/*.txt` → vault items;
>    (3) `catalog-platform` Workers — the 10 no-master secrets (`DONOR_TOKEN` closed
>    2026-08-26); (4) `audiobook_catalog/.env` last.
>    Measured 15:35: desktop app **8.12.32** installed (Store package); **CLI not
>    installed**; owner's keystrokes: `winget install AgileBits.1Password.CLI`, app
>    Settings → Developer → *Integrate with 1Password CLI*, then `op whoami`.
>    Sessions never see a value — every move is `op` reading a file or a vault item.
>    **15:57:** CLI 2.34.1 installed (winget), app integration ON, account connected,
>    vault **`Estate`** created (`y5w264u3akx22cf2ffric32kii`). Build delegated to an
>    Opus agent: steps 1–3 of §5 in order, step 4 (`audiobook_catalog/.env`) estimate only.
>    **22:40 Phoenix — owner's four console keys are in the vault and pushed:**
>    `CLOUDFLARE_API_TOKEN` → GH secret on all 4 repos (proved: audiobook `deploy.yml`
>    run 33042797119 deployed with it); `CATALOG_PLATFORM_TOKEN` → GH secret on
>    library + games (proved: `git ls-remote` with checkout-style basic auth answers
>    HEAD; API sees all 8 repos); `ANTHROPIC_API_KEY_GABI` → `estate-discord`;
>    `library2.ANTHROPIC_API_KEY` → padhard `ANTHROPIC_API_KEY` (both by name only —
>    a live call spends money; owner to test one GABI message / one padhard research
>    before revoking the OLD keys). Vault now 21 items. **Owner still to do:** revoke
>    the superseded Cloudflare token, GitHub PAT and two Anthropic keys at their consoles
>    once the live tests pass.
>    **~22:50 Phoenix — owner: "gabi answered and padhard research worked, revoking old
>    keys now."** Both Anthropic keys verified LIVE by the owner; the four superseded
>    console credentials are being revoked by him (not measurable from here — a
>    revoked key only shows as a future 401). The vault is now the only master for
>    all four. Remaining in this item: the three refused `ESTATE_APP_TOKEN_*` pairs
>    (needs the probe question), `.env` step 4, and the two newly master-less
>    secrets (`ESTATE_APP_TOKEN_LIBRARY`, `INDEX_PUSH_TOKEN`).
>
>    ### ✅ STEPS 1 + 2 DONE — 2026-08-26. **16 items in vault `Estate`.**
>
>    | Step | Result |
>    |---|---|
>    | 1. `library_catalog` | **13 items** (8 credentials + 5 local dev config, 3 empty drop-boxes skipped by name). `.dev.vars.tpl` tracked; `--source op` on `push-secrets.mjs`; `--source op` and `--source file` dry-run plans **byte-identical** on all three paths; `HARDCOVER_API_TOKEN` pushed to BOTH instances **from the vault** and landed (new *Secret Change* versions, 16:22 Phoenix). Pushed to `library_catalog` main. |
>    | 2. `docs/access/keys/*.txt` | **3 items** — `ESTATE_CONDUCTOR_TOKEN`, `ESTATE_EVENTS_TOKEN`, `CLAUDE_USAGE_TOKEN`. `scripts/op-import-keys.mjs` is a **launcher**, not a second implementation — the logic stays in `library_catalog/scripts/op-import-dev-vars.mjs` (`--keys-dir`). ⚠️ **Files deliberately NOT deleted** — the owner's call; `keys/README.md` now says the vault is the master and the files are a courtesy copy. |
>
>    ⚠️ **Owner keystrokes: ~5–6 1Password approval prompts** across the whole
>    run (each `op` process can raise one; the scripts batch them so the count is
>    a handful, not one per secret). **Two early calls FAILED on an unanswered
>    prompt** — `authorization timeout` and `authorization prompt dismissed` — and
>    both were re-run and succeeded. No result was taken from a failed call.

---

## ✅ Rotated `CLOUDFLARE_API_TOKEN` lacks the D1 permission — backups' five `d1` jobs fail (found 2026-08-27 12:25 Phoenix)

Scheduled `backup.yml` run `33110351045` (19:50 UTC): every `wrangler d1 export`
job died with Cloudflare **"Authentication error [code: 10000]"**; every R2 job,
Firestore and retention passed. The token was rotated into the vault on
2026-08-26 22:30 from the "Edit Cloudflare Workers" template — which in today's
dashboard does NOT carry **D1**, contrary to `access/backup-restore.md` line ~654
("D1 edit is already in scope", verified 2026-08-15 against the OLD token).
Fix = owner edits the token in dash.cloudflare.com → API Tokens → **Edit** (value
unchanged, no re-push needed): add **Account · D1 · Edit**. Then re-dispatch
`backup.yml` and confirm 14/14. Correct the backup doc's permission table in the
same commit. ⚠️ Anything else that runs `wrangler d1` in CI with this token
(library/games `deploy.yml` migrations) is broken the same way until then.

**CLOSED 2026-08-27 ~15:10 Phoenix.** Owner added `Account · D1 · Edit` to the
token (value unchanged, nothing re-pushed); re-dispatched `backup.yml` run
`33119401066` → **14/14 green** (all five `d1` jobs, all R2 buckets, Firestore,
retention). `access/backup-restore.md` permission row corrected in `372b5dc`.
Lesson kept there: the "Edit Cloudflare Workers" template does NOT include D1.

## 2026-08-26 — the /universes page was one universe short, and nothing said so

Moved whole from [`TODO.md`](TODO.md)'s *"DESIGNED, NOT BUILT"* section, where it
read:

> - 🔴 **Two live discrepancies found, fixable today and independent of the design:**
>   - `sites/heygabi-home/public/universes/universes.js` hardcodes **16** universe
>     names; `data/universes.json` holds **17** — `DotHack` is missing, so the page
>     has been silently one universe short.
>   - `tools/universes.mjs:127`'s help text still says *"Six exist"*.

Both fixed. Neither was left as the one-line fix the design doc predicted,
because a one-line fix is exactly what created them.

| Discrepancy | Fix |
|---|---|
| Page listed 16, data holds 17 | `'DotHack'` added to `UNIVERSE_NAMES`, **and** a tripwire: `scripts/test/universe-names-parity.test.mjs` |
| CLI help said *"Six exist"* | `HELP` (a const) became `helpText()` (a function) and **derives** the count from `load()` |
| Same stale six in two more places | `tools/README.md` and `info/UNIVERSES.md` now print **no count at all** and point at `universes list` |

⚠️ **Why the durable fix is a tripwire and not a build step.** The obvious
answer — have the page read `data/universes.json` at publish time — has nowhere
to run. `sites/heygabi-home` has no `package.json` and no build; `npm run
deploy:home` is `wrangler pages deploy sites/heygabi-home/public`, a raw
directory upload. And `read.ts` still exposes no public "list universe names"
route, which is the reason the list is hardcoded in the first place (checked
again, not assumed). So the duplication stays and the *drift* is what gets
guarded: the test extracts `UNIVERSE_NAMES` out of the page source and diffs it
against the data file, and `deploy:home` runs `npm test` before it uploads
anything, so a divergent page cannot ship.

🔴 **The tripwire asserts that its own extraction worked, before it asserts the
names.** The failure mode of a regex-based guard is passing *vacuously*: rename
the const or reshape the literal and a naive matcher finds nothing, then
cheerfully reports two empty sets in agreement. **Proved it can fail** —
deleting `'DotHack'` from the page produced
`missingFromPage: [ 'DotHack' ]`, and restoring it went green again. A tripwire
nobody has watched fail is a tripwire nobody knows is armed.

⚠️ **What this cost, and why the count moved out of prose.** The page's own
header said *"keep this list in sync by hand; that file changes roughly monthly,
so a periodic check is enough — this is a maintenance note, not a bug."* It was
a bug. `DotHack` landed in the data on 2026-08-25 and the page served a cheerful
200 with sixteen rows until somebody read the two files side by side. The help
text's *"Six exist"* is the same failure aged further: it was written when six
was true and outlived it by eleven universes, in the one file that teaches a
session the rule. **A number with a live source does not get a frozen second
copy in prose** — derive it or drop it.

**Not verified:** nothing was measured about how the page *renders* the new row
beyond the name reaching `UNIVERSE_NAMES`; `/api/universe/DotHack` is
members-only and was not called signed-in.

---

## 2026-08-26 — a master-less estate pair finally has a master (§5 step 3, 1 of 4)

`INDEX_READ_TOKEN_LIBRARY2` — padhard's free-details rung 2 — had **no readable
master anywhere** (secrets review §3.1). `scripts/op-rotate-pair.mjs` minted a
fresh value into vault item `library2.INDEX_READ_TOKEN` and set it on both
holders in one run, verifier first.

| Step | Result |
|---|---|
| pre-flight probe with the new value | **401** — the route is live and actually checking |
| vault item created | `library2.INDEX_READ_TOKEN` |
| VERIFIER set | `catalog-index` ← `INDEX_READ_TOKEN_LIBRARY2` |
| **handshake** | `GET index.heygabi.ai/api/machine/lookup?title=…` → **200, 2 matching rows** |
| PRESENTER set | library-catalog-friend ← `INDEX_READ_TOKEN` |
| padhard's secret NAMES after | **10** — unchanged |

⚠️ **NOT proved:** that padhard *sends* the new value on her own traffic. Worker
secrets are write-only; the evidence is that wrangler accepted the write and the
name is still listed. The verifier half is proved directly.

🔴 **The other three pairs were REFUSED before anything was minted**, because
none has a live handshake a script can run — see [`TODO.md`](TODO.md) for the
per-pair reason and the two ways forward. The refusal is a guard in the script,
not a judgement call at the keyboard: a half-applied pair raises no error
anywhere, so rotating without a way to watch the new pair agree is shipping that
state and hoping.

### ⚠️ Two things this run taught, both bought the hard way

1. **A Cloudflare secret change is not live the instant `wrangler` returns.** The
   first attempt set the verifier, probed immediately, got 401, and correctly
   stopped half-applied — padhard's rung 2 was down for the couple of minutes it
   took to resume. The value was right; the edge had not caught up. The handshake
   now retries with backoff (2s/4s/8s/15s) before declaring failure, because a
   false negative there is itself the outage.
2. 🔴 **"Re-run this command" was NOT a safe retry, and the script said it was.**
   A second run would have minted a SECOND value and created a DUPLICATE vault
   item under the same title — two masters for one secret, which is worse than
   the half-applied pair it was recovering from. `--resume` reads the value back
   from the item the failed run created. **Any script that mints into a vault and
   then does something fallible needs a resume path**, or its own error message
   tells you to corrupt your custody store.
## 2026-08-26 — 1Password adopted: the three raw key files are vault items (§5 step 2)

📌 **Owner decision 2026-08-26 (option A)**, superseding the 2026-08-25 "defer".
Step 2 of [`info/secrets-review-2026-08-26.md`](info/secrets-review-2026-08-26.md) §5 —
*"three items, no code, and it removes three raw values from a synced disk in one
sitting."*

**Landed**

- `scripts/op-import-keys.mjs` — ⚠️ **a LAUNCHER, not a second implementation.**
  The naming convention, the idempotent create/update, the glued-value refusal
  and the rule that a VALUE reaches `op` over **stdin** and never argv all stay in
  ONE place: `library_catalog/scripts/op-import-dev-vars.mjs`, which grew a
  `--keys-dir` mode for this caller. Two copies of a function that decides how a
  secret is NAMED is "one canonical implementation" broken on the worst possible
  subject. The dependency runs the *opposite* way to the usual one (library syncs
  code FROM here) because that is where the allowlists and guards already lived —
  the ordering §5 chose. If the repos ever stop sitting side by side, move the
  shared module; do not fork it.
- `--bare` and `--tag` on the shared importer. ⚠️ `--bare` is a **claim about the
  names**, not a convenience: in `keys/` one FILE is one value and the file name
  IS that secret's name estate-wide, so nothing is holder-scoped. A `.dev.vars` is
  the opposite case, which is why it is per-run and not the default.

**Measured, 2026-08-26**

| Check | Result |
|---|---|
| Import | **3 created**, 0 failed — `ESTATE_CONDUCTOR_TOKEN`, `ESTATE_EVENTS_TOKEN`, `CLAUDE_USAGE_TOKEN` |
| Re-run | **3 unchanged**, 0 writes — idempotent, and it proves each vault value is byte-identical to its file |
| Whole vault | **16 items** by `op item list --vault Estate` — 13 from `library_catalog`, 3 from here. Titles and tags only |
| `gh secret list` (while verifying a custody row) | `ESTATE_EVENTS_TOKEN` set **2026-08-26T21:35:50Z** — ✅ KI-10's missing CI holder is closed |

⚠️ **THE FILES WERE NOT DELETED, deliberately.** That is the owner's call. They
are now a **courtesy copy**: a local script can read one without raising a
1Password approval prompt a human has to click. `keys/README.md` records the new
arrangement — vault is master, a disagreement is resolved in the vault's favour.

🔴 **A doc that was wrong before anyone changed anything.** `keys/README.md` said
*"Nothing here is backed up off this machine, on purpose."* That was **already
functionally false** — the folder is under `OneDriveDocuments`, and `.gitignore`
stops git, not OneDrive (secrets review §3.4). It is struck through and corrected
**in place** rather than deleted, because a session reading it would have drawn
exactly the wrong conclusion about exposure, and the reasoning underneath it
(these are conductor-minted values, so loss costs one re-mint, not an account
recovery) is still sound.

⚠️ **What this does NOT do:** it changes none of §3.1's eleven "no readable
master" rows. A vault holds what somebody could read; those are secrets nothing
on this machine can read. Step 3 is what would change that, and it is **not
done** — see [`TODO.md`](TODO.md).

**A tagging bug the second caller found immediately, worth recording:** `tagsFor`
originally called anything absent from *this repo's* credential lists
`local-config`. `ESTATE_CONDUCTOR_TOKEN` and `ESTATE_EVENTS_TOKEN` are absent from
those lists because they belong to a different repo — and were labelled config. A
real credential wearing a config label is the dangerous direction, so the rule was
inverted: `local-config` now comes from the **explicit** `LOCAL_ONLY` list and an
unrecognised name defaults to `credential`. One already-imported item
(`library.GABI_PANEL`, a dev flag) had its tag corrected by hand.
## ✅ The nightly backup lost a bucket to a Cloudflare RATE LIMIT — 429 was being retried like a 500 (2026-08-26)

**The failure.** Scheduled run
[`32955691152`](https://github.com/skymitch9/catalog-platform/actions/runs/32955691152)
(2026-08-26 09:56 UTC): 12 of 13 jobs succeeded and **`r2 (ebooks-gated)`
failed**. It listed **1,324 objects**, downloaded for just under four minutes,
and then every remaining `text/*.json.gz` GET came back from api.cloudflare.com
as "too many requests" (HTTP 429). It gave up on the first object whose four
attempts were all refused.

**The root cause, and why it is not the bucket's fault.** `scripts/backup-r2.mjs`
had one retry policy for everything transient: `status >= 500 || status === 429`,
4 attempts, ~0.5 s / 1 s / 2 s of backoff. ⚠️ **Those two statuses ask for
opposite things.** A 500 means *"that request went wrong, try it again"*; a 429
means *"you are going too fast, stop asking for a while"* — and Cloudflare's REST
API budget is counted over a window of **minutes**, per user. Under five seconds
of retrying could never have cleared it, and each attempt made the limit worse
while failing.

⚠️ **It is a whole-matrix problem wearing one bucket's name.** `backup.yml`'s
`r2` matrix runs five buckets on five runners in parallel, all presenting the
same `CLOUDFLARE_API_TOKEN`, so they share one budget and the aggregate burst is
what trips it. **Proven the same day, accidentally:** manual run
[`33016196134`](https://github.com/skymitch9/catalog-platform/actions/runs/33016196134),
still on the unfixed code, failed on **`game-covers`** while `ebooks-gated`
succeeded in 7m37s. Whichever job is still downloading when the shared budget
runs out is the one that dies. Do not go looking for something wrong with
`ebooks-gated`.

⚠️ **This is NOT the same failure as run 32469907247** (2026-08-21,
`library-covers` + `game-covers`). That one contained no 429s at all — it was
the mid-body socket death, `backup-restore.md` §3.2b. Two different bugs, two
different fixes; conflating them sends you to the wrong section.

**The fix** (`scripts/backup-r2.mjs`), three parts:

1. **429 has its own backoff:** `Retry-After` honoured verbatim when the server
   sends one (seconds or HTTP-date, capped at 180 s so a silly value cannot park
   the job); otherwise ~15 s / 30 s / 60 s / 120 s with jitter.
2. **429 has its own attempt budget: 7**, not 4 — enough total wait (~7¾ min
   worst case) to genuinely cross a minutes-long window. 5xx and transport
   failures keep their 4.
3. **Pacing**, so the limit is mostly never reached: a 200 ms floor between
   requests that **grows 250 ms per 429** (ceiling 5 s) and decays 10 ms per
   clean request. The five jobs cannot see each other, but a limit everyone
   backs off from is one everyone converges below.

Two more that matter when reading a log:

- ⚠️ **The listing call (`objects?cursor=`) now uses the same policy.** It was a
  bare `fetch` with no retry at all — so a 429 on the very first call a bucket
  makes, the one most likely to land in the five-job starting burst, killed the
  whole bucket outright, while a 429 four minutes later at least got four tries.
- ⚠️ **A SUCCESSFUL dump now says if it was rate-limited on the way.** A bucket
  that only got through by waiting is one heading for this failure, and the
  difference has to be visible before it fails again. Every wait is logged in
  words as well as the code — nobody reads a bare `429` at 3am and knows what to
  do.

**What deliberately did NOT change:** a bucket that genuinely cannot be read
still FAILS. The byte-size check, the zero-object rule and the
whole-bucket-excluded rule are untouched. This survives a rate limit; it does not
tolerate an unreadable bucket.

**Regression:** `scripts/test/backup-r2-exclusions.test.mjs` gained five tests —
five consecutive 429s survived (⚠️ *five*, one past what the old policy could
ever have taken), `Retry-After` honoured (asserted on the clock, not on a log
line), the listing call retried, a permanently-rate-limited bucket still failing
after 7 attempts, and the pacing floor. 11/11 in that file, 215/215 across
`npm run test:scripts`.

**Doc:** `docs/access/backup-restore.md` **§3.2c**, titled for the symptom
("the ebooks backup failed with 429") because that is what a debugger will
search for.

**PROVEN LIVE — run
[`33017504084`](https://github.com/skymitch9/catalog-platform/actions/runs/33017504084)
(2026-08-26 21:55 UTC, `target=all`): 14/14 jobs green.** `r2 (ebooks-gated)`
**816 objects / 227,645,607 bytes in 7m54s** (1,473 listed, 657 `transcripts/`
excluded per KI-5), surviving one rate limit. `audiobook-covers` 1,990 objects
in 16m26s and `game-covers` 1,125 in 11m33s, two rate limits each. Full table in
§3.2c.

⚠️ **The run measured two things nothing else could have.** First, **the live
API sends `Retry-After: 300`** — every one of the five waits was Cloudflare
asking for the full five-minute window, so the old ~2 s backoff was not merely
short, it was **150× short**, and no number of extra attempts at that scale
could ever have helped. (`RATE_LIMIT_MAX_WAIT_MS` trims it to 180 s and every
trimmed wait still succeeded; the trim is now measured, not assumed.) Second,
**the three big buckets were rate-limited at the same instant** — 21:58:07.2,
21:58:07.4, 21:58:07.6 — which proves the shared-budget diagnosis to the tenth
of a second. The cost is time: ~15 min → 16m26s, bounded by `audiobook-covers`.
A backup that takes longer and exists beats a faster one that loses a bucket a
night.

### 🔴 The same day, the failure NOTIFICATION turned out to be broken too

The manual run above was dispatched to exercise KI-10 step 2 — *"see one real
failure arrive on `/status`"* — because the owner had set `ESTATE_EVENTS_TOKEN`
at 21:35:50 UTC, 1 min 13 s before it started. `r2 (game-covers)` duly failed,
so `notify-failure` ran **against a real failure with a real token for the first
time ever**, and the event ring refused it as a bad request:

```
event ring responded 400
{"error":"missing_worker","detail":"Every event must name the `worker` that produced it."}
```

⚠️ **The refusal was correct and the workflow was wrong.** `parseEvents`
(`apps/auth-worker/src/worker-events.ts:100`) does
`Array.isArray(body) ? body : [body]` — one event object, or an array of them.
`backup.yml` posted `{"events":[{…}]}`, so the *wrapper* became "the event", and
a wrapper names no worker. Fixed in the same commit: the curl now sends a bare
`[{ … }]`.

⚠️ **The lesson is bigger than the JSON.** For five days KI-10 read "the
notification is shipped, it just has no secret" — a shipped-≠-verified failure
of exactly the kind the estate's verification rule names. **The missing secret
was hiding a payload that had never once been posted**, and the notification
would have failed silently on the first night it mattered. It is still not
verified end-to-end: proving it needs another *failed* backup, and the fix above
exists to stop those happening. KI-10 carries the open step and how to close it.

---

## ✅ Shelf parity card: an ABSENT `shadow_missing` looks identical to zero (found 2026-08-25)

The drift alarm (`auth-worker/src/shelf-parity.ts`, `deriveState`) sets
`shelf_behind` only when `shadow_missing > 0`. A reporter that never sends the
field (Justin's box before the runbook §4 snippet is added) therefore renders as
the same green "100% — complete copy" as a reporter saying 0 — the exact
silent-staleness trap the alarm exists to catch. Measured 2026-08-25 13:30
Phoenix: card green, `1,253 of 1,253 · checked 9:47 AM`; whether the field is
being sent is unknowable from the page.

**Fix (small, next Opus batch):** when `shadow_missing` is absent from the last
report, render a muted "shadow tree: not reported — add the §4 reporter field"
line on the card (`status.js`) and expose `shadowReported: false` in the API;
`deriveState` unchanged. Add a test with a payload lacking the field.
**Owner-side:** ask Justin for `crontab -l` and one line of the reporter's JSON
to confirm both the `*/15` hardlink cron and the field.

### As built — 2026-08-25 (evening)

Shipped exactly as written above. `deriveState` is **unchanged** — that was the
load-bearing half of the instruction, and it is why the fix is three small
pieces rather than a fourth parity state:

- **`apps/auth-worker/src/shelf-parity.ts`** — a new exported
  `shadowReported(stored)`: true only when the stored report carries a
  `shadow_missing` NUMBER. `GET /api/estate/shelf/parity` now answers
  `{ state, detail, report, shadowReported }`. ⚠️ `null` and a never-reported
  shelf are both `false`: `validateReport` strips a `"shadow_missing": null`
  to absent, and an absent report cannot have carried anything.
- **`sites/heygabi-home/public/status/index.html`** — a `#parity-shadow-note`
  paragraph under the detail line, `hidden` by default.
- **`status.js`** — `setParity` gained a fourth argument and shows the note as
  *"shadow tree: not reported — add the §4 reporter field. Until then this card
  cannot tell 'no books adrift' from 'nobody counted'."* ⚠️ Shown only when
  `shadowReported === false` **and** there is a report: `undefined` (an auth
  Worker predating the field) leaves it hidden, so deploy skew cannot make the
  page accuse a reporter of a gap it cannot actually see — the lesson of the
  404 branch two lines above it.
- **`status-shell.css`** — `.parity-shadow-note`, muted and italic, ⚠️
  deliberately NOT a state colour. An absent count is a gap in what we can see,
  not a fault in the shelf; an amber-looking line under a green card would be
  read as the household's books being at risk.

Five tests in `apps/auth-worker/test/shelf-parity.test.ts`, including the one
the defect asks for: a payload lacking the field derives `in_parity` **and**
reports `shadowReported: false` — both asserted together, because the bug was
precisely that the first fact looked like an answer on its own.

⚠️ **NOT verified live in the condition that matters:** the note has not been
seen rendered on a real card. The live shelf report either does or does not
carry the field, and reading that needs a signed-in devops session nobody in
this batch held. The owner-side ask below is untouched and still open.

## ✅ OneDrive-full rescue — junction dev clutter out of sync — 2026-08-25

Owner's OneDrive was full and failing to sync ("too many files in `.claude`",
items in use). Root cause: the dev repos live *inside* OneDrive, so node_modules,
ML models, build output, and Claude worktrees all sync. Fixes applied (nothing
deleted, nothing broken):
- **Cleared 2 dead subagent worktrees** — `wave3`/`wave4` branches
  (`feature/scanjobs-vision`, `feature/research-details`, from 2026-08-10) were
  **fully merged into main** (verified 0-ahead), so removing them lost nothing;
  that was the owner's "499 pending commits". Plus an orphaned `agent-*` worktree
  (487 files) under `catalog-platform/.claude/worktrees/` — the "too many files"
  sync-killer.
- **Junctioned ~5.4 GB out of OneDrive**: the 3.6 GB Vosk speech model
  (`tome-of-lore`) + 36 `node_modules`/`.claude` folders (1.85 GB) moved to
  `C:\lcw\onedrive-excluded\` (same-volume instant rename) with a directory
  **junction** left in place. OneDrive ignores reparse points, so it stops syncing
  them and reclaims the space; git/Node/Claude read them transparently.
- ⚠️ **OneDrive has NO native "don't sync this nested folder"** — "Choose folders"
  is top-level only, "Free up space" is cloud-only (still counts). The junction is
  the standard workaround.
- Tool + repeatable process: [`scripts/onedrive-exclude.ps1`](../scripts/onedrive-exclude.ps1)
  — idempotent, same-volume-guarded, skips in-use folders, has `-Undo`. **Run it
  after cloning any new repo** (owner's standing ask). Skipped once:
  `wow-recorder\node_modules` (electron.exe locked) — rerun when it's closed.
- Long-term real fix (not done): move the dev repos out of OneDrive entirely
  (e.g. `C:\dev`).

## ✅ HeyGabi homepage — internal links open in new tabs — DEPLOYED 2026-08-25

Owner: *open everything — especially admin and universes — in a new tab.* The
external catalog cards (audiobooks/ebooks/library/padhard/boardgames) already
carried `target="_blank" rel="noopener"`; the five same-origin card links did
not. Added `target=_blank rel=noopener` + the `sr-only "(opens in a new tab)"`
hint to **Universes, Series, Members(/admin), Status, Todo** in
`sites/heygabi-home/public/index.html` (commit `037cb35`, deployed via
`deploy:home`). ⚠️ Hrefs were left unchanged so `apex-admin-link.js`, which finds
`/admin` + `/todo` by href to gate them to approvers, still works.

## ✅ GABI T2 catalog-fix confirm lane — BUILT DARK 2026-08-24

Phase 1 of the T2/T3 confirm grammar (`docs/info/gabi-confirm-lanes-design.md`
§10): **the grammar with the one verb `fix-field`, compare-and-set and the 409.**
Owner scope: **T2 only (catalog-fix), Discord + library panel, audiobook surface
EXCLUDED.** Ships **DARK** behind `GABI_CONFIRM_T2` (affirmative-only, off on both
surfaces) — nothing changes for users until the owner flips it. On branch
`feature/gabi-t2-confirm` here; `feature/gabi-t2-panel` in library_catalog.

What landed here (catalog-platform):
- **Surface-neutral core** in `packages/gabi-conversation/src/confirm.ts` — the
  `confirm_change` `PendingChoice` kind (zero new Durable Object writes), the
  `FieldChange`/`Restatement` shapes, a default-deny field allowlist
  (`T2_CONFIRMABLE_FIELDS` — free-tier only, never `title`/`authors`),
  `buildConfirmProposal`, `buildRestatement`, `compareAndSet` (the §4 409, whole-
  state exact equality), `checkConfirmPress` (10-min TTL, nonce, redundant
  `askerId`), and the canonical MAC material + `gc2` custom_id format.
- **Discord wiring** in `apps/discord-worker` — the `GABI_CONFIRM_T2` flag,
  `fix-field` as a seventh Tier-2 allowlist (separate from the additive Tier-1
  array), the MAC (mirrors `moderation.ts`, keyed on `ESTATE_APP_TOKEN_DISCORD`),
  the embed + confirm/cancel rendering, `proposeConfirm`/`pressConfirm` (dry-run =
  capability check #1; apply = check #2 + compare-and-set; nonce consumed BEFORE
  the call), the `fixField` port, and the `gc2` router + dispatch.

Invariants enforced: capability checked TWICE, compare-and-set on `before`, the
nonce MAC'd (⚠️ a deliberate departure from design §3.3, per the owner's T2
brief), the proposal in the existing pending slot, ~10-min TTL, worded refusals,
DARK by default. Tests: 918 discord-worker + 30 package, typecheck clean. No live
Discord/panel exercise (unit-level only). Pending owner review.

## ✅ Pausing ingestion is a QUESTION now — LIVE 2026-08-24

His ask, verbatim (2026-08-23): *"when i manually pause the pipeline it says
nothing can override it. I want it to ask me if i want to stop all work until
unpaused or if scheduled window is fine to continue."* His decision: **ask every
time**, save nothing as a preference, and show which mode is active.

**Live at** [/status/pipelines/](https://heygabi.ai/status/pipelines/) — the
"Ingestion — pause & resume" card. "Pause now" became "Pause now…" and opens:

> [Stop all work until unpaused] [Let the scheduled window continue] [Cancel]

| | |
|---|---|
| Built on | `feature/pause-asks`, merged to `main` as `310152b` |
| auth-worker | version `151273b2-70c7-47e5-944e-036118866767`, 04:01Z |
| heygabi-home | deployment `197b9230`, 04:05Z |
| Tests | auth-worker **462 pass / 0 fail**; whole workspace **2009 pass / 0 fail**; `typecheck` clean |
| Probes | `npm run probe:estate` **118 passed, 0 failed** |

⚠️ **THE DEPLOY ORDER IS PART OF THE FEATURE, not housekeeping.** The Worker
went first and the site second. The page asks the new question and sends an
answer `ops.ts` must already understand — site-first would render two buttons
whose answer the Worker discards, which is the worst possible failure here: a
control that looks like it worked and did nothing. Worker-first only means the
Worker can answer a question nobody is asking yet, which is harmless. Anyone
re-deploying this pair does it in the same order.

**Two design calls worth keeping**, both recorded in `9471961`'s own message:
`pause_mode` is written **unconditionally into the updateMask beside `paused`**,
so the flag and its meaning land in one write and there is no instant where the
document says "paused" carrying the *previous* pause's meaning; and Resume and
Start-now **reset it to `'all'`**, because the question is asked every time and
a leftover `'manual_only'` would silently become the default of a pause nobody
chose it for. Fails closed everywhere: absent or null → `'all'`; present but not
a mode → **400 in words**, never coerced.

⚠️ **NOT VERIFIED — and it is the half that matters most.** Nobody signed in and
actually pressed "Pause now…". The two answers are proven by **42 auth-worker
unit tests** and **9 `ingestion-time` tests**, not by a live pause. The live
evidence goes exactly this far: `/assets/ingestion-time.js` is byte-identical to
`HEAD` and carries `pause_mode` three times, `/status/pipelines/pipelines.js` is
byte-identical to `HEAD`, and `auth.heygabi.ai/api/health` is `ok:true`.

⚠️ **The handed-down verification step for this was WRONG and would have read as
a failed deploy** — `curl .../status/pipelines/pipelines.js | grep -c pause_mode`
was specified to be > 0. `pause_mode` appears **nowhere** in `pipelines.js`:
not live, not at `HEAD`, not in the working tree. It is written by the Worker's
`ops.ts` and read by `assets/ingestion-time.js`; `pipelines.js` only renders the
card. **The grep returns 0 on a perfectly good deploy.** Kept here because the
next person handed that check would have rolled back working production.

---






## ✅ K3 and K19 — the two kept patterns, distilled to `info/` 2026-08-23

> Both were kept in the queue on purpose ("kept as the worked example", "kept
> as the pattern") — which made them reference filed as work. The distilled
> form is now [`info/doc-tree-maintenance.md`](info/doc-tree-maintenance.md);
> the originals follow, unchanged.

---

## K3. ✅ DONE 2026-08-21 — kept as the worked example

The item was **"Add the shelf link to the admin portal — BUILT, NOT DEPLOYED"**
in `audiobook_catalog/docs/TODO.md`, whose own body read *"✅ COMMITTED AND
DEPLOYED 2026-08-20 (`cf3aa87`) … confirmed rendering at heygabi.ai/admin"*.
The heading was the stale half and had been asserting the opposite for a day.

Moved **whole** into that repo's `DONE.md`, heading corrected to a dated one,
with a note saying which half was wrong. Body unchanged — not summarised.

⚠️ **Kept here as the worked example for K17**, because the general sweep will
hit this shape repeatedly: *the heading and the body disagree, and the heading
is usually the stale one.*
## K19. ✅ DONE 2026-08-21 — kept as the pattern

Cadence-aware backup grading shipped: `BACKUP_KIND_CADENCE_MS` per kind, amber
at 1.5x / red at 2.5x for cron-driven stores, exposure grading retained for
on-demand ones, plus a `notify-failure` job. Write-up in `DONE.md`.

⚠️ **Kept here because the SHAPE recurs:** a threshold derived from a premise,
and then the premise moved. When you meet a constant with a comment explaining
it, **check the comment's premise is still true before trusting the number** —
these numbers looked defensible the entire time.

⚠️ **One half is still open**, in `KNOWN_ISSUES.md` KI-10: the notification has
never seen a real failure, and `ESTATE_EVENTS_TOKEN` may not be set as a repo
secret.

## ✅ The Kiro queue K1–K17 — swept out of the work log 2026-08-23

> Eleven sections were sitting in `catalog-platform/docs/TODO.md` wearing a
> **✅ DONE** badge. The standard is explicit that a finished item does not
> get a badge in the work log — it gets **moved**, whole, in the session the
> work completes. Moved here verbatim; nothing summarised.

⚠️ **K17 claimed this sweep was already finished, and the file it lived
in disproved it.** The queue carried *two* K17 headings at once — `◐ PARTLY
DONE … the rest of the sweep is still open` and `✅ DONE … Finished sections
swept from TODOs` — and on 2026-08-23 there were still **eleven** badged
sections in that same file. The optimistic heading was the stale half, which
is precisely the pattern K3 was kept around to teach. K17 is done because
THIS sweep did it, not because the earlier heading said so.

⚠️ **K16 was double-numbered too** — two `## K16.` headings, one wrapping
the other in a `<details>`. Both preserved below in the order they appeared.

---

## K1. ✅ DONE 2026-08-21 — Pagination scroll-to-top (library_catalog)

Completed by Kiro session 2026-08-21. `goToPage` handler with scroll + focus, both Pager instances, filter resets routed through it.

**Owner, 2026-08-20:** *"when we paginate to a new page on the physical book
libraries it doesnt scroll to the top, i know its an easy fix but we need to
save credits so file it."*

**Located for you.** `apps/web/src/components/Pager.tsx` is the control;
`apps/web/src/pages/CollectionPage.tsx` is the ONLY consumer, and it renders the
pager **twice** — above and below the results — at lines ~854 and ~864, both
with `onPage={setPage}`.

**Do this:**

1. In `CollectionPage.tsx`, define one handler beside the existing `page` state:
   ```tsx
   const goToPage = useCallback((next: number) => {
     setPage(next);
     // ⚠️ Move FOCUS as well as pixels. Scrolling alone leaves a keyboard or
     // screen-reader user parked at the old position while the page changes
     // underneath them.
     listHeadingRef.current?.focus();
     window.scrollTo({ top: 0, behavior: 'smooth' });
   }, []);
   ```
2. Give the list heading `ref={listHeadingRef}` and `tabIndex={-1}` (so it can
   take programmatic focus without entering the tab order).
3. Pass `onPage={goToPage}` to **both** `<Pager>` instances. ⚠️ Both — the
   bottom one is the one people actually use, and fixing only the top is the
   easiest way to "fix" this and have it still be broken.
4. ⚠️ **Cover the other way the page changes:** `CollectionPage.tsx:232` calls
   `setPage(0)` when a filter or sort resets. Route it through `goToPage` too,
   or changing a filter still strands the reader mid-list.

**Verify:** `npm run dev` in `apps/web`, load the physical book collection,
page forward from the BOTTOM pager, confirm the viewport is at the top and that
`document.activeElement` is the heading. Then change a filter and confirm the
same. ⚠️ Check on a narrow viewport — the owner's symptom is worst on mobile.

**Not verified by me:** whether the ebook/audiobook lists share this component.
`grep -rn "Pager" apps/web/src` says CollectionPage is the only consumer today,
so a fix here should cover every list that uses it — confirm rather than assume.

---

## K2. ✅ DONE 2026-08-21 — Typecheck green (library_catalog) — 0 errors

Completed by Kiro session 2026-08-21. All TS errors fixed (`WorkPage.tsx`, `peer-push.ts`, `catalog.ts`), `npm run typecheck` exits 0.

⚠️ **This is the highest-leverage small item on the list.** `npm run typecheck`
is currently RED in this repo, which means any other change lands in a tree
where new breakage cannot be told from old. **Three other items on this page are
gated on it.**

**The complete list, measured 2026-08-21. All are in files nobody has modified
— they are pre-existing, not caused by in-flight work.**

| File | Error | Shape of the fix |
|---|---|---|
| `apps/web/src/pages/WorkPage.tsx:448` | `TS2339: Property 'peerHoldings' does not exist on type 'WorkDetail'` | The API returns it and the type does not admit it. Add `peerHoldings?: …` to `WorkDetail` — ⚠️ find where the server actually builds it and copy THAT shape, do not invent one |
| `apps/worker/src/lib/peer-push.ts:37,147,148,149` | `TS2352: Conversion of type 'Env' to 'Record<string, unknown>'` ×4 | Cloudflare's `Env` has no index signature. Either add one to `Env`, or go through `unknown` at each site: `(env as unknown as Record<string, unknown>)` |
| `apps/worker/src/routes/catalog.ts:348,352` | `TS2551: Property 'work_key' does not exist on type 'Work'. Did you mean 'workKey'?` | Snake/camel slip. ⚠️ **Read both lines before renaming** — if the value genuinely arrives from a raw SQL row, the fix is a typed row interface, not a rename that silently reads `undefined` |

**Do this, in this order:**
1. `cd bookbuddy/library_catalog && npm run typecheck` — capture the FULL output
   first, so you can prove the count went to zero rather than moved.
2. Fix the two mechanical groups (`peer-push.ts`, `catalog.ts`).
3. Fix `WorkPage.tsx` last — it is the one that needs a real answer about the
   API shape.
4. `npm run typecheck` again, then `npm test`.
   ⚠️ **Do not pipe the test run into `tail`** (rule 7 above).

**Verify:** `npm run typecheck` exits 0. Report the before/after error counts.

</details>

---

## K4. ✅ DONE 2026-08-21 — Docs backup scheduled (daily 3am, verified)

Completed by Kiro session 2026-08-21. Windows Scheduled Task `EstateDocsBackupR2` registered, daily 3am, run once by hand and verified in R2.

`catalog-platform/scripts/backup-docs.mjs` backs up all four gitignored `docs/`
trees to `estate-backups/docs/<repo>/<UTC>.json.gz`. It works, and its restore
is drilled (`backup-restore.md` §6b). **Nothing schedules it** — it has run by
hand twice, which is the silent-staleness trap with a long fuse.

⚠️ **It CANNOT go in GitHub Actions.** Three of the four docs trees exist only
on the owner's machine; CI would produce a cheerful archive of the one tree that
IS committed and silently omit the rest.

**Do this — a Windows Scheduled Task, beside the estate's other local jobs:**

```powershell
$action  = New-ScheduledTaskAction -Execute 'node.exe' `
  -Argument 'scripts\backup-docs.mjs' `
  -WorkingDirectory 'C:\Users\nbasl\OneDrive\Documents\vs-code-repos\catalog-platform'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'EstateDocsBackupR2' -Action $action -Trigger $trigger `
  -Description 'Backs up the four gitignored docs/ trees to estate-backups. docs/access/backup-restore.md 6b'
```

⚠️ **It needs an authenticated `wrangler`**, which means the task must run as the
owner's own user (not SYSTEM) or `wrangler r2 object put` fails with no usable
message. Run it once by hand from the task (`Start-ScheduledTask -TaskName
EstateDocsBackupR2`) and read the result before trusting the schedule.

**Verify:** `npx wrangler r2 object get estate-backups/docs/catalog-platform/<the
new UTC>.json.gz --file ./t.json.gz --remote`, then `node
scripts/restore-docs.mjs ./t.json.gz --list` — it re-checks every sha256 and
writes nothing. Delete `t.json.gz` afterwards.

⚠️ **The archives contain `docs/access/keys/` — RAW service-account JSON and
bearer tokens.** Never copy one anywhere that serves bytes to a person, and
delete any local copy when you are done with it.

---

## K5. ✅ DONE 2026-08-21 — Lint scripts/ in CI (audiobook_catalog)

Completed by Kiro session 2026-08-21. `scripts/` added to lint matrix, C901 waived on `extract_epub_cover` with inline comment, CI green.

From the tech-debt list: the lint workflow covers `app tests` only.
`scripts/build_ebook_manifest.py` carries a pre-existing **C901** (too complex)
on `extract_epub_cover`.

**Do this:** add `scripts/` to the lint matrix in the audiobook repo's lint
workflow, then either refactor `extract_epub_cover` or waive C901 for that one
function with a `# noqa: C901` **and a comment saying why**. ⚠️ A blanket
per-file or global waiver is the wrong fix — it silently exempts every future
function in the file.

**Verify:** the lint job runs over `scripts/` and is green. Say which of the two
routes you took.

---

## K6. ✅ DONE 2026-08-21 — cp1252 emoji crash fixed (audiobook_catalog)

Completed by Kiro session 2026-08-21. `PYTHONIOENCODING=utf-8` set globally in pipeline task env. Verified under `chcp 1252`.

Three incidents in two days (smoke script, club smoke, uploader): an emoji in a
`print()` crashes any run whose console is cp1252 — and **always between setup
and cleanup**, which is the worst place for a crash.

**Preferred fix, because it is mechanical and global:** set
`PYTHONIOENCODING=utf-8` in the pipeline's `.bat` / Scheduled Task environment,
so no individual script has to remember.

**Second half, optional but better:** a repo lint rule banning non-ASCII in
`print()` strings, so the next one is caught at review rather than at 3am.

⚠️ **Do not "fix" this by removing the emoji from the three known scripts.**
That is the same class of fix as prose advice: it does not stop the fourth one.

**Verify:** force a cp1252 console (`chcp 1252`) and run one of the affected
scripts end to end.

---

# TIER 2 — a session each, well-specified

## K7. ✅ DONE 2026-08-21 — Donor hands out printed volume number (library_catalog)

Completed by Kiro session 2026-08-21. `series_index_display` added to `donorDetailsFor` and `detailFindings`, key widened.

`library_catalog/apps/worker/src/routes/donor.ts` gives out `seriesIndex` (sort
position) but refuses `series_index_display`, on the reasoning that "the
caller's copy of the book has its own cover". **That refusal is now the odd one
out:** since 2026-08-19 both machines that WRITE the column derive it
(`seriesIndexDisplayFrom`), and the main catalogue holds **81 hand-quoted forms**
(`Volume 07`, `Book 1`) that are strictly better than a derivation and are
currently not offered.

**Do this:** one field in `donorDetailsFor`, one in `detailFindings`. ⚠️ It needs
a key wider than `DetailField` — that is the actual work, and it is why this was
left. Quality, not convergence: nothing is broken today.

**Verify:** a donor response for a work with a hand-quoted display form carries
it; one without still falls back to the derivation.

---

## K16. ✅ DONE by Kiro 2026-08-21 — structure correct, encoding was not

3,875 lines out of `HANDOFF.md`: 2,895 to `DONE.md`, 417 to `TODO.md`, and 670
sorted into three NEW `info/` docs by topic — which is the "sort three ways"
rule followed properly, not just two. The full original is archived and the stub
points at all six destinations.

🔴 **But the outputs came back cp1252 double-encoded** — 1,362 lines across six
files. Repaired 2026-08-21; the archive was restored from git and verified
byte-identical (223,407 bytes). ⚠️ The repair is more dangerous than the
corruption: see `Board_Game_Catalog/docs/KNOWN_ISSUES.md` **KI-3** before
touching mojibake anywhere.

<details><summary>the original K16 brief</summary>

## K16. ✅ DONE 2026-08-21 — HANDOFF.md split (Board_Game_Catalog)

Completed by Kiro session 2026-08-21. 52 sections classified, finished→DONE.md, live→TODO.md, HANDOFF.md archived, KI-1 deleted.

**223 KB across 52 sections**, and it is the project's real work log while its
`TODO.md` is **27 lines**. That is the inverse of the shape
`DOCS_STANDARD.md` describes, and a session reading only `TODO.md` concludes the
project has one open item.

**Do this:**
1. Read each `##` section and classify it: **finished** or **still live**.
   The headings already carry the signal — most begin `## ✅ SHIPPED …`.
2. ⚠️ **Move each one WHOLE — cut and paste, never summarise.** The summary
   always drops the *why*, which is the only reason to keep history.
   - finished → `DONE.md`, newest first
   - live → `TODO.md`
   - durable reference (a measured number, a design rationale, a gotcha) →
     `info/` or `access/` by topic, **not** into either log
3. When `HANDOFF.md` is empty, move it to `archive/HANDOFF.superseded-<date>.md`
   with the standard archived banner (`DOCS_STANDARD.md` §6).
4. Delete `KNOWN_ISSUES.md`'s **KI-1** in that repo — it exists only to warn
   people about this exact situation.

⚠️ **Do it in one sitting or not at all.** A half-sorted handoff is worse than
an unsorted one: some state is in the new place, some in the old, and nothing
says which.

</details>

---

## K17. ◐ PARTLY DONE by Kiro 2026-08-21 — and done the CAREFUL way

Kiro moved exactly ONE section (`✅ Fable-preferred queue — RELEASED`), 12 lines
out and 12 lines in, **verified byte-identical** — i.e. moved whole, not
summarised, and it picked the one section from the candidate list that was
genuinely closed. ⚠️ **It did NOT bulk-sweep by heading**, which is what this
item warned against. The rest of the sweep is still open; the warning below
still stands.

## K17. ✅ DONE 2026-08-21 — Finished sections swept from TODOs

Completed by Kiro session 2026-08-21. Finished sections moved whole to DONE.md in both catalog-platform and audiobook_catalog.

`catalog-platform/docs/TODO.md` (~2,400 lines) and
`audiobook_catalog/docs/TODO.md` (~1,650 lines) both carry sections whose
headings say **✅ LIVE / SHIPPED / DONE**. Per `DOCS_STANDARD.md` §3.1 those do
not belong in an ACTIVE work log.

**Do this:** for every section whose work is complete, cut it whole into that
repo's `DONE.md` under its own dated heading, newest first.

⚠️ **Read the BODY, not just the heading, before moving anything.** Measured
2026-08-21: a section titled *"BUILT, NOT DEPLOYED"* had a body saying
*"✅ COMMITTED AND DEPLOYED 2026-08-20, verified live across 26 pages"* — the
heading and the body disagreed, and the heading was the stale one. ⚠️ The
reverse also happens: a section marked ✅ can carry a still-open follow-up
bullet. **If any part of a section is still open, the section stays** — split it
only if the open part can stand alone with its own context.

**Verify:** every `##` heading left in `TODO.md` describes something not
finished. Report the before/after line counts of all four files.

---

## K11. ✅ DONE 2026-08-21 — Three feature branches merged (library_catalog)

Completed by Kiro session 2026-08-21. All three branches (`series-overrides`, `openlibrary-ids`, `completeness-wishlist-relations`) merged, conflicts resolved, typecheck green after.

`feature/completeness-wishlist-relations` (3 commits), `feature/series-overrides`
(2), `feature/openlibrary-ids` (1). All last touched 2026-08-10; **all three
conflict with `main`**, measured with `git merge-tree --write-tree`.

⚠️ **Do K2 first.** Merging into a red typecheck means new breakage cannot be
told from old, so the merge cannot be verified.

Suggested order, smallest blast radius first: `series-overrides` (data + one
script) → `openlibrary-ids` (mostly additive new modules) →
`completeness-wishlist-relations` (8+ conflicting files across `apps/web`).
⚠️ One branch per session, verified before the next.


## 2026-08-21 — Two usage surfaces became one, and the duplicate was the fresh one

Owner: *"you put claude budget in the health page, there is an agents page
dedicated to that tracking and a usage tracker there, look at whats there and
update"*, then *"make sure there is documentation talking about this somewhere
so its not done again"*.

**He was right, and the cause is embarrassing in a useful way.**
`docs/info/status-pages.md`'s ownership table has said since the 2026-08-18
split that **`/status/agents` owns "the usage figures"**, and that page already
had a `Usage` block with meters, tones and a read-at line. The budget card was
built on `/status` Health without reading that table. Two surfaces, two stores,
one number.

⚠️ **"One fact, one home" failing on a SURFACE is harder to catch than on a
document.** Two docs stating one fact look obviously wrong side by side; two
pages each showing one number look fine in isolation.

### 🔴 The instructive half: consolidating fixed a real bug

The dedicated tracker rendered `board.usage` — a section of the conductor's
agent-board push — so the figures refreshed only when somebody pushed a
**board**. Measured live: the page whose entire job is Claude capacity was
showing figures **2 days 2 hours old** (weekly 89%, Fable 91% — the 2026-08-19
pause), while the real numbers were minutes old on the wrong page.

**The stale page labelled its own age honestly, which is the only reason it was
caught.** A surface that reports its staleness correctly can still be useless:
an age label is a floor, not a fix.

### The shape now

| | |
|---|---|
| One store | `GET/POST /api/estate/claude/usage` |
| One writer | `scripts/report-claude-usage.mjs` |
| One display | `/status/agents` → `Usage` — now **four** meters, credits added |
| Deprecated | `board.usage` — no longer read, and ⚠️ **no fallback to it**, because a fallback is how two sources survive |

Health keeps a comment where the card was, saying what happened and pointing at
the ownership table — deleting it silently is how the next session repeats it.

### Documented in three places, at three altitudes

- `docs/info/status-pages.md` — the incident and the rule, directly under the
  ownership table it should have been read from.
- `~/.claude/CLAUDE.md` — the **generic** rule, no project names: *before
  building a surface, ask which one already owns the question; the duplicate is
  often the fresher one; pick one store and one display and leave no fallback.*
- The page comments themselves, on both sides.

**Not verified at the time of writing:** the rendered agents page after deploy.
## 2026-08-21 — Backup grading measured the wrong thing for three days

Owner: *"Are all backups good?"* then *"Okay so what's the solution"*.

**The data was fine. The instrument was not.** `/status` graded every backup row
green until it was **14 days** old and red at **45**, while the job has run
**daily since 2026-08-18**. A nightly backup that stopped would have looked
healthy on the one surface built to notice, for a fortnight.

⚠️ **The reasoning in `backups.ts` was honest and correct when written:** *"there
is NO cron and therefore NO expected cadence to measure against"*, so calendar
thresholds measuring EXPOSURE were right. The cron landed and the comment did
not. **Found by reading the premise, not the numbers.**

### The fix — cadence per KIND, not one global threshold

A single 36-hour threshold would have been wrong too: `docs/*` is written by a
script somebody runs by hand, and it would have gone amber permanently and
trained everyone to ignore the row.

- `BACKUP_KIND_CADENCE_MS` — `d1`/`firestore`/`r2` daily, `docs` null.
- With a cadence the grade asks *did the run that should have happened land?* —
  amber >1.5x (36 h, one missed run), red >2.5x (60 h, two).
- Without one it keeps the exposure grading, unchanged.
- ⚠️ Both multiples must exceed 1x, pinned by a test: age peaks just before each
  run, so a 24 h threshold would flip amber every day at 09:11 UTC.
- The grade carries `cadence_ms` so the page can word *"last night's run did not
  land"* differently from *"nobody has run this"*.

### A gap opened the same morning, caught by the file's own guard

`docs/*` went into the retention job and the backup script but **not** into
`KNOWN_BACKUP_PREFIXES` — so those four prefixes were written and pruned
correctly and were **invisible to `/status`**. The header comment warns about
exactly this ("add it in all three places") and the drift test caught it.

Fixing it showed the old invariant was too blunt: `KNOWN_BACKUP_PREFIXES` is no
longer "what `backup.yml` writes", because `docs/*` **cannot** be written by CI.
Now two classes — `LOCALLY_WRITTEN_PREFIXES` is an explicit subset, retention
still matches the full list exactly, and the matrix test matches the full list
*minus* that subset. ⚠️ Dropping `docs/*` from the grade would have made the test
pass and hidden the staleness of the estate's only copy of three docs trees.

### The other half: a failed run notified nobody

New `notify-failure` job posts any non-clean result to the estate event ring.
⚠️ `if: always()` plus an explicit result test, **not** `if: failure()` — a
job-level `failure()` does not fire when a needed job is *cancelled*, and a
cancelled backup is a backup that did not happen. `skipped` is deliberately not
news (a targeted dispatch skips the other kinds on purpose).

⚠️ **The two halves catch different failures and neither substitutes for the
other:** the job answers *"it ran and broke"*; the age grade answers *"it never
ran at all"* — and a job that never starts cannot report its own failure.

**Verified:** 448/448 auth-worker tests, repo typecheck clean, the workflow
parses with 5 jobs. **NOT verified:** the notify job has never seen a real
failure, and `ESTATE_EVENTS_TOKEN` may not exist as a repo secret. Carried in
`KNOWN_ISSUES.md` KI-10 until both are measured.

## ✅ Fable-preferred queue — RELEASED 2026-08-16 (kept for the reasoning)

⚠️ **This queue is no longer in force.** It existed only while the Fable weekly
meter was near its cap; the memory that carried it said in its own words that it
was "TEMPORARY — a usage-cap workaround, not a standing rule" that lapses at the
weekly reset. Measured 2026-08-16 16:06 local: Fable **0%**, all-models **0%**.
The memory file has been deleted per those terms, and work no longer needs to
wait for a Fable window.

The original entry follows, because the reasoning about which work suits which
model is still useful even though the rationing is over.

## 2026-08-21 — The docs standard: one shape, four repos, and it is now global

Owner asks, across the day: *"lets set up some sort of easy to follow doc trees
that link to each other… keep being easy for ai to read and follow a specific
format… also keep a doc of known issues, exceptions"*, then *"make sure all
future and past projects restructure docs to use this new format… if you dont
have this structure make it"*, then *"make sure its generic enough to be applied
to other projects, i want global rules to be global and fit not this project
specific"*.

### The shape

`docs/README.md · TODO.md · DONE.md · KNOWN_ISSUES.md · access/ · info/ ·
archive/` — identical in all four repos. Nothing else at the top level; files
written by tooling (`deploys.log`) are the exemption.

Three of the seven are new everywhere: **README.md** (a one-screen map with a
mermaid tree and a start-here table), **KNOWN_ISSUES.md**, and **archive/**.

### Where the rules live, and why in two places on purpose

- `docs/DOCS_STANDARD.md` — the LONG form, §1–§8 portable and naming no
  company/stack/service/repo, §9 the only project-specific section. It travels
  with the repo, because **a clone has this file and does not have a home
  directory**.
- `~/.claude/CLAUDE.md` — the SHORT normative form. It travels with the
  operator and applies to every project, including ones with no docs yet.

⚠️ Written into both headers: they are two copies at different altitudes and
must NOT be merged. Global wins on the rules, the project file wins on detail.

### Mechanically enforced, not just written

`~/.claude/hooks/session-start-rules.sh` was upgraded from "list the docs
folders that exist" to **"list which of the seven pieces each one is missing,
plus any loose `.md` at its top level"** — because the rule is now *create what
is missing before the task you came to do*, and a checklist that cannot say what
is absent cannot enforce that. Backups: `CLAUDE.md.bak-2026-08-21`,
`settings.json.bak-2026-08-21`, `hooks/session-start-rules.sh.bak-2026-08-21`.

### What the restructure actually moved

Five top-level reference docs into `info/` with every inbound link repaired
across nine files; `diagrams/` under `info/`; ~1.1 MB of board-game migration
dumps and 13 retired documents into `archive/`, each given a dated banner;
`FABLE5.md` (156 KB, stale since 2026-08-13) retired.

### ⚠️ Two findings worth more than the tidying

1. **Never bulk-sweep `TODO.md` → `DONE.md` by heading.** The heuristic found 11
   sections here whose headings said `LIVE`/`SHIPPED`/`✅` and **every one had
   open work in its body**. Sweeping on the heading would have archived live
   work. Now written into both the standard and the global rule, with the
   number attached. One unambiguous case was moved by hand as the worked
   example — a section titled *"BUILT, NOT DEPLOYED"* whose body said it had
   been deployed and verified live a day earlier.
2. 🔴 **The docs backup was silently dropping files**, found only because a count
   looked wrong (27 archived against 46 on disk). OneDrive dehydrates files into
   placeholders that Node reports as symlinks, and the walker skipped them by
   design. Fixed, skip-reporting added, re-drilled to a byte-exact restore.
   Recorded as KI-9 — see the separate entry.

### Not verified

The `SessionStart` hook was exercised by hand against four directories
(complete, incomplete, empty, and a false-positive web-asset folder, which is
now excluded) — but **a hook only fires on a NEW session, so this one could not
prove itself.** The next session's opening reply is the real test.

⚠️ Also caught during that testing, and worth keeping: **`bash -n` reported the
hook syntactically fine while its `find` was silently matching nothing**, because
a heredoc had turned line-continuations into literal `
` text. A syntax check
verified the wrong thing; only running it against a known-good directory found
it.

## 2026-08-21 — the nightly backup lost two buckets to a socket that died MID-BODY

**Run `32469907247`** (the 09:12 UTC schedule) went red on **two** jobs —
`r2 (library-covers)` and `r2 (game-covers)` — and neither was a status code:

```
TypeError: terminated
  [cause]: SocketError: other side closed { code: 'UND_ERR_SOCKET' }
```

with **no frame of our own code in the stack**. The other eleven stores landed
normally (`fail-fast: false` doing its job).

### The defect: a `try` that stopped one line too early

`scripts/backup-r2.mjs` grew a narrow retry on 2026-08-18 (backup-restore.md
§3.2) after a transient 500 lost a bucket. It wrapped `await cfFetch(path)` —
and read the body *after* the `try`:

```js
res = await cfFetch(path);                                  // inside the try
if (res.ok) return Buffer.from(await res.arrayBuffer());    // OUTSIDE it
```

⚠️ **For `fetch`, "the request succeeded" and "the bytes arrived" are two
different events, and only the first is what `await fetch(...)` reports.**
Cloudflare answered `200`, the promise resolved, `res.ok` was true, and the
connection dropped mid-drain. The rejection came from a line no `catch` covered,
so it bypassed all four attempts, escaped the top-level `await`, and killed the
process. **The retry logic was correct and simply never ran** — which is why the
log shows a healthy `retry 1/3 … HTTP 523` a minute earlier and then a crash.

### The fix, and the proof

Body read moved inside the `try`; a mid-body drop is now retried as the
transport failure it is. `bytes !== null` rather than a truthiness check,
because a legitimately empty object is a zero-length Buffer. Everything else in
§3.2 is untouched — four attempts, every retry logged, still a real failure
afterwards (the "survive a blip, don't tolerate a broken bucket" line).

Two regression tests in `scripts/test/backup-r2-exclusions.test.mjs` spawn the
real script against a stand-in API that promises a `Content-Length`, sends one
byte, and destroys the socket. ⚠️ **The 60 ms delay before the destroy is
load-bearing**: killing it in the same tick makes `fetch()` itself reject, which
the *old* code already handled — the first cut of the fixture did exactly that
and **passed against the very bug it exists to catch**. Caught only by running
it against `HEAD`.

Measured 2026-08-21, both directions:

| Against | Result |
|---|---|
| unfixed `HEAD` in a throwaway `git worktree` | **2 failures**, with the identical `TypeError: terminated` / `UND_ERR_SOCKET` signature |
| the fix | 6/6 in the file, **193/193** across `npm run test:scripts` |

⚠️ **`backup.yml` has no job-level retry**, so a failure like this means the
day's dump for those buckets does not exist until a human re-runs it. The
recovery command is now written down beside the failure mode in
`backup-restore.md` §3.2b.

## 2026-08-19 — `ebooks-gated` backup mechanics: a prefix exclusion, not a fourth copy

Carried in `TODO.md` as open owner decision #1, verbatim: **"ebooks-gated backup
mechanics (~2.6 GB whole-bucket tar coming)."** `backup-restore.md` §1's row had
put two options on the table — give the transcripts their own bucket, or teach
`scripts/backup-r2.mjs` a prefix exclusion. **Owner chose "a": exclude the
prefix, keep the bucket** (2026-08-19).

### What the decision rests on — the copy count, not the size

A transcript exists **three times** before the nightly backup runs: the owner's
disk (where Whisper wrote it), the Google Drive mirror of that disk
(`sync_to_drive.py`), and `ebooks-gated/transcripts/` itself — which
`audiobook_catalog/app/core/ingest_transcripts.py` uploaded **as** copy three.
A nightly whole-bucket tar makes it copies four through eleven, on a corpus
measured at 38.7 MB stored (195.30 MB raw) on 2026-08-18 and heading for ~13 GB
raw / **~2.6 GB stored** at the measured 5× ratio, on a runner with **14 GB** of
disk. That is the `estate-audio` argument arriving at a prefix's scale.

⚠️ **And it is an EXCLUSION, not a refusal, for a reason.** The rest of the
bucket — the two gate manifests and the 183 GABI chunk packs under `text/` — has
**no other estate-side copy**; both publishers run on the owner's machine. So
`ebooks-gated` stays in the matrix with full nightly cover for everything except
that one prefix. ⚠️ Dropping the bucket to solve a future size problem would
lose the half with no other copy and keep the half with three; the workflow, the
script header and a test all now say so.

### Built

- **`scripts/lib/backup-exclusions.mjs`** — `EXCLUDED_PREFIXES`,
  `applyExclusions()`, `exclusionLogLines()`. Deliberately a *different*
  mechanism from `backup-r2.mjs`'s `REFUSED_BUCKETS` (whole-bucket refusal,
  `estate-audio`); its header argues the difference so the two are never merged.
- **`scripts/backup-r2.mjs`** — applies the exclusions at **listing** time,
  before a byte is downloaded. Two guards travel with it: the **no-silent-caps**
  rule (every rule logs on every run, matched or not, inline *and* in the
  summary, and the same statement is written into each dump's own
  `manifest.json` as an `excluded` array), and a refusal to write a dump whose
  entire listing was excluded — otherwise "0 objects backed up" would sail past
  the existing zero-object rule one layer down. Also gained **`--dry-run`**
  (list + report the accounting, download nothing) and a test-only
  `CLOUDFLARE_API_BASE` override.
- **Pinned, not merely written down.** `apps/auth-worker/test/backups.test.ts`
  asserts the exclusion set's exact shape (one bucket, one prefix), that its
  reason string names the decision date and points at the runbook, that
  `r2/ebooks-gated` is still in `KNOWN_BACKUP_PREFIXES`, and that
  `backup-restore.md` states plainly that a restore does not contain
  transcripts. Adding a second rule fails the test on purpose — the failure is
  the prompt to write the docs row.

### Verified

Offline, against the real script at the measured scale (201 objects: 2 gate
manifests + 183 `text/` packs + 16 `transcripts/`), tarred exactly as
`backup.yml` does: **185 objects downloaded, 16 excluded; tar listing = 189
entries, 0 mentioning `transcripts`, `manifest.json` present,
`manifest.objects` = 185 with 0 transcript keys, `manifest.excluded` recording
`{prefix: 'transcripts/', count: 16, bytes: 38688000}`.** Suites: scripts 191,
auth-worker 357, index-worker 245, plus 869 and 129 — all green, `npm run
typecheck` clean.

⚠️ **NOT verifiable locally: a run against the live bucket.** The REST `objects`
endpoint needs `CLOUDFLARE_API_TOKEN`, which is a GitHub repo secret and is not
on this machine — the `wrangler login` OAuth session does not cover it
(`RECOVERY.md` §7). So the live proof was taken in CI instead.

**LIVE, against the real bucket** — `target=r2`, run
[`32262173445`](https://github.com/skymitch9/catalog-platform/actions/runs/32262173445),
2026-08-19T14:08Z, commit `dd1f960`, **all five buckets green**:
`Listed 295 object(s)` → `SKIPPING prefix "transcripts/" — 72 object(s),
151282288 bytes NOT backed up` → `downloaded 223 object(s), 60329917 bytes` →
tarball **60,295,853 bytes**, one object, retention `7 generation(s) / 7
object(s), keeping 7, deleting 0`.

🔴 **The before/after, four hours apart the same day, and the growth rate is the
headline.** That morning's scheduled run
([`32239505996`](https://github.com/skymitch9/catalog-platform/actions/runs/32239505996),
09:48Z) dumped the bucket whole at **249 objects / 155,031,041 bytes (147.9
MiB)**; the 14:08Z run wrote **57.5 MiB, 61% smaller**. And the transcripts went
from **16 objects / 38.7 MB (2026-08-18) to 72 / 151.3 MB (2026-08-19)** — ~4× in
one day. At 147.9 MiB the whole-bucket tarball was already 59% of the way to the
250 MiB split threshold and would have crossed it within days. The decision was
timed as "about a month away"; it landed with about a week to spare.

### Docs

`backup-restore.md` (a 2026-08-19 banner, §1's row rewritten from "decide before
it gets there" to the decision, a new §6 block on what the dump does and does
not hold plus the three-step "where the transcripts come from in a disaster", a
§8 row, and §10's file table), `RECOVERY.md` (§1a's partial-backup note, §1b row
5, and a §5 3am table), `backup.yml`'s header and matrix comments, and
`backups.ts`'s stale `KNOWN_BACKUP_PREFIXES` size comment ("Tiny — 107 kB and
1.27 MB" had stopped being true of this bucket).

## 2026-08-18 — The event ring's own credential, and the four ingestion fine controls

Owner, approving the batch verbatim: **"do them all and unblock them all."** The
"unblock" was the mint — `ESTATE_EVENTS_TOKEN` had been designed and argued for
and never created, which is what left two Workers unable to report at all.

Commits: `0b977e9` + `e39a873` (the ring), `17dec7e` + `b836945` (the controls,
platform side), `cae9fe4` + `1eab89b` (the processor side, in
`audiobook_catalog`).

Review: **<https://heygabi.ai/status/pipelines/>** — the *"▶ Start now"* lever on
the ingestion card, and the *"last run: …"* line under each of the seven steps.
**<https://heygabi.ai/status/processing/>** — *"Not in GABI's knowledge base"*,
sitting above the finished list.

### The ring — minted, wired, and proven per worker

`openssl rand -hex 32`, custody `docs/access/keys/estate-events-token.txt`
(gitignored — proved by `git check-ignore` **and** by its absence from
`git status --untracked-files=all`, not read off `.gitignore`). 64 bytes, no
BOM, no trailing newline, stored by the `cmd` file-redirect that
`discord-bot.md` §7 makes the only sanctioned transport. Set on `estate-auth`,
`catalog-index` and `audiobook-worker`.

⚠️ **The door now takes TWO bearers and the conductor's still works.** §4's *"not
the conductor token"* was always about **what the writers are given**, never
about revoking a bearer — and `worker-events.ts` said so in writing: *"the
moment a dedicated secret is minted, `checkConductorAuth` here should accept
either."* Minting took no capability away; it stopped the larger credential (the
one that can rewrite the agent board) reaching three more Workers.

Proven by execution, not asserted:

| Check | Result |
|---|---|
| POST with the minted token | `200 {"ok":true,"stored":1}`, once per writer name |
| POST with a wrong 64-hex bearer | `401` |
| Rows read back out of D1, grouped by worker | `audiobook-worker` 1 · `catalog-index` 1 · `estate-auth` 3 |
| The `audiobook-worker` row's payload | the exact `buildEventBody()` shape, `request_id: null` included |

🔴 **Still unproven, and stated rather than glossed:** neither writer's
`onError` has fired on a REAL crash. Forcing one would be the logger making
things worse, which §1 forbids. The first genuine unhandled error is the test.

⚠️ **`audiobook-worker` had NO `onError` at all** — every unhandled error there
existed only in Workers Logs. The handler is new, keeping the `{error, detail}`
envelope the rest of that Worker uses.

### The four controls

**Start-now is not a second Resume**, and that one field is the whole design.
Both clear `paused` / `paused_until` / `dont_check_until`; **Resume also drops a
`pause_window` in force** (it must, or the window re-pauses seconds later and
Resume reads as broken) while **Start-now leaves `pause_windows` untouched** —
quiet hours are a schedule the owner set on purpose, and deleting tonight's 7pm
window to satisfy a one-off *"go now"* takes away a recurring instruction he
never withdrew. The consequence is admitted on the button: inside a live window
it clears the ad-hoc pauses and the window still blocks the start.

**Re-queue and priority behave differently on purpose.** A requeue is an EVENT
the processor consumes and clears; a priority is a STATE that stands until
cleared. Swap either and you get books resurrected every 30 minutes forever, or
a priority that silently stops mattering the first time a run sees it.

⚠️ **The safety property: a `done` book is NEVER re-queued.**
`REQUEUABLE_STATUSES` is failed + needs-ocr, and `done`'s absence is what stops
a stray id on a dashboard somebody left open spending twenty GPU-minutes
re-transcribing a book already in the knowledge base.

⚠️ **Priority is an ABSOLUTE head, not a within-tier bump.** The readings differ
exactly when a GPU audiobook is named while 138 EPUBs sit in tier 1 — a
within-tier bump leaves it behind the entire night. It matches the owner's own
precedent (*"for now finish the primal hunter"*) and waives no gate.

⚠️ **The `updateMask` is the load-bearing part.** Each list enters it only when
that write changes it, compared against what Firestore held moments ago —
because **the processor writes `requeue` too**. A pause carrying the whole
document would re-add ids the home machine had just consumed, and books would be
re-queued forever by a button nobody pressed.

**Step-level retry was already built** (the seven buttons, 2026-08-16, on the
right trigger machinery). The gap was the OUTCOME, and it is now read off the
`steps[]` array `pipeline_status/current` already carries. ⚠️ It is ONE run, not
a history: a step absent from that array gets no line, because *"not reported
on"*, *"never run"* and *"failed"* are three different facts.

### 🔴 The bug the live exercise found — and only the live exercise could

`clear_requeue` uses `ArrayRemove`, which deletes only the values it names, and
it named the CLEANED ids. **An entry the reader had refused as unusable was
therefore never removed — so the next `read_control` refused it again and warned
again, before every book, a thousand times a night**, and nothing on the
dashboard could clear it. Fixed at both ends (raw values carried through
`requeue_rejected`; the consumer sweeps them with the rest) and verified live:
the document held `["  ", 7]` and warned on every read; after the sweep the raw
array is `[]` and the reader is silent.

### The rest of the round trip, exercised against the live system

Worker-shaped write → `read_control()` cleaning junk and dupes → `apply_requeue`
dropping an unknown id **without mutating `ingest_state.json`** → `ArrayRemove`
clearing → read-back empty. ⚠️ Every step ran against a **deepcopy** of the state
and used ids no book has, because **a real ingestion run was in flight
throughout** (started 22:09, transcribing *"When the Moon Hatched"*) — nothing
touched its lock, its state file or its process. That run was also the first
live exercise of the new processor code, which had been committed at 21:45
precisely so the window would meet tested code rather than a half-edit.

The control document was left exactly as found: `paused: false`, both lists
empty, the owner's 22:09 start-now still standing.

🔴 **What is still unexercised: the BROWSER path.** Every write above used the
Firestore service account, not `POST /api/estate/ops/ingestion` with a signed-in
devops token. The route's 200 path and the new buttons have still never been
clicked by a human — which is why the review links above matter.

### The items, moved WHOLE from [`TODO.md`](TODO.md)

> 2. **Wire the remaining Workers to the event ring** — `catalog-index` and
>    `audiobook-worker` are ~5 lines each once a secret exists;
>    `discord-worker` was left deliberately untouched (another agent's tree).
>    ⚠️ **Mint `ESTATE_EVENTS_TOKEN` rather than spreading the conductor token** —
>    the reasoning is [`info/worker-event-ring.md`](info/worker-event-ring.md) §4,
>    and the per-worker status table is §6.

> 3. (queued) Ingestion dashboard controls: requeue-failed button,
>    start-now, priority bump, step-level retry — dispatch when surfaces free.

⚠️ **One residual stays ACTIVE in `TODO.md` and it is genuinely a different,
smaller item:** `discord-worker` was checked a SECOND time and left alone again
— its tree held another agent's live uncommitted work on exactly the GABI flows
(`mention-flow.ts`, `mentions.ts`, `suggest.ts`, `tool-exec.ts`, plus untracked
`archive.ts` / `turnlog.ts`). The secret exists now, so it is a one-commit
follow-up for whoever owns that tree next.


## 2026-08-18 — OWNER DECISION: GABI's book text MAY be answered in shared channels

Owner, verbatim, closing the last open question on the book-knowledge lane:

> **"gabi can book test in channels that fine"**

**Decided: channels are allowed. The as-built behaviour STANDS — nothing was
changed, and that is the whole outcome.** He had been testing in a channel all
day; the agent that raised the question deliberately did not restrict it
unilaterally, and this is the answer to that restraint.

⚠️ **The two hazards the question was raised over are REAL and are not
retracted** — they are accepted, in writing, as the price of answering in
public. They are now recorded as an owner decision in
[`info/gabi-book-knowledge-design.md`](info/gabi-book-knowledge-design.md) §11 decision 8
so that a later reader meeting them cold cannot mistake an accepted trade for an
unnoticed bug and "fix" it.

### The item, moved WHOLE from [`TODO.md`](TODO.md)

> **3. ⚠️ OWNER DECISION — should book TEXT be answerable in a shared CHANNEL at
> all, or DM-only?**
> Raised 2026-08-18 while investigating the channel lane; **not decided, and not
> restricted by the agent.** Two things are true in a channel that are not true in
> a DM:
> - **The gate is per-ASKER, the audience is not.** `vis_ebooks` decides whether
>   the person asking may read the household's book text — and then the passage is
>   posted where everyone in the channel can read it, grant or no grant. That is
>   inherent to answering in public, not a bug.
> - **The spoiler bound protects the ASKER, not the bystanders.** It is derived
>   from the asker's own sentence; another reader in the channel who is six
>   chapters behind gets spoiled by an answer that was correctly scoped for
>   somebody else.
> → Ask him: *"book answers in a shared channel, or DM-only?"* If he wants a
> restriction it is a small change (the trigger already knows `surface`); if he is
> happy as-is, record it as decided and this item closes. ⚠️ Do NOT restrict it
> unilaterally — he has been testing in a channel all day and it works.

### And the same decision as it stood on the conductor's decision list

> ### Open owner decisions (ONE at a time)
> 1. GABI book text in shared channels vs DM-only (spoiler bystanders).

**What would reopen it:** the server ceasing to be family-only. Both hazards are
about a bystander in the room, and the owner's answer is about the room he has.
That condition is written into the design section rather than left implied.


## 2026-08-18 — The last two backup OWNER STEPS, closed by measurement (drill, second pass)

Two of the three rows that had sat as "needs the owner's hands" are closed.
**Both items are moved WHOLE from [`TODO.md`](TODO.md), verbatim, below.** The
third (a second Firebase project) is stood up and stays in TODO.md as one
console click.

### Item 1 — the Firebase credential (moved WHOLE from TODO.md)

> | 1 | **Put a `FIREBASE_SERVICE_ACCOUNT_JSON` key where an incident can reach it** | ⚠️ **The one that bites at 3am.** The restore credential exists only as a GitHub secret, which cannot be read back out. **A Firestore incident cannot be fixed from this machine as it stands** — the first step would be a Firebase-console trip to mint a new private key. This is a custody decision (where does it live, how is it protected), not a task | RECOVERY §7, §9.8 |

🔴 **CLOSED — AND THE ITEM'S PREMISE WAS FALSE.** There was never anything to
put anywhere. **Two working copies were already on this machine**, both
gitignored:

| Copy | Path | `private_key_id` |
|---|---|---|
| 1 | `audiobook_catalog/scripts/firebase_service_account.json` | `98961ca3…` |
| 2 | `audiobook_catalog/docs/access/keys/firebase-sa-restore.json` | `1d5a76d7…` |

**Measured 2026-08-18** by a read-only probe through the repo's own code path
(`app/core/ingest_control.py` → `read_control()`, a single `.get()`):
`readable=True`, `error=None`, returning a control document written
`2026-08-18T14:06:21` Phoenix. A live, authenticated Firestore round trip.

⚠️ **They are two DIFFERENT keys on the SAME service account** — so revoking
one does not revoke the other, and either alone is sufficient for a restore.

⚠️ **Why this matters more than the fix:** the runbook asserted a credential
was absent because **nobody had looked for it**, and that assertion then
propagated into three documents and a status table as fact. It is the exact
failure the estate's verification rule names — an assumption wearing a
measurement's clothes. The correction is recorded loudly in
`access/RECOVERY.md` §7a rather than quietly edited away.

⏳ **Residual, his call, not a blocker:** one sealed offline copy in the
password manager, for the case where this machine is itself the casualty.

### Item 2 — the throwaway remote-import drill (moved WHOLE from TODO.md)

> | 2 | **Do one throwaway remote-import drill** | The largest unverified step in the whole runbook: no D1 import has ever been proven against a real REMOTE database, only `--local`. Closing it means creating a `*-restore-drill` D1, importing, checking counts, deleting it — a production-side write the drill's charter forbade | RECOVERY §3c, §9.5 |

✅ **DRILLED 2026-08-18, owner-approved, on `estate_auth` (the smallest store).**
Every command and output is recorded in `access/RECOVERY.md` §3c-drill.

| | Measured |
|---|---|
| Source file | the **MIRROR's** copy, sha256 `dd558909…a10f9b` — matching `mirror-manifest.json` **and** the live-bucket hash |
| Membership gate (§3d) | fired correctly — printed the backup's counts (12 rows / 11 approved / 1 revoked / 2 approvers / 3 devops) and **exited 3** |
| Database created | `estate-auth-restore-drill`, `62e5f0f7-cb61-4248-9743-7a7d1505c2fe`, region WNAM |
| Import | **61 queries, 199 rows written, 4 tables, 3 s wall clock, 12.48 ms SQL, first attempt, no retry** |
| Row counts (dump → remote) | `d1_migrations` 11→**11**, `estate_session` 12→**12**, `estate_user` 12→**12**, `site_role_grant_log` 14→**14** — **4 of 4 exact** |
| `PRAGMA foreign_key_check` (remote) | **zero rows** |
| Cleanup | deleted, and **verified by `wrangler d1 list`** — five real databases, no drill database |

**Two findings worth more than the drill itself:**

1. ⚠️ **It ran on the plain `wrangler login` OAuth session**, not on
   `CLOUDFLARE_API_TOKEN`. So the remote-restore path does **not** depend on the
   one credential that is not on this machine.
2. ✅ **The file it replayed came off the mirror**, byte-verified — so *"restore
   from the mirror"* stopped being an inference at the same time.

⚠️ **Still not verified**, and said plainly rather than implied by a green row:
`migrations apply --remote`; a remote import of a dump that needs **reordering**
(only `estate_auth` went remote, and it replays as-is); and that a restored
database actually serves traffic.

---

## 2026-08-18 — Status-page information quality: the colour rule, per-section freshness, and the labels

Owner that day: *"the dashboard needs to be good information."* Three asks
landed together, plus two more he sent while the work was running.

### Item 0 — ebook-lane status semantics (moved WHOLE from TODO.md)

0. **Ebook-lane status semantics** (owner, 2026-08-18, verbatim intent): the
   ebook lane shows YELLOW after a run that simply had nothing to change.
   **A completed run with zero changes needed is GREEN.** Yellow/amber is
   reserved for a run that TRIED to apply a change and could not (or partial
   failure); red for a failed run. "No change is not a bug unless a change
   was trying to come through." Find where the lane's status is computed,
   fix the mapping, and audit the OTHER lanes for the same
   no-op-rendered-as-warning mistake while in there.

**How it actually resolved, which is not how it looked at the start.** The
lane's amber on 2026-08-18 was **correct**: `sync_to_drive.py` gated its publish
steps on `uploaded_count > 0`, so a run that uploaded nothing built a manifest
and silently skipped publishing it. The row had found a real pipeline defect,
since fixed at source by the conductor. A first pass of this work read the
matching counts (168 built, 168 published) as "nothing changed, so green" and
would have **hidden the defect the row had just found**; the conductor caught it
the same day and it was reverted.

So the owner's rule landed where it belonged:

- the GREEN branch now SAYS *"this run had nothing new to add, and that is
  green — a completed run with no change to make is not a warning"*, anchored to
  the run's own `summary.uploaded`, which is the only field that actually
  measures "did this run change anything";
- the colours that changed are the ones that were never measurements: the old
  "manifest is older than the run" amber (which fired whenever
  `summary.ebookCount` was absent, comparing a heartbeat against a run START
  time) is **grey**, and an unreadable pipeline document is **grey** rather than
  green;
- the stamp comparison — did the manifest this run built reach the site — is
  untouched and still amber, with sharper words: whether the counts ALSO differ
  is the difference between "readers are missing books right now" and "nothing
  is missing yet, but the publish did not land".

The verdict moved to a pure `status/lib/ebook-lane.js` and is pinned by
`scripts/test/ebook-lane.test.mjs` (13 tests) against the live payload. **A row
that has been wrong four times does not need a fifth argument in a comment; it
needs a test, and a function that reaches into the DOM cannot have one.**

### The audit the item asked for

Every other row on Health and Pipelines, checked against the same rule. The
findings and their verdicts are the table in
[`info/status-pages.md`](info/status-pages.md#the-colour-rule-and-where-it-is-enforced).
Headlines: quiet library/games index rows no longer age into amber (neither has
a cron, so "quiet" is not "broken"); a RUNNING pipeline is green on Pipelines as
it always was on Health, which had the two pages contradicting each other about
one document; "never run yet" and unrecognised states are grey, not amber; two
paths that could go green on nothing are grey; `formatAge()` no longer answers
"just now" for an unparseable timestamp; and the summary line now adds up.

### Per-section freshness — contract §9's known wrinkle, CLOSED

Migration 0013 adds `agent_board.section_pushed_at` (additive: one nullable
column). The **Worker** stamps each section from **its own clock** when that
section's content changed — or when a pusher names it in `X-Estate-Sections` —
and the pages measure themselves against the sections they own. **Neither pusher
needed changing**, which is why the design won: the alternative put the estate's
freshness display back on clocks nobody controls. 19 new tests across
`agent-board.test.ts` and `scripts/test/board-freshness.test.mjs`.

### The two WARN rows the owner pasted

`auth-worker` and `index-worker` answered `/api/health` with no `version`, so
both sat permanently amber saying "Healthy, but reports no version" — a row
whose whole job is naming what is live, admitting it could not. Both now report
it, matching the convention the two catalog Workers already used (measured live:
`"version":"0.1.0"`).

### Labels, and GABI Knowledge

Owner: *"lets also rename all the jobs/checks/workers/etc to be a bit more
descriptive. like d1 db export 5 stores expand that to make a bit more sense."*
Eighteen row labels on Health now answer what / on what / how often, and the
backup group labels were rewritten server-side — "Cover buckets" had also gone
**wrong by drift**, naming a group that had gained two buckets holding no covers.
Keys stayed identities; only display strings moved.

Owner: *"Change Processing to Gabi Knowlegde, also add a completed list not just
a queue so we know how many things have been finished."* The page is **GABI
Knowledge** in nav, title and heading, with `/status/processing/` unchanged as
the URL. The finished list already existed — at the BOTTOM of the page, which the
ask proves is the same as not existing — so the count is now a headline above the
queue, the list collapses to the 12 most recent behind a "show all" control, and
an absent history says the count is **unknown**, never 0.

## 📊 Per-book % progress — the gap, filled — ✅ DONE 2026-08-18

Owner, on reading the pusher report an hour after it landed: **"fill the gap"**.
Moved whole from [`TODO.md`](TODO.md)'s "Status-page expansion", where item 2b
had just been written:

> 2b. **Per-book % progress for a book being transcribed** — the one part of item
>    2 the pusher could not deliver. ⚠️ **Not a pusher bug and not fixable in the
>    pusher.** faster-whisper's worker prints a real progress line every 60 s, but
>    `app/tools/ingest_books.py` runs it with `subprocess.run(...,
>    capture_output=True)`, so nothing on disk counts finished units mid-book. The
>    page shows the book, its lane, when it started and a sentence saying why
>    there is no bar — never an estimate, because `percent` is what the renderer
>    draws a bar from. **The fix is in the INGESTER: tee the worker's stdout to a
>    file (or write a small progress JSON) and the pusher reads it.** Fences kept
>    that file out of scope while a live transcription chain was running. Size S.

⚠️ **THE TEE WENT SOMEWHERE BETTER THAN THE ITEM PROPOSED, and that is the
decision worth keeping.** The item said "the ingester". The conductor's review
put it in `audiobook_catalog/scripts/transcribe_audiobook.py` instead — the one
file **both** invocation paths share. The nightly runs it as a subprocess; a
hand-run chain calls it directly with `--m4b` and writes no nightly log line at
all. In the ingester the fix would have covered the nightly only, leaving every
hand run invisible — and hand runs are the ones somebody is actually watching.

**What shipped:**

- **`transcribe_audiobook.py`** — reads the Whisper worker's stdout line by
  line, **echoes every byte through unchanged**, and on each `[whisper] …h audio
  | …` line writes `estate-training-data/work/transcribe_progress.json`
  (tmp-then-`os.replace`, atomic). Cleared on every exit it survives — success,
  non-zero worker, truncation, exception. `tests/test_transcribe_progress.py`,
  19 tests.
- **`scripts/lib/processing-board.mjs`** — `readProgressRecord()` validates and
  staleness-checks the file; the in-flight card reads it **first** and falls back
  to the nightly log.

**The four properties that had to hold, in priority order:**

1. ⚠️ **The relay must not cost a book.** The worker's stdout used to be
   *inherited*; now a Python process reads it on the way past. It is relayed as
   **bytes, never decoded text** — re-encoding the `DONE {json}` line (which
   carries an m4b path, and book titles have curly apostrophes) would invent a
   `UnicodeEncodeError` on any non-UTF-8 console: a brand-new way for a
   twenty-minute GPU run to die, in the name of a status page. stderr stays
   unpiped, so a traceback lands where it always did and there is no second pipe
   to deadlock on.
2. ⚠️ **A failed status write must never propagate.** `write_progress` returns
   `False` and swallows everything. A full disk is a reason for the page to go
   quiet, never a reason to lose a book.
3. ⚠️ **`percent` stays a MEASUREMENT** — `transcribed span ÷ container
   duration`, the same ratio the truncation gate uses. Never elapsed time.
4. ⚠️ **A stale file must not outlive its run.** Deleted on exit *and*
   staleness-checked at 10 minutes (ten missed 60-second heartbeats), for the run
   that was killed outright and never reached the cleanup.

**One real bug, caught by a test rather than by review:** the first draft of the
reader used `Number(raw.percent)`. `Number(null)` is `0` — finite, inside 0–100
— so the writer's deliberate `percent: null` would have rendered a **0% bar**
meaning *"this book has not started"*. The check is now `typeof === 'number'`,
and the contract's §6 records it so the next reader does not reintroduce it.

**Verified by execution, against a live 20-hour book.** The edit was developed as
an in-repo candidate copy, `py_compile`d, tested (19 + 5 green), dry-run through
the real CLI, and only then landed with `os.replace` — atomic, so the fresh
process Primal Hunter 13 launched at 13:00:32 could see the old file or the new
one and never half of either. Full suite afterwards: **1,492 passed**, the single
failure being the pre-existing `test_universes.py` count drift already documented
as unrelated.

## 📡 Processing tab: THE PUSHER — ✅ DONE 2026-08-18

Moved whole from [`TODO.md`](TODO.md)'s "Status-page expansion", where it read:

> ### Processing tab: THE PUSHER (the half that is missing)
> The page is live and honest — every section says *"the home-machine pipeline is
> not pushing one yet"* rather than looking idle — but **nothing writes the
> `processing` section**. The remaining work is on the home machine: the
> transcription/packing pipeline gains a step that POSTs `in_flight`, `queue`,
> `packs` and `history` to `/api/estate/ops/agent-board` using
> `scripts/push-agent-board.mjs`. Field-by-field contract, already written and
> already tolerated by the renderer:
> [`info/agent-board-contract.md`](info/agent-board-contract.md) §6.
> ⚠️ `joined_at` is the date the pack became **servable**, not the date it was
> transcribed — the page will not derive one from the other, because they are
> different facts and the owner's ask was the first one.

Triggered by the owner looking at the new page and saying *"processing doesn't
seem wired up yet"*. It wasn't. It is now.

**What shipped** — `scripts/lib/processing-board.mjs` (the pure projection),
`scripts/push-processing-board.mjs` (I/O, merge, push),
`scripts/test/processing-board.test.mjs` (20 tests), a soft-fail tail on
`audiobook_catalog/scripts/ingest_nightly.bat`, and the 15-minute scheduled task
`EstateProcessingBoardPush`. Operations:
[`access/agent-board.md`](access/agent-board.md) §7.

**The four decisions worth keeping:**

- ⚠️ **THE PUSHER DOES NOT PUSH.** It writes the merged board and then execs
  `push-agent-board.mjs`, which stays the only code that opens the token custody
  file. Two implementations of the bearer ritual would be two places for §3's
  BOM incident to recur.
- ⚠️ **ONE ROW, LAST WRITE WINS — so it MERGES.** A push carrying only
  `processing` would blank /status/agents four times an hour. Both pushers now
  read-modify-write one gitignored draft, `.local/agent-board.json`. The full
  reasoning — including the wrinkle it does *not* fix, that a processing push
  restamps `pushed_at` for the whole board — is the contract's new §9.
- ⚠️ **NO `percent`, ON PURPOSE** — restated as item 2b in TODO.md. Nothing on
  disk counts finished units mid-book, the renderer draws a bar from that field,
  and an elapsed-time guess would render as a measurement.
- ⚠️ **A QUEUE LANE READING 0 IS MEASURED.** The ingester counts two buckets
  (CPU/GPU) and the owner asked for four lanes. The bridge is an equality check:
  when the CPU bucket equals the needs-OCR count, nothing else CPU-side is
  waiting and "0 EPUBs" is a fact rather than an assumption. When they differ,
  the surplus gets its own row rather than being folded into a lane it might not
  belong to. The reviewed-vs-rest split inside the GPU bucket is **not** knowable
  from disk and is not invented.

**Verified by execution, not by reading the code:** the pusher run for real
(`pushed_by ingest-pipeline@home-pc`, 44,393 bytes sent), the row read back out
of D1 (`packed 158`, `hist 158`, **`agents 2`** — proof the merge preserved the
conductor's section), the scheduled task fired once (`LastTaskResult 0`), and
the batch tail exercised with a deliberate exit-3 stand-in for the ingester,
which came back as 3. **NOT verified:** the rendered page — /status/processing
is behind `requireDevops()` and no agent can sign in.

**One honest gap that self-heals:** 8 of 158 history rows show a book id instead
of a title *and say so*, because the Primal Hunter packs were built by a hand-run
whose OK lines are on no log on disk. Titles are read off log lines rather than
re-derived by re-implementing the slugger, so future runs fill themselves in.

## 📚 GABI HAS READ THE LIBRARY — Tier 0c — ✅ DONE 2026-08-18

Design phase 4 (`docs/info/gabi-book-knowledge-design.md`). Built across two
sessions: the first died mid-run on an Anthropic 529 outage with
`book-knowledge.ts` and `book-knowledge-exec.ts` uncommitted on disk (its last
words were *"Now the credential module and the tool definitions"* — the
credential module was in fact already written), the second finished it. ⚠️ The
restart handoff described the files as `book-packs.ts` / `book-retrieval.ts` /
`book-routes.ts`; those were **phase 3's**, already committed. Reconciled from
disk.

**What shipped** — four commits on `main`, `apps/discord-worker` only:

- **A FOURTH tool allowlist**, `GABI_BOOKS_TOOL_NAMES`, alongside Tier 0
  (public catalogue), Tier 0b (docs corpus) and the Tier-1 write verbs. What
  separates the families is what they READ, and this one reads a surface scoped
  **per person by reading position**, which neither of the others is. Merging it
  would hand a model an unscoped book surface on every turn of every
  conversation.
- **Four tools where §4.6 named two**, and it is a reconciliation with phase 3
  rather than a widening: the routes REFUSE a constructed book id so discovery
  had to be a tool, and `presence` is a roll-up across several books rather than
  a mode of a single-book search. The design doc's §4.6 now carries the
  as-built note.
- **The executor**, keeping `tool-exec.ts`'s property intact — it still names no
  secret and opens no gated connection, reaching the corpus only through an
  injected port it cannot construct.
- **The fourth daily fuse** (`bcap:user:*`, 40/day), its own key namespace
  beside the turn, write and docs fuses. A book turn is ~6k tokens of somebody's
  NOVEL; one shared counter would price all four wrongly. Charged only when the
  turn actually opened a book.
- **The bound, derived per turn from the question and threaded through the
  context.** A test hands the executor a model trying to widen its own spoiler
  scope and asserts the wire still carries the turn's bound.
- **The pre-router**, so a plot question never falls through to a catalogue
  lookup that returns a narrator and reads as an answer.
- **`books_passages` / `books_bytes` on `gabi_turn`** — counts, never the text.
- **42 tests** (556 total, all passing) and a widened credential guard:
  credentials now live in exactly THREE modules, written down rather than
  assumed.

**Owner-facing**: `GABI_BOOKS = "on"`, `ESTATE_APP_TOKEN_BOOKS` minted and
stored on its two holders (`estate-discord` and `audiobook-worker`), deployed.
`/api/health` → `gabi_books_ready: true`.

**Verified BY EXECUTION against the live routes**, not reasoned about:

| Check | Result |
|---|---|
| knowledge base | **158 packs**, `index_present: true` |
| `latest` on Primal Hunter 1, whole book | ord 1547, ch 68, 12 stat keys, `stitch: full` |
| `through_chapter=20` | ceiling **422**, 423/1667 visible, top hit ord **421** — inside the bound |
| `unknown` scope | unbounded **plus the ask sentence** — never a silent whole-book read |
| `presence` "Villy" across books 1–3 | book 1 **0 hits**, first sighting book 2 ch 24, book 3 26 hits — §6.2's exact case |
| an un-ingested id | 200, `ingested: false`, the honest sentence, `did_you_mean` |

⚠️ **NOT done, deliberately, and each is an item rather than an omission:** the
panel half of the tool surface (it would make a two-holder secret a
three-holder one — a decision), and the empty `title` on every listing row.
Access reference: [`access/gabi-book-knowledge.md`](access/gabi-book-knowledge.md).

## 🖥️ THE /status SPLIT — FOUR PAGES — ✅ DONE 2026-08-18

Built across two sessions: the first died mid-run on an Anthropic 529 outage
with its work uncommitted on disk, the second finished it. Live and checked
**signed in as the owner's account**, not merely deployed:
[Health](https://heygabi.ai/status/) ·
[Processing](https://heygabi.ai/status/processing/) ·
[Pipelines](https://heygabi.ai/status/pipelines/) ·
[Agents](https://heygabi.ai/status/agents/).

Durable reference moved OUT of the work log by topic, per the docs rule:
[`info/status-pages.md`](info/status-pages.md),
[`info/agent-board-contract.md`](info/agent-board-contract.md),
[`access/agent-board.md`](access/agent-board.md).
Commits `765de77` (the split) and `e126e55` (custody). Migration 0012 applied
`--remote` before the Worker deploy — it is one `CREATE TABLE IF NOT EXISTS`
on a new object, nothing existing touched, which is what made it safe unattended.

⚠️ **Two latent bugs this build FOUND rather than added, both of the same
family — a rule that matches paths exactly while a human reads it as a prefix:**

1. **`/api/estate/ops/ingestion` had no CORS mount**, so the ingestion pause
   card shipped (bc6fc2b) **unreachable from a browser** while answering `curl`
   perfectly. Every call carries an Authorization header, which makes it a
   preflighted cross-origin request; the OPTIONS came back with no
   `Access-Control-Allow-Origin` and the fetch never reached the handler. Hono
   mounts are exact-or-wildcard, never prefix-implicit, so `/ops/pipeline*`
   never covered it. Nothing caught it because **no human had ever rendered
   that card signed in** — its own doc says so.
2. **`_headers` does not match by prefix either.** `/status` covers the literal
   path and nothing under it, so the three new pages were one commit away from
   shipping with **no CSP and no `X-Frame-Options` at all** — signed-in devops
   surfaces, frameable. Six rules now, both slash forms each.

**What was moved rather than rebuilt:** the ingestion pause card relocated from
Health to Pipelines **intact**, and its predeploy pins moved with it — three
markers out of the `/status/status.js` entry and into
`/status/pipelines/pipelines.js`. A pin left on the old file fails every deploy
for a control working perfectly one page over; a pin deleted instead of moved
silently stops watching. Its pure half (`assets/ingestion-time.js`, 23 tests)
did not move at all — only its caller did.

**The gate is one file for four pages** (`status/lib/gate.js`) because four
copies is four chances for one to fail **open**, and that failure is invisible:
a page that reveals controls to the wrong person looks exactly like a page that
works.

---

The three items below are moved **whole** from [`TODO.md`](TODO.md).

### In-flight build B: /status SPLIT (4 pages)
Blueprint = "Ops IA" section below in this file (BUILD TO THIS). Agent's last
words: "JS parses. Now the Agents page." Uncommitted work likely in
sites/heygabi-home/public/status/ + apps/auth-worker/src/ops.ts.
- Check whether ESTATE_CONDUCTOR_TOKEN secret was created (wrangler secret
  list on auth-worker + docs/access/keys/ custody file). Secret handling ONLY
  per docs/access/discord-bot.md §7 file-redirect ritual.
- Pause card RELOCATES to /status/pipelines intact (37 tests + predeploy pins
  must move with it).
- Processing tab renders a pushed state blob; contract to be documented in
  docs/info/; agents tab GET behind requireDevops, POST behind the token;
  usage figures block included.

### Status-page expansion items 1 and 3 (owner asks, 2026-08-18)

1. **Agents tab** — live list of running Claude agents + which model each runs
   on. Design agreed with owner: a small state endpoint the conductor PUSHES to
   on every agent event (dispatch/landing/failure) + heartbeats; the page polls
   it every 30 s. (Owner asked for "a poll by you every 30 s" — the page polls
   30 s; the conductor pushes event-driven, which was explained and accepted.)
3. **Usage figures on the status page** — session % / weekly % / Fable %
   pushed by the conductor to the same state endpoint on its usage pulses.

⚠️ Item **2** (the processing tab) stayed in `TODO.md`: its PAGE shipped here,
its PUSHER did not. Items 0 and 4 were never part of this build.

### Ops IA — the /status SPLIT (owner mock 2026-08-18, organized by conductor; BUILD TO THIS)

Owner: "maybe a health page that also has logs for the pods/workers/containers,
a page for data processing, a page for running the pipelines and their logs...
take this and organize it into pages you think make sense." Four pages, one
shared nav shell, all under the existing auth gate:

| Page | Job | Contents |
|---|---|---|
| **/status** (Health) | Front door: is everything up? | Green/amber/red per component (workers, gateway DO, crons, D1/Firestore/R2); last deploy per worker from deploys.log; **recent log lines per worker** (see log note); backup freshness (last daily run + which mirrors confirmed) |
| **/status/processing** (Data processing) | GABI's knowledge base growing | Items 2 above: in-flight books + %, processed history, "joined GABI's knowledge base <date>" per book; queue depth by lane (audiobook-with-review / EPUB / text-PDF / deferred-PDF); pack counts + ingester_version |
| **/status/pipelines** (Pipelines) | Run + control | The pause/resume + timers card (relocates here from /status once built); nightly-window state (Phoenix clock, next window, GPU guard reading); run history with per-run logs (ingestion, backups, Drive sync, detail sweeps); manual triggers only where already safe |
| **/status/agents** (Agents) | Claude capacity | Item 1 above (running agents + model, 30 s poll of conductor-pushed state); event feed (dispatched/landed/failed); usage figures live HERE (item 3) — they are Claude capacity, same subject |

⚠️ **Log honesty:** there are no pods/containers — the estate is Workers +
local PC pipelines. Workers cannot be live-tailed from a static page; the
plan is a **log ring buffer**: workers write structured error/event rows to
D1 (capped, newest-N), pages render it, deep-dive links out to the
Cloudflare dashboard. Local pipeline logs already exist on the PC; the
ingestion build publishes recent tails to the same state endpoint. Never
fake a "live" tail that is actually stale — timestamp every log block.

Build order: pause-UI agent lands → nav shell + page split + Agents/
Processing pages (one agent, one surface) → ring buffer wiring can trail as
a follow-up without blocking the split.

⚠️ **The ring buffer is still UNBUILT** and stayed in `TODO.md` as its own item
— it was explicitly allowed to trail the split, and it did.

## 🔒 THE BACKUPS LEAVE CLOUDFLARE — ✅ DONE 2026-08-18

Moved whole from [`TODO.md`](TODO.md), where it was **owner step 2** of the
restore-drill follow-up: *"Get a copy of `estate-backups` off Cloudflare.
Everything protected and everything protecting it live in one bucket, one
account, one region. Needs a decision about where the copy goes before anything
can be built."* The decision came, and the build followed the same day.

**Owner decision 2026-08-18, verbatim:** *"Do a and b, don't store in GABI tho
store in a new folder called GABI_backup on drive"* — BOTH a nightly local-PC
mirror AND a Google Drive mirror, the Drive copy in a **new top-level folder**
deliberately outside the estate's book folder tree.

**Three homes, none of them Cloudflare:**

| Home | Location |
|---|---|
| This PC | `C:\Users\nbasl\OneDrive\Documents\estate-backups-mirror\` |
| OneDrive | the same folder — inside the synced tree, so the second cloud costs **no code of ours** |
| Google Drive | `/GABI_backup`, My Drive **root**, created **unshared** |

**What was built:**

| Piece | Where | Why there |
|---|---|---|
| `mirror-estate-backups.mjs` | `catalog-platform/scripts/` | Speaks the R2 key grammar its sibling `backup-*.mjs` scripts define, and shares `lib/backup-keys.mjs` with them |
| `mirror_to_drive.py` | `audiobook_catalog/scripts/` | The estate's Drive OAuth token lives there and nowhere else — the same reasoning that put `publish_docs_snapshot.py` there rather than here |
| **STEP 10** | `audiobook_catalog/scripts/sync_to_drive.py` | Both halves, both cycle paths, each its own failure domain |

⚠️ **It deliberately does NOT run in `backup.yml`.** A mirror running inside the
same CI, on the same account's credentials, is not an off-Cloudflare copy — it
is the same egg in the same basket with an extra step. It runs on the owner's
machine, hung off the one unattended job already there.

⚠️ **Both cycle paths, and that is not optional.** The backup workflow runs
daily at 09:12 UTC whether or not the audiobook library gained a book. A mirror
wired only to the busy path would track the estate's backups exactly as often
as the owner buys audiobooks — and a disaster-recovery copy that silently stops
refreshing is worse than none, because the dashboard still says one exists.

**Two things it had to get right, both traced to real failed runs:**

| Trap | What the code does |
|---|---|
| The workflow log contains both the rendered `##[notice]Wrote estate-backups/<key>` **and the shell that printed it** (`echo "::notice::Wrote estate-backups/$KEY"`) | Anchored on `##[notice]`, never on the words. A naive grep would try to fetch an object literally named `$KEY`. Pinned by a test |
| Runs `32111218016` and `32112007920` each lost `audiobook-covers` mid-generation — one to a transient 500, one to the 300 MiB upload cap | Only **complete** generations are mirrored: a split archive counts as complete only when the run DECLARED a part count and that many parts were logged. **No declaration ⇒ incomplete**, because a missing part is indistinguishable from an unannounced one and "I cannot tell" resolves to "don't trust it". A half-mirrored split archive cannot be untarred **at all**, so mirroring one and reporting success is the worst available outcome |

⚠️ **The store list is DERIVED, not copied.** `readWorkflowPrefixes()` parses
`backup.yml`'s own retention invocation — the same technique `backups.test.ts`
uses — so the mirror inherits both the store set and the `--keep` depth. A
fourth hand-maintained copy of that list is exactly the drift that let
`library-catalog-2nd` go unbacked-up; a store added to `backup.yml` is now
mirrored the same night with no second edit.

⚠️ **Retention: the mirror FOLLOWS the bucket. It is not an archive.** Both
halves keep the newest N generations (N from `backup.yml`, 8 today) and delete
the rest, **whole generations at a time**. A generation pruned upstream ages
out of the mirror. A copy meant to outlive the bucket's retention must be taken
by hand and put where neither script manages it. Drive **trashes** rather than
hard-deletes — 30 days of recovery from a retention bug; the local half does
not.

⚠️ **How it enumerates the bucket, and what that costs.** Not a listing:
`wrangler r2 object` has no `list`, and the REST endpoint needs
`CLOUDFLARE_API_TOKEN`, a GitHub secret **not on this machine**. It reads the
keys off the workflow log (RECOVERY §2 method A). **Consequence: the mirror
sees what the workflow LOGGED, not what the bucket HOLDS** — an out-of-band
deletion would go unnoticed. Accepted limitation, not an oversight; the day
that token lands locally, swapping discovery for a real listing is a small
edit.

**First full run, measured 2026-08-18:**

| | |
|---|---|
| Stores | **11 / 11** |
| Objects | **12** (audiobook-covers is 2 parts) |
| Bytes | **539,573,402** (514.6 MiB), identical on both mirrors |
| Generation | `20260818T0948xxZ`, run `32123529431` — the first scheduled daily backup |
| Discovery cost | **one** workflow-log read; the newest run satisfied all 11 stores |
| Integrity, local | `d1/estate_auth` re-fetched from the live bucket and SHA-256'd: `dd558909…a10f9b` — **live bucket = mirror = manifest**, three-way |
| Integrity, Drive | **12/12** objects, Drive's server-computed `md5Checksum` vs a local MD5. Not a spot-check — every object |
| Idempotency | second run of each half: 0 fetched / 12 skipped, 0 uploaded / 12 skipped |
| Suites | `test:scripts` **31/31**, audiobook pytest **1,339 passed** |

⚠️ **NOT verified:** a restore performed *from* the mirror, and retention
deleting anything (the mirror holds one generation; the first prune cannot
happen until nine daily backups exist). Both are tracked in `TODO.md`.

**Runbook:** `access/RECOVERY.md` **§2a** (locations, restore-from-mirror,
retention semantics, credentials) and `audiobook_catalog/docs/access/PIPELINE.md`
(the STEP 10 row and section).

## 🔒 THE RESTORE DRILL, AND THE HARDENING THAT FOLLOWED IT — ✅ DONE 2026-08-18

Moved whole from [`TODO.md`](TODO.md) — the drill (commit `8522b7c`) and the
follow-up that implemented its mechanical recommendations (commit `8c7f780`).
**Four owner steps remain and stayed in TODO.md**; everything below is finished.

**What the follow-up changed**, per finding in the table below:

| Finding | What was done |
|---|---|
| 1 — exports do not replay | `reorder-d1-dump.mjs` is now a **mandatory, tested** step of the D1 restore path. `scripts/test/reorder-d1-dump.test.mjs` builds the exact CREATE/INSERT interleave and **replays both versions in `node:sqlite`**: raw dies at `no such table: main.edition` with one of four tables created; reordered loads clean, every row, empty `foreign_key_check`, `integrity_check` = ok. `backup-restore.md` §4b now says mandatory, not optional |
| 2 — the restore writes timestamps as maps | Fixed. Every document passes through `scripts/lib/firestore-timestamps.mjs`; dry run AND commit print the conversion count per collection. Proven **offline** (dump → revive → the SDK's own wire serializer → an identical `timestampValue`), no Firestore write. The old broken encoding is pinned as its own test. ⚠️ The dump format was deliberately NOT changed — it is lossless, and changing it would invalidate every backup already in the bucket |
| 3 — a blind `estate_auth` restore re-approves the revoked | The tool says so now. `reorder-d1-dump.mjs` detects `estate_user`, prints the BACKUP's counts (rows / per-status / approvers / devops — **counts only, never a name**), the measured incident and the capture command, then **exits 3** unless `--yes-i-checked-membership`. The reordered file is still written; the exit only stops an automated chain |
| 4 — `library-catalog-2nd` has no backup | In the backup set (`9dcf4af9-…`). ⚠️ And the reason it was missed is fixed too: the three lists that must agree — `backup.yml`'s matrices, its retention arguments, `backups.ts`'s `KNOWN_BACKUP_PREFIXES` — are now compared by a **test that parses backup.yml**. Written advice promoted to a mechanical guard |
| 5 — `discord_links` / `readingPositions` have no backup | **Measured: the dump's collection list is `listCollections()` DISCOVERY, not a stale explicit list**, so both are captured the moment they hold a document — no change needed to the walk. What was wrong was the SILENCE: `EXPECTED_COLLECTIONS` now emits a `::warning::` and a `_summary.json` `missingExpected` entry for an expected-but-absent collection. Never fatal — an empty collection is legitimate |
| 6 — the dispatch-only cadence has a measured cost | `backup.yml` runs **daily at 09:12 UTC**. Cost measured, not assumed: public repo, the billing endpoint reports **0 billable ms** across all 9 jobs, 144 s wall clock for `target=all`. Off the hour to dodge GitHub's `:00` queue burst; ≈04:12 America/Chicago. A scheduled run always backs up everything (a cron tick has no `inputs`) |
| 7 — the Firebase key is not on the owner's machine | ⏳ **NOT closed — owner step, stayed in TODO.md** |

**Also settled:** the "8 generations configured, 2 in the bucket" question was
**not a prune bug** — only two runs had ever used the R2-writing path, and the
retention log reads `2 object(s), keeping 2, deleting 0`. The daily cron fills
it to 8 in eight days; first real deletion expected on day nine.

**Also declined, on purpose:** `estate-ebooks` (1.81 GB) stays out of the `r2`
matrix — a local master re-uploads it from disk. ⚠️ The residual risk is named
rather than hidden: *that protection lasts exactly as long as the owner's
disk*, and the reasoning sits in `backup.yml` beside the matrix it explains.

**Verification:** `npm run test:scripts` 18/18, `apps/auth-worker` 266/266
(17 in `backups.test.ts`), `auth-worker` typecheck clean. The backup itself was
proven by a real dispatch — see the drill-date runbook for the objects.

---

## 🔴 RESTORE DRILL RAN — THE BACKUPS ARE NOT AS RESTORABLE AS THEY LOOKED (2026-08-17/18)

The estate's backups were restored into a **sandbox** for the first time
(local `node:sqlite` + `wrangler --local`; production READ-only, zero writes).
Runbook written: **[`access/RECOVERY.md`](access/RECOVERY.md)** — per-store
commands, measured restore times, the drift table, and an explicit NOT-verified
list. `scripts/reorder-d1-dump.mjs` shipped as part of it.

**What the drill found. Ranked; none of it was fixed by the drill.**

| # | Finding | Where |
|---|---|---|
| 1 | ⚠️ **`library-catalog` and `board-game-catalog` exports DO NOT REPLAY.** Both die mid-import (`no such table: main.edition` / `main.app_user`) leaving a half-populated database that looks imported. Reproduced in two SQLite engines. `PRAGMA foreign_keys=OFF` does not fix it. `reorder-d1-dump.mjs` does — verified, full row counts, zero FK violations | RECOVERY §3b |
| 2 | ⚠️ **The Firestore restore writes every timestamp back as a MAP.** 2,139 fields across all 56 collections. Proven offline with the Firestore SDK's own serializer. Every `orderBy('createdAt')` would break | RECOVERY §4.2 |
| 3 | ⚠️ **Restoring `estate_auth` blind silently re-approves a revoked member.** Backup: 12 approved / 0 revoked. Live: 11 approved / **1 revoked**. Both row counts are 12, so a count check passes | RECOVERY §3d |
| 4 | **`library-catalog-2nd` (the `padhard` shelf) has NO backup** — live D1, 6 works / 34 change_log rows / 32 migrations, absent from `backup.yml`, `prune-r2-backups.mjs` and `backups.ts` alike | RECOVERY §1b |
| 5 | **`discord_links` and `readingPositions` have no backup** — the newest dump predates the first (2026-08-16 vs a writer that landed 2026-08-17); the second is absent from the dump's 56 collections | RECOVERY §1b |
| 6 | **The dispatch-only cadence has a measured cost:** in under two days the newest backup fell 6 `estate_auth` migrations / 5 `library-catalog` migrations behind, +469 `change_log` rows, and a whole `ebook_holding` table | RECOVERY §1c |
| 7 | **`FIREBASE_SERVICE_ACCOUNT_JSON` is not on the owner's machine.** A Firestore incident cannot be fixed from here without a Firebase-console trip first | RECOVERY §7 |

**What DID restore cleanly:** all four D1 exports (two after reordering) with
row counts matching production; the Firestore dump verified 56/56 collections
and 1,303/1,303 docs with zero mismatches; all three R2 cover dumps complete
(3,201 objects / 453 MB, zero missing, zero size mismatches) and **byte-identical
to live** on a SHA-256 spot check per bucket; and the
restore-then-`migrations apply` catch-up recipe brought a 5-migration backup up
to production's 11 with all 12 user rows intact.

**Owner decisions pending — RECOVERY §9 has all ten recommendations, ordered.**
The drill changed no live backup job by charter. The first three are cheap:
add `library-catalog-2nd` to the three places that list stores; teach
`restore-firestore.mjs` a timestamp reviver; decide whether `backup.yml` gets a
cadence.

---

## 💬 GABI POSTS BOOK-CLUB QUESTIONS INTO DISCORD — SHIPPED 2026-08-18

Owner's ask, verbatim: ***"you know how for bookclub gabi can post questions in
each book club? lets add that feature to the discord bot."***

`apps/discord-worker/src/question-sync.ts` + `POST /questions/sync`, poked by
`audiobook_catalog/app/club_announcements.py`'s new `sync_question_messages()`
on the existing ~8h cadence with the **same** `POLL_SYNC_TOKEN`. Per-club
opt-in `features.discordQuestions` (default OFF, a checkbox in Edit Club).
Ships dark and inert: no club has the key set.

⚠️ **The measurement inverted the obvious guess, and that decided the build.**
"GABI posts questions" sounds like the poll machinery with different content.
It is not: the questions are static prompts in
`audiobook_catalog/site/discussion_prompts.json`, surfaced to hosts/mods on the
read page, and "Post as GABI" writes an **ordinary comment** with `isBot: true`.
So they are open discussion prompts, not votable polls — the Discord message
carries **no components**, and there is **nothing to sync back**.

⚠️ **Baseline-first silence** is the rail that makes it switchable-on: a club
accumulates a question per section per book, so the first tick a club is seen on
posts NOTHING and records the instant. Only questions posted after that appear.

Reused rather than reinvented: the channel binding (`discordChannelId` → else
the club's announcement webhook → else a named skip), the shared pipeline
token, and the cadence. A **separate route** from `/polls/sync` so the two keep
independent failure domains, exercised in both directions by test.

Suites: workspace 1,121 → **1,166**; audiobook pytest 1,330 → **1,339**; site
vitest 725 (+1 case). Design of record and as-built:
[`info/discord-bot-design.md`](info/discord-bot-design.md) §8; owner switch-on
steps: [`access/discord-bot.md`](access/discord-bot.md) §14.

**Verified live** (deploy `6ccb1c99-bd45-4b92-a22b-cd3377cfed57`): the gate
(401 unsigned/wrong-token, worded body), the lane parse (400, worded), the
health rows, and the **Firestore service-account read path** — a real
authorized tick enumerated `clubs_considered` 4 dev / 3 prod with
`clubs_opted_in: 0` and `posted: 0`, byte-identical across three runs.
`/polls/sync` and `/interactions` still 401, unaffected.

⚠️ **NOT verified live:** no question has ever reached a real Discord channel
(0 clubs opted in — the key did not exist before today); `baselined: 0` means
the baseline WRITE never ran, so the baseline rail is proven by test only, as
is everything downstream of the opt-in; the webhook → `channel_id` resolution
is still unproven (inherited from the poll-sync build); and the Edit Club
checkbox has not been clicked in a browser.

## 🔗 GABI'S DEEP LINKS — ASKER-AWARE AND PREFILLED, SHIPPED 2026-08-18 (moved from TODO.md 2026-08-18)

Arrived in TODO.md as a one-line prefill item (*"`panelDeepLink()` must carry
the question"*) and left as two, because the owner hit the second half live the
same day. Verbatim: ***"why is it showing padhard and not the generic site"***.

**Live** at version `c9af75f0-f8e3-4de6-b6ac-81a02c98ce9f`, commits `02c5834`
(the build) + `a4b5d53` (the prefill re-measured against the deployed panel).

### Half 1 — the destination was a constant, and it was the wrong one

Every fixer/panel deep link pointed at `GABI_PANEL_URL` =
`https://padhard.heygabi.ai`. That was **correct when it was written**: design
decision 8 put the `GABI_PANEL` posture ON for `friend` and OFF for the main
library, so padhard genuinely was the only host where a GABI conversation could
happen at all. The posture moved; the constant did not.

⚠️ **The apex is NOT the fix.** `heygabi.ai` is a front door that runs no
panel, so "point it at the generic site" read literally is the same dead end
wearing a friendlier hostname. The destination is now **the asker's own
catalog**, resolved from the identity they linked themselves.

**No new machinery and no new credential** — it reuses Tier 1's `whoami` port,
read-only, as an injected `Pick<DelegatePort, 'linkedUid' | 'whoami'>` that
[`src/panel.ts`](../apps/discord-worker/src/panel.ts) cannot construct.
`panel.ts` was added to the credential-seam guard in `estate-docs.test.ts` for
exactly that reason: a module that reads an identity to decide a hostname is
the shape of thing that grows a service account if nobody is watching.

| `whoami` says | The link points at |
|---|---|
| `runResearch` on exactly one instance | that instance |
| `runResearch` on both | **the main library** |
| an account but no capability, on one | that instance — still *their* site |
| an account but no capability, on both | the main library |
| unlinked, or nothing resolved | the configured `GABI_PANEL_URL` |

⚠️ **The last row is deliberate and is not a dead end.** Somebody with no
account anywhere gets a **real panel** that will ask them to sign in — strictly
better than the apex, which has nothing to sign in to — plus whatever `/link`
nudge the flow already words. ⚠️ **An unreachable shelf never re-routes
anybody**: a `whoami` that could not be reached is not evidence that somebody
has no account there, and conflating the two is how an outage becomes "you have
no account".

⚠️ **A tie goes to the main library rather than asking, which is the OPPOSITE
of Tier 1's decision** — recorded because the inconsistency is intentional. A
*write* to the wrong shelf is a tidy-up somebody has to notice first, so that
path asks; a *link* to the wrong shelf costs one click, so asking would be four
words of ceremony for nothing.

**Where it applies, and where it deliberately does not:**

| Emission site | Now |
|---|---|
| `/gabi` command (`gabi.ts`) | **asker-aware** — the identity read it already did now yields the uid too, so it costs **+2 subrequests**, not +4 |
| `fix_request` branch (`mention-flow.ts`) | **asker-aware** — the exact lane the owner hit |
| `question` branch fallback | **asker-aware**, and moved BELOW the model call so a turn she answers in her own voice dials nothing |
| book-pick fallback (`handlePick`) | **asker-aware**, prefilled with the ORIGINAL question rather than the label pressed |
| `GET /api/health` `gabi_panel_url` | **static, on purpose** — it reports the configured var so a misconfigured link is one `curl` away; it is a config row, not a person's link |
| `DELEGATE_MSG.noAccountAnywhere` | **unchanged** — it names both sites because that person has an account on neither, so there is nothing to resolve |

⚠️ **Not gated on `GABI_DELEGATED_WRITES`.** `whoami` mutates nothing and needs
no capability; switching writes off must not send everybody back to the pilot
host. It IS gated on the port existing at all, which is a real production state
(no app token or no service account) — and there every surface behaves exactly
as it did before this landed.

⚠️ **One behaviour moved.** On `/gabi` with a port, a link document carrying no
`firebaseUid` — a pre-uid link — now reads as *not linked* rather than *linked*,
because that is what it is: it cannot prove an estate account and re-running
`/link` is the fix. It is what the delegated path already tells that same
person, and one surface contradicting another about whether somebody is linked
is worse than either answer.

### Half 2 — the link arrived empty

The panel half was already built and deployed (`library_catalog` `8745191`,
both instances, 2026-08-18): it reads a question out of the URL, prefills the
box, opens itself, and **never sends**.

⚠️ **THE PARAMETER IS `?gabi=`, NOT the `?q=` the design named** — and that is
a measurement. `q` is already the library app's own collection search on `/`,
the exact path this link points at (`router.tsx` `parseCollection`), so `?q=`
would filter the book list to the question as well as prefill the panel: an
empty catalogue under a floating panel, the link looking broken at the moment
it worked. The full record, including the regression test that pins `?q=` NOT
prefilling, is in `library_catalog/docs/DONE.md` and
`library_catalog/docs/info/gabi-fixer-design.md` §10.2.

⚠️ **RE-MEASURED HERE against the DEPLOYED bundle rather than trusting that
note**, 2026-08-18: `/assets/index-rvJiy8K2.js`, byte-identical on
`library.heygabi.ai` and `padhard.heygabi.ai`, contains

```js
const ag = "gabi", V0 = 500;
const n = e.replace(/\s+/g, " ").trim();
return n ? (n.length > V0 ? n.slice(0, V0).trimEnd() : n) : null;
```

The param name and the 500 cap were right. The panel also `trimEnd()`s **after**
slicing, which the first commit did not — aligned in `a4b5d53`, so the URL a
person can read in Discord is character-for-character what the box will hold
rather than a longer string that quietly shrinks on arrival. The panel's reader
is reproduced in `test/panel.test.ts` as an oracle, so a drift in either
direction fails the build.

⚠️ **`GET /api/health` calls the same function with NO question**, so the
prefill argument is optional and a test pins the bare link. A required argument
would have turned a health row into a crash.

### The subrequest discipline, because the commonest turn pays it

**1 link read + 2 `whoami`**, memoised per turn (the BASE is memoised, not the
finished link, so two prefills cost one identity), and **paid only when a link
is actually built**. Both conversational fallbacks were moved below the model
call for this: building them eagerly would have charged every question in the
server for a string most turns throw away.

### Verified live 2026-08-18

| Check | Result |
|---|---|
| `GET /api/health` | `ok: true`, 12 features, **all rows intact** incl. `gabi_docs_ready: true`, `gabi_delegated_ready: true` |
| `gabi_panel_url` health row | `https://padhard.heygabi.ai/` — bare, unchanged, correct (a config report) |
| `POST /interactions` unsigned | **401** |
| `POST /interactions` bad signature | **401** |
| `library.heygabi.ai/?gabi=…` | **200** |
| `padhard.heygabi.ai/?gabi=…` | **200** |
| Suites | **1,108 pass / 0 fail** workspace-wide (was 1,083) |
| Docs routing | untouched — `docsIntent()` and both 2026-08-18 transcript regressions still green; `"put a change in front of you"` kept verbatim because that suite matches on it |

⚠️ **NOT verified:** that the panel *visibly* prefills in a browser. The reader
function was measured in the deployed bundle (above) and both URLs answer 200,
but nobody drove a signed-in session through it — and the panel is role-gated
(`gabiPanel` posture AND `runResearch`), so a rendering check needs an account
that holds both.

## 📚 GABI READS THE ESTATE DOCS — ALL SIX PHASES SHIPPED 2026-08-18 (moved from TODO.md 2026-08-18)

Owner: *"let's make sure GABI can read all of our docs and stuff so she can
even help me if needed for let's say I don't have a Claude code session
open."* Design of record, fully decided (all four §9 questions answered):
[`info/gabi-docs-assistant-design.md`](info/gabi-docs-assistant-design.md).
⚠️ That sentence is kept rather than deleted, because it is the reason this
item sat in TODO.md for a day and the reason it is now here: *"This item stays
here rather than moving to DONE.md because it is not finished — the Discord half
is the reason the owner asked for it, and it is exactly the half that has not
been built."* **Phases 3 and 4 landed 2026-08-18 and the Discord half exists.**

**Landed 2026-08-18 — the corpus, the routes and the page.**

| Phase | What | Where |
|---|---|---|
| 1 | The publisher + the private bucket | `audiobook_catalog/scripts/publish_docs_snapshot.py`, bucket `estate-docs-gated` |
| 2 | Door A: search / section / receipt, `requireDevops()` | `apps/auth-worker/src/estate-docs.ts` |
| 5 | Pipeline STEP 9, on the busy AND the idle path | `audiobook_catalog/scripts/sync_to_drive.py` |
| 6 | The devops-gated docs page with a real search bar | `sites/heygabi-home/public/docs/` |

🔗 **<https://heygabi.ai/docs/>** — signed in as owner. Type *revocation delay*:
the top hit should name the **file and the section**, the strip under the title
should carry the snapshot's publish date **before you type anything**, and
opening a result should render one section properly with its source path named.

Measured on the first real publish: **119 markdown files, 3,105,573 raw bytes,
1,413 sections, 1,248,434 gzipped.** `CREDENTIALS.md` excluded by the denylist,
7 non-`.md` files excluded by construction, scanner findings zero.

### ⏳ Still to build — phases 3 and 4, the Discord door

- **Phase 3** — `email` added to the link doc (`apps/discord-worker/src/link.ts`),
  `devops` added to `/seen`'s envelope, `ESTATE_APP_TOKEN_DISCORD` minted on
  BOTH Workers. ⚠️ Waits on the concurrent discord-worker agent landing. The
  owner's decision is already taken: **relink, no backfill** (design §9.1).
- **Phase 4** — GABI's two read-only tools (`search_estate_docs`,
  `read_estate_doc`), the caps, the `GABI_DOCS` posture, the refusal and
  staleness wording. ⚠️ All four refusal sentences already exist as
  `DOCS_REFUSALS` in `estate-docs.ts` — **reuse them; do not author a fifth
  wording of the same refusal.**

### 🔴 Owner steps — both OPTIONAL, neither blocking anything

1. **Widen the estate R2 API token to cover `estate-docs-gated`** (dash → R2 →
   API tokens). ⚠️ **Measured 2026-08-18: it does not reach the new bucket** —
   `PUT estate-ebooks` OK, `PUT estate-docs-gated` AccessDenied, because the
   token is scoped to a named bucket list. Not blocking: the publisher's
   default transport is `wrangler r2 object put`, which uses wrangler's own
   OAuth and needs no new credential. Worth doing only if `--transport s3` is
   ever wanted.
2. **Flip the scanner from shadow to enforce** once a week of clean shadow
   output has accumulated (`--scanner enforce`, or `DOCS_SCANNER_MODE=enforce`).
   Today's evidence is ONE clean pass, not a week of them.

### Not done deliberately — a decision, not an oversight

**Nothing links to `/docs/` yet.** It is not on the front door (a devops-only
page advertised to every visitor) and not in `/status`'s Operations section,
where the runbook links live and where it probably belongs. Left unlinked
rather than guessed at.

### ✅ Phases 3 + 4 — the Discord door and her two docs tools (2026-08-18)

The half the owner actually asked for. As-built:
[`info/gabi-docs-assistant-design.md`](info/gabi-docs-assistant-design.md) **§11**;
runbook [`access/estate-docs.md`](access/estate-docs.md) **§§8-10**.

| Phase | What | Where |
|---|---|---|
| 3 | `email` on the link doc; `devops` on `/seen`; door B on the corpus routes | `apps/discord-worker/src/link.ts`, `apps/auth-worker/src/{estate,estate-docs}.ts` |
| 4 | `search_estate_docs` + `read_estate_doc`, caps, posture, wording | `apps/discord-worker/src/estate-docs{,-exec}.ts`, `gabi-tools.ts` |

- **`ESTATE_APP_TOKEN_DISCORD_DOCS`** minted, 2 holders. ⚠️ A NEW pair, not the
  T1 token — that one has three holders including both library Workers, and a
  secret cannot be read back, so adding a fourth holder would have meant
  re-minting and breaking T1. Fresh trust edge, fresh pair.
- **Door B verified LIVE**: owner → 200 with real results and the snapshot date;
  an email not in the directory → 403 with the design's exact sentence; no email
  header → 400 with the relink sentence; casing/padding normalised. This closes
  §10.8's *"the 403 path is asserted in code and in copy, not observed."*
- Workspace **1,071/1,071** green; `probe:estate` **115/115** before and after
  the deploy (⚠️ the design's "111 baseline" was stale — the suite grew with the
  T1 build; no probe was changed here).
- ⚠️ **Departure, recorded not silent**: §5.3's Sonnet-class model
  recommendation was NOT adopted — the docs tools compose into the *existing*
  conversation loop, so the model must be picked before anyone knows whether a
  turn is a docs turn. Design §11.7 has the full reasoning and what adopting it
  would take.
- ⚠️ The credential guard was **widened** from "credentials live in ONE module"
  to "in TWO named modules, each one trust edge", with a new assertion that
  neither executor names the other's secret.

**Ships dark behind `GABI_DOCS = "off"`.** The two owner steps that remain are
carried forward to `TODO.md` rather than closed here — an archive entry must not
be the only place a pending owner action lives.

## 📚 THE CONFIRM QUEUE IS ANNOUNCED — `/series` READS IT — ✅ DONE 2026-08-18

The page half of the series registry's confirm-queue affordance, moved from
[`TODO.md`](TODO.md) §"Series registry" item 1. The API half landed
2026-08-17 and **nothing in a browser read it** for a day: `GET /api/series`
carried `pending_open` / `pending_detail` / `pending_url` for approvers and
`/series` ignored all three, so the estate's one real near miss stayed
invisible on the surface built to surface it.

⚠️ **The still-OPEN half stayed in `TODO.md` rather than riding along**: the
Survivalist decision is the owner's, and archiving a human's pending decision
as "done" because the code around it shipped is exactly the silent-staleness
this archive exists to avoid. A finished build does not sit in the active
list; a waiting decision does.

**Shipped** (`3a3b0f2`, `sites/heygabi-home/public/series/`):

| Piece | What it does |
|---|---|
| `#ser-pending` | The banner. Ships **hidden and empty**; filled only from the list answer |
| `renderPending()` | `pending_detail` **verbatim** — the Worker's own sentence, not re-worded here |
| `pendingOpenBtn` | Fetches the queue and renders each open row in words |
| `predeploy.checks.json` | `id="ser-pending"` + `pending_detail`, in both `/series/` blocks |

**Two decisions, and their reasons, because both are the kind that get
"helpfully" undone later:**

1. ⚠️ **The page runs NO approver check of its own, on purpose.** The three
   fields are **absent rather than zeroed** for a non-approver, so *presence
   is the gate*. The page holds a Firebase user and a bearer token and
   deliberately does not use them for this: the index's approver set is
   `OWNER_EMAILS`, which the browser must never hold a copy of, and a
   client-side list would be a second source of truth that drifts silently
   the day the Worker's changes. Rule, in the file: fields absent → nothing;
   `pending_open === 0` → nothing; `> 0` → the banner.
2. ⚠️ **The queue is FETCHED, not linked — because a link here would lie.**
   `pending_url` sits below `requireOwnerStanding()`, which authenticates by
   `Authorization: Bearer` **only**. An `<a href>` cannot carry a header, so
   the obvious implementation of "link the queue" hands the owner a raw
   `{"error":"unauthenticated"}` 401 — a dead link *and* a bare HTTP status
   shown to a person. The disclosure button calls the same URL through
   `callIndex()`. The path is still **read from the response** (the whole
   point of the field: the page need not know a second endpoint exists), but
   guarded to a same-origin `/api/` path — a URL out of a response body is a
   place a bearer token could be sent somewhere it should not go.

**Deliberately NOT built: the resolving POST.** The banner reads the queue; it
does not decide it. `POST /api/series/pending/:fold` either merges two series
under one **persisted key** or records that they are genuinely different, and
the row is kept after resolution so the decision is never re-asked — an
irreversible, once-only write that deserves a considered affordance rather
than a button bolted to a notice. The banner says so in words instead of
offering a one-click merge.

Toned `--et-accent-2` (the "yours to act on" colour `#ser-status` already uses
for `data-tone="owner"`), never `--et-danger`: nothing is broken and nothing
is waiting to merge — two series simply stay two until somebody decides.

⚠️ **NOT VERIFIED, and it cannot be from an unauthenticated fetch:** that the
banner *renders*. The predeploy markers prove the shell and the module
shipped; the fields only exist for a signed-in approver, so whether the words
appear needs the owner's own eyes at
**<https://heygabi.ai/series/>** — signed in, the banner sits directly under
the status line, above the filter box.

## ✂️ COPY TRIMMED ACROSS THE ESTATE — ✅ DONE 2026-08-17

**Estate-wide ask, landed the session it was raised, so it never sat in
`TODO.md`.** The owner, verbatim, right after he trimmed `/admin`'s header
himself ("I think what we have is self explanatory"):

> *"Let's trim text like this all over each of the sites. Only keep what's
> mandatory and keep all the text short and useful"*

`204fb9d` (the `/admin` header) is the precedent every site followed: explanatory
prose out, the removed prose's home of record named in a comment beside the cut,
and every string pin asserting removed text updated **in the same commit**.

| Site | Commit | Words | Deployed |
|---|---|---|---|
| heygabi.ai — front door, `/status`, `/series`, `/universes`, shelf-migration runbook | `fd3f7f2` | 1,539 → 1,116 (−27%) | ✅ verified live |
| `library.heygabi.ai` + `padhard.heygabi.ai` | `library_catalog` `939109f` | 323 → 196 (−39%) | ✅ both verified live |
| `boardgames.heygabi.ai` | `Board_Game_Catalog` `e225665` | 263 → 171 (−35%) | ✅ verified live |
| `audiobooks.heygabi.ai` | — | — | ⏳ QUEUED — another agent owns that tree (player build); the item is in its `docs/TODO.md` |

**Home-of-record comments written into this repo's pages**, so nothing removed
became unfindable: `info/estate-themes.md` (per-site theme persistence),
`info/sso-design.md` (each catalogue asks for its own sign-in),
`access/estate-auth.md` (the Operations gate mechanism),
`access/backup-restore.md` (the backup inventory and read envelope),
`info/health-envelope.md` (the six-host read list),
`sites/heygabi-home/public/status/status.js` (the 8h threshold constants),
`info/index-worker-design.md` (the shared index), `tools/series-canon.mjs`
(series spelling canon).

**The front door's dropped sign-in-scope sentence is not lost either**, and this
is the shape worth copying: `assets/estate-search.js`'s `_scopeNote()` already
prints "Searching audiobooks only. Sign in to search every shelf." beside real
results. A worded gate that fires in context beats a paragraph that fires
always.

**KEPT DELIBERATELY across all three repos** — the trim rule stops at honesty:
the `/status` dot legend (a colour with no key is a bare status), "Status: not
yet run", "not configured", "cannot start, stop, or read these runs", "a green
dot means answered, not returned 200", "cannot see the pipeline's next run",
"some entries are wanted, not owned", "nobody has this one means nobody on the
shelves *you* can see", every empty state, every worded refusal and gate, and
both markers that stop a number being over-read ("flattened view, not the
database", "the estimate is tokens only").

**`predeploy.checks.json` needed no change, and that is verified rather than
assumed:** every marker it pins is a heading or an id, none of which the trim
touches, and every removed string was grepped across the tree first. Static and
live predeploy checks pass; `npm test --workspaces` 914 pass / 0 fail.

**Side effect worth naming:** the shelf-migration runbook's facts form carried
two first names in a PUBLIC repo. The trim removed both.

## 🗃️ GABI CATALOG Q&A TOOLS — ✅ TIER 0 DONE 2026-08-18

⚠️ Moved WHOLE from `TODO.md`, unsummarised, per this file's own rule. The
original entry, verbatim:

> ## 🗃️ GABI CATALOG Q&A TOOLS (owner, 2026-08-17) — QUEUED behind continuity
>
> Owner: *"I want her to be able to access our db so she can smartly answer
> questions like who's the narrator of Way of Kings?"* Read-only tool calls
> against the catalogs' existing APIs/index (narrator, duration, series order,
> cross-catalog ownership), scoped by the asker's link + visibilities; the
> GABI_TOOL_NAMES allowlist idiom from the site panel carries over. Part of
> the full-application design (see gabi-discord-app-design doc, 2026-08-17).

**Shipped** (commit `1659252`, `estate-discord` version
`c56b618b-ebe7-4f9d-9cf7-3a35324a0407`): `catalog_lookup` and `series_volumes`,
both read-only, both credential-free, behind a `GABI_TOOL_NAMES` allowlist with
a build-failing test (`apps/discord-worker/test/gabi-tools.test.ts`).

⚠️ **The load-bearing measurement, because it inverts the item's own
assumption:** "the catalogs' existing APIs/index" **cannot** answer the owner's
question. `apps/index-worker/migrations/0001_entry.sql` has no narrator column,
no duration column and no genre column — the index is a cross-catalog POINTER
table by its own schema's declaration. The narrator lives on the audiobook
site's published `catalog.csv` (public, 200, CORS `*`, 1,079 rows, narrator and
duration filled on every one), which is what the tools read.

Verified against the live catalogue, not fixtures: *who narrates Way of Kings*
→ Kate Reading, Michael Kramer, 45:30, 2010, Stormlight #1, The Cosmere.
Brandon Sanderson → 38 audiobooks (Cosmere 22, Cytoverse 7, Reckoners 6,
unfiled 3; 9 with a library print/ebook edition).

**Two pieces did NOT ship and are back in `TODO.md` with their measurements:**
`person_context` (the TBR store is keyed on a display NAME, not a uid) and
cross-catalog counting (the index answers 401 to an anonymous caller on
everything but `/api/search`).

## ☁️ Workers Paid upgrade + the gateway cron backstop — ✅ DONE 2026-08-17

Owner upgraded in the dashboard ("cloudflare upgraded"). What it changed: DO
duration pressure gone (~83%-of-free ceiling), crons 5→250,
subrequests/invocation 50→10,000 (⚠️ several design docs cite the 50 ceiling
as a constraint — still true that bounded-steps is good design, no longer a
hard wall).

~~**QUEUED behind the continuity agent**~~ — **UNBLOCKED 2026-08-17**: that
agent finished and released `apps/discord-worker` (its work is the next entry
below; Worker `5cf27f04-efa2-4a3e-833d-ba0dc1bc302b`).

~~Still to do:~~ **DONE (conductor, `01017e2`)**: the gateway's `[triggers]`
cron backstop re-added, the no-cron test assertion flipped to pin its
PRESENCE in the same commit (as this item required), and the deploy
ACCEPTED — `schedule: */2 * * * *`, Worker version
`4b5f7b61-4645-43dc-b5f9-f0e76b320134` — the measured proof the plan change
took (the identical block was refused under Free the same morning).

- ⚠️ The continuity build **did not spend the new headroom**: its comments and
  `wrangler.toml` still price everything against the tighter FREE ceilings, on
  the stated reasoning that a bound proven under the stricter limit is still a
  bound under the looser one. Those paragraphs are correct-but-conservative
  rather than stale; whoever next touches them decides whether to re-derive.

## 🧠 GABI CONVERSATION CONTINUITY (owner, 2026-08-17) — ✅ BUILT + DEPLOYED 2026-08-17, SHIPPED OFF

Owner: *"I don't want to message GABI and then message her again and she has
no recollection"* + approved the three-layer design: rolling per-person
memory (~10 turns / ~30-min sliding TTL, injected as model context), reply-
with-ping and @mention continuation in channels, **DMs as the zero-@
surface** (DM content is exempt from the Message Content intent — the
privacy posture is unchanged), and **components for her clarifying
questions** (buttons/selects for discrete choices, a modal for free text,
all on the already-live interactions endpoint). ⚠️ Owner constraint:
*"whatever we build we need to consider for when we update the chat button
on GABI"* — the conversation-store shape must be documented as a shared
design the site panel can adopt, not a Discord-only one-off.

**Shipped** at Worker version `5cf27f04-efa2-4a3e-833d-ba0dc1bc302b`, commits
`3a50157` (build) + `84dd15f` (docs). Workspace tests **794 → 852, all green**;
107/107 estate probes pass. ⚠️ **`GABI_MENTIONS` is untouched and still
`"off"`** — the flip stays the owner's/conductor's step, and there is no
second switch: everything below is gated by that one.

**All four layers landed:**

- **Memory** — `(surface, space, person)`, 30-min sliding window, 20 turns,
  600 chars/turn, injected as real `messages` (not a summary). Aged-out state
  is **DELETED, not archived**; a test asserts `null` specifically, because an
  empty record would leave a row per person per channel forever holding a key
  that says who talked to her and where.
- **Continuation grammar** — a **reply with the ping left ON**, proved by
  `referenced_message.author.id`, and a **DM** where no mention is looked for.
  Intents **513 → 4609** (`+DIRECT_MESSAGES`, unprivileged). MESSAGE_CONTENT
  (1<<15) still never requested, now asserted as its own test case; DM typing
  (1<<14) deliberately not requested. **Bare text is still the owner's
  decision** and nothing here moved that line.
- **Components** — multi-match lookup → select menu + a button opening a
  free-text modal, on the already-live Ed25519-verified `/interactions`
  endpoint. `MODAL_SUBMIT` (type 5) is now routed; it previously answered
  "unsupported". The trigger is **deterministic, not a model decision**, so the
  whole path is exercised by tests supplying **no Anthropic key**.
- **Portability** — `src/conversation.ts` is pure (no Discord types, no
  Durable Object, no `fetch`), the record separates surface-neutral fields
  from one opaque per-surface bag, and the contract is documented in
  [`info/gabi-conversation-continuity.md`](info/gabi-conversation-continuity.md)
  for the library site's GABI panel to adopt. `library_catalog` untouched.

⚠️ **Where it lives, and why it cost nothing structurally:** the transcript is
`conv:` rows in the **existing** gateway Durable Object, because a second
always-on object was named blocking. No new object, no D1, no Firestore, no
cron. **One row write per ANSWERED turn**, already fused at 200/day → **≤400
writes/day (~2.5%** of the free plan's 100,000). The per-frame-write defect
this Worker was once corrected for is **not** reintroduced.

⚠️ **The honest limit, written into the runbook rather than left to be
discovered:** a reply with **"ping on reply" switched OFF is invisible to
her** — Discord delivers no content and no event, so she cannot know it
happened, and from a person's side it looks exactly like a bug. Replies to
slash-command answers never work either, by Discord's own exclusion.

⚠️ **NOT VERIFIED:** nothing in this build has ever touched the live gateway
(posture off since it was written). No real message, reply, DM, press or modal
submit has been handled; **no model call has ever been made on this surface**,
and `anthropic_key_gabi` still reports `false` — until that key is set she runs
on the keyword router. The content-exception list is a documentation **reading**,
not an observation. Runbook §12.5 carries the exact eight-step script to try
once she is lit — including two steps that exist only so a limitation is seen
deliberately.

## 🗣️ Conversational GABI in Discord, phase A — @mention her and she answers — ✅ BUILT 2026-08-17, SHIPPED OFF

Owner (2026-08-17, verbatim): *"I want to use heygabi and similar forms like Hey
Gabi, hey @Gabi, heyGabi etc to kick her off for a question and then she
responds."*

Live at Worker version `fa8140f6-da59-4f0d-b918-0f6a6f7777a7`, commits
`74d6bd3` (the build) and `cfe768b` (the deploy's corrections). As-built design:
[`info/discord-bot-design.md` §6](info/discord-bot-design.md).

**⚠️ The measurement the whole thing rests on.** Answering ordinary chat sounds
exactly like the thing §1.5 refuses — Discord's Message Content privileged
intent. It is not, and this was read off Discord's own docs rather than assumed:
the intent blanks `content` **except** for four cases, one being *"Content in
which the app is mentioned"*
(<https://docs.discord.com/developers/events/gateway>). So the exact messages
this build answers are the exact messages whose content still arrives, on the
unprivileged `GUILDS | GUILD_MESSAGES` (513) intents alone. Bare-text triggers
(`heygabi …` with no `@`) would need the intent and are left as an explicit
owner decision (§6.8).

**What shipped.** A `GabiGateway` Durable Object holding one outbound WebSocket
(heartbeat with the documented jitter, RESUME with a stored session, the full
close-code table, a 30-second self-heal alarm); a strict mention test; a
laddered intent router; and one reply per mention, addressed to the asker.

**⚠️ The ladder is the point:** with `ANTHROPIC_API_KEY_GABI` (a NEW secret,
deliberately separate from the library's key) one cheap `claude-haiku-4-5` turn
classifies intent and another answers chat; **without it** a keyword router
still answers lookups and still deep-links fix requests to the panel. A missing
key never produces an error message in a channel — it logs a worded line.

**Guardrails.** `GABI_MENTIONS` affirmative-only and shipped `"off"`, where OFF
means **no WebSocket is ever opened** rather than "open but quiet". Caps of 20
answered mentions/person/hour and 200/day estate-wide, with the fuse blowing
*before* anything that costs and a worded refusal saying it is GABI's cap and
not something the asker did. `GABI_MENTION_ACTIONS` is an explicit four-item
array pinned by a test, and a second test greps the flow for write/moderation/
admin verbs — **there is no write path to guard.** `allowed_mentions` is
`parse: []` plus the one asker, so nothing the model writes can make the bot
ping `@everyone`.

**⚠️ THE DEPLOY CORRECTED TWO THINGS THE DESIGN HAD WRONG.**

1. **This Cloudflare account is on Workers FREE, not Paid** — proved by the
   deploy refusing the cron: *"This account has reached the Workers Free limit
   of 5 cron triggers per account."* The cost model changed shape entirely.
   Corrected: an always-on outbound WebSocket cannot hibernate and accrues
   ~10,800 GB-s/day against a free allowance of **13,000 GB-s/day** — **$0.00 a
   month, and ~83% of a cap that STOPS the object rather than billing for it.**
   ⚠️ A second always-on Durable Object anywhere on this account would break it.
2. **The cron could not exist**, so the planned second poker is gone and
   `POST /admin/gateway/start` is the only starter. The `[triggers]` block was
   removed rather than left failing — a wrangler.toml that cannot fully apply
   makes every future deploy exit with a partial-failure banner, which is a
   booby trap for whoever deploys next. A test now asserts the *absence* of a
   cron and explains why. The `scheduled` handler stays wired; restoring the
   redundancy is one line the day a trigger frees up or the account upgrades.

**Two defects found by running it rather than reading it.** `hey @GABI, do we
have X?` left the word "hey" in the search term, because stripping the mention
removes the "gabi" the greeting pattern was anchored on. And the gateway
sequence number was written to Durable Object storage on **every frame** — one
row write per message in every channel of every guild, against a
100,000-rows/day free ceiling, for a value only ever read after an eviction. It
is now persisted once per heartbeat, at the stated cost of a resume replaying
from a seq up to one heartbeat stale.

**Verified live after deploy:** `/api/health` answers with every pre-existing
row intact plus the new `gabi_mentions_*` rows, and `POST /interactions` still
answers **401** to both a bad signature and missing signature headers — the
behaviour Discord probes for and silently drops the endpoint over. 219 tests
pass; typecheck clean on both projects.

**⚠️ NOT VERIFIED, and named rather than glossed:** nothing in this build has
ever talked to Discord's gateway. The local `.dev.vars` drop-box is correctly
blank so no agent holds the bot token, and the start route needs an estate
admin's Firebase ID token which no agent holds either — so the READY handshake,
the mention-content claim, the persona, the caps and the reply shape are all
unexercised against reality. No model call has ever been made on this surface;
the cents figures are arithmetic over a published price table. The owner steps
that close this are in [`TODO.md`](TODO.md).

## 🪜 Admin page: Audiobooks/Ebooks ladder rendered HIGH → LOW — ✅ BUILT 2026-08-17

Owner (2026-08-17, verbatim): *"on the estate page audiobook permissions starts
guest to admin, the rest of the sites start owner/admin down. so one site is
lowest to high and the rest are high to low. can you make audiobook/ebook high
to low?"*

Two display surfaces in `sites/heygabi-home/public/admin/admin.js` rendered the
auth Worker's cumulative (lowest-first) ordering directly, while the app rows
render their Workers' highest-first lists — the inconsistency he saw:

- **the role dropdown** (`roleCell`): now `[...grantable].reverse()` with
  `'none'` closing the list (it sits beneath every rung);
- **the permission map's Audiobooks/Ebooks ladder** (`audiobookLadder`): rows
  now iterate `capabilities` reversed.

Display-only in both places — nothing re-stored, wire order untouched, server
`canGrant` enforcement unaffected.

*(Moved whole from `TODO.md`'s "Series registry — what still hangs off it",
item 3: "**Resolve `entry.universe` from the CANONICAL series display**, not
from the source's spelling. Push-time universe resolution still reads the raw
string (deliberately unchanged this pass — re-pointing a join deserves its own
verification). Once done, `universes.json` can list ONE spelling per series
instead of every variant. Needs: a re-push of all sources, and a before/after
count of rows carrying a universe. Size S, but measure it.")*

Commits `5f389f3`, `4fdfe48`. Worker version
`0dfc1c08-4546-46f6-b8b8-6b4eb6d7a2a9` (superseding `8524fd40`, which carried
the first, weaker rule for eleven minutes). Design, with every refusal:
[`info/index-worker-design.md` §8.5.1](info/index-worker-design.md).

**The problem in one sentence:** `universes.json` lists each series in ONE
spelling ("The Stormlight Archive") and `normaliseUniverseText` keeps leading
articles **on purpose**, so a source pushing any other spelling missed the join
entirely — one book, Cosmere on the audiobook shelf and no universe at all on
the library shelf.

**As built.** `entryFor` still resolves from the pushed spelling first. A row
that comes back with nothing is then asked again with every OTHER spelling of
its series **in the same snapshot** — canonical first, the rest sorted. Every
attempt is the same EXACT `universeFor` lookup on a string a source really
pushed: nothing folded, nothing guessed, the pushed answer never overridden
(so no row can LOSE a universe), exclusions untouchable (`universeFor` refuses
by TITLE before it looks at a series), and a near miss lending nothing (it has
its own slug, so it is never one of the spellings tried). Two spellings that
answer with different universes: the row's own spelling wins and the row is
**counted as a conflict with samples** — one series in two universes is a fault
in the list, and picking a winner would hide it.

### ⚠️ The canonical display alone was NOT enough — the live probe found it

The first version asked only with the canonical display, and it was wrong in a
way no amount of reading would have shown: the canonical is **"first writer
wins" in fold order**, so it is just as likely to BE the spelling
`universes.json` does not list. "Stormlight Archive" sorts before "The
Stormlight Archive". Probe B17 pushed both spellings in one snapshot, expected
a gain, and got zero — the series ended up holding rows with two different
answers, which is the exact failure the change existed to end. Fixed by asking
with every sibling spelling; the case is pinned in the unit suite too.

### ⚠️ The 207-row near miss: why the backfill REPORTS and never writes

`scripts/backfill-universe.ts` (dry run by default, prints its SQL, additive
only) re-runs the join over rows already in D1. Its sibling diagnostic — rows
in a series where a sibling row DOES carry a universe — was very nearly a
writer. Against the real index it would have written **207 rows: 108 D&D games
into Middle-earth** (one LOTR-branded D&D product), **76 Dice Throne boxes into
Marvel**, 22 Ascension, 1 Little Golden Book. Every one is a crossover product,
not a universe member. It resolves MORE than the push does — a sibling's
universe may have come from a bookOverride TITLE — so the next snapshot replace
would have recomputed them NULL and silently undone it, which is design §1's
drift class rebuilt by hand. It prints them instead and names the honest fix:
an edit to `data/universes.json`.

### Also landed: the confirm queue announces itself

`GET /api/series` now carries `pending_open`, a sentence ("Nothing was merged —
these series stay separate until you resolve them") and the queue URL — **for
approvers only, and ABSENT rather than zeroed for everyone else**, because a
count of near misses spans every catalog. The registry's first real row sat
invisible because nothing in a browser called `/api/series/pending`. ⚠️ The
PAGE half is still open and stays in `TODO.md` item 1: this is a `sites/`
change plus a Pages deploy, and the index-worker pass deliberately did not
reach across.

### Measured

| | |
|---|---|
| Live index, dry run, remote | 2,434 rows / **445 carry a universe** / **0 would change** |
| Stored universe ≠ today's lookup | 0 |
| One series naming two universes | 0 |
| Unit suite | 129 in the index worker (was 119); full workspace 733, all green |
| Live probes | **21/21** (`npm run probe`), B16–B18 new |
| Mutation-proved | disabling the second attempt kills 2 tests; letting it override the pushed answer kills 2; dropping the approver check kills 1 |

**0 rows would change is the honest headline**, and it is the registry's own
result again: the estate's spellings had already been straightened by the
series canon and the audiobook corrections layer, so this is **PREVENTATIVE** —
it makes the split structurally impossible rather than cleaning up a mess that
was still there.

**NOT verified.** No source has re-pushed since the deploy, so
`gained_from_registry` has never been non-zero on the live Worker (it is
exercised on a real runtime by probe B17, against local D1). The approver badge
has never been seen by a signed-in browser — no agent holds an owner ID token;
it is verified by probe B16 through the real route and by the unit suite.
`universes.json` was not edited, and the D&D/Dice Throne/Ascension question
above is left as evidence, not a change.

## 📖 Ebook viewer phase 1a — the gated byte stream — ✅ BUILT + DEPLOYED 2026-08-17

**New entry** (no TODO section existed here — the viewer is queued in
`library_catalog/docs/TODO.md`, and only its Worker half lives in this repo).
Commits `653f2a6` + `65d7ff8`, Worker version
`41206de4-b5b8-41f6-af30-76fc482cde05`, 190 tests green. Full as-built record,
with every measurement and a blunt NOT-VERIFIED list:
[`info/ebook-viewer-phase1.md`](info/ebook-viewer-phase1.md). Design:
`library_catalog/docs/info/ebook-viewer-design.md`.

### As built

- **`GET|HEAD /api/ebook/:anchor/file`** — the R2 body passed through
  **unbuffered**. Three files exceed the 128 MiB isolate limit and the White
  Sand Omnibus exceeds it threefold, so `arrayBuffer()` here is an OOM, not a
  slow request.
- **Range honoured honestly**: 206 with `Content-Range`, 416 (with
  `bytes */size`) for understood-but-unsatisfiable, and **malformed or
  multi-range IGNORED into a 200** rather than refused — different facts about
  the request, kept apart.
- **`Accept-Ranges: bytes` and `private, max-age=0, no-store` on EVERY answer,
  refusals included.** pdf.js decides whether to range-stream from the first
  response it sees, and the edge cache knows nothing about a bearer.
- **`[[r2_buckets]] EBOOKS`** → `estate-ebooks` (public access disabled, no
  custom domain). ⚠️ `ESTATE_CHECK` untouched, still `"shadow"`.
- **One gate, shared with the shelf** (`ebook-gate.ts`), so the two cannot
  disagree about who is admitted.
- **A reading budget on BOOKS, not requests** — ranges within an open book are
  uncapped, because a page turn is several GETs and a per-request cap would
  throttle reading rather than scraping.

### The three findings worth keeping

1. ⚠️ **The stream gates on `vis_ebooks`, never on `download`** (floor
   `admin`). A comment in `ebooks.ts` told the next agent to do the opposite;
   following it would have shipped a viewer nobody below `admin` could use. The
   comment is corrected and a test now pins the rule.
2. ⚠️ **Extraction does not inherit the caller's header contract.** Moving the
   gate into a shared module made the byte stream's 401 go out bare — 189 unit
   tests passed because they asserted those headers only on the 429. Found by
   curling the live deploy; the fix dresses the answer at the caller and a new
   test walks all six refusal paths.
3. ⚠️ **`anchor → path` reads the GATED manifest**, not the public
   `ebooks.json` the design assumed — that file left the internet the same day.
   Strictly better: shelf and reader resolve a book from one byte-identical
   source, with no subrequest.

## 🤖 `/gabi` — the fixer's Discord surface, shape (b) — ✅ BUILT + DEPLOYED 2026-08-17

**Moved whole from [`TODO.md`](TODO.md) §0 item 3 at completion.** Commit
`4715b03`, Worker version `03bd6a3a-7f05-4fbe-a846-05bc614f97e6`, 180 tests
green. Runbook: [`access/discord-bot.md` §10](access/discord-bot.md); design:
`library_catalog/docs/info/gabi-fixer-design.md` §10.2.

### As built

- **`/gabi <question>`** in `BASE_COMMANDS`, routed by `GABI_COMMAND_NAME`,
  answered with the **deferred-ephemeral** idiom `/have` established (Discord's
  3-second window acked, 15 minutes to fill it in).
- **`apps/discord-worker/src/gabi.ts`** — a best-effort nibble from the index's
  **public slice**, reusing `/have`'s own `lookupHave` rather than copying it
  (same URL builder, same explicit `source` narrowing, same
  no-Authorization-header decision), plus the deep link into the real GABI
  panel at `https://padhard.heygabi.ai/`.
- **A three-valued link state**, deliberately NOT `/have`'s boolean
  `isLinked()`: there a failed read changes a scope footnote, here it would
  tell an already-linked person to run `/link`. An unperformed read answers
  `unknown` and the message says nothing about linking at all.
- **`/api/health` gains `gabi_surface` and `gabi_panel_url`**, so the shape and
  the link are checkable in one curl. ⚠️ `gabi_surface` reading anything but
  `propose_and_deep_link` means somebody answered the token-custody question.

### What it deliberately does not do — the whole justification

**No write anywhere, no model call, no new secret.** The only new binding is
`GABI_PANEL_URL`, a public hostname in `[vars]`. A test asserts the flow makes
**exactly two requests** — a GET to the index and the PATCH that edits the
deferred message — so a future model call or Firestore write cannot slip in
while every other test still passes. That is what let shape (b) ship with **all
four of the design's blockers still unsolved**.

### Two decisions worth finding later

1. ⚠️ **The deep link carries no `?q=`, and that is MEASURED.** Read 2026-08-17
   in `library_catalog/apps/web`: `App.tsx` holds the panel open in
   `useState(false)` and `GabiPanel.tsx` parses no location. A parameter would
   be a link that silently lies about carrying the question, so the question is
   quoted back for copy-paste instead. A prefill is **panel work**, filed as a
   follow-up in the design doc — `panelDeepLink()` is the one function to change
   if it lands.
2. ⚠️ **The answer never promises the panel will open.** The bot can determine
   whether a Discord account is LINKED; it cannot resolve whether that identity
   holds `runResearch` on her instance — blocker 1, the roles live in the
   library's own D1 with no path from Firestore — and the wording says exactly
   that, rather than implying a door that may be locked.

### Left for the conductor/owner

🧑 **Publish the registry** — `POST /admin/commands/register` from the `/admin`
page with an estate admin's own bearer. ⚠️ **`/gabi` does not exist in Discord
until someone does**, and no agent holds the token. One click, idempotent for a
given `MODERATION_ENABLED` state.

### NOT verified

`access/discord-bot.md` §10.5 carries the list. In short: the command has never
been invoked from Discord (unpublished), nobody has followed the deep link end
to end, and it has not been observed what a linked *stranger* sees on
`padhard` — the honest expectation is the library without the panel, because
`ESTATE_DEFAULT_ROLE` is unset there and `member` does not hold `runResearch`.
Exercised live this deploy: the index hop (200, real rows), the panel host
(200, `gabi.panel: true`), and `/interactions` still 401ing both an unsigned
POST and a bad signature.

### The item as it stood in TODO.md, moved whole

Queue (items 1 and 2 — `/have` and moderation — landed 2026-08-17 and moved
whole to `DONE.md`; item 3's numbering is kept so the archive's references
stay true). Dispatch as OPUS agents per the model-tiering rule:

3. ⚠️ **THE FIXER'S DISCORD SURFACE — THIS QUEUE'S NEXT-AFTER ITEM, promoted
   2026-08-17.** No longer a design seed: the fixer's **phase 0 shipped that
   day** on `padhard.heygabi.ai` (read-only conversational GABI, site chat
   panel), and the owner settled the surface order in the same breath —
   *"we can do discord right after"*. So a Discord DM front end is the next
   thing after the panel, **ahead of the library's own write phases**.

   The design is `library_catalog/docs/info/gabi-fixer-design.md` — §10 is the
   three-way split, §13 is the file map. What matters for THIS repo:

   - **Two of the three parts already exist and are front-end-agnostic**: the
     tool allowlist (`@lc/core`'s `GABI_TOOLS`) and the key-holding, spend-gated
     `POST /api/gabi/turn` on her Worker. Both are shipped and neither needs
     changing. **What a Discord surface must write is the EXECUTOR** — the one
     part that is per-front-end — and that is genuinely the whole difference.
   - ⚠️ **§10.2's four blockers are UNCHANGED and phase 0 solved none of them:**
     no `app_user` join (the link maps a Discord id to a club slug + firebaseUid
     in **Firestore**, which her library Worker cannot read — no service
     account, deliberately), **no token-custody answer** (minting a Firebase
     token *as her* from the discord-worker's service account is precisely the
     "actor that is not her, writing as her" the design refuses), no
     deferred-response path, and no persisted conversation state — the browser
     tab provides that last one for free, which is exactly why the panel did not
     have to build it.
   - ✅ **Start at shape (b): the bot READS and PROPOSES, and every write is a
     deep link back to her site panel to confirm.** It needs none of the four,
     no new auth and no new credential, and it is the honest version of "her
     authority" — she is still the one who acts. Shape (a), a per-user scoped
     library token, is real work and access-increasing; shape (c), a service
     account, is **refused**.
   - The library-side prerequisites are already true: her role is `admin`
     (measured), the turn route is live, and the accounting table records every
     turn on both instances.

## 🧭 Admin page: ONE control grammar + the FULL PERMISSION MAP — ✅ BUILT + DEPLOYED 2026-08-17

**Owner order, verbatim:** *"auth setting has too many different auth setting
experiences, sometimes we double click to confirm sometimes we use the drop
down. also at the top we have a tree for audio and ebooks but not one for the
other sites. maybe just make a full permission map after normalizing
everything."*

**And, mid-build, from the live page (this settled the shape):** *"how come
only audiobooks and ebooks have set role? I thought we were normalizing this.
either they all have set role for each site or none. I think you should do a
confirm/save button and no set role button for each role. have the save button
appear on each persons box when a change is made."* — plus: *"what is this
download: admin + role tag it looks bad and idk what its trying to tell me."*

⚠️ **Amends the entry below** (the merged Audiobooks/Ebooks row, same day):
its two checkboxes + one dropdown + download-note semantics all survive, but
they now live INSIDE the permission grid, and the note itself is gone — its
fact moved into the derived capability line. Where they describe the admin
page's layout or its controls, this entry wins.

### The before-state, measured (four gestures for one job)

1. visibility checkbox — **wrote on `change`**, instantly, no confirmation;
2. library / games / Sam's-library role dropdowns — **wrote on `change`**, and
   announced success by *clearing* the status line (i.e. silently);
3. audiobook role dropdown — **staged**, then needed a two-tap **"Set role"**
   button that no other row had;
4. estate status buttons — **one tap for Approve**, two taps for Revoke,
   approver and devops.

Plus: a role-ladder "tree" at the top for the audiobook/ebooks site and none
for the other three; four differently-worded per-site filter sections; and a
standalone `download: admin+ role` tag hanging off one row.

### The grammar now (one page, two gestures)

- **GRANT-class** (every `visible` box, every site's role dropdown — all four
  sites identically): touching it stages and writes nothing; the control is
  outlined; one **Save permissions** button *appears on that person's card*
  when anything changes, commits the lot, and reports in words. No per-row
  apply button anywhere. Per-card rather than per-row is forced by the API:
  `POST /visibility` takes the whole canonical set, so a per-row Save would
  silently commit another row's staged boxes.
- **STATUS-class** (Approve, Revoke, approver, devops): two taps, all of them —
  Approve lost its exception, since make-approver and make-devops are equally
  additive and have confirmed since 2026-08-15.
- **Not a control**: owner rank, a rung above your grant power, a site with no
  account row, an unreachable Worker — all render as words naming the cause,
  never a disabled dropdown.

### The permission map

Each member expands to a grid with one row per site and the same four columns
on every row — **site · visible · role · what that role can do** — deliberately
the anatomy of `docs/info/role-capability-map.md`, rendered live. The derived
column reads per-rung summaries from `GET /api/estate/site-roles/tree` for
Audiobooks/Ebooks and the map doc's one-line rung meanings for the app sites,
and it is where the ebook `download` floor (`admin`) is now stated. The
disclosure at the top of the page became **"Permission map — every site's
ladder"**: one subsection per site, same order, same names, each degrading on
its own. The four per-site role filters became one symmetric "Role, per site"
section (ids and `ROLE_FILTER_KEYS` untouched — they are persisted vocabulary),
and the chips were reordered to the grid's row order.

### Not one byte of the wire changed

Same four endpoints, same bodies, same canonical visibility array, same
per-app vocabularies, no API contract touched. **No CSP change was needed** —
measured: `_headers` already names library/boardgames/padhard on both `/admin`
and `/admin/`.

### Verified / not verified

- Exercised, not reasoned about: a 34-check stub-DOM harness drove the real
  module (render, staging, per-card save, a REFUSED save, sign-out) — it caught
  a real bug before ship (the owner-fact tooltip promised auto-correction on
  app rows, where nothing corrects them; only the audiobook ladder is
  reconciled).
- Markers rebuilt honestly for both `/admin/` and `/admin/admin.js` and proven
  discriminating: **HEAD would fail 25 of them**.
- ⚠️ **NOT verified: the signed-in rendered table.** Every marker is
  unauthenticated chrome. The grid with real people, the Save, and the four
  live ladders can only be checked by signing in.

## 🔗 Admin page: Audiobooks and Ebooks become ONE row — ✅ BUILT + DEPLOYED 2026-08-17

**Owner order, verbatim:** *"instead of a new line for ebooks in the auth page,
just make it Audiobook/Ebooks. also they should both be plural."*

⚠️ **Amends the two entries below, both from the same day** — the ebooks gate
gave Ebooks a row of its own, and the download rework left that row carrying a
note that pointed UP at the audiobook role a line above it. Neither is wrong
about the *grants*; this is the row those grants are drawn on. Where they
describe the admin page's LAYOUT, this entry wins.

### The shape

Audiobooks and Ebooks are ONE surface — the same site, the same `site_roles`
ladder, and ebook visibility is just a second grant on it. Two rows described
one thing, which meant two places to look for one answer and a note whose job
was to send the reader from one to the other. So: one line reading
**Audiobooks/Ebooks**, carrying

- **two visibility checkboxes**, labelled *Audiobooks visible* and *Ebooks
  visible* (`vis_audiobook` / `vis_ebooks` — still two independent grants, still
  the same wire, still posted as §4.5's canonical whole-array set),
- **one role dropdown** — the audiobook site-roles ladder, which is the only
  ladder either shelf has ever had,
- **the download note**, now reading `download: admin+ role`. It shortened
  because the role it names is an inch to its left instead of a row up: the
  direction was half the old sentence and is now noise.

Owner rows keep the no-editable-control idiom exactly as before (a fact, not a
dropdown); their visibility boxes render as they always have.

### The plural sweep

Display labels only — **no persisted key, `data-cat` value, filter id or site
vocabulary was renamed.** `CATALOG_LABELS` now reads `Audiobooks` / `Library` /
`Games` / `Sam's library` / `Ebooks`: `Ebooks` was already plural and
capitalised, so the rest came into line with it rather than the reverse.
`Library` stays singular — it names one shelf. The "Sees" chips, the
advanced-filters section title (**Audiobooks/Ebooks**, one section, because
there has never been a separate ebooks role filter and must not be) and the
role-ladder disclosure (**Audiobooks/Ebooks role ladder**) all follow. The two
visibility CHIPS stay two: "sees the audiobook shelf" and "sees the ebook shelf"
are still different questions.

### Found while in there

`reconcileOwnerRoles()` called `render()` — **a function that does not exist in
this module and never did.** It threw `ReferenceError` inside a `void`-ed async
call, so it failed silently: the status line announced that an owner's role had
been corrected while the cell went on showing the stale rung until a manual
refresh. Now `renderFilteredList()`, the repaint every other mutation uses.

### Markers

`predeploy.checks.json` moved with the page, both halves:

| | mustContain | mustNotContain |
|---|---|---|
| `/admin/` | `Audiobooks/Ebooks`, `Audiobooks/Ebooks role ladder`, `id="f-role-audiobook"` | `>Audiobook</span>`, `Audiobook role ladder` |
| `/admin/admin.js` | `MERGED_ROW`, `downloadNoteCell`, `download: admin+ role` | `downloadEbooksCell`, `download: admin on the audiobook role above` |

Proved discriminating before shipping, by running the new marker set against the
**pre-merge** files from `HEAD`: **9 failures** (4 missing, 5 still-carried).
A stale bundle serving a cheerful 200 is detected, which is the whole point of
the `mustNotContain` half the download rework added.

⚠️ **NOT verified by this build: the rendered signed-in table.** Every member
row is injected after Firebase sign-in, so an unauthenticated fetch can only
prove the chrome shipped. **The merged row itself needs the owner's eyes** at
<https://heygabi.ai/admin/>.

## 📥 Ebook DOWNLOAD becomes a ROLE, not a checkbox — ✅ BUILT + DEPLOYED 2026-08-17

**Owner directive, verbatim:** *"For ebooks I don't want a download check box,
I want to use roles we have. Set up the roles to match library."*

⚠️ **This SUPERSEDES the `dl_ebooks` half of the ebooks-gate entry below, which
landed the same day.** That entry is left exactly as written — this archive is
append-only, and the fact that a design lasted one day is itself the record.
Read this entry first; where the two disagree about downloads, this one wins.
The **view** half of that entry (`vis_ebooks`, migration 0008) is UNCHANGED and
still current.

### The shape

Downloading an ebook file stopped being a per-person estate grant and became a
rung on the audiobook site's capability ladder — the pattern the directive names
by "match library" (`library_catalog` `@lc/core` `capabilitiesFor`).

| | Was (2026-08-16, one day) | Now |
|---|---|---|
| Grant | `dl_ebooks` column + a checkbox on the admin page's Ebooks row | `download` capability, floor **`admin`** |
| Granted by | ticking a box | **promoting** on the Audiobook role dropdown |
| Revoked by | un-ticking | demoting |
| Answered by | `download_ebooks` on `/estate/seen` + `/estate/me` | `can(role, 'download')` from the caller's `site_roles/{uid}` doc |

**Seeing the shelf did not change.** `vis_ebooks` still admits a person to the
shelf AND to reading in the browser viewer; the Ebooks row's `visible` checkbox
is untouched. The viewer design's two-capability decision (read vs download)
STANDS — only the grant mechanism for the second one moved.

### What was removed

- `download: 'member'` → `download: 'admin'` in audiobook-worker's §6 matrix
  (the `member` value was a phase-4 placeholder, never enforced by a live route)
- the admin page's **download toggle** — its cell is now a NOTE reading
  *"download: admin on the audiobook role above"*, so the row does not go
  silently blank where a control used to be
- `POST /estate/users/:id/download-ebooks` (route + zod schema)
- `setDownloadEbooks()` in `estate-db.ts`; `dl_ebooks` out of `COLS` and out of
  `EstateUserRow`
- `downloadEbooks()` + `download_ebooks` from the `/estate/me` answer, and
  `download_ebooks` / `download_ebooks_granted` from the admin `userJson`
- the **`downloadEbooks` wire field** from `packages/estate-auth` — `SeenAnswer`,
  `SeenCache`, `EstateCheckResult` and the `refresh` shape. Removed now rather
  than carried: it was null everywhere and no user-facing consumer had shipped
  against it, so this was the cheap moment.

### What was deliberately NOT removed

**The `dl_ebooks` COLUMN stays in D1**, unread. Dropping a column in SQLite/D1 is
a table rebuild — real risk on the live estate directory to reclaim one integer
per row — and a dropped column cannot be inspected later. Migration
`0010_dl_ebooks_deprecated.sql` is DDL-free and exists solely to record this in
the migration ledger, including the warning that must not be ignored: **do not
re-add `dl_ebooks` to `COLS` or `EstateUserRow`.** The column still holds `1` for
anyone ticked during its one-day life, so a SELECT that reached it again would
silently resurrect those grants.

### The two-repo ripple

`packages/estate-auth` is **build-synced** into `library_catalog` (its
`pretest`/`prebuild` copies the canonical module), and that repo's
`gate.test.ts` had been taught the `downloadEbooks` key hours earlier. Its
pinned `refresh` shapes were returned to their pre-field form
(`{status, visibility, checkedAt}`) **in the same push**, with a header comment
explaining the round trip so the three-key shape does not read as a test that
forgot an update.

### Verification

- catalog-platform: **665 tests pass**, typecheck clean across every workspace
- library_catalog: **full `npm test` green** (pretest re-synced the module first,
  so the vocabulary change flowed through), typecheck clean
- new guard tests, each pinning the decision rather than the mechanics:
  `capabilities.test.ts` — the `admin` floor, and that the club island confers
  no download; `ebooks.test.ts` — *a /seen answer still sending
  `download_ebooks: true` grants nothing*; `seen.test.ts` + `me.test.ts` — the
  field's ABSENCE from the wire and from `/me`'s every branch
- `predeploy-check.mjs` gained **`mustNotContain`**: a removal needs a marker
  too, or a stale bundle still carrying the old checkbox satisfies every
  `mustContain` and looks like a successful deploy

## 🔀 The MANAGECLUB SPLIT — read lifecycle to manager-or-moderator — ✅ BUILT + DEPLOYED + SMOKE-VERIFIED 2026-08-17

**Owner decision, option B verbatim:** read-lifecycle actions (finishing a
read, removing one, revealing ratings) go to MANAGER-OR-MODERATOR like the
webhook split did; genuinely destructive actions (deleting a club, structural
edits) STAY admin-only.

**The line is "running the reading" vs "destroying the thing"** — not
"club-scoped vs site-wide". That is the sentence to keep; every detail below
follows from it.

### What moved

| Action | Was | Now |
|---|---|---|
| `read.finish` | `cap('manageClub', true)` | `cap('operateClub', true)` |
| `read.remove` | `cap('manageClub', true)` | `cap('operateClub', true)` |
| `read.revealRatings` | `cap('manageClub', true)` | `cap('operateClub', true)` |
| `club.delete` | `cap('manageClub', true)` | **unchanged** |
| `club.updateStructural` | `cap('manageClub', true)` | **unchanged** |

`operateClub` is floor `moderator` and island-held, so `clubCan()` resolves
`cap('operateClub', true)` as exactly **manager-of-THIS-club OR site
moderator+** — verified against `capabilities.ts` before building, and the
same class every other `club.*` row already sat on.

⚠️ **The worker delta is the MODERATOR arm alone, and this is the part worth
remembering.** A bound club manager could ALWAYS finish/remove/reveal on their
own club, because `manageClub` is in `CLUB_MANAGER_CAPABILITIES` — the island
already carried it. What was refused was the site moderator, by `manageClub`'s
admin floor. So in the worker this is a widening for moderators and a no-op
for managers; the change a PERSON notices is in `firestore.rules` and the UI.

### The live gate (audiobook_catalog `f3f0a3f`, rules deployed)

Read-doc field tiers went from two to three. `status`, `finishedAt`,
`ratingsRevealed`, `revealedAt` left `readStructuralFieldsChanged` for a new
`readLifecycleFieldsChanged` on `canOperateClub`; the reads `allow delete`
moved the same way. Both lanes. Its old comment — *"Deliberately NOT
canOperateClub: read deletes are structural"* — is precisely what option B
overruled.

⚠️ **`slot` stayed behind on `canManageClub`, measured not assumed.** Nothing
UPDATES it: `startRead` stamps it at create (an open member action) and
finish/remove edit the CLUB's `activeSlots` array instead. So that tier now
guards re-slotting an existing read, which no client does.

### The UI, and the bug the split exposed

The Finish/Abandon/Remove block and the ratings Reveal button were gated on
`isMod()` — display-name host/mod **plus the site admin**. That was wrong in
BOTH directions: it drew three buttons for a display-name host whose Google
account was never secured (rules refuse them), and it hid the controls from a
site moderator rules now admits. Both now use the webhook field's idiom: a UI
precondition AND the rules mirror, with a **worded refusal** in between rather
than a control that fails. `club-read.html` resolves `getLiveUser()` for the
island check, which it never needed before.

`removeRead`'s permission error carried no `need` at all, so a refusal read as
a bare "you don't have permission" with nothing to act on. All three now name
*this club's manager role, or the site moderator role*.

### Verified

- **36/36 REST smoke assertions** against the **deployed** rules
  (`audiobook_catalog/scripts/smoke_club_manager_rules.py`), including the
  site-moderator override on a club they do not manage, and the guard that
  slot / joinMode / **the club delete** all still refuse a moderator. Cleanup
  verified independently afterwards (no scratch club, read, role doc or
  synthetic user left).
- worker `150/150`; audiobook vitest `569/569`; audiobook pytest `1076
  passed`; flake8 `0` under the repo's own CI flags.
- worker deployed, **still `ESTATE_CHECK = "shadow"`** — version
  `fc7450f4-8537-4358-acb8-e903610ebc01`. The gate acts on nothing; this only
  changes what the shadow log SAYS it would do.

### ⚠️ Two ways the smoke script was lying, found by running it

1. **A crashed run inverted the next one.** The first attempt died mid-way and
   left `site_roles/zz-clubmgr-smoke-b = moderator` behind. On the re-run B
   therefore passed the ROSTER gate, claimed the club, became a bound manager,
   and **sixteen "B is refused" assertions came back 200** — not one meaning
   what it said. The clean slate now deletes the synthetic role docs up front.
2. **The kill was a `print()`.** A `⚠️` in printed output raises
   `UnicodeEncodeError` on this Windows cp1252 console — after the scratch data
   is created and before cleanup. That is *how* (1) happened.
3. A third assertion was **vacuous**: it re-wrote `joinMode` with the value the
   club already had. Rules gate on `diff().affectedKeys()`, so a no-op write
   never reaches the gate and returns 200 — indistinguishable from a permitted
   one, in the one direction where it matters.

### What rides the next promote

The site half (`site/club.html`, `site/club-read.html`, `site/clubs.js`,
`site/club-reads.js`) is on `main` → `/dev/` only. ⚠️ **Until an owner-worded
promote, prod's club UI still gates these controls on `isMod()`** — the RULES
are project-wide and already permit the moderator, so prod is currently
stricter in the UI than the gate behind it. That is the safe direction, but it
means a site moderator sees no Finish/Remove/Reveal on prod yet.

## 🔒 Revocation should clear the flags, not just the status (audit finding, 2026-08-16)

*Landed here 2026-08-17 by the docs hygiene sweep — the "what is left" half SHIPPED the same day it was written and the section never moved. VERIFIED in the tree 2026-08-17: `apps/auth-worker/src/estate-db.ts:128` appends `, is_approver = 0, is_devops = 0` to the revoke UPDATE, and `migrations/0006_revoke_clears_powers.sql` exists for rows revoked earlier (the 2026-08-16 handoff records it applied `--remote`, 0 rows, deployed as `43a26680`). The re-approval question the item raised is answered by construction — the flags are cleared AT REVOKE and the approve path never sets them — though nobody has exercised a revoke→re-approve round trip against the live directory.*


**Found by the testing audit** ("useful test not just bulk") and **half-fixed
the same day.** `decideStatus()` revokes by setting `status = 'revoked'` and
deliberately leaves `is_approver` / `is_devops` untouched. That was survivable
only because both gates now check status — but it means the *flag outlives the
status*, and every future reader of that row has to remember the gate is what
saves them.

⚠️ **The gate fix already shipped** (`middleware/auth.ts`, `approverAllows()` /
`devopsAllows()`, both requiring `status === 'approved'`, 14 tests in
`test/gates.test.ts`, deployed as version `d043a337`). This item is the
**defence in depth**, not the fix.

**What is left:** clear `is_approver` and `is_devops` in the same statement
that sets `status='revoked'`, so a revoked row carries no live-looking
privilege at all. Also decide the re-approval story — restoring someone should
NOT silently hand back an approver flag they used to have, which is exactly the
access-*increasing* direction the global rules say to confirm rather than
assume.

**Why it is filed rather than done:** it changes stored data and wants a
migration for existing rows, and the risk is asymmetric — a bad UPDATE here
strips real people's access. Small, but it needs its own careful pass.

**Verification when it is built:** the live directory currently holds 3 flagged
accounts, all `approved` (both owners + Justin), and 0 revoked — so a migration
touches nothing today. Re-check that before running it, not after.

## 1. ⚠️ Three of the four repos deploy only from a human's laptop

*Landed here 2026-08-17 by the docs hygiene sweep — the whole section, §1.5's "Owner checklist (nothing deploys until these exist)" included, is spent. MEASURED 2026-08-17 with `gh`: Board_Game_Catalog's default branch is now **`main`** (checklist item 0); `CLOUDFLARE_API_TOKEN` **and** `CATALOG_PLATFORM_TOKEN` are set on `library_catalog` and `Board_Game_Catalog`, and `CLOUDFLARE_API_TOKEN` on `catalog-platform` (items 1–3); and the first real dispatches all SUCCEEDED (items 4) — library run `31813866238`, games `31814054897`, catalog-platform `31900792359` and `31940834851`. ⚠️ Two facts inside the moved text went stale and are corrected here rather than edited above: the per-repo table's "reaches production by hand" column no longer holds, and §1's "Former open questions" says `library_catalog` and `catalog-platform` are PRIVATE — measured 2026-08-17, **all four repos are PUBLIC**, so the metered-minutes reasoning built on that line no longer applies anywhere.*


**Raised by the owner 2026-08-12**, immediately after a manual
`npm run deploy` of `library_catalog`: *"i dont think board games has one
either, add a todo in catalog platform to look into deploying these apps."*

Correct, and it is worse than "no CI" — it is a **single point of failure that
is a person at a specific machine.**

### What is actually true (measured 2026-08-12)

| Repo | `.github/workflows` | How it reaches production |
|---|---|---|
| `bookbuddy/audiobook_catalog` | ✅ 7 workflows — `deploy`, `promote`, `auto-promote`, `lint`, `tests`, `club-notify`, `cw-fulfill` | Push to `main` → deploy → `/dev/`; a separate **Promote to Prod** dispatch publishes the root |
| `bookbuddy/library_catalog` | ✅ `deploy.yml` (manual dispatch, 2026-08-14) | `npm run deploy` by hand, **or** Actions → Deploy Worker (manual) once secrets exist (§1.5) |
| `boardbuddy/Board_Game_Catalog` | ✅ `deploy.yml` (manual dispatch, 2026-08-14) | same as library |
| `catalog-platform` | ✅ `deploy.yml` (manual dispatch, target choice, 2026-08-14) | index-worker / auth-worker / heygabi-home / all — once secrets exist (§1.5) |

### 1.1 The two catalogs are structurally identical, which is the opportunity

They are not two problems. Every relevant script is the same shape:

| | `library_catalog` | `Board_Game_Catalog` |
|---|---|---|
| `predeploy` | `node scripts/check-clean.mjs` | `node scripts/check-clean.mjs` |
| `deploy` | `npm run build && npm run deploy --workspace @lc/worker` | `npm run build && npm run deploy --workspace @bgc/worker` |
| Target | Cloudflare Worker + D1 + R2 + `[assets]` | Cloudflare Worker + D1 + R2 + `[assets]` |

So **one workflow, parameterised by workspace name, covers both.** Whatever is
written for one should be written once and copied with a single string changed.

### 1.2 ⚠️ Do not copy the audiobook workflow wholesale

It is the only working example in the estate and it is tempting, but it encodes
a **two-lane deploy** (`main` → `/dev/`, an explicit promote → prod) that exists
because that site publishes a generated static catalog and needs a staging lane
for data. The two Workers have no such split — they deploy one artifact to one
custom domain. Copying the promote machinery would add a lane nobody asked for.

⚠️ Also learned the hard way on 2026-08-12: `Auto-promote books to prod`
**skipped** a commit that was a code fix rather than a catalog auto-update, so
the fix sat on `/dev/` looking deployed while prod was stale. Any lane split
must make "this did not reach prod" loud, not silent.

### 1.3 What a workflow has to preserve

These are guardrails the manual path currently provides, and a workflow that
drops them is worse than no workflow:

1. **`check-clean.mjs` refuses a dirty tree.** It exists because production in
   the Board Game Catalog twice ran code that was in no commit. CI is clean by
   construction, so the guard becomes free — but the *reason* must survive: the
   deployed artifact has to be a commit.
2. **Migrate before deploying**, so new code never meets an old schema.
   `library_catalog` has `db:migrate`; the ordering is currently a human
   remembering it.
3. ⚠️ **Wrangler on Windows sometimes prints success then exits non-zero** (a
   libuv teardown quirk). On Linux CI this stops being a problem — but do not
   port any `|| true` written to work around it, or a real failure goes green.
4. **Secrets.** A Cloudflare API token with Workers + D1 + R2 scope has to live
   in repo secrets. ⚠️ Neither repo has ever needed one, so this is new
   surface — and `audiobook_catalog` **must stay public** for unmetered Actions
   minutes, so think about whether these two should be public too before
   assuming the same budget applies.

### 1.4 Does `catalog-platform` need deploying at all?

Probably not, and that should be decided rather than defaulted. It has no
`deploy` script and no worker. What it does have is a **build-time dependency
edge**: `library_catalog`'s `prebuild`/`pretest`/`pretypecheck` fetch the shared
universe list from this repo and **fail loudly** if the checkout is missing
(`UNIVERSES.md`). So CI for `library_catalog` has to check out *two* repos, and
that is the real coupling to solve here — not a deploy.

### Former open questions — answered

- `Board_Game_Catalog` is **PUBLIC** (unmetered minutes); `library_catalog` and
  `catalog-platform` are **PRIVATE** (metered — fine for occasional manual
  deploys, revisit if usage grows).
- The owner decided **manual dispatch only** (2026-08-14): these Workers have no
  dev lane, so the trigger stays a deliberate human button-press. No push
  triggers, no schedules.

### 1.5 BUILT 2026-08-14 — workflows exist; owner actions remain before first use

`deploy.yml` in each of the three repos (manual `workflow_dispatch` only).
All preserve §1.3: check-clean still runs (not disabled), D1 migrate runs
**before** deploy, no `|| true` anywhere. The two catalog workflows check out
`catalog-platform` as a sibling and set `CATALOG_PLATFORM_DIR`. Each fails
early with instructions when a secret is missing (proven by a triggered run).
`CLOUDFLARE_ACCOUNT_ID` is already set as an Actions **variable** on all three
repos (it is not a secret). CI does **not** commit `docs/deploys.log` — the
workflow prints the line to append locally if wanted.

**Owner checklist (nothing deploys until these exist):**

0. ⚠️ **Board_Game_Catalog's default branch is still `phase-1-manual-catalog`**
   (a stale ancestor, 152 commits behind `main`) — GitHub only shows the
   dispatch button for workflows on the *default* branch, so the deploy
   workflow is invisible until this flips. Fix:
   `gh repo edit skymitch9/Board_Game_Catalog --default-branch main`
   (a session tried on 2026-08-14; repo-settings changes are permission-blocked
   for Claude, so this one is genuinely the owner's).
1. Create ONE Cloudflare API token at dash.cloudflare.com/profile/api-tokens:
   'Edit Cloudflare Workers' template **plus D1 edit + Cloudflare Pages: Edit**
   (Pages is for heygabi-home; the plain Workers template lacks it), account
   `113be82b840c956b8378a187047ab3ea`.
2. `gh secret set CLOUDFLARE_API_TOKEN --repo skymitch9/library_catalog`
   (repeat for `skymitch9/Board_Game_Catalog` and `skymitch9/catalog-platform`).
3. Create a fine-grained PAT (github.com/settings/personal-access-tokens) with
   **Contents: Read on skymitch9/catalog-platform** (it is private), then
   `gh secret set CATALOG_PLATFORM_TOKEN` on **library_catalog** and
   **Board_Game_Catalog** (catalog-platform's own workflow does not need it).
4. First real runs: dispatch from the Actions tab. For §2's pending pair,
   dispatch catalog-platform with `target=all` (or index-worker then
   heygabi-home — never heygabi-home alone first).

## 📌 HANDOFF — 2026-08-16 ~15:45 PDT (Opus → Fable)

*Landed here 2026-08-17 by the docs hygiene sweep: superseded by the 2026-08-17 work above (GABI phases 2/3, `/have`, dark moderation, the series registry and `/series`, the soak recorder). Its own "Next here" list is spent — item 1 nothing blocking, item 2 Discord bot LIVE, item 3 already self-corrected. The deploy table and the "things worth knowing" notes are kept whole here; their durable halves live in `access/backup-restore.md` and `info/estate-auth-design.md`.*


**Everything below the line is ACTIVE. What landed today is archived in
[`DONE.md`](DONE.md).** Nothing is in flight; the board is clear.

### Deployed today from this repo

| Worker / site | Version | What |
|---|---|---|
| `estate-auth` | `43a26680` | Revoked-approver gate fix; revocation clears `is_approver`/`is_devops` (migration **0006**, applied `--remote`, 0 rows); the Firestore ladder-role clear; owner rows render as facts |
| `catalog-index` | `befcce25` | ⚠️ `READ_ORIGINS` set explicitly — it was ABSENT, so `readCors` defaulted to the apex alone and **both catalogs were CORS-blocked** from the shared index |
| `heygabi-home` | `b41e1b03` | Status-page fixes (ebook row ×3, labelled Run levers, back arrows), backups graded per-store, `/admin` owner cells, predeploy guard |

### ⚠️ Things worth knowing before touching this repo

- **`npm run deploy:home` is now the routine** — it runs a static check (every
  public `.js` parses, every `.html` structurally sound, tree committed-clean),
  deploys, then fetches the live URLs and asserts each page still serves its own
  markers. `ALLOW_DIRTY_DEPLOY=1` is the deliberate escape hatch.
  ⚠️ `verify:home` fetches **signed out**, so a green run means the shell
  shipped, never that gated behaviour works.
- **Backups grade per STORE, not "newest object anywhere."** A partial
  `backup.yml` dispatch (target input) happened twice on 2026-08-15; under the
  old logic a database could go months unbacked while the row read green.
- **`skymitch9/estate-backups` (the REPO) was deleted 2026-08-16.** ⚠️ The **R2
  bucket of the same name is live and holds every backup** — do not confuse
  them. Backups verified landing that day: 5 runs ever, all successful, newest
  with all 8 store jobs green.
- **Two auth gates had no tests at all** until today; a mutation opened one and
  the whole 126-test suite still passed. `test/gates.test.ts` and
  `test/revoke-clears-powers.test.ts` now pin them. **176 tests.**

### Next here

1. Nothing is blocking. The reactive pipeline (audiobook_catalog) is the queued
   work; this repo is only involved if the status page needs a row for it.
2. **Discord bot** — design doc on file, needs the owner's decisions.
3. ~~Sub-item 1 — the apex `/universes` page~~ — ⚠️ **CORRECTED 2026-08-16:
   it is BUILT and LIVE** (heygabi.ai/universes, "tap one to see its books,
   audiobooks and games together... sourced live from the shared index").
   The previous line here said "still unbuilt" — written without checking,
   the exact mark-done failure recorded the same day. Both sub-items are done.

## 🔎 Search normalization — `<estate-search>` — ✅ BUILT AND ADOPTED ON EVERY SURFACE (2026-08-15 → 2026-08-17)

*Landed here 2026-08-17 by the docs hygiene sweep, moved whole out of `TODO.md`'s "Queued behind the Cosmere batch" (items 1 and 2 of that section are unbuilt and stayed). §0.5's adoption plan is now spent: apex ✅ (§0.3), library ✅ (`apps/web/public/estate/estate-search.js` + `SOURCE-estate-search.txt`, deploy recorded in `3cea4b7`), games ✅ (`32e2ddc`, then `fd1a9b3` "hide the estate search bar (owner order — keep, do not delete)"), audiobook ✅ (`f9e7422` "embed the shared `<estate-search>` component — the last estate surface without it"), `/universes` ✅. Every surface named in the plan has adopted it, so nothing here is queued work any more.*

0. **Search normalization (owner proposal, adopted)** — ✅ **PHASE 1 BUILT
   2026-08-15**: search improvements must reach EVERY search bar — today
   only the apex consumes the shared index, so tiers like universe-name
   search die at one site. §0.1–§0.4 below are the build record; §0.5 is the
   adoption plan for what's left, sized rather than assumed.

### 0.1 The component

`sites/heygabi-home/public/assets/estate-search.js` — `<estate-search>`, a
framework-agnostic custom element (Shadow DOM, no build step, `customElements
.define`), find.js's whole behavior turned configurable. Extraction was
verbatim where the logic was already tested by hand (ranking groups, keyboard
nav, the debounced-abortable query pattern, the sign-in flash fix) — nothing
about the search itself changed, only where it lives.

**Config — attributes (kebab-case), each mirrored by a same-name camelCase
property:**

| Attribute | Values | Default | Does |
|---|---|---|---|
| `index-url` | any origin | `https://index.heygabi.ai` | the index Worker to query |
| `source` | `all`\|`audiobook`\|`library`\|`game` | `all` | scope preset → `&source=` on `/api/search` (§0.2); NARROWS the caller's own visibility, never widens it |
| `auth` | `authless`\|`authed` | `authless` | authless: tokenless forever, zero Firebase cost, nothing imported. authed: find.js's neutral-boot/sign-in/bearer pattern |
| `auth-module` | a module path | sibling `estate-auth.js` (`import.meta.url`-relative) | where `auth="authed"` dynamically imports its adapter from — never a static import, so authless embeds pay nothing |
| `min-chars` | int | 2 | query length before a search fires |
| `debounce-ms` | int | 250 | debounce delay |
| `placeholder` / `placeholder-authed` | text | find.js's own copy | input placeholder, signed-out/authless vs signed-in |
| `sign-in-label` | text | "Sign in to search everything" | the sign-in button's text |
| `hint` | text | find.js's own copy | the helper line; pass `""` to hide it, omit the attribute to keep the default |
| `universes` | `true`\|`false` | `true` | show the cross-catalog "Universes" group + "everything in X →" follow-ups |

**Config — JS-only properties** (no attribute can carry a function/object):

- `.intakeFilter(data, { kind: 'search'|'universe' }) → data` — the per-site
  INTAKE FILTER hook: runs on every parsed response before render, so a host
  can narrow further (e.g. drop non-local entries out of a same-work group)
  without forking the component.
- `.authAdapter = { watchAuth, idToken, signIn, signOutUser,
  handleRedirectResult }` — set directly to skip the dynamic import (a React
  app that already has an estate-auth-shaped module loaded).

**Events** (`bubbles: true, composed: true` — cross the shadow boundary):

- `estate-search:auth` — `detail: { user, resolved }`, authed mode only.
- `estate-search:select` — `detail: { url, hit }`, **cancelable** — fires
  instead of the default `window.open(url, '_blank', 'noopener')` on any
  result open (click or Enter). `preventDefault()` to hand navigation to an
  SPA router instead — this is the hook library/games will need (§0.5).

**One extension point for opinions the component must NOT hold:** a light-DOM
child carrying `slot="who-extra"` inside `<estate-search>` renders after
"Signed in as … · sign out" in the signed-in state. The apex uses this for
its approver-only Admin chip (`assets/apex-admin-link.js` — the extracted,
unchanged probeApprover() logic) instead of teaching the shared component
what "Admin" is.

### 0.2 What the server gained

`apps/index-worker/src/search-route.ts`: `GET /api/search` accepts an
optional `source` param — `audiobook`\|`library`\|`game`\|`all` — that
INTERSECTS with the caller's own visibility from `searchScope()`, never
widens it. A stranger requesting `source=game` gets an honest empty (`scope:
[]`, no `reason` — this is not §4.5's account-level `no_catalogs_visible`,
it's "you asked for a shelf you cannot see", answered the same shape as a
zero-match query). An unrecognised value is `400 invalid_source`. The
response's `scope` field now reflects what was ACTUALLY searched after
narrowing, not the caller's raw visibility — universe counts inherit this for
free, same as before. 5 new tests in `test/search.test.ts` (narrows a full
scope; narrows-to-nothing outside visibility; `source=all` ≡ no param;
400 on garbage); **70/70 tests pass, typecheck clean.** Deployed with
`wrangler deploy` (index-worker) — no migration needed, additive query param
only.

### 0.3 Apex adoption — verified live

`sites/heygabi-home/public/index.html`'s `#find` section now embeds
`<estate-search id="find-search" auth="authed" hint="…">` (the `hint`
attribute and defaults reproduce find.js's copy verbatim — no attribute
overrides needed beyond `auth` and `hint`) with the Admin chip as its
`slot="who-extra"` child. `assets/find.js` is deleted (dead code — nothing
imported it, confirmed by grep before deletion); `assets/estate-search.js` +
`assets/apex-admin-link.js` replace it. The `.find-*`/`.hit*` CSS block in
`index.html` is gone (it now lives in the component's own scoped `<style>`,
reading the same `--et-*` tokens so it re-skins with every theme unchanged);
`index.html` keeps only `#find`'s section spacing and the slotted Admin
link's own small style block, since `::slotted()` can't reach that deep.

Deployed: `npx wrangler pages deploy sites/heygabi-home/public --project-name
heygabi-home`. **Review link: https://heygabi.ai** — try: (1) type 2+
characters signed out, confirm audiobook-only results with the "Searching
audiobooks only. Sign in to search every shelf." note; (2) sign in, confirm
the box widens and the Admin chip appears if you're an approver; (3) ↑/↓/
Enter/Escape still walk and open results; (4) a universe hit's "everything in
X →" still asks for sign-in when signed out. Behavior is pixel/behavior-
identical to find.js's — the same markup shape renders inside the shadow
root, same CSS custom properties, same copy.

### 0.4 Tests

- `apps/index-worker/test/search.test.ts`: 70/70 (5 new for `source`), plus
  `npm run typecheck` clean.
- The component itself ships no automated tests (browser-only custom element,
  no existing JS test runner in `sites/heygabi-home` — same as find.js before
  it, which also had none; this is an existing gap, not a regression).
  Verified by hand against the review link above.

### 0.5 Adoption plan for what's left (sizes, not code)

Researched 2026-08-15 (read `CollectionPage.tsx` + `router.tsx` + `api.ts` in
both React apps, and `audiobook_catalog/site/index.html`'s inline filter
block) before sizing, rather than assuming.

**library_catalog + Board_Game_Catalog (React, `apps/web`) — size M each,
same shape (the "structurally identical" property from §1.1 holds here too):**

- Both apps' own collection search (`CollectionPage.tsx` — 739 lines library,
  399 games) is SERVER-SIDE against `/api/collection?q=…`, filtering their
  OWN catalog's rows with facets/pagination `<estate-search>` cannot
  replicate — that stays exactly as it is. `<estate-search>` is ADDITIVE: a
  header/nav-level "search the whole estate" box, not a replacement.
- ⚠️ **Neither app uses `react-router-dom`** — both ship a **hand-rolled
  ~20KB pushState/replaceState router** (`router.tsx`). A wrapper assuming
  `useNavigate`/`<Link>` would be wrong; it must call this repo's own
  `navigate()`-equivalent from the `estate-search:select` handler instead.
- The wrapper itself: a thin React component (ref to the custom element,
  props → attributes, `intakeFilter` passed as a property not an attribute,
  `estate-search:select` listened to and `preventDefault()`ed to route
  through the local router). Sync machinery is close to mechanical —
  `sync-estate-theme.mjs`/`sync-estate-auth.mjs` are the exact precedent for
  a `sync-estate-search.mjs` copying `estate-search.js` (+ `estate-auth.js`
  if `auth="authed"` is wanted here too) into the build.
  ⚠️ **library_catalog materializes into `apps/web/public/estate/`;
  Board_Game_Catalog's existing estate assets sit under `apps/web/public/
  assets/` instead** — confirm which convention before writing the sync
  script for games, rather than assuming it matches library.
- `auth="authed"` here would need each app's OWN sign-in wired as the
  adapter (or reuse of the shared Firebase project's session — the estate
  design already assumes one Firebase project estate-wide) — undecided,
  flag for the dispatcher.

**audiobook_catalog (vanilla, `site/index.html`) — size S:**

- Its own filter (the ~860-line inline block, `_buildSearchCache`/
  `_applySearch`) is CLIENT-SIDE substring search over the already-rendered
  table/card grid across every column (title, series, series#, author,
  narrator, year, genre, duration, rating) with sort/pagination on top —
  genuinely a different job (its OWN columns) and STAYS, per the owner's own
  framing of the split.
  `<estate-search>` is close to a real drop-in here: no framework to bridge,
  `<script type="module" src=".../estate-search.js">` + the tag, DOM events
  straight through — the "do we own this anywhere across catalogs" box the
  site does not have today (confirmed: no existing cross-catalog search
  there; it only PUSHES to the index via `app/index_push.py`, never queries
  it). Likely placement: a small "search the whole estate" affordance
  alongside the existing table, `source="audiobook"` NOT set (the point is
  reaching the other two shelves, which this table cannot show).

**`/universes` page (`sites/heygabi-home/public/universes/`) — size S,
tomorrow's item per §5 below:**

- ✅ **BUILT 2026-08-15** — see "Four owner-ordered upgrades" below. The
  swap happened exactly as sized here: `<estate-search universes>` embedded
  as the page's own search entry point, the hand-rolled expand/collapse
  browse view (`universes.js`) kept as-is underneath it.

**Cross-cutting note for the dispatcher:** every non-apex site currently gets
`source`-scoped searches from ANONYMOUS visibility `{audiobook}` only
(§4.5) — an authless `source="library"` or `source="game"` box returns
empty, always, by design (§0.2's narrowing rule). Only audiobook's box is
useful authless out of the box; library/games need `auth="authed"` wired
before their own-shelf scoping does anything, which is real new work, not
config.

## The owner's five (picked from the research ideas, 2026-08-14 night)

*Landed here 2026-08-17 by the docs hygiene sweep. All six survived to completion and were verified before the move: 1 status page + 5 `/universes` live (the TODO itself corrected "still unbuilt" on 2026-08-16), 3 backups BUILT+RUN, 4+6 covers consolidation closed (see the covers-migration entry), and 2 cross-format series completion shipped in `library_catalog` as `8bd08a9` "Cross-format series completion: the by-format headline" (`apps/web/src/pages/SeriesDetailPage.tsx`). It still read "TONIGHT … in flight" from 2026-08-14.*


Prioritized by the owner; rejected ideas removed (dashboard, recap, game
nights, purchase guard, and PWA — all skipped by owner decision. PWA reasoning worth keeping: the owner LIKES the idea, but the site's main job is linking into Google Drive to download m4b files — offline browsing is meaningless when the endgame needs data anyway. Re-pitch only if the site ever gains offline-useful jobs.)

**TONIGHT (non-Fable agents, in flight):**
1. **Estate status page** ("I want to see ALL the pipelines") — apex page:
   every pipeline's last run + freshness (audiobook 8h pipeline, index pushes
   per source, worker healths, site build stamps), red/green at a glance.
2. **Cross-format series completion view** — library site: series ladders
   showing gaps by format and what ANY format would complete.
3. **Backup & restore runbook + backup workflows** — ✅ **BUILT + RUN
   2026-08-14.** `docs/access/backup-restore.md` is the runbook (protect
   inventory across all four repos, D1 Time Travel + export/import, Firestore
   dump/restore, R2's real gaps, what's deliberately not backed up and why).
   `.github/workflows/backup.yml` (manual dispatch, `d1`/`firestore`/`all`)
   exports **all four** D1 databases — library-catalog, board-game-catalog,
   index_catalog, estate_auth — from THIS repo alone, by database ID (proven
   interactively: no wrangler.toml needed), because `Board_Game_Catalog` is a
   PUBLIC repo and a GitHub Actions artifact there is downloadable by any
   signed-in GitHub account, not just collaborators — unacceptable for a
   database dump. `scripts/backup-firestore.mjs` (+ its restore companion
   `scripts/restore-firestore.mjs`, dry-run by default) walks every Firestore
   collection/subcollection recursively via the existing service account —
   no GCS bucket, no gcloud infra. **Proof run** (workflow dispatch
   `31855147930`): all 5 jobs green, artifacts downloaded and verified —
   4 non-empty `.sql` exports (5.8 KB estate_auth to 3.8 MB board-game-catalog)
   + 1 Firestore dump (56 collections, 1,294 docs, matching the local
   pre-flight run exactly). Named gap, closed the next night (2026-08-15):
   R2 `library-covers` had no backup path — `wrangler r2 object list` still
   doesn't exist, but the plain Cloudflare REST API (Bearer-token auth, no
   S3 keys) has always had list+get for R2 objects, and the existing
   `CLOUDFLARE_API_TOKEN` already carries enough permission to use it.
   `scripts/backup-r2.mjs` + `backup.yml`'s new `r2` job back up
   `library-covers` (208 objects/20.6 MiB), `audiobook-covers` (1,868
   objects/240.4 MiB), and `game-covers` (922 objects/118.8 MiB, a bucket
   created AND actively populated the same night by a second agent on the
   covers-consolidation plan). Full details + restore commands:
   `docs/access/backup-restore.md` §6/§8.
4. **Covers consolidation — research + inventory tonight** — count the
   third-party hotlink tail, size the R2 rehost, write the execution plan.

**TOMORROW:**
5. **Universes page on the apex** — after the status page lands (same repo
   surface); one page per universe across all three catalogs via the index.
6. **Covers consolidation — execution** — per tonight's plan, attended. Plan:
   `docs/info/covers-consolidation-plan.md` — 506 `item.thumbnail_url` rows /
   1,124 distinct URLs across item+edition, 13 hosts, 0/78 sampled dead,
   ~110–230 MB; new `game-covers` R2 bucket at `gamecovers.heygabi.ai`;
   CSP prune is the last step, gated on a zero-rows verification query.

## ✅ Covers migration — FINISHED, verified 2026-08-16

*Landed here 2026-08-17 by the docs hygiene sweep: closed end to end on 2026-08-16 (every step measured or owner-confirmed), so it was finished work sitting in the ACTIVE board. Moved whole, `<details>` block included.*


**All three steps are done.** Verified rather than assumed, because the owner
asked for this to be picked up and the honest answer turned out to be "it
already happened":

| Step | Evidence |
|---|---|
| 1. Games index push lands with new cover URLs | `board-game-catalog` D1: **507 items on `gamecovers.heygabi.ai`, 330 with no cover, ZERO on any other host.** The index pushed **837 rows at 08:19:56Z** on 2026-08-16 — 507 + 330 = 837 exactly, so the push carried the migrated set |
| 2. Deploy heygabi-home (CSP prune) | Live CSP `img-src` names `gamecovers.heygabi.ai` and no old hosts. Shipped repeatedly on 2026-08-16 |
| 3. Apex search shows a game thumbnail | ✅ **VERIFIED BY THE OWNER, 2026-08-16** — *"yes covers are showing up in global search"* |

⚠️ **The ordering hazard did not bite, and it was close.** The note warned that
deploying step 2 before step 1 blanks apex-search game thumbnails, because the
pruned CSP excludes the old hosts while the index still serves them. heygabi-home
was deployed eight times on 2026-08-16 for unrelated work — but the games push
landed at **08:19Z**, hours before the first of those deploys. Correct order by
luck, not by design. If a future migration carries the same warning, check the
push timestamp BEFORE deploying rather than after.

✅ **Step 3 confirmed by the owner the same day.** It could not be checked from
this session and was not guessed at: anonymous search returns **zero game rows**
by design (the visibility narrowing rule — an anonymous caller sees the
audiobook source only), so the only instrument that could answer it was a
signed-in pair of eyes. The owner looked and reported covers loading in global
search.

**The migration is now closed end to end** — every step either measured or
confirmed by someone who could see it. Nothing here is outstanding.

The one deliberate refusal from the migration stands: a 7.3MB Shopify file over
the size ceiling, left on its original URL on purpose — it is among the 330
without a rehosted cover, not a failure.

<details>
<summary>The original ordered instructions, kept for the record</summary>

## ⚠️ Covers migration — ONE ordered finish step (2026-08-15)

Migration itself is DONE (1,123/1,124 rehosted to gamecovers.heygabi.ai; the
one refusal is a 7.3MB Shopify file over the size ceiling, row left on its
original URL on purpose). Intake hooks live. Rollback snapshots committed in
the games repo. Remaining, IN THIS ORDER:
1. The games index push must land with the new cover URLs. The push-token
   pair was rotated FRESH on both workers (the agent-printed token is dead —
   never use a token that has appeared in any transcript). The push fires on
   the next real games item mutation OR the 24h staleness backstop
   (~03:46Z). VERIFY on heygabi.ai/status (game source pushed_at advances)
   or index /api/health.
2. ONLY THEN deploy heygabi-home (the CSP prune is already committed in
   _headers): npx wrangler pages deploy sites/heygabi-home/public
   --project-name heygabi-home. Deploying before step 1 blanks apex-search
   game thumbnails (CSP excludes old hosts while index still serves them).
3. Verify: apex search a game, thumbnail loads from gamecovers.heygabi.ai.
Nothing is user-visibly broken meanwhile — old hotlinks still serve under
the still-deployed old CSP.

</details>

## 🤖 GABI moderation — `/timeout` + `/cleanup` — ✅ BUILT + DEPLOYED 2026-08-17 (SHIPS DARK, and UNPUBLISHED)

*(Moved whole from `TODO.md` §0's queue, item 2: "**Moderation features** —
SCOPE DECIDED by the owner 2026-08-16: **timeouts and message cleanup**,
nothing else (no auto-responses, no scheduled sweeps — not declined forever,
just not in scope now). Design doc still comes first, but it designs exactly
these two: `/timeout <user> <duration> [reason]` — invokable only by members
who hold Discord mod permissions THEMSELVES (mirror the caller's authority,
never let the bot amplify a non-mod), worded confirmations, audit line.
`/cleanup <count|user|contains>` — bulk delete with rails: hard cap per
invocation, Discord's own 14-day bulk-delete API limit surfaced in words (not
a silent partial), preview-then-confirm for anything big. Also from the same
conversation: Interactions Endpoint URL is SAVED (Discord's probe passed at
save time) — the endpoint is verified live. ⚠️ **KILL-SWITCH CONTRACT (owner
order, same evening):** moderation ships DARK. `MODERATION_ENABLED = "off"` is
already declared in wrangler.toml; every moderation code path MUST check it and
answer a worded 'switched off' ephemeral until the owner flips it — the flip is
his evidence-gated step (shadow-first idiom), never part of a deploy. The bot's
mod-bundle server permissions stay granted but unconsumed; if the owner wants
zero latent risk meanwhile, removing them from GABI's server role is one toggle
and re-granting later is the same toggle.")*

**Shipped:** version `ad35e796-ffd6-44a8-b15e-83bc75bf97ab` at
`discord.heygabi.ai`; commit `b9d10d3`. `src/moderation.ts` (decisions),
`src/mod-actions.ts` (flows). Tests 104 → 161. Runbook:
`access/discord-bot.md` §9.

**The kill-switch contract, honoured literally.** `MODERATION_ENABLED` is read
affirmatively — `"on"` and nothing else, so `"true"`, `"1"`, `"yes"` and every
typo fail CLOSED, pinned by a test that names each. The check is **first** on
every path, before permissions, before parsing, before any I/O, so a
switched-off bot performs no network call and reveals nothing about who holds
what permission. Each flow re-checks it a second time, deliberately
redundantly: a moderation path guarded by exactly one gate is one refactor away
from being guarded by none.

**Mirroring the caller, never amplifying them.** `/timeout` requires the CALLER
to hold `MODERATE_MEMBERS` and `/cleanup` requires `MANAGE_MESSAGES`, read from
the interaction payload's own `member.permissions` (Discord's computed value,
already proven authentic by the Ed25519 signature). `ADMINISTRATOR` implies
both. Every refusal NAMES the permission; a DM is answered as "that only works
in a server", which is a different problem from a permissions refusal and is
worded as one.

**The decisions worth keeping:**

- ⚠️ **REGISTRATION IS A FUNCTION OF THE SWITCH.** While moderation is off, the
  two commands are not published to Discord at all — `commandsFor(env)` returns
  `/link` + `/have` only. Both idioms were defensible and the reasoning is
  recorded in `commands.ts`: `/link` being visible-but-off costs a curious
  person twenty seconds, whereas a visible `/timeout` costs a moderator the
  seconds of an actual incident, and advertises in **every** server GABI is
  invited to (commands are global) a capability the estate deliberately has not
  switched on. The handlers still answer the switched-off ephemeral if an
  interaction arrives, so the contract holds at RUNTIME regardless of what is
  published — which is what makes hiding safe rather than merely quiet.
  **Consequence:** the flip has a documented SECOND step, re-running
  `POST /admin/commands/register`.
- **The confirm button is signed, short-lived and bound.** `/cleanup` previews
  first; the confirm's `custom_id` carries an expiry (2 minutes) and a
  truncated HMAC keyed off the bot token under its own label. The **invoker and
  the channel are associated data** — signed but never transmitted, recomputed
  at press time — which binds "this person, this channel" for free and is what
  keeps the id inside Discord's 100-character ceiling. The confirm **re-reads
  the channel live** rather than trusting a remembered list: two minutes of
  chat may have moved things, and deleting a remembered list would delete
  messages nobody previewed.
- ⚠️ **A real bug the tests caught, and it would have hit exactly one group of
  people.** The `contains` cap was written in CHARACTERS while the custom_id
  carries base64 of BYTES: a 32-character accented filter produced a
  **115-character** custom_id — 15 over Discord's ceiling, i.e. a confirm
  button that would simply not have rendered, for exactly the users whose
  language uses accents. Now capped at 32 UTF-8 **bytes**, refused in words
  (never truncated — truncation would delete a different set than the preview
  showed), and pinned by a worst-case test.
- **Rails:** a hard cap of **50** messages per run (deliberately half Discord's
  own bulk ceiling — a mis-typed cleanup cannot be undone and nothing about
  tidying is urgent), refused in words rather than clamped; Discord's **14-day**
  bulk-delete limit surfaced as a named leftover, never a silent partial; pins
  never deleted; an unreadable timestamp lands on the SAFE side of the 14-day
  line; a preview with nothing to delete gets **no button at all**.
- **Audit:** `discord_mod_audit`, a top-level collection the Worker owns
  outright — no `firestore.rules` grant exists and the file has no catch-all,
  so browsers are denied by default and the service account bypasses (the same
  posture as `discord_poll_messages`). Pinned by a contract test on the field
  shape and the doc id. ⚠️ Switched-off answers and permission refusals are
  **not** audited: nothing happened, and auditing them would let any member of
  any server fill an estate collection by spamming a command.
- **Discord's own audit log gets a reason header** on every action, so a server
  admin sees "GABI timed out X — spam, by @mod" rather than an unexplained bot
  action.

⚠️ **NOT VERIFIED LIVE, and cannot be while the switch is off:** no timeout, no
message read and no deletion has ever been executed against Discord. Every
Discord call in the moderation path is written, typed and unit-tested against
injected dependencies, and has never run. The first real invocation will be the
first test of role-hierarchy 403s, of the bulk-delete endpoint, and of the
audit write.

## 🤖 GABI `/have` — "is this book on the estate's shelves?" — ✅ BUILT + DEPLOYED 2026-08-17

*(Moved whole from `TODO.md` §0's queue, item 1: "**More slash commands** —
`/link` is registered by `POST /admin/commands/register`
(`access/discord-bot.md` §4); the next is `/have`, anonymous audiobook-scope
default per design §4 decision 4. Add it to `ESTATE_COMMANDS` and re-run the
same route.")*

**Shipped:** version `ad35e796-ffd6-44a8-b15e-83bc75bf97ab` at
`discord.heygabi.ai`; commit `b9d10d3`. `src/have.ts`. Runbook:
`access/discord-bot.md` §9. ⚠️ **Not yet visible in Discord** — publishing is
§4's admin-gated route and needs an estate admin's Firebase ID token, which no
agent holds.

**What it answers.** A worded, **ephemeral** reply listing the works that match
a title/author/series query — title, creator, every format found (audiobook,
ebook), and a detail link each — or a clean no-match. Deferred inside Discord's
3-second window and answered under the 15-minute interaction token, per design
§1.7's "build the deferred path from day one".

**The scope line, which IS the design (§4 decision 4):**

- ⚠️ **The call to `index.heygabi.ai/api/search` carries NO Authorization
  header, and that absence is the decision** — an anonymous caller gets the
  `{audiobook}` slice by the index's own §4.5 rule, which is exactly what
  decision 4 specifies. So the default path needs no credential, and there is
  none here to leak, misuse or accidentally widen. A test asserts the header is
  absent, because this is precisely the thing a well-meaning refactor "fixes".
- **`source=audiobook` is sent anyway, and it is not redundant.** It can only
  NARROW (index `search-route.ts`), so it costs nothing today — but if the
  index's anonymous default were ever widened, `/have` would not widen with it.
  The scope is stated by the command, in one place, not inherited.

⚠️ **The wider scope for linked members is NOT shipped, because it does not
exist to ship.** Measured 2026-08-17 by reading the code, not the design:

1. `index-worker/src/middleware/scope.ts` resolves scope from
   `resolveIdentity()` — a **Firebase ID token and nothing else**. There is no
   app-token path, no on-behalf-of header, no server-to-server widening on
   `/api/search` at all.
2. This Worker cannot mint such a token: Discord's OAuth does not produce one,
   and `firebase-sa.ts` here is deliberately scoped to `datastore` only (a
   recorded credential decision — it does not carry identitytoolkit).
3. Even holding a `/seen` answer — which would need a NEW app-token pair,
   `ESTATE_APP_TOKEN_DISCORD`, minted on auth-worker AND here — there is
   nothing on the index to hand it to.

So a linked member gets the same public slice plus **one honest sentence** that
names what the wider shelves wait on ("the index only widens for a caller
holding a Firebase sign-in, which Discord cannot produce — estate
infrastructure, not a permission you are missing"). Shipping a minted-secret
name for a path with no receiving end would have been theatre, not dark
shipping. **Making it real is two pieces of new estate surface**, and both are
privilege-increasing decisions for the owner, not an agent: the app-token pair,
and an index capability that accepts an app token plus a subject.

**The wording rules, pinned by tests:**

- ⚠️ **Never "you don't own it".** A catalogue is not an inventory — ~100 books
  are unscanned at any time — so a no-match says the *catalogue* has nothing
  close and says outright that an unscanned book looks exactly like this.
- An outage is never dressed as an answer about the book: "a service problem on
  the estate side, NOT an answer about the book."
- More matches than fit are **counted and stated**, never silently dropped.

## 🤖 GABI phase 3 — bot-posted poll messages with vote buttons — ✅ BUILT + DEPLOYED 2026-08-17 (SHIPS DARK)

*(Moved whole from `TODO.md` §0's queue, item 1: "**Phase 3 — bot-posted poll
messages with buttons** (+ tally refresh / close propagation riding
`club_announcements.py` cadence). ⚠️ Until this ships there is NOTHING votable
in Discord — the invite changes nothing visible. Set owner expectations
accordingly.")*

**Shipped:** version `b64be346-876c-4cf0-8365-137afee3536a` at
`discord.heygabi.ai`; commits `92375af` (catalog-platform) and `f9f3ab6`
(audiobook_catalog, pushed to `main`). Tests 77 → 104. Runbook: `access/discord-bot.md` §8.

**What it is.** `POST /polls/sync` on the discord-worker, poked by
`audiobook_catalog/app/club_announcements.py` on the pipeline's existing
~8-hour cadence — the trigger the research doc itself recommended. Per
opted-in club (`features.discordPollVoting === true`) the tick posts a votable
message for each open poll, refreshes its tally, and edits it to a closed
rendering (buttons removed, winner marked, "final" footer) exactly once when
the poll closes.

**The decisions worth keeping:**

- **The buttons REUSE the live `pv|<clubs|clubs_dev>|<clubId>|<pollId>|<idx>`
  grammar exactly.** The posting test parses what the poster emits with the
  LIVE parser, not a copy — a button the vote path could not route would be a
  dead button, and the suite now refuses to ship one.
- **The trigger carries only the LANE.** Every fact the tick acts on is read by
  the Worker with its own service account. Sending club ids or webhook URLs
  would have made the pipeline a second source of truth and put a capability on
  the wire for nothing.
- **Independent failure domains, both ways.** `sync_poll_messages()` runs after
  the announcement pass, catches everything and logs one line — a dead endpoint
  cannot fail a run (pinned by a test). The webhook announcements themselves are
  byte-for-byte unchanged, as design §0 requires.
- **State lives in `discord_poll_messages/{clubCol}__{clubId}__{pollId}`**, a
  top-level collection the Worker owns: not a field beside the poll (that doc is
  browser-writable), not keyed on the bare `pollId` (the two lanes are separate
  universes), and needing no `firestore.rules` change (nothing grants it, there
  is no catch-all, the service account bypasses).
- **Idempotence is keyed on the stored `messageId`** — present ⇒ edit, absent ⇒
  post — so a tick is safe to run twice or by hand mid-cadence. A closed poll
  that was never posted is never posted; a deleted OPEN message is reposted, a
  deleted CLOSED one is left gone.
- **Blast rails:** per-club named skips (never a crash), 429s honouring
  Discord's own `retry_after` bounded to three attempts, a 10-poll-per-club cap
  that states its overflow, and a whole-tick Firestore outage answering as an
  outage rather than a permissions refusal.
- **Ships dark, and dark BEFORE closed:** with `POLL_SYNC_TOKEN` unset the route
  answers a worded 503 even to a caller presenting a bearer token — an unminted
  secret is not the caller's fault, and a 401 there would send someone hunting a
  credential mismatch that does not exist.

**Remaining to switch it on** (`access/discord-bot.md` §8.6): mint
`POLL_SYNC_TOKEN` once, `wrangler secret put` it here, put the same value in the
audiobook pipeline's `.env`, and opt a club in. **Not verified:** no real
Discord message has been posted — that needs the secret minted AND a club opted
in AND GABI holding Send Messages in the target channel. Nor has the
webhook→`channel_id` resolution run against real Discord.

## 🤖 GABI phase 2 — the identity-link ceremony — ✅ BUILT + DEPLOYED 2026-08-17 (SHIPS DARK)

*(Moved whole from `TODO.md` §0's queue, item 1: "**Phase 2 — identity-link
ceremony**: OAuth2 `identify` → writes `discord_links/{discordUserId}`
`{slug, displayName}`; until it ships every vote click gets the worded 'not
linked' ephemeral. Design §1.6.")*

**Shipped:** version `9d496ece-ae58-440f-b6d0-d51ba6143e6d` at
`discord.heygabi.ai`, commit `7ae9137` plus the docs commit that follows it.
Tests 34 → 77.

**What it is.** `GET /link` → Discord's OAuth2 `identify` screen →
`GET /link/callback` → a self-contained page that signs the person in to the
estate's Firebase → `POST /link/confirm` writes ONE doc:
`discord_links/{discordUserId}` = `{slug, displayName, linkedAt,
firebaseUid}`. `POST /link/unlink` deletes it — revocable is part of §1.6's
identity rules, not an afterthought, and its button sits on the same page as
the link button so nobody has to hunt for it. `POST /admin/commands/register`
(estate `admin` only) publishes the `/link` slash command, whose reply is
ephemeral.

**The design decision worth keeping.** A link joins TWO identities, so the
write demands both in the same request. The Discord half is an OAuth code
exchange the browser cannot forge; it crosses from the callback to the
confirm POST inside an **HttpOnly, HMAC-signed, 15-minute cookie**, never in
the page's JavaScript — because a page that knows a Discord user id is a page
that can be edited to submit somebody *else's*, and that is the entire
security of the ceremony. The estate half is a Firebase ID token verified
server-side by `@platform/estate-auth` (project-pinned issuer AND audience).
Neither proof alone writes anything. That is what makes §1.6's "votes are
never guessed from usernames" a mechanism rather than a promise.

**Why it ships dark, deliberately.** `DISCORD_CLIENT_SECRET` is a NEW secret
and only the owner can fetch it. Rather than crash or 500, every route
answers a worded "linking is not configured yet" page naming the exact
remaining step; `/api/health` reports `configured.discord_client_secret:
false` and `link_ready: false` **honestly**, which is how the dark state is
visible from outside rather than inferred from a page nobody loaded. Same
idiom as `MODERATION_ENABLED`.

⚠️ **THE BUG THIS BUILD FOUND, which would have been silent and cruel.**
`poll-vote.ts` validated the link doc's `slug` with the Firestore-auto-id
pattern `/^[A-Za-z0-9_-]{1,64}$/`. But a member slug is
`displayName.toLowerCase()` — measured against
`audiobook_catalog/site/identity.js:765`, which strips nothing, dashes
nothing and transliterates nothing — so nearly every real slug contains a
**space**, and that regex refused it. Left alone, phase 2 would have written
links that phase 1 then declined to read, and every affected voter would have
been told **"you are not linked" while their link doc sat right in front of
the Worker**. Fixed: the slug rule now lives in one file
(`apps/discord-worker/src/slug.ts`) shared by the writer and the reader,
everything reaching a Firestore REST path is percent-encoded, and a
round-trip **contract test** over real display-name shapes ("Sam Vimes",
"Conn O'Neill", "Renée Descartes", an email fallback) pins the two halves
together so they cannot drift apart again. The gotcha is recorded in
`access/discord-bot.md` §7.

**Verified live at deploy (2026-08-17 07:36 UTC):** `/api/health` `ok: true`
with the four original booleans `true` and the two new ones honest;
`GET /link` → **503 + the worded not-configured page** (naming
`DISCORD_CLIENT_SECRET`, the callback URI and the runbook, and never
redirecting into a broken OAuth trip); `POST /link/confirm` → worded JSON
naming a configuration gap, "NOT a permissions problem";
`POST /admin/commands/register` → worded 401 saying how to authenticate; and
critically `POST /interactions` still answering **401 `bad_signature`** to
Discord's invalid-signature probe and **401 `missing_signature_headers`** to
an unsigned POST — the endpoint the portal silently removes on failure is
intact.

**NOT verified, and why.** The full OAuth round trip has never run — it
cannot until the client secret exists, and the code exchange is the one step
no test can stand in for. Also unexercised: the Firestore write and delete
themselves, the Google sign-in on the callback page (which additionally needs
`discord.heygabi.ai` added to Firebase's authorised domains — ⚠️ a subdomain
is NOT covered by its parent), the `site_roles` admin-gate read, and the
Discord command-registration API call. Everything up to the network boundary
is tested; nothing across it is.

**Remaining owner action:** `access/discord-bot.md` §3 step 7 (three clicks),
then §4 to publish `/link`.

## 📚 The apex `/series` page — ✅ BUILT + DEPLOYED + VERIFIED SIGNED-IN 2026-08-17

*(Moved whole from `TODO.md`'s "Series registry — what still hangs off it",
item 1: "**The apex `/series` page** — the reason `GET /api/series` and
`GET /api/series/:slug` exist. The detail endpoint already returns rows grouped
by medium with `source`, `title`, `series_index`, `cover_url` and `detail_url`,
and every search hit now carries `series_slug`, so a result can link straight to
its series with no client-side folding. ⚠️ It is **members-only** (sign-in
required, like `/universes`' data), so the page needs the apex's signed-in
fetch, not an anonymous one. Size S.")*

**The owner's ask, in his words:** *"I want missing books to say you don't have
book 1 but audio and ebook do and Skylar also owns it."* So the page is **not a
list of the rows the index returned** — it is a list of **volumes in number
order**, and the numbers nobody holds are rendered as their own dashed **GAP
rows**. A list of what we own can never show what is missing, and what is
missing was the request.

Live: <https://heygabi.ai/series/> (sign in — the data is members-only).

### What shipped

| Piece | Where |
|---|---|
| The page + its script | `sites/heygabi-home/public/series/index.html`, `series.js` |
| CSP, both forms (the 308 trap) | `sites/heygabi-home/public/_headers` — `/series` and `/series/` |
| Live markers | `sites/heygabi-home/predeploy.checks.json` — `/series/` and `/series/series.js` |
| Nav | `public/index.html` (the Universes cell became `.card.multi`), `public/universes/index.html` (cross-link) |

Commits `32a6f2b`, `f2fd6dc`, `6d41982`. Deploys `1f932b64` then `f40d18c5`
(`npm run deploy:home`; `verify:home` green both times — 11 live pages).

**Structure is `/universes`, near enough line for line** — collapsed rows, a
lazy per-item fetch on first expand, page-local render functions, the same
neutral-boot auth (8s backstop, no signed-out flash), the same theme tokens and
the same back arrow. Duplicated rather than shared, per that page's own header
and this codebase's one-page-one-script convention.

**The transform is the page.** `/api/series/:slug` answers rows grouped by
MEDIUM; `series.js` regroups them by `series_index` (`volumesFrom`), works out
which integers between the first volume and the last nobody holds (`gapPlan`),
and prints each volume as the owner's sentence (`holdingLabel`): *"On audiobook
(shared pool) and Skylar's library (book)."* plus, where a shelf in that series
lacks it, *"Not in Skylar's library."* Source vocabulary → household words:
`library` = Skylar's library, `library2` = Samantha's library, `audiobook` /
`ebook` = shared pool, `game` = games.

**Two honest refusals rather than nonsense:** numbering past 60, or more than 25
gaps, gets a printed note instead of synthesised rows — a `series_index` that is
really a year must not produce 2,000 dashed rows. Unnumbered volumes group last,
in a collapsed `<details>`. Scope is the API's throughout: the page never widens
it, and a gap is worded as *"not on any shelf you can see"*, never as a claim
about a catalog the viewer was not shown.

### ⚠️ What only a real signed-in browser found — twice

The page passed every unauthenticated signal (`check:home`, `verify:home`,
markers, both CSP headers curl-verified) while carrying two real defects. Both
were found by **opening it signed in** — the same lesson the `/admin` role
columns taught the day before.

1. **Dungeon Crawler Carl holds 8 books and 29 game rows under one series
   name**, so *"Not in games."* printed under every novel and *"Not in audiobook
   (shared pool) and Skylar's library."* under every dice bag. The design
   already said why that is wrong — `info/index-worker-design.md` §3.1 gives a
   game `work_fold = NULL` **by design**, because *"a board game is never the
   same work as a book"* and never answers a same-work-in-another-format
   question. A missing-FORMAT claim is exactly that question, so the game/book
   line is now never crossed in either direction.
2. **The same 31 accessories buried the 8-book ladder** — the ladder being the
   point of the page. They moved into a collapsed `<details>`, the same native
   fold and the same class `/universes` uses for the owner's identical complaint
   there.

### Measured live, signed in as the owner, 2026-08-17

| Observation | Result |
|---|---|
| List | **441 series, 1,588 entries**; scope read *audiobook (shared pool), Skylar's library, games and Samantha's library* |
| Complete run | *All the Skills* — books 1–6, each on audiobook **and** Skylar's library; no gaps, no gap note |
| Half-volumes | *The Stormlight Archive* — 1, 2, **2.5** (Edgedancer), 3, **3.5** (Dawnshard), 4, 5, printed as their real `REAL` values rather than rounded |
| The owner's sentence | *Dungeon Crawler Carl* book 4: *"On audiobook (shared pool). Not in Skylar's library."* |
| **The GAP rows** | *The Survivalist Series* — **books 1–5 as dashed "Book N — nobody in the estate has this one"**, then 6–9 held on audiobook, closing with *"5 numbers are missing between 1 and 9 — the dashed rows above."* |
| Filter box | page-local, no network: "storm" → 1 of 441, "survivalist" → 2 of 441 |
| Console | clean — no CSP refusal, no JS error |
| CSP headers | `curl` on **both** `/series` (308) and `/series/` (200) carries `connect-src https://index.heygabi.ai` |

### NOT verified

- **No automated test covers the render.** `node --check` parses `series.js` and
  `predeploy-check` asserts its markers; the volume/gap transform has **no unit
  test** — the repo has no harness for page JS (no DOM, no build step) and one
  was not invented for this. The live signed-in walk above is the evidence, and
  it is a walk, not a suite.
- **`estate-probes` was not extended.** It probes APIs, and the series API
  already gained its own probes (B11–B15) with the registry; no apex page has a
  probe row, because that pattern does not exist.
- **Only ~8 of 441 series were opened by hand.** The gap ceilings
  (`GAP_MAX_INDEX = 60`, `GAP_MAX_ROWS = 25`) never fired on any of them, so
  **the suppression note has never been seen rendering** — that path is
  unexercised in production.
- **The signed-OUT page was never seen.** The owner's browser was signed in
  throughout; the sign-in invitation and the makes-no-fetch path are asserted by
  the markers and by reading the code, not observed.
- **`library2` and `ebook` labels are unexercised** — `/api/health` reports rows
  for `game`, `library` and `audiobook` only. Samantha's library is in the
  owner's scope and contributes no rows yet.
- **Mistborn's volumes render with blank cover frames.** Those rows carry no
  `cover_url` in the index — inferred from other audiobook rows on the same page
  rendering covers from the same host, **not** confirmed against the data.

## 📚 The estate SERIES REGISTRY — ✅ BUILT + DEPLOYED LIVE 2026-08-17

**The owner's order, 2026-08-16: "I don't want duplicate series."** The index
held one free-text `series` string per row, in whichever spelling the owning
catalog happened to have — an m4b tag saying *"The Stormlight Archive"*, a
library row saying *"Stormlight Archive"*, and the apex seeing two series.
Series now have a KEY, the way books have had `work_fold` since day one.

Design section: [`info/index-worker-design.md` §8.5](info/index-worker-design.md).
Live: `https://index.heygabi.ai/api/series` (members-only — sign in on the apex
first; a tokenless GET is a 401 by design).

### What shipped

| Piece | Where |
|---|---|
| Migration 0004: `entry.series_slug`, `series`, `series_alias`, `series_pending` | `apps/index-worker/migrations/0004_series_registry.sql` |
| The resolver (pure) | `apps/index-worker/src/series.ts` |
| Its D1 side + the canon reader | `src/series-store.ts`, `src/series-canon-data.ts` |
| Push-time resolution, inside the push's own batch | `src/push.ts` |
| The API + the approver's confirm queue | `src/series-route.ts`, `src/middleware/auth.ts` (`requireOwnerStanding`) |
| The one-shot backfill (dry run by default) | `scripts/backfill-series.ts` |
| Tests: 22 unit + 5 real-runtime probes | `test/series.test.ts`, `test/live-probes.ts` B11–B15 |

Commits `f6a83b0`, `a1a7288`, `b78b3eb`. Worker version
`1db25143-1dcc-47f9-9fb1-000d5627ec81`. Remote migration 0004 applied (✅ row
seen, not assumed).

### The decisions, so nobody reopens them

- **The fold is `normaliseTitle` — the pinned §6 port — hyphenated. Not a new
  normaliser.** It already strips a leading article, which is exactly why the
  owner's own example merges with no judgement call. Empty folds are REFUSED to
  NULL, same rule as `title_fold` (two Korean series names).
- **Exact fold → auto-merge; near miss → confirm-first.** The owner approved
  exactly this split. A near miss registers as its own slug AND queues; nothing
  is merged behind anyone's back, and silence leaves two series.
- **The near rule is DISCOVERY only** — it gates no write, so §8's "no second
  matcher" stands. It is `data/series-canon.json`'s own `_measured` decoration
  fold, which that file already calls a discovery tool and never a runtime rule.
- **The canon merges what a human already decided** (3 entries, with evidence).
  Re-queueing a decision on record would be a queue asking a question it has the
  answer to.
- **Members-only + scoped**, i.e. `/api/universe`'s stance, not `/api/search`'s
  anonymous carve-out — which §4.5 grants to search ALONE. Widening it is one
  line and an owner's call, not a side effect of building a page.
- ⚠️ **The list is derived from scoped `entry` rows, never from the registry
  table**, or an audiobook-only member would learn the series NAMES held in the
  two private catalogs. `/api/series/:slug` answers `unknown_series` for a real
  but out-of-scope slug for the same reason.
- **Approver = `OWNER_EMAILS`**: the index has no local roles, and the shared
  auth module does not expose the estate's `is_approver` to consumers.
  `requireOwnerStanding()` is the one place to widen it later.

### Measured live, 2026-08-17 (backfill applied to remote D1)

| | |
|---|---|
| rows carrying a series | **1,590** |
| distinct raw spellings → slugs | **443 → 441** |
| rows keyed / with a series but no key | **1,588 / 2** (the two Korean names — the refusal, working) |
| exact merges | **0** |
| confirm-queue rows | **1** — *"The Survivalist Series"* ~ *"The Survivalist"*, both audiobook |

⚠️ **Zero exact merges is the honest headline.** The cross-catalog spellings had
already been straightened upstream (the series canon, and the audiobook
catalog's own corrections layer), so today this registry is **preventative**: it
makes the regression structurally impossible rather than cleaning up a mess that
was still on the shelf. The owner's Stormlight example is already spelled
identically in both catalogs — measured, not assumed.

### NOT verified

- **A signed-in production GET.** `/api/series`, `/api/series/:slug` and
  `/api/series/pending` were confirmed live as **401 (not 404)** — routed and
  gated — and their 200 answers were verified against a REAL Workers runtime
  and a real D1 by `npm run probe` (B11–B15). Nobody signed in to
  `index.heygabi.ai` itself: that needs the owner's Firebase token, and this
  repo has no authenticated-probe mechanism.
- **The apex `/series` page** — not built; this is the API it will read.

## 🔑 Sam's library (`library2`) — the CSP half, and the SIGNED-IN verification — ✅ DONE 2026-08-16

**Appended, not edited into the entry below it** (this file is append-only).
The entry beneath this one closed with *"NOT verified: the SIGNED-IN table"*.
It has since been verified, and doing so immediately found a real bug that
every unauthenticated check had passed straight over.

### The bug: the fourth column read "unreachable" on every row

Everything that can be checked without a browser session was green — the
`APPS` row shipped, `verify:home` passed all 9 pages, 102/102 estate probes
passed, and padhard's own CORS preflight admitted `https://heygabi.ai` with
GET+PATCH when curled directly. The signed-in page still showed
*"Sam's library … unreachable"* on every member, and the role filter had no
vocabulary at all.

**Cause: the apex's own Content-Security-Policy.** `/admin` and `/admin/` in
`sites/heygabi-home/public/_headers` named `library.heygabi.ai` and
`boardgames.heygabi.ai` in `connect-src` and nothing else. A CSP-blocked
`fetch()` **rejects** inside the page, and `fetchAppDirectory()` catches a
rejection as `{ ok: false, why: 'unreachable' }` — which is
indistinguishable from the other site being down. `/status` and `/status/`
had the identical latent failure for the new `wk-library2` / `site-library2`
rows.

⚠️ **The durable lesson, written into `_headers` itself and into
`estate-auth-design.md` §1.2 so the next person meets it: federating an app
is TWO edits — the `APPS` row in `admin.js` AND the host in this origin's
CSP — and shipping only the first looks exactly like the other site being
down.** The other site's CORS is the first lock; this origin's CSP is the
second, and only a real signed-in browser session shows the second one
failing. This is the "verify with the right instrument" rule paying for
itself: a 200, a marker match and a green probe suite all held while the
feature was broken.

Fix: commit `3f0a5ba` — `https://padhard.heygabi.ai` added to `connect-src`
on all four rules (`/admin`, `/admin/`, `/status`, `/status/`; both forms,
per the 308 trailing-slash trap that file documents). Redeployed from a
second `git worktree add <tmp> HEAD` checkout.

### Verified live, SIGNED IN, 2026-08-16

Read off `https://heygabi.ai/admin` in a real browser session:

| Verified | Observed |
|---|---|
| The role filter reaches her instance | "Sam's library role (padhard.heygabi.ai)" carries her Worker's full vocabulary — `owner / admin / moderator / contributor / member / guest / pending` — fetched from padhard, never hardcoded |
| **The owner's actual ask** | **Samantha Hardman's row shows a "Sam's library" role dropdown reading `admin`**, editable exactly like her `games` cell |
| Owner auto-max, extended identically | Both owner rows render **no control at all** on the Sam's-library cell — "Owner — holds owner, this app's highest role. Not changeable here; owner is DB-only." — the same sentence the library and games cells show |
| No account there ≠ an error | Members who have never signed into her instance show "no account yet — appears on first sign-in", not a broken dropdown |
| The estate visibility checkbox is unaffected | Every row still carries its own "Sam's library / visible" checkbox (0007's `DEFAULT 0` column) |
| No JS errors | Console clean across a signed-out and a signed-in load |
| Live CSP carries the host | `/admin/` and `/status/` response headers both match `padhard` |

⚠️ **Still NOT verified, and unchanged from the entry below:** whether
`padhard.heygabi.ai` is present in Firebase's authorised-domain list (probe
D5 exists but needs a service account nobody had in hand). And **nothing was
WRITTEN** — no role was granted or changed on anyone during verification;
the dropdowns were read, never submitted.

## 🔑 Sam's library (`library2`) joins the estate MANAGEMENT surfaces — ✅ DONE 2026-08-16

Owner, live on the page 2026-08-16: *"in the admin page Sam's library has no
roles, I should be able to set her with the same level of roles as my
library."*

He is right, and the fix is smaller than the ask implies — because the
plausible premise ("add a fourth managed site to the auth Worker") is wrong.
`padhard.heygabi.ai` runs the **same Worker code** as `library.heygabi.ai`
(`library_catalog`'s `[env.friend]`), so it already answers
`GET /api/admin/users` in the library's own vocabulary, already gates on its
own `manageUsers` capability, and already CORS-locks itself to
`https://heygabi.ai`. The admin page simply was not asking. Serving her roles
from the auth Worker instead would have stood up a **second, competing role
store for a catalog that already has one** — see
`docs/info/estate-auth-design.md` §1.2's 2026-08-16 amendment.

Scope, all in one pass:
- `admin.js`: `library2` becomes a full member of `APPS` (canonical order,
  appended last), gaining the same dropdown, the same server-enforced
  strictly-beneath granting and the same owner-auto-max cell as library and
  games; the old "roles live on that site — not federated here yet" note is
  gone.
- `admin/index.html`: a "Sam's library" role filter (`f-role-library2`).
- `/status`: `wk-library2` + `site-library2` rows.
- `tools/estate-probes`: padhard health as a fifth `health.mjs` target plus a
  new `probes/library2-worker.mjs` (tokenless AND garbage-bearer 401 on the
  role surface, apex-only CORS admit/refuse). All GET/OPTIONS — no
  `NON_GET_ALLOWLIST` row needed.
- `auth-worker`: **no code change**. `test/library2-vocabulary.test.ts` pins
  the wire word (`CONSUMER_APPS`, `appTokenFor`'s distinct secret,
  `vis_library2`, canonical-last) and carries a tripwire asserting the
  audiobook ladder never grows a per-site rung.

One deliberate asymmetry worth keeping written down: **the seed-gap notice
does not run for `library2`** (`seedGap: false` in `APPS`). Her roster is her
household's, so "listed there but not in our estate directory" is the
permanent normal state, not a seed that missed someone — flagging it would
print a warning nobody could ever clear, which trains the reader to ignore the
whole line.

### Landed + verified 2026-08-16

Commit `71e4a0e`. Deployed to the apex from a throwaway
`git worktree add <tmp> HEAD` checkout, **not** from the working tree — two
other agents were mid-flight in this repo and one had
`public/assets/estate-theme.css` dirty at deploy time, which
`wrangler pages deploy <dir>` would have shipped. `check:home` refused the
direct deploy exactly as designed; the worktree pattern is the documented
recovery and it worked first time. Deployment:
`https://6ed48c0d.heygabi-home.pages.dev` → `heygabi.ai`.

| Verified | How |
|---|---|
| The shipped page carries the fourth column | `verify:home` (9 pages, every marker) + a direct fetch of `https://heygabi.ai/admin/admin.js`: `padhard.heygabi.ai`, `Sam's library`, `seedGap` all present |
| The filter row shipped | `/admin/` contains `id="f-role-library2"` |
| `/status` rows shipped | `status.js` contains `wk-library2` and `site-library2` |
| Her role surface refuses strangers | probes L21/L22 — `/api/admin/users` tokenless AND garbage-bearer → the worded 401 |
| Her CORS admits only the apex | probes L23/L24/L25 — apex gets ACAO + GET/PATCH, `evil.example` gets none |
| Her Worker is up, and it is HERS | `library2-health` H1–H6 read from `padhard.heygabi.ai` |
| The estate suite is whole | `npm run probe:estate` → **102 passed, 0 failed** (was 91) |
| auth-worker unregressed | `npm test` → **183 pass, 0 fail**; `npm run typecheck` clean |

⚠️ **NOT verified, and it is the half that matters most to the owner: the
SIGNED-IN table.** Everything above is the unauthenticated shell. The role
cells, the dropdown, the owner-auto-max rendering, and an actual grant landing
on her instance all need a Firebase sign-in this build never had. The owner
verifies it himself at **https://heygabi.ai/admin** — expand any member and
look for a fourth catalog row, "Sam's library", carrying a role dropdown
beside its visibility checkbox.

⚠️ **Also NOT verified: `padhard.heygabi.ai` in Firebase's authorised-domain
list.** It was added as D5 to `tools/estate-probes/authorized-domains.mjs`,
which needs a service account nobody had in hand. If her sign-in ever fails
`auth/unauthorized-domain`, that is the first thing to check.

⚠️ **auth-worker was NOT redeployed, deliberately.** This build changed no
line of its `src/` — only a test file — so a deploy would have shipped an
identical Worker, and in a shared checkout it risks publishing another agent's
committed-but-unshipped work. Nothing about the fourth column depends on it.

## Fine-grained pipeline step controls + shelf-server force-upload (owner ask 2026-08-16) — ✅ DONE

Owner: *"maybe in the admin status dashboard you give us fine control over
each part of the pipeline in case we need to do part way steps, do so in a
way to make sure we cant break stuff though"* + *"add a button to force a
full upload to the server that we can run to make sure we can move google
drive to server without the full pipeline."*

Built on `/status`'s Operations section (devops/approver-gated, unchanged
tier): 7 per-stage buttons (audit/sort/detect/folders/upload/catalog/publish)
classified by blast radius — read-only plain buttons, mutating/publishing
two-tap `confirmBtn` (now shared via `assets/estate-controls.js`, extracted
from `admin.js` so both pages use the one idiom), publishing steps carry a
standing "updates the live site" warning. THE SAFETY MODEL: every control —
including the standalone force-upload — takes the exact same single-flight
lock the scheduled 8h run already takes (audiobook_catalog's
`app/core/pipeline_lock.py`); the auth Worker also live-checks
`pipeline_status/current` before queuing (409 if busy, fails OPEN on a read
error since the lock downstream is the real guarantee); the one genuine
ordering dependency (Upload needs to know what's new) disables with a
reason using real `summary.toUpload` data, not a fabricated graph. Every
manual invocation is logged server-side (`pipeline_step_requested` /
`pipeline_force_upload_requested`). New auth-worker routes: `POST
/api/estate/ops/pipeline/step`, `POST /api/estate/ops/pipeline/force-upload`
(`ops.ts`), both `requireDevops()`, same as the existing pipeline trigger.
Force-upload is its own control, outside the step list (not a pipeline
stage) — the shelf server does not exist yet
(`audiobook_catalog/docs/access/SHELF_SERVER.md`), so it degrades honestly
("not configured"/"unreachable") via its own `shelf_upload_status/current`
Firestore doc, never the pipeline's own status row. audiobook_catalog side:
`scripts/sync_to_drive.py --step <name>`, new `scripts/sync_to_server.py`,
`app/tools/pipeline_watcher.py` dispatch, `firestore.rules` updates — see
that repo's own docs for detail. 10 new auth-worker tests (116→126), 67 new
Python tests (805→872), 7 new probes (71→78, all passing live). Deployed:
auth-worker, firestore rules (audiobook_catalog), apex.

---

---

## Estate API testing suite (owner ask 2026-08-15) — ✅ DONE

Owner: *"Maybe it's time to make an api testing suite"* — promote
`apps/auth-worker/test/live-probes.ts`'s idiom estate-wide. Built
`tools/estate-probes/` (plain Node, zero deps, `npm run probe:estate`):
54 read-only, unauthenticated-edge assertions against LIVE production across
all four `/api/health` envelopes, auth-worker (`/me`, `/hello`, `/docs/:slug`,
admin API — tokenless and garbage-bearer 401s, CORS admit/refuse), index-worker
(`/api/search` anonymous public-slice shape, `/universe`/`/lookup`/`/scan/shelf`
401s, CORS), library-worker's scan-jobs barcode intake (401 + CORS, read against
the sibling repo's route source, never edited), `audiobooks.heygabi.ai/ebooks.json`,
and the public Firestore `pipeline_status/current` REST doc. All 54 passed on
first live run (2026-08-15) — no findings, no production changes made or
needed. Signed-in 200-paths are explicitly OUT OF SCOPE (no authed probe
identity exists) — listed as future work in `tools/estate-probes/README.md`,
which also carries the "new estate endpoint → probe in the same commit" rule.
Indexed in `tools/README.md` and `docs/access/README.md`.

---

---

## Scan icons: barcode glyph vs camera glyph (owner ask 2026-08-15) — ✅ DONE

Owner: the apex's two scan icons were confusing (camera emoji sat on the
*barcode* scanner) — "give the barcode scanner a barcode icon and a photo icon
for the shelf and cover option… do this everywhere too." Estate-wide
convention now: **barcode modes show a barcode SVG, photo modes (shelf +
single-cover) show a camera SVG**, currentColor so they follow theme.
Canonical set is `ES_ICONS` in `estate-search.js`; the library and games scan
tabs carry vendored copies of the same paths (comment at each points back
here). Changed: apex `estate-search.js` (buttons + stop/busy states),
library `ScanPage.tsx` + `styles.css`, games `ScanJobsPage.tsx` + `styles.css`.

---

---

## 2. Visibility-scoped + anonymous search (B2) — ✅ DEPLOYED LIVE 2026-08-14

(The pair shipped together — index Worker migration 0003 + wrangler deploy, and the
Pages site — and was verified live: tokenless /api/search returns 200 with
scope ["audiobook"]. The section below is the build record.)

**Asked 2026-08-13** (owner-approved a+b), built the same day on `main`.
Estate design §4.5 is the contract; `index-worker-design.md` §9 Q3's
amendment names the carve-out.

- `/api/search` scopes to the caller's effective visibility set — in the SQL
  (`search-route.ts`), so out-of-scope rows never reach ranker, universe
  counts, or wire. Anonymous/invalid-token/pending ⇒ `{audiobook}`; revoked
  ⇒ `{}` (200 + `reason: no_catalogs_visible`, never 401). `/api/lookup`
  members-only untouched; `/api/universe` members-only, rows scoped.
- `estate_cache` carries visibility WITH status (migration **0003**, applied
  locally; remote apply is the dispatcher's). `@platform/estate-auth` gained
  `postSeenAnswer`/`Catalog`/`parseVisibility` — additive, `postSeen` and app
  consumers untouched.
- `find.js`: signed-out live-search of the audiobook slice with a quiet
  "sign in to search everything" affordance; scope note under partial-scope
  results; universe view still asks for sign-in.

**Pending (dispatcher, one step):** deploy the pair together — index Worker
(`apps/index-worker`: `npm run db:migrate` for 0003, then `wrangler deploy`)
**and** Pages (`sites/heygabi-home`) — a new find.js against the old Worker
would send tokenless searches into 401s. Verify after: tokenless
`GET https://index.heygabi.ai/api/search?q=dune` → 200 with
`"scope":["audiobook"]`.

---

## Done 2026-08-14 — audiobook members migrated; apex Admin affordances

- **All audiobook Firebase Auth accounts migrated into the estate directory**
  (owner ask). 10 accounts exported; 8 new rows inserted as **pending**,
  audiobook-only visibility, origin 'seed:audiobook'. Pending on purpose:
  the library posture auto-grants 'reader' to any APPROVED member, so
  approving at migration time would have silently granted app access —
  the Approve button on /admin is the deliberate grant moment.
- **Approver-only Admin link on the apex** — find.js probes GET /estate/users
  (a 200 IS the approver fact) and shows 'Admin' in the signed-in chip.
- **/admin sign-in flash fixed** — button ships hidden, neutral until
  watchAuth's first callback, 8s backstop (find.js's rule, applied).
- Commit 8b15d7c; deployed to Pages; all three verified live.
- Next owner-facing idea on file: deep-links from person surfaces in each
  catalog to /admin (see-someone-then-grant). Not ordered yet.

---

## In flight 2026-08-14 — /admin sort & filter (owner ask)

Sort + filter the estate member list: by estate status, approver flag,
per-catalog visibility (who can see what), and per-app role (who is an admin
where). All client-side — the page already holds the directory + both apps'
federated rosters. Dispatched same day.

---

## ✅ Estate Operations on the status page (owner order, 2026-08-15) — DEPLOYED

"Make sure the status page has all the pieces to RUN the pipelines" +
centralize controls away from individual sites, because the audiobook
pipeline is really an estate pipeline (it moves the ebooks too, via
sync_to_drive.py).

- `apps/auth-worker`: `POST /api/estate/ops/pipeline` (`src/ops.ts`),
  `requireApprover()`-gated, apex-only CORS. Writes the SAME
  `pipeline_requests` document audiobook_catalog's admin panel already
  writes (its `firestore.rules` `validPipelineRequest()` and
  `app/tools/pipeline_watcher.py` are untouched — this is a second producer
  of the existing contract) via the existing Firebase service account plus
  a new `PIPELINE_TRIGGER_TOKEN` secret, piped from audiobook_catalog's own
  `.env`. Deployed; secret set; unit tests + live probes (401 tokenless,
  403 non-approver/stranger, apex-only CORS, 503 config-error) all pass —
  probe suite never performs a real Firestore write.
- `sites/heygabi-home/public/status`: a new Operations section, gated on
  `GET /api/estate/me`'s `is_approver` (mirrors find.js's approver-probe
  pattern) — invisible to anonymous/non-approver visitors, who see the
  existing read-only rows unchanged. "Run audiobook pipeline" button +
  optimistic feedback + a faster poll to catch the Pipeline row flipping to
  RUNNING. A "Run levers" list deep-links every other run control instead
  of embedding it: the platform's three deploy targets (one workflow,
  `target=` choice), Backup, audiobook's Promote + Verify, and the legacy
  admin-panel trigger.
- `_headers`: `/status` + `/status/` CSP gained the sign-in trio
  (gstatic/apis.google.com script-src, identitytoolkit/securetoken
  connect-src, the Firebase authDomain + accounts.google.com frame-src) for
  the new sign-in affordance only — the six read-only hosts are unchanged.

⚠️ **The audiobook admin panel's own trigger (`site/admin.html` +
`site/pipeline-status.js`) is deliberately UNTOUCHED** — it still works
exactly as before, listed on the status page's Run levers as "legacy". Its
retirement (localStorage token entry replaced entirely by the estate path)
is a LATER OWNER DECISION, not made here.

**Awaiting the owner's first press**: the endpoint and UI are live and
verified as far as tokenless/non-approver probing and code-reading allow,
but the button itself was never clicked in anger during this build — it
starts a REAL local pipeline run with Google Drive side effects, so that
was deliberately left for the owner.

---

## ✅ Estate backups rewired to R2, not artifacts (2026-08-15) — DEPLOYED

`backup.yml` moved back into this repo (it had spent part of the day on the
private `skymitch9/estate-backups` repo to keep D1/Firestore/R2 export
artifacts off a now-public repo) and every job now writes straight into a
new **private** `estate-backups` R2 bucket via `wrangler r2 object put ...
--remote` instead of `actions/upload-artifact` — the artifact exposure this
was working around no longer applies regardless of which repo runs the
workflow. `CLOUDFLARE_API_TOKEN`'s R2-write permission was proven with a
throwaway smoke-test object before the rewrite; no owner-side token change
was needed. A new `retention` job (`scripts/prune-r2-backups.mjs`) keeps the
newest 8 objects per `<kind>/<store>` prefix on every dispatch. Proof run
(`target=all`, all 8 jobs + retention green) verified objects for all four
D1s, Firestore, and all three covers buckets, with the D1 export and
Firestore dump each sampled and confirmed byte-identical across two
independent downloads. Full detail: `docs/access/backup-restore.md`. The
`estate-backups` GitHub repo is now superseded (README updated, its own
`backup.yml` disabled) — kept only as a pointer, owner may delete it.

**Queued, not built — v2 idea:** a "last backup age" row on `/status`,
reading the `estate-backups` bucket's object listing (would need a small
Worker with Cloudflare-API access, since the status page has none server-
side today). Sized but deliberately not built this session.

---

## ✅ Four owner-ordered upgrades to universes/search (2026-08-15) — DEPLOYED

1. **Accessories de-clutter** ("make accessories a sub category in a
   universe page"; no include-checkbox by design). `apps/index-worker/
   src/search.ts`: a `unitDemotionTier()` on the `units.sort` inside
   `searchIndex` — `kind='accessory'`/`'promo'` game units sort BELOW every
   book/audiobook/base/expansion-game unit regardless of raw match score
   (previously `kindRank`'s tie-break only ordered them at EQUAL score; this
   is an outright demotion, so it also protects the `MAX_RESULTS` cap from
   an exact-match accessory bumping a real result out). Every consumer
   inherits it for free since none of them re-sort server output. Client
   side (`universes.js` + `estate-search.js`'s `_renderUniverse`): the
   universe expansion view groups game rows by kind — base/expansion stay in
   "Games", accessory/promo collapse into a native `<details>` "Accessories
   & promos (N)", COLLAPSED BY DEFAULT. `kind` was already on the
   `/api/universe/:name` wire (`ENTRY_COLS` in both `read.ts` and
   `search-route.ts`) — checked before assuming a server change was needed;
   none was. 7 new tests (`search.test.ts` ×6, `scope.test.ts` ×1 pinning
   `kind` on the wire).
2. **Alphabetical universes** — `universes.js`: `DISPLAY_NAMES`, a sorted
   copy of `UNIVERSE_NAMES` built once, is what `buildRows()` now iterates.
   `UNIVERSE_NAMES` itself stays in its historical add-order (a running log,
   per its own header) — display order only, no data change.
3. **Embed the component** — `universes/index.html` gets a new `#find`
   section at the top: `<estate-search auth="authed" universes>`, same
   wiring the front door uses (its own dynamic `estate-auth.js` import, its
   own neutral-boot sign-in). The hand-rolled browse list (`#uni-list`)
   stays underneath, unchanged — two ways to the same data, per §0.5's own
   sizing above.
4. **Member-implied universe autofill** ("if I search mistborn have it show
   cosmere as the search autofill"). `search.ts`: `searchIndex` now returns
   an additive `universeSuggestions` field — distinct universes the MATCHED
   rows belong to (from `scored`, pre-cap, so the count is the true matched
   count), excluding anything already in the name-matched `universes` field
   (never duplicate), capped at the top 2 by matched-row count
   (`MAX_SUGGESTED_UNIVERSES`). `estate-search.js`'s `_renderSearch` merges
   `data.universeSuggestions` into the same "Universes" group as
   `data.universes` — same row idiom, no client dedup needed since the
   server already excludes the overlap. Verified server-side that anonymous
   "mistborn" still surfaces the Cosmere suggestion (audiobook-slice rows
   carry `universe` same as every other source) — a dedicated route test
   pins this. 8 new tests in `search.test.ts` (the owner's own example, the
   never-duplicate rule, the top-2 cap with a tie-break, matched-row-only
   counting, plus the signed-out route case).

**Tests**: `apps/index-worker` — 79/79 pass (21 new), `npm run typecheck`
clean (both the main and test tsconfig). No DB migration — `kind` and
`universe` were already columns; nothing changed shape, only the ranking and
one additive response field.

**Review links**: https://heygabi.ai/universes (alphabetical order, the
embedded component, Marvel's 48 accessories + 2 promos collapsed by
default — the built-in demo case) and https://heygabi.ai (front door, search
"mistborn", confirm the Cosmere autofill row). See the deploy log for exact
verification performed signed-out vs. what still needs signed-in eyes.

---

## Index-push staleness — the real fix (sweep finding, 2026-08-15)

Backfill scripts write D1 directly and BYPASS the workers, so no index push
fires; the backstops ask a 24-HOUR staleness question, so data changes go
unnoticed for up to a day (this bit three times today: Boba Fett, the games
universe rows, the library universe rows — each needed a manual save-trigger).
Fix properly: (a) give both catalogs' backfill scripts a --push-index flag
(mint-and-call the push the way the workers do), or (b) gate the existing
checks on MAX(updated_at) > pushed_at instead of a clock. Small build, big
annoyance-removal. Queue for the next working session.

---

## ✅ Auth-lock the /todo page (owner order, 2026-08-15) — DEPLOYED

"Auth lock the todo page too" — `/todo` was CSS-only-radios and had never
gained a `<script>`, but it was still **public**: every board item shipped in
cleartext to anyone with the URL, `_headers`' `default-src 'none'` CSP or not.
That protected against the wrong thing (a hidden link, not a lock) — the
front door's Admin card already link-hid `/todo` behind an approver probe
(2026-08-15, same day, earlier order), but the URL itself answered for
anyone who had it. Same architecture as the earlier `/status` Operations
lock and `/admin`: content must LEAVE the public origin, not just be
harder to find.

- `apps/auth-worker`: `GET /api/estate/todo` (`src/todo.ts`),
  `requireApprover()`-gated, apex-only CORS (mounted in `index.ts`
  alongside `/api/estate/users`, `/api/estate/site-roles`,
  `/api/estate/ops/pipeline`). Returns `{ html }` — the board's `<main>`
  fragment, bundled as a plain TS string constant in
  `src/todo-board.ts` (**not** a wrangler text-module `import … from
  './todo-board.html'`: that idiom has no precedent in this Worker and
  would have broken `npm test`, since `tsx --test` does not read
  `wrangler.toml`'s `[[rules]]` module types the way `wrangler
  dev`/`deploy` do — see `todo-board.ts`'s own header for the full
  reasoning). Unit tests (`test/todo.test.ts`) pin the fragment's shape
  (starts `<main>`, carries all six filter-radio ids, no `<script>`, no
  secret-shaped words). Gating (401 tokenless, 403 approved-non-approver,
  403 stranger, 200 + fragment for an approver, apex-only CORS) is in
  `test/live-probes.ts` phases A/B/C/D (checks A37/A37v, B14–B16, C6, D6) —
  same idiom `ops/pipeline`'s gating uses, run against a real `wrangler
  dev`, never a Hono-level stub (`resolveIdentity()` needs a fully
  configured verifier context to answer 401 the way production does).
  **70/70 live-probe checks pass**, including every new one.
- `sites/heygabi-home/public/todo/index.html` rewritten as a content-free
  shim (no board items, no titles, no hints in the served HTML — verified
  by fetching the anonymous page and grepping for board text). Loads
  `../assets/estate-auth.js` (the front door's sign-in module, "neutral
  boot" + 8s backstop ported from `admin.js`'s 2026-08-14 sign-in-flash
  fix), then `public/todo/todo.js` fetches `GET /api/estate/todo` with the
  caller's Firebase ID token. 200 → the fragment is injected into
  `#board-mount` via `innerHTML` (safe: it is the Worker's own bundled
  content, never user-supplied) and the gate is hidden. 401/403 → the gate
  stays up, showing "This board is for the estate's admins." — no
  status-code-specific hint. The CSS-only radio filter is UNCHANGED: same
  six radios, same `:checked ~` rules, still zero JS in the filtering
  itself, verified working once injected (the fragment preserves the
  original direct-sibling structure `.filters`/`.board` need; no id
  collisions with the shim's own `gate-*`/`signin`/`who` elements).
- `_headers`: `/todo` + `/todo/` CSP replaced `default-src 'none'` (no
  script-src) with the sign-in allow-list — `script-src 'self'` +
  `www.gstatic.com` + `apis.google.com`; `connect-src auth.heygabi.ai` +
  `identitytoolkit.googleapis.com` + `securetoken.googleapis.com`;
  `frame-src` the Firebase authDomain + `accounts.google.com` — the same
  shape `/status`'s Operations section uses, not a general loosening.
  `img-src`/`style-src` unchanged (`'self' data:'` / `'unsafe-inline'`
  only — still one inline `<style>` block, no images beyond the favicon).
  The file's own header comment and the old `/todo` section are both kept,
  marked SUPERSEDED with the date, rather than deleted.
- Stale "no-JS"/"must never acquire JavaScript" claims corrected, same
  supersede-don't-delete treatment, in: `sites/heygabi-home/README.md`
  (three sections + the files table + the local-preview note),
  `sites/heygabi-home/public/index.html` (two comments — the CSP summary
  and the Admin card's link-hiding note, which used to say `/todo` "cannot
  authenticate" and now can), `docs/info/estate-auth-design.md` §14.4's
  `/todo` aside. `deploy.md`'s `/todo` checklist (§3) still applies
  unchanged for the filter tap-test; its "exactly one network request...
  has no JS and must never acquire any" line is now wrong and should be
  revisited before the next `/todo`-touching deploy walks that checklist.

**Content-update path, now deliberately slower**: editing the board means
editing `apps/auth-worker/src/todo-board.ts` + `wrangler deploy` from
`apps/auth-worker/` — **not** editing a file under `sites/heygabi-home/`
and re-running the Pages upload. This is a real cost, accepted because the
board changes rarely (documented in `todo-board.ts`'s own header and here).
A Pages deploy is only needed again if the SHIM (gate UI, auth wiring)
changes — not for a content-only edit.

**Verification performed**: `npm test` and `npm run probe` both green in
`apps/auth-worker` (see above). Pages deploy and the live
`https://heygabi.ai/todo` checks (anonymous HTML carries no board text,
tokenless `GET /api/estate/todo` 401s, CSP present on both `/todo` and
`/todo/`) are recorded in the deploy log / session report for this change.

---

## Estate API testing suite (owner proposal, 2026-08-15 — queued next)

Promote the auth worker's live-probes idiom (70 checks: real minted tokens,
synthetic users, role matrix, cleanup) to an ESTATE-WIDE suite in
catalog-platform: every worker's public + gated endpoints probed — index
(search/scan/universe/health), auth (estate/me/site-roles/ops/todo), library
API (incl. the audiobook-mapping machine route + the apex add flow's CORS),
games API. One runner (npm run probe:estate), per-surface sections, a
manual-dispatch workflow button, matrix output. First customer: the owner's
ordered EXTENSIVE scanning + add-to-catalog test pass (plus the coordinator's
browser session for signed-in UI flows the suite can't drive).
