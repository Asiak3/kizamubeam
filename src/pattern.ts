// Pattern fill: repeat a tile of vectors seamlessly and fill a target shape with it (issue #245).
// The result is real vector geometry for decorating surfaces (engraving, scoring, cutting), not a layer fill.
//
// How the pattern is built:
// - The tile is placed on a lattice (two lattice vectors) with one or more placements per lattice cell; this
//   covers grid, brick, half drop, mirrored, rotated (pinwheel) and hexagonal repeats. Scale, rotation and offset
//   of the whole pattern sit on top.
// - “Wrap edges” on: motif parts beyond the tile frame stay and continue into the neighbouring tile, so any motif
//   is seamless. Off: the motif is cut exactly at the frame (rectangle, or hexagon for the hexagonal repeat).
// - Each placed tile is kept, cut at the target area (target shape minus margin and kept-free areas), dropped or
//   kept whole depending on the edge mode.
// - Lines: overlapping straight lines (shared edges of neighbouring tiles) are merged so nothing is lasered twice,
//   identical curve pieces are removed, and everything is chained into long paths. Small fragments at the edge
//   are dropped. Areas: closed motif shapes are united and cut at the target area, for fill layers.
// Curves stay Bézier curves: cuts split them exactly (de Casteljau); only the area mode refits polygons.
// No DOM, so it runs in the tests.
import ClipperLib from 'clipper-lib';
import { apply, IDENT, inv, Mat, mul, Node, Pt, rotate, scale as scaleMat, SubPath, translate } from './model';
import { flattenSub, FLATTEN_TOL, pathsToSubs, Paths, SCALE } from './clip';
import { bezierPt, segments } from './curves';
import { extract, joinSubs, piecesOf, Piece } from './pathtools';
import { dec, t, tn } from './i18n';
import type { Generator, Params, ParamSpec } from './generators/types';
import {
  DEFAULT_PATTERN_SETTINGS, edgeLabel, mirrorLabel, outputLabel, parseRecipe, PATTERN_EDGES, PATTERN_MIRRORS, PATTERN_OUTPUTS,
  PATTERN_REPEATS, PatternEdge, PatternError, PatternMirror, PatternOutput, PatternRecipe, PatternRepeat, PatternSettings, PatternTile, repeatLabel,
} from './patternFormat';

const { Clipper, ClipType, PolyType, PolyFillType, PolyTree, ClipperOffset, JoinType, EndType } = ClipperLib;

/** Most tile placements per pattern, so a tiny tile on a large shape cannot stall the app */
export const MAX_TILES = 20_000;
/** End points closer than this are joined (mm) */
const JOIN_TOL = 0.002;
/** Lines this close outside the target area still count as inside (mm) */
const EDGE_EPS = 0.005;

export interface PatternOptions extends PatternSettings {
  /** Shift of the pattern against the centre of the target shape (mm) */
  offsetX: number;
  offsetY: number;
  edge: PatternEdge;
  /** Distance of the pattern to the outline of the target shape and to kept-free areas (mm) */
  margin: number;
  /** Merge overlapping lines so nothing is lasered twice */
  dedupe: boolean;
  /** Pieces at the edge shorter than this are dropped (mm; area mode: smaller than this squared) */
  minFragment: number;
}

export const DEFAULT_PATTERN_OPTIONS: PatternOptions = {
  ...DEFAULT_PATTERN_SETTINGS, offsetX: 0, offsetY: 0, edge: 'clip', margin: 2, dedupe: true, minFragment: 0.5,
};

export interface PatternInput {
  tile: PatternTile;
  target: SubPath[];
  holes: SubPath[];
}

export interface PatternResult {
  subs: SubPath[];
  /** Placed tiles that contributed to the result */
  tiles: number;
  /** Total path length (mm) */
  length: number;
  /** Lines removed because they lay on top of others (mm) */
  removed: number;
  warnings: string[];
  error?: string;
}

// ---------- Small geometry helpers ----------

export function transformSubs(subs: SubPath[], m: Mat): SubPath[] {
  const T = (p: Pt) => apply(m, p.x, p.y);
  return subs.map((sp) => ({
    closed: sp.closed,
    nodes: sp.nodes.map((n): Node => {
      const q: Node = T(n);
      if (n.cin) q.cin = T(n.cin);
      if (n.cout) q.cout = T(n.cout);
      if (n.smooth) q.smooth = true;
      return q;
    }),
  }));
}

