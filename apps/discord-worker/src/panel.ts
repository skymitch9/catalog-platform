/**
 * **Where GABI's deep links point, and what they carry.**
 *
 * ## ⚠️ THE BUG THIS FILE EXISTS TO END (owner, live, 2026-08-18)
 *
 * Every fixer/panel deep link this Worker emitted pointed at the single
 * hard-coded `GABI_PANEL_URL` — `https://padhard.heygabi.ai`, a relic of the
 * padhard-only pilot, when the panel posture was ON for `friend` and OFF for
 * the main library and that host was genuinely the only place a GABI
 * conversation could happen. It stopped being the only place; the constant did
 * not move. The owner asked, verbatim, *"why is it showing padhard and not the
 * generic site"*.
 *
 * ⚠️ **The right answer is NOT the apex.** `heygabi.ai` is a front door with no
 * panel on it — sending somebody there is the same dead end wearing a friendlier
 * hostname. The right answer is **the asker's own catalog**, resolved from the
 * identity they linked themselves.
 *
 * ⚠️ **THE SAME BUG, HALF A STEP BEHIND — CLOSED 2026-09-05.** The 2026-08-18
 * fix routed *linked* askers correctly and left the FALLBACK where the pilot
 * put it, on the reasoning ~~that the main library's panel was off by decision
 * 8~~. That reasoning had already been false for a day when it was written:
 * `library_catalog` `34f1301` (2026-08-17) turned the main catalog's panel ON
 * for Amber. Measured 2026-09-05, both instances answer `gabi: {"panel": true,
 * "delegated": true, "edge": "full"}`. So an UNLINKED asker — and any Worker
 * with no identity port — no longer lands on Samantha's shelf; the fallback is
 * the main library, which is the estate's default in the table below and a real
 * panel that will ask them to sign in.
 *
 * ## The resolution, and the machinery it reuses
 *
 * Tier 1 already built the only honest way to ask this question: the
 * `discord_links/{id}` document the person created (their own Discord OAuth
 * *and* their own Firebase sign-in), and a `whoami` to each instance that
 * answers what THAT site knows about THAT uid. This file adds no credential, no
 * secret and no second identity system — it takes the same injected
 * `DelegatePort` and reads it, which is why `PanelIdentityPort` is a `Pick` of
 * it rather than a new interface.
 *
 * | What `whoami` says | Where the link points |
 * |---|---|
 * | the capability on exactly one instance | that instance |
 * | the capability on both | **the main library**, the estate's default |
 * | no capability, but an account on one | that instance — it is still *their* site |
 * | no capability, accounts on both | the main library |
 * | unlinked, or nothing could be resolved | **the main library**, and since 2026-09-05 its host is LOOKED UP (see below) rather than typed |
 *
 * ⚠️ **AND THE FALLBACK IS NO LONGER A LITERAL — 2026-09-05, the same day, the
 * other half.** The row above used to end at *"the configured
 * `GABI_PANEL_URL`"*, and `multi-library-survey-2026-09-05.md` §3.4 said so in
 * as many words: *"the hard-coded HOST is fixed … the registry work is NOT done
 * — it is still a literal, not a lookup."* It is a lookup now. With
 * `GABI_PANEL_REGISTRY = "on"`, `resolvePanelBase` reads the main library's
 * `host` from the estate's one directory — `GET {INDEX_BASE_URL}/api/catalogs`,
 * `docs/info/catalog-registry.md` — and the constant is what answers only when
 * that directory does not. ⚠️ Nothing was widened to do it: the route's
 * anonymous branch is names-only, no credential is sent, and no CORS list,
 * origin allowlist or permission was touched.
 *
 * ⚠️ **The unlinked fallback is deliberate and is NOT a dead end.** Somebody
 * with no account anywhere gets **the main library** — the estate's default in
 * the row above, and a real panel that will ask them to sign in — strictly
 * better than the apex, which has nothing to sign in to, and better than the
 * ~~pilot default~~ it replaced, which was a second household's shelf. Flows
 * that already word the `/link` nudge keep wording it; this only decides a URL.
 *
 * ⚠️ **An outage falls back rather than guessing.** A `whoami` that could not be
 * reached is not evidence that the person has no account there, so it never
 * moves the link — it leaves it where it was.
 *
 * ## The prefill
 *
 * The panel half landed 2026-08-18 (`library_catalog` `8745191`, both
 * instances): it reads a question out of the URL, prefills the box, opens
 * itself, and **never sends**. ⚠️ **The parameter is `?gabi=`, NOT the `?q=` the
 * design originally named** — `q` is already the library app's own collection
 * search on `/`, the exact path this link points at, so `?q=` would filter the
 * book list to the question as well: an empty catalogue under a floating panel,
 * the link looking broken at the moment it worked.
 *
 * ## What this file must never become
 *
 * It holds **no credential** (`test/estate-docs.ts`'s seam list includes it),
 * decides **no permission** — the destination site remains the only authority on
 * whether the panel opens — and it is never load-bearing: every failure path
 * returns the static fallback, because a link to the wrong-but-real panel is a
 * small annoyance and a thrown error in a Durable Object's socket handler is a
 * silent nothing.
 */

