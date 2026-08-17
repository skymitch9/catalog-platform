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

## Audiobook / Ebooks surface — floors, with today's decisions

| Capability | Floor | Notes |
|---|---|---|
| Read the catalog | guest | The audiobook catalog is the estate's PUBLIC slice — browsing needs no grant. **Ebooks are the exception: the shelf itself needs `vis_ebooks`** (owner, 2026-08-17: no public scraping), and that grant INCLUDES reading books in the viewer. |
| Rate / review / own TBR / own content notes | signed-in | A live session, not a rung. Self-deleting your own note rides here. |
| **Download an ebook file** | **admin** | ⚠️ Owner decision 2026-08-17: **no per-person checkbox — the ladder is the grant** ("use roles we have… match library"). Want someone downloading, promote them. (Code floor mid-rework from the committed `member` placeholder; this row is the decided truth.) |
| Upload | contributor | Phase-4 surface, floor pre-committed. |
| Operate a club (schedules, polls, roster, invites, read lifecycle) | moderator — **or that club's manager** | The club island: a club's bound managers hold operate-class powers **for their own club** at any rung. Site moderator+ overrides everywhere; the island never out-ranks the ladder. Read lifecycle (finish/remove/reveal ratings) moved here 2026-08-17 (option B). |
| Club settings (webhook set/clear) | moderator — or that club's manager | Same island rule. |
| Claim an UNCLAIMED club | any signed-in session | First-come-first-served; how one *becomes* a manager. Claiming an already-managed club: moderator+. Revoked estate members are refused by the estate check regardless. |
| **Delete a club / structural edits** | **admin** | Deliberately NOT island-held and NOT lowered (option B's other half): destruction stays yours. |
| Remove anyone's review | admin | |
| Remove others' content notes | moderator | The warnings split: self-delete is signed-in; deleting someone else's is moderator+, enforced in `firestore.rules` (`authorUid` or `site_roles` moderator+). |
| Approve users / roles UI | moderator floor for the UI; grants strictly-beneath | Enforced by the auth worker's `canGrant`, never the page. |

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
