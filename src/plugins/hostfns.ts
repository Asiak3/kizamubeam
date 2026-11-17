// Host functions (#211 stage 5): building blocks of the app a plugin may call while it computes, instead of
// bundling its own: boolean operations and offsets of outlines (Clipper), fitting Bézier curves through points and
// tracing a grayscale image, slicing a 3D model and area operations on slices. Pure computation on the data the
// plugin hands over (and the 3D models the app gave it as resources); no editor or files. fetch (#280) answers only
// with data the app fetched for the plugin from a server its manifest declares; the Worker itself has no network.
// A plugin names the ones it uses in its manifest (`host`); `progress` is always there.
// Runs inside the plugin Worker (and in Node tests); each call counts toward the time limit of the plugin call.
import ClipperLib from 'clipper-lib';
import type { Pt, SubPath } from '../model';
import { IDENT } from '../mat';
import { execute, FLATTEN_TOL, flattenSub, pathsToSubs, SCALE, type Paths } from '../clip';
import { fitPolyline } from '../fit';
import { traceGray } from '../trace';
import { checkSubPaths, fromBase64, LIMITS } from './contract';
import type { Mesh } from '../model3d/mesh';
import { readMeshData } from '../model3d/meshData';
import {
  capsuleRegion, cleanRegion, intersectRegions, offsetRegion, prepare, region, regionIslands, sliceAt, sliceRegion, subtractRegions, unionRegions,
  type Prepared, type V3,
} from '../model3d/slice';
import { worldOf } from '../model3d/world';
import { deepestPoint } from '../model3d/polys';
import { nestParts } from '../generators/build';

/** Host functions a manifest may ask for */
export const HOST_FNS = ['boolean', 'offset', 'fit', 'trace', 'slice', 'region', 'nest', 'fetch', 'context'] as const;
export type HostFn = (typeof HOST_FNS)[number];

