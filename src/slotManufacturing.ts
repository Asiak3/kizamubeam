// Local cutter geometry only; no layer kerf correction or machine/toolpath generation.
import ClipperLib from 'clipper-lib';
import { execute, SCALE } from './clip';
import { t } from './i18n';
import type { Pt, SubPath } from './model';
import type { ProjectionFrame } from './straightSlots';

export interface SlotManufacturing { burn: number; cornerStyle: 'corner' | 'loop' | 'backarc' | 'diagonal' }

/**
 * Positive burn is approximately half the kerf: move both walls inward by burn
 * and the bottom outward (towards the mouth) by burn. Projection datums are not
 * changed. The caller must prohibit simultaneous nonzero layer kerf correction.
 *
 * `loop` is a geometric relief approximation: union a round lobe at EACH nominal
 * bottom corner. The closed polygon cutter cannot encode a retraced, continuous
 * machining loop and is not an exact Boxes.py toolpath. The profile is
 * independently constructed. Relief radii are bounded by 1.5*burn + extra.
 *
 * `backarc` follows the Boxes.py meaning ("naive implementation with inverted
 * arcs connecting the straight lines"): at each bottom corner the inset wall is
 * extended by burn past the inset corner and rounded back to the inset bottom
 * edge with a quarter arc of radius burn. These inverted arcs reverse direction
 * at their ends; the wall extensions cross at the inset corner. Each nub has
 * area (1 - pi/4)*burn^2 and touches the rectangle at that corner. With
 * burn 0 it degenerates to the sharp corner. Boolean relief is sampled on a
 * local 0.001 mm grid; lobes are deliberately not curve-refitted (which could
 * erase a small relief).
 */
export function manufacturedSlotPaths(frame: ProjectionFrame, options: SlotManufacturing): SubPath[] {
  const invalid = () => new Error(t('Ungültige Schlitzmaße oder Korrekturwerte.'));
  const { burn, cornerStyle } = options;
  const { tangent: u, normal: v } = frame.edge;
  const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!Number.isFinite(burn) || burn < 0 || !['corner', 'loop', 'backarc', 'diagonal'].includes(cornerStyle)
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
  if ((cornerStyle === 'backarc' || cornerStyle === 'diagonal') && burn === 0)
    return validate([{ ...frame.outline, nodes: frame.outline.nodes.map(p => ({ ...p })) }]);
  if (cornerStyle === 'backarc') {
    // Inverted arcs per Boxes.py corner(): each inset wall is extended by burn
    // past the inset corner and rounded back to the inset bottom edge with a
    // quarter arc of radius burn. Keep the exact orthogonal wall extensions:
    // adding an overlap tab would introduce artificial diagonal cut edges.
    if (burn * SCALE < 2) return validate([{ closed: true, nodes: rectangle.map(world) }]);
    const nub = (outerX: number, dir: 1 | -1): Pt[] => {
      const start = dir === 1 ? 0 : Math.PI, segments = 64;
      const pts: Pt[] = [{ x: outerX + dir * burn, y: depth - burn },
        { x: outerX + dir * burn, y: depth }];
      for (let i = 1; i < segments; i++) {
        const a = start - dir * (i / segments) * (Math.PI / 2);
        pts.push({ x: outerX + burn * Math.cos(a), y: depth + burn * Math.sin(a) });
      }
      pts.push({ x: outerX, y: depth - burn });
      return pts;
    };
    const polygons = [rectangle, nub(0, 1), nub(width, -1)].map(points =>
      points.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
    // Avoid Clipper's integer range limit before invoking its implementation.
    if (polygons.some(p => p.some(q => !Number.isSafeInteger(q.X) || !Number.isSafeInteger(q.Y) || Math.abs(q.X) > 1e12 || Math.abs(q.Y) > 1e12))) throw invalid();
    const paths = execute(ClipperLib.ClipType.ctUnion, polygons, [], ClipperLib.PolyFillType.pftNonZero);
    return validate(paths.map(path => ({ closed: true, nodes: path.map(p => world({ x: p.X / SCALE, y: p.Y / SCALE })) })));
  }
  if (cornerStyle === 'diagonal') {
    // A flat-ended channel along each corner's outward bisector, width 2*burn.
    // Its end centre is the nominal corner; the inner end overlaps the cutter
    // by burn so there are no point contacts or disconnected sliver contours.
    const h = burn * Math.SQRT1_2;
    const channels = [0, width].map((x, i) => {
      const dir = i === 0 ? 1 : -1;
      const end = { x, y: depth };
      const start = { x: x + dir * (burn + h), y: depth - burn - h };
      const points = [{ x: start.x - dir * h, y: start.y - h }, { x: end.x - dir * h, y: end.y - h },
        { x: end.x + dir * h, y: end.y + h }, { x: start.x + dir * h, y: start.y + h }];
      return i === 0 ? points.reverse() : points;
    });
    const polygons = [rectangle, ...channels].map(points => points.map(p =>
      ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
    if (polygons.some(p => p.some(q => !Number.isSafeInteger(q.X) || !Number.isSafeInteger(q.Y) || Math.abs(q.X) > 1e12 || Math.abs(q.Y) > 1e12))) throw invalid();
    return validate(execute(ClipperLib.ClipType.ctUnion, polygons, [], ClipperLib.PolyFillType.pftNonZero)
      .map(path => ({ closed: true, nodes: path.map(p => world({ x: p.X / SCALE, y: p.Y / SCALE })) })));
  }
  const extra = Math.min(0.05, width / 8, depth / 8);
  const rx = 1.5 * burn + extra;
  const ry = 1.5 * burn + extra;
  const polygons = [rectangle, ...[0, width].map(x => Array.from({ length: 48 }, (_, i) => {
    const angle = 2 * Math.PI * i / 48;
    return { x: x + rx * Math.cos(angle), y: depth + ry * Math.sin(angle) };
  }))].map(points => points.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
  // Avoid Clipper's integer range limit before invoking its implementation.
  if (polygons.some(p => p.some(q => !Number.isSafeInteger(q.X) || !Number.isSafeInteger(q.Y) || Math.abs(q.X) > 1e12 || Math.abs(q.Y) > 1e12))) throw invalid();
  const paths = execute(ClipperLib.ClipType.ctUnion, polygons, [], ClipperLib.PolyFillType.pftNonZero);
  return validate(paths.map(path => ({ closed: true, nodes: path.map(p => world({ x: p.X / SCALE, y: p.Y / SCALE })) })));
}
