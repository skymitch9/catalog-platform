# catalog-platform

> **Audience:** Claude sessions and the owner. **Status:** the plan, **one
> deployed site** — the `heygabi.ai` front door, live and serving — **and shared
> data two other repos build against.** Last verified: **2026-08-11**.

Design documents for presenting three separate catalogs as one site on one
domain — and, since 2026-08-10, the code for the pages that belong to the
platform itself rather than to any one catalog. It exists because the plan
governs three codebases and belongs inside none of them.

## ⚠️ This is a CODE DEPENDENCY of two catalogs, not a docs repo

Since **2026-08-11** this repo ships `data/universes.json`, the shared
fictional-universe list. **`bookbuddy/library_catalog` and
`bookbuddy/audiobook_catalog` both read it as part of their builds.**

| If you | Then |
|---|---|
| Move, rename or delete `data/` | Two builds in other repos break |
| Change the shape of `universes.json` | Bump `schemaVersion`; both consumers check it |
| Clone this repo somewhere unusual | Set `CATALOG_PLATFORM_DIR` in the catalogs, or their resolvers will not find it |
| Assume "it's just docs, nothing runs" | ⚠️ Wrong since 2026-08-11. That assumption is exactly what this box is here to stop |

`library_catalog` **fails its build loudly** if it cannot find this repo;
`audiobook_catalog` warns and carries on. Design and reasoning:
[`docs/info/UNIVERSES.md`](docs/info/UNIVERSES.md).

## Layout

| Path | What |
|---|---|
| [`docs/`](docs/) | The plan. Governs three other repos; nothing here is deployed |
| [`data/`](data/) | ⚠️ **Shared data, READ BY OTHER REPOS' BUILDS.** The universe list and its fixtures. Not documentation |
| [`tools/`](tools/) | The local CLI that edits `data/`. Zero dependencies — `node tools/universes.mjs` works in a fresh checkout |
| [`sites/heygabi-home/`](sites/heygabi-home/) | **The `heygabi.ai` apex landing page, and the cross-project board at `/todo`. Live.** Two static HTML files, no build step, no JS |

⚠️ **The three catalogs keep their own repos.** `sites/` is not a monorepo
staging area — it is for things that are *about the platform*: the front door
today, the cross-format index at `index.heygabi.ai` (`PLATFORM.md` §5) if it
ever gets built. An audiobook or library change still belongs in its own repo.
`data/` is the one exception, and it earns it: a fact both catalogs need, that
is data for neither.

### Why the apex page lives here

It was its own repo, `heygabi-home`, from 2026-08-09 to 2026-08-10 — and it was
the only repo whose every design decision was written down somewhere else.
`docs/info/HEYGABI_LAYOUT.md` decides which hostname it advertises and in what order
they come online; `docs/info/PLATFORM.md` §5 decides what the page eventually grows
into. Reasoning in one repo and editing in another is how the two drift. The
move brought all three of its commits across with their history intact.

## The three catalogs

| Catalog | Repo | Host (all live, checked 2026-08-10) | Role |
|---|---|---|---|
| Audiobooks | `bookbuddy/audiobook_catalog` | `audiobooks.heygabi.ai` — `200` | **Read-only** — pipeline-fed, 1,073 books |
| Board games | `boardbuddy/Board_Game_Catalog` | `boardgames.heygabi.ai` — `200`; signed-out `/api/me` is `401`, no longer an Access redirect | **Manual add** — 775 items, scanning |
| Books & ebooks | `bookbuddy/library_catalog` | `library.heygabi.ai` — `200` | **Manual add** — scanning |

Status codes above are measured. Counts and roles are quoted from the catalogs'
own docs and were **not** re-verified against their databases here.

The asymmetry is the point. Audiobooks arrive through an automated pipeline and
need no editor. Games and books are added by hand, which is what the scanning
features exist for.

## Documents

