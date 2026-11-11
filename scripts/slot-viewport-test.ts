// Run: node scripts/run-ts.mjs scripts/slot-viewport-test.ts
import assert from 'node:assert/strict';
import type { Pt } from '../src/model';
import { SlotViewport, SLOT_VIEWPORT_MIN_SCALE, SLOT_VIEWPORT_MAX_SCALE } from '../src/slotViewport';

let n = 0;
const test = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log('ok', name);
};
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const pointNear = (a: Pt, b: Pt) => { near(a.x, b.x); near(a.y, b.y); };
const finite = (v: SlotViewport) => {
  for (const x of [v.scale, v.ox, v.oy, ...Object.values(v.toScreen({ x: 2, y: -3 })), ...Object.values(v.toWorld({ x: 2, y: -3 }))]) assert.ok(Number.isFinite(x));
};

test('fit respects padding and centers source geometry without mutation', () => {
  const points = [{ x: -20, y: 10 }, { x: 80, y: 60 }];
  const before = JSON.stringify(points);
  const v = new SlotViewport();
  assert.equal(v.initialized, false);
  v.fit(points, 400, 200, 30);
  assert.equal(v.initialized, true);
  near(v.scale, 2.8);
  pointNear(v.toScreen({ x: 30, y: 35 }), { x: 200, y: 100 });
  for (const p of points) {
    const s = v.toScreen(p);
    assert.ok(s.x >= 30 && s.x <= 370 && s.y >= 30 && s.y <= 170);
    pointNear(v.toWorld(s), p);
  }
  v.pan(15, -20);
  v.zoom(2, { x: 50, y: 70 });
  assert.equal(JSON.stringify(points), before);
});

test('zoom keeps cursor anchor fixed and pan uses screen pixels', () => {
  const v = new SlotViewport();
  v.fit([{ x: 0, y: 0 }, { x: 100, y: 50 }], 500, 300);
  const anchor = { x: 81, y: 207 };
  const world = v.toWorld(anchor);
  for (const factor of [2, 0.7, 100, 0.001]) {
    v.zoom(factor, anchor);
    pointNear(v.toScreen(world), anchor);
  }
  const before = v.toScreen(world);
  const scale = v.scale;
  v.pan(21, -35);
  pointNear(v.toScreen(world), { x: before.x + 21, y: before.y - 35 });
  assert.equal(v.scale, scale);
});

test('resize preserves manually positioned center and scale, not a new fit', () => {
  const v = new SlotViewport();
  v.fit([{ x: 0, y: 0 }, { x: 100, y: 50 }], 400, 200);
  v.zoom(3, { x: 50, y: 90 });
  v.pan(-72, 39);
  const center = v.toWorld({ x: 200, y: 100 });
  const scale = v.scale;
  v.resize(400, 200, 650, 350);
  pointNear(v.toWorld({ x: 325, y: 175 }), center);
  assert.equal(v.scale, scale);
  v.resize(650, 350, 400, 200);
  pointNear(v.toWorld({ x: 200, y: 100 }), center);
});

test('zoom clamps both bounds without anchor drift', () => {
  const v = new SlotViewport();
  const anchor = { x: 12, y: -17 };
  const world = v.toWorld(anchor);
  for (const [factor, expected] of [[Number.MAX_VALUE, SLOT_VIEWPORT_MAX_SCALE], [Number.MIN_VALUE, SLOT_VIEWPORT_MIN_SCALE], [Number.MAX_VALUE, SLOT_VIEWPORT_MAX_SCALE]]) {
    v.zoom(factor, anchor);
    assert.equal(v.scale, expected);
    pointNear(v.toScreen(world), anchor);
  }
});

test('empty, point, line, tiny viewport and huge extents stay finite', () => {
  const v = new SlotViewport();
  v.fit([], 100, 100);
  assert.equal(v.initialized, false);
  for (const points of [
    [{ x: 5, y: 7 }],
    [{ x: 5, y: -10 }, { x: 5, y: 100 }],
    [{ x: -10, y: 7 }, { x: 100, y: 7 }],
    [{ x: -Number.MAX_VALUE, y: 0 }, { x: Number.MAX_VALUE, y: 0 }],
    [{ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: Number.MIN_VALUE }],
  ]) {
    for (const size of [1, 0.1, 500]) {
      v.fit(points, size, size);
      finite(v);
      assert.ok(v.scale >= SLOT_VIEWPORT_MIN_SCALE && v.scale <= SLOT_VIEWPORT_MAX_SCALE);
    }
  }
  v.fit([{ x: 5, y: 7 }], 100, 80);
  pointNear(v.toScreen({ x: 5, y: 7 }), { x: 50, y: 40 });
});

test('invalid inputs do not poison state or conversions', () => {
  const v = new SlotViewport();
  v.fit([{ x: NaN, y: 0 }, { x: 10, y: 20 }, { x: Infinity, y: 3 }], 100, 100);
  pointNear(v.toScreen({ x: 10, y: 20 }), { x: 50, y: 50 });
  const before = { ...v };
  for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
    v.fit([{ x: 0, y: 0 }], bad, 100);
    v.fit([{ x: 0, y: 0 }], 100, bad);
    v.resize(100, 100, bad, 100);
    v.resize(bad, 100, 100, 100);
    v.zoom(bad, { x: 20, y: 20 });
  }
  v.fit([{ x: NaN, y: Infinity }], 100, 100);
  v.pan(NaN, 3);
  v.pan(3, Infinity);
  v.zoom(2, { x: NaN, y: 0 });
  assert.deepEqual({ ...v }, before);
  for (const p of [{ x: NaN, y: Infinity }, { x: Number.MAX_VALUE, y: -Number.MAX_VALUE }]) {
    for (const value of [...Object.values(v.toScreen(p)), ...Object.values(v.toWorld(p))]) assert.ok(Number.isFinite(value));
  }
  for (const pad of [NaN, Infinity, -10, 1e6]) {
    v.fit([{ x: 0, y: 0 }, { x: 20, y: 30 }], 100, 100, pad);
    finite(v);
  }
});

console.log(`${n} Tests bestanden`);
