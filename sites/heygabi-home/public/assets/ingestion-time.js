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

/** The same fixed offset in milliseconds, for the arithmetic the recurring
 *  blockers need (weekday + minute-of-day in Phoenix). Deliberately adjacent
 *  to the string above: if one is ever wrong they are both wrong, and the
 *  tests pin January and July alike so a DST assumption cannot creep in. */
export const PHOENIX_OFFSET_MS = 7 * 3_600_000;

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

// ---------------------------------------------------------------------------
// THE ONE PAUSE MENU AND ITS TIME CHIPS (owner ask 2026-09-01, verbatim: "this
// all works good, the time selector is a not my favorite and its getting to be
// a lot of menus and buttons, can you reassess and condense for a better ux").
//
// ⚠️ THE RAW datetime-local PICKER IS NO LONGER THE FRONT DOOR. It is still
// there, under "Custom…", because some pauses genuinely want an arbitrary
// instant — but the common cases are five one-tap chips, and every chip is
// labelled in wordTime()'s own vocabulary so the owner reads the TIME he is
// choosing rather than a duration he has to add to the clock himself.
//
// ⚠️ A CHIP IS SKIPPED RATHER THAN ROLLED FORWARD when its clock time has
// passed or is nearly here. Rolling "7:00 PM" to tomorrow evening at 6:58 PM
// would offer a 25-hour pause under a label that reads like two minutes, which
// is a worse control than no chip at all. The one exception is the morning
// chip, whose whole meaning is "the next 8am" — see PRESET_MIN_MS.
// ---------------------------------------------------------------------------

/** A chip nearer than this is dropped: pausing for eight minutes is a mis-tap,
 *  not an intent, and a control whose effect expires before the owner looks up
 *  from the screen is indistinguishable from one that did nothing. */
export const PRESET_MIN_MS = 10 * 60_000;

/**
 * The four things "Pause" can mean, in the order they are offered.
 *
 * ⚠️ EACH LABEL IS AN ANSWER TO THE QUESTION THE BUTTON OPENED, and the
 * `detail` beside it names the consequence — that is what lets the answer BE
 * the confirmation instead of demanding a second tap (the same grammar the
 * hard pause's own two answers have used since 2026-08-23). A menu of bare
 * verbs would need a confirm step and would have condensed nothing.
 */
export const PAUSE_MENU = [
  {
    key: 'for_now',
    label: 'For now',
    detail:
      'Ends itself as soon as the GPU has been quiet for about four minutes, or when the 12am ' +
      'window opens — whichever comes first.',
  },
  {
    key: 'until_time',
    label: 'Until a time…',
    detail:
      'The same pause with a ceiling. At latest — a quiet GPU or the 12am window can still end ' +
      'it sooner.',
  },
  {
    key: 'hard',
    label: 'Until I unpause',
    detail: 'Nothing but Resume ends it: no timer, no GPU reading, no window. Asks what it should stop.',
  },
  {
    key: 'dont_check',
    label: 'Don’t even check until a time…',
    detail:
      'Not a pause — a spend-nothing instruction. The home machine will not so much as poll the ' +
      'GPU until then.',
  },
];

/** The heading over the chips, so the drawer says which control it is about. */
export function whenTitleWords(intent) {
  if (intent === 'pause_until') return 'Pause until… (at latest)';
  if (intent === 'dont_check_until') return 'Don’t even check to start until…';
  return null;
}

/** The label on the escape hatch back to the native picker. */
export const PRESET_CUSTOM_LABEL = 'Custom…';

/** Phoenix wall-clock HH:MM on the Phoenix calendar day `dayOffset` days from
 *  the one `nowMs` falls on, as a UTC instant. Goes through
 *  phoenixLocalToIso() on purpose: one conversion path, already pinned. */
function phoenixClockIso(nowMs, hh, mm, dayOffset) {
  const p = phoenixParts(nowMs);
  const d = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) + dayOffset * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return phoenixLocalToIso(`${y}-${mo}-${da}T${hh}:${mm}`);
}

