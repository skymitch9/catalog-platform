/**
 * ⚠️ **THE SECOND — AND ONLY OTHER — MODULE IN GABI'S CONVERSATIONAL PATH THAT
 * TOUCHES A CREDENTIAL.** That is this file's whole reason for existing as a
 * file, exactly as it is `delegated-exec.ts`'s.
 *
 * The property `delegated-exec.ts` established on 2026-08-18 was *"credentials
 * live in `delegated-exec.ts` and nowhere else"*, pinned by a source-reading
 * test. **That property is deliberately widened here, not broken**, and the
 * test is widened with it rather than deleted:
 *
 * > **Credentials appear ONLY in `delegated-exec.ts` and `estate-docs-exec.ts`.**
 * > `mention-flow.ts`, `gabi-chat.ts`, `tool-exec.ts`, `catalog-data.ts`,
 * > `have.ts`, `delegated.ts` and `estate-docs.ts` name no service account, no
 * > app token and no Firestore client, and reach both write and docs paths only
 * > through INJECTED ports they cannot construct.
 *
 * ⚠️ Widening a mechanical guard is a decision somebody makes on purpose and
 * writes down. Two modules, each one trust edge, each named in the test — not
 * "credentials are allowed in the chat path now".
 *
 * ## The two credentials, and what each is for
 *
 * | Credential | Used for | What it can do |
 * |---|---|---|
 * | `FIREBASE_SERVICE_ACCOUNT` (scope `datastore` only) | reading `discord_links/{id}` | read the link document the PERSON created; it is how "who is this?" is answered without ever guessing from a Discord name |
 * | `ESTATE_APP_TOKEN_DISCORD_DOCS` | the `Authorization: Bearer` on every corpus call | prove the caller is this Worker. ⚠️ **Authorises no read.** The auth Worker resolves the accompanying proven email against the estate directory and applies `devopsAllows()` |
 *
 * ⚠️ **`ESTATE_APP_TOKEN_DISCORD_DOCS` IS NOT `ESTATE_APP_TOKEN_DISCORD`, and
 * this file must never reach for the latter.** The Tier-1 token is shared with
 * BOTH library Workers; this corpus carries break-glass SQL, deploy levers,
 * secret names and household members' emails. A leak from a library instance
 * must not open it. Fresh trust edge, fresh pair, two holders — this Worker and
 * the auth Worker. (`delegated-exec.ts` holds the other one and neither file
 * names the other's secret; `test/estate-docs.test.ts` pins that both ways.)
 *
 * ⚠️ Neither is ever logged, echoed, put in a message, or returned to a caller.
 * The service account is the same value and custody `poll-vote.ts` and
 * `delegated-exec.ts` already hold, and this file adds no scope to it — reading
 * one link document is the identical operation the vote path already makes.
 *
 * ## What it will not do
 *
 * It sends the asker's proven email and their question. Not the Discord id, not
 * the display name, not the channel, not the conversation. The auth Worker
 * needs an identity and a query; anything else would be telling the estate's
 * directory about a chat.
 */

import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';
import type { Env } from './env.js';
import {
  DOCS_MSG,
  DOCS_REFUSALS,
  type DocsCallResult,
  type DocsIdentityFailure,
  type DocsPort,
} from './estate-docs.js';

/** The estate's auth Worker. A public hostname; the credential is the bearer. */
export const DEFAULT_AUTH_BASE = 'https://auth.heygabi.ai';

/** ⚠️ A corpus call is one R2 GET plus a substring scan on a warm isolate —
 *  fast. Ten seconds is generous for that and short enough that a wedged auth
 *  Worker cannot hold a Discord turn open past anybody's patience. */
const DOCS_TIMEOUT_MS = 10_000;

type FsValue = { stringValue?: unknown };
type FsDoc = { fields?: Record<string, FsValue> };

