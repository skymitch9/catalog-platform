# Local key custody — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED (this file
> only — **every other file in this folder is gitignored**).
> Last verified: **2026-08-18** — the ignore rules were proved with real files,
> not read off `.gitignore`: a probe token file written into this folder does
> not appear in `git status --untracked-files=all`, and this README does.

⚠️ **THIS REPO IS PUBLIC ON GITHUB.** One mis-staged file in this folder is a
published credential. That is why `.gitignore` excludes `docs/access/keys/*`
wholesale rather than matching filenames — a differently-named key must not be
able to slip past a pattern nobody remembered to update.

⚠️ **The rule is `keys/*`, not `keys/`, and the difference is load-bearing.**
Git never descends into an excluded *directory*, so `keys/` plus
`!keys/README.md` silently ignores this README too. Excluding the CONTENTS
leaves the directory walkable, which is the only reason one file can be
re-included. Measured here on 2026-08-18, the wrong way round first.

⚠️ **SUPERSEDED IN PART, 2026-08-20 — READ THIS BEFORE ROTATING ANYTHING
HERE.** Both tokens in the table below can now be **minted from
<https://heygabi.ai/status/api>** (as *Agent board publisher* and *Service
event log*), where they are stored as a SHA-256 hash and shown once. The
`wrangler secret put` route and these custody files still work and are still
correct — the auth Worker accepts the minted key **or** the legacy env secret
— but they are no longer the preferred path, and a session that follows only
this file will not know a minted key may already be in force.

**What actually changes for you:**
- **Rotating:** prefer the page. It needs no file, no BOM-safe transport and no
  re-distribution, and it keeps the old value alive 24 h so a half-finished
  rotation cannot strand a writer.
- **These files become vestigial** once each Worker reports on a minted key
  (observable: the key's `Last used` on that page). **Delete the file and the
  env secret together at that point**, not before — until then they are the
  custody copies of live credentials.
- Everything below about **one value per file, no trailing newline, and never a
  PowerShell pipe** still applies verbatim to any value you do handle by hand.

Full registry and reasoning: [`../machine-keys.md`](../machine-keys.md).

## What lives here

Raw secret **VALUES** that a script on the owner's own machine needs in order
to run. Nothing else — no notes, no exports, no backups.

| File | Holds | Read by | Doc |
|---|---|---|---|
| `estate-conductor-token.txt` | `ESTATE_CONDUCTOR_TOKEN` — the bearer for `POST /api/estate/ops/agent-board` | `scripts/push-agent-board.mjs` | [`../agent-board.md`](../agent-board.md) |
| `claude-usage-token.txt` | `CLAUDE_USAGE_TOKEN` — the bearer for `POST /api/estate/claude/usage` (the Claude budget card on /status) | `scripts/report-claude-usage.mjs` | [`../machine-keys.md`](../machine-keys.md) |
| `estate-events-token.txt` | `ESTATE_EVENTS_TOKEN` — the bearer for `POST /api/estate/ops/worker-events` (the /status event ring) | the **Workers themselves**, via `@platform/estate-events` | [`../../info/worker-event-ring.md`](../../info/worker-event-ring.md) |

⚠️ **`estate-events-token.txt` is the one row here whose reader is not a local
script.** Minted 2026-08-18 and set as a Worker secret on **`estate-auth`,
`catalog-index` and `audiobook-worker`**. The file is the *custody copy*: what a
fourth Worker is handed when it adopts the ring, and what a rotation
re-distributes. Nothing on this machine reads it at runtime.

⚠️ **It exists precisely so `ESTATE_CONDUCTOR_TOKEN` does not spread.** The
conductor token can rewrite the agent board — the estate's whole picture of what
is running. This one's entire power is appending a line to a capped, self-
trimming noticeboard. Never substitute one for the other to save a `wrangler
secret put`; the reasoning is
[`worker-event-ring.md`](../../info/worker-event-ring.md) §4.

**Rotating it** (store-then-overwrite, rule 4 below): mint, then `wrangler
secret put ESTATE_EVENTS_TOKEN` by the file-redirect transport from **each** of
`apps/auth-worker`, `apps/index-worker` and `apps/audiobook-worker`, and only
then overwrite this file. ⚠️ The auth Worker also still accepts
`ESTATE_CONDUCTOR_TOKEN` on that route, so a half-finished rotation degrades to
"the writers cannot report" — never to a door nobody can open.

## The rules

1. **One value per file**, written with `printf '%s'` and no trailing newline.
   The readers here `.trim()`, but a value that only works because a reader was
   forgiving is a value that breaks the first time it meets one that is not.
2. ⚠️ **Never a PowerShell pipe when the value is going to `wrangler secret
   put`.** A piped secret picks up an invisible UTF-8 BOM and the stored
   credential is then wrong *while looking perfect everywhere a human can
   check it*. The only sanctioned transport is the file redirect, written out
   in full in [`../agent-board.md`](../agent-board.md) §3; the incident that
   made it a rule is [`../discord-bot.md`](../discord-bot.md) §7.
3. **The doc names the secret; this folder holds it.** Every file here has a
   row above pointing at the tracked doc that says what it is, what holding it
   authorises, and how to rotate it. A key with no doc row is a key nobody can
   rotate.
4. **Rotation is store-then-overwrite**, never edit-in-place: mint, put it on
   the Worker, *then* overwrite the file here — so a half-finished rotation
   leaves the old working value rather than a value that matches nothing.

## ⚠️ NOT verified / deliberately absent

- **Nothing here is backed up off this machine, on purpose.** Every value in
  this folder is conductor-MINTED (`openssl rand -hex 32`), not portal-issued,
  so losing the folder costs one re-mint and one `wrangler secret put` per
  file — not an account recovery. Do not "back it up" somewhere less private
  to solve a problem that does not exist.
