// Edit operations of the box composer for the plan editor (#385): move a wall, stretch an end, add, delete. Pure
// functions on the layout: each returns the new layout or why the edit is refused (a code with values, texts in the
// manifest). The editor keeps the last accepted layout while dragging.
import { buildModel, EPS, mergeWalls, scaleLayout, type Axis, type Layout, type Limits, type Model, type Side, type Wall } from './model';

export type EditResult = { ok: true; layout: Layout } | { ok: false; code: string; values?: Record<string, number> };

/** The walls as they are in the inner size w × d (scaled to it and merged): the starting point of every edit */
export function current(l: Layout, w: number, d: number): Wall[] {
  return mergeWalls(scaleLayout(l, w, d));
}

const refuse = (code: string, values?: Record<string, number>): EditResult => ({ ok: false, code, ...(values ? { values } : {}) });
const errorsOf = (m: Model) => new Set(m.issues.filter((i) => i.level === 'error').map((i) => i.code + JSON.stringify(i.values ?? {})));

/** Accept the new walls unless they bring an error the layout did not have before */
function accept(before: Model, walls: Wall[], w: number, d: number, lim: Limits): EditResult {
  const layout: Layout = { ref: [w, d], walls };
  const after = buildModel(layout, w, d, lim);
  const old = errorsOf(before);
  const fresh = after.issues.find((i) => i.level === 'error' && !old.has(i.code + JSON.stringify(i.values ?? {})));
  if (fresh) return refuse(fresh.code, fresh.values);
  return { ok: true, layout: { ref: [w, d], walls: mergeWalls(walls) } };
}

/** A wall on the same line as wall id that overlaps it by more than a touch: one would lie on the other */
function onAnother(walls: Wall[], id: number): Wall | undefined {
  const x = walls.find((q) => q.id === id);
  if (!x) return undefined;
  return walls.find((q) => q.id !== id && q.axis === x.axis && Math.abs(q.pos - x.pos) < EPS && Math.min(q.to, x.to) - Math.max(q.from, x.from) > EPS);
}

/**
 * Move wall id across its line to pos. Walls ending on it (T or corner) follow, so they stay joined. Joints may
 * change (it may pass other walls); refused when it would lie on another wall of the same line or bring a new error.
 * A wall it meets end to end on the same line is joined with it (one wall, e.g. crossing the wall both ended on).
 */
export function moveWall(l: Layout, w: number, d: number, lim: Limits, id: number, pos: number): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const before = buildModel({ ref: [w, d], walls }, w, d, lim);
  const info = new Map(before.walls.map((it) => [it.wall.id, it]));
  const moved = walls.map((q) => {
    if (q.id === id) return { ...q, pos };
    const it = info.get(q.id);
    if (!it) return q;
    const ends = (e: (typeof it)['start']) => (e.kind === 'tee' && e.host === id) || (e.kind === 'corner' && e.other === id);
    let from = q.from,
      to = q.to;
    if (ends(it.start)) from = pos;
    if (ends(it.end)) to = pos;
    return { ...q, from: Math.min(from, to), to: Math.max(from, to) };
  });
  const on = onAnother(moved, id);
  if (on) return refuse('move-onto', { id, id2: on.id });
  return accept(before, moved, w, d, lim);
}

/**
 * The centre lines of the nearest walls on both sides of wall x, at `along` on it (default its middle): the space
 * there. An outer wall counts at −t/2 or at the inner size + t/2, so that the clear space is the distance minus t in
 * both cases; an open side (`sides` false there) at −3t/2 or the inner size + 3t/2: the edge of the floor, which
 * reaches the outer size there.
 */
export function neighbours(walls: Wall[], x: Wall, w: number, d: number, t: number, along?: number, sides?: Record<Side, boolean>): { lo: number; hi: number } {
  const wid = x.axis === 'h' ? d : w;
  const mid = along ?? (x.from + x.to) / 2;
  const [s0, s1]: [Side, Side] = x.axis === 'h' ? ['y0', 'y1'] : ['x0', 'x1'];
  let lo = sides && !sides[s0] ? -1.5 * t : -t / 2,
    hi = sides && !sides[s1] ? wid + 1.5 * t : wid + t / 2;
  for (const q of walls) {
    if (q.id === x.id || q.axis !== x.axis || q.from > mid || q.to < mid) continue;
    if (q.pos < x.pos) lo = Math.max(lo, q.pos);
    else if (q.pos > x.pos) hi = Math.min(hi, q.pos);
  }
  return { lo, hi };
}

