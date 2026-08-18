/**
 * ⚠️ **THE ONLY MODULE IN GABI'S CONVERSATIONAL PATH THAT TOUCHES A
 * CREDENTIAL.** That is this file's whole reason for existing as a file.
 *
 * Until 2026-08-18 the mention path was 100% credential-free and
 * `test/mentions.test.ts` asserted it. The owner's Tier-1 approval ended that
 * property on purpose (`delegated.ts`'s header carries the decision and the
 * quotes). What replaces it is not "credentials are now allowed in the chat
 * path" — it is:
 *
 * > **Credentials live HERE and nowhere else.** `mention-flow.ts`,
 * > `gabi-chat.ts`, `tool-exec.ts`, `catalog-data.ts` and `have.ts` name no
 * > service account, no app token and no Firestore client, and reach this file
 * > only through the injected `DelegatePort` they cannot construct.
 *
 * `test/delegated.test.ts` reads all six sources and fails the build if either
 * half of that stops being true — the same shape of guard the old property had,
 * pointed at the new one.
 *
 * ## The two credentials, and what each is for
 *
 * | Credential | Used for | What it can do |
 * |---|---|---|
 * | `FIREBASE_SERVICE_ACCOUNT` (scope `datastore` only) | reading `discord_links/{id}` | read the link document the PERSON created; it is how "who is this?" is answered without ever guessing from a username |
 * | `ESTATE_APP_TOKEN_DISCORD` | the `Authorization: Bearer` on every delegated call | prove the caller is this Worker. ⚠️ **Authorises no write.** The destination site resolves the uid to its own `app_user` row and checks THAT person's capability |
 *
 * ⚠️ Neither is ever logged, echoed, put in a message, or returned to a caller.
 * The service account is the same value and custody `poll-vote.ts` already
 * holds, and this file adds no new scope to it — a link read is the identical
 * operation the vote path makes.
 *
 * ## What it will not do
 *
 * It sends the uid and (for `add-isbn`) the ISBN. Not the Discord id, not the
 * display name, not the channel, not the message text. The destination needs an
 * identity and a number; anything else would be telling a catalog about a
 * conversation.
 */

import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';
import type { Env } from './env.js';
import {
  DELEGATE_MSG,
  libraryInstances,
  type DelegatePort,
  type DelegatedCallResult,
  type LibraryInstance,
  type WhoAmI,
} from './delegated.js';
import type { GabiDelegatedVerbName } from './gabi-tools.js';

/** How long a delegated call may take before it is written off.
 *
 * ⚠️ **Ninety seconds, matching the library's own `RESEARCH_TIMEOUT_MS`**, and
 * that is not generosity: a details lookup genuinely takes 20–90 s and the
 * sweep may do two of them. A shorter timeout here would abandon a sweep that
 * is *working* — and, worse, the writes would still land while GABI reported an
 * outage. `add-isbn` is seconds; it shares the ceiling rather than getting a
 * second number nobody would keep in step.
 */
const CALL_TIMEOUT_MS = 180_000;

/** Reading one link document is a Firestore GET and nothing more. */
const LINK_TIMEOUT_MS = 10_000;

type FsValue = { stringValue?: unknown };
type FsDoc = { fields?: Record<string, FsValue> };

/**
 * `discord_links/{discordUserId}.firebaseUid` — the estate half of the link
 * ceremony's two proofs (`link.ts`).
 *
 * ⚠️ **`firebaseUid`, not `slug` and not `displayName`.** The poll path reads
 * the other two because a vote is filed under a club member slug; a catalog
 * write is filed under a Firebase account, and the uid is the only identifier
 * that survives an email change and that the destination can resolve without
 * trusting a name. It is also the only field of the four this file reads at all.
 */
function uidFromLinkDoc(doc: FsDoc): string | null {
  const raw = doc.fields?.firebaseUid?.stringValue;
  if (typeof raw !== 'string') return null;
  const uid = raw.trim();
  return uid.length >= 8 && uid.length <= 128 ? uid : null;
}

/**
 * Build the port the conversational path is handed.
 *
 * ⚠️ Returns `null` when the estate has not finished the wiring — no service
 * account, or no app token. A null port is how "ships dark" is expressed: the
 * flow says a worded line and the read-only ladder is untouched. It is never a
 * half-configured port that fails at the moment somebody asks.
 */
