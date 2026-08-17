# Audiobook Edit-Any-Detail + Audit Log — Web Edit Design

> **Audience:** Claude sessions and the owner. **Status:** TRACKED — DESIGN
> ONLY, nothing here is built. Last verified: **2026-08-16** against:
> `audiobook_catalog` — `app/core/overrides_store.py`,
> `app/tools/edit_overrides.py` (A2 key-move guard present),
> `app/core/catalog_overrides.py` (`CORRECTABLE_FIELDS`), `app/writers.py`
> (`CSV_FIELDNAMES`), `scripts/catalog_overrides.json` (`_schema`/`_keying`/
> `_precedence_rule`), `app/tools/pipeline_watcher.py` (step dispatch,
> cooldown, lock), `app/tools/fs_watcher.py` (reactive half),
> `scripts/sync_to_drive.py` `STEP_INFO`, `docs/info/catalog-corrections.md`
> (local-only there); this repo — `docs/info/edit-audit-design.md` (the
> cross-catalog contract this extends), `docs/info/audiobook-auth-migration.md`,
> `apps/audiobook-worker/src/*` (capabilities, env — Phase 0/1 built,
> `ESTATE_CHECK` flipped to shadow at `d8e599f`);
> `bookbuddy/library_catalog/docs/info/edit-and-audit-design.md` (the
> reference UX and audit shape). **NOT verified:** nothing was executed — no
> Firestore query, no pipeline run, no worker request; see §9 for every
> unmeasured claim.
>
> Companions: `edit-audit-design.md` is the estate contract (what any catalog's
> edit+audit must satisfy); **this doc is the audiobook site's web-edit
> mechanism** — how a browser edit reaches a git-tracked overrides file on the
> owner's machine without breaking anything the contract already settled.

The standing ask: *"Edit-any-detail UI + an audit log — wanted HERE as well as
in library."* The library's answer (a D1 UPDATE + a `change_log` row, built and
deployed 2026-08-13) does not transplant: this site is a **static generated
page** whose truth lives in m4b tags + `scripts/catalog_overrides.json` + a
pipeline that rebuilds `site/index.html` on the owner's home machine. An "edit"
here is a **curated override plus a rebuild** — and the auth migration now
shadow-soaking is exactly the machinery an authenticated edit endpoint rides.

---

## 0. The one paragraph that matters

**The web never writes the overrides file. It writes an edit *request* to a
Firestore queue via the audiobook-worker; the home machine consumes the queue
through the same canonical write path the CLI already uses, commits the result,
and the next rebuild publishes it.** This is forced, not chosen: a correct
override entry must be keyed on the *pre-correction m4b tag values* and proven
to fire by running the real corrections layer (`overrides_store.simulate()`) —
both need the m4b files and the repo, which exist only on the home machine. Any
design that lets a Worker write the file directly either keys entries on the
published title (the documented never-fires failure,
`catalog-corrections.md` §10) or re-implements the validator without the files
it validates against. The queue also inherits a proven pattern wholesale:
`pipeline_requests` already moves owner intent from a browser to this exact
machine with no open ports.

---

## 1. Ground truth this design is built on (measured 2026-08-16 unless dated)

| Fact | Where measured |
|---|---|
| The canonical write path is `overrides_store.py` (validate → refuse-or-atomic-save) with `edit_overrides.py` as its CLI shell; evidence with one reason per corrected field is mandatory and test-enforced | both files, `tests/test_catalog_overrides.py` per `catalog-corrections.md` |
| Entries are keyed ASIN-first (the `CDEK` atom — survives rename and retag), else pre-correction title+author; keying on the *published* title produces an entry that validates and never fires | `_keying` block; `catalog-corrections.md` §10 |
| `CORRECTABLE_FIELDS = title, author, narrator, year, genre, series, series_index` — a `set` on anything else is refused by the store and ignored by the build | `catalog_overrides.py:34` |
| The CLI's A2 key-move guard exists: a title/author edit prints old/new key + live review count (or "UNKNOWN, never a zero") and refuses without `--confirm-key-move`; the carry is the library's override-aware `backfill-review-keys.mjs` (A3, built 2026-08-14) | `edit_overrides.py:_key_move*`; `edit-audit-design.md` §7 |
| Production carries **zero** title/author overrides (measured 2026-08-14: all 69 entries were series/series_index-family) — the guard landed before the first key move | `edit-audit-design.md` §3.4a |
| A correction reaches the site only on the next pipeline `catalog`+`publish` run; the pipeline commits a **data-file allowlist** that does NOT include `catalog_overrides.json` | CLI epilogue; `role-ladder.md` §1c allowlist |
| `pipeline_requests` already carries browser→home-machine intent: create-only+unreadable rules, shared token, watcher validates and dispatches, per-step dispatch (`PIPELINE_STEP_CHOICES` incl. `catalog`, `publish`), 10-min cooldown, single-flight lock | `pipeline_watcher.py`; `sync_to_drive.py` `STEP_INFO` |
| The reactive fs_watcher gives arrival-latency of minutes but watches the **library tree only** — an overrides edit fires nothing today; the 8h run is the self-heal that would eventually publish it | `fs_watcher.py` header |
| `audiobook-worker` exists (Phase 0/1 of the auth migration): token verifier, ladder roles, capability matrix, `/api/me`, gate-shadow receiver; `ESTATE_CHECK` = shadow as of `d8e599f`; `FIREBASE_SERVICE_ACCOUNT` is declared in its `Env` | `apps/audiobook-worker/src/*` |
| The estate audit contract and the verdict that **git history is this catalog's audit log** are already settled | `edit-audit-design.md` §4.3 |