interface BBox { x0: number; y0: number; x1: number; y1: number }
const EMPTY_BOX = (): BBox => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
function addPt(b: BBox, p: Pt) {
  if (p.x < b.x0) b.x0 = p.x;
  if (p.y < b.y0) b.y0 = p.y;
  if (p.x > b.x1) b.x1 = p.x;
  if (p.y > b.y1) b.y1 = p.y;
}
/** Box around all nodes and handles (contains the curves) */
export function subsBox(subs: SubPath[], m: Mat = IDENT): BBox {
  const b = EMPTY_BOX();
  for (const sp of subs)
    for (const n of sp.nodes) {
      addPt(b, apply(m, n.x, n.y));
      if (n.cin) addPt(b, apply(m, n.cin.x, n.cin.y));
      if (n.cout) addPt(b, apply(m, n.cout.x, n.cout.y));
    }
  return b;
}
const boxCorners = (b: BBox): Pt[] => [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
function mapBox(b: BBox, m: Mat): BBox {
  const r = EMPTY_BOX();
  for (const p of boxCorners(b)) addPt(r, apply(m, p.x, p.y));
  return r;
}
const overlaps = (a: BBox, b: BBox) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

const piecePt = (p: Piece, t: number): Pt => (p.curve ? bezierPt(p.a, p.c1, p.c2, p.b, t) : { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t });

function pieceLength(p: Piece): number {
  if (!p.curve) return Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
  let len = 0;
  let q = p.a;
  for (let i = 1; i <= 16; i++) {
    const r = piecePt(p, i / 16);
    len += Math.hypot(r.x - q.x, r.y - q.y);
    q = r;
  }
  return len;
}
export const subLength = (sp: SubPath) => piecesOf(sp).reduce((s, p) => s + pieceLength(p), 0);

// ---------- Exact cut at a straight line (tile frame) ----------

/** Parameters t in (0, 1) where n·B(t) = c */
function lineRoots(p: Piece, nx: number, ny: number, c: number): number[] {
  const f = (q: Pt) => nx * q.x + ny * q.y - c;
  if (!p.curve) {
    const fa = f(p.a), fb = f(p.b);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) return [fa / (fa - fb)];
    return [];
  }
  const out: number[] = [];
  const N = 48;
  let t0 = 0, f0 = f(p.a);
  for (let i = 1; i <= N; i++) {
    const t1 = i / N, f1 = f(piecePt(p, t1));
    if ((f0 < 0 && f1 > 0) || (f0 > 0 && f1 < 0)) {
      let lo = t0, hi = t1, flo = f0;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2, fm = f(piecePt(p, mid));
        if ((fm < 0) === (flo < 0)) (lo = mid), (flo = fm);
        else hi = mid;
      }
      out.push((lo + hi) / 2);
    }
    t0 = t1;
    f0 = f1;
  }
  return out;
}

/** Keep the parts of the paths where nx·x + ny·y ≤ c, cut exactly */
function clipHalfPlane(subs: SubPath[], nx: number, ny: number, c: number): SubPath[] {
  const inside = (q: Pt) => nx * q.x + ny * q.y <= c + 1e-9;
  const out: SubPath[] = [];
  for (const sp of subs) {
    const ps = piecesOf(sp);
    if (!ps.length) continue;
    const n = ps.length;
    let cuts: number[] = [];
    ps.forEach((p, k) => {
      // a node exactly on the line is a cut point too (sign changes there are not seen inside a piece)
      if ((sp.closed || k > 0) && Math.abs(nx * p.a.x + ny * p.a.y - c) < 1e-9) cuts.push(k);
      for (const r of lineRoots(p, nx, ny, c)) if (r > 1e-9 && r < 1 - 1e-9) cuts.push(k + r);
    });
    cuts = cuts.sort((a, b) => a - b).filter((u, i, l) => !i || u - l[i - 1] > 1e-9);
    const at = (u: number) => {
      const k = Math.min(n - 1, Math.floor(u));
      return piecePt(ps[k], u - k);
    };
    if (!cuts.length) {
      if (inside(at(n / 2)) && inside(ps[0].a)) out.push(sp);
      continue;
    }
    if (sp.closed) {
      for (let i = 0; i < cuts.length; i++) {
        const u0 = cuts[i], u1 = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + n;
        const mid = (u0 + u1) / 2;
        if (inside(at(mid % n))) out.push(extract(sp, u0, u1 > n ? u1 - n : u1));
      }
    } else {
      const bounds = [0, ...cuts, n];
      for (let i = 0; i + 1 < bounds.length; i++) {
        const u0 = bounds[i], u1 = bounds[i + 1];
        if (u1 - u0 < 1e-9) continue;
        if (inside(at((u0 + u1) / 2))) out.push(extract(sp, u0, u1));
      }
    }
  }
  return out;
}

/** Cut paths at a convex polygon around the origin (the tile frame) */
function clipConvex(subs: SubPath[], poly: Pt[]): SubPath[] {
  let cur = subs;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    let nx = q.y - p.y, ny = -(q.x - p.x);
    let c = nx * p.x + ny * p.y;
    // the origin (centre of the frame) is inside
    if (c < 0) (nx = -nx), (ny = -ny), (c = -c);
    cur = clipHalfPlane(cur, nx, ny, c);
    if (!cur.length) break;
  }
  return cur;
}

// ---------- Lattice ----------

interface Lattice {
  a: Pt;
  b: Pt;
  /** Placements of the tile inside one lattice cell */
  cells: Mat[];
  /** Frame used to cut the motif when edges do not wrap (tile coordinates) */
  frame: Pt[];
}

