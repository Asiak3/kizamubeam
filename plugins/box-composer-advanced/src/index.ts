// Box composer (#327): a box with freely placed inner walls (T joints, corners, free ends, crossings).
// This copy makes the outer walls walls of the list like the others (#451): moved, or a stretch of one moved, they give
// the box another shape (corner, U, C) or size.
// Experimental (pack version 0.x). All wood joints come from the app through host.joints.
// Build: node scripts/plugin-pack.mjs --build plugins/box-composer-advanced
// Check: npm run plugin:check plugins/box-composer-advanced
import { definePlugin, host, mm, type Drawing, type Issue, type Part, type SubPath, type Text } from '../../sdk/ts';
import { JointError } from './joints';
import { current, keepWalls } from './edit';
import { buildModel, EPS, mergeWalls, readLayout, scaleLayout, unify, writeLayout, type Layout, type Limits, type Model, type Side, type Wall } from './model';
import { bbox, isRect } from './outline';
import { boardTurned, buildParts, floorSpans, innerHeight, poses, turnOver, TURNED_OVER, withKerf, type Dims } from './parts';
import { planDraw, planPointer, selectedId, type Plan } from './surface';

interface P {
  [k: string]: number | string | boolean;
  width: number;
  depth: number;
  height: number;
  fromMaterial: boolean;
  thickness: number;
  clearance: number;
  kerf: number;
  wallFront: boolean;
  wallBack: boolean;
  wallLeft: boolean;
  wallRight: boolean;
  lid: boolean;
  dividerDrop: number;
  finger: number;
  walls: string;
  wallsRef: string;
  /** 'legacy': saved before #463, floor, back, right and some boards of a shaped outline inner face up */
  faces: string;
}

const sidesOf = (p: P): Record<Side, boolean> => ({ x0: p.wallLeft, x1: p.wallRight, y0: p.wallBack, y1: p.wallFront });

/**
 * The stored walls, outer walls too (#451), in the size they were placed in (the inner size w × d when never scaled);
 * a list without outer walls (a new box) gets those of the rectangle. null when they cannot be read.
 */
function layoutOf(p: P, w: number, d: number): Layout | null {
  const l = readLayout(p.walls, p.wallsRef);
  if (!l) return null;
  const ref: [number, number] = l.ref[0] > 0 && l.ref[1] > 0 ? l.ref : [w, d];
  return { ref, walls: unify(l.walls, ref[0], ref[1], p.thickness, sidesOf(p)), sides: sidesOf(p) };
}

/** Values of the layer's material for the fields; slotPlay (slot width over the thickness) is the total play of a
 * joint, like the clearance here (#402) */
function fromMaterial(): { thickness: number; kerf: number | null; clearance: number | null; name: string | null } | null {
  const m = host.context('material');
  if (!m || m.thickness == null) return null;
  return { thickness: m.thickness, kerf: m.kerf, clearance: m.slotPlay, name: m.name };
}

/**
 * Sizes for the parts, always from the fields: the 3D view and the assembly check take the thickness from the
 * parameters too. "From material" copies the material into the fields when it is switched on (onChange) and warns
 * when the material of the layer no longer matches them.
 */
function dims(p: P): { d: Dims | null; issues: Issue[]; material: string | null } {
  const issues: Issue[] = [];
  let material: string | null = null;
  if (p.fromMaterial) {
    const m = fromMaterial();
    if (!m) return { d: null, issues: [{ key: 'fromMaterial', level: 'error', code: 'material-none' }], material: null };
    material = m.name;
    const off = (a: number | null, b: number) => a != null && Math.abs(a - b) > 1e-6;
    if (off(m.thickness, p.thickness) || off(m.kerf, p.kerf) || off(m.clearance, p.clearance))
      issues.push({ key: 'fromMaterial', level: 'warn', code: 'material-changed', values: { thickness: m.thickness } });
    if (m.kerf == null) issues.push({ key: 'fromMaterial', level: 'warn', code: 'material-no-kerf', values: { kerf: p.kerf } });
    if (m.clearance == null) issues.push({ key: 'fromMaterial', level: 'warn', code: 'material-no-play', values: { play: p.clearance } });
  }
  const sides = { x0: p.wallLeft, x1: p.wallRight, y0: p.wallBack, y1: p.wallFront };
  const any = sides.x0 || sides.x1 || sides.y0 || sides.y1;
  const d: Dims = { W: p.width, D: p.depth, H: p.height, t: p.thickness, finger: p.finger, clearance: p.clearance, kerf: p.kerf, sides, lid: any && p.lid, drop: any ? p.dividerDrop : 0 };
  return { d, issues, material };
}

/** Smallest sizes (user, 17 nov 2026; to be reviewed after the test cuts): one thickness of clear space between walls
 * and joints, walls and free ends two thicknesses long */
