# catalog-platform

> **Audience:** Claude sessions and the owner. **Status:** PLANNING ONLY —
> nothing here is built. Last verified: **2026-08-07**.

Design documents for presenting three separate catalogs as one site on one
domain. This repo holds **no application code** and is not deployed. It exists
because the plan governs three codebases and belongs inside none of them.

## The three catalogs

| Catalog | Repo | Today | Role |
|---|---|---|---|
| Audiobooks | `bookbuddy/audiobook_catalog` | GitHub Pages + Firestore, Python pipeline | **Read-only** — pipeline-fed, 1,073 books |
| Board games | `boardbuddy/Board_Game_Catalog` | Cloudflare Worker + D1 + Access | **Manual add** — 775 items, scanning |
| Books & ebooks | `bookbuddy/library_catalog` | **repo created 2026-08-08, no code yet** | **Manual add** — scanning |

The asymmetry is the point. Audiobooks arrive through an automated pipeline and
need no editor. Games and books are added by hand, which is what the scanning
features exist for.

## Documents

| Doc | Covers |
|---|---|
| [`docs/PLATFORM.md`](docs/PLATFORM.md) | The combined site: hosting move, shared index, auth, sequencing |
| [`docs/DOMAIN_AND_HOSTING.md`](docs/DOMAIN_AND_HOSTING.md) | Which domain shape, whether GitHub Pages retires, migration steps, costs. Answers `PLATFORM.md` §8 q1 and q2 |
| [`docs/LIBRARY_CATALOG.md`](docs/LIBRARY_CATALOG.md) | The new books + ebooks catalog |
| [`docs/diagrams/architecture.md`](docs/diagrams/architecture.md) | All diagrams in one place |

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

Nothing started. The first thing that happens is finishing the Board Game
Catalog — see `PLATFORM.md` §7.
