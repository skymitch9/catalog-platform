/**
 * admin.js — the estate member directory page at heygabi.ai/admin.
 *
 * Thin by design: every decision (who may call, what a status transition
 * means, the never-delete rule, the OWNER_EMAILS break-glass) lives in the
 * auth Worker (catalog-platform/apps/auth-worker). This page signs in,
 * sends the Firebase ID token as a bearer, and renders what the APIs say.
 *
 * ## Federation, not centralization (estate-auth-design.md §1.2/§4.5)
 *
 * One row per person shows three different kinds of fact, each fetched from
 * and written to the system that owns it:
 *
 *   - estate STATUS (pending/approved/revoked) + approver — the auth Worker
 *   - per-catalog VISIBILITY (which shelves their search sees) — also the
 *     auth Worker (§4.5; the stored set, canonical order)
 *   - per-app ROLES — each app's OWN /api/admin surface, in each app's OWN
 *     vocabulary, verbatim: library `owner|manager|reader|pending`, games
 *     `owner|manager|rater|viewer|pending`. ⚠️ `reader` ≠ `viewer` — the
 *     dropdowns list what each endpoint answers and never translate.
 *     ⚠️ THREE app Workers now, not two (2026-08-16): `library2` — the
 *     second library instance at `padhard.heygabi.ai` ("Sam's library",
 *     `library_catalog`'s `[env.friend]`) — runs the SAME Worker code as
 *     library.heygabi.ai, so it answers the same `/api/admin/users` with the
 *     same vocabulary and the same apex-only CORS lock. It is a fourth
 *     managed site here, not a special case: same dropdown, same
 *     strictly-beneath granting (enforced by `canGrantRole` in that repo's
 *     `@lc/core`, server-side), same owner-auto-max rendering. The estate
 *     never redefines what a role means there. The
 *     AUDIOBOOK catalog (world-readable site) grew rules-enforced site
 *     roles 2026-08-14 and was extended 2026-08-16 to the full estate role
 *     LADDER (ROLES.md §1, audiobook_catalog repo — read-only reference):
 *     `guest < member < contributor < moderator < admin < owner`,
 *     cumulative — each role includes everything beneath it. Renamed
 *     mid-build from `viewer`/`reader` (owner decision — those read as
 *     near-synonyms and collided with Google Drive's own vocabulary).
 *     ⚠️ the `member` ROLE (may download) is NOT the same thing as an
 *     "estate member" (approved in the estate directory, the badge/status
 *     column elsewhere on this page) — an approved estate member can still
 *     hold no audiobook role at all (`guest`). `guest` is never stored
 *     (no row = guest) and `owner` is DB-only (no UI/API path ever touches
 *     it — this page cannot grant, revoke, or even display an editable
 *     control for it). They live in ITS system — Firestore
 *     site_roles docs — federated here through the auth Worker's
 *     /api/estate/site-roles (the Worker holds the service account;
 *     browsers can neither list nor write those docs). The Worker enforces
 *     "grant only strictly beneath your own role" server-side; this page
 *     mirrors that by only offering roles GET /site-roles's `grantable`
 *     array names — a row the caller may not touch renders read-only
 *     rather than a dropdown that would just be refused on submit. The full
 *     ladder + what each role does is fetched from
 *     GET /api/estate/site-roles/tree and rendered near the top of the page
 *     (the owner's "role tree map" ask) rather than hardcoded here.
 *
 * The page also offers ADD MEMBER BY EMAIL (POST /api/estate/users, origin
 * 'manual') so pre-seeding a person before their first sign-in never needs
 * a script — the owner's UI-first rule, 2026-08-14.
 *
 * A per-app fetch failure degrades to that app's cell reading "unreachable";
 * the directory and every other column keep working.
 *
 * The APIs:
 *   auth.heygabi.ai (CORS locked to https://heygabi.ai):
 *     GET  /api/estate/users               → { users: [...] }  (pending first)
 *     POST /api/estate/users/:id/status    { status: 'approved' | 'revoked' }
 *     POST /api/estate/users/:id/approver  { is_approver: boolean }
 *     POST /api/estate/users/:id/visibility { visibility: ['audiobook', ...] }
 *     GET  /api/estate/site-roles/tree     → { ladder, grantFloor, capabilities }
 *                                             — the role ladder + capability map
 *   library.heygabi.ai + boardgames.heygabi.ai + padhard.heygabi.ai (same
 *   CORS lock, each app's own `manageUsers` gate — this page holds no
 *   credential; the caller's own bearer must hold that capability THERE to
 *   change anything there. The owner is in `padhard`'s own OWNER_EMAILS
 *   (`library_catalog` wrangler.toml `[env.friend].vars`), which is what
 *   makes his bearer work on her instance):
 *     GET   /api/admin/users               → { app, roles, users: [{id,email,displayName,role}] }
 *     PATCH /api/admin/users/:id/role      { role: <one of that app's roles> }
 *
 * ⚠️ Because every Worker's CORS names https://heygabi.ai exactly, this page
 * does not work from www.heygabi.ai or a local file. That is the Workers'
 * config being right, not a bug here — the page says so instead of failing
 * mutely.
 *
 * ## ⚠️ THE INTERACTION GRAMMAR — TWO GESTURES, AND ONLY TWO
 *
 * Owner order 2026-08-17, verbatim: *"auth setting has too many different auth
 * setting experiences, sometimes we double click to confirm sometimes we use
 * the drop down."* He was right, and the count was four: a visibility checkbox
 * wrote the instant it was ticked; the library/games/Sam's-library dropdowns
 * wrote the instant they changed (and said so by CLEARING the status line, i.e.
 * silently); the audiobook dropdown staged and needed a two-tap apply button;
 * and the estate buttons were one-tap for Approve and two-tap for everything
 * else. Four gestures for one job — "change what this person may do".
 *
 * Every control on this page is now one of exactly two:
 *
 *   1. GRANT-CLASS — a `visible` box, any site's role dropdown, on EVERY site.
 *      Touching it changes NOTHING: it stages (the control is outlined, the
 *      card counts the unsaved edits) and ONE `Save permissions` button, which
 *      APPEARS on that person's card the moment anything in it changes,
 *      commits the lot and says in words what changed.
 *
 *      ⚠️ The owner settled this shape himself, 2026-08-17, from the live page:
 *      *"how come only audiobooks and ebooks have set role? I thought we were
 *      normalizing this. either they all have set role for each site or none. I
 *      think you should do a confirm/save button and no set role button for
 *      each role. have the save button appear on each persons box when a change
 *      is made."* So: no per-row apply button anywhere, one per-card Save, and
 *      it is hidden until there is something to save.
 *
 *      Per MEMBER rather than per row is also the only correct shape: POST
 *      /visibility takes the WHOLE canonical set, not a delta, so a per-row
 *      Save would silently commit another row's staged boxes.
 *   2. STATUS-CLASS — Approve, Revoke, Make/Remove approver, Make/Remove
 *      devops, Give/Remove dev access (0011, 2026-08-17 — it joined this class
 *      rather than inventing a third gesture, which is the whole point of the
 *      grammar). All two-tap (confirmBtn): first tap arms, second writes, and it
 *      disarms itself after 4s. ⚠️ Approve was one-tap until 2026-08-17. It
 *      changed not because approving got riskier but because "which buttons
 *      need two taps" was one more thing to know — and the standing owner
 *      order of 2026-08-15 already put make-approver and make-devops (both
 *      additive, both low-stakes) on two taps, so "only destructive things
 *      confirm" was never the live rule and could not be made into one
 *      without overturning that order.
 *
 * Anything that is NOT a control is WORDED and says why: an owner's rank
 * (.perm-owner), a rung above your grant power or a site with no row for this
 * person yet (.perm-note), a site whose Worker did not answer (.perm-warn),
 * a capability held implicitly — devops/approver already see the dev
 * environments, so their card states that instead of drawing a Give-dev-access
 * button that could not change the answer (.user-fact + the same two classes).
 * Never a disabled dropdown — a greyed control reads as "something you could
 * enable", and there is nothing to enable.
 *
 * ⚠️ NOT ONE BYTE OF THE WIRE CHANGED IN THIS RESHAPE. The same four
 * endpoints, the same bodies, the same canonical visibility array, the same
 * per-app vocabularies. Only when the write happens, and how it is announced.
 * A new control on this page picks one of the two gestures; it does not invent
 * a third (docs/access/estate-auth.md §9).
 *
 * ## THE DIRECTORY IS THREE COLLAPSIBLE SECTIONS (2026-08-17)
 *
 * Owner, from the live page: *"i revoked access to an account on /admin, its
 * still in the list, lets move these to a revoked section, lets also make the
 * effort to have a pending area too while we're in here. make pending, revoked,
 * and current members list all collapsable."*
 *
 * Current members (approved) · Pending · Revoked, in that order, each a native
 * <details> carrying a live count, each holding the SAME `li.user` cards as
 * before. See DIRECTORY_GROUPS / directorySection() / renderFilteredList().
 *
 * Three things about it are worth knowing before touching it:
 *
 *   - It is a REGROUPING, not a redesign. No card, badge, dropdown, Save
 *     button, dev-access button or owner fact changed; the two gestures above
 *     are untouched and so is every endpoint.
 *   - The MOVE is free. A status write already went through mutate() →
 *     loadDirectory() → renderFilteredList(), so approving or revoking someone
 *     re-fetches and re-deals the sections on the refresh cycle the page has
 *     always run. Nothing moves a card by hand, which is what keeps the
 *     sections honest: they are the server's `status` column, dealt out.
 *   - Filters and sort are unchanged and still run over the WHOLE directory.
 *     The status FILTER survives on purpose (it narrows to one section and is
 *     the only way to see a status alone), and an emptied section says so in
 *     words rather than claiming the estate is empty.
 */

import { handleRedirectResult, idToken, signIn, signOutUser, watchAuth } from '../assets/estate-auth.js';
import { confirmBtn } from '../assets/estate-controls.js';

const AUTH_ORIGIN = 'https://auth.heygabi.ai';
const CANONICAL_ORIGIN = 'https://heygabi.ai';

/** §4.5's canonical catalog order — never re-sorted, never duplicated.
 *  `library2` (0007) is the second library instance — visibility DEFAULTS
 *  TO 0 there, so every row renders it unchecked until deliberately granted. */
const CATALOGS = ['audiobook', 'library', 'games', 'library2', 'ebooks'];

/**
 * UI labels only — the wire vocabulary stays the CATALOGS keys above.
 *
 * ⚠️ PLURAL AND CAPITALISED, owner order 2026-08-17: *"instead of a new line
 * for ebooks in the auth page, just make it Audiobook/Ebooks. also they should
 * both be plural."* `Ebooks` was already plural and capitalised, so the sweep
 * brought the rest of the display names into line with it rather than the other
 * way round. `Library` stays singular — it is the name of one shelf, and
 * "Libraries" would describe something that does not exist here.
 *
 * ⚠️ DISPLAY ONLY. The keys are the persisted/site vocabulary (`audiobook`,
 * `ebooks`, `library2`, …) and are never renamed: they are what the visibility
 * array stores, what `data-cat` carries, and what the auth Worker validates.
 */
const CATALOG_LABELS = {
  audiobook: 'Audiobooks',
  library: 'Library',
  games: 'Games',
  library2: "Sam's library",
  ebooks: 'Ebooks',
};

/**
 * The catalogs that share ONE row (owner order 2026-08-17). Audiobooks and
 * Ebooks are one surface — the same site, the same `site_roles` ladder — and
 * ebook visibility is simply a second grant on it, so two lines describing one
 * thing was two places to look for one answer. The row shows both visibility
 * boxes beside the single role dropdown that governs both.
 *
 * ⚠️ Order matters twice over: it is the order the boxes render in AND the
 * order the label is joined in ("Audiobooks/Ebooks"), and both keys must stay
 * inside CATALOGS so the save keeps posting §4.5's canonical set.
 */
const MERGED_ROW = ['audiobook', 'ebooks'];

/**
 * The app Workers with roles to federate, in §4.5's canonical CATALOGS order
 * minus `audiobook` (whose roles come from the auth Worker's site-roles
 * federation instead; roleCell() renders both kinds from one function).
 *
 * ⚠️ `library2` appends LAST and never moves — the canonical order is
 * load-bearing across repos. It is `library_catalog`'s `[env.friend]`
 * deploy: the SAME Worker code at a different hostname with its own D1, so
 * `/api/admin/users` answers the identical `{ app, roles, users }` shape and
 * the identical apex-only CORS lock. Nothing special-cases it.
 *
 * `seedGap: false` on library2 is deliberate and is the ONE difference (see
 * renderSeedGaps): her roster is HER household's, not a subset of ours, so
 * "listed there but not in the estate directory" is the normal state there
 * rather than a seed that missed someone. Flagging it would be a warning
 * that can never be cleared.
 */
const APPS = [
  { key: 'library', label: 'library', origin: 'https://library.heygabi.ai', seedGap: true },
  { key: 'games', label: 'games', origin: 'https://boardgames.heygabi.ai', seedGap: true },
  { key: 'library2', label: "Sam's library", origin: 'https://padhard.heygabi.ai', seedGap: false },
];

/**
 * ⚠️ THE ROW LIST — ONE SHAPE, USED THREE TIMES (owner order 2026-08-17: "maybe
 * just make a full permission map after normalizing everything").
 *
 * These rows are the page's spine. The SAME list, in the SAME order, drives:
 *   - every member's permission grid (permGrid),
 *   - the "Permission map" disclosure at the top (renderPermissionMap),
 *   - and the order the filter chips and the per-site role filters read in.
 * That is what makes the map and the live grid look like each other, which is
 * the whole ask: the page should read like docs/info/role-capability-map.md,
 * but for this person, right now.
 *
 * `catKeys` is a LIST because one row can cover more than one visibility grant
 * — Audiobooks/Ebooks is one site behind one ladder with two grants on it
 * (f7697f4, owner order the same day). `roleSource` says which federation
 * answers the row's role: the auth Worker's site-roles ladder, or that app's
 * own /api/admin surface in its own vocabulary.
 */
const SITE_ROWS = [
  { id: 'audiobook', label: 'Audiobooks/Ebooks', catKeys: MERGED_ROW, roleSource: 'audiobook' },
  { id: 'library', label: CATALOG_LABELS.library, catKeys: ['library'], roleSource: 'app' },
  { id: 'games', label: CATALOG_LABELS.games, catKeys: ['games'], roleSource: 'app' },
  { id: 'library2', label: CATALOG_LABELS.library2, catKeys: ['library2'], roleSource: 'app' },
];

/**
 * What each rung MEANS, one line each — the derived capability column, and the
 * "grants" column of every app ladder in the top map.
 *
 * ⚠️ COPIED FROM docs/info/role-capability-map.md (the owner-approved,
 * NORMATIVE map, verified against source 2026-08-17), not invented here. The
 * audiobook/ebooks row prefers the LIVE summary the auth Worker sends with its
 * ladder (GET /site-roles/tree) and only falls back to this; the app rows have
 * no such endpoint, so this is what they get.
 *
 * ⚠️ KEYED BY THE WORD, and every site's OWN words are listed, because this
 * page never translates a vocabulary (§1.2). A rung this map has no line for
 * renders WITHOUT a meaning rather than a guessed one — an unavailable fact is
 * reported unavailable, never filled in with something plausible.
 */
