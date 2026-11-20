// Wall model of the box composer: reading the stored layout, scaling, merging, and what happens at every wall end.
// Pure computation, no host functions, so it can be tested in Node.
//
// The outer walls are walls of the list like the others (#451): buildModel finds what they enclose (the box, a polygon
// with right angles, outline.ts) and hands the walls, as the parts are built from them, to the model of the rectangle
// (inner walls ending on the inner faces of the four outer walls) or of a shaped outline (legacyModel): walls end on
// its edges (T into the outer wall there), and a wall that goes on in line with an edge past a corner of the outline
// makes one board with it ("step": full height outside, the wall's height inside). An open side of the rectangle has
// no wall; the box ends there on the line of its outer wall.
//
// Walls lie on their centre line, in mm, x to the right from the inside of the left wall, y to the front from the
// inside of the back wall (0 … w across, 0 … d deep inside the rectangle; its outer walls at −t/2 and w + t/2).
// A wall "h" runs along x at y = pos from x = from to x = to, a wall "v" along y at x = pos from y = from to y = to.
// A wall ending on another one ends on its centre line, on outer walls too.

import { bbox, edges as outlineEdges, isRect, reachCorner, rectOutline, region, where, type OEdge, type Pt } from './outline';

export type Axis = 'h' | 'v';
export interface Wall {
  id: number;
  axis: Axis;
  pos: number;
  from: number;
  to: number;
  /** An outer wall that is not built: the box is open there (#451) */
  open?: boolean;
}
/** The stored layout: the inner size the walls were placed in, and the walls (outer walls too); which sides of the
 * rectangle have an outer wall (none: all) */
export interface Layout {
  ref: [number, number];
  walls: Wall[];
  sides?: Record<Side, boolean>;
}
/** Side of the inner rectangle: x0 = left (x = 0), x1 = right, y0 = back (y = 0), y1 = front */
export type Side = 'x0' | 'x1' | 'y0' | 'y1';
/** What a wall end meets */
export type End =
  | { kind: 'outer'; side: Side }
  | { kind: 'tee'; host: number }
  | { kind: 'corner'; other: number }
  | { kind: 'free' }
  /** Shaped outline: T into the outer wall on edge `edge` */
  | { kind: 'edge'; edge: number }
  /** Shaped outline: the wall goes on in line with edge `edge` past its corner; both are one board (the wall up to at:
   * the outer face of an open edge at that corner) */
  | { kind: 'step'; edge: number; at?: number }
  /** Shaped outline: on the open edge `edge`, at its outer face (the edge of the floor) */
  | { kind: 'open'; edge: number }
  /** Shaped outline: at the end of the board of edge `edge`, where the outline goes on open in line: a corner */
  | { kind: 'board'; edge: number };
/** A wall with what happens along it: its two ends, walls that end on it (T) and walls that cross it */
export interface WallInfo {
  wall: Wall;
  start: End;
  end: End;
  /** Walls ending on this one: position along this wall, the wall, and the side it comes from (-1 = smaller pos) */
  tees: { at: number; wall: number; side: -1 | 1 }[];
  crosses: { at: number; wall: number }[];
}
export interface ModelIssue {
  level: 'error' | 'warn';
  code: string;
  values?: Record<string, number>;
}
/** What happens at an end of an outline edge: a corner with the next edge (fingers), the board goes on as wall
 * `wall` (step), or the edge ends in a T on the board of edge `edge` (the other edge of a step corner) */
export type OEnd =
  | { kind: 'corner'; edge: number }
  | { kind: 'through'; wall: number; cross?: number; at?: number }
  | { kind: 'into'; edge: number }
  /** The other edge of the corner is open: the board covers the corner up to its outer face (at, along the edge) */
  | { kind: 'open'; edge: number; at: number }
  /** The outline goes on open in line: the board ends there, in a corner with the wall that meets it there */
  | { kind: 'line'; wall?: number };
export interface OEdgeInfo extends OEdge {
  /** No board: the box is open there */
  open: boolean;
  start: OEnd;
  end: OEnd;
  /** Walls ending on this edge (T): position along it and the wall */
  tees: { at: number; wall: number }[];
}
export interface Model {
  w: number;
  d: number;
  walls: WallInfo[];
  issues: ModelIssue[];
  /** Shaped outline (none for the rectangle; in the model the parts are built from) */
  outline?: { pts: Pt[]; edges: OEdgeInfo[] };
  /** What the walls enclose, when they do (buildModel) */
  box?: Box;
}
/**
 * The box the walls enclose: its outline, the model the parts are built from (legacyModel: the inner walls in their own
 * inner size, coordinates moved by shift so that the outline's bounding box starts at −t/2), which wall lies on each
 * edge of the outline and which edges are open, the sides of a rectangle that have their outer wall, and the wall each
 * wall of that model comes from (a wall may give several)
 */
