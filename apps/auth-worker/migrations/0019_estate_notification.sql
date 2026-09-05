-- 0019: per-person notices — "somebody decided the thing you asked for".
--
-- Phase 4 of docs/info/universe-add-verse-design.md ("notification when a
-- request is decided"). ⚠️ THE DESIGN DID NOT NAME A MIGRATION — it said
-- "reuse estate_prefs / notify-prefs.ts", and this migration is the honest
-- consequence of trying to: `estate_prefs` is ONE ROW PER KEY of owner-set
-- settings that the CONDUCTOR reads, and it is the right home for the
-- OPT-OUT (which is where it is kept, under `notify:user:<id>`), but it is
-- not a place to put a stream of dated messages addressed to people. So the
-- switch reuses 0014 and the messages get a table. Recorded loudly here and
-- in the design's §8 rather than discovered later by a reader who trusted
-- the phase table.
--
-- ⚠️ WHY NOT THE WORKER EVENT RING (0015). Its own header forbids it: "a
-- noticeboard, not a log … errors, refusals worth a human's attention, and
-- deploy markers. Not requests." The ring is ALSO per-WORKER and read behind
-- requireDevops(), so a member could never see a line addressed to them. A
-- decision notice is routine traffic addressed to one person — the two things
-- the ring is designed not to hold.
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a new object plus one
-- index. No ALTER, no DROP, nothing existing touched — the same property that
-- made 0012/0013/0014/0017/0018 safe to apply remotely and unattended, and the
-- one to re-check before any successor.
--
-- ⚠️ THE BODY IS PROSE, WRITTEN AT DECISION TIME, AND IT IS NOT A JOIN. A
-- notice says what was decided and quotes the decider's own words as they
-- stood then. Rendering it by re-reading `universe_request` today would make
-- a message about the past change when the row changes, which is exactly how
-- "you were declined because X" turns into a sentence nobody ever wrote.
CREATE TABLE IF NOT EXISTS estate_notification (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES estate_user(id),
  kind       TEXT    NOT NULL,   -- verse_approved | verse_declined | verse_landed
  subject    TEXT    NOT NULL,   -- one line
  body       TEXT    NOT NULL,   -- the decision, and the decider's note verbatim
  link       TEXT,               -- where to go and look
  source     TEXT,               -- the table the notice is about ('universe_request')
  source_id  INTEGER,            -- ⚠️ deliberately NO foreign key: a notice outlives its subject
  created_at TEXT    NOT NULL,
  read_at    TEXT
);

-- Every read is "this person's notices, newest first"; nothing ever scans the
-- table globally.
CREATE INDEX IF NOT EXISTS ix_estate_notification_user ON estate_notification(user_id, id DESC);
