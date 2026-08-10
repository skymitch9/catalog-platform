# One Domain, and Whether GitHub Pages Retires

> ✅ **Confirmed by the owner 2026-08-10: `heygabi.ai` IS registered at Cloudflare Registrar**, in the same account as the two Workers. The inference below that `.ai` is not a Cloudflare TLD was **wrong**. There is no nameserver change and no zone transfer — the zone is already there, so Workers custom domains, R2 custom domains and redirect rules can all be attached directly.

> **Audience:** Claude sessions and the owner. **Status:** RECOMMENDATION —
> nothing bought, nothing changed. Last verified: **2026-08-09**.
> Answers [`PLATFORM.md`](PLATFORM.md) §8 open questions 1 and 2.
> Everything measured on 2026-08-09 is marked *(measured)*. Everything else is
> marked *(inferred)* or *(needs checking)*.

---

## 0. The recommendation in one table

| Question | Answer |
|---|---|
| Domain shape | **One registered domain, subdomains per app.** Not paths, not three domains |
| Registrar | **Cloudflare Registrar**, at-cost, domain in the same account as the two Workers |
| Leave GitHub Pages? | **Yes — but not for the reason the plan currently gives.** Do it in two independent moves, and covers-to-R2 is the urgent half |
| How the audiobook site deploys | **Cloudflare Pages by `wrangler pages deploy` from the existing workflow.** ⚠️ **Not** the Pages git integration — see §2.3, it silently breaks the dev data lane |
| Covers | **R2 at `covers.<domain>`**, out of git going forward, history untouched |
| Public site repo | **The audiobook repo, re-pointed.** Not a new one |
| Cost | **~$11–13/yr**, all-in, at current volumes. Everything else lands in free tiers |

**The single most important line in this document:** if the audiobook site and
the library app ever share one origin, the audiobook site will log you out of the
library app on every page load. `site/identity.js:44–54` calls `signOut()` on the
shared Firebase Auth instance for the origin on every non-localhost page view.
That is what settles subdomains-versus-paths, and it is not in `PLATFORM.md`.

---

## 1. Recommended domain shape

### 1.1 The shape

One domain, five hosts. This follows `PLATFORM.md` §3's table.

| Host | Serves | Cloudflare object | Firebase authorised domain? |
|---|---|---|---|
| `<domain>` (+ `www`) | Audiobook catalog / public read view, and `/dev/` beneath it | **Pages** project | ✅ **yes** — Google popup runs here |
| `library.<domain>` | `library_catalog` Worker + D1 + React PWA | **Worker** custom domain | ✅ **yes** — Firebase ID tokens |
| `games.<domain>` | `Board_Game_Catalog` Worker + D1 + React PWA | **Worker** custom domain | ✅ **yes**, once it moves off Access (`PLATFORM.md` §4) |
| `covers.<domain>` | 243 MB of cover art | **R2** public bucket custom domain | ❌ no — no sign-in |
| `index.<domain>` | Cross-format index Worker (`PLATFORM.md` §5, unbuilt) | **Worker** custom domain | ❌ no — no sign-in |

`www` should 301 to the apex (or the reverse — pick one and be consistent), so
only one of the two is ever an auth origin.

### 1.2 Why subdomains and not paths

Paths (`<domain>/games`, `<domain>/books`) have one real attraction: a single
origin means one `localStorage`, one Firebase Auth persistence store, and
therefore one sign-in for the whole site. That attraction is a trap here, for
four reasons in descending order of severity.

**1. The audiobook site would log the other two apps out. (measured)**

`site/identity.js:44–54`:

```js
function detachStaleFirebaseAuth() {
  if (_authDetached) return;
  _authDetached = true;
  // On localhost we use redirect auth — don't detach or getRedirectResult returns null
  if (['localhost', '127.0.0.1'].includes(location.hostname)) return;
  try {
    const auth = getAuth();
    if (auth.currentUser) signOut(auth).catch(() => {});
    else onAuthStateChanged(auth, (user) => { if (user) signOut(auth).catch(() => {}); });
```