import type { Env } from './env.js';
import type { DelegatePort, LibraryInstance, WhoAmI } from './delegated.js';
// ⚠️ ONE reader of the estate directory, and it is imported rather than
// re-derived. This file had its OWN fetch, its own memo and its own timeout
// until 2026-09-06, which was fine while it was the only lane; dispatch 3 added
// a second (the shelf list and the ownership words), and two fetches of one
// route is exactly the duplicate the registry exists to end. `indexBase` is
// likewise this Worker's single answer to *"where is the estate index"*. Neither
// carries a credential (`/have`'s own design decision 4) and the estate-docs
// seam guard reads this file's source for credential names — none arrive with
// them.
import {
  baseUrlFromHost,
  loadCatalogs,
  resetCatalogRegistryCache,
  CATALOG_REGISTRY_TTL_MS,
  CATALOG_REGISTRY_TIMEOUT_MS,
  parseCatalogs,
  type CatalogRegistryDeps,
} from './catalog-registry.js';

/** The fallback for somebody the estate cannot place: **the main library**, the
 * same instance this file's own resolution table calls "the estate's default",
 * and a real panel that will ask them to sign in.
 *
 * ⚠️ **CHANGED 2026-09-05**, from `https://padhard.heygabi.ai` — ~~the pilot
 * host, kept because "the main library has the panel off by decision 8"~~. That
 * premise died with `library_catalog` `34f1301` (2026-08-17, *"the main
 * catalog's panel goes ON (owner: for Amber)"*) and nobody moved the constant.
 * Measured 2026-09-05: both `library.heygabi.ai/api/health` and
 * `padhard.heygabi.ai/api/health` answer `gabi: {"panel": true, "delegated":
 * true, "edge": "full"}`, so the fallback no longer has to be somebody else's
 * shelf.
 *
 * ⚠️ Still NOT the apex: `heygabi.ai` runs no panel. */
export const DEFAULT_PANEL_BASE = 'https://library.heygabi.ai';

/**
 * ⚠️ **MEASURED, not chosen**, and re-measured against the DEPLOYED bundle on
 * 2026-08-18 rather than taken from a note. `library.heygabi.ai` and
 * `padhard.heygabi.ai` serve the identical `/assets/index-rvJiy8K2.js`, which
 * contains, minified:
 *
 * ```js
 * const ag = "gabi", V0 = 500;
 * function LD(t) {
 *   const e = new URLSearchParams(t).get(ag);
 *   if (e === null) return null;
 *   const n = e.replace(/\s+/g, " ").trim();
 *   return n ? (n.length > V0 ? n.slice(0, V0).trimEnd() : n) : null;
 * }
 * ```
 *
 * ⚠️ **NOT `?q=`** — that is the library app's own collection search on `/`, the
 * exact path this link points at, so `?q=` would filter the book list to the
 * question as well: an empty catalogue under a floating panel.
 */
export const PANEL_PREFILL_PARAM = 'gabi';

/** The panel's own cap, read off the same bundle (`V0 = 500`). Truncated HERE
 * rather than sent and silently dropped there, so what the link promises and
 * what the box shows are the same thing. */
export const PANEL_PREFILL_MAX = 500;

/** The capability the panel itself is gated on, site-side: it renders when
 * `me.gabiPanel && me.capabilities.includes('runResearch')`. ⚠️ This end can
 * read the second half only; the first is the destination's posture and is
 * never guessed at here. */
const PANEL_CAPABILITY = 'runResearch' as const;

export function panelBase(env: Pick<Env, 'GABI_PANEL_URL'>): string {
  const configured = (env.GABI_PANEL_URL ?? '').trim();
  return configured.length > 0 ? configured : DEFAULT_PANEL_BASE;
}

