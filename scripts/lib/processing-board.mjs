/**
 * processing-board — the PURE projection behind /status/processing.
 *
 * (home-machine state + ingest logs + the pack index) → the `processing`
 * section of the agent board, exactly as docs/info/agent-board-contract.md §6
 * describes it. Every function here is pure: it takes text and objects and
 * returns objects, touches no disk, no clock and no network. The I/O half —
 * finding the files, merging the section into the board, and pushing it — is
 * scripts/push-processing-board.mjs.
 *
 * ⚠️ THE SPLIT IS THE POINT. The projection is the part that can be WRONG in a
 * way nobody notices (a lane mislabelled, a join date taken from the wrong
 * clock, a zero standing in for an unknown), and it is the part that is hard to
 * exercise against a live pipeline that only produces its interesting states at
 * 3am. Pure means scripts/test/processing-board.test.mjs can hold every one of
 * those states as a fixture.
 *
 * WHAT IT READS, AND WHOSE CLOCK EACH FACT CARRIES
 * ------------------------------------------------
 *   ingest_state.json      per-book status/source/chunks/updated_at.
 *                          ⚠️ `updated_at` of a DONE book is the moment its
 *                          pack became servable — the owner's "joined GABI's
 *                          knowledge base". It is NOT the transcription date
 *                          and must never be presented as one.
 *   packs/_index.json.gz   the published manifest: its own `generated_at`, a
 *                          THIRD clock that may be hours behind the state file.
 *   receipts/*.json        the last run's ingester_version and outcome.
 *   ingest_nightly.log     the only live window into an in-flight book, plus
 *                          the ingester's own `queue: N books (C CPU, G GPU)`.
 *   logs/cpu_ingest.log    the title↔book_id mapping, MEASURED off the OK
 *                          lines rather than re-derived by re-implementing the
 *                          slugger (one canonical implementation of anything
 *                          that makes a decision — this file is not a second).
 *   ingest_books.lock      read, NEVER acquired. Its presence is what turns a
 *                          dangling "transcribing …" line into a live claim.
 *
 * ⚠️ THERE IS NO HONEST `percent` FOR A BOOK BEING TRANSCRIBED, AND THIS FILE
 * IS A MEASUREMENT OR IT IS ABSENT. Originally there was no honest percentage
 * to publish at all: the Whisper worker printed a real progress line every
 * 60 s, but the transcriber ran it with captured output, so those lines sat
 * unread in a pipe until the book finished. Later on 2026-08-18
 * `scripts/transcribe_audiobook.py` grew a tee — it relays the worker's stdout
 * byte-for-byte AND writes `estate-training-data/work/transcribe_progress.json`
 * on each progress line. That file is the pipeline's own count of finished
 * units, and `percent = transcribed span / container duration` is the SAME
 * ratio the transcriber's own truncation gate uses.
 *
 * ⚠️ THE TEE WENT IN THE TRANSCRIBER, NOT THE NIGHTLY, and a reader here must
 * know why: that script is the one file BOTH invocation paths share. The
 * nightly runs it as a subprocess; a hand-run chain calls it directly with
 * `--m4b` and writes no nightly log line at all. The progress file — not the
 * log — is therefore the only signal that sees EVERY transcription, which is
 * why it is consulted FIRST below and the log is the fallback.
 *
 * ⚠️ AN ELAPSED-TIME GUESS IS STILL FORBIDDEN in that field and no later edit
 * may quietly introduce one: the page draws a bar from it and promises never
 * to estimate. The two transcriptions timed on 2026-08-18 ran at very
 * different realtime factors, so "~85x" is a range, not a rate.
 */

/** Phoenix is a FIXED UTC-7 all year — no DST, ever. That is why a log
 *  timestamp can be turned into an instant with string arithmetic and no
 *  timezone database. The ingester stamps every line "MST" for the same
 *  reason. */
export const PHOENIX_OFFSET = '-07:00';

