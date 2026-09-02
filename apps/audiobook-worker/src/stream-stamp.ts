/**
 * The EVICTION ACCESS STAMP — `audio_streams/{anchor}`.
 * **Audio player phase 2, the platform half**, built 2026-09-02.
 *
 * Design of record: `docs/info/audio-player-design.md` §10.1, verbatim:
 *
 * > *"the byte route stamps `audio_streams/{anchor}` = `{ anchor,
 * > lastStreamAt }` through the service account, **throttled to at most one
 * > write per anchor per isolate per hour** (a module-level `Map<anchor,
 * > lastWrittenMs>`, the same per-isolate trade `read-budget.ts` documents —
 * > a missed stamp only delays an eviction, never causes one)."*
 *
 * The other end of the seam is `audiobook_catalog`'s
 * `app/tools/fulfill_audio_requests.py` — `parse_stream_doc()` reads these
 * documents and `merge_stream_stamps()` joins them onto the manifest, and
 * `evict_candidates()` refuses to delete anything a stamp calls recent.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 THE CONTRACT, and it is a CROSS-REPO one — copied verbatim from
 * `parse_stream_doc`'s docstring, which is where it was written down first:
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * > `audio_streams/{anchor}` = `{ anchor: string, lastStreamAt: number }`,
 * > `lastStreamAt` being **epoch MILLISECONDS**. The document id IS the
 * > anchor; `anchor` is carried in the body too so a doc read on its own is
 * > self-describing.
 *
 * ⚠️ **`Date.now()` — milliseconds — NOT a `timestampValue` and NOT seconds.**
 * `toFsValue` encodes an integer as Firestore's `integerValue`, which the
 * reader accepts; its `_parse_stamp` divides by 1000 only above 1e11, so a
 * SECONDS stamp would be read as a date in 1970 and the book would look
 * abandoned. That is the failure that DELETES a book somebody is halfway
 * through, which is why the units are named three times between here and
 * there.
 *
 * ## ⚠️ Why the byte route and NOT a client ping
 *
 * A `POST /api/audio/:anchor/stream-ping` existed here from 2026-08-19 and was
 * **deleted** when this landed. The design and the player's phase-2 build both
 * name a client-driven ping as the wrong shape: it is spoofable (the stamp is
 * what keeps a file alive, so the ability to forge one is the ability to keep
 * a dead book on the bill for ever), it is one request per listener where this
 * is zero, and it had no caller — `audiobook_catalog`'s
 * `tests/test_listen_page.py` asserts that no site JavaScript mentions it.
 *
 * ⚠️ **And the deleted route wrote the caller's EMAIL into the document**
 * (`updatedBy`). `firestore.rules` gives `audio_streams` `allow read: if true`
 * — deliberately, because the evictor lists it with the public web API key —
 * so that field put household addresses in a world-readable collection.
 * **Nothing personal is written here.** The document names a book and a
 * moment; it never names a person.
 *
 * ## The throttle, and what it trades
 *
 * A module-level `Map`, so it is PER ISOLATE: a book streamed through five
 * isolates can be stamped five times an hour, and an isolate that is recycled
 * forgets. Both directions of that error are safe, because the stamp only ever
 * makes a book look MORE recently used, and `merge_stream_stamps()` takes the
 * newest — a duplicate costs one Firestore write, a missed one delays an
 * eviction by an hour. The unsafe direction (a stamp that is too OLD) is
 * unreachable from here.
 *
 * ⚠️ **The slot is CLAIMED BEFORE the write, not after it** — audit finding L9
 * on the deleted route, which recorded the key only on success and so re-did
 * the whole mint-and-write on every single range request while Firestore was
 * failing. Claiming first means a persistent failure costs one attempt an hour
 * instead of one per request.
 *
 * ## One lane, on purpose
 *
 * The reader looks in **both** `audio_streams` and `audio_streams_dev` and
 * takes the newest. This Worker writes **only** `audio_streams`, because
 * nothing in a request can tell the lanes apart: the site's `/dev/` lane is a
 * PATH on the same host, so the Origin, the host and the bearer are identical.
 * A guess would be a wrong answer half the time; one collection both lanes
 * land in is the correct one, and the reader's union makes it invisible.
 *
 * ## It can never break playback
 *
 * Every failure — no service account, a token that will not mint, a Firestore
 * 500, a network error — is swallowed and logged. `stampStreamInBackground`
 * rides `waitUntil` so the bytes are never delayed by a Firestore round trip,
 * and the promise cannot reject. ⚠️ An eviction stamp that could 500 a byte
 * route would trade a silently-growing bucket for a broken player.
 */

import { mintAccessToken, parseServiceAccount } from '@platform/firebase-sa';
import { patchFsDoc, toFsFields, type FsValue } from './fs-docs.js';
import { SA_SCOPES } from './roles.js';
import type { Env } from './env.js';

/**
 * ⚠️ The PROD lane only — see the module doc. The reader's
 * `STREAM_COLLECTIONS` is the two-element union; this is the half we write.
 */
