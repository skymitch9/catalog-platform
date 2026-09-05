# heygabi.ai — Hostname Layout, and the Ebook Question

> 📍 **Much of §4 has since been executed. This document is the reasoning; the
> [root `README.md`](../../README.md) § Status is the current state**, measured
> 2026-08-10. In short: the apex and all three catalog hosts are live, the
> landing page is in this repo at [`sites/heygabi-home/`](../../sites/heygabi-home/),
> board games kept its Access gate, and the `www` → apex redirect (§4 / `deploy.md`
> §2.1) is still outstanding. Where the two disagree, believe the README — it
> was measured against the running hosts, this was reasoned from files.

> ✅ **Confirmed by the owner 2026-08-10: `heygabi.ai` IS registered at Cloudflare Registrar**, in the same account as the two Workers. The inference below that `.ai` is not a Cloudflare TLD was **wrong**. There is no nameserver change and no zone transfer — the zone is already there, so Workers custom domains, R2 custom domains and redirect rules can all be attached directly.

> **Audience:** Claude sessions and the owner. **Status:** DECISION — no code
> changed, nothing bought beyond the domain. Last verified: **2026-08-09**.
> Builds on [`DOMAIN_AND_HOSTING.md`](DOMAIN_AND_HOSTING.md) (same day) and
> answers [`PLATFORM.md`](PLATFORM.md) §8 question 1 for the naming half.
>
> Every structural claim cites a file. Facts read out of a file today are
> *(measured)*. Facts I reasoned to without running or reading the thing itself
> are *(inferred)*. **I did not query the remote D1**; the 81-works figure comes
> from `library_catalog/docs/HANDOFF.md:56`, not from me.

---

## 0. The decision in one table

| Question | Answer |
|---|---|
| Domain shape | **Subdomains**, per `DOMAIN_AND_HOSTING.md` §1.2. Unchanged |
| Books host | **`library.heygabi.ai`** — one host, print *and* ebook |
| **Does `ebooks.heygabi.ai` exist as an app?** | **No.** Not option (a), not option (b) |
| **What is it then?** | **Option (c): a view.** `library.heygabi.ai/?format=ebook`. Optionally a 301-only subdomain that is never an auth origin |
| Board games | **`boardgames.heygabi.ai`** — the owner's own name, kept |
| Audiobooks | **The apex**, `heygabi.ai`. It is also the combined public view |
| Firebase authorised domains | **Three**: apex, `library.`, `boardgame.` Plus the two existing `*.workers.dev` |
| Is now the moment to fork? | **Now is the cheap moment to fork, and forking is still wrong.** §5 |

**The one-line reason:** `edition.format` is on `edition`, not `work`
(`migrations/0001_init.sql:185-208`), and the schema comment above it says in as
many words that this is *"where `format` makes 'I own this in audio and paperback
but not ebook' a query rather than a feature"* (`0001_init.sql:181-184`). Two
databases turn that one indexed query into a cross-database join with no foreign
key. Splitting the catalog spends the design's central asset to buy a hostname.

---

## 1. The hostname map

> **Revised 2026-08-10 by the owner: every catalog host is PLURAL.** The earlier
> draft mixed `boardgame.` (singular) with `audiobooks.` (plural) and put the
> audiobook site on the apex. One rule now — plural, one per catalog — and that
> frees the apex for the combined view rather than having it double as the
> audiobook site.

| Host | Serves | Cloudflare object | Firebase authorised domain? |
|---|---|---|---|
| `heygabi.ai` (+ `www`) | **The combined view / landing page.** Links the three catalogs; eventually the cross-format index (`PLATFORM.md` §5) | **Pages**, direct upload | ✅ **yes** — if anything there signs in |
| `audiobooks.heygabi.ai` | Audiobook catalog and its `/dev/` lane | **Pages** | ✅ **yes** — Google popup runs here |
| `library.heygabi.ai` | `library_catalog` Worker + D1 + PWA. **Print and ebook, one app** | **Worker** custom domain | ✅ **yes** — live |
| `boardgames.heygabi.ai` | `Board_Game_Catalog` Worker + D1 + PWA | **Worker** custom domain | ✅ **yes**, once it moves off Access |
| `ebooks.heygabi.ai` | **301 → `library.heygabi.ai/?format=ebook`** | DNS + Single Redirect Rule. **No Worker, no app** | ❌ **never** — see §1.3 |
| `covers.heygabi.ai` | Audiobook cover art | **R2** public bucket | ❌ never |
| `index.heygabi.ai` | Cross-format index Worker (unbuilt) | **Worker** custom domain | ❌ never |
| `books.heygabi.ai` | **Not created.** `library.` is the books host | — | — |