This runs from `getSession()`, i.e. on essentially every audiobook page load. It
is deliberate — the comment at `identity.js:147–151` explains that the site keeps
identity in `localStorage` and detaches Firebase Auth so a stale token cannot
poison Firestore writes. `library_catalog/docs/HANDOFF.md` finding 4 records the
same fact from the other side: *"it throws its Google session away immediately
after sign-in."*

Firebase Auth persistence is keyed by origin + API key + app name. Same origin,
same `audiobook-catalog` project, default app name — so it is **the same stored
session**. Putting the library app on the same origin means every visit to an
audiobook page signs the library app out. Different subdomains are different
origins, and the problem simply does not exist. *(The persistence-keying claim is
inferred from how Firebase Auth stores sessions; the `signOut()` call itself is
measured. If anyone ever wants the single-origin design, this must be tested
before anything else.)*

**2. Both Workers serve root-relative apps.** `library_catalog`'s
`docs/access/cloudflare.md` §6 says the app "reads no absolute URLs of its own —
`apps/web/src/api.ts` calls `/api/...` relative — so it follows the origin it is
served from." That is a virtue at a subdomain root and a liability under a path
prefix: mounting at `/books/` needs a Vite `base`, a router `basename`, an
`[assets]` binding that tolerates the prefix, and every `/api/...` call rewritten.
Two SPAs, twice. Subdomains cost zero lines of code in either app.

**3. Cookie and route blast radius.** One origin means the two editor apps and
the public site share a cookie jar and a single Workers-route table on one
hostname. `Board_Game_Catalog/docs/DESIGN.md` §3's reasoning — separate Worker,
separate database, *"so the projects can't collide on schema, secrets, or
deploys"* — applies to hostnames too.

**4. Independent rollback.** Three hosts are three deploy lanes that can be rolled
back separately. `library_catalog`'s rollback is `wrangler rollback <VERSION_ID>`;
the audiobook site's is promoting a `prod-*` tag. Neither should be able to take
the other down.

### 1.3 Why not three separate domains

Three registrations, three DNS zones, three renewal dates, three sets of
certificates, and no visual signal that they are one household's catalogs. The
only thing it buys is isolation you already have from separate origins. Also
three times the Firebase authorised-domain churn. Skip it.

### 1.4 The Firebase authorised-domains consequence

`library_catalog/docs/access/cloudflare.md` §5 records the failure mode already
hit once: *"Google sign-in will fail until the Worker's host is on Firebase's
allow-list. The browser gets `auth/unauthorized-domain`."* And: *"This cannot be
scripted: the authorised-domains list is Identity Platform admin config and
`firebase-tools` has no command for it."*

So every host that runs a Google sign-in needs a manual console entry, and
**subdomains are not inherited — add each host explicitly** *(inferred; the safe
practice regardless of whether Identity Platform happens to match a parent)*.

That is three entries for this design: the apex, `library.`, `games.`. Both
existing `*.workers.dev` hosts should **stay** in the list during and after
cutover — `cloudflare.md` §6 says the same: *"The old one can stay."* They are
the escape hatch if the custom domain misbehaves.

⚠️ `covers.` and `index.` must **not** be added. Nothing signs in there, and an
authorised domain is an OAuth redirect surface.

### 1.5 The name

Not my call, and `PLATFORM.md` §8 question 1 is still open. Criteria that matter
for *this* shape:

- Short enough that `library.<domain>` is typeable on a phone, since that app is
  used standing at a bookshelf (`LIBRARY_CATALOG.md` §8, phases 2 and 4).
- Not audiobook-specific — the apex becomes the combined view (`PLATFORM.md` §3.3).
- A `.com` if available: cheapest, no registry surprises, no TLD that a mail or
  link-preview filter treats as suspicious.

The repos are already themed `bookbuddy` / `boardbuddy`, so something in that
family keeps the naming honest. **Owner's decision.**

---

## 2. Should the audiobook site leave GitHub Pages?

**Yes.** But the plan's stated reason is not the strongest one available, and the
migration is really *two* independent moves that should not be bundled.

### 2.1 What is actually measured today

All measured 2026-08-09 in `bookbuddy/audiobook_catalog`:

