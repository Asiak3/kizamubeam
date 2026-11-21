// Parts of the box composer from the wall model. Every joint comes from the app (host.joints); this file only
// decides which edges meet and where the slots go.
//
// Box: outer size W × D × H, material t. The inner rectangle (where the walls are placed) lies t inside the outer
// edge. Outer walls, floor and lid are the panels of the box generator. Inner walls stand on the floor; a wall panel
// is drawn in its own plane: x along the wall from its physical start, y down from its top edge to the floor (h).
//
// A shaped outline (#451) has its own outer parts (shapedOuter): one board per edge of the outline, standing on the
// floor between floor and lid, fingers at the corners and into floor and lid, which have the outline's shape. A wall
// that goes on in line with an edge past a corner is part of that edge's board (a stepped board: the outer stretch at
// full height, the wall at its own height), and the other edge of that corner ends in a T on it. An open edge (#451:
// an outer wall left open) has no board: floor and lid reach its outer face there, a board next to it covers the
// corner, walls ending on it reach the edge of the floor, and a wall meeting a board where the outline goes on open in
// line with it makes a corner with the board's end (fingers over the wall's height).
import { host, type JointOptions, type SubPath } from '../../sdk/ts';
import { fields, joint, panel, tenonStretches, tenonsInto, widen, JointError, type Parts, type Pt } from './joints';
import type { End, Model, OEdgeInfo, Side, WallInfo } from './model';
import type { Pt as XY } from './outline';

export interface Dims {
  W: number;
  D: number;
  H: number;
  t: number;
  finger: number;
  /** Total play of a joint (both sides together) */
  clearance: number;
  kerf: number;
  /** Which outer walls the box has (an open side has none) */
  sides: Record<Side, boolean>;
  lid: boolean;
  /** How much lower the inner walls are than the outer walls */
  drop: number;
}
export interface JointMsg {
  code: string;
  values?: Record<string, number | string>;
}
/** One inner wall as a panel: where it starts and ends along its line, its height, the crossings it is slotted for */
export interface WallPanel {
  key: string;
  it: WallInfo;
  /** Physical start and end along the wall (inner coordinates) */
  s: number;
  e: number;
  h: number;
  /** Slotted from the top at crossings (h walls) or from the bottom (v walls) */
  fromTop: boolean;
  /** The part it is drawn in (itself, or the board of an outline edge it goes on from) and where its own coordinates
   * lie in that part */
  part: string;
  ox: number;
  oy: number;
}
/** A board of a shaped outline: the outer walls on one line that are one part, with the walls that go on from them */
export interface Board {
  key: string;
  axis: 'h' | 'v';
  pos: number;
  edges: OEdgeInfo[];
  members: WallPanel[];
  /** Start and end along the line (inner coordinates); the part's x runs from bs */
  bs: number;
  be: number;
  h: number;
}

export const OUTER: Record<Side, string> = { x0: 'left', x1: 'right', y0: 'back', y1: 'front' };
export const wallKey = (id: number) => `wall-${id}`;
export const outerKey = (k: number) => `outer-${k + 1}`;

/** Has the box any outer wall? */
export const anyOuter = (d: Dims) => d.sides.x0 || d.sides.x1 || d.sides.y0 || d.sides.y1;

/** Height of the inner walls */
export const innerHeight = (d: Dims) => (anyOuter(d) ? d.H - d.t - (d.lid ? d.t : 0) - d.drop : d.H - d.t);
/** Height of the boards of a shaped outline: from the floor to the lid (or to the top edge) */
export const outerHeight = (d: Dims) => d.H - d.t - (d.lid ? d.t : 0);

/** Half the length of the edge stretch a lap joint is put on (the slot sits in its middle) */
const lapHalf = (d: Dims) => Math.max(1.5 * d.t, d.t + Math.max(0, d.clearance) + 0.5);

/** Where a wall physically ends: at the outer wall's inner face (or the floor edge on an open side), at the face of
 * a host, at the near face of the corner partner, or where it is drawn (free end; an end on an outline edge lies on
 * its inner face already). dir = -1 for the start, 1 for the end */
function endAt(end: End, at: number, dir: -1 | 1, d: Dims): number {
  if (end.kind === 'outer') return d.sides[end.side] ? at : at + dir * d.t;
  if (end.kind === 'free' || end.kind === 'edge' || end.kind === 'open' || end.kind === 'board') return at;
  if (end.kind === 'step' && end.at !== undefined) return end.at;
  return at - (dir * d.t) / 2;
}

export function wallPanels(m: Model, d: Dims): WallPanel[] {
  const h = innerHeight(d);
  return m.walls.map((it) => ({
    key: wallKey(it.wall.id),
    it,
    s: endAt(it.start, it.wall.from, -1, d),
    e: endAt(it.end, it.wall.to, 1, d),
    h,
    fromTop: it.wall.axis === 'h',
    part: wallKey(it.wall.id),
    ox: 0,
    oy: 0,
  }));
}

