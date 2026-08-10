# heygabi-home

> **Audience:** Claude sessions and the owner. **Status:** BUILT, NOT DEPLOYED.
> Last verified: **2026-08-09**.

The landing page for the apex domain **`heygabi.ai`** (and `www.heygabi.ai`).

One static HTML file. No build step, no dependencies, no framework, no package
manager. `public/index.html` is the whole site.

---

## What it is

A signpost. It names the site, says in one line what it is — a personal
catalogue of what this household owns — and links the three catalogues:

| Catalogue | Host | State |
|---|---|---|
| Audiobooks | `audiobooks.heygabi.ai` | linked |
| Books (print **and** ebook) | `library.heygabi.ai` | linked |
| Board games | `boardgames.heygabi.ai` | **not linked** — rendered as "Coming soon", not clickable |

### Why board games is not a link

`boardgames.heygabi.ai` does not exist yet.
`catalog-platform/docs/HEYGABI_LAYOUT.md` §4 Track C puts it **last** (step 14),
gated behind removing Cloudflare Access from the `Board_Game_Catalog` Worker
(`PLATFORM.md` §4.1). So the choice was between a link that 404s and an honest
"coming soon".

It is rendered as a `<div>` inside the `<li>` with **no `<a>`** — not clickable,
not keyboard-focusable, not crawlable. A dead link on the front door produces an
unbranded Cloudflare error page rather than "not ready yet", and while the host
is unclaimed a link is a promise about a name nobody controls.

**To go live:** in `public/index.html`, delete the `<li>` holding `.card.soon`,
uncomment the linked `<li>` directly below it, and delete the explanatory
comment. No CSS change is needed.

---

## ⚠️ The one rule: NO AUTH ON THIS HOST. EVER.

**Do not add a sign-in button. Do not add the Firebase SDK. Do not add
`heygabi.ai` to Firebase → Authentication → Settings → Authorised domains.**

`audiobook_catalog/site/identity.js` calls `signOut()` on the **shared** Firebase
Auth instance on page load. A second auth origin for the same Firebase project is
therefore actively hostile — one host can sign the user out from under another.
`HEYGABI_LAYOUT.md` §1.3 and §6 make the same argument for the redirect-only
hosts: a host that never runs a sign-in never needs to be an authorised domain,
and adding one "just in case" is the failure mode.

`HEYGABI_LAYOUT.md` §1 lists the apex as an authorised domain *"if anything there
signs in"*. Nothing here signs in, so the answer stays **no**.

Every catalogue does its own sign-in on its own host. If a feature here appears
to need a logged-in user, that feature belongs on a catalogue host.

The rule is repeated as a comment at the top of `public/index.html`, which is
where anyone about to break it will actually be looking.

## ⚠️ The second rule: zero external requests

No CDN, no web fonts, no analytics, no remote images, no favicon file. System
fonts and one inline SVG data URI for the icon. The page renders identically with
the network cut after first byte and sets no cookies.

`public/_headers` ships a Content-Security-Policy that enforces this at the edge,
so a regression fails visibly in the console instead of quietly phoning home.

---

## Growing into the cross-format index

`PLATFORM.md` §5 describes a cross-format index Worker at `index.heygabi.ai`
answering *"do we own this in any format?"* across all three catalogues. This
page is eventually its front end. That was designed as an **additive** change:

- `<section id="find">` is a reserved slot holding a one-line note. Drop a search
  input and a results list in there.
- The catalogue cards are a plain `<ul class="catalogues">`. The index sits
  **above** them; it does not replace them.
- A `fetch()` to `https://index.heygabi.ai` would be the first external request
  this page makes. That is a deliberate, allowed exception — same-site and
  first-party — and it requires widening `connect-src` (and `script-src`) in
  `public/_headers`. It does not open the door to fonts, analytics or CDNs.
- ⚠️ The index must stay a **public, default-deny projection** (`PLATFORM.md`
  §5.2 — no prices, no `lent_to`, no per-person ratings, no email addresses). A
  personalised index would need auth, and auth is the thing this host must never
  have.

---

## Visual language

The palette and type deliberately echo
`bookbuddy/library_catalog/apps/web/src/styles.css` — same tokens
(`--bg` / `--fg` / `--muted` / `--line` / `--accent` / `--panel`), same warm
paper-and-ink feel, same system-font stack, same 44px minimum tap target — but
**nothing is imported from it**. If that app's palette changes, this drifts, and
that is acceptable: the goal is "same family", not one stylesheet in two places.

Phone first. Single column; above 34rem the cards become a two-column grid with
Audiobooks spanning both. Dark and light via `prefers-color-scheme` only — there
is no theme toggle and no stored preference, because that would need JavaScript
and storage this page does not otherwise have.

---

## Files

| File | Purpose |
|---|---|
| `public/index.html` | The entire site. Inline CSS, inline SVG favicon, no JS |
| `public/_headers` | Cloudflare Pages headers — CSP that forbids external requests |
| `deploy.md` | Exact steps to create the Pages project and attach the domains |
| `README.md` | This file |

⚠️ **`public/` is the deploy root, and that split is deliberate.** A Pages direct
upload publishes every file in the uploaded directory. Deploying the repo root
would put `README.md` and `deploy.md` — which describe the internal architecture
— at `https://heygabi.ai/README.md`. Keeping the site in `public/` means the docs
cannot be published by accident. There is still no build step: `public/` is
uploaded as-is.

## Local preview

Open `public/index.html` in a browser. There is nothing to install and nothing to
serve. (`_headers` is a Pages-only file and has no effect locally, so a local
preview does **not** verify the CSP — check that on the deployed site.)

## Committing on Windows

**Always `git commit -F <file>`. Never `-m`.** This shell is PowerShell, and a
`-m` message containing double quotes, an em dash or a newline gets mangled
before git ever sees it — the observed failure is `error: unknown option`, with
the commit silently not happening.

## Repo state

Local only. `git init`, no remote, never deployed by a session. Deployment is the
owner's, per `deploy.md`.