| | |
|---|---|
| `.git` | **381 MB** (was 377 MB on 2026-08-07 — `PLATFORM.md` §1) |
| `site/` | **257 MB**, **1,882 files** |
| `site/covers/` | **243 MB**, **1,843 files** |
| `site/index.html` | **8.2 MB** — the single largest file |
| Catalog | 1,073 books, so ~1,843 covers means orphans persist |

### 2.2 ⚠️ A ceiling nobody has counted: the *published site* is ~514 MB

`.github/workflows/deploy.yml` assembles the artifact like this:

```bash
mkdir -p _site
cp -r prod-src/site/. _site/
rm -rf _site/dev
mkdir -p _site/dev
cp -r main-src/site/. _site/dev/
```

**`site/covers/` is copied twice** — once at the root from `prod`, once under
`/dev/` from `main`. So the published site is roughly **2 × 257 MB ≈ 514 MB**.

GitHub's documented limit: *"Published GitHub Pages sites may be no larger than
1 GB"* (docs.github.com, Pages limits, fetched 2026-08-09). The recommended
source-repo limit is also 1 GB, which is the `.git` figure everyone has been
watching.

So the site is at roughly **half of a hard ceiling**, and every new cover
consumes it at double rate. That is a nearer and harder wall than the 381 MB
`.git` against a *recommended* 1 GB, and it is a wall that covers-to-R2 removes
completely regardless of who hosts the HTML.

### 2.3 ⚠️ `PLATFORM.md` §3.1 is wrong in one specific, dangerous way

§3.1 says:

> Cloudflare Pages … builds from a git branch, so the two-lane deploy survives
> essentially intact: `prod` branch → production, `main` → preview.

The premise is right; the conclusion is not. Cloudflare Pages' **git integration**
puts preview branches on a **different hostname** — `<branch>.<project>.pages.dev`
— not under a `/dev/` path.

`site/fb-env.js` decides which Firestore collections a page reads and writes:

```js
export function detectDevLane(loc) {
  if (!loc) return false;
  return loc.pathname.includes('/dev/') || DEV_HOSTNAMES.includes(loc.hostname);
}
```

On a preview hostname, `pathname` has no `/dev/` and `hostname` is not
`localhost`. `detectDevLane` returns **false**, `COLLECTION_SUFFIX` becomes `''`,
and **the dev lane starts reading and writing production Firestore collections** —
`reviews`, `clubs`, `profiles`, all 18 of them. Silently. That is a
data-corruption bug, not a broken link, and it is the exact class of silent
failure `PLATFORM.md` §2.3 warns about.

**The fix is to not use the git integration at all.** Keep `deploy.yml` doing
everything it already does — checkout both branches, run the guards, assemble
`_site` with root=prod and `/dev/`=main — and replace only the final three steps:

| Remove | Replace with |
|---|---|
| `actions/configure-pages@v5` | — |
| `actions/upload-pages-artifact@v4` | — |
| `actions/deploy-pages@v5` (+ its retry) | `cloudflare/wrangler-action` running `wrangler pages deploy _site --project-name=<name> --branch=main` |

This is a **better** outcome than the git integration, on three counts:

1. `fb-env.js`, `promote.yml`, the guard suite and every `prod-*` rollback tag are
   untouched. The two-lane deploy survives *exactly*, not "essentially".
2. **The repo's visibility becomes irrelevant to the site.** Direct upload does
   not connect Cloudflare to GitHub at all, which kills the fragility in §2.4
   outright rather than merely relocating it.
3. The `deploy-pages` transient-failure retry (`deploy.yml`, "Retry deploy (Pages
   transient 'try again later' errors)") stops being needed.

### 2.4 The private-repo fragility

Recorded in the project memory `pages-dies-when-repo-goes-private.md`, from a
real incident on 2026-08-09: making `skymitch9/audiobook_catalog` private
**deletes** the Pages site, and flipping back to public does not restore it. The
Pages config is repo config, not repo content, so nothing in git records it.
Recovery is three steps and doing only the first is the trap:

```bash
gh repo edit skymitch9/audiobook_catalog --visibility public --accept-visibility-change-consequences
gh api -X POST repos/skymitch9/audiobook_catalog/pages -f build_type=workflow
gh workflow run deploy.yml -R skymitch9/audiobook_catalog
```

