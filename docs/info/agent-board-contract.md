# Agent board — the pushed state blob   (Information Reference)

> **Audience:** Claude sessions and whoever writes the next pusher.
> **Status:** TRACKED. Last verified: **2026-08-18** — the shapes below were
> read off the code that consumes them (`status/lib/board.js`,
> `status/agents/agents.js`, `status/processing/processing.js`) and the code
> that stores them (`apps/auth-worker/src/agent-board.ts`), not off a design
> note.
>
> **Amended later the same day:** the `processing` half is no longer a
> handshake. `scripts/push-processing-board.mjs` sends it from the home
> machine every 15 minutes; a real push was read back out of D1 with 158
> history rows, 4 queue lanes and the conductor's `agents` section intact
> beside it. §9 is new and is the part a second pusher must read first.

One JSON object, pushed by a machine, rendered by two pages.

| | |
|---|---|
| **Write** | `POST https://auth.heygabi.ai/api/estate/ops/agent-board` — `Authorization: Bearer $ESTATE_CONDUCTOR_TOKEN`, optional `X-Estate-Pushed-By` |
| **Read** | `GET` same path — `requireDevops()`, a signed-in person in a browser |
| **Store** | ONE D1 row (`agent_board`, migration 0012), last-write-wins |
| **Pusher** | [`scripts/push-agent-board.mjs`](../../scripts/push-agent-board.mjs) — the one implementation of the POST |
| **`processing` pusher** | [`scripts/push-processing-board.mjs`](../../scripts/push-processing-board.mjs) — projects this machine's ingestion artefacts, merges, and execs the above |
| **Custody** | [`docs/access/agent-board.md`](../access/agent-board.md) |
| **Renders on** | [/status/agents](https://heygabi.ai/status/agents/) (`agents`, `events`, `usage`) · [/status/processing](https://heygabi.ai/status/processing/) (`processing`) |

---

## 1. Why this is a DOC and not a schema

The Worker validates the **envelope** and nothing else: it must be a JSON
**object** (not an array, not a bare value) and under **256 KB**. It stores the
bytes whole.

⚠️ **That is deliberate, and it is the single most important decision here.**
The home-machine pipeline that will fill `processing` does not exist yet. A
validator that insisted on today's field list would reject tomorrow's correct
push, and a D1 schema naming today's columns would need a migration the day the
other side shipped. So the contract lives in this file and in the renderers'
tolerance.

⚠️ **The renderers therefore carry the other half of the deal.** Every field is
read defensively; every missing one degrades to a **worded line**, never to
`undefined`, never to a hopeful blank, and never to a zero. Two rules fall out
of that and both are load-bearing:

- **A missing number is not zero.** A missing usage figure is not "plenty of
  budget"; a missing queue depth is not "nothing waiting"; a missing progress
  percentage is not "has not started".
- **Silence has four causes and they never collapse into one:** nothing ever
  pushed / pushed but this section is empty / the poll failed / this half is not
  built yet. Each has a different fix, so each gets its own sentence.

## 2. The envelope

```json
{
  "agents":     [ … ],
  "events":     [ … ],
  "usage":      { … },
  "processing": { … }
}
```

Every section is **optional**. An absent section renders as its own sentence on
the page that owns it. Unknown top-level keys are stored and ignored — adding
one is not a breaking change.

⚠️ **`pushed_at` is NOT in the blob and must not be.** The Worker stamps it from
its own clock when the write lands, and that is the timestamp both pages measure
their freshness against. A pusher's own clock can be wrong, stale or missing; an
age display built on it would be worth nothing. Put a pusher-side timestamp
inside a section only when it means something *different* (see `usage.read_at`
and `processing.packs.as_of` below — two clocks that genuinely differ from the
push clock).

## 3. `agents` — what is running now

Array of objects. Rendered as cards on /status/agents.

| Field | Type | Notes |
|---|---|---|
| `id` | string | falls back to the row's name when `name` is absent |
| `name` | string | the headline |
| `state` | string | `running` · `queued` · `landed` · `failed` get a coloured dot; **anything else renders grey with its own word shown verbatim** |
| `model` | string | shown as a badge — the owner asked for "which model each runs on" |
| `task` | string | free text, one line |
| `started_at` | ISO instant | → "started 40m ago"; absent says so out loud |
| `tokens` | number | locale-formatted when finite |

⚠️ **An unrecognised `state` is information, not an error.** The page shows the
word the conductor sent rather than flattening it to "unknown" — a new state is
the conductor saying something new, and losing it would hide the arrival of a
whole class of agent event.

⚠️ **The page never judges.** No "probably stuck", no burn rate, no ETA. It
renders ages and states; the conductor knows what a long run means for a given
task and a browser does not.

## 4. `events` — the feed

Array of objects, rendered newest-first on /status/agents.

| Field | Type | Notes |
|---|---|---|
| `kind` | string | `dispatched` · `landed` · `failed` · `killed` are coloured; others render neutral |
| `at` | ISO instant | rows with no readable time **sink to the bottom, they are not dropped** |
| `agent` | string | who |
| `detail` | string | what |

⚠️ **The page sorts; the push does not have to.** A pusher that appends hands
this the oldest-first order, and a feed silently rendered that way looks like
nothing has happened all day. Trimming the feed is the **pusher's** job — the
256 KB cap exists to catch an un-trimmed one, and its refusal names the measured
size.

## 5. `usage` — the three meters

Object. Rendered as tiles on /status/agents, because usage **is** Claude
capacity — the same subject as the agents, not a health figure.

| Field | Type | Notes |
|---|---|---|
| `session_pct` | number | amber 80, **red 89** |
| `weekly_pct` | number | amber 88, **red 93** |
| `fable_pct` | number | amber 88, **red 93** |
| `*_resets_at` | ISO instant | e.g. `session_resets_at`; shown as a local date when readable |
| `read_at` | ISO instant | ⚠️ **when the figures were read off the usage page** |
| `note` | string | appended to the read-at line |

⚠️ **The thresholds differ per meter on purpose, and that difference is the
whole point of the rule they come from:** a session reset costs a nap, the
weekly reset costs days. A single shared threshold would quietly throw that
away. They are the estate's **written** thresholds, not numbers this page
invented — the tile colours come from percentages the conductor measured.

⚠️ **`read_at` is a SECOND CLOCK and is mandatory in spirit.** The board's push
age says when the snapshot was published; `read_at` says when the numbers inside
it were actually taken, and the two can differ by hours. Without it the page
prints a warning in place of the age, because *a percentage whose age is unknown
is not a reportable figure*.

## 6. `processing` — GABI's knowledge base

Object. Rendered on /status/processing. **Pushed since 2026-08-18** by
`scripts/push-processing-board.mjs` — every 15 minutes from the scheduled task
`EstateProcessingBoardPush`, plus once off the back of every ingestion run. The
page's "the home-machine pipeline is not pushing one yet" sentence is now a
statement about a **broken pusher**, not an unbuilt one: if you see it, check
`audiobook_catalog/output_files/processing_push.log`.

```json
"processing": {
  "in_flight": [
    { "title": "…", "author": "…", "lane": "epub", "percent": 42,
      "step": "chapter 12 of 31", "started_at": "…", "updated_at": "…", "eta": "…" }
  ],
  "queue": [ { "lane": "deferred-pdf", "count": 25, "note": "…" } ],
  "packs": { "packed": 157, "books": 182, "needs_ocr": 25, "chunks": 0,
             "ingester_version": "…", "as_of": "…", "note": "…" },
  "history": [
    { "title": "…", "author": "…", "lane": "epub", "joined_at": "…",
      "ingester_version": "…", "chunks": 0, "note": "…" }
  ]
}
```

**`in_flight`** — `percent` is the pipeline's own count of finished units. The
page draws the bar and never estimates one; a missing percentage draws no bar at
all rather than an empty one.

⚠️ **AND TODAY THE PIPELINE HAS NO SUCH COUNT, so the push omits `percent`
entirely.** Measured 2026-08-18: faster-whisper's worker
(`estate-training-data/work/_whisper_worker.py`) prints a genuine progress line
every 60 seconds — hours of audio, wall minutes, realtime factor — but
`app/tools/ingest_books.py` runs it through `subprocess.run(...,
capture_output=True)`, so those lines sit unread in a pipe until the book
finishes. Nothing on disk counts finished units mid-book. An elapsed-versus-
duration guess was considered and rejected twice over: the field is where the
page gets the bar it promises never to estimate, and the two transcriptions
timed that day ran at very different realtime factors, so the "~85×" figure is
a range, not a rate. The reason lives in `step`, in words, where it renders as
a sentence. **Closing this gap means the ingester tee-ing that worker's output
to a file** — a pipeline change, not a pusher one.

**`queue`** — accepted in **both** shapes: an array of `{lane, count}` rows or a
plain `{lane: count}` map. Six lines of tolerance in `normaliseQueue()` beats
discovering a shape mismatch on the day the pipeline ships, when the section
would look empty rather than wrong. Known lanes get friendly labels
(`audiobook-with-review`, `audiobook`, `epub`, `text-pdf`, `deferred-pdf`,
`needs-ocr`); **an unknown lane renders its own key verbatim** rather than being
dropped or relabelled "other" — a new lane is the arrival of a whole processing
route and must not vanish.

**`packs.as_of`** — the manifest's own clock, a third one. It may have been read
hours before the board was pushed; showing the counts under the push age alone
would silently promote a stale count to a fresh one.

**`history.joined_at`** — ⚠️ **the date the pack became SERVABLE, not the date
the book was transcribed**, and the page never derives one from the other. This
is the owner's own label ("when it became part of GABI's knowledge base"). A row
with no readable `joined_at` says *"In the knowledge base — the push carried no
join date"*: it does not fall back to a timestamp that means something else, and
it is not dropped.

## 7. Refusals — what the Worker says and why

| Cause | Status | What it means |
|---|---|---|
| secret unset on the Worker | **503** `conductor_token_unset` | ships dark; names the exact `wrangler secret put` |
| no/!Bearer header | **401** `unauthenticated` | |
| wrong bearer | **401** `bad_token` | constant-time compare, so a wrong guess leaks no prefix |
| empty body | **400** `empty_body` | |
| over 256 KB | **400** `board_too_large` | names the measured size and the limit |
| not JSON | **400** `invalid_json` | |
| array or bare value | **400** `not_an_object` | |
| table missing | **503** `agent_board_table_missing` | the Worker shipped ahead of its migration — a real, fixable state, and **the push was NOT stored** |

⚠️ **It refuses; it never strips.** A validator that silently drops what it does
not understand is how a pusher ends up believing it published something it did
not — the estate has that bug on record.

⚠️ **`exists: false` is a 200, not a 404.** "Nothing has been pushed yet" is an
ordinary state, and a 404 here would be indistinguishable from a mis-routed URL.

## 8. Pushing one

```bash
node scripts/push-agent-board.mjs .local/agent-board.json --by "conductor@home-pc"
node scripts/push-agent-board.mjs --check      # 401 from a script is CORRECT — the read door is requireDevops()

# the processing half — builds its own section, merges, and execs the above
node scripts/push-processing-board.mjs --by "conductor@home-pc"
node scripts/push-processing-board.mjs --dry-run --print   # build it, push nothing
```

⚠️ **Push `.local/agent-board.json`, not an ad-hoc file** — see §9. A push from
anywhere else deletes whatever section you did not write.

⚠️ **This pushes what is on disk**, exactly like a directory deploy — write the
file, *then* push it. The script strips a leading BOM from the board file
(PowerShell's `Out-File` writes one and `JSON.parse` rejects it with what looks
like a syntax error in a perfect file). It never prints the token and has no
`--token` flag on purpose.

## 9. TWO PUSHERS, ONE ROW — read this before writing a third

⚠️ **The board is ONE last-write-wins row holding ONE JSON object, so a push
that carries only your section DELETES everyone else's.** There is no partial
update and there must not be one: the POST stores the bytes whole. A
`processing` pusher that sent `{"processing": {…}}` would blank /status/agents
four times an hour, and the page would render that correctly and honestly as
"nothing has been pushed" — a true sentence about a board somebody destroyed.

**The fix is a shared draft on disk, not a smarter Worker:**

| | |
|---|---|
| **Canonical board file** | `.local/agent-board.json` — **gitignored**, this repo is public |
| **Rule** | every pusher READ-MODIFY-WRITES it and pushes it **whole** |
| **Who owns what** | conductor → `agents`, `events`, `usage` · home pipeline → `processing` |

⚠️ **You cannot recover a section you did not write.** The read door is
`requireDevops()`, so no script can fetch the live board back to merge against —
the only machine-readable copy is the draft file. If /status/agents goes blank
after a processing push, the cause is a conductor push that bypassed the draft,
and the fix is to write it there. (Bootstrapping is possible but manual: read
the row with `npx wrangler d1 execute estate_auth --remote --command "SELECT
board FROM agent_board WHERE id = 1"` and seed the file from it — which is
exactly how this pusher's first push preserved the two agents already on the
board.)

⚠️ **THE KNOWN WRINKLE, STATED RATHER THAN HIDDEN: a processing push restamps
`pushed_at` for the WHOLE board.** The freshness strip on /status/agents then
reads fresh while its agent rows may be hours stale. It is survivable only
because every section carries its own clock — `agents[].started_at`,
`events[].at`, `usage.read_at`, `packs.as_of` — and both pages render those. A
conductor who stops updating the draft still gets ageing-looking *rows*, just
not an ageing-looking *strip*. **Fixing it properly means per-section push
timestamps, which is a Worker and renderer change**, and it was deliberately not
made as a side effect of shipping the pusher.

⚠️ **Trimming stays the pusher's job and the cap is closer than it looks.**
Measured 2026-08-18: 158 history rows pushed as **44,393 bytes** — ~280 bytes a
row, indented — against a 256 KB limit, with a queue of 1,064 more books behind
it. `MAX_HISTORY` is 500 (~140 KB). Raising it much past 800 needs the draft
written compact first, or the push starts answering `board_too_large` on a night
that ingested well.
