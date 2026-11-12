import { apply, type Pt, type SubPath } from './model';
import type { OffsetSource, OffsetContours, OffsetRange, TrimmedOffsetSpan } from './contourOffset';
import { nearestParam, extract, pointAt } from './pathtools';
import { segments } from './curves';
import { mergedRanges } from './contourOffsetNetwork';

export interface OffsetSelectionSource {
  id: number; sub: number; ranges: OffsetRange[]; boundaries: number[];
}
export interface OffsetSourceHit { id: number; sub: number; u: number; d: number; point: Pt; snapped?: boolean }

/** Only ranges used by the explicitly selected contour are pickable. Other
 * detected faces contribute junction snap targets, never extra selectable spans. */
export function offsetSelectionSources(sources: OffsetSource[], plan: OffsetContours, contourKey: string): OffsetSelectionSource[] {
  const contour = plan.contours.find(c => c.key === contourKey);
  const choices = new Map<string, OffsetSelectionSource>();
  for (const m of contour?.members ?? []) {
    const source = sources[m.owner], key = `${source.id}:${m.sub}`;
    const choice = choices.get(key) ?? { id: source.id, sub: m.sub, ranges: [], boundaries: [] };
    choice.ranges.push(...(m.ranges ?? [{ u0: 0, u1: segments(source.base[m.sub]).length }]));
    choices.set(key, choice);
  }
  for (const choice of choices.values()) {
    choice.ranges = mergedRanges(choice.ranges);
    const path = sources.find(s => s.id === choice.id)!.base[choice.sub];
    const boundaries = new Set(Array.from({ length: segments(path).length + 1 }, (_, i) => i));
    for (const c of plan.contours) for (const m of c.members) {
      if (sources[m.owner].id !== choice.id || m.sub !== choice.sub) continue;
      for (const r of mergedRanges(m.ranges ?? [{ u0: 0, u1: segments(path).length }])) {
        boundaries.add(r.u0); boundaries.add(r.u1);
      }
    }
    choice.boundaries = [...boundaries].filter(u => choice.ranges.some(r => u >= r.u0 - 1e-7 && u <= r.u1 + 1e-7));
  }
  return [...choices.values()];
}

/** Snap distance is supplied in world units by the UI (screen pixels / zoom).
 * Restrict before hit-testing, so a nearby unselected branch cannot steal a pick. */
export function pickOffsetSelection(sources: OffsetSource[], choice: OffsetSelectionSource, point: Pt, radius: number, snapRadius = radius): OffsetSourceHit | undefined {
  const source = sources.find(s => s.id === choice.id);
  if (!source) return;
  const world = offsetWorldPath(source, source.base[choice.sub]);
  const snapped = choice.boundaries.map(u => ({ u, point: pointAt(world, u) }))
    .map(hit => ({ ...hit, d: Math.hypot(hit.point.x - point.x, hit.point.y - point.y) }))
    .filter(hit => hit.d <= snapRadius).sort((a, b) => a.d - b.d)[0];
  if (snapped) return { id: choice.id, sub: choice.sub, ...snapped, snapped: true };
  let best: OffsetSourceHit | undefined;
  for (const r of choice.ranges) {
    const path = extract(world, r.u0, r.u1), hit = nearestParam(path, point);
    const knots = [r.u0];
    for (let i = Math.floor(r.u0) + 1; i < r.u1; i++) knots.push(i);
    knots.push(r.u1);
    const i = Math.min(Math.floor(hit.u), knots.length - 2);
    const u = knots[i] + (knots[i + 1] - knots[i]) * (hit.u - i);
    if (hit.d <= radius && (!best || hit.d < best.d)) best = { id: choice.id, sub: choice.sub, u, d: hit.d, point: pointAt(world, u) };
  }
  return best;
}

/** Closed paths expose both arcs; default is the shorter *world-space* arc,
 * not min/max source parameter. No clipping: an arc leaving the chosen face
 * remains unavailable rather than silently excluding a different interval. */
export function offsetSelectionArcs(source: OffsetSource, choice: OffsetSelectionSource, a: number, b: number): { spans: TrimmedOffsetSpan[]; allowed: boolean; length: number }[] {
  const path = source.base[choice.sub], world = offsetWorldPath(source, path), period = segments(path).length;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi - lo < 1e-7 || path.closed && period - hi + lo < 1e-7) return [];
  const routes = [[{ u0: lo, u1: hi }]];
  if (path.closed) routes.push([{ u0: 0, u1: lo }, { u0: hi, u1: period }].filter(r => r.u1 - r.u0 > 1e-7));
  return routes.map(ranges => {
    let length = 0;
    for (const r of ranges) {
      // Subdivide each original segment, including fractional interval ends.
      const steps = Math.max(1, Math.ceil((r.u1 - r.u0) * 32));
      let p = pointAt(world, r.u0);
      for (let i = 1; i <= steps; i++) {
        const q = pointAt(world, r.u0 + (r.u1 - r.u0) * i / steps);
        length += Math.hypot(q.x - p.x, q.y - p.y); p = q;
      }
    }
    return { spans: ranges.map(r => ({ sub: choice.sub, ...r })), length,
      allowed: ranges.every(r => choice.ranges.some(s => r.u0 >= s.u0 - 1e-7 && r.u1 <= s.u1 + 1e-7)) };
  }).sort((a, b) => a.length - b.length);
}

export function activeOffsetExclusions(sources: OffsetSource[], plan: OffsetContours, amounts: ReadonlyMap<string, number>, exclusions: ReadonlyMap<number, readonly TrimmedOffsetSpan[]>): Map<number, TrimmedOffsetSpan[]> {
  const active = new Map<number, TrimmedOffsetSpan[]>();
  for (const c of plan.contours) if (amounts.has(c.key)) for (const choice of offsetSelectionSources(sources, plan, c.key)) {
    for (const span of exclusions.get(choice.id) ?? []) if (span.sub === choice.sub) for (const r of choice.ranges) {
      const u0 = Math.max(span.u0, r.u0), u1 = Math.min(span.u1, r.u1);
      if (u1 - u0 > 1e-7) active.set(choice.id, [...(active.get(choice.id) ?? []), { sub: span.sub, u0, u1 }]);
    }
  }
  return active;
}

export function offsetWorldPath(source: OffsetSource, path: SubPath): SubPath {
  return { ...path, nodes: path.nodes.map(n => ({ ...n, ...apply(source.m, n.x, n.y),
    ...(n.cin ? { cin: apply(source.m, n.cin.x, n.cin.y) } : {}),
    ...(n.cout ? { cout: apply(source.m, n.cout.x, n.cout.y) } : {}) })) };
}

export function pickOffsetSource(sources: OffsetSource[], point: Pt, radius: number, required?: { id: number; sub: number }) {
  let best: { id: number; sub: number; u: number; d: number; point: Pt } | undefined;
  for (const source of sources) source.base.forEach((path, sub) => {
    if (required && (source.id !== required.id || sub !== required.sub)) return;
    const world = offsetWorldPath(source, path), hit = nearestParam(world, point);
    if (hit.d <= radius && (!best || hit.d < best.d)) best = { id: source.id, sub, ...hit, point: pointAt(world, hit.u) };
  });
  return best;
}

export function offsetExcludedPaths(sources: OffsetSource[], exclusions: ReadonlyMap<number, readonly TrimmedOffsetSpan[]>): SubPath[] {
  return sources.flatMap(source => (exclusions.get(source.id) ?? []).map(span =>
    offsetWorldPath(source, extract(source.base[span.sub], span.u0, span.u1))));
}
