# The estate role ladder (audiobook site-roles) — Information Reference

> **Audience:** Claude sessions. **Status:** TRACKED — this repo is PUBLIC on
> GitHub, so this file deliberately holds NO real names or emails (the design
> source, `audiobook_catalog/docs/info/ROLES.md`, is LOCAL-ONLY there for
> exactly that reason and is read-only reference for this build, never
> copied verbatim). Last verified: **2026-08-16**, the day this was built.
> Companions: [`estate-auth-design.md`](estate-auth-design.md) (the
> membership layer this sits beside — pending/approved/revoked, `is_approver`,
> `is_devops`), `apps/auth-worker/src/role-ladder.ts` (the implementation —
> pure, unit-tested, the one source of truth for rank/grant decisions).

## What this is

The audiobook site's `site_roles` Firestore federation
(`apps/auth-worker/src/site-roles.ts`) grew from a flat `admin | moderator`
pair (2026-08-14) into a full cumulative ladder (2026-08-16, owner decision):

```
viewer < reader < contributor < moderator < admin < owner
```

Each role includes everything beneath it. Two roles on this ladder are
deliberately **never written by the grant API**:

- **`viewer`** — never stored. No `site_roles/{uid}` doc for a person means
  viewer. It is still a first-class row in the capability map (below) so its
  permissions are defined and visible in the one place the whole ladder
  lives — it is just never a value the POST body or the Firestore doc holds.
- **`owner`** — DB-only. There is no API path and no UI path that can grant,
  revoke, or otherwise modify a row at `owner` — not for an owner, not for
  anyone. The only way in or out is a direct D1/Firestore edit (or, for the
  ESTATE-wide sense below, an edit to `OWNER_EMAILS`). Enforced by
  `canGrant()` refusing `owner` as a target for every possible actor,
  including another owner — see the "owner is immune to owner" test in
  `test/role-ladder.test.ts`.

**`club mod` is not on this ladder.** It stays exactly where it already
lived — a club's own `managerUids`, per-club and orthogonal to the
estate-wide ladder — and this build does not touch it.

## Two different "owner" concepts, on purpose

This build sits on top of **two** owner mechanisms that already existed for
different reasons, and it is important they not be confused:

1. **`OWNER_EMAILS`** (`apps/auth-worker/wrangler.toml`, an env var, not a
   secret) — the ESTATE's own break-glass, unrelated to any single site's
   roles. Every email listed there is answered `approved` + `is_approver`
   regardless of table state (design §4.3), on every estate surface. As of
   2026-08-16 this list holds **two** Google accounts for the owner (their
   primary, and a second account that owns the `audiobook-catalog` GCP
   project) — both must carry identical standing, so `OWNER_EMAILS` is
   comma-separated and every consumer (`parseOwnerEmails`,
   `effectiveLadderRole`) treats each entry independently.
2. **`owner`, the top of THIS ladder** — a per-site (here: audiobook)
   concept. `effectiveLadderRole()` (`role-ladder.ts`) checks `OWNER_EMAILS`
   FIRST: any estate owner is automatically ladder-`owner` on the audiobook
   site too, regardless of what their own `site_roles/{uid}` Firestore doc
   says. This is why an owner's own doc can still literally read
   `role: 'admin'` (the value the audiobook site's firestore.rules
   understands today — see below) while this Worker's grant decisions treat
   them as `owner`: the two facts serve different consumers and neither
   needs to change for the other to be correct.

## The granting rule

