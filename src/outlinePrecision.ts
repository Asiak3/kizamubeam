// Detection-only tessellation. Output reconstruction retains the source Béziers.
import { apply, type Mat, type SubPath } from './model';
import { piecesOf, subPiece } from './pathtools';
import { SCALE } from './clip';
import type { NetworkPoint } from './outlineNetwork';

export const OUTLINE_CURVE_ERROR = .001;

export function outlinePolyline(source: SubPath, matrix: Mat): { points: NetworkPoint[]; parameters: number[]; world: SubPath } {
  const world: SubPath = { ...source, nodes: source.nodes.map(n => ({ ...n, ...apply(matrix, n.x, n.y),
    ...(n.cin ? { cin: apply(matrix, n.cin.x, n.cin.y) } : {}),
    ...(n.cout ? { cout: apply(matrix, n.cout.x, n.cout.y) } : {}) })) };
  const points: NetworkPoint[] = [], parameters: number[] = [];
  const push = (p: { x: number; y: number }, u: number) => {
    const q = { X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }, last = points.at(-1);
    if (!last || last.X !== q.X || last.Y !== q.Y) { points.push(q); parameters.push(u); }
    if (points.length > 20000) throw new Error('shape-builder-budget');
  };
  if (world.nodes.length) push(world.nodes[0], 0);
  for (const [index, piece] of piecesOf(world).entries()) {
    const visit = (p: typeof piece, lo: number, hi: number, depth: number) => {
      const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, len2 = dx * dx + dy * dy;
      const distance = (q: { x: number; y: number }) => {
        const u = len2 ? Math.max(0, Math.min(1, ((q.x - p.a.x) * dx + (q.y - p.a.y) * dy) / len2)) : 0;
        return Math.hypot(q.x - p.a.x - u * dx, q.y - p.a.y - u * dy);
      };
      if (!p.curve || (Math.max(distance(p.c1), distance(p.c2)) <= OUTLINE_CURVE_ERROR && len2 <= 1)) {
        push(p.b, index + hi); return;
      }
      if (depth >= 24) throw new Error('shape-builder-budget');
      const mid = (lo + hi) / 2;
      visit(subPiece(p, 0, .5), lo, mid, depth + 1);
      visit(subPiece(p, .5, 1), mid, hi, depth + 1);
    };
    visit(piece, 0, 1, 0);
  }
  if (source.closed && points.length > 1 && points[0].X === points.at(-1)!.X && points[0].Y === points.at(-1)!.Y) {
    points.pop(); parameters.pop();
  }
  return { points, parameters, world };
}
