#!/usr/bin/env node
/**
 * Report a Claude usage reading to the estate status page.
 *
 * Owner ask 2026-08-21: *"Add credit usage to the website too… the whole usage
 * message you sent now in bold put that in the status page."*
 *
 * ⚠️ THIS SCRIPT DOES NOT READ THE METERS, AND CANNOT. The figures live on
 * claude.ai/settings/usage behind the owner's own login, in a modal that page
 * extraction does not see; they are read by a Claude session driving a real
 * browser. This is the pipe from that reading to the page, and nothing more.
 * If a future version ever looks like it is "working the numbers out", that is
 * the bug — an invented figure that renders as a measurement is the precise
 * failure the whole surface exists to prevent.
 *
 * ⚠️ POST IT IMMEDIATELY AFTER READING. The Worker stamps its own
 * `received_at` and refuses to take the sender's word for when the meter was
 * read (a clock we do not control cannot be part of a staleness rule). So the
 * age shown on the page is the age of THIS CALL — run it in the same breath as
 * the read, never from notes.
 *
 * ## Usage
 *
 *   CLAUDE_USAGE_TOKEN=clu_... node scripts/report-claude-usage.mjs \
 *     --session 2 --weekly 93 --fable 94 --credits 63 \
 *     --spent 62.93 \
 *     --session-resets "Resets in 4 hr 20 min" \
 *     --weekly-resets "Resets Sun 3:59 PM"
 *
 * `--dry-run` prints the exact body and posts nothing.
 *
 * The token is minted at <https://heygabi.ai/status/api> (devops sign-in) and
 * shown once. There is no legacy fallback: until it is installed, nothing can
 * report, and the page correctly says "never reported" rather than guessing.
 */

const API = process.env.ESTATE_AUTH_ORIGIN || 'https://auth.heygabi.ai';
const TOKEN = process.env.CLAUDE_USAGE_TOKEN;

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');

function arg(name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * ⚠️ WHOLE PERCENT ONLY, and the refusal is deliberate rather than lenient.
 * The meters display whole numbers; anything fractional cannot have been read
 * off the page, only computed. The Worker rejects it too — this check exists
 * so the mistake is caught before it becomes an HTTP round trip and a confusing
 * 400, not because the client is trusted.
 */
function pct(name) {
  const raw = arg(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    console.error(`--${name} must be a whole number 0-100 as shown on the usage page (got "${raw}").`);
    process.exit(2);
  }
  return n;
}

const session_pct = pct('session');
const weekly_pct = pct('weekly');
const fable_pct = pct('fable');
const credits_pct = pct('credits');

for (const [flag, v] of [['session', session_pct], ['weekly', weekly_pct], ['fable', fable_pct], ['credits', credits_pct]]) {
  if (v === undefined) {
    console.error(
      `--${flag} is required. All four meters are reported together on purpose: a partial reading would ` +
        `leave one bar showing an older number beside three fresh ones, which is the stale-figure trap in miniature.`,
    );
    process.exit(2);
  }
}

const body = { session_pct, weekly_pct, fable_pct, credits_pct };

const spent = arg('spent');
if (spent !== undefined) {
  // Money in whole cents — never a float carried through JSON and rounded on
  // the far side. "$62.93" in, 6293 stored.
  const cents = Math.round(Number(spent) * 100);
  if (!Number.isFinite(cents) || cents < 0) {
    console.error(`--spent must be a dollar amount, e.g. --spent 62.93 (got "${spent}").`);
    process.exit(2);
  }
  body.credits_spent_cents = cents;
}

for (const [flag, field] of [
  ['session-resets', 'session_resets'],
  ['weekly-resets', 'weekly_resets'],
  ['credits-resets', 'credits_resets'],
]) {
  const v = arg(flag);
  // Verbatim from the page — the Worker stores the string as-is and the page
  // renders it with textContent. Do not reformat it here; a reworded label is
  // a label somebody has to reconcile against the source.
  if (v) body[field] = v;
}

if (DRY) {
  console.log(JSON.stringify(body, null, 2));
  console.log('\n--dry-run: nothing was posted.');
  process.exit(0);
}

if (!TOKEN) {
  console.error(
    'CLAUDE_USAGE_TOKEN is not set. Mint one at https://heygabi.ai/status/api (devops sign-in) — the value is\n' +
      'shown once — then set it in this environment. Run with --dry-run to check the body without a token.',
  );
  process.exit(1);
}

const res = await fetch(`${API}/api/estate/claude/usage`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const text = await res.text();
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  parsed = null;
}

if (!res.ok) {
  // ⚠️ Print what the Worker actually said. Its refusals name the credential
  // and the fix on purpose; swallowing them for a tidy "failed" would throw
  // away the only thing that tells you which of four causes this was.
  console.error(`Report REFUSED (HTTP ${res.status}).`);
  if (parsed?.detail) console.error(parsed.detail);
  if (parsed?.fix) console.error(`Fix: ${parsed.fix}`);
  if (!parsed) console.error(text.slice(0, 500));
  process.exit(1);
}

console.log(
  `Reported: session ${session_pct}% · weekly ${weekly_pct}% · Fable ${fable_pct}% · credits ${credits_pct}%` +
    ` — state "${parsed?.state ?? 'unknown'}", stamped ${parsed?.received_at ?? '(no timestamp returned)'}.`,
);
// ⚠️ Surfaced, not swallowed: a rotation nobody finished is otherwise only
// visible on a page nobody has open.
if (parsed?.key && parsed.key !== 'current') {
  console.log(`Key: ${parsed.key}`);
}
console.log('See it at https://heygabi.ai/status/ (devops sign-in).');