// ---------------------------------------------------------------------------
// ⚠️ THE REGISTRY — the main library's host, LOOKED UP rather than typed
// ---------------------------------------------------------------------------

/**
 * **The other half of the 2026-09-05 fix, and the half the survey said was NOT
 * done.** `multi-library-survey-2026-09-05.md` §3.4, on this exact line:
 *
 * > ✅ *the hard-coded HOST is fixed* … ⚠️ **The registry work is NOT done — it
 * > is still a literal, not a lookup.**
 *
 * The estate now has one answer to *"which catalogs exist and where do they
 * live"* — `GET https://index.heygabi.ai/api/catalogs`, published from the auth
 * Worker's `estate_catalog` table (`docs/info/catalog-registry.md`). The main
 * library's `host` is a row in it. So the fallback asks, and only falls back to
 * the constant when the answer does not arrive.
 *
 * ## ⚠️ WHAT THIS DOES **NOT** DO
 *
 * - **It widens nothing.** The route is the anonymous, NAMES-ONLY branch — no
 *   CORS mount is involved (this is a Worker, not a browser), no bearer is
 *   sent, no origin list is touched and no permission is decided. A hostname is
 *   the whole payload.
 * - **It never decides whether the panel opens.** That was always the
 *   destination site's own Firebase sign-in and role check, and it still is.
 * - **It cannot make a link worse than it was.** Every failure path returns
 *   `panelBase(env)`, which is the value this file shipped with.
 *
 * ## ⚠️ AFFIRMATIVE-ONLY, AND IT SHIPS ON
 *
 * `GABI_PANEL_REGISTRY = "on"` and nothing else. Every typo, and absence, means
 * OFF — and OFF is byte-for-byte the pre-registry behaviour: no subrequest, no
 * cache, `panelBase(env)` and nothing more. That is also **the backout and the
 * pin**: an operator who wants this bot's links nailed to one host sets the
 * posture off and `GABI_PANEL_URL` to the host they mean. The same shape
 * `mentionsOn`, `moderationOn` and `delegatedWritesOn` use, for the same
 * reason.
 *
 * ⚠️ **The posture is why a unit test makes no network call.** Nothing here
 * fetches unless somebody wrote the word `on`, so the whole suite runs with the
 * registry lane dark unless a test opts in and injects a `fetch`.
 */
export function panelRegistryOn(env: Pick<Env, 'GABI_PANEL_REGISTRY'>): boolean {
  return (env.GABI_PANEL_REGISTRY ?? '').trim().toLowerCase() === 'on';
}

/** The registry id of the estate's default library — the one this file's own
 * resolution table calls *"the main library"*, and the same id
 * `delegated.ts`'s `LibraryInstance.app` uses. ⚠️ NOT `library2`: that is
 * Samantha's shelf, and sending an unplaceable stranger there is the bug this
 * whole file was written to end. */
export const MAIN_LIBRARY_CATALOG_ID = 'library';

/** ⚠️ **Ten minutes, matching the registry's OWN cache TTL** (`catalog-registry.md`
 * §8), so the estate has one number to remember rather than two. A label or a
 * host edited in D1 can therefore take up to twenty minutes to reach a link —
 * fine for a hostname, and the reason §8 says outright never to put a
 * permission behind this cache. */
export const PANEL_REGISTRY_TTL_MS = CATALOG_REGISTRY_TTL_MS;

/** ⚠️ **A hard ceiling, because this sits in front of a person waiting for a
 * message.** The link is the useful half of the reply, not the reply; a
 * directory that is slow must cost a fallback, never a turn. */
export const PANEL_REGISTRY_TIMEOUT_MS = CATALOG_REGISTRY_TIMEOUT_MS;

/** What a caller may inject. Both exist for tests; production passes neither.
 *  ⚠️ Now an alias of the shared client's own deps — one seam, so a test that
 *  stubs the directory stubs it for every lane that reads it. */
export type PanelRegistryDeps = CatalogRegistryDeps;

/** Tests only. Production never calls it — the memo's whole point is to survive.
 *  ⚠️ It resets the SHARED memo (`catalog-registry.ts`), because there is one
 *  copy of the directory in this Worker and a test that cleared only half of it
 *  would pass while leaving the other lane holding yesterday's answer. */
export function resetPanelRegistryCache(): void {
  resetCatalogRegistryCache();
}

