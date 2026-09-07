/**
 * status/lib/ebook-lane.js — the ebook lane's VERDICT, as a pure function.
 *
 * Extracted from status.js on 2026-08-18 with the fourth fix to this row, for
 * one reason: **the previous three fixes were each reasoned about and shipped,
 * and each was wrong.** A row that has been wrong three times does not need a
 * fourth argument, it needs a test — and a function that reaches into the DOM
 * cannot have one. Everything here is pure: facts in, `{state, detail, note}`
 * out, no `document`, no fetch, no clock of its own. `scripts/test/
 * ebook-lane.test.mjs` runs it against the exact payloads measured off the live
 * estate, including the one that produced the false amber.
 *
 * ⚠️ THE OWNER'S RULE, VERBATIM (docs/TODO.md, "Status-page expansion" item 0):
 * "A completed run with zero changes needed is GREEN. Yellow/amber is reserved
 * for a run that TRIED to apply a change and could not (or partial failure);
 * red for a failed run. No change is not a bug unless a change was trying to
 * come through."
 *
 * ⚠️ THE MECHANISM, read out of audiobook_catalog rather than assumed:
 *
 *   · `sync_to_drive.py` STEP 1b rebuilds `site/ebooks.json` on EVERY full run
 *     and records `summary.ebookManifestAt` + `summary.ebookCount`.
 *   · `site/ebooks_status.json` — the public heartbeat this lane reads — is
 *     written by `publish_ebooks_manifest.py` at STEP 5.8.
 *   · So the honest question is: DID THE MANIFEST THIS RUN BUILT REACH THE
 *     SITE? The two stamps answer it exactly, and that comparison is this
 *     lane's primary signal.
 *
 * ⚠️ AN EARLIER PASS OF THE 2026-08-18 FIX GOT THIS WRONG AND IS RECORDED HERE
 * SO IT IS NOT REPEATED. Seeing the stamps 22 hours apart on a run whose
 * `ebookCount` (168) matched the published `count` (168), it concluded that
 * nothing had changed and the row should be green, and replaced the stamp
 * comparison with a count comparison. That was the wrong lesson from the right
 * observation: STEP 5.8 sat inside the pipeline's `uploaded_count > 0` block,
 * so a run that uploaded nothing SILENTLY SKIPPED PUBLISHING — a real pipeline
 * defect, since fixed at source. **The row was right and the pipeline was
 * wrong.** Turning that amber green would have hidden the very thing the row
 * had just found.
 *
 * ⚠️ SO WHERE DOES "no change is not a bug" LIVE? In the GREEN branch's
 * WORDS, not in a new amber-to-green rule. When the manifest did publish this
 * run and the shelf simply did not change, the row now SAYS that a completed
 * run with nothing to change is not a warning — which is what the owner was
 * actually missing. The colours that changed on this lane are the ones that
 * were never measurements at all: the old "manifest is older than the run"
 * amber (which fired whenever `summary.ebookCount` was absent, comparing a
 * heartbeat against a run start time) is now GREY, because it was a guess; and
 * an unreadable pipeline document is GREY rather than green, because green
 * asserts health this row cannot see.
 *
 * ⚠️ THE COUNTS ARE STILL READ, for WORDS rather than for colour: when the
 * stamps disagree, whether the counts also disagree is the difference between
 * "readers are missing books right now" and "nothing is missing yet, but the
 * publish step did not land". Same amber, very different next action.
 */

