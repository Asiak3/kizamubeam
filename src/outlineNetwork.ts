// Bounded faces of a planar line network. No convex hull or implicit closing chord.
import { flattenSub, Paths, SCALE, FLATTEN_TOL } from './clip';
import { Obj, leaves } from './model';
import { shapeSubs } from './geom';
import ClipperLib from 'clipper-lib';

// Default endpoint tolerance matches the existing curve approximation; callers
// may explicitly increase it in the preview, never in the source document.
export const OUTLINE_JOIN_TOL = FLATTEN_TOL;
export type NetworkPoint = { X: number; Y: number };
type Point = NetworkPoint;
export interface NetworkPath { points: Point[]; closed: boolean }
export interface OutlineNetwork { faces: Paths; looseEnds: Point[] }
type Segment = { a: Point; b: Point; cuts: number[]; path: number };
const cross = (x: number, y: number, u: number, v: number) => x * v - y * u;

export function outlineNetwork(objects: Obj[], tolerance = OUTLINE_JOIN_TOL): OutlineNetwork {
  const paths: NetworkPath[] = [];
  for (const [leaf, matrix] of leaves(objects)) {
    if (leaf.shape.kind === 'image' || leaf.shape.kind === 'text') continue;
    for (const sp of shapeSubs(leaf.shape)) paths.push({ points: flattenSub(sp, matrix), closed: sp.closed });
  }
  return outlineNetworkPaths(paths, tolerance);
}

