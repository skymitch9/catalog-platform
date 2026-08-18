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
 * ⚠️ WHY THE THREE EARLIER FIXES KEPT COMING BACK: all three compared
 * TIMESTAMPS. On this lane a timestamp answers "when was this file last
 * rewritten", which is not the question. The measured mechanism (read off the
 * live estate 2026-08-18, not reasoned about):
 *
 *   · `sync_to_drive.py` STEP 1b rebuilds `site/ebooks.json` on EVERY full run
 *     and records `summary.ebookManifestAt` + `summary.ebookCount`.
 *   · `site/ebooks_status.json` — the public heartbeat this lane reads — is
 *     written by `publish_ebooks_manifest.py` at STEP 5.8, and **STEP 5.8 sits
 *     inside the `uploaded_count > 0` block**. A run that uploads nothing never
 *     rewrites the heartbeat, by design.
 *   · So on a quiet run the built stamp legitimately races hours ahead of the
 *     published one WHILE THE SHELF IS UNCHANGED.
 *
 * The false amber, reproduced from live data: run `20260818T150021`, trigger
 * `scheduled`, publish step `done`, `uploaded: 0`, `ebookCount: 168`; live
 * heartbeat `count: 168` stamped the previous day. The old code compared the
 * two stamps, found them 22 h apart, and said "a publish that did not land".
 * Nothing had failed and nothing was trying to land.
 *
 * ⚠️ SO THIS COMPARES SUBSTANCE, NOT CLOCKS. `summary.ebookCount` is what the
 * last run BUILT; the heartbeat's `count` is what the site PUBLISHES. Equal
 * means the public file tells the truth about the shelf — green, whether or not
 * anything moved. Different means a real change exists that readers cannot see:
 * something that tried to come through and did not, which is the one thing
 * amber is for. The stamps are still PRINTED, because they are useful; they
 * never pick a colour again.
 */

/**
 * Which run shapes actually REBUILD the ebook manifest.
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

  const kind = ebookRunKind(pipeStatus.trigger, pipeStatus.steps);
  const summary = pipeStatus.summary || {};
  const builtCount = Number(summary.ebookCount);
  const builtAt = Date.parse(summary.ebookManifestAt || '');
  const builtAge = Number.isFinite(builtAt) ? `last built ${formatAge(now - builtAt)}` : 'build time not recorded';

  // ── The MEASURED answer: does the published shelf match what was built? ──
  if (Number.isFinite(builtCount)) {
    if (builtCount === publishedCount) {
      // ⚠️ GREEN, AND THIS IS THE OWNER'S RULE IN ONE BRANCH. It covers both a
      // run that published a change and a run that had no change to publish —
      // the two are indistinguishable from outside AND SHOULD BE, because in
      // both the public file is telling the truth.
      return {
        state: 'ok',
        detail: `${shelf} · matches the ${builtCount.toLocaleString()} the last run built`,
        note:
          'Green because the published shelf and the manifest the pipeline last built agree — that is ' +
          'true whether the run changed something or found nothing to change. The heartbeat is only ' +
          'rewritten by a run that actually uploads (STEP 5.8), so an older stamp with a matching count ' +
          `is the expected quiet state, not a stall (${publishedAge}, ${builtAge}).${prodNote}`,
      };
    }
    // ⚠️ AMBER, AND ONLY HERE: a real difference between what the pipeline
    // built and what readers can see. Something WAS trying to come through.
    const gap = Math.abs(builtCount - publishedCount);
    return {
      state: 'warn',
      detail:
        `⚠️ ${shelf}, but the last run built a manifest of ${builtCount.toLocaleString()} — ` +
        `${gap.toLocaleString()} book${gap === 1 ? '' : 's'} apart`,
      note:
        'Amber because a change exists that the public file does not carry — the shelf the pipeline ' +
        'built and the shelf the site publishes disagree. This is the one case amber is for; a run with ' +
        `nothing to change renders green. (${publishedAge}, ${builtAge}.)${prodNote}`,
    };
  }

  // ── No recorded count: say so, do not guess a colour ─────────────────────
  //
  // ⚠️ THE OLD CODE PAINTED AMBER HERE, by comparing the heartbeat's age
  // against the run's start time. That is exactly the false alarm the owner
  // reported: a quiet run leaves the heartbeat older than itself by design.
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
      `a step that did not reach it (last run: ${kind.label}).${prodNote}`,
  };
}