/**
 * ⚠️ FIFTH AND LAST FIX, 2026-09-07 (B18): THE TRIGGER STRING IS NO LONGER
 * THE GATE. The pipeline now RECORDS what STEP 1b did, in
 * `summary.ebookManifestState` — `built` | `skipped` | `failed` — written by
 * `app/pipeline_status.ebook_manifest()` in audiobook_catalog and called from
 * all four of STEP 1b's outcomes plus both paths that skip it by design
 * (`--rebuild-only`, a single-step run).
 *
 * Everything below that reads `trigger` is therefore a FALLBACK for runs whose
 * status document predates that change, and NOTHING ELSE. It is kept only
 * until the first run has written the field.
 *
 * 🔴 **DELETE `ebookRunKind`, `EBOOK_PRODUCING_TRIGGERS` and every branch
 * guarded by `state == null` once a run has been observed carrying
 * `summary.ebookManifestState`** — the first scheduled 8-hourly cycle after
 * 2026-09-07 writes it. A fallback is how two sources survive, and this one
 * exists to be removed, not to be maintained: leaving it means the cross-repo
 * trigger-string contract that caused three false ambers is still live, just
 * harder to see. The check is one read of `pipeline_status/current`.
 *
 * ⚠️ Do NOT delete it on the strength of the date alone. A machine that has
 * not run the pipeline since, or a lane (`_dev`) whose last run is older,
 * still serves a pre-B18 document, and removing the fallback would turn that
 * into a grey row for no reason.
 */

/**
 * Which run shapes actually REBUILD the ebook manifest.
 *
 * ⚠️ SUPERSEDED 2026-09-07 by `summary.ebookManifestState` — see the banner
 * above. This is the fallback path for pre-B18 status documents.
 *
 * ⚠️ Producers are whitelisted rather than non-producers blacklisted, and an
 * unrecognised trigger returns null = "do not judge": a NEW run shape added
 * upstream must fail toward saying nothing, never toward inventing another
 * false amber.
 *
 * ⚠️ Trigger strings are a CROSS-REPO contract and they live in
 * audiobook_catalog: `scripts/sync_pipeline_8h.bat` sets
 * PIPELINE_TRIGGER=scheduled, `app/tools/pipeline_watcher.py` uses "manual",
 * the CLI defaults to "manual"/"cli", `--rebuild-only` uses "manual-rebuild",
 * a single-step run uses "manual-step:<key>", and `app/tools/fs_watcher.py`
 * uses "reactive". A rename there degrades this to "do not judge"; it cannot
 * produce a wrong colour.
 */
export const EBOOK_PRODUCING_TRIGGERS = new Set(['scheduled', 'manual', 'cli', 'reactive']);

/**
 * What KIND of run the last one was — used now only for WORDS and for the
 * "not expected to move" case, never as the primary verdict.
 *
 * What the run DID (its publish step) still beats what it WAS (its trigger):
 * the two differ every single time the pipeline finds nothing new.
 */
export function ebookRunKind(trigger, steps) {
  const t = (trigger || '').trim();

  const step = (key) => (Array.isArray(steps) ? steps.find((s) => s && s.key === key) : null);
  const publish = step('publish');
  if (publish && publish.state && publish.state !== 'done') {
    const detect = step('detect');
    const why = detect && detect.detail ? ` — ${detect.detail}` : '';
    return { produces: false, label: `a run with nothing to publish${why}` };
  }

  if (!t) return { produces: null, label: 'an unrecorded run' };
  if (EBOOK_PRODUCING_TRIGGERS.has(t)) return { produces: true, label: 'a full pipeline run' };
  if (t === 'manual-rebuild') return { produces: false, label: 'a rebuild-only run' };
  if (t.startsWith('manual-step:')) {
    return { produces: false, label: `a single-step run (${t.slice('manual-step:'.length) || '?'})` };
  }
  return { produces: null, label: `an unrecognised run (${t})` };
}

/**
 * The verdict. PURE.
 *
 * @param {object} args
 * @param {object|null} args.heartbeat  the parsed `ebooks_status.json` from /dev/
 * @param {object|null} args.pipeStatus the decoded `pipeline_status/current`, or null
 * @param {number} args.prodStampMs     prod heartbeat's generated_at, or NaN
 * @param {number} args.now             the caller's clock
 * @param {(ms:number)=>string} args.formatAge
 * @returns {{state:string, detail:string, note:string|null}}
 */
