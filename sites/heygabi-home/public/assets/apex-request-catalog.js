/**
 * apex-request-catalog.js — the "+" on the front door's Books and Games cards.
 *
 * Owner ask 2026-09-05 06:26 Phoenix ("Remember that doc about requesting a
 * board game or book site? Time to build that."), both cards ("Both", ~06:50).
 * Design: docs/info/request-a-catalog-design.md — §2.1 the flow, §3.6 the
 * pinned route contract this file is built against, §4 the button in full.
 *
 * 🔴 THE BUTTON FILES A REQUEST. IT DOES NOT CREATE A CATALOG, and every string
 * in here says so rather than letting somebody find out later. Standing up a
 * catalog is ~10 manual steps across three consoles; `accepted` is not `live`,
 * and between them a person has been told yes and nothing exists (design §2.3).
 * The same honesty the "+ Add a verse" surface carries on /universes.
 *
 * ── THE AUTH SEAM (design §4.4) ───────────────────────────────────────────
 * Copied from assets/apex-admin-link.js, which is the estate's one seam for
 * "the front door learnt who you are": listen for `estate-search:auth` on
 * #find-search (dispatched by assets/estate-search.js), take e.detail.user,
 * dedupe on user.uid so it probes once per sign-in, get a bearer from
 * search.authAdapter.idToken(), and GET /api/estate/me.
 *
 * ⚠️ AND ITS FAIL-HIDDEN POSTURE, WHICH IS THE HALF WORTH COPYING. On any
 * failure — a non-ok status, a thrown fetch, a /me that predates the migration
 * and carries no `catalogs` field — the affordance stays HIDDEN. It is never
 * rendered broken and never rendered as a refusal. The button is a curtain:
 * POST /api/estate/catalogs/requests enforces `status === 'approved'`
 * server-side (§9 Q2, owner: "only approved people"), so hiding the control
 * costs a curtain and never a lock.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ─────────────────────────────────────────
 * The optional sealed Claude key (design §6). Owner, 2026-09-05 ~07:03
 * Phoenix: "Have it fall back to my Claude key for now. Defer it until
 * everything else is built then build it." So v1 has NO key field; the hook
 * where it goes is marked below in buildForm(), one place, so the last phase
 * of the build is an insertion and not an archaeology exercise.
 */

const AUTH_ORIGIN = 'https://auth.heygabi.ai';

/**
 * §3.3's shape check, as a CONVENIENCE ONLY. The server runs its own on the
 * availability route and again at submit, and the row that lands in D1 is the
 * one that matters — so a drift between this copy and the server's can only
 * ever cost a wasted keystroke, never a bad row. The RESERVED LIST is
 * deliberately NOT copied here: it is one module on the Worker (§3.3, "two
 * copies of a hostname list is two copies that drift, and the drifted one is
 * always the check that mattered"), and this page learns it by asking.
 */
const SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

const KINDS = {
  books: {
    noun: 'book catalog',
    title: 'Request a book catalog',
    lede:
      'A shelf of your own at your own address — its own database, its own covers, ' +
      'linked into the estate like the ones on this page.',
    // Books has a worked provisioning path: library_catalog already runs two
    // instances, so there is nothing extra to warn about.
    wait: null,
  },
  games: {
    noun: 'board-game catalog',
    title: 'Request a board-game catalog',
    lede:
      'A game shelf of your own at your own address — its own database, its own ' +
      'covers, linked into the estate like the one on this page.',
    // ⚠️ §8's closing instruction, and it is not decoration: "Either land the
    // games platform work before the Games '+' is switched on, or make the
    // Games card's own copy say plainly that a games catalog takes longer to
    // stand up." The second option is the one taken, so the sentence is a
    // requirement of the design, not a nicety. Removing it re-creates the
    // estate's own approved-≠-landed gap on a person who has been told yes.
    wait:
      'Worth knowing before you ask: a board-game catalog takes longer to stand up ' +
      'than a book one. The machinery for a second games instance has not been built ' +
      'yet, so a yes here is a place in the queue rather than a shelf next week.',
  },
};

