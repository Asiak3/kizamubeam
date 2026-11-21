// Edit operations of the box composer for the plan editor (#385): move a wall, stretch an end, add, delete. Pure
// functions on the layout: each returns the new layout or why the edit is refused (a code with values, texts in the
// manifest). The editor keeps the last accepted layout while dragging.
//
// The outer walls are walls like the others (#451): moving one, or a stretch of one, changes what the walls enclose
// (a corner cut away, a U or C notch, another size); the box is found again from the walls (model.ts). A layout may
// then lie beside the inner size w × d it was edited in; settle moves it back to its own.
import { buildModel, EPS, mergeWalls, openWalls, scaleLayout, type Axis, type Layout, type Limits, type Model, type Side, type Wall } from './model';
import { bbox, edges, where } from './outline';

export type EditResult = { ok: true; layout: Layout } | { ok: false; code: string; values?: Record<string, number> };

/** The walls as they are in the inner size w × d (scaled to it and merged): the starting point of every edit */
export function current(l: Layout, w: number, d: number): Wall[] {
  return mergeWalls(scaleLayout(l, w, d));
}

/**
 * The model of a layout, from a memory of the last ones (fluid dragging): a drag asks for the same walls again and again
 * (the walls it started from, the same places on every pointer move, the drawing after it). The models are only read.
 */
const models = new Map<string, Model>();
export function modelFor(l: Layout, w: number, d: number, lim: Limits): Model {
  const key = JSON.stringify([l.ref, l.walls, l.sides ?? null, w, d, lim]);
  let m = models.get(key);
  if (m) models.delete(key);
  else m = buildModel(l, w, d, lim);
  models.set(key, m);
  if (models.size > 64) models.delete(models.keys().next().value!);
  return m;
}

/** Edits tried while dragging, by layout and place: the next pointer move tries mostly the same places again */
const tried = new Map<string, unknown>();
function remember<T>(key: string, f: () => T): T {
  if (tried.has(key)) {
    const r = tried.get(key) as T;
    tried.delete(key);
    tried.set(key, r);
    return r;
  }
  const r = f();
  tried.set(key, r);
  if (tried.size > 256) tried.delete(tried.keys().next().value!);
  return r;
}
/** The part of a key of remember for an edit of layout l in w × d */
const keyOf = (l: Layout, w: number, d: number, lim: Limits, ...more: unknown[]) => JSON.stringify([l.ref, l.walls, l.sides ?? null, w, d, lim, ...more]);

const refuse = (code: string, values?: Record<string, number>): EditResult => ({ ok: false, code, ...(values ? { values } : {}) });
const errorsOf = (m: Model) => new Set(m.issues.filter((i) => i.level === 'error').map((i) => i.code + JSON.stringify(i.values ?? {})));

/** The layout l with other walls */
const withWalls = (l: Layout, w: number, d: number, walls: Wall[]): Layout => ({ ...l, ref: [w, d], walls });

/** Accept the new walls unless they bring an error the layout did not have before */
function accept(before: Model, l: Layout, walls: Wall[], w: number, d: number, lim: Limits): EditResult {
  const after = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const old = errorsOf(before);
  const fresh = after.issues.find((i) => i.level === 'error' && !old.has(i.code + JSON.stringify(i.values ?? {})));
  if (fresh) return refuse(fresh.code, fresh.values);
  return { ok: true, layout: withWalls(l, w, d, mergeWalls(walls)) };
}

/**
 * Nodes for the magnetic snaps (#451): the free ends of the walls (not those of wall skip) and the corners where two
 * walls end. A dragged end or wall lines up with them.
 */
export function nodes(m: Model, skip?: number): [number, number][] {
  const out: [number, number][] = [];
  for (const it of m.walls) {
    if (it.wall.id === skip) continue;
    for (const [e, at] of [[it.start, it.wall.from], [it.end, it.wall.to]] as const)
      if (e.kind === 'free' || (e.kind === 'corner' && e.other !== skip)) out.push(it.wall.axis === 'h' ? [at, it.wall.pos] : [it.wall.pos, at]);
  }
  return out;
}

