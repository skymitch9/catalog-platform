import type { Source } from './rows.js';

export interface Env {
  DB: D1Database;

  /**
   * Per-source push tokens, one secret each (`wrangler secret put
   * INDEX_PUSH_TOKEN_GAME`, etc.; `.dev.vars` locally). Per-source rather than
   * shared so one leaked token revokes one source's write access, not every
   * source's, and so a source cannot overwrite a sibling's rows by accident.
   *
   * Four since 2026-09-05 — see `INDEX_PUSH_TOKEN_LIBRARY2` below.
   */
  INDEX_PUSH_TOKEN_GAME?: string;
  INDEX_PUSH_TOKEN_LIBRARY?: string;
  INDEX_PUSH_TOKEN_AUDIOBOOK?: string;
  /**
   * padhard's push token (federation day, 2026-09-05). ⚠️ **A DIFFERENT VALUE
   * from `INDEX_PUSH_TOKEN_LIBRARY`**, exactly as `INDEX_READ_TOKEN_LIBRARY2`
   * is a different value from `INDEX_READ_TOKEN_LIBRARY` — the two library
   * instances are two callers, so one leaked value revokes one instance's
   * write access. The pairing note below applies here too: the INDEX Worker
   * holds the SUFFIXED name, padhard's Worker holds it un-suffixed as
   * `INDEX_PUSH_TOKEN` on `[env.friend]`.
   *
   * ⚠️ It is also what makes the snapshot replace safe: it authorises
   * `PUT /api/push/library2` and nothing else, so no value padhard holds can
   * replace `library`'s rows even if the route were called with the wrong
   * source in the path.
   *
   * Unset is a worded 503 naming this secret, never a 404 — "nobody has minted
   * it yet" and "this was never built" are different facts (`push.ts`).
   */
  INDEX_PUSH_TOKEN_LIBRARY2?: string;

  /**
   * Per-app MACHINE READ tokens — the named machine exception on the read
   * side (`machine-route.ts`; design §9 Q3's owner-approved widening,
   * 2026-08-23). Same idiom as the push tokens above and for the same
   * reasons: one secret per calling app, so one leaked token revokes one
   * app's read access rather than every app's, and so the token VALUE is
   * what identifies the caller (`identifyApp`'s estate-wide pattern — there
   * is no `app` field on the wire to lie in).
   *
   * ⚠️ THE PAIRING, which is the half that goes wrong: the INDEX Worker holds
   * the SUFFIXED name, the calling app holds the UN-suffixed one. So
   * `INDEX_READ_TOKEN_LIBRARY` here is the same minted value the library
   * Worker holds as **`INDEX_READ_TOKEN`** — exactly the push tokens'
   * `INDEX_PUSH_TOKEN_LIBRARY` ↔ `INDEX_PUSH_TOKEN` shape (one un-suffixed
   * name per source repo). A value that is needed is re-minted and set on
   * BOTH holders in one sitting; no readable copy exists anywhere.
   *
   * ⚠️ READ and PUSH tokens are DIFFERENT credentials and must never be the
   * same value: push writes a whole source's snapshot, read sees across every
   * catalog. One name per direction, per app.
   *
   * Unset is not a 404 — the route answers a worded 503 naming this secret,
   * because "nobody has minted it yet" and "this was never built" are
   * different facts (the `push_token_unset` idiom).
   *
   * Two apps exist today — `library` (the main library Worker) and `library2`
   * (padhard, the same build's `[env.friend]`). A third app is one field here,
   * one line in `MACHINE_APPS`, and one `wrangler secret put`.
   */
  INDEX_READ_TOKEN_LIBRARY?: string;
  /**
   * padhard's own machine read token (added 2026-08-25 with the free-details
   * ladder's rung 2). ⚠️ **A DIFFERENT VALUE from `INDEX_READ_TOKEN_LIBRARY`,
   * and that is the whole point of a second name**: the two instances are two
   * callers, exactly as they are two estate consumers
   * (`ESTATE_APP_TOKEN_LIBRARY` / `…_LIBRARY2`), so one leaked value revokes
   * one instance's read access. Both Workers hold their own value under the
   * un-suffixed `INDEX_READ_TOKEN`, per the pairing note above.
   *
   * ⚠️ **Holding this grants `MACHINE_VISIBILITY`, NOT the `library2` shelf.**
   * The app NAME here identifies the caller; it does not widen what the caller
   * can see. `MACHINE_VISIBILITY` is `{audiobook, library, games}` for every
   * machine app, and `library2` rows stay unreadable by any of them — see
   * machine-route.ts's header for why that is deliberate rather than an
   * oversight, and `test/machine-read.test.ts` for the test that pins it.
   */
  INDEX_READ_TOKEN_LIBRARY2?: string;

  // — Estate auth (estate-auth-design.md §5.2, §7.1) — the read surface is
  //   estate-members-only. Vars in wrangler.toml; the token is a secret.