Failing run 31326352342 was blamed on an innocent commit. The failure presents as
`actions/configure-pages` erroring with *"verify the repository has Pages
enabled"*.

This matters more than it looks, because there is a standing reason to *want* the
repo private: `docs/TODO.md:367` — *"`site/admin.html` is a static file on
**public** GitHub Pages. The URL cannot be hidden."* Under the direct-upload
design in §2.3 the repo can go private tomorrow with no effect on the live site,
and Cloudflare Access can gate `/admin.html` at the edge if that is ever wanted.

### 2.5 What the move does *not* fix

Be honest about this: **the 381 MB `.git` does not shrink.** `PLATFORM.md` §3.2
is right that `git filter-repo` is off the table — it rewrites every hash and
breaks the `prod` branch and every `prod-*` rollback tag, which is the one
genuinely expensive state in the system.

So the outcome is: history stays ~381 MB forever, and **stops growing**. A fresh
clone stays a ~381 MB download. That is acceptable; it is not a fix.

### 2.6 Covers: what actually has to change

`PLATFORM.md` §3.2 has the design right — R2, 243 MB against a 10 GB free tier,
free egress, and reuse `scripts/upload_manifest.json`'s relative-path diff rather
than mtime. Three things it does not mention, all measured today:

**(a) ⚠️ `promote.yml`'s guard will refuse to promote the moment covers are
gitignored.** From `.github/workflows/promote.yml`:

```bash
for p in site/index.html site/catalog.csv site/covers site/static; do
  if git check-ignore -q "$p"; then
    echo "::error::$p is matched by .gitignore — this is the outage bug, refusing to promote"
```

That guard exists because gitignoring `site/` once caused a full outage, and it is
correct today. Dropping `site/covers` from that list is a deliberate,
one-line-and-a-comment change that must land **in the same commit** as the
`.gitignore` edit, or the next promote fails. The `site/index.html`,
`site/catalog.csv` and `site/static` entries all stay.

**(b) Cover URLs are relative and must become absolute.** `site/index.html`
emits `covers/Melissa%20Toppen/Force%20of%20Gravity.jpg` — relative, URL-encoded,
with spaces in author folder names. Under `/dev/` they currently resolve to
`/dev/covers/...`, which is why the artifact carries two copies. The generator
(`app/writers.py` copies covers; `app/metadata.py:233` documents the
`covers/<relative-path>/<filename>.jpg` shape) needs a single `COVERS_BASE_URL`
knob — `covers/` locally, `https://covers.<domain>/` for a build. One
implementation, one place, per the house rule about `normalise` drift.

**(c) `.gitignore` needs a negation, and the sync git-add list needs an entry.**
The existing `.gitignore` is a `*.json` denylist with explicit `!` negations for
every site JSON; the covers change is the mirror of that pattern. The
`additions-log-upload-history` memory records the same requirement for new site
JSONs.

**Local builds are unaffected.** `app/writers.py:130` copies covers from
`OUTPUT_DIR/covers/` into `site/covers/` at build time, so a fresh clone still
produces them locally; they simply get uploaded instead of committed.

### 2.7 What breaks on switch day

| # | Breaks | Fix | Who |
|---|---|---|---|
| 1 | Google sign-in, with `auth/unauthorized-domain`, if the new host is not on the Firebase list **first** | Add the apex (and `www` if used) to authorised domains **before** DNS cutover | 🔴 **Owner only** |
| 2 | **Everyone appears logged out.** `localStorage` is origin-scoped, so `ab_identity_name` / `ab_identity_session` on `skymitch9.github.io` do not travel | Nothing to fix — Google users click sign-in once. ⚠️ **Passphrase-fallback users lose their stored display name** and must re-enter it exactly, or their reviews detach from their name. Warn them | Owner (a Discord message) |
| 3 | The Discord new-book notification loses its URL. `deploy.yml:185` sets `SITE_URL: ${{ steps.deployment.outputs.page_url }}` — that output vanishes with `actions/deploy-pages` | Set `SITE_URL` to the new domain explicitly, as a repo variable or a literal | Claude |
| 4 | Old bookmarks and every historical Discord link point at `skymitch9.github.io/audiobook_catalog/` | Leave the GitHub Pages deploy running in parallel for a grace period — see §3 step 9 — then replace its `index.html` with a redirect stub | Claude |
| 5 | Cover `<img>`s 404 if the R2 bucket is not populated and public before the generator switches `COVERS_BASE_URL` | Upload first, flip the knob second. They are independent steps for exactly this reason | Claude |
| 6 | ⚠️ **Nothing** breaks in Firestore, clubs, reviews, or rules | Do not touch them. `PLATFORM.md` §2.1 | — |

