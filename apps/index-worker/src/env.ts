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
  /**
   * This consumer's own bearer for POST /api/estate/seen — a secret
   * (`wrangler secret put ESTATE_APP_TOKEN_INDEX`); the matching value lives
   * on the auth Worker under the same name.
   */
  ESTATE_APP_TOKEN_INDEX?: string;
}

/** OWNER_EMAILS, parsed the way every consumer parses it: comma-split, trimmed, lowercased. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
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