/** A host function got input it cannot use; the plugin call fails with this code unless the plugin catches it */
export class HostError extends Error {
  constructor(detail: string) {
    super(`host-bad-input: ${detail}`);
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const bad = (what: string): never => {
  throw new HostError(what);
};
const num = (v: unknown, what: string, min = -LIMITS.range, max = LIMITS.range) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : bad(what));
const subsOf = (v: unknown, what: string): SubPath[] => {
  try {
    return checkSubPaths(v, what);
  } catch {
    return bad(what);
  }
};
const flat = (subs: SubPath[]): Paths => subs.filter((s) => s.nodes.length >= 2).map((s) => flattenSub(s, IDENT));
const { ClipType, PolyFillType, ClipperOffset, JoinType, EndType } = ClipperLib;

const OPS: Record<string, ClipperLib.ClipType> = { union: ClipType.ctUnion, difference: ClipType.ctDifference, intersection: ClipType.ctIntersection, xor: ClipType.ctXor };

/** { op: union | difference | intersection | xor, a: sub-paths, b: sub-paths } → closed sub-paths (Bézier curves) */
function boolean(input: unknown): SubPath[] {
  if (!isObj(input)) return bad('boolean');
  const op = OPS[String(input.op)] ?? bad('op');
  const a = flat(subsOf(input.a, 'a'));
  const b = flat(subsOf(input.b ?? [], 'b'));
  // Holes by even-odd within each side, like the editor's boolean operations on several objects
  const norm = (p: Paths) => (p.length ? execute(ClipType.ctUnion, p, [], PolyFillType.pftEvenOdd) : p);
  return pathsToSubs(execute(op, norm(a), norm(b), PolyFillType.pftNonZero));
}

/**
 * { subs, delta (mm, negative = inward), join?: round | miter | square } → closed sub-paths. Open sub-paths get a
 * band of width 2 × |delta| around them.
 */
function offset(input: unknown): SubPath[] {
  if (!isObj(input)) return bad('offset');
  const subs = subsOf(input.subs, 'subs');
  const delta = num(input.delta, 'delta', -1000, 1000);
  const join = input.join === 'miter' ? JoinType.jtMiter : input.join === 'square' ? JoinType.jtSquare : JoinType.jtRound;
  const co = new ClipperOffset(4, (FLATTEN_TOL / 4) * SCALE);
  const closed = subs.filter((s) => s.closed && s.nodes.length >= 3);
  const open = subs.filter((s) => !s.closed && s.nodes.length >= 2);
  if (closed.length) co.AddPaths(execute(ClipType.ctUnion, flat(closed), [], PolyFillType.pftEvenOdd), join, EndType.etClosedPolygon);
  if (open.length) co.AddPaths(flat(open), join, join === JoinType.jtRound ? EndType.etOpenRound : EndType.etOpenButt);
  const out: Paths = [];
  co.Execute(out, (open.length && !closed.length ? Math.abs(delta) : delta) * SCALE);
  return pathsToSubs(out);
}

/** { pts: [[x, y], …], closed?, tolerance? (mm, default 0.05) } → one sub-path of Bézier curves through the points */
function fit(input: unknown): SubPath {
  if (!isObj(input) || !Array.isArray(input.pts) || input.pts.length < 2 || input.pts.length > LIMITS.nodes) return bad('fit');
  const pts: Pt[] = input.pts.map((q) => (Array.isArray(q) && q.length === 2 ? { x: num(q[0], 'pts'), y: num(q[1], 'pts') } : bad('pts')));
  const tol = input.tolerance === undefined ? 0.05 : num(input.tolerance, 'tolerance', 0.001, 100);
  return fitPolyline(pts, input.closed === true, tol);
}

/**
 * { width, height, data (one gray byte per pixel, base64), threshold? 0 … 255 (128), smooth? 0 … 1 (0.5),
 * ignoreLess? (pixels², 4), scale? (mm per pixel, 1) } → closed outlines of the dark areas, in mm from the top left
 */
function trace(input: unknown): SubPath[] {
  if (!isObj(input)) return bad('trace');
  const w = num(input.width, 'width', 1, 4000), h = num(input.height, 'height', 1, 4000);
  if (!Number.isInteger(w) || !Number.isInteger(h) || typeof input.data !== 'string') return bad('trace');
  const bytes = fromBase64(input.data);
  if (bytes.length !== w * h) return bad('data must have width × height bytes');
  const g = Float32Array.from(bytes);
  const k = input.scale === undefined ? 1 : num(input.scale, 'scale', 1e-4, 1000);
  const out = traceGray(g, w, h, {
    threshold: input.threshold === undefined ? 128 : num(input.threshold, 'threshold', 0, 255),
    smooth: input.smooth === undefined ? 0.5 : num(input.smooth, 'smooth', 0, 1),
    ignoreLess: input.ignoreLess === undefined ? 4 : num(input.ignoreLess, 'ignoreLess', 0, 1e9),
  });
  if (k === 1) return out;
  const s = (q: Pt) => ({ x: q.x * k, y: q.y * k });
  return out.map((sp) => ({ ...sp, nodes: sp.nodes.map((n) => ({ ...n, ...s(n), ...(n.cin ? { cin: s(n.cin) } : {}), ...(n.cout ? { cout: s(n.cout) } : {}) })) }));
}

/**
 * { parts: [{ key, subs }], gap (mm) } → [[x, y], …]: where each part goes in a compact, tidy arrangement without
 * rotation (the generators' "nested" part layout), in the order given. Each part's outlines lie around its own
 * origin; the positions move them so the arrangement is centred on the origin. Same parts give the same result.
 */
function nest(input: unknown): [number, number][] {
  if (!isObj(input) || !Array.isArray(input.parts) || input.parts.length > 5000) return bad('nest');
  const gap = num(input.gap, 'gap', 0, 1000);
  const parts = input.parts.map((p, i) => (isObj(p) ? { key: typeof p.key === 'string' ? p.key : String(i), subs: subsOf(p.subs, 'parts.subs') } : bad('parts')));
  return nestParts(parts, gap).map((p) => [p.at.x, p.at.y]);
}

// ---------- Slicing 3D models and areas (the 3D-model generators: stack, ribs) ----------
// An area ("region") is a list of closed polygons, each [x0, y0, x1, y1, …] in mm, filled by the nonzero rule.
// Points are kept on a 1 µm grid, as the app's own slicing does, so plugin and app give the same results.

type IntPath = { X: number; Y: number }[];
const MAX_COORDS = 4_000_000;
const regionIn = (v: unknown, what: string): IntPath[] => {
  if (!Array.isArray(v)) return bad(what);
  let n = 0;
  return v.map((poly) => {
    if (!Array.isArray(poly) || poly.length % 2) return bad(what);
    if ((n += poly.length) > MAX_COORDS) return bad(`${what}: too many points`);
    const out: IntPath = [];
    for (let i = 0; i < poly.length; i += 2) out.push({ X: Math.round(num(poly[i], what) * 1000), Y: Math.round(num(poly[i + 1], what) * 1000) });
    return out;
  });
};
const flatOf = (pts: { x: number; y: number }[]) => pts.flatMap((q) => [q.x, q.y]);
const regionOut = (paths: IntPath[]): number[][] => paths.map((p) => p.flatMap((q) => [q.X / 1000, q.Y / 1000]));
const ptsIn = (v: unknown, what: string): Pt[] => {
  if (!Array.isArray(v) || v.length % 2 || v.length > MAX_COORDS) return bad(what);
  const out: Pt[] = [];
  for (let i = 0; i < v.length; i += 2) out.push({ x: num(v[i], what), y: num(v[i + 1], what) });
  return out;
};
const v3 = (v: unknown, what: string): V3 => (Array.isArray(v) && v.length === 3 ? [num(v[0], what, -1e6, 1e6), num(v[1], what, -1e6, 1e6), num(v[2], what, -1e6, 1e6)] : bad(what));
const FRAME_Z = { u: [1, 0, 0] as V3, v: [0, 1, 0] as V3, w: [0, 0, 1] as V3 };

/** 3D models the app handed to the plugin (resources) and slicing prepared on them, per engine */
interface SliceState {
  meshes: Map<string, Mesh>;
  prepared: Map<string, Prepared>;
}
const MAX_MESHES = 8;

/**
 * { model (id of a 3D model the plugin got as a resource), up?: z | y, size? (mm of the longest side: upright,
 * scaled and centred over the origin with the bottom at 0, as the 3D-model generators place it; left out: model
 * units as they are), frame?: { u, v, w } (w = slicing direction, default x, y, z), heights: [h, …] (along w),
 * gap? (mm, 0.5: open chains with ends closer than this are closed) } → { min, max (bounds in the frame),
 * layers: [{ region, open (chains that stayed open: holes in the mesh) }] }
 */
function slice(st: SliceState, input: unknown) {
  if (!isObj(input)) return bad('slice');
  const mesh = st.meshes.get(String(input.model)) ?? bad('model: not a 3D model given to this plugin');
  const up = input.up === undefined ? 'z' : input.up === 'y' || input.up === 'z' ? input.up : bad('up');
  const size = input.size === undefined ? null : num(input.size, 'size', 1e-3, LIMITS.range);
  const f = input.frame === undefined ? FRAME_Z : isObj(input.frame) ? { u: v3(input.frame.u, 'frame.u'), v: v3(input.frame.v, 'frame.v'), w: v3(input.frame.w, 'frame.w') } : bad('frame');
  const heights = Array.isArray(input.heights) && input.heights.length <= 10_000 ? input.heights.map((h) => num(h, 'heights')) : bad('heights');
  const gap = input.gap === undefined ? 0.5 : num(input.gap, 'gap', 0, 1000);
  const key = [input.model, up, size, ...f.u, ...f.v, ...f.w].join('|');
  let P = st.prepared.get(key);
  if (!P) {
    if (st.prepared.size >= 64) st.prepared.clear();
    const world = size === null ? (x: number, y: number, z: number): V3 => [x, y, z] : worldOf(mesh, up, size).world;
    P = prepare(mesh, world, f);
    st.prepared.set(key, P);
  }
  return {
    min: P.min,
    max: P.max,
    layers: heights.map((h) => {
      const s = sliceAt(P, h, gap);
      return { region: regionOut(sliceRegion(s)), open: s.open };
    }),
  };
}

/**
 * Area operations: { op, … } with
 * union { a, b? } · intersection { a, b } · difference { a, b } (a without b) · offset { a, delta (mm, round
 * corners, negative = inward) } · loops { loops: [[x0, y0, …], …] } (closed loops to an area by the even-odd rule) ·
 * band { line: [x0, y0, …], radius } (around an open line, round ends) → region;
 * clean { a, minArea } → { polys (outlines and holes), islands (count) } and islands { a, minArea } →
 * [[outline, hole, …], …], both without islands and holes smaller than minArea (mm²);
 * deepest { polys: [[x0, y0, …], …] } → { p: [x, y], r } (the inner point farthest from the edge, e.g. for a
 * label, even-odd) or null.
 */
function regionFn(input: unknown): unknown {
  if (!isObj(input)) return bad('region');
  const a = () => regionIn(input.a, 'a');
  const b = () => regionIn(input.b ?? [], 'b');
  const minArea = () => (input.minArea === undefined ? 0 : num(input.minArea, 'minArea', 0, 1e12));
  switch (input.op) {
    case 'union':
      return regionOut(unionRegions(a(), b()));
    case 'intersection':
      return regionOut(intersectRegions(a(), b()));
    case 'difference':
      return regionOut(subtractRegions(a(), b()));
    case 'offset':
      return regionOut(offsetRegion(a(), num(input.delta, 'delta', -1000, 1000)));
    case 'loops':
      return Array.isArray(input.loops) ? regionOut(region(input.loops.map((l) => ptsIn(l, 'loops')))) : bad('loops');
    case 'band':
      return regionOut(capsuleRegion(ptsIn(input.line, 'line'), num(input.radius, 'radius', 0, 1000)));
    case 'clean': {
      const r = cleanRegion(a(), minArea());
      return { polys: r.polys.map(flatOf), islands: r.islands };
    }
    case 'islands':
      return regionIslands(a(), minArea()).map((isl) => isl.map(flatOf));
    case 'deepest': {
      if (!Array.isArray(input.polys)) return bad('polys');
      const d = deepestPoint(input.polys.map((l) => ptsIn(l, 'polys')));
      return d && { p: [d.p.x, d.p.y], r: d.r };
    }
    default:
      return bad('op');
  }
}

/** Hand a resource to the host functions (a 3D model for slice); called before the plugin gets it */
function takeResource(st: SliceState, json: string) {
  let r: unknown;
  try {
    r = JSON.parse(json);
  } catch {
    return;
  }
  if (!isObj(r) || r.kind !== 'model3d' || typeof r.id !== 'string' || typeof r.data !== 'string' || st.meshes.has(r.id)) return;
  const m = readMeshData(r.data);
  if (typeof m === 'string') return;
  if (st.meshes.size >= MAX_MESHES) st.meshes.delete(st.meshes.keys().next().value!);
  st.meshes.set(r.id, m);
  for (const k of st.prepared.keys()) if (k.startsWith(r.id + '|')) st.prepared.delete(k);
}

/**
 * A data request of a plugin (#280): a server it declared (`network` in the manifest), a path below the server's
 * base and query values. The app builds the URL from them; the plugin never passes a URL.
 */
export interface NetRequest {
  host: string;
  path: string;
  query: Record<string, string>;
  method: 'GET' | 'POST';
  /** POST only: a form or query body as text (e.g. an Overpass query) */
  body?: string;
}

/** What host.fetch answers: HTTP status, content type (json, xml, text, png, mvt), text or base64 data, or an error code */
export interface NetResponse {
  status: number;
  type?: string;
  text?: string;
  data?: string;
  error?: string;
}

/** Responses an engine keeps for host.fetch, by request key */
const MAX_NET = 32;
const NET_PATH = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,500}$/;

