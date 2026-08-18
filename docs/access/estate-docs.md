# Estate docs corpus (`estate-docs-gated`) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (this repo is PUBLIC on
> GitHub — resource and secret NAMES only, never values).
> Last verified: **2026-08-18**.

*How to publish, verify, read and roll back the estate's searchable docs
corpus.* For how and why it is shaped this way, see
[`../info/gabi-docs-assistant-design.md`](../info/gabi-docs-assistant-design.md)
— **§10 is the as-built account.** This file does not repeat it.

---

## 1. What this is, in one paragraph

Every `docs/**/*.md` file in `catalog-platform`, `library_catalog` and
`audiobook_catalog`, published as **one gzipped object** in a private R2 bucket
and served — search and read, section by section — by three devops-gated routes
on the auth Worker. It backs <https://heygabi.ai/docs/> today and GABI's Discord
tools when phases 3–4 land.

⚠️ **The corpus is PII plus an operations runbook.** Secret NAMES and where they
live, deploy and rollback levers, break-glass SQL, the `/admin` grant grammar,
and household members' email addresses and role assignments. It is exactly the
material the gate exists for.

---

## 2. The pieces

| Piece | Name | Notes |
|---|---|---|
| Bucket | `estate-docs-gated` | private; created 2026-08-18 |
| Objects | `snapshot.json.gz`, `receipt.json` | one each, replaced whole |
| Binding | `ESTATE_DOCS` on `apps/auth-worker` | read-only in intent |
| Publisher | `audiobook_catalog/scripts/publish_docs_snapshot.py` | ⚠️ runs on the OWNER'S MACHINE only |
| Publisher state | `audiobook_catalog/scripts/.docs_published.json` | gitignored |
| Pipeline step | STEP 9 of `sync_to_drive.py`, busy **and** idle paths | soft; a failure is one WARN |
| Routes | `GET /api/estate/docs/{search,section,receipt}` | `requireDevops()` |
| Page | <https://heygabi.ai/docs/> | devops-gated, content-free shim |

⚠️ **`ESTATE_DOCS` (R2, this) is NOT `estate_docs` (KV).** The KV namespace
serves hand-curated runbook *pages* by slug for `/runbooks/*`; this serves the
searchable *corpus*. Same near-name, different stores, both bound on the same
Worker. Do not merge them.

---

## 3. Commands

Run from `audiobook_catalog` — it is the only checkout where all three docs
trees exist (`audiobook_catalog/docs/` is gitignored and lives nowhere else).

| Do | Command |
|---|---|
| Publish if changed | `python -m scripts.publish_docs_snapshot` |
| Say what would happen | `python -m scripts.publish_docs_snapshot --dry-run` |
| Re-upload regardless | `python -m scripts.publish_docs_snapshot --force` |
| Name every included file | `python -m scripts.publish_docs_snapshot --verbose` |
| Enforce the scanner (see §5) | `python -m scripts.publish_docs_snapshot --scanner enforce` |
| Write the artefacts locally | `python -m scripts.publish_docs_snapshot --dry-run --out <dir>` |

Exit 0 = the bucket holds the current snapshot. Exit 1 = it does not, and the
**previous objects still stand** — a refused or failed run never leaves a
partial corpus.

`$env:PYTHONIOENCODING='utf-8'` first on PowerShell; the console output carries
`⚠️` and `§`.

---

## 4. Verifying

```
npx wrangler r2 bucket dev-url get estate-docs-gated
```

⚠️ **Must answer "Public access via the r2.dev URL is disabled."** If it ever
does not, that is an incident: the corpus is fetchable by anyone who guesses a
key, and the gate is bypassed entirely. **Never attach a custom domain either.**

Routes, unauthenticated — each must answer `401` with a worded `detail`:

```
curl https://auth.heygabi.ai/api/estate/docs/search?q=revocation
curl https://auth.heygabi.ai/api/estate/docs/receipt
```

`npm run probe:estate` covers this as **auth A36–A39** (A39 is the
routing-order probe — see §6).

Live, signed in as a devops-class account: <https://heygabi.ai/docs/>, type
*revocation delay*. The top hit should name the file **and** the section, and
the strip under the title should carry the snapshot's publish date **before you
type anything**.

