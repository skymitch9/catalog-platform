/**
 * `/api/machine/*` — the named MACHINE READ exception (built 2026-08-23).
 *
 * ## What this is, and what it widens
 *
 * Design §9 Q3 answered "auth for reads" with **estate members only**, because
 * the read surface aggregates titles across all three catalogs including the
 * two private ones. §4.5 then carved out `/api/search` alone for the anonymous
 * internet. Neither answer left room for a **sibling Worker** to read: the
 * `INDEX_PUSH_TOKEN_*` bearers authenticate `/api/push` and nothing else, and
 * `requireEstateMember()` verifies a **human's Firebase ID token**, which no
 * Worker holds or can mint. The library Worker's free-details ladder needs
 * `/api/lookup` (exact identity) and `/api/search?source=library` (series), so
 * until this existed the gap was total — not "awkward", but "no credential
 * exists".
 *
 * ⚠️ **This is an OWNER-APPROVED WIDENING of §9 Q3, on the record.** It is a
 * genuine access INCREASE, so it is deliberately the narrowest shape that
 * closes the gap: named routes, one token per calling app, an approved
 * member's slice and not the owner's, and refusals that say which of the three
 * things went wrong. It does NOT loosen the human routes by one inch — those
 * still sit below the blanket, and the mount-order test proves it.
 *
 * ⚠️ **Two apps are configured since 2026-08-25 — `library` and `library2`**
 * (`MACHINE_APPS` in env.ts). They are the two instances of the same library
 * build, and they hold DIFFERENT values: the app name is resolved from the
 * value presented, so one shared value would make the name meaningless and one
 * leak would revoke both. ⚠️ **A second app changes WHO may read; it changes
 * nothing about WHAT is readable** — every machine caller resolves to
 * `MACHINE_VISIBILITY` below, so `library2` the APP still cannot read
 * `library2` the SHELF. That is not an oversight to tidy up later: padhard's
 * rows are pushed by nobody today (her `INDEX_PUSH_TOKEN` is deliberately
 * unset), and the day they are, admitting them here is a fresh owner decision
 * under the `DEFAULT 0` rule below, not a config tweak.
 *
 * ## Mounted ABOVE the blanket, BY NAME (conformance §8.2 #3)
 *
 * Same rule and same precedent as `/api/push`: a machine route with its own
 * bearer sits before `requireEstateMember()`, named, with its reason written
 * down. Anything mounted below the blanket is members-only automatically, and
 * that is where every human read stays.
 *
 * ⚠️ **And ABOVE `readCors()` too, which is the point rather than an
 * oversight.** These routes get NO CORS headers, so a browser can never call
 * them cross-origin. A machine-to-machine Worker `fetch` needs no preflight
 * and no ACAO; a browser that could reach here would be a browser that had
 * been handed the read token, and the token must never travel to one. The
 * preflight bug that CORS ordering exists to fix (index.ts's own comment)
 * cannot apply to a caller that never preflights.
 *
 * ## What slice a machine caller resolves to, and why
 *
 * `MACHINE_VISIBILITY` below is **`{audiobook, library, games}` — what an
 * APPROVED ESTATE MEMBER sees**, per §4.5's own table and encoding:
 *
 *   - Those three are `0002_visibility.sql`'s trio, `DEFAULT 1`: "every
 *     already-approved member holds all three… new approvals grant all three
 *     unless the approver narrows". That IS the approved-member default, so it
 *     is the honest reading of "a machine caller sees what a member sees".
 *   - ⚠️ **NOT `CATALOGS`.** The full five-catalog set is `OWNER_EMAILS`'
 *     computed break-glass set (§4.3). A machine is not the owner, and handing
 *     a Worker the break-glass slice would make a leaked token strictly worse
 *     than a leaked member session.
 *   - ⚠️ **`library2` (0007) and `ebooks` (0008) are `DEFAULT 0` on purpose**
 *     — another household's shelf, and "the estate's most copyable asset"
 *     under a directive about scraping. People are switched on there BY HAND.
 *     A machine that was never switched on by hand therefore gets neither, and
 *     adding either is a fresh owner decision, not a config tweak.
 *   - NOT `PUBLIC_CATALOGS` either: the whole reason this exists is that the
 *     library Worker needs the private library shelf, which the public slice
 *     by definition excludes.
 *
 * **What that means per route, concretely:**
 *
 *   - `/api/machine/search` scopes its SQL to those three sources, so the
 *     private library and games shelves are readable and `library2` rows never
 *     are. `scopeSeesEbooks()` is FALSE for this set, so the `format='ebook'`
 *     carve-out subtracts every ebook row before the ranker — the machine gets
 *     the audiobook slice without the gated ebook shelf, which is exactly the
 *     hole `EBOOK_FORMAT` was measured and built to close.
 *   - ⚠️ `/api/machine/lookup` is **unscoped**, because `lookupHandler` is
 *     unscoped for humans too — read.ts's header records that as an explicit
 *     owner call ("lookup stays membership-gated, unscoped"). The machine
 *     inherits that stance VERBATIM rather than inventing a stricter or looser
 *     one here; a machine lookup returns precisely what a member's lookup
 *     returns for the same title. This is not the ebook-enumeration hole:
 *     lookup answers ONE exact folded title at a time and cannot enumerate a
 *     shelf, which is why the carve-out lives on the ranked scan and not here.
 *     If lookup's scoping ever changes for members it changes here for free,
 *     because it is the same function.
 *
 * ## One code path, not a parallel one
 *
 * Both routes mount the SAME exported handler the human routes mount
 * (`lookupHandler`, `searchHandler`). Nothing is reimplemented, so the two
 * surfaces cannot drift into disagreeing about what a lookup means — design
 * §8's "no second matcher", applied to the read side.
 */

