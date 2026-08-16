/**
 * The public Firestore document `pipeline_status/current` (project
 * `audiobook-catalog`), read over the plain REST API with no key and no
 * Firebase SDK — `firestore.rules` sets `allow read: if true` on this one
 * document deliberately (status.js's FIRESTORE_STATUS_URL comment explains
 * why: "nobody can forge a run" is the write-side control, the read side was
 * already open for the admin panel). A signed-out GET is the whole probe.
 */

import { get, check } from '../lib/kit.mjs';
import { FIRESTORE_STATUS_URL } from '../lib/origins.mjs';

const AREA = 'firestore';

export async function probeFirestore() {
  const r = await get(FIRESTORE_STATUS_URL);
  if (!r.ok) {
    check(AREA, 'F1', 'GET', FIRESTORE_STATUS_URL, 'answers 200', false, `request failed: ${r.error}`);
    return;
  }
  check(AREA, 'F1', 'GET', FIRESTORE_STATUS_URL, 'answers 200 (unauthenticated REST GET)', r.status === 200, `status=${r.status} body head: ${r.text.slice(0, 200)}`);

  const body = r.json;
  check(AREA, 'F2', 'GET', FIRESTORE_STATUS_URL, 'body parses as JSON', body !== null, `text head: ${r.text.slice(0, 200)}`);
  if (body !== null) {
    check(
      AREA,
      'F3',
      'GET',
      FIRESTORE_STATUS_URL,
      'has fields (Firestore REST document shape)',
      typeof body.fields === 'object' && body.fields !== null,
      `keys=${Object.keys(body).join(',')}`,
    );
  }
}
