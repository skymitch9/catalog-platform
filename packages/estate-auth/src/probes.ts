/**
 * The §8.2 conformance checklist as EXECUTABLE checks. "The probes are the
 * deliverable" — a site failing open is caught by running them, and they take
 * about a minute per site.
 *
 * Eight items, always all eight reported. Items that need a credential a
 * machine cannot mint (a real token from another project, a fresh Google
 * sign-in, the Firebase console) run when the caller supplies the material
 * and report `skipped` with the reason otherwise — a skipped probe is
 * VISIBLE, never silently green.
 */

export interface ProbeRoute {
  method?: string;
  path: string;
}

export interface ProbeTarget {
  /** e.g. http://127.0.0.1:8799 or https://library.heygabi.ai */
  baseUrl: string;
  /**
   * Data routes that must ALL answer 401 with no token (§8.2 #3's blanket
   * middleware). List every mounted route family — the probe is only as
   * strong as this list.
   */
  protectedRoutes: ProbeRoute[];
  /** Routes open by design (health) — must answer 2xx tokenless. */
  openRoutes?: ProbeRoute[];
  /**
   * Machine routes with their own bearer tokens (ingest, push, /seen) —
   * mounted before the blanket by name. Must NOT answer 2xx tokenless.
   */
  machineRoutes?: ProbeRoute[];
  /** A real, valid ID token minted by a DIFFERENT Firebase project (§8.2 #2). */
  wrongProjectToken?: string;
  /** A real token whose email is unverified (§8.2 #2, second leg). */
  unverifiedEmailToken?: string;
  /** A real token for a fresh (pending) user, to prove zero capabilities (§8.2 #4). */
  pendingUserToken?: string;
  fetchImpl?: typeof fetch;
}

export interface ProbeResult {
  id: string;
  title: string;
  outcome: 'pass' | 'fail' | 'skipped';
  detail: string;
}

