/**
 * ⚠️ **THE FOURTH — AND ONLY OTHER — MODULE IN GABI'S CONVERSATIONAL PATH THAT
 * TOUCHES A CREDENTIAL.** That is this file's whole reason for existing as a
 * file, exactly as it is `delegated-exec.ts`'s, `estate-docs-exec.ts`'s and
 * `book-knowledge-exec.ts`'s.
 *
 * The property those three established, widened once more **on purpose** and
 * with the test widened alongside it rather than deleted:
 *
 * > **Credentials appear ONLY in `delegated-exec.ts`, `estate-docs-exec.ts`,
 * > `book-knowledge-exec.ts` and `memory-exec.ts`.** Everything else in the chat
 * > path reaches every gated store through INJECTED ports it cannot construct.
 *
 * ⚠️ Widening a mechanical guard is a decision somebody makes on purpose and
 * writes down. Four modules, each one trust edge, each named in a test — never
 * "credentials are allowed in the chat path now".
 *
 * ## ⚠️ WHY THIS ONE NEEDS NO NEW SECRET, AND THAT IS THE POINT
 *
 * It uses `FIREBASE_SERVICE_ACCOUNT`, which this Worker **already holds** for
 * reading `discord_links/{id}`, at the same `datastore` scope. Design §4.1: the
 * decisive argument for Firestore over D1 was that it is the only store BOTH
 * GABI surfaces already reach, and the second was that **no new trust edge, no
 * new secret and no new holder** is created. A profile store that needed a
 * fourth app token would have been a materially more expensive feature.
 *
 * ## What it stores, and what it must never store
 *
 * `gabi_profiles/{personKey}` — a ≤2 KB note about ONE person, built only from
 * that person's own conversations. ⚠️ It holds no retrieved book text (book
 * design §8 forbids writing passages even to the ephemeral window; a profile is
 * a more durable version of that window) and no claim about what GABI has read.
 */

import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';
import type { Env } from './env.js';
import {
  capProfile,
  parseProfile,
  PROFILE_SHAPE_VERSION,
  type MemoryPort,
  type MemoryProfile,
} from './memory.js';

/** ⚠️ Its own collection. Not a field on `discord_links` — that document is the
 *  identity join and is read on the hot path of every gated call; growing it
 *  with prose would make every book question pay for a profile it did not ask
 *  for. Separate concerns, separate documents. */
export const PROFILE_COLLECTION = 'gabi_profiles';

/** Firestore rejects `/` and a few others in a document id; a person key is
 *  `estate:<email>` or `discord:<snowflake>`, so the colon is fine and the email
 *  is the only thing that could carry a slash. Encoded rather than trusted. */
function docPath(person: string): string {
  return `${PROFILE_COLLECTION}/${encodeURIComponent(person)}`;
}

type FsValue = { stringValue?: unknown; integerValue?: unknown };
type FsDoc = { fields?: Record<string, FsValue> };

/**
 * ⚠️ **THE WHOLE PROFILE IS ONE JSON STRING FIELD, DELIBERATELY.**
 *
 * Firestore's typed-value encoding for nested arrays of maps is verbose and
 * fiddly, and every field we mapped individually would be a second place the
 * schema lives — one that could drift from `memory.ts`'s caps without failing
 * anything. One `json` string field means `parseProfile` is the ONLY validator,
 * on read and on write, and a shape change is one function.
 *
 * ⚠️ The cost of that choice, stated: Firestore cannot query INSIDE the profile.
 * Nothing needs to — profiles are fetched by person key and never searched.
 */
function toFirestore(profile: MemoryProfile): unknown {
  return {
    fields: {
      json: { stringValue: JSON.stringify(profile) },
      v: { integerValue: String(PROFILE_SHAPE_VERSION) },
      updatedAt: { integerValue: String(profile.updatedAt) },
    },
  };
}

function fromFirestore(doc: FsDoc, person: string): MemoryProfile | null {
  const raw = doc.fields?.json?.stringValue;
  if (typeof raw !== 'string') return null;
  return parseProfile(raw, person);
}

/**
 * Build the port the conversational path is handed.
 *
 * ⚠️ Returns `null` when the service account is absent — the ships-dark state,
 * expressed the same way the other three ports express it. A null port means no
 * profile is loaded, no prompt block is added, and nothing is written; every
 * other answer is untouched.
 */
export function makeMemoryPort(env: Env): MemoryPort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  if (!rawSa) return null;

  /** ⚠️ Minted per operation rather than held. A port outlives a single turn
   *  here (the cron's sweep uses one across several conversations), and a cached
   *  OAuth token that outlived a secret rotation would fail every write with no
   *  obvious cause. */
  async function auth(): Promise<{ sa: ReturnType<typeof parseServiceAccount>; token: string } | null> {
    const sa = parseServiceAccount(rawSa);
    if (!sa) {
      // ⚠️ Unparseable JSON is a CONFIGURATION fault, and it must be loud: every
      // profile read and write fails silently otherwise, which looks exactly
      // like "she just doesn't remember".
      console.error('GABI memory: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
      return null;
    }
    return { sa, token: await mintAccessToken(sa) };
  }

  return {
    async load(person) {
      try {
        const a = await auth();
        if (!a?.sa) return null;
        const res = await firestoreRequest(a.sa, a.token, 'GET', docPath(person));
        // 404 is the ORDINARY answer for somebody she has never noted anything
        // about. Not an outage, and never logged as one.
        if (res.status === 404) return null;
        if (!res.ok) {
          console.error(`GABI memory: profile read failed (HTTP ${res.status}).`);
          return null;
        }
        return fromFirestore((await res.json()) as FsDoc, person);
      } catch (err) {
        console.error('GABI memory: profile read threw:', err instanceof Error ? err.message : err);
        return null;
      }
    },

    async save(profile) {
      try {
        const a = await auth();
        if (!a?.sa) return false;
        // ⚠️ Capped again HERE, on the way out. `memory.ts` caps at the point of
        // distillation, and this is the last gate before something durable — a
        // second application costs nothing and closes the path where a future
        // caller writes an uncapped profile it built itself.
        const safe = capProfile(profile);
        const res = await firestoreRequest(
          a.sa,
          a.token,
          'PATCH',
          docPath(safe.person),
          toFirestore(safe),
        );
        if (!res.ok) console.error(`GABI memory: profile write failed (HTTP ${res.status}).`);
        return res.ok;
      } catch (err) {
        console.error('GABI memory: profile write threw:', err instanceof Error ? err.message : err);
        return false;
      }
    },

    async clear(person) {
      try {
        const a = await auth();
        if (!a?.sa) return false;
        // ⚠️ A REAL DELETE. "Forget it" that leaves a tombstone is not forgetting,
        // and a person who asked to be forgotten is owed the row being gone.
        const res = await firestoreRequest(a.sa, a.token, 'DELETE', docPath(person));
        // 404 means there was nothing there — which is the state they asked for.
        const ok = res.ok || res.status === 404;
        if (!ok) console.error(`GABI memory: profile delete failed (HTTP ${res.status}).`);
        return ok;
      } catch (err) {
        console.error('GABI memory: profile delete threw:', err instanceof Error ? err.message : err);
        return false;
      }
    },
  };
}

/** Re-exported for the composition roots, so neither has to import two files. */
export type { MemoryPort };
