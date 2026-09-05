# "Request a catalog" — the "+" on the heygabi.ai cards — Information Reference

> **Audience:** Claude sessions first, the owner second.
> **Status:** TRACKED — **DESIGN ONLY. Nothing is built.** No migration, no
> route, no button. The owner's ask of **2026-09-05 06:26 Phoenix** — *"Remember
> that doc about requesting a board game or book site? Time to build that."* —
> moves it from design-only to **being built**; the work log is
> [`../TODO.md`](../TODO.md)'s top item.
>
> 🔴 **THIS FILE IS THE ONLY RECORD OF THE DESIGN.** It was recovered on
> 2026-09-05 from three places, none of them a repo: the private mockup
> artifact **"Request a Catalog"** —
> <https://claude.ai/code/artifact/717169ac-af10-4b3a-9598-cf1f2ae38f11>
> (six-step cyberpunk walkthrough, 2026-08-24, updated the same night with the
> sealed key + the owner-editable Accept) — and two Opus research drafts written
> to a scratchpad that has since been recreated (agents `a33af8314947561ad`,
> phase 1: flow / data model / admin UX; `aefc2df1cbb203f17`, phase 2: the
> ten-step provisioning spec, the automatable-vs-manual ledger, the sealed key).
> The drafts' arguments are carried over; their **file:line citations were
> re-measured today and several were wrong** — every correction is listed in
> §11.
>
> Last verified: **2026-09-05**. **VERIFIED against the repos today:** the
> migration numbering (`apps/auth-worker/migrations/`), `me.ts`'s answer shape,
> `env.ts`'s `CONSUMER_APPS` / `appTokenFor()` / `EstateUserRow`,
> `middleware/auth.ts`'s four predicates, the Books **and** Games card markup in
> `sites/heygabi-home/public/index.html`, `admin/index.html`'s section ids and
> `admin.js`'s size and structure, `assets/apex-admin-link.js` in full,
> `.gitignore`'s `keys/*` rule, `library_catalog`'s `[env.friend]` block and
> `package.json` twins, `push-secrets.mjs`'s per-instance refusal lists,
> `details-sweep.ts`'s `sweepMode()`, and `Board_Game_Catalog`'s current
> single-instance shape.
> ⚠️ **NOT verified:** anything live. No production request, no D1 read, no
> `wrangler secret list`, no browser, no Cloudflare or Firebase console. Effort
> figures are **labelled guesses**. The phase-2 draft's citations into
> `library_catalog/docs/access/second-instance.md` were not re-checked line by
> line (the file exists and is current; its line numbers are carried over
> unverified and marked as such).

---

## 1. Purpose

A signed-in estate member presses a **"+"** on the **Books** card of
<https://heygabi.ai> and asks for a catalog of their own —
`<them>.heygabi.ai`, a full second (third, fourth) instance of the library app
with its own database, its own covers bucket and its own shelf. The owner sees
the request on `/admin`, can **edit the address and display name before
granting**, accepts, and is handed a pre-filled provisioning runbook.

**The one honest headline, and the whole reason this doc is long:** standing up
a catalog today is a **~10-step operation across three consoles, a
`wrangler.toml` edit, an auth-worker code + migration change, two secret
ceremonies and a guarded deploy**. About half is API/CLI-automatable; the other
half is genuinely manual, and the two steps that must stay manual are exactly
the *access-increasing* and *code-review-gated* ones this estate already fences.
🔴 **So Accept never deploys.** It sets a status and hands over a checklist. A
button that pretended otherwise would be the shipped-≠-verified failure with a
catalog's worth of blast radius behind it.

---

## 2. The flow

### 2.1 Requester side

| # | Step | Detail |
|---|---|---|
| 1 | **The "+"** | Bottom-right of the Books card. Shown only when signed in **and** owning **zero** catalogs (§4) |
| 2 | **Modal opens** | *"Request a book catalog"*, anchored to the card |
| 3 | **Identity is pre-filled, never typed** | The SSO display name + email already in hand: *"You'll be the admin of this catalog — signed in as … "*. ⚠️ **No email field exists.** The identity is the session's, so it cannot be claimed |
| 4 | **Two fields** | **Address** — `[______].heygabi.ai`, live-validated for shape and availability (§3.3). **Display name** — what shows on heygabi.ai, seeded from their first name, fully editable |
| 5 | **Optional Claude key** | *"…so your catalog runs its own AI lookups."* **Sealed on submit** — encrypted before it leaves the browser, rendered to nobody, logged nowhere (§6) |
| 6 | **Required review step** | The form **cannot POST from the fields**. A Review state restates everything, including *"the estate owner reviews every request before a catalog is created."* Buttons: Back / Submit |
| 7 | **Submit** | The "+" is replaced **in place** by a *"Requested — pending review"* pill. No double-submit |
| 8 | **Persistent** | A row in the estate directory D1 (§3), not session state — it survives reloads, redeploys and time |

### 2.2 Owner side

| # | Step | Detail |
|---|---|---|
| 9 | **Banner on `/admin`** | *"1 estate user has requested a physical book catalog. [Review →]"* — a render of the data, never a toast; gone when the last pending is resolved |
| 10 | **"Catalog requests" section** | A collapsed `<details>` with a live count, following the `#verse-queue` precedent exactly (§5) |
| 11 | **Decline** | Two-tap confirm → `declined`, with an optional worded reason. ⚠️ **The row is kept** — nothing is hard-deleted, and the requester's "+" returns so they can ask again |
| 12 | **Accept** | Two taps, then an **Accept panel** — ⚠️ **the owner may edit the address and the display name before granting** (owner, 2026-08-24 23:48Z), and may set a Claude key himself. Accepting sets `accepted` and reveals the pre-filled runbook |
| 13 | **Provision** | §7, by hand, from a dev machine. 🔴 **Accept never deploys** |
| 14 | **Mark live** | A later two-tap records the real instance + host and sets `live`. The requester is now the admin of their own catalog and their "+" is gone for good |

### 2.3 Lifecycle state line

```
        (requester)                    (owner, /admin)              (owner, dev machine)
  requested ──────────▶ pending ──┬──▶ declined            (kept; the + returns)
                                  │
                                  └──▶ accepted ──▶ provisioning ──▶ live
                                       (+ optional                    (requester = admin;
                                        Claude key)                    + gone for good)
```

- `pending` is the **only** state that raises the banner.
- `accepted` reads **"being set up"** on the requester's side — never "live".
- `live` is terminal-good; `declined` is terminal and re-requestable.

⚠️ **`accepted` ≠ `live`, and the gap is a person doing ten manual steps.** This
is the same four-status honesty `universe-add-verse-design.md` §3.4 argued for
`approved` ≠ `landed`, for the same reason: between them, somebody has been told
yes and nothing exists.

---

## 3. Data model

### 3.1 Where the row lives

**The auth Worker's estate D1** (`estate_auth`, binding `DB`,
`apps/auth-worker/wrangler.toml`) — a new **additive** migration.

⚠️ **THE NEXT FREE MIGRATION NUMBER IS `0018`.** Measured 2026-09-05:
`apps/auth-worker/migrations/` holds `0001`…`0017`, with `0016_billing_policy.sql`
and `0017_universe_requests.sql` the two most recent. The phase-1 draft proposed
`0016_catalog_requests.sql`; that number was taken while this sat unbuilt, and
`0017` was taken after it — **exactly the drift `0017_universe_requests.sql`'s
own header records.** Re-check the directory before writing the file; do not
trust this sentence either.

