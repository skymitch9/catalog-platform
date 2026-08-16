# tools — Access Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-15**.

Local command-line tools for the shared data in [`../data/`](../data/), plus
the estate-wide probe suite below. Zero dependencies and no install step —
`node tools/universes.mjs` works in a fresh checkout. Node 20+.

| File | What |
|---|---|
| `universes.mjs` | The editor CLI. Thin: argument parsing and printing only |
| `lib/universes.mjs` | ⚠️ Every decision — load, normalise, look up, validate, mutate. **Imported by `library_catalog`'s build.** Changing the resolution order here means changing it in `audiobook_catalog/app/core/universes.py` too |
| `estate-probes/` | **The API testing suite** (`npm run probe:estate`) — read-only, unauthenticated-edge probes run against LIVE production across all four estate Workers, the audiobook static site, and the public Firestore doc. Plus `authorized-domains.mjs` — an OPTIONAL, CREDENTIALED probe outside that contract (needs a Firebase service-account JSON), run by hand, not part of `npm run probe:estate`. Own README: [`estate-probes/README.md`](estate-probes/README.md) |

## Quick reference

```bash
node tools/universes.mjs                                       # help
node tools/universes.mjs list
node tools/universes.mjs show "Cosmere"                        # aliases resolve
node tools/universes.mjs who --title "Tress of the Emerald Sea"
node tools/universes.mjs who --series "Zodiac Academy"
node tools/universes.mjs canon "Arand multiverse"              # → Runnerverse
node tools/universes.mjs validate                              # exit 1 on error
node tools/universes.mjs fixtures                              # exit 1 on failure
```

Editing — **`--why` is mandatory**, `--dry-run` shows the result without writing:

```bash
node tools/universes.mjs add-series "Cosmere" --series "White Sand" \
  --why "Taldain. Confirmed by the owner 2026-08-11." --dry-run

node tools/universes.mjs add-book "Cosmere" --title "The Emperor's Soul" \
  --why "Sel, same world as Elantris. Hugo-winning novella."

node tools/universes.mjs add-book "Cosmere" --title "Snapshot" --exclude \
  --why "Standalone thriller, no shard-world connection."

node tools/universes.mjs hold-out --series "Damsels of Distress" \
  --subject "Damsels of Distress — Dakota Krout" \
  --why "Fairy-tale retellings; least obviously LitRPG of the nine."

node tools/universes.mjs restore "CAL Verse" --series "Damsels of Distress" \
  --why "Owner confirmed 2026-08-12 that it is in the shared world."
```

## Gotchas

| Gotcha | Detail |
|---|---|
| ⚠️ `--why` under 10 characters is **refused** | Not a warning. An unexplained mapping is indistinguishable from a typo, and nobody re-checks one |
| ⚠️ The CLI cannot create or delete a universe | Six exist, each with owner sign-off in its `confirmed` field. A seventh is a decision to write into the file with evidence, not a command |
| A held-out series cannot be re-added with `add-series` | It points you at `restore`, which overturns the refusal explicitly instead of leaving one the data contradicts |
| Nothing invalid is ever written | Every mutation validates first and refuses to save on any error |
| Removals leave a trail | `_changelog` in the data file. Git shows a deleted line; only this says why |
| ⚠️ Importing `lib/universes.mjs` by absolute path on Windows | Node's ESM loader rejects `C:/...`. Use a `file:///C:/...` URL, or `pathToFileURL()`. This bit during development and will bite again |
| Commit with `-F`, never `-m` | PowerShell mangles quotes and em dashes, and this data is full of both |
