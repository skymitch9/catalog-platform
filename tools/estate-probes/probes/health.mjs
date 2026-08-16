/**
 * /api/health across all four estate Workers — the one envelope described in
 * `docs/info/health-envelope.md`: `{ ok, service, version?, time, detail }`,
 * additive over each worker's pre-existing shape. `version` is present only
 * where the worker has an APP_VERSION binding (library, games) — see that
 * doc's "Per-worker before → after" table — so it is checked where expected
 * and merely noted where it is legitimately absent, never required
 * everywhere.
 */

import { get, check } from '../lib/kit.mjs';
import { AUTH_ORIGIN, INDEX_ORIGIN, LIBRARY_ORIGIN, GAMES_ORIGIN } from '../lib/origins.mjs';

const TARGETS = [
  { area: 'auth-health', origin: AUTH_ORIGIN, service: 'estate-auth', hasVersion: false },
  { area: 'index-health', origin: INDEX_ORIGIN, service: 'catalog-index', hasVersion: false },
  { area: 'library-health', origin: LIBRARY_ORIGIN, service: 'library-catalog', hasVersion: true },
  { area: 'games-health', origin: GAMES_ORIGIN, service: 'board-game-catalog', hasVersion: true },
];

export async function probeHealth() {
  for (const t of TARGETS) {
    const url = `${t.origin}/api/health`;
    const r = await get(url);

    if (!r.ok) {
      check(t.area, 'H1', 'GET', url, 'answers 200', false, `request failed: ${r.error}`);
      continue;
    }

    check(t.area, 'H1', 'GET', url, 'answers 200', r.status === 200, `status=${r.status}`);

    const body = r.json;
    const envelopeOk =
      r.status === 200 &&
      body !== null &&
      typeof body === 'object' &&
      typeof body.ok === 'boolean' &&
      typeof body.service === 'string' &&
      typeof body.time === 'string' &&
      typeof body.detail === 'object' &&
      body.detail !== null;
    check(
      t.area,
      'H2',
      'GET',
      url,
      'envelope shape { ok, service, time, detail }',
      envelopeOk,
      JSON.stringify(body)?.slice(0, 300) ?? String(body),
    );

    if (envelopeOk) {
      check(t.area, 'H3', 'GET', url, `service === "${t.service}"`, body.service === t.service, `service=${body.service}`);
      check(t.area, 'H4', 'GET', url, 'ok === true', body.ok === true, `ok=${body.ok}`);
      // time must parse as a real instant, roughly now (loose: within a day,
      // catching a stuck/frozen clock without being a flaky exact-second check).
      const t_ms = Date.parse(body.time);
      const withinADay = Number.isFinite(t_ms) && Math.abs(Date.now() - t_ms) < 24 * 60 * 60 * 1000;
      check(t.area, 'H5', 'GET', url, 'time parses to roughly now', withinADay, `time=${body.time}`);
      if (t.hasVersion) {
        check(t.area, 'H6', 'GET', url, 'version present (APP_VERSION bound)', typeof body.version === 'string', `version=${JSON.stringify(body.version)}`);
      }
    }
  }
}