function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The five one-tap times, computed in Phoenix at render time.
 *
 * Two relative ("In an hour", "In 3 hours") and three clock times — 7:00 PM
 * today, the next midnight, and the next 8:00 AM. Each is labelled with
 * wordTime()'s vocabulary, so "midnight tonight" and "8:00 AM tomorrow" read
 * on a chip exactly as they read in the status sentence above it.
 *
 * ⚠️ RETURNS ONLY THE CHIPS THAT MAKE SENSE RIGHT NOW: anything already past
 * or less than PRESET_MIN_MS away is dropped, and two presets landing on the
 * same instant collapse to one (at 6:00 PM sharp, "In an hour" IS the 7:00 PM
 * chip). Sorted by time, so the row reads as a timeline.
 */
export function pausePresets(nowMs) {
  const morningToday = phoenixClockIso(nowMs, '08', '00', 0);
  const morningNear = morningToday === null || Date.parse(morningToday) - nowMs < PRESET_MIN_MS;
  const raw = [
    { key: 'plus1h', iso: new Date(nowMs + 3_600_000).toISOString(), relative: 'In an hour' },
    { key: 'plus3h', iso: new Date(nowMs + 3 * 3_600_000).toISOString(), relative: 'In 3 hours' },
    { key: 'evening', iso: phoenixClockIso(nowMs, '19', '00', 0), relative: null },
    // ⚠️ The next 00:00 is the START of tomorrow — the same instant wordTime()
    // calls "midnight tonight", and the same ceiling "For now" writes.
    { key: 'midnight', iso: phoenixClockIso(nowMs, '00', '00', 1), relative: null },
    // The only preset that rolls: "8am" means the next 8am, which is today's
    // before breakfast and tomorrow's after it.
    { key: 'morning', iso: phoenixClockIso(nowMs, '08', '00', morningNear ? 1 : 0), relative: null },
  ];

  const seen = new Set();
  const out = [];
  for (const p of raw) {
    if (!p.iso) continue;
    const ms = Date.parse(p.iso);
    if (!Number.isFinite(ms) || ms - nowMs < PRESET_MIN_MS) continue;
    if (seen.has(p.iso)) continue;
    seen.add(p.iso);
    const words = wordTime(p.iso, nowMs);
    if (!words) continue;
    out.push({ key: p.key, iso: p.iso, label: p.relative ? `${p.relative} — ${words}` : capitalise(words) });
  }
  return out.sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
}

// ---------------------------------------------------------------------------
// RECURRING BLOCKERS + DO-NOT-DISTURB PROGRAMS (owner asks 2026-08-31 /
// 2026-09-01; design docs/info/ingestion-pause-until-gpu-design.md §4 + §4a).
//
// ⚠️ EVERY WORD AND EVERY REFUSAL FOR THE TWO NEW EDITORS LIVES HERE, for the
// reason in the file header: pipelines.js cannot be tested at all, and a
// blocker rendered as "Mon Tue Wed, 6:30 PM – 10:15 PM" when the document says
// something else is exactly the class of bug a screenshot cannot catch.
//
// ⚠️ THE REFUSAL STRINGS ARE DELIBERATELY THE SAME SENTENCES THE WORKER SENDS
// (apps/auth-worker/src/ops.ts). Two enforcement points, one wording: the card
// refuses locally so the owner is told before a round trip, and the Worker
// refuses again because a page is not a gate. If they ever drift, the WORKER
// wins — it is the one the home machine actually reads.
// ---------------------------------------------------------------------------

/** ISO weekday numbers are 1 = Monday … 7 = Sunday — the reader's convention,
 *  not JavaScript's (`getDay()` is 0 = Sunday). The mismatch is the single
 *  most likely off-by-one in this file, so the two are never mixed: every
 *  weekday in this module is ISO. */
export const ISO_WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * What the card offers as one-tap additions to the do-not-disturb list.
 *
 * ⚠️ "Wow.exe" is VERIFIED — read off `tasklist` on the owner's own machine
 * while the game ran, 2026-09-01. "WowClassic.exe" is the documented name of
 * the classic client and is NOT verified here. Both are suggestions only: the
 * text box takes any name, because the list is worthless if it cannot hold the
 * program the owner is actually running.
 */
