/**
 * status/api/api.js — the API tab's one job: mint and rotate machine keys.
 *
 * Owner ask 2026-08-20: "a way for justin to gen a key or regen a key... all
 * from the ui page for max safety", housed in "a new tab under status called
 * API". Endpoints are GET/POST /api/estate/shelf/parity/token
 * (apps/auth-worker/src/shelf-token.ts), both requireDevops().
 *
 * ⚠️ THE MINTED VALUE IS NEVER STORED IN THIS MODULE'S STATE. It is written
 * straight into the DOM node that displays it and read back from that node
 * when the copy button is pressed. There is deliberately no `let lastToken`:
 * a module-scoped copy would survive sign-out, survive the gate closing, and
 * be sitting in memory for anything that later gets injected onto this page.
 * The DOM node is cleared by clearOnce(), which the gate's onDenied calls.
 *
 * ⚠️ EVERY VALUE FROM THE API IS WRITTEN WITH textContent, NEVER innerHTML —
 * the same escaping boundary the runbook shim's facts form documents. The
 * fingerprint and the actor email are server-side strings, but the rule is
 * the rule precisely so nobody has to re-derive whether this one is safe.
 */

import { idToken } from '../../assets/estate-auth.js';
import { AUTH_ORIGIN } from '../lib/core.js';
import { mountGate } from '../lib/gate.js';

const TOKEN_URL = `${AUTH_ORIGIN}/api/estate/shelf/parity/token`;

const section = document.getElementById('api-section');
const factsEl = document.getElementById('parity-facts');
const genBtn = document.getElementById('parity-gen');
const revokeWrap = document.getElementById('parity-revoke-wrap');
const revokeBox = document.getElementById('parity-revoke');
const statusEl = document.getElementById('parity-status');
const onceMount = document.getElementById('parity-once');

function setStatus(text, tone) {
  statusEl.textContent = text || '';
  statusEl.dataset.tone = tone || '';
}

function clearOnce() {
  onceMount.textContent = '';
}

function when(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function ago(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/** One <li> per fact. Built rather than templated so nothing goes through
 *  innerHTML on a page that handles a credential. */
function fact(key, value, mono) {
  const li = document.createElement('li');
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = key;
  const v = document.createElement('span');
  v.className = mono ? 'v mono' : 'v';
  v.textContent = value;
  li.append(k, v);
  return li;
}

function renderFacts(view, legacyPresent) {
  factsEl.textContent = '';

  if (!view || !view.exists) {
    factsEl.append(fact('Status', legacyPresent
      ? 'No self-service key yet — the box is still on the original hand-delivered one.'
      : 'No key yet. Generate one to start reporting.'));
    genBtn.textContent = 'Generate key';
    revokeWrap.hidden = true;
    return;
  }

  factsEl.append(fact('Key', `${view.fingerprint}…`, true));
  factsEl.append(fact('Created', `${when(view.created_at)} by ${view.created_by}`));

  // ⚠️ "Last used" is the diagnostic that makes this page worth visiting: it
  // is how someone tells "my paste worked" from "my paste silently didn't".
  const used = view.last_used_at;
  factsEl.append(fact('Last used', used
    ? `${when(used)} (${ago(used)})`
    : 'never — the server has not reported with this key yet'));

  if (view.previous_valid_until) {
    factsEl.append(fact('Previous key',
      `${view.previous_fingerprint}… still valid until ${when(view.previous_valid_until)}`, true));
  }
  if (legacyPresent) {
    factsEl.append(fact('Original key',
      'the hand-delivered one still works — remove it once this key is reporting'));
  }

  genBtn.textContent = 'Regenerate key';
  revokeWrap.hidden = false;
}

async function authedFetch(url, init) {
  const token = await idToken();
  if (!token) return { authLapsed: true };
  const headers = { authorization: `Bearer ${token}`, ...(init && init.headers) };
  try {
    const res = await fetch(url, { ...init, headers });
    return { res };
  } catch {
    return { networkError: true };
  }
}

async function loadKey() {
  setStatus('', '');
  const r = await authedFetch(TOKEN_URL);
  if (r.authLapsed) { setStatus('Sign-in lapsed — sign in again.', 'err'); return; }
  if (r.networkError) { setStatus('Could not reach the key service (network). Try again shortly.', 'err'); return; }

  const { res } = r;
  if (res.status === 401 || res.status === 403) {
    // §1e: never a bare HTTP status — say what it needs and how to get it.
    setStatus('Only devops accounts can manage keys. Ask Skylar for the devops role.', 'err');
    return;
  }
  if (!res.ok) { setStatus('Could not read the current key. Try again shortly.', 'err'); return; }

  let data;
  try { data = await res.json(); } catch { setStatus('The answer was unreadable.', 'err'); return; }
  renderFacts(data.token, Boolean(data.legacy_secret_present));
}

/** Build the show-once panel. Called exactly once per mint; the value lives
 *  only in the node this creates. */
function showOnce(token, envLine, previousUntil) {
  clearOnce();

  const box = document.createElement('div');
  box.className = 'once-box';

  const h = document.createElement('p');
  h.className = 'once-h';
  h.textContent = 'Copy this now — it is never shown again.';
  box.append(h);

  const val = document.createElement('code');
  val.className = 'once-val';
  val.id = 'once-val';
  val.textContent = envLine;
  box.append(val);

  const actions = document.createElement('div');
  actions.className = 'once-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn';
  copyBtn.textContent = 'Copy the line';
  const copyNote = document.createElement('span');
  copyNote.className = 'key-status';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(val.textContent);
      copyNote.textContent = 'Copied.';
      copyNote.dataset.tone = 'ok';
    } catch {
      // Clipboard can be refused (permissions, insecure context). Selecting it
      // for the reader beats telling them it failed and stopping there.
      const range = document.createRange();
      range.selectNodeContents(val);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      copyNote.textContent = 'Could not copy automatically — it is selected, press Ctrl/Cmd+C.';
      copyNote.dataset.tone = 'err';
    }
  });

  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'linkbtn';
  doneBtn.textContent = 'I have saved it — hide';
  doneBtn.addEventListener('click', () => { clearOnce(); loadKey(); });

  actions.append(copyBtn, doneBtn, copyNote);
  box.append(actions);

  const tail = document.createElement('p');
  tail.className = 'key-scope';
  tail.style.margin = '.8rem 0 0';
  tail.textContent = previousUntil
    ? `The previous key keeps working until ${when(previousUntil)}, so nothing goes dark if this paste goes wrong.`
    : 'The previous key (if there was one) has been revoked immediately.';
  box.append(tail);

  onceMount.append(box);
  // Move focus so a keyboard/screen-reader user lands on the thing that just
  // appeared rather than being left on the button they pressed.
  val.setAttribute('tabindex', '-1');
  val.focus();
}