/**
 * The main library's base URL according to the estate registry, or `null`.
 *
 * ⚠️ **`null` means "the registry did not say", and that is NOT the same fact
 * as "the main library is somewhere else".** It never becomes a host, never
 * becomes an empty string and never throws — the same distinction `whoami`'s
 * `null` draws two sections down, and for the same reason.
 *
 * ⚠️ **Validated, not trusted**, even though the far end is our own Worker: a
 * partially-deployed estate is a normal state, and a malformed `host` that
 * reached a Discord message would be a link somebody clicks. `id` must match
 * exactly, `host` must be a non-empty string with no scheme and no slash, and
 * the assembled `https://host` must parse as a URL.
 */
export async function registryPanelBase(
  env: Pick<Env, 'INDEX_BASE_URL'>,
  deps: PanelRegistryDeps = {},
): Promise<string | null> {
  const catalogs = await loadCatalogs(env, deps);
  if (!catalogs) return null;
  const row = catalogs.find((c) => c.id === MAIN_LIBRARY_CATALOG_ID);
  return row ? baseUrlFromHost(row.host) : null;
}

/**
 * The `library` row's host, as a base URL — pure, so every shape of a bad
 * answer is exercised with no network.
 *
 * ⚠️ **The validation moved to `catalog-registry.ts` and did not change.** A
 * bare hostname is the registry's contract (`library.heygabi.ai`); anything
 * carrying a scheme, a slash, a port, a space or a credential marker is refused
 * rather than repaired, because a "fixed" host is a guess and this one ends up
 * in a link a person presses. ⚠️ **A malformed ROW now refuses the whole
 * answer** rather than only its own — the shared parser's rule, and the safer
 * direction: half a directory is how a shelf disappears from a menu silently.
 */
export function mainLibraryBaseFrom(body: unknown): string | null {
  const catalogs = parseCatalogs(body);
  const row = catalogs?.find((c) => c.id === MAIN_LIBRARY_CATALOG_ID);
  return row ? baseUrlFromHost(row.host) : null;
}

/**
 * ⚠️ **THE FALLBACK EVERY SURFACE SHOULD BUILD ITS LINK FROM.** Registry first
 * when the posture is on, `panelBase(env)` — the configured var, else the
 * constant — whenever it is off or the directory did not answer.
 *
 * `panelBase` remains for callers that must be synchronous and for the pin's
 * own meaning; this is the resolved truth, and `/api/health` reports THIS one
 * so the row and the link cannot disagree.
 */
export async function resolvePanelBase(
  env: Pick<Env, 'GABI_PANEL_URL' | 'GABI_PANEL_REGISTRY' | 'INDEX_BASE_URL'>,
  deps: PanelRegistryDeps = {},
): Promise<string> {
  if (!panelRegistryOn(env)) return panelBase(env);
  return (await registryPanelBase(env, deps)) ?? panelBase(env);
}

/**
 * The link into the panel, optionally carrying the question that produced it.
 *
 * ⚠️ **The prefill argument is OPTIONAL and must stay optional.** `GET
 * /api/health` reports this function's output as `gabi_panel_url` and has no
 * question to give it; a required argument would turn a health row into a lie
 * or a crash.
 *
 * ⚠️ **The normalisation MIRRORS the panel's own reader, step for step** — the
 * measured `replace(/\s+/g, ' ')`, `trim()`, `slice(0, 500)`, `trimEnd()`. That
 * is deliberate: doing it here means the URL a person can see in Discord is
 * character-for-character what the box will hold, instead of a longer string
 * that quietly shrinks on arrival. Empty or whitespace-only yields the bare
 * link rather than a dangling `?gabi=`.
 */
