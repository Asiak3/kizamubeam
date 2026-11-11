// Pure straight-edge placement. No editor, DOM or transport dependencies.
import ClipperLib from 'clipper-lib';
import { flattenSub, SCALE } from './clip';
import { segments } from './curves';
import { IDENT, Pt, SubPath } from './model';
import { t } from './i18n';

export type SlotPoint = 'start' | 'center' | 'end' | 'bottomStart' | 'bottomEnd';
export type SlotOrigin = { kind: 'vertex'; sub: number; node: number } | { kind: 'curveCorner'; sub: number; node: number }
  | { kind: 'slot'; slotId: string; point: SlotPoint }
  | { kind: 'intersection'; helperId: string; sub: number; segment: number; root: number; count: number };
export interface SlotProjection {
  edge: string; origin: SlotOrigin; target: 'start' | 'center' | 'end';
  distance: number; direction: 1 | -1; cornerAngle: number;
}
export interface StraightEdge { key: string; sub: number; start: number; end: number; a: Pt; b: Pt; tangent: Pt; normal: Pt; length: number }
export interface SlotVertex { key: string; sub: number; node: number; point: Pt; transition: boolean }
/** A reference offered by the picker. Rounded corners collapse into one virtual corner. */
export interface SlotReference { origin: SlotOrigin; point: Pt; transition: boolean; turn: number }
export interface StraightGeometry { edges: StraightEdge[]; vertices: SlotVertex[]; references: SlotReference[] }
export interface ProjectionFrame { a: Pt; b: Pt; center: Pt; bottomStart: Pt; bottomEnd: Pt; origin: Pt; zero: Pt; target: Pt; edge: StraightEdge; outline: SubPath }
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const along = (a: Pt, d: Pt, v: number): Pt => ({ x: a.x + d.x * v, y: a.y + d.y * v });
const length = (p: Pt) => Math.hypot(p.x, p.y);
const unit = (p: Pt): Pt => { const l = length(p); return l > 1e-9 ? { x: p.x / l, y: p.y / l } : { x: 0, y: 0 }; };
const angleDeg = (a: Pt, b: Pt) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) * 180 / Math.PI;
const lineIntersection = (a: Pt, da: Pt, b: Pt, db: Pt): Pt | null => {
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.x - a.x) * db.y - (b.y - a.y) * db.x) / den;
  const p = { x: a.x + da.x * t, y: a.y + da.y * t };
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
};
type Segment = ReturnType<typeof segments>[number];
const chainMidpoint = (ss: Segment[], first: number, last: number): Pt => {
  const points: Pt[] = [];
  for (let i = first; ; i = (i + 1) % ss.length) { points.push(ss[i].a); if (i === last) break; }
  points.push(ss[last].b);
  return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
};
// A rounded corner is the virtual intersection of the two straights around the
// curve chain. This is independent of the picker threshold so existing
// references stay resolvable when the threshold changes.
const chainCorner = (ss: Segment[], first: number, last: number): Pt => {
  const before = ss[(first + ss.length - 1) % ss.length], after = ss[(last + 1) % ss.length];
  const da = unit(sub(before.b, before.a)), db = unit(sub(after.b, after.a));
  return lineIntersection(before.a, da, after.a, db) ?? chainMidpoint(ss, first, last);
};
const pushReference = (list: SlotReference[], reference: SlotReference) => {
  const sub = reference.origin.kind === 'vertex' || reference.origin.kind === 'curveCorner' ? reference.origin.sub : -1;
  if (list.some(r => (r.origin.kind === 'vertex' || r.origin.kind === 'curveCorner') && r.origin.sub === sub &&
    Math.hypot(r.point.x - reference.point.x, r.point.y - reference.point.y) < 1e-4)) return;
  list.push(reference);
};
const cache = new WeakMap<SubPath[], Map<number, StraightGeometry>>();