/** Mirrors app/tools/ingest_books.py's own LOCK_STALE_HOURS. A lock older than
 *  this is one the ingester itself would steal, so it is not evidence of a live
 *  run and must not be read as one. */
export const LOCK_STALE_HOURS = 12;

/**
 * How old a `transcribe_progress.json` may be before it is treated as ABSENT.
 *
 * ⚠️ The transcriber deletes this file on every exit it survives — success,
 * non-zero worker, truncation and exception alike. This cut-off is the second
 * layer, for the run that was KILLED and never reached that cleanup: a machine
 * that lost power, a task-scheduler stop, a `taskkill`. Without it a dead run's
 * last measurement would sit on the owner's page as a live book forever, which
 * is worse than showing nothing — it is a confident wrong answer.
 *
 * Sized off the writer, not off a round number: the worker prints a progress
 * line every 60 seconds, so a healthy run refreshes this file once a minute.
 * Ten minutes is ten missed heartbeats — long enough that a stuttering GPU or a
 * slow disk cannot flap the page, short enough that a killed run clears within
 * one poll of the 15-minute pusher.
 */
export const PROGRESS_STALE_MS = 10 * 60 * 1000;

/**
 * How many history rows a push carries.
 *
 * ⚠️ THE FEED IS THE PART THAT GROWS AND TRIMMING IT IS THE PUSHER'S JOB — the
 * Worker's 256 KB cap exists to catch a pusher that forgot, not to do the
 * trimming. MEASURED 2026-08-18: a real push of 158 history rows was 44,393
 * bytes as sent (indented), so ~280 bytes a row — and the queue behind it is
 * 1,064 more books. At 500 rows that is ~140 KB, which still leaves room for
 * the agents/events/usage sections beside it. When rows are dropped the section
 * SAYS SO — a silently truncated history reads as "we stopped ingesting".
 *
 * ⚠️ RAISING THIS PAST ~800 NEEDS THE BOARD FILE WRITTEN COMPACT FIRST, or the
 * push starts refusing with `board_too_large` on a night that ingests well.
 */
export const MAX_HISTORY = 500;

/** `source` in ingest_state.json → the lane keys /status/processing labels.
 *
 *  ⚠️ `audiobook-with-review` is DELIBERATELY ABSENT. It is a real lane in
 *  app/core/ingest_queue.py (tier 4, ordered by review count), but nothing on
 *  disk records which finished book came from it — `source: transcript` is all
 *  the state keeps. Emitting `audiobook-with-review` here would be a guess
 *  wearing a measurement's clothes. */
const LANE_BY_SOURCE = {
  epub: 'epub',
  'pdf-text': 'text-pdf',
  'pdf-ocr': 'deferred-pdf',
  transcript: 'audiobook',
};

export function laneForSource(source) {
  if (typeof source !== 'string' || !source) return null;
  return LANE_BY_SOURCE[source] || source; // an unknown lane renders verbatim
}

/** "2026-08-18" + "12:27:44" (Phoenix) → an ISO instant, or null. */
export function phoenixToIso(date, time) {
  const ms = Date.parse(`${date}T${time}${PHOENIX_OFFSET}`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) MST\]\s?(.*)$/;

/** Splits one ingest log into `{ at, text }` events, dropping the banner lines
 *  and the stray un-timestamped traceback rows the ingester echoes on failure.
 *  Un-timestamped lines are DROPPED rather than attached to the previous event:
 *  a traceback fragment is not a pipeline event and giving it a clock would let
 *  it be mistaken for one. */
export function logEvents(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const at = phoenixToIso(m[1], m[2]);
    if (!at) continue;
    out.push({ at, text: m[3].trim() });
  }
  return out;
}

const QUEUE_RE = /^queue:\s*([\d,]+)\s+books\s*\(\s*([\d,]+)\s*CPU\s*,\s*([\d,]+)\s*GPU\s*\)/i;
/** Python's repr picks the quote: a title containing an apostrophe is logged in
 *  DOUBLE quotes ("I'm Glad My Mom Died"). Both forms are matched, anchored on
 *  the trailing "(batch N)" so a title containing quotes cannot truncate it. */
