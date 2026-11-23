# Estate secret-exposure check — 2026-11-19

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (public repo
> — names, paths and counts only; **no value appears here**).
> **Last verified: 2026-11-19 ~07:30–07:50 Phoenix** — every figure below was
> measured in that window. This is a dated AUDIT, a sibling of
> [`secrets-review-2026-08-26.md`](secrets-review-2026-08-26.md), not a living doc.
>
> **The question it answers:** can someone find one of the estate's API keys or
> secret keys in a public file, on a live site, or in the browser console?
>
> **Answer: no live credential was found anywhere that was checked.** One dead
> value is in public history (known since August, rotated).
>
> ⚠️ **WHAT WAS *NOT* CHECKED**
> - **This is a SHAPE scan, not a value search.** It finds strings that look
>   like credentials. A secret in a shape no pattern matches would be missed.
>   The only conclusive test is searching for the actual master values, which
>   means reading `.env` / `.dev.vars`; that was not done.
> - **Whether the leaked `PEER_TOKEN` (below) is still dead** was not re-proved;
>   the 2026-08-25 rotation is quoted from the August review.
> - GitHub Actions run logs, issues, PR bodies, gists and releases; the heads
>   of `audiobook_catalog` PRs 38, 39 and 42 (not fetched locally).
> - Signed-in API response bodies (what DevTools' Network tab shows).
> - `sam.heygabi.ai` (did not resolve). Non-text tracked files (images etc.).
> - `gamebuddy` (no git repo in the workspace folder) and the non-estate repos.
> - The shelf server (`shelf.heygabi.ai`) past its Cloudflare Access login page.
> - Signed-in pages as any member other than the owner; click-through flows
>   (a scan, a key mint on `/status/api`) that might log on action.
> - Whether OneDrive shares any plaintext master (August review §3.4 stands).

## 1. Method

A redacting scanner: for each match it records file, line/commit, pattern name,
value length and an 8-hex sha256 prefix (to tell "same value" from "different
value"). It never prints the match or its line. Lines needing a human read were
shown with every letter and digit masked.

Patterns (19): Anthropic, OpenAI, GitHub, Google `AIza`, Google OAuth client
secret / access / refresh tokens, AWS, PEM private-key markers, Discord webhook
and bot token, JWT, Slack, Stripe, credentials inside a URL, literal `Bearer`,
64-char hex, and any `token|secret|password|api_key|client_id|access_key`
name assigned a 20+ character **quoted** literal.

## 2. Public repos — files at HEAD

All four repos re-confirmed **PUBLIC**.

| Repo | Text files scanned | Verdict |
|---|---|---|
| `audiobook_catalog` | 641 | clean |
| `library_catalog` | 627 | clean |
| `catalog-platform` | 621 | clean |
| `Board_Game_Catalog` | 326 | clean |

- **One `AIza` value in the whole estate** (same hash in every repo, every file,
  all history). It is the Firebase **web** key, public by design. The Google
  Books key, which has the same shape and IS a secret, does not appear.
- Every other hit was read masked and is a test fixture, a secret NAME, a
  localStorage key name, or a `${VAR}` reference (`docker-entrypoint.sh`).
- `.dev.vars.example` files hold placeholders; `library_catalog/apps/worker/.dev.vars.tpl`
  holds 13 `op://` references and 3 empty drop-box lines.
- `wrangler.toml` and workflow files: every credential-named key is a
  `secrets.*` reference or absent. No literal.
- 10 master files (`.env`, 4 `.dev.vars`, the service-account JSON, Drive
  `token.json` / `credentials.json`, `CREDENTIALS.md`, a `keys/*.txt`) each
  measured **ignored AND untracked**. No `.map` or `.wrangler/` file is tracked.
  No untracked-but-unignored credential-looking file in any tree.

## 3. Public repos — full history, every branch

3,389 commits (871 + 1,144 + 1,035 + 339), added lines only.

- 🟡 **One real value:** `library_catalog` `apps/worker/wrangler.toml`, commits
  `79036d3` and `19fe16e` (2026-08-19) — the `PEER_TOKEN` leak the August review
  already recorded, moved to a secret in `fbd619a` and **rotated 2026-08-25**.
  It stays in history forever; that is acceptable only while it stays rotated.
- **No sensitive path was ever added** in any repo's history (`.env*`,
  `.dev.vars*`, `token.json`, `credentials.json`, service-account JSON, `.pem`,
  `.key`, `access/keys/*`, `CREDENTIALS.md`) apart from the `.example` / `.tpl`
  files and `keys/README.md`. Measured with `git log --all --diff-filter=A`.
- **No unquoted `.env`-style assignment** of a `TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY`
  name to a 16+ character value was ever added (the quoted-literal pattern
  would not have seen one).
- Coverage: every remote ref's commit is present locally, except three
  `refs/pull/*/head` refs on `audiobook_catalog` (PRs 38, 39, 42), not scanned.
- Everything else: the same fixtures and names as HEAD, plus 64-hex strings that
  are sha256 checksums, cover filenames, or the Board Game `CF_ACCESS_AUD`
  audience tags (identifiers, not credentials).

## 4. What an anonymous visitor can fetch

350 files pulled without signing in (93 unique after removing fallback pages)
from `heygabi.ai` (incl. `/admin`, `/status/*`), `library`, `padhard`,
`boardgames`, `audiobooks` (prod and `/dev/`), `ebooks`.

- No credential shape other than the Firebase web key and the **Cloudflare Web
  Analytics beacon token** (one 32-hex value on every page; public by design).
- **No source map is served** for any JS bundle (the KI-3 leak route).
- 14 leak paths probed per host (`.env`, `.dev.vars`, `.git/config`,
  `wrangler.toml`, the service-account and Drive token paths, `CREDENTIALS.md`…):
  every response was the site's ordinary HTML fallback page, never a file.
- `auth`, `index`, `discord`, `audiobook-api` answer 404 at the root;
  `boardgames/api/export.json` answers 401 unsigned.
- The docs snapshot goes to the private `estate-docs-gated` bucket and
  `CREDENTIALS.md` is on its permanent deny list (read from the publisher's
  source, not re-tested).
- The "93 unique" count includes fallback-page variants: an unknown path
  returns the site's HTML shell, so a fetched name is not proof a file is served.

## 5. Browser, signed in as the owner

`audiobooks`, `library`, `padhard`, `boardgames`, `heygabi.ai`, `/admin`,
`/status/api`, `/status/agents` — each loaded, then inspected for names and
lengths only.

- **Console:** no message matching any credential shape or the words
  token / secret / key / password. ⚠️ Capture was confirmed working on
  `audiobooks` only (its two `[Reviews]` log lines were read); on the other
  seven pages "no messages" was not separately proven to mean "capture on".
- **localStorage / sessionStorage / JS-readable cookies / page globals / the
  rendered DOM:** no credential shape. Storage holds preferences, reading
  positions and identity display fields.
- **Request URLs:** the only `key=` is Firebase's own sign-in lookup carrying
  the public web key.
- Firebase keeps the signed-in session in IndexedDB. That is the user's own
  session, normal for every Firebase site, and not an estate secret.

## 6. Nothing was changed

Read-only throughout. No secret set, rotated or deleted; no file fixed.
