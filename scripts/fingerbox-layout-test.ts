import { strict as assert } from 'node:assert';
import { fingerboxParts, fingerboxSegments, type FingerboxParams } from '../src/generators/fingerbox-experiment';
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
assert.equal(fingerboxSegments(100, 30), 3);
assert.equal(fingerboxSegments(100, 24), 3);
assert.equal(fingerboxSegments(100, 10), 9);
assert.equal(fingerboxSegments(10, 100), 3);
const params: FingerboxParams = { width: 300, depth: 200, height: 100, thickness: 6, finger: 20 };
const open = fingerboxParts(params);
assert.deepEqual(open.map((p) => p.key), ['bottom', 'front', 'back', 'left', 'right']);
assert.deepEqual(open.map((p) => p.at), [{ x: 150, y: 100 }, { x: 460, y: 50 }, { x: 770, y: 50 }, { x: 100, y: 260 }, { x: 310, y: 260 }]);
for (const part of [...open, ...fingerboxParts({ ...params, top: 'closed' })]) {
  assert.equal(part.subs.length, 1); assert.equal(part.subs[0].closed, true);
  const nodes = part.subs[0].nodes;
  assert.ok(nodes.length >= 4);
  nodes.forEach((point, i) => {
    const next = nodes[(i + 1) % nodes.length];
    near(Math.min(Math.abs(point.x - next.x), Math.abs(point.y - next.y)), 0);
    assert.ok(Math.hypot(point.x - next.x, point.y - next.y) > 1e-7);
  });
}
const closed = fingerboxParts({ ...params, top: 'closed' });
assert.deepEqual(closed.map((p) => p.key), ['bottom', 'front', 'back', 'top', 'left', 'right']);
assert.deepEqual(closed[0].subs, closed[3].subs);
assert.throws(() => fingerboxParts({ width: 10, depth: 10, height: 10, thickness: 5, finger: 1 }));
assert.throws(() => fingerboxParts({ width: 100, depth: 80, height: 50, thickness: 3, finger: 0 }));
console.log('ok   Fingerbox: geometria ortogonal, tapa y entradas');