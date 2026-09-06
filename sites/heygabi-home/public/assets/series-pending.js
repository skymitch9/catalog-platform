/**
 * series-pending.js — the confirm queue's ROW, and the decision it can take.
 *
 * ⚠️ WHY THIS IS A MODULE AND NOT MORE OF `series/series.js`. The convention
 * that file states is "one page, one script" — and it holds, for RENDERING a
 * page. This is not that: it is the shape of a WRITE to a persisted key
 * (`series_alias`, `entry.series_slug`, `series_pending.resolved_as`), taken
 * once and kept so the decision is never re-asked. `series.js` cannot be
 * imported in Node — it does top-level `getElementById` and pulls the Firebase
 * SDK off a CDN through `estate-auth.js` — so anything left inside it can only
 * ever be checked by reading the source. The request shape of a merge is not a
 * thing to check by reading.
 *
 * So the rule this file draws: the DECISION lives here and is exercised; the
 * page keeps the wiring (which element, which token, which fetch).
 *
 * ⚠️ IT IMPORTS NOTHING, ON PURPOSE. Every collaborator arrives as an argument
 * — `sourceLabel`, and a `resolve` that performs the POST — so a test drives
 * the real module with a stub DOM and a stub fetch rather than a copy of it.
 *
 * ⚠️ AND IT NEVER DECIDES WHO MAY ACT. `GET /api/series` omits the queue's
 * fields entirely for non-approvers and `GET /api/series/pending` is behind
 * `requireOwnerStanding()`, so reaching a row at all IS the standing. What this
 * file owns is the other half of the same promise: when the Worker refuses, the
 * refusal is shown in words, and a PERMISSION refusal is never dressed as an
 * outage (or the reverse — that is how people go asking for access they have).
 *
 * The endpoint (`apps/index-worker/src/series-route.ts`):
 *
 *   POST /api/series/pending/<candidate_fold>   URL-encoded; spaces are real
 *   {"action":"merge","into":"<the slug that SURVIVES>"}   — `into` must be one
 *                                                            of the row's two
 *   {"action":"separate"}                                  — they stay two
 */

/** The known path, used when the API hands back one that is not a plain API path. */
export const PENDING_PATH_FALLBACK = '/api/series/pending';

/**
 * ⚠️ A URL out of a response is a place a bearer token could be sent somewhere
 * it should not go, so only a same-origin absolute path under /api/ is taken;
 * anything else falls back to the known path rather than being fetched.
 */
export function safePendingPath(url) {
  return typeof url === 'string' && /^\/api\/[A-Za-z0-9/_-]*$/.test(url) ? url : PENDING_PATH_FALLBACK;
}

/**
 * The fold is the key and it CONTAINS SPACES ("good girl s guide to murder 2"),
 * so it is encoded rather than interpolated. Getting this wrong is a 404 that
 * reads like a missing row.
 */
export function resolvePathFor(basePath, fold) {
  return `${safePendingPath(basePath)}/${encodeURIComponent(String(fold))}`;
}

/** The merge body. `into` is the slug that SURVIVES; the other one is absorbed. */
export function mergeBody(intoSlug) {
  return { action: 'merge', into: String(intoSlug) };
}

/** The other legitimate answer, and equally sticky: the two are genuinely different. */
export function separateBody() {
  return { action: 'separate' };
}

/**
 * The two sides of a near miss, in the order a reader should weigh them:
 * the CLOSEST (the series that already existed) first, then the candidate that
 * nearly matched it. `entries` is how many rows each slug actually holds —
 * added to the API for this control, because "3 entries vs 0" is the whole
 * evidence for which spelling should survive, and a button that asks for a
 * decision without showing it is asking somebody to guess.
 */
export function candidatesFor(row) {
  const out = [];
  if (row && row.closest_slug) {
    out.push({
      slug: row.closest_slug,
      display: row.closest_display || row.closest_slug,
      entries: countOrNull(row.closest_entries),
      side: 'closest',
    });
  }
  if (row && row.candidate_slug) {
    out.push({
      slug: row.candidate_slug,
      display: row.candidate_display || row.candidate_slug,
      entries: countOrNull(row.candidate_entries),
      side: 'candidate',
    });
  }
  return out;
}

