/**
 * status.js — /status, the HEALTH page (owner ask 2026-08-14: "I want to see
 * all the pipelines"; reshaped 2026-08-18 into the four-page split described
 * in docs/info/status-pages.md).
 *
 * Reads public health/reachability surfaces and renders a quiet red/amber/
 * green view. Every endpoint it touches answers signed-out by design, and
 * every payload is counts and timestamps only.
 *
 * Sections, each independent so one dead host cannot blank the others:
 *   1. Deployed versions — each Worker's own /api/health `version`, which is
 *      the build actually running. ⚠️ NOT docs/deploys.log: that file stays in
 *      the repo, unpublished, because a deploy history with holder names and a
 *      rollback trail does not belong on a public host to save one fetch.
 *   2. Shared index  — one GET to index.heygabi.ai/api/health, three rows
 *      (audiobook/library/games) read out of its `sources` object.
 *   3. Book pipeline — the audiobook sync pipeline's OWN two records:
 *      `pipeline_status/current` (public-read by firestore.rules, read here
 *      over the plain REST API) and the ebook-lane heartbeat published by
 *      sync step 1b. Both existed before this page did — nothing here is
 *      invented, only read.
 *   4. Workers       — index (reusing #2's fetch), library, games, Sam's
 *      library and estate-auth /api/health.
 *   5. Sites         — a no-cors reachability probe of the site roots plus
 *      the audiobook site's /dev/ lane.
 *   6. Backups       — devops-gated, from GET /api/estate/backups.
 *
 * ⚠️ WHAT LEFT THIS FILE ON 2026-08-18, and where it went, because a reader
 * looking for it here is the likeliest next visitor: the ingestion pause card,
 * the Run button, the eight pipeline steps, the Run levers and the
 * shelf-server force-upload ALL moved to `/status/pipelines/pipelines.js`,
 * intact. The shared helpers they used moved to `lib/core.js`, and the devops
 * gate to `lib/gate.js`, so the four pages share one implementation of each
 * rather than four that can drift.
 *
 * ⚠️ Reachability, not status codes: none of the sites this page HEADs send
 * Access-Control-Allow-Origin, so a normal cross-origin fetch would reject
 * before a status code was visible. See probeReachable() in lib/core.js.
 *
 * ⚠️ Envelope normalization: all /api/health endpoints answer
 * `{ ok, service, version?, time, detail }` with `detail` holding that
 * worker's pre-existing fields verbatim. detailOf() prefers the nesting and
 * falls back to the flat body, so this page works against a worker that has
 * not redeployed yet and against one that later drops the duplicates.
 */

import {
  AUDIO_ORIGIN,
  AUTH_ORIGIN,
  GAMES_ORIGIN,
  INDEX_ORIGIN,
  LIBRARY2_ORIGIN,
  LIBRARY_ORIGIN,
  REFRESH_INTERVAL_MS,
  TICK_INTERVAL_MS,
  detailOf,
  el,
  fetchJSON,
  formatAge,
  fsMap,
  makeRow,
  probeReachable,
  rowRegistry,
  setRowLog,
  setRowName,
  tickAll,
  updateRow,
} from './lib/core.js';
// The ebook lane's verdict — pure, and pinned by scripts/test/ebook-lane.test.mjs.
// EBOOK_PRODUCING_TRIGGERS and ebookRunKind moved there with it on 2026-08-18.
import { ebookLaneVerdict } from './lib/ebook-lane.js';
// The blob-storage panel (owner ask 2026-08-18). PUSHED, not probed — see the
// section comment in index.html for why a Worker route was rejected.
import { BOARD_POLL_MS, fetchBoard, objectSection, renderFreshness, str } from './lib/board.js';
import { backupLastWriteText, describeArchive, describeBucket, describeTotals } from './lib/storage-view.js';
import { mountGate } from './lib/gate.js';
import { idToken } from '../assets/estate-auth.js';

/**
 * The audiobook pipeline's own status doc, read straight over the Firestore
 * REST API — public because firestore.rules sets `allow read: if true` on
 * `pipeline_status/current` deliberately ("nobody can forge a run" is the
 * write-side control; the read side was already open for the admin panel).
 * No API key, no SDK: a plain signed-out GET returns the same document the
 * admin panel's onSnapshot() gets, just typed-JSON instead of decoded.
 */
const FIRESTORE_STATUS_URL =
  'https://firestore.googleapis.com/v1/projects/audiobook-catalog/databases/(default)/documents/pipeline_status/current';
/** The ebook-lane FRESHNESS HEARTBEAT — `{generated_at, count,
 *  needs_human_cover_count}`, written by the pipeline's publish step.
 *
 *  ⚠️ CHANGED 2026-08-17: this used to read `ebooks.json` itself. That file is
 *  now GATED (owner directive: "I don't want people scraping my books") —
 *  gitignored, stripped from both deploy lanes, and served only through
 *  audiobook-api.heygabi.ai behind the estate's `ebooks` grant. This page asks
 *  one operational question — *did sync step 1b run?* — and handing it a
 *  bearer and the whole shelf to read one timestamp would be badly
 *  over-privileged. So the pipeline publishes the timestamp instead:
 *  `ebooks_status.json`, counts and times only, no book ever named.
 *  Runbook: catalog-platform/docs/access/ebooks-gate.md.
 *
 *  ⚠️ TWO copies still matter and still mean different things: the /dev/ lane
 *  is written by EVERY pipeline run with no human in the loop (so it is the
 *  honest signal for lane health), while the prod copy only moves when
 *  someone promotes (so its age measures promote cadence, not health).
 *
 *  ⚠️ The prod copy will 'miss' until the ebook-gate work is PROMOTED — the
 *  file is new on main. A missing heartbeat reads as unknown, not as a stall. */
const EBOOKS_MANIFEST_DEV_URL = `${AUDIO_ORIGIN}/dev/ebooks_status.json`;
const EBOOKS_MANIFEST_PROD_URL = `${AUDIO_ORIGIN}/ebooks_status.json`;
/**
 * Per-source staleness thresholds for the shared index (design:
 * catalog-platform/docs/info/index-worker-design.md §5, §7 step 4).
 *
 * `audiobook` is OWNER-SPECIFIED, not a guess: the pipeline pushes on an 8h
 * cadence and its index push IS that pipeline's heartbeat, so amber/red are
 * "8h cadence + slack" exactly as asked.
 *
 * `library` and `games` are GUESSES, marked as such deliberately. Both push
 * on every catalog-mutating write PLUS a staleness backstop that rides
 * ordinary /api/* request traffic (at most once per isolate-hour, re-pushing
 * only past 24h stale — see library_catalog and Board_Game_Catalog
 * apps/worker/src/lib/index-push.ts). Neither catalog has a cron backing
 * this any more (the games cron backstop was retired 2026-08-13 for being
 * unobservable). That means an untouched app's index row can age
 * indefinitely without anything being wrong — nobody opened the app, so
 * nothing pushed, because nothing changed either. These thresholds are
 * therefore "worth a glance," not "certainly broken": chosen as the 24h
 * backstop ceiling plus slack for the hourly check granularity (amber), and
 * two full backstop cycles (red) — round numbers, not measurements.
 */
const INDEX_THRESHOLDS = {
  audiobook: {
    label: 'Audiobook catalog → shared search index',
    amberMs: 9 * 3600_000,
    redMs: 17 * 3600_000,
    note: 'See the Book pipeline section below for the pipeline’s own run status — this row is only its index push, a downstream effect of a successful run, not the run itself.',
    guess: false,
  },
  library: {
    label: 'Book library → shared search index',
    amberMs: 26 * 3600_000,
    redMs: 48 * 3600_000,
    note: 'GUESS — pushes on edit + a 24h backstop riding request traffic, no cron. A long age can mean "quiet," not "broken."',
    guess: true,
  },
  game: {
    label: 'Board games → shared search index',
    amberMs: 26 * 3600_000,
    redMs: 48 * 3600_000,
    note: 'GUESS — same push design as library (on-edit + a 24h traffic-riding backstop). Same caveat: quiet ≠ broken.',
    guess: true,
  },
};
/** Display order — matches the front door's Audio / Books / Games cards. */
const INDEX_SOURCE_ORDER = ['audiobook', 'library', 'game'];
function buildIndexSection() {
  const ul = document.getElementById('index-rows');
  for (const key of INDEX_SOURCE_ORDER) {
    ul.appendChild(makeRow(`idx-${key}`, INDEX_THRESHOLDS[key].label));
  }
}

/** 8h Task Scheduler cadence (00:00/08:00/16:00 local) — same amber/red
 *  thresholds INDEX_THRESHOLDS.audiobook already used for the index push,
 *  now applied to the pipeline's own timestamps instead of a downstream one. */
const PIPELINE_AMBER_MS = 9 * 3600_000;
const PIPELINE_RED_MS = 17 * 3600_000;
const PIPELINE_CADENCE_MS = 8 * 3600_000;
/** Mirrors site/pipeline-status.js isStale() — a "running" doc whose
 *  heartbeat stopped updating probably means the process died, not that a
 *  15-minute step is in progress. */
const PIPELINE_STALE_RUNNING_MS = 15 * 60_000;

