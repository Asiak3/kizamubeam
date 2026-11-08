// Outer silhouette and bounded, selectable interior faces. Sources are never modified.
import ClipperLib from 'clipper-lib';
import { execute, Paths, SCALE } from './clip';
import { Obj, SubPath } from './model';
import { ShapeRegion, shapeRegions, regionContains } from './shapeRegions';
import { objectPaths } from './ops';
import { outlineNetwork, OUTLINE_JOIN_TOL, type OutlineNetwork } from './outlineNetwork';

const { Clipper, ClipType: C, PolyType, PolyFillType: F, PolyTree } = ClipperLib;
const clip = (op: ClipperLib.ClipType, a: Paths, b: Paths) => execute(op, a, b, F.pftNonZero);
const paths = (subs: SubPath[]): Paths => subs.map((s) => s.nodes.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
const subs = (ps: Paths): SubPath[] => ps.map((p) => ({ closed: true, nodes: p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })) }));

function treeOf(ps: Paths) {
  const c = new Clipper(), tree = new PolyTree();
  c.AddPaths(ps, PolyType.ptSubject, true);
  c.Execute(C.ctUnion, tree, F.pftNonZero, F.pftNonZero);
  return tree;
}

/** One connected area with its direct holes; nested islands are independent areas. */
function areas(ps: Paths): ShapeRegion[] {
  const out: ShapeRegion[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const outer of node.Childs()) {
      out.push({ layer: 0, subs: subs([outer.Contour(), ...outer.Childs().map((h) => h.Contour())]) });
      for (const hole of outer.Childs()) walk(hole);
    }
  };
  walk(treeOf(ps));
  return out;
}

export interface OutlinePlan { outer: SubPath[]; holes: ShapeRegion[]; looseEnds?: number }

export function outlinePlan(objects: Obj[], tolerance = OUTLINE_JOIN_TOL, allowEmpty = false, preparedNetwork?: OutlineNetwork): OutlinePlan {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) throw new Error('outline-tolerance');
  if (objects.some(o => objectPaths(o).open.length)) {
    if (!objects.length || objects.length > 32) throw new Error('shape-builder-budget');
    const network = preparedNetwork ?? outlineNetwork(objects, tolerance);
    if (!network.faces.length) {
      if (allowEmpty) return { outer: [], holes: [], looseEnds: network.looseEnds.length };
      throw new Error('outline-empty');
    }
    const material = clip(C.ctUnion, network.faces, []);
    const exterior = treeOf(material).Childs().map(n => n.Contour());
    // Disconnected nested cycles describe annular faces, not overlapping disks.
    let work = 0;
    const bounds = network.faces.map(p => ({
      x0: Math.min(...p.map(q => q.X)), x1: Math.max(...p.map(q => q.X)),
      y0: Math.min(...p.map(q => q.Y)), y1: Math.max(...p.map(q => q.Y)),
    }));
    const faces = network.faces.flatMap((p, i) => {
      const b = bounds[i];
      const nested = network.faces.filter((other, j) => {
        if (++work > 8000000) throw new Error('shape-builder-budget');
        const c = bounds[j];
        return c.x0 > b.x0 && c.x1 < b.x1 && c.y0 > b.y0 && c.y1 < b.y1 &&
          other.every(q => {
            if (++work > 8000000) throw new Error('shape-builder-budget');
            return Clipper.PointInPolygon(q, p) === 1;
          });
      });
      return areas(clip(C.ctDifference, [p], nested));
    });
    const holes = faces.filter(f => paths(f.subs).every(p => p.every(q =>
      exterior.some(outer => Clipper.PointInPolygon(q, outer) === 1))));
    return { outer: subs(exterior), holes, looseEnds: network.looseEnds.length };
  }
  const faces = shapeRegions(objects);
  if (!faces.length) throw new Error('outline-empty');
  const material = faces.reduce((acc, f) => clip(C.ctUnion, acc, paths(f.subs)), [] as Paths);
  // Only root boundaries: all enclosed holes and nested islands are initially filled.
  const exterior = treeOf(material).Childs().map((n) => n.Contour());
  const empty = areas(clip(C.ctDifference, exterior, material));
  // Also expose completely enclosed input faces, e.g. an independent inner rectangle
  // swallowed by a union. Faces sharing the exterior are not holes: no cut-out notches.
  const interior = faces.filter((f) => paths(f.subs).every((p) => p.every((q) =>
    exterior.some((outer) => Clipper.PointInPolygon(q, outer) === 1))));
  const holes = [...empty, ...interior];
  if (holes.length > 2048) throw new Error('shape-builder-budget');
  return { outer: subs(exterior), holes };
}

export function outlineHoleAt(plan: OutlinePlan, x: number, y: number): number {
  return plan.holes.findIndex((h) => regionContains(h, x, y));
}

export function outlineResult(plan: OutlinePlan, selected: ReadonlySet<number>): SubPath[] {
  if ([...selected].some((i) => !Number.isInteger(i) || i < 0 || i >= plan.holes.length)) throw new Error('outline-selection');
  if (!selected.size) return structuredClone(plan.outer);
  const holes = [...selected].reduce((acc, i) => clip(C.ctUnion, acc, paths(plan.holes[i].subs)), [] as Paths);
  return subs(clip(C.ctDifference, paths(plan.outer), holes));
}