const OUTAGE =
  'Couldn’t reach the estate directory — that’s an outage, not a permissions problem. ' +
  'Try again in a minute.';
const LAPSED = 'Your sign-in has lapsed — sign in again, then try once more.';

const search = document.getElementById('find-search');

/** kind → { card, slot } for every card that declared itself requestable. */
const cards = new Map();
for (const card of document.querySelectorAll('[data-catalog-kind]')) {
  const kind = card.dataset.catalogKind;
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) continue;
  const slot = document.createElement('div');
  slot.className = 'card-add-slot';
  slot.hidden = true;
  card.appendChild(slot);
  cards.set(kind, { card, slot });
}

let currentUser = null;
let probedFor = null;

/* ------------------------------------------------------------------------ *
 * The wire
 * ------------------------------------------------------------------------ */

async function bearer() {
  try {
    return (await search?.authAdapter?.idToken()) || null;
  } catch {
    return null;
  }
}

/**
 * One shape for every answer, so a caller can never mistake an outage for a
 * refusal. `network` is its own kind on purpose (the /universes precedent):
 * ⚠️ a rejected CORS preflight surfaces to JS as a network error and looks
 * exactly like a Worker that is down. Either way it is an OUTAGE, and
 * mislabelling one sends people asking for access they already have.
 */
async function authedJson(path, init) {
  const token = await bearer();
  if (!token) return { kind: 'lapsed' };
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init && init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
  } catch {
    return { kind: 'network' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body still has a status, and a person never sees one */
  }
  return { kind: 'answered', status: res.status, ok: res.ok, body: body || {} };
}

/** The server's own sentence wins whenever it sent one — two copies drift. */
function said(answer, fallback) {
  if (answer.kind === 'lapsed') return LAPSED;
  if (answer.kind === 'network') return OUTAGE;
  const detail = answer.body && answer.body.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return fallback;
}

/* ------------------------------------------------------------------------ *
 * Show / hide — design §4.3, PER KIND
 *
 * | Caller state, for THAT card's kind        | that card's "+"        |
 * | signed out                                | not rendered           |
 * | approved, no catalog and no open request  | shown                  |
 * | approved, a pending or accepted request   | the pending pill       |
 * | approved, owns a live catalog             | hidden, permanently    |
 * | not approved / probe failed / no field    | hidden — fail-quiet    |
 *
 * A person who owns a books catalog may still ask for a games one: their Books
 * "+" is gone and their Games "+" is not. That is why every entry carries its
 * `kind` and why a flat list of hostnames could not answer this question.
 * ------------------------------------------------------------------------ */

function hideAll() {
  for (const { slot } of cards.values()) {
    slot.hidden = true;
    slot.textContent = '';
  }
}

function renderFromMe(catalogs) {
  for (const kind of cards.keys()) {
    const mine = catalogs.filter((c) => c && c.kind === kind);
    // `live` is terminal-good and hides the "+" for good.
    if (mine.some((c) => c.status === 'live')) {
      setSlot(kind, null);
      continue;
    }
    const open = mine.find((c) => c.status === 'pending' || c.status === 'accepted');
    setSlot(kind, open ? { state: 'pending', row: open } : { state: 'offer' });
  }
}

function setSlot(kind, view) {
  const entry = cards.get(kind);
  if (!entry) return;
  const { slot } = entry;
  slot.textContent = '';
  if (!view) {
    slot.hidden = true;
    return;
  }
  slot.hidden = false;
  slot.appendChild(view.state === 'pending' ? pendingPill(kind, view.row) : plusButton(kind));
}

function plusButton(kind) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-add';
  btn.textContent = '+';
  // ⚠️ A glyph is not a label. The accessible name says the whole sentence,
  // and `title` gives a sighted reader the same words on hover.
  const label = `Request a ${KINDS[kind].noun} of your own`;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.addEventListener('click', () => openModal(kind));
  return btn;
}

/**
 * ⚠️ "Requested — pending review", never "requested — approved" and never a
 * bare status. `accepted` reads the same as `pending` here on purpose (§2.3):
 * on the requester's side both mean "somebody is dealing with it", and drawing
 * `accepted` as done would be the estate's own approved-≠-landed failure.
 */