**Not a problem (measured):** there is no hardcoded `/audiobook_catalog/` base
path anywhere in `site/*.html`, `site/*.js`, or `app/web/templates/*.html`. The
site is already subpath-independent, so moving from a `/audiobook_catalog/`
subpath to a domain root needs no path rewriting. This was the risk I most
expected to find and it is not there.

### 2.8 A future ceiling worth writing down

`site/index.html` is 8.2 MB for 1,073 books — about 7.6 KB per book. Cloudflare
Pages' maximum single-asset size is **25 MiB** (developers.cloudflare.com Pages
limits, fetched 2026-08-09). Straight-line extrapolation *(inferred)* puts the
wall at roughly **3,200 books**. Not urgent at 1,073, but it is a real wall and
`PLATFORM.md` §3.3's "42,115 generated lines render fine" is an argument about
the browser, not about the host.

---

## 3. Migration steps, in order

🔴 = **owner only**, cannot be scripted or done by a session.
Steps 1–4 and steps 5–8 are two independent tracks; **5–8 do not need the domain
and can start today**.

### Track A — the domain

| # | Step | Notes |
|---|---|---|
| 1 | 🔴 **Choose the name** | `PLATFORM.md` §8 q1. Criteria in §1.5 above |
| 2 | ✅ **Done — `heygabi.ai` is registered at Cloudflare Registrar** in that account (owner, 2026-08-10). No zone transfer needed. |
| 3 | ✅ **Automatic.** Cloudflare runs the nameservers for domains registered with it, so the zone was active from purchase. |
| 4 | 🔴 **Add the apex to Firebase authorised domains** — console → project `audiobook-catalog` → Authentication → Settings → Authorised domains | **Before** any cutover. `library_catalog/docs/access/cloudflare.md` §5. Leave the existing `*.workers.dev` entries in place |

### Track B — covers out of git (do this even if the domain never happens)

| # | Step | Notes |
|---|---|---|
| 5 | Create the R2 bucket, upload all 1,843 covers once | ~243 MB. Reuse the `scripts/upload_manifest.json` relative-path diff pattern, not mtime |
| 6 | 🔴 **Attach `covers.<domain>` to the bucket** as a public custom domain | Needs the zone from step 3. Interim: an `r2.dev` public URL works and is swappable later |
| 7 | Add `COVERS_BASE_URL` to the generator; verify a dev build renders covers from R2 | One knob, one implementation |
| 8 | In **one commit**: gitignore `site/covers/`, `git rm -r --cached site/covers`, and drop `site/covers` from `promote.yml`'s check-ignore guard | §2.6(a). Splitting this commit breaks the next promote |

### Track C — the host move

| # | Step | Notes |
|---|---|---|
| 9 | Create the Pages project (direct upload, **no git connection**) and add the wrangler-action step to `deploy.yml` **alongside** the existing `deploy-pages` steps | Both lanes publish to both hosts. This is the safety net; do not delete anything yet |
| 10 | 🔴 **Attach the apex + `www`** to the Pages project | |
| 11 | Verify on the new domain: root serves prod, `/dev/` serves main, `/dev/` writes to `*_dev` collections, Google sign-in completes, covers load from R2 | The `/dev/` collection check is the one that matters — §2.3 |
| 12 | Replace `SITE_URL` in `deploy.yml` with the new domain | §2.7 row 3 |
| 13 | 🔴 **Announce the move**, warning passphrase users about the display name | §2.7 row 2 |
| 14 | After a grace period (2 weeks is a guess, not a measurement), remove the `actions/*-pages` steps and leave a redirect stub on the old host | |
| 15 | 🔴 **Optional: make the repo private.** Nothing on the live site depends on it any more | Addresses `docs/TODO.md:367` |