/** Stretches of the bottom edge (along-coordinates) with one tooth of the given width in the middle of each */
export function floorSpans(p: WallPanel, d: Dims): { a: number; b: number; width: number }[] {
  const { t, finger } = d;
  // Unterkante: an Kreuzungen, die von unten geschlitzt werden, bleibt ein Stück für die Überblattung frei
  const cuts = p.fromTop ? [] : p.it.crosses.map((c) => c.at).sort((x, y) => x - y);
  const lh = lapHalf(d);
  const spans: { a: number; b: number }[] = [];
  let a = p.s;
  for (const c of cuts) {
    spans.push({ a, b: c - lh });
    a = c + lh;
  }
  spans.push({ a, b: p.e });
  const out: { a: number; b: number; width: number }[] = [];
  // Zähne wie Fingerzinken: gleich breite Felder, ein Zahn auf jedem zweiten (fields); am freien Ende ein eigener
  // Abschnitt mit einem Zahn kurz vor dem Ende (der Zahn hält das Ende im Boden)
  const endSpan = finger + t;
  spans.forEach((sp, i) => {
    const freeStart = i === 0 && p.it.start.kind === 'free',
      freeEnd = i === spans.length - 1 && p.it.end.kind === 'free';
    const len = sp.b - sp.a;
    const nFree = (freeStart ? 1 : 0) + (freeEnd ? 1 : 0);
    if (!nFree) return out.push(...tenonStretches(sp.a, sp.b, finger));
    if (len < nFree * endSpan + finger) return out.push({ a: sp.a, b: sp.b, width: Math.min(finger, len - t) });
    let a = sp.a,
      b = sp.b;
    if (freeStart) {
      out.push({ a, b: a + endSpan, width: finger });
      a += endSpan;
    }
    const tail = freeEnd ? { a: b - endSpan, b, width: finger } : null;
    if (freeEnd) b -= endSpan;
    out.push(...tenonStretches(a, b, finger));
    if (tail) out.push(tail);
  });
  return out.filter((sp) => sp.b - sp.a > 1e-6);
}

/** Where an inner wall's end tenons go in an outer part: the part and the guide (y in the inner wall's coordinates) */
type OuterTenon = (end: End, p: WallPanel) => { into: string; at: (y: number) => Pt } | null;

/** The edges of an inner wall split where its joints sit, in its own coordinates */
function wallSplits(p: WallPanel, d: Dims, tenoned: (e: End) => boolean) {
  const lh = lapHalf(d);
  const laps = p.it.crosses.flatMap((c) => [c.at - lh - p.s, c.at + lh - p.s]);
  const top = p.fromTop ? laps : [];
  const bottom = [...(p.fromTop ? [] : laps), ...floorSpans(p, d).flatMap((sp) => [sp.a - p.s, sp.b - p.s])];
  const ends = tenonStretches(0, p.h, d.finger).flatMap((sp) => [sp.a, sp.b]);
  return { top, bottom, left: tenoned(p.it.start) ? ends : [], right: tenoned(p.it.end) ? ends : [] };
}

/**
 * The joints of the inner walls (crossings, corners, T joints on walls and on outer walls, teeth into the floor), on
 * parts that already hold their panels. Each wall's coordinates are moved by its offset in its part (boards).
 */
function innerJoints(parts: Parts, walls: WallPanel[], d: Dims, info: JointMsg[], outerTenon: OuterTenon): Parts {
  const { W, D, t, finger } = d;
  const byId = new Map(walls.map((p) => [p.it.wall.id, p]));
  const lh = lapHalf(d);
  const P = (p: WallPanel, x: number, y: number): Pt => ({ x: x + p.ox, y: y + p.oy });
  // Gesamtspiel der Verbindung, entlang und quer zum Zapfenschlitz (host.joints v: 2, #402)
  const opts = (o: JointOptions): JointOptions => ({ thickness: t, clearance: d.clearance, ...o });
  const keep = (r: { parts: Parts; info: JointMsg[] }) => {
    parts = r.parts;
    info.push(...r.info);
  };

  // Kreuzungen: Überblattung, waagrechte Wände von oben, senkrechte von unten (Spiel = ganzes Spiel: Schlitz t + Spiel)
  for (const p of walls) {
    if (!p.fromTop) continue;
    for (const c of p.it.crosses) {
      const q = byId.get(c.wall)!;
      const at = q.it.crosses.find((x) => x.wall === p.it.wall.id)!.at;
      const x1 = c.at - p.s,
        x2 = at - q.s;
      keep(
        joint(parts, { kind: 'lap', thickness: t, clearance: d.clearance, lapCount: 1, lapDepth: 50 }, [
          { part: p.part, a: P(p, x1 - lh, 0), b: P(p, x1 + lh, 0) },
          { part: q.part, a: P(q, x2 + lh, q.h), b: P(q, x2 - lh, q.h) },
        ]),
      );
    }
  }

  // Enden: Ecken (Fingerzinken nach außen), T an Innenwänden und an Außenwänden (Zapfen durch Schlitze)
  for (const p of walls) {
    for (const which of ['start', 'end'] as const) {
      const end = p.it[which];
      const x = which === 'start' ? 0 : p.e - p.s;
      const edge = { part: p.part, a: P(p, x, 0), b: P(p, x, p.h) };
      /** One tenon per stretch, into the slot along the guide from `at(0)` to `at(p.h)` in part `into` */
      const tenons = (into: string, at: (y: number) => Pt) => {
        for (const sp of tenonStretches(0, p.h, finger))
          parts = tenonsInto(parts, opts({ kind: 'tenon', tenonCount: 1, tenonWidth: sp.width }), { part: p.part, a: P(p, x, sp.a), b: P(p, x, sp.b) }, into, at(sp.a), at(sp.b));
      };
      if (end.kind === 'corner') {
        const q = byId.get(end.other)!;
        if (q.it.wall.id < p.it.wall.id) continue; // jede Ecke einmal, von der älteren Wand aus
        const qWhich = q.it.start.kind === 'corner' && q.it.start.other === p.it.wall.id ? 'start' : 'end';
        const qx = qWhich === 'start' ? 0 : q.e - q.s;
        keep(joint(parts, opts({ kind: 'finger', fingerWidth: finger, direction: 'out' }), [edge, { part: q.part, a: P(q, qx, 0), b: P(q, qx, q.h) }]));
      } else if (end.kind === 'tee') {
        const host = byId.get(end.host)!;
        const at = host.it.tees.find((x) => x.wall === p.it.wall.id)!.at - host.s;
        tenons(host.part, (y) => P(host, at, y));
      } else {
        const o = outerTenon(end, p);
        if (o) tenons(o.into, o.at);
      }
    }
  }

  // Zähne in den Boden
  for (const p of walls) {
    const w = p.it.wall;
    for (const sp of floorSpans(p, d)) {
      const map = (along: number) =>
        w.axis === 'h' ? { x: along + t - W / 2, y: w.pos + t - D / 2 } : { x: w.pos + t - W / 2, y: along + t - D / 2 };
      parts = tenonsInto(
        parts,
        opts({ kind: 'tenon', tenonCount: 1, tenonWidth: sp.width }),
        { part: p.part, a: P(p, sp.b - p.s, p.h), b: P(p, sp.a - p.s, p.h) },
        'floor',
        map(sp.a),
        map(sp.b),
      );
    }
  }
  return parts;
}