/** The centre of the box the walls of model m enclose (of the outer size; with open sides too), if they enclose one */
export function boxCentre(m: Model): [number, number] | null {
  if (!m.box) return null;
  const [x0, y0, x1, y1] = bbox(m.box.pts);
  return [(x0 + x1) / 2, (y0 + y1) / 2];
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
  const r = moveWallPlain(l, w, d, lim, id, pos);
  if (r.ok) return r;
  // An open wall that is refused moves like a closed one (#451)
  const x = current(l, w, d).find((q) => q.id === id);
  if (!x?.open) return r;
  const o = moveOpen(l, w, d, lim, x.axis, x.pos, [[x.from, x.to]], pos);
  return o.ok ? o : r;
}
function moveWallPlain(l: Layout, w: number, d: number, lim: Limits, id: number, pos: number): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const before = modelFor(withWalls(l, w, d, walls), w, d, lim);
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
  if (leaves(before, id, x.axis, pos, x.from, x.to)) return refuse('wall-outside', { id });
  return accept(before, l, moved, w, d, lim);
}

/**
 * Does wall id (of model m), moved to the line pos with the stretch a … b, leave the box? Only outer walls (some of
 * them on the outline) move the box with them (#451); any other wall stays inside: its middle must lie in the box.
 */
function leaves(m: Model, id: number, axis: Axis, pos: number, a: number, b: number): boolean {
  if (!m.box || m.box.edgeWall.includes(id)) return false;
  const mid = (a + b) / 2;
  return where(m.box.pts, axis === 'h' ? mid : pos, axis === 'h' ? pos : mid) !== 'in';
}

/**
 * The centre lines of the nearest walls on both sides of wall x, at `along` on it (default its middle): the space
 * there (outer walls are walls too, so the clear space is the distance minus t). An open side (`sides` false there)
 * counts a thickness beyond the line of its outer wall: the edge of the floor, which reaches the outer size there.
 * Infinite on a side without a wall (outside the box).
 */
