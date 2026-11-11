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
test('affine multi-object nudge is one Undo step', () => {
  const a = obj(1), b = obj(2, 150); b.m = [0, 2, -3, 0, 350, 20];
  const ed = editor([a, b]), pa = point(a, 0), pb = point(b, 0);
  ed.selectAllNodes(); assert.equal(ed.selectedNodes().length, 6); assert.equal(ed.nudgeNodes(3, -2), true);
  for (const [o, p] of [[a, pa], [b, pb]] as [Obj, Pt][]) { const q = point(o, 0); assert.ok(Math.abs(q.x - p.x - 3) < 1e-8); assert.ok(Math.abs(q.y - p.y + 2) < 1e-8); }
  assert.equal(ed.history.position, 1); ed.doUndo();
  assert.deepEqual(point(ed.doc.objs[0], 0), pa); assert.deepEqual(point(ed.doc.objs[1], 0), pb);
  assert.equal(ed.selectedNodes().length, 0); ed.doRedo(); assert.equal(ed.history.position, 1);
});
test('multi-object marquee and Shift addition', () => {
  const ed = editor([obj(1), obj(2, 100)]);
  ed.onDown(event(25, 25)); ed.onMove(event(190, 45)); ed.onUp(event(190, 45)); assert.equal(ed.selectedNodes().length, 4);
  ed.onDown(event(70, 70, { shiftKey: true })); ed.onMove(event(190, 90)); ed.onUp(event(190, 90));
  assert.equal(ed.selectedNodes().length, 6); assert.equal(ed.history.position, 0);
});
test('node drag moves both objects in world mm', () => {
  const a = obj(1), b = obj(2, 100), ed = editor([a, b]); ed.nodeSelection(a).add('0:0'); ed.nodeSelection(b).add('0:0');
  ed.onDown(event(40, 40)); ed.onMove(event(45, 47)); ed.onUp(event(45, 47));
  assert.deepEqual(point(a, 0), { x: 45, y: 47 }); assert.deepEqual(point(b, 0), { x: 145, y: 47 }); assert.equal(ed.history.position, 1);
});
test('cancel restores primitives, paths and Redo', () => {
  const a = obj(1), ed = editor([a, obj(2, 100)]); a.shape = { kind: 'rect', w: 40, h: 30, r: 0 }; a.m = [1, 0, 0, 1, 40, 40];
  ed.selectAllNodes(); ed.nudgeNodes(1, 0); ed.doUndo(); const before = ed.state(), [a2, b2] = ed.doc.objs;
  ed.nodeSelection(a2).add('0:0'); ed.nodeSelection(b2).add('0:0'); const p = point(a2, 0);
  ed.onDown(event(p.x, p.y)); ed.onMove(event(p.x + 9, p.y + 6)); ed.cancelDrag();
  assert.equal(ed.state(), before); assert.equal(ed.history.canRedo, true);
});
test('primitive click neither bakes nor adds Undo', () => {
  const a = obj(1), ed = editor([a]); a.shape = { kind: 'rect', w: 40, h: 30, r: 0 }; a.m = [1, 0, 0, 1, 40, 40];
  const p = point(a, 0); ed.onDown(event(p.x, p.y)); ed.onUp(event(p.x, p.y)); assert.equal(a.shape.kind, 'rect'); assert.equal(ed.history.position, 0);
});
test('segment Delete splits surviving edges', () => {
  const a = obj(1), ed = editor([a]); if (a.shape.kind === 'path') a.shape.subs[0].nodes.push({ x: 120, y: 80 });
  ed.onDown(event(80, 60)); ed.onUp(event(80, 60)); assert.equal(ed.segmentSelection(a).size, 1); assert.equal(ed.selectedNodes().length, 0);
  ed.deleteNodes(); const subs = shapeSubs(a.shape); assert.equal(subs.length, 2); assert.ok(subs.every((s) => s.nodes.length === 2 && !s.closed));
  assert.equal(ed.history.position, 1); ed.doUndo(); assert.equal(shapeSubs(ed.doc.objs[0].shape)[0].nodes.length, 4);
});
test('node/segment types span objects in one transaction', () => {
  const a = obj(1), b = obj(2, 100), ed = editor([a, b]); ed.nodeSelection(a).add('0:1'); ed.nodeSelection(b).add('0:1');
  ed.setNodeType(true); assert.ok(shapeSubs(a.shape)[0].nodes[1].smooth); assert.ok(shapeSubs(b.shape)[0].nodes[1].smooth); assert.equal(ed.history.position, 1);
  ed.clearNodeSel(); ed.segmentSelection(a).add('0:0'); ed.segmentSelection(b).add('0:0'); ed.setSegmentType(false);
  assert.ok(!shapeSubs(a.shape)[0].nodes[0].cout); assert.ok(!shapeSubs(b.shape)[0].nodes[0].cout);
});
test('locked, hidden and singular targets are excluded', () => {
  const a = obj(1), b = obj(2), c = obj(3), ed = editor([a, b, c]); a.locked = true; b.hidden = true; c.m = [0, 0, 0, 0, 0, 0];
  assert.equal(ed.nodeTargets().length, 0); ed.selectAllNodes(); assert.equal(ed.nudgeNodes(1, 1), false);
});
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
test('multi-object Delete retains unrelated object', () => {
  const a = obj(1), b = obj(2, 100), c = obj(3, 200), ed = editor([a, b]); ed.doc.objs.push(c);
  ed.nodeSelection(a).add('0:1'); ed.nodeSelection(b).add('0:1'); ed.deleteNodes();
  assert.equal(shapeSubs(a.shape)[0].nodes.length, 2); assert.equal(shapeSubs(b.shape)[0].nodes.length, 2); assert.equal(ed.doc.objs[2], c); assert.equal(ed.history.position, 1);
});
test('segment drag leaves unselected nodes alone', () => {
  const a = obj(1), b = obj(2, 120), ed = editor([a, b]); ed.segmentSelection(a).add('0:0'); ed.segmentSelection(b).add('0:0'); const untouched = point(a, 2);
  ed.onDown(event(60, 40)); ed.onMove(event(62, 43)); ed.onUp(event(62, 43));
  assert.deepEqual(point(a, 0), { x: 42, y: 43 }); assert.deepEqual(point(b, 1), { x: 202, y: 43 }); assert.deepEqual(point(a, 2), untouched); assert.equal(ed.history.position, 1);
});
test('mixed node/segment Delete respects both sets', () => {
  const a = obj(1), ed = editor([a]); if (a.shape.kind === 'path') a.shape.subs.push({ nodes: [{ x: 0, y: 10 }, { x: 5, y: 10 }, { x: 10, y: 10 }], closed: false });
  ed.segmentSelection(a).add('0:0'); ed.nodeSelection(a).add('1:1'); ed.deleteNodes(); const subs = shapeSubs(a.shape);
  assert.equal(subs.length, 2); assert.ok(subs.every((s) => s.nodes.length === 2));
});
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
  assert.ok(ed.hint.includes('Freihandpfad erstellt'));
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
  assert.equal(ed.doc.objs.length, 0); assert.equal(ed.history.position, 0); assert.ok(ed.hint.includes('nicht nur klicken'));
});
console.log(`Vector editor: ${count} offline integration checks passed.`);
