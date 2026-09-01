# Pause until the GPU is next free — DESIGN ONLY

> **Audience:** Claude sessions and the owner. **Status:** TRACKED, **DESIGN
> ONLY — nothing built** (owner: *"plan this dont buil yet"*, 2026-08-31).
> Written 2026-08-31 against the LIVE machinery: `ingest_control.py` was read
> that day (PAUSE_MODES block, `ControlState`, `control_blocks_start`,
> `_gpu_clearance`, `gpu_sustained_free`), and
> [`ingestion-pause-controls.md`](ingestion-pause-controls.md) is the contract
> this extends. ⚠️ Nothing live was measured beyond reading source; no control
> document was written.

## 1. The ask, and what it could mean

Owner, 2026-08-31, verbatim: *"for ingestion pause, I also want a feature that
says pause until the next gpu check."*

Three readings, because "the next GPU check" is not a clock event — the
processor checks the GPU only when it is deciding whether to start a book:

| | Reading | Verdict |
|---|---|---|
| **A** | **"Pause, and resume yourself when the GPU is next free"** — stop new work now; the pause dissolves on the first GPU evaluation that passes, no human unpause needed | 🎯 **Recommended.** The only reading that adds a capability: today every pause needs either a clock (`paused_until`) or a hand (`Resume`). "I'm using the GPU right now, take it back when I'm done" fits neither |
| B | "Snooze one check cycle" — skip the next evaluation only | Already expressible: `dont_check_until` + ~30 min. Not worth a control |
| C | "Block the current start, allow the next evaluation" | A one-shot no-op by the next tick; same as B in practice |

The rest of this design is reading A. **§6 Q1 confirms it with the owner
before anything is built.**

## 2. What exists today (the four facts the design hangs on)

1. **A pause means "do not even poll the GPU."** `decide_start` consults
   `control_blocks_start` BEFORE `_gpu_clearance`, so a paused processor
   spends nothing looking. This feature deliberately inverts that for one
   pause variant — the GPU reading IS the release condition — which is exactly
   why it needs its own field rather than piggybacking `paused`.
2. **The GPU bar is already two-tier:** inside the 12am–8am window a single
   poll suffices; outside it `gpu_sustained_free(polls=2, interval=120s,
   threshold=50%)` — because *"a game paused on a menu still owns the GPU the
   moment it unpauses; loading screens read 3%"* (the module's own words).
3. **Absent-or-unknown fails closed.** `normalise_pause_mode` treats any
   unrecognised value as `all`; unknown fields are ignored by old readers. Any
   new field must inherit this posture.
4. **The processor already writes the control doc** (it clears consumed
   `requeue` entries via ArrayRemove), so "the processor releases the pause"
   has a precedent and a write path (`write_control`), with the §3b/§4
   updateMask discipline from the contract doc.

## 3. Proposed contract change

One new field on `ingestion_control/state`:

| Field | Type | Meaning |
|---|---|---|
| `pause_until_gpu_free` | bool | this pause releases ITSELF on the first evaluation where the GPU is sustained-free; the PROCESSOR clears `paused` + this flag when that happens |

**Dashboard writes** (new card control, *"Pause until the GPU is free"*):
`paused: true`, `pause_until_gpu_free: true` — mask carries exactly those two
plus `updated_by`/`updated_at`. `Resume` and `Start now` both add
`pause_until_gpu_free: false` to their masks (a cleared pause must not leave a
live release condition behind).

**Processor behaviour** (in `decide_start`, before the normal
`control_blocks_start` refusal):

```
if state.paused and state.pause_until_gpu_free:
    if gpu_sustained_free():          # the SAME bar as opportunistic starts
        write_control({paused: false, pause_until_gpu_free: false,
                       updated_by: "processor"})   # masked, per §3b discipline
        if that write FAILED: stay paused this tick, log why   # fail closed
        else: fall through to the normal decision (window, deadline, CPU…)
    else:
        refuse with a worded reason carrying the actual reading:
        "paused until the GPU is free — GPU at 84% (> 50%); checking again next tick"
```

⚠️ **Clear-then-start, never start-then-clear.** If the release write fails
(network), the processor stays paused and says so — running books while the
dashboard still shows *paused* is the dishonest-board state this surface
exists to prevent.

