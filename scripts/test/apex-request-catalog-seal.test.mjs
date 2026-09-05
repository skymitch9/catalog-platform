/**
 * The "+" form's sealed-key path, driven through the REAL module (design §6,
 * §4.5) with the stub DOM in `helpers/stub-dom.mjs`.
 *
 * ## 🔴 The four things this file exists to prove, each traced to a real risk
 *
 * 1. **An empty field sends NO `sealed_key`.** The optional field must be
 *    genuinely optional; a `null` or `""` on the wire is a field an older or
 *    stricter server can reject, turning "I left it blank" into "my request
 *    failed".
 * 2. **A filled field sends an ENVELOPE and the plaintext appears nowhere** —
 *    not in the POST body, not in the DOM, not on the console. This is the
 *    whole security claim of §6.1, asserted rather than reasoned about.
 * 3. **`reader_key_set !== 1` is rendered as a WARNING.** A Worker deployed
 *    before the sealed-key routes ignores an unknown body field and answers a
 *    cheerful 201. Believing our own POST instead of the row is how somebody is
 *    told their key is safe when it was dropped on the floor.
 * 4. **An unsupported browser gets NO field and NO explanation**, and submit
 *    still works. Fail-quiet, the posture the "+" itself carries.
 *
 * ⚠️ Each scenario imports the module with a fresh `?case=` query so it runs its
 * top-level DOM wiring again — ESM caches by URL, and one shared instance would
 * make every test depend on the order the others ran in.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  attachAuthAdapter,
  captureConsole,
  installStubDom,
  installStubFetch,
  stubUser,
} from './helpers/stub-dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = pathToFileURL(
  resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public', 'assets', 'apex-request-catalog.js'),
).href;

/** Looks like an Anthropic key, is not one, and is unmistakable in a haystack. */
const CANARY = 'sk-ant-api03-CANARY-d0-not-leak-2b7f1c9e';

let caseNo = 0;

/**
 * Stand the module up in a fresh stub world, sign a user in, and hand the test
 * everything it needs to drive the form.
 *
 * @param {object} o
 * @param {boolean} [o.secure]   false ⇒ `sealSupported()` is false, the field is hidden
 * @param {object}  [o.submit]   the answer `POST …/requests` gives
 */
async function openForm({ secure = true, submit = null } = {}) {
  const dom = installStubDom({ kinds: ['books', 'games'] });
  const con = captureConsole();
  const hadSecure = Object.prototype.hasOwnProperty.call(globalThis, 'isSecureContext');
  const prevSecure = globalThis.isSecureContext;
  if (!secure) globalThis.isSecureContext = false;

  const fetchStub = installStubFetch({
    'GET /api/estate/me': { status: 200, body: { status: 'approved', catalogs: [] } },
    'POST /api/estate/catalogs/requests': submit || {
      status: 201,
      body: {
        ok: true,
        id: 42,
        kind: 'books',
        status: 'pending',
        desired_subdomain: 'amber',
        display_name: 'Amber’s shelf',
        reader_key_set: 1,
        detail: 'Filed. The owner decides.',
      },
    },
  });

  attachAuthAdapter(dom.search);
  await import(`${MODULE}?case=${++caseNo}`);
  // The auth seam: the module probes /me once per sign-in and draws from it.
  await dom.search.dispatch('estate-search:auth', { detail: { user: stubUser() } });
  // The probe is two awaits deep; let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 0));

  const slot = dom.slot('books');
  assert.ok(slot && !slot.hidden, 'the "+" should be drawn for an approved member owning nothing');
  slot.byClass('card-add')[0].click();

  const dialog = dom.dialog();
  assert.ok(dialog && dialog.open, 'the modal should be open');

  const restore = () => {
    con.restore();
    fetchStub.restore();
    dom.restore();
    if (hadSecure) globalThis.isSecureContext = prevSecure;
    else delete globalThis.isSecureContext;
  };

  return { dom, dialog, fetchStub, con, restore };
}

/** Fill the form's three ordinary fields; the key field is the caller's business. */
function fillBasics(dialog) {
  const inputs = dialog.byTag('input');
  inputs[0].value = 'amber'; // address
  inputs[1].value = 'Amber’s shelf'; // display name
  return inputs;
}

/** The password input is the key field; there is exactly one or none. */
function keyField(dialog) {
  return dialog.byTag('input').filter((i) => i.type === 'password');
}

