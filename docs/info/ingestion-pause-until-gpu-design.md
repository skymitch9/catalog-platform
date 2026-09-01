# Soft pauses + recurring blockers — DESIGN ONLY (v2)

> **Audience:** Claude sessions and the owner. **Status:** TRACKED, **DESIGN
> ONLY — nothing built** (owner: *"plan this dont buil yet"*). v1 written
> 2026-08-31 against a live read of `ingest_control.py`; **v2 the same day**
> after the owner's clarification replaced v1's single new button with a
> pause TAXONOMY. v1's mechanics survive as §3's GPU-release machinery.
> ⚠️ Nothing live was measured beyond reading source; no control doc written.

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

## 5. Old-reader behaviour per field — and the one that dictates deploy order

| Field | Un-updated `ingest_control.py` does | Direction |
|---|---|---|
| `pause_until_gpu_free` | ignores it → soft pause runs to its `paused_until` ceiling | fails CLOSED (pause merely lasts longer) ✅ |
| soft pause's computed `paused_until` | honoured today already | ✅ |
| `recurring_windows` | **ignored → the machine RUNS during blocked hours** | 🔴 fails OPEN |

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
4. **Scope while a soft pause waits:** block everything (recommended) or let
   CPU-only packing continue?
