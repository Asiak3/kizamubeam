import { strict as assert } from 'node:assert';
import { resolveImageContour } from '../src/imageContour';
import type { ImageShape } from '../src/model';
import { apply, type Mat } from '../src/mat';

const image: ImageShape = { kind: 'image', asset: 'original', w: 100, h: 60,
  pxW: 100, pxH: 60, adjust: {} as ImageShape['adjust'], edit: { cornerRadii: [2, 2, 2, 2] } };
let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); console.log(`ok ${name}`); }
  catch (e) { failures++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}
test('numerically duplicate intersections do not erase rounding', () => {
  const s: ImageShape = { ...image, edit: { ...image.edit, order: 'perspectiveFirst', perspective: [
    { x: -1, y: 0 }, { x: 52, y: 0 }, { x: 100, y: 60 }, { x: -2, y: 60 }] } };
  for (const m of [[1, 0, 0, 1, 0, 0], [2, .3, .7, 1.5, 13, -8], [-1, 0, 0, 1, 100, 0]] as Mat[]) {
    const result = resolveImageContour(s, m);
    assert.ok(result.ok);
    assert.equal(result.contour.corners.length, 4);
    assert.ok(result.contour.corners.every(c => c.radius > 1));
    assert.equal(result.contour.contains(apply(m, .5, .5)), false);
  }
});
test('acute nonsingular shear limits radii instead of rejecting geometry', () => {
  const result = resolveImageContour(image, [1e-6, 0, 100, 1e-6, 0, 0]);
  assert.ok(result.ok);
  assert.equal(result.contour.limited, true);
  assert.ok(result.contour.corners.every(c => c.radius > 0 && Number.isFinite(c.radius)));
});
if (failures) process.exitCode = 1;