export function neighbours(walls: Wall[], x: Wall, w: number, d: number, t: number, along?: number, sides?: Record<Side, boolean>): { lo: number; hi: number } {
  const mid = along ?? (x.from + x.to) / 2;
  let lo = -Infinity,
    hi = Infinity;
  for (const q of [...walls, ...openWalls(walls, sides, w, d, t)]) {
    if (q.id === x.id || q.axis !== x.axis || q.from > mid || q.to < mid) continue;
    // (an open outer wall, or an open side: a thickness further out, the edge of the floor)
    const out = q.open || q.id < 0 ? t : 0;
    if (q.pos < x.pos) lo = Math.max(lo, q.pos - out);
    else if (q.pos > x.pos) hi = Math.min(hi, q.pos + out);
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
  const order = snapOrder(walls, modelFor(withWalls(l, w, d, walls), w, d, lim), x, w, d, lim, pos, snap, along, sides);
  let refused: EditResult | null = null;
  const key = keyOf(l, w, d, lim, 'wall', id);
  for (const c of order) {
    const r = remember(key + c, () => moveWall(l, w, d, lim, id, c));
    if (r.ok) return r;
    refused ??= r;
  }
  return refused ?? moveWall(l, w, d, lim, id, pos);
}

/** The places to try for wall x of walls (model m) dragged to pos, best first (see moveWallNear) */
function snapOrder(walls: Wall[], m: Model, x: Wall, w: number, d: number, lim: Limits, pos: number, snap: number, along?: number, sides?: Record<Side, boolean>): number[] {
  const reach = lim.t + lim.gap;
  const near = (a: number, b: number) => Math.abs(a - pos) - Math.abs(b - pos);
  // The middle first (a snap); joining and whole millimetres by distance, so near the edge of the space around a wall
  // it can be joined with, the wall goes past it instead
  const first: number[] = [];
  // Walls in the same direction it meets end to end (it would be joined with them)
  const touching = (q: Wall) => q.id !== x.id && q.axis === x.axis && (Math.abs(q.to - x.from) < EPS || Math.abs(q.from - x.to) < EPS);
  const joins = walls.filter(touching).map((q) => q.pos);
  if (snap > 0) {
    const a = along ?? (x.from + x.to) / 2;
    const n = neighbours(walls, { ...x, pos }, w, d, lim.t, a, sides);
    const c = wallCentre(m, x, a);
    // Die Mitte der ganzen Kiste (Außenmaß, auch an offenen Seiten: der Boden)
    const bc = boxCentre(m);
    for (const v of [(n.lo + n.hi) / 2, ...(bc ? [x.axis === 'h' ? bc[1] : bc[0]] : []), ...(c ? [c.at] : [])]) if (Number.isFinite(v) && Math.abs(v - pos) <= snap) first.push(v);
    // The line of a wall in the same direction (not one it would be joined with: that goes by distance, see below)
    for (const q of walls)
      if (q.id !== x.id && q.axis === x.axis && Math.abs(q.pos - pos) <= snap && !touching(q)) first.push(q.pos);
    // In line with a node (a free end, a corner), not on the line of a wall it would be joined with (where a stretch
    // was cut from: by distance, see below)
    for (const [nx, ny] of nodes(m, x.id)) {
      const v = x.axis === 'h' ? ny : nx;
      if (Math.abs(v - pos) <= snap && !joins.some((j) => Math.abs(j - v) < EPS)) first.push(v);
    }
  }
  const rest: number[] = joins.filter((j) => Math.abs(j - pos) <= reach);
  // Whole millimetres on the centre line; an outer wall (on the outline) also on its outer face, so that the box can
  // get a whole outer size
  const e = m.box && edges(m.box.pts).find((q) => q.axis === x.axis && Math.abs(q.pos - x.pos) < EPS && Math.min(q.to, x.to) - Math.max(q.from, x.from) > EPS);
  const o = e ? (-e.inside * lim.t) / 2 : 0;
  const r0 = Math.round(pos),
    rf = Math.round(pos + o) - o;
  for (let k = 0; k <= reachOf(lim, snap); k++) rest.push(r0 + k, r0 - k, ...(e ? [rf + k, rf - k] : []));
  return [...new Set([...first.sort(near), ...rest.sort(near)])];
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
    // A third wall at a corner of q: where two walls of a line meet end to end (an open stretch beside a closed one,
    // moveGroup screenshots), both follow, so the joint moves with the run
    for (const z of m.walls) if (z.wall.axis !== q.axis && [z.start, z.end].some((e) => e.kind === 'corner' && e.other === q.id) && inRun(z.wall.pos)) follow.add(z.wall.id);
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
  const r = moveRunsPlain(l, w, d, lim, axis, pos, runs, to);
  if (r.ok) return r;
  // Stretches that are open and refused move like closed ones (#451)
  if (!current(l, w, d).some((q) => q.open && onLine(q, axis, pos) && runsOn(q, runs).length)) return r;
  const o = moveOpen(l, w, d, lim, axis, pos, runs, to);
  return o.ok ? o : r;
}

/**
 * An open stretch moved like a closed one (#451): the box is seen with every wall built, the stretches move as in
 * moveRuns (the walls ending on them follow, the box changes shape), and the open stretches are open again where they
 * are now. (At an open stretch the model joins the walls ending on it to the wall next to it in the line, so they would not
 * follow it.) Checked against the real walls, with the open ones, as any edit.
 */
function moveOpen(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, runs: Run[], to: number): EditResult {
  const walls = current(l, w, d);
  const real = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const spans = walls.filter((q) => q.open);
  const built = withWalls(l, w, d, walls.map(({ open, ...q }) => q));
  const r = moveRunsPlain(l.sides ? { ...built, sides: { x0: true, x1: true, y0: true, y1: true } } : built, w, d, lim, axis, pos, runs, to);
  if (!r.ok) return moveOpenAlone(l, w, d, lim, axis, pos, runs, to, walls, real) ?? r;
  let out = r.layout.walls;
  let next = out.reduce((n, q) => Math.max(n, q.id), 0) + 1;
  for (const sp of spans) {
    // Where the stretch is now: on the new line when it was one of the moved ones
    const line = onLine(sp, axis, pos) && runsOn(sp, runs).length ? to : sp.pos;
    const pieces: Wall[] = [];
    for (const q of out) {
      const a = Math.max(q.from, sp.from),
        b = Math.min(q.to, sp.to);
      if (!onLine(q, sp.axis, line) || b - a < EPS) {
        pieces.push(q);
        continue;
      }
      let first = true;
      const piece = (from: number, upto: number, open: boolean) => {
        pieces.push({ ...q, id: first ? q.id : next++, from, to: upto, ...(open ? { open: true } : {}) });
        first = false;
      };
      if (a - q.from > EPS) piece(q.from, a, false);
      piece(a, b, true);
      if (q.to - b > EPS) piece(b, q.to, false);
    }
    out = pieces;
  }
  return accept(real, l, out, w, d, lim);
}

/**
 * An open stretch with no wall across it at its ends (a gap in the middle of an outer wall) moved alone (#451): it moves
 * and gets an open side at each end, from the old line to the new one (no wall there, the floor follows the new shape).
 * null when it is not that case (a wall ends on it, or the runs are not open stretches).
 */
function moveOpenAlone(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, runs: Run[], to: number, walls: Wall[], real: Model): EditResult | null {
  const R = joinRuns(runs);
  if (!R.length || Math.abs(to - pos) < EPS) return null;
  const line = walls.filter((q) => onLine(q, axis, pos));
  if (!R.every(([a, b]) => line.some((q) => q.open && q.from <= a + EPS && q.to >= b - EPS))) return null;
  // Walls across it, at an end or anywhere along it: those the move would have to take along
  if (walls.some((q) => q.axis !== axis && q.from - EPS <= pos && q.to + EPS >= pos && R.some(([a, b]) => q.pos >= a - EPS && q.pos <= b + EPS))) return null;
  let next = walls.reduce((n, q) => Math.max(n, q.id), 0) + 1;
  const out: Wall[] = [];
  for (const q of walls) {
    const mine = onLine(q, axis, pos) ? runsOn(q, R) : [];
    if (!mine.length) {
      out.push(q);
      continue;
    }
    let first = true;
    const piece = (from: number, upto: number, p: number) => {
      out.push({ ...q, id: first ? q.id : next++, pos: p, from, to: upto });
      first = false;
    };
    let cur = q.from;
    for (const [a, b] of mine) {
      if (a - cur > EPS) piece(cur, a, pos);
      piece(a, b, to);
      cur = b;
    }
    if (q.to - cur > EPS) piece(cur, q.to, pos);
  }
  const across: Axis = axis === 'h' ? 'v' : 'h';
  for (const [a, b] of R) for (const at of [a, b]) out.push({ id: next++, axis: across, pos: at, from: Math.min(pos, to), to: Math.max(pos, to), open: true });
  return accept(real, l, out, w, d, lim);
}

function moveRunsPlain(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, runs: Run[], to: number): EditResult {
  const walls = current(l, w, d);
  const before = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const s = shiftRuns(walls, before, axis, pos, runs, to);
  if (!s.moved.length) return refuse('edit-no-wall', { id: 0 });
  for (const mv of s.moved) {
    const on = onAnother(s.walls, mv.id);
    if (on) return refuse('move-onto', { id: mv.origin, id2: on.id });
    const q = s.walls.find((z) => z.id === mv.id)!;
    if (leaves(before, mv.origin, axis, to, q.from, q.to)) return refuse('wall-outside', { id: mv.origin });
  }
  return accept(before, l, s.walls, w, d, lim);
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
  const m = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const trial = shiftRuns(walls, m, axis, pos, R, to);
  const x = trial.walls.find((q) => trial.moved.some((mv) => mv.id === q.id) && q.from <= a + EPS && q.to >= a - EPS);
  if (!x) return refuse('edit-no-wall', { id: 0 });
  const order = snapOrder(trial.walls, modelFor(withWalls(l, w, d, trial.walls), w, d, lim), x, w, d, lim, to, snap, a, sides);
  let refused: EditResult | null = null;
  const key = keyOf(l, w, d, lim, 'runs', axis, pos, R);
  for (const c of order) {
    const r = remember(key + c, () => moveRuns(l, w, d, lim, axis, pos, R, c));
    if (r.ok) return landed(r);
    refused ??= r;
  }
  return refused ?? moveRuns(l, w, d, lim, axis, pos, R, to);
}

/** Stretches of one line (a part of a selection over several lines) */
export interface Group {
  axis: Axis;
  pos: number;
  runs: Run[];
}

/**
 * Move the stretches of several lines together (#451, Shift selects stretches of other walls too): the horizontal
 * lines by dy, the vertical ones by dx, each line as in moveRuns. A corner or T between two selected stretches moves
 * with both (an L stays an L, only bigger). The stretches of an inner wall stay inside the box. On success also the
 * groups where they are now.
 */
export function moveGroups(l: Layout, w: number, d: number, lim: Limits, groups: Group[], dx: number, dy: number): EditResult & { groups?: Group[] } {
  let walls = current(l, w, d);
  const before = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const gs = groups.map((g) => ({ ...g, runs: joinRuns(g.runs) }));
  // The stretches of inner walls (not on the outline), by group: they must stay inside
  const inner = gs.map((g) =>
    g.runs.map((r) => {
      const q = walls.find((z) => onLine(z, g.axis, g.pos) && runsOn(z, [r]).length);
      return !!q && !outerRun(before, q, Math.max(r[0], q.from), Math.min(r[1], q.to));
    }),
  );
  let shifted = false;
  for (const g of gs) {
    const to = g.pos + (g.axis === 'h' ? dy : dx);
    if (Math.abs(to - g.pos) < EPS) continue;
    const m = shifted ? modelFor(withWalls(l, w, d, walls), w, d, lim) : before;
    const s = shiftRuns(walls, m, g.axis, g.pos, g.runs, to);
    if (!s.moved.length) return refuse('edit-no-wall', { id: 0 });
    for (const mv of s.moved) {
      const on = onAnother(s.walls, mv.id);
      if (on) return refuse('move-onto', { id: mv.origin, id2: on.id });
    }
    walls = mergeWalls(s.walls);
    shifted = true;
    // The stretches of the other direction that end where a stretch of this line was now end on its new line
    const from = g.pos;
    const inG = (v: number) => g.runs.some(([a, b]) => v >= a - EPS && v <= b + EPS);
    g.pos = to;
    for (const h of gs)
      if (h.axis !== g.axis && inG(h.pos)) h.runs = joinRuns(h.runs.map(([a, b]): Run => [Math.abs(a - from) < EPS ? to : a, Math.abs(b - from) < EPS ? to : b]));
  }
  const after = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const old = errorsOf(before);
  const fresh = after.issues.find((i) => i.level === 'error' && !old.has(i.code + JSON.stringify(i.values ?? {})));
  if (fresh) return refuse(fresh.code, fresh.values);
  if (after.box)
    for (const [i, g] of gs.entries())
      for (const [j, [a, b]] of g.runs.entries()) {
        const mid = (a + b) / 2;
        if (inner[i][j] && where(after.box.pts, g.axis === 'h' ? mid : g.pos, g.axis === 'h' ? g.pos : mid) !== 'in') {
          const q = walls.find((z) => onLine(z, g.axis, g.pos) && mid >= z.from - EPS && mid <= z.to + EPS);
          return refuse('wall-outside', { id: q?.id ?? 0 });
        }
      }
  return { ok: true, layout: withWalls(l, w, d, mergeWalls(walls)), groups: gs };
}

/**
 * Move the groups as near to dx, dy as they may go (for dragging), with the pointer at `along` on the first group: per
 * direction the places a stretch of the first group of that direction may go (as in moveRunsNear), tried together,
 * nearest first.
 */
export function moveGroupsNear(l: Layout, w: number, d: number, lim: Limits, groups: Group[], dx: number, dy: number, snap = 0, along?: number, sides?: Record<Side, boolean>): EditResult & { groups?: Group[] } {
  const walls = current(l, w, d);
  const m = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const deltas = (axis: Axis, delta: number): number[] => {
    const g = groups.find((q) => q.axis === axis);
    if (!g) return [0];
    const R = joinRuns(g.runs);
    if (!R.length) return [0];
    const a = g === groups[0] && along !== undefined ? along : (R[0][0] + R[0][1]) / 2;
    const to = g.pos + delta;
    const trial = shiftRuns(walls, m, axis, g.pos, R, to);
    const x = trial.walls.find((q) => trial.moved.some((mv) => mv.id === q.id) && q.from <= a + EPS && q.to >= a - EPS);
    if (!x) return [Math.round(delta)];
    return snapOrder(trial.walls, modelFor(withWalls(l, w, d, trial.walls), w, d, lim), x, w, d, lim, to, snap, a, sides).map((c) => c - g.pos);
  };
  const ox = deltas('v', dx),
    oy = deltas('h', dy);
  let refused: EditResult | null = null;
  // Both directions together, the nearest pairs first (a limited number: this runs on every pointer move)
  let tries = 0;
  const key = keyOf(l, w, d, lim, 'groups', groups);
  for (let k = 0; k < ox.length + oy.length - 1 && tries < 40; k++)
    for (let i = Math.max(0, k - oy.length + 1); i <= Math.min(k, ox.length - 1) && tries < 40; i++, tries++) {
      const r = remember(`${key}${ox[i]},${oy[k - i]}`, () => moveGroups(l, w, d, lim, groups, ox[i], oy[k - i]));
      if (r.ok) return r;
      refused ??= r;
    }
  return refused ?? moveGroups(l, w, d, lim, groups, dx, dy);
}

/** Errors of the box itself: the walls enclose none or more than one, an open wall inside, walls outside */
const BOX_ERRORS = new Set(['box-open', 'outline-split', 'open-inside', 'wall-outside']);

/**
 * After a delete (#451: outer walls are walls of the list): the new walls, refused when the box opens, falls apart or
 * leaves walls outside
 */
function deleted(l: Layout, w: number, d: number, lim: Limits, before: Model, out: Wall[]): EditResult {
  const next = withWalls(l, w, d, mergeWalls(out));
  const old = errorsOf(before);
  const why = modelFor(next, w, d, lim).issues.find((i) => i.level === 'error' && BOX_ERRORS.has(i.code) && !old.has(i.code + JSON.stringify(i.values ?? {})));
  return why ? refuse(why.code, why.values) : { ok: true, layout: next };
}

/** Is the stretch a … b of wall q an outer wall (on the outline of the box of model m, or open)? */
function outerRun(m: Model, q: Wall, a: number, b: number): boolean {
  if (q.open) return true;
  if (!m.box) return false;
  const mid = (a + b) / 2;
  return where(m.box.pts, q.axis === 'h' ? mid : q.pos, q.axis === 'h' ? q.pos : mid) === 'on';
}

/**
 * Delete the runs of the line (axis, pos); what is left of their walls stays, walls that ended on a run get a free end.
 * A run of an outer wall is not deleted but left open (the box is open there, its shape stays), an open one is closed
 * again (#451).
 */
export function deleteRuns(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, runs: Run[]): EditResult {
  const walls = current(l, w, d);
  const before = modelFor(withWalls(l, w, d, walls), w, d, lim);
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
    // The pieces of the wall along it: the rest as it is, the runs deleted or (outer walls) opened or closed
    const pieces: Wall[] = [];
    let cur = q.from;
    for (const [a, b] of mine) {
      if (a - cur > EPS) pieces.push({ ...q, from: cur, to: a });
      if (outerRun(before, q, a, b)) {
        const { open, ...rest } = q;
        pieces.push({ ...rest, from: a, to: b, ...(open ? {} : { open: true }) });
      }
      cur = b;
    }
    if (q.to - cur > EPS) pieces.push({ ...q, from: cur, to: q.to });
    pieces.forEach((p, i) => out.push({ ...p, id: i ? next++ : q.id }));
  }
  if (!hit) return refuse('edit-no-wall', { id: 0 });
  return deleted(l, w, d, lim, before, out);
}