const limits = (t: number): Limits => ({ t, gap: t, minLen: 2 * t, freeLen: 2 * t });

/** What the plan editor needs, from the fields; null when the walls cannot be shown */
function plan(p: P): Plan | null {
  const t = p.thickness;
  const w = p.width - 2 * t,
    d = p.depth - 2 * t;
  const layout = w > 0 && d > 0 ? layoutOf(p, w, d) : null;
  if (!(w > 0 && d > 0) || !layout) return null;
  return { w, d, t, lim: limits(t), layout, sides: sidesOf(p) };
}

/**
 * Width or depth changed in the dialog while there are walls: ask whether they grow and shrink with the box or keep
 * their distances in mm (ends at the right or front wall stay there)
 */
function resized(key: string, old: unknown, p: P) {
  if ((key !== 'width' && key !== 'depth') || typeof old !== 'number') return null;
  const t = p.thickness;
  const ow = (key === 'width' ? old : p.width) - 2 * t,
    od = (key === 'depth' ? old : p.depth) - 2 * t,
    nw = p.width - 2 * t,
    nd = p.depth - 2 * t;
  if (!(ow > 0 && od > 0 && nw > 0 && nd > 0) || (Math.abs(ow - nw) < 1e-9 && Math.abs(od - nd) < 1e-9)) return null;
  const l = layoutOf(p, ow, od);
  // Only the four outer walls: they go with the box anyway
  const m = l && buildModel(l, ow, od, limits(t));
  if (!l || !m || (m.box && isRect(m.box.pts) && !m.box.model.walls.length)) return null;
  const walls = current(l, ow, od);
  const scaled = writeLayout({ ref: [nw, nd], walls: scaleLayout({ ref: [ow, od], walls }, nw, nd) });
  const kept = writeLayout({ ref: [nw, nd], walls: keepWalls(walls, ow, od, nw, nd) });
  return {
    ask: {
      question: { code: 'ask.resize' },
      options: [
        { label: { code: 'ask.scale' }, patch: { ...scaled } },
        { label: { code: 'ask.keep' }, patch: { ...kept } },
      ],
    },
  };
}

/** The checked wall model, or the issue that keeps it from being built */
function model(p: P, d: Dims): Model | Issue {
  const t = d.t;
  const w = d.W - 2 * t,
    dd = d.D - 2 * t;
  if (!(w > 2 * t && dd > 2 * t)) return { level: 'error', code: 'box-small' };
  if (innerHeight(d) < 2 * t) return { key: 'height', level: 'error', code: 'walls-low', values: { min: 2 * t } };
  const l = layoutOf(p, w, dd);
  if (!l) return { key: 'walls', level: 'error', code: 'walls-bad' };
  return buildModel(l, w, dd, limits(t));
}
const isIssue = (m: Model | Issue): m is Issue => 'code' in m;

/** Everything validate and generate need: issues, and the parts when there is no error */
function compute(p: P) {
  const { d, issues, material } = dims(p);
  if (!d) return { issues, d, material, built: null };
  const m = model(p, d);
  if (isIssue(m)) return { issues: [...issues, m], d, material, built: null };
  issues.push(...m.issues.map((i) => ({ key: 'walls', ...i })));
  if (!m.box || issues.some((i) => i.level === 'error')) return { issues, d, material, built: null };
  // The parts from the box the walls enclose, in its own size (the same as the fields' after an edit in the plan)
  const box = m.box;
  // (which sides of a rectangle have their outer wall: those that are not open in the list, #451)
  const sides = box.sides;
  const any = sides.x0 || sides.x1 || sides.y0 || sides.y1;
  const db: Dims = { ...d, W: box.size[0] + 2 * d.t, D: box.size[1] + 2 * d.t, sides, lid: any && p.lid, drop: any ? p.dividerDrop : 0 };
  try {
    return { issues, d: db, material, built: buildParts(box.model, db), m, box };
  } catch (e) {
    if (e instanceof JointError) return { issues: [...issues, { level: 'error' as const, code: e.code, ...(e.values ? { values: e.values } : {}) }], d, material, built: null };
    throw e;
  }
}

/** Check design on the cut lines (#388): thin webs, lines cut twice, parts larger than the work area */
function checkIssues(parts: Record<string, SubPath[]>, kerf: number): Issue[] {
  const area = host.context('workArea');
  const found = host.check({ parts: Object.entries(parts).map(([key, subs]) => ({ key, subs })), kerf, ...(area ? { workArea: area } : {}) });
  return found.filter((f) => f.level !== 'info').map((f) => ({ level: f.level as 'error' | 'warn', code: f.code, ...(f.values ? { values: f.values } : {}) }));
}

