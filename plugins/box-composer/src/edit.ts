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
 * Follower q (a wall with an end on the line `pos` of a moving wall): that end goes to the new line `to`. Getting
 * shorter, it stops at the first joint on q it meets (a wall ending on q or crossing it), so that wall keeps its joint
 * and the moving wall ends on q there instead.
 */
function followEnd(m: Model, q: Wall, pos: number, to: number): Wall {
  const it = m.walls.find((z) => z.wall.id === q.id);
  const joints = it ? [...it.tees.map((z) => z.at), ...it.crosses.map((c) => c.at)] : [];
  const passed = joints.filter((a) => a > Math.min(pos, to) + EPS && a < Math.max(pos, to) - EPS && to > q.from + EPS && to < q.to - EPS);
  const end = passed.length ? passed.reduce((b, a) => (Math.abs(a - pos) < Math.abs(b - pos) ? a : b)) : to;
  const from = Math.abs(q.from - pos) < EPS ? end : q.from,
    upto = Math.abs(q.to - pos) < EPS ? end : q.to;
  return { ...q, from: Math.min(from, upto), to: Math.max(from, upto) };
}

/** Wall h that a moving wall ends on or crosses reaches the new line `to`: when `to` lies beyond h, its nearer end goes there */
function reach(h: Wall, to: number): Wall {
  if (to < h.from - EPS) return { ...h, from: to };
  if (to > h.to + EPS) return { ...h, to };
  return h;
}

/**
 * Move wall id across its line to pos. Walls ending on it (T or corner) follow, so they stay joined (getting shorter
 * only up to their next joint); a wall it ends on (T) gets longer when it moves past its end. Joints may change (it may
 * pass other walls); refused when it would lie on another wall of the same line or bring a new error. A wall it meets
 * end to end on the same line is joined with it (one wall, e.g. crossing the wall both ended on).
 */