export function makeDelegate(env: Env): DelegatePort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  const token = env.ESTATE_APP_TOKEN_DISCORD;
  if (!rawSa || !token) return null;

  const instances = libraryInstances(env);
  if (instances.length === 0) return null;

  return {
    async linkedUid(discordUserId) {
      try {
        const sa = parseServiceAccount(rawSa);
        // ⚠️ Unparseable JSON is a CONFIGURATION fault, not a person's fault —
        // and it must not be reported as "you are not linked", which would send
        // somebody to re-run a ceremony that is working fine.
        if (!sa) {
          console.error('GABI delegated: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
          return { ok: false, reason: 'outage' };
        }
        const accessToken = await mintAccessToken(sa);
        const res = await firestoreRequest(
          sa,
          accessToken,
          'GET',
          `discord_links/${encodeURIComponent(discordUserId)}`,
        );
        // 404 is the ORDINARY answer for somebody who has never linked. It is
        // not an outage and must never be worded as one.
        if (res.status === 404) return { ok: false, reason: 'unlinked' };
        if (!res.ok) {
          console.error(`GABI delegated: link read failed (HTTP ${res.status}).`);
          return { ok: false, reason: 'outage' };
        }
        const uid = uidFromLinkDoc((await res.json()) as FsDoc);
        // A link document with no uid is a PRE-UID link (or a corrupted one).
        // Treated as unlinked, because it cannot prove an estate account —
        // which is exactly what "unlinked" means. Re-running /link fixes it.
        return uid ? { ok: true, uid } : { ok: false, reason: 'unlinked' };
      } catch (err) {
        console.error('GABI delegated: link read threw:', err instanceof Error ? err.message : err);
        return { ok: false, reason: 'outage' };
      }
    },

    async whoami(instance, uid) {
      const result = await post(instance, 'whoami', { onBehalfOf: uid }, token, LINK_TIMEOUT_MS);
      if (!result.res) return null;
      if (!result.res.ok) {
        // ⚠️ A 401/503 here is a CONFIGURATION answer, not "they have no
        // account". Reported as unreachable so `chooseInstances` words it as
        // our problem — the one distinction that must never collapse.
        console.error(`GABI delegated: ${instance.app} whoami answered ${result.res.status}.`);
        return null;
      }
      const body = (await result.res.json().catch(() => null)) as WhoAmI | null;
      return body && typeof body.known === 'boolean' ? body : null;
    },

    async call(instance, verb, uid, body) {
      const { res, error } = await post(
        instance,
        verb,
        { onBehalfOf: uid, ...(body ?? {}) },
        token,
        CALL_TIMEOUT_MS,
      );
      if (!res) {
        console.error(`GABI delegated: ${instance.app} ${verb} unreachable — ${error}`);
        return {
          ok: false,
          status: 0,
          message: DELEGATE_MSG.siteUnreachable(instance.label),
          instance,
        };
      }
      const payload = (await res.json().catch(() => null)) as
        | { message?: unknown; outcome?: unknown }
        | null;
      const message =
        typeof payload?.message === 'string' && payload.message.trim()
          ? payload.message.trim()
          : // The destination answered something with no sentence in it, which
            // is a bug there rather than a fact about this request. Never a bare
            // status to a person — the estate's rule, applied to our own bug.
            DELEGATE_MSG.siteUnreachable(instance.label);
      return {
        ok: res.ok,
        status: res.status,
        message,
        ...(typeof payload?.outcome === 'string' ? { outcome: payload.outcome } : {}),
        instance,
      };
    },
  };
}

/**
 * One POST to one instance. ⚠️ Never throws: an unreachable site is a `null`
 * response the caller words, not an exception that would surface as a silent
 * nothing inside a Durable Object's socket handler.
 */
async function post(
  instance: LibraryInstance,
  verb: GabiDelegatedVerbName,
  body: Record<string, unknown>,
  token: string,
  timeoutMs: number,
): Promise<{ res: Response | null; error?: string }> {
  try {
    const res = await fetch(`${instance.baseUrl}/api/gabi/delegated/${verb}`, {
      method: 'POST',
      headers: {
        // ⚠️ The one place this value appears in an outbound request, and it
        // goes only to a hostname this Worker's own config names.
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { res };
  } catch (err) {
    return { res: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Re-exported for the composition roots, so neither has to import two files
 * to wire one port. */
export type { DelegatePort, DelegatedCallResult };
