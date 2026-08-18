# Estate docs corpus (`estate-docs-gated`) — Access Reference

> **Audience:** Claude sessions. **Status:** TRACKED (this repo is PUBLIC on
> GitHub — resource and secret NAMES only, never values).
> Last verified: **2026-08-18**. ⚠️ §§8-10 (the Discord door's credential
> custody, its contract, and the posture switch) landed with phases 3-4 the
> same day.

*How to publish, verify, read and roll back the estate's searchable docs
corpus.* For how and why it is shaped this way, see
[`../info/gabi-docs-assistant-design.md`](../info/gabi-docs-assistant-design.md)
— **§10 is the as-built account.** This file does not repeat it.

---

## 1. What this is, in one paragraph

Every `docs/**/*.md` file in `catalog-platform`, `library_catalog` and
`audiobook_catalog`, published as **one gzipped object** in a private R2 bucket
and served — search and read, section by section — by three devops-gated routes
on the auth Worker. It backs <https://heygabi.ai/docs/> and — since 2026-08-18 — **GABI's two
Discord tools**, through a second door (§9). ⚠️ The Discord half ships **dark**
behind `GABI_DOCS`; see §10.

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

---

## 8. Credentials and custody

⚠️ **NAMES ONLY. This repo is public on GitHub — never a value, never a prefix,
never a length.**

| Secret NAME | Holders | What it opens | Minted | Ships dark? |
|---|---|---|---|---|
| `ESTATE_APP_TOKEN_DISCORD_DOCS` | **2** — `apps/auth-worker`, `apps/discord-worker` | door B onto these three routes, and nothing else | 2026-08-18, conductor (`openssl rand -hex 32` / `crypto.randomBytes`) | yes — unset ⇒ every request falls through to door A |
| `FIREBASE_SERVICE_ACCOUNT` | discord-worker (also auth-worker, poll path) | reading `discord_links/{id}` for the asker's `email` | pre-existing | yes |
| `CLOUDFLARE_API_TOKEN` (R2) | local `.env` | ⚠️ does **NOT** reach `estate-docs-gated` — see §6 | pre-existing | n/a |

### ⚠️ `ESTATE_APP_TOKEN_DISCORD_DOCS` is NOT `ESTATE_APP_TOKEN_DISCORD`

The two names differ by one word and the distinction is load-bearing.

| | `ESTATE_APP_TOKEN_DISCORD` | `ESTATE_APP_TOKEN_DISCORD_DOCS` |
|---|---|---|
| Holders | **3** — discord-worker + **both** library Workers | **2** — discord-worker + auth-worker |
| Opens | the Tier-1 delegated *write* verbs on a catalog | door B onto the docs corpus |
| Leak blast radius | additive catalog writes, stamped and revertible | ⚠️ **the estate's whole operations runbook + PII** |

**Never share one for the other, and never re-mint one to add a holder to the
other.** A secret cannot be read back, so "add the auth Worker to the existing
token" is not an operation that exists — the only way is to re-mint and re-pipe
every holder, which breaks Tier 1 in the window between. That is *why* this is a
new pair, and it is also the general rule: **a fresh trust edge gets a fresh
pair.**

### Minting and rotating

⚠️ **Both holders must receive the SAME value, and the value is never printed,
never pasted into a terminal line, and never written to a file that outlives the
command.**

From `catalog-platform/`, in one shell invocation (Git Bash — no BOM, unlike a
PowerShell pipe):

```
TOK="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
printf '%s' "$TOK" | (cd apps/auth-worker    && npx wrangler secret put ESTATE_APP_TOKEN_DISCORD_DOCS)
printf '%s' "$TOK" | (cd apps/discord-worker && npx wrangler secret put ESTATE_APP_TOKEN_DISCORD_DOCS)
unset TOK
```

⚠️ **On PowerShell, force UTF-8 *without* a BOM before piping.** A PowerShell-piped
secret otherwise picks up an invisible BOM, and a BOM'd bearer fails *while
looking valid* — the same trap `estate-auth.md` §6 records for `TOKEN_SIGNER_KEY`.
`printf` from bash has no such problem, which is why the recipe above is bash.

