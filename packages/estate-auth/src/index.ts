/**
 * @platform/estate-auth — the canonical estate auth module (design §8, §14.2).
 *
 * One implementation of: verify-locally → check-membership → cache-on-user-row,
 * plus the per-surface `public:` posture declaration and the §8.2 conformance
 * probes. Consumers take this the way the library takes `universes`: fetched
 * at build from the sibling checkout (`CATALOG_PLATFORM_DIR` override), or as
 * a workspace dependency inside this repo (the auth Worker does).
 *
 * ⚠️ The two drifted per-app `auth.ts` copies are the reason this exists
 * (design §1.1). Adopting it in an app REPLACES the app's local verifier —
 * do not keep both.
 */

export { resolveIdentity, readBearer, type Identity, type VerifierEnv } from './verify.js';
export {
  combineEstateAndLocal,
  isEstateStatus,
  type EstateStatus,
  type LocalStanding,
  type EstateVerdict,
} from './combine.js';
export {
  REVOCATION_DELAY_MS,
  cacheIsFresh,
  postSeen,
  estateCheck,
  type SeenCache,
  type SeenClientOptions,
  type SeenIdentity,
  type EstateCheckResult,
} from './seen.js';
export { declareAuthPosture, type EstateAuthConfig } from './config.js';
export {
  runConformanceProbes,
  probesPassed,
  type ProbeTarget,
  type ProbeRoute,
  type ProbeResult,
} from './probes.js';
