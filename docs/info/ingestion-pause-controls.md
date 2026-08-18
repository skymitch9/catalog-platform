# Ingestion pause controls — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED (public repo — no household names).
> Last verified: **2026-08-18** — routes live (401 unauthenticated, 404 on a
> neighbouring path, so the gate is real and not a routing accident); page
> shell live via `npm run verify:home`. The signed-in card itself has NOT been
> exercised by a human — see §6.

The `/status` Operations card that stops and starts ingestion on the home
machine, and the contract it shares with `audiobook_catalog`.

Owner order 2026-08-18, verbatim: *"give me a way to pause and start the
process flow on the GABI dashboard. Tonight starting at 7pm I need all of this
paused until midnight. So let me also set pause timers on the ui. I can say
don't even check to start until x time."*

## 1. The pieces

| Piece | Path |
|---|---|
| Card shell + CSS | `sites/heygabi-home/public/status/index.html` (`#ingestion-card`) |
| Card behaviour (DOM only) | `sites/heygabi-home/public/status/status.js` |
| Every word + the timezone | `sites/heygabi-home/public/assets/ingestion-time.js` |
| Routes | `apps/auth-worker/src/ops.ts` (`GET`/`POST /api/estate/ops/ingestion`) |
| Tests | `scripts/test/ingestion-time.test.mjs` (23) · `apps/auth-worker/test/ingestion-control.test.ts` (14) |
| **The reader (other repo)** | `audiobook_catalog/app/core/ingest_control.py` |
| Live pins | `sites/heygabi-home/predeploy.checks.json` (`/status/`, `/status/status.js`, `/assets/ingestion-time.js`) |

## 2. The control document

`ingestion_control/state` in the `audiobook-catalog` Firestore project. The
path is **owned by `ingest_control.py`** (`CONTROL_COLLECTION` + `CONTROL_DOC`),
not by this repo. The `/dev/` lane uses `ingestion_control_dev`; the apex
status page is prod-only and never touches it.

| Field | Type | Meaning |
|---|---|---|
| `paused` | bool | hard stop, no end time |
| `paused_until` | ISO8601 \| null | no new starts before this instant |
| `dont_check_until` | ISO8601 \| null | do not even *evaluate* the guard yet |
| `pause_windows` | `[{from, until}]` | scheduled quiet hours |
| `updated_by` | string | who wrote it |
| `updated_at` | ISO8601 | when |

## 3. ⚠️ The gotcha that shaped the whole build

`control_blocks_start()` checks, **in this order**:

1. control unreadable → **treated as paused** (their side fails closed)
2. `paused === true` → blocked, **unconditionally**
3. `paused_until` in the future → blocked until then
4. inside a `pause_window` → blocked until it ends
5. otherwise → free to start

**Step 2 never consults the timer.** So the obvious encoding of "pause until
midnight" — set the flag *and* the timer — leaves the flag true at 12:01 and
the machine paused indefinitely, which is the opposite of what was asked for.

Hence the encoding this repo writes:

| Control | Writes |
|---|---|
| **Pause now** | `paused: true`, `paused_until: null` |
| **Pause until…** | `paused: false`, `paused_until: <ISO>` — a timer with the flag **off** is the correct form of a timed pause, and it expires by itself |
| **Don't even check to start until…** | `dont_check_until: <ISO>` |
| **Resume** | `paused: false`, both timers `null`, and any window *currently in force* dropped (otherwise it re-pauses seconds later and Resume looks broken) |

`ingestion-time.js`'s `describeIngestion()` mirrors that same order, so the
card never promises a restart the reader will not perform.

## 4. Why a state document, not a request document

Everything else in `ops.ts` writes `pipeline_requests` — create-only,
unreadable, consumed once, deleted. Right for "do a thing now", wrong for "and
stay this way for five hours": a pause has to survive being read, because the
home machine consults it before every run and the page has to render what is
currently true. So this is one merged document, written with **PATCH +
explicit `updateMask`** (never a whole-document PUT) so fields the home machine
owns survive. `pause_windows` enters the mask **only** when a window actually
expired and was dropped, so an ordinary pause/resume cannot clobber a window
list written by the other side.

It is also **read through the Worker**, not off Firestore's public REST path
the way `pipeline_status/current` is — that keeps the control collection
closeable on the `audiobook_catalog` side, instead of this page quietly
imposing an `allow read: if true` on a repo it is not allowed to touch.

## 5. Time

Both pickers are read as **Phoenix wall clock**, and both labels say so. A
`datetime-local` input returns a bare string with no zone; `new Date(value)`
would read it as the *device's* zone, so a pause set from a laptop still on
Eastern would land three hours early with nothing on screen saying so.
Arizona has not observed DST since 1968, so the conversion is a fixed `-07:00`
— which is why `PHOENIX_OFFSET` and `PHOENIX_TZ` sit adjacent in the module,
and why the tests pin January and July both at UTC-7.

Their `parse_iso()` reads a **naive** value as Phoenix for the same reason.
This repo always writes a full UTC instant with `Z`, which they parse
correctly, so the two conventions do not collide.

Words, not ISO strings: `wordTime()` renders "midnight tonight", "7:00 PM
today", "8:00 AM tomorrow", "3:00 PM on Thursday". "midnight tonight" is the
owner's own phrase and is the *start of tomorrow* — rendering it as "12:00 AM
tomorrow" is true and reads as a different time at 9pm.

## 6. NOT verified

- **The signed-in card has never been rendered by a human.** Every marker in
  `predeploy.checks.json` is the shell; the buttons are injected after Firebase
  sign-in, which an unauthenticated fetch never has.
- **No write has been made to `ingestion_control/state`** from this or any
  other client. The routes answer 401 unauthenticated; nothing has exercised
  the 200 path end to end.
- **The reader was uncommitted when this was written** (`ingest_control.py`
  present in `audiobook_catalog`'s working tree, no info doc). If it changed
  after 2026-08-18, re-check §2 and §3 — §3 in particular.
