/**
 * notifications.test.ts — phase 4 of "+ add a verse": the notice a requester
 * gets when somebody decides their request.
 *
 * ⚠️ THE TESTS THAT MATTER HERE ARE THE ONES ABOUT NOT SENDING. A notifier's
 * failures are all quiet: it writes to the wrong person, it ignores an opt-out,
 * it invents a recipient for a row that has none, or it throws inside a
 * decision that had already been written and turns a completed approval into a
 * 502. Each of those has a test below, and the happy path has two.
 *
 * ⚠️ Identity is chosen by `DEV_EMAIL` — `resolveIdentity()`'s dev bypass fires
 * on `ENVIRONMENT === 'development'`, so each helper passes the actor's email
 * in the env rather than minting Firebase tokens. Same shape as
 * universe-requests.test.ts.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MEMBER_NOTICE_CLASSES,
  NOTICES_PER_USER,
  classOf,
  defaultMemberPrefs,
  notificationRoutes,
  parseMemberPrefs,
  parseMemberPrefsBody,
  userPrefsKey,
  verseNotice,
  writeNotice,
} from '../src/notifications.js';

const OWNER = 'owner@example.com';
const MEMBER = 'member@example.com';
const OTHER = 'other@example.com';
const PENDING = 'pending@example.com';

interface UserRow {
  id: number;
  email: string;
  firebase_uid: string | null;
  display_name: string | null;
  status: string;
  is_approver: number;
  is_devops: number;
  dev_access: number;
  origin: string;
  note: string | null;
  first_seen_at: string;
  decided_at: string | null;
  decided_by: number | null;
  vis_audiobook: number;
  vis_library: number;
  vis_games: number;
  vis_library2: number;
  vis_ebooks: number;
}

interface NoticeRow {
  id: number;
  user_id: number;
  kind: string;
  subject: string;
  body: string;
  link: string | null;
  source: string | null;
  source_id: number | null;
  created_at: string;
  read_at: string | null;
}

function user(id: number, email: string, over: Partial<UserRow> = {}): UserRow {
  return {
    id,
    email,
    firebase_uid: `uid-${id}`,
    display_name: email.split('@')[0] ?? null,
    status: 'approved',
    is_approver: 0,
    is_devops: 0,
    dev_access: 0,
    origin: 'test',
    note: null,
    first_seen_at: '2026-01-01T00:00:00.000Z',
    decided_at: null,
    decided_by: null,
    vis_audiobook: 1,
    vis_library: 1,
    vis_games: 1,
    vis_library2: 0,
    vis_ebooks: 0,
    ...over,
  };
}

/**
 * A D1 fake that understands exactly the statements this module issues.
 *
 * ⚠️ `missingNotices` / `missingPrefs` reproduce D1's own "no such table" text
 * rather than a generic throw, because the whole point of those branches is
 * that a Worker shipped ahead of its migration says so in words instead of
 * reading as an outage.
 */
class FakeDB {
  users: UserRow[] = [
    user(1, OWNER, { is_approver: 1 }),
    user(2, MEMBER),
    user(3, OTHER),
    user(4, PENDING, { status: 'pending' }),
  ];
  notices: NoticeRow[] = [];
  prefs = new Map<string, string>();
  nextId = 1;
  missingNotices = false;
  missingPrefs = false;
  /** Set to make every INSERT of a notice fail, without breaking anything else. */
  writesFail = false;

