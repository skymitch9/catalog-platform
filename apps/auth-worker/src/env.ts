import type { RateLimiter } from './middleware/rate-limit.js';

/** The consumer apps the directory knows. Adding one = a new secret + a row here. */
export const CONSUMER_APPS = ['library', 'games', 'index'] as const;
export type ConsumerApp = (typeof CONSUMER_APPS)[number];

export interface Env {
  DB: D1Database;

  /**
   * Unlisted estate documents (0003/devops, 2026-08-15): KV holding the HTML
   * fragments GET /api/estate/docs/:slug serves to devops/approver callers.
   * ⚠️ Content lives in KV and NOT in this repo on purpose — the repo is
   * public on GitHub, and these documents (runbooks with the household's
   * operational detail) are exactly what the devops gate exists to fence.
   * Written by `wrangler kv key put --binding estate_docs doc:<slug> --path
   * <fragment.html> --remote`; the source of truth for each fragment is
   * named in the doc that owns it (first tenant: audiobook_catalog's
   * LOCAL-ONLY docs/access/SHELF_SERVER.md).
   */
  estate_docs?: KVNamespace;

  /** Set to "production" explicitly in wrangler.toml (conformance §8.2 #8). */
  ENVIRONMENT?: string;
  /** Dev bypass identity — only honoured when ENVIRONMENT === 'development'. */
  DEV_EMAIL?: string;
  DEV_NAME?: string;

  /** Pinned as iss AND aud in the canonical verifier: "audiobook-catalog". */
  FIREBASE_PROJECT_ID?: string;

  /**
   * Break-glass (design §4.3): an email here is approved + approver
   * REGARDLESS of table state. ⚠️ Deliberately the ONLY bootstrap — this
   * Worker has no first-sign-in-claims rule, because "first to knock owns
   * the estate" is unacceptable for the estate's own gate.
   */
  OWNER_EMAILS?: string;

  /**
   * Comma-separated origins allowed to call the admin API from a browser.
   * The admin UI lives on the APEX (owner decision #6), so production is
   * exactly "https://heygabi.ai"; a dev origin joins it in .dev.vars.
   */
  ADMIN_ORIGINS?: string;

  /**
   * Comma-separated origins allowed to call GET /api/estate/me from a
   * browser — the apex AND the audiobook site. ⚠️ Deliberately wider than
   * ADMIN_ORIGINS and consulted ONLY for /me; the admin API never reads it.
   * Unset ⇒ /me falls back to ADMIN_ORIGINS (narrow, never wide).
   */
  ME_ORIGINS?: string;

  /**
   * Per-consumer bearer tokens for POST /api/estate/seen — one secret per
   * app (`wrangler secret put ESTATE_APP_TOKEN_LIBRARY`, etc.; .dev.vars
   * locally). Per-app so one leaked token is one rotation, and so the
   * directory knows which door a newcomer knocked on (origin 'seen:<app>').
   */
  ESTATE_APP_TOKEN_LIBRARY?: string;
  ESTATE_APP_TOKEN_GAMES?: string;
  ESTATE_APP_TOKEN_INDEX?: string;

  /**
   * The audiobook catalog's Firebase service-account JSON, whole — the
   * credential behind /api/estate/site-roles (the three-tier grant path;
   * WebCrypto RS256 → OAuth2 → Firestore/identitytoolkit REST, see
   * firebase-sa.ts). `wrangler secret put FIREBASE_SERVICE_ACCOUNT`, piped
   * from the key file — never committed, never logged, never echoed.
   */
  FIREBASE_SERVICE_ACCOUNT?: string;

  /** Cloudflare rate-limiting binding; optional so wrangler dev runs without it. */
  RATE_LIMITER?: RateLimiter;

  /**
   * The audiobook pipeline's shared trigger secret — the SAME value as
   * PIPELINE_TRIGGER_TOKEN in audiobook_catalog's .env, piped in (never
   * pasted, never logged) so `POST /api/estate/ops/pipeline` can write a
   * request document the home machine's watcher accepts. See ops.ts for the
   * full trigger contract this mirrors. `wrangler secret put
   * PIPELINE_TRIGGER_TOKEN`; locally in `.dev.vars` (gitignored).
   */
  PIPELINE_TRIGGER_TOKEN?: string;
}

/** The row estate.ts reads and writes. */
export interface EstateUserRow {
  id: number;
  email: string;
  firebase_uid: string | null;
  display_name: string | null;
  status: 'pending' | 'approved' | 'revoked';
  is_approver: number;
  /**
   * Estate-level DEVOPS capability (0003): may read the unlisted estate
   * documents (/api/estate/docs/*). Same category as is_approver — an
   * estate-page gate, never an app permission. Approvers implicitly qualify.
   */
  is_devops: number;
  origin: string;
  note: string | null;
  first_seen_at: string;
  decided_at: string | null;
  decided_by: number | null;
  /**
   * Visibility flags (0002, design §4.5): which catalogs this person may SEE.
   * ⚠️ Not a role system — each app still owns what a person may DO there.
   * The stored set only answers for the approved; /seen computes the
   * effective set from status (visibility.ts).
   */
  vis_audiobook: number;
  vis_library: number;
  vis_games: number;
}

export type AppBindings = {
  Bindings: Env;
  Variables: {
    /** The verified, approver-gated actor behind an admin call. */
    actor: EstateUserRow;
  };
};

export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function parseAdminOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
}

export function appTokenFor(env: Env, app: ConsumerApp): string | undefined {
  switch (app) {
    case 'library':
      return env.ESTATE_APP_TOKEN_LIBRARY;
    case 'games':
      return env.ESTATE_APP_TOKEN_GAMES;
    case 'index':
      return env.ESTATE_APP_TOKEN_INDEX;
  }
}