⚠️ **`library.` stays singular and that is not an inconsistency.** It is not a
plural of a content type like the others — it is the name of the *place* that
holds both print and ebooks. Renaming it `books.` would reintroduce exactly the
problem §1.1 warns about: `books.` implies a sibling `ebooks.` app, and once both
names look like apps someone eventually builds the second one.

⚠️ **`ebooks.` is a redirect and must never become an auth origin.** The moment
it serves the app directly it is a second Firebase origin for the same data, and
`identity.js`'s `signOut()`-on-load behaviour makes multi-origin auth for one app
actively hostile. A 301 costs nothing and cannot drift.

### 1.1 Why the books host is called `library.` and not `books.`

Because the name is load-bearing. `books.heygabi.ai` implies a sibling
`ebooks.heygabi.ai`, and once both names exist someone will eventually make the
second one real. `library.` is format-neutral, matches the repo
(`bookbuddy/library_catalog`), matches the app's own title — `manifest.webmanifest`
and `apps/web/index.html` both say **"Library"** *(measured)* — and matches the
sign-in copy already shipped: *"Our books, on the shelf and on the Kindle"*
(`apps/web/src/App.tsx:102`). The app has always claimed to be both things. The
hostname should not argue with it.

### 1.2 Where this departs from `DOMAIN_AND_HOSTING.md`

Two changes, both small.

| That doc | Here | Why |
|---|---|---|
| `games.<domain>` | **`boardgames.heygabi.ai`** | The owner named it. Its §1.5 criterion was "typeable on a phone", and that criterion applies to `library.` — the one used standing at a bookshelf — not to the games host. If the owner prefers `games.`, take it and make `boardgame.` a redirect; **only one of the two goes in Firebase authorised domains** |
| Track A steps 2–3 assume **Cloudflare Registrar** | ✅ **Correct as written.** `heygabi.ai` is registered at Cloudflare Registrar, in the same account as the two Workers — confirmed by the owner 2026-08-10. An earlier inference here that `.ai` was not a Cloudflare TLD was **wrong**. | Nothing to do. No zone transfer, no nameserver change. The zone is already in the account, so Workers custom domains, R2 custom domains and redirect rules attach directly. |

Also worth one line: `DOMAIN_AND_HOSTING.md` §4.1 budgeted **~$11–13/yr** for a
`.com`. `.ai` is materially more expensive and the registry commonly requires a
two-year term *(inferred — verify on the renewal notice, not here)*. This does
not change any architecture; it changes one row of a cost table that is already
labelled an estimate.

### 1.3 ⚠️ A redirect subdomain must never become an authorised domain

If `ebooks.heygabi.ai` is created at all, it exists to emit a `301` and nothing
else. The moment it is added to Firebase's authorised-domain list it becomes an
OAuth redirect surface for the shared `audiobook-catalog` project — the same
argument `DOMAIN_AND_HOSTING.md` §1.4 makes for keeping `covers.` and `index.`
off the list. A host that only redirects never runs a sign-in, so it never needs
to be there. Adding it "just in case" is the failure mode.

---

## 2. The ebook decision

### 2.1 Stated plainly

**`ebooks.heygabi.ai` is not a catalog and not a hostname the app is served on.
It is a URL: `https://library.heygabi.ai/?format=ebook`.**

One app, one database, one origin, one PWA. "Ebooks" is a filter over
`edition.format`, exposed as a control in the collection toolbar and reachable
by a link you can bookmark or pin to a home screen.

That is option (c). It rejects (a) outright and rejects (b) as a strictly worse
way of getting the same thing — see §2.4.

### 2.2 What splitting would cost

Not abstractions. Specific things that exist in the repo today.

**(a) The one query the schema was built for stops being a query.**
`edition.format` lives on `edition`, keyed to `work_id`
(`migrations/0001_init.sql:185-208`); `copy` is denormalised with `work_id`
alongside `edition_id` explicitly *"so 'do we own this book in any form' is one
indexed lookup"* (`0001_init.sql:243-247`). `listCollection` already implements
the format question as a correlated `EXISTS` over `edition`
(`packages/db/src/works.ts:252-255`). Two D1 databases cannot be joined by a
Worker in one statement; the query becomes two round trips and a merge in
application code, for a fact that is currently free.