| Doc | Covers |
|---|---|
| [`docs/info/PLATFORM.md`](docs/info/PLATFORM.md) | The combined site: hosting move, shared index, auth, sequencing |
| [`docs/info/DOMAIN_AND_HOSTING.md`](docs/info/DOMAIN_AND_HOSTING.md) | Which domain shape, whether GitHub Pages retires, migration steps, costs. Answers `PLATFORM.md` §8 q1 and q2 |
| [`docs/info/LIBRARY_CATALOG.md`](docs/info/LIBRARY_CATALOG.md) | The new books + ebooks catalog |
| [`docs/info/HEYGABI_LAYOUT.md`](docs/info/HEYGABI_LAYOUT.md) | The hostname map for `heygabi.ai`, and why there is no separate ebooks app. Revises `DOMAIN_AND_HOSTING.md` |
| [`docs/info/UNIVERSES.md`](docs/info/UNIVERSES.md) | ⚠️ The shared universe list: why a file and not a table, the resolution order both catalogs implement, the editor CLI, and what each consumer does when it cannot find this repo |
| [`data/README.md`](data/README.md) | What is in `data/` and who reads it |
| [`docs/info/diagrams/architecture.md`](docs/info/diagrams/architecture.md) | All diagrams in one place |
| [`sites/heygabi-home/README.md`](sites/heygabi-home/README.md) | The landing page: its two hard rules (no auth, no external requests) and how it grows into the index |
| [`sites/heygabi-home/deploy.md`](sites/heygabi-home/deploy.md) | How the apex is deployed. **Read §4 for a routine deploy** |

## Decisions already taken

Recorded here so they are not re-litigated. Full reasoning in `PLATFORM.md` §2.

| Question | Decision |
|---|---|
| New catalog's name | **`library_catalog`** — physical **and** ebook, so never "physical catalog" |
| Build it how | Fork the Board Game Catalog's structure |
| Hosting | Move audiobooks off GitHub Pages to **Cloudflare Pages**, covers to **R2** |
| Firestore | **Stays.** Not up for discussion |
| Google SSO | **Stays.** Not up for discussion |
| Editor auth | **Firebase ID tokens** — one sign-in across the whole site |
| Joining the catalogs | A **shared D1 index**, not static JSON exports |
| Where the universe list lives | **`data/universes.json` in this repo — a versioned file, no database table.** ~33 series changing monthly is reference data; the value is version control over the *decisions*, refusals included, and the audiobook side is a Python build that cannot reach D1 at all. `docs/info/UNIVERSES.md` §1 |
| Order of work | **Finish the Board Game Catalog first** |

## Status

The domain half of the plan is largely done and the README above no longer
describes a repo where "nothing is built". Measured 2026-08-10, by fetching each
host:

| | State |
|---|---|
| `heygabi.ai` + `www` | **Live**, both `200`, served by Pages project `heygabi-home` from `sites/heygabi-home/public` |
| Live page vs this repo | ⚠️ **A DEPLOY IS PENDING** as of 2026-08-10. It was byte-identical (21,931 bytes both sides) until `/todo` was added and the front door gained a footer link to it. One command, `sites/heygabi-home/deploy.md` §4 |
| `heygabi.ai/todo` | **Written, not yet deployed.** The cross-project board — every open item across the three catalogs and this site, tagged one / some / all / landing site. CSS-only filter, no JS. ⚠️ It is **public and authored by hand**: no secrets, no security posture, no purchase detail. `sites/heygabi-home/README.md` § `/todo` |
| CSP from `_headers` | ✅ **Arriving at the edge**, `default-src 'none'` and all. The zero-external-requests rule is enforced, not just documented |
| The three catalog hosts | **All live** — see the table above |
| `covers.heygabi.ai` | ✅ **Live and in use.** A real object returned `200`; the audiobook page references this host 7,536 times. Its root `404`s, which is just an R2 bucket with no object at `/` |
| `www` → apex `301` | 🔶 **Not done.** `www` answers `200`, so both names serve the page. Cosmetic; `sites/heygabi-home/deploy.md` §2.1 has the rule |
| Cloudflare Access on board games | ✅ **Removed 2026-08-10.** `boardgames.heygabi.ai/api/me` answers `401` instead of redirecting to the Access login, so the Worker's own Firebase check is the gate. A stranger can now sign in, lands as `pending`, and sees a waiting screen — which is what the viewer role was built for and could never reach while Access stood in front |
| `ebooks.heygabi.ai` | **Does not resolve** — never created. It was always optional (`HEYGABI_LAYOUT.md` §7 q4); if it is ever made, it is a `301` and **never** a Firebase authorised domain |
| The cross-format index at `index.heygabi.ai` | **Does not resolve — unbuilt.** `PLATFORM.md` §5. `<section id="find">` in the landing page is the reserved slot |
| Firebase authorised domains | ⚠️ **Never verifiable from here** — the console is owner-only and the list is not readable from outside it. Sign-in working on `library.` and `audiobooks.` implies they are listed; `boardgames.heygabi.ai` was added by the owner on **2026-08-10**. The apex must **never** be added: `HEYGABI_LAYOUT.md` §1.3 |

