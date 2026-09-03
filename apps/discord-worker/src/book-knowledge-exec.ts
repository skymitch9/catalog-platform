/**
 * ⚠️ **THE THIRD — AND ONLY OTHER — MODULE IN GABI'S CONVERSATIONAL PATH THAT
 * TOUCHES A CREDENTIAL.** That is this file's whole reason for existing as a
 * file, exactly as it is `delegated-exec.ts`'s and `estate-docs-exec.ts`'s.
 *
 * The property those two established, widened once more **on purpose** and with
 * the test widened alongside it rather than deleted:
 *
 * > **Credentials appear ONLY in `delegated-exec.ts`, `estate-docs-exec.ts` and
 * > `book-knowledge-exec.ts`.** `mention-flow.ts`, `gabi-chat.ts`,
 * > `tool-exec.ts`, `catalog-data.ts`, `delegated.ts`, `estate-docs.ts` and
 * > `book-knowledge.ts` name no service account, no app token and no Firestore
 * > client, and reach every gated path only through INJECTED ports they cannot
 * > construct.
 *
 * ⚠️ Widening a mechanical guard is a decision somebody makes on purpose and
 * writes down. Three modules, each one trust edge, each named in the test — not
 * "credentials are allowed in the chat path now".
 *
 * ## The two credentials, and what each is for
 *
 * | Credential | Used for | What it can do |
 * |---|---|---|
 * | `FIREBASE_SERVICE_ACCOUNT` (scope `datastore`) | reading `discord_links/{id}` | read the link document the PERSON created; it is how "who is this?" is answered without guessing from a Discord name |
 * | `ESTATE_APP_TOKEN_BOOKS` | the `Authorization: Bearer` on every book call | prove the caller is this Worker. ⚠️ **Authorises no read.** The audiobook Worker resolves the accompanying proven email against the estate directory and requires `vis_ebooks` |
 *
 * ⚠️ **`ESTATE_APP_TOKEN_BOOKS` IS ITS OWN PAIR** — not `ESTATE_APP_TOKEN_DISCORD`
 * (shared with both library Workers) and not `ESTATE_APP_TOKEN_DISCORD_DOCS`.
 * This one opens the household's **derived book text**, which the owner's
 * standing directive is explicit about: *"I don't want people scraping my
 * books."* Derived full text is a MORE attractive scrape target than the files —
 * smaller, cleaner, searchable. A leak from the library instances or from the
 * docs corpus must not open it. Fresh trust edge, fresh pair, two holders — this
 * Worker and the audiobook Worker.
 *
 * ## What it will not do
 *
 * It sends the asker's proven email, a book id and a query. Not the Discord id,
 * not the display name, not the channel, not the conversation. ⚠️ And it never
 * logs a passage — only how many bytes came back.
 */

import { firestoreRequest, mintAccessToken, parseServiceAccount } from './firebase-sa.js';
import type { Env } from './env.js';
import {
  BOOKS_MSG,
  type BooksCallResult,
  type BooksIdentityFailure,
  type BooksPort,
} from './book-knowledge.js';

/** The audiobook Worker. A public hostname; the credential is the bearer. */
export const DEFAULT_AUDIOBOOK_API = 'https://audiobook-api.heygabi.ai';

/** ⚠️ A book call is one R2 GET plus a lexical scan over one book on a warm
 *  isolate. Ten seconds is generous for that and short enough that a wedged
 *  Worker cannot hold a Discord turn open past anybody's patience. */
const BOOKS_TIMEOUT_MS = 10_000;

type FsValue = { stringValue?: unknown };
type FsDoc = { fields?: Record<string, FsValue> };

export function audiobookApiBase(env: Pick<Env, 'AUDIOBOOK_API_URL'>): string {
  return (env.AUDIOBOOK_API_URL ?? '').trim().replace(/\/+$/, '') || DEFAULT_AUDIOBOOK_API;
}

/**
 * `discord_links/{discordUserId}.email` — the estate half of the link
 * ceremony's two proofs (`link.ts`).
 *
 * ⚠️ **`email`, not `firebaseUid` and not `slug`**, for the reason
 * `estate-docs-exec.ts` states: the estate directory is keyed by email, and a
 * directory question needs the directory's key. A document with no `email` is a
 * PRE-UPGRADE LINK and gets its own sentence — telling that person they "aren't
 * linked" sends them to look for a link they can see they already have.
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
 * account, or no book app token. A null port is how "ships dark" is expressed:
 * the flow says a worded line and every other answer is untouched. It is never a
 * half-configured port that fails at the moment somebody asks.
 */