**(b) A work owned in both formats becomes two works, and `work_key` is the
casualty.** `work.work_key` is not merely a column — it is *the* bridge to the
audiobook catalog, computed once on write and deliberately never recomputed
(`0001_init.sql:92-108`, enforced in `packages/db/src/works.ts:9-19`). Duplicate
the work across two databases and you duplicate the key. Everything hanging off
it duplicates with it:

| Duplicated | Where | Consequence |
|---|---|---|
| `work_key` | `work` | Two rows claim one bridge; the audiobook join is ambiguous |
| Firestore review doc | shared `reviews` collection, doc id from `bookIdFromTitle` | ⚠️ **Both apps write the same document id.** Reviewing from the ebook app overwrites the review written from the print app. Same store, no owner |
| `rating_cached` | `user_book` (`0001_init.sql:311-313`) | Two mirrors of one Firestore value, free to disagree. The migration comment already warns this column is a read-model and *"nothing may read it and write it back"* — two mirrors make that rule unenforceable |
| `user_book.read_state` | `user_book` | "Did I read this?" has two answers. `read_format` (`print/ebook/audio`, `0001_init.sql:307`) exists precisely so one row can say "read, as audio" |
| `work_alias` | `work_alias` | "Northern Lights" ↔ "The Golden Compass" recorded twice, or once and missing on the other side |
| `lookup_cache` | `lookup_cache` | The same ISBN paid for twice against the free-tier quotas that `docs/info/isbn-ladder.md` measured |
| `app_user` | `app_user` | Ownership claimed twice, roles approved twice. `OWNER_EMAILS` recovery hatch in two `wrangler.toml`s |

⚠️ The Firestore row is the sharpest one. It is a **silent overwrite**, in the
exact shape this household has shipped twice before — the two author-splitters
(`PLATFORM.md` §2.3) and the two `work_key` implementations
(`library_catalog/docs/HANDOFF.md` finding 5). The response to that pattern in
this codebase has consistently been *one implementation, one store*. A second
database writing the same review documents reintroduces it deliberately.

**(c) Operational duplication.** A second Worker name, a second
`database_id` in a second `wrangler.toml` (today: one, `6022ea5e-2510-450e-81ce-7d847fa31379`,
`apps/worker/wrangler.toml:14-25`), both migrations applied twice forever, a
second secrets set (`docs/access/cloudflare.md` §4), a second deploy lane, a
second Firebase authorised domain, and a second `manifest.webmanifest`.

**(d) The direction of overlap is against you.** The measured population is
Kindle-Unlimited and Audible-native indie titles — `HANDOFF.md` finding 2: 14 of
30 sampled titles have no Open Library record, *"the misses are the Kindle
Unlimited / Audible-native indie half"*. Those are exactly the books most likely
to be owned as an ebook **and** later in print. The overlap set is not an edge
case in this library; it is the library.

### 2.3 What splitting would buy — stated fairly

These are real and I am not dismissing them.

| Argument for splitting | Weight |
|---|---|
| **Different acquisition pipelines.** Ebooks arrive from Calibre-Web Automated over an ingest route with its own token; print arrives from an ISBN barcode at a shelf | Real, and **already true inside one app**. `/api/ingest` and `/api/isbn/*` were separate routes that coexisted; the ingest half was removed on 2026-08-09 for reasons unrelated to coupling (`HANDOFF.md:42-52`). Different write paths do not imply different databases |
| **Different UI needs** — a "send to my reader" button versus a shelf location and a condition | Real, and the codebase **already encodes the partition as data**: `PHYSICAL_FORMATS` and `EBOOK_FILE_FORMATS` are named constants (`packages/core/src/constants.ts:53-57`, `:66-72`). A per-format panel is a conditional render over a constant that exists |
| **A sparse `copy` table.** Eight physical-only columns — `location`, `acquired_on`, `price_paid_cents`, `vendor`, `condition`, `is_signed`, `lent_to`, `edition_notes` (`0001_init.sql:241-268`) — are meaningless for all 83 ebook editions | **The strongest one.** See §2.6 |
| **Different people.** Someone who only reads ebooks should not see the shelf | Real in principle; unevidenced here. Two humans, both use both. And this is an *authorisation* question — `app_user.role` and the capability model (`packages/core/src/capabilities.ts`) are the tool for it. Expressing permissions as separate deployments is the expensive way to say `role` |
| **A cleaner story per app** | True, and it is worth something. It is worth less than a cross-database join |

