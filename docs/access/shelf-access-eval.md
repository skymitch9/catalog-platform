# Shelf access — who gets in, and how to check or change it

> **Audience:** the conductor / devops, then the owner. **Status:** TRACKED
> (this repo is PUBLIC — key NAMES only, never values).
> **Last verified: 2026-10-15** — measured that day: both routes live on
> `auth.heygabi.ai` (keys URL served the `shelf-eval-2026-10` public key; a
> garbage token to evaluate was refused 403). ⚠️ **NOT verified:** a real
> Cloudflare Access login through the rule (nobody can mint an Access token by
> hand — the conductor's real login is that test), and the Access policy
> itself, which this build did not touch.
> Design: `bookbuddy/audiobook_catalog/docs/info/ROLES.md` §3b. Code:
> `apps/auth-worker/src/access-eval.ts`.

## What it is

The audiobook shelf's Cloudflare Access policy asks the estate directory at
every login instead of holding a copied email list (**External Evaluation**).
Rule: **allowed iff the email has an `estate_user` row with
`status='approved'` AND the audiobook grant (`vis_audiobook=1`).** Everything
else is denied — pending, revoked, unknown, a bad token, a D1 error.

So to let someone onto the shelf: approve them on <https://heygabi.ai/admin>
with the audiobook grant on. To remove them: revoke, or turn the grant off.
Takes effect at their next Access login (Access session length applies).

## The two URLs (paste these into the Access rule)

| Field in the Access rule | URL |
|---|---|
| Evaluate URL | `https://auth.heygabi.ai/api/access/shelf/evaluate` |
| Keys URL | `https://auth.heygabi.ai/api/access/shelf/keys` |

No CORS, no session sign-in on either — Cloudflare calls them, not a browser.
The Access JWT's signature (team certs at
`https://wispy-snowflake-2801.cloudflareaccess.com/cdn-cgi/access/certs`) is
the authentication. Both are under `/api`, so the per-IP rate limiter
(60/min) covers them.

| Evaluate answers | Meaning to Access |
|---|---|
| 200 `{token}` signed, `success:true`, nonce echoed | allow |
| 200 `{token}` signed, `success:false` | deny (pending / revoked / unknown / no grant / D1 error) |
| 403 `bad_token` | deny — the incoming token did not verify (signature, kid, expiry, shape) |
| 503 `signing_key_unset` | deny — the signing secret is missing, nothing can be signed |

## ⚠️ The break-glass rule

Because this fails CLOSED, a Worker outage or a missing secret denies
everyone. **A separate static Access policy holding ONLY the owner's email
must always sit beside the External Evaluation rule** on the shelf apps, so
the owner can never be locked out. Do not remove it when the email list goes.

## The signing key

| | |
|---|---|
| Secret NAME | `ACCESS_EVAL_SIGNING_JWK` (Worker secret on `estate-auth`) |
| What it is | RSA-2048 private key as a JWK with its `kid` |
| Current kid | `shelf-eval-2026-10` |
| Custody | **Worker secret only.** No copy anywhere, and none needed |
| Public half | Derived at runtime from the secret and served at the keys URL — one value, so the served key can never disagree with the signer |

**Rotate / re-mint** (also the recovery step if the secret is ever lost):

```bash
# from apps/auth-worker, Git Bash; write the file ONLY in a scratch dir
node -e "const {generateKeyPairSync}=require('crypto');const fs=require('fs');const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});fs.writeFileSync(process.argv[1],JSON.stringify({...privateKey.export({format:'jwk'}),kid:'shelf-eval-YYYY-MM'}))" "$SCRATCH/eval-jwk.json"
npx wrangler secret put ACCESS_EVAL_SIGNING_JWK < "$SCRATCH/eval-jwk.json"   # file redirect, never a PowerShell pipe (BOM)
rm "$SCRATCH/eval-jwk.json"
curl -sS -D - https://auth.heygabi.ai/api/access/shelf/keys   # shows the NEW kid
```

Use a NEW kid each time. Access fetches the keys URL to verify answers, so
the swap needs no Access change. ⚠️ Not measured: how long Access caches our
JWKS — if logins fail right after a rotation, wait a few minutes; the owner's
break-glass policy covers the gap. Then verify with one real shelf login.

## Reading the decision log (shadow phase)

Every decision is written to the worker-event ring as worker
**`estate-auth/shelf-eval`** (its own ring, 200 rows, so it never evicts
`estate-auth`'s errors): `info` = allow, `warn` = deny, message
`shelf ALLOW|DENY <email> — <reason>`, `detail` JSON `{email, success, reason, why}`.
Reasons: `approved`, `pending`, `revoked`, `not-approved` (approved but no
audiobook grant), `unknown` (no row), `bad-token`, `error`. The token is never
logged.

- On the page: `/status` → the event ring (devops sign-in). ⚠️ The page shows
  the newest 100 rows across ALL workers, so on a busy login day the ALLOW
  rows can push other workers' events off the page view (not out of storage
  — each worker keeps its own 200). Household scale makes this small; once
  the shadow phase is over, consider logging only DENY rows to the ring.
- From the CLI (from `apps/auth-worker`):
  ```bash
  npx wrangler d1 execute estate_auth --remote --command \
    "SELECT at, level, message FROM worker_events WHERE worker='estate-auth/shelf-eval' ORDER BY id DESC LIMIT 50"
  ```
- Live stream: `npx wrangler tail estate-auth` — each decision also logs a
  `{"event":"shelf_eval",…}` line.

**Before removing the email list from the policy:** every `DENY` in the ring
for an email that SHOULD have access is a false denial. Zero of those across
real logins is the gate.

## Probes

`npm run probe:estate` rows `auth:A45` (keys serves only public fields),
`auth:A46` (garbage token → 403, nothing signed), `auth:A47` (no CORS on
evaluate).
