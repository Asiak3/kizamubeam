// Infinite construction lines against original (unflattened) contour segments.
import type { Pt, SubPath } from './model';
import type { SlotOrigin } from './straightSlots';
import { straightGeometry } from './straightSlots';
import { bezierPt, segments } from './curves';
import { FLATTEN_TOL } from './clip';
import { t } from './i18n';

export interface SlotConstructionLine {
  id: string;
  name?: string;
  first: SlotOrigin;
  second: SlotOrigin;
  edge: string;
}
type IntersectionOrigin = Extract<SlotOrigin, { kind: 'intersection' }>;
export interface ResolvedConstructionLine {
  id: string;
  point: Pt;
  direction: Pt;
  intersections: { origin: IntersectionOrigin; point: Pt }[];
}

const MAX_NODES = 10000, MAX_ROOTS = 30000;
const PARAM_EPS = 1e-10;
const finitePoint = (p: Pt) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const invalid = () => new Error(t('Ungültige Referenz der Konstruktionslinie.'));
const ambiguous = () => new Error(t('Konstruktionslinie berührt die Kontur tangential oder fällt mit ihr zusammen.'));
const limit = () => new Error(t('Arbeitsgrenze der Konstruktionslinie erreicht.'));

function validOrigin(ref: SlotOrigin): boolean {
  if (!ref) return false;
  const index = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (ref.kind === 'vertex' || ref.kind === 'curveCorner') return index(ref.sub) && index(ref.node);
  if (ref.kind === 'slot') return typeof ref.slotId === 'string' && !!ref.slotId &&
    ['start', 'center', 'end', 'bottomStart', 'bottomEnd'].includes(ref.point);
  return ref.kind === 'intersection' && typeof ref.helperId === 'string' && !!ref.helperId &&
    index(ref.sub) && index(ref.segment) && index(ref.root) && index(ref.count) && ref.count > ref.root && ref.count <= 3;
}

// Derivative partitions make a cubic monotonic on each interval. Bisection then
// finds all crossings in [0,1], with a fixed bound independent of world extent.
// Values are signed distances in Bernstein form, normalized before solving.
function crossingRoots(values: number[]): number[] {
  const scale = Math.max(...values.map(Math.abs));
  if (scale === 0) throw ambiguous();
  const v = values.map(x => x / scale);
  const c = v.length === 2 ? [v[0], v[1] - v[0]] :
    [v[0], 3 * (v[1] - v[0]), 3 * (v[2] - 2 * v[1] + v[0]), v[3] - 3 * v[2] + 3 * v[1] - v[0]];
  const evalAt = (x: number) => c.reduceRight((a, b) => a * x + b, 0);
  const slope = (x: number) => (c[1] ?? 0) + 2 * (c[2] ?? 0) * x + 3 * (c[3] ?? 0) * x * x;
  const critical: number[] = [];
  if (c.length === 4) {
    const a = 3 * c[3], b = 2 * c[2], d = c[1];
    if (Math.abs(a) < 1e-14) {
      if (Math.abs(b) > 1e-14) critical.push(-d / b);
    } else {
      const disc = b * b - 4 * a * d;
      if (disc >= 0) {
        const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
        if (q === 0) critical.push(-b / (2 * a));
        else critical.push(q / a, d / q);
      }
    }
  }
  const cuts = [0, ...critical.filter(x => x > 0 && x < 1), 1].sort((a, b) => a - b)
    .filter((x, i, all) => !i || x - all[i - 1] > PARAM_EPS);
  const roots: number[] = [];
  for (const x of cuts) {
    if (Math.abs(evalAt(x)) <= 1e-12) {
      if (Math.abs(slope(x)) <= 1e-10 || (x !== 0 && x !== 1)) throw ambiguous();
      roots.push(x);
    }
  }
  for (let i = 1; i < cuts.length; i++) {
    let lo = cuts[i - 1], hi = cuts[i], flo = evalAt(lo), fhi = evalAt(hi);
    if (Math.abs(flo) <= 1e-12 || Math.abs(fhi) <= 1e-12 || Math.sign(flo) === Math.sign(fhi)) continue;
    for (let step = 0; step < 60; step++) {
      const mid = (lo + hi) / 2, f = evalAt(mid);
      if (Math.sign(f) === Math.sign(flo)) { lo = mid; flo = f; }
      else { hi = mid; fhi = f; }
    }
    const root = (lo + hi) / 2;
    if (Math.abs(slope(root)) <= 1e-10) throw ambiguous();
    roots.push(root);
  }
  return roots.sort((a, b) => a - b);
}