/**
 * Snap an end at coordinate c of a wall on line `pos` along axis `axis` to what is near (within snap mm): the line of
 * a perpendicular wall (a T; outer walls and the lines of open sides, extra, too), or the free end of one (a corner;
 * that wall's end is moved onto this line), otherwise in line with a node (marks). Returns the coordinate and the
 * walls with a corner partner's end moved.
 */
function snapEnd(m: Model, walls: Wall[], extra: Wall[], self: number, axis: Axis, pos: number, c: number, snap: number, marks: number[] = []): { c: number; walls: Wall[] } {
  let best: { q: Wall; dist: number } | null = null;
  for (const q of [...walls, ...extra]) {
    if (q.id === self || q.axis === axis) continue;
    const dist = Math.abs(q.pos - c);
    if (dist <= snap && q.from - snap <= pos && pos <= q.to + snap && (!best || dist < best.dist)) best = { q, dist };
  }
  if (!best) {
    // In line with a node (a free end of another wall, a corner): magnetic snap (#451)
    const k = marks.reduce<number | null>((b, v) => (Math.abs(v - c) <= snap && (b === null || Math.abs(v - c) < Math.abs(b - c)) ? v : b), null);
    return { c: k ?? c, walls };
  }
  const q = best.q;
  // Nahe am freien Ende der anderen Wand: Ecke, deren Ende kommt auf diese Linie
  const it = m.walls.find((z) => z.wall.id === q.id);
  if (it?.start.kind === 'free' && Math.abs(q.from - pos) <= snap) return { c: q.pos, walls: walls.map((r) => (r.id === q.id ? { ...r, from: pos } : r)) };
  if (it?.end.kind === 'free' && Math.abs(q.to - pos) <= snap) return { c: q.pos, walls: walls.map((r) => (r.id === q.id ? { ...r, to: pos } : r)) };
  return { c: q.pos, walls };
}

