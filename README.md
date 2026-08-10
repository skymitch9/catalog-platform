# catalog-platform

> **Audience:** Claude sessions and the owner. **Status:** the plan, **plus one
> deployed site** — the `heygabi.ai` front door, live and serving. Last
> verified: **2026-08-10**.

Design documents for presenting three separate catalogs as one site on one
domain — and, since 2026-08-10, the code for the pages that belong to the
platform itself rather than to any one catalog. It exists because the plan
governs three codebases and belongs inside none of them.

## Layout

| Path | What |
|---|---|
| [`docs/`](docs/) | The plan. Governs three other repos; nothing here is deployed |
| [`sites/heygabi-home/`](sites/heygabi-home/) | **The `heygabi.ai` apex landing page. Live.** One static HTML file, no build step, no JS |

⚠️ **The three catalogs keep their own repos.** `sites/` is not a monorepo
staging area — it is for things that are *about the platform*: the front door
today, the cross-format index at `index.heygabi.ai` (`PLATFORM.md` §5) if it
ever gets built. An audiobook or library change still belongs in its own repo.

### Why the apex page lives here

It was its own repo, `heygabi-home`, from 2026-08-09 to 2026-08-10 — and it was
the only repo whose every design decision was written down somewhere else.
`docs/HEYGABI_LAYOUT.md` decides which hostname it advertises and in what order
they come online; `docs/PLATFORM.md` §5 decides what the page eventually grows
into. Reasoning in one repo and editing in another is how the two drift. The
move brought all three of its commits across with their history intact.

## The three catalogs

| Catalog | Repo | Host (all live, checked 2026-08-10) | Role |
|---|---|---|---|
| Audiobooks | `bookbuddy/audiobook_catalog` | `audiobooks.heygabi.ai` — `200` | **Read-only** — pipeline-fed, 1,073 books |
| Board games | `boardbuddy/Board_Game_Catalog` | `boardgames.heygabi.ai` — `302` to the Cloudflare Access login, i.e. the gate is up | **Manual add** — 775 items, scanning |
| Books & ebooks | `bookbuddy/library_catalog` | `library.heygabi.ai` — `200` | **Manual add** — scanning |

Status codes above are measured. Counts and roles are quoted from the catalogs'
own docs and were **not** re-verified against their databases here.

The asymmetry is the point. Audiobooks arrive through an automated pipeline and
need no editor. Games and books are added by hand, which is what the scanning
features exist for.

## Documents

| Doc | Covers |
|---|---|
| [`docs/PLATFORM.md`](docs/PLATFORM.md) | The combined site: hosting move, shared index, auth, sequencing |
| [`docs/DOMAIN_AND_HOSTING.md`](docs/DOMAIN_AND_HOSTING.md) | Which domain shape, whether GitHub Pages retires, migration steps, costs. Answers `PLATFORM.md` §8 q1 and q2 |
| [`docs/LIBRARY_CATALOG.md`](docs/LIBRARY_CATALOG.md) | The new books + ebooks catalog |
| [`docs/HEYGABI_LAYOUT.md`](docs/HEYGABI_LAYOUT.md) | The hostname map for `heygabi.ai`, and why there is no separate ebooks app. Revises `DOMAIN_AND_HOSTING.md` |
| [`docs/diagrams/architecture.md`](docs/diagrams/architecture.md) | All diagrams in one place |
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
| Order of work | **Finish the Board Game Catalog first** |

## Status

The domain half of the plan is largely done and the README above no longer
describes a repo where "nothing is built". Measured 2026-08-10, by fetching each
host:

| | State |
|---|---|
| `heygabi.ai` + `www` | **Live**, both `200`, served by Pages project `heygabi-home` from `sites/heygabi-home/public` |
| The three catalog hosts | **All live** — see the table above |
| `www` → apex `301` | ⚠️ **Not done.** `www` answers `200`, so both names serve the page. Cosmetic; `sites/heygabi-home/deploy.md` §2.1 has the rule to add |
| Cloudflare Access on board games | **Still on** — the reason the front-door card is badged "Owner only". `PLATFORM.md` §4.1 is the checklist to remove it, and it is the one step in the plan that reduces security |
| The cross-format index at `index.heygabi.ai` | **Unbuilt.** `PLATFORM.md` §5. `<section id="find">` in the landing page is the reserved slot |
| Firebase authorised domains | ⚠️ **Not verified here** — the console is owner-only and unscriptable. The apex must **never** be added: `HEYGABI_LAYOUT.md` §1.3 |

Open questions for the owner are collected in `HEYGABI_LAYOUT.md` §7.
