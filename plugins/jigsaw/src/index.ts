// Jigsaw puzzle generator (#307): a grid of interlocking pieces, one cut line per grid line so no edge is cut
// twice, an outer border with optional rounded corners, an optional frame and piece numbers to engrave.
// The same seed always gives the same puzzle.
import { definePlugin, mm, random, roundedRect, strokeText, type Issue, type Node, type Part, type SubPath } from '../../sdk/ts';

interface P {
  [k: string]: number | string | boolean;
  width: number;
  height: number;
  cols: number;
  rows: number;
  seed: number;
  tab: number;
  jitter: number;
  shape: string;
  corner: number;
  frame: boolean;
  frameWidth: number;
  numbers: boolean;
  numberSize: number;
}

type V = [number, number];
/** One tab node in edge coordinates: u along the edge (mm), v across it (mm), with handles */
interface TabNode {
  p: V;
  cin?: V;
  cout?: V;
}

/** Tab outline from u = c - w … c + w on an edge, height h, as nodes in edge coordinates (v > 0 = tab side) */
function tabNodes(shape: string, c: number, w: number, h: number): TabNode[] {
  if (shape === 'square') {
    const n = w * 0.3, s = w * 0.5;
    return [{ p: [c - n, 0] }, { p: [c - n, h * 0.35] }, { p: [c - s, h * 0.35] }, { p: [c - s, h] }, { p: [c + s, h] }, { p: [c + s, h * 0.35] }, { p: [c + n, h * 0.35] }, { p: [c + n, 0] }];
  }
  if (shape === 'round') {
    // A neck and a round head built from four quarter arcs
    const r = Math.min(w * 0.45, h * 0.5), n = r * 0.55, cy = h - r, k = r * 0.5523;
    return [
      { p: [c - n, 0], cout: [c - n, cy * 0.5] },
      { p: [c - r, cy], cin: [c - r, cy - k], cout: [c - r, cy + k] },
      { p: [c, cy + r], cin: [c - k, cy + r], cout: [c + k, cy + r] },
      { p: [c + r, cy], cin: [c + r, cy + k], cout: [c + r, cy - k] },
      { p: [c + n, 0], cin: [c + n, cy * 0.5] },
    ];
  }
  // classic: narrow neck, wide head
  return [
    { p: [c - w * 0.25, 0], cout: [c - w * 0.15, h * 0.3] },
    { p: [c - w * 0.5, h * 0.6], cin: [c - w * 0.6, h * 0.3], cout: [c - w * 0.4, h * 0.95] },
    { p: [c, h], cin: [c - w * 0.3, h], cout: [c + w * 0.3, h] },
    { p: [c + w * 0.5, h * 0.6], cin: [c + w * 0.4, h * 0.95], cout: [c + w * 0.6, h * 0.3] },
    { p: [c + w * 0.25, 0], cin: [c + w * 0.15, h * 0.3] },
  ];
}

const pt = ([x, y]: V) => ({ x, y });

