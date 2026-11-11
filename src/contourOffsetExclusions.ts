// Source-parametric exclusions. Curves are extracted exactly, never flattened in
// the persisted result. Flattening is used only by the existing topology checks.
import { apply, type Node, type Pt, type SubPath } from './model';
import { segments } from './curves';
import { extract, reverseSub } from './pathtools';
import { mergedRanges } from './contourOffsetNetwork';
import type { OffsetContour, OffsetSource, TrimmedOffsetSpan } from './contourOffset';
import { t } from './i18n';

export const exclusionError = () => new Error(t('Ungültiges Konturversatz-Rezept.'));
const ownerError = (cause: object) => Object.assign(new Error(t('Versatz kann die Quellzuordnung dieser Teilkontur nicht erhalten. Kleineren Versatz wählen.')), { cause });
const budgetError = () => new Error(t('Arbeitsgrenze des Konturversatzes erreicht.'));

/** Reversed endpoints mean the same source interval, not a wrapping interval.
 * A wrap across the closed-path origin must be represented by two intervals. */
export function normalizeOffsetExclusions(base: SubPath[], spans: readonly TrimmedOffsetSpan[]): TrimmedOffsetSpan[] {
  if (!Array.isArray(spans) || spans.length > 20000) throw exclusionError();
  const periods = new Map<number, number>();
  for (const r of spans) {
    if (!r || !Number.isInteger(r.sub) || !base[r.sub] || r.sub < 0 || !Number.isFinite(r.u0) || !Number.isFinite(r.u1)) throw exclusionError();
    if (!periods.has(r.sub)) periods.set(r.sub, segments(base[r.sub]).length);
    if (Math.min(r.u0, r.u1) < 0 || Math.max(r.u0, r.u1) > periods.get(r.sub)! || Math.abs(r.u1 - r.u0) < 1e-9) throw exclusionError();
  }
  return [...new Set(spans.map(r => r.sub))].sort((a, b) => a - b).flatMap(sub =>
    mergedRanges(spans.filter(r => r.sub === sub)).map(r => ({ sub, ...r })));
}

export function worldExcludedOffsetPaths(source: OffsetSource, spans: readonly TrimmedOffsetSpan[] = source.excluded ?? []): SubPath[] {
  return normalizeOffsetExclusions(source.base, spans).map(r => worldExtract(source, r.sub, r.u0, r.u1));
}

function worldExtract(source: OffsetSource, sub: number, u0: number, u1: number): SubPath {
  const path = extract(source.base[sub], Math.min(u0, u1), Math.max(u0, u1));
  if (u1 < u0) reverseSub(path);
  return { ...path, nodes: path.nodes.map(n => ({ ...n, ...apply(source.m, n.x, n.y),
    ...(n.cin ? { cin: apply(source.m, n.cin.x, n.cin.y) } : {}),
    ...(n.cout ? { cout: apply(source.m, n.cout.x, n.cout.y) } : {}) })) };
}

export interface ExclusionRun { excluded: boolean; owner: number; sub: number; u0: number; u1: number; from: number; to: number }

/** Exact endpoint and traversal tangent of a preserved source interval. A seam
 * must not use interpolation along the network's quantized flattening chord. */
export function exclusionBoundary(source: OffsetSource, run: ExclusionRun, end: boolean): { point: Pt; tangent: Pt } {
  const path = worldExtract(source, run.sub, run.u0, run.u1), curve = end ? segments(path).at(-1)! : segments(path)[0];
  if (!curve) throw ownerError({ reason: 'empty-exclusion-interval', sub: run.sub, u0: run.u0, u1: run.u1 });
  const point = end ? curve.b : curve.a;
  const candidates = end ? [curve.c2, curve.c1, curve.a] : [curve.c1, curve.c2, curve.b];
  const other = candidates.find(p => Math.hypot(p.x - point.x, p.y - point.y) > 1e-10);
  if (!other) throw ownerError({ reason: 'degenerate-exclusion-tangent', sub: run.sub, u: end ? run.u1 : run.u0 });
  const sign = end ? -1 : 1, length = Math.hypot(other.x - point.x, other.y - point.y);
  return { point: { x: point.x, y: point.y }, tangent: { x: sign * (other.x - point.x) / length, y: sign * (other.y - point.y) / length } };
}

/** Expand the network's one-range-per-edge trace at exclusion boundaries. Each
 * transition gets an explicit point, making seam lookup reject lost provenance. */
