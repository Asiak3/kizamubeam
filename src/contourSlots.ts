// Contour-following mouth construction on the existing 0.01 mm flattened geometry.
import ClipperLib from 'clipper-lib';
import { execute, flattenSub, SCALE } from './clip';
import { IDENT, Pt, SubPath } from './model';
import type { PlacedSlot } from './slotPlacement';
import { t } from './i18n';

export interface SlotAnchor {
  contour: number; fraction: number; reference: 'curve' | 'chord';
  position?: { x: number; y: number; distance: number; direction: 1 | -1 };
  relative?: { slotId: string; edge: 'start' | 'center' | 'end'; distance: number; direction: 1 | -1 };
}
interface Boundary { points: Pt[]; lengths: number[]; length: number }
const cache = new WeakMap<SubPath[], Boundary[]>();
const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const minus = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, n: Pt, d: number): Pt => ({ x: a.x + n.x * d, y: a.y + n.y * d });

function boundaries(base: SubPath[]): Boundary[] {
  const cached = cache.get(base);
  if (cached) return cached;
  const paths = base.map(s => flattenSub(s, IDENT));
  if (paths.reduce((n, p) => n + p.length, 0) > 50000) throw new Error(t('Arbeitsgrenze der Schlitzplatzierung erreicht.'));
  const normalized = execute(ClipperLib.ClipType.ctUnion, paths, [], ClipperLib.PolyFillType.pftEvenOdd);
  const result = normalized.map(path => {
    const points = path.map(p => ({ x: p.X / SCALE, y: p.Y / SCALE })), lengths = [0];
    points.forEach((p, i) => lengths.push(lengths[i] + distance(p, points[(i + 1) % points.length])));
    return { points, lengths, length: lengths[lengths.length - 1] };
  }).filter(b => b.length > 0.001);
  cache.set(base, result);
  return result;
}

function pointAt(b: Boundary, at: number): Pt {
  at = ((at % b.length) + b.length) % b.length;
  let lo = 0, hi = b.points.length;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b.lengths[mid] <= at) lo = mid; else hi = mid; }
  const a = b.points[lo], q = b.points[(lo + 1) % b.points.length];
  const f = (at - b.lengths[lo]) / (b.lengths[lo + 1] - b.lengths[lo]);
  return { x: a.x + (q.x - a.x) * f, y: a.y + (q.y - a.y) * f };
}

export function nearestSlotAnchor(base: SubPath[], p: Pt, maxDistance: number, reference: SlotAnchor['reference']): SlotAnchor | null {
  const candidates: { d: number; anchor: SlotAnchor }[] = [];
  boundaries(base).forEach((b, contour) => {
    let best = Infinity, at = 0;
    const local: {d:number;at:number}[]=[];
    b.points.forEach((a, i) => {
      const q = b.points[(i + 1) % b.points.length], d = minus(q, a), length = distance(a, q);
      if (!length) return;
      const f = Math.max(0, Math.min(1, dot(minus(p, a), d) / (length * length)));
      const projected = add(a, d, f), dist = distance(p, projected);
      if(dist<=maxDistance)local.push({d:dist,at:b.lengths[i]+f*length});
      if (dist < best) { best = dist; at = b.lengths[i] + f * length; }
    });
    const ambiguous=local.some(hit=>{const delta=Math.abs(hit.at-at);return hit.d-best<0.02&&Math.min(delta,b.length-delta)>Math.max(0.2,2*maxDistance);});
    if (best <= maxDistance) {
      candidates.push({ d: best, anchor: { contour, fraction: (at / b.length) % 1, reference } });
      if(ambiguous)candidates.push({d:best,anchor:{contour,fraction:(at/b.length)%1,reference}});
    }
  });
  candidates.sort((a, b) => a.d - b.d);
  // Equally close distinct boundaries are ambiguous; do not jump between them.
  if (!candidates.length || (candidates.length > 1 && candidates[1].d - candidates[0].d < 0.02)) return null;
  return candidates[0].anchor;
}

export function slotAnchorFromReference(base: SubPath[], p: Pt, distance: number, direction: 1 | -1, reference: SlotAnchor['reference']): SlotAnchor {
  if (![p.x, p.y, distance].every(Number.isFinite) || distance < 0 || ![1, -1].includes(direction)) throw new Error(t('Ungültige Positionsreferenz.'));
  const origin = nearestSlotAnchor(base, p, 0.1, reference);
  if (!origin) throw new Error(t('Die Positionsreferenz muss eindeutig auf der Kontur liegen.'));
  const boundary = boundaries(base)[origin.contour];
  if (distance >= boundary.length) throw new Error(t('Der Abstand muss kleiner als der Konturumfang sein.'));
  return { ...origin, fraction: (origin.fraction + direction * distance / boundary.length + 1) % 1,
    position: { x: p.x, y: p.y, distance, direction } };
}

