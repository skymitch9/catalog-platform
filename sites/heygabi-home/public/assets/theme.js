/**
 * theme.js — the estate theme switcher. Classic script, NOT a module, loaded
 * synchronously in <head> right after estate-theme.css so the persisted
 * theme/mode land on <html> before first paint (no flash of the wrong theme).
 *
 * ⚠️ Theme choice is SITE-WIDE — one look per site, owner clarification
 * 2026-08-14: "Each site should have unified theme choice — by per page I
 * meant per site." A per-page override map (`hg_theme_page`) was built and
 * reverted the same day; this script deletes that stale key on boot so nobody
 * stays stuck on a forgotten page override. Do not reintroduce per-page
 * resolution from git history — it was a misread brief, not lost work.
 *
 * What it does:
 *   - reads localStorage `hg_theme` ('classic'|'apple'|'cyberpunk'|'retro')
 *     and `hg_mode` ('auto'|'light'|'dark'); origin-scoped, so each site
 *     keeps its own choice for free;
 *   - stamps <html data-theme="…" data-mode="light|dark"> — data-mode is
 *     always the RESOLVED mode ('auto' is resolved against
 *     prefers-color-scheme and re-resolved live when the OS flips);
 *   - exposes window.estateTheme { get, setTheme, setMode, themes, modes }
 *     and fires 'hg-themechange' on document — this API is how a consumer
 *     site's EXISTING settings cog integrates (docs/info/estate-themes.md);
 *   - wires the standard cog UI if the page carries the #hg-cog markup
 *     (button#hg-cog + div#hg-cog-panel with select#hg-theme-select and
 *     [data-hg-mode] buttons). Pages without the markup get the API only.
 *
 * The per-site DEFAULT is identity (owner, 2026-08-13): a site declares its
 * classic look via <html data-default-theme="…"> — apex 'classic', /admin +
 * library 'apple', audiobooks 'cyberpunk', games 'retro'. Unset falls back
 * to 'apple'.
 */

(function () {
  'use strict';

  var docEl = document.documentElement;
  var THEMES = ['classic', 'apple', 'cyberpunk', 'retro'];
  var MODES = ['auto', 'light', 'dark'];
  var DEFAULT_THEME = docEl.getAttribute('data-default-theme') || 'apple';
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode etc. — selection just won't persist */ }
  }

  // Retire the reverted per-page override map (built + reverted 2026-08-14).
  // Safe to drop this line once it has plausibly run everywhere it ever wrote.
  try { localStorage.removeItem('hg_theme_page'); } catch (e) { /* same guard as write() */ }

  var storedTheme = read('hg_theme');
  var storedMode = read('hg_mode');
  var state = {
    theme: THEMES.indexOf(storedTheme) >= 0 ? storedTheme : DEFAULT_THEME,
    mode: MODES.indexOf(storedMode) >= 0 ? storedMode : 'auto',
  };

  function resolvedMode() {
    return state.mode === 'auto' ? (media.matches ? 'dark' : 'light') : state.mode;
  }

  function apply() {
    docEl.setAttribute('data-theme', state.theme);
    docEl.setAttribute('data-mode', resolvedMode());
    try {
      document.dispatchEvent(new CustomEvent('hg-themechange', {
        detail: { theme: state.theme, mode: state.mode, resolvedMode: resolvedMode() },
      }));
    } catch (e) { /* CustomEvent should exist everywhere we run; stay quiet if not */ }
  }

  // OS mode flips follow live while the person has chosen 'auto'.
  if (media.addEventListener) {
    media.addEventListener('change', function () { if (state.mode === 'auto') apply(); });
  }

  apply();

  window.estateTheme = {
    themes: THEMES.slice(),
    modes: MODES.slice(),
    get: function () { return { theme: state.theme, mode: state.mode, resolvedMode: resolvedMode() }; },
    /** Theme for the whole site — one look per site (owner, 2026-08-14). */
    setTheme: function (t) {
      if (THEMES.indexOf(t) < 0) return;
      state.theme = t;
      write('hg_theme', t);
      apply();
    },
    setMode: function (m) {
      if (MODES.indexOf(m) < 0) return;
      state.mode = m;
      write('hg_mode', m);
      apply();
    },
  };

  // ---- the cog UI (only when the page carries the markup) ------------------

  function wireCog() {
    var cog = document.getElementById('hg-cog');
    var panel = document.getElementById('hg-cog-panel');
    if (!cog || !panel) return;

    var themeSelect = document.getElementById('hg-theme-select');
    var modeButtons = panel.querySelectorAll('[data-hg-mode]');

    function sync() {
      if (themeSelect) themeSelect.value = state.theme;
      for (var i = 0; i < modeButtons.length; i++) {
        var b = modeButtons[i];
        b.setAttribute('aria-pressed', b.getAttribute('data-hg-mode') === state.mode ? 'true' : 'false');
      }
    }

    function setOpen(open) {
      panel.hidden = !open;
      cog.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    cog.addEventListener('click', function () {
      setOpen(panel.hidden);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !panel.hidden) {
        setOpen(false);
        cog.focus();
      }
    });

    // A tap anywhere else closes the panel — it is a popover, not a page.
    document.addEventListener('pointerdown', function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || cog.contains(e.target)) return;
      setOpen(false);
    });

    if (themeSelect) {
      themeSelect.addEventListener('change', function () {
        window.estateTheme.setTheme(themeSelect.value);
      });
    }
    for (var i = 0; i < modeButtons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          window.estateTheme.setMode(btn.getAttribute('data-hg-mode'));
        });
      })(modeButtons[i]);
    }

    document.addEventListener('hg-themechange', sync);
    sync();
    setOpen(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireCog);
  } else {
    wireCog();
  }
})();
