import { strict as assert } from 'node:assert';
import { resolveImageContour } from '../src/imageContour';
import type { ImageShape } from '../src/model';
import { apply, type Mat } from '../src/mat';

const image = (edit: unknown = {}): ImageShape => ({ kind: 'image', asset: 'original', w: 100, h: 60,
  pxW: 100, pxH: 60, adjust: {} as ImageShape['adjust'], edit: edit as ImageShape['edit'] });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const contour = (s: ImageShape, m?: Mat) => {
  const result = resolveImageContour(s, m);
  assert.ok(result.ok, JSON.stringify(result));
  return result.contour;
};

const rectangle = contour(image({ cornerRadii: [10, 10, 10, 10] }));
assert.equal(rectangle.corners.length, 4);
near(rectangle.corners[0].radius, 10);
near(rectangle.corners[0].start.x, 0); near(rectangle.corners[0].start.y, 10);
near(rectangle.corners[0].end.x, 10); near(rectangle.corners[0].end.y, 0);
assert.equal(rectangle.contains({ x: 0, y: 0 }), false);
assert.equal(rectangle.contains({ x: 10, y: 0 }), true);
assert.equal(rectangle.contains({ x: 3, y: 3 }), true);
assert.equal(rectangle.contains({ x: -1, y: 30 }), false);
const span = rectangle.rowSpan(1)!;
near(span[0], 10 - Math.sqrt(19)); near(span[1], 90 + Math.sqrt(19));
assert.equal(rectangle.rowSpan(-1), null);
for (const [origin, direction] of [[{ x: -10, y: 1 }, { x: 2, y: 0 }],
  [{ x: -10, y: -10 }, { x: 1.3, y: .7 }], [{ x: 50, y: 80 }, { x: 0, y: -1 }]]) {
  const span = rectangle.lineSpan(origin, direction);
  assert.ok(span);
  for (let t = -10; t < 100; t += .37) {
    assert.equal(rectangle.contains({ x: origin.x + direction.x * t, y: origin.y + direction.y * t }),
      t >= span[0] && t <= span[1]);
  }
}

const m: Mat = [2, .3, .7, 1.5, 13, -8];
const transformed = contour(image({ cornerRadii: [5, 8, 10, 2] }), m);
for (const [i, corner] of transformed.corners.entries()) {
  near(corner.radius, [5, 8, 10, 2][i]);
  near(Math.hypot(corner.start.x - corner.center.x, corner.start.y - corner.center.y), corner.radius);
  near(Math.hypot(corner.end.x - corner.center.x, corner.end.y - corner.center.y), corner.radius);
  assert.equal(transformed.contains(corner.vertex), false);
}
const scaled = contour(image({ cornerRadii: [5, 5, 5, 5] }), [4, 0, 0, 2, 0, 0]);
near(scaled.corners[0].radius, 5);
const limited = contour(image({ cornerRadii: [100, 100, 100, 100] }));
assert.equal(limited.limited, true);
near(limited.corners[0].radius, 30);
const enormous = contour(image({ cornerRadii: [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE] }));
near(enormous.corners[0].radius, 30);
assert.equal(enormous.limited, true);

// Full warped diamond intersects the crop rectangle at eight actual visible corners.
const eight = image({ order: 'perspectiveFirst', perspective: [
  { x: 50, y: -20 }, { x: 120, y: 30 }, { x: 50, y: 80 }, { x: -20, y: 30 }],
  cornerRadii: [1, 2, 3, 4, 5, 6, 7, 8] });
const octagon = contour(eight);
assert.equal(octagon.corners.length, 8);
assert.equal(octagon.contains({ x: 0, y: 0 }), false);
assert.equal(octagon.contains({ x: 50, y: 30 }), true);
for (const c of octagon.corners) {
  assert.ok(c.radius > 0);
  for (const p of [c.start, c.end]) assert.ok(octagon.contains(p));
}
// Reflection keeps source contour numbering; radii stay attached to their corners.
const reflected = contour(image({ cornerRadii: [1, 2, 3, 4] }), [-1, 0, 0, 1, 100, 0]);
near(reflected.corners[0].vertex.x, 100); near(reflected.corners[0].radius, 1);
assert.ok(reflected.contains(apply([-1, 0, 0, 1, 100, 0], 50, 30)));
const touching = contour(image({ order: 'perspectiveFirst', perspective: [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 80, y: 60 }, { x: -20, y: 60 }], cornerRadii: [2, 2, 2, 2] }));
assert.equal(touching.corners.length, 4, 'an intersection through an existing vertex must not delete that corner');
assert.ok(touching.contains({ x: 20, y: 10 }));
for (const bad of [[-1], [NaN], [Infinity], Array(9).fill(0), 'bad', null]) {
  assert.equal(resolveImageContour(image({ cornerRadii: bad })).ok, false);
}
const frozen = image({ cornerRadii: Object.freeze([5, 6, 7, 8]) });
Object.freeze(frozen.edit); Object.freeze(frozen);
const json = JSON.stringify(frozen); contour(frozen); assert.equal(JSON.stringify(frozen), json);
console.log('image contour: tangent circles, world millimetres, limiting, eight corners, validation and immutability passed');
