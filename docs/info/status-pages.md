# The four status pages   (Information Reference)

> **Audience:** Claude sessions. **Status:** TRACKED.
> Last verified: **2026-08-18** — the file map and the module graph were read
> off `sites/heygabi-home/public/status/`; the live-render half is recorded in
> docs/TODO.md, because a signed-in browser is the only instrument that can
> check it and this doc must not claim what it did not measure.

`/status` used to be one page that answered three questions at once. On
2026-08-18 the owner asked for the split: *"maybe a health page that also has
logs for the pods/workers/containers, a page for data processing, a page for
running the pipelines and their logs… take this and organize it into pages you
think make sense."* Four pages, one shared shell, one gate, all behind the same
devops check.

| Page | Job | Owns |
|---|---|---|
| **`/status`** Health | *Is everything up?* | worker/site/index rows read from public `/api/health` endpoints, the Book & ebook pipeline rows, Drive⇄role parity, deploy versions, backup freshness, the migration runbooks and the commandments |
| **`/status/processing`** Processing | *GABI's knowledge base as it grows* | in-flight books + %, queue depth per lane, pack counts + ingester version, and "joined GABI's knowledge base &lt;date&gt;" per book |
| **`/status/pipelines`** Pipelines | *Run it, and control it* | the ingestion **pause/timers card**, the pipeline steps + Run button, the Run levers (GitHub Actions), the shelf-server push, the nightly-window clock |
| **`/status/agents`** Agents | *Claude capacity* | running agents + model, the dispatched/landed/failed feed, and the **usage figures** |

⚠️ **Why the usage figures live on Agents and not on Health.** They are Claude
capacity — the same subject as the agents themselves — not a fact about whether
the estate is up. Putting a percentage that governs *whether work can start*
next to a row saying *whether a Worker answers* invites reading one as the other.

⚠️ **Why the pause card left Health.** "Is it up" and "make it do something" are
questions asked in different moods. Mixing them meant the answer to the first
was three screens below a wall of buttons. Health now holds reference and
evidence and **not one lever**.

## The file map

```
public/assets/status-shell.css     ← ALL FOUR pages. One amber dot, one meaning.
public/status/
  index.html  status.js            Health
  processing/ index.html processing.js
  pipelines/  index.html pipelines.js
  agents/     index.html agents.js
  lib/
    core.js                        ages, row rendering, origins, fetchJSON, sayEmpty, el
    gate.js                        ⚠️ THE devops gate — one implementation, four pages
    board.js                       the pushed-blob reader + the freshness sentence
```

⚠️ **`lib/gate.js` is one file for a reason.** Four copies of a gate is four
chances for one to fail **open**, and that failure is invisible — a page that
reveals controls to the wrong person looks exactly like a page that works. It
**fails closed** (a probe that throws, times out, or answers an unrecognised
shape leaves every gated section hidden) and it **reveals, never removes**
(anonymous content stays anonymous). A fifth page calls it; it never re-derives
the check.

⚠️ **`lib/core.js` has no top-level side effects** — no timers, no fetches, no
DOM lookups at import time — so importing it from a page with none of the
matching elements is safe and silent. Its row registry is per-document on
purpose: the pages never share a DOM.

⚠️ **`lib/board.js` owns the freshness sentence for BOTH pushed-data pages**, so
they can never disagree about what stale means. Its rules, each deliberate: the
age is measured against the **Worker's** `pushed_at`; a failed poll **says so and
blanks nothing**; "nothing pushed yet" is a **state**, not an error; and the
15-minute amber / 1-hour red thresholds are labelled **judgement, not
measurement**.

## Probed vs pushed — the line that runs through the whole surface

| | Health | Pipelines | Processing | Agents |
|---|---|---|---|---|
| Public health endpoints | ✅ | | | |
| Firestore public docs (REST, signed out) | ✅ | ✅ | | |
| Estate Worker, signed-in | ✅ backups | ✅ ops routes | | |
| The pushed board | | | ✅ | ✅ |

⚠️ **A Worker cannot see a Claude session or a pipeline on the owner's home
machine.** That is why the right half of that table is a PUSH surface, and why
both pushed pages put the age of the data above the data. The contract for the
blob is [`agent-board-contract.md`](agent-board-contract.md).

⚠️ **There are no pods or containers**, and the owner's word for them must not
become a promise the estate cannot keep — it is Workers plus pipelines on a home
PC. Workers cannot be live-tailed from a static page. The planned answer is a
**capped D1 ring buffer** that workers write structured rows into, rendered here
with a deep link out to the Cloudflare dashboard; it is a follow-up that is **not
built**, and Health says so rather than showing an empty box that looks like
silence.

## Things that will bite the next editor

- ⚠️ **`_headers` does not match by prefix.** `/status` covers the literal path
  `/status` and nothing under it. Each of the three sibling pages needs its own
  rule **in both slash forms** (the 308 trap that file's header warns about).
  They were nearly shipped with no CSP and no `X-Frame-Options` at all for
  exactly this reason.
- ⚠️ **A CORS mount is not implied by a route.** Hono's CORS mounts are
  exact-or-wildcard, never prefix-implicit. `/api/estate/ops/ingestion` shipped
  with a correct handler, answered `curl` perfectly, and was **unreachable from
  a browser** for want of one `app.use(...)` line — found while moving the card
  to this page. Any Authorization header makes the call preflighted.
- **Predeploy pins follow their subject.** When something moves page to page, its
  markers in `sites/heygabi-home/predeploy.checks.json` move with it. A pin left
  on the old file fails every deploy for a control that works perfectly one page
  over; a pin deleted instead of moved silently stops watching.
- ⚠️ **`verify:home` right after a deploy can report false MISSINGs.** Measured
  2026-08-18: the run chained inside `deploy:home` failed 15 markers across
  `pipelines.js`, `agents.js`, `lib/*.js` and `status-shell.css`, all "served
  200 but is MISSING"; a second run minutes later failed 9; a third passed all
  24. Fetching the same URLs directly showed the correct new content the whole
  time — it is **edge propagation lag, not a failed upload**. Re-run
  `npm run verify:home` before believing it, and only investigate a marker that
  survives a re-run. (The pattern is diagnostic: a genuinely missing file fails
  the same way every time, and fails for *every* marker on that path.)
- **The gate can only be checked signed in.** `predeploy-check --live` fetches
  unauthenticated, so every marker it asserts is page **chrome**. Proof that the
  gated content works is a human in a browser, and nothing else.