/**
 * ⚠️ ROW NAMES SAY WHAT / ON WHAT / HOW OFTEN — owner instruction 2026-08-18:
 * "lets also rename all the jobs/checks/workers/etc to be a bit more
 * descriptive." "Ebook lane" and "Drive ⇄ role parity" are what the people who
 * built them call them; neither tells a reader coming to this page cold what
 * runs, on what, or how often. The cadence belongs in the NAME here because
 * these three rows are the only ones on the page whose freshness is judged
 * against a schedule — a reader needs to know the schedule to read the colour.
 */
function buildPipelineSection() {
  const ul = document.getElementById('pipeline-rows');
  ul.appendChild(makeRow('pipe-audio', 'Audiobook sync pipeline (home PC, every 8h)'));
  ul.appendChild(makeRow('pipe-ebook', 'Ebook shelf manifest (published by that pipeline)'));
  ul.appendChild(makeRow('pipe-parity', 'Google Drive sharing vs estate roles (checked every run)'));
}

function buildWorkerSection() {
  const ul = document.getElementById('worker-rows');
  ul.appendChild(makeRow('wk-index', 'Shared search index — index.heygabi.ai'));
  ul.appendChild(makeRow('wk-library', 'Book library API — library.heygabi.ai'));
  ul.appendChild(makeRow('wk-games', 'Board game catalog API — boardgames.heygabi.ai'));
  ul.appendChild(makeRow('wk-library2', "Sam's book library API — padhard.heygabi.ai"));
  ul.appendChild(makeRow('wk-auth', 'Sign-in & membership directory — auth.heygabi.ai'));
}

function buildSiteSection() {
  const ul = document.getElementById('site-rows');
  ul.appendChild(makeRow('site-audio', 'Audiobook site — audiobooks.heygabi.ai'));
  ul.appendChild(makeRow('site-audio-dev', 'Audiobook site, /dev/ preview lane'));
  ul.appendChild(makeRow('site-library', 'Book library site — library.heygabi.ai'));
  ul.appendChild(makeRow('site-games', 'Board game site — boardgames.heygabi.ai'));
  ul.appendChild(makeRow('site-library2', "Sam's book library site — padhard.heygabi.ai"));
}


// ---------------------------------------------------------------------------
// Deployed versions (2026-08-18, the split's Health page).
//
// The blueprint asked for "last deploy per worker from deploys.log". ⚠️ IT IS
// NOT deploys.log, deliberately, and the difference is worth stating rather
// than quietly substituting: docs/deploys.log records WHO deployed WHAT and
// WHEN and is the 3am rollback source of truth — it also names holders and
// carries the estate's whole deploy history, and this repo's site is public.
// Publishing it to save one fetch would be a poor trade.
//
// What IS both public and authoritative is the `version` each Worker reports
// on its own /api/health: the build actually executing right now, read from
// the thing executing it. That is a STRONGER fact than a log line for the one
// question this page asks ("is the thing I shipped the thing that is live?"),
// and a weaker one for "when did it ship" — so the row says the version and
// the section note says which of the two you are reading.
//
// No extra fetches: every health body here was already fetched by refreshAll()
// for the Workers section.
// ---------------------------------------------------------------------------

const DEPLOY_ROWS = [
  { id: 'dep-index', name: 'Shared search index (index-worker)' },
  { id: 'dep-library', name: 'Book library (library_catalog worker)' },
  { id: 'dep-games', name: 'Board games (Board_Game_Catalog worker)' },
  { id: 'dep-library2', name: "Sam's library (library-catalog-friend)" },
  { id: 'dep-auth', name: 'Sign-in & membership (auth-worker)' },
];

function buildDeploySection() {
  const ul = document.getElementById('deploy-rows');
  if (!ul) return;
  for (const row of DEPLOY_ROWS) ul.appendChild(makeRow(row.id, row.name));
}

/**
 * One health result → one deploy row.
 *
 * ⚠️ A MISSING `version` IS AMBER, NOT GREEN. A Worker that answers healthily
 * while declining to say what it is running has told us nothing about the one
 * thing this section exists for, and rendering that as OK would be the row
 * asserting a fact it does not have.
 */
function renderDeployRow(id, result, now) {
  if (!rowRegistry.has(id)) return;
  if (!result.reached || !result.httpOk) {
    updateRow(id, 'danger', `Did not answer (${result.error || `HTTP ${result.status}`}) — running version unknown.`, null, now);
    return;
  }
  const body = detailOf(result.body) || {};
  const version = body.version || (result.body && result.body.version);
  const stamp = (result.body && result.body.time) || body.time;
  const when = stamp && Number.isFinite(Date.parse(stamp)) ? ` · answered ${formatAge(now - Date.parse(stamp))}` : '';
  if (!version) {
    updateRow(
      id,
      'warn',
      `Healthy, but reports no version${when}.`,
      'This Worker’s /api/health does not carry a `version` field, so what is live here cannot be named from the outside.',
      now,
    );
    return;
  }
  updateRow(id, 'ok', `Running v${version}${when}.`, null, now);
}

function renderDeployRows(health, now) {
  renderDeployRow('dep-index', health.indexHealth, now);
  renderDeployRow('dep-library', health.libraryHealth, now);
  renderDeployRow('dep-games', health.gamesHealth, now);
  renderDeployRow('dep-library2', health.library2Health, now);
  renderDeployRow('dep-auth', health.authHealth, now);
}
// ---------------------------------------------------------------------------
// Refresh — one pass touches all three sections, independently per row
// ---------------------------------------------------------------------------

function renderIndexSection(fetchResult, now) {
  const detail = fetchResult.body ? detailOf(fetchResult.body) : null;
  if (!fetchResult.reached || !fetchResult.httpOk || !detail || !detail.sources) {
    for (const key of INDEX_SOURCE_ORDER) {
      updateRow(`idx-${key}`, 'danger', `index.heygabi.ai did not answer (${fetchResult.error || `HTTP ${fetchResult.status}`}).`, null, now);
    }
    return;
  }
  const sources = detail.sources;
  for (const key of INDEX_SOURCE_ORDER) {
    const cfg = INDEX_THRESHOLDS[key];
    const src = sources[key];

    // ⚠️ THREE DIFFERENT FACTS USED TO SHARE ONE SENTENCE ("0 rows / never
    // pushed"), and one of them was not even true. `!src.rows` is falsy for a
    // GENUINE zero AND for a missing field, so a source the index worker simply
    // did not report was announced as having zero rows — a measurement invented
    // out of an absence. The estate's rule is that a measurement's absence is
    // not a zero, and these are four states with four different fixes.
    if (!src) {
      updateRow(`idx-${key}`, 'danger', `The index worker did not list a “${key}” source at all.`,
        'It reports one entry per catalog it indexes, so a missing entry means the worker no longer knows ' +
        `about this source — not that the source is empty. ${cfg.note}`, now);
      continue;
    }
    if (typeof src.rows !== 'number') {
      // Grey: we were told about the source and not told its size. Unknown.
      updateRow(`idx-${key}`, 'nodata', `${cfg.label}: the index worker reported no row count — unknown, not zero.`, cfg.note, now);
      continue;
    }
    if (!src.pushed_at) {
      updateRow(`idx-${key}`, 'danger', `${cfg.label}: ${src.rows.toLocaleString()} rows, but no push has ever been recorded.`,
        `A source with rows and no push timestamp means the index has content nobody can date. ${cfg.note}`, now);
      continue;
    }
    if (src.rows === 0) {
      // The one place a zero IS a verdict, and it is documented upstream:
      // "zero rows from a source means the push failed, never that the
      // collection is empty" — index-worker-design.md §1.
      updateRow(`idx-${key}`, 'danger', `${cfg.label}: 0 rows.`,
        `Zero rows from a source means the push failed, never that the catalog is empty ` +
        `(index-worker-design.md §1). ${cfg.note}`, now);
      continue;
    }

    const rowsText = src.rows.toLocaleString();
    const pushedMs = Date.parse(src.pushed_at);
    if (!Number.isFinite(pushedMs)) {
      // ⚠️ Same trap as the pipeline row: NaN loses every threshold comparison
      // below, so an unreadable timestamp would fall through to GREEN. Green
      // must be a finding, not what is left when nothing else matched.
      updateRow(`idx-${key}`, 'nodata', `${cfg.label}: ${rowsText} rows · push timestamp is unreadable ("${src.pushed_at}").`,
        `The rows are real; how fresh they are cannot be said from this answer. ${cfg.note}`, now);
      continue;
    }
    const ageMs = now - pushedMs;

    // ⚠️ A QUIET CATALOG IS NOT A BROKEN ONE, and until 2026-08-18 these rows
    // said otherwise. `library` and `game` have NO cron behind them: they push
    // on every catalog-mutating write plus a 24h backstop that rides ordinary
    // request traffic. So an app nobody opened and nobody edited pushes
    // nothing, correctly, and the row aged into amber and then red for a
    // system doing exactly the right thing. The note said "quiet ≠ broken"
    // while the dot said otherwise — a row whose colour contradicts its own
    // note is worse than no row.
    //
    // Same rule as the ebook lane one section down (owner, 2026-08-18): no
    // change is not a bug unless a change was trying to come through. The age
    // is still printed, and past the backstop ceiling the row SAYS it has been
    // quiet — it just does not raise an alarm it cannot justify.
    if (cfg.guess) {
      const quiet = ageMs > cfg.amberMs
        ? ` Quiet for ${formatAge(ageMs)} — expected when nobody has opened or edited this catalog, since ` +
          'there is no cron behind its index push. This row cannot tell quiet from broken, so it does not ' +
          'pretend to: green here means "the last push succeeded", not "a push happened recently."'
        : '';
      updateRow(`idx-${key}`, 'ok', `${rowsText} rows · pushed ${formatAge(ageMs)}`, cfg.note + quiet, now);
      continue;
    }

    // `audiobook` DOES have a cadence — the 8h pipeline pushes the index on
    // every run, including runs that upload nothing (measured 2026-08-18: a
    // 0-upload run still published "index 1246 rows"). A missed window here is
    // therefore a real miss, and the owner specified these thresholds.
    const state = ageMs > cfg.redMs ? 'danger' : ageMs > cfg.amberMs ? 'warn' : 'ok';
    updateRow(`idx-${key}`, state, `${rowsText} rows · pushed ${formatAge(ageMs)}`, cfg.note, now);
  }
}