/**
 * All parts, without kerf (widen() adds it), in their own coordinates centred on the origin. Throws JointError when a
 * joint does not fit.
 */
export function buildParts(m: Model, d: Dims): { parts: Parts; info: JointMsg[]; walls: WallPanel[]; boards: Board[] } {
  if (m.outline) return shapedParts(m, d);
  const { W, D, H, t, finger } = d;
  const info: JointMsg[] = [];
  let parts: Parts = {};

  // Außenwände, Boden und Deckel: die Platten der Box (host.joints v: 2, Spiel = Gesamtspiel). Eine offene Seite hat
  // keine Wand; die Kanten der Nachbarplatten dort sind glatt.
  const S = d.sides;
  const any = anyOuter(d);
  // Zinken: auf jeder Kante die Felder von fields() zwischen den Eckwürfeln. Die Plattenfunktion der App nimmt eine
  // Zinkenbreite für alle vier Kanten und rundet die Feldzahl ab: jede Platte wird zweimal gerechnet (Kanten quer und
  // Kanten längs, jeweils mit der Breite, die genau ihre Feldzahl gibt, die anderen glatt), das Gemeinsame bleibt.
  // Ohne Deckel (cut = t) reichen die Zinken der Wände bis an die Oberkante: die Platte wird um t höher gerechnet und
  // der Streifen oben abgeschnitten.
  const fingerFor = (span: number) => span / (fields(span, finger).n + 0.5);
  const plate = (w: number, hh: number, edges: ('A' | 'B' | 'flat')[], corners: boolean, cut = 0): SubPath[] => {
    const b = hh + cut;
    const one = (e: ('A' | 'B' | 'flat')[], f: number) =>
      host.joints({ op: 'panel', v: 2, width: w, height: b, thickness: t, finger: f, clearance: d.clearance, kerf: 0, edges: e as ['A', 'A', 'A', 'A'], corners }).outline;
    const across = one([edges[0], 'flat', edges[2], 'flat'], fingerFor(w - 2 * t)),
      upDown = one(['flat', edges[1], 'flat', edges[3]], fingerFor(b - 2 * t));
    const out = host.boolean({ op: 'intersection', a: [across], b: [upDown] });
    if (!cut) return out;
    const keep: SubPath = { closed: true, nodes: [{ x: -w / 2, y: cut - b / 2 }, { x: w / 2, y: cut - b / 2 }, { x: w / 2, y: b / 2 }, { x: -w / 2, y: b / 2 }] };
    return host.boolean({ op: 'intersection', a: out, b: [keep] }).map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ x: n.x, y: n.y - cut / 2 })) }));
  };
  const cut = d.lid ? 0 : t;
  const on = (has: boolean, p: 'A' | 'B') => (has ? p : 'flat');
  const top = d.lid ? 'B' : 'flat';
  // Boden und Deckel: oben = hinten, rechts, unten = vorne, links
  const flatPlate = () => plate(W, D, [on(S.y0, 'A'), on(S.x1, 'A'), on(S.y1, 'A'), on(S.x0, 'A')], false);
  parts.floor = flatPlate();
  if (d.lid) parts.lid = flatPlate();
  // Vorder- und Rückwand besitzen die Eckwürfel; Seitenwände (u = −Y): rechts = vorne, links = hinten
  if (S.y1) parts.front = plate(W, H, [top, on(S.x1, 'A'), 'B', on(S.x0, 'A')], true, cut);
  if (S.y0) parts.back = plate(W, H, [top, on(S.x1, 'A'), 'B', on(S.x0, 'A')], true, cut);
  if (S.x0) parts.left = plate(D, H, [top, on(S.y1, 'B'), 'B', on(S.y0, 'B')], false, cut);
  if (S.x1) parts.right = plate(D, H, [top, on(S.y1, 'B'), 'B', on(S.y0, 'B')], false, cut);
  // Eckwürfel ohne Vorder- oder Rückwand: die Seitenwand übernimmt sie, ohne beide Wände Boden und Deckel
  if (any)
    for (const ys of ['y0', 'y1'] as const)
      for (const xs of ['x0', 'x1'] as const) {
        if (S[ys]) continue;
        const sq = (cx: number, cy: number): SubPath => {
          const x0 = cx < 0 ? cx : cx - t,
            y0 = cy < 0 ? cy : cy - t;
          return { closed: true, nodes: [{ x: x0, y: y0 }, { x: x0 + t, y: y0 }, { x: x0 + t, y: y0 + t }, { x: x0, y: y0 + t }] };
        };
        if (S[xs]) {
          const key = OUTER[xs],
            u = ys === 'y1' ? D / 2 : -D / 2;
          parts[key] = host.boolean({ op: 'union', a: parts[key], b: [sq(u, -H / 2), sq(u, H / 2)] });
        } else {
          const c = sq(xs === 'x1' ? W / 2 : -W / 2, ys === 'y1' ? D / 2 : -D / 2);
          parts.floor = host.boolean({ op: 'union', a: parts.floor, b: [c] });
          if (parts.lid) parts.lid = host.boolean({ op: 'union', a: parts.lid, b: [c] });
        }
      }
  if (!any) parts.floor = [{ closed: true, nodes: [{ x: -W / 2, y: -D / 2 }, { x: W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 }, { x: -W / 2, y: D / 2 }] }];

  // Innenwände als Rechtecke, die Kanten an den Stellen geteilt, an denen Verbindungen sitzen (Zapfen an den Enden:
  // je einer auf jedem zweiten Feld, wie die Zinken der Ecken)
  const walls = wallPanels(m, d);
  const tenoned = (e: End) => e.kind === 'tee' || (e.kind === 'outer' && d.sides[e.side]);
  for (const p of walls) parts[p.key] = [panel(p.e - p.s, p.h, wallSplits(p, d, tenoned))];
  parts = innerJoints(parts, walls, d, info, (end, p) => {
    if (end.kind !== 'outer' || !d.sides[end.side]) return null;
    const side = end.side;
    const L = side === 'x0' || side === 'x1' ? D : W;
    const u = p.it.wall.pos + t - L / 2;
    const y1 = H / 2 - t;
    return { into: OUTER[side], at: (y) => ({ x: u, y: y1 - p.h + y }) };
  });

  // Innenwände um ihre Mitte legen
  for (const p of walls) {
    const cx = (p.e - p.s) / 2,
      cy = p.h / 2;
    parts[p.key] = parts[p.key].map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ x: n.x - cx, y: n.y - cy })) }));
  }
  return { parts, info: dedupeInfo(info), walls, boards: [] };
}

