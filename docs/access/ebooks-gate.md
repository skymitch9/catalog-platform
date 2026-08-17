# Ebook permission gate — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (secret and
> resource NAMES only, never values — this repo is public on GitHub).
> Last verified: **2026-08-17** — written at build time, every figure below
> measured live on that date unless marked otherwise.
> ⚠️ **AMENDED the same day**: the per-person download checkbox this doc first
> described was superseded by a role floor a few hours after it shipped (§3).
> Companions: `docs/info/estate-auth-design.md` §4.5 (the visibility layer),
> `docs/info/role-capability-map.md` (the NORMATIVE role/capability map — the
> download row lives there), `docs/info/ebook-split-design.md` (why the pool has
> its own address), `audiobook_catalog/docs/info/SITE_DATA.md` (what is in the
> manifest).

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
| `download` capability | `apps/audiobook-worker/src/capabilities.ts` | **The download grant.** Floor `admin` on the site-roles ladder. ⚠️ Replaced the per-person checkbox 2026-08-17 — see §3. |
| `dl_ebooks` column | `apps/auth-worker/migrations/0009_dl_ebooks.sql` | ⚠️ **DEPRECATED AND UNREAD** since 2026-08-17 (migration `0010` records why it was left standing). Nothing SELECTs it. |
| **Audiobooks/Ebooks** row — two view checkboxes, one role dropdown | `sites/heygabi-home/public/admin/` | The UI. ⚠️ **Merged 2026-08-17** (owner: *"just make it Audiobook/Ebooks"*), then reshaped into the per-member **permission grid** the same day. Still **no download toggle** — and no download TAG either: the owner removed that (*"it looks bad and idk what its trying to tell me"*), so the fact now rides the row's derived *what that role can do* line at the `admin` rung. Grammar: `docs/access/estate-auth.md` §9. |
| `GET /api/ebooks/manifest` | `apps/audiobook-worker/src/ebooks.ts` | **The gate.** Verifies the token, requires `ebooks` visibility, serves the manifest. |
| `ebooks-gated` R2 bucket | Cloudflare account `113be82b…` | The private store. Key: `ebooks.json`. |
| `scripts/publish_ebooks_manifest.py` | `audiobook_catalog` | The publisher (sync **step 5.8**). |
| The shim | `audiobook_catalog/app/web/templates/ebooks.html` | The bookshelf, unchanged, fetching the gated endpoint with a bearer. |
| `ebooks-door` | `apps/ebooks-door` | ⚠️ A dumb proxy for the pretty address. **Not the lock.** |
| `dev_access` column | `apps/auth-worker/migrations/0011_dev_access.sql` | ⚠️ **A CURTAIN, NOT A LOCK** (owner 2026-08-17: *"manage dev access for ebook… make devops always able to see dev envs"*). Decides only whether the **`/dev/` lane's ebook pages draw themselves**. `vis_ebooks` above remains the only thing gating the manifest and the bytes, **on both lanes**, and must never be relaxed because someone holds this. Grammar: `docs/access/estate-auth.md` §10. |

## 3. Granting and revoking (UI first — the owner's standing rule)

⚠️ **ONE ROW NOW, NOT TWO** (owner order 2026-08-17, verbatim: *"instead of a
new line for ebooks in the auth page, just make it Audiobook/Ebooks. also they
should both be plural."*). The member card carries a single
**Audiobooks/Ebooks** line: two visibility checkboxes (**Audiobooks visible**,
**Ebooks visible** — still `vis_audiobook` and `vis_ebooks`, still two
independent grants), the site-role dropdown that governs both shelves, and the
download note. Nothing about the wire changed; the two rows were one surface
described twice, which meant two places to look for one answer.

**Grant:** `https://heygabi.ai/admin/` → find the person → the
**Audiobooks/Ebooks** row → tick **Ebooks visible**. That is the whole grant,
and it includes reading.

**Download: there is no download checkbox. Promote them.** Owner directive
2026-08-17, verbatim: *"For ebooks I don't want a download check box, I want to
use roles we have. Set up the roles to match library."*

The role dropdown on that **same row** → set **admin**. That is the entire
download grant, and demoting them is the entire revocation. The note beside the
dropdown (`download: admin+ role`) says so in place of the toggle that used to
be there.

⚠️ **The two grants are independent and BOTH are needed to download.**
Visibility is checked first, on every request:

| They have | They can |
|---|---|
| `visible` only | browse the shelf, read in the browser viewer — **no file** |
| audiobook `admin` only | nothing — they never reach a shelf to download from |
| both | read **and** download |

⚠️ A per-person `dl_ebooks` checkbox existed for ONE DAY (2026-08-16 → 08-17).
If you find a reference to it, or to `POST /api/estate/users/:id/download-ebooks`,
that reference is stale — the route is deleted and the column is unread.

**Revoke:** un-tick **Ebooks visible** on that row (⚠️ *not* **Audiobooks
visible** beside it — same line, different shelf). Takes effect within the estate's revocation
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

⚠️ **The `dl_ebooks` column below is listed for the record only — it is no
longer read by anything.** Download is the audiobook `admin` rung now (§3).

| Email | `vis_ebooks` | audiobook role | Can download? |
|---|---|---|---|
| `nbaslamking@gmail.com` | 1 | owner (OWNER_EMAILS) | ✅ |
| `mitchlandtv@gmail.com` | 1 | owner (OWNER_EMAILS) | ✅ |
| `asprint200@gmail.com` (Amber) | 1 | none (guest) | ❌ read only |
| `samantha.hardman82@gmail.com` | 1 | contributor | ❌ read only |
| every other row (8 of them) | 0 | — | ❌ no shelf at all |

⚠️ **NOT re-measured after the rework.** The `vis_ebooks` and audiobook-role
columns are carried from the 2026-08-17 build-time snapshot
(`docs/info/role-capability-map.md` §"Who holds what today"); the **Can
download?** column is DERIVED from those two by the new rule, not observed live.
Re-read the admin page if an exact answer matters.

**Nobody's access actually changed on 2026-08-17.** Under the old rule download
resolved as `dl_ebooks = 1 OR is_approver = 1 OR OWNER_EMAILS`, and `dl_ebooks`
was 0 on every row — so in practice it meant owners-and-approvers. Under the new
rule it is audiobook `admin+`, which the same two owner accounts hold. The
rework replaced the *mechanism*; on today's data it grants the same people.

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
did not shake it loose, and **re-measured 81 minutes later it had still not expired** (`Age: 4874`) — on both `/ebooks.json` and `/dev/ebooks.json`. Do not wait it out; purge it. **The fix is an owner action** (wrangler has no purge
command and the session token holds `zone (read)` only): Cloudflare dashboard →
the `heygabi.ai` zone → **Caching → Configuration → Purge Custom URL**, for
both `https://audiobooks.heygabi.ai/ebooks.json` and
`https://audiobooks.heygabi.ai/dev/ebooks.json`.

**`ebooks-door` is not the lock, and adding rules to it would protect
nothing.** The manifest is not on its path at all. Deleting the Worker closes a
pretty address and changes nothing about who can read the shelf.
