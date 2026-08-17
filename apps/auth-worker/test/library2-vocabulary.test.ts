/**
 * `library2` — the ONE wire word for the second library instance ("Sam's
 * library", `padhard.heygabi.ai`, `library_catalog`'s `[env.friend]`).
 *
 * Written 2026-08-16, when the estate began MANAGING that instance's roles
 * from `heygabi.ai/admin` (owner, live: *"in the admin page Sam's library has
 * no roles, I should be able to set her with the same level of roles as my
 * library"*).
 *
 * ## What this file is actually defending, and what it deliberately is not
 *
 * ⚠️ **This Worker does NOT own library2's ROLES, and no test here pretends
 * it does.** Only ONE site's roles are served from this Worker —
 * `audiobook`, whose Firestore `site_roles/{uid}` docs no browser may read or
 * write, which is exactly why `site-roles.ts` holds a service account and
 * federates them. `library`, `games` and now `library2` each own their roles
 * in their OWN Worker, in their OWN vocabulary, behind their OWN
 * `manageUsers` gate, and the admin page reads each one directly
 * (`GET /api/admin/users` on that host). Adding a "fourth managed site" to
 * `site-roles.ts`'s ladder would not have federated anything — it would have
 * invented a second, competing role store for a catalog that already has one,
 * which is the exact centralization the design's §1.2 refuses. The real
 * fourth column is a row in `admin.js`'s `APPS`.
 *
 * What this Worker DOES own for library2 is its **NAME** — and four separate
 * places speak it, to three different audiences:
 *
 *   1. `CONSUMER_APPS` — the doors: which app knocked on `POST /estate/seen`
 *      (recorded as `origin: 'seen:library2'`).
 *   2. `appTokenFor()` — that door's own bearer, `ESTATE_APP_TOKEN_LIBRARY2`.
 *      ⚠️ Named in HER Worker's env too (the brief's consumer note); a
 *      rename here is a rename she cannot make.
 *   3. `CATALOGS` / `vis_library2` — what a member may SEE (0007).
 *   4. `/api/estate/me`'s `visibility` array, which her instance reads to
 *      decide what to show.
 *
 * If any ONE of those drifts from `library2`, the break is silent: /seen
 * still answers, the admin page still renders, and only the wrong person
 * seeing (or not seeing) the wrong catalog reveals it. These are persisted /
 * cross-repo keys — changing one is a migration and a coordinated deploy of
 * her Worker, never an edit. Each test below fails loudly on exactly that
 * drift.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONSUMER_APPS, appTokenFor, type ConsumerApp, type Env } from '../src/env.js';
import { CATALOGS, isCatalog, normalizeVisibility, storedVisibility, visibilityToFlags } from '../src/visibility.js';

test('library2 is a consumer app — the door her Worker knocks on has a name here', () => {
  assert.ok(
    (CONSUMER_APPS as readonly string[]).includes('library2'),
    'library2 missing from CONSUMER_APPS — POST /estate/seen from her instance would not identify',
  );
  // The exact string, not a lookalike. `library-2`, `library_2` and `friend`
  // are all plausible and all wrong: the persisted `origin` column already
  // reads 'seen:library2', and the 0007 column is already vis_library2.
  assert.equal(CONSUMER_APPS.filter((a) => a.startsWith('library')).join(','), 'library,library2');
});

test('every consumer app resolves its OWN token — a fifth app cannot be added without one', () => {
  // The real defence: `appTokenFor` is an exhaustive switch, so a new
  // CONSUMER_APPS entry with no branch fails to typecheck. This pins the
  // RUNTIME half — that each app maps to a DISTINCT secret, so a copy-paste
  // slip (library2 accidentally returning ESTATE_APP_TOKEN_LIBRARY) is
  // caught. One leaked token must stay one rotation.
  const env = {
    ESTATE_APP_TOKEN_LIBRARY: 'tok-library',
    ESTATE_APP_TOKEN_GAMES: 'tok-games',
    ESTATE_APP_TOKEN_INDEX: 'tok-index',
    ESTATE_APP_TOKEN_AUDIOBOOK: 'tok-audiobook',
    ESTATE_APP_TOKEN_LIBRARY2: 'tok-library2',
  } as unknown as Env;

  const seen = new Map<string, ConsumerApp>();
  for (const app of CONSUMER_APPS) {
    const token = appTokenFor(env, app);
    assert.ok(token, `${app} has no token accessor`);
    const clash = seen.get(token!);
    assert.equal(clash, undefined, `${app} and ${clash} share the same secret — one leak would be two rotations`);
    seen.set(token!, app);
  }
  assert.equal(appTokenFor(env, 'library2'), 'tok-library2');
  // ⚠️ NOT the main library's. This is the assertion that catches the
  // copy-paste, and the one her instance's estate answers depend on.
  assert.notEqual(appTokenFor(env, 'library2'), appTokenFor(env, 'library'));
});

test('library2 is a catalog, appended LAST — the canonical order never re-sorts', () => {
  assert.deepEqual([...CATALOGS], ['audiobook', 'library', 'games', 'library2']);
  assert.equal(CATALOGS[CATALOGS.length - 1], 'library2');
  assert.equal(isCatalog('library2'), true);
  // The order is load-bearing ACROSS repos (§4.5), so an arriving set is
  // re-sorted INTO the canon rather than trusted — library2 last however it
  // was sent.
  assert.deepEqual(normalizeVisibility(['library2', 'games', 'audiobook']), ['audiobook', 'games', 'library2']);
});

test('the visibility flag column is vis_library2, and it is the ONLY thing that grants her catalog', () => {
  // A member with every OTHER flag set must still not see library2 — proving
  // the flag is read, not inferred from "approved" or from vis_library.
  assert.deepEqual(
    storedVisibility({ vis_audiobook: 1, vis_library: 1, vis_games: 1, vis_library2: 0 }),
    ['audiobook', 'library', 'games'],
  );
  assert.deepEqual(
    storedVisibility({ vis_audiobook: 0, vis_library: 0, vis_games: 0, vis_library2: 1 }),
    ['library2'],
  );
  // And the write side round-trips through the same word.
  assert.equal(visibilityToFlags(['library2']).vis_library2, 1);
  assert.equal(visibilityToFlags(['library']).vis_library2, 0);
});

test('⚠️ this Worker serves NO role ladder for library2 — its roles are hers, not ours', async () => {
  // The negative assertion, stated as a test because a future session
  // reading the admin page's four role columns will reasonably assume all
  // four are served from here. They are not. `SITE_ROLES` is the AUDIOBOOK
  // vocabulary and nothing else; if a `library2` rung ever appears in it,
  // someone has started a second role store for a catalog that already owns
  // one, and this test is the tripwire.
  const { SITE_ROLES, ROLE_LADDER } = await import('../src/role-ladder.js');
  assert.deepEqual([...SITE_ROLES], ['member', 'contributor', 'moderator', 'admin']);
  assert.equal(
    (ROLE_LADDER as readonly string[]).some((r) => r.includes('library')),
    false,
    'the audiobook ladder has grown a site-specific rung — roles are per-app by design (§1.2)',
  );
});
