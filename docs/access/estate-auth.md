# Estate SSO (auth-worker) — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret
> NAMES only, never values — this repo is public on GitHub, so this
> discipline is load-bearing here, not just habit).
> Last verified: **2026-08-16** — written at build time for Phase 1
> (`/__/auth/*` proxy) and Phase 2 (the session service), per
> `docs/info/sso-design.md` §8/§9 Q2 ("the rotation runbook is a build
> deliverable, not a follow-up"). The `TOKEN_SIGNER_KEY` rotation runbook
> below (§3) is the part the owner conditioned Q2's approval on.
> Companions: `docs/info/sso-design.md` (the whole design — §3.3 the
> WebCrypto mechanics, §4.1 the proxy, §4.3 the session service, §7 the
> security analysis this doc leans on), `docs/info/estate-auth-design.md`
> (the membership layer these routes sit beside, untouched by this build),
> `docs/access/README.md` (index).

## 1. What is live, in one paragraph

Two additions to the existing `auth.heygabi.ai` Worker (`apps/auth-worker`),
both **server-side only** as of this build — no site's `authDomain` has been
flipped and no CSP has been widened, on purpose (§5). **Phase 1**: a
transparent reverse proxy at `/__/auth/*` → `audiobook-catalog.firebaseapp.com`,
mounted before every other route. **Phase 2**: a session service — three
routes that turn one interactive Google sign-in into a parent-domain cookie,
and that cookie into a freshly minted Firebase custom token for any other
estate surface. Neither phase changes who can do what on any existing route
— see §4's boundary.

## 2. Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/__/auth/*` | any | none (it IS the sign-in ceremony) | Proxies to `audiobook-catalog.firebaseapp.com`, byte for byte — method, headers, body, response status/headers all pass through. `redirect: 'manual'` so Firebase's own bounces (e.g. to `accounts.google.com`) reach the browser unresolved instead of being followed server-side. |
| `POST /api/session` | Firebase ID token (`Authorization: Bearer`) | Verifies the token (the canonical `@platform/estate-auth` verifier — no re-implementation), creates an `estate_session` row, `Set-Cookie: estate_session=<opaque id>`. |
| `POST /api/session/token` | the `estate_session` cookie | Looks up the row; if live, mints a Firebase custom token (5 min) for that row's uid via WebCrypto RS256, and rolls the cookie/row forward another 30 days. |
| `DELETE /api/session` | the `estate_session` cookie (or none) | Soft-revokes the row (`revoked_at` stamped, never deleted) and clears the cookie. Idempotent. |

Source: `src/auth-proxy.ts` (Phase 1), `src/session.ts` + `src/session-db.ts`
+ `src/token-signer.ts` (Phase 2). Migration: `migrations/0004_sessions.sql`
(`estate_session` table — additive, no existing table touched).

## 3. `TOKEN_SIGNER_KEY` — what it is, what it can do, and how to rotate it

### 3.1 What it is

A Google Cloud **service-account key**, dedicated to this one purpose,
created with **zero IAM roles**. It arrives as a Worker secret named
`TOKEN_SIGNER_KEY` holding the **whole service-account JSON** (same shape as
the existing `FIREBASE_SERVICE_ACCOUNT` secret — `client_email`,
`private_key`, `project_id` — parsed by the same `parseServiceAccount()` in
`src/firebase-sa.ts`). ⚠️ **It must be a DIFFERENT service account from
`FIREBASE_SERVICE_ACCOUNT`** — that one holds real Firestore/identitytoolkit
scopes; this one must hold none. Mixing them up hands a zero-role signer
real admin scope.

### 3.2 What it can do — the honest ceiling (sso-design.md §7.2)

Sign an RS256 JWT (a **Firebase custom token**) for **any uid** — no IAM
permission is checked or needed, because *possessing the private key IS the
capability*. Concretely: whoever holds this key's value can mint a token
that, exchanged via `signInWithCustomToken`, produces a normal Firebase
session **as any estate member, including the owner** — full impersonation
of anyone on the shared `audiobook-catalog` project.

**What it can NOT do:**
- It is **not a Firestore-admin credential**. A custom-token session is an
  ordinary Firebase user session, subject to Firestore rules and every
  Worker's own checks like any other sign-in — the standing "no Firestore
  service account in a Worker" refusal is unrelated and untouched.
- It grants **no Google Cloud IAM permission** — it cannot read logs, billing,
  other secrets, or the GCP/Firebase console itself.
- It cannot forge a **Firebase ID token** directly, only mint custom tokens
  that a client then exchanges for one through Google's own
  `identitytoolkit` endpoint — so `resolveIdentity()`'s verification (issuer,
  audience, signature against Google's JWKS) still runs on the resulting
  session exactly as on any other sign-in.

This is strictly **stronger than any other secret in this Worker** and must
be treated accordingly: nobody pastes it into a terminal line, a log
statement, an error message, or a commit — ever.

### 3.3 Where it lives

Cloudflare Worker secret, name `TOKEN_SIGNER_KEY`, on the `estate-auth`
Worker (`auth.heygabi.ai`) only. Write-only after `wrangler secret put` —
nobody, including this repo's own Claude sessions, can read the value back
out. Locally (dev only, never commit): paste the real JSON into a
gitignored `.dev.vars` — never as a placeholder string, exactly like
`FIREBASE_SERVICE_ACCOUNT`'s existing convention.

⚠️ **Does not exist yet as of this build.** Every route that needs it
(`POST /api/session/token`) answers a clear
`503 { error: "token_signer_unset", fix: "wrangler secret put TOKEN_SIGNER_KEY" }`
until the owner creates it — see §6 for the exact console steps.

### 3.4 Routine rotation

Rotate on a schedule (recommended: yearly, or whenever anyone who had
terminal/console access to the key material leaves the household) or after
any suspicion, however small.

```bash
# 1. In Google Cloud Console (IAM & Admin → Service Accounts → the
#    estate-token-minter account), create a SECOND key. The account now has
#    two valid keys; both work simultaneously — no outage window.

# 2. Push the new key into the Worker (from apps/auth-worker):
wrangler secret put TOKEN_SIGNER_KEY
#    Paste the NEW key JSON when prompted. Never pipe it through a shell
#    history-logged command; never echo it.

# 3. Deploy so the new secret is live:
npx wrangler deploy

# 4. Verify (no real key material touched — see §5's live-probe pattern):
#    POST /api/session/token with a valid cookie should now mint using the
#    new key. Confirm no 503/500 regressions with:
node tools/estate-probes/run.mjs

# 5. ONLY after confirming step 4 — delete the OLD key in the GCP console
#    (the same Service Accounts screen, the old key's row → Delete).
#    Deleting it immediately invalidates every token signed with it —
#    already-minted tokens are 5-minute-lived (§3.2), so anything in flight
#    has already expired by the time a human completes steps 1-5 anyway.
```

**Why two keys, briefly overlapping, rather than delete-then-create:**
deleting first and creating second means a window where the secret is unset
and every `/api/session/token` call answers 503 — a real, visible outage of
the SSO convenience layer (never of core sign-in, §4) for no reason. Create
first costs nothing and has no such window.

### 3.5 Revoke / recover if leaked

**The instant estate-wide kill**, faster than any rotation dance: in the
Google Cloud / Firebase console, **disable the service account itself**
(IAM & Admin → Service Accounts → the estate-token-minter account →
Disable). This invalidates *every* key on that account immediately,
including ones nobody remembered existed. Re-enabling later restores it —
but if the leak is confirmed rather than suspected, delete the account and
create a fresh one instead (§3.6).

Then, in order:

1. **Disable the service account** (above) — stops the bleeding in seconds,
   before anything else.
2. **Confirm the blast radius, calmly**: per §3.2, a leaked key can
   impersonate any estate member but cannot touch Firestore admin, GCP IAM,
   or any console. Nobody's *Google account* is compromised — only their
   estate-surface sessions. If misuse is suspected, check each surface's own
   audit trail (library/games `change_log`, the estate directory's
   `decided_by` stamps) for actions attributed to accounts that could not
   plausibly have signed in themselves in that window.
3. **Recreate the service account from scratch** (§3.6) rather than issuing
   a fresh key on the compromised account — a account whose key material
   leaked once is not a account to keep trusting indefinitely, and creating
   a new one costs one more console step, not a redesign.
4. **`wrangler secret put TOKEN_SIGNER_KEY`** with the new account's key,
   `npx wrangler deploy`, verify with `node tools/estate-probes/run.mjs`
   (§3.4 steps 2-4).
5. **No user action is required.** Existing `estate_session` cookies/rows
   are untouched by any of this — they still work with the new key on the
   next mint, because the cookie never encoded anything about the signing
   key itself (§7.1 of the design: the cookie is an opaque id, not a JWT).

### 3.6 Creating the service account (first time, or after a compromise)

Google Cloud Console → IAM & Admin → Service Accounts → **Create Service
Account**, project `audiobook-catalog`:

- Name: `estate-token-minter` (or `estate-token-minter-2`, `-3`, … after a
  compromise — never reuse a name that was ever compromised, to keep audit
  logs unambiguous about which key signed what).
- **Grant this service account access to project: SKIP.** Zero roles is the
  point (§3.1) — do not attach any IAM role, not even a read-only one.
- **Grant users access to this service account: SKIP.**
- Create a key (JSON), download it once. That download IS the
  `TOKEN_SIGNER_KEY` value — go straight to `wrangler secret put`
  (§3.3/§3.4 step 2) and then delete the local downloaded file. Never leave
  the JSON sitting in a Downloads folder.

## 4. What this build deliberately does NOT change

- **No `authDomain` flip, on any surface, in any repo.** The proxy exists
  and is correct; pointing a site's Firebase config at it is a separate,
  later, owner-gated step (§5's ordering hazard).
- **No CSP widened** — same reason; that ships with the flip, not before.
- **No Worker trusts the `estate_session` cookie for authorization.**
  Every existing enforcement path (ID token verification + the estate
  directory, per `estate-auth-design.md`) is completely untouched. The
  cookie's only power is minting a custom token for the SAME uid its owner
  already proved with their own Firebase ID token at `/api/session` time —
  sso-design.md §6 argues this in full.
- **No existing route, secret, or migration was altered.**
  `0004_sessions.sql` is additive only.

## 5. ⚠️ The one ordering hazard (sso-design.md §8)

Flipping any surface's `authDomain` to `auth.heygabi.ai` **before** the two
🔴 console steps below are live **breaks that surface's sign-in**. The
proxy being deployed is necessary but not sufficient — Firebase's own
authorised-domain and OAuth-redirect-URI lists must also name
`auth.heygabi.ai` first. Order: console steps → (optional attended test) →
flip, never the other way round.

## 6. 🔴 Owner console steps required to make any of this live

Nothing in this build requires these to exist — the proxy is dormant until
a surface's `authDomain` points at it, and the session routes 503-idle
until the signer key exists. In the order they unblock:

| # | Step | Where | Unblocks |
|---|---|---|---|
| 1 | Verify/add `auth.heygabi.ai` to **Firebase Authorised domains** | Firebase Console → Authentication → Settings → Authorized domains, project `audiobook-catalog` | Any future `authDomain` flip (Phase 1's actual payoff) |
| 2 | Add `https://auth.heygabi.ai/__/auth/handler` to the **OAuth client's authorised redirect URIs** | Google Cloud Console → APIs & Services → Credentials → the Firebase-managed OAuth 2.0 Client ID | Same as #1 — both are required together |
| 3 | Create the `estate-token-minter` service account, zero IAM roles (§3.6), download its key, `wrangler secret put TOKEN_SIGNER_KEY` | Google Cloud Console → IAM & Admin → Service Accounts | `POST /api/session/token` (currently 503 `token_signer_unset`) |

Steps 1-2 are Phase 1's console gate; step 3 is Phase 2's. None of the three
touches an existing surface's config — they only make dormant capability
reachable.

## 7. Gotchas

| Gotcha | Detail |
|---|---|
| The 503-unset idiom is deliberate, not a bug | Every route needing `TOKEN_SIGNER_KEY` answers `503 {error:'token_signer_unset', fix:'wrangler secret put TOKEN_SIGNER_KEY'}` — never 500, never a confusing 401 — so the routes sit safely idle pre-§6 step 3. Same pattern as the pre-existing `FIREBASE_SERVICE_ACCOUNT` (`service_account_unset`) and per-app `/seen` tokens (`app_tokens_unset`). |
| Session validity beats config-error, on purpose | `POST /api/session/token` checks the cookie's validity BEFORE checking whether the signer key is configured — a caller with no session learns nothing about backend configuration state (mirrors `requireApprover`/`requireDevops` outranking the 503-unset routes elsewhere in this Worker). |
| The cookie's `Domain` is env-driven | `COOKIE_DOMAIN` (default `.heygabi.ai`) — `wrangler dev` needs a non-production value since `Domain=.heygabi.ai` can never be set from a `localhost` origin. |
| `SESSION_ORIGINS` is its own CORS list | Not `ADMIN_ORIGINS` (apex-only) or `ME_ORIGINS` (apex + audiobook) — the session routes must admit all four estate surfaces including library and games. Defaults to the production four if unset; see `env.ts`. |
| The real end-to-end exchange is NOT verified by this build | `signInWithCustomToken(token)` actually succeeding against Google's real `identitytoolkit` endpoint needs the owner's real `TOKEN_SIGNER_KEY` — the test suite proves the JWT this Worker produces is a correctly-shaped, correctly-signed RS256 token (verified cryptographically against a throwaway keypair in `test/token-signer.test.ts`), which is everything provable without that key. `sso-design.md` §10 names this as the standing not-verified item; Phase 3 (adoption) is where it gets exercised for real. |

## 8. Rollback

Each phase reverts independently and cheaply:

- **Phase 1**: revert `src/auth-proxy.ts`'s mount in `src/index.ts` (one
  line) and redeploy — no surface has adopted the proxy yet, so nothing
  downstream notices.
- **Phase 2**: unset `TOKEN_SIGNER_KEY` (routes fall back to 503-idle) or
  revert the three-route mount in `src/index.ts` — no data loss either way,
  `estate_session` rows are simply unread going forward.

## 9. ⚠️ The `/admin` page's INTERACTION GRAMMAR — two gestures, and only two

> Added **2026-08-17**, by owner order. Read this before adding any control to
> `sites/heygabi-home/public/admin/`. The page it describes is the estate
> member directory at <https://heygabi.ai/admin/>; the API contracts it drives
> are §2 above and `docs/info/estate-auth-design.md` §4.4/§4.5.

**Why this section exists.** The page accreted four different ways to commit
one kind of decision, one build at a time, each defensible on its own. The
owner, on the live page:

> *"auth setting has too many different auth setting experiences, sometimes we
> double click to confirm sometimes we use the drop down. also at the top we
> have a tree for audio and ebooks but not one for the other sites. maybe just
> make a full permission map after normalizing everything."*

and, settling the shape himself once he saw the first cut:

> *"how come only audiobooks and ebooks have set role? I thought we were
> normalizing this. either they all have set role for each site or none. I
> think you should do a confirm/save button and no set role button for each
> role. have the save button appear on each persons box when a change is
> made."*

and, on the little tag that used to hang off the Audiobooks/Ebooks row:

> *"what is this download: admin + role tag it looks bad and idk what its
> trying to tell me."*

### 9.1 The grammar

| Class | What it covers | The gesture |
|---|---|---|
| **GRANT** | every `visible` checkbox, every site's role dropdown — **all four sites, identically** | Touching it **stages** and writes nothing. The control is outlined (`.perm-staged`). A single **Save permissions** button **appears on that person's card** when anything in it changes, commits everything staged in that card, and reports in words. |
| **STATUS** | Approve, Revoke, Make/Remove approver, Make/Remove devops, **Give/Remove dev access** (0011, 2026-08-17 — §10) | **Two taps** (`confirmBtn`, `assets/estate-controls.js`): first arms, second writes, disarms itself after 4s. |
| **NOT A CONTROL** | owner rank, a rung above your grant power, a site with no account row yet, a Worker that did not answer, **a capability held implicitly** (devops/approver already hold dev access) | **Words that name the cause** (`.perm-owner` / `.perm-note` / `.perm-warn`, sized by `.user-fact` when it stands in the actions row). Never a disabled dropdown, and never a button whose outcome it cannot change. |

**A new control picks one of the two gestures. It does not invent a third.**

### 9.2 The rules behind the rules

- **One Save per MEMBER, never per row.** `POST /api/estate/users/:id/visibility`
  takes the WHOLE canonical set, not a delta — a per-row Save would silently
  commit another row's staged boxes. Per-card is the only shape where what the
  button commits equals what the person staged.
- **The Save APPEARS, it does not sit there disabled** (owner's words above). A
  permanently visible disabled button spends its life refusing.
- **Approve is two-tap like everything else.** It was the lone one-tap action,
  justified as "additive and low-stakes" — but make-approver and make-devops are
  additive and low-stakes too and have confirmed since 2026-08-15, so the
  exception was a leftover, not a rule.
- **Every refusal keeps the server's own sentence.** A partial save says what
  landed, what did not, that the failed edit is *still staged*, and why — the
  Worker's own words, never a bare status (global §1e).
- **Derived facts are derived, never editable.** The grid's fourth column reads
  the rung's meaning off the ladder: the live per-rung summary from
  `GET /api/estate/site-roles/tree` for Audiobooks/Ebooks, and the one-line rung
  meanings of `docs/info/role-capability-map.md` for the app sites. The ebook
  **download** floor (`admin`) is appended to that line — it is not a tag, a
  badge, or a control anywhere on the page.
- **A rung with no documented meaning says so.** No invented summaries; each
  site's vocabulary is rendered in that site's own words and never translated.

### 9.3 The anatomy (what a future build must not quietly re-shape)

- `SITE_ROWS` in `admin.js` is the **one** row list: it drives each member's
  grid, the top **Permission map** disclosure, and the order the filter chips
  and per-site role filters read in. Adding a site is a row there — not a new
  layout.
- The grid's four columns are fixed: **site · visible · role · what that role
  can do** — deliberately the anatomy of `docs/info/role-capability-map.md`.
- The top map covers **every** site, each degrading on its own (owner: *"we have
  a tree for audio and ebooks but not one for the other sites"*).
- `pendingEdits` (keyed by user id) and `expandedMembers` live **outside the
  DOM**: every card is rebuilt on each search keystroke, sort and mutation, so
  state held in a checkbox would be silently discarded by typing.
- ⚠️ **CSP:** the three app Workers (`library`, `boardgames`, `padhard`) are
  already named in `_headers` for both `/admin` and `/admin/`. Federating a
  role column needs the app row in `APPS` **and** the `connect-src` entry —
  shipping only the first looks exactly like the other site being down.

## 10. ⚠️ DEV-LANE ACCESS — the `dev_access` flag (migration 0011, 2026-08-17)

> Owner order, verbatim: *"i need a way in the estate to manage dev access for
> ebook, add a button for give dev access also make devops always able to see
> dev envs."* Built the same day. Companions: `migrations/0011_dev_access.sql`
> (the full argument), `docs/access/ebooks-gate.md` (the real ebook lock, which
> this is **not**).

### 10.1 The grammar, in one table

| Fact | Where it lives | Notes |
|---|---|---|
| `dev_access` column | `migrations/0011_dev_access.sql` | `INTEGER NOT NULL DEFAULT 0 CHECK (0,1)`. Means **"granted by hand"** and nothing else. |
| The decision | `src/middleware/auth.ts` → `devAccessAllows(row, isOwner)` | The **one** implementation, sitting beside `approverAllows` / `devopsAllows` deliberately. |
| The write | `src/estate-db.ts` → `setDevAccess()` | One column, stamped `decided_at` / `decided_by`. Touches nothing else. |
| The route | `POST /api/estate/users/:id/dev-access` | Body `{ "dev_access": true \| false }`, `.strict()`. **`requireApprover()`** — the same authorization as the devops flip, mirrored exactly. `409 not_approved` when granting to a row that is not approved. |
| The answers | `GET /api/estate/me` + `POST /api/estate/hello` → `dev_access` (**effective**) · `POST /api/estate/seen` → `dev_access` (**effective**) · `GET /api/estate/users` → `dev_access` (**stored**) **and** `dev_access_effective` | The admin listing carries both halves because only it needs to tell them apart; everyone else gets the effective answer and never re-derives. |
| The UI | `sites/heygabi-home/public/admin/admin.js` | Two-tap **Give / Remove dev access** button + a `dev access` badge. §9's STATUS class — not a third gesture. |

### 10.2 The rule: **devops ⇒ dev access, always** — computed, never stored

```
dev access = OWNER_EMAILS
             OR (status = 'approved' AND (dev_access = 1 OR is_devops = 1 OR is_approver = 1))
```

- ⚠️ **The implication is never written into the row.** A devops person answers
  `true` with `dev_access = 0`. Materialising it would mean removing devops
  silently *kept* the dev grant — precisely the failure `0009`'s per-person
  download column shipped and `0006` ("revoke clears powers") exists to prevent.
- `is_approver` rides in for `0003`'s own reason: approvers hold every devops
  surface implicitly and the estate has never fenced an approver out of one.
- **Status gates it**, matching `devopsAllows()`. Revocation *also* clears the
  stored flag (`decideStatus()` appends `dev_access = 0`) — two independent
  barriers, as everywhere else here.
- **On the page:** an owner row and a devops/approver row get a **worded fact**
  where the button would be, never a button. A control that cannot change the
  outcome is not drawn (§9.1, third class).

### 10.3 ⚠️ CURTAIN, NOT LOCK — the distinction that decides how much this matters

| | The curtain | The lock |
|---|---|---|
| What | `dev_access` (0011) | `vis_ebooks` (0008) |
| Gates | the **dev UI**: whether the `/dev/` lane's ebook pages draw themselves or show a worded "this is the dev lane" panel | the **ebook manifest and byte stream** — `GET /api/ebooks/manifest` and the range-served files |
| Enforced by | the page, client-side, for tidiness | `apps/audiobook-worker`, server-side, **on both lanes** |
| If it were bypassed | someone sees a dev page they were not invited to | someone reads or takes a book |

**Nothing in the auth Worker is gated on `dev_access`** — it is an *answer*, not
a gate. A future build must not promote it into an enforcement path, and must
never relax `vis_ebooks` on the grounds that "dev access covers it": the two
answer different questions, and only one of them is standing between anyone and
a file. `docs/access/ebooks-gate.md` remains the reference for the lock.

### 10.4 Not verified by the build

The `/dev/` lane's own curtain lives in **`audiobook_catalog`**, queued in that
repo — this half only publishes the answer. Nothing consumes `dev_access` yet,
so the field's *end use* is unexercised; what is exercised is the flag, the OR,
the route's authorization and the button (`test/dev-access.test.ts`).
