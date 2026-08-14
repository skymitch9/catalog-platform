# heygabi-home

> **Audience:** Claude sessions and the owner. **Status:** **LIVE** at
> <https://heygabi.ai>. Last verified: **2026-08-10** — apex and `www` both
> answered `200` and the CSP arrived from `_headers`.
>
> ⚠️ **A DEPLOY IS PENDING (2026-08-13).** The global search landed in `#find`
> and the estate admin page landed at `/admin` (estate-auth-design.md §14.4),
> on top of the still-undeployed 2026-08-10 `/todo` board. The deployed site
> is **not** what this directory holds. `deploy.md` §4 is the one command.
> 🔴 Before or with that deploy the owner must add `heygabi.ai` to Firebase
> authorised domains (console-only), or sign-in answers
> `auth/unauthorized-domain` — the page renders that as an owner-action
> message rather than a broken button, but search stays unusable until the
> entry exists.
>
> ⚠️ **This used to be its own repo, `vs-code-repos/heygabi-home`. It moved here
> on 2026-08-10** — see the root [`README.md`](../../README.md) for why. Paths in
> this file and in `deploy.md` are relative to `sites/heygabi-home/`; the
> **deploy command now runs from the repo root and names `sites/heygabi-home/public`**.

The landing page for the apex domain **`heygabi.ai`** (and `www.heygabi.ai`),
the estate-wide search in its `#find` section, the estate admin page at
**`heygabi.ai/admin`**, and the cross-project board at **`heygabi.ai/todo`**.

Static HTML plus a few hand-written ES modules. No build step, no
dependencies beyond the Firebase SDK loaded from Google's CDN, no framework,
no package manager.

---

## What it is

A signpost. It names the site, says in one line what it is — a personal
catalogue of what this household owns — and links the three catalogues:

| Catalogue | Host | State |
|---|---|---|
| Audiobooks | `audiobooks.heygabi.ai` | linked (`index.html:589`) |
| Books (print **and** ebook) | `library.heygabi.ai` | linked (`index.html:602`) |
| Board games | `boardgames.heygabi.ai` | linked, no badge (`index.html:615-619`) |

### The board games card has changed twice, and both times for the same reason

**Coming soon → link (2026-08-09).** It was rendered as an unclickable card
because the host did not exist, and a link would have been a promise about a
name nobody controlled. `boardgames.heygabi.ai` went live, so it became a real
`<a>`.

**"Owner only" → no badge (2026-08-10).** The pill was honest while Cloudflare
Access turned strangers away at the edge: telling someone the door is shut beats
letting them find out by bouncing off a login wall they can do nothing about.
Access was deleted that day, so the badge stopped being honest — signing in now
means *joining a queue*, not being refused, and "Owner only" would turn away
precisely the people the change was made for. The card behaves like Books now,
which also asks for a sign-in and has never worn a pill.

⚠️ The catalog is **not** public. A stranger reaches its sign-in screen, signs
in, lands as `pending`, and sees a waiting screen — never the collection. See
`Board_Game_Catalog/docs/access/firebase-auth.md`.

The `.pill.locked` and `.card.soon` rules are kept in the stylesheet, unused,
for the next shelf.

---

## `/todo` — the cross-project board

Added **2026-08-10**. `public/todo/index.html`, linked from the front door's
footer. It lists work that is agreed but not built across all three catalogues
*and* this site, and tags each item by how far it reaches.

**The taxonomy.** Every item declares which projects it touches
(`p-audio` / `p-books` / `p-games` / `p-landing`) and carries **one** derived
scope class:

| Scope | Means |
|---|---|
| `s-landing` | `p-landing` only — this site |
| `s-one` | exactly one catalogue |
| `s-some` | more than one catalogue, not all three |
| `s-all` | all three catalogues (`p-landing` may ride along) |

⚠️ **Scope is derived, not independent.** It is written out as a class and as a
visible badge purely because CSS cannot compute it; if the projects change, the
scope and the badge change with them. Two fields free to disagree is how a board
starts lying.

