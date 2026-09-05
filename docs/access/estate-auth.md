# Estate SSO (auth-worker) — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret
> NAMES only, never values — this repo is public on GitHub, so this
> discipline is load-bearing here, not just habit).
> Last verified: **2026-09-05** for §9 **and §11** — §11 is new that day (the
> private `estate-catalog-keys` bucket the sealed Claude key lands in), measured
> by creating the bucket, reading its public-access setting back and deploying
> the binding; ⚠️ no real envelope has ever been written by a signed-in person.
> §9.3 gained the `/admin` page map
> (four top-level panels, the catalog queue first) and three rules the catalog
> build settled, each read straight out of `admin/index.html` and `admin.js`
> that day. ⚠️ **Nothing in §9 has been rendered signed in**, by this build or
> the two before it. Everything outside §9 keeps the date below.
> Last verified (the rest): **2026-08-26** — §3.3, §6 and §7's first gotcha were
> re-measured that day with `wrangler secret list` on `estate-auth` (names
> only): `TOKEN_SIGNER_KEY` **IS SET**, correcting three places that said it
> did not exist yet or that the session routes were idle. ⚠️ **Nothing else in
> this file was re-checked**, and the SSO end-to-end exchange remains the
> standing not-verified item (§7's last gotcha).
> Originally written **2026-08-16**, at build time for Phase 1
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

⚠️ **THIS TABLE IS THE SSO BUILD'S ROUTES, NOT THE WORKER'S.** `estate-auth`
serves roughly forty routes across a dozen features, and the table above covers
four. That is deliberate rather than stale: the estate's convention is that a
feature's **route contract lives in that feature's own design doc**, one fact
with one home, and this file owns the SSO phases plus the operating runbooks.
Where to look for the others — the membership API in
[`../info/estate-auth-design.md`](../info/estate-auth-design.md) §4.4, the
"+ add a verse" queue in
[`../info/universe-add-verse-design.md`](../info/universe-add-verse-design.md)
§3.5, the spending policy in
[`../info/llm-billing-control-design.md`](../info/llm-billing-control-design.md),
and **the "Request a catalog" queue (0018, live 2026-09-05) in
[`../info/request-a-catalog-design.md`](../info/request-a-catalog-design.md)
§3.6** — six routes under `/api/estate/catalogs/*`, guarded by the same three
predicates in `src/middleware/auth.ts` that everything above uses.

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

✅ **IT IS SET** — measured **2026-08-26** with `wrangler secret list` on
`estate-auth` (names only; a Worker secret can never be read back). This
paragraph said *"⚠️ Does not exist yet as of this build"* until that day, and
so did `src/env.ts` and `src/token-signer.ts`. All three are corrected in
place rather than deleted, because a session that read "does not exist"
concluded there was nothing here to protect — and this is the
impersonation-capable key.

⚠️ **The 503 idiom below is a GUARD, not a description of today.** Every route
that needs the key (`POST /api/session/token`) answers a clear
`503 { error: "token_signer_unset", fix: "wrangler secret put TOKEN_SIGNER_KEY" }`
when it is **un**set. That is still exactly how the code behaves; it simply is
not the state the estate is in.

**Custody, and why rotation is safe.** ⚠️ **Google issues this key; the estate
never generates it, and there is NO readable master** — not on disk, not in
the 1Password vault. What recovery means here is *minting a fresh key from the
GCP console* (IAM & Admin → Service Accounts → `estate-token-minter` → Keys),
which is why the "no readable master" row in
[`../info/secrets-review-2026-08-26.md`](../info/secrets-review-2026-08-26.md)
§3.1 marks it **not dangerous**: a service account can hold **two valid keys at
once**, so the swap in §3.4 has no outage window.

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

Nothing in this build required these to exist — the proxy is dormant until
a surface's `authDomain` points at it, and the session routes 503-idle
until the signer key exists. ✅ **Step 3 has since been done** (§3.3, measured
2026-08-26), so that sentence is history for the signer key. In the order they
unblock:

| # | Step | Where | Unblocks |
|---|---|---|---|
| 1 | Verify/add `auth.heygabi.ai` to **Firebase Authorised domains** | Firebase Console → Authentication → Settings → Authorized domains, project `audiobook-catalog` | Any future `authDomain` flip (Phase 1's actual payoff) |
| 2 | Add `https://auth.heygabi.ai/__/auth/handler` to the **OAuth client's authorised redirect URIs** | Google Cloud Console → APIs & Services → Credentials → the Firebase-managed OAuth 2.0 Client ID | Same as #1 — both are required together |
| 3 | ✅ **DONE** — `estate-token-minter` service account, zero IAM roles (§3.6), key downloaded, `wrangler secret put TOKEN_SIGNER_KEY` | Google Cloud Console → IAM & Admin → Service Accounts | `POST /api/session/token` — **no longer 503 `token_signer_unset`** |

Steps 1-2 are Phase 1's console gate; step 3 is Phase 2's. None of the three
touches an existing surface's config — they only make dormant capability
reachable.

> ✅ **STEP 3 IS DONE — the secret is set.** Re-measured **2026-08-26** with
> `wrangler secret list` on `estate-auth`: `TOKEN_SIGNER_KEY` is among the
> names. Everything else was already built and deployed as of 2026-08-18 (the
> routes, the minter, the revocation check, the widened origin list, and
> client adoption on the apex, `www`, `library`, `padhard` and `boardgames` —
> `docs/info/sso-design.md` §8c), and setting the secret needed **no further
> deploy**.
>
> ⚠️ **The paragraph this replaces read "All of it sits inert because this
> secret is unset — MEASURED that day…", and it was right on the day and wrong
> for every day after.** A measurement has an age. Nobody knows whether the
> key was set the next week or the next month, because the sentence that would
> have been re-checked was written as a fact rather than as a dated reading —
> which is why the correction above carries its date and its instrument.
> ⚠️ **NOT verified here:** that SSO end-to-end actually works. The secret's
> presence is a name in a list; `signInWithCustomToken` succeeding against
> Google is a separate claim, and §7's last gotcha still stands.

> ⚠️ **DO NOT PIPE THIS KEY IN WITHOUT KILLING THE BOM FIRST.** A separate
> incident the same day (see `docs/access/discord-bot.md`) established that
> **PowerShell secret pipes prepend an invisible UTF-8 BOM**, and the stored
> value then fails while *looking* perfectly valid. This key is the worst
> place in the estate for that failure: a BOM'd `TOKEN_SIGNER_KEY` either
> fails to parse or throws deep inside `importPrivateKey`, so instead of the
> clean 503 the unset-idiom promises, the mint route 500s or mints tokens
> Google refuses — and the symptom appears on every estate surface at once,
> as "SSO just doesn't work", with nothing pointing back at this line. Force
> UTF8-**no**-BOM encoding, trim, and verify the stored value works before
> trusting it; that doc carries the exact ritual.

## 7. Gotchas

| Gotcha | Detail |
|---|---|
| The 503-unset idiom is deliberate, not a bug | Every route needing `TOKEN_SIGNER_KEY` answers `503 {error:'token_signer_unset', fix:'wrangler secret put TOKEN_SIGNER_KEY'}` — never 500, never a confusing 401. Same pattern as the pre-existing `FIREBASE_SERVICE_ACCOUNT` (`service_account_unset`) and per-app `/seen` tokens (`app_tokens_unset`). ⚠️ **It is a guard, not today's state**: this row used to end *"so the routes sit safely idle pre-§6 step 3"*, and the key has been set since at least 2026-08-26 (§3.3). The 503 is what an unset key answers — and what a **BOM-damaged** one does *not* (see §6's warning: a BOM'd value 500s or mints tokens Google refuses instead). |
| Session validity beats config-error, on purpose | `POST /api/session/token` checks the cookie's validity BEFORE checking whether the signer key is configured — a caller with no session learns nothing about backend configuration state (mirrors `requireApprover`/`requireDevops` outranking the 503-unset routes elsewhere in this Worker). |
| The cookie's `Domain` is env-driven | `COOKIE_DOMAIN` (default `.heygabi.ai`) — `wrangler dev` needs a non-production value since `Domain=.heygabi.ai` can never be set from a `localhost` origin. |
| `SESSION_ORIGINS` is its own CORS list | Not `ADMIN_ORIGINS` (apex-only) or `ME_ORIGINS` (apex + audiobook) — the session routes must admit every estate surface, including library and games. Defaults to the production list if unset; see `env.ts`. ⚠️ **Widened 4 → 7 on 2026-08-18** (`www`, `ebooks`, `padhard` — each measured live, see `sso-design.md` §8c.4). |
| ⚠️ A surface missing from `SESSION_ORIGINS` fails **silently** | The preflight comes back with no `Access-Control-Allow-Origin`, the browser refuses the call, and the page's bootstrap reads that as "no session" and stays quiet. Nothing logs, nothing breaks, sign-in simply never travels to that one site. Pinned by tests in `test/env.test.ts` for exactly this reason. When adding an estate hostname, add it here in the same commit. |
| Client adoption hangs off ONE call per surface | Apex: `handleRedirectResult()`. Library/games: `watchAuth()`. Both are the call every auth-aware page already makes at boot, so a new page gets SSO by obeying a rule it already had. Don't add per-page bootstrap calls — see `sso-design.md` §8c.2. |
| `credentials: 'include'` is required in BOTH directions | Omitting it is the nastiest failure in this feature: the browser silently drops the `Set-Cookie` on the way back **while every status code still reads 200**. If sign-in seems not to travel and the network tab looks clean, check this first. |
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

**The page map — everything above the member directory**, in render order. Each
is a collapsed `<details class="adv">` with a live count, each degrades on its
own, and each is hidden entirely when its route does not answer *for a reason
the reader is not owed* (see the catalog row's exception):

| Element | `admin/index.html` | Rendered by | Owns the question |
|---|---|---|---|
| `#catalog-banner` | above the panels | `renderCatalogBanner()` | *"is anything waiting on me right now?"* — a render of the data, never a toast |
| `#catalog-queue` | first panel | `renderCatalogQueue()` | *"who has asked for a catalog of their own?"* (added 2026-09-05, `7acc497`; design [`../info/request-a-catalog-design.md`](../info/request-a-catalog-design.md) §5) |
| `#permission-map` | second | `renderPermissionMap()` | *"what does each rung mean, on every site?"* |
| `#spending-panel` | third | `renderSpendingPanel()` | *"what may bill the model, and where?"* |
| `#verse-queue` | fourth | `renderVerseQueue()` | *"who has asked for a universe?"* |

⚠️ **`#catalog-queue` is FIRST on purpose** — it is the only one of the four
that is waiting on a decision. A new panel picks its place by that test, not by
arrival order.

⚠️ **The catalog panel does NOT read through `api()`, and that is deliberate.**
`api()` answers `null` for every failure and puts one sentence on the shared
status line, which is right for a mutation and wrong for a panel that has to
explain its own emptiness. Its own fetcher keeps the four causes distinct: not
an approver (**the section is not drawn at all** — a member has no business
knowing the queue exists), the table is not migrated yet (say so and name the
fix), a lapsed sign-in, or an **outage** — worded as an outage, because
*"couldn't reach it"* and *"you may not"* have different next actions.

⚠️ **`api()` takes an optional third argument, `{ forbidden }`, since
2026-09-05.** The page's standing 403 sentence names the *approver* ladder, and
one route on this page (`POST /api/estate/catalogs/requests/:id/live`) is
**devops**-gated. Telling a devops refusal in approver words sends somebody
asking for a power they already hold. Any future devops-gated control here uses
the override rather than adding a fifth cause to the shared line.

⚠️ **The Accept panel's key field seals in the BROWSER and there is no reveal
control anywhere** (2026-09-05). Both the `/admin` panel and the front door's
"+" import the one module `sites/heygabi-home/public/assets/catalog-seal.js`;
only ciphertext ever reaches `POST …/decide` or `POST …/requests`, D1 holds the
`reader_key_set` / `owner_key_set` booleans and nothing else, and the private
half lives on the owner's machine at
`docs/access/keys/catalog-provisioning.private.jwk` — custody row in
[`RECOVERY.md`](RECOVERY.md) §11.3, mechanism in
[`../info/request-a-catalog-design.md`](../info/request-a-catalog-design.md) §6.
⚠️ Both surfaces read the boolean back off the row and say so in words when it
is not `1`: an older Worker ignores an unknown body field and answers a cheerful
201, and believing the POST instead of the row tells somebody their key is safe
when it was dropped.

⚠️ **The GRANT class covers a staging PANEL, not only a checkbox** — settled by
the catalog queue's Accept, 2026-09-05, and written down so a later build does
not "fix" it into a third gesture. Accept could not be pure STATUS class,
because the owner must be able to edit two text fields before granting and a
two-tap button has nowhere to put them. So Accept's **two taps open a panel and
write nothing**, and the panel behaves exactly like a member card: it stages,
and one Save commits everything staged in it. Decline, which needs no fields,
stays pure STATUS class.

⚠️ **`clearSignedInState()` must clear every queue as well as every ladder.**
Both request queues hold other members' names, emails and the reasons they gave.
The verse queue was left on screen after sign-out from the day it shipped until
2026-09-05 — not because the rule was wrong but because it had never been
applied to a panel that arrived after the rule was written. A new panel holding
anyone's data is a line in that function, in the same commit.

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

## 11. 🔐 `estate-catalog-keys` — where a requester's sealed Claude key waits

> Added 2026-09-05 (design
> [`../info/request-a-catalog-design.md`](../info/request-a-catalog-design.md)
> §6, which owns the mechanism and the threat table — this section is the
> OPERATING facts only). **Last verified: 2026-09-05**, by creating the bucket,
> reading its public-access setting back, and deploying the binding.
> ⚠️ NOT verified: no real envelope has ever been written by a signed-in person.

| Fact | Value |
|---|---|
| Bucket | `estate-catalog-keys` (created 2026-09-05 14:47:18Z) |
| Binding | `CATALOG_KEYS`, on `estate-auth` only |
| Public access | **disabled** — `wrangler r2 bucket dev-url get estate-catalog-keys` → *"Public access via the r2.dev URL is disabled"*. No custom domain, and it must never get one |
| Object keys | `reader/<request id>.json` (written at submit) · `owner/<request id>.json` (written at accept) |
| Contents | one sealed envelope per object — `{v, kid, alg, ek, iv, ct}`, `application/json`. **Never a plaintext key, and never anything in D1 but the `reader_key_set` / `owner_key_set` booleans** |
| Backed up | 🔴 **NO, by design.** See [`RECOVERY.md`](RECOVERY.md) §1b |

**Who writes, and who deletes — the whole lifecycle in one table.** ⚠️ The
Worker is **write-and-delete only**: it calls `.put()` and `.delete()` and there
is no `.get()` or `.list()` on this binding anywhere in it. That ABSENCE is the
guarantee that the owner can never read a requester's key; a test counts reads
against a stub and requires zero.

| Event | What happens to the objects |
|---|---|
| Submit with a key | `reader/<id>.json` written **after** the row, then `reader_key_set = 1` |
| Accept with a key | `owner/<id>.json` written, then `owner_key_set = 1`. The reader's object is untouched |
| Decline | **both** objects deleted, **both** booleans cleared |
| Withdraw | **both** objects deleted, **both** booleans cleared — the requester's own way to take a key back without asking anyone |
| Provisioner injects | **the provisioner deletes the object itself**, the moment `wrangler secret put` has taken the plaintext. `POST …/:id/live` deliberately deletes nothing |
| `POST …/:id/live` with `{"purge_keys": true}` | both deleted — the hatch for a provisioning run that never had the sealed-key library |

⚠️ **The two booleans mean different things before and after provisioning, and
that is deliberate.** Before: *"an envelope is held for this request"* — so a
decline or withdrawal clears them along with the objects, or the queue would
claim a key nobody can produce. At `/live`: *"this catalog has a key"*, restated
by whoever ran the provisioning; phase 6's back-seeded rows carry
`owner_key_set = 1` with no envelope that ever existed, and that is correct.

⚠️ **If `CATALOG_KEYS` is ever unbound, a submit carrying a key is refused in
words (503) and files no row.** It does not quietly drop the key: that would
leave somebody believing their own key is in use while the catalog is
provisioned with the OWNER's, which he pays for (§6.4 row 3).

**Rotation / recovery:** there is nothing to rotate here — the bucket holds no
credential of ours. The keypair it is sealed to is the provisioning keypair,
whose custody is `docs/access/keys/` (gitignored). Re-minting that keypair makes
every stored envelope undecryptable, which is a **feature**: the recovery for a
lost or unreadable envelope is *ask the requester for their key again*, never a
restore.
