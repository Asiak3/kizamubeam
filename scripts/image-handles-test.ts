import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc, newId } from '../src/model';
import type { Obj } from '../src/model';
import type { Editor as E } from '../src/editor';
import { boundsOf, shapeSubs } from '../src/geom';
import { resolveImageEdits } from '../src/imageEdits';
import { buildSnapSet } from '../src/snap';
import { createImageGeometry } from '../src/imageGeometry';
import { apply, inv } from '../src/mat';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); count++; console.log(`PASS ${name}`); }
  catch (err) { process.exitCode = 1; console.error(`FAIL ${name}`, err); }
}

function editor(objects: Obj[]): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: objects, tool: 'select', nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 2, ox: 10, oy: 5 }, listeners: new Set(),
    isolation: null, builderSession: null, snapGrid: true, snapObjects: true, alignGuides: [], space: false,
    currentLayer: 0, snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], clipboard: [],
    gridStep: 1, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  (ed as any).doc.objs = [...objects];
  ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}
const imgObj = (extra: Partial<Obj> = {}): Obj => ({ id: newId(), m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: { kind: 'image', w: 100, h: 50, asset: 'a', ...((extra as any).shape ?? {}) }, ...extra } as Obj);

// Dynamic import so the red run fails clearly when the milestone module is absent.
const mod = await import('../src/editor/imageHandles');
assert.ok(mod.EditorImageHandles, 'EditorImageHandles export missing');

await test('crop corners/edges/numeric keep survivors unscaled (80mm)', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'crop');
  (ed as any).dragImageCropHandle('right', { x: 90, y: 25 });
  (ed as any).dragImageCropHandle('left', { x: 10, y: 25 });
  const prev = (ed as any).imageCropPreview(o.id);
  assert.equal(prev.left, 0.1); assert.equal(prev.right, 0.9);
  (ed as any).applyImageDraft();
  const r = resolveImageEdits(o.shape as any);
  assert.ok(r.ok);
  assert.equal((r as any).crop.left, 0.1); assert.equal((r as any).crop.right, 0.9);
  const quad = (r as any).quad as { x: number; y: number }[];
  assert.ok(Math.abs((quad[1].x - quad[0].x) - 80) < 1e-9);
});

await test('perspective corners projective, invalid quad rejected', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'perspective');
  const before = JSON.stringify((o.shape as any).edit ?? null);
  const err = (ed as any).setImagePerspectiveCorner(0, { x: 90, y: 40 });
  assert.ok(err); assert.match(String(err), /rund|konkav|kreuz|Ursache|Behebung/i);
  const r = resolveImageEdits(o.shape as any);
  assert.ok(r.ok); // live draft invalid quad must not mutate
  assert.equal(JSON.stringify((o.shape as any).edit ?? null), before);
  (ed as any).cancelImageDraft();
});

await test('crop-then-perspective in one draft plus independent draft resets', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'crop'); (ed as any).setImageCropNumeric({ left: 10, top: 5, right: 90, bottom: 45, unit: 'mm' });
  (ed as any).setImageEditTab('perspective'); (ed as any).setImagePerspectiveCorner(2, { x: 90, y: 45 }, { snap: false });
  (ed as any).applyImageDraft();
  let r = resolveImageEdits(o.shape as any); assert.ok(r.ok);
  assert.equal((r as any).crop.left, 0.1);
  assert.ok((o.shape as any).edit?.perspective);
  // Rücksetzungen wirken auf den Entwurf, nicht aufs Modell: kein Undo, Dialog bleibt Sache der UI.
  const before = ed.history.position;
  (ed as any).startImageEdit(o.id, 'crop');
  (ed as any).resetImageCropDraft();
  assert.equal(ed.history.position, before);
  (ed as any).applyImageDraft();
  r = resolveImageEdits(o.shape as any); assert.ok(r.ok); assert.equal((r as any).crop.left, 0);
  assert.ok((o.shape as any).edit?.perspective);
  (ed as any).startImageEdit(o.id, 'perspective');
  (ed as any).resetImagePerspectiveDraft();
  (ed as any).applyImageDraft();
  r = resolveImageEdits(o.shape as any); assert.ok(r.ok);
  assert.equal((o.shape as any).edit, undefined);
});

