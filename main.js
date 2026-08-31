/**
 * Zhyvitsa — site wiring
 * =============================================================================
 *  1. Vines   — mount VineGeometry into every [data-vine] container, repair the
 *               viewBox, then drive stroke-dashoffset from scroll position.
 *  2. Reveals — short opacity/translate entrance for .reveal elements.
 *  3. Nav     — burger menu: aria-expanded, focus trap, Escape, outside click.
 *
 *  Every subsystem is wrapped in its own try/catch: if one throws, the rest of
 *  the page — and all of its content — still works.
 * =============================================================================
 */

import { VineGeometry } from './vine-geometry.js';

const REDUCED = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/* ===========================================================================
 * 1. VINES
 *
 * Defect (a): build() hardcodes viewBox "0 0 200 <len>", but with R0 = 55 the
 * spirals span x = -30.1 .. 233.2, so SVG's default clip cuts roughly a third
 * off every spiral. Fixed by replacing the viewBox after render — chosen over
 * overflow:visible, so the geometry stays inside its own coordinate box and
 * cannot bleed into the section around it.
 *
 * Measured (see the audit): the spirals also overrun the box VERTICALLY — the
 * last anchor sits at z = 880 with R0 = 55, so the bottom spiral reaches
 * y = 919.1 against a 900-unit box. "-60 0 320 900" would still clip it, so the
 * box gets 40 units of headroom below: "-60 0 320 940".
 *
 * preserveAspectRatio is switched from "slice" to "meet" as well: "slice"
 * scales to cover and crops whatever does not fit the container, which would
 * re-clip the spirals at the container edge no matter how wide the viewBox is.
 *
 * Defect (b): the module emits bare <path>/<circle> with only a class, which
 * would paint as black fills. Presentation lives in styles.css
 * (.vine-stem-path / .vine-spiral-path / .vine-bud).
 *
 * Defect (c): main.js did not exist. Below: measure getTotalLength() once,
 * after append, then only ever write strokeDashoffset.
 * ========================================================================= */

const VIEWBOX = '-60 0 320 940';
const STAGGER = 0.08;    // per-branch delay, in progress units
const TAIL = 0.85;       // share of the container's own height added to the travel
const INTRO_MS = 1700;   // opening draw for whatever is already on screen

function initVines() {
  const mounts = Array.prototype.slice.call(document.querySelectorAll('[data-vine]'));
  if (!mounts.length) return;

  const instances = [];

  mounts.forEach((mount) => {
    const { svg, stem, branches } = VineGeometry.render(mount);

    // (a) the spirals overflow the module's hardcoded viewBox
    svg.setAttribute('viewBox', VIEWBOX);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    // buds are appended one per branch, in branch order
    const buds = Array.prototype.slice.call(svg.querySelectorAll('.vine-bud'));

    // (c) measure once, AFTER the nodes are in the document
    const strokes = [];
    const push = (path, index, bud) => {
      const len = path.getTotalLength();
      if (!len) return;                       // nothing to draw
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = REDUCED ? 0 : len;
      if (bud && !REDUCED) bud.style.opacity = 0;
      strokes.push({ path, len, index, bud: bud || null });
    };
    push(stem, -1, null);                     // stem leads
    branches.forEach(({ path, index }) => push(path, index, buds[index]));

    instances.push({ mount, strokes, visible: false });
  });

  if (REDUCED) return;                        // drawn in full, no scroll binding

  const span = Math.max(0.2, 1 - STAGGER * 3);

  /* Opening draw: on load the vines that are already on screen would otherwise
     appear part-drawn. Scale everything from 0 once, then hand over to scroll. */
  let introStart = performance.now();
  function introFactor(now) {
    if (introStart === null) return 1;
    const t = (now - introStart) / INTRO_MS;
    if (t >= 1) { introStart = null; return 1; }
    return 1 - Math.pow(1 - t, 3);            // easeOutCubic
  }

  function draw(inst, factor) {
    const rect = inst.mount.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // 0 when the container's top reaches the viewport bottom, 1 as its far edge
    // clears the top — so the vine unfolds over the whole pass through the view.
    const p = clamp01((vh - rect.top) / (vh + rect.height * TAIL)) * factor;
    for (let i = 0; i < inst.strokes.length; i++) {
      const s = inst.strokes[i];
      const local = s.index < 0
        ? clamp01(p * 1.2)                                    // stem runs ahead
        : clamp01((p - s.index * STAGGER) / span);            // branches in sequence
      s.path.style.strokeDashoffset = s.len * (1 - local);
      if (s.bud) s.bud.style.opacity = clamp01(local * 6);    // bud opens with its branch
    }
  }

  function paint(now) {
    const factor = introFactor(now);
    for (let i = 0; i < instances.length; i++) {
      if (instances[i].visible) draw(instances[i], factor);
    }
    return factor;
  }

  let ticking = false;
  function schedule() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame((now) => { ticking = false; paint(now); });
  }

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const inst = instances.find((x) => x.mount === entry.target);
        if (inst) inst.visible = entry.isIntersecting;
      });
      schedule();
    }, { rootMargin: '260px 0px' });
    instances.forEach((inst) => io.observe(inst.mount));
  } else {
    instances.forEach((inst) => { inst.visible = true; });
  }

  // Layout is only ever read inside the rAF callback, never in the listener.
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('load', schedule);

  (function intro(now) {
    if (paint(now || performance.now()) < 1) window.requestAnimationFrame(intro);
  })();
}

