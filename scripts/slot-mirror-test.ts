import './core-fixtures-env';
import assert from 'node:assert/strict';
import type { PlacedSlot, SlotRecipe, SlotMirror } from '../src/slotPlacement';
import type { Pt, SubPath } from '../src/model';
const { resolvedFeatureGeometry, resolvedSlots, projectionFrame, cutSlots, readSlotRecipe, effectiveSlotGroup,
  effectiveSlot, adoptSlotFeatureRecipe, SLOT_GENERATOR, FEATURE_SLOT_GENERATOR, isSlotGenerator } = await import('../src/slotPlacement');
const rect = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
] });
const parent = (): PlacedSlot => ({ id: 'p', x: 0, y: 0, angle: 0, width: 10, depth: 6, clearance: 0, factor: 1,
  groupId: 'g', projection: { edge: '0:0:0', origin: { kind: 'vertex', sub: 0, node: 0 }, target: 'center', distance: 25, direction: 1, cornerAngle: 20 } });
const mirror = (id = 'm', slotId = 'p', axis: SlotMirror['axis'] = { kind: 'helper', helperId: 'h' }): PlacedSlot => ({
  id, x: 999, y: 999, angle: 123, width: 999, depth: 999, clearance: 999, factor: 999, mirror: { slotId, axis },
});
const recipe = (): SlotRecipe => ({ base: [rect(0, 0, 100, 100)], source: { kind: 'path', subs: [rect(0, 0, 100, 100)] },
  settings: { cornerAngle: 20 }, groups: [{ id: 'g', name: 'Group', width: 10, depth: 6, clearance: 0, factor: 1, burn: 0, cornerStyle: 'corner' }],
  slots: [parent(), mirror()], helpers: [{ id: 'h', first: { kind: 'vertex', sub: 0, node: 0 }, second: { kind: 'vertex', sub: 0, node: 1 }, edge: '0:0:0' }],
});
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const point = (actual: Pt, expected: Pt) => { near(actual.x, expected.x); near(actual.y, expected.y); };
const frames = (r: SlotRecipe) => resolvedSlots(r).map(s => projectionFrame(r.base, s));
const parse = (r: SlotRecipe) => readSlotRecipe({ recipe: JSON.stringify(r) });
let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log(`PASS ${name}`); }