async function status(
  fetchImpl: typeof fetch,
  baseUrl: string,
  route: ProbeRoute,
  headers?: Record<string, string>,
): Promise<number> {
  const resp = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}${route.path}`, {
    method: route.method ?? 'GET',
    headers,
    redirect: 'manual',
  });
  // Read the body so undici does not leak the connection.
  await resp.text().catch(() => undefined);
  return resp.status;
}

export async function runConformanceProbes(t: ProbeTarget): Promise<ProbeResult[]> {
  const f = t.fetchImpl ?? fetch;
  const results: ProbeResult[] = [];
  const first = t.protectedRoutes[0];

  // #1 — Firebase authorised domains: console-only, never probeable.
  results.push({
    id: '8.2#1',
    title: 'host on *.heygabi.ai; Firebase authorised domain only if sign-in runs there',
    outcome: 'skipped',
    detail: 'Owner console fact. Missed = auth/unauthorized-domain on first sign-in.',
  });

  // #2 — local verification, iss+aud pin, unverified-email refusal.
  {
    const legs: string[] = [];
    let ok = true;
    if (first) {
      const garbage = await status(f, t.baseUrl, first, {
        Authorization: 'Bearer not-a-token-at-all',
      });
      legs.push(`garbage token → ${garbage}`);
      if (garbage !== 401) ok = false;
    }
    if (t.wrongProjectToken && first) {
      const s = await status(f, t.baseUrl, first, {
        Authorization: `Bearer ${t.wrongProjectToken}`,
      });
      legs.push(`other-project token → ${s}`);
      if (s !== 401) ok = false;
    } else {
      legs.push('other-project token: skipped (none supplied)');
    }
    if (t.unverifiedEmailToken && first) {
      const s = await status(f, t.baseUrl, first, {
        Authorization: `Bearer ${t.unverifiedEmailToken}`,
      });
      legs.push(`unverified-email token → ${s}`);
      if (s !== 401) ok = false;
    } else {
      legs.push('unverified-email token: skipped (none supplied)');
    }
    results.push({
      id: '8.2#2',
      title: 'tokens verified locally; iss+aud pinned; unverified emails refused',
      outcome: first ? (ok ? 'pass' : 'fail') : 'skipped',
      detail: legs.join('; '),
    });
  }

  // #3 — blanket requireAuth: every data route tokenless → 401; open routes
  // 2xx; machine routes never 2xx tokenless.
  {
    const bad: string[] = [];
    for (const r of t.protectedRoutes) {
      const s = await status(f, t.baseUrl, r);
      if (s !== 401) bad.push(`${r.method ?? 'GET'} ${r.path} → ${s} (want 401)`);
    }
    for (const r of t.openRoutes ?? []) {
      const s = await status(f, t.baseUrl, r);
      if (s < 200 || s >= 300) bad.push(`${r.method ?? 'GET'} ${r.path} → ${s} (want 2xx, open by design)`);
    }
    for (const r of t.machineRoutes ?? []) {
      const s = await status(f, t.baseUrl, r);
      if (s >= 200 && s < 300) bad.push(`${r.method ?? 'GET'} ${r.path} → ${s} (machine route served tokenless)`);
    }
    results.push({
      id: '8.2#3',
      title: 'blanket auth before any route; named machine routes and health only exceptions',
      outcome: bad.length === 0 ? 'pass' : 'fail',
      detail:
        bad.length === 0
          ? `${t.protectedRoutes.length} protected, ${(t.openRoutes ?? []).length} open, ${(t.machineRoutes ?? []).length} machine routes behaved`
          : bad.join('; '),
    });
  }

  // #4 — pending maps to zero capabilities.
  if (t.pendingUserToken && first) {
    const bad: string[] = [];
    for (const r of t.protectedRoutes) {
      const s = await status(f, t.baseUrl, r, { Authorization: `Bearer ${t.pendingUserToken}` });
      if (s !== 403) bad.push(`${r.method ?? 'GET'} ${r.path} → ${s} (want 403 for pending)`);
    }
    results.push({
      id: '8.2#4',
      title: 'fresh sign-in is pending; pending has zero capabilities',
      outcome: bad.length === 0 ? 'pass' : 'fail',
      detail: bad.length === 0 ? 'every capability route 403 for the pending token' : bad.join('; '),
    });
  } else {
    results.push({
      id: '8.2#4',
      title: 'fresh sign-in is pending; pending has zero capabilities',
      outcome: 'skipped',
      detail: 'Needs a real pending-user token (pendingUserToken not supplied).',
    });
  }

  // #5 — the estate call + §3.1 semantics. Orchestrated (revoke a test user,
  // stop the auth Worker), so never generically probeable from here.
  results.push({
    id: '8.2#5',
    title: '/seen per §5.2; §3.1 applied incl. fail-closed for non-standing when estate unreachable',
    outcome: 'skipped',
    detail:
      'Orchestrated probe: revoked test user → 403 within TTL; auth Worker stopped → standing user served, fresh user refused estate_unreachable. Module unit tests pin the combination table itself.',
  });

  // #6 — OWNER_EMAILS break-glass.
  results.push({
    id: '8.2#6',
    title: 'OWNER_EMAILS break-glass set and working',
    outcome: 'skipped',
    detail: 'Needs the owner to sign in. Probe: listed email lands with owner standing.',
  });

  // #7 — rate limiting on the unauthenticated surface.
  results.push({
    id: '8.2#7',
    title: 'rate limiting on the unauthenticated surface',
    outcome: 'skipped',
    detail:
      'RATE_LIMITER is a production binding (absent in dev, fails open by design). Verify the binding exists in wrangler.toml and the middleware is mounted.',
  });

  // #8 — dev bypass shape + production ENVIRONMENT. Half is a file read; the
  // probeable half is "deployed host with no token → 401", which #3 covers.
  results.push({
    id: '8.2#8',
    title: "dev bypass is ENVIRONMENT === 'development' + DEV_EMAIL; production toml sets ENVIRONMENT explicitly",
    outcome: 'skipped',
    detail:
      'Read the wrangler.toml (config fact). The runtime half — deployed host tokenless → 401 — is #3 run against production.',
  });

  return results;
}

/** True when no probe FAILED (skips are visible but not failures). */
export function probesPassed(results: readonly ProbeResult[]): boolean {
  return results.every((r) => r.outcome !== 'fail');
}
