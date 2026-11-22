import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_ADJUST, loadDoc, type ImageShape, type Pt } from '../src/model';
import { resolveImageEdits, resetImageCrop, resetImagePerspective } from '../src/imageEdits';
import { createImageGeometry, type ImageQuad } from '../src/imageGeometry';
import { backingSize, clampPan, clampZoom, fitScale, imageOrigin, panBy, resetZoomView, zoomAtCursor, zoomPercent, ZOOM_MAX, ZOOM_MIN } from '../src/previewZoom';
import { addCornerRadii, clampImageRadius, clampRectRadius, pointerCornerRadius, rectRadiusFromLocal } from '../src/radiusDrag';
import { apply, inv, mul, rotate, translate, type Mat } from '../src/mat';

const crop = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 };
const perspective: ImageQuad = [{ x: 2, y: 3 }, { x: 122, y: -1 }, { x: 91, y: 74 }, { x: -7, y: 49 }];
const image = (): ImageShape => ({ kind: 'image', asset: 'original-fixture', w: 100, h: 60,
  pxW: 1000, pxH: 600, adjust: { ...DEFAULT_ADJUST } });
const edited = (): ImageShape => ({ ...image(), edit: { crop: { ...crop }, perspective } });
function near(actual: Pt | null, expected: Readonly<Pt>) {
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9, `${actual.x} != ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9, `${actual.y} != ${expected.y}`);
}
function resolve(shape: ImageShape) {
  const result = resolveImageEdits(shape);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}
function roundtrip(shape: ImageShape) {
  const doc = loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: 'Fixture', objs: [
    { id: 1, layer: 0, m: [1, 0, 0, 1, 0, 0], shape },
  ] }], page: 0, layers: {} });
  return loadDoc(JSON.parse(JSON.stringify(doc))).objs[0].shape as ImageShape;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('legacy default retains physical bounds, corners and absent serialized edit', () => {
  const shape = image();
  const before = JSON.stringify(shape);
  const result = resolve(shape);
  assert.deepEqual(result.quad, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]);
  near(result.geometry.sourceToLocal({ x: 0.3, y: 0.4 }), { x: 30, y: 24 });
  assert.equal(JSON.stringify(roundtrip(shape)), before);
  assert.equal(Object.hasOwn(shape, 'edit'), false);
  assert.equal(Object.hasOwn(resetImageCrop(shape), 'edit'), false);
  assert.equal(Object.hasOwn(resetImagePerspective(shape), 'edit'), false);
});

test('crop removes ten physical units from each side without stretching', () => {
  const result = resolve({ ...image(), edit: { crop } });
  assert.equal(result.quad[1].x - result.quad[0].x, 80);
  near(result.quad[0], { x: 10, y: 12 });
  near(result.quad[2], { x: 90, y: 48 });
  near(result.geometry.sourceToLocal({ x: 0, y: 0 }), { x: 0, y: 0 });
  near(result.geometry.localToSource({ x: 0, y: 0 }), { x: 0, y: 0 });
});

test('crop corners use the retained full-original projective mapping', () => {
  const result = resolve(edited());
  const full = createImageGeometry(undefined, perspective);
  assert.ok(full.ok);
  const corners = [{ x: crop.left, y: crop.top }, { x: crop.right, y: crop.top },
    { x: crop.right, y: crop.bottom }, { x: crop.left, y: crop.bottom }];
  corners.forEach((p, i) => near(result.quad[i], full.geometry.sourceToLocal(p)!));
  near(full.geometry.sourceToLocal({ x: 0.5, y: 0.5 }), result.geometry.sourceToLocal({ x: 0.5, y: 0.5 })!);
  assert.notDeepEqual(result.quad, perspective);
  const changed = resolve({ ...edited(), edit: { crop: { ...crop, left: 0.3 }, perspective } });
  near(changed.geometry.sourceToLocal({ x: 0.5, y: 0.5 }), result.geometry.sourceToLocal({ x: 0.5, y: 0.5 })!);
});

test('independent resets preserve the other edit, identity and original dimensions', () => {
  const shape = freeze(edited());
  const before = JSON.stringify(shape);
  const uncropped = resetImageCrop(shape);
  const unwarped = resetImagePerspective(shape);
  assert.deepEqual(uncropped.edit, { perspective });
  assert.deepEqual(unwarped.edit, { crop });
  resolve(uncropped).quad.forEach((p, i) => near(p, perspective[i]));
  near(resolve(unwarped).quad[0], { x: 10, y: 12 });
  near(resolve(unwarped).quad[2], { x: 90, y: 48 });
  assert.deepEqual(resetImagePerspective(uncropped), image());
  assert.deepEqual(resetImageCrop(unwarped), image());
  assert.equal(JSON.stringify(shape), before);
  for (const output of [uncropped, unwarped]) {
    assert.notEqual(output, shape);
    for (const key of ['asset', 'w', 'h', 'pxW', 'pxH'] as const) assert.equal(output[key], shape[key]);
  }
});

test('JSON project/loadDoc roundtrip retains original identity and every edit value', () => {
  for (const shape of [edited(), { ...image(), edit: { crop } }, { ...image(), edit: { perspective } }]) {
    assert.deepEqual(roundtrip(shape), shape);
    resolve(roundtrip(shape));
  }
});

test('invalid stored edits are rejected without repairing or mutating model data', () => {
  const cases: [unknown, string][] = [
    [null, 'invalid-edit'], [[], 'invalid-edit'], [3, 'invalid-edit'],
    [{ crop: null }, 'invalid-crop'], [{ crop: {} }, 'invalid-crop'],
    [{ crop: { ...crop, left: NaN } }, 'invalid-crop'],
    [{ crop: { ...crop, top: Infinity } }, 'invalid-crop'],
    [{ crop: { ...crop, left: crop.right } }, 'invalid-crop'],
    [{ crop: { ...crop, right: 1.2 } }, 'invalid-crop'],
    [{ crop: { ...crop, bottom: crop.top } }, 'invalid-crop'],
    [{ perspective: null }, 'invalid-quad'], [{ perspective: [] }, 'invalid-quad'],
    [{ perspective: [perspective[0], perspective[2], perspective[1], perspective[3]] }, 'invalid-quad'],
    [{ perspective: perspective.map(() => ({ x: 0, y: 0 })) }, 'invalid-quad'],
    [{ perspective: [{ x: Infinity, y: 0 }, ...perspective.slice(1)] }, 'invalid-quad'],
  ];
  for (const [edit, reason] of cases) {
    const shape = freeze({ ...image(), edit } as ImageShape);
    const before = structuredClone(shape);
    assert.deepEqual(resolveImageEdits(shape), { ok: false, reason });
    assert.deepEqual(shape, before);
  }
  for (const w of [0, -1, NaN, Infinity]) {
    assert.deepEqual(resolveImageEdits({ ...image(), w }), { ok: false, reason: 'invalid-size' });
  }
  const invalid = { ...image(), edit: { crop: { ...crop, right: 0 } } };
  assert.deepEqual(roundtrip(invalid), invalid);
  assert.deepEqual(resolveImageEdits(roundtrip(invalid)), { ok: false, reason: 'invalid-crop' });
});

test('frozen inputs and resolved mappings remain independent of later input changes', () => {
  resolve(freeze(edited()));
  const shape = structuredClone(edited());
  const result = resolve(shape);
  const point = freeze({ x: 0.34, y: 0.61 });
  const expected = result.geometry.sourceToLocal(point)!;
  shape.edit!.crop = { ...crop, left: 0.5 };
  shape.edit!.perspective = perspective.map(p => ({ x: p.x + 100, y: p.y })) as unknown as ImageQuad;
  near(result.geometry.sourceToLocal(point), expected);
  near(result.geometry.localToSource(expected), point);
  assert.deepEqual(result.crop, crop);
});

test('source/local roundtrip composes with external Mat rotation, shear and translation', () => {
  const result = resolve(edited());
  const shear: Mat = [1.5, 0.2, 0.4, 0.8, 0, 0];
  const world = mul(translate(41, -27), mul(rotate(0.71), shear));
  const undo = inv(world);
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const source = { x: -0.1 + i * 0.12, y: -0.1 + j * 0.12 };
    const local = result.geometry.sourceToLocal(source)!;
    const placed = apply(world, local.x, local.y);
    near(result.geometry.localToSource(apply(undo, placed.x, placed.y)), source);
  }
});

test('Vorschau-Fit: skaliert das Bild vollständig in die Ansicht', () => {
  assert.equal(fitScale(800, 600, 420, 300), 0.5);
  assert.equal(fitScale(100, 100, 420, 300), 3);
  assert.equal(fitScale(0, 100, 420, 300), 1);
});

test('Vorschau-Zoom: klemmt auf 1..8 und meldet Prozent (100 % = Fit)', () => {
  assert.equal(clampZoom(0.2), ZOOM_MIN);
  assert.equal(clampZoom(99), ZOOM_MAX);
  assert.equal(clampZoom(Number.NaN), ZOOM_MIN);
  assert.equal(zoomPercent(resetZoomView()), 100);
  assert.equal(zoomPercent({ z: 2, ox: 0, oy: 0 }), 200);
});

test('Vorschau-Zoom: Bildpunkt unter dem Cursor bleibt unter dem Cursor', () => {
  const view = { z: 1, ox: 0, oy: 0 };
  const cx = 300, cy = 100;
  const before = imageOrigin(800, 600, 420, 300, view);
  const ix = (cx - before.x) / before.scale, iy = (cy - before.y) / before.scale;
  const next = zoomAtCursor(view, cx, cy, 2, 800, 600, 420, 300);
  assert.ok(next.z > view.z);
  const after = imageOrigin(800, 600, 420, 300, next);
  assert.ok(Math.abs((cx - after.x) / after.scale - ix) < 1e-9);
  assert.ok(Math.abs((cy - after.y) / after.scale - iy) < 1e-9);
  assert.deepEqual(zoomAtCursor(next, cx, cy, 1, 800, 600, 420, 300), next);
});

test('Vorschau-Pan: klemmt an den Bildgrenzen, Reset stellt Fit wieder her', () => {
  const view = { z: 2, ox: 0, oy: 0 };
  const moved = panBy(view, 1e6, -1e6, 800, 600, 420, 300);
  const again = panBy(view, 1e6, -1e6, 800, 600, 420, 300);
  assert.deepEqual(moved, again);
  assert.ok(Math.abs(moved.ox) <= 2000 && Math.abs(moved.oy) <= 2000);
  const clamped = clampPan({ z: 2, ox: 1e6, oy: 1e6 }, 800, 600, 420, 300);
  assert.equal(clamped.z, 2);
  assert.ok(clamped.ox > 0 && clamped.oy > 0);
  assert.deepEqual(panBy(view, 0, 0, 800, 600, 420, 300), view);
  assert.deepEqual(resetZoomView(), { z: 1, ox: 0, oy: 0 });
});

test('Vorschau-Backing: DPR 2 und 3 ergeben scharfe Gerätepixel', () => {
  assert.deepEqual(backingSize(420, 300, 2), { w: 840, h: 600 });
  assert.deepEqual(backingSize(420, 300, 3), { w: 1260, h: 900 });
  assert.deepEqual(backingSize(420, 300, Number.NaN), { w: 420, h: 300 });
});

test('Radien: Rechteck klemmt auf 0..min(w,h)/2, Bild verlangt >= 0', () => {
  assert.equal(clampRectRadius(5, 100, 60), 5);
  assert.equal(clampRectRadius(40, 100, 60), 30);
  assert.equal(clampRectRadius(-3, 100, 60), 0);
  assert.equal(clampRectRadius(Number.NaN, 100, 60), 0);
  assert.equal(clampRectRadius(5, 0, 60), 0);
  assert.equal(clampImageRadius(2.5), 2.5);
  assert.equal(clampImageRadius(-1), null);
  assert.equal(clampImageRadius(Number.NaN), null);
});

test('Radien: Zeigerabstand und Formlokal bestimmen den Radius', () => {
  assert.equal(pointerCornerRadius({ x: 3, y: 4 }, { x: 0, y: 0 }), 5);
  assert.equal(pointerCornerRadius({ x: 0, y: 0 }, { x: 0, y: 0 }), 0);
  assert.equal(rectRadiusFromLocal(10, 20, 100, 60), 10);
  assert.equal(rectRadiusFromLocal(-5, 3, 100, 60), 0);
  assert.equal(rectRadiusFromLocal(100, 100, 100, 60), 30);
});

test('Radien: Delta einzeln oder gemeinsam, nie negativ, ein Schritt', () => {
  assert.deepEqual(addCornerRadii([1, 2, 3, 4], 4, 1, 0.5), [1, 2.5, 3, 4]);
  assert.deepEqual(addCornerRadii([1, 2, 3, 4], 4, null, 1), [2, 3, 4, 5]);
  assert.deepEqual(addCornerRadii([0.2, 0, 0, 0], 4, 0, -1), [0, 0, 0, 0]);
  assert.deepEqual(addCornerRadii([1, 1, 1, 1], 4, 9, 5), [1, 1, 1, 1]);
  assert.deepEqual(addCornerRadii([1, 1, 1, 1], 4, null, Number.NaN), [1, 1, 1, 1]);
});
