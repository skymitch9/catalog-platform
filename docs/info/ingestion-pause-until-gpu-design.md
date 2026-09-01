# Soft pauses + recurring blockers + do-not-disturb processes — BUILT (v3)

> **Audience:** Claude sessions and the owner. **Status:** TRACKED, ✅ **BUILT
> 2026-09-01** (owner: *"yes lets build this"*), in two halves and in the order
> §5 demanded:
>
> | Half | Where | Commit |
> |---|---|---|
> | **Reader** — `ingest_control.py`: the two fail-OPEN fields, the recurrence evaluation, the GPU release | `audiobook_catalog` | **76aa89b** (merged **36a0f21**) |
> | **Platform** — `ops.ts` routes, the card's three-way pause + both editors, the words, the tests | `catalog-platform` | **d752d93** |
>
> ⚠️ **What is BUILT is not what is EXERCISED.** No live control document has
> been written through these routes, no human has clicked the signed-in card,
> and **the end-to-end soft-pause release has never run** — the live round trip
> §6 asks for is still owed. The operating contract, with the same NOT-verified
> list kept current, is
> [`ingestion-pause-controls.md`](ingestion-pause-controls.md) §§2, 3, 3c, 6.
>
> ⚠️ **The CARD was re-laid-out later the same day — [§9](#9-ux-condense--2026-09-01-the-same-day-after-he-used-it).**
> Presentation only: 22 visible controls in the default state became 2, and
> nothing in §§1–8 changed. Read §9 before reading the card's markup, or the
> three-button layout described in §6 will not match what is on screen.
>
> History: v1 written 2026-08-31 against a live read of `ingest_control.py`;
> **v2 the same day** after the owner's clarification replaced v1's single new
> button with a pause TAXONOMY (v1's mechanics survive as §3's GPU-release
> machinery); **v3 on 2026-09-01** after the WoW-at-midnight incident added
> §4a. The design below is left as it was written — it is the record of what
> was decided and why, not a description of the code.

## 1. The ask — two owner messages, and the model they add up to

2026-08-31, first: *"for ingestion pause, I also want a feature that says
pause until the next gpu check."* Then, clarifying: *"i want any pause thats
not the 'until i unpause' to be unpaused by either next scheduled start or
the next gpu free availability and then i can set blocker times that are
reoccuring. for instance MTW 630-1015 I want ingestion paused."*

The model:

| Kind | Ends by | Encodes as |
|---|---|---|
| **Hard pause** — "until I unpause" | a human pressing Resume. Unchanged | `paused: true` (today's form) |
| **Soft pause** — every other ad-hoc pause | **the EARLIEST of:** the next scheduled window opening (12am Phoenix), the GPU next reading sustained-free, or an explicit "until…" time if one was chosen | `paused: false` + `paused_until` + new `pause_until_gpu_free: true` (§3) |
| **Recurring blockers** — standing weekly quiet hours (e.g. Mon/Tue/Wed 6:30–10:15) | nothing — they recur until deleted; absolute while in force | new `recurring_windows` (§4) |

Unchanged: `dont_check_until` (spend-nothing deferral, not a pause),
one-shot `pause_windows`, and `pause_mode` — though soft pauses make
`manual_only` nearly redundant (a soft pause is window-exempt by
construction, since the window opening releases it).

### 1a. Interpretations pinned down (assumptions, stated so they can be corrected)

- **"Next scheduled start" = the next window-OPENING boundary**, not the next
  30-minute processor tick (that reading would make the GPU condition
  pointless — a tick always comes first). A soft pause set at 1am, mid-window,
  therefore holds until the GPU frees up or tomorrow's midnight — which is the
  behaviour that makes sense when the reason for pausing at 1am is that the
  owner is using the machine.
- **An explicit "pause until Tuesday 6pm" is still a SOFT pause** per the
  owner's own sweep ("any pause that's not the until-I-unpause"), so the
  window opening or a free GPU releases it early. If something must survive
  nights and a free GPU, that is what hard pause and recurring blockers are
  for. ⚠️ This makes the timer a CEILING, not a promise — the card wording
  must say "at latest".
- The MTW 6:30–10:15 example is taken as a shape, not a spec — the editor
  accepts any weekday set and any times, AM or PM.

## 2. What exists today (the facts the design hangs on)

1. **The §3 gotcha of [`ingestion-pause-controls.md`](ingestion-pause-controls.md):**
   `paused: true` blocks unconditionally and never consults timers, so every
   self-ending pause must be encoded flag-OFF + condition — the soft pause
   follows that rule exactly.
2. **A pause today means "don't even poll the GPU"** (`control_blocks_start`
   runs before `_gpu_clearance`). The soft pause deliberately inverts this —
   the GPU reading IS its release condition — which is why it needs its own
   field.
3. **The GPU bar is two-tier already:** single poll inside the window,
   `gpu_sustained_free(2 polls, 120s, 50%)` outside — *"a game paused on a
   menu still owns the GPU"*.
4. **Unknown fields are ignored; unknown values fail closed**
   (`normalise_pause_mode`). Each new field's old-reader behaviour is derived
   in §5's table — one of them fails OPEN and dictates deploy order.
5. **The processor already writes the control doc** (requeue clears), so
   processor-side release has a precedent and a masked write path.

## 3. The soft pause

**Dashboard writes** (both the "Pause for now" button and the "Pause until…"
picker become this one shape):

```
paused: false
paused_until: <the chosen time, or — for the bare button — the next
              00:00 Phoenix, computed at write time>
pause_until_gpu_free: true
```

Encoding the "next scheduled start" release as a timer the dashboard computes
at write time keeps the reader simple and the §3 gotcha satisfied: the window
boundary is just a timestamp, and there is exactly one new reader behaviour —
the GPU release.

**Processor release** (in `decide_start`, evaluated while the soft pause is
in force):

```
if paused_until in the future and pause_until_gpu_free:
    if gpu_sustained_free():
        write_control({paused_until: null, pause_until_gpu_free: false,
                       updated_by: "processor"})       # masked write
        if that write FAILED: stay paused this tick, log why   # fail closed
        else: fall through to the normal decision (blockers, deadline, CPU…)
    else:
        refuse with the reading: "soft-paused — GPU at 84% (> 50%);
        releases when the GPU is quiet, at latest <wordTime(paused_until)>"
```

⚠️ **Clear-then-start, never start-then-clear** — running books while the card
says paused is the dishonest-board state this surface exists to prevent.
⚠️ `dont_check_until` wins over the GPU probe (a don't-check is a
spend-nothing instruction; polling is spending); the card wording says so.

## 4. Recurring blockers

New field, standing (like `priority_front`, never consumed):

```
recurring_windows: [{days: [1,2,3], from: "18:30", until: "22:15"}]
```

- `days` are ISO weekday numbers (1 = Monday); `from`/`until` are **Phoenix
  wall clock** `HH:MM` (the estate's fixed UTC-7, no DST — same §5 reasoning
  as the existing pickers).
- **A window may cross midnight** (`from: "22:00", until: "02:00"` = the
  named day's 10pm into the NEXT day's 2am). The reader evaluates "am I
  inside one" against Phoenix now; the crossing case is a test, not a
  footnote.
- **Absolute while in force** — same rule as one-shot `pause_windows`
  (*"a pause window IS a scheduled block; letting anything override one would
  make windows mean nothing"*): no GPU reading, no soft-release, and not the
  nightly window either. ⚠️ **Consequence worth saying to the owner's face:
  a recurring blocker that overlaps 12am–8am stops scheduled ingestion for
  the overlap** — e.g. a 6:30–10:15 **AM** blocker eats the window's last
  90 minutes every named day (a **PM** one touches nothing). §7 Q-next.
- Validation in the reader mirrors `clean_id_list`'s posture: this is another
  repo's promise, so a malformed entry is dropped WITH a log line, bounded
  (`MAX_RECURRING_WINDOWS = 20`), and never crashes the guard. ⚠️ But unlike
  a malformed requeue id, a malformed BLOCKER dropped silently would run the
  GPU during hours the owner blocked — so the processor also surfaces
  rejected entries on the board (the same lesson as `requeue_rejected`).
- Card UX: a small standing list under Operations — weekday checkboxes, two
  time fields, add/delete rows; each row rendered in words ("Mon Tue Wed,
  6:30 PM – 10:15 PM"). Deleting is the only edit (replace = delete + add).

## 4a. Do-not-disturb processes (v3, owner incident 2026-09-01)

Owner, after the 2026-09-01 00:00 window start ran batch-16 transcription
beside his game: *"I was playing wow at midnight and the ingestion didnt
pause. is there an alternate check I can add to make sure World of Warcraft
is an exemption."*

**Why the existing guard could never catch this:** inside the window
`_gpu_clearance` is a SINGLE lenient poll — *"at 2am the window IS the
guarantee"* — and the incident falsified that guarantee. Worse, no
utilisation threshold can ever be strict enough: the module's own words are
*"a game paused on a menu still owns the GPU the moment it unpauses;
loading screens read 3%"*. **Process PRESENCE is the check that cannot be
fooled by an idle frame.**

New field, standing (dashboard-editable like `priority_front`):

```
exempt_processes: ["Wow.exe", "WowClassic.exe"]
```

- **Semantics: any listed process running ⇒ the machine is IN USE ⇒ no new
  book starts of any kind** — GPU or CPU, window or not. (Consistent with
  Q4's *"block everything"* taste; a per-lane split can come later if packing
  during a game ever proves wanted.) A book already mid-transcription is not
  killed — same as every other guard, this gates STARTS.
- It also **holds a soft pause's GPU release**: release requires sustained-
  free AND no exempt process running, or a menu dip re-creates the incident.
- **Check:** `tasklist /FO CSV /NH` (dependency-free on this box), image name
  compared case-insensitively, exact match. Evaluated wherever the GPU
  clearance runs, including the in-window single-poll path — that line is the
  fix for the incident. Cheap (~100 ms) and logged when it bites:
  *"Wow.exe is running — the machine is in use; no new starts"*.
- **Fail posture:** an unreadable process listing is treated as IN USE, with
  a loud log line — the same fail-toward-not-starting the GPU and CPU guards
  take. The escape from a permanently broken `tasklist` is deleting the list
  entries from the card.
- Validation mirrors `clean_id_list` (another repo writes it): bounded
  (`MAX_EXEMPT_PROCESSES = 20`), malformed entries dropped with a log line
  and surfaced on the board.
- Card UX: a small standing list beside the recurring blockers — add/delete
  process names, each row echoed back in words.
- ⚠️ Old reader ignores the field → **fails OPEN**, same as
  `recurring_windows` — one more reason the reader half ships first (§5).
- Seed the list with `Wow.exe` + `WowClassic.exe` at build time and verify
  the image names against his actual client (`tasklist` while WoW runs)
  rather than trusting memory.

## 5. Old-reader behaviour per field — and the one that dictates deploy order

| Field | Un-updated `ingest_control.py` does | Direction |
|---|---|---|
| `pause_until_gpu_free` | ignores it → soft pause runs to its `paused_until` ceiling | fails CLOSED (pause merely lasts longer) ✅ |
| soft pause's computed `paused_until` | honoured today already | ✅ |
| `recurring_windows` | **ignored → the machine RUNS during blocked hours** | 🔴 fails OPEN |
| `exempt_processes` (§4a) | **ignored → starts beside a running game** | 🔴 fails OPEN |

🔴 **Therefore: the reader ships FIRST, the dashboard's blocker editor only
after.** The reverse order gives the owner an editor whose rows silently do
nothing — the exact "control with an invisible side effect" this surface
bans. (The GPU-release half has no ordering constraint.)

## 6. Surface changes

| Piece | Change |
|---|---|
| `audiobook_catalog/app/core/ingest_control.py` | `pause_until_gpu_free` + `recurring_windows` on `ControlState` (coerced in `__post_init__`), recurrence evaluation in `control_blocks_start`, GPU release in `decide_start`, worded refusals for each |
| `apps/auth-worker/src/ops.ts` | soft-pause action (computes next-midnight ceiling), recurring add/delete actions; masks carry only what changed, per the contract's §3b discipline; Resume/Start-now clear `pause_until_gpu_free` and the soft ceiling but ⚠️ never touch `recurring_windows` (the Start-now-vs-Resume lesson, §3a, applies verbatim) |
| `status/index.html` + `status.js` + `assets/ingestion-time.js` | the pause control becomes a three-way choice — **Pause until I unpause** / **Pause for now** (soft) / **Pause until…** (soft with a ceiling) — plus the blocker list; ALL words in `ingestion-time.js` |
| Tests | recurrence incl. midnight-crossing + Phoenix pinning; GPU release / busy / unreadable / write-fail / dont-check precedence; masks incl. "blockers survive every other action"; failing-before where applicable |
| [`ingestion-pause-controls.md`](ingestion-pause-controls.md) | §2/§3 tables updated in the build commit |

**Effort:** M — roughly a day and a half across both repos (the recurring
editor and its validation are the growth over v1), then one live round trip:
set a soft pause with the GPU busy, watch the worded refusal, free the GPU,
watch the processor release it; set a 5-minute recurring blocker and watch it
bite and lapse. The standing "the signed-in card has never been clicked by a
human" debt gets paid in the same session.

## 7. Owner questions — asked ONE at a time

1. ✅ **ANSWERED 2026-08-31** (the clarification above): soft pauses release
   at the earliest of window-open / GPU-free / explicit ceiling, and
   recurring weekly blockers exist.
2. ✅ **ANSWERED 2026-08-31** (owner: *"pm and your rule is fine"*): blockers
   beat the nightly window when they overlap, and the MTW 6:30–10:15 example
   is PM — evening hours, no overlap with 12am–8am in practice.
3. ✅ **DECIDED 2026-08-31** (owner: *"your choice"* — delegated, the
   recommendation taken): **sustained-free**, 2 polls 120s apart under 50% —
   the same `gpu_sustained_free()` bar opportunistic starts use, so there is
   one definition of "the GPU is free" in the whole module. A loading-screen
   dip cannot unpause mid-game; the cost is ~4 minutes of release lag.
4. ✅ **ANSWERED 2026-09-01** (owner: *"block everything"*): while a soft
   pause waits, nothing runs — CPU packing included. The GPU reading is only
   the release trigger; paused means paused.

5. **v3 addition (2026-09-01), settled in principle** — the WoW incident's
   fix is §4a's `exempt_processes`. Defaults chosen without a fifth
   round-trip, vetoable: a listed process blocks ALL new starts (matching
   Q4's taste), the list is dashboard-editable, an unreadable process
   listing fails toward not-starting.

**All questions are settled.** ✅ **BUILT 2026-09-01**, reader half first per
§5's two fail-open rows — see the header table for the two commits, and
[`ingestion-pause-controls.md`](ingestion-pause-controls.md) §6 for what is
still unexercised (chiefly the live round trip §6 above describes).

### 8. Deviations from this design, as built — stated rather than buried

1. **`pause_until` was CHANGED, not left alone.** §6's surface table implied a
   new soft action beside the existing picker; in fact §1a's ruling ("an
   explicit *pause until Tuesday 6pm* is still a SOFT pause") means the existing
   `pause_until` action itself now writes `pause_until_gpu_free: true`. It is
   the one non-additive change in the build, and it is why the card's picker
   label had to gain the words "at latest".
2. **The three-way pause kept the `pause_mode` question on the HARD pause
   only.** A soft pause is window-exempt by construction, so 'all' vs
   'manual_only' has nothing to decide there; asking anyway would have been a
   question with one honest answer. "Pause now…" was renamed "Pause until I
   unpause…" so that two adjacent buttons do not differ by one word and mean
   opposite things.
3. **`fsValue()` in `ops.ts` gained an `integerValue` branch.** Weekday numbers
   are the first integers on this document and Firestore REST sends an integer
   as a *string*; without the branch every blocker would have decoded to a
   dropped row, invisibly. Not in the design because nobody had looked at the
   wire shape yet.
4. **Seeding the do-not-disturb list was NOT done.** §4a said "seed the list
   with `Wow.exe` + `WowClassic.exe` at build time"; seeding means writing the
   live control document, which this build deliberately did not do (no
   fabricated identity against a live gate). They are offered as one-tap
   suggestions on the card instead, and the owner's first tap is what creates
   them. `Wow.exe` is verified from his own `tasklist`; `WowClassic.exe` is not.

## 9. UX condense — 2026-09-01, the same day, after he used it

Owner, having used the card built that morning: *"this all works good, the time
selector is a not my favorite and its getting to be a lot of menus and buttons,
can you reassess and condense for a better ux."*

⚠️ **PRESENTATION ONLY. Nothing in §§1–8 changed** — not a route, not a written
shape, not a field, not a semantic. `ops.ts` was not touched. The same four
pause meanings, the same Resume/Start-now distinction (§3a), the same two
standing lists surviving every other action (§3c). What changed is **how many
controls are on screen at once**.

**Measured, default state, signed in, nothing paused:** the card carried **22
visible interactive elements** (4 pause/resume buttons + 2 pickers + their 2
Set buttons + 7 weekday checkboxes + 2 blocker time fields + Add blocker + the
program box + Add program + 2 quick-adds). It now carries **2** — one button
and one disclosure. Everything else is one tap away.

| Was | Is | Why |
|---|---|---|
| Four standing buttons (**Pause until I unpause…**, **Pause for now**, **Resume**, **▶ Start now**) | **ONE contextual button** — `Pause…` when there is nothing to resume, `Resume` when there is | Three of the four were always wrong for the current state. "Resume" over a running pipeline and "Pause for now" over an already-paused one are controls that mean nothing, and four of them together were most of *"a lot of menus and buttons"*. The choice is made by `describeIngestion()`'s new `primary`, beside the words, not in the DOM file |
| **▶ Start now** always visible | shown **only inside a live `pause_window`** (`showStartNow`) | That is the ONE state where it differs from Resume (§3a: Resume drops the window in force, Start now deliberately does not). Everywhere else the two write the same document, so the second button is noise |
| Pausing = pick one of three buttons; the hard one then asks a question | **One `Pause…` opens four answers** — *For now* / *Until a time…* / *Until I unpause* / *Don't even check until a time…* — each carrying the sentence naming its consequence | The 2026-08-23 grammar generalised: the button opens a question and the answer IS the confirmation, so a pause is still exactly two gestures. "Until I unpause" keeps its own second question, because `pause_mode` is a real difference in what the pause MEANS |
| Two `datetime-local` pickers, always on screen | a **chip row computed in Phoenix at open time** — *In an hour*, *In 3 hours*, *7:00 PM today*, *Midnight tonight*, *8:00 AM tomorrow* — with the picker behind **Custom…** | The owner's actual complaint. A datetime-local asks for a date, an hour, a minute and an AM/PM on a phone keyboard to express "an hour from now". Chips are labelled with `wordTime()`'s own vocabulary, so a chip reads exactly as the status line above it, and they write the **same shapes through the same routes** |
| Two standing editors, always expanded | **one `Schedules & exemptions` disclosure**, collapsed, whose summary carries the counts in words | Two editors that outlive every button beside them do not need to be open while somebody is deciding whether to pause for an hour |

**The three rules the condense had to obey, and how each is kept:**

1. ⚠️ **Collapsed must never read as absent.** The disclosure's summary states
   the counts (*"2 blockers · 1 exemption"*, or *"none set"* — stated, never
   blank), and when a blocker is **in force right now** it leads the line in
   amber: *"Blocker in force until 10:15 PM · 1 blocker · 1 exemption"*. A live
   blocker behind a closed disclosure would be the invisible control this whole
   surface exists to prevent.
2. ⚠️ **A chip's label must name the instant the chip writes.** Same class of
   bug as the Phoenix conversion — the words and the stored instant would agree
   with each other while both being wrong — so it is a test, not a comment.
   Chips already past or **less than ten minutes away are dropped**, never
   rolled forward: offering a 23-hour pause under a label reading "7:00 PM"
   would be worse than offering nothing.
3. ⚠️ **A failed READ is its own state.** The card cannot know which single
   button is right when it could not read the document, so it offers **both**
   and says why — and the disclosure summary says *"cannot read these right
   now"* rather than *"none set"*, which would be a stronger and falser claim.

**Consequence, admitted rather than buried:** changing the KIND of pause now
costs Resume-then-Pause, because a paused card offers no Pause button. That is
two extra taps on an uncommon flow, traded for a card that never shows three
controls that would do nothing.

Words in `assets/ingestion-time.js` (`PAUSE_MENU`, `pausePresets()`,
`standingSummaryWords()`, `whenTitleWords()`, plus `primary`/`showStartNow` on
`describeIngestion()`), DOM in `pipelines.js`, CSS in `status-shell.css`. No new
asset file, so `_headers`/CSP are untouched. **18 new tests** (`ingestion-time`
59 → 77; workspace 2185 → 2203, 0 fail), every existing assertion intact.
