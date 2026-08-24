/**
 * ingestion-time.js — the PURE half of the /status ingestion pause card
 * (owner order 2026-08-18: "give me a way to pause and start the process
 * flow on the GABI dashboard. Tonight starting at 7pm I need all of this
 * paused until midnight. So let me also set pause timers on the ui. I can
 * say don't even check to start until x time.").
 *
 * WHY THIS IS ITS OWN FILE, AND NOT SIXTY LINES INSIDE status.js.
 * status.js imports estate-auth.js, which imports the Firebase SDK — so it
 * cannot be loaded by a node test, and every wording and timezone decision
 * inside it is untestable by construction. The three things most likely to
 * be silently WRONG here are exactly the three things a human cannot check
 * by looking at a screenshot:
 *   1. that "7pm tonight" in the picker means 7pm in PHOENIX, not 7pm in
 *      whatever timezone the phone happens to be carrying;
 *   2. that "until midnight" renders as the words "midnight tonight" rather
 *      than a bare ISO string the owner has to decode;
 *   3. that a LAPSED pause is not still displayed as an active one.
 * All three live here, pure, with no DOM and no imports, and are pinned by
 * scripts/test/ingestion-time.test.mjs.
 *
 * ⚠️ PHOENIX IS UTC-7 ALL YEAR — that is why the conversion below is a
 * string concatenation and not a timezone library. Arizona has not observed
 * daylight saving since 1968, so America/Phoenix has no offset transitions
 * to get wrong. If the estate ever moves to a DST-observing timezone this
 * file's PHOENIX_OFFSET constant becomes a lie that no test would catch,
 * because the tests pin Phoenix specifically — so the constant and the
 * timezone name are deliberately adjacent, and both are named in the error
 * a caller sees.
 *
 * ⚠️ THE PICKER IS READ AS PHOENIX TIME, NOT DEVICE TIME. An <input
 * type="datetime-local"> hands back a bare wall-clock string with no zone,
 * and the obvious `new Date(value)` reads it as the DEVICE's zone. That is
 * right exactly while the device is in Phoenix and silently wrong the moment
 * it is not — a pause set from a laptop still on Eastern would land three
 * hours early, and nothing on screen would say so. So the string is pinned
 * to Phoenix explicitly, and the label on the control says "Phoenix time"
 * out loud.
 */

/** The estate's home timezone. Named in the UI, not just assumed. */
export const PHOENIX_TZ = 'America/Phoenix';

/** Arizona does not observe DST — see the file header before changing this. */
export const PHOENIX_OFFSET = '-07:00';

const MS_PER_DAY = 86_400_000;

/** Wall-clock fields, in Phoenix, for an instant. `h23` (not hour12:false)
 *  because some ICU builds render midnight as hour "24" under the latter. */