/* ===========================================================================
 * 2. REVEALS
 * ========================================================================= */

function initReveals() {
  const items = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (!items.length) return;

  if (REDUCED || !('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }

  const io = new IntersectionObserver((entries, obs) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  items.forEach((el) => io.observe(el));
}

/* ===========================================================================
 * 3. NAVIGATION
 * ========================================================================= */

function initNav() {
  const burger = document.getElementById('burger');
  const nav = document.getElementById('navLinks');
  if (!burger || !nav) return;

  const desktop = window.matchMedia('(min-width: 1000px)');
  let open = false;

  const focusables = () => Array.prototype.slice
    .call(nav.querySelectorAll('a[href]'))
    .filter((el) => el.offsetParent !== null);

  function setOpen(next, returnFocus) {
    open = next;
    nav.classList.toggle('is-open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      const first = focusables()[0];
      if (first) first.focus();
    } else if (returnFocus) {
      burger.focus();
    }
  }

  burger.addEventListener('click', () => setOpen(!open, true));

  nav.addEventListener('click', (e) => {
    if (open && e.target.closest('a[href]')) setOpen(false, false);
  });

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false, true);
      return;
    }
    if (e.key !== 'Tab') return;

    // Trap: the panel's links plus the burger form the whole cycle, in DOM
    // order — the burger follows the nav in the markup, so it closes the loop.
    const cycle = focusables().concat([burger]);
    if (cycle.length < 2) return;
    const idx = cycle.indexOf(document.activeElement);

    if (idx === -1) {                                   // focus escaped the panel
      e.preventDefault();
      cycle[e.shiftKey ? cycle.length - 1 : 0].focus();
    } else if (e.shiftKey && idx === 0) {
      e.preventDefault();
      cycle[cycle.length - 1].focus();
    } else if (!e.shiftKey && idx === cycle.length - 1) {
      e.preventDefault();
      cycle[0].focus();
    }
  });

  document.addEventListener('click', (e) => {
    if (!open) return;
    if (nav.contains(e.target) || burger.contains(e.target)) return;
    setOpen(false, false);
  });

  const onBreakpoint = () => { if (desktop.matches && open) setOpen(false, false); };
  if (desktop.addEventListener) desktop.addEventListener('change', onBreakpoint);
  else if (desktop.addListener) desktop.addListener(onBreakpoint);
}

/* ===========================================================================
 * Boot
 * ========================================================================= */

function boot() {
  try { initVines(); }   catch (err) { console.warn('[zhyvitsa] vines skipped:', err); }
  try { initReveals(); } catch (err) { console.warn('[zhyvitsa] reveals skipped:', err); }
  try { initNav(); }     catch (err) { console.warn('[zhyvitsa] nav skipped:', err); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