function renderIndexWorkerRow(fetchResult, now) {
  if (!fetchResult.reached || !fetchResult.httpOk || !fetchResult.body) {
    updateRow('wk-index', 'danger', `Did not answer (${fetchResult.error || `HTTP ${fetchResult.status}`}).`, null, now);
    return;
  }
  const sources = detailOf(fetchResult.body).sources || {};
  // ⚠️ "3 sources" USED TO BE A CONSTANT IN THE SENTENCE while the total was
  // summed over whatever happened to be there — so a source that vanished from
  // the worker's answer silently contributed 0 rows to a total still described
  // as covering three. The count now comes from the same object the total does,
  // and a shortfall is NAMED rather than absorbed.
  const present = INDEX_SOURCE_ORDER.filter((k) => sources[k] && typeof sources[k].rows === 'number');
  const missing = INDEX_SOURCE_ORDER.filter((k) => !present.includes(k));
  const total = present.reduce((sum, k) => sum + sources[k].rows, 0);
  const ok = fetchResult.body.ok !== false;
  const counted = `${total.toLocaleString()} rows across ${present.length} of ${INDEX_SOURCE_ORDER.length} sources`;
  updateRow(
    'wk-index',
    !ok || missing.length ? 'danger' : 'ok',
    missing.length
      ? `Reachable · ${counted} — no row count for ${missing.join(', ')}.`
      : `Reachable · ${counted}.`,
    missing.length
      ? 'The total below is only what was reported. A source the worker did not count is unknown, not zero — ' +
        'see its own row above for what that means.'
      : null,
    now,
  );
}

function renderWorkerHealthRow(id, name, fetchResult, now, detailFn) {
  if (!fetchResult.reached) {
    updateRow(id, 'danger', `${name} did not answer (${fetchResult.error}).`, null, now);
    return;
  }
  if (!fetchResult.body) {
    updateRow(id, 'danger', `${name} answered HTTP ${fetchResult.status} with no readable body.`, null, now);
    return;
  }
  // `ok` is deliberately read off the raw body, not detailOf(): every worker
  // keeps `ok` at the top level in both the envelope and the legacy shape,
  // and the envelope's `ok` is the one meant to win once fallback fields
  // are eventually dropped.
  const ok = fetchResult.body.ok === true;
  updateRow(id, ok ? 'ok' : 'danger', detailFn(detailOf(fetchResult.body)), null, now);
}

/**
 * Audiobook pipeline row — reads pipeline_status/current straight, no
 * inference. The page cannot see Task Scheduler's NEXT run (it is a local
 * job on the home machine, not a public endpoint), so this shows the last
 * recorded run plus a cadence-based estimate, clearly labeled as such.
 */
