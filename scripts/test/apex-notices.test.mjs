/**
 * apex-notices.test.mjs — the bell, driven through the REAL module.
 *
 * Design: docs/info/universe-add-verse-design.md §8.9. The Worker half is
 * §§8.1–8.7 and has its own suite in apps/auth-worker; this is the page.
 *
 * ## 🔴 The five things this file exists to prove
 *
 * 1. **Every failure draws NOTHING.** Signed out, 401, 403, 404 (which is what
 *    the undeployed routes answer today), 5xx and a thrown fetch all end with
 *    no bell and no dialog — and, just as important, nothing else on the page
 *    touched. A courtesy that cannot be delivered must not become an error
 *    message about itself.
 * 2. **The causes stay DISTINCT even though the UI hides them all.** `network`
 *    is never folded into a refusal: on the day somebody debugs a missing bell
 *    that difference is the whole answer.
 * 3. **The Worker's words are rendered VERBATIM.** §8.6's guarantee that
 *    `approved` never reads as done lives in the Worker's `verseNotice()`; a
 *    page free to reword is a page free to break it, so the exact subject and
 *    the exact body — newlines and curly quotes and all — are asserted.
 * 4. **A failed action says the SERVER'S sentence**, never a bare status and
 *    never a silently dead button.
 * 5. **The opt-out sends the whole object** and is only read when the drawer is
 *    opened.
 *
 * ⚠️ Each scenario imports the module with a fresh `?case=` query so its
 * top-level DOM wiring runs again — ESM caches by URL, and one shared instance
 * would make every test depend on the order the others ran in. Same trick as
 * apex-request-catalog-seal.test.mjs, for the same reason.
 *
 * ⚠️ WHAT A GREEN RUN DOES NOT SAY: nobody has seen this signed in. The stub
 * DOM has no layout, no CSS and no shadow DOM, so "the bell is in the who
 * line" is proven only as "the module appended a slot='who-extra' child to
 * <estate-search>". The design doc's bar — a person, signed in, with a real
 * notice — is untouched by this file.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

import { attachAuthAdapter, installStubDom, installStubFetch, stubUser } from './helpers/stub-dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = pathToFileURL(
  resolve(HERE, '..', '..', 'sites', 'heygabi-home', 'public', 'assets', 'apex-notices.js'),
).href;

let caseNo = 0;

/** Let the module's un-awaited work (the prefs read) settle. */
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/**
 * Stand the module up in a fresh stub world.
 *
 * @param {object} routes  the `installStubFetch` table; `{}` makes every call
 *                         throw, which is what a rejected preflight looks like
 */
async function mount(routes) {
  const dom = installStubDom({ kinds: [] });
  const net = installStubFetch(routes);
  attachAuthAdapter(dom.search);
  caseNo += 1;
  const mod = await import(`${MODULE}?case=${caseNo}`);
  return {
    dom,
    net,
    mod,
    /** The light-DOM child the module hangs on the component's who line. */
    slot: () => dom.search.byClass('nx-slot')[0] || null,
    // ⚠️ byClass, not `className ===`: the bell's own class list grows a
    // `has-unread` when there is news, and an equality check would silently
    // stop finding it in exactly the state this file cares most about.
    bell: () => dom.search.byClass('nx-bell')[0] || null,
    badge: () => dom.search.byClass('nx-badge')[0] || null,
    dialog: () => dom.body.children.find((c) => c.tagName === 'DIALOG') || null,
    signIn: (user = stubUser()) => dom.search.dispatch('estate-search:auth', { detail: { user } }),
    signOut: () => dom.search.dispatch('estate-search:auth', { detail: { user: null } }),
    restore() {
      net.restore();
      dom.restore();
    },
  };
}

const NOTICE_APPROVED = {
  id: 12,
  kind: 'verse_approved',
  subject: '“Middle-earth” was approved',
  body:
    'Your request for the Middle-earth universe was approved.\n\nIt is not live yet, and that is normal: a ' +
    'universe is a change to a file in git that both catalogs have to be rebuilt from, so the list will not ' +
    'show it until the next build.\n\nThey said: “Good name, and we own six of them.”',
  link: 'https://heygabi.ai/universes/',
  source: 'universe_request',
  source_id: 7,
  created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  read_at: null,
};

const NOTICE_LANDED = {
  id: 9,
  kind: 'verse_landed',
  subject: '“Discworld” is live',
  body: 'Discworld is now in the estate’s universe list — the file change shipped and both catalogs were rebuilt.',
  link: 'https://heygabi.ai/universes/',
  source: 'universe_request',
  source_id: 4,
  created_at: new Date(Date.now() - 40 * 3600_000).toISOString(),
  read_at: new Date(Date.now() - 39 * 3600_000).toISOString(),
};

