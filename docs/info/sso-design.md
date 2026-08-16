# Estate SSO — Information Reference (design)

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — DESIGN
> ONLY, no app code changes; written by Fable 5 for owner approval.
> Last verified: **2026-08-14** — every "measured" claim was read out of the
> named file that day; the two Firebase mechanics (§3.3, §4.3) were verified
> against Google's current docs the same day. §10 lists what was NOT verified.
> Companions: `estate-auth-design.md` (the membership layer this rides on —
> §3.1 semantics, §4.4 API, §10 non-goals one of which this overturns),
> `PLATFORM.md` §4/§4a, `HEYGABI_LAYOUT.md`,
> `library_catalog/docs/info/identity-and-reviews.md`.

**The ask:** one Google sign-in that carries across `heygabi.ai`,
`audiobooks.heygabi.ai`, `library.heygabi.ai`, `boardgames.heygabi.ai`.
**Non-negotiables (standing owner decisions):** Firebase project
`audiobook-catalog` stays; Google SSO stays; Firestore stays; the audiobook
site stays public — SSO must never become a wall there.

---

## 1. The problem, split into its two honest halves

The owner's report (2026-08-14) contains two different problems, and only one
of them is solvable by any SSO architecture:

| Pain | Cause | Solvable? |
|---|---|---|
| **Sign-in on the apex does not carry to `audiobooks.`** (or anywhere else) | Firebase web auth state is **origin-scoped** — IndexedDB per origin. Four origins = four independent sessions of the *same* Firebase account. `estate-auth-design.md` §7.2 relies on exactly this scoping (it is what makes per-origin sign-in safe); it is also what makes it annoying | ✅ **Yes** — this doc |
| **Desktop had a session; the phone had none** | Sessions live in a browser profile on a device. No cookie, iframe, or authDomain trick moves a session between devices — only Google's own `accounts.google.com` session spans devices, and it only makes the *next sign-in* cheap, not absent | ⚠️ **Only smoothable.** Best case on a new device: **one** interactive Google tap on the first estate surface visited, then silence everywhere. Zero taps is not on the menu without handing session material to a sync service this estate does not have |

There is also a third, quieter problem that is plausibly the real reason the
phone "had no session": **the redirect sign-in flow is broken in 2026
browsers with the current config** (§3.2). Mobile is where popups fail and
the redirect fallback runs — so mobile is where sign-in silently drops the
credential. Fixing that is Phase 1 and is worth doing under every option
below, including do-nothing.

## 2. Ground truth — measured 2026-08-14

All four surfaces already share ONE Firebase project and near-identical
sign-in code; the problem is purely per-origin session storage:

| Surface | Sign-in file | Session kept? | Token use |
|---|---|---|---|
| apex `heygabi.ai` | `sites/heygabi-home/public/assets/estate-auth.js` | ✅ kept (its whole job is minting bearers) | `idToken()` → bearer to `index.` + `auth.` |
| `audiobooks.` | `audiobook_catalog/site/identity.js` **v2, 2026-08-14** | ✅ kept — v1's capture-then-`signOut()` is gone; localStorage `ab_identity_*` survives as a *mirror* of auth state, legacy untagged rows honoured | none — Firestore rules are shape-only by decision (§4a); identity is presentation |
| `library.` | `apps/web/src/lib/firebase.ts` | ✅ kept | `getIdToken()` → bearer to library Worker; `forceRefresh` once on 401 |
| `boardgames.` | `apps/web/src/lib/firebase.ts` | ✅ kept | same shape |

Shared facts: same `firebaseConfig` verbatim (projectId `audiobook-catalog`,
`authDomain: 'audiobook-catalog.firebaseapp.com'`); popup-first with redirect
fallback only on `POPUP_UNAVAILABLE` codes; both Workers verify ID tokens
locally (jose/JWKS, iss+aud pinned, unverified email refused) and consult the
estate directory per `estate-auth-design.md` §3.1 (library `shadow`, games
`enforce`). The auth Worker is **live at `auth.heygabi.ai`** with the
directory, per-app bearers, rate limiting, and CORS locked to the apex.

