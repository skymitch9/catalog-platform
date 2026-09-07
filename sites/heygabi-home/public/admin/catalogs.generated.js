/**
 * catalogs.generated.js — GENERATED. DO NOT EDIT.
 *
 * Written by `node scripts/gen-admin-catalogs.mjs` from
 * packages/estate-auth/src/visibility.ts, which is the ONE copy of the estate's
 * catalog vocabulary. Kept honest by
 * scripts/test/admin-catalogs-generated-parity.test.mjs, which regenerates this
 * in memory and diffs it — so a hand edit here fails `npm test`, and `npm test`
 * runs before every deploy of this site.
 *
 * ⚠️ THIS IS A BUILD-TIME SYNC, NOT A RUNTIME FETCH, and the difference is a
 * security property rather than a preference. /admin is a PERMISSIONS surface:
 * this array decides which visibility grants render. The estate registry
 * (`GET /api/catalogs`) is a NAME service cached ten minutes upstream, so
 * driving the checkbox set from it would let a stale or unreachable directory
 * silently remove an admin's ability to grant or revoke a catalog — an access
 * surface failing closed on a cache miss. Names may come from the network;
 * a permissions vocabulary may not.
 *
 * ⚠️ ORDER IS LOAD-BEARING and is §4.5's canonical order: it is the order the
 * checkboxes render in AND the order the visibility array is POSTED in. New
 * catalogs append at the END; existing entries never move.
 *
 * To add a catalog: edit packages/estate-auth/src/visibility.ts
 * (plus its `vis_<id>` migration on the auth Worker), then run
 * `node scripts/gen-admin-catalogs.mjs` and commit BOTH files.
 */

export const CATALOGS = [
  'audiobook',
  'library',
  'games',
  'library2',
  'ebooks',
];
