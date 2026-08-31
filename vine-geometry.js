/**
 * VineGeometry — curvy Stem + scroll-driven Vortex-Spiral branches
 * =============================================================================
 * STEM
 *   A central vertical axis (Z), given a pronounced organic curve via a
 *   sine-offset centerline, smoothed with quadratic midpoints.
 *
 * VINE (per branch)
 *   A flat spiral attached to one fixed anchor point on the stem. Its
 *   geometry is computed ONCE with respect to a secondary "vortex" center
 *   offset horizontally to the left or right of that anchor:
 *
 *     thetaOffset = (direction === 1) ? PI : 0
 *     vortexX     = anchorX - R0 * cos(thetaOffset)
 *     vortexZ     = anchorZ                       (purely horizontal offset)
 *     theta(t)    = thetaOffset + direction * t * turns * 2*PI
 *     r(t)        = R0 * (1 - t)                    // R0 (max) -> 0
 *     point(t)    = ( vortexX + r(t)*cos(theta(t)), vortexZ + r(t)*sin(theta(t)) )
 *
 *   By construction point(0) === (anchorX, anchorZ) exactly, and
 *   point(1) === (vortexX, vortexZ) exactly — the curve is anchored at
 *   Radius = Max on the stem and spirals inward to Radius = 0 at the
 *   vortex, independent of scroll.
 *
 * SCROLL BINDING
 *   Rather than rebuilding the path every frame, the full (0..1) curve is
 *   built once and drawn with the native SVG stroke-dash technique:
 *   strokeDasharray = totalLength, strokeDashoffset = totalLength * (1 -
 *   progress). At progress 0 the whole stroke is hidden past the anchor;
 *   as progress rises toward 1, more of the pre-built curve is revealed
 *   from the stationary start toward the vortex tip. This keeps the
 *   anchor provably stationary and is far cheaper per-frame than
 *   regenerating point arrays with trig on every scroll tick. See
 *   main.js for the scroll wiring that drives `progress`.
 * =============================================================================
 */

const svgNS = 'http://www.w3.org/2000/svg';

/** Polar -> Cartesian, offset from a center point. */
function polarToCartesian(cx, cz, r, theta) {
  return { x: cx + r * Math.cos(theta), z: cz + r * Math.sin(theta) };
}

/** Serialize a polyline of {x,z} points into an SVG path `d` string. */
function toPathData(points) {
  return points
    .map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(2) + ',' + p.z.toFixed(2))
    .join(' ');
}

/* ---------------------------------------------------------------------------
 * Stem: curvy organic centerline
 * ------------------------------------------------------------------------- */

/** The stem's centerline X as a function of height Z (a gentle sine sway). */
function stemXAt(z, o) {
  return o.stemX + o.curveAmplitude * Math.sin(z * o.curveFrequency + o.curvePhase);
}

/** Sample the curved centerline at fixed Z intervals. */
function sampleStemPoints(o) {
  const step = 40;
  const points = [];
  for (let z = 0; z <= o.stemLength; z += step) {
    points.push({ x: stemXAt(z, o), z });
  }
  const lastZ = points[points.length - 1].z;
  if (lastZ !== o.stemLength) {
    points.push({ x: stemXAt(o.stemLength, o), z: o.stemLength });
  }
  return points;
}

/**
 * Turn sampled points into a smooth path using quadratic midpoint
 * smoothing — each sample is a control point, each segment endpoint is
 * the midpoint to the next sample. Cheap way to avoid visible joints.
 */
function smoothPathFromPoints(points) {
  if (points.length < 2) return '';
  let d = 'M' + points[0].x.toFixed(2) + ',' + points[0].z.toFixed(2) + ' ';
  for (let i = 0; i < points.length - 1; i++) {
    const curr = points[i];
    const next = points[i + 1];
    const midX = ((curr.x + next.x) / 2).toFixed(2);
    const midZ = ((curr.z + next.z) / 2).toFixed(2);
    d += 'Q' + curr.x.toFixed(2) + ',' + curr.z.toFixed(2) + ' ' + midX + ',' + midZ + ' ';
  }
  const last = points[points.length - 1];
  d += 'L' + last.x.toFixed(2) + ',' + last.z.toFixed(2);
  return d;
}

