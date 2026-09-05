-- 0018: catalog requests — the "+" on the heygabi.ai Books and Games cards
-- (design docs/info/request-a-catalog-design.md §3.2).
--
-- Owner ask, 2026-09-05 06:26 Phoenix: *"Remember that doc about requesting a
-- board game or book site? Time to build that."*
--
-- ⚠️ THE NUMBER WAS RE-MEASURED, NOT TRUSTED. The design's own §3.1 says
-- `0018` and then says do not trust that sentence either — because the phase-1
-- draft called this `0016` and `0016_billing_policy.sql` took the number while
-- it sat unbuilt, exactly as 0017's header records happening to it. Measured
-- 2026-09-05: migrations/ held 0001…0017 and nothing else.
--
-- ⚠️ PURELY ADDITIVE: one CREATE TABLE IF NOT EXISTS on a new object plus two
-- indexes. No ALTER, no DROP, nothing existing touched — the property that made
-- 0012/0013/0014/0015/0016/0017 safe to apply remotely and unattended, and the
-- one to re-check before any successor.
--
-- 🔴 A ROW HERE IS A REQUEST, NOT A CATALOG. Nothing reads this table to decide
-- what exists. A catalog exists when a wrangler env block, a D1, a bucket, a
-- hostname and a deploy exist — design §7, ten manual steps across three
-- consoles. Accept sets a status and hands over a checklist; it deploys
-- nothing, which is why `accepted` and `live` are two different statuses.
--
-- ⚠️ `kind` IS A COLUMN, NOT A SECOND TABLE AND NOT A KEY IN `extra`. It is a
-- closed vocabulary the schema itself enforces, it decides which provisioning
-- ledger applies (§7.6), and the home cards' per-card show/hide queries it — so
-- it is indexed and constrained rather than buried in a JSON blob a renderer
-- reads tolerantly. `DEFAULT 'books'` is for this migration's own safety only
-- (an insert that forgets the column lands as the kind that HAS a working
-- provisioning path, not as one that does not); the route always sends it
-- explicitly and a missing or unknown `kind` on the wire is a 400, never a
-- default.
--
-- ⚠️ `desired_subdomain` IS DELIBERATELY NOT UNIQUE. Uniqueness is enforced in
-- code at submit — against `live` rows AND open `pending`/`accepted` rows, of
-- EITHER kind, because there is one heygabi.ai DNS namespace — so that a
-- DECLINE FREES THE NAME. A UNIQUE index would hold a declined request's
-- address hostage forever, and the rule would live somewhere that cannot say
-- why in words. Same reasoning 0017 gives for having no unique index on
-- `name_key`.
--
-- ⚠️ `extra` IS JSON TEXT, STORED WHOLE AND UNPARSED — the estate_prefs (0014)
-- and universe_request.payload (0017) idiom, for the reason both state: the
-- shape will grow (requested theme, starting role posture, a note to the owner,
-- a seed-import source, GABI on/off) and a schema naming today's fields needs a
-- migration the day a new one is wanted. Readers are tolerant: a missing key is
-- a default, never an error.
--
-- 🔴 `reader_key_set` AND `owner_key_set` ARE BOOLEANS AND CAN NEVER BE
-- ANYTHING ELSE. Not ciphertext, not a value, not a hint, not a prefix. The
-- requester's optional Claude key is sealed in the browser and parked as an
-- opaque envelope in a PRIVATE R2 object; it is decrypted only inside the
-- owner-run provisioner and piped to `wrangler secret put` over stdin. There is
-- no decrypt-to-READ path anywhere, and that ABSENCE — not a policy — is the
-- mechanical guarantee behind "the owner can never see it" (design §6). A
-- column here that could hold key material would delete that guarantee in one
-- ALTER. All four repos are PUBLIC (KNOWN_ISSUES KI-2).

CREATE TABLE IF NOT EXISTS catalog_request (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  kind                   TEXT    NOT NULL DEFAULT 'books'
                                 CHECK (kind IN ('books','games')),
  requester_email        TEXT    NOT NULL,   -- lowercased; the estate join key
  requester_uid          TEXT,               -- Firebase uid at submit; recorded, never joined on
  requester_display_name TEXT,               -- SSO display-name snapshot at submit
  desired_subdomain      TEXT    NOT NULL,   -- normalised [a-z0-9-], 3-40
  display_name           TEXT    NOT NULL,   -- the catalog's public name
  status                 TEXT    NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','accepted','declined','live','cancelled')),
  extra                  TEXT,               -- JSON blob, stored whole and unparsed
  decided_by             INTEGER REFERENCES estate_user(id) ON DELETE SET NULL,
  decided_at             TEXT,
  decline_reason         TEXT,               -- the worded reason, surfaced to the requester
  provisioned_instance   TEXT,               -- on `live`: the wrangler env actually created
  provisioned_host       TEXT,               -- on `live`: the real hostname
  reader_key_set         INTEGER NOT NULL DEFAULT 0,  -- BOOLEAN ONLY
  owner_key_set          INTEGER NOT NULL DEFAULT 0,  -- BOOLEAN ONLY
  created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_catalog_request_status ON catalog_request(status);
CREATE INDEX IF NOT EXISTS ix_catalog_request_kind   ON catalog_request(kind, status);
