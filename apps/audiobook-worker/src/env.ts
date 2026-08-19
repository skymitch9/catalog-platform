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
   * The bearer for `POST /api/estate/ops/worker-events` — the /status event
   * ring (`docs/info/worker-event-ring.md`). Set 2026-08-18.
   *
   * ⚠️ **UNSET IS A NO-OP, NOT A FAILURE.** `reportEvent()` returns without
   * sending when this is absent, so this Worker behaves exactly as it did
   * before the ring existed — the estate's standing "ships dark until
   * configured" idiom. Nothing here should branch on it.
   *
   * ⚠️ Deliberately the SMALL credential: its entire power is appending a line
   * to a capped noticeboard. It is NOT `ESTATE_CONDUCTOR_TOKEN`, which could
   * rewrite the estate's whole picture of what is running (§4).
   */
  ESTATE_EVENTS_TOKEN?: string;

  /**
   * ⚠️ **DOOR B'S BEARER for the book-knowledge routes** (`book-routes.ts`) —
   * a secret (`wrangler secret put ESTATE_APP_TOKEN_BOOKS`), whose matching
   * value lives on the callers: `apps/discord-worker` and `library_catalog`'s
   * Worker.
   *
   * ⚠️ **A FRESH PAIR, not a reuse of `ESTATE_APP_TOKEN_AUDIOBOOK`.** That one
   * is this Worker's OUTBOUND credential to the estate directory; this one is an
   * INBOUND grant to read the household's derived book text. Sharing a value
   * between an outbound and an inbound trust edge means a leak in either
   * direction opens both.
   *
   * ⚠️ **UNSET IS THE SHIPS-DARK STATE.** With no value, door B does not exist
   * and every request falls through to door A (a browser's Firebase token). It
   * authorises no read by itself: the accompanying `X-Estate-On-Behalf-Of` email
   * is resolved against the estate directory and must hold `vis_ebooks`.
   */
  ESTATE_APP_TOKEN_BOOKS?: string;

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

  /**
   * The PRIVATE R2 bucket holding the ebook FILES themselves (`estate-ebooks`,
   * 167 objects / 1.393 GB as of 2026-08-17) — read by
   * `GET /api/ebook/:anchor/file`, written by `scripts/upload_ebooks_r2.py` in
   * `audiobook_catalog` (viewer phase 0a).
   *
   * ⚠️ A THIRD bucket, and the separation is again the security property.
   * Object keys are the manifest row's `path` VERBATIM
   * (`Brandon Sanderson/Defiant.pdf`) — no prefix, no hash — so a public URL
   * on this bucket would be a guessable, world-readable warehouse of
   * DRM-stripped files. `wrangler r2 bucket dev-url get estate-ebooks` answers
   * *"Public access via the r2.dev URL is disabled"*, there is no custom
   * domain, and this binding is meant to be the only way in. ⚠️ Never enable a
   * public URL or attach a domain to it.
   *
   * Optional in the type so the route can answer a NAMED configuration refusal
   * (`file_store_unbound`) instead of throwing a 500 that says nothing about
   * the fix — the same reason `EBOOKS_GATED` is optional.
   */
  EBOOKS?: R2Bucket;

  /**
   * The PRIVATE R2 bucket holding the AUDIOBOOK files (`estate-audio`) — read
   * by `GET|HEAD /api/audio/:anchor/file`, written by
   * `scripts/upload_audio_r2.py` in `audiobook_catalog` (audio phase 0b).
   *
   * ⚠️ A FOURTH bucket, and the separation is again the security property —
   * more so than for ebooks, because the object keys are library-relative
   * paths verbatim (`Brandon Sanderson/Skyward.m4b`) over a **630 GB** library
   * whose mean file is 601 MB. A public URL here would be a guessable,
   * world-readable warehouse of the household's audio. Verified 2026-08-17:
   * `wrangler r2 bucket dev-url get estate-audio` → *"Public access via the
   * r2.dev URL is disabled"*; `wrangler r2 bucket domain list estate-audio` →
   * no custom domains. ⚠️ Never enable either.
   *
   * ⚠️ **It is EMPTY by design and stays mostly empty.** Ingest is on demand
   * (owner decision 3): a book reaches this bucket because somebody pressed
   * "request it" and the 8-hourly pipeline fulfilled the queue. An absent
   * object is a book nobody asked for, not a book that was lost — which is why
   * the route answers a worded `not_streamable` 404 rather than a 500.
   *
   * ⚠️ The audio MANIFEST is deliberately NOT in this bucket: it lives beside
   * the ebook one in `EBOOKS_GATED` under key `audio_manifest.json`. See
   * `audio-manifest.ts`'s header for that argument.
   *
   * Optional in the type so the route can answer a NAMED configuration refusal
   * (`file_store_unbound`) instead of throwing a 500 that says nothing about
   * the fix — the same reason the other two are optional.
   */
  AUDIO?: R2Bucket;
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