function pendingPill(kind, row) {
  const wrap = document.createElement('div');
  wrap.className = 'card-pending';

  const text = document.createElement('span');
  text.className = 'card-pending-text';
  text.textContent = 'Requested — pending review';
  if (row && row.desired_subdomain) {
    text.title = `${row.desired_subdomain}.heygabi.ai — the owner reviews every request before a catalog is created.`;
  }
  wrap.appendChild(text);

  if (row && row.status === 'pending' && row.id != null) {
    wrap.appendChild(withdrawButton(kind, row));
  }
  return wrap;
}

/**
 * Withdraw is a two-tap control (assets/estate-controls.js's confirmBtn
 * grammar, restated here rather than imported because that module is the
 * /admin surface's and this page loads none of it): the first tap arms and
 * says so, the second writes, and it disarms itself after four seconds so a
 * pocket press cannot land it later.
 */
function withdrawButton(kind, row) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'card-withdraw';
  btn.textContent = 'Withdraw';
  let armed = false;
  let timer = null;

  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    btn.textContent = 'Withdraw';
    btn.classList.remove('armed');
  };

  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Withdraw — tap again';
      btn.classList.add('armed');
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    btn.disabled = true;
    const answer = await authedJson(`/api/estate/catalogs/requests/${row.id}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    btn.disabled = false;
    if (answer.kind !== 'answered' || !answer.ok) {
      // Words, in place, naming what happened — never a bare status and never
      // a silently dead button.
      const p = document.createElement('p');
      p.className = 'card-add-note';
      p.setAttribute('role', 'status');
      p.textContent = said(answer, 'That request could not be withdrawn. Try again shortly.');
      btn.parentElement?.appendChild(p);
      return;
    }
    setSlot(kind, { state: 'offer' });
  });
  return btn;
}

/* ------------------------------------------------------------------------ *
 * The modal — form → REQUIRED review → submit (design §2.1 step 6, §4.5)
 *
 * 🔴 THE FORM CANNOT POST FROM ITS FIELDS. A Review state restates everything
 * first, including that the owner reviews every request. That is the estate's
 * confirm-lane grammar — propose → restate → confirm → apply — and it is part
 * of the button, not a nicety.
 * ------------------------------------------------------------------------ */

let dialog = null;
/** { kind, subdomain, displayName, note, available, checkSeq } */
let draft = null;

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'rc-dialog';
  dialog.addEventListener('close', () => {
    dialog.textContent = '';
    draft = null;
  });
  document.body.appendChild(dialog);
  return dialog;
}

function openModal(kind) {
  draft = { kind, subdomain: '', displayName: suggestedName(), note: '', available: null, checkSeq: 0 };
  const d = ensureDialog();
  buildForm();
  if (!d.open) d.showModal();
}

function closeModal() {
  if (dialog && dialog.open) dialog.close();
}

/** Seeded from their first name and fully editable (§2.1 step 4). */
function suggestedName() {
  const raw = (currentUser && (currentUser.displayName || currentUser.email)) || '';
  const first = String(raw).split(/[\s@.]+/).filter(Boolean)[0] || '';
  if (!first) return '';
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}’s shelf`;
}

function shell(titleText) {
  const d = ensureDialog();
  d.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'rc-panel';

  const head = document.createElement('div');
  head.className = 'rc-head';
  const h = document.createElement('h2');
  h.className = 'rc-title';
  h.textContent = titleText;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'rc-x';
  x.setAttribute('aria-label', 'Close');
  x.textContent = '×';
  x.addEventListener('click', closeModal);
  head.append(h, x);
  panel.appendChild(head);

  d.appendChild(panel);
  return panel;
}

function para(text, className) {
  const p = document.createElement('p');
  p.className = className || 'rc-note';
  p.textContent = text;
  return p;
}

