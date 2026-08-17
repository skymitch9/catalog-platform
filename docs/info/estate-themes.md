# Estate Themes — Information Reference (the theme system)

> **Audience:** Claude sessions (especially the agents theming the library and,
> later, wiring the audiobook/games cogs). **Status:** TRACKED — asset BUILT
> 2026-08-13 in `sites/heygabi-home/public/assets/` (the canonical copy);
> **LIVE on the apex + `/admin` since 2026-08-14**; redeployed 2026-08-17 with
> the self-populating cog (§3a). Per-surface live state:
> `library_catalog/docs/access/themes.md`.
> Last verified: **2026-08-17** — every consumer's propagation mechanism in
> §3b was read in its own repo that day and both drift guards were watched
> failing and passing. (Cyberpunk/retro token values date from the 2026-08-13
> extraction and were NOT re-verified.) Companion: `estate-auth-design.md` (the
> one-implementation-consumers-adopt pattern this repeats for design).
>
> **2026-08-16:** a fifth theme, `hearts`, was added to the canonical asset
> (§2) for the library's second instance.
>
> **2026-08-17 — PROPAGATION IS NOW MECHANICAL. Read §3a before adding a
> theme; it is shorter than the sweep it replaces.** `hearts` reached not one
> cog for a whole day, and the reason was not laziness: adding a theme
> genuinely required editing five apex HTML files, a React constant in the
> games repo, a label map in the library repo, a fallback list in the
> audiobook repo, and hand-copying four files into two repos — nine places,
> none of which failed when skipped. Owner order that day, verbatim: *"Add the
> pink theme as an option for every site, when a theme is added all sites get
> it some may just default right away."* All nine are gone. Adding theme #6 is
> now **two edits in this repo** (§3a).

The owner's ask, verbatim: *"make a theme drop down. Get the cyberpunk theme of
the AUDIOBOOK, the retro game theme of the board games, and the apple theme of
the books and make a selector of what theme to use. put that selector in the
same settings cog as darkmode … and let the end user select a theme per site."*

## 1. What exists

| File (under `sites/heygabi-home/public/assets/`) | What |
|---|---|
| `estate-theme.css` | THE asset: the `--et-*` token contract, five theme token sets (each light + dark), shared primitives (`.et-btn`, `.et-input`, `.et-tile`, the cog), the motion machinery |
| `theme.js` | The switcher: classic pre-paint script; stamps `<html data-theme data-mode>`; persists; exposes `window.estateTheme`; wires the standard cog markup when present |
| `motion.js` | The motion vocabulary (reveal / hero recede / apple-scoped tilt), all dead under `prefers-reduced-motion` |
| `fonts/*.woff2` + OFL | Self-hosted latin subsets: Rajdhani ×3 + Share Tech Mono (cyberpunk), Bangers + Luckiest Guy (retro, copied from the games repo with its licence) |

## 2. The contract in one paragraph

Five themes — `classic`, `apple`, `cyberpunk`, `retro`, `hearts` — each
defined in light
and dark; theme × mode COMPOSE. (`hearts` joined 2026-08-16: owner ask for
"a pink and white theme that kind of matches the retro theme. Like those
pixel gamer hearts" — AUTHORED, not extracted, so all of its values are
invented and the CSS says so. It borrows retro's GRAMMAR (2px ink outline,
flat card face, hard no-blur shadows, press-into-shadow, Luckiest Guy) with
a white-on-blush palette and an 8-bit heart tiled as `--et-bg-texture`.
⚠️ It exists so the pixel-arcade impulse has somewhere legitimate to go —
§6's "no arcade elements in retro" is unchanged.)
(`classic` joined 2026-08-14: the apex's
ORIGINAL pre-retheme look — warm paper / lamp-lit library, green + gold +
clay, the aurora-blob backdrop — extracted faithfully from git `3b9c6b3`'s
inline styles and promoted to a theme by owner ruling.) A page styles against `--et-*` tokens only (the full
list and role definitions live at the top of `estate-theme.css`); **if a page
needs a `[data-theme=…]` selector, a token is missing — add one to the
contract, never fork.** `theme.js` stamps `<html data-theme="…"
data-mode="light|dark">` (mode always resolved; `auto` follows the OS live)
and persists the choice in localStorage as **`hg_theme`** and **`hg_mode`**
(`'auto'|'light'|'dark'`). localStorage is origin-scoped, so "per site" costs
nothing. `document` fires **`hg-themechange`** on every change;
`window.estateTheme.{get,setTheme,setMode,themes,modes,labels,label}` is the
whole API — `themes` + `label(id)` being how a consumer renders a picker
without writing the theme names down (§3a).

## 2a. Theme choice is SITE-WIDE — one look per site (owner, 2026-08-14)

