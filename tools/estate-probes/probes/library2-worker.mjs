/**
 * padhard.heygabi.ai — "Sam's library", the SECOND library instance
 * (`library_catalog`'s `[env.friend]`: Worker `library-catalog-friend`, its
 * own D1 and covers bucket; sibling repo, READ-ONLY reference — nothing in
 * that repo is touched by this suite or by building it).
 *
 * ## Why this file exists at all when library-worker.mjs already probes the
 * ## same code
 *
 * Because the CODE is shared and the DEPLOY is not. A green
 * `library.heygabi.ai` says nothing about whether her Worker deployed, kept
 * its custom domain, or still has its D1 bound. The estate now MANAGES her
 * roles from `heygabi.ai/admin` (2026-08-16), and that page reaches this host
 * cross-origin — so the two things that page depends on are exactly what this
 * probes:
 *
 *   1. `/api/admin/users` REFUSES a caller with no token, and one with a
 *      token-shaped string that is not a real Firebase JWT. This is the
 *      surface that lists and changes who may do what on her instance; if it
 *      ever answered a roster to an anonymous caller, that is a real-people
 *      privacy failure, not a style issue.
 *   2. Its CORS admits EXACTLY `https://heygabi.ai` and nobody else
 *      (`ADMIN_PAGE_ORIGIN` in that repo's `routes/admin.ts` is a constant,
 *      not an env var). An admit-list that quietly widened would let any page
 *      on the internet drive the roster with a visitor's own bearer; one that
 *      quietly narrowed would break the admin page's fourth column with a
 *      bare CORS error, which is the failure the estate's
 *      never-show-a-bare-status rule exists to prevent.
 *
 * ⚠️ STRICTLY GET/OPTIONS, like every probe here. The role-WRITE path
 * (`PATCH /api/admin/users/:id/role`) is deliberately never exercised — it
 * changes what a real person may do on a real catalog. Its refusal is
 * covered by the same `requireAuth` blanket the GET proves, and its
 * escalation rules are unit-tested in `library_catalog`'s own suite
 * (`canGrantRole`, `@lc/core`), which is where that belongs.
 *
 * `/api/health` for this host lives in `health.mjs` (the `library2-health`
 * area) with the other four Workers, not here — one implementation of the
 * envelope assertion, five targets.
 */

import { get, options, check, header } from '../lib/kit.mjs';
import { LIBRARY2_ORIGIN, APEX_ORIGIN, FOREIGN_ORIGIN, GARBAGE_BEARER } from '../lib/origins.mjs';

const AREA = 'library2';

const ADMIN_USERS = `${LIBRARY2_ORIGIN}/api/admin/users`;

/** The worded-refusal contract: 401 AND `{ error: "unauthenticated" }`. */
function expectUnauthenticated(id, label, r) {
  if (!r.ok) {
    check(AREA, id, 'GET', ADMIN_USERS, `${label} → 401 { error: "unauthenticated" }`, false, `request failed: ${r.error}`);
    return;
  }
  const ok = r.status === 401 && r.json?.error === 'unauthenticated';
  check(
    AREA,
    id,
    'GET',
    ADMIN_USERS,
    `${label} → 401 { error: "unauthenticated" }`,
    ok,
    `status=${r.status} body=${JSON.stringify(r.json)}`,
  );
}

export async function probeLibrary2Worker() {
  // L2-1/L2-2: the federated role surface refuses anonymous AND garbage-bearer
  // callers. Two separate probes on purpose — a gate that only checks "is the
  // header present" passes the first and fails the second.
  expectUnauthenticated('L21', 'tokenless', await get(ADMIN_USERS));
  expectUnauthenticated(
    'L22',
    'garbage bearer',
    await get(ADMIN_USERS, { headers: { Authorization: GARBAGE_BEARER } }),
  );

  // L2-3/L2-4: the apex is admitted, with the methods the admin page actually
  // uses (GET to list, PATCH to set a role).
  const apexPre = await options(ADMIN_USERS, {
    headers: {
      Origin: APEX_ORIGIN,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Authorization',
    },
  });
  if (!apexPre.ok) {
    check(AREA, 'L23', 'OPTIONS', ADMIN_USERS, `access-control-allow-origin === ${APEX_ORIGIN}`, false, `request failed: ${apexPre.error}`);
    check(AREA, 'L24', 'OPTIONS', ADMIN_USERS, 'access-control-allow-methods includes GET and PATCH', false, `request failed: ${apexPre.error}`);
  } else {
    const acao = header(apexPre, 'access-control-allow-origin');
    check(
      AREA,
      'L23',
      'OPTIONS',
      ADMIN_USERS,
      `access-control-allow-origin === ${APEX_ORIGIN} (adminCors, apex-only constant)`,
      acao === APEX_ORIGIN,
      `ACAO=${acao}`,
    );
    const acam = (header(apexPre, 'access-control-allow-methods') ?? '').toUpperCase();
    check(
      AREA,
      'L24',
      'OPTIONS',
      ADMIN_USERS,
      'access-control-allow-methods includes GET and PATCH (list + set a role)',
      acam.includes('GET') && acam.includes('PATCH'),
      `ACAM=${acam}`,
    );
  }

  // L2-5: and nobody else is. An origin registered nowhere in this estate must
  // come back with NO access-control-allow-origin at all.
  const evilPre = await options(ADMIN_USERS, {
    headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'GET' },
  });
  if (!evilPre.ok) {
    check(AREA, 'L25', 'OPTIONS', ADMIN_USERS, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${evilPre.error}`);
  } else {
    const acao = header(evilPre, 'access-control-allow-origin');
    check(AREA, 'L25', 'OPTIONS', ADMIN_USERS, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }
}