function buildForm() {
  const k = KINDS[draft.kind];
  const panel = shell(k.title);
  panel.appendChild(para(k.lede));

  // §2.1 step 3 — identity is pre-filled, never typed. There is deliberately no
  // email field anywhere: the identity is the session's, so it cannot be claimed.
  const who = currentUser && (currentUser.email || currentUser.displayName);
  if (who) {
    panel.appendChild(para(`You’ll be the admin of this catalog — signed in as ${who}.`, 'rc-who'));
  }

  /* --- address ---------------------------------------------------------- */
  const addrField = document.createElement('label');
  addrField.className = 'rc-field';
  const addrLabel = document.createElement('span');
  addrLabel.className = 'rc-label';
  addrLabel.textContent = 'Address';
  const addrRow = document.createElement('span');
  addrRow.className = 'rc-addr';
  const addrInput = document.createElement('input');
  addrInput.type = 'text';
  addrInput.className = 'rc-input';
  addrInput.autocomplete = 'off';
  addrInput.spellcheck = false;
  addrInput.placeholder = 'amber';
  addrInput.value = draft.subdomain;
  const suffix = document.createElement('span');
  suffix.className = 'rc-suffix';
  suffix.textContent = '.heygabi.ai';
  addrRow.append(addrInput, suffix);
  addrField.append(addrLabel, addrRow);
  const check = document.createElement('p');
  check.className = 'rc-check';
  check.setAttribute('role', 'status');
  check.hidden = true;
  addrField.appendChild(check);
  panel.appendChild(addrField);

  /* --- display name ----------------------------------------------------- */
  const nameField = document.createElement('label');
  nameField.className = 'rc-field';
  const nameLabel = document.createElement('span');
  nameLabel.className = 'rc-label';
  nameLabel.textContent = 'Display name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'rc-input';
  nameInput.placeholder = 'What this shelf is called on heygabi.ai';
  nameInput.value = draft.displayName;
  nameField.append(nameLabel, nameInput);
  nameField.appendChild(para('What shows on this page once it exists. Change it freely.', 'rc-hint'));
  panel.appendChild(nameField);

  /* --- note (optional) -------------------------------------------------- */
  const noteField = document.createElement('label');
  noteField.className = 'rc-field';
  const noteLabel = document.createElement('span');
  noteLabel.className = 'rc-label';
  noteLabel.textContent = 'Anything the owner should know (optional)';
  const noteInput = document.createElement('textarea');
  noteInput.className = 'rc-textarea';
  noteInput.rows = 3;
  noteInput.placeholder = 'What it is for, roughly how big, anything unusual.';
  noteInput.value = draft.note;
  noteField.append(noteLabel, noteInput);
  panel.appendChild(noteField);
  // The note travels in `extra` — JSON stored whole and unparsed on the row
  // (§3.4), read tolerantly by the admin queue: a missing key is a default,
  // never an error.

  /* --- 🔴 THE KEY FIELD GOES HERE, AND ONLY HERE --------------------------
   * Design §6 — the requester's optional Claude key, WebCrypto-sealed in the
   * browser to a provisioning public key and POSTed as ciphertext only.
   * DELIBERATELY ABSENT IN THIS PHASE (owner, 2026-09-05 ~07:03 Phoenix:
   * "Have it fall back to my Claude key for now. Defer it until everything
   * else is built then build it … not forever"). Until it lands, no key field
   * exists, `reader_key_set` stays 0, and a new catalog is provisioned with
   * the OWNER's key with `owner_key_set = 1` recorded.
   *
   * When it does land, this is the one place it is inserted: a field here, the
   * seal before the POST in submit(), and the sealed envelope on the body.
   * Nothing else in this file needs to change, and nothing anywhere prints it.
   * ---------------------------------------------------------------------- */

  if (k.wait) panel.appendChild(para(k.wait, 'rc-warn'));

  /* --- actions ---------------------------------------------------------- */
  const actions = document.createElement('div');
  actions.className = 'rc-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'rc-btn rc-btn-quiet';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal);
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'rc-btn';
  next.textContent = 'Review';
  actions.append(cancel, next);
  panel.appendChild(actions);

  const outcome = document.createElement('p');
  outcome.className = 'rc-outcome';
  outcome.setAttribute('role', 'status');
  outcome.hidden = true;
  panel.appendChild(outcome);

  function say(text) {
    outcome.hidden = false;
    outcome.textContent = text;
  }

  /* --- the live availability check -------------------------------------- */
  let timer = null;
  function showCheck(text, tone) {
    check.hidden = false;
    check.dataset.tone = tone;
    check.textContent = text;
  }
  function runCheck() {
    const typed = addrInput.value.trim().toLowerCase();
    draft.subdomain = typed;
    draft.available = null;
    clearTimeout(timer);
    if (!typed) {
      check.hidden = true;
      return;
    }
    if (!SHAPE.test(typed)) {
      // The convenience half. Words, always — never "invalid".
      showCheck(
        'Addresses are 3–40 characters of lowercase letters, numbers and hyphens, and can’t start or end with a hyphen.',
        'block',
      );
      return;
    }
    showCheck('Checking…', 'wait');
    const seq = ++draft.checkSeq;
    timer = setTimeout(async () => {
      const answer = await authedJson(`/api/estate/catalogs/availability?name=${encodeURIComponent(typed)}`);
      // ⚠️ A slower earlier keystroke must never overwrite a faster later one.
      if (!draft || seq !== draft.checkSeq) return;
      if (answer.kind !== 'answered' || !answer.ok) {
        draft.available = null;
        showCheck(said(answer, 'Couldn’t check that address just now.'), 'block');
        return;
      }
      draft.available = answer.body.available === true;
      showCheck(
        // The server knows the reserved list and the open pendings; its sentence
        // wins. The fallbacks exist only so a terse answer is never bare.
        said(
          answer,
          draft.available
            ? `${typed}.heygabi.ai is free.`
            : answer.body.reason === 'reserved'
              ? `${typed}.heygabi.ai is reserved by the estate — pick another.`
              : answer.body.reason === 'taken'
                ? `${typed}.heygabi.ai is already in use — pick another.`
                : `${typed}.heygabi.ai can’t be used — pick another.`,
        ),
        draft.available ? 'ok' : 'block',
      );
    }, 350);
  }
  addrInput.addEventListener('input', runCheck);
  nameInput.addEventListener('input', () => {
    draft.displayName = nameInput.value;
  });
  noteInput.addEventListener('input', () => {
    draft.note = noteInput.value;
  });

  next.addEventListener('click', () => {
    draft.subdomain = addrInput.value.trim().toLowerCase();
    draft.displayName = nameInput.value.trim();
    draft.note = noteInput.value.trim();
    // ⚠️ The button stays ENABLED and says why, the /universes precedent. A
    // disabled control names no cause, and a cause is the whole point.
    if (!draft.subdomain) return say('Pick an address first — it becomes the web address of your catalog.');
    if (!SHAPE.test(draft.subdomain)) {
      return say('That address won’t work: 3–40 characters, lowercase letters, numbers and hyphens, not starting or ending with a hyphen.');
    }
    if (draft.available === false) return say(check.textContent);
    if (!draft.displayName) return say('Give the catalog a display name — it is what shows on this page.');
    buildReview();
  });

  if (draft.subdomain) runCheck();
  addrInput.focus();
}