  prepare(sql: string) {
    const db = this;
    let args: unknown[] = [];
    const guardNotices = () => {
      if (db.missingNotices && /estate_notification/.test(sql)) {
        throw new Error('D1_ERROR: no such table: estate_notification');
      }
    };
    const guardPrefs = () => {
      if (db.missingPrefs && /estate_prefs/.test(sql)) {
        throw new Error('D1_ERROR: no such table: estate_prefs');
      }
    };
    const stmt = {
      bind(...a: unknown[]) {
        args = a;
        return stmt;
      },
      async all() {
        guardNotices();
        if (/FROM estate_notification WHERE user_id/.test(sql)) {
          const uid = Number(args[0]);
          return { results: db.notices.filter((n) => n.user_id === uid).sort((a, b) => b.id - a.id) };
        }
        return { results: [] };
      },
      async first() {
        if (/FROM estate_user WHERE email/.test(sql)) {
          return db.users.find((u) => u.email === args[0]) ?? null;
        }
        if (/FROM estate_user WHERE id/.test(sql)) {
          return db.users.find((u) => u.id === Number(args[0])) ?? null;
        }
        guardPrefs();
        if (/FROM estate_prefs WHERE key/.test(sql)) {
          const value = db.prefs.get(String(args[0]));
          return value === undefined ? null : { value };
        }
        guardNotices();
        if (/SELECT id, read_at FROM estate_notification/.test(sql)) {
          const [id, uid] = args as [number, number];
          return db.notices.find((n) => n.id === Number(id) && n.user_id === Number(uid)) ?? null;
        }
        return null;
      },
      async run() {
        guardPrefs();
        if (/INSERT INTO estate_prefs/.test(sql)) {
          db.prefs.set(String(args[0]), String(args[1]));
          return { success: true };
        }
        guardNotices();
        if (/INSERT INTO estate_notification/.test(sql)) {
          if (db.writesFail) throw new Error('D1_ERROR: disk is on fire');
          const [user_id, kind, subject, body, link, source, source_id, created_at] = args as [
            number,
            string,
            string,
            string,
            string | null,
            string | null,
            number | null,
            string,
          ];
          db.notices.push({
            id: db.nextId++,
            user_id,
            kind,
            subject,
            body,
            link,
            source,
            source_id,
            created_at,
            read_at: null,
          });
          return { success: true };
        }
        if (/DELETE FROM estate_notification/.test(sql)) {
          const [uid, limit] = args as [number, number];
          const mine = db.notices.filter((n) => n.user_id === Number(uid)).sort((a, b) => b.id - a.id);
          const keep = new Set(mine.slice(0, Number(limit)).map((n) => n.id));
          db.notices = db.notices.filter((n) => n.user_id !== Number(uid) || keep.has(n.id));
          return { success: true };
        }
        if (/UPDATE estate_notification SET read_at = \?1 WHERE id/.test(sql)) {
          const [at, id, uid] = args as [string, number, number];
          const row = db.notices.find((n) => n.id === Number(id) && n.user_id === Number(uid));
          if (row) row.read_at = at;
          return { success: true };
        }
        if (/UPDATE estate_notification SET read_at = \?1 WHERE user_id/.test(sql)) {
          const [at, uid] = args as [string, number];
          for (const n of db.notices) if (n.user_id === Number(uid) && !n.read_at) n.read_at = at;
          return { success: true };
        }
        return { success: true };
      },
    };
    return stmt;
  }
  async batch() {
    return [];
  }
}

function env(db: FakeDB, as: string | null) {
  return {
    DB: db as unknown as D1Database,
    OWNER_EMAILS: OWNER,
    FIREBASE_PROJECT_ID: 'test-project',
    ENVIRONMENT: as ? 'development' : 'production',
    ...(as ? { DEV_EMAIL: as } : {}),
  };
}

function call(db: FakeDB, as: string | null, path: string, init?: RequestInit) {
  return notificationRoutes.request(path, init as never, env(db, as));
}

function post(db: FakeDB, as: string | null, path: string, body?: unknown) {
  return call(db, as, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

const NOW = '2026-09-05T18:00:00.000Z';

// ---------------------------------------------------------------------------
// The words — composed once, at decision time
// ---------------------------------------------------------------------------

test('an APPROVED notice never says the verse exists — approved is not landed', () => {
  const n = verseNotice({ kind: 'verse_approved', requestId: 12, name: 'Discworld' });
  assert.match(n.subject, /approved/);
  assert.match(n.body, /not live yet/);
  // The one sentence this whole feature exists to avoid.
  assert.doesNotMatch(n.body, /now (exists|in the estate)/i);
});

test("a DECLINED notice quotes the decider's words verbatim", () => {
  const n = verseNotice({
    kind: 'verse_declined',
    requestId: 12,
    name: 'Sanderson Extended',
    note: "That's The Cosmere under another name.",
  });
  assert.match(n.body, /“That's The Cosmere under another name\.”/);
  // A decline is not a permanent no, and the notice says so.
  assert.match(n.body, /asked for again/);
});

test('a LANDED notice carries the commit, because that is the checkable half', () => {
  const n = verseNotice({ kind: 'verse_landed', requestId: 12, name: 'Discworld', commit: 'abc1234' });
  assert.match(n.subject, /is live/);
  assert.match(n.body, /commit abc1234/);
});

test('an absent note adds no empty quotation marks', () => {
  const n = verseNotice({ kind: 'verse_approved', requestId: 1, name: 'X', note: '   ' });
  assert.doesNotMatch(n.body, /They said/);
});

test('every notice kind maps to a switch — an unswitchable notice cannot exist', () => {
  for (const kind of ['verse_approved', 'verse_declined', 'verse_landed'] as const) {
    const cls = classOf(kind);
    assert.ok(
      MEMBER_NOTICE_CLASSES.some((c) => c.key === cls),
      `${kind} maps to ${cls}, which is not a class anybody can switch`,
    );
  }
});

// ---------------------------------------------------------------------------
// Preferences — the `estate_prefs` half the design asked for
// ---------------------------------------------------------------------------

test('the per-person prefs row is keyed by estate id, not by email', () => {
  // ⚠️ Emails change and are re-used; the id is the join key the estate already
  // trusts. A pref keyed by email follows the address, not the person.
  assert.equal(userPrefsKey(7), 'notify:user:7');
});

test('⚠️ an unreadable prefs row falls back to the DEFAULTS, never to silence', () => {
  assert.deepEqual(parseMemberPrefs('{{{ not json'), defaultMemberPrefs());
  assert.deepEqual(parseMemberPrefs(null), defaultMemberPrefs());
  assert.deepEqual(parseMemberPrefs('[]'), defaultMemberPrefs());
  assert.equal(defaultMemberPrefs().verse_decided, true);
});

test('an unknown stored key is ignored on READ (it is old history, not a new feature)', () => {
  const p = parseMemberPrefs('{"verse_decided":false,"whatever":true}');
  assert.equal(p.verse_decided, false);
  assert.equal(p.whatever, undefined);
});

test('⚠️ but a WRITE refuses an unknown class rather than stripping it', () => {
  const r = parseMemberPrefsBody({ verse_decided: true, whatever: true });
  assert.equal((r as { error: string }).error, 'unknown_class');
  const b = parseMemberPrefsBody({ verse_decided: 'yes' });
  assert.equal((b as { error: string }).error, 'not_a_boolean');
});

// ---------------------------------------------------------------------------
// writeNotice — the four outcomes
// ---------------------------------------------------------------------------

test('a notice is written to the requester and nobody else', async () => {
  const db = new FakeDB();
  const out = await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 3, name: 'Discworld' }), NOW);
  assert.equal(out, 'written');
  assert.equal(db.notices.length, 1);
  assert.equal(db.notices[0]?.user_id, 2);
  assert.equal(db.notices[0]?.source_id, 3);
  assert.equal(db.notices[0]?.read_at, null);
});