export function patternLattice(tile: PatternTile, o: PatternSettings): Lattice | string {
  const { w, h } = tile;
  const W = w + o.gapX, H = h + o.gapY;
  const rect = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
  const small = t('Abstand zu klein: Die Kacheln würden zusammenfallen.');
  if (o.repeat === 'rotate') {
    const Q = Math.max(w, h) + o.gapX;
    if (Q < 0.01) return small;
    const R = (k: number, x: number, y: number) => mul(translate(x, y), rotate((k * Math.PI) / 2));
    return { a: { x: 2 * Q, y: 0 }, b: { x: 0, y: 2 * Q }, cells: [IDENT, R(1, Q, 0), R(2, Q, Q), R(3, 0, Q)], frame: rect };
  }
  if (W < 0.01 || H < 0.01) return small;
  switch (o.repeat) {
    case 'brick':
      return { a: { x: W, y: 0 }, b: { x: W * o.shift, y: H }, cells: [IDENT], frame: rect };
    case 'halfdrop':
      return { a: { x: W, y: H * o.shift }, b: { x: 0, y: H }, cells: [IDENT], frame: rect };
    case 'mirror': {
      const F = (sx: number, sy: number, x: number, y: number) => mul(translate(x, y), scaleMat(sx, sy));
      if (o.mirror === 'x') return { a: { x: 2 * W, y: 0 }, b: { x: 0, y: H }, cells: [IDENT, F(-1, 1, W, 0)], frame: rect };
      if (o.mirror === 'y') return { a: { x: W, y: 0 }, b: { x: 0, y: 2 * H }, cells: [IDENT, F(1, -1, 0, H)], frame: rect };
      return { a: { x: 2 * W, y: 0 }, b: { x: 0, y: 2 * H }, cells: [IDENT, F(-1, 1, W, 0), F(1, -1, 0, H), F(-1, -1, W, H)], frame: rect };
    }
    case 'hex':
      return {
        a: { x: W, y: 0 }, b: { x: W / 2, y: 0.75 * H }, cells: [IDENT],
        frame: [{ x: 0, y: -h / 2 }, { x: w / 2, y: -h / 4 }, { x: w / 2, y: h / 4 }, { x: 0, y: h / 2 }, { x: -w / 2, y: h / 4 }, { x: -w / 2, y: -h / 4 }],
      };
    default:
      return { a: { x: W, y: 0 }, b: { x: 0, y: H }, cells: [IDENT], frame: rect };
  }
}

/** Placement of the pattern: centre of the target box plus offset, then rotation and scale */
function patternMatrix(center: Pt, o: PatternOptions): Mat {
  return mul(translate(center.x + o.offsetX, center.y + o.offsetY), mul(rotate((-o.angle * Math.PI) / 180), scaleMat(o.scale, o.scale)));
}

// ---------- Target area ----------

function offsetPaths(paths: Paths, delta: number, join: number = JoinType.jtRound): Paths {
  if (!paths.length || Math.abs(delta) < 1e-9) return paths;
  const co = new ClipperOffset(2, (FLATTEN_TOL / 4) * SCALE);
  co.AddPaths(paths, join, EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, delta * SCALE);
  return out;
}

function exec(type: number, subj: Paths, clip: Paths, subjFill: number, clipFill = subjFill): Paths {
  const c = new Clipper();
  c.AddPaths(subj, PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, subjFill, clipFill);
  return out;
}

/** Target area: target (even-odd) shrunk by the margin, minus the kept-free areas grown by the margin */
export function patternArea(target: SubPath[], holes: SubPath[], margin: number): Paths {
  const flat = (subs: SubPath[]) => subs.filter((s) => s.closed && s.nodes.length > 1).map((s) => flattenSub(s, IDENT)).filter((p) => p.length > 2);
  let area = exec(ClipType.ctUnion, flat(target), [], PolyFillType.pftEvenOdd);
  area = offsetPaths(area, -margin);
  const h = holes.length ? offsetPaths(exec(ClipType.ctUnion, flat(holes), [], PolyFillType.pftNonZero), margin) : [];
  if (h.length) area = exec(ClipType.ctDifference, area, h, PolyFillType.pftNonZero);
  return area;
}

