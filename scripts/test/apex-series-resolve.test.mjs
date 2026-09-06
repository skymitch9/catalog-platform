/**
 * apex-series-resolve.test.mjs — the /series confirm-queue card's RESOLVE
 * control, exercised against the real module.
 *
 * ⚠️ WHY THIS FILE IS BEHAVIOURAL WHERE `apex-registry-consumers.test.mjs` IS
 * SOURCE-LEVEL. That file checks WIRING inside `series/series.js`, which cannot
 * be imported in Node (top-level getElementById; `estate-auth.js` pulls the
 * Firebase SDK off a CDN). This one imports
 * `assets/series-pending.js` — which exists precisely so the DECISION is not
 * stuck inside a file that can only be read. What is under test is a write to a
 * persisted key: `series_alias`, every `entry.series_slug` under the absorbed
 * spelling, and a `series_pending` row the queue is built never to re-ask.
 *
 * 🔴 A green run says the module's LOGIC is right — the request shape, which
 * slug survives, what a person is told when it fails. It says nothing about
 * what anybody SEES. Nobody has pressed the button signed in; that is the
 * owner's step and it is named as such in `docs/TODO.md`.
 *
 * The six real rows this was built for are listed in the library repo's
 * `docs/TODO.md` (agent W6-LIBDATA), and one of them — `skyward` — is the
 * fixture in "the candidate side can be the survivor" below, because it is the
 * case a merge-into-the-closest-only control would get WRONG.
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { installStubDom } from './helpers/stub-dom.mjs';

import {
  NOT_APPROVER_NOTE,
  PENDING_PATH_FALLBACK,
  candidatesFor,
  mergeBody,
  pendingCard,
  queueSentence,
  resolveFailureNote,
  resolvePathFor,
  resolvedNote,
  safePendingPath,
  separateBody,
} from '../../sites/heygabi-home/public/assets/series-pending.js';

/** A queue row shaped like `GET /api/series/pending` answers one. */
function row(over = {}) {
  return {
    candidate_fold: 'good girl s guide to murder 2',
    candidate_display: 'A Good Girl’s Guide to Murder 2',
    candidate_slug: 'good-girl-s-guide-to-murder-2',
    closest_slug: 'good-girl-s-guide-to-murder',
    closest_display: 'A Good Girl’s Guide to Murder',
    near_key: 'good girl s guide to murder',
    candidate_entries: 0,
    closest_entries: 3,
    sample_titles: [{ source: 'library2', title: 'Good Girl, Bad Blood' }],
    sources: ['library2'],
    created_at: '2026-09-01T00:00:00.000Z',
    resolved_at: null,
    ...over,
  };
}

let dom;
beforeEach(() => {
  dom = installStubDom();
});
afterEach(() => {
  dom.restore();
});

/** Build a card with a recording resolve(), and hand back both. */
function card(over = {}, answer = { data: { resolved_as: 'merged', rows_repointed: 3, surviving_display: 'A Good Girl’s Guide to Murder' } }) {
  const calls = [];
  const resolved = [];
  const el = pendingCard(row(over), {
    sourceLabel: (s) => (s === 'library2' ? 'Samantha’s library' : s),
    resolve: async (fold, body) => {
      calls.push({ fold, body });
      return typeof answer === 'function' ? answer({ fold, body }) : answer;
    },
    onResolved: (r, data, sentence) => resolved.push({ r, data, sentence }),
  });
  dom.body.appendChild(el);
  return { el, calls, resolved };
}

// ---------------------------------------------------------------------------
// 1. The request shape — what actually reaches the Worker.
// ---------------------------------------------------------------------------

describe('the request shape', () => {
  it('a fold with SPACES is encoded, not interpolated — the six real keys all have them', () => {
    assert.equal(
      resolvePathFor(PENDING_PATH_FALLBACK, 'good girl s guide to murder 2'),
      '/api/series/pending/good%20girl%20s%20guide%20to%20murder%202',
    );
  });

  it('a path handed back by the API that is NOT a plain /api/ path is refused', () => {
    // A URL out of a response is a place a bearer token could be sent somewhere
    // it should not go.
    assert.equal(safePendingPath('https://evil.example/api/series/pending'), PENDING_PATH_FALLBACK);
    assert.equal(safePendingPath('//evil.example/x'), PENDING_PATH_FALLBACK);
    assert.equal(safePendingPath(null), PENDING_PATH_FALLBACK);
    assert.equal(safePendingPath('/api/series/pending'), '/api/series/pending');
  });

  it('“Keep this name” POSTs merge with THAT name’s slug as `into`', async () => {
    const { el, calls } = card();
    await el.button('Keep “A Good Girl’s Guide to Murder” (3 entries)').click();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fold, 'good girl s guide to murder 2');
    assert.deepEqual(calls[0].body, { action: 'merge', into: 'good-girl-s-guide-to-murder' });
  });

  it('🔴 the CANDIDATE side can be the survivor — the case a one-way control gets wrong', async () => {
    // `skyward`: the plain form wins and it is the CANDIDATE, not the closest.
    // A control that could only merge into `closest_slug` would silently make
    // the opposite decision here, and the queue never asks twice.
    const { el, calls } = card({
      candidate_fold: 'skyward',
      candidate_display: 'Skyward',
      candidate_slug: 'skyward',
      candidate_entries: 4,
      closest_slug: 'skyward-series',
      closest_display: 'The Skyward Series',
      closest_entries: 0,
      sources: ['library'],
    });
    await el.button('Keep “Skyward” (4 entries)').click();
    assert.deepEqual(calls[0].body, { action: 'merge', into: 'skyward' });
  });

  it('“they are different series” POSTs separate and names no slug at all', async () => {
    const { el, calls } = card({}, { data: { resolved_as: 'separate', detail: 'they stay two series.' } });
    await el.button('They are different series').click();
    assert.deepEqual(calls[0].body, { action: 'separate' });
    assert.equal('into' in calls[0].body, false, 'separate takes no target — sending one would invent a decision');
  });

  it('the two body builders are the only shapes the route accepts', () => {
    assert.deepEqual(mergeBody('a-slug'), { action: 'merge', into: 'a-slug' });
    assert.deepEqual(separateBody(), { action: 'separate' });
  });
});

