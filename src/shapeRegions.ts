// Bounded region decomposition for selectable outline faces, using existing Clipper.
import ClipperLib from 'clipper-lib';
import { execute, Paths, SCALE } from './clip';
import { homeLayer, Obj, SubPath } from './model';
import { region } from './ops';
export interface ShapeRegion { subs: SubPath[]; layer: number }
const { ClipType: C, PolyFillType: F, Clipper } = ClipperLib;
const clip = (op: ClipperLib.ClipType, a: Paths, b: Paths) => execute(op, a, b, F.pftNonZero);
const pathsOf = (subs: SubPath[]): Paths => subs.map((s) => s.nodes.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));

function components(paths: Paths): SubPath[][] {
  const normalized = clip(C.ctUnion, paths, []), outer = normalized.filter((p) => Clipper.Orientation(p));
  const groups = outer.map((p) => [p]);
  for (const hole of normalized.filter((p) => !Clipper.Orientation(p))) {
    let index = -1, area = Infinity;
    outer.forEach((p, i) => {
      const a = Math.abs(Clipper.Area(p));
      if (a < area && Clipper.PointInPolygon(hole[0], p) !== 0) { index = i; area = a; }
    });
    if (index >= 0) groups[index].push(hole);
  }
  return groups.map((group) => group.map((p) => ({ closed: true, nodes: p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })) })));
}

/** Every overlap becomes a separate face. Inputs are ordered back to front. */
export function shapeRegions(objects: Obj[]): ShapeRegion[] {
  if (!objects.length || objects.length > 32) throw new Error('shape-builder-budget');
  const regions = objects.map(region);
  if (regions.flat(2).length > 20000) throw new Error('shape-builder-budget');
  let faces: ShapeRegion[] = [], covered: Paths = [];
  regions.forEach((r, i) => {
    const next: ShapeRegion[] = [];
    for (const f of faces) {
      for (const subs of components(clip(C.ctDifference, pathsOf(f.subs), r))) next.push({ subs, layer: f.layer });
      for (const subs of components(clip(C.ctIntersection, pathsOf(f.subs), r))) next.push({ subs, layer: homeLayer(objects[i]) });
    }
    for (const subs of components(clip(C.ctDifference, r, covered))) next.push({ subs, layer: homeLayer(objects[i]) });
    if (next.length > 2048 || next.reduce((n, f) => n + f.subs.reduce((s, p) => s + p.nodes.length, 0), 0) > 50000)
      throw new Error('shape-builder-budget');
    faces = next; covered = clip(C.ctUnion, covered, r);
  });
  return faces;
}

/** Inclusive boundary hit; holes toggle parity instead of becoming clickable fill. */
export function regionContains(face: ShapeRegion, x: number, y: number): boolean {
  let inside = false;
  for (const p of pathsOf(face.subs)) {
    const hit = Clipper.PointInPolygon({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }, p);
    if (hit === -1) return true;
    if (hit === 1) inside = !inside;
  }
  return inside;
}
