/**
 * status/lib/storage-view.js — how the blob-storage panel WORDS itself.
 *
 * Pure: facts in, strings out. No DOM, no fetch, no clock of its own — so the
 * awkward cases (a bucket that could not be measured, a partial total, a zero
 * that is real versus a zero that is missing) are pinned by
 * `scripts/test/storage-view.test.mjs` instead of being discovered on the page.
 *
 * ⚠️ THE RULE THIS SECTION EXISTS UNDER, same as every other row on /status: a
 * measurement's absence is NEVER a zero. "0 objects" and "we could not measure
 * this bucket" are different sentences, and on a BACKUP bucket confusing them
 * is the most alarming wrong answer the panel could give.
 */

/** Decimal units, matching how Cloudflare bills and displays. */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return null;
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB', 'TB', 'PB'];
  let n = bytes / 1000;
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i += 1; }
  return `${n >= 100 ? Math.round(n) : n.toFixed(n >= 10 ? 1 : 2)} ${units[i]}`;
}

/**
 * A monthly cost.
 *
 * ⚠️ SUB-CENT COSTS ARE NOT "$0.00". Three of these buckets cost under a cent a
 * month, and rendering them as $0.00 reads as free — which invites the
 * conclusion that they are not worth watching. "<$0.01" is the honest form.
 */
