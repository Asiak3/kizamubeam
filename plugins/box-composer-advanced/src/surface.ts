// Plan editor of the box composer (#385): the inner walls seen from above on the dialog's drawing surface. A click on a
// wall selects the stretch under the pointer (the piece between its ends and joints; Shift adds or removes stretches
// of any wall, a double click or Ctrl+Shift+click selects the whole wall), dragging moves the selection (a stretch is
// cut out of its wall; stretches of several lines move together, each across its line), Ctrl shows a target on the wall at the pointer where a new wall starts (click:
// across the compartment, drag: drawn) and in an empty space a cross for a free wall (drag: drawn), dragging an end
// point makes a wall longer or shorter, a double click in a compartment adds a wall across it, Delete removes the
// selection and a right click the stretch under the pointer. Every edit goes through edit.ts: a dragged wall or end
// goes to the nearest place where it may stand (it jumps over others and lines up with a wall it can be joined with),
// anything else that would bring a new error is refused with a message. The measures of the selected wall are shown
// as a line of text under the plan (the plan's own texts are small) and as fields beside the preview (newer apps, #411):
// a typed clear space moves the selection, a typed length the free end. While dragging, the walls live in the surface
// state; the parameters change only on release, so each edit is one change of the dialog.
//
// Surface coordinates are the inner rectangle of the box (mm): x to the right from the inside of the left wall, y to
// the front from the inside of the back wall (the back is at the top).
//
// The outer walls are walls like the others (#451): selected, dragged (the whole wall or a stretch), measured and
// deleted the same way. Moved, they give the box another shape (a corner cut away, a U or C notch) or size; on release
// the walls are moved into the box's own inner size and the width and depth follow (settle in edit.ts). An outer wall
// of the rectangle deleted as a whole opens that side.
import { mm, type Drawing, type EventResult, type Item, type Pointer, type Surface, type Text } from '../../sdk/ts';
import { addWall, boxCentre, current, deleteRuns, deleteWall, joinRuns, lineUp, modelFor, moveGroups, moveGroupsNear, moveRuns, moveRunsNear, moveWall, neighbours, nodes, settle, stretchEnd, stretchEndNear, stretchOf, wallCentre, wholeWall, type EditResult, type Group, type Run } from './edit';
import { where } from './outline';
import { openWalls, writeLayout, type Axis, type End, type Layout, type Limits, type Model, type Side, type Wall } from './model';

/** What the plan needs: inner size, thickness, limits, the stored layout and which outer walls there are */
export interface Plan {
  w: number;
  d: number;
  t: number;
  lim: Limits;
  layout: Layout;
  sides: Record<Side, boolean>;
}

const LIST = 'walls';

/**
 * Selected stretches: pieces (from, to along) of the walls on one line, the line under the pointer (measures, target);
 * with Shift also those of other lines (more), moved and deleted together
 */
interface Sel extends Group {
  more?: Group[];
}
/** Where a new wall starts (Ctrl): the stretches it starts from, along their line, and the side the pointer is on */
interface Aim {
  sel: Sel;
  along: number;
  side: -1 | 1;
}
interface Drag {
  kind: 'move' | 'end' | 'draw';
  id: number;
  /** move: the stretches being moved, where they were; draw from the target: the selection */
  sel?: Sel;
  /** draw from the target (Ctrl): the target and the direction of the new wall */
  aim?: Aim;
  axis?: Axis;
  which?: 'from' | 'to';
  /** The walls when the drag started (inner size, merged) */
  base: Wall[];
  x0: number;
  y0: number;
}
interface State {
  /** The walls as they are while dragging (the last accepted edit) */
  walls?: Wall[];
  drag?: Drag;
  /** A wall being drawn that is not accepted (yet): x0, y0, x1, y1 */
  draft?: [number, number, number, number];
  /** Where on wall id the pointer took it: its measures are taken there (the space at the pointer) */
  at?: { id: number; along: number };
  /** Selected stretches; without them the wall selected in the list is selected as a whole */
  sel?: Sel;
  /** The target shown while Ctrl is held near a wall */
  aim?: Aim;
  /** Ctrl in an empty space: where a free wall would start */
  free?: [number, number];
}

const stateOf = (s: unknown): State => (s && typeof s === 'object' ? (s as State) : {});
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100 + 1e-9) / 100;
/** Ends snap to walls within this distance (mm) */
const snapOf = (p: Plan) => 2 * p.t;

const onLine = (q: Wall, s: Group) => q.axis === s.axis && Math.abs(q.pos - s.pos) < 0.01;
/** The lines of the selection, the one under the pointer first */
const groupsOf = (s: Sel): Group[] => [{ axis: s.axis, pos: s.pos, runs: s.runs }, ...(s.more ?? [])];
/** The selection from its lines (the first one is the line under the pointer) */
const selOf = (gs: Group[]): Sel => ({ ...gs[0], ...(gs.length > 1 ? { more: gs.slice(1) } : {}) });
/** The selected stretches on the line of wall q */
const runsFor = (s: Sel, q: Wall): Run[] => groupsOf(s).find((g) => onLine(q, g))?.runs ?? [];
/** Does wall q hold a piece of the selection? */
const touches = (q: Wall, s: Sel) => runsFor(s, q).some(([a, b]) => Math.min(b, q.to) - Math.max(a, q.from) > 0.01);
/** The selected stretches: those of the state while they still lie on a wall, otherwise the whole wall id */
function selection(st: State, walls: Wall[], id: number | undefined): Sel | undefined {
  const s = st.sel;
  if (s && walls.some((q) => touches(q, s))) return s;
  const x = walls.find((q) => q.id === id);
  return x && whole(x);
}
const whole = (x: Wall): Sel => ({ axis: x.axis, pos: x.pos, runs: [[x.from, x.to]] });
/** The wall of the line of s that holds `along` */
const wallAt = (walls: Wall[], s: Sel, along: number) => walls.find((q) => onLine(q, s) && q.from <= along + 0.01 && q.to >= along - 0.01);
/** Is run b inside the runs a? */
const covers = (a: Run[], b: Run) => a.some(([p, q]) => p <= b[0] + 0.01 && q >= b[1] - 0.01);
/** The runs a without run b */
const without = (a: Run[], b: Run): Run[] =>
  a.flatMap(([p, q]): Run[] => (q <= b[0] + 0.01 || p >= b[1] - 0.01 ? [[p, q]] : ([[p, b[0]], [b[1], q]] as Run[]).filter(([u, v]) => v - u > 0.01)));

