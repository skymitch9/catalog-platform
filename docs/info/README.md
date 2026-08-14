# catalog-platform — Information References

> **Audience:** Claude sessions. **Status:** TRACKED. Last verified: **2026-08-13**.

Stable how-and-why reference for the platform repo. Current state and decisions
in flight live in [`../TODO.md`](../TODO.md); the system design in
[`../PLATFORM.md`](../PLATFORM.md).

| File | What it holds |
|---|---|
| [`matching-thresholds.md`](matching-thresholds.md) | The 2026-08-12 re-measurement of `MIN_TITLE_SIMILARITY` (0.34) and the 0.7 spine floor against both production D1s; verdict on sharing them across books and games; the bare-series-name refusal rule |
| [`improvement-proposals.md`](improvement-proposals.md) | The 2026-08-13 estate-wide survey: ranked evidence-backed proposals, cross-catalog opportunities, remove/simplify candidates (games `play` + `sleeve_requirement` are dead schema), and the do-not-build list |
| [`index-worker-design.md`](index-worker-design.md) | The shared index Worker, designed for real (2026-08-13) and BUILT games-first the same day (`apps/index-worker/` + the games pusher; steps 1–3 of its §7, step 4 out): two-tier join key (`work_fold` books-only with an empty-fold refusal for non-Latin titles; universe tier is the only cross-format join games enter), snapshot-replace push protocol, fixture-pinned fold. Not deployed — read auth (§9 Q3) is the owner's open call |
| [`estate-auth-design.md`](estate-auth-design.md) | Estate-wide auth, DESIGN ONLY (2026-08-13, awaiting owner approval): identity stays local Firebase-token verification (already global — both Workers pin project `audiobook-catalog`); membership becomes a dedicated auth Worker + D1 (`pending/approved/revoked`, no roles) consulted with a 10-min TTL cache; authorization stays per-app. Answers index §9 Q3 (search = members-only), the new-site inheritance contract with 8 conformance probes, seed-based "migration" of audiobook users, reversible 8-step rollout (index adopts first), threat model and failure-direction table |