test('vertical symmetry reflects nominal start/end, normal, depth and ignores stored dimensions', () => {
  const r = recipe(), [p, m] = frames(r);
  point(m.a, { x: 100 - p.a.x, y: p.a.y }); point(m.b, { x: 100 - p.b.x, y: p.b.y });
  point(m.bottomStart, { x: 100 - p.bottomStart.x, y: p.bottomStart.y });
  point(m.edge.normal, p.edge.normal); near(m.edge.tangent.x, -1);
  const slots = resolvedSlots(r); assert.equal(slots[1].projection!.edge, '0:0:0');
  assert.equal(slots[1].groupId, 'g'); assert.equal(slots[1].width, 10); assert.equal(slots[1].depth, 6);
  assert.equal(effectiveSlotGroup(r, r.slots[1]), r.groups![0]); assert.equal(effectiveSlot(r, r.slots[1]).width, 10);
  assert.ok(cutSlots(r).length);
});
test('horizontal symmetry finds opposite edge without reversing semantic mouth order', () => {
  const r = recipe(); r.helpers![0].second = { kind: 'vertex', sub: 0, node: 3 }; r.helpers![0].edge = '0:3:3';
  const [p, m] = frames(r); point(m.a, { x: p.a.x, y: 100 }); point(m.b, { x: p.b.x, y: 100 });
  point(m.bottomStart, { x: p.a.x, y: 94 }); point(m.edge.normal, { x: 0, y: -1 });
  assert.equal(resolvedSlots(r)[1].projection!.edge, '0:2:2'); assert.ok(cutSlots(r).length);
});
test('diagonal symmetry finds perpendicular actual edge', () => {
  const r = recipe(); r.base.push({ closed: true, nodes: [{ x: 200, y: 0 }, { x: 210, y: 10 }, { x: 200, y: 20 }, { x: 190, y: 10 }] });
  r.helpers![0].second = { kind: 'vertex', sub: 0, node: 2 }; r.helpers![0].edge = '1:1:1';
  const [p, m] = frames(r); point(m.a, { x: 0, y: p.a.x }); point(m.b, { x: 0, y: p.b.x });
  point(m.edge.normal, { x: 1, y: 0 }); assert.ok(cutSlots(r).length);
});
test('rotated and orientation-reversed base coordinates reflect identically', () => {
  for (const handedness of [1, -1]) {
    const r = recipe();
    const transform = (p: Pt): Pt => ({ x: 200 + handedness * .6 * p.x - .8 * p.y, y: -30 + handedness * .8 * p.x + .6 * p.y });
    r.base = r.base.map(sp => ({ ...sp, nodes: sp.nodes.map(transform) }));
    const [p, m] = frames(r); point(p.a, transform({ x: 20, y: 0 })); point(m.a, transform({ x: 80, y: 0 }));
    point(m.bottomEnd, transform({ x: 70, y: 6 })); assert.ok(cutSlots(r).length);
  }
});
test('group edits, helper moves, parent edits and chains propagate live', () => {
  const r = recipe();
  r.helpers![0].first = { kind: 'slot', slotId: 'p', point: 'start' };
  r.helpers![0].second = { kind: 'vertex', sub: 0, node: 1 };
  near(frames(r)[1].center.x, 95);
  r.groups![0].width = 20; near(frames(r)[1].center.x, 90);
  r.slots[0].projection!.distance = 35; near(frames(r)[1].center.x, 90);
  r.helpers![0].first = { kind: 'vertex', sub: 0, node: 0 };
  r.slots.push(mirror('chain', 'm')); const [p, , chain] = frames(r);
  point(chain.a, p.a); point(chain.b, p.b); point(chain.bottomStart, p.bottomStart);
  assert.equal(effectiveSlotGroup(r, r.slots[2]), r.groups![0]);
  assert.throws(() => cutSlots(r), /doppelten Ausschnitt/);
});
test('dependent projections reference reflected nominal start/end, not base traversal', () => {
  const r = recipe(), child = parent(); child.id = 'child'; child.projection!.origin = { kind: 'slot', slotId: 'm', point: 'start' };
  child.projection!.distance = 0; r.slots.push(child);
  near(resolvedSlots(r)[2].x, 80);
  child.projection!.origin = { kind: 'slot', slotId: 'm', point: 'bottomEnd' };
  point(resolvedSlots(r)[2], { x: 70, y: 6 });
});
test('manufacturing settings inherit without changing nominal mirror datums', () => {
  const r = recipe(), nominal = frames(r), plain = cutSlots(r);
  for (const cornerStyle of ['corner', 'loop', 'backarc'] as const) {
    r.groups![0].burn = .15; r.groups![0].cornerStyle = cornerStyle;
    const slots = resolvedSlots(r);
    assert.equal(slots[1].burn, .15); assert.equal(slots[1].cornerStyle, cornerStyle);
    assert.deepEqual(frames(r), nominal); assert.notDeepEqual(cutSlots(r), plain);
  }
});
test('body edge is an infinite axis, not a finite reflection segment', () => {
  const r = recipe(); r.helpers = []; r.base = [rect(0, 20, 100, 50), rect(0, -70, 100, 50), rect(200, 0, 10, 10)];
  r.slots[1].mirror!.axis = { kind: 'edge', edge: '2:0:0' };
  const [p, m] = frames(r); point(m.a, { x: p.a.x, y: -p.a.y }); point(m.edge.normal, { x: 0, y: -1 });
  assert.equal(resolvedSlots(r)[1].projection!.edge, '1:2:2'); assert.ok(cutSlots(r).length);
});
test('missing, curved, off-body, wrong-normal and finite-too-short destinations reject without clamping', () => {
  let r = recipe(); r.slots[1].mirror!.axis = { kind: 'edge', edge: 'missing' }; assert.throws(() => frames(r), /Projektionskante/);
  r = recipe(); r.slots[1].mirror!.axis = { kind: 'edge', edge: '0:0:0' }; assert.throws(() => frames(r), /Körperkante/);
  r = recipe(); r.slots[1].mirror!.axis = { kind: 'helper', helperId: 'missing' }; assert.throws(() => parse(r), /Hilfslinie/);
  r = recipe(); r.slots[1].mirror!.slotId = 'missing'; assert.throws(() => parse(r), /Schnitt fehlt/);
  r = recipe(); r.base[0].nodes[1].cout = { x: 80, y: 20 }; r.slots[1].mirror!.axis = { kind: 'edge', edge: '0:1:1' };
  assert.throws(() => frames(r), /Projektionskante/);
  r = recipe(); r.base = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 72, y: 0 }, { x: 100, y: 20 }, { x: 100, y: 100 }, { x: 0, y: 100 }] }];
  r.helpers![0].second = { kind: 'vertex', sub: 0, node: 3 }; // axis x=50, reflected mouth [70,80], straight ends at 72.
  assert.throws(() => frames(r), /Körperkante/);
  r = recipe(); r.helpers![0].first = { kind: 'slot', slotId: 'p', point: 'end' }; r.helpers![0].second = { kind: 'vertex', sub: 0, node: 1 };
  r.groups![0].width = 20; r.slots[0].projection!.distance = 80;
  assert.throws(() => frames(r), /Körperkante/);
});
test('mirror cycles, mixed slot/helper cycles, non-projection parent and own overrides reject', () => {
  let r = recipe(); r.slots[1].mirror!.slotId = 'm'; assert.throws(() => parse(r), /Kreisförmige/);
  assert.throws(() => effectiveSlotGroup(r, r.slots[1]), /Kreisförmige/);
  r = recipe(); r.slots.push(mirror('chain', 'm')); r.slots[1].mirror!.slotId = 'chain'; assert.throws(() => parse(r), /Kreisförmige/);
  r = recipe(); r.helpers![0].first = { kind: 'slot', slotId: 'm', point: 'start' }; assert.throws(() => parse(r), /Kreisförmige/);
  r = recipe(); r.slots[0].projection!.origin = { kind: 'slot', slotId: 'm', point: 'start' }; assert.throws(() => parse(r), /Kreisförmige/);
  r = recipe(); delete r.slots[0].projection; assert.throws(() => parse(r), /Projektionskante/);
  for (const override of [{ groupId: 'g' }, { anchor: { contour: 0, fraction: .1, reference: 'curve' as const } }, { projection: parent().projection }]) {
    r = recipe(); Object.assign(r.slots[1], override); assert.throws(() => parse(r), /Spiegelreferenz/);
  }
});
test('duplicate reflection rejects explicitly even with manufacturing correction', () => {
  const r = recipe(); r.slots[0].projection!.distance = 50;
  for (const cornerStyle of ['corner', 'loop', 'backarc'] as const) {
    r.groups![0].cornerStyle = cornerStyle; r.groups![0].burn = .1;
    assert.throws(() => cutSlots(r), /doppelten Ausschnitt/);
  }
});
test('JSON roundtrip, adoption, source data and repeated evaluations stay immutable', () => {
  const r = recipe(), saved = JSON.stringify(r), restored = parse(r);
  assert.deepEqual(restored, r); assert.deepEqual(cutSlots(restored), cutSlots(r));
  resolvedFeatureGeometry(r); effectiveSlot(r, r.slots[1]);
  const adopted = adoptSlotFeatureRecipe(r); assert.equal(adopted.slots[1].groupId, undefined);
  assert.equal(JSON.stringify(r), saved);
  assert.equal(SLOT_GENERATOR, 'slot-placement-mirrors'); assert.equal(FEATURE_SLOT_GENERATOR, 'slot-placement-features');
  for (const id of [SLOT_GENERATOR, FEATURE_SLOT_GENERATOR, 'slot-placement-projection', 'slot-placement-contour', 'slot-placement']) assert.ok(isSlotGenerator(id));
});
test('mirror reference definitions and existing serialized work budgets are enforced', () => {
  for (const definition of [null, {}, { slotId: 'p' }, { slotId: 'p', axis: { kind: 'other' } }, { slotId: 'p', axis: { kind: 'helper', helperId: 'x'.repeat(101) } }]) {
    const r = recipe(); r.slots[1].mirror = definition as SlotMirror; assert.throws(() => parse(r));
  }
  const r = recipe(); r.slots = Array.from({ length: 129 }, (_, i) => mirror(`m${i}`)); assert.throws(() => parse(r), /Schlitzdefinition/);
});
test('preview visibility filters cutters only: hidden parents and helpers still resolve and validate', () => {
  const r = recipe(), visible = new Set(['m']);
  assert.ok(cutSlots(r, visible).length); assert.notDeepEqual(cutSlots(r, visible), cutSlots(r));
  assert.deepEqual(cutSlots(r, new Set()), cutSlots({ ...r, slots: [], helpers: [] }));
  r.slots[1].mirror!.slotId = 'missing'; assert.throws(() => cutSlots(r, new Set()), /Schnitt fehlt/);
});
console.log(`Slot mirror engine: ${passed} passed.`);