### Fail-closed table (every row inherits posture 3 above)

| Failure | Behaviour |
|---|---|
| Old reader meets the new field | Ignores it → plain hard pause until Resume. The button under-delivers, never over-delivers |
| Old reader + old `pause_mode` typo rules | Unchanged — `pause_until_gpu_free` never touches `pause_mode` |
| `nvidia-smi` unreadable | `gpu_is_free` already fails closed → pause stands forever, each tick logs the reason; the escape is dashboard **Resume** |
| Control unreadable | Treated as paused, as today — the flag is never even read |
| Release write fails | Stays paused this tick, retries next tick |

### Interactions, each decided rather than left to fall out

| With | Rule |
|---|---|
| `pause_mode` | Orthogonal. The mode still governs what the pause BLOCKS while it stands (default `all`); the flag only governs how it ENDS. A `manual_only` + GPU-release pause is coherent and needs no special case |
| `dont_check_until` | **Wins over the flag.** A don't-check is a spend-nothing instruction; polling the GPU is spending. If both are set, no GPU read happens until the don't-check expires — the card wording must say so |
| `pause_windows` | Untouched, same as Start-now (§3a of the contract doc): a release that lands inside quiet hours clears the ad-hoc pause and the window still blocks — the refusal names the window |
| `paused_until` | If both set, the pause ends at whichever clears FIRST (timer expiry or GPU release) — matching the intuition "resume when the GPU frees up, or at 9pm regardless" |
| Deadline gate / CPU guard | Unchanged — release only re-enters the normal decision, it does not skip any later check |

## 4. Surface changes

| Piece | Change |
|---|---|
| `sites/heygabi-home/public/status/index.html` + `status.js` | one new button in the Operations card; paused-state line gains the variant *"Paused — will resume itself once the GPU has been quiet for ~4 minutes"* |
| `assets/ingestion-time.js` | the words (all wording lives there, per the contract); `describeIngestion()` renders the release condition and the dont-check precedence sentence |
| `apps/auth-worker/src/ops.ts` | new action on `POST /api/estate/ops/ingestion`; masks per §3 |
| `audiobook_catalog/app/core/ingest_control.py` | field on `ControlState` (default `False`, `__post_init__`-coerced), release logic in `decide_start`, the worded refusals |
| Tests | ops.ts route masks (incl. Resume/Start-now clearing the flag); ingestion-time words; ingest_control release / GPU-busy / GPU-unreadable / write-fail / dont-check-precedence paths — failing-before where applicable |
| [`ingestion-pause-controls.md`](ingestion-pause-controls.md) | §2 field table + §3 encoding table rows, in the build commit |

**Deploy order is safe in both directions** (fail-closed table row 1): ship
the reader first and the field is inert; ship the dashboard first and the
button degrades to a plain pause. No flag, no migration, no new collection.

**Effort:** S–M. Reader half ~half a day with tests; card/route half ~half a
day; then one live round trip (set the flag with the GPU busy, watch the
refusal wording, free the GPU, watch the processor release it and the card
update — the §6 "the signed-in card has never been clicked by a human" debt
applies here too and should be paid in the same session).

## 5. Deliberately NOT in scope

- No change to what a pause blocks (that is `pause_mode`, already built —
  2026-08-23, and note it answers library TODO's OR-3).
- No new poller: release is evaluated at the processor's existing cadence
  (run ticks + between-book decisions). Worst-case latency from "GPU went
  quiet" to "release noticed" is one tick (~30 min idle); say that on the
  card rather than building a daemon.
- No auto-set of this flag by anything: only a human presses it.

## 6. Owner questions (ask ONE at a time, recommendations first)

1. **Is reading A right** — "pause now, resume yourself when the GPU is next
   free"? (Recommended; B/C are already expressible with `dont_check_until`.)
2. **Release bar: sustained-free (2 polls, 120s apart — recommended, same as
   opportunistic starts) or a single poll?** Single releases faster but a
   loading-screen dip would unpause mid-game.
3. **While it waits, does it block everything (recommended, default `all`) or
   should CPU-only work (packing) continue?** CPU packs don't touch the GPU,
   but they do compete with whatever you're doing; `all` is predictable.