/** Does the block of parts (positions from nest) fit the work area, turned or not? */
function fitsArea(parts: Part[]): boolean {
  const area = host.context('workArea');
  if (!area) return true;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of parts)
    for (const s of p.subs)
      for (const n of s.nodes) {
        x0 = Math.min(x0, n.x + p.at.x); x1 = Math.max(x1, n.x + p.at.x);
        y0 = Math.min(y0, n.y + p.at.y); y1 = Math.max(y1, n.y + p.at.y);
      }
  const w = x1 - x0, h = y1 - y0;
  return (w <= area.width && h <= area.height) || (h <= area.width && w <= area.height);
}

/** The parts last built for the marks in the preview, by parameters: draw is called with every pointer move */
type Marked = { keys: string[]; walls: ReturnType<typeof buildParts>['walls']; d: Dims; src: Map<number, number>; part: Map<number, string> };
let marked: { key: string; built: Marked | null } | null = null;
function builtFor(p: P): Marked | null {
  const key = JSON.stringify(p);
  if (marked?.key !== key) {
    const c = compute(p);
    marked = { key, built: c.built && c.box ? { keys: Object.keys(c.built.parts), walls: c.built.walls, d: c.d, src: c.box.src, part: partOf(c.built, c.box) } : null };
  }
  return marked.built;
}

/** The rectangle's outer walls by edge of its outline (top, right, bottom, left: outline.ts) */
const RECT_KEYS = ['back', 'right', 'front', 'left'];

/**
 * The part of every wall of the list (#451): an outer wall of the rectangle its side, an outer wall of a shaped box
 * and a wall that goes on from it in line its board, any other wall its own part (the first, if it gives several)
 */
function partOf(built: ReturnType<typeof buildParts>, box: NonNullable<Model['box']>): Map<number, string> {
  const out = new Map<number, string>();
  const src = (id: number) => box.src.get(id) ?? id;
  for (const b of built.boards) {
    for (const e of b.edges) out.set(box.edgeWall[e.k], b.key);
    for (const q of b.members) out.set(src(q.it.wall.id), b.key);
  }
  if (!built.boards.length && isRect(box.pts)) box.edgeWall.forEach((id, k) => out.set(id, RECT_KEYS[k]));
  for (const q of built.walls) if (!out.has(src(q.it.wall.id))) out.set(src(q.it.wall.id), q.key);
  return out;
}

/**
 * The selected wall in the dialog's preview (#411): its part, and the slots of its teeth in the floor (rectangles in
 * the floor's coordinates, as parts.ts places the teeth). The part numbers are the order of generate's parts. An outer
 * wall, and a wall that is part of an outer wall's board (#451), marks its board.
 */
function highlight(p: P, id: number | undefined): NonNullable<Drawing['highlight']> {
  if (id === undefined) return [];
  const b = builtFor(p);
  const key = b?.part.get(id);
  const part = b && key ? b.keys.indexOf(key) : -1;
  if (!b || part < 0) return [];
  const out: NonNullable<Drawing['highlight']> = [{ part }];
  const floor = b.keys.indexOf('floor');
  const panel = b.walls.find((q) => q.key === key);
  if (floor < 0 || !panel) return out;
  const { t, W, D, clearance } = b.d;
  const w = panel.it.wall;
  const ht = (t + clearance) / 2;
  const subs: SubPath[] = floorSpans(panel, b.d).map((sp) => {
    const c = (sp.a + sp.b) / 2,
      hl = (sp.width + clearance) / 2;
    const corners: [number, number][] = [[c - hl, -ht], [c + hl, -ht], [c + hl, ht], [c - hl, ht]];
    return { closed: true, nodes: corners.map(([a, s]) => (w.axis === 'h' ? { x: a + t - W / 2, y: w.pos + t - D / 2 + s } : { x: w.pos + t - W / 2 + s, y: a + t - D / 2 })) };
  });
  if (subs.length) out.push({ part: floor, subs });
  return out;
}

/** The fields of the outer walls of the rectangle and their sides */
const SIDE_KEYS: Record<string, Side> = { wallLeft: 'x0', wallRight: 'x1', wallBack: 'y0', wallFront: 'y1' };

/**
 * An outer wall of the box switched on or off (#451: its outer wall is a wall of the list): the walls on that side of
 * the box (its bounding box) are left open or closed again, as Delete does in the plan; a side without any wall gets
 * one from corner to corner.
 */
