import './core-fixtures-env';
import assert from 'node:assert/strict';
const { straightGeometry, projectedSlot } = await import('../src/straightSlots');
const { resolvedSlots, projectionFrame, cutSlots, readSlotRecipe, slotOutline } = await import('../src/slotPlacement');
const { guidedSlot, slotAnchorFromReference } = await import('../src/contourSlots');
type Pt = import('../src/model').Pt;
type Sub = import('../src/model').SubPath;
type Slot = import('../src/slotPlacement').PlacedSlot;
type Recipe = import('../src/slotPlacement').SlotRecipe;
type Projection = import('../src/straightSlots').SlotProjection;
type Edge = import('../src/straightSlots').StraightEdge;

const polygon = (points: number[][]): Sub => ({ closed: true, nodes: points.map(([x, y]) => ({ x, y })) });
const rectangle = () => polygon([[0, 0], [100, 0], [100, 80], [0, 80]]);
const values: Slot = { x: 0, y: 0, angle: 0, width: 10, depth: 6, clearance: 0, factor: 1 };
const recipe = (base: Sub[], slots: Slot[]): Recipe => ({ source: { kind: 'path', subs: base }, base, slots });
const near = (a: number, b: number, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const point = (actual: Pt, expected: Pt) => { near(actual.x, expected.x); near(actual.y, expected.y); };
const at = (edge: Edge, distance: number, normal = 0): Pt => ({
  x: edge.a.x + edge.tangent.x * distance + edge.normal.x * normal,
  y: edge.a.y + edge.tangent.y * distance + edge.normal.y * normal,
});
const projection = (edge: Edge, extra: Partial<Projection> = {}): Projection => ({
  edge: edge.key, origin: { kind: 'vertex', sub: 0, node: 0 }, target: 'center', distance: 30, direction: 1, cornerAngle: 45, ...extra,
});
const area = (subs: Sub[]) => Math.abs(subs.reduce((sum, sp) => sum + sp.nodes.reduce((a, p, i) => {
  const q = sp.nodes[(i + 1) % sp.nodes.length]; return a + (p.x * q.y - q.x * p.y) / 2;
}, 0), 0));
let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error); }
}

test('collinear nodes merge into maximal edges, including across the closing seam', () => {
  const base = [polygon([[50, 0], [100, 0], [100, 80], [0, 80], [0, 0], [25, 0]])];
  const geometry = straightGeometry(base, 45);
  assert.equal(geometry.edges.length, 4);
  const top = geometry.edges.find(e => e.a.y === 0 && e.b.y === 0)!;
  assert.ok(top); near(top.length, 100); point(top.a, { x: 0, y: 0 }); point(top.b, { x: 100, y: 0 });
  assert.deepEqual(geometry.vertices.map(v => v.node).sort(), [1, 2, 3, 4]);
  const frame = projectedSlot(base, projection(top, { distance: 50 }), 80, 6, { x: 0, y: 0 });
  point(frame.a, { x: 10, y: 0 }); point(frame.b, { x: 90, y: 0 });
});

test('only closed root contours supply placement edges or reference corners', () => {
  const base = [rectangle(), polygon([[20, 20], [80, 20], [80, 60], [20, 60]]),
    polygon([[200, 0], [230, 0], [230, 30], [200, 30]]),
    { ...polygon([[300, 0], [310, 0], [310, 10]]), closed: false }];
  const geometry = straightGeometry(base, 45);
  assert.equal(geometry.edges.length, 8); assert.equal(geometry.vertices.length, 8);
  assert.deepEqual([...new Set(geometry.edges.map(e => e.sub))], [0, 2]);
  assert.deepEqual([...new Set(geometry.vertices.map(v => v.sub))], [0, 2]);
});

