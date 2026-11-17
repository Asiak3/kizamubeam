// Stencil bridges (#311): the counters of letters and the inner parts of closed shapes (O, A, B, 4, 8, a ring in a
// ring) are islands of sheet that fall out when the shapes are cut from a stencil. This path tool cuts bridges
// through the stroke around each island, so it stays connected to the sheet. Shapes are read by the even-odd rule
// (as the app cuts them); the bridges are subtracted with the app's boolean operation, so the result is closed
// paths again. Coordinates are mm, y down.
import { definePathTool, host, type Issue, type Node, type Pt, type SubPath, type Text } from '../../sdk/ts';

interface P {
  [k: string]: number | string | boolean;
  width: number;
  count: string;
  autoSize: number;
  direction: string;
  nested: boolean;
  minArea: number;
}

type Poly = Pt[];
/** Direction of a bridge from its island outwards: axis of the lines (x = vertical lines) and sign along them */
interface Dir {
  vertical: boolean;
  sign: -1 | 1;
}
const UP: Dir = { vertical: true, sign: -1 };
const DOWN: Dir = { vertical: true, sign: 1 };
const LEFT: Dir = { vertical: false, sign: -1 };
const RIGHT: Dir = { vertical: false, sign: 1 };
const opposite = (d: Dir): Dir => ({ vertical: d.vertical, sign: d.sign === 1 ? -1 : 1 });

/** A closed sub-path as a polygon; curves sampled finely enough for finding islands and bridge lengths */
function flatten(s: SubPath): Poly {
  const out: Poly = [];
  const n = s.nodes.length;
  for (let i = 0; i < n; i++) {
    const a: Node = s.nodes[i];
    const b: Node = s.nodes[(i + 1) % n];
    out.push({ x: a.x, y: a.y });
    if (i === n - 1 && !s.closed) break;
    if (!a.cout && !b.cin) continue;
    const c1 = a.cout ?? a, c2 = b.cin ?? b;
    for (let k = 1; k < 16; k++) {
      const t = k / 16, u = 1 - t;
      out.push({
        x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
        y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
      });
    }
  }
  return out;
}

const area = (p: Poly) => {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j].x * p[i].y - p[i].x * p[j].y;
  return Math.abs(s / 2);
};
function inside(p: Poly, q: Pt): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j], b = p[i];
    if (a.y > q.y !== b.y > q.y && q.x < a.x + ((q.y - a.y) * (b.x - a.x)) / (b.y - a.y)) c = !c;
  }
  return c;
}
const bbox = (p: Poly) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  return { x0, y0, x1, y1 };
};

/** Where the line (x = c for vertical lines, y = c otherwise) crosses the polygons, sorted along the line */
function crossings(polys: Poly[], vertical: boolean, c: number): number[] {
  const out: number[] = [];
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const a = p[j], b = p[i];
      const [au, av, bu, bv] = vertical ? [a.x, a.y, b.x, b.y] : [a.y, a.x, b.y, b.x];
      if (au > c !== bu > c) out.push(av + ((c - au) * (bv - av)) / (bu - au));
    }
  return out.sort((p, q) => p - q);
}

/** Overshoot of a bridge beyond the stroke, so it cuts cleanly through (mm) */
const OVER = 0.1;

/**
 * The bridge of an island in a direction: the stretch of material (even-odd over all outlines) next to the island
 * along lines across the bridge's width, or null when a line finds none. lo … hi along the lines, c across.
 */
function bridge(all: Poly[], hole: Poly, d: Dir, w: number): { lo: number; hi: number; c: number; len: number } | null {
  const b = bbox(hole);
  const c = d.vertical ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
  let lo = Infinity, hi = -Infinity, hits = 0;
  for (let k = -4; k <= 4; k++) {
    const line = c + (k / 4) * (w / 2) * 0.98;
    const hs = crossings([hole], d.vertical, line);
    if (hs.length < 2) {
      if (k === 0) return null;
      continue;
    }
    const edge = d.sign < 0 ? hs[0] : hs[hs.length - 1];
    const at = edge + d.sign * 1e-4;
    const xs = crossings(all, d.vertical, line);
    let found: [number, number] | null = null;
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i] <= at && at <= xs[i + 1]) found = [xs[i], xs[i + 1]];
    if (!found) {
      if (k === 0) return null;
      continue;
    }
    hits++;
    const [a, z] = d.sign < 0 ? [found[0], edge] : [edge, found[1]];
    lo = Math.min(lo, a);
    hi = Math.max(hi, z);
  }
  if (!hits) return null;
  return { lo: lo - OVER, hi: hi + OVER, c, len: hi - lo };
}

