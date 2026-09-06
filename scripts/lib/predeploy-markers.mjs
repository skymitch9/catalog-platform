/**
 * predeploy-markers — the ONE implementation of a predeploy.checks.json marker
 * assertion, and the map from a live path to the file that serves it.
 *
 * WHY IT IS A MODULE AND NOT TWO COPIES (2026-09-05).
 * `predeploy.checks.json`'s markers were asserted in exactly one place: the
 * `--live` phase, which runs AFTER `wrangler pages deploy`. So a marker that
 * was wrong — a renamed id, a re-worded sentence, a pin left on a file the
 * logic moved out of — was discovered with the page already public, and the
 * only remedy was another deploy. Measured 2026-09-05 by the apex build: a
 * throwaway version of this check caught EIGHT markers that would have failed
 * the live run, six of them written minutes earlier.
 *
 * The static run now asserts the same strings against the WORKING TREE first,
 * and it is the same code doing it — `markerProblems()` takes a body, never a
 * source. Two implementations of "does this string appear" is two chances for
 * the pre-deploy gate to disagree with the post-deploy one, and a gate that
 * disagrees with its own verifier teaches people to ignore both.
 *
 * ⚠️ THE STATIC RUN IS NOT A SUBSTITUTE FOR THE LIVE RUN, and neither replaces
 * the other. This one proves the string is in the file a deploy WOULD upload;
 * `--live` proves the string is in the bytes the host ACTUALLY serves — which
 * is the only thing that catches a failed upload, a stale edge cache, or a
 * `_headers`/redirect rule serving something else entirely. Shipped is still
 * not verified.
 */

import { join } from 'node:path';

/**
 * The file under `public/` that serves a live path.
 *
 * Cloudflare Pages serves a directory path from its `index.html`, so `/` is
 * `index.html` and `/status/` is `status/index.html`; anything else is the
 * asset itself (`/assets/theme.js` → `assets/theme.js`). A query string is
 * dropped — the config does not use one today, and a path that grew one would
 * otherwise silently resolve to a file that cannot exist.
 */
export function fileForPath(publicDir, path) {
  const clean = String(path).split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (clean === '' || clean.endsWith('/')) return join(publicDir, clean, 'index.html');
  return join(publicDir, clean);
}

/**
 * Every marker in `page` that `body` gets wrong, in config order.
 *
 * Returns DATA, never a message: the two callers word a failure differently
 * (one is looking at a file on disk, the other at a 200 from the live host)
 * and the decision of what counts as a problem must not fork with the wording.
 * `{ kind: 'missing' }` = a `mustContain` that is absent;
 * `{ kind: 'present' }` = a `mustNotContain` that is still there.
 */
export function markerProblems(body, page) {
  const problems = [];
  for (const marker of page.mustContain ?? []) {
    if (!body.includes(marker)) problems.push({ kind: 'missing', marker });
  }
  for (const marker of page.mustNotContain ?? []) {
    if (body.includes(marker)) problems.push({ kind: 'present', marker });
  }
  return problems;
}

/**
 * One problem, in words, naming the marker AND the config entry that pins it —
 * so the fix is "go and look at that entry", not "grep the repo for a string".
 */
export function markerMessage(problem, pagePath) {
  const marker = JSON.stringify(problem.marker);
  return problem.kind === 'missing'
    ? `is MISSING the marker ${marker}, which predeploy.checks.json pins for ${pagePath}.`
    : `STILL CARRIES ${marker}, which predeploy.checks.json says must be GONE from ${pagePath}.`;
}
