# Estate Themes — Information Reference (the theme system)

> **Audience:** Claude sessions (especially the agents theming the library and,
> later, wiring the audiobook/games cogs). **Status:** TRACKED — asset BUILT
> 2026-08-13 in `sites/heygabi-home/public/assets/` (the canonical copy), live
> on the apex + `/admin` once the pending deploy lands.
> Last verified: **2026-08-13** — cyberpunk/retro values extracted from the two
> sites' real stylesheets that day (extraction notes were audited against the
> sources, not trusted blind). Companion: `estate-auth-design.md` (the
> one-implementation-consumers-adopt pattern this repeats for design).

The owner's ask, verbatim: *"make a theme drop down. Get the cyberpunk theme of
the AUDIOBOOK, the retro game theme of the board games, and the apple theme of
the books and make a selector of what theme to use. put that selector in the
same settings cog as darkmode … and let the end user select a theme per site."*

## 1. What exists

| File (under `sites/heygabi-home/public/assets/`) | What |
|---|---|
| `estate-theme.css` | THE asset: the `--et-*` token contract, four theme token sets (each light + dark), shared primitives (`.et-btn`, `.et-input`, `.et-tile`, the cog), the motion machinery |
| `theme.js` | The switcher: classic pre-paint script; stamps `<html data-theme data-mode>`; persists; exposes `window.estateTheme`; wires the standard cog markup when present |
| `motion.js` | The motion vocabulary (reveal / hero recede / apple-scoped tilt), all dead under `prefers-reduced-motion` |
| `fonts/*.woff2` + OFL | Self-hosted latin subsets: Rajdhani ×3 + Share Tech Mono (cyberpunk), Bangers + Luckiest Guy (retro, copied from the games repo with its licence) |

## 2. The contract in one paragraph

Four themes — `classic`, `apple`, `cyberpunk`, `retro` — each defined in light
and dark; theme × mode COMPOSE. (`classic` joined 2026-08-14: the apex's
ORIGINAL pre-retheme look — warm paper / lamp-lit library, green + gold +
clay, the aurora-blob backdrop — extracted faithfully from git `3b9c6b3`'s
inline styles and promoted to a theme by owner ruling.) A page styles against `--et-*` tokens only (the full
list and role definitions live at the top of `estate-theme.css`); **if a page
needs a `[data-theme=…]` selector, a token is missing — add one to the
contract, never fork.** `theme.js` stamps `<html data-theme="…"
data-mode="light|dark">` (mode always resolved; `auto` follows the OS live)
and persists choices in localStorage (§2a for the v2 shapes). localStorage is
origin-scoped, so "per site" costs nothing. `document` fires
**`hg-themechange`** on every change (detail carries `scope` since v2);
`window.estateTheme.{get,setTheme,setSiteTheme,setMode}` is the whole API.

## 2a. Per-page themes (v2, 2026-08-13)

The owner, verbatim: *"let me set a theme per page and it persist, sometimes i
want different looks and feel for all my pages."* So the theme is resolved
per PAGE, first hit wins:

1. **This page's override** — `hg_theme_page`, a JSON object keyed by
   normalised `location.pathname` (`/index.html` and trailing slashes are
   stripped, so `/admin`, `/admin/` and `/admin/index.html` are ONE key).
2. **The site default the person chose** — `hg_theme` (unchanged key).
3. **The site's identity** — `<html data-default-theme="…">`.
4. `'apple'`.

**The cog writes the page.** Picking a theme in any cog calls `setTheme()`,
which writes the override for the current page — that is the owner's
expressed default. The quiet **"Apply to all pages"** action calls
`setSiteTheme()`, which writes `hg_theme` **and deletes the entire override
map** — this page's override and every other page's.

**Why apply-to-all clears ALL overrides, argued once:** "all pages" must mean
what it says. If stray overrides survived, the button would be a lie on
exactly the pages the person had bothered to customise — the ones they most
remember. It is also deliberately the only reset lever: there is no per-page
"clear" affordance, so the mental model stays two verbs (this page / all
pages) instead of three, and a person can always dig out of any state with
one press.

**Mode stays site-wide** (`hg_mode`). Per-page dark/light is chaos: brightness
thrashing between navigations is physically unpleasant in a way a palette
change is not, and it would double the QA matrix of every page for a look
nobody asked for. Theme is voice; mode is lighting.