import { Hono } from 'hono';
import type { Catalog } from '@platform/estate-auth';
import type { MiddlewareHandler } from 'hono';
import { hasBearer, tokenMatches } from './bearer.js';
import type { Env, MachineApp } from './env.js';
import { MACHINE_APPS, readTokenFor, readTokenNameFor } from './env.js';
import type { ScopeVariables } from './middleware/scope.js';
import { lookupHandler } from './read.js';
import { searchHandler } from './search-route.js';

/**
 * The visibility set a machine caller resolves to — an APPROVED MEMBER's, per
 * §4.5. See this file's header for why it is not `CATALOGS` and not
 * `PUBLIC_CATALOGS`, and why `library2`/`ebooks` are deliberately absent.
 *
 * ⚠️ Canonical order, matching `CATALOGS` — the array travels to the caller in
 * the `scope` field and a reordered set reads as a different answer.
 */
export const MACHINE_VISIBILITY: readonly Catalog[] = ['audiobook', 'library', 'games'];

/**
 * Identify the calling app from the token VALUE it presents.
 *
 * ⚠️ **The value is the identity — there is no `app` field on the wire.** That
 * is the estate's standing pattern (`identifyApp`, estate-auth §4.5's
 * `library2` note) and it exists because a self-declared app name is a claim a
 * caller can simply make up. Every configured token is tried in
 * `MACHINE_APPS` order and the one that matches names the caller.
 *
 * Refusal order copies `push.ts` verbatim: the CONFIGURATION question is asked
 * before the CREDENTIAL question, so "nobody has minted this secret yet" can
 * never be reported as "your token is wrong".
 */
export function requireMachineApp(): MiddlewareHandler<{ Bindings: Env; Variables: ScopeVariables }> {
  return async (c, next) => {
    const configured = MACHINE_APPS.map((app) => ({ app, token: readTokenFor(c.env, app) })).filter(
      (row): row is { app: MachineApp; token: string } => typeof row.token === 'string' && row.token.length > 0,
    );

    // 1. OUR configuration, not the caller's fault — and never a 404. A 404
    //    here would read as "this was never built", which would send the
    //    caller's operator to look for a feature that exists and is simply
    //    unkeyed. Names the secret, because only the owner can mint it.
    if (configured.length === 0) {
      return c.json(
        {
          error: 'machine_read_unconfigured',
          detail:
            'the machine read surface is built and deployed, but this index Worker holds no machine read token, so it cannot recognise any calling app. This is a missing secret on the index, not a problem with your request.',
          needs: MACHINE_APPS.map(readTokenNameFor),
          how:
            'the estate owner mints one value PER APP and sets each on BOTH of ITS holders in one sitting: ' +
            MACHINE_APPS.map(
              (app) => `\`wrangler secret put ${readTokenNameFor(app)}\` on apps/index-worker`,
            ).join(', and ') +
            ", each paired with `wrangler secret put INDEX_READ_TOKEN` on that app's own Worker " +
            '(⚠️ one value per app — two apps sharing one value would make the app name meaningless)',
        },
        503,
      );
    }

    // 2. No credential offered at all. Distinct from a wrong one on purpose:
    //    "you forgot the header" and "your token is not the one I hold" send
    //    an operator to two completely different places.
    const header = c.req.header('authorization');
    if (!hasBearer(header)) {
      return c.json(
        {
          error: 'machine_token_missing',
          detail:
            'this is a machine-to-machine read and no bearer credential was presented. Human callers do not use this route — a person signs in and uses /api/lookup or /api/search, which take a Firebase ID token.',
          needs: 'an `Authorization: Bearer <token>` header carrying your app’s machine read token',
          how: 'a sibling Worker reads its own INDEX_READ_TOKEN secret and sends it as `Authorization: Bearer ${env.INDEX_READ_TOKEN}`; ask the estate owner to mint one if your app has none',
        },
        401,
      );
    }

    // 3. A credential was offered and it is not one we hold. Every configured
    //    token is compared even after a mismatch — no early exit — so the
    //    number of comparisons does not leak which app was nearly right.
    let matched: MachineApp | null = null;
    for (const row of configured) {
      if (await tokenMatches(header, row.token)) matched = matched ?? row.app;
    }
    if (matched === null) {
      return c.json(
        {
          error: 'machine_token_invalid',
          detail:
            'the bearer token presented is not a machine read token this index recognises. ⚠️ A PUSH token will not work here — read and push are deliberately different credentials.',
          needs: 'the value the index holds as INDEX_READ_TOKEN_<YOURAPP>, which your app holds as INDEX_READ_TOKEN',
          how: 'these secrets are write-only and no readable copy exists; if the pairing has drifted the owner re-mints one value and sets it on both holders in one sitting',
        },
        401,
      );
    }

    // The caller is a machine: no person, so `email` stays null and any gate
    // that asks who the human is refuses by construction.
    c.set('machineApp', matched);
    c.set('email', null);
    c.set('visibility', [...MACHINE_VISIBILITY]);
    await next();
  };
}

export const machineRoutes = new Hono<{ Bindings: Env; Variables: ScopeVariables }>();

machineRoutes.use('*', requireMachineApp());

// The SAME handlers the human routes mount — see this file's header.
machineRoutes.get('/lookup', lookupHandler);
machineRoutes.get('/search', searchHandler);
