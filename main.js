/**
 * Zhyvitsa — site wiring
 * =============================================================================
 *  1. Garden  — fixed canvas background: branching strikes that grow with
 *               scroll (see garden.js).
 *  2. Reveals — short opacity/translate entrance for .reveal elements.
 *  3. Nav     — burger menu: aria-expanded, focus trap, Escape, outside click.
 *
 *  Every subsystem is wrapped in its own try/catch: if one throws, the rest of
 *  the page — and all of its content — still works.
 * =============================================================================
 */

import { initGarden } from './garden.js';

const REDUCED = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
  : false;

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
 * 4. SCROLL HINT — fades once the page starts moving
 * ========================================================================= */

function initHint() {
  const hint = document.querySelector('.scroll-hint');
  if (!hint) return;
  const off = () => {
    if (window.scrollY > 40) { hint.classList.add('is-gone'); window.removeEventListener('scroll', off); }
  };
  window.addEventListener('scroll', off, { passive: true });
}

/* ===========================================================================
 * Boot
 * ========================================================================= */

function boot() {
  try { initGarden(document.getElementById('garden')); } catch (err) { console.warn('[zhyvitsa] garden skipped:', err); }
  try { initHint(); }    catch (err) { /* cosmetic */ }
  try { initReveals(); } catch (err) { console.warn('[zhyvitsa] reveals skipped:', err); }
  try { initNav(); }     catch (err) { console.warn('[zhyvitsa] nav skipped:', err); }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
