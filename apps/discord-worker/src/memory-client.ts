/**
 * **PHASE 2 — shared memory client.**
 *
 * Calls the library_catalog Worker's `GET/PUT /api/gabi/memory` endpoint to
 * load and save conversation records in the shared D1 store, keyed by the
 * asker's Firebase UID under the `'shared'` surface key.
 *
 * ## ⚠️ THE GRACEFUL DEGRADATION CONTRACT
 *
 * This client NEVER throws. A network failure, a 404 (unknown user), a 503
 * (endpoint not configured), or any unexpected shape all result in `null` on
 * load and a silent no-op on save. The caller's conversation MUST work without
 * memory — just without continuity across surfaces.
 *
 * ## Auth
 *
 * Uses the same `ESTATE_APP_TOKEN_DISCORD` bearer that the delegated writes
 * path uses. The library endpoint validates it identically.
 *
 * ## ⚠️ NO CREDENTIAL LIVES HERE — only the call shapes. The token is passed
 * in by the composition root, following the same pattern as `delegated-exec.ts`.
 */

import type { ConversationRecord, ConversationTurn } from './conversation.js';

/** How long to wait for the memory endpoint before giving up. A memory read
 * must never block a reply somebody is waiting for. */
const MEMORY_TIMEOUT_MS = 5_000;

/**
 * Load the shared conversation memory for one person from the library endpoint.
 *
 * Returns the stored `ConversationRecord` or `null` when:
 * - the user has no stored memory (404)
 * - the endpoint is not configured (503)
 * - the endpoint is unreachable or times out
 * - the response shape is unexpected
 *
 * ⚠️ Never throws.
 */
export async function loadSharedMemory(
  instanceUrl: string,
  token: string,
  firebaseUid: string,
): Promise<ConversationRecord | null> {
  try {
    const res = await fetch(
      `${instanceUrl}/api/gabi/memory?person=${encodeURIComponent(firebaseUid)}`,
      {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(MEMORY_TIMEOUT_MS),
      },
    );
    // 404 = unknown user or no stored memory — normal, not an error.
    // 503 = endpoint not configured on that instance.
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      record?: ConversationRecord;
    } | null;
    if (!body?.ok || !body.record) return null;
    return body.record;
  } catch (err) {
    console.error(
      'GABI shared memory: load failed (degrading to no-memory):',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Save conversation turns to the shared memory endpoint.
 *
 * ⚠️ Never throws. A failed save means the next surface that reads will not
 * see this conversation — an acceptable loss compared to blocking or crashing
 * the current reply.
 */
export async function saveSharedMemory(
  instanceUrl: string,
  token: string,
  firebaseUid: string,
  turns: ConversationTurn[],
): Promise<void> {
  try {
    const res = await fetch(`${instanceUrl}/api/gabi/memory`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ person: firebaseUid, turns }),
      signal: AbortSignal.timeout(MEMORY_TIMEOUT_MS),
    });
    // Log failures but never propagate them.
    if (!res.ok) {
      console.error(
        `GABI shared memory: save failed (HTTP ${res.status}). The conversation continues; ` +
          'cross-surface continuity may be stale.',
      );
    }
  } catch (err) {
    console.error(
      'GABI shared memory: save failed (degrading gracefully):',
      err instanceof Error ? err.message : err,
    );
  }
}
