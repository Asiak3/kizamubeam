// Parts of the box composer from the wall model. Every joint comes from the app (host.joints); this file only
// decides which edges meet and where the slots go.
//
// Box: outer size W × D × H, material t. The inner rectangle (where the walls are placed) lies t inside the outer
// edge. Outer walls, floor and lid are the panels of the box generator. Inner walls stand on the floor; a wall panel
// is drawn in its own plane: x along the wall from its physical start, y down from its top edge to the floor (h).
import { host, type JointOptions, type SubPath } from '../../sdk/ts';
import { fields, joint, panel, tenonStretches, tenonsInto, widen, JointError, type Parts } from './joints';
import type { End, Model, Side, WallInfo } from './model';

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
}

export const OUTER: Record<Side, string> = { x0: 'left', x1: 'right', y0: 'back', y1: 'front' };
export const wallKey = (id: number) => `wall-${id}`;

/** Has the box any outer wall? */
export const anyOuter = (d: Dims) => d.sides.x0 || d.sides.x1 || d.sides.y0 || d.sides.y1;

/** Height of the inner walls */
export const innerHeight = (d: Dims) => (anyOuter(d) ? d.H - d.t - (d.lid ? d.t : 0) - d.drop : d.H - d.t);

/** Half the length of the edge stretch a lap joint is put on (the slot sits in its middle) */
const lapHalf = (d: Dims) => Math.max(1.5 * d.t, d.t + Math.max(0, d.clearance) + 0.5);

/** Where a wall physically ends: at the outer wall's inner face (or the floor edge on an open side), at the face of
 * a host, at the near face of the corner partner, or where it is drawn (free end). dir = -1 for the start, 1 for the end */