**Why here and not in a catalog's own D1:** the request exists *before any
catalog exists*, so it cannot live in the catalog it asks to create. The estate
directory is the one store that spans people estate-wide, the only D1 whose
write protocol is not bulk-replace, and the one `/admin` already talks to.

### 3.2 The table

```sql
-- 0018: catalog requests. PURELY ADDITIVE — one CREATE TABLE IF NOT EXISTS on a
-- new object plus its index. No ALTER, no DROP: the property that made
-- 0012/0013/0014/0015/0016/0017 safe to apply remotely and unattended.
--
-- 🔴 A ROW HERE IS A REQUEST, NOT A CATALOG. Nothing reads this table to decide
-- what exists. A catalog exists when a wrangler env block, a D1, a bucket, a
-- hostname and a deploy exist — see §7.
CREATE TABLE IF NOT EXISTS catalog_request (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  requester_email        TEXT    NOT NULL,   -- lowercased; the estate join key
  requester_uid          TEXT,               -- Firebase uid at submit; recorded, never joined on
  requester_display_name TEXT,               -- SSO display-name snapshot at submit
  desired_subdomain      TEXT    NOT NULL,   -- normalised [a-z0-9-], 3-40
  display_name           TEXT    NOT NULL,   -- the catalog's public name
  status                 TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','accepted','declined','live','cancelled')),
  extra                  TEXT,               -- JSON blob, stored whole and unparsed (§3.4)
  decided_by             INTEGER REFERENCES estate_user(id) ON DELETE SET NULL,
  decided_at             TEXT,
  decline_reason         TEXT,               -- the worded reason, surfaced to the requester
  provisioned_instance   TEXT,               -- on `live`: the wrangler env actually created
  provisioned_host       TEXT,               -- on `live`: the real hostname
  reader_key_set         INTEGER NOT NULL DEFAULT 0,  -- BOOLEAN ONLY (§6)
  owner_key_set          INTEGER NOT NULL DEFAULT 0,  -- BOOLEAN ONLY (§6)
  created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_catalog_request_status ON catalog_request(status);
```

⚠️ **`desired_subdomain` is deliberately NOT `UNIQUE` in the schema.** Uniqueness
is enforced at submit against live catalogs **and open pendings**, so a decline
frees the name. A DB constraint would hold a declined request's address hostage
forever.

⚠️ **The two key columns are BOOLEANS and can never be anything else.** No
ciphertext, no value, no hint. §6 is why.

### 3.3 Subdomain validation and the reserved list

- **Shape:** `^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$` — lowercase, 3–40 chars.
- **Reserved:** `www, auth, index, discord, docs, ebooks, audiobooks,
  boardgames, library, padhard, status, admin, api, bookcovers, covers,
  gamecovers`, plus every existing estate route.
- **Not taken:** no `live` row and no open `pending` holds the name.

⚠️ **Centralise the reserved list in ONE module** that both the validator and
the availability check import. Two copies of a hostname list is two copies that
drift, and the drifted one is always the check that mattered.

⚠️ **The check runs SERVER-side on submit as well as live in the form.** The
browser's copy is a convenience; the row that lands in D1 is the one that
matters. (Verbatim the rule `universe-add-verse-design.md` §3.3 established for
the alias check.)

### 3.4 Extensibility

`extra` is **JSON text stored whole and unparsed** — the `estate_prefs` (0014)
and `universe_request.payload` (0017) idiom, for the reason those two both
state: the shape will grow, and a schema naming today's fields needs a migration
the day a new one is wanted. Candidates already named: requested theme, starting
role posture, a note to the owner, a seed-import source, GABI on/off. The
renderer reads `extra` **tolerantly** — a missing key is a default, never an
error, the same tolerance `agent-board-contract.md` requires of the board
renderer.

### 3.5 Lifecycle rules

- A decision is **never un-made** into `pending`.
- **Rows are never deleted.** A declined request stays; a re-request is a second
  row. (The `estate_user` discipline, applied here.)
- A `live` row records the **real** instance and host, and is the source of
  truth for *"who owns which catalog"* — §4 depends on it existing.

---

## 4. The "+" on the home cards

### 4.1 Placement — bottom-right

