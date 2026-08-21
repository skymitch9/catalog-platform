# The Estate Docs Standard — one shape, four repos

> **Audience:** every future Claude/Kiro session, and the owner.
> **Status:** TRACKED, and deliberately in `catalog-platform` — it is the only
> one of the four `docs/` trees carried in git, so this file survives a clone
> when the others do not.
> Last verified: **2026-08-21** (written that day; the inventory below was
> measured, not assumed).

This is the **one** place the rules live. Every repo's `docs/README.md` points
here instead of restating them, because a rule written down twice is a rule that
will disagree with itself.

---

## 1. The tree — every repo, the same seven things

```
docs/
├── README.md          ← THE MAP. Front door. One screen. Links everything below.
├── TODO.md            ← ACTIVE work only. If it is finished it is not here.
├── DONE.md            ← Dated archive, newest first. APPEND ONLY.
├── KNOWN_ISSUES.md    ← Accepted defects, waivers, exceptions. NOT a work log.
├── access/            ← HOW TO OPERATE it.  README.md is its index.
├── info/              ← HOW AND WHY it works. README.md is its index.
└── archive/           ← Superseded documents and one-off data dumps.
```

Nothing else lives at the top of `docs/`. A loose `.md` at that level is a bug —
it belongs in `access/`, `info/`, `archive/`, or one of the three logs.

⚠️ **Two files are exempt** because tooling writes them: `deploys.log`
(append-only deploy record) and any `*.log` a script produces.

---

## 2. What goes where — the decision, in one table

Ask **"what question does this answer?"**, never "what is it about?".

| The question it answers | Where it goes |
|---|---|
| *What is happening right now? What is blocked?* | `TODO.md` |
| *Was this solved before, and why that way?* | `DONE.md` |
| *Is this a bug, or is it like that on purpose?* | `KNOWN_ISSUES.md` |
| *How do I run / deploy / reach / rotate this?* | `access/` |
| *How does this work, and why is it built this way?* | `info/` |
| *What did this look like before?* | `archive/` |

⚠️ **The most common filing error is putting durable reference in the work
log.** A gotcha, a measured number, or a design rationale is not "current work"
just because you learned it today. It goes to `info/` (or `access/`), findable by
topic, and the work log links to it.

---

## 3. The four rules that are not negotiable

### 3.1 An item moves ONCE, at completion, and moves WHOLE

Cut and paste from `TODO.md` into `DONE.md`. **Never summarise on the way out** —
the summary always drops the *why*, and the why is the only reason to keep
history at all.

⚠️ **Marking an item "✅ DONE" inside `TODO.md` is the anti-pattern this rule
exists to kill.** Done items do not get a badge; they get MOVED, in the same
working session the work completes — ideally the same commit. A report that
announces a completion while the item still sits in `TODO.md` is reporting the
work as finished when its paperwork is not.

*Measured 2026-08-21: a section titled "BUILT, NOT DEPLOYED" whose body said
"✅ COMMITTED AND DEPLOYED 2026-08-20, verified live across 26 pages" had been
sitting in an active list for a day. A heading keeps asserting whatever it said
the hour somebody typed it.*

### 3.2 `DONE.md` is an ARCHIVE, not a living doc

**Append only. Newest first. Nothing there is ever edited or re-summarised.**
It exists so a future session does not re-discover a solved problem, or re-argue
a settled decision. If something in `DONE.md` turns out to be wrong, you do not
correct it — you add a new entry that supersedes it and says so.

### 3.3 One fact, one home — cross-link, never duplicate

If two files would both state a fact, one of them owns it and the other links.
Duplicated facts do not stay equal; they drift, and then a session has to guess
which copy is true.

### 3.4 Every doc carries a header block

```markdown
# <Topic> — <Access|Information> Reference

> **Audience:** Claude sessions. **Status:** TRACKED | LOCAL ONLY (gitignored).
> Last verified: **YYYY-MM-DD**.
```

**"Last verified" is a promise about measurement, not a save date.** Update it
when you actually re-checked the facts, and say in the same line what you did
NOT check.

---

## 4. Writing style — what makes these readable to both audiences

Written for a **future session first, the owner second**. Those wants coincide
more than they diverge: both want the answer fast and want to know how much to
trust it.

- **Titled by SYMPTOM, not by subsystem.** `"the fix didn't deploy"` finds the
  caching doc; `"Caching Architecture"` does not.
- **Tables and short command blocks over prose.** A table is scannable by a
  person and parseable by a model.
- **⚠️ marks a trap; 🔴 marks something that will cost real money, data, or
  trust; ✅ marks a measured pass.** Use them sparingly enough that they still
  mean something.