test('🔴 NOTHING is written when there is no requester — a system row is owed no mail', async () => {
  const db = new FakeDB();
  for (const who of [null, undefined, 0, -1]) {
    const out = await writeNotice(
      db as unknown as D1Database,
      who as number | null,
      verseNotice({ kind: 'verse_approved', requestId: 1, name: 'X' }),
      NOW,
    );
    assert.equal(out, 'no_recipient');
  }
  assert.equal(db.notices.length, 0);
});

test('🔴 an OPT-OUT is honoured, and honoured by the writer rather than the reader', async () => {
  const db = new FakeDB();
  db.prefs.set(userPrefsKey(2), JSON.stringify({ verse_decided: false }));
  const out = await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_declined', requestId: 1, name: 'X', note: 'a reason long enough' }), NOW);
  assert.equal(out, 'opted_out');
  assert.equal(db.notices.length, 0, 'an opted-out notice must not be stored and hidden — it must not exist');
});

test('a failed write reports `failed` and throws nothing', async () => {
  const db = new FakeDB();
  db.writesFail = true;
  const out = await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'X' }), NOW);
  assert.equal(out, 'failed');
});

test('a missing notices table is a `failed`, not an exception through the caller', async () => {
  const db = new FakeDB();
  db.missingNotices = true;
  const out = await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'X' }), NOW);
  assert.equal(out, 'failed');
});

test('⚠️ a missing PREFS table means defaults (on), not silence', async () => {
  const db = new FakeDB();
  db.missingPrefs = true;
  const out = await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'X' }), NOW);
  assert.equal(out, 'written');
});

test('the per-person queue is trimmed, so it cannot become a database', async () => {
  const db = new FakeDB();
  for (let i = 0; i < NOTICES_PER_USER + 5; i += 1) {
    await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: i, name: `U${i}` }), NOW);
  }
  assert.equal(db.notices.filter((n) => n.user_id === 2).length, NOTICES_PER_USER);
  // The trim keeps the NEWEST, which is the half a reader cares about.
  assert.equal(db.notices.some((n) => n.source_id === NOTICES_PER_USER + 4), true);
  assert.equal(db.notices.some((n) => n.source_id === 0), false);
});

// ---------------------------------------------------------------------------
// The doors
// ---------------------------------------------------------------------------

test('signed out is a worded 401, never a bare status', async () => {
  const db = new FakeDB();
  const res = await call(db, null, '/estate/notifications');
  assert.equal(res.status, 401);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'unauthenticated');
  assert.match(body.detail, /Sign in/);
});

test('a member who is not approved yet is refused in words that say what to do', async () => {
  const db = new FakeDB();
  const res = await call(db, PENDING, '/estate/notifications');
  assert.equal(res.status, 403);
  const body = (await res.json()) as { detail: string };
  assert.ok(body.detail.length > 20, 'a refusal that says nothing is the thing the estate forbids');
});