The owner, verbatim: *"Each site should have unified theme choice — by per
page I meant per site."* Picking a theme in any cog sets it for the WHOLE
site (`hg_theme`); each site still keeps its own choice for free because
localStorage is origin-scoped. Mode is likewise one key per site
(`hg_mode`).

⚠️ **History note, so nobody re-mines it:** a per-page override system
(`hg_theme_page` map, `setSiteTheme`, an "apply to all pages" lever, `scope`
in the event detail) was built 2026-08-13 and **reverted the same day** at
the owner's clarification above — the original "theme per page" brief meant
per SITE. It never deployed. `theme.js` deletes the stale `hg_theme_page`
key once on boot (droppable once it has plausibly run everywhere a dev build
wrote). If you find the per-page wiring in git history, it is a misread
brief, not lost work — do not reintroduce it.

## 3. ⚠️ Defaults are identity — the owner's boundary, restated as the rule

| Site | Default theme | Why |
|---|---|---|
| `heygabi.ai` | `classic` | Owner ruling 2026-08-14: the front door boots its original look |
| `/admin` | `apple` | Unchanged; flipping it to classic is a one-attribute change if asked |
| `library.heygabi.ai` | `apple` | Owner: "make the apple theme persist on the books site too" |
| `padhard.heygabi.ai` | `hearts` | Owner 2026-08-16: "let it be the default for padhard". Same bundle as `library.`, so the default is resolved by HOSTNAME before paint — see `library_catalog/docs/info/estate-theme.md` §4 |
| `audiobooks.heygabi.ai` | `cyberpunk` (+ `data-default-mode="dark"`) | Its existing identity, kept — including that a first visit boots DARK whatever the OS says |
| `boardgames.heygabi.ai` | `retro` | Its existing identity, kept |
| `ebooks.heygabi.ai` | **none — NOT a theme consumer** | ⚠️ See below |

⚠️ **`ebooks.heygabi.ai` is a deliberate EXCLUSION, verified 2026-08-17, not an
oversight to fix.** Owner, 2026-08-17: *"make it seem like it's own custom page.
Also let it have its own theme."* It has exactly one look — paper-and-ink, one
sienna accent — written into the page itself; it loads `theme.js` and **only**
`theme.js`, ignores `data-theme` entirely, and honours the resolved `data-mode`
for light/dark. The script is kept solely so the shared account modal's
Appearance controls are not silently dead. So `hearts` reaches that modal's
dropdown (it reads the registry like every other cog) while the page keeps its
own skin — correct on both counts. **Do not "finish the job" by wiring the
estate tokens into it.**

**Every surface, as measured 2026-08-17:** the apex cog markup lives on
`/`, `/admin/`, `/status/`, `/series/` and `/universes/` (five pages, all now
with empty selects that `theme.js` fills); `library.heygabi.ai` and
`padhard.heygabi.ai` share one React cog and one bundle;
`boardgames.heygabi.ai` has its own React cog; `audiobooks.heygabi.ai` has no
`#hg-cog` at all — its Appearance section lives in the account modal.

**A site changes look only when ITS user picks a different theme in ITS cog.**
This is how the owner's earlier "audiobooks and games keep their looks"
(explicit choice, 2026-08-13) survives the dropdown: identity by default,
choice by user. Do not "helpfully" restyle a site's default, and do not ship a
consumer without `data-default-theme="<its default>"` on `<html>`.

## 3a. ⚠️ HOW TO ADD THEME #6 — the whole procedure

**Two edits, both in this repo, and then each consumer picks it up on its own
next build/sync.**

1. `sites/heygabi-home/public/assets/estate-theme.css` — add the
   `:root[data-theme="x"]` block and its `[data-mode="dark"]` twin. Restate
   **every** token another theme defines; a missing one silently inherits
   apple's value and the theme renders half-dressed.
2. `sites/heygabi-home/public/assets/theme.js` — add the id to `THEMES` **and
   its human name to `LABELS`**, which sit next to each other for exactly this
   reason.

Then deploy the apex and let each consumer sync (§3b). **Do not touch any
consumer's markup or constants** — if you find yourself editing a cog to add a
theme, something has regressed to the pre-2026-08-17 state and the fix is to
restore the mechanism, not to do the sweep.

### Why the option list moved into `theme.js`

`wireCog()` **builds `#hg-theme-select`'s `<option>`s from `THEMES`** and
replaces whatever the markup contained. The page owns the cog's PLACE; this
file owns its CONTENTS. Consumers that render their own control (React cogs,
the audiobook account modal) read `window.estateTheme.themes` and
`.label(id)` at render time — **never a local copy**. An id the switcher has
not heard of degrades to a capitalised id, so an older vendored copy meeting a
newer name looks plain rather than blank.

### 3b. How each consumer gets the asset — ALL FOUR ARE NOW AUTOMATIC

