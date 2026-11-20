// Copy/paste/duplicate must carry a linked image-cut contour with a fresh link (lifecycle).
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { assignImageContour } = await import('../src/imageCut');
const { IDENT } = await import('../src/mat');
type Obj = import('../src/model').Obj;

let nextId = 1;
const imageObj = (): Obj => ({ id: nextId++, m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: { kind: 'image', asset: 'a', w: 100, h: 60, pxW: 100, pxH: 60, adjust: {} as never } });
const pathObj = (): Obj => ({ id: nextId++, m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: { kind: 'path', subs: [{ nodes: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], closed: true }] } });
const cut = (o: Obj) => (o.shape as { cut?: { mode: string; contourId?: number } }).cut;
const link = (o: Obj) => o.cutLink;

const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(),
  nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), clipboard: [],
  isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, batching: false,
  view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
ed.doc.layers[0] = defaultLayer(0);
ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
ed.emit = () => {};
const pair = () => {
  const img = imageObj(), c = pathObj();
  assert.equal(assignImageContour(img, c, IDENT), true);
  ed.doc.objs = [img, c];
  ed.setSel([img]);
  ed.clipboard = [];
  return { img, c };
};

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`ok ${checks} - ${name}`); };

check('copy includes the linked contour although only the image is selected', () => {
  const { img, c } = pair();
  ed.copy();
  assert.equal(ed.clipboard.length, 2, 'clipboard holds the image and its contour');
  assert.ok(ed.clipboard.some((o) => o.id === img.id) && ed.clipboard.some((o) => o.id === c.id));
  assert.equal(ed.clipboard.find((o) => o.id === c.id)!.cutLink!.imageId, img.id);
});

check('paste creates a fresh image/contour pair with remapped links', () => {
  pair();
  ed.copy();
  ed.paste();
  assert.equal(ed.doc.objs.length, 4);
  const [ni, nc] = ed.doc.objs.slice(2);
  assert.notEqual(ni.id, ed.doc.objs[0].id);
  assert.notEqual(nc.id, ed.doc.objs[1].id);
  assert.deepEqual(cut(ni), { mode: 'contour', contourId: nc.id });
  assert.deepEqual(link(nc), { imageId: ni.id, prevNoLaser: false });
  assert.equal(nc.noLaser, true);
  assert.ok(ed.sel.some((o) => o.id === nc.id), 'paste selects the contour too');
  ed.paste();
  const next = ed.doc.objs.slice(4);
  assert.deepEqual(cut(next[0]), { mode: 'contour', contourId: next[1].id }, 'repeated paste stays linked to its own contour');
  assert.notEqual(cut(next[0])!.contourId, nc.id);
});

check('duplicate carries the contour and keeps one undo step', () => {
  pair();
  ed.duplicate();
  assert.equal(ed.doc.objs.length, 4);
  const [di, dc] = ed.doc.objs.slice(2);
  assert.deepEqual(cut(di), { mode: 'contour', contourId: dc.id });
  assert.deepEqual(link(dc), { imageId: di.id, prevNoLaser: false });
  assert.ok(ed.sel.some((o) => o.id === dc.id));
  const pos = ed.history.position;
  ed.doUndo();
  assert.equal(ed.doc.objs.length, 2, 'undo restores the document');
  assert.equal(ed.history.position, pos - 1, 'duplicate is one undo step');
});

check('deleting the image keeps the contour off; deleting the contour keeps a dangling link', () => {
  const { img, c } = pair();
  ed.setSel([img]); ed.deleteSel();
  assert.deepEqual(ed.doc.objs, [c]);
  assert.equal(c.noLaser, true, 'orphaned contour stays without laser output');
  const { img: img2, c: c2 } = pair();
  ed.setSel([c2]); ed.deleteSel();
  assert.deepEqual(ed.doc.objs, [img2]);
  assert.deepEqual(cut(img2), { mode: 'contour', contourId: c2.id }, 'dangling link blocks an active cut');
});

console.log(`image cut lifecycle: ${checks}/${checks} passed`);
