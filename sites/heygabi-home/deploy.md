# heygabi.ai — Deploy Reference

> **Audience:** Claude sessions and the owner. **Status:** **RUN, and live.**
> Pages project `heygabi-home` exists; `heygabi.ai` and `www.heygabi.ai` both
> answered `200` on **2026-08-10** (`curl -s -D - -o /dev/null`). Last verified:
> **2026-08-10**.
>
> §1 and §2 are therefore **history** — kept because they are the record of how
> the objects were made, and the rebuild instructions if the project is ever
> lost. **§4 is the section you want for a routine deploy.**
>
> ⚠️ **The deploy path gained a segment** when this site moved into
> `catalog-platform` on 2026-08-10. Commands below run from the **repo root** and
> name `sites/heygabi-home/public`. A stale `wrangler pages deploy public` from
> the root will fail on a missing directory — which is the safe failure; the
> dangerous typo is deploying a directory that *does* exist and contains docs.
>
> Steps written from [`../../docs/HEYGABI_LAYOUT.md`](../../docs/HEYGABI_LAYOUT.md)
> §1 and §4 (which records the apex as **Pages, direct upload**, and confirms the
> zone is already in the Cloudflare account because `heygabi.ai` is registered at
> **Cloudflare Registrar**). ⚠️ Menu labels below were **not** re-checked against
> the dashboard on 2026-08-10 — they drift, so read a step's intent, not its
> exact wording.

🔴 = owner only. A session must not run these.

---

## 0. Before you start

| Check | Why |
|---|---|
| The `heygabi.ai` zone shows **Active** in Cloudflare | `HEYGABI_LAYOUT.md` §4 Track A step 3. Nothing below works until it is |
| You are in the **same Cloudflare account** as the two Workers | Registrar, zone and Pages project must share an account or the custom-domain step cannot see the zone |
| ⚠️ You are deploying **`sites/heygabi-home/public`**, not the repo root and not `sites/heygabi-home` | Either wrong root publishes `README.md` and `deploy.md` at `https://heygabi.ai/README.md`; the repo root would also publish all of `docs/` |

**Firebase, revised 2026-08-13 (estate-auth-design.md §7.2 / §14.4):** the
apex now signs in, so 🔴 **the owner must add `heygabi.ai` to Firebase
authorised domains** (console → project `audiobook-catalog` → Authentication →
Settings → Authorised domains) — before or with the deploy that ships the
search, or sign-in answers `auth/unauthorized-domain` (the page renders that
as an owner-action message, not a broken button). ⚠️ `www.heygabi.ai` stays
**off** the list — it should become a redirect-only host (§2.1), and the
admin API's CORS names the apex alone anyway. `auth.heygabi.ai` and
`index.heygabi.ai` also stay off: no sign-in popup ever runs there.

---

## 1. Create the Pages project (direct upload)

Two equivalent routes. Pick one; do not do both.

### 1a. Dashboard 🔴

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** tab →
   **Upload assets**.
2. Project name: **`heygabi-home`**.
   ⚠️ This name is permanent-ish and mints `heygabi-home.pages.dev`. It **no
   longer matches a repo name** — the repo is `catalog-platform` now — and that
   is fine. Renaming the project would mint a new `*.pages.dev` and re-issue
   certificates to buy tidiness.
3. Drag the **`sites/heygabi-home/public`** folder (not the repo root, not
   `sites/heygabi-home`, not a zip).
4. **Deploy site**.
5. Confirm `https://heygabi-home.pages.dev` loads before touching DNS.

### 1b. Wrangler CLI

Runs from the repo root. Requires a login already in place
(`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` in the environment).

```bash
# once — already done; here for a rebuild
npx wrangler pages project create heygabi-home --production-branch main

# every deploy
npx wrangler pages deploy sites/heygabi-home/public --project-name heygabi-home
```

Notes:

- `--production-branch main` is required by the CLI even though this is a direct
  upload with no git connection. It only labels which uploads count as
  production.
- ⚠️ **On Windows, wrangler sometimes prints success then exits 255** — a libuv
  teardown quirk seen repeatedly in the sibling repos. Read the output, not the
  exit code.
- Naming `sites/heygabi-home/public` (not `.`, not `sites/heygabi-home`) is what
  keeps the docs off the public site.
- `.wrangler/` is written wherever the command is run from. The `.gitignore` in
  `sites/heygabi-home/` only covers that directory, so running from the repo
  root leaves an **untracked** `catalog-platform/.wrangler/`. Ignore it at the
  root, or run the command from `sites/heygabi-home/` with `public` as the path.

---

## 2. Attach `heygabi.ai` and `www.heygabi.ai` 🔴

Because the zone is in the same account, Cloudflare writes the DNS records
itself — there is no record to create by hand and no nameserver change.

1. Pages project **`heygabi-home`** → **Custom domains** → **Set up a custom
   domain**.
2. Enter **`heygabi.ai`** → **Continue** → **Activate domain**.
   Cloudflare adds a proxied apex record (CNAME flattening) automatically.