export function outlineNetworkPaths(paths: NetworkPath[], tolerance = OUTLINE_JOIN_TOL): OutlineNetwork {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) throw new Error('outline-tolerance');
  const segments: Segment[] = [];
  const endpoints: { p: Point; path: number }[] = [];
  paths.forEach((input, id) => {
        const path = input.points, closed = input.closed;
        if (!closed && path.length) endpoints.push({ p: path[0], path: id }, { p: path[path.length - 1], path: id });
        for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
          const a = path[i], b = path[(i + 1) % path.length];
          if (a.X !== b.X || a.Y !== b.Y) segments.push({ a, b, cuts: [0, 1], path: id });
        }
  });
  if (segments.length > 20000) throw new Error('shape-builder-budget');
  const tol = tolerance * SCALE;
  // Project endpoints onto nearby segments before constructing intersections.
  // Coordinates are copies; source nodes and handles never move.
  const moved = new Map<string, Point>();
  let work = 0;
  const tick = () => { if (++work > 8000000) throw new Error('shape-builder-budget'); };
  for (const endpoint of endpoints) {
    const p = endpoint.p;
    const key = `${p.X},${p.Y}`;
    if (moved.has(key)) continue;
    let best = tol * tol, hit = p;
    for (const other of endpoints) {
      tick();
      if (other.path !== endpoint.path || other.p === p) continue;
      const q = other.p;
      if (q.X > p.X || (q.X === p.X && q.Y > p.Y)) continue;
      const d = (p.X - q.X) ** 2 + (p.Y - q.Y) ** 2;
      if (d < best) { best = d; hit = q; }
    }
    for (const s of segments) {
      tick();
      if (s.path === endpoint.path) continue;
      if (p.X < Math.min(s.a.X, s.b.X) - tol || p.X > Math.max(s.a.X, s.b.X) + tol ||
        p.Y < Math.min(s.a.Y, s.b.Y) - tol || p.Y > Math.max(s.a.Y, s.b.Y) + tol) continue;
      if ((p.X === s.a.X && p.Y === s.a.Y) || (p.X === s.b.X && p.Y === s.b.Y)) continue;
      const dx = s.b.X - s.a.X, dy = s.b.Y - s.a.Y;
      const t = Math.max(0, Math.min(1, ((p.X - s.a.X) * dx + (p.Y - s.a.Y) * dy) / (dx * dx + dy * dy)));
      const q = { X: Math.round(s.a.X + t * dx), Y: Math.round(s.a.Y + t * dy) };
      if ((t === 0 || t === 1) && (q.X > p.X || (q.X === p.X && q.Y > p.Y))) continue;
      const d = (p.X - q.X) ** 2 + (p.Y - q.Y) ** 2;
      if (d < best) { best = d; hit = q; }
    }
    moved.set(key, hit);
  }
  for (const s of segments) {
    s.a = moved.get(`${s.a.X},${s.a.Y}`) ?? s.a; s.b = moved.get(`${s.b.X},${s.b.Y}`) ?? s.b;
  }
  const sorted = [...segments].sort((a, b) => Math.min(a.a.X, a.b.X) - Math.min(b.a.X, b.b.X));
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i], ax = a.b.X - a.a.X, ay = a.b.Y - a.a.Y;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (Math.min(b.a.X, b.b.X) > Math.max(a.a.X, a.b.X) + 1) break;
      tick();
      if (Math.min(b.a.Y, b.b.Y) > Math.max(a.a.Y, a.b.Y) + 1 || Math.max(b.a.Y, b.b.Y) < Math.min(a.a.Y, a.b.Y) - 1) continue;
      for (const [s, other] of [[a, b], [b, a]]) {
        const dx = s.b.X - s.a.X, dy = s.b.Y - s.a.Y, len = dx * dx + dy * dy;
        if (!len) continue;
        for (const p of [other.a, other.b]) {
          const t = ((p.X - s.a.X) * dx + (p.Y - s.a.Y) * dy) / len;
          if (t > 0 && t < 1 && Math.hypot(p.X - s.a.X - t * dx, p.Y - s.a.Y - t * dy) < 0.75) s.cuts.push(t);
        }
      }
      const bx = b.b.X - b.a.X, by = b.b.Y - b.a.Y, qx = b.a.X - a.a.X, qy = b.a.Y - a.a.Y;
      const den = cross(ax, ay, bx, by);
      if (den !== 0) {
        const t = cross(qx, qy, bx, by) / den, u = cross(qx, qy, ax, ay) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { a.cuts.push(t); b.cuts.push(u); }
      } else if (cross(qx, qy, ax, ay) === 0) {
        for (const [s, other] of [[a, b], [b, a]]) {
          const dx = s.b.X - s.a.X, dy = s.b.Y - s.a.Y, len = dx * dx + dy * dy;
          if (!len) continue;
          for (const p of [other.a, other.b]) {
            const t = ((p.X - s.a.X) * dx + (p.Y - s.a.Y) * dy) / len;
            if (t > 0 && t < 1) s.cuts.push(t);
          }
        }
      }
    }
  }
  type Vertex = { p: Point; outgoing: number[] };
  const vertices: Vertex[] = [], ids = new Map<string, number>();
  const vertex = (p: Point) => {
    // Two computations of one intersection may round to neighbouring grid cells.
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const found = ids.get(`${p.X + dx},${p.Y + dy}`);
      if (found !== undefined) return found;
    }
    const key = `${p.X},${p.Y}`;
    let id = ids.get(key);
    if (id === undefined) { id = vertices.length; ids.set(key, id); vertices.push({ p, outgoing: [] }); }
    return id;
  };
  const edges: { from: number; to: number; used: boolean }[] = [], unique = new Map<string, number>();
  for (const s of segments) {
    s.cuts.sort((a, b) => a - b);
    const points = s.cuts.map(t => vertex({ X: Math.round(s.a.X + (s.b.X - s.a.X) * t), Y: Math.round(s.a.Y + (s.b.Y - s.a.Y) * t) }));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a === b) continue;
      if (unique.has(key)) continue;
      unique.set(key, edges.length);
      vertices[a].outgoing.push(edges.length); edges.push({ from: a, to: b, used: false });
      vertices[b].outgoing.push(edges.length); edges.push({ from: b, to: a, used: false });
      if (edges.length > 100000) throw new Error('shape-builder-budget');
    }
  }
  for (const v of vertices) v.outgoing.sort((a, b) => {
    const p = vertices[edges[a].to].p, q = vertices[edges[b].to].p;
    return Math.atan2(p.Y - v.p.Y, p.X - v.p.X) - Math.atan2(q.Y - v.p.Y, q.X - v.p.X);
  });
  const next = new Int32Array(edges.length);
  for (const v of vertices) v.outgoing.forEach((edge, i) => {
    next[edge] = v.outgoing[(i + v.outgoing.length - 1) % v.outgoing.length];
  });
  const faces: Paths = [];
  for (let first = 0; first < edges.length; first++) {
    if (edges[first].used) continue;
    const path: Point[] = [];
    let at = first;
    do {
      const e = edges[at];
      if (e.used) throw new Error('outline-network');
      e.used = true; path.push(vertices[e.from].p);
      at = next[at ^ 1];
    } while (at !== first);
    if (ClipperLib.Clipper.Area(path) > 0) {
      faces.push(path);
      if (faces.length > 2048) throw new Error('shape-builder-budget');
    }
  }
  return { faces, looseEnds: vertices.filter(v => v.outgoing.length === 1).map(v => v.p) };
}