export interface Box {
  pts: Pt[];
  model: Model;
  size: [number, number];
  shift: [number, number];
  edgeWall: number[];
  open: boolean[];
  sides: Record<Side, boolean>;
  src: Map<number, number>;
}

/** Most walls in a layout, most characters of the stored text */
export const MAX_WALLS = 100;
export const MAX_TEXT = 100_000;
/** Two positions closer than this count as the same point (mm) */
export const EPS = 0.01;

const parse = (text: string): { v: unknown } | null => {
  if (typeof text !== 'string' || text.length > MAX_TEXT) return null;
  try {
    return { v: text ? JSON.parse(text) : undefined };
  } catch {
    return null;
  }
};

/**
 * Read the stored layout from its two parameters: the walls, a JSON list of rows as the dialog's list keeps them
 * (`[{ id, axis, pos, from, to }]`), and the inner size they were placed in (`[w, d]`, empty = never scaled).
 * null when it cannot be read (broken JSON, wrong shape, too large).
 */
export function readLayout(wallsText: string, refText = ''): Layout | null {
  const a = parse(wallsText),
    b = parse(refText);
  if (!a || !b) return null;
  const walls = a.v ?? [],
    ref = b.v;
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  if (ref !== undefined && !(Array.isArray(ref) && ref.length === 2 && ref.every((x) => num(x) && x > 0))) return null;
  if (!Array.isArray(walls) || walls.length > MAX_WALLS) return null;
  const out: Wall[] = [];
  const ids = new Set<number>();
  for (const x of walls) {
    if (!x || typeof x !== 'object') return null;
    const q = x as Record<string, unknown>;
    if (!num(q.id) || !Number.isInteger(q.id) || q.id < 1 || ids.has(q.id)) return null;
    if (q.axis !== 'h' && q.axis !== 'v') return null;
    if (!num(q.pos) || !num(q.from) || !num(q.to)) return null;
    ids.add(q.id);
    out.push({ id: q.id, axis: q.axis, pos: q.pos, from: Math.min(q.from, q.to), to: Math.max(q.from, q.to), ...(q.open === true ? { open: true } : {}) });
  }
  return { ref: (ref as [number, number] | undefined) ?? [0, 0], walls: out };
}

/** The layout as the values of its two parameters */
export const writeLayout = (l: Layout) => ({
  walls: JSON.stringify(l.walls.map((w) => ({ id: w.id, axis: w.axis, pos: r3(w.pos), from: r3(w.from), to: r3(w.to), ...(w.open ? { open: true } : {}) }))),
  wallsRef: l.ref[0] > 0 && l.ref[1] > 0 ? JSON.stringify(l.ref.map(r3)) : '',
});
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Scale the walls proportionally from the reference size to the inner size w × d (sizes changed outside the dialog);
 * outside the inner rectangle (the outer walls on its edge) they keep their distance from it
 */
export function scaleLayout(l: { ref: [number, number]; walls: Wall[] }, w: number, d: number): Wall[] {
  const [rw, rd] = l.ref;
  if (!(rw > 0 && rd > 0) || (Math.abs(rw - w) < 1e-9 && Math.abs(rd - d) < 1e-9)) return l.walls.map((x) => ({ ...x }));
  const sx = w / rw,
    sy = d / rd;
  const fx = (v: number) => (v < 0 ? v : v > rw ? v - rw + w : v * sx),
    fy = (v: number) => (v < 0 ? v : v > rd ? v - rd + d : v * sy);
  return l.walls.map((x) => (x.axis === 'h' ? { ...x, pos: fy(x.pos), from: fx(x.from), to: fx(x.to) } : { ...x, pos: fx(x.pos), from: fy(x.from), to: fy(x.to) }));
}

/** Join walls on the same line that touch or overlap, built with built and open with open; the joined wall keeps the
 * oldest (smallest) id */
export function mergeWalls(walls: Wall[]): Wall[] {
  const rest = [...walls].sort((a, b) => a.id - b.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rest.length && !changed; i++)
      for (let j = i + 1; j < rest.length && !changed; j++) {
        const a = rest[i],
          b = rest[j];
        if (a.axis === b.axis && !a.open === !b.open && Math.abs(a.pos - b.pos) < EPS && a.from <= b.to + EPS && b.from <= a.to + EPS) {
          rest[i] = { ...a, from: Math.min(a.from, b.from), to: Math.max(a.to, b.to) };
          rest.splice(j, 1);
          changed = true;
        }
      }
  }
  return rest;
}