/**
 * The target for a new wall on the selection: the pointer brought onto the nearest selected stretch, snapped to its
 * middle (within snap) or to whole millimetres, and the side of the line the pointer is on
 */
function aimAt(p: Plan, sel: Sel, x: number, y: number): Aim | null {
  const [along, across] = sel.axis === 'h' ? [x, y] : [y, x];
  let best: Run | null = null,
    dist = Infinity;
  for (const r of sel.runs) {
    const dd = Math.abs(Math.min(r[1], Math.max(r[0], along)) - along);
    if (dd < dist) (dist = dd), (best = r);
  }
  if (!best) return null;
  const mid = (best[0] + best[1]) / 2;
  const a = Math.min(best[1], Math.max(best[0], along));
  const snapped = Math.abs(a - mid) <= snapOf(p) ? mid : Math.min(best[1], Math.max(best[0], Math.round(a)));
  // (only the line of the target: a new wall starts from one line)
  return { sel: { axis: sel.axis, pos: sel.pos, runs: sel.runs }, along: r2(snapped), side: across >= sel.pos ? 1 : -1 };
}
/** The target for Ctrl at (x, y): on the wall near the pointer (its stretch there is preselected; a selected stretch
 * keeps the selection), or none */
function aimFor(p: Plan, walls: Wall[], sel: Sel | undefined, x: number, y: number): Aim | null {
  let best: Wall | null = null,
    dist = 3 * p.t;
  for (const q of walls) {
    const [a, c] = q.axis === 'h' ? [x, y] : [y, x];
    const dd = Math.hypot(Math.min(q.to, Math.max(q.from, a)) - a, c - q.pos);
    if (dd <= dist) (dist = dd), (best = q);
  }
  if (!best) return null;
  const along = Math.min(best.to, Math.max(best.from, best.axis === 'h' ? x : y));
  const run = stretchOf(modelOf(p, walls), best, along);
  return aimAt(p, sel && onLine(best, sel) && covers(sel.runs, run) ? sel : { axis: best.axis, pos: best.pos, runs: [run] }, x, y);
}
/** The new wall from the target: across the compartment on the side of the pointer, from the selection to the next wall */
function newAcross(p: Plan, walls: Wall[], sel: Sel, aim: Aim): { axis: Axis; pos: number; from: number; to: number } {
  const axis: Axis = sel.axis === 'h' ? 'v' : 'h';
  const off = sel.pos + aim.side * p.t;
  const a = sel.axis === 'h' ? acrossAt(p, walls, axis, aim.along, off) : acrossAt(p, walls, axis, off, aim.along);
  return { axis, pos: aim.along, from: a.from, to: a.to };
}

/**
 * The wall a double click at (x, y) adds: across the compartment, from wall to wall, in its middle when the pointer is
 * within snap of it (for even divisions), otherwise at the pointer (whole millimetres)
 */
function splitAt(p: Plan, walls: Wall[], axis: Axis, x: number, y: number): EditResult {
  const [pos, along] = axis === 'v' ? [x, y] : [y, x];
  const n = neighbours(walls, { id: -1, axis, pos, from: along, to: along }, p.w, p.d, p.t, along, p.sides);
  const mid = r2((n.lo + n.hi) / 2);
  const at = Math.abs(mid - pos) <= snapOf(p) ? mid : Math.round(pos);
  const a = axis === 'v' ? acrossAt(p, walls, 'v', at, y) : acrossAt(p, walls, 'h', x, at);
  return addWall(layoutWith(p, walls), p.w, p.d, p.lim, axis, at, a.from, a.to, snapOf(p));
}

/** The plan's layout with other walls, and their model */
const layoutWith = (p: Plan, walls: Wall[]): Layout => ({ ...p.layout, ref: [p.w, p.d], walls });
const modelOf = (p: Plan, walls: Wall[]) => modelFor(layoutWith(p, walls), p.w, p.d, p.lim);

/** Id of the wall in row `row` of the stored list */
const idAt = (p: Plan, row: number | undefined) => (row !== undefined && row >= 0 ? p.layout.walls[row]?.id : undefined);
/** The wall selected in the list (its id), if any */
export const selectedId = (p: Plan, s: Surface) => idAt(p, s.selected[LIST]);

/** A rectangle as a closed line */
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [r1(x0), r1(y0)],
  [r1(x1), r1(y0)],
  [r1(x1), r1(y1)],
  [r1(x0), r1(y1)],
];
/** A point on the plan from (along, across) of a wall on axis a */
const at = (a: Axis, along: number, across: number): [number, number] => (a === 'h' ? [r1(along), r1(across)] : [r1(across), r1(along)]);

// ---- Drawing ----

/** The open sides of the rectangle (no outer wall): the line where the box ends there, dashed */
function openItems(p: Plan, walls: Wall[]): Item[] {
  return openWalls(walls, p.sides, p.w, p.d, p.t).map((q): Item => ({ type: 'line', pts: [at(q.axis, q.from, q.pos), at(q.axis, q.to, q.pos)], style: 'muted', width: 1, dash: true }));
}

/** How far the drawn wall reaches past (+) or stops before (−) its end point: to the face of a T host, over a corner */
const endExtra = (e: End, t: number) => (e.kind === 'tee' ? -t / 2 : e.kind === 'corner' ? t / 2 : 0);

/** Clear space on both sides of a wall (mm) at `along` on it: to the nearest parallel wall (outer walls too) or (open
 * side) the edge of the floor; infinite where there is none (outside an outer wall) */
function clear(p: Plan, walls: Wall[], x: Wall, along: number): { a: number; b: number; lo: number; hi: number } {
  const { lo, hi } = neighbours(walls, x, p.w, p.d, p.t, along, p.sides);
  return { a: x.pos - lo - p.t, b: hi - x.pos - p.t, lo, hi };
}
const centred = (c: { a: number; b: number }) => Math.abs(c.a - c.b) < 0.005;
/** Does wall x stand in the middle of the whole box (outer size, the same with or without outer walls)? */
const boxCentred = (m: Model, x: Wall) => {
  const c = boxCentre(m);
  return !!c && Math.abs(x.pos - (x.axis === 'h' ? c[1] : c[0])) < 0.005;
};
/** Where the measures of wall x are taken: where the pointer took it, otherwise its middle */
const alongOf = (st: State, x: Wall) => (st.at && st.at.id === x.id ? Math.min(x.to, Math.max(x.from, st.at.along)) : (x.from + x.to) / 2);
/** The middle of the stretch of wall x (between its ends and joints) that holds `along`: where its measures are drawn */
function stretchMid(m: Model, x: Wall, along: number): number {
  const it = m.walls.find((q) => q.wall.id === x.id);
  const marks = [x.from, x.to, ...(it ? [...it.tees.map((q) => q.at), ...it.crosses.map((c) => c.at)] : [])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < marks.length; i++) if (along >= marks[i] && along <= marks[i + 1]) return (marks[i] + marks[i + 1]) / 2;
  return along;
}