### 2.4 The middle option — same app, second hostname, preset filter

This is the one worth taking seriously, and I still reject it. What I checked:

**Does anything key on hostname today?** *(measured — one grep over the repo,
excluding `node_modules`, found exactly three hits, all in one file.)*

| `apps/web/src/lib/firebase.ts` | What it does |
|---|---|
| `:80-85` `reviewsCollection()` | `reviews_dev` if `pathname` contains `/dev/` **or** hostname is `localhost`/`127.0.0.1`; otherwise `reviews` |
| `:96` `signIn()` | `signInWithRedirect` on localhost (Chrome COOP blocks the popup), `signInWithPopup` everywhere else |

Nothing in the Worker keys on hostname *(measured)* — `apps/worker/src/index.ts`
routes on path only, and `wrangler.toml` needs no change for a custom domain, a
point `docs/access/cloudflare.md:270-272` makes explicitly: *"The app reads no
absolute URLs of its own … so it follows the origin it is served from."*

So a second production hostname is **safe** — both hosts are non-local, both get
`reviews`, both get the popup. It is also **cheap**: read `location.hostname`
once, map it to a default filter, thread it into `CollectionPage`. Perhaps
twenty lines.

**So why not?** Because it costs more than the URL and buys nothing the URL does
not.

1. ⚠️ **The manifest is a static file.** `apps/web/public/manifest.webmanifest`
   *(measured)* hardcodes `"name": "Library"`, `"start_url": "/"`,
   `"scope": "/"`, and is served straight out of the `[assets]` binding
   (`wrangler.toml:10-12`). Two hostnames serving one build get **two home-screen
   icons both called "Library", both launching the unfiltered collection.** The
   entire point of the second hostname — a distinct app on the phone — is the one
   thing it does not deliver. Fixing it means intercepting `/manifest.webmanifest`
   in the Worker and rewriting it per `Host` header, or building twice. That is
   real work in service of a cosmetic goal.
2. **A hostname is a worse filter than a query string.** Hostname gives you
   exactly one preset and needs a DNS record, a Firebase console entry
   (owner-only, unscriptable — `docs/access/cloudflare.md` §5) and a code branch
   per preset. `?format=…` gives you every preset for free, plus
   `?status=lent`, plus shareable filtered links, plus the back button.
3. **A second authorised domain is a permanent security surface** for a
   throwaway convenience.
4. **It teaches the wrong thing.** Two hostnames make the split feel real, and
   the next question is always "why is the data still shared?" The middle option
   is stable only as long as nobody pushes on it.

The redirect variant in §1 keeps the memorable name and pays none of this: DNS
plus one Cloudflare Single Redirect Rule, no code, no Firebase entry, no second
PWA scope.

*(Caveat, inferred: how a phone's "Add to Home Screen" treats a URL with a query
string differs by browser — Chrome prefers the manifest's `start_url`, Safari
tends to capture the current URL. If the pinned ebook shortcut turns out to
matter in practice, the cheap fix is a Worker-served manifest keyed on the query
string. **Do not build that until someone asks.**)*

### 2.5 Does the answer change at 10:1 physical-to-ebook?

**No, and it gets stronger.** Three reasons:

1. The case for a separate ebook app is at its **maximum today**, when 100% of
   the 81 works are ebooks (`HANDOFF.md:56`) and the app genuinely looks like an
   ebook app. At 10:1 it looks like what it is — a library with an ebook
   section — and nobody would propose the fork.
2. At 10:1 the overlap set grows in absolute terms. If a tenth of 900 print
   books are also owned as ebooks, that is ~90 works that would have to be
   duplicated across databases, each dragging the §2.2(b) table with it.
3. The minority side of a split is the side that rots. An `ebooks` Worker with a
   few hundred rows and no daily use is the one whose migrations fall behind and
   whose dependency bumps get skipped.

The ratio changes which filter should be the *default view*, and nothing else.
That is a `useState` initial value.

### 2.6 ⚠️ The strongest argument against my own recommendation

Here it is, at full strength, because it is not weak.

