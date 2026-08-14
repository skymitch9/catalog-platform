/**
 * theme.js — the estate theme switcher. Classic script, NOT a module, loaded
 * synchronously in <head> right after estate-theme.css so the persisted
 * theme/mode land on <html> before first paint (no flash of the wrong theme).
 *
 * v2 (2026-08-13): themes persist PER PAGE. The owner: "let me set a theme per
 * page and it persist, sometimes i want different looks and feel for all my
 * pages." Resolution order, first hit wins:
 *
 *   1. this page's override — localStorage `hg_theme_page`, a JSON object
 *      keyed by normalised location.pathname (trailing slash and /index.html
 *      stripped, so /admin, /admin/ and /admin/index.html are ONE page);
 *   2. the site default the person chose — localStorage `hg_theme`;
 *   3. the site's identity — <html data-default-theme="…">;
 *   4. 'apple'.
 *
 * setTheme() writes the PAGE override (that is the owner's expressed default
 * for the cog); setSiteTheme() is the "apply to all pages" lever — it writes
 * `hg_theme` and DELETES the whole override map, because "all pages" means
 * what it says (docs/info/estate-themes.md §2a argues this out). MODE stays
 * site-wide (`hg_mode`) on purpose: per-page dark/light is chaos.
 *
 * What it does:
 *   - reads the three keys above; localStorage is origin-scoped, so each
 *     site keeps its own choices for free;
 *   - stamps <html data-theme="…" data-mode="light|dark"> — data-mode is
 *     always the RESOLVED mode ('auto' is resolved against
 *     prefers-color-scheme and re-resolved live when the OS flips);
 *   - exposes window.estateTheme { get, setTheme, setSiteTheme, setMode,
 *     themes, modes } and fires 'hg-themechange' on document, whose detail
 *     carries `scope` ('page' when an override governs here, else 'site') —
 *     this API is how a consumer site's EXISTING settings cog integrates;
 *   - wires the standard cog UI if the page carries the #hg-cog markup
 *     (button#hg-cog + div#hg-cog-panel with select#hg-theme-select,
 *     [data-hg-mode] buttons, and optionally button#hg-apply-all +
 *     p#hg-scope-note). Pages without the markup get the API only.
 *
 * ⚠️ SPA note: "the page" is location.pathname at the moment of boot or of a
 * setTheme() call. Client-side navigation does not re-resolve — the theme a
 * person set travels with the session until the next real page load, which
 * resolves against the path it lands on. Coherent, and cheap to reason about.
 *
 * The per-site DEFAULT is identity (owner, 2026-08-13): a site declares its
 * classic look via <html data-default-theme="…"> — apex 'classic', /admin +
 * library 'apple', audiobooks 'cyberpunk', games 'retro'. Unset falls back
 * to 'apple'. No migration for v2: absence of `hg_theme_page` simply means
 * no page has its own look yet.
 */

(function () {
  'use strict';

  var docEl = document.documentElement;
  var THEMES = ['classic', 'apple', 'cyberpunk', 'retro'];
  var MODES = ['auto', 'light', 'dark'];
  var DEFAULT_THEME = docEl.getAttribute('data-default-theme') || 'apple';
  var PAGE_MAP_KEY = 'hg_theme_page';
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* private mode etc. — selection just won't persist */ }
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* same */ }
  }

  function validTheme(t) {
    return THEMES.indexOf(t) >= 0 ? t : null;
  }

  // One page, one key: strip /index.html and any trailing slash so a page
  // reached three ways cannot accumulate three overrides.
  function pageKey() {
    var p = location.pathname || '/';
    p = p.replace(/\/index\.html?$/i, '/');
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p === '' ? '/' : p;
  }

  // The override map. Corrupt JSON or a non-object reads as "no overrides";
  // unknown theme values are dropped rather than stamped.
  function readOverrides() {
    var raw = read(PAGE_MAP_KEY);
    if (!raw) return {};
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Object.prototype.toString.call(parsed) !== '[object Object]') return {};
      var clean = {};
      for (var k in parsed) {
        if (Object.prototype.hasOwnProperty.call(parsed, k) && validTheme(parsed[k])) clean[k] = parsed[k];
      }
      return clean;
    } catch (e) { return {}; }
  }

  var overrides = readOverrides();
  var siteTheme = validTheme(read('hg_theme')) || DEFAULT_THEME;
  var storedMode = read('hg_mode');
  var bootOverride = validTheme(overrides[pageKey()]);

  var state = {
    theme: bootOverride || siteTheme,
    scope: bootOverride ? 'page' : 'site',
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
        detail: {
          theme: state.theme,
          mode: state.mode,
          resolvedMode: resolvedMode(),
          scope: state.scope,
          siteTheme: siteTheme,
        },
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
    get: function () {
      return {
        theme: state.theme,
        mode: state.mode,
        resolvedMode: resolvedMode(),
        scope: state.scope,
        siteTheme: siteTheme,
      };
    },
    /** Theme for THIS PAGE — writes the per-path override. */
    setTheme: function (t) {
      if (!validTheme(t)) return;
      state.theme = t;
      state.scope = 'page';
      overrides[pageKey()] = t;
      write(PAGE_MAP_KEY, JSON.stringify(overrides));
      apply();
    },
    /** Theme for ALL pages — writes the site default and clears EVERY page
     *  override, this page's and every other's. "All pages" means all pages;
     *  this is also the only reset lever, on purpose (estate-themes.md §2a). */
    setSiteTheme: function (t) {
      if (!validTheme(t)) return;
      siteTheme = t;
      state.theme = t;
      state.scope = 'site';
      overrides = {};
      remove(PAGE_MAP_KEY);
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
    var applyAll = document.getElementById('hg-apply-all');
    var scopeNote = document.getElementById('hg-scope-note');
    var modeButtons = panel.querySelectorAll('[data-hg-mode]');

    function sync() {
      if (themeSelect) themeSelect.value = state.theme;
      if (scopeNote) scopeNote.hidden = state.scope !== 'page';
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
    if (applyAll) {
      applyAll.addEventListener('click', function () {
        window.estateTheme.setSiteTheme(state.theme);
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