**The filter is CSS-only** — six visually-hidden radios, `<label>` chips, and
`:checked ~` rules. There is no JavaScript here and there cannot be: `_headers`
sets `default-src 'none'` with no `script-src`. ⚠️ The `<input>`s **must stay
direct siblings** of `.filters` and `.board`; wrapping them in a `<fieldset>`
for tidiness kills every `~` rule and the filter fails **silently**. `deploy.md`
§3 has the tap-test that catches it.

A project filter matches on **membership**, so an all-projects item appears
under Audiobooks *and* Books *and* Board games. That is the honest answer to
"what is coming for this shelf?".

### ⚠️ It is authored here, not aggregated — and it is public

The three projects' work logs (`library_catalog/docs/TODO.md`,
`Board_Game_Catalog/docs/TODO.md` + `open-questions.md`,
`audiobook_catalog/docs/TODO.md`) stay authoritative. This page is a **curated
summary** of them, retyped by hand.

Aggregating was rejected on three grounds, and the third is the one that
matters: the page cannot fetch (CSP), the site has no build step to bake them in
at, the files share no parsable shape — and **anything aggregated would be
published verbatim**. Those logs contain token names, auth weaknesses, purchase
history and prices. None of that may appear on a host with no authentication.

**So: no secrets, no security posture, no order detail.** Restate an item as a
feature or a chore, or leave it in the project's own docs. If it cannot be
phrased safely, it does not go on the board.

The cost of authoring here is duplication — closing something in a project's log
does not close it here. That is paid by hand, deliberately. **Delete finished
items** rather than striking them through; the project's own log is the
historical record.

`noindex` is set on this page: public and linkable, but not a search result.

⚠️ **No counts.** CSS cannot count what a filter matched and a typed total goes
stale on the next edit — the same rule the front door learned from an invented
game count.

---

## ⚠️ The one rule, rewritten 2026-08-13: sign-in exists ONLY to mint bearer tokens

This section used to say **NO AUTH ON THIS HOST. EVER.** That rule was
**overturned deliberately** by the owner's global-search requirement, with the
full arguing in `docs/info/estate-auth-design.md` §7.2 — read that before
moving anything. The short form:

- The old rule's hazard — `audiobook_catalog/site/identity.js` calling
  `signOut()` on the shared Firebase Auth instance on page load — is real and
  stays guarded **where it applies: two apps on one origin**. Firebase auth
  state is origin-scoped, so a session on `heygabi.ai` and the capture-detach
  dance on `audiobooks.heygabi.ai` cannot touch each other. (Origin-scoping is
  the design's one verify-during-build claim: the §15 attended two-tab test.)
- The residual cost is paid knowingly: `heygabi.ai` is now a Firebase
  **authorised domain** (🔴 owner console entry) — one more permanent OAuth
  redirect surface, priced in by `HEYGABI_LAYOUT.md` §1 from the start.

The new rule, as load-bearing as the old one: **the Firebase SDK loads to mint
ID tokens sent as bearers to `index.heygabi.ai` (search) and
`auth.heygabi.ai` (the `/admin` API), and for nothing else.** No session for
browsing, no personalisation, no "my ratings", no gating of the page, no
membership logic in the browser — the canonical `packages/estate-auth` module
lives in the Workers. If a feature here appears to need more than sign-in +
bearer, it belongs on a catalogue host.

The rule is repeated as a comment at the top of `public/index.html`, which is
where anyone about to break it will actually be looking.

## ⚠️ The second rule, narrowed 2026-08-13: external requests are allow-listed

Formerly "zero external requests". The search spent that rule too, knowingly
and narrowly: the front door and `/admin` may reach **exactly** the hosts in
`public/_headers`' CSP — the Firebase SDK on `www.gstatic.com`, Google's auth
endpoints, the two estate Workers, and the known cover/avatar image hosts.
Still absolutely absent: analytics, web fonts, CDN frameworks, and anything
not named in that file. Inline `<script>` stays blocked (`script-src 'self'`),
so the page cannot grow ad-hoc JS — logic lives in `/assets/*.js`.

**`/todo` keeps the original `default-src 'none'` no-JS CSP** — its filter is
CSS-only radios and must never acquire JavaScript. ⚠️ The CSP now lives on
**per-path rules, not `/*`** (two pages, two policies; a path matching two CSP
rules would be enforced as their intersection). A new page under `public/`
ships with **no CSP** until a rule is added in `_headers` — add one, strict by
default, in the same commit as the page.

---

## The cross-format search and the admin page (built 2026-08-13, §14.4)

The `#find` slot grew into the real thing: a search box querying
`index.heygabi.ai/api/lookup` with the signed-in user's Firebase ID token,
plus `/admin` calling `auth.heygabi.ai`'s admin API (whose CORS names exactly
`https://heygabi.ai` — owner decision #6 put the admin page here so that
Worker needs no Firebase authorised-domain entry of its own).

