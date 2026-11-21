// Editable gesture geometry; input samples are retained separately for recognition defaults.
import type { Pt, SubPath } from './model';
import { fitPoints } from './vectorFit';
import { smoothStroke } from './shaper';
import { bezierPt, segments } from './curves';

export interface GestureSpline { path: SubPath; smoothing: number; edited: boolean }
export interface SplineGesture { points: Pt[]; spline?: GestureSpline }
export type SplineHandle = { index: number; which: 'p' | 'cin' | 'cout' };

/** Refit from original samples only when smoothing changes, never during a drag. */
export function gestureSpline(session: SplineGesture, smoothing: number): GestureSpline {
  if (session.spline && session.spline.smoothing === smoothing) return session.spline;
  const path = fitPoints(smoothStroke(session.points, smoothing), false,
    { tolerance: Math.max(0.01, Math.min(10, smoothing / 2)), curves: true, preserveCorners: true });
  // Straight runs also need tangents so they can be bent without adding samples.
  for (const { a, b } of segments(path)) {
    a.cout ??= { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    b.cin ??= { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 };
  }
  return session.spline = { path, smoothing, edited: false };
}

export function hitSpline(path: SubPath, p: Pt, tolerance: number): SplineHandle | null {
  // Anchor priority avoids stealing anchors when a tangent is very short.
  for (const which of ['p', 'cin', 'cout'] as const) {
    let best: SplineHandle | null = null, distance = tolerance;
    path.nodes.forEach((n, index) => {
      const q = which === 'p' ? n : n[which];
      if (!q) return;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= distance) { distance = d; best = { index, which }; }
    });
    if (best) return best;
  }
  return null;
}

export function moveSpline(spline: GestureSpline, handle: SplineHandle, p: Pt): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  const n = spline.path.nodes[handle.index];
  if (!n) return;
  if (handle.which === 'p') {
    const dx = p.x - n.x, dy = p.y - n.y;
    for (const q of [n.cin, n.cout]) if (q) { q.x += dx; q.y += dy; }
    n.x = p.x; n.y = p.y;
  } else n[handle.which] = { ...p };
  spline.edited = true;
}

/** Carry the local Bézier displacement back to the master samples. Keep each
 * sample's residual detail rather than replacing it with a flattened curve. */
export function deformGesture(session: SplineGesture, handle: SplineHandle, p: Pt, smoothing: number): void {
  const spline = gestureSpline(session, smoothing);
  const before = segments(structuredClone(spline.path));
  moveSpline(spline, handle, p);
  const after = segments(spline.path);
  for (const sample of session.points) {
    let best = Infinity, index = 0, parameter = 0;
    for (let i = 0; i < before.length; i++) {
      const s = before[i];
      const distance = (t: number) => {
        const q = bezierPt(s.a, s.c1, s.c2, s.b, t);
        return (q.x - sample.x) ** 2 + (q.y - sample.y) ** 2;
      };
      let at = 0, error = Infinity;
      for (let j = 0; j <= 24; j++) {
        const t = j / 24, d = distance(t);
        if (d < error) { error = d; at = t; }
      }
      let lo = Math.max(0, at - 1 / 24), hi = Math.min(1, at + 1 / 24);
      for (let j = 0; j < 12; j++) {
        const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
        if (distance(a) < distance(b)) hi = b; else lo = a;
      }
      const t = (lo + hi) / 2, d = distance(t);
      if (d < error) { error = d; at = t; }
      if (error < best) { best = error; index = i; parameter = at; }
    }
    const a = before[index], b = after[index];
    if (!a || !b) continue;
    const old = bezierPt(a.a, a.c1, a.c2, a.b, parameter);
    const next = bezierPt(b.a, b.c1, b.c2, b.b, parameter);
    sample.x += next.x - old.x; sample.y += next.y - old.y;
  }
}

/** Adaptive de Casteljau subdivision for polygonal boolean operations, not UI handles. */
export function splineSamples(path: SubPath, tolerance = 0.025): Pt[] {
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Invalid spline tolerance.');
  if (!path.nodes.length) return [];
  const out: Pt[] = [{ x: path.nodes[0].x, y: path.nodes[0].y }];
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y, den = dx * dx + dy * dy;
    const t = den ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const flatten = (a: Pt, c: Pt, d: Pt, b: Pt, depth: number) => {
    if (out.length >= 16384) throw new Error('Spline sampling limit exceeded.');
    if (depth >= 16 || Math.max(distance(c, a, b), distance(d, a, b)) <= tolerance) {
      out.push({ x: b.x, y: b.y }); return;
    }
    const ac = mid(a, c), cd = mid(c, d), db = mid(d, b), left = mid(ac, cd), right = mid(cd, db), center = mid(left, right);
    flatten(a, ac, left, center, depth + 1); flatten(center, right, db, b, depth + 1);
  };
  for (const s of segments(path)) flatten(s.a, s.c1, s.c2, s.b, 0);
  return out;
}
