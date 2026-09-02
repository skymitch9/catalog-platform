/**
 * `GET /api/books/app-check` — **THE HANDSHAKE PROBE for `ESTATE_APP_TOKEN_BOOKS`**,
 * built 2026-09-02.
 *
 * One question: **does this bearer authenticate to the audiobook Worker as the
 * book-knowledge caller?** No identity named, nothing read, nothing written.
 *
 * ## Why it exists
 *
 * `docs/info/secrets-review-2026-08-26.md` §5 step 3: `ESTATE_APP_TOKEN_BOOKS`
 * has **no master copy anywhere**, and `scripts/op-rotate-pair.mjs` refuses to
 * mint one for a pair it cannot prove — correctly, because a half-applied pair
 * fails silently on a route nobody watches. The reason it had no probe, in that
 * script's own words:
 *
 * > *"`/api/books/*` needs the app token PLUS an `X-Estate-On-Behalf-Of` naming
 * > a linked Discord asker. Sending a fabricated on-behalf identity to prove a
 * > token works would be asserting an identity to a live gate, which is not a
 * > probe."*
 *
 * 🔴 **That objection is the whole design of this route, and it is why the route
 * is a new one rather than a flag on an existing one.** Door B's contract is
 * *token AND asker*; anything that let the token alone reach a book would be a
 * weaker second door onto the household's book text. So this route proves the
 * token and **cannot** reach a book: it does not touch `EBOOKS_GATED`, does not
 * load a pack, does not resolve an email and does not consult the estate
 * directory. It answers a fact about the CREDENTIAL, never about a reader.
 *
 * ⚠️ **`resolveEbookAccessForEmail` is deliberately not called here.** Door B's
 * trust boundary (`ebook-gate.ts`) is that the app token's holder may name any
 * email and be answered for that person's standing — safe only because the
 * discord-worker can send exactly one email, proved through the person's own
 * Discord OAuth *and* their own Firebase sign-in. A probe route that resolved an
 * email would be a second caller inside that boundary for no reason.
 *
 * ## What a rotation sees
 *
 * | Presented | Answer |
 * |---|---|
 * | the right value | `200 { ok: true, app: 'books' }` |
 * | a wrong value | `401 unrecognised_app_token`, worded |
 * | nothing at all | `401`, the same worded refusal |
 * | the secret is unset here | `503 app_token_unset`, worded, naming the fix |
 *
 * ⚠️ The 401 and the 503 are kept apart for the reason the estate keeps every
 * refusal apart: on rotation day *"I set it wrong"* and *"I never set it"* have
 * different fixes, and a single status for both sends an operator to re-mint a
 * value that was fine.
 *
 * ## What it does NOT prove
 *
 * That `estate-discord` **sends** this value on its own traffic. Worker secrets
 * are write-only; the only evidence on that side is that `wrangler` accepted the
 * write and the name is still listed. The VERIFIER half is what this proves, and
 * the answer says so on the wire.
 */

import { Hono } from 'hono';
import type { Env } from './env.js';
import { bearerMatches } from './book-routes.js';

export const appCheckRoutes = new Hono<{ Bindings: Env }>();

appCheckRoutes.get('/api/books/app-check', async (c) => {
  const expected = c.env.ESTATE_APP_TOKEN_BOOKS;

  if (!expected) {
    // ⚠️ THE SHIPS-DARK STATE, said out loud. With no secret, door B does not
    // exist at all and every book request falls through to a browser token —
    // which is a correct posture, not a fault, and must not read as one.
    return c.json(
      {
        error: 'app_token_unset',
        detail:
          'This Worker holds no book-knowledge app token, so it cannot say whether yours is it. ' +
          'That is our configuration, not a decision about your token — with the secret unset, ' +
          'door B does not exist and every book request needs a signed-in reader instead.',
        fix: 'wrangler secret put ESTATE_APP_TOKEN_BOOKS (the SAME value on estate-discord)',
      },
      503,
    );
  }

  if (!(await bearerMatches(c.req.header('authorization'), expected))) {
    return c.json(
      {
        error: 'unrecognised_app_token',
        detail:
          'That bearer is not this Worker’s book-knowledge app token. If you are rotating the ' +
          'pair, the verifier has not been given this value yet — set it on audiobook-worker ' +
          'first, then probe again.',
        fix: 'set ESTATE_APP_TOKEN_BOOKS on audiobook-worker (verifier) before estate-discord (presenter)',
      },
      401,
    );
  }

  return c.json({
    ok: true,
    app: 'books',
    verifier: 'audiobook-worker',
    /** The NAME, never the value. */
    secret_name: 'ESTATE_APP_TOKEN_BOOKS',
    checked_at: new Date().toISOString(),
    proves: 'the verifier accepts this value; NOT that the holder sends it',
  });
});
