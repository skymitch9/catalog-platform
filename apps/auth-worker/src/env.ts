import type { RateLimiter } from './middleware/rate-limit.js';

/** The consumer apps the directory knows. Adding one = a new secret + a row here. */
export const CONSUMER_APPS = ['library', 'games', 'index', 'audiobook', 'library2'] as const;
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

  /**
   * The PRIVATE `estate-docs-gated` R2 bucket — the estate's whole `docs/`
   * corpus as ONE gzipped snapshot, plus its receipt (GABI docs assistant,
   * phase 2; design docs/info/gabi-docs-assistant-design.md).
   *
   * ⚠️ READ-ONLY IN INTENT, like ESTATE_BACKUPS above: `estate-docs.ts` only
   * ever calls `.get()`/`.head()`. The single WRITER is a script on the
   * owner's own machine (`audiobook_catalog/scripts/publish_docs_snapshot.py`),
   * and it has to run there because `audiobook_catalog/docs/` is gitignored and
   * exists nowhere else — a CI-published snapshot would carry two-thirds of the
   * estate while looking complete.
   *
   * ⚠️ NOT the same thing as `estate_docs` (the KV namespace above), despite
   * the near-identical name, and the two must not be merged. KV serves
   * hand-curated runbook PAGES keyed by slug; this serves the searchable
   * CORPUS, republished as a unit — 3 MB across ~119 files, where a KV rewrite
   * would be ~119 keys with eventual consistency and no atomic swap.
   *
   * ⚠️ The bucket has NO public r2.dev URL and NO custom domain (verified
   * 2026-08-18: "Public access via the r2.dev URL is disabled") and must never
   * get one. The corpus carries secret NAMES and where they live, break-glass
   * SQL, deploy levers, and household members' emails and role assignments —
   * PII plus an operations runbook. This binding behind `requireDevops()` is
   * the only way in.
   */
  ESTATE_DOCS?: R2Bucket;

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
   * The audiobook-worker's bearer (audiobook-auth-migration.md Phase 0) —
   * the fourth consumer of the same /seen pattern. Declared here; the
   * secret is minted and set at deploy time (`wrangler secret put
   * ESTATE_APP_TOKEN_AUDIOBOOK` on BOTH this Worker and the
   * audiobook-worker), never in this repo.
   */
  ESTATE_APP_TOKEN_AUDIOBOOK?: string;
  /**
   * The second library instance's bearer (friend-ingest design, provisioning
   * step 7) — declared here with the 0007 `vis_library2` column so the
   * directory can tell which door a newcomer knocked on (origin
   * 'seen:library2'). Minted and set here 2026-08-16.
   *
   * ⚠️ **IT WAS AN ORPHAN FOR A DAY** — set on THIS Worker and presented by
   * NOTHING (estate credentials catalog F-5, fixed 2026-08-17). The friend
   * instance runs the same build as the main library, and that build hard-coded
   * `app: 'library'` plus a hard-coded `ESTATE_APP_TOKEN_LIBRARY` read
   * (`library_catalog/packages/estate-auth/src/gate.ts`), so padhard knocked
   * wearing library's badge — and `identifyApp` resolves identity from the
   * token VALUE, never from a body field, so this Worker answered `library`
   * every time and had no way to notice. The consumer now declares its identity
   * per wrangler env (`ESTATE_APP`), and the app id selects the secret NAME.
   *
   * ⚠️ **The sentence this replaces argued the orphan was harmless** — *"if the
   * instance rides the shared `library` app token in the interim, /seen still
   * answers its visibility correctly — the effective set is per-PERSON, not
   * per-door"* — and it is quoted rather than deleted because it was TRUE and
   * MISLEADING at once. True: the set is per person, so nobody received a wrong
   * array. Misleading: it reasons about the ANSWER and is silent about the
   * QUESTION, and the question was wrong. A shared bearer means the directory
   * cannot attribute a sign-in (`origin='seen:library'` stamped on a newcomer
   * who has never touched our library), cannot rotate or revoke one door
   * without the other, and leaves `vis_library2` — a column created expressly
   * so that another household's shelf is granted BY HAND — describing a door
   * nobody knocks on. "The answer is still correct" is not the test for an
   * identity; being able to tell two callers apart is.
   */
  ESTATE_APP_TOKEN_LIBRARY2?: string;

  /**
   * ⚠️ **THE DISCORD DOCS DOOR (door B) — a NEW, SEPARATE trust edge.**
   *
   * Held by exactly TWO holders: this Worker and `apps/discord-worker`. Minted
   * once, piped to both under this same name, and read by ONE module here
   * (`estate-docs.ts`) and ONE module there (`docs-exec.ts`).
   *
   * ⚠️ **IT IS NOT `ESTATE_APP_TOKEN_DISCORD`, AND THE TWO MUST NEVER BE
   * MERGED.** That token already exists and already has three holders (the
   * discord-worker plus BOTH library Workers, minted 2026-08-18 for the Tier-1
   * delegated writes). Reusing it here would mean a leak from either library
   * instance also opened the estate's whole docs corpus — break-glass SQL,
   * deploy levers, secret names and household members' emails. A fresh trust
   * edge gets a fresh pair; that is the estate's standing rule and this is the
   * case it was written for.
   *
   * ⚠️ **DELIBERATELY NOT IN `CONSUMER_APPS`.** The /seen consumer list is what
   * `identifyApp()` resolves a bearer against, and adding this token there would
   * silently make it a valid /seen bearer — a wider capability than the one
   * being granted. It is a standalone field, consulted only by the docs routes'
   * own gate, so its blast radius is exactly the corpus.
   *
   * ⚠️ **WHAT HOLDING IT AUTHORISES: nothing on its own.** It proves only *"this
   * request came from the estate's Discord Worker"*. The request must ALSO carry
   * a proven email in `X-Estate-On-Behalf-Of`, and this Worker then resolves
   * THAT email against the directory and applies `devopsAllows()` — the same one
   * implementation door A uses. So the worst a leak buys is reading the corpus
   * on behalf of people who could already read it, and revoking someone's devops
   * in /admin still shuts the door on their next question with no deploy.
   *
   * ⚠️ SHIPS DARK while unset: `estate-docs.ts` never even compares the bearer,
   * so every request falls through to door A (Firebase ID token) exactly as it
   * did before phase 3. Nothing crashes and no door is left ajar.
   */
  ESTATE_APP_TOKEN_DISCORD_DOCS?: string;

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

  /**
   * ⚠️ **THE CONDUCTOR'S PUSH BEARER** — the write door on
   * `POST /api/estate/ops/agent-board` (src/agent-board.ts), added 2026-08-18
   * with the /status split's Agents page.
   *
   * ⚠️ **NOT A PORTAL VALUE — the conductor MINTS it** (`openssl rand -hex 32`)
   * and keeps the local copy under `docs/access/keys/` (gitignored, the
   * `firebase-sa-restore.json` custody precedent). ONE holder on the server
   * side: this Worker. Custody, rotation and the BOM-free transport:
   * `docs/access/agent-board.md`.
   *
   * ⚠️ **WHAT HOLDING IT AUTHORISES: overwriting one advisory JSON blob.** It
   * reads no Firestore, mints no token, grants no role and triggers no
   * pipeline. A leak buys the ability to lie to the owner about his own agent
   * capacity — worth rotating for, and a deliberately smaller blast radius
   * than every other secret in this file. Read by exactly ONE module
   * (`agent-board.ts`), pinned by `test/agent-board.test.ts`.
   *
   * ⚠️ **DELIBERATELY NOT A `CONSUMER_APPS` ENTRY**, for the same reason
   * `ESTATE_APP_TOKEN_DISCORD_DOCS` is not: adding it there would silently
   * make it a valid `POST /api/estate/seen` bearer, which is a wider
   * capability than the one being granted.
   *
   * ⚠️ **SHIPS DARK while unset** — POST answers a worded 503 naming this
   * secret and never falls back to accepting an unauthenticated write. The
   * GET side is unaffected: a devops reader sees an honest "nothing pushed yet".
   */
  ESTATE_CONDUCTOR_TOKEN?: string;
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
  /**
   * 0011: the per-person DEV-LANE grant (owner 2026-08-17, *"a way in the
   * estate to manage dev access for ebook… also make devops always able to see
   * dev envs"*). ⚠️ The STORED flag only — it means "granted by hand". The
   * EFFECTIVE answer is `devAccessAllows()` (middleware/auth.ts), which ORs in
   * `is_devops` / `is_approver` and requires `status = 'approved'`; never read
   * this number on its own to decide anything.
   *
   * ⚠️ Curtain, not lock: it gates the /dev/ lane's UI. `vis_ebooks` (0008),
   * enforced by apps/audiobook-worker on the manifest and stream APIs, remains
   * the only thing standing between anyone and an ebook's bytes.
   */
  dev_access: number;
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
  /** 0007: the second library instance. ⚠️ DEFAULT 0 — see the migration header. */
  vis_library2: number;
  /**
   * 0008: the household's shared ebook shelf. ⚠️ DEFAULT 0, and NOT in
   * PUBLIC_CATALOGS — this is the grant that also includes READING a book in
   * the browser (one grant, not two; see 0008's header).
   */
  vis_ebooks: number;
  /*
   * ⚠️ `dl_ebooks` (migration 0009) IS ABSENT FROM THIS ROW SHAPE ON PURPOSE,
   * and the column still exists in D1 — see 0010's header. Owner directive
   * 2026-08-17 superseded the per-person download checkbox one day after it
   * shipped: *"For ebooks I don't want a download check box, I want to use
   * roles we have. Set up the roles to match library."* Download is now a ROLE
   * capability on the audiobook ladder (`capabilities.ts`, floor `admin`), so
   * this Worker no longer SELECTs, writes or answers the column. Re-adding it
   * here is how the dead grant would come back to life — do not.
   */
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