const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PHOENIX_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: PHOENIX_TZ, weekday: 'long' });
const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: PHOENIX_TZ,
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function phoenixParts(ms) {
  const out = {};
  for (const p of PARTS_FMT.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  return out;
}

/** An integer index for "which Phoenix calendar day is this instant on",
 *  so "today / tomorrow" is a subtraction rather than a string compare. */
export function phoenixDayIndex(ms) {
  const p = phoenixParts(ms);
  return Math.floor(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / MS_PER_DAY);
}

/** Parse an ISO string to ms, or null. Never throws, never returns NaN. */
export function parseIso(value) {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A datetime-local value ("2026-08-18T19:00") read as PHOENIX wall-clock,
 * returned as a UTC ISO instant. Returns null on anything that is not that
 * exact shape — a caller must never forward a half-typed picker value into
 * a control document.
 */
export function phoenixLocalToIso(value) {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${PHOENIX_OFFSET}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The inverse — an instant as a Phoenix wall-clock picker value, for
 *  pre-filling the two inputs with what is already set. */
export function isoToPhoenixLocal(iso) {
  const ms = parseIso(iso);
  if (ms === null) return '';
  const p = phoenixParts(ms);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "midnight" / "noon" / "7:00 PM" — the clock half of the words. */
function clockWords(p) {
  const h = Number(p.hour);
  const min = p.minute;
  if (h === 0 && min === '00') return 'midnight';
  if (h === 12 && min === '00') return 'noon';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * An instant, in words, relative to now — the owner's own phrasing rather
 * than an ISO string. "midnight tonight", "7:00 PM today", "8:00 AM
 * tomorrow", "3:00 PM on Thursday", "3:00 PM on Thu, Aug 27".
 *
 * ⚠️ "midnight tonight" is the specific case the owner asked for by name
 * ("paused until midnight"), and it is midnight at the START of TOMORROW —
 * the end of tonight, not 00:00 of the day already in progress. Rendering
 * that as "12:00 AM tomorrow" is technically true and reads as a different
 * time to a human at 9pm, which is the whole reason this function exists.
 */
export function wordTime(iso, nowMs) {
  const ms = parseIso(iso);
  if (ms === null) return null;
  const p = phoenixParts(ms);
  const clock = clockWords(p);
  const delta = phoenixDayIndex(ms) - phoenixDayIndex(nowMs);

  if (clock === 'midnight' && delta === 1) return 'midnight tonight';
  if (delta === 0) return `${clock} today`;
  if (delta === 1) return `${clock} tomorrow`;
  if (delta === -1) return `${clock} yesterday`;
  if (delta > 1 && delta < 7) return `${clock} on ${WEEKDAY_FMT.format(new Date(ms))}`;
  return `${clock} on ${DATE_FMT.format(new Date(ms))}`;
}

/** A pause window covering `nowMs`, or null. Windows without a usable
 *  `until` are ignored rather than treated as open-ended — an unreadable
 *  window must never silently pause the display forever. */
export function activeWindow(windows, nowMs) {
  if (!Array.isArray(windows)) return null;
  for (const w of windows) {
    if (!w) continue;
    const from = parseIso(w.from);
    const until = parseIso(w.until);
    if (until === null || until <= nowMs) continue;
    if (from !== null && from > nowMs) continue;
    return w;
  }
  return null;
}

/** The soonest window that has not started yet, or null. */
export function nextWindow(windows, nowMs) {
  if (!Array.isArray(windows)) return null;
  let best = null;
  let bestFrom = Infinity;
  for (const w of windows) {
    if (!w) continue;
    const from = parseIso(w.from);
    if (from === null || from <= nowMs) continue;
    if (from < bestFrom) { best = w; bestFrom = from; }
  }
  return best;
}

/**
 * The whole status line, decided in one pure place: given the control
 * document (or null when none exists) and "now", say what is true in words.
 *
 * ⚠️ THE EFFECTIVE-PAUSE RULE IS NOT INVENTED HERE — IT MIRRORS THE HOME
 * MACHINE, function for function. The reader is audiobook_catalog's
 * `app/core/ingest_control.py::control_blocks_start()`, and its order is:
 *
 *   1. unreadable control        → treated as PAUSED (fails closed, their side)
 *   2. paused === true           → blocked, UNLESS `pause_mode` is
 *                                  'manual_only' AND this start is inside the
 *                                  nightly 12am–8am window (see below)
 *   3. paused_until in future    → blocked until that instant, same exception
 *   4. inside a pause window     → blocked until the window ends
 *   5. otherwise                 → free to start
 *
 * ⚠️ STEPS 2 AND 3 GAINED THEIR ONE EXCEPTION ON 2026-08-23 (owner ask: "when
 * i manually pause the pipeline it says nothing can override it. I want it to
 * ask me if i want to stop all work until unpaused or if scheduled window is
 * fine to continue."). `pause_mode` says what a pause MEANS — 'all' (the
 * historical, absolute meaning, and what an absent or unrecognised value
 * decodes to) or 'manual_only', which exempts the nightly window and nothing
 * else. It does NOT touch step 4: a pause window IS a scheduled block, so
 * "let the scheduled window continue" overriding one would make quiet hours
 * meaningless. The wording below carries the difference in the HEADLINE,
 * because two pauses that do opposite things must never read the same.
 *
 * ⚠️ EVERYTHING BELOW ABOUT "Pause until…" IS UNCHANGED BY THAT. Step 2 is
 * still unconditional *with respect to the timer*, and that is why "Pause
 * until…" WRITES
 * `paused: false`. The obvious encoding — set the flag AND the timer — would
 * leave the flag true at midnight and the machine paused forever, because
 * nothing in their step 2 consults the timer. A `paused_until` on its own is
 * therefore the CORRECT encoding of a timed pause, not a half-set one, and
 * the wording below must not apologise for it. (This is exactly the contract
 * reconciliation the brief called for: their reader is the source of truth
 * and this file follows it.)
 *
 * A `paused_until` already in the past is consequently just RUNNING — their
 * step 3 stops matching the moment it expires — with a line saying the old
 * timer is still on the document and clears itself on the next write.
 *
 * Returns { state, badge, headline, lines } — `badge` is the status page's
 * own row vocabulary (ok/warn/danger/pending), `lines` are the supporting
 * sentences in reading order.
 */
export function describeIngestion(control, nowMs) {
  if (control === null || control === undefined) {
    return {
      state: 'unknown',
      badge: 'warn',
      headline: 'No ingestion control has ever been set.',
      lines: [
        'There is no control document yet, so nothing here is pausing ingestion — it runs on its ' +
          'normal schedule. The first “Pause now” or “Pause until…” creates the document.',
      ],
    };
  }

  const pausedFlag = control.paused === true;
  // ⚠️ WHAT THE PAUSE MEANS (owner ask 2026-08-23). Same fail-closed rule as
  // both readers: absent, mis-spelled or the wrong type all mean 'all', which
  // is what every pause written before that date meant. 'manual_only' is the
  // ONLY value that softens the wording, because it is the only value that
  // softens the behaviour.
  const manualOnly = control.pause_mode === 'manual_only';
  const until = parseIso(control.paused_until);
  const dont = parseIso(control.dont_check_until);
  const win = activeWindow(control.pause_windows, nowMs);
  const soon = nextWindow(control.pause_windows, nowMs);
  const lines = [];

  let state;
  let badge;
  let headline;

  // The order below IS control_blocks_start()'s order — see the header. The
  // hard flag is checked before any timer because their step 2 is
  // unconditional, and a card that showed "Paused until midnight" over a
  // document whose flag will still be set at 12:01 would be promising a
  // restart that is never going to happen.
  if (pausedFlag) {
    state = 'paused';
    badge = 'warn';
    // ⚠️ THE TWO ANSWERS MUST NOT READ THE SAME. Before this field existed the
    // card said "It stays paused until someone presses Resume" and that was
    // the whole truth; under 'manual_only' that sentence would be a lie about
    // the nightly run. The headline carries the difference, not a footnote —
    // this line is what the owner reads to know which button he pressed.
    headline = manualOnly
      ? 'Paused for work started by hand — the scheduled window may continue.'
      : 'Paused, with no end time set.';
    lines.push(
      manualOnly
        ? 'The 12am–8am window runs as if nothing were paused. Anything started by hand is ' +
            'refused until someone presses Resume — no timer will restart it.'
        : 'It stays paused until someone presses Resume — no timer will restart it. Nothing ' +
            'overrides it: not the scheduled 12am–8am window, not a run started by hand.',
    );
    if (until !== null) {
      lines.push(
        `A pause-until time (${wordTime(control.paused_until, nowMs)}) is also on the document, but the ` +
          'hard pause overrides it and outlives it. Resume clears both.',
      );
    }
  } else if (until !== null && until > nowMs) {
    // A timer with the flag OFF is the correct encoding of a timed pause —
    // it is what "Pause until…" writes, so that it expires by itself.
    state = 'paused';
    badge = 'warn';
    headline = manualOnly
      ? `Paused until ${wordTime(control.paused_until, nowMs)} for work started by hand — the scheduled window may continue.`
      : `Paused until ${wordTime(control.paused_until, nowMs)}.`;
    lines.push('It restarts by itself at that time — nobody has to press anything.');
    if (manualOnly) {
      lines.push('Until then the 12am–8am window runs as usual; only work started by hand is refused.');
    }
  } else if (win) {
    state = 'window';
    badge = 'warn';
    headline = `Paused by a scheduled window — waiting until ${wordTime(win.until, nowMs)}.`;
  } else if (dont !== null && dont > nowMs) {
    state = 'not-checking';
    badge = 'warn';
    headline = `Not checking whether to start until ${wordTime(control.dont_check_until, nowMs)}.`;
  } else {
    state = 'running';
    badge = 'ok';
    headline = 'Running — nothing here is pausing ingestion.';
  }

  if (dont !== null && dont > nowMs && state !== 'not-checking') {
    lines.push(`It will not even check whether to start until ${wordTime(control.dont_check_until, nowMs)}.`);
  }
  if (dont !== null && dont <= nowMs) {
    lines.push(
      `The “don’t check until” time (${wordTime(control.dont_check_until, nowMs)}) has already passed; ` +
        'it clears itself the next time any control here is set.',
    );
  }
  if (until !== null && until <= nowMs && !pausedFlag) {
    lines.push(
      `The pause until ${wordTime(control.paused_until, nowMs)} has finished — ingestion is free to ` +
        'start again. The expired timer clears itself the next time any control here is set.',
    );
  }
  if (soon) {
    const from = wordTime(soon.from, nowMs);
    const to = wordTime(soon.until, nowMs);
    lines.push(`A scheduled pause window opens at ${from}${to ? ` and ends at ${to}` : ''}.`);
  }
  if (control.updated_by || control.updated_at) {
    const when = wordTime(control.updated_at, nowMs);
    lines.push(
      `Last changed${control.updated_by ? ` by ${control.updated_by}` : ''}${when ? ` at ${when}` : ''}.`,
    );
  }

  // `pauseMode` is reported alongside the words so the card can key off the
  // MODE rather than re-parsing the headline — normalised here so there is one
  // place in this file that decides what an unrecognised value means.
  return { state, badge, headline, lines, pauseMode: manualOnly ? 'manual_only' : 'all' };
}
