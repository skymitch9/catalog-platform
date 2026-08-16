/**
 * apex-admin-link.js — the front door's gated "Admin" affordances.
 *
 * Formerly find.js's probeApprover() + the inline Admin-link append inside
 * renderAuthState(). Extracted here (rather than folded into
 * estate-search.js) because it is heygabi-home-specific admin surface, not a
 * generic search behavior — the shared component should not need to know
 * "Admin" is a concept. It plugs into the component's ONE extension point for
 * this purpose: the light-DOM child carrying slot="who-extra" inside
 * <estate-search>.
 *
 * v2 (0003 devops, owner order 2026-08-15: "that devops role should be
 * associated with the heygabi.ai home page… also give it access to the
 * status page"): the probe is now GET /api/estate/me — one call answering
 * BOTH capabilities — instead of the old 200-from-/estate/users trick,
 * because the card now has two tiers:
 *   approver      → the chip, and the whole Admin card (Members / Status /
 *                   Todo).
 *   devops only   → the Admin card with ONLY the Status link; Members and
 *                   the todo board stay approver surfaces (their own
 *                   endpoints enforce that server-side regardless — this is
 *                   the honest-UI half, same as every estate gate).
 * /me reports is_devops EFFECTIVE (approver ⇒ true), so the tier check here
 * is two booleans, never a re-derivation. Probed once per signed-in uid; a
 * failed probe fails quiet: the links are conveniences, the pages exist
 * without them and enforce themselves.
 */

const AUTH_ORIGIN = 'https://auth.heygabi.ai';

const search = document.getElementById('find-search');
const adminSlot = document.getElementById('find-admin');
const adminCard = document.getElementById('admin-card-li'); // the front-door Admin card (owner, 2026-08-15)
// The card's approver-only links (Members → /admin, the todo board). Status
// stays for both tiers. Resolved by href so index.html needs no new ids.
const approverOnlyLinks = adminCard
  ? Array.from(adminCard.querySelectorAll('a')).filter((a) => {
      const path = a.getAttribute('href');
      return path === '/admin' || path === '/todo';
    })
  : [];

if (search && adminSlot) {
  let probedFor = null;

  search.addEventListener('estate-search:auth', async (e) => {
    const user = e.detail.user;
    if (!user) {
      adminSlot.hidden = true;
      if (adminCard) adminCard.hidden = true;
      probedFor = null;
      return;
    }
    if (probedFor === user.uid) return;
    probedFor = user.uid;
    const token = await search.authAdapter?.idToken();
    if (!token) return;
    try {
      const r = await fetch(`${AUTH_ORIGIN}/api/estate/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (probedFor !== user.uid) return;
      if (!r.ok) {
        adminSlot.hidden = true;
        if (adminCard) adminCard.hidden = true;
        return;
      }
      const me = await r.json();
      const approver = me?.is_approver === true;
      const devops = me?.is_devops === true || approver;
      adminSlot.hidden = !approver;
      if (adminCard) {
        adminCard.hidden = !devops;
        approverOnlyLinks.forEach((a) => {
          a.hidden = !approver;
        });
      }
    } catch {
      /* a failed probe fails quiet — the links are conveniences */
    }
  });
}