export function panelDeepLink(base: string, prefill?: string): string {
  const root = `${base.replace(/\/+$/, '')}/`;
  const text = (prefill ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PANEL_PREFILL_MAX)
    .trimEnd();
  if (!text) return root;
  return `${root}?${PANEL_PREFILL_PARAM}=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------------------
// Whose panel is it
// ---------------------------------------------------------------------------

/**
 * ⚠️ **A `Pick` of `DelegatePort`, deliberately.** Resolving a link is a READ,
 * and it must be impossible to reach a write verb through the thing that does
 * it. The two methods here are the two `delegated-exec.ts` already implements —
 * this file constructs neither and holds no secret.
 */
export type PanelIdentityPort = Pick<DelegatePort, 'linkedUid' | 'whoami'>;

/** One `whoami` answer per instance. `null` = that site could not be reached,
 * which is NOT the same fact as "it does not know you" and never collapses into
 * it (`delegated.ts`'s `chooseInstances` makes the same distinction for
 * writes). */
export interface PanelAnswer {
  instance: LibraryInstance;
  who: WhoAmI | null;
}

/**
 * Which base the answers point at. Pure, so the whole table in this file's
 * header is exercised with no network.
 *
 * ⚠️ **Capability first, account second.** Somebody with `runResearch` on one
 * shelf and a bare account on the other should land where the panel will
 * actually open for them. Only when nobody can research does an account alone
 * decide it — and that is still better than the static fallback, because it is
 * at least *their* site.
 */
export function choosePanelBase(answers: readonly PanelAnswer[], fallbackBase: string): string {
  const known = answers.filter((a) => a.who !== null && a.who.known === true);
  const able = known.filter((a) => a.who!.capabilities?.[PANEL_CAPABILITY] === true);
  const pick = able.length > 0 ? able : known;

  if (pick.length === 0) return fallbackBase;
  if (pick.length === 1) return pick[0]!.instance.baseUrl;

  // ⚠️ A TIE GOES TO THE MAIN LIBRARY, and this is the one place this file
  // makes a choice rather than reading one. It is the opposite decision from
  // Tier 1's, on purpose: a WRITE to the wrong shelf is a tidy-up somebody has
  // to notice first, so that path ASKS. A LINK to the wrong shelf costs one
  // click, so asking would be four words of ceremony for nothing.
  const main = pick.find((a) => a.instance.app === 'library');
  return (main ?? pick[0]!).instance.baseUrl;
}

/**
 * Ask both shelves about one uid and decide. ⚠️ Parallel — the questions are
 * independent, and serialising them would double the wait for nothing.
 *
 * Never throws: a resolution that fails returns the fallback, because the link
 * is the useful half of every message that carries one.
 */
export async function resolveAskerPanelBase(
  port: PanelIdentityPort,
  instances: readonly LibraryInstance[],
  uid: string,
  fallbackBase: string,
): Promise<string> {
  if (instances.length === 0) return fallbackBase;
  try {
    const answers = await Promise.all(
      instances.map(async (instance) => ({ instance, who: await port.whoami(instance, uid) })),
    );
    return choosePanelBase(answers, fallbackBase);
  } catch (err) {
    console.error('GABI panel: whoami failed while resolving a deep link:', err instanceof Error ? err.message : err);
    return fallbackBase;
  }
}

// ---------------------------------------------------------------------------
// The per-turn resolver
// ---------------------------------------------------------------------------

/** Build a link for this turn, carrying `prefill`. */
export type PanelLink = (prefill?: string) => Promise<string>;

/** What a surface must hand over to get an asker-aware link. `null` means it
 * has no identity port at all — a test, or a Worker whose Tier-1 wiring is
 * absent — and the static fallback is then the whole answer. */
export interface PanelIdentity {
  port: PanelIdentityPort;
  instances: readonly LibraryInstance[];
  discordUserId: string;
}

/**
 * ⚠️ **MEMOISED FOR THE TURN, and that is the subrequest discipline.** A single
 * answer can emit the link more than once, and a conversational turn already
 * spends a link read, a shelf search, a model call and up to two tool calls. The
 * resolution costs **1 link read + 2 `whoami`** and is paid at most once per
 * turn — and only when a link is actually built, because the two hot paths
 * (`fix_request` and a failed model turn) are the only ones that call it.
 *
 * ⚠️ The memo caches the BASE, not the finished link: the same turn can ask for
 * two different prefills and must not pay twice for the same identity.
 */
export function panelLinkFor(identity: PanelIdentity | null, fallbackBase: string): PanelLink {
  let base: Promise<string> | null = null;
  const resolve = (): Promise<string> => {
    if (!base) base = resolveBase(identity, fallbackBase);
    return base;
  };
  return async (prefill?: string) => panelDeepLink(await resolve(), prefill);
}

async function resolveBase(identity: PanelIdentity | null, fallbackBase: string): Promise<string> {
  if (!identity) return fallbackBase;
  try {
    const link = await identity.port.linkedUid(identity.discordUserId);
    // ⚠️ Unlinked and outage BOTH fall back, and for once they deserve the same
    // treatment: this decides a URL, not a sentence. The flows that must tell
    // those two states apart still do, in their own words.
    if (!link.ok) return fallbackBase;
    return await resolveAskerPanelBase(identity.port, identity.instances, link.uid, fallbackBase);
  } catch (err) {
    console.error('GABI panel: the asker could not be resolved:', err instanceof Error ? err.message : err);
    return fallbackBase;
  }
}