**The split already exists in the data, and I am refusing to name it.** Of the
`copy` table's twelve meaningful columns, eight describe a physical object
(`0001_init.sql:241-268`) and are NULL for every one of the 83 ebook editions in
production. The ebook side needed its own migration (`0002_cwa_ebook_formats.sql`),
its own external system (Calibre-Web Automated, in Docker, with a volume and an
ingest token), its own identifier (`cwa_book_id`, `0002:74-78`), its own source
value (`'cwa'`), and its own class of non-object — `ebook_kindle`, re-scoped in
that same migration to mean *a licence with no bytes*
(`0002:26-28`). None of that has anything to do with a bookshelf. A table where
most rows use none of the columns, fed by a pipeline that shares no code with the
other pipeline, is a table describing two things. The honest move would be to
say so now, while it costs 81 rows, rather than in a year when it costs 900.

**Why I still land the other way.** Sparse columns are a cosmetic cost paid in
NULLs; a cross-database join is a structural cost paid in every query, forever.
The sparse-`copy` problem has a cheaper answer that requires no fork: a licence
does not need a `copy` row at all — `copy.edition_id` is nullable and the table
is optional per edition. And the pipelines being different is an argument about
**write paths**, which one app already had two of. The asymmetry that settles it
is reversibility: **not splitting can be undone later at a cost proportional to
the overlap; splitting can only be undone by deduplicating two databases on
`work_key` by hand.** Under genuine uncertainty, take the reversible option.

---

## 3. What changes in code

Adopting the recommendation is a small, additive change set. Nothing is deleted,
no migration is needed, and the D1 schema is untouched.

### 3.1 Required

| # | File | Change |
|---|---|---|
| 1 | `packages/core/src/constants.ts` | **Add `EBOOK_FORMATS`.** See the ⚠️ below — this is the one place a mistake is likely |
| 2 | `packages/db/src/works.ts:252-255` | The format filter is **exact equality on one value**. Teach it families: when `query.format` is `ebook` or `physical`, expand to `e.format IN (…)` from the constants. Keep single-format equality working — the UI will want "just hardcover" |
| 3 | `apps/web/src/pages/CollectionPage.tsx:22-31` | `reload()` calls `api.collection({ q })` — **`format` is never sent.** Add filter state and a toolbar control (All / Physical / Ebook, and the specific formats). `formatLabel` is already imported at `:4` |
| 4 | `apps/web/src/App.tsx` | Read `new URLSearchParams(location.search).get('format')` once as the initial filter. ⚠️ **Not a router** — `:47-54` records the deliberate decision not to add one, and this does not need one |

⚠️ **The gotcha in change 1, and it is a silent one.** `EBOOK_FILE_FORMATS`
(`constants.ts:66-72`) **deliberately excludes `ebook_kindle`**, because that
value means an Amazon licence with no bytes and *"anything that offers 'send to
my reader' must gate on this list, or it will offer to send a file that does not
exist."* That exclusion is correct for its purpose and **wrong for a browse
filter**: a "show me my ebooks" view built on `EBOOK_FILE_FORMATS` silently hides
every Kindle-licence row — a population `HANDOFF.md` finding 2 and
`0002:20-28` both measured as large. So define a third, separate constant in
`constants.ts` (leaf module — nothing under `src/` may import `index.ts`,
`constants.ts:1-12`), and never build the browse list by spreading the
send-to-device list at a call site.

### 3.2 Explicitly unchanged, and why that is worth recording

| File | Why no change |
|---|---|
| `apps/worker/src/routes/catalog.ts:41` | Already reads `c.req.query('format')` and passes it through |
| `apps/web/src/api.ts:69-78` | `collection()` already accepts and serialises `format` |
| `apps/worker/wrangler.toml` | A Workers custom domain needs nothing here — `docs/access/cloudflare.md:270-272` |
| `apps/web/src/lib/firebase.ts:80-85` | `library.heygabi.ai` is non-local, so `reviewsCollection()` returns `reviews`. Correct by accident of the existing test, but correct |
| Any migration | `format` already carries all nine values (`0002:57-60`) |

⚠️ **A standing hazard to write down now, before someone trips it.** If a
`dev.library.heygabi.ai` or any second non-local hostname is ever added,
`firebase.ts:80-85` will return `reviews` for it and the dev lane will read and
write **production** review documents. That is bit-for-bit the bug
`DOMAIN_AND_HOSTING.md` §2.3 found in the audiobook site's `fb-env.js` — same
shape, different repo, and this one has no `DEV_HOSTNAMES` list to add to. Any
new hostname for this app must be checked against that function first.

### 3.3 For the record — what the rejected split would have cost