3. Repeat for **`www.heygabi.ai`**.
4. Wait for both to show **Active**. Certificate issuance is usually a minute or
   two; it can take longer on a first-ever cert for the zone.

### 2.1 Pick a canonical host and redirect the other

> 🔶 **NOT DONE — measured 2026-08-10.** `curl -s -D - -o /dev/null
> https://www.heygabi.ai` returns **`200`**, not a `301`. Both hosts serve the
> page today, so the rule below is still outstanding. It is cosmetic, not
> broken; nothing depends on it.

Attaching both means both serve the page, which is duplicate content and — more
importantly — means two names for one thing. `HEYGABI_LAYOUT.md` §7 open
question 3 flags apex-vs-`www` as an owner decision.

**Recommended: apex is canonical**, because every other host in the map is a bare
subdomain of it and `www.` is the odd one out.

To make `www` a redirect: **zone `heygabi.ai` → Rules → Redirect Rules → Create
rule**

| Field | Value |
|---|---|
| Name | `www to apex` |
| When incoming requests match | Custom filter expression: `http.host eq "www.heygabi.ai"` |
| Then | **Dynamic** redirect, expression `concat("https://heygabi.ai", http.request.uri.path)` |
| Status code | **301** |
| Preserve query string | ✅ on |

⚠️ Keep `www.heygabi.ai` attached as a Pages custom domain even after adding the
redirect — the rule runs on the zone, but the hostname still needs a proxied DNS
record and a cert to be reachable at all.

⚠️ **A redirect-only host must never become a Firebase authorised domain**
(`HEYGABI_LAYOUT.md` §1.3). `www.heygabi.ai` is now exactly that kind of host.

---

## 3. Verify

⚠️ **`curl -I` and `curl -o /dev/null` both misreport in Git Bash on this
machine** — `-o /dev/null` exits **43** with status `000` on a host that is
plainly up, and `-o NUL` did the same thing here on 2026-08-10. Use `-D -` and
read the status line out of the dumped headers; it is the one form that has been
observed to work.

```bash
# status line + headers, without the -I / -o pitfalls above
curl -s -D - -o /dev/null --max-time 15 https://heygabi.ai | head -3

# the HTML actually contains the catalogue links
curl -s --max-time 15 https://heygabi.ai | grep -c "library.heygabi.ai"

# the CSP arrived from _headers
curl -s -D - -o /dev/null --max-time 15 https://heygabi.ai | grep -i "content-security-policy"

# www: expect 301 + location once §2.1 is done. Today it answers 200
curl -s -D - -o /dev/null --max-time 15 https://www.heygabi.ai | grep -i -E "^(HTTP|location)"
```

Then in a browser:

- [ ] Renders in **light** and **dark** (toggle the OS setting, not a devtools
      emulation, at least once).
- [ ] Renders on an actual **phone**, portrait, without horizontal scroll.
- [ ] Favicon appears in the tab.
- [ ] **DevTools → Network shows only allow-listed hosts** (since 2026-08-13):
      the document, `/assets/*.js`, `www.gstatic.com` Firebase modules, and —
      once signed in — Google auth endpoints and the two estate Workers.
      No font, no beacon, no analytics, nothing else. ⚠️ SUPERSEDED
      2026-08-15: `/todo` is no longer one request — see its own checklist
      below, which now expects the sign-in surface too.
- [ ] **Console is empty** — a CSP violation would print here.
- [ ] **Search, signed out:** the box asks for a sign-in and the page is
      otherwise whole. **Signed in (member):** a title returns grouped results
      whose caveat line says in-catalog-not-owned. **Signed in (fresh
      account):** the awaiting-approval message, not an error.
- [ ] **`/admin`, signed in as the owner:** the member list loads; approve /
      revoke / promote buttons act and re-render. From `www.heygabi.ai/admin`
      it will NOT work (CORS names the apex) — the page says so.
- [ ] **The cog (2026-08-13):** theme dropdown switches Apple → Cyberpunk →
      Retro live (fonts arrive from `/assets/fonts/`, no third-party font
      request in the Network tab); Appearance Auto/Light/Dark composes with
      each theme; both choices survive a reload; `/admin` wears the same
      choice (one origin). With OS reduced-motion ON: no reveals, no tilt,
      no cog spin, content all simply visible.
- [ ] ⚠️ **The §15 two-tab test (estate-auth-design.md — OWNER-ATTENDED, due
      on first deploy of the sign-in):** sign in on `heygabi.ai`, then in a
      second tab load `audiobooks.heygabi.ai` (which calls `signOut()` on its
      own auth instance) and use its sign-in/sign-out; confirm the apex tab's
      session survives and the audiobook site's own state is unaffected.
      If the apex session dies, §15's fallback triggers: search moves to a
      `search.heygabi.ai` host and the apex reverts.