| Consumer | Mechanism | Fails how? |
|---|---|---|
| apex + `/admin` `/status` `/series` `/universes` | serves canonical directly — same directory, ships with the Pages deploy | `npm run deploy:home` runs `predeploy-check.mjs`, which refuses to deploy if a theme lacks a `[data-theme=]` block or a `LABELS` entry, or if any page has hardcoded `<option>`s in `#hg-theme-select` |
| library + padhard | `scripts/sync-estate-theme.mjs` on prebuild/pretest/pretypecheck; vendored dir gitignored | build/test error naming the missing checkout |
| games | `scripts/sync-estate-theme.mjs` (added 2026-08-17, same pattern); `apps/web/public/assets/` is now gitignored build output | build/test/deploy error |
| audiobook | `scripts/sync_estate_theme.py` + `tests/test_estate_theme_vendor.py`. ⚠️ **Sync, not prebuild, and the copy stays TRACKED** — `site/` is served straight from the repo, so a test-time rewrite would fight the pipeline's auto-commit | the drift test fails by name, telling you to run the script. ⚠️ It **skips** where the sibling checkout is absent, which includes that repo's CI |

⚠️ **The apex guard and the audiobook guard were both exercised in both
directions on 2026-08-17** — a sixth theme with no palette fails them, and
they go green again once the palette exists / the sync is run. A guard nobody
has watched fail is a guard nobody should trust.

## 4. Integrating the switcher into an existing site

1. Serve `estate-theme.css`, `theme.js` and the font files from the site's own
   origin, **taken by a SYNC SCRIPT from the sibling checkout, never by hand**
   (§3b — every consumer does this as of 2026-08-17; the library's
   `sync-estate-theme.mjs` is the template, the audiobook's Python twin is the
   variant for a repo with no build step). Fonts must stay self-hosted — the
   games repo's zero-third-party-requests rule is the estate's, and strict
   CSPs block Google Fonts anyway. The two OFL licence files travel with the
   faces; `OFL-rajdhani-sharetechmono.txt` was missing from canonical until
   2026-08-17, so every consumer had been serving Rajdhani and Share Tech Mono
   without it.
2. Set `<html data-default-theme="…">`, load `theme.js` synchronously in
   `<head>` (pre-paint — kills the wrong-theme flash).
3. Fold the theme dropdown into the site's EXISTING settings cog by calling
   `window.estateTheme.setTheme/setMode` — or use the standard cog markup
   (`button#hg-cog` + `div#hg-cog-panel` + `select#hg-theme-select` +
   `[data-hg-mode]` buttons; see the apex's `index.html`), which `theme.js`
   wires automatically **and whose `<option>`s it fills for you — leave the
   select EMPTY**. A consumer that renders its own control builds the list
   from `window.estateTheme.themes` and the names from `.label(id)`;
   ⚠️ **a list or a label map written into a consumer is a second registry and
   WILL go stale** (that is what happened to all four cogs between 08-16 and
   08-17). The library's cog is the reference presentation: a Theme select
   over an Auto/Light/Dark row.
4. **Legacy mode keys are migrated BY `theme.js`, centrally** (since
   2026-08-17 — `LEGACY_MODE_KEYS`): audiobook `ab_theme`
   (`'dark'|'light'`) and games `bgc-theme` (`'system'|'light'|'dark'`) map
   1:1 onto `hg_mode` (`system`→`auto`), read only while `hg_mode` is unset
   and never written again. ⚠️ Running the whole table on every site is safe
   *because localStorage is origin-scoped* — a key can only exist on the site
   that wrote it — which is why this does NOT need to be a per-site fork. A
   new consumer with a legacy key adds a row to that table; it does not fork
   the file.
5. The `theme-color` meta is likewise **`theme.js`'s job now**, not the
   consumer's — it creates the element if absent and keeps it on `--et-bg` at
   every change. The games app's inline script and the audiobook's forked copy
   of the same twelve lines were both deleted 2026-08-17.
6. `<html data-default-mode="dark">` declares an identity for MODE the way
   `data-default-theme` does for theme (the audiobook site boots dark on a
   first visit regardless of the OS). Unset means `auto`. Unlike
   `data-default-theme` this one IS validated, because `MODES` is a closed set
   of three that will never grow.

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
| `hg_theme` | `classic` \| `apple` \| `cyberpunk` \| `retro` \| `hearts` — the site's ONE theme | the estate (this system) |
| `hg_mode` | `auto` \| `light` \| `dark` — likewise site-wide | the estate (this system) |
| `hg_theme_page` | RETIRED same-day 2026-08-14 (§2a history note) — theme.js deletes it on boot | dead, never reintroduce |
| `ab_theme` | legacy audiobook mode | migrate-once, then dead |
| `bgc-theme` | legacy games mode | migrate-once, then dead |
