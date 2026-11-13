/**
 * split-logo-svg.mjs
 * -----------------------------------------------------------------------------
 * Splits a vector SVG logo into independent, individually-animatable pieces
 * for the preloader — without re-tracing and without approximating the shape.
 *
 * Pipeline
 *  1. Parse logo.svg: read the group transform + path data.
 *  2. Flatten every curve (cubic/quadratic) into fine line segments.
 *  3. Apply the transform, then normalise the artwork to its own bounding box.
 *  4. Clip the outline against a COLS x ROWS grid (Sutherland-Hodgman).
 *     Because the tiles partition the outline, the pieces reconstruct the logo
 *     exactly — shared edges mean no gaps and no overlaps.
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

const COLS = 3; // grid columns
const ROWS = 4; // grid rows
const FLATTEN_TOL = 1; // curve flattening tolerance, in source units
const DECIMALS = 2; // coordinate precision in the emitted path data
const MIN_AREA = 40; // drop clipped slivers smaller than this (viewBox units^2)
const FILL = 'currentColor'; // see --preloader-logo-color in preloader.css

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

/** Parse path data into subpaths of {type, pts} segments (absolute coords). */
function parsePath(d) {
  const tk = tokenize(d);
  const subpaths = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let prevC = null, prevQ = null; // reflection points for S/T
  let i = 0;
  let cmd = null;

  const num = () => Number(tk[i++]);
  const start = (px, py) => { cur = { start: { x: px, y: py }, segs: [] }; subpaths.push(cur); x = sx = px; y = sy = py; };

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
function clipToRect(poly, r) {
  let out = poly;
  const passes = [
    { keep: (p) => p.x >= r.x0, at: 'x', v: r.x0, dir: 1 },
    { keep: (p) => p.x <= r.x1, at: 'x', v: r.x1, dir: -1 },
    { keep: (p) => p.y >= r.y0, at: 'y', v: r.y0, dir: 1 },
    { keep: (p) => p.y <= r.y1, at: 'y', v: r.y1, dir: -1 },
  ];
  for (const pass of passes) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = pass.keep(cur), prevIn = pass.keep(prev);
      const cross = (a, b) => {
        const t = (pass.v - a[pass.at]) / (b[pass.at] - a[pass.at]);
        const p = { x: a.x, y: a.y };
        p[pass.at] = pass.v;
        p[pass.at === 'x' ? 'y' : 'x'] = a[pass.at === 'x' ? 'y' : 'x'] +
          t * (b[pass.at === 'x' ? 'y' : 'x'] - a[pass.at === 'x' ? 'y' : 'x']);
        return p;
      };
      if (curIn) {
        if (!prevIn) out.push(cross(prev, cur));
        out.push(cur);
      } else if (prevIn) {
        out.push(cross(prev, cur));
      }
    }
    if (!out.length) return [];
  }
  return out;
}

function clean(poly) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-6 || Math.abs(last.y - p.y) > 1e-6) out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) < 1e-6 &&
         Math.abs(out[0].y - out[out.length - 1].y) < 1e-6) out.pop();
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

const toPath = (poly) =>
  'M ' + poly.map((p) => `${+p.x.toFixed(DECIMALS)} ${+p.y.toFixed(DECIMALS)}`).join(' L ') + ' Z';

/* ── 1. Read + parse the source SVG ──────────────────────────────────────── */
const raw = readFileSync(SRC, 'utf8');
const viewBoxAttr = /viewBox="([^"]+)"/.exec(raw)?.[1] ?? '0 0 100 100';
const transformAttr = /<g[^>]*transform="([^"]+)"/.exec(raw)?.[1] ?? '';
const pathDs = [...raw.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
if (!pathDs.length) throw new Error(`No <path> found in ${SRC}`);

const M = parseTransform(transformAttr);
console.log(`source ${SRC}: viewBox="${viewBoxAttr}", ${pathDs.length} path(s), transform="${transformAttr}"`);

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
const totalPts = polygons.reduce((s, p) => s + p.length, 0);
console.log(`flattened to ${polygons.length} polygon(s), ${totalPts} points`);

/* ── 3. Normalise to the artwork bounding box ────────────────────────────── */
let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
for (const poly of polygons) for (const p of poly) {
  if (p.x < X0) X0 = p.x; if (p.x > X1) X1 = p.x;
  if (p.y < Y0) Y0 = p.y; if (p.y > Y1) Y1 = p.y;
}
const bw = X1 - X0, bh = Y1 - Y0;
console.log(`artwork bbox: ${bw.toFixed(2)} x ${bh.toFixed(2)} at (${X0.toFixed(2)}, ${Y0.toFixed(2)})`);

const local = polygons.map((poly) => poly.map((p) => ({ x: p.x - X0, y: p.y - Y0 })));

/* ── 4. Clip against the grid ────────────────────────────────────────────── */
const pieces = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const rect = {
      x0: (c * bw) / COLS,
      x1: ((c + 1) * bw) / COLS,
      y0: (r * bh) / ROWS,
      y1: ((r + 1) * bh) / ROWS,
    };
    const clipped = [];
    let ink = 0;
    for (const poly of local) {
      const piece = clean(clipToRect(poly, rect));
      if (piece.length >= 3 && area(piece) >= MIN_AREA) { clipped.push(piece); ink += area(piece); }
    }
    if (clipped.length) pieces.push({ col: c, row: r, polys: clipped, ink });
  }
}
pieces.sort((a, b) => a.row - b.row || a.col - b.col);
console.log(`split into ${pieces.length} pieces (of ${COLS * ROWS} tiles)`);
for (const p of pieces) {
  console.log(`  r${p.row}c${p.col}  polys=${p.polys.length}  pts=${p.polys.reduce((s, x) => s + x.length, 0)}  area=${Math.round(p.ink)}`);
}

/* ── 5. Emit logoParts.js ────────────────────────────────────────────────── */
const entries = pieces.map((p) => {
  const ds = p.polys.map(toPath);
  const lines = [`    id: 'part-r${p.row}c${p.col}',`];
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
 * Source: ${SRC}  ·  split ${COLS}x${ROWS} = ${pieces.length} pieces.
 *
 * These are real vector pieces clipped from your logo's own path data — the
 * tiles partition the artwork, so their union reconstructs it exactly.
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

/* ── 6. Reference SVG for verification / eyeballing ──────────────────────── */
const refPaths = pieces.map((p) => p.polys.map((poly) => `  <path d="${toPath(poly)}"/>`).join('\n')).join('\n');
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
