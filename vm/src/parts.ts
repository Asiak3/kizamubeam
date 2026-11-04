// Which parts of a workpiece are cut out: the burn map marks pixels that are cut through; every connected area of
// the remaining material that does not touch the outer edge falls out as a loose part, areas at the edge are the
// leftover material. Areas that are almost cut out (the cut goes at least halfway but not everywhere through) are
// reported as "still hanging". Outlines come back as polygons in piece coordinates (mm). No DOM, runs in Node.

import type { BurnMap } from './burn';

export interface Body {
  /** stable across re-analysis as long as the part stays where it is */
  key: string;
  kind: 'rest' | 'part';
  /** area in mm² */
  area: number;
  /** closed outlines in piece mm, [x0, y0, x1, y1, …]: the first is the outer edge, the others are holes */
  loops: number[][];
  /** bounding box in piece mm */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Hanging {
  /** outer outline of the area that is almost cut out (piece mm) */
  loop: number[];
  cx: number;
  cy: number;
  area: number;
}

export interface Analysis {
  bodies: Body[];
  hanging: Hanging[];
}

/** loose parts smaller than this (mm²) drop through the honeycomb and are not shown */
const MIN_PART = 0.5;
/** depth byte from which a cut counts as an attempt to cut out (85 = a third of the thickness) */
const ALMOST = 85;
/** gaps in a cut up to twice this (mm) still count as closed, e.g. a small tab */
const GAP = 0.5;

/** Label 4-connected areas of pixels that are not barriers (mask 1 = barrier); returns labels (0 = barrier) and per
 *  label: pixel count, touches the edge */
function label(nx: number, ny: number, barrier: Uint8Array) {
  const lab = new Int32Array(nx * ny);
  const size: number[] = [0];
  const edge: boolean[] = [false];
  const stack = new Int32Array(nx * ny);
  let next = 1;
  for (let s = 0; s < nx * ny; s++) {
    if (lab[s] || barrier[s]) continue;
    const id = next++;
    let sp = 0,
      count = 0,
      atEdge = false;
    stack[sp++] = s;
    lab[s] = id;
    while (sp) {
      const i = stack[--sp];
      count++;
      const x = i % nx;
      if (x === 0 || x === nx - 1 || i < nx || i >= nx * (ny - 1)) atEdge = true;
      let j = i - 1;
      if (x > 0 && !lab[j] && !barrier[j]) (lab[j] = id), (stack[sp++] = j);
      j = i + 1;
      if (x < nx - 1 && !lab[j] && !barrier[j]) (lab[j] = id), (stack[sp++] = j);
      j = i - nx;
      if (j >= 0 && !lab[j] && !barrier[j]) (lab[j] = id), (stack[sp++] = j);
      j = i + nx;
      if (j < nx * ny && !lab[j] && !barrier[j]) (lab[j] = id), (stack[sp++] = j);
    }
    size.push(count);
    edge.push(atEdge);
  }
  return { lab, size, edge };
}

/**
 * Outlines of the pixels with label id along the pixel borders (inside on the left: outer loops counter-clockwise,
 * holes clockwise), simplified and in mm. Diagonal neighbours count as separate, like the 4-connected labelling.
 */
export function traceLoops(lab: Int32Array, nx: number, ny: number, id: number, res: number, bx0 = 0, by0 = 0, bx1 = nx - 1, by1 = ny - 1): number[][] {
  const W = nx + 1;
  // outgoing edges per vertex: bit d set = edge in direction d (0 E, 1 N, 2 W, 3 S)
  const out = new Map<number, number>();
  const add = (x: number, y: number, d: number) => out.set(y * W + x, (out.get(y * W + x) ?? 0) | (1 << d));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < nx && y < ny && lab[y * nx + x] === id;
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      if (lab[y * nx + x] !== id) continue;
      if (!inside(x, y - 1)) add(x, y, 0);
      if (!inside(x + 1, y)) add(x + 1, y, 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, 2);
      if (!inside(x - 1, y)) add(x, y + 1, 3);
    }
  const DX = [1, 0, -1, 0],
    DY = [0, 1, 0, -1];
  // the turn is chosen among all edges of a vertex, used or not, so two loops meeting at a corner never merge
  const orig = new Map(out);
  const loops: number[][] = [];
  for (const startV of [...out.keys()]) {
    while (out.get(startV)) {
      const bits0 = out.get(startV)!;
      let d = Math.log2(bits0 & -bits0);
      let v = startV;
      const pts: number[] = [];
      for (;;) {
        const bits = out.get(v) ?? 0;
        if (!(bits & (1 << d))) break;
        out.set(v, bits & ~(1 << d));
        const x = v % W,
          y = (v - x) / W;
        pts.push(x, y);
        v = (y + DY[d]) * W + (x + DX[d]);
        const nb = orig.get(v) ?? 0;
        // prefer turning left, then straight, then right (keeps diagonal pixels apart)
        const left = (d + 1) % 4,
          right = (d + 3) % 4;
        d = nb & (1 << left) ? left : nb & (1 << d) ? d : right;
      }
      if (pts.length >= 8) loops.push(simplify(pts, 0.6).map((c) => c / res));
    }
  }
  return loops;
}