/**
 * The middle of the wall nearest to `along` on wall x among those it ends on (T) or crosses: walls that do not change
 * when x moves. x at that position divides the wall evenly. null when it touches none.
 */
export function wallCentre(m: Model, x: Wall, along: number): { id: number; at: number } | null {
  const it = m.walls.find((q) => q.wall.id === x.id);
  if (!it) return null;
  const ids = [...it.crosses.map((c) => c.wall), ...[it.start, it.end].flatMap((e) => (e.kind === 'tee' ? [e.host] : []))];
  let best: { id: number; at: number; dist: number } | null = null;
  for (const id of ids) {
    const q = m.walls.find((z) => z.wall.id === id)?.wall;
    if (!q) continue;
    const dist = Math.abs(q.pos - along);
    if (!best || dist < best.dist) best = { id, at: (q.from + q.to) / 2, dist };
  }
  return best && { id: best.id, at: best.at };
}

/** The nearest wall on the same line as wall x that does not touch it (x lines up with it), or null */
export function lineUp(walls: Wall[], x: Wall): number | null {
  let best: number | null = null,
    gap = Infinity;
  for (const q of walls) {
    if (q.id === x.id || q.axis !== x.axis || Math.abs(q.pos - x.pos) >= 0.005) continue;
    const g = Math.max(q.from - x.to, x.from - q.to);
    if (g > EPS && g < gap) (gap = g), (best = q.id);
  }
  return best;
}

/**
 * Move wall id as near to pos as it may go (for dragging), with the pointer at `along` on it. Within snap, first the
 * middle of the space at the pointer or the middle of the wall nearest the pointer that it ends on or crosses, for
 * even divisions, or the line of another wall in the same direction that it does not touch (the nearest of these). Otherwise the nearest place where the move is accepted: a whole
 * millimetre, or lined up with a wall it can be joined with. So a wall jumps over places where it may not stand (on or too close to
 * another wall) and never stays there. The answer of pos itself when none works.
 */
export function moveWallNear(l: Layout, w: number, d: number, lim: Limits, id: number, pos: number, snap = 0, along?: number, sides?: Record<Side, boolean>): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const wid = x.axis === 'h' ? d : w;
  const reach = lim.t + lim.gap;
  const near = (a: number, b: number) => Math.abs(a - pos) - Math.abs(b - pos);
  // The middle first (a snap); joining and whole millimetres by distance, so near the edge of the space around a wall
  // it can be joined with, the wall goes past it instead
  const first: number[] = [];
  if (snap > 0) {
    const a = along ?? (x.from + x.to) / 2;
    const n = neighbours(walls, { ...x, pos }, w, d, lim.t, a, sides);
    const c = wallCentre(buildModel({ ref: [w, d], walls }, w, d, lim), x, a);
    for (const m of [(n.lo + n.hi) / 2, ...(c ? [c.at] : [])]) if (Math.abs(m - pos) <= snap) first.push(m);
    // The line of a wall in the same direction (not one it would be joined with: that goes by distance, see below)
    for (const q of walls)
      if (q.id !== id && q.axis === x.axis && Math.abs(q.pos - pos) <= snap && !(Math.abs(q.to - x.from) < EPS || Math.abs(q.from - x.to) < EPS)) first.push(q.pos);
  }
  const rest: number[] = [];
  for (const q of walls)
    if (q.id !== id && q.axis === x.axis && Math.abs(q.pos - pos) <= reach && (Math.abs(q.to - x.from) < EPS || Math.abs(q.from - x.to) < EPS)) rest.push(q.pos);
  const r0 = Math.round(pos);
  for (let k = 0; k <= wid; k++) rest.push(r0 + k, r0 - k);
  const order = [...new Set([...first.sort(near), ...rest.sort(near)])].filter((c) => c > 0 && c < wid);
  let refused: EditResult | null = null;
  for (const c of order) {
    const r = moveWall(l, w, d, lim, id, c);
    if (r.ok) return r;
    refused ??= r;
  }
  return refused ?? moveWall(l, w, d, lim, id, pos);
}

/**
 * Snap an end at coordinate c of a wall on line `pos` along axis `axis` to what is near (within snap mm): the outer
 * walls, the line of a perpendicular wall (a T), or the end of one (a corner; that wall's end is moved onto this line).
 * Returns the coordinate and the walls with a corner partner's end moved.
 */