function renderPipelineAudioRow(fetchResult, now) {
  if (!fetchResult.reached) {
    updateRow('pipe-audio', 'danger', `Did not answer (${fetchResult.error}).`,
      'firestore.googleapis.com unreachable — cannot read the pipeline heartbeat.', now);
    return;
  }
  if (fetchResult.status === 404) {
    // Grey, not amber (2026-08-18): "no run has ever been recorded" is an
    // absence of information, not a run that tried something and failed. The
    // owner's rule reserves amber for the latter.
    updateRow('pipe-audio', 'nodata', 'No runs recorded yet.',
      'pipeline_status/current has never been written — either a fresh clone or the home machine has no service-account credentials configured. ' +
      'This says nothing about whether the pipeline is running; it says this page has never been told.', now);
    return;
  }
  if (!fetchResult.httpOk || !fetchResult.body || !fetchResult.body.fields) {
    updateRow('pipe-audio', 'danger', `Firestore answered HTTP ${fetchResult.status} with no readable status doc.`, null, now);
    return;
  }

  const status = fsMap(fetchResult.body.fields);
  const startedAt = Date.parse(status.startedAt || '');
  const updatedAt = Date.parse(status.updatedAt || '');
  const finishedAt = Date.parse(status.finishedAt || '');
  const stale = status.state === 'running' && Number.isFinite(updatedAt)
    && (now - updatedAt) > PIPELINE_STALE_RUNNING_MS;

  if (status.state === 'running' && !stale) {
    const step = status.stepLabel ? ` · ${status.stepLabel}` : '';
    updateRow('pipe-audio', 'ok', `RUNNING${step} · started ${formatAge(now - startedAt)}`,
      '8h Task Scheduler cadence (00/08/16 local) — mid-run, so the freshness check below does not apply yet.', now);
    return;
  }

  // Finished (success/partial/failed) or a stale "running" doc with a dead
  // heartbeat — either way, age it against the same cadence as the index row.
  const anchor = Number.isFinite(finishedAt) ? finishedAt : updatedAt;
  const ageMs = now - anchor;
  const outcome = stale ? 'NO HEARTBEAT' : (status.state || 'unknown').toUpperCase();
  let state = ageMs > PIPELINE_RED_MS ? 'danger' : ageMs > PIPELINE_AMBER_MS ? 'warn' : 'ok';
  if (stale || status.state === 'failed') state = 'danger';
  // 'partial' IS the owner's amber: a run that tried and could not finish.
  else if (status.state === 'partial' && state === 'ok') state = 'warn';
  // ⚠️ TWO WAYS THIS ROW COULD GO GREEN ON NOTHING (2026-08-18). A doc with no
  // `state`, and a doc whose timestamps do not parse, both fell through every
  // branch above and landed on the age comparison — which is false for NaN, so
  // the row reported OK while knowing neither what the run did nor when. Green
  // must be a finding, not a default.
  else if (!status.state || !Number.isFinite(ageMs)) state = 'nodata';

  const summary = status.summary || {};
  const bits = [];
  if (summary.idle) bits.push('nothing new to upload');
  if (summary.uploaded) bits.push(`${summary.uploaded} uploaded`);
  if (summary.books) bits.push(`${summary.books} books`);
  const summaryText = bits.length ? ` · ${bits.join(' · ')}` : '';

  let nextText = '';
  if (Number.isFinite(anchor)) {
    const dueAt = anchor + PIPELINE_CADENCE_MS;
    const clock = new Date(dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    nextText = dueAt > now
      ? ` Next run expected ~${clock} (cadence estimate only — this page cannot see Task Scheduler).`
      : ` Next run is overdue by this cadence estimate — Task Scheduler itself is not visible to this page, so confirm on the machine before assuming a miss.`;
  }

  updateRow(
    'pipe-audio', state,
    `${outcome} · ${formatAge(ageMs)}${summaryText}`,
    `${stale ? 'No heartbeat for over 15 minutes on a run marked running — it may have been interrupted. ' : ''}` +
      `Amber past 9h, red past 17h since last finish, same thresholds as the index row above.${nextText}`,
    now,
  );
}

/**
 * Ebook lane row — HISTORY, kept because it is the most expensive lesson on
 * this page. The logic itself moved to `lib/ebook-lane.js` on 2026-08-18 with
 * the FOURTH fix, so that it could finally be TESTED
 * (`scripts/test/ebook-lane.test.mjs`) instead of argued about a fourth time.
 *
 * ⚠️ REWRITTEN 2026-08-16 (owner: "i want it to be green if things are good
 * or ill never trust the colors"). The old logic aged
 * `ebooks.json:generated_at` against WALL CLOCK with the same 9h/17h
 * thresholds as the pipeline row, and went amber/red while everything was
 * perfectly healthy. Two measured reasons it was structurally wrong:
 *
 *   1. `scripts/build_ebook_manifest.py` rewrites `generated_at` on EVERY
 *      run unconditionally (line ~185, `datetime.now(timezone.utc)`), so the
 *      stamp says "when the pipeline last ran", never "how fresh the ebook
 *      data is". Ageing it measures cadence, not health.
 *   2. The PROD copy only changes when someone PROMOTES. So on prod the age
 *      was really "time since last promote" — a manual, irregular act. A row
 *      that goes red because nobody promoted overnight trains you to ignore
 *      red, which is exactly what the owner said.
 *
 * So the row now asks the only question that means anything: **did the
 * ebook step keep up with the pipeline's own last run?** The `/dev/` lane is
 * the honest source for that — the pipeline commits there every run with no
 * human in the loop. Green = the lane produced a manifest for the most
 * recent run. Amber = the pipeline ran and the ebook step did NOT produce
 * (a real fault). Prod lag is reported as a NOTE, never as a colour, because
 * "not promoted yet" is a normal state, not a failure.
 */
/**
 * Which run shapes actually REBUILD site/ebooks.json — the second false-yellow
 * fix on this row, 2026-08-16 ("I thought we fixed the ebook yellow status?").
 *
 * The first fix replaced wall-clock freshness (which only ever measured how
 * long ago someone promoted) with "did the manifest keep up with the
 * pipeline's own last run". Correct as far as it went, and it carried an
 * assumption that is simply false: that EVERY pipeline run produces a
 * manifest. It does not, and audiobook_catalog says so explicitly —
 * scripts/sync_to_drive.py's rebuild-only block lists "STEP 1b (ebook
 * manifest)" among the steps EXCLUDED by design, because the whole point of
 * --rebuild-only is to skip the sort/detect/upload path a manifest comes
 * from.
 *
 * So a rebuild-only run (a tag fix republished, 22 seconds long) left the
 * manifest legitimately 18 minutes OLDER than the run that followed it, and
 * the row painted amber for a pipeline that had done exactly the right
 * thing. Judging a manifest against a run that was never going to write one
 * is a category error, not a measurement.
 *
 * Producers are whitelisted rather than non-producers blacklisted, and an
 * unrecognised trigger returns null = "do not judge": a NEW run shape added
 * upstream should fail toward saying nothing, never toward inventing a third
 * false amber. The cost of that choice is a genuinely stale manifest going
 * uncoloured after an unknown trigger — the age is still printed in the row,
 * and a false alarm on this row has now cost more than a missed one.
 *
 * ⚠️ Trigger strings are the contract, and they live in audiobook_catalog:
 * scripts/sync_pipeline_8h.bat sets PIPELINE_TRIGGER=scheduled, the remote
 * watcher (app/tools/pipeline_watcher.py) uses "manual", the CLI defaults to
 * "manual"/"cli", --rebuild-only uses "manual-rebuild", and a single-step run
 * uses "manual-step:<key>" over the seven keys in PIPELINE_STEP_CHOICES —
 * none of which is an ebook step, because step 1b has no fine-grained control.
 * A rename there silently degrades this row to "do not judge"; it cannot
 * produce a wrong colour.
 *
 * The durable fix is for the pipeline to RECORD whether step 1b ran (an
 * `ebookManifestAt` field on pipeline_status/current) so this becomes a read
 * rather than an inference — filed on the audiobook TODO, deliberately not
 * done here, since it changes pipeline code and the standing order is that
 * the pipeline is not touched without asking.
 */
/**
 * ⚠️ FOURTH FIX, 2026-08-18, AND THE FIRST ONE THAT IS TESTED. The verdict now
 * lives in `lib/ebook-lane.js` as a PURE function pinned by
 * `scripts/test/ebook-lane.test.mjs` against the exact live payload that
 * produced the false amber. This function is the DOM adapter and nothing else —
 * a row that has been wrong three times does not need a fourth argument, it
 * needs a test, and a function that reaches into the DOM cannot have one.
 *
 * ⚠️ THE OWNER’S RULE (docs/TODO.md, "Status-page expansion" item 0): a
 * completed run with ZERO CHANGES NEEDED IS GREEN; amber is only for a change
 * that tried to come through and could not. The three earlier fixes all
 * compared TIMESTAMPS and all came back; this one compares the published shelf
 * COUNT against the count the last run actually built. See ebook-lane.js for
 * the measured mechanism (STEP 5.8 only runs when a run uploads something, so a
 * quiet run leaves the heartbeat legitimately hours older than the build).
 */
function renderPipelineEbookRow(devResult, prodResult, pipelineResult, now) {
  if (!devResult.reached || !devResult.httpOk || !devResult.body) {
    updateRow('pipe-ebook', 'danger', `Did not answer (${devResult.error || `HTTP ${devResult.status}`}).`, null, now);
    return;
  }
  const verdict = ebookLaneVerdict({
    heartbeat: devResult.body,
    pipeStatus: pipelineResult?.body?.fields ? fsMap(pipelineResult.body.fields) : null,
    prodStampMs: prodResult?.body ? Date.parse(prodResult.body.generated_at || '') : NaN,
    now,
    formatAge,
  });
  updateRow('pipe-ebook', verdict.state, verdict.detail, verdict.note, now);
}

/**
 * Drive ⇄ role parity row — audiobook_catalog pipeline STEP 8, added
 * 2026-08-17 (owner: "Wire it… with auto apply").
 *
 * ⚠️ THIS ROW WATCHES A STEP THAT CHANGES PEOPLE'S ACCESS WITH NOBODY
 * WATCHING. Every other row here reports on books, bytes and hosts; this one
 * reports on a job that can remove a person's Google Drive permission. That
 * asymmetry is why it exists at all — an unattended mutation with no dashboard
 * is an unattended mutation nobody would notice going wrong.
 *
 * It is a READ, not an inference — the same lesson the ebook row above learned
 * the hard way over three wrong guesses. The pipeline records its own verdict
 * in `summary.driveParityState` and this row renders it. No trigger strings, no
 * step-state archaeology, nothing this page could be wrong about on its own.
 *
 * ⚠️ COUNTS, NEVER NAMES. The pipeline deliberately puts only numbers in
 * `pipeline_status/current` because that doc is world-readable and this page
 * renders it; the emails stay in the pipeline's local log, which is the audit
 * trail. If a future change starts shipping names here, that is a privacy
 * regression, not a nicer row.
 */
function renderDriveParityRow(fetchResult, now) {
  if (!fetchResult.reached || !fetchResult.httpOk || !fetchResult.body || !fetchResult.body.fields) {
    // Deliberately NOT 'danger': the pipeline row above already reports the
    // unreachable/absent status doc, and two red rows for one outage reads as
    // two outages. Here it is simply an absence of data.
    updateRow('pipe-parity', 'nodata', 'Cannot read the pipeline status doc.',
      'Same source as the pipeline row above — see its state for why.', now);
    return;
  }

  const status = fsMap(fetchResult.body.fields);
  const summary = status.summary || {};
  const state = summary.driveParityState;
  const detail = summary.driveParityDetail || '';

  // Anchor the age on the RUN's own timestamps, which are timezone-aware UTC.
  // `summary.driveParityAt` is the pipeline host's LOCAL wall clock with no
  // offset, so ageing it in a browser in another timezone would be wrong by
  // hours. Summary is rebuilt per run, so parity fields can only ever be from
  // the run this doc describes — the run's anchor is the honest stamp.
  const finishedAt = Date.parse(status.finishedAt || '');
  const updatedAt = Date.parse(status.updatedAt || '');
  const anchor = Number.isFinite(finishedAt) ? finishedAt : updatedAt;
  const age = Number.isFinite(anchor) ? ` · checked ${formatAge(now - anchor)}` : '';

  if (!state) {
    updateRow('pipe-parity', 'nodata', `The last pipeline run reported no parity result${age}.`,
      'STEP 8 records summary.driveParityState on every cycle, including idle ones. ' +
      'A run with no result at all is either older than 2026-08-17 or a run shape that ' +
      'skips STEP 8 by design (--rebuild-only, a single-step run).', now);
    return;
  }

  if (state === 'in-sync') {
    updateRow('pipe-parity', 'ok', `In sync — Drive matches roles${age}.`,
      `Reported: ${detail}. Roles are the source of truth and Drive is downstream; ` +
      'the reverse direction (Drive → role) is reported only and never applied — granting ' +
      'a site role stays a human act in the admin UI.', now);
    return;
  }

  if (state === 'applied') {
    // Green, not amber. Drift found and CORRECTED is the system working: the
    // whole point of auto-apply is that a demotion lands inside its own tick.
    updateRow('pipe-parity', 'ok', `Drift corrected — ${detail}${age}.`,
      'Green because this is the step doing its job: Drive permissions were changed to ' +
      'match the estate roles. Who changed is in the pipeline log on the home machine, ' +
      'deliberately not here — this doc is world-readable, so it carries counts only.', now);
    return;
  }

  if (state === 'fuse-tripped') {
    updateRow('pipe-parity', 'warn',
      `⚠️ FUSE TRIPPED — ${detail}. Nothing was applied.`,
      'Parity wanted to change more people in one tick than the cap allows, so it applied ' +
      'NOTHING and stopped for a human. Real drift is one person at a time; a large plan is ' +
      'usually one bad read of Drive, the estate directory or Firestore — not many ' +
      'coincidences. Review it on the home machine: ' +
      'python scripts/drive_role_parity.py --apply-to-drive (writes nothing).', now);
    return;
  }

  if (state === 'skipped') {
    updateRow('pipe-parity', 'skipped', `Not reconciled this cycle — ${detail}${age}.`,
      'Grey, not red: nothing is wrong with anyone\'s access, the step simply could not run. ' +
      'The usual cause is a missing Drive token on the pipeline machine — run ' +
      'python scripts/drive_auth.py there once. Permissions stand unchanged meanwhile.', now);
    return;
  }

  if (state === 'failed') {
    updateRow('pipe-parity', 'warn', `Parity FAILED — ${detail}${age}.`,
      'Amber, not red: a failed reconciliation changes nothing, so the previous permission ' +
      'state stands, which is the safe direction. The next 8-hourly cycle retries. ' +
      'Persisting for more than a day is worth investigating on the home machine.', now);
    return;
  }

  // Unknown state: say so plainly rather than inventing a colour. The
  // vocabulary lives in audiobook_catalog (_report_parity_summary), and a new
  // word appearing here should read as "this page has not been taught it yet",
  // never as a verdict this page made up.
  updateRow('pipe-parity', 'nodata', `Unrecognised parity state "${state}"${age}.`,
    `Reported detail: ${detail}. The state vocabulary is set by audiobook_catalog's ` +
    'sync_to_drive.py; this page renders what it is given rather than guessing.', now);
}

function renderSiteRow(id, name, reached, now) {
  updateRow(id, reached ? 'ok' : 'danger', reached ? 'Reachable.' : 'Did not answer within 8s.', null, now);
}

let refreshing = false;

async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const btn = document.getElementById('refresh');
  btn.disabled = true;
  btn.classList.add('spinning');

  const now = () => Date.now();

  const [
    indexHealth, libraryHealth, gamesHealth, library2Health, authHealth,
    audioUp, audioDevUp, libraryUp, gamesUp, library2Up,
    pipelineStatus, ebooksDev, ebooksProd,
  ] =
    await Promise.all([
      fetchJSON(`${INDEX_ORIGIN}/api/health`),
      fetchJSON(`${LIBRARY_ORIGIN}/api/health`),
      fetchJSON(`${GAMES_ORIGIN}/api/health`),
      fetchJSON(`${LIBRARY2_ORIGIN}/api/health`),
      fetchJSON(`${AUTH_ORIGIN}/api/health`),
      probeReachable(AUDIO_ORIGIN + '/'),
      probeReachable(AUDIO_ORIGIN + '/dev/'),
      probeReachable(LIBRARY_ORIGIN + '/'),
      probeReachable(GAMES_ORIGIN + '/'),
      probeReachable(LIBRARY2_ORIGIN + '/'),
      fetchJSON(FIRESTORE_STATUS_URL),
      fetchJSON(EBOOKS_MANIFEST_DEV_URL),
      fetchJSON(EBOOKS_MANIFEST_PROD_URL),
    ]);

  const t = now();

  renderIndexSection(indexHealth, t);
  renderIndexWorkerRow(indexHealth, t);
  renderPipelineAudioRow(pipelineStatus, t);
  renderPipelineEbookRow(ebooksDev, ebooksProd, pipelineStatus, t);
  renderDriveParityRow(pipelineStatus, t);

  // ⚠️ THE PIPELINE-STEP INTERLOCK USED TO BE FED FROM HERE and is not any
  // more (2026-08-18, the page split): the step buttons moved to
  // /status/pipelines/, which reads pipeline_status/current itself. Two pages
  // reading the same public document is the right shape — the alternative was
  // this page keeping a variable alive for a section it no longer contains.
  renderDeployRows({ indexHealth, libraryHealth, gamesHealth, library2Health, authHealth }, t);
  renderWorkerHealthRow('wk-library', 'Library', libraryHealth, t, (b) =>
    `v${b.version || '?'} · database ${b.database || '?'}${b.universes ? ` · ${b.universes.count} universes` : ''}`);
  renderWorkerHealthRow('wk-games', 'Games', gamesHealth, t, (b) =>
    `v${b.version || '?'} · database ${b.database || '?'}`);
  // Same Worker code as Library, so the same summary line — read from HER
  // instance's own health, never inferred from ours.
  renderWorkerHealthRow('wk-library2', "Sam's library", library2Health, t, (b) =>
    `v${b.version || '?'} · database ${b.database || '?'}${b.universes ? ` · ${b.universes.count} universes` : ''}`);
  renderWorkerHealthRow('wk-auth', 'Estate auth', authHealth, t, (b) => {
    const u = b.users || {};
    return `${u.approved ?? '?'} approved · ${u.pending ?? '?'} pending · ${u.revoked ?? '?'} revoked · ${u.approvers ?? '?'} approvers`;
  });

  renderSiteRow('site-audio', 'Audio', audioUp, t);
  renderSiteRow('site-audio-dev', 'Audio /dev/', audioDevUp, t);
  renderSiteRow('site-library', 'Books', libraryUp, t);
  renderSiteRow('site-games', 'Games', gamesUp, t);
  renderSiteRow('site-library2', "Sam's library", library2Up, t);

  // ⚠️ THE SUMMARY LINE USED TO NOT ADD UP, on the most-read sentence of the
  // page: it counted ok/warn/danger "out of N checks" while every row in a
  // grey state (skipped, nodata) and every row still pending vanished from the
  // arithmetic. A reader seeing "8 ok, 0 warnings, 0 down, out of 12 checks"
  // has no way to know whether the missing four are fine or unknown — which is
  // precisely the "a measurement's absence is not a zero" trap, in the one
  // place it is read first and hardest.
  const rows = [...rowRegistry.values()];
  const tally = (...states) => rows.filter((r) => states.includes(r.el.dataset.state)).length;
  const okCount = tally('ok');
  const warnCount = tally('warn');
  const dangerCount = tally('danger');
  const unknownCount = tally('skipped', 'nodata');
  const pendingCount = tally('pending');
  const parts = [`${okCount} ok`, `${warnCount} warning${warnCount === 1 ? '' : 's'}`, `${dangerCount} down`];
  if (unknownCount) parts.push(`${unknownCount} unknown`);
  if (pendingCount) parts.push(`${pendingCount} still checking`);
  document.getElementById('summary').textContent =
    `Estate status refreshed: ${parts.join(', ')} — ${rows.length} checks in total.`;

  btn.disabled = false;
  btn.classList.remove('spinning');
  refreshing = false;
}
/**
 * Backups rows — GET /api/estate/backups (requireDevops()), added 2026-08-16
 * for the "is the backup workflow actually still running" gap: nothing
 * before this surfaced whether a silently-dead backup workflow was
 * invisible or not, which is exactly the failure these rows exist to catch.
 *
 * ⚠️ THRESHOLDS ARE CALENDAR-BASED, DELIBERATELY, UNLIKE THE PIPELINE ROWS
 * ABOVE. `.github/workflows/backup.yml` is `workflow_dispatch`-only — no
 * cron, no expected cadence — so there is no "did it keep up with X" signal
 * to measure against the way renderPipelineEbookRow() measures the ebook
 * lane against the pipeline's own last run (see that function's header for
 * the incident these rows deliberately do NOT repeat: aging a MANUAL act
 * against a threshold that implied an AUTOMATIC cadence, which went
 * amber/red while genuinely healthy). A backup's own age IS the right thing
 * to measure here — the question these rows answer is "how much would the
 * estate lose if disaster struck right now," which is a real, wall-clock
 * question regardless of how the last backup was triggered. What must stay
 * honest is the LABEL: every state below says outright that the trigger is
 * manual, so a long age reads as "nobody has run it in a while" first and
 * "something is broken" only past a wide margin.
 *
 * ⚠️ THE THRESHOLDS THEMSELVES LIVE SERVER-SIDE, in apps/auth-worker/src/
 * backups.ts (14d amber / 45d red, pinned to the millisecond by
 * test/backups.test.ts). This page owns NO threshold and computes NO state:
 * it renders the `state` each group arrives with. That is deliberate — the
 * one place a threshold can be changed is the one place a test guards.
 *
 * ⚠️ AND THE GRADE IS PER STORE, NOT "newest anywhere" (2026-08-16). backup.yml
 * takes a `target` input, so an `r2`-only dispatch refreshes three stores and
 * leaves the four databases and the Firestore dump untouched — the run history
 * shows exactly that happening twice on 2026-08-15. A single row reading the
 * freshest object in the bucket would have shown green with a database
 * months out of date, which is the precise failure this section exists to
 * catch. Every group is therefore graded on its STALEST store and names it.
 */
