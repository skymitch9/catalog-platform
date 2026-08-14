-- 0003 — the cached /seen answer grows its visibility half (estate design
-- §4.5): "a consumer that caches /seen caches the visibility WITH the status
-- — the two are one answer and must not age separately." Same row, same
-- checked_at, one answer.
--
-- TEXT holding the canonical JSON array ('["audiobook","games"]'), NOT three
-- flag columns like estate_user's 0002. The flags argument was for the TRUTH
-- table, where a new catalog must be one ADD COLUMN; this is a CACHE of a
-- serialised answer — storing the answer verbatim is the honest shape, and a
-- new catalog name costs nothing here. Validation lives at the read boundary
-- (estate-cache.ts parses and refuses garbage to NULL).
--
-- NULL = a pre-0003 row (or a pre-§4.5 server's answer): no visibility fact.
-- Scope decisions then fail closed to the public slice per §4.5, and the
-- next /seen refresh (forced by requireVisibility) heals the row. Losing the
-- whole table still costs one round-trip per person, nothing else.

ALTER TABLE estate_cache ADD COLUMN visibility TEXT;
