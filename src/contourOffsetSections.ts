import { type Obj, type Pt } from './model';
import { SCALE } from './clip';
import { segments } from './curves';
import { extract, nearestParam, pointAt } from './pathtools';
import { outlineNetwork } from './outlineNetwork';
import { mergedRanges } from './contourOffsetNetwork';
import { offsetSelectionSources, offsetWorldPath } from './contourOffsetSelection';
import type { OffsetContours, OffsetSource, TrimmedOffsetSpan } from './contourOffset';

/** Parameters always refer to the original Bézier source, never preview polygons. */
export interface OffsetSection {
  key: string; id: number; sub: number; spans: TrimmedOffsetSpan[];
  toleranceOnly: boolean; wholeContour: boolean;
}
export interface OffsetSectionHit { section: OffsetSection; d: number }

/** Reuse the exterior network at the explicitly supplied tolerance. Degree-two
 * tessellation vertices and ordinary source nodes are not section boundaries. */
export function offsetContourSections(sources: OffsetSource[], plan: OffsetContours, contourKey: string, tolerance: number): OffsetSection[] {
  const objects: Obj[] = sources.map(s => ({ id: s.id, m: s.m, layer: 0, shape: { kind: 'path', subs: s.base } }));
  const network = outlineNetwork(objects, tolerance);
  const vertices = new Map<string, { degree: number; refs: { path: number; u: number }[]; point: Pt }>();
  for (const edge of network.edges) for (const [p, end] of [[edge.a, 'u0'], [edge.b, 'u1']] as const) {
    const key = `${p.X}:${p.Y}`, v = vertices.get(key) ?? { degree: 0, refs: [], point: { x: p.X / SCALE, y: p.Y / SCALE } };
    v.degree++;
    v.refs.push(...edge.sources.map(s => ({ path: s.path, u: s[end] })));
    vertices.set(key, v);
  }
  const cuts = new Map<string, { u: number; toleranceOnly: boolean }[]>();
  for (const v of vertices.values()) {
    const paths = new Set(v.refs.map(r => r.path));
    // A seam between distinct open paths is also a natural common endpoint.
    if (v.degree === 2 && paths.size === 1) continue;
    const toleranceOnly = v.refs.some(r => {
      const p = network.paths[r.path], source = sources.find(s => s.id === p.objectId)!;
      if (p.closed || Math.min(Math.abs(r.u), Math.abs(r.u - p.period)) > 1e-7) return false;
      const q = pointAt(offsetWorldPath(source, source.base[p.sub]), r.u);
      return Math.hypot(q.x - v.point.x, q.y - v.point.y) > 2 / SCALE;
    });
    for (const r of v.refs) {
      const p = network.paths[r.path], key = `${p.objectId}:${p.sub}`;
      cuts.set(key, [...(cuts.get(key) ?? []), { u: r.u, toleranceOnly }]);
    }
  }
  const choices = offsetSelectionSources(sources, plan, contourKey), result: OffsetSection[] = [];
  for (const choice of choices) {
    const source = sources.find(s => s.id === choice.id)!, path = source.base[choice.sub], period = segments(path).length;
    const junctions = cuts.get(`${choice.id}:${choice.sub}`) ?? [];
    const groups: TrimmedOffsetSpan[][] = [];
    for (const range of choice.ranges) {
      const boundaries = [...new Set([range.u0, ...junctions.map(j => j.u).filter(u => u > range.u0 + 1e-7 && u < range.u1 - 1e-7), range.u1])].sort((a, b) => a - b);
      for (let i = 1; i < boundaries.length; i++) groups.push([{ sub: choice.sub, u0: boundaries[i - 1], u1: boundaries[i] }]);
    }
    // Parameter zero is not a junction on an otherwise continuous closed path.
    if (path.closed && groups.length > 1 && groups[0][0].u0 < 1e-7 && groups.at(-1)![0].u1 > period - 1e-7 &&
      !junctions.some(j => j.u < 1e-7 || j.u > period - 1e-7)) groups[0].push(...groups.pop()!);
    for (const spans of groups) result.push({ key: `${choice.id}:${choice.sub}:${spans.map(s => `${s.u0}-${s.u1}`).join(',')}`,
      id: choice.id, sub: choice.sub, spans,
      toleranceOnly: junctions.some(j => j.toleranceOnly && spans.some(s => Math.abs(s.u0 - j.u) < 1e-7 || Math.abs(s.u1 - j.u) < 1e-7)),
      wholeContour: choices.length === 1 && groups.length === 1 });
  }
  return result;
}

/** Return ALL nearby alternatives: the UI must not silently pick a coincident branch. */
export function pickOffsetSections(sources: OffsetSource[], sections: OffsetSection[], point: Pt, radius: number): OffsetSectionHit[] {
  return sections.map(section => {
    const source = sources.find(s => s.id === section.id)!, world = offsetWorldPath(source, source.base[section.sub]);
    return { section, d: Math.min(...section.spans.map(s => nearestParam(extract(world, s.u0, s.u1), point).d)) };
  }).filter(h => h.d <= radius).sort((a, b) => a.d - b.d);
}

export function offsetSectionExcluded(section: OffsetSection, spans: readonly TrimmedOffsetSpan[]): boolean {
  const ranges = mergedRanges(spans.filter(s => s.sub === section.sub));
  return section.spans.every(s => ranges.some(r => r.u0 <= s.u0 + 1e-7 && r.u1 >= s.u1 - 1e-7));
}

export function toggleOffsetSection(section: OffsetSection, spans: readonly TrimmedOffsetSpan[]): TrimmedOffsetSpan[] {
  if (!offsetSectionExcluded(section, spans)) return [...spans, ...section.spans];
  let result = spans.map(s => ({ ...s }));
  for (const cut of section.spans) result = result.flatMap(s => {
    if (s.sub !== cut.sub || s.u1 <= cut.u0 || s.u0 >= cut.u1) return [s];
    return [{ ...s, u1: Math.min(s.u1, cut.u0) }, { ...s, u0: Math.max(s.u0, cut.u1) }].filter(r => r.u1 - r.u0 > 1e-7);
  });
  return result;
}