/** Quick lookup of the area edges that pass through a box */
export class EdgeGrid {
  private cells = new Map<number, number[]>();
  private edges: [number, number, number, number][] = [];
  private size: number;
  private x0: number;
  private y0: number;
  constructor(paths: Paths, box: BBox) {
    this.x0 = box.x0;
    this.y0 = box.y0;
    this.size = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1) / 64;
    for (const p of paths)
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const e = this.edges.push([a.X / SCALE, a.Y / SCALE, b.X / SCALE, b.Y / SCALE]) - 1;
        this.visit(Math.min(a.X, b.X) / SCALE, Math.min(a.Y, b.Y) / SCALE, Math.max(a.X, b.X) / SCALE, Math.max(a.Y, b.Y) / SCALE, (k) => {
          const l = this.cells.get(k);
          if (l) l.push(e);
          else this.cells.set(k, [e]);
        });
      }
  }
  private visit(x0: number, y0: number, x1: number, y1: number, f: (k: number) => boolean | void) {
    const i0 = Math.floor((x0 - this.x0) / this.size), i1 = Math.floor((x1 - this.x0) / this.size);
    const j0 = Math.floor((y0 - this.y0) / this.size), j1 = Math.floor((y1 - this.y0) / this.size);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (f((i + 4096) * 16384 + (j + 4096)) === true) return;
  }
  /** Does any edge come close to the box? */
  touches(b: BBox): boolean {
    let hit = false;
    this.visit(b.x0, b.y0, b.x1, b.y1, (k) => {
      for (const e of this.cells.get(k) ?? []) {
        const [ax, ay, bx, by] = this.edges[e];
        if (Math.max(ax, bx) >= b.x0 && Math.min(ax, bx) <= b.x1 && Math.max(ay, by) >= b.y0 && Math.min(ay, by) <= b.y1) return (hit = true);
      }
    });
    return hit;
  }
}

function insideArea(area: Paths, p: Pt): boolean {
  const q = { X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) };
  let n = 0;
  for (const path of area) if (Clipper.PointInPolygon(q, path) !== 0) n++;
  return n % 2 === 1;
}

/**
 * Keep the parts of the paths inside the area. Clipper finds the cut points on the flattened path; the pieces
 * are then cut out of the original curves, so they stay Bézier curves. cut = something was removed.
 */
export function clipToArea(subs: SubPath[], area: Paths): { kept: SubPath[]; cut: boolean } {
  const kept: SubPath[] = [];
  let cut = false;
  for (const sp of subs) {
    const params: number[] = [];
    const path = flattenSub(sp, IDENT, params);
    if (path.length < 2) continue;
    const n = segments(sp).length;
    if (sp.closed) {
      path.push(path[0]);
      params.push(n);
    }
    const c = new Clipper();
    c.AddPath(path, PolyType.ptSubject, false);
    c.AddPaths(area, PolyType.ptClip, true);
    const tree = new PolyTree();
    c.Execute(ClipType.ctIntersection, tree, PolyFillType.pftNonZero, PolyFillType.pftNonZero);
    const outs = Clipper.OpenPathsFromPolyTree(tree).filter((p) => p.length > 1);
    // parameter of a point on the flattened path
    const paramOf = (q: ClipperLib.IntPoint) => {
      let best = Infinity, u = 0;
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i], b = path[i + 1];
        const dx = b.X - a.X, dy = b.Y - a.Y;
        const l2 = dx * dx + dy * dy;
        const s = l2 ? Math.max(0, Math.min(1, ((q.X - a.X) * dx + (q.Y - a.Y) * dy) / l2)) : 0;
        const d = (a.X + dx * s - q.X) ** 2 + (a.Y + dy * s - q.Y) ** 2;
        if (d < best) (best = d), (u = params[i] + (params[i + 1] - params[i]) * s);
      }
      return u;
    };
    // Each piece runs along the path in one direction; on a closed path it may pass the start (u = n → 0)
    const spans: number[][] = [];
    for (const p of outs) {
      const us = p.map(paramOf);
      // on a closed path the start is also the end (u = 0 = n): take the value that fits the neighbouring points
      if (sp.closed)
        for (let i = 0; i < us.length; i++)
          if (us[i] < 1e-9 && ((i > 0 && us[i - 1] > n / 2) || (i + 1 < us.length && us[i + 1] > n / 2))) us[i] = n;
      let dir = 0;
      for (let i = 0; i + 1 < us.length; i++) {
        const d = us[i + 1] - us[i];
        if (Math.abs(d) < n / 2) dir += Math.sign(d);
      }
      const seq = dir >= 0 ? us : us.reverse();
      let start = seq[0];
      for (let i = 1; i < seq.length; i++)
        if (seq[i] < seq[i - 1] - 1e-6) {
          spans.push([start, n]);
          start = 0;
        }
      spans.push([start, seq[seq.length - 1]]);
    }
    spans.sort((x, y) => x[0] - y[0]);
    const merged: number[][] = [];
    for (const [a, b] of spans) {
      const l = merged[merged.length - 1];
      if (l && a <= l[1] + 1e-6) l[1] = Math.max(l[1], b);
      else merged.push([a, b]);
    }
    const whole = merged.length === 1 && merged[0][0] < 1e-6 && merged[0][1] > n - 1e-6;
    if (whole) {
      kept.push(sp);
      continue;
    }
    cut = true;
    for (const [a, b] of merged) if (b - a > 1e-6) kept.push(extract(sp, a, b));
  }
  return { kept, cut };
}

// ---------- Duplicate lines ----------

interface Bit {
  sp: SubPath;
  /** Created by a cut at the edge (may be dropped as a fragment) */
  cut: boolean;
}