So the cost is legible if the decision is ever revisited: a second `wrangler.toml`
and Worker name; `wrangler d1 create` and a second `database_id`; both migrations
applied to it and to every future one; the secrets set from
`docs/access/cloudflare.md` §4 re-created; a second `app_user` with ownership
re-claimed; a second `manifest.webmanifest`; a Firebase authorised-domain entry;
a data move of the 81 works; and every cross-format question rewritten as two
fetches joined in the browser.

---

## 4. Migration order

🔴 = **owner only**, cannot be scripted or done by a session.
Track A is a correction to `DOMAIN_AND_HOSTING.md` §3 Track A for a `.ai` domain
not held at Cloudflare Registrar. Tracks B and C are independent and B can start
today.

### Track A — get the zone onto Cloudflare

| # | Step | Notes |
|---|---|---|
| 1 | ✅ **Done — registered at Cloudflare Registrar**, same account as the Workers (owner, 2026-08-10). Skip to 3; `DOMAIN_AND_HOSTING.md` Track A applies verbatim. |
| 2 | ✅ **Not needed.** The zone is already in the Cloudflare account because the domain is registered there. No nameserver change, no propagation wait. |
| 3 | 🔴 **Confirm the zone is Active** in the dashboard | Nothing below works until it is |
| 4 | 🔴 **Add `heygabi.ai` (and `www` if used) to Firebase authorised domains** — console → project `audiobook-catalog` → Authentication → Settings → Authorised domains | **Before** any cutover. Unscriptable: `docs/access/cloudflare.md` §5. Leave every existing `*.workers.dev` entry in place — they are the escape hatch |

### Track B — the ebook view (no domain needed; do this first)

| # | Step | Notes |
|---|---|---|
| 5 | Add `EBOOK_FORMATS` to `packages/core/src/constants.ts` | §3.1 change 1. ⚠️ Not a spread of `EBOOK_FILE_FORMATS` |
| 6 | Teach `listCollection` format families | `packages/db/src/works.ts:252-255`. Add a core-rule test — `npm test` is 26 tests via tsx, no framework |
| 7 | Add the filter control and the `?format=` initial state | `CollectionPage.tsx`, `App.tsx`. Verify locally: `npm run dev`, then `curl -s "localhost:8787/api/collection?format=ebook"` |
| 8 | Commit (`git commit -F`, **never `-m`** — `CLAUDE.md`), then `npm run deploy` | The deploy refuses a dirty tree by design |

**This track is worth doing on `*.workers.dev` alone**, before any DNS exists. It
is what stops the app from *looking* like an ebook app while the physical
project starts — which is the real thing the owner's "now would be the time"
instinct is pointing at.

### Track C — hostnames

| # | Step | Notes |
|---|---|---|
| 9 | 🔴 **Add `library.heygabi.ai` to Firebase authorised domains** | Before step 10, or sign-in fails with `auth/unauthorized-domain` |
| 10 | 🔴 **Attach `library.heygabi.ai`** as a Workers custom domain: Worker → Settings → Domains & Routes | `docs/access/cloudflare.md:260-272`. Nothing in `wrangler.toml` changes |
| 11 | Verify: sign in completes, `/api/health` answers, the collection loads, `?format=ebook` filters | ⚠️ Confirm reviews land in `reviews`, **not** `reviews_dev` — §3.2 |
| 12 | 🔴 *(optional)* Create `ebooks.heygabi.ai` → DNS + a **Single Redirect Rule** to `https://library.heygabi.ai/?format=ebook`, 301 | ⚠️ **Do not add it to Firebase authorised domains.** §1.3 |
| 13 | The audiobook site to the apex | `DOMAIN_AND_HOSTING.md` §3 Tracks B and C, unchanged. Independent of everything above |
| 14 | 🔴 Board games last: `PLATFORM.md` §4.1 checklist → remove Access → add `boardgames.heygabi.ai` to Firebase → attach it | Order matters. §4.1 is a prerequisite, not a nicety — it is the only step in the whole plan that reduces security |

`*.workers.dev` stays live throughout and afterwards. It costs nothing and it is
the rollback.

---

## 5. What would change my mind, and what it would cost to defer

### 5.1 Signals that would justify revisiting

