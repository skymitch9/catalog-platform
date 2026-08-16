/**
 * audiobooks.heygabi.ai — the static audiobook site. No Worker, no auth
 * surface: `/ebooks.json` is the ebook-lane manifest (sync step 1b's own
 * output), CORS-open by the site's own hosting config, read the same way
 * `sites/heygabi-home/public/status/status.js` (EBOOKS_MANIFEST_URL) does.
 */

import { get, check } from '../lib/kit.mjs';
import { EBOOKS_MANIFEST_URL } from '../lib/origins.mjs';

const AREA = 'audiobooks';

export async function probeAudiobooks() {
  const r = await get(EBOOKS_MANIFEST_URL);
  if (!r.ok) {
    check(AREA, 'E1', 'GET', EBOOKS_MANIFEST_URL, 'answers 200', false, `request failed: ${r.error}`);
    return;
  }
  check(AREA, 'E1', 'GET', EBOOKS_MANIFEST_URL, 'answers 200', r.status === 200, `status=${r.status}`);

  const body = r.json;
  check(AREA, 'E2', 'GET', EBOOKS_MANIFEST_URL, 'body parses as JSON', body !== null, `text head: ${r.text.slice(0, 120)}`);
  if (body !== null) {
    check(AREA, 'E3', 'GET', EBOOKS_MANIFEST_URL, 'has generated_at (string)', typeof body.generated_at === 'string', `generated_at=${JSON.stringify(body.generated_at)}`);
    check(AREA, 'E4', 'GET', EBOOKS_MANIFEST_URL, 'has count (number)', typeof body.count === 'number', `count=${JSON.stringify(body.count)}`);
  }
}