/**
 * Remove lines that lie on top of each other: straight segments on the same line are merged into one line
 * per covered stretch (shared tile edges, collinear lines across tiles); identical curve pieces are kept once.
 * Returns the pieces as single segments; joinSubs chains them again.
 */
export function dedupeBits(bits: Bit[]): { bits: Bit[]; removed: number } {
  interface Line { ang: number; off: number; dx: number; dy: number; s0: number; s1: number; cut: boolean }
  const lines: Line[] = [];
  const curves = new Map<string, Bit>();
  const out: Bit[] = [];
  let before = 0;
  const q = (v: number) => Math.round(v * 1000);
  for (const b of bits) {
    for (const p of piecesOf(b.sp)) {
      const len = pieceLength(p);
      if (len < 1e-6) continue;
      before += len;
      const straight = !p.curve || isStraight(p);
      if (!straight) {
        const k1 = [p.a, p.c1, p.c2, p.b].map((r) => `${q(r.x)},${q(r.y)}`).join(';');
        const k2 = [p.b, p.c2, p.c1, p.a].map((r) => `${q(r.x)},${q(r.y)}`).join(';');
        const prev = curves.get(k1) ?? curves.get(k2);
        if (prev) {
          prev.cut &&= b.cut;
          continue;
        }
        const bit = { sp: pieceSub(p), cut: b.cut };
        curves.set(k1, bit);
        out.push(bit);
        continue;
      }
      let dx = p.b.x - p.a.x, dy = p.b.y - p.a.y;
      const l = Math.hypot(dx, dy);
      dx /= l;
      dy /= l;
      // one direction per line: x > 0, or straight down
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) (dx = -dx), (dy = -dy);
      const off = dx * p.a.y - dy * p.a.x;
      const sa = dx * p.a.x + dy * p.a.y, sb = dx * p.b.x + dy * p.b.y;
      lines.push({ ang: Math.atan2(dy, dx), off, dx, dy, s0: Math.min(sa, sb), s1: Math.max(sa, sb), cut: b.cut });
    }
  }
  // group lines by direction and offset (tolerance 1e-6 rad, 1 µm), then merge the stretches on each line
  lines.sort((a, b) => a.ang - b.ang || a.off - b.off);
  let i = 0;
  while (i < lines.length) {
    let j = i + 1;
    while (j < lines.length && lines[j].ang - lines[i].ang < 1e-6) j++;
    const sameDir = lines.slice(i, j).sort((a, b) => a.off - b.off);
    let k = 0;
    while (k < sameDir.length) {
      let m = k + 1;
      while (m < sameDir.length && sameDir[m].off - sameDir[k].off < 1e-3) m++;
      const group = sameDir.slice(k, m).sort((a, b) => a.s0 - b.s0);
      const base = group[0];
      let cur: { s0: number; s1: number; cut: boolean } | null = null;
      const flush = () => {
        if (!cur) return;
        const P = (s: number): Node => ({ x: s * base.dx - base.off * base.dy, y: s * base.dy + base.off * base.dx });
        out.push({ sp: { closed: false, nodes: [P(cur.s0), P(cur.s1)] }, cut: cur.cut });
      };
      for (const g of group) {
        if (cur && g.s0 <= cur.s1 + 1e-4) {
          cur.s1 = Math.max(cur.s1, g.s1);
          cur.cut &&= g.cut;
        } else {
          flush();
          cur = { s0: g.s0, s1: g.s1, cut: g.cut };
        }
      }
      flush();
      k = m;
    }
    i = j;
  }
  const after = out.reduce((s, b) => s + subLength(b.sp), 0);
  return { bits: out, removed: Math.max(0, before - after) };
}

function isStraight(p: Piece): boolean {
  const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return false;
  const d = (r: Pt) => Math.abs((r.x - p.a.x) * dy - (r.y - p.a.y) * dx) / l;
  const s = (r: Pt) => ((r.x - p.a.x) * dx + (r.y - p.a.y) * dy) / (l * l);
  // handles on the chord and between its ends: the curve is the straight segment
  return d(p.c1) < 1e-6 && d(p.c2) < 1e-6 && s(p.c1) >= -1e-9 && s(p.c1) <= 1 + 1e-9 && s(p.c2) >= -1e-9 && s(p.c2) <= 1 + 1e-9;
}

function pieceSub(p: Piece): SubPath {
  if (!p.curve) return { closed: false, nodes: [{ x: p.a.x, y: p.a.y }, { x: p.b.x, y: p.b.y }] };
  return { closed: false, nodes: [{ x: p.a.x, y: p.a.y, cout: { x: p.c1.x, y: p.c1.y } }, { x: p.b.x, y: p.b.y, cin: { x: p.c2.x, y: p.c2.y } }] };
}

// ---------- Pattern ----------