/** Inner size along a wall and across it */
const along = (a: Axis, w: number, d: number) => (a === 'h' ? w : d);
const across = (a: Axis, w: number, d: number) => (a === 'h' ? d : w);

/** Smallest sizes, all in mm: thickness t; gap = clear space between two walls, between the slots of two joints on
 * a wall, or between a joint and a wall end; minLen = shortest wall; freeLen = clear length from a free end to the
 * face of the nearest joint */
export interface Limits {
  t: number;
  gap: number;
  minLen: number;
  freeLen: number;
}

/**
 * The model of the inner walls in the rectangle w × d or in a shaped outline (ends on an outer wall at its inner face,
 * as the parts are built): walls scaled, merged and checked, every end classified. buildModel hands the walls to it.
 */
export function legacyModel(l: { ref: [number, number]; walls: Wall[]; outline?: Pt[] | null; open?: boolean[] }, w: number, d: number, lim: Limits): Model {
  const { t, gap, minLen } = lim;
  const issues: ModelIssue[] = [];
  const err = (code: string, values?: Record<string, number>) => issues.push({ level: 'error', code, ...(values ? { values } : {}) });
  const walls = mergeWalls(scaleLayout(l, w, d));
  if (l.outline) return shapedModel(l.outline, walls, w, d, lim, l.open);

  // Lage im Innenrechteck (Wände liegen auf ihrer Mittellinie, die Innenseite der Außenwand bei 0)
  const inside: Wall[] = [];
  for (const x of walls) {
    const len = along(x.axis, w, d),
      wid = across(x.axis, w, d);
    if (x.pos < -EPS || x.pos > wid + EPS || x.from < -EPS || x.to > len + EPS) err('wall-outside', { id: x.id });
    else if (x.pos < EPS || x.pos > wid - EPS) err('wall-on-outer', { id: x.id });
    else if (x.to - x.from < minLen) err('wall-short', { id: x.id, min: minLen });
    else {
      if (x.pos - t / 2 < gap - EPS || wid - x.pos - t / 2 < gap - EPS) err('wall-near-outer', { id: x.id, min: gap });
      inside.push({ ...x, from: Math.max(0, x.from), to: Math.min(len, x.to) });
    }
  }

  const info = new Map<number, WallInfo>(inside.map((x) => [x.id, { wall: x, start: { kind: 'free' }, end: { kind: 'free' }, tees: [], crosses: [] }]));
  const perp = (x: Wall) => inside.filter((q) => q.axis !== x.axis);

  // Was an jedem Ende passiert
  for (const x of inside) {
    const it = info.get(x.id)!;
    for (const which of ['start', 'end'] as const) {
      const e = which === 'start' ? x.from : x.to;
      const len = along(x.axis, w, d);
      let end: End = { kind: 'free' };
      if (e < EPS) end = { kind: 'outer', side: x.axis === 'h' ? 'x0' : 'y0' };
      else if (e > len - EPS) end = { kind: 'outer', side: x.axis === 'h' ? 'x1' : 'y1' };
      else {
        const host = perp(x).find((q) => Math.abs(q.pos - e) < EPS && q.from - EPS <= x.pos && x.pos <= q.to + EPS);
        if (host) {
          if (x.pos > host.from + EPS && x.pos < host.to - EPS) {
            end = { kind: 'tee', host: host.id };
            info.get(host.id)!.tees.push({ at: x.pos, wall: x.id, side: which === 'start' ? 1 : -1 });
          } else end = { kind: 'corner', other: host.id };
        } else if (e < gap - EPS || len - e < gap - EPS) err('wall-gap', { id: x.id, min: gap });
        else if (perp(x).some((q) => Math.abs(q.pos - e) - t / 2 < gap - EPS && q.from - gap - t / 2 < x.pos && x.pos < q.to + gap + t / 2))
          err('wall-gap', { id: x.id, min: gap });
      }
      it[which] = end;
    }
  }

  wallChecks(inside, info, lim, err);
  return { w, d, walls: [...info.values()], issues: dedupe(issues) };
}