export function authBase(env: Pick<Env, 'AUTH_BASE_URL'>): string {
  return (env.AUTH_BASE_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_AUTH_BASE;
}

/**
 * `discord_links/{discordUserId}.email` — the estate half of the link
 * ceremony's two proofs (`link.ts`).
 *
 * ⚠️ **`email`, not `firebaseUid` and not `slug`.** The estate directory is
 * keyed by email: `seenBodySchema` requires one and `firebase_uid` is nullish
 * and is stored, not looked up by. The vote path reads `slug` because a vote is
 * filed under a club member; the Tier-1 write path reads `firebaseUid` because
 * a catalog write is filed under a Firebase account. A directory question needs
 * the directory's key, and this is it.
 *
 * ⚠️ **A DOCUMENT WITH NO `email` IS A PRE-UPGRADE LINK, AND THAT IS A
 * DIFFERENT ANSWER FROM "UNLINKED".** `delegated-exec.ts` collapses its
 * equivalent case into `unlinked` — correct there, because a link with no uid
 * genuinely cannot prove an estate account and re-running /link is the fix
 * either way. Here the two need different sentences: an unlinked person is told
 * to link, while somebody who linked before 2026-08-18 is told their link
 * predates the role check and to re-run it once. Telling the second person they
 * "aren't linked" sends them to look for a link they can see they already have.
 */
function emailFromLinkDoc(doc: FsDoc): string | null {
  const raw = doc.fields?.email?.stringValue;
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  return email.length >= 3 && email.length <= 320 && email.includes('@') ? email : null;
}

/**
 * Build the port the conversational path is handed.
 *
 * ⚠️ Returns `null` when the estate has not finished the wiring — no service
 * account, or no docs app token. A null port is how "ships dark" is expressed:
 * the flow says a worded line and every other answer is untouched. It is never
 * a half-configured port that fails at the moment somebody asks.
 */
export function makeDocsPort(env: Env): DocsPort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  const token = env.ESTATE_APP_TOKEN_DISCORD_DOCS;
  if (!rawSa || !token) return null;

  const base = authBase(env);

  /**
   * ⚠️ **MEMOISED FOR THE LIFE OF THIS PORT, which is one message.** A turn
   * that searches then reads three sections would otherwise mint an OAuth token
   * and read the same link document four times — four subrequests spent
   * re-answering a question whose answer cannot change mid-turn.
   */
  let cached: { ok: true; email: string } | { ok: false; reason: DocsIdentityFailure } | null = null;

  return {
    async askerEmail(discordUserId) {
      if (cached) return cached;
      try {
        const sa = parseServiceAccount(rawSa);
        // ⚠️ Unparseable JSON is a CONFIGURATION fault, not a person's fault —
        // and it must not be reported as "you are not linked", which would send
        // somebody to re-run a ceremony that is working fine.
        if (!sa) {
          console.error('GABI docs: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
          cached = { ok: false, reason: 'outage' };
          return cached;
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
        if (res.status === 404) {
          cached = { ok: false, reason: 'unlinked' };
          return cached;
        }
        if (!res.ok) {
          console.error(`GABI docs: link read failed (HTTP ${res.status}).`);
          cached = { ok: false, reason: 'outage' };
          return cached;
        }
        const email = emailFromLinkDoc((await res.json()) as FsDoc);
        cached = email ? { ok: true, email } : { ok: false, reason: 'no_email' };
        return cached;
      } catch (err) {
        console.error('GABI docs: link read threw:', err instanceof Error ? err.message : err);
        cached = { ok: false, reason: 'outage' };
        return cached;
      }
    },

    search(email, query, limit) {
      const url = `${base}/api/estate/docs/search?q=${encodeURIComponent(query)}&limit=${limit}`;
      return call(url, email, token);
    },

    section(email, id) {
      const url = `${base}/api/estate/docs/section?id=${encodeURIComponent(id)}`;
      return call(url, email, token);
    },
  };
}

/**
 * One GET against the corpus. ⚠️ Never throws: an unreachable auth Worker is a
 * worded `status: 0`, not an exception that would surface as a silent nothing
 * inside a Durable Object's socket handler.
 *
 * ⚠️ **THE REFUSAL IS THE AUTH WORKER'S OWN `detail`, RELAYED VERBATIM.** It is
 * the authority, so it is the only thing that can honestly say *why* — and it
 * is the thing that knows whether the answer is "not devops", "the snapshot has
 * not been published", or "the bucket did not answer". Inventing a sentence
 * here would be a second copy of a decision that already has one, and it would
 * drift.
 */
async function call(url: string, email: string, token: string): Promise<DocsCallResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        // ⚠️ The one place this value appears in an outbound request, and it
        // goes only to the host this Worker's own config names.
        authorization: `Bearer ${token}`,
        // ⚠️ The asker's PROVEN email — the header the auth Worker's door B
        // reads (`ON_BEHALF_OF_HEADER`). A rename on either side alone is a
        // silent 400 on every docs question; both ends pin the string.
        'x-estate-on-behalf-of': email,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(DOCS_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('GABI docs: the estate did not answer —', err instanceof Error ? err.message : err);
    return { ok: false, status: 0, body: null, message: DOCS_MSG.estateUnreachable };
  }

  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, status: res.status, body };

  const detail = typeof body?.detail === 'string' && body.detail.trim() ? body.detail.trim() : null;
  return {
    ok: false,
    status: res.status,
    body,
    message:
      detail ??
      // The auth Worker answered a failure with no sentence in it. That is a bug
      // THERE rather than a fact about this request — and never a bare status to
      // a person, so its own 5xx/4xx families get our honest fallbacks.
      (res.status >= 500 ? DOCS_MSG.estateUnreachable : DOCS_REFUSALS.not_devops),
  };
}

/** Re-exported for the composition roots, so neither has to import two files. */
export type { DocsPort };