export const STREAM_STAMP_COLLECTION = 'audio_streams';

/** Design §10.1: at most one write per anchor per isolate per HOUR. */
export const STREAM_STAMP_THROTTLE_MS = 60 * 60 * 1000;

/**
 * The field paths the PATCH masks. ⚠️ A mask, never a full-document replace:
 * phase 3 may add fields to this document, and an unmasked write would delete
 * whatever it did not know about.
 */
export const STREAM_STAMP_FIELD_PATHS = ['anchor', 'lastStreamAt'];

/** anchor → the ms at which this isolate last claimed a write. */
const claimedAt = new Map<string, number>();

/** Tests only — a per-isolate Map is state the suite must be able to drop. */
export function resetStreamStamps(): void {
  claimedAt.clear();
}

/**
 * Claim the hour's slot for `anchor`. `true` exactly once an hour per isolate;
 * ⚠️ it MUTATES on success, so a caller that claims must go on to attempt the
 * write (or lose that hour, which is safe — see the module doc).
 */
export function claimStreamStamp(anchor: string, now: number = Date.now()): boolean {
  const previous = claimedAt.get(anchor);
  if (previous !== undefined && now - previous < STREAM_STAMP_THROTTLE_MS) return false;
  claimedAt.set(anchor, now);
  return true;
}

/**
 * The document body. Exported so a test can pin the WIRE SHAPE rather than the
 * function that produced it — this is a cross-repo contract, and the only
 * thing that makes it real is the bytes on the wire.
 */
export function streamStampFields(anchor: string, now: number): Record<string, FsValue> {
  return toFsFields({ anchor, lastStreamAt: now });
}

export type StampOutcome =
  /** The PATCH succeeded. */
  | 'written'
  /** Inside the hour — nothing attempted, nothing wrong. */
  | 'throttled'
  /** No (or unusable) service account — the deployment is short a secret. */
  | 'unconfigured'
  /** Mint or PATCH failed. Logged, swallowed; playback is unaffected. */
  | 'failed';

/**
 * Stamp `audio_streams/{anchor}`. ⚠️ **NEVER REJECTS** — the outcome is the
 * return value, because a throw here would surface as a 500 on a byte route
 * that had already decided to serve.
 *
 * ⚠️ `anchor` must already have been resolved through the gated manifest by
 * the caller (audit finding F3: a client-supplied string must never name the
 * document a rules-bypassing service account writes). It is encoded here too,
 * belt to that lookup's braces.
 */
export async function stampStream(
  env: Env,
  anchor: string,
  now: number = Date.now(),
): Promise<StampOutcome> {
  if (!anchor) return 'unconfigured';

  // Cheapest check first: an in-hour anchor costs one Map lookup and no crypto.
  const previous = claimedAt.get(anchor);
  if (previous !== undefined && now - previous < STREAM_STAMP_THROTTLE_MS) return 'throttled';

  let sa;
  try {
    sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    // A present-but-malformed secret. ⚠️ Named, never silent — this is the
    // shape of "eviction quietly stopped learning" that nobody notices for a
    // month. parseServiceAccount reports the missing FIELD, never a value.
    console.warn('[stream-stamp] service account unusable:', (err as Error).message);
    return 'unconfigured';
  }
  if (!sa) return 'unconfigured';

  // ⚠️ Claim BEFORE the fallible part (finding L9) — see the module doc.
  claimedAt.set(anchor, now);

  try {
    const token = await mintAccessToken(sa, SA_SCOPES);
    const path = `${STREAM_STAMP_COLLECTION}/${encodeURIComponent(anchor)}`;
    const res = await patchFsDoc(sa, token, path, streamStampFields(anchor, now), {
      fieldPaths: STREAM_STAMP_FIELD_PATHS,
    });
    if (res.ok) return 'written';
    console.warn('[stream-stamp] Firestore refused the stamp:', res.status, anchor);
    return 'failed';
  } catch (err) {
    console.warn('[stream-stamp] stamp failed:', (err as Error).message, anchor);
    return 'failed';
  }
}

/** The minimum of an ExecutionContext this module needs. */
export interface WaitUntilCtx {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Fire the stamp off the response path.
 *
 * ⚠️ `c.executionCtx` **THROWS** in Hono when the app was invoked without one
 * (which is exactly how `app.request()` is called in this Worker's tests), so
 * it is read inside a try. With no context the promise simply floats — it
 * cannot reject, and the tests that reach here run with no service account, so
 * it returns before touching the network.
 */
export function stampStreamInBackground(
  ctx: { executionCtx?: WaitUntilCtx },
  env: Env,
  anchor: string,
): void {
  const promise = stampStream(env, anchor).then(
    () => undefined,
    () => undefined,
  );
  try {
    ctx.executionCtx?.waitUntil(promise);
  } catch {
    /* No ExecutionContext (tests, or a non-fetch invocation) — let it float. */
  }
}