const RUNG_MEANINGS = {
  guest: 'looks — sees whatever visibility opens, changes nothing.',
  member: 'participates — their own ratings, reviews, TBR and notes, and may retract them.',
  contributor: 'builds the catalog — edits works/editions/copies, curates the wishlist, uploads, free barcode scans.',
  moderator: 'spends and moderates — photo scans and paid research (both bill), others’ notes, running a club.',
  admin: 'runs people — approves members and changes roles; on Audiobooks/Ebooks this is also the download rung.',
  owner: 'the recovery identity — max everywhere, forced by OWNER_EMAILS at sign-in.',
  // The older per-app words. Listed because those Workers still answer them;
  // listing them is not translating them.
  manager: 'runs that site — its catalog and its people.',
  reader: 'looks, and tracks their own reading.',
  viewer: 'looks.',
  rater: 'looks, and rates.',
  pending: 'nothing yet — waiting on a decision there.',
  none: 'no site role — a guest: looks at whatever visibility opens.',
};

/**
 * The rung at which downloading an ebook file becomes possible.
 *
 * ⚠️ A DOCUMENTED CONSTANT, NOT A GUESS: `download` floors at `admin` in
 * apps/audiobook-worker/src/capabilities.ts (pinned by that repo's
 * capabilities.test.ts) and is the ⚠️-marked row of
 * docs/info/role-capability-map.md. The ladder endpoint answers per-rung
 * summaries but not capability FLOORS, so this is the one download fact the page
 * cannot read from a Worker. If the floor moves, it moves here and in that map —
 * and the derived capability line is now the ONLY place on the page that says
 * it (owner, 2026-08-17, on the standalone tag that used to: it "looks bad and
 * idk what its trying to tell me").
 */
const EBOOK_DOWNLOAD_RUNG = 'admin';

/**
 * STAGED, UNSAVED GRANTS — the half of the grant grammar that makes "nothing
 * writes as you touch it" true.
 *
 *   estate user id → { vis: { [catKey]: boolean }, roles: { [rowId]: role } }
 *
 * ⚠️ KEYED BY USER ID, NOT HELD IN THE DOM, on purpose: renderFilteredList()
 * rebuilds every card from scratch on every sort, filter, search keystroke and
 * mutation, so state living in a checkbox would be silently discarded by
 * typing in the search box. It survives all of that, and is pruned against
 * fresh server truth on every render (stagedRole/stagedVis) so an edit that
 * the server has since agreed with simply stops being an edit.
 */
const pendingEdits = new Map();

/** Which member cards are expanded — same reasoning: survives every re-render. */
const expandedMembers = new Set();

/**
 * ⚠️ THE DIRECTORY IS THREE SECTIONS, NOT ONE LIST (owner order 2026-08-17,
 * verbatim: *"i revoked access to an account on /admin, its still in the list,
 * lets move these to a revoked section, lets also make the effort to have a
 * pending area too while we're in here. make pending, revoked, and current
 * members list all collapsable."*).
 *
 * The three keys are the WHOLE status vocabulary and are not a UI invention:
 * `estate_user.status` is `CHECK (status IN ('pending','approved','revoked'))`
 * in the auth Worker's migration 0001, and STATUS_RANK below has ranked the
 * same three since sorting existed. This groups by exactly that column —
 * nothing here re-derives or re-interprets what a status means.
 *
 * ⚠️ A ROW IS NEVER DROPPED FOR HAVING AN UNEXPECTED STATUS. A status outside
 * these three would be a schema change, so it "cannot happen" — but a page
 * that silently vanishes a member on a value it does not recognise is the
 * worst possible failure for a page whose only job is showing who has access.
 * directorySection()'s caller collects any leftover status into its own
 * section, named after the status, rather than filtering it away.
 *
 * `defaultOpen` is only consulted while the reader has NOT touched that
 * section (see openGroups): Current is where the work is; Pending opens itself
 * whenever somebody is actually waiting, because a pending person is an action
 * outstanding; Revoked starts shut, since "revoked rows clutter the list I
 * read" is the complaint that produced this whole change.
 */
const DIRECTORY_GROUPS = [
  {
    key: 'approved',
    title: 'Current members',
    defaultOpen: () => true,
    empty: 'Nobody is approved yet — approve someone from Pending and they appear here.',
    hiddenNoun: (n) => (n === 1 ? 'current member' : 'current members'),
  },
  {
    key: 'pending',
    title: 'Pending',
    defaultOpen: (n) => n > 0,
    empty: 'Nobody is waiting.',
    hiddenNoun: (n) => (n === 1 ? 'pending person' : 'pending people'),
  },
  {
    key: 'revoked',
    title: 'Revoked',
    defaultOpen: () => false,
    empty: 'Nobody has been revoked.',
    hiddenNoun: (n) => (n === 1 ? 'revoked person' : 'revoked people'),
  },
];

/**
 * Which sections the reader has DELIBERATELY opened or shut, by group key.
 *
 * ⚠️ Absent means "still on the default" — not "closed". The distinction is the
 * point: `defaultOpen` has to keep applying (Pending opening itself the moment
 * a person appears in it) right up until the reader expresses a preference, and
 * from then on their choice must survive the re-render that every search
 * keystroke, sort change and mutation triggers. Same reasoning, same shape and
 * the same deliberate NON-persistence as expandedMembers above: held in memory,
 * cleared on sign-out, never in the DOM (which is rebuilt) and never in
 * sessionStorage (which would outlive the directory it describes and pin
 * Pending shut on a later day when somebody genuinely is waiting).
 */
const openGroups = new Map();

/**
 * SORT + FILTER — client-side over the directory already in memory (owner
 * ask: "sort on who has access to what catalogs, who's an admin in what
 * spaces"). Household scale — no server round-trip, no pagination.
 */
const NO_ACCOUNT = '__none__'; // per-app role filter: "no row in that app's roster yet" (audiobook: "no site role")
/** Every column with a role filter: the audiobook site-roles federation + the
 *  three app Workers, in canonical CATALOGS order (library2 appended last). */
const ROLE_FILTER_KEYS = ['audiobook', 'library', 'games', 'library2'];
const SORT_KEYS = ['name', 'email', 'status', 'first_seen', 'decided', 'breadth'];
const STATUS_RANK = { pending: 0, approved: 1, revoked: 2 }; // the existing pending-first instinct, made sortable
const DEFAULT_DIR_FOR_KEY = { // the sensible starting direction when a sort key is first picked
  name: 'asc', email: 'asc', status: 'asc', first_seen: 'asc', decided: 'asc', breadth: 'desc',
};
const VIEW_STORAGE_KEY = 'hg-admin-view-v1'; // sessionStorage: survives a refresh, not a new tab/session
const collator = new Intl.Collator(undefined, { sensitivity: 'base' });

const signinBtn = document.getElementById('signin');
const whoEl = document.getElementById('who');
const refreshBtn = document.getElementById('refresh');
const statusEl = document.getElementById('status');
const usersEl = document.getElementById('users');
const gapsEl = document.getElementById('gaps');
const controlsEl = document.getElementById('controls');
const countEl = document.getElementById('count');
const advEl = document.getElementById('adv');
const advCountEl = document.getElementById('adv-count');

let currentUser = null;

/**
 * Per-app directory state, keyed by app key:
 *   null                                  — not loaded yet
 *   { ok: true, roles, byEmail }          — that app's list + vocabulary
 *   { ok: false, why }                    — degraded; why is shown in-cell
 */
let appDirs = Object.fromEntries(APPS.map((a) => [a.key, null]));

/**
 * Audiobook site-roles state, same shape contract as appDirs entries, plus
 * the ladder-specific fields the auth Worker now includes:
 *   null | { ok: true, roles, byEmail, actorRole, grantable } | { ok: false, why }
 * byEmail maps lowercased email → { role, uid, ... } so the filter logic
 * can treat all three role columns uniformly (roleDirFor). `actorRole` is
 * the SIGNED-IN caller's own ladder role on the audiobook site (computed
 * server-side: OWNER_EMAILS always wins); `grantable` is exactly the
 * SITE_ROLES entries canGrant() currently allows this caller to set —
 * roleCell renders a dropdown only for rows that array covers.
 */
let siteRolesDir = null;

/**
 * The role ladder + capability map (owner ask: "see a role tree map"),
 * fetched once per load from GET /api/estate/site-roles/tree — static
 * data, so it degrades independently of siteRolesDir (it works even when
 * the Firestore service account isn't configured there).
 *   null | { ok: true, ladder, grantFloor, capabilities } | { ok: false, why }
 */
let roleTreeDir = null;

function roleDirFor(key) {
  return key === 'audiobook' ? siteRolesDir : appDirs[key];
}

/**
 * THE SPENDING PANEL's data — GET /api/estate/billing/rules, which answers the
 * registry AND the rules in one call.
 *
 * ⚠️ THE REGISTRY COMES FROM THE SERVER AND IS NEVER RESTATED HERE. A second
 * copy of the feature list in this file would be the `research.cover` /
 * `research.covers` drift the auth Worker's pin test exists to catch, one layer
 * up and with no test in front of it — and a mis-spelled id posts a rule that
 * denies nothing while looking exactly like a switch that worked.
 *   null | { features, sites, groups, rules, unknown, effect_delay_note }
 */
let billingDir = null;

/**
 * Staged cell edits, keyed `${feature}|${site}` → true (ON) | false (OFF).
 *
 * ⚠️ GRANT-CLASS, per this page's two-gesture grammar: clicking a cell changes
 * NOTHING. It stages, the cell is outlined, and one Save at the foot of the
 * panel commits the lot with the `why` typed beside it. That matches the
 * owner's own settlement of the shape ("do a confirm/save button and no set
 * role button for each role"), and it is also forced by the data: a deny row
 * cannot be written without a `why`, and a per-cell write would ask for one
 * per click.
 */
const billingStaged = new Map();

/**
 * THE VERSE QUEUE's data — GET /api/estate/universes/requests (design
 * docs/info/universe-add-verse-design.md §6 Q2: a collapsed section here, not a
 * new page and not a tab bar).
 *
 * 🔴 NOTHING IN THIS PANEL CREATES A UNIVERSE. Approving sets a status; the
 * verse itself is a decision in data/universes.json, in git, that a person
 * commits with `tools/universes.mjs` and ships by rebuilding both catalogs.
 * That is why the queue has a fourth status — `approved` is not `landed`, and
 * drawing them the same way would tell a member their verse exists while the
 * file has not been touched.
 *   null | { requests, scope, is_approver, approved_stale_days }
 */
let verseQueue = null;

/** The full directory as last loaded — filters/sort run over this, it is never re-fetched for a view change. */
let allEstateUsers = [];

let state = loadPersistedView();

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
  statusEl.hidden = !text;
}

// ---------------------------------------------------------------------------
// API calls — the auth Worker (directory + visibility)
// ---------------------------------------------------------------------------

async function api(path, init) {
  const token = await idToken();
  if (!token) {
    setStatus('Sign-in lapsed — sign in again.', 'warn');
    return null;
  }
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch (e) {
    // On the wrong origin the browser reports CORS failures as a bare
    // network error — say the likely cause instead of "failed to fetch".
    if (location.origin !== CANONICAL_ORIGIN) {
      setStatus(
        `The auth Worker did not answer. Its admin API only accepts calls from ${CANONICAL_ORIGIN} — ` +
        `this page is running on ${location.origin}, so use ${CANONICAL_ORIGIN}/admin instead.`,
        'warn',
      );
    } else {
      setStatus('The auth Worker did not answer (network). Try again shortly.', 'warn');
    }
    return null;
  }

  if (res.ok) return res.json();

  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* the status code still speaks */ }

  switch (res.status) {
    case 401:
      setStatus('The directory did not accept the sign-in token. Sign out and back in.', 'warn');
      break;
    case 403:
      setStatus(
        'This page needs an approver account. You are signed in, but approving members is itself an ' +
        'approver-only power — an existing approver (or an owner email) can grant it from this page.',
        'warn',
      );
      break;
    case 409:
      // e.g. promoting someone who is not yet approved — the API's own words.
      setStatus(body?.detail || body?.error || 'That change is not coherent yet.', 'warn');
      break;
    default:
      // §1e: never a bare HTTP status — say it failed, and pass along the
      // server's own words when it gave any, but never the number alone.
      setStatus(`Something went wrong on the server${body?.error ? ` (${body.error})` : ''}. Try again shortly.`, 'warn');
  }
  return null;
}

// ---------------------------------------------------------------------------
// API calls — the app Workers (federated roles)
// ---------------------------------------------------------------------------

/**
 * One app's member list + role vocabulary, or the reason it degraded.
 * Never throws: a broken app becomes an honest cell, not a broken page.
 */
async function fetchAppDirectory(app) {
  const token = await idToken();
  if (!token) return { ok: false, why: 'sign-in lapsed' };
  let res;
  try {
    res = await fetch(`${app.origin}/api/admin/users`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, why: 'token refused' };
  if (res.status === 403) return { ok: false, why: 'needs an owner account there' };
  if (!res.ok) return { ok: false, why: 'server error' };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: 'unreadable answer' };
  }
  const byEmail = new Map();
  for (const u of data.users ?? []) byEmail.set(String(u.email).toLowerCase(), u);
  return { ok: true, roles: Array.isArray(data.roles) ? data.roles : [], byEmail };
}

/** PATCH one role change to one app. True on success; failures explain themselves. */
async function patchAppRole(app, appUserId, role) {
  const token = await idToken();
  if (!token) {
    setStatus('Sign-in lapsed — sign in again.', 'warn');
    return false;
  }
  let res;
  try {
    res = await fetch(`${app.origin}/api/admin/users/${appUserId}/role`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    });
  } catch (e) {
    setStatus(`The ${app.label} catalog did not answer — the role is unchanged.`, 'warn');
    return false;
  }
  if (res.ok) {
    setStatus('');
    return true;
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* the status code still speaks */ }
  const detail = typeof body?.detail === 'string' ? body.detail : null;
  setStatus(`${app.label}: ${detail || `role change refused (${res.status})`}`, 'warn');
  return false;
}

// ---------------------------------------------------------------------------
// API calls — the audiobook site-roles federation (auth Worker holds the
// service account; this page holds nothing)
// ---------------------------------------------------------------------------

