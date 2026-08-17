/** Bindings for the estate Discord Worker. All four are wrangler secrets —
 * see wrangler.toml's trailing comment for the exact `wrangler secret put`
 * names and custody notes. Everything is optional at the type level because
 * a missing secret must produce a WORDED 503/ephemeral answer, never a
 * crash (the estate's no-bare-status rule). */
export interface Env {
  ENVIRONMENT?: string;
  /** Portal → General Information → Public Key (64 hex chars). Verifies
   * every incoming interaction's Ed25519 signature. */
  DISCORD_PUBLIC_KEY?: string;
  /** Portal → General Information → Application ID. Also arrives on every
   * interaction payload; the env value wins when both exist. */
  DISCORD_APPLICATION_ID?: string;
  /** Portal → Bot → Reset Token. NOT consumed by the poll-vote path (edits
   * ride the interaction token); held for phase-3 bot-posted messages. */
  DISCORD_BOT_TOKEN?: string;
  /** The same service-account JSON auth-worker holds — Firestore REST
   * access for vote writes. See src/firebase-sa.ts. */
  FIREBASE_SERVICE_ACCOUNT?: string;
}

export type AppBindings = { Bindings: Env };
