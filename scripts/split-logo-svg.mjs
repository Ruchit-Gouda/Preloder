/**
 * split-logo-svg.mjs  (v2 — feature-following split)
 * -----------------------------------------------------------------------------
 * Splits a vector SVG logo into independent, individually-animatable pieces
 * for the preloader — without re-tracing and without approximating the shape.
 *
 * v2 changes the *cut strategy*. v1 used a straight 3x4 grid, which ignored the
 * artwork. v2 cuts along the logo's own structure:
 *
 *   ┌──────────────┐
 *   │    ╱│ sail   │   the curved upper mass, fanned from its bottom-right
 *   │  ╱  │        │   corner into radial slices
 *   ├──────────────┤   ← horizontal seam that already exists in the artwork
 *   │  ╱ band ╱    │   the 45° lower band, sliced perpendicular to its run
 *   └──────────────┘
 *
 * Pipeline
 *  1. Parse logo.svg: read the group transform + path data.
 *  2. Flatten every curve (cubic/quadratic) into fine line segments.
 *  3. Apply the transform, then normalise the artwork to its own bounding box.
 *  4. Partition with sequential half-plane clips:
 *       a. horizontal seam  -> "sail" group + "band" group
 *       b. sail: radial fan from the corner where its straight edges meet
 *       c. band: slices perpendicular to the band's principal axis
 *     Every cut is a plane through one convex region, so the pieces tile the
 *     artwork exactly: shared edges, no gaps, no overlaps.
 *  5. Emit src/data/logoParts.js + a reference SVG for verification.
 *
 * Usage:  node scripts/split-logo-svg.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/* ── CONFIG ──────────────────────────────────────────────────────────────── */
const SRC = 'logo.svg';
const OUT = 'src/data/logoParts.js';
const REF_SVG = 'public/logo-reference.svg';

const FLATTEN_TOL = 1; // curve flattening tolerance, in source units
const DECIMALS = 2; // coordinate precision in the emitted path data
const MIN_AREA = 120; // drop clipped slivers smaller than this (viewBox units^2)
const FILL = 'currentColor'; // see --preloader-logo-color in preloader.css

/* Feature cuts, expressed as fractions of the artwork bounding box so they
 * scale with the logo. Values were measured from the artwork itself (see
 * "Geometry report" printed at the end of a run). */
const FEATURES = {
  /* The horizontal edge where the curved mass meets the diagonal band.
   * 1208.20 / 1747.82 = 0.6913. Pieces above are "sail", below are "band". */
  seamY: 0.6913,

  /* The sail's two straight edges meet at this corner (bottom-right).
   * 642.6 / 1400.04 = 0.459. The fan radiates from here. */
  sailCornerX: 0.459,

  /* Fan the sail into this many radial slices, sweeping from the vertical
   * right edge towards the horizontal bottom edge. */
  sailSlices: 4,

  /* Slice the diagonal band into this many segments, perpendicular to its
   * principal axis (measured from the geometry, not assumed to be 45°). */
  bandSegments: 5,
};

/* ── Affine matrix helpers ───────────────────────────────────────────────── */
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function parseTransform(str) {
  let m = [1, 0, 0, 1, 0, 0];
  const re = /(translate|scale|matrix)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const n = t[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (t[1] === 'translate') m = mul(m, [1, 0, 0, 1, n[0] || 0, n[1] || 0]);
    else if (t[1] === 'scale') m = mul(m, [n[0], 0, 0, n.length > 1 ? n[1] : n[0], 0, 0]);
    else if (t[1] === 'matrix') m = mul(m, n);
  }
  return m;
}

/* ── Path parsing ────────────────────────────────────────────────────────── */
function tokenize(d) {
  return d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
}