**Events and API.** `hg-themechange`'s detail is
`{ theme, mode, resolvedMode, scope, siteTheme }` — `scope` is `'page'` when
an override governs the current page, else `'site'`. `get()` returns the same
shape. Consumers with their own cogs (the library, the games app) surface a
"this page keeps its own theme" hint from `scope` and an apply-to-all action
calling `setSiteTheme()`.

**No migration.** Absence of `hg_theme_page` means no page has its own look;
existing `hg_theme` values keep exactly their old meaning (the site default).

⚠️ **SPA caveat:** "the page" is `location.pathname` at boot or at the moment
`setTheme()` is called. Client-side navigation does not re-resolve — the
chosen theme rides the session until the next real page load, which resolves
against whatever path it lands on. In the React apps this means a deep link
back to the route where a theme was picked restores it; wandering there
client-side does not. Documented as accepted, not accidental.

## 3. ⚠️ Defaults are identity — the owner's boundary, restated as the rule

| Site | Default theme | Why |
|---|---|---|
| `heygabi.ai` | `classic` | Owner ruling 2026-08-14: the front door boots its original look |
| `/admin` | `apple` | Unchanged; flipping it to classic is a one-attribute change if asked |
| `library.heygabi.ai` | `apple` | Owner: "make the apple theme persist on the books site too" |
| `audiobooks.heygabi.ai` | `cyberpunk` | Its existing identity, kept |
| `boardgames.heygabi.ai` | `retro` | Its existing identity, kept |

**A site changes look only when ITS user picks a different theme in ITS cog.**
This is how the owner's earlier "audiobooks and games keep their looks"
(explicit choice, 2026-08-13) survives the dropdown: identity by default,
choice by user. Do not "helpfully" restyle a site's default, and do not ship a
consumer without `data-default-theme="<its default>"` on `<html>`.

## 4. Integrating the switcher into an existing site

1. Serve `estate-theme.css`, `theme.js` and the font files from the site's own
   origin (the library takes them the sibling-checkout way, like `universes`
   and `estate-auth`; the two static-ish sites copy files). Fonts must stay
   self-hosted — the games repo's zero-third-party-requests rule is the
   estate's, and strict CSPs block Google Fonts anyway.
2. Set `<html data-default-theme="…">`, load `theme.js` synchronously in
   `<head>` (pre-paint — kills the wrong-theme flash).