The complete included-file list is `GET /api/estate/docs/receipt` — that is what
makes a *directory* allowlist auditable, and it is the first place to look if
something appears in the corpus that should not.

---

## 5. The scanner, and the one flag that matters

The publisher refuses to publish if a file looks like it carries a credential.
It is in **SHADOW** today: findings are logged, the publish proceeds.

| Mode | How | Behaviour |
|---|---|---|
| shadow (default) | — | logs would-refuse, publishes |
| enforce | `--scanner enforce` or `DOCS_SCANNER_MODE=enforce` | refuses, exit 1 |
| emergency hatch | `ALLOW_SUSPECT_DOCS=1` (enforce only) | publishes anyway, loudly |

⚠️ **Do not flip to enforce inside the pipeline** until a week of clean shadow
output has accumulated. A false positive in an unattended 8-hourly job stops the
corpus refreshing with nobody watching. Evidence so far is ONE clean pass
(design §10.4).

⚠️ **It REFUSES; it does not strip.** A stripped doc is a doc GABI answers from,
missing the line that mattered. If it fires: fix the file, never relax the rule
to make it pass. Findings carry path, line and rule and **never** the matched
text.

⚠️ **`audiobook_catalog/docs/access/CREDENTIALS.md` is the first and permanent
entry on the per-file denylist.** Removing that line is not a code change; it is
a decision to publish the estate's credential index.

---

## 6. Gotchas that cost real time

⚠️ **The Worker's route mount order is load-bearing.** `estateDocsRoutes` must be
mounted BEFORE `docsRoutes` in `apps/auth-worker/src/index.ts`. `docs.ts` owns
`/estate/docs/:slug` and its slug pattern matches `search`, `section` and
`receipt` perfectly well; mounted the other way round the whole feature answers
`404 not_found` — a KV miss, which reads as *"that document has not been written
yet"* and nothing at all like a routing bug. Pinned by a unit test and by probe
A39.

⚠️ **The estate R2 API token in `audiobook_catalog/.env` does NOT reach this
bucket.** Measured 2026-08-18: `PUT estate-ebooks` OK, `PUT estate-docs-gated`
AccessDenied — it is scoped to a named bucket list. The publisher's default
transport is `wrangler r2 object put`, which uses wrangler's own OAuth and needs
no new credential, so this blocks nothing. `--transport s3` becomes usable if an
owner adds this bucket to the token (dash → R2 → API tokens).

⚠️ **A stale snapshot is not evidence, and the pipeline is how it goes stale.**
STEP 9 rides the 8-hourly audiobook pipeline; if that pipeline is paused or
disabled the corpus silently stops refreshing. Every answer carries
`snapshot.generated_at`, and past **72 hours** the Worker attaches a worded
warning that the page renders in amber. If someone reports docs that are "wrong",
check the publish date first.

⚠️ **The publisher REFUSES if any of the three docs trees is missing**, rather
than publishing two of three. That is deliberate: a partial corpus would make
GABI answer *"I don't have anything on that"* about a third of the estate while
every dashboard read green. If it fires, the fix is the checkout, or
`DOCS_SNAPSHOT_PLATFORM_ROOT` / `_LIBRARY_ROOT` / `_AUDIOBOOK_ROOT`.

⚠️ **Idempotence is by CORPUS content, not by artefact.** `content_sha()` hashes
each repo's HEAD plus every file's path and text — deliberately not the gzipped
bundle, which carries `generated_at` and therefore changes every run. That exact
bug shipped for one afternoon; see design §10.6.

---

## 7. Rolling back

There is no versioning on these objects — they are replaced whole. To roll back,
**re-publish from the docs you want**: check out the earlier commits in
`catalog-platform` / `library_catalog`, restore `audiobook_catalog/docs/` from
its own backup (⚠️ it is gitignored, so git will not do this for you), and run
the publisher with `--force`.

A bad snapshot is low-stakes by construction: it is read-only reference material
behind a devops gate, nothing consumes it as configuration, and the failure mode
is a wrong answer to a question — not a broken system.