An actor may grant or revoke a role **strictly beneath their own** — no
self-escalation, no peer-promotion (`admin` cannot mint another `admin`;
only `owner` can). Additionally, **granting/revoking anything requires
holding at least `moderator`** — `reader` and `contributor` are cumulative
capability tiers, not management tiers, and hold zero grant power even over
roles beneath them (the design's own answer to "can `contributor` grant
`reader`?" is "no, `moderator`+").

Both halves live in one pure function,
`canGrant(actorRole, targetRole)` (`role-ladder.ts`), checked TWICE per
request in `site-roles.ts`'s POST handler: once against the role being
**removed** (the target's current role — this is what makes an `owner` row
immune no matter what new role was requested) and, for a grant, once against
the role being **added**. A denial always names its reason and answers 403.

| actor \ target | reader | contributor | moderator | admin | owner |
|---|---|---|---|---|---|
| viewer/reader/contributor | ✗ (below grant floor) | ✗ | ✗ | ✗ | ✗ |
| moderator | ✓ | ✓ | ✗ (peer) | ✗ | ✗ |
| admin | ✓ | ✓ | ✓ | ✗ (peer) | ✗ |
| owner | ✓ | ✓ | ✓ | ✓ | ✗ (no path, ever) |

## Storage + API

Nothing new was invented — the ladder extends the existing federation
(`apps/auth-worker/src/site-roles.ts`), same Firestore collection
(`site_roles/{uid}`), same grant shape (`role`/`email`/`displayName`/
`grantedAt`/`grantedBy`), same uid-resolution-at-write-time-so-a-typo-can't-
be-granted mechanic.

```
GET  /api/estate/site-roles        holders + the CALLER's own ladder role
                                    (actorRole) + what they may presently
                                    grant (grantable) — approver-gated,
                                    503 service_account_unset if the
                                    Firestore secret isn't configured
POST /api/estate/site-roles        {email, role} — role is one of
                                    reader|contributor|moderator|admin, or
                                    null (revoke). 403 {error:'forbidden',
                                    detail:<reason>} on any escalation
                                    canGrant() refuses
GET  /api/estate/site-roles/tree   the ladder + capability map (the "role
                                    tree map" the owner asked to see) —
                                    STATIC data, no Firestore round-trip,
                                    so it works even before the service
                                    account secret is set
```

`apps/auth-worker/migrations/0005_role_ladder.sql` adds one new D1 table,
`site_role_grant_log` — an audit trail Firestore's overwrite-in-place doc
can't provide (it only ever holds the CURRENT grant's stamp). Every
grant/revoke/denial attempt is recorded: who, from what role, to what role,
and — on a denial — why. Best-effort, never load-bearing: a write failure
there is logged and swallowed, never allowed to undo or block the real
Firestore decision.

## ⚠️ The firestore.rules limitation — read this before granting `reader`/`contributor`

The audiobook site's `firestore.rules` is a **different repository**,
**owner-gated**, and **not touched by this build** (rules deploys are a
separate, deliberate act per that repo's own access rules). Today those
rules understand exactly two role strings: `'admin'` and `'moderator'`.

That means:

- `moderator` and `admin`, granted through this API, work exactly as they
  did before this build — real, rules-enforced permissions.
- `reader` and `contributor` are **fully real at the ladder/API layer** —
  storable, grantable (subject to the same escalation rules), visible in
  the admin UI's role-tree map — but **grant nothing beyond what an
  unlisted visitor already has** on the live audiobook site, because
  firestore.rules has no clause for either value yet. They are
  UI/permission-map concepts only, not enforcement, until a rules change
  ships.

**What that rules change would need to add**, per `ROLES.md §1`:

- a `reader` clause: today most reads on the audiobook site are already
  public, so this is mostly forward cover for whatever narrows later (Drive
  view access and shelf-server book-URL downloads are OUT of Firestore
  entirely — they're a different system's access decision, see
  `ROLES.md §§2–3`, not built by this pass);
- a `contributor` clause: nothing in firestore.rules today models an
  upload/contribution at all, so this is new surface (a pending-upload
  collection + its write rule), not a relaxed existing one.

This limitation is stated three times on purpose (this file,
`role-ladder.ts`'s `ROLE_CAPABILITIES` doc comment, and `site-roles.ts`'s
route comments) because it is the one place "the API says yes" and "the
site actually changes behavior" diverge, and that gap is exactly the kind
of thing that gets missed on the next pass.

## What was NOT built here

- The firestore.rules change above (explicitly out of scope; a different
  repo, owner-gated).
- `ROLES.md §2` (Drive ⇄ role parity, a reconciler) and `§3`'s actual
  Cloudflare Access External Evaluation policy wiring — read as background
  for how this ladder will eventually be consumed by other systems, but
  no Access policy or Drive reconciler was created by this build. The
  auth Worker's existing shape (a single source of truth other systems can
  ask allow/deny of) is already compatible with that future use; nothing
  here needs to change for it to happen.

## Verification

- `apps/auth-worker`: `npm test` (94 unit tests, incl. the full `canGrant`
  escalation matrix and the two-owner-accounts case), `npx tsc --noEmit`
  clean, `npm run probe` (local `wrangler dev`, 77 checks incl. the new
  tree-endpoint coverage and its "works without the Firestore secret"
  property).
- Repo root: `npm run probe:estate` (production, read-only/unauthenticated-
  edge only) — extended with tokenless-401 and apex-only-CORS coverage for
  `GET /api/estate/site-roles/tree`.