function endAt(end: End, at: number, dir: -1 | 1, d: Dims): number {
  if (end.kind === 'outer') return d.sides[end.side] ? at : at + dir * d.t;
  if (end.kind === 'free') return at;
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

/**
 * All parts, without kerf (widen() adds it), in their own coordinates centred on the origin. Throws JointError when a
 * joint does not fit.
 */
export function buildParts(m: Model, d: Dims): { parts: Parts; info: JointMsg[]; walls: WallPanel[] } {
  const { W, D, H, t, finger } = d;
  const half = d.clearance / 2;
  const info: JointMsg[] = [];
  let parts: Parts = {};

  // Außenwände, Boden und Deckel: die Platten der Box (Spiel je Seite = halbes Gesamtspiel). Eine offene Seite hat
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
      host.joints({ op: 'panel', width: w, height: b, thickness: t, finger: f, clearance: half, kerf: 0, edges: e as ['A', 'A', 'A', 'A'], corners }).outline;
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
  const byId = new Map(walls.map((p) => [p.it.wall.id, p]));
  const lh = lapHalf(d);
  const tenoned = (e: End) => e.kind === 'tee' || (e.kind === 'outer' && d.sides[e.side]);
  for (const p of walls) {
    const len = p.e - p.s;
    const laps = p.it.crosses.flatMap((c) => [c.at - lh - p.s, c.at + lh - p.s]);
    const top = p.fromTop ? laps : [];
    const bottom = [...(p.fromTop ? [] : laps), ...floorSpans(p, d).flatMap((sp) => [sp.a - p.s, sp.b - p.s])];
    const ends = tenonStretches(0, p.h, finger).flatMap((sp) => [sp.a, sp.b]);
    parts[p.key] = [panel(len, p.h, { top, bottom, left: tenoned(p.it.start) ? ends : [], right: tenoned(p.it.end) ? ends : [] })];
  }
  // Spiel je Seite = halbes Gesamtspiel; quer über den Zapfenschlitz das ganze (slotClearance, #402/#403)
  const opts = (o: JointOptions): JointOptions => ({ thickness: t, clearance: half, ...o });
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
          { part: p.key, a: { x: x1 - lh, y: 0 }, b: { x: x1 + lh, y: 0 } },
          { part: q.key, a: { x: x2 + lh, y: q.h }, b: { x: x2 - lh, y: q.h } },
        ]),
      );
    }
  }

  // Enden: Ecken (Fingerzinken nach außen), T an Innenwänden und an Außenwänden (Zapfen durch Schlitze)
  for (const p of walls) {
    for (const which of ['start', 'end'] as const) {
      const end = p.it[which];
      const x = which === 'start' ? 0 : p.e - p.s;
      const edge = { part: p.key, a: { x, y: 0 }, b: { x, y: p.h } };
      /** One tenon per stretch, into the slot along the guide from `at(0)` to `at(p.h)` in part `into` */
      const tenons = (into: string, at: (y: number) => { x: number; y: number }) => {
        for (const sp of tenonStretches(0, p.h, finger))
          parts = tenonsInto(parts, opts({ kind: 'tenon', slotClearance: d.clearance, tenonCount: 1, tenonWidth: sp.width }), { part: p.key, a: { x, y: sp.a }, b: { x, y: sp.b } }, into, at(sp.a), at(sp.b));
      };
      if (end.kind === 'corner') {
        const q = byId.get(end.other)!;
        if (q.it.wall.id < p.it.wall.id) continue; // jede Ecke einmal, von der älteren Wand aus
        const qWhich = q.it.start.kind === 'corner' && q.it.start.other === p.it.wall.id ? 'start' : 'end';
        const qx = qWhich === 'start' ? 0 : q.e - q.s;
        keep(joint(parts, opts({ kind: 'finger', fingerWidth: finger, direction: 'out' }), [edge, { part: q.key, a: { x: qx, y: 0 }, b: { x: qx, y: q.h } }]));
      } else if (end.kind === 'tee') {
        const host = byId.get(end.host)!;
        const at = host.it.tees.find((x) => x.wall === p.it.wall.id)!.at - host.s;
        tenons(host.key, (y) => ({ x: at, y }));
      } else if (end.kind === 'outer' && d.sides[end.side]) {
        const side = end.side;
        const key = OUTER[side];
        const L = side === 'x0' || side === 'x1' ? D : W;
        const u = p.it.wall.pos + t - L / 2;
        const y1 = H / 2 - t;
        tenons(key, (y) => ({ x: u, y: y1 - p.h + y }));
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
        opts({ kind: 'tenon', slotClearance: d.clearance, tenonCount: 1, tenonWidth: sp.width }),
        { part: p.key, a: { x: sp.b - p.s, y: p.h }, b: { x: sp.a - p.s, y: p.h } },
        'floor',
        map(sp.a),
        map(sp.b),
      );
    }
  }

  // Innenwände um ihre Mitte legen
  for (const p of walls) {
    const cx = (p.e - p.s) / 2,
      cy = p.h / 2;
    parts[p.key] = parts[p.key].map((sp) => ({ closed: sp.closed, nodes: sp.nodes.map((n) => ({ x: n.x - cx, y: n.y - cy })) }));
  }
  return { parts, info: dedupeInfo(info), walls };
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
 * Where every part sits in the 3D view (X right, Y back, Z up; a point (x, y) of a part at height s lies at
 * o + x·u + y·v + s·n). The plan is seen from above with the front at the bottom: inner x → X = t + x,
 * inner y → Y = D − t − y. Outer walls, floor and lid as in the box generator.
 */
export function poses(walls: WallPanel[], d: Dims, keys: string[]): Record<string, Pose> {
  const { W, D, H, t } = d;
  const down = neg(Z);
  const all: Record<string, Pose> = {
    floor: { o: [W / 2, D / 2, 0], u: X, v: neg(Y), n: Z },
    lid: { o: [W / 2, D / 2, H - t], u: X, v: neg(Y), n: Z },
    front: { o: [W / 2, 0, H / 2], u: X, v: down, n: Y },
    back: { o: [W / 2, D - t, H / 2], u: X, v: down, n: Y },
    left: { o: [0, D / 2, H / 2], u: neg(Y), v: down, n: X },
    right: { o: [W - t, D / 2, H / 2], u: neg(Y), v: down, n: X },
  };
  for (const p of walls) {
    const w = p.it.wall,
      mid = p.s + (p.e - p.s) / 2,
      z = t + p.h / 2;
    all[p.key] =
      w.axis === 'h'
        ? { o: [t + mid, D - t - w.pos - t / 2, z], u: X, v: down, n: Y }
        : { o: [t + w.pos - t / 2, D - t - mid, z], u: neg(Y), v: down, n: X };
  }
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
