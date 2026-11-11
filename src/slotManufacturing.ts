// Local cutter geometry only; no layer kerf correction or machine/toolpath generation.
import ClipperLib from 'clipper-lib';
import { execute, SCALE } from './clip';
import { t } from './i18n';
import type { Pt, SubPath } from './model';
import type { ProjectionFrame } from './straightSlots';

export interface SlotManufacturing { burn: number; cornerStyle: 'corner' | 'loop' | 'backarc' }

/**
 * Positive burn is approximately half the kerf: move both walls inward by burn
 * and the bottom outward (towards the mouth) by burn. Projection datums are not
 * changed. The caller must prohibit simultaneous nonzero layer kerf correction.
 *
 * `loop` and `backarc` are geometric relief approximations: union a round lobe
 * or a wider, shallower elliptical lobe at EACH nominal bottom corner. These
 * closed polygon cutters cannot encode retraced, continuous machining loops
 * and are not exact Boxes.py toolpaths. Profiles are independently constructed.
 * Relief radii are bounded by 2*burn + min(0.05, width/8, depth/8) mm.
 * Boolean relief is sampled at 48 points/lobe on a local 0.001 mm grid;
 * it is deliberately not curve-refitted (which could erase a small relief).
 */
export function manufacturedSlotPaths(frame: ProjectionFrame, options: SlotManufacturing): SubPath[] {
  const invalid = () => new Error(t('Ungültige Schlitzmaße oder Korrekturwerte.'));
  const { burn, cornerStyle } = options;
  const { tangent: u, normal: v } = frame.edge;
  const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!Number.isFinite(burn) || burn < 0 || !['corner', 'loop', 'backarc'].includes(cornerStyle)
    || ![frame.a, frame.b, frame.bottomStart, frame.bottomEnd, u, v].every(finite)) throw invalid();
  const local = (p: Pt): Pt => ({ x: (p.x - frame.a.x) * u.x + (p.y - frame.a.y) * u.y,
    y: (p.x - frame.a.x) * v.x + (p.y - frame.a.y) * v.y });
  const width = local(frame.b).x, depth = local(frame.bottomStart).y;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));
  if (!near(Math.hypot(u.x, u.y), 1) || !near(Math.hypot(v.x, v.y), 1) || !near(u.x * v.x + u.y * v.y, 0)
    || !Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0
    || !near(local(frame.b).y, 0) || !near(local(frame.bottomStart).x, 0)
    || !near(local(frame.bottomEnd).x, width) || !near(local(frame.bottomEnd).y, depth)
    || width - 2 * burn < 0.004 || depth - burn < 0.004) throw invalid();
  if (!frame.outline.closed || frame.outline.nodes.length !== 4 || frame.outline.nodes.some(p => !finite(p) || p.cin || p.cout)) throw invalid();
  const outside = -Math.min(...frame.outline.nodes.map(p => local(p).y));
  if (!Number.isFinite(outside) || outside <= 0) throw invalid();
  const world = (p: Pt): Pt => ({ x: frame.a.x + u.x * p.x + v.x * p.y, y: frame.a.y + u.y * p.x + v.y * p.y });
  const validate = (subs: SubPath[]) => {
    if (!subs.length || subs.length > 3) throw invalid();
    for (const sp of subs) {
      if (!sp.closed || sp.nodes.length < 3 || sp.nodes.length > 128) throw invalid();
      sp.nodes.forEach((p, i) => {
        const q = sp.nodes[(i + 1) % sp.nodes.length];
        if (!finite(p) || (p.x === q.x && p.y === q.y)) throw invalid();
      });
    }
    return subs;
  };
  if (burn === 0 && cornerStyle === 'corner')
    return validate([{ ...frame.outline, nodes: frame.outline.nodes.map(p => ({ ...p })) }]);
  const rectangle: Pt[] = [{ x: burn, y: -outside - burn }, { x: width - burn, y: -outside - burn },
    { x: width - burn, y: depth - burn }, { x: burn, y: depth - burn }];
  if (cornerStyle === 'corner') return validate([{ closed: true, nodes: rectangle.map(world) }]);
  const extra = Math.min(0.05, width / 8, depth / 8);
  const rx = (cornerStyle === 'loop' ? 1.5 : 2) * burn + extra;
  const ry = cornerStyle === 'loop' ? 1.5 * burn + extra : 1.25 * burn + 0.75 * extra;
  const polygons = [rectangle, ...[0, width].map(x => Array.from({ length: 48 }, (_, i) => {
    const angle = 2 * Math.PI * i / 48;
    return { x: x + rx * Math.cos(angle), y: depth + ry * Math.sin(angle) };
  }))].map(points => points.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
  // Avoid Clipper's integer range limit before invoking its implementation.
  if (polygons.some(p => p.some(q => !Number.isSafeInteger(q.X) || !Number.isSafeInteger(q.Y) || Math.abs(q.X) > 1e12 || Math.abs(q.Y) > 1e12))) throw invalid();
  const paths = execute(ClipperLib.ClipType.ctUnion, polygons, [], ClipperLib.PolyFillType.pftNonZero);
  return validate(paths.map(path => ({ closed: true, nodes: path.map(p => world({ x: p.X / SCALE, y: p.Y / SCALE })) })));
}