function countOrNull(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * The card's own count sentence, recomputed after every resolve so the header
 * decrements instead of standing at the number the page loaded with.
 *
 * ⚠️ It says what the Worker's `pending_detail` says — nothing was merged, the
 * series stay separate — because a bare number on a coloured card reads as a
 * fault, and no fault has occurred.
 */
export function queueSentence(open) {
  const n = Number(open) || 0;
  if (n <= 0) return 'Nothing is waiting any more — every near miss has been decided.';
  return (
    `${n} near ${n === 1 ? 'miss is' : 'misses are'} waiting on a decision. ` +
    'Nothing was merged — these series stay separate until you resolve them.'
  );
}

/** Shown when the queue read itself is refused for standing. Never a bare 403. */
export const NOT_APPROVER_NOTE =
  'Resolving is for approvers. Every series stays visible to you — it is the merge decision that is gated, ' +
  'and the estate owner is the approver on the index.';

/**
 * A refusal, in words, with OUTAGE and PERMISSION kept apart.
 *
 * ⚠️ That separation is the point of the function. Labelling an outage a
 * permission problem sends somebody asking for access they already hold;
 * labelling a permission problem an outage sends them to retry forever.
 * `transport` is set by the caller when the fetch itself never landed — no
 * status, no body, so nothing about standing was learned.
 */
export function resolveFailureNote({ transport, status, code, detail } = {}) {
  if (transport) {
    return (
      'The index did not answer, so nothing was decided — this is a connection problem, not a permissions one. ' +
      'The queue is unchanged; try again shortly.'
    );
  }
  switch (code) {
    case 'approver_only':
      return `Nothing was decided. ${NOT_APPROVER_NOTE}`;
    case 'already_resolved':
      return (
        'Somebody already decided this one, so nothing changed. Reload the page for the current queue — ' +
        'a decision is kept on purpose, so it is never asked twice.'
      );
    case 'unknown_pending':
      return 'That queue entry is no longer there — it was decided or removed since this page loaded. Reload for the current queue.';
    case 'invalid_target':
      return 'Nothing was decided: a merge can only join these two spellings, never a third series.';
    case 'unknown_series':
      return 'Nothing was decided: that spelling is no longer in the registry. Reload for the current queue.';
    case 'unauthenticated':
      return 'Nothing was decided — the index did not accept the sign-in. Sign out and back in, then try again.';
    case 'estate_unreachable':
      return (
        'Nothing was decided: the estate directory did not answer, so your standing could not be checked. ' +
        'This is an outage, not a refusal — try again shortly.'
      );
    default:
      return (
        `Nothing was decided${code ? ` (${code})` : status ? ` (the index answered ${status})` : ''}. ` +
        (detail ? `${detail} ` : '') +
        'The queue is unchanged.'
      );
  }
}

/** The sentence shown in place of a resolved row, so a click is never silent. */
export function resolvedNote(data) {
  if (data && data.resolved_as === 'separate') {
    return typeof data.detail === 'string' && data.detail
      ? data.detail
      : 'Kept as two series. The queue will not ask again.';
  }
  const moved = Number(data && data.rows_repointed) || 0;
  const kept = (data && data.surviving_display) || (data && data.surviving_slug) || 'the surviving spelling';
  return (
    `Merged. ${moved === 1 ? '1 entry now reads' : `${moved} entries now read`} “${kept}”` +
    `${moved === 0 ? ' — the absorbed spelling held none, so this only closed the question' : ''}.`
  );
}

/**
 * One queue row, with its decision.
 *
 * `opts.resolve(fold, body)` performs the POST and answers the page's own
 * `callIndex` shape: `{ data }` on success, `{ error }` when the fetch never
 * landed, `{ status, code }` when the Worker refused. `opts.onResolved(row)`
 * is called once, after a successful decision, so the card can decrement.
 */
export function pendingCard(row, opts = {}) {
  const doc = opts.document || globalThis.document;
  const sourceLabel = opts.sourceLabel || ((s) => String(s));
  const wrap = doc.createElement('div');
  wrap.className = 'ser-pending-row';

  const pair = doc.createElement('p');
  pair.className = 'ser-pending-pair';
  pair.textContent = `“${row.candidate_display}” and “${row.closest_display}”`;
  wrap.appendChild(pair);

  // ⚠️ sample_titles is `{ source, title }[]` on the wire (series.ts NewPending),
  //    NOT an array of strings — a plain join would print "[object Object]".
  const samples = (Array.isArray(row.sample_titles) ? row.sample_titles : [])
    .map((s) => (s && typeof s === 'object' ? s.title : s))
    .filter(Boolean)
    .slice(0, 3);
  const sources = (Array.isArray(row.sources) ? row.sources : []).filter(Boolean);
  const bits = [];
  if (sources.length) bits.push(`on ${joinWords(sources.map((s) => sourceLabel(s)))}`);
  if (samples.length) bits.push(`for example ${joinWords(samples.map((t) => `“${t}”`))}`);
  if (bits.length) wrap.appendChild(note(doc, `${bits.join(', ')}.`, 'ser-pending-meta'));

  const status = note(doc, '', 'ser-pending-meta');
  status.setAttribute('role', 'status');
  status.hidden = true;

  const actions = doc.createElement('p');
  actions.className = 'ser-pending-actions';
  const buttons = [];

  for (const cand of candidatesFor(row)) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'find-linkbtn ser-pending-keep';
    btn.dataset.slug = cand.slug;
    btn.textContent =
      cand.entries === null
        ? `Keep “${cand.display}”`
        : `Keep “${cand.display}” (${cand.entries === 1 ? '1 entry' : `${cand.entries} entries`})`;
    // ⚠️ The label names the SURVIVOR, never "merge left"/"merge right": the
    // API's own `into` is the surviving slug, so the words and the wire agree.
    btn.setAttribute(
      'aria-label',
      `Keep “${cand.display}” and fold the other spelling into it`,
    );
    btn.addEventListener('click', () => act(mergeBody(cand.slug)));
    buttons.push(btn);
    actions.appendChild(btn);
  }

  const sep = doc.createElement('button');
  sep.type = 'button';
  sep.className = 'find-linkbtn ser-pending-separate';
  sep.textContent = 'They are different series';
  sep.setAttribute('aria-label', 'Keep both spellings — they are genuinely different series');
  sep.addEventListener('click', () => act(separateBody()));
  buttons.push(sep);
  actions.appendChild(sep);

  wrap.appendChild(actions);
  wrap.appendChild(status);

  let inFlight = false;

  async function act(body) {
    if (inFlight) return;
    inFlight = true;
    for (const b of buttons) b.disabled = true;
    status.hidden = false;
    status.textContent = body.action === 'separate' ? 'Recording the decision…' : 'Merging…';

    let r;
    try {
      r = await opts.resolve(row.candidate_fold, body);
    } catch (e) {
      // A resolve() that THROWS is this page's own bug, not a refusal — but the
      // person still gets words, and the row still stands.
      r = { error: 'transport' };
    }

    if (r && r.data) {
      // ⚠️ The row goes ONLY on a success answer. "Optimistic" here means the
      // page does not re-fetch the queue to believe the Worker — it does not
      // mean removing a row before the write landed, which would show a queue
      // that is shorter than it is.
      inFlight = false;
      const sentence = resolvedNote(r.data);
      wrap.remove();
      if (typeof opts.onResolved === 'function') opts.onResolved(row, r.data, sentence);
      return;
    }

    inFlight = false;
    for (const b of buttons) b.disabled = false;
    status.textContent = r && r.error
      ? resolveFailureNote({ transport: true })
      : resolveFailureNote({ status: r && r.status, code: r && r.code });
  }

  return wrap;
}

function note(doc, text, className) {
  const p = doc.createElement('p');
  p.className = className || 'ser-note';
  p.textContent = text;
  return p;
}

function joinWords(parts) {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