function snapEnd(walls: Wall[], self: number, axis: Axis, pos: number, c: number, len: number, snap: number): { c: number; walls: Wall[] } {
  if (Math.abs(c) <= snap) return { c: 0, walls };
  if (Math.abs(c - len) <= snap) return { c: len, walls };
  let best: { q: Wall; dist: number } | null = null;
  for (const q of walls) {
    if (q.id === self || q.axis === axis) continue;
    const dist = Math.abs(q.pos - c);
    if (dist <= snap && q.from - snap <= pos && pos <= q.to + snap && (!best || dist < best.dist)) best = { q, dist };
  }
  if (!best) return { c, walls };
  const q = best.q;
  // Nahe am Ende der anderen Wand: Ecke, deren Ende kommt auf diese Linie
  if (Math.abs(q.from - pos) <= snap) return { c: q.pos, walls: walls.map((r) => (r.id === q.id ? { ...r, from: pos } : r)) };
  if (Math.abs(q.to - pos) <= snap) return { c: q.pos, walls: walls.map((r) => (r.id === q.id ? { ...r, to: pos } : r)) };
  return { c: q.pos, walls };
}

/** Move one end of wall id along its line to c (snapped within snap mm). Joints may appear or go; refused with a new error */
export function stretchEnd(l: Layout, w: number, d: number, lim: Limits, id: number, which: 'from' | 'to', c: number, snap: number): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const before = buildModel({ ref: [w, d], walls }, w, d, lim);
  const len = x.axis === 'h' ? w : d;
  const s = snapEnd(walls, id, x.axis, x.pos, c, len, snap);
  const other = which === 'from' ? x.to : x.from;
  if (Math.abs(s.c - other) < lim.minLen) return refuse('wall-short', { id, min: lim.minLen });
  const next = s.walls.map((q) => (q.id === id ? { ...q, from: Math.min(s.c, other), to: Math.max(s.c, other) } : q));
  const on = onAnother(next, id);
  if (on) return refuse('move-onto', { id, id2: on.id });
  return accept(before, next, w, d, lim);
}

/** Stretch an end as near to c as it may go (for dragging): the nearest whole millimetre where it is accepted */
export function stretchEndNear(l: Layout, w: number, d: number, lim: Limits, id: number, which: 'from' | 'to', c: number, snap: number): EditResult {
  const r = stretchEnd(l, w, d, lim, id, which, c, snap);
  if (r.ok) return r;
  const x = current(l, w, d).find((q) => q.id === id);
  if (!x) return r;
  const len = x.axis === 'h' ? w : d;
  const r0 = Math.round(c);
  for (let k = 1; k <= len; k++)
    for (const cc of [r0 - k, r0 + k]) {
      if (cc < 0 || cc > len) continue;
      const q = stretchEnd(l, w, d, lim, id, which, cc, snap);
      if (q.ok) return q;
    }
  return r;
}

/** Add a wall (both ends snapped within snap mm); it gets the next free id */
export function addWall(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, from: number, to: number, snap: number): EditResult {
  let walls = current(l, w, d);
  const before = buildModel({ ref: [w, d], walls }, w, d, lim);
  const id = walls.reduce((m, q) => Math.max(m, q.id), 0) + 1;
  const len = axis === 'h' ? w : d;
  const a = snapEnd(walls, id, axis, pos, Math.min(from, to), len, snap);
  walls = a.walls;
  const b = snapEnd(walls, id, axis, pos, Math.max(from, to), len, snap);
  walls = b.walls;
  if (Math.abs(b.c - a.c) < lim.minLen) return refuse('wall-short', { id, min: lim.minLen });
  const next = [...walls, { id, axis, pos, from: Math.min(a.c, b.c), to: Math.max(a.c, b.c) }];
  const r = accept(before, next, w, d, lim);
  // Auf eine vorhandene Wand gelegt: sie wäre mit ihr verschmolzen
  if (r.ok && r.layout.walls.length !== next.length) return refuse('add-on-wall', { id });
  return r;
}

/**
 * The walls of a box whose inner size changes from ow × od to nw × nd, keeping their distances in mm from the left and
 * back walls; ends at the right or front wall stay there
 */
export function keepWalls(walls: Wall[], ow: number, od: number, nw: number, nd: number): Wall[] {
  return walls.map((x) => {
    const [ol, nl] = x.axis === 'h' ? [ow, nw] : [od, nd];
    return { ...x, from: x.from > ol - EPS ? nl : x.from, to: x.to > ol - EPS ? nl : x.to };
  });
}

/** Delete wall id; walls that ended on it get a free end there */
export function deleteWall(l: Layout, w: number, d: number, id: number): EditResult {
  const walls = current(l, w, d);
  if (!walls.some((q) => q.id === id)) return refuse('edit-no-wall', { id });
  return { ok: true, layout: { ref: [w, d], walls: walls.filter((q) => q.id !== id) } };
}