async function generate() {
  const rotating = genBtn.textContent.startsWith('Regenerate');
  const revokeNow = !revokeWrap.hidden && revokeBox.checked;

  if (rotating && revokeNow) {
    // The one destructive variant on this page: it takes a working key away
    // from a machine that is using it, with no grace. Confirm in words.
    const ok = window.confirm(
      'Kill the old key immediately?\n\n' +
      'The shelf server stops being able to report the moment you continue, ' +
      'until the new key is installed on it. Use this only if you think the ' +
      'old key leaked.',
    );
    if (!ok) return;
  }

  genBtn.disabled = true;
  setStatus(rotating ? 'Rotating…' : 'Generating…', '');
  clearOnce();

  const r = await authedFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ revoke_now: revokeNow }),
  });

  genBtn.disabled = false;

  if (r.authLapsed) { setStatus('Sign-in lapsed — sign in again, then retry.', 'err'); return; }
  if (r.networkError) {
    // ⚠️ A network failure here is genuinely ambiguous — the key may or may not
    // have been created. Say so rather than implying nothing happened.
    setStatus('Could not reach the key service. Reload this page before generating again — the key may have been created.', 'err');
    return;
  }

  const { res } = r;
  if (res.status === 401 || res.status === 403) {
    setStatus('Only devops accounts can generate keys. Ask Skylar for the devops role.', 'err');
    return;
  }
  if (!res.ok) { setStatus('The key was not created. Try again shortly.', 'err'); return; }

  let data;
  try {
    data = await res.json();
  } catch {
    setStatus('The key was created but the answer was unreadable — reload and check the fingerprint before generating another.', 'err');
    return;
  }
  if (typeof data.token !== 'string' || !data.token) {
    setStatus('The answer carried no key. Reload and check before generating another.', 'err');
    return;
  }

  setStatus(rotating ? 'Rotated.' : 'Created.', 'ok');
  revokeBox.checked = false;
  showOnce(data.token, data.env_line, data.previous_valid_until);
  renderFacts(data.token_view, false);
}

genBtn.addEventListener('click', generate);

mountGate({
  sections: [section],
  onAllowed: loadKey,
  onDenied: () => {
    // The gate closing must take the credential off the screen with it.
    clearOnce();
    setStatus('', '');
  },
});