test('a member reads their own notices and the unread count', async () => {
  const db = new FakeDB();
  await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'A' }), NOW);
  await writeNotice(db as unknown as D1Database, 3, verseNotice({ kind: 'verse_approved', requestId: 2, name: 'B' }), NOW);
  const res = await call(db, MEMBER, '/estate/notifications');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { notices: NoticeRow[]; unread: number };
  assert.equal(body.notices.length, 1);
  assert.equal(body.notices[0]?.subject.includes('A'), true);
  assert.equal(body.unread, 1);
});

test('🔴 an APPROVER has no special read — a notice is addressed mail, not a queue', async () => {
  const db = new FakeDB();
  await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'A' }), NOW);
  const res = await call(db, OWNER, '/estate/notifications');
  const body = (await res.json()) as { notices: NoticeRow[] };
  assert.equal(body.notices.length, 0, "the owner must not read a member's notices by virtue of being the owner");
});

test('marking one read is idempotent, and the second call reports the FIRST time', async () => {
  const db = new FakeDB();
  await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'A' }), NOW);
  const first = (await (await post(db, MEMBER, '/estate/notifications/1/read')).json()) as { read_at: string };
  const second = (await (await post(db, MEMBER, '/estate/notifications/1/read')).json()) as { read_at: string };
  assert.equal(first.read_at, second.read_at);
});

test("⚠️ somebody else's notice is a 404, not a 403 — a 403 would confirm it exists", async () => {
  const db = new FakeDB();
  await writeNotice(db as unknown as D1Database, 3, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'A' }), NOW);
  const res = await post(db, MEMBER, '/estate/notifications/1/read');
  assert.equal(res.status, 404);
  assert.equal(db.notices[0]?.read_at, null, "and it must not be marked read either");
});

test('read-all clears only the caller’s unread notices', async () => {
  const db = new FakeDB();
  await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'A' }), NOW);
  await writeNotice(db as unknown as D1Database, 3, verseNotice({ kind: 'verse_approved', requestId: 2, name: 'B' }), NOW);
  const res = await post(db, MEMBER, '/estate/notifications/read-all');
  assert.equal(res.status, 200);
  assert.equal(db.notices.find((n) => n.user_id === 2)?.read_at !== null, true);
  assert.equal(db.notices.find((n) => n.user_id === 3)?.read_at, null);
});

test('a bad id is refused in words before any query runs', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/notifications/nope/read');
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { error: string }).error, 'bad_id');
});

test('⚠️ a Worker ahead of 0019 answers 200 with the fix, not a 500', async () => {
  const db = new FakeDB();
  db.missingNotices = true;
  const res = await call(db, MEMBER, '/estate/notifications');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { error: string; fix: string; notices: unknown[] };
  assert.equal(body.error, 'estate_notification_table_missing');
  assert.match(body.fix, /0019_estate_notification\.sql/);
  assert.deepEqual(body.notices, []);
});

test('a member switches their own notices off, and the row lands under their id', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/notifications/prefs', { verse_decided: false });
  assert.equal(res.status, 200);
  assert.equal(db.prefs.get(userPrefsKey(2)), JSON.stringify({ verse_decided: false }));
  // And the switch actually governs the writer.
  const out = await writeNotice(db as unknown as D1Database, 2, verseNotice({ kind: 'verse_approved', requestId: 1, name: 'A' }), NOW);
  assert.equal(out, 'opted_out');
});

test('the prefs GET serves the class list, so no page hardcodes a label', async () => {
  const db = new FakeDB();
  const res = await call(db, MEMBER, '/estate/notifications/prefs');
  const body = (await res.json()) as { prefs: Record<string, boolean>; classes: { key: string; label: string }[] };
  assert.equal(body.prefs.verse_decided, true);
  assert.equal(body.classes.length, MEMBER_NOTICE_CLASSES.length);
  assert.ok(body.classes[0]?.label);
});

test('a prefs write with an unknown class is a worded 400', async () => {
  const db = new FakeDB();
  const res = await post(db, MEMBER, '/estate/notifications/prefs', { pipeline_red: true });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string; detail: string };
  assert.equal(body.error, 'unknown_class');
  assert.match(body.detail, /verse_decided/);
});

test('⚠️ the member classes are NOT the owner’s phone classes', async () => {
  // notify-prefs.ts owns `red` / `agent_landed` / `window_complete` /
  // `archive_done`, delivered by the conductor to a phone. Merging the two
  // lists would put a member's toggle on the ops card, or the owner's pipeline
  // alerts on a member's page.
  const keys = MEMBER_NOTICE_CLASSES.map((c) => c.key);
  for (const owned of ['red', 'agent_landed', 'window_complete', 'archive_done']) {
    assert.equal(keys.includes(owned as never), false, `${owned} belongs to notify-prefs.ts, not here`);
  }
});
