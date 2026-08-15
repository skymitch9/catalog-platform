/**
 * apex-admin-link.js — the front door's approver-only "Admin" chip.
 *
 * Formerly find.js's probeApprover() + the inline Admin-link append inside
 * renderAuthState(). Extracted here (rather than folded into
 * estate-search.js) because it is heygabi-home-specific admin surface, not a
 * generic search behavior — the shared component should not need to know
 * "Admin" is a concept. It plugs into the component's ONE extension point for
 * this purpose: the light-DOM child carrying slot="who-extra" inside
 * <estate-search>, toggled visible once GET /estate/users answers 200 (a 200
 * IS the approver fact — no second vocabulary invented client-side, same as
 * find.js). Probed once per signed-in uid; a failed probe fails quiet: the
 * link is a convenience, /admin still exists without it.
 */

const AUTH_ORIGIN = 'https://auth.heygabi.ai';

const search = document.getElementById('find-search');
const adminSlot = document.getElementById('find-admin');
if (search && adminSlot) {
  let probedFor = null;

  search.addEventListener('estate-search:auth', async (e) => {
    const user = e.detail.user;
    if (!user) {
      adminSlot.hidden = true;
      probedFor = null;
      return;
    }
    if (probedFor === user.uid) return;
    probedFor = user.uid;
    const token = await search.authAdapter?.idToken();
    if (!token) return;
    try {
      const r = await fetch(`${AUTH_ORIGIN}/api/estate/users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (probedFor === user.uid) adminSlot.hidden = !r.ok;
    } catch {
      /* a failed probe fails quiet — the link is a convenience */
    }
  });
}