/** Move one end of wall id along its line to c (snapped within snap mm). Joints may appear or go; refused with a new error */
export function stretchEnd(l: Layout, w: number, d: number, lim: Limits, id: number, which: 'from' | 'to', c: number, snap: number): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  const before = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const marks = nodes(before, id).map((p) => (x.axis === 'h' ? p[0] : p[1]));
  const s = snapEnd(before, walls, openWalls(walls, l.sides, w, d, lim.t), id, x.axis, x.pos, c, snap, marks);
  const other = which === 'from' ? x.to : x.from;
  if (Math.abs(s.c - other) < lim.minLen) return refuse('wall-short', { id, min: lim.minLen });
  const next = s.walls.map((q) => (q.id === id ? { ...q, from: Math.min(s.c, other), to: Math.max(s.c, other) } : q));
  const on = onAnother(next, id);
  if (on) return refuse('move-onto', { id, id2: on.id });
  return accept(before, l, next, w, d, lim);
}

/** How far from the pointer a drag looks for a place where the wall or end may go (mm) */
const reachOf = (lim: Limits, snap: number) => 4 * lim.t + lim.gap + snap;

/** Stretch an end as near to c as it may go (for dragging): the nearest whole millimetre where it is accepted */
export function stretchEndNear(l: Layout, w: number, d: number, lim: Limits, id: number, which: 'from' | 'to', c: number, snap: number): EditResult {
  const r = stretchEnd(l, w, d, lim, id, which, c, snap);
  if (r.ok) return r;
  const r0 = Math.round(c);
  for (let k = 1; k <= reachOf(lim, snap); k++)
    for (const cc of [r0 - k, r0 + k]) {
      const q = stretchEnd(l, w, d, lim, id, which, cc, snap);
      if (q.ok) return q;
    }
  return r;
}