export function makeBooksPort(env: Env): BooksPort | null {
  const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
  const token = env.ESTATE_APP_TOKEN_BOOKS;
  if (!rawSa || !token) return null;

  const base = audiobookApiBase(env);

  /** ⚠️ MEMOISED FOR THE LIFE OF THIS PORT, which is one message. A turn that
   *  checks the shelf then searches two books would otherwise mint an OAuth
   *  token and read the same link document three times — three subrequests
   *  spent re-answering a question whose answer cannot change mid-turn. */
  let cached: { ok: true; email: string } | { ok: false; reason: BooksIdentityFailure } | null =
    null;

  return {
    async askerEmail(discordUserId) {
      if (cached) return cached;
      try {
        const sa = parseServiceAccount(rawSa);
        // ⚠️ Unparseable JSON is a CONFIGURATION fault, not a person's fault, and
        // must not be reported as "you are not linked".
        if (!sa) {
          console.error('GABI books: FIREBASE_SERVICE_ACCOUNT is not parseable JSON.');
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
        // 404 is the ORDINARY answer for somebody who has never linked. Not an
        // outage, and never worded as one.
        if (res.status === 404) {
          cached = { ok: false, reason: 'unlinked' };
          return cached;
        }
        if (!res.ok) {
          console.error(`GABI books: link read failed (HTTP ${res.status}).`);
          cached = { ok: false, reason: 'outage' };
          return cached;
        }
        const email = emailFromLinkDoc((await res.json()) as FsDoc);
        cached = email ? { ok: true, email } : { ok: false, reason: 'no_email' };
        return cached;
      } catch (err) {
        console.error('GABI books: link read threw:', err instanceof Error ? err.message : err);
        cached = { ok: false, reason: 'outage' };
        return cached;
      }
    },

    available(email, query) {
      const qs = new URLSearchParams({ limit: '40' });
      if (query) qs.set('q', query);
      return call(`${base}/api/books/available?${qs}`, email, token);
    },

    search(email, bookId, params) {
      return call(
        `${base}/api/book/${encodeURIComponent(bookId)}/search?${new URLSearchParams(params)}`,
        email,
        token,
      );
    },

    passage(email, bookId, params) {
      return call(
        `${base}/api/book/${encodeURIComponent(bookId)}/passage?${new URLSearchParams(params)}`,
        email,
        token,
      );
    },

    presence(email, params) {
      return call(`${base}/api/books/presence?${new URLSearchParams(params)}`, email, token);
    },

    /**
     * ⚠️ **COUNT ONE PHRASE IN ONE BOOK.** `params` carries `q`, the
     * PIPE-joined `variants`, `quotes` and the derived bound.
     *
     * ⚠️ **`URLSearchParams` does the encoding, and it has to.** The phrase this
     * feature was built for is *"God damn it, Donut"* — a comma, three spaces
     * and a capital in one query value. Hand-building the string is how a comma
     * becomes a list separator on the other end.
     */
    count(email, bookId, params) {
      return call(
        `${base}/api/book/${encodeURIComponent(bookId)}/count?${new URLSearchParams(params)}`,
        email,
        token,
      );
    },

    /** ⚠️ Whole-book only, by the route's own design — the `books=` list owns the
     *  comma, which is exactly why `variants` is pipe-separated. */
    countAcross(email, params) {
      return call(`${base}/api/books/count?${new URLSearchParams(params)}`, email, token);
    },
  };
}

/**
 * One GET against the book routes. ⚠️ Never throws: an unreachable Worker is a
 * worded `status: 0`, not an exception that would surface as a silent nothing
 * inside a Durable Object's socket handler.
 *
 * ⚠️ **THE REFUSAL IS THE AUDIOBOOK WORKER'S OWN `detail`, RELAYED VERBATIM.**
 * It is the authority, so it is the only thing that can honestly say *why* — and
 * the only thing that knows whether the answer is "no ebooks grant", "that book
 * is not ingested" or "the bucket did not answer".
 */
async function call(url: string, email: string, token: string): Promise<BooksCallResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        // ⚠️ The one place this value appears in an outbound request, and it goes
        // only to the host this Worker's own config names.
        authorization: `Bearer ${token}`,
        // ⚠️ The asker's PROVEN email — the header the audiobook Worker's door B
        // reads. A rename on either side alone is a silent 400 on every book
        // question; both ends pin the string.
        'x-estate-on-behalf-of': email,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(BOOKS_TIMEOUT_MS),
    });
  } catch (err) {
    console.error('GABI books: the shelf did not answer —', err instanceof Error ? err.message : err);
    return { ok: false, status: 0, body: null, message: BOOKS_MSG.estateUnreachable };
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
      // The Worker answered a failure with no sentence in it. That is a bug THERE
      // rather than a fact about this request — and never a bare status to a
      // person, so its own 5xx/4xx families get our honest fallbacks.
      (res.status >= 500 ? BOOKS_MSG.estateUnreachable : BOOKS_MSG.notConfigured),
  };
}

/** Re-exported for the composition roots, so neither has to import two files. */
export type { BooksPort };