function parsePath(d) {
  const tk = tokenize(d);
  const subpaths = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let prevC = null, prevQ = null; // reflection points for S/T
  let i = 0;
  let cmd = null;

  const num = () => Number(tk[i++]);
  const start = (px, py) => {
    cur = { start: { x: px, y: py }, segs: [] };
    subpaths.push(cur);
    x = sx = px;
    y = sy = py;
  };

  while (i < tk.length) {
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(tk[i])) cmd = tk[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';

    switch (cmd) {
      case 'M': start(num(), num()); prevC = prevQ = null; break;
      case 'm': start(x + num(), y + num()); prevC = prevQ = null; break;
      case 'L': { const nx = num(), ny = num(); cur.segs.push({ type: 'L', p: { x: nx, y: ny } }); x = nx; y = ny; break; }
      case 'l': { const nx = x + num(), ny = y + num(); cur.segs.push({ type: 'L', p: { x: nx, y: ny } }); x = nx; y = ny; break; }
      case 'H': { const nx = num(); cur.segs.push({ type: 'L', p: { x: nx, y } }); x = nx; break; }
      case 'h': { const nx = x + num(); cur.segs.push({ type: 'L', p: { x: nx, y } }); x = nx; break; }
      case 'V': { const ny = num(); cur.segs.push({ type: 'L', p: { x, y: ny } }); y = ny; break; }
      case 'v': { const ny = y + num(); cur.segs.push({ type: 'L', p: { x, y: ny } }); y = ny; break; }
      case 'C':
      case 'c': {
        const rel = cmd === 'c';
        const p1 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        const p2 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        const p3 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        cur.segs.push({ type: 'C', p0: { x, y }, p1, p2, p3 });
        prevC = p2; prevQ = null; x = p3.x; y = p3.y; break;
      }
      case 'S':
      case 's': {
        const rel = cmd === 's';
        const p1 = prevC ? { x: 2 * x - prevC.x, y: 2 * y - prevC.y } : { x, y };
        const p2 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        const p3 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        cur.segs.push({ type: 'C', p0: { x, y }, p1, p2, p3 });
        prevC = p2; prevQ = null; x = p3.x; y = p3.y; break;
      }
      case 'Q':
      case 'q': {
        const rel = cmd === 'q';
        const c = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        const p3 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        cur.segs.push({ type: 'Q', p0: { x, y }, c, p3 });
        prevQ = c; prevC = null; x = p3.x; y = p3.y; break;
      }
      case 'T':
      case 't': {
        const rel = cmd === 't';
        const c = prevQ ? { x: 2 * x - prevQ.x, y: 2 * y - prevQ.y } : { x, y };
        const p3 = { x: (rel ? x : 0) + num(), y: (rel ? y : 0) + num() };
        cur.segs.push({ type: 'Q', p0: { x, y }, c, p3 });
        prevQ = c; prevC = null; x = p3.x; y = p3.y; break;
      }
      case 'Z':
      case 'z':
        if (cur && (x !== sx || y !== sy)) cur.segs.push({ type: 'L', p: { x: sx, y: sy } });
        x = sx; y = sy; prevC = prevQ = null;
        break;
      default:
        throw new Error(`Unsupported path command: ${cmd}`);
    }
  }
  return subpaths;
}

/* ── Curve flattening ────────────────────────────────────────────────────── */
const distToLine = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
};

function flattenCubic(p0, p1, p2, p3, tol, out) {
  const stack = [[p0, p1, p2, p3, 0]];
  while (stack.length) {
    const [a, b, c, d, depth] = stack.pop();
    if (depth > 18 || (distToLine(b, a, d) <= tol && distToLine(c, a, d) <= tol)) {
      out.push(d);
      continue;
    }
    const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    const cd = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
    const abc = { x: (ab.x + bc.x) / 2, y: (ab.y + bc.y) / 2 };
    const bcd = { x: (bc.x + cd.x) / 2, y: (bc.y + cd.y) / 2 };
    const mid = { x: (abc.x + bcd.x) / 2, y: (abc.y + bcd.y) / 2 };
    stack.push([mid, bcd, cd, d, depth + 1]);
    stack.push([a, ab, abc, mid, depth + 1]);
  }
}

/* ── Polygon utilities ───────────────────────────────────────────────────── */
function clean(poly) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0].x - out[out.length - 1].x) < 1e-6 &&
    Math.abs(out[0].y - out[out.length - 1].y) < 1e-6
  ) out.pop();
  // Drop collinear points.
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length], b = out[i], c = out[(i + 1) % out.length];
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) > 1e-6) res.push(b);
  }
  return res.length >= 3 ? res : [];
}

const area = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

const centroid = (poly) => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return poly[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
};

const toPath = (poly) =>
  'M ' + poly.map((p) => `${+p.x.toFixed(DECIMALS)} ${+p.y.toFixed(DECIMALS)}`).join(' L ') + ' Z';

