// Bounded faces of a planar line network. No convex hull or implicit closing chord.
import { flattenSub, Paths, SCALE, FLATTEN_TOL } from './clip';
import { Obj, leaves, type SubPath } from './model';
import { shapeSubs } from './geom';
import { segments as curveSegments } from './curves';
import ClipperLib from 'clipper-lib';
import { outlinePolyline } from './outlinePrecision';

// Default endpoint tolerance matches the existing curve approximation; callers
// may explicitly increase it in the preview, never in the source document.
export const OUTLINE_JOIN_TOL = FLATTEN_TOL;
export type NetworkPoint = { X: number; Y: number };
type Point = NetworkPoint;
export interface NetworkPath { points: Point[]; closed: boolean; parameters: number[]; period: number; objectId: number; sub: number; world?: SubPath; connection?: boolean }
export interface NetworkSpan { path: number; u0: number; u1: number }
export interface NetworkEdge { a: Point; b: Point; sources: NetworkSpan[] }
export interface OutlineNetwork { faces: Paths; looseEnds: Point[]; paths: NetworkPath[]; edges: NetworkEdge[]; tolerance?: number; ambiguousJoins?: Point[] }
type Segment = { a: Point; b: Point; cuts: number[]; path: number; u0: number; u1: number };
const cross = (x: number, y: number, u: number, v: number) => x * v - y * u;

export function outlineNetwork(objects: Obj[], tolerance = OUTLINE_JOIN_TOL, precise = false): OutlineNetwork {
  const paths: NetworkPath[] = [];
  for (const [leaf, matrix] of leaves(objects)) {
    if (leaf.shape.kind === 'image' || leaf.shape.kind === 'text') continue;
    shapeSubs(leaf.shape).forEach((sp, sub) => {
      if (precise) {
        const flat = outlinePolyline(sp, matrix);
        paths.push({ ...flat, closed: sp.closed, period: curveSegments(sp).length, objectId: leaf.id, sub });
        return;
      }
      const parameters: number[] = [];
      paths.push({ points: flattenSub(sp, matrix, parameters), closed: sp.closed, parameters,
        period: curveSegments(sp).length, objectId: leaf.id, sub });
    });
  }
  return outlineNetworkPaths(paths, tolerance, precise);
}

