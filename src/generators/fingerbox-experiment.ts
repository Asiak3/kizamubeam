// Experiment: Box mit ungerader Zinkenverteilung und optionalem Deckel.
// Konturen mit optionalem Steckspiel; Schnittfuge und Trennwände werden separat ergänzt.
import type { Pt } from '../model';
import type { GenPart } from './types';

export interface FingerboxParams {
  width: number; depth: number; height: number; thickness: number; finger: number; top?: 'open' | 'closed'; clearance?: number; jointLayout?: string;
}

type Point = { x: number; y: number };
type Run = { from: number; to: number; offset: number };

/** Ungerade Zahl gleicher Abschnitte, mindestens drei. */
export function fingerboxSegments(length: number, finger: number): number {
  if (!Number.isFinite(length) || !Number.isFinite(finger) || length <= 0 || finger <= 0) throw new Error('Länge und Zinkenbreite müssen positiv sein.');
  const n = Math.floor(length / finger);
  const count = Math.max(3, n % 2 ? n : n - 1);
  if (count > 5001) throw new Error('Zu viele Zinken für diese Kante.');
  return count;
}

/** Like the original box generator: at least one odd field between the corners. */
export function horizontalSegments(length: number, finger: number): number {
  if (!Number.isFinite(length) || !Number.isFinite(finger) || length <= 0 || finger <= 0) throw new Error('Länge und Zinkenbreite müssen positiv sein.');
  const n = Math.floor(length / finger);
  const count = Math.max(1, n % 2 ? n : n - 1);
  if (count > 5001) throw new Error('Zu viele Zinken für diese Kante.');
  return count;
}

function runs(length: number, finger: number, thickness: number, firstActive: boolean, legacy = false): Run[] {
  const n = legacy ? fingerboxSegments(length, finger) : horizontalSegments(length, finger), d = length / n;
  return Array.from({ length: n }, (_, i) => ({ from: i * d, to: (i + 1) * d, offset: (i % 2 === 0) === firstActive ? thickness : 0 }));
}
/** Bottom corner includes base thickness; closed boxes also include lid thickness at the top. */
function verticalRuns(height: number, finger: number, thickness: number, closed: boolean, firstActive: boolean): Run[] {
  const useful = height - thickness * (closed ? 2 : 1);
  const n = fingerboxSegments(useful, finger), d = useful / n;
  return Array.from({ length: n }, (_, i) => ({
    // A recessed side wall meets the horizontal edge at the inner face of
    // the base/lid; extending to the outside would retrace the same line.
    from: i === 0 ? (firstActive ? 0 : thickness) : thickness + i * d,
    to: i === n - 1 ? (closed && !firstActive ? height - thickness : height) : thickness + (i + 1) * d,
    offset: (i % 2 === 0) === firstActive ? thickness : 0,
  }));
}
function edge(target: Point[], rs: Run[], map: (s: number, offset: number) => Point, reverse = false, clearance = 0, fullOffset = 0) {
  const adjusted = rs.map((r) => ({ ...r }));
  for (let i = 0; i + 1 < adjusted.length; i++) {
    const shift = adjusted[i].offset === fullOffset ? -clearance / 2 : clearance / 2;
    adjusted[i].to += shift;
    adjusted[i + 1].from += shift;
  }
  if (adjusted.some((r) => r.to - r.from <= 1e-7)) throw new Error('Das Steckspiel ist für einen Zinkenabschnitt zu groß.');
  const points = adjusted.flatMap((r) => [map(r.from, r.offset), map(r.to, r.offset)]);
  target.push(...(reverse ? points.reverse() : points));
}
function clean(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 1e-7) out.push(p);
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-7) out.pop();
  return out;
}

