// Bounded world-mm refitter; no external implementation is copied.
import type { Node, Pt, SubPath } from './model';
import { segments } from './curves';

export const MAX_VECTOR_SAMPLES = 16384;
const MAX_WORK = 2000000;
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
type Cubic = [Pt, Pt, Pt, Pt];
function split(c: Cubic, t: number): [Cubic, Cubic] {
  const a = mix(c[0], c[1], t), b = mix(c[1], c[2], t), d = mix(c[2], c[3], t);
  const e = mix(a, b, t), f = mix(b, d, t), g = mix(e, f, t);
  return [[c[0], a, e, g], [g, f, d, c[3]]];
}
function portion(c: Cubic, a: number, b: number): Cubic {
  const left = b < 1 ? split(c, b)[0] : c;
  return a > 0 ? split(left, a / b)[1] : left;
}
function lineDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
  return dist(p, mix(a, b, den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0));
}
function validate(points: Pt[], tolerance: number) {
  if (!Number.isFinite(tolerance) || tolerance < 0.001 || tolerance > 100)
    throw new Error('Tolerance must be between 0.001 and 100 mm.');
  if (points.length > MAX_VECTOR_SAMPLES) throw new Error('Too many points; split the path first.');
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9))
    throw new Error('Path contains invalid or excessive coordinates.');
}

export interface FitOptions { tolerance: number; curves: boolean; preserveCorners: boolean }

/** Fits each chord-parameterized run. Acceptance uses a Bernstein convex-hull
 * bound against every source polyline interval, not just distance at vertices.
 * Both complete paths stay within tolerance under the same parameterization. */
export function fitPoints(input: Pt[], closed: boolean, options: FitOptions, forced = new Set<number>()): SubPath {
  validate(input, options.tolerance);
  let work = 0;
  const points: Pt[] = [];
  const breaks = new Set<number>();
  input.forEach((p, i) => {
    if (!points.length || dist(points[points.length - 1], p) > 1e-10) points.push({ x: p.x, y: p.y });
    if (forced.has(i)) breaks.add(points.length - 1);
  });
  if (points.length < 2) return { nodes: points, closed: false };
  if (closed && dist(points[0], points[points.length - 1]) > 1e-10) points.push({ ...points[0] });
  if (options.preserveCorners) {
    for (let i = 1; i + 1 < points.length; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const cosine = ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) / (dist(a, b) * dist(b, c));
      if (cosine < Math.SQRT1_2) breaks.add(i);
    }
  }
  // Closed contours keep at least three distinct anchors.
  if (closed && points.length >= 4) {
    breaks.add(Math.floor((points.length - 1) / 3));
    breaks.add(Math.floor(2 * (points.length - 1) / 3));
  }
  const nodes: Node[] = [{ ...points[0] }];
  const fit = (lo: number, hi: number, depth: number) => {
    if (depth > 24) throw new Error('Fit subdivision limit exceeded; lower the path complexity.');
    const a = points[lo], b = points[hi];
    if (hi === lo + 1) { nodes.push({ ...b }); return; }
    const ts = [0];
    let total = 0;
    for (let i = lo + 1; i <= hi; i++) { total += dist(points[i - 1], points[i]); ts.push(total); }
    for (let i = 1; i < ts.length; i++) ts[i] /= total;
    let c: Cubic = [a, mix(a, b, 1 / 3), mix(a, b, 2 / 3), b];
    if (options.curves) {
      let aa = 0, ab = 0, bb = 0, ax = 0, ay = 0, bx = 0, by = 0;
      for (let j = 1; j + 1 < ts.length; j++) {
        const t = ts[j], u = 1 - t, v = 3 * u * u * t, w = 3 * u * t * t;
        const p = points[lo + j], x = p.x - u ** 3 * a.x - t ** 3 * b.x, y = p.y - u ** 3 * a.y - t ** 3 * b.y;
        aa += v * v; ab += v * w; bb += w * w; ax += v * x; ay += v * y; bx += w * x; by += w * y;
      }
      const det = aa * bb - ab * ab;
      if (det > 1e-12) c = [a, { x: (ax * bb - bx * ab) / det, y: (ay * bb - by * ab) / det },
        { x: (bx * aa - ax * ab) / det, y: (by * aa - ay * ab) / det }, b];
    }
    let worst = 0, at = Math.floor((lo + hi) / 2);
    for (let j = 0; j + 1 < ts.length; j++) {
      if (++work > MAX_WORK) throw new Error('Fit work limit exceeded; split the path first.');
      const part = portion(c, ts[j], ts[j + 1]), p = points[lo + j], q = points[lo + j + 1];
      const error = Math.max(...part.map((v, k) => dist(v, mix(p, q, k / 3))));
      if (error > worst) { worst = error; at = Math.max(lo + 1, Math.min(hi - 1, lo + j + 1)); }
    }
    if (worst <= options.tolerance) {
      const last = nodes[nodes.length - 1];
      if (options.curves) last.cout = { ...c[1] };
      nodes.push(options.curves ? { ...b, cin: { ...c[2] } } : { ...b });
    } else { fit(lo, at, depth + 1); fit(at, hi, depth + 1); }
  };
  const stops = [...breaks, points.length - 1].filter((i) => i > 0 && i < points.length).sort((a, b) => a - b);
  let from = 0;
  for (const to of stops) { if (to > from) fit(from, to, 0); from = to; }
  if (closed) { const last = nodes.pop()!; if (last.cin) nodes[0].cin = last.cin; }
  return { nodes, closed };
}

/** Reserve 1/4 tolerance for finite-chord flattening and 3/4 for fitting. */
export function refitSubpath(source: SubPath, options: FitOptions): SubPath {
  validate(source.nodes.flatMap((n) => [n, ...(n.cin ? [n.cin] : []), ...(n.cout ? [n.cout] : [])]), options.tolerance);
  if (source.nodes.length < 2) return structuredClone(source);
  const pts: Pt[] = [{ x: source.nodes[0].x, y: source.nodes[0].y }], forced = new Set<number>();
  let work = 0;
  const flatten = (c: Cubic, depth: number) => {
    if (++work > MAX_WORK || pts.length >= MAX_VECTOR_SAMPLES) throw new Error('Path sampling limit exceeded.');
    if (Math.max(lineDistance(c[1], c[0], c[3]), lineDistance(c[2], c[0], c[3])) <= options.tolerance / 4) {
      pts.push({ ...c[3] }); return;
    }
    if (depth >= 24) throw new Error('Curve sampling limit exceeded.');
    const [a, b] = split(c, 0.5); flatten(a, depth + 1); flatten(b, depth + 1);
  };
  for (const sg of segments(source)) {
    if (sg.curve) flatten([sg.a, sg.c1, sg.c2, sg.b], 0);
    else pts.push({ x: sg.b.x, y: sg.b.y });
  }
  const out = fitPoints(pts, source.closed, { ...options, tolerance: options.tolerance * 0.75 }, forced);
  // Do not increase anchor count for an already sparse cubic path.
  if (options.curves && out.nodes.length > source.nodes.length) return structuredClone(source);
  if (source.start !== undefined) out.start = source.start;
  return out;
}
