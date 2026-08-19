# Ingestion pause controls — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED (public repo — no household names).
> Last verified: **2026-08-18** — routes live (401 unauthenticated, 404 on a
> neighbouring path, so the gate is real and not a routing accident); page
> shell live via `npm run verify:home`. ⚠️ **Re-verified later the same day**,
> when the three fine controls landed: the control DOCUMENT round trip is now
> exercised end to end against the live processor (§6), but the signed-in card
> itself has still NOT been clicked by a human — the two are different claims
> and §6 keeps them apart.

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
| `requeue` | `[bookId]` | ⚠️ **consumed** by the processor at its next run start, then cleared by it |
| `priority_front` | `[bookId \| series]` | books to move to the head of the queue; **never** consumed |
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
| **▶ Start now** | `paused: false`, both timers `null`, and ⚠️ **`pause_windows` untouched** — see §3a |
| **↻ Re-queue** (per book, on /status/processing) | appends the book id to `requeue` |
| **⇧ Front of queue** (per book) | appends the book id to `priority_front` |

## 3a. ⚠️ Start-now is NOT a second Resume, and the difference is one field

Added 2026-08-18 (owner-approved fine control #2). Both clear `paused`,
`paused_until` and `dont_check_until`. **Resume additionally drops a
`pause_window` in force; Start-now does not.**

Resume has to drop it, or the window re-pauses ingestion seconds later and the
button reads as broken. Start-now must not, because **quiet hours are a schedule
the owner set on purpose** — silently deleting tonight's 7pm-to-midnight window
to satisfy a one-off *"go now"* takes away a recurring instruction he never
withdrew. That is a control with an invisible side effect, which is the class of
thing this whole surface exists to prevent.

⚠️ **The consequence is admitted, not hidden: inside a live window, Start-now
clears the ad-hoc pauses and the window still blocks the start.** The route's own
`detail` sentence says so and the page renders it verbatim. A control that hid
that would be promising a run it cannot deliver.

## 3b. The two list actions, and the `updateMask` that makes them safe

`requeue` / `priority_front` / `priority_front_clear` carry `book_ids`, never
`until`. They **APPEND** rather than replace — two rows clicked a second apart
are two requests, and a replace would make the second silently cancel the
first — and the merged list is re-cleaned, so clicking the same row twice cannot
grow the document.

⚠️ **EACH LIST ENTERS THE `updateMask` ONLY WHEN THIS WRITE CHANGES IT**,
compared against what Firestore actually held moments ago. This is sharper than
the `pause_windows` rule in §4 for one reason: **the PROCESSOR writes `requeue`
too** — it removes the entries it has consumed. A pause that carried the whole
document would re-add ids the home machine had just finished acting on, and
books would be re-queued forever by a button nobody pressed. Tests pin that a
pause, a resume and a start-now all carry both lists through untouched, and that
`priority_front_clear` never touches somebody's outstanding retry.

⚠️ **Every list action's wording says NOT YET DONE.** This Worker writes a line
in a document; the home machine acts on it at the top of its next run (every 30
minutes) and clears what it acted on. Reporting *"re-queued"* on the write would
claim an outcome nothing here can observe. The page adds its own caveat that the
board is pushed every 15 minutes, so a re-queued book keeps showing as failed for
up to a quarter of an hour — saying that out loud is what stops somebody pressing
the button four more times.

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
- ✅ **SUPERSEDED 2026-08-18 — the document HAS now been written and read
  back.** The full round trip was exercised against the live control document
  and the live processor: a Worker-shaped write of `requeue` + `priority_front`
  (including deliberate junk entries), `read_control()` cleaning them, the
  unknown-id path dropping without mutating `ingest_state.json`, `ArrayRemove`
  clearing, and a read-back confirming empty. It also **found a real bug** —
  entries the reader refused survived every clear and re-warned on each read
  (`book-ingestion.md` §1). ⚠️ What is *still* unexercised is the **browser**
  path: every write above was made with the Firestore service account, not
  through `POST /api/estate/ops/ingestion` with a signed-in devops token, so the
  route's own 200 path and the card's buttons have still never been clicked by a
  human.
- **The reader was uncommitted when this was written** (`ingest_control.py`
  present in `audiobook_catalog`'s working tree, no info doc). If it changed
  after 2026-08-18, re-check §2 and §3 — §3 in particular.