/** The site-roles roster + vocabulary, or the reason the cell degrades. */
async function fetchSiteRoles() {
  const token = await idToken();
  if (!token) return { ok: false, why: 'sign-in lapsed' };
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/site-roles`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, why: 'token refused' };
  if (res.status === 403) return { ok: false, why: 'needs an approver account' };
  if (res.status === 503) return { ok: false, why: 'service account not configured on the auth Worker' };
  if (!res.ok) return { ok: false, why: 'server error' };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: 'unreadable answer' };
  }
  const byEmail = new Map();
  for (const h of data.holders ?? []) {
    if (h.email) byEmail.set(String(h.email).toLowerCase(), h);
  }
  return {
    ok: true,
    roles: Array.isArray(data.roles) ? data.roles : [],
    byEmail,
    actorRole: typeof data.actorRole === 'string' ? data.actorRole : 'guest',
    grantable: Array.isArray(data.grantable) ? data.grantable : [],
    // Lowercased server-side already; defaulted to [] so an older Worker
    // simply means "nobody is flagged as owner" rather than a crash.
    ownerEmails: Array.isArray(data.ownerEmails) ? data.ownerEmails : [],
  };
}

/**
 * Is this estate row an OWNER? (owner decision 2026-08-16.)
 *
 * ⚠️ Read from the server's OWNER_EMAILS, never inferred from a stored role.
 * 'owner' is deliberately absent from SITE_ROLES and is never written to a
 * site_roles doc, so a stored role can never say 'owner' — inferring it from
 * one would silently answer "no" for every real owner.
 *
 * Fails CLOSED in the useful direction: if the field is missing (older Worker,
 * failed fetch), nobody is treated as an owner and the page keeps its previous
 * behaviour of offering a dropdown the server will refuse. That is the same
 * safety the page had before this flag existed — never worse.
 */
function isOwnerEmail(estateUser) {
  const list = siteRolesDir && siteRolesDir.ok ? siteRolesDir.ownerEmails : null;
  if (!Array.isArray(list) || !list.length) return false;
  return list.includes(String(estateUser.email || '').trim().toLowerCase());
}

/**
 * The role ladder + capability map. Independent of fetchSiteRoles() on
 * purpose — the tree endpoint needs no Firestore service account, so it
 * can succeed (and the ladder can render) even when the roster cell above
 * is showing "service account not configured".
 */
async function fetchRoleTree() {
  const token = await idToken();
  if (!token) return { ok: false, why: 'sign-in lapsed' };
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/site-roles/tree`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, why: 'unreachable' };
  }
  if (res.status === 401) return { ok: false, why: 'token refused' };
  if (res.status === 403) return { ok: false, why: 'needs an approver account' };
  if (!res.ok) return { ok: false, why: 'server error' };
  let data;
  try {
    data = await res.json();
  } catch (e) {
    return { ok: false, why: 'unreadable answer' };
  }
  if (!Array.isArray(data.capabilities) || !Array.isArray(data.ladder)) {
    return { ok: false, why: 'unrecognized shape' };
  }
  return { ok: true, ladder: data.ladder, grantFloor: data.grantFloor, capabilities: data.capabilities };
}

/** POST one grant/revoke. role null = revoke. True on success; failures explain themselves. */
async function postSiteRole(email, role) {
  const token = await idToken();
  if (!token) {
    setStatus('Sign-in lapsed — sign in again.', 'warn');
    return false;
  }
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/site-roles`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, role }),
    });
  } catch (e) {
    setStatus('The auth Worker did not answer — the audiobook role is unchanged.', 'warn');
    return false;
  }
  if (res.ok) {
    setStatus('');
    return true;
  }
  let body = null;
  try {
    body = await res.json();
  } catch (e) { /* the status code still speaks */ }
  const detail = typeof body?.detail === 'string' ? body.detail : null;
  setStatus(`audiobook: ${detail || `role change refused (${res.status}${body?.error ? `: ${body.error}` : ''})`}`, 'warn');
  return false;
}

/** Add-member-by-email (POST /api/estate/users, origin 'manual'). */
async function createMember(email) {
  const data = await api('/api/estate/users', { method: 'POST', body: JSON.stringify({ email }) });
  return data; // null on failure (api() already said why)
}

// ---------------------------------------------------------------------------
// Loading — the directory, both app lists and the site-roles roster, in parallel
// ---------------------------------------------------------------------------

async function loadDirectory() {
  setStatus('Loading…');
  // One fetch per app Worker, driven by APPS rather than positional
  // destructuring — adding a fourth managed site is a row in APPS and
  // nothing else. A failed app fetch degrades that column only.
  const [estate, appResults, sroles, rtree, billing, verses] = await Promise.all([
    api('/api/estate/users'),
    Promise.all(APPS.map((app) => fetchAppDirectory(app))),
    fetchSiteRoles(),
    fetchRoleTree(),
    // ⚠️ `api()` returns null on any failure and has already said why, so an
    // unreachable billing route costs the Spending panel and nothing else —
    // the same degrade-alone rule every other federation here follows.
    api('/api/estate/billing/rules'),
    // The verse queue, same degrade-alone rule. ⚠️ A Worker running ahead of
    // migration 0017 answers 200 with an empty queue and an explanation rather
    // than an error, so this panel renders and says why it is empty instead of
    // vanishing and looking like there is nothing to decide.
    api('/api/estate/universes/requests'),
  ]);
  appDirs = Object.fromEntries(APPS.map((app, i) => [app.key, appResults[i]]));
  siteRolesDir = sroles;
  roleTreeDir = rtree;
  billingDir = billing;
  verseQueue = verses;
  renderPermissionMap();
  renderSpendingPanel();
  renderVerseQueue();
  // Owner: "just always auto fill and write the max role possible for each
  // site." Fire-and-forget — the render below must not wait on it.
  void reconcileOwnerRoles();
  if (!estate) {
    // api() already said why. The app lists are useless without the spine.
    usersEl.innerHTML = '';
    gapsEl.hidden = true;
    return;
  }
  setStatus('');
  renderUsers(estate.users);
  renderSeedGaps(estate.users);
  // Auth resolves async, so the directory renders well after page load —
  // this is the moment the anchor's target actually exists.
  revealAnchoredMember();
}

/**
 * ⚠️ A REVOCATION HAS TWO HALVES, and only one of them is D1.
 *
 * POST /estate/users/:id/status clears the estate row (status, approver,
 * devops) and then, best-effort, the audiobook LADDER role in Firestore —
 * which the audiobook site's own rules read directly from the browser, so a
 * stale one keeps real powers there (site-wide review deletes, club
 * administration) no matter what this directory says. There is no
 * transaction across the two stores: the Worker answers 200 for the
 * revocation that landed and reports the second half in `site_role`.
 *
 * So this must never be dropped on the floor. Returns the sentence to show,
 * or null when there is genuinely nothing to say (it worked, or they had no
 * audiobook role to lose).
 */
function siteRoleNote(siteRole) {
  if (!siteRole || siteRole.cleared) return null;
  if (siteRole.reason === 'no_role' || siteRole.reason === 'no_firebase_user') return null;
  const failed = siteRole.reason === 'firestore_error' || siteRole.reason === 'service_account_unset';
  return { text: siteRole.detail, tone: failed ? 'warn' : '' };
}

async function mutate(path, body) {
  const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
  if (!data) return;
  const note = siteRoleNote(data.site_role);
  // loadDirectory() clears the status line on success, so the note goes after.
  await loadDirectory();
  if (note) setStatus(note.text, note.tone);
}

// ---------------------------------------------------------------------------
// Filtering & sorting — entirely client-side over `allEstateUsers`. Every
// control change and every mutation re-render both funnel through
// renderFilteredList(), so approve/revoke/visibility/role edits never reset
// what the admin was looking at. Persisted in sessionStorage; every stored
// value is re-validated on load (and the app-role vocab re-checked on every
// render) rather than trusted, since a stale value can outlive its vocab.
// ---------------------------------------------------------------------------

function defaultFilters() {
  return {
    status: 'all',       // all | pending | approved | revoked
    approverOnly: false,
    visCats: [],          // subset of CATALOGS the member must SEE (AND semantics)
    // 'any' | NO_ACCOUNT | a role from that column's own vocab. audiobook =
    // the site-roles federation (NO_ACCOUNT there means "no site role").
    appRoles: Object.fromEntries(ROLE_FILTER_KEYS.map((k) => [k, 'any'])),
    q: '',
  };
}

function defaultSort() {
  return { key: 'name', dir: 'asc' };
}

function loadPersistedView() {
  const filters = defaultFilters();
  const sort = defaultSort();
  let advOpen = false; // advanced filters section: collapsed by default (owner spec)
  try {
    const raw = sessionStorage.getItem(VIEW_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const pf = parsed?.filters;
      if (pf) {
        if (['all', 'pending', 'approved', 'revoked'].includes(pf.status)) filters.status = pf.status;
        if (typeof pf.approverOnly === 'boolean') filters.approverOnly = pf.approverOnly;
        if (Array.isArray(pf.visCats)) filters.visCats = pf.visCats.filter((c) => CATALOGS.includes(c));
        if (pf.appRoles && typeof pf.appRoles === 'object') {
          for (const key of ROLE_FILTER_KEYS) {
            if (typeof pf.appRoles[key] === 'string') filters.appRoles[key] = pf.appRoles[key];
          }
        }
        if (typeof pf.q === 'string') filters.q = pf.q;
      }
      const ps = parsed?.sort;
      if (ps) {
        if (SORT_KEYS.includes(ps.key)) sort.key = ps.key;
        if (ps.dir === 'asc' || ps.dir === 'desc') sort.dir = ps.dir;
      }
      // Older saves predate the advanced disclosure — a missing/non-boolean
      // value just leaves it collapsed rather than failing to load at all.
      if (typeof parsed?.advOpen === 'boolean') advOpen = parsed.advOpen;
    }
  } catch (e) {
    // corrupt or unavailable storage (private mode quota) — defaults stand
  }
  return { filters, sort, advOpen };
}

function persistView() {
  try {
    sessionStorage.setItem(VIEW_STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // storage unavailable — the view simply won't survive a refresh
  }
}

function breadth(u) {
  return Array.isArray(u.visibility) ? u.visibility.length : 0;
}

function matchesFilters(u) {
  const f = state.filters;
  if (f.status !== 'all' && u.status !== f.status) return false;
  if (f.approverOnly && !u.is_approver) return false;

  if (f.visCats.length) {
    const vis = Array.isArray(u.visibility) ? u.visibility : [];
    for (const cat of f.visCats) if (!vis.includes(cat)) return false;
  }

  for (const key of ROLE_FILTER_KEYS) {
    const want = f.appRoles[key];
    if (want === 'any') continue;
    const dir = roleDirFor(key);
    if (!dir || !dir.ok) continue; // can't verify a degraded column — don't hide people on a guess
    const appUser = dir.byEmail.get(u.email.toLowerCase());
    if (want === NO_ACCOUNT) {
      if (appUser) return false;
    } else if (!appUser || appUser.role !== want) {
      return false;
    }
  }

  if (f.q) {
    const q = f.q.trim().toLowerCase();
    if (q) {
      const hay = `${u.display_name || ''} ${u.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
  }

  return true;
}

function displayKey(u) {
  return (u.display_name || u.email).toLowerCase();
}

function tiebreak(a, b) {
  return collator.compare(displayKey(a), displayKey(b));
}

/** No decided_at (and, in principle, no first_seen_at) always sorts last, in either direction. */
function compareNullableDate(av, bv, mult) {
  if (!av && !bv) return 0;
  if (!av) return 1;
  if (!bv) return -1;
  return (new Date(av) - new Date(bv)) * mult;
}

function compareUsers(a, b) {
  const { key, dir } = state.sort;
  const mult = dir === 'desc' ? -1 : 1;

  if (key === 'first_seen' || key === 'decided') {
    const field = key === 'first_seen' ? 'first_seen_at' : 'decided_at';
    const res = compareNullableDate(a[field], b[field], mult);
    return res !== 0 ? res : tiebreak(a, b);
  }

  let res;
  switch (key) {
    case 'email': res = collator.compare(a.email, b.email); break;
    case 'status': res = STATUS_RANK[a.status] - STATUS_RANK[b.status]; break;
    case 'breadth': res = breadth(a) - breadth(b); break;
    default: res = collator.compare(displayKey(a), displayKey(b)); break; // 'name'
  }
  res *= mult;
  return res !== 0 ? res : tiebreak(a, b);
}

/** Rebuild each role column's filter <select> from its OWN fetched vocabulary — never hardcoded (§1.2). */
function populateRoleFilterOptions() {
  for (const key of ROLE_FILTER_KEYS) {
    const select = document.getElementById(`f-role-${key}`);
    // A key with no <select> in the markup (a column added to the JS before
    // its filter row exists) must not take the whole controls bar down with
    // it — the role CELLS are the load-bearing half, the filter is a
    // convenience. Skip it rather than throw.
    if (!select) continue;
    const dir = roleDirFor(key);
    const current = state.filters.appRoles[key];
    const valid = ['any', NO_ACCOUNT, ...(dir?.ok ? dir.roles : [])];

    select.innerHTML = '';
    select.appendChild(new Option('any', 'any'));
    // audiobook: everyone can use the public site — absence means "no site
    // role", not "no account". The apps create rows on first sign-in.
    select.appendChild(new Option(key === 'audiobook' ? 'no site role' : 'no account yet', NO_ACCOUNT));
    if (dir?.ok) {
      for (const role of dir.roles) select.appendChild(new Option(role, role));
    }
    select.disabled = !dir?.ok; // that column is degraded right now — its role filter can't be trusted

    if (!valid.includes(current)) state.filters.appRoles[key] = 'any'; // vocab moved under a stale value
    select.value = state.filters.appRoles[key];
  }
}

function syncControlsFromState() {
  document.getElementById('f-status').value = state.filters.status;
  document.getElementById('f-approver').value = state.filters.approverOnly ? 'only' : 'any';
  document.getElementById('f-q').value = state.filters.q;
  for (const cat of CATALOGS) {
    const chip = controlsEl.querySelector(`.chip[data-cat="${cat}"]`);
    const active = state.filters.visCats.includes(cat);
    chip.setAttribute('aria-pressed', String(active));
    chip.classList.toggle('active', active);
  }
  populateRoleFilterOptions();
  document.getElementById('s-key').value = state.sort.key;
  updateSortDirButton();
  advEl.open = state.advOpen;
  updateAdvHint();
}

/**
 * "N active" on the Advanced filters toggle — status/approver/role are the
 * fields living behind the disclosure that actually HIDE rows (sort only
 * reorders, catalog chips and search sit outside it already), so those are
 * what's counted. Hidden while the section is open — the fields are right
 * there, nothing to summarize.
 */
function countActiveAdvancedFilters() {
  const f = state.filters;
  let n = 0;
  if (f.status !== 'all') n++;
  if (f.approverOnly) n++;
  for (const key of ROLE_FILTER_KEYS) if (f.appRoles[key] !== 'any') n++;
  return n;
}

function updateAdvHint() {
  const n = countActiveAdvancedFilters();
  const show = !advEl.open && n > 0;
  advCountEl.hidden = !show;
  advCountEl.textContent = show ? `${n} active` : '';
}

function updateSortDirButton() {
  const btn = document.getElementById('s-dir');
  const asc = state.sort.dir === 'asc';
  btn.textContent = asc ? '↑ asc' : '↓ desc';
  btn.setAttribute('aria-pressed', String(!asc));
}

function updateCountLine(shown, total) {
  countEl.textContent = total ? `Showing ${shown} of ${total}` : '';
}

/**
 * One collapsible section of the directory: a counted header, and either the
 * cards or a sentence saying why there are none.
 *
 * `shown` are the members of this group that survived the filters, already
 * sorted; `inDirectory` is how many rows this group holds in total, ignoring
 * filters — the two together are what let an empty section tell the truth.
 *
 * ⚠️ THE CARDS ARE UNTOUCHED. userCard() builds exactly what it built when the
 * page was one flat list — same head, same badges, same permission grid, same
 * per-card Save, same two-tap status buttons. This function decides WHERE a
 * card goes and nothing whatsoever about what is in it; every existing gesture
 * keeps working unchanged inside its section.
 */
