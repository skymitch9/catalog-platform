/**
 * `GET /api/estate/app-check` — **THE HANDSHAKE PROBE**, built 2026-09-02.
 *
 * One question, and deliberately only one: **does this bearer authenticate to
 * `estate-auth`, and as which app?**
 *
 * ## Why it exists — a rotation nobody can watch is a rotation nobody can do
 *
 * `docs/info/secrets-review-2026-08-26.md` §5 step 3 and `docs/access/RECOVERY.md`
 * §11.3: three estate-internal token pairs have **no master copy anywhere**, and
 * the only way to give one a master is to mint a new value and set it on both
 * holders. `scripts/op-rotate-pair.mjs` does exactly that — and **REFUSES a pair
 * it cannot prove**, before minting anything, because:
 *
 * > *"A half-applied pair does not raise an error anywhere: the verifier stops
 * > recognising the presenter and the result is a silent 401/403/404 on a route
 * > nobody is watching."*
 *
 * Two of those three pairs — `ESTATE_APP_TOKEN_LIBRARY2` and
 * `ESTATE_APP_TOKEN_AUDIOBOOK` — are verified HERE, and every existing route
 * that exercises them needs something a script cannot have:
 *
 * | Route | Why it is not a probe |
 * |---|---|
 * | `POST /api/estate/seen` | needs a real signed-in identity **and it WRITES a seen record** |
 * | `GET /api/estate/health` | open, and exercises no app token at all — counts and a version |
 * | `GET /api/estate/billing/policy` | ⚠️ *close*, but it reads D1 and its answer depends on policy rows, so a 200 there confuses "the token works" with "the table says something" |
 *
 * This route is the missing one. `INDEX_READ_TOKEN_LIBRARY2` was rotated and
 * PROVED on 2026-08-26 precisely because `/api/machine/lookup` already gave it
 * this shape; the other two had nothing equivalent. Now they do — **one route
 * unblocks both pairs permanently**, which is option 1 of the two the TODO item
 * offered.
 *
 * ## ⚠️ What it deliberately does NOT do
 *
 * - **No write.** Nothing is upserted, stamped or logged to a store. A probe
 *   that leaves a row behind cannot be run casually, and one that cannot be run
 *   casually will not be run.
 * - **No D1 read.** `identifyApp` compares the bearer against the configured
 *   secrets and touches nothing else, so a database outage cannot make a
 *   working token look broken — which on rotation day is the difference between
 *   stopping safely and stopping needlessly.
 * - **No human identity.** No email in, no person out. The three pairs' whole
 *   problem was that every existing exercise of them needed a signed-in body.
 * - **No secret VALUE, in either direction.** The answer names the app and the
 *   secret's NAME; the value is only ever the thing presented.
 *
 * ## ⚠️ Is this an oracle for guessing a token?
 *
 * It answers yes/no to "is this the right value", which `POST /api/estate/seen`
 * has always done too (401 versus a 400 on a bad body), so it widens nothing
 * that was narrow. The comparison is `crypto.subtle.timingSafeEqual` through
 * `identifyApp`, length-gated exactly as `/seen`'s is; the values are 32 random
 * bytes; and a caller learns the app name **only after already holding the
 * value**. The thing it adds is not an attack surface — it is the ability to
 * TELL, which is the property the rotation was blocked on.
 */

import { Hono } from 'hono';
import type { AppBindings } from './env.js';
import { CONSUMER_APPS } from './env.js';
import { identifyApp } from './estate.js';

export const appCheckRoutes = new Hono<AppBindings>();

/**
 * The secret NAME each app's token is stored under, on both holders. Named
 * here so the answer tells an operator which line of `op-rotate-pair.mjs`'s
 * registry it just proved — never a value, only a name.
 */
export const APP_TOKEN_SECRET_NAMES: Record<string, string> = {
  library: 'ESTATE_APP_TOKEN_LIBRARY',
  games: 'ESTATE_APP_TOKEN_GAMES',
  index: 'ESTATE_APP_TOKEN_INDEX',
  audiobook: 'ESTATE_APP_TOKEN_AUDIOBOOK',
  library2: 'ESTATE_APP_TOKEN_LIBRARY2',
};

appCheckRoutes.get('/estate/app-check', async (c) => {
  const { app, anyConfigured } = await identifyApp(c.env, c.req.header('authorization'));

  if (!anyConfigured) {
    // ⚠️ A missing secret is a CONFIGURATION failure, not an auth decision, and
    // the two must never wear the same clothes — the `/seen` idiom, kept
    // verbatim. On rotation day this is the difference between "I set it
    // wrong" and "I never set it".
    return c.json(
      {
        error: 'app_tokens_unset',
        detail:
          'This Worker holds no app tokens at all, so it cannot say whether yours is one of them. ' +
          'That is our configuration, not a decision about your token.',
        fix: 'wrangler secret put ESTATE_APP_TOKEN_LIBRARY (and _GAMES, _INDEX, _AUDIOBOOK, _LIBRARY2)',
      },
      503,
    );
  }

  if (!app) {
    // ⚠️ Worded, per the standing rule — a person must never see a bare status.
    // ⚠️ And it names NOTHING about which apps are configured: a refusal is a
    // fact about the value presented, never a listing of what would have worked.
    return c.json(
      {
        error: 'unrecognised_app_token',
        detail:
          'That bearer is not one of the estate’s app tokens, so no app can be named for it. ' +
          'If you are rotating a pair, the verifier has not been given this value yet — set it on ' +
          'estate-auth first, then probe again.',
        fix: 'set the matching ESTATE_APP_TOKEN_* secret on estate-auth, verifier before presenter',
      },
      401,
    );
  }

  return c.json({
    ok: true,
    app,
    /** Which Worker just made this decision — a probe's answer should say who answered it. */
    verifier: 'estate-auth',
    /** The NAME of the secret this value is stored under. Never the value. */
    secret_name: APP_TOKEN_SECRET_NAMES[app] ?? null,
    checked_at: new Date().toISOString(),
    /**
     * ⚠️ The honest limit, ON THE WIRE rather than only in a doc. This proves
     * the VERIFIER accepts the value presented. It cannot prove that the
     * holding Worker SENDS this value on its own traffic — Worker secrets are
     * write-only, so the only evidence there is that `wrangler` accepted the
     * write and the name is still listed.
     */
    proves: 'the verifier accepts this value; NOT that the holder sends it',
  });
});

/** Exported so a test can pin that every consumer app has a secret name. */
export const KNOWN_APPS = CONSUMER_APPS;
