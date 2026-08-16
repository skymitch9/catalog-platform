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