3. Fold the theme dropdown into the site's EXISTING settings cog by calling
   `window.estateTheme.setTheme/setSiteTheme/setMode` — or use the standard
   cog markup (`button#hg-cog` + `div#hg-cog-panel` + `select#hg-theme-select`
   + `[data-hg-mode]` buttons, plus optionally `button#hg-apply-all` and
   `p#hg-scope-note` for the v2 affordances; see the apex's `index.html`)
   which `theme.js` wires automatically. A consumer cog must expose the
   Theme group (all four themes), the Mode group, and the apply-to-all
   action — the library's cog is the reference presentation.
4. **Migrate the legacy mode keys once, then let `hg_mode` own it**:
   audiobook `ab_theme` (`'dark'|'light'`) and games `bgc-theme`
   (`'system'|'light'|'dark'`) map 1:1 onto `hg_mode` (`system`→`auto`). Read
   the old key only when `hg_mode` is unset; never write the old keys again.
5. Keep the `theme-color` meta in step with `--et-bg` per mode (the games app
   already does this from its theme.ts — same job, new tokens).

## 5. The motion vocabulary

| Pattern | What / where | Scope |
|---|---|---|
| Reveal | `.reveal` (+`.reveal-d1/-d2` stagger) rises in on viewport entry; IntersectionObserver, once | all themes |
| Hero recede | `[data-hero]` gently scales/fades over the first ~420px of scroll; rAF-throttled | all themes |
| Tilt | `.et-tilt` leans ≤ `--et-tilt-max`° toward the cursor, springs back on leave; fine pointers only | **apple only** — identity motion is theme-scoped |
| Press | `.et-btn:active` uses `--et-press` — apple scales, retro translates INTO its hard shadow | per theme |
| Cog spin | the gear rotates 90° while its panel is open | all themes |

**`prefers-reduced-motion: reduce` kills all of it** — `motion.js` refuses to
start (so reveal-hiding CSS never engages and content cannot be blanked) and
the CSS force-parks the rest. `prefers-contrast: more` drops the background
textures (the games app's own rule, adopted estate-wide). Transform/opacity
only; no layout-thrashing scroll handlers.

## 6. What a consumer must NOT do

- ⚠️ **THEMES MAY NOT CHANGE PAGE STRUCTURE** (owner ruling, 2026-08-14,
  after the apex's full-bleed tile experiment was rejected — "what you
  swapped to for the boxes is terrible"). A theme restates palette,
  typography, shadows, radii, glows, motion tempo — SKIN. The page's bones
  (its boxes, its grid, its sections) are the LAYOUT, one per page, worn by
  every theme. If a theme seems to need different markup or a different
  grid, that is a redesign wearing a theme's name — take it to the owner.
- **No second accent.** `--et-accent` is interactivity, `--et-accent-2` is the
  theme's second voice; minting a third color is how themes rot.
- **No webfonts beyond the theme's own faces**, and no Google Fonts links —
  self-host or nothing.
- **No status colors as decoration** — `--et-ok/warn/danger` carry meaning.
- **No raw colors in page CSS** — tokens only; ask the contract for what is
  missing.
- **No arcade elements in retro.** ⚠️ On disk "retro" is muted vintage
  pop-art (aged paper, ink, halftone) whose stated brief is restraint — no
  pixel fonts, no neon, no scanlines, however much the dropdown label tempts.
- **No motion that ignores `prefers-reduced-motion`**, and no per-frame style
  writes outside rAF.
- **Do not delete a theme's "weird" identity carriers** when tidying: the
  cyberpunk notch (`--et-clip-panel`), glows and uppercase; the retro ink
  border, hard no-blur shadows and press-into-shadow. They ARE the themes.

## 7. ⚠️ Honesty: what fidelity actually costs per site

The apex renders all three themes faithfully because it was built token-first
against this contract. The other sites were not, and **tokens give you the
palette, not the soul**:

- **Audiobook site** (extraction audit, 2026-08-13): ~70% var-driven, but ~59
  glow `rgba()`s are hardcoded (retinting vars changes text, not one glow);
  it runs TWO divergent mode mechanisms (`body.dark` light-first on the
  generated index.html vs `html.light` dark-first on club pages) that must
  both give way to `data-theme`/`data-mode`; `stats.html` and
  `guess-game.html` have **no light variant at all**; font names are literal
  in ~15 rules; clip-paths are per-component literals; shared CSS carries
  `var(--neon-cyan,#05d9e8)`-style fallbacks that leak dark values into any
  other theme. ⚠️ Its `index.html` is GENERATED — edits go to
  `app/web/templates/`, never `site/index.html`. Rendering it convincingly
  in `apple` is a real per-page CSS pass, not a variables swap.
- **Games app**: colors are excellently tokenised (its own retheme was "a
  token swap"), but the identity is component-level — ink borders, press-into-
  shadow, inset "hole in the paper" inputs, halftone on body only. A theme
  dropdown there means mapping its `--bg/--card/--text/--line/--accent`
  vocabulary onto `--et-*` and rewriting its hardcoded button/inset shadows to
  tokens, or dark/cyberpunk render half-converted. Two of its rules reference
  never-defined vars (`--border`, `--fg`) — pre-existing bugs, noted for its
  own repo, untouched.
- **Invented values, flagged**: cyberpunk has NO green anywhere → `--et-ok` is
  minted here (`#39d98a` dark / `#1d7a4b` light); cyberpunk-light glow colors
  are rebuilt from the light neons (the site hardcodes dark glows even in
  light mode — followed the intent, not the literal).
- Full extraction reports (per-site rewrite lists, line references) were
  produced in-session 2026-08-13; their durable content is folded into this
  section and into `estate-theme.css`'s comments.

## 8. Storage keys, for grep

| Key | Values | Owner |
|---|---|---|
| `hg_theme` | `classic` \| `apple` \| `cyberpunk` \| `retro` — the SITE default | the estate (this system) |
| `hg_theme_page` | JSON object: normalised pathname → theme name (per-page overrides, v2) | the estate (this system) |
| `hg_mode` | `auto` \| `light` \| `dark` — always site-wide | the estate (this system) |
| `ab_theme` | legacy audiobook mode | migrate-once, then dead |
| `bgc-theme` | legacy games mode | migrate-once, then dead |