function sideToggled(side: Side, p: P) {
  const t = p.thickness;
  const w = p.width - 2 * t,
    d = p.depth - 2 * t;
  const l = w > 0 && d > 0 ? layoutOf(p, w, d) : null;
  if (!l) return null;
  const on = sidesOf(p)[side];
  const before = buildModel({ ...l, sides: { ...sidesOf(p), [side]: !on } }, w, d, limits(t));
  if (!before.box) return null;
  const [x0, y0, x1, y1] = bbox(before.box.pts);
  const axis = side === 'x0' || side === 'x1' ? 'v' : 'h';
  const pos = { x0, x1, y0, y1 }[side];
  const walls = current(l, w, d);
  const onSide = (q: Wall) => q.axis === axis && Math.abs(q.pos - pos) < EPS;
  const set = (q: Wall): Wall => ({ id: q.id, axis: q.axis, pos: q.pos, from: q.from, to: q.to, ...(on ? {} : { open: true }) });
  let next: Wall[];
  if (walls.some(onSide)) next = walls.map((q) => (onSide(q) ? set(q) : q));
  else if (on) next = [...walls, { id: walls.reduce((m, q) => Math.max(m, q.id), 0) + 1, axis, pos, from: axis === 'v' ? y0 : x0, to: axis === 'v' ? y1 : x1 }];
  else return null;
  const stored = writeLayout({ ref: [w, d], walls: mergeWalls(next) });
  return { patch: { walls: stored.walls, wallsRef: stored.wallsRef } };
}

definePlugin<P>({
  // 2 (#463): saved boxes keep floor, back, right and the boards of a shaped outline as they were (inner face up)
  migrate({ params, from }) {
    return from < 2 ? { ...params, faces: 'legacy' } : params;
  },
  // "From material" switched on: take over thickness, kerf and play of the layer's material (those it has)
  onChange({ key, old, params }) {
    if (key === 'width' || key === 'depth') return resized(key, old, params);
    if (key in SIDE_KEYS) return sideToggled(SIDE_KEYS[key], params);
    if (key !== 'fromMaterial' || !params.fromMaterial) return null;
    const m = fromMaterial();
    if (!m) return null;
    return { patch: { thickness: m.thickness, ...(m.kerf != null ? { kerf: m.kerf } : {}), ...(m.clearance != null ? { clearance: m.clearance } : {}) } };
  },
  // A name per row of the wall list: its number and which way it runs
  view(p) {
    const l = readLayout(p.walls, p.wallsRef);
    return { rows: { walls: (l?.walls ?? []).map((w): Text => ({ code: `row.${w.open ? 'open.' : ''}${w.axis}`, values: { id: w.id } })) } };
  },
  // The plan editor (#385), with the selected wall marked in the preview (#411)
  draw({ params, ...s }) {
    const pl = plan(params);
    if (!pl) return { frame: { x0: 0, y0: 0, x1: 100, y1: 40 }, items: [{ type: 'text', x: 4, y: 20, text: { code: 'walls-bad' }, style: 'warn' }] };
    return { ...planDraw(pl, s), highlight: highlight(params, selectedId(pl, s)) };
  },
  onSurface({ event, surface, params }) {
    const pl = plan(params);
    return pl ? planPointer(pl, event, surface) : null;
  },
  validate(p) {
    const c = compute(p);
    if (!c.built || !c.d) return c.issues;
    return [...c.issues, ...checkIssues(c.built.parts, c.d.kerf)];
  },
  generate(p) {
    const c = compute(p);
    if (!c.built || !c.box || !c.d) throw new Error(c.issues.find((i) => i.level === 'error')?.code ?? 'walls-bad');
    const legacy = p.faces === 'legacy';
    const kerfed = withKerf(c.built.parts, c.d.kerf);
    const parts = legacy ? kerfed : turnOver(kerfed, [...TURNED_OVER, ...c.built.boards.filter(boardTurned).map((b) => b.key)]);
    const keys = Object.keys(parts);
    const at = host.nest({ parts: keys.map((key) => ({ key, subs: parts[key] })), gap: Math.max(3, 2 * c.d.kerf + 2) });
    const out: Part[] = keys.map((key, i) => ({ key, subs: parts[key], at: { x: at[i][0], y: at[i][1] } }));
    const labels: Record<string, Text> = {};
    for (const w of c.built.walls) labels[w.key] = { code: 'part.wall', values: { id: c.box.src.get(w.it.wall.id) ?? w.it.wall.id } };
    // A board of a shaped box: named after the outer walls on it (the walls of the list, #451)
    for (const b of c.built.boards) labels[b.key] = { code: 'part.wall', values: { id: Math.min(...b.edges.map((e) => c.box.edgeWall[e.k])) } };
    const info: [Text, Text][] = [
      ['info.walls', String(c.built.walls.length)],
      ['info.height', `${mm(innerHeight(c.d))} mm`],
    ];
    if (c.material) info.push(['info.material', `${c.material} · ${mm(c.d.t)} mm`]);
    // Larger than the work area as one block: the app spreads the parts over pages (#387), not turned (grain)
    const spread = fitsArea(out) ? {} : { distribute: { rotate: false } };
    return { parts: out, info, labels, poses: { poses: poses(c.built.walls, c.d, keys, c.built.boards, legacy) }, ...spread };
  },
});