describe('the key field is rendered only when the browser can seal', () => {
  it('shown, labelled honestly, on a secure context with WebCrypto', async () => {
    const t = await openForm();
    try {
      const keys = keyField(t.dialog);
      assert.equal(keys.length, 1, 'exactly one key field');
      const text = t.dialog.textContent;
      assert.match(text, /Your Anthropic API key \(optional\)/);
      // The three facts §6 requires a person to be told, in words.
      assert.match(text, /sealed in your browser/);
      assert.match(text, /the owner can never read it/);
      assert.match(text, /runs on the owner’s key/);
    } finally {
      t.restore();
    }
  });

  it('🔴 HIDDEN AND SILENT when sealing is unsupported — and submit still works', async () => {
    const t = await openForm({ secure: false });
    try {
      assert.equal(keyField(t.dialog).length, 0, 'no key field on a browser that cannot seal');
      // ⚠️ And NOTHING is said about it. A sentence here would be an apology
      // for a browser the reader cannot change.
      assert.ok(!/Anthropic/.test(t.dialog.textContent), 'the unsupported case must not explain itself');

      fillBasics(t.dialog);
      await t.dialog.button('Review').click();
      await t.dialog.button('Submit request').click();
      const body = t.fetchStub.bodyOf('POST', '/api/estate/catalogs/requests');
      assert.ok(body, 'the request still went');
      assert.ok(!('sealed_key' in body));
    } finally {
      t.restore();
    }
  });
});

describe('an empty key field', () => {
  it('puts NO sealed_key on the wire — not null, not empty, absent', async () => {
    const t = await openForm();
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = '   '; // whitespace is empty
      await t.dialog.button('Review').click();
      // The review restates the truth for the blank case.
      assert.match(t.dialog.textContent, /None — your catalog will run on the owner’s key/);
      await t.dialog.button('Submit request').click();

      const body = t.fetchStub.bodyOf('POST', '/api/estate/catalogs/requests');
      assert.deepEqual(Object.keys(body).sort(), ['desired_subdomain', 'display_name', 'kind']);
      assert.ok(!('sealed_key' in body));
    } finally {
      t.restore();
    }
  });
});

describe('a filled key field', () => {
  it('sends the six-field envelope and NEVER the key', async () => {
    const t = await openForm();
    try {
      fillBasics(t.dialog);
      const key = keyField(t.dialog)[0];
      key.value = CANARY;

      await t.dialog.button('Review').click();

      // 1. cleared from the DOM the instant it is sealed (the field is gone
      //    from this panel entirely, but the node object must be empty too).
      assert.equal(key.value, '', 'the plaintext was left in the input');
      // 2. the review restates ATTACHED, never the value.
      assert.match(t.dialog.textContent, /Attached and sealed in this browser/);
      assert.ok(!t.dialog.textContent.includes(CANARY), 'the key reached the review panel');

      await t.dialog.button('Submit request').click();

      const body = t.fetchStub.bodyOf('POST', '/api/estate/catalogs/requests');
      assert.ok(body.sealed_key, 'no envelope on the body');
      assert.deepEqual(Object.keys(body.sealed_key).sort(), ['alg', 'ct', 'ek', 'iv', 'kid', 'v']);
      assert.equal(body.sealed_key.v, 1);
      assert.equal(body.sealed_key.alg, 'RSA-OAEP-256+A256GCM');
      assert.match(body.sealed_key.kid, /^[0-9a-f]{16}$/);

      // 3. THE LEAK SWEEP. The raw request body, the whole dialog, the whole
      //    page body, and everything written to the console.
      const raw = t.fetchStub.calls.find((c) => c.method === 'POST').body;
      assert.ok(!raw.includes(CANARY), 'the plaintext is on the wire');
      assert.ok(!t.dialog.textContent.includes(CANARY), 'the plaintext is in the dialog');
      assert.ok(!t.dom.body.textContent.includes(CANARY), 'the plaintext is on the page');
      assert.ok(!t.con.text().includes(CANARY), 'the plaintext reached the console');
    } finally {
      t.restore();
    }
  });

  it('refuses an over-long value IN WORDS, sends nothing, and does not advance', async () => {
    const t = await openForm();
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = 'x'.repeat(600);
      await t.dialog.button('Review').click();

      assert.ok(t.dialog.button('Review'), 'still on the form — the review step was not reached');
      const outcome = t.dialog.byClass('rc-outcome')[0];
      assert.match(outcome.textContent, /limit is 512/);
      assert.match(outcome.textContent, /nothing was sent/);
      assert.equal(
        t.fetchStub.calls.filter((c) => c.method === 'POST').length,
        0,
        'a refused seal must not POST',
      );
    } finally {
      t.restore();
    }
  });

  it('the pending pill says "key provided" only when the ROW says 1', async () => {
    const t = await openForm();
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = CANARY;
      await t.dialog.button('Review').click();
      await t.dialog.button('Submit request').click();

      const pill = t.dom.slot('books').byClass('card-pending')[0];
      assert.match(pill.textContent, /Requested — pending review/);
      assert.match(pill.textContent, /key provided/);
      assert.ok(!pill.textContent.includes(CANARY));
      // And the "asked" panel says what happens next, in words.
      assert.match(t.dialog.textContent, /Your key is attached, sealed/);
    } finally {
      t.restore();
    }
  });
});