export const SUGGESTED_EXEMPT_PROCESSES = ['Wow.exe', 'WowClassic.exe'];

/** ⚠️ MIRRORS the reader's MAX_RECURRING_WINDOWS / MAX_EXEMPT_PROCESSES and
 *  the Worker's copies of the same two numbers. */
export const MAX_RECURRING_WINDOWS = 20;
export const MAX_EXEMPT_PROCESSES = 20;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "18:30" → "6:30 PM"; "00:00" → "midnight"; "12:00" → "noon". Returns null
 *  for anything that is not a complete 24-hour wall clock. */
export function hhmmWords(hhmm) {
  if (typeof hhmm !== 'string' || !HHMM_RE.test(hhmm)) return null;
  return clockWords({ hour: hhmm.slice(0, 2), minute: hhmm.slice(3, 5) });
}

/** [1,2,3] → "Mon Tue Wed"; all seven → "Every day". Sorted, so the row reads
 *  the same however the checkboxes were ticked. */
export function weekdayWords(days) {
  if (!Array.isArray(days) || days.length === 0) return null;
  const nums = [...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
    (a, b) => a - b,
  );
  if (nums.length === 0) return null;
  if (nums.length === 7) return 'Every day';
  return nums.map((d) => ISO_WEEKDAY_SHORT[d - 1]).join(' ');
}

/**
 * One blocker, in words — "Mon Tue Wed, 6:30 PM – 10:15 PM".
 *
 * ⚠️ A window whose end is EARLIER than its start crosses midnight and belongs
 * to the day it STARTS, so "Mon, 10:00 PM – 2:00 AM" is Monday night into
 * Tuesday morning. The row says "the next morning" out loud, because a reader
 * who took it as "2am on Monday" would think he had blocked twelve hours
 * fewer than he has.
 */
export function recurringWindowWords(win) {
  if (!win || typeof win !== 'object') return null;
  const days = weekdayWords(win.days);
  const from = hhmmWords(win.from);
  const until = hhmmWords(win.until);
  if (!days || !from || !until || win.from === win.until) return null;
  const crosses = win.from > win.until; // string compare is safe on zero-padded HH:MM
  return `${days}, ${from} – ${until}${crosses ? ' the next morning' : ''}`;
}

/**
 * Validate what the editor collected, in the owner's words. Returns
 * `{ window }` or `{ error }` — never throws, and NEVER repairs: a blocker
 * quietly "fixed" into different hours is a control that does something other
 * than what it says.
 */
export function validateRecurringWindow(input) {
  const raw = input && typeof input === 'object' ? input : {};
  const days = Array.isArray(raw.days)
    ? [...new Set(raw.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
        (a, b) => a - b,
      )
    : [];
  if (days.length === 0) {
    return { error: 'Pick at least one day of the week for this blocker.' };
  }
  if (typeof raw.from !== 'string' || !HHMM_RE.test(raw.from) ||
      typeof raw.until !== 'string' || !HHMM_RE.test(raw.until)) {
    return {
      error:
        'Both times need to be a real time of day, like 6:30 PM. Set the start and the end, then add it.',
    };
  }
  // ⚠️ THE READER REFUSES from === until AS AMBIGUOUS (no minutes, or the
  // whole day?), so the card refuses it here rather than letting the owner add
  // a row the home machine will silently ignore.
  if (raw.from === raw.until) {
    return {
      error:
        'A blocker that starts and ends at the same time means nothing — it could be no minutes or ' +
        'the whole day, and the home machine refuses it rather than guess. Pick an end time that is ' +
        'different from the start. (To block from an evening into the next morning, set the end ' +
        'EARLIER than the start — 10:00 PM to 2:00 AM, say.)',
    };
  }
  return { window: { days, from: raw.from, until: raw.until } };
}

/** A do-not-disturb entry, validated in words. Case is PRESERVED — the reader
 *  matches image names case-insensitively, so the owner's own capitalisation
 *  costs nothing and makes the row readable back to him. */
export function validateExemptProcess(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text || text.length > 200) {
    return {
      error:
        'Type the program’s name as Windows lists it — the image name, like “Wow.exe”. ' +
        'It cannot be blank or longer than 200 characters.',
    };
  }
  return { name: text };
}