/** The same issue for the same walls only once */
function dedupe(list: ModelIssue[]): ModelIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = i.code + JSON.stringify(i.values ?? {});
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** The user's sketch (#327): one divider across, one crossing it and turning into a corner, one ending free */
export function sampleLayout(w: number, d: number): Layout {
  return {
    ref: [w, d],
    walls: [
      { id: 1, axis: 'h', pos: d / 2, from: 0, to: w },
      { id: 2, axis: 'v', pos: w / 2, from: 0, to: d * 0.775 },
      { id: 3, axis: 'h', pos: d * 0.775, from: w / 2, to: w },
      { id: 4, axis: 'v', pos: w * 0.21, from: d / 2, to: d * 0.875 },
    ],
  };
}

/** Two numbers closer than EPS */
const near = (a: number, b: number) => Math.abs(a - b) < EPS;

/**
 * The model in a shaped outline (#451): as buildModel, with the outline's edges in place of the four outer walls.
 * Ends on an edge's inner face are T joints into it; an end at a corner of the outline, in line with an edge, makes the
 * wall one board with that edge (step). An open edge (open[k]: no board, the floor reaches its outer face) takes the
 * walls ending on it to its outer face; where the outline goes on open in line with a board (a stretch of an outer wall
 * left open), a wall ending there meets the board's end in a corner. The outline itself: edges long enough for their
 * corner joints, parallel edges far enough apart.
 */