/**
 * §2.1 step 6 — the required review. It restates everything, INCLUDING that a
 * request is a request. This is the only state that can POST.
 */
function buildReview() {
  const k = KINDS[draft.kind];
  const panel = shell('Check this over');

  const dl = document.createElement('dl');
  dl.className = 'rc-review';
  const row = (term, value) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  };
  row('Catalog', k.noun.charAt(0).toUpperCase() + k.noun.slice(1));
  row('Address', `${draft.subdomain}.heygabi.ai`);
  row('Display name', draft.displayName);
  if (draft.note) row('Note to the owner', draft.note);
  const who = currentUser && (currentUser.email || currentUser.displayName);
  if (who) row('Admin', who);
  panel.appendChild(dl);

  panel.appendChild(
    para(
      'The estate owner reviews every request before a catalog is created. Nothing is built ' +
        'by pressing this — it files a request he decides on, and standing one up afterwards is ' +
        'a job he does by hand.',
      'rc-note',
    ),
  );
  if (k.wait) panel.appendChild(para(k.wait, 'rc-warn'));

  const actions = document.createElement('div');
  actions.className = 'rc-actions';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rc-btn rc-btn-quiet';
  back.textContent = 'Back';
  back.addEventListener('click', buildForm);
  const submit = document.createElement('button');
  submit.type = 'button';
  submit.className = 'rc-btn';
  submit.textContent = 'Submit request';
  actions.append(back, submit);
  panel.appendChild(actions);

  const outcome = document.createElement('p');
  outcome.className = 'rc-outcome';
  outcome.setAttribute('role', 'status');
  outcome.hidden = true;
  panel.appendChild(outcome);

  submit.addEventListener('click', async () => {
    // No double-submit: the button is out of action for the whole round trip.
    submit.disabled = true;
    back.disabled = true;
    outcome.hidden = false;
    outcome.textContent = 'Asking…';

    const body = {
      kind: draft.kind,
      desired_subdomain: draft.subdomain,
      display_name: draft.displayName,
    };
    if (draft.note) body.extra = { note: draft.note };

    const answer = await authedJson('/api/estate/catalogs/requests', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    submit.disabled = false;
    back.disabled = false;

    if (answer.kind !== 'answered' || !answer.ok) {
      // ⚠️ THE SERVER'S OWN SENTENCE, VERBATIM, for every refusal — 400, 403,
      // 409 alike. It knows the reserved list, whether somebody already asked,
      // and which of the four causes applies to this person. A second copy of
      // that wording here is a second thing to keep in step. Never a status.
      outcome.textContent = said(answer, 'That request was not accepted. Try again shortly.');
      return;
    }

    const kind = draft.kind;
    const row2 = {
      id: answer.body.id,
      kind,
      status: answer.body.status || 'pending',
      desired_subdomain: answer.body.desired_subdomain || draft.subdomain,
      display_name: answer.body.display_name || draft.displayName,
    };
    // The "+" is replaced IN PLACE (§2.1 step 7) before the modal closes, so
    // the card behind it is already correct when it does.
    setSlot(kind, { state: 'pending', row: row2 });
    buildDone(answer, row2);
  });
}

