# Catalog Platform — Work Log

> **Audience:** Claude sessions and the owner. **Status:** TRACKED.
> Last verified: **2026-08-12**.
> This is the *work log* — current state and things in flight. Stable facts live
> in [`PLATFORM.md`](PLATFORM.md), [`DOMAIN_AND_HOSTING.md`](DOMAIN_AND_HOSTING.md)
> and [`UNIVERSES.md`](UNIVERSES.md). Cross-link rather than duplicate.

---

## 1. ⚠️ Three of the four repos deploy only from a human's laptop

**Raised by the owner 2026-08-12**, immediately after a manual
`npm run deploy` of `library_catalog`: *"i dont think board games has one
either, add a todo in catalog platform to look into deploying these apps."*

Correct, and it is worse than "no CI" — it is a **single point of failure that
is a person at a specific machine.**

### What is actually true (measured 2026-08-12)

| Repo | `.github/workflows` | How it reaches production |
|---|---|---|
| `bookbuddy/audiobook_catalog` | ✅ 7 workflows — `deploy`, `promote`, `auto-promote`, `lint`, `tests`, `club-notify`, `cw-fulfill` | Push to `main` → deploy → `/dev/`; a separate **Promote to Prod** dispatch publishes the root |
| `bookbuddy/library_catalog` | ❌ **none** | `npm run deploy` typed by hand |
| `boardbuddy/Board_Game_Catalog` | ❌ **none** | `npm run deploy` typed by hand |
| `catalog-platform` | ❌ **none** | Not deployed at all — it is a data/code dependency, see §1.4 |

### 1.1 The two catalogs are structurally identical, which is the opportunity

They are not two problems. Every relevant script is the same shape:

| | `library_catalog` | `Board_Game_Catalog` |
|---|---|---|
| `predeploy` | `node scripts/check-clean.mjs` | `node scripts/check-clean.mjs` |
| `deploy` | `npm run build && npm run deploy --workspace @lc/worker` | `npm run build && npm run deploy --workspace @bgc/worker` |
| Target | Cloudflare Worker + D1 + R2 + `[assets]` | Cloudflare Worker + D1 + R2 + `[assets]` |

So **one workflow, parameterised by workspace name, covers both.** Whatever is
written for one should be written once and copied with a single string changed.

### 1.2 ⚠️ Do not copy the audiobook workflow wholesale

It is the only working example in the estate and it is tempting, but it encodes
a **two-lane deploy** (`main` → `/dev/`, an explicit promote → prod) that exists
because that site publishes a generated static catalog and needs a staging lane
for data. The two Workers have no such split — they deploy one artifact to one
custom domain. Copying the promote machinery would add a lane nobody asked for.

⚠️ Also learned the hard way on 2026-08-12: `Auto-promote books to prod`
**skipped** a commit that was a code fix rather than a catalog auto-update, so
the fix sat on `/dev/` looking deployed while prod was stale. Any lane split
must make "this did not reach prod" loud, not silent.

### 1.3 What a workflow has to preserve

These are guardrails the manual path currently provides, and a workflow that
drops them is worse than no workflow:

1. **`check-clean.mjs` refuses a dirty tree.** It exists because production in
   the Board Game Catalog twice ran code that was in no commit. CI is clean by
   construction, so the guard becomes free — but the *reason* must survive: the
   deployed artifact has to be a commit.
2. **Migrate before deploying**, so new code never meets an old schema.
   `library_catalog` has `db:migrate`; the ordering is currently a human
   remembering it.
3. ⚠️ **Wrangler on Windows sometimes prints success then exits non-zero** (a
   libuv teardown quirk). On Linux CI this stops being a problem — but do not
   port any `|| true` written to work around it, or a real failure goes green.
4. **Secrets.** A Cloudflare API token with Workers + D1 + R2 scope has to live
   in repo secrets. ⚠️ Neither repo has ever needed one, so this is new
   surface — and `audiobook_catalog` **must stay public** for unmetered Actions
   minutes, so think about whether these two should be public too before
   assuming the same budget applies.

### 1.4 Does `catalog-platform` need deploying at all?

Probably not, and that should be decided rather than defaulted. It has no
`deploy` script and no worker. What it does have is a **build-time dependency
edge**: `library_catalog`'s `prebuild`/`pretest`/`pretypecheck` fetch the shared
universe list from this repo and **fail loudly** if the checkout is missing
(`UNIVERSES.md`). So CI for `library_catalog` has to check out *two* repos, and
that is the real coupling to solve here — not a deploy.

### Open questions for the owner

- Is `Board_Game_Catalog`'s repo public or private? It decides the Actions
  budget, and the audiobook repo was made public on 2026-08-11 specifically to
  get unmetered minutes.
- Should deploy be **on push to `main`**, or **manual dispatch only**? The
  standing rule in this estate is that "deploy" means main → `/dev/` and prod
  needs an explicit ask — but these two Workers have no dev lane, so a push-to-
  deploy would publish straight to the live custom domain.

**Not started. No code written.** Raised, measured and scoped only.