test('true Bezier spans never become straight edges, even with only four control nodes', () => {
  const curved = rectangle(); curved.nodes[0].cout = { x: 25, y: -20 }; curved.nodes[1].cin = { x: 75, y: -20 };
  const geometry = straightGeometry([curved], 45);
  assert.equal(geometry.edges.length, 3); assert.ok(!geometry.edges.some(e => e.start === 0));
  assert.throws(() => projectedSlot([curved], { ...projection(geometry.edges[0]), edge: '0:0:0' }, 10, 6, { x: 30, y: 0 }));
  const circle: Sub = { closed: true, nodes: [
    { x: 50, y: 0, cin: { x: 50, y: -28 }, cout: { x: 50, y: 28 } },
    { x: 0, y: 50, cin: { x: 28, y: 50 }, cout: { x: -28, y: 50 } },
    { x: -50, y: 0, cin: { x: -50, y: 28 }, cout: { x: -50, y: -28 } },
    { x: 0, y: -50, cin: { x: -28, y: -50 }, cout: { x: 28, y: -50 } },
  ] };
  assert.equal(straightGeometry([circle], 45).edges.length, 0);
});

test('legacy vertex list keeps both rounded junctions so stored references still resolve', () => {
  const rounded = polygon([[0, 0], [80, 0], [100, 20], [100, 80], [0, 80]]);
  rounded.nodes[1].cout = { x: 91, y: 0 }; rounded.nodes[2].cin = { x: 100, y: 9 };
  const geometry = straightGeometry([rounded], 120);
  assert.deepEqual(geometry.vertices.map(v => [v.node, v.transition]), [[1, true], [2, true]]);
  assert.equal(geometry.edges.length, 4);
  assert.ok(!geometry.references.some(r => r.origin.kind === 'curveCorner'), 'a 90 degree rounding is not offered at a 120 degree threshold');
});

test('arbitrary 37 degree turn respects thresholds rather than a right-angle heuristic', () => {
  const theta = 37 * Math.PI / 180;
  const base = [polygon([[0, 0], [40, 0], [40 + 30 * Math.cos(theta), 30 * Math.sin(theta)], [70, 80], [0, 80]])];
  assert.ok(straightGeometry(base, 36.99).vertices.some(v => v.node === 1));
  assert.ok(!straightGeometry(base, 37.01).vertices.some(v => v.node === 1));
  const square = [rectangle()]; assert.equal(straightGeometry(square, 90).vertices.length, 4);
  for (const angle of [0, 180, NaN, Infinity]) assert.throws(() => straightGeometry(base, angle));
});

test('rounded corners use their effective turn and offer exactly one virtual reference', () => {
  const sharp = polygon([[0, 60], [60, 0], [100, 0], [100, 60]]);
  assert.ok(!straightGeometry([sharp], 90).references.some(r => r.origin.kind === 'vertex' && r.origin.node === 1));
  const rounded = polygon([[0, 60], [59, 1], [61, 0], [100, 0], [100, 60]]);
  rounded.nodes[1].cout = { x: 59.6, y: 0.4 };
  rounded.nodes[2].cin = { x: 60.2, y: 0 };
  const offered = (angle: number) => straightGeometry([rounded], angle).references.filter(r => r.origin.kind === 'curveCorner');
  assert.equal(offered(44.9).length, 1);
  assert.deepEqual(offered(44.9)[0].origin, { kind: 'curveCorner', sub: 0, node: 1 });
  point(offered(44.9)[0].point, { x: 60, y: 0 }, 0.5);
  assert.equal(offered(45.1).length, 0);
  assert.equal(offered(90).length, 0);
  // The legacy vertex list still contains both junction nodes for old recipes.
  assert.deepEqual(straightGeometry([rounded], 90).vertices.filter(v => v.node === 1 || v.node === 2).map(v => [v.node, v.transition]), [[1, true], [2, true]]);
});