**Rotation is safe and needs no deploy.** Re-run both `secret put` commands with
a new value; in the seconds between the two, door B simply refuses (the
discord-worker's calls 401 and GABI says the estate could not be reached). Do
**not** rotate while `GABI_DOCS = "on"` if you mind a few refused questions.

### Verifying custody without learning the value

```
(cd apps/auth-worker    && npx wrangler secret list)   # expect ESTATE_APP_TOKEN_DISCORD_DOCS
(cd apps/discord-worker && npx wrangler secret list)   # expect it here too
curl https://discord.heygabi.ai/api/health             # configured.estate_app_token_discord_docs
```

⚠️ **A `true` on that health row is a boolean about a NAME.** It is not proof the
two holders agree — only a real door-B call answering something other than 401
is that. The check that actually proves it is §9's first row.

---

## 9. Door B — the Discord door (design §11.3)

```
GET /api/estate/docs/{search,section,receipt}
  Authorization: Bearer <ESTATE_APP_TOKEN_DISCORD_DOCS>
  X-Estate-On-Behalf-Of: <the asker's PROVEN estate email>
```

| Check | Expect |
|---|---|
| docs token + a devops-class email | `200` + results, `snapshot.generated_at` present |
| docs token + an email not in the directory | `403` *"limited to devops-class members…"* |
| docs token + no `X-Estate-On-Behalf-Of` | `400` *"your link was made before I could check estate roles…"* |
| no bearer | `401` *"…I need to know who you are first."* |
| a wrong bearer | `401` — ⚠️ must NOT say which door it missed |

⚠️ **Both doors end at the same `devopsAllows()`.** Revoke someone's devops in
`/admin` and their next Discord docs question is refused, with no deploy and no
second place to remember.

⚠️ **The holder of the token can name any email.** That is the design (§11.3) and
it is safe only because the discord-worker can send exactly one email — the one
`link.ts` proved server-side. **A future caller must never pass a user-supplied
string in that header.**

### The relink, and the sentence that means it

Links written before 2026-08-18 carry no `email` and **cannot be upgraded from
outside** — owner decision: relink, no backfill. Somebody in that state gets:

> *"Your link was made before I could check estate roles. Re-run /link once and
> I'll be able to answer this."*

⚠️ **That is not a permissions failure and must never be read as one.** The fix is
ten seconds: `/link` in Discord, press the button. `/unlink` first is not
required — the ceremony overwrites.

---

## 10. Turning her on in Discord, and turning her off

`GABI_DOCS` in `apps/discord-worker/wrangler.toml`. **Affirmative-only**: `"on"`
and nothing else; `"true"`, `"1"`, `"yes"` and every typo mean OFF.

⚠️ **It ships `"off"`**, unlike `GABI_DELEGATED_WRITES` which the owner approved
switched on. This corpus is PII plus an operations runbook, so flipping it is
design §7's owner step 4: *"a deliberate act, never a side effect of a deploy."*

**To turn it on:** edit the line to `"on"`, `npx wrangler deploy` from
`apps/discord-worker`, and confirm `gabi_docs_ready: true` on
<https://discord.heygabi.ai/api/health>. **Re-link once first** (§9) or the first
question answers with the relink sentence.

**To turn it off:** the same line back to `"off"` and deploy. One line, no code
change. OFF is not silent — a docs question still gets *"reading the estate docs
from Discord is switched off"* rather than falling through to a shelf search that
finds nothing and reads as broken.

⚠️ **ON IS NOT A GRANT.** Every question is still checked per-asker against the
estate directory. A non-devops household member gets the worded gate and GABI
never sees a byte of the corpus on their behalf.

### The caps, and what a person hears when one bites

| Cap | Value | What she says |
|---|---|---|
| Retrieved bytes per turn | 24 KB | *"I have already pulled as much documentation as I can carry in one answer…"* |
| Sections per turn | 4 | same |
| Docs turns per person per UTC day | 40 | *"I've been through a lot of the docs for you today… it resets overnight"* |

All three are in code (`apps/discord-worker/src/estate-docs.ts`), not config —
changing one is a deploy, deliberately.

### Reading the spend

Every model turn logs one `gabi_turn` line carrying `docs_sections` and
`docs_bytes` beside the raw token counts:

```
npx wrangler tail estate-discord --format json | jq 'select(.evt=="gabi_turn" and .docs_sections>0)'
```

⚠️ **The retrieved TEXT is never logged — only how much of it there was.** A log
stream has a wider audience than the gate does; logging runbook content there
would put it in a second place with weaker protection than the first.