/** The selected stretch of wall x at `along` (the nearest one), cut to the wall; the whole wall without a selection */
function runOn(sel: Sel | undefined, x: Wall, along: number): Run {
  let best: Run = [x.from, x.to],
    dist = Infinity;
  if (sel && onLine(x, sel))
    for (const [a0, b0] of sel.runs) {
      const a = Math.max(a0, x.from),
        b = Math.min(b0, x.to);
      if (b - a < 0.01) continue;
      const dd = Math.abs(Math.min(b, Math.max(a, along)) - along);
      if (dd < dist) (dist = dd), (best = [a, b]);
    }
  return best;
}

/** The end of wall x a typed length of its stretch `run` moves: a free end of the wall that the stretch reaches (the
 * end when both are free); null when the stretch is joined at both ends */
function lengthEnd(m: Model, x: Wall, run: Run): 'from' | 'to' | null {
  const it = m.walls.find((q) => q.wall.id === x.id);
  if (run[1] >= x.to - 0.01 && (!it || it.end.kind === 'free')) return 'to';
  return run[0] <= x.from + 0.01 && it?.start.kind === 'free' ? 'from' : null;
}

/** The measures of the selected wall as fields beside the preview (#411): clear space on both sides where they are
 * taken, and the length of the selected stretch there (only when it reaches a free end) */
function wallFields(p: Plan, walls: Wall[], m: Model, x: Wall, along: number, run: Run): NonNullable<Drawing['fields']> {
  const c = clear(p, walls, x, along);
  const free = lengthEnd(m, x, run);
  // (an outer wall: only the side towards the inside)
  return [
    ...(Number.isFinite(c.a) ? [{ id: 'a', label: { code: `field.${x.axis}.a` }, value: r2(c.a), min: 0 }] : []),
    ...(Number.isFinite(c.b) ? [{ id: 'b', label: { code: `field.${x.axis}.b` }, value: r2(c.b), min: 0 }] : []),
    { id: 'len', label: { code: 'field.len' }, value: r2(run[1] - run[0]), min: 0, ...(free ? {} : { readonly: true, title: { code: 'field.len.joined' } }) },
  ];
}

/** The wall whose middle wall x stands on (nearest to `along` among those it ends on or crosses), if it does */
function onCentre(m: Model, x: Wall, along: number): { id: number; at: number } | null {
  const c = wallCentre(m, x, along);
  return c && Math.abs(c.at - x.pos) < 0.005 ? c : null;
}