/** Douglas–Peucker for a closed loop (flat coordinates), tolerance in the same unit */
export function simplify(p: number[], tol: number): number[] {
  const n = p.length / 2;
  if (n < 4) return p;
  // split at the point farthest from the first one
  let far = 0,
    fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (p[2 * i] - p[0]) ** 2 + (p[2 * i + 1] - p[1]) ** 2;
    if (d > fd) (fd = d), (far = i);
  }
  const keep = new Uint8Array(n);
  keep[0] = keep[far] = 1;
  const seg = (a: number, b: number) => {
    // b may wrap around to n (= point 0)
    const stack: [number, number][] = [[a, b]];
    while (stack.length) {
      const [s, e] = stack.pop()!;
      const ex = p[2 * (e % n)],
        ey = p[2 * (e % n) + 1];
      const sx = p[2 * s],
        sy = p[2 * s + 1];
      const L = Math.hypot(ex - sx, ey - sy) || 1;
      let best = -1,
        bd = tol;
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs((ex - sx) * (sy - p[2 * i + 1]) - (sx - p[2 * i]) * (ey - sy)) / L;
        if (d > bd) (bd = d), (best = i);
      }
      if (best >= 0) {
        keep[best] = 1;
        stack.push([s, best], [best, e]);
      }
    }
  };
  seg(0, far);
  seg(far, n);
  const r: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) r.push(p[2 * i], p[2 * i + 1]);
  return r;
}

/** Signed area of a loop (counter-clockwise positive) */
export function loopArea(l: number[]) {
  let a = 0;
  for (let i = 0, n = l.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += l[2 * i] * l[2 * j + 1] - l[2 * j] * l[2 * i + 1];
  }
  return a / 2;
}

/** Mask of the barrier pixels grown by r pixels in every direction (square), so small gaps close */
function dilate(nx: number, ny: number, src: Uint8Array, r: number) {
  const a = src.slice(),
    b = new Uint8Array(nx * ny);
  // rows: running count of barrier pixels in the window [x - r, x + r]
  for (let y = 0; y < ny; y++) {
    const o = y * nx;
    let c = 0;
    for (let x = 0; x < Math.min(r, nx); x++) c += a[o + x];
    for (let x = 0; x < nx; x++) {
      if (x + r < nx) c += a[o + x + r];
      if (x - r - 1 >= 0) c -= a[o + x - r - 1];
      b[o + x] = c > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < nx; x++) {
    let c = 0;
    for (let y = 0; y < Math.min(r, ny); y++) c += b[y * nx + x];
    for (let y = 0; y < ny; y++) {
      if (y + r < ny) c += b[(y + r) * nx + x];
      if (y - r - 1 >= 0) c -= b[(y - r - 1) * nx + x];
      a[y * nx + x] = c > 0 ? 1 : 0;
    }
  }
  return a;
}

function bounds(lab: Int32Array, nx: number, ny: number, count: number) {
  const b = Array.from({ length: count }, () => [Infinity, Infinity, -Infinity, -Infinity]);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++) {
      const id = lab[y * nx + x];
      if (!id) continue;
      const q = b[id];
      if (x < q[0]) q[0] = x;
      if (y < q[1]) q[1] = y;
      if (x > q[2]) q[2] = x;
      if (y > q[3]) q[3] = y;
    }
  return b;
}