export function exclusionRuns(contour: OffsetContour, sources: OffsetSource[], exclusions: ReadonlyMap<number, readonly TrimmedOffsetSpan[]>, approvedAssembly = false): { points: Node[]; runs: ExclusionRun[] } | null {
  let work = 0;
  if (!contour.members.some(m => exclusions.get(sources[m.owner].id)?.some(r => r.sub === m.sub && m.ranges?.some(s => {
      if (++work > 2000000) throw budgetError();
      return Math.min(Math.max(s.u0, s.u1), r.u1) - Math.max(Math.min(s.u0, s.u1), r.u0) > 1e-9;
    })))) return null;
  if (!contour.members.length || (!approvedAssembly && contour.members.some(m => m.owner !== contour.members[0].owner))) {
    throw ownerError({ reason: 'cross-owner-exclusion', owners: [...new Set(contour.members.map(m => sources[m.owner].id))] });
  }
  const points: Node[] = [], runs: ExclusionRun[] = [];
  for (const m of contour.members) {
    if (!m.ranges || m.ranges.length !== m.to - m.from) throw ownerError({ reason: 'missing-exclusion-range-provenance' });
    m.ranges.forEach((range, i) => {
      const lo = Math.min(range.u0, range.u1), hi = Math.max(range.u0, range.u1);
      const excluded = exclusions.get(sources[m.owner].id)?.filter(r => r.sub === m.sub) ?? [];
      if ((work += excluded.length + 1) > 2000000) throw budgetError();
      const cuts = [...new Set([range.u0, range.u1, ...excluded.flatMap(r => [r.u0, r.u1]).filter(u => u > lo + 1e-10 && u < hi - 1e-10)])]
        .sort((a, b) => range.u1 > range.u0 ? a - b : b - a);
      const a = contour.points[(m.from + i) % contour.points.length], b = contour.points[(m.from + i + 1) % contour.points.length];
      for (let j = 0; j + 1 < cuts.length; j++) {
        if (points.length >= 20000) throw budgetError();
        const u0 = cuts[j], u1 = cuts[j + 1], f = (u0 - range.u0) / (range.u1 - range.u0), mid = (u0 + u1) / 2;
        const keep = excluded.some(r => mid > r.u0 && mid < r.u1), from = points.length;
        points.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        const last = runs.at(-1);
        if (last && last.excluded === keep && (!keep || (last.owner === m.owner && last.sub === m.sub && Math.abs(last.u1 - u0) < 1e-8 && (last.u1 - last.u0) * (u1 - u0) > 0))) {
          last.to = from + 1; last.u1 = u1;
        } else runs.push({ excluded: keep, owner: m.owner, sub: m.sub, u0, u1, from, to: from + 1 });
      }
    });
  }
  if (runs.every(r => r.excluded)) throw ownerError({ reason: 'fully-excluded-contour' });
  // A network's arbitrary polygon origin may fall inside one preserved Bézier.
  // Move that origin to the next run boundary instead of unnecessarily splitting
  // the exact source extraction into two curves with different control points.
  const first = runs[0], last = runs.at(-1)!;
  if (runs.length > 1 && ((!first.excluded && !last.excluded) ||
    (first.excluded && last.excluded && first.owner === last.owner && first.sub === last.sub &&
      Math.abs(last.u1 - first.u0) < 1e-8 && (last.u1 - last.u0) * (first.u1 - first.u0) > 0))) {
    const cut = first.to, rotated = points.slice(cut).concat(points.slice(0, cut));
    runs.shift();
    for (const run of runs) { run.from -= cut; run.to -= cut; }
    last.u1 = first.u1; last.to = points.length;
    return { points: rotated, runs };
  }
  return { points, runs };
}

/** Offset runs and preserved exact curves are connected only by straight edges. */
export function assembleExcludedOffset(sources: OffsetSource[], runs: ExclusionRun[], offsetRuns: SubPath[]): SubPath {
  const nodes: Node[] = [];
  runs.forEach((run, i) => {
    const path = run.excluded ? worldExtract(sources[run.owner], run.sub, run.u0, run.u1) : offsetRuns[i];
    for (const raw of path.nodes) {
      const n = structuredClone(raw), last = nodes.at(-1);
      if (last && Math.hypot(last.x - n.x, last.y - n.y) < 1e-10) {
        if (n.cout) last.cout = n.cout;
      } else nodes.push(n);
    }
  });
  const first = nodes[0], last = nodes.at(-1)!;
  if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-10) {
    if (last.cin) first.cin = last.cin;
    nodes.pop();
  }
  return { closed: true, nodes };
}

/** Conservative, unquantized validation mesh. The control hull must lie within
 * 0.0001 mm of its chord; unresolved curves exhaust the budget, never disappear. */
export function flattenExcludedOffset(path: SubPath): Pt[] {
  const points: Pt[] = [{ x: path.nodes[0].x, y: path.nodes[0].y }];
  const midpoint = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const chordDistance = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
    const u = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
    return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
  };
  const visit = (a: Pt, c: Pt, d: Pt, b: Pt, depth: number) => {
    if (points.length >= 20000 || depth > 24) throw budgetError();
    if (Math.max(chordDistance(c, a, b), chordDistance(d, a, b)) <= .0001) {
      if (Math.hypot(b.x - points.at(-1)!.x, b.y - points.at(-1)!.y) > 1e-10) points.push({ x: b.x, y: b.y });
      return;
    }
    const ac = midpoint(a, c), cd = midpoint(c, d), db = midpoint(d, b), left = midpoint(ac, cd), right = midpoint(cd, db), mid = midpoint(left, right);
    visit(a, ac, left, mid, depth + 1); visit(mid, right, db, b, depth + 1);
  };
  for (const s of segments(path)) visit(s.a, s.c1, s.c2, s.b, 0);
  if (Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-10) points.pop();
  return points;
}
