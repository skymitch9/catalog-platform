/**
 * `GET /api/catalogs` — THE ESTATE'S ONE ANSWER TO *"which catalogs exist, what
 * is each called, and who owns it"*, republished from the auth Worker's
 * registry (`estate-catalog.ts`, migration 0020).
 *
 * Owner ask, 2026-09-05 15:50 Phoenix, confirmed 15:58: *"Make sure everything
 * we have that's in the estate connects to multiple libraries and make sure
 * that the libraries are designated by who owns the physical or shared with
 * digital works."*
 *
 * Design: docs/info/catalog-registry.md. Survey: §2 F1/F2 (the constants and
 * the SEVEN disagreeing label maps this replaces), §4 (why the registry is a
 * migration and not derivable), §10 dispatch 1.
 *
 * ## 🔴 THE ACCESS RULE, AND IT IS THE WHOLE DESIGN OF THIS FILE
 *
 * Owner decision, 2026-09-05 16:14, asked and answered: **"yes name only"**.
 *
 * - **An anonymous caller gets NAMES ONLY** — `{id, push_source, kind, label,
 *   owner, holding, shared, host}`. That is what the apex search box needs
 *   BEFORE anybody signs in, and it is the entire anonymous answer.
 * - **NEVER, for an anonymous caller: a count, a title, a freshness stamp, or
 *   anything else derived from a row on anybody's shelf.** This route does not
 *   even OPEN the database for an anonymous caller — the D1 query below is
 *   inside the member branch, so the rule is enforced by control flow rather
 *   than by remembering to strip a field.
 * - **A signed-in member gets counts for the catalogs their own visibility set
 *   admits, and for no others.** `rows`/`pushed_at` appear per catalog, keyed
 *   on the same `visibility` array `/api/search` scopes its SQL to. A member
 *   with no `vis_library2` grant sees Samantha's shelf NAMED and never counted.
 *
 * ⚠️ Nothing here widens `vis_library2`. Her ROWS are reachable exactly where
 * they were before this file existed — search, scoped; lookup, fenced
 * (`read.ts` UNSCOPED_LOOKUP_EXCLUDED, owner decision 16:08 "keep it fenced").
 *
 * ⚠️ `/api/health` REMAINS OPEN AND STILL REPORTS PER-SOURCE COUNTS, including
 * `library2`'s, and that is NOT changed here. It predates this route, the
 * estate Health page reads it, and narrowing it is an owner decision about a
 * different surface — recorded in docs/info/catalog-registry.md rather than
 * done quietly as a side effect of an unrelated build. The two surfaces
 * therefore disagree about how coy they are; this one is the stricter, and the
 * owner's "name only" is about THIS one, which is the one a stranger's browser
 * calls.
 *
 * ## ⚠️ Why the registry is FETCHED and not held here
 *
 * One fact, one home. The auth Worker owns the table (it is the Worker that
 * owns `vis_` columns, membership and the provisioning queue); this Worker
 * caches and publishes. A local copy of the five catalogs would be a second
 * registry that drifts, which is finding F2 in a new costume.
 *
 * ⚠️ AND THERE IS NO HARD-CODED FALLBACK LIST, deliberately. "The directory is
 * unreachable" and "these are the catalogs" are different facts; a fallback
 * that answered the second would make an outage invisible and could serve a
 * label the owner corrected months ago. What this does instead is serve the
 * LAST GOOD copy and SAY it is stale (`stale: true`, `fetched_at`), which is a
 * measurement with an age rather than a guess wearing a measurement's clothes.
 *
 * ## Service-to-service auth: NO NEW SECRET
 *
 * The upstream call presents `ESTATE_APP_TOKEN_INDEX` — the bearer this Worker
 * already holds for `POST /api/estate/seen`, whose matching value already lives
 * on `estate-auth`. Same credential, same pair, nothing minted.
 */

import { Hono } from 'hono';
import type { Catalog } from '@platform/estate-auth';
import type { Env } from './env.js';
import { searchScope, type ScopeVariables } from './middleware/scope.js';

/* ------------------------------------------------------------------ *
 * The upstream shape
 * ------------------------------------------------------------------ */

/** One catalog exactly as the auth Worker's registry answers it. */
export interface RegistryCatalog {
  id: string;
  push_source: string | null;
  kind: string;
  label: string;
  owner: string | null;
  holding: string;
  shared: boolean;
  host: string;
}

/**
 * ⚠️ VALIDATED, NOT TRUSTED, even though the far end is our own Worker. A
 * partially-deployed estate is a normal state here (the auth Worker ships
 * ahead of, or behind, this one by minutes), and a malformed entry that reached
 * the wire would be rendered as a label on the estate's front door. Unknown
 * KEYS are kept — the registry is expected to grow fields and an older index
 * Worker must pass them through rather than silently truncating tomorrow's
 * schema — but the eight that must be present and well-typed are checked.
 */
