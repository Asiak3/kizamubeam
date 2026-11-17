// Plan editor of the box composer (#385): the inner walls seen from above on the dialog's drawing surface. Dragging a
// wall moves it, dragging an end point makes it longer or shorter, a double click in a compartment adds a wall across
// it, Shift-drag draws one, Delete or a right click removes one. Every edit goes through edit.ts: a dragged wall or end
// goes to the nearest place where it may stand (it jumps over others and lines up with a wall it can be joined with),
// anything else that would bring a new error is refused with a message. The measures of the selected wall are shown
// as a line of text under the plan (the plan's own texts are small). While dragging, the walls live in the surface
// state; the parameters change only on release, so each edit is one change of the dialog.
//
// Surface coordinates are the inner rectangle of the box (mm): x to the right from the inside of the left wall, y to
// the front from the inside of the back wall (the back is at the top).
import { mm, type Drawing, type EventResult, type Item, type Pointer, type Surface, type Text } from '../../sdk/ts';
import { addWall, current, deleteWall, lineUp, moveWallNear, neighbours, stretchEndNear, wallCentre, type EditResult } from './edit';
import { buildModel, writeLayout, type Axis, type End, type Layout, type Limits, type Model, type Side, type Wall } from './model';

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

interface Drag {
  kind: 'move' | 'end' | 'draw';
  id: number;
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
}

const stateOf = (s: unknown): State => (s && typeof s === 'object' ? (s as State) : {});
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100 + 1e-9) / 100;
/** Ends snap to walls within this distance (mm) */
const snapOf = (p: Plan) => 2 * p.t;

/** Id of the wall in row `row` of the stored list */
const idAt = (p: Plan, row: number | undefined) => (row !== undefined && row >= 0 ? p.layout.walls[row]?.id : undefined);

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

/** The outer walls: inner and outer faces of the walls there are, open sides dashed */
function boxItems(p: Plan): Item[] {
  const { w, d, t, sides: S } = p;
  const out: Item[] = [];
  const seg = (a: [number, number], b: [number, number], dash = false) => out.push({ type: 'line', pts: [a, b], style: 'muted', width: 1, ...(dash ? { dash: true } : {}) });
  seg([0, 0], [w, 0], !S.y0);
  seg([0, d], [w, d], !S.y1);
  seg([0, 0], [0, d], !S.x0);
  seg([w, 0], [w, d], !S.x1);
  const xa = S.x0 ? -t : 0,
    xb = S.x1 ? w + t : w,
    ya = S.y0 ? -t : 0,
    yb = S.y1 ? d + t : d;
  if (S.y0) seg([xa, -t], [xb, -t]), S.x0 || seg([0, -t], [0, 0]), S.x1 || seg([w, -t], [w, 0]);
  if (S.y1) seg([xa, d + t], [xb, d + t]), S.x0 || seg([0, d], [0, d + t]), S.x1 || seg([w, d], [w, d + t]);
  if (S.x0) seg([-t, ya], [-t, yb]), S.y0 || seg([-t, 0], [0, 0]), S.y1 || seg([-t, d], [0, d]);
  if (S.x1) seg([w + t, ya], [w + t, yb]), S.y0 || seg([w, 0], [w + t, 0]), S.y1 || seg([w, d], [w + t, d]);
  return out;
}

/** How far the drawn wall reaches past (+) or stops before (−) its end point: to the face of a T host, over a corner */
const endExtra = (e: End, t: number) => (e.kind === 'tee' ? -t / 2 : e.kind === 'corner' ? t / 2 : 0);

/** Clear space on both sides of a wall (mm) at `along` on it: to the nearest parallel wall, outer wall or (open side)
 * the edge of the floor */
function clear(p: Plan, walls: Wall[], x: Wall, along: number): { a: number; b: number; lo: number; hi: number } {
  const { lo, hi } = neighbours(walls, x, p.w, p.d, p.t, along, p.sides);
  return { a: x.pos - lo - p.t, b: hi - x.pos - p.t, lo, hi };
}
const centred = (c: { a: number; b: number }) => Math.abs(c.a - c.b) < 0.005;
/** Where the measures of wall x are taken: where the pointer took it, otherwise its middle */
const alongOf = (st: State, x: Wall) => (st.at && st.at.id === x.id ? Math.min(x.to, Math.max(x.from, st.at.along)) : (x.from + x.to) / 2);
/** The middle of the stretch of wall x (between its ends and joints) that holds `along`: where its measures are drawn */
function stretchMid(m: Model, x: Wall, along: number): number {
  const it = m.walls.find((q) => q.wall.id === x.id);
  const marks = [x.from, x.to, ...(it ? [...it.tees.map((q) => q.at), ...it.crosses.map((c) => c.at)] : [])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < marks.length; i++) if (along >= marks[i] && along <= marks[i + 1]) return (marks[i] + marks[i + 1]) / 2;
  return along;
}

