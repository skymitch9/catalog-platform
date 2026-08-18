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

## What lives here

Raw secret **VALUES** that a script on the owner's own machine needs in order
to run. Nothing else — no notes, no exports, no backups.

| File | Holds | Read by | Doc |
|---|---|---|---|
| `estate-conductor-token.txt` | `ESTATE_CONDUCTOR_TOKEN` — the bearer for `POST /api/estate/ops/agent-board` | `scripts/push-agent-board.mjs` | [`../agent-board.md`](../agent-board.md) |

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
