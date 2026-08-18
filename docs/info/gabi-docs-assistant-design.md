# GABI reads the estate docs — design

> **Audience:** Claude sessions + the owner. **Status:** TRACKED (this repo is
> public on GitHub — resource and secret NAMES only, never values).
> Last verified: **2026-08-17**. **DESIGN ONLY — nothing here is built.**
> Every figure marked *measured* was taken on this machine on 2026-08-17;
> everything else is reasoned and labelled as such.

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
4. **Phase 6 — is a web docs-search page wanted at all**, or is Discord the
   whole ask? *(Purely additive; costs nothing to defer.)*
