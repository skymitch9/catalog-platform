# catalog-platform — Information References

> **Audience:** Claude sessions. **Status:** TRACKED. Last verified: **2026-08-14**
> — the estate stack went LIVE overnight 2026-08-13→14 (auth Worker deployed +
> seeded, index Worker deployed with all three catalogs pushed, apex search +
> `/admin`, games enforcing, library in shadow). Operational runbooks live in
> `library_catalog/docs/access/` (`estate-auth.md`, `index-worker.md`,
> `themes.md`); the rows below describe the design docs.

Stable how-and-why reference for the platform repo. Current state and decisions
in flight live in [`../TODO.md`](../TODO.md); the system design in
[`../PLATFORM.md`](../PLATFORM.md).

| File | What it holds |
|---|---|
| [`matching-thresholds.md`](matching-thresholds.md) | The 2026-08-12 re-measurement of `MIN_TITLE_SIMILARITY` (0.34) and the 0.7 spine floor against both production D1s; verdict on sharing them across books and games; the bare-series-name refusal rule |
| [`improvement-proposals.md`](improvement-proposals.md) | The 2026-08-13 estate-wide survey: ranked evidence-backed proposals, cross-catalog opportunities, remove/simplify candidates (games `play` + `sleeve_requirement` are dead schema), and the do-not-build list |
| [`index-worker-design.md`](index-worker-design.md) | The shared index Worker (`apps/index-worker/`), **LIVE at `index.heygabi.ai` since 2026-08-14** with all three catalogs pushed: two-tier join key (`work_fold` books-only with an empty-fold refusal for non-Latin titles; universe tier is the only cross-format join games enter), snapshot-replace push protocol, fixture-pinned fold, `/api/search` (ranked, human) vs `/api/lookup` (exact, identity). Reads are estate-members-only (§9 Q3 answered) |
| [`estate-auth-design.md`](estate-auth-design.md) | Estate-wide auth, **BUILT and LIVE at `auth.heygabi.ai` since 2026-08-14** (seeded; games enforcing, library shadow): identity stays local Firebase-token verification (both Workers pin project `audiobook-catalog`); membership is the dedicated auth Worker + D1 (`pending/approved/revoked` + per-catalog **visibility**, §4.5) consulted with a 10-min TTL cache; authorization stays per-app. The new-site inheritance contract with 8 conformance probes, the seed, the reversible rollout, threat model and failure-direction table |
| [`edit-audit-design.md`](edit-audit-design.md) | The cross-catalog **edit any detail + audit log** contract (2026-08-14): what crosses the repo boundary (audit semantics, key-move rules, identifier freeze) vs what stays home; per-catalog field tiers; the carry-with-attestation mechanism (library side BUILT + DEPLOYED 2026-08-13); how the audiobook overrides+rebuild model satisfies the same contract with git as its audit log; ⚠️ the silent audiobook-retitle key move (§3.4) and the A2/A3 fixes; build order and owner questions |
| [`estate-themes.md`](estate-themes.md) | The estate THEME SYSTEM (canonical asset in `sites/heygabi-home/public/assets/`, live on the apex): four user-selectable themes — classic (the apex's original look), apple, cyberpunk (from the audiobook site), retro (from the games app; ⚠️ actually muted vintage pop-art) — × light/dark on one `--et-*` token contract; the cog switcher (`hg_theme`/`hg_theme_page`/`hg_mode`, per-page since v2), per-site identity defaults (owner decision), the motion vocabulary, and the honest per-site fidelity costs |
| [`health-envelope.md`](health-envelope.md) | The one `{ ok, service, version?, time, detail }` envelope all four estate Workers' `/api/health` now answer (2026-08-14, additive — every pre-existing field kept at the top level too), per-worker before→after, `status.js`'s `detailOf()` fallback, and the deliberately-not-yet-done removal step |