| Signal | Would it justify a second **database**? |
|---|---|
| A person who must see ebooks and must not see the shelf | **No.** That is `app_user.role` and `packages/core/src/capabilities.ts` |
| Ebooks want public browse; the shelf must stay private (locations, prices, `lent_to`) | **No.** That is the index Worker's default-deny projection, `PLATFORM.md` §5.2 |
| A large ebook-only feature set — device delivery, conversion queues, reading progress sync | **No.** That is screens and routes. Possibly a second **Worker** — see §5.2 |
| A scheduled ebook ingest whose cron, CPU budget or deploy cadence must not share a lane with the shelf app | **Maybe a second Worker. Still not a second database** |
| ⚠️ **Ebook works stop being the same works** — e.g. the catalog starts tracking serialised web fiction, fan translations or per-chapter objects with no print counterpart and no meaningful `work_key` | **Yes.** This is the only one that genuinely breaks the shared model, because it breaks the *work* abstraction rather than the *edition* one |

### 5.2 The escape hatch that makes deferring cheap

⚠️ **The app split and the data split are separable, and only the data split is
expensive.** A D1 database can be bound to more than one Worker *(inferred — I
did not test it; it is a binding in `wrangler.toml`, not an ownership claim)*. So
if the ebook side ever needs its own deploy lane, its own cron or its own CPU
budget, the move is a second Worker with `database_id = "6022ea5e-2510-450e-81ce-7d847fa31379"`
in its own `wrangler.toml` — same rows, same `work_key`, same reviews, one
`lookup_cache`. Every §2.2 cost stays unpaid.

Knowing this hatch exists is most of the reason the fork is not urgent.

### 5.3 The cost of deferring, honestly

The owner is right that the fork is cheapest now, and right about why: 81 works,
83 editions, zero physical books, zero overlap (`HANDOFF.md:56`). Today the split
is a `wrangler d1 create`, two migrations and a copy of 81 rows — an afternoon.

What that cost becomes later is governed entirely by **overlap**, not by size:

| When | What splitting costs |
|---|---|
| Today | ~81 rows move. No work exists in two formats. An afternoon |
| Once physical books exist but overlap is small | Still mostly mechanical: move the rows whose editions are all ebooks. Every overlapping work needs a human decision |
| At scale, say 900 print + 300 ebook with ~90 overlaps | Per overlapping work: duplicate the `work` row, duplicate `work_key`, decide which side owns the Firestore review document, split `user_book` read-state, copy or drop `work_alias`, then keep the two copies in step by hand forever. **Not an afternoon** |

So: **the window is real, and the right thing to put through it is Track B, not
the fork.** The genuinely time-sensitive risk is not "we failed to split in
time" — it is that the app spends the next months looking like an ebook app,
the physical additions feel like guests in it, and the fork starts to look
obvious for reasons that are about the UI rather than the data. A format filter
and a format-neutral hostname close that window for a day's work and keep every
option open.

And if I am wrong, the cost of my being wrong is bounded by §5.2. The cost of
the other error is a permanent cross-database join.

---

## 6. What not to do

| Don't | Why |
|---|---|
| ⚠️ **Give `ebooks.` its own D1 database** | §2.2. Duplicates `work_key`, and two apps then write the same Firestore review documents — a silent overwrite of the exact class this household has shipped twice |
| ⚠️ **Add a redirect-only subdomain to Firebase authorised domains** | §1.3. It never runs a sign-in; each entry is an OAuth redirect surface |
| ⚠️ **Build the ebook browse filter on `EBOOK_FILE_FORMATS`** | `constants.ts:66-72` excludes `ebook_kindle` on purpose. The filter would silently hide every Kindle licence, which is a large share of this library |
| ⚠️ **Add a second non-local hostname without checking `firebase.ts:80-85`** | It returns `reviews` for anything non-local. A `dev.` host would write to production review documents. §3.2 |
| **Name the books host `books.`** | It implies a sibling `ebooks.` app, and names become plans. §1.1 |
| **Add a router to make `?format=` work** | `App.tsx:47-54` declines a router deliberately; a query param read once needs none |
| **Add an `audiobook` value to `edition.format`** | Already answered: `HANDOFF.md` open question 5, **no**. Audiobooks stay in their own catalog and meet this one through `work_key` (`PLATFORM.md` §2.2) |
| **Create a second Firebase project for the ebook host** | `docs/access/cloudflare.md` §5: a second project mints different tokens for the same human and silently forks every user |
| **Serve two apps on one origin** | `audiobook_catalog/site/identity.js:44-54` signs out the shared Firebase Auth session on every page load. `DOMAIN_AND_HOSTING.md` §1.2 — this is the finding that settles subdomains-vs-paths |

