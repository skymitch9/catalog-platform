# Estate-Wide Auth — Information Reference (design)

> **STATUS UPDATE 2026-08-14 (status lines only; the header below predates the
> deploys):** §14.1–14.4 are **LIVE** — `auth.heygabi.ai` deployed + seeded
> (health: 2 approved / 1 approver; remote 0001 + 0002 applied),
> `index.heygabi.ai` deployed with all three sources pushed, apex search +
> `/admin` deployed. §14.5: library adopted in **shadow** (`ESTATE_CHECK=shadow`
> deployed; enforcement not built), games flipped to **enforce** and deployed
> 2026-08-14T05:07Z. Verified by curl/probe that day; every "deploy pending"
> phrase below is stale. Runbook: `library_catalog/docs/access/estate-auth.md`.
>
> **Audience:** Claude sessions and the owner. **Status:** TRACKED — §14.1 +
> §14.2 **BUILT 2026-08-13** (auth Worker `apps/auth-worker/`, D1 `estate_auth`
> created id `d94ffe45-4dd0-4dc2-86de-b8c4d649c1cb`, canonical module
> `packages/estate-auth/`, seed script); auth Worker since **DEPLOYED and
> SEEDED** at `auth.heygabi.ai` (dispatcher). §14.3 **BUILT 2026-08-13**
> (the index Worker is the first wired consumer — estate_cache migration
> 0002, reads gated, probes run; its own deploy still pending). §14.4
> **BUILT 2026-08-13** (apex search in `#find` + the `/admin` member page,
> `sites/heygabi-home/`; deploy pending — the dispatcher's, and 🔴 the apex
> must enter Firebase authorised domains with it; ⚠️ the §15 two-tab test
> becomes due on that deploy). §14.5 not started. Owner answered all
> seven §13 questions 2026-08-13; the build folds them in: machinery
> estate-wide with per-surface `public:` posture (audiobook site untouched),
> default-grant ON (library `reader`, games `viewer`), TTL 10 min, approver =
> owner via `is_approver` API flag, pre-seed list later (`--extra`), admin UI
> on the APEX so the Worker ships an admin API with CORS locked to
> `https://heygabi.ai` and NO admin page (§4.4 amended), Worker confirmed
> wanted. Originally written by Fable 5, 2026-08-13, for owner approval.
> Last verified: **2026-08-13** — every "measured" claim below was read out of
> the named file or grep that day. §15 lists what was NOT verified.
> Companions: `PLATFORM.md` §4 (the sketch this replaces), §4a (the Firestore
> rules decision this must not violate), `info/index-worker-design.md` §9 Q3
> (the open question this answers),
> `library_catalog/docs/info/identity-and-reviews.md` (the identity ground).

The owner's requirements, verbatim:

1. **"heygabi.ai stays open, but using the global search requires a login."**
2. **"Login becomes app-wide."**
3. **"Take the audiobook catalog's users and move them onto the global auth."**
4. **"New users are approval-only."**
5. **"A way that when we bring new sites into the catalog they inherit auth."**

Requirement 5 drives the design. It is the only requirement that is a *shape*
rather than a feature, and designing for it first is what produces the other
four as consequences instead of four separate bolt-ons. §11 argues this
explicitly.

---

## 1. Where auth actually stands — measured, and better than the brief said

The single most important fact, and it changes the size of this project:

> ⚠️ **Identity is already global. Approval is not.**

Both editor Workers verify the **same Firebase ID tokens from the same
project** today:

| App | Verifier | Project pinned | Measured |
|---|---|---|---|
| `library.heygabi.ai` | `apps/worker/src/middleware/auth.ts` — jose, JWKS, iss+aud asserted | `FIREBASE_PROJECT_ID = "audiobook-catalog"` | `wrangler.toml:91` |
| `boardgames.heygabi.ai` | same file shape, near-identical | `FIREBASE_PROJECT_ID = "audiobook-catalog"` | `wrangler.toml:125` |

**`PLATFORM.md` §1's "Auth: Cloudflare Access" row for board games is stale.**
Access was deleted 2026-08-10 (`sites/heygabi-home/README.md` records it), and
the games `auth.ts` header explains the move in its own words. `PLATFORM.md`
§4 — "both editor Workers move to Firebase ID tokens" — has already **happened**.
One Google sign-in already covers both Workers; the same email lands in both
`app_user` tables as one person.

What is *not* global:

| Gap | Today |
|---|---|
| **Approval** | Per-app. Approved into the library ≠ approved into games; the same person queues twice, and an owner approves twice |
| **Revocation** | Per-app, by hand, in each People page |
| **The audiobook site** | No real auth at all — Google is used to *capture* a name/email into localStorage, then `signOut()` immediately; its own `isAdmin()` says "PRESENTATION ONLY … not, and cannot be, an access control" |
| **The index Worker** | Built, undeployed, no auth — deployment is gated on exactly this design (`index-worker-design.md` §9 Q3) |
| **Global search** | Does not exist yet; the apex reserves `<section id="find">` for it |
| **New sites** | Nothing to inherit but a file to copy — and the copies have **already drifted** (§1.1) |

### 1.1 ⚠️ Exhibit A: the two copies of `auth.ts` have already diverged

Measured 2026-08-13. The games copy hardened its dev bypass to
`ENVIRONMENT === 'development'`, with a comment warning that the old test —
`!== 'production'` — silently enables the bypass for *any unrecognised value*
("a typo, a new named environment, an unset var in some future preview lane").
**The library copy still ships `!== 'production'`** (`middleware/auth.ts:80`).

The library's exposure is real but bounded: `wrangler.toml` sets
`ENVIRONMENT = "production"` explicitly, so the bypass needs both a config
regression *and* `DEV_EMAIL` set in production. But the drift itself is the
point: the estate's most security-critical file exists as two copies, one of
which received a hardening the other never heard about. That is the exact
failure mode this design must make structurally impossible for site four, five
and six — and it is why §8's inheritance contract centres on **one canonical
implementation**, not a checklist that says "copy the file".

### 1.2 The role vocabularies diverged on purpose, and stay diverged