- [ ] Board games card **is** a link and wears **no pill**. (It was an
      unclickable "Coming soon" card until 2026-08-09 and carried an "Owner
      only" pill until 2026-08-10; `README.md` records why each changed.)
- [ ] All three catalogue links go to the right hosts. Each asks for a sign-in
      of its own — a signed-out browser reaching a sign-in screen is the gate
      working, not a broken link.

And for `/todo` (added 2026-08-10; **auth-locked 2026-08-15** — owner order
"Auth lock the todo page too". The two checks below marked SUPERSEDED are
kept for history; the rest of this list is UNCHANGED and still applies):

- [ ] `https://heygabi.ai/todo` loads, and the footer link on the front door
      reaches it.
- [ ] **Signed out:** view-source (or `curl`) the page and confirm there is
      no board content anywhere in it — no item titles, no tags, no hints.
      Only the sign-in gate. This is the actual lock; everything else on
      this list is testing the UI built on top of it.
- [ ] **Signed out, `GET https://auth.heygabi.ai/api/estate/todo` (curl, no
      `Authorization` header):** `401`.
- [ ] **Signed in as a non-approver (if one exists):** the gate shows "This
      board is for the estate's admins." — no board content, no `500`.
- [ ] **Signed in as an approver:** the board renders — same items as
      before the lock (content lives in `apps/auth-worker/src/todo-board.ts`
      now; a stale board here means that file needs a `wrangler deploy`, not
      a Pages deploy).
- [ ] **Tap each of the six filter chips**, signed in as an approver. They
      are CSS-only radios (unchanged by the lock); if the board stops
      filtering, something reordered the `<input>`s away from being direct
      siblings of `.filters` and `.board` and every `~` rule died silently.
      Nothing logs when this breaks.
- [ ] ⚠️ SUPERSEDED 2026-08-15: this used to say "Still exactly one network
      request and an empty console on this page too. It has no JS and must
      never acquire any." `/todo` now loads `todo.js` + the Firebase SDK +
      calls `auth.heygabi.ai`, same request shape as `/admin` — an empty
      **console** (no CSP violations) is still the bar; request count is not.
- [ ] At 360px wide: chips wrap, no horizontal scroll, every chip is tappable.

---

## 4. Subsequent deploys

Edit `sites/heygabi-home/public/index.html` or
`sites/heygabi-home/public/todo/index.html`, commit (`git commit -F <file>`,
**never `-m`**), then re-upload — **from the `catalog-platform` repo root**:

```bash
npx wrangler pages deploy sites/heygabi-home/public --project-name heygabi-home
```

One upload covers the whole directory, so the front door and `/todo` always
ship together. There is no way to deploy one without the other, and no need.

There is no build, no preview lane and no promote step. This site deliberately
does **not** copy the audiobook catalog's two-lane `main` → `/dev/`, `prod` →
root architecture: that exists to protect a 42,000-line generated site fed by a
pipeline. One hand-edited static file does not need it, and the rollback is
Pages' own deployment history (project → **Deployments** → ⋯ → **Rollback**).

### 4.1 Rollback points

The owner permits pushing straight to `main` here **on condition that a rollback
id is recorded**. There are two independent rollbacks and they are not the same
lever: git undoes the source, the Pages dashboard undoes what is *served*.

| Date | Pushed | Roll back the code to | Roll back the site by |
|---|---|---|---|
| 2026-08-10 | `cd53dcd..main` — the `/todo` board, the front-door link to it, and this record | **`cd53dcd`** | Pages → project `heygabi-home` → **Deployments** → ⋯ → **Rollback** to the deployment before this one |

⚠️ The "Pushed" column names a **range, not a head sha**, on purpose: the commit
that records a rollback point cannot name its own hash, and every attempt to fix
that up mints another commit the table does not mention.

Undoing the code: `git reset --hard cd53dcd && git push --force-with-lease`.
⚠️ That alone leaves the *deployed* site unchanged — Pages serves the last
upload, not the last commit. Roll the deployment back too, or re-upload.

⚠️ **A deploy here publishes only this directory, and that is now load-bearing.**
`catalog-platform` holds design documents that were written for sessions and the
owner, not for the public. The upload root is the single defence; there is no
`.pagesignore`, no build step and nothing else filtering what ships.

---

## 5. What this deploy must never do

| Never | Why |
|---|---|
| ⚠️ Add `www.heygabi.ai` (or `auth.` / `index.` / `covers.`) to **Firebase authorised domains** | No sign-in popup runs on any of them; each entry is a permanent OAuth redirect surface. ⚠️ The apex itself **is** authorised since 2026-08-13 — that reversal is deliberate and argued in `estate-auth-design.md` §7.2; it does not extend to any other host |
| Put a Worker in front of the apex | It is Pages, direct upload, by decision (`HEYGABI_LAYOUT.md` §1). The sign-in that finally arrived came as static JS + Workers on their own hosts, not as an apex Worker — keep it that way |
| Deploy the repo root instead of `public/` | Publishes `README.md` and `deploy.md` |
| Point `audiobooks.heygabi.ai` at this project | That is its own Pages project with its own `/dev/` lane |
| Add an analytics beacon "since it's just one script" | Breaks the CSP, and the CSP is the point |