test('rounded right angle is offered once at the 90 degree threshold', () => {
  const rounded = polygon([[0, 0], [90, 0], [100, 10], [100, 80], [0, 80]]);
  rounded.nodes[1].cout = { x: 96, y: 0 }; rounded.nodes[2].cin = { x: 100, y: 4 };
  const refs = straightGeometry([rounded], 90).references.filter(r => r.origin.kind === 'curveCorner');
  assert.equal(refs.length, 1);
  point(refs[0].point, { x: 100, y: 0 }, 0.5);
});

test('rounded corner references resolve to the virtual corner and place the slot exactly', () => {
  const rounded = polygon([[0, 0], [90, 0], [100, 10], [100, 80], [0, 80]]);
  rounded.nodes[1].cout = { x: 96, y: 0 }; rounded.nodes[2].cin = { x: 100, y: 4 };
  const top = straightGeometry([rounded], 45).edges.find(e => e.a.y === 0 && e.b.y === 0)!;
  const slot = { ...values, projection: projection(top, { origin: { kind: 'curveCorner', sub: 0, node: 1 }, distance: 50, direction: -1 }) };
  const resolved = resolvedSlots(recipe([rounded], [slot]))[0];
  point({ x: resolved.x, y: resolved.y }, { x: 100, y: 0 });
  const frame = projectionFrame([rounded], resolved);
  point(frame.center, { x: 50, y: 0 }); point(frame.a, { x: 45, y: 0 }); point(frame.b, { x: 55, y: 0 });
  assert.throws(() => resolvedSlots(recipe([rounded], [{ ...slot, projection: { ...slot.projection, origin: { kind: 'curveCorner', sub: 0, node: 2 } } }])),
    'a mid-chain node is not a rounded-corner reference');
});

test('off-edge vertex reference projects perpendicularly, not by contour travel', () => {
  const base = [rectangle()], top = straightGeometry(base, 45).edges[0];
  const slot = { ...values, projection: projection(top, { origin: { kind: 'vertex', sub: 0, node: 3 } }) };
  const resolved = resolvedSlots(recipe(base, [slot]))[0], frame = projectionFrame(base, resolved);
  point({ x: resolved.x, y: resolved.y }, { x: 0, y: 80 });
  point(frame.origin, { x: 0, y: 80 }); point(frame.zero, { x: 0, y: 0 }); point(frame.center, { x: 30, y: 0 });
  point(frame.bottomStart, { x: 25, y: 6 }); point(frame.bottomEnd, { x: 35, y: 6 });
  near(area(cutSlots(recipe(base, [slot]))), 8000 - 60, 0.001);
});

test('start/center/end targets and both directions are exact on every orientation', () => {
  const theta = 31 * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
  const rotated: Sub = { closed: true, nodes: rectangle().nodes.map(p => ({ x: 17 + c * p.x - s * p.y, y: -23 + s * p.x + c * p.y })) };
  for (const base of [[rectangle()], [rotated], [{ ...rectangle(), nodes: rectangle().nodes.reverse() }]]) {
    for (const edge of straightGeometry(base, 45).edges) {
      for (const target of ['start', 'center', 'end'] as const) for (const direction of [1, -1] as const) {
        const origin = at(edge, 30, -17), p = projection(edge, { target, distance: 10, direction });
        const frame = projectedSlot(base, p, 8, 6, origin), targetAt = 30 + direction * 10;
        const startAt = targetAt - (target === 'center' ? 4 : target === 'end' ? 8 : 0);
        point(frame.origin, origin); point(frame.zero, at(edge, 30)); point(frame.target, at(edge, targetAt));
        point(frame.a, at(edge, startAt)); point(frame.b, at(edge, startAt + 8)); point(frame.center, at(edge, startAt + 4));
        point(frame.bottomStart, at(edge, startAt, 6)); point(frame.bottomEnd, at(edge, startAt + 8, 6));
        const localBottom = frame.bottomStart;
        if (base[0] === rotated) {
          const x = c * (localBottom.x - 17) + s * (localBottom.y + 23);
          const y = -s * (localBottom.x - 17) + c * (localBottom.y + 23);
          assert.ok(x >= -1e-7 && x <= 100 + 1e-7 && y >= -1e-7 && y <= 80 + 1e-7);
        } else assert.ok(localBottom.x >= 0 && localBottom.x <= 100 && localBottom.y >= 0 && localBottom.y <= 80);
      }
    }
  }
});

