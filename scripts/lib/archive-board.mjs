/**
 * archive-board.mjs — the audiobook disaster-recovery archive, as a status row.
 *
 * Owner, 2026-08-18, on seeing the first storage panel: *"it doesnt say anything
 * useful, also add it to back ups instead since its a backup. I want it to have
 * %s, last run, etc."* He is right on both counts. Object counts and a monthly
 * cost do not answer the only question a backup surface is asked — **is my
 * library safe yet, and is it still moving?**
 *
 * ⚠️ EVERY FIGURE HERE IS READ OFF AN ARTEFACT THE ARCHIVER ALREADY WRITES.
 * Nothing is estimated and nothing is inferred from elapsed time:
 *
 *   · `audio_archive_manifest.json` — one entry per uploaded file with its
 *     size, its **sha256** and its `uploaded_at`, plus a `failures` map. This is
 *     the numerator, and the sha256 is what makes "verified" a fact rather than
 *     a hope.
 *   · `audio_archive.log` — its progress lines carry `[n/TOTAL]`, and TOTAL is
 *     the only place the denominator exists. Without it there is no percentage,
 *     which is exactly why the first version of this panel had none.
 *   · `audio_archive.lock` — the live run: pid, `current_file`, `done_this_run`,
 *     `bytes_this_run` and a `heartbeat_at`. A lock whose heartbeat has stopped
 *     is a DEAD run, not a running one, and the difference is the whole point
 *     of the row.
 *
 * ⚠️ A PERCENTAGE WITH NO DENOMINATOR IS NOT A PERCENTAGE. If the log has never
 * written a `[n/TOTAL]` line the percent is **null** and the row says how many
 * files are done without pretending to know how many there are. The estate's
 * rule about absences is not suspended because a progress bar looks nicer full.
 */

/** A heartbeat older than this means the run died rather than finished. */
export const HEARTBEAT_STALE_MS = 10 * 60_000;

/** `[813/1257]` -> 1257. The LAST such line wins: the total can be re-counted
 *  between runs, and the newest count is the one describing the current run. */
export function totalFromLog(text) {
  if (typeof text !== 'string') return null;
  let total = null;
  for (const m of text.matchAll(/\[(\d+)\/(\d+)\]/g)) total = Number(m[2]);
  return Number.isFinite(total) && total > 0 ? total : null;
}

/** The newest `uploaded_at` across the manifest's files, or null. */
export function lastUploadAt(files) {
  if (!files || typeof files !== 'object') return null;
  let best = null;
  for (const entry of Object.values(files)) {
    const t = Date.parse(entry?.uploaded_at || '');
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

/**
 * The live transfer state.
 *
 * ⚠️ THREE STATES, NOT TWO, and collapsing them is the mistake this guards
 * against. A lock file that EXISTS does not mean a run is alive — the process
 * can die and leave it behind, which looks identical on disk. The heartbeat is
 * what separates them, and "the lock is held by something that stopped talking"
 * is the one state worth waking someone for.
 */
export function transferState(lock, nowMs) {
  if (!lock) return { state: 'idle', detail: 'No run in progress.' };
  const beat = Date.parse(lock.heartbeat_at || '');
  if (!Number.isFinite(beat)) {
    return { state: 'unknown', detail: 'A run holds the lock but its heartbeat is unreadable, so whether it is alive cannot be said.' };
  }
  const age = nowMs - beat;
  if (age > HEARTBEAT_STALE_MS) {
    return {
      state: 'stalled',
      detail: `A run has held the lock since ${lock.started_at || 'an unrecorded time'} but has not reported for ${Math.round(age / 60000)} minutes — it has probably died.`,
      stale_ms: age,
    };
  }
  return { state: 'running', detail: 'Uploading now.', stale_ms: age };
}

/**
 * Build the archive block.
 *
 * @param {object} o
 * @param {object|null} o.manifest  parsed audio_archive_manifest.json
 * @param {object|null} o.lock      parsed audio_archive.lock, or null when absent
 * @param {string|null} o.logText   a TAIL of audio_archive.log (for the denominator)
 * @param {object|null} o.restore   the last retrieval proof, if one has been recorded
 * @param {number} o.nowMs
 */
export function buildArchiveBlock({ manifest, lock, logText, restore = null, nowMs = Date.now() }) {
  if (!manifest || typeof manifest !== 'object') {
    return {
      available: false,
      // ⚠️ Not "0 files archived". Nothing was measured, and a backup row
      // reading 0% when it simply could not read the manifest is the most
      // frightening wrong answer this row can give.
      note: 'The archive manifest could not be read, so nothing is known about how much of the library is backed up — this is not a measurement of zero.',
    };
  }

  const filesDone = Number.isFinite(Number(manifest.count)) ? Number(manifest.count) : null;
  const filesTotal = totalFromLog(logText);
  const bytesDone = Number.isFinite(Number(manifest.total_bytes)) ? Number(manifest.total_bytes) : null;
  const percent =
    Number.isFinite(filesDone) && Number.isFinite(filesTotal) && filesTotal > 0
      ? Math.min(100, (filesDone / filesTotal) * 100)
      : null;

  const failuresMap = manifest.failures && typeof manifest.failures === 'object' ? manifest.failures : {};
  const failures = Object.entries(failuresMap).map(([name, f]) => ({
    name,
    error: String(f?.error || '').slice(0, 240),
    attempts: Number.isFinite(Number(f?.attempts)) ? Number(f.attempts) : null,
    last_try: f?.last_try || null,
  }));

  const transfer = transferState(lock, nowMs);

  return {
    available: true,
    bucket: manifest.bucket || null,
    prefix: manifest.prefix || null,
    files_done: filesDone,
    files_total: filesTotal,
    percent,
    bytes_done: bytesDone,
    failure_count: Number.isFinite(Number(manifest.failure_count)) ? Number(manifest.failure_count) : failures.length,
    failures,
    last_upload_at: lastUploadAt(manifest.files),
    manifest_at: manifest.generated || null,
    // ⚠️ "Verified" is a claim about METHOD, and it is true: the archiver
    // records a sha256 per file and re-uploads when the digest moves, so an
    // entry in the manifest means the bytes on disk were hashed. It is NOT a
    // claim that anything was read back OUT of the bucket — that is
    // `restore_test` below, and conflating the two would be exactly the
    // "shipped is not verified" error the estate has a rule about.
    integrity: 'sha256 recorded per file at upload',
    transfer: transfer.state,
    transfer_detail: transfer.detail,
    current_file: lock?.current_file || null,
    run_started_at: lock?.started_at || null,
    run_files: Number.isFinite(Number(lock?.done_this_run)) ? Number(lock.done_this_run) : null,
    run_bytes: Number.isFinite(Number(lock?.bytes_this_run)) ? Number(lock.bytes_this_run) : null,
    heartbeat_at: lock?.heartbeat_at || null,
    /**
     * ⚠️ THE RESTORE PROOF, AND IT IS DELIBERATELY SEPARATE FROM `integrity`.
     * A backup that has never been read back is a backup nobody has tested;
     * the estate's own recovery runbook says the largest unverified step is
     * exactly this. Null here means NOT PROVEN, and the row must say so in
     * those words rather than leaving the line blank — a blank reads as "fine".
     */
    restore_test: restore || null,
  };
}
