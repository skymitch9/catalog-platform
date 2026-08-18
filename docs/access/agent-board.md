# Agent board — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (this file
> names the secret; the VALUE lives only in the gitignored custody file below).
> Last verified: **2026-08-18** — every command here was RUN on that date, not
> transcribed: the secret was minted and stored, the migration applied, the
> Worker deployed, all three refusal paths exercised against the live host, and
> a real board pushed and read back out of D1.

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
| **Read by** | `scripts/push-agent-board.mjs`, and nothing else |
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
npm run db:migrate                                     # applies 0012 remotely
npx wrangler deploy
```

⚠️ **0012 is purely additive** — one `CREATE TABLE IF NOT EXISTS agent_board`
on a new object, no `ALTER`, no `DROP`, nothing existing touched. That is what
made applying it `--remote` safe, and it is the property to re-check before
applying any successor unattended.

⚠️ **wrangler on Windows sometimes prints success and exits 255** — read the
output, not the exit code. (Not observed on 2026-08-18's runs, which exited 0;
recorded because the next session will not know that.)
