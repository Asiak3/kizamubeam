import assert from 'node:assert/strict';
import { Editor } from '../src/editor';
import { History } from '../src/history';
import { newDoc, newId } from '../src/model';
import type { Obj } from '../src/model';

let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }

function editor(objects: Obj[]): any {
  const ed = Object.create(Editor.prototype) as any;
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
const imgObj = (extra: Partial<Obj> = {}): Obj => ({ id: newId(), m: [1, 0, 0, 1, 0, 0] as any, layer: 0,
  shape: { kind: 'image', w: 100, h: 50, asset: 'a', ...(extra as any).shape ?? {} }, ...extra } as Obj);

const ui = await import('../src/imageCropUi');

// Echte Zeiger-Events durch den Editor-Dispatch (onDown/onMove/onUp).
// ctrlKey kehrt den Fang um (snapModes): Fang damit trotz aktiver Fangschalter
// aus, shiftKey bleibt frei (kein Aspect-Lock).
const pev = (x: number, y: number) =>
  ({ clientX: x, clientY: y, pointerId: 1, button: 0, shiftKey: false, ctrlKey: true, metaKey: false, altKey: false }) as any;

await test('dispatch crop drag under perspectiveFirst stores drawn rect (no unwarp jump)', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed), null);
  ed.setImageEditTab('perspective');
  assert.equal(ed.setImagePerspectiveCorner(2, { x: 90, y: 45 }, { snap: false }), null);
  ed.setImageEditTab('crop');
  assert.equal(ed.setImageEditOrder('perspectiveFirst'), null);
  const br = ui.cropHandleScreens(ed, o.id).find((p: any) => p.handle === 'br')!;
  ed.onDown(pev(br.screen.x, br.screen.y));
  assert.equal(ed.drag?.type, 'image-crop');
  assert.equal(ed.drag?.mode, 'crop');
  const t = ed.toScreen({ x: 80, y: 40 } as any);
  ed.onMove(pev(t.x, t.y));
  ed.onUp(pev(t.x, t.y));
  const prev = ed.imageCropPreview(o.id)!;
  assert.ok(Math.abs(prev.left) < 1e-9 && Math.abs(prev.top) < 1e-9, JSON.stringify(prev));
  assert.ok(Math.abs(prev.right - 0.8) < 1e-9 && Math.abs(prev.bottom - 0.8) < 1e-9, JSON.stringify(prev));
  ed.cancelImageDraft();
});

await test('dispatch perspective corner drag stores drop position (no unwarp jump)', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed, 'perspective'), null);
  const c2 = ui.perspectiveCornerScreens(ed, o.id).find((p: any) => p.index === 2)!;
  ed.onDown(pev(c2.screen.x, c2.screen.y));
  assert.equal(ed.drag?.type, 'image-crop');
  assert.equal(ed.drag?.mode, 'perspective');
  const t = ed.toScreen({ x: 80, y: 40 } as any);
  ed.onMove(pev(t.x, t.y));
  ed.onUp(pev(t.x, t.y));
  const q = ed.imagePerspectivePreview(o.id)!;
  assert.ok(Math.abs(q[2].x - 80) < 1e-9 && Math.abs(q[2].y - 40) < 1e-9, JSON.stringify(q));
  assert.deepEqual([q[0], q[1], q[3]], [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 50 }]);
  ed.cancelImageDraft();
});

await test('dispatch perspective corner drag from preset non-identity quad stores drop position', () => {
  const o = imgObj(); const ed = editor([o]); ed.doc.objs = [o]; ed.sel = [o];
  assert.equal(ui.startImageEditForSel(ed, 'perspective'), null);
  assert.equal(ed.setImagePerspectiveCorner(0, { x: 10, y: 5 }, { snap: false }), null);
  const c2 = ui.perspectiveCornerScreens(ed, o.id).find((p: any) => p.index === 2)!;
  ed.onDown(pev(c2.screen.x, c2.screen.y));
  assert.equal(ed.drag?.type, 'image-crop');
  assert.equal(ed.drag?.mode, 'perspective');
  const t = ed.toScreen({ x: 80, y: 40 } as any);
  ed.onMove(pev(t.x, t.y));
  ed.onUp(pev(t.x, t.y));
  const q = ed.imagePerspectivePreview(o.id)!;
  assert.ok(Math.abs(q[2].x - 80) < 1e-9 && Math.abs(q[2].y - 40) < 1e-9, JSON.stringify(q));
  assert.deepEqual([q[0], q[1], q[3]], [{ x: 10, y: 5 }, { x: 100, y: 0 }, { x: 0, y: 50 }]);
  ed.cancelImageDraft();
});

console.log(`DONE ${count}`);
