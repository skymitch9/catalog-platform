/**
 * The worded 401 — the estate's ONE refusal shape, so no Worker has to compose
 * it again (TODO 2026-09-06 "KI-6 … it is an estate-wide shape, so it is fixed
 * ONCE as a shared helper, never per repo").
 *
 * The standing rule this exists to serve: ⚠️ **a person must never meet a bare
 * HTTP status.** Every refusal owes three things, in this order — WHAT
 * happened, WHAT IT NEEDS (a role or a standing, named), and HOW to get it.
 * Three Workers in three repos had each grown their own sentence for it
 * (`apps/auth-worker/src/middleware/auth.ts`, `session.ts`, `estate.ts`) while
 * three more still answered the bare 27-byte `{"error":"unauthenticated"}`:
 * this repo's index Worker, `Board_Game_Catalog` (its KI-6) and
 * `library_catalog` (the identical line). One helper is what stops that being
 * six sentences that drift.
 *
 * ⚠️ **THE `error` CODE IS FROZEN AT `unauthenticated` AND THIS HELPER CANNOT
 * CHANGE IT.** It is not a cosmetic choice: `tools/estate-probes` asserts
 * `json.error === 'unauthenticated'` across the auth Worker's, the index
 * Worker's, the library's and library2's whole unauthenticated edge, and every
 * page's failure wording branches on the same string
 * (`assets/estate-search.js`, `series/series.js`, `universes/universes.js`,
 * `assets/permission-ux.js`). The helper is **ADDITIVE**: it adds words beside
 * a machine-readable code that keeps working exactly as it did. Hence the
 * literal type on `error` — a caller cannot pass a different one.
 *
 * ⚠️ **`detail` CARRIES ALL THREE CLAUSES BY ITSELF, and that is the load-
 * bearing part of the design.** `needs` and `how` are also emitted as their
 * own fields, for a client that wants to render them separately — but every
 * consumer that exists today prints `detail` and nothing else
 * (`permission-ux.js`, the search box's status line, a curl in a terminal). A
 * design that split the sentence across three fields would read perfectly in a
 * test and show a person one third of a refusal.
 */

/** The frozen machine-readable code. Never parameterised — see the header. */
export const UNAUTHENTICATED = 'unauthenticated';

/** The three clauses a refusal owes a person, before they are composed. */
export interface RefusalClauses {
  /**
   * WHAT HAPPENED, as a complete sentence ending in a full stop. Written from
   * the reader's side ("You are not signed in…"), never from the server's
   * ("token verification failed") — a person cannot act on the second one.
   */
  what: string;
  /**
   * WHAT IT NEEDS, as a NOUN PHRASE with no leading capital and no full stop
   * ("a signed-in estate account", "an approver on the index"). It is wrapped
   * into a sentence by the composer, so passing a whole sentence here reads
   * wrong. Name the role or standing — "permission" alone tells nobody which.
   */
  needs: string;
  /**
   * HOW TO GET IT, as a complete sentence ending in a full stop, naming a URL
   * or a person. ⚠️ This is the clause most often dropped, and it is the only
   * one that gets the reader unstuck.
   */
  how: string;
}

/** The wire body. `error` is a literal type so no caller can widen it. */
export interface UnauthenticatedRefusal extends RefusalClauses {
  error: typeof UNAUTHENTICATED;
  /** The three clauses composed into one sentence — see the header. */
  detail: string;
}

function requireClause(value: string, name: keyof RefusalClauses): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `estate-auth: unauthenticatedRefusal() needs a non-empty \`${name}\` — a refusal missing one of its three clauses is the bare status this helper exists to replace`,
    );
  }
  return value.trim();
}

/**
 * Compose the worded 401 body.
 *
 * ⚠️ It THROWS on a missing clause rather than filling one in. A default
 * sentence would be wrong on most surfaces and — worse — would look right in
 * review, which is how a generic "you are not authorized" ends up in front of
 * somebody who needed to be told which shelf and which role.
 *
 * ```ts
 * return c.json(
 *   unauthenticatedRefusal({
 *     what: 'You are not signed in, so the estate index answered nothing.',
 *     needs: 'a signed-in estate account',
 *     how: 'Sign in at https://heygabi.ai and try the search again.',
 *   }),
 *   401,
 * );
 * ```
 */
export function unauthenticatedRefusal(clauses: RefusalClauses): UnauthenticatedRefusal {
  const what = requireClause(clauses.what, 'what');
  const needs = requireClause(clauses.needs, 'needs');
  const how = requireClause(clauses.how, 'how');
  return {
    error: UNAUTHENTICATED,
    detail: `${what} This needs ${needs}. ${how}`,
    what,
    needs,
    how,
  };
}

/**
 * The estate's default sign-in refusal — the sentence for any surface whose
 * only requirement is "be a signed-in member of the household".
 *
 * `surface` is a NOUN PHRASE naming what the caller was refused, lowercase and
 * without a full stop ("the estate index", "this catalog's API"). It is the
 * one thing that genuinely differs between the Workers, so it is the one thing
 * asked for — everything else being shared is the point of the helper.
 */
export function estateSignInRefusal(surface: string): UnauthenticatedRefusal {
  const named = requireClause(surface, 'what');
  return unauthenticatedRefusal({
    what: `You are not signed in, so ${named} answered nothing.`,
    needs: 'a signed-in estate account',
    how: 'Sign in at https://heygabi.ai and try again. If signing in does not help, ask the estate owner to admit your account.',
  });
}