// ⚠️ THIS SENTENCE HAS BEEN WRONG-BY-DRIFT TWICE and is worth reading before
// editing. It once said "above" while pointing at a list that rendered below;
// it then said "manual dispatch only (no cron)" after backup.yml gained its
// daily 09:12 UTC cron (2026-08-18, docs/access/backup-restore.md §3.0). Both
// times the words survived the change they described. It now names a page
// instead of a direction — the Run levers left this page entirely in the
// 2026-08-18 split — and states the cadence that actually exists.
const BACKUP_MANUAL_NOTE =
  'Backups run daily at 09:12 UTC, plus manual dispatch — so a long age here means the ' +
  'scheduled run is not landing, not merely that nobody pressed a button. Trigger one from ' +
  'the "Backup" row under Run levers on the Pipelines page (/status/pipelines/).';

/**
 * What each backup group actually IS — owner instruction 2026-08-18: "lets also
 * rename all the jobs/checks/workers/etc to be a bit more descriptive. like d1
 * db export 5 stores expand that to make a bit more sense."
 *
 * The server owns the LABEL (backups.ts's BACKUP_KIND_LABELS, which names the
 * thing); these sentences add the other two questions a row has to answer cold:
 * what is inside it, and where does it go. The cadence is in
 * BACKUP_MANUAL_NOTE, which rides every non-green row, so it is not repeated
 * here.
 *
 * ⚠️ NO COUNTS AND NO STORE LISTS IN THESE WORDS. The row already prints the
 * measured "(N stores)", and the store list is being edited in this repo by
 * other work right now — a sentence that enumerated them would be wrong by
 * drift within the week, which is precisely how "Cover buckets" came to
 * describe a group containing no covers.
 */