const CLASSES = [
  {
    key: 'verse_decided',
    label: 'A verse I asked for is decided',
    detail: 'The owner approves, declines, or a build finally lands the universe you requested.',
    default: true,
  },
];

/**
 * ⚠️ THE ROWS ARE CLONED. The module marks a notice read by writing `read_at`
 * onto the object it was handed — which is what a page holding server state
 * should do — so a shared fixture would arrive at the next test already read,
 * and that test would fail for a reason that has nothing to do with it.
 */
const listAnswer = (notices) => {
  const rows = notices.map((n) => ({ ...n }));
  return {
    status: 200,
    body: { notices: rows, unread: rows.filter((n) => !n.read_at).length, classes: CLASSES },
  };
};

/* ─────────────────────────────────────────────────────────────────────────
 * 1. Every refusal is invisible
 * ───────────────────────────────────────────────────────────────────────── */

describe('🔴 nothing is drawn when the notices door does not answer', () => {
  it('signed out: no bell, and not one request', async () => {
    const t = await mount({ 'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]) });
    try {
      await t.signOut();
      assert.equal(t.bell(), null, 'a signed-out visitor gets no bell at all');
      assert.equal(t.net.calls.length, 0, 'and the page asks the estate nothing');
    } finally {
      t.restore();
    }
  });

  it('⚠️ 404 — TODAY’S live answer, the Worker is not deployed — draws nothing', async () => {
    const t = await mount({
      'GET /api/estate/notifications': { status: 404, body: { error: 'not_found' } },
    });
    try {
      const verdict = await t.signIn();
      assert.equal(verdict, 'unavailable');
      assert.equal(t.bell(), null);
      assert.equal(t.dialog(), null, 'and no dialog is left on the page either');
      // ⚠️ Stronger than "hidden": on a failure path the module appends
      // NOTHING to the component at all — no empty pill, no placeholder.
      assert.equal(t.slot(), null, 'the who line is not touched');
    } finally {
      t.restore();
    }
  });

  it('5xx draws nothing', async () => {
    const t = await mount({
      'GET /api/estate/notifications': { status: 502, body: { error: 'notices_unreadable', detail: 'nope' } },
    });
    try {
      assert.equal(await t.signIn(), 'unavailable');
      assert.equal(t.bell(), null);
    } finally {
      t.restore();
    }
  });

  it('⚠️ a THROWN fetch is `network`, never a refusal — the CORS-preflight shape', async () => {
    const t = await mount({});
    try {
      assert.equal(await t.signIn(), 'network', 'a network failure is not a permission failure');
      assert.equal(t.bell(), null);
    } finally {
      t.restore();
    }
  });

  it('401 and 403 read as signed-out, not as an error to shout about', async () => {
    for (const status of [401, 403]) {
      const t = await mount({
        'GET /api/estate/notifications': { status, body: { error: 'forbidden', detail: 'x' } },
      });
      try {
        assert.equal(await t.signIn(), 'signed-out', `status ${status}`);
        assert.equal(t.bell(), null);
      } finally {
        t.restore();
      }
    }
  });

  it('signing out after a good answer takes the bell away again', async () => {
    const t = await mount({ 'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]) });
    try {
      await t.signIn();
      assert.notEqual(t.bell(), null);
      await t.signOut();
      assert.equal(t.slot().hidden, true, 'the slot is hidden the moment the session goes');
    } finally {
      t.restore();
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 2. The bell and its count
 * ───────────────────────────────────────────────────────────────────────── */

describe('the bell', () => {
  it('draws the unread count, and says it in words for a screen reader', async () => {
    const t = await mount({ 'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED, NOTICE_LANDED]) });
    try {
      assert.equal(await t.signIn(), 'ok');
      const bell = t.bell();
      assert.notEqual(bell, null);
      assert.equal(t.badge().hidden, false);
      assert.equal(t.badge().textContent, '1');
      assert.equal(bell.getAttribute('aria-label'), 'Notices — 1 unread', 'a glyph is not a label');
    } finally {
      t.restore();
    }
  });

  it('⚠️ is drawn at ZERO unread too — the opt-out has to live somewhere findable', async () => {
    const t = await mount({ 'GET /api/estate/notifications': listAnswer([]) });
    try {
      await t.signIn();
      const bell = t.bell();
      assert.notEqual(bell, null, 'no news is not the same as no feature');
      assert.equal(t.badge().hidden, true);
      assert.equal(bell.getAttribute('aria-label'), 'Notices — nothing unread');
    } finally {
      t.restore();
    }
  });

  it('probes once per sign-in, not once per event', async () => {
    const t = await mount({ 'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]) });
    try {
      await t.signIn();
      assert.equal(await t.signIn(), 'already-probed');
      assert.equal(t.net.calls.filter((c) => c.path === '/api/estate/notifications').length, 1);
    } finally {
      t.restore();
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 3. The panel — and the words in it
 * ───────────────────────────────────────────────────────────────────────── */

describe('the panel', () => {
  it('🔴 renders the Worker’s subject and body VERBATIM', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      const d = t.dialog();
      assert.notEqual(d, null);
      const subject = d.byClass('nx-subject')[0];
      const body = d.byClass('nx-body')[0];
      assert.equal(subject.textContent, NOTICE_APPROVED.subject, 'not re-wrapped, not re-quoted');
      assert.equal(body.textContent, NOTICE_APPROVED.body, 'newlines and the decider’s quote survive intact');
      // §8.6, defended where a person actually reads it.
      assert.ok(body.textContent.includes('It is not live yet'), '`approved` still never reads as done');
    } finally {
      t.restore();
    }
  });

  it('an unread notice offers Mark read; a read one does not', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED, NOTICE_LANDED]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      const items = t.dialog().byClass('nx-item');
      assert.equal(items.length, 2);
      assert.equal(t.dialog().byClass('nx-read').length, 1, 'one button for the one unread row');
      assert.ok(items[0].className.includes('nx-unread'));
      assert.ok(!items[1].className.includes('nx-unread'));
    } finally {
      t.restore();
    }
  });

  it('⚠️ an empty list says so in words and never shows the operator’s `fix`', async () => {
    const t = await mount({
      // The Worker-ahead-of-0019 answer: 200, empty, plus an npm command.
      'GET /api/estate/notifications': {
        status: 200,
        body: {
          error: 'estate_notification_table_missing',
          detail: 'The notices table does not exist in this database…',
          fix: 'npm run db:migrate (from apps/auth-worker) applies 0019_estate_notification.sql remotely',
          notices: [],
          unread: 0,
          classes: CLASSES,
        },
      },
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      const text = t.dialog().textContent;
      assert.ok(text.includes('Nothing yet.'), 'the member gets the empty state');
      assert.ok(!text.includes('db:migrate'), 'and never an npm command — that sentence is for whoever is debugging');
    } finally {
      t.restore();
    }
  });

  it('marks one read, and the badge follows the SERVER’s answer', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
      'POST /api/estate/notifications/12/read': { status: 200, body: { ok: true, id: 12, read_at: '2026-09-05T22:00:00Z' } },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      await t.dialog().button('Mark read').click();
      await settle();
      assert.equal(t.badge().hidden, true);
      assert.equal(t.bell().getAttribute('aria-label'), 'Notices — nothing unread');
      assert.equal(t.dialog().byClass('nx-read').length, 0, 'the row stops offering a button it no longer needs');
    } finally {
      t.restore();
    }
  });

  it('🔴 a failed Mark read says the SERVER’s sentence, never a bare status', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
      'POST /api/estate/notifications/12/read': {
        status: 502,
        body: { error: 'read_failed', detail: 'The estate directory refused the write — nothing changed.' },
      },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      await t.dialog().button('Mark read').click();
      await settle();
      const note = t.dialog().byClass('nx-note')[0];
      assert.equal(note.textContent, 'The estate directory refused the write — nothing changed.');
      assert.equal(t.badge().textContent, '1', 'and the count did not lie');
    } finally {
      t.restore();
    }
  });

  it('marks them all read in one call', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED, { ...NOTICE_LANDED, read_at: null }]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
      'POST /api/estate/notifications/read-all': { status: 200, body: { ok: true, read_at: '2026-09-05T22:00:00Z' } },
    });
    try {
      await t.signIn();
      assert.equal(t.badge().textContent, '2');
      t.bell().click();
      await settle();
      await t.dialog().button('Mark all read').click();
      await settle();
      assert.equal(t.badge().hidden, true);
      assert.equal(t.dialog().button('Mark all read'), null, 'the button retires when there is nothing left to clear');
    } finally {
      t.restore();
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 4. The opt-out
 * ───────────────────────────────────────────────────────────────────────── */

describe('the opt-out', () => {
  it('⚠️ is read when the drawer OPENS, not on every page load', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([NOTICE_APPROVED]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
    });
    try {
      await t.signIn();
      assert.equal(t.net.calls.filter((c) => c.path.endsWith('/prefs')).length, 0, 'nothing asked yet');
      t.bell().click();
      await settle();
      assert.equal(t.net.calls.filter((c) => c.path.endsWith('/prefs')).length, 1);
    } finally {
      t.restore();
    }
  });

  it('🔴 says out loud that OFF means the notice is never written', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      const honesty = t.dialog().byClass('nx-honesty')[0];
      assert.ok(honesty, 'the sentence exists');
      assert.ok(honesty.textContent.includes('stops writing'));
      assert.ok(honesty.textContent.includes('does not hide'), '“off” must not read as “hide these”');
      // The label is the WORKER's, not a second copy of it on the page.
      assert.ok(t.dialog().textContent.includes(CLASSES[0].label));
      assert.ok(t.dialog().textContent.includes(CLASSES[0].detail));
    } finally {
      t.restore();
    }
  });

  it('⚠️ POSTs the WHOLE object, because the door refuses rather than strips', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
      'POST /api/estate/notifications/prefs': {
        status: 200,
        body: { ok: true, prefs: { verse_decided: false }, classes: CLASSES },
      },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      const box = t.dialog().byTag('input')[0];
      assert.equal(box.checked, true, 'default ON, as the class says');
      box.checked = false;
      await box.dispatch('change', { type: 'change' });
      await settle();
      assert.deepEqual(t.net.bodyOf('POST', '/api/estate/notifications/prefs'), { verse_decided: false });
    } finally {
      t.restore();
    }
  });

  it('a refused save puts the switch back and says why', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([]),
      'GET /api/estate/notifications/prefs': { status: 200, body: { prefs: { verse_decided: true }, classes: CLASSES } },
      'POST /api/estate/notifications/prefs': {
        status: 502,
        body: { error: 'prefs_write_failed', detail: 'The estate directory refused the write — nothing was stored.' },
      },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      const box = t.dialog().byTag('input')[0];
      box.checked = false;
      await box.dispatch('change', { type: 'change' });
      await settle();
      assert.equal(box.checked, true, 'a control that looks changed and is not is worse than one that refused');
      assert.ok(t.dialog().textContent.includes('refused the write'));
    } finally {
      t.restore();
    }
  });

  it('⚠️ an unreadable prefs answer says so — it does not draw a switch it never read', async () => {
    const t = await mount({
      'GET /api/estate/notifications': listAnswer([]),
      'GET /api/estate/notifications/prefs': { status: 503, body: { error: 'estate_prefs_table_missing', detail: 'no table' } },
    });
    try {
      await t.signIn();
      t.bell().click();
      await settle();
      assert.equal(t.dialog().byTag('input').length, 0, 'no checkbox pretending to be a setting');
      assert.ok(t.dialog().textContent.includes('no table'), 'the server’s own sentence');
    } finally {
      t.restore();
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * 5. The pure bits
 * ───────────────────────────────────────────────────────────────────────── */

describe('the pure helpers', () => {
  it('⚠️ safeLink refuses anything that is not plainly https', async () => {
    const t = await mount({});
    try {
      const { safeLink } = t.mod;
      assert.equal(safeLink('https://heygabi.ai/universes/'), 'https://heygabi.ai/universes/');
      assert.equal(safeLink('javascript:alert(1)'), null, 'a link field is data, not a URL you trust');
      assert.equal(safeLink('http://heygabi.ai/'), null);
      assert.equal(safeLink(null), null);
      assert.equal(safeLink(''), null);
    } finally {
      t.restore();
    }
  });

  it('whenText speaks a person’s grammar, and an unparseable instant is silence', async () => {
    const t = await mount({});
    try {
      const { whenText } = t.mod;
      const now = Date.parse('2026-09-05T22:00:00Z');
      assert.equal(whenText('2026-09-05T21:59:30Z', now), 'just now');
      assert.equal(whenText('2026-09-05T19:00:00Z', now), '3 hours ago');
      assert.equal(whenText('2026-09-04T22:00:00Z', now), 'yesterday');
      assert.equal(whenText('not a date', now), '', 'never “Invalid Date” and never “age unknown” at a member');
    } finally {
      t.restore();
    }
  });

  it('bellLabel counts in words, singular included', async () => {
    const t = await mount({});
    try {
      const { bellLabel } = t.mod;
      assert.equal(bellLabel(0), 'Notices — nothing unread');
      assert.equal(bellLabel(1), 'Notices — 1 unread');
      assert.equal(bellLabel(4), 'Notices — 4 unread');
    } finally {
      t.restore();
    }
  });

  it('said() prefers the server’s detail, and words an outage as an outage', async () => {
    const t = await mount({});
    try {
      const { said } = t.mod;
      assert.equal(said({ kind: 'answered', body: { detail: 'the door said this' } }, 'fallback'), 'the door said this');
      assert.equal(said({ kind: 'answered', body: {} }, 'fallback'), 'fallback');
      assert.ok(said({ kind: 'network' }, 'fallback').includes('outage, not a permissions problem'));
      assert.ok(said({ kind: 'lapsed' }, 'fallback').includes('sign-in has lapsed'));
    } finally {
      t.restore();
    }
  });
});