export function computePattern(input: PatternInput, o: PatternOptions): PatternResult {
  const fail = (error: string): PatternResult => ({ subs: [], tiles: 0, length: 0, removed: 0, warnings: [], error });
  const warnings: string[] = [];
  const { tile } = input;
  if (!(tile.w > 0) || !(tile.h > 0) || !tile.subs.length) return fail(t('Die Kachel ist leer.'));
  if (!input.target.some((s) => s.closed)) return fail(t('Keine geschlossene Zielform.'));
  const lat = patternLattice(tile, o);
  if (typeof lat === 'string') return fail(lat);

  const area = patternArea(input.target, input.holes, Math.max(0, o.margin));
  if (!area.length) return fail(t('Nach Abzug von Rand und Aussparungen bleibt von der Zielform nichts übrig.'));
  // lines exactly on the outline count as inside: test and cut against a minimally grown area
  const clipArea = offsetPaths(area, EDGE_EPS, JoinType.jtMiter);
  const areaBox = EMPTY_BOX();
  for (const p of area) for (const q of p) addPt(areaBox, { x: q.X / SCALE, y: q.Y / SCALE });
  const tbox = subsBox(input.target);
  const center = { x: (tbox.x0 + tbox.x1) / 2, y: (tbox.y0 + tbox.y1) / 2 };

  // motif of one tile: whole (wrap) or cut at the frame
  let base = tile.subs.filter((s) => s.nodes.length >= 2);
  if (!o.wrap) base = clipConvex(base, lat.frame);
  if (o.output === 'areas') {
    const open = base.filter((s) => !s.closed).length;
    if (open) warnings.push(t('Offene Linien des Motivs fallen bei Flächen weg.'));
    base = base.filter((s) => s.closed);
  }
  if (!base.length) return fail(o.output === 'areas' ? t('Das Motiv hat keine geschlossenen Formen.') : t('Vom Motiv bleibt innerhalb des Kachelrahmens nichts übrig.'));

  const P = patternMatrix(center, o);
  const Pinv = inv(P);
  const cellBoxes = lat.cells.map((c) => subsBox(base, c));
  // range of lattice cells that can reach the area
  let reach = 0;
  for (const b of cellBoxes) for (const p of boxCorners(b)) reach = Math.max(reach, Math.hypot(p.x, p.y));
  const pb = mapBox(areaBox, Pinv);
  const det = lat.a.x * lat.b.y - lat.a.y * lat.b.x;
  if (Math.abs(det) < 1e-9) return fail(t('Abstand zu klein: Die Kacheln würden zusammenfallen.'));
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const p of boxCorners({ x0: pb.x0 - reach, y0: pb.y0 - reach, x1: pb.x1 + reach, y1: pb.y1 + reach })) {
    const i = (p.x * lat.b.y - p.y * lat.b.x) / det, j = (lat.a.x * p.y - lat.a.y * p.x) / det;
    i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
  }
  i0 = Math.floor(i0) - 1; i1 = Math.ceil(i1) + 1; j0 = Math.floor(j0) - 1; j1 = Math.ceil(j1) + 1;
  const total = (i1 - i0 + 1) * (j1 - j0 + 1) * lat.cells.length;
  if (!isFinite(total) || total > MAX_TILES * 4)
    return fail(t('Zu viele Kacheln (mehr als {max}). Muster größer machen oder den Abstand erhöhen.', { max: MAX_TILES }));

  const grid = new EdgeGrid(clipArea, areaBox);
  const bits: Bit[] = [];
  const polys: Paths = [];
  let tiles = 0;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++)
      for (let k = 0; k < lat.cells.length; k++) {
        const M = mul(P, mul(translate(i * lat.a.x + j * lat.b.x, i * lat.a.y + j * lat.b.y), lat.cells[k]));
        const box = mapBox(cellBoxes[k], mul(P, translate(i * lat.a.x + j * lat.b.x, i * lat.a.y + j * lat.b.y)));
        if (!overlaps(box, areaBox)) continue;
        const crossing = grid.touches(box);
        let subs: SubPath[] | null = null;
        let cut = false;
        if (!crossing) {
          const p0 = base[0].nodes[0];
          if (!insideArea(clipArea, apply(M, p0.x, p0.y))) continue;
          subs = transformSubs(base, M);
        } else {
          const placed = transformSubs(base, M);
          const r = clipToArea(placed, clipArea);
          if (!r.kept.length) continue;
          if (o.edge === 'whole') {
            if (r.cut) continue;
            subs = placed;
          } else if (o.edge === 'touch') subs = placed;
          else {
            subs = o.output === 'areas' ? placed : r.kept;
            cut = r.cut;
          }
        }
        if (++tiles > MAX_TILES) return fail(t('Zu viele Kacheln (mehr als {max}). Muster größer machen oder den Abstand erhöhen.', { max: MAX_TILES }));
        if (o.output === 'areas') for (const s of subs) polys.push(flattenSub(s, IDENT));
        else for (const s of subs) bits.push({ sp: s, cut });
      }
  if (!tiles) return fail(t('Keine Kachel liegt in der Zielform. Muster kleiner machen oder Rand verringern.'));

  if (o.output === 'areas') {
    let res = exec(ClipType.ctUnion, polys.filter((p) => p.length > 2), [], PolyFillType.pftNonZero);
    if (o.edge === 'clip') res = exec(ClipType.ctIntersection, res, area, PolyFillType.pftNonZero);
    const minA = o.minFragment * o.minFragment * SCALE * SCALE;
    const dropped = res.filter((p) => Math.abs(Clipper.Area(p)) < minA).length;
    if (dropped) res = res.filter((p) => Math.abs(Clipper.Area(p)) >= minA);
    const subs = pathsToSubs(res);
    if (!subs.length) return fail(t('Vom Muster bleibt nichts übrig.'));
    return { subs, tiles, length: subs.reduce((s, sp) => s + subLength(sp), 0), removed: 0, warnings };
  }

  let removed = 0;
  let work = bits;
  if (o.dedupe) {
    const d = dedupeBits(bits);
    work = d.bits;
    removed = d.removed;
  }
  const joined = joinSubs(work.map((b) => b.sp), JOIN_TOL);
  const subs: SubPath[] = [];
  let fragments = 0;
  joined.subs.forEach((raw, n) => {
    const fromCut = joined.origin[n].some((k) => work[k].cut);
    const sp = o.edge === 'clip' ? trimStubs(raw, area) : raw;
    if (!sp) return;
    if (fromCut && o.minFragment > 0 && subLength(sp) < o.minFragment) {
      fragments++;
      return;
    }
    subs.push(sp);
  });
  if (fragments) warnings.push(tn('{n} kleines Reststück am Rand weggelassen.', '{n} kleine Reststücke am Rand weggelassen.', fragments));
  if (!subs.length) return fail(t('Vom Muster bleibt nichts übrig.'));
  return { subs, tiles, length: subs.reduce((s, sp) => s + subLength(sp), 0), removed, warnings };
}

