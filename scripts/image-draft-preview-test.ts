import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc, newId } from '../src/model';
import type { Obj } from '../src/model';
import type { Editor as E } from '../src/editor';
import { resolveImageEdits } from '../src/imageEdits';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }

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

// Red: the render path needs the draft as an ImageEdit; no such export exists yet.
const mod = await import('../src/editor/imageHandles');
assert.ok((mod as any).imageDraftEdit, 'imageDraftEdit export missing');

await test('no draft returns null and leaves the model untouched', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o];
  assert.equal((mod as any).imageDraftEdit(ed, o.id), null);
  assert.equal((o.shape as any).edit, undefined);
});

await test('perspective draft returns a resolvable edit without touching the model', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'perspective');
  (ed as any).setImagePerspectiveCorner(2, { x: 90, y: 45 }, { snap: false });
  const edit = (mod as any).imageDraftEdit(ed, o.id);
  assert.ok(edit && Array.isArray(edit.perspective));
  assert.equal(edit.perspective[2].x, 90); assert.equal(edit.perspective[2].y, 45);
  assert.equal((o.shape as any).edit, undefined);
  const r = resolveImageEdits({ ...(o.shape as any), edit });
  assert.ok(r.ok, 'draft edit must resolve');
});

await test('draft order is carried and cancel clears', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'crop');
  (ed as any).setImageEditOrder('perspectiveFirst');
  assert.equal((mod as any).imageDraftEdit(ed, o.id)?.order, 'perspectiveFirst');
  (ed as any).cancelImageDraft();
  assert.equal((mod as any).imageDraftEdit(ed, o.id), null);
});

await test('foreign image id returns null', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  (ed as any).startImageEdit(o.id, 'crop');
  assert.equal((mod as any).imageDraftEdit(ed, o.id + 9999), null);
  (ed as any).cancelImageDraft();
});

console.log(`DONE ${count}`);