/** Check a request of a plugin and give it a fixed shape (its key is the JSON of that shape) */
export function netRequest(input: unknown): NetRequest {
  if (!isObj(input)) return bad('fetch');
  const host = typeof input.host === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(input.host) ? input.host : bad('host');
  const path = typeof input.path === 'string' && NET_PATH.test(input.path) && !/(^|\/)\.\.?(\/|$)|\/\/|%2e|%2f|%5c/i.test(input.path) ? input.path : bad('path');
  const method = input.method === undefined || input.method === 'GET' ? 'GET' : input.method === 'POST' ? 'POST' : bad('method');
  const query: Record<string, string> = {};
  if (input.query !== undefined) {
    if (!isObj(input.query)) return bad('query');
    const keys = Object.keys(input.query).sort();
    if (keys.length > 40) return bad('query');
    for (const k of keys) {
      const v = input.query[k];
      if (!/^[A-Za-z0-9_.\-[\]]{1,60}$/.test(k) || !(typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)))) return bad('query');
      query[k] = String(v).slice(0, 2000);
    }
  }
  const out: NetRequest = { host, path, query, method };
  if (input.body !== undefined) {
    if (method !== 'POST' || typeof input.body !== 'string' || input.body.length > 100_000) return bad('body');
    out.body = input.body;
  }
  return out;
}
export const netKey = (r: NetRequest) => JSON.stringify([r.host, r.method, r.path, r.query, r.body ?? null]);

