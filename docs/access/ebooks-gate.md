# Ebook permission gate — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret and
> resource NAMES only, never values — this repo is public on GitHub).
> Last verified: **2026-08-17** — written at build time, every figure below
> measured live on that date unless marked otherwise.
> Companions: `docs/info/estate-auth-design.md` §4.5 (the visibility layer and
> the `download_ebooks` capability), `docs/info/ebook-split-design.md` (why the
> pool has its own address), `audiobook_catalog/docs/info/SITE_DATA.md` (what
> is in the manifest).

## 1. What is live, in one paragraph

Owner directive 2026-08-17: *"ebooks should be like the other site where we
grant permission to view it. I don't want people scraping my books."* The
household's ebook manifest left **both** public surfaces it was on — the
Cloudflare Pages deployment and the **public** `skymitch9/audiobook_catalog`
GitHub repo — and now lives only in a **private R2 bucket**, read through one
bearer-gated Worker route. `ebooks.heygabi.ai` still shows the same bookshelf;
it just has nothing to show until you are signed in **and** hold the estate's
`ebooks` grant.

## 2. The pieces, and which repo each lives in

| Piece | Where | What it does |
|---|---|---|
| `vis_ebooks` column | `apps/auth-worker/migrations/0008_vis_ebooks.sql` | The view grant. `DEFAULT 0`; **not** in the public slice. Includes READING. |
| `dl_ebooks` column | `apps/auth-worker/migrations/0009_dl_ebooks.sql` | The per-person DOWNLOAD grant. `DEFAULT 0`; admin+ hold it computed, never stored. |
| `POST /api/estate/users/:id/download-ebooks` | `apps/auth-worker/src/estate.ts` | Flips the stored half. Approver-gated. |
| Ebooks column + download toggle | `sites/heygabi-home/public/admin/` | The UI. Admin+/owner rows render checked-and-disabled with the reason. |
| `GET /api/ebooks/manifest` | `apps/audiobook-worker/src/ebooks.ts` | **The gate.** Verifies the token, requires `ebooks` visibility, serves the manifest. |
| `ebooks-gated` R2 bucket | Cloudflare account `113be82b…` | The private store. Key: `ebooks.json`. |
| `scripts/publish_ebooks_manifest.py` | `audiobook_catalog` | The publisher (sync **step 5.8**). |
| The shim | `audiobook_catalog/app/web/templates/ebooks.html` | The bookshelf, unchanged, fetching the gated endpoint with a bearer. |
| `ebooks-door` | `apps/ebooks-door` | ⚠️ A dumb proxy for the pretty address. **Not the lock.** |

## 3. Granting and revoking (UI first — the owner's standing rule)

**Grant:** `https://heygabi.ai/admin/` → find the person → the **Ebooks** row →
tick **visible**. That is the whole grant, and it includes reading.

**Download:** the **download** checkbox in the same row. Admin+ and owner rows
show it ticked and disabled — that is correct, not a bug: their download is
computed from their role and no checkbox can take it away. Un-tick their role
instead.

⚠️ **A download grant without the view grant does nothing**, and the row says
so. Visibility is checked first, on every request.

**Revoke:** un-tick **visible**. Takes effect within the estate's revocation
delay — **10 minutes** (`REVOCATION_DELAY_MS`), because the Worker caches the
`/seen` answer per isolate. Instant kill paths, unchanged: revoke the person in
the estate (their effective set becomes `{}` immediately on the next cache
miss), or disable the Firebase account.

**Break-glass (CLI, only when the UI cannot be reached):**

```bash
cd apps/auth-worker
npx wrangler d1 execute estate_auth --remote --command \
  "UPDATE estate_user SET vis_ebooks = 1, decided_at = datetime('now'), decided_by = 1 WHERE email = 'someone@example.com'"
```

⚠️ A direct UPDATE bypasses the route that would normally stamp the decision
honestly. Stamp `decided_at`/`decided_by` yourself, as above, or the row will
claim its last decision was something else.

## 4. Who holds it right now (measured 2026-08-17, seeded by this build)

| Email | `vis_ebooks` | `dl_ebooks` | Note |
|---|---|---|---|
| `nbaslamking@gmail.com` | 1 | 0 | owner (also computed — the flag is belt-and-braces) |
| `mitchlandtv@gmail.com` | 1 | 0 | owner email, approver |
| `asprint200@gmail.com` (Amber) | 1 | 0 | |
| `samantha.hardman82@gmail.com` | 1 | 0 | |
| every other row (8 of them) | 0 | 0 | including `jam4weezer@gmail.com`, who holds `vis_library` |

