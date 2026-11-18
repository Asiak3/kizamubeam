// Zoom and pan of a generator dialog's drawing surface (#411): npm run test:surface-view
import assert from 'node:assert/strict';
import { MAX_ZOOM, drawSize, fitFrame, panBy, viewFit, zoomAt, type Fit, type UserView } from '../src/generators/surfaceView';

let checks = 0;
const test = (name: string, fn: () => void) => {
  fn();
  checks++;
  console.log('PASS ' + name);
};
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const frame = { x0: -10, y0: -10, x1: 310, y1: 210 };
const W = 600, H = 400;
const toMm = (f: Fit, px: number, py: number) => [(px - f.ox) / f.k, (py - f.oy) / f.k];
const some = (v: UserView | null): UserView => {
  assert.ok(v, 'a view');
  return v;
};
/** The frame on screen (px) */
const onScreen = (f: Fit) => ({ l: f.ox + frame.x0 * f.k, r: f.ox + frame.x1 * f.k, t: f.oy + frame.y0 * f.k, b: f.oy + frame.y1 * f.k });

test('untouched, the frame is fitted as before (92 % of the width, 90 % of the height, centred)', () => {
  const f = viewFit(null, frame, W, H);
  near(f.k, Math.min((W * 0.92) / 320, (H * 0.9) / 220));
  near(f.ox + 150 * f.k, W / 2);
  near(f.oy + 100 * f.k, H / 2);
  assert.deepEqual(f, fitFrame(frame, W, H));
});

test('zooming in keeps the mm under the pointer where they are', () => {
  const before = viewFit(null, frame, W, H);
  const [x, y] = toMm(before, 323, 177);
  const v = some(zoomAt(null, frame, W, H, 2.5, 323, 177));
  const after = viewFit(v, frame, W, H);
  near(after.k, before.k * 2.5);
  const [x2, y2] = toMm(after, 323, 177);
  near(x2, x);
  near(y2, y);
});

test('the fitted drawing is the smallest view: zooming out back to it leaves no view (the fit button hides)', () => {
  const k = fitFrame(frame, W, H).k;
  assert.equal(zoomAt(null, frame, W, H, 0.5, 10, 10), null);
  const v = some(zoomAt(null, frame, W, H, 3, 200, 100));
  assert.equal(zoomAt(v, frame, W, H, 1 / 3, 200, 100), null);
  assert.equal(zoomAt(v, frame, W, H, 0.01, 500, 300), null);
  // At most MAX_ZOOM times the fitted scale
  let w = some(zoomAt(null, frame, W, H, 1000, 300, 200));
  near(w.k, k * MAX_ZOOM);
  w = some(zoomAt(w, frame, W, H, 2, 300, 200));
  near(w.k, k * MAX_ZOOM);
  // A broken factor changes nothing
  assert.equal(zoomAt(null, frame, W, H, NaN, 10, 10), null);
});

test('panning moves the drawing by the pixels the pointer moved, inside the limits', () => {
  const v = some(zoomAt(null, frame, W, H, 3, 200, 100));
  const a = viewFit(v, frame, W, H);
  const b = viewFit(some(panBy(v, frame, W, H, 40, -25)), frame, W, H);
  near(b.k, a.k);
  near(b.ox - a.ox, 40);
  near(b.oy - a.oy, -25);
  const c = viewFit(some(panBy(v, frame, W, H, NaN, 5)), frame, W, H);
  near(c.ox, a.ox);
});

test('the frame cannot be moved away: its edges stop at the fitted margin', () => {
  const v = some(zoomAt(null, frame, W, H, 3, 300, 200));
  for (const [dx, dy] of [[1e5, 0], [-1e5, 0], [0, 1e5], [0, -1e5], [1e5, 1e5]]) {
    const s = onScreen(viewFit(some(panBy(v, frame, W, H, dx, dy)), frame, W, H));
    assert.ok(s.l <= W * 0.04 + 1e-6 && s.r >= W * 0.96 - 1e-6, `x ${s.l} … ${s.r}`);
    assert.ok(s.t <= H * 0.05 + 1e-6 && s.b >= H * 0.95 - 1e-6, `y ${s.t} … ${s.b}`);
  }
  // Pulled to the right as far as it goes: the left edge at the margin
  near(onScreen(viewFit(some(panBy(v, frame, W, H, 1e5, 0)), frame, W, H)).l, W * 0.04);
  // Fitted, there is nothing to move
  assert.equal(panBy(null, frame, W, H, 80, 50), null);
});

test('along an axis where the zoomed frame is still smaller than the surface, it stays in the middle', () => {
  // A wide surface: the height limits the fit, the frame leaves room left and right
  const w = 1200;
  const v = some(zoomAt(null, frame, w, H, 1.3, 100, 200));
  const f = viewFit(v, frame, w, H);
  assert.ok(320 * f.k < w * 0.92);
  near(f.ox + 150 * f.k, w / 2);
  const g = viewFit(some(panBy(v, frame, w, H, 300, 0)), frame, w, H);
  near(g.ox, f.ox);
});

test('a chosen view holds its scale and middle when the frame or the surface changes', () => {
  const v = some(zoomAt(null, frame, W, H, 2, 250, 150));
  const big = { x0: -100, y0: -100, x1: 900, y1: 700 };
  const a = viewFit(v, big, W, H);
  near(a.k, v.k);
  const [cx, cy] = toMm(a, W / 2, H / 2);
  near(cx, v.cx);
  near(cy, v.cy);
  // A somewhat larger dialog: the same point stays in the middle, at the same scale
  const b = viewFit(v, frame, 700, 480);
  near(b.k, v.k);
  const [cx2, cy2] = toMm(b, 350, 240);
  near(cx2, v.cx);
  near(cy2, v.cy);
  // A much larger one: never smaller than fitted, the frame kept in
  const c = viewFit(v, frame, 2400, 1600);
  near(c.k, fitFrame(frame, 2400, 1600).k);
});

test('draw is told the surface times the zoom, so a plugin fitting its frame gets the shown scale', () => {
  assert.deepEqual(drawSize(null, frame, W, H), { width: W, height: H });
  assert.deepEqual(drawSize(null, null, 600.4, 399.6), { width: 600, height: 400 });
  for (const z of [1.2, 1.7, 4, 25]) {
    const v = some(zoomAt(null, frame, W, H, z, 100, 100));
    const s = drawSize(v, frame, W, H);
    // What the box composer does with the size (plugins/box-composer/src/surface.ts)
    const k = Math.min((0.92 * s.width) / (frame.x1 - frame.x0), (0.9 * s.height) / (frame.y1 - frame.y0));
    near(k / v.k, 1, 0.01);
  }
});

console.log(`${checks} checks passed`);
