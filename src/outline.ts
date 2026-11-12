// Outer silhouette and bounded, selectable interior faces. Sources are never modified.
import ClipperLib from 'clipper-lib';
import { execute, Paths, SCALE } from './clip';
import { Obj, SubPath } from './model';
import { ShapeRegion, shapeRegions, regionContains } from './shapeRegions';
import { objectPaths } from './ops';
import { outlineNetwork, OUTLINE_JOIN_TOL, type OutlineNetwork } from './outlineNetwork';
import { outlineBoundary } from './outlineBoundary';
import { outlineApproximation } from './outlineApproximation';
import { validateContourTopology } from './contourTopology';

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

export type OutlineMode = 'outer' | 'combined' | 'islands';
export interface OutlinePlan {
  outer: SubPath[]; holes: ShapeRegion[]; looseEnds?: number;
  network?: OutlineNetwork; connections?: SubPath[];
  outerError?: boolean; islandErrors?: boolean[];
  approximationEligible?: boolean[];
  boundaryCache?: Map<string, SubPath>;
  boundaryFailures?: Map<string,{edges:OutlineNetwork['edges'];error:unknown}>;
}

function restoredBoundary(plan: OutlinePlan, polygon: ClipperLib.Path): SubPath {
  const key = polygon.map(p => `${p.X}:${p.Y}`).join('|'), cache = plan.boundaryCache!;
  let boundary = cache.get(key);
  if (!boundary) {
    const failure=plan.boundaryFailures?.get(key);
    if(failure?.edges===plan.network!.edges)throw failure.error;
    const connections: SubPath[]=[];
    try{boundary = outlineBoundary(polygon, plan.network!, connections);validateContourTopology([boundary]);}
    catch(error){const failures=plan.boundaryFailures??=new Map();if(failures.size<4096)failures.set(key,{edges:plan.network!.edges,error});throw error;}
    if(cache.size<4096)cache.set(key, boundary);
    for(const connection of connections) if(!plan.connections!.some(p=>JSON.stringify(p.nodes)===JSON.stringify(connection.nodes)||JSON.stringify([...p.nodes].reverse())===JSON.stringify(connection.nodes)))plan.connections!.push(connection);
  }
  return structuredClone(boundary);
}

/** Precision pipeline for independent contour extraction. Legacy offset recipes
 * keep their existing detection network and are not silently reinterpreted. */
export function preciseOutlinePlan(objects: Obj[], tolerance = OUTLINE_JOIN_TOL, allowEmpty = false): OutlinePlan {
  const network = outlineNetwork(objects, tolerance, true);
  const plan = outlinePlan(objects, tolerance, allowEmpty, network, true);
  plan.network = network;
  plan.boundaryCache = new Map();
  plan.boundaryFailures = new Map();
  plan.connections = network.paths.filter(p => p.connection).map(p => p.world!);
  // Keep ambiguous candidates visible but unavailable. One tiny ambiguous
  // island must not prevent extracting another independently proven boundary.
  const unresolved = (boundaries: SubPath[]) => {
    try { for (const boundary of boundaries) restoredBoundary(plan, paths([boundary])[0]); return false; }
    catch { return true; }
  };
  plan.outerError = unresolved(plan.outer);
  plan.islandErrors = plan.holes.map(h => unresolved(h.subs));
  plan.approximationEligible = plan.holes.map((h,i)=>!!plan.islandErrors?.[i]&&!!outlineApproximation(h));
  return plan;
}

export function outlinePlan(objects: Obj[], tolerance = OUTLINE_JOIN_TOL, allowEmpty = false, preparedNetwork?: OutlineNetwork, forceNetwork = false): OutlinePlan {
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.5) throw new Error('outline-tolerance');
  if (forceNetwork || objects.some(o => objectPaths(o).open.length)) {
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

export function outlineResult(plan: OutlinePlan, selected: ReadonlySet<number>, mode: OutlineMode = 'combined', approximateIslands: ReadonlySet<number> = new Set()): SubPath[] {
  if (!['outer', 'combined', 'islands'].includes(mode)) throw new Error('outline-selection');
  if ([...selected].some((i) => !Number.isInteger(i) || i < 0 || i >= plan.holes.length)) throw new Error('outline-selection');
  const approved:Paths=[];
  for(const i of approximateIslands){
    if(!Number.isInteger(i)||!selected.has(i)||!plan.islandErrors?.[i])throw new Error('outline-selection');
    const polygons=outlineApproximation(plan.holes[i]);
    if(!polygons)throw new Error('outline-approximation-unsafe');
    approved.push(...polygons);
  }
  if ((mode !== 'islands' && plan.outerError) || (mode !== 'outer' && [...selected].some(i => plan.islandErrors?.[i]&&!approximateIslands.has(i)))) throw new Error('outline-boundary');
  const restore = (polygons: Paths) => {
    const result=plan.network ? polygons.map(p => {
    try{return restoredBoundary(plan,p);}
    catch(error){
      // Only the expressly approved complete boundary may use the polygon.
      // Mixed/merged boundaries are NOT blanket-approved by a nearby island.
      if(mode==='outer'||!approved.some(q=>clip(C.ctXor,[p],[q]).length===0))throw error;
      if(!outlineApproximation({layer:0,subs:subs([p])}))throw new Error('outline-approximation-unsafe');
      return subs([p])[0];
    }
    }) : subs(polygons);
    // Validate the actual final collection too: individually simple boundaries
    // may touch/cross after a different combination of islands is restored.
    validateContourTopology(result);
    return result;
  };
  if (mode === 'outer' || !selected.size) return mode === 'islands' ? [] : restore(paths(plan.outer));
  // Precision-plan regions already have consistent outer/hole winding. Union
  // them once, rather than rebuilding the growing arrangement for every island.
  const holes = plan.network ? clip(C.ctUnion,[...selected].flatMap(i=>paths(plan.holes[i].subs)),[]) :
    [...selected].reduce((acc, i) => clip(C.ctUnion, acc, paths(plan.holes[i].subs)), [] as Paths);
  return restore(mode === 'islands' ? holes : clip(C.ctDifference, paths(plan.outer), holes));
}