export function planDraw(p: Plan, s: Surface & { have: string[]; size?: { width: number; height: number } }): Drawing {
  const { w, d, t } = p;
  const st = stateOf(s.state);
  const base = current(p.layout, w, d);
  const walls = st.walls ?? base;
  const m = modelOf(p, walls);
  const bad = new Set<number>();
  for (const i of m.issues) if (i.level === 'error') for (const k of ['id', 'id2']) if (i.values?.[k] !== undefined) bad.add(i.values[k]);
  const sel =
    st.drag && st.drag.kind !== 'draw'
      ? st.walls
        ? st.drag.kind === 'move'
          ? st.at?.id
          : dragged(st.walls, st.drag)
        : st.drag.id
      : idAt(p, s.selected[LIST]);
  const pick = selection(st, walls, sel);
  const picked = (x: Wall) => (pick ? touches(x, pick) : x.id === sel);
  // The frame: the box as stored (outer faces) with a margin; not while dragging, so the plan does not jump
  const margin = 4;
  const frame = { x0: -t - margin, y0: -t - margin, x1: w + t + margin, y1: d + t + margin };
  for (const q of base) {
    const [x0, y0, x1, y1] = q.axis === 'h' ? [q.from, q.pos, q.to, q.pos] : [q.pos, q.from, q.pos, q.to];
    frame.x0 = Math.min(frame.x0, x0 - t / 2 - margin);
    frame.y0 = Math.min(frame.y0, y0 - t / 2 - margin);
    frame.x1 = Math.max(frame.x1, x1 + t / 2 + margin);
    frame.y1 = Math.max(frame.y1, y1 + t / 2 + margin);
  }

  const items: Item[] = openItems(p, walls);
  const info = new Map(m.walls.map((it) => [it.wall.id, it]));
  // The app fits the frame into the surface (its size in px from newer apps, otherwise about 560 × 480, see
  // dialogSurface.ts); with the scale, a few pixels are known in mm to place a text beside a line
  const sw = s.size?.width || 560,
    sh = s.size?.height || 480;
  const k = Math.min((0.92 * sw) / (frame.x1 - frame.x0), (0.9 * sh) / (frame.y1 - frame.y0));
  const px = (n: number) => n / k;
  // Texts centred on their point (#412); along a vertical line turned to read from bottom to top (angle 90); measures
  // on a bubble, readable over the lines they cross
  const label = (cx: number, cy: number, text: string, style: 'accent' | 'muted', angle = 0, bubble = false) =>
    items.push({ type: 'text', x: r1(cx), y: r1(cy), text, style, align: 'center', ...(angle ? { angle } : {}), ...(bubble ? { bubble } : {}) });
  const width = (text: string) => px(text.length * 6.2);
  // The selected wall last: drawn on top and hit first
  const order = [...walls].sort((a, b) => Number(a.id === sel) - Number(b.id === sel));
  for (const x of order) {
    const it = info.get(x.id);
    // A wall with selected stretches: the whole wall pale, the stretches strong (below)
    const style = picked(x) || x.id === sel ? 'accent' : bad.has(x.id) ? 'warn' : 'normal';
    const pale = picked(x) && runsFor(pick!, x).some(([a, b]) => a > x.from + 0.01 || b < x.to - 0.01);
    const a0 = x.from - (it ? endExtra(it.start, t) : 0),
      a1 = x.to + (it ? endExtra(it.end, t) : 0);
    const [p0, p1] = [at(x.axis, a0, x.pos - t / 2), at(x.axis, a1, x.pos + t / 2)];
    // An outer wall left open: dashed (the box is open there)
    items.push({ type: 'line', pts: rect(p0[0], p0[1], p1[0], p1[1]), closed: true, style: x.open && style === 'normal' ? 'muted' : style, width: style === 'accent' ? 2 : 1.2, id: `w${x.id}`, ...(pale ? { alpha: 0.45 } : {}), ...(x.open ? { dash: true } : {}) });
    items.push({ type: 'line', pts: [at(x.axis, x.from, x.pos), at(x.axis, x.to, x.pos)], style, width: 1, alpha: 0.35, id: `w${x.id}` });
    const [hx, hy] = at(x.axis, x.from, x.pos),
      [ex, ey] = at(x.axis, x.to, x.pos);
    items.push({ type: 'handle', x: hx, y: hy, id: `e${x.id}.from`, style, size: x.id === sel ? 4 : 3 });
    items.push({ type: 'handle', x: ex, y: ey, id: `e${x.id}.to`, style, size: x.id === sel ? 4 : 3 });
  }
  // The selected stretches: strong over their wall, a grip in the middle of each
  if (pick)
    for (const x of walls.filter((q) => touches(q, pick)))
      for (const [a0, b0] of runsFor(pick, x)) {
        const a = Math.max(a0, x.from),
          b = Math.min(b0, x.to);
        if (b - a < 0.01) continue;
        const [p0, p1] = [at(x.axis, a, x.pos - t / 2 - 0.4), at(x.axis, b, x.pos + t / 2 + 0.4)];
        items.push({ type: 'line', pts: rect(p0[0], p0[1], p1[0], p1[1]), closed: true, style: 'accent', width: 2.5, id: `w${x.id}` });
        const [mx, my] = at(x.axis, (a + b) / 2, x.pos);
        items.push({ type: 'handle', x: mx, y: my, id: `w${x.id}`, style: 'accent', size: 5 });
      }
  // Numbers of the walls (as in the list and the part names) in the middle of their length, above or right of the wall;
  // the selected wall's number moves away from its dimension lines
  const selX = walls.find((q) => q.id === sel);
  const dimAt = selX ? stretchMid(m, selX, alongOf(st, selX)) : NaN;
  // (the texts of the dimension lines lie just before dimAt along the wall)
  const aside = (x: Wall, a: number) => (x.id === sel && Math.abs(a - dimAt) < px(24) ? dimAt + (dimAt - x.from > x.to - dimAt ? -px(24) : px(18)) : a);
  for (const x of walls) {
    const text = String(x.id);
    const a = aside(x, (x.from + x.to) / 2);
    const [cx, cy] = x.axis === 'h' ? [a, x.pos - t / 2 - px(8)] : [x.pos + t / 2 + width(text) / 2 + px(4), a];
    label(cx, cy, text, x.id === sel ? 'accent' : 'muted');
  }
  // Joints: T joints and crossings as small marks
  for (const it of m.walls)
    for (const j of [...it.tees.map((q) => q.at), ...it.crosses.map((c) => c.at)]) {
      const [jx, jy] = at(it.wall.axis, j, it.wall.pos);
      const r = t * 0.9;
      items.push({ type: 'line', closed: true, style: 'accent', alpha: 0.6, width: 1, pts: [[jx - r, jy], [jx, jy - r], [jx + r, jy], [jx, jy + r]] });
    }
  // The selected wall: clear space on both sides as dimension lines with their numbers, the length of the selected
  // stretch, a mark when it stands in the middle
  const x = selX;
  if (x) {
    // Dimension lines in the middle of the stretch the pointer holds (not on a joint), each text centred before its
    // line, turned with a vertical line
    const mid = dimAt;
    const c = clear(p, walls, x, mid);
    for (const [a, b] of [[c.lo + t / 2, x.pos - t / 2], [x.pos + t / 2, c.hi - t / 2]]) {
      // (an outer wall: no wall outside)
      if (!(b - a >= 0.05) || !Number.isFinite(b - a)) continue;
      items.push({ type: 'line', pts: [at(x.axis, mid, a), at(x.axis, mid, b)], style: 'accent', dash: true, width: 1 });
      for (const e of [a, b]) items.push({ type: 'line', pts: [at(x.axis, mid - 1.5, e), at(x.axis, mid + 1.5, e)], style: 'accent', width: 1 });
      const text = `${mm(r2(b - a))} mm`;
      if (x.axis === 'h') label(mid - px(9), (a + b) / 2, text, 'accent', 90, true);
      else label((a + b) / 2, mid - px(9), text, 'accent', 0, true);
    }
    // Length of the selected stretch on the other side of the wall than its number, along the wall, centred on the
    // stretch (its bubble covers the dimension line there)
    const run = runOn(pick, x, mid);
    const len = `↔ ${mm(r2(run[1] - run[0]))} mm`;
    const la = (run[0] + run[1]) / 2;
    // (its bubble is 15 px high: about 6 px clear of the wall)
    if (x.axis === 'h') label(la, x.pos + t / 2 + px(14), len, 'accent', 0, true);
    else label(x.pos - t / 2 - px(14), la, len, 'accent', 90, true);
    // Lined up with a wall in the same direction: a guide between them
    const q = walls.find((z) => z.id === lineUp(walls, x));
    if (q) {
      const [e0, e1] = q.from > x.to ? [x.to, q.from] : [q.to, x.from];
      items.push({ type: 'line', pts: [at(x.axis, e0, x.pos), at(x.axis, e1, x.pos)], style: 'accent', dash: true, width: 1, alpha: 0.7 });
    }
    // In the middle of the whole box: a guide on its line from outer edge to outer edge, with a mark at both edges
    const bc = m.box && boxCentred(m, x) ? m.box.pts : null;
    if (bc) {
      const vs = bc.map((q) => (x.axis === 'h' ? q[0] : q[1]));
      const [e0, e1] = [Math.min(...vs) - t / 2, Math.max(...vs) + t / 2];
      items.push({ type: 'line', pts: [at(x.axis, e0, x.pos), at(x.axis, e1, x.pos)], style: 'accent', dash: true, width: 1, alpha: 0.5 });
      for (const e of [e0, e1]) items.push({ type: 'line', pts: [at(x.axis, e, x.pos - 2 * t), at(x.axis, e, x.pos + 2 * t)], style: 'accent', width: 1.5 });
    }
    // In the middle of the space: a square on the wall; in the middle of a wall it ends on or crosses: one there
    const r = t * 1.2;
    const square = (a: Axis, along: number, across: number) => {
      const [mx, my] = at(a, along, across);
      items.push({ type: 'line', closed: true, style: 'accent', width: 1.5, pts: [[mx - r, my - r], [mx + r, my - r], [mx + r, my + r], [mx - r, my + r]] });
    };
    if (centred(c)) square(x.axis, mid, x.pos);
    const on = onCentre(m, x, mid);
    const host = on && walls.find((q) => q.id === on.id);
    if (host) square(x.axis, host.pos, x.pos);
  }
  // Magnetic snap (#451): guides to the nodes (free ends of other walls, corners) the selected wall lines up with: from
  // its free ends to the nodes in line with them across, and from its nearer end to the nodes on its own line beyond
  // its ends (a wall in that line has the guide of walls that line up, above)
  {
    const it = selX && info.get(selX.id);
    if (selX && it) {
      const ns = nodes(m, selX.id);
      const guide = (a: [number, number], nx: number, ny: number) => items.push({ type: 'line', pts: [a, [r1(nx), r1(ny)]], style: 'accent', dash: true, width: 1, alpha: 0.6 });
      for (const [e, end] of [[selX.from, it.start], [selX.to, it.end]] as const) {
        if (end.kind !== 'free') continue;
        for (const [nx, ny] of ns) if (Math.abs((selX.axis === 'h' ? nx : ny) - e) < 0.005) guide(at(selX.axis, e, selX.pos), nx, ny);
      }
      const inLine = (a: number) => walls.some((q) => q.axis === selX.axis && Math.abs(q.pos - selX.pos) < 0.005 && (Math.abs(q.from - a) < 0.005 || Math.abs(q.to - a) < 0.005));
      for (const [nx, ny] of ns) {
        const [a, c] = selX.axis === 'h' ? [nx, ny] : [ny, nx];
        if (Math.abs(c - selX.pos) >= 0.005 || (a > selX.from - 0.005 && a < selX.to + 0.005) || inLine(a)) continue;
        guide(at(selX.axis, a < selX.from ? selX.from : selX.to, selX.pos), nx, ny);
      }
    }
  }
  // The target (Ctrl): its stretches marked, a ring with a cross on them, the new wall dashed, "Start" beside it
  if (st.aim && !st.drag) {
    const g = st.aim.sel;
    for (const x of walls.filter((q) => touches(q, g)))
      for (const [a0, b0] of g.runs) {
        const a = Math.max(a0, x.from),
          b = Math.min(b0, x.to);
        if (b - a < 0.01) continue;
        const [p0, p1] = [at(x.axis, a, x.pos - t / 2 - 0.4), at(x.axis, b, x.pos + t / 2 + 0.4)];
        items.push({ type: 'line', pts: rect(p0[0], p0[1], p1[0], p1[1]), closed: true, style: 'accent', width: 2.5, alpha: 0.7 });
      }
    const n = newAcross(p, walls, g, st.aim);
    const [cx, cy] = at(g.axis, st.aim.along, g.pos);
    const r = Math.max(2 * t, px(9));
    const ring = Array.from({ length: 24 }, (_, i): [number, number] => [r1(cx + r * Math.cos((i * Math.PI) / 12)), r1(cy + r * Math.sin((i * Math.PI) / 12))]);
    items.push({ type: 'line', pts: ring, closed: true, style: 'accent', width: 1.5 });
    items.push({ type: 'line', pts: [[r1(cx - 1.6 * r), cy], [r1(cx + 1.6 * r), cy]], style: 'accent', width: 1 });
    items.push({ type: 'line', pts: [[cx, r1(cy - 1.6 * r)], [cx, r1(cy + 1.6 * r)]], style: 'accent', width: 1 });
    items.push({ type: 'line', pts: [at(n.axis, n.from, n.pos), at(n.axis, n.to, n.pos)], style: 'accent', dash: true, width: 1.5 });
    items.push({ type: 'text', x: r1(cx + r), y: r1(cy - r), text: { code: 'plan.start' }, style: 'accent' });
  }
  // Ctrl in an empty space: a small cross where a free wall would start
  if (st.free && !st.drag) {
    const [fx, fy] = st.free;
    const r = Math.max(1.5 * t, px(7));
    items.push({ type: 'line', pts: [[r1(fx - r), fy], [r1(fx + r), fy]], style: 'accent', width: 1.5 });
    items.push({ type: 'line', pts: [[fx, r1(fy - r)], [fx, r1(fy + r)]], style: 'accent', width: 1.5 });
  }
  if (st.draft) {
    const [x0, y0, x1, y1] = st.draft;
    items.push({ type: 'line', pts: [[r1(x0), r1(y0)], [r1(x1), r1(y1)]], style: 'warn', dash: true, width: 1.5 });
  }
  // The selected wall's measures as fields beside the preview, not while a new wall is drawn
  const fields = x && st.drag?.kind !== 'draw' ? wallFields(p, walls, m, x, dimAt, runOn(pick, x, dimAt)) : [];
  // The plan wants pointer moves without a button, for the target (Ctrl); Escape clears what is selected or shown and
  // otherwise closes the dialog (newer apps)
  // While Ctrl shows the target or the cross, the normal cursor everywhere (not the move cursor over walls)
  return { frame, items, track: true, escape: !!(pick || st.aim || st.free || st.drag), ...(st.aim || st.free ? { cursor: 'default' as const } : {}), fields };
}