export function moveWall(l: Layout, w: number, d: number, lim: Limits, id: number, pos: number): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const before = buildModel({ ref: [w, d], walls }, w, d, lim);
  const info = new Map(before.walls.map((it) => [it.wall.id, it]));
  const xi = info.get(id);
  const hosts = new Set([xi?.start, xi?.end].flatMap((e) => (e?.kind === 'tee' ? [e.host] : [])));
  const moved = walls.map((q) => {
    if (q.id === id) return { ...q, pos };
    if (hosts.has(q.id)) return reach(q, pos);
    const it = info.get(q.id);
    if (!it) return q;
    const ends = (e: (typeof it)['start']) => (e.kind === 'tee' && e.host === id) || (e.kind === 'corner' && e.other === id);
    return ends(it.start) || ends(it.end) ? followEnd(before, q, x.pos, pos) : q;
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
 * middle of the space at the pointer, the middle of the whole box (outer size, with or without outer walls) or the
 * middle of the wall nearest the pointer that it ends on or crosses, for even divisions, or the line of another wall in the same direction that it does not touch (the nearest of these). Otherwise the nearest place where the move is accepted: a whole
 * millimetre, or lined up with a wall it can be joined with. So a wall jumps over places where it may not stand (on or too close to
 * another wall) and never stays there. The answer of pos itself when none works.
 */
export function moveWallNear(l: Layout, w: number, d: number, lim: Limits, id: number, pos: number, snap = 0, along?: number, sides?: Record<Side, boolean>): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const order = snapOrder(walls, buildModel({ ref: [w, d], walls }, w, d, lim), x, w, d, lim, pos, snap, along, sides);
  let refused: EditResult | null = null;
  for (const c of order) {
    const r = moveWall(l, w, d, lim, id, c);
    if (r.ok) return r;
    refused ??= r;
  }
  return refused ?? moveWall(l, w, d, lim, id, pos);
}

/** The places to try for wall x of walls (model m) dragged to pos, best first (see moveWallNear) */
function snapOrder(walls: Wall[], m: Model, x: Wall, w: number, d: number, lim: Limits, pos: number, snap: number, along?: number, sides?: Record<Side, boolean>): number[] {
  const wid = x.axis === 'h' ? d : w;
  const reach = lim.t + lim.gap;
  const near = (a: number, b: number) => Math.abs(a - pos) - Math.abs(b - pos);
  // The middle first (a snap); joining and whole millimetres by distance, so near the edge of the space around a wall
  // it can be joined with, the wall goes past it instead
  const first: number[] = [];
  if (snap > 0) {
    const a = along ?? (x.from + x.to) / 2;
    const n = neighbours(walls, { ...x, pos }, w, d, lim.t, a, sides);
    const c = wallCentre(m, x, a);
    // Die Mitte der ganzen Kiste: die Außenkanten liegen bei −t und wid + t, auch an offenen Seiten (der Boden)
    for (const v of [(n.lo + n.hi) / 2, wid / 2, ...(c ? [c.at] : [])]) if (Math.abs(v - pos) <= snap) first.push(v);
    // The line of a wall in the same direction (not one it would be joined with: that goes by distance, see below)
    for (const q of walls)
      if (q.id !== x.id && q.axis === x.axis && Math.abs(q.pos - pos) <= snap && !(Math.abs(q.to - x.from) < EPS || Math.abs(q.from - x.to) < EPS)) first.push(q.pos);
  }
  const rest: number[] = [];
  for (const q of walls)
    if (q.id !== x.id && q.axis === x.axis && Math.abs(q.pos - pos) <= reach && (Math.abs(q.to - x.from) < EPS || Math.abs(q.from - x.to) < EPS)) rest.push(q.pos);
  const r0 = Math.round(pos);
  for (let k = 0; k <= wid; k++) rest.push(r0 + k, r0 - k);
  return [...new Set([...first.sort(near), ...rest.sort(near)])].filter((c) => c > 0 && c < wid);
}

// ---- Stretches: the pieces of a wall between its ends and joints, selected and moved on their own ----

/** A piece of a line of walls: from and to along it */
export type Run = [number, number];

/** The stretch of wall x (between its ends, the walls ending on it and the walls crossing it) that holds `along` */
export function stretchOf(m: Model, x: Wall, along: number): Run {
  const it = m.walls.find((q) => q.wall.id === x.id);
  const marks = [...new Set([x.from, x.to, ...(it ? [...it.tees.map((q) => q.at), ...it.crosses.map((c) => c.at)] : [])])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < marks.length; i++) if (along >= marks[i] - EPS && along <= marks[i + 1] + EPS) return [marks[i], marks[i + 1]];
  return [x.from, x.to];
}

/** Runs sorted, those that touch or overlap joined */
export function joinRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const [a, b] of runs.map(([a, b]): Run => [Math.min(a, b), Math.max(a, b)]).sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

const onLine = (q: Wall, axis: Axis, pos: number) => q.axis === axis && Math.abs(q.pos - pos) < EPS;
/** The parts of the runs on wall q (longer than EPS) */
const runsOn = (q: Wall, runs: Run[]) => joinRuns(runs).map(([a, b]): Run => [Math.max(a, q.from), Math.min(b, q.to)]).filter(([a, b]) => b - a > EPS);

/**
 * The walls with the runs of the line (axis, pos) moved to `to`, without checks. Each wall of the line is cut where a
 * run begins or ends: the rest stays (its first piece keeps the id), the runs become walls of their own. Walls ending
 * on a run follow it (their end moves along), as when a whole wall moves; at the edge of a run where its wall goes on,
 * only a wall coming from behind follows: it gets longer, so the piece that stays is still joined to it and the run and
 * the two walls form a U. A wall coming from the side the run moves to stays, and the run crosses it. Walls the runs
 * cross or end on stay too and get longer when a run moves past their end, so nothing comes loose; followers get
 * shorter only up to their next joint (followEnd).
 */
function shiftRuns(walls: Wall[], m: Model, axis: Axis, pos: number, runs: Run[], to: number): { walls: Wall[]; moved: { id: number; origin: number }[] } {
  const info = new Map(m.walls.map((it) => [it.wall.id, it]));
  const dir = Math.sign(to - pos);
  let next = walls.reduce((n, q) => Math.max(n, q.id), 0) + 1;
  const follow = new Set<number>(),
    reached = new Set<number>();
  const out: Wall[] = [];
  const moved: { id: number; origin: number }[] = [];
  for (const q of walls) {
    const mine = onLine(q, axis, pos) ? runsOn(q, runs) : [];
    if (!mine.length) {
      out.push(q);
      continue;
    }
    const it = info.get(q.id);
    const inRun = (b: number) => mine.find(([a, c]) => b >= a - EPS && b <= c + EPS);
    for (const tee of it?.tees ?? []) {
      const r = inRun(tee.at);
      if (!r) continue;
      const edge = Math.abs(tee.at - r[0]) < EPS ? r[0] : Math.abs(tee.at - r[1]) < EPS ? r[1] : null;
      const goesOn = edge !== null && edge > q.from + EPS && edge < q.to - EPS;
      if (!goesOn || tee.side !== dir) follow.add(tee.wall);
      else reached.add(tee.wall);
    }
    // Walls the runs cross or end on stay; past their end they get longer, so the run stays joined to them
    for (const c of it?.crosses ?? []) if (inRun(c.at)) reached.add(c.wall);
    for (const [e, at] of [[it?.start, q.from], [it?.end, q.to]] as const) {
      if (e?.kind === 'corner' && inRun(at)) follow.add(e.other);
      if (e?.kind === 'tee' && inRun(at)) reached.add(e.host);
    }
    const rest: Run[] = [];
    let cur = q.from;
    for (const [a, b] of mine) {
      if (a - cur > EPS) rest.push([cur, a]);
      cur = b;
    }
    if (q.to - cur > EPS) rest.push([cur, q.to]);
    let first = true;
    const piece = (a: number, b: number, p: number) => {
      const id = first ? q.id : next++;
      first = false;
      out.push({ ...q, id, pos: p, from: a, to: b });
      return id;
    };
    for (const [a, b] of rest) piece(a, b, pos);
    for (const [a, b] of mine) moved.push({ id: piece(a, b, to), origin: q.id });
  }
  const shifted = out.map((q) => (follow.has(q.id) ? followEnd(m, q, pos, to) : reached.has(q.id) ? reach(q, to) : q));
  return { walls: shifted, moved };
}

/** The id of the wall the runs of the line (axis, pos) cover completely, when they are exactly one whole wall */
export function wholeWall(walls: Wall[], axis: Axis, pos: number, runs: Run[]): number | null {
  const R = joinRuns(runs);
  const hit = walls.filter((q) => onLine(q, axis, pos) && runsOn(q, R).length);
  if (R.length !== 1 || hit.length !== 1) return null;
  const q = hit[0];
  return Math.abs(q.from - R[0][0]) < EPS && Math.abs(q.to - R[0][1]) < EPS ? q.id : null;
}

/**
 * Move the runs (stretches) of the line (axis, pos) across it to `to`, cutting their walls (see shiftRuns). Refused
 * when a run would lie on another wall of the same line or the walls bring a new error. A run moved back onto its line
 * is joined with the rest again.
 */
export function moveRuns(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, runs: Run[], to: number): EditResult {
  const walls = current(l, w, d);
  const before = buildModel({ ref: [w, d], walls }, w, d, lim);
  const s = shiftRuns(walls, before, axis, pos, runs, to);
  if (!s.moved.length) return refuse('edit-no-wall', { id: 0 });
  for (const mv of s.moved) {
    const on = onAnother(s.walls, mv.id);
    if (on) return refuse('move-onto', { id: mv.origin, id2: on.id });
  }
  return accept(before, s.walls, w, d, lim);
}

/**
 * Move the runs as near to `to` as they may go (for dragging), with the pointer at `along`: the same places as for a
 * whole wall (moveWallNear), seen from the run under the pointer where it would be. Runs that are one whole wall move
 * that wall. On success also the line the runs are on now.
 */
export function moveRunsNear(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, runs: Run[], to: number, snap = 0, along?: number, sides?: Record<Side, boolean>): EditResult & { pos?: number } {
  const walls = current(l, w, d);
  const R = joinRuns(runs);
  if (!R.length) return refuse('edit-no-wall', { id: 0 });
  const a = along ?? (R[0][0] + R[0][1]) / 2;
  const landed = (r: EditResult): EditResult & { pos?: number } => {
    if (!r.ok) return r;
    // Where the runs are now: the wall of this direction that holds the run under the pointer, nearest to `to`
    const run = R.find(([p, q]) => a >= p - EPS && a <= q + EPS) ?? R[0];
    const holds = r.layout.walls.filter((q) => q.axis === axis && q.from <= run[0] + EPS && q.to >= run[1] - EPS);
    holds.sort((p, q) => Math.abs(p.pos - to) - Math.abs(q.pos - to));
    return holds.length ? { ...r, pos: holds[0].pos } : r;
  };
  const whole = wholeWall(walls, axis, pos, R);
  if (whole !== null) return landed(moveWallNear(l, w, d, lim, whole, to, snap, along, sides));
  const m = buildModel({ ref: [w, d], walls }, w, d, lim);
  const trial = shiftRuns(walls, m, axis, pos, R, to);
  const x = trial.walls.find((q) => trial.moved.some((mv) => mv.id === q.id) && q.from <= a + EPS && q.to >= a - EPS);
  if (!x) return refuse('edit-no-wall', { id: 0 });
  const order = snapOrder(trial.walls, buildModel({ ref: [w, d], walls: trial.walls }, w, d, lim), x, w, d, lim, to, snap, a, sides);
  let refused: EditResult | null = null;
  for (const c of order) {
    const r = moveRuns(l, w, d, lim, axis, pos, R, c);
    if (r.ok) return landed(r);
    refused ??= r;
  }
  return refused ?? moveRuns(l, w, d, lim, axis, pos, R, to);
}

/** Delete the runs of the line (axis, pos); what is left of their walls stays, walls that ended on a run get a free end */
export function deleteRuns(l: Layout, w: number, d: number, axis: Axis, pos: number, runs: Run[]): EditResult {
  const walls = current(l, w, d);
  let next = walls.reduce((n, q) => Math.max(n, q.id), 0) + 1;
  const out: Wall[] = [];
  let hit = false;
  for (const q of walls) {
    const mine = onLine(q, axis, pos) ? runsOn(q, runs) : [];
    if (!mine.length) {
      out.push(q);
      continue;
    }
    hit = true;
    let cur = q.from,
      first = true;
    const keep = (a: number, b: number) => {
      out.push({ ...q, id: first ? q.id : next++, from: a, to: b });
      first = false;
    };
    for (const [a, b] of mine) {
      if (a - cur > EPS) keep(cur, a);
      cur = b;
    }
    if (q.to - cur > EPS) keep(cur, q.to);
  }
  if (!hit) return refuse('edit-no-wall', { id: 0 });
  return { ok: true, layout: { ref: [w, d], walls: out } };
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
