import type { Source } from './rows.js';

export interface Env {
  DB: D1Database;

  /**
   * Per-source push tokens, one secret each (`wrangler secret put
   * INDEX_PUSH_TOKEN_GAME`, etc.; `.dev.vars` locally). Per-source rather than
   * shared so one leaked token revokes one source's write access, not all
   * three, and so a source cannot overwrite a sibling's rows by accident.
   */
  INDEX_PUSH_TOKEN_GAME?: string;
  INDEX_PUSH_TOKEN_LIBRARY?: string;
  INDEX_PUSH_TOKEN_AUDIOBOOK?: string;

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
   * Only `library` exists today. A second app is one field here, one line in
   * `MACHINE_APPS`, and one `wrangler secret put`.
   */
  INDEX_READ_TOKEN_LIBRARY?: string;

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
 * One entry, deliberately: the brief that opened this surface named the
 * library Worker's free-details ladder and nothing else, and every extra name
 * here is access granted to something that has not asked for it yet.
 */
export const MACHINE_APPS = ['library'] as const;
export type MachineApp = (typeof MACHINE_APPS)[number];

/** The secret this Worker expects a given calling app to present. */
export function readTokenFor(env: Env, app: MachineApp): string | undefined {
  switch (app) {
    case 'library':
      return env.INDEX_READ_TOKEN_LIBRARY;
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
  }
}
