import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import ClipperLib from 'clipper-lib';
import { buildGen, defaultParams, getGenerator, loadGen, type BuiltPart } from '../src/generators';
import { flattenSub, SCALE } from '../src/clip';
import { grow, type Poly } from '../src/nest';
import { IDENT } from '../src/model';

// Multi-part generators nest their parts inside the assembly block ('nest'); saved objects keep their former
// arrangement: 'rows' (box, box-divided, gearpair) or 'packed' (packParts, the other generators).
const bbox = (p: BuiltPart) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of p.shape.subs) for (const n of s.nodes) {
    x0 = Math.min(x0, n.x + p.at.x); x1 = Math.max(x1, n.x + p.at.x);
    y0 = Math.min(y0, n.y + p.at.y); y1 = Math.max(y1, n.y + p.at.y);
  }
  return { x0, y0, x1, y1 };
};
const area = (parts: BuiltPart[]) => {
  const b = parts.map(bbox);
  return (Math.max(...b.map((q) => q.x1)) - Math.min(...b.map((q) => q.x0))) * (Math.max(...b.map((q) => q.y1)) - Math.min(...b.map((q) => q.y0)));
};
/** Real outlines (holes included) keep at least `gap` apart: grown by gap/2 they must not intersect */
function assertGap(parts: BuiltPart[], gap: number, what: string) {
  const half = gap / 2 - 0.01;
  const grown = parts.map((p) => grow(p.shape.subs.filter((s) => s.closed).map((s) =>
    flattenSub(s, IDENT).map((q) => ({ x: q.X / SCALE + p.at.x, y: q.Y / SCALE + p.at.y }))), half));
  const boxes = parts.map(bbox);
  const paths = (polys: Poly[]) => polys.map((p) => p.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
  parts.forEach((a, i) => parts.slice(i + 1).forEach((b, k) => {
    const j = i + 1 + k, p = boxes[i], q = boxes[j];
    if (Math.max(q.x0 - p.x1, p.x0 - q.x1, q.y0 - p.y1, p.y0 - q.y1) >= gap) return;
    const c = new ClipperLib.Clipper();
    c.AddPaths(paths(grown[i]), ClipperLib.PolyType.ptSubject, true);
    c.AddPaths(paths(grown[j]), ClipperLib.PolyType.ptClip, true);
    const out: ClipperLib.Paths = [];
    c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const overlap = out.reduce((s, x) => s + Math.abs(ClipperLib.Clipper.Area(x)), 0) / (SCALE * SCALE);
    assert.ok(overlap < 1e-3, `${what}: ${a.shape.part}/${b.shape.part} closer than ${gap} mm (${overlap} mm²)`);
  }));
}
const build = (id: string, over: Record<string, unknown>) => {
  const g = getGenerator(id)!;
  const r = buildGen(g, { ...defaultParams(g), ...over } as never);
  assert.ok(r.parts.length, `${id} ${JSON.stringify(over)}: ${JSON.stringify(r.issues)}`);
  return r.parts;
};
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const positions = (parts: BuiltPart[]) => parts.map((p) => [p.shape.part, r6(p.at.x), r6(p.at.y)]);

// Saved layouts reproduce exactly the positions the generators produced before nesting was introduced
const reference: [string, string, Record<string, unknown>, [string, number, number][]][] = [
  ['box-divided', 'rows', { width: 200, depth: 150, height: 60, top: 'open', compartmentsX: 3, compartmentsY: 2, kerf: 0 },
    [['bottom', -210, -35], ['front', 0, -80], ['back', 210, -80], ['left', -80, 80], ['right', 80, 80], ['divx-1', -235, 145], ['divx-2', -75, 145], ['divy-1', 110, 145]]],
  ['box-divided', 'rows', { width: 120, depth: 80, height: 40, top: 'closed', compartmentsX: 2, compartmentsY: 1, kerf: 0.2 },
    [['bottom', -130, -45], ['front', 0, -65], ['back', 130, -65], ['top', -90, 45], ['left', 20, 25], ['right', 110, 25], ['divx-1', -150, 110]]],
  ['box-divided', 'rows', { width: 300, depth: 200, height: 100, thickness: 6, finger: 20, top: 'open', jointLayout: 'legacy' },
    [['bottom', 150, 100], ['front', 460, 50], ['back', 770, 50], ['left', 100, 260], ['right', 310, 260]]],
  ['box', 'rows', { top: 'open', kerf: 0 },
    [['bottom', -105, -27.5], ['front', 0, -42.5], ['back', 105, -42.5], ['left', -42.5, 42.5], ['right', 42.5, 42.5]]],
  ['box', 'rows', { top: 'closed', kerf: 0.2, width: 150, depth: 90, height: 70 },
    [['bottom', -155.2, -47.6], ['front', 0, -57.6], ['back', 155.2, -57.6], ['top', -95.2, 47.6], ['left', 30, 37.6], ['right', 125.2, 37.6]]],
  ['gearpair', 'rows', { plate: false }, [['gear1', -40.65, 0], ['gear2', 22.65, 0]]],
  ['gearpair', 'rows', { plate: true, kerf: 0.2 }, [['gear1', -40.7, 0], ['gear2', 22.7, 0], ['plate', 0, 89.4]]],
  ['drawer', 'packed', {}, [['c_back', -10.65, -32.15], ['c_bottom', -167.95, -152.45], ['c_top', -2.65, -152.45], ['c_left', 122.65, -152.45], ['c_right', 207.95, -152.45],
    ['d_bottom', -171.95, 0.35], ['d_front', -171.95, 114.15], ['d_back', -14.65, 114.15], ['d_left', 139.15, 114.15], ['d_right', -175.45, 191.45], ['front', 153.65, -33.15]]],
  ['insert', 'packed', {}, [['x1', -25, 0], ['x2', -25, 45.3], ['y1', 0, -45.3]]],
  ['shelf', 'packed', {}, [['side1', -230.3, -77.65], ['side2', -75, -77.65], ['board1', 155.3, -152.65], ['board2', -155.3, 152.65], ['board3', 150, 152.65]]],
];
for (const [id, layout, over, at] of reference) {
  const saved = build(id, { ...over, partLayout: layout });
  assert.deepEqual(positions(saved), at, `${id} ${layout} ${JSON.stringify(over)}`);
  // Nesting only moves parts: same parts, same contours; never noticeably larger than before
  const nested = build(id, over);
  assert.deepEqual(nested.map((p) => p.shape.subs), saved.map((p) => p.shape.subs), `${id} contours ${JSON.stringify(over)}`);
  assert.ok(area(nested) <= area(saved) * 1.05, `${id} nest larger than ${layout} ${JSON.stringify(over)}: ${area(nested)} > ${area(saved)}`);
  // Deterministic: an edited assembly is recognised by regenerating its old parameters
  assert.deepEqual(positions(build(id, over)), positions(nested), `${id} nest not deterministic`);
}

// The boxes from the issue get clearly smaller
for (const [id, over] of [['box-divided', { width: 200, depth: 150, height: 60, compartmentsX: 3, compartmentsY: 2 }], ['box', {}], ['drawer', {}]] as const) {
  const before = build(id, { ...over, partLayout: id === 'drawer' ? 'packed' : 'rows' }), after = build(id, over);
  assert.ok(area(after) < area(before) * 0.95, `${id} not compacted: ${area(after)} vs ${area(before)}`);
}

// Nested: real outlines at least gap apart, across sizes, lids, dividers, kerf and the other generators
let checked = 0;
const slow: string[] = [];
const timed = (id: string, over: Record<string, unknown>) => {
  const t0 = performance.now();
  const parts = build(id, over);
  if (performance.now() - t0 > 2000) slow.push(`${id} ${JSON.stringify(over)}`);
  return parts;
};
for (const kerf of [0, 0.2]) for (const top of ['open', 'closed']) {
  for (const [w, d, h, cx, cy] of [[100, 40, 60, 1, 1], [100, 40, 60, 3, 2], [100, 40, 150, 2, 3], [100, 40, 20, 4, 1], [300, 200, 100, 5, 4], [30, 30, 60, 1, 1]]) {
    const parts = timed('box-divided', { width: w, depth: d, height: h, thickness: 3, finger: 6, top, compartmentsX: cx, compartmentsY: cy, ratiosX: '', ratiosY: '', dividerDrop: 5, kerf });
    assertGap(parts, 5 + kerf, `box-divided ${w}x${d}x${h} ${cx}x${cy} ${top} kerf ${kerf}`);
    checked++;
  }
  for (const [w, d, h] of [[100, 80, 50], [40, 40, 200], [300, 60, 40]]) {
    assertGap(timed('box', { width: w, depth: d, height: h, top, kerf }), 5 + kerf, `box ${w}x${d}x${h} ${top} kerf ${kerf}`);
    checked++;
  }
}
for (const plate of [false, true]) for (const [teeth1, teeth2] of [[18, 18], [18, 36], [12, 60], [20, 80]]) {
  assertGap(timed('gearpair', { teeth1, teeth2, plate, kerf: 0.15 }), 5.15, `gearpair ${teeth1}:${teeth2} plate ${plate}`);
  checked++;
}
for (const [id, gap, over] of [['drawer', 5, {}], ['drawer', 5, { carcass: false, kerf: 0.2 }], ['insert', 5, {}], ['shelf', 5, {}], ['discsphere', 3, {}], ['discsphere', 3, { diameter: 400 }]] as const) {
  assertGap(timed(id, over), gap + Number((over as Record<string, unknown>).kerf ?? defaultParams(getGenerator(id)!).kerf), `${id} ${JSON.stringify(over)}`);
  checked++;
}
assert.deepEqual(slow, [], 'nesting too slow');

// Identical parts stay together and aligned (reported case: 225 x 50 x 100, 5 x 5 compartments)
{
  const parts = build('box-divided', { width: 225, depth: 50, height: 100, thickness: 3.6, top: 'open', compartmentsX: 5, compartmentsY: 5,
    ratiosX: '1:1:1:1:1', ratiosY: '1:1:1:1:1', dividerDrop: 2, kerf: 0 });
  for (const prefix of ['divx-', 'divy-']) {
    const group = parts.filter((p) => String(p.shape.part).startsWith(prefix));
    assert.equal(group.length, 4, prefix);
    const rows = new Set(group.map((p) => Math.round(p.at.y * 1000))), cols = new Set(group.map((p) => Math.round(p.at.x * 1000)));
    assert.ok(rows.size + cols.size <= 5, `${prefix} not on a grid: ${rows.size} rows, ${cols.size} columns`);
  }
}

// Saved objects from earlier versions keep their layout and their stored geometry
for (const [id, v, layout] of [['box', 1, 'rows'], ['gearpair', 1, 'rows'], ['box-divided', 2, 'rows'], ['drawer', 1, 'packed'], ['insert', 1, 'packed'],
  ['shelf', 1, 'packed'], ['discsphere', 1, 'packed'], ['ribs', 1, 'packed'], ['stack', 1, 'packed']] as const) {
  const g = getGenerator(id)!;
  const shape = { kind: 'gen' as const, gen: id, v, params: { ...defaultParams(g) } as Record<string, unknown>, subs: [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }] };
  delete shape.params.partLayout;
  const subs = structuredClone(shape.subs);
  loadGen(shape as never);
  assert.equal(shape.v, g.version, `${id} version`);
  assert.equal(shape.params.partLayout, layout, `${id} keeps ${layout} after loading`);
  assert.deepEqual(shape.subs, subs, `${id} geometry unchanged`);
  assert.equal(defaultParams(g).partLayout, 'nest', `${id} default`);
}
console.log(`ok   Part layout: saved rows/packed layouts unchanged, nest deterministic and compact, ${checked} nested cases keep the gap`);