const BACKUP_KIND_NOTES = {
  d1: 'The SQL databases behind the catalogs — the two libraries, board games, the shared search index ' +
    'and the estate directory — dumped and stored in the estate-backups R2 bucket.',
  firestore: 'Every document in the audiobook-catalog Firestore project (reviews, roles, pipeline status), ' +
    'exported whole into the estate-backups R2 bucket.',
  r2: 'Archives of the other R2 buckets: the cover images for each catalog, plus the gated ebook manifest ' +
    'and estate-document buckets, which are otherwise republished only from the owner’s own machine.',
};

function buildBackupsSection() {
  const ul = document.getElementById('backups-rows');
  ul.appendChild(makeRow('backup-age', 'All estate backups — every store, daily 09:12 UTC'));
  // The per-kind rows below it are created on first response, since their
  // labels and their number come from the Worker (one list of stores, in
  // backups.ts) rather than a second copy kept here.
}

/** Create a per-kind row the first time that kind is seen, then reuse it. */
function backupKindRowId(kind) {
  const id = `backup-kind-${kind}`;
  if (!rowRegistry.has(id)) {
    document.getElementById('backups-rows').appendChild(makeRow(id, kind));
  }
  return id;
}

/**
 * One group (a kind, or the overall roll-up) -> one row. `group` is the shape
 * gradeBackups() returns: {label, stores, count, newest, oldest, oldest_store,
 * age_ms, never, state}. Nothing is recomputed here — `state` arrives decided.
 */
// ⚠️ The backup roll-up group, stashed so `lastWriteFor('estate-backups')` can
// read the NEWEST timestamp directly (audit F8) instead of scraping it back out
// of the sentence this function printed. Set only when the roll-up renders.
let backupOverallGroup = null;

function renderBackupGroup(id, group, now) {
  if (id === 'backup-age') backupOverallGroup = group;
  // ⚠️ `group.stores || 0` used to render a missing store count as "(0 stores)"
  // — a label asserting a number nobody sent. An absent count is unknown.
  const stores = Number.isFinite(Number(group.stores)) ? Number(group.stores) : null;
  // The roll-up row keeps the name it was built with (it names the bucket);
  // per-kind rows get their label from the server, which owns the store list.
  if (id !== 'backup-age') {
    setRowName(
      id,
      stores === null ? `${group.label} (store count not reported)`
        : stores === 1 ? group.label
        : `${group.label} (${stores} stores)`,
    );
  }

  let detail;
  if (group.never && group.never.length) {
    // Never captured is not "stale" — say the true thing: no copy exists.
    detail =
      `No backup exists for ${group.never.join(', ')}` +
      (group.oldest ? ` · the rest were last backed up ${formatAge(now - Date.parse(group.oldest))}.` : '.');
  } else if (!group.oldest) {
    detail = 'No backup has ever been captured.';
  } else {
    const oldestAge = formatAge(now - Date.parse(group.oldest));
    const copies = `${group.count} ${group.count === 1 ? 'copy' : 'copies'} kept`;
    const storeWord = stores === null ? 'the stores in this group' : `${stores} stores`;
    if (stores === 1) {
      detail = `Last backup ${oldestAge} · ${copies}.`;
    } else if (group.newest === group.oldest) {
      // Every store landed in the same run — no "oldest" worth singling out.
      detail = `All ${storeWord} backed up ${oldestAge} · ${copies}.`;
    } else {
      detail =
        `Oldest of ${storeWord} ${oldestAge} (${group.oldest_store || 'store not named'})` +
        ` · newest ${formatAge(now - Date.parse(group.newest))} · ${copies}.`;
    }
  }

  // What this group IS rides on EVERY row including the green ones (owner,
  // 2026-08-18: the labels must make sense cold), while the cadence caveat
  // rides on the roll-up and on anything that is not green — so no amber or red
  // can be read as "broken" without the sentence saying it might just be a run
  // that has not landed.
  const what = BACKUP_KIND_NOTES[group.kind] || null;
  const cadence = id === 'backup-age' || group.state !== 'ok' ? BACKUP_MANUAL_NOTE : null;
  updateRow(id, group.state, detail, [what, cadence].filter(Boolean).join(' ') || null, now);
}

/**
 * A read that failed must take the per-kind rows down WITH the overall row.
 * probeOpsApprover() re-runs on every auth event, so a success followed by a
 * failure would otherwise leave four green rows quoting a reading that could
 * no longer be taken — the silent-staleness trap this whole section exists to
 * close, reproduced one level down.
 */
function failBackupRows(detail, note, now, state = 'danger') {
  for (const id of rowRegistry.keys()) {
    if (id === 'backup-age' || id.startsWith('backup-kind-')) {
      updateRow(id, state, detail, note, now);
    }
  }
}

const parityRowEl = document.getElementById('parity-row');
const parityStateEl = document.getElementById('parity-state');
const parityFillEl = document.getElementById('parity-fill');
const parityDetailEl = document.getElementById('parity-detail');
const parityShadowNoteEl = document.getElementById('parity-shadow-note');

/**
 * ⚠️ The words for "the shadow-tree count is ABSENT from the last report".
 *
 * `deriveState` raises `shelf_behind` only on `shadow_missing > 0`, so a
 * reporter that never sends the field renders as the same green "100% —
 * complete copy" as one that sends 0. Measured 2026-08-25: the card was green
 * and whether the field was being sent was unknowable from this page. The state
 * machine is deliberately unchanged — an absent count is not evidence of drift
 * — so the honesty lives here, in a muted line beside the number.
 */
const SHADOW_UNREPORTED =
  'shadow tree: not reported — add the §4 reporter field. ' +
  'Until then this card cannot tell "no books adrift" from "nobody counted".';

/** State -> the short words in the corner. Only in_parity is a good answer. */
const PARITY_WORDS = {
  in_parity: '100% — complete copy',
  behind: 'behind',
  cannot_fit: 'will not fit',
  // ⚠️ Files are all on disk (rclone reads 100%) but some are NOT in
  // Audiobookshelf's shadow tree, so ABS shows them Missing. Warned, never
  // green — see deriveState's shelf_behind branch in shelf-parity.ts.
  shelf_behind: 'ABS: books missing',
  unknown: 'unknown',
  never_reported: 'never reported',
};

function setParity(state, detail, report, shadowReported) {
  if (!parityRowEl) return;
  parityRowEl.dataset.state = state;
  parityStateEl.textContent = PARITY_WORDS[state] || state;

  // ⚠️ Only ever shown beside a REAL report. On a never_reported / unreadable /
  // unauthorized card there is nothing to have reported the field in, and the
  // card already says what is wrong in words — a second "not reported" line
  // there reads as a second fault. `shadowReported === false` and not
  // `!shadowReported`: an older auth Worker that does not send the key at all
  // must leave the note hidden rather than accuse a reporter of a gap this page
  // cannot actually see (deploy skew, the /status/api 404 branch's lesson).
  if (parityShadowNoteEl) {
    const show = Boolean(report) && shadowReported === false;
    parityShadowNoteEl.textContent = show ? SHADOW_UNREPORTED : '';
    parityShadowNoteEl.hidden = !show;
  }

  // ⚠️ The bar is EMPTIED for unknown/never_reported rather than left at
  // its last width. A bar frozen at 100% beside the word "unknown" is read as
  // 100% — people read the picture, not the caption.
  let pct = 0;
  if (report && report.total > 0 &&
      (state === 'in_parity' || state === 'behind' || state === 'cannot_fit' || state === 'shelf_behind')) {
    pct = Math.round((report.matched / report.total) * 100);
  }
  parityFillEl.style.width = pct + '%';

  let line = detail || '';
  if (report && report.total > 0 && state !== 'never_reported') {
    const when = new Date(report.received_at);
    const stamp = Number.isNaN(when.getTime()) ? report.received_at : when.toLocaleString();
    line = `${report.matched.toLocaleString()} of ${report.total.toLocaleString()} files` +
           (report.missing ? ` · ${report.missing.toLocaleString()} missing` : '') +
           (report.differing ? ` · ${report.differing.toLocaleString()} wrong size` : '') +
           ` · checked ${stamp}. ${line}`;
  }
  parityDetailEl.textContent = line;
}

/**
 * The shelf's parity number. Every failure path says something specific:
 * a row that cannot be read must never leave the previous number standing,
 * because the previous number is exactly what a stale meter shows.
 */