function shapedModel(pts: Pt[], given: Wall[], w: number, d: number, lim: Limits, open: boolean[] = []): Model {
  const { t, gap, minLen } = lim;
  const issues: ModelIssue[] = [];
  const err = (code: string, values?: Record<string, number>) => issues.push({ level: 'error', code, ...(values ? { values } : {}) });
  const es = outlineEdges(pts);
  const isOpen = (e: OEdge) => !!open[e.k];
  const built = es.filter((e) => !isOpen(e));
  const face = (e: OEdge) => e.pos + (e.inside * t) / 2;
  const outerFace = (e: OEdge) => e.pos - (e.inside * t) / 2;
  const name = (e: OEdge) => e.k + 1;
  // The edge that goes on in line from edge e at its end v (the outline goes on open there), if any
  const inLine = (e: OEdge, v: number) => es.find((q) => q.k !== e.k && q.axis === e.axis && near(q.pos, e.pos) && (near(q.from, v) || near(q.to, v)));
  // Wände, die kurz vor einer Ecke in der Linie einer Außenwand enden, reichen bis zur Ecke (ein Brett mit ihr)
  const walls = given.map((x) => reachCorner(x, built, t));

  // Die Kontur: gegenüberliegende Bretter weit genug auseinander (die Länge der Kanten unten, wenn ihre Enden bekannt sind)
  for (let i = 0; i < built.length; i++)
    for (let j = i + 1; j < built.length; j++) {
      const a = built[i],
        b = built[j];
      if (a.axis === b.axis && Math.abs(a.pos - b.pos) - t < gap - EPS && Math.min(a.to, b.to) - Math.max(a.from, b.from) > EPS)
        err('outline-narrow', { edge: name(a), edge2: name(b), min: gap });
    }

  // An end of wall x at a that reaches the outer face of an open edge across it
  const openAt = (x: Wall, a: number) => es.find((q) => isOpen(q) && q.axis !== x.axis && x.pos > q.from - EPS && x.pos < q.to + EPS && near(outerFace(q), a));
  // Lage: ganz innen (bis an offene Kanten), nicht auf einer Außenwand, mit Abstand zu parallelen Brettern
  const inside: Wall[] = [];
  const at = (x: Wall, a: number): [number, number] => (x.axis === 'h' ? [a, x.pos] : [x.pos, a]);
  const whereOn = (x: Wall, a: number) => {
    const [px, py] = at(x, a);
    return where(pts, px, py, es);
  };
  for (const x of walls) {
    const f = openAt(x, x.from)?.pos ?? x.from,
      z = openAt(x, x.to)?.pos ?? x.to;
    const marks = [...new Set([f, z, ...es.filter((e) => e.axis !== x.axis).map((e) => e.pos)])].filter((a) => a >= f && a <= z).sort((a, b) => a - b);
    const mids = marks.slice(1).map((b, i) => (marks[i] + b) / 2);
    const on = es.some((e) => e.axis === x.axis && near(e.pos, x.pos) && Math.min(e.to, x.to) - Math.max(e.from, x.from) > EPS);
    if (on) err('wall-on-outer', { id: x.id });
    else if (mids.some((a) => whereOn(x, a) !== 'in') || [f, z].some((a) => whereOn(x, a) === 'out')) err('wall-outside', { id: x.id });
    else if (x.to - x.from < minLen) err('wall-short', { id: x.id, min: minLen });
    else {
      const close = built.some((e) => e.axis === x.axis && !near(e.pos, x.pos) && Math.abs(e.pos - x.pos) - t < gap - EPS && Math.min(x.to, e.to) - Math.max(x.from, e.from) > -gap);
      if (close) err('wall-near-outer', { id: x.id, min: gap });
      inside.push(x);
    }
  }

  const info = new Map<number, WallInfo>(inside.map((x) => [x.id, { wall: x, start: { kind: 'free' }, end: { kind: 'free' }, tees: [], crosses: [] }]));
  const oTees = new Map<number, { at: number; wall: number }[]>(es.map((e) => [e.k, []]));
  // Walls meeting the end of a board where the outline goes on open in line with it: by edge and end of the edge
  const atLine = new Map<string, number>();
  const perp = (x: Wall) => inside.filter((q) => q.axis !== x.axis);

  for (const x of inside) {
    const it = info.get(x.id)!;
    // Wo die Linie der Wand auf Bretter trifft (deren Innenseite)
    const hits = built.filter((e) => e.axis !== x.axis && x.pos > e.from + EPS && x.pos < e.to - EPS);
    for (const which of ['start', 'end'] as const) {
      const e = which === 'start' ? x.from : x.to;
      let end: End = { kind: 'free' };
      const edge = hits.find((q) => near(face(q), e));
      const opened = openAt(x, e);
      // The end of a board, where the outline goes on open in its line
      const board = built.find((q) => q.axis !== x.axis && near(face(q), e) && [q.from, q.to].some((v) => near(x.pos, v) && inLine(q, v)));
      const step = built.find((q) => q.axis === x.axis && near(q.pos, x.pos) && (near(q.from, e) || near(q.to, e)));
      if (edge) {
        end = { kind: 'edge', edge: edge.k };
        oTees.get(edge.k)!.push({ at: x.pos, wall: x.id });
      } else if (opened) end = { kind: 'open', edge: opened.k };
      else if (board) {
        end = { kind: 'board', edge: board.k };
        atLine.set(`${board.k}:${near(x.pos, board.from) ? 'start' : 'end'}`, x.id);
      } else if (step) end = { kind: 'step', edge: step.k };
      else {
        const host = perp(x).find((q) => Math.abs(q.pos - e) < EPS && q.from - EPS <= x.pos && x.pos <= q.to + EPS);
        if (host) {
          if (x.pos > host.from + EPS && x.pos < host.to - EPS) {
            end = { kind: 'tee', host: host.id };
            info.get(host.id)!.tees.push({ at: x.pos, wall: x.id, side: which === 'start' ? 1 : -1 });
          } else end = { kind: 'corner', other: host.id };
        } else if (hits.some((q) => Math.abs(face(q) - e) < gap - EPS)) err('wall-gap', { id: x.id, min: gap });
        else if (perp(x).some((q) => Math.abs(q.pos - e) - t / 2 < gap - EPS && q.from - gap - t / 2 < x.pos && x.pos < q.to + gap + t / 2))
          err('wall-gap', { id: x.id, min: gap });
      }
      it[which] = end;
    }
  }

  // Kreuzungen, zu nahe Wände, T von beiden Seiten, freie Enden: wie im Rechteck
  wallChecks(inside, info, lim, err);

  // Enden der Kanten: Ecke, Brett geht als Wand weiter (Stufe), T auf das Brett der anderen Kante, offene Nachbarkante
  const throughAt = (e: OEdge, v: number) =>
    [...info.values()].find((it) => (['start', 'end'] as const).some((w) => { const q = it[w]; return q.kind === 'step' && q.edge === e.k && near(w === 'start' ? it.wall.from : it.wall.to, v); }));
  const out: OEdgeInfo[] = es.map((e) => ({ ...e, open: isOpen(e), start: { kind: 'corner', edge: -1 }, end: { kind: 'corner', edge: -1 }, tees: oTees.get(e.k)!.sort((a, b) => a.at - b.at) }));
  for (const e of out) {
    if (e.open) continue;
    for (const which of ['start', 'end'] as const) {
      const v = which === 'start' ? e.from : e.to;
      // The outline goes on open in line: the board ends there (at the wall that meets it there, in a corner)
      if (inLine(e, v)) {
        const wall = atLine.get(`${e.k}:${which}`);
        e[which] = { kind: 'line', ...(wall !== undefined ? { wall } : {}) };
        continue;
      }
      // Die andere Kante an diesem Eckpunkt
      const other = es.find((q) => q.axis !== e.axis && (near(q.from, e.pos) || near(q.to, e.pos)) && near(q.pos, v))!;
      const mine = throughAt(e, v),
        theirs = !isOpen(other) && throughAt(other, e.pos);
      // Walls go on from both edges: both boards go through the corner and cross there (cross lap)
      if (mine) {
        // Next to an open edge the board's full height begins at its outer face, the wall reaches it
        const at = isOpen(other) ? outerFace(other) : undefined;
        e[which] = { kind: 'through', wall: mine.wall.id, ...(theirs ? { cross: other.k } : {}), ...(at !== undefined ? { at } : {}) };
        for (const w of ['start', 'end'] as const) {
          const q = mine[w];
          if (at !== undefined && q.kind === 'step' && q.edge === e.k && near(w === 'start' ? mine.wall.from : mine.wall.to, v)) mine[w] = { kind: 'step', edge: e.k, at };
        }
      }
      else if (isOpen(other)) e[which] = { kind: 'open', edge: other.k, at: outerFace(other) };
      else e[which] = theirs ? { kind: 'into', edge: other.k } : { kind: 'corner', edge: other.k };
    }
    // Lang genug: mit Ecken an beiden Enden für die Eckverbindungen; geht das Brett an einem Ende als Wand weiter oder
    // endet es an einer offenen Kante, braucht die Strecke nur die Länge einer kurzen Wand
    const joined = (q: OEnd) => q.kind === 'corner' || q.kind === 'into';
    const need = joined(e.start) && joined(e.end) ? minLen + t : minLen;
    if (e.to - e.from < need - EPS) err('outline-short', { edge: name(e), min: need });
    // T auf der Außenwand: Abstand zwischen den Schlitzen
    for (let i = 0; i + 1 < e.tees.length; i++)
      if (e.tees[i + 1].at - e.tees[i].at - t < gap - EPS) err('walls-close', { id: e.tees[i].wall, id2: e.tees[i + 1].wall, min: gap });
  }
  // Ein T zu nahe an einer Ecke mit Stufe: der Schlitz der Kante, die dort als T endet, liegt im Brett
  for (const e of out)
    for (const which of ['start', 'end'] as const) {
      const q = e[which];
      if (e.open || q.kind !== 'into') continue;
      const host = out[q.edge];
      for (const tee of host.tees) if (Math.abs(tee.at - e.pos) - t < gap - EPS) err('wall-near-outer', { id: tee.wall, min: gap });
    }
  return { w, d, walls: [...info.values()], issues: dedupe(issues), outline: { pts, edges: out } };
}

