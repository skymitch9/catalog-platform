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
   *
   * ALSO backs facts.ts's `facts:<slug>` keys (0007, 2026-08-16) — small
   * JSON blobs (not HTML) a devops-gated caller submits through a form,
   * rendered back into a `doc:<slug>` page. Same binding, sibling key
   * space, deliberately not a second namespace — see facts.ts's header.
   */
  estate_docs?: KVNamespace;

  /**
   * The PRIVATE `estate-backups` R2 bucket (owner ask 2026-08-16: surface
   * backup health on /status). ⚠️ READ-ONLY IN INTENT — backups.ts only ever
   * calls `.list()` and reads `key`/`uploaded` off each object; nothing in
   * this Worker calls `.get()` or `.put()` on this binding, and the route it
   * backs (GET /api/estate/backups, requireDevops()) returns aggregate
   * counts/timestamps per known prefix only — never an object body, a
   * signed URL, or a raw key a caller could turn into a fetch of the bucket.
   * Bound in wrangler.toml as `ESTATE_BACKUPS`; the bucket itself stays
   * private (no public access, no custom domain) regardless of this
   * binding — see docs/access/backup-restore.md.
   */
  ESTATE_BACKUPS?: R2Bucket;

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
   * The Phase 2 session-cookie signing key (sso-design.md §4.3/§7.2/§8) —
   * the whole service-account JSON, SAME shape as FIREBASE_SERVICE_ACCOUNT
   * and parsed with the same parseServiceAccount() (firebase-sa.ts), but a
   * DIFFERENT, dedicated, zero-IAM-role service account — never the same
   * key as FIREBASE_SERVICE_ACCOUNT, which does hold real Firestore/identity
   * scopes. What this key can do: mint a Firebase custom token for ANY uid
   * (§7.2 — "impersonation of anyone"), nothing more; it is not a Firestore
   * credential and grants no IAM permission of its own. Rotation runbook:
   * docs/access/estate-auth.md. `wrangler secret put TOKEN_SIGNER_KEY`,
   * piped from the key file — never committed, never logged, never echoed.
   * ⚠️ DOES NOT EXIST YET as of this build — an owner console step. Every
   * route that needs it answers 503 `{error:'token_signer_unset', fix:
   * 'wrangler secret put TOKEN_SIGNER_KEY'}` until it is set (session.ts).
   */
  TOKEN_SIGNER_KEY?: string;

  /**
   * The parent-domain cookie's `Domain` attribute (design §4.3: "Domain on
   * the parent domain"). A var, not a hardcoded string, so `wrangler dev`
   * can point it at `localhost` — `Domain=.heygabi.ai` is never sendable
   * from a local dev origin. Unset ⇒ the production value, `.heygabi.ai`.
   */
  COOKIE_DOMAIN?: string;

  /**
   * Comma-separated browser origins allowed to call the CREDENTIALED
   * session routes (POST /api/session, POST /api/session/token, DELETE
   * /api/session — session.ts). Deliberately its OWN list: narrower than
   * nothing existing (ADMIN_ORIGINS is apex-only, ME_ORIGINS is apex +
   * audiobook) — every estate surface, including library and games, must
   * be able to call these. Unset ⇒ the four production estate origins
   * (parseSessionOrigins's default below), so the routes are safe and
   * correct out of the box even before a .dev.vars/production var exists.
   */
  SESSION_ORIGINS?: string;

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

/** The four estate origins the session routes admit in production (design §4.3). */
export const DEFAULT_SESSION_ORIGINS = [
  'https://heygabi.ai',
  'https://audiobooks.heygabi.ai',
  'https://library.heygabi.ai',
  'https://boardgames.heygabi.ai',
];

/**
 * SESSION_ORIGINS, parsed — unset falls back to the production four (never
 * to ADMIN_ORIGINS/ME_ORIGINS, which is either too narrow or the wrong set
 * of surfaces entirely), so the credentialed routes are correct even before
 * an operator ever visits `.dev.vars` or the production vars.
 */
export function parseSessionOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return DEFAULT_SESSION_ORIGINS;
  return parseAdminOrigins(raw);
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