### Track D — the other two apps (after A)

| # | Step | Notes |
|---|---|---|
| 16 | 🔴 Add `library.<domain>` to Firebase authorised domains, then attach it as a Worker custom domain | `cloudflare.md` §6: nothing in `wrangler.toml` changes; the app follows its origin |
| 17 | Move `Board_Game_Catalog` from Cloudflare Access to Firebase ID tokens | `PLATFORM.md` §4 — **and its §4.1 checklist is a prerequisite, not a nicety.** Access blocks at the edge today; removing it makes the Worker the only gate |
| 18 | 🔴 Add `games.<domain>`, then attach it | After 17, not before — Access's per-URL audiences (`CF_ACCESS_AUD` lists two) would need a third |
| 19 | The index Worker at `index.<domain>` | `PLATFORM.md` §5 and §7 stage 2 step 4. Unbuilt |

---

## 4. What it costs

Fetched from Cloudflare's own docs on **2026-08-09**. Anything not fetched is
labelled.

### 4.1 Recurring

| Item | Cost | Basis |
|---|---|---|
| Domain, `.ai` | ⚠️ **`.ai` is far more expensive than `.com`** — typically in the region of $70–100/yr at registry cost, not $11–13. Already purchased, so this is a renewal cost to know rather than a decision. *(Not verified — check the actual renewal price in the Cloudflare dashboard.)* | Cloudflare Registrar is at-cost: *"only pay what is charged by registries and ICANN… No markup."* Verisign's `.com` wholesale price rises most years, so I will not quote a figure I did not read |
| Cloudflare Registrar markup | **$0** | Their pricing page, fetched today |
| WHOIS privacy | **$0** | *"redacted WHOIS information by default"* |
| DNS zone | **$0** | Free plan |
| **Total recurring** | **~$11–13/yr** | |

### 4.2 Cloudflare services, against measured usage

| Service | Free tier | This project needs | Verdict |
|---|---|---|---|
| **R2 storage** | 10 GB-month | **243 MB** (measured) | Free, 2.4% used |
| **R2 Class A** (writes) | 1M/month | 1,843 on the initial upload, then only changed covers | Free |
| **R2 Class B** (reads) | 10M/month | *(estimate)* a household-scale audience × ~50 covers per page view — orders of magnitude under | Free |
| **R2 egress** | **Free, unlimited** | 243 MB of images | Free. This is the line that makes R2 the right answer |
| **Pages** | 500 builds/month, 20,000 files, 25 MiB/file, 100 custom domains | Pipeline runs 3×/day → ~90–100 builds/month (`docs/TODO.md`). **1,882 files today, ~40 after covers move.** Largest file 8.2 MB | Free, comfortably |
| **Workers requests** | 100,000/day | Two private apps, two users | Free |
| **Workers CPU** | 10 ms/invocation on Free | ISBN and vision calls are I/O-bound, not CPU-bound | *(inferred)* fine — but see below |
| **D1 rows read** | 5M/day | ~860 works + 775 items | Free |
| **D1 storage** | 5 GB | Two small databases | Free |
| **Zero Trust / Access** | $0 up to 50 users | Being removed anyway (§3 step 17) | Free — and `Board_Game_Catalog/docs/access/login.md` already verified this |

**Paid rates, if any of that were ever exceeded:** R2 $0.015/GB-month, Class A
$4.50/M, Class B $0.36/M. D1 $0.75/GB-month over 5 GB. Workers Paid is
$5/month minimum with 10M requests included.

### 4.3 Needs checking

- The actual `.com` registry price on the day of purchase.
- **Whether the two Workers are already on Workers Paid.** I did not check the
  account. If a `$5/month` subscription already exists for another reason, the
  free-tier analysis above is moot and everything here is $0 marginal.
