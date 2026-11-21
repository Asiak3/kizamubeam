// Outline of the box (#451): a polygon with right angles on the centre lines of the outer walls, in the inner
// coordinates of the walls (x to the right from the inside of the left wall, y to the front from the inside of the
// back wall). The rectangle of the box is [−t/2, w + t/2] × [−t/2, d + t/2]; a shaped outline has notches cut into
// it (L, U, C). The outline is what the walls enclose (region). Pure computation, no host functions.

export type Pt = [number, number];
export type Axis = 'h' | 'v';

/** An edge of the outline: on line pos along its axis from `from` to `to` (vertex centres), the inside on side `inside`
 * (1 = towards larger pos) */
export interface OEdge {
  k: number;
  axis: Axis;
  pos: number;
  from: number;
  to: number;
  inside: 1 | -1;
}

const E = 0.01;

/** The rectangle of the box (centre lines of the outer walls) */
export const rectOutline = (w: number, d: number, t: number): Pt[] => [
  [-t / 2, -t / 2],
  [w + t / 2, -t / 2],
  [w + t / 2, d + t / 2],
  [-t / 2, d + t / 2],
];

/** Bounding box x0, y0, x1, y1 */
export function bbox(pts: Pt[]): [number, number, number, number] {
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Is the outline its own bounding box (four corners)? */
export const isRect = (pts: Pt[]) => pts.length === 4;

/** Strictly inside the polygon (ray casting; points on an edge give either answer) */
export function inside(pts: Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Where a point is: inside, on the outline, or outside (es: the outline's edges, when they are at hand) */
export function where(pts: Pt[], x: number, y: number, es: OEdge[] = edges(pts)): 'in' | 'on' | 'out' {
  for (const e of es) {
    const [a, c] = e.axis === 'h' ? [x, y] : [y, x];
    if (Math.abs(c - e.pos) < E && a > e.from - E && a < e.to + E) return 'on';
  }
  return inside(pts, x, y) ? 'in' : 'out';
}

/** The edges of the outline in its order */
export function edges(pts: Pt[]): OEdge[] {
  const out: OEdge[] = [];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const a = pts[k],
      b = pts[(k + 1) % n];
    const axis: Axis = Math.abs(a[1] - b[1]) < 1e-9 ? 'h' : 'v';
    const [pos, p, q] = axis === 'h' ? [a[1], a[0], b[0]] : [a[0], a[1], b[1]];
    const from = Math.min(p, q),
      to = Math.max(p, q);
    const m = (from + to) / 2;
    const probe = 1e-3;
    const inPlus = axis === 'h' ? inside(pts, m, pos + probe) : inside(pts, pos + probe, m);
    out.push({ k, axis, pos, from, to, inside: inPlus ? 1 : -1 });
  }
  return out;
}

/**
 * The boundary of the cells that are on (cell[i][j]: between xs[i] and xs[i + 1], ys[j] and ys[j + 1]) as one polygon,
 * starting at the top left corner, clockwise on the screen; null when it is not one loop without touching points
 */
function trace(xs: number[], ys: number[], cell: boolean[][]): Pt[] | null {
  const nx = xs.length - 1,
    ny = ys.length - 1;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && cell[i][j];
  // Gerichtete Randkanten (Innenseite rechts, im Uhrzeigersinn auf dem Bildschirm), als Gitterpunkte
  const next = new Map<string, [number, number][]>();
  const add = (a: [number, number], b: [number, number]) => {
    const k = `${a[0]},${a[1]}`;
    next.set(k, [...(next.get(k) ?? []), b]);
  };
  let count = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      if (!cell[i][j]) continue;
      if (!on(i, j - 1)) add([i, j], [i + 1, j]), count++;
      if (!on(i + 1, j)) add([i + 1, j], [i + 1, j + 1]), count++;
      if (!on(i, j + 1)) add([i + 1, j + 1], [i, j + 1]), count++;
      if (!on(i - 1, j)) add([i, j + 1], [i, j]), count++;
    }
  if (!count) return null;
  // Eine einzige Schleife ohne Berührpunkte
  for (const v of next.values()) if (v.length > 1) return null;
  let start: [number, number] | null = null;
  for (const k of next.keys()) {
    const [i, j] = k.split(',').map(Number) as [number, number];
    if (!start || j < start[1] || (j === start[1] && i < start[0])) start = [i, j];
  }
  const loop: [number, number][] = [];
  let cur = start!;
  for (let guard = 0; guard <= count; guard++) {
    loop.push(cur);
    cur = next.get(`${cur[0]},${cur[1]}`)![0];
    if (cur[0] === start![0] && cur[1] === start![1]) break;
  }
  if (loop.length !== count) return null;
  // Punkte auf geraden Strecken weglassen
  const keep = loop.filter((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length],
      b = loop[(i + 1) % loop.length];
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
  return keep.map(([i, j]) => [xs[i], ys[j]]);
}

/**
 * A wall end that stops up to t/2 before a corner of the outline, on the line of the outline edge that goes on from
 * that corner (at the old inner face, e.g. after a stretch was pulled out next to it), reaches the corner: the wall and
 * that outer wall are one board, and the other outer wall of the corner ends on it in a T
 */
export function reachCorner<W extends { axis: Axis; pos: number; from: number; to: number }>(x: W, es: OEdge[], t: number): W {
  let { from, to } = x;
  for (const e of es) {
    if (e.axis !== x.axis || Math.abs(e.pos - x.pos) > E) continue;
    for (const v of [e.from, e.to]) {
      if (v < from && from - v <= t / 2 + E && e.to <= from + E) from = v;
      if (v > to && v - to <= t / 2 + E && e.from >= to - E) to = v;
    }
  }
  return from === x.from && to === x.to ? x : { ...x, from, to };
}

// ---- The box from its walls: the outer walls are walls like the others (#451) ----

/** A wall on its centre line (as in model.ts); an open one is an outer wall that is not built (the box is open there) */
export interface Line {
  id: number;
  axis: Axis;
  pos: number;
  from: number;
  to: number;
  open?: boolean;
}

/**
 * What the walls enclose: the outline on the centre lines of the walls around it (split where it goes from open to
 * built), the outline's edges with the wall on each (its id) and whether it is open, and the walls without what lies
 * on the outline (the pieces inside and outside, with the id of their wall; a wall may give several). A piece inside
 * that ends on an outer wall across it ends on its inner face, on an open one at its outer face (the edge of the
 * floor); one that goes on as outer wall in its line past a corner ends at the corner (one stepped board). Walls with a
 * negative id (open sides) are open. Refused when the walls do not close a space (box-open) or close more than one, or
 * two that touch at a corner (outline-split), or an open wall is not on the outline (open-inside).
 */
export type Region =
  | { ok: true; pts: Pt[]; edgeWall: number[]; open: boolean[]; pieces: Line[] }
  | { ok: false; code: 'box-open' | 'outline-split' | 'open-inside'; values?: Record<string, number> };

export function region(walls: Line[], t: number): Region {
  const uniq = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of s) if (!out.length || x - out[out.length - 1] > 1e-6) out.push(x);
    return out;
  };
  const xs = uniq(walls.flatMap((q) => (q.axis === 'v' ? [q.pos] : [q.from, q.to])));
  const ys = uniq(walls.flatMap((q) => (q.axis === 'h' ? [q.pos] : [q.from, q.to])));
  const nx = xs.length - 1,
    ny = ys.length - 1;
  if (nx < 1 || ny < 1) return { ok: false, code: 'box-open' };
  const ix = (v: number[], x: number) => v.findIndex((u) => Math.abs(u - x) <= 1e-6);
  const opened = new Set(walls.filter((q) => q.open || q.id < 0).map((q) => q.id));
  // vb[i][j]: the wall on the line xs[i] between ys[j] and ys[j + 1] (0: none), hb[j][i] the same across; walls of the
  // list before added ones (negative ids)
  const vb = xs.map(() => new Array<number>(ny).fill(0)),
    hb = ys.map(() => new Array<number>(nx).fill(0));
  const unit = (axis: Axis, line: number, k: number) => (axis === 'v' ? vb[line][k] : hb[line][k]);
  for (const q of walls) {
    const [line, run, b] = q.axis === 'v' ? [ix(xs, q.pos), ys, vb] : [ix(ys, q.pos), xs, hb];
    for (let k = ix(run, q.from); k < ix(run, q.to); k++) if (b[line][k] <= 0) b[line][k] = q.id;
  }
  // From outside (a ring of cells around the grid: cell (a, b) lies between xs[a − 1] and xs[a]) to every cell no wall
  // closes off
  const W = nx + 2,
    H = ny + 2;
  const reached = new Uint8Array(W * H);
  const stack = [0];
  reached[0] = 1;
  while (stack.length) {
    const c = stack.pop()!;
    const a = c % W,
      b = (c - a) / W;
    const go = (a2: number, b2: number, shut: boolean) => {
      if (a2 < 0 || b2 < 0 || a2 >= W || b2 >= H || shut || reached[b2 * W + a2]) return;
      reached[b2 * W + a2] = 1;
      stack.push(b2 * W + a2);
    };
    const inRow = b >= 1 && b <= ny,
      inCol = a >= 1 && a <= nx;
    go(a + 1, b, inRow && a <= nx && vb[a][b - 1] !== 0);
    go(a - 1, b, inRow && a >= 1 && vb[a - 1][b - 1] !== 0);
    go(a, b + 1, inCol && b <= ny && hb[b][a - 1] !== 0);
    go(a, b - 1, inCol && b >= 1 && hb[b - 1][a - 1] !== 0);
  }
  const cell: boolean[][] = [];
  let count = 0;
  for (let i = 0; i < nx; i++) {
    cell.push([]);
    for (let j = 0; j < ny; j++) {
      const v = !reached[(j + 1) * W + i + 1];
      cell[i].push(v);
      if (v) count++;
    }
  }
  if (!count) return { ok: false, code: 'box-open' };
  // One piece (cells next to each other belong together, walls between them or not)
  const seen = new Set<number>();
  const first = cell.flatMap((col, i) => col.map((v, j) => (v ? i * ny + j : -1))).find((k) => k >= 0)!;
  const todo = [first];
  seen.add(first);
  while (todo.length) {
    const k = todo.pop()!;
    const i = Math.floor(k / ny),
      j = k % ny;
    for (const [i2, j2] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]])
      if (i2 >= 0 && j2 >= 0 && i2 < nx && j2 < ny && cell[i2][j2] && !seen.has(i2 * ny + j2)) seen.add(i2 * ny + j2), todo.push(i2 * ny + j2);
  }
  const corners = seen.size === count ? trace(xs, ys, cell) : null;
  if (!corners) return { ok: false, code: 'outline-split' };

  // A piece k of the grid line `line` (across axis): how many of its two sides are inside (1: on the outline)
  const sides = (axis: Axis, line: number, k: number) => {
    const [inA, inB] = axis === 'v' ? [line > 0 && cell[line - 1][k], line < nx && cell[line][k]] : [line > 0 && cell[k][line - 1], line < ny && cell[k][line]];
    return Number(inA) + Number(inB);
  };
  // An open wall lies on the outline, all of it
  for (const q of walls) {
    if (!q.open) continue;
    const [line, run] = q.axis === 'v' ? [ix(xs, q.pos), ys] : [ix(ys, q.pos), xs];
    for (let k = ix(run, q.from); k < ix(run, q.to); k++) if (sides(q.axis, line, k) !== 1) return { ok: false, code: 'open-inside', values: { id: q.id } };
  }

  // The outline split where it goes from built to open: the edge from pts[k] to pts[k + 1] has the wall edgeWall[k]
  const pts: Pt[] = [],
    open: boolean[] = [],
    edgeWall: number[] = [];
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k],
      b = corners[(k + 1) % corners.length];
    const axis: Axis = Math.abs(a[1] - b[1]) < 1e-9 ? 'h' : 'v';
    const [line, run, p, q] = axis === 'h' ? [ix(ys, a[1]), xs, a[0], b[0]] : [ix(xs, a[0]), ys, a[1], b[1]];
    const i0 = ix(run, p),
      i1 = ix(run, q),
      dir = i1 > i0 ? 1 : -1;
    let cur: boolean | null = null;
    for (let i = i0; i !== i1; i += dir) {
      const id = unit(axis, line, dir > 0 ? i : i - 1);
      if (opened.has(id) === cur) continue;
      cur = opened.has(id);
      pts.push(axis === 'h' ? [run[i], a[1]] : [a[0], run[i]]);
      open.push(cur);
      edgeWall.push(id);
    }
  }

  // Grid points on the outline
  const onOutline = new Set<string>();
  for (let i = 0; i <= nx; i++) for (let j = 0; j < ny; j++) if (sides('v', i, j) === 1) onOutline.add(`${i},${j}`).add(`${i},${j + 1}`);
  for (let j = 0; j <= ny; j++) for (let i = 0; i < nx; i++) if (sides('h', j, i) === 1) onOutline.add(`${i},${j}`).add(`${i + 1},${j}`);
  // Is the outline across the line `line` of wall axis `axis` at its grid point k open there (open on both sides of the
  // point, or on the one side it has)?
  const openAcross = (axis: Axis, line: number, k: number) => {
    const across: Axis = axis === 'v' ? 'h' : 'v';
    const max = axis === 'v' ? nx : ny;
    const ids = [line - 1, line].filter((u) => u >= 0 && u < max && sides(across, k, u) === 1).map((u) => unit(across, k, u));
    return ids.length > 0 && ids.every((id) => opened.has(id));
  };

  const pieces: Line[] = [];
  for (const q of walls) {
    if (q.id <= 0 || q.open) continue;
    const [line, run] = q.axis === 'v' ? [ix(xs, q.pos), ys] : [ix(ys, q.pos), xs];
    const k0 = ix(run, q.from),
      k1 = ix(run, q.to);
    const cls = (k: number) => sides(q.axis, line, k);
    const point = (k: number) => (q.axis === 'v' ? `${line},${k}` : `${k},${line}`);
    // An end inside on the outline: on the inner face of the outer wall there, or the outer face where it is open
    const end = (k: number, dir: -1 | 1) => (onOutline.has(point(k)) ? (openAcross(q.axis, line, k) ? dir : -dir) * (t / 2) : 0);
    for (let k = k0; k < k1; ) {
      const c = cls(k);
      let e = k + 1;
      while (e < k1 && cls(e) === c) e++;
      if (c !== 1) {
        let from = run[k],
          to = run[e];
        // (unless the wall goes on as outer wall in its line: the corner of a stepped board)
        if (c === 2) {
          if (!(k > k0 && cls(k - 1) === 1)) from += end(k, -1);
          if (!(e < k1 && cls(e) === 1)) to += end(e, 1);
        }
        if (to - from > 1e-9) pieces.push({ id: q.id, axis: q.axis, pos: q.pos, from, to });
      }
      k = e;
    }
  }
  return { ok: true, pts, edgeWall, open, pieces };
}