test('full width must fit the same straight: no corner crossing, short-edge fallback or clamping', () => {
  const base = [rectangle()], top = straightGeometry(base, 45).edges[0], p = projection(top);
  for (const [target, distance] of [['center', 2], ['center', 98], ['start', 95], ['end', 5]] as const)
    assert.throws(() => projectedSlot(base, { ...p, target, distance }, 10, 6, { x: 0, y: 0 }));
  assert.throws(() => projectedSlot(base, { ...p, distance: 50 }, 101, 6, { x: 0, y: 0 }));
  const exact = projectedSlot(base, { ...p, distance: 50 }, 100, 6, { x: 0, y: 0 });
  point(exact.a, top.a); point(exact.b, top.b);
  for (const distance of [-1, NaN, Infinity]) assert.throws(() => projectedSlot(base, { ...p, distance }, 10, 6, { x: 0, y: 0 }));
  assert.throws(() => projectedSlot(base, { ...p, edge: 'missing' }, 10, 6, { x: 0, y: 0 }));
});

function chain() {
  const base = [rectangle()], edges = straightGeometry(base, 45).edges, top = edges[0], bottom = edges[2];
  const a: Slot = { ...values, id: 'A', projection: projection(top) };
  const b: Slot = { ...values, id: 'B', width: 8, projection: projection(bottom, {
    origin: { kind: 'slot', slotId: 'A', point: 'end' }, distance: 0,
  }) };
  const c: Slot = { ...values, id: 'C', width: 4, projection: projection(top, {
    origin: { kind: 'slot', slotId: 'B', point: 'bottomEnd' }, distance: 10,
  }) };
  return { base, a, b, c, r: recipe(base, [c, b, a]) };
}

test('DAG resolves out of order across different edges and propagates parent movement transitively', () => {
  const { base, a, r } = chain(), before = JSON.stringify(r);
  const frames = resolvedSlots(r).map(slot => projectionFrame(base, slot));
  point(frames[1].origin, { x: 35, y: 0 }); point(frames[1].zero, { x: 35, y: 80 });
  point(frames[0].origin, { x: 31, y: 74 }); point(frames[0].center, { x: 41, y: 0 });
  assert.equal(JSON.stringify(r), before, 'resolution must not write cached positions into the recipe');
  a.projection!.distance += 7;
  const after = resolvedSlots(r).map(slot => projectionFrame(base, slot));
  after.forEach((frame, i) => { near(frame.center.x - frames[i].center.x, 7); near(frame.center.y, frames[i].center.y); });
});

test('parent width/correction changes move edge followers across edges, but not center followers', () => {
  const { base, a, b, c, r } = chain();
  const center: Slot = { ...b, id: 'center', projection: { ...b.projection!, origin: { kind: 'slot', slotId: 'A', point: 'center' } } };
  r.slots.push(center);
  const before = resolvedSlots(r).map(slot => projectionFrame(base, slot));
  a.factor = 1.2; a.clearance = 2; // Effective parent width changes from 10 to 14.
  const after = resolvedSlots(r).map(slot => projectionFrame(base, slot));
  for (const id of [b.id, c.id]) { const i = r.slots.findIndex(slot => slot.id === id); near(after[i].center.x - before[i].center.x, 2); }
  near(after[3].center.x, before[3].center.x);
  near(Math.hypot(after[2].b.x - after[2].a.x, after[2].b.y - after[2].a.y), 14);
});

