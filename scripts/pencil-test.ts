import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, apply } = await import('../src/model');
const { shapeSubs } = await import('../src/geom');
const { t } = await import('../src/i18n');
type E = import('../src/editor').Editor;
type Obj = import('../src/model').Obj;
type Pt = import('../src/model').Pt;
let count = 0;
function test(name: string, f: () => void) { f(); count++; console.log(`PASS ${name}`); }
function obj(id: number, dx = 0): Obj {
  return { id, m: [1, 0, 0, 1, dx, 0], layer: 0, name: `Synthetic ${id}`, shape: { kind: 'path', subs: [{ nodes: [{ x: 40, y: 40 }, { x: 80, y: 40 }, { x: 80, y: 80 }], closed: false }] } };
}
function editor(objs: Obj[]): E {
  const ed = Object.create(Editor.prototype) as E;
  Object.assign(ed, { doc: newDoc(), sel: objs, tool: 'node', nodeSets: new Map(), segmentSets: new Map(), nodeSel: new Set(),
    nodeSelObj: null, nodeEditObj: null, nodeHover: null, segHover: null, vectorPreview: null, drag: null, draft: null,
    history: new History(), batching: false, view: { zoom: 1, ox: 0, oy: 0 },
    snapGrid: false, snapObjects: false, alignGuides: [], space: false, currentLayer: 0, pencilTolerance: 0.1, pencilClosed: false,
    snapHit: null, snapVer: 0, hint: '', cursor: { x: 0, y: 0 }, jointPicks: [], pivot: null,
    canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.doc.objs = objs;
  ed.emit = () => {}; ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.hitTest = () => null;
  return ed;
}
function event(x: number, y: number, extra = {}): PointerEvent {
  return { clientX: x, clientY: y, button: 0, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() {}, ...extra } as PointerEvent;
}
const point = (o: Obj, i: number) => { const n = shapeSubs(o.shape)[0].nodes[i]; return apply(o.m, n.x, n.y); };
test('Pencil creates fitted cubics with one Undo', () => {
  const ed = editor([]); ed.tool = 'pencil'; ed.onDown(event(40, 40)); for (let i = 1; i <= 120; i++) ed.onMove(event(40 + i / 2, 40 + Math.sin(i / 25) * 10));
  ed.onUp(event(100, 40 + Math.sin(120 / 25) * 10)); assert.equal(ed.doc.objs.length, 1); assert.equal(ed.history.position, 1);
  const sp = shapeSubs(ed.doc.objs[0].shape)[0]; assert.ok(sp.nodes.length < 40); assert.ok(sp.nodes.some((n) => n.cout)); ed.doUndo(); assert.equal(ed.doc.objs.length, 0);
});
test('tap, cancel and overflow never commit partial Pencil', () => {
  const ed = editor([]); ed.tool = 'pencil'; ed.onDown(event(40, 40)); ed.onUp(event(40, 40)); assert.equal(ed.doc.objs.length, 0);
  ed.onDown(event(40, 40)); ed.onMove(event(90, 90)); ed.cancelDrag(); assert.equal(ed.doc.objs.length, 0);
  ed.onDown(event(40, 40)); if (ed.drag?.type === 'pencil') ed.drag.overflow = true; ed.onUp(event(80, 80)); assert.equal(ed.doc.objs.length, 0); assert.equal(ed.history.position, 0);
});
test('unrelated pointer releases cannot silently discard a Pencil stroke', () => {
  const ed = editor([]); ed.tool = 'pencil'; ed.onDown(event(40, 40)); ed.onMove(event(60, 55));
  const active = ed.drag;
  ed.onUp(event(80, 70, { pointerId: 2 })); assert.equal(ed.drag, active); assert.equal(ed.history.position, 0);
  ed.onUp(event(80, 70)); assert.equal(ed.doc.objs.length, 1); assert.equal(ed.history.position, 1);
  // Compare against the translated hint: the test locale is English since the English fallback (#181)
  assert.equal(ed.hint, t('Freihandpfad erstellt: {n} Knoten. Rückgängig mit Ctrl+Z.', { n: shapeSubs(ed.doc.objs[0].shape)[0].nodes.length }));
});
test('second pointer down, cancellation and capture loss do not replace the Pencil owner', () => {
  const ed = editor([]); ed.tool = 'pencil'; ed.onDown(event(40, 40)); ed.onMove(event(60, 55));
  const active = ed.drag;
  ed.onDown(event(90, 90, { pointerId: 2 })); assert.equal(ed.drag, active);
  ed.cancelPointerDrag(event(90, 90, { pointerId: 2 })); assert.equal(ed.drag, active);
  ed.cancelPointerDrag(event(60, 55)); assert.equal(ed.drag, null); assert.equal(ed.doc.objs.length, 0); assert.equal(ed.history.position, 0);
});
test('an ordinary Pencil click reports why it produces no result without consuming Undo', () => {
  const ed = editor([]); ed.tool = 'pencil'; ed.onDown(event(40, 40)); ed.onUp(event(40, 40));
  assert.equal(ed.doc.objs.length, 0); assert.equal(ed.history.position, 0); assert.equal(ed.hint, t('Kein Freihandpfad erstellt: zum Zeichnen ziehen, nicht nur klicken.'));
});
console.log("Focused feature checks passed.");
