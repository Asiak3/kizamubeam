import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageEditOrder, resolveImageEdits, resetImageCrop, resetImagePerspective } from '../src/imageEdits';
import { createImageGeometry, type ImageQuad } from '../src/imageGeometry';
import { rasterizeImage, resolveImageRasterGeometry } from '../src/imageRaster';
import { EditorImageHandles } from '../src/editor/imageHandles';
import type { ImageShape } from '../src/model';

const P: ImageQuad = [{ x: 2, y: 3 }, { x: 122, y: -1 }, { x: 91, y: 74 }, { x: -7, y: 49 }];
const CROP = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 };
const baseShape = (w: number, h: number, pxW: number, pxH: number, edit?: Record<string, unknown>): ImageShape => {
  const s = { kind: 'image', asset: 'order-fixture', w, h, pxW, pxH, adjust: {} } as unknown as Record<string, unknown>;
  if (edit !== undefined) s.edit = edit;
  return s as unknown as ImageShape;
};
const shape = (edit?: Record<string, unknown>): ImageShape => baseShape(100, 60, 1000, 600, edit);
function resolved(s: ImageShape) {
  const r = resolveImageEdits(s);
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const k of Object.values(v)) freeze(k);
    Object.freeze(v);
  }
  return v;
}

test('legacy default without order is cropFirst and byte-identical', () => {
  const s = shape();
  const before = JSON.stringify(s);
  assert.equal(imageEditOrder(undefined), 'cropFirst');
  assert.equal(imageEditOrder({} as never), 'cropFirst');
  assert.deepEqual(resolved(s).quad, [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]);
  assert.deepEqual(resolved(s).quad, resolved(shape({})).quad);
  assert.equal(resolved(s).order, 'cropFirst');
  assert.equal(JSON.stringify(s), before);
  assert.ok(!Object.hasOwn(s, 'edit'));
  assert.ok(!Object.hasOwn(resetImageCrop(s), 'edit'));
  assert.ok(!Object.hasOwn(resetImagePerspective(s), 'edit'));
});

test('perspectiveFirst crop is an axis-parallel box in the local frame', () => {
  const s = shape({ crop: { ...CROP }, perspective: P.map(p => ({ ...p })), order: 'perspectiveFirst' });
  const r = resolved(s);
  assert.equal(r.order, 'perspectiveFirst');
  assert.deepEqual(r.crop, CROP);
  assert.deepEqual(r.quad, [{ x: 10, y: 12 }, { x: 90, y: 12 }, { x: 90, y: 48 }, { x: 10, y: 48 }]);
  assert.equal(r.quad[0].y, r.quad[1].y);
  assert.equal(r.quad[1].x, r.quad[2].x);
  // Same sampling homography as cropFirst: full original rectangle maps to the perspective quad.
  const full = createImageGeometry(undefined, P);
  assert.ok(full.ok);
  assert.deepEqual(r.geometry.sourceToLocal({ x: 0.5, y: 0.5 }), full.geometry.sourceToLocal({ x: 0.5, y: 0.5 }));
  const fwd = r.geometry.sourceToLocal({ x: 0.5, y: 0.5 });
  assert.ok(fwd);
  const back = r.geometry.localToSource(fwd);
  assert.ok(back && Math.abs(back.x - 0.5) < 1e-9 && Math.abs(back.y - 0.5) < 1e-9);
  // Visible bounds are exactly the crop rectangle.
  const g = resolveImageRasterGeometry(s);
  assert.ok(g.ok, JSON.stringify(g));
  assert.deepEqual(g.bounds, { x: 10, y: 12, width: 80, height: 36 });
  // Same numbers, other order: cropFirst corners follow the projective mapping instead.
  const first = resolved(shape({ crop: { ...CROP }, perspective: P.map(p => ({ ...p })) }));
  assert.notDeepEqual(first.quad, r.quad);
});

const T: ImageQuad = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 3, y: 2 }, { x: 1, y: 2 }];
const tshape = (edit?: Record<string, unknown>): ImageShape => baseShape(4, 2, 8, 4, edit);
const tsource = () => ({ width: 8, height: 4,
  rgba: Uint8ClampedArray.from({ length: 8 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 255 : (Math.floor(i / 4) * 7) % 251)) });
function alphaOf(result: { ok: true; rgba: Uint8ClampedArray }, i: number) {
  assert.ok(result.ok);
  return result.rgba[i * 4 + 3];
}

test('perspectiveFirst raster clips in the output frame, not the source frame', () => {
  const box = { left: 0.75, top: 0.75, right: 1, bottom: 1 };
  const persp = tshape({ crop: { ...box }, perspective: T.map(p => ({ ...p })), order: 'perspectiveFirst' });
  const g = resolveImageRasterGeometry(persp);
  assert.ok(g.ok, JSON.stringify(g));
  assert.deepEqual(g.bounds, { x: 3, y: 1.5, width: 1, height: 0.5 });
  // Box corner (3.5, 1.75) lies outside the trapezoid: transparent under perspectiveFirst …
  const outside = rasterizeImage(tsource(), persp, { width: 2, height: 1 });
  assert.ok(outside.ok, JSON.stringify(outside));
  assert.equal(alphaOf(outside, 0), 0);
  assert.equal(alphaOf(outside, 1), 0);
  // … while the same crop numbers stay visible under cropFirst (source rectangle inside the quad).
  const first = tshape({ crop: { ...box }, perspective: T.map(p => ({ ...p })) });
  const kept = rasterizeImage(tsource(), first, { width: 2, height: 1 });
  assert.ok(kept.ok, JSON.stringify(kept));
  assert.equal(alphaOf(kept, 0), 255);
  // A box fully inside the trapezoid keeps every center.
  const inner = tshape({ crop: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    perspective: T.map(p => ({ ...p })), order: 'perspectiveFirst' });
  const full = rasterizeImage(tsource(), inner, { width: 4, height: 2 });
  assert.ok(full.ok, JSON.stringify(full));
  assert.deepEqual(full.bounds, { x: 1, y: 0.5, width: 2, height: 1 });
  for (let i = 0; i < 8; i++) assert.equal(alphaOf(full, i), 255);
});