// ---------------------------------------------------------------------------
// 2. The render — the evidence beside the choice.
// ---------------------------------------------------------------------------

describe('the render', () => {
  it('both candidates get a control, CLOSEST first, each naming its own survivor', () => {
    const { el } = card();
    const keeps = el.byClass('ser-pending-keep');
    assert.equal(keeps.length, 2);
    assert.deepEqual(keeps.map((b) => b.dataset.slug), [
      'good-girl-s-guide-to-murder',
      'good-girl-s-guide-to-murder-2',
    ]);
  });

  it('🔴 the entry counts are ON the buttons — the evidence for the choice, not a separate line', () => {
    const { el } = card();
    const labels = el.byClass('ser-pending-keep').map((b) => b.textContent);
    assert.ok(labels[0].includes('(3 entries)'), labels[0]);
    assert.ok(labels[1].includes('(0 entries)'), labels[1]);
  });

  it('one entry is “1 entry”, not “1 entries”', () => {
    const { el } = card({ closest_entries: 1 });
    assert.ok(el.byClass('ser-pending-keep')[0].textContent.includes('(1 entry)'));
  });

  it('a row with NO counts still renders buttons — an older Worker must not produce a dead card', () => {
    const { el } = card({ candidate_entries: undefined, closest_entries: undefined });
    const labels = el.byClass('ser-pending-keep').map((b) => b.textContent);
    assert.deepEqual(labels, ['Keep “A Good Girl’s Guide to Murder”', 'Keep “A Good Girl’s Guide to Murder 2”']);
    assert.ok(!labels.join('').includes('undefined'));
    assert.ok(!labels.join('').includes('NaN'));
  });

  it('candidatesFor puts the closest first and keeps 0 as a number, not a blank', () => {
    const c = candidatesFor(row());
    assert.deepEqual(c.map((x) => x.side), ['closest', 'candidate']);
    assert.equal(c[1].entries, 0);
    assert.equal(candidatesFor(row({ closest_entries: 'three' }))[0].entries, null);
  });

  it('sample titles are objects on the wire — a plain join would print [object Object]', () => {
    const { el } = card();
    const meta = el.byClass('ser-pending-meta')[0].textContent;
    assert.ok(meta.includes('Good Girl, Bad Blood'), meta);
    assert.ok(!meta.includes('[object'), meta);
    assert.ok(meta.includes('Samantha’s library'), 'the source is named through the registry, never as a database id');
  });

  it('no button reads “merge left” or otherwise hides which name survives', () => {
    const { el } = card();
    for (const b of el.byTag('button')) {
      assert.ok(!/left|right|first|second/i.test(b.textContent), b.textContent);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Success — the row goes, the count comes down.
// ---------------------------------------------------------------------------

describe('a decision that lands', () => {
  it('removes the row and reports what actually moved', async () => {
    const { el, resolved } = card();
    assert.equal(el.parentElement, dom.body);
    await el.button('Keep “A Good Girl’s Guide to Murder” (3 entries)').click();
    assert.equal(el.parentElement, null, 'the resolved row leaves the queue');
    assert.equal(resolved.length, 1);
    assert.ok(resolved[0].sentence.includes('3 entries now read'), resolved[0].sentence);
  });

  it('🔴 the row is removed only AFTER the write landed, never before', async () => {
    let seen = null;
    const { el } = card({}, async () => {
      seen = el.parentElement; // observed mid-flight
      return { data: { resolved_as: 'merged', rows_repointed: 3 } };
    });
    await el.button('Keep “A Good Girl’s Guide to Murder” (3 entries)').click();
    assert.equal(seen, dom.body, 'a queue shown shorter than it is would be a lie, not optimism');
    assert.equal(el.parentElement, null);
  });

  it('a merge that moved NOTHING says so rather than claiming entries moved', () => {
    const s = resolvedNote({ resolved_as: 'merged', rows_repointed: 0, surviving_display: 'Asphodel' });
    assert.ok(s.includes('0 entries'), s);
    assert.ok(s.includes('only closed the question'), s);
  });

  it('separate reports the Worker’s own sentence, never a merge one', () => {
    const s = resolvedNote({ resolved_as: 'separate', detail: '“A” and “B” stay two series.' });
    assert.ok(s.includes('stay two series'), s);
    assert.ok(!s.toLowerCase().includes('merged'), s);
  });

  it('the card’s count sentence decrements, and says the queue is empty at zero', () => {
    assert.ok(queueSentence(6).startsWith('6 near misses are waiting'));
    assert.ok(queueSentence(1).startsWith('1 near miss is waiting'));
    assert.ok(queueSentence(6).includes('Nothing was merged'), 'a bare count reads as a fault; no fault has occurred');
    assert.equal(queueSentence(0), 'Nothing is waiting any more — every near miss has been decided.');
  });
});

// ---------------------------------------------------------------------------
// 4. Failure — outage and permission kept apart, and never a bare status.
// ---------------------------------------------------------------------------

describe('a decision that is refused', () => {
  it('🔴 an OUTAGE is not dressed as a permissions problem', async () => {
    const { el } = card({}, { error: 'The index did not answer (network). Try again shortly.' });
    await el.button('Keep “A Good Girl’s Guide to Murder” (3 entries)').click();
    const said = el.byClass('ser-pending-meta').map((p) => p.textContent).join(' ');
    assert.ok(said.includes('connection problem, not a permissions one'), said);
    assert.ok(!/approver/i.test(said), 'mislabelling an outage sends people asking for access they already have');
  });

  it('🔴 a PERMISSION refusal names the standing it needs, and never as an outage', () => {
    const s = resolveFailureNote({ status: 403, code: 'approver_only' });
    assert.ok(s.includes('Resolving is for approvers'), s);
    assert.ok(!/try again shortly/i.test(s), 'retrying will never fix standing');
  });

  it('a 409 already_resolved tells the person somebody else decided it', () => {
    const s = resolveFailureNote({ status: 409, code: 'already_resolved' });
    assert.ok(s.includes('already decided'), s);
    assert.ok(s.includes('never asked twice'), s);
  });

  it('🔴 no refusal ever shows a bare HTTP status on its own', () => {
    for (const c of ['approver_only', 'already_resolved', 'unknown_pending', 'invalid_target', 'unknown_series', 'unauthenticated', 'estate_unreachable', null, 'something_new']) {
      const s = resolveFailureNote({ status: 500, code: c });
      assert.ok(s.length > 40, `${c}: ${s}`);
      assert.ok(s.trim().split(/\s+/).length >= 8 && s.trim().endsWith('.'), `${c}: not a sentence — ${s}`);
      // A status MAY appear as a diagnostic inside the sentence (errorNote's
      // own `(${errCode})` idiom) — what it may never do is BE the message.
      assert.ok(!/^\s*\d/.test(s), `${c}: a bare status reached a person — ${s}`);
      assert.ok(s.startsWith('Nothing was decided') || s.startsWith('Somebody already') || s.startsWith('That queue entry') || s.startsWith('The index did not'), `${c}: ${s}`);
    }
  });

  it('the row STAYS and the buttons come back, so a refusal is retryable', async () => {
    const { el, resolved } = card({}, { status: 503, code: 'estate_unreachable' });
    await el.button('Keep “A Good Girl’s Guide to Murder” (3 entries)').click();
    assert.equal(el.parentElement, dom.body, 'a refused decision must not remove the row');
    assert.equal(resolved.length, 0, 'and must not decrement the count');
    assert.deepEqual(el.byTag('button').map((b) => b.disabled), [false, false, false]);
  });

  it('a resolve() that THROWS is still words, and is called an outage', async () => {
    const { el } = card({}, () => {
      throw new Error('boom');
    });
    await el.button('They are different series').click();
    const said = el.byClass('ser-pending-meta').map((p) => p.textContent).join(' ');
    assert.ok(said.includes('connection problem'), said);
    assert.ok(!said.includes('boom'), 'an exception message is not a sentence for a person');
  });

  it('a second click while one is in flight does not double-POST an irreversible write', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const { el, calls } = card({}, async () => {
      await gate;
      return { data: { resolved_as: 'merged', rows_repointed: 3 } };
    });
    const first = el.button('Keep “A Good Girl’s Guide to Murder” (3 entries)').click();
    el.button('Keep “A Good Girl’s Guide to Murder 2” (0 entries)').click();
    release();
    await first;
    assert.equal(calls.length, 1, 'two POSTs would take two decisions on one row');
  });

  it('the non-approver line says what it needs and how, and offers no control', () => {
    assert.ok(NOT_APPROVER_NOTE.includes('approvers'));
    assert.ok(NOT_APPROVER_NOTE.includes('estate owner'), 'a refusal owes the person WHO can act');
    assert.ok(NOT_APPROVER_NOTE.includes('stays visible'), 'and must not read as "you lost access to the page"');
  });
});
