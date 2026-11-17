// Wall model of the box composer: reading the stored layout, scaling, merging, and what happens at every wall end.
// Pure computation, no host functions, so it can be tested in Node.
//
// Walls lie on their centre line, in mm inside the inner rectangle of the box (0 … w across, 0 … d deep, y down).
// A wall "h" runs along x at y = pos from x = from to x = to, a wall "v" along y at x = pos from y = from to y = to.

export type Axis = 'h' | 'v';
export interface Wall {
  id: number;
  axis: Axis;
  pos: number;
  from: number;
  to: number;
}
/** The stored layout: the inner size the walls were placed in, and the walls */
export interface Layout {
  ref: [number, number];
  walls: Wall[];
}
/** Side of the inner rectangle: x0 = left (x = 0), x1 = right, y0 = back (y = 0), y1 = front */
export type Side = 'x0' | 'x1' | 'y0' | 'y1';
/** What a wall end meets */
export type End =
  | { kind: 'outer'; side: Side }
  | { kind: 'tee'; host: number }
  | { kind: 'corner'; other: number }
  | { kind: 'free' };
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
export interface Model {
  w: number;
  d: number;
  walls: WallInfo[];
  issues: ModelIssue[];
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
    out.push({ id: q.id, axis: q.axis, pos: q.pos, from: Math.min(q.from, q.to), to: Math.max(q.from, q.to) });
  }
  return { ref: (ref as [number, number] | undefined) ?? [0, 0], walls: out };
}

/** The layout as the values of its two parameters */
export const writeLayout = (l: Layout) => ({
  walls: JSON.stringify(l.walls.map((w) => ({ id: w.id, axis: w.axis, pos: r3(w.pos), from: r3(w.from), to: r3(w.to) }))),
  wallsRef: l.ref[0] > 0 && l.ref[1] > 0 ? JSON.stringify(l.ref.map(r3)) : '',
});
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Scale the walls proportionally from the reference size to the inner size w × d (sizes changed outside the dialog) */
export function scaleLayout(l: Layout, w: number, d: number): Wall[] {
  const [rw, rd] = l.ref;
  if (!(rw > 0 && rd > 0) || (Math.abs(rw - w) < 1e-9 && Math.abs(rd - d) < 1e-9)) return l.walls.map((x) => ({ ...x }));
  const sx = w / rw,
    sy = d / rd;
  return l.walls.map((x) => (x.axis === 'h' ? { ...x, pos: x.pos * sy, from: x.from * sx, to: x.to * sx } : { ...x, pos: x.pos * sx, from: x.from * sy, to: x.to * sy }));
}

/** Join walls on the same line that touch or overlap; the joined wall keeps the oldest (smallest) id */
export function mergeWalls(walls: Wall[]): Wall[] {
  const rest = [...walls].sort((a, b) => a.id - b.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rest.length && !changed; i++)
      for (let j = i + 1; j < rest.length && !changed; j++) {
        const a = rest[i],
          b = rest[j];
        if (a.axis === b.axis && Math.abs(a.pos - b.pos) < EPS && a.from <= b.to + EPS && b.from <= a.to + EPS) {
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

/** The model for the inner size w × d: walls scaled, merged and checked, every end classified */
export function buildModel(l: Layout, w: number, d: number, lim: Limits): Model {
  const { t, gap, minLen, freeLen } = lim;
  const issues: ModelIssue[] = [];
  const err = (code: string, values?: Record<string, number>) => issues.push({ level: 'error', code, ...(values ? { values } : {}) });
  const walls = mergeWalls(scaleLayout(l, w, d));

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