export function formatCost(usd) {
  if (!Number.isFinite(usd)) return null;
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/**
 * One bucket row's headline + sub-line.
 *
 * `lastWrite` is passed in from whatever actually WROTE the bucket (the backups
 * endpoint for estate-backups, the archive report for estate-audio); this
 * module never derives one, because `bucket info` does not carry it and a
 * derived one would be a guess wearing a timestamp.
 */
export function describeBucket(row, lastWriteText) {
  const b = row && typeof row === 'object' ? row : {};
  if (b.error) {
    return {
      tone: 'nodata',
      size: '—',
      detail: `Could not be measured: ${b.error}`,
      // ⚠️ The row stays, with its label and what it holds, so a bucket never
      // silently drops off the panel — that is how a store stops being watched.
      sub: `${b.holds || ''}${b.holds ? ' · ' : ''}bound in ${b.reachable_from || 'an unrecorded place'}.`,
    };
  }
  const bits = [];
  bits.push(Number.isFinite(b.objects) ? `${b.objects.toLocaleString()} object${b.objects === 1 ? '' : 's'}` : 'object count unknown');
  const cost = formatCost(b.cost_usd_month);
  if (cost) bits.push(`${cost}/mo`);
  if (lastWriteText) bits.push(lastWriteText);
  else bits.push('last write not reported');
  return {
    tone: Number.isFinite(b.bytes) ? 'ok' : 'nodata',
    size: formatBytes(b.bytes) || '—',
    detail: bits.join(' · '),
    sub: b.holds || '',
  };
}

/**
 * The totals line.
 *
 * ⚠️ A PARTIAL TOTAL SAYS SO. If two of eight buckets failed to measure, the
 * byte total covers six — and presenting that as "the estate's storage" would
 * be a lie that looks like arithmetic. The count of what it covers rides in the
 * sentence whenever it is not all of them.
 */
export function describeTotals(section) {
  const s = section && typeof section === 'object' ? section : {};
  const size = formatBytes(s.total_bytes);
  const cost = formatCost(s.total_cost_usd_month);
  if (!size) {
    return {
      tone: 'nodata',
      headline: '—',
      detail: 'No bucket could be measured, so the estate’s storage size is unknown from here — not zero.',
    };
  }
  const partial = Number.isFinite(s.measured) && Number.isFinite(s.of) && s.measured < s.of;
  const objects = Number.isFinite(s.total_objects) ? `${s.total_objects.toLocaleString()} objects · ` : '';
  return {
    tone: partial ? 'warn' : 'ok',
    headline: size,
    detail:
      `${objects}${cost ? `${cost} a month` : 'cost unknown'}` +
      (partial
        ? ` · ⚠️ covers only ${s.measured} of ${s.of} buckets — the other ${s.of - s.measured} could not be measured, and are NOT counted as empty.`
        : ` · all ${s.of} buckets measured`),
  };
}

/**
 * The ARCHIVE row — the one the owner actually wanted.
 *
 * ⚠️ HE SAW THE FIRST VERSION AND SAID "it doesnt say anything useful... I want
 * it to have %s, last run, etc." Object counts and a monthly cost do not answer
 * the only question a backup surface is asked: **is my library safe yet, and is
 * it still moving?** So this row leads with the percentage and the transfer
 * state, and everything else is subordinate to those two.
 *
 * ⚠️ THE COLOUR IS ABOUT WHETHER IT IS WORKING, NOT ABOUT HOW FAR IT HAS GOT.
 * A seed that is 3% done and uploading is GREEN — it is doing exactly what it
 * should. Amber is for a run that stopped talking, or files it could not take;
 * red is for a manifest that cannot be read at all. Grading progress itself
 * would paint the row red for a week and teach him to ignore it, which is the
 * whole lesson of the ebook lane.
 */
export function describeArchive(a, nowMs = Date.now()) {
  if (!a || a.available === false) {
    return {
      tone: 'nodata',
      headline: '—',
      detail: (a && a.note) || 'The archive could not be measured, so how much of the library is backed up is unknown from here — not zero.',
      facts: [],
    };
  }

  const pct = Number.isFinite(a.percent) ? a.percent : null;
  const facts = [];

  // 1. HOW FAR — files, and the bytes behind them.
  if (Number.isFinite(a.files_done)) {
    facts.push({
      label: 'Files uploaded',
      value: Number.isFinite(a.files_total)
        ? `${a.files_done.toLocaleString()} of ${a.files_total.toLocaleString()}`
        : `${a.files_done.toLocaleString()} (total unknown)`,
    });
  }
  if (Number.isFinite(a.bytes_done)) facts.push({ label: 'Data uploaded', value: formatBytes(a.bytes_done) });

  // 2. WHETHER IT IS MOVING — and, if it is, what it is on right now.
  const transferWords = {
    running: 'Uploading now',
    idle: 'Idle — no run in progress',
    stalled: '⚠️ Stalled — the run stopped reporting',
    unknown: 'Unknown — a run holds the lock but is not reporting',
  };
  facts.push({ label: 'Transfer', value: transferWords[a.transfer] || String(a.transfer || 'unknown') });
  if (a.transfer === 'running' && a.current_file) facts.push({ label: 'Current file', value: a.current_file });

  // 3. LAST RUN — the owner asked for this by name.
  const lastUp = a.last_upload_at && Number.isFinite(Date.parse(a.last_upload_at))
    ? `${formatAgeShort(nowMs - Date.parse(a.last_upload_at))} ago`
    : 'not recorded';
  facts.push({ label: 'Last upload', value: lastUp });
  if (Number.isFinite(a.run_files)) {
    facts.push({
      label: 'This run',
      value: `${a.run_files.toLocaleString()} files${Number.isFinite(a.run_bytes) ? ` · ${formatBytes(a.run_bytes)}` : ''}`,
    });
  }
  facts.push({
    label: 'Next run',
    value: a.next_run_at && Number.isFinite(Date.parse(a.next_run_at))
      ? new Date(a.next_run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      // ⚠️ Read from Task Scheduler, never computed from "it runs hourly" — a
      // row confidently predicting a run that will not happen is worse than one
      // that says it does not know.
      : 'unknown — Task Scheduler did not answer',
  });

  // 4. FAILURES — a count with no names is un-actionable.
  facts.push({
    label: 'Failures',
    value: Number.isFinite(a.failure_count)
      ? (a.failure_count === 0 ? 'none' : `${a.failure_count} — ${a.failures.map((f) => f.name).join(', ')}`)
      : 'not reported',
  });

  // 5. THE TWO DIFFERENT PROMISES, kept apart on purpose.
  if (a.integrity) facts.push({ label: 'Integrity', value: a.integrity });
  facts.push({
    label: 'Restore proven',
    // ⚠️ NULL IS "NOT PROVEN", AND IT MUST SAY SO. A blank line here reads as
    // fine, and the estate's recovery runbook names this as its largest
    // unverified step. Hashing on the way UP is not proof anything can be read
    // back DOWN.
    value: describeRestore(a.restore_test, nowMs),
  });

  const tone = a.transfer === 'stalled' || (Number.isFinite(a.failure_count) && a.failure_count > 0)
    ? 'warn'
    : a.transfer === 'unknown' ? 'nodata' : 'ok';

  return {
    tone,
    headline: pct === null ? '—' : `${pct.toFixed(1)}%`,
    percent: pct,
    detail:
      pct === null
        ? 'The log carries no progress line, so how far through the library this is cannot be said — the file count below is what is known.'
        : `of the audiobook library is archived to blob storage.`,
    facts,
  };
}

/** Compact age for a facts table — the row already carries the long form. */
function formatAgeShort(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'an unknown time';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'less than a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Verdicts that mean the round trip WORKED.
 *
 * ⚠️ "pass" ALONE WAS NOT ENOUGH, AND IT SHIPPED WRONG FOR ONE PUSH. The
 * conductor's first real retrieval proof recorded `verdict: "ok"`, and a
 * renderer that only recognised "pass" rendered it as **"⚠️ ok"** — a warning
 * glyph on a PASSING test, on the one line whose entire job is telling the owner
 * his backups have been proven readable. A vocabulary this small has no business
 * being a single hardcoded string.
 */
const RESTORE_PASS = new Set(['ok', 'pass', 'passed', 'success', 'succeeded']);

/**
 * The restore-proof line.
 *
 * ⚠️ AN UNRECOGNISED VERDICT SHOWS THE WORD IT WAS GIVEN and flags it, rather
 * than being flattened to "failed" — the same rule the Drive-parity row follows.
 * A new verdict is the prover saying something new; guessing at it is how a page
 * ends up contradicting the tool it is reporting on.
 */
export function describeRestore(t, nowMs = Date.now()) {
  if (!t || !t.at || !Number.isFinite(Date.parse(t.at))) {
    return '⚠️ never — nothing has been read back out of the bucket and checked';
  }
  const verdict = String(t.verdict || '').trim().toLowerCase();
  const passed = RESTORE_PASS.has(verdict);
  const head = passed ? '✓ passed' : `⚠️ ${t.verdict || 'no verdict recorded'}`;
  const when = describeProofAge(nowMs - Date.parse(t.at));
  return `${head} ${when}${t.detail ? ` — ${t.detail}` : ''}`;
}

/**
 * How long ago the proof ran.
 *
 * ⚠️ A PROOF STAMPED IN THE FUTURE IS NOT "AN UNKNOWN TIME". Measured
 * 2026-08-18: the first recorded proof carried 22:35Z while the page rendered it
 * at 21:52Z — 43 minutes ahead. Clamping that to "unknown" threw away a fact
 * worth having (two clocks disagree) and made a successful test look
 * unmeasurable. Small skew reads as "just now"; a real gap SAYS the prover's
 * clock is ahead, because that is the true and actionable statement.
 */
export function describeProofAge(ms) {
  if (!Number.isFinite(ms)) return 'at an unreadable time';
  if (ms < -120_000) return `— recorded ${formatAgeShort(-ms)} in the FUTURE, so the prover's clock is ahead of this page`;
  if (ms < 60_000) return 'just now';
  return `${formatAgeShort(ms)} ago`;
}

