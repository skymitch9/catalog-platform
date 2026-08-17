/** Bindings for the estate Discord Worker. All four are wrangler secrets —
 * see wrangler.toml's trailing comment for the exact `wrangler secret put`
 * names and custody notes. Everything is optional at the type level because
 * a missing secret must produce a WORDED 503/ephemeral answer, never a
 * crash (the estate's no-bare-status rule). */
export interface Env {
  ENVIRONMENT?: string;
  /** Pinned to the shared estate project (`audiobook-catalog`) in
   * wrangler.toml, exactly as every sibling Worker pins it. The canonical
   * verifier asserts it as BOTH issuer and audience — remove it and the
   * link ceremony would accept any Firebase project's tokens, which is not
   * a smaller check but no check. A plain var, not a secret: it is a
   * project name, and it appears in every browser bundle already. */
  FIREBASE_PROJECT_ID?: string;
  /** Comma-separated estate break-glass addresses, mirroring auth-worker's
   * var of the same name. Read ONLY by the command-registration gate. */
  OWNER_EMAILS?: string;
  /** Portal → General Information → Public Key (64 hex chars). Verifies
   * every incoming interaction's Ed25519 signature. */
  DISCORD_PUBLIC_KEY?: string;
  /** Portal → General Information → Application ID. Also arrives on every
   * interaction payload; the env value wins when both exist. */
  DISCORD_APPLICATION_ID?: string;
  /** Portal → Bot → Reset Token. Still NOT consumed by the poll-VOTE path
   * (those edits ride the interaction token). Consumed by exactly two things:
   * the slash-command registration route (commands.ts) and phase 3's sync
   * tick (poll-sync.ts), which posts and edits real channel messages with it —
   * the first place §1.2's shared blast radius is actually exercised. */
  DISCORD_BOT_TOKEN?: string;
  /** Portal → OAuth2 → **Client Secret**. A DIFFERENT credential from the bot
   * token: it authenticates the APPLICATION during the identity-link code
   * exchange and can mint no bot powers. ⚠️ NOT SET YET — the link ceremony
   * ships dark behind its absence and answers a worded "linking is not
   * configured yet" page until the owner sets it (docs/access/discord-bot.md
   * §3 step 7). It also derives the HMAC key for the pending-link cookie, so
   * rotating it invalidates in-flight link attempts and nothing else. */
  DISCORD_CLIENT_SECRET?: string;
  /** The same service-account JSON auth-worker holds — Firestore REST
   * access for vote writes. See src/firebase-sa.ts. */
  FIREBASE_SERVICE_ACCOUNT?: string;
  /** The shared secret gating `POST /polls/sync` (phase 3, src/poll-sync.ts).
   * The SAME value is held by the audiobook pipeline, which calls the route on
   * `club_announcements.py`'s cadence. A THIRD credential class, deliberately
   * distinct from the bot token and the client secret: leaking it lets someone
   * make the bot re-render its own poll messages sooner than it would have —
   * it grants no Discord powers, reads no Firestore of its own, and cannot
   * post anything a poll doc does not already say. ⚠️ SHIPS DARK while unset:
   * the route answers a worded 503 and `/api/health` reports
   * `configured.poll_sync_token: false`. */
  POLL_SYNC_TOKEN?: string;
}

export type AppBindings = { Bindings: Env };
