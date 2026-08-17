/**
 * Identity pseudonymisation for the gate log lines — the PRECONDITION for
 * turning Workers Logs retention on (soak pack 2026-08-16 §7.4).
 *
 * ## Why this file exists
 *
 * Both gate log lines (`ab_gate_shadow` from the shadow receiver,
 * `ab_gate` from the enforce arm) used to carry the caller's **email in
 * cleartext**. That was defensible while the only read path was
 * `wrangler tail` — an ephemeral stream nobody stores. `[observability]`
 * changes exactly that: the same line becomes a **retained record** held by
 * Cloudflare for days and readable by anyone with dashboard access. A
 * household member's address does not belong in that record, and the soak
 * analysis never needed it — it needs to count DISTINCT actors and sort them
 * into classes.
 *
 * So the line carries `email_hash` (stable, one-way) plus `identity_class`
 * (owner / household / outside / anonymous). Counts, per-user grouping and
 * "did an owner do this or did a household member" all still work; recovering
 * an address from the log does not.
 *
 * ## ⚠️ One-way, and what that does and does not buy
 *
 * SHA-256 is one-way: nothing inverts `email_hash` back to an address. But an
 * email is a LOW-ENTROPY input — anyone holding the salt can hash a *guessed*
 * address and check whether it appears. A secret salt would close that, at
 * the cost of a secret whose loss silently re-pseudonymises the whole corpus.
 *
 * We deliberately take the **hardcoded, non-secret domain-separation salt**
 * (`IDENTITY_SALT` below), because the threat this is built for is
 * **accidental disclosure through a retained log**, not an adversary who
 * already has the source and a list of candidate addresses. This is
 * pseudonymisation (keep addresses out of a durable record), not
 * authentication (prove who someone is) — and the salt's job here is domain
 * separation: the same address hashes to a different value in this system
 * than in any other, so two log corpora can never be joined on it.
 *
 * If the owner ever wants the stronger property, `GATE_HASH_SALT` is the
 * lever: set it as a secret (`wrangler secret put GATE_HASH_SALT`) and every
 * subsequent line uses it instead. ⚠️ Changing the salt **re-pseudonymises
 * everyone** — the same person hashes differently before and after — so a
 * soak window must never span a salt change, and the evidence pack should
 * name the salt generation it counted.
 *
 * ## Length
 *
 * 16 hex chars (64 bits) of the digest. For a household of tens of people a
 * collision is ~0 (birthday bound ~2^32 identities), and the short form keeps
 * the log line readable. It is a truncation of a one-way digest, which is no
 * weaker against inversion than the full digest.
 */

/**
 * The domain-separation salt. NOT a secret and not treated as one — see the
 * module doc for why that is the deliberate choice. Bump the suffix only
 * alongside a deliberate re-pseudonymisation (and say so in the evidence pack
 * that spans the change).
 */
export const IDENTITY_SALT = 'audiobook-worker/gate-identity/v1';

/** Which CLASS of actor the line came from — what the soak analysis sorts by. */
export type IdentityClass =
  /** No verified identity behind the report (measurement #2 of the design). */
  | 'anonymous'
  /** An OWNER_EMAILS break-glass account. */
  | 'owner'
  /** A verified identity the estate directory says is `approved`. */
  | 'household'
  /**
   * A verified identity that is NOT approved household — revoked, unknown to
   * the directory, or an estate read that failed. Deliberately one bucket:
   * the flip criterion asks about household members, and everything else is
   * "not the subject of the bar".
   */
  | 'outside';

const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * The stable per-user pseudonym for a log line.
 *
 * @param email the verified, already-normalised (trimmed + lowercased)
 *   address, or null for a tokenless report
 * @param salt override for `IDENTITY_SALT` (env `GATE_HASH_SALT`)
 * @returns 16 lowercase hex chars, or null when there was no identity — a
 *   tokenless report has nothing to pseudonymise and must not be given a
 *   fake one, or "how many distinct people" would count noise.
 */
export async function identityHash(
  email: string | null | undefined,
  salt?: string,
): Promise<string | null> {
  if (!email) return null;
  const data = new TextEncoder().encode(`${salt || IDENTITY_SALT}\n${email}`);
  return hex(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
}

/**
 * Sort one caller into a class. Owner wins over estate status on purpose:
 * the break-glass account is never demoted anywhere else in the estate, and
 * an owner row in the soak must stay distinguishable from a household one
 * (the flip criterion's denominator is HOUSEHOLD members, not everyone).
 */
export function identityClass(input: {
  tokened: boolean;
  isOwner: boolean;
  estateStatus: string | null;
}): IdentityClass {
  if (!input.tokened) return 'anonymous';
  if (input.isOwner) return 'owner';
  return input.estateStatus === 'approved' ? 'household' : 'outside';
}
