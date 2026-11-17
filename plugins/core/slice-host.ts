// Stand-in for src/model3d/slice inside the 3D-model generators built as plugins (stack, ribs): slicing and area
// operations run in the app through the host functions `slice` and `region`, at the speed of the built-in
// generators, instead of Clipper in QuickJS. Same functions and results as slice.ts; an area is the host's form
// (closed polygons [x0, y0, x1, y1, …] in mm), which the generators only pass on and test for emptiness.
import type { Pt } from '../../src/model';
import type { Mesh } from '../../src/model3d/mesh';
import { meshIdOf } from '../../src/model3d/store';

export { inside, intervalsAtX, intervalsInBand, regionArea } from '../../src/model3d/polys';

export type V3 = [number, number, number];
export const SCALE = 1000;
type Region = number[][];
interface HostPrepared {
  model: string;
  up: string;
  size: number;
  frame: { u: V3; v: V3; w: V3 };
  min: V3;
  max: V3;
}
export type Prepared = HostPrepared;
export interface SliceResult {
  loops: Pt[][];
  open: number;
  oriented: boolean;
  region: Region;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const host = () => (globalThis as any).host as { slice(x: unknown): any; region(x: unknown): any };
const pts = (flat: number[]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i], y: flat[i + 1] });
  return out;
};
const flat = (p: Pt[]) => p.flatMap((q) => [q.x, q.y]);

export function prepare(): never {
  throw new Error('prepare: use prepareFit in plugins');
}

export function prepareFit(mesh: Mesh, up: string, size: number, frame: { u: V3; v: V3; w: V3 }): Prepared {
  const model = meshIdOf(mesh);
  if (!model) throw new Error('model not registered');
  const r = host().slice({ model, up, size, frame, heights: [] });
  return { model, up, size, frame, min: r.min, max: r.max };
}

export function sliceAt(P: Prepared, h: number, gap = 0.5): SliceResult {
  const r = host().slice({ model: P.model, up: P.up, size: P.size, frame: P.frame, heights: [h], gap }).layers[0];
  return { loops: [], open: r.open, oriented: true, region: r.region };
}

export const sliceRegion = (s: SliceResult): Region => s.region;
export const region = (loops: Pt[][]): Region => host().region({ op: 'loops', loops: loops.map(flat) });
export const unionRegions = (a: Region, b: Region): Region => host().region({ op: 'union', a, b });
export const intersectRegions = (a: Region, b: Region): Region => host().region({ op: 'intersection', a, b });
export const subtractRegions = (a: Region, b: Region): Region => (b.length ? host().region({ op: 'difference', a, b }) : a);
export const intersect = (a: Region, b: Region): Region => (a.length && b.length ? intersectRegions(a, b) : []);
export const offsetRegion = (a: Region, d: number): Region => (d ? host().region({ op: 'offset', a, delta: d }) : a);
export function cleanRegion(a: Region, minArea: number): { polys: Pt[][]; islands: number } {
  if (!a.length) return { polys: [], islands: 0 };
  const r = host().region({ op: 'clean', a, minArea });
  return { polys: r.polys.map(pts), islands: r.islands };
}
export const regionIslands = (a: Region, minArea: number): Pt[][][] =>
  a.length ? (host().region({ op: 'islands', a, minArea }) as number[][][]).map((isl) => isl.map(pts)) : [];
export const polyRegion = (p: Pt[]): Region => [p.flatMap((q) => [Math.round(q.x * SCALE) / SCALE, Math.round(q.y * SCALE) / SCALE])];
export function circleRegion(c: Pt, r: number, n = 32): Region {
  const p: Pt[] = [];
  for (let i = 0; i < n; i++) p.push({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) });
  return polyRegion(p);
}
export const capsuleRegion = (line: Pt[], r: number): Region => host().region({ op: 'band', line: flat(line), radius: r });
export function deepestPoint(polys: Pt[][]): { p: Pt; r: number } | null {
  const d = host().region({ op: 'deepest', polys: polys.map(flat) });
  return d && { p: { x: d.p[0], y: d.p[1] }, r: d.r };
}