/** The wall whose middle wall x stands on (nearest to `along` among those it ends on or crosses), if it does */
function onCentre(m: Model, x: Wall, along: number): { id: number; at: number } | null {
  const c = wallCentre(m, x, along);
  return c && Math.abs(c.at - x.pos) < 0.005 ? c : null;
}

export function planDraw(p: Plan, s: Surface & { have: string[] }): Drawing {
  const { w, d, t } = p;
  const st = stateOf(s.state);
  const walls = st.walls ?? current(p.layout, w, d);
  const m = buildModel({ ref: [w, d], walls }, w, d, p.lim);
  const bad = new Set<number>();
  for (const i of m.issues) if (i.level === 'error') for (const k of ['id', 'id2']) if (i.values?.[k] !== undefined) bad.add(i.values[k]);
  const sel = st.drag && st.drag.kind !== 'draw' ? (st.walls ? dragged(st.walls, st.drag) : st.drag.id) : idAt(p, s.selected[LIST]);
  const margin = t + 4;
  const frame = { x0: -margin, y0: -margin, x1: w + margin, y1: d + margin };

  const key = `box|${w}|${d}|${t}|${p.sides.x0}${p.sides.x1}${p.sides.y0}${p.sides.y1}`;
  const layers = [s.have.includes(key) ? { key } : { key, items: boxItems(p) }];

  const items: Item[] = [];
  const info = new Map(m.walls.map((it) => [it.wall.id, it]));
  // The app fits the frame into the surface (about 560 × 480 px, see dialogSurface.ts) and writes a text 6 px right of
  // and 6 px above its point; with the scale estimated, a text can be centred on a point
  const k = Math.min((0.92 * 560) / (frame.x1 - frame.x0), (0.9 * 480) / (frame.y1 - frame.y0));
  const px = (n: number) => n / k;
  const label = (cx: number, cy: number, text: string, style: 'accent' | 'muted') =>
    items.push({ type: 'text', x: r1(cx - px(text.length * 3.1 + 6)), y: r1(cy + px(10)), text, style });
  const width = (text: string) => px(text.length * 6.2);
  // The selected wall last: drawn on top and hit first
  const order = [...walls].sort((a, b) => Number(a.id === sel) - Number(b.id === sel));
  for (const x of order) {
    const it = info.get(x.id);
    const style = x.id === sel ? 'accent' : bad.has(x.id) ? 'warn' : 'normal';
    const a0 = x.from - (it ? endExtra(it.start, t) : 0),
      a1 = x.to + (it ? endExtra(it.end, t) : 0);
    const [p0, p1] = [at(x.axis, a0, x.pos - t / 2), at(x.axis, a1, x.pos + t / 2)];
    items.push({ type: 'line', pts: rect(p0[0], p0[1], p1[0], p1[1]), closed: true, style, width: x.id === sel ? 2 : 1.2, id: `w${x.id}` });
    items.push({ type: 'line', pts: [at(x.axis, x.from, x.pos), at(x.axis, x.to, x.pos)], style, width: 1, alpha: 0.35, id: `w${x.id}` });
    const [hx, hy] = at(x.axis, x.from, x.pos),
      [ex, ey] = at(x.axis, x.to, x.pos);
    items.push({ type: 'handle', x: hx, y: hy, id: `e${x.id}.from`, style, size: x.id === sel ? 4 : 3 });
    items.push({ type: 'handle', x: ex, y: ey, id: `e${x.id}.to`, style, size: x.id === sel ? 4 : 3 });
  }
  // Numbers of the walls (as in the list and the part names) in the middle of their length, above or right of the wall;
  // the selected wall's number moves away from its dimension lines
  const selX = walls.find((q) => q.id === sel);
  const dimAt = selX ? stretchMid(m, selX, alongOf(st, selX)) : NaN;
  const aside = (x: Wall, a: number) => (x.id === sel && Math.abs(a - dimAt) < px(18) ? dimAt + (dimAt - x.from > x.to - dimAt ? -px(18) : px(18)) : a);
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
  // The selected wall: clear space on both sides as dimension lines with their numbers (beside the line, the app
  // writes texts above and to the right of their point), its length near its end, a mark when it stands in the middle
  const x = selX;
  if (x) {
    // Dimension lines in the middle of the stretch the pointer holds (not on a joint), texts centred beside them
    const mid = dimAt;
    const c = clear(p, walls, x, mid);
    for (const [a, b] of [[c.lo + t / 2, x.pos - t / 2], [x.pos + t / 2, c.hi - t / 2]]) {
      if (b - a < 0.05) continue;
      items.push({ type: 'line', pts: [at(x.axis, mid, a), at(x.axis, mid, b)], style: 'accent', dash: true, width: 1 });
      for (const e of [a, b]) items.push({ type: 'line', pts: [at(x.axis, mid - 1.5, e), at(x.axis, mid + 1.5, e)], style: 'accent', width: 1 });
      const text = `${mm(r2(b - a))} mm`;
      if (x.axis === 'h') label(mid + width(text) / 2 + px(6), (a + b) / 2, text, 'accent');
      else label((a + b) / 2, mid - px(9), text, 'accent');
    }
    // Length on the other side of the wall than its number
    const len = `${x.axis === 'h' ? '↔' : '↕'} ${mm(r2(x.to - x.from))} mm`;
    const la = aside(x, (x.from + x.to) / 2);
    if (x.axis === 'h') label(la, x.pos + t / 2 + px(9), len, 'accent');
    else label(x.pos - t / 2 - width(len) / 2 - px(4), la, len, 'accent');
    // Lined up with a wall in the same direction: a guide between them
    const q = walls.find((z) => z.id === lineUp(walls, x));
    if (q) {
      const [e0, e1] = q.from > x.to ? [x.to, q.from] : [q.to, x.from];
      items.push({ type: 'line', pts: [at(x.axis, e0, x.pos), at(x.axis, e1, x.pos)], style: 'accent', dash: true, width: 1, alpha: 0.7 });
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
  if (st.draft) {
    const [x0, y0, x1, y1] = st.draft;
    items.push({ type: 'line', pts: [[r1(x0), r1(y0)], [r1(x1), r1(y1)]], style: 'warn', dash: true, width: 1.5 });
  }
  return { frame, layers, items };
}

// ---- Pointer and keys ----

const refusal = (r: Extract<EditResult, { ok: false }>): Text => ({ code: r.code, ...(r.values ? { values: r.values } : {}) });

/**
 * The measures of wall id for the line under the plan, at `along` on it (default its middle): clear space on both
 * sides, its length, and whether it stands in the middle of that space or of a wall it ends on or crosses
 */
function measures(p: Plan, walls: Wall[], id: number | undefined, along?: number): Text | '' {
  const x = walls.find((q) => q.id === id);
  if (!x) return '';
  const a = along === undefined ? (x.from + x.to) / 2 : Math.min(x.to, Math.max(x.from, along));
  const c = clear(p, walls, x, a);
  const values = { id: x.id, a: r2(c.a), b: r2(c.b), len: r2(x.to - x.from) };
  if (centred(c)) return { code: `plan.info.${x.axis}.c`, values };
  const on = onCentre(buildModel({ ref: [p.w, p.d], walls }, p.w, p.d, p.lim), x, a);
  if (on) return { code: `plan.info.${x.axis}.w`, values: { ...values, wall: on.id } };
  const line = lineUp(walls, x);
  return line !== null ? { code: `plan.info.${x.axis}.l`, values: { ...values, wall: line } } : { code: `plan.info.${x.axis}`, values };
}

/** An accepted edit becomes the new parameters (in the current inner size) with the wall `id` selected; its measures
 * stay where the pointer was (along) */
function commit(p: Plan, walls: Wall[], id: number | undefined, along?: number): EventResult {
  const stored = writeLayout({ ref: [p.w, p.d], walls });
  const rows = JSON.parse(stored.walls) as Wall[];
  const row = id === undefined ? -1 : rows.findIndex((q) => q.id === id);
  const state = id !== undefined && along !== undefined ? { at: { id, along } } : null;
  return { patch: { walls: stored.walls, wallsRef: stored.wallsRef }, state, message: measures(p, walls, id, along), select: { [LIST]: row } };
}
const finish = (p: Plan, r: EditResult, id: number | undefined): EventResult => (r.ok ? commit(p, r.layout.walls, id) : { state: null, message: refusal(r) });

/** The wall a double click at (x, y) adds: across the compartment, from wall to wall (or outer wall) */
function acrossAt(p: Plan, walls: Wall[], axis: Axis, x: number, y: number): { pos: number; from: number; to: number } {
  const [along, across] = axis === 'h' ? [x, y] : [y, x];
  const len = axis === 'h' ? p.w : p.d;
  let from = 0,
    to = len;
  for (const q of walls) {
    if (q.axis === axis || q.from > across || q.to < across) continue;
    if (q.pos <= along) from = Math.max(from, q.pos);
    else to = Math.min(to, q.pos);
  }
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
  const layout = (walls: Wall[]): Layout => ({ ref: [p.w, p.d], walls });
  const inside = ev.x >= 0 && ev.x <= p.w && ev.y >= 0 && ev.y <= p.d;

  if (ev.type === 'select') return { message: measures(p, base, idAt(p, ev.row)) };

  if (ev.type === 'down') {
    const end = /^e(\d+)\.(from|to)$/.exec(ev.hit ?? '');
    const wall = /^w(\d+)$/.exec(ev.hit ?? '');
    const id = Number((end ?? wall)?.[1]);
    if (end || wall) {
      const row = p.layout.walls.findIndex((q) => q.id === id);
      const drag: Drag = { kind: end ? 'end' : 'move', id, base, x0: ev.x, y0: ev.y, ...(end ? { which: end[2] as 'from' | 'to' } : {}) };
      const x = base.find((q) => q.id === id);
      const along = x && !end ? (x.axis === 'h' ? ev.x : ev.y) : undefined;
      return { state: { drag, ...(along !== undefined ? { at: { id, along } } : {}) }, select: { [LIST]: row }, message: measures(p, base, id, along) };
    }
    if (ev.shift && inside) return { state: { drag: { kind: 'draw', id: 0, base, x0: ev.x, y0: ev.y } } };
    return { state: null, select: { [LIST]: -1 }, message: '' };
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
      const axis: Axis = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      const [pos, a, b] = axis === 'h' ? [g.y0, g.x0, ev.x] : [g.x0, g.y0, ev.y];
      r = addWall(L, p.w, p.d, p.lim, axis, Math.round(pos), Math.round(Math.min(a, b)), Math.round(Math.max(a, b)), snapOf(p));
      if (!r.ok) {
        const draft: [number, number, number, number] = axis === 'h' ? [g.x0, g.y0, ev.x, g.y0] : [g.x0, g.y0, g.x0, ev.y];
        return { state: { drag: g, draft }, message: refusal(r) };
      }
      return { state: { drag: g, walls: r.layout.walls }, message: '' };
    }
    const x = g.base.find((q) => q.id === g.id);
    if (!x) return null;
    // The pointer on the wall: the space there is measured and centred on
    const along = g.kind === 'move' ? Math.min(x.to, Math.max(x.from, x.axis === 'h' ? ev.x : ev.y)) : undefined;
    if (g.kind === 'move') r = moveWallNear(L, p.w, p.d, p.lim, g.id, x.pos + (x.axis === 'h' ? ev.y - g.y0 : ev.x - g.x0), snapOf(p), along, p.sides);
    else r = stretchEndNear(L, p.w, p.d, p.lim, g.id, g.which!, Math.round(x.axis === 'h' ? ev.x : ev.y), snapOf(p));
    // Nowhere to go: the last accepted walls stay, the message says why
    if (!r.ok) return { state: st, message: refusal(r) };
    const id = dragged(r.layout.walls, g);
    const at = id !== undefined && along !== undefined ? { at: { id, along } } : {};
    return { state: { drag: g, walls: r.layout.walls, ...at }, message: measures(p, r.layout.walls, id, along) };
  }

  if (ev.type === 'up') {
    const g = st.drag;
    if (!g) return null;
    if (!st.walls || JSON.stringify(st.walls) === JSON.stringify(g.base)) return { state: st.at ? { at: st.at } : null };
    const added = g.kind === 'draw' ? st.walls.find((q) => !g.base.some((b) => b.id === q.id))?.id : dragged(st.walls, g);
    return commit(p, st.walls, added, st.at && st.at.id === added ? st.at.along : undefined);
  }

  if (ev.type === 'dblclick') {
    if (ev.hit || !inside) return null;
    const axis: Axis = ev.shift ? 'v' : 'h';
    const a = acrossAt(p, base, axis, ev.x, ev.y);
    const r = addWall(layout(base), p.w, p.d, p.lim, axis, a.pos, a.from, a.to, snapOf(p));
    const id = base.reduce((n, q) => Math.max(n, q.id), 0) + 1;
    return finish(p, r, id);
  }

  if (ev.type === 'context') {
    const hit = /^[we](\d+)/.exec(ev.hit ?? '');
    if (!hit) return null;
    return finish(p, deleteWall(p.layout, p.w, p.d, Number(hit[1])), undefined);
  }

  if (ev.type === 'key' && (ev.key === 'Delete' || ev.key === 'Backspace')) {
    const id = idAt(p, s.selected[LIST]);
    if (id === undefined) return null;
    return finish(p, deleteWall(p.layout, p.w, p.d, id), undefined);
  }
  return null;
}