/**
 * What the walls do among themselves, in the rectangle and in a shaped outline alike: crossings (into info), walls
 * too close to each other, T joints from both sides almost at the same place, free ends too short
 */
function wallChecks(inside: Wall[], info: Map<number, WallInfo>, lim: Limits, err: (code: string, values?: Record<string, number>) => void) {
  const { t, gap, freeLen } = lim;
  // Kreuzungen
  for (const a of inside)
    for (const b of inside)
      if (a.axis === 'v' && b.axis === 'h' && a.pos > b.from + EPS && a.pos < b.to - EPS && b.pos > a.from + EPS && b.pos < a.to - EPS) {
        info.get(a.id)!.crosses.push({ at: b.pos, wall: b.id });
        info.get(b.id)!.crosses.push({ at: a.pos, wall: a.id });
      }

  // Parallele Wände zu nah beieinander (deckt auch Verbindungen ab, die sich auf einer Wand zu nahe kommen: an jeder
  // Verbindung steht eine Querwand, und zwei solche Querwände liegen dann zu dicht)
  for (let i = 0; i < inside.length; i++)
    for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i],
        b = inside[j];
      if (a.axis === b.axis && Math.abs(a.pos - b.pos) - t < gap - EPS && Math.min(a.to, b.to) - Math.max(a.from, b.from) > -gap)
        err('walls-close', { id: a.id, id2: b.id, min: gap });
    }

  // Längs jeder Wand: T von beiden Seiten fast an derselben Stelle; freie Enden lang genug
  for (const it of info.values()) {
    const x = it.wall;
    for (const p of it.tees)
      for (const q of it.tees)
        if (p.wall < q.wall && p.side !== q.side && Math.abs(p.at - q.at) - t < gap - EPS) err('tees-misaligned', { id: p.wall, id2: q.wall, min: gap });
    const marks = [...it.tees.map((p) => p.at), ...it.crosses.map((c) => c.at)];
    for (const [which, e] of [['start', x.from], ['end', x.to]] as const) {
      if (it[which].kind !== 'free') continue;
      const other = which === 'start' ? it.end : it.start;
      const far = which === 'start' ? x.to : x.from;
      // Bis zur Fläche der nächsten Verbindung (oder bis zum anderen Ende, wenn auch das frei ist)
      const stops = [...marks.map((m) => Math.abs(m - e) - t / 2), Math.abs(far - e) - (other.kind === 'free' ? 0 : t / 2)];
      if (Math.min(...stops) < freeLen - EPS) err('free-end-short', { id: x.id, min: freeLen });
    }
  }
}