/**
 * host.fetch: the response if the app already fetched it for this engine; otherwise the request goes to the app
 * (onWant) and the call fails with net-pending; the app fetches it and computes again.
 */
function fetchFn(net: Map<string, NetResponse>, input: unknown, onWant?: (r: NetRequest) => void): NetResponse {
  const req = netRequest(input);
  const hit = net.get(netKey(req));
  if (hit) return hit;
  onWant?.(req);
  throw new NetPending();
}

/**
 * host.context (#386): context the app handed over as a resource of kind context (only what the manifest declares,
 * sent before every computation). Unknown or undeclared names are a bad input.
 */
function contextFn(ctx: Map<string, unknown>, input: unknown): unknown {
  if (typeof input !== 'string' || !ctx.has(input)) throw new HostError('context');
  return ctx.get(input);
}

/** The data is on its way: the plugin call fails with this code and is repeated when it arrived */
export class NetPending extends Error {
  constructor() {
    super('net-pending');
  }
}

/**
 * Calls of one engine: the functions its manifest allows, and progress reports (a number 0 … 1, optionally with a
 * short text) passed to `onProgress`. Answers are JSON envelopes like plugin calls. `resource` takes the resources
 * the app hands to the plugin (only kept when the plugin may slice).
 */
export function hostCaller(allowed: readonly string[], onProgress?: (done: number, text?: string) => void, onWant?: (r: NetRequest) => void) {
  const ok = new Set(allowed.filter((x): x is HostFn => (HOST_FNS as readonly string[]).includes(x)));
  const st: SliceState = { meshes: new Map(), prepared: new Map() };
  const net = new Map<string, NetResponse>();
  const ctx = new Map<string, unknown>();
  const FNS: Record<HostFn, (input: unknown) => unknown> = { boolean, offset, fit, trace, slice: (x) => slice(st, x), region: regionFn, nest, fetch: (x) => fetchFn(net, x, onWant), context: (x) => contextFn(ctx, x) };
  const call = (name: string, json: string): string => {
    try {
      if (name === 'progress') {
        const v = JSON.parse(json) as unknown;
        const done = typeof v === 'number' ? v : isObj(v) ? v.done : NaN;
        if (typeof done === 'number' && Number.isFinite(done)) onProgress?.(Math.max(0, Math.min(1, done)), isObj(v) && typeof v.text === 'string' ? v.text.slice(0, 200) : undefined);
        return JSON.stringify({ ok: null });
      }
      if (!ok.has(name as HostFn)) return JSON.stringify({ error: 'host-not-allowed' });
      if (json.length > LIMITS.outputBytes) return JSON.stringify({ error: 'host-bad-input' });
      return JSON.stringify({ ok: FNS[name as HostFn](JSON.parse(json)) });
    } catch (e) {
      return JSON.stringify({ error: e instanceof NetPending ? 'net-pending' : e instanceof HostError || e instanceof SyntaxError ? 'host-bad-input' : 'host-failed' });
    }
  };
  /**
   * Hand a resource to the host functions: a 3D model for slice, a fetched response for fetch. Returns true for a
   * response, which is for the host only (the plugin's resource function does not get it).
   */
  const resource = (json: string): boolean => {
    if (ok.has('fetch') && json.startsWith('{"kind":"net"')) {
      try {
        const r = JSON.parse(json) as { id?: unknown; data?: unknown };
        if (typeof r.id === 'string' && typeof r.data === 'string') {
          net.delete(r.id);
          net.set(r.id, JSON.parse(r.data) as NetResponse);
          while (net.size > MAX_NET) net.delete(net.keys().next().value!);
        }
      } catch {
        // A broken response is the same as none: the plugin asks again
      }
      return true;
    }
    if (json.startsWith('{"kind":"context"')) {
      if (ok.has('context'))
        try {
          const r = JSON.parse(json) as { id?: unknown; data?: unknown };
          if (typeof r.id === 'string' && typeof r.data === 'string') ctx.set(r.id, JSON.parse(r.data));
        } catch {
          // Broken context is the same as none
        }
      return true;
    }
    if (ok.has('slice')) takeResource(st, json);
    return false;
  };
  return Object.assign(call, { resource });
}