export function ebookLaneVerdict({ heartbeat, pipeStatus, prodStampMs = NaN, now, formatAge }) {
  const generatedAt = Date.parse((heartbeat && heartbeat.generated_at) || '');
  if (!heartbeat || !Number.isFinite(generatedAt) || typeof heartbeat.count !== 'number') {
    return {
      state: 'danger',
      detail: 'ebooks_status.json answered with no generated_at/count — heartbeat shape changed.',
      note: null,
    };
  }

  const publishedCount = heartbeat.count;
  const shelf = `${publishedCount.toLocaleString()} ebooks published`;
  const publishedAge = `heartbeat stamped ${formatAge(now - generatedAt)}`;
  // Prod lag: information, never colour. Promoting is a deliberate human act.
  const prodNote =
    Number.isFinite(prodStampMs) && prodStampMs < generatedAt - 60_000
      ? ` Prod is ${formatAge(generatedAt - prodStampMs)} behind /dev/ — normal until the next promote, and never a colour here.`
      : '';

  if (!pipeStatus) {
    // Grey, not red and not green — the same choice renderDriveParityRow makes
    // for the same outage, so one dead Firestore reads as one problem rather
    // than three. Green here would assert health this row cannot see.
    return {
      state: 'nodata',
      detail: `${shelf} · ${publishedAge} · cannot read the pipeline status doc, so nothing to check it against.`,
      note: `Same source as the pipeline row above — see its state for why.${prodNote}`,
    };
  }

  const summary = pipeStatus.summary || {};
  const builtCount = Number(summary.ebookCount);
  const builtAt = Date.parse(summary.ebookManifestAt || '');
  const builtAge = Number.isFinite(builtAt) ? `last built ${formatAge(now - builtAt)}` : 'build time not recorded';

  // ── WHAT STEP 1b ACTUALLY DID (B18, 2026-09-07) ──────────────────────────
  //
  // ⚠️ THE MEASUREMENT, AND IT OUTRANKS EVERY INFERENCE BELOW IT. `state` is
  // written by the pipeline itself; `kind` is this page deducing the same
  // thing from a trigger string across a repo boundary. Where they disagree
  // the pipeline is right, because it was there.
  const state = typeof summary.ebookManifestState === 'string'
    ? summary.ebookManifestState
    : null;
  const stateDetail = typeof summary.ebookManifestDetail === 'string'
    ? summary.ebookManifestDetail
    : '';

  // ⚠️ FALLBACK ONLY — delete with `ebookRunKind` once a run has written
  // `ebookManifestState` (see the banner on that function). It is computed
  // unconditionally rather than inside the `state == null` branch purely so
  // its `label` can still supply WORDS to the legacy branches; no colour
  // depends on it any more when `state` is present.
  const kind = ebookRunKind(pipeStatus.trigger, pipeStatus.steps);

  // ── 1b FAILED ────────────────────────────────────────────────────────────
  //
  // 🔴 A SIGNAL THIS ROW HAS NEVER HAD. Before B18 a failed manifest build
  // left exactly what a deliberate skip left — no ebook fields at all — so a
  // real fault was rendered with the harmless green reserved for
  // "not expected to have moved". Amber, not red: the shelf on the site is
  // untouched and still serving, so nobody is missing a book *yet*.
  if (state === 'failed') {
    return {
      state: 'warn',
      detail: `⚠️ ${shelf} · the last run's ebook step FAILED, so nothing new was built${stateDetail ? ` — ${stateDetail}` : ''}`,
      note:
        'Amber because the pipeline tried to rebuild the ebook manifest and could not. The published shelf ' +
        'is whatever the last SUCCESSFUL run left, so no reader has lost anything — but any epub added since ' +
        'is not on it, and the next run will fail the same way until the cause is fixed. Measured, not ' +
        `inferred: the pipeline records this in summary.ebookManifestState.${prodNote}`,
    };
  }

  // ── 1b SKIPPED, BY DESIGN ────────────────────────────────────────────────
  //
  // ⚠️ THIS IS THE CASE THAT PRODUCED THE SECOND FALSE AMBER, and it is now a
  // READ rather than a deduction from `trigger === 'manual-rebuild'`. Green,
  // for the same reason as the legacy `kind.produces === false` branch below:
  // the shelf is not expected to have moved.
  if (state === 'skipped') {
    return {
      state: 'ok',
      detail: `${shelf} · ${publishedAge} · the last run did not rebuild the manifest${stateDetail ? ` (${stateDetail})` : ''}`,
      note:
        'Green because the shelf is not expected to have moved, and this is the PIPELINE saying so rather ' +
        'than this page deducing it from the run\'s trigger string. Judged against the next full run ' +
        `instead.${prodNote}`,
    };
  }

  // ── 1b RAN, but its timestamp could not be recorded ───────────────────────
  //
  // ⚠️ `built` WITHOUT a `generated_at` is a real outcome, not a broken
  // record: the build can succeed while reading `site/ebooks.json` back fails.
  // Grey — the step ran, so "not expected to move" (green) would be a lie, and
  // there is nothing to compare against, so any other colour would be a guess.
  if (state === 'built' && !Number.isFinite(builtAt)) {
    return {
      state: 'nodata',
      detail: `${shelf} · ${publishedAge} · the last run rebuilt the manifest but did not record when${stateDetail ? ` — ${stateDetail}` : ''}`,
      note:
        'Grey, not green: the ebook step DID run, so "not expected to have moved" would be wrong — but ' +
        'without the manifest\'s own generated_at there is nothing to check the published file against. ' +
        `This is the pipeline reporting a partial failure of its own bookkeeping, not a silent one.${prodNote}`,
    };
  }

  // ── DID THE MANIFEST THIS RUN BUILT ACTUALLY REACH THE SITE? ────────────
  //
  // ⚠️ THE STAMP COMPARISON IS THE PRIMARY SIGNAL AND IT STAYS. An earlier
  // pass of this fix replaced it with a count comparison, reasoning that
  // identical counts meant nothing had changed and the row should be green.
  // That was WRONG and the owner's conductor caught it the same day: on
  // 2026-08-18 the divergence was a REAL pipeline defect — sync_to_drive.py
  // gated its publish steps on `uploaded_count > 0`, so a run that uploaded
  // nothing built a manifest and then silently skipped publishing it. The row
  // went amber and WAS RIGHT TO. Softening it to green would have hidden the
  // defect that produced it. (The pipeline has since been fixed at source, so
  // a full run publishes every time and the stamps agree.)
  //
  // ⚠️ SO WHAT DOES "no change is not a bug" ACTUALLY BUY HERE? It is the
  // GREEN branch's second sentence, not a new amber-to-green rule: when the
  // manifest DID publish this run and the shelf simply did not change, the row
  // says so in words instead of leaving a reader to wonder why a run that
  // changed nothing is being reported at all. The colour was always green
  // there; what was missing was the sentence.
  //
  // ⚠️ THE GATE CHANGED 2026-09-07 (B18), AND THIS IS THE WHOLE ITEM. It used
  // to read `Number.isFinite(builtAt) && kind.produces === true` — so even
  // with the manifest's own timestamp in hand, the row refused to use the
  // MEASUREMENT unless the TRIGGER STRING was in a whitelist maintained in the
  // other repo. A rename in `sync_pipeline_8h.bat` silently degraded a row
  // that had the fact it needed sitting right there.
  //
  // `summary.ebookManifestAt` is only ever written when 1b actually built a
  // manifest, so its presence IS the proof the step ran. `state === 'built'`
  // is now the primary gate; `kind.produces === true` is retained ONLY as the
  // fallback for pre-B18 documents, and goes when `ebookRunKind` goes.
  const ranAndStamped =
    Number.isFinite(builtAt) && (state === 'built' || (state === null && kind.produces === true));
  if (ranAndStamped) {
    if (Math.abs(generatedAt - builtAt) < 1000) {
      // ⚠️ THE OWNER'S "no change is not a bug" SENTENCE, and it is anchored to
      // what the RUN REPORTED, not to an inference. `builtCount ===
      // publishedCount` was tried first and says only that the built and
      // published shelves agree — which is true on every green run, including
      // ones that added ten books. The run's own `summary.uploaded` is the
      // measurement of whether this run changed anything at all.
      const uploaded = Number(summary.uploaded);
      const nothingChanged =
        Number.isFinite(uploaded) && uploaded === 0
          ? ' This run had nothing new to add, and that is green — a completed run with no change to make is not a warning.'
          : '';
      return {
        state: 'ok',
        detail: `${shelf} · published manifest is the one the last run built`,
        note:
          'Measured, not inferred — the pipeline records the manifest’s own generated_at ' +
          `(summary.ebookManifestAt) and this row matches the live file against it.${nothingChanged}${prodNote}`,
      };
    }

    // ⚠️ THE STAMPS DISAGREE. WHICH ONE IS THE TRUTH DEPENDS ON WHICH IS NEWER,
    // and getting that backwards is how this row told the owner readers were
    // missing books that had been DELETED. Direction is therefore decided
    // FIRST, before the counts are even looked at — the previous shape checked
    // counts first and reached the "readers are missing books" sentence from
    // both directions.
    const publishedIsNewer = generatedAt > builtAt;
    const gap = Number.isFinite(builtCount) ? Math.abs(builtCount - publishedCount) : null;
    const books = (n) => `${n.toLocaleString()} book${n === 1 ? '' : 's'}`;

    if (publishedIsNewer) {
      // ── The PUBLISHED file is newer than the last RECORDED build ──────────
      //
      // ⚠️ THE SERVE SIDE IS THE CURRENT TRUTH HERE AND THE RECORD IS THE STALE
      // ONE, which is the exact inverse of the case below. A publish ran that
      // this status document does not describe, so `summary.ebookCount` is a
      // measurement from BEFORE it. Judging the live shelf against an older
      // record and calling the difference "missing books" accuses the site of a
      // fault the record is responsible for.
      //
      // ⚠️ MEASURED, 2026-08-18, and it is why this branch exists: the row read
      // "156 published vs 168 built — 12 books apart — readers are missing
      // books". Nobody was missing anything. Twelve stray epubs were deleted
      // from disk at 13:06, the publish at 20:23 correctly re-measured the shelf
      // at 156, and the 168 was a build record from 15:00 that predated the
      // deletion. The library SHRANK; the published shelf was right.
      if (gap !== null && gap > 0) {
        const shrank = publishedCount < builtCount;
        return {
          // Grey, not amber and not green. The shelf being served is the newer
          // measurement and there is nothing to fix — but this page cannot
          // VERIFY that it matches the disk, only that it is the later of two
          // readings. Green would assert more than is known; amber would blame
          // the working half.
          state: 'nodata',
          detail:
            `${shelf} · the library ${shrank ? 'shrank' : 'grew'} by ${books(gap)} after the last recorded build ` +
            // publishedAge/builtAge already carry their own nouns — prefixing
            // them again produced "built last built 6h ago".
            `(${publishedAge}, ${builtAge})`,
          note:
            `Grey, not amber: the published shelf is the NEWER of the two readings, so it — not the ` +
            `${builtCount.toLocaleString()}-book build record — is the current truth, and no reader is ` +
            'missing anything that exists. Files were added to or removed from the library after that ' +
            'build was recorded; the next full pipeline run re-measures and the two agree again. ' +
            `Nothing to do.${prodNote}`,
        };
      }
      // Counts agree, only the clocks differ: a publish this document does not
      // account for, carrying the same shelf.
      return {
        state: 'nodata',
        detail: `${shelf} · the published manifest is NEWER than the one the last recorded run built (${publishedAge}, ${builtAge})`,
        note:
          'Grey because the two sources disagree about what ran, not about what is on the shelf: the live ' +
          'manifest is newer than anything the last recorded run built, and the counts match, so no reader ' +
          `is missing a book. What is unreliable here is the RECORD, not the shelf.${prodNote}`,
      };
    }

    // ── The BUILT manifest is newer than the PUBLISHED one ─────────────────
    //
    // ⚠️ THIS is the direction that means something is wrong, and it stays
    // AMBER. The pipeline produced a shelf and the site never received it.
    if (gap !== null && gap > 0) {
      return {
        state: 'warn',
        detail:
          `⚠️ ${shelf}, but the last run built a manifest of ${builtCount.toLocaleString()} — ` +
          `${books(gap)} apart`,
        note:
          'Amber because readers are missing books the pipeline has already built: the shelf it produced ' +
          'and the shelf the site serves disagree, and the BUILT one is the newer. A publish that did not ' +
          `land, rather than a step that did not run. (${publishedAge}, ${builtAge}.)${prodNote}`,
      };
    }
    return {
      state: 'warn',
      detail: `⚠️ ${shelf} · the last run built a NEWER manifest than the one published (${builtAge}, ${publishedAge})`,
      note:
        'Amber because the manifest this run built never reached the live site. The shelf itself is ' +
        'unchanged, so no reader is missing a book yet — but the publish step did not land, and the next ' +
        'real change would not land either. Do NOT soften this to green because the counts happen to ' +
        'match: on 2026-08-18 this reading was a real pipeline defect (publish gated on uploaded_count) ' +
        `and this row is what found it.${prodNote}`,
    };
  }

  // ── An ebookManifestState this reader has never heard of ─────────────────
  //
  // ⚠️ FAIL TOWARD SAYING NOTHING, the same rule `ebookRunKind` follows for an
  // unrecognised trigger. A new state added upstream must not fall through to
  // the legacy trigger branches below, because those would answer GREEN
  // ("not expected to have moved") for a value that might mean the opposite —
  // which is precisely how this row invented three false colours.
  if (state !== null && state !== 'built') {
    return {
      state: 'nodata',
      detail: `${shelf} · ${publishedAge} · the last run reported an ebook step state this page does not know (${state}).`,
      note:
        'Grey on purpose: a new summary.ebookManifestState value was added in audiobook_catalog and this ' +
        'page has not been taught what it means. Guessing a colour is what this row spent three fixes ' +
        `learning not to do. Teach it in status/lib/ebook-lane.js.${prodNote}`,
    };
  }

  // ── No recorded count: say so, do not guess a colour ─────────────────────
  //
  // ⚠️ THE OLD CODE PAINTED AMBER HERE, by comparing the heartbeat's age
  // against the run's start time. That is exactly the false alarm the owner
  // reported: a quiet run leaves the heartbeat older than itself by design.
  //
  // ⚠️ FALLBACK, PRE-B18 DOCUMENTS ONLY (2026-09-07) — everything from here
  // down reads the trigger string and goes with `ebookRunKind`. `state` is
  // null in this branch by construction (the guard just above returns for
  // every other value), so nothing here can override a measurement.
  if (kind.produces === false) {
    return {
      state: 'ok',
      detail: `${shelf} · ${publishedAge} · last run was ${kind.label}, which does not rebuild it`,
      note:
        `Green because the shelf is not expected to have moved: the last run was ${kind.label}, which ` +
        `skips the ebook step by design. Judged against the next full run instead.${prodNote}`,
    };
  }
  return {
    state: 'nodata',
    detail: `${shelf} · ${publishedAge} · the last run recorded no ebook count, so this row cannot check it.`,
    note:
      'Grey, deliberately: without summary.ebookCount from the pipeline there is nothing to compare the ' +
      'published shelf against, and every colour this row could pick would be a guess. It is written by ' +
      "audiobook_catalog's sync_to_drive.py STEP 1b, so this state means a run older than that change or " +
      `a step that did not reach it (last run: ${kind.label}). Since 2026-09-07 the pipeline also records ` +
      'summary.ebookManifestState, so a run carrying no state at all is a run older than that change ' +
      `too.${prodNote}`,
  };
}
