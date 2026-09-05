# "+ Add a verse" on /universes — Information Reference

> **Audience:** Claude sessions first, the owner second.
> **Status:** TRACKED — ~~**BUILT 2026-09-02, phases 0–3. NOT DEPLOYED, and
> migration 0017 is NOT applied.** Phase 4 (notify on a decision) is still
> unbuilt.~~
> ⚠️ **Corrected 2026-09-05 (agent W2-VERSE4): both halves of that sentence are
> stale.** Phases 0–3 were DEPLOYED on 2026-09-02 ~15:00 (migration `0017`
> applied to remote `estate_auth`, `estate-auth` version
> `07dbe1b0-a58f-4980-a435-c8c01f909f34`, `heygabi-home` `18df9ec9`), and
> **PHASE 4 IS NOW BUILT** — commit `f2e7543`, ⚠️ **code landed, NOT deployed
> and migration `0019` NOT applied** (both are owner steps). What phase 4 is,
> what it deliberately is not, and the clause of §4 it departs from: **§8
> below**. The code of record is `apps/auth-worker/src/universe-requests.ts`,
> `apps/auth-worker/src/notifications.ts`,
> `sites/heygabi-home/public/universes/universes.js`, the `verse-queue` section
> of `sites/heygabi-home/public/admin/`, and `createUniverse()` in
> `tools/lib/universes.mjs`. What remains is on
> [`../TODO.md`](../TODO.md); what landed and why is in
> [`../DONE.md`](../DONE.md).
>
> ⚠️ **THREE THINGS BELOW ARE NOW STALE AS INSTRUCTIONS AND KEPT AS REASONING.**
> The design is left verbatim rather than rewritten, because the arguments are
> the value and a doc edited to match its own implementation stops being
> checkable against it. Where the build differs, it says so at the point of
> difference:
> 1. **The migration is `0017`, not `0016`** (§3.4) — `billing_policy` took 0016
>    while this sat unbuilt. The shape is the design's, verbatim.
> 2. **There are FIVE statuses, not four** (§3.4) — `withdrawn` was added when
>    §6 Q4 was built as recommended.
> 3. **§3.5's `GET …/names` did NOT delete the page's hardcoded list** (§2) — it
>    demoted it to the SIGNED-OUT fallback. That route is members-only, and
>    "sign in to see which universes exist" would be a worse page. The parity
>    tripwire still holds it.
>
> Last verified: **2026-09-02** — the build session read every file:line below
> again and exercised the routes under `node --test`. ⚠️ **NOT verified:**
> anything live. Nothing was deployed, no remote D1 was touched, and no page was
> opened in a browser. Effort figures are still **labelled guesses**.

The owner's ask, 2026-08-24, verbatim:

> *"in the universe page add a plus button somewhere to add a verse and let it
> take series as an input"*

---

## 1. ⚠️ Why the button cannot simply "add a verse"

The obvious build — a form that POSTs and a universe appears — is impossible
here, and the reason is not caution. **A universe is not a row anywhere in this
estate.** It is a decision compiled into two catalogs' bundles, pinned by a
test, and the pin is deliberate.

| Fact | Where it is proven |
|---|---|
| The one copy of the list is a FILE in git | `data/universes.json` — 17 universes, `schemaVersion` + `canonicalNames` + `universes[]` + `_refused[]` |
| It is edited by a CLI, never a UI, **on purpose** | `tools/universes.mjs:4-9` — *"Deliberately a CLI and not a web UI: a browser cannot commit to a git repo… A web editor would need a second representation of the list, and two representations drift"* |
| ⚠️ **The CLI CANNOT create a universe** | `tools/universes.mjs:126-129` — *"This CLI does not create or delete universes. Six exist, each with owner sign-off recorded in its `confirmed` field; a seventh is a decision to make in the file, with its evidence, not a command to run."* |
| Every mutating command demands a reason | `tools/universes.mjs:21-22`; `--why` is checked in `tools/lib/universes.mjs` and `saveChecked()` (`tools/universes.mjs:81-95`) refuses a write that would not validate |
| It reaches the catalogs as a **build artifact** | `library_catalog/scripts/sync-universes.mjs:1-24` — materialises into `packages/universes/generated/`, gitignored, rewritten every run, wired as `prebuild`/`pretest`/`pretypecheck` (`library_catalog/package.json:15,36,38`) |
| ⚠️ **A TRIPWIRE TEST fails if the list changes** | `library_catalog/packages/core/test/universes.test.ts:347-380` — `assert.deepEqual(universeNames, [...17 names...])`, whose own comment says: *"This assertion failing is this file WORKING: a universe cannot appear in catalog-platform without a decision landing here too."* |
| A second tripwire forbids a second registry | `library_catalog/packages/core/test/universes-single-writer.test.ts:1-50` — the owner's *"I don't want duplicate universes"*, made mechanical |
| A missing platform repo **fails the build** | `library_catalog/scripts/sync-universes.mjs:17-23` — chosen, so a Worker never ships an empty list |

So the chain from "somebody wants Discworld" to "Discworld exists" is:

