/**
 * **IS THIS PERSON DEVOPS?** — asked, never decided here.
 *
 * ⚠️ **THIS FILE HOLDS NO COPY OF THE ANSWER, AND THAT IS THE ENTIRE POINT.**
 * The estate directory decides devops standing and the auth Worker applies
 * `devopsAllows()` — the same predicate the browser door uses. A second holder
 * of that decision would be a second thing to forget to revoke, and revoking
 * somebody's devops in `/admin` has to shut every door at once.
 *
 * So the gate is a **real call whose status is the answer**:
 *
 * | outcome | means |
 * |---|---|
 * | `200` | the auth Worker served the corpus to this identity → devops |
 * | `403` | the auth Worker refused this identity → not devops |
 * | anything else, or no answer | ⚠️ **UNKNOWN, worded as an outage** |
 *
 * ⚠️ **A NETWORK OR SERVER FAILURE IS NOT A PERMISSION FAILURE.** A 500 read as
 * "not devops" sends an operator to ask for access they already hold, which is
 * the estate's own named wording rule. The third row above exists so that cannot
 * happen by omission.
 *
 * ## ⚠️ It rides the DOCS port, and inherits its posture
 *
 * There is no dedicated "am I devops" route, and inventing one would mean a new
 * route, a new app token and a new trust edge to answer a question an existing
 * call already answers. So this reuses `DocsPort` — no new credential, no sixth
 * module holding a secret, and the guard test is untouched.
 *
 * ⚠️ **The cost of that reuse, stated rather than discovered:** with `GABI_DOCS`
 * off (or its port unbuilt) there is nothing here to ask, and every devops-gated
 * feature answers *"I can't check who's allowed"* — a SETUP sentence, never a
 * permissions one. That coupling is real and it is the price of not minting a
 * second credential for a single boolean.
 */

import type { DocsPort } from './estate-docs.js';

/**
 * ⚠️ **THE PROBE QUERY.** A word that is certain to be IN the estate's own
 * corpus, so a 200 means "served" rather than "served nothing" — and short, so
 * the scan is cheap. ⚠️ It is asked for its STATUS and its body is thrown away;
 * nothing here reads a document.
 */
export const DEVOPS_PROBE_QUERY = 'devops';
export const DEVOPS_PROBE_LIMIT = 1;

export type DevopsVerdict =
  | { kind: 'devops'; email: string }
  | { kind: 'not_devops' }
  | { kind: 'unlinked' }
  | { kind: 'link_incomplete' }
  | { kind: 'unreachable' }
  | { kind: 'not_configured' };

/**
 * Ask the estate whether this Discord account is devops-class.
 *
 * ⚠️ **NEVER THROWS.** Every failure is a named verdict, because a thrown error
 * inside a Durable Object's socket handler surfaces as a silent nothing — a
 * refusal with no sentence, which is the failure mode every wording rule here
 * exists to prevent.
 */
export async function checkDevops(
  port: DocsPort | undefined,
  discordUserId: string,
): Promise<DevopsVerdict> {
  if (!port) return { kind: 'not_configured' };
  try {
    const who = await port.askerEmail(discordUserId);
    if (!who.ok) {
      if (who.reason === 'unlinked') return { kind: 'unlinked' };
      if (who.reason === 'no_email') return { kind: 'link_incomplete' };
      return { kind: 'unreachable' };
    }
    const probe = await port.search(who.email, DEVOPS_PROBE_QUERY, DEVOPS_PROBE_LIMIT);
    if (probe.ok) return { kind: 'devops', email: who.email };
    // ⚠️ ONLY 403 IS A REFUSAL. 404, 500, 503 and a dead socket are all "we do
    // not know", and the caller words them as our problem.
    if (probe.status === 403) return { kind: 'not_devops' };
    return { kind: 'unreachable' };
  } catch (err) {
    console.error('GABI devops gate: the check threw:', err instanceof Error ? err.message : err);
    return { kind: 'unreachable' };
  }
}