async function loadParity() {
  if (!parityRowEl) return;
  const token = await idToken();
  if (!token) return; // the gate retries on the next auth event
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/shelf/parity`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    setParity('unknown', 'The auth Worker did not answer (network), so parity could not be read.', null);
    return;
  }
  if (res.status === 401 || res.status === 403) {
    setParity('unknown', 'Not authorized to read the parity report.', null);
    return;
  }
  if (res.status === 404) {
    // Deploy skew: this page is newer than the Worker serving it.
    setParity('unknown', 'This estate’s auth Worker does not serve a parity report yet.', null);
    return;
  }
  if (!res.ok) {
    setParity('unknown', 'The parity endpoint did not answer, so this number is not current.', null);
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    setParity('unknown', 'The parity answer was unreadable.', null);
    return;
  }
  // ⚠️ `body.shadowReported` is passed through as-is, INCLUDING `undefined`.
  // undefined means "this Worker predates the field" and must not be collapsed
  // into false — see setParity.
  setParity(body.state || 'unknown', body.detail || '', body.report || null, body.shadowReported);
}

// ⚠️ The Claude budget block was removed on 2026-08-21, the day it shipped:
// /status/agents owns the usage figures (docs/info/status-pages.md). Its
// loader, renderer and thresholds now live in status/agents/agents.js, reading
// GET /api/estate/claude/usage. Do not re-add meters here.

async function loadBackups() {
  const token = await idToken();
  if (!token) return; // no live session yet — probeOpsApprover() retries on the next auth event
  const now = Date.now();
  let res;
  try {
    res = await fetch(`${AUTH_ORIGIN}/api/estate/backups`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    failBackupRows('The auth Worker did not answer (network) — backup age unknown.', BACKUP_MANUAL_NOTE, now);
    return;
  }
  if (res.status === 401 || res.status === 403) {
    // Should not happen once the gate has said yes (same token, same gate
    // tier as /me), but never show a stale row silently if it does.
    failBackupRows('Not authorized to read backup metadata — backup age unknown.', null, now);
    return;
  }
  if (!res.ok) {
    failBackupRows(`The backups endpoint answered HTTP ${res.status} — backup age unknown.`, BACKUP_MANUAL_NOTE, now);
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    failBackupRows('The backups answer was unreadable — backup age unknown.', BACKUP_MANUAL_NOTE, now);
    return;
  }

  if (!body.overall || !Array.isArray(body.kinds)) {
    // Deploy skew: an auth-worker older than this page answers counts without
    // grades. Say that plainly rather than re-implementing the thresholds
    // here — a second copy is exactly what moving them server-side removed.
    // Amber, because the honest state is "this page cannot tell you", which
    // is a real problem with the page, NOT a claim about the backups.
    const newestOverall = body.newest_overall ? Date.parse(body.newest_overall) : NaN;
    failBackupRows(
      Number.isFinite(newestOverall)
        ? `Newest backup anywhere in the bucket ${formatAge(now - newestOverall)} — but per-store ages are unavailable.`
        : 'Backup ages are unavailable.',
      'The auth Worker answered without per-store grading, so a single stale store cannot be ruled out. ' +
      'Deploy auth-worker (Pipelines → Run levers → Deploy — auth-worker) to restore these rows.',
      now,
      'warn',
    );
    return;
  }

  renderBackupGroup('backup-age', body.overall, now);
  for (const kind of body.kinds) {
    renderBackupGroup(backupKindRowId(kind.kind), kind, now);
  }
}

// ---------------------------------------------------------------------------
// Blob storage (owner ask 2026-08-18: "a storage panel — objects, size, last
// write, monthly cost, per bucket").
//
// ⚠️ THIS IS THE ONLY SECTION ON THIS PAGE THAT READS THE PUSHED BOARD, and it
// therefore carries its OWN freshness strip rather than borrowing the page's
// "checked Ns ago" rows. Those rows are probes this browser just made; these
// figures were measured on the home machine and published, and the gap between
// those two can be hours. One strip per clock.
//
// ⚠️ It measures itself against the `storage` SECTION's stamp, not the board's
// (migration 0013). The processing pusher writes the same row every 15 minutes;
// without per-section stamps this panel would claim to have been re-measured
// every quarter of an hour while nothing of the sort had happened.
//
// ⚠️ NO THRESHOLDS AND NO COLOURS BEYOND "measured / not measured". A bucket
// growing is not a fault, and this page has no idea what size is "too big" —
// inventing an amber for it would be exactly the crying-wolf the /status colour
// rule was written to stop. The one warning it does raise is a total that
// covers fewer buckets than exist, which is a fact about the READING.
// ---------------------------------------------------------------------------

const storageFreshEl = document.getElementById('storage-fresh');
const storageTotalsEl = document.getElementById('storage-totals');
const storageArchiveEl = document.getElementById('storage-archive');
const storageBucketsEl = document.getElementById('storage-buckets');
const STORAGE_SECTIONS = ['storage'];

/** Last successful board read, so the strip can age itself between polls. */
let lastStorageGood = null;

/**
 * Last-write, per bucket, from whatever actually WROTE it.
 *
 * ⚠️ `wrangler r2 bucket info` does NOT carry a last-write time, and this page
 * refuses to derive one — a bucket's newest object is only discoverable by
 * listing it, which is the O(objects) cost the pushed design exists to avoid.
 * So the fact is sourced from the job that owns the bucket, and a bucket whose
 * writer reports nothing says "last write not reported" rather than showing a
 * timestamp that means something else.
 */
function lastWriteFor(name, board) {
  if (name === 'estate-backups') {
    // The backups section already knows: the Worker lists that bucket anyway,
    // because it has to grade generations. Reuse the reading rather than take
    // a second one.
    const row = rowRegistry.get('backup-age');
    if (row && row.checkedAt && row.el.dataset.state !== 'pending') {
      // ⚠️ From the group's OWN numbers, never scraped from the rendered text —
      // the two-part-age misparse (audit F8) lived in the old regex here.
      return backupLastWriteText(backupOverallGroup);
    }
    return null;
  }
  const proc = objectSection(board, 'processing');
  if (name === 'ebooks-gated' && proc) {
    const packs = objectSection(proc, 'packs');
    if (packs && packs.as_of && Number.isFinite(Date.parse(packs.as_of))) {
      return `pack manifest read ${formatAge(Date.now() - Date.parse(packs.as_of))}`;
    }
  }
  return null;
}

/**
 * Hang each pushed log tail on the row it explains — the owner's "click into
 * the health check".
 *
 * ⚠️ THE MAPPING LIVES IN THE PUSH, NOT HERE. Each source carries the row id
 * it belongs to (scripts/lib/logs-board.mjs), so adding a job means adding it
 * in ONE place. A second copy of the mapping on this side would be a second
 * thing to forget, and the symptom of forgetting is a silently log-less row.
 *
 * ⚠️ A source whose row is not on this page is skipped in silence, and that
 * is correct: `processing-push` explains the GABI Knowledge page rather than a
 * Health row, and setRowLog() ignores an id it does not know.
 */
function renderRowLogs(board) {
  const logs = objectSection(board, 'logs');
  const sources = logs && Array.isArray(logs.sources) ? logs.sources : [];
  for (const src of sources) {
    if (src && src.row) setRowLog(src.row, src);
  }
}

function renderStorage(board) {
  if (!storageBucketsEl || !storageTotalsEl) return;
  const section = objectSection(board, 'storage');

  if (!section) {
    // ⚠️ FOUR SILENCES, ONE SENTENCE EACH — the board contract's rule. This is
    // "pushed, but this section is absent", which means the storage pusher has
    // not run, NOT that the estate has no storage.
    storageTotalsEl.replaceChildren();
    storageBucketsEl.replaceChildren();
    storageBucketsEl.append(
      el('p', 'empty-say',
        'The last board carried no storage section. That means scripts/push-storage-board.mjs has not run — ' +
        'it says nothing about what is in the buckets.'),
    );
    return;
  }

  // ── The ARCHIVE row goes FIRST, because it is the question ──────────────
  //
  // ⚠️ Owner, on the first version of this panel: "it doesnt say anything
  // useful... I want it to have %s, last run, etc." Bucket sizes are reference;
  // whether his library is safe yet is the thing he came to find out. So the
  // percentage leads and everything else is subordinate to it.
  if (storageArchiveEl) {
    storageArchiveEl.replaceChildren();
    const arc = describeArchive(section.archive, Date.now());
    const card = el('div', 'archive-card');
    card.dataset.tone = arc.tone;

    const head = el('div', 'complete-headline');
    head.append(el('span', 'complete-count', arc.headline));
    head.append(el('span', 'complete-label', arc.detail));
    card.append(head);

    // The bar is drawn ONLY from a real percentage — never an estimate, the
    // same promise /status/processing makes about per-book progress.
    if (Number.isFinite(arc.percent)) {
      const bar = el('div', 'proc-bar');
      const fill = el('span', 'proc-fill');
      fill.style.width = `${Math.max(0, Math.min(100, arc.percent))}%`;
      bar.append(fill);
      card.append(bar);
    }

    if (arc.facts.length) {
      const dl = el('dl', 'archive-facts');
      for (const f of arc.facts) {
        dl.append(el('dt', null, f.label));
        dl.append(el('dd', null, f.value));
      }
      card.append(dl);
    }
    storageArchiveEl.append(card);
  }

  const totals = describeTotals(section);
  storageTotalsEl.replaceChildren();
  const head = el('div', 'complete-headline');
  head.dataset.tone = totals.tone;
  head.append(el('span', 'complete-count', totals.headline));
  head.append(el('span', 'complete-label', 'across every estate bucket'));
  storageTotalsEl.append(head);
  storageTotalsEl.append(el('p', 'section-note', totals.detail));

  const buckets = Array.isArray(section.buckets) ? section.buckets : [];
  storageBucketsEl.replaceChildren();
  if (!buckets.length) {
    storageBucketsEl.append(el('p', 'empty-say', 'The storage section carried no buckets.'));
    return;
  }
  const list = el('ul', 'rows');
  for (const raw of buckets) {
    const b = raw && typeof raw === 'object' ? raw : {};
    const d = describeBucket(b, lastWriteFor(b.name, board));
    const li = el('li', 'row');
    li.dataset.state = d.tone;
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    li.append(dot);

    const body = el('div', 'row-body');
    const headRow = el('div', 'row-head');
    headRow.append(el('span', 'row-name', `${b.label || b.name || 'unnamed bucket'}`));
    headRow.append(el('span', 'badge', d.size));
    body.append(headRow);
    body.append(el('p', 'row-detail', d.detail));
    // The bucket's real name earns its place: it is what an operator types.
    const sub = [b.name, d.sub].filter(Boolean).join(' — ');
    if (sub) body.append(el('p', 'row-note', sub));
    li.append(body);
    list.append(li);
  }
  storageBucketsEl.append(list);
}

async function loadStorage() {
  const result = await fetchBoard(await idToken());
  renderFreshness(storageFreshEl, result, lastStorageGood?.pushedAt ?? null, Date.now(), STORAGE_SECTIONS);
  if (result.status !== 'ok') {
    // ⚠️ The panel is LEFT AS IT WAS on a failed poll — blanking it would read
    // as "the buckets are gone". The strip above has already said, in words,
    // that what is on screen is not current.
    if (result.status === 'never') renderStorage(null);
    return;
  }
  lastStorageGood = result;
  renderStorage(result.board);
  // The same board read feeds the log tails — one fetch, two consumers, rather
  // than a second poll of the same endpoint.
  renderRowLogs(result.board);
}

// ---------------------------------------------------------------------------
// Recent worker events — the capped D1 ring (owner, 2026-08-18: "fix this")
//
// ⚠️ THE ONE RULE THIS SECTION MUST NEVER BREAK: an empty list is not "no
// errors". The placeholder this replaces refused to render an empty box for
// exactly that reason, and the reason did not go away when the ring shipped —
// it moved. So an empty ring says what it has been LISTENING SINCE, and a ring
// that has never been written to says that instead. Those are three different
// facts and only one of them is reassuring.
// ---------------------------------------------------------------------------

const eventsRowsEl = document.getElementById('events-rows');
const EVENT_TONE = { error: 'danger', warn: 'warn', deploy: 'ok', info: 'nodata' };

function renderEvents(payload, now) {
  if (!eventsRowsEl) return;
  eventsRowsEl.replaceChildren();

  if (!payload) {
    eventsRowsEl.append(el('p', 'empty-say', 'The event ring could not be read, so what the Workers have reported is unknown from here.'));
    return;
  }
  if (payload.error) {
    // A migration that has not run is a real, fixable state and says so.
    eventsRowsEl.append(el('p', 'empty-say', `${payload.detail || payload.error}${payload.fix ? ` Fix: ${payload.fix}` : ''}`));
    return;
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) {
    const sinceMs = Date.parse(payload.since || '');
    eventsRowsEl.append(
      el(
        'p',
        'empty-say',
        Number.isFinite(sinceMs)
          ? `No events recorded since ${new Date(sinceMs).toLocaleString()} (${formatAge(now - sinceMs)}). ` +
            'That is not the same as "no errors" — it means no Worker has reported one to this ring in that time.'
          : 'The ring is live and no Worker has written to it yet. That is not "no errors": it means nothing has reported, ' +
            'and a Worker that has not been wired up cannot report at all.',
      ),
    );
    return;
  }

  const list = el('ul', 'rows');
  for (const raw of events) {
    const e = raw && typeof raw === 'object' ? raw : {};
    const li = el('li', 'row');
    li.dataset.state = EVENT_TONE[String(e.level)] || 'nodata';
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    li.append(dot);

    const body = el('div', 'row-body');
    const head = el('div', 'row-head');
    head.append(el('span', 'row-name', str(e.worker) || 'unnamed worker'));
    head.append(el('span', 'badge', str(e.level) || 'event'));
    body.append(head);
    body.append(el('p', 'row-detail', str(e.message) || '(no message)'));

    // ⚠️ TWO CLOCKS, KEPT APART. `at` is when the Worker says it happened;
    // `received_at` is when this estate actually heard about it. They differ
    // when a report is delayed, and collapsing them would hide exactly that.
    const bits = [];
    const atMs = Date.parse(str(e.at));
    if (Number.isFinite(atMs)) bits.push(`happened ${formatAge(now - atMs)}`);
    const gotMs = Date.parse(str(e.received_at));
    if (Number.isFinite(gotMs) && Number.isFinite(atMs) && Math.abs(gotMs - atMs) > 60_000) {
      bits.push(`reported ${formatAge(now - gotMs)}`);
    }
    if (str(e.route)) bits.push(str(e.route));
    if (str(e.request_id)) bits.push(`request ${str(e.request_id)}`);
    if (bits.length) body.append(el('p', 'row-note', bits.join(' \u00b7 ')));

    if (str(e.detail)) {
      const details = document.createElement('details');
      details.className = 'row-log';
      const summary = document.createElement('summary');
      summary.textContent = 'Detail';
      details.append(summary);
      const pre = el('pre', 'log-tail', str(e.detail));
      details.append(pre);
      body.append(details);
    }

    li.append(body);
    list.append(li);
  }
  eventsRowsEl.append(list);
  eventsRowsEl.append(
    el('p', 'section-note',
      `Newest first \u00b7 ${events.length} shown \u00b7 the ring keeps the last ${payload.per_worker_cap ?? '?'} per Worker.`),
  );
}

async function loadEvents() {
  if (!eventsRowsEl) return;
  const now = Date.now();
  try {
    const res = await fetch(`${AUTH_ORIGIN}/api/estate/ops/worker-events?limit=100`, {
      headers: { Authorization: `Bearer ${await idToken()}` },
      cache: 'no-store',
    });
    const body = await res.json().catch(() => null);
    // A 503 carries the table-missing shape, which renderEvents words properly.
    renderEvents(res.ok || body?.error ? body : null, now);
  } catch {
    renderEvents(null, now);
  }
}

// ---------------------------------------------------------------------------
// The devops gate + wiring
//
// ⚠️ THE GATE IS lib/gate.js AND IS SHARED BY ALL FOUR PAGES. What it reveals
// here is REFERENCE, never a lever: the migration runbooks, the commandments,
// and the backup rows. Every control this page used to gate now lives on
// /status/pipelines/.
// ---------------------------------------------------------------------------

const migrationSectionEl = document.getElementById('migration-section');
const commandmentsSectionEl = document.getElementById('commandments-section');
const backupsSectionEl = document.getElementById('backups-section');
const storageSectionEl = document.getElementById('storage-section');
const eventsSectionEl = document.getElementById('events-section');

// ⚠️ The commandments STAY inside the devops gate. They were made public for
// ~20 minutes on 2026-08-25 without the owner's sign-off and he reverted it:
// "no way, that cant be public". Nothing on this page is public because it
// lacks household detail — it is gated because the owner says so, and an
// access-INCREASING change is confirmed first, never assumed. He copies the
// text out while signed in.
const gate = mountGate({
  sections: [migrationSectionEl, commandmentsSectionEl, backupsSectionEl, storageSectionEl, eventsSectionEl],
  // Idempotent by design — the gate re-runs this on every auth event, and both
  // loaders simply re-render the same rows with a fresh reading.
  onAllowed: () => { loadBackups(); loadStorage(); loadEvents(); loadParity(); },
});

// The storage panel is PUSHED data, so it re-polls on the board's own cadence
// rather than with this page's probe refresh — visible tabs only, same rule as
// the other two pushed pages.
setInterval(() => {
  if (!document.hidden && gate.isAllowed()) { loadStorage(); loadEvents(); }
}, BOARD_POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gate.isAllowed()) loadStorage();
});
// ...and its strip re-words itself between polls, so "as of 29 seconds ago"
// cannot still say so two minutes later because a fetch happened not to land.
setInterval(() => {
  if (lastStorageGood && storageFreshEl) {
    renderFreshness(storageFreshEl, lastStorageGood, lastStorageGood.pushedAt, Date.now(), STORAGE_SECTIONS);
  }
}, TICK_INTERVAL_MS);

buildDeploySection();
buildIndexSection();
buildPipelineSection();
buildWorkerSection();
buildSiteSection();
buildBackupsSection();

document.getElementById('refresh').addEventListener('click', () => refreshAll());

refreshAll();
setInterval(tickAll, TICK_INTERVAL_MS);

// Auto-refresh every 60s, but only while the tab is actually visible — a
// backgrounded tab gains nothing from polling five hosts, and refreshing
// once immediately on return keeps the numbers from reading stale.
setInterval(() => { if (!document.hidden) refreshAll(); }, REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshAll();
});
