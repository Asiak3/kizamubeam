import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createImageGeometry, type ImageCrop, type ImageQuad } from '../src/imageGeometry';
import { apply, inv, mul, rotate, translate, type Mat } from '../src/mat';

const full: ImageCrop = { left: 0, top: 0, right: 1, bottom: 1 };
const quad: ImageQuad = [{ x: 2, y: 3 }, { x: 12, y: 1 }, { x: 9, y: 14 }, { x: -1, y: 10 }];
const crop: ImageCrop = { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 };
function near(actual: { x: number; y: number } | null, expected: { x: number; y: number }, tolerance = 1e-10) {
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - expected.x) <= tolerance, `x: ${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= tolerance, `y: ${actual.y} != ${expected.y}`);
}
function geometry(c = full, q?: ImageQuad) {
  const result = createImageGeometry(c, q);
  assert.ok(result.ok, JSON.stringify(result));
  return result.geometry;
}

test('defaults are identity and preserve original normalized coordinates', () => {
  const result = createImageGeometry();
  assert.ok(result.ok);
  for (const p of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.37, y: 0.64 }]) {
    near(result.geometry.sourceToLocal(p), p);
    near(result.geometry.localToSource(p), p);
  }
});

test('original crop boundaries map to ordered TL TR BR BL local corners', () => {
  const g = geometry(crop, quad);
  const corners = [{ x: crop.left, y: crop.top }, { x: crop.right, y: crop.top },
    { x: crop.right, y: crop.bottom }, { x: crop.left, y: crop.bottom }];
  corners.forEach((p, i) => {
    near(g.sourceToLocal(p), quad[i]);
    near(g.localToSource(quad[i]), p);
  });
});

test('projective midpoint is not bilinear interpolation', () => {
  const q: ImageQuad = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }];
  near(geometry(full, q).sourceToLocal({ x: 0.5, y: 0.5 }), { x: 2, y: 4 / 3 });
});

test('inverse roundtrips after external rotation, shear and translation', () => {
  const g = geometry(crop, quad);
  const shear: Mat = [1.5, 0.2, 0.4, 0.8, 0, 0];
  const world = mul(translate(41, -27), mul(rotate(0.71), shear));
  const undo = inv(world);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const source = { x: crop.left + (crop.right - crop.left) * i / 10,
      y: crop.top + (crop.bottom - crop.top) * j / 10 };
    const local = g.sourceToLocal(source)!;
    const placed = apply(world, local.x, local.y);
    const restored = apply(undo, placed.x, placed.y);
    near(g.localToSource(restored), source);
  }
});

test('invalid stored crops are rejected, not clamped or defaulted', () => {
  const bad = [null, {}, { ...full, left: NaN }, { ...full, top: Infinity },
    { ...full, left: -0.1 }, { ...full, right: 1.1 }, { ...full, top: -1 },
    { ...full, bottom: 2 }, { ...full, left: 1 }, { ...full, right: 0 },
    { ...full, top: 1 }, { ...full, bottom: 0 }, { ...full, left: '0' }];
  for (const value of bad) assert.deepEqual(createImageGeometry(value as ImageCrop), { ok: false, reason: 'invalid-crop' });
});

test('malformed, crossed, concave and collapsed quads are rejected', () => {
  const bad = [null, [], new Array(4), [quad[0]], [quad[0], quad[1], quad[2], quad[3], quad[0]],
    [quad[0], quad[2], quad[1], quad[3]],
    [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 2 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    [quad[0], quad[0], quad[2], quad[3]],
    [{ x: NaN, y: 0 }, quad[1], quad[2], quad[3]],
    [{ x: 0, y: Infinity }, quad[1], quad[2], quad[3]],
    [{ x: '0', y: 0 }, quad[1], quad[2], quad[3]], [null, quad[1], quad[2], quad[3]]];
  for (const value of bad) assert.deepEqual(createImageGeometry(full, value as ImageQuad), { ok: false, reason: 'invalid-quad' });
});

test('small and large scales remain valid without absolute area thresholds', () => {
  for (const scale of [1e-120, 1e-9, 1, 1e9, 1e120]) {
    const q = quad.map(p => ({ x: p.x * scale, y: p.y * scale })) as ImageQuad;
    const g = geometry(crop, q);
    const p = { x: 0.43, y: 0.61 };
    const local = g.sourceToLocal(p)!;
    near(g.localToSource(local), p);
    q.forEach((corner, i) => {
      const source = [{ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.8, y: 0.9 }, { x: 0.2, y: 0.9 }][i];
      near(g.sourceToLocal(source), corner, scale * 1e-10);
    });
  }
});

test('a reflected convex quad keeps the supplied corner correspondence', () => {
  const q = quad.map(p => ({ x: -p.x, y: p.y })) as ImageQuad;
  const g = geometry(crop, q);
  const source = { x: 0.3, y: 0.7 };
  near(g.localToSource(g.sourceToLocal(source)!), source);
  near(g.sourceToLocal({ x: crop.left, y: crop.top }), q[0]);
});

test('large local offsets and small source crops remain conditioned', () => {
  const q = quad.map(p => ({ x: 1e12 + p.x, y: -1e12 + p.y })) as ImageQuad;
  const c = { left: 0.5, top: 0.4, right: 0.50000001, bottom: 0.40000001 };
  const g = geometry(c, q);
  const p = { x: 0.500000004, y: 0.400000006 };
  near(g.localToSource(g.sourceToLocal(p)!), p, 1e-12);
});

test('construction and mapping neither mutate nor retain mutable inputs', () => {
  const c = { ...crop };
  const q = quad.map(p => ({ ...p })) as ImageQuad;
  const before = JSON.stringify({ c, q });
  const g = geometry(c, q);
  const p = Object.freeze({ x: 0.4, y: 0.6 });
  const expected = g.sourceToLocal(p)!;
  near(g.localToSource(expected), p);
  assert.equal(JSON.stringify({ c, q }), before);
  c.left = 0;
  q[0].x = -1000;
  near(g.sourceToLocal(p), expected);
  geometry(Object.freeze({ ...crop }), Object.freeze(quad.map(p => Object.freeze({ ...p }))) as ImageQuad);
});

test('mapping is not clipping; nonfinite inputs and projective poles return null', () => {
  const g = geometry();
  near(g.sourceToLocal({ x: -1, y: 2 }), { x: -1, y: 2 });
  assert.equal(g.sourceToLocal({ x: NaN, y: 0 }), null);
  assert.equal(g.localToSource({ x: 0, y: Infinity }), null);
  const q: ImageQuad = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }];
  assert.equal(geometry(full, q).sourceToLocal({ x: 0, y: -1 }), null);
});

test('affine shortcut exists for rectilinear quads and matches localToSource exactly', () => {
  const rect: ImageQuad = [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 60 }, { x: 10, y: 60 }];
  const g = geometry(crop, rect);
  assert.ok(g.affine);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const local = { x: 10 + i * 10, y: 20 + j * 4 };
    const expected = g.localToSource(local)!;
    const fast = { x: g.affine[0] * local.x + g.affine[2] * local.y + g.affine[4],
      y: g.affine[1] * local.x + g.affine[3] * local.y + g.affine[5] };
    near(fast, expected, 1e-9);
  }
});

test('affine shortcut is absent for true projective quads', () => {
  const q: ImageQuad = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }];
  assert.equal(geometry(full, q).affine, null);
  assert.equal(geometry(crop, quad).affine, null);
});
