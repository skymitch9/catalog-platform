/**
 * The public Firestore document `pipeline_status/current` (project
 * `audiobook-catalog`), read over the plain REST API with no key and no
 * Firebase SDK — `firestore.rules` sets `allow read: if true` on this one
 * document deliberately (status.js's FIRESTORE_STATUS_URL comment explains
 * why: "nobody can forge a run" is the write-side control, the read side was
 * already open for the admin panel). A signed-out GET is the whole probe.
 */

import { get, check } from '../lib/kit.mjs';
import { FIRESTORE_STATUS_URL, SHELF_UPLOAD_STATUS_URL } from '../lib/origins.mjs';

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

  // shelf_upload_status/current (2026-08-16, the force-upload control's own
  // doc) — legitimately 404 until the shelf server exists and the control
  // has run once, so this checks the READ is PERMITTED (200 or 404), never
  // that a document exists. A Firestore permission-denied answers with its
  // own JSON error shape at a 403/401-ish status, not a plain 404 — that is
  // the one outcome this asserts against.
  const rs = await get(SHELF_UPLOAD_STATUS_URL);
  if (!rs.ok) {
    check(AREA, 'F4', 'GET', SHELF_UPLOAD_STATUS_URL, 'read permitted (200 or 404, never denied)', false, `request failed: ${rs.error}`);
  } else {
    const permitted = rs.status === 200 || rs.status === 404;
    check(
      AREA,
      'F4',
      'GET',
      SHELF_UPLOAD_STATUS_URL,
      'read permitted — 200 (a force-upload has run) or 404 (never run yet), never permission-denied',
      permitted,
      `status=${rs.status} body head: ${rs.text.slice(0, 200)}`,
    );
  }
}