- Whether Workers **custom domains** are available on the Workers Free plan.
  `library_catalog/docs/access/cloudflare.md` §6 documents the procedure without
  mentioning a plan requirement, which is suggestive but not proof. *(High
  confidence they are free; verify before promising it.)*
- Cloudflare Pages documents a 20,000-file cap and a 25 MiB per-file cap but **no
  total-site-size cap** that I could find. Absence of a documented limit is not
  the same as no limit; at ~14 MB after covers leave, it is moot either way.

### 4.4 What GitHub Pages costs today

$0, and that does not change. **Cost is not a reason to move.** The reasons are
the 514 MB / 1 GB published-site ceiling (§2.2), the private-repo fragility
(§2.4), and vendor coherence once three of five hosts are Cloudflare anyway.

---

## 5. What not to do

| Don't | Why |
|---|---|
| ⚠️ **Use the Cloudflare Pages git integration** | Preview branches land on their own hostname, so `fb-env.js`'s `/dev/` detection fails and the dev lane writes to **production** Firestore collections. §2.3. This is the single most likely way to break something badly |
| ⚠️ **Put two apps on one origin** | `identity.js:44–54` signs out the shared Firebase Auth session on every audiobook page load. §1.2 |
| ⚠️ **Gitignore `site/covers` without editing `promote.yml`** | Its guard fails the promote by design. §2.6(a). And **never** gitignore `site/` itself — that guard is correct and stays |
| ⚠️ **`git filter-repo` to reclaim the 381 MB** | Rewrites every hash; breaks the `prod` branch and every `prod-*` rollback tag. `PLATFORM.md` §3.2. The tags are the rollback mechanism |
| **Merge the three databases** | `PLATFORM.md` §2.2 and §6: three lifecycles. Catalog facts are overwritten by re-sync; collection facts are yours forever. The index holds a projection, nothing is merged |
| **Create a second Firebase project** | `library_catalog/docs/access/cloudflare.md` §5: *"a second project mints different tokens for the same human and silently forks every user."* `FIREBASE_PROJECT_ID` stays `audiobook-catalog` |
| **Move Firestore to D1, or change the auth provider** | Ruled out by the owner. `PLATFORM.md` §2.1 |
| **Add `covers.` or `index.` to Firebase authorised domains** | Nothing signs in there; each entry is an OAuth redirect surface. §1.4 |
| **Remove the `*.workers.dev` authorised domains after cutover** | They are the escape hatch. `cloudflare.md` §6: *"The old one can stay"* |
| **Add an R2 bucket for scan photos** | Both Worker repos deleted theirs deliberately — `wrangler.toml` comment in `Board_Game_Catalog`, `cloudflare.md` §7 in `library_catalog`. A covers bucket is a different thing and does not reopen that |
| **Delete the GitHub Pages deploy on day one** | Parallel-publish for a grace period costs nothing and is the rollback. §3 step 9 |
| **Bundle Track B and Track C into one change** | Covers-to-R2 is valuable on GitHub Pages alone and is the urgent half. Coupling it to a host move means neither ships |

---

## 6. Where this departs from `PLATFORM.md`

Three departures, all refinements rather than reversals.

| § | `PLATFORM.md` says | This says |
|---|---|---|
| §3.1 | Pages "builds from a git branch, so the two-lane deploy survives essentially intact: `prod` → production, `main` → preview" | **Correct premise, unsafe conclusion.** Use direct upload from the existing workflow. §2.3 |
| §3 table | `<domain>` is a Pages project serving a *"public read view of all three"*, implicitly separate from the audiobook site — and §8 q2 leaves the repo question open | **Answer q2: re-point the audiobook repo.** §3.3 already says the combined view is "one more fetch" onto the existing page. A second repo means two generators for one page |
| §1 | The problem is *"in one number: `.git` is 377 MB"* | The *nearer* number is the **~514 MB published site against a 1 GB hard limit**, because `deploy.yml` copies covers into both lanes. §2.2. The `.git` figure is against a *recommended* limit; this one is against a real one |

Everything else — subdomain shape, R2 for covers, no history rewrite, no merged
databases, Firestore untouched, Firebase ID tokens for the editor Workers — is
`PLATFORM.md`'s design, unchanged.

