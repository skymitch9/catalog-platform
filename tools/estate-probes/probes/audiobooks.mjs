/**
 * audiobooks.heygabi.ai — the static audiobook site, plus the one gated
 * endpoint that now lives beside it.
 *
 * ⚠️ REWRITTEN 2026-08-17, and the reason is the point. These probes used to
 * assert that `/ebooks.json` answers 200 with a manifest. That file is now
 * GATED (owner directive: "I don't want people scraping my books") — so from
 * that day the old assertions were asserting the leak. Worse: they kept
 * PASSING for a while afterwards, against a Cloudflare EDGE-CACHED copy of the
 * file the deploy had just stripped. ⚠️ **A green probe against a stale cache
 * is not evidence**, so every check below cache-busts.
 *
 * What is checked now:
 *   E1–E4  the public FRESHNESS HEARTBEAT (`ebooks_status.json`) — counts and
 *          times, the one operational question /status asks, no book named.
 *   E5–E7  the legacy manifest url must NOT answer with a manifest.
 *   E8–E9  the gated endpoint refuses an unauthenticated caller, in words.
 */

import { get, check } from '../lib/kit.mjs';
import {
  EBOOKS_HEARTBEAT_URL,
  EBOOKS_MANIFEST_GATED_URL,
  EBOOKS_MANIFEST_LEGACY_URL,
} from '../lib/origins.mjs';

const AREA = 'audiobooks';

/** ⚠️ Never probe these bare — see the header. */
const bust = (url) => `${url}${url.includes('?') ? '&' : '?'}probe=${Date.now()}`;

export async function probeAudiobooks() {
  // --- E1–E4: the public heartbeat ------------------------------------------
  const h = await get(bust(EBOOKS_HEARTBEAT_URL));
  if (!h.ok) {
    check(AREA, 'E1', 'GET', EBOOKS_HEARTBEAT_URL, 'answers 200', false, `request failed: ${h.error}`);
  } else {
    // ⚠️ 200 alone is NOT the assertion. Cloudflare Pages answers a missing
    // path with the SPA fallback at 200, so a deleted heartbeat would sail
    // through a status-code check while the page fell back to 9 MB of HTML.
    check(
      AREA, 'E1', 'GET', EBOOKS_HEARTBEAT_URL,
      'answers 200 with JSON — not the SPA fallback a missing file would give',
      h.status === 200 && h.json !== null,
      `status=${h.status} first bytes: ${h.text.slice(0, 40)}`,
    );
    const body = h.json;
    check(AREA, 'E2', 'GET', EBOOKS_HEARTBEAT_URL, 'body parses as JSON', body !== null, `text head: ${h.text.slice(0, 120)}`);
    if (body !== null) {
      check(AREA, 'E3', 'GET', EBOOKS_HEARTBEAT_URL, 'has generated_at (string)', typeof body.generated_at === 'string', `generated_at=${JSON.stringify(body.generated_at)}`);
      // ⚠️ The heartbeat must carry NO book data. A probe is exactly the right
      // place for this: the file is public BY DESIGN, so the only thing between
      // it and a leak is what the publisher chooses to put in it.
      check(
        AREA, 'E4', 'GET', EBOOKS_HEARTBEAT_URL,
        'counts and times ONLY — never an `ebooks` array or a needs_human_cover entry',
        !Array.isArray(body.ebooks) && !Array.isArray(body.needs_human_cover),
        `keys=${Object.keys(body).join(',')}`,
      );
    }
  }

  // --- E5–E7: the legacy url must not serve the shelf ------------------------
  // ⚠️ Cloudflare Pages answers a MISSING path with the SPA fallback at 200,
  // so the status code proves nothing here. What is asserted is that the BODY
  // is not a manifest.
  const legacy = await get(bust(EBOOKS_MANIFEST_LEGACY_URL));
  if (!legacy.ok) {
    check(AREA, 'E5', 'GET', EBOOKS_MANIFEST_LEGACY_URL, 'reachable (a request error is not a pass)', false, `request failed: ${legacy.error}`);
  } else {
    const body = legacy.json;
    check(
      AREA, 'E5', 'GET', EBOOKS_MANIFEST_LEGACY_URL,
      'does NOT answer with an ebook manifest — the shelf is gated',
      body === null || !Array.isArray(body.ebooks),
      `status=${legacy.status} entries=${body && Array.isArray(body.ebooks) ? body.ebooks.length : 'none'}`,
    );
    check(
      AREA, 'E6', 'GET', EBOOKS_MANIFEST_LEGACY_URL,
      'does NOT leak the needs_human_cover list (it names files)',
      body === null || !Array.isArray(body.needs_human_cover),
      `status=${legacy.status}`,
    );
    // ⚠️ Scoped to a JSON body deliberately. When the file is absent Pages
    // serves the catalog SPA, whose own HTML legitimately mentions `.epub`
    // and `.pdf` — asserting on that body would fail forever on the CORRECT
    // state. The question is only ever "does the MANIFEST leak paths", so it
    // is asked only when a manifest-shaped body came back at all.
    check(
      AREA, 'E7', 'GET', EBOOKS_MANIFEST_LEGACY_URL,
      'if any JSON comes back at all, it carries no `.epub` / `.pdf` path',
      body === null || !/\.epub|\.pdf/i.test(legacy.text.slice(0, 200000)),
      body === null ? 'not JSON — the SPA fallback, i.e. the file is gone (correct)' : `first bytes: ${legacy.text.slice(0, 80)}`,
    );
  }

  // --- E8–E9: the gate itself, unauthenticated -------------------------------
  const gated = await get(EBOOKS_MANIFEST_GATED_URL);
  if (!gated.ok) {
    check(AREA, 'E8', 'GET', EBOOKS_MANIFEST_GATED_URL, 'answers 401 unauthenticated', false, `request failed: ${gated.error}`);
  } else {
    check(
      AREA, 'E8', 'GET', EBOOKS_MANIFEST_GATED_URL,
      'answers 401 { error: "unauthenticated" } to a tokenless caller',
      gated.status === 401 && gated.json?.error === 'unauthenticated',
      `status=${gated.status} error=${gated.json?.error}`,
    );
    check(
      AREA, 'E9', 'GET', EBOOKS_MANIFEST_GATED_URL,
      'the refusal is a SENTENCE, not a bare status (§1e), and carries no shelf',
      typeof gated.json?.detail === 'string' && gated.json.detail.length > 20 && !Array.isArray(gated.json?.ebooks),
      `detail=${JSON.stringify(gated.json?.detail ?? null).slice(0, 120)}`,
    );
  }
}