/** GenPart-Konturen: Mittelpunkt im Ursprung, y nach unten. Außenmaße in mm. */
export function fingerboxParts(p: FingerboxParams): GenPart[] {
  const { width: W, depth: D, height: H, thickness: t, finger } = p;
  if (![W, D, H, t, finger].every((x) => Number.isFinite(x) && x > 0) || W <= 2 * t || D <= 2 * t || H <= 2 * t) {
    throw new Error('Ungültige Maße: positive Werte und jede Außenabmessung größer als die doppelte Materialdicke erforderlich.');
  }
  const clearance = p.clearance ?? 0;
  if (!Number.isFinite(clearance)) throw new Error('Ungültiges Steckspiel.');
  const legacy = p.jointLayout === 'legacy';
  const wx = runs(W - 2 * t, finger, t, !legacy, legacy);
  const wy = runs(D - 2 * t, finger, t, !legacy, legacy);
  const verticalFront = legacy ? runs(H, finger, t, true, true) : verticalRuns(H, finger, t, p.top === 'closed', true);
  const verticalSide = legacy ? runs(H, finger, t, false, true) : verticalRuns(H, finger, t, p.top === 'closed', false);
  const bottom: Point[] = [];
  edge(bottom, wx, (s, o) => ({ x: t + s, y: t - o }), false, clearance, t);
  if (!legacy) bottom.push({ x: W - t, y: t });
  edge(bottom, wy, (s, o) => ({ x: W - t + o, y: t + s }), false, clearance, t);
  if (!legacy) bottom.push({ x: W - t, y: D - t });
  edge(bottom, wx, (s, o) => ({ x: t + s, y: D - t + o }), true, clearance, t);
  if (!legacy) bottom.push({ x: t, y: D - t });
  edge(bottom, wy, (s, o) => ({ x: t - o, y: t + s }), true, clearance, t);
  if (!legacy) bottom.push({ x: t, y: t });
  function wall(length: number, horizontal: Run[], vertical: Run[]): Point[] {
    const points: Point[] = [];
    edge(points, horizontal, (s, o) => ({ x: t + s, y: o }), false, clearance, 0);
    const cornerFull = !legacy && vertical[0].offset === t;
    if (cornerFull) points.push({ x: length - t, y: 0 });
    edge(points, vertical, (s, o) => ({ x: length - t + o, y: s }), false, clearance, t);
    if (p.top === 'closed') {
      if (cornerFull) points.push({ x: length - t, y: H });
      edge(points, horizontal, (s, o) => ({ x: t + s, y: H - o }), true, clearance, 0);
      if (cornerFull) points.push({ x: t, y: H });
    } else points.push({ x: t, y: H });
    edge(points, vertical, (s, o) => ({ x: t - o, y: s }), true, clearance, t);
    if (cornerFull) points.push({ x: t, y: 0 });
    return points;
  }
  const front = wall(W, wx, verticalFront), side = wall(D, wy, verticalSide);
  const gap = 10;
  const part = (key: string, points: Point[], a: number, b: number, at: Pt, wallPart: boolean): GenPart => ({
    key, at,
    subs: [{ closed: true, nodes: clean(points).map((q) => ({ x: q.x - a / 2, y: wallPart ? b / 2 - q.y : q.y - b / 2 })) }],
  });
  // Boxes created before the layout fix keep their original open-box arrangement so existing projects do not move.
  if (legacy && p.top !== 'closed') return [
    part('bottom', bottom, W, D, { x: W / 2, y: D / 2 }, false),
    part('front', front, W, H, { x: W + gap + W / 2, y: H / 2 }, true),
    part('back', front, W, H, { x: 2 * (W + gap) + W / 2, y: H / 2 }, true),
    part('left', side, D, H, { x: D / 2, y: D + gap + H / 2 }, true),
    part('right', side, D, H, { x: D + gap + D / 2, y: D + gap + H / 2 }, true),
  ];
  type Panel = { key: string; points: Point[]; a: number; b: number; wall: boolean };
  const rows: Panel[][] = [
    [{ key: 'bottom', points: bottom, a: W, b: D, wall: false },
     { key: 'front', points: front, a: W, b: H, wall: true },
     { key: 'back', points: front, a: W, b: H, wall: true }],
    [...(p.top === 'closed' ? [{ key: 'top', points: bottom, a: W, b: D, wall: false }] : []),
     { key: 'left', points: side, a: D, b: H, wall: true },
     { key: 'right', points: side, a: D, b: H, wall: true }],
  ];
  const heights = rows.map((row) => Math.max(...row.map((panel) => panel.b)));
  const totalHeight = heights[0] + gap + heights[1];
  return rows.flatMap((row, ri) => {
    const rowWidth = row.reduce((sum, panel) => sum + panel.a, 0) + gap * (row.length - 1);
    let x = -rowWidth / 2;
    const y = -totalHeight / 2 + (ri === 0 ? 0 : heights[0] + gap);
    return row.map((panel) => {
      const result = part(panel.key, panel.points, panel.a, panel.b, { x: x + panel.a / 2, y: y + panel.b / 2 }, panel.wall);
      x += panel.a + gap;
      return result;
    });
  });
}