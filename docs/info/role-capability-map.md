# Estate Role & Capability Map — Information Reference

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-17** — compiled from the three capability matrices
> in source (`library_catalog`/`Board_Game_Catalog` `packages/core/src/capabilities.ts`,
> `catalog-platform/apps/audiobook-worker/src/capabilities.ts`), not from memory.
> Owner ordered this map 2026-08-17 ("make a map of what each role should do")
> the same hour downloads moved to role floors, so it is the NORMATIVE map:
> where live code briefly disagrees (the download floor mid-rework), this map
> states the decided end state and flags the gap.

## The two axes — never confuse them

Every person's access is the product of TWO separate records:

1. **The estate directory** (auth-worker D1) — *"is this person in the
   household, and which catalogs may they SEE?"* Status
   (`pending/approved/revoked`) plus per-catalog visibility grants
   (`vis_audiobook`, `vis_library`, `vis_games`, `vis_library2`,
   `vis_ebooks`) plus two estate-wide flags: **approver** (runs the member
   directory: approve, revoke, grant visibility) and **devops** (status page
   operations, runbooks). Revocation clears powers and closes every door;
   re-approval restores nothing (re-earned from scratch — owner rule).
2. **A per-site role ladder** — *"what may they DO on that site?"*
   `guest < member < contributor < moderator < admin < owner`, cumulative.
   The library and her instance each keep roles in their own `app_user`;
   the audiobook/ebooks surface reads Firestore `site_roles/{uid}`; games
   mirrors the library's matrix. Grants are **strictly-beneath**: you may
   give any role below your own, never your own or above. Owners get no
   editable controls — their row auto-fills max everywhere.

Visibility says whether the door opens; the ladder says what you can lift
once inside. Neither substitutes for the other.

## Library & Games — identical matrices, by design

| Capability | guest | member | contributor | moderator | admin | owner |
|---|---|---|---|---|---|---|
| See the collection (`read`) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rate / track own reading | | ✅ | ✅ | ✅ | ✅ | ✅ |
| Suggest to wishlist ("I want this") | | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit catalog (works/editions/copies) | | | ✅ | ✅ | ✅ | ✅ |
| Curate wishlist (edit/remove/promote) | | | ✅ | ✅ | ✅ | ✅ |
| Scan a barcode (free) | | | ✅ | ✅ | ✅ | ✅ |
| Scan a photo (**bills vision API**) | | | | ✅ | ✅ | ✅ |
| Run paid research lookups | | | | ✅ | ✅ | ✅ |
| Review/accept research findings | | | | ✅ | ✅ | ✅ |
| Remove others' content notes (library) | | | | ✅ | ✅ | ✅ |
| Approve users / change roles | | | | | ✅ | ✅ |

The rung meanings in one line each: **guest** looks; **member** participates
(their own reading, ratings, asks, TBR, content notes — and may retract their
own contributions); **contributor** builds the catalog; **moderator** spends
money and moderates others' content; **admin** runs people; **owner** is the
recovery identity (`OWNER_EMAILS` forces it at sign-in — the break-glass).

## Audiobook & Ebooks — same grid as the library (owner ask, 2026-08-17)

| Capability | guest | member | contributor | moderator | admin | owner |
|---|---|---|---|---|---|---|
| Browse the audiobook catalog ¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| See + read the ebooks shelf ² | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rate / review / own TBR / own notes ³ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Claim an *unclaimed* club ³ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Upload | | | ✅ | ✅ | ✅ | ✅ |
| Operate a club (reads, polls, roster, schedule) ⁴ | | | | ✅ | ✅ | ✅ |
| Club webhook (set/clear) ⁴ | | | | ✅ | ✅ | ✅ |
| Claim an already-managed club | | | | ✅ | ✅ | ✅ |
| Remove others' content notes ³ | | | | ✅ | ✅ | ✅ |
| Approve users / roles UI ⁵ | | | | ✅ | ✅ | ✅ |
| **Download an ebook file** ⁶ | | | | | ✅ | ✅ |
| Remove anyone's review | | | | | ✅ | ✅ |
| **Delete a club / structural edits** ⁷ | | | | | ✅ | ✅ |

¹ Public — the estate's open slice, no sign-in needed at all.
² Gated by the **`vis_ebooks` estate grant**, not by rung — one grant covers
viewing and reading; no public scraping (owner, 2026-08-17).
³ Any live signed-in session, rung irrelevant — includes deleting your OWN
notes; claiming is first-come-first-served and is how one becomes a manager.
⁴ **The club island**: a club's bound managers also hold these for THEIR OWN
club at any rung; site moderator+ overrides everywhere; the island never
out-ranks the ladder. Read lifecycle moved here 2026-08-17 (option B).
⁵ Grants strictly-beneath your own rung, enforced by the auth worker's
`canGrant`, never the page.
⁶ ⚠️ **By ladder only — no checkbox** (owner, 2026-08-17: "use roles we
have… match library"); promote someone to grant it. (Code floor mid-rework
from the committed `member` placeholder; this row is the decided truth.)
⁷ ⚠️ Never island-held, never lowered (option B's other half) — destruction
stays high.

## Who holds what today (snapshot 2026-08-17)

Estate: 12 approved members. Owners: Skylar ×2 accounts (approver+devops,
max everywhere). Justin: devops. Samantha: approved, all four visibility
grants incl. `vis_ebooks` + **admin on her own instance** (padhard). Amber:
audiobook/library/games/ebooks visibility. Everyone else: audiobook (public
slice) only. Site-roles ladder docs: Skylar admin ×2, Samantha contributor
(audiobook surface). Club managers: Side Babes ×3, Sanderlanche ×3,
Arizon-YUH! ×1 — island powers over their clubs regardless of rung.
Full identity-bearing snapshot: `audiobook_catalog/docs/access/permission-snapshot-2026-08-17.json` (local-only).

## The standing rules that shape every row

- **Revocation beats everything**: `status='revoked'` closes both gates
  everywhere; flags and rungs survive in no form; re-approval re-earns.
- **Spending capabilities are the lines to move, not the roles** — scanPhoto
  and runResearch carry bills; if spend gets uncomfortable, change the line.
- **One matrix per site, capabilities not roles on routes** — adding a rung
  never means auditing routes.
- **Enforce posture**: library + padhard ENFORCE (since 08-13/08-16);
  audiobook surface SHADOW, flip armed behind the GitHub-outage queue
  (force-then-fix, owner 2026-08-17, acceptance = owners/mods/club-managers
  keep standing).