---

## 2. What "edit any detail" means here — the field inventory

Three tiers, in the estate contract's vocabulary. Every editable field maps to
exactly ONE write surface: **an override entry.** The web path never writes an
m4b tag — tag repair remains `audit_series_tags.py`, owner-run, backup-first,
uncurated path disarmed. (An override on a book whose tag is later fixed at
source becomes redundant, never wrong — the layer was designed for that.)

| Tier | Fields | Write surface | Who (proposed, §6) |
|---|---|---|---|
| **Free** | `narrator`, `year`, `genre`, `series`, `series_index` (blank = "unknown, recorded blank, never guessed" — the CLI's `-` idiom survives as an explicit blank) | override entry | `editCatalog` (contributor+) via web; applied automatically |
| **Key-moving** | `title`, `author` | override entry, **HELD** — applied only through the owner's CLI ceremony (`--confirm-key-move` + the A3 carry) | moderator+ may *submit*; owner applies |
| **Refused** | ASIN/`CDEK` (the override *key* — frozen per the estate contract: other data hangs off it); `duration_hhmm` (measured from the audio); `cover_href` (covers subsystem: R2 + `covers_manifest.json`, its own pipeline); `desc` (from tags, not in `CORRECTABLE_FIELDS`); `companion_files`, `library_work_id`, `library_formats`, `universe`, `series_gap` (pipeline-derived / stamped from other systems — `universe` is edited in the estate canon via `tools/universes.mjs`, never per-book) | none — the worker answers 400-in-sentences naming the field and, where one exists, the right tool | nobody |

Refused means **refused with a message, never silently stripped** — the library
found zod silently stripping a stray field and the estate treats that as the
canonical silent failure. The worker's field check is an explicit allowlist
with a per-field refusal sentence (§6's UX rules), mirroring
`CORRECTABLE_FIELDS`; the consumer re-validates against the real constant, so
mirror drift fails safe as a rejected request, not a silent success (§3.4).

`canonical_series` folds and `_unresolved` records stay CLI/owner-only in v1 —
they are catalog-wide policy, not per-book facts. A web "why is this book's
series spelled X" belongs in a request's free-text note, not in a direct fold.

**Possible later addition, owner's call:** `desc` could join
`CORRECTABLE_FIELDS` (it is tag-derived like the other seven). That is a
one-tuple change in `catalog_overrides.py` plus evidence rules; not proposed
here because nothing has asked for it. Cover corrections stay out — a wrong
cover is a covers-pipeline fact with its own manifest and R2 store, and
bolting it onto this layer would create a second writer of that subsystem.

---

## 3. The write path

### 3.1 The three options, weighed honestly

| Option | Verdict |
|---|---|
| **(a) Firestore pending-edits queue** — worker validates shape + capability and writes a request doc via service account; the home machine consumes the queue through `overrides_store`, commits, and the pipeline publishes | **Recommended.** The only option in which the entry is keyed and proven by the code that owns those rules, on the machine that has the m4bs. Reuses the `pipeline_requests` trust posture (no open ports, no repo credential leaves the house) and the auth migration's worker verbatim |
| **(b) Repo-committing bot** — worker (or an Action) commits `catalog_overrides.json` to GitHub directly | Rejected. The worker cannot key the entry (pre-correction tag values live in the m4bs) and cannot run `simulate()`, so every entry it wrote would be exactly the validates-but-never-fires class the CLI was built to prevent; it hands a repo-write credential to the busiest public surface; and it creates a second committer racing the pipeline's auto-commit (the §1c rebase gotcha, made worse). The repo is PUBLIC — the same reason the watcher polls instead of hosting a runner |
| **(c) Edits stay owner-machine-only** (status quo CLI) | Rejected as the end state — it is the thing the standing ask asks to end. It remains the **break-glass path** and the only path for key-moving applies (§2), which is a feature: the most dangerous edit keeps a human at the keyboard with the warning in front of them |

### 3.2 The flow, end to end

```
browser (editor UI, §7 E3)
  │  POST /api/edits   {book, sets, why, sources?, note?}
  ▼
audiobook-worker  — verify token → estate check (ENFORCED on this route, §7)
  │                 → capability gate (§6) → field allowlist + one-why-per-field
  │                 → stamp requestedBy from the VERIFIED token, never the body
  │  service-account write (bypasses rules; collection is default-deny to browsers)
  ▼
Firestore  edit_requests/{id}   status: "queued"     (lane-suffixed, §3.5)
  │
  │  polled on the home machine — same tick as pipeline_watcher (§5)
  ▼
consumer  app/tools/consume_edit_requests.py   (NEW, thin — a sibling of
  │       edit_overrides.py over the SAME overrides_store + book_lookup:
  │       resolve the book → pre-correction tags → build_match (ASIN first)
  │       → build_entry (editor's why per field; tags_read from the real file;
  │       editor's sources; note carries requester + request id)
  │       → simulate() proves it fires → validate → atomic save)
  │
  ├─ applied  → commit catalog_overrides.json (attribution in message, §4.2)
  │             → status: "applied" {entry, commit, applied: {field:{old,new}}}
  ├─ rejected → status: "rejected" {message}   (the store's refusal, verbatim —
  │             ambiguous match, entry would not fire, validation error)
  └─ held    → status: "held"     (title/author — awaits the owner's CLI, §2)
  │
  ▼
pipeline catalog+publish step (same run, §5) → site rebuilt → deployed
  → status: "live" stamped when the run that included the entry publishes
```

The consumer is deliberately **not** a second implementation: it imports
`overrides_store` and `book_lookup` exactly as the CLI does, so every rule —
evidence mandatory, ASIN-alone keying, duplicate-match refusal, atomic save,
refuse-invalid-file — is enforced once, in the one place the tests pin.

### 3.3 Trust posture

- **Browsers never touch the queue.** No `firestore.rules` change at all:
  an unmatched collection is default-deny, and both the writer (worker) and
  the reader/updater (home machine) use service-account credentials. Contrast
  `pipeline_requests`, which needed create-only rules because the *browser*
  writes it — here the worker fronts the write, which is the whole point of
  the auth migration.
- **Identity is server-stamped.** `requestedBy` comes from the verified
  Firebase token + the estate verdict; the request body cannot claim an
  identity. This is what makes §4's attribution honest.
- **The consumer trusts the queue's *intent* but re-derives every *fact*.**
  Published values, tag values, keys, and the fired-or-not proof all come from
  the local repo and files at consume time, never from the doc.

### 3.4 Failure modes, named

- **Worker accepts, consumer rejects** (field mirror drift, book vanished,
  ambiguous match — two catalog rows share the title+author and the request
  carries nothing to disambiguate): status `rejected` with the store's message.
  Drift between the worker's field allowlist and `CORRECTABLE_FIELDS` fails
  safe by construction; keep the two lists documented as mirrors the way
  `PIPELINE_STEP_CHOICES` mirrors `STEP_INFO` (a cross-repo test cannot pin
  them; the consumer's authority is the backstop).
- **Home machine off / watcher dead:** requests sit honestly `queued`. The
  status ladder never claims progress that has not happened; the existing
  pipeline heartbeat on `/status` is the instrument that says *why* nothing is
  moving. No timeout auto-rejects a queued edit.
- **Crash between save and commit:** the file is saved atomically; the commit
  is the durable audit record. The consumer must treat "file changed but
  status not yet `applied`" as resumable: on next tick, re-running the request
  is idempotent (`upsert` merges; `simulate` still proves it) and the commit
  then covers both. Same self-healing posture as the rest of the pipeline.
- **Two requests for one book:** applied in queue order through `upsert`'s
  merge semantics (fixing a narrator keeps last week's series fix). A later
  request that re-sets the same field supersedes the earlier value and the
  earlier request is stamped `superseded` rather than silently overwritten.

### 3.5 Lanes

`edit_requests` gets a `_dev` twin like every user-data collection (the
unsuffixed exceptions are `site_roles` and `pipeline_*`; this is neither). The
worker suffixes by its lane helper; the consumer reads **prod only** by
default, with `--lane dev` for exercising the path end-to-end without touching
the real overrides file (paired with `--overrides <tmp>` — the store already
takes a path).

---

## 4. The audit log

### 4.1 Where it lives — two layers, one contract

The estate verdict stands (`edit-audit-design.md` §4.3): **git history of
`catalog_overrides.json` is this catalog's audit log.** Web editing does not
change that — it adds a second, upstream layer:

| Layer | Records | Answers |
|---|---|---|
| **git history** (durable, append-only, pushed) | every applied change: entry + evidence + commit message attribution, one commit per applied batch | who/what/when/before/after for everything that ever took effect. `before` = the prior file version (git) + `tags_read` in evidence |
| **the `edit_requests` queue** (Firestore, service-account-only) | every *ask*, including the ones that never reached git: rejected (with the refusal message), held, superseded | "who asked for what and what happened to the ask" — the record of **refusals**, which git structurally cannot hold |

Contract mapping delta vs the CLI era (only the changed rows):

| Contract | CLI era | Web era |
|---|---|---|
| who | git author (the owner, effectively) | `requestedBy` from the verified token, carried into the commit message and the entry's evidence note — the git *author* stays the pipeline machine's identity, and that is fine: the contract asks for a stable actor identity, not a git credential per household member |
| how | always `'human'` | still `'human'` — the consumer is transport, not judgment; the reason on every field is a person's. (If an agent ever files requests, stamp `requestedBy.kind:'agent'` — distinguishable forever, per the contract) |
| append-only | git history | git history + queue docs that are only ever status-advanced, never deleted by the flow |

### 4.2 The commit and the entry — where attribution lands

One consumed batch = one commit (message written to a file, `git commit -F`,
per the repo rule):

```
overrides: web edit — <Book label> — <fields>

request <id> by <email> (<ladder role>), applied <ISO>
<field>: "<old published value>" -> "<new>"  (why: <editor's reason>)
```

And in the file, the entry's evidence `note` carries
`web edit by <email>, request <id>` — so the in-file record and the queue doc
cross-reference each other without double-storing the diff.

### 4.3 Evidence blocks vs audit rows

They answer different questions and neither substitutes: **evidence is the
per-field WHY** (mandatory, in-file, test-enforced — what settled the value:
`tags_read`, `filename_said`, `sources`); **the audit trail is WHO/WHEN/WHAT
CHANGED** (git + queue). A web edit's `why` strings become the evidence keys
exactly as the CLI's `--why` does; `tags_read` is filled by the consumer from
the real m4b at apply time, which keeps the agents-curate-with-evidence
precedent intact — a web editor supplies the reason, the machine supplies the
tag read, and a future reader can still tell a researched correction from a
typo. The library's `change_log` table is NOT adopted here: no database is
invented for a catalog that does not have one (the settled §4.3 verdict), and
if this catalog ever gains a platform D1, the queue-consumer is the one writer
that would then also insert 0120-DDL rows — a migration, not a redesign.

---

## 5. Rebuild latency and what the editor sees

### 5.1 When an accepted edit becomes visible

The overrides file only reaches the site through a pipeline `catalog` +
`publish` run. Today's triggers: the 8h scheduled run (self-heal), a manual
`pipeline_requests` trigger, and the reactive fs_watcher (arrivals only — it
does not and should not watch the overrides file; its hazard model is
truncated media, not JSON).

**Proposed trigger: the consumer's own tick fires a metadata run.** The
`pipeline_watcher` poll (already scheduled, already holding the Firestore
credential path) additionally checks the queue; when ≥1 request is queued and
the cooldown allows, it consumes, then dispatches `catalog` + `publish` steps
only — no acquire, no sort, no Drive upload — through the same single-flight
lock (non-scheduled trigger: fails loudly if held, pending requests simply
survive to the next tick; the 8h slot defers around it per the 2h
defer-don't-skip rule). Coalescing is free: one tick consumes everything
queued, one run publishes it.

Expected latency, editor's view (labeled, not measured — §9): **minutes to
~watcher-cadence + cooldown** in the normal case; **up to 8h worst case** when
the watcher is dead but the scheduled run survives; **unbounded but honest**
when the home machine is off (status stays `queued`, `/status` shows the
stale heartbeat).

### 5.2 The status ladder the UI shows

`queued → applied → live` (or `rejected` / `held` / `superseded`), read back
through the worker (`GET /api/edits/:id`, `GET /api/edits?mine=1` — the
browser never reads Firestore for this). Each state in sentences:

- **queued** — "Accepted. It applies on the home machine's next pass; the
  site rebuilds right after." (Plus, honestly, when the pipeline heartbeat is
  stale: "The catalog machine looks offline — your edit is saved and will
  apply when it wakes.")
- **applied** — "Recorded and committed. The site is rebuilding; the new
  value appears when the deploy lands." Show `applied.{old→new}` so the editor
  sees exactly what was recorded, including a series spelling folded by
  `canonical_series` (the consumer surfaces the CLI's fold note).
- **live** — link to the book row.
- **rejected** — the store's refusal message, verbatim (they are already
  written for humans and name the entry and the rule).
- **held** — "Changing a title or author moves this book's review link, so
  the owner applies it by hand. It is in the queue with your reason attached."

Between `applied` and `live` the site still shows the old value; an overlay
chip ("edit pending") is deliberately a later phase (§7 E5), not v1 — it
requires the frozen site JS to consult the worker per row, and the status page
answer above is honest without it.

---

## 6. Who may edit — capability mapping (ROLES.md §1b idiom)

Two additions to `apps/audiobook-worker/src/capabilities.ts`, in the committed
matrix's own shape:

| Capability | Floor | Covers |
|---|---|---|
| `editCatalog` | **contributor** | submitting free-tier edit requests (§2). Matches the library/games §1b floor exactly — the estate rule that a contributor may edit the catalog transplants unchanged, and the evidence-mandatory store means a bad contributor edit is a rejected request, not a corrupted file |
| `editCatalogKeys` | **moderator** | submitting title/author (key-moving) requests, which land `held` (§2). A separate capability rather than a ceremony-on-editCatalog because — unlike the library, where the attesting client performs the carry — here the submitter *cannot* complete the move; the floor limits who can queue work only the owner can finish. Judgment call, flagged for the owner: the estate contract (§5 there) prefers procedural gates over seniority, so collapsing this to `editCatalog` once the carry is automated is the expected end state |

Applying held requests is not a capability — it is the owner at the CLI.
Refusal UX is §1e verbatim: controls the role cannot use are not rendered
(`/api/me` already answers `capabilitiesFor(role)`); a refused request says
what happened, what it needs ("editing listings needs the **contributor**
role"), how to get it; the four causes stay distinct; a worker outage is
never presented as a permission problem.

**Enforcement note — why this route does not wait for the wave-A flips:** the
shadow discipline exists so that *intercepting an existing surface* changes
nothing until measured. `POST /api/edits` is a **new surface with zero
existing traffic** — there is no legacy behavior to preserve and nothing to
soak; like Phase 4's download/upload, it enforces from its first deploy
(estate check enforced per-route regardless of the site-wide `ESTATE_CHECK`
posture for the shadowed surfaces). What it *does* inherit from the migration
is everything already built: the verifier, the ladder, `/api/me`, the §1e
strings, and the estate revocation semantics that made the worker worth
building.

---

## 7. Phases — each shippable, reversible, verifiable

| Phase | Ships | Depends on | Verify / Reverse |
|---|---|---|---|
| **E1 — queue endpoint (dormant)** | `POST /api/edits` + `GET /api/edits/*` in audiobook-worker: full validation, capability gates, service-account queue writes. Nothing consumes | auth-migration Phase 0 (built); `FIREBASE_SERVICE_ACCOUNT` secret set on this worker (declared, not confirmed set — §9); `editCatalog`/`editCatalogKeys` in `capabilities.ts` + tests | curl as owner/moderator/guest: correct accept/refuse sentences; doc appears lane-suffixed. Reverse: remove routes — nothing referenced them |
| **E2 — the consumer** | `app/tools/consume_edit_requests.py` over `overrides_store`+`book_lookup`; wired into the watcher tick + metadata-run dispatch (§5.1); status write-backs; the `-F` commit shape (§4.2) | E1; a `--lane dev --overrides <tmp>` dry loop exercised first (the repo's exercise-over-reasoning rule) | file a request by curl → entry lands with evidence, commit on `origin/main`, status walks queued→applied→live. Reverse: stop the tick extension; queue holds honestly |
| **E3 — the editor UI** | an edit affordance on the book row/modal for `editCatalog` holders (rendered from `/api/me`), the status view, §1e strings. Additive new site JS in the gate-shadow.js mold — the ~9,600-line frozen zone is not rewritten, but the owner signs off the additive surface | E2; owner sign-off on touching the site | each role sees exactly its controls; a guest sees none and gets sentences if they hit the endpoint anyway. Reverse: client-only revert |
| **E4 — key-moving requests** | `editCatalogKeys` submissions land `held`; the CLI grows `apply-request <id>` so the owner's ceremony (A2 warning, `--confirm-key-move`, then the A3 backfill carry after the rebuild) applies a held request with its attribution intact | E1–E3; A2/A3 (built) | a held title edit applies end-to-end with the carry, and the review join survives — exercised on the dev lane first. Reverse: worker stops accepting key-move submissions; held docs keep |
| **E5 — optional polish** | pending-edit chip on the site; a "recent changes" page fed from the queue history; possibly `desc` joining `CORRECTABLE_FIELDS` | E3; owner appetite | — |

E1 and E2 are each roughly the size of the existing watcher/CLI siblings they
copy; nothing in the list is a multi-layer build in one dispatch.

---

## 8. What explicitly does NOT change

- **The pipeline steps and their order** — consume is a new pre-step on the
  watcher tick; `STEP_INFO`, the 8h schedule, the 2h defer rule, single-flight
  lock, and the reactive watcher's arrivals-only scope are untouched.
- **The tag-sweep tooling** — `audit_series_tags.py` stays owner-run,
  backup-first; its uncurated path stays disarmed; the web path never writes
  an m4b.
- **The overrides layer's rules** — `CORRECTABLE_FIELDS`, evidence-mandatory,
  ASIN-first keying, atomic save, refuse-invalid: one implementation, now with
  two callers (CLI + consumer).
- **The CLI** — remains the break-glass path and the only applier of key
  moves; nothing web-side supersedes it.
- **The promote lanes** — main → `/dev/`, `promote.yml` sole writer of prod,
  prod only on explicit ask; whether an overrides-driven data commit
  auto-promotes rides the existing pipeline-publish behavior unchanged (§9).
- **`firestore.rules`** — zero edits; the queue is default-deny by absence,
  on purpose (§3.3).
- **`pipeline_requests` and its token model** — the queue is a sibling, not a
  tenant; the trigger token machinery is not reused for edits (identity comes
  from real auth now).
- **The estate contract** (`edit-audit-design.md`) — this doc implements its
  audiobook column; the contract table, the key-move rules, and the
  git-is-the-audit-log verdict all stand.

---

## 9. Not measured / open at design time

1. **Nothing was executed.** No worker request, no Firestore read, no
   pipeline or consumer dry run — every flow above is designed against read
   code, not exercised. E2's dev-lane loop is the first execution.
2. **Whether `FIREBASE_SERVICE_ACCOUNT` is actually set** on the deployed
   audiobook-worker (declared in `env.ts`; the secret's presence in prod was
   not checked). E1 confirms or sets it.
3. **Watcher cadence** — the Task Scheduler interval for `pipeline_watcher`
   was not read, so §5.1's "minutes" latency is a shape, not a figure.
   Measure it when E2 lands and write the real number here.
4. **Prod promotion of a metadata-only publish** — pipeline data commits are
   known to auto-promote for book arrivals (fs_watcher's stated consequence);
   whether a rebuild whose only delta is `catalog.csv`/`index.html` metadata
   behaves identically under `promote.yml` was not verified. Check on E2's
   first real edit; if it does not promote, the edit is live on `/dev/` and
   prod waits for the next book or an explicit promote — say so in the status
   ladder rather than claiming `live`.
5. **Queue growth** — no retention design; at household scale the queue grows
   slower than the catalog (same argument as the library's `change_log`), and
   status-stamped docs are the refusal record (§4.1), so nothing auto-deletes.
   Revisit only if it ever reads as noise.
6. **The `editCatalogKeys` floor** (§6) is a recommendation carrying a
   judgment call, not an owner decision — collect it with the E1 sign-off.
7. **Multi-author and duplicate-title requests** — the consumer inherits
   `_first_credited_author` and the duplicate-titles tiebreaker from the CLI's
   logic, but a web request for a book whose title+author matches two rows
   has no interactive disambiguation; it rejects with a message asking the
   owner to apply via CLI. Frequency unknown; measured only by E2's rejects.
