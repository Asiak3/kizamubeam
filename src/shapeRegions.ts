// Bounded region decomposition for selectable outline faces, using existing Clipper.
import ClipperLib from 'clipper-lib';
import { execute, Paths, SCALE } from './clip';
import { homeLayer, Obj, SubPath, IDENT } from './model';
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

export function mergeRegions(faces: ShapeRegion[]): SubPath[][] {
  return components(faces.reduce((paths, f) => clip(C.ctUnion, paths, pathsOf(f.subs)), [] as Paths));
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

/** Hit all regions crossed by a stroke, even when pointer events skip a narrow face. */
export function regionsAlong(faces: ShapeRegion[], a: { x: number; y: number }, b: { x: number; y: number }): number[] {
  const d = { x: b.x - a.x, y: b.y - a.y };
  return faces.flatMap((face, index) => {
    if (regionContains(face, a.x, a.y) || regionContains(face, b.x, b.y)) return [index];
    for (const sp of face.subs) for (let i = 0; i < sp.nodes.length; i++) {
      const p = sp.nodes[i], q = sp.nodes[(i + 1) % sp.nodes.length], e = { x: q.x - p.x, y: q.y - p.y };
      const cross = d.x * e.y - d.y * e.x;
      if (Math.abs(cross) < 1e-12) continue;
      const t = ((p.x - a.x) * e.y - (p.y - a.y) * e.x) / cross;
      const u = ((p.x - a.x) * d.y - (p.y - a.y) * d.x) / cross;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return [index];
    }
    return [];
  });
}

export const regionObject = (face: ShapeRegion, id: number): Obj => ({ id, m: [...IDENT], layer: face.layer,
  shape: { kind: 'path', subs: structuredClone(face.subs) } });