const rect = (d: Dir, r: { lo: number; hi: number; c: number }, w: number): SubPath => {
  const [c0, c1] = [r.c - w / 2, r.c + w / 2];
  const pts: Pt[] = d.vertical
    ? [{ x: c0, y: r.lo }, { x: c1, y: r.lo }, { x: c1, y: r.hi }, { x: c0, y: r.hi }]
    : [{ x: r.lo, y: c0 }, { x: r.hi, y: c0 }, { x: r.hi, y: c1 }, { x: r.lo, y: c1 }];
  return { closed: true, nodes: pts };
};

const DIRS: Record<string, Dir[]> = { vertical: [UP, DOWN], horizontal: [LEFT, RIGHT], shortest: [UP, DOWN, LEFT, RIGHT] };

definePathTool<P>({
  apply({ params: p, objects }) {
    const issues: Issue[] = [];
    const out: { from: string; subs: SubPath[] }[] = [];
    let islands = 0, bridges = 0, nestedLeft = 0, narrow = 0, failed = 0;
    for (const o of objects) {
      const closed = o.subs.filter((s) => s.closed && s.nodes.length >= 3);
      const open = o.subs.filter((s) => !s.closed || s.nodes.length < 3);
      const polys = closed.map(flatten);
      // Depth of each outline: how many others enclose it. Odd depth: the inside of a hole, an island of sheet
      const holes = polys
        .map((poly, i) => ({ poly, depth: polys.filter((q, j) => j !== i && inside(q, poly[0])).length }))
        .filter((h) => h.depth % 2 === 1 && area(h.poly) >= p.minArea);
      const cuts: SubPath[] = [];
      for (const h of holes) {
        if (h.depth > 1 && !p.nested) {
          nestedLeft++;
          continue;
        }
        islands++;
        const b = bbox(h.poly);
        const size = Math.max(b.x1 - b.x0, b.y1 - b.y0);
        const two = p.count === '2' || (p.count === 'auto' && size >= p.autoSize);
        // The shortest candidate first; with two bridges the opposite one as well
        const found = DIRS[p.direction]
          .map((d) => ({ d, r: bridge(polys, h.poly, d, p.width) }))
          .filter((x): x is { d: Dir; r: NonNullable<ReturnType<typeof bridge>> } => !!x.r)
          .sort((a, z) => a.r.len - z.r.len);
        if (!found.length) {
          failed++;
          continue;
        }
        const first = found[0];
        const chosen = [first];
        if (two) {
          const back = opposite(first.d);
          const r = bridge(polys, h.poly, back, p.width);
          if (r) chosen.push({ d: back, r });
        }
        for (const x of chosen) {
          const across = x.d.vertical ? b.x1 - b.x0 : b.y1 - b.y0;
          if (across < p.width) narrow++;
          cuts.push(rect(x.d, x.r, p.width));
          bridges++;
        }
      }
      if (!cuts.length) {
        out.push({ from: o.id, subs: o.subs });
        continue;
      }
      const cut = host.boolean({ op: 'difference', a: closed, b: cuts });
      out.push({ from: o.id, subs: [...cut, ...open] });
    }
    if (!objects.some((o) => o.subs.some((s) => s.closed))) issues.push({ level: 'error', code: 'no-closed' });
    else if (!islands && !nestedLeft) issues.push({ level: 'warn', code: 'no-islands' });
    if (nestedLeft) issues.push({ key: 'nested', level: 'warn', code: 'nested-left', values: { n: nestedLeft } });
    if (narrow) issues.push({ key: 'width', level: 'warn', code: 'narrow', values: { n: narrow } });
    if (failed) issues.push({ level: 'warn', code: 'failed', values: { n: failed } });
    const info: [Text, Text][] = [
      [{ code: 'info.islands' }, String(islands)],
      [{ code: 'info.bridges' }, String(bridges)],
    ];
    return { objects: issues.some((i) => i.level === 'error') ? undefined : out, issues, info };
  },
});