⚠️ **One stale comment found while measuring**, worth fixing in passing:
`Board_Game_Catalog/apps/web/src/lib/firebase.ts:31–36` still claims "loading
the audiobook site signs you out of this app too". That was written when the
hazard was believed origin-crossing; sessions are origin-scoped, and identity
v2 removed the sign-out anyway. The comment defends a rule
(`HEYGABI_LAYOUT.md` §1.3, no more auth origins) whose stated reason no
longer exists — the rule's *real* remaining cost is authorised-domain
surface, which is this doc's §5 trade.

## 3. The 2026 browser constraints — and the one fact that saves this estate

### 3.1 The fact: everything here is SAME-SITE

All four surfaces live under one registrable domain, `heygabi.ai`. Every
browser mechanism that has been killing cross-domain SSO since 2024 —
third-party cookie phase-out, storage partitioning, Safari ITP — keys on the
**site** (scheme://eTLD+1), not the origin:

- **Cookies:** a `Domain=.heygabi.ai` cookie sent from `library.heygabi.ai`
  to `auth.heygabi.ai` is a *first-party, same-site* cookie. `SameSite=Lax`
  or even `Strict` is satisfied; no deprecation machinery applies, in any
  2026 browser.
- **Chrome storage partitioning:** the partition key is the top-level site
  (eTLD+1) plus an "ancestor bit" set only when a *cross-site* frame sits in
  the chain. An `auth.heygabi.ai` iframe inside `library.heygabi.ai` is
  same-site all the way up → unpartitioned.
- **Safari/WebKit:** partitions third-party storage by the top page's
  registrable domain; same-site subdomain frames are first party. (WebKit is
  the least contractual of the three here — §10 flags it verify-if-used.)

So this estate gets to use techniques the wider web lost. A design that
works *only because* everything is `*.heygabi.ai` is fine — and must say so,
which this sentence is.

### 3.2 The constraint that bites TODAY: redirect sign-in is broken

Since Chrome M115+/Safari 16.1+/Firefox 109+ block third-party storage,
`signInWithRedirect()` **does not work reliably** when `authDomain` is the
default `<project>.firebaseapp.com`: the flow stores state on the helper
origin and reads it back through a hidden iframe on that origin — which is
cross-site from `*.heygabi.ai`, so its storage is partitioned and the result
is lost. Firebase's own docs now open with this warning and list five
fixes (verified 2026-08-14: firebase.google.com/docs/auth/web/redirect-best-practices).

Every estate surface falls back to redirect exactly when popups are
unavailable — "the normal case on mobile and inside in-app browsers"
(`identity.js`'s own words). **The estate's mobile sign-in path is therefore
the broken path.** The fix (Firebase's Option 3, reverse proxy) is §4.1.

### 3.3 Verified Firebase mechanics this design leans on

Verified against Google's docs 2026-08-14:

- **Custom tokens without firebase-admin:** a custom token is just a JWT —
  RS256, `iss` = `sub` = a service-account email, `aud` =
  `https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit`,
  `iat`, `exp ≤ iat+3600`, `uid` = the target user. Signing with the SA's
  own private key needs **no IAM permissions at all** — the key is the
  capability (`iam.serviceAccounts.signBlob` is only for the remote IAM
  signing API, which needs an OAuth token we'd have to mint anyway).
  WebCrypto (`importKey` pkcs8 → `sign` RSASSA-PKCS1-v1_5/SHA-256) does this
  in a Worker; it is the same class of JWT work `jose` already does in every
  verifier. **firebase-admin is not needed and never runs on Workers; this
  path does not want it.**
- **Client exchange:** `signInWithCustomToken(token)` in the standard web
  SDK — it calls `identitytoolkit.googleapis.com` itself (already in the
  apex CSP `connect-src`), creates a normal local session for that `uid`
  with normal refresh, and fires `onAuthStateChanged` — so every surface's
  existing `watchAuth`-driven UI works untouched.

---

## 4. The options, honestly

### 4.1 (a) `authDomain = auth.heygabi.ai` — fixes sign-in, does NOT share it

Point every surface's `authDomain` at a same-site host, and reverse-proxy
`/__/auth/*` from that host to `audiobook-catalog.firebaseapp.com`
(Firebase's documented Option 3 — the sites are on Cloudflare, not Firebase
Hosting, so the simpler Option 1 does not apply; the proxy must be
transparent, no 302s). The natural host is **`auth.heygabi.ai`** — the auth
Worker adds one proxy route, mounted before its API.

**What it gives:** redirect *and* popup flows become same-site end-to-end →
mobile sign-in works reliably; the consent screen shows `auth.heygabi.ai`
instead of `audiobook-catalog.firebaseapp.com`; one authorised-domain entry
serves every current and future surface's sign-in ceremony.

**What it does NOT give — say it plainly: no session sharing.** Auth state
is still stored per app origin. `authDomain` is only where the sign-in
*ceremony* runs. Anyone who sells (a) as SSO is wrong; it is the
reliability floor the other options stand on.

**Costs:** two 🔴 console steps (add `auth.heygabi.ai` to Firebase
authorised domains — *not* currently needed since the admin UI moved to the
apex, so verify/add; add `https://auth.heygabi.ai/__/auth/handler` to the
OAuth client's authorised redirect URIs in Google Cloud). Apex CSP
`frame-src` gains `https://auth.heygabi.ai` (both `/` and `/admin` rules in
`_headers`; keep the firebaseapp.com entry through the transition). ⚠️ It
makes the auth Worker a dependency of every *interactive* sign-in — a new
SPOF, bounded: existing sessions are untouched by its outage, and rollback
is reverting a config string per surface.

### 4.2 (b) Hidden-iframe token broker + postMessage — works here, still the wrong tool

The classic homemade-OIDC shape: a broker page on `auth.heygabi.ai` holds
the one real Firebase session; every site embeds it hidden and asks for
tokens via `postMessage`. Because everything is same-site (§3.1), the
broker's storage is genuinely unpartitioned in 2026 browsers — this estate
is one of the few places the pattern still functions.

Rejected anyway, on three grounds. (1) **Sign-in must then happen ON the
broker origin** — every surface's sign-in becomes a redirect-or-popup dance
through a central login page, the exact "central login-redirect service"
`estate-auth-design.md` §10 refuses, and a UX regression on every surface
that today signs in in place. (2) **The relayed ID token is not a local
session** — the library/games UIs are built on `watchAuth`/`currentUser`;
retrofitting a token-provider abstraction into three codebases is a bigger
diff than option (c)'s bootstrap snippet, for less. (3) It rides on the
least-contractual browser behaviour in play (WebKit same-site frame
storage), a live iframe on every page, and a `postMessage` protocol to get
wrong — permanent complexity for a worse result. Option (c) reaches the same
storage through one boring HttpOnly cookie instead.

### 4.3 (c) Parent-domain cookie + Worker-minted custom token — actual SSO

The recommended core. Three routes on the existing auth Worker, one D1
table, one secret, one small bootstrap snippet per surface:

```
sign in interactively, once, on any estate surface
  └─ site POSTs its fresh Firebase ID token → auth.heygabi.ai /api/session
       Worker: verify token (the same vendored verifier), refuse revoked,
       create session row, Set-Cookie estate_session=<128-bit opaque id>;
       Domain=.heygabi.ai; Secure; HttpOnly; SameSite=Lax; Max-Age=30d

any OTHER estate origin, on load, finding no local session
  └─ fetch auth.heygabi.ai /api/session/token   (credentials: 'include')
       Worker: cookie → session row live? → estate_user.status ≠ revoked?
       → mint custom token (uid from the session, exp 5 min, §3.3) → {token}
  └─ signInWithCustomToken(token) → normal local session, watchAuth fires,
       every existing UI works untouched
  └─ no cookie / refused → do nothing; the surface behaves exactly as today
```

- **Sessions table** (`estate_auth` migration `0003_sessions.sql`):
  `estate_session(id TEXT PK, email, firebase_uid, created_at, last_used_at,
  expires_at, revoked_at)` — opaque D1-backed ids, so revocation is a row
  update, and the directory Worker that already answers in/out now also
  answers "is this device still signed in".
- **CORS with credentials** on the two session routes, exact-origin
  allow-list = the four estate origins (extends the existing
  `ADMIN_ORIGINS` pattern; never `*` — credentialed CORS forbids it anyway).
- **The signing key**: a **dedicated service account** in project
  `audiobook-catalog` (suggested name `estate-token-minter@…`), created with
  **zero IAM roles**, one key, stored only as a Worker secret
  (`TOKEN_SIGNER_KEY`). §7 analyses what it can and cannot do; §8 names the
  standing-policy collision honestly.
- **Revocation composes with §3.1 unchanged:** estate-revoke refuses the
  *next mint* immediately, and the Workers' 10-minute `/seen` TTL kills API
  access for already-minted sessions exactly as today. The SSO layer adds a
  third, finer lever (kill one device's session row) without touching the
  existing two.
- **iOS footnote:** the cookie is server-set and `heygabi.ai` is not
  CNAME-cloaked to a third party, so ITP's 7-day script-storage cap should
  not apply — worst case if it ever does is a weekly re-tap on the phone,
  a degradation, not a breakage.

**What (c) does NOT do:** cross-device (§1 row 2 — first device visit still
costs one tap); single sign-OUT beyond the cookie (an origin that already
localised a session keeps it until it ends naturally — §9 Q4).

### 4.4 (d) Do nothing but smooth — the honest baseline

With identity v2 live everywhere and (a) applied, the residual friction is:
**one popup tap per origin per device** — up to 4 taps per device, each a
one-tap Google account-chooser because the Google session already exists;
sessions then persist per origin indefinitely. No new secrets, no new
routes, no policy overturned. What it leaves unfixed: the owner's actual
complaint — the apex tap does not carry to `audiobooks.`, and every new
device costs 4 taps instead of 1. Without (a) it also leaves mobile sign-in
broken, which is why (d) alone is not really on the table.

---

## 5. Recommendation

**Option (a) + (c), phased: (a) first because it fixes the thing that is
broken today; (c) on top because it is the only option that delivers what
was asked.** (b) is rejected (§4.2); (d) is the fallback if the owner
declines §9 Q1/Q2 — in which case ship (a) alone and stop.

Fit against the estate facts the brief demanded:

| Estate fact | How the design respects it |
|---|---|
| Auth Worker already exists at `auth.heygabi.ai` with the directory | Both (a)'s proxy route and (c)'s three routes land on it — no new host, no new Worker, and the exchange consults the directory it already holds |
| §3.1 TTL/revocation model must keep working | Untouched. Workers still verify ID tokens locally + `/seen` with the 10-min TTL; SSO only changes how a *browser* acquires a session, never how a Worker judges one |
| Audiobook site is public; SSO never a wall | The bootstrap is silent; failure = stay anonymous. No gate, no prompt. §9 Q5 adds one guard: skip the silent exchange when a legacy v1 mirror row exists, so a legacy identity is never yanked out from under someone — the existing upgrade button stays the one door |
| Apex CSP is a strict allow-list | Measured: only `frame-src` needs widening (`https://auth.heygabi.ai`, both `/` and `/admin` rules); `connect-src` already names `auth.heygabi.ai` + `identitytoolkit` + `securetoken`. The other three surfaces ship **no CSP headers at all** (grepped all three repos 2026-08-14) — nothing to widen there |

## 6. What this overturns — said out loud, the §7.2 way

`estate-auth-design.md` §10 lists **"A central session, cookie, or
login-redirect service — Firebase already is the session layer. A second one
is pure attack surface."** Option (c) is a central session cookie. The
overturn is argued, not slid past:

- That row was written for the *enforcement* path — and there it still
  stands: no Worker trusts the cookie for anything; enforcement remains
  Firebase ID token + estate directory, exactly as designed. The cookie is a
  **sign-in convenience layer**: the only thing it can produce is a session
  the same person could mint by tapping the Google button themselves.
- What §10 could not see when written: the owner's SSO pain is now a stated
  requirement, and "Firebase is the session layer" turns out to mean *four
  disconnected session layers*, one per origin — the thing the row's
  reasoning assumed was one.
- The "pure attack surface" cost is real and is paid knowingly — priced in
  §7, gated on §9 Q1. The rejected half stays rejected: no central
  login-*redirect* service; sign-in still happens in place on each surface.

## 7. Security

### 7.1 What a stolen `estate_session` cookie yields

Custom tokens **for that one user** until the session expires (≤30 days) or
is revoked — i.e. full impersonation of that member on every estate surface:
their library/games role via freshly minted sessions, their name on
audiobook reviews. NOT yielded: their Google account, any other user, any
admin console. Handling: `HttpOnly` (no JS read, so XSS can *use* it from a
`*.heygabi.ai` page but not exfiltrate it), `Secure`, `SameSite=Lax`,
opaque id (nothing to decode offline). The trust boundary is: **any XSS on
any `*.heygabi.ai` origin can silently obtain tokens for the visitor** —
same-site is one security domain now. At household scale, with no
third-party scripts anywhere on the estate (the apex CSP's whole posture),
this is accepted; it is the same boundary the shared Firebase project
already draws.

### 7.2 What a stolen signing key yields — the big one

Custom tokens **for any uid** → impersonation of anyone, including the
owner → the admin API approves/revokes on the attacker's word. This key is
strictly stronger than any existing Worker secret and must be named as such.
Bounds: it is NOT a Firestore-admin credential (zero IAM roles; a
custom-token session is an ordinary user session, subject to rules and
Worker checks like any other) and NOT project admin. Handling: dedicated SA,
key exists only as a Cloudflare secret (write-only after `secret put`),
rotation runbook = create second key → `secret put` → delete first key in
console; disable-the-SA in the Firebase/GCP console is the instant estate-
wide kill for the whole SSO layer, after which per-origin interactive
sign-in still works untouched. This is the credential §9 Q2 asks the owner
to accept — the standing "no Firestore service account in any Worker"
refusal (`identity-and-reviews.md` §3) is about the *Firestore-admin*
credential and stays intact, but the honest reading is that this is the same
*shape* of decision at lower privilege, so it gets the same explicit
consent.

### 7.3 Lifetimes and revocation paths, in one table

| Thing | Lifetime | Killed by |
|---|---|---|
| Custom token | 5 min (mint-to-exchange window; max 60 by spec) | expiry; it is single-use in practice (exchanged immediately) |
| Firebase ID token | 1 h (Google-fixed) | expiry; Firebase console user-disable stops refresh |
| Per-origin Firebase session | indefinite (refresh token) | local sign-out; console user-disable (≤1 h residue) |
| `estate_session` cookie/row | 30 d rolling | sign-out (DELETE /api/session); row revocation in D1; estate-revoke refuses the next mint |
| Worker API access | — | estate directory revoke → ≤10 min via the §3.1 TTL, **unchanged by this design** |

Rate limiting: the session routes sit under the auth Worker's existing
60/min limiter; the mint route is additionally the natural place for a
per-session counter if abuse is ever observed (not built until then).

---

## 8. Phased build plan

Sizes use the measured dispatch calibration (research ~100k; one-subsystem
build ~150–280k). Every phase ends in a shippable state; "abandoned here"
names what a halt costs. Total ≈ 550–700k across 4 dispatches.

| Phase | Work | Size | Abandoned here → |
|---|---|---|---|
| **1 — sign-in reliability** (option a) | Auth Worker: transparent proxy route `/__/auth/*` → `audiobook-catalog.firebaseapp.com` (mounted before the API, no 302s). 🔴 Owner console ×2: authorised domain `auth.heygabi.ai` (verify/add); OAuth client redirect URI `https://auth.heygabi.ai/__/auth/handler`. Then flip `authDomain` per surface (4 repos, one string each), apex `_headers` `frame-src` widened. **Attended phone test** — the §1 pain is the acceptance test | ~120–150k, 1 dispatch | Perfectly fine mid-flip: `authDomain` is per-surface; un-flipped surfaces keep firebaseapp.com. ⚠️ The one ordering hazard in the whole plan: **flipping a surface before the proxy + console steps are live breaks that surface's sign-in** — proxy first, always |
| **2 — session service** (option c, server half) | 🔴 Owner console: create zero-role SA + key → `TOKEN_SIGNER_KEY` secret. Migration `0003_sessions.sql`; routes POST `/api/session`, POST `/api/session/token`, DELETE `/api/session`; WebCrypto RS256 signer; credentialed CORS for the four origins; tests incl. a **real exchange probe** (§10 bullet 1) | ~150–200k, 1 dispatch | Routes idle unused — zero consumers, zero risk. The estate behaves exactly as after Phase 1 |
| **3 — adoption, two dispatches** | Per surface: after interactive sign-in → POST the ID token to `/api/session`; on load with no local session → silent exchange → `signInWithCustomToken`; sign-out → local + DELETE `/api/session`. Dispatch 3a: **apex + audiobook** (`estate-auth.js`; `identity.js` — bootstrap through the existing mirror machinery, *skip when a legacy untagged row exists*). Dispatch 3b: **library + games** (`firebase.ts` each; fix the stale games comment §2 while in the file) | ~150k each, 2 dispatches | Mixed state is the designed rollout state: adopted surfaces share sign-in, the rest behave as today. Nothing breaks, nobody is signed out, no security posture changes |
| **4 — optional polish** | Sessions list + per-device revoke on the apex `/admin` page; single-sign-out semantics if Q4's answer demands more than cookie-clear | ~100k | Never built → sign-out stays "this origin + the cookie", which is livable indefinitely |

Order rules: commit before deploy (both repos' standing rule); each phase's
console steps are 🔴 owner-only; Phase 3a's audiobook half deploys to the
dev lane first per that repo's two-lane rule.

## 8b. PHASE 1 STATUS — apex SHIPPED and OWNER-VERIFIED 2026-08-16

| Piece | State |
|---|---|
| Auth Worker `/__/auth/*` proxy | **LIVE** — `/handler` and `/iframe` both 200 |
| 🔴 Firebase authorised domain `auth.heygabi.ai` | **DONE** (read back via Identity Toolkit admin API) |
| 🔴 OAuth redirect URI `https://auth.heygabi.ai/__/auth/handler` | **DONE** (verified by page reload; note the console page lives under the OTHER Google account — see audiobook_catalog `docs/access/CONSOLE_URLS.md`) |
| Apex `authDomain` flip + CSP `frame-src` widening | **DEPLOYED** |
| **Owner attended sign-in test on heygabi.ai** | ✅ **PASSED 2026-08-16** — the owner signed in successfully after the flip. This is the acceptance gate §8 named |
| audiobook / library / games `authDomain` flips | **NOT DONE** — deliberately held back until the apex proved the path. Now unblocked |

⚠️ Still not exercised: the §15 two-tab test (apex session surviving while
`audiobooks.heygabi.ai` runs its own `signOut()`), and Phase 2's real token
exchange (needs `TOKEN_SIGNER_KEY`, an owner console step).

Rollback for any flipped surface stays one string + a redeploy; the CSP
widening is safe to leave in place regardless.

## 9. Owner decision points

> ✅ **ALL APPROVED BY THE OWNER 2026-08-16** ("I'm plenty awake, run the
> project as a whole"), after being told Q2's tradeoff in plain terms — a
> deliberately zero-role signing key that can nonetheless impersonate any
> estate user. Every recommendation below is therefore the DECISION: Q1 yes
> (the `estate-auth-design.md` §10 no-central-session row is overturned; §6
> governs), Q2 yes **with the rotation runbook written into
> `docs/access/estate-auth.md` at build time — that runbook is a build
> deliverable, not a follow-up**, Q3 yes, Q4 local + cookie-clear, Q5 yes
> with the legacy-mirror guard, Q6 30-day rolling. Build proceeds phases
> 1→4 per §8, owner console steps 🔴 at each gate.
> ⚠️ §8's ordering hazard stands regardless of approval: the Phase 1 proxy
> and its console steps must be LIVE before any surface flips `authDomain`,
> or that surface's sign-in breaks.

| # | Question | Recommendation |
|---|---|---|
| 1 | **Approve overturning `estate-auth-design.md` §10's "no central session/cookie" row** (§6). This is the go/no-go for Phases 2–3 | **Yes** — the cookie is convenience-only; enforcement is untouched. Declining = ship Phase 1 only, live with 4 taps/device (§4.4) |
| 2 | **Accept a signing service-account key in the auth Worker** (§7.2) — the estate's first Google credential in a Worker, deliberately zero-role but able to impersonate any estate user | **Yes**, with the rotation runbook written into `docs/access/estate-auth.md` at build time. Declining = same fallback as Q1; no half-measure exists (every session-sharing design needs either this key or worse) |
| 3 | **Accept the auth Worker as an interactive-sign-in SPOF** (Phase 1 proxy). Outage = new sign-ins fail estate-wide; existing sessions unaffected; rollback = revert one config string per surface | **Yes** — it is the same infrastructure class as everything else, and the alternative (per-surface proxies) multiplies the console surface for nothing |
| 4 | **Sign-out semantics:** clearing the cookie + the local origin, while other origins' already-localised sessions run on (§4.3). Full single-sign-out needs Phase 4's per-origin cookie re-check, which reintroduces the "page signs you out from under another" failure class v1 died of | **Local + cookie-clear**; revisit only if it actually confuses someone. The security-relevant lever is estate revocation, which already works |
| 5 | **Silent sign-in on the audiobook site** — auto-identity (name on reviews) with no tap. Recommended guard: never when a legacy v1 mirror row exists | **Yes, with the guard** — it is the "carries to audiobooks" half of the original complaint |
| 6 | **Cookie lifetime 30 days** (worst-case 7 on iOS, §4.3) | **30 d rolling** — a household device re-tapping monthly is the right nuisance level |

## 10. Sources, and what was NOT verified

Read 2026-08-14: `estate-auth-design.md` (whole, incl. §3.1/§4.4/§7.2/§10/
§14–15); `sites/heygabi-home/public/assets/estate-auth.js` + `_headers`;
`audiobook_catalog/site/identity.js` (v2); both catalogs'
`apps/web/src/lib/firebase.ts`; `apps/auth-worker/src/index.ts` +
`wrangler.toml`. Web (2026-08-14): Firebase *redirect-best-practices* (the
five options; Option 3 proxy requirements) and *create-custom-tokens*
(claims, `aud` string, 1 h max, no-IAM-permission key signing); Chrome
storage-partitioning docs (eTLD+1 key + ancestor bit).

**Not verified, explicitly — each is a named build-time probe:**

- **The custom-token round trip end-to-end on THIS project**: that an ID
  token minted from a `signInWithCustomToken` session carries
  `email` + `email_verified: true` for a Google-originated account — the
  Worker verifiers refuse without them. Expected yes (they are account
  facts, not sign-in-method facts), but Phase 2's test suite must prove it
  with a real exchange before any surface adopts.
- **WebKit same-site subdomain frame storage** (§3.1 bullet 3) — only
  matters if (b) is ever revisited; unused by the recommendation.
- **iOS cookie-lifetime behaviour** for server-set `.heygabi.ai` cookies
  (§4.3 footnote) — observe on the owner's phone during Phase 3, not
  before.
- **Whether `auth.heygabi.ai` is already a Firebase authorised domain** —
  the §14.1 instruction predates the admin UI moving to the apex; check the
  console during Phase 1 rather than assuming either way.
- **Neither production D1 nor Firestore was read**; nothing here needed
  them.