/**
 * Clip one convex polygon by a half-plane, Sutherland–Hodgman style.
 * `value(p)` is the signed distance along the cutting plane's normal:
 * keep points where `keepNegative ? value <= cut : value >= cut`.
 */
function clipHalf(poly, value, cut, keepNegative) {
  const N = poly.length;
  if (!N) return [];
  const inside = (v) => (keepNegative ? v <= cut : v >= cut);
  const out = [];
  for (let i = 0; i < N; i++) {
    const cur = poly[i];
    const prev = poly[(i + N - 1) % N];
    const vCur = value(cur);
    const vPrev = value(prev);
    const curIn = inside(vCur);
    const prevIn = inside(vPrev);
    if (curIn) {
      if (!prevIn) {
        const t = (cut - vPrev) / (vCur - vPrev);
        out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
      }
      out.push(cur);
    } else if (prevIn) {
      const t = (cut - vPrev) / (vCur - vPrev);
      out.push({ x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) });
    }
  }
  return clean(out);
}

/** Clip a list of polygons, returning the kept side. */
function clipAll(polys, value, cut, keepNegative) {
  return polys.map((p) => clipHalf(p, value, cut, keepNegative)).filter((p) => p.length >= 3);
}

/* ── 1. Read + parse the source SVG ──────────────────────────────────────── */
const raw = readFileSync(SRC, 'utf8');
const viewBoxAttr = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 100 100';
const transformAttr = /<g[^>]*transform="([^"]+)"/.exec(raw)?.[1] ?? '';
const pathDs = [...raw.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
if (!pathDs.length) throw new Error(`No <path> found in ${SRC}`);

const M = parseTransform(transformAttr);
console.log(`${SRC}: viewBox="${viewBoxAttr}", ${pathDs.length} path(s), transform="${transformAttr}"`);

/* ── 2. Flatten every path into transformed polygons ─────────────────────── */
const polygons = [];
for (const d of pathDs) {
  for (const sp of parsePath(d)) {
    const pts = [{ x: sp.start.x, y: sp.start.y }];
    for (const seg of sp.segs) {
      if (seg.type === 'L') pts.push(seg.p);
      else if (seg.type === 'C') flattenCubic(seg.p0, seg.p1, seg.p2, seg.p3, FLATTEN_TOL, pts);
      else if (seg.type === 'Q') {
        const c1 = { x: seg.p0.x + (2 / 3) * (seg.c.x - seg.p0.x), y: seg.p0.y + (2 / 3) * (seg.c.y - seg.p0.y) };
        const c2 = { x: seg.p3.x + (2 / 3) * (seg.c.x - seg.p3.x), y: seg.p3.y + (2 / 3) * (seg.c.y - seg.p3.y) };
        flattenCubic(seg.p0, c1, c2, seg.p3, FLATTEN_TOL, pts);
      }
    }
    polygons.push(pts.map((p) => apply(M, p.x, p.y)));
  }
}
console.log(`flattened to ${polygons.length} polygon(s), ${polygons.reduce((s, p) => s + p.length, 0)} points`);

/* ── 3. Normalise to the artwork bounding box ────────────────────────────── */
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
for (const poly of polygons) for (const p of poly) {
  if (p.x < X0) X0 = p.x;
  if (p.x > X1) X1 = p.x;
  if (p.y < Y0) Y0 = p.y;
  if (p.y > Y1) Y1 = p.y;
}
const bw = X1 - X0;
const bh = Y1 - Y0;
const local = polygons.map((poly) => poly.map((p) => ({ x: p.x - X0, y: p.y - Y0 })));
console.log(`artwork bbox: ${bw.toFixed(2)} x ${bh.toFixed(2)} at (${X0.toFixed(2)}, ${Y0.toFixed(2)})`);

/* ── 4a. Split at the artwork's own horizontal seam ──────────────────────── */
const seamY = FEATURES.seamY * bh;
const byY = (p) => p.y;
const sailGroup = clipAll(local, byY, seamY, true); // above the seam
const bandGroup = clipAll(local, byY, seamY, false); // below the seam

/* ── 4b. Fan the sail from its corner ────────────────────────────────────── */
const corner = { x: FEATURES.sailCornerX * bw, y: seamY };

// Signed area test: is point q counter-clockwise of ray `ang` from `origin`?
const sideOfRay = (q, ang) =>
  Math.cos(ang) * (q.y - corner.y) - Math.sin(ang) * (q.x - corner.x);

/**
 * Split a group by a ray from the sail corner, keeping the requested angular
 * side. `probeAngle` names which side to keep (a point in that direction).
 */
function splitByRay(group, rayAngle, keepProbeAngle) {
  const keepSign = Math.sign(sideOfRay(
    { x: corner.x + Math.cos(keepProbeAngle), y: corner.y + Math.sin(keepProbeAngle) },
    rayAngle,
  ));
  const value = (p) => sideOfRay(p, rayAngle) * keepSign;
  return {
    keep: clipAll(group, value, 0, false),
    other: clipAll(group, value, 0, true),
  };
}

const DEG = Math.PI / 180;
const SLICES = Math.max(2, FEATURES.sailSlices);
const a0 = 180 * DEG; // towards the horizontal bottom edge
const a1 = 270 * DEG; // towards the vertical right edge (y grows downward)
const rays = [];
for (let i = 1; i < SLICES; i++) rays.push(a0 + ((a1 - a0) * i) / SLICES);

// Sequential bisection: each ray peels one angular slice off the current wedge.
let remaining = sailGroup;
const fanPieces = []; // ordered from the vertical edge (apex) to the horizontal edge
let lowerBound = a0;
for (let i = 0; i < rays.length; i++) {
  const ray = rays[i];
  // Keep the *upper* angular part for later slices; peel off the lower slice.
  const keepProbe = (lowerBound + ray) / 2;
  const split = splitByRay(remaining, ray, keepProbe);
  fanPieces.push(split.keep);
  remaining = split.other;
  lowerBound = ray;
}
fanPieces.push(remaining); // final slice, against the vertical edge
fanPieces.reverse(); // now: apex/vertical edge -> bottom-left
// Drop empties.
const sailPieces = fanPieces.filter((g) => g.reduce((s, p) => s + area(p), 0) >= MIN_AREA);

/* ── 4c. Slice the band perpendicular to its principal axis ──────────────── */
const bandArea = bandGroup.reduce((s, p) => s + area(p), 0);

/**
 * Principal axis of a polygon set using AREA moments, not vertex moments.
 *
 * Vertex-based PCA is skewed by densely sampled straight edges, which pushed
 * the band's axis to ~17° instead of its true ~45° run. Integrating over area
 * gives the strip's real long axis.
 */
function areaAxes(polys) {
  let A = 0, Mx = 0, My = 0, Ixx = 0, Iyy = 0, Ixy = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const cross = p.x * q.y - q.x * p.y;
      A += cross;
      Mx += (p.x + q.x) * cross;
      My += (p.y + q.y) * cross;
      Iyy += (p.x * p.x + p.x * q.x + q.x * q.x) * cross;
      Ixx += (p.y * p.y + p.y * q.y + q.y * q.y) * cross;
      Ixy += (p.x * q.y + 2 * p.x * p.y + 2 * q.x * q.y + q.x * p.y) * cross;
    }
  }
  A *= 0.5;
  if (Math.abs(A) < 1e-9) return { angle: Math.PI / 4, cx: 0, cy: 0 };
  const cx = Mx / (6 * A);
  const cy = My / (6 * A);
  const Cxx = Iyy / (12 * A) - cx * cx;
  const Cyy = Ixx / (12 * A) - cy * cy;
  const Cxy = Ixy / (24 * A) - cx * cy;
  return { angle: 0.5 * Math.atan2(2 * Cxy, Cxx - Cyy), cx, cy };
}