`dl_ebooks` is 0 for **everyone**: admin+ hold download by role, not by column.
The two owner rows and the one approver therefore *have* download; nobody else
does.

## 5. Publishing the manifest

Runs automatically as **sync step 5.8**, after the covers upload and before the
commit. By hand:

```bash
cd bookbuddy/audiobook_catalog
python -m scripts.publish_ebooks_manifest            # publish if changed
python -m scripts.publish_ebooks_manifest --dry-run  # say what would happen
python -m scripts.publish_ebooks_manifest --force    # re-upload regardless
```

Idempotent by content (sha256 receipt in the gitignored
`scripts/.ebooks_published.json`). ⚠️ It **refuses** to upload a manifest that
breaks the owner's every-EPUB-has-a-cover rule; the previous object keeps
serving, so readers get a stale shelf rather than none. Emergency hatch:
`ALLOW_COVERLESS_EPUBS=1`.

⚠️ **The CI copies of that cover gate now SKIP**, honestly and by construction:
`tests/test_ebook_covers.py` and `audit_site` check 5 read the *committed*
manifest, which no longer exists in a checkout. They still gate on the pipeline
machine, where the file lives, and the publish step is the third place.

## 6. Verifying it, and what each answer means

```bash
# tokenless -> 401 with a sentence, never a bare status
curl -sS https://audiobook-api.heygabi.ai/api/ebooks/manifest

# the whole surface, signed in, is the shim itself
curl -sS https://ebooks.heygabi.ai/ | grep -c eb-gate
```

| You see | It means |
|---|---|
| `401 unauthenticated` | no/invalid token — sign in |
| `403 awaiting_approval` | in the directory, not approved yet |
| `403 access_revoked` | approved once, revoked since |
| `403 no_ebooks_grant` | approved, but the Ebooks switch is off |
| `503 estate_unconfigured` | ⚠️ **our** setup, not their permission — `ESTATE_AUTH_URL`/`ESTATE_APP_TOKEN_AUDIOBOOK` |
| `502 estate_unreachable` | an outage. **Not** a permission failure |
| `503 manifest_store_unbound` | the `EBOOKS_GATED` binding is missing from the Worker |
| `503 manifest_absent` | nothing published yet — run step 5.8 |

## 7. ⚠️ Gotchas that cost real time here

**The repo is PUBLIC, so "remove it from the deployment" is half a fix.** A
tracked `site/ebooks.json` is world-readable at a raw GitHub URL no matter what
the site serves. The file had to leave git as well, and it did.

**The ebook rows in estate search ride the `audiobook` source**, which is the
PUBLIC slice — so before this build an anonymous `/api/search` enumerated the
whole shelf. Gating the page alone would have been cosmetic. Check where a
catalog's rows actually live before believing its scope covers them.

**`ebooks-gated` is a separate bucket from `audiobook-covers` on purpose.**
That one has a public r2.dev URL enabled, so any object in it is fetchable by
anyone who guesses the key. ⚠️ **Never enable a public URL or attach a domain
to `ebooks-gated`.** Check with:

```bash
npx wrangler r2 bucket dev-url get ebooks-gated   # must say: disabled
```

**Cloudflare Pages answers a missing path with the SPA fallback at 200, not a
404.** So `curl .../ebooks.json` returning 200 proves nothing — check the
LENGTH (the fallback is ~9 MB of index.html; the manifest is ~104 KB) or look
at the first byte.

**A removed file can keep serving from the Cloudflare edge cache.** Measured
2026-08-17: after the deploy that stripped it, `audiobooks.heygabi.ai/ebooks.json`
still returned the real manifest with a climbing `Age:` header, while the same
URL **with a cache-busting query** returned the fallback — proving the origin
was clean and the edge was not. A `Cache-Control: no-cache` *request* header
did not shake it loose. **The fix is an owner action** (wrangler has no purge
command and the session token holds `zone (read)` only): Cloudflare dashboard →
the `heygabi.ai` zone → **Caching → Configuration → Purge Custom URL**, for
both `https://audiobooks.heygabi.ai/ebooks.json` and
`https://audiobooks.heygabi.ai/dev/ebooks.json`.

**`ebooks-door` is not the lock, and adding rules to it would protect
nothing.** The manifest is not on its path at all. Deleting the Worker closes a
pretty address and changes nothing about who can read the shelf.