/** Add a wall (both ends snapped within snap mm); it gets the next free id */
export function addWall(l: Layout, w: number, d: number, lim: Limits, axis: Axis, pos: number, from: number, to: number, snap: number): EditResult {
  let walls = current(l, w, d);
  const before = modelFor(withWalls(l, w, d, walls), w, d, lim);
  const id = walls.reduce((m, q) => Math.max(m, q.id), 0) + 1;
  const extra = openWalls(walls, l.sides, w, d, lim.t);
  const marks = nodes(before).map((p) => (axis === 'h' ? p[0] : p[1]));
  const a = snapEnd(before, walls, extra, id, axis, pos, Math.min(from, to), snap, marks);
  walls = a.walls;
  const b = snapEnd(before, walls, extra, id, axis, pos, Math.max(from, to), snap, marks);
  walls = b.walls;
  if (Math.abs(b.c - a.c) < lim.minLen) return refuse('wall-short', { id, min: lim.minLen });
  const next = [...walls, { id, axis, pos, from: Math.min(a.c, b.c), to: Math.max(a.c, b.c) }];
  // Auf eine vorhandene Wand gelegt: sie wäre mit ihr verschmolzen (oder läge auf einer offenen)
  if (onAnother(next, id)) return refuse('add-on-wall', { id });
  const r = accept(before, l, next, w, d, lim);
  if (r.ok && r.layout.walls.length !== next.length) return refuse('add-on-wall', { id });
  return r;
}