**Bottom-right of the Books card** (owner, 2026-08-24 23:26Z — this **supersedes**
the phase-1 draft's *top-right*, and the mockup renders it bottom-right).

The Books card is `div.card.multi` at
`sites/heygabi-home/public/index.html:714`, inside the `<li>` at 710–725, with
its two hardcoded destinations at 721–722 (`!Sky` → `library.heygabi.ai`,
`Samantha` → `padhard.heygabi.ai`). ⚠️ **It is a `div`, not an `<a>`** — because
it already holds two links rather than one — so a small circular `.card-add`
button in the corner is a legal, distinct tap target that leaves both links
working. **This is not true of every card; see §8.**

### 4.2 The signal it needs — and it does not exist yet

🔴 **The estate has no "owns a catalog" fact today.** Measured 2026-09-05,
`GET /api/estate/me` (`apps/auth-worker/src/me.ts`, route
`apps/auth-worker/src/estate.ts:402`) answers exactly six fields:

```
status · is_approver · is_devops · dev_access · visibility[] · billing_denied{}
```

⚠️ **`visibility` is which catalogs you may SEE, not which you own** —
`CATALOGS = ['audiobook','library','games','library2','ebooks']`
(`visibility.ts:45`), and `PUBLIC_CATALOGS = ['audiobook']` (`:52`). Nothing in
the estate answers *"is this person the owner of a catalog"*.

⚠️ **The phase-1 draft listed FIVE fields.** `billing_denied` was added
2026-09-02 by the LLM-billing build (`me.ts:75`). Anything extending `/me` must
be written against the six-field answer, and against `meAnswer()`'s three
branches — owner break-glass, not-in-directory, and the row — each of which
returns the full shape.

**So this feature introduces the ownership signal**, sourced from
`catalog_request`: extend `/api/estate/me` with a `catalogs` array (or ship a
sibling `GET /api/estate/me/catalogs`), answering the caller's own `live` rows
plus any open `pending`/`accepted`.

### 4.3 Show / hide

| Caller state | The "+" |
|---|---|
| Signed out | **not rendered** |
| Signed in, no catalog, no open request | **shown** |
| Signed in, request `pending` or `accepted` | replaced by a **"Requested — pending review"** pill |
| Signed in, owns a `live` catalog | **hidden, permanently** |
| The probe failed | ⚠️ **hidden — fail-quiet** |

### 4.4 The auth seam it reuses

`sites/heygabi-home/public/assets/apex-admin-link.js` (81 lines, read in full
2026-09-05) is the exact seam and needs no change to be copied:

- listens for `estate-search:auth` on `#find-search` (`:50`; the event is
  dispatched by `assets/estate-search.js:612`),
- takes `e.detail.user`, dedupes on `user.uid` so it probes once per sign-in
  (`:57–58`),
- gets a token from `search.authAdapter?.idToken()` (`:59`),
- `GET https://auth.heygabi.ai/api/estate/me` with a bearer (`:62–64`),
- re-checks `probedFor !== user.uid` after the await, so a fast sign-out cannot
  land a stale answer (`:65`),
- and on **any** failure — a non-ok status or a thrown fetch — leaves the
  affordance **hidden** with a comment saying so (`:66–69`, `:77–79`).

⚠️ **Copy the fail-hidden posture, not just the fetch.** *"The links are
conveniences, the pages exist without them and enforce themselves"* — the same
sentence has to be true of the "+": the submit route enforces the gate
server-side, and the button is a curtain.

### 4.5 The confirm step is part of the button, not a nicety

The modal cannot POST from its fields (§2.1 step 6). This mirrors the estate's
confirm-lane grammar — propose → restate → confirm → apply — argued in
[`gabi-confirm-lanes-design.md`](gabi-confirm-lanes-design.md).

### 4.6 ⏳ The Games-card variant — PENDING owner answer #1

The owner's words were *"a board game or book site"*; the mockup shows Books
only. **If the Games card gets a "+" too**, one mechanical fact decides how:

🔴 **The Games card is an `<a class="card">` wrapping the WHOLE cell**
(`index.html:728–737`), unlike Books' `div.card.multi`. **A `<button>` cannot be
nested inside an `<a>`** — it is invalid HTML and the click target is ambiguous
in every browser. So a Games "+" needs the card converted to the
`.card.multi` shape first (a `div` holding a link plus the button), which is a
real change to a card that is currently a single whole-card tap target, and
`index.html:653–663` records that the estate has already paid that cost once
deliberately for Universes & series. **This is a design decision, not a
copy-paste.** See §8 for what provisioning a second board-game catalog actually
costs.

---

## 5. The `/admin` Members page

`sites/heygabi-home/public/admin/` — `index.html` (987 lines) +
`admin.js` (**3,151** lines, measured 2026-09-05; the phase-1 draft said
~2,461). Approver-gated, apex-CORS-only, backed by `GET /api/estate/users`.

### 5.1 What the page actually looks like today

⚠️ **The draft's *"three collapsible sections"* is stale as a description of the
page.** The member directory is still three `<details>` groups of `li.user`
cards (`admin.js:141–149`, `:328`), but above `#controls` (`index.html:781`) and
`#users` (`:946`) there are now three top-level collapsed panels:

| Panel | `index.html` | Rendered by |
|---|---|---|
| `#permission-map` | 711–715 | `admin.js:2171` |
| `#spending-panel` | 740–744 | `renderSpendingPanel()`, `admin.js:2261` |
| `#verse-queue` | 767–772 (with `#verse-queue-count`) | `renderVerseQueue()`, `admin.js:2614` |

🔴 **`#verse-queue` is the precedent to copy, not to re-invent.** It is the
same shape this feature needs — a collapsed `<details>` with a live count,
holding rows the owner decides on, fetched in the same `Promise.all` as
everything else (`admin.js:776–795`) with the **degrade-alone** rule: an
unreachable route costs that one panel and nothing else (`:782–789`). Its header
(`admin.js:2574–2585`) states the rule this feature shares almost word for word:
*"APPROVING RUNS NOTHING. It sets a status."*

### 5.2 The banner

A notice above the sections whenever any request is `pending`, carrying a live
count and a link into the section. A **render of the data, never a toast** — it
must survive a reload and disappear on its own when the last pending resolves. A
worded notice, never a bare number.

### 5.3 The "Catalog requests" section

A fourth top-level `<details>`, placed **first** among them — it is the one
thing needing action — with a live count in the `.adv-count` span, following
`#verse-queue`'s markup and render path exactly.

Each pending card shows: requester name + email, requested subdomain, display
name, submitted-at, any tolerant `extra` fields, and two controls.

⚠️ **The two controls must obey the `/admin` interaction grammar
([`../access/estate-auth.md`](../access/estate-auth.md) §9), which allows exactly
two gestures and no third:**

| Class | Gesture |
|---|---|
| **GRANT** | touching stages, nothing is written; a **Save** button *appears on that card* and commits everything staged there |
| **STATUS** | **two taps** (`confirmBtn`, `assets/estate-controls.js`): first arms, second writes, disarms after 4 s |
| **NOT A CONTROL** | words naming the cause — never a disabled control, never a button whose outcome it cannot change |

**Accept and Decline are STATUS-class: two taps.** Approve on this page has been
two-tap since 2026-08-15 (§9.2: the one-tap exception *"was a leftover, not a
rule"*), and creating a catalog is at least as consequential as approving a
member.

Cards follow their `status` column — **nothing is hand-moved between sections** —
the same mechanic as the directory's three groups.

### 5.4 Accept — the panel, and what the owner may change

The second Accept tap **opens a panel; it does not write `live`.** The panel:

1. **restates** what is about to happen;
2. ⚠️ **lets the owner EDIT the address and the display name before granting**
   (owner, 2026-08-24 23:48Z) — *"You're not locked to what they typed"*. Both
   edited values are re-validated against §3.3 exactly as the submit route
   validates them;
3. shows a reader-attached key as **sealed** — *"you can't see it and it can't
   leak; it's injected automatically"* — with **no reveal control anywhere**;
4. offers an optional **owner key** field (*"only used if the reader didn't
   attach one"*);
5. on confirm sets `status='accepted'` and reveals the pre-filled §7 runbook.

A later two-tap **"Mark live"** records `provisioned_instance` +
`provisioned_host` and sets `live`.

### 5.5 Decline keeps the row

Two-tap, optional worded reason, `status='declined'`, **row kept**. The
requester's "+" returns on their next load and they may ask again.

### 5.6 Refusal wording

Every refusal says what happened, what it needs, and how to get it —
per the estate's own rule that ⚠️ **a person must never see a bare HTTP status**:

- taken address → *"amber.heygabi.ai is already in use — pick another."*
- signed out → the "+" is not rendered at all
- already pending → the pill has replaced the "+"
- not an approver hitting the decide route → *"Accepting a catalog request is
  the owner's call."*
- ⚠️ a 500 or a timeout → *"Couldn't reach the estate directory — that's an
  outage, not a permissions problem."* **A network failure is never rendered as
  a refusal.**

---

## 6. The sealed Claude key

Two supply points: the **requester** may attach a key at submit, and the
**owner** may set one at Accept. The requester's key must be handled so the
owner can **never see it** and it can **never leak** — and ⚠️ **all four estate
repos are PUBLIC** (`KNOWN_ISSUES.md` KI-2).

### 6.1 Where plaintext may and may not exist

| Location | The requester's key |
|---|---|
| Their browser at submit | plaintext, briefly — encrypted before it leaves |
| In flight | ciphertext only |
| **D1** | 🔴 **NEVER** — only `reader_key_set` / `owner_key_set` booleans |
| Ciphertext store (private R2) | ciphertext only |
| **The admin UI** | 🔴 **NEVER** — the owner sees only *"a reader key was provided"* |
| **Logs / `wrangler tail`** | 🔴 **NEVER** |
| **Repo / any tracked file** | 🔴 **NEVER** |
| Provisioner memory at inject | plaintext, transiently — piped to stdin, never printed or written |
| The new instance's `ANTHROPIC_API_KEY` secret | plaintext at rest in Cloudflare — its intended destination |

### 6.2 The mechanism — a sealed-box envelope

1. **Mint a provisioning keypair once.** The **public** key is a build constant
   in the public web bundle (safe by design, exactly like a Firebase web API
   key). The **private** key lives only in `docs/access/keys/` — verified
   2026-09-05: `.gitignore:67` excludes `docs/access/keys/*` with a single
   negation for the README at `:70`, and ⚠️ it is `keys/*` **not** `keys/`
   *because git never descends into an excluded directory*, which would have
   silently swallowed the README too.
2. **At submit** the browser AES-GCM-encrypts the key and seals the symmetric
   key to the provisioning public key — **WebCrypto `subtle.encrypt`, no
   external library, so it is CSP-safe**. Only the envelope is POSTed.
3. **Store the envelope in a PRIVATE R2 object** keyed by request id — not a D1
   blob. The estate already runs no-public-URL buckets and binds two of them on
   this very Worker: `ESTATE_BACKUPS` (`env.ts:21`) and `ESTATE_DOCS`
   (`env.ts:48`), whose comment records that the bucket has **no public r2.dev
   URL and no custom domain**. D1 gets `reader_key_set = 1` and nothing else.
4. **Decrypt only inside the provisioner**, in memory, and pipe straight into
   `wrangler secret put ANTHROPIC_API_KEY --env <name>` over **stdin** — the
   technique `library_catalog/scripts/push-secrets.mjs` already uses
   (~`:655–673`): *"Secrets go over stdin, never argv, so they never reach a
   process list."*
5. **Delete the R2 envelope** once the secret is confirmed set.

⚠️ **The owner never decrypts to READ — only to INJECT.** No "show me the key"
path is built, anywhere. That absence, not a policy, is the mechanical guarantee
behind *"the owner can never see it."*

### 6.3 Alternatives considered

| Option | Verdict |
|---|---|
| Sealed-box envelope + private R2 + provisioner decrypt | **RECOMMENDED** — WebCrypto + wrangler + the dev machine + the existing `keys/` custody + the private-bucket precedent. **Zero new infrastructure** |
| Cloudflare Secrets Store binding | Not chosen — solves at-rest, not *custody from an untrusted submitter*; an account admin can still read it. Possibly useful later on the destination side |
| A cloud KMS | Overkill — a new vendor, a new credential, a new bill and a new recovery item, for a Cloudflare-plus-dev-machine estate |

### 6.4 Precedence — resolved at PROVISIONING time, not at runtime

There is **exactly one** `ANTHROPIC_API_KEY` per instance. `sweepMode()`
(`library_catalog/apps/worker/src/lib/details-sweep.ts:317–321`) sets
`ai = Boolean(env.ANTHROPIC_API_KEY)`; with neither AI nor donor the sweep skips
with `"no ANTHROPIC_API_KEY"` (`:919`); with a donor but no key it runs
**donor-only** (`:923`). GABI spends the same key.

So precedence is decided by **which plaintext the provisioner pipes into that
one secret**:

| # | Condition | Result |
|---|---|---|
| 1 | The requester's sealed key is present | decrypt and set it — **the reader's key wins** |
| 2 | Else the owner supplied one at Accept | set that, by the same sealed path; D1 gets `owner_key_set = 1` only |
| 3 | Else neither | leave the secret **unset** — the AI half of the sweep is skipped and the **donor-only** sweep still runs against the main library, healing for free |

⚠️ **Never silently reuse the estate owner's own key.** That is a money and
blast-radius decision: his explicit per-request choice, or nothing.

⚠️ **A mechanical guard for this already exists and must not be weakened.**
`library_catalog/scripts/push-secrets.mjs:314` declares
`PER_INSTANCE_SECRETS = ['ANTHROPIC_API_KEY', 'INDEX_PUSH_TOKEN', 'INDEX_READ_TOKEN']`
and `:317` declares `PER_INSTANCE_PREFIXES = ['ESTATE_APP_TOKEN_']`, both
**refused, always** for a non-main instance — *"a bulk push that could reach one
of these is a bulk push that can silently replace her key material with the
owner's."* Rotation later is re-inject → `secret put` → **no deploy needed**.

### 6.5 Threat table

| Threat | Why it is blocked |
|---|---|
| The owner reads the reader's key | No decrypt-to-print path exists; the private key's only consumer is the `secret put` stdin pipe |
| Leak through a public repo | Plaintext is never on a tracked file; ciphertext sits in a private R2 bucket with no public URL; the private key is under `docs/access/keys/*`, gitignored |
| Leak through a D1 backup or an admin query | D1 holds booleans. The ciphertext is not even in D1 |
| Leak through logs or `wrangler tail` | stdin-only transport; neither the sweep nor GABI ever logs the key |
| The ciphertext is stolen from R2 | Useless without the provisioning private key, which exists only on the owner's machine |
| The private key is stolen | Full local compromise — the same boundary the whole estate already trusts. Mitigation: re-mint the keypair, which makes old ciphertexts undecryptable (a feature) |
| A malicious requester submits a poisoned value | It only ever becomes **their own** instance's key. Worst case their own sweep fails auth; no other instance is touched |

**The core property:** plaintext exists in exactly two transient places (their
browser at submit, the provisioner's memory at inject) and one intended place at
rest (the destination Worker's secret). Every durable, queryable, public or
owner-visible surface holds a boolean or an opaque envelope.

---

## 7. Provisioning

### 7.1 The worked example everything rests on

The only precedent is the second library instance — `padhard.heygabi.ai`,
`[env.friend]` in `bookbuddy/library_catalog/apps/worker/wrangler.toml`. ⚠️
**Measured 2026-09-05, that block is lines 341–563 of a 563-line file** (the
phase-2 draft said 275–469 / 295–469 — the file has grown since).

🔴 **Wrangler environments inherit NOTHING** — not `[vars]`, not bindings, not
routes, not triggers. Every one is restated under `[env.<name>]` or it is simply
missing on the new Worker. **That single fact is what makes provisioning long: a
new instance is a full block, not a diff.**

Resource names are **identity-neutral on purpose** — env `friend`, D1
`library-catalog-2nd`, bucket `library-2nd-covers`. Only the **hostname** is
allowed to carry identity, and it has already survived one rename
(`sam.heygabi.ai` → `padhard.heygabi.ai`) with zero other files touched.

### 7.2 The ten steps, worked as a third library instance

Derived from the request row, never asked:

| Derived thing | Example value | Rule |
|---|---|---|
| wrangler env | `third` | next free `[env.<name>]`, identity-neutral |
| Worker name | `library-catalog-third` | `library-catalog-<env>` |
| D1 name | `library-catalog-3rd` | ordinal, identity-neutral |
| R2 bucket | `library-3rd-covers` | ordinal |
| Hostname | `amber.heygabi.ai` | **the only identity-bearing name** |
| Estate app id | `library3` | catalog-named, never person- or host-named |
| Visibility column | `vis_library3` | one `ADD COLUMN` per catalog (`0007` precedent) |
| Estate token name | `ESTATE_APP_TOKEN_LIBRARY3` | app id selects the secret NAME (`env.ts:478–491`) |

**1 — D1: create + migrate.** `wrangler d1 create library-catalog-3rd` returns a
`database_id` to paste into `[[env.third.d1_databases]]`. ⚠️ **The binding stays
`DB`** — not the name wrangler suggests in its copy-paste snippet. The
`migrations_dir` is **shared**: the new D1 gets the same files as every other
instance. ⚠️ **Migrate BEFORE deploy, always** — new code never meets an old
schema. ⚠️ **Silence from migrate is a FAILED migration** — expect the checkbox
table.

**2 — R2: the covers bucket.** `wrangler r2 bucket create library-3rd-covers`,
bound as `COVERS`. ⚠️ **Both the `COVERS` binding AND `COVERS_BASE_URL`, or
neither** — the cover route refuses to write with only one. Two tiers: the
launch-fast `r2.dev` public URL (what padhard did — rate-limited and
uncacheable, fine to start) or a **custom domain plus a 1-year Edge-TTL Cache
Rule** (what the main library did — safe *only because object keys are content
hashes*, so a replaced cover is a new URL and a cached copy can never be stale).
⚠️ **A custom domain belongs to exactly ONE bucket** — `covers.heygabi.ai` is
already the audiobook bucket's, which is why library uses `bookcovers.`; a third
catalog needs a third name, checked free first.

**3 — Subdomain routing.** Declared in the toml as a Workers custom domain, not
clicked in a dashboard, so the mapping lives in git and a redeploy reasserts it:

```toml
[[env.third.routes]]
pattern = "amber.heygabi.ai"
custom_domain = true
```

`custom_domain = true` makes Cloudflare create and manage the DNS record and the
TLS certificate, with no nameserver change because `heygabi.ai` is in the same
account. ⚠️ **ORDER MATTERS** — the host must be on Firebase's authorised
domains before anyone relies on it, or sign-in fails `auth/unauthorized-domain`.
⚠️ **A LAN negative-caches a new subdomain for ~30 minutes** — test through
`*.workers.dev` meanwhile.

**4 — Firebase authorised domain.** Add the host under **Authentication →
Settings → Authorised domains** on the **`audiobook-catalog`** project. ⚠️
**`FIREBASE_PROJECT_ID` stays `audiobook-catalog` — do NOT create a second
project.** Sharing one project is the entire mechanism by which one Google
account is one person estate-wide.

**5 — Auth-worker consumer registration (⚠️ CODE + MIGRATION).** The heaviest
step, and it is in *this* repo:

1. add the app id to `CONSUMER_APPS` — verified 2026-09-05, still
   `['library', 'games', 'index', 'audiobook', 'library2']` at
   `apps/auth-worker/src/env.ts:4`;
2. declare `ESTATE_APP_TOKEN_LIBRARY3?: string` in `Env` (the block at
   `env.ts:107–184`) and add a `case 'library3'` arm to `appTokenFor()`
   (`env.ts:478–491`);
3. add a `vis_library3` column in a new migration following
   `0007_vis_library2.sql` — ⚠️ **`DEFAULT 0`, deliberately the opposite of
   0002's `DEFAULT 1`**, because it is another household's shelf, granted by
   hand — and add the field to `EstateUserRow` (`env.ts:349`, beside
   `vis_library2` at `:390` and `vis_ebooks` at `:396`);
4. migrate the auth-worker D1, then deploy the auth Worker.

⚠️ **`vis_library3` is meaningful-to-switch-on, not a gate** — the estate gate
refuses on `status` only; visibility is cached and logged, never enforced.

**6 — The paired estate token.** Mint **one** value; set it under the **same
name** on **both** the new instance and the auth Worker. ⚠️ **PIPE FIRST, DEPLOY
SECOND** — no inert window. ⚠️ **A missing NAME fails inert** (off, nobody
locked out); **a wrong VALUE is a 401 / `estate_unreachable`**. ⚠️ **BOM-kill
ceremony applies** — `openssl rand -hex 32`, never `echo`, never a PowerShell
pipe, no trailing newline or BOM (`../access/agent-board.md` §3 is the worked
version of this ritual, written because an invisible BOM makes a bearer fail
while looking perfect everywhere a human can check it).

**7 — Per-instance secrets.**

| Secret | For | Source | Verdict |
|---|---|---|---|
| `ESTATE_APP_TOKEN_LIBRARY3` | the `/seen` bearer | minted (step 6) | auto, over stdin |
| `GOOGLE_BOOKS_API_KEY` | the ISBN rung | reuse the shared key | auto |
| `DONOR_TOKEN` | donor-first sweep — ⚠️ same value both sides or 404 | shared estate value | auto |
| `PEER_TOKEN` | cross-library peer push | shared | auto |
| `ANTHROPIC_API_KEY` | the AI half of the sweep, and GABI | **§6 sealed flow** | **special** |

Deliberately left unset so the instance ships dark: `INDEX_PUSH_TOKEN`,
`EBOOK_INGEST_TOKEN`, `AUDIOBOOK_MAPPING_TOKEN`.

⚠️ **Corrected 2026-09-05 — the drafts' *"there is no bulk path for a non-main
instance"* is no longer true as written.** `secrets:push:friend` is a real
script today (`library_catalog/package.json:28`, plus an `op` variant at `:31`)
that pushes **shared** keys from the MAIN `.dev.vars`. What survives, and is a
stronger guarantee than the old stub, is the **per-instance refusal list** of
§6.4: `ANTHROPIC_API_KEY` and every `ESTATE_APP_TOKEN_*` are refused for a
non-main instance *by name*. And ⚠️ **`.dev.vars.friend` still does not exist
and must not be created** (`push-secrets.mjs:102`).

**8 — The full `[env.third]` block.** Templated from `[env.friend]`
(wrangler.toml:341–563). Because nothing is inherited, every field is required
or missing: `name`, `[env.third.assets]` (the same `../web/dist` — **one built
PWA shipped to both Workers**), `[[env.third.d1_databases]]`,
`[[env.third.r2_buckets]]`, `[env.third.triggers] crons` (⚠️ the cron **string**
must match `DETAILS_SWEEP_CRON` exactly — the code dispatches on the string, so
"roughly the same" is a sweep that never runs), `[[env.third.routes]]`, then the
vars: `APP_VERSION`, `ENVIRONMENT`, `DEFAULT_THEME`, `GABI_PANEL`,
`COVERS_BASE_URL`, `FIREBASE_PROJECT_ID` (shared, immutable), `OWNER_EMAILS`,
`DONOR_URL`, `PEER_SELF_ID`, `PEER_SELF_LABEL`, `SITE_ORIGIN`, `PEERS`,
`ESTATE_CHECK`, `ESTATE_AUTH_URL`, `ESTATE_APP`.

⚠️ **Peer reciprocity is a redeploy of everybody else.** `PEERS` is a JSON array
of every *other* instance, so adding one means appending an entry to **every
existing instance's `PEERS`** and redeploying them all. Verified today: main
carries padhard (`wrangler.toml:223`), padhard carries main (`:477`). It is
inert without the update, so it can be deferred — but "deferred" must be written
down, not forgotten.

**9 — Admin seeding.** Per-catalog admin is **app-local** (`app_user.role`), not
an estate fact. ⚠️ Estate `status` and estate `visibility` are **not roles** and
grant no admin anywhere. Three levers:

1. ⚠️ **RECOMMENDED — `OWNER_EMAILS = <requester>` on the new env.** Forces
   `owner` at every sign-in, so they cannot be locked out of their own shelf,
   and it needs no post-sign-in promotion. **This differs from padhard on
   purpose**, where `OWNER_EMAILS` is the *estate* owner's break-glass
   (`wrangler.toml:449`) and the friend is admin through an `app_user` grant.
2. Seed an `app_user` role row — works, but the row is normally created
   `pending`/`member` on first sign-in, so it needs a pre-seed or a promotion.
   Choose this if the owner wants a **promotable/demotable** admin rather than
   an immovable owner.
3. `ESTATE_DEFAULT_ROLE` — **wrong lever**: it makes *everyone* who signs in
   there an admin.

**10 — Deploy, with the guards.** `db:migrate:third` then `deploy:third`, adding
the `predeploy:third` / `deploy:third` / `postdeploy:third` triple mirroring the
`:friend` ones verified today at `library_catalog/package.json:20–22`. Three
guards run: **`check-clean.mjs`** (refuses a dirty tree — ⚠️ **the deploy
uploads the working-tree `apps/web/dist`**, so use a `git worktree add <tmp>
HEAD` checkout rather than `ALLOW_DIRTY_DEPLOY=1`), **`deploy-guard.mjs
--instance=third`** (refuses when the live commit is not an ancestor of HEAD,
checked against the last `deploys.log` line **of the same instance**; a
first-ever deploy skips the ancestry check), and **`deploy-done.mjs
--instance=third`** (appends the log line with its `env=third` field). ⚠️ The
`.deploy.lock` is shared across instances **on purpose** — both deploys build
into the same `apps/web/dist`. ⚠️ **A rollback does not undo a migration.**
⚠️ **Verify with a cache-busting query string** — `/api/health` is edge-cached.

### 7.3 The automatable-vs-manual ledger

| Step | Task | Verdict |
|---|---|---|
| 1 | D1 create + migrate | **AUTO** |
| 2 | R2 bucket create | **AUTO** |
| 2 | R2 `r2.dev` public URL (launch tier) | **AUTO-ish / console** |
| 2 | R2 custom domain + Cache Rule | **MANUAL / console** — deferrable |
| 3 | Subdomain route + DNS + certificate | **AUTO** (templated toml) |
| 4 | Firebase authorised domain | 🔴 **MANUAL — checkpoint #1** |
| 5 | Auth-worker `CONSUMER_APPS` + `vis_` migration + deploy | 🔴 **MANUAL, reviewed code — checkpoint #2** |
| 6 | Mint + set the paired token, both sides | **AUTO** (stdin) |
| 7 | Per-instance secrets (Books / Donor / Peer) | **AUTO** |
| 7 | `ANTHROPIC_API_KEY` custody | **SPECIAL** (§6) |
| 8 | Template the `[env.third]` block | **AUTO** |
| 9 | Admin seed (`OWNER_EMAILS`) | **AUTO** |
| 10 | migrate-before-deploy + the three guards | **AUTO, owner-run** |

**Roughly half is automatable, and the two irreducibly-manual steps are exactly
the two that are access-increasing or code-review-gated.** Checkpoint #1 cannot
be scripted at all — the authorised-domain list is Identity Platform admin
config and `firebase-tools` has no command for it. Checkpoint #2 touches
`CONSUMER_APPS`, a security surface, and migrates the directory database.

### 7.4 The owner-run provisioner (design, later phase)

`scripts/provision-catalog.mjs --request <id> [--dry] [--resume <step>]` — run
by the owner from a dev machine, **never triggered from the web**.

1. **Resumable, step-numbered, idempotent** — each step checks whether its
   artifact already exists (D1, bucket, secret, toml block, by name) and skips.
   ⚠️ **Any script that mints into a custody store and then does something
   fallible needs a resume path**, or its own error message tells you to corrupt
   your custody store — the lesson `scripts/op-rotate-pair.mjs --resume` was
   built from.
2. **Manual steps are PAUSES, not silent skips.** Checkpoints #1 and #2 print
   exact instructions (and #2 *generates* the diff and the migration as a
   proposal) and then block on typed confirmation.
3. ⚠️ **Never a dirty tree, never `git add -A`.** It stages an explicit
   allowlist (the templated toml, the new `package.json` lines, the new
   migration), commits with `-F`, and then invokes the **existing**
   `npm run deploy:third` so the real guards run — from a worktree of HEAD when
   the tree is shared with agents.
4. **Secrets flow memory → stdin only.** No value on disk, in argv, or in a
   `.dev.vars.third` that must never exist.
5. **Migrate before deploy by ordering.** The auth-worker migration stays
   human-run — the directory DB is never migrated unattended.
6. **A Cloudflare REST fallback exists but is not preferred.** The estate holds
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` and already calls
   `api.cloudflare.com/client/v4` from `scripts/backup-r2.mjs`; wrangler is the
   lower-blast-radius tool here. ⚠️ **And that token's scope is not a
   given** — `DONE.md` records it needing **Account · D1 · Edit** added by hand
   after a rotation, because the Workers template does not carry D1.

Step map: derive and validate names → D1 → bucket + launch `COVERS_BASE_URL` →
template the block and the scripts → **PAUSE #1 Firebase** → **PAUSE #2
auth-worker diff + migration** → mint and set the token → secrets including the
§6 key → commit the allowlist → migrate + deploy → verify (`/api/health?cb=`,
tail for the new app id on `src:"seen"`) → mark the request `live`. The final
output is a review link and a verification checklist.

### 7.5 The structural ceiling, stated honestly

The pattern is **one wrangler env per instance**, and each catalog costs a full
block plus an auth-worker `CONSUMER_APPS` + `vis_` change. That is workable for
a handful of household catalogs and **does not scale to many self-serve
catalogs**. True one-click self-serve needs a multi-tenancy redesign — one
Worker serving N catalogs by hostname, with a `catalog` registry replacing the
per-instance env blocks. **That is a separate, large project and is explicitly
out of scope here.**

---

## 8. If the Games card is included ⏳ CONDITIONAL ON OWNER QUESTION #1

Everything in this section is conditional. It exists so answer #1 is a decision
rather than a spelunk.

**The board-game repo is `boardbuddy/Board_Game_Catalog`, and it is
single-instance today.** Its own
`docs/info/multi-catalog-strategy.md` (dated 2026-08-25) is the prep doc for
exactly this question. ⚠️ **Two of its facts have changed since it was
written — re-measured 2026-09-05:**

| Its claim (2026-08-25) | Measured 2026-09-05 |
|---|---|
| *"`deploy-guard.mjs` / `deploy-done.mjs` **not present on `main`**"* — an unmerged branch | 🔴 **STALE — both now exist** in `scripts/`. Its §4 phase 1 is DONE |
| `migrations/`, 28 files (`0001`…`0028`) | **30 files**, through `0030_billing_cache.sql` |

Everything else in it that matters was re-confirmed today:

| Fact | Measured |
|---|---|
| `[env.*]` blocks in `apps/worker/wrangler.toml` | 🔴 **ZERO.** The entire config is top-level. There is **no `[env.friend]` precedent in this repo at all** |
| Estate identity | 🔴 **Hard-coded.** The token is read as the fixed `ESTATE_APP_TOKEN_GAMES` (`apps/worker/src/env.ts:141`); there is **no configurable `ESTATE_APP` var**. This is the exact pre-2026-08-17 state `library_catalog` was in, and it caused a real bug there: the friend instance **silently asserted the main library's identity for months**. A second games instance would silently assert `"games"` |
| Peer / donor config | **Absent** — no `PEERS`, no `PEER_SELF_ID`, no `DONOR_URL` anywhere in `wrangler.toml`. So the free donor-first sweep that makes a second *library* cheap **does not exist for games** |
| `scripts/lib/` | Only `platform-repo.mjs` — **no `d1.mjs`**, no instance-targeting helper of any kind |
| `package.json` twins | **None.** No `:friend`-shaped `deploy:` / `secret:` / `db:migrate:` pair exists |
| `RATE_LIMITER` unsafe binding | Present, `namespace_id = "1001"` — **`library_catalog` has no equivalent** |

### What actually differs, honestly

1. 🔴 **There is no second-instance machinery to fill in — it has to be built
   first.** For Books, provisioning is *"copy `[env.friend]`, substitute
   names"*. For Games there is no block to copy, no script twin to mirror, and
   no instance-aware deploy guard. §7's ten steps become ten steps **plus** a
   preparatory refactor.
2. 🔴 **The estate identity must become config before it can differ.** Lifting
   the hard-coded `"games"` into an `ESTATE_APP` var (with a build guard like
   `library_catalog`'s `instance-estate-app.test.ts`, which fails the build if
   two instances assert the same id) is a **prerequisite**, not a nicety —
   without it the second instance is not merely unconfigured, it is
   *misidentified*.
3. ⚠️ **The `RATE_LIMITER` namespace question is open and repo-specific.**
   Nobody knows whether `namespace_id = "1001"` scopes counters per Worker or
   per account. If per account, two instances would throttle each other's
   traffic as if they were one site. This must be **measured**, not assumed;
   the cheap fix if it is per-account is a different `namespace_id` per env
   block.
4. ⚠️ **`PEERS` reciprocity is worse here than for Books**, because it does not
   exist at all. For libraries, adding an instance means appending to every
   existing instance's `PEERS` and redeploying them — annoying but mechanical
   and already-built. For games it would be **new product surface** (a
   migration, a route pair, a cron change), and `library_catalog` built its peer
   features about a day *after* its second instance existed, not simultaneously.
5. ⚠️ **The card itself is not a copy-paste** — §4.6: the Games card is an
   `<a>` wrapping the whole cell, and a button cannot live inside it.
6. ✅ **What does NOT differ:** the data model needs nothing new (`game`,
   `edition`, `copy` are already instance-agnostic tables that just need to
   exist once per D1), `FIREBASE_PROJECT_ID` stays shared, and the migration
   files stay shared and are applied per instance.
7. ⚠️ **`CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`** are deprecated-but-present
   top-level vars in that repo. A new env block must **not** restate them — they
   are being removed, not extended.

**Net:** a Games "+" is a *product* change of roughly the same size as the Books
one, sitting on top of a *platform* gap the Books path does not have. The
request/accept half is shared code; the provisioning half is a different and
larger job. **Which is exactly why question #1 is a question and not an
assumption.**

---

## 9. Open owner questions — ⚠️ ONE AT A TIME, in this order

**These are NOT decided here.** Present them one per message and wait.

1. **Does the GAMES card get the same "+" and flow?** His words say *"board game
   or book site"*; the mockup shows Books only. §8 is the honest cost.
2. **Who may request** — approved estate members only, or `pending` members too?
3. **Lock in the sealed-box key design for v1, or ship v1 without the key field
   and add it after?**
4. **Back-seed the two existing library owners** (`library` and `padhard`) as
   `live` rows, so their "+" hides and the table becomes the single source of
   truth for *"who owns a catalog"*?

*(Decisions already on record, for contrast, are in §10's header and §5.4.)*

---

## 10. Build plan

> ⚠️ **Effort figures are labelled guesses. No comparable build was timed.**
>
> **Decided, and baked into the phases below:** the owner may edit address and
> display name at Accept; the form carries an optional sealed LLM key; the owner
> may also set one; precedence is requester → owner → none (2026-08-24 23:48Z).
> The "+" sits bottom-right (2026-08-24 23:26Z). The **2026-08-24 constraint
> *"ships only after dev lanes + more testing"* is SUPERSEDED** by the owner's
> 2026-09-05 06:26 Phoenix *"Time to build that."* — both dates recorded, because
> the older one explains why the drafts are shaped defensively.

| Phase | What lands | Repo / layer | Rough effort | "Verified" means |
|---|---|---|---|---|
| **0** | This doc + the four answers from §9 | `catalog-platform/docs/` | done / owner | The four questions are answered on the record and this file says so |
| **1** | Migration `0018` + `catalog_request`; submit / list / decide / mark-live routes; the reserved-list module; server-side validation | `catalog-platform` `apps/auth-worker` | ~1 day | `node --test` exercises every route incl. refusals; the migration applied to **remote** `estate_auth`; a real row read back out of D1 — **a green deploy is not verification** |
| **2** | `/api/estate/me` gains `catalogs` (or the sibling route) | same | ~½ day | A signed-in `curl` returns the caller's own array; an owner's answer is not special-cased into a lie |
| **3** | The "+" bottom-right on the Books card, the modal, the required review step, the pending pill, fail-hidden | `catalog-platform` `sites/heygabi-home` | ~1 day | ⚠️ **A HUMAN, SIGNED IN, PRESSES IT** at <https://heygabi.ai> and files one real request. There is no browser harness for this page; `check:home` proves it parses and nothing more |
| **4** | The `/admin` banner + "Catalog requests" section + two-tap Accept/Decline + the Accept panel with owner-editable fields | `catalog-platform` `sites/heygabi-home/public/admin/` | ~1 day | The owner **renders the section signed in**, edits an address in the panel, and accepts one real request. ⚠️ The verse queue carries the same open debt today — do not repeat it |
| **5** | The sealed key: keypair, the browser seal, the private-R2 envelope, the booleans | both halves | ~1 day | A round trip: seal in a browser, decrypt in a script, and confirm the decrypted bytes equal the input — **and confirm no code path prints it** |
| **6** | Back-seed `library` + `padhard` as `live` rows *(if §9 Q4 is yes)* | D1 data | ~1 h | Both owners' "+" is confirmed hidden while signed in as each |
| **7** | `scripts/provision-catalog.mjs` (§7.4) | `library_catalog` | ~2 days | `--dry` prints all ten steps; a **real third instance answers `/api/health?cb=`** and its first sign-in logs `src:"seen"` under the new app id |
| **8** | ⏳ The Games variant *(only if §9 Q1 is yes)* | `Board_Game_Catalog` first, then the card | §8 — larger | The §8 prerequisites land **before** any card change |

⚠️ **Phases 1–2 are worth landing even if the "+" is deferred**, because the
ownership signal is the thing the estate genuinely lacks and several other
surfaces would use it.

⚠️ **Commit at clean boundaries and finish fewer things completely.** Phases 3
and 4 touch `sites/heygabi-home/public/`, which deploys by **directory upload** —
`worktree-deploys.md`'s rule applies: a directory deploy ships the WORKING TREE,
so it runs from a clean tree or a throwaway worktree of HEAD only.

**Review links once each phase lands** (the estate's rule for anything visible):
the "+" at <https://heygabi.ai> (signed in), the queue at
<https://heygabi.ai/admin/>.

---

## 11. File:line reference map — verified 2026-09-05

### 11.1 `catalog-platform`

| Fact | Where |
|---|---|
| Books card — `div.card.multi`, the "+" host | `sites/heygabi-home/public/index.html:714` (its `<li>` 710–725; the two links 721–722) |
| ⚠️ Games card — an `<a class="card">` wrapping the whole cell | `sites/heygabi-home/public/index.html:728–737` (name at 732) |
| The precedent for turning a whole-card link into `.card.multi` | `sites/heygabi-home/public/index.html:653–663` |
| The auth seam the "+" reuses, in full | `sites/heygabi-home/public/assets/apex-admin-link.js:34–81` (event `:50`, uid dedupe `:57`, token `:59`, `/me` fetch `:62`, re-check `:65`, fail-hidden `:66–69`, `:77–79`) |
| The event's source | `sites/heygabi-home/public/assets/estate-search.js:612` |
| `GET /estate/me` route | `apps/auth-worker/src/estate.ts:402` (and `:390`) |
| `meAnswer()` and the **six**-field shape | `apps/auth-worker/src/me.ts:26–89` (`billing_denied` `:75`), function `:105–152` |
| `CATALOGS` / `PUBLIC_CATALOGS` | `apps/auth-worker/src/visibility.ts:45`, `:52` |
| `CONSUMER_APPS` | `apps/auth-worker/src/env.ts:4` |
| `ESTATE_APP_TOKEN_*` Env fields | `apps/auth-worker/src/env.ts:107–184` |
| `appTokenFor()` | `apps/auth-worker/src/env.ts:478–491` |
| `EstateUserRow` (`vis_library2` `:390`, `vis_ebooks` `:396`) | `apps/auth-worker/src/env.ts:349` |
| Private R2 bindings (`ESTATE_BACKUPS`, `ESTATE_DOCS`) | `apps/auth-worker/src/env.ts:21`, `:48` |
| `approverAllows` / `devAccessAllows` / `requireDevops` / `requireApprover` | `apps/auth-worker/src/middleware/auth.ts:56`, `:93`, `:201`, `:251` |
| Migrations — latest is `0017`, **next free is `0018`** | `apps/auth-worker/migrations/` |
| The number-drift precedent, in its own words | `apps/auth-worker/migrations/0017_universe_requests.sql:7–9` |
| Route shape to copy (`requireApprovedMember()` / `requireApprover()` / `requireDevops()`) | `apps/auth-worker/src/universe-requests.ts:356, 373, 477, 512, 591, 654` |
| `/admin` panels — `#permission-map` / `#spending-panel` / `#verse-queue` | `sites/heygabi-home/public/admin/index.html:711`, `:740`, `:767` |
| `#controls`, `#users` | `sites/heygabi-home/public/admin/index.html:781`, `:946` |
| `admin.js` — **3,151 lines**; directory = three `<details>` groups | `sites/heygabi-home/public/admin/admin.js:141–149`, `:328` |
| The one `Promise.all` + degrade-alone rule | `sites/heygabi-home/public/admin/admin.js:776–795` |
| `renderSpendingPanel()` / `renderVerseQueue()` | `admin.js:2261`, `:2614` |
| *"Approving runs nothing. It sets a status."* | `admin.js:2574–2585` |
| The two-gesture `/admin` grammar | [`../access/estate-auth.md`](../access/estate-auth.md) §9 (§9.1 table, §9.2 two-tap rule, §9.3 anatomy) |
| `keys/*` gitignore rule + its single negation | `.gitignore:67`, `:70` |

### 11.2 `bookbuddy/library_catalog`

| Fact | Where |
|---|---|
| `[env.friend]` — **the whole block** | `apps/worker/wrangler.toml:341–563` (`name` `:344`, assets `:348`, D1 `:352`, R2 `:361`, triggers `:376`, routes `:387`, vars `:391`) |
| `OWNER_EMAILS` on friend is the **estate owner's** break-glass | `apps/worker/wrangler.toml:449` |
| `ESTATE_APP` per instance | `apps/worker/wrangler.toml:262` (`library`), `:536` (`library2`) |
| `PEERS` reciprocity, both directions | `apps/worker/wrangler.toml:223`, `:477` |
| `DONOR_URL`, both directions | `apps/worker/wrangler.toml:209`, `:469` |
| `sweepMode()` — `ai = Boolean(ANTHROPIC_API_KEY)` | `apps/worker/src/lib/details-sweep.ts:317–321` |
| Skip / donor-only branches | `apps/worker/src/lib/details-sweep.ts:919`, `:923` |
| Script twins `predeploy/deploy/postdeploy:friend` | `package.json:20–22` |
| `secret:friend`, `secret:list:friend`, `secrets:push:friend`, `db:migrate:friend` | `package.json:26, 27, 28, 37` |
| `PER_INSTANCE_SECRETS` — `ANTHROPIC_API_KEY` refused, always | `scripts/push-secrets.mjs:314` |
| `PER_INSTANCE_PREFIXES` — `ESTATE_APP_TOKEN_` | `scripts/push-secrets.mjs:317` |
| *"`.dev.vars.friend` still does not exist and must not be created"* | `scripts/push-secrets.mjs:102` |
| Secrets over **stdin, never argv** | `scripts/push-secrets.mjs:655–673` |
| The operating runbook for the second instance | `docs/access/second-instance.md` — ⚠️ its line numbers are carried from the drafts **unverified** |

### 11.3 `boardbuddy/Board_Game_Catalog`

| Fact | Where |
|---|---|
| The prep doc for a second instance | `docs/info/multi-catalog-strategy.md` |
| Zero `[env.*]` blocks | `apps/worker/wrangler.toml` — measured, none |
| Hard-coded estate identity | `apps/worker/src/env.ts:141` (`ESTATE_APP_TOKEN_GAMES`) |
| `RATE_LIMITER` `namespace_id = "1001"` | `apps/worker/wrangler.toml:43–48` |
| Guards now present (⚠️ the prep doc says they are not) | `scripts/deploy-guard.mjs`, `scripts/deploy-done.mjs` |
| `scripts/lib/` — only `platform-repo.mjs` | `scripts/lib/` |
| 30 migrations, through `0030_billing_cache.sql` | `migrations/` |

### 11.4 ⚠️ Draft claims that were STALE and are corrected here

| Draft claim (2026-08-24 / 25) | Corrected 2026-09-05 |
|---|---|
| Migration `0016_catalog_requests` | **`0018`** — 0016 is `billing_policy`, 0017 is `universe_requests` |
| `/api/estate/me` returns 5 fields | **6** — `billing_denied` added 2026-09-02 (`me.ts:75`) |
| `me.ts:1–90` | The file is 153 lines; the interface runs `:26–89`, the function `:105–152` |
| `appTokenFor()` at `env.ts:460–473` | **`env.ts:478–491`** |
| `EstateUserRow` at `env.ts:368–372` | **`env.ts:349`** |
| `requireApprover()` at `middleware/auth.ts:148` | **`:251`** (`requireDevops()` `:201`) |
| Private R2 bindings at `env.ts:28–67` | **`env.ts:21` and `:48`** |
| `admin.js` ~2,461 lines, three sections | **3,151 lines**; three *directory* groups **plus** three top-level panels, one of which (`#verse-queue`) is the precedent to copy |
| `[env.friend]` at `wrangler.toml:275–469` / `295–469` | **`341–563`** of a 563-line file |
| `sweepMode()` at `details-sweep.ts:282–289` | **`:317–321`** |
| stdin technique at `push-secrets.mjs:205–227` | **`~:655–673`** |
| *"No bulk `.dev.vars.<env>` path for a non-main instance, by design"* | 🔴 **No longer true as written.** `secrets:push:friend` is a real script (`package.json:28`) pushing **shared** keys. The surviving — and stronger — guarantee is `PER_INSTANCE_SECRETS` (`:314`) + `PER_INSTANCE_PREFIXES` (`:317`), which refuse `ANTHROPIC_API_KEY` and every `ESTATE_APP_TOKEN_*` for a non-main instance, always |
| The "+" sits **top-right** of the Books card | **Bottom-right** — the owner's later instruction (2026-08-24 23:26Z) wins, and the mockup agrees |
| *"Ships only after dev lanes + more testing"* | **Superseded** 2026-09-05 06:26 Phoenix |
| `Board_Game_Catalog` has no `deploy-guard.mjs`/`deploy-done.mjs` on `main` | **Both exist today** |
| `Board_Game_Catalog` has 28 migrations | **30** |

### 11.5 What could NOT be verified

- **Nothing live.** No production request, no D1 query, no `wrangler secret
  list`, no browser, no Cloudflare / Firebase / Google Cloud console.
- **`second-instance.md`'s internal line numbers.** The file exists and is
  current; the drafts' citations into it are carried over unverified.
- **Whether `RATE_LIMITER`'s `namespace_id` scopes per Worker or per account**
  (§8) — genuinely unknown, and it needs a measurement, not an argument.
- **The `CLOUDFLARE_API_TOKEN`'s current scope** beyond what `DONE.md` records
  (D1 · Edit added by hand after the 2026-08-27 rotation).
- **Effort figures.** Labelled guesses; no comparable build was timed.

---

**Mockup:** <https://claude.ai/code/artifact/717169ac-af10-4b3a-9598-cf1f2ae38f11>
(private artifact, 2026-08-24, updated the same night) — the six steps, the
sealed key, and the owner-editable Accept panel. Its per-step notes are the
source text for §2 and §5.