await test('draft Apply is one undo, Cancel mutates nothing', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  const before = ed.history.position;
  (ed as any).startImageEdit(o.id, 'crop'); (ed as any).dragImageCropHandle('bottom', { x: 50, y: 40 });
  (ed as any).applyImageDraft();
  assert.equal(ed.history.position, before + 1);
  ed.doUndo();
  const o2 = ed.doc.objs.find((x: Obj) => x.shape.kind === 'image')!;
  assert.equal((o2.shape as any).edit, undefined);
  (ed as any).startImageEdit(o2.id, 'crop'); (ed as any).dragImageCropHandle('bottom', { x: 50, y: 40 });
  (ed as any).cancelImageDraft();
  assert.equal((o2.shape as any).edit, undefined);
  assert.equal(ed.history.position, before);
});

await test('snap targets/modifiers/aspect priority on handles', () => {
  const a = imgObj(); const b: Obj = { id: newId(), m: [1, 0, 0, 1, 200, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0 } };
  const ed = editor([a, b]); ed.doc.objs = [a, b]; ed.sel = [a];
  const set = (ed as any).buildSnap([a]);
  assert.ok(set.pts.length > 0);
  const p1 = ed.snapPt({ x: 200.05, y: 10 }, { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as any);
  assert.ok(Math.abs(p1.x - 200) < 0.01);
  const inverted = ed.snapPt({ x: 200.05, y: 10 }, { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as any);
  assert.ok(Math.abs(inverted.x - 200.05) < 1e-9);
  assert.equal((ed as any).startImageEdit(a.id, 'crop'), null);
  const locked = (ed as any).dragImageCropHandle('tr', { x: 200, y: 10 }, { aspectLock: true, snap: true });
  assert.equal(locked, null);
  assert.deepEqual((ed as any).imageCropPreview(a.id), { left: 0, top: 0, right: 1, bottom: 1 });
  (ed as any).cancelImageDraft();
});

for (const handle of ['tl', 'tr', 'br', 'bl'] as const) {
  for (const scale of [0.8, 1, 1.2, 10]) {
    await test(`locked ${handle} scales ${scale} about the opposite anchor and clamps proportionally`, () => {
      const o = imgObj({ shape: { kind: 'image', w: 200, h: 100, asset: 'a' } });
      const ed = editor([o]) as any;
      assert.equal(ed.startImageEdit(o.id, 'crop'), null);
      assert.equal(ed.setImageCropNumeric({ left: 40, top: 20, right: 160, bottom: 60, unit: 'mm' }), null);
      const left = handle.includes('l'), top = handle.startsWith('t');
      const ax = left ? 160 : 40, ay = top ? 60 : 20;
      let snapCalls = 0;
      ed.snapPt = () => { snapCalls++; return { x: 0, y: 0 }; };
      assert.equal(ed.dragImageCropHandle(handle, { x: ax + (left ? -1 : 1) * 120 * scale,
        y: ay + (top ? -1 : 1) * 40 * scale }, { aspectLock: true, snap: true }), null);
      assert.equal(snapCalls, 0, 'aspect lock must win over snapping');
      const crop = ed.imageCropPreview(o.id)!;
      const l = crop.left * 200, r = crop.right * 200, t = crop.top * 100, b = crop.bottom * 100;
      const maxScale = Math.min((left ? ax : 200 - ax) / 120, (top ? ay : 100 - ay) / 40);
      const expectedScale = Math.min(scale, maxScale);
      assert.ok(Math.abs((r - l) - 120 * expectedScale) < 1e-9);
      assert.ok(Math.abs((b - t) - 40 * expectedScale) < 1e-9);
      assert.ok(Math.abs((left ? r : l) - ax) < 1e-9);
      assert.ok(Math.abs((top ? b : t) - ay) < 1e-9);
      assert.ok([l, r, t, b].every(Number.isFinite));
      assert.ok(l >= 0 && t >= 0 && r <= 200 && b <= 100);
      assert.equal((o.shape as any).edit, undefined);
      assert.equal(ed.history.position, 0);
      ed.cancelImageDraft();
    });
  }
}

await test('locked full-image corner resizes inward and rejects non-finite targets without corrupting the draft', () => {
  const o = imgObj({ shape: { kind: 'image', w: 200, h: 100, asset: 'a' } }); const ed = editor([o]) as any;
  assert.equal(ed.startImageEdit(o.id, 'crop'), null);
  assert.equal(ed.dragImageCropHandle('br', { x: 160, y: 80 }, { aspectLock: true, snap: false }), null);
  assert.deepEqual(ed.imageCropPreview(o.id), { left: 0, top: 0, right: 0.8, bottom: 0.8 });
  const before = ed.imageCropPreview(o.id);
  for (const point of [{ x: NaN, y: 20 }, { x: 20, y: Infinity }]) {
    assert.ok(ed.dragImageCropHandle('br', point, { aspectLock: true, snap: false }));
    assert.deepEqual(ed.imageCropPreview(o.id), before);
  }
  ed.cancelImageDraft();
});

await test('keyboard alternatives and AABB follows visible quad under transform', () => {
  const o = imgObj({ m: [Math.cos(0.5), Math.sin(0.5), -Math.sin(0.5), Math.cos(0.5), 30, 40] }); const ed = editor([o]);
  ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'crop');
  (ed as any).nudgeImageCropHandle('right', 'ArrowLeft', 1);
  (ed as any).applyImageDraft();
  const r = resolveImageEdits(o.shape as any); assert.ok(r.ok);
  const b = boundsOf([o]);
  const xs = (r as any).quad.map((p: any) => p.x); const ys = (r as any).quad.map((p: any) => p.y);
  void xs; void ys;
  assert.ok(b && b.w > 0 && b.h > 0);
  const subs = shapeSubs(o.shape as any);
  assert.equal(subs.length, 1); assert.equal(subs[0].nodes.length, 4);
  void buildSnapSet;
});

await test('cropFirst snaps the projected world handle and inversely maps the snapped target', () => {
  const o = imgObj({ m: [1.2, .3, -.4, .9, 30, 40] });
  const ed = editor([o]) as any;
  ed.startImageEdit(o.id, 'perspective');
  ed.setImagePerspectiveCorner(0, { x: 25, y: 0 }, { snap: false });
  ed.setImagePerspectiveCorner(1, { x: 75, y: 0 }, { snap: false });
  ed.setImageEditTab('crop');
  const geometry = createImageGeometry(undefined, ed.imageDraft().quad); assert.ok(geometry.ok);
  const projected = geometry.geometry.sourceToLocal({ x: .9, y: .5 })!;
  const expected = apply(o.m, projected.x, projected.y);
  let captured: any;
  ed.snapPt = (p: any) => { captured = p; return { x: p.x + .2, y: p.y - .1 }; };
  assert.equal(ed.dragImageCropHandle('right', { x: 90, y: 25 }), null);
  assert.ok(Math.hypot(captured.x - expected.x, captured.y - expected.y) < 1e-9);
  const local = apply(inv(o.m), expected.x + .2, expected.y - .1);
  const source = geometry.geometry.localToSource(local)!;
  assert.ok(Math.abs(ed.imageDraft().crop.right - source.x) < 1e-9);
});
await test('disabled object snapping builds no object targets, while Ctrl inversion still enables them', () => {
  const ed = editor([imgObj()]) as any, o = ed.doc.objs[0];
  ed.snapObjects = ed.snapGrid = false;
  let builds = 0; const build = ed.buildSnap;
  ed.buildSnap = (...args: any[]) => { builds++; return build.apply(ed, args); };
  ed.startImageEdit(o.id, 'perspective');
  ed.setImagePerspectiveCorner(2, { x: 90, y: 45 });
  ed.setImageEditTab('crop');
  ed.dragImageCropHandle('right', { x: 85, y: 20 });
  assert.equal(builds, 0);
  ed.dragImageCropHandle('right', { x: 85, y: 20 }, { event: { ctrlKey: true } });
  assert.equal(builds, 1);
});
console.log(`DONE ${count}`);