// ---- Pointer and keys ----

const refusal = (r: Extract<EditResult, { ok: false }>): Text => ({ code: r.code, ...(r.values ? { values: r.values } : {}) });

/**
 * The measures of wall id for the line under the plan, at `along` on it (default its middle): clear space on both
 * sides, the length of the selected stretch there, and whether it stands in the middle of that space, of the whole box or of a wall it ends on or
 * crosses
 */
function measures(p: Plan, walls: Wall[], id: number | undefined, along?: number, sel?: Sel): Text | '' {
  const x = walls.find((q) => q.id === id);
  if (!x) return '';
  const a = along === undefined ? (x.from + x.to) / 2 : Math.min(x.to, Math.max(x.from, along));
  const c = clear(p, walls, x, a);
  const run = runOn(sel, x, a);
  const len = r2(run[1] - run[0]);
  // An outer wall: the clear space inside
  if (!Number.isFinite(c.a) || !Number.isFinite(c.b)) return { code: 'plan.info.o', values: { id: x.id, c: r2(Number.isFinite(c.a) ? c.a : Number.isFinite(c.b) ? c.b : 0), len } };
  const values = { id: x.id, a: r2(c.a), b: r2(c.b), len };
  const m = modelOf(p, walls);
  if (centred(c)) return { code: `plan.info.${x.axis}.c`, values };
  if (boxCentred(m, x)) return { code: `plan.info.${x.axis}.b`, values };
  const on = onCentre(m, x, a);
  if (on) return { code: `plan.info.${x.axis}.w`, values: { ...values, wall: on.id } };
  const line = lineUp(walls, x);
  return line !== null ? { code: `plan.info.${x.axis}.l`, values: { ...values, wall: line } } : { code: `plan.info.${x.axis}`, values };
}

