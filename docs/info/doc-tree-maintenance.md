# Keeping the doc tree honest — the patterns that recur

> **Audience:** Claude/Kiro sessions. **Status:** TRACKED.
> Last verified: **2026-08-23** — both patterns below were re-confirmed that
> day by meeting each of them again, which is why this file exists.

The rules live in [`../DOCS_STANDARD.md`](../DOCS_STANDARD.md). This file is
the **worked examples** — the shapes that keep coming back, extracted from the
Kiro queue on 2026-08-23 where they had been sitting as work items nobody
could ever finish.

## ⚠️ The heading and the body disagree, and the heading is the stale half

Measured 2026-08-21: of **11** sections whose headings said `LIVE` / `SHIPPED`
/ `✅`, **every one** had open work in the body. Measured again 2026-08-23:
the queue carried a `## K17. ✅ DONE — Finished sections swept from TODOs`
directly above eleven sections that had not been swept, and a second `## K17.
◐ PARTLY DONE` saying so.

**So: read the body. Never sweep by heading.** The heading is written when the
work is expected to finish; the body is written as it actually goes.

## ⚠️ A threshold outlives the premise it was derived from

Cadence-aware backup grading (2026-08-21) shipped `BACKUP_KIND_CADENCE_MS` per
kind, amber at 1.5x, red at 2.5x. The numbers had looked defensible the entire
time they were wrong, because the premise underneath them had moved.

**When you meet a constant with a comment explaining it, check the comment’s
premise before trusting the number.** A number with a rationale attached reads
as verified and usually is not.

## ⚠️ A dated deadline that has passed still reads as upcoming

Added 2026-08-23. A `🔴 SUNDAY 2026-08-23, 16:00 — ROTATE A LEAKED KEY`
heading looks identical whether the deadline is in three days or three hours
gone. The eye reads the emoji and the date and moves on — measured that day,
when the key was found still un-rotated 3.5 hours after its window.

**State the elapsed condition, not the deadline** — "this has passed and the
key is still live, verified at 19:30" — and put it above the item, not inside
it.

## The recurring pass itself

The 15-minute checklist stayed in [`../TODO.md`](../TODO.md), because unlike
the patterns above it is genuinely a task somebody performs.

## Where the originals went

K3 and K19, whole, in [`../DONE.md`](../DONE.md) — this file is the distilled
form, and the archive keeps the reasoning as it was written.
