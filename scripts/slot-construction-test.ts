import assert from 'node:assert/strict';
import type { Pt, SubPath } from '../src/model';
import type { SlotOrigin } from '../src/straightSlots';
import type { SlotConstructionLine } from '../src/slotConstruction';

// The offline harness intentionally does not start the application.
Object.assign(globalThis, {
  localStorage: { getItem: () => 'de' },
  document: { documentElement: { lang: '' } },
});
const { resolveConstructionLine: resolve, resolveConstructionIntersection: intersection } = await import('../src/slotConstruction');
const square = (): SubPath => ({ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
const helper: SlotConstructionLine = { id: 'h', first: { kind: 'vertex', sub: 0, node: 0 }, second: { kind: 'vertex', sub: 0, node: 1 }, edge: '0:0:0' };
const points = (ref: SlotOrigin): Pt => {
  if (ref.kind !== 'vertex') throw Error('Unexpected origin');
  return ref.node === 0 ? { x: 0, y: 0 } : { x: 10, y: 0 };
};
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
let tests = 0;
function test(name: string, run: () => void) { run(); tests++; console.log(`ok ${tests} - ${name}`); }

test('straight intersections, midpoint, perpendicular and immutable inputs/results', () => {
  const base = [square()], saved = JSON.stringify([base, helper]);
  const line = resolve(base, helper, 30, points);
  assert.deepEqual(line.point, { x: 5, y: 0 });
  assert.deepEqual(line.direction, { x: -0, y: 1 });
  assert.deepEqual(line.intersections.map(i => i.point), [{ x: 5, y: 0 }, { x: 5, y: 10 }]);
  const ref = line.intersections[1].origin;
  assert.deepEqual(ref, { kind: 'intersection', helperId: 'h', sub: 0, segment: 2, root: 0, count: 1 });
  const result = intersection(line, ref); result.x = 123;
  assert.equal(line.intersections[1].point.x, 5);
  assert.equal(JSON.stringify([base, helper]), saved);
});

test('three exact cubic roots in original segment order', () => {
  const curve: SubPath = { closed: false, nodes: [
    { x: 4.2, y: 20, cout: { x: 6.4, y: 20 + 10 / 3 } },
    { x: 5.8, y: 30, cin: { x: 3.6, y: 30 - 10 / 3 } },
  ] };
  const line = resolve([square(), curve], helper, 30, points);
  const hits = line.intersections.filter(i => i.origin.sub === 1);
  assert.equal(hits.length, 3);
  hits.forEach((hit, root) => {
    near(hit.point.x, 5); near(hit.point.y, [22, 25, 28][root]);
    assert.equal(hit.origin.segment, 0); assert.equal(hit.origin.root, root); assert.equal(hit.origin.count, 3);
    assert.deepEqual(intersection(line, hit.origin), hit.point);
  });
  assert.throws(() => intersection(line, { ...hits[0].origin, count: 2 }), /nicht mehr eindeutig/);
});

test('infinite line reaches far beyond part bounds without an artificial ray', () => {
  const far: SubPath = { closed: false, nodes: [{ x: -100, y: 1e12 }, { x: 100, y: 1e12 }] };
  const line = resolve([square(), far], helper, 30, points);
  const hit = line.intersections.find(i => i.origin.sub === 1)!;
  near(hit.point.x, 5); assert.equal(hit.point.y, 1e12);
});

test('arbitrary orientation uses edge tangent, not selected point direction', () => {
  const rotate = (p: Pt): Pt => ({ x: 100 + p.x * 0.6 - p.y * 0.8, y: -30 + p.x * 0.8 + p.y * 0.6 });
  const sp = square(); sp.nodes = sp.nodes.map(rotate);
  const line = resolve([sp], helper, 30, ref => rotate(ref.kind === 'vertex' && ref.node === 0 ? { x: 2, y: 4 } : { x: 8, y: 2 }));
  near(line.direction.x, -0.8); near(line.direction.y, 0.6);
  near(line.point.x, rotate({ x: 5, y: 3 }).x); near(line.point.y, rotate({ x: 5, y: 3 }).y);
});

test('closed contour vertex duplicates have a deterministic original owner', () => {
  const diamond: SubPath = { closed: true, nodes: [{ x: 5, y: 20 }, { x: 10, y: 25 }, { x: 5, y: 30 }, { x: 0, y: 25 }] };
  const hits = resolve([square(), diamond], helper, 30, points).intersections.filter(i => i.origin.sub === 1);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map(i => i.origin.segment), [0, 1]);
  assert.deepEqual(hits.map(i => i.point), [{ x: 5, y: 20 }, { x: 5, y: 30 }]);
});

test('tangent cubic and coincident straight/curved segments explicitly reject', () => {
  const tangent: SubPath = { closed: false, nodes: [
    { x: 5.25, y: 20, cout: { x: 5 - 1 / 12, y: 23 } },
    { x: 5.25, y: 30, cin: { x: 5 - 1 / 12, y: 27 } },
  ] };
  const coincident: SubPath = { closed: false, nodes: [{ x: 5, y: 20 }, { x: 5, y: 30 }] };
  assert.throws(() => resolve([square(), tangent], helper, 30, points), /tangential/);
  assert.throws(() => resolve([square(), coincident], helper, 30, points), /zusammen/);
  coincident.nodes[0].cout = { x: 5, y: 22 };
  assert.throws(() => resolve([square(), coincident], helper, 30, points), /zusammen/);
  const touch: SubPath = { closed: true, nodes: [{ x: 5, y: 20 }, { x: 8, y: 25 }, { x: 9, y: 20 }] };
  assert.throws(() => resolve([square(), touch], helper, 30, points), /tangential/);
});

test('vanished intersection and invalid references cannot silently rebind', () => {
  const line = resolve([square()], helper, 30, points), ref = line.intersections[0].origin;
  for (const changed of [{ helperId: 'other' }, { sub: 9 }, { segment: 99 }, { root: 1 }, { count: 2 }, { sub: -1 }, { segment: 0.5 }])
    assert.throws(() => intersection(line, { ...ref, ...changed }));
  const moved = resolve([square()], helper, 30, r => r.kind === 'vertex' && r.node === 0 ? { x: 20, y: 0 } : { x: 30, y: 0 });
  assert.equal(moved.intersections.length, 0);
  assert.throws(() => intersection(moved, ref), /nicht mehr eindeutig/);
});

test('callbacks resolve live parent slot and helper dependencies every time', () => {
  let offset = 0, calls = 0;
  const dependent: SlotConstructionLine = { ...helper, first: { kind: 'slot', slotId: 's', point: 'center' }, second: {
    kind: 'intersection', helperId: 'parent', sub: 0, segment: 0, root: 0, count: 1,
  } };
  const callback = (ref: SlotOrigin): Pt => { calls++; return { x: offset + (ref.kind === 'slot' ? 2 : 4), y: 7 }; };
  const base = [square()];
  assert.equal(resolve(base, dependent, 30, callback).point.x, 3);
  offset = 2;
  assert.equal(resolve(base, dependent, 30, callback).point.x, 5);
  assert.equal(calls, 4);
});

test('coincident selected points, invalid edges, nonfinite geometry and work bounds reject', () => {
  assert.throws(() => resolve([square()], helper, 30, () => ({ x: 1, y: 1 })), /verschieden/);
  assert.throws(() => resolve([square()], { ...helper, edge: 'missing' }, 30, points), /Projektionskante/);
  assert.throws(() => resolve([square()], helper, 30, () => ({ x: NaN, y: 0 })), /Ungültige/);
  assert.throws(() => resolve([square()], { ...helper, first: { kind: 'vertex', sub: -1, node: 0 } }, 30, points), /Ungültige/);
  assert.throws(() => resolve([square()], helper, 0, points), /Eckenwinkel/);
  const bad = square(); bad.nodes[0].cout = { x: Infinity, y: 0 };
  assert.throws(() => resolve([bad], helper, 30, points), /Ungültige/);
  assert.throws(() => resolve([{ closed: false, nodes: Array.from({ length: 10001 }, () => ({ x: 0, y: 0 })) }], helper, 30, points), /Arbeitsgrenze/);
});
console.log(`${tests} slot construction tests passed`);
