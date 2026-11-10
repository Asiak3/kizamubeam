import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, apply } = await import('../src/model');
const { shapeSubs } = await import('../src/geom');
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
  Object.assign(ed, { doc: newDoc(), sel: objs, tool: 'node', nodeSets: new Map(), segmentSets: new Map(), handleSets:new Map(), nodeSel: new Set(),
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
test('fit preview is immutable; Apply retains metadata/matrices and is undoable', () => {
  const a = obj(1), b = obj(2, 100), ed = editor([a, b]);
  for (const o of [a, b]) o.shape = { kind: 'path', subs: [{ nodes: Array.from({ length: 50 }, (_, x) => ({ x, y: 0 })), closed: false }] };
  b.m = [2, 0, 0, 0.5, 100, 0]; const before = ed.state(), matrix = [...b.m];
  assert.equal(ed.previewVectorFit({ tolerance: 0.1, curves: false, preserveCorners: true }).after, 4); assert.equal(ed.state(), before); assert.equal(ed.history.position, 0);
  assert.ok(ed.applyVectorFit()); assert.equal(ed.history.position, 1); assert.equal(b.name, 'Synthetic 2'); assert.deepEqual(b.m, matrix); ed.doUndo(); assert.equal(ed.state(), before);
});
test('stale fit cannot overwrite source', () => {
  const a = obj(1), ed = editor([a]); ed.previewVectorFit({ tolerance: 0.1, curves: true, preserveCorners: true }); a.m[4] = 9;
  assert.throws(() => ed.applyVectorFit()); assert.equal(ed.history.position, 0);
});
test('holes, start flags and marks survive; no-op adds no Undo', () => {
  const a = obj(1), ed = editor([a]); const ring = (s: number) => ({ nodes: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }], closed: true, start: true });
  a.shape = { kind: 'path', mark: 'Synthetic marking', subs: [ring(10), ring(2)] }; const before = JSON.stringify(a.shape);
  ed.previewVectorFit({ tolerance: 0.1, curves: true, preserveCorners: true }); ed.applyVectorFit();
  assert.equal(JSON.stringify(a.shape), before); assert.equal(ed.history.position, 0);
});
console.log("Focused feature checks passed.");