/**
 * An accepted edit becomes the new parameters with the wall `id` selected; its measures stay where the pointer was
 * (along). Outer walls moved: the walls move into the box's own inner size and width and depth follow (#451); an
 * outer wall of the rectangle deleted: that side is open.
 */
function commit(p: Plan, edited: Wall[] | Layout, id: number | undefined, along?: number, sel?: Sel): EventResult {
  const l = Array.isArray(edited) ? layoutWith(p, edited) : edited;
  const set = settle(l, p.w, p.d, p.lim);
  const size = set ? set.size : ([p.w, p.d] as [number, number]);
  const walls = set ? set.layout.walls : l.walls;
  // Where the coordinates moved (the same for every wall)
  const [sx, sy] = set ? set.shift : [0, 0];
  const stored = writeLayout({ ref: size, walls });
  const rows = JSON.parse(stored.walls) as Wall[];
  const row = id === undefined ? -1 : rows.findIndex((q) => q.id === id);
  const x = walls.find((q) => q.id === id);
  const shift = (g: Group): Group => ({ axis: g.axis, pos: g.pos + (g.axis === 'h' ? sy : sx), runs: g.runs.map(([a, b]): Run => (g.axis === 'h' ? [a + sx, b + sx] : [a + sy, b + sy])) });
  const moved = sel && selOf(groupsOf(sel).map(shift));
  const at = x && along !== undefined ? along + (x.axis === 'h' ? sx : sy) : undefined;
  const state = id !== undefined && at !== undefined ? { at: { id, along: at }, ...(moved ? { sel: moved } : {}) } : moved ? { sel: moved } : null;
  // The sides of the box with a built wall (#451: an outer wall left open opens its side)
  const sides = set ? set.sides : (l.sides ?? p.sides);
  const patch: Record<string, string | number | boolean> = { walls: stored.walls, wallsRef: stored.wallsRef };
  if (Math.abs(size[0] - p.w) > 1e-6 || Math.abs(size[1] - p.d) > 1e-6) Object.assign(patch, { width: r2(size[0] + 2 * p.t), depth: r2(size[1] + 2 * p.t) });
  for (const [k, side] of [['wallLeft', 'x0'], ['wallRight', 'x1'], ['wallBack', 'y0'], ['wallFront', 'y1']] as const) if (sides[side] !== p.sides[side]) patch[k] = sides[side];
  const next: Plan = { ...p, w: size[0], d: size[1], sides, layout: { ref: size, walls, sides } };
  return { patch, state, message: measures(next, walls, id, at, moved), select: { [LIST]: row } };
}
const finish = (p: Plan, r: EditResult, id: number | undefined): EventResult => (r.ok ? commit(p, r.layout, id) : { state: null, message: refusal(r) });

/** The wall a double click at (x, y) adds: across the compartment, from wall to wall (or outer wall) */
function acrossAt(p: Plan, walls: Wall[], axis: Axis, x: number, y: number): { pos: number; from: number; to: number } {
  const [along, across] = axis === 'h' ? [x, y] : [y, x];
  let from = along,
    to = along;
  let lo = -Infinity,
    hi = Infinity;
  for (const q of [...walls, ...openWalls(walls, p.sides, p.w, p.d, p.t)]) {
    if (q.axis === axis || q.from > across || q.to < across) continue;
    if (q.pos <= along) lo = Math.max(lo, q.pos);
    else hi = Math.min(hi, q.pos);
  }
  if (Number.isFinite(lo)) from = lo;
  if (Number.isFinite(hi)) to = hi;
  return { pos: Math.round(across), from, to };
}

/**
 * The dragged wall among the walls after an edit: itself, or the wall of the same line it was joined with (the joined
 * wall keeps the smaller number)
 */
function dragged(walls: Wall[], g: Drag): number | undefined {
  if (walls.some((q) => q.id === g.id)) return g.id;
  const x = g.base.find((q) => q.id === g.id);
  if (!x) return undefined;
  const same = (q: Wall) => g.base.some((b) => b.id === q.id && b.pos === q.pos && b.from === q.from && b.to === q.to);
  return walls.find((q) => q.axis === x.axis && q.from <= x.from + 1e-6 && q.to >= x.to - 1e-6 && !same(q))?.id;
}