test('every supported slot reference point uses the parent frame, not its stored origin', () => {
  for (const reference of ['start', 'center', 'end', 'bottomStart', 'bottomEnd'] as const) {
    const { base, a, b } = chain(); b.projection!.origin = { kind: 'slot', slotId: 'A', point: reference };
    const [parent, child] = resolvedSlots(recipe(base, [a, b]));
    const parentFrame = projectionFrame(base, parent), childFrame = projectionFrame(base, child);
    point(childFrame.origin, parentFrame[reference === 'start' ? 'a' : reference === 'end' ? 'b' : reference]);
    near(childFrame.zero.y, 80); near(childFrame.zero.x, childFrame.origin.x);
  }
});

test('missing references, cycles, free parents and invalid vertex references reject', () => {
  const { base, a, b } = chain();
  assert.throws(() => resolvedSlots(recipe(base, [b])));
  assert.throws(() => resolvedSlots(recipe(base, [{ ...values, id: 'A' }, b])));
  a.projection!.origin = { kind: 'slot', slotId: 'B', point: 'center' };
  assert.throws(() => resolvedSlots(recipe(base, [a, b])));
  a.projection!.origin = { kind: 'slot', slotId: 'A', point: 'center' };
  assert.throws(() => resolvedSlots(recipe(base, [a])));
  a.projection!.origin = { kind: 'vertex', sub: 0, node: 99 };
  assert.throws(() => resolvedSlots(recipe(base, [a])));
  const collinear = [polygon([[0, 0], [50, 0], [100, 0], [100, 80], [0, 80]])];
  a.projection = projection(straightGeometry(collinear, 45).edges[0], { origin: { kind: 'vertex', sub: 0, node: 1 } });
  assert.throws(() => resolvedSlots(recipe(collinear, [a])));
});

test('geometry, projection, resolution and subtraction preserve deeply frozen base and recipe data', () => {
  const { r } = chain(), before = JSON.stringify(r);
  function freeze(value: unknown) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(r); straightGeometry(r.base, 45); const slots = resolvedSlots(r);
  slots.forEach(slot => projectionFrame(r.base, slot)); assert.ok(cutSlots(r).length);
  assert.equal(JSON.stringify(r), before);
});

test('projection JSON roundtrip retains references, effective dimensions and subtraction output', () => {
  const { r } = chain(), text = JSON.stringify(r), loaded = readSlotRecipe({ recipe: text });
  assert.equal(JSON.stringify(loaded), text); assert.deepEqual(resolvedSlots(loaded), resolvedSlots(r));
  assert.deepEqual(cutSlots(loaded), cutSlots(r));
  assert.throws(() => readSlotRecipe({ recipe: JSON.stringify({ ...r, slots: [r.slots[0], r.slots[0]] }) }));
});

test('legacy free and contour slots retain their coordinate conventions and output', () => {
  const base = [rectangle()], free: Slot = { ...values, x: 30, y: 40 };
  const guided: Slot = { ...values, anchor: slotAnchorFromReference(base, { x: 50, y: 0 }, 0, 1, 'curve') };
  for (const slot of [free, guided]) {
    const r = recipe(base, [slot]), text = JSON.stringify(r), loaded = readSlotRecipe({ recipe: text });
    assert.deepEqual(resolvedSlots(r), [slot]); assert.equal(JSON.stringify(loaded), text);
    assert.deepEqual(cutSlots(loaded), cutSlots(r)); near(area(cutSlots(r)), 7940, 0.001);
    assert.equal(resolvedSlots(r)[0].projection, undefined);
  }
  point(slotOutline(free).nodes[0], { x: 25, y: 37 });
  const frame = guidedSlot(base, guided); point(frame.center, { x: 50, y: 0 }); near(frame.outline.nodes[2].y, 6);
});

console.log(`Straight slots: ${passed} passed, ${failed} failed.`);
assert.equal(failed, 0, 'Straight-slot regressions failed; see individual failures above.');