---

## 7. Open questions for the owner

| # | Question | Blocks | Why it needs you |
|---|---|---|---|
| 1 | **What is the domain name?** | Everything in Track A | Taste, and only you can buy it |
| 2 | Apex or `www` as the canonical host? | Step 10, and the Firebase entry in step 4 | One of them is the auth origin; changing it later means re-authorising |
| 3 | **Do the passphrase-fallback users matter enough to warn individually?** | Step 13 | Their identity is a `localStorage` display name that will not survive the origin change. `library_catalog/docs/HANDOFF.md` open q4 flags the same people from the other side |
| 4 | Does the repo go private after the move? | Step 15 | It closes `docs/TODO.md:367`'s unlisted-not-protected `admin.html` gap, but changes how you and anyone else browse the source |
| 5 | Are the Workers already on a paid Cloudflare plan? | §4.3 | Decides whether the cost section is "~$12/yr" or "~$12/yr on top of $60/yr you already pay" |
| 6 | ⚠️ Is `games.<domain>` worth the Access removal? | Step 17 | It is the **only** step here that reduces security. `PLATFORM.md` §4.1 accepts it knowingly for one-sign-in; if you would rather keep Access's edge block, the board game app simply stays on `*.workers.dev` and the platform is still coherent |
| 7 | `PLATFORM.md` §8 q3, still open: do games and books get public *browse*, or only the cross-format signal? | The index's projection, step 19 | Changes what §5.2's field list has to be safe against |

---

## Sources

Every claim above traces to one of these. Files were read on **2026-08-09**;
web pages were fetched the same day.

**Repos**
- `bookbuddy/audiobook_catalog/.github/workflows/deploy.yml` — two-lane artifact assembly, `SITE_URL`, Pages actions
- `bookbuddy/audiobook_catalog/.github/workflows/promote.yml` — the check-ignore guard, `prod-*` tagging
- `bookbuddy/audiobook_catalog/site/fb-env.js` — `detectDevLane`, `COLLECTION_SUFFIX`
- `bookbuddy/audiobook_catalog/site/identity.js` — `detachStaleFirebaseAuth`, popup vs redirect, the deliberate `signOut`
- `bookbuddy/audiobook_catalog/.gitignore` — the `*.json` denylist and its negations
- `bookbuddy/audiobook_catalog/firebase.json` — rules only; no hosting config
- `bookbuddy/audiobook_catalog/docs/TODO.md` — `admin.html` (:367), pipeline cadence, two-lane infra notes
- `bookbuddy/library_catalog/docs/access/cloudflare.md` — §2 Workers-not-Pages, §5 authorised domains, §6 custom domains, §7 no R2 / no Access
- `bookbuddy/library_catalog/docs/HANDOFF.md` — live URL, shared Firebase project, review bridge, finding 4
- `boardbuddy/Board_Game_Catalog/apps/worker/wrangler.toml` — D1 id, crons, `CF_ACCESS_*`, the no-R2 comment
- `boardbuddy/Board_Game_Catalog/docs/access/login.md` — Zero Trust free-tier costs
- `boardbuddy/Board_Game_Catalog/docs/SETUP.md` — the live Worker URL
- `catalog-platform/docs/PLATFORM.md`, `LIBRARY_CATALOG.md`, `README.md`
- Project memory: `pages-dies-when-repo-goes-private.md`, `hosting-stays-github-pages.md`, `combined-site-architecture.md`

**Fetched 2026-08-09**
- `developers.cloudflare.com/r2/pricing/`
- `developers.cloudflare.com/d1/platform/pricing/`
- `developers.cloudflare.com/workers/platform/pricing/`
- `developers.cloudflare.com/pages/platform/limits/`
- `developers.cloudflare.com/registrar/`
- `docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits`

**Not verified**
- The `.com` registry price (deliberately not quoted).
- Whether the Cloudflare account is on a paid Workers plan.
- Whether Workers custom domains require a paid plan.
- That Firebase Auth persistence is keyed by origin + API key + app name — this
  is the mechanism behind §1.2's headline finding and is *inferred*. The
  `signOut()` call itself is measured.