/** How far an edge's board reaches past the end of the edge (+) or stops before it (−): past the corner through a step,
 * up to the open line where the outline goes on open in line (at the wall that meets it there), otherwise at the inner
 * face of the other edge (next to an open edge: at its outer face, given) */
const reachOf = (q: OEdgeInfo['start'], t: number) => (q.kind === 'through' ? t / 2 : q.kind === 'line' && q.wall === undefined ? 0 : -t / 2);
/** Where an outline edge's own stretch of its board starts and ends */
const given = (q: OEdgeInfo['start']) => (q.kind === 'open' || (q.kind === 'through' && q.at !== undefined) ? q.at : undefined);
const edgeRange = (e: OEdgeInfo, t: number): [number, number] => [given(e.start) ?? e.from - reachOf(e.start, t), given(e.end) ?? e.to + reachOf(e.end, t)];
/** Where the fingers into floor and lid run on an edge: its stretch, but at a crossing of two boards (cross lap) only up
 * to the face of the other board (the corner's square there belongs to floor and lid, as at a corner) */
const crossed = (q: OEdgeInfo['start']) => q.kind === 'through' && q.cross !== undefined;
const jointRange = (e: OEdgeInfo, t: number): [number, number] => {
  const [a, b] = edgeRange(e, t);
  return [crossed(e.start) ? e.from + t / 2 : a, crossed(e.end) ? e.to - t / 2 : b];
};

