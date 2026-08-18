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