/** Phoenix ISO weekday (1 = Monday) and minute-of-day for an instant. */
export function phoenixWeekdayAndMinutes(nowMs) {
  const shifted = new Date(nowMs - PHOENIX_OFFSET_MS);
  const jsDay = shifted.getUTCDay(); // 0 = Sunday
  return {
    weekday: jsDay === 0 ? 7 : jsDay,
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

function hhmmToMinutes(hhmm) {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/**
 * The recurring blocker covering `nowMs`, or null.
 *
 * ⚠️ THE MIDNIGHT-CROSSING CASE IS THE WHOLE DIFFICULTY, and it is a test
 * rather than a footnote: a row whose end is earlier than its start covers
 * [its day, from → 24:00) AND [the NEXT day, 00:00 → until). Evaluating it as
 * a plain "is now between from and until" would make a 10pm–2am blocker cover
 * 2am–10pm instead — the exact inverse of what the owner set.
 */
export function activeRecurringWindow(windows, nowMs) {
  if (!Array.isArray(windows)) return null;
  const { weekday, minutes } = phoenixWeekdayAndMinutes(nowMs);
  for (const w of windows) {
    if (!w || !Array.isArray(w.days)) continue;
    if (typeof w.from !== 'string' || !HHMM_RE.test(w.from)) continue;
    if (typeof w.until !== 'string' || !HHMM_RE.test(w.until)) continue;
    if (w.from === w.until) continue; // the reader refuses it; the card must not render it as live
    const start = hhmmToMinutes(w.from);
    const end = hhmmToMinutes(w.until);
    for (const rawDay of w.days) {
      if (!Number.isInteger(rawDay) || rawDay < 1 || rawDay > 7) continue;
      if (end > start) {
        if (weekday === rawDay && minutes >= start && minutes < end) return w;
      } else {
        const nextDay = (rawDay % 7) + 1;
        if (weekday === rawDay && minutes >= start) return w;
        if (weekday === nextDay && minutes < end) return w;
      }
    }
  }
  return null;
}

/** The do-not-disturb list as a readable clause: "Wow.exe", "Wow.exe or
 *  WowClassic.exe", "Wow.exe, WowClassic.exe or Steam.exe". */
export function processListWords(names) {
  const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string' && n.trim()) : [];
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}`;
}

/**
 * The one line a COLLAPSED "Schedules & exemptions" disclosure shows (owner
 * ask 2026-09-01 — the condense).
 *
 * ⚠️ COLLAPSED MUST NEVER READ AS ABSENT. Two standing editors folded behind a
 * closed disclosure are two controls the owner cannot see; the estate's rule is
 * to say "this is here and here is how much of it there is" rather than to hide
 * so much that the page looks broken. So the summary carries the COUNTS in
 * words, and "none set" is stated rather than left blank.
 *
 * ⚠️ AND IT CARRIES THE IN-FORCE BLOCKER FIRST. A recurring blocker stopping
 * starts RIGHT NOW, hidden behind a closed disclosure, would be exactly the
 * invisible control this whole surface exists to prevent — so the live fact
 * leads the line and `inForce` lets the card tint it amber, the same "look at
 * me" the row itself already gets.
 *
 * Returns { text, inForce } — never null, never blank.
 */
export function standingSummaryWords(control, nowMs) {
  const blockers = Array.isArray(control?.recurring_windows) ? control.recurring_windows : [];
  const programs = Array.isArray(control?.exempt_processes) ? control.exempt_processes : [];
  const parts = [];
  if (blockers.length > 0) parts.push(`${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`);
  if (programs.length > 0) parts.push(`${programs.length} exemption${programs.length === 1 ? '' : 's'}`);
  const counts = parts.length > 0 ? parts.join(' · ') : 'none set';
  const active = activeRecurringWindow(blockers, nowMs);
  if (active) {
    const until = hhmmWords(active.until);
    return { text: `Blocker in force until ${until} · ${counts}`, inForce: true };
  }
  return { text: counts, inForce: false };
}

/** What the summary says when the control could not be READ — never "none
 *  set", which would be a stronger and falser claim than "we cannot see it". */
export const STANDING_UNKNOWN_WORDS = 'Cannot read these right now — they are unchanged on the home machine.';

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
          'normal schedule. The first “Pause” creates the document.',
      ],
      // Nothing to resume, so the card offers the one thing that can be done.
      primary: 'pause',
      showStartNow: false,
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
  // ⚠️ THE SOFT PAUSE (2026-09-01). `pause_until_gpu_free` says the timer
  // below is a CEILING and not a promise: the home machine releases the pause
  // the moment the GPU reads sustained-free (2 polls, 120s apart, under 50%),
  // and only falls back on the timer if it never does. `=== true` is the
  // reader's own coercion — anything else on the document reads as off.
  const softRelease = control.pause_until_gpu_free === true;
  const blocker = activeRecurringWindow(control.recurring_windows, nowMs);
  const blockerWords = blocker ? recurringWindowWords(blocker) : null;
  const programs = processListWords(control.exempt_processes);
  const lines = [];
  // Set by the soft branch when it has already explained the don't-check
  // interaction, so the generic sentence further down does not repeat it.
  let saidDontCheck = false;

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
  } else if (until !== null && until > nowMs && softRelease) {
    // ⚠️ THE SOFT PAUSE, AND THE ONE THING ITS WORDING MUST NEVER DO IS
    // PROMISE THE TIMER. "Paused until midnight" over a document a free GPU
    // can clear at 9pm is the card lying about the machine — so every
    // sentence here says "at latest", and the release condition comes FIRST
    // because it is the one that usually fires.
    state = 'paused';
    badge = 'warn';
    headline = `Paused for now — until ${wordTime(control.paused_until, nowMs)} at the latest.`;
    lines.push(
      'It resumes itself once the GPU has been quiet for ~4 minutes — at latest ' +
        `${wordTime(control.paused_until, nowMs)}. Nobody has to press anything.`,
    );
    lines.push(
      'Nothing runs while it waits — the CPU work is stopped too. The GPU reading is only what ' +
        'releases it.',
    );
    if (programs) {
      // ⚠️ A do-not-disturb program HOLDS the release: a game paused on a menu
      // reads under 50% for a moment, and without this the pause would end in
      // the middle of it — the exact incident that created the list.
      lines.push(
        `It will not release while ${programs} is running, however quiet the GPU goes — that is ` +
          'what the do-not-disturb list under “Schedules & exemptions” below is for.',
      );
    }
    if (dont !== null && dont > nowMs) {
      // ⚠️ A don't-check is a SPEND-NOTHING instruction and polling is
      // spending, so the home machine will not even look at the GPU while one
      // is set. That delays the release past the don't-check time, which is
      // surprising unless it is said out loud.
      lines.push(
        `The “don’t check until” time (${wordTime(control.dont_check_until, nowMs)}) delays even that: ` +
          'while it is set the home machine does not poll the GPU at all, so nothing can release ' +
          'this pause before then.',
      );
      saidDontCheck = true;
    }
    if (manualOnly) {
      lines.push('Until then the 12am–8am window runs as usual; only work started by hand is refused.');
    }
  } else if (until !== null && until > nowMs) {
    // A timer with the flag OFF is the correct encoding of a timed pause —
    // it is what "Pause until…" writes, so that it expires by itself. ⚠️ This
    // branch is now the LEGACY one: every pause the card writes today is soft.
    // A document reaching it was written before 2026-09-01, or by something
    // else — so it keeps the old, honest wording rather than claiming a GPU
    // release the flag does not ask for.
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
  } else if (blocker) {
    // ⚠️ A RECURRING BLOCKER IS ABSOLUTE WHILE IT IS IN FORCE — the same rule
    // as a one-shot pause window, and for the same reason: a standing block
    // anything could override would mean nothing. It outranks the nightly
    // window too, which is the consequence worth stating rather than burying.
    state = 'blocker';
    badge = 'warn';
    headline = `Paused by a recurring blocker — ${blockerWords}.`;
    lines.push(
      'Blockers are absolute while they are in force: no GPU reading releases one, a pause “for ' +
        'now” does not outrank it, and it beats the scheduled 12am–8am window for any hours they ' +
        // ⚠️ NAMES THE DISCLOSURE since 2026-09-01 — the row is one tap away
        // rather than on screen, and "delete it below" pointing at a collapsed
        // box is an instruction the reader cannot follow.
        'overlap. Open “Schedules & exemptions” below to delete it if you want these hours back.',
    );
  } else if (dont !== null && dont > nowMs) {
    state = 'not-checking';
    badge = 'warn';
    headline = `Not checking whether to start until ${wordTime(control.dont_check_until, nowMs)}.`;
  } else {
    state = 'running';
    badge = 'ok';
    headline = 'Running — nothing here is pausing ingestion.';
  }

  // ⚠️ THE CARD RENDERS BOTH WHEN BOTH ARE TRUE, deliberately differing from
  // the reader's single refusal string. The home machine names ONE reason (the
  // first one that matched) because a refusal is one sentence; this page is
  // showing the whole document, and an owner looking at a soft pause needs to
  // know a blocker will still be holding when it releases.
  if (blocker && state !== 'blocker') {
    lines.push(
      `A recurring blocker is also in force right now (${blockerWords}) — it blocks new starts on ` +
        'its own, whatever else this card says.',
    );
  }
  if (dont !== null && dont > nowMs && state !== 'not-checking' && !saidDontCheck) {
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
  // The do-not-disturb list changes what happens at EVERY moment, not only
  // while something is paused, so it gets a line whenever it is non-empty —
  // including on a green card. A guard nobody can see is a guard nobody
  // remembers setting.
  if (programs) {
    lines.push(
      `Do not disturb: nothing new starts while ${programs} is running — window or no window, ` +
        'GPU or CPU. A book already being transcribed is never killed.',
    );
  }
  if (control.updated_by || control.updated_at) {
    const when = wordTime(control.updated_at, nowMs);
    lines.push(
      `Last changed${control.updated_by ? ` by ${control.updated_by}` : ''}${when ? ` at ${when}` : ''}.`,
    );
  }

  // ⚠️ WHICH ONE CONTROL THE CARD OFFERS (owner ask 2026-09-01: "its getting
  // to be a lot of menus and buttons"). Decided HERE, with the words, rather
  // than by pipelines.js re-reading the document: which button is honest in a
  // given state is exactly the kind of thing that can be silently wrong, and
  // the DOM side is untestable by construction.
  //
  // `clearable` is precisely what Resume acts on — the hard flag, a live pause
  // timer, a live don't-check, or a window in force. Nothing else. A recurring
  // blocker on its own therefore leaves the card offering PAUSE, because Resume
  // cannot end a blocker and a button that would do nothing is worse than none.
  const windowInForce = Boolean(win);
  const clearable =
    pausedFlag || (until !== null && until > nowMs) || (dont !== null && dont > nowMs) || windowInForce;

  // `pauseMode` is reported alongside the words so the card can key off the
  // MODE rather than re-parsing the headline — normalised here so there is one
  // place in this file that decides what an unrecognised value means.
  return {
    state,
    badge,
    headline,
    lines,
    pauseMode: manualOnly ? 'manual_only' : 'all',
    // The single primary action. 'pause' opens the four-way question;
    // 'resume' is the one button that ends whatever is currently in force.
    primary: clearable ? 'resume' : 'pause',
    // ⚠️ START NOW IS SHOWN ONLY INSIDE A LIVE WINDOW, because that is the ONE
    // state where it differs from Resume (§3a of ingestion-pause-controls.md:
    // Resume drops the window in force, Start now deliberately does not). In
    // every other state the two write the same document and a second button is
    // noise — which is half of what the owner was complaining about.
    showStartNow: windowInForce,
    // Reported alongside the words for the same reason `pauseMode` is: the
    // card keys off these rather than re-parsing a headline, and this file
    // stays the one place that decides what the document MEANS.
    softPause: state === 'paused' && !pausedFlag && softRelease,
    blocker: blocker ?? null,
  };
}