function directorySection(group, shown, inDirectory) {
  const details = document.createElement('details');
  details.className = 'dir-group';
  details.dataset.group = group.key;
  const want = openGroups.has(group.key)
    ? openGroups.get(group.key)
    : group.defaultOpen(shown.length);
  details.open = want;

  // ⚠️ `toggle` CANNOT TELL A CLICK FROM THE LINE ABOVE, so it is compared
  // against what we asked for rather than trusted. Setting `.open = true`
  // queues a toggle event of its own; recording that would turn the DEFAULT
  // into a recorded PREFERENCE on the very first paint — after which Pending
  // could never collapse itself again once it emptied, which is half the
  // behaviour that was asked for. An event whose state still matches `want`,
  // from a section the reader has not yet touched, is that echo and is ignored.
  // (The spec coalesces a queued toggle with a real one, so a click landing
  // before the echo fires arrives here as a single event carrying the FINAL
  // state — which no longer matches `want` and is therefore recorded.)
  details.addEventListener('toggle', () => {
    if (details.open === want && !openGroups.has(group.key)) return;
    openGroups.set(group.key, details.open);
  });

  // The page's EXISTING disclosure language (.adv-summary — Advanced filters,
  // the Permission map, every member's own Permissions grid), not a second one
  // invented here.
  const summary = document.createElement('summary');
  summary.className = 'adv-summary dir-summary';
  const title = document.createElement('span');
  title.className = 'ctl-label';
  title.textContent = group.title;
  const count = document.createElement('span');
  count.className = 'dir-count';
  // The count is of what is SHOWN, so it always agrees with what opening the
  // section reveals. When filters are hiding people the empty/short state says
  // so in words below, and the "Showing N of M" line above says it for the
  // directory as a whole.
  count.textContent = `· ${shown.length}`;
  summary.append(title, count);
  details.appendChild(summary);

  if (shown.length) {
    const list = document.createElement('ul');
    list.className = 'users-list';
    for (const u of shown) list.appendChild(userCard(u));
    details.appendChild(list);
    return details;
  }

  // ⚠️ EMPTY IS TWO DIFFERENT FACTS AND MUST NEVER BE ONE SENTENCE. "Nobody is
  // waiting" is a statement about the estate; "your filters hide the one person
  // who is" is a statement about this screen. Printing the first when the second
  // is true tells the owner nobody needs approving while somebody does.
  const note = document.createElement('p');
  note.className = 'dir-empty';
  note.textContent = inDirectory
    ? `${inDirectory} ${group.hiddenNoun(inDirectory)} hidden by the current search or filters — Reset shows ${inDirectory === 1 ? 'them' : 'them all'}.`
    : group.empty;
  details.appendChild(note);
  return details;
}

/**
 * Filter + sort `allEstateUsers`, then deal the survivors into their status
 * sections and paint. Every control change and every mutation re-render go
 * through here — which is also what makes a status change MOVE someone: mutate()
 * awaits loadDirectory(), which re-fetches and re-renders, so an approve lands
 * the card in Current and a revoke lands it in Revoked on the same refresh cycle
 * the page has always done. No card is moved by hand and no local status is
 * guessed at; the sections are drawn from the server's answer.
 */
function renderFilteredList() {
  const view = allEstateUsers.filter(matchesFilters).sort(compareUsers);
  usersEl.innerHTML = '';

  const known = new Set(DIRECTORY_GROUPS.map((g) => g.key));
  for (const group of DIRECTORY_GROUPS) {
    usersEl.appendChild(directorySection(
      group,
      view.filter((u) => u.status === group.key),
      allEstateUsers.filter((u) => u.status === group.key).length,
    ));
  }

  // The safety net described on DIRECTORY_GROUPS: an unrecognised status gets
  // its own named section rather than disappearing. Silent is the one thing a
  // directory of who-has-access may never be.
  const strays = [...new Set(allEstateUsers.map((u) => u.status).filter((s) => !known.has(s)))];
  for (const status of strays) {
    usersEl.appendChild(directorySection(
      {
        key: `other:${status}`,
        title: `Status: ${status}`,
        defaultOpen: () => true,
        empty: `Nobody currently has the status “${status}”.`,
        hiddenNoun: (n) => `${n === 1 ? 'person' : 'people'} with the status “${status}”`,
      },
      view.filter((u) => u.status === status),
      allEstateUsers.filter((u) => u.status === status).length,
    ));
  }

  updateCountLine(view.length, allEstateUsers.length);
  updateAdvHint();
}