/**
 * Lines that lie exactly on the outline are kept by cutting against a minimally grown area; the price is a
 * stub of that width where a line leaves the area. Remove such stubs at the ends of open paths.
 */
function trimStubs(sp: SubPath, area: Paths): SubPath | null {
  if (sp.closed) return sp;
  const lim = 3 * EDGE_EPS;
  const inside = (p: Pt) => insideArea(area, p);
  const straight = (a: Node, b: Node) => !a.cout && !b.cin;
  const len = (a: Node, b: Node) => Math.hypot(b.x - a.x, b.y - a.y);
  const nodes = sp.nodes.slice();
  let changed = false;
  // end segment ab (b = free end): drop it when it is a stub outside, or pull b back onto the outline
  const fix = (ia: number, ib: number): boolean => {
    const a = nodes[ia], b = nodes[ib];
    if (!straight(ia < ib ? a : b, ia < ib ? b : a) || inside(b)) return false;
    const l = len(a, b);
    if (l < lim) return true;
    let lo = Math.max(0, 1 - lim / l), hi = 1;
    if (!inside({ x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo })) return false;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2;
      if (inside({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m })) lo = m;
      else hi = m;
    }
    nodes[ib] = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
    changed = true;
    return false;
  };
  while (nodes.length >= 2 && fix(1, 0)) (nodes.shift(), (changed = true));
  while (nodes.length >= 2 && fix(nodes.length - 2, nodes.length - 1)) (nodes.pop(), (changed = true));
  if (nodes.length < 2 || (nodes.length === 2 && len(nodes[0], nodes[1]) < 1e-6)) return null;
  return changed ? { closed: false, nodes } : sp;
}

/** Short summary for dialogs and the generator info */
export function patternInfo(r: PatternResult): string {
  const parts = [
    tn('{n} Kachel', '{n} Kacheln', r.tiles),
    tn('{n} Pfad', '{n} Pfade', r.subs.length),
    t('{len} mm Linien', { len: dec(r.length.toFixed(0)) }),
  ];
  if (r.removed > 0.5) parts.push(t('{len} mm doppelte Linien entfernt', { len: dec(r.removed.toFixed(0)) }));
  return parts.join(' · ');
}

// ---------- Parametric object ----------

export const PATTERN_GEN_ID = 'pattern-fill';

const ENUM = <T extends string>(list: T[], label: (v: T) => string): [string, string][] => list.map((v) => [v, label(v)]);

