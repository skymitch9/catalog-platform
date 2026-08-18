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
 * | unlinked, or nothing could be resolved | the configured `GABI_PANEL_URL` |
 *
 * ⚠️ **The unlinked fallback is deliberate and is NOT a dead end.** Somebody
 * with no account anywhere gets the pilot default, which is a real panel that
 * will ask them to sign in — strictly better than the apex, which has nothing to
 * sign in to. Flows that already word the `/link` nudge keep wording it; this
 * only decides a URL.
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

/** Where the pilot pointed, and still the fallback for somebody the estate
 * cannot place. ⚠️ Not the apex: `heygabi.ai` runs no panel. */
export const DEFAULT_PANEL_BASE = 'https://padhard.heygabi.ai';

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
 * decide it — and that is still better than the pilot default, because it is at
 * least *their* site.
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