/** The boards of a shaped outline: every edge with the walls that go on from it, edges joined through such walls */
export function boards(m: Model, d: Dims, walls: WallPanel[]): Board[] {
  const es = m.outline!.edges.filter((e) => !e.open);
  const t = d.t;
  const ho = outerHeight(d);
  const byId = new Map(walls.map((p) => [p.it.wall.id, p]));
  // Gruppen: Kante – Wand (Stufe) – Kante …
  const group = m.outline!.edges.map((e) => e.k);
  const find = (k: number): number => (group[k] === k ? k : (group[k] = find(group[k])));
  const memberOf = new Map<number, number>();
  for (const e of es)
    for (const q of [e.start, e.end])
      if (q.kind === 'through') {
        const prev = memberOf.get(q.wall);
        if (prev !== undefined) group[find(prev)] = find(e.k);
        memberOf.set(q.wall, e.k);
      }
  const out = new Map<number, Board>();
  for (const e of es) {
    const g = find(e.k);
    let b = out.get(g);
    if (!b) out.set(g, (b = { key: outerKey(e.k), axis: e.axis, pos: e.pos, edges: [], members: [], bs: Infinity, be: -Infinity, h: ho }));
    b.edges.push(e);
    const [a, z] = edgeRange(e, t);
    b.bs = Math.min(b.bs, a);
    b.be = Math.max(b.be, z);
  }
  for (const [id, k] of memberOf) {
    const b = out.get(find(k))!;
    const p = byId.get(id)!;
    if (!b.members.includes(p)) b.members.push(p);
    b.bs = Math.min(b.bs, p.s);
    b.be = Math.max(b.be, p.e);
  }
  const list = [...out.values()];
  for (const b of list) {
    b.key = outerKey(Math.min(...b.edges.map((e) => e.k)));
    for (const p of b.members) Object.assign(p, { part: b.key, ox: p.s - b.bs, oy: ho - p.h });
  }
  return list;
}

/** The outline of a board: its stretches (outer walls at full height, walls at theirs) side by side on one line, the
 * floor side straight, with nodes where joints go */
function boardOutline(b: Board, els: { a: number; b: number; top: number }[], splits: { top: number[]; bottom: number[]; left: number[]; right: number[] }): SubPath {
  const L = b.be - b.bs,
    h = b.h;
  const e = [...els].sort((p, q) => p.a - q.a);
  const nodes: Pt[] = [];
  const push = (x: number, y: number) => {
    const last = nodes[nodes.length - 1];
    if (!last || Math.abs(last.x - x) > 1e-9 || Math.abs(last.y - y) > 1e-9) nodes.push({ x, y });
  };
  const inside = (v: number[], lo: number, hi: number, desc = false) => [...new Set(v.filter((x) => x > lo + 1e-6 && x < hi - 1e-6))].sort((p, q) => (desc ? q - p : p - q));
  for (const el of e) {
    push(el.a, el.top);
    for (const x of inside(splits.top.filter((x) => x > el.a && x < el.b), el.a, el.b)) push(x, el.top);
    push(el.b, el.top);
  }
  const t0 = e[0].top,
    t1 = e[e.length - 1].top;
  for (const y of inside(splits.right, t1, h)) push(L, y);
  push(L, h);
  for (const x of inside(splits.bottom, 0, L, true)) push(x, h);
  push(0, h);
  for (const y of inside(splits.left, t0, h, true)) push(0, y);
  return { closed: true, nodes };
}

/**
 * Parts of a box with a shaped outline (#451). All four sides have walls (checked before). Floor and lid: the inner
 * faces of the outline, fingers into every board, a square at each corner of the outline (the corner's column between
 * them is the boards' fingers). Boards between floor and lid, fingers at the corners, T joints at steps.
 */