function wireControls() {
  const statusSel = document.getElementById('f-status');
  const approverSel = document.getElementById('f-approver');
  const qInput = document.getElementById('f-q');
  const sortKeySel = document.getElementById('s-key');
  const sortDirBtn = document.getElementById('s-dir');
  const resetBtn = document.getElementById('f-reset');

  statusSel.addEventListener('change', () => {
    state.filters.status = statusSel.value;
    persistView();
    renderFilteredList();
  });

  approverSel.addEventListener('change', () => {
    state.filters.approverOnly = approverSel.value === 'only';
    persistView();
    renderFilteredList();
  });

  qInput.addEventListener('input', () => {
    state.filters.q = qInput.value;
    persistView();
    renderFilteredList();
  });

  for (const chip of controlsEl.querySelectorAll('.chip[data-cat]')) {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.cat;
      const i = state.filters.visCats.indexOf(cat);
      if (i === -1) state.filters.visCats.push(cat); else state.filters.visCats.splice(i, 1);
      chip.setAttribute('aria-pressed', String(i === -1));
      chip.classList.toggle('active', i === -1);
      persistView();
      renderFilteredList();
    });
  }

  for (const key of ROLE_FILTER_KEYS) {
    const select = document.getElementById(`f-role-${key}`);
    if (!select) continue; // same reasoning as populateRoleFilterOptions
    select.addEventListener('change', (e) => {
      state.filters.appRoles[key] = e.target.value;
      persistView();
      renderFilteredList();
    });
  }

  // Add member by email (owner UI-first rule): pre-seed a directory row
  // before the person's first sign-in. The Worker lowercases + validates;
  // idempotent — adding someone already present changes nothing.
  const addBtn = document.getElementById('add-member-btn');
  const addInput = document.getElementById('add-member-email');
  const submitAdd = async () => {
    const email = addInput.value.trim();
    if (!email) return;
    addBtn.disabled = true;
    const data = await createMember(email);
    addBtn.disabled = false;
    if (!data) return; // api() already said why
    addInput.value = '';
    setStatus(
      data.created
        ? `${data.user.email} added (pending) — approve them below when ready.`
        : `${data.user.email} is already in the directory (${data.user.status}).`,
    );
    await loadDirectory();
  };
  addBtn.addEventListener('click', submitAdd);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitAdd();
  });

  sortKeySel.addEventListener('change', () => {
    state.sort.key = sortKeySel.value;
    state.sort.dir = DEFAULT_DIR_FOR_KEY[state.sort.key] || 'asc';
    updateSortDirButton();
    persistView();
    renderFilteredList();
  });

  sortDirBtn.addEventListener('click', () => {
    state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    updateSortDirButton();
    persistView();
    renderFilteredList();
  });

  resetBtn.addEventListener('click', () => {
    state.filters = defaultFilters();
    state.sort = defaultSort();
    syncControlsFromState();
    persistView();
    renderFilteredList();
  });

  // Native <details> toggle — fires on open AND close, from keyboard or click.
  advEl.addEventListener('toggle', () => {
    state.advOpen = advEl.open;
    persistView();
    updateAdvHint();
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// The two-tap confirmBtn lives in ../assets/estate-controls.js (2026-08-16) so
// the /status page's pipeline controls could reuse the exact same gesture
// rather than grow a second implementation — see that file's header comment.
// ⚠️ The one-tap plain-button helper that used to be imported alongside it is
// no longer used HERE (2026-08-17): Approve was its only caller on this page,
// and Approve now takes two taps like every other estate-status action. The
// helper itself still exists and /status still imports it.

// ---------------------------------------------------------------------------
// STAGED GRANTS — the machinery behind "nothing writes as you touch it".
//
// Every grant-class control (a `visible` box, any site's role dropdown) writes
// into this bag instead of the network, and one Save per member drains it. See
// the header comment's grammar section for WHY there is one Save per member
// rather than one per row.
// ---------------------------------------------------------------------------

/** The staged bag for one member, created on demand. */
function editsFor(u) {
  let e = pendingEdits.get(u.id);
  if (!e) {
    e = { vis: {}, roles: {} };
    pendingEdits.set(u.id, e);
  }
  return e;
}

/** Drop a member's bag once it holds nothing — so `pendingEdits.has` means something. */
function pruneEmpty(u) {
  const e = pendingEdits.get(u.id);
  if (e && !Object.keys(e.vis).length && !Object.keys(e.roles).length) pendingEdits.delete(u.id);
}

/** What the estate directory says right now about one visibility grant. */
function truthVis(u, catKey) {
  return Array.isArray(u.visibility) && u.visibility.includes(catKey);
}

/**
 * The staged value for one box, or undefined if there isn't one.
 *
 * ⚠️ SELF-PRUNING: an edit that the server has since agreed with (someone else
 * ticked it, or our own save landed) stops being an edit here, which is what
 * keeps the unsaved counter honest across a reload without any bookkeeping at
 * the call sites.
 */
function stagedVis(u, catKey) {
  const e = pendingEdits.get(u.id);
  if (!e || !(catKey in e.vis)) return undefined;
  if (e.vis[catKey] === truthVis(u, catKey)) {
    delete e.vis[catKey];
    pruneEmpty(u);
    return undefined;
  }
  return e.vis[catKey];
}

function effectiveVis(u, catKey) {
  const staged = stagedVis(u, catKey);
  return staged === undefined ? truthVis(u, catKey) : staged;
}

/** The app entry behind a SITE_ROWS row (`null` for the audiobook row, whose roles are federated differently). */
function appFor(row) {
  return APPS.find((a) => a.key === row.id) ?? null;
}

/**
 * What one site says about this person's role right now, in that site's own
 * words, plus the honest reason when there is nothing to say:
 *
 *   { state: 'role', role, dir, holder?, appUser?, app? }
 *   { state: 'noaccount', dir, app }   — the app makes its row on first sign-in
 *   { state: 'degraded', why }         — that Worker did not answer
 *
 * ⚠️ 'none' is a REAL role on the audiobook ladder (guest is never stored), so
 * that row never reports 'noaccount' — granting is picking a rung, revoking is
 * picking none.
 */
function roleTruth(u, row) {
  const email = u.email.toLowerCase();
  if (row.roleSource === 'audiobook') {
    const dir = siteRolesDir;
    if (!dir || !dir.ok) return { state: 'degraded', why: dir?.why ?? 'not loaded' };
    const holder = dir.byEmail.get(email);
    return { state: 'role', role: holder?.role ?? 'none', holder, dir };
  }
  const app = appFor(row);
  const dir = appDirs[row.id];
  if (!dir || !dir.ok) return { state: 'degraded', why: dir?.why ?? 'not loaded' };
  const appUser = dir.byEmail.get(email);
  if (!appUser) return { state: 'noaccount', dir, app };
  return { state: 'role', role: appUser.role, appUser, dir, app };
}

/** The staged role for one row, or undefined. Self-pruning, same as stagedVis. */
function stagedRole(u, row) {
  const e = pendingEdits.get(u.id);
  if (!e || !(row.id in e.roles)) return undefined;
  const truth = roleTruth(u, row);
  if (truth.state !== 'role' || e.roles[row.id] === truth.role) {
    delete e.roles[row.id];
    pruneEmpty(u);
    return undefined;
  }
  return e.roles[row.id];
}

/** The role to SHOW and to derive capabilities from — staged if staged, else what stands. */
function effectiveRole(u, row) {
  const staged = stagedRole(u, row);
  if (staged !== undefined) return staged;
  const truth = roleTruth(u, row);
  return truth.state === 'role' ? truth.role : null;
}

/** How many unsaved grants this member is carrying. Prunes as it counts. */
function countStaged(u) {
  let n = 0;
  for (const cat of CATALOGS) if (stagedVis(u, cat) !== undefined) n++;
  for (const row of SITE_ROWS) if (stagedRole(u, row) !== undefined) n++;
  return n;
}

/**
 * ONE SAVE, ONE WORDED RESULT (the grant grammar's commit).
 *
 * Order matters: visibility first (one POST of the WHOLE canonical set, because
 * that endpoint takes the set and not a delta), then one role call per site that
 * changed, each on that site's own surface in its own vocabulary. Nothing is
 * batched across systems — there is no transaction to be had across four
 * Workers, so each half reports for itself and a failure leaves its own edit
 * staged for a retry rather than pretending it landed.
 *
 * ⚠️ The refusal WORDS come from the API helpers, which have already put the
 * server's own sentence on the status line. This reads that sentence back
 * before the reload wipes it, and re-states it after — so a partial save says
 * both what saved and exactly why the rest did not.
 */
async function savePermissions(u, saveBtn) {
  const e = pendingEdits.get(u.id);
  if (!e) return;
  saveBtn.disabled = true;
  setStatus('Saving…');

  const saved = [];
  const refused = [];
  let serverWords = '';

  const visKeys = Object.keys(e.vis);
  if (visKeys.length) {
    // ⚠️ Built from CATALOGS, so the posted array is in §4.5's canonical order
    // no matter how the rows are grouped on screen or which boxes were touched.
    const visibility = CATALOGS.filter((cat) => effectiveVis(u, cat));
    const data = await api(`/api/estate/users/${u.id}/visibility`, {
      method: 'POST',
      body: JSON.stringify({ visibility }),
    });
    if (data) {
      for (const cat of visKeys) {
        saved.push(`${CATALOG_LABELS[cat] || cat} ${e.vis[cat] ? 'visible' : 'hidden'}`);
      }
      u.visibility = visibility; // keep the row truthful until the reload lands
      e.vis = {};
    } else {
      serverWords ||= statusEl.textContent;
      refused.push('the visible boxes');
    }
  }

  for (const rowId of Object.keys(e.roles)) {
    const row = SITE_ROWS.find((r) => r.id === rowId);
    if (!row) { delete e.roles[rowId]; continue; }
    const want = e.roles[rowId];
    const truth = roleTruth(u, row);
    let ok = false;

    if (row.roleSource === 'audiobook') {
      const email = u.email.toLowerCase();
      ok = await postSiteRole(email, want === 'none' ? null : want);
      if (ok && truth.state === 'role') {
        const holder = truth.holder;
        if (want === 'none') truth.dir.byEmail.delete(email);
        else truth.dir.byEmail.set(email, { ...(holder ?? { uid: '', displayName: '' }), email, role: want });
      }
    } else if (truth.state === 'role') {
      ok = await patchAppRole(truth.app, truth.appUser.id, want);
      if (ok) truth.appUser.role = want; // keep the map truthful without a refetch
    } else {
      // The row it would have written to is gone (the site went unreachable, or
      // the person's account row vanished) — say so rather than posting blind.
      serverWords ||= `${row.label}: there is no account row there to change right now.`;
    }

    if (ok) {
      saved.push(`${row.label} role ${want}`);
      delete e.roles[rowId];
    } else {
      serverWords ||= statusEl.textContent;
      refused.push(`the ${row.label} role`);
    }
  }

  pruneEmpty(u);
  const who = u.display_name || u.email;
  const parts = [];
  if (saved.length) parts.push(`Saved for ${who}: ${saved.join(', ')}.`);
  if (refused.length) {
    parts.push(`Not saved: ${refused.join(' and ')} — still staged, tap Save to try again.`);
    if (serverWords) parts.push(serverWords);
  }
  if (!parts.length) parts.push(`Nothing was staged for ${who}.`);

  await loadDirectory(); // re-render from what the servers now say (clears the line)
  setStatus(parts.join(' '), refused.length ? 'warn' : '');
  saveBtn.disabled = false;
}

/**
 * The highest rung a site can express — used for the owner fact, never
 * hardcoded, because a rename in any app would rot a literal here.
 *
 * ⚠️ THE TWO FEDERATIONS ANSWER THEIR LADDERS IN OPPOSITE ORDERS, and this is
 * the one place that difference is allowed to live. The app Workers list theirs
 * highest-first (`dir.roles[0]`); the auth Worker's site-roles ladder is
 * cumulative and lists lowest-first (`dir.roles.at(-1)`). Getting this backwards
 * shows an owner as the LOWEST rung on the site, which reads as a demotion that
 * never happened.
 */
function topRung(row, dir) {
  return row.roleSource === 'audiobook' ? dir.roles[dir.roles.length - 1] : dir.roles[0];
}

/**
 * THE ROLE CONTROL FOR ONE SITE ROW — one function for all four sites, which is
 * the point (2026-08-17). It used to be two: appRoleCell wrote on `change` with
 * no confirmation, audiobookRoleCell staged and needed its own two-tap apply
 * button. Same class of decision, two gestures, and the owner had to remember
 * which row he was on.
 *
 * Now every row behaves identically: picking a rung STAGES it and nothing else.
 * The card's Save writes it. The cell renders exactly one of:
 *
 *   - a dropdown, when this caller may actually set something here;
 *   - a worded FACT (owner rank), which is never a control — an owner outranks
 *     anything this page can grant (owner decision 2026-08-16: "for anyone with
 *     owner rank dont even render options to change it. just always auto fill
 *     and write the max role possible for each site");
 *   - a worded REFUSAL naming its cause — no account row there yet, a rung
 *     above your own grant power, no grant power at all, or a Worker that did
 *     not answer.
 *
 * ⚠️ Never a disabled dropdown. A greyed control reads as "something you could
 * enable", and in every one of these cases there is nothing to enable.
 *
 * ⚠️ Escalation is enforced SERVER-SIDE (site-roles.ts's canGrant for the
 * audiobook ladder, each app's own `manageUsers` gate for the rest). This cell
 * MIRRORS that rather than re-deriving it: it offers only what `grantable`
 * names, so a control that would just be refused on submit is never drawn.
 */
function roleCell(u, row, onStage) {
  const cell = document.createElement('span');
  cell.className = 'perm-role';
  const truth = roleTruth(u, row);

  const worded = (className, text, title) => {
    const note = document.createElement('span');
    note.className = className;
    note.textContent = text;
    if (title) note.title = title;
    cell.appendChild(note);
    return cell;
  };

  if (truth.state === 'degraded') {
    return worded(
      'perm-warn',
      `${truth.why} — roles here cannot be read or set right now`,
      'This site answered with a problem rather than a roster. The estate row and every other site are unaffected; try Refresh.',
    );
  }

  // ⚠️ AN OWNER GETS A FACT, NOT A CONTROL — on every row (the audiobook row
  // was missed when the app rows got this, owner-reported 2026-08-16: "for the
  // audiobook portal it didnt force my role"). Read from the server's
  // OWNER_EMAILS, never inferred from a stored role: 'owner' is deliberately
  // never written to a site_roles doc, so inferring it from one would answer
  // "no" for every real owner. reconcileOwnerRoles() does the correcting, once
  // per load — never from inside a render function.
  if (isOwnerEmail(u)) {
    if (truth.state !== 'role') {
      return worded('perm-owner', 'owner · no account row there yet',
        'Owner — the site makes its row on their first sign-in there; the max rung is written once it exists.');
    }
    const top = topRung(row, truth.dir);
    const behind = truth.role !== top;
    const cellText = behind ? `owner · ${truth.role} → ${top}` : `owner · ${top}`;
    // ⚠️ WHO FIXES A LAGGING OWNER DIFFERS BY ROW, so the tooltip must not
    // claim otherwise (caught 2026-08-17 by exercising the render): only the
    // audiobook ladder is reconciled from this page (reconcileOwnerRoles, once
    // per load). An app row that is behind stays behind until someone fixes it
    // in that app, and saying "being corrected" there would be a promise this
    // page does not keep.
    const behindNote = row.roleSource === 'audiobook'
      ? `Currently ${truth.role}; this page corrects it automatically after each load.`
      : `Currently ${truth.role}. Nothing here changes it — fix it in that site itself.`;
    return worded(
      behind ? 'perm-owner perm-warn' : 'perm-owner',
      cellText,
      behind
        ? `Owner — should hold ${top}, this site's highest rung. ${behindNote}`
        : `Owner — holds ${top}, this site's highest rung. Not changeable here; 'owner' itself is DB-only and has no UI path, ever.`,
    );
  }

  if (truth.state === 'noaccount') {
    return worded('perm-note', 'no account yet — appears on first sign-in there',
      'This site makes a person\'s row the first time they sign in there. Until then there is nothing to hold a role. Not an error.');
  }

  let options;
  if (row.roleSource === 'audiobook') {
    const grantable = Array.isArray(truth.dir.grantable) ? truth.dir.grantable : [];
    const canTouchCurrent = truth.role === 'none' || grantable.includes(truth.role);
    if (!canTouchCurrent) {
      return worded('perm-note',
        truth.role === 'owner' ? 'owner (DB-only — no UI path, ever)' : `${truth.role} (outranks your grant power)`,
        'You may only grant or revoke rungs strictly beneath your own, which the auth Worker enforces server-side. This row is above that line.');
    }
    if (!grantable.length) {
      return worded('perm-note', 'none — you hold no grant power on this ladder',
        'Your own rung here grants nothing beneath it, so there is no rung to offer.');
    }
    // 'none' is a real, storable state on this ladder (guest is never written).
    // ⚠️ HIGHEST-FIRST, to match the app rows (owner, 2026-08-17: "one site is
    // lowest to high and the rest are high to low. can you make audiobook/ebook
    // high to low?"). `grantable` arrives lowest-first (the auth Worker's
    // cumulative ladder — see topRung), so it is reversed for DISPLAY only;
    // 'none' is beneath every rung, so it closes the list.
    options = [...grantable].reverse().concat('none');
  } else {
    options = truth.dir.roles;
  }

  const shown = effectiveRole(u, row);
  const select = document.createElement('select');
  select.setAttribute('aria-label', `${row.label} role for ${u.email}`);
  for (const role of options) {
    const opt = document.createElement('option');
    opt.value = role;
    opt.textContent = role;
    select.appendChild(opt);
  }
  select.value = options.includes(shown) ? shown : truth.role;
  select.classList.toggle('perm-staged', stagedRole(u, row) !== undefined);

  select.addEventListener('change', () => {
    // STAGE ONLY. The network is the Save button's business.
    editsFor(u).roles[row.id] = select.value;
    const stillStaged = stagedRole(u, row) !== undefined;
    select.classList.toggle('perm-staged', stillStaged);
    onStage();
  });

  cell.appendChild(select);
  return cell;
}

/**
 * Keep every OWNER at the top of the audiobook ladder, automatically.
 *
 * Owner decision 2026-08-16: *"just always auto fill and write the max role
 * possible for each site."* An owner outranks anything this page can grant, so
 * their stored role is not a choice — it is a value that should simply always
 * be correct, and drift in it is a bug rather than a preference.
 *
 * ⚠️ Runs ONCE after the directory loads, never from inside a render function.
 * A cell that wrote as a side effect of being drawn would re-fire on every
 * re-render, every sort and every filter change — a storm of POSTs triggered by
 * scrolling.
 *
 * ⚠️ Only ever writes the TOP role to a KNOWN OWNER, so the sole direction this
 * can move anyone is one the owner has already decided is theirs by rank. It
 * cannot promote a non-owner: the guard is the server's own ownerEmails list,
 * the same one the gates use. If the server refuses anyway (an owner whose
 * caller lacks grant power — e.g. an admin viewing an owner's row), the refusal
 * stands and is reported, not retried.
 *
 * Silent by design when there is nothing to do, which is the normal case.
 */
async function reconcileOwnerRoles() {
  const dir = siteRolesDir;
  if (!dir || !dir.ok || !Array.isArray(dir.ownerEmails) || !dir.ownerEmails.length) return;
  const top = dir.roles[dir.roles.length - 1];
  if (!top) return;

  const behind = dir.ownerEmails.filter((email) => (dir.byEmail.get(email)?.role ?? 'none') !== top);
  if (!behind.length) return;

  const fixed = [];
  for (const email of behind) {
    const ok = await postSiteRole(email, top);
    if (ok) {
      const prev = dir.byEmail.get(email);
      dir.byEmail.set(email, { ...(prev ?? { uid: '', displayName: '' }), email, role: top });
      fixed.push(email);
    }
  }
  if (fixed.length) {
    setStatus(`Owner role set to ${top} for ${fixed.join(', ')}.`, 'owner');
    // ⚠️ This said `render()` — a function that does not exist in this module
    // and never did (found 2026-08-17 while merging the catalog rows). It threw
    // ReferenceError inside a `void`-ed async call, so it failed SILENTLY: the
    // status line said the owner's role had been corrected while the cell kept
    // showing the stale rung until the next manual refresh. renderFilteredList
    // is the repaint every other mutation path uses.
    renderFilteredList();
  }
}

/**
 * THE DERIVED CAPABILITY LINE — the grid's fourth column.
 *
 * ⚠️ DERIVED, NEVER EDITABLE. It is the rung's meaning read straight off the
 * ladder: for Audiobooks/Ebooks, the LIVE summary the auth Worker sends with
 * its capability map (so the page cannot drift from the server's own idea of
 * what a rung does); for the app rows, which have no such endpoint, the
 * one-line meanings copied from the owner-approved role-capability-map.
 *
 * ⚠️ A rung with no documented meaning says so rather than inventing one.
 */
function capabilityText(u, row) {
  const role = effectiveRole(u, row);
  if (role === null) return 'no role here yet — nothing to derive.';

  let summary = null;
  if (row.roleSource === 'audiobook' && roleTreeDir?.ok) {
    summary = roleTreeDir.capabilities.find((c) => c.role === role)?.summary ?? null;
  }
  summary ??= RUNG_MEANINGS[role] ?? null;
  let text = summary
    ? `${role} — ${summary}`
    : `${role} — no documented summary for this rung (that site answers its own vocabulary).`;

  // ⚠️ THE DOWNLOAD FACT LIVES HERE NOW, AND NOWHERE ELSE (owner, 2026-08-17,
  // looking at the live page: *"what is this download: admin + role tag it
  // looks bad and idk what its trying to tell me."*). It used to be a little
  // standalone tag hanging off the Audiobooks/Ebooks row, which made it a
  // fifth thing on a row and answered a question nobody had asked yet.
  // Downloading is a capability of a rung, so it belongs in the column that
  // says what a rung can do — appended only when the live summary has not
  // already said it, so this never doubles up if the Worker's own wording
  // grows to mention it.
  if (row.roleSource === 'audiobook' && role === EBOOK_DOWNLOAD_RUNG && !/download/i.test(text)) {
    text += ' Includes downloading ebook files.';
  }
  return text;
}

/** One grid cell, carrying the column name so the phone layout can print it. */
function permCell(className, column) {
  const el = document.createElement('span');
  el.className = `perm-cell ${className}`.trim();
  if (column) el.dataset.col = column;
  return el;
}

/**
 * ⚠️ THE PERMISSION MAP FOR ONE MEMBER — this page's centerpiece (owner order
 * 2026-08-17: "maybe just make a full permission map after normalizing
 * everything").
 *
 * One row per site — the SAME rows, in the SAME order, as the "Permission map"
 * disclosure at the top — and the SAME four cells on every one of them:
 *
 *   site │ visible │ role │ what that role can do
 *
 * which is deliberately the shape of docs/info/role-capability-map.md, the map
 * the owner approved, rendered live for this person. The old block drew a line
 * per surface with whatever cells that surface happened to own, which is how
 * four different ways to change a permission accumulated without anyone
 * deciding to have four.
 *
 * ⚠️ `catKeys` IS A LIST because one row can cover more than one grant:
 * Audiobooks/Ebooks is one site behind one ladder with two visibility grants on
 * it (f7697f4), so that row carries TWO boxes beside ONE dropdown, and its
 * download note rides in the capability cell where the rung it names is stated.
 *
 * ⚠️ The wire vocabulary is untouched: every box still carries its own
 * `data-cat`, and the save still rebuilds the whole array from CATALOGS, so a
 * merged row saves both grants independently and in canonical order.
 */
function permGrid(u, afterStage) {
  const grid = document.createElement('div');
  grid.className = 'perm-grid';

  const header = document.createElement('div');
  header.className = 'perm-row perm-head';
  for (const [label, cls] of [['Site', 'perm-name'], ['Visible', ''], ['Role', ''], ['What that role can do', '']]) {
    const h = permCell(cls);
    h.textContent = label;
    header.appendChild(h);
  }
  grid.appendChild(header);

  const capCells = new Map();
  let refreshFoot = () => {};
  const onStage = () => {
    // The derived column previews the STAGED rung — that is the point of
    // deriving it: you see what the change would mean before you commit it.
    for (const [rowId, cell] of capCells) {
      const row = SITE_ROWS.find((r) => r.id === rowId);
      cell.firstChild.textContent = capabilityText(u, row);
    }
    refreshFoot();
    afterStage?.();
  };

  for (const row of SITE_ROWS) {
    const line = document.createElement('div');
    line.className = 'perm-row';

    const name = permCell('perm-name');
    name.textContent = row.label;
    line.appendChild(name);

    const vis = permCell('perm-vis', 'Visible');
    if (Array.isArray(u.visibility)) {
      for (const catKey of row.catKeys) {
        const label = document.createElement('label');
        label.className = 'perm-box';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.dataset.cat = catKey;
        box.checked = effectiveVis(u, catKey);
        box.classList.toggle('perm-staged', stagedVis(u, catKey) !== undefined);
        box.setAttribute('aria-label', `${CATALOG_LABELS[catKey] || catKey} visible to ${u.email}`);
        box.addEventListener('change', () => {
          // STAGE ONLY — the Save button owns the network (see the grammar).
          editsFor(u).vis[catKey] = box.checked;
          box.classList.toggle('perm-staged', stagedVis(u, catKey) !== undefined);
          onStage();
        });
        // A lone box says "visible"; a shared row names its shelf, because
        // "visible" twice on one line is two identical controls with no way to
        // tell them apart.
        label.append(box, row.catKeys.length > 1 ? ` ${CATALOG_LABELS[catKey] || catKey}` : ' visible');
        vis.appendChild(label);
      }
    } else {
      const note = document.createElement('span');
      note.className = 'perm-note';
      note.textContent = 'not reported';
      vis.appendChild(note);
    }
    line.appendChild(vis);

    const role = roleCell(u, row, () => onStage());
    role.classList.add('perm-cell');
    role.dataset.col = 'Role';
    line.appendChild(role);

    const cap = permCell('perm-cap', 'Can');
    const capText = document.createElement('span');
    capText.textContent = capabilityText(u, row);
    cap.appendChild(capText);
    capCells.set(row.id, cap);
    line.appendChild(cap);

    grid.appendChild(line);
  }

  // ── The one Save. See the header comment for why it is per member. ────────
  const foot = document.createElement('div');
  foot.className = 'perm-foot';
  const hint = document.createElement('span');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn small';
  save.textContent = 'Save permissions';
  save.addEventListener('click', () => savePermissions(u, save));
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'btn small quiet';
  discard.textContent = 'Discard';
  discard.addEventListener('click', () => {
    pendingEdits.delete(u.id);
    renderFilteredList(); // repaint from server truth; the card stays expanded
  });
  // ⚠️ THE SAVE APPEARS, IT DOES NOT SIT THERE DISABLED. Owner, 2026-08-17,
  // looking at the live page: *"I think you should do a confirm/save button and
  // no set role button for each role. have the save button appear on each
  // persons box when a change is made."* A permanently-visible disabled button
  // is a control that spends its whole life refusing, and it makes a clean card
  // look like an unfinished one — so the whole footer is absent until something
  // is staged, and arrives (count, Save, Discard) the moment anything in this
  // card is touched.
  refreshFoot = () => {
    const n = countStaged(u);
    foot.hidden = !n;
    hint.className = 'perm-unsaved';
    hint.textContent = n
      ? `${n} unsaved change${n === 1 ? '' : 's'} — nothing is written until you Save.`
      : '';
    save.disabled = !n;
  };
  refreshFoot();
  foot.append(save, discard, hint);
  grid.appendChild(foot);

  return grid;
}

/** The collapsed one-liner: what this member can see and be, at a glance. */
function permScanLine(u) {
  const sees = CATALOGS.filter((cat) => truthVis(u, cat)).map((cat) => CATALOG_LABELS[cat] || cat);
  const roles = [];
  for (const row of SITE_ROWS) {
    const truth = roleTruth(u, row);
    if (truth.state === 'role' && truth.role && truth.role !== 'none') roles.push(`${truth.role} on ${row.label}`);
  }
  const bits = [sees.length ? `sees ${sees.join(', ')}` : 'sees nothing yet'];
  if (roles.length) bits.push(roles.join(' · '));
  const n = countStaged(u);
  if (n) bits.push(`${n} unsaved`);
  return bits.join(' · ');
}

function userCard(u) {
  const li = document.createElement('li');
  li.className = 'user';
  // Stable handle for the #member=<email> anchor (revealAnchoredMember).
  li.dataset.email = String(u.email).toLowerCase();

  const head = document.createElement('div');
  head.className = 'user-head';

  const name = document.createElement('span');
  name.className = 'user-name';
  name.textContent = u.display_name || u.email;
  head.appendChild(name);

  if (u.display_name) {
    const email = document.createElement('span');
    email.className = 'user-email';
    email.textContent = u.email;
    head.appendChild(email);
  }

  const badge = document.createElement('span');
  badge.className = `badge ${u.status}`;
  badge.textContent = u.status;
  head.appendChild(badge);

  if (u.is_approver) {
    const ap = document.createElement('span');
    ap.className = 'badge approved';
    ap.textContent = 'approver';
    head.appendChild(ap);
  }

  // The estate devops capability (0003, owner 2026-08-15): unlisted runbook
  // pages + the status page's Operations. Badged only when it is the ROW's
  // own flag — approvers hold it implicitly and already wear a badge.
  if (u.is_devops) {
    const dv = document.createElement('span');
    dv.className = 'badge approved';
    dv.textContent = 'devops';
    head.appendChild(dv);
  }

  // Dev-lane access (0011, owner 2026-08-17: "a way in the estate to manage
  // dev access for ebook"). ⚠️ Badged on `dev_access` — the row's own HAND
  // GRANT — and deliberately NOT on `dev_access_effective`: a devops row would
  // otherwise wear two badges saying the same thing, and the second one would
  // vanish the moment devops was removed, reading as a grant that was taken
  // away when nothing about this person's own grants changed. Same stance the
  // devops badge above takes towards approvers.
  if (u.dev_access) {
    const da = document.createElement('span');
    da.className = 'badge approved';
    da.textContent = 'dev access';
    head.appendChild(da);
  }

  li.appendChild(head);

  const meta = document.createElement('p');
  meta.className = 'user-meta';
  const bits = [`origin ${u.origin}`, `first seen ${u.first_seen_at}`];
  if (u.decided_at) bits.push(`decided ${u.decided_at}`);
  meta.textContent = bits.join(' · ');
  li.appendChild(meta);

  // ── THE PERMISSION MAP, behind a per-member disclosure ───────────────────
  // Collapsed by default (owner order 2026-08-17: "expanding a member shows
  // the complete grid"): the head line answers "who is this and what do they
  // hold" for scanning a whole directory, and the grid answers "what exactly,
  // and change it" for the one person you came for. Which cards are open lives
  // in expandedMembers, NOT in the DOM, so a search keystroke or a sort change
  // (both of which rebuild every card) does not shut the card you are working
  // in.
  const perm = document.createElement('details');
  perm.className = 'perm';
  perm.open = expandedMembers.has(li.dataset.email);
  const permSummary = document.createElement('summary');
  permSummary.className = 'adv-summary perm-summary';
  const permTitle = document.createElement('span');
  permTitle.className = 'ctl-label';
  permTitle.textContent = 'Permissions';
  const permScan = document.createElement('span');
  permScan.className = 'perm-scan';
  permScan.textContent = permScanLine(u);
  permSummary.append(permTitle, permScan);
  perm.appendChild(permSummary);
  // The collapsed one-liner keeps counting unsaved edits while the card is open,
  // so collapsing it never hides the fact that something is staged.
  perm.appendChild(permGrid(u, () => { permScan.textContent = permScanLine(u); }));
  perm.addEventListener('toggle', () => {
    if (perm.open) expandedMembers.add(li.dataset.email);
    else expandedMembers.delete(li.dataset.email);
  });
  li.appendChild(perm);

  const actions = document.createElement('div');
  actions.className = 'user-actions';

  // ⚠️ EVERY ESTATE-STATUS ACTION IS TWO-TAP, INCLUDING APPROVE (2026-08-17).
  // Revoke, approver and devops have been two-tap since the owner's order of
  // 2026-08-15 ("so I don't accidentally remove people from key roles");
  // Approve was the one exception, justified as "common, additive, low-stakes"
  // — but make-approver and make-devops are additive and low-stakes too and
  // confirm anyway, so the exception was not a rule, it was a leftover. One
  // gesture for this whole row is one less thing to know.
  if (u.status !== 'approved') {
    actions.appendChild(confirmBtn('Approve', '', () =>
      mutate(`/api/estate/users/${u.id}/status`, { status: 'approved' })));
  }
  if (u.status !== 'revoked') {
    actions.appendChild(confirmBtn('Revoke', 'danger', () =>
      mutate(`/api/estate/users/${u.id}/status`, { status: 'revoked' })));
  }
  if (u.status === 'approved') {
    actions.appendChild(u.is_approver
      ? confirmBtn('Remove approver', 'quiet', () =>
          mutate(`/api/estate/users/${u.id}/approver`, { is_approver: false }))
      : confirmBtn('Make approver', 'quiet', () =>
          mutate(`/api/estate/users/${u.id}/approver`, { is_approver: true })));
    // Devops (0003): pointless to toggle on an approver — they hold every
    // devops surface implicitly — so the button only renders for the rest.
    if (!u.is_approver) {
      actions.appendChild(u.is_devops
        ? confirmBtn('Remove devops', 'quiet', () =>
            mutate(`/api/estate/users/${u.id}/devops`, { is_devops: false }))
        : confirmBtn('Make devops', 'quiet', () =>
            mutate(`/api/estate/users/${u.id}/devops`, { is_devops: true })));
    }

    // ── DEV-LANE ACCESS (0011, owner order 2026-08-17) ────────────────────
    // *"i need a way in the estate to manage dev access for ebook, add a
    // button for give dev access also make devops always able to see dev
    // envs."* Both halves are here: the button, and the reason it is
    // sometimes NOT a button.
    //
    // ⚠️ THREE CASES, AND ONLY ONE OF THEM IS A CONTROL — the page's standing
    // rule that a control which cannot change the outcome must not be drawn
    // (§9.1's third class: words that name the cause, never a disabled or
    // no-op control):
    //
    //   owner              a FACT. OWNER_EMAILS forces the answer server-side
    //                      and no button here could change it — the same
    //                      treatment the permission grid gives owner rank.
    //   devops / approver  a FACT. They hold the dev lane implicitly (the
    //                      owner's "always"), computed server-side by
    //                      devAccessAllows(), so flipping the stored flag
    //                      would move a number and change nothing anyone can
    //                      see. Exactly why no devops button is drawn for an
    //                      approver two lines above.
    //   everyone else      the two-tap button. STATUS-class, confirmBtn, the
    //                      shared idiom from assets/estate-controls.js.
    //
    // ⚠️ `dev_access_effective` is READ, never re-derived. The Worker computes
    // "devops implies dev access" in one place; a second copy of that rule
    // living in this file is free to drift from the one that decides.
    const devFact = (className, text, title) => {
      const s = document.createElement('span');
      s.className = `user-fact ${className}`;
      s.textContent = text;
      s.title = title;
      return s;
    };
    if (isOwnerEmail(u)) {
      actions.appendChild(devFact(
        'perm-owner',
        'dev access · owner, always',
        'Owner — OWNER_EMAILS answers yes to every estate question, dev access included. Not changeable here.',
      ));
    } else if (u.is_approver || u.is_devops) {
      actions.appendChild(devFact(
        'perm-note',
        u.is_devops ? 'dev access · via devops' : 'dev access · via approver',
        'Devops and approvers see the dev environments implicitly (owner: "make devops always able to see dev envs"). '
          + 'Nothing to grant — remove devops and the dev access goes with it.',
      ));
    } else {
      actions.appendChild(u.dev_access
        ? confirmBtn('Remove dev access', 'quiet', () =>
            mutate(`/api/estate/users/${u.id}/dev-access`, { dev_access: false }))
        : confirmBtn('Give dev access', 'quiet', () =>
            mutate(`/api/estate/users/${u.id}/dev-access`, { dev_access: true })));
    }
  }

  li.appendChild(actions);
  return li;
}

/** A small table with the given header cells. Returns { table, tbody }. */
function ladderTable(headers) {
  const table = document.createElement('table');
  table.className = 'role-tree-table';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  return { table, tbody };
}

/** One site's subsection in the map: a title, then its ladder or the reason there isn't one. */
function ladderSection(title, subtitle) {
  const section = document.createElement('section');
  section.className = 'ladder-site';
  const h = document.createElement('span');
  h.className = 'ctl-label ladder-site-title';
  h.textContent = title;
  section.appendChild(h);
  if (subtitle) {
    const p = document.createElement('p');
    p.className = 'role-tree-note';
    p.textContent = subtitle;
    section.appendChild(p);
  }
  return section;
}

/**
 * ⚠️ THE PERMISSION MAP — EVERY SITE'S LADDER, one subsection each (owner order
 * 2026-08-17, verbatim: *"at the top we have a tree for audio and ebooks but
 * not one for the other sites"*).
 *
 * It was one ladder — the audiobook/ebooks one, from GET /site-roles/tree —
 * and nothing at all for the library, the games shelf or Sam's library. So the
 * page taught the reader that one site had an explainable ladder and the other
 * three had dropdowns you were expected to already understand.
 *
 * Now: one subsection per SITE_ROWS row, in the same order and under the same
 * names as every member's grid below, each built from THAT site's own answered
 * vocabulary. The Audiobooks/Ebooks ladder keeps its richer table (the auth
 * Worker sends per-rung summaries, who may grant them, and whether Firestore
 * rules enforce them yet); the app ladders get what their API actually answers
 * — the ordered list of rungs — annotated with the one-line meanings from the
 * owner-approved role-capability-map, and NOTHING invented beyond that.
 *
 * Each site degrades on its own: an unreachable Worker costs one subsection.
 */
function renderPermissionMap() {
  const details = document.getElementById('permission-map');
  const body = document.getElementById('permission-map-body');
  if (!details || !body) return;

  const anyLoaded = roleTreeDir || siteRolesDir || APPS.some((a) => appDirs[a.key]);
  if (!anyLoaded) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  body.innerHTML = '';

  for (const row of SITE_ROWS) {
    body.appendChild(row.roleSource === 'audiobook' ? audiobookLadder(row) : appLadder(row));
  }

  const note = document.createElement('p');
  note.className = 'role-tree-note';
  note.textContent =
    'Every ladder is cumulative and every grant is strictly beneath your own rung, enforced by the site that owns it — never by this page. ' +
    'The words differ per site on purpose and are never translated here. ' +
    '⚠️ The audiobook "member" rung is NOT the same thing as an approved estate member in the directory below.';
  body.appendChild(note);
}

// ---------------------------------------------------------------------------
// THE SPENDING PANEL — "who and what is ALLOWED to bill"
// (docs/info/llm-billing-control-design.md §7.1, phase 2)
//
// Owner ask 2026-08-24: *"we need a way to toggle what can bill the LLM and
// what can't inside the admin page somewhere."*
//
// ⚠️ FEATURES AS ROWS, SITES AS COLUMNS — the TRANSPOSE of the permission grid
// below, deliberately. The question here is "what is switched on where", not
// "what can this person do", and drawing it the other way round would make the
// two panels look like the same table disagreeing with itself.
//
// ⚠️ THIS PANEL OWNS ONE QUESTION AND LINKS OUT FOR THE OTHERS. It is a POLICY
// switch. "How much has been spent" is /status/agents' measurement; "pause the
// pipeline tonight" is /status's TIME control. A number worth showing twice is
// a number that will eventually disagree with itself, so neither is restated
// here — both are links.
//
// 🔴 EVERY SWITCH HERE CAN ONLY DENY. Turning a cell ON removes the rule and
// returns the cell to "no rule", which is today's behaviour; it never grants
// anybody anything they could not already do, because the site's own gate
// (a capability, a secret, an env posture) is still ANDed in front of it.
// ---------------------------------------------------------------------------

/** `feature|site` → the rules that reach that cell, split by who they name. */
function billingCellRules(featureId, site) {
  const rules = billingDir?.rules ?? [];
  const reaches = (r) =>
    (r.feature === featureId || r.feature === '*') && (r.site === site || r.site === '*');
  return {
    broad: rules.filter((r) => reaches(r) && (r.principal_kind === 'everyone' || r.principal_kind === 'system')),
    narrow: rules.filter((r) => reaches(r) && (r.principal_kind === 'user' || r.principal_kind === 'role')),
  };
}

/**
 * The four cell states of §7.1. ⚠️ `n/a` is a REAL answer and must not be drawn
 * as `on` — a cell nobody can click that looks clickable invites a click that
 * does nothing.
 */
function billingCellState(feature, site) {
  if (!feature.sites.includes(site)) return { kind: 'na' };
  const { broad, narrow } = billingCellRules(feature.id, site);
  const off = broad.length > 0 && broad.every((r) => r.allow === false);
  const deniedNarrow = narrow.filter((r) => r.allow === false);
  if (off) return { kind: 'off', why: broad.find((r) => r.allow === false)?.why ?? '' };
  if (deniedNarrow.length > 0) return { kind: 'some', count: deniedNarrow.length };
  return { kind: 'on' };
}

/**
 * Which principals a cell's switch writes. A feature that BOTH a person and a
 * cron can trigger (`warnings.web`, `chapters.llm`, `pipeline.run`) needs one
 * rule of each kind, because `system` resolves alone — writing only the
 * `everyone` row would switch the button off and leave the hourly Action
 * paying, which is the opposite of what the click said.
 */
function billingPrincipalKinds(feature) {
  return feature.principals.map((p) => (p === 'system' ? 'system' : 'everyone'));
}

function billingKey(featureId, site) {
  return `${featureId}|${site}`;
}

function renderSpendingPanel() {
  const details = document.getElementById('spending-panel');
  const body = document.getElementById('spending-panel-body');
  if (!details || !body) return;

  if (!billingDir) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  body.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'role-tree-table spend-table';
  const thead = document.createElement('thead');
  const hrow = document.createElement('tr');
  for (const h of ['Money path', 'The code’s own estimate', ...billingDir.sites]) {
    const th = document.createElement('th');
    th.textContent = h === 'Money path' || h.startsWith('The code') ? h : (CATALOG_LABELS[h] || h);
    hrow.appendChild(th);
  }
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const group of billingDir.groups) {
    const inGroup = billingDir.features.filter((f) => f.group === group.id);
    if (inGroup.length === 0) continue;

    const gr = document.createElement('tr');
    const gth = document.createElement('th');
    gth.colSpan = billingDir.sites.length + 2;
    gth.className = 'spend-group';
    gth.textContent = group.label;
    gr.appendChild(gth);
    tbody.appendChild(gr);

    for (const feature of inGroup) {
      tbody.appendChild(spendingRow(feature));
    }
  }
  table.appendChild(tbody);
  body.appendChild(table);

  body.appendChild(spendingFooter());
}

function spendingRow(feature) {
  const tr = document.createElement('tr');

  const name = document.createElement('td');
  const label = document.createElement('strong');
  // ⚠️ A CLOCK, NOT A PERSON, on the unattended rows — `sweep.details` and its
  // neighbours have no user at all, and switching one off here is the only
  // control in the estate that stops an unattended hourly biller without a
  // deploy. The icon is the one-line explanation of why this row behaves
  // differently from the ones above it.
  const isSystem = feature.principals.includes('system');
  label.textContent = `${isSystem ? '⏱ ' : ''}${feature.label}`;
  name.appendChild(label);
  const detail = document.createElement('span');
  detail.className = 'spend-detail';
  detail.textContent = feature.detail;
  name.appendChild(detail);
  tr.appendChild(name);

  const cost = document.createElement('td');
  cost.className = 'spend-cost';
  // ⚠️ "the code's own estimate", never "spend" — the measured number is the
  // usage meter's question and this panel must not answer it.
  cost.textContent = feature.cost;
  tr.appendChild(cost);

  for (const site of billingDir.sites) {
    tr.appendChild(spendingCell(feature, site));
  }
  return tr;
}

function spendingCell(feature, site) {
  const td = document.createElement('td');
  td.className = 'spend-cell';
  const state = billingCellState(feature, site);

  if (state.kind === 'na') {
    const span = document.createElement('span');
    span.className = 'spend-na';
    span.textContent = 'n/a';
    span.title = `${feature.label} does not exist on ${CATALOG_LABELS[site] || site}.`;
    td.appendChild(span);
    return td;
  }

  const key = billingKey(feature.id, site);
  const staged = billingStaged.get(key);
  const live = state.kind !== 'off';
  const shown = staged === undefined ? live : staged;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'spend-toggle';
  btn.dataset.on = String(shown);
  if (staged !== undefined) btn.dataset.staged = 'true';
  btn.textContent = shown ? 'On' : 'Off';

  if (state.kind === 'some' && shown) {
    const some = document.createElement('span');
    some.className = 'spend-some';
    some.textContent = `⊘ ${state.count} off`;
    some.title =
      `On for the site, but denied for ${state.count} named ${state.count === 1 ? 'person or role' : 'people or roles'}. ` +
      'Those rules are per-person and are managed as their own rows.';
    td.appendChild(btn);
    td.appendChild(some);
  } else {
    td.appendChild(btn);
  }

  btn.title = shown
    ? `Switch ${feature.label} off for ${CATALOG_LABELS[site] || site}.`
    : state.why
      ? `Switched off — “${state.why}”. Click to turn it back on.`
      : `Switched off. Click to turn it back on.`;

  btn.addEventListener('click', () => {
    // GRANT-CLASS: this stages and writes nothing (see billingStaged's header).
    const next = !shown;
    if (next === live) billingStaged.delete(key);
    else billingStaged.set(key, next);
    renderSpendingPanel();
    const openWhy = document.getElementById('spend-why');
    if (openWhy) openWhy.focus();
  });

  return td;
}

function spendingFooter() {
  const wrap = document.createElement('div');
  wrap.className = 'spend-footer';

  if (billingDir.unknown?.length) {
    // ⚠️ Shown, never auto-deleted. A row pointing at an id the registry no
    // longer knows is a fact the owner should see — silently dropping it would
    // draw a feature as ON while a row in the table says otherwise.
    const warn = document.createElement('p');
    warn.className = 'spend-warn';
    warn.textContent =
      `${billingDir.unknown.length} stored rule${billingDir.unknown.length === 1 ? '' : 's'} ` +
      `name${billingDir.unknown.length === 1 ? 's' : ''} a money path this estate no longer has ` +
      `(${billingDir.unknown.map((r) => `${r.feature} on ${r.site}`).join(', ')}). ` +
      'They are ignored — nothing is switched off by them — and they are left in place rather than deleted behind your back.';
    wrap.appendChild(warn);
  }

  const note = document.createElement('p');
  note.className = 'role-tree-note';
  // ⚠️ THE TEN-MINUTE DELAY IS SAID OUT LOUD. A panel that implies "instantly"
  // invites pressing the switch twice, and the number is the revocation delay
  // on purpose — the answer rides the same cache and ages with it.
  note.textContent =
    `${billingDir.effect_delay_note} Switching something OFF only ever stops spending: every site's own gate — ` +
    'a role capability, a missing key, an env posture — still applies in front of this, and turning a cell back ' +
    'on grants nobody anything they could not already do.';
  wrap.appendChild(note);

  const links = document.createElement('p');
  links.className = 'role-tree-note';
  links.append('How much has actually been spent: ');
  const meter = document.createElement('a');
  meter.href = '/status/agents/';
  meter.textContent = 'the usage meter on /status/agents';
  links.append(meter, '. To pause the ingestion pipeline for tonight (a TIME control, not a policy one): ');
  const pause = document.createElement('a');
  pause.href = '/status/pipelines/';
  pause.textContent = 'the ingestion card on /status/pipelines';
  links.append(pause, '.');
  wrap.appendChild(links);

  if (billingStaged.size === 0) return wrap;

  const staging = document.createElement('div');
  staging.className = 'spend-staging';

  const summary = document.createElement('p');
  summary.className = 'spend-summary';
  const off = [...billingStaged.entries()].filter(([, v]) => v === false);
  const on = [...billingStaged.entries()].filter(([, v]) => v === true);
  const describe = (k) => {
    const [featureId, site] = k.split('|');
    const f = billingDir.features.find((x) => x.id === featureId);
    return `${f ? f.label : featureId} on ${CATALOG_LABELS[site] || site}`;
  };
  const parts = [];
  if (off.length) parts.push(`switch OFF — ${off.map(([k]) => describe(k)).join('; ')}`);
  if (on.length) parts.push(`switch back ON — ${on.map(([k]) => describe(k)).join('; ')}`);
  summary.textContent = `Staged (nothing is saved yet): ${parts.join(' · ')}.`;
  staging.appendChild(summary);

  const whyLabel = document.createElement('label');
  whyLabel.className = 'ctl';
  const whySpan = document.createElement('span');
  whySpan.className = 'ctl-label';
  // ⚠️ REQUIRED, and the label says why rather than just marking it required.
  // A switched-off feature is INVISIBLE: in six months "why does cover search
  // not work on padhard?" has exactly one cheap answer, and it is this box.
  whySpan.textContent = 'Why (required — a switched-off feature is invisible, and this is the only record of the reason)';
  const why = document.createElement('input');
  why.id = 'spend-why';
  why.className = 'ctl-input';
  why.type = 'text';
  why.maxLength = 500;
  why.placeholder = 'e.g. six cents a cover and the free rungs are doing fine';
  whyLabel.append(whySpan, why);
  staging.appendChild(whyLabel);

  const row = document.createElement('div');
  row.className = 'spend-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn';
  save.textContent = `Save spending changes (${billingStaged.size})`;
  save.addEventListener('click', () => saveSpending(why.value, save));
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.className = 'btn small quiet';
  discard.textContent = 'Discard';
  discard.addEventListener('click', () => {
    billingStaged.clear();
    renderSpendingPanel();
    setStatus('');
  });
  row.append(save, discard);
  staging.appendChild(row);

  wrap.appendChild(staging);
  return wrap;
}

/**
 * Commit the staged cells.
 *
 * ⚠️ TURNING A CELL ON DELETES THE RULE rather than writing an `allow` row.
 * "No rule" IS the default state, so a table that filled up with allow-rows
 * meaning "the same as nothing" would slowly stop being readable — and the day
 * somebody asks "what has been switched off here?", the answer should be the
 * rows, not the rows minus the ones that cancel out.
 *
 * ⚠️ It stops at the first failure and says how far it got. A half-applied
 * batch that reported success would leave the panel disagreeing with the table.
 */
async function saveSpending(why, saveBtn) {
  const trimmed = (why || '').trim();
  if (trimmed.length < 3) {
    setStatus('Say why first — a switched-off feature is invisible, and this note is the only record of the reason.', 'warn');
    document.getElementById('spend-why')?.focus();
    return;
  }
  saveBtn.disabled = true;
  setStatus('Saving spending changes…');

  let done = 0;
  for (const [key, on] of billingStaged.entries()) {
    const [featureId, site] = key.split('|');
    const feature = billingDir.features.find((f) => f.id === featureId);
    if (!feature) continue;
    let ok = true;
    for (const kind of billingPrincipalKinds(feature)) {
      if (on) {
        const existing = (billingDir.rules ?? []).find(
          (r) => r.feature === featureId && r.site === site && r.principal_kind === kind,
        );
        if (!existing) continue;
        const res = await api(`/api/estate/billing/rules/${existing.id}`, { method: 'DELETE' });
        if (!res) ok = false;
      } else {
        const res = await api('/api/estate/billing/rules', {
          method: 'POST',
          body: JSON.stringify({
            feature: featureId,
            site,
            principal_kind: kind,
            principal_value: null,
            allow: false,
            why: trimmed,
          }),
        });
        if (!res) ok = false;
      }
      if (!ok) break;
    }
    if (!ok) {
      // api() has already said what went wrong; add how far this got, because
      // "it failed" without "and three of five landed" is unactionable.
      saveBtn.disabled = false;
      setStatus(
        `Stopped after ${done} of ${billingStaged.size} change${billingStaged.size === 1 ? '' : 's'} — ` +
        `${statusEl.textContent || 'the server refused one of them'} Reload to see what actually landed.`,
        'warn',
      );
      return;
    }
    done += 1;
  }

  billingStaged.clear();
  await loadDirectory();
  setStatus(
    `Saved ${done} spending change${done === 1 ? '' : 's'}. It takes effect within 10 minutes — the same delay as a revocation.`,
  );
}

// ---------------------------------------------------------------------------
// THE VERSE QUEUE — "+ add a verse" (design docs/info/universe-add-verse-design.md).
//
// 🔴 APPROVING RUNS NOTHING. It sets a status. A universe is a decision in
// data/universes.json — in git, compiled into two catalogs at build time and
// pinned by a tripwire test in library_catalog — so the chain from "approved"
// to "the verse exists" runs through a person editing that file with
// `tools/universes.mjs create`, updating the tripwire, and rebuilding both
// catalogs. The footer says this out loud, because a green button that looks
// like it did the whole job is how an owner ends up believing a verse exists.
//
// ⚠️ A DECLINE NEEDS A REASON AND THE ROUTE ENFORCES IT. The requester is shown
// that sentence verbatim on /universes, so this panel asks for it inline rather
// than sending a bare no and letting the server refuse.
//
// ⚠️ AGE IS SHOWN ON APPROVED ROWS, NOT ON PENDING ONES. A pending row is
// waiting on the person reading this page; an approved one is waiting on a
// deploy nobody has run, which is a different failure and the invisible one.
// ---------------------------------------------------------------------------

/** Which decision is still open on a row. `landed` rows drop out entirely — by
 *  then the verse is in the catalogs and this queue has nothing to say. */
const VERSE_OPEN = new Set(['pending', 'approved']);

function verseAge(iso) {
  if (!iso) return null;
  const t = Date.parse(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function verseWhen(iso) {
  const days = verseAge(iso);
  if (days === null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return String(iso).slice(0, 10);
}

function renderVerseQueue() {
  const details = document.getElementById('verse-queue');
  const body = document.getElementById('verse-queue-body');
  const countEl = document.getElementById('verse-queue-count');
  if (!details || !body) return;

  // api() has already said why on a failure — an unreachable route costs this
  // panel and nothing else.
  if (!verseQueue) {
    details.hidden = true;
    return;
  }
  details.hidden = false;
  body.innerHTML = '';

  const rows = Array.isArray(verseQueue.requests) ? verseQueue.requests : [];
  const open = rows.filter((r) => VERSE_OPEN.has(r.status));
  const pending = open.filter((r) => r.status === 'pending');
  if (countEl) {
    countEl.hidden = pending.length === 0;
    countEl.textContent = `${pending.length} waiting`;
  }

  // The migration-lag sentence, if the Worker is ahead of its table.
  if (verseQueue.error) {
    const p = document.createElement('p');
    p.className = 'perm-warn';
    p.textContent = `${verseQueue.detail}${verseQueue.fix ? ` Fix: ${verseQueue.fix}` : ''}`;
    body.appendChild(p);
  }

  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'role-tree-note';
    p.textContent = verseQueue.error
      ? 'Nothing can be waiting until the migration is applied.'
      : 'Nobody has asked for a verse. Members ask from the “+ Add a verse” button on /universes.';
    body.appendChild(p);
    body.appendChild(verseQueueFooter());
    return;
  }

  const list = document.createElement('div');
  list.className = 'verse-list';
  // Open first, then the decided history — the owner's own question is "what is
  // waiting on me", and burying two pending rows under nine declined ones
  // answers a question nobody asked.
  for (const row of [...open, ...rows.filter((r) => !VERSE_OPEN.has(r.status))]) {
    list.appendChild(verseRow(row));
  }
  body.appendChild(list);
  body.appendChild(verseQueueFooter());
}

function verseRow(row) {
  const wrap = document.createElement('div');
  wrap.className = 'verse-row';
  wrap.dataset.status = row.status;

  const head = document.createElement('div');
  head.className = 'verse-head';
  const name = document.createElement('strong');
  name.textContent = row.name;
  const chip = document.createElement('span');
  chip.className = 'verse-chip';
  chip.dataset.status = row.status;
  if (row.status === 'approved') {
    // ⚠️ §6 Q3, and the whole reason the fourth status exists: an approved verse
    // that nobody has shipped is a person told yes with nothing to show for it.
    // The age is spelled out past the threshold instead of a colour nobody
    // decodes.
    chip.textContent = row.stale
      ? `approved ${row.age_days} days ago, not yet in a build`
      : 'approved — waiting on the next build';
    if (row.stale) chip.dataset.stale = 'true';
  } else {
    chip.textContent = row.status;
  }
  head.append(name, chip);
  wrap.appendChild(head);

  const meta = document.createElement('span');
  meta.className = 'spend-detail';
  const bits = [row.requested_by ? `asked by ${row.requested_by}` : 'asked by you', verseWhen(row.requested_at)];
  meta.textContent = bits.filter(Boolean).join(' · ');
  wrap.appendChild(meta);

  const why = document.createElement('p');
  why.className = 'verse-why';
  why.textContent = `“${row.why}”`;
  wrap.appendChild(why);

  const payload = row.payload || {};
  for (const [label, values] of [
    ['Series', payload.series],
    ['Also these titles', payload.titles],
    ['Deliberately NOT', payload.notSeries],
  ]) {
    if (Array.isArray(values) && values.length) {
      const line = document.createElement('span');
      line.className = 'spend-detail';
      line.textContent = `${label}: ${values.join(', ')}`;
      wrap.appendChild(line);
    }
  }
  // ⚠️ The near misses the requester saw, carried through so the decision is
  // made on the same information. It is NOT a reason to decline on its own —
  // Marvel, Disney and Star Wars are three universes split apart on purpose.
  if (Array.isArray(payload.near) && payload.near.length) {
    const near = document.createElement('span');
    near.className = 'spend-detail';
    near.textContent = `Close to: ${payload.near.join(', ')} — worth a look, not a reason on its own.`;
    wrap.appendChild(near);
  }

  if (row.decided_why) {
    const said = document.createElement('p');
    said.className = 'verse-why';
    said.textContent = `↳ ${row.decided_why}`;
    wrap.appendChild(said);
  }
  if (row.landed_commit) {
    const landed = document.createElement('span');
    landed.className = 'spend-detail';
    landed.textContent = `landed in ${row.landed_commit}`;
    wrap.appendChild(landed);
  }

  if (row.status === 'pending') wrap.appendChild(verseDecisionControls(row));
  return wrap;
}

function verseDecisionControls(row) {
  const box = document.createElement('div');
  box.className = 'verse-actions';

  const why = document.createElement('input');
  why.type = 'text';
  why.className = 'ctl-input verse-why-input';
  why.placeholder = 'Reason — required to decline, optional on a yes';
  why.autocomplete = 'off';

  const approve = document.createElement('button');
  approve.type = 'button';
  approve.className = 'btn small';
  approve.textContent = 'Approve';

  const decline = document.createElement('button');
  decline.type = 'button';
  decline.className = 'btn small quiet';
  decline.textContent = 'Decline';

  async function decide(decision) {
    const reason = why.value.trim();
    // ⚠️ Checked here as well as at the route. Not because the route might
    // forget, but because a person should be told before the round-trip, not
    // after it — the same sentence either way.
    if (decision === 'declined' && reason.length < 10) {
      setStatus(
        'A decline needs a reason of at least ten characters — the person who asked is shown it word for word. ' +
          '“That’s The Cosmere under another name” answers the question; a bare no starts an argument.',
        'warn',
      );
      why.focus();
      return;
    }
    approve.disabled = true;
    decline.disabled = true;
    const data = await api(`/api/estate/universes/requests/${row.id}/decide`, {
      method: 'POST',
      body: JSON.stringify({ decision, why: reason }),
    });
    approve.disabled = false;
    decline.disabled = false;
    if (!data) return; // api() has already said why
    await loadDirectory();
    setStatus(data.detail || `Request #${row.id} is ${decision}.`, '');
  }

  approve.addEventListener('click', () => decide('approved'));
  decline.addEventListener('click', () => decide('declined'));

  box.append(why, approve, decline);
  return box;
}

function verseQueueFooter() {
  const wrap = document.createElement('div');
  wrap.className = 'spend-footer';

  const note = document.createElement('p');
  note.className = 'role-tree-note';
  // 🔴 THE SENTENCE THIS PANEL EXISTS TO SAY. Without it, a green Approve looks
  // like the job is done, and the requester is told a verse exists that does not.
  note.textContent =
    'Approving records a decision — it does not create the verse. The universe list is data/universes.json in ' +
    'git: a session runs `tools/universes.mjs create`, updates the tripwire test in library_catalog, and both ' +
    'catalogs are rebuilt before anything appears on /universes. Until that happens the requester sees ' +
    '“approved — waiting on the next build”, which is the truth.';
  wrap.appendChild(note);

  const links = document.createElement('p');
  links.className = 'role-tree-note';
  links.append('Where members ask, and where an approved verse finally shows up: ');
  const a = document.createElement('a');
  a.href = '/universes/';
  a.textContent = 'the universes page';
  links.append(a, '.');
  wrap.appendChild(links);

  return wrap;
}

/** The Audiobooks/Ebooks ladder — the rich one, straight from GET /site-roles/tree. */
function audiobookLadder(row) {
  const section = ladderSection(
    row.label,
    'One ladder over both shelves — the ebook shelf has none of its own, and downloading an ebook file is this ladder’s admin rung.',
  );

  if (!roleTreeDir) {
    const p = document.createElement('p');
    p.className = 'perm-note';
    p.textContent = 'not loaded yet';
    section.appendChild(p);
    return section;
  }
  if (!roleTreeDir.ok) {
    const p = document.createElement('p');
    p.className = 'perm-warn';
    p.textContent = `${roleTreeDir.why ?? 'not loaded'} — this ladder cannot be shown right now.`;
    section.appendChild(p);
    return section;
  }

  const { table, tbody } = ladderTable(['role', 'grants', 'granted by', 'rules-enforced']);
  // ⚠️ HIGHEST-FIRST for display, matching the app ladders and the role
  // dropdowns (owner, 2026-08-17: "can you make audiobook/ebook high to low?").
  // The tree answers lowest-first; reversed here only, never re-stored.
  for (const cap of [...roleTreeDir.capabilities].reverse()) {
    const tr = document.createElement('tr');

    const roleTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${cap.role === 'owner' ? 'revoked' : cap.apiGrantable ? 'approved' : 'pending'}`;
    badge.textContent = cap.role;
    roleTd.appendChild(badge);
    tr.appendChild(roleTd);

    const summaryTd = document.createElement('td');
    summaryTd.textContent = cap.summary;
    tr.appendChild(summaryTd);

    const grantedByTd = document.createElement('td');
    grantedByTd.className = 'perm-note';
    grantedByTd.textContent = cap.grantedBy;
    tr.appendChild(grantedByTd);

    const rulesTd = document.createElement('td');
    rulesTd.textContent = cap.rulesEnforced ? 'yes' : 'not yet';
    if (!cap.rulesEnforced) rulesTd.className = 'perm-warn';
    tr.appendChild(rulesTd);

    tbody.appendChild(tr);
  }
  section.appendChild(table);

  const note = document.createElement('p');
  note.className = 'role-tree-note';
  note.textContent =
    'member/contributor are real and grantable here, but the audiobook site’s firestore.rules (a different, owner-gated repo) only enforces moderator/admin today — see "rules-enforced" above.';
  section.appendChild(note);
  return section;
}

/**
 * An app site's ladder, from its own /api/admin/users answer.
 *
 * ⚠️ Two columns, not four, and that is honesty rather than laziness: these
 * Workers answer their rung LIST, not per-rung capability metadata, so
 * "granted by" and "rules-enforced" would be guesses. The section note carries
 * the one fact that IS known for all of them — grants are strictly beneath the
 * caller's own rung, enforced there.
 */
function appLadder(row) {
  const app = appFor(row);
  const section = ladderSection(row.label, app ? app.origin.replace('https://', '') : '');
  const dir = appDirs[row.id];

  if (!dir) {
    const p = document.createElement('p');
    p.className = 'perm-note';
    p.textContent = 'not loaded yet';
    section.appendChild(p);
    return section;
  }
  if (!dir.ok) {
    const p = document.createElement('p');
    p.className = 'perm-warn';
    p.textContent = `${dir.why ?? 'not loaded'} — this site’s ladder cannot be shown right now.`;
    section.appendChild(p);
    return section;
  }

  const { table, tbody } = ladderTable(['role', 'grants']);
  for (const role of dir.roles) {
    const tr = document.createElement('tr');
    const roleTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${role === 'owner' ? 'revoked' : 'approved'}`;
    badge.textContent = role;
    roleTd.appendChild(badge);
    tr.appendChild(roleTd);

    const meaningTd = document.createElement('td');
    const meaning = RUNG_MEANINGS[role];
    meaningTd.textContent = meaning || 'no documented summary for this rung — this site answers its own vocabulary.';
    if (!meaning) meaningTd.className = 'perm-note';
    tr.appendChild(meaningTd);

    tbody.appendChild(tr);
  }
  section.appendChild(table);

  const note = document.createElement('p');
  note.className = 'role-tree-note';
  note.textContent = 'Listed in the order this site answers them; grants are strictly beneath your own rung, enforced there.';
  section.appendChild(note);
  return section;
}

function renderUsers(users) {
  allEstateUsers = users;
  controlsEl.hidden = !users.length;
  if (!users.length) {
    usersEl.innerHTML = '';
    updateCountLine(0, 0);
    setStatus('The directory is empty. Owner emails still work everywhere (the break-glass), and the seed script fills this list.');
    return;
  }
  syncControlsFromState(); // the app role vocab may have just arrived/changed — keep the bar honest
  renderFilteredList();
}

/**
 * An app listing an email the estate directory does not hold means the seed
 * missed someone (§9 step 2 is idempotent and re-runnable) — say so rather
 * than silently rendering a directory that disagrees with its apps.
 *
 * ⚠️ NOT every app. `library2` (padhard.heygabi.ai) is a SECOND HOUSEHOLD's
 * instance: her roster is hers, and people on it who are not in our estate
 * directory are the expected, permanent state — not a seed that missed
 * someone. Flagging it would print a warning nobody can ever clear, which
 * trains the reader to ignore the whole line. Opt in per app (`seedGap`).
 */
function renderSeedGaps(estateUsers) {
  const known = new Set(estateUsers.map((u) => u.email.toLowerCase()));
  const lines = [];
  for (const app of APPS) {
    if (!app.seedGap) continue;
    const dir = appDirs[app.key];
    if (!dir?.ok) continue;
    const extras = [...dir.byEmail.keys()].filter((e) => !known.has(e));
    if (extras.length) {
      lines.push(
        `The ${app.label} catalog also lists ${extras.join(', ')} — not in the estate directory (a seed gap; re-run the seed).`,
      );
    }
  }
  gapsEl.textContent = lines.join(' ');
  gapsEl.hidden = !lines.length;
}

// ---------------------------------------------------------------------------
// #member=<email> anchor — the "see someone, then grant permissions" flow.
// The catalogs link a rendered person straight to their card here, e.g.
// https://heygabi.ai/admin#member=someone%40example.com. This page only
// scrolls and highlights; it grants nothing the buttons don't already.
// ---------------------------------------------------------------------------

/** The URL-encoded email carried by a #member= fragment, lowercased; else null. */
function anchoredMemberEmail() {
  const m = /^#member=(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim().toLowerCase();
  } catch (e) {
    return null; // malformed percent-encoding — ignore rather than throw
  }
}

/**
 * Scroll the anchored member's card into view with a brief highlight.
 * Safe to call any time: it does nothing without a fragment, a rendered
 * directory (auth resolves async — loadDirectory re-runs this), or a match.
 *
 * The deep-link must always land: if the anchored member exists in the
 * directory but the CURRENT filters hide them, drop the filters (sort is
 * left alone — it only reorders, never hides) and re-render once before
 * giving up.
 */
function revealAnchoredMember() {
  const email = anchoredMemberEmail();
  if (!email) return;
  // ⚠️ AND OPEN THEIR PERMISSION GRID (2026-08-17). The deep link exists for
  // the "see someone on a catalog, then grant them something" flow; landing on
  // a collapsed card would have made the link finish one click short of the
  // thing it was followed for.
  if (!expandedMembers.has(email)) {
    expandedMembers.add(email);
    if (allEstateUsers.some((u) => u.email.toLowerCase() === email)) renderFilteredList();
  }
  let card = usersEl.querySelector(`li.user[data-email="${CSS.escape(email)}"]`);
  if (!card && allEstateUsers.some((u) => u.email.toLowerCase() === email)) {
    state.filters = defaultFilters();
    syncControlsFromState();
    persistView();
    renderFilteredList();
    card = usersEl.querySelector(`li.user[data-email="${CSS.escape(email)}"]`);
  }
  if (!card) return;
  // ⚠️ AND OPEN THE SECTION THEY LANDED IN (2026-08-17, with the three-section
  // reshape). Revoked is collapsed by default, so following a catalog's
  // #member= link to a revoked person would otherwise scroll to a shut box and
  // highlight nothing — the deep link finishing one click short again, which is
  // the exact failure the grid-opening line above exists to prevent.
  const section = card.closest('details.dir-group');
  if (section) section.open = true; // its own toggle listener records the choice
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('anchored');
  setTimeout(() => card.classList.remove('anchored'), 2600);
}

window.addEventListener('hashchange', revealAnchoredMember);

// ---------------------------------------------------------------------------
// Auth wiring
// ---------------------------------------------------------------------------

/**
 * ⚠️ The sign-in flash, same bug find.js fixed and the owner then met HERE
 * (live, 2026-08-14): Firebase reads its persisted session asynchronously,
 * so a page that renders signed-out immediately shows a signed-in owner the
 * sign-in button for however long the SDK takes. The markup now ships the
 * button hidden; nothing decisive renders until watchAuth's first callback.
 * The 8s backstop covers the SDK never answering (blocked gstatic).
 */
let authResolved = false;
const authBackstop = setTimeout(() => {
  if (!authResolved) {
    authResolved = true;
    renderAuthState();
  }
}, 8000);

/**
 * Everything a signed-out page must not still be holding.
 *
 * ⚠️ THE LADDERS AND THE STAGED EDITS GO TOO, since 2026-08-17. The map at the
 * top now renders from four federations rather than one, and staged grants are
 * held in memory rather than in the DOM — so clearing only `roleTreeDir` (all
 * this used to do, back when it was the only thing up there) would leave three
 * ladders on screen after sign-out and would hand the NEXT person who signs in
 * the previous one's unsaved edits.
 */
function clearSignedInState() {
  usersEl.innerHTML = '';
  gapsEl.hidden = true;
  controlsEl.hidden = true;
  allEstateUsers = [];
  pendingEdits.clear();
  expandedMembers.clear();
  // Which directory sections were opened is this reader's choice, not the next
  // one's — the same reasoning that clears the expanded cards and the staged
  // edits directly above.
  openGroups.clear();
  appDirs = Object.fromEntries(APPS.map((a) => [a.key, null]));
  siteRolesDir = null;
  roleTreeDir = null;
  // The Spending panel goes with them, staged edits included — for exactly the
  // reason above: an unsaved "switch cover search off" belonging to the person
  // who just signed out must not be handed to whoever signs in next.
  billingDir = null;
  billingStaged.clear();
  updateCountLine(0, 0);
  renderPermissionMap();
  renderSpendingPanel();
}

function renderAuthState() {
  const signedIn = currentUser !== null;
  signinBtn.hidden = signedIn || !authResolved;
  refreshBtn.hidden = !signedIn;
  if (signedIn) {
    whoEl.innerHTML = '';
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'linkbtn';
    out.textContent = 'sign out';
    out.addEventListener('click', async () => {
      await signOutUser();
      clearSignedInState();
      setStatus('');
    });
    whoEl.append(`${currentUser.displayName || currentUser.email} · `, out);
    whoEl.hidden = false;
  } else {
    whoEl.hidden = true;
    whoEl.innerHTML = '';
    clearSignedInState();
  }
}

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  const r = await signIn();
  signinBtn.disabled = false;
  if (r.error) setStatus(r.error, r.ownerAction ? 'owner' : 'warn');
});

refreshBtn.addEventListener('click', loadDirectory);

watchAuth((user) => {
  authResolved = true;
  clearTimeout(authBackstop);
  currentUser = user;
  renderAuthState();
  if (user) loadDirectory();
});

wireControls();
syncControlsFromState(); // paint any persisted filter/sort choice into the controls before data even loads

renderAuthState();
setStatus('Sign in to see the member list. The page is API-gated — nothing loads without an approver token.');

handleRedirectResult().then((err) => {
  if (err) setStatus(err, err.includes('authorised domain') ? 'owner' : 'warn');
});
