/**
 * estate-controls.js — shared button idioms for estate admin/ops surfaces.
 *
 * Extracted 2026-08-16 from admin/admin.js (where confirmBtn/actionBtn were
 * first built for the member directory's role/revoke controls) so the
 * status page's new fine-grained pipeline controls could REUSE the exact
 * same two-tap confirmation idiom instead of inventing a second one — owner
 * brief for that build was explicit: "Reuse the existing confirmBtn two-tap
 * helper in admin.js — do not invent a second confirmation idiom." Moving
 * it here (rather than importing admin.js's copy from status.js, a
 * different page bundle) is the "one canonical module, not two synced
 * copies" version of that instruction. admin.js now imports from here too.
 */

/** A plain action button — click runs immediately, no confirmation. Used
 * for read-only/reversible actions across the estate admin surfaces. */
export function actionBtn(label, className, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn small ${className || ''}`.trim();
  b.textContent = label;
  b.addEventListener('click', async () => {
    b.disabled = true;
    await onClick();
    b.disabled = false;
  });
  return b;
}

/**
 * Two-tap confirmation (owner order 2026-08-15: "make the revoke button,
 * make approver, make devops buttons have a confirmation so I don't
 * accidentally remove people from key roles"). First tap ARMS the button —
 * label flips to "Tap again to <label>", danger styling — and it disarms
 * itself after 4s untouched. Only the second tap inside that window runs
 * the mutation. Chosen over window.confirm(): these pages are used from a
 * phone, and a native dialog is both uglier and easier to fat-finger
 * through than a button that visibly changes state and relaxes on its own.
 *
 * `extraClass` (added 2026-08-16 for the /status pipeline-step controls):
 * an additional class applied to the button in its RESTING state only —
 * e.g. a 'warn' tint for publishing-tier steps ("this updates the live
 * site"). The armed state always uses 'danger' regardless, same as before.
 */
export function confirmBtn(label, className, onClick, extraClass) {
  const b = document.createElement('button');
  b.type = 'button';
  const baseClass = `btn small ${className || ''} ${extraClass || ''}`.trim();
  b.className = baseClass;
  b.textContent = label;
  let armed = false;
  let disarmTimer = null;
  const disarm = () => {
    armed = false;
    clearTimeout(disarmTimer);
    b.textContent = label;
    b.className = baseClass;
  };
  b.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      b.textContent = `Tap again to ${label.toLowerCase()}`;
      b.className = `btn small danger`;
      disarmTimer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    b.disabled = true;
    await onClick();
    b.disabled = false;
  });
  return b;
}