/** What the analysis needs from a burn map (so it can run in a worker on a copy) */
export type MapData = Pick<BurnMap, 'nx' | 'ny' | 'res' | 'tex'>;

export function analyze(map: MapData): Analysis {
  const { nx, ny, res, tex } = map;
  const px = 1 / (res * res);
  const empty: Analysis = { bodies: [], hanging: [] };
  let any = false;
  for (let i = 1; i < tex.length && !any; i += 2) any = tex[i] >= ALMOST;
  if (!any) return empty;
  const thru = new Uint8Array(nx * ny),
    deepPx = new Uint8Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) {
    const d = tex[i * 2 + 1];
    thru[i] = d === 255 ? 1 : 0;
    deepPx[i] = d >= ALMOST ? 1 : 0;
  }
  const cut = label(nx, ny, thru);
  const box = bounds(cut.lab, nx, ny, cut.size.length);
  const bodies: Body[] = [];
  for (let id = 1; id < cut.size.length; id++) {
    const area = cut.size[id] * px;
    if (!cut.edge[id] && area < MIN_PART) continue;
    const [bx0, by0, bx1, by1] = box[id];
    const loops = traceLoops(cut.lab, nx, ny, id, res, bx0, by0, bx1, by1);
    if (!loops.length) continue;
    // the outer edge is the loop with the largest area; it goes first
    loops.sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)));
    const kind = cut.edge[id] ? 'rest' : 'part';
    bodies.push({
      key: `${kind}:${Math.round(((bx0 + bx1) / 2 / res) * 2)}:${Math.round(((by0 + by1) / 2 / res) * 2)}`,
      kind,
      area,
      loops,
      x0: bx0 / res,
      y0: by0 / res,
      x1: (bx1 + 1) / res,
      y1: (by1 + 1) / res,
    });
  }
  // almost cut out: closed by cuts at least halfway deep, but still connected to the rest through the material
  const hanging: Hanging[] = [];
  const deep = label(nx, ny, dilate(nx, ny, deepPx, Math.max(1, Math.round(GAP * res))));
  const dbox = bounds(deep.lab, nx, ny, deep.size.length);
  for (let id = 1; id < deep.size.length; id++) {
    const area = deep.size[id] * px;
    if (deep.edge[id] || area < 1) continue;
    const [bx0, by0, bx1, by1] = dbox[id];
    // still part of the leftover? (any pixel of it belongs to an area at the edge in the through-labelling)
    let attached = false;
    for (let y = by0; y <= by1 && !attached; y++)
      for (let x = bx0; x <= bx1; x++) {
        const i = y * nx + x;
        if (deep.lab[i] === id && cut.edge[cut.lab[i]]) {
          attached = true;
          break;
        }
      }
    if (!attached) continue;
    const loops = traceLoops(deep.lab, nx, ny, id, res, bx0, by0, bx1, by1);
    if (!loops.length) continue;
    loops.sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)));
    hanging.push({ loop: loops[0], cx: (bx0 + bx1 + 1) / 2 / res, cy: (by0 + by1 + 1) / 2 / res, area });
  }
  return { bodies, hanging };
}

/** Short fingerprint: changes when parts appear, disappear or change size */
export function signature(a: Analysis) {
  return [...a.bodies.map((b) => `${b.key}/${Math.round(b.area)}/${b.loops.length}`), ...a.hanging.map((h) => `h${Math.round(h.cx)}:${Math.round(h.cy)}/${Math.round(h.area)}`)].join('|');
}