export function slotContourPosition(base: SubPath[], anchor: SlotAnchor): Pt {
  if(anchor.position) anchor=slotAnchorFromReference(base,anchor.position,anchor.position.distance,anchor.position.direction,anchor.reference);
  const b = boundaries(base)[anchor.contour];
  if (!b) throw new Error(t('Ungültige Konturbindung.'));
  return pointAt(b, anchor.fraction * b.length);
}

export function guidedSlot(base: SubPath[], slot: PlacedSlot): { outline: SubPath; a: Pt; b: Pt; center: Pt; normal: Pt; curveOffset: number } {
  let anchor = slot.anchor;
  if (anchor?.position) {
    const p = anchor.position;
    anchor = slotAnchorFromReference(base, p, p.distance, p.direction, anchor.reference);
  }
  if (!anchor || !Number.isInteger(anchor.contour) || !Number.isFinite(anchor.fraction) || anchor.fraction < 0 || anchor.fraction >= 1 ||
    !['curve', 'chord'].includes(anchor.reference)) throw new Error(t('Ungültige Konturbindung.'));
  const boundary = boundaries(base)[anchor.contour];
  if (!boundary) throw new Error(t('Ungültige Konturbindung.'));
  const width = slot.width * slot.factor + slot.clearance, at = anchor.fraction * boundary.length;
  if (!Number.isFinite(width) || width < 0.05 || !Number.isFinite(slot.depth) || slot.depth <= 0) throw new Error(t('Ungültige Schlitzmaße oder Korrekturwerte.'));
  const ends = (half: number) => [pointAt(boundary, at - half), pointAt(boundary, at + half)];
  // Find the first local width crossing, never a distant second branch of the contour.
  let lo = 0, hi = Math.min(width / 2, boundary.length / 4);
  while (distance(...ends(hi) as [Pt, Pt]) < width && hi < boundary.length / 4) {
    lo = hi; hi = Math.min(hi * 1.25, boundary.length / 4);
  }
  if (distance(...ends(hi) as [Pt, Pt]) < width - 0.001) throw new Error(t('Ausklinkung passt hier nicht eindeutig an die Kontur.'));
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (distance(...ends(mid) as [Pt, Pt]) < width) lo = mid; else hi = mid;
  }
  const [a, b] = ends((lo + hi) / 2), tangent = { x: (b.x - a.x) / width, y: (b.y - a.y) / width };
  const normal = { x: -tangent.y, y: tangent.x }, center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const probe = Math.min(0.02, width / 20);
  const ta = minus(pointAt(boundary, at - hi + probe), pointAt(boundary, at - hi - probe));
  const tb = minus(pointAt(boundary, at + hi + probe), pointAt(boundary, at + hi - probe));
  if (dot(ta, tangent) / Math.hypot(ta.x, ta.y) < 0.3 || dot(tb, tangent) / Math.hypot(tb.x, tb.y) < 0.3)
    throw new Error(t('Ausklinkung passt hier nicht eindeutig an die Kontur.'));
  // Every local sample must progress along the mouth: refuse folds/cusps.
  let last = -Infinity, low = 0, high = 0;
  for (let i = 0; i <= 32; i++) {
    const p = pointAt(boundary, at - hi + 2 * hi * i / 32), relative = minus(p, center), along = dot(relative, tangent);
    if (along < last - 0.002) throw new Error(t('Ausklinkung passt hier nicht eindeutig an die Kontur.'));
    last = along; const inward = dot(relative, normal); low = Math.min(low, inward); high = Math.max(high, inward);
  }
  const hits: number[] = [];
  boundary.points.forEach((p, i) => {
    const edge = minus(boundary.points[(i + 1) % boundary.points.length], p), den = cross(normal, edge);
    if (Math.abs(den) < 1e-10) return;
    const rel = minus(p, center), u = cross(rel, edge) / den, v = cross(rel, normal) / den;
    if (v >= 0 && v <= 1 && u >= low - 0.02 && u <= high + 0.02 && !hits.some(x => Math.abs(x - u) < 0.002)) hits.push(u);
  });
  if (hits.length !== 1) throw new Error(t('Ausklinkung passt hier nicht eindeutig an die Kontur.'));
  const curveOffset = hits[0], bottom = slot.depth + (anchor.reference === 'curve' ? curveOffset : 0);
  if (bottom <= high + 0.002) throw new Error(t('Die Tiefe reicht an dieser Krümmung nicht bis hinter die Öffnung.'));
  // Continue outside past the curved lip so subtraction cannot leave a thin cap.
  const outside = Math.min(low, curveOffset, 0) - Math.max(0.05, width * 0.02);
  return { a, b, center, normal, curveOffset, outline: { closed: true, nodes: [add(a, normal, outside), add(b, normal, outside), add(b, normal, bottom), add(a, normal, bottom)] } };
}