function shapedParts(m: Model, d: Dims): { parts: Parts; info: JointMsg[]; walls: WallPanel[]; boards: Board[] } {
  const { W, D, t, finger } = d;
  const info: JointMsg[] = [];
  const ol = m.outline!;
  const ho = outerHeight(d);
  const walls = wallPanels(m, d);
  const bs = boards(m, d, walls);
  const boardOf = new Map<number, Board>();
  for (const b of bs) for (const e of b.edges) boardOf.set(e.k, b);
  const memberIds = new Set(bs.flatMap((b) => b.members.map((p) => p.it.wall.id)));
  const byId = new Map(walls.map((p) => [p.it.wall.id, p]));
  const fl = (x: number, y: number): Pt => ({ x: x + t - W / 2, y: y + t - D / 2 });
  const tenoned = (e: End) => e.kind === 'tee' || e.kind === 'edge';
  const drop = ho - innerHeight(d);
  // Schlitze eines Brettes, in das eine Kante an einer Stufe als T läuft: nur unter der Stufe (dort ist es ganz lang)
  const intoStretches = () => tenonStretches(drop, ho, finger);
  let parts: Parts = {};

  // Boden und Deckel: Innenseiten der Bretter, Außenseiten der offenen Kanten, geteilt an den Enden der Zinkenstrecken
  const n = ol.edges.length;
  const off = (e: OEdgeInfo) => e.pos + ((e.open ? -1 : 1) * e.inside * t) / 2;
  // Where edge e's line (offset) starts (at its point k) or ends (at the next point): at the line of the edge across,
  // or (the outline goes on in line, open on one side) at the point itself
  const ends = (e: OEdgeInfo, o: OEdgeInfo, p: XY): [number, number] => {
    const along = o.axis === e.axis ? (e.axis === 'h' ? p[0] : p[1]) : off(o);
    return e.axis === 'h' ? [along, off(e)] : [off(e), along];
  };
  const plate = (): SubPath => {
    const nodes: Pt[] = [];
    const push = (x: number, y: number) => {
      const q = fl(x, y),
        last = nodes[nodes.length - 1];
      if (!last || Math.abs(last.x - q.x) > 1e-9 || Math.abs(last.y - q.y) > 1e-9) nodes.push(q);
    };
    for (let k = 0; k < n; k++) {
      const e = ol.edges[k];
      const [a, b] = ends(e, ol.edges[(k + n - 1) % n], ol.pts[k]),
        [c, dd] = ends(e, ol.edges[(k + 1) % n], ol.pts[(k + 1) % n]);
      push(a, b);
      if (!e.open) {
        const [r0, r1] = edgeRange(e, t),
          [j0, j1] = jointRange(e, t);
        const along0 = e.axis === 'h' ? a : b,
          along1 = e.axis === 'h' ? c : dd;
        const dir = Math.sign(along1 - along0);
        const marks = [...new Set([r0, r1, j0, j1])].filter((v) => (v - along0) * dir > 1e-6 && (along1 - v) * dir > 1e-6).sort((p, q) => (p - q) * dir);
        for (const v of marks) e.axis === 'h' ? push(v, b) : push(a, v);
      }
      push(c, dd);
    }
    if (nodes.length > 1 && Math.abs(nodes[0].x - nodes[nodes.length - 1].x) < 1e-9 && Math.abs(nodes[0].y - nodes[nodes.length - 1].y) < 1e-9) nodes.pop();
    return { closed: true, nodes };
  };
  parts.floor = [plate()];
  if (d.lid) parts.lid = [plate()];

  // Bretter: Außenwand-Strecken in voller Höhe, weiterlaufende Wände in ihrer
  for (const b of bs) {
    const els = [...b.edges.map((e) => { const [a, z] = edgeRange(e, t); return { a: a - b.bs, b: z - b.bs, top: 0 }; }), ...b.members.map((p) => ({ a: p.ox, b: p.ox + p.e - p.s, top: p.oy }))];
    const top: number[] = [],
      bottom: number[] = [],
      left: number[] = [],
      right: number[] = [];
    for (const el of els) top.push(el.a, el.b), bottom.push(el.a, el.b);
    for (const e of b.edges) for (const v of jointRange(e, t)) top.push(v - b.bs), bottom.push(v - b.bs);
    for (const p of b.members) {
      const s = wallSplits(p, d, tenoned);
      top.push(...s.top.map((x) => x + p.ox));
      bottom.push(...s.bottom.map((x) => x + p.ox));
      if (p.ox < 1e-6) left.push(...s.left.map((y) => y + p.oy));
      if (p.ox + p.e - p.s > b.be - b.bs - 1e-6) right.push(...s.right.map((y) => y + p.oy));
    }
    for (const e of b.edges) {
      const [a, z] = edgeRange(e, t);
      const ys = intoStretches().flatMap((sp) => [sp.a, sp.b]);
      if (e.start.kind === 'into' && a - b.bs < 1e-6) left.push(...ys);
      if (e.end.kind === 'into' && z - b.bs > b.be - b.bs - 1e-6) right.push(...ys);
      // A wall meets the end of the board where the outline goes on open: the corner's fingers over the wall's height
      const lower = (q: OEdgeInfo['start']) => (q.kind === 'line' && q.wall !== undefined ? [ho - (byId.get(q.wall)?.h ?? ho)] : []);
      if (a - b.bs < 1e-6) left.push(...lower(e.start));
      if (z - b.bs > b.be - b.bs - 1e-6) right.push(...lower(e.end));
    }
    parts[b.key] = [boardOutline(b, els, { top, bottom, left, right })];
  }
  // Innenwände, die kein Teil eines Brettes sind
  for (const p of walls) if (!memberIds.has(p.it.wall.id)) parts[p.key] = [panel(p.e - p.s, p.h, wallSplits(p, d, tenoned))];

  const opts = (o: JointOptions): JointOptions => ({ thickness: t, clearance: d.clearance, ...o });
  const keep = (r: { parts: Parts; info: JointMsg[] }) => {
    parts = r.parts;
    info.push(...r.info);
  };
  // Boden und Deckel: Zinken an jeder Außenwand-Strecke (Boden/Deckel zuerst: ihnen gehören die Endfelder)
  for (const e of ol.edges) {
    if (e.open) continue;
    const b = boardOf.get(e.k)!;
    const [r0, r1] = jointRange(e, t);
    const f = e.pos + (e.inside * t) / 2;
    const P = (v: number) => (e.axis === 'h' ? fl(v, f) : fl(f, v));
    keep(joint(parts, opts({ kind: 'finger', fingerWidth: finger, direction: 'out' }), [{ part: 'floor', a: P(r0), b: P(r1) }, { part: b.key, a: { x: r0 - b.bs, y: ho }, b: { x: r1 - b.bs, y: ho } }]));
    if (d.lid) keep(joint(parts, opts({ kind: 'finger', fingerWidth: finger, direction: 'out' }), [{ part: 'lid', a: P(r0), b: P(r1) }, { part: b.key, a: { x: r0 - b.bs, y: 0 }, b: { x: r1 - b.bs, y: 0 } }]));
  }
  // Ecken der Kontur: Fingerzinken zwischen den Brettern; an einer Stufe läuft die andere Kante als T ins Brett
  const squares: SubPath[] = [];
  /** The square of the corner's column at (cx, cy), in the floor's coordinates */
  const square = (cx: number, cy: number): SubPath => {
    const p0 = fl(cx - t / 2, cy - t / 2),
      p1 = fl(cx + t / 2, cy + t / 2);
    return { closed: true, nodes: [p0, { x: p1.x, y: p0.y }, p1, { x: p0.x, y: p1.y }] };
  };
  for (const e of ol.edges)
    for (const which of ['start', 'end'] as const) {
      if (e.open) continue;
      const q = e[which];
      const v = which === 'start' ? e.from : e.to;
      const b = boardOf.get(e.k)!;
      const x = (which === 'start' ? edgeRange(e, t)[0] : edgeRange(e, t)[1]) - b.bs;
      if (q.kind === 'line' && q.wall !== undefined) {
        // The wall that meets the board's end there: fingers over its height, the corner's square to floor and lid
        const p = byId.get(q.wall)!;
        const px = p.it.start.kind === 'board' && p.it.start.edge === e.k ? 0 : p.e - p.s;
        const P = (y: number): Pt => ({ x: px + p.ox, y: y + p.oy });
        keep(joint(parts, opts({ kind: 'finger', fingerWidth: finger, direction: 'out' }), [{ part: b.key, a: { x, y: ho - p.h }, b: { x, y: ho } }, { part: p.part, a: P(0), b: P(p.h) }]));
        squares.push(e.axis === 'h' ? square(v, e.pos) : square(e.pos, v));
      } else if (q.kind === 'corner') {
        if (q.edge < e.k) continue; // jede Ecke einmal
        const o = ol.edges[q.edge];
        const ob = boardOf.get(o.k)!;
        const oWhich = Math.abs(o.from - e.pos) < 1e-6 ? 0 : 1;
        const ox = edgeRange(o, t)[oWhich] - ob.bs;
        keep(joint(parts, opts({ kind: 'finger', fingerWidth: finger, direction: 'out' }), [{ part: b.key, a: { x, y: 0 }, b: { x, y: ho } }, { part: ob.key, a: { x: ox, y: 0 }, b: { x: ox, y: ho } }]));
        squares.push(e.axis === 'h' ? square(v, e.pos) : square(e.pos, v));
      } else if (crossed(q) && e.axis === 'h') {
        squares.push(square(v, e.pos));
      } else if (q.kind === 'into') {
        const hb = boardOf.get(q.edge)!;
        const u = e.pos - hb.bs;
        for (const sp of intoStretches())
          parts = tenonsInto(parts, opts({ kind: 'tenon', tenonCount: 1, tenonWidth: sp.width }), { part: b.key, a: { x, y: sp.a }, b: { x, y: sp.b } }, hb.key, { x: u, y: sp.a }, { x: u, y: sp.b });
      }
    }
  // Die Eckwürfel unter und über den Ecksäulen gehören Boden und Deckel
  if (squares.length) {
    parts.floor = host.boolean({ op: 'union', a: parts.floor, b: squares });
    if (parts.lid) parts.lid = host.boolean({ op: 'union', a: parts.lid, b: squares });
  }

  // Innenwände (nach den Eckwürfeln: die Vereinigung bekommt Boden und Deckel noch ohne Schlitze)
  parts = innerJoints(parts, walls, d, info, (end, p) => {
    if (end.kind !== 'edge') return null;
    const b = boardOf.get(end.edge)!;
    const u = p.it.wall.pos - b.bs;
    return { into: b.key, at: (y) => ({ x: u, y: ho - p.h + y }) };
  });

  // Kreuzung zweier Bretter an einer Ecke der Kontur (beide gehen als Wand weiter): Überblattung, die waagrechte
  // Kante von oben, die senkrechte von unten, je bis zur halben Höhe; Schlitz t + Spiel (Gesamtspiel)
  for (const e of ol.edges)
    for (const which of ['start', 'end'] as const) {
      const q = e[which];
      if (q.kind !== 'through' || q.cross === undefined || e.axis !== 'h') continue;
      const o = ol.edges[q.cross];
      const v = which === 'start' ? e.from : e.to;
      const half = (t + d.clearance) / 2;
      const cut = (b: Board, at: number, top: boolean): SubPath => {
        const x0 = at - b.bs - half,
          x1 = at - b.bs + half;
        const [y0, y1] = top ? [-1, ho / 2] : [ho / 2, ho + t + 1];
        return { closed: true, nodes: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }] };
      };
      const hb = boardOf.get(e.k)!,
        vb = boardOf.get(o.k)!;
      parts[hb.key] = host.boolean({ op: 'difference', a: parts[hb.key], b: [cut(hb, v, true)] });
      parts[vb.key] = host.boolean({ op: 'difference', a: parts[vb.key], b: [cut(vb, e.pos, false)] });
    }

  // Bretter und Innenwände um ihre Mitte legen
  const centre = (key: string, cx: number, cy: number) => (parts[key] = parts[key].map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((q) => ({ x: q.x - cx, y: q.y - cy })) })));
  for (const b of bs) centre(b.key, (b.be - b.bs) / 2, ho / 2);
  for (const p of walls) if (!memberIds.has(p.it.wall.id)) centre(p.key, (p.e - p.s) / 2, p.h / 2);
  return { parts, info: dedupeInfo(info), walls: walls.filter((p) => !memberIds.has(p.it.wall.id)), boards: bs };
}

