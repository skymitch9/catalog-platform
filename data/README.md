# Shared data — Information Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-11**.

⚠️ **This directory is read by other repos' builds.** It is not documentation.
Deleting, moving or renaming a file here breaks a build in `library_catalog` and
in `audiobook_catalog`. See [`../docs/info/UNIVERSES.md`](../docs/info/UNIVERSES.md) for
the design, and the root [`README.md`](../README.md) § *A code dependency*.

| File | What | Who reads it |
|---|---|---|
| `universes.json` | The shared fictional-universe list — six universes, their series, per-book overrides and exclusions, and every recorded refusal | `library_catalog` (build), `audiobook_catalog` (pipeline), `tools/universes.mjs` |
| `universes.fixtures.json` | Lookup cases both catalogs must answer identically | all three test suites |
| `series-canon.json` | The estate series canon — CROSS-CATALOG series-spelling folds (normalization item 4). Not universe data; see [`../docs/info/UNIVERSES.md`](../docs/info/UNIVERSES.md) §8 | `library_catalog` (`scripts/lib/series-canon.mjs`, live at backfill time), `audiobook_catalog` (`python -m app.tools.sync_series_canon`, at sync time), `tools/series-canon.mjs` |

## Editing

**Through the CLI, never a text editor.**

```bash
node tools/universes.mjs                 # help
node tools/universes.mjs list
node tools/universes.mjs validate        # exit 1 on any error
node tools/universes.mjs fixtures

node tools/series-canon.mjs              # help
node tools/series-canon.mjs list
node tools/series-canon.mjs validate
```

Every mutating command requires `--why`. That is the point of the file: each
entry records how it was decided (`seed` / `llm` / `human`) and on what
evidence, and an unexplained mapping is indistinguishable from a typo. If you
do hand-edit, run `validate` and `fixtures` before committing — both catalogs
run them too, so a bad edit fails somewhere either way; better here.

## Why a file and not a D1 table

~33 series and ~13 book overrides, changing maybe monthly. Reference data, not
user data.

- The value is version control over **the decisions**, including the refusals —
  *"Will Wight — leave blank"*, *"same author is not a universe"*. A table
  records the current state; a file records the argument.
- `audiobook_catalog` is a Python static build with no route to D1. A table
  would have needed an export step and a second copy, which is the drift this
  design exists to avoid.
- A consumer holds all six universes in memory and answers "show me all Cosmere
  books" without a query.

## ⚠️ The three cases that decide the shape

A series → universe mapping is **not sufficient**, and all three counterexamples
are real rows in this house's catalogs. They are fixtures, not prose:

| Case | Why series-keying fails |
|---|---|
| **Secret Projects** | Mixed series — four of five are Cosmere, *The Frugal Wizard's Handbook* is not. A series-level answer is wrong for one of five |
| **The Otherlife trilogy** | No series value at all; the trilogy name lives inside each title |
| **Fires of December** | A seriesless standalone that **is** Cosmere. Nothing about it is reachable from a series |

⚠️ The Frugal Wizard row carries a **curly apostrophe** (U+2019). A lookup that
does not fold it returns the wrong answer on the single row the whole design
rests on. Both fixtures spellings are tested.