const TRANSCRIBING_RE = /^transcribing\s+(['"])([\s\S]*)\1\s+\(batch\s+(\d+)\)\s*$/;
const OK_RE = /^OK\s+(.+?)\s{2,}([\d,]+)\s+chunks\b.*?->\s*text\/(.+?)\.json\.gz/;
const ERROR_RE = /^ERROR\s+(['"])([\s\S]*?)\1\s*:/;
const FAILED_RE = /^transcription FAILED\b/;

const num = (s) => Number(String(s).replace(/,/g, ''));

/**
 * The ingester's OWN queue line, newest wins.
 *
 * ⚠️ THIS IS THE ONLY MEASURED QUEUE DEPTH THERE IS. Re-deriving it would mean
 * re-implementing build_queue() — six tiers, a review join, a twin skip and an
 * additions-log read — in a second language, and a second implementation of a
 * decision is how two numbers start disagreeing. So this reads what the
 * pipeline already said out loud, and reports nothing when it has not said it.
 */
export function latestQueueLine(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const m = QUEUE_RE.exec(events[i].text);
    if (m) return { at: events[i].at, total: num(m[1]), cpu: num(m[2]), gpu: num(m[3]) };
  }
  return null;
}

/**
 * title ↔ book_id, measured off the OK lines of any ingest log.
 *
 * ingest_state.json keys books by slug and keeps no title, so without this the
 * history would render 157 hyphenated slugs. De-slugging them into Title Case
 * was the other option and it is a fabrication: it cannot restore an
 * apostrophe, a colon, or the difference between "MM" and "mm".
 */
export function titleMap(events) {
  const map = new Map();
  for (const ev of events) {
    const m = OK_RE.exec(ev.text);
    if (m) map.set(m[3], m[1].trim());
  }
  return map;
}

/**
 * The book being transcribed right now, or null.
 *
 * Two facts have to agree before this claims anything, because either alone
 * lies in a different direction:
 *
 *   the LOG says a "transcribing …" line has no matching completion after it —
 *     but a run killed by a reboot leaves exactly that line forever;
 *   the LOCK says a run holds the single-flight file — but a run can hold it
 *     while doing CPU-only packing with nothing on the GPU.
 *
 * ⚠️ A STALE LOCK IS NOT A LIVE RUN. app/tools/ingest_books.py steals a lock
 * older than LOCK_STALE_HOURS, so one older than that is evidence of a dead
 * run, and reading it as live would pin a book "in flight" on the owner's page
 * indefinitely.
 */
export function inFlightFromLog(events, lock, nowMs) {
  let start = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const m = TRANSCRIBING_RE.exec(events[i].text);
    if (m) {
      start = { at: events[i].at, title: m[2], batch: Number(m[3]), index: i };
      break;
    }
  }
  if (!start) return null;

  // Anything after it that ends a transcription ends THIS one — the newest
  // "transcribing" line is by construction the only unfinished candidate.
  for (let i = start.index + 1; i < events.length; i++) {
    const t = events[i].text;
    if (FAILED_RE.test(t)) return null;
    const ok = OK_RE.exec(t);
    if (ok && ok[1].trim() === start.title) return null;
    const err = ERROR_RE.exec(t);
    if (err && err[2] === start.title) return null;
  }

  if (!lock || !lock.present) return null;
  const heldMs = Number(lock.heldSinceMs);
  if (Number.isFinite(heldMs) && (nowMs - heldMs) / 3_600_000 >= LOCK_STALE_HOURS) return null;

  return { title: start.title, batch: start.batch, started_at: start.at };
}

/**
 * `transcribe_progress.json` → a validated live measurement, or null.
 *
 * Pure: takes the already-parsed object so every rejection path can be pinned
 * by a test without a filesystem.
 *
 * ⚠️ EVERY FIELD IS CHECKED, AND A BAD ONE COSTS ONLY ITSELF. A record with a
 * readable title but a nonsense percentage still names the book being
 * transcribed — dropping the whole row would trade a real fact for a missing
 * one. So `percent` is validated separately and simply omitted when it does not
 * survive; the row is dropped only when there is no book to name.
 *
 * ⚠️ `updated_at` IS THE ONLY CLOCK THAT COUNTS HERE. `started_at` dates the
 * run and can be hours old on a 20-hour audiobook; using it for staleness would
 * hide every long book. They are two different facts and the page shows both.
 */
export function readProgressRecord(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const source = typeof raw.source_m4b === 'string' ? raw.source_m4b.trim() : '';
  if (!title && !source) return null; // nothing to name the book with

  const updatedMs = Date.parse(raw.updated_at);
  // ⚠️ NO TIMESTAMP IS NOT "FRESH". A record whose age cannot be established
  // cannot be shown as live — that is the same rule the usage tiles follow.
  if (!Number.isFinite(updatedMs)) return null;
  if (nowMs - updatedMs > PROGRESS_STALE_MS) return null;
  // A clock skewed into the future is a broken clock, not a fresh reading.
  if (updatedMs - nowMs > PROGRESS_STALE_MS) return null;

  const out = {
    title: title || source,
    updated_at: new Date(updatedMs).toISOString(),
  };
  const startedMs = Date.parse(raw.started_at);
  if (Number.isFinite(startedMs)) out.started_at = new Date(startedMs).toISOString();

  // ⚠️ `typeof === 'number'` AND NOT `Number(...)`, and this is not pedantry:
  // `Number(null)` is 0, which is finite and inside 0–100, so a coercing check
  // turns "the writer could not compute a percentage" into a 0% bar reading
  // "this book has not started". The writer emits `percent: null` on purpose
  // when the container duration is unknown. Caught by a test, not by review.
  const pct = raw.percent;
  if (typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100) {
    out.percent = Math.round(pct * 10) / 10;
  }

  const done = raw.audio_seconds_done;
  const total = raw.container_duration_s;
  if (typeof done === 'number' && typeof total === 'number' && Number.isFinite(done) && Number.isFinite(total) && total > 0) {
    out.hours_done = done / 3600;
    out.hours_total = total / 3600;
  }
  return out;
}

/**
 * Queue depth per lane, from the ingester's CPU/GPU split plus the state file.
 *
 * The ingester counts two buckets; the owner asked for four lanes. The one
 * honest bridge between them is an EQUALITY CHECK: every needs-OCR PDF is CPU
 * work, so when the CPU bucket equals the needs-OCR count in the state file,
 * nothing else CPU-side is waiting and "0 EPUBs queued" is measured rather than
 * assumed. When they differ, the surplus is real CPU work of a kind this
 * function cannot name, and it is reported as its own row instead of being
 * silently folded into a lane it might not belong to.
 *
 * ⚠️ THE GPU BUCKET IS SPLIT INTO reviewed/rest ONLY WHEN THE INGESTER EXPORTS
 * THE SPLIT, and never otherwise. That split lives in build_queue()'s tier 4 vs
 * tier 5. Until 2026-08-18 it appeared nowhere on disk, so this file reported
 * the bucket whole and said the split was not knowable — the right answer then,
 * because a guessed `audiobook-with-review` count is exactly the invented figure
 * this surface exists to avoid.
 *
 * Now `app/tools/ingest_books.py` writes `estate-training-data/queue_summary.json`
 * at run start, counting build_queue()'s own tiers, and `splitAudiobookLane()`
 * below reads it. ⚠️ THE EXPORT IS STILL NOT TRUSTED ON SIGHT — it is a separate
 * artefact with its own clock and can describe a DIFFERENT queue than the log
 * line beside it (a `--cpu-only` or `--limit` run filters the work list the log
 * reports, and a summary left over from an earlier run describes a backlog that
 * has since moved). So the split is taken only when the export's own arithmetic
 * agrees with the measured GPU bucket, and the whole-bucket row is what happens
 * in every other case. Absent, stale, malformed and disagreeing all land on the
 * same safe answer, which is the pre-2026-08-18 behaviour unchanged.
 */

/**
 * The reviewed/rest rows for the GPU bucket, or null to report it whole.
 *
 * ⚠️ THE EQUALITY CHECK IS THE WHOLE GUARANTEE, and it is the same idiom the
 * CPU bucket uses below: two numbers computed by different code at different
 * moments are allowed to name one lane only when they agree. `reviewed + rest`
 * must equal the GPU bucket the ingester logged. If build_queue() gains a tier 7
 * that needs the GPU, this arithmetic stops matching and the page falls back to
 * the honest whole bucket instead of quietly under-reporting the backlog.
 */
function splitAudiobookLane(queue, summary) {
  if (!summary || typeof summary !== 'object') return null;
  const lanes = summary.lanes;
  if (!lanes || typeof lanes !== 'object') return null;

  const reviewed = lanes['audiobook-with-review'];
  const rest = lanes.audiobook;
  // ⚠️ `typeof === 'number'`, not `Number(...)`: `Number(null)` is 0, which
  // would turn "the exporter could not count this tier" into a measured zero.
  // Same trap readProgressRecord documents, same defence.
  if (typeof reviewed !== 'number' || !Number.isFinite(reviewed) || reviewed < 0) return null;
  if (typeof rest !== 'number' || !Number.isFinite(rest) || rest < 0) return null;
  if (reviewed + rest !== queue.gpu) return null;

  return [
    {
      lane: 'audiobook-with-review',
      count: reviewed,
      note:
        'Audiobooks somebody has reviewed — build_queue() tier 4, which runs BEFORE the ' +
        'rest of the shelf. Counted by the ingester at run start and checked against the ' +
        `GPU bucket it logged (${reviewed} + ${rest} = ${queue.gpu}).`,
    },
    {
      lane: 'audiobook',
      count: rest,
      note:
        'The rest of the audio shelf — build_queue() tier 5, transcribed after every ' +
        'reviewed book is done.',
    },
  ];
}

export function queueRows(queue, needsOcr, summary = null) {
  if (!queue) return [];
  const rows = [];
  const known = Number.isFinite(needsOcr) ? needsOcr : null;

  const split = splitAudiobookLane(queue, summary);
  if (split) {
    rows.push(...split);
  } else {
    rows.push({
      lane: 'audiobook',
      count: queue.gpu,
      note:
        "The ingester's GPU bucket — audiobooks still to transcribe. Which of them " +
        'have reviews (the tier that runs first) is decided inside build_queue() and ' +
        'the run that logged this queue did not export the split, so it is not split out here.',
    });
  }

  if (known !== null && queue.cpu === known) {
    rows.push({
      lane: 'deferred-pdf',
      count: known,
      note: 'Image-scan PDFs, held back by design. The OCR processor that would clear them is not built.',
    });
    rows.push({
      lane: 'epub',
      count: 0,
      note: `Measured, not assumed: the ingester's CPU bucket is ${queue.cpu} and all ${known} of those are the deferred PDFs, so no EPUB is waiting.`,
    });
    rows.push({
      lane: 'text-pdf',
      count: 0,
      note: 'Same measurement as the EPUB lane — the CPU bucket is fully accounted for by the deferred PDFs.',
    });
  } else {
    rows.push({
      lane: 'deferred-pdf',
      count: known,
      note:
        known === null
          ? 'From the state file, which did not answer — this is not a claim that none are waiting.'
          : 'Image-scan PDFs from the state file. The OCR processor that would clear them is not built.',
    });
    rows.push({
      lane: 'cpu-work-not-yet-classified',
      count: known === null ? queue.cpu : queue.cpu - known,
      note:
        `The ingester's CPU bucket is ${queue.cpu}` +
        (known === null ? '' : `, and ${known} of those are deferred PDFs`) +
        '. The remainder is real queued CPU work (EPUB / text-PDF / twin-satisfied audio) that this ' +
        'projection cannot split without re-implementing build_queue().',
    });
  }
  return rows;
}

/** A done book → one history row. `joined_at` is the state's `updated_at` and
 *  nothing else; the contract forbids deriving it from another clock. */
function historyRow(bookId, entry, titles) {
  const title = titles.get(bookId);
  const row = {
    id: bookId,
    title: title || bookId,
    joined_at: typeof entry.updated_at === 'string' ? entry.updated_at : undefined,
  };
  const lane = laneForSource(entry.source);
  if (lane) row.lane = lane;
  if (Number.isFinite(entry.chunks)) row.chunks = entry.chunks;
  if (entry.ingester_version !== undefined && entry.ingester_version !== null) {
    row.ingester_version = String(entry.ingester_version);
  }
  if (!title) {
    // ⚠️ Named, not quietly de-slugged. "the id is standing in for a title" is
    // a different fact from "this book is called that".
    row.note = 'no title recorded in any ingest log — showing the book id';
  }
  return row;
}

/**
 * The whole `processing` section.
 *
 * @param {object} input
 * @param {object} input.state          parsed ingest_state.json
 * @param {string} input.nightlyLog     output_files/ingest_nightly.log
 * @param {string} [input.cpuLog]       logs/cpu_ingest.log (titles for the backlog)
 * @param {object|null} [input.packIndex]  parsed packs/_index.json.gz
 * @param {object|null} [input.receipt]    the newest receipts/*.json
 * @param {object|null} [input.lock]       { present, heldSinceMs }
 * @param {object|null} [input.progress]   parsed work/transcribe_progress.json
 * @param {object|null} [input.queueSummary] parsed queue_summary.json — the
 *        ingester's own per-tier counts. Optional by design: absent means the
 *        audiobook lane is reported whole, never that a tier is empty.
 * @param {string} input.stateReadAt    ISO — when ingest_state.json was read
 * @param {number} input.nowMs
 * @param {number} [input.maxHistory]
 */
export function buildProcessingSection(input) {
  const {
    state = {},
    nightlyLog = '',
    cpuLog = '',
    packIndex = null,
    receipt = null,
    lock = null,
    progress = null,
    queueSummary = null,
    stateReadAt,
    nowMs,
    maxHistory = MAX_HISTORY,
  } = input;

  const books = state && typeof state.books === 'object' && state.books ? state.books : {};
  const nightly = logEvents(nightlyLog);
  const titles = titleMap([...logEvents(cpuLog), ...nightly]);

  // --- in flight -----------------------------------------------------------
  // ⚠️ THE PROGRESS FILE WINS OVER THE LOG, and the order is the design. The
  // log only ever sees the nightly; the progress file sees every transcription
  // including a hand-run chain, and it carries a measured percentage the log
  // cannot. The log stays as the fallback for the ~90 seconds between a book
  // starting and its first progress line, and for a run whose status write
  // failed (which is allowed to fail, and says so rather than stopping).
  const measured = readProgressRecord(progress, nowMs);
  const live = inFlightFromLog(nightly, lock, nowMs);
  const in_flight = [];
  if (measured) {
    const row = { title: measured.title, lane: 'audiobook', updated_at: measured.updated_at };
    if (measured.started_at) row.started_at = measured.started_at;
    // ⚠️ MEASURED, NOT ESTIMATED — transcribed span over container duration,
    // the same ratio the transcriber's truncation gate uses. This is the ONE
    // place a `percent` may be set, and only from a validated live record.
    if (measured.percent !== undefined) row.percent = measured.percent;
    const hours =
      measured.hours_total !== undefined
        ? `${measured.hours_done.toFixed(2)}h of ${measured.hours_total.toFixed(2)}h transcribed`
        : null;
    row.step = hours
      ? `transcribing on the GPU — ${hours}, measured from the model's own segment timestamps`
      : "transcribing on the GPU — the run reported progress but not how long the book is";
    in_flight.push(row);
  } else if (live) {
    in_flight.push({
      title: live.title,
      lane: 'audiobook',
      started_at: live.started_at,
      // ⚠️ NO `percent` KEY, and absent is not zero. The book has started but
      // has not yet published a measurement — the first progress line lands
      // about 90 seconds in, after the model loads.
      step:
        `transcribing on the GPU (batch ${live.batch}) — no measurement published yet; the ` +
        'worker reports progress once a minute and the first line lands after the model loads',
    });
  }

  // --- counts --------------------------------------------------------------
  let packed = 0;
  let needsOcr = 0;
  let failed = 0;
  let chunks = 0;
  let versions = new Set();
  for (const entry of Object.values(books)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.status === 'done') {
      packed++;
      if (Number.isFinite(entry.chunks)) chunks += entry.chunks;
      if (entry.ingester_version !== undefined && entry.ingester_version !== null) {
        versions.add(String(entry.ingester_version));
      }
    } else if (entry.status === 'needs-ocr') needsOcr++;
    else if (entry.status === 'failed') failed++;
  }

  // --- history -------------------------------------------------------------
  const all = Object.entries(books)
    .filter(([, e]) => e && e.status === 'done')
    .map(([id, e]) => historyRow(id, e, titles))
    .sort((a, b) => (Date.parse(b.joined_at || '') || 0) - (Date.parse(a.joined_at || '') || 0));
  const history = all.slice(0, maxHistory);
  const dropped = all.length - history.length;

  // --- packs ---------------------------------------------------------------
  // ⚠️ ONE SECTION, TWO CLOCKS, AND THE NOTE NAMES BOTH. The counts are the
  // state file's, as of `as_of`; the published manifest is a separate artefact
  // with its own `generated_at` that can lag by hours. Showing the two under a
  // single timestamp would silently promote the older one.
  const packs = { packed, needs_ocr: needsOcr, chunks, as_of: stateReadAt };
  if (packIndex && Number.isFinite(packIndex.count)) packs.books = packIndex.count;
  const version =
    (receipt && receipt.ingester_version !== undefined && receipt.ingester_version !== null
      ? String(receipt.ingester_version)
      : null) ||
    (packIndex && packIndex.ingester_version !== undefined && packIndex.ingester_version !== null
      ? String(packIndex.ingester_version)
      : null) ||
    (versions.size === 1 ? [...versions][0] : null);
  if (version) packs.ingester_version = version;

  const notes = [`Counts read from ingest_state.json (${packed} packed of ${Object.keys(books).length} books it tracks)`];
  if (packIndex && packIndex.generated_at) {
    notes.push(`published pack index generated ${packIndex.generated_at}, listing ${packIndex.count ?? '?'} books`);
  }
  if (failed) notes.push(`${failed} book${failed === 1 ? '' : 's'} failed and ${failed === 1 ? 'is' : 'are'} not in the knowledge base`);
  if (versions.size > 1) notes.push(`⚠️ packs span ingester versions ${[...versions].sort().join(', ')} — they are not interchangeable`);
  if (dropped) notes.push(`the ${dropped} oldest history rows were trimmed by the pusher to stay inside the board size cap`);
  // ⚠️ THIS SENTENCE WAS WRONG BEFORE THE TEE and is worth keeping accurate:
  // the in-flight card now reads the transcriber's own progress file, which
  // every invocation path writes, so a hand-run chain DOES appear. The queue
  // and history still come from the nightly's log and state, and that
  // difference is exactly what the reader needs to know.
  notes.push(
    "Books in flight come from the transcriber's own progress file, so a hand-run chain shows up too; the " +
      'queue and history below are the nightly ingester\'s',
  );
  packs.note = `${notes.join('. ')}.`;

  return {
    in_flight,
    queue: queueRows(latestQueueLine(nightly), needsOcr, queueSummary),
    packs,
    history,
  };
}