type V3 = [number, number, number];
export interface Pose {
  o: V3;
  u: V3;
  v: V3;
  n: V3;
}
const X: V3 = [1, 0, 0],
  Y: V3 = [0, 1, 0],
  Z: V3 = [0, 0, 1];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/**
 * Outer parts lie outer face up on the work area (#463): the face up there (cut and engraved) faces −(u×v). These
 * are seen from outside only when turned over: their outline mirrored (x → −x) and u negated, the solid stays.
 * Boards of a shaped outline: those with the inside on the other side than the rectangle's front and left walls.
 */
export const TURNED_OVER = ['floor', 'back', 'right'];
export const boardTurned = (b: Board) => (b.axis === 'h') === (b.edges[0]?.inside === 1);

/** Subpath mirrored at the y axis; the nodes run backwards (closed ones from the same first node), same sense of rotation */
export function mirrorX(sp: SubPath): SubPath {
  const f = (p: { x: number; y: number }) => ({ x: -p.x, y: p.y });
  const ns = !sp.closed ? [...sp.nodes].reverse() : sp.nodes.length ? [sp.nodes[0], ...sp.nodes.slice(1).reverse()] : [];
  return {
    ...sp,
    nodes: ns.map((n) => {
      const { cin, cout, ...rest } = n;
      return { ...rest, ...f(n), ...(cout ? { cin: f(cout) } : {}), ...(cin ? { cout: f(cin) } : {}) };
    }),
  };
}