export function parseRegistry(body: unknown): RegistryCatalog[] | null {
  if (body === null || typeof body !== 'object') return null;
  const list = (body as { catalogs?: unknown }).catalogs;
  if (!Array.isArray(list)) return null;
  const out: RegistryCatalog[] = [];
  for (const raw of list) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const c = raw as Record<string, unknown>;
    if (typeof c.id !== 'string' || !c.id) return null;
    if (typeof c.label !== 'string' || !c.label) return null;
    if (typeof c.host !== 'string' || !c.host) return null;
    if (typeof c.kind !== 'string' || !c.kind) return null;
    if (c.holding !== 'physical' && c.holding !== 'digital') return null;
    if (typeof c.shared !== 'boolean') return null;
    if (c.owner !== null && typeof c.owner !== 'string') return null;
    if (c.push_source !== null && typeof c.push_source !== 'string') return null;
    out.push({
      ...(c as unknown as RegistryCatalog),
      id: c.id,
      push_source: c.push_source,
      kind: c.kind,
      label: c.label,
      owner: c.owner,
      holding: c.holding,
      shared: c.shared,
      host: c.host,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The cache
 * ------------------------------------------------------------------ */

/**
 * ⚠️ ISOLATE-LOCAL AND ON PURPOSE — no D1 table, no KV, no new binding.
 *
 * The registry is five rows that change when somebody provisions a catalog,
 * which is a ten-step manual job measured in days. A per-isolate memo with a
 * ten-minute freshness window (the same TTL the estate's `/seen` cache uses, so
 * there is one number to remember, not two) collapses essentially every request
 * to zero subrequests, and the worst case of a cold isolate is one fetch to a
 * Worker in the same account.
 *
 * ⚠️ The consequence, said out loud: **a label edited in D1 can take up to ten
 * minutes to appear**, and different isolates can disagree during that window.
 * That is acceptable for a name and unacceptable for a permission — which is
 * why permissions are not served from here and never should be.
 */
export const REGISTRY_TTL_MS = 10 * 60 * 1000;

interface CachedRegistry {
  catalogs: RegistryCatalog[];
  /** When the upstream answer that produced this was received. */
  fetchedAt: number;
}

let cached: CachedRegistry | null = null;

/** Test seam only — never called by a route. */
export function __resetRegistryCache(): void {
  cached = null;
}

export type RegistryResult =
  | { ok: true; catalogs: RegistryCatalog[]; fetchedAt: number; stale: boolean }
  | { ok: false; reason: 'unconfigured' | 'upstream'; detail: string; fix?: string };

/**
 * The registry, from cache or from the directory.
 *
 * ⚠️ A REFRESH FAILURE WITH A CACHE IN HAND IS NOT A FAILURE — it serves the
 * last good copy and marks it `stale`. A refresh failure with NO cache is
 * reported as an outage, in words, and NEVER as an empty list: `[]` would say
 * "the estate has no catalogs", which is a confident false statement of exactly
 * the kind the owner's rule is about.
 */
export async function loadRegistry(env: Env, now = Date.now()): Promise<RegistryResult> {
  if (cached && now - cached.fetchedAt < REGISTRY_TTL_MS) {
    return { ok: true, catalogs: cached.catalogs, fetchedAt: cached.fetchedAt, stale: false };
  }

  const baseUrl = env.ESTATE_AUTH_URL;
  const appToken = env.ESTATE_APP_TOKEN_INDEX;
  if (!baseUrl || !appToken) {
    if (cached) return { ok: true, catalogs: cached.catalogs, fetchedAt: cached.fetchedAt, stale: true };
    return {
      ok: false,
      reason: 'unconfigured',
      detail:
        'This service is not yet wired to the estate directory, so it cannot say which catalogs exist. ' +
        'That is our configuration, not a decision about you, and nothing you can fix from here.',
      fix: 'set ESTATE_AUTH_URL in wrangler.toml [vars] and `wrangler secret put ESTATE_APP_TOKEN_INDEX`',
    };
  }

  let parsed: RegistryCatalog[] | null = null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/estate/catalogs`, {
      headers: { authorization: `Bearer ${appToken}` },
    });
    if (res.ok) parsed = parseRegistry(await res.json());
  } catch {
    parsed = null;
  }

  if (parsed) {
    cached = { catalogs: parsed, fetchedAt: now };
    return { ok: true, catalogs: parsed, fetchedAt: now, stale: false };
  }

  if (cached) {
    // ⚠️ The stale copy's OWN age is kept, not refreshed to `now`. A failed
    // refresh that stamped the cache would make an unreachable directory look
    // like a perpetually fresh one — the silent-staleness trap, exactly.
    return { ok: true, catalogs: cached.catalogs, fetchedAt: cached.fetchedAt, stale: true };
  }

  return {
    ok: false,
    reason: 'upstream',
    detail:
      'The estate directory did not answer, so we cannot list the catalogs right now. That is an ' +
      'outage on our side, not a permissions problem — nothing is wrong with your account and there ' +
      'is nothing to sign in to. Try again shortly.',
  };
}

/* ------------------------------------------------------------------ *
 * Counts — members only, and only in scope
 * ------------------------------------------------------------------ */

export interface SourceCount {
  rows: number;
  pushed_at: string | null;
}

/** Rows and MAX(pushed_at) per `entry.source`, the same shape /api/health reads. */
export async function readCounts(db: D1Database): Promise<Map<string, SourceCount>> {
  const { results } = await db
    .prepare('SELECT source, COUNT(*) AS rows, MAX(pushed_at) AS pushed_at FROM entry GROUP BY source')
    .all<{ source: string; rows: number; pushed_at: string | null }>();
  return new Map((results ?? []).map((r) => [r.source, { rows: r.rows, pushed_at: r.pushed_at }]));
}

/**
 * The wire row for one catalog, given who is asking.
 *
 * ⚠️ THE COUNT KEYS ARE ABSENT, NOT NULL, WHEN THEY ARE NOT PERMITTED — and the
 * distinction is load-bearing. `rows: null` says "we looked and there is no
 * number", which a renderer reasonably prints as "0 items" or "unknown"; the
 * key being absent says "this answer does not carry counts", which is the true
 * statement. agent-board-contract.md's rule, applied: **a missing number is not
 * zero**, and it is not null either.
 */
export function catalogWire(
  cat: RegistryCatalog,
  opts: { counts: Map<string, SourceCount> | null; visibility: readonly Catalog[] },
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...cat };
  if (!opts.counts) return base;
  // Scope check on the VISIBILITY id, never on the push source: the two
  // vocabularies differ (games↔game) and the grant is keyed on the first.
  if (!opts.visibility.includes(cat.id as Catalog)) return base;
  // ⚠️ `ebooks` has no source of its own — its rows ride `audiobook` with
  // format='ebook' — so there is no honest per-catalog count for it and none is
  // invented. Reporting the audiobook source's total here would tell a member
  // the shared ebook shelf holds 1,251 things, which is the audiobook count.
  if (cat.push_source === null) return base;
  const c = opts.counts.get(cat.push_source);
  return { ...base, rows: c?.rows ?? 0, pushed_at: c?.pushed_at ?? null };
}

/* ------------------------------------------------------------------ *
 * The route
 * ------------------------------------------------------------------ */

export const catalogsRoutes = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

/**
 * ⚠️ `searchScope()`, NOT `requireEstateMember()`. This route must answer the
 * anonymous internet — the apex search box needs labels before sign-in — so it
 * takes `/api/search`'s stance: the middleware never refuses, it resolves every
 * caller (stranger, pending, revoked, member, owner) to a visibility set, and
 * the handler decides what that set is allowed to see.
 */
catalogsRoutes.use('*', searchScope());

catalogsRoutes.get('/', async (c) => {
  const registry = await loadRegistry(c.env);
  if (!registry.ok) {
    // ⚠️ A PERSON MUST NEVER SEE A BARE STATUS. Both branches say what happened,
    // that it is not about them, and what would fix it — and 503 rather than 500
    // because the shape of the failure is "not available right now", which is
    // what a client should retry.
    return c.json(
      { error: registry.reason === 'unconfigured' ? 'registry_unconfigured' : 'registry_unavailable', detail: registry.detail, ...(registry.fix ? { fix: registry.fix } : {}) },
      503,
    );
  }

  const email = c.get('email');
  const visibility = c.get('visibility') ?? [];

  // 🔴 THE ANONYMOUS BRANCH NEVER TOUCHES D1. The owner's "name only" is
  // enforced here, by control flow — there is no code path on which an
  // anonymous request reads a row count and then forgets to drop it.
  const counts = email === null ? null : await readCounts(c.env.DB);

  const body = {
    ok: true,
    catalogs: registry.catalogs.map((cat) => catalogWire(cat, { counts, visibility })),
    /**
     * What kind of answer this is, said plainly so a client never has to infer
     * it from a missing key: `none` = names only (an anonymous caller), `scoped`
     * = counts for the catalogs this member's own grants admit, and no others.
     */
    counts: counts === null ? 'none' : 'scoped',
    /** When the registry itself was last read from the directory. */
    fetched_at: new Date(registry.fetchedAt).toISOString(),
    /**
     * ⚠️ TRUE MEANS THE DIRECTORY COULD NOT BE REACHED ON THIS REFRESH and the
     * names below are the last good copy. Said on the wire rather than only in
     * a log, because a consumer rendering a stale label should be able to know.
     */
    stale: registry.stale,
    time: new Date().toISOString(),
  };

  // ⚠️ THE MEMBER ANSWER IS `no-store` AND THE ANONYMOUS ONE IS CACHEABLE, and
  // the asymmetry is the safe direction. Both answers live at the same URL, so
  // a shared cache that stored the member copy could hand another caller counts
  // they do not hold a grant for; `no-store` makes that impossible. The reverse
  // — a member served the cached anonymous copy — costs them the counts and
  // leaks nothing. `Vary: Authorization` states the dependency for any cache
  // that honours it; the `no-store` is what does not depend on that.
  c.header('Cache-Control', counts === null ? 'public, max-age=300' : 'private, no-store');
  c.header('Vary', 'Authorization');
  return c.json(body);
});