/** Lines where the open sides of the rectangle end the box (sides false there): added walls (ids −1 … −4) on the edge
 * of the box, as long as the box and the walls there are, so that the walls enclose it */
export function openWalls(walls: Wall[], sides: Record<Side, boolean> | undefined, w: number, d: number, t: number): Wall[] {
  if (!sides || (sides.x0 && sides.x1 && sides.y0 && sides.y1)) return [];
  let x0 = -t / 2,
    y0 = -t / 2,
    x1 = w + t / 2,
    y1 = d + t / 2;
  for (const q of walls) {
    const [a0, a1, b0, b1] = q.axis === 'h' ? [q.from, q.to, q.pos, q.pos] : [q.pos, q.pos, q.from, q.to];
    x0 = Math.min(x0, a0);
    x1 = Math.max(x1, a1);
    y0 = Math.min(y0, b0);
    y1 = Math.max(y1, b1);
  }
  const out: Wall[] = [];
  if (!sides.y0) out.push({ id: -1, axis: 'h', pos: y0, from: x0, to: x1 });
  if (!sides.x1) out.push({ id: -2, axis: 'v', pos: x1, from: y0, to: y1 });
  if (!sides.y1) out.push({ id: -3, axis: 'h', pos: y1, from: x0, to: x1 });
  if (!sides.x0) out.push({ id: -4, axis: 'v', pos: x0, from: y0, to: y1 });
  return out;
}

/**
 * What happens at every wall end among the walls themselves (T, corner or free) and where walls cross: the same for
 * outer walls and the others. The lines of open sides (extra) count as walls to end on, without info of their own.
 */
function graph(walls: Wall[], extra: Wall[]): WallInfo[] {
  const all = [...walls, ...extra];
  const info = new Map<number, WallInfo>(walls.map((x) => [x.id, { wall: x, start: { kind: 'free' }, end: { kind: 'free' }, tees: [], crosses: [] }]));
  for (const x of walls)
    for (const which of ['start', 'end'] as const) {
      const e = which === 'start' ? x.from : x.to;
      const host = all.find((q) => q.axis !== x.axis && Math.abs(q.pos - e) < EPS && q.from - EPS <= x.pos && x.pos <= q.to + EPS);
      let end: End = { kind: 'free' };
      if (host && x.pos > host.from + EPS && x.pos < host.to - EPS) {
        end = { kind: 'tee', host: host.id };
        info.get(host.id)?.tees.push({ at: x.pos, wall: x.id, side: which === 'start' ? 1 : -1 });
      } else if (host) end = { kind: 'corner', other: host.id };
      info.get(x.id)![which] = end;
    }
  for (const a of walls)
    for (const b of walls)
      if (a.axis === 'v' && b.axis === 'h' && a.pos > b.from + EPS && a.pos < b.to - EPS && b.pos > a.from + EPS && b.pos < a.to - EPS) {
        info.get(a.id)!.crosses.push({ at: b.pos, wall: b.id });
        info.get(b.id)!.crosses.push({ at: a.pos, wall: a.id });
      }
  return [...info.values()];
}

/**
 * The model of the walls in the inner size w × d (#451): walls scaled and merged, every end classified among all walls
 * (outer walls too), and the box they enclose with the checks of the model the parts are built from (legacyModel), its
 * issues named after the walls of the list. Without a box (the walls do not close one, or a shaped one with open sides)
 * only that error.
 */
