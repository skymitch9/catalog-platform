/**
 * Firestore REST document helpers for the Phase 3 write routes — the thin
 * layer between the route handlers and @platform/firebase-sa's raw
 * `firestoreRequest`.
 *
 * ## Raw-fields discipline (the round-trip hazard, avoided by construction)
 *
 * Read-modify-write here operates on RAW Firestore `Value` objects and
 * PATCHes ONLY the fields it changes (updateMask), never re-encoding a whole
 * document. A whole-doc JS⇄Firestore round trip would silently mangle any
 * value type the converter doesn't know (bytes, references, geopoints,
 * server timestamps already stored) — so `toFsValue` exists ONLY for values
 * this Worker authors itself, and everything read from a doc stays in wire
 * format until a targeted accessor (`fsString`, `fsStringArray`) pulls the
 * one field a decision needs.
 *
 * ## Optimistic concurrency where the browser used a transaction
 *
 * clubs.js guards its array read-modify-writes (memberSlugs, invitedSlugs,
 * activeSlots) with runTransaction. The REST mirror is the
 * `currentDocument.updateTime` precondition: GET the doc, compute the new
 * fields, PATCH conditioned on the updateTime still matching, retry on
 * FAILED_PRECONDITION — same effect (no lost update), no transaction API.
 */

import { firestoreRequest, type ServiceAccount } from '@platform/firebase-sa';

/* ── value encoding (authoring only — see the module doc) ─────────────── */

export type FsValue = Record<string, unknown>;

export type JsValue =
  | string
  | number
  | boolean
  | null
  | Date
  | JsValue[]
  | { [key: string]: JsValue };

/** JS → Firestore REST Value, for values this Worker authors itself. */
export function toFsValue(v: JsValue): FsValue {
  if (v === null) return { nullValue: 'NULL_VALUE' };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  return { mapValue: { fields: toFsFields(v) } };
}

export function toFsFields(obj: { [key: string]: JsValue }): Record<string, FsValue> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toFsValue(v)]));
}

/* ── targeted accessors for RAW doc fields ────────────────────────────── */

export type FsFields = Record<string, FsValue> | undefined;

export function fsString(fields: FsFields, key: string): string | null {
  const v = fields?.[key];
  return v && typeof v['stringValue'] === 'string' ? (v['stringValue'] as string) : null;
}

export function fsStringArray(fields: FsFields, key: string): string[] {
  const v = fields?.[key] as
    | { arrayValue?: { values?: Array<{ stringValue?: string }> } }
    | undefined;
  return (v?.arrayValue?.values ?? [])
    .map((x) => x.stringValue)
    .filter((s): s is string => typeof s === 'string');
}

/** The keys of a raw mapValue field ({} when absent/not a map). */
export function fsMapKeys(fields: FsFields, key: string): string[] {
  const v = fields?.[key] as { mapValue?: { fields?: Record<string, unknown> } } | undefined;
  return Object.keys(v?.mapValue?.fields ?? {});
}

/** A raw arrayValue field's values, still in wire format ([] when absent). */
export function rawArrayValues(fields: FsFields, key: string): FsValue[] {
  const v = fields?.[key] as { arrayValue?: { values?: FsValue[] } } | undefined;
  return v?.arrayValue?.values ?? [];
}

/** A raw mapValue's inner fields (null when the value is not a map). */
export function mapValueFields(v: FsValue | undefined): Record<string, FsValue> | null {
  const m = v as { mapValue?: { fields?: Record<string, FsValue> } } | undefined;
  return m?.mapValue?.fields ?? null;
}

/** A raw Value's scalar, for comparisons (slot equality, position sort). */
export function fsScalar(v: FsValue | undefined): string | number | boolean | null {
  if (!v) return null;
  if (typeof v['stringValue'] === 'string') return v['stringValue'] as string;
  if (typeof v['booleanValue'] === 'boolean') return v['booleanValue'] as boolean;
  if (typeof v['integerValue'] === 'string') return Number(v['integerValue']);
  if (typeof v['doubleValue'] === 'number') return v['doubleValue'] as number;
  return null;
}

/* ── updateMask field paths ───────────────────────────────────────────── */

const PLAIN_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Backtick-quote any segment that is not a plain identifier (uids, slugs). */
export function quoteFieldPath(segments: string[]): string {
  return segments
    .map((s) => (PLAIN_SEGMENT.test(s) ? s : `\`${s.replace(/([`\\])/g, '\\$1')}\``))
    .join('.');
}

/* ── document operations ──────────────────────────────────────────────── */

export interface FsDoc {
  fields: Record<string, FsValue>;
  updateTime: string;
}

export type FsResult<T> = { ok: true; value: T } | { ok: false; status: number };

/** GET a document. `value: null` = 404 (a legal state, not an error). */
export async function getFsDoc(
  sa: ServiceAccount,
  token: string,
  path: string,
): Promise<FsResult<FsDoc | null>> {
  const res = await firestoreRequest(sa, token, 'GET', path);
  if (res.status === 404) return { ok: true, value: null };
  if (!res.ok) return { ok: false, status: res.status };
  const doc = (await res.json()) as { fields?: Record<string, FsValue>; updateTime?: string };
  return { ok: true, value: { fields: doc.fields ?? {}, updateTime: doc.updateTime ?? '' } };
}