---

## 7. Open questions for the owner

| # | Question | Blocks | Why it needs you |
|---|---|---|---|
| ~~1~~ | ~~Where is `heygabi.ai` registered?~~ | — | ✅ **Answered 2026-08-10: Cloudflare Registrar**, same account as the Workers. It was nothing at all. |
| 2 | `boardgame.` or `games.`? | Step 14 and its Firebase entry | Taste. Only one is canonical; the other can 301 |
| 3 | Apex or `www` as the canonical audiobook host? | Track A step 4 | One of them is the auth origin; changing it later means re-authorising |
| 4 | **Do you actually want `ebooks.heygabi.ai` to exist as a redirect?** | Step 12 | Purely a convenience. It is free and reversible; it is also one more name to remember |
| 5 | Should the default view be everything, or physical-only once print books outnumber ebooks? | A `useState` initial value | Only you know how you will use it |
| 6 | Is the ebook pipeline coming back, and roughly when? | Nothing here — recorded because it is the one input that could move §5.1 | `HANDOFF.md:42-52` says it is expected to resume. If it resumes with a very different object model, revisit §5.1's last row |

---

## Sources

Files read **2026-08-09**. Nothing below was executed; no database was queried
and no deploy was made.

**`bookbuddy/library_catalog`**
- `migrations/0001_init.sql` — `work` (:70-141), `work_key` (:92-108), `edition` and `format` (:185-235), `copy` (:241-273), `user_book` and `rating_cached` (:296-320)
- `migrations/0002_cwa_ebook_formats.sql` — the nine-value format enum (:57-60), `ebook_kindle` re-scoped to a licence (:20-28), `cwa_book_id` (:74-78)
- `packages/core/src/constants.ts` — `EDITION_FORMATS` (:25-49), `PHYSICAL_FORMATS` (:53-57), `EBOOK_FILE_FORMATS` (:66-72), the import-order rule (:1-12)
- `packages/db/src/works.ts` — `CollectionQuery` (:211-219), `listCollection` and the exact-equality format filter (:236-285)
- `apps/worker/src/index.ts` — path-only routing, SPA fallback (:32-50)
- `apps/worker/src/routes/catalog.ts:41` — the `format` query param
- `apps/worker/wrangler.toml` — assets binding (:10-12), the single D1 (:14-25), `FIREBASE_PROJECT_ID` (:42-51)
- `apps/web/src/lib/firebase.ts` — `reviewsCollection()` (:80-85), `signIn()` (:91-102). **The only hostname coupling in the repo**
- `apps/web/src/api.ts:69-78` — `collection()` already serialises `format`
- `apps/web/src/pages/CollectionPage.tsx:22-31` — `format` is never sent
- `apps/web/src/App.tsx` — "Deliberately not a router" (:47-54), sign-in copy (:102)
- `apps/web/public/manifest.webmanifest`, `apps/web/index.html` — `"Library"`, `start_url: "/"`, static
- `apps/web/public/_headers`, `apps/web/vite.config.ts`
- `docs/HANDOFF.md` — 81 works / 83 editions (:56), the paused pipeline (:42-52), findings 2 and 5 (:100-121), open question 5 (:194)
- `docs/info/data-model.md`, `docs/access/cloudflare.md` (§2, §5, §6 at :260-272), `CLAUDE.md`

**`catalog-platform/docs`**
- `DOMAIN_AND_HOSTING.md` — the `identity.js` signOut finding (§1.2), authorised domains (§1.4), costs (§4)
- `PLATFORM.md` — §2.2 nothing merges, §2.3 the drift bug, §4/§4.1 Access removal, §5.2 the default-deny projection
- `LIBRARY_CATALOG.md` — §7 ebook sources, §8 build plan

**Not verified**
- ~~Whether Cloudflare Registrar supports `.ai`~~ — ✅ **resolved 2026-08-10: it does, and `heygabi.ai` is registered there.** The inference in §1.2 was wrong; treat it as a reminder that an unverified claim marked as inferred is still a claim that can be wrong.
- `.ai` registration and renewal pricing, and any minimum-term requirement.
- That one D1 database can be bound to two Workers (§5.2). High confidence; untested.
- The contents of the remote D1. The 81-works figure is quoted from `HANDOFF.md`, not measured by me.
- Home-screen / `start_url` behaviour for a URL carrying a query string, which differs by browser (§2.4).
