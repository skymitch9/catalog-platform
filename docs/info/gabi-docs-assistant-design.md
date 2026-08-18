# GABI reads the estate docs — design

> **Audience:** Claude sessions + the owner. **Status:** TRACKED (this repo is
> public on GitHub — resource and secret NAMES only, never values).
> Last verified: **2026-08-18**. **ALL SIX PHASES ARE BUILT AND DEPLOYED.**
> §10 is the as-built for phases 1/2/5/6; **§11 is the as-built for phases 3
> and 4** — the Discord door and GABI's two docs tools. ⚠️ Phase 4 ships
> **dark** behind `GABI_DOCS`, which is one owner flip (§7 owner step 4).
> Figures marked *measured* were taken on this machine on 2026-08-17 unless a
> later date is given. **§10 and §11 are the as-built account**, and where the
> build departed from this design they say so there rather than by silently
> editing the paragraph that turned out to be wrong.

Owner brief, verbatim (2026-08-17): *"let's make sure GABI can read all of our
docs and stuff so she can even help me if needed for let's say I don't have a
Claude code session open."*

Companions — read these, this doc deliberately does not repeat them:
[`gabi-application-map.md`](gabi-application-map.md) (the T0–T4 ladder; this is
build-order item 5), [`discord-bot-design.md`](discord-bot-design.md) §6–§7 (the
mention/DM surface, the allowlist idiom, the memory shape),
[`../access/estate-auth.md`](../access/estate-auth.md) §9–§10 (the flags),
[`../access/ebooks-gate.md`](../access/ebooks-gate.md) (the gated-R2 idiom this
mirrors, in full).

---

## 0. The architecture in one paragraph

A **publisher script on the owner's machine** walks an explicit allowlist of
three `docs/` trees, refuses outright if anything looks like a credential,
writes a receipt naming every file it included, and uploads **one gzipped
bundle** to a new private R2 bucket. A **new pair of routes on the auth Worker**
— which already owns `requireDevops()` and the `estate_docs` idiom — fetches
that bundle once per isolate, holds it in module scope, and answers two
questions over it: *search* (grep-like, returns section headings and short
snippets) and *read* (returns one bounded section). Both routes are
**owner/devops-class only**, enforced in the auth Worker and nowhere else, and
answerable through **two doors**: a Firebase ID token (the site) or an app
token plus a proven email (Discord). GABI holds no permission of her own — she
asks on the caller's behalf, exactly as §1 of the application map requires. Every
answer she gives carries the snapshot's publish date, so a stale snapshot is
visible in the reply rather than silently believed.

Why one bundle rather than a search engine: **measured 2026-08-17, the whole
corpus is 3,045,611 bytes of Markdown across 116 files.** Gzipped that is
comfortably under 1 MB — a single R2 GET on a cold isolate, and a literal
substring scan over 3 MB is milliseconds of Worker CPU. An inverted index, D1
FTS5, or a vector store would each be more machinery than the numbers justify;
see §5.4 for the tripwire that says when this stops being true.

---

## 1. The docs landscape (all figures measured 2026-08-17)

| Repo | `docs/` files (`.md`) | Bytes | Tracked in git? | Repo visibility |
|---|---:|---:|---|---|
| `catalog-platform` | 37 | 1,071,864 | **Yes**, all | **Public** |
| `library_catalog` | 40 | 1,189,891 | **Yes** (40 paths in `git ls-files docs`) | Public |
| `audiobook_catalog` | 39 | 783,856 | ⚠️ **NO — `git ls-files docs` returns ZERO.** `.gitignore:7` ignores `docs/` wholesale; only `docs/deploys.log` is negated back | **Public** |
| **Total** | **116** | **3,045,611** | | |

Two facts do the shaping:

1. ⚠️ **`audiobook_catalog/docs/` exists only on this machine.** That repo is
   public and its docs are gitignored *on purpose*. `docs/access/CREDENTIALS.md`
   lives there. Nothing that reads from a git clone can see these docs, which is
   precisely why the publish step has to run locally (§2.2) — it is the only
   place where all three trees exist at once.
2. **Roughly a third of the corpus is archive.** The four largest files measured
   are `library_catalog/docs/DONE.md` (323 KB), `library_catalog/docs/FABLE5.md`
   (157 KB), `audiobook_catalog/docs/DONE.md` (157 KB) and
   `catalog-platform/docs/DONE.md` (141 KB) — 778 KB, a quarter of everything,
   in four files. That is *why* retrieval must be section-level: a whole-file
   answer would be 80k tokens for one question.

**Non-`.md` files in the three trees** (measured, the complete list): two
`deploys.log`, `DRIVE_AUDIT_REPORT.csv`, `drive-exceptions.json`,
`permission-snapshot-2026-08-17.json`, `SHELF_MIGRATION.fragment.html`,
`SHELF_SERVER.fragment.html`. Two of those are permission/exception data about
real people. **The `.md`-only rule in §3 excludes all seven by construction** —
that is the rule's first job, not a side effect.

**Heading count: 2,176** H1–H3 across the corpus (measured). That is the natural
chunk count — see §5.2.

---

## 2. The snapshot

### 2.1 What is published

An **explicit allowlist of three (repo, directory) pairs**, `.md` only,
recursive:

| # | Source | Notes |
|---|---|---|
| 1 | `catalog-platform/docs/**/*.md` | includes `info/`, `access/`, `diagrams/`, `TODO.md`, `DONE.md` |
| 2 | `library_catalog/docs/**/*.md` | same shape |
| 3 | `audiobook_catalog/docs/**/*.md` | ⚠️ local-only; the reason this runs here |

A fourth pair is added by editing the array, never by walking a parent
directory. Anything not on the list — `node_modules`, `site/`, a sibling repo, a
new repo — is absent because it was never reachable, not because a filter caught
it.

### 2.2 How, and where it runs

⚠️ **The publish step runs on the owner's machine.** Not in CI, not in a Worker,
not from a checkout. `audiobook_catalog/docs/` does not exist anywhere else, and
a CI-published snapshot would silently contain two-thirds of the estate while
appearing complete — the worst possible failure for a docs assistant.

**Recommended host: a new script in `catalog-platform`,**
`scripts/publish-docs-snapshot.mjs` (Node), sitting beside `backup-r2.mjs` and
`backup-firestore.mjs`. Reasons, in order: this repo owns the Worker and the
bucket binding, so config and consumer live together; it is tracked and
reviewable, unlike anything in `audiobook_catalog/docs`; and its neighbours
already know how to talk to R2.

