import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { makeDividers } from '../src/generators/fingerbox-dividers';
import { buildGen, defaultParams, getGenerator } from '../src/generators/index';
const params = { width: 300, depth: 200, height: 100, thickness: 6, finger: 20, dividerHeight: 90, compartmentsX: 3, compartmentsY: 2, ratiosX: '33mm:50mm*2:1', ratiosY: '1:1' };
const result = makeDividers(params);
assert.deepEqual(result.gapsX, [33, 100, 143]);
assert.deepEqual(result.gapsY, [91, 91]);
assert.deepEqual(result.dividers.map((d) => d.key), ['divx-1', 'divx-2', 'divy-1']);
assert.ok(result.holes.bottom.length > 0);
assert.ok(result.holes.front.length > 0 && result.holes.back.length > 0);
for (const divider of result.dividers) {
  assert.equal(divider.outline.closed, true);
  const points = divider.outline.nodes;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length];
    assert.ok(Math.abs(p.x - q.x) < 1e-7 || Math.abs(p.y - q.y) < 1e-7);
    assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 1e-7);
  });
}
assert.throws(() => makeDividers({ ...params, dividerHeight: 1 }));
assert.throws(() => makeDividers({ ...params, top: 'closed', dividerHeight: 99 }));
assert.doesNotThrow(() => makeDividers({ ...params, top: 'closed', dividerHeight: 90 }));
const generator = getGenerator('box-divided')!;
const built = buildGen(generator, { ...defaultParams(generator), ...params, dividerDrop: 10, top: 'closed' });
assert.equal(built.parts.length, 9);
assert.equal(built.parts.find((p) => p.shape.part === 'bottom')!.shape.subs.length, 1 + result.holes.bottom.length);
console.log('ok   Fingerbox: divisores, ranuras, distribuciones y limites');