- **Signed out, the page stays whole** — the search box asks for a sign-in;
  nothing else on the page knows who you are. Signed-in-but-pending gets the
  honest queue message in the same words as the apps' request screens.
- ⚠️ **A result means "in the catalog — tap through", never "you own this".**
  Ownership deliberately does not travel to the index (29 of the 836 game rows
  are wanted-only); `find.js`'s caveat line is load-bearing copy.
- Results render in the index design's two tiers: books (library + audiobook —
  same work, any format) and board games (title-only match, carrying `kind`
  and `parent_source_id`), with an "everything in <universe>" follow-up on
  rows that carry a universe — the only cross-format join games take part in.
- The projection stays **default-deny** (`PLATFORM.md` §5.2 — no prices, no
  `lent_to`, no per-person ratings, no emails); the reads are
  **estate-members-only** (`index-worker-design.md` §9 Q3).
- `/admin` is a household directory of a handful of rows: list by status
  (pending first), approve, revoke, promote-to-approver. It is **never the
  only way in** — `OWNER_EMAILS` on the auth Worker is the break-glass, and
  the page says so on its face.

---

## Visual language (retheme 2026-08-13: the estate THEME SYSTEM)

The page runs `assets/estate-theme.css` + `assets/theme.js` — **three
user-selectable themes** (apple = default here, cyberpunk extracted from the
audiobook site, retro extracted from the games app) **× light/dark**, chosen
in the settings cog (top-right) and persisted per site in localStorage
`hg_theme`/`hg_mode`. This is a **platform asset**, canonical in this
directory; `docs/info/estate-themes.md` is the adoption guide (per-site
defaults are identity — audiobooks stays cyberpunk, games stays retro, the
library adopts apple next). Page CSS styles against `--et-*` tokens ONLY — a
raw color in `index.html`'s stylesheet is a bug.

Phone first, full-width stacked sections, 44px minimum tap targets. Motion
(viewport reveals, hero recede, the apple-scoped cursor tilt, the cog's
quarter-turn) lives in `assets/motion.js` and dies entirely under
`prefers-reduced-motion`.

---

## Files

All paths are under `sites/heygabi-home/`.