/* ---------------------------------------------------------------------------
 * Vine: vortex-spiral, anchor stationary at Radius = Max
 * ------------------------------------------------------------------------- */

/**
 * Build the FULL static spiral curve once; scroll only ever changes how
 * much of it is drawn (via stroke-dash), never its geometry.
 *
 * @param {number} anchorX  X of the fixed point on the stem.
 * @param {number} anchorZ  Z of the fixed point on the stem.
 * @param {1|-1}   direction  Directional multiplier: which side the vortex sits on.
 * @param {number} R0       Starting (max) radius, measured at the anchor.
 * @param {number} turns    Number of full rotations from anchor to vortex.
 * @param {number} resolution  Point count (curve smoothness).
 */
function buildVortexSpiral(anchorX, anchorZ, direction, R0, turns, resolution) {
  const thetaOffset = direction === 1 ? Math.PI : 0;
  const vortexX = anchorX - R0 * Math.cos(thetaOffset);
  const vortexZ = anchorZ; // sin(thetaOffset) is 0 for 0/PI -> purely horizontal offset

  const points = [];
  for (let i = 0; i <= resolution; i++) {
    const t = i / resolution;                                  // 0 (stem) -> 1 (vortex)
    const theta = thetaOffset + direction * t * turns * Math.PI * 2;
    const r = R0 * (1 - t);                                     // Max -> 0
    points.push(polarToCartesian(vortexX, vortexZ, r, theta));
  }
  return { d: toPathData(points), vortexX, vortexZ };
}

/**
 * Build the structural model: one gently curved stem plus the anchor
 * points where spiral branches attach, spaced every `stepInterval` units
 * along Z.
 */
function build(opts) {
  const o = Object.assign({
    stemX: 100, stemLength: 900, stepInterval: 220,
    curveAmplitude: 34, curveFrequency: 0.012, curvePhase: 0
  }, opts || {});

  const stemPath = smoothPathFromPoints(sampleStemPoints(o));
  const anchors = [];
  for (let z = o.stepInterval; z < o.stemLength; z += o.stepInterval) {
    anchors.push({ x: stemXAt(z, o), z });
  }
  return { stemPath, anchors, viewBox: '0 0 200 ' + o.stemLength };
}

/**
 * Build the DOM: stem path + one fully-formed (but hidden-by-dash) spiral
 * path per anchor, inside `mount`. Direction alternates along the stem.
 * Each instance gets its own random curve phase for natural variety.
 *
 * @returns {{ svg: SVGElement, stem: SVGPathElement, branches: {path: SVGPathElement, index: number}[] }}
 */
function render(mount, opts) {
  const model = build(Object.assign({ curvePhase: Math.random() * Math.PI * 2 }, opts || {}));

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', model.viewBox);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  const stem = document.createElementNS(svgNS, 'path');
  stem.setAttribute('d', model.stemPath);
  stem.setAttribute('class', 'vine-stem-path');
  svg.appendChild(stem);

  const R0 = 55, TURNS = 2.6, RESOLUTION = 72;

  const branches = model.anchors.map((anchor, index) => {
    const direction = index % 2 === 0 ? 1 : -1; // vortex to the right / left
    const spiral = buildVortexSpiral(anchor.x, anchor.z, direction, R0, TURNS, RESOLUTION);

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('class', 'vine-spiral-path');
    path.setAttribute('d', spiral.d);
    svg.appendChild(path);

    const bud = document.createElementNS(svgNS, 'circle');
    bud.setAttribute('cx', anchor.x);
    bud.setAttribute('cy', anchor.z);
    bud.setAttribute('r', 3);
    bud.setAttribute('class', 'vine-bud');
    svg.appendChild(bud);

    return { path, index };
  });

  mount.appendChild(svg);
  return { svg, stem, branches };
}

export const VineGeometry = {
  build,
  render,
  buildVortexSpiral,
  polarToCartesian,
  stemXAt,
  toPathData
};
