// Context actions for assigning/releasing a per-image cut contour (keyboard-reachable menu entries).
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { editorContextGroups } = await import('../src/editorContext');
type Obj = import('../src/model').Obj;
type ContextAction = import('../src/contextMenu').ContextAction;

let nextId = 1;
const imageObj = (): Obj => ({ id: nextId++, m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: { kind: 'image', asset: 'a', w: 100, h: 60, pxW: 100, pxH: 60, adjust: {} as never } });
const pathObj = (closed = true): Obj => ({ id: nextId++, m: [1, 0, 0, 1, 0, 0], layer: 0,
  shape: { kind: 'path', subs: [{ nodes: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 50 }, { x: 10, y: 50 }], closed }] } });
const cut = (o: Obj) => (o.shape as { cut?: { mode: string; contourId?: number } }).cut;

const callbacks = { adjust() {}, trace() {}, background() {}, saveBitmap() {}, library() {}, preview() {}, objects() {} };
function fixture(objs: Obj[], sel: Obj[]) {
  const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
  Object.assign(ed, { doc: newDoc(), sel, tool: 'select', history: new History(), listeners: new Set(),
    nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(), clipboard: [],
    isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, batching: false,
    view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.doc.layers[0] = defaultLayer(0);
  ed.doc.objs = objs;
  ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
  ed.emit = () => {};
  const find = (id: string): ContextAction | undefined =>
    editorContextGroups(ed, callbacks).flat().flatMap((a) => [a, ...(a.items ?? [])]).find((a) => a.id === id);
  return { ed, find };
}

let checks = 0;
const check = (name: string, fn: () => void) => { fn(); checks++; console.log(`ok ${checks} - ${name}`); };

check('assign is only enabled for one image plus one closed path', () => {
  const img = imageObj();
  let f = fixture([img], [img]);
  assert.equal(f.find('assign-image-cut')?.enabled, false, 'image alone cannot be assigned');
  assert.equal(f.find('unassign-image-cut')?.enabled, false, 'no cut to release yet');
  const open = pathObj(false);
  f = fixture([img, open], [img, open]);
  assert.equal(f.find('assign-image-cut')?.enabled, false, 'open path is not a cut contour');
  const c = pathObj();
  f = fixture([img, c], [img, c]);
  assert.equal(f.find('assign-image-cut')?.enabled, true);
  const c2 = pathObj();
  f = fixture([img, c, c2], [img, c, c2]);
  assert.equal(f.find('assign-image-cut')?.enabled, false, 'two paths are ambiguous');
});

check('assign stores the link in one undo step and blocks invalid geometry', () => {
  const img = imageObj(), c = pathObj();
  const { ed, find } = fixture([img, c], [img, c]);
  find('assign-image-cut')!.run();
  assert.deepEqual(cut(img), { mode: 'contour', contourId: c.id });
  assert.deepEqual(c.cutLink, { imageId: img.id, prevNoLaser: false });
  assert.equal(c.noLaser, true);
  assert.equal(ed.history.position, 1);
  const badImg = imageObj(), bad = pathObj();
  (bad.shape as { subs: { nodes: unknown[] }[] }).subs[0].nodes.length = 1;
  const f2 = fixture([badImg, bad], [badImg, bad]);
  // invalid input is rejected without leaving an empty undo step
  assert.throws(() => f2.find('assign-image-cut')!.run(), /ungültig|gültig/, 'clear problem text');
  assert.equal(f2.ed.history.position, 0, 'failed assign adds no undo step');
});

check('unassign restores the contour output in one undo step', () => {
  const img = imageObj(), c = pathObj();
  const { ed, find } = fixture([img, c], [img, c]);
  find('assign-image-cut')!.run();
  ed.setSel([img]);
  assert.equal(find('unassign-image-cut')?.enabled, true);
  find('unassign-image-cut')!.run();
  assert.equal(cut(img), undefined);
  assert.equal(c.cutLink, undefined);
  assert.equal(c.noLaser, undefined);
  assert.equal(ed.history.position, 2);
});

check('unassign on a dangling link reports problem and fix without changing the document', () => {
  const img = imageObj();
  (img.shape as { cut?: unknown }).cut = { mode: 'contour', contourId: 999999 };
  const { ed, find } = fixture([img], [img]);
  assert.equal(find('unassign-image-cut')?.enabled, true);
  assert.throws(() => find('unassign-image-cut')!.run(), /fehlt.*zuweisen|zuweisen.*fehlt/, 'names missing contour and the fix');
  assert.deepEqual(cut(img), { mode: 'contour', contourId: 999999 });
  assert.equal(ed.history.position, 0);
});

check('assign uses the image world matrix under zoom/offset (non-identity)', () => {
  // Two-page setup gives the image a parent matrix so worldMatrix() != o.m.
  const img = imageObj(), c = pathObj();
  const { ed, find } = fixture([img, c], [img, c]);
  const W = [1.5, 0.3, -0.2, 0.9, 40, -15] as const;
  ed.worldMatrix = (o: Obj) => (o === img ? [...W] : o.m);
  find('assign-image-cut')!.run();
  assert.deepEqual(cut(img), { mode: 'contour', contourId: c.id });
  const nodes = (c.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0].nodes;
  assert.ok(nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.ok(nodes.some((n) => Math.abs(n.x - 10) > 1), 'nodes were mapped from world through the image matrix');
  find('unassign-image-cut')!.run();
  const world = (c.shape as { subs: { nodes: { x: number; y: number }[] }[] }).subs[0].nodes;
  assert.ok(world.some((n) => Math.abs(n.x - 10) < 1e-7), 'unassign restores the original world-space nodes');
});

console.log(`image cut actions: ${checks}/${checks} passed`);
