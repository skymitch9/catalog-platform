/**
 * The audiobook-worker's environment — the fourth consumer of the estate
 * pattern (audiobook-auth-migration.md §2). Vars in wrangler.toml; secrets
 * via `wrangler secret put`; locally in .dev.vars (gitignored).
 */

/** The canonical verifier's slice (VerifierEnv) + this Worker's own config. */
export interface Env {
  /** Affirmative dev bypass — 'development' exactly, anything else is real auth. */
  ENVIRONMENT?: string;
  DEV_EMAIL?: string;
  DEV_NAME?: string;

  /** Pinned as iss AND aud in the verifier: "audiobook-catalog". */
  FIREBASE_PROJECT_ID?: string;

  /**
   * Break-glass, same rule as everywhere in the estate: listed emails
   * resolve to ladder 'owner' (role-ladder.ts's effectiveLadderRole) and are
   * never demoted by an estate verdict — the break-glass cannot be narrowed
   * into a lockout.
   */
  OWNER_EMAILS?: string;

  /**
   * Exact browser origins allowed on /api/* — the audiobook site's prod +
   * dev lanes, which share ONE origin (the dev lane is a /dev/ PATH on the
   * same host). Comma-separated, exact scheme+host, no trailing slash.
   * Unset ⇒ DEFAULT_SITE_ORIGINS — correct out of the box, never wider.
   */
  SITE_ORIGINS?: string;

  /** The estate directory, e.g. https://auth.heygabi.ai (local dev: :8799). */
  ESTATE_AUTH_URL?: string;

  /**
   * This consumer's own bearer for POST /api/estate/seen — a secret
   * (`wrangler secret put ESTATE_APP_TOKEN_AUDIOBOOK`); the matching value
   * lives on the auth Worker under the same name (declared in its env.ts).
   */
  ESTATE_APP_TOKEN_AUDIOBOOK?: string;

  /**
   * The estate-check mode (migration design §2/§4): 'off' | 'shadow' |
   * 'enforce'. Governs BOTH the /api/gate/shadow receiver (inert unless
   * shadow/enforce) and whether /api/me's answer demotes a revoked caller
   * (enforce only — shadow must change no behaviour, by construction).
   */
  ESTATE_CHECK?: string;

  /**
   * OPTIONAL override for the gate log lines' identity salt (src/pseudonym.ts
   * `IDENTITY_SALT`). Unset is the intended state: the default salt is a
   * hardcoded, NON-SECRET domain-separation constant, because the threat the
   * hashing addresses is accidental disclosure through a RETAINED log, not an
   * adversary holding the source and a candidate address list. Set it — as a
   * secret, `wrangler secret put GATE_HASH_SALT` — only if the owner wants a
   * guessed address to be uncheckable too.
   *
   * ⚠️ Changing it RE-PSEUDONYMISES everyone: the same person hashes
   * differently before and after, so a soak window must never span the change
   * and the evidence pack must say which salt generation it counted.
   */
  GATE_HASH_SALT?: string;

  /**
   * The audiobook catalog's Firebase service-account JSON, whole — the same
   * value and custody as auth-worker's FIREBASE_SERVICE_ACCOUNT, though THIS
   * Worker mints datastore-scoped tokens only (src/roles.ts). Piped in via
   * `wrangler secret put` — never committed, never logged, never echoed.
   */
  FIREBASE_SERVICE_ACCOUNT?: string;

  /**
   * The PRIVATE R2 bucket holding the ebook manifest (`ebooks-gated`, key
   * `ebooks.json`) — read by GET /api/ebooks/manifest, written by the
   * audiobook pipeline's publish step.
   *
   * ⚠️ A SEPARATE bucket from `audiobook-covers` on purpose, and the
   * separation IS the security property: the covers bucket has a public
   * r2.dev URL enabled, so every object in it is fetchable by anyone who
   * guesses the key. This bucket has public access DISABLED and no custom
   * domain, so the Worker's binding is the only way in. Never move the
   * manifest into the covers bucket "to save a binding".
   *
   * Optional in the type so the route can answer a NAMED configuration
   * refusal (`manifest_store_unbound`) instead of throwing a 500 that says
   * nothing about the fix.
   */
  EBOOKS_GATED?: R2Bucket;
}

export type EstateCheckMode = 'off' | 'shadow' | 'enforce';

/**
 * ESTATE_CHECK, parsed AFFIRMATIVELY: exactly 'shadow' or 'enforce' count,
 * anything else — unset, a typo, a future value — reads as 'off'. A typo
 * must not switch enforcement on; the flip to shadow/enforce is always a
 * deliberate, spelled-correctly act.
 */
export function estateCheckMode(raw: string | undefined): EstateCheckMode {
  return raw === 'shadow' || raw === 'enforce' ? raw : 'off';
}

/** OWNER_EMAILS, parsed the way every consumer parses it. */
export function parseOwnerEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The production default for SITE_ORIGINS (both site lanes live here — the
 * dev lane is a path, not a host). Exported so the CORS tests pin it.
 */
export const DEFAULT_SITE_ORIGINS = ['https://audiobooks.heygabi.ai'];

/** SITE_ORIGINS, parsed; unset falls back to the production default. */
export function parseSiteOrigins(raw: string | undefined): string[] {
  if (raw === undefined) return DEFAULT_SITE_ORIGINS;
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter((o) => o.length > 0);
}