describe('🔴 an old server that drops the key', () => {
  const OLD_SERVER = {
    status: 201,
    // No `reader_key_set` at all — exactly what a Worker deployed before the
    // sealed-key routes answers, having ignored the field it did not know.
    body: { ok: true, id: 43, status: 'pending', desired_subdomain: 'amber', display_name: 'Amber’s shelf' },
  };

  it('says the request was filed AND the key was not stored — never claims success', async () => {
    const t = await openForm({ submit: OLD_SERVER });
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = CANARY;
      await t.dialog.button('Review').click();
      await t.dialog.button('Submit request').click();

      const text = t.dialog.textContent;
      assert.match(text, /Your request was filed, but the key was not stored/);
      assert.ok(!/Your key is attached, sealed/.test(text), 'the success sentence must not also appear');
      // ⚠️ And it is not dressed as a failure of THEIRS or as a permissions
      // problem — the request landed and they are told what to do about it.
      assert.match(text, /Mention it when he reviews the request/);
      assert.ok(!t.dom.body.textContent.includes(CANARY));

      // The pill must NOT claim a key.
      const pill = t.dom.slot('books').byClass('card-pending')[0];
      assert.ok(!/key provided/.test(pill.textContent));
    } finally {
      t.restore();
    }
  });

  it('a reader_key_set of 0 is the same answer as an absent one', async () => {
    const t = await openForm({
      submit: { status: 201, body: { ok: true, id: 44, status: 'pending', desired_subdomain: 'amber', reader_key_set: 0 } },
    });
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = CANARY;
      await t.dialog.button('Review').click();
      await t.dialog.button('Submit request').click();
      assert.match(t.dialog.textContent, /the key was not stored/);
    } finally {
      t.restore();
    }
  });

  it('a warnings[] sentence from the server is rendered verbatim, beside our own', async () => {
    const t = await openForm({
      submit: {
        status: 201,
        body: {
          ok: true,
          id: 45,
          status: 'pending',
          desired_subdomain: 'amber',
          reader_key_set: 0,
          warnings: ['The key store could not be reached, so your key was not kept.'],
        },
      },
    });
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = CANARY;
      await t.dialog.button('Review').click();
      await t.dialog.button('Submit request').click();
      assert.match(t.dialog.textContent, /The key store could not be reached/);
    } finally {
      t.restore();
    }
  });
});

describe('a Back from the review step', () => {
  it('offers to replace or remove the sealed key and can show nothing of it', async () => {
    const t = await openForm();
    try {
      fillBasics(t.dialog);
      keyField(t.dialog)[0].value = CANARY;
      await t.dialog.button('Review').click();
      t.dialog.button('Back').click();

      const text = t.dialog.textContent;
      assert.match(text, /A key is attached and already sealed — it cannot be shown/);
      assert.ok(!text.includes(CANARY));
      assert.equal(keyField(t.dialog)[0].value, '', 'the field must come back empty');

      t.dialog.button('Remove the attached key').click();
      assert.match(t.dialog.textContent, /Removed\. Your catalog will run on the owner’s key\./);

      await t.dialog.button('Review').click();
      await t.dialog.button('Submit request').click();
      const body = t.fetchStub.bodyOf('POST', '/api/estate/catalogs/requests');
      assert.ok(!('sealed_key' in body), 'a removed key must not still be sent');
    } finally {
      t.restore();
    }
  });
});
