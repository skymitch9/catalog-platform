# heygabi.ai — Deploy Reference

> **Audience:** Claude sessions and the owner. **Status:** NOT YET RUN — no
> Cloudflare object exists for this project. Last verified: **2026-08-09**.
>
> Steps written from `catalog-platform/docs/HEYGABI_LAYOUT.md` §1 and §4 (which
> records the apex as **Pages, direct upload**, and confirms the zone is already
> in the Cloudflare account because `heygabi.ai` is registered at **Cloudflare
> Registrar**). ⚠️ **Not verified against a live dashboard by the session that
> wrote this** — the dashboard's menu labels drift, so read the step's intent,
> not its exact wording.

🔴 = owner only. A session must not run these.

---

## 0. Before you start

| Check | Why |
|---|---|
| The `heygabi.ai` zone shows **Active** in Cloudflare | `HEYGABI_LAYOUT.md` §4 Track A step 3. Nothing below works until it is |
| You are in the **same Cloudflare account** as the two Workers | Registrar, zone and Pages project must share an account or the custom-domain step cannot see the zone |
| ⚠️ You are deploying **`public/`**, not the repo root | Uploading the root publishes `README.md` and `deploy.md` at `https://heygabi.ai/README.md` |

**Nothing here touches Firebase.** Do **not** add `heygabi.ai` or
`www.heygabi.ai` to Firebase authorised domains — see the no-auth rule in
`README.md`. This is the one step it would be easy to do "while you're in there".

---

## 1. Create the Pages project (direct upload)

Two equivalent routes. Pick one; do not do both.

### 1a. Dashboard 🔴

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** tab →
   **Upload assets**.
2. Project name: **`heygabi-home`**.
   ⚠️ This name is permanent-ish and mints `heygabi-home.pages.dev`. Keep it
   matching the repo name.
3. Drag the **`public/`** folder (not the repo root, not the zip of the repo).
4. **Deploy site**.
5. Confirm `https://heygabi-home.pages.dev` loads before touching DNS.

### 1b. Wrangler CLI

Runs from the repo root. Requires a login already in place
(`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` in the environment).

```bash
# once
npx wrangler pages project create heygabi-home --production-branch main

# every deploy
npx wrangler pages deploy public --project-name heygabi-home
```

Notes:

- `--production-branch main` is required by the CLI even though this is a direct
  upload with no git connection. It only labels which uploads count as
  production.
- ⚠️ **On Windows, wrangler sometimes prints success then exits 255** — a libuv
  teardown quirk seen repeatedly in the sibling repos. Read the output, not the
  exit code.
- Deploying `public` (not `.`) is what keeps the docs off the public site.

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

```bash
# 200, and the HTML actually contains the catalogue links
curl -sI https://heygabi.ai | head -20
curl -s  https://heygabi.ai | grep -c "library.heygabi.ai"

# the CSP arrived from _headers
curl -sI https://heygabi.ai | grep -i "content-security-policy"

# www redirects with a 301 to the apex
curl -sI https://www.heygabi.ai | grep -i -E "^(HTTP|location)"
```

Then in a browser:

- [ ] Renders in **light** and **dark** (toggle the OS setting, not a devtools
      emulation, at least once).
- [ ] Renders on an actual **phone**, portrait, without horizontal scroll.
- [ ] Favicon appears in the tab.
- [ ] **DevTools → Network shows exactly one request** (the document). No font,
      no image, no beacon. This is the whole no-external-requests rule, checked
      in one glance.
- [ ] **Console is empty** — a CSP violation would print here.
- [ ] Board games card is **not** clickable and shows "Coming soon".
- [ ] Audiobooks and Books links go to the right hosts. ⚠️ If those hosts are not
      yet attached, these links 404 — that is expected and is a reason to
      sequence the apex **after** them, not a bug in this page.

---

## 4. Subsequent deploys

Edit `public/index.html`, commit (`git commit -F <file>`, **never `-m`**), then
re-upload:

```bash
npx wrangler pages deploy public --project-name heygabi-home
```

There is no build, no preview lane and no promote step. This repo deliberately
does **not** copy the audiobook catalog's two-lane `main` → `/dev/`, `prod` →
root architecture: that exists to protect a 42,000-line generated site fed by a
pipeline. One hand-edited static file does not need it, and the rollback is
Pages' own deployment history (project → **Deployments** → ⋯ → **Rollback**).

---

## 5. What this deploy must never do

| Never | Why |
|---|---|
| ⚠️ Add `heygabi.ai` / `www.heygabi.ai` to **Firebase authorised domains** | `identity.js` calls `signOut()` on the shared Auth instance on load; a second auth origin for one project is actively hostile. `HEYGABI_LAYOUT.md` §1.3, §6 |
| Put a Worker in front of the apex | It is Pages, direct upload, by decision (`HEYGABI_LAYOUT.md` §1). A Worker here is how auth sneaks back in |
| Deploy the repo root instead of `public/` | Publishes `README.md` and `deploy.md` |
| Point `audiobooks.heygabi.ai` at this project | That is its own Pages project with its own `/dev/` lane |
| Add an analytics beacon "since it's just one script" | Breaks the CSP, and the CSP is the point |
