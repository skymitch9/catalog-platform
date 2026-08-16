/**
 * library.heygabi.ai (`library_catalog/apps/worker`, sibling repo, READ-ONLY
 * reference — nothing in that repo is touched by this suite or by building
 * it). Everything under `/api/*` except `/api/health`, `/api/ingest`, and
 * `/api/machine/audiobook-mapping` sits behind `requireAuth()`
 * (middleware/auth.ts: `if (!identity) return c.json({ error:
 * 'unauthenticated' }, 401)`), including `/api/scan-jobs/*` — the barcode
 * intake route this probe targets. `scanCors()` in routes/scan-jobs.ts is
 * mounted BEFORE that blanket, apex-only, POST+OPTIONS, so the preflight
 * succeeds while the real POST still 401s.
 *
 * The POST probe below sends no body: `requireAuth()` rejects on identity
 * alone, before scan-jobs.ts's zod schema or any D1 write is reached.
 */

import { get, post, options, check, header } from '../lib/kit.mjs';
import { LIBRARY_ORIGIN, APEX_ORIGIN, FOREIGN_ORIGIN } from '../lib/origins.mjs';

const AREA = 'library';

function expectUnauthenticated(id, method, path, r) {
  const url = `${LIBRARY_ORIGIN}${path}`;
  if (!r.ok) {
    check(AREA, id, method, url, 'answers 401 { error: "unauthenticated" }', false, `request failed: ${r.error}`);
    return;
  }
  const ok = r.status === 401 && r.json?.error === 'unauthenticated';
  check(AREA, id, method, url, 'answers 401 { error: "unauthenticated" }', ok, `status=${r.status} body=${JSON.stringify(r.json)}`);
}

export async function probeLibraryWorker() {
  expectUnauthenticated(
    'L1',
    'POST',
    '/api/scan-jobs/barcode',
    await post(`${LIBRARY_ORIGIN}/api/scan-jobs/barcode`, { headers: { 'Content-Type': 'application/json' }, body: '{}' }),
  );
  expectUnauthenticated('L2', 'GET', '/api/scan-jobs', await get(`${LIBRARY_ORIGIN}/api/scan-jobs`));

  const barcodeUrl = `${LIBRARY_ORIGIN}/api/scan-jobs/barcode`;
  const apexPre = await options(barcodeUrl, {
    headers: { Origin: APEX_ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization' },
  });
  if (!apexPre.ok) {
    check(AREA, 'L3', 'OPTIONS', barcodeUrl, `access-control-allow-origin === ${APEX_ORIGIN}`, false, `request failed: ${apexPre.error}`);
    check(AREA, 'L4', 'OPTIONS', barcodeUrl, 'access-control-allow-methods allows POST', false, `request failed: ${apexPre.error}`);
  } else {
    const acao = header(apexPre, 'access-control-allow-origin');
    check(AREA, 'L3', 'OPTIONS', barcodeUrl, `access-control-allow-origin === ${APEX_ORIGIN} (scanCors, apex-only)`, acao === APEX_ORIGIN, `ACAO=${acao}`);
    const acam = (header(apexPre, 'access-control-allow-methods') ?? '').toUpperCase();
    check(AREA, 'L4', 'OPTIONS', barcodeUrl, 'access-control-allow-methods includes POST', acam.includes('POST'), `ACAM=${acam}`);
  }

  const evilPre = await options(barcodeUrl, { headers: { Origin: FOREIGN_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
  if (!evilPre.ok) {
    check(AREA, 'L5', 'OPTIONS', barcodeUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, false, `request failed: ${evilPre.error}`);
  } else {
    const acao = header(evilPre, 'access-control-allow-origin');
    check(AREA, 'L5', 'OPTIONS', barcodeUrl, `no access-control-allow-origin for ${FOREIGN_ORIGIN}`, acao === null, `ACAO=${acao}`);
  }
}