/**
 * Every estate origin the credentialed session routes admit in production
 * (design §4.3). ⚠️ This is an ORIGIN list, not a site list. The cookie's
 * `Domain=.heygabi.ai` reaches all of them automatically, but credentialed
 * CORS is exact-origin by construction, so a surface MISSING from this array
 * cannot call the routes at all — its preflight comes back with no
 * `Access-Control-Allow-Origin` and the browser refuses. From the page's
 * point of view that is a SILENT failure (the bootstrap reads it as "no
 * session" and stays quiet, which is the designed degradation), so the list
 * is worth keeping exhaustive rather than approximately right.
 *
 * Widened 2026-08-18 for Phase 3 adoption, from the original four. Every
 * addition was MEASURED live that day, not assumed:
 *   - `www.heygabi.ai` — serves the apex with a 200 of its OWN rather than
 *     redirecting to the bare domain, so it is a genuine separate origin
 *     running estate-auth.js, and needs its own entry.
 *   - `ebooks.heygabi.ai` — the ebooks door (apps/ebooks-door) proxies the
 *     audiobook site's /ebooks page verbatim, so identity.js executes there
 *     under THIS origin. Per-origin Firebase persistence is precisely why
 *     the owner reported "Ebooks makes me login every time"; without this
 *     row the bootstrap could not fix the complaint that prompted the build.
 *   - `padhard.heygabi.ai` — the library's friend instance. Same web bundle
 *     as library.heygabi.ai (two Workers, one build), so it inherits the
 *     adoption code either way; only this entry makes the call it then
 *     attempts actually succeed.
 */
export const DEFAULT_SESSION_ORIGINS = [
  'https://heygabi.ai',
  'https://www.heygabi.ai',
  'https://audiobooks.heygabi.ai',
  'https://ebooks.heygabi.ai',
  'https://library.heygabi.ai',
  'https://padhard.heygabi.ai',
  'https://boardgames.heygabi.ai',
];

/**
 * SESSION_ORIGINS, parsed — unset falls back to the production list above
 * (never to ADMIN_ORIGINS/ME_ORIGINS, which is either too narrow or the
 * wrong set of surfaces entirely), so the credentialed routes are correct
 * even before an operator ever visits `.dev.vars` or the production vars.
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
    case 'audiobook':
      return env.ESTATE_APP_TOKEN_AUDIOBOOK;
    case 'library2':
      return env.ESTATE_APP_TOKEN_LIBRARY2;
  }
}