- **State the measurement, its date, and its instrument.** "1,206 items,
  measured 2026-08-21 off the ABS API" beats "about 1,200 items".
- ⚠️ **Say what was NOT verified.** Every report, every doc. An unavailable fact
  is reported unavailable, never filled in with something plausible.
- **Keep the gotcha that cost real time.** It is the single highest-value
  content in the whole tree.
- **Never paste a secret VALUE.** Names only, everywhere, in every repo.

---

## 5. `KNOWN_ISSUES.md` — what belongs there, and what does not

This is the file that stops the same non-bug being re-reported every month.

**It holds:** accepted defects nobody is fixing yet; deliberate waivers; known
exceptions and the reason for each; environment quirks that look like faults;
and anything a newcomer would reasonably file as a bug.

**It does NOT hold:** work in flight (that is `TODO.md`), or traps you fall into
while working (those are `info/gotchas.md` — a gotcha is something you *do*
wrong; a known issue is something that *is* wrong and is tolerated).

Every entry carries four things:

| Field | Why |
|---|---|
| **Symptom** | What a person actually sees. It is how the entry gets found. |
| **Status** | `ACCEPTED` · `WAIVED` · `BLOCKED` · `WATCHING` |
| **Why it is tolerated** | The argument. Without it the entry reads as neglect. |
| **What would change it** | ⚠️ The removal condition, ideally a NUMBER, not a judgement call. |

---

## 6. `archive/` — how to retire a document without deleting it

A doc that has been superseded moves to `docs/archive/` with a dated suffix and
**one line at the top saying what replaced it**. Big one-off data dumps
(migration snapshots, `.jsonl` logs, CSV audits) go there too — they are evidence,
not documentation, and they make a `docs/` listing unreadable.

```markdown
> ⚠️ **ARCHIVED 2026-08-21 — superseded by [`../info/foo.md`](../info/foo.md).**
> Kept for the reasoning, not as current fact. Do not act on anything here.
```

⚠️ **Archiving is not deleting, and the difference is load-bearing.** The
estate's own history includes an archived shim that kept telling readers a
problem was "still on hold" months after it was fixed — a retired doc that does
not say it is retired is worse than one that was deleted.

---

## 7. `docs/README.md` — the map

One screen. It exists so a session can orient in a single read, and so the owner
can find something without knowing which folder it is in. It carries:

1. A one-paragraph statement of what this project *is*.
2. The tree, as a diagram.
3. A "start here" table: the 3–5 docs that answer the most common questions.
4. Links to the two indexes and the three logs.
5. A pointer to this file for the rules.

⚠️ **It does not restate the rules and it does not duplicate the indexes.**

---

## 8. The session checklist

**Opening a session** (this is enforced by a `SessionStart` hook):

1. `docs/README.md` — the map
2. `docs/TODO.md` — what is active
3. `docs/KNOWN_ISSUES.md` — so you do not "fix" something deliberate
4. The `access/` and `info/` files your task touches
5. `docs/DONE.md` only to check whether something was already solved

In a multi-repo checkout this means **every** repo's `docs/`.

**Closing a piece of work — all four, or the work is not landed:**

1. Move the finished item **whole** into `DONE.md`.
2. Update the `access/` or `info/` doc whose facts changed, and its
   *Last verified* date.
3. Add a `KNOWN_ISSUES.md` entry for anything you deliberately left broken.
4. Say what you did **not** verify.

---

## 9. Where each repo's tree lives, and which are in git

| Repo | `docs/` in git? | Consequence |
|---|---|---|
| `catalog-platform` | ✅ **TRACKED** | Survives a clone. Estate-wide docs and cross-repo queues belong here |
| `audiobook_catalog` | ❌ gitignored (`.gitignore:7`) | 🔴 Exists on the owner's machine and nowhere else — see the backup below |
| `library_catalog` | ⚠️ **mixed** — some tracked | Check `git check-ignore` before assuming |
| `Board_Game_Catalog` | ⚠️ check per file | Same |

🔴 **Because three of the four are local-only, `docs/` is backed up to R2.**
`catalog-platform/scripts/backup-docs.mjs` archives all four trees to
`estate-backups/docs/<repo>/<UTC>.json.gz`; `restore-docs.mjs` puts one back.
Drilled 2026-08-21 — byte-exact round trip. Runbook:
[`access/backup-restore.md`](access/backup-restore.md) §6b.

⚠️ Those archives contain `access/keys/` — **raw** service-account JSON and
bearer tokens. They are key material, not documents.