/**
 * The walls of a box whose inner size changes from ow × od to nw × nd, keeping their distances in mm from the left and
 * back walls; the right and front outer walls and what ends on them move with them
 */
export function keepWalls(walls: Wall[], ow: number, od: number, nw: number, nd: number): Wall[] {
  const fx = (v: number) => (v > ow - EPS ? v + nw - ow : v),
    fy = (v: number) => (v > od - EPS ? v + nd - od : v);
  return walls.map((x) => (x.axis === 'h' ? { ...x, pos: fy(x.pos), from: fx(x.from), to: fx(x.to) } : { ...x, pos: fx(x.pos), from: fy(x.from), to: fy(x.to) }));
}

/** Delete wall id; walls that ended on it get a free end there. An outer wall is left open, an open one closed (#451) */
export function deleteWall(l: Layout, w: number, d: number, lim: Limits, id: number): EditResult {
  const walls = current(l, w, d);
  const x = walls.find((q) => q.id === id);
  if (!x) return refuse('edit-no-wall', { id });
  return deleteRuns(l, w, d, lim, x.axis, x.pos, [[x.from, x.to]]);
}

/** Wall q with its coordinates moved by (dx, dy) */
export const shiftWall = (q: Wall, dx: number, dy: number): Wall => (q.axis === 'h' ? { ...q, pos: q.pos + dy, from: q.from + dx, to: q.to + dx } : { ...q, pos: q.pos + dx, from: q.from + dy, to: q.to + dy });

/**
 * The layout in its own inner size (#451): an edit of the outer walls may have moved the box in the coordinates of the
 * inner size w × d it was made in; the walls move so that the outer walls of the box lie at −t/2 again, and the inner
 * size is the box's. null when the walls enclose no box.
 */
export function settle(l: Layout, w: number, d: number, lim: Limits): { layout: Layout; size: [number, number]; shift: [number, number]; sides: Record<Side, boolean> } | null {
  const m = modelFor(l, w, d, lim);
  if (!m.box) return null;
  const [sx, sy] = m.box.shift;
  return { layout: { ...l, ref: m.box.size, walls: current(l, w, d).map((q) => shiftWall(q, sx, sy)) }, size: m.box.size, shift: [sx, sy], sides: m.box.sides };
}