const { angle: axisAngle, cx: bandCx, cy: bandCy } = areaAxes(bandGroup);
const axis = { x: Math.cos(axisAngle), y: Math.sin(axisAngle) };
const project = (p) => p.x * axis.x + p.y * axis.y;
const uMin = Math.min(...bandGroup.flat().map(project));
const uMax = Math.max(...bandGroup.flat().map(project));

// Sequential guillotine cuts along the axis.
let rest = bandGroup;
const bandSlices = [];
const SEGMENTS = Math.max(1, FEATURES.bandSegments);
for (let i = 1; i < SEGMENTS; i++) {
  const cut = uMin + ((uMax - uMin) * i) / SEGMENTS;
  bandSlices.push(clipAll(rest, project, cut, true));
  rest = clipAll(rest, project, cut, false);
}
bandSlices.push(rest);

/* ── 5. Assemble the piece list ──────────────────────────────────────────── */
const pieces = [];
const pushPiece = (id, group) => {
  const polys = group.filter((p) => area(p) >= 1);
  if (!polys.length) return;
  const ink = polys.reduce((s, p) => s + area(p), 0);
  if (ink < MIN_AREA) return;
  const pts = polys.flat();
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  pieces.push({
    id,
    polys,
    ink,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    centroid: centroid(polys[0]),
  });
};

