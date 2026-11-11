// The offset picker uses exactly the exterior tool's geometry, with source spans
// retained separately. Detecting a face never assigns a duplicated edge an owner.
import { outlineNetwork, type NetworkPoint, type NetworkSpan } from './outlineNetwork';
import { outlinePlan } from './outline';
import { IDENT, type Obj } from './model';
import { SCALE } from './clip';
import type { OffsetContours, OffsetSource, OffsetContour, Member, OffsetRange } from './contourOffset';
import { t } from './i18n';

const key = (p: NetworkPoint) => `${p.X}:${p.Y}`;
const unavailable = () => t('Kontur erkannt, aber ihre Kanten sind nicht eindeutig den Quellabschnitten zuzuordnen.');
const traceError = (reason: string) => Object.assign(new Error(unavailable()), { cause: reason });
export function mergedRanges(ranges: OffsetRange[]): OffsetRange[] {
  const sorted = ranges.map(r => ({ u0: Math.min(r.u0, r.u1), u1: Math.max(r.u0, r.u1) })).sort((a, b) => a.u0 - b.u0);
  const out: OffsetRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.u0 <= last.u1 + 1e-7) last.u1 = Math.max(last.u1, r.u1);
    else out.push({ ...r });
  }
  return out;
}

export function networkOffsetContours(sources: OffsetSource[], tolerance: number): OffsetContours {
  const roots = new Map<number, Obj[]>();
  for (const s of sources) {
    const id = s.root ?? s.id;
    if (!roots.has(id)) roots.set(id, []);
    roots.get(id)!.push({ id: s.id, m: s.m, layer: 0, shape: { kind: 'path', subs: s.base } });
  }
  const objects: Obj[] = [...roots].map(([id, children]) => children.length === 1 ? children[0] :
    { id, m: [...IDENT], layer: 0, shape: { kind: 'group', children } });
  const network = outlineNetwork(objects, tolerance), plan = outlinePlan(objects, tolerance, true, network);
  const owner = new Map(sources.map((s, i) => [s.id, i]));
  const vertices = new Map<string, NetworkPoint>(), outgoing = new Map<string, { edge: number; forward: boolean; to: NetworkPoint }[]>();
  network.edges.forEach((e, edge) => {
    for (const [from, to, forward] of [[e.a, e.b, true], [e.b, e.a, false]] as const) {
      const k = key(from); vertices.set(k, from);
      if (!outgoing.has(k)) outgoing.set(k, []);
      outgoing.get(k)!.push({ edge, forward, to });
    }
  });
  const vertex = (p: NetworkPoint) => {
    const exact = vertices.get(key(p)); if (exact) return exact;
    const found: NetworkPoint[] = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      const q = vertices.get(`${p.X + x}:${p.Y + y}`); if (q) found.push(q);
    }
    if (found.length !== 1) throw traceError('ambiguous-or-missing-vertex');
    return found[0];
  };
  let work = 0;
  const trace = (polygon: NetworkPoint[]): { points: NetworkPoint[]; spans: NetworkSpan[]; edges: number[] } => {
    const points: NetworkPoint[] = [], spans: NetworkSpan[] = [], edges: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = vertex(polygon[i]), b = vertex(polygon[(i + 1) % polygon.length]);
      const dx = b.X - a.X, dy = b.Y - a.Y, len = Math.hypot(dx, dy);
      // Quantized near-collinear spurs can look like a second first step, even
      // though they do not reach this polygon endpoint. Count COMPLETE monotone
      // routes, never choose an arbitrary nearest edge or duplicated owner.
      type Step = { edge: number; forward: boolean; to: NetworkPoint };
      const graph = new Map<string, { point: NetworkPoint; steps: Step[] }>();
      const pending = [a];
      while (pending.length) {
        const point = pending.pop()!, k = key(point);
        if (graph.has(k)) continue;
        if (++work > 200000) throw traceError('trace-budget');
        const steps = k === key(b) ? [] : (outgoing.get(k) ?? []).filter(e => {
          const advance = (e.to.X - point.X) * dx + (e.to.Y - point.Y) * dy;
          const remaining = (b.X - e.to.X) * dx + (b.Y - e.to.Y) * dy;
          return advance > 0 && remaining >= -1e-6 && Math.abs((e.to.X - a.X) * dy - (e.to.Y - a.Y) * dx) <= len * 1.5;
        });
        graph.set(k, { point, steps });
        for (const step of steps) if (!graph.has(key(step.to))) pending.push(step.to);
      }
      const progress = (p: NetworkPoint) => (p.X - a.X) * dx + (p.Y - a.Y) * dy;
      const routes = new Map<string, number>([[key(b), 1]]);
      for (const { point, steps } of [...graph.values()].sort((u, v) => progress(v.point) - progress(u.point))) {
        if (key(point) === key(b)) continue;
        routes.set(key(point), Math.min(2, steps.reduce((n, step) => n + (routes.get(key(step.to)) ?? 0), 0)));
      }
      if (routes.get(key(a)) !== 1) throw traceError(`boundary-complete-routes:${routes.get(key(a)) ?? 0}`);
      let at = a;
      while (key(at) !== key(b)) {
        if (++work > 200000) throw traceError('trace-budget');
        const candidates = graph.get(key(at))!.steps.filter(e => (routes.get(key(e.to)) ?? 0) > 0);
        if (candidates.length !== 1) throw traceError(`boundary-edge-candidates:${candidates.length}`);
        const next = candidates[0], refs = network.edges[next.edge].sources;
        if (refs.length !== 1) throw traceError(`edge-source-spans:${refs.length}`);
        const ref = refs[0];
        points.push(at); edges.push(next.edge);
        spans.push(next.forward ? ref : { path: ref.path, u0: ref.u1, u1: ref.u0 }); at = next.to;
      }
    }
    return { points, spans, edges };
  };
  const canonical = (p: NetworkPoint[]) => {
    let first = 0;
    p.forEach((q, i) => { if (q.X < p[first].X || (q.X === p[first].X && q.Y < p[first].Y)) first = i; });
    const forward = p.slice(first).concat(p.slice(0, first));
    const a = forward.map(key).join('|'), b = [forward[0], ...forward.slice(1).reverse()].map(key).join('|');
    return a < b ? a : b;
  };
  const seen = new Set<string>(), contours: OffsetContour[] = [];
  const polygons = [...plan.outer, ...plan.holes.flatMap(h => h.subs)];
  for (const polygon of polygons) {
    const raw = polygon.nodes.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })), signature = canonical(raw);
    if (seen.has(signature)) continue; seen.add(signature);
    try {
      const traced = trace(raw), members: Member[] = [];
      traced.spans.forEach((span, index) => {
        const p = network.paths[span.path], source = owner.get(p.objectId);
        if (source === undefined) throw new Error(unavailable());
        const last = members[members.length - 1];
        if (last && last.owner === source && last.sub === p.sub) {
          last.to = index + 1; last.ranges!.push({ u0: span.u0, u1: span.u1 });
        } else members.push({ owner: source, sub: p.sub, reversed: false, from: index, to: index + 1, ranges: [{ u0: span.u0, u1: span.u1 }] });
      });
      // Put an ownership seam at index zero so runs never wrap around the cache.
      if (members.length > 1 && members[0].owner === members.at(-1)!.owner && members[0].sub === members.at(-1)!.sub) {
        const cut = members[0].to, first = members.shift()!;
        const last = members.at(-1)!; last.ranges!.push(...first.ranges!); last.to += cut;
        traced.points = traced.points.slice(cut).concat(traced.points.slice(0, cut));
        traced.edges = traced.edges.slice(cut).concat(traced.edges.slice(0, cut));
        members.forEach(m => { m.from -= cut; m.to -= cut; });
      }
      const grouped = new Map<string, OffsetRange[]>();
      for (const m of members) {
        const k = `${sources[m.owner].id}:${m.sub}`;
        grouped.set(k, [...(grouped.get(k) ?? []), ...m.ranges!]);
      }
      const token = [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([k, rs]) =>
        `${k}[${mergedRanges(rs).map(r => `${r.u0.toFixed(8)}-${r.u1.toFixed(8)}`).join(',')}]`).join('|');
      contours.push({ key: `net:${token}`, points: traced.points.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })), members, distance: 0, edges: traced.edges });
    } catch (error) {
      contours.push({ key: `blocked:${signature}`, points: polygon.nodes, members: [], distance: 0,
        blocked: error instanceof Error ? error.message : unavailable(), blockedReason: error instanceof Error ? String(error.cause ?? 'unknown') : 'unknown' });
    }
  }
  return { contours, unused: network.looseEnds.length };
}
