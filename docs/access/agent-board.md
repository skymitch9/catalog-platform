# Agent board — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (this file
> names the secret; the VALUE lives only in the gitignored custody file below).
> Last verified: **2026-08-18** — every command here was RUN on that date, not
> transcribed: the secret was minted and stored, the migration applied, the
> Worker deployed, all three refusal paths exercised against the live host, and
> a real board pushed and read back out of D1. **§7 added later the same day**
> and verified the same way: the processing pusher run for real, the scheduled
> task fired once, the batch tail exercised with a deliberate non-zero ingest
> exit code, and the stored row read back out of D1 with the conductor's
> `agents` section still beside the new `processing` one.

The push door behind [/status/agents](https://heygabi.ai/status/agents/) and
[/status/processing](https://heygabi.ai/status/processing/). What the blob must
look like is [`docs/info/agent-board-contract.md`](../info/agent-board-contract.md);
this file is about the credential.

## 1. The shape of it

| | |
|---|---|
| **Secret** | `ESTATE_CONDUCTOR_TOKEN` on the Worker `estate-auth` |
| **Custody file** | `docs/access/keys/estate-conductor-token.txt` — **gitignored**, 64 hex chars, no BOM, no trailing newline |
| **Minted by** | the conductor, `openssl rand -hex 32` (or Node's `crypto.randomBytes(32).toString('hex')` — same 256 bits from the same class of CSPRNG) |
| **Read by** | `scripts/push-agent-board.mjs`, and nothing else — see §7 |
| **Route** | `POST https://auth.heygabi.ai/api/estate/ops/agent-board` |
| **Code** | `apps/auth-worker/src/agent-board.ts`, pinned by `test/agent-board.test.ts` |

⚠️ **NOT A PORTAL VALUE.** Nobody issued this token and no account can re-read
it. Losing the custody file costs one re-mint and one `wrangler secret put` —
not an account recovery. That is exactly why it is deliberately **not** backed
up anywhere less private than the folder it lives in.

⚠️ **WHAT HOLDING IT AUTHORISES: overwriting one advisory JSON blob.** It reads
no Firestore, mints no token, grants no role and triggers no pipeline. A leak
buys the ability to **lie to the owner about his own agent capacity** — real,
and worth rotating for, but a smaller blast radius than every other secret in
this Worker. Both pages are built so the lie shows anyway: every block is
timestamped against the Worker's own clock, and a stale push reads as stale.

⚠️ **It is NOT in `CONSUMER_APPS`,** for the same reason
`ESTATE_APP_TOKEN_DISCORD_DOCS` is not: an entry there would silently make it a
valid `POST /api/estate/seen` bearer, which is a wider capability than the one
being granted.

## 2. The two doors, and why they are different

```
GET  /api/estate/ops/agent-board   requireDevops()             a person, in a browser, on the apex
POST /api/estate/ops/agent-board   Bearer ESTATE_CONDUCTOR_TOKEN  a machine, with no Firebase identity
```

⚠️ **They must never be merged.** A devops person may READ the estate's picture
of what is running; nothing about holding devops should let a browser REWRITE
it. And the conductor holds no Firebase identity at all — requiring one on the
write door would mean minting a service identity for a script, a far larger
credential than a bearer whose entire power is one JSON blob.

## 3. Minting and storing it (the BOM-free ritual) — RUN THIS EXACTLY

⚠️ **NEVER PIPE A SECRET TO `wrangler secret put` ON WINDOWS.** A PowerShell
pipe to a native process prepends an invisible UTF-8 BOM (`EF BB BF`); the
stored credential is then wrong **while looking perfect everywhere a human can
check it**, and the failure surfaces as a plain 401 with a valid-looking key.
The incident that made this a rule is [`discord-bot.md` §7](discord-bot.md), and
its first "fix" (`$OutputEncoding` + trim) was **measured not to work** and is
revoked as ritual. The only sanctioned transport is a **file redirect through
`cmd`**, whose `<` passes raw bytes untouched.

**Step 1 — mint straight into the custody file, never through a variable.** A
value that never lands in a shell variable cannot land in shell history, a
transcript, or a process table:

```powershell
node -e "const f=require('fs'),c=require('crypto');const p='docs/access/keys/estate-conductor-token.txt';if(f.existsSync(p)){console.log('REFUSING: exists');process.exit(1)}f.writeFileSync(p,c.randomBytes(32).toString('hex'),{encoding:'utf8'})"
```

Node writes UTF-8 **without** a BOM and this writes **no trailing newline** —
both properties the readers depend on.

**Step 2 — prove the bytes before trusting them** (the check that would have
caught the incident above; it prints facts about the value, never the value):

```powershell
node -e "const b=require('fs').readFileSync('docs/access/keys/estate-conductor-token.txt');console.log('bytes',b.length,'first3',b[0],b[1],b[2],'BOM would be 239 187 191')"
```

Measured 2026-08-18: `bytes 64`, first three bytes hex digits, last byte not a
newline. **64 bytes and no `239 187 191` is the pass condition.**

**Step 3 — store it with the file redirect, from `apps/auth-worker`:**

```powershell
cmd /c "npx wrangler secret put ESTATE_CONDUCTOR_TOKEN < ..\..\docs\access\keys\estate-conductor-token.txt"
npx wrangler secret list      # confirm the NAME appears; values are never listed
```

**Step 4 — prove the value END TO END, because an upload proves transport, not
correctness.** Push a board and watch it land. This is the only check that
would catch a BOM:

```bash
node scripts/push-agent-board.mjs board.json --by "conductor@home-pc"
```

Measured 2026-08-18: `✔ Pushed 1222 bytes`, stored at `2026-08-18T19:07:43.866Z`,
and the row read back out of D1 as `id 1 · pushed_by status-split-finisher@home-pc
· 961 bytes`. A BOM'd secret fails this step with a 401 `bad_token`.

## 4. Rotating it

⚠️ **EASIEST PATH FIRST (2026-08-20): mint it at
<https://heygabi.ai/status/api>** under *Agent board publisher*. The POST route
now accepts the minted key **or** this env secret, so the steps below remain
valid and remain the fallback — but the page needs no custody file, no BOM-safe
transport, and keeps the old value working for 24 h so a half-finished rotation
cannot leave the board unwritable. Registry: [`machine-keys.md`](machine-keys.md).


**Store first, overwrite second** — never edit the file in place. A
half-finished rotation must leave the OLD WORKING value behind, not a value that
matches nothing.

1. Mint a new value to a **temporary** file (same Node one-liner, different path).
2. `cmd /c "npx wrangler secret put ESTATE_CONDUCTOR_TOKEN < <tmp>"`.
3. Push a board with `--token-file <tmp>` and confirm it lands.
4. **Only then** move `<tmp>` over `docs/access/keys/estate-conductor-token.txt`.
5. Delete any temporary copy.

`$ESTATE_CONDUCTOR_TOKEN` **wins over the custody file** in the pusher's lookup
order, deliberately: it lets an operator test a value mid-rotation without
overwriting custody.

**Rotate when:** the value appears in any log, tail, transcript or screen share;
the custody file leaves this machine; or a push starts answering `bad_token`
against a file you believe is correct.

## 5. Refusals — what each one means

| Answer | Cause | Fix |
|---|---|---|
| **503** `conductor_token_unset` | the Worker holds no secret | step 3 above |
| **401** `unauthenticated` (POST) | no `Authorization: Bearer` header | send it |
| **401** `bad_token` | wrong value — **or a BOM'd one** | step 4, then §4 |
| **401** `unauthenticated` (GET) | not signed in | this door is `requireDevops()`, so a script gets this and that is CORRECT |
| **503** `agent_board_table_missing` | Worker shipped ahead of migration 0012 | `npm run db:migrate` from `apps/auth-worker` — **the push was not stored** |

⚠️ **It ships dark and stays dark.** With the secret unset the POST answers the
503 above and **never** falls back to accepting an unauthenticated write — the
one failure mode a write door must not have. Verified live 2026-08-18: all three
401 paths answer with a full sentence naming what happened, what it needs, and
where custody lives.

## 6. Deploy order (it matters)

**Migrate, then deploy.** New code must never meet an old schema:

```powershell
cd apps\auth-worker
npx wrangler d1 migrations list estate_auth --remote   # see what is pending
npm run db:migrate                                     # applies 0012 + 0013 remotely
npx wrangler deploy
```

⚠️ **0012 is purely additive** — one `CREATE TABLE IF NOT EXISTS agent_board`
on a new object, no `ALTER`, no `DROP`, nothing existing touched. That is what
made applying it `--remote` safe, and it is the property to re-check before
applying any successor unattended.

⚠️ **0013 (2026-08-18, per-section push stamps) is additive too, and was
checked against that same bar before it was applied:** one nullable
`ALTER TABLE agent_board ADD COLUMN section_pushed_at TEXT` — no DEFAULT, no NOT
NULL, no existing column altered, no row rewritten. SQLite's ADD COLUMN in this
form is O(1) metadata.

⚠️ **AND THE WORKER IS CORRECT ON BOTH SIDES OF IT.** Read and write each
catch "no such column" and fall back to the pre-0013 statement, so a deploy that
lands a minute ahead of its migration degrades (no per-section ages, and the
pages SAY so) instead of 502-ing the read door. That is a seatbelt, **not
permission to skip migrate-then-deploy** — the order above still stands. What it
buys is a safe rollback: the previous Worker build keeps working against the
migrated schema.

⚠️ **wrangler on Windows sometimes prints success and exits 255** — read the
output, not the exit code. (Not observed on 2026-08-18's runs, which exited 0;
recorded because the next session will not know that.)

## 7. The `processing` pusher and its cadence (added 2026-08-18)

The owner looked at /status/processing the day it shipped and said *"processing
doesn't seem wired up yet"*. It wasn't — the page, the renderer and the write
door all landed; the pusher did not. It does now.

| | |
|---|---|
| **Pusher** | `scripts/push-processing-board.mjs` (projection: `scripts/lib/processing-board.mjs`, pinned by `scripts/test/processing-board.test.mjs`) |
| **Canonical board file** | `.local/agent-board.json` — gitignored; see the contract's §9 |
| **Cadence A** | `EstateProcessingBoardPush` — Task Scheduler, **every 15 minutes**, hidden via `audiobook_catalog/scripts/push_processing_board_hidden.vbs` |
| **Cadence B** | a soft-fail tail appended to `audiobook_catalog/scripts/ingest_nightly.bat` (fires every 30 min with the ingester) |
| **Log** | `audiobook_catalog/output_files/processing_push.log` |

⚠️ **IT NEVER READS THE TOKEN.** It builds the section, merges it into the
draft, and then **execs `push-agent-board.mjs`**, which is the only code in the
estate that opens the custody file. Two scripts that both knew the bearer ritual
would be two places for §3's BOM incident to happen again. The token does not
enter the pusher's process, its argv, or its environment.

⚠️ **IT IS READ-ONLY ON A LIVE PIPELINE, INCLUDING THE LOCK.** It reads
`output_files/ingest_books.lock` and never acquires it — opening that file for
writing would race a running transcription for its own single-flight guard. It
starts no python and waits on nothing.

⚠️ **BOTH CADENCES SOFT-FAIL, AND THAT IS THE DESIGN.** The batch tail captures
the ingester's exit code *before* pushing and hands it back at the end, so
`AudiobookIngestNightly`'s LastTaskResult still means what it meant; the
dedicated task always exits 0, because a failed status push is not a failed
machine and a task history full of red trains the owner to ignore the row that
matters. A failure is visible in the log above and, more usefully, on the page
itself — which reports its own staleness.

⚠️ **WHY BOTH.** The batch tail only fires when its own invocation *returns*.
While a long transcription holds the lock, the 30-minute invocations exit on it
within seconds and push from there — but the invocation actually doing the
transcribing pushes nothing for hours, which is precisely when "which book is
being processed right now" is worth having. The 15-minute task closes that.

**Running it by hand:**

```powershell
node scripts/push-processing-board.mjs --by "conductor@home-pc"
node scripts/push-processing-board.mjs --dry-run --print    # build it, push nothing
Start-ScheduledTask -TaskName EstateProcessingBoardPush     # force a cadence run
Get-ScheduledTaskInfo -TaskName EstateProcessingBoardPush   # LastTaskResult should be 0
```

**Proving a push landed** — the only check that distinguishes "sent" from
"stored", and the one that caught nothing today because everything worked:

```powershell
cd apps\auth-worker
npx wrangler d1 execute estate_auth --remote --json --command "SELECT pushed_at, pushed_by, length(board) AS bytes, json_extract(board,'$.processing.packs.packed') AS packed, json_array_length(json_extract(board,'$.processing.history')) AS hist, json_array_length(json_extract(board,'$.agents')) AS agents FROM agent_board WHERE id=1"
```

Measured 2026-08-18: `pushed_by ingest-pipeline@home-pc`, 32,057 stored bytes,
`packed 158`, `hist 158`, **`agents 2`** — that last column is the one that
matters, because it is the proof the merge preserved the conductor's sections
instead of overwriting them.

⚠️ **Since 0013 there is a second column worth reading, and it answers a
question the first one cannot:** whether a section is being KEPT UP TO DATE, as
opposed to merely surviving the merge. Add `section_pushed_at` to that SELECT.
A `processing` stamp minutes old beside an `agents` stamp hours old is not a
bug — it is the display working, and it is exactly what /status/agents now
reports instead of calling the whole board fresh.

**Removing the task**, if it ever needs to stop:

```powershell
Unregister-ScheduledTask -TaskName EstateProcessingBoardPush -Confirm:$false
```

### The progress file — where the percentage comes from

`audiobook_catalog/scripts/transcribe_audiobook.py` relays the Whisper worker's
stdout byte-for-byte **and** writes
`C:\Users\nbasl\estate-training-data\work\transcribe_progress.json` on each of
its 60-second progress lines. The pusher reads that file; the field list and the
reasoning live in the contract's §6.

```powershell
Get-Content C:\Users\nbasl\estate-training-data\work\transcribe_progress.json
```

| Symptom | What it means |
|---|---|
| file absent, a book **is** transcribing | it started under ~90 s ago (ffmpeg → model load → first progress line). The card names the book and draws no bar. |
| file absent, nothing transcribing | correct — the transcriber deletes it on every exit it survives |
| file present, `updated_at` over 10 min old | the run was **killed** before cleanup. Treated as absent; the next run overwrites it. |
| card shows a book but no bar | `percent` was `null` (no container duration) or failed validation. **Not** a zero. |

⚠️ **`percent` is `transcribed span ÷ container duration` — a MEASUREMENT, the
same ratio the transcriber's truncation gate uses.** Never swap it for an
elapsed-time estimate, however much smoother the bar would move: the page draws
that bar and promises never to estimate.

⚠️ **One progress file, one path, last writer wins.** The nightly's single-flight
lock does not cover hand-run chains, so two transcriptions could in principle
overlap and the file would describe whichever wrote last. It always describes a
*real, currently-running* book — just not necessarily the only one.
`source_m4b` names which.