```mermaid
graph LR
    A["a member on /universes<br/>presses +"]:::web
    B["PENDING request<br/>estate D1 (auth-worker)"]:::db
    C["owner approves<br/>on /admin"]:::owner
    D["data/universes.json<br/>edited + committed"]:::git
    E["tripwire test updated<br/>library_catalog"]:::git
    F["both catalogs rebuilt<br/>+ deployed"]:::deploy
    G["the verse is real"]:::web
    A --> B --> C --> D --> E --> F --> G
    C -.->|"decline + named reason"| A
    classDef web fill:#4a6fa5,color:#fff,stroke-width:0
    classDef db fill:#2f4858,color:#fff,stroke-width:0
    classDef owner fill:#d9a441,color:#000,stroke-width:0
    classDef git fill:#3a5a40,color:#fff,stroke-width:0
    classDef deploy fill:#b3453a,color:#fff,stroke-width:0
```

**The button is real. What it creates is a REQUEST, and the page says so in
those words.** That is not a downgrade of the ask — it is the only shape that
does not create the second representation `tools/universes.mjs`'s own header
refuses.

⚠️ **The alternative was considered and rejected:** make `data/universes.json`
writable at runtime (a D1 table, a KV blob) so the browser can append. That
deletes the git history that is *the entire value of the file* (every entry
carries `confirmed` / `evidence` / `why`), breaks the single-writer contract
`universes-single-writer.test.ts` exists to hold, and would make the two
catalogs' bundled copies disagree with the live list between deploys. Not a
close call.

---

## 2. What exists today on `/universes`

| Piece | Path |
|---|---|
| Page shell | `sites/heygabi-home/public/universes/index.html` |
| Browse list + expand | `sites/heygabi-home/public/universes/universes.js` |
| The universe names | ⚠️ **HARDCODED in the page** — `universes.js:70+`, `const UNIVERSE_NAMES` |
| Per-universe contents | `GET https://index.heygabi.ai/api/universe/:name` — members-only (`index-worker/src/read.ts:11`, under the `requireEstateMember()` blanket at `index-worker/src/index.ts:96`) |
| Series names (the autocomplete source) | `GET https://index.heygabi.ai/api/series` — members-only **and visibility-scoped** (`index-worker/src/series-route.ts:1-31`) |
| Auth | `assets/estate-auth.js`, neutral-boot (`universes.js:13-18`) |

### 🔴 Two live discrepancies found while reading, both worth fixing regardless

1. **`universes.js`'s hardcoded list holds 16 names; `data/universes.json`
   holds 17.** `DotHack` is missing from the page. The page's own header
   (`universes.js:28-35`) predicted this — *"Keep this list in sync… by hand;
   outgrowing it is the moment to add a real 'list names' route"* — and its
   comment still says *"so 16 now"* (`universes.js:69`). **The page has been
   silently one universe short.** Measured 2026-08-26: `UNIVERSE_NAMES.length
   === 16`, `data/universes.json.universes.length === 17`.
2. **`tools/universes.mjs:127`'s help text still says "Six exist".** There are
   17. A stale sentence in the one file that teaches a session the rule.

Both are one-line fixes and both are *arguments for §4's Phase 0*: the moment
the page grows a "+" it must stop guessing what the list is.

✅ **BOTH FIXED 2026-08-26** — recorded here so a later reader does not chase a
closed finding. `DotHack` is on the page and the help text derives its count
from the data file. ⚠️ **Neither was left as the one-line fix this section
predicted**, and that is the lesson: a by-hand sync note is not a guard, so the
page's list is now diffed against `data/universes.json` by
`scripts/test/universe-names-parity.test.mjs` (which `npm run deploy:home` runs
before it uploads anything), and the CLI's count is derived rather than typed.
The design's own argument stands unchanged — the tripwire makes the duplication
survivable, it does not make it right; a real "list names" route is still what
the "+" needs.

---

## 3. The design

### 3.1 Who may press "+"

| Standing | May press "+" | Sees pending requests |
|---|---|---|
| Signed out | ❌ — the button is **not rendered**; the page shows its existing sign-in invitation | ❌ |
| `pending` / `revoked` estate member | ❌ — not rendered; the row reads *"universe requests are for approved members"* | ❌ |
| `approved` member | ✅ **submit a request** | ✅ own requests only |
| `is_approver` (owner + approvers) | ✅ submit **and** approve/decline | ✅ all |

The standing comes from the answer the page already has: `GET
/api/estate/me` (`auth-worker/src/me.ts`, route `estate.ts:334`), whose
`status` and `is_approver` fields are exactly these two questions. **No new
predicate is invented** — `approverAllows()` (`middleware/auth.ts:56`) is the
one implementation, and the button is a curtain, never the lock.

⚠️ **Recommendation: requesting is member-wide, not approver-only.** A request
spends nothing, writes one row, and is the whole point of the ask. The
access-*increasing* step — the thing that actually changes the estate — is
approval, and that stays with `requireApprover()`.

### 3.2 The form

Fields, in order, all on one panel:

| Field | Kind | Rules |
|---|---|---|
| **Name** | text, required | Live duplicate/alias check — §3.3 |
| **Series** | repeatable autocomplete, ≥1 recommended, 0 allowed | Source: `GET /api/series`; free text accepted, because a series the estate does not hold yet is a legitimate answer |
| **Also these exact titles** | repeatable text, optional | Maps to `bookOverrides` — the seriesless-standalone case (`Fires of December`) |
| **Deliberately NOT** | repeatable text, optional | Maps to `notSeries` / `bookExclusions` — the `Frugal Wizard` case |
| **Why** | textarea, **required** | ⚠️ Mirrors the CLI's `--why`. `tools/universes.mjs:21-22`: *"an entry that cannot say why it exists is refused."* The form must not be softer than the CLI |
| `decidedHow` | not shown | ⚠️ **Always `'human'`, server-set.** A person filled this in; nothing else is honest |

⚠️ **`decidedHow` is set by the SERVER from the request's provenance, never
sent by the browser.** A client-supplied `'human'` is a claim, not a fact, and
this field is what later readers use to know how much to trust an entry.

### 3.3 Duplicate and alias detection — the part that must not be lazy

The estate already has the right instrument and it is not string equality.
`data/universes.json` carries `canonicalNames` (lowercased-and-normalised
alias → the owner's spelling: `"cosmere" → "The Cosmere"`, `"arandverse" →
"Runnerverse"`, `"zodiac academy universe" → "Solaria"`, …) plus
`_pinnedCanonicalNames`, which exists precisely so a rename cannot quietly
reverse a decision. `tools/universes.mjs` exposes it as `canon <name>`
(`universes.mjs:243-250`, calling `canonicalName()` from
`tools/lib/universes.mjs`).

So the check, in order:

1. Normalise the typed name the same way `canonicalName()` does.
2. **Exact universe name** → *"Runnerverse already exists"* + a link to that
   row.
3. **Known alias** → ⚠️ *"That's a spelling of **Runnerverse** — the estate
   already has it under that name."* This is the case a naive check misses and
   it is the common one.
4. **Near-miss** (edit distance, or one is a substring of the other) →
   a **warning, not a block**: *"Close to **Solaria**. Still a different verse?"*
   with a "yes, different" checkbox.
5. Otherwise → free to submit.

⚠️ **Steps 2–3 hard-block; step 4 never does.** `Marvel` / `Disney` /
`Star Wars` are three universes the owner deliberately split apart
(`universes.test.ts:348-354`); a similarity check with a veto would have
refused two of them.

⚠️ **The check must run SERVER-side on submit as well as live in the form.**
The browser's copy of `canonicalNames` is a convenience; the row that lands in
D1 is the one that matters.

### 3.4 Where a pending request lives

**The auth Worker's estate D1** (`estate_auth`, binding `DB`,
`apps/auth-worker/wrangler.toml`), a new additive migration `0016`.

Why there and not in the index Worker: the estate directory is where
cross-site *facts about members* live, it is the only D1 whose write protocol
is not bulk-replace (`estate-auth-design.md` §4.1, quoted in
`auth-worker/wrangler.toml`'s header), and the approve/decline surface is
`/admin`, which already talks only to this Worker.

```sql
-- 0016: universe requests. PURELY ADDITIVE — one CREATE TABLE IF NOT EXISTS
-- on a new object, the same property that made 0012/0013/0014 safe to apply
-- remotely and unattended.
CREATE TABLE IF NOT EXISTS universe_request (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,          -- as typed; never folded on write
  name_key      TEXT    NOT NULL,          -- normalised, for the dup check
  payload       TEXT    NOT NULL,          -- JSON: series[], titles[], notSeries[]
  why           TEXT    NOT NULL,          -- ⚠️ NOT NULL — the CLI's --why, kept
  requested_by  INTEGER NOT NULL REFERENCES estate_user(id),
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','declined','landed')),
  decided_by    INTEGER REFERENCES estate_user(id) ON DELETE SET NULL,
  decided_at    TEXT,
  decided_why   TEXT,                      -- ⚠️ the named reason, back to the requester
  landed_commit TEXT                       -- filled when the git change actually ships
);
CREATE INDEX IF NOT EXISTS ix_universe_request_status ON universe_request(status);
```

⚠️ **`payload` is JSON text stored whole and unparsed** — the same decision
`estate_prefs` (0014) made, for the same stated reason: the shape will grow,
and a schema naming today's four lists needs a migration the day a fifth is
wanted.

⚠️ **FOUR statuses, not three, and the fourth is the honest one.** `approved`
means *the owner said yes*. `landed` means *the JSON change, the tripwire edit
and both deploys are done*. Collapsing them would let the page tell a member
their verse exists while `universes.json` has not been touched — exactly the
shipped-≠-verified failure the estate's own rules name. **The page must show
`approved` as "approved — waiting on the next build", never as done.**

### 3.5 The routes

| Route | Gate | Does |
|---|---|---|
| `POST /api/estate/universes/requests` | approved member (identity via `resolveIdentity`, as `/estate/hello` does at `estate.ts:296`) | Creates one `pending` row. Runs the server-side dup/alias check; 409 with a **worded** body on an exact/alias hit |
| `GET /api/estate/universes/requests` | approved member | Own rows. With `is_approver`, every row |
| `POST /api/estate/universes/requests/:id/decide` | `requireApprover()` (`middleware/auth.ts:148`) | `{ decision: 'approved' \| 'declined', why }`. ⚠️ **`why` required on a decline** |
| `POST /api/estate/universes/requests/:id/landed` | `requireDevops()` | `{ commit }` — the session that ships the change closes the loop |
| `GET /api/estate/universes/names` | approved member | ⚠️ **The fix for §2 discrepancy #1.** Serves the canonical name list + `canonicalNames`, so the page stops carrying a hand-synced copy |

⚠️ **Every refusal on every one of these says three things** (what happened, what
it needs, how to get it) per the estate's own wording rule. Concretely:

- signed out → *"Sign in to ask for a new verse."* (+ the sign-in button)
- `pending` → *"Your estate membership is still awaiting approval, so requests
  are closed for now. The owner sees your name on /admin."*
- `revoked` → *"Your estate access was revoked. Ask the owner."*
- not an approver, hitting `/decide` → *"Approving a verse is the owner's call.
  Yours is request #12, still pending."*
- ⚠️ a 500/timeout → *"Couldn't reach the estate directory — that's an outage,
  not a permissions problem. Try again in a minute."* **A network failure is
  never rendered as a refusal.**

### 3.6 What the page shows while pending

The browse list gains one section **above** the universe rows, rendered only
when the viewer has at least one request (or is an approver and any exist):

```
◇ WAITING ON A DECISION
  Discworld            requested by you · 2 days ago      [ pending ]
     3 series · "the whole Ankh-Morpork thing"            [ withdraw ]
  Wheel of Time        requested by you · 6 hours ago     [ approved — waiting on the next build ]
  Sanderson Extended   requested by you · 2026-08-20      [ declined ]
     ↳ "That's The Cosmere under another name."
```

Rules:

- A pending row is **never drawn as a universe row** — different section,
  different chrome, an explicit status chip. A member must not click it and
  find nothing.
- `approved` reads **"approved — waiting on the next build"**, per §3.4.
- `declined` shows the owner's `decided_why` verbatim, always. A decline with
  no reason is refused by the route, so the UI can rely on there being one.
- `landed` rows disappear from this section, because by then the universe is a
  real row in the list below.
- ⚠️ A member sees **only their own** requests here. Approvers see all, with
  the requester's display name.

---

## 4. Rollout — what a session can do, and what only the owner can

⚠️ **This is the section to read before promising anything.** The steps split
cleanly, and the split is not negotiable.

| # | Step | Who | Why |
|---|---|---|---|
| 1 | Read the request off D1 | **session** | plain read |
| 2 | Run `node tools/universes.mjs canon "<name>"` to re-check the alias fold | **session** | one command, no write |
| 3 | ⚠️ **Create the universe object in `data/universes.json`** | ⚠️ **OWNER-GATED — no tool exists** | `tools/universes.mjs:126-129`: the CLI has no `create`. Adding one is itself a decision, not a fix (§6 Q1) |
| 4 | `add-series … --why "<the requester's why>" --decided-how human` for each series | **session**, once the object exists | `universes.mjs:246` |
| 5 | `node tools/universes.mjs validate && … fixtures` | **session** | `package.json:14` runs both |
| 6 | ⚠️ **Edit the tripwire** `universes.test.ts:362` to hold the new name, in order | **session** | The test is *designed* to fail; editing it in the same commit is the intended workflow, and the comment at `universes.test.ts:358-361` says so |
| 7 | Update the counts assertion `universes.test.ts:382+` | **session** | It pins per-universe series/override/exclusion counts |
| 8 | Update `sites/…/universes/universes.js`'s `UNIVERSE_NAMES` | **session** — *or delete the need for it entirely by shipping `GET /api/estate/universes/names` (§3.5)* | §2 discrepancy #1 |
| 9 | Commit `data/universes.json` + the test edit | **session**, on a branch | ⚠️ Never on `main` without the owner |
| 10 | `npm test` in `library_catalog` (pretest re-syncs) | **session** | `library_catalog/package.json:38-39` |
| 11 | **Rebuild + deploy `library_catalog`** | ⚠️ **OWNER** — a deploy | The generated copy only changes at build time |
| 12 | **Rebuild + deploy `audiobook_catalog`** | ⚠️ **OWNER** — a deploy, and it is the pipeline machine | Same |
| 13 | **Deploy `heygabi-home`** if step 8 touched the page | ⚠️ **OWNER** — and ⚠️ **directory-upload deploys ship the WORKING TREE**, so from a clean tree or a throwaway worktree only (`info/worktree-deploys.md`) |
| 14 | `POST …/requests/:id/landed { commit }` | **session** | Closes the loop; the requester's row flips from `approved` to gone |

**So: a session can prepare everything and can push a branch. It cannot create
the universe object (no tool), and it cannot deploy.** Steps 3, 11, 12 and 13
are the owner's, and the doc says so rather than letting a future session
discover it at step 11.

### Phases and rough effort

⚠️ **These are labelled guesses, not measurements.**

| Phase | What lands | Rough effort | Blocks on |
|---|---|---|---|
| **0** | Fix the two §2 discrepancies; ship `GET /api/estate/universes/names`; the page reads it | ~½ day | nothing — do this first, with or without the rest |
| **1** | Migration 0016, the four request routes, tests, `/admin` list with approve/decline | ~1 day | Q1 (does the CLI grow `create`?) does **not** block this |
| **2** | The "+" button, the form, live alias check, the pending section on `/universes` | ~1 day | Phase 1 |
| **3** | `tools/universes.mjs create` (if the owner wants it) + a `apply-request` command that reads a `landed`-bound row | ~½ day | ⚠️ Q1 — owner decision |
| **4** | ✅ **BUILT 2026-09-05** (`f2e7543`, not deployed) — notification when a request is decided (reuse `estate_prefs`/`notify-prefs.ts`) — ⚠️ **as-built and its two departures: §8** | ~½ day | Phase 1 |

⚠️ **Phase 0 stands alone and is worth doing even if the owner says no to the
whole feature** — the page is currently one universe short and the CLI's help
text is wrong by eleven.

---

## 5. What this deliberately does NOT do

- **No second universe registry.** Requests are requests; the list stays
  `data/universes.json`. `universes-single-writer.test.ts` keeps holding.
- **No auto-apply on approve.** The owner pressing "approve" does not run a
  tool, does not commit and does not deploy. It sets a status. Everything after
  that is §4, done by a person or a briefed session.
- **No editing of existing universes from the browser.** Adding a series to
  `The Cosmere` is `tools/universes.mjs add-series`, and stays so. Widening
  this surface to edits is a separate decision.
- **No decline without a reason.** Enforced at the route, not just the form.

---

## 6. Open questions — each with a recommendation

### Q1 ⚠️ Should `tools/universes.mjs` grow a `create` command?

Today it refuses to, in writing, and the refusal is load-bearing: *"a seventh
is a decision to make in the file, with its evidence, not a command to run"*
(`universes.mjs:126-129`). But there are 17 now, not six, so somebody has been
hand-editing the JSON eleven times — the refusal has been routed around rather
than honoured, and a hand edit is the one path with no `--why` enforcement and
no validation gate.

> **Recommendation: yes — add `create <name> --why W --confirmed "<owner's own words>"`,
> and make `--confirmed` REQUIRED.** That is stricter than today's hand edit,
> not looser: it forces the owner's sign-off into the field the file already
> reserves for it, runs `validate` + `fixtures` before writing (`saveChecked`,
> `universes.mjs:81`), and leaves the tripwire test to catch it downstream
> exactly as designed. The CLI's refusal was protecting *the decision*; it
> ended up protecting *the syntax*.

### Q2 Where does the approve/decline queue live — `/admin`, or `/universes`?

`/admin` today is a single Members surface (`sites/heygabi-home/public/admin/index.html`
— `#controls`, `#users`, `#permission-map`; no tabs). Adding a queue means
either a new section on that page or the page's first tab.

> **Recommendation: a new collapsed section on `/admin`, below the member
> list — not a new page and not a tab bar.** The estate's own rule is one
> surface per question, and *"what is waiting on my decision"* is the same
> question `/admin` already answers about pending members. A tab bar is a
> redesign of a page whose header explicitly says its last change was *"a
> REGROUPING, not a redesign"* (`admin/admin.js:154`). If the queue is
> routinely long, promote it to a tab then — with a measurement.

### Q3 ⚠️ What happens to a request whose universe the owner approves but nobody ever ships?

Between `approved` and `landed` the estate is in a state where a person has been
told yes and nothing exists. That gap is a deploy away, and deploys here are
manual (§4 steps 11–13).

> **Recommendation: the `/admin` section shows an `approved` row's AGE in days,
> and anything over 7 renders in the warn colour with *"approved 9 days ago,
> not yet in a build"*.** Cheap, honest, and it is the same instrument the
> estate already trusts elsewhere — a staleness label on a number
> (`claude-usage.ts`'s `STALE_AFTER_MS`, `shelf-parity.ts`). ⚠️ It does not fix
> the gap; it makes the gap visible, which is the only thing a page can
> honestly do about somebody else's deploy.

### Q4 (minor) May a member withdraw their own pending request?

> **Recommendation: yes.** Access-*reducing*, reversible, costs nothing, and it
> keeps the queue honest. `POST …/requests/:id/withdraw`, requester-only, and
> only while `status='pending'`.

### Q5 (minor) Should the series autocomplete show series the requester cannot see?

`GET /api/series` is visibility-scoped by design (`series-route.ts:17-26`) —
listing the registry would leak series names from catalogs a member has no
access to.

> **Recommendation: leave it scoped, and say so in the field's hint** —
> *"series from the catalogs you can see; type anything else freely."* Free
> text is already accepted (§3.2), so nothing is actually blocked; only the
> suggestions are narrower.

---

## 7. What was NOT verified

- **Nothing live.** No request to `index.heygabi.ai` or `auth.heygabi.ai`, no
  D1 query, no browser. Every claim is source-read.
- **`tools/lib/universes.mjs` was not read in full** — `canonicalName()`'s exact
  normalisation is inferred from `canonicalNames`' `_note` (*"Lowercased-and-normalised
  alias"*) and the CLI's `canon` command, not from the function body.
- **`audiobook_catalog`'s universe consumption was not read.** `sync-universes.mjs:21-23`
  says it makes the opposite failure choice (does not fail the build), which is
  why §4 step 12 exists; the code behind that sentence was not opened.
- **The effort figures are guesses.** No comparable build was timed.
- **The `/universes` page has not been opened in a browser this session**, so
  the 16-vs-17 discrepancy is proven from source (`UNIVERSE_NAMES.length`) and
  not from what a visitor actually sees.

⚠️ **Two stray XML tags (`</content>`, `</invoke>`) sat here from 2026-08-26
until 2026-09-05** — a tool artifact that had been rendering as literal text at
the bottom of the doc. Removed by W2-VERSE4; nothing else in §7 was touched.

---

## 8. Phase 4 as built — 2026-09-05 (`f2e7543`, ⚠️ NOT DEPLOYED)

> **Last verified: 2026-09-05** for **this section only** — the suite was run
> (`682 → 721 pass / 0 fail`) and `tsc` is clean on both projects. ⚠️ **Nothing
> was measured live: `estate-auth` was NOT deployed, migration `0019` was NOT
> applied, and no notice has ever been written** — no verse request has ever
> been filed (`SELECT COUNT(*) FROM universe_request` = 0, read remote
> read-only earlier the same day). §§1–7 above were NOT re-measured.

### 8.1 What the one-line clause could and could not be honoured as

§4's phase table says *"reuse `estate_prefs`/`notify-prefs.ts`"*. Half of that
is exactly what happened, and half of it does not fit:

| Half | Verdict |
|---|---|
| The **opt-out** | ✅ **Reused.** One row per person in `estate_prefs` (0014) under `notify:user:<id>`, parsed with `notify-prefs.ts`'s own idioms — defaults filled in, ⚠️ refuses-never-strips on write, and ⚠️ an unreadable row falls back to the DEFAULTS rather than to silence (its argument, quoted: a corrupted value turning notices off without saying so is experienced as *"the estate went quiet"*, which is indistinguishable from *"nothing happened"*) |
| The **messages** | 🔴 **Could not be.** `estate_prefs` is one row per KEY of owner-set settings that the CONDUCTOR reads. A stream of dated messages addressed to people is not a settings row. So phase 4 needed **migration `0019_estate_notification.sql`**, which the design never named — ⚠️ **said loudly here, in 0019's own header and in the module header**, rather than left for a reader who trusted the phase table to discover |

⚠️ `0019` is **purely additive**: one `CREATE TABLE IF NOT EXISTS` on a new
object plus one index, no `ALTER`, no `DROP` — the property that made
0012/0013/0014/0017/0018 safe to apply remotely and unattended.

### 8.2 🔴 What this IS: in-app delivery. Nothing here sends anything.

**No phone buzzes, no email is sent, nobody is DM'd**, and that is a fact about
the estate rather than an omission in the build: **this Worker holds no
outbound channel to a member.** `notify-prefs.ts` is the OWNER's phone,
delivered by the *conductor*, which reads those prefs over its own bearer;
there is no equivalent for anybody else.

| Channel | Why it is not built |
|---|---|
| Email | Needs a mail credential this Worker does not have and no repo holds |
| A GABI DM | Needs `estate-auth` to hold a Discord bearer **and** `CONSUMER_APPS` to accept one — ⚠️ which `test/dev-access.test.ts` guards against by name, as *"a capability nobody granted it"*. The same blocker `TODO.md`'s billing item records |

Both are **access-INCREASING**, so they are the owner's to mint, not an
agent's to assume. The queue is built and the channel is **named**; a later
deliverer drains these rows. Until one exists the estate is honest that a
notice **waits to be READ** rather than claiming it was **SENT**.

### 8.3 Why this is not a second copy of the /universes queue

The estate's one-fact-one-home rule applies to SURFACES, and it would refuse a
second place to read the same status. This is not one:

- The **queue** answers *"what is the state of my requests"* — a list you go and
  look at, always current.
- A **notice** answers *"what changed since I last looked"* — dated, quoting the
  decider's words **as they stood at the moment of the decision**, markable
  read. ⚠️ Rendering it by re-reading the row would make a message about the
  past change when the past changes, which is how *"you were declined because
  X"* becomes a sentence nobody ever wrote.

The status is the fact; the notice is the event.

### 8.4 And it is not the worker event ring

`worker-events.ts`'s own header forbids it: *"a noticeboard, not a log … errors,
refusals worth a human's attention, and deploy markers. **Not requests.**"* It
is also **per-WORKER** and read behind `requireDevops()`, so a member could
never see a line addressed to them. ⚠️ **The ring IS used for exactly one
thing, which is the thing it is for:** when writing a notice FAILS, one `warn`
line goes to it. A notifier that fails silently is worse than none, because the
silence is then trusted.

### 8.5 The three refusals, each pinned by a test

1. 🔴 **Nothing is written when there is no requester.** A row authored by a
   seed, a script or a `system` principal has nobody to tell, and inventing a
   recipient writes a message nobody is owed into somebody's inbox.
2. 🔴 **An opt-out means the notice does not EXIST**, not that it is stored and
   hidden. The switch is consulted by the writer, in the one place a notice is
   written (`writeNotice()`), so no future caller can route around it.
3. 🔴 **A FAILED NOTICE NEVER FAILS THE DECISION.** `notify()` is the last
   statement in the handler, hands its work to `waitUntil`, and swallows every
   path — the decision is already durable in D1, and throwing would turn a
   completed approval into a 502 the approver would reasonably retry. ⚠️ **The
   retry would meet `already_decided`.**

### 8.6 ⚠️ `landed` is notified too, and §4's clause did not ask for it

The clause says *"when a request is **decided**"* and is silent about `landed`.
This is a **deliberate extension**, and §3.6 is the argument: *"`landed` rows
disappear from this section, because by then the universe is a real row in the
list below."* Without a notice, the last thing that ever happens to a request
from the requester's side is that **it silently vanishes** — and the one moment
the verse actually exists is the one moment nobody tells them. A `verse_landed`
notice carries the commit, because that is the checkable half.

⚠️ **`approved` still never reads as done** in any of the three notices — the
approval notice says *"it is not live yet"* and a test refuses any sentence
claiming the verse now exists. That is §3.4's fourth status, defended in the
one place a person actually reads a sentence about it.

### 8.7 The doors

All `requireApprovedMember()`; all apex-CORS-mounted in `index.ts` (⚠️ **a route
does not imply a mount** — the omission that made the ingestion pause card
unreachable from a browser while answering `curl` perfectly).

| Route | Does |
|---|---|
| `GET /api/estate/notifications` | Your own, newest first, plus an `unread` count and the class list |
| `POST …/notifications/:id/read` | Yours only. ⚠️ Somebody else's is a **404, not a 403** — a 403 confirms it exists |
| `POST …/notifications/read-all` | Clears a badge in one call rather than N |
| `GET \| POST …/notifications/prefs` | Your own switches. Switching your own notices off is access-REDUCING and needs nobody |

⚠️ **An approver gets no special read.** A notice is addressed mail, not a
queue; the approver's queue is `/admin`, which is a different question with its
own door. A Worker ahead of `0019` answers **200 with an empty list and the
fix**, because a page with no notices and a page whose Worker is ahead of its
migration look identical to a person and only one of them is worth a word.

### 8.8 🔴 What is left, and it is not code

- ☐ **Deploy `estate-auth` + apply `0019`** — owner steps, in that order
  (migrate before deploy). `npm run db:migrate` from `apps/auth-worker`, then
  `npx wrangler deploy`.
- ☐ **A surface that draws a notice.** The routes exist; no page reads them yet.
  Until one does, a requester still learns their answer the way they did on
  2026-09-02: by visiting <https://heygabi.ai/universes/> and reading the row.
  ⚠️ **That is a smaller gap than it sounds and a real one all the same** — the
  notice's value is telling somebody who is *not already looking*.
- ☐ **A real notice has never been written**, because no request has ever been
  filed.

### 8.9 The front end, as built — 2026-09-05 (agent `W3-NOTICES-UI`)

> **Last verified: 2026-09-05** for **this section only** — `npm test` at the
> repo root, `npm run check:home` and `npm run verify:home` were run, and the
> deployed bundle was fetched cache-busted. ⚠️ **NOT verified: nobody has seen
> the bell signed in.** A session cannot sign in as a person; every claim below
> about what a *member* sees is proven against the stub-DOM harness and the
> Worker's source contract, never against a browser. §§1–8.8 were not
> re-measured.

**The second ☐ of §8.8 is closed in code.** `assets/apex-notices.js` +
`assets/apex-notices.css`, linked from `/` and `/universes/`.

#### 8.9.1 Where it lives, and why there is only one of it

The bell hangs off **`<estate-search>`'s one extension point — the light-DOM
child carrying `slot="who-extra"`**, which renders inside the component's own
signed-in "who" line (`assets/estate-search.js`, `.es-who`: *"Signed in as
Amber · sign out"*). That line is the estate's single canonical rendering of
"the front door learnt who you are", and the seam already exists precisely so a
host page can hang something on it without the component learning what it is —
`apex-admin-link.js` used it for the Admin chip until 2026-08-16.

⚠️ **This is a one-fact-one-home decision, not a convenience.** A bell drawn
per page would be N copies of an unread count, and the estate has already been
bitten by two surfaces answering one question with different numbers. So: one
module, one stylesheet, and a page opts in with a `<link>` and a `<script>` and
no new code.

| Page | Draws the bell? | Why |
|---|---|---|
| `/` | ✅ | embeds `<estate-search auth="authed">` (`#find-search`) |
| `/universes/` | ✅ | embeds `<estate-search auth="authed">` (`#uni-search`) — ⚠️ and it is the page the requester is on |
| `/series/` | ❌ | deliberately embeds **no** `<estate-search>` (that page's own head comment: it keeps the page's CSP tighter) |
| `/admin/`, `/status/*`, `/todo`, `/docs` | ❌ | gated operator surfaces with their own sign-in; a member's addressed mail is not an ops surface |

The module finds the component with `document.querySelector('estate-search')`
rather than by id, because the two pages give it two different ids
(`find-search`, `uni-search`) and a module that hardcoded one would be silently
dead on the other — the failure being avoided is *"it works on the front door,
so it must work everywhere"*.

#### 8.9.2 The refusal table — ⚠️ and NONE of it is visible

Every row here ends in *nothing rendered*, which is the opposite of this
estate's usual rule and is deliberate: **the bell is a courtesy, and a courtesy
that cannot be delivered must not become an error message about itself.** A
page whose Worker has not been deployed yet would otherwise shout at every
signed-in visitor about a feature they never asked for.

| What happened | What the page does |
|---|---|
| Signed out | No bell — and the slot is not even filled |
| `401` / `403` (lapsed, or not an approved member) | Treated as signed-out. No bell |
| `404` (the routes are not deployed — ⚠️ **this is today**) | No bell. Nothing else on the page changes |
| `5xx` | No bell |
| `fetch` threw (network, or a rejected CORS preflight) | No bell |

⚠️ **The four causes stay distinct in code even though the UI hides all of
them** — `signedOut` / `lapsed` / `refused` / `network` / `unavailable` are
separate outcomes of one `authedJson()` helper, because *"a network or server
failure is NOT a permission failure"* is a rule about diagnosis, and the day
somebody debugs a missing bell the distinction is the whole answer.

**Once the bell IS drawn, the estate's ordinary rule resumes:** every action
inside the panel — mark read, mark all read, the opt-out — that fails says in
words what happened, and the **server's own `detail` sentence wins** whenever
it sent one. No bare status ever reaches a person.

#### 8.9.3 The panel

A `<dialog>` on `document.body` (`apex-request-catalog.js`'s `rc-dialog`
precedent), **not** a popover inside the who line: that line is a `<p>` living
inside another element's shadow DOM, and hanging a positioned panel off slotted
content is a layout fight with no upside.

- Notices **newest first**, straight from the route's own order.
- 🔴 **The words are the Worker's.** `subject` and `body` are rendered verbatim
  — `textContent`, never markup, never re-wrapped, never summarised. §8.6's
  guarantee that *`approved` never reads as done* lives in `verseNotice()`, and
  a page that paraphrased would be free to break it. The one sentence this page
  composes about a decision is **none**.
- Each notice carries its own age (`Intl.RelativeTimeFormat` — ⚠️ the platform's
  formatter, deliberately **not** a third estate copy beside `core.js`'s
  `formatAge` and `storage-view.js`'s `formatAgeShort`) with the exact instant
  on hover.
- `link` is followed only when it is `https://` — a link field is data, and
  data from a database is not a URL you hand to `href` unchecked.
- **Mark read** per notice, **Mark all read** for the badge. An unread notice
  is marked by a dot and a bold subject, so "unread" is never carried by colour
  alone.
- The **opt-out** toggle, read from `GET …/prefs` **when the panel opens** and
  not before — a switch nobody looks at should not cost a request on every page
  load. Its wording carries §8.5's second refusal out loud: switching it off
  means the estate **stops writing** these notices, and does not hide the ones
  already here.

⚠️ **The bell is drawn even at zero unread**, once the route has answered. Two
reasons: the opt-out has to live somewhere a person can find it, and a control
that only exists when there is news is a control nobody knows exists.

#### 8.9.4 What a Worker ahead of its migration shows

`GET /api/estate/notifications` answers **200 with an empty list, plus a `fix`
naming `npm run db:migrate`** (§8.7). The page renders that as **the empty
state and nothing else** — the `fix` sentence is an operator's line and is not
put in front of a member, which is the same judgement the route made when it
chose 200-over-500. It is visible in the network response for whoever is
debugging.

#### 8.9.5 Guards

- `scripts/test/apex-notices.test.mjs` drives the **real module** through the
  stub DOM (`scripts/test/helpers/stub-dom.mjs`): signed out, `404`, `5xx`, a
  thrown fetch, `403`, the unread badge, the empty list, verbatim rendering,
  mark-read, mark-all-read, and the prefs POST body.
- `predeploy.checks.json` pins the module's route strings and both pages'
  `<script>`/`<link>` tags, and adds a **surface owner** entry so a second
  notices UI anywhere under `public/` fails `check:home` by name.

---

**Mockup:** https://claude.ai/code/artifact/d1cfd9d1-2b7c-458a-8c66-5b5dc7e78384
(private artifact, published 2026-08-26) — the trigger, the request form with the
live alias / near-miss check, the pending queue, and what each role sees.