const H = EditorImageHandles.prototype as unknown as Record<string, (...a: never[]) => unknown>;
function fakeEditor(obj: { id: number }) {
  const snaps: string[] = [];
  const ed = { doc: { objs: [obj] }, sel: [obj], snaps, emit() {}, snapshot(m: string) { snaps.push(m); return null; } };
  return ed as unknown as { snaps: string[] } & Record<string, unknown>;
}
const objOf = (edit?: Record<string, unknown>) => ({ id: 7, m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: shape(edit) } as unknown as { id: number } & Record<string, unknown>);

test('order switch keeps values, takes no snapshot, applies with exactly one', () => {
  const o = objOf({ crop: { ...CROP }, perspective: P.map(p => ({ ...p })) });
  const ed = fakeEditor(o);
  assert.equal(H.startImageEdit.call(ed, o.id, 'crop'), null);
  assert.equal(H.dragImageCropHandle.call(ed, 'right', { x: 90, y: 25 }, { snap: false }), null);
  H.setImageEditTab.call(ed, 'perspective');
  assert.equal(H.setImagePerspectiveCorner.call(ed, 2, { x: 95, y: 55 }, { snap: false }), null);
  H.setImageEditTab.call(ed, 'crop');
  const d = H.imageDraft.call(ed) as { crop: unknown; quad: unknown; order: unknown };
  assert.equal(d.order, 'cropFirst');
  const kept = JSON.stringify({ crop: d.crop, quad: d.quad });
  assert.equal(H.setImageEditOrder.call(ed, 'perspectiveFirst'), null);
  assert.equal(ed.snaps.length, 0);
  const d2 = H.imageDraft.call(ed) as { crop: unknown; quad: unknown; order: unknown };
  assert.equal(d2.order, 'perspectiveFirst');
  assert.equal(JSON.stringify({ crop: d2.crop, quad: d2.quad }), kept);
  assert.equal(H.applyImageDraft.call(ed), null);
  assert.equal(ed.snaps.length, 1);
  const edit = (o.shape as unknown as ImageShape).edit as unknown as Record<string, unknown>;
  assert.equal(edit.order, 'perspectiveFirst');
  assert.deepEqual(edit.crop, d2.crop);
  assert.deepEqual(edit.perspective, d2.quad);
  // … and back: cropFirst drops the order field again, values stay.
  assert.equal(H.startImageEdit.call(ed, o.id, 'crop'), null);
  assert.equal(H.setImageEditOrder.call(ed, 'cropFirst'), null);
  assert.equal(ed.snaps.length, 1);
  assert.equal(H.applyImageDraft.call(ed), null);
  assert.equal(ed.snaps.length, 2);
  const back = (o.shape as unknown as ImageShape).edit as unknown as Record<string, unknown>;
  assert.ok(!Object.hasOwn(back, 'order'));
  assert.deepEqual(back.crop, d2.crop);
  assert.deepEqual(back.perspective, d2.quad);
});

test('unknown order in the draft is rejected without touching values', () => {
  const o = objOf({ crop: { ...CROP }, perspective: P.map(p => ({ ...p })) });
  const ed = fakeEditor(o);
  assert.equal(H.startImageEdit.call(ed, o.id, 'crop'), null);
  const d = H.imageDraft.call(ed) as { crop: unknown; quad: unknown; order: unknown };
  const kept = JSON.stringify({ crop: d.crop, quad: d.quad, order: d.order });
  const err = H.setImageEditOrder.call(ed, 'diagonal');
  assert.ok(typeof err === 'string' && err.length > 0);
  assert.equal(ed.snaps.length, 0);
  const d2 = H.imageDraft.call(ed) as { crop: unknown; quad: unknown; order: unknown };
  assert.equal(JSON.stringify({ crop: d2.crop, quad: d2.quad, order: d2.order }), kept);
  H.cancelImageDraft.call(ed);
});

test('invalid stored order resolves as cropFirst and is never rewritten', () => {
  const edit = { crop: { ...CROP }, perspective: P.map(p => ({ ...p })), order: 'diagonal' };
  const s = freeze(shape(edit));
  const before = JSON.stringify(s);
  assert.equal(imageEditOrder((s as ImageShape).edit as never), 'cropFirst');
  const bad = resolved(s);
  const good = resolved(shape({ crop: { ...CROP }, perspective: P.map(p => ({ ...p })) }));
  assert.equal(bad.order, 'cropFirst');
  assert.deepEqual(bad.quad, good.quad);
  assert.deepEqual(bad.crop, good.crop);
  assert.equal(JSON.stringify(s), before);
  const uncropped = resetImageCrop(s);
  assert.equal((uncropped.edit as unknown as Record<string, unknown>).order, 'diagonal');
  const unwarped = resetImagePerspective(s);
  assert.equal((unwarped.edit as unknown as Record<string, unknown>).order, 'diagonal');
});
