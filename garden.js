/**
 * Zhyvitsa — scroll-driven branch background
 * =============================================================================
 * Branching, forking stems grow in from the viewport edges like slow
 * lightning. Growth is bound to scroll:
 *
 *   strike 0      grows on load (behind the hero)
 *   strike 1…N-1  each take an equal share of the page's scroll range
 *
 * Scrolling down grows the current strike; scrolling up un-grows it.
 *
 * Performance
 *   - Two stacked canvases: `base` holds finished strikes, `live` the growing
 *     one. A frame only strokes the segments added since the last frame —
 *     no full-screen clears or composites. Settling is a CSS opacity change.
 *   - Segments are batched into one path per thickness bucket (4 strokes per
 *     frame, however many segments were added).
 *   - Strikes are generated lazily (next one prepared in idle time), with a
 *     segment budget scaled to screen area; DPR capped at 1.5.
 *   - Nothing runs while the page is still: rAF is only requested on scroll,
 *     during the intro, or while easing toward the scroll position.
 * =============================================================================
 */

const INK = '112,30,26';        // deep red-brown, darker than --red, like bark
const U = 1000;                 // world width in units; height follows aspect
const FINAL = 0.55;             // opacity a finished strike settles to
const GROW_SHARE = 0.86;        // part of a strike's slot spent growing; the rest settles
const N = 4;                    // strikes per page (fewer = airier end state)
const INTRO_MS = 2200;
const RECEDE = 1;            // how much older strikes fade when a new one lands