export function straightGeometry(base: SubPath[], cornerAngle: number): StraightGeometry {
  if (!Number.isFinite(cornerAngle) || cornerAngle < 1 || cornerAngle > 179) throw new Error(t('Eckenwinkel muss zwischen 1° und 179° liegen.'));
  const known = cache.get(base)?.get(cornerAngle);
  if (known) return known;
  const polygons = base.map(sp => flattenSub(sp, IDENT));
  if (polygons.reduce((n, p) => n + p.length, 0) > 50000) throw new Error(t('Arbeitsgrenze der Schlitzplatzierung erreicht.'));
  const contains = (p: Pt) => polygons.reduce((n, path) => n + (ClipperLib.Clipper.PointInPolygon({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }, path) !== 0 ? 1 : 0), 0) % 2 === 1;
  const edges: StraightEdge[] = [], vertices: SlotVertex[] = [], references: SlotReference[] = [];
  base.forEach((sp, si) => {
    const ss = segments(sp);
    if (!sp.closed || !ss.length) return;
    // Only root contours of the selected part: internal holes are not placement edges.
    if (polygons.some((p, i) => i !== si && ClipperLib.Clipper.PointInPolygon(polygons[si][0], p) === 1)) return;
    const directions = ss.map(s => unit(sub(s.b, s.a)));
    const sameLine = (i: number, j: number) => !ss[i].curve && !ss[j].curve && dot(directions[i], directions[j]) > 1 - 1e-10;
    const seen = new Set<number>();
    ss.forEach((s, start) => {
      const previous = (start + ss.length - 1) % ss.length;
      if (s.curve || seen.has(start) || sameLine(previous, start)) return;
      let end = start;
      seen.add(end);
      while ((end + 1) % ss.length !== start && sameLine(end, (end + 1) % ss.length)) { end = (end + 1) % ss.length; seen.add(end); }
      const a = s.a, b = ss[end].b, tangent = unit(sub(b, a)), len = length(sub(b, a));
      if (len < 0.05) return;
      let normal = { x: -tangent.y, y: tangent.x };
      const center = along(a, tangent, len / 2), positive = contains(along(center, normal, 0.01)), negative = contains(along(center, normal, -0.01));
      if (positive === negative) return; // Interior overlap or ambiguous thin geometry.
      if (!positive) normal = { x: -normal.x, y: -normal.y };
      edges.push({ key: `${si}:${start}:${end}`, sub: si, start: s.ia, end: ss[end].ib, a, b, tangent, normal, length: len });
    });
    ss.forEach((outgoing, i) => {
      const incoming = ss[(i + ss.length - 1) % ss.length];
      const transition = incoming.curve !== outgoing.curve;
      const before = unit(sub(incoming.b, incoming.curve ? incoming.c2 : incoming.a));
      const after = unit(sub(outgoing.curve ? outgoing.c1 : outgoing.b, outgoing.a));
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(before, after)))) * 180 / Math.PI;
      if (transition || turn >= cornerAngle) vertices.push({ key: `${si}:${outgoing.ia}`, sub: si, node: outgoing.ia, point: outgoing.a, transition });
    });
    // Picker references are intentionally stricter than the legacy vertex list:
    // sharp corners must meet the threshold, and a rounded corner is offered once
    // with its effective angle instead of twice at its straight/curve junctions.
    ss.forEach((outgoing, i) => {
      const incoming = ss[(i + ss.length - 1) % ss.length];
      if (!incoming.curve && !outgoing.curve) {
        const turn = angleDeg(directions[(i + ss.length - 1) % ss.length], directions[i]);
        if (turn >= cornerAngle) pushReference(references, { origin: { kind: 'vertex', sub: si, node: outgoing.ia }, point: outgoing.a, transition: false, turn });
        return;
      }
      if (!outgoing.curve || incoming.curve) return;
      let last = i;
      while (ss[(last + 1) % ss.length].curve) last = (last + 1) % ss.length;
      const after = (last + 1) % ss.length;
      if (ss[after].curve) return; // A fully curved contour has no straight-bounded corner.
      const turn = angleDeg(directions[(i + ss.length - 1) % ss.length], directions[after]);
      if (turn >= cornerAngle) pushReference(references, { origin: { kind: 'curveCorner', sub: si, node: outgoing.ia }, point: chainCorner(ss, i, last), transition: true, turn });
    });
  });
  const result = { edges, vertices, references };
  const byAngle = cache.get(base) ?? new Map<number, StraightGeometry>();
  if (byAngle.size > 16) byAngle.clear();
  byAngle.set(cornerAngle, result); cache.set(base, byAngle);
  return result;
}

/** Resolve a rounded-corner reference independently of the current picker threshold. */
export function curveCorner(base: SubPath[], sub: number, node: number): Pt | null {
  const sp = base[sub];
  if (!sp?.closed) return null;
  const ss = segments(sp), n = ss.length;
  if (!n) return null;
  const first = ss.findIndex(s => s.curve && s.ia === node);
  if (first < 0 || ss[(first + n - 1) % n].curve) return null;
  let last = first;
  while (ss[(last + 1) % n].curve) last = (last + 1) % n;
  return ss[(last + 1) % n].curve ? null : chainCorner(ss, first, last);
}

export function projectedSlot(base: SubPath[], projection: SlotProjection, width: number, depth: number, origin: Pt): ProjectionFrame {
  if (![width, depth, origin.x, origin.y, projection.distance].every(Number.isFinite) || width < 0.05 || depth <= 0 || projection.distance < 0 || ![1, -1].includes(projection.direction) || !['start', 'center', 'end'].includes(projection.target))
    throw new Error(t('Ungültige Schlitzmaße oder Korrekturwerte.'));
  const edge = straightGeometry(base, projection.cornerAngle).edges.find(e => e.key === projection.edge);
  if (!edge) throw new Error(t('Eine echte gerade Projektionskante wählen. Rundungen sind nicht zulässig.'));
  const zeroAt = dot(sub(origin, edge.a), edge.tangent), zero = along(edge.a, edge.tangent, zeroAt);
  const targetAt = zeroAt + projection.distance * projection.direction;
  const centerAt = targetAt + (projection.target === 'start' ? width / 2 : projection.target === 'end' ? -width / 2 : 0);
  if (centerAt - width / 2 < -0.001 || centerAt + width / 2 > edge.length + 0.001)
    throw new Error(`${t('Die Ausklinkung muss vollständig auf die gewählte Gerade passen.')} ${t('Belegter Kantenbereich: {start} bis {end} mm; verfügbar: 0 bis {length} mm. Richtung oder Abstand ändern.', { start: (centerAt - width / 2).toFixed(2), end: (centerAt + width / 2).toFixed(2), length: edge.length.toFixed(2) })}`);
  const a = along(edge.a, edge.tangent, centerAt - width / 2), b = along(a, edge.tangent, width);
  const center = along(a, edge.tangent, width / 2), bottomStart = along(a, edge.normal, depth), bottomEnd = along(b, edge.normal, depth);
  const outside = Math.max(0.05, width * 0.02);
  return { a, b, center, bottomStart, bottomEnd, origin, zero, target: along(edge.a, edge.tangent, targetAt), edge,
    outline: { closed: true, nodes: [along(a, edge.normal, -outside), along(b, edge.normal, -outside), bottomEnd, bottomStart] } };
}