// Naming is the animation stagger order: sail from the apex down to the left,
// then the band from its upper-left end to its lower-right end.
sailPieces.forEach((g, i) => pushPiece(`part-sail-${i + 1}`, g));
bandSlices.forEach((g, i) => pushPiece(`part-band-${i + 1}`, g));

const totalInk = pieces.reduce((s, p) => s + p.ink, 0);
const artworkArea = local.reduce((s, p) => s + area(p), 0);
console.log(`\nseam y=${seamY.toFixed(2)}  band axis=${((axisAngle * 180) / Math.PI).toFixed(1)}°  band centre=(${bandCx.toFixed(0)},${bandCy.toFixed(0)})`);
console.log(`split into ${pieces.length} feature pieces (${sailPieces.length} sail + ${bandSlices.length} band)`);

for (const p of pieces) {
  const [x0, y0, x1, y1] = p.bbox;
  console.log(
    `  ${p.id.padEnd(14)} polys=${String(p.polys.length).padStart(2)} ` +
    `pts=${String(p.polys.reduce((s, q) => s + q.length, 0)).padStart(3)} ` +
    `area=${String(Math.round(p.ink)).padStart(6)} ` +
    `bbox=[${x0.toFixed(0)},${y0.toFixed(0)} ${(x1 - x0).toFixed(0)}x${(y1 - y0).toFixed(0)}]`,
  );
}
console.log(
  `total piece area=${Math.round(totalInk)}  artwork area=${Math.round(artworkArea)}  ` +
  `delta=${(totalInk - artworkArea).toFixed(2)} (${(((totalInk - artworkArea) / artworkArea) * 100).toFixed(4)}%)`,
);

/* ── 6. Emit logoParts.js ────────────────────────────────────────────────── */
const entries = pieces.map((p) => {
  const ds = p.polys.map(toPath);
  const lines = [`    id: '${p.id}',`];
  if (ds.length === 1) lines.push(`    d: '${ds[0]}',`);
  else {
    lines.push('    paths: [');
    for (const d of ds) lines.push(`      '${d}',`);
    lines.push('    ],');
  }
  lines.push(`    fill: '${FILL}',`);
  return `  {\n${lines.join('\n')}\n  },`;
}).join('\n');

const out = `/**
 * logoParts.js — GENERATED by scripts/split-logo-svg.mjs
 * -----------------------------------------------------------------------------
 * Source: ${SRC}  ·  ${pieces.length} feature-following pieces
 * (${sailPieces.length} sail slices + ${bandSlices.length} band segments).
 *
 * These are real vector pieces clipped from your logo's own path data along its
 * own structural lines — not a grid. The pieces partition the artwork, so their
 * union reconstructs it exactly.
 *
 * Regenerate with:  node scripts/split-logo-svg.mjs
 */
export const LOGO_VIEWBOX = '0 0 ${bw.toFixed(2)} ${bh.toFixed(2)}';

export const LOGO_PARTS = [
${entries}
];

export default LOGO_PARTS;
`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

/* ── 7. Reference SVG for verification / eyeballing ──────────────────────── */
const refPaths = pieces
  .map((p) => p.polys.map((poly) => `  <path d="${toPath(poly)}"/>`).join('\n'))
  .join('\n');
mkdirSync(dirname(REF_SVG), { recursive: true });
writeFileSync(
  REF_SVG,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bw.toFixed(2)} ${bh.toFixed(2)}" ` +
    `width="${bw.toFixed(2)}" height="${bh.toFixed(2)}">\n` +
    `<rect width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="#6C35D4"/>\n` +
    `<g fill="#FFFFFF">\n${refPaths}\n</g>\n</svg>\n`,
);

console.log(`\nwrote ${OUT}`);
console.log(`wrote ${REF_SVG}`);