export interface PatchOptions {
  /** Merge only these paths; omitted = full-document replace (setDoc). */
  fieldPaths?: string[];
  /** Precondition: fail unless the doc's updateTime still matches. */
  ifUpdateTime?: string;
}

/** PATCH a document (merge with updateMask, or full replace without). */
export async function patchFsDoc(
  sa: ServiceAccount,
  token: string,
  path: string,
  fields: Record<string, FsValue>,
  opts: PatchOptions = {},
): Promise<FsResult<true>> {
  const params = new URLSearchParams();
  for (const fp of opts.fieldPaths ?? []) params.append('updateMask.fieldPaths', fp);
  if (opts.ifUpdateTime) params.set('currentDocument.updateTime', opts.ifUpdateTime);
  const qs = params.toString();
  const res = await firestoreRequest(sa, token, 'PATCH', qs ? `${path}?${qs}` : path, { fields });
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, value: true };
}

export async function deleteFsDoc(
  sa: ServiceAccount,
  token: string,
  path: string,
): Promise<FsResult<true>> {
  const res = await firestoreRequest(sa, token, 'DELETE', path);
  // Firestore's delete is idempotent (deleting a missing doc succeeds) —
  // mirror that: only a real error is a failure.
  if (!res.ok && res.status !== 404) return { ok: false, status: res.status };
  return { ok: true, value: true };
}

/** CREATE with an auto id (addDoc). Returns the new document id. */
export async function createFsDoc(
  sa: ServiceAccount,
  token: string,
  collectionPath: string,
  fields: Record<string, FsValue>,
): Promise<FsResult<string>> {
  const res = await firestoreRequest(sa, token, 'POST', collectionPath, { fields });
  if (!res.ok) return { ok: false, status: res.status };
  const doc = (await res.json()) as { name?: string };
  const id = (doc.name ?? '').split('/').pop() ?? '';
  return { ok: true, value: id };
}

/** List every document id in a collection (paged; cleanup loops). */
export async function listFsDocIds(
  sa: ServiceAccount,
  token: string,
  collectionPath: string,
): Promise<FsResult<string[]>> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: '300' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await firestoreRequest(sa, token, 'GET', `${collectionPath}?${params}`);
    if (!res.ok) return { ok: false, status: res.status };
    const data = (await res.json()) as {
      documents?: Array<{ name?: string }>;
      nextPageToken?: string;
    };
    for (const d of data.documents ?? []) {
      const id = (d.name ?? '').split('/').pop();
      if (id) ids.push(id);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { ok: true, value: ids };
}

/* ── read-modify-write with the updateTime precondition ───────────────── */

export type RmwCompute =
  | { patch: { fields: Record<string, FsValue>; fieldPaths: string[] } }
  /** The mirror of a client transaction throwing: refuse with a worded message. */
  | { refuse: { status: number; error: string; detail: string } }
  /** Nothing to change (idempotent path) — succeed without writing. */
  | { noop: true };

export type RmwResult =
  | { ok: true; refused: null }
  | { ok: true; refused: { status: number; error: string; detail: string } }
  | { ok: false; status: number };

/**
 * The transaction mirror: GET → compute → PATCH conditioned on updateTime,
 * retried on FAILED_PRECONDITION (a concurrent writer moved the doc — the
 * same reread runTransaction would do). `compute` receives null when the doc
 * does not exist; returning `refuse` surfaces a domain refusal ("Club not
 * found.", "The host cannot be removed.") without retry.
 */
export async function readModifyWrite(
  sa: ServiceAccount,
  token: string,
  docPath: string,
  compute: (doc: FsDoc | null) => RmwCompute,
  attempts = 3,
): Promise<RmwResult> {
  for (let i = 0; i < attempts; i += 1) {
    const read = await getFsDoc(sa, token, docPath);
    if (!read.ok) return { ok: false, status: read.status };
    const decision = compute(read.value);
    if ('refuse' in decision) return { ok: true, refused: decision.refuse };
    if ('noop' in decision) return { ok: true, refused: null };
    const patched = await patchFsDoc(sa, token, docPath, decision.patch.fields, {
      fieldPaths: decision.patch.fieldPaths,
      ...(read.value ? { ifUpdateTime: read.value.updateTime } : {}),
    });
    if (patched.ok) return { ok: true, refused: null };
    // FAILED_PRECONDITION arrives as 400 (and ABORTED as 409) — retry both;
    // anything else is a real error.
    if (patched.status !== 400 && patched.status !== 409) {
      return { ok: false, status: patched.status };
    }
  }
  return { ok: false, status: 409 };
}

/* ── lane helpers ─────────────────────────────────────────────────────── */

export type Lane = 'prod' | 'dev';

/** `?lane=dev` opts into the dev twin; anything else is prod — never guessed wider. */
export function laneFrom(raw: string | undefined): Lane {
  return raw === 'dev' ? 'dev' : 'prod';
}

/** reviews / reviews_dev (design §1: every family has a `_dev` twin). */
export function reviewsCollectionFor(lane: Lane): string {
  return lane === 'dev' ? 'reviews_dev' : 'reviews';
}