function buildDone(answer, row) {
  const panel = shell('Asked');
  panel.appendChild(
    para(
      said(
        answer,
        `Your request for ${row.desired_subdomain}.heygabi.ai is filed. The owner decides.`,
      ),
    ),
  );
  panel.appendChild(
    para('The card now reads “Requested — pending review”, and you can withdraw it from there.', 'rc-hint'),
  );
  const actions = document.createElement('div');
  actions.className = 'rc-actions';
  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'rc-btn';
  done.textContent = 'Close';
  done.addEventListener('click', closeModal);
  actions.appendChild(done);
  panel.appendChild(actions);
  done.focus();
}

/* ------------------------------------------------------------------------ *
 * Wiring — the apex-admin-link.js seam, verbatim in shape
 * ------------------------------------------------------------------------ */

if (search && cards.size) {
  search.addEventListener('estate-search:auth', async (e) => {
    const user = e.detail.user;
    if (!user) {
      currentUser = null;
      probedFor = null;
      closeModal();
      hideAll();
      return;
    }
    currentUser = user;
    if (probedFor === user.uid) return;
    probedFor = user.uid;
    hideAll(); // hidden until the probe earns otherwise

    const token = await bearer();
    if (!token) return;
    try {
      const r = await fetch(`${AUTH_ORIGIN}/api/estate/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // A fast sign-out must not land a stale answer on the page.
      if (probedFor !== user.uid) return;
      if (!r.ok) return; // fail-hidden
      const me = await r.json();
      // §9 Q2, owner: "only approved people". A pending or revoked member sees
      // no button — and never a bare refusal.
      if (me?.status !== 'approved') return;
      // ⚠️ THE FIELD BEING ABSENT IS NOT AN EMPTY LIST. /me answers `catalogs`
      // only once the migration and the routes are live (§3.6); a Worker that
      // predates them says nothing, and "says nothing" must read as hidden,
      // never as "you own none, here is a button that will 404".
      if (!Array.isArray(me.catalogs)) return;
      renderFromMe(me.catalogs);
    } catch {
      /* a failed probe fails quiet — the button is a curtain, not a lock */
    }
  });
}