export function planPointer(p: Plan, ev: Pointer, s: Surface): EventResult | null {
  const st = stateOf(s.state);
  const base = current(p.layout, p.w, p.d);
  const layout = (walls: Wall[]): Layout => layoutWith(p, walls);
  // Is the pointer inside the box (what the walls enclose)?
  const inside = () => {
    const m = modelOf(p, base);
    return !!m.box && where(m.box.pts, ev.x, ev.y) === 'in';
  };

  if (ev.type === 'select') {
    const x = base.find((q) => q.id === idAt(p, ev.row));
    return { state: x ? { sel: whole(x) } : null, message: measures(p, base, x?.id) };
  }

  if (ev.type === 'down') {
    const end = /^e(\d+)\.(from|to)$/.exec(ev.hit ?? '');
    const wall = /^w(\d+)$/.exec(ev.hit ?? '');
    const id = Number((end ?? wall)?.[1]);
    // Ctrl: a new wall from the target (a click adds it across the compartment, a drag draws it); its stretches become
    // the selection
    if (ev.ctrl && !ev.shift) {
      const aim = aimFor(p, base, selection(st, base, idAt(p, s.selected[LIST])), ev.x, ev.y);
      if (aim) {
        const sel = aim.sel;
        const [x0, y0] = sel.axis === 'h' ? [aim.along, sel.pos] : [sel.pos, aim.along];
        const drag: Drag = { kind: 'draw', id: 0, base, x0, y0, sel, aim, axis: sel.axis === 'h' ? 'v' : 'h' };
        return { state: { drag, sel, aim } };
      }
      // In an empty space: a free wall, drawn from here
      if (!ev.hit && inside()) return { state: { drag: { kind: 'draw', id: 0, base, x0: Math.round(ev.x), y0: Math.round(ev.y) } } };
    }
    const x = base.find((q) => q.id === id);
    const row = p.layout.walls.findIndex((q) => q.id === id);
    if (end && x) {
      const drag: Drag = { kind: 'end', id, base, x0: ev.x, y0: ev.y, which: end[2] as 'from' | 'to' };
      return { state: { drag }, select: { [LIST]: row }, message: measures(p, base, id) };
    }
    if (wall && x) {
      // The stretch under the pointer: alone, added to or taken from the selection (Shift, of any wall), the whole
      // wall (Ctrl+Shift); a click on a selected stretch keeps the selection, so several are dragged together. The line
      // under the pointer comes first (its measures are shown, the drag follows it).
      const along = Math.min(x.to, Math.max(x.from, x.axis === 'h' ? ev.x : ev.y));
      const run = stretchOf(modelOf(p, base), x, along);
      const old = selection(st, base, idAt(p, s.selected[LIST]));
      const gs = old ? groupsOf(old) : [];
      const i = gs.findIndex((g) => onLine(x, g));
      const first = (k: number) => selOf([gs[k], ...gs.filter((_, j) => j !== k)]);
      let sel: Sel;
      if (ev.ctrl && ev.shift) sel = whole(x);
      else if (ev.shift && old) {
        if (i < 0) gs.push({ axis: x.axis, pos: x.pos, runs: [run] });
        else {
          const runs = covers(gs[i].runs, run) ? without(gs[i].runs, run) : joinRuns([...gs[i].runs, run]);
          if (runs.length) gs[i] = { ...gs[i], runs };
          else gs.splice(i, 1);
        }
        if (!gs.length) return { state: null, select: { [LIST]: -1 }, message: '' };
        const k = gs.findIndex((g) => onLine(x, g));
        sel = first(k < 0 ? 0 : k);
      } else sel = i >= 0 && covers(gs[i].runs, run) ? first(i) : { axis: x.axis, pos: x.pos, runs: [run] };
      const drag: Drag = { kind: 'move', id, base, x0: ev.x, y0: ev.y, sel };
      return { state: { drag, sel, at: { id, along } }, select: { [LIST]: row }, message: measures(p, base, id, along, sel) };
    }
    return { state: null, select: { [LIST]: -1 }, message: '' };
  }

  if (ev.type === 'move' && !st.drag) {
    // Pointer moves without a button (the plan asks for them): with Ctrl the target at a wall or the cross in an empty space
    const ctrl = ev.ctrl && !ev.shift;
    const aim = ctrl ? aimFor(p, base, selection(st, base, idAt(p, s.selected[LIST])), ev.x, ev.y) : null;
    const free: [number, number] | null = ctrl && !aim && inside() ? [Math.round(ev.x), Math.round(ev.y)] : null;
    if (JSON.stringify([aim, free]) === JSON.stringify([st.aim ?? null, st.free ?? null])) return null;
    const rest: State = { ...st };
    delete rest.aim;
    delete rest.free;
    const next = { ...rest, ...(aim ? { aim } : {}), ...(free ? { free } : {}) };
    return { state: Object.keys(next).length ? next : null };
  }

  if (ev.type === 'move') {
    const g = st.drag;
    if (!g) return null;
    const L = layout(g.base);
    let r: EditResult;
    if (g.kind === 'draw') {
      const dx = ev.x - g.x0,
        dy = ev.y - g.y0;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 1) return null;
      const axis: Axis = g.axis ?? (Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v');
      const [pos, a, b] = axis === 'h' ? [g.y0, g.x0, ev.x] : [g.x0, g.y0, ev.y];
      r = addWall(L, p.w, p.d, p.lim, axis, g.axis ? pos : Math.round(pos), Math.round(Math.min(a, b)), Math.round(Math.max(a, b)), snapOf(p));
      if (!r.ok) {
        const draft: [number, number, number, number] = axis === 'h' ? [g.x0, g.y0, ev.x, g.y0] : [g.x0, g.y0, g.x0, ev.y];
        return { state: { drag: g, draft }, message: refusal(r) };
      }
      return { state: { drag: g, walls: r.layout.walls }, message: '' };
    }
    const x = g.base.find((q) => q.id === g.id);
    if (!x) return null;
    if (g.kind === 'move' && g.sel) {
      // The pointer on the wall: the space there is measured and centred on (on the first line of the selection)
      const along = onLine(x, g.sel) ? Math.min(x.to, Math.max(x.from, x.axis === 'h' ? ev.x : ev.y)) : (g.sel.runs[0][0] + g.sel.runs[0][1]) / 2;
      let sel: Sel, m: EditResult;
      if (g.sel.more?.length) {
        // Stretches of several lines: moved together, each across its own line (an L gets bigger)
        const r = moveGroupsNear(L, p.w, p.d, p.lim, groupsOf(g.sel), ev.x - g.x0, ev.y - g.y0, snapOf(p), along, p.sides);
        if (!r.ok || !r.groups) return { state: st, message: r.ok ? '' : refusal(r) };
        (m = r), (sel = selOf(r.groups));
      } else {
        const to = g.sel.pos + (g.sel.axis === 'h' ? ev.y - g.y0 : ev.x - g.x0);
        const r = moveRunsNear(L, p.w, p.d, p.lim, g.sel.axis, g.sel.pos, g.sel.runs, to, snapOf(p), along, p.sides);
        if (!r.ok) return { state: st, message: refusal(r) };
        (m = r), (sel = { ...g.sel, pos: r.pos ?? to });
      }
      if (!m.ok) return null;
      const id = wallAt(m.layout.walls, sel, along)?.id;
      const at = id !== undefined ? { at: { id, along } } : {};
      return { state: { drag: g, walls: m.layout.walls, sel, ...at }, message: measures(p, m.layout.walls, id, along, sel) };
    }
    const along: number | undefined = undefined;
    r = stretchEndNear(L, p.w, p.d, p.lim, g.id, g.which!, Math.round(x.axis === 'h' ? ev.x : ev.y), snapOf(p));
    // Nowhere to go: the last accepted walls stay, the message says why
    if (!r.ok) return { state: st, message: refusal(r) };
    const id = dragged(r.layout.walls, g);
    const at = id !== undefined && along !== undefined ? { at: { id, along } } : {};
    return { state: { drag: g, walls: r.layout.walls, ...at }, message: measures(p, r.layout.walls, id, along) };
  }

  if (ev.type === 'up') {
    const g = st.drag;
    if (!g) return null;
    // A click on the target: the new wall across the compartment
    if (g.kind === 'draw' && g.sel && g.aim && !st.walls && !st.draft) {
      const n = newAcross(p, g.base, g.sel, g.aim);
      const r = addWall(layout(g.base), p.w, p.d, p.lim, n.axis, n.pos, n.from, n.to, snapOf(p));
      return finish(p, r, g.base.reduce((k, q) => Math.max(k, q.id), 0) + 1);
    }
    const keep = { ...(st.at ? { at: st.at } : {}), ...(st.sel ? { sel: st.sel } : {}) };
    if (!st.walls || JSON.stringify(st.walls) === JSON.stringify(g.base)) return { state: Object.keys(keep).length ? keep : null };
    if (g.kind === 'move' && st.at) return commit(p, st.walls, st.at.id, st.at.along, st.sel);
    const added = g.kind === 'draw' ? st.walls.find((q) => !g.base.some((b) => b.id === q.id))?.id : dragged(st.walls, g);
    return commit(p, st.walls, added, st.at && st.at.id === added ? st.at.along : undefined);
  }

  if (ev.type === 'dblclick') {
    // On a wall: the whole wall
    const hit = /^w(\d+)$/.exec(ev.hit ?? '');
    const x = hit && base.find((q) => q.id === Number(hit[1]));
    if (x) return { state: { sel: whole(x) }, select: { [LIST]: p.layout.walls.findIndex((q) => q.id === x.id) }, message: measures(p, base, x.id) };
    if (ev.hit || !inside()) return null;
    // In a compartment: a wall across it, in its middle when the pointer is near it
    const r = splitAt(p, base, ev.shift ? 'v' : 'h', ev.x, ev.y);
    return finish(p, r, base.reduce((n, q) => Math.max(n, q.id), 0) + 1);
  }

  if (ev.type === 'context') {
    // On a wall: the stretch under the pointer; on an end point: the whole wall
    const hit = /^([we])(\d+)/.exec(ev.hit ?? '');
    if (!hit) return null;
    const x = base.find((q) => q.id === Number(hit[2]));
    if (hit[1] === 'e' || !x) return finish(p, deleteWall(p.layout, p.w, p.d, p.lim, Number(hit[2])), undefined);
    const run = stretchOf(modelOf(p, base), x, x.axis === 'h' ? ev.x : ev.y);
    return finish(p, deleteRuns(p.layout, p.w, p.d, p.lim, x.axis, x.pos, [run]), undefined);
  }

  // A measure typed beside the preview (#411): the selection moves to that clear space (where the measures are taken),
  // a length moves the free end; refused like a drag that cannot go there
  if (ev.type === 'field' && ev.value !== undefined && !st.drag) {
    const x = base.find((q) => q.id === idAt(p, s.selected[LIST]));
    if (!x) return null;
    const m = modelOf(p, base);
    const mid = stretchMid(m, x, alongOf(st, x));
    if (ev.field === 'len') {
      // The length of the selected stretch: its free end moves; the stretch stays selected with its new length
      const run = runOn(selection(st, base, x.id), x, mid);
      const which = lengthEnd(m, x, run);
      if (!which) return null;
      const end = which === 'to' ? run[0] + ev.value : run[1] - ev.value;
      const r = stretchEnd(p.layout, p.w, p.d, p.lim, x.id, which, end, 0);
      if (!r.ok) return { message: refusal(r) };
      const now: Run = which === 'to' ? [run[0], end] : [end, run[1]];
      const keep = st.sel && onLine(x, st.sel) ? { ...st.sel, runs: joinRuns([...without(st.sel.runs, run), now]) } : undefined;
      return commit(p, r.layout.walls, x.id, (now[0] + now[1]) / 2, keep);
    }
    if (ev.field !== 'a' && ev.field !== 'b') return null;
    const c = clear(p, base, x, mid);
    const to = r2(ev.field === 'a' ? c.lo + p.t + ev.value : c.hi - p.t - ev.value);
    const sel = selection(st, base, x.id) ?? whole(x);
    if (sel.more?.length) {
      // Several lines: all move by as much as the first one
      const dv = to - sel.pos;
      const r = moveGroups(p.layout, p.w, p.d, p.lim, groupsOf(sel), sel.axis === 'v' ? dv : 0, sel.axis === 'h' ? dv : 0);
      if (!r.ok || !r.groups) return r.ok ? null : { message: refusal(r) };
      const moved = selOf(r.groups);
      return commit(p, r.layout.walls, wallAt(r.layout.walls, moved, mid)?.id ?? x.id, mid, moved);
    }
    const one = wholeWall(base, sel.axis, sel.pos, sel.runs);
    const r = one !== null ? moveWall(p.layout, p.w, p.d, p.lim, one, to) : moveRuns(p.layout, p.w, p.d, p.lim, sel.axis, sel.pos, sel.runs, to);
    if (!r.ok) return { message: refusal(r) };
    const moved = { ...sel, pos: to };
    const id = wallAt(r.layout.walls, moved, mid)?.id ?? x.id;
    return commit(p, r.layout.walls, id, mid, one !== null ? undefined : moved);
  }

  // Escape: the target and the selection go (the plan asks for pointer moves, so the app sends it the key)
  if (ev.type === 'key' && ev.key === 'Escape') return { state: null, select: { [LIST]: -1 }, message: '' };

  if (ev.type === 'key' && (ev.key === 'Delete' || ev.key === 'Backspace')) {
    const sel = selection(st, base, idAt(p, s.selected[LIST]));
    if (!sel) return null;
    // Line by line (outer walls are left open or closed again)
    let l = p.layout;
    for (const g of groupsOf(sel)) {
      const r = deleteRuns(l, p.w, p.d, p.lim, g.axis, g.pos, g.runs);
      if (!r.ok) return finish(p, r, undefined);
      l = r.layout;
    }
    return finish(p, { ok: true, layout: l }, undefined);
  }
  return null;
}