## What is left, and who does it

**Nothing is required to keep the site up.** Everything below is optional or
gated on a decision. 🔴 = owner only; a session cannot do these.

| # | Action | Owner? | Blocked on |
|---|---|---|---|
| 1 | 🔴 `www` → apex `301` redirect rule | yes, dashboard | Deciding apex-vs-`www` as canonical (`HEYGABI_LAYOUT.md` §7 q3 — the recommendation is **apex**, since every other host is a bare subdomain of it) |
| 2 | ✅ **Done 2026-08-10** — `boardgames.heygabi.ai` added to Firebase authorised domains (owner-confirmed; the list is not readable from outside the console, so this is reported, not measured) | 🔴 was owner, console | — |
| 3 | ✅ **Done 2026-08-10** — board game Worker moved off Access onto Firebase ID tokens, deployed, and the Access application deleted. `Board_Game_Catalog` `ae36104` + `c04041c`; runbook and measurements in that repo's `docs/access/firebase-auth.md` | — | — |
| 4 | ✅ **Done 2026-08-10** — "Owner only" pill removed from the board games card and deployed | — | — |
| 5 | The `?format=ebook` filter (`HEYGABI_LAYOUT.md` §4 Track B) | no | Nothing. It is code in `bookbuddy/library_catalog`, not in this repo, and it is the item with the real deadline — §5.3 explains why |

⚠️ **Step 3 is not a dashboard toggle, and an earlier version of this table said
it was.** `Board_Game_Catalog/apps/worker/src/middleware/auth.ts:38-46` reads
identity out of the `Cf-Access-Jwt-Assertion` header (or the `CF_Authorization`
cookie) and verifies it against `https://<team>/cdn-cgi/access/certs` (`:25-31`).
The Worker does not merely *sit behind* Access — it **takes every identity from
it**. Delete the Access application first and the Worker has no identity source
at all: `resolveIdentity` returns `null` for everyone, or throws outright if the
vars are removed with it (`:65-69`). The replacement is the Firebase ID token
verification in `PLATFORM.md` §4, and it ships **before** Access comes off.

⚠️ **2 → 3 → 4 is an order, not a list** — and it is the reverse of what this
table said before 2026-08-10. Authorise the domain *first*: it changes nothing
while Access is up, whereas removing Access before that host can complete a
Firebase sign-in leaves a gate nobody can pass. That is the pattern
`HEYGABI_LAYOUT.md` §4 Track C steps 9–10 already uses for `library.` — *"add to
authorised domains **before** step 10, or sign-in fails with
`auth/unauthorized-domain`"* — which the board-games rows had inverted. Step 4
comes last, or the front door advertises open access to a gated host.

Remaining open questions for the owner are in `HEYGABI_LAYOUT.md` §7. Two of
them have since been answered by events rather than by a decision: **q1**
(registrar — Cloudflare) and **q2** (`boardgame.` vs `games.` — neither; it went
live as the plural `boardgames.`).