/** The given parts turned over (see TURNED_OVER) */
export function turnOver(parts: Parts, keys: string[]): Parts {
  const out: Parts = { ...parts };
  for (const k of keys) if (out[k]) out[k] = out[k].map(mirrorX);
  return out;
}

/**
 * Where every part sits in the 3D view (X right, Y back, Z up; a point (x, y) of a part at height s lies at
 * o + x·u + y·v + s·n). The plan is seen from above with the front at the bottom: inner x → X = t + x,
 * inner y → Y = D − t − y. Outer walls, floor, lid and the boards of a shaped outline outer face up (legacy: as
 * saved before #463, boards like walls).
 */
export function poses(walls: WallPanel[], d: Dims, keys: string[], bs: Board[] = [], legacy = false): Record<string, Pose> {
  const { W, D, H, t } = d;
  const down = neg(Z);
  const turn = (k: string, a: V3) => (!legacy && TURNED_OVER.includes(k) ? neg(a) : a);
  const all: Record<string, Pose> = {
    floor: { o: [W / 2, D / 2, 0], u: turn('floor', X), v: neg(Y), n: Z },
    lid: { o: [W / 2, D / 2, H - t], u: X, v: neg(Y), n: Z },
    front: { o: [W / 2, 0, H / 2], u: X, v: down, n: Y },
    back: { o: [W / 2, D - t, H / 2], u: turn('back', X), v: down, n: Y },
    left: { o: [0, D / 2, H / 2], u: neg(Y), v: down, n: X },
    right: { o: [W - t, D / 2, H / 2], u: turn('right', neg(Y)), v: down, n: X },
  };
  const along = (key: string, axis: 'h' | 'v', pos: number, mid: number, z: number, over = false) => {
    const u = axis === 'h' ? X : neg(Y);
    all[key] = axis === 'h' ? { o: [t + mid, D - t - pos - t / 2, z], u: over ? neg(u) : u, v: down, n: Y } : { o: [t + pos - t / 2, D - t - mid, z], u: over ? neg(u) : u, v: down, n: X };
  };
  for (const p of walls) along(p.key, p.it.wall.axis, p.it.wall.pos, p.s + (p.e - p.s) / 2, t + p.h / 2);
  for (const b of bs) along(b.key, b.axis, b.pos, (b.bs + b.be) / 2, t + b.h / 2, !legacy && boardTurned(b));
  return Object.fromEntries(keys.filter((k) => all[k]).map((k) => [k, all[k]]));
}

/** Kerf: every part widened by half of it, outline outwards and holes inwards */
export function withKerf(parts: Parts, kerf: number): Parts {
  const out: Parts = {};
  for (const [k, subs] of Object.entries(parts)) out[k] = widen(subs, kerf);
  return out;
}

function dedupeInfo(list: JointMsg[]): JointMsg[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = i.code + JSON.stringify(i.values ?? {});
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export { JointError };