export function resolveConstructionLine(base: SubPath[], helper: SlotConstructionLine, cornerAngle: number,
  resolvePoint: (ref: SlotOrigin) => Pt): ResolvedConstructionLine {
  if (!helper || typeof helper.id !== 'string' || !helper.id || typeof helper.edge !== 'string' ||
      !validOrigin(helper.first) || !validOrigin(helper.second)) throw invalid();
  let nodes = 0, flattened = 0;
  for (const sp of base) {
    nodes += sp.nodes.length;
    if (nodes > MAX_NODES || base.length > MAX_NODES) throw limit();
    if (sp.nodes.length < 2) throw invalid();
    for (const n of sp.nodes) if (!finitePoint(n) || (n.cin && !finitePoint(n.cin)) || (n.cout && !finitePoint(n.cout))) throw invalid();
    // straightGeometry flattens for edge selection only. Budget that work
    // before it allocates, including its repeated point-in-polygon queries.
    flattened++;
    for (const s of segments(sp)) {
      if (!s.curve) flattened++;
      else {
        const len = Math.hypot(s.c1.x - s.a.x, s.c1.y - s.a.y) + Math.hypot(s.c2.x - s.c1.x, s.c2.y - s.c1.y) + Math.hypot(s.b.x - s.c2.x, s.b.y - s.c2.y);
        if (!Number.isFinite(len)) throw invalid();
        flattened += Math.max(4, Math.min(2048, Math.max(Math.ceil(Math.sqrt(len / FLATTEN_TOL) * 0.6), Math.ceil(len))));
      }
      if (flattened > 50000) throw limit();
    }
  }
  if (flattened * Math.max(nodes, base.length) > 10000000) throw limit();
  const first = resolvePoint(helper.first), second = resolvePoint(helper.second);
  if (!finitePoint(first) || !finitePoint(second)) throw invalid();
  const separation = Math.hypot(first.x - second.x, first.y - second.y);
  if (!Number.isFinite(separation)) throw invalid();
  if (separation <= 1e-9)
    throw new Error(t('Die beiden Punkte der Konstruktionslinie müssen verschieden sein.'));
  const edge = straightGeometry(base, cornerAngle).edges.find(e => e.key === helper.edge);
  if (!edge) throw new Error(t('Eine echte gerade Projektionskante wählen. Rundungen sind nicht zulässig.'));
  const point = { x: first.x / 2 + second.x / 2, y: first.y / 2 + second.y / 2 };
  const direction = { x: -edge.tangent.y, y: edge.tangent.x };
  const signed = (p: Pt) => (p.x - point.x) * direction.y - (p.y - point.y) * direction.x;
  const intersections: ResolvedConstructionLine['intersections'] = [];
  base.forEach((sp, sub) => {
    const ss = segments(sp);
    const roots = ss.map(s => {
      const values = (s.curve ? [s.a, s.c1, s.c2, s.b] : [s.a, s.b]).map(signed);
      if (!values.every(Number.isFinite)) throw invalid();
      return crossingRoots(values);
    });
    // A shared endpoint belongs to the lower original segment index. Only
    // topological duplicates are merged; distinct contours never rebind.
    ss.forEach((s, segment) => {
      const owned = roots[segment].filter(u => {
        if (u !== 0 && u !== 1) return true;
        const other = u === 0 ? (segment - 1 + ss.length) % ss.length : (segment + 1) % ss.length;
        if (!sp.closed && ((u === 0 && segment === 0) || (u === 1 && segment === ss.length - 1))) return true;
        const otherU = u === 0 ? 1 : 0;
        if (!roots[other].includes(otherU)) throw ambiguous();
        const incoming = u === 0 ? ss[other] : s, outgoing = u === 0 ? s : ss[other];
        const before = signed(incoming.curve ? incoming.c2 : incoming.a);
        const after = signed(outgoing.curve ? outgoing.c1 : outgoing.b);
        if (before * after >= 0) throw ambiguous();
        return segment < other;
      });
      owned.forEach((u, root) => {
        if (intersections.length >= MAX_ROOTS) throw limit();
        const p = s.curve ? bezierPt(s.a, s.c1, s.c2, s.b, u) :
          { x: s.a.x * (1 - u) + s.b.x * u, y: s.a.y * (1 - u) + s.b.y * u };
        if (!finitePoint(p)) throw invalid();
        intersections.push({ origin: { kind: 'intersection', helperId: helper.id, sub, segment, root, count: owned.length }, point: p });
      });
    });
  });
  return { id: helper.id, point, direction, intersections };
}

export function resolveConstructionIntersection(line: ResolvedConstructionLine, ref: IntersectionOrigin): Pt {
  if (!validOrigin(ref) || ref.kind !== 'intersection' || ref.helperId !== line.id) throw invalid();
  const matches = line.intersections.filter(i => i.origin.helperId === ref.helperId && i.origin.sub === ref.sub && i.origin.segment === ref.segment);
  const found = matches.find(i => i.origin.root === ref.root && i.origin.count === ref.count);
  if (matches.length !== ref.count || !found)
    throw new Error(t('Der referenzierte Konturschnittpunkt ist nicht mehr eindeutig vorhanden.'));
  return { ...found.point };
}