// edges: 0 top, 1 bottom, 2 left, 3 right · position along edge · heading jitter
const SCRIPT = [
  [3, 0.18, 0.12],   // hero: right edge, near the top
  [1, 0.55, -0.05],  // bottom centre
  [2, 0.45, 0.05],   // left edge
  [0, 0.86, 0.45],   // top right
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idle = window.requestIdleCallback
  ? (fn) => window.requestIdleCallback(fn, { timeout: 1500 })
  : (fn) => setTimeout(fn, 200);

export function initGarden(host) {
  if (!host) return;
  const baseCv = document.createElement('canvas');
  const liveCv = document.createElement('canvas');
  if (!baseCv.getContext) return;
  host.append(baseCv, liveCv);
  const bctx = baseCv.getContext('2d');
  const lctx = liveCv.getContext('2d');
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W = 0, H = 0, dpr = 1, k = 1, UH = U, MAX = 8000;
  let trees = [];

  /* ---------------------------------------------------------- generation */
  function genTree(i) {
    // own seed per strike, so lazy order never changes the shapes
    const rand = mulberry32(20260522 + i * 7919);
    const rnd = (a = 1, b) => (b === undefined ? rand() * a : a + rand() * (b - a));
    const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;

    const [edge, p, j] = SCRIPT[i];
    let x0, y0, h;
    if (edge === 0) { x0 = p * U; y0 = 0; h = Math.PI / 2 + j; }
    else if (edge === 1) { x0 = p * U; y0 = UH; h = -Math.PI / 2 + j; }
    else if (edge === 2) { x0 = 0; y0 = p * UH; h = j; }
    else { x0 = U; y0 = p * UH; h = Math.PI + j; }
    const reach = (edge < 2 ? UH : U) * 0.95;

    function grow() {
      const segs = [];
      const queue = [{ x: x0, y: y0, a: h, dir: h, w: 3.2, t: 0, len: reach * rnd(0.8, 1.05), d: 0 }];
      let qi = 0;
      while (qi < queue.length && segs.length < MAX * 6) {
        const b = queue[qi++];
        let { x, y, a, w, t } = b;
        const step = Math.max(2.6, 6.5 - b.d * 0.6);
        const speed = 1150 * Math.pow(0.8, b.d);
        const n = Math.floor(b.len / step);
        const pBranch = b.d === 0 ? 0.06 : Math.min(0.2, 0.08 + b.d * 0.02);
        const jitter = 0.18 + b.d * 0.06;
        for (let s = 0; s < n; s++) {
          a += gauss() * jitter + (b.dir - a) * 0.05;
          const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
          if (nx < -4 || ny < -4 || nx > U + 4 || ny > UH + 4) break;
          segs.push(x, y, nx, ny, w, t);
          t += step / speed;
          x = nx; y = ny;
          const rest = (n - s) * step;
          if (b.d < 6 && rand() < pBranch && rest > 8) {
            const ca = a + (rand() < 0.5 ? -1 : 1) * rnd(0.3, 1.1);
            queue.push({
              x, y, a: ca, dir: ca + gauss() * 0.4,
              w: Math.max(0.3, w * rnd(0.55, 0.72)), t,
              len: Math.max(6, b.len * rnd(0.36, 0.68) * (0.5 + 0.5 * rest / b.len)), d: b.d + 1,
            });
          }
          w = Math.max(0.3, w * 0.998);
        }
      }
      return segs;
    }

    let segs = [];
    for (let tries = 0; tries < 3 && segs.length < MAX * 6 * 0.55; tries++) {
      const s = grow();
      if (s.length > segs.length) segs = s;
    }

    // sort by birth time; store in pixel space with a precomputed width bucket
    const count = segs.length / 6;
    const idx = new Uint32Array(count);
    for (let q = 0; q < count; q++) idx[q] = q;
    idx.sort((a, b) => segs[a * 6 + 5] - segs[b * 6 + 5]);
    const xy = new Float32Array(count * 4);
    const t = new Float32Array(count);
    const bucket = new Uint8Array(count);
    const sc = k * dpr;
    for (let q = 0; q < count; q++) {
      const o = idx[q] * 6;
      xy[q * 4] = segs[o] * sc; xy[q * 4 + 1] = segs[o + 1] * sc;
      xy[q * 4 + 2] = segs[o + 2] * sc; xy[q * 4 + 3] = segs[o + 3] * sc;
      const w = segs[o + 4];
      bucket[q] = w < 0.55 ? 0 : w < 0.9 ? 1 : w < 1.5 ? 2 : 3;
      t[q] = segs[o + 5];
    }
    return { xy, t, bucket, n: count, dur: count ? t[count - 1] : 1 };
  }

  const tree = (i) => trees[i] || (trees[i] = genTree(i));

  /* ------------------------------------------------------------- drawing */
  const BW = [0.42, 0.7, 1.15, 2.6];          // representative width per bucket
  let STYLE = [];
  function setupStyles() {
    STYLE = BW.map((w) => ({
      width: Math.max(0.6, w * k * 1.2) * dpr,
      color: `rgba(${INK},${Math.min(1, 0.45 + w * 0.3)})`,
    }));
  }

  function strokeRange(c, tr, from, to) {
    if (to <= from) return;
    const { xy, bucket } = tr;
    for (let b = 0; b < 4; b++) {
      let any = false;
      c.beginPath();
      for (let i = from; i < to; i++) {
        if (bucket[i] !== b) continue;
        const o = i * 4;
        c.moveTo(xy[o], xy[o + 1]);
        c.lineTo(xy[o + 2], xy[o + 3]);
        any = true;
      }
      if (!any) continue;
      c.lineWidth = STYLE[b].width;
      c.strokeStyle = STYLE[b].color;
      c.stroke();
    }
  }

  function lowerBound(tr, tt) {
    const t = tr.t;
    let lo = 0, hi = tr.n;
    while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < tt) lo = m + 1; else hi = m; }
    return lo;
  }

  // finished strikes 0..upto-1, older ones receding
  let bakedUpTo = -1;
  function rebuildBase(upto) {
    bctx.globalAlpha = 1;
    bctx.clearRect(0, 0, baseCv.width, baseCv.height);
    for (let i = 0; i < upto; i++) {
      bctx.globalCompositeOperation = 'destination-out';
      bctx.fillStyle = `rgba(0,0,0,${RECEDE})`;
      bctx.fillRect(0, 0, baseCv.width, baseCv.height);
      bctx.globalCompositeOperation = 'source-over';
      bctx.globalAlpha = FINAL;
      strokeRange(bctx, tree(i), 0, tree(i).n);
      bctx.globalAlpha = 1;
    }
    bakedUpTo = upto;
  }

  /* -------------------------------------------------------------- layout */
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = host.clientWidth || window.innerWidth;
    H = host.clientHeight || window.innerHeight;
    for (const c of [baseCv, liveCv]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    for (const c of [bctx, lctx]) { c.lineCap = 'round'; c.lineJoin = 'round'; }
    k = W / U; UH = H / k;
    MAX = Math.round(Math.min(5000, Math.max(2200, (W * H) / 260)));
    setupStyles();
    trees = [];
    bakedUpTo = -1; drawn = 0; curIndex = -1;
  }

  /* --------------------------------------------------------------- state */
  let curIndex = -1, drawn = 0, lastOpacity = -1, lastBaseOpacity = -1;
  let g = 0;
  let introStart = performance.now();
  let pending = false;
  let maxScroll = 1;

  const measure = () => { maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight); };

  function computeTarget(now) {
    let intro = 1;
    if (introStart !== null) {
      intro = Math.min(1, Math.max(0, (now - introStart) / INTRO_MS));
      if (intro >= 1) introStart = null;
    }
    const eased = 1 - Math.pow(1 - intro, 2);
    const p = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    return Math.min(N, eased + p * (N - 1));
  }

  function frame(now) {
    pending = false;
    const target = computeTarget(now);
    const diff = target - g;
    g = Math.abs(diff) < 0.0008 ? target : g + diff * 0.16;

    const i = Math.max(0, Math.min(N - 1, Math.floor(g)));
    const local = Math.min(1, g - i);

    if (bakedUpTo !== i) rebuildBase(i);
    if (curIndex !== i) {
      curIndex = i; drawn = 0;
      lctx.clearRect(0, 0, liveCv.width, liveCv.height);
      if (i + 1 < N && !trees[i + 1]) idle(() => tree(i + 1));   // prepare the next strike
    }

    const tr = tree(i);
    const growP = Math.min(1, local / GROW_SHARE);
    const settle = Math.max(0, (local - GROW_SHARE) / (1 - GROW_SHARE));
    const want = growP >= 1 ? tr.n : lowerBound(tr, growP * tr.dur);

    if (want < drawn) {                       // scrolled back: redraw what remains
      lctx.clearRect(0, 0, liveCv.width, liveCv.height);
      drawn = 0;
    }
    if (want > drawn) { strokeRange(lctx, tr, drawn, want); drawn = want; }

    const op = Math.round((1 - (1 - FINAL) * (1 - Math.pow(1 - settle, 2))) * 100) / 100;
    if (op !== lastOpacity) { liveCv.style.opacity = op; lastOpacity = op; }
    // older strikes dim smoothly while the new one grows (lands exactly on the
    // next rebuild's RECEDE step, so there is no jump at the hand-over)
    const bop = i === 0 ? 1 : Math.round((1 - RECEDE * growP) * 100) / 100;
    if (bop !== lastBaseOpacity) { baseCv.style.opacity = bop; lastBaseOpacity = bop; }

    if (g !== target || introStart !== null) schedule();
  }

  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(frame);
  }

  function drawStatic() {
    rebuildBase(N);
    lctx.clearRect(0, 0, liveCv.width, liveCv.height);
  }

  layout();
  measure();
  host.classList.add('is-ready');

  // Rebuild only on width change (mobile URL bars resize height constantly;
  // the layer is 100lvh tall so it does not need to follow them).
  let lastW = W, rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      measure();
      if (host.clientWidth === lastW) { schedule(); return; }
      lastW = host.clientWidth;
      layout();
      if (reduced) drawStatic(); else { g = computeTarget(performance.now()); schedule(); }
    }, 180);
  }, { passive: true });

  if (reduced) { drawStatic(); return; }

  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(document.body);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('load', () => { measure(); schedule(); });
  schedule();
}