| App | Roles (CHECK constraint, measured) |
|---|---|
| library | `owner \| manager \| reader \| pending` (0001 + 0008 — the brief's `owner\|reader\|pending` was stale) |
| games | `owner \| manager \| rater \| viewer \| pending` (0001 + 0023 + 0024) |

`reader` deliberately folds rating into reading; games deliberately splits
`rater` from `viewer` ("that is the whole difference between the two
read-capable guest roles"). A global role set is **lossy for games** and would
erase a distinction an owner explicitly built two migrations to create. So this
design does not unify roles — see §4's three-layer split.

### 1.3 The local user rows are load-bearing and cannot move

**12 foreign keys reference `app_user(id)` in the library alone** (grep over
`migrations/`, 2026-08-13): `user_book.user_id`, `research_run.triggered_by`,
`research_finding.reviewed_by`, `scan_job.created_by`, `gap_verdict.decided_by`,
`cover_watch.raised_by`/`resolved_by`, `series_gap_skip.decided_by`,
`audiobook_series_link.confirmed_by`, `change_log.changed_by`,
`app_user.approved_by` (self), plus 0008's rebuild. Games carries five more of
the same shape. The audit log's *actor* is one of them: delete a user row and
`change_log` loses who did things.

**Therefore "moving users onto global auth" is a mapping exercise, never a row
migration.** Local `app_user` rows survive untouched as the anchor their FKs
need; the global layer joins to them by email. Any design that replaces or
renumbers them is wrong before it starts.

### 1.4 Email is already the join key everywhere

- library `app_user.email` — `NOT NULL UNIQUE`, lowercased on write (measured,
  `users.ts:82`)
- games `app_user.email` — same
- audiobook — stores `ab_identity_email` in localStorage; its `isAdmin()` keys
  on email *deliberately*, because display names change
- both verifiers **refuse unverified emails** — Firebase happily mints tokens
  for unverified addresses, and both `auth.ts` files reject them because email
  is the join key ("the difference between 'cannot sign in' and 'signed in as
  somebody else'")

Nothing needs renumbering. `firebase_uid` is recorded where available but
nothing joins on it (the audiobook side has no uid to join to — it signs out
before one is kept), which is the recorded stance in
`identity-and-reviews.md` §2 and is kept here.

### 1.5 The audiobook "users", precisely — because requirement 3 needs the real list

Measured population (from `identity-and-reviews.md` §7.5, live Firestore reads
2026-08-11, plus `identity.js` and `firestore.rules` read 2026-08-13):

| Population | Count | Has an email anywhere? | Can move to global auth? |
|---|---|---|---|
| Signed into the **library** with Google (Skylar, Amber Mitchell) | 2 | ✅ in library `app_user` | ✅ trivially — they are already on the shared Firebase project |
| Review authors never signed in anywhere (Samantha Hardman, Jamie Jeremiah Lievertz, Sparkling Ember, Solomon Hardman) | 4 (457 reviews) | ❌ — the audiobook site writes **no email on reviews** and keeps identity only in that person's own browser | ⚠️ **Not by us.** They enter the directory the first time they sign in with Google anywhere on the estate, landing `pending`. Their reviews keep rendering regardless — attribution is by display name and does not depend on auth |
| Legacy passphrase accounts in Firestore `/users` | 3 docs (`!sky`, `divaelf`, `test`), **frozen** — update/delete refused since the takeover hardening | ❌ no email at all | ❌ — already settled in `identity-and-reviews.md` §2: "migrating them means asking those people to sign in with Google once, which is a conversation, not a code change" |

So requirement 3, honestly stated: **seed the global directory from the two D1
`app_user` tables (union by email, both already Google-verified) plus the
audiobook `ADMIN_EMAILS` list; everyone else is met at the door** — first
Google sign-in anywhere creates their `pending` row for an approver to act on.
There is no user store to migrate that contains more than that; the rest of the
audiobook's "users" are browser-local strings and review bylines.

---

## 2. Threat model — who this defends against, and who it does not

A household catalog is not a bank. Saying so prevents both over-building and
false comfort.

### 2.1 Defended against

| Adversary / event | Defence |
|---|---|
| **A stranger who finds a hostname** (URLs leak: shared links, browser history, referrer headers) | Every Worker route behind blanket `requireAuth`; no token → 401 before any handler runs |
| **A stranger with a Google account** — anyone on Earth can *authenticate*; approval is the actual gate | Lands `pending` estate-wide, sees a request screen, never data. Requirement 4 |
| **An ex-guest** (revoked household member, ended friendship) | Estate revocation propagates to every app within the cache TTL (§5.3) without touching any app's code |
| **Token forgery / tampering** | RS256 signature against Google's JWKS; expiry enforced by `jose` |
| **Cross-project token confusion** — any Firebase project's tokens are validly Google-signed | `iss` AND `aud` pinned to `audiobook-catalog` in every verifier; a token from any other project fails closed. Removing either pin "is not a smaller check — it is no check" (games `auth.ts:44`) |
| **Unverified-email takeover of the join key** | `email_verified === false` refused in every verifier |
| **A new site shipped half-configured** | Layered design: a site missing its estate integration degrades to *local-only approval* (today's posture), never to open; §8's contract makes deny-by-default a conformance probe, not a hope |
| **Probing the directory** ("is alice@… a member?") | The status endpoint requires a per-app bearer token; anonymous callers learn nothing |

### 2.2 Explicitly NOT defended against

| Out of scope | Why, and what covers it instead |
|---|---|
| **Compromise of a member's Google account** | Google's 2FA is the control. Our response is estate revocation + Firebase console user-disable, not prevention |
| **The Cloudflare or Firebase account owner** | Whoever holds those consoles owns the substrate — D1 is editable, rules are deployable. There is no defending an estate against its own foundation, and pretending otherwise is false comfort |
| ⚠️ **The audiobook site's open Firestore writes** | `PLATFORM.md` §4a is a **recorded owner decision**: `reviews` rules stay shape-only because the `work_key` carry ceremony depends on it. **Nothing in this design changes that, and login-gating search must not be mistaken for fixing it.** Any signed-in-to-nothing visitor can still merge fields onto review documents. Reopening that is §4a's trade-off (a server-side carry behind a service account this estate refuses to hold), not this design's |
| **Privacy of audiobook *titles*** | The audiobook site is world-readable by long-standing decision (~1,073 titles). Gating global search protects the **cross-catalog aggregation** and the library/games titles — it cannot protect what another public page already shows |
| **DoS / volumetric abuse** | Cloudflare's layer. Rate limiting on unauthenticated surfaces (games already has `rate-limit.ts`; `PLATFORM.md` §4.1 requires it estate-wide) bounds the cheap-junk problem |
| **A determined, targeted attacker** | The estate's secrets protect a book list. Proportionality is a design input: the expensive failure here is a *locked-out household* or a *silently open door*, not industrial espionage |

The two failures this design treats as most expensive, in order:
1. **Failing open** — a route or site reachable without approval.
2. **Locking the household out** — the auth layer down taking every catalog
   with it.

Every choice in §5 and §6 is stated with its direction against these two.

---

## 3. The design in one paragraph

Three layers, each answering one question, each living where that question's
facts live. **Identity** — *who are you?* — is a Firebase ID token from the
shared `audiobook-catalog` project, verified **locally** in every app against
Google's JWKS (already built in two apps; zero change to how it works).
**Membership** — *are you approved into the estate?* — is one row in a new,
tiny **auth Worker + its own D1** (`auth.heygabi.ai`), consulted after token
verification and cached per-app with a deliberate TTL. **Authorization** —
*what may you do here?* — stays exactly where it is: each app's own `app_user`
row and capability matrix, untouched, keeping all 17 foreign keys and both
role vocabularies intact. A new site inherits auth by taking the canonical
verifier, pointing at the same three answers, and passing a conformance
checklist — §8.

```
            ┌────────────────────────────────────────────────────┐
            │  IDENTITY — Firebase project "audiobook-catalog"    │
            │  Google sign-in → ID token (RS256, 1h)              │
            └───────────────┬────────────────────────────────────┘
                            │  verified LOCALLY (JWKS) in every consumer
      ┌─────────────────────┼──────────────────────┬──────────────────┐
      ▼                     ▼                      ▼                  ▼
 library Worker        games Worker          index Worker        (site N…)
 app_user: roles       app_user: roles       search: approved    local table:
 reader|manager|…      rater|viewer|…        members only        its own roles
      │                     │                      │                  │
      └───────────┬─────────┴──────────┬───────────┘                  │
                  ▼                    ▼                              ▼
            ┌────────────────────────────────────────────────────┐
            │  MEMBERSHIP — auth Worker + estate_auth D1          │
            │  pending | approved | revoked   (status, not role)  │
            │  POST /api/estate/seen  → cached per app, TTL 10min │
            └────────────────────────────────────────────────────┘
```

The estate answers **in or out**. The apps answer **what, here**. That split is
what makes the diverged role vocabularies a non-problem, the 17 FKs a
non-problem, and a new site a checklist instead of a negotiation.

### 3.1 The one sentence that defines the semantics

> **The estate gates newcomers and enforces revocations; it never overrules a
> standing local approval except by explicit revocation.**

Concretely, after an app has verified a token and loaded/created its local
`app_user` row, the estate status combines with the local role like this:

| Estate says | Local row says | Result |
|---|---|---|
| `revoked` | anything, even `owner` | **403, always.** Computed, not stored — the local role is left intact so a later re-approval restores the person exactly as they were |
| `approved` | active role (`reader`, `manager`, …) | Proceed; local capabilities govern, as today |
| `approved` | `pending`, **never locally decided** (`approved_at IS NULL`) | **Auto-grant the app's configured default role** (§5.4) — this is what makes one approval estate-wide |
| `approved` | `pending`, locally *demoted* (`approved_at` stamped) | Stays pending. A local owner's explicit demotion is a standing decision; the estate does not overrule it |
| `pending` | active role | **Proceed — local wins.** This combination means the seed missed someone (§9 step 2) or an app admitted someone locally; either way a household member with a standing approval must not be locked out by directory lag. The `/seen` call has already surfaced them in the estate queue for an approver to regularise |
| `pending` | `pending` | Request screen, as today |
| unreachable (no fresh cache) | active role | **Proceed on the stale cache / local approval** — availability for the household (§6 row 1) |
| unreachable (no fresh cache) | `pending` / unknown | **Refused, fail closed**, with a named error so an outage is distinguishable from a denial |

Every row of that table fails in the direction §2.2 chose: closed for
strangers and the revoked, open for the already-admitted household.

---

## 4. The estate directory — the auth Worker and its D1

### 4.1 Why a dedicated Worker with its own D1 — and why not the alternatives

| Alternative considered | Why rejected |
|---|---|
| **Firestore** (`/users` or a new collection) | The estate deliberately holds **no Firestore service account in any Worker** — `identity-and-reviews.md` §3 calls putting "the most powerful credential in the household behind the least important endpoint" a bad trade, and `PLATFORM.md` §4a leans on that refusal. A Worker-readable directory in Firestore requires exactly that credential. Also: the audiobook `/users` collection is three frozen passphrase docs, not a user store |
| **Inside the index Worker** | Identity inside "what do I own"'s blast radius — against the separate-blast-radius rule the index design itself used (`DESIGN.md` §3, quoted in `index-worker-design.md` §7). Sharper: the index D1's write protocol is **snapshot DELETE+insert by design**. Putting the one table that must never be bulk-deleted next to a table whose whole protocol is bulk deletion is asking one bug to be catastrophic |
| **One app's `app_user` as canonical** (e.g. the library's) | Couples every app — and every future site — to the library's schema, deploys and outages. "New sites inherit auth" degenerates to "new sites depend on the library app". Also circular: the library would consult itself |
| **No service at all** — keep per-app approval, ship only the §8 contract | The honest fallback, and it satisfies requirement 5 alone. But it fails requirements 2 and 4's spirit: every person queues per app forever, and revocation stays a manual sweep of N People pages that will one day miss one. Named here so the owner can choose it deliberately if the service feels heavy — §13 Q7 |

So: `catalog-platform/apps/auth-worker/`, sibling of `apps/index-worker/`, own
`wrangler.toml`, own D1 (`estate_auth`), custom domain `auth.heygabi.ai`. Small
on purpose — one table, four routes, and the same vendored verifier every other
consumer uses.

### 4.2 Schema

```sql
-- One row per person the estate has ever seen. Rows are never deleted:
-- a revoked person who re-signs-in must meet their revocation, not a fresh
-- 'pending' row that an approver might wave through by mistake. (Same
-- reasoning as change_log keeping no FK on entity_id: accountability
-- survives the object.)
CREATE TABLE estate_user (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,        -- lowercased on write; THE join key (§1.4)
  firebase_uid   TEXT    UNIQUE,                 -- recorded when seen; nothing joins on it (§1.4)
  display_name   TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','revoked')),
  -- Approvers manage the guest list. Deliberately a flag, not a role
  -- vocabulary: the estate answers in/out, apps answer what/here (§3).
  is_approver    INTEGER NOT NULL DEFAULT 0,
  -- Where this row came from: 'seed:library' | 'seed:games' | 'seed:admin'
  -- | 'seen:library' | 'seen:games' | 'seen:index' | 'manual'.
  -- The honesty column, house style (decided_how / changed_how / read_state_how).
  origin         TEXT    NOT NULL,
  note           TEXT,
  first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at     TEXT,
  decided_by     INTEGER REFERENCES estate_user(id) ON DELETE SET NULL
);
```

**Status is a three-value fact, not a role.** `revoked` is distinct from
deletion (rows are never deleted) and distinct from `pending` (a revoked
person re-appearing must not look like a newcomer).

*Amended 2026-08-13:* migration `0002_visibility.sql` adds three flag columns
(`vis_audiobook`, `vis_library`, `vis_games` — INTEGER 0|1, DEFAULT 1) — the
per-member **visibility set**, §4.5. The encoding argument lives in the
migration header.

### 4.3 ⚠️ No first-sign-in-claims bootstrap — deliberately unlike the apps

The apps' "empty table → first sign-in becomes owner" rule is correct for a
fresh app whose URL nobody has. It is **wrong for the directory that gates the
whole estate**: the deploy-to-seed window would mean *first to knock owns
everything*. The auth Worker has exactly one bootstrap path: **`OWNER_EMAILS`**
(same env-var pattern as both apps, same value today —
`nbaslamking@gmail.com`). An email on that list is treated as
`approved` + `is_approver` regardless of table state. The seed (§9 step 2)
runs before anything consumes the directory, so the empty-table case never
carries traffic; if it somehow did, everyone lands `pending` and the
`OWNER_EMAILS` holder lets them in. The way in does not depend on the thing
being changed — recommendation 4, extended to the auth service itself.

### 4.4 API

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/estate/seen` | **Per-app bearer token** (`ESTATE_APP_TOKEN_LIBRARY` / `_GAMES` / `_INDEX` — Worker secrets, one per consumer, the index-push pattern reused) | Body `{email, firebase_uid?, display_name?}`. Upserts: unknown email → create `pending` with `origin='seen:<app>'`; known → refresh uid/name only. **Never changes `status`.** Returns `{status, visibility}` (§4.5). One endpoint does both jobs: answer the check *and* put newcomers in the queue |
| `GET /api/estate/users` · `POST /api/estate/users/:id/status` · `POST /api/estate/users/:id/visibility` | **Firebase ID token of an approver** — the auth Worker verifies tokens with the same vendored middleware as everyone else (it eats its own dog food), then requires `is_approver` or `OWNER_EMAILS` | The admin surface: list (pending first), approve / revoke / grant-approver / set visibility (§4.5). Every decision stamps `decided_at`/`decided_by` |
| `GET /api/health` | none | Row counts by status, no emails. Same stance as the index's health route |
| `/` | — | A minimal static admin page (list + approve/revoke buttons), served by the Worker, sign-in via the shared Firebase project. Requires `auth.heygabi.ai` in Firebase authorised domains — an owner console step, §9 step 2 |

**Why the check carries a per-app bearer and not the user's token:** the app
has *already verified* the token locally — re-verification centrally adds
coupling, latency and nothing else; forwarding live user tokens to a second
service widens where tokens travel for no gain; and an unauthenticated check
endpoint would let anyone probe membership by email and spray `pending` rows.
Cost, named: a leaked app token can probe status and create pending spam —
bounded, revocable by rotating one secret, and visible in the queue.

Rate limiting on the unauthenticated surface (`/api/health`, bad-token
attempts): port the games `rate-limit.ts` middleware. `PLATFORM.md` §4.1
already requires this posture wherever the Worker is the only gate.

### 4.5 Visibility — which catalogs a member may SEE (added 2026-08-13)

The owner's feature, their words: *"as a user is granted permission to other
sites the search bar populates more things from those catalogs… assigning
people roles and which catalogs they can see."*

Each directory row carries a **visibility set** — a subset of
`{audiobook, library, games}` naming the catalogs this person may **see** on
the estate's own surfaces (today: index search scope; later, a federated
admin view). ⚠️ **This must NOT become a role system — each app still owns
what a person may DO there (§1.2/§1.3 stand).** The estate now answers *in or
out* and *which shelves are in the room*; what a person may do at any shelf
stays app-local forever.

**Encoding** (`0002_visibility.sql`): three flag columns
(`vis_audiobook`/`vis_library`/`vis_games`, INTEGER 0|1, DEFAULT 1), not a
CSV/JSON set column — argued in the migration header: a new catalog is one
ADD COLUMN, where a set column's CHECK would cost the full table rebuild
SQLite CHECKs always cost (the 0008/0023/0024 lesson); and SQLite has no set
type, so a TEXT set invites canonicalization bugs no expressible CHECK can
forbid.

**Defaults**: every already-approved member holds all three (ADD COLUMN's
DEFAULT 1 backfills, and the seed re-asserts it explicitly) — the current
household expectation; nothing changes for them. New approvals grant all
three unless the approver narrows, at approval time or after.

**The `/seen` response — the consumer contract:**

```json
{ "status": "pending" | "approved" | "revoked",
  "visibility": ["audiobook", "library", "games"] }
```

`visibility` is the **EFFECTIVE** set, already combined with status — a
consumer applies it as-is and never recomputes it from `status`:

| Caller | Effective visibility |
|---|---|
| `approved` | the STORED set — all three unless narrowed; an approver may narrow to `{}` (the estate's surfaces then show nothing, mirroring the revoked rule) |
| `pending` | `{audiobook}` — a pending member sees what the anonymous internet sees, nothing more |
| `revoked` | `{}` — **revocation beats the public slice** on the estate's own surfaces |
| `OWNER_EMAILS` | all three, computed not stored (§4.3 — break-glass must not be narrowable into lockout) |

Array order is canonical (`audiobook, library, games`), never duplicated.
`status` keeps its exact prior meaning; the field is **additive** — a
consumer that reads only `status` (today's `postSeen` client) is untouched.

**The anonymous rule — stated here for the index to implement, because an
absent token means no `/seen` call ever happens:** an ABSENT or invalid
Firebase token ⇒ visibility = `{audiobook}` — the world-readable catalog per
the estate's recorded posture (the audiobook surface declares
`public: true`). The index's read scope is therefore:

- no token / invalid token → serve the `audiobook` slice only
- valid token → `/seen` (per §5.2's cache); scope = the answer's
  `visibility` array, verbatim — including `{}` for the revoked
- estate unreachable → a cached answer's visibility rides with its cached
  status; with no cache, treat the caller as anonymous (`{audiobook}`) —
  fail closed to the public slice, never open (§6 row 1's shape)

A consumer that caches `/seen` (the §5.2 columns, the index's
`estate_cache`) caches the visibility **with** the status — the two are one
answer and must not age separately.

**Admin API** (owner-gated like the rest, §4.4; `is_approver` and the status
flows untouched):

- `GET /api/estate/users` — each user carries `visibility` (the STORED set;
  for a `pending` row this shows what approval would grant). The raw `vis_`
  flags never appear in JSON; the array is the one representation.
- `POST /api/estate/users/:id/status` body
  `{"status": "approved", "visibility": ["audiobook", ...]}` — approval-time
  narrowing, optional. `visibility` alongside `"revoked"` is refused 400: a
  revoked person sees `{}` regardless, and a stored narrow set on a
  revocation would only mislead a later re-approval.
- `POST /api/estate/users/:id/visibility` body
  `{"visibility": ["audiobook", ...]}` — narrow or re-widen after approval;
  stamps `decided_at`/`decided_by` like every decision. `[]` is legal.

---

## 5. The check protocol — verify locally, ask centrally, cache deliberately

### 5.1 What does NOT change

Token verification stays **local and per-app**, exactly as both `auth.ts`
files do it today: JWKS fetch (cached per isolate, rotation handled by
`jose`), `iss`+`aud` pinned, unverified emails refused. **No request to any
app waits on the auth Worker for identity.** This is recommendation 3, and it
is the property that keeps the auth Worker off the whole-estate critical path:
if it vanishes, every app still knows *who* everyone is and (from cache +
local roles) *what standing members may do*.

### 5.2 What is added

One step inside `requireAuth`, after the existing local `upsertUserOnLogin`:

```
if (user.estate_checked_at is NULL or older than TTL):
    resp = POST auth.heygabi.ai/api/estate/seen   (app bearer, {email, uid, name})
    on success: store estate_status + estate_checked_at on the app_user row
    on failure: keep the stale values; count the failure (log line)
apply the §3.1 combination table
```

Each app adds **two nullable columns** to `app_user` — `estate_status TEXT`,
`estate_checked_at TEXT` — an additive migration with no rebuild (both repos'
CHECK-constraint rebuilds in 0008/0023/0024 were needed because CHECKs can't
be altered; plain ADD COLUMN carries no such cost). The cache living **in the
app's own D1** rather than memory or KV matters: Workers isolates recycle
constantly, an in-memory cache would re-call on every cold start, and a KV
namespace is a new moving part per app. The row is already loaded on every
request — the cache rides for free.

The index Worker has no `app_user`; it gets an `estate_cache(email,
firebase_uid, status, checked_at)` table. ⚠️ *Built 2026-08-13 as an ADDITIVE
migration `0002`, not the fold-into-0001 this paragraph originally proposed —
the index's 0001 had been applied remotely by the time §14.3 was built
(re-verified live that day). An applied migration is never edited.*

### 5.3 ⚠️ The TTL is the revocation delay — chosen out loud

**Proposed: 10 minutes.** The trade, stated rather than buried:

- Smaller TTL → faster revocation, more subrequests (1 per user per app per
  TTL — at household scale, single-digit calls per 10 minutes across the whole
  estate; negligible either way).
- Larger TTL → longer window in which a just-revoked person can keep using
  apps they had recently touched.

10 minutes bounds an ex-guest's residual access to shorter than the Firebase
token's own 1-hour lifetime, at a request cost that rounds to zero. During an
**auth-Worker outage** the delay becomes unbounded *for people approved before
the outage* — that is §6 row 1's deliberate availability choice. Two instant
kill paths exist independently of the TTL and should be written into the
runbook: an app owner demotes the person locally (immediate, per app, works
today), and the Firebase console disables the Google account (stops token
refresh; existing tokens die within the hour).

### 5.4 The default-grant — what makes one approval "app-wide"

When the estate says `approved` and the local row is `pending` with
`approved_at IS NULL` (never locally decided), the app assigns its configured
default role and stamps `approved_at` with a recognisable actor convention
(`approved_by NULL` + the estate origin noted — apps that have `change_log`
write an audit row, `changed_how='auto'`):

| App | Proposed default | Why this one |
|---|---|---|
| library | `reader` | Its designed guest role: read + own read-state + rate |
| games | `viewer` | The *smaller* of its two guest roles, deliberately — rating rights stay a local, per-person upgrade, preserving exactly the distinction migrations 0023/0024 built |

⚠️ **This flattens a privacy boundary that technically exists today** — a
person approved only into games could not previously see the library's
locations, prices and `lent_to`. In practice both guest lists are the same
household, but the flattening is real and is the owner's to confirm — §13 Q2.
If declined, the estate still delivers requirements 1, 3, 4 and 5; requirement
2 weakens to "one sign-in, per-app admission" (today's posture with a shared
queue view).

---

## 6. Failure modes — each with the chosen behaviour and its direction

The table the brief demanded. "Direction" is against §2.2's two expensive
failures: never open to strangers; never a locked-out household.

| # | Failure | Chosen behaviour | Direction |
|---|---|---|---|
| 1 | **Auth Worker down / unreachable** | Apps verify tokens locally as always. Standing members (fresh-or-stale `approved` cache, or an active local role) **keep working**. Unknown or `pending` people are **refused** with a named `estate_unreachable` detail so an outage never reads as a denial. Approvals pause until it returns. The failure is *loud in logs, invisible to the household* | Open for the admitted, closed for everyone else. The auth Worker is a SPOF for *admitting*, never for *using* |
| 2 | **Token valid, approval unknown** (never seen before) | `/seen` creates `pending`; request screen. If `/seen` itself fails, refused | Closed |
| 3 | **Revoked mid-session** | Next request after the holder's cache expires → 403, ≤ 10 minutes (§5.3). Local role untouched (§3.1). Instant paths: local demotion; Firebase account disable | Closed within TTL |
| 4 | **Owner locked out** (bad deploy of the auth Worker, corrupted directory, self-revocation mishap) | Three independent ways back, none passing through the broken thing: (a) `OWNER_EMAILS` in **every** app *and* the auth Worker — §3.1's local-wins rows mean the apps keep serving their owner on local roles alone; (b) the Cloudflare dashboard's D1 console edits `estate_user` directly; (c) `*.workers.dev` hostnames stay bound as the domain-independent route (existing estate practice) | Recovery never depends on the thing being recovered |
| 5 | **A new site misconfigured** | Layering bounds the damage: skipping the estate call entirely degrades to local-only approval (today's posture — closed); the genuinely dangerous miss is **no blanket `requireAuth`**, which is why §8 makes "blanket middleware before any route" a conformance *probe* (curl six routes tokenless, expect six 401s) rather than a sentence in a doc | The only failing-open path is the one the checklist exists to catch; it is testable in one minute |
| 6 | **Estate D1 lost or corrupted** | Apps continue on caches + local roles (degraded = per-app posture). The directory is **reconstructible by re-running the seed** (§9 step 2 is idempotent and its inputs — the two `app_user` tables — still exist). Deliberate property: the directory holds no fact that lives nowhere else, *except* revocations and approver flags — after a rebuild, re-check those two by hand against the short list of humans involved | Closed for new, open for standing; recoverable by design |
| 7 | **Apex CSP or Firebase misconfig breaks search sign-in** | Search visibly broken; the page (a static signpost) is untouched. Nothing else on the estate shares the apex's sign-in | Closed, contained |
| 8 | **The shared Firebase project itself breaks** (deleted authorised domain, quota, config) | The whole estate's sign-in dies at once. This concentration **already exists today** (both Workers + audiobook sign-in pin the same project) and is accepted — it is the price of "one account everywhere" chosen on 2026-08-09. Mitigations: existing tokens live ≤ 1h; authorised-domain edits are console-only (owner); `*.workers.dev` entries stay on the authorised list as the escape hatch (existing practice, `HEYGABI_LAYOUT.md` Track A) | Closed. Named SPOF, inherited not introduced |

---

## 7. Global search — requirement 1, and the apex decision it forces

### 7.1 The shape

The search lives where the landing page already reserved it —
`<section id="find">` in `sites/heygabi-home/public/index.html`, whose own
comment says the slot is for exactly this (*"drop a search input and results
list … `connect-src https://index.heygabi.ai` added to `_headers`"*). It calls
the **index Worker's read surface**, which gains auth:

- `GET /api/lookup` and `GET /api/universe/:name` require a verified Firebase
  ID token (same vendored middleware) **and** estate `approved` (via `/seen`
  + the §5.2 cache). `GET /api/health` stays open; the push routes keep their
  per-source bearer tokens unchanged.
- **This closes `index-worker-design.md` §9 Q3** — the question the index
  deploy is gated on. Answer: reads are estate-members-only, because the
  lookup surface aggregates titles across all three catalogs including the two
  private ones. The index Worker becomes consumer #3 of the auth contract, and
  deliberately the *first* to adopt it (§9 step 3) — it has zero existing
  users, so the protocol is proven where nobody can be locked out.
- *Amended when §4.5 landed:* **`GET /api/search` is the one carve-out from
  members-only** — it answers every caller, scoped by the effective
  **visibility set** per §4.5's anonymous rule: absent/invalid token ⇒
  `{audiobook}` (the world-readable slice), member ⇒ their `/seen` visibility
  verbatim, `pending` ⇒ `{audiobook}`, `revoked` ⇒ `{}` — never a 401 on
  search. The members-only rationale survives intact: the private catalogs
  are precisely what an out-of-scope caller's results never contain, because
  the scope is applied in the SQL before ranking. Lookup stays members-only
  untouched; universe stays members-only and scoped.

The page itself stays fully public and readable signed-out; since §4.5 the
search slot WORKS signed-out — it live-searches the public audiobook slice
tokenless, with a quiet "sign in to search everything" affordance rather than
a wall. Signed-in but `pending` searches the same public slice (§4.5's
pending rule); the request-screen wording appears only where a members-only
surface (the universe view) actually refuses.

### 7.2 ⚠️ This deliberately overturns a standing rule, and here is the arguing

`heygabi-home/public/index.html:13` says, in capitals: **"NO AUTHENTICATION ON
THIS HOST. EVER. DO NOT ADD A SIGN-IN BUTTON."** A design that silently
contradicts a warning that loud is how estates rot, so, explicitly:

- **The rule's concrete argument no longer applies to this host.** Its cited
  reason is `identity.js`'s `signOut()`-on-load — one page signing the user
  out from under another. That is lethal when two apps share **one origin**
  (the finding that settled subdomains-vs-paths in `DOMAIN_AND_HOSTING.md`
  §1.2). But Firebase web auth state is **origin-scoped** (IndexedDB /
  localStorage per origin): a sign-in on `heygabi.ai` and the capture-detach
  dance on `audiobooks.heygabi.ai` cannot see each other's sessions. The
  hazard the rule guards is real and stays guarded — it just is not *this*
  configuration. (§15 lists the origin-scoping claim as verify-during-build:
  one attended cross-tab test before ship.)
- **The rule's residual cost survives and is paid knowingly:** the apex
  becomes a Firebase **authorised domain** — one more permanent OAuth redirect
  surface. `HEYGABI_LAYOUT.md` §1 priced this in from the start ("✅ yes — if
  anything there signs in"). The owner's requirement 1 is the thing that
  finally spends it.
- **Alternative rejected:** a separate `search.heygabi.ai` host to keep the
  apex clean. Rejected because the owner asked for search *on the front door*;
  a second host is one more name, one more authorised domain, and one more CSP
  — strictly more surface to protect the apex from a hazard §7.2 just showed
  does not apply.
- **What does NOT change on the apex:** no session for browsing, no
  personalisation, no "my ratings", no gating of the page. The Firebase SDK
  loads for one purpose — minting a token to send to `index.heygabi.ai`. The
  in-file warning gets rewritten (not deleted) to say precisely this, so the
  next session inherits the new rule with its reasoning, the way it inherited
  the old one.

Mechanical consequences for the build (§14): `_headers` CSP widens
`connect-src` to `https://index.heygabi.ai https://identitytoolkit.googleapis.com
https://securetoken.googleapis.com` and `script-src`/frame allowances for the
Firebase SDK + Google sign-in; the owner adds `heygabi.ai` (and `www` if kept)
to Firebase authorised domains — console-only, 🔴 owner step.

---

## 8. What a new site must do to inherit auth — the contract

Requirement 5, as an actual checklist. A "site" here means anything with a
server component (a Worker). Static-only pages inherit nothing and need
nothing — they have no data to protect (the apex pattern).

### 8.1 The canonical verifier — one implementation, not three copies

§1.1's drift is the argument. The fix is the estate's established mechanism
for exactly this problem, applied to its most important file:

- **`catalog-platform` owns the canonical `estate-auth` module** — the token
  verifier (JWKS, iss+aud pin, unverified-email refusal, `ENVIRONMENT ===
  'development'` dev bypass **in the games-hardened form**) plus the §3.1
  combination logic and the `/seen` client with its TTL cache.
- Consumers take it the way the library already takes `universes`: fetched at
  build from the sibling checkout (`CATALOG_PLATFORM_DIR` override, loud
  failure when missing) — the repo has been a code dependency since 2026-08-11
  (`PLATFORM.md` §5.4), and the user's own global rule says *prefer shared
  canonical modules over synced copies*. Where that mechanism is genuinely
  unavailable, a vendored copy is tolerable **only** with a pinned-version
  header and the conformance probes below in that repo's CI — the
  fixture-file discipline (`PLATFORM.md` §5.3) applied to behaviour.
- ⚠️ Migration note: adopting the canonical module in the library **replaces**
  its `!== 'production'` bypass with the hardened form — closing §1.1's drift
  as a side effect of adoption rather than a separate errand.

### 8.2 The checklist

| # | Requirement | Verified by |
|---|---|---|
| 1 | Serve on a `*.heygabi.ai` host; add it to **Firebase authorised domains** only if the sign-in popup runs on that host (redirect-only and asset hosts: never — `HEYGABI_LAYOUT.md` §1.3) | 🔴 owner console; `auth/unauthorized-domain` on first sign-in if missed |
| 2 | Verify Firebase ID tokens **locally** with the canonical module; `FIREBASE_PROJECT_ID = "audiobook-catalog"` pinned as iss **and** aud; refuse unverified emails | Probe: token from another project → 401; unverified-email token → 401 |
| 3 | **Blanket `app.use('/api/*', requireAuth())` before any route is mounted**; every data route additionally behind a capability gate; machine routes (ingest, push) with their own bearer tokens are mounted before it *by name, with a comment* — the library's ingest route is the precedent | Probe: curl every route tokenless → all 401 except named machine routes and `/api/health` |
| 4 | A local user table keyed on **lowercased email**, role vocabulary of the app's own choosing, `DEFAULT 'pending'`, and **`pending` maps to zero capabilities** | Probe: fresh sign-in → 403 on every capability route, request screen in the UI |
| 5 | Call `POST /api/estate/seen` per §5.2 (own `ESTATE_APP_TOKEN_*` secret, TTL cache columns) and apply the §3.1 table — including fail-closed for non-standing users when the estate is unreachable | Probe: revoked test user → 403 within TTL; auth Worker stopped → standing user still served, fresh user refused with `estate_unreachable` |
| 6 | `OWNER_EMAILS` break-glass set; first-sign-in-claims-owner only if the app's own table can start empty | Probe: listed email lands as owner |
| 7 | Rate limiting on the unauthenticated surface | games `rate-limit.ts` ported |
| 8 | The dev bypass is `ENVIRONMENT === 'development'` + `DEV_EMAIL`, and production `wrangler.toml` sets `ENVIRONMENT = "production"` explicitly | Read the toml; probe the deployed host with no token → 401 |

Items 2–5 come free with the canonical module; the checklist exists so that a
site which *cannot* take the module still has the contract, and so the probes
are written down as commands rather than intentions. **The probes are the
deliverable** — §6 row 5's failing-open site is caught by running them, and
they take about a minute per site.

### 8.3 What inheriting does NOT require

No shared session store, no cookies, no redirect dance through a central
login page, no schema beyond two cache columns, no role vocabulary imposed, no
central call on the hot path. A new site's auth cost is: one module, one
secret, two columns, one console entry, eight probes.

---

## 9. The migration — step by step, reversible at every step

Ordering principle: **prove the protocol where nobody can be locked out, then
adopt where approval already works, then everywhere else.** Every step leaves
the estate in a working state if the work halts there; "halt state" says what
is true if it does.

| # | Step | Reversal | Halt state |
|---|---|---|---|
| 0 | Owner answers §13's open questions; this doc approved | — | Nothing changed |
| 1 | Build `apps/auth-worker/` (Worker + migration + admin page + tests) locally. No deploy | Delete the directory | Nothing deployed; design proven in local D1 |
| 2 | Create the `estate_auth` D1, apply its migration, deploy `auth.heygabi.ai`, 🔴 owner adds `auth.heygabi.ai` to Firebase authorised domains. **Seed**: dry-run first, printing every row it would write (the review-key backfill's lesson: *read the rows, not the counts*), then commit. Sources: library `app_user` (active roles → `approved`, origin `seed:library`), games `app_user` (likewise), audiobook `ADMIN_EMAILS` (→ `approved`+`is_approver`), `OWNER_EMAILS` (→ `approved`+`is_approver`). Union by lowercased email; local `pending` rows seed as `pending` | Delete Worker + D1. **Zero consumers exist** — this step is pure addition | Directory live and populated; estate unchanged in behaviour. The seed is idempotent and re-runnable (§6 row 6 depends on this) |
| 3 | **Index Worker adopts first**: fold `estate_cache` + read-auth into its still-unapplied migration, wire the vendored verifier + `/seen`, set `ESTATE_APP_TOKEN_INDEX`. Deploy index (running its own pending owner-gated migration + push-token setup from `index-worker-design.md`) and exercise: approved member token → results; fresh Google account → pending screen; no token → 401 | `wrangler delete` the index Worker — it has no users and its catalogs' pushers tolerate its absence by design | The auth contract proven end-to-end on a consumer with **zero existing users**. Search API exists; no UI yet |
| 4 | Apex search UI: search box + results in `#find`, Firebase sign-in scoped to it, CSP widened, the §7.2 warning rewritten. 🔴 owner adds `heygabi.ai` to authorised domains | Revert two static files (the site is two HTML files; `deploy.md` §4 is one command) | Requirement 1 delivered. Apps still on per-app approval — nothing about them has changed |
| 5 | **Library adopts** (smallest diff among the apps — approval/pending already work): additive migration for the two cache columns; canonical module replaces local `auth.ts` (closing the §1.1 bypass drift); `ESTATE_CHECK` env var — `off` → `shadow` → `enforce`. **`shadow` calls `/seen` and logs the §3.1 verdict but never refuses**; run it for a few days and read the logs for would-have-refused lines — a seed gap surfaces as a log line instead of a locked-out household member | Set `ESTATE_CHECK=off` (one redeploy); the columns are inert when unread | Library on estate auth. Games still per-app — the layers make mixed adoption a working state, not a broken one |
| 6 | **Games adopts**: same shape, same flag, same shadow-first | Same | Requirement 2 delivered for every Worker app |
| 7 | Audiobook-side linking, which per §1.5 is mostly already done by the seed. Optional extras, each independent: re-run the seed after new sign-ups; note in the audiobook admin page that people-management moved to `auth.heygabi.ai` | — | **The audiobook site itself never changes** (§10). Requirement 3 delivered in its honest form |
| 8 | Update `PLATFORM.md` §1 (stale Access row) + §4 (point here); prune per-app People pages' copy to mention the estate queue | Docs revert | Estate coherent on paper as well as in fact |

**If it halts halfway** — the worst cases, named: after 2, an unused directory
idles (cost: one Worker). After 3–4, search works estate-gated while apps
still approve per-app — users see two queues briefly; annoying, not broken.
After 5, the two apps disagree about whether approval is global — §3.1's
local-wins rows mean nobody standing loses access either way; a newcomer might
be approved estate-wide yet still `pending` in games until step 6 — visible,
honest, fixable by an owner tap in games' People page, exactly as today. **No
halt point strands anyone or opens anything.**

---

## 10. What this design deliberately does NOT do

Recorded so nobody reopens them expecting a win:

| Not doing | Why |
|---|---|
| **Unify the role vocabularies** | Lossy for games (§1.2). The estate answers in/out; roles are app-local forever |
| **Move, merge or renumber `app_user` rows** | 17 FKs including both audit logs' actors (§1.3). The rows ARE the authorization layer |
| **Harden the audiobook Firestore rules** (`reviews`, or `request.auth` anywhere) | `PLATFORM.md` §4a is a standing owner decision with a live dependency (the `work_key` carry). This design must not be the back door through which that decision gets un-made |
| **Add real auth to the audiobook site itself** | It is a static, world-readable, pipeline-fed site by decision (`PLATFORM.md` §2.4); its identity is presentation. Gating its *reads* would mean an edge gate or an app rewrite — a separate project with its own design doc if the owner ever wants it (§13 Q1) |
| **A central session, cookie, or login-redirect service** | Firebase already is the session layer. A second one is pure attack surface |
| **Per-request central authorization** | The auth Worker must never be able to take the whole estate down (§5.1, §6 row 1) |
| **A Firestore service account in any Worker** | Standing refusal, load-bearing elsewhere (`identity-and-reviews.md` §3, `PLATFORM.md` §4a) |
| **Second Firebase project, or auth for `covers.` / redirect hosts** | `docs/access/cloudflare.md` §5 and `HEYGABI_LAYOUT.md` §1.3 already settled both |
| **Password / passphrase support** | Google-only, estate-wide. The frozen `/users` docs stay frozen |
| **Approval workflows beyond approve/revoke** (invitations, expiring guests, per-app grants at approval time) | Household scale. Per-app grants at approval time would re-centralise roles through the back door — the exact thing §3 splits apart |

---

## 11. The dispatcher's seven recommendations — verdicts

Asked to argue where wrong; here is where I did and did not.

| # | Recommendation | Verdict |
|---|---|---|
| 1 | Split identity from authorization | **Accepted** — and it is not even new doctrine: both `auth.ts` headers already say "Firebase authenticates; the app authorizes". This design promotes an existing habit to a contract and inserts the one missing layer (membership) between the two |
| 2 | Dedicated auth Worker with its own D1; not Firestore, not the index Worker | **Accepted, with the alternatives argued rather than assumed** (§4.1) — including one the brief did not list: *no service at all*, which is the honest fallback if the owner finds the Worker heavy, and which still satisfies requirement 5 via §8's contract alone |
| 3 | Verify tokens locally; call the service only for approval, cached with a named TTL | **Accepted and sharpened.** The sharpening matters: "call the service for approval" could be read as *estate approval required for everyone, always*, which during a seed gap or an outage locks out the household. §3.1's rule — the estate gates newcomers and revocations, never overrules a standing local approval — plus `shadow` mode in the rollout are the difference between bulletproof and brittle here. TTL proposed 10 min, trade-off in §5.3 |
| 4 | `OWNER_EMAILS` break-glass in every app | **Accepted, extended**: the auth Worker itself carries it, and — deliberately unlike the apps — carries **no** empty-table-first-claim bootstrap (§4.3), because "first to knock owns the estate" is an unacceptable failure for the estate's gate even briefly |
| 5 | Email is the join key | **Accepted; verified** in all four places (§1.4) |
| 6 | Audiobook contributes its user list and adopts approval; not rebuilt | **Accepted with the meaning sharpened by measurement** (§1.5): the "user list" that can move is the two D1 tables plus `ADMIN_EMAILS`. Four review authors have no email on record anywhere and can only be met at the door; three passphrase docs are frozen and stay so. The audiobook *site* neither adopts nor enforces anything — it has no server to enforce with, and its Firestore posture is §4a's settled decision |
| 7 | Adoption order: library first, prove it, then the others | ⚠️ **Rejected as stated.** Library first means proving the protocol on a system with real household users — the exact people a seed gap would lock out. The **index Worker adopts first** (§9 step 3): it has zero users, deployment is already gated on this design, and its migration is conveniently still unapplied so the estate cache costs nothing. Library is then the first *existing* app to adopt — the brief's reasoning (smallest diff, approval already works) holds for that slot — and does it in `shadow` mode before `enforce`. Never all at once, agreed |

On the brief's framing question — whether requirement 5 should drive: **agreed,
and §8 is the evidence.** Designed inheritance-first, the deliverable is a
contract plus the smallest shared state the contract needs. Designed
feature-first, it would have been three bespoke integrations and a promise.

Two things the brief had wrong, corrected by measurement rather than argued:
games is already on Firebase tokens (not Access), and library's roles include
`manager`. Both made the project *smaller* than briefed — §1.

---

## 12. Questions I settled (so they are not reopened as open)

| Question | Settled as | Where |
|---|---|---|
| Firestore vs D1 for the directory | D1; no service account in Workers, standing policy | §4.1 |
| In the index Worker vs its own | Own Worker; blast radius + the snapshot-delete neighbour hazard | §4.1 |
| Central roles vs status-only | Status-only (`pending/approved/revoked` + `is_approver` flag) | §3, §4.2 |
| Token forwarding vs per-app bearer for the check | Per-app bearer | §4.4 |
| Cache location | Two columns on each app's own user row; a small table for the index | §5.2 |
| Estate vs local precedence | The §3.1 sentence and table | §3.1 |
| Revoked = deleted? | Never deleted; revocation must survive re-sign-in | §4.2 |
| Auth Worker bootstrap | `OWNER_EMAILS` only; **no** first-claim rule | §4.3 |
| Index read auth (`index-worker-design.md` §9 Q3) | Estate-members-only | §7.1 |
| Search host | The apex, overturning its no-auth rule with reasons on the record | §7.2 |
| Rollout safety | `off/shadow/enforce` flag per app; index-first order | §9 |

## 13. Open questions — the owner must answer before a build starts

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| 1 | **Does "login becomes app-wide" include gating `audiobooks.heygabi.ai` reads?** Its world-readable posture is long-standing and load-bearing (`PLATFORM.md` §2.4); gating it is a separate, real project (edge gate or rewrite) with §4a implications. This design assumes **no** | Nothing in §9 — but the assumption must be confirmed, not slid past | No — it stays public |
| 2 | **Confirm the default-grant** (§5.4): one estate approval auto-grants library `reader` + games `viewer`. This flattens the (currently theoretical) per-app privacy boundary — locations, prices, `lent_to` become visible to anyone you approve into the estate | §9 step 5 semantics | On, with those two defaults |
| 3 | **TTL = 10 minutes** — the revocation delay. Comfortable? | §5.3 constant | 10 minutes |
| 4 | **Who besides `nbaslamking@gmail.com` is an approver?** (Skylar's account *is* that email; is Amber an approver?) | §9 step 2 seed | Only `OWNER_EMAILS` |
| 5 | **Pre-seed any known emails for the four review-name-only people** (§1.5), or let them arrive as `pending` on first sign-in? Pre-seeding needs you to supply addresses we do not hold | §9 step 2 completeness | Meet them at the door |
| 6 | **Admin surface at `auth.heygabi.ai` acceptable** (one more Firebase authorised domain), or would you rather approve from inside an existing app's People page (couples that app to the directory's admin API)? | §9 steps 1–2 | `auth.heygabi.ai` |
| 7 | **Is the auth Worker itself wanted**, or is §4.1's "no service" fallback (contract only, per-app approval stays) closer to your appetite? Everything else in this doc survives either answer except single-approval and estate-wide revocation | Whether §9 steps 1–3 exist | Build it — requirements 2 and 4 want it |

---

## 14. Build plan — written for a fresh agent with none of this context

Read first: this doc top to bottom; `PLATFORM.md` §2, §4, §4a;
`index-worker-design.md`; both repos' `CLAUDE.md` (⚠️ Windows: `git commit -F`
never `-m`; wrangler leaks dev servers — kill by name). Rules that bind every
step: no migration reaches production unattended; commit before deploy; the
owner runs 🔴 steps.

### 14.1 The auth Worker (§9 steps 1–2)

```
catalog-platform/apps/auth-worker/
  wrangler.toml            # own worker name, own D1 binding (estate_auth),
                           # ENVIRONMENT="production" in [vars], routes: auth.heygabi.ai
  migrations/0001_init.sql # §4.2 DDL, comments carried from this doc
  src/index.ts             # thin: mounts routes (repo rule: entrypoints stay thin)
  src/estate.ts            # /seen upsert (never touches status), admin list/status,
                           # health; every status change stamps decided_at/decided_by
  src/middleware/auth.ts   # the canonical verifier (see 14.2) + is_approver gate
  src/middleware/rate-limit.ts  # ported from Board_Game_Catalog
  admin/                   # one static page: pending-first list, approve/revoke;
                           # Firebase sign-in against project audiobook-catalog
  test/                    # local-D1 probes: §8.2's eight, plus §3.1's table
                           # row by row, plus: /seen never upgrades status;
                           # revoked survives re-sign-in; OWNER_EMAILS works
                           # on an EMPTY table (the §4.3 property)
scripts/seed-estate.mjs    # §9 step 2. Dry-run DEFAULT, prints EVERY row with
                           # origin; --commit writes; idempotent (INSERT OR
                           # IGNORE by email; never downgrades an existing row).
                           # Inputs: both production app_user tables via
                           # wrangler d1 execute --remote (read-only SELECTs),
                           # audiobook ADMIN_EMAILS (site/identity.js:146),
                           # OWNER_EMAILS. Refuse zero-row reads (the d1.mjs
                           # lesson: a zero-row read is a failed read)
```

Secrets: `ESTATE_APP_TOKEN_LIBRARY`, `_GAMES`, `_INDEX` — mint long random
values, `wrangler secret put` on the auth Worker; each consumer gets its own
via its repo's secret store. Never in git, never echoed (`docs/access/` rules).

🔴 Owner: create the D1 (or authorise `wrangler d1 create estate_auth`), run
the migration, add `auth.heygabi.ai` to Firebase authorised domains, approve
the seed's dry-run output before `--commit`.

### 14.2 The canonical module

`catalog-platform/packages/estate-auth/` (or a single-file module beside it —
match the universes packaging): the verifier exactly as games' `auth.ts` has
it (jose, JWKS cached per isolate, iss+aud = `FIREBASE_PROJECT_ID`,
`email_verified === false` refused, dev bypass `ENVIRONMENT === 'development'
&& DEV_EMAIL`), plus `estateCheck(db, user, env)` implementing §5.2 + §3.1,
plus the `/seen` client. Ship with a conformance fixture (the eight probes as
runnable assertions) so consumers' CI pins behaviour — the
`match-fold.fixtures.json` mechanism applied to auth. Consumers wire it via
the `CATALOG_PLATFORM_DIR` fetch the library already uses for universes;
`Board_Game_Catalog` gains that dependency (new for it — say so in its
README when wiring).

### 14.3 Index adoption (§9 step 3) — **BUILT 2026-08-13** (deploy pending)

~~Edit `apps/index-worker/migrations/0001_…` in place — it is unapplied
everywhere remote~~ ⚠️ Stale by build time: 0001 WAS applied remotely
(re-verified before building, as this section itself demanded), so
`estate_cache` landed as **additive migration `0002_estate_cache.sql`**
(email PK, firebase_uid, status CHECK, checked_at). Wired
`requireEstateMember()` (canonical module: `resolveIdentity` →
`estateCheck` cached in `estate_cache` → §3.1 combine) as a blanket over
`GET /api/lookup` + `GET /api/universe/:name`; health open; push routes keep
per-source bearers, mounted before the blanket by name. The index has no
local roles, so §3.1's `default_grant` grants nothing and proceeds —
membership IS the authorization there — and local standing is `OWNER_EMAILS`
alone (the §6 row 4 break-glass). Proven by 16 wiring tests + 13 live probes
(`npm run probe`: §8.2 conformance in real-auth mode, then the full
pending→approved→revoked→outage lifecycle against a spawned local auth
Worker). Remaining (dispatcher): remote 0002, `ESTATE_APP_TOKEN_INDEX`
secret, push tokens, deploy, first real push, then §9 step 3's three probes
against production.

### 14.4 Apex search (§9 step 4) — **BUILT 2026-08-13** (deploy pending)

`sites/heygabi-home/public/index.html`: replace the `#find` slot with input +
results list; Firebase web SDK (same CDN modules the audiobook site uses);
sign-in button appears only inside `#find`; results render title / source /
cover / `detail_url` link — the fields `index-worker-design.md` §4 exposes.
Rewrite the :13 warning per §7.2 — *rewrite, not delete*. `_headers`: widen
CSP per §7.2. 🔴 Owner: apex into Firebase authorised domains. Deploy per
`sites/heygabi-home/deploy.md` §4. Verify signed-out (page fine, search asks
for sign-in), pending (honest queue message), approved (results).

Built as specified, plus the owner-decision-#6 rider this section predates:
**the `/admin` member page** (list by status, approve/revoke,
promote-to-approver, break-glass surfaced on the page) shipped in the same
change — `public/admin/` + `public/assets/estate-auth.js` (the ported
minimum of `identity.js`, keeping the session because its job is minting
bearers) + `public/assets/find.js`. Two amendments to §7.2's mechanical
list, found by building: (1) `connect-src` also needs
`https://auth.heygabi.ai` — the admin API lives there and §7.2 was written
before decision #6 moved the admin UI to the apex; (2) the CSP went onto
**per-path `_headers` rules**, not `/*`, so each page can carry its own
policy (two CSP headers on one path would enforce their intersection).
⚠️ SUPERSEDED 2026-08-15 (owner order: "Auth lock the todo page too") — this
sentence used to end "...so `/todo` keeps its no-JS `default-src 'none'`
policy." `/todo` is no longer no-JS: it is now itself a `requireApprover()`-
gated surface, same shape as `/admin` and the `/status` Operations section
(`apps/auth-worker/src/todo.ts` serves the board content; the public page is
a content-free shim that signs in and fetches it). The board being
CSS-only-radios and public was a hidden link, not a lock — see
`catalog-platform/docs/TODO.md`'s "Auth-lock the /todo page" entry for the
full change. `auth/unauthorized-domain` renders as a named owner-action
message. ⚠️ The §15 two-tab test is DUE at first deploy.

### 14.5 Library, then games (§9 steps 5–6)

Per app: additive migration `ALTER TABLE app_user ADD COLUMN estate_status
TEXT; ALTER TABLE app_user ADD COLUMN estate_checked_at TEXT;` (attended, per
the standing migration rule). Swap local verifier for the canonical module —
⚠️ in the library this changes the dev bypass condition; check
`apps/worker/.dev.vars` sets `ENVIRONMENT=development` so local dev keeps
working. Add `ESTATE_CHECK` var (`off`→`shadow`→`enforce`) and
`ESTATE_APP_TOKEN_*` secret. In `shadow`, log the §3.1 verdict per request;
run days-not-hours, grep for would-have-refused lines, expect **zero** for
household members before flipping `enforce`. Default-grant writes an audit row
in apps that have `change_log` (`changed_how='auto'`, note naming the estate).

### 14.6 Done-when

- All eight §8.2 probes pass on: auth Worker, index, library, games
- A test Google account (a real spare, not a household member) walks:
  sign-in → pending everywhere → one approval at `auth.heygabi.ai` → search
  works + library `reader` + games `viewer` → revoke → all three refuse within
  10 minutes
- `OWNER_EMAILS` sign-in works with the auth Worker **stopped**
- `PLATFORM.md` §1/§4 updated; this doc's status header flipped from
  DESIGN-ONLY to BUILT with dates per stage

---

## 15. Sources, and what was NOT verified

Read 2026-08-13 (all paths absolute in the repos named): both
`apps/worker/src/middleware/auth.ts` files; both `apps/worker/wrangler.toml`
([vars] sections); both `packages/db/src/users.ts`; both
`packages/core/src/capabilities.ts`; library migrations 0001/0006/0007/0008/
0040/0100/0110/0120 (the FK grep); games migrations 0001/0023/0024;
`audiobook_catalog/site/identity.js` (ADMIN_EMAILS:146, isAdmin:163, /users
writes) and `firestore.rules` (/users:147, /reviews:153); library
`apps/worker/src/index.ts` and games `…/index.ts` (blanket mounting);
`sites/heygabi-home/public/index.html` (:13 warning, #find slot) and its
README; `PLATFORM.md`; `HEYGABI_LAYOUT.md`; `index-worker-design.md`;
`library_catalog/docs/info/identity-and-reviews.md`.

**Not verified, explicitly:**

- **Firebase auth-state origin-scoping** (§7.2's load-bearing claim) — from
  platform knowledge of IndexedDB/localStorage scoping, not from an
  experiment on these hosts. Verify during §9 step 4 with one attended
  two-tab test: sign in on the apex, load `audiobooks.heygabi.ai` (which
  calls `signOut()` on its own auth instance), confirm the apex session
  survives. If it does not, the fallback is a `search.heygabi.ai` host —
  §7.2's rejected alternative becomes the design, and nothing else changes.
- **Neither production D1 was queried** — user counts and role distributions
  come from the repos' own docs, not live reads. The seed's dry run is where
  live data gets read, printed and eyeballed.
- **Firestore was not read live** (no service account held, by policy); the
  /users and reviews population figures are `identity-and-reviews.md`'s
  measurements of 2026-08-11/13.
- **Worker-to-Worker latency** for `/seen` on same-zone custom domains —
  assumed low; measured never. It is off the hot path (once per user per TTL)
  so even a slow answer costs little, but the shadow phase should log its
  duration.
- **`ENVIRONMENT` values in any non-production lane** of either app — the
  §1.1 exposure analysis reasons from the tomls read, not from deployed
  config.