| File | Purpose |
|---|---|
| `public/index.html` | The front door: hero, the `#find` search, the three shelf tiles (Audio / Books / Games), the settings cog. Tokens-only page CSS |
| `public/assets/estate-theme.css` | ⚠️ **The estate THEME SYSTEM — a platform asset, canonical here** (`docs/info/estate-themes.md` is the adoption guide). Three themes × light/dark on one `--et-*` contract, the primitives, the cog styling, the motion machinery |
| `public/assets/theme.js` | The switcher: classic pre-paint script stamping `data-theme`/`data-mode`; localStorage `hg_theme`/`hg_mode`; `window.estateTheme`; wires the cog |
| `public/assets/motion.js` | The motion vocabulary: viewport reveals, hero recede, apple-scoped cursor tilt. All dead under `prefers-reduced-motion` |
| `public/assets/fonts/` | Self-hosted theme faces (OFL latin subsets): Rajdhani + Share Tech Mono (cyberpunk), Bangers + Luckiest Guy (retro, copied from the games repo with its licence). Keeps `font-src 'self'` true |
| `public/assets/estate-auth.js` | Firebase sign-in, ported (minimum) from audiobook `identity.js` — popup-first, redirect fallback, `auth/unauthorized-domain` → owner-action message. ⚠️ Keeps the session (unlike identity.js): its job is minting bearer tokens |
| `public/assets/find.js` | The search UI: lookup + universe queries, two-tier rendering, the in-catalog-not-owned caveat |
| `public/admin/index.html` + `admin.js` | The estate member directory at `/admin` — approve / revoke / promote against `auth.heygabi.ai`'s admin API. Same theme system, same cog |
| `public/todo/index.html` | The cross-project board at `/todo`. Still no-JS (and therefore unthemed — its CSP forbids the switcher); its filter is CSS-only radios |
| `public/_headers` | Cloudflare Pages headers — per-path CSPs: allow-listed hosts on `/` and `/admin` (style-src + font-src `'self'` for the theme system), `default-src 'none'` on `/todo` |
| `deploy.md` | Exact steps to create the Pages project and attach the domains |
| `README.md` | This file |
| `.gitattributes` | Pins this subtree to LF. `_headers` is parsed by Cloudflare, not git, and `core.autocrlf` is on globally on this machine |
| `.gitignore` | Keeps OS cruft and wrangler's `.wrangler/` cache out. Scoped to this directory |

⚠️ **`public/` is the deploy root, and that split is deliberate.** A Pages direct
upload publishes every file in the uploaded directory. Deploying
`sites/heygabi-home/` would put `README.md` and `deploy.md` — which describe the
internal architecture — at `https://heygabi.ai/README.md`. Keeping the site in
`public/` means the docs cannot be published by accident, and **that now guards
the whole platform repo**: the upload root is one named directory, so nothing in
`docs/` can reach the public site either. There is still no build step:
`public/` is uploaded as-is.

## Local preview

Open `public/todo/index.html` in a browser — the board is still
zero-dependency. The front door and `/admin` render from `file://` too, but
their JS will not run there (ES modules need an http origin) and sign-in
cannot work anywhere but the deployed apex: `localhost` is not the CORS
origin the auth Worker allows, and Firebase popup auth wants an authorised
domain. (`_headers` is a Pages-only file and has no effect locally, so a
local preview never verifies the CSP either — check everything dynamic on the
deployed site.)

⚠️ Opened as a `file://` URL, the footer link `/todo` and the board's back link
`/` both resolve against the filesystem root and 404. That is the local preview
being local, not a broken link — serve the directory or check them on the
deployed site.

## Committing on Windows

**Always `git commit -F <file>`. Never `-m`.** This shell is PowerShell, and a
`-m` message containing double quotes, an em dash or a newline gets mangled
before git ever sees it — the observed failure is `error: unknown option`, with
the commit silently not happening.

## Repo state

Lives in **`catalog-platform`**, under `sites/heygabi-home/`, pushed to
`github.com/skymitch9/catalog-platform`.

The standalone `heygabi-home` repo that used to hold this — locally at
`vs-code-repos/heygabi-home`, remote `github.com/skymitch9/heygabi-home` — was
retired on 2026-08-10 and its three commits were merged here with their history
intact. ⚠️ **Do not re-create it.** The page is governed by `docs/HEYGABI_LAYOUT.md`
and `docs/PLATFORM.md`, which live in this repo; the split meant every change to
the front door had to be reasoned about in one repo and made in another.

Deployment is still the owner's, per [`deploy.md`](deploy.md). The Pages project
is `heygabi-home` in Cloudflare account `Nbaslamking@gmail.com's Account`
(`113be82b840c956b8378a187047ab3ea`) — **the project name did not change with
the repo**, and renaming it would mint a new `*.pages.dev` and re-issue certs
for no gain.