const SCHEMA: ParamSpec[] = [
  { key: 'recipe', type: 'data', label: t('Muster-Rezept'), def: '' },
  { key: 'repeat', type: 'enum', label: t('Wiederholung'), options: ENUM(PATTERN_REPEATS, repeatLabel), def: 'grid' },
  { key: 'shift', type: 'number', label: t('Versatz (Anteil der Kachel)'), min: 0, max: 1, def: 0.5, showIf: (p) => p.repeat === 'brick' || p.repeat === 'halfdrop' },
  { key: 'mirror', type: 'enum', label: t('Spiegeln'), options: ENUM(PATTERN_MIRRORS, mirrorLabel), def: 'xy', showIf: (p) => p.repeat === 'mirror' },
  { key: 'gapX', type: 'length', label: t('Abstand waagerecht'), min: -500, max: 500, def: 0 },
  { key: 'gapY', type: 'length', label: t('Abstand senkrecht'), min: -500, max: 500, def: 0 },
  { key: 'scale', type: 'number', label: t('Maßstab'), min: 0.05, max: 20, def: 1 },
  { key: 'angle', type: 'angle', label: t('Drehung'), min: -360, max: 360, def: 0 },
  { key: 'offsetX', type: 'length', label: t('Verschiebung X'), min: -5000, max: 5000, def: 0 },
  { key: 'offsetY', type: 'length', label: t('Verschiebung Y'), min: -5000, max: 5000, def: 0 },
  { key: 'wrap', type: 'bool', label: t('Kanten umbrechen'), def: true },
  { key: 'edge', type: 'enum', label: t('Am Rand'), options: ENUM(PATTERN_EDGES, edgeLabel), def: 'clip' },
  { key: 'margin', type: 'length', label: t('Randabstand'), min: 0, max: 500, def: 2 },
  { key: 'output', type: 'enum', label: t('Ergebnis'), options: ENUM(PATTERN_OUTPUTS, outputLabel), def: 'lines' },
  { key: 'dedupe', type: 'bool', label: t('Doppelte Linien entfernen'), def: true },
  { key: 'minFragment', type: 'length', label: t('Kleinste Reststücke'), min: 0, max: 50, def: 0.5 },
];

export function optionsFromParams(p: Params): PatternOptions {
  const d = DEFAULT_PATTERN_OPTIONS;
  const n = (k: keyof PatternOptions) => (typeof p[k] === 'number' && isFinite(p[k] as number) ? (p[k] as number) : (d[k] as number));
  const e = <T extends string>(k: keyof PatternOptions, list: T[]) => (list.includes(p[k] as T) ? (p[k] as T) : (d[k] as T));
  const b = (k: keyof PatternOptions) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : (d[k] as boolean));
  return {
    repeat: e<PatternRepeat>('repeat', PATTERN_REPEATS), shift: n('shift'), mirror: e<PatternMirror>('mirror', PATTERN_MIRRORS),
    gapX: n('gapX'), gapY: n('gapY'), scale: n('scale'), angle: n('angle'), offsetX: n('offsetX'), offsetY: n('offsetY'),
    wrap: b('wrap'), edge: e<PatternEdge>('edge', PATTERN_EDGES), margin: n('margin'), output: e<PatternOutput>('output', PATTERN_OUTPUTS),
    dedupe: b('dedupe'), minFragment: n('minFragment'),
  };
}

export function paramsFromOptions(o: PatternOptions, recipe: PatternRecipe): Params {
  return {
    recipe: JSON.stringify(recipe), repeat: o.repeat, shift: o.shift, mirror: o.mirror, gapX: o.gapX, gapY: o.gapY, scale: o.scale, angle: o.angle,
    offsetX: o.offsetX, offsetY: o.offsetY, wrap: o.wrap, edge: o.edge, margin: o.margin, output: o.output, dedupe: o.dedupe, minFragment: o.minFragment,
  };
}

/** Result of a pattern object (cached per recipe and options, so dialog, validate and generate share one run) */
let last: { key: string; r: PatternResult } | null = null;
export function runPattern(recipe: PatternRecipe | string, o: PatternOptions): PatternResult {
  const text = typeof recipe === 'string' ? recipe : JSON.stringify(recipe);
  const key = `${text.length}:${JSON.stringify(o)}:${text}`;
  if (last?.key === key) return last.r;
  let r: PatternResult;
  try {
    const rec = typeof recipe === 'string' ? parseRecipe(recipe) : recipe;
    r = computePattern(rec, o);
  } catch (e) {
    r = { subs: [], tiles: 0, length: 0, removed: 0, warnings: [], error: e instanceof PatternError || e instanceof Error ? e.message : String(e) };
  }
  last = { key, r };
  return r;
}

export const PATTERN_GEN: Generator = {
  id: PATTERN_GEN_ID,
  version: 1,
  kind: 'part',
  name: t('Musterfüllung'),
  icon: 'pattern',
  schema: SCHEMA,
  validate(p) {
    const r = runPattern(String(p.recipe), optionsFromParams(p));
    return r.error ? [{ level: 'error', msg: r.error }] : r.warnings.map((msg) => ({ level: 'warn' as const, msg }));
  },
  generate(p) {
    const r = runPattern(String(p.recipe), optionsFromParams(p));
    if (r.error) throw new Error(r.error);
    return { parts: [{ key: 'main', at: { x: 0, y: 0 }, subs: r.subs }], info: [[t('Ergebnis'), patternInfo(r)]] };
  },
  label(p) {
    let name = '';
    try {
      name = parseRecipe(String(p.recipe)).name ?? '';
    } catch {
      /* broken recipe: plain name */
    }
    return name ? t('Muster „{name}“', { name }) : t('Musterfüllung');
  },
};