definePlugin<P>({
  validate(p) {
    const out: Issue[] = [];
    const cell = Math.min(p.width / p.cols, p.height / p.rows);
    if (cell < 8) out.push({ key: 'cols', level: 'error', code: 'pieces-too-small', values: { min: 8 } });
    if (p.corner * 2 > Math.min(p.width, p.height) / 2) out.push({ key: 'corner', level: 'error', code: 'corner-too-large' });
    if (p.numbers && p.numberSize > cell * 0.3) out.push({ key: 'numberSize', level: 'warn', code: 'numbers-large' });
    if (p.corner > cell * 0.6) out.push({ key: 'corner', level: 'warn', code: 'corner-cuts-pieces' });
    return out;
  },
  generate(p) {
    const W = p.width, H = p.height, cols = p.cols, rows = p.rows;
    const cw = W / cols, ch = H / rows;
    const cell = Math.min(cw, ch);
    const rnd = random(p.seed);
    const j = p.jitter / 100;
    // Grid corners; inner ones move a little with the jitter so the pieces are less regular
    const grid: V[][] = [];
    for (let r = 0; r <= rows; r++) {
      const line: V[] = [];
      for (let c = 0; c <= cols; c++) {
        // A corner on the border only slides along it
        const dx = c > 0 && c < cols ? (rnd() - 0.5) * j * 0.2 * cw : 0;
        const dy = r > 0 && r < rows ? (rnd() - 0.5) * j * 0.2 * ch : 0;
        line.push([-W / 2 + c * cw + dx, -H / 2 + r * ch + dy]);
      }
      grid.push(line);
    }
    const tabW = (cell * p.tab) / 100;
    /** Nodes of one edge from a to b with a tab (without the end point b) */
    const edge = (a: V, b: V): Node[] => {
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const L = Math.hypot(ex, ey);
      const ux = ex / L, uy = ey / L;
      const side = rnd() < 0.5 ? 1 : -1;
      const c = L * (0.5 + (rnd() - 0.5) * j * 0.3);
      const w = tabW * (1 + (rnd() - 0.5) * j * 0.3);
      const h = tabW * 0.8 * (1 + (rnd() - 0.5) * j * 0.3);
      const map = ([u, v]: V): V => [a[0] + ux * u - uy * v * side, a[1] + uy * u + ux * v * side];
      const nodes: Node[] = [{ ...pt(a) }];
      for (const n of tabNodes(p.shape, c, w, h)) {
        const node: Node = pt(map(n.p));
        if (n.cin) node.cin = pt(map(n.cin));
        if (n.cout) node.cout = pt(map(n.cout));
        nodes.push(node);
      }
      return nodes;
    };
    const subs: SubPath[] = [roundedRect(W, H, p.corner)];
    // Inner grid lines, one open path each: rows of horizontal edges, then columns of vertical edges
    for (let r = 1; r < rows; r++) {
      const nodes: Node[] = [];
      for (let c = 0; c < cols; c++) nodes.push(...edge(grid[r][c], grid[r][c + 1]));
      nodes.push(pt(grid[r][cols]));
      subs.push({ closed: false, nodes });
    }
    for (let c = 1; c < cols; c++) {
      const nodes: Node[] = [];
      for (let r = 0; r < rows; r++) nodes.push(...edge(grid[r][c], grid[r + 1][c]));
      nodes.push(pt(grid[rows][c]));
      subs.push({ closed: false, nodes });
    }
    const puzzle: Part = { key: 'puzzle', subs, at: { x: 0, y: 0 } };
    if (p.numbers) {
      const marks: SubPath[] = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const q = [grid[r][c], grid[r][c + 1], grid[r + 1][c], grid[r + 1][c + 1]];
          const x = q.reduce((s, v) => s + v[0], 0) / 4, y = q.reduce((s, v) => s + v[1], 0) / 4;
          marks.push(...strokeText(String(r * cols + c + 1), p.numberSize, { x, y, align: 'center', valign: 'middle' }));
        }
      puzzle.marks = marks;
    }
    const parts: Part[] = [puzzle];
    if (p.frame) {
      const f = p.frameWidth;
      parts.push({ key: 'frame', subs: [roundedRect(W + 2 * f, H + 2 * f, p.corner > 0 ? p.corner + f : 0), roundedRect(W + 0.2, H + 0.2, p.corner)], at: { x: W + f + 10, y: 0 } });
    }
    const cut = subs.reduce((s, sp) => s + length(sp), 0);
    return {
      parts,
      info: [
        ['pieces', String(cols * rows)],
        ['piece-size', `${mm(cw)} × ${mm(ch)} mm`],
        ['cut-length', `${mm(cut / 1000)} m`],
      ],
    };
  },
});

/** Approximate length of a path (Bézier segments sampled) */
function length(s: SubPath): number {
  let sum = 0;
  const n = s.nodes.length;
  const segs = s.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = s.nodes[i], b = s.nodes[(i + 1) % n];
    const c1 = a.cout ?? a, c2 = b.cin ?? b;
    let prev = { x: a.x, y: a.y };
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, mt = 1 - t;
      const x = mt * mt * mt * a.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * b.x;
      const y = mt * mt * mt * a.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * b.y;
      sum += Math.hypot(x - prev.x, y - prev.y);
      prev = { x, y };
    }
  }
  return sum;
}