  /** The canonical verifier's slice (VerifierEnv): affirmative dev bypass. */
  ENVIRONMENT?: string;
  DEV_EMAIL?: string;
  DEV_NAME?: string;
  /** Pinned as iss AND aud — the shared project every consumer uses. */
  FIREBASE_PROJECT_ID?: string;
  /** Break-glass (§6 row 4): listed emails are served even estate-down. */
  OWNER_EMAILS?: string;
  /** The estate directory, e.g. https://auth.heygabi.ai (local dev: :8799). */
  ESTATE_AUTH_URL?: string;
  /** CORS allow-list for browser reads; comma-separated. Defaults to the apex. */
  READ_ORIGINS?: string;
  /**
   * This consumer's own bearer for POST /api/estate/seen — a secret
   * (`wrangler secret put ESTATE_APP_TOKEN_INDEX`); the matching value lives
   * on the auth Worker under the same name.
   */
  ESTATE_APP_TOKEN_INDEX?: string;

  /**
   * BILLING POLICY POSTURE — `off` | `shadow` | `enforce`, in the exact idiom
   * of `ESTATE_CHECK` (billing design §4). Anything unrecognised falls to
   * `off` AND LOGS (`billing-gate.ts`), because a typo in a wrangler var must
   * not silently half-enable a money gate.
   *
   * ⚠️ IT SHIPS `"off"` AND THE COMMITTED FILE MUST KEEP SAYING `"off"`. A site
   * is flipped one at a time, on the measured criterion in §4.2 — zero false
   * denials over ≥7 days AND at least one TRUE denial on something the owner
   * actually switched off, because "zero denials" is otherwise
   * indistinguishable from "the instrument never ran". Never flipped as a side
   * effect of an unrelated deploy.
   */
  BILLING_POLICY?: string;

  /**
   * The bearer for `POST /api/estate/ops/worker-events` — the /status event
   * ring (`docs/info/worker-event-ring.md`). Set 2026-08-18.
   *
   * ⚠️ **UNSET IS A NO-OP, NOT A FAILURE.** `reportEvent()` returns without
   * sending when this is absent, so this Worker behaves exactly as it did
   * before the ring existed — the estate's standing "ships dark until
   * configured" idiom. Nothing here should ever branch on it.
   *
   * ⚠️ It is deliberately the SMALL credential: its entire power is appending
   * a line to a capped noticeboard. It is NOT `ESTATE_CONDUCTOR_TOKEN`, which
   * could rewrite the estate's whole picture of what is running (§4).
   */
  ESTATE_EVENTS_TOKEN?: string;

  /**
   * The shelf/cover-photo vision call (scan.ts, vision.ts) — the ONLY place
   * this Worker spends money. A secret (`wrangler secret put
   * ANTHROPIC_API_KEY`); the value already exists in library_catalog's own
   * `apps/worker/.dev.vars` (see docs/info/estate-scan-adoption.md for the
   * push command). Unset = the route answers 503, never a silent skip — see
   * vision.ts's own explain().
   */
  ANTHROPIC_API_KEY?: string;
}

/** OWNER_EMAILS, parsed the way every consumer parses it: comma-split, trimmed, lowercased. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The apps allowed to hold a machine READ token, in the order they are tried.
 *
 * Two entries, and still deliberately short: every extra name here is access
 * granted to something that has not asked for it yet. `library2` was added
 * 2026-08-25 because padhard runs the SAME build as `library` and therefore the
 * same free-details ladder — the rung would otherwise have to be dark on one of
 * the two instances, or the two instances would have to share one credential,
 * which is the `ESTATE_APP_TOKEN_LIBRARY`-on-her-Worker mistake wearing a
 * different name.
 *
 * ⚠️ **Adding a name here does NOT widen what a machine caller can see.**
 * Every app resolves to `MACHINE_VISIBILITY` and nothing else.
 */
export const MACHINE_APPS = ['library', 'library2'] as const;
export type MachineApp = (typeof MACHINE_APPS)[number];

/** The secret this Worker expects a given calling app to present. */
export function readTokenFor(env: Env, app: MachineApp): string | undefined {
  switch (app) {
    case 'library':
      return env.INDEX_READ_TOKEN_LIBRARY;
    case 'library2':
      return env.INDEX_READ_TOKEN_LIBRARY2;
  }
}

/** The secret NAME, for refusals — names only, never values (KI-2). */
export function readTokenNameFor(app: MachineApp): string {
  return `INDEX_READ_TOKEN_${app.toUpperCase()}`;
}

export function pushTokenFor(env: Env, source: Source): string | undefined {
  switch (source) {
    case 'game':
      return env.INDEX_PUSH_TOKEN_GAME;
    case 'library':
      return env.INDEX_PUSH_TOKEN_LIBRARY;
    case 'audiobook':
      return env.INDEX_PUSH_TOKEN_AUDIOBOOK;
    case 'library2':
      return env.INDEX_PUSH_TOKEN_LIBRARY2;
  }
}