**Recommended transport: shell out to `wrangler r2 object put`.**
`backup-r2.mjs`'s own header records the relevant measurement (checked
2026-08-15, wrangler 4.123.0): `wrangler r2 object` has `get`/`put`/`delete` and
only lacks `list`. A publisher only ever puts. Taking the wrangler path means
**no new credential and no new API-token permission group**; the plain
Cloudflare REST route would need "Workers R2 Storage **Write**" added to
`CLOUDFLARE_API_TOKEN` (the read group was itself a manual owner step on
2026-08-15 — see `backup-r2.mjs`'s header). Reasoned, not measured: nobody has
run a put through either path for this bucket yet.

**Invocation, two ways, same script:**

- **By hand** — `npm run docs:publish` (plus `--dry-run` and `--force`, mirroring
  `publish_ebooks_manifest.py`'s flags verbatim).
- **On the pipeline's back** — as **STEP 9** of `audiobook_catalog`'s
  `scripts/sync_to_drive.py::run_pipeline`, called by absolute path
  (`node <catalog-platform>/scripts/publish-docs-snapshot.mjs`). That pipeline
  already runs every 8 hours on this machine under the `AudiobookSyncPipeline`
  scheduled task (`audiobook_catalog/docs/access/PIPELINE.md`), and STEP 5.7 /
  5.8 are the exact precedent: **own failure domain, a failure is one WARN, the
  previously published object keeps serving, the next cycle retries.**

⚠️ **The coupling gotcha, stated up front:** hanging an estate-wide job off the
audiobook pipeline means that if that pipeline is paused, disabled, or failing
early (it exits at "Nothing to upload" before STEP 5 on a quiet cycle — see
`PIPELINE.md`'s `--rebuild-only` note), **the docs snapshot silently stops
refreshing.** Two mitigations, both required: run the publish in the pipeline's
**idle path too** (STEP 8 already does this, and is the model), and make
staleness visible in every answer (§6). The alternative — a fourth Windows
scheduled task, `EstateDocsPublish`, daily — is one more moving part but has no
coupling; it is the fallback if STEP 9 proves flaky.

**Idempotent by content**, exactly like the ebooks publisher: sha256 of the
bundle, receipt written to a gitignored `scripts/.docs_published.json`, upload
skipped when unchanged. `--force` re-uploads regardless.

### 2.3 Where it lands

| Piece | Name | Notes |
|---|---|---|
| Bucket | **`estate-docs-gated`** (new, private) | mirrors `ebooks-gated`. ⚠️ **Never enable a public r2.dev URL or attach a domain**, for the same reason `ebooks-gate.md` §7 gives about `audiobook-covers`. Verify with `npx wrangler r2 bucket dev-url get estate-docs-gated` — must say **disabled** |
| Object | `snapshot.json.gz` | one object, gzipped, the whole corpus + metadata |
| Object | `receipt.json` | the included-file list (§3.4), tiny, same bucket |
| Binding | `ESTATE_DOCS` on `apps/auth-worker` | R2 binding in `wrangler.toml` + `env.ts` |

**Why R2 and not the existing `estate_docs` KV namespace** (which `docs.ts` and
`facts.ts` already share): KV is right for *"a small admin-only blob keyed by
slug"*, which is what those two routes serve. This is a 3 MB corpus republished
as a unit; a KV rewrite would be ~116 keys with eventual consistency and no
atomic swap, where R2 is one put. The two coexist happily — `docs.ts` keeps
serving hand-curated runbook *pages*, this serves the searchable *corpus*.

**Bundle shape** (reasoned; pin it in the publisher's header when built):

```
{ generated_at, git: {<repo>: <short sha or "untracked">}, files: [
    { path: "catalog-platform/docs/info/estate-auth-design.md",
      title: "<first H1>", bytes: 81416,
      sections: [ { heading, level, start, end } ],   // byte offsets into text
      text: "<the whole file>" } ] }
```

Sections are cut at **H2** boundaries, further split at H3 when a section
exceeds 8 KB, and a leading pre-first-heading preamble counts as a section. This
is what makes the 323 KB `DONE.md` answerable.

### 2.4 Cadence

Every 8 hours if STEP 9 lands, on demand by hand, and unconditionally after any
session that changes docs (the owner's standing "docs updates need no
permission" rule means docs move often). ⚠️ **The cadence is a target, not a
guarantee** — §6 exists because it will sometimes be missed.

---

## 3. The redaction line

### 3.1 The decision

**A directory allowlist, an extension allowlist, an explicit per-file denylist,
a fail-closed content scanner, and a published receipt.** Four mechanisms, and
the reason there are four is that each covers a different failure:

| Layer | Default | Catches |
|---|---|---|
| 1. Directory allowlist (§2.1) | **deny** | a whole repo, or a non-`docs/` tree, arriving by accident |
| 2. Extension allowlist — `.md` only | **deny** | the seven non-`.md` files measured in §1, including two that carry real people's permission data |
| 3. Per-file denylist | deny-listed | ⚠️ **`audiobook_catalog/docs/access/CREDENTIALS.md` — excluded entirely, first and permanent entry.** Its role is to be the one place credential locations are written down; nothing that leaves this machine should carry it, and no gate is worth betting that file on |
| 4. Content scanner | **fail the publish** | a credential value pasted into any other doc, by anyone, at any time |
| 5. Receipt | — | drift: the allowlist quietly including something nobody meant |

### 3.2 Why not a pure per-file allowlist

The estate's export rule is *default-deny, allowed fields as an explicit array,
never SELECT-*-minus-exclusions*, and that rule is honoured here at the layers
that matter: the repos and the file types are both explicit arrays.

Taking it down to **individual files** was considered and rejected, on a
measured basis: 116 files today, growing by roughly one per working session.
An allowlist at that granularity fails **open on omission** in a way that looks
identical to a bug — the newest, most relevant doc is the one most likely to be
missing, and GABI would confidently answer from six-week-old text. Weigh that
against the exposure of a miss in the other direction: the reader set is the
owner plus devops (measured: **4 people hold devops-or-above today** per
`role-capability-map.md` §"Who holds what today"), all of whom can already open
`heygabi.ai/admin/` and read the runbook pages `docs.ts` serves. The blast
radius of an over-inclusive directory is small; the blast radius of a
silently-stale corpus is the whole feature.

⚠️ **The scanner is what makes that trade safe, so it is not optional.** And it
**refuses the publish** — it does not strip, redact, or skip the offending file.
Silent stripping is the exact defect the estate's verification rule names ("a
validator that silently strips instead of rejecting"), and here it would be
worse: a stripped doc is a doc GABI answers from, missing the line that
mattered. On a hit the publisher prints file, line number, and matched rule,
exits non-zero, and **the previous snapshot keeps serving** — the ebooks
publisher's cover-gate behaviour, verbatim. Emergency hatch, one env var,
deliberately awkward: `ALLOW_SUSPECT_DOCS=1`.

Scanner rules (reasoned starting set; tune against a real run before enforcing):
known key prefixes for the providers this estate uses, `-----BEGIN * PRIVATE
KEY-----`, long high-entropy base64/hex runs outside code fences, and
`password|passwd|secret|token` immediately followed by `=` or `:` and a
non-placeholder value. ⚠️ **Ship it shadow-first** — log would-refuse for one
week, act on nothing, enforce only after a measured zero false refusals. That is
the estate's standing enforcement-rollout rule and it applies squarely.

### 3.3 What is still sensitive, and rides the gate rather than the filter

Even with `CREDENTIALS.md` gone, the snapshot carries: secret *names* and where
they live, deploy and rollback levers, break-glass SQL, R2 bucket names, the
`/admin` grant grammar, and — in several docs — **household members' email
addresses and role assignments** (`ebooks-gate.md` §4 and
`role-capability-map.md` are both like this). That is PII plus an operations
runbook. It is exactly the material the gate exists for, and it is a second
independent reason `estate-docs-gated` must never get a public URL.

### 3.4 The receipt

`receipt.json` — every included path with its byte count and sha, plus
`generated_at` and each repo's HEAD. It is the thing that makes a *directory*
allowlist auditable: one read tells the owner the complete included set, so an
unintended file is visible rather than silently present. Surfaced two ways: the
publisher prints a diff against the previous receipt (`+3 files, -1 file`), and
a devops-gated `GET .../docs/receipt` returns it.

---

## 4. The gate

### 4.1 The exact flags

**`requireDevops()` — nothing new, nothing weaker.** Its one implementation
lives in `apps/auth-worker/src/middleware/auth.ts` and reads (measured, read
2026-08-17):

```
devopsAllows(row, isOwner) =
  isOwner (membership of OWNER_EMAILS)
  OR (row.status === 'approved' AND (row.is_devops === 1 OR row.is_approver === 1))
```

⚠️ **`dev_access` is explicitly NOT the gate**, and the distinction matters:

| | `is_devops` / `is_approver` / `OWNER_EMAILS` | `dev_access` (migration 0011) |
|---|---|---|
| What it means | operator standing | *"can see the `/dev/` lane's pages draw themselves"* |
| Who has it | devops, approvers, owners | all of the above **plus** anyone hand-granted |
| Suitable for runbooks? | yes | **no** — a member given dev access to preview an ebook page has no business reading break-glass SQL |

`estate-auth.md` §10 calls `dev_access` *"a curtain, not a lock"* in its own
words. A curtain is not an authorization primitive; using it here would widen
the reader set by exactly the people the gate is for.

### 4.2 Where it is enforced

**In the auth Worker, on the route, and nowhere else.** The discord-worker never
decides — it asks and relays. That keeps the property the application map is
built on: revoke someone's devops in `/admin` and their next docs question is
refused, with no deploy and no second place to remember.

### 4.3 Two doors onto the same routes

| Door | Caller | Proof | Middleware |
|---|---|---|---|
| **A — site** | a signed-in browser (a future `heygabi.ai/docs/` page, §7 phase 4) | Firebase ID token | `requireDevops()` as-is |
| **B — Discord** | `apps/discord-worker` on a linked asker's behalf | app bearer **plus** the asker's proven email | new: app-token check, then the same `devopsAllows()` |

⚠️ **Door B has a prerequisite that does not exist today, and it is the single
biggest piece of new plumbing in this design.** Measured 2026-08-17 by reading
the code:

- `apps/discord-worker/src/link.ts` writes `discord_links/{discordUserId} = {
  slug, displayName, linkedAt, firebaseUid }`. **There is no `email` field.**
- The estate directory is keyed by **email** (`seenBodySchema` in
  `apps/auth-worker/src/estate.ts` requires `email`; `firebase_uid` is
  nullish and is stored, not looked up by).
- The discord-worker **cannot mint a Firebase ID token** — `firebase-sa.ts`
  there is scoped to `datastore` only, and `have.ts`'s header records that
  omission as a deliberate credential decision, not an oversight.

So the chain is broken in the middle: GABI can prove *which Discord account*
asked and *which estate member* it is, but cannot ask the directory about them.

**The fix, and why it is safe:** `link.ts` already verifies a Firebase ID token
via `@platform/estate-auth` (`resolveIdentity`, project-pinned issuer and
audience, **unverified emails refused**) at link time. The email is in hand at
exactly the moment the doc is written; it simply is not persisted. Add `email`
to the written shape. That makes the email as strong a claim as `firebaseUid`
already is — proven once, server-side, by the same verifier.

⚠️ **Consequence to plan for: links written before this change have no email
and cannot be upgraded from the outside.** Those people must `/unlink` and
`/link` again, or a one-off backfill must map `firebaseUid → email`
server-side. Either is fine; **choosing silently is not** — an un-upgraded link
must produce the *worded* "re-link to use this" refusal (§4.5), never a bare
"not authorised".

⚠️ **This is a change to `link.ts`, which a concurrent agent is working in.**
Nothing in this doc touches it. It is a step in the phase plan (§7), to be
scheduled after that agent lands.

### 4.4 Answering "is this email devops?"

**Recommended: add `devops` (effective) to `POST /api/estate/seen`'s response
envelope.** That route is already app-token gated (`identifyApp`), already
answers per-email, and already carries exactly this kind of pre-combined answer
— `visibility` and `dev_access` both ride it under an explicit *"consumers
apply it as-is and never recompute"* rule written into the handler's comments.
Adding `devops: devopsAllows(row, isOwner)` is one field computed by the one
implementation, and it needs a new app-token pair —
`ESTATE_APP_TOKEN_DISCORD` — minted on both Workers (a NEW secret, name only,
not set).

Two honest costs, neither disqualifying:

1. **`/seen` upserts.** A docs question would touch a D1 row. Volume is
   negligible (§5.3 caps it at tens per day) and the row already exists for a
   linked member, so no new rows are created.
2. **`/seen` enrols unknown emails.** Not reachable here — the only email the
   discord-worker can send is one `link.ts` proved. Worth stating so a future
   caller does not pass a user-supplied string.

**Fallback if the write proves wrong:** a read-only `POST /api/estate/whois`
behind the same app token, answering `{ devops }` and nothing else. Named here
so the alternative does not have to be rediscovered.

### 4.5 What a refused asker hears

⚠️ **Never a bare status, never a silent no-op** — the estate's standing rule.
Four distinct causes, four distinct sentences, because the fixes differ:

| Cause | What she says (shape, not final copy) |
|---|---|
| Not linked | *"I can't tell who you are on the estate yet — the docs are devops-only, so I need the link first. Run `/link` and try me again."* |
| Linked, no email on the link (pre-upgrade) | *"Your link was made before I could check estate roles. Re-run `/link` once and I'll be able to answer this."* |
| Linked, approved, not devops | *"The estate docs are limited to devops-class members, and your account isn't one. Ask an approver in `/admin` if you need it — that's a deliberate line, not a glitch."* |
| Estate unreachable / misconfigured | *"I couldn't reach the estate to check your access — that's a problem on our side, not your permissions. Try again in a minute."* |

⚠️ **The last row is the one that gets mislabelled.** A 502 from the auth Worker
is an outage; calling it a permission failure sends the owner hunting for a
grant he already has.

---

## 5. The tool shape

### 5.1 Two tools, both read-only

Two entries added to `GABI_MENTION_ACTIONS` in `apps/discord-worker/src/
mentions.ts` — the explicit array that a test asserts exactly, so a write path
cannot arrive alongside this feature:

| Action | Does |
|---|---|
| `search_estate_docs` | query → up to N matching sections, each as `repo/path §heading` + a ≤400-char snippet + a section id |
| `read_estate_doc` | section id (or `path` + `heading`) → that one section's text, capped |

⚠️ **Nothing writes.** No publish trigger, no doc edit, no TODO append — a docs
*assistant*, not a docs editor. If "GABI writes to `docs/TODO.md`" is ever
wanted, it is a T1/T2 verb with its own design, not an extension of this one.

### 5.2 How search works

The Worker fetches `snapshot.json.gz` **once per isolate**, decompresses, and
caches it in module scope keyed by `generated_at`. Then, per query: lowercase
literal/token matching over path, title, headings and body; score by heading
hits > path hits > body hits; return the top N **sections**, never files.

- **No inverted index, no D1 FTS5, no embeddings.** Considered and rejected on
  the measured size (§0). D1 FTS5 in particular would mean a second write path
  into the estate's database from a local machine, a non-atomic publish, and
  ranking nobody needs at 116 files.
- **One subrequest** (the R2 get) on a cold isolate, zero when warm — which
  matters against the 50-subrequest platform ceiling the application map §4.4
  records.
- The model iterates naturally: search → read a section → search again. That is
  what makes heading-level scoring sufficient without a body index.

### 5.3 Caps, and why they are their own fuse

⚠️ **A docs turn is roughly an order of magnitude heavier than an ordinary GABI
turn.** Continuity clips remembered messages at 600 characters and a full window
is ≈3k input tokens (`discord-bot-design.md` §7.5). A docs answer carries
retrieved *documentation*. Reusing the existing 20/hour, 200/day fuses unchanged
would let a docs feature quietly cost 10× the whole rest of GABI.

Proposed caps (reasoned; re-measure after a week of real use):

| Cap | Value | Why |
|---|---|---|
| Snippet, per search hit | 400 chars | enough to judge relevance |
| Hits per search | 8 | |
| One `read_estate_doc` | 8 KB | the §2.3 section ceiling |
| **Retrieved bytes per turn** | **24 KB total, ≤4 sections** | ≈6k tokens — see below |
| Docs turns per person per day | `GABI_DOCS_TURNS_PER_DAY`, default 40 | a *separate* fuse, additional to the existing ones, never replacing them |
| Posture | `GABI_DOCS`, affirmative-only `"on"` | ships dark, exactly like `GABI_MENTIONS` and `MODERATION_ENABLED` |

**Spend arithmetic** (rates read from the Anthropic API reference, 2026-08-17;
the token counts are estimates from bytes÷4, not measured with `count_tokens`):
24 KB ≈ 6k input tokens. At Haiku 4.5's $1/MTok that is **≈0.6¢ per docs turn**;
at Sonnet 5's $3/MTok (introductory $2 through 2026-08-31) it is **≈1.8¢**.
40 turns/day at Sonnet-class is under **75¢/day** worst case, and real use will
be a handful of questions on the days a Claude session is not open.

**Model recommendation: run docs turns on a Sonnet-class model, not the mention
loop's Haiku.** `discord-bot-design.md` §6.4's argument for Haiku is explicitly
scoped — *"there are no tools, so there is no tool-selection accuracy to lose"*
— and this feature is precisely a tool-selection loop over a large corpus, for
an audience of about four people, where a wrong runbook answer costs more than
the model delta. Keep the doc's **pinned-model** discipline (a model that
changes under a fixed cap changes what the cap means) and pin the id; today
that is `claude-sonnet-5`. Note the two API facts that bite here: **prompt
caching needs a ≥1024-token stable prefix on Sonnet 5** (4096 on Haiku 4.5), and
the retrieved excerpt is volatile, so any `cache_control` breakpoint belongs on
the system prompt, *before* the docs text, or nothing caches.

### 5.4 The growth tripwire

⚠️ **This design is sized to a measured corpus and must fail loudly when it
outgrows it.** `DONE.md` files only grow. The publisher **WARNs above 10 MB raw**
and **refuses above 25 MB** with a message pointing back at this section — at
which point the answer is either to drop `DONE.md` archives from the allowlist
or to move to a real index. Reasoned thresholds, not measured; the point is that
a threshold exists and is mechanical.

### 5.5 How it composes with the conversation memory

The rolling window is `(surface, space, person)`-keyed, 30 minutes, 20 turns,
600 chars per turn, living in the gateway Durable Object
(`gabi-conversation-continuity.md`). **Docs text never enters it.** What gets
remembered is the exchange — the question and her answer — clipped at 600 chars
like everything else, so a follow-up ("what about the rollback?") still has
context without the window carrying kilobytes of runbook. The retrieved sections
live only in that one model call.

Accounting rides the existing `gabi_turn` log line with two added fields —
`docs_sections` and `docs_bytes` — beside the raw token counts, so docs spend is
**attributable rather than inferred** (§7.5's rule, inherited). ⚠️ **The
retrieved text is never logged** — only how much of it there was. Logging it
would put runbook content into a log stream with a different audience than the
gate.

---

## 6. Failure honesty

**The snapshot has an age, and a stale one is not evidence.** Three mechanisms,
because the reply is the only place the owner will actually see this:

1. **Every answer carries the date.** *"…as of the last docs publish on
   2026-08-17."* Not a footer she sometimes adds — part of the tool result the
   model is instructed to relay, so dropping it is a visible defect.
2. **Past a threshold she says so unprompted.** Older than **3 days** →
   *"⚠️ this snapshot is 9 days old, so anything that changed since won't be in
   it."* Reasoned threshold: the pipeline runs 8-hourly, so 3 days means roughly
   nine consecutive missed cycles — well past noise.
3. **Absence is reported as absence.** If search finds nothing she says *"I
   don't have anything on that in the snapshot"* — never an answer from general
   knowledge dressed as an estate fact. This is the same rule `/have` already
   carries (*absence means "not in the catalogue", never "not owned"*), applied
   to docs.

The distinct failure states, each with its own worded reply and each
distinguishable from the others:

| State | Meaning |
|---|---|
| `docs_store_unbound` | the `ESTATE_DOCS` R2 binding is missing — **our** setup |
| `snapshot_absent` | bucket bound, nothing published yet — run the publisher |
| `snapshot_stale` | published, older than the threshold — answers still given, warning attached |
| `no_match` | snapshot fine, nothing matched — a real "I don't know" |
| gate refusals | the four sentences of §4.5 |

---

## 7. The build plan

Effort classes use the estate's measured calibration (research ≈100k, single
subsystem ≈280k, multi-layer ≈470k). ⚠️ **Every phase ends at a committable
boundary**, so a killed agent costs nothing beyond the phase in flight.

| Phase | What | Layers | Effort | Depends on |
|---|---|---|---|---|
| **1** | The publisher: allowlist, denylist, section splitter, receipt, sha-skip, `--dry-run`. Scanner in **shadow** (log only). Bucket created, dev-url verified disabled. No Worker changes. | 1 script, local | **small** (~100–150k) | owner creates the bucket |
| **2** | Auth Worker: R2 binding, `GET /api/estate/docs/search`, `GET /api/estate/docs/section`, `GET /api/estate/docs/receipt`, all behind `requireDevops()` (**door A only**). Testable with a browser token before any Discord work exists. | 1 worker | **small–medium** (~150k) | phase 1 |
| **3** | Door B: `email` added to the link doc + the relink/backfill decision; `devops` added to `/seen`'s envelope; `ESTATE_APP_TOKEN_DISCORD` minted on both Workers. | 2 workers | **medium** (~200k) | ⚠️ the concurrent `apps/discord-worker` agent landing |
| **4** | GABI's two tools, the allowlist entries + their pinning test, the caps and `GABI_DOCS` posture, the refusal wording, the staleness wording, `gabi_turn` fields. | 1 worker | **medium** (~200k) | phases 2–3 |
| **5** | Pipeline STEP 9 (both the normal and idle paths), scanner flipped shadow → enforce on measured zero false refusals, `PIPELINE.md` + this doc updated. | script + docs | **small** | phase 1, one week of shadow data |
| **6** *(optional)* | A devops-gated `heygabi.ai/docs/` search page on the same routes — the same snapshot, the same gate, a box and a list. Door A is already built for it. | 1 site | **small–medium** | phase 2 |

**Owner steps** (nothing below can be done from a session):

1. **Create the R2 bucket** `estate-docs-gated` — and then run
   `npx wrangler r2 bucket dev-url get estate-docs-gated` and confirm it says
   **disabled**. ⚠️ Never attach a domain or enable a public URL.
2. **Mint `ESTATE_APP_TOKEN_DISCORD`** and `wrangler secret put` it on **both**
   `apps/auth-worker` and `apps/discord-worker` (phase 3).
3. **Re-link on Discord once** after phase 3, if the relink route is chosen over
   a backfill (a `/unlink` then `/link`, about ten seconds).
4. **Flip `GABI_DOCS=on`** when phase 4 is verified — a deliberate act, never a
   side effect of a deploy.
5. *If the REST transport is chosen instead of wrangler:* add **"Workers R2
   Storage Write"** to `CLOUDFLARE_API_TOKEN` at dash → My Profile → API Tokens.
   Not needed on the recommended path.

**Review link, for when phase 6 lands:** <https://heygabi.ai/docs/> — signed in
as owner, type a phrase you know is in a runbook (e.g. *revocation delay*) and
check that the result names the file **and the section**, and that the page
shows the snapshot date at the top. Before phase 6, the reviewable surface is
Discord: DM GABI *"how do I promote to prod?"* and check the answer cites
`catalog-platform/docs/…` and carries a publish date.

---

## 8. ⚠️ What was NOT verified

⚠️ **This is the DESIGN-TIME list, kept as written rather than edited**, because
several of its lines were answered by the build and the answers matter more than
the questions did. Read **§10.8** beside it: it says which of these held, which
did not, and what the current not-verified list is.

- **Nothing here is built.** No script, no route, no bucket, no binding exists.
- **No R2 put has been attempted** to any bucket from `catalog-platform`; the
  wrangler-vs-REST recommendation rests on `backup-r2.mjs`'s 2026-08-15 note
  about wrangler's command surface, not on a run.
- **Token counts are byte÷4 estimates**, not `count_tokens` measurements. The
  per-turn cent figures inherit that error.
- **The retrieval quality claim is untested** — that heading-level scoring plus
  model iteration answers real questions like *"how do I promote?"* is reasoned
  from the corpus's heading density (2,176 headings / 116 files, measured), not
  observed. Phase 2 is deliberately shaped so this is testable in a browser
  before any Discord work is spent.
- **The scanner's rule set has never been run** over the corpus. Shadow-first
  exists precisely because its false-positive rate is unknown.
- **The concurrent agent's state in `apps/discord-worker` is unknown to this
  doc.** Phase 3's `link.ts` change is described, not scheduled.

## 9. Open questions for the owner — one at a time, in this order

1. ✅ **DECIDED 2026-08-18 — RELINK, no backfill** (owner: "1.a i think its
   just me"). After phase 3 lands, the linked people (likely just the owner)
   re-run `/link` once — self-verifying, since a post-phase-3 link carries
   the email by construction. Phase 3 is unblocked.
2. ✅ **DECIDED 2026-08-18 — STEP 9, ride the pipeline** (owner: "a"). The
   publisher hangs off the 8-hourly audiobook pipeline as a soft step; no
   fourth scheduled task. Staleness stays visible regardless (every answer
   carries its snapshot date), and a manual publish remains available before
   fresh questions. Phase 5 is unblocked.
3. ✅ **DECIDED 2026-08-18 — the `DONE.md` archives are IN** ("yes include
   them"). GABI can answer *"when did we do X and why"*. The §5.4 growth
   tripwire (WARN at 10 MB) is the standing revisit point.
4. ✅ **DECIDED 2026-08-18 — BUILD the web page** (owner, clarifying moments
   after an ambiguous "sure": *"sure, but make it with a search bar and
   pretty to look at"*). Phase 6 is IN scope: a devops-gated docs page on
   the apex with a real search bar and deliberate visual design — not a
   utilitarian dump. ALL FOUR QUESTIONS ANSWERED — the design is fully
   decided and buildable.

---

## 10. AS BUILT — phases 1, 2, 5 and 6 (2026-08-18)

> Everything in this section is **measured on this machine on 2026-08-18**
> unless it says otherwise. Where the build departed from the design above, the
> departure is named here rather than by quietly editing the paragraph that
> turned out to be wrong.

### 10.1 What exists

| Piece | Where | State |
|---|---|---|
| Publisher | `audiobook_catalog/scripts/publish_docs_snapshot.py` | tracked, 33 tests |
| Pipeline STEP 9 | `audiobook_catalog/scripts/sync_to_drive.py` — `_publish_docs_snapshot()`, called on the busy **and** the idle path | tracked |
| Bucket | `estate-docs-gated`, objects `snapshot.json.gz` + `receipt.json` | created 2026-08-18 |
| Worker routes | `apps/auth-worker/src/estate-docs.ts` | deployed |
| Binding | `ESTATE_DOCS` in `apps/auth-worker/wrangler.toml` | deployed |
| Page | `sites/heygabi-home/public/docs/{index.html,docs.js}` | deployed — <https://heygabi.ai/docs/> |
| Probes | `tools/estate-probes/probes/auth-worker.mjs` A36–A39 | 111/111 pass |

**Bucket privacy, verified the day it was created** —
`npx wrangler r2 bucket dev-url get estate-docs-gated` answered
*"Public access via the r2.dev URL is disabled."* ⚠️ Never attach a domain or
enable a public URL; §3.3 is the reason and it has not changed.

### 10.2 The corpus, measured on the first real publish

| | |
|---|---:|
| Markdown files published | **119** |
| Raw bytes | **3,105,573** |
| Sections | **1,413** |
| Gzipped bundle | **1,248,434** (40.1% of raw) |
| Denylisted, excluded | 1 — `audiobook_catalog/docs/access/CREDENTIALS.md` |
| Non-`.md`, excluded by construction | 7 |
| Scanner findings | **0** (after tuning — see 10.4) |

§0 predicted "comfortably under 1 MB" gzipped. **It is 1.19 MB** — still one R2
GET on a cold isolate, so the architecture stands, but the estimate was low and
is corrected here rather than left to be rediscovered.

Sections came to 1,413, not the 2,176 H1–H3 headings §1 measured, because the
publisher cuts at **H2** and descends to H3 only when a section exceeds 8 KB.
That was always the design (§2.3); the two numbers are not the same quantity.

### 10.3 Three departures from the design above

1. **The publisher lives in `audiobook_catalog`, not `catalog-platform`**
   (§2.2 recommended the latter). Two reasons: `audiobook_catalog/docs/` exists
   only on this machine, so the publish step has to run there regardless; and
   STEP 9 is a step of *that* repo's pipeline, where `publish_ebooks_manifest.py`
   is the exact precedent for a Python module the pipeline imports and calls. A
   Node script in a sibling repo invoked by absolute path would have added a
   cross-repo path dependency to the estate's only unattended job.

2. **Sections carry their own text; there is no whole-file copy and no byte
   offsets** (§2.3 sketched `{sections:[{heading,level,start,end}], text}`).
   Storing both would double the corpus, and ⚠️ offsets are a cross-language
   hazard: Python indexes `str` by code point and a Worker indexes by UTF-16
   code unit, so one astral emoji anywhere in a file would silently shift every
   offset after it. The symptom would be a section starting mid-word, and
   nothing would point back at the cause.

3. **The Worker revalidates on a five-minute lease rather than caching flatly
   once per isolate** (§5.2). Past the lease one `head()` compares etags, and
   only a changed etag pays for a download. Without it a long-lived isolate
   serves a snapshot the staleness warning still calls fresh — the warning would
   be reporting the publisher's clock while the reader sees the isolate's, which
   is §6's own trap wearing a new hat.

### 10.4 The scanner's first real run — the numbers shadow-first existed for

§8 recorded that the rule set had never been run and that its false-positive
rate was unknown. It has now been run:

| Pass | Findings | Verdict |
|---|---:|---|
| First | **5** | **all five FALSE** |
| After tuning | **0** | — |

Two classes, both worth recording because both are shapes this estate's docs
produce constantly:

- ⚠️ **A plain MDN link matched the high-entropy base64 rule** — because `/` is
  in the base64 alphabet, so `…/docs/Web/API/HTMLMediaElement/playbackRate` is a
  40-plus character run of base64-legal characters with respectable entropy.
  Fix: URLs are stripped from a line before the entropy rules run. The prefix
  rules still see the whole line, because a key pasted into a query string is
  still a key.
- **Three matched `secret:list:friend`**, an npm script name, on the
  `secret|token|password` + `:` + value rule. Fix: an all-lowercase, digit-free
  value is an identifier, not a credential — no issuer this estate uses mints
  lowercase-only tokens.

⚠️ **This is ONE clean pass, not a week of them.** The scanner stays in
**shadow** and the pipeline passes no override. Flipping to enforce is still a
deliberate act (`--scanner enforce`, or `DOCS_SCANNER_MODE=enforce`), because a
false positive inside an unattended 8-hourly job stops the corpus refreshing
with nobody watching.

⚠️ **It refuses; it does not strip.** Two tests pin that pair: one plants a fake
credential in a scratch docs tree and asserts the run exits non-zero, and its
partner asserts the offending file is still in the bundle **whole**. Findings
carry path, line and rule and **never the matched text** — a findings log that
quotes what it found has published the secret to a second place.

### 10.5 The transport question, answered by measurement

§2.2 recommended wrangler on the grounds that it needs no new credential. That
turned out to be the only path that works today:

| Transport | Result |
|---|---|
| `wrangler r2 object put` (wrangler's own OAuth) | **works** |
| S3/boto3 with the estate R2 API token from `.env` | **AccessDenied** |

The token was checked against a bucket it *does* cover in the same run
(`PUT estate-ebooks` → OK), so this is a scope fact about the token rather than
a broken credential: it is scoped to a named bucket list and a new bucket is not
on it. `--transport s3` exists and is one owner action away (dash → R2 → API
tokens → add this bucket), but nothing needs it.

### 10.6 ⚠️ Two defects the build found, both worth remembering

1. **"Idempotent by content" was true of the code and false of the behaviour.**
   The sha-skip hashed the *gzipped bundle*, which carries `generated_at`, so it
   changed on every invocation — the 8-hourly step would have re-PUT 1.2 MB
   forever while printing *"no change in the included set"* directly beside it.
   `content_sha()` now covers each repo's HEAD plus every file's path and text,
   and nothing else. Found by running the publisher twice, not by reading it.

2. **The docs page showed no snapshot date until someone typed** — while its own
   footer said *"anything written since the date above is not in it yet"*. The
   freshness display, built specifically to defeat silent staleness, was itself
   silent on arrival. `GET …/docs/search` with an empty `q` now answers **200**
   carrying the snapshot envelope (an empty query is the starting state, not an
   error), and the page makes exactly one such call on sign-in. It earns its keep
   twice: that call is also the earliest moment a signed-in **non-devops**
   visitor gets the worded refusal, rather than a search box that silently did
   nothing until they used it.

### 10.7 The page (phase 6)

Owner's bar, verbatim (2026-08-18): *"sure, but make it with a search bar and
pretty to look at."*

⚠️ **Content-free by construction**, which is what makes committing it to a
public repo safe: view the source signed out and there is no documentation — no
path, no heading, no snippet. Everything arrives from behind `requireDevops()`;
a 200 IS the capability probe.

- search-as-you-type (190 ms debounce, previous request aborted) against the
  live corpus — not a filter over a list the page holds, because it holds none;
- `<mark>` highlighting in both the snippets and the rendered section;
- results as SECTIONS with a repo chip and file path, spined in the estate's own
  three shelf colours (`--et-hue-1/2/3`) rather than a fourth palette nobody has
  seen before;
- a reader rendering one section properly — headings, fenced code, pipe tables,
  lists, blockquotes, inline code/bold/italic/links — naming the source file and
  the publish date **inside** the document rather than beside it;
- ⚠️ **no `innerHTML` anywhere**, pinned by a `mustNotContain` in
  `predeploy.checks.json`. The corpus is our own writing, so this is not a
  defence against a hostile author: it is a defence against the ordinary case, a
  `<script>` inside a code fence or an angle bracket in a shell one-liner, which
  an innerHTML renderer would either execute or silently eat.

### 10.8 ⚠️ What is STILL not verified

- **Phases 3 and 4 do not exist.** No Discord door, no GABI tools, no `email` on
  the link doc, no `ESTATE_APP_TOKEN_DISCORD`. ⚠️ The owner's original ask —
  answers when no Claude session is open — is **not yet met**; today the docs
  are reachable from a browser and nowhere else.
- **The gate is verified only at its refusing edge.** Tokenless calls answer 401
  with the worded sentence (live, on all three routes), and the page was driven
  signed in as the OWNER. ⚠️ **No account that is signed in but NOT devops has
  been tested against these routes** — the 403 path is asserted in code and in
  copy, not observed.
- **The staleness path has never fired.** `STALE_AFTER_HOURS = 72` is a reasoned
  threshold, unit-tested against a synthetic clock; no real snapshot has yet been
  three days old.
- **The scanner's false-positive rate rests on ONE pass** (10.4), not a week.
- **The growth tripwire has never fired.** 10 MB / 25 MB are reasoned numbers and
  the corpus is at 3.1 MB.
- **Retrieval quality is now partly observed, not fully.** *"revocation delay"*
  returns 10 of 10 sections with the right file and section on top, and *"promote
  to prod"* returns 20 of 123 — both checked live, signed in. Whether
  heading-level scoring holds up across the questions the owner actually asks is
  still unknown.
- **Nothing links to `/docs/`.** Deliberate (see `TODO.md`), but it means the
  page is reachable only by typing the URL.

---

## 11. AS BUILT — phases 3 and 4, the Discord door (2026-08-18)

> Everything here is **measured on this machine on 2026-08-18** unless it says
> otherwise. Where the build departed from the design above, the departure is
> named here rather than by quietly editing the paragraph that turned out to be
> wrong. ⚠️ **The owner's original ask is now MET**: §10.8's first bullet said
> *"today the docs are reachable from a browser and nowhere else"*, and that is
> no longer true.

### 11.1 What exists

| Piece | Where | State |
|---|---|---|
| `email` on the link doc | `apps/discord-worker/src/link.ts` | deployed |
| `devops` on `/seen`'s envelope | `apps/auth-worker/src/estate.ts` | deployed |
| Door B (app token + proven email) | `apps/auth-worker/src/estate-docs.ts` — `docsGate()` | deployed, **verified live** (11.4) |
| The contract, caps and words | `apps/discord-worker/src/estate-docs.ts` | deployed |
| The credentialled executor | `apps/discord-worker/src/estate-docs-exec.ts` | deployed |
| The two tools | `GABI_DOCS_TOOLS` in `apps/discord-worker/src/gabi-tools.ts` | deployed, **dark** |
| Posture | `GABI_DOCS = "off"` in `apps/discord-worker/wrangler.toml` | ⚠️ **OFF — one owner flip** |
| Secret | `ESTATE_APP_TOKEN_DISCORD_DOCS`, 2 holders | set on both |

Suites: **1,071 workspace tests green** (auth-worker 264, discord-worker 419,
plus the rest). `npm run probe:estate` **115/115** before and after the deploy —
⚠️ the design's §7 note of a 111 baseline is stale; the suite grew with the T1
build, and no probe was added or changed by this one.

### 11.2 ⚠️ The token decision — a NEW pair, and why re-use was impossible

`ESTATE_APP_TOKEN_DISCORD` already existed (minted 2026-08-18 by the Tier-1
build) with **three holders**: the discord-worker and *both* library Workers.
Adding the auth Worker as a fourth was considered and is **not possible**: a
wrangler secret cannot be read back, so the only way to share the existing value
would be to re-mint it and re-pipe all four — which breaks Tier 1 in the window
between, for a feature that gains nothing from the sharing.

It is also the wrong shape regardless. A leak from *either library instance*
would then open the estate's whole docs corpus — break-glass SQL, deploy levers,
secret names, household emails. **A fresh trust edge gets a fresh pair**, and
this is the case that rule was written for. So:
`ESTATE_APP_TOKEN_DISCORD_DOCS`, **two holders**, custody in
[`../access/estate-docs.md`](../access/estate-docs.md) §8.

⚠️ It is deliberately **not** a `CONSUMER_APPS` entry. `identifyApp()` resolves a
bearer against that list, so adding it there would silently have made it a valid
`POST /api/estate/seen` bearer — a wider capability than the one being granted.

### 11.3 Door B's contract, as built

```
GET /api/estate/docs/{search,section,receipt}
  Authorization: Bearer <ESTATE_APP_TOKEN_DISCORD_DOCS>
  X-Estate-On-Behalf-Of: <the asker's PROVEN estate email>
```

`docsGate()` tries door B first and falls through to `requireDevops()` (door A)
whenever the bearer is not the docs token — **including when the secret is
unset**, which is the ships-dark state. Both doors end at the *same*
`devopsAllows(row, isOwner)`; there is no second copy of the decision and no
weaker variant, so revoking someone in `/admin` shuts both with no deploy.

| Situation | Answer | Sentence |
|---|---:|---|
| No bearer / a bearer that is neither | 401 | `unauthenticated` (door A's) |
| Docs token, no `X-Estate-On-Behalf-Of` | 400 | `link_has_no_email` — **the relink line** |
| Docs token, email not devops-class | 403 | `not_devops` |
| Docs token, directory read threw | 503 | `estate_unreachable` — ⚠️ an outage, never a refusal |
| Docs token, devops-class email | 200 | the corpus |

⚠️ **The trust boundary, stated plainly because it IS the design.** The holder of
the token can name any email and the Worker answers for that person's standing.
That is safe only because of the other end: the discord-worker can send exactly
one email — the one `link.ts` proved server-side through the person's own Discord
OAuth *and* their own Firebase sign-in. **A future caller must never pass a
user-supplied string here**; a second consumer gets its own pair and its own
review.

⚠️ **No `actor` is set and no row is materialized on door B.** `requireDevops()`
materializes a row for an OWNER_EMAILS caller who has none; a Discord docs
question is not a reason to write to the directory. A read must not have a write
as a side effect.

### 11.4 ⚠️ The gate, OBSERVED rather than asserted

§10.8 recorded that *"no account that is signed in but NOT devops has been tested
against these routes — the 403 path is asserted in code and in copy, not
observed."* Door B closed that, because unlike door A it needs no Firebase
verifier context and so is exercisable both in-process and live.

**Live, against `auth.heygabi.ai`:**

| Sent | Got |
|---|---|
| docs token + owner email | **200**, 8 hits of 124, snapshot `2026-08-18T03:03:17Z`, `stale:false` |
| docs token + an email not in the directory | **403** `not_devops`, the design's exact sentence |
| docs token + no email header | **400** `no_proven_email`, the relink sentence |
| docs token + `"  NBaslamKing@Gmail.com  "` | **200** — casing and padding cannot dodge the gate |
| no bearer, all three routes | **401**, worded (unchanged from phase 2) |
| a wrong bearer + a valid email | **401** — reveals nothing about which door it missed |

**In-process** (`apps/auth-worker/test/estate-docs.test.ts`), the row states a
live test cannot reach without editing the directory: approved-but-not-devops →
403; **revoked with a leftover `is_devops` flag** → 403; pending with the flag →
403; approver → through; owner with no row → through; D1 throwing → 503 worded as
an outage.

### 11.5 The two tools, and why they are a THIRD array

`GABI_DOCS_TOOL_NAMES = ['search_estate_docs', 'read_estate_doc']`, beside
`GABI_TOOL_NAMES` (Tier 0) and `GABI_DELEGATED_VERB_NAMES` (Tier 1) rather than
inside either.

Tier 0 and these are both read-only and both model-chosen, so `mutates` cannot
separate them. **What separates them is what they read**, and that is the whole
security story: Tier 0's guard asserts every entry reads
`public_audiobook_catalogue` — the sentence that makes that surface safe by
construction — and these read `gated_estate_docs`. Merging them would delete that
claim and hand a model the gated surface on every turn of every conversation.

⚠️ `toolsForApi()` **with no argument returns Tier 0 and nothing else**, pinned by
test. Only a caller that has checked the posture *and* holds a configured port
passes `{ docs: true }`, so the gated tools are never described to a model on a
turn that could not use them.

### 11.6 The caps, as built

| Cap | Value | Where |
|---|---|---|
| Hits per search | 8 | the auth Worker's own default (the page may ask 25; a model may not) |
| One section | 8 KB | guaranteed by the publisher's splitter |
| **Retrieved bytes per turn** | **24 KB** | `DocsBudget`, in the tool context |
| **Sections per turn** | **4** | same budget |
| Docs turns per person per UTC day | 40 | ⚠️ a **third** DO counter, `dcap:` |

⚠️ **The per-turn budget REFUSES rather than trims.** A silently truncated runbook
is a runbook missing the step that mattered, and the refusal says *"the section
was NOT read"* so the model cannot summarise it from the snippet as though it
had.

⚠️ **The daily fuse is charged only when a turn actually touched the corpus**
(`budget.used()`). Charging every turn would burn a 40/day allowance on
conversations about narrators and make the fuse describe something other than
what it protects.

⚠️ **A fuse that cannot be READ is treated as blown.** Guessing "not capped" costs
an uncapped spend nobody sees; guessing "capped" costs one worded refusal.

### 11.7 ⚠️ Two departures from the design above

1. **The model recommendation (§5.3) was NOT adopted, and could not be as
   written.** That section recommends running docs turns on a Sonnet-class model
   rather than the mention loop's pinned Haiku. The docs tools compose into the
   **existing** conversation loop — which is what makes a follow-up like *"and
   the rollback?"* work at all — so the model must be chosen **before** anybody
   knows whether the turn will touch the docs. A per-turn switch would need
   either a pre-classification call (a subrequest and a latency cost on every
   turn, to answer a question the tool loop answers for free) or a second loop
   (two code paths where continuity has one). There is also a concrete trap:
   `CHAT_MAX_TOKENS` is 400, and Sonnet 5 runs **adaptive thinking on by
   default**, which shares that ceiling with the response — a docs answer would
   be mostly thinking and then truncate. Left on the pinned Haiku, with the
   estate's own rule intact (*a model that changes under a fixed cap changes what
   the cap means*). Revisit with retrieval-quality evidence, not by flipping the
   id.

2. **The refusal sentences are a MIRRORED COPY, not an import.** §4.5 asks phases
   3/4 to reuse `DOCS_REFUSALS` rather than author a fifth wording. A cross-app
   import would couple two separately-deployable Workers at the module level for
   five strings, so the discord-worker holds its own copy and
   `test/estate-docs.test.ts` **reads `apps/auth-worker/src/estate-docs.ts` and
   fails the build on any drift** — the same two-ends-one-allowlist idiom
   `GABI_DELEGATED_VERB_NAMES` already uses.

### 11.8 ⚠️ The credential guard was WIDENED, deliberately

The Tier-1 build established *"credentials live in `delegated-exec.ts` and
nowhere else"*, pinned by a source-reading test. Tier 0b adds a second trust edge
with its own secret, so the property is now:

> **Credentials appear ONLY in `delegated-exec.ts` and `estate-docs-exec.ts`** —
> two named modules, one trust edge each.

The test was repointed rather than deleted, and a **new** assertion pins the half
that gives the split teeth: **neither executor names the other's secret.**
`src/have.ts` remains the documented exception (it has held a service-account
`isLinked` read since long before either path existed).

### 11.9 ⚠️ What is STILL not verified

- **`GABI_DOCS` is OFF.** Nothing has answered a docs question in Discord. The
  whole Discord path is exercised by unit tests and by door B live; it has never
  run end-to-end through a real model turn. **This is the owner's flip.**
- **The `devops` field on `/seen` has not been observed live** — it needs a
  consumer app token to call. Unit-pinned (the field is computed by
  `devopsAllows` and not re-derived); the deploy shipped it.
- **The relink has not happened.** The owner's `discord_links` document still
  predates the `email` field, so his first docs question — before he re-runs
  `/link` — will get the *"your link was made before I could check estate
  roles"* sentence. That is the designed behaviour, not a fault, but it means
  **the very first live test will be the relink prompt unless he re-links
  first.**
- **Retrieval quality on operational questions is partly observed and not
  reassuring at the top.** Live, `promote prod` returns **124 matches** and the
  top hit is a `DONE.md` handoff entry, not the promotion runbook. Search *ranks
  headings over bodies*, and the archives are in by owner decision (§9.3), so
  archive noise can outrank the runbook. The model is instructed to search then
  read, which mitigates it — but ⚠️ **whether she reaches the right file on the
  owner's real questions is the single biggest open question about this
  feature**, and the first few real answers are the evidence.
- **The per-turn budget has never been hit in production**, only in tests.
- **The daily fuse has never fired.**
- **No non-devops person has asked in Discord.** The refusal is observed at the
  auth Worker (11.4) and unit-tested at the tool layer; nobody has seen it land
  in a channel.
- **The staleness path still has never fired** (unchanged from §10.8) — the live
  snapshot was 0 days old at every check.