export function buildModel(l: Layout, w: number, d: number, lim: Limits): Model {
  const t = lim.t;
  const walls = mergeWalls(scaleLayout(l, w, d));
  const open = openWalls(walls, l.sides, w, d, t);
  const out: Model = { w, d, walls: graph(walls, open), issues: [] };
  const g = region([...walls, ...open], t);
  if (!g.ok) return { ...out, issues: [{ level: 'error', code: g.code, ...(g.values ? { values: g.values } : {}) }] };
  // The rectangle (each side built or open as a whole: edges top, right, bottom, left) as the box composer builds it;
  // any other outline with its open edges
  const rect = isRect(g.pts);
  // (any other: the sides of the bounding box with a built wall on their line)
  const [b0, b1, b2, b3] = bbox(g.pts);
  const builtOn = (axis: Axis, pos: number) => walls.some((q) => !q.open && q.axis === axis && Math.abs(q.pos - pos) < EPS);
  const sides: Record<Side, boolean> = rect ? { y0: !g.open[0], x1: !g.open[1], y1: !g.open[2], x0: !g.open[3] } : { x0: builtOn('v', b0), x1: builtOn('v', b2), y0: builtOn('h', b1), y1: builtOn('h', b3) };
  // The inner size of the box and the shift that puts its outer walls at −t/2 (none when they are where w × d has them)
  const [x0, y0, x1, y1] = bbox(g.pts);
  const same = Math.abs(x0 + t / 2) < 1e-6 && Math.abs(y0 + t / 2) < 1e-6 && Math.abs(x1 - w - t / 2) < 1e-6 && Math.abs(y1 - d - t / 2) < 1e-6;
  const [sx, sy] = same ? [0, 0] : [-t / 2 - x0, -t / 2 - y0];
  const [lw, ld] = same ? [w, d] : [x1 - x0 - t, y1 - y0 - t];
  // Die Stücke der Wände innen, mit eigener Nummer, wenn eine Wand mehrere gibt; Enden an den Innenseiten genau dort
  const src = new Map<number, number>();
  let next = walls.reduce((m, q) => Math.max(m, q.id), 0) + 1;
  // (the rectangle: a wall reaching an open side ends there on the inner face, as the box composer has it)
  const fit = (v: number, len: number) => (Math.abs(v) < 1e-6 || (rect && v < 0 && v > -t - 1e-6) ? 0 : Math.abs(v - len) < 1e-6 || (rect && v > len && v < len + t + 1e-6) ? len : v);
  const inner: Wall[] = g.pieces.map((q) => {
    const id = src.has(q.id) ? next++ : q.id;
    src.set(id, q.id);
    const [da, dp, len] = q.axis === 'h' ? [sx, sy, lw] : [sy, sx, ld];
    return { id, axis: q.axis, pos: q.pos + dp, from: fit(q.from + da, len), to: fit(q.to + da, len) };
  });
  const pts = rect ? null : g.pts.map(([x, y]): Pt => [x + sx, y + sy]);
  const legacy = legacyModel({ ref: [lw, ld], walls: inner, outline: pts, open: g.open }, lw, ld, lim);
  // Fehler mit den Nummern der Liste; die Außenwände sind Wände wie die anderen
  const id = (v: number) => src.get(v) ?? v;
  const ew = (k: number) => g.edgeWall[k - 1] ?? 0;
  const issues = legacy.issues.map((i): ModelIssue => {
    const v = i.values ?? {};
    if (i.code === 'outline-short') return { level: i.level, code: 'wall-short', values: { id: ew(v.edge), min: v.min } };
    if (i.code === 'outline-narrow') return { level: i.level, code: 'walls-close', values: { id: ew(v.edge), id2: ew(v.edge2), min: v.min } };
    return i.values ? { ...i, values: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' || k === 'id2' ? id(x) : x])) } : i;
  });
  return { ...out, issues: dedupe(issues), box: { pts: g.pts, model: legacy, size: [lw, ld], shift: [sx, sy], edgeWall: g.edgeWall, open: g.open, sides, src } };
}

/**
 * A list of walls without outer walls (a new box: none at all; the sample; lists of the box composer, #385): the
 * outer walls of the rectangle w × d added as walls, after the others (open where sides has none); ends on an outer
 * wall (on its inner face there) go to its centre line. A list with outer walls (they lie before the inside: below 0)
 * comes back as it is.
 */
export function unify(walls: Wall[], w: number, d: number, t: number, sides: Record<Side, boolean>): Wall[] {
  if (walls.some((q) => Math.min(q.pos, q.from) < -EPS)) return walls;
  const out = walls.map((q) => {
    const len = q.axis === 'h' ? w : d;
    return { ...q, from: Math.abs(q.from) < EPS ? -t / 2 : q.from, to: Math.abs(q.to - len) < EPS ? len + t / 2 : q.to };
  });
  let id = walls.reduce((m, q) => Math.max(m, q.id), 0);
  const side = (e: OEdge): Side => (e.axis === 'h' ? (e.pos < 0 ? 'y0' : 'y1') : e.pos < 0 ? 'x0' : 'x1');
  for (const e of outlineEdges(rectOutline(w, d, t))) out.push({ id: ++id, axis: e.axis, pos: e.pos, from: e.from, to: e.to, ...(sides[side(e)] ? {} : { open: true }) });
  return mergeWalls(out);
}
