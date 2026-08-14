/**
 * motion.js — the estate's motion vocabulary, applied to whatever page loads
 * it. Recipes live with their CSS halves in estate-theme.css; the tempo
 * tokens (--et-dur-*, --et-ease-*) are the shared vocabulary.
 *
 *   REVEAL  — .reveal elements rise in as they enter the viewport.
 *             IntersectionObserver, once per element. All themes.
 *   RECEDE  — [data-hero] gently scales/fades as you scroll past it.
 *             rAF-throttled scroll read; transform/opacity only.
 *   TILT    — .et-tilt elements lean toward the cursor and spring back.
 *             The Apple showroom feel, and APPLE-SCOPED: identity motion
 *             belongs to its theme, so it checks data-theme live and stands
 *             down under cyberpunk/retro. Fine pointers only, rAF-throttled,
 *             max angle from --et-tilt-max.
 *
 * ⚠️ prefers-reduced-motion kills ALL of it: this script never adds the
 * `et-motion` class under reduce (so reveal-hiding CSS never applies and no
 * content can be blanked), tears everything down if reduce flips on mid-
 * session, and the CSS side force-parks whatever it governs. 60fps rule:
 * transform/opacity only, no layout reads outside rAF.
 */

const REDUCE = matchMedia('(prefers-reduced-motion: reduce)');
const FINE_POINTER = matchMedia('(hover: hover) and (pointer: fine)');
const root = document.documentElement;

let revealObserver = null;
let cleanups = [];

function themeIsApple() {
  const t = root.getAttribute('data-theme');
  return t === null || t === 'apple';
}

function tiltMaxDegrees() {
  const raw = getComputedStyle(root).getPropertyValue('--et-tilt-max');
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 4;
}

// ---------------------------------------------------------------------------
// Reveal
// ---------------------------------------------------------------------------

function startReveals() {
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );
  for (const el of document.querySelectorAll('.reveal')) revealObserver.observe(el);
}

// ---------------------------------------------------------------------------
// Hero recede
// ---------------------------------------------------------------------------

function startRecede() {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;

  const RANGE = 420; // px of scroll over which the hero settles back
  let ticking = false;

  const apply = () => {
    ticking = false;
    const t = Math.min(window.scrollY, RANGE) / RANGE;
    hero.style.opacity = String(1 - t * 0.5);
    hero.style.transform = `scale(${(1 - t * 0.035).toFixed(4)}) translateY(${(t * RANGE * 0.1).toFixed(1)}px)`;
  };
  const onScroll = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(apply);
    }
  };

  addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => {
    removeEventListener('scroll', onScroll);
    hero.style.opacity = '';
    hero.style.transform = '';
  });
}

// ---------------------------------------------------------------------------
// Tilt (apple-scoped)
// ---------------------------------------------------------------------------

function attachTilt(el) {
  let raf = 0;
  let lastX = 0;
  let lastY = 0;

  const frame = () => {
    raf = 0;
    if (!themeIsApple()) return; // theme changed mid-hover: stand down
    const rect = el.getBoundingClientRect();
    const px = (lastX - rect.left) / rect.width - 0.5;
    const py = (lastY - rect.top) / rect.height - 0.5;
    const max = tiltMaxDegrees();
    el.style.transform =
      `perspective(900px) rotateX(${(-py * max).toFixed(2)}deg) rotateY(${(px * max).toFixed(2)}deg) scale(1.012)`;
  };

  const onMove = (e) => {
    if (!themeIsApple()) return;
    lastX = e.clientX;
    lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const onLeave = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    // The spring back: one eased release, then the inline override is gone
    // and the stylesheet's standing transition owns the element again.
    el.style.transition = 'transform .55s var(--et-ease-spring)';
    el.style.transform = '';
    setTimeout(() => { el.style.transition = ''; }, 600);
  };

  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
  cleanups.push(() => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerleave', onLeave);
    el.style.transform = '';
    el.style.transition = '';
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function start() {
  root.classList.add('et-motion');
  startReveals();
  startRecede();
  if (FINE_POINTER.matches) {
    for (const el of document.querySelectorAll('.et-tilt')) attachTilt(el);
  }
}

function stop() {
  root.classList.remove('et-motion');
  if (revealObserver) { revealObserver.disconnect(); revealObserver = null; }
  for (const fn of cleanups) fn();
  cleanups = [];
  // Anything mid-reveal becomes simply visible.
  for (const el of document.querySelectorAll('.reveal')) el.classList.remove('in');
}

if (!REDUCE.matches) start();

REDUCE.addEventListener('change', () => {
  if (REDUCE.matches) stop();
  else start();
});
