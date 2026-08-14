/**
 * The per-surface posture declaration (owner decision #1, 2026-08-13):
 * machinery is normalized estate-wide; POSTURE is per-surface policy. Every
 * consumer declares `public: true|false` EXPLICITLY, so "what is open" is a
 * greppable, deliberate list — grep for `public: true` across the estate and
 * you have the audit.
 *
 * (The audiobook site is public by that standing decision and consumes
 * nothing from this module — it has no server to consume it with.)
 */

export interface EstateAuthConfig {
  /**
   * `true` = this surface serves without authentication, ON PURPOSE, and the
   * declaration is the record of that decision. `false` = every data route
   * sits behind the canonical verifier + estate check.
   */
  public: boolean;
  /** Consumer name — also selects its ESTATE_APP_TOKEN_* and its `seen:<app>` origin. */
  app: string;
  /**
   * The app-owned default-grant mapping (§5.4): the local role assigned when
   * the estate says `approved` and the local row was never decided. Library:
   * 'reader'; games: 'viewer' (owner decision #2). Config the APPS own — the
   * directory never learns role vocabularies. Must be null on public surfaces
   * and on surfaces with no local role table (the index).
   */
  defaultRole: string | null;
}

/** Validate + freeze a posture declaration. Throws on an incoherent one. */
export function declareAuthPosture(config: EstateAuthConfig): Readonly<EstateAuthConfig> {
  // Runtime guards for JS callers; TS callers get these at compile time.
  if (typeof config.public !== 'boolean') {
    throw new Error(
      'estate-auth: `public` must be explicitly true or false — an implicit posture is exactly what this declaration exists to forbid',
    );
  }
  if (!config.app || typeof config.app !== 'string') {
    throw new Error('estate-auth: `app` must name the consumer');
  }
  if (config.public && config.defaultRole !== null) {
    throw new Error(
      `estate-auth: a public surface cannot carry a defaultRole (got '${config.defaultRole}') — nothing is granted on an open door`,
    );
  }
  return Object.freeze({ ...config });
}