export function outlineNetworkPaths(inputPaths: NetworkPath[], tolerance = OUTLINE_JOIN_TOL, preserveEndpoints = false): OutlineNetwork {
  const paths = [...inputPaths];
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) throw new Error('outline-tolerance');
  const segments: Segment[] = [];
  const endpoints: { p: Point; path: number }[] = [];
  paths.forEach((input, id) => {
        const path = input.points, closed = input.closed;
        if (!closed && path.length) endpoints.push({ p: path[0], path: id }, { p: path[path.length - 1], path: id });
        for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
          const a = path[i], b = path[(i + 1) % path.length];
          if (a.X !== b.X || a.Y !== b.Y) segments.push({ a, b, cuts: [0, 1], path: id,
            u0: input.parameters[i], u1: i + 1 === path.length ? input.period : input.parameters[i + 1] });
        }
  });
  if (segments.length > 20000) throw new Error('shape-builder-budget');
  const tol = tolerance * SCALE;
  // Project endpoints onto nearby segments before constructing intersections.
  // Coordinates are copies; source nodes and handles never move.
  const moved = new Map<string, Point>();
  const ambiguousJoins: Point[] = [];
  let work = 0;
  const tick = () => { if (++work > 8000000) throw new Error('shape-builder-budget'); };
  for (const endpoint of endpoints) {
    const p = endpoint.p;
    const key = `${p.X},${p.Y}`;
    if (moved.has(key)) continue;
    let best = tol * tol, hit = p, ambiguous = false, hasHit = false;
    const consider = (q: Point, d: number) => {
      if (d < best || (preserveEndpoints && !hasHit && d === best)) {
        best = d; hit = q; ambiguous = false; hasHit = true;
      } else if (preserveEndpoints && hasHit && Math.abs(d-best)<1e-8 && (q.X!==hit.X||q.Y!==hit.Y)) ambiguous = true;
    };
    for (const other of endpoints) {
      tick();
      if (other.path !== endpoint.path || other.p === p) continue;
      const q = other.p;
      if (!preserveEndpoints && (q.X > p.X || (q.X === p.X && q.Y > p.Y))) continue;
      const d = (p.X - q.X) ** 2 + (p.Y - q.Y) ** 2;
      consider(q,d);
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
      if (!preserveEndpoints && (t === 0 || t === 1) && (q.X > p.X || (q.X === p.X && q.Y > p.Y))) continue;
      const d = (p.X - q.X) ** 2 + (p.Y - q.Y) ** 2;
      consider(q,d);
    }
    if(ambiguous){ambiguousJoins.push(p);hit=p;}
    moved.set(key, hit);
  }
  if (preserveEndpoints) {
    // Keep every source span where it is. Tolerance adds an explicit short
    // connector instead of rotating/stretching the source's final segment.
    const seen = new Set<string>();
    for (const endpoint of endpoints) {
      const a = endpoint.p, b = moved.get(`${a.X},${a.Y}`)!;
      if (a.X === b.X && a.Y === b.Y) continue;
      const key = [`${a.X},${a.Y}`, `${b.X},${b.Y}`].sort().join(':');
      if (seen.has(key)) continue; seen.add(key);
      const path = paths.length;
      paths.push({ points: [a, b], parameters: [0, 1], period: 1, closed: false, objectId: -1, sub: -1, connection: true,
        world: { closed: false, nodes: [{ x: a.X / SCALE, y: a.Y / SCALE }, { x: b.X / SCALE, y: b.Y / SCALE }] } });
      segments.push({ a, b, cuts: [0, 1], path, u0: 0, u1: 1 });
    }
  } else for (const s of segments) {
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
  const edges: { from: number; to: number; used: boolean; sources: NetworkSpan[] }[] = [], unique = new Map<string, number>();
  for (const s of segments) {
    s.cuts.sort((a, b) => a - b);
    const points = s.cuts.map(t => vertex({ X: Math.round(s.a.X + (s.b.X - s.a.X) * t), Y: Math.round(s.a.Y + (s.b.Y - s.a.Y) * t) }));
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (a === b) continue;
      const span: NetworkSpan = { path: s.path, u0: s.u0 + (s.u1 - s.u0) * s.cuts[i - 1], u1: s.u0 + (s.u1 - s.u0) * s.cuts[i] };
      const existing = unique.get(key);
      if (existing !== undefined) {
        const forward = edges[existing].from === a;
        const ref = forward ? span : { path: span.path, u0: span.u1, u1: span.u0 };
        if (!edges[existing].sources.some(e => e.path === ref.path && Math.abs(e.u0 - ref.u0) < 1e-10 && Math.abs(e.u1 - ref.u1) < 1e-10)) {
          edges[existing].sources.push(ref);
          edges[existing ^ 1].sources.push({ path: ref.path, u0: ref.u1, u1: ref.u0 });
        }
        continue;
      }
      unique.set(key, edges.length);
      vertices[a].outgoing.push(edges.length); edges.push({ from: a, to: b, used: false, sources: [span] });
      vertices[b].outgoing.push(edges.length); edges.push({ from: b, to: a, used: false, sources: [{ path: span.path, u0: span.u1, u1: span.u0 }] });
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
  return { faces, looseEnds: vertices.filter(v => v.outgoing.length === 1).map(v => v.p), paths, tolerance, ambiguousJoins,
    edges: edges.flatMap((e, i) => i % 2 ? [] : [{ a: vertices[e.from].p, b: vertices[e.to].p, sources: e.sources }]) };
}
