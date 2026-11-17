// Host functions (#211 stage 5): building blocks of the app a plugin may call while it computes, instead of
// bundling its own: boolean operations and offsets of outlines (Clipper), fitting Bézier curves through points and
// tracing a grayscale image. Pure computation on the data the plugin hands over; no editor, files or network.
// A plugin names the ones it uses in its manifest (`host`); `progress` is always there.
// Runs inside the plugin Worker (and in Node tests); each call counts toward the time limit of the plugin call.
import ClipperLib from 'clipper-lib';
import type { Pt, SubPath } from '../model';
import { IDENT } from '../mat';
import { execute, FLATTEN_TOL, flattenSub, pathsToSubs, SCALE, type Paths } from '../clip';
import { fitPolyline } from '../fit';
import { traceGray } from '../trace';
import { checkSubPaths, fromBase64, LIMITS } from './contract';

/** Host functions a manifest may ask for */
export const HOST_FNS = ['boolean', 'offset', 'fit', 'trace'] as const;
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

const FNS: Record<HostFn, (input: unknown) => unknown> = { boolean, offset, fit, trace };

/**
 * Calls of one engine: the functions its manifest allows, and progress reports (a number 0 … 1, optionally with a
 * short text) passed to `onProgress`. Answers are JSON envelopes like plugin calls.
 */
export function hostCaller(allowed: readonly string[], onProgress?: (done: number, text?: string) => void) {
  const ok = new Set(allowed.filter((x): x is HostFn => (HOST_FNS as readonly string[]).includes(x)));
  return (name: string, json: string): string => {
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
      return JSON.stringify({ error: e instanceof HostError || e instanceof SyntaxError ? 'host-bad-input' : 'host-failed' });
    }
  };
}